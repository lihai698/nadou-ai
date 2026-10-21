/* Canvas input presentation and prompt request assembly: smart-prompt-request. Host supplies live state and effects. */
(function(root){
    'use strict';

function collectPromptParts(deps){
    const parts = [];
    const walk = node => {
        if(node.nodeType === deps.Node.TEXT_NODE){
            if(node.textContent) parts.push({type:'text', text:node.textContent});
            return;
        }
        if(node.nodeType !== deps.Node.ELEMENT_NODE) return;
        if(node.classList?.contains('mention-image-token')){
            let assetUris = {};
            try { assetUris = JSON.parse(node.dataset.assetUris || '{}') || {}; } catch(e) { assetUris = {}; }
            const kind = node.dataset.kind || 'image';
            parts.push({type:'image', kind, url:node.dataset.url || '', name:node.dataset.name || (kind === 'audio' ? '音频' : '图片'), nodeId:node.dataset.nodeId || '', imageIndex:Number(node.dataset.imageIndex || 0), asset_uris:assetUris});
            return;
        }
        if(node.tagName === 'BR'){
            parts.push({type:'text', text:'\n'});
            return;
        }
        const blockTags = new Set(['DIV','P','LI','SECTION','ARTICLE','HEADER','FOOTER','BLOCKQUOTE']);
        const isBlock = node !== deps.promptInput && blockTags.has(node.tagName);
        if(isBlock && parts.length && parts[parts.length - 1]?.text && !/\n$/.test(parts[parts.length - 1].text)) parts.push({type:'text', text:'\n'});
        node.childNodes.forEach(walk);
        if(isBlock) parts.push({type:'text', text:'\n'});
    };
    deps.promptInput.childNodes.forEach(walk);
    return parts;
}

function originalPromptTextFromParts(deps, parts){
    let text = '';
    (parts || []).forEach(part => {
        if(part.type === 'text'){
            text += part.text || '';
            return;
        }
        if(part.type === 'image') text += `@${part.name || '图片'}`;
    });
    return text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function buildPromptRequest(deps, node, overrideDefaultImages=null, consumeDefault=false, ctx=deps.smartLoopContext){
    const parts = collectPromptParts(deps);
    const originalPrompt = originalPromptTextFromParts(deps, parts);
    const blockedRefs = deps.blockedInputRefKeys(node);
    const hasOverrideImages = Array.isArray(overrideDefaultImages);
    const filteredDefaultImages = (hasOverrideImages ? overrideDefaultImages : deps.defaultReferenceImagesFor(node, consumeDefault, ctx))
        .filter(img => !blockedRefs.has(deps.inputRefKey(img)));
    const defaultRefs = deps.uniqueReferenceImages(filteredDefaultImages);
    const refs = defaultRefs.map((img, index) => ({...img, role:`image_${index + 1}`}));
    let hasMentionToken = false;
    const refMap = new Map();
    refs.forEach((img, index) => refMap.set(img.url, index + 1));
    let body = '';
    parts.forEach(part => {
        if(part.type === 'text'){
            body += part.text;
            return;
        }
        if(!part.url) return;
        hasMentionToken = true;
        const mentionedKey = deps.inputRefKey(part);
        if(blockedRefs.has(mentionedKey)){
            body += `@${part.name || '图片'}`;
            return;
        }
        if(!refMap.has(part.url)){
            if(refs.length >= deps.SMART_REFERENCE_IMAGE_MAX){
                body += `@${part.name || '图片'}`;
                return;
            }
            refMap.set(part.url, refs.length + 1);
            refs.push({url:part.url, name:part.name || `图${refs.length + 1}`, nodeId:part.nodeId, imageIndex:part.imageIndex, kind:part.kind || 'image', asset_uris:part.asset_uris || {}, role:`image_${refs.length + 1}`});
        }
        body += `图${refMap.get(part.url)}`;
    });
    body = body.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    const groupPrompt = deps.isSmartGroupNode(node) ? deps.textForNode(node, ctx).trim() : '';
    // 分镜视频使用自己的视频草稿；级联传来的图片提示词不能混入视频请求。
    const inputPrompt = node?.shotTableOrigin?.stage==='video'&&node.shotTableOrigin.inlineOutput ? '' : deps.inputPromptTextFor(node, ctx).trim();
    if(groupPrompt || inputPrompt) body = [groupPrompt, inputPrompt, body].filter(Boolean).join('\n\n');
    if(!body && deps.settings.engine === 'runninghub'){
        body = deps.rhDefaultPromptSuggestion();
    }
    const displayPrompt = originalPrompt || body;
    if(hasMentionToken && refs.length){
        const mapText = refs.map((img, i) => `图${i + 1}：${img.name || `图片${i + 1}`}`).join('\n');
        return {
            prompt:`${deps.tr('smart.refMapHeader')}\n${mapText}\n\n${deps.tr('smart.refUserNeed')}\n${body}`,
            displayPrompt,
            refs:refs.map((img, index) => ({url:img.url, name:img.name || `图${index + 1}`, kind:img.kind || deps.mediaKindForItem(img), asset_uris:img.asset_uris || {}, role:`image_${index + 1}`})),
            mentioned:true
        };
    }
    return {
        prompt:body,
        displayPrompt,
        refs:refs.map((img, index) => ({url:img.url, name:img.name || `图${index + 1}`, kind:img.kind || deps.mediaKindForItem(img), asset_uris:img.asset_uris || {}, role:`image_${index + 1}`})),
        mentioned:false
    };
}

function buildPromptRequestForNode(deps, node, defaultImages, ctx=deps.smartLoopContext){
    const oldHtml = deps.promptInput.innerHTML;
    deps.loadNodePromptDraftToInput(node);
    try {
        return buildPromptRequest(deps, node, defaultImages, false, ctx);
    } finally {
        deps.promptInput.innerHTML = oldHtml;
    }
}

    const api={collectPromptParts, originalPromptTextFromParts, buildPromptRequest, buildPromptRequestForNode};
    if(typeof module!=='undefined' && module.exports) module.exports=api;
    root.SmartPromptRequest=api;
})(typeof globalThis!=='undefined' ? globalThis : window);
