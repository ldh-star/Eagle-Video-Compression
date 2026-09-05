/**
 * 视频压缩 · 应用主逻辑
 *
 * 负责：界面渲染、批量任务队列、安全替换流程、统计汇总。
 * 编码相关的脏活都在 ffmpeg.js 里，这里只做编排。
 */
;(function (root) {
    'use strict';

    var Core = root.FFmpegCore;
    var F = root.Format;

    /**
     * 统一翻译入口。Eagle 会根据 manifest 的 languages 自动注入并初始化 i18next；
     * 适配层未加载或旧版宿主没有 i18next 时，始终回退到调用处写明的中文，
     * 避免国际化模块成为启动单点故障。
     */
    function tr(key, fallback, vars) {
        try {
            if (root.I18n && typeof root.I18n.t === 'function') return root.I18n.t(key, fallback, vars);
        } catch (e) { /* 使用 fallback */ }
        if (vars) {
            return String(fallback).replace(/{{\s*(\w+)\s*}}/g, function (_, name) {
                return vars[name] === undefined ? '' : vars[name];
            });
        }
        return fallback;
    }

    function applyTranslations() {
        try {
            if (root.I18n && typeof root.I18n.apply === 'function') root.I18n.apply(document);

            // 静态标签并非都有独立 id，集中在这里按稳定的结构定位。
            // 不使用“按中文全文搜索再替换”的黑魔法，避免用户文件名或动态提示被误改。
            function setText(selector, key, fallback) {
                var node = document.querySelector(selector);
                if (node) node.textContent = tr(key, fallback);
            }
            setText('.panel-title', 'ui.settings', '压缩设置');
            var labels = document.querySelectorAll('.grid .field > label');
            var labelKeys = [
                ['ui.codec', '编码格式'], ['ui.speed', '编码速度'], ['ui.resolution', '分辨率'],
                ['ui.fps', '帧率'], ['ui.audio', '音轨'], ['ui.audioBitrate', '音频码率']
            ];
            for (var i = 0; i < labels.length && i < labelKeys.length; i++) {
                labels[i].textContent = tr(labelKeys[i][0], labelKeys[i][1]);
            }
            var gridHints = document.querySelectorAll('.grid .field .hint');
            if (gridHints[1]) gridHints[1].textContent = tr('ui.speedHint', '越慢压缩率越高，耗时越长');
            if (gridHints[3]) gridHints[3].textContent = tr('ui.fpsHint', '降低帧率可进一步减小体积');
            if (gridHints[5]) gridHints[5].textContent = tr('ui.audioBitrateHint', '仅在「重编码为 AAC」时生效');
            setText('.mode-label', 'ui.compressionMode', '压缩方式');
            setText('#modeTabs [data-mode="crf"]', 'ui.qualityFirst', '画质优先（CRF）');
            setText('#modeTabs [data-mode="bitrate"]', 'ui.targetBitrate', '指定码率');
            setText('#modeTabs [data-mode="target"]', 'ui.targetFileSize', '目标文件大小');
            setText('.slider-caption', 'ui.crfQuality', 'CRF 画质');
            var scale = document.querySelectorAll('.slider-scale span');
            if (scale[0]) scale[0].textContent = tr('ui.qualityBest', '画质最好 · 体积大');
            if (scale[1]) scale[1].textContent = tr('ui.qualitySmall', '画质差 · 体积小');
            setText('[data-panel="crf"] .hint', 'ui.crfHint', 'CRF 保持恒定画质，体积取决于画面内容，无法提前预估');
            setText('[data-panel="bitrate"] .hint', 'ui.bitrateHint', '视频码率。1080p 一般 2000~5000 kbps 足够');
            setText('[data-panel="target"] .hint', 'ui.targetHint', '每个视频压缩到该大小附近。H.264 / H.265 采用两遍编码，精度更高但耗时约翻倍');
            setText('#backupCheck span', 'ui.backup', '压缩前备份原文件');
            setText('#btnPickBackup', 'ui.selectBackup', '选择备份位置…');
            setText('#chkReplaceInEagle + span', 'ui.replaceInEagle', '完成后同步回 Eagle 素材（替换原素材并刷新缩略图）');
            setText('.field.inline label', 'ui.concurrency', '同时处理');
            setText('.field.inline .hint', 'ui.concurrencyHint', '并发数越高越快，但 CPU 占用也越高');
            setText('#btnAddFiles', 'ui.addFiles', '添加本地文件…');
            setText('#btnClear', 'ui.clearList', '清空列表');
            setText('#emptyState .empty-title', 'ui.emptyTitle', '还没有添加视频');
            var emptyDesc = document.querySelector('#emptyState .empty-desc');
            if (emptyDesc) emptyDesc.innerHTML = tr('ui.emptyDescription', '在 Eagle 里选中视频素材后打开本插件，会自动载入；\n或者直接把视频文件拖到这个窗口里').replace(/\n/g, '<br>');
            setText('#confirmMask .modal-title', 'ui.confirmTitle', '确认开始压缩');
            setText('#btnConfirmCancel', 'ui.thinkAgain', '再想想');
            setText('#btnConfirmOk', 'ui.confirmStart', '确认开始');
            setText('#btnCancel', 'ui.cancelTasks', '停止并取消');
            setText('#selectionTitle', 'ui.selectionTitle', '检测到新的 Eagle 选中素材');
            setText('#btnSelectionCancel', 'ui.selectionCancel', '取消此次操作');
            setText('#btnSelectionReplace', 'ui.selectionReplace', '取消当前所有任务并重新添加');
            setText('#btnSelectionAppend', 'ui.selectionAppend', '加入任务队列');
            setText('.log-title', 'ui.logTitle', '运行日志');
            setText('#btnCopyDiag', 'ui.copyDiagnostic', '复制诊断信息');
            setText('#btnCopyLog', 'ui.copyLog', '复制日志');
            setText('#btnRevealLog', 'ui.openLogFolder', '打开日志目录');
            setText('#btnCloseLog', 'ui.collapse', '收起');
        } catch (e) {
            log('warn', '应用界面翻译失败: ' + (e && e.message ? e.message : e));
        }
    }

    /**
     * 安全取 Node 模块。
     *
     * 原来这里是裸的 require('fs')，一旦插件窗口没开 nodeIntegration，
     * 这行会在 app.js 加载阶段就抛错 —— 整个 IIFE 中断，window.App 连定义
     * 都定义不出来，后续入口全灭，而界面上只会看到一片空白。
     * 现在拿不到就记一条日志，把「静默死掉」变成「有据可查」。
     */
    function nodeModule(name) {
        try { if (typeof require === 'function') return require(name); } catch (e) { /* 继续 */ }
        try { if (root && typeof root.require === 'function') return root.require(name); } catch (e) { /* 继续 */ }
        return null;
    }

    var fs = nodeModule('fs');
    var path = nodeModule('path');
    var os = nodeModule('os');

    var SETTINGS_KEY = 'eagle-video-compress:settings';

    /**
     * 设置结构版本。
     *
     * 改动任何默认值 / 字段含义时把这个数字 +1，旧版本设置会被整体丢弃、
     * 回到默认值。没有它的话，用户本地存着的旧值会一直盖住新默认值 ——
     * 比如把默认编码从 H.264 改成 H.265，老用户那边永远还是 H.264，
     * 你会以为自己没改成功。
     */
    var SETTINGS_VERSION = 2;

    /**
     * 统一日志出口。Logger 没加载时（理论上不会）退回 console，
     * 保证日志调用本身永远不会成为新的故障点。
     */
    function log(level, msg, err) {
        try {
            var L = root.Logger;
            if (L && typeof L[level] === 'function') {
                L[level](err ? (msg + ' -> ' + (err.stack || err.message || err)) : msg);
                return;
            }
        } catch (e) { /* 继续走 console */ }
        try { (console[level] || console.log)(msg, err || ''); } catch (e) {}
    }

    // -----------------------------------------------------------------
    // 状态
    // -----------------------------------------------------------------
    var eagle = null;

    /**
     * 返回一份全新的默认设置。
     *
     * 不能直接复用同一个对象：点击「重置设置」后，后续 UI 编辑会改到 state.settings，
     * 如果默认对象也被一并改脏，下一次重置就不再是真正的默认值。
     */
    function defaultSettings() {
        return {
            version: SETTINGS_VERSION,

            // 默认 H.265：同样画质下比 H.264 省 30~50%，而且能保住 10-bit。
            // H.264 留给兼容性要求高的场景手动选。
            codec: 'h265',
            speedIndex: 2,
            resolution: 'source',
            customHeight: 720,
            fps: 'source',
            audioMode: 'aac',
            audioBitrate: 128,
            mode: 'crf',
            // CRF 默认值跟着 codec 走：H.264 是 23，H.265 会用 28。
            crf: 28,
            videoBitrate: 2000,
            targetSizeMB: 50,

            // 默认不备份。要备份必须先明确指定目录 —— 见 refreshBackupUI()
            backup: false,
            backupDir: '',

            replaceInEagle: true,
            concurrency: 2,

            // 界面主题：auto 跟随 Eagle，light / dark 强制
            themeMode: 'auto'
        };
    }

    var state = {
        ready: false,
        bins: null,
        tasks: [],
        running: false,
        cancelToken: { cancelled: false },
        // 当前一轮压缩完成（包括 FFmpeg 子进程退出、临时文件清理）的 Promise。
        // "取消并重新添加" 必须等待它结束，不能在旧进程还握着临时文件时就清空队列。
        runPromise: Promise.resolve(),
        runSession: null,
        settings: defaultSettings()
    };

    var dom = {};
    var seq = 0;

    /** 空列表时下面那行提示语，自动导入没选中素材时会改写它 */
    var emptyHint = '';

    // -----------------------------------------------------------------
    // 工具
    // -----------------------------------------------------------------
    function $(id) { return document.getElementById(id); }

    function uid() {
        seq++;
        return Date.now().toString(36) + '-' + seq;
    }

    function copyFileAsync(src, dest) {
        return new Promise(function (resolve, reject) {
            fs.copyFile(src, dest, function (err) {
                err ? reject(err) : resolve();
            });
        });
    }

    function renameAsync(src, dest) {
        return new Promise(function (resolve, reject) {
            fs.rename(src, dest, function (err) {
                err ? reject(err) : resolve();
            });
        });
    }

    function newCancelledError() {
        if (Core && typeof Core.CancelledError === 'function') return Core.CancelledError();
        var err = new Error('Cancelled');
        err.cancelled = true;
        return err;
    }

    /**
     * 安全提交最终产物。
     *
     * 绝不能把临时输出直接 copy 到原路径：copyFile 中途失败时，原文件有被截断或
     * 部分覆盖的风险。这里先在原文件同目录写入 staging，写完整后再 rename 覆盖；
     * 在 macOS/Linux 的同一卷上 rename 是原子提交，失败时原文件保持不变。
     * 在 staging 拷贝前、以及 commit 临界区前分别检查取消状态；一旦发起 rename，
     * 就将它视为不可中断的极短提交操作，保证结果只能是旧文件或完整新文件。
     */
    function atomicReplaceFileAsync(src, dest, cancelToken) {
        var stage = path.join(path.dirname(dest), '.eagle-vc-commit-' + uid() + path.extname(dest));
        if (cancelToken && cancelToken.cancelled) return Promise.reject(newCancelledError());
        return copyFileAsync(src, stage)
            .then(function () {
                if (cancelToken && cancelToken.cancelled) throw newCancelledError();
                return renameAsync(stage, dest);
            })
            .catch(function (err) {
                return unlinkQuiet(stage).then(function () { throw err; });
            });
    }

    function unlinkQuiet(p) {
        return new Promise(function (resolve) {
            fs.unlink(p, function () { resolve(); });
        });
    }

    /** 若目标已存在则追加 -1 / -2 …，避免覆盖历史备份 */
    function uniquePath(dir, name) {
        var ext = path.extname(name);
        var base = path.basename(name, ext);
        var candidate = path.join(dir, name);
        var i = 1;
        while (fs.existsSync(candidate)) {
            candidate = path.join(dir, base + '-' + i + ext);
            i++;
        }
        return candidate;
    }

    // -----------------------------------------------------------------
    // 设置读写
    // -----------------------------------------------------------------
    /**
     * 设置落盘到独立文件，而不是 localStorage。
     *
     * 原因很实在：查过 ~/Library/Application Support/Eagle/Local Storage/leveldb，
     * 里面存的是 Eagle 自己的键（eagle.list.thumbSize 之类），
     * **插件窗口写的 eagle-video-compress:settings 一次都没出现过** ——
     * Eagle 的插件窗口跑在独立的 / 非持久化的 session 里，localStorage
     * 关掉窗口就没了。表现就是「每次打开插件，设置全都回到初始值」。
     *
     * 写文件则一定留得住，而且用户想手动改、想备份都方便。
     * localStorage 只作为「文件也写不进去」时的最后兜底。
     */
    function settingsFilePath() {
        try {
            // 测试专用出口。E2E 测试跑的是真实插件代码，不隔离的话会在用户
            // 真实的 ~/Library/Application Support/Eagle 视频压缩/settings.json
            // 里塞一堆测试值 —— 用户下次打开插件，界面上全是测试时选的参数。
            // Eagle 里这个环境变量永远不存在，正常路径不受影响。
            var proc2 = nodeModule('process');
            if (proc2 && proc2.env && proc2.env.EAGLE_PLUGIN_SETTINGS_DIR) {
                return path.join(proc2.env.EAGLE_PLUGIN_SETTINGS_DIR, 'settings.json');
            }

            var proc = nodeModule('process');
            var base = (proc && proc.platform === 'win32')
                ? ((proc.env && proc.env.APPDATA) || path.join(os.homedir(), 'AppData', 'Roaming'))
                : path.join(os.homedir(), 'Library', 'Application Support');
            return path.join(base, 'Eagle 视频压缩', 'settings.json');
        } catch (e) {
            return null;
        }
    }

    function readSettingsFile() {
        var p = settingsFilePath();
        if (!p || !fs) return null;
        try {
            if (!fs.existsSync(p)) return null;
            return JSON.parse(fs.readFileSync(p, 'utf8'));
        } catch (e) {
            log('warn', '读取设置文件失败，将使用默认设置（' + p + '）：' +
                (e && e.message ? e.message : e));
            return null;
        }
    }

    function writeSettingsFile(obj) {
        var p = settingsFilePath();
        if (!p || !fs) return false;
        try {
            var dir = path.dirname(p);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(p, JSON.stringify(obj, null, 2), 'utf8');
            return true;
        } catch (e) {
            log('warn', '写入设置文件失败（' + p + '）：' + (e && e.message ? e.message : e));
            return false;
        }
    }

    function loadSettings() {
        var saved = readSettingsFile();
        var from = '文件';

        if (!saved) {
            try {
                var raw = localStorage.getItem(SETTINGS_KEY);
                if (raw) { saved = JSON.parse(raw); from = 'localStorage'; }
            } catch (e) { /* 忽略损坏的本地设置 */ }
        }

        if (!saved) {
            log('info', '没有历史设置，使用默认值');
            return;
        }

        // 结构版本对不上就整体丢弃。挑着合会出现「新字段用默认、老字段用旧值」
        // 的杂交状态，比全部重置更难排查。
        if (saved.version !== SETTINGS_VERSION) {
            log('info', '设置结构已升级（' + saved.version + ' → ' + SETTINGS_VERSION +
                '），已恢复默认设置');
            return;
        }

        Object.keys(saved).forEach(function (k) {
            if (state.settings.hasOwnProperty(k)) state.settings[k] = saved[k];
        });
        log('info', '已载入历史设置（来源: ' + from + '）');
    }

    function saveSettings() {
        // 【重要】先读一遍界面，再落盘。
        //
        // 之前编码速度、并发数、备份、同步回 Eagle 这四个控件的 change 事件
        // 直接调用 saveSettings()，而 state.settings 只在 readSettingsFromUI()
        // 里更新 —— 这四项改完根本没进 state，写下去的一直是旧值。
        // 表现就是：明明选了，下次打开又变回去了，而且是「有的记得住、
        // 有的记不住」，最难排查的那种。把读取挪进 saveSettings，从源头堵死。
        readSettingsFromUI();

        var ok = writeSettingsFile(state.settings);

        // 文件不可用时退回 localStorage，至少当次会话内还能记住
        try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings)); }
        catch (e) { /* 忽略 */ }

        return ok;
    }

    /**
     * 一键恢复全部设置到默认值。
     *
     * 只重置设置，不清空已载入的视频任务；这样用户可以先调过一堆参数，
     * 再在不重新导入素材的情况下重新从默认配置开始。压缩进行中禁用该按钮，
     * 避免本轮任务与界面显示的设置不一致。
     */
    function resetSettings() {
        if (state.running) return;

        state.settings = defaultSettings();
        applySettingsToUI();
        saveSettings();
        applyTheme();
        refreshEstimate();
        setStatus(tr('runtime.resetComplete', '已恢复全部默认设置'), 'ok');
        log('info', '用户一键恢复全部默认设置');
    }

    function readSettingsFromUI() {
        var s = state.settings;
        s.codec = dom.selCodec.value;
        s.speedIndex = parseInt(dom.selSpeed.value, 10);
        s.resolution = dom.selResolution.value;
        s.fps = dom.selFps.value;
        s.audioMode = dom.selAudioMode.value;
        s.audioBitrate = parseInt(dom.selAudioBitrate.value, 10);
        s.mode = currentMode();
        s.crf = parseInt(dom.rngCrf.value, 10);
        s.videoBitrate = parseInt(dom.inpBitrate.value, 10) || 2000;
        s.targetSizeMB = parseFloat(dom.inpTargetSize.value) || 50;
        s.backup = dom.chkBackup.checked;
        s.replaceInEagle = dom.chkReplaceInEagle.checked;
        s.concurrency = parseInt(dom.selConcurrency.value, 10);
        return s;
    }

    function currentMode() {
        var active = document.querySelector('#modeTabs button.active');
        return active ? active.getAttribute('data-mode') : 'crf';
    }

    // -----------------------------------------------------------------
    // 界面：初始化与联动
    // -----------------------------------------------------------------
    function localizedCodecLabel(id, fallback) {
        var keys = { copy: 'ui.copyVideo' };
        return keys[id] ? tr(keys[id], fallback) : fallback;
    }

    function localizedSpeedLabel(index, fallback) {
        var keys = ['ui.speedVeryFast', 'ui.speedFast', 'ui.speedBalanced', 'ui.speedSlow', 'ui.speedVerySlow'];
        return keys[index] ? tr(keys[index], fallback) : fallback;
    }

    function localizedResolutionLabel(value, fallback) {
        return value === 'source' ? tr('ui.followSource', fallback) :
            value === 'custom' ? tr('ui.customHeight', fallback) : fallback;
    }

    function localizedAudioLabel(value, fallback) {
        var keys = { aac: 'ui.reencodeAac', copy: 'ui.copyAudio', none: 'ui.removeAudio' };
        return keys[value] ? tr(keys[value], fallback) : fallback;
    }

    function fillSelects() {
        // 编码格式
        dom.selCodec.innerHTML = '';
        Object.keys(Core.CODECS).forEach(function (k) {
            var c = Core.CODECS[k];
            var o = document.createElement('option');
            o.value = k;
            o.textContent = localizedCodecLabel(k, c.label);
            dom.selCodec.appendChild(o);
        });

        // 编码速度
        dom.selSpeed.innerHTML = '';
        Core.SPEED_LABELS.forEach(function (label, i) {
            var o = document.createElement('option');
            o.value = String(i);
            o.textContent = localizedSpeedLabel(i, label);
            dom.selSpeed.appendChild(o);
        });

        // 分辨率
        dom.selResolution.innerHTML = '';
        Core.RESOLUTIONS.forEach(function (r) {
            var o = document.createElement('option');
            o.value = r.v;
            o.textContent = localizedResolutionLabel(r.v, r.l);
            dom.selResolution.appendChild(o);
        });

        // 帧率
        dom.selFps.innerHTML = '';
        [{ v: 'source', l: tr('ui.followSource', '跟随原片') }, { v: '60', l: '60 fps' }, { v: '30', l: '30 fps' },
         { v: '25', l: '25 fps' }, { v: '24', l: '24 fps' }, { v: '15', l: '15 fps' }]
            .forEach(function (f) {
                var o = document.createElement('option');
                o.value = f.v;
                o.textContent = f.l;
                dom.selFps.appendChild(o);
            });

        // 音轨
        dom.selAudioMode.innerHTML = '';
        Core.AUDIO_MODES.forEach(function (a) {
            var o = document.createElement('option');
            o.value = a.v;
            o.textContent = localizedAudioLabel(a.v, a.l);
            dom.selAudioMode.appendChild(o);
        });

        // 音频码率
        dom.selAudioBitrate.innerHTML = '';
        Core.AUDIO_BITRATES.forEach(function (b) {
            var o = document.createElement('option');
            o.value = String(b);
            o.textContent = b + ' kbps';
            dom.selAudioBitrate.appendChild(o);
        });

        // 并发数
        dom.selConcurrency.innerHTML = '';
        [1, 2, 3, 4].forEach(function (n) {
            var o = document.createElement('option');
            o.value = String(n);
            o.textContent = tr('runtime.fileCount', '{{count}} 个', { count: n });
            dom.selConcurrency.appendChild(o);
        });
    }

    function applySettingsToUI() {
        var s = state.settings;
        dom.selCodec.value = s.codec;
        dom.selSpeed.value = String(s.speedIndex);
        dom.selResolution.value = s.resolution;
        dom.selFps.value = s.fps;
        dom.selAudioMode.value = s.audioMode;
        dom.selAudioBitrate.value = String(s.audioBitrate);
        dom.selConcurrency.value = String(s.concurrency);
        dom.rngCrf.value = String(s.crf);
        dom.inpBitrate.value = String(s.videoBitrate);
        dom.inpTargetSize.value = String(s.targetSizeMB);
        dom.chkBackup.checked = s.backup;
        dom.chkReplaceInEagle.checked = s.replaceInEagle;

        // 压缩方式
        document.querySelectorAll('#modeTabs button').forEach(function (b) {
            b.classList.toggle('active', b.getAttribute('data-mode') === s.mode);
        });
        document.querySelectorAll('.mode-panel').forEach(function (p) {
            p.classList.toggle('active', p.getAttribute('data-panel') === s.mode);
        });

        refreshCodecUI();
        refreshAudioUI();
        refreshBackupUI();
        updateCrfValue();
    }

    /** 编码格式变化：同步 CRF 范围、提示、以及各控件的可用性 */
    function refreshCodecUI() {
        var codec = Core.CODECS[dom.selCodec.value];
        var isCopy = codec.id === 'copy';

        // 列表里如果有 10-bit 片源，而当前编码器保不住 10-bit，
        // 直接说清楚会降级 —— 这类素材（相机原片、HDR）静默降位深
        // 容易出现色带，用户有知情权。
        var hint = codec.hint || '';
        if (!isCopy && !codec.tenBit) {
            var tenBitCount = state.tasks.filter(function (t) {
                return t.meta && t.meta.video && t.meta.video.bitDepth >= 10;
            }).length;
            if (tenBitCount > 0) {
                hint += '　⚠️ ' + tr('runtime.tenBitDowngrade', '列表中有 {{count}} 个 10-bit 片源，选此格式会降到 8-bit（H.265 / AV1 可保留）', { count: tenBitCount });
                dom.codecHint.classList.add('warn-text');
            } else {
                dom.codecHint.classList.remove('warn-text');
            }
        } else {
            dom.codecHint.classList.remove('warn-text');
        }
        dom.codecHint.textContent = hint;

        // CRF 范围
        if (codec.crf) {
            dom.rngCrf.min = String(codec.crf.min);
            dom.rngCrf.max = String(codec.crf.max);
            dom.rngCrf.value = String(Math.min(codec.crf.max, Math.max(codec.crf.min, parseInt(dom.rngCrf.value, 10) || codec.crf.def)));
            dom.rngCrf.disabled = false;
        } else {
            dom.rngCrf.disabled = true;
        }

        // copy 模式下分辨率 / 帧率无效（无法对复制的流做滤镜）
        dom.selResolution.disabled = isCopy;
        dom.selFps.disabled = isCopy;
        dom.resolutionHint.textContent = isCopy
            ? tr('runtime.copyResolutionLocked', '复制视频流时无法改变分辨率')
            : tr('ui.resolutionHint', '只缩小，不会放大');

        // 压缩方式：copy 模式下画质/码率控制都无意义
        document.querySelectorAll('#modeTabs button').forEach(function (b) {
            b.disabled = isCopy;
        });
    }

    function refreshAudioUI() {
        var mode = dom.selAudioMode.value;
        dom.selAudioBitrate.disabled = mode !== 'aac';
        dom.audioHint.textContent =
            mode === 'aac' ? tr('runtime.audioAacHint', '统一转为 AAC，兼容性最好') :
            mode === 'copy' ? tr('runtime.audioCopyHint', '音轨原样复制，不损失音质也不省体积') :
            tr('runtime.audioNoneHint', '去掉声音，视频体积会明显下降');
    }

    /**
     * 备份开关与备份目录的联动。
     *
     * 规则：没指定备份目录 → 勾选框禁用且强制不勾选。
     *
     * 之前的实现有两个毛病：
     * 1. 默认勾选、目录默认填 ~/Eagle 视频压缩备份 —— 用户没表态就替他
     *    决定了「要备份」，而且备份落在哪他根本不知道；
     * 2. 更糟的是「不勾备份 → 选目录按钮禁用」，于是想先选目录也选不了，
     *    成了一个死锁。
     * 现在改成先选目录、后启用勾选，顺序符合直觉。
     */
    function refreshBackupUI() {
        var hasDir = !!state.settings.backupDir;

        dom.chkBackup.disabled = !hasDir;
        dom.backupCheck.classList.toggle('disabled', !hasDir);

        if (!hasDir) {
            // 没有目录就绝不允许勾上，避免「勾了但没生效」这种最难发现的状态
            dom.chkBackup.checked = false;
            state.settings.backup = false;
            dom.backupPath.textContent = tr('runtime.backupUnavailable', '未指定备份位置，勾选框暂不可用');
            dom.backupPath.title = tr('runtime.backupAvailableTitle', '点「选择备份位置…」指定目录后即可启用');
        } else {
            dom.backupPath.textContent = state.settings.backupDir;
            dom.backupPath.title = state.settings.backupDir;
        }
    }

    function updateCrfValue() {
        dom.crfValue.textContent = dom.rngCrf.value;
    }

    // -----------------------------------------------------------------
    // 任务列表
    // -----------------------------------------------------------------
    /**
     * 按文件路径在 Eagle 素材数组里找到对应的素材对象。
     * 找不到就返回 null（此时压缩完成后只覆盖文件，不调用 replaceFile）。
     */
    function findEagleItem(eagleItems, filePath) {
        if (!eagleItems || !eagleItems.length) return null;
        for (var i = 0; i < eagleItems.length; i++) {
            var it = eagleItems[i];
            if (it && it.filePath && it.filePath === filePath) return it;
        }
        return null;
    }

    function addFiles(filePaths, eagleItems) {
        var added = 0;
        var skipped = 0;

        filePaths.forEach(function (p) {
            if (!p) return;
            if (!Core.isVideoFile(p)) { skipped++; return; }
            if (state.tasks.some(function (t) { return t.path === p; })) { skipped++; return; }

            state.tasks.push({
                id: uid(),
                path: p,
                name: path.basename(p),
                ext: path.extname(p).toLowerCase(),
                meta: null,
                status: 'pending',
                progress: 0,
                liveInfo: '',
                outputSize: null,
                error: '',
                // CRF 模式的采样预估状态。与正式编码完全隔离，绝不复用其临时产物。
                sampleEstimate: null,
                sampleStatus: '',
                sampleError: '',
                // 【重要】按路径匹配 Eagle 素材，不能按数组下标配对。
                // 一旦两个数组长度/顺序不一致（比如中途有素材被跳过、或调用方
                // 传进来的 filePaths 与 eagleItems 不同源），下标配对会把 A 的
                // 压缩结果写回 B —— 这是不可逆的素材损毁。
                eagleItem: findEagleItem(eagleItems, p)
            });
            added++;
        });

        renderList();
        probePendingTasks();

        if (skipped > 0) {
            setStatus(tr('runtime.skippedFiles', '已跳过 {{count}} 个非视频或重复文件', { count: skipped }), 'warn');
        }
        return added;
    }

    /** 逐个探测待处理任务的元信息（串行，避免并发 ffprobe 抢占 CPU） */
    function probePendingTasks() {
        var pending = state.tasks.filter(function (t) { return t.status === 'pending'; });
        if (!pending.length) { renderSummary(); return; }

        // 先同步标记，避免短时间内连续追加素材时，两个 probePendingTasks()
        // 都把同一条 pending 任务送去 ffprobe。
        pending.forEach(function (t) {
            t.status = 'probing';
            renderTask(t);
        });

        // 正在编码时追加的素材，只有探测完成后才能进入本轮 worker 队列。
        // 计数会让已经暂时空闲的 worker 等待探测结果，而不是提前结束整轮任务。
        var session = state.running ? state.runSession : null;
        if (session) session.pendingProbes += pending.length;

        var chain = Promise.resolve();
        pending.forEach(function (t) {
            chain = chain.then(function () {
                return Core.probe(state.bins, t.path)
                    .then(function (meta) {
                        // 用户已取消或选择替换时，不再把晚到的探测结果复活成待处理任务。
                        if (t.status === 'cancelled') return;
                        t.meta = meta;
                        t.status = 'queued';
                        if (session && state.running && state.runSession === session && !state.cancelToken.cancelled) {
                            session.queue.push(t);
                            signalRunSession(session);
                        }
                    })
                    .catch(function (err) {
                        if (t.status === 'cancelled') return;
                        t.status = 'error';
                        t.error = err.message;
                    })
                    .then(function () {
                        if (session) {
                            session.pendingProbes = Math.max(0, session.pendingProbes - 1);
                            signalRunSession(session);
                        }
                        renderTask(t);
                        renderSummary();
                        updateButtons();
                        // 探测完才知道位深，位深降级提示要在这里补一次；
                        // 也只有在此刻才具备时长 / 音轨等采样预估所需信息。
                        refreshCodecUI();
                        refreshEstimate();
                    });
            });
        });
    }

    // -----------------------------------------------------------------
    // 渲染
    // -----------------------------------------------------------------
    function renderList() {
        if (!state.tasks.length) {
            // emptyHint 为空说明还在等自动导入的结果，先别急着催用户操作
            var desc = emptyHint
                ? escapeHtml(emptyHint)
                : '在 Eagle 里选中视频素材后打开本插件，会自动载入；' +
                  '<br>或者直接把视频文件拖到这个窗口里';
            dom.fileList.innerHTML =
                '<div class="empty-state" id="emptyState">' +
                '<div class="empty-icon">🎬</div>' +
                '<div class="empty-title">还没有添加视频</div>' +
                '<div class="empty-desc">' + desc + '</div></div>';
            return;
        }

        dom.fileList.innerHTML = '';
        state.tasks.forEach(function (t) {
            var el = buildTaskEl(t);
            dom.fileList.appendChild(el);
            t.el = el;
            renderTask(t);
        });
    }

    function buildTaskEl(t) {
        var el = document.createElement('div');
        el.className = 'task';
        el.setAttribute('data-id', t.id);
        el.innerHTML =
            '<div class="task-body">' +
            '  <div class="task-head">' +
            '    <span class="task-name"></span>' +
            '    <span class="task-badge"></span>' +
            '  </div>' +
            '  <div class="task-meta"></div>' +
            '  <div class="task-result"></div>' +
            '  <div class="task-progress">' +
            '    <div class="bar"><div class="bar-fill"></div></div>' +
            '    <span class="task-pct"></span>' +
            '    <span class="task-live"></span>' +
            '  </div>' +
            '</div>' +
            '<button type="button" class="task-remove" title="移除">×</button>';

        // 缓存会在高频进度更新中用到的节点，避免每个 FFmpeg 进度事件都 querySelector。
        t.view = {
            root: el,
            badge: el.querySelector('.task-badge'),
            remove: el.querySelector('.task-remove'),
            meta: el.querySelector('.task-meta'),
            result: el.querySelector('.task-result'),
            fill: el.querySelector('.bar-fill'),
            pct: el.querySelector('.task-pct'),
            live: el.querySelector('.task-live')
        };
        el.querySelector('.task-name').textContent = t.name;
        t.view.remove.addEventListener('click', function () {
            removeTask(t.id);
        });
        return el;
    }

    /**
     * 根据体积关系生成统一文案。relation 来自 Format：
     * smaller = 绿色「省」，larger = 红色「增」，same = 普通颜色「基本不变」。
     * 这里不能再用 pct >= 0 直接二分，否则 0.0% 会被错误地渲染成绿色。
     */
    function spaceChangeText(orig, now, relation, approximate) {
        var pct = F.savedPercent(orig, now);
        var prefix = approximate ? tr('runtime.approx', '约') : '';
        var percent = Math.abs(pct).toFixed(1);
        var size = F.bytes(Math.abs(orig - now));
        if (relation === 'smaller') {
            return tr('runtime.saved', '{{prefix}}省 {{percent}}%（{{size}}）', { prefix: prefix, percent: percent, size: size });
        }
        if (relation === 'larger') {
            return tr('runtime.increased', '{{prefix}}增 {{percent}}%（{{size}}）', { prefix: prefix, percent: percent, size: size });
        }
        return tr('runtime.unchanged', '基本不变（差异 {{percent}}%）', { percent: percent });
    }

    /** 汇总项只接受 saved / bigger / same 三种互斥状态，避免旧状态遗留颜色。 */
    function setSummarySpaceRelation(relation) {
        if (!dom.sumSpaceItem) return;
        dom.sumSpaceItem.className = 'sum-item ' + (relation === 'smaller'
            ? 'saved' : relation === 'larger' ? 'bigger' : 'same');
    }

    function renderTask(t) {
        if (!t.el) return;
        var el = t.el;
        var view = t.view;
        if (!view) {
            // 兼容旧任务对象 / 测试手工构造的任务；正常路径在 buildTaskEl 已缓存。
            view = t.view = {
                root: el,
                badge: el.querySelector('.task-badge'),
                remove: el.querySelector('.task-remove'),
                meta: el.querySelector('.task-meta'),
                result: el.querySelector('.task-result'),
                fill: el.querySelector('.bar-fill'),
                pct: el.querySelector('.task-pct'),
                live: el.querySelector('.task-live')
            };
        }
        el.className = 'task status-' + t.status;

        var badge = view.badge;
        var badgeText = {
            pending: tr('ui.statusPending', '待探测'), probing: tr('ui.statusProbing', '读取信息…'),
            queued: tr('ui.statusQueued', '待处理'), running: tr('ui.statusRunning', '压缩中'),
            done: tr('ui.statusDone', '完成'), error: tr('ui.statusFailed', '失败'),
            incompatible: tr('ui.statusUnsupported', '不支持'), cancelled: tr('ui.statusCancelled', '已取消')
        };
        badge.textContent = badgeText[t.status] || t.status;
        badge.className = 'task-badge ' + t.status;

        view.remove.disabled = state.running;

        // 元信息行
        var meta = view.meta;
        if (t.meta) {
            var v = t.meta.video || {};
            var items = [];

            /**
             * 收一个字段。带 title 的会被包一层 span —— 原始字段名（比如
             * yuv420p10le）藏进 tooltip，既让界面说人话，排查时又查得到真值。
             */
            function pushItem(text, title) {
                if (!text) return;
                items.push(title
                    ? '<span title="' + escapeHtml(title) + '">' + escapeHtml(text) + '</span>'
                    : escapeHtml(text));
            }

            pushItem(F.bytes(t.meta.size));
            pushItem(F.duration(t.meta.duration));
            if (v.width && v.height) pushItem(v.width + '×' + v.height);
            pushItem(F.fps(v.fps));
            pushItem(F.codecName(v.codec));

            // ffprobe 原始字段名 yuv420p10le 摆在这里没人看得懂，
            // 换成「10-bit 色深（渐变更细腻）」这类说法
            var cd = F.colorDepth(v.pixFmt, v.bitDepth);
            if (cd) pushItem(cd.text, cd.title);
            var ch = F.chromaLabel(v.pixFmt);
            if (ch) pushItem(ch, v.pixFmt);

            pushItem(F.bitrate(v.bitrate));

            // 指定码率 / 目标大小可直接按码率换算；CRF 则必须采样实际编码。
            // CRF 没有采样结果之前宁可显示“分析中”，不能拿随便一个经验公式冒充准确预估。
            var est = t.meta && state.settings
                ? Core.estimateOutputSize(t.meta, state.settings) : null;
            if (state.settings.mode === 'crf' && t.status !== 'done') {
                if (t.sampleStatus === 'running' || t.sampleStatus === 'waiting') {
                    pushItem(tr('runtime.analysing', '正在采样分析…'));
                } else if (t.sampleStatus === 'deferred') {
                    pushItem(tr('runtime.analysisDeferred', '等待手动分析'));
                } else if (t.sampleEstimate) {
                    pushItem(tr('runtime.estimated', '预估 {{size}}', {
                        size: F.bytes(t.sampleEstimate.low) + '～' + F.bytes(t.sampleEstimate.high)
                    }), tr('runtime.sampleTooltip', '基于 {{count}} 段实测编码；中心值 {{size}}，不是保证值', {
                        count: t.sampleEstimate.sampleCount,
                        size: F.bytes(t.sampleEstimate.estimate)
                    }));
                } else if (t.sampleStatus === 'error') {
                    pushItem(tr('runtime.estimateUnavailable', '预估不可用'), t.sampleError || '采样编码失败');
                }
            } else if (est !== null && est !== undefined && t.status !== 'done') {
                pushItem(tr('runtime.estimated', '预估 {{size}}', { size: F.bytes(est) }));
            }
            meta.innerHTML = items.join('<span class="sep">·</span>');
        } else {
            meta.textContent = t.path;
        }

        // 结果行
        var result = view.result;
        result.className = 'task-result';
        if (t.status === 'done' && t.outputSize !== null) {
            var orig = t.meta ? t.meta.size : 0;
            var relation = F.sizeRelation(orig, t.outputSize);
            result.textContent = tr('runtime.completed', '完成：{{original}} → {{output}}（{{change}}）', {
                original: F.bytes(orig),
                output: F.bytes(t.outputSize),
                change: spaceChangeText(orig, t.outputSize, relation, false)
            });
            result.classList.add(relation === 'smaller' ? 'saved' : relation === 'larger' ? 'bigger' : 'same');
            // Eagle 报告替换成功、但文件大小对不上 —— 明说，别让用户以为压好了
            if (t.replaceSuspect) {
                result.textContent += ' ⚠ Eagle 说替换成功，但文件大小对不上，请确认素材是否更新';
                result.classList.add('warn');
            }
        } else if (t.status === 'error' || t.status === 'incompatible') {
            result.textContent = t.error;
            result.classList.add('error');
        } else if (t.status === 'cancelled') {
            result.textContent = tr('runtime.cancelled', '已取消');
        } else {
            result.textContent = '';
        }

        // 进度
        view.fill.style.width = t.progress + '%';
        view.pct.textContent = t.progress > 0 ? t.progress + '%' : '';
        view.live.textContent = t.liveInfo || '';
    }

    function escapeHtml(s) {
        return String(s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    /** 汇总一句话，给通知 / 状态栏用。例如「省 42.3%（1.2 GB）」 */
    function summaryText() {
        var done = state.tasks.filter(function (t) { return t.status === 'done'; });
        var orig = 0, final = 0;
        done.forEach(function (t) {
            orig += (t.meta ? t.meta.size : 0);
            final += (t.outputSize || 0);
        });
        if (!done.length || orig === 0) return '—';
        return spaceChangeText(orig, final, F.sizeRelation(orig, final), false);
    }

    function renderSummary() {
        var done = state.tasks.filter(function (t) { return t.status === 'done'; });
        var pending = state.tasks.filter(function (t) {
            return t.meta && t.status !== 'done' && t.status !== 'error' && t.status !== 'incompatible';
        });
        var orig = 0, final = 0;

        done.forEach(function (t) {
            orig += (t.meta ? t.meta.size : 0);
            final += (t.outputSize || 0);
        });

        // 未开始压缩时优先展示“将会得到什么”，而不是空着三个破折号。
        // 实际压缩结束后仍显示真实产物，避免把预估和事实混在一起。
        var hasPreview = !done.length && pending.length;
        if (hasPreview) {
            var totalOriginal = pending.reduce(function (sum, t) { return sum + t.meta.size; }, 0);
            var low = 0, high = 0, center = 0;
            var allReady = true;
            var analysing = false;

            pending.forEach(function (t) {
                if (state.settings.mode === 'crf') {
                    if (!t.sampleEstimate) {
                        allReady = false;
                        if (t.sampleStatus === 'running' || t.sampleStatus === 'waiting') analysing = true;
                        return;
                    }
                    low += t.sampleEstimate.low;
                    high += t.sampleEstimate.high;
                    center += t.sampleEstimate.estimate;
                } else {
                    var est = Core.estimateOutputSize(t.meta, state.settings);
                    if (est === null || est === undefined) { allReady = false; return; }
                    low += est;
                    high += est;
                    center += est;
                }
            });

            dom.sumOriginal.textContent = F.bytes(totalOriginal);
            dom.sumFinalLabel.textContent = tr('ui.estimatedTotal', '预计压缩后总大小');
            if (allReady) {
                dom.sumFinal.textContent = state.settings.mode === 'crf'
                    ? F.bytes(low) + '～' + F.bytes(high)
                    : F.bytes(center);
                // CRF 的预估是区间：只有整个区间都小于 / 大于原片才着色。
                // 区间跨过原始体积时结果不确定，使用普通黑/白文字而非误导性绿/红。
                var previewRelation = state.settings.mode === 'crf'
                    ? F.sizeRangeRelation(totalOriginal, low, high)
                    : F.sizeRelation(totalOriginal, center);
                setSummarySpaceRelation(previewRelation);
                dom.sumSaved.textContent = spaceChangeText(totalOriginal, center, previewRelation, true);
                dom.estimateNote.hidden = false;
                dom.estimateNote.classList.remove('warn');
                dom.estimateNote.textContent = state.settings.mode === 'crf'
                    ? tr('runtime.estimatedBySampling', 'CRF 预估基于每个视频的分层采样实测；区间不是保证值。')
                    : tr('runtime.estimatedBySettings', '按当前设定的码率与音频参数换算。');
            } else {
                dom.sumFinal.textContent = analysing
                    ? tr('runtime.analysisInProgress', '分析中…')
                    : tr('runtime.waitingAnalysis', '等待分析');
                dom.sumSaved.textContent = '—';
                setSummarySpaceRelation('same');
                dom.estimateNote.hidden = false;
                dom.estimateNote.classList.remove('warn');
                dom.estimateNote.textContent = analysing
                    ? tr('runtime.samplingInProgress', '正在用当前参数采样编码，完成后会显示预计体积区间。')
                    : tr('runtime.waitingMetadata', '等待视频信息读取完成后开始预估。');
            }
        } else {
            dom.sumOriginal.textContent = done.length ? F.bytes(orig) : '—';
            dom.sumFinalLabel.textContent = tr('ui.compressedTotal', '压缩后总大小');
            dom.sumFinal.textContent = done.length ? F.bytes(final) : '—';
            if (done.length && orig > 0) {
                var actualRelation = F.sizeRelation(orig, final);
                setSummarySpaceRelation(actualRelation);
                dom.sumSaved.textContent = spaceChangeText(orig, final, actualRelation, false);
            } else {
                dom.sumSaved.textContent = '—';
                setSummarySpaceRelation('same');
            }
            dom.estimateNote.hidden = true;
            dom.estimateNote.textContent = '';
        }

        // 列表统计
        var ready = state.tasks.filter(function (t) { return t.meta && t.status !== 'error'; });
        var totalSize = ready.reduce(function (a, t) { return a + t.meta.size; }, 0);
        dom.listStat.textContent = state.tasks.length
            ? tr('runtime.listStat', '共 {{count}} 个 · 合计 {{size}}', {
                count: state.tasks.length, size: F.bytes(totalSize)
            }) + (done.length ? tr('runtime.listStatDone', ' · 已完成 {{count}}', { count: done.length }) : '')
            : tr('ui.noFiles', '尚未添加文件');

        updateButtons();
    }

    function updateButtons() {
        var hasTask = state.tasks.length > 0;
        var runnable = state.tasks.some(function (t) {
            return t.meta && (t.status === 'queued' || t.status === 'error' || t.status === 'incompatible');
        });
        dom.btnStart.disabled = state.running || !runnable || !state.ready;
        dom.btnCancel.disabled = !state.running;
        dom.btnClear.disabled = state.running || !hasTask;
        dom.btnAddFiles.disabled = state.running || !state.ready;
        // 选备份目录的按钮不受备份勾选框限制 —— 顺序是先选目录、后启用勾选，
        // 反过来就成了「想开备份先得勾上，但勾上了才能选目录」的死锁。
        dom.btnPickBackup.disabled = state.running;
        if (dom.btnTheme) dom.btnTheme.disabled = false;
        if (dom.btnResetSettings) dom.btnResetSettings.disabled = state.running;
    }

    function removeTask(id) {
        cancelSamplingEstimates();
        state.tasks = state.tasks.filter(function (t) { return t.id !== id; });
        renderList();
        refreshEstimate();
    }

    function setStatus(text, kind) {
        var el = dom.ffmpegStatus;
        el.className = 'ffmpeg-status ' + (kind || '');
        el.querySelector('.txt').textContent = text;
        // 状态栏宽度有限，长文案会被省略号截断，这里挂 title 保证悬停能看全
        el.title = text;
    }

    /**
     * 失败态专用：改状态栏 + 自动展开日志抽屉。
     *
     * FFmpeg 找不到时插件等于完全不可用，与其让用户在界面上干瞪眼猜原因，
     * 不如直接把日志铺开。用户原话就是「我不知道怎么排查，怎么看日志」——
     * 让答案自己弹出来，比让他去找「日志」按钮靠谱。
     */
    function failStatus(text, err) {
        setStatus(text + '（日志已展开，可点「复制诊断信息」发给我）', 'error');
        if (err) log('error', text, err);
        try {
            if (window.LogUI && typeof window.LogUI.show === 'function') window.LogUI.show(true);
        } catch (e) { /* 抽屉不可用就算了，状态栏消息已经说明问题 */ }
    }

    // -----------------------------------------------------------------
    // 执行
    // -----------------------------------------------------------------
    function pendingTasks() {
        return state.tasks.filter(function (t) {
            return t.meta && (t.status === 'queued' || t.status === 'error' || t.status === 'incompatible');
        });
    }

    function showConfirm(tasks, settings) {
        var totalSize = tasks.reduce(function (a, t) { return a + (t.meta ? t.meta.size : 0); }, 0);

        // 备份只有在「勾选了 + 指定了目录」两者都成立时才算真的开着。
        // 只看 settings.backup 会在「勾了但没目录」时谎报平安，
        // 而这是整个流程里唯一一条不可逆的操作。
        var backupOn = !!(settings.backup && settings.backupDir);

        var warnHtml = '';
        warnHtml += '<b>⚠️ 本操作会直接替换原文件</b><br>';
        warnHtml += '共 <b>' + tasks.length + '</b> 个视频，原始合计 <b>' + F.bytes(totalSize) + '</b><br>';
        warnHtml += backupOn
            ? '已开启备份：原文件会先复制到 <b>' + escapeHtml(settings.backupDir) + '</b>'
            : '<b style="color:var(--danger)">未开启备份，原文件将无法恢复</b>';
        if (settings.replaceInEagle) {
            warnHtml += '<br>完成后会同步回 Eagle 素材并刷新缩略图';
        }
        dom.confirmWarn.innerHTML = warnHtml;

        var list = tasks.slice(0, 12).map(function (t) {
            return '<div class="confirm-item"><span class="ci-name">' + escapeHtml(t.name) +
                '</span><span class="ci-size">' + F.bytes(t.meta ? t.meta.size : 0) + '</span></div>';
        }).join('');
        if (tasks.length > 12) {
            list += '<div class="confirm-more">…以及另外 ' + (tasks.length - 12) + ' 个文件</div>';
        }
        dom.confirmList.innerHTML = list;

        dom.confirmMask.hidden = false;
    }

    function start() {
        var settings = readSettingsFromUI();
        saveSettings();

        var tasks = pendingTasks();
        if (!tasks.length) return;

        showConfirm(tasks, settings);
    }

    // 进度事件可能每秒到几十次。只刷新进度相关 DOM，并做 120ms 节流，
    // 避免长列表 + 多 worker 时反复重建元信息行和查询节点。
    var progressRenderTimer = null;
    var progressRenderQueue = {};

    function scheduleProgressRender(t) {
        if (!t || !t.id) return;
        progressRenderQueue[t.id] = t;
        if (progressRenderTimer) return;
        progressRenderTimer = setTimeout(function () {
            var queue = progressRenderQueue;
            progressRenderQueue = {};
            progressRenderTimer = null;
            Object.keys(queue).forEach(function (id) {
                var task = queue[id];
                if (!task || !task.view) return;
                task.view.fill.style.width = task.progress + '%';
                task.view.pct.textContent = task.progress > 0 ? task.progress + '%' : '';
                task.view.live.textContent = task.liveInfo || '';
            });
        }, 120);
    }

    /** 通知空闲 worker：追加素材探测完毕、或用户请求取消时都需要唤醒它们。 */
    function signalRunSession(session) {
        if (!session || !session.waiters || !session.waiters.length) return;
        var waiters = session.waiters.splice(0);
        waiters.forEach(function (resolve) { resolve(); });
    }

    function waitForRunSessionWork(session) {
        return new Promise(function (resolve) { session.waiters.push(resolve); });
    }

    function doStart() {
        // 已经在跑就直接忽略。这是最后一道防线：即便上层因为事件重复绑定
        // 等原因调用了两次，也绝不能起第二个并发队列 —— 两个队列会各自
        // 从 0 开始取任务，导致同一批文件被压两遍（二次压缩 + 并发写同一路径）。
        if (state.running) return;

        dom.confirmMask.hidden = true;

        var settings = readSettingsFromUI();
        var tasks = pendingTasks();
        if (!tasks.length) return;

        // 正式压缩优先级高于预览分析：先杀掉采样进程，避免和正式编码抢 CPU。
        cancelSamplingEstimates();
        state.running = true;
        state.cancelToken = { cancelled: false };
        updateButtons();

        // 先把待跑的任务标记为排队中，清掉上一轮的错误
        tasks.forEach(function (t) {
            t.status = 'queued';
            t.error = '';
            t.progress = 0;
            t.outputSize = null;
            t.liveInfo = '';
            renderTask(t);
        });

        var cpuCount = 1;
        try { cpuCount = (os.cpus && os.cpus().length) || 1; } catch (e) {}
        var concurrency = Core._internal.recommendedWorkerCount(settings, cpuCount, tasks.length);
        // 不写回持久化设置：这是本次运行的资源预算，不是替用户修改“同时处理”偏好。
        var runtimeSettings = {};
        Object.keys(settings).forEach(function (key) { runtimeSettings[key] = settings[key]; });
        runtimeSettings.runtimeThreads = Core._internal.recommendedThreadCount(cpuCount, concurrency);
        log('info', '编码资源预算：用户上限 ' + settings.concurrency + '，实际 worker ' + concurrency +
            '，每 worker ' + runtimeSettings.runtimeThreads + ' 线程（CPU ' + cpuCount + ' 核）');

        // queue 是活的：用户在 Eagle 里重新选择素材并点「加入任务队列」后，
        // 新素材会在 ffprobe 完成时推入这里，空闲 worker 会继续取下一条。
        var session = state.runSession = {
            queue: tasks.slice(),
            pendingProbes: 0,
            waiters: []
        };

        function worker() {
            return (function next() {
                if (state.cancelToken.cancelled) return Promise.resolve();
                var t = session.queue.shift();
                if (t) {
                    return runTask(t, runtimeSettings)
                        .then(function () {
                            renderSummary();
                            return next();
                        });
                }
                // 追加的素材正在读取信息时，不能让 worker 提前结束；等它入队或探测失败。
                if (session.pendingProbes > 0) {
                    return waitForRunSessionWork(session).then(next);
                }
                return Promise.resolve();
            })();
        }

        var workers = [];
        for (var i = 0; i < concurrency; i++) workers.push(worker());

        state.runPromise = Promise.all(workers)
            .then(function () {
                state.running = false;
                state.runSession = null;
                renderSummary();
                updateButtons();

                var done = state.tasks.filter(function (t) { return t.status === 'done'; }).length;
                var failed = state.tasks.filter(function (t) {
                    return t.status === 'error' || t.status === 'incompatible';
                }).length;

                if (state.cancelToken.cancelled) {
                    setStatus('已取消', 'warn');
                } else if (failed) {
                    setStatus('完成 ' + done + ' 个，' + failed + ' 个未成功', 'warn');
                } else {
                    setStatus('全部完成：' + done + ' 个', 'ok');
                }

                if (eagle && eagle.notification && done > 0 && !state.cancelToken.cancelled) {
                    try {
                        // 字段名必须是 body。官方文档 notification.show 的 options
                        // 只有 title / body / icon / mute / duration 五个，
                        // 写成 description 会被忽略，通知正文显示为空。
                        eagle.notification.show({
                            title: tr('runtime.notificationTitle', '视频压缩完成'),
                            body: tr('runtime.notificationBody', '共处理 {{count}} 个视频，{{change}}', {
                                count: done,
                                change: summaryText()
                            }),
                            mute: true
                        });
                    } catch (e) { /* 通知失败不影响主流程 */ }
                }
            });
    }

    /**
     * 单个任务的完整流程。
     * 安全策略：先编码到临时文件 → 校验 → 备份原文件 → 替换。
     * 任何一步失败，原文件都不会被改动。
     */
    function runTask(t, settings) {
        // 可写时优先在源文件同目录生成中间产物。最终仍然要经过完整校验，
        // 但同卷替换避免了“系统临时目录 → 外置盘/网络盘”额外复制一次大文件。
        // 目录不可写时 Core 会安全回退到系统临时目录。
        var tempDir = Core._internal.preferredTempDir(t.path);
        var tmpOut = path.join(tempDir, 'eagle-vc-out-' + t.id + t.ext);
        var passPrefix = path.join(tempDir, 'eagle-vc-pass-' + t.id);
        var passLogs = [passPrefix + '-0.log', passPrefix + '-0.log.mbtree'];

        function cleanup() {
            return unlinkQuiet(tmpOut)
                .then(function () { return Promise.all(passLogs.map(unlinkQuiet)); })
                .then(function () { return Promise.resolve(); });
        }

        t.status = 'running';
        t.progress = 0;
        t.liveInfo = '';
        t.error = '';
        renderTask(t);

        var tStart = Date.now();
        log('info', '[' + t.name + '] 开始处理 | ' + F.bytes(t.meta.size) + ' | ' +
            (t.meta.video ? t.meta.video.width + 'x' + t.meta.video.height + ' ' +
                F.codecName(t.meta.video.codec) : '无视频流') +
            ' | 目标: ' + settings.codec + ' / ' + settings.mode);

        // 1) 预检：目标编码能否写进原容器
        var check = Core.validatePlan(t.meta, settings);
        if (!check.ok) {
            t.status = 'incompatible';
            t.error = check.reason + (check.suggestion ? '。' + check.suggestion : '');
            log('warn', '[' + t.name + '] 预检不通过，已跳过: ' + t.error);
            renderTask(t);
            return Promise.resolve();
        }

        // 2) 编码
        var plan;
        try {
            plan = Core.buildPlan(t.meta, settings, tmpOut, passPrefix);
        } catch (err) {
            t.status = 'error';
            t.error = err.message;
            log('error', '[' + t.name + '] 构建编码参数失败', err);
            renderTask(t);
            return Promise.resolve();
        }

        return Core.executePlan(state.bins, plan, t.meta, {
            cancelToken: state.cancelToken,
            onProgress: function (pct, info) {
                t.progress = pct;
                var bits = [];
                if (info.totalPass > 1) bits.push('第 ' + info.pass + '/' + info.totalPass + ' 遍');
                if (info.outSize > 0) bits.push('已输出 ' + F.bytes(info.outSize));
                // ffmpeg 的 -progress 输出形如 speed=0.621x，本身已带 x。
                // 早先这里无条件再拼一个，界面上会显示成「0.621xx」。
                if (info.speed) {
                    bits.push(/x$/i.test(info.speed) ? info.speed : info.speed + 'x');
                }
                t.liveInfo = bits.join(' · ');
                scheduleProgressRender(t);
            }
        })
            // 3) 校验产物
            .then(function () {
                return Core.verifyOutput(state.bins, tmpOut, t.meta.duration);
            })
            .then(function () {
                if (state.cancelToken.cancelled) throw Core.CancelledError();

                // 4) 备份原文件
                //    目录为空时静默跳过：勾选框在没目录的情况下是禁用的，
                //    正常走不到这里。真走到了也不能因为「备份没配好」就把
                //    整个压缩判失败 —— 但必须留一条日志，事后查得到。
                if (!settings.backup) return null;
                if (!settings.backupDir) {
                    log('warn', '[' + t.name + '] 已勾选备份但未指定目录，本次跳过备份');
                    return null;
                }
                try {
                    if (!fs.existsSync(settings.backupDir)) fs.mkdirSync(settings.backupDir, { recursive: true });
                } catch (e) {
                    throw new Error('无法创建备份目录：' + settings.backupDir + '（' + e.message + '）');
                }
                var backupPath = uniquePath(settings.backupDir, t.name);
                return copyFileAsync(t.path, backupPath);
            })
            .then(function () {
                if (state.cancelToken.cancelled) throw Core.CancelledError();

                // 5) 替换原文件
                //    优先走 Eagle 的 replaceFile（会自动刷新缩略图并保持素材元数据一致）；
                //    失败或未关联 Eagle 素材时，退回直接覆盖。
                if (settings.replaceInEagle && t.eagleItem && typeof t.eagleItem.replaceFile === 'function') {
                    // 先把产物大小记下来，用于事后核对 replaceFile 到底有没有干活
                    var tmpSize = null;
                    try { tmpSize = fs.statSync(tmpOut).size; } catch (e) { /* 拿不到就算了 */ }

                    return Promise.resolve()
                        .then(function () { return t.eagleItem.replaceFile(tmpOut); })
                        .then(function (ok) {
                            if (ok === false) throw new Error('replaceFile 返回 false');

                            // 【核对】Eagle 说替换成功了，但文件真的变了吗？
                            // 不能只信返回值：万一某些版本/某些库状态下 replaceFile 是空操作，
                            // 界面会显示「完成，节省 0.0%」，而原文件其实纹丝未动 ——
                            // 用户根本看不出哪里不对。这里只打警告不判失败，
                            // 既不打断正常流程，又给排查留一条线索。
                            if (tmpSize) {
                                var now = null;
                                try { now = fs.statSync(t.path).size; } catch (e) { /* 忽略 */ }
                                if (now !== null && now !== tmpSize) {
                                    t.replaceSuspect = true;
                                    log('warn', '[' + t.name + '] Eagle 报告替换成功，但文件大小对不上' +
                                        '（产物 ' + F.bytes(tmpSize) + ' / 现文件 ' + F.bytes(now) + '），' +
                                        '请确认素材是否真的更新了');
                                }
                            }
                            return true;
                        })
                        .catch(function () {
                            // 退回方案：直接覆盖文件并手动刷新缩略图
                            return atomicReplaceFileAsync(tmpOut, t.path, state.cancelToken).then(function () {
                                if (t.eagleItem && typeof t.eagleItem.refreshThumbnail === 'function') {
                                    return Promise.resolve(t.eagleItem.refreshThumbnail()).catch(function () {});
                                }
                            }).then(function () { return false; });
                        });
                }

                return atomicReplaceFileAsync(tmpOut, t.path, state.cancelToken).then(function () {
                    if (t.eagleItem && typeof t.eagleItem.refreshThumbnail === 'function') {
                        return Promise.resolve(t.eagleItem.refreshThumbnail()).catch(function () {});
                    }
                }).then(function () { return false; });
            })
            .then(function () {
                // 6) 记录结果
                //    statSync 可能因为文件被 Eagle 挪走 / 权限 / 竞态而抛错，
                //    但此时压缩其实已经成功了。不能让「读一下大小」把整个任务打成失败，
                //    拿不到就记 null，汇总时按 0 处理并显示「—」。
                t.outputSize = null;
                try {
                    t.outputSize = fs.statSync(t.path).size;
                } catch (e) {
                    log('warn', '[' + t.name + '] 无法读取输出文件大小：' +
                        (e && e.message ? e.message : e));
                }
                t.progress = 100;
                t.liveInfo = '';
                t.status = 'done';
                var sizePart = (t.outputSize === null)
                    ? F.bytes(t.meta.size) + ' → 未知'
                    : F.bytes(t.meta.size) + ' → ' + F.bytes(t.outputSize) +
                      ' | ' + spaceChangeText(t.meta.size, t.outputSize,
                          F.sizeRelation(t.meta.size, t.outputSize), false);
                log('info', '[' + t.name + '] 完成 | ' + sizePart +
                    ' | 耗时 ' + ((Date.now() - tStart) / 1000).toFixed(1) + 's');
                renderTask(t);
                return cleanup();
            })
            .catch(function (err) {
                if (err && err.cancelled) {
                    t.status = 'cancelled';
                    t.liveInfo = '';
                    log('info', '[' + t.name + '] 已取消；未进入提交阶段，原文件保持不变');
                } else {
                    t.status = 'error';
                    t.error = err && err.message ? err.message : String(err);
                    t.liveInfo = '';
                    log('error', '[' + t.name + '] 失败（未成功提交时原文件保持不变）', err);
                }
                renderTask(t);
                return cleanup();
            });
    }

    /**
     * 立即停止当前编码，并把尚未启动的任务标成已取消。
     *
     * FFmpeg 子进程会由 cancelToken 终止；runPromise 则等到子进程退出、产物清理完成。
     * 返回该 Promise，给“取消当前所有任务并重新添加”安全地串联下一批素材。
     */
    function cancel() {
        if (!state.running) return Promise.resolve();
        state.cancelToken.cancelled = true;
        cancelSamplingEstimates();
        state.tasks.forEach(function (t) {
            if (t.status === 'pending' || t.status === 'probing' || t.status === 'queued') {
                t.status = 'cancelled';
                t.liveInfo = '';
                renderTask(t);
            }
        });
        if (state.runSession) {
            state.runSession.queue = [];
            signalRunSession(state.runSession);
        }
        dom.btnCancel.disabled = true;
        setStatus(tr('runtime.cancelling', '正在停止并取消任务…'), 'warn');
        log('info', '用户请求停止并取消当前任务队列');
        return state.runPromise || Promise.resolve();
    }

    // -----------------------------------------------------------------
    // 载入来源
    // -----------------------------------------------------------------
    /**
     * 从 Eagle 读取选中素材。
     *
     * 外面套了超时：Eagle 的 API 走 IPC，依赖插件没响应时返回的 Promise
     * 可能永远不 settle（之前 FFmpeg 定位就栽在这上面）。不设上限的话，
     * 界面会一直停在「还没载入」，用户只能干等。
     */
    /** 读取当前 Eagle 选中素材；只负责读取，不直接修改任务列表。 */
    function getSelectedEagleItems(opts) {
        opts = opts || {};
        var quiet = !!opts.quiet;
        if (!eagle || !eagle.item || typeof eagle.item.getSelected !== 'function') {
            if (!quiet) setStatus(tr('runtime.eagleSelectionUnavailable', '当前 Eagle 环境不提供素材读取能力'), 'warn');
            return Promise.resolve(null);
        }

        // 调用本身也可能同步抛异常；放进 then 才能与异步 reject 共用同一条 catch。
        var p = Promise.resolve().then(function () { return eagle.item.getSelected(); });
        if (Core && Core._internal && typeof Core._internal.withTimeout === 'function') {
            p = Core._internal.withTimeout(p, 8000, null);
        }
        return p.then(function (items) {
            if (items === null || items === undefined) {
                log('warn', '读取 Eagle 选中素材超时（8s）');
                if (!quiet) setStatus(tr('runtime.eagleSelectionTimeout', '读取 Eagle 素材超时，请重试'), 'error');
                return null;
            }
            return Array.isArray(items) ? items : [];
        }).catch(function (err) {
            var msg = tr('runtime.eagleSelectionFailed', '读取 Eagle 素材失败：{{message}}', {
                message: err && err.message ? err.message : err
            });
            if (!quiet) setStatus(msg, 'error');
            log('warn', msg);
            return null;
        });
    }

    /** 仅保留可处理、且当前列表尚未包含的 Eagle 视频素材。 */
    function freshEagleVideoItems(items) {
        return (items || []).filter(function (it) {
            return it && it.filePath && Core.isVideoFile(it.filePath) &&
                !state.tasks.some(function (t) { return t.path === it.filePath; });
        });
    }

    function addEagleItems(items, source) {
        var fresh = freshEagleVideoItems(items);
        if (!fresh.length) return 0;
        var n = addFiles(fresh.map(function (it) { return it.filePath; }), fresh);
        if (n > 0) {
            var action = source === 'append'
                ? tr('runtime.appendedToQueue', '已将 {{count}} 个新素材加入任务队列', { count: n })
                : tr('runtime.autoLoaded', '已自动载入 {{count}} 个素材', { count: n });
            setStatus(action, 'ok');
            log('info', (source === 'append' ? '追加' : '自动导入') + ' Eagle 选中素材 ' + n + ' 个');
        }
        return n;
    }

    function loadFromEagle(opts) {
        opts = opts || {};
        var quiet = !!opts.quiet;
        return getSelectedEagleItems(opts).then(function (items) {
            if (items === null) {
                if (!state.tasks.length) {
                    emptyHint = '读不到 Eagle 素材列表，请用「添加本地文件…」或拖拽视频进来';
                    renderList();
                }
                return;
            }
            if (!items.length) {
                if (!quiet) setStatus(tr('runtime.noEagleSelection', 'Eagle 里没有选中任何素材'), 'warn');
                else log('info', '自动导入：Eagle 里没有选中素材');
                if (!state.tasks.length) {
                    emptyHint = 'Eagle 里没有选中素材 —— 先去 Eagle 里选中视频，再打开本插件';
                    renderList();
                }
                return;
            }
            var n = addEagleItems(items, 'auto');
            if (!n && !state.tasks.length) {
                if (!quiet) setStatus(tr('runtime.noProcessableVideos', '选中的素材里没有可处理的视频'), 'warn');
                emptyHint = '这 ' + items.length + ' 个素材不是可处理的视频文件';
                renderList();
            } else if (!n && !quiet) {
                setStatus(tr('runtime.alreadyInQueue', '这些素材已经在列表里了'), 'ok');
            }
        });
    }

    /**
     * 插件窗口重新显示时调用。
     *
     * 列表为空时自动导入；列表非空时只读取当前 Eagle 选择，发现新视频则让用户
     * 明确决定取消本次、替换全部任务或追加到队列，绝不悄悄覆盖已有任务。
     */
    var pendingSelection = null;
    // Eagle 的 onPluginRun / onPluginShow 可能在一次打开中连续触发；用递增版本丢弃
    // 晚返回的读取结果，避免用户刚点“取消此次操作”又被陈旧 Promise 重新弹窗。
    var selectionRequestVersion = 0;

    function selectionSignature(items) {
        return (items || []).map(function (it) { return it.filePath; }).sort().join('|');
    }

    function showSelectionDecision(items) {
        var fresh = freshEagleVideoItems(items);
        if (!fresh.length) return;
        var signature = selectionSignature(fresh);
        if (!dom.selectionMask || (pendingSelection && pendingSelection.signature === signature && !dom.selectionMask.hidden)) return;

        pendingSelection = { items: fresh, signature: signature };
        var activeCount = state.tasks.filter(function (t) {
            return t.status === 'queued' || t.status === 'probing' || t.status === 'pending' || t.status === 'running';
        }).length;
        dom.selectionDescription.textContent = tr('runtime.selectionDecisionDescription',
            '当前列表已有 {{current}} 个任务，检测到 {{incoming}} 个新的 Eagle 视频素材。请选择如何处理：', {
                current: state.tasks.length, incoming: fresh.length
            });
        var names = fresh.slice(0, 8).map(function (it) {
            return '<div class="selection-item">' + escapeHtml(path.basename(it.filePath)) + '</div>';
        }).join('');
        if (fresh.length > 8) {
            names += '<div class="selection-more">' + escapeHtml(tr('runtime.selectionMore', '…以及另外 {{count}} 个素材', {
                count: fresh.length - 8
            })) + '</div>';
        }
        dom.selectionList.innerHTML = names;
        dom.selectionMask.hidden = false;
        log('info', '重新打开插件时检测到 ' + fresh.length + ' 个新 Eagle 素材；当前任务 ' + activeCount + ' 个');
    }

    function dismissSelectionDecision() {
        // 主动关闭意味着当前读取结果已无效；所有尚未返回的读取都不得重新打开弹层。
        selectionRequestVersion++;
        pendingSelection = null;
        if (dom.selectionMask) dom.selectionMask.hidden = true;
    }

    function appendSelectionToQueue() {
        if (!pendingSelection) return;
        var items = pendingSelection.items;
        dismissSelectionDecision();
        addEagleItems(items, 'append');
    }

    function replaceQueueWithSelection() {
        if (!pendingSelection) return;
        var items = pendingSelection.items;
        dismissSelectionDecision();
        var replace = function () {
            cancelSamplingEstimates();
            state.tasks = [];
            autoLoadDone = true;
            renderList();
            renderSummary();
            var n = addEagleItems(items, 'append');
            setStatus(tr('runtime.replacedWithSelection', '已取消当前任务，并载入 {{count}} 个新素材', { count: n }), 'ok');
            log('info', '已取消当前所有任务，并替换为 ' + n + ' 个新 Eagle 素材');
        };
        if (state.running) {
            setStatus(tr('runtime.cancellingForReplacement', '正在停止当前任务，随后载入新素材…'), 'warn');
            cancel().then(replace);
        } else {
            replace();
        }
    }

    function onShow() {
        if (!state.ready) return;
        var requestVersion = ++selectionRequestVersion;
        if (!state.tasks.length) {
            autoLoadDone = false;   // 列表已经空了，允许再自动导入一次
            autoLoadFromEagle();
            return;
        }
        // 列表非空时也要读取当前 Eagle 选择，但绝不直接覆盖用户的队列。
        // 发现新的可处理视频后，交给明确的三选项弹层决定。
        getSelectedEagleItems({ quiet: true }).then(function (items) {
            if (requestVersion !== selectionRequestVersion) return;
            if (items && freshEagleVideoItems(items).length) showSelectionDecision(items);
        });
    }

    /** 已经自动导入过一轮，避免 init 被重复触发时反复导入 */
    var autoLoadDone = false;

    /**
     * 打开插件时自动导入 Eagle 选中的素材。
     *
     * 这是本插件最主要的用法：在 Eagle 里选中几个视频 → 打开插件 → 直接开始。
     * 中间那次「载入 Eagle 选中素材」的点击纯属多余，按钮已经删掉了。
     *
     * 做了两道防重：列表非空、或本轮已导入过就不再动手。init 有多个入口
     * （window.onload / onPluginRun / 轮询兜底），而且在初始化失败重试时
     * 会被调第二次 —— 不加闸就会连着导两遍。
     */
    function autoLoadFromEagle() {
        if (state.tasks.length || autoLoadDone) return;

        if (!eagle) {
            emptyHint = '当前不在 Eagle 环境中，请用「添加本地文件…」或拖拽视频进来';
            renderList();
            return;
        }
        autoLoadDone = true;
        loadFromEagle({ quiet: true });
    }

    function addLocalFiles() {
        if (!eagle || !eagle.dialog) return;
        Promise.resolve(eagle.dialog.showOpenDialog({
            properties: ['openFile', 'multiSelections'],
            filters: [{ name: tr('runtime.selectVideoFilter', '视频文件'), extensions: Core.VIDEO_EXTENSIONS.map(function (e) { return e.slice(1); }) }]
        }))
            .then(function (result) {
                if (!result || !result.filePaths || !result.filePaths.length) return;
                var n = addFiles(result.filePaths, null);
                if (n > 0) setStatus('已添加 ' + n + ' 个文件', 'ok');
            })
            .catch(function () { /* 用户取消 */ });
    }

    function pickBackupDir() {
        if (!eagle || !eagle.dialog) return;
        Promise.resolve(eagle.dialog.showOpenDialog({
            properties: ['openDirectory', 'createDirectory']
        }))
            .then(function (result) {
                if (!result || !result.filePaths || !result.filePaths[0]) return;
                state.settings.backupDir = result.filePaths[0];

                // 用户特意选了个备份目录，意图已经很明确了 —— 顺手勾上，
                // 省得他还要再点一次，也避免「选了目录却没生效」的困惑。
                state.settings.backup = true;
                dom.chkBackup.checked = true;

                refreshBackupUI();
                saveSettings();
                setStatus('备份位置已设置：' + state.settings.backupDir, 'ok');
                log('info', '备份目录设置为 ' + state.settings.backupDir + '，已自动开启备份');
            })
            .catch(function () { /* 用户取消 */ });
    }

    // -----------------------------------------------------------------
    // 事件绑定
    // -----------------------------------------------------------------
    // 事件绑定只能做一次。addEventListener 是累加的，init 被重复调用时
    // （插件有多个初始化入口、或初始化中途抛错后重试）会把监听器绑两遍，
    // 其中最要命的是「确认开始」——点一次会起两个并发队列压同一批文件。
    var eventsBound = false;

    function bindEvents() {
        if (eventsBound) return;
        eventsBound = true;

        // 注意：这里不再有「载入 Eagle 选中素材」按钮 —— 打开插件时自动导入。
        dom.btnAddFiles.addEventListener('click', addLocalFiles);
        dom.btnTheme.addEventListener('click', cycleTheme);
        dom.btnResetSettings.addEventListener('click', resetSettings);
        dom.btnClear.addEventListener('click', function () {
            if (state.running) return;
            cancelSamplingEstimates();
            state.tasks = [];
            renderList();
            renderSummary();
        });
        dom.btnStart.addEventListener('click', start);
        dom.btnCancel.addEventListener('click', cancel);
        dom.btnAnalyzeAll.addEventListener('click', function () {
            scheduleSamplingEstimates({ all: true, userRequested: true });
        });
        dom.btnStopAnalysis.addEventListener('click', stopSamplingEstimates);
        dom.btnPickBackup.addEventListener('click', pickBackupDir);

        dom.btnConfirmCancel.addEventListener('click', function () { dom.confirmMask.hidden = true; });
        dom.btnConfirmOk.addEventListener('click', doStart);
        dom.btnSelectionCancel.addEventListener('click', dismissSelectionDecision);
        dom.btnSelectionReplace.addEventListener('click', replaceQueueWithSelection);
        dom.btnSelectionAppend.addEventListener('click', appendSelectionToQueue);

        // 压缩方式切换
        document.querySelectorAll('#modeTabs button').forEach(function (b) {
            b.addEventListener('click', function () {
                if (b.disabled) return;
                document.querySelectorAll('#modeTabs button').forEach(function (x) { x.classList.remove('active'); });
                b.classList.add('active');
                var mode = b.getAttribute('data-mode');
                document.querySelectorAll('.mode-panel').forEach(function (p) {
                    p.classList.toggle('active', p.getAttribute('data-panel') === mode);
                });
                saveSettings();
                refreshEstimate();
            });
        });

        dom.selCodec.addEventListener('change', function () {
            refreshCodecUI();
            updateCrfValue();
            saveSettings();
            refreshEstimate();
        });
        dom.selSpeed.addEventListener('change', function () { saveSettings(); refreshEstimate(); });
        dom.selResolution.addEventListener('change', function () { saveSettings(); refreshEstimate(); });
        dom.selFps.addEventListener('change', function () { saveSettings(); refreshEstimate(); });
        dom.selAudioMode.addEventListener('change', function () {
            refreshAudioUI(); saveSettings(); refreshEstimate();
        });
        dom.selAudioBitrate.addEventListener('change', function () { saveSettings(); refreshEstimate(); });
        dom.selConcurrency.addEventListener('change', saveSettings);

        dom.rngCrf.addEventListener('input', function () { updateCrfValue(); });
        dom.rngCrf.addEventListener('change', function () { saveSettings(); refreshEstimate(); });
        dom.inpBitrate.addEventListener('change', function () { saveSettings(); refreshEstimate(); });
        dom.inpTargetSize.addEventListener('change', function () { saveSettings(); refreshEstimate(); });

        dom.chkBackup.addEventListener('change', function () {
            refreshBackupUI();
            saveSettings();
        });
        dom.chkReplaceInEagle.addEventListener('change', saveSettings);

        // 拖放添加文件
        window.addEventListener('dragover', function (e) { e.preventDefault(); });
        window.addEventListener('drop', function (e) {
            e.preventDefault();
            if (state.running) return;
            var files = e.dataTransfer && e.dataTransfer.files;
            if (!files || !files.length) return;
            var paths = Array.prototype.map.call(files, function (f) { return f.path; });
            var n = addFiles(paths, null);
            if (n > 0) setStatus('已添加 ' + n + ' 个文件', 'ok');
        });
    }

    // CRF 采样预估是后台低优先级工作。批量导入时不能对每条都立刻起 FFmpeg：
    // 默认只自动分析最前 3 条，其余由用户点「分析全部」按需展开。
    var AUTO_SAMPLE_LIMIT = 3;
    var sampleEstimateTimer = null;
    var sampleEstimateToken = null;
    var sampleEstimateRevision = 0;
    var sampleEstimateCache = {};

    /** 同一个文件 + 文件状态 + 当前视频编码设置，才能复用同一次会话内的采样结果。 */
    function sampleCacheKey(t) {
        if (!t || !t.meta) return '';
        var mtime = 0;
        try { mtime = fs.statSync(t.path).mtimeMs || 0; } catch (e) {}
        var s = state.settings || {};
        return [t.path, t.meta.size || 0, mtime, s.codec, s.speedIndex, s.resolution,
            s.customHeight, s.fps, s.audioMode, s.audioBitrate, s.mode, s.crf].join('|');
    }

    function updateSampleAnalysisControls() {
        if (!dom || !dom.sampleAnalysisControls) return;
        var candidates = state.tasks.filter(function (t) {
            return t.meta && t.status !== 'done' && t.status !== 'error' && t.status !== 'incompatible';
        });
        if (state.settings.mode !== 'crf' || !candidates.length) {
            dom.sampleAnalysisControls.hidden = true;
            return;
        }
        var ready = candidates.filter(function (t) { return t.sampleStatus === 'ready'; }).length;
        var active = candidates.filter(function (t) {
            return t.sampleStatus === 'waiting' || t.sampleStatus === 'running';
        }).length;
        var deferred = candidates.filter(function (t) { return t.sampleStatus === 'deferred'; }).length;
        dom.sampleAnalysisControls.hidden = false;
        dom.sampleAnalysisStatus.textContent = active
            ? tr('runtime.sampleProgress', '正在分析 {{ready}}/{{total}}', { ready: ready, total: candidates.length })
            : deferred
                ? tr('runtime.sampleLimited', '已分析 {{ready}}/{{total}}，其余按需分析', { ready: ready, total: candidates.length })
                : tr('runtime.sampleComplete', '已分析 {{ready}}/{{total}}', { ready: ready, total: candidates.length });
        dom.btnAnalyzeAll.disabled = state.running || (!deferred && !active);
        dom.btnStopAnalysis.disabled = !active;
    }

    function cancelSamplingEstimates() {
        sampleEstimateRevision++;
        if (sampleEstimateTimer) {
            clearTimeout(sampleEstimateTimer);
            sampleEstimateTimer = null;
        }
        if (sampleEstimateToken) sampleEstimateToken.cancelled = true;
        sampleEstimateToken = null;
        updateSampleAnalysisControls();
    }

    function stopSamplingEstimates() {
        cancelSamplingEstimates();
        state.tasks.forEach(function (t) {
            if (t.sampleStatus === 'waiting' || t.sampleStatus === 'running') {
                t.sampleStatus = 'deferred';
                t.liveInfo = '';
                renderTask(t);
            }
        });
        renderSummary();
        updateSampleAnalysisControls();
        setStatus(tr('runtime.analysisStopped', '已停止后台分析'), 'ok');
    }

    function scheduleSamplingEstimates(opts) {
        opts = opts || {};
        cancelSamplingEstimates();
        if (!state.ready || state.running || state.settings.mode !== 'crf') return;

        var tasks = state.tasks.filter(function (t) {
            return t.meta && t.status !== 'done' && t.status !== 'error' && t.status !== 'incompatible';
        });
        if (!tasks.length) return;

        var uncached = [];
        tasks.forEach(function (t) {
            var key = sampleCacheKey(t);
            var cached = key && sampleEstimateCache[key];
            t.sampleError = '';
            t.liveInfo = '';
            t.sampleCacheKey = key;
            if (cached) {
                t.sampleEstimate = cached;
                t.sampleStatus = 'ready';
            } else {
                t.sampleEstimate = null;
                uncached.push(t);
            }
        });

        // 默认少量自动分析；用户显式点击才铺开全部。
        var selected = opts.all ? uncached : uncached.slice(0, AUTO_SAMPLE_LIMIT);
        uncached.forEach(function (t) {
            t.sampleStatus = selected.indexOf(t) >= 0 ? 'waiting' : 'deferred';
            renderTask(t);
        });
        tasks.forEach(function (t) { renderTask(t); });
        renderSummary();
        updateSampleAnalysisControls();
        if (!selected.length) return;

        var revision = sampleEstimateRevision;
        sampleEstimateTimer = setTimeout(function () {
            sampleEstimateTimer = null;
            if (revision !== sampleEstimateRevision || state.running || state.settings.mode !== 'crf') return;

            var token = { cancelled: false };
            sampleEstimateToken = token;
            updateSampleAnalysisControls();
            var chain = Promise.resolve();

            selected.forEach(function (t) {
                chain = chain.then(function () {
                    if (token.cancelled || revision !== sampleEstimateRevision || state.running) return;
                    // 已被移出列表 / 已开始正式压缩的任务不再浪费 CPU。
                    if (state.tasks.indexOf(t) < 0 || !t.meta || t.status === 'done') return;

                    t.sampleStatus = 'running';
                    renderTask(t);
                    renderSummary();
                    updateSampleAnalysisControls();
                    log('info', '[' + t.name + '] 开始 CRF 采样预估');

                    return Core.estimateCrfBySampling(state.bins, t.meta, state.settings, {
                        cancelToken: token,
                        onProgress: function (info) {
                            if (token.cancelled || revision !== sampleEstimateRevision) return;
                            t.sampleStatus = 'running';
                            t.liveInfo = tr('runtime.sampleTaskProgress', '预估分析 {{index}}/{{total}}', {
                                index: info.index, total: info.total
                            });
                            scheduleProgressRender(t);
                        }
                    }).then(function (result) {
                        if (token.cancelled || revision !== sampleEstimateRevision || !result) return;
                        t.sampleEstimate = result;
                        t.sampleStatus = 'ready';
                        t.liveInfo = '';
                        if (t.sampleCacheKey) sampleEstimateCache[t.sampleCacheKey] = result;
                        log('info', '[' + t.name + '] CRF 预估完成：' +
                            F.bytes(result.low) + '～' + F.bytes(result.high) +
                            '（' + result.sampleCount + ' 段采样）');
                    }).catch(function (err) {
                        if (token.cancelled || (err && err.cancelled) || revision !== sampleEstimateRevision) return;
                        t.sampleStatus = 'error';
                        t.sampleError = err && err.message ? err.message : String(err);
                        t.liveInfo = '';
                        log('warn', '[' + t.name + '] CRF 采样预估失败：' + t.sampleError);
                    }).then(function () {
                        if (revision !== sampleEstimateRevision) return;
                        renderTask(t);
                        renderSummary();
                        updateSampleAnalysisControls();
                    });
                });
            });

            chain.then(function () {
                if (revision === sampleEstimateRevision) {
                    sampleEstimateToken = null;
                    updateSampleAnalysisControls();
                }
            });
        }, 350);
    }

    /** 设置变化后刷新列表里的预估体积 */
    function refreshEstimate() {
        readSettingsFromUI();
        if (state.settings.mode === 'crf') {
            scheduleSamplingEstimates();
        } else {
            cancelSamplingEstimates();
            state.tasks.forEach(function (t) {
                t.sampleEstimate = null;
                t.sampleStatus = '';
                t.sampleError = '';
            });
        }
        state.tasks.forEach(function (t) {
            if (t.meta && t.status !== 'running' && t.status !== 'done') renderTask(t);
        });
        renderSummary();
        updateSampleAnalysisControls();
    }

    // -----------------------------------------------------------------
    // 初始化
    // -----------------------------------------------------------------
    /** 执行一个初始化步骤，失败只记日志不中断整体 */
    function safe(fn, name) {
        try {
            fn();
        } catch (e) {
            log('error', '初始化步骤 ' + name + ' 失败，已跳过（其余功能不受影响）', e);
        }
    }

    function init(eagleApi) {
        // eagle 可能是 null（拿不到 Eagle API 的降级模式）。
        // 这时插件仍可用于本地文件压缩，只是读不到选中素材、也回写不了，
        // 所以不能在这里直接抛错把整个界面掐死。
        eagle = eagleApi || null;
        // 先翻译静态 HTML，再填充下拉框和运行时文本；语言由 Eagle 当前界面语言决定。
        safe(applyTranslations, 'applyTranslations');
        if (!eagle) log('warn', '未获取到 Eagle API，以本地文件模式启动');

        // fs / path / os 是硬依赖。缺了就没法读写文件，直接把原因说清楚，
        // 不要等到用户点了「开始压缩」才报一个莫名其妙的错。
        if (!fs || !path || !os) {
            log('error', 'Node 能力不可用（fs=' + !!fs + ' path=' + !!path + ' os=' + !!os +
                '）。插件窗口需要开启 nodeIntegration 才能读写文件。');
        }

        dom = {
            ffmpegStatus: $('ffmpegStatus'),
            selCodec: $('selCodec'),
            codecHint: $('codecHint'),
            selSpeed: $('selSpeed'),
            selResolution: $('selResolution'),
            resolutionHint: $('resolutionHint'),
            selFps: $('selFps'),
            selAudioMode: $('selAudioMode'),
            audioHint: $('audioHint'),
            selAudioBitrate: $('selAudioBitrate'),
            selConcurrency: $('selConcurrency'),
            modeTabs: $('modeTabs'),
            rngCrf: $('rngCrf'),
            crfValue: $('crfValue'),
            inpBitrate: $('inpBitrate'),
            inpTargetSize: $('inpTargetSize'),
            chkBackup: $('chkBackup'),
            backupCheck: $('backupCheck'),
            chkReplaceInEagle: $('chkReplaceInEagle'),
            btnPickBackup: $('btnPickBackup'),
            backupPath: $('backupPath'),
            btnAddFiles: $('btnAddFiles'),
            btnTheme: $('btnTheme'),
            btnResetSettings: $('btnResetSettings'),
            btnClear: $('btnClear'),
            fileList: $('fileList'),
            listStat: $('listStat'),
            sumOriginal: $('sumOriginal'),
            sumFinalLabel: $('sumFinalLabel'),
            sumFinal: $('sumFinal'),
            sumSpaceItem: $('sumSpaceItem'),
            sumSaved: $('sumSaved'),
            estimateNote: $('estimateNote'),
            sampleAnalysisControls: $('sampleAnalysisControls'),
            sampleAnalysisStatus: $('sampleAnalysisStatus'),
            btnAnalyzeAll: $('btnAnalyzeAll'),
            btnStopAnalysis: $('btnStopAnalysis'),
            btnStart: $('btnStart'),
            btnCancel: $('btnCancel'),
            confirmMask: $('confirmMask'),
            confirmWarn: $('confirmWarn'),
            confirmList: $('confirmList'),
            btnConfirmOk: $('btnConfirmOk'),
            btnConfirmCancel: $('btnConfirmCancel'),
            selectionMask: $('selectionMask'),
            selectionDescription: $('selectionDescription'),
            selectionList: $('selectionList'),
            btnSelectionCancel: $('btnSelectionCancel'),
            btnSelectionReplace: $('btnSelectionReplace'),
            btnSelectionAppend: $('btnSelectionAppend')
        };

        // 依赖自检必须放在最前面。
        // 踩过的坑：ffmpeg.js 的 UMD 在 Eagle 的 nodeIntegration 环境下只走了
        // module.exports 分支，root.FFmpegCore 一直没被赋值，于是后面的
        // Core.purgeStaleTemp() 抛 TypeError —— 而它恰好在第一条日志之前，
        // 结果就是日志里只有「插件启动」一行，界面全空，完全无从下手。
        // 缺失时先喊出来，别让故障默默沉底。
        if (!Core) log('error', 'FFmpegCore 未加载（window.FFmpegCore 不存在）。' +
            '检查 js/ffmpeg.js 是否正确挂载到全局');
        if (!F) log('error', 'Format 未加载（window.Format 不存在）。' +
            '检查 js/format.js 是否正确挂载到全局');

        // 每一步单独兜底。
        // 之前这里是一个接一个裸调用，任何一步抛错都会让整个 init 中断：
        // 下拉框来不及填、事件来不及绑，界面表现为「全是空白、点不动」，
        // 而日志里连一行线索都没有。现在坏一步只丢一步的功能。
        safe(loadSettings, 'loadSettings');
        safe(fillSelects, 'fillSelects');
        safe(applySettingsToUI, 'applySettingsToUI');
        safe(bindEvents, 'bindEvents');
        safe(renderList, 'renderList');
        safe(renderSummary, 'renderSummary');

        // 主题跟随 Eagle
        safe(applyTheme, 'applyTheme');

        // 回收上次异常退出（Eagle 崩溃 / 强杀插件）遗留的临时文件。
        // 这一行曾经是整条初始化链的断点：Core 为 undefined 时它会抛 TypeError，
        // 而错误发生在第一条日志之前，导致日志里什么都看不到。
        var purged = 0;
        safe(function () { purged = Core.purgeStaleTemp(); }, 'purgeStaleTemp');
        if (purged > 0) log('info', '清理上次遗留的临时文件 ' + purged + ' 个');

        // 定位 ffmpeg。
        // 外面再套一层超时：即便 Core 内部的兜底全都失手，也要保证状态栏
        // 能给出明确结果，绝不能让界面停在「正在检测」这种无解状态上。
        log('info', '开始定位 FFmpeg…');
        var t0 = Date.now();
        return Core._internal.withTimeout(Core.resolveBinaries(eagle), 20000, null)
            .then(function (bins) {
                if (!bins) {
                    state.ready = false;
                    failStatus('FFmpeg 检测超时（20s），请重启插件重试');
                    updateButtons();
                    return;
                }
                state.bins = bins;
                state.ready = true;
                setStatus(tr('runtime.ffmpegReady', 'FFmpeg {{version}} 就绪', { version: bins.version }), 'ok');
                log('info', 'FFmpeg 就绪: ' + bins.ffmpeg + ' (来源: ' + bins.source +
                    ', 版本: ' + bins.version + ', 耗时 ' + (Date.now() - t0) + 'ms)');
                updateButtons();

                // FFmpeg 就位之后才自动导入 Eagle 选中素材：
                // 导入完要立刻 ffprobe 读元信息，早于这一步会全部探测失败。
                safe(autoLoadFromEagle, 'autoLoadFromEagle');
            })
            .catch(function (err) {
                failStatus(err.message || 'FFmpeg 不可用', err);
                // 系统里没有、Eagle 依赖插件又装得上时，顺手把安装流程拉起来
                if (err.installable && typeof err.install === 'function') {
                    err.install().catch(function (e2) {
                        log('error', '触发 FFmpeg 依赖插件安装失败', e2);
                    });
                }
                updateButtons();
            });
    }

    // -----------------------------------------------------------------
    // 主题
    // -----------------------------------------------------------------
    /**
     * 明暗映射以 Eagle 官方插件模板为准。
     *
     * 模板就在本机：Eagle.app/Contents/Resources/plugin_templates/inspector/index.html
     *
     *   body[theme="LIGHT"], body[theme="LIGHTGRAY"]                { color: black; }
     *   body[theme="GRAY"], body[theme="BLUE"],
     *   body[theme="PURPLE"], body[theme="DARK"]                    { color: white; }
     *
     * 也就是说 **GRAY 在 Eagle 里是深色**，光看名字猜一定会猜反。
     */
    var LIGHT_THEMES = ['LIGHT', 'LIGHTGRAY'];
    var DARK_THEMES = ['GRAY', 'BLUE', 'PURPLE', 'DARK'];

    /** 未知 / 取不到主题时返回 null，交给下一级判断 */
    function isLightTheme(theme) {
        var t = String(theme === undefined || theme === null ? '' : theme).toUpperCase().trim();
        if (!t) return null;
        if (LIGHT_THEMES.indexOf(t) >= 0) return true;
        if (DARK_THEMES.indexOf(t) >= 0) return false;
        return null;
    }

    var THEME_MODES = ['auto', 'light', 'dark'];
    var THEME_LABELS = { auto: '跟随', light: '浅色', dark: '深色' };

    function themeLabel(mode) {
        var keys = { auto: 'ui.themeAuto', light: 'ui.themeLight', dark: 'ui.themeDark' };
        return tr(keys[mode] || 'ui.themeAuto', THEME_LABELS[mode] || THEME_LABELS.auto);
    }

    function setLight(light) {
        document.body.classList.remove('light');
        if (light) document.body.classList.add('light');
    }

    function resolveTheme(theme) {
        var light = isLightTheme(theme);

        // 二级判断：Eagle 给的 isDarkColors()。注意它问的是**系统**的深色模式，
        // 跟 Eagle 自己选的主题不是一回事（Eagle 可以单独设成深色而系统是浅色），
        // 所以只能当兜底，不能当主判据。
        var dark = null;
        try {
            if (eagle && eagle.app && typeof eagle.app.isDarkColors === 'function') {
                dark = !eagle.app.isDarkColors();
            }
        } catch (e) { /* 忽略 */ }

        if (light === null) light = (dark === null) ? false : dark;

        // 这行日志是排查「主题对不上」的唯一线索。Eagle 到底返回了什么、
        // 系统深色模式是什么、最后选了哪个，全都记下来。
        log('info', '主题: theme=' + JSON.stringify(
                theme === undefined || theme === null ? null : theme) +
            ' | isDarkColors=' + (dark === null ? '不可用' : (!dark ? 'true' : 'false')) +
            ' | → ' + (light ? '浅色' : '深色'));

        // 顺手把主题名写到 body 上，跟 Eagle 官方模板的约定保持一致，
        // 以后想按单个主题微调样式可以直接用 body[theme="BLUE"] 选择器。
        try {
            if (theme) document.body.setAttribute('theme', String(theme).toUpperCase());
        } catch (e) { /* 忽略 */ }

        setLight(light);
    }

    function applyTheme() {
        try {
            var mode = (state.settings && state.settings.themeMode) || 'auto';
            if (dom.btnTheme) dom.btnTheme.textContent = tr('ui.theme', '主题：{{mode}}', { mode: themeLabel(mode) });

            // 手动指定过就直接听用户的，不再去问 Eagle
            if (mode === 'light') { setLight(true); return; }
            if (mode === 'dark') { setLight(false); return; }

            var theme = (eagle && eagle.app) ? eagle.app.theme : undefined;

            // Eagle 官方模板里写的是 `await eagle.app.theme` —— 说明这个属性
            // 在不同版本上可能是同步值也可能是 Promise。只按同步处理的话，
            // 碰到 Promise 时会拿到 "[object Promise]"，主题判断直接失效。
            if (theme && typeof theme.then === 'function') {
                theme.then(resolveTheme).catch(function () { resolveTheme(undefined); });
                return;
            }
            resolveTheme(theme);
        } catch (e) {
            log('warn', '应用主题失败：' + (e && e.message ? e.message : e));
        }
    }

    function cycleTheme() {
        var cur = (state.settings && state.settings.themeMode) || 'auto';
        var i = THEME_MODES.indexOf(cur);
        var next = THEME_MODES[(i < 0 ? 0 : i + 1) % THEME_MODES.length];
        state.settings.themeMode = next;
        applyTheme();
        saveSettings();
        log('info', '界面主题切换为 ' + next + '（已记住）');
    }

    root.App = {
        init: init,
        applyTheme: applyTheme,
        onShow: onShow,
        _state: state,
        // 仅供本地回归调用：验证汇总/单任务的展示状态，不绕开实际业务逻辑。
        _internal: {
            renderSummary: renderSummary,
            renderTask: renderTask,
            sampleCacheKey: sampleCacheKey,
            scheduleSamplingEstimates: scheduleSamplingEstimates,
            stopSamplingEstimates: stopSamplingEstimates,
            updateSampleAnalysisControls: updateSampleAnalysisControls,
            atomicReplaceFileAsync: atomicReplaceFileAsync
        }
    };
})(typeof self !== 'undefined' ? self : globalThis);
