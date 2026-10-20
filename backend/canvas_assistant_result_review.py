"""作品检查与评价流程：本轮任务归属、文件快照和视觉送达证明。

只读画布和任务，通过既有质量模块核验文件；不写会话、不执行生成、不登记评价。
路由负责会话执行归属与持久化，服务只返回本次真实检查或评价。
"""
from __future__ import annotations

import asyncio
import copy
import hashlib
import json
import time

from fastapi import HTTPException

from backend import canvas_assistant_canvas_rules as context_rules


class ResultInspectionService:
    """复用应用注入的只读端口；每次调用的数据均局限于当前回合。"""

    def __init__(self, *, load_canvas, providers, resolve_result_file, result_roots,
                 query_image=None, query_native_task=None):
        self.load_canvas = load_canvas
        self.providers = providers
        self.resolve_result_file = resolve_result_file
        self.result_roots = result_roots
        self.query_image = query_image
        self.query_native_task = query_native_task

    async def inspect_or_review(self, name, args, step_id, *, payload, saved_turn, own_proposal):
        """重读真实文件与当前任务；视觉结论须具备下一次模型输入的送达证据。"""
        from backend.canvas_assistant_quality import inspect_images, inspect_videos, build_inspection, build_video_inspection
        if not self.resolve_result_file or not self.result_roots:
            raise HTTPException(409,'当前入口未接入真实作品文件检查，无法判断作品质量')
        inspection_args=args
        prior=None
        if name=='record_result_review':
            prior=(saved_turn.get('agent') or {}).get('resultInspection')
            if not prior or prior.get('id')!=args['inspectionId']:
                raise HTTPException(409,'请先读取本轮真实作品检查，不能登记任意检查编号')
            inspection_args=prior['arguments']
        current = await asyncio.to_thread(lambda:copy.deepcopy(self.load_canvas(payload.canvasId)))
        by_id = {item["id"]: item for item in context_rules.node_reference_assets(current) if item["kind"] in {'image','video'}}
        image_urls, video_urls = [], []
        for asset_id in inspection_args["assetIds"]:
            if asset_id not in by_id:
                raise HTTPException(422, "只能读取当前画布的真实图片或视频素材编号")
            (video_urls if by_id[asset_id]['kind']=='video' else image_urls).append(by_id[asset_id]["url"])
        proposal=task=None
        if inspection_args["proposalId"]:
            proposal=next((p for p in saved_turn.get('nativeActions',[]) if p.get('id')==inspection_args['proposalId'] and p.get('action')=='run' and p.get('nodeType')=='video'),None)
            if proposal:
                task_ids=(proposal.get('receipt') or {}).get('taskIds')
                if proposal.get('state') not in {'accepted','completed','submission_unknown'} or not self.query_native_task or not isinstance(task_ids,list) or not task_ids or len(task_ids)>2:
                    raise HTTPException(409,'原视频尚未取得可核对的任务编号，不能评价生成结果')
                task=await asyncio.gather(*(self.query_native_task('video',task_id) for task_id in task_ids))
                if any(not isinstance(t,dict) or t.get('status')!='succeeded' for t in task):raise HTTPException(409,'原视频任务尚未成功，不能评价成品')
                for item in task:
                    values=(item.get('result') or {}).get('videos')
                    if not isinstance(values,list) or not values or len(values)>2:raise HTTPException(409,'原视频没有完整结果记录，无法核验')
                    for value in values:
                        url=value.get('url') if isinstance(value,dict) else value
                        if not isinstance(url,str) or not url.startswith(('/output/','/assets/','/api/storage-files/local/')):raise HTTPException(409,'原视频结果不是允许读取的本地文件')
                        video_urls.append(url)
            else:
                proposal = await own_proposal(inspection_args["proposalId"])
            if proposal.get('nodeType')!='video' and (proposal["state"] not in {"submitted", "submitting"} or not self.query_image):
                raise HTTPException(409, "图片尚未提交，不能评价生成结果")
            if proposal.get('nodeType')!='video':task = await self.query_image(proposal["taskId"])
            if proposal.get('nodeType')!='video' and (not isinstance(task,dict) or task.get("status") != "succeeded"):
                raise HTTPException(409, "原任务尚未成功，不能评价图片效果")
            result=task.get('result') if isinstance(task,dict) else None
            if proposal.get('nodeType')!='video' and (not isinstance(result,dict) or not isinstance(result.get('images'),list)):
                raise HTTPException(409,'原任务没有完整图片结果记录，无法核验')
            values = result['images'] if isinstance(result,dict) else []
            if len(values)>8:raise HTTPException(422,'本次结果超过可读取图片范围，不能以截断结果判断通过')
            for item in values:
                url = item.get("url") if isinstance(item, dict) else item
                if isinstance(url, str) and url.startswith(("/output/", "/assets/", "/api/storage-files/local/")):
                    image_urls.append(url)
            image_urls.extend(url for url in proposal.get('referenceImages',[]) if isinstance(url,str) and url.startswith(('/output/','/assets/','/api/storage-files/local/')))
        image_urls = list(dict.fromkeys(image_urls))
        video_urls = list(dict.fromkeys(video_urls))
        if len(video_urls)>2 or len(image_urls)+3*len(video_urls)>8:
            raise HTTPException(422,'每次最多核验2段视频，关键帧与图片合计不超过8张')
        if not image_urls and not video_urls:
            raise HTTPException(422, "没有可读取的真实图片或视频结果")
        metadata=await asyncio.to_thread(inspect_images,image_urls,resolve_file=self.resolve_result_file,allowed_roots=self.result_roots())
        video_metadata=await asyncio.to_thread(inspect_videos,video_urls,resolve_file=self.resolve_result_file,allowed_roots=self.result_roots()) if video_urls else []
        latest=await asyncio.to_thread(self.load_canvas,payload.canvasId)
        if current!=latest:
            raise HTTPException(409,'作品检查期间画布已变化，请重新检查')
        video_proposal=proposal if (proposal or {}).get('nodeType')=='video' else None
        inspection=build_inspection(canvas=current,images=metadata,proposal=proposal if not video_proposal else None,task=task if not video_proposal else None) if image_urls else {
            'version':1,'canvasId':current.get('id'),'proposalId':None,'taskId':None,'images':[],
            'checks':[],'hardStatus':'unknown','status':'unknown',
            'snapshotHash':hashlib.sha256(json.dumps(current,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()).hexdigest()}
        frames=[frame['dataUrl'] for video in video_metadata for frame in video.get('frames',[]) if video.get('ok') is True and frame.get('dataUrl')]
        if video_urls:
            checked_video=build_video_inspection(canvas=current,videos=video_metadata,proposal=video_proposal,task=task if video_proposal else None)
            safe_videos=checked_video['videos']
            image_snapshot=inspection['snapshotHash']
            if not image_urls:inspection=checked_video
            else:
                inspection['checks'].extend(checked_video['checks'])
                hard_states=[inspection['hardStatus'],checked_video['hardStatus']]
                hard='needs_changes' if 'needs_changes' in hard_states else 'unknown' if 'unknown' in hard_states else 'passed'
                inspection.update(hardStatus=hard,status='needs_changes' if hard=='needs_changes' else 'unknown')
            image_index=sum(image.get('ok') is True for image in metadata)
            for video in safe_videos:
                for frame in video['frames']:
                    image_index+=1
                    frame['inputImageIndex']=image_index
            inspection['videos']=safe_videos
            scope={'sampledFrames':len(frames),'fullVideoSemantics':'unknown','audioSemantics':'unknown'}
            inspection['coverage']=scope
            snapshot={'imageSnapshot':image_snapshot if image_urls else None,'videoSnapshot':checked_video['snapshotHash'],'videos':safe_videos}
            inspection['snapshotHash']=hashlib.sha256(json.dumps(snapshot,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()).hexdigest()
        available=next((p for p in self.providers() if p.get('id')==payload.provider),{})
        readable=[image['url'] for image in metadata if image.get('ok') is True]+frames
        visual_available=available.get('supports_vision') is not False and bool(readable)
        if prior:
            if inspection['snapshotHash']!=prior['snapshotHash']:
                raise HTTPException(409,'作品文件、任务或画布已变化，请重新检查；未保存旧评价')
            state=saved_turn.get('agent') or {}
            seen=state.get('lastModelInputImages') or []
            delivered=visual_available and state.get('modelCalls',0)>prior['modelCalls'] and all(context_rules.model_image_identity(url) in seen for url in readable)
            if video_urls and not all(video.get('frames') for video in video_metadata):delivered=False
            if args['status']!='unknown' and not delivered:
                raise HTTPException(409,'所选文本模型未实际读取本次图片或视频关键帧，只能登记无法判断')
            status=args['status']
            if inspection['hardStatus']=='needs_changes':status='needs_changes'
            elif inspection['hardStatus']=='unknown':status='unknown'
            if video_urls and status=='passed':status='unknown'
            review={'inspectionId':prior['id'],'status':status,'hardStatus':inspection['hardStatus'],
                    'visualStatus':args['status'],'findings':args['findings'],'limitations':args['limitations'],
                    'checks':inspection['checks'],'images':metadata,'snapshotHash':inspection['snapshotHash'],
                    'provider':payload.provider,'model':payload.model,'reviewedAt':int(time.time()*1000)}
            if video_urls:
                review.update(videos=inspection['videos'],coverage=inspection['coverage'])
                missing=['未提供可信的已确认视频要求与任务归属'] if not video_proposal else []
                review['limitations']=list(dict.fromkeys([*args['limitations'],'仅抽查有限时间戳关键帧，未核验全片连续性','音频语义无法判断',*missing]))
            return {'review':review}
        inspection.update(id=step_id,arguments=copy.deepcopy(args),modelCalls=(saved_turn.get('agent') or {}).get('modelCalls',0),
                          visualAvailable=visual_available)
        return {'images':readable if visual_available else [],'videos':[],'imageCount':len(metadata),'resultInspection':inspection,
                'note':'真实文件已检查；图片及带时间戳视频关键帧按报告顺序供下一次视觉输入，视频取样和音频语义有明确限制，不自动再生成' if visual_available else '已检查真实文件；文本模型无法读取图片或视频帧，视觉结论只能为无法判断'}
