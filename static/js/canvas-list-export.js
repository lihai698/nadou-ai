// canvas-list-export.js — Canvas list download helpers.
// The page owns canvas state and status UI; this module owns JSON/ZIP export.
(function attachCanvasListExport(global){
    'use strict';

    const ZIP_ENCODER = new TextEncoder();
    let ZIP_CRC_TABLE = null;

    function translate(context, zh, en){
        if(typeof context?.translate === 'function') return context.translate(zh, en);
        return global.StudioI18n?.lang?.() === 'en' ? en : zh;
    }

    function setStatus(context, text){
        if(typeof context?.setStatus === 'function') context.setStatus(text);
    }

    function currentCanvas(context){
        return typeof context?.getCanvas === 'function' ? context.getCanvas() : context?.canvas;
    }

    function safeExportBase(name, fallback = 'canvas'){
        return String(name || fallback).replace(/[\\/:*?"<>|]+/g, '_').trim().slice(0, 60) || fallback;
    }

    function collectCanvasResourceUrls(value, out = [], seen = new Set()){
        if(value == null) return out;
        if(typeof value === 'string'){
            const text = value.trim();
            if(isCanvasResourceUrl(text) && !seen.has(text)){
                seen.add(text);
                out.push(text);
            }
            return out;
        }
        if(Array.isArray(value)){
            value.forEach(item => collectCanvasResourceUrls(item, out, seen));
            return out;
        }
        if(typeof value === 'object') Object.values(value).forEach(item => collectCanvasResourceUrls(item, out, seen));
        return out;
    }

    function isCanvasResourceUrl(url){
        return url.startsWith('/assets/') || url.startsWith('/output/') || /^https?:\/\//i.test(url);
    }

    function exportResourceName(url, index, used){
        let name = '';
        try {
            const parsed = new URL(url, global.location?.origin || 'http://localhost');
            name = decodeURIComponent(parsed.pathname.split('/').filter(Boolean).pop() || '');
        } catch(e) {
            name = String(url || '').split(/[?#]/)[0].split('/').pop() || '';
        }
        name = safeExportBase(name || `resource-${String(index + 1).padStart(3, '0')}`, `resource-${index + 1}`);
        if(!/\.[a-z0-9]{1,8}$/i.test(name)) name += '.bin';
        let finalName = `resources/${name}`;
        const dot = finalName.lastIndexOf('.');
        const stem = dot > 0 ? finalName.slice(0, dot) : finalName;
        const ext = dot > 0 ? finalName.slice(dot) : '';
        let suffix = 2;
        while(used.has(finalName)){
            finalName = `${stem}-${suffix}${ext}`;
            suffix++;
        }
        used.add(finalName);
        return finalName;
    }

    async function fetchResourceBytes(url){
        const res = await global.fetch(url);
        if(!res.ok) throw new Error(`HTTP ${res.status}`);
        return new Uint8Array(await res.arrayBuffer());
    }

    function zipCrc32(bytes){
        if(!ZIP_CRC_TABLE){
            ZIP_CRC_TABLE = new Uint32Array(256);
            for(let i = 0; i < 256; i++){
                let c = i;
                for(let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
                ZIP_CRC_TABLE[i] = c >>> 0;
            }
        }
        let crc = 0xffffffff;
        for(let i = 0; i < bytes.length; i++) crc = ZIP_CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
        return (crc ^ 0xffffffff) >>> 0;
    }

    function zipDosTime(date = new Date()){
        const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
        const year = Math.max(1980, date.getFullYear());
        const day = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
        return { time, day };
    }

    function zipHeader(signature, size){
        const bytes = new Uint8Array(size);
        const view = new DataView(bytes.buffer);
        view.setUint32(0, signature, true);
        return { bytes, view };
    }

    function createZipBlob(entries){
        const now = zipDosTime();
        const files = [];
        const central = [];
        let offset = 0;
        entries.forEach(entry => {
            const nameBytes = ZIP_ENCODER.encode(entry.name);
            const data = entry.bytes instanceof Uint8Array ? entry.bytes : ZIP_ENCODER.encode(String(entry.bytes || ''));
            const crc = zipCrc32(data);
            const local = zipHeader(0x04034b50, 30 + nameBytes.length);
            local.view.setUint16(4, 20, true);
            local.view.setUint16(6, 0x0800, true);
            local.view.setUint16(8, 0, true);
            local.view.setUint16(10, now.time, true);
            local.view.setUint16(12, now.day, true);
            local.view.setUint32(14, crc, true);
            local.view.setUint32(18, data.length, true);
            local.view.setUint32(22, data.length, true);
            local.view.setUint16(26, nameBytes.length, true);
            local.bytes.set(nameBytes, 30);
            files.push(local.bytes, data);

            const cd = zipHeader(0x02014b50, 46 + nameBytes.length);
            cd.view.setUint16(4, 20, true);
            cd.view.setUint16(6, 20, true);
            cd.view.setUint16(8, 0x0800, true);
            cd.view.setUint16(10, 0, true);
            cd.view.setUint16(12, now.time, true);
            cd.view.setUint16(14, now.day, true);
            cd.view.setUint32(16, crc, true);
            cd.view.setUint32(20, data.length, true);
            cd.view.setUint32(24, data.length, true);
            cd.view.setUint16(28, nameBytes.length, true);
            cd.view.setUint32(42, offset, true);
            cd.bytes.set(nameBytes, 46);
            central.push(cd.bytes);
            offset += local.bytes.length + data.length;
        });
        const centralSize = central.reduce((sum, bytes) => sum + bytes.length, 0);
        const end = zipHeader(0x06054b50, 22);
        end.view.setUint16(8, entries.length, true);
        end.view.setUint16(10, entries.length, true);
        end.view.setUint32(12, centralSize, true);
        end.view.setUint32(16, offset, true);
        return new global.Blob([...files, ...central, end.bytes], { type:'application/zip' });
    }

    function triggerDownload(blob, fileName){
        const href = global.URL.createObjectURL(blob);
        const anchor = global.document.createElement('a');
        anchor.href = href;
        anchor.download = fileName;
        global.document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        global.setTimeout(() => global.URL.revokeObjectURL(href), 1500);
    }

    async function exportCanvas(id, context = {}){
        setStatus(context, translate(context, '正在导出...', 'Exporting...'));
        try {
            const res = await global.fetch(`/api/canvases/${encodeURIComponent(id)}`);
            if(!res.ok) throw new Error('export failed');
            const data = await res.json();
            const cv = data.canvas || data;
            const title = currentCanvas(context)?.title || cv.title || 'canvas';
            const blob = new global.Blob([JSON.stringify(cv, null, 2)], { type: 'application/json' });
            triggerDownload(blob, safeExportBase(title) + '.json');
            setStatus(context, translate(context, '已导出', 'Exported'));
        } catch(e){
            console.error(e);
            setStatus(context, translate(context, '导出失败', 'Export failed'));
        }
    }

    async function exportCanvasWithResources(id, context = {}){
        setStatus(context, translate(context, '正在收集资源...', 'Collecting assets...'));
        try {
            const res = await global.fetch(`/api/canvases/${encodeURIComponent(id)}`);
            if(!res.ok) throw new Error('export failed');
            const data = await res.json();
            const cv = data.canvas || data;
            const base = safeExportBase(currentCanvas(context)?.title || cv.title || 'canvas');
            const urls = collectCanvasResourceUrls(cv).slice(0, 1000);
            const usedNames = new Set(['canvas.json', 'resources-manifest.json']);
            const entries = [{ name:'canvas.json', bytes:ZIP_ENCODER.encode(JSON.stringify(cv, null, 2)) }];
            const manifest = [];
            let skipped = 0;
            for(let i = 0; i < urls.length; i++){
                const url = urls[i];
                try {
                    const bytes = await fetchResourceBytes(url);
                    const name = exportResourceName(url, i, usedNames);
                    entries.push({ name, bytes });
                    manifest.push({ url, file:name, size:bytes.length });
                } catch(e) {
                    skipped++;
                    manifest.push({ url, skipped:true, reason:String(e?.message || e || 'fetch failed').slice(0, 120) });
                }
            }
            entries.push({ name:'resources-manifest.json', bytes:ZIP_ENCODER.encode(JSON.stringify({ canvas_id:id, resources:manifest }, null, 2)) });
            triggerDownload(createZipBlob(entries), `${base}.zip`);
            const included = Math.max(0, entries.length - 2);
            setStatus(context, skipped
                ? translate(context, `已导出，跳过 ${skipped} 个资源`, `Exported, skipped ${skipped} assets`)
                : translate(context, `已导出 ${included} 个资源`, `Exported ${included} assets`));
        } catch(e){
            console.error(e);
            setStatus(context, translate(context, '导出失败', 'Export failed'));
        }
    }

    global.CanvasListExport = Object.freeze({
        exportCanvas,
        exportCanvasWithResources,
        // Pure helpers remain available for focused regression checks and future callers.
        collectCanvasResourceUrls,
        safeExportBase,
    });
})(window);
