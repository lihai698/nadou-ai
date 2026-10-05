(function(){
    if(!window.StudioI18n) return;

    window.StudioI18n.register({
        "assetManager.title": { zh: "素材库管理", en: "Asset Library" },
        "assetManager.subtitle": { zh: "按库、分组、内容和预览管理素材与提示词。", en: "Organize assets and prompts by library, group, content, and preview." },
        "assetManager.preferences": { zh: "偏好设置", en: "Preferences" },
        "assetManager.refresh": { zh: "刷新", en: "Refresh" },
        "assetManager.assetsTab": { zh: "图片资产", en: "Image Assets" },
        "assetManager.workflowsTab": { zh: "工作流管理", en: "Workflows" },
        "assetManager.promptsTab": { zh: "提示词库", en: "Prompt Library" },
        "assetManager.canvasAssetsTab": { zh: "画布资产", en: "Canvas Assets" },
        "assetManager.localTab": { zh: "本地素材", en: "Local Assets" },
        "assetManager.ready": { zh: "准备就绪", en: "Ready" },
        "assetManager.loading": { zh: "加载中...", en: "Loading..." },
        "assetManager.storageDeleteConfirm": { zh: "确认删除 {count} 张图片？此操作会删除磁盘文件。", en: "Delete selected images ({count}) from disk? This cannot be undone." },
        "assetManager.storageDeleteDone": { zh: "已删除 {removed} 个文件", en: "Deleted {removed} files" },
        "assetManager.storageDeleteKept": { zh: "{kept} 个文件仍被使用或无法确认安全，已保留", en: "Kept {kept} files still in use or whose safety could not be confirmed" },
        "assetManager.storageDeletePartial": { zh: "已删除 {removed} 个文件；{kept} 个仍被使用或无法确认安全，已保留", en: "Deleted {removed} files; kept {kept} still in use or whose safety could not be confirmed" },
        "assetManager.localDeleteDone": { zh: "已删除 {deleted} 个素材", en: "Deleted {deleted} assets" },
        "assetManager.localDeleteKept": { zh: "{kept} 个素材仍被使用或无法确认安全，已保留", en: "Kept {kept} assets still in use or whose safety could not be confirmed" },
        "assetManager.localDeletePartial": { zh: "已删除 {deleted} 个素材；{kept} 个仍被使用或无法确认安全，已保留", en: "Deleted {deleted} assets; kept {kept} still in use or whose safety could not be confirmed" },
        "assetManager.localDeleteMissing": { zh: "未找到要删除的素材", en: "No matching assets to delete" },
    });

    // asset-manager.js builds its five panels from templates. Translate only known
    // interface copy after each render; names, prompts, files and other user data stay intact.
    const uiText = new Map(Object.entries({
        '资产层级':'Asset Hierarchy', '先选库，再选分组':'Choose a library, then a group',
        '工作流层级':'Workflow Hierarchy', '独立管理工作流分组':'Manage workflow groups separately',
        '提示词库':'Prompt Library', '可创建多个词库':'Create multiple libraries',
        '画布分类':'Canvas Categories', '从所有画布拉取资产':'Assets from all canvases',
        '偏好设置':'Preferences',
        '分开管理默认反推设置和素材目录文件。':'Manage caption defaults and asset folders separately.',
        '基础偏好':'Basic Preferences', '平台':'Platform', '模型':'Model',
        '反推提示词':'Caption Prompt', '智能分类提示词':'Smart Classification Prompt',
        '编辑分类规则和追加要求':'Edit classification rules and extra requirements',
        '保存目录':'Save Folders', '上传素材':'Uploaded Files',
        '生成素材':'Generated Files', '本地素材':'Local Files',
        '这个目录里暂时没有图片':'No images in this folder yet',
        '本地上传':'Local Uploads', '批量上传到 assets/uploads':'Upload files to assets/uploads in batches',
        '管理':'Manage', '完成管理':'Done', '批量管理':'Manage Multiple',
        '全选':'Select All', '清空':'Clear', '剪切':'Cut', '剪切/移动':'Cut / Move',
        '复制':'Copy', '下载':'Download', '下载所选':'Download Selected',
        '复制到画布':'Copy to Canvas', '删除':'Delete', '删除所选':'Delete Selected',
        '导出所选':'Export Selected', '刷新资源':'Refresh Assets',
        '新增':'Add', '保存':'Save', '取消':'Cancel', '重命名':'Rename',
        '确认删除':'Confirm Delete', '删除库':'Delete Library', '新分组':'New Group',
        'AI 处理':'AI Tools', '分类中':'Classifying', '智能分类':'Smart Classification',
        '环境':'Environment', '构图':'Composition', '光影':'Lighting',
        '模特':'Model', '主体':'Subject', '风格':'Style', '标签':'Tags',
        '视角':'Viewpoint', '分镜':'Storyboard', '角色':'Characters',
        '场景':'Scenes', '产品':'Products', '我的':'Mine',
        '上传文件':'Upload Files', '上传本地素材':'Upload Local Files',
        '拖入文件或点击上传':'Drop files here or click to upload',
        '上传工作流':'Upload Workflow', '支持 JSON / ZIP':'JSON / ZIP supported',
        '上传到当前分组':'Upload to This Group',
        '工作流库':'Workflow Library', '工作流详情':'Workflow Details',
        'JSON 工作流':'JSON Workflow', 'ZIP 工作流包':'ZIP Workflow Package',
        '素材详情':'Asset Details', '画布资产详情':'Canvas Asset Details',
        '新增提示词':'New Prompt', '提示词预览':'Prompt Preview',
        '编辑提示词':'Edit Prompt', '编辑素材':'Edit Asset',
        '在当前库内保存':'Save in this library',
        '保存到当前提示词库':'Save to this prompt library',
        '当前分组内直接保存':'Save in this group',
        '全部提示词':'All Prompts', '全部上传':'All Uploads',
        '资产库':'Asset Library', '默认资产库':'Default Asset Library',
        '系统提示词库':'System Prompt Library', '工作流':'Workflow',
        '分组':'Group', '素材管理':'Asset Management',
        '画布名称':'Canvas Name', '资产名称':'Asset Name',
        '最近更新':'Recently Updated', '最早更新':'Oldest Updated',
        '类型':'Type', '创建时间':'Created', '修改时间':'Modified',
        '上传时间':'Uploaded', '更新时间':'Updated', '大小':'Size',
        '位置':'Location', '来源':'Source', '来源画布':'Source Canvas',
        '来源节点':'Source Node', '节点类型':'Node Type',
        '本地预览':'Local Preview', '素材预览':'Asset Preview',
        '导入':'Import', '导入到图片资产':'Import to Image Assets',
        '复制 asset:// 地址':'Copy asset:// URL',
        '暂无分组':'No groups', '暂无工作流':'No workflows',
        '暂无工作流分组':'No workflow groups', '暂无画布':'No canvases',
        '暂无画布资产':'No canvas assets', '暂无可预览素材':'No previewable asset',
        '暂无可预览提示词':'No previewable prompt',
        '选择一个素材查看详情':'Select an asset to view details',
        '选择一个工作流查看详情':'Select a workflow to view details',
        '选择一个画布资产查看详情':'Select a canvas asset to view details',
        '选择一条提示词查看全文':'Select a prompt to read it',
        '当前分组还没有素材，可以上传，或从智能画布输出保存到素材库。':'No assets in this group. Upload files or save output from Smart Canvas.',
        '当前分组还没有工作流，可以上传 JSON / ZIP，或从传统画布导出到资产库。':'No workflows in this group. Upload JSON / ZIP or export from Classic Canvas.',
        '当前分类没有可下载的画布资产。可以点击“刷新资源”，或在画布中生成/导入图片、视频、音频后再查看。':'No downloadable canvas assets here. Refresh assets or generate or import media on a canvas.',
        '选择图片/视频/音频文件即可上传，文件保存在项目 assets/uploads 目录。':'Choose image, video or audio files. They are saved in assets/uploads.',
        '暂无分类，先选择图片点“智能分类”':'No categories yet. Select an image and run Smart Classification.',
        '正在读取目录...':'Reading folder...',
        '正向提示词':'Positive Prompt', '负向提示词':'Negative Prompt',
        '用途说明':'Usage Notes', '提示词':'Prompt', '文本':'Text',
        '图片':'Image', '视频':'Video', '音频':'Audio',
        '名称':'Name', '素材名称':'Asset Name',
        '画布资产':'Canvas Assets', '图片资产':'Image Assets',
        '智能画布':'Smart Canvas', '普通画布':'Classic Canvas',
        '搜索素材':'Search assets', '搜索工作流':'Search workflows',
        '搜索画布资产':'Search canvas assets', '搜索本地上传':'Search local uploads',
        '搜索名称、说明或正文':'Search name, notes or content',
        '新建资产库':'New asset library', '新建工作流分组':'New workflow group',
        '新建提示词库':'New prompt library', '新建文件夹':'New folder',
        '重命名文件夹':'Rename folder', '删除文件夹':'Delete folder',
        '排序方法':'Sort order', '打开链接':'Open link', '复制链接':'Copy Link',
        '重新读取画布中的图片、视频、音频资源':'Reload image, video and audio assets from canvases',
        '预览视频':'Preview video', '放大预览':'Enlarge preview',
        '导出工作流':'Export workflow', '下载素材':'Download asset',
        '点击放大预览':'Click to enlarge preview', '编辑':'Edit',
        '新窗口打开':'Open in new window',
        '再次点击确认删除':'Click again to confirm deletion',
        '直接修改名称':'Edit name directly',
        '准备就绪':'Ready', '加载中...':'Loading...',
        '已保存':'Saved', '保存中...':'Saving...', '保存失败':'Save failed',
        '上传失败':'Upload failed', '加载失败':'Load failed',
        '操作失败':'Operation failed', '名称不能为空':'Name cannot be empty',
        '仅图片和视频支持预览':'Only images and videos can be previewed',
    }));
    const enText = new Map([...uiText].map(([zh, en]) => [en, zh]));
    const originalNodes = new WeakMap();
    const originalAttributes = new WeakMap();
    const userContent = '.tree-row-name,.asset-card-name,.asset-card-meta,.prompt-row-main,.prompt-detail-head,.params-list,.content-heading strong,.content-heading span,.canvas-asset-group-head strong,.canvas-asset-group-head span,.detail-name,.detail-name-input,.detail-meta strong,.detail-url,.detail-media,.media-file-name,.storage-file-name,.storage-file-card span,.asset-pref-fold em,.panel-title span,.asset-clipboard-info,.avatar-hint,.classification-chips button,.smart-class-group-btn span,.smart-class-pill,#prefCaptionProvider option,#prefCaptionModel option,#localCaptionProvider option,#localCaptionModel option,textarea,[contenteditable]';
    function translatedText(value, allowFragments=false){
        const source = value.trim();
        if(!source) return value;
        const english = window.StudioI18n.lang() === 'en';
        let target = english ? uiText.get(source) : enText.get(source);
        if(!target){
            const counts = english
                ? [[/^(\d+) 个素材$/, '$1 assets'], [/^(\d+) 个资产$/, '$1 assets'],
                    [/^(\d+) 个画布$/, '$1 canvases'], [/^(\d+) 个工作流$/, '$1 workflows'],
                    [/^共 (\d+) 条提示词$/, '$1 prompts'], [/^已选择 (\d+) 个工作流。$/, '$1 workflows selected.'],
                    [/^(\d+) 字符$/, '$1 characters'], [/^删除 (\d+)$/, 'Delete $1'],
                    [/^已加载全部 (\d+) 张$/, 'Loaded all $1'],
                    [/^已加载 (\d+) \/ (\d+)，向下滚动继续$/, 'Loaded $1 / $2, scroll down to continue'],
                    [/^继续加载中\.\.\.$/, 'Loading more...'],
                    [/^已选 (\d+) 个，其中 (\d+) 张图片$/, '$1 selected, including $2 images'],
                    [/^共 (\d+) 个画布，(\d+) 个可下载资产。$/, '$1 canvases, $2 downloadable assets.']]
                : [[/^(\d+) assets$/, '共 $1 个素材'], [/^(\d+) canvases$/, '$1 个画布'],
                    [/^(\d+) workflows$/, '$1 个工作流'], [/^(\d+) prompts$/, '共 $1 条提示词'],
                    [/^(\d+) workflows selected\.$/, '已选择 $1 个工作流。'],
                    [/^(\d+) characters$/, '$1 字符'], [/^Delete (\d+)$/, '删除 $1'],
                    [/^Loaded all (\d+)$/, '已加载全部 $1 张'],
                    [/^Loaded (\d+) \/ (\d+), scroll down to continue$/, '已加载 $1 / $2，向下滚动继续'],
                    [/^Loading more\.\.\.$/, '继续加载中...'],
                    [/^(\d+) selected, including (\d+) images$/, '已选 $1 个，其中 $2 张图片'],
                    [/^(\d+) canvases, (\d+) downloadable assets\.$/, '共 $1 个画布，$2 个可下载资产。']];
            for(const [pattern, replacement] of counts){
                if(pattern.test(source)){ target = source.replace(pattern, replacement); break; }
            }
        }
        if(!target && allowFragments && english){
            const fragment = source
                .replace(/(\d+) 个可下载资产/g, '$1 downloadable assets')
                .replace(/(\d+) 个素材/g, '$1 assets')
                .replace(/(\d+) 个资产/g, '$1 assets')
                .replace(/(\d+) 个工作流/g, '$1 workflows')
                .replace(/(\d+) 个画布/g, '$1 canvases')
                .replace(/(\d+) 条提示词/g, '$1 prompts')
                .replace(/^默认资产库(?= \/)/, 'Default Asset Library')
                .replace(/^工作流库(?= \/)/, 'Workflow Library')
                .replace(/^智能分类：/, 'Smart Classification: ')
                .replace(/ \/ 画布名称$/, ' / Canvas Name')
                .replace(/ \/ 最近更新$/, ' / Recently Updated')
                .replace(/ \/ 最早更新$/, ' / Oldest Updated')
                .replace(/ \/ 资产名称$/, ' / Asset Name')
                .replace(/ \/ 类型$/, ' / Type')
                .replace(/^共 /, 'Total: ');
            if(fragment !== source) target = fragment;
        }
        if(!target) return value;
        return value.replace(source, target);
    }
    function translatedHeadingSubtitle(value){
        const tab = document.querySelector('.asset-tabs button.active')?.dataset.tab;
        if(tab === 'assets'){
            const lib = typeof activeAssetLibrary === 'function' ? activeAssetLibrary() : null;
            const name = lib?.name || '资产库';
            let result = value;
            if(lib?.id === 'default' && name === '默认资产库' && result.startsWith(name + ' / ')){
                result = 'Default Asset Library' + result.slice(name.length);
            }
            const prefix = (lib?.id === 'default' && name === '默认资产库' ? 'Default Asset Library' : name) + ' / 智能分类：';
            if(result.startsWith(prefix)) result = result.replace(prefix, prefix.replace('智能分类：', 'Smart Classification: '));
            return result.replace(/(\d+) 个素材$/, '$1 assets');
        }
        if(tab === 'local') return value.replace(/^智能分类：/, 'Smart Classification: ').replace(/(\d+) 个素材$/, '$1 assets');
        if(tab === 'workflows') return value.replace(/^工作流库 \/ (\d+) 个工作流$/, 'Workflow Library / $1 workflows');
        if(tab === 'prompts') return value.replace(/^共 (\d+) 条提示词$/, '$1 prompts');
        if(tab === 'canvas-assets'){
            const prefix = value.startsWith('智能画布 / ') ? 'Smart Canvas / '
                : value.startsWith('普通画布 / ') ? 'Classic Canvas / ' : null;
            return translatedText(prefix ? prefix + value.slice(value.indexOf(' / ') + 3) : value, true);
        }
        return value;
    }
    function translateRegion(region){
        if(!region) return;
        const walker = document.createTreeWalker(region, NodeFilter.SHOW_TEXT);
        for(let node = walker.nextNode(); node; node = walker.nextNode()){
            const heading = node.parentElement?.closest('.content-heading span');
            if(heading){
                const saved = originalNodes.get(node);
                const english = window.StudioI18n.lang() === 'en';
                const translated = saved && node.nodeValue === (english ? saved.zh : saved.en)
                    ? (english ? saved.en : saved.zh)
                    : english ? translatedHeadingSubtitle(node.nodeValue) : node.nodeValue;
                if(english && translated !== node.nodeValue) originalNodes.set(node, {zh:node.nodeValue, en:translated});
                if(translated !== node.nodeValue) node.nodeValue = translated;
                continue;
            }
            if(node.parentElement?.closest(userContent)) continue;
            const saved = originalNodes.get(node);
            const english = window.StudioI18n.lang() === 'en';
            const allowFragments = !!node.parentElement?.closest('.manage-tools,.nav-hint,.canvas-asset-group-head small');
            const translated = saved && node.nodeValue === (english ? saved.zh : saved.en)
                ? (english ? saved.en : saved.zh)
                : translatedText(node.nodeValue, allowFragments);
            if(english && translated !== node.nodeValue) originalNodes.set(node, {zh:node.nodeValue, en:translated});
            if(translated !== node.nodeValue) node.nodeValue = translated;
        }
        const english = window.StudioI18n.lang() === 'en';
        region.querySelectorAll('[data-asset-ui-text]').forEach(el => {
            const source = el.dataset.assetUiText || '';
            const translated = english ? uiText.get(source) || source : source;
            if(el.textContent !== translated) el.textContent = translated;
        });
        region.querySelectorAll('[data-asset-ui-title]').forEach(el => {
            const source = el.dataset.assetUiTitle || '';
            const translated = english ? uiText.get(source) || source : source;
            if(el.title !== translated) el.title = translated;
        });
        region.querySelectorAll('[data-asset-ui-prefix]').forEach(el => {
            const source = el.dataset.assetUiPrefix || '';
            const suffix = el.dataset.assetUiSuffix || '';
            const prefix = english ? uiText.get(source) || source : source;
            const translated = `${prefix} / ${suffix}`;
            if(el.textContent !== translated) el.textContent = translated;
        });
        region.querySelectorAll('[data-asset-class-root] .tree-row-name,[data-localup-class-root] .tree-row-name,[data-workflow-root] .tree-row-name,[data-prompt-cat="all"] .tree-row-name,[data-canvas-asset-cat] .tree-row-name').forEach(el => {
            const translated = translatedText(el.textContent || '');
            if(translated !== el.textContent) el.textContent = translated;
        });
        const builtinTreeNames = [
            ['[data-asset-lib="default"] .tree-row-name', '默认资产库'],
            ['[data-asset-cat="characters"] .tree-row-name', '角色'],
            ['[data-asset-cat="scenes"] .tree-row-name', '场景'],
            ['[data-workflow-cat="workflows"] .tree-row-name', '工作流'],
            ['[data-prompt-lib="system"] .tree-row-name', '系统提示词库'],
            ['[data-localup-folder=""] .tree-row-name', '全部上传'],
            ['[data-localup-folder=""] .tree-row-name', '本地上传'],
        ];
        for(const [selector, expected] of builtinTreeNames){
            region.querySelectorAll(selector).forEach(el => {
                if(![expected, uiText.get(expected)].includes(el.textContent.trim())) return;
                const translated = translatedText(el.textContent || '');
                if(translated !== el.textContent) el.textContent = translated;
            });
        }
        const builtinPromptNames = {view:'视角', storyboard:'分镜', character:'角色', product:'产品', lighting:'光影', custom:'我的'};
        region.querySelectorAll('[data-prompt-cat-lib="system"][data-prompt-cat] .tree-row-name').forEach(el => {
            const expected = builtinPromptNames[el.closest('[data-prompt-cat]')?.dataset.promptCat];
            if(!expected || ![expected, uiText.get(expected)].includes(el.textContent.trim())) return;
            const translated = translatedText(el.textContent || '');
            if(translated !== el.textContent) el.textContent = translated;
        });
        region.querySelectorAll('.asset-nav .panel-title span').forEach(el => {
            const translated = translatedText(el.textContent || '');
            if(translated !== el.textContent) el.textContent = translated;
        });
        const tab = document.querySelector('.asset-tabs button.active')?.dataset.tab;
        const heading = region.querySelector('.asset-content .content-heading strong');
        if(heading){
            const fixedHeading = tab === 'assets' && !activeAssetClassEntry()
                ? {characters:'角色', scenes:'场景'}[activeAssetCategory()?.id]
                : tab === 'workflows' && activeWorkflowCategory()?.id === 'workflows' ? '工作流'
                : tab === 'prompts' && activePromptLibrary()?.id === 'system' ? '系统提示词库'
                : tab === 'local' && !activeLocalUploadFolder
                    ? (['全部上传', uiText.get('全部上传')].includes(heading.textContent.trim()) ? '全部上传' : '本地上传')
                : tab === 'canvas-assets' && !activeCanvasAssetCanvas()
                    ? {smart:'智能画布', classic:'普通画布'}[activeCanvasAssetCategoryInfo()?.id]
                    : null;
            if(fixedHeading && [fixedHeading, uiText.get(fixedHeading)].includes(heading.textContent.trim())){
                const translated = translatedText(heading.textContent || '');
                if(translated !== heading.textContent) heading.textContent = translated;
            }
        }
        region.querySelectorAll('.asset-detail:has(.detail-empty) .panel-title span').forEach(el => {
            const translated = translatedText(el.textContent || '');
            if(translated !== el.textContent) el.textContent = translated;
        });
        region.querySelectorAll('button[title],select[title],input[placeholder],textarea[placeholder]').forEach(el => {
            const attr = el.hasAttribute('title') ? 'title' : 'placeholder';
            const value = el.getAttribute(attr);
            if(attr === 'title' && el.closest(userContent)) return;
            if(el.id?.startsWith('storageDir_')) return;
            const english = window.StudioI18n.lang() === 'en';
            const saved = originalAttributes.get(el);
            const translated = english ? translatedText(value || '')
                : saved?.attr === attr && value === saved.en ? saved.zh : value;
            if(english && translated !== value) originalAttributes.set(el, {attr, zh:value, en:translated});
            if(value !== translated) el.setAttribute(attr, translated);
        });
    }
    function translateDynamic(){
        translateRegion(document.getElementById('assetManagerRoot'));
        translateRegion(document.getElementById('storageSettingsOverlay'));
        translateRegion(document.querySelector('.asset-lightbox'));
        const english = window.StudioI18n.lang() === 'en';
        const deleteButton = document.querySelector('#storageSettingsOverlay [data-storage-delete] span');
        if(deleteButton){
            const source = deleteButton.textContent.trim();
            const match = source.match(/^(?:删除|Delete)\s*(\d*)$/);
            if(match){
                const count = match[1] || '';
                const translated = english ? `Delete${count ? ` ${count}` : ''}` : `删除${count ? ` ${count}` : ''}`;
                if(deleteButton.textContent !== translated) deleteButton.textContent = translated;
            }
        }
        const loadedLabel = document.querySelector('#storageSettingsOverlay .storage-load-more');
        if(loadedLabel){
            const source = loadedLabel.textContent.trim();
            let translated = source;
            let match = source.match(/^已加载全部 (\d+) 张$/);
            if(match) translated = english ? `Loaded all ${match[1]}` : source;
            match = source.match(/^Loaded all (\d+)$/);
            if(match && !english) translated = `已加载全部 ${match[1]} 张`;
            match = source.match(/^已加载 (\d+) \/ (\d+)，向下滚动继续$/);
            if(match) translated = english ? `Loaded ${match[1]} / ${match[2]}, scroll down to continue` : source;
            match = source.match(/^Loaded (\d+) \/ (\d+), scroll down to continue$/);
            if(match && !english) translated = `已加载 ${match[1]} / ${match[2]}，向下滚动继续`;
            if(source === '继续加载中...' || source === 'Loading more...') translated = english ? 'Loading more...' : '继续加载中...';
            if(loadedLabel.textContent !== translated) loadedLabel.textContent = translated;
        }
        const status = document.getElementById('assetStatus');
        if(status){
            const translated = translatedText(status.textContent || '');
            if(translated !== status.textContent) status.textContent = translated;
        }
    }

    const statusKeys = new Map([
        ['准备就绪', 'assetManager.ready'],
        ['Ready', 'assetManager.ready'],
        ['加载中...', 'assetManager.loading'],
        ['Loading...', 'assetManager.loading'],
    ]);
    function syncStatus(){
        const status = document.getElementById('assetStatus');
        if(!status) return;
        const current = status.textContent.trim();
        const key = statusKeys.get(current);
        if(!key) return;
        const translated = window.StudioI18n.t(key);
        if(current !== translated) status.textContent = translated;
    }

    function observeElement(target, callback, options){
        if(!target || target.nodeType !== 1 || target.ownerDocument !== document) return;
        const observer = new MutationObserver(callback);
        observer.observe(target, options);
        return observer;
    }

    document.addEventListener('DOMContentLoaded', () => {
        syncStatus();
        translateDynamic();
        observeElement(document.getElementById('assetStatus'), syncStatus, { childList:true, characterData:true, subtree:true });
        observeElement(document.body, translateDynamic, { childList:true, subtree:true });
    });
    window.addEventListener('studio-lang-change', () => { syncStatus(); translateDynamic(); });
})();
