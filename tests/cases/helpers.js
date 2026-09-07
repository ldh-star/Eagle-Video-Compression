/**
 * 用例集公共构件。
 *
 * 这里只放「构造输入」和「读参数」两件事，不放断言 —— 断言写在每个用例里，
 * 因为断言失败时的第三个参数（期望的行为描述）才是用例真正要传达的东西。
 *
 * 为什么不复用 tests/ 下已有测试里的同名函数：那些文件是独立可执行脚本，
 * require 它们会直接跑起来。共用逻辑只能放在这里。
 */
'use strict';

const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');

/**
 * 加载核心模块。
 *
 * 每次都重新 require 一份干净的副本：ffmpeg.js 里有 binaryCache / hwCache
 * 这类模块级缓存，而用例要反复改 settings 跑 buildPlan，用缓存会互相污染。
 */
function loadCore() {
    const p = path.join(ROOT, 'js', 'ffmpeg.js');
    delete require.cache[require.resolve(p)];
    return require(p);
}

function loadCorePath() {
    return path.join(ROOT, 'js', 'ffmpeg.js');
}

/** 没有 HDR 的元数据，避免每个用例都要写一遍这个空壳。 */
function noHdr() {
    return {
        isHdr: false, kind: null, transfer: '', primaries: '', space: '',
        dolbyVision: false, hdr10Plus: false
    };
}

/**
 * 构造 buildPlan 需要的 meta，字段与 normalizeProbe 的输出完全对齐。
 *
 * @param {object} [o]
 * @param {string} [o.path]   决定容器与输出扩展名，务必带扩展名
 * @param {object|null} [o.audio] 传 null 表示无音轨
 */
function meta(o) {
    o = o || {};
    const width = o.width || 1920;
    const height = o.height || 1080;
    return {
        path: o.path || '/tmp/input.mp4',
        duration: o.duration === undefined ? 30 : o.duration,
        size: o.size || 50 * 1024 * 1024,
        tags: {},
        compression: { compressed: false, version: 0, count: 0, date: '', codec: '', mode: '' },
        container: 'mov,mp4',
        containerLong: '',
        totalBitrate: o.totalBitrate || 8000000,
        video: o.video === null ? null : {
            codec: o.videoCodec || 'h264',
            codecLong: '',
            profile: 'High',
            width: width,
            height: height,
            fps: o.fps || 30,
            pixFmt: o.bitDepth >= 10 ? 'yuv420p10le' : 'yuv420p',
            bitDepth: o.bitDepth || 8,
            bitrate: o.videoBitrate || 7500000,
            frames: 900,
            colorTransfer: '',
            colorPrimaries: '',
            colorSpace: '',
            hdr: o.hdr || noHdr()
        },
        audio: o.audio === undefined
            ? { codec: 'aac', codecLong: '', sampleRate: 48000, channels: 2, bitrate: o.audioBitrate || 128000 }
            : o.audio
    };
}

/** 构造 buildPlan 需要的 settings。 */
function settings(o) {
    return Object.assign({
        codec: 'h265',
        mode: 'crf',
        crf: 28,
        speedIndex: 2,
        resolution: 'source',
        customHeight: 720,
        fps: 'source',
        audioMode: 'aac',
        audioBitrate: 128,
        videoBitrate: 2000,
        targetSizeMB: 50,
        concurrency: 2,
        hwAccel: 'cpu',
        writeCompressionMarker: false
    }, o || {});
}

function plan(metaObj, settingsObj, hw, outPath) {
    const Core = loadCore();
    return Core.buildPlan(
        metaObj, settingsObj,
        outPath || '/tmp/output' + path.extname(metaObj.path).toLowerCase(),
        '/tmp/eagle-vc-pass',
        hw || { families: [], encoders: {}, decodeMethods: [] }
    );
}

/** 单遍模式下唯一那条命令；两遍模式下不要用（会拿不到 pass1）。 */
function args(metaObj, settingsObj, hw) {
    return plan(metaObj, settingsObj, hw).passes[0];
}

/** 参数里有没有某个开关（不关心取值）。 */
function hasFlag(list, flag) {
    return list.indexOf(flag) !== -1;
}

/** 参数里有没有 "-flag value" 这一对。 */
function hasPair(list, flag, value) {
    return list.some(function (a, i) {
        return a === flag && list[i + 1] === String(value);
    });
}

/** 取 "-flag value" 的 value；没有返回 null。 */
function valueOf(list, flag) {
    const i = list.indexOf(flag);
    return i === -1 || i + 1 >= list.length ? null : list[i + 1];
}

/** 取 flag 在参数里的下标；没有返回 -1。 */
function indexOfFlag(list, flag) {
    return list.indexOf(flag);
}

/** -x265-params / -svtav1-params 这类「一个开关带一整串 key=value」的取值。 */
function paramsString(list, flag) {
    const v = valueOf(list, flag);
    return v === null ? '' : String(v);
}

/**
 * 本机 ffmpeg / ffprobe 路径；没有返回 null。
 *
 * 需要真实编码的用例（端到端多轨、verifyOutput 丢轨检测）用它做门禁：
 * 没装 ffmpeg 的机器上跳过，而不是把「环境缺依赖」报成「功能有 bug」。
 */
function ffmpegBins() {
    const cp = require('child_process');
    const cmd = process.platform === 'win32' ? 'where' : 'which';
    function which(name) {
        try {
            const r = cp.spawnSync(cmd, [name], { encoding: 'utf8' });
            if (r.status !== 0 || !r.stdout) return null;
            return String(r.stdout).split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0] || null;
        } catch (e) {
            return null;
        }
    }
    const ffmpeg = which('ffmpeg');
    const ffprobe = which('ffprobe');
    return ffmpeg && ffprobe ? { ffmpeg: ffmpeg, ffprobe: ffprobe } : null;
}

/** 造一个临时目录，用完由调用方清理。 */
function tmpDir(prefix) {
    const fs = require('fs');
    const os = require('os');
    return fs.mkdtempSync(require('path').join(os.tmpdir(), prefix || 'eagle-vc-case-'));
}

/**
 * 主动跳过：环境不具备运行条件时用（缺 jsdom、缺 ffmpeg）。
 *
 * 不用「静默通过」—— 跳过的用例会在报告里单列出来，
 * 否则「没跑」和「跑过了是对的」在汇总里长得一模一样。
 */
function skip(msg) {
    const e = new Error(msg || 'skip');
    e.skip = true;
    throw e;
}

/**
 * 给数组套一层计数代理，统计「全表扫描到底扫了多少个元素」。
 *
 * 用来把「这里是 O(N²)」这种论断变成能断言的数字：渲染层每次
 * filter / forEach / reduce 都会逐元素 [[Get]]，次数直接反映工作量。
 *
 * @returns {{proxy: any[], stats: {visits: number}}}
 */
function countingArray(source) {
    const arr = (source || []).slice();
    const stats = { visits: 0 };
    const proxy = new Proxy(arr, {
        get: function (o, k) {
            if (typeof k === 'string' && /^\d+$/.test(k)) stats.visits++;
            return o[k];
        }
    });
    return { proxy: proxy, stats: stats };
}

/**
 * 临时顶替对象上的某个方法并计数，用完 restore()。
 *
 * 用于「这条路径到底有没有走 copyFile」这类判断 —— 比读源码可靠，
 * 因为源码改了而行为没改（或反过来）时，只有行为计数能抓到。
 */
function spy(obj, name) {
    const orig = obj[name];
    const rec = { count: 0, args: [], restored: false };
    obj[name] = function () {
        rec.count++;
        rec.args.push(Array.prototype.slice.call(arguments));
        return orig.apply(this, arguments);
    };
    rec.restore = function () {
        if (!rec.restored) { obj[name] = orig; rec.restored = true; }
    };
    rec.orig = orig;
    return rec;
}

function assertIncludes(haystack, needle, msg) {
    if (String(haystack).indexOf(needle) === -1) {
        throw new Error((msg || '缺少 ' + needle) + '（实际: ' + haystack + '）');
    }
}

module.exports = {
    ROOT: ROOT,
    loadCore: loadCore,
    loadCorePath: loadCorePath,
    meta: meta,
    settings: settings,
    plan: plan,
    args: args,
    hasFlag: hasFlag,
    hasPair: hasPair,
    valueOf: valueOf,
    indexOfFlag: indexOfFlag,
    paramsString: paramsString,
    assertIncludes: assertIncludes,
    noHdr: noHdr,
    ffmpegBins: ffmpegBins,
    tmpDir: tmpDir,
    skip: skip,
    countingArray: countingArray,
    spy: spy
};
