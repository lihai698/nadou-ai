/* Shared workgroup state, layout and controls. Native canvas adapters own saves and execution. */
(function(root){
    'use strict';
    const isFrame = node => Boolean(node && node.groupMode === 'frame');
    const palette = ['', '#64748b', '#7c6c91', '#527c72', '#92734f', '#8c6068'];
    const tags = ['人物','场景','道具','风格参考','分镜图','参考图','首帧','尾帧','配音','音乐','成片'];
    const tagColors = ['#557bb1','#56876d','#a47d43','#8a6baa','#a06879','#548d96'];
    function tagLabel(value){return typeof value==='string'?value.replace(/[\u0000-\u001f]/g,'').trim().slice(0,16):'';}
    function tagColor(value){return tagColors[Array.from(tagLabel(value)).reduce((sum,ch)=>sum+ch.codePointAt(0),0)%tagColors.length];}
    function members(nodes, group){
        const seen = new Set([group?.id]), result = [];
        const visit = id => {const n=nodes.find(item=>item.id===id);if(!n||seen.has(id))return;seen.add(id);result.push(n);if(isFrame(n))(n.items||[]).forEach(visit);};
        (group?.items||[]).forEach(visit);return result;
    }
    function leaves(nodes, id){
        const n=nodes.find(item=>item.id===id);
        return isFrame(n)?members(nodes,n).filter(item=>!isFrame(item)).map(item=>item.id):[id];
    }
    // The stored graph keeps a single bus. Only consumers receive the expanded graph.
    function effectiveConnections(nodes, connections, graph=connections){
        const result=[],seen=new Set();
        for(const edge of connections||[]){
            let targets=leaves(nodes,edge.to);
            const targetNode=nodes.find(n=>n.id===edge.to);
            if(isFrame(targetNode))targets=targets.filter(id=>!['prompt','promptGroup','image','audio','output','shot-table','smart-shot-table'].includes(nodes.find(n=>n.id===id)?.type));
            const targetSet=new Set(targets);
            const roots=targets.filter(id=>!(graph||[]).some(c=>c.to===id&&targetSet.has(c.from)&&c.kind!=='story'));
            for(const from of leaves(nodes,edge.from))for(const to of (targets.length>1?(roots.length?roots:targets):targets)){
                if(from===to)continue;
                const key=from+'\0'+to+'\0'+(edge.kind||'flow');if(seen.has(key))continue;seen.add(key);
                result.push({...edge,from,to});
            }
        }
        return result;
    }
    function order(nodes, edges){
        const ids=new Set(nodes.map(n=>n.id)),out=[],done=new Set(),active=new Set();
        const visit=id=>{if(done.has(id))return;if(active.has(id))throw new Error('节点存在循环连线，请先断开循环依赖');active.add(id);edges.filter(c=>c.to===id&&ids.has(c.from)&&c.kind!=='story').forEach(c=>visit(c.from));active.delete(id);done.add(id);out.push(id);};
        nodes.slice().sort((a,b)=>(a.y-b.y)||(a.x-b.x)).forEach(n=>visit(n.id));return out;
    }
    // Keep a loop's complete chain together so its downstream consumes the same round.
    function executionPlan(ids, edges, resolveLoop){
        const batches=new Map(),owner=new Map();
        ids.forEach(id=>{const loop=resolveLoop(id),key=loop?'loop:'+loop.node.id:'node:'+id;owner.set(id,key);if(!batches.has(key))batches.set(key,{id:key,ids:[],loop,x:0,y:batches.size});batches.get(key).ids.push(id);});
        const dependencies=[];
        ids.forEach(id=>{const seen=new Set([id]);const visit=target=>{for(const edge of edges.filter(c=>c.to===target&&c.kind!=='story')){if(seen.has(edge.from))continue;seen.add(edge.from);if(owner.has(edge.from)&&owner.get(edge.from)!==owner.get(id))dependencies.push({from:owner.get(edge.from),to:owner.get(id)});else visit(edge.from);}};visit(id);});
        return order([...batches.values()],dependencies).map(id=>batches.get(id));
    }
    function bounds(nodes, rect){
        const rs=nodes.map(n=>{const r=rect(n);return {x:n.x||0,y:n.y||0,w:r.width||r.w||260,h:r.height||r.h||180};});
        if(!rs.length)return {x:0,y:0,w:300,h:200};
        const x=Math.min(...rs.map(r=>r.x)),y=Math.min(...rs.map(r=>r.y));
        return {x,y,w:Math.max(...rs.map(r=>r.x+r.w))-x,h:Math.max(...rs.map(r=>r.y+r.h))-y};
    }
    function fit(nodes, group, rect){
        const list=members(nodes,group);if(!list.length)return;
        const box=bounds(list,rect);Object.assign(group,{x:box.x-28,y:box.y-44,w:box.w+56,h:box.h+72});
    }
    function arrange(nodes, edges, kind, rect){
        if(!['grid','horizontal','vertical'].includes(kind))throw new Error('未知布局');
        const sequence=order(nodes,edges),byId=new Map(nodes.map(n=>[n.id,n]));
        const box=bounds(nodes,rect),gap=60;
        const sizes=new Map(nodes.map(n=>{const r=rect(n);return[n.id,{w:r.width||r.w||260,h:r.height||r.h||180}]}));
        const bands=[];
        if(kind==='grid'){
            const cols=Math.max(1,Math.ceil(Math.sqrt(nodes.length)));
            sequence.forEach((id,i)=>{const row=Math.floor(i/cols);(bands[row]||=[]).push(id);});
        }else sequence.forEach(id=>bands.push([id]));
        let axis=kind==='vertical'||kind==='grid'?box.y:box.x;
        for(const band of bands){
            if(!band)continue;let cross=kind==='vertical'||kind==='grid'?box.x:box.y,max=0;
            for(const id of band){const n=byId.get(id),s=sizes.get(id);n.x=Math.round(kind==='horizontal'?axis:cross);n.y=Math.round(kind==='horizontal'?cross:axis);cross+=(kind==='horizontal'?s.h:s.w)+gap;max=Math.max(max,kind==='horizontal'?s.w:s.h);}
            axis+=max+gap;
        }
    }
    function ungroup(nodes, connections, group){
        const expanded=effectiveConnections(nodes,connections.filter(c=>c.from===group.id||c.to===group.id),connections);
        const edges=connections.filter(c=>c.from!==group.id&&c.to!==group.id);
        expanded.forEach(c=>{if(!edges.some(e=>e.from===c.from&&e.to===c.to&&(e.kind||'flow')===(c.kind||'flow')))edges.push(c);});
        return {nodes:nodes.filter(n=>n.id!==group.id).map(n=>{
            if(Array.isArray(n.inputNodeIds)&&n.inputNodeIds.includes(group.id))n.inputNodeIds=[...new Set(n.inputNodeIds.flatMap(id=>id===group.id?leaves(nodes,group.id):[id]))];
            if(Array.isArray(n.items))n.items=n.items.filter(id=>id!==group.id);return n;
        }),connections:edges};
    }
    function createController(host){
        const doc=host.document;let overlay=null,activeDrag=null,popup=null,dialog=null,run=null;
        const getNodes=()=>host.nodes(),getEdges=()=>host.connections();
        const picked=()=>host.selectedIds().map(id=>getNodes().find(n=>n.id===id)).filter(Boolean);
        const selectedGroup=()=>{const p=picked();return p.length===1&&isFrame(p[0])?p[0]:null;};
        const contents=()=>selectedGroup()?members(getNodes(),selectedGroup()):picked();
        function icons(){host.icons?.();}
        function commit(){host.sync?.();host.render();host.save();}
        function group(){
            const list=picked();if(list.length<2)return host.notify('请先框选至少两个节点');
            if(list.some(n=>isFrame(n)))return host.notify('请先解组，再选择需要组合的节点');
            if(getNodes().some(n=>isFrame(n)&&(n.items||[]).some(id=>list.some(x=>x.id===id))))return host.notify('选中的节点已经属于工作组，请先解组');
            host.pushUndo();const n={id:host.uid('workgroup'),type:host.smart?'smart-group':'group',groupMode:'frame',title:'工作组',items:list.map(n=>n.id),images:[],created_at:Date.now()};
            fit(getNodes(),n,host.rect);host.setNodes([...getNodes(),n]);host.select([n.id]);commit();return n;
        }
        function dissolve(id){
            const g=getNodes().find(n=>n.id===id);if(!isFrame(g))return false;if(run)return host.notify('请先停止整组执行');
            host.pushUndo();const ids=members(getNodes(),g).map(n=>n.id),next=ungroup(getNodes(),getEdges(),g);
            const used=new Set();host.setNodes(next.nodes);host.setConnections(next.connections.map(c=>{const id=c.id&&!used.has(c.id)?c.id:host.uid('c');used.add(id);return {...c,id};}));host.select(ids);commit();return true;
        }
        function layout(kind){
            const list=contents();if(!list.length)return;
            try{order(list,effectiveConnections(getNodes(),getEdges()));host.pushUndo();arrange(list,effectiveConnections(getNodes(),getEdges()),kind,host.rect);const g=selectedGroup();if(g)fit(getNodes(),g,host.rect);closePopup();commit();}catch(e){host.notify(e.message);}
        }
        function closePopup(){popup?.remove();popup=null;}
        function menu(anchor,items){
            closePopup();popup=doc.createElement('div');popup.className='cw-menu';
            items.forEach(([label,action])=>{const b=doc.createElement('button');b.type='button';b.textContent=label;b.onclick=e=>{e.stopPropagation();action();};popup.append(b);});
            anchor.append(popup);
        }
        function button(label,icon,action){const b=doc.createElement('button');b.type='button';b.className='cw-button';b.innerHTML='<i data-lucide="'+icon+'"></i><span></span>';b.querySelector('span').textContent=label;b.onclick=e=>{e.stopPropagation();action(b);};return b;}
        function renderFrame(node){
            const el=doc.createElement('div');el.className=(host.smart?'image-node':'node')+' cw-frame';el.dataset.id=node.id;
            Object.assign(el.style,{left:node.x+'px',top:node.y+'px',width:node.w+'px',height:node.h+'px'});
            if(palette.includes(node.groupColor)&&node.groupColor)el.style.setProperty('--cw-color',node.groupColor);
            const name=doc.createElement('div');name.className='cw-name';name.textContent=node.title||'工作组';el.append(name);
            for(const side of ['in','out']){const p=doc.createElement('button');p.type='button';p.className=host.smart?'node-port port-'+side:'port '+side;p.dataset.port=side;p.setAttribute('aria-label',side==='out'?'工作组输出':'工作组输入');p.onmousedown=e=>startLink(e,side,node);el.append(p);}
            el.onmousedown=e=>{if(e.target.closest('button,input'))return;host.select([node.id]);startDrag(e,[node,...members(getNodes(),node)]);};
            el.onclick=e=>{e.stopPropagation();host.select([node.id]);host.selectionChanged();};
            name.ondblclick=e=>{e.stopPropagation();const input=doc.createElement('input');input.value=node.title||'工作组';name.replaceChildren(input);input.focus();let done=false;const save=()=>{if(done)return;done=true;if(input.value.trim()&&input.value.trim()!==node.title){host.pushUndo();node.title=input.value.trim().slice(0,80);host.save();}host.render();};input.onblur=save;input.onkeydown=e=>{e.stopPropagation();if(e.key==='Enter')save();if(e.key==='Escape'){done=true;host.render();}};};
            return el;
        }
        function render(){
            if(activeDrag)return;
            getNodes().filter(isFrame).forEach(g=>fit(getNodes(),g,host.rect));
            overlay?.remove();overlay=null;closePopup();
            host.world.querySelectorAll('.cw-frame').forEach(el=>{const node=getNodes().find(n=>n.id===el.dataset.id);if(isFrame(node))el.replaceWith(renderFrame(node));});
            renderTags();
            const list=picked(),g=selectedGroup();if(!host.active()||(!g&&list.length<2))return;
            const b=g?{x:g.x,y:g.y,w:g.w,h:g.h}:bounds(list,host.rect);
            overlay=doc.createElement('div');overlay.className='cw-overlay'+(g?' cw-group-controls':' cw-selection');
            Object.assign(overlay.style,{left:(b.x-(g?0:24))+'px',top:(b.y-(g?0:24))+'px',width:(b.w+(g?0:48))+'px',height:(b.h+(g?0:48))+'px'});
            if(!g){overlay.onmousedown=e=>{if(e.target.closest('button'))return;startDrag(e,list);};for(const side of ['in','out']){const p=doc.createElement('button');p.type='button';p.className='cw-total-port cw-'+side;p.setAttribute('aria-label',side==='out'?'框选统一输出':'框选统一输入');p.onmousedown=e=>startLink(e,side,null);overlay.append(p);}}
            const bar=doc.createElement('div');bar.className='cw-toolbar';bar.setAttribute('role','toolbar');bar.setAttribute('aria-label',g?'工作组工具栏':'框选工具栏');
            bar.onmousedown=e=>e.stopPropagation();bar.onclick=e=>e.stopPropagation();
            if(g){
                const color=button('颜色','palette',anchor=>{
                    closePopup();popup=doc.createElement('div');popup.className='cw-menu cw-color-menu';popup.setAttribute('aria-label','工作组颜色');
                    palette.forEach((value,i)=>{const swatch=doc.createElement('button'),label=['默认','灰蓝','灰紫','灰绿','暖灰','灰粉'][i];swatch.type='button';swatch.className='cw-swatch';swatch.title=label;swatch.setAttribute('aria-label',label);swatch.setAttribute('aria-pressed',String((g.groupColor||'')===value));swatch.style.setProperty('--cw-swatch',value||'var(--soft)');if(!value)swatch.classList.add('cw-swatch-default');swatch.onclick=e=>{e.stopPropagation();host.pushUndo();g.groupColor=value;closePopup();commit();};popup.append(swatch);});anchor.append(popup);
                });bar.append(color);
                bar.append(button(run?'停止执行':'整组执行',run?'square':'play',()=>execute(g)));
                bar.append(button('创建工作流','save',()=>workflow(g)));
                const transfer=button('拖到素材库','grip',()=>host.notify('按住此手柄，拖到独立素材库页面的工作流区域'));transfer.draggable=true;transfer.title='按住拖到素材库的工作流分类';
                transfer.onmousedown=e=>e.stopPropagation();
                transfer.ondragstart=e=>{e.stopPropagation();try{e.dataTransfer.setData(workflowDragType,JSON.stringify({version:1,origin:doc.location.origin,title:g.title||'工作组',payload:workflowSnapshot(g)}));e.dataTransfer.effectAllowed='copy';}catch(err){e.preventDefault();host.notify('无法拖出工作组：'+err.message);}};
                bar.append(transfer);
                bar.append(button('解组','ungroup',()=>dissolve(g.id)));
            }else bar.append(button('打组','group',group));
            bar.append(button('批量下载','download',()=>download()));
            bar.append(button('布局','layout-grid',anchor=>menu(anchor,[['宫格',()=>layout('grid')],['水平',()=>layout('horizontal')],['垂直',()=>layout('vertical')]])));
            overlay.append(bar);host.world.append(overlay);icons();
            updateViewport();
        }
        function updateViewport(){
            const bar=overlay?.querySelector('.cw-toolbar');if(!bar)return;
            const scale=host.scale();bar.style.transform='translateX(-50%) scale('+1/scale+')';bar.style.left='50%';bar.style.bottom='calc(100% + 36px)';
            const r=bar.getBoundingClientRect(),width=doc.documentElement.clientWidth,height=doc.documentElement.clientHeight;
            const dx=r.left<12?12-r.left:r.right>width-12?width-12-r.right:0;
            const dy=r.top<88?88-r.top:r.bottom>height-12?height-12-r.bottom:0;
            if(dx)bar.style.left='calc(50% + '+dx/scale+'px)';
            if(dy)bar.style.bottom='calc(100% + '+(36-dy/scale)+'px)';
        }
        function renderTags(){
            host.world.querySelectorAll(host.smart?'.image-node[data-id]':'.node[data-id]').forEach(el=>{
                el.querySelector(':scope > .cw-tag')?.remove();
                const node=getNodes().find(n=>n.id===el.dataset.id);if(!node||isFrame(node))return;
                const label=tagLabel(node.nodeTag),b=doc.createElement('button');b.type='button';b.className='cw-tag';b.textContent=label||'标签';b.title=label?'修改标签：'+label:'添加分类标签';b.setAttribute('aria-label',b.title);b.style.setProperty('--cw-tag-color',tagColor(label));
                b.onmousedown=e=>{e.preventDefault();e.stopPropagation();};
                b.onclick=e=>{e.stopPropagation();openTagMenu(b,node);};el.append(b);
            });
        }
        function openTagMenu(anchor,node){
            closePopup();const context=host.context(),position=anchor.getBoundingClientRect();
            popup=doc.createElement('div');popup.className='cw-menu cw-tag-menu';popup.setAttribute('role','dialog');popup.setAttribute('aria-label','节点分类标签');
            Object.assign(popup.style,{position:'fixed',left:Math.max(8,Math.min(position.left,doc.documentElement.clientWidth-210))+'px',top:Math.max(8,Math.min(position.bottom+6,doc.documentElement.clientHeight-360))+'px',zIndex:10000});
            popup.onmousedown=e=>e.stopPropagation();popup.onclick=e=>e.stopPropagation();
            const apply=value=>{if(host.context()!==context||!getNodes().includes(node)){closePopup();return;}const label=tagLabel(value);if(label!==tagLabel(node.nodeTag)){host.pushUndo();if(label)node.nodeTag=label;else delete node.nodeTag;host.save();}closePopup();host.render();};
            const choices=[...new Set([...tags,...getNodes().map(n=>tagLabel(n.nodeTag)).filter(Boolean)])];
            const list=doc.createElement('div');list.className='cw-tag-choices';choices.forEach(label=>{const b=doc.createElement('button');b.type='button';b.textContent=label;b.style.setProperty('--cw-tag-color',tagColor(label));b.setAttribute('aria-pressed',String(label===tagLabel(node.nodeTag)));b.onclick=()=>apply(label);list.append(b);});popup.append(list);
            const form=doc.createElement('form'),input=doc.createElement('input'),save=doc.createElement('button');input.maxLength=16;input.placeholder='自定义标签';input.setAttribute('aria-label','自定义标签');save.type='submit';save.textContent='添加';form.append(input,save);form.onsubmit=e=>{e.preventDefault();if(tagLabel(input.value))apply(input.value);};popup.append(form);
            for(const [label,action] of [['移除标签',()=>apply('')],['关闭',closePopup]]){const b=doc.createElement('button');b.type='button';b.textContent=label;b.onclick=action;popup.append(b);}doc.body.append(popup);
        }
        function startDrag(e,list){
            if(e.button!==0)return;e.preventDefault();e.stopPropagation();const origin={x:e.clientX,y:e.clientY};let changed=false;
            const context=host.context(),captured=list.map(n=>({n,x:n.x,y:n.y}));activeDrag=true;
            const move=ev=>{const dx=(ev.clientX-origin.x)/host.scale(),dy=(ev.clientY-origin.y)/host.scale();if(!changed&&Math.hypot(dx,dy)<3)return;if(!changed){host.pushUndo();changed=true;}captured.forEach(({n,x,y})=>{n.x=x+dx;n.y=y+dy;const el=host.world.querySelector('[data-id="'+CSS.escape(n.id)+'"]');if(el){el.style.left=n.x+'px';el.style.top=n.y+'px';}});if(overlay){const b=selectedGroup()||bounds(list,host.rect);overlay.style.left=(b.x-(selectedGroup()?0:24))+'px';overlay.style.top=(b.y-(selectedGroup()?0:24))+'px';}host.links();};
            const finish=ev=>{doc.removeEventListener('mousemove',move);doc.removeEventListener('mouseup',finish);activeDrag=false;if(host.context()!==context)return;const g=list.find(isFrame),target=changed&&g?host.workflowDropTarget?.(ev):null;if(target){captured.forEach(({n,x,y})=>{n.x=x;n.y=y;});host.render();workflow(g,target);return;}if(changed)host.save();host.render();};
            doc.addEventListener('mousemove',move);doc.addEventListener('mouseup',finish,{once:true});
        }
        function connect(sourceIds,targetIds,temporary,recordUndo=true){
            const pairs=[];for(const from of sourceIds)for(const to of targetIds)if(host.canConnect(from,to)&&!getEdges().some(c=>c.from===from&&c.to===to))pairs.push([from,to]);
            if(!pairs.length){host.notify('没有可连接的输入，请检查节点类型或循环连线');return false;}
            if(recordUndo)host.pushUndo();pairs.forEach(([a,b])=>host.connect(a,b));if(temporary)host.select([]);commit();return true;
        }
        function startLink(e,side,g){
            if(e.button!==0)return;e.preventDefault();e.stopPropagation();const ids=g?[g.id]:picked().map(n=>n.id),context=host.context();
            const path=doc.createElementNS('http://www.w3.org/2000/svg','svg');path.classList.add('cw-drag-line');const line=doc.createElementNS(path.namespaceURI,'path');path.append(line);doc.body.append(path);
            const move=ev=>{line.setAttribute('d','M'+e.clientX+','+e.clientY+' C'+(e.clientX+80)+','+e.clientY+' '+(ev.clientX-80)+','+ev.clientY+' '+ev.clientX+','+ev.clientY);};
            const finish=ev=>{doc.removeEventListener('mousemove',move);path.remove();if(host.context()!==context)return;const hit=doc.elementFromPoint(ev.clientX,ev.clientY)?.closest(host.smart?'.image-node':'.node');const target=hit?.dataset.id;
                if(target&&!ids.includes(target))return side==='out'?connect(ids,[target],!g):connect([target],ids,!g);
                if(target)return;
                closePopup();popup=doc.createElement('div');popup.className='cw-menu';Object.assign(popup.style,{position:'fixed',left:Math.min(ev.clientX,doc.documentElement.clientWidth-180)+'px',top:Math.min(ev.clientY,doc.documentElement.clientHeight-260)+'px',zIndex:10000});
                host.createOptions.forEach(([type,label])=>{const b=doc.createElement('button');b.type='button';b.textContent=label;b.onclick=event=>{event.stopPropagation();if(host.context()!==context){closePopup();return;}const saved=ids.slice();closePopup();host.pushUndo();const node=host.createNode(type,ev,{skipUndo:true});if(!node)return;side==='out'?connect(saved,[node.id],!g,false):connect([node.id],saved,!g,false);};popup.append(b);});const cancel=doc.createElement('button');cancel.type='button';cancel.textContent='取消';cancel.onclick=closePopup;popup.append(cancel);doc.body.append(popup);
            };doc.addEventListener('mousemove',move);doc.addEventListener('mouseup',finish,{once:true});
        }
        async function execute(g){
            if(run){run.stop=true;host.stop?.(g.id);host.notify('已请求停止，当前已提交任务按原任务状态处理');return;}
            const list=members(getNodes(),g);let ids;
            try{ids=order(list,effectiveConnections(getNodes(),getEdges())).filter(id=>host.runnable(getNodes().find(n=>n.id===id)));}catch(e){return host.notify(e.message);}
            if(!ids.length)return host.notify('组内没有配置好的生成节点');
            if(ids.some(id=>host.busy(getNodes().find(n=>n.id===id))))return host.notify('组内有运行中或提交状态待确认的任务，请先处理');
            const context=host.context();run={stop:false};const state=run;render();
            try{await host.execute(g,ids,state);if(!state.stop)host.notify('整组执行完成');}catch(e){host.notify('整组执行停止：'+(e.message||e));}finally{run=null;if(host.context()===context){host.render();host.save();}}
        }
        async function download(){
            const list=contents().flatMap(n=>isFrame(n)?members(getNodes(),n):[n]);const items=[],seen=new Set();
            for(const n of list){for(const ref of host.assets(n)||[]){if(!ref.url||seen.has(ref.url))continue;seen.add(ref.url);items.push(ref);}const text=host.text(n);if(text?.trim())items.push({kind:'text',text,name:(n.title||n.name||n.id)+'.txt'});}
            if(!items.length)return host.notify('选中节点还没有可下载的素材或提示词');
            try{const response=await host.fetch('/api/canvas-assets/download',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({items,filename:'画布素材.zip'})});if(!response.ok)throw new Error((await response.json()).detail||'下载失败');const blob=await response.blob(),url=URL.createObjectURL(blob),a=doc.createElement('a');a.href=url;a.download='画布素材.zip';doc.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);}catch(e){host.notify(e.message);}
        }
        function workflow(g,target={}){
            if(dialog?.isConnected)return;
            const context=host.context();
            dialog=showWorkflowDialog({...host,validate:()=>{if(host.context()!==context)throw new Error('画布已经切换，请重新选择工作组');}},{
                title:g.title,count:members(getNodes(),g).length,target,onClose:()=>{dialog=null;},payload:()=>workflowSnapshot(g)
            });
        }
        function workflowSnapshot(g){
            const list=[g,...members(getNodes(),g)],ids=new Set(list.map(n=>n.id));
            return JSON.parse(JSON.stringify(host.workflowPayload(list,getEdges().filter(c=>ids.has(c.from)&&ids.has(c.to)))));
        }
        return {group,dissolve,layout,render,renderFrame,connect,download,execute,updateViewport,active:()=>Boolean(activeDrag),fitAll:()=>getNodes().filter(isFrame).forEach(g=>fit(getNodes(),g,host.rect))};
    }
    // A native drag carries a detached snapshot, never a reference to a live canvas.
    const workflowDragType='application/x-nadou-workgroup+json';
    function readWorkflowDrag(transfer, origin){
        if(!Array.from(transfer?.types||[]).includes(workflowDragType))return null;
        const value=JSON.parse(transfer.getData(workflowDragType));
        const payload=value?.payload;
        if(value?.version!==1||value.origin!==origin||!Array.isArray(payload?.nodes)||!Array.isArray(payload?.connections)||!payload.nodes.length||!payload.nodes.some(isFrame))throw new Error('工作组数据无效，请从当前项目画布重新拖入');
        const ids=new Set(payload.nodes.map(n=>n.id));
        if(ids.size!==payload.nodes.length||payload.connections.some(e=>!ids.has(e.from)||!ids.has(e.to)))throw new Error('工作组连线数据不完整，请重新拖入');
        return value;
    }
    function showWorkflowDialog(host,options){
        const doc=host.document;
        const modal=doc.createElement('dialog');modal.className='cw-dialog';let previewUrl='';
        modal.innerHTML='<form><header class="cw-dialog-head"><span class="cw-dialog-icon"><i data-lucide="workflow"></i></span><div><h3>创建工作流</h3><p class="cw-dialog-summary"></p></div><button type="button" class="cw-dialog-close" data-cancel aria-label="关闭"><i data-lucide="x"></i></button></header><label class="cw-cover" title="点击上传工作流封面"><input name="cover" type="file" accept="image/*" aria-label="上传工作流封面"><img alt="工作流封面预览" hidden><span class="cw-cover-placeholder"><i data-lucide="image-plus"></i></span><span class="cw-cover-change"><i data-lucide="image-plus"></i></span></label><label class="cw-name-field">工作流名称<input name="name" required maxlength="80" autocomplete="off" placeholder="为这段创作流程起个名字"></label><p class="cw-dialog-destination"><i data-lucide="library"></i><span>保存至素材库 · 工作流管理</span></p><footer class="cw-dialog-actions"><button type="button" data-cancel>取消</button><button type="submit" class="cw-dialog-save">保存工作流<i data-lucide="arrow-right"></i></button></footer><p role="status" class="cw-dialog-status" aria-live="polite"></p></form>';
        const submit=modal.querySelector('[type="submit"]'),coverInput=modal.querySelector('[name="cover"]'),preview=modal.querySelector('.cw-cover img');
        const close=()=>{if(submit.disabled)return;if(previewUrl)URL.revokeObjectURL(previewUrl);modal.remove();options.onClose?.();};modal.querySelectorAll('[data-cancel]').forEach(b=>b.onclick=close);modal.addEventListener('cancel',e=>{e.preventDefault();close();});
        coverInput.onchange=()=>{if(previewUrl)URL.revokeObjectURL(previewUrl);previewUrl=coverInput.files[0]?URL.createObjectURL(coverInput.files[0]):'';preview.hidden=!previewUrl;preview.src=previewUrl;modal.querySelector('.cw-cover').classList.toggle('has-cover',Boolean(previewUrl));};
        modal.querySelector('[name="name"]').value=options.title||'工作组';modal.querySelector('.cw-dialog-summary').textContent=options.count+' 个节点 · 保存为可复用的创作流程';
        modal.querySelector('form').onsubmit=async e=>{e.preventDefault();const form=e.currentTarget;if(!form.reportValidity())return;const b=form.querySelector('[type="submit"]');b.disabled=true;const status=form.querySelector('[role="status"]');status.textContent='正在保存…';
            try{host.validate?.();const payload=options.payload(),name=form.elements.name.value.trim();let cover='';const file=form.elements.cover.files[0];if(file){const data=new FormData();data.append('files',file,file.name);const r=await host.fetch('/api/local-assets/upload',{method:'POST',body:data});const uploaded=await r.json();if(!r.ok||!uploaded.files?.[0]?.url)throw new Error('封面上传失败');cover=uploaded.files[0].url;}
                host.validate?.();const res=await host.fetch('/api/canvas-workflows/export-to-library',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...payload,...options.target,name,filename:name+'.zip',include_resources:true,cover_url:cover})});if(!res.ok)throw new Error((await res.json()).detail||'保存失败');const data=await res.json();host.libraryChanged?.(data);b.disabled=false;close();host.notify('工作流已保存到素材库');
            }catch(err){status.textContent=err.message;b.disabled=false;}
        };doc.body.append(modal);host.icons?.();modal.showModal();return modal;
    }
    const api={workflowDragType,readWorkflowDrag,showWorkflowDialog,isFrame,members,leaves,effectiveConnections,order,executionPlan,bounds,fit,arrange,ungroup,tagLabel,tagColor,createController};
    if(typeof module!=='undefined'&&module.exports)module.exports=api;root.CanvasWorkgroups=api;
})(typeof globalThis!=='undefined'?globalThis:window);
