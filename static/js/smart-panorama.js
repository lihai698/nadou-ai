/* Smart panorama and media preview responsibility: smart-panorama. Host supplies live state and effects. */
(function(root){
    'use strict';

function panoramaRatioValue(deps){
    const preset = deps.PANORAMA_RATIO_PRESETS[deps.panoramaState.ratio];
    if(preset) return preset;
    return {
        w:Math.max(1, Number(deps.panoramaState.customW) || 16),
        h:Math.max(1, Number(deps.panoramaState.customH) || 9)
    };
}

function panoramaResolutionValue(deps){
    const longSide = 1536;
    const ratio = panoramaRatioValue(deps);
    const aspect = ratio.w / Math.max(1, ratio.h);
    if(aspect >= 1){
        return {w:longSide, h:Math.max(1, Math.round(longSide / aspect))};
    }
    return {w:Math.max(1, Math.round(longSide * aspect)), h:longSide};
}

function panoramaSource(deps){
    const editing = deps.currentEditImage();
    const image = editing.image || {};
    if(deps.mediaKindForItem(image) !== 'image') return '';
    return deps.displayMediaUrl(image.url ? image : (image.url || ''));
}

function panoramaFallbackSource(deps){
    const image = deps.currentEditImage().image || {};
    return image?.url ? deps.proxiedMediaUrl(image) : '';
}

function isLikelyPanoramaImage(deps, node, image, naturalW=0, naturalH=0){
    if(deps.mediaKindForItem(image || {}) !== 'image') return false;
    const text = [
        image?.name,
        image?.title,
        node?.title,
        node?.runPrompt,
        node?.runModelPrompt,
        node?.promptDraftText,
        node?.runSettings?.ratio,
        node?.runSettings?.msRatio,
        node?.runSettings?.size,
        node?.runSettings?.customSize
    ].filter(Boolean).join(' ');
    if(/(?:360|全景|环景|panorama|equirect|spherical|vr\b)/i.test(text)) return true;
    const w = Number(naturalW || image?.natural_w || image?.width || image?.w || 0);
    const h = Number(naturalH || image?.natural_h || image?.height || image?.h || 0);
    if(!(w > 0 && h > 0)) return false;
    const aspect = w / h;
    return aspect >= 1.9 && aspect <= 2.1;
}

async function ensurePanoramaRenderer(deps){
    const canvas = deps.document.getElementById('panoramaCanvas');
    if(!canvas) return false;
    if(!deps.panoramaState.three){
        deps.panoramaState.threeLoadPromise = deps.panoramaState.threeLoadPromise || import('/static/vendor/js/three-0.160.0.module.js?v=2026.05.30');
        deps.panoramaState.three = await deps.panoramaState.threeLoadPromise;
    }
    const THREE = deps.panoramaState.three;
    if(!deps.panoramaState.renderer){
        deps.panoramaState.renderer = new THREE.WebGLRenderer({
            canvas,
            antialias:true,
            alpha:false,
            preserveDrawingBuffer:true
        });
        deps.panoramaState.renderer.setPixelRatio(1);
        deps.panoramaState.renderer.outputColorSpace = THREE.SRGBColorSpace;
    }
    if(!deps.panoramaState.scene){
        deps.panoramaState.scene = new THREE.Scene();
        deps.panoramaState.camera = new THREE.PerspectiveCamera(deps.panoramaState.fov, 16 / 9, 1, 1200);
        const geometry = new THREE.SphereGeometry(500, 96, 64);
        geometry.scale(-1, 1, 1);
        const material = new THREE.MeshBasicMaterial({color:0xffffff});
        deps.panoramaState.sphere = new THREE.Mesh(geometry, material);
        deps.panoramaState.scene.add(deps.panoramaState.sphere);
    }
    return Boolean(deps.panoramaState.renderer && deps.panoramaState.scene && deps.panoramaState.camera && deps.panoramaState.sphere);
}

function applyPanoramaTexture(deps, img){
    const THREE = deps.panoramaState.three;
    if(!THREE || !deps.panoramaState.sphere || !img?.naturalWidth || !img?.naturalHeight) return false;
    if(deps.panoramaState.texture){
        deps.panoramaState.texture.dispose?.();
        deps.panoramaState.texture = null;
    }
    const texture = new THREE.Texture(img);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    deps.panoramaState.texture = texture;
    deps.panoramaState.sphere.material.map = texture;
    deps.panoramaState.sphere.material.needsUpdate = true;
    return true;
}

function drawPanoramaFrame(deps){
    const canvas = deps.document.getElementById('panoramaCanvas');
    const img = deps.panoramaState.image;
    const {renderer, scene, camera, sphere, three:THREE} = deps.panoramaState;
    if(!deps.panoramaState.enabled || !canvas || !renderer || !scene || !camera || !sphere || !THREE || !img?.naturalWidth || !img?.naturalHeight) return false;
    const width = Math.max(1, canvas.width);
    const height = Math.max(1, canvas.height);
    renderer.setSize(width, height, false);
    camera.fov = Math.max(35, Math.min(100, deps.panoramaState.fov));
    camera.aspect = width / Math.max(1, height);
    camera.updateProjectionMatrix();
    const pitch = Math.max(-85, Math.min(85, deps.panoramaState.pitch));
    const phi = THREE.MathUtils.degToRad(90 - pitch);
    const theta = THREE.MathUtils.degToRad(deps.panoramaState.yaw);
    const target = new THREE.Vector3(
        500 * Math.sin(phi) * Math.cos(theta),
        500 * Math.cos(phi),
        500 * Math.sin(phi) * Math.sin(theta)
    );
    camera.position.set(0, 0, 0);
    camera.lookAt(target);
    renderer.render(scene, camera);
    return true;
}

function renderPanoramaFrame(deps){
    if(!drawPanoramaFrame(deps)) return;
    deps.panoramaState.animationId = deps.requestAnimationFrame((...args)=>renderPanoramaFrame(deps, ...args));
}

function startPanoramaLoop(deps){
    if(deps.panoramaState.animationId) deps.cancelAnimationFrame(deps.panoramaState.animationId);
    deps.panoramaState.animationId = deps.requestAnimationFrame((...args)=>renderPanoramaFrame(deps, ...args));
}

function stopPanoramaLoop(deps){
    if(deps.panoramaState.animationId) deps.cancelAnimationFrame(deps.panoramaState.animationId);
    deps.panoramaState.animationId = 0;
}

function resizePanoramaViewer(deps){
    const stage = deps.document.getElementById('panoramaStage');
    const frame = deps.document.getElementById('previewFrame');
    const canvas = deps.document.getElementById('panoramaCanvas');
    if(!stage) return;
    const ratio = panoramaRatioValue(deps);
    const aspect = Math.max(0.08, Math.min(12, ratio.w / ratio.h));
    const maxW = Math.max(260, Math.min(1180, deps.window.innerWidth - 116));
    const maxH = Math.max(220, Math.min(780, deps.window.innerHeight - 220));
    let w = maxW;
    let h = w / aspect;
    if(h > maxH){
        h = maxH;
        w = h * aspect;
    }
    w = Math.max(160, Math.round(w));
    h = Math.max(160, Math.round(h));
    stage.style.width = `${w}px`;
    stage.style.height = `${h}px`;
    stage.style.aspectRatio = `${ratio.w} / ${ratio.h}`;
    if(frame){
        frame.style.width = `${w}px`;
        frame.style.height = `${h}px`;
    }
    if(canvas){
        const render = panoramaResolutionValue(deps);
        const nextW = Math.max(1, Math.round(render.w));
        const nextH = Math.max(1, Math.round(render.h));
        if(canvas.width !== nextW) canvas.width = nextW;
        if(canvas.height !== nextH) canvas.height = nextH;
    }
}

function disposePanoramaTexture(deps){
    if(deps.panoramaState.texture){
        deps.panoramaState.texture.dispose?.();
        deps.panoramaState.texture = null;
    }
    if(deps.panoramaState.sphere?.material){
        deps.panoramaState.sphere.material.map = null;
        deps.panoramaState.sphere.material.needsUpdate = true;
    }
    deps.panoramaState.image = null;
}

async function loadPanoramaTexture(deps, src, allowFallback=true){
    if(!src) return;
    const token = ++deps.panoramaState.loadToken;
    const stage = deps.document.getElementById('panoramaStage');
    stage?.classList.remove('ready');
    let ready = false;
    try {
        ready = await ensurePanoramaRenderer(deps);
    } catch(e) {
        deps.console.warn('panorama renderer init failed', e);
        ready = false;
    }
    if(!ready){
        stage?.classList.add('ready');
        deps.toast(deps.tr('smart.panoramaLoadFailed'));
        return;
    }
    if(token !== deps.panoramaState.loadToken) return;
    const img = new deps.Image();
    img.crossOrigin = 'anonymous';
    const fallback = allowFallback ? panoramaFallbackSource(deps) : '';
    const done = () => {
        if(token !== deps.panoramaState.loadToken){
            return;
        }
        disposePanoramaTexture(deps);
        if(!applyPanoramaTexture(deps, img)){
            stage?.classList.add('ready');
            deps.toast(deps.tr('smart.panoramaLoadFailed'));
            return;
        }
        deps.panoramaState.image = img;
        deps.panoramaState.loadedSrc = src;
        stage?.classList.add('ready');
        resizePanoramaViewer(deps);
        startPanoramaLoop(deps);
    };
    const fail = () => {
        if(token !== deps.panoramaState.loadToken) return;
        if(fallback && fallback !== src){
            loadPanoramaTexture(deps, fallback, false);
            return;
        }
        stage?.classList.add('ready');
        deps.toast(deps.tr('smart.panoramaLoadFailed'));
    };
    img.onload = done;
    img.onerror = fail;
    img.src = src;
    if(img.complete && img.naturalWidth) done();
}

function refreshPanoramaControls(deps){
    const controls = deps.document.getElementById('panoramaControls');
    const custom = deps.document.getElementById('panoramaCustomRatio');
    if(controls) controls.style.display = deps.panoramaState.enabled ? 'inline-flex' : 'none';
    if(custom) custom.style.display = deps.panoramaState.enabled && deps.panoramaState.ratio === 'custom' ? 'inline-flex' : 'none';
    deps.document.querySelectorAll('[data-panorama-ratio]').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.panoramaRatio === deps.panoramaState.ratio);
    });
    const w = deps.document.getElementById('panoramaRatioW');
    const h = deps.document.getElementById('panoramaRatioH');
    if(w && deps.document.activeElement !== w) w.value = deps.panoramaState.customW;
    if(h && deps.document.activeElement !== h) h.value = deps.panoramaState.customH;
}

function setPanoramaEnabled(deps, enabled){
    const next = Boolean(enabled);
    if(deps.panoramaState.enabled === next) return;
    deps.panoramaState.enabled = next;
    const stage = deps.document.getElementById('previewStage');
    const pano = deps.document.getElementById('panoramaStage');
    const currentImg = deps.document.getElementById('previewCurrentImage');
    const compareLayer = deps.document.getElementById('previewCompareLayer');
    const compareHandle = deps.document.getElementById('previewCompareHandle');
    const toggle = deps.document.getElementById('panoramaToggleBtn');
    const exportBtn = deps.document.getElementById('panoramaExportBtn');
    const compareToggle = deps.document.getElementById('compareToggleBtn');
    const compareThumbs = deps.document.getElementById('compareThumbs');
    const previewTools = deps.document.getElementById('imagePreviewTools');
    stage?.classList.toggle('panorama-on', next);
    previewTools?.classList.toggle('panorama-tools-on', next);
    if(pano) pano.style.display = next ? 'block' : 'none';
    if(currentImg) currentImg.style.display = next ? 'none' : 'block';
    if(compareLayer && next) compareLayer.style.display = 'none';
    if(compareHandle && next) compareHandle.style.display = 'none';
    if(toggle) toggle.classList.toggle('active', next);
    if(exportBtn) exportBtn.style.display = next ? 'inline-flex' : 'none';
    if(compareToggle) compareToggle.style.display = next ? 'none' : 'inline-flex';
    if(compareThumbs && next){ compareThumbs.style.display = 'none'; compareThumbs.innerHTML = ''; }
    deps.previewCompareOn = next ? false : deps.previewCompareOn;
    if(next){
        deps.previewPan = {x:0, y:0};
        deps.previewZoom = 1.0;
        deps.applyPreviewTransform();
        resizePanoramaViewer(deps);
        loadPanoramaTexture(deps, panoramaSource(deps));
        deps.updatePreviewMetaHint(deps.tr('smart.panoramaHint'));
    } else {
        stopPanoramaLoop(deps);
        const frame = deps.document.getElementById('previewFrame');
        if(frame){ frame.style.width = ''; frame.style.height = ''; }
        deps.refreshComparePanel();
    }
    refreshPanoramaControls(deps);
    deps.updateZoomLabel();
}

function togglePanoramaPreview(deps){
    const image = deps.currentEditImage().image || {};
    if(deps.mediaKindForItem(image) !== 'image') return;
    setPanoramaEnabled(deps, !deps.panoramaState.enabled);
}

async function exportPanoramaFrame(deps){
    if(!deps.panoramaState.enabled) return;
    const canvasEl = deps.document.getElementById('panoramaCanvas');
    if(!canvasEl){ deps.toast(deps.tr('smart.panoramaExportFailed')); return; }
    try {
        if(!drawPanoramaFrame(deps)) throw new Error(deps.tr('smart.panoramaExportFailed'));
        const blob = await new Promise(resolve => canvasEl.toBlob(resolve, 'image/png'));
        if(!blob) throw new Error(deps.tr('smart.panoramaExportFailed'));
        const editing = deps.currentEditImage();
        const rawName = editing.image?.name || deps.fileNameFromUrl(editing.image?.url || '') || 'panorama';
        const base = String(rawName).replace(/\.[a-z0-9]{2,8}$/i, '') || 'panorama';
        const filename = deps.safeExportFileName(`${base}-panorama.png`, 'panorama.png');
        const uploaded = await deps.uploadFiles([new deps.File([blob], filename, {type:'image/png'})]);
        const frame = uploaded[0];
        if(!frame?.url) throw new Error(deps.tr('smart.panoramaExportFailed'));
        frame.kind = 'image';
        frame.natural_w = canvasEl.width;
        frame.natural_h = canvasEl.height;
        const rect = editing.node ? deps.nodeRect(editing.node) : null;
        const point = rect
            ? {x:rect.x + rect.width + 240, y:rect.y + rect.height / 2}
            : deps.viewportCenter();
        deps.pushUndo();
        const newNode = deps.createImageNodeAt(point, [frame], {select:true, skipUndo:true});
        deps.selectedIds = [];
        deps.selectedImage = {nodeId:newNode.id, index:0};
        deps.render();
        deps.scheduleSave();
        deps.toast(deps.tr('smart.panoramaExportDone'));
    } catch(e) {
        deps.toast((e.message || deps.tr('smart.panoramaExportFailed')).slice(0, 120));
    }
}

function resetPanoramaView(deps){
    deps.panoramaState.fov = 75;
    deps.panoramaState.yaw = 0;
    deps.panoramaState.pitch = 0;
    resizePanoramaViewer(deps);
    deps.updateZoomLabel();
}

function disposePanoramaPreview(deps){
    stopPanoramaLoop(deps);
    disposePanoramaTexture(deps);
    deps.panoramaState.enabled = false;
    deps.panoramaState.drag = null;
    deps.panoramaState.loadedSrc = '';
    deps.panoramaState.loadToken++;
    const stage = deps.document.getElementById('panoramaStage');
    stage?.classList.remove('ready');
    if(stage) stage.style.display = 'none';
    deps.document.getElementById('previewStage')?.classList.remove('panorama-on', 'panning');
    deps.document.getElementById('imagePreviewTools')?.classList.remove('panorama-tools-on');
    deps.document.getElementById('panoramaControls')?.style.setProperty('display', 'none');
    deps.document.getElementById('panoramaToggleBtn')?.classList.remove('active');
    deps.document.getElementById('panoramaExportBtn')?.style.setProperty('display', 'none');
}

function applyPanoramaRatio(deps, value){
    deps.panoramaState.ratio = deps.PANORAMA_RATIO_PRESETS[value] ? value : 'custom';
    refreshPanoramaControls(deps);
    resizePanoramaViewer(deps);
}

    const api={panoramaRatioValue, panoramaResolutionValue, panoramaSource, panoramaFallbackSource, isLikelyPanoramaImage, ensurePanoramaRenderer, applyPanoramaTexture, drawPanoramaFrame, renderPanoramaFrame, startPanoramaLoop, stopPanoramaLoop, resizePanoramaViewer, disposePanoramaTexture, loadPanoramaTexture, refreshPanoramaControls, setPanoramaEnabled, togglePanoramaPreview, exportPanoramaFrame, resetPanoramaView, disposePanoramaPreview, applyPanoramaRatio};
    if(typeof module!=='undefined' && module.exports) module.exports=api;
    root.SmartPanorama=api;
})(typeof globalThis!=='undefined' ? globalThis : window);
