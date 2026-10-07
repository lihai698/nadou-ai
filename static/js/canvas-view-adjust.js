/* Angle/light prompt rules adapted from BeefTV v1.7.11 (MIT).
 * Copyright (c) 2026 @beefnoode and BeefTV contributors, basketikun, ddcat.
 * See docs/third-party/BeefTV-view-adjust-LICENSE.txt. UI and adapters are native nadou ai. */
(function(root){
    'use strict';
    const angleDefaults={horizontalAngle:45,pitchAngle:0,cameraDistance:4.8,wideAngle:false};
    const lightDefaults={azimuth:0,elevation:0,brightness:50,rimLight:false,stylePreset:'',smartMode:true,lightColor:'#ffffff',description:''};
    const templateKeys=['consistencyPrompt','presetPrompt','smartDesc','lightDirectionPrompt','brightnessPrompt','rimLightPrompt','lightColorPrompt','lightingMeta'];
    const defaultLightingTemplate=templateKeys.map(key=>'{{'+key+'}}').join(', ');
    const angles=[['正面',0,0],['左侧',-90,0],['右侧',90,0],['背面',180,0],['俯拍',0,60],['仰拍',0,-60]];
    const lights=[['左侧',270,0],['顶部',0,80],['右侧',90,0],['前方',0,0],['底部',0,-80],['后方',180,0]];
    const styles=[
        ['','自定义',''],['overexposed','过曝胶片','overexposed film aesthetic, high-key lighting, washed out highlights, soft diffused light, vintage film look'],
        ['blueBacklight','蓝色逆光','dramatic backlighting, blue rim light, cool color temperature, silhouette with colored edges, ethereal atmosphere'],
        ['rembrandt','伦勃朗光','Rembrandt lighting, 45-degree angle key light, dramatic chiaroscuro, painterly shadows, classical portraiture'],
        ['cyberpunk','赛博朋克','cyberpunk neon lighting, synthetic glow, futuristic atmosphere, vibrant cyan and magenta neon'],
        ['sunset','落日迷幻','golden hour lighting, warm sunset tones, long shadow, romantic atmosphere, Kodachrome colors'],
        ['mysterious','神秘暗调','low-key noir lighting, deep shadows, mysterious mood, film noir style, high contrast cinematic'],
        ['goldenHour','黄金时刻','golden hour photography, warm soft light, beautiful catchlights, lens flare, magical golden glow'],
        ['nolanGrey','诺兰冷灰','Christopher Nolan cinematography, IMAX quality, desaturated cold palette, teal and grey grading']
    ];
    const clamp=(value,min,max,fallback)=>Number.isFinite(Number(value))?Math.max(min,Math.min(max,Number(value))):fallback;
    function normalize(kind,input={}){
        if(kind==='angle')return {horizontalAngle:clamp(input.horizontalAngle,-180,180,45),pitchAngle:clamp(input.pitchAngle,-60,60,0),cameraDistance:clamp(input.cameraDistance,1,10,4.8),wideAngle:input.wideAngle===true,previewMode:input.previewMode==='skybox'?'skybox':'camera'};
        return {azimuth:clamp(input.azimuth,0,360,0),elevation:clamp(input.elevation,-90,90,0),brightness:clamp(input.brightness,0,100,50),rimLight:input.rimLight===true,smartMode:input.smartMode!==false,previewMode:input.previewMode==='front'?'front':'perspective',promptTemplate:typeof input.promptTemplate==='string'?input.promptTemplate.slice(0,12000):defaultLightingTemplate,stylePreset:styles.some(s=>s[0]===input.stylePreset)?input.stylePreset:'',lightColor:/^#[0-9a-f]{6}$/i.test(input.lightColor||'')?input.lightColor:'#ffffff',description:String(input.description||'').trim().slice(0,2000)};
    }
    function angleLabel(p){return `AI 多角度：${p.horizontalAngle===0?'正面视角':p.horizontalAngle>0?`向右旋转 ${p.horizontalAngle} 度`:`向左旋转 ${Math.abs(p.horizontalAngle)} 度`}，${p.pitchAngle===0?'水平视角':p.pitchAngle>0?`俯视 ${p.pitchAngle} 度`:`仰视 ${Math.abs(p.pitchAngle)} 度`}，镜头距离 ${p.cameraDistance.toFixed(1)}，${p.wideAngle?'广角':'标准'}镜头`;}
    function direction(azimuth,elevation){
        if(elevation>=60)return 'strong top-down key light from directly above';
        if(elevation<=-60)return 'strong upward uplight from directly below the subject';
        const a=((azimuth%360)+360)%360;
        const side=a>=345||a<=15?'coming from the front':a<75?'coming from the front-right at 45 degrees':a<=105?'coming from the right side, pure side-light':a<165?'coming from the back-right, creating rim and edge light':a<=195?'coming from directly behind the subject, strong backlight and silhouette':a<255?'coming from the back-left, creating rim and edge light':a<=285?'coming from the left side, pure side-light':'coming from the front-left at 45 degrees';
        return `main key light ${side}${elevation>=30?', tilted downward from above':elevation<=-30?', tilted upward from below':''}`;
    }
    function build(kind,input){
        const p=normalize(kind,input);
        if(kind==='angle')return {params:p,title:angleLabel(p),prompt:`基于参考图重新生成同一主体的新视角，保持主体、颜色、材质和画面风格一致，不要只做透视变形。${angleLabel(p)}。`};
        const preset=styles.find(s=>s[0]===p.stylePreset),position=lights.find(s=>s[1]===p.azimuth&&s[2]===p.elevation);
        const title=`AI 打光：${preset?.[0]?preset[1]:position?`主光${position[0]}`:`主光 ${p.azimuth}°/${p.elevation}°`}${p.brightness!==50?`，亮度 ${p.brightness}%`:''}${p.rimLight?'，轮廓光':''}${p.lightColor.toLowerCase()!=='#ffffff'?`，光色 ${p.lightColor}`:''}`;
        const consistencyPrompt=[
            'this is a lighting-only edit of the reference image: same scene, same people, same action, same clothing, same background, only the lighting changes',
            'the following instructions describe how light falls on the subject, they are not new objects to add to the scene',
            'do not add any lamp, spotlight, light fixture, reflector, softbox, torch, candle, or photography equipment into the image',
            'preserve identity, face, outfit, hairstyle, body pose, and the background layout from the input image',
            'if multiple people are present, preserve the same number of people and their spatial relationship',
            'only change lighting direction, light color, brightness, shadows, contrast, and mood'
        ].join(', ');
        const values={consistencyPrompt,presetPrompt:preset?.[2]||'',smartDesc:p.smartMode?p.description:'',lightDirectionPrompt:direction(p.azimuth,p.elevation),
            brightnessPrompt:p.brightness>=75?'high-key, bright and well-lit scene, lifted exposure':p.brightness<=25?'low-key, dim and moody scene, deep shadows, reduced exposure':p.brightness===50?'':p.brightness>50?'slightly brighter exposure':'slightly darker exposure',
            rimLightPrompt:p.rimLight?'add clear rim light and edge highlight along the silhouette':'',
            lightColorPrompt:p.lightColor.toLowerCase()!=='#ffffff'?`key light color temperature tinted toward ${p.lightColor}`:'',
            lightingMeta:`[lighting azimuth:${p.azimuth}° elevation:${p.elevation}° brightness:${p.brightness}%${p.rimLight?' rim:on':''}]`};
        const template=p.promptTemplate.includes('{{consistencyPrompt}}')?p.promptTemplate:`{{consistencyPrompt}}, ${p.promptTemplate}`;
        const prompt=template.replace(/\{\{(\w+)\}\}/g,(_,key)=>values[key]||'').split(',').map(part=>part.trim()).filter(Boolean).join(', ');
        return {params:p,title,prompt};
    }
    // Use exactly the native canvas API image model list. No third-party model catalog.
    function configuredModels(providers,modelsForProvider){
        return (providers||[]).flatMap(provider=>(modelsForProvider(provider)||[]).map(model=>({providerId:provider.id,model,label:`${provider.name||provider.id} · ${model}`})));
    }
    function escape(value){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
    function menuHtml(){return '<details class="view-adjust-menu"><summary aria-label="视角调整"><i data-lucide="camera"></i><span>视角调整</span><i data-lucide="chevron-down"></i></summary><div class="view-adjust-options"><button type="button" data-view-adjust="angle"><span>多角度</span></button><button type="button" data-view-adjust="lighting"><span>打光</span></button></div></details>';}
    let dialog=null;
    function close(){if(dialog){dialog.remove();dialog=null;}}
    function dragParams(kind,start,dx,dy){
        if(kind==='angle')return normalize(kind,{...start,horizontalAngle:Math.round(start.horizontalAngle+dx/1.8),pitchAngle:Math.round(start.pitchAngle+(start.previewMode==='skybox'?dy:-dy)/2.2)});
        return normalize(kind,{...start,azimuth:Math.round(((start.azimuth+dx*1.5)%360+360)%360),elevation:Math.round(start.elevation-dy)});
    }
    function sceneHtml(kind){
        if(kind==='lighting')return '<canvas class="view-adjust-sphere" width="280" height="280" tabindex="0" aria-label="拖动调整主光源方向"></canvas>';
        const rings=Array.from({length:12},(_,i)=>`<span class="view-adjust-ring" style="transform:rotateY(${i*15}deg)"></span><span class="view-adjust-ring" style="transform:rotateX(${i*15}deg)"></span>`).join('');
        return `<div class="view-adjust-angle-scene" tabindex="0" aria-label="拖动调整相机视角">
            <div class="view-adjust-orbit"><div data-va-orbit>${rings}</div></div>
            <div class="view-adjust-subject"><img alt="当前源图片" draggable="false"></div>
            <div class="view-adjust-camera"><div data-va-camera><span><i data-lucide="camera"></i></span></div></div>
            <div class="view-adjust-cube" data-va-cube>${['正面','背面','右侧','左侧','顶面','底面'].map((label,i)=>`<div class="view-adjust-face face-${i}">${i===0?'<img alt="天空盒原图" draggable="false">':label}</div>`).join('')}</div>
            ${[['up','向上俯仰','chevron-up'],['down','向下俯仰','chevron-down'],['left','向左环绕','chevron-left'],['right','向右环绕','chevron-right']].map(([key,label,icon])=>`<button type="button" data-va-direction="${key}" aria-label="${label}"><i data-lucide="${icon}"></i></button>`).join('')}
        </div>`;
    }
    function drawLightScene(canvas,image,p){
        const ctx=canvas.getContext('2d'),r=116,cx=140,cy=140;
        const css=getComputedStyle(canvas),text=css.getPropertyValue('--text').trim(),soft=css.getPropertyValue('--soft').trim();
        const a=p.azimuth*Math.PI/180,e=p.elevation*Math.PI/180;
        const x=cx+r*Math.sin(a)*(p.previewMode==='front'?.85:Math.cos(e)),y=cy-r*Math.sin(e)*(p.previewMode==='front'?.85:1);
        ctx.clearRect(0,0,280,280);ctx.save();ctx.beginPath();ctx.arc(cx,cy,r,0,Math.PI*2);ctx.fillStyle=soft;ctx.fill();ctx.clip();
        ctx.strokeStyle=text;ctx.globalAlpha=.15;
        if(p.previewMode==='front'){
            for(let i=-2;i<=2;i++){const d=i*r/3;ctx.beginPath();ctx.moveTo(cx+d,cy-r);ctx.lineTo(cx+d,cy+r);ctx.moveTo(cx-r,cy+d);ctx.lineTo(cx+r,cy+d);ctx.stroke();}
        }else{
            for(let lat=-75;lat<=75;lat+=15){const t=lat*Math.PI/180;ctx.beginPath();ctx.ellipse(cx,cy-r*Math.sin(t),r*Math.cos(t),r*Math.cos(t)*.22,0,0,Math.PI*2);ctx.stroke();}
            for(let i=0;i<8;i++){ctx.beginPath();ctx.ellipse(cx,cy,r*Math.abs(Math.cos(i*Math.PI/4)),r,0,0,Math.PI*2);ctx.stroke();}
        }
        ctx.globalAlpha=1;
        if(image.complete&&image.naturalWidth){const scale=Math.min(108/image.naturalWidth,112/image.naturalHeight);const w=image.naturalWidth*scale,h=image.naturalHeight*scale;ctx.drawImage(image,cx-w/2,cy-h/2,w,h);}
        const glow=ctx.createRadialGradient(x,y,0,x,y,r*1.4);glow.addColorStop(0,p.lightColor);glow.addColorStop(1,'transparent');ctx.fillStyle=glow;ctx.globalAlpha=.1+p.brightness/250;ctx.fillRect(0,0,280,280);ctx.globalAlpha=1;ctx.restore();
        ctx.strokeStyle=text;ctx.globalAlpha=.25;ctx.beginPath();ctx.arc(cx,cy,r,0,Math.PI*2);ctx.stroke();ctx.globalAlpha=1;
        ctx.shadowColor=p.lightColor;ctx.shadowBlur=15;ctx.fillStyle=p.lightColor;ctx.beginPath();ctx.arc(x,y,6,0,Math.PI*2);ctx.fill();ctx.shadowBlur=0;ctx.strokeStyle=text;ctx.stroke();
        canvas.setAttribute('aria-description',`主光方位 ${p.azimuth} 度，俯仰 ${p.elevation} 度。方向示意，非生成结果。`);
    }
    function open(options){
        close();
        const kind=options.kind==='angle'?'angle':'lighting',isAngle=kind==='angle',models=options.models||[];
        let p=normalize(kind,options.initial?.params||{}),submitted=false,busy=false,imageReady=false;
        const el=document.createElement('div');el.className='view-adjust-modal';el.setAttribute('role','dialog');el.setAttribute('aria-modal','true');el.setAttribute('aria-label',isAngle?'多角度编辑':'打光编辑');
        const presets=isAngle?angles:lights;
        const presetButtons=()=>presets.map((a,i)=>`<button type="button" data-va-preset="${i}">${a[0]}</button>`).join('');
        const segmented=(key,items)=>`<div class="view-adjust-segment">${items.map(([value,label])=>`<button type="button" data-va-segment="${key}" data-value="${value}">${label}</button>`).join('')}</div>`;
        const ranges=isAngle?[['horizontalAngle','水平环绕',-180,180,1,'°'],['pitchAngle','垂直俯仰',-60,60,1,'°'],['cameraDistance','景别缩放',1,10,.1,'']]:[['azimuth','光线方位',0,360,1,'°'],['elevation','光线俯仰',-90,90,1,'°'],['brightness','亮度',0,100,1,'%']];
        const renderRange=([key,label,min,max,step])=>`<label class="view-adjust-range"><span>${label}</span><input aria-label="${label}" type="range" data-va-key="${key}" min="${min}" max="${max}" step="${step}"><output data-va-output="${key}"></output></label>`;
        const rangeHtml=isAngle?ranges.map(renderRange).join(''):renderRange(ranges[2])+`<details class="view-adjust-prompt"><summary>精确调整光线方向</summary>${ranges.slice(0,2).map(renderRange).join('')}</details>`;
        el.innerHTML=`<div class="view-adjust-panel"><div class="view-adjust-head"><strong><i data-lucide="${isAngle?'camera':'sun'}"></i>${isAngle?'多角度编辑器':'打光效果'}</strong><button type="button" data-va-close aria-label="关闭视角调整"><i data-lucide="x"></i></button></div>
            <div class="view-adjust-content">${isAngle?`<div class="view-adjust-tabs"><span data-va-custom title="参数不匹配常用角度时显示自定义">自定义</span>${presetButtons()}</div>`:''}
            <div class="view-adjust-body"><div class="view-adjust-source">
                ${!isAngle?segmented('previewMode',[['perspective','透视'],['front','正面']]):''}
                ${sceneHtml(kind)}
                <p>${isAngle?'拖动场景或点方向箭头调整视角':'拖动光源球调整方位和俯仰'} · 示意预览</p>
            </div><div class="view-adjust-controls">
                ${isAngle?segmented('previewMode',[['skybox','天空盒'],['camera','摄像头']]):'<label class="view-adjust-check"><input type="checkbox" data-va-key="smartMode">智能模式</label>'}
                <span class="view-adjust-label">${isAngle?'常用角度':'主光源'}</span><div class="view-adjust-presets">${presetButtons()}</div>${rangeHtml}
                ${isAngle?`<div class="view-adjust-inline"><span class="view-adjust-label">镜头</span>${segmented('wideAngle',[['false','标准'],['true','广角']])}</div>`:'<div class="view-adjust-inline"><label class="view-adjust-check"><input type="checkbox" data-va-key="rimLight">轮廓光</label><label>光线颜色 <input type="color" data-va-key="lightColor" aria-label="光线颜色"></label></div>'}

                <label class="view-adjust-field">API 图片模型<select data-va-model aria-label="API 图片模型">${models.length?models.map((model,index)=>`<option value="${index}">${escape(model.label)}</option>`).join(''):'<option value="">尚未配置，创建节点后可在 API 设置中添加</option>'}</select></label>
                ${!isAngle?'<label class="view-adjust-field">智能模式描述<textarea data-va-key="description" maxlength="2000" rows="2" placeholder="简单描述你想要实现的打光效果，或者情绪风格"></textarea></label>':''}
            </div></div>
            ${!isAngle?`<div class="view-adjust-light-extras"><span class="view-adjust-label">光效预设 · 点击已选预设可取消</span><div class="view-adjust-style-grid">${styles.slice(1).map(s=>`<button type="button" data-va-style="${s[0]}" aria-label="${s[1]}"><div class="view-adjust-style-image"><img alt="${s[1]}光效示意" draggable="false"></div><span>${s[1]}</span></button>`).join('')}</div><p class="view-adjust-note">完整展示原图的光效示意，实际效果以模型生成结果为准。</p></div>`:''}
            <div class="view-adjust-result"><div class="view-adjust-summary" data-va-summary></div><details class="view-adjust-prompt view-adjust-result-prompt"><summary>查看生成提示词</summary><textarea readonly aria-label="生成提示词" rows="4"></textarea><p class="view-adjust-note">创建带提示词、原图参考和所选模型的 API 节点；之后可在节点中更换模型并运行。</p></details></div>
            <p class="view-adjust-status" role="status"></p></div>
            <div class="view-adjust-foot"><button type="button" data-va-reset><i data-lucide="rotate-ccw"></i>${isAngle?'重置':'重置参数'}</button>${!isAngle?'<button type="button" data-va-copy><i data-lucide="copy"></i>复制提示词</button><button type="button" data-va-template><i data-lucide="file-pen-line"></i>设置提示词</button>':''}<button type="button" data-va-close>取消</button><button type="button" class="view-adjust-primary" data-va-generate disabled><i data-lucide="sparkles"></i>创建 API 节点</button></div></div>`;
        dialog=el;document.body.appendChild(el);el.querySelector('.view-adjust-panel').dataset.kind=kind;
        const image=new Image(),createButton=el.querySelector('[data-va-generate]'),status=el.querySelector('[role="status"]'),modelSelect=el.querySelector('[data-va-model]');
        const sourceUrl=options.source.previewUrl||options.source.url;
        el.querySelectorAll('img').forEach(img=>img.src=sourceUrl);
        status.textContent='正在加载原图…';
        image.onload=()=>{imageReady=true;if(!busy&&!submitted){createButton.disabled=false;status.textContent='';}sync();};
        image.onerror=()=>{imageReady=false;createButton.disabled=true;status.textContent='原图加载失败，请检查图片后重新打开。';};
        image.src=sourceUrl;
        ['pointerdown','mousedown','click','wheel'].forEach(type=>el.addEventListener(type,e=>e.stopPropagation()));

        const preferred=models.findIndex(model=>model.providerId===options.initial?.selection?.providerId&&model.model===options.initial?.selection?.model);if(preferred>=0)modelSelect.value=String(preferred);
        function sync(activeInput=null){
            const compiled=build(kind,p);p=compiled.params;
            el.querySelectorAll('[data-va-key]').forEach(input=>{if(input===activeInput)return;const value=p[input.dataset.vaKey];if(input.type==='checkbox')input.checked=value;else input.value=value;});
            ranges.forEach(([key,,,,,suffix])=>el.querySelector(`[data-va-output="${key}"]`).textContent=key==='cameraDistance'?`${p[key].toFixed(1)} · ${p[key]<=3?'近景':p[key]>=7?'全景':'中景'}`:`${p[key]}${suffix}`);
            el.querySelector('[aria-label="生成提示词"]').value=compiled.prompt;
            const active=presets.findIndex(a=>a[1]===(isAngle?p.horizontalAngle:p.azimuth)&&a[2]===(isAngle?p.pitchAngle:p.elevation));
            el.querySelectorAll('[data-va-preset]').forEach(b=>b.setAttribute('aria-pressed',String(Number(b.dataset.vaPreset)===active)));
            el.querySelector('[data-va-custom]')?.setAttribute('aria-pressed',String(active<0));
            el.querySelectorAll('[data-va-segment]').forEach(b=>b.setAttribute('aria-pressed',String(String(p[b.dataset.vaSegment])===b.dataset.value)));
            el.querySelectorAll('[data-va-style]').forEach(b=>b.setAttribute('aria-pressed',String(p.stylePreset===b.dataset.vaStyle)));
            el.querySelector('[data-va-summary]').textContent=isAngle?`当前视角 · ${presets[active]?.[0]||'自定义'} · ${p.horizontalAngle}° / ${p.pitchAngle}° · ${p.cameraDistance.toFixed(1)} ${p.cameraDistance<=3?'近景':p.cameraDistance>=7?'全景':'中景'}`:compiled.title;
            if(isAngle){
                const scene=el.querySelector('.view-adjust-angle-scene');scene.dataset.mode=p.previewMode;
                const scale=p.cameraDistance<=3?.78:p.cameraDistance>=7?1:.88;
                el.querySelector('[data-va-orbit]').style.transform=`rotateY(${p.horizontalAngle}deg) rotateX(${p.pitchAngle}deg)`;
                const a=p.horizontalAngle*Math.PI/180,t=p.pitchAngle*Math.PI/180;
                el.querySelector('[data-va-camera]').style.transform=`translate3d(${75*Math.sin(a)*Math.cos(t)}px,${-75*Math.sin(t)}px,${75*Math.cos(a)*Math.cos(t)}px)`;
                el.querySelector('[data-va-cube]').style.transform=`scale(${scale}) rotateX(${-p.pitchAngle}deg) rotateY(${p.horizontalAngle}deg)`;
                el.querySelector('.view-adjust-subject').style.transform=`translate(-50%,-50%) scale(${scale})`;
                scene.setAttribute('aria-description',`${p.previewMode==='skybox'?'天空盒':'摄像头'} · 水平 ${p.horizontalAngle} 度，俯仰 ${p.pitchAngle} 度`);
            }else{
                el.querySelector('[data-va-key="description"]').disabled=busy||submitted||!p.smartMode;
                drawLightScene(el.querySelector('canvas'),image,p);
            }
            return compiled;
        }
        function draft(){options.onDraft?.({params:{...p},selection:models[Number(modelSelect.value)]||null});}
        function update(){sync();draft();}
        el.querySelectorAll('[data-va-key]').forEach(input=>input.addEventListener('input',()=>{p[input.dataset.vaKey]=input.type==='checkbox'?input.checked:input.type==='range'?Number(input.value):input.value;sync(input);draft();}));
        el.querySelectorAll('[data-va-preset]').forEach(button=>button.onclick=()=>{const a=presets[Number(button.dataset.vaPreset)];if(isAngle){p.horizontalAngle=a[1];p.pitchAngle=a[2];}else{p.azimuth=a[1];p.elevation=a[2];}update();});
        el.querySelectorAll('[data-va-segment]').forEach(button=>button.onclick=()=>{p[button.dataset.vaSegment]=button.dataset.vaSegment==='wideAngle'?button.dataset.value==='true':button.dataset.value;update();});
        el.querySelectorAll('[data-va-style]').forEach(button=>button.onclick=()=>{p.stylePreset=p.stylePreset===button.dataset.vaStyle?'':button.dataset.vaStyle;update();});
        el.querySelectorAll('[data-va-direction]').forEach(button=>button.onclick=()=>{const d=button.dataset.vaDirection;if(d==='up'||d==='down')p.pitchAngle+=d==='up'?5:-5;else p.horizontalAngle+=d==='right'?5:-5;update();});
        const scene=el.querySelector(isAngle?'.view-adjust-angle-scene':'canvas');let drag=null;
        scene.onpointerdown=event=>{if(busy||submitted||event.target.closest('button'))return;event.preventDefault();drag={id:event.pointerId,x:event.clientX,y:event.clientY,params:{...p}};scene.setPointerCapture(event.pointerId);};
        scene.onpointermove=event=>{if(!drag||drag.id!==event.pointerId)return;p=dragParams(kind,drag.params,event.clientX-drag.x,event.clientY-drag.y);update();};
        const endDrag=event=>{if(drag?.id!==event.pointerId)return;drag=null;if(scene.hasPointerCapture(event.pointerId))scene.releasePointerCapture(event.pointerId);};
        scene.onpointerup=endDrag;scene.onpointercancel=endDrag;
        scene.onkeydown=event=>{const movement={ArrowLeft:[-9,0],ArrowRight:[9,0],ArrowUp:[0,-11],ArrowDown:[0,11]}[event.key];if(!movement||busy||submitted)return;event.preventDefault();p=dragParams(kind,p,...movement);update();};
        modelSelect.onchange=draft;
        el.querySelector('[data-va-reset]').onclick=()=>{const template=p.promptTemplate,mode=p.previewMode;p=normalize(kind,isAngle?{...angleDefaults,previewMode:mode}:{...lightDefaults,promptTemplate:template});update();};
        el.querySelectorAll('[data-va-close]').forEach(b=>b.onclick=()=>{if(!busy)close();});
        el.addEventListener('keydown',e=>{e.stopPropagation();if(e.key==='Escape'&&!busy){if(el.querySelector('.view-adjust-template-modal'))el.querySelector('.view-adjust-template-modal').remove();else close();}});
        el.querySelector('[data-va-copy]')?.addEventListener('click',async()=>{
            try{await navigator.clipboard.writeText(build(kind,p).prompt);status.textContent='打光提示词已复制。';}
            catch{const text=el.querySelector('[aria-label="生成提示词"]');text.closest('details').open=true;text.focus();text.select();status.textContent='无法自动复制，请复制已选中的提示词。';}
        });
        el.querySelector('[data-va-template]')?.addEventListener('click',()=>{
            const modal=document.createElement('div');modal.className='view-adjust-template-modal';modal.setAttribute('role','dialog');modal.setAttribute('aria-label','设置打光默认提示词');
            modal.innerHTML=`<div class="view-adjust-template-panel"><div class="view-adjust-head"><strong>设置打光默认提示词</strong><button type="button" data-template-close aria-label="关闭提示词设置"><i data-lucide="x"></i></button></div><div class="view-adjust-content view-adjust-template-content"><p class="view-adjust-template-info">这里修改的是系统自动附加的默认打光描述骨架，不包含当前选择的亮度、方向、颜色等参数值。面板参数会自动替换进去；智能模式描述通过 {{smartDesc}} 加入。主体一致性限制始终保留。</p><div class="view-adjust-template-info"><span class="view-adjust-label">可用占位符</span><div class="view-adjust-template-tokens">${templateKeys.map(key=>`<code>{{${key}}}</code>`).join('')}</div></div><label class="view-adjust-field">提示词模板<textarea aria-label="打光提示词模板" rows="7" maxlength="12000" spellcheck="false"></textarea></label><p class="view-adjust-template-info">默认模板：<span>${escape(defaultLightingTemplate)}</span></p></div><div class="view-adjust-foot"><button type="button" data-template-reset><i data-lucide="rotate-ccw"></i>恢复默认</button><button type="button" data-template-close>关闭</button><button type="button" class="view-adjust-primary" data-template-save>保存</button></div></div>`;
            el.appendChild(modal);const input=modal.querySelector('textarea');input.value=p.promptTemplate;
            input.oninput=()=>{p.promptTemplate=input.value;update();};
            modal.querySelector('[data-template-reset]').onclick=()=>{p.promptTemplate=defaultLightingTemplate;input.value=p.promptTemplate;update();};
            const closeTemplate=()=>{modal.remove();el.querySelector('[data-va-template]').focus();};
            modal.querySelectorAll('[data-template-close]').forEach(b=>b.onclick=closeTemplate);
            modal.querySelector('[data-template-save]').onclick=()=>{p.promptTemplate=input.value;update();status.textContent='打光提示词模板已保存。';closeTemplate();};
            root.lucide?.createIcons();input.focus();
        });
        createButton.onclick=async()=>{
            if(busy||submitted||!imageReady)return;
            busy=true;el.querySelectorAll('button,input,select,textarea').forEach(control=>control.disabled=true);status.textContent='正在创建并保存 API 节点…';
            try{
                if(!options.isAlive())throw new Error('原图片已删除或改变，请重新打开。');
                const result=await options.onSubmit({...sync(),kind,selection:models[Number(modelSelect.value)]||null});
                submitted=true;
                status.textContent=result?.message||'API 节点已创建，提示词和原图已关联。';
                if(result?.saved!==false && dialog===el)close();
            }
            catch(error){status.textContent=error.message||'提交失败';}
            finally{busy=false;el.querySelectorAll('button,input,select,textarea').forEach(control=>control.disabled=submitted&&!control.matches('[data-va-close]'));if(!isAngle)el.querySelector('[data-va-key="description"]').disabled=submitted||!p.smartMode;createButton.disabled=submitted||!imageReady;}
        };
        sync();root.lucide?.createIcons();el.querySelector('[data-va-close]').focus();
    }
    const api={normalize,build,configuredModels,menuHtml,open,close,dragParams,defaultLightingTemplate,isOpen:()=>Boolean(dialog)};
    if(typeof module!=='undefined'&&module.exports)module.exports=api;
    else root.CanvasViewAdjust=api;
})(typeof window!=='undefined'?window:globalThis);
