/**
 * jsdom 环境构件：把 app.js 装进一个假 Eagle 窗口里。
 *
 * 为什么需要这一层：
 *   js/ffmpeg.js 是纯逻辑，Node 里 require 就能测（见 plan.js / budget.js）。
 *   js/app.js 一上来就摸 document 和 eagle.*，只能在 jsdom 里跑。
 *
 * 这里的桩只做两件事：① 提供 app.js 依赖的全局（FFmpegCore / Format / I18n / eagle）；
 * ② 在桩上装计数器，让「调用了几次」变成可断言的数字。绝不伪造业务逻辑 ——
 * 被断言的行为必须真的发生在 app.js 里，否则测试测的就不是产品代码。
 *
 * jsdom 属于可选依赖（本仓库刻意不带 node_modules），缺失时 jsdomAvailable()
 * 返回 false，用例应 throw H.skip(...)，而不是把「没装 jsdom」报成「功能有 bug」。
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const H = require('./helpers');

let JSDOM = null;
let jsdomError = null;
let settingsDir = null;

/** jsdom 是否可用。只会真正尝试加载一次。 */
function jsdomAvailable() {
    if (JSDOM) return true;
    if (jsdomError) return false;
    try {
        JSDOM = require(path.join(H.ROOT, 'tools', 'require-jsdom.js'))().JSDOM;
    } catch (e) {
        jsdomError = e;
        return false;
    }
    return !!JSDOM;
}

function jsdomReason() {
    return jsdomError ? String(jsdomError.message || jsdomError).split('\n')[0] : '';
}

/**
 * 设置目录必须在 app.js 加载前指定，否则它会往真实的用户目录里写。
 * 所有用例共用同一个临时目录，避免每个用例都 mkdir 一次。
 */
function ensureSettingsDir() {
    if (!settingsDir) {
        settingsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eagle-vc-cases-'));
        process.env.EAGLE_PLUGIN_SETTINGS_DIR = settingsDir;
    }
    return settingsDir;
}

function wait(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

function noop() {}

/** index.html 去脚本后的骨架，所有用例共用，只读一次。 */
let cachedHtml = null;
function readHtml() {
    if (cachedHtml === null) {
        cachedHtml = fs.readFileSync(path.join(H.ROOT, 'index.html'), 'utf8')
            .replace(/<script[\s\S]*?<\/script>/g, '');
    }
    return cachedHtml;
}

/** 与真实 I18n.t 一致的 {{name}} 插值，否则带变量的文案永远渲染成占位符。 */
function translate(_key, fallback, vars) {
    if (!vars) return fallback;
    return String(fallback).replace(/{{\s*([\w.]+)\s*}}/g, function (m, name) {
        return vars[name] === undefined || vars[name] === null ? '' : String(vars[name]);
    });
}

/** 探测桩返回的元数据，结构与 normalizeProbe 的输出保持一致。 */
function probeMeta(p) {
    return {
        size: 4096, duration: 12, path: p,
        tags: {},
        compression: { compressed: false, version: 0, count: 0, date: '', codec: '', mode: '' },
        container: 'mov,mp4',
        containerLong: '',
        totalBitrate: 800000,
        video: {
            codec: 'h264', codecLong: '', profile: 'High',
            width: 1920, height: 1080, fps: 30, pixFmt: 'yuv420p', bitDepth: 8,
            bitrate: 700000, frames: 360,
            hdr: H.noHdr()
        },
        audio: { codec: 'aac', codecLong: '', sampleRate: 48000, channels: 2, bitrate: 128000 }
    };
}

/**
 * 构造 FFmpegCore 桩。
 *
 * @param {object} [over] 覆盖任意字段（用例要装自己的计数器时用）
 */
function makeCore(over) {
    const counts = {
        probe: 0, estimateOutputSize: 0, purgeStaleTemp: 0, estimateCrfBySampling: 0
    };
    // 并发观测：probe 是串行还是并行，只有同时记录「在飞数量」才看得出来。
    const probeWatch = { inflight: 0, maxInflight: 0 };

    const core = {
        counts: counts,
        probeWatch: probeWatch,
        CODECS: {
            h264: { id: 'h264', label: 'H.264', crf: { min: 0, max: 51, def: 23 }, tenBit: false },
            h265: { id: 'h265', label: 'H.265', crf: { min: 0, max: 51, def: 28 }, tenBit: true },
            av1: { id: 'av1', label: 'AV1', crf: { min: 0, max: 63, def: 32 }, tenBit: true },
            vp9: { id: 'vp9', label: 'VP9', crf: { min: 0, max: 63, def: 32 }, tenBit: true },
            copy: { id: 'copy', label: 'Copy', crf: null, tenBit: true }
        },
        SPEED_LABELS: ['很快', '均衡', '较慢', '很慢'],
        RESOLUTIONS: [{ v: 'source', l: '保持原始' }, { v: '1080', l: '1080p' }, { v: '720', l: '720p' }],
        AUDIO_MODES: [{ v: 'copy', l: '复制' }, { v: 'aac', l: '重编码 AAC' }],
        AUDIO_BITRATES: [96, 128, 192, 256],
        VIDEO_EXTENSIONS: ['.mp4', '.mov', '.mkv', '.webm', '.m4v', '.avi'],
        isVideoFile: function (p) { return /\.(mp4|mov|mkv|webm|m4v|avi)$/i.test(String(p || '')); },
        probe: function (bins, p) {
            counts.probe++;
            probeWatch.inflight++;
            if (probeWatch.inflight > probeWatch.maxInflight) probeWatch.maxInflight = probeWatch.inflight;
            return wait(1).then(function () {
                probeWatch.inflight--;
                return probeMeta(p);
            });
        },
        estimateOutputSize: function () { counts.estimateOutputSize++; return 512; },
        estimateCrfBySampling: function () {
            counts.estimateCrfBySampling++;
            return Promise.resolve({ crf: 26, low: 400, high: 600, estimate: 500 });
        },
        purgeStaleTemp: function () { counts.purgeStaleTemp++; return 0; },
        hdrRisk: function () { return { atRisk: false, reason: '' }; },
        supportsCompressionMarker: function () { return true; },
        CancelledError: function () {
            return Object.assign(new Error('Cancelled'), { cancelled: true });
        },
        detectHardware: function () {
            return Promise.resolve({ families: [], encoders: {}, decodeMethods: [] });
        },
        resolveBinaries: function () {
            return Promise.resolve({ version: 'test', ffmpeg: 'ffmpeg', ffprobe: 'ffprobe', source: 'test' });
        },
        _internal: {
            withTimeout: function (p) { return Promise.resolve(p); },
            recommendedWorkerCount: function () { return 1; },
            recommendedThreadCount: function () { return 1; },
            preferredTempDir: function () { return os.tmpdir(); }
        }
    };
    return Object.assign(core, over || {});
}

function makeFormat() {
    return {
        bytes: function (n) { return n + ' B'; },
        duration: function (n) { return n + 's'; },
        fps: function (n) { return n + ' fps'; },
        codecName: function (n) { return String(n || ''); },
        bitrate: function () { return ''; },
        colorDepth: function () { return null; },
        chromaLabel: function () { return ''; },
        savedPercent: function () { return 0; },
        sizeRelation: function () { return 'same'; },
        sizeRangeRelation: function () { return 'same'; }
    };
}

/**
 * 起一个装好 app.js 的 jsdom 窗口。
 *
 * @param {object} [opts]
 * @param {string[]} [opts.selected] Eagle 里「已选中」的素材路径
 * @param {object}   [opts.core]     覆盖 FFmpegCore 桩的字段
 * @param {number}   [opts.settle]   init 后等待的毫秒数
 * @param {function} [opts.beforeInit] 在 app.js 求值之后、App.init 之前调用，签名 (win)。
 *        init 会同步走完「自动导入 Eagle 选中素材」这条路，想统计导入期间的
 *        调用次数，只能卡在这个窗口里装计数器 —— init 之后再装就什么都测不到了。
 * @returns {Promise<{win, core, selected, close}>}
 */
function makeApp(opts) {
    opts = opts || {};
    ensureSettingsDir();
    if (!jsdomAvailable()) H.skip('需要 jsdom：' + jsdomReason());

    const html = readHtml();
    const core = makeCore(opts.core);
    const selected = (opts.selected || []).slice();

    const dom = new JSDOM(html, {
        url: 'http://localhost/',
        runScripts: 'dangerously',
        pretendToBeVisual: true,
        beforeParse: function (window) {
            window.require = require;
            window.FFmpegCore = core;
            window.Format = makeFormat();
            window.I18n = { t: translate, apply: function () {} };
            window.eagle = { item: { getSelected: function () { return Promise.resolve(selected); } } };
            // app.js 启动时会打一堆「FFmpeg 就绪」之类的日志，混在测试报告里很干扰。
            // 真要排查时把 EAGLE_VC_TEST_LOG=1 打开即可。
            if (!process.env.EAGLE_VC_TEST_LOG) {
                window.console = { log: noop, info: noop, warn: noop, error: noop, debug: noop };
            }
        }
    });

    const win = dom.window;
    win.eval(fs.readFileSync(path.join(H.ROOT, 'js', 'app.js'), 'utf8'));
    if (typeof opts.beforeInit === 'function') opts.beforeInit(win);

    return Promise.resolve(win.App.init(win.eagle))
        .then(function () { return wait(opts.settle === undefined ? 30 : opts.settle); })
        .then(function () {
            return {
                win: win,
                core: core,
                selected: selected,
                close: function () { try { dom.window.close(); } catch (e) {} }
            };
        });
}

/** 造一个「可被 addFiles 接受」的 Eagle 素材对象。 */
function eagleItem(filePath) {
    return { filePath: filePath, name: path.basename(filePath) };
}

module.exports = {
    jsdomAvailable: jsdomAvailable,
    jsdomReason: jsdomReason,
    makeApp: makeApp,
    makeCore: makeCore,
    eagleItem: eagleItem,
    probeMeta: probeMeta,
    wait: wait
};
