/* Native browser drag between isolated canvas and library pages; no model calls. */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_PATH||'playwright');
const workspace=process.argv[2];if(!workspace)throw new Error('Pass the isolated verification workspace');
(async()=>{
    const browser=await chromium.launch({channel:'msedge',headless:true});
    try{
        for(const c of JSON.parse(fs.readFileSync(path.join(workspace,'cases.json'),'utf8'))){
            const context=await browser.newContext({viewport:{width:1440,height:1000}});
            const page=await context.newPage(),library=await context.newPage(),errors=[];
            for(const p of [page,library])p.on('pageerror',e=>errors.push(e.message));
            await page.goto(c.url);await page.waitForSelector('.cw-tag');
            await page.evaluate(()=>document.addEventListener('dragstart',event=>{
                event.target.addEventListener('dragstart',e=>{window.nativeWorkflowDrag={trusted:e.isTrusted,items:Array.from(e.dataTransfer.types).map(mimeType=>({mimeType,data:e.dataTransfer.getData(mimeType)})),dragOperationsMask:1};},{once:true});
            },true));
            await page.evaluate(smart=>{
                nodes=[
                    {id:'p',type:smart?'smart-prompt':'prompt',x:120,y:160,w:260,h:200,text:'书店门口，暖色电影灯光',nodeTag:'人物'},
                    {id:'i',type:smart?'smart-image':'image',x:450,y:160,w:260,h:200,...(smart?{images:[{url:'/assets/output/creative-flow-old.png'}]}:{url:'/assets/output/creative-flow-old.png'})},
                    {id:'p2',type:smart?'smart-prompt':'prompt',x:120,y:440,w:280,h:180,text:'镜头缓慢推近，人物抬头微笑'},
                    {id:'i2',type:smart?'smart-image':'image',x:450,y:440,w:220,h:210,...(smart?{images:[{url:'/assets/output/creative-flow-result.png'}]}:{url:'/assets/output/creative-flow-result.png'})}
                ];
                if(smart)canvas.connections=[];else connections=[];
                viewport={x:0,y:0,scale:0.8};applyViewport();render();
                if(smart){selectedIds=nodes.map(n=>n.id);selectedId='';syncSelectionUi();}
                else{selected.clear();nodes.forEach(n=>selected.add(n.id));refreshSelectionVisuals();}
            },c.kind==='smart');
            await page.getByRole('button',{name:'打组',exact:true}).click();
            const original=await page.evaluate(()=>JSON.stringify(nodes));
            await library.goto(new URL('/static/asset-manager.html',c.url).href);
            await library.locator('[data-tab=workflows]').click();await library.locator('#workflowDrop').waitFor();
            const target=await context.newCDPSession(library);
            const nativeDrag=async()=>{
                await page.bringToFront();
                await page.evaluate(smart=>{const g=nodes.find(n=>n.groupMode==='frame');if(smart){selectedIds=[];selectedId=g.id;syncSelectionUi();}else{selected.clear();selected.add(g.id);refreshSelectionVisuals();}},c.kind==='smart');
                await page.waitForTimeout(400);
                const handle=page.getByRole('button',{name:'拖到素材库',exact:true});
                await page.evaluate(()=>{window.nativeWorkflowDrag=null;});
                const box=await handle.boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2+40,box.y+box.height/2+12,{steps:8});
                await page.waitForFunction(()=>window.nativeWorkflowDrag);
                const data=await page.evaluate(()=>window.nativeWorkflowDrag);assert.equal(data.trusted,true,'source must use a real browser dragstart');delete data.trusted;
                await page.keyboard.press('Escape');await page.mouse.up();
                await library.bringToFront();const destination=await library.locator('#workflowDrop').boundingBox();
                for(const type of ['dragEnter','dragOver','drop'])await target.send('Input.dispatchDragEvent',{type,x:destination.x+destination.width/2,y:destination.y+destination.height/2,data});
                await library.locator('.cw-dialog').waitFor();
                assert.equal(await page.evaluate(()=>JSON.stringify(nodes)),original,'dragging to another window must not move or mutate the group');
            };
            // Cancel must not produce any export or library mutation.
            let exports=0;library.on('request',r=>{if(r.url().endsWith('/api/canvas-workflows/export-to-library')&&r.method()==='POST')exports++;});
            await nativeDrag();await library.getByRole('button',{name:'取消',exact:true}).click();assert.equal(exports,0);
            await nativeDrag();await library.locator('.cw-dialog [name=name]').fill('跨窗口验收-'+c.kind);
            await library.locator('.cw-dialog [name=cover]').setInputFiles(path.join(workspace,'data/media/output/creative-flow-old.png'));
            await library.screenshot({path:path.join(workspace,c.kind+'-cross-window-save.png')});
            const response=library.waitForResponse(r=>r.url().endsWith('/api/canvas-workflows/export-to-library')&&r.request().method()==='POST');
            await library.getByRole('button',{name:'保存工作流',exact:true}).click();
            const saved=await response;assert.ok(saved.ok(),await saved.text());const data=await saved.json();
            await library.locator('.cw-dialog').waitFor({state:'detached'});assert.equal(exports,1);assert.ok(data.item.cover_url);
            const body=saved.request().postDataJSON();assert.equal(body.category_id,'workflows');assert.equal(body.library_id,'default');
            assert.equal(body.nodes.length,5);assert.ok(body.nodes.some(n=>n.nodeTag==='人物'));assert.ok(body.nodes.some(n=>n.groupMode==='frame'));
            assert.equal(await page.evaluate(()=>JSON.stringify(nodes)),original);
            await library.reload();await library.locator('[data-tab=workflows]').click();
            await library.getByText('跨窗口验收-'+c.kind,{exact:true}).first().waitFor();
            // Confirm the saved snapshot can be referenced back into this same canvas.
            await page.reload();await page.waitForSelector('.cw-tag');
            await page.locator(c.kind==='smart'?'#assetToggle':'#canvasAssetToggle').click();
            if(c.kind==='smart')await page.locator('[data-asset-tab=workflow]').click();else await page.locator('#canvasAssetCategorySelect').selectOption('workflows');
            const before=await page.evaluate(()=>nodes.length);
            const card=page.locator((c.kind==='smart'?'.workflow-asset-item':'.canvas-asset-item')+'[data-asset-id="'+data.item.id+'"]');await card.waitFor();await card.dblclick();
            await page.waitForFunction(n=>nodes.length===n,before+5);
            const ids=await page.evaluate(()=>nodes.map(n=>n.id));assert.equal(new Set(ids).size,ids.length);
            assert.deepEqual(errors,[]);console.log(c.kind+': native cross-window drag, cancel, cover save, refresh and reuse passed');
            await context.close();
        }
    }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
