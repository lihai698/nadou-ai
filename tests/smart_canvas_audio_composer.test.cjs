const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=readFileSync(path.join(__dirname,'../static/js/smart-canvas.js'),'utf8');
const start=source.indexOf('function positionComposerForNode(');
const end=source.indexOf('\n}',start)+2;
assert(start>=0&&end>start,'positionComposerForNode must be present and complete');

test('smart audio composer clears the rendered player, actions and task warning',()=>{
    const composer={style:{}};
    const context=vm.createContext({composer,CSS:{escape:x=>x},
        world:{querySelector:()=>({offsetHeight:285,querySelector:()=>({})})},
        nodeRect:()=>({x:780,y:120,width:288,height:150})});
    vm.runInContext(source.slice(start,end),context);
    vm.runInContext('positionComposerForNode({id:"audio"})',context);
    assert.equal(composer.style.top,'419px');
    assert.equal(composer.style.width,'540px');
    assert.equal(composer.style.left,'654px');
});

test('image composer uses the existing image dimensions',()=>{
    const composer={style:{}};
    const context=vm.createContext({composer,CSS:{escape:x=>x},
        world:{querySelector:()=>({offsetHeight:285,querySelector:()=>null})},
        nodeRect:()=>({x:780,y:120,width:288,height:150})});
    vm.runInContext(source.slice(start,end),context);
    vm.runInContext('positionComposerForNode({id:"image"})',context);
    assert.equal(composer.style.top,'284px');
});
