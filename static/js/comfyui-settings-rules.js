// Pure format and validation rules for the ComfyUI settings page.
(function attachComfySettingsRules(global){
    'use strict';

    function fieldKind(field){
        if(['image','video','audio'].includes(field.type)) return field.type;
        const key = `${field.input || ''} ${field.name || ''}`.toLowerCase();
        if(field.type === 'textarea' || /prompt|text|提示词|正向|负向/.test(key)) return 'prompt';
        return 'setting';
    }

    function isMediaField(field){
        return ['image','video','audio'].includes(fieldKind(field));
    }

    function mediaAccept(kind){
        if(kind === 'video') return 'video/*';
        if(kind === 'audio') return 'audio/*';
        return 'image/*';
    }

    function guessType(value, inputName){
        const lc = (inputName || '').toLowerCase();
        if(typeof value === 'boolean') return 'boolean';
        if(typeof value === 'number'){
            if(/strength|cfg|denoise/.test(lc)) return 'slider';
            return 'number';
        }
        if(typeof value === 'string'){
            if(/prompt|text|description/.test(lc) || (value && value.length > 60)) return 'textarea';
            if(/video|movie|mp4|webm|mov|m4v|vhs/.test(lc) || /\.(mp4|webm|mov|m4v|avi|mkv)(\?|$)/i.test(value)) return 'video';
            if(/audio|sound|music|voice|wav|mp3/.test(lc) || /\.(mp3|wav|m4a|aac|ogg|flac)(\?|$)/i.test(value)) return 'audio';
            if(/image|img|mask|filename|file/.test(lc) || /\.(png|jpe?g|webp|gif|bmp|tiff?)(\?|$)/i.test(value)) return 'image';
            return 'text';
        }
        return 'text';
    }

    function cleanComfyInstances(instances){
        return instances.map(value => String(value || '').trim()).filter(Boolean);
    }

    function firstUnnamedField(fields){
        return fields.find(field => !field.name || !field.name.trim());
    }

    const rules = {fieldKind, isMediaField, mediaAccept, guessType, cleanComfyInstances, firstUnnamedField};
    global.ComfySettingsRules = rules;
    if(typeof module !== 'undefined' && module.exports) module.exports = rules;
})(typeof window !== 'undefined' ? window : globalThis);
