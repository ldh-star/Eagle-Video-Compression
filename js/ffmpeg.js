/**
 * FFmpeg 核心层
 *
 * 职责：二进制定位 / 元信息探测 / 编码参数构建 / 进程执行与进度解析。
 * 不依赖 Eagle API（Eagle 依赖插件的定位通过外部传入的 eagle 对象完成），
 * 因此可以在纯 Node 环境下独立测试。
 */
;(function (root, factory) {
    // 【重要】必须无条件挂到全局，不能写成 if/else 二选一。
    //
    // Eagle 的插件窗口开了 nodeIntegration，每个 <script> 都跑在 Node 的模块
    // 作用域里，`module` / `exports` / `require` 都是存在的。写成
    // "if (module) module.exports = ... else root.XXX = ..." 的话，在 Eagle 里
    // 会走 module.exports 分支，root.FFmpegCore 永远不会被赋值 ——
    // app.js 里 `var Core = root.FFmpegCore` 拿到 undefined，init() 一执行到
    // Core.purgeStaleTemp() 就抛 TypeError。
    //
    // 而这个 TypeError 恰好发生在第一条日志之前，于是表现为：日志里只有
    // 「插件启动」一行、下拉框全空、状态栏停在 HTML 的静态文案。
    // 本地 jsdom 测试永远发现不了 —— eval 环境里没有 module，走的是 else 分支。
    var mod = factory();
    if (typeof module === 'object' && module.exports) module.exports = mod;
    root.FFmpegCore = mod;
})(typeof self !== 'undefined' ? self : globalThis, function () {
    'use strict';

    var cp = require('child_process');
    var fs = require('fs');
    var path = require('path');
    // 显式 require，不要依赖宿主环境把 process 挂成全局变量。
    // Electron 开了 nodeIntegration 时 window.process 存在，但并非所有宿主都保证，
    // 而这里只是要一个 platform 字段，何必赌。
    var proc = require('process');
    var os = require('os');

    // ---------------------------------------------------------------------
    // 编码格式表
    // ---------------------------------------------------------------------
    // tenBit      是否允许保留 10-bit。H.264 的 10-bit（High10）硬件/播放器兼容性差，强制降到 8-bit。
    // twoPass     「目标文件大小」模式下是否走真两遍编码。SVT-AV1 / VP9 的单遍码率控制已足够准，
    //             且两遍耗时翻倍，故走单遍。
    // speeds      编码速度档位，索引 0 = 最快，4 = 最慢（压缩率最高）。
    // hw          各硬件家族对应的编码器。列表里没有的家族说明该编码没有硬件实现，
    //             例如 VP9 只有 Intel QSV 一家，NVIDIA / AMD 都不提供 VP9 硬编。
    //
    // hwQpScale   CRF → 硬件恒定 QP 的换算。见 crfToHwQp() 里的实测说明：
    //             不同编码的 QP 刻度差得很远，混用会让产物体积失控。
    var CODECS = {
        h264: {
            id: 'h264',
            label: 'H.264 / AVC',
            hint: '兼容性最好，速度快，压缩率一般',
            encoder: 'libx264',
            container: 'mp4',
            crf: { def: 23, min: 0, max: 51 },
            twoPass: true,
            tenBit: false,
            speeds: ['veryfast', 'fast', 'medium', 'slow', 'veryslow'],
            speedArgs: function (v) { return ['-preset', v]; },
            hwQpScale: { mul: 1, add: 2, max: 51 },
            hw: {
                nvenc: { encoder: 'h264_nvenc', tenBit: false },
                qsv: { encoder: 'h264_qsv', tenBit: false },
                amf: { encoder: 'h264_amf', tenBit: false },
                // H.264 的 10-bit（High10）在 Apple 的解码器上兼容性很差，
                // 和软件编码器一样统一降到 8-bit。
                videotoolbox: { encoder: 'h264_videotoolbox', tenBit: false }
            }
        },
        h265: {
            id: 'h265',
            label: 'H.265 / HEVC',
            hint: '同画质下比 H.264 省 30~50%，编码较慢',
            encoder: 'libx265',
            container: 'mp4',
            crf: { def: 28, min: 0, max: 51 },
            twoPass: true,
            tenBit: true,
            speeds: ['veryfast', 'fast', 'medium', 'slow', 'veryslow'],
            speedArgs: function (v) { return ['-preset', v]; },
            hwQpScale: { mul: 1, add: 2, max: 51 },
            hw: {
                nvenc: { encoder: 'hevc_nvenc', tenBit: true, tenBitPixFmt: 'p010le' },
                qsv: { encoder: 'hevc_qsv', tenBit: true, tenBitPixFmt: 'p010le' },
                amf: { encoder: 'hevc_amf', tenBit: true, tenBitPixFmt: 'p010le' },
                videotoolbox: { encoder: 'hevc_videotoolbox', tenBit: true, tenBitPixFmt: 'p010le' }
            }
        },
        av1: {
            id: 'av1',
            label: 'AV1',
            hint: '压缩率最高，但编码很慢，老设备播放可能吃力',
            encoder: 'libsvtav1',
            container: 'mp4',
            crf: { def: 32, min: 0, max: 63 },
            twoPass: false,
            tenBit: true,
            speeds: ['12', '10', '8', '5', '2'],
            speedArgs: function (v) { return ['-preset', v]; },
            hwQpScale: { mul: 3.2, add: 0, max: 255 },
            hw: {
                nvenc: { encoder: 'av1_nvenc', tenBit: true, tenBitPixFmt: 'p010le' },
                qsv: { encoder: 'av1_qsv', tenBit: true, tenBitPixFmt: 'p010le' },
                amf: { encoder: 'av1_amf', tenBit: true, tenBitPixFmt: 'p010le' }
            }
        },
        vp9: {
            id: 'vp9',
            label: 'VP9',
            hint: '开源免授权，压缩率接近 AV1，编码较慢',
            encoder: 'libvpx-vp9',
            container: 'webm',
            crf: { def: 32, min: 0, max: 63 },
            twoPass: false,
            tenBit: true,
            speeds: ['5', '4', '2', '1', '0'],
            // 并行参数是按下来的片源宽度算的，不是固定值 —— 见 vp9ParallelArgs。
            speedArgs: function (v, meta) {
                return ['-deadline', v === '0' ? 'best' : 'good', '-cpu-used', v]
                    .concat(vp9ParallelArgs(meta && meta.video && meta.video.width));
            },
            // VP9 没有 NVENC / AMF 实现，QSV 的 vp9_qsv 又极少在消费机上可用，
            // 干脆不列 —— 走了 CPU 也比给一个多数人跑不通的命令好。
            hwQpScale: null,
            hw: {}
        },
        copy: {
            id: 'copy',
            label: '仅重新封装（不重编码视频）',
            hint: '视频流原样复制，只处理音轨。极快，画质无损',
            encoder: 'copy',
            container: null,
            crf: null,
            twoPass: false,
            tenBit: true,
            speeds: null,
            speedArgs: function () { return []; },
            hwQpScale: null,
            hw: {}
        }
    };

    // ---------------------------------------------------------------------
    // 硬件加速
    // ---------------------------------------------------------------------
    /**
     * 优先尝试顺序。
     *
     * 一台机器理论上可能同时有核显和独显（QSV + NVENC 同时可用），
     * 独显的编码质量和吞吐通常更好，所以 NVENC 排第一。
     */
    // videotoolbox 排在最后不是因为它差，而是因为这三家在 macOS 上根本不存在：
    // NVENC / QSV / AMF 的编码器名永远不会出现在一台 Mac 的 -encoders 输出里，
    // 所以顺序不会影响 Windows / Linux 上的任何行为。反过来，Apple 平台只有
    // VT 一家可用 —— 少了它，Mac 用户看到的永远是「未检测到硬件编码」，
    // 全部任务走 CPU。
    var HW_FAMILY_ORDER = ['nvenc', 'qsv', 'amf', 'videotoolbox'];

    var HW_FAMILY_LABEL = {
        nvenc: 'NVIDIA NVENC',
        qsv: 'Intel Quick Sync',
        amf: 'AMD AMF',
        videotoolbox: 'Apple VideoToolbox'
    };

    /**
     * 硬件解码方式。
     *
     * 只给 NVENC 配了 cuda：其余两家的硬解（qsv / d3d11va）要么要求额外
     * 初始化设备上下文，要么与 -pix_fmt 组合后行为不稳定，收益又不大
     * （实测硬解只再省约 0.4 核 CPU），不值得冒险。
     *
     * 实测补充：`-hwaccel_output_format cuda` 与显式 `-pix_fmt` 同时出现会
     * 直接报 "Impossible to convert between the formats supported by the
     * filter 'Parsed_null_0' and the filter 'auto_scale_0'"，整条命令报废。
     * 所以这里只用不带 output_format 的形式，让帧解码后回到系统内存。
     */
    var HW_DECODE_METHOD = { nvenc: 'cuda', videotoolbox: 'videotoolbox' };

    /**
     * NVENC 的速度档位。索引与 CODECS.speeds 对齐（0 最快 → 4 最慢）。
     *
     * p3/p5 实测与 p2/p4 画质几乎无差别，跳过不列；p7 是最慢档。
     */
    var NVENC_PRESETS = ['p1', 'p2', 'p4', 'p6', 'p7'];

    /**
     * 使用硬件编码时的并发上限。
     *
     * 实测（RTX 4070 Ti SUPER / 驱动 596.21，1080p30 素材）：
     *   1 路 2838ms，2 路 3057ms，3 路 3838ms，4 路 4573ms，8 路 8220ms。
     * 换算成吞吐分别是 1x / 1.86x / 2.35x / 2.48x / 2.76x —— 三路之后
     * 再加并发几乎换不到吞吐，只是把每路都拖慢。取 2 是为了给
     * 「一路在传帧、一路在编码」留出重叠空间，同时不让单路延迟明显变长。
     */
    var HW_MAX_WORKERS = 2;

    var SPEED_LABELS = ['极快（体积大）', '快', '均衡', '慢', '极慢（体积最小）'];

    var RESOLUTIONS = [
        { v: 'source', l: '跟随原片' },
        { v: '2160', l: '4K · 2160p' },
        { v: '1440', l: '2K · 1440p' },
        { v: '1080', l: '1080p' },
        { v: '720', l: '720p' },
        { v: '480', l: '480p' },
        { v: '360', l: '360p' },
        { v: 'custom', l: '自定义高度…' }
    ];

    var AUDIO_MODES = [
        { v: 'aac', l: '重编码为 AAC' },
        { v: 'copy', l: '复制原音轨（无损·不省体积）' },
        { v: 'none', l: '去除音轨（最省体积）' }
    ];

    var AUDIO_BITRATES = [64, 96, 128, 192, 256];

    var VIDEO_EXTENSIONS = [
        '.mp4', '.mov', '.m4v', '.mkv', '.webm', '.avi', '.wmv', '.flv',
        '.mpg', '.mpeg', '.ts', '.mts', '.m2ts', '.3gp', '.ogv', '.vob', '.rmvb', '.rm', '.asf', '.divx'
    ];

    /**
     * 容器 × 视频编码 兼容表
     *
     * 因为压缩后要「覆盖原文件」，输出扩展名必须与源文件一致，
     * 于是「目标编码能否写进原容器」就成了硬约束。
     * 下表由本机 ffmpeg 7.1 实测得出（见开发记录），不是拍脑袋定的：
     *   - .mov  只认 H.264 / H.265，AV1 与 VP9 会被 muxer 直接拒绝
     *   - .webm 只认 AV1 / VP9，H.264 / H.265 写不了
     *   - .m4v / .3gp 只认 H.264
     * 未实测的老旧容器一律只放开 copy，宁可少列也不要让任务跑到一半失败。
     */
    var CONTAINER_SUPPORT = {
        '.mp4':  ['h264', 'h265', 'av1', 'vp9', 'copy'],
        '.m4v':  ['h264', 'copy'],
        '.mov':  ['h264', 'h265', 'copy'],
        '.mkv':  ['h264', 'h265', 'av1', 'vp9', 'copy'],
        '.webm': ['av1', 'vp9', 'copy'],
        '.avi':  ['h264', 'h265', 'av1', 'vp9', 'copy'],
        '.flv':  ['h264', 'h265', 'av1', 'vp9', 'copy'],
        '.ts':   ['h264', 'h265', 'av1', 'vp9', 'copy'],
        '.mts':  ['h264', 'h265', 'av1', 'vp9', 'copy'],
        '.m2ts': ['h264', 'h265', 'av1', 'vp9', 'copy'],
        '.3gp':  ['h264', 'copy'],
        '.wmv':  ['h264', 'av1', 'vp9', 'copy'],
        '.mpg':  ['h264', 'h265', 'av1', 'vp9', 'copy'],
        '.mpeg': ['h264', 'h265', 'av1', 'vp9', 'copy'],
        '.vob':  ['h264', 'h265', 'copy'],
        '.ogv':  ['copy'],
        '.rmvb': ['copy'],
        '.rm':   ['copy'],
        '.asf':  ['copy'],
        '.divx': ['copy']
    };

    /** WebM 不吃 AAC，改用 Opus */
    function resolveAudioEncoder(ext) {
        return (ext === '.webm' || ext === '.ogv') ? 'libopus' : 'aac';
    }

    // 各容器「重编码后想得到的音频编码」对应的 ffprobe codec_name。
    // 用来判断源音轨能不能直接直通 —— WebM 里塞 AAC 是行不通的。
    var AUDIO_TARGET_CODEC = { aac: 'aac', libopus: 'opus' };

    /**
     * 源音轨能不能原样带走。
     *
     * 无条件 `-c:a aac -b:a 128k` 的问题：源本来就是 128k AAC 时也要重压一遍。
     * 有损编码再压一次是纯亏 —— 音质必然更差，耗时却一分不少。
     *
     * 直通的两个条件（缺一不可）：
     *   1. 编码格式就是本容器想要的那个（aac for MP4 / opus for WebM）
     *   2. 源码率不高于目标码率 × 1.1（10% 的余量是给探测误差留的，
     *      免得源 129k、目标 128k 这种临界值反复横跳）
     *
     * 源码率探测不到时不敢直通：VBR 音轨的标称码率经常缺失，直通等于把
     * 「压缩」这件事整个跳过，用户会拿到一个体积没变的文件却不知道为什么。
     *
     * @param {object} settings 需要 audioBitrate（kbps）
     */
    function shouldCopyAudio(meta, settings, ext) {
        if (!meta.audio) return false;
        var target = AUDIO_TARGET_CODEC[resolveAudioEncoder(ext)];
        var src = String((meta.audio && meta.audio.codec) || '').toLowerCase();
        if (!target || src !== target) return false;

        var srcBps = Number(meta.audio.bitrate) || 0;
        if (!isFinite(srcBps) || srcBps <= 0) return false;

        var targetBps = Number(settings.audioBitrate) * 1000;
        if (!isFinite(targetBps) || targetBps <= 0) return false;
        return srcBps <= targetBps * 1.1;
    }

    /**
     * 编码前预检：目标编码能否写进原容器。
     * @returns {{ok:boolean, reason?:string, suggestion?:string}}
     */
    function validatePlan(meta, settings) {
        var ext = path.extname(meta.path).toLowerCase();
        var allowed = CONTAINER_SUPPORT[ext];
        var codec = CODECS[settings.codec] || CODECS.h264;

        if (!allowed) {
            return {
                ok: false,
                reason: '暂不支持 ' + ext + ' 容器',
                suggestion: '请先把它转成 MP4 再压缩'
            };
        }
        if (allowed.indexOf(codec.id) === -1) {
            var names = allowed.filter(function (c) { return c !== 'copy'; })
                .map(function (c) { return CODECS[c] ? CODECS[c].label.split(' ')[0] : c; });
            return {
                ok: false,
                reason: ext + ' 容器不支持 ' + codec.label.split(' ')[0] + ' 编码',
                suggestion: names.length ? '可改用 ' + names.join(' / ') : '该容器只能复制视频流'
            };
        }
        return { ok: true };
    }

    // 临时文件命名前缀。runTask 里生成的中间产物都用它开头，
    // 便于启动时统一回收上次异常退出留下的垃圾。
    //
    // 【前面的点不是装饰】临时产物为了同卷 rename 会写进**源文件所在目录**，
    // 而那个目录通常就是 Eagle 的素材库目录 —— Eagle 的目录监听会把普通文件名
    // 当成新素材导入，用户压一次片库里就多一个半成品。以 . 开头的文件被
    // Eagle（以及 Spotlight / 大多数同步工具）当作隐藏文件忽略。
    // 旧的三个不带点的前缀仍然保留在清理列表里，用于回收升级前留下的垃圾。
    var TEMP_PREFIXES = [
        '.eagle-vc-out-', '.eagle-vc-pass-', '.eagle-vc-sample-',
        'eagle-vc-out-', 'eagle-vc-pass-', 'eagle-vc-sample-'
    ];

    /** runTask 拼接临时路径时用：只取带点的那三个。 */
    var TEMP_NAME_PREFIXES = {
        out: '.eagle-vc-out-',
        pass: '.eagle-vc-pass-',
        sample: '.eagle-vc-sample-'
    };

    // FFmpeg 在异常素材上可能持续输出错误信息；只需要最后几行诊断，不需要
    // 把完整 stderr 永久留在内存。64 KB 足够保留多个错误上下文，也不会让
    // 多路长任务的日志缓存无限增长。
    var STDERR_TAIL_LIMIT = 64 * 1024;

    var STALE_AGE_MS = 6 * 60 * 60 * 1000;   // 6 小时

    // 取消时先发 SIGTERM 让 ffmpeg 自己收尾，等这么久还不退再补 SIGKILL。
    // 太短等于还是 SIGKILL（收尾来不及做），太长则用户点完取消界面迟迟不响应。
    var GRACEFUL_KILL_TIMEOUT_MS = 800;

    /**
     * 截取文本尾部。错误通常在最后输出，所以丢前面、留最后面。
     * 这是纯函数，方便所有调用方保持相同的内存上限。
     */
    function tailText(text, limit) {
        text = String(text || '');
        limit = Math.max(0, Number(limit) || 0);
        return text.length > limit ? text.slice(text.length - limit) : text;
    }

    /**
     * 临时产物实际落过的目录。
     *
     * preferredTempDir 会把临时文件放进**源目录**（为了同卷 rename），
     * 而启动时的清理如果只扫 os.tmpdir()，那些文件就永远没人回收 ——
     * 进程被硬杀后一个几 GB 的半成品会永久躺在素材库里。
     * 这里记下所有真的写过东西的目录，purgeStaleTemp 默认一并扫。
     */
    var tempDirRegistry = Object.create(null);

    /** 记录一个「临时产物会落到这里」的目录。重复记录无害。 */
    function noteTempDir(dir) {
        if (dir) tempDirRegistry[dir] = true;
    }

    /**
     * 在源文件目录可写时，同卷写临时产物：之后覆盖原文件不需要跨卷复制。
     * 无权限、网络盘异常或路径不可解析时，安全回退系统临时目录。
     *
     * 返回值会自动记进 tempDirRegistry，让启动清理能覆盖到它。
     */
    function preferredTempDir(sourcePath) {
        var dir = path.dirname(sourcePath || '');
        try {
            if (dir && fs && fs.existsSync(dir)) {
                fs.accessSync(dir, fs.constants ? fs.constants.W_OK : fs.W_OK);
                noteTempDir(dir);
                return dir;
            }
        } catch (e) {}
        return os.tmpdir();
    }

    /**
     * 全局 worker 上限。
     *
     * 4 是长期默认值，在 24 核以上的机器上压一堆 720p 小片时明显喂不饱
     * （每个 worker 按 cores/workers 均分线程，4 路时每路也才 6~8 线程，
     * 而 x265 在 720p 上远没到扩展性拐点）。所以核数够多时放开到 8。
     */
    var MAX_WORKERS = 8;

    /** 放开到 MAX_WORKERS 所需的最小核数。低于这个值维持 4，避免小机器上进程切换吃掉收益。 */
    var MAX_WORKERS_MIN_CORES = 24;

    /**
     * AV1 允许开多路并发的分辨率门槛。
     *
     * SVT-AV1 的并行度是按 tile / 帧级任务切的：4K 片源单个进程就能吃满
     * 十几核，再开第二路纯属互抢；720p 这种小分辨率单进程只能跑到 5~6 核
     * （实测 "Level of Parallelism" 恒定 5），剩下的核心就闲置了。
     */
    var AV1_MULTI_WORKER_MAX_HEIGHT = 1080;

    /**
     * 根据编码负载与可用 CPU 核数给出安全的实际 worker 数。
     * concurrency 仍是用户上限：用户选择 1 时绝不会被抬高；高负载编码器则
     * 适当收敛，避免多个自带多线程的 FFmpeg 进程互相抢满全部核心。
     *
     * @param {string} [hwKind] 本次使用的编码器家族（'cpu' / 'nvenc' / …）。
     *                 硬件编码要额外收敛：GPU 的吞吐不会随进程数线性增长，
     *                 见 HW_MAX_WORKERS 处的实测数据。
     * @param {object} [meta]  代表性片源的探测结果。目前只有 AV1 用它看分辨率。
     *                 队列里分辨率不一致时，调用方应传最高的那个（更保守）。
     */
    function recommendedWorkerCount(settings, cpuCount, taskCount, hwKind, meta) {
        settings = settings || {};
        var cores = Math.max(1, Number(cpuCount) || 1);
        var tasks = Math.max(1, Number(taskCount) || 1);

        // 用户上限：核数不够多时保持旧的 4 路天花板。
        var ceiling = cores >= MAX_WORKERS_MIN_CORES ? MAX_WORKERS : 4;
        var requested = Math.max(1, Math.min(ceiling, Number(settings.concurrency) || 1));
        var cap;

        // 两遍编码属于高 CPU / 长任务，且每个 worker 要维护一份 passlog，
        // 两遍之间还有顺序依赖 —— 并发收益远小于内存与精度代价，恒为单路。
        if (settings.mode === 'target') {
            cap = 1;
        } else if (settings.codec === 'av1') {
            var h = meta && meta.video ? Number(meta.video.height) : 0;
            // 拿不到分辨率时按最保守的 1 路处理。
            cap = (h > 0 && h < AV1_MULTI_WORKER_MAX_HEIGHT && cores >= 12)
                ? Math.max(2, Math.min(3, Math.floor(cores / 6)))
                : 1;
        } else {
            cap = Math.max(1, Math.min(MAX_WORKERS, Math.floor(cores / 4)));
        }

        if (isHardwareEncoder({ kind: hwKind })) cap = Math.min(cap, HW_MAX_WORKERS);

        return Math.max(1, Math.min(requested, cap, tasks));
    }

    /**
     * 各编码器的线程上限。0 = 不额外限制（只受核心数约束）。
     *
     * x264 的 16 是实测得出的：超过 16 线程后加速比明显衰减，而且更多的
     * frame-threads 会让码率控制拿到「未来帧」更晚，同码率下画质轻微下降。
     *
     * x265 / SVT-AV1 / VP9 没有这个拐点 —— 它们的 WPP / tile 并行本来就是
     * 为多核设计的，一路 4K x265 在 24 核上能吃满 23 个核，砍到 8 等于
     * 直接扔掉一半算力。
     */
    var THREAD_CAP = { h264: 16 };

    /**
     * 把总核心数分给实际 worker；只由运行时计划使用，不写回用户设置。
     * 留一个核心给 Eagle/UI，再按编码器各自的上限收敛（见 THREAD_CAP）。
     *
     * @param {string} [codecId] 目标编码。省略时不施加编码器上限，
     *                 只按核心数均分（多 worker / 未知编码时用）。
     */
    function recommendedThreadCount(cpuCount, workerCount, codecId) {
        var cores = Math.max(1, Number(cpuCount) || 1);
        var workers = Math.max(1, Number(workerCount) || 1);
        var n = Math.max(1, Math.floor(Math.max(1, cores - 1) / workers));
        var cap = THREAD_CAP[codecId] || 0;
        return cap > 0 ? Math.max(1, Math.min(cap, n)) : n;
    }

    // 探测 FFmpeg 时等待 Eagle 依赖插件响应的上限。
    // 依赖插件走 IPC，超时后直接回落到系统 PATH，不让 UI 干等。
    var BINARY_PROBE_TIMEOUT = 8000;

    /**
     * 回收上次异常退出遗留的临时文件。
     *
     * 正常流程（完成 / 失败 / 取消）都会在任务结束时删掉临时文件，
     * 但进程被硬杀（Eagle 崩溃、强制关闭插件、系统重启）时没人收尾，
     * 一个几 GB 的半成品视频就会永久躺在临时目录里。这里在启动时兜底。
     *
     * 只清理 6 小时以前的，避免误删另一个插件窗口正在写入的文件。
     *
     * @param {string[]} [dirs] 要扫的目录；省略时扫系统临时目录 + 本次会话
     *                          实际写过临时产物的目录（见 tempDirRegistry）。
     * @returns {number} 清理掉的文件数
     */
    function purgeStaleTemp(dirs) {
        var targets = (dirs && dirs.length) ? dirs : [os.tmpdir()].concat(Object.keys(tempDirRegistry));
        var now = Date.now();
        var removed = 0;

        targets.forEach(function (dir) {
            if (!dir) return;
            try {
                fs.readdirSync(dir).forEach(function (name) {
                    var hit = TEMP_PREFIXES.some(function (p) { return name.indexOf(p) === 0; });
                    if (!hit) return;
                    var full = path.join(dir, name);
                    try {
                        var st = fs.statSync(full);
                        if (now - st.mtimeMs < STALE_AGE_MS) return;
                        fs.unlinkSync(full);
                        removed++;
                    } catch (e) { /* 文件可能已被删或正被占用，跳过 */ }
                });
            } catch (e) { /* 读不了这个目录就算了，不该因此阻断启动 */ }
        });

        return removed;
    }

    /**
     * 体积闸门：产物没有明显变小就不要替换原文件。
     *
     * 抽成纯函数是因为这是「不可逆操作之前的那道判断」，必须能单测。
     * 判据用「小 2%」而不是「更小」：只小几十 KB 的替换毫无意义，
     * 却要付出一次覆盖风险 + 一次有损重编码。
     *
     * @returns {boolean} true = 值得提交
     */
    var COMMIT_MIN_RATIO = 0.98;
    function shouldCommit(outputSize, sourceSize) {
        var src = Number(sourceSize);
        var out = Number(outputSize);
        // 源大小未知时不做判断，交给调用方按「产物非空」处理
        if (!isFinite(src) || src <= 0) return isFinite(out) && out > 0;
        if (!isFinite(out) || out <= 0) return false;
        return out < src * COMMIT_MIN_RATIO;
    }

    // ---------------------------------------------------------------------
    // 错误类型
    // ---------------------------------------------------------------------
    function FfmpegNotFoundError(message, installable) {
        var err = new Error(message);
        err.name = 'FfmpegNotFoundError';
        err.installable = !!installable;
        return err;
    }

    function CancelledError(message) {
        var err = new Error(message || '已取消');
        err.name = 'CancelledError';
        err.cancelled = true;
        return err;
    }

    // ---------------------------------------------------------------------
    // 二进制定位
    // ---------------------------------------------------------------------
    var binaryCache = null;

    function whichSync(name) {
        try {
            var cmd = proc.platform === 'win32' ? 'where' : 'which';
            var r = cp.spawnSync(cmd, [name], { encoding: 'utf8' });
            if (r.status !== 0 || !r.stdout) return null;
            var line = r.stdout.split(/\r?\n/).map(function (s) { return s.trim(); })
                .filter(function (s) { return !!s; })[0];
            return line || null;
        } catch (e) {
            return null;
        }
    }

    function existsSync(p) {
        try { return fs.existsSync(p); } catch (e) { return false; }
    }

    /**
     * 给 Promise 套一层超时。
     *
     * 这是必需的：Eagle 的依赖插件走 IPC，一旦对方无响应，Promise 会永远
     * 停在 pending —— 既不 resolve 也不 reject。单纯写 .catch() 完全救不了，
     * 整个检测链会静默挂死，UI 永远停在「正在检测 FFmpeg…」。
     *
     * 超时和失败必须区分开，否则会出大问题：如果失败也返回 fallback，
     * 上层拿到 null 只能当成"超时"处理，真正的错误原因（例如"系统里
     * 没装 ffmpeg，请安装依赖插件"，以及挂在错误对象上的 install 回调）
     * 就全被抹掉了，用户看到的又是一句无解的「检测超时，请重试」。
     *
     * @param {*} promise 任意 thenable
     * @param {number} ms 超时毫秒
     * @param {*} fallback 仅「超时」时返回这个值；失败仍按原样 reject
     * @returns {Promise<*>} 超时 resolve(fallback)，其余沿用原 Promise 的结果
     */
    function withTimeout(promise, ms, fallback) {
        return new Promise(function (resolve, reject) {
            var settled = false;
            var timer = setTimeout(function () {
                if (settled) return;
                settled = true;
                resolve(fallback);
            }, ms);

            function finish(v) {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                resolve(v);
            }

            function fail(e) {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                reject(e);
            }

            try {
                Promise.resolve(promise).then(finish, fail);
            } catch (e) {
                fail(e);
            }
        });
    }

    /**
     * 定位 ffmpeg / ffprobe。
     * 优先级：Eagle FFmpeg 依赖插件 → 系统 PATH → 常见安装路径。
     *
     * @param {object} [eagle] Eagle API 对象，浏览器环境下传入
     * @returns {Promise<{ffmpeg:string, ffprobe:string, source:string, version:string}>}
     */
    function resolveBinaries(eagle) {
        if (binaryCache) return Promise.resolve(binaryCache);

        var mod = eagle && eagle.extraModule && eagle.extraModule.ffmpeg;
        var eagleProbeFailed = false;   // 依赖插件这条路是否走不通

        return Promise.resolve()
            .then(function () {
                // 1) Eagle FFmpeg 依赖插件
                if (!mod || typeof mod.isInstalled !== 'function') return null;
                // 依赖插件走 IPC，接口不兼容、调用失败、或永不响应都要兜住。
                // 系统里很可能已经装了 ffmpeg，回落到 PATH 更有用。
                // 这里显式把「探测失败」翻译成 null（= 这条路不通），
                // 而不是让错误往外冒 —— 真正的失败判定留给最后统一处理。
                return withTimeout(mod.isInstalled(), BINARY_PROBE_TIMEOUT, null)
                    .catch(function () { return null; });
            })
            .then(function (installed) {
                if (installed && typeof mod.getPaths === 'function') {
                    return withTimeout(mod.getPaths(), BINARY_PROBE_TIMEOUT, null)
                        .catch(function () { return null; })
                        .then(function (paths) {
                            if (paths && paths.ffmpeg && paths.ffprobe) {
                                return { ffmpeg: paths.ffmpeg, ffprobe: paths.ffprobe, source: 'eagle' };
                            }
                            return null;
                        });
                }
                // 关键：走到这里只说明「Eagle 依赖插件这条走不通」，
                // 可能是没装、也可能是 IPC 超时或返回了异常值（null/undefined）。
                // 这绝不等于系统里没有 ffmpeg —— 很多人 brew install 过。
                // 所以这里不能急着抛错，必须先让下面的系统 PATH 兜底试一轮，
                // 全都没有时才报错并引导安装。
                eagleProbeFailed = true;
                return null;
            })
            .then(function (hit) {
                if (hit) return hit;
                // 2) 系统 PATH
                var ff = whichSync('ffmpeg');
                var fp = whichSync('ffprobe');
                if (ff && fp) return { ffmpeg: ff, ffprobe: fp, source: 'system' };
                // 3) 常见安装路径
                var candidates = [
                    ['/opt/homebrew/bin/ffmpeg', '/opt/homebrew/bin/ffprobe'],
                    ['/usr/local/bin/ffmpeg', '/usr/local/bin/ffprobe'],
                    ['/usr/bin/ffmpeg', '/usr/bin/ffprobe']
                ];
                for (var i = 0; i < candidates.length; i++) {
                    if (existsSync(candidates[i][0]) && existsSync(candidates[i][1])) {
                        return { ffmpeg: candidates[i][0], ffprobe: candidates[i][1], source: 'system' };
                    }
                }
                var canInstall = !!(mod && typeof mod.install === 'function');
                var err = FfmpegNotFoundError(
                    eagleProbeFailed
                        ? '未找到可用的 FFmpeg：Eagle 依赖插件无响应，系统里也没有检测到 ffmpeg。'
                        : '未找到 ffmpeg。请在 Eagle 中安装「FFmpeg 依赖插件」，或在系统里安装 ffmpeg 后重试。',
                    canInstall
                );
                if (canInstall) err.install = function () { return mod.install(); };
                throw err;
            })
            .then(function (info) {
                return getVersion(info.ffmpeg).then(function (v) {
                    info.version = v;
                    binaryCache = info;
                    return info;
                });
            });
    }

    function getVersion(ffmpegPath) {
        return new Promise(function (resolve) {
            var settled = false;
            function done(v) {
                if (settled) return;
                settled = true;
                resolve(v);
            }
            // 连 -version 都跑不完的二进制，别让它拖住整个初始化
            var timer = setTimeout(function () { done(''); }, 5000);
            try {
                var p = cp.spawn(ffmpegPath, ['-version']);
                var out = '';
                p.stdout.on('data', function (d) { out += d.toString(); });
                p.on('error', function () { done(''); });
                p.on('close', function (code) {
                    var m = /ffmpeg version (\S+)/.exec(out || '');
                    done(m ? m[1] : (code === 0 ? 'unknown' : ''));
                });
            } catch (e) {
                done('');
            }
            // 定时器触发时若已 settle，done() 会被 settled 标志挡下，无需 clearTimeout
        });
    }

    // ---------------------------------------------------------------------
    // 硬件能力探测
    // ---------------------------------------------------------------------
    var hwCache = null;

    /**
     * 解析 `ffmpeg -encoders` 的输出，取出所有编码器名。
     * 每行形如：  V....D h264_nvenc    NVIDIA NVENC H.264 encoder (codec h264)
     */
    function parseEncoderNames(text) {
        var set = {};
        String(text || '').split(/\r?\n/).forEach(function (line) {
            var m = /^\s*[A-Z.]{6}\s+([a-z0-9_]+)\s/.exec(line);
            if (m) set[m[1]] = true;
        });
        return set;
    }

    function runCapture(bin, args, timeoutMs) {
        return new Promise(function (resolve) {
            var out = '';
            var settled = false;
            function done(v) {
                if (settled) return;
                settled = true;
                resolve(v);
            }
            var timer = setTimeout(function () { done(out); }, timeoutMs || 5000);
            try {
                var p = cp.spawn(bin, args);
                p.stdout.on('data', function (d) { out += d.toString(); });
                p.on('error', function () { clearTimeout(timer); done(''); });
                p.on('close', function () { clearTimeout(timer); done(out); });
            } catch (e) {
                clearTimeout(timer);
                done('');
            }
        });
    }

    /**
     * 探测可用的硬件编码家族。
     *
     * 注意这只能证明「FFmpeg 编译进了这个编码器、且它出现在列表里」，
     * 不能证明机器上真有对应的 GPU —— 例如装了 NVIDIA 驱动但用的是
     * 集显输出时 h264_nvenc 照样列得出来。真正的成败只有在编码那一刻
     * 才能确定，所以 app.js 里必须保留「硬件失败 → 回退 CPU」的兜底，
     * 不能把这里的结论当成保证。
     *
     * @returns {Promise<{families:string[], encoders:object, decodeMethods:string[]}>}
     */
    function detectHardware(binaries) {
        if (hwCache) return Promise.resolve(hwCache);
        if (!binaries || !binaries.ffmpeg) {
            return Promise.resolve({ families: [], encoders: {}, decodeMethods: [] });
        }

        var encoders = {};
        var decodeMethods = [];

        return runCapture(binaries.ffmpeg, ['-hide_banner', '-encoders'], 8000)
            .then(function (text) {
                encoders = parseEncoderNames(text);
                return runCapture(binaries.ffmpeg, ['-hide_banner', '-hwaccels'], 8000);
            })
            .then(function (text) {
                // 输出形如 "Hardware acceleration methods:" 后每行一个方法名
                String(text || '').split(/\r?\n/).forEach(function (line) {
                    var name = line.trim();
                    if (name && /^[a-z0-9_]+$/.test(name) && name.indexOf('acceleration') === -1) {
                        decodeMethods.push(name);
                    }
                });

                var families = HW_FAMILY_ORDER.filter(function (fam) {
                    return Object.keys(CODECS).some(function (id) {
                        var hw = CODECS[id].hw;
                        return !!(hw && hw[fam] && encoders[hw[fam].encoder]);
                    });
                });

                hwCache = { families: families, encoders: encoders, decodeMethods: decodeMethods };
                return hwCache;
            })
            .catch(function () {
                // 探测失败不该阻断启动：当作没有硬件可用，按纯 CPU 走。
                hwCache = { families: [], encoders: {}, decodeMethods: [] };
                return hwCache;
            });
    }

    /** 清掉探测缓存。仅供测试与「重新检测」使用。 */
    function resetHardwareCache() { hwCache = null; }

    /**
     * 选定本次编码真正要用的编码器。
     *
     * @param {string} codecId  h264 / h265 / av1 / vp9 / copy
     * @param {object} settings 含 hwAccel: 'auto' | 'cpu' | 'gpu'
     * @param {object} hw      detectHardware 的结果
     * @returns {{codecId:string, encoder:string, kind:string, hw:object|null}}
     *          kind 为 'cpu' 或某个硬件家族名
     */
    function resolveEncoder(codecId, settings, hw) {
        var codec = CODECS[codecId] || CODECS.h264;
        var cpu = { codecId: codec.id, encoder: codec.encoder, kind: 'cpu', hw: null };

        // 复制视频流不涉及编码，硬件无从谈起。
        if (codec.id === 'copy') return cpu;

        var mode = (settings && settings.hwAccel) || 'auto';
        if (mode === 'cpu') return cpu;

        var available = (hw && hw.encoders) || {};
        for (var i = 0; i < HW_FAMILY_ORDER.length; i++) {
            var fam = HW_FAMILY_ORDER[i];
            var entry = codec.hw && codec.hw[fam];
            if (entry && available[entry.encoder]) {
                return { codecId: codec.id, encoder: entry.encoder, kind: fam, hw: entry };
            }
        }
        return cpu;
    }

    /** 该组合最终会不会走硬件编码。UI 用它决定要不要显示「GPU」标记。 */
    function isHardwareEncoder(enc) {
        return !!enc && enc.kind && enc.kind !== 'cpu';
    }

    /**
     * 软件 CRF → 硬件恒定 QP。
     *
     * 【实测结论，不要凭直觉改】
     * 直接把 x265 的 crf 当成 NVENC 的 -cq 用是错的：两者刻度不同，
     * 30 秒 1080p 素材上 x265 -crf 28 出 15.5 MB，hevc_nvenc -cq 28
     * 出 22.6 MB（+45%）；换一段柔和素材差距更离谱，2.6 MB 对 11.5 MB（+340%）。
     *
     * 改成 -rc constqp -qp 后响应曲线几乎贴合 x265 的 CRF：高频素材
     * q28 与 crf28 体积完全一致，柔和素材偏差 +46%。再补 +2 的偏移
     * 把两条曲线在中段对齐，残余偏差约 ±20%。
     *
     * 同等码率下 NVENC 与 x265 的 PSNR 差距在 0.12 dB 以内（肉眼不可辨），
     * 所以体积对齐即画质对齐，这个换算是安全的。
     *
     * AV1 的 QP 刻度完全不同（0~255），实测 crf 32 对应 av1_nvenc
     * constqp 约 102，故乘 3.2。
     *
     * @param {number} crf     软件编码器的 CRF 值
     * @param {string} codecId
     * @returns {number} 硬件恒定 QP
     */
    function crfToHwQp(crf, codecId) {
        var codec = CODECS[codecId] || CODECS.h265;
        var scale = codec.hwQpScale || { mul: 1, add: 2, max: 51 };
        var base = isFinite(crf) ? crf : (codec.crf ? codec.crf.def : 28);
        var qp = Math.round(base * scale.mul + scale.add);
        return Math.max(1, Math.min(scale.max, qp));
    }

    /**
     * VideoToolbox 的 CRF → `-q:v` 换算。
     *
     * 【方向和所有其他编码器相反，别照抄 crfToHwQp】VT 的 -q:v 是 1~100 且
     * **越大画质越好**，而 CRF / QP 是越小越好。套用 NVENC 的刻度会得到
     * 一个几乎反向的结果：crf 51（最差）会被算成最好的画质。
     *
     * 系数 1.7 来自本机实测的率失真曲线（1080p / 20s / testsrc2）：
     *   q=40 → 4.57MB   q=50 → 8.30MB   q=55 → 14.71MB   q=60 → 17.46MB
     * 而 x265 -crf 28 是 11.32MB，插值得到对齐点 q ≈ 52.4，
     * 反解出 100 - 28 × 1.7 = 52.4。
     *
     * 【这个系数必须在真实素材上复标一次】testsrc2 是合成素材，率失真曲线
     * 和真片差得远 —— 真片通常细节更多、x265 的 CRF 曲线更陡，同样 CRF 下
     * 需要的 q 会偏低。这里的 1.7 只能当起点。
     */
    var VT_QUALITY_SCALE = 1.7;
    function crfToVtQuality(crf, codecId) {
        var codec = CODECS[codecId] || CODECS.h265;
        var base = isFinite(crf) ? crf : (codec.crf ? codec.crf.def : 28);
        var q = Math.round(100 - base * VT_QUALITY_SCALE);
        return Math.max(1, Math.min(100, q));
    }

    /**
     * 按家族把 CRF 翻译成该家族的「恒定画质」参数。
     *
     * 抽出来是因为 VT 那一家不是换个系数的问题，而是**方向相反**，
     * 混用会让整个画质档位倒过来。
     */
    function crfToHwQuality(crf, codecId, kind) {
        return kind === 'videotoolbox' ? crfToVtQuality(crf, codecId) : crfToHwQp(crf, codecId);
    }

    /**
     * 输入侧的硬件解码参数。
     *
     * 【必须放在 -i 之前】`-hwaccel` 是输入选项，写在 -i 后面会直接报
     * "Option hwaccel cannot be applied" 让整条命令失败 —— 实测踩过。
     * 所以这一组参数只能由调用方插到输入参数区，不能混进输出参数。
     *
     * 源编码不被硬件支持时（例如 MPEG-4 / VP9 在部分显卡上），FFmpeg 会
     * 自动退回软解并打印一行提示，不会失败，所以这里可以无条件加。
     */
    function hwInputArgs(enc, hw) {
        if (!isHardwareEncoder(enc)) return [];
        var method = HW_DECODE_METHOD[enc.kind];
        if (!method) return [];
        if (hw && hw.decodeMethods && hw.decodeMethods.indexOf(method) === -1) return [];
        return ['-hwaccel', method];
    }

    // ---------------------------------------------------------------------
    // 元信息探测
    // ---------------------------------------------------------------------
    function parseFrameRate(str) {
        if (!str) return 0;
        var parts = String(str).split('/');
        var n = parseFloat(parts[0]);
        var d = parts.length > 1 ? parseFloat(parts[1]) : 1;
        if (!isFinite(n) || !isFinite(d) || d === 0) return 0;
        return n / d;
    }

    /**
     * 从 pix_fmt 推断位深。
     * yuv420p → 8，yuv420p10le → 10，p010le → 10，gray → 8，yuv444p12le → 12
     */
    function bitDepthOf(stream) {
        if (!stream) return 0;
        var raw = parseInt(stream.bits_per_raw_sample, 10);
        if (isFinite(raw) && raw > 0) return raw;
        var fmt = stream.pix_fmt || '';
        var m = /(\d{2})(le|be)?$/.exec(fmt);
        if (m) {
            var d = parseInt(m[1], 10);
            if (d >= 8 && d <= 16) return d;
        }
        return 8;
    }

    // ---------------------------------------------------------------------
    // HDR 识别
    // ---------------------------------------------------------------------
    // PQ（SMPTE ST 2084，HDR10 用的传递函数）与 HLG（ARIB STD-B67，广播电视用）
    // 是两种完全不同的 HDR 方案，标签要分开显示，不能笼统叫「HDR」。
    var HDR_TRANSFER_KIND = {
        smpte2084: 'hdr10',
        'arib-std-b67': 'hlg'
    };

    // 杜比视界与 HDR10+ 走 side_data，不体现在 color_transfer 上。
    // 这里只匹配类型名里的关键词，避免受 ffprobe 版本命名差异影响。
    var DOVI_SIDE_DATA = /DOVI|dolby.?vision/i;
    var HDR10PLUS_SIDE_DATA = /SMPTE\s*2094-40|HDR10\s*\+/i;

    /**
     * 判断视频流是不是 HDR。
     *
     * 不能只看 color_transfer：本地实测造出来的 HLG 样本里，transfer 压根没写进
     * 容器，ffprobe 只报得出 color_space=bt2020nc。只认单一字段会整片漏判，
     * 所以这里按「明确信号优先、BT.2020 + 10-bit 兜底」的顺序判定。
     *
     * @param {object} stream ffprobe 的视频流对象
     * @param {number} bitDepth 已推断出的位深
     * @returns {{isHdr:boolean, kind:string|null, transfer:string, primaries:string,
     *            space:string, dolbyVision:boolean, hdr10Plus:boolean}}
     */
    function detectHdr(stream, bitDepth) {
        stream = stream || {};
        var sideData = stream.side_data_list || [];
        var transfer = String(stream.color_transfer || '').toLowerCase();
        var primaries = String(stream.color_primaries || '').toLowerCase();
        var space = String(stream.color_space || '').toLowerCase();

        var dolbyVision = sideData.some(function (d) {
            return d && DOVI_SIDE_DATA.test(String(d.side_data_type || ''));
        });
        var hdr10Plus = sideData.some(function (d) {
            return d && HDR10PLUS_SIDE_DATA.test(String(d.side_data_type || ''));
        });

        var kind = null;

        // 杜比视界优先：它通常同时带 HDR10 的 transfer，但用户更想知道「这是 DV」。
        if (dolbyVision) kind = 'dolbyVision';
        else if (HDR_TRANSFER_KIND[transfer]) kind = HDR_TRANSFER_KIND[transfer];
        else if (hdr10Plus) kind = 'hdr10Plus';
        // 兜底：颜色矩阵是 BT.2020 且位深 ≥10，即便容器里没写 transfer，
        // 实际内容几乎必然是 HDR（本地 HLG 样本就是这么暴露的）。
        else if (space === 'bt2020nc' && bitDepth >= 10) kind = 'hdr';

        return {
            isHdr: !!kind,
            kind: kind,
            transfer: transfer,
            primaries: primaries,
            space: space,
            dolbyVision: dolbyVision,
            hdr10Plus: hdr10Plus
        };
    }

    // ---------------------------------------------------------------------
    // 「已被本插件压缩过」标记
    // ---------------------------------------------------------------------
    var MARKER_KEY = 'EagleVideoCompress';
    var MARKER_VERSION = 1;

    /**
     * 哪些容器能存自定义 metadata。
     *
     * 这是实测结论，不是推测：
     *   - MP4 / MOV / M4V 的 muxer 默认会「静默丢弃」不认识的 key —— 退出码 0、
     *     文件照常生成，标记却不在。必须配合 -movflags +use_metadata_tags 写进 mdta box。
     *   - MKV / WebM 原生支持任意 tag，但会把 key 大写，读取时得忽略大小写。
     *   - AVI / TS 没有承载任意 metadata 的地方，写不进去。宁可明确不支持，
     *     也不要让用户以为标记成功了。
     */
    var MARKER_CONTAINERS = {
        '.mp4': 'movflags',
        '.mov': 'movflags',
        '.m4v': 'movflags',
        '.mkv': 'native',
        '.webm': 'native'
    };

    /** 当天日期，YYYY-MM-DD。写进标记里给用户看「什么时候压的」。 */
    function todayStamp(now) {
        var d = now || new Date();
        var pad = function (x) { return (x < 10 ? '0' : '') + x; };
        return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    }

    /**
     * 从容器 tag 里读出压缩标记。
     *
     * Matroska 会把 key 转成大写，所以比对必须忽略大小写 —— 否则 MKV 上的
     * 标记等于白写，插件永远认不出自己压过的文件。
     *
     * @returns {{compressed:boolean, version:number, count:number, date:string,
     *            codec:string, mode:string}}
     */
    function parseCompressionMarker(tags) {
        var empty = { compressed: false, version: 0, count: 0, date: '', codec: '', mode: '' };
        if (!tags) return empty;

        var value = null;
        Object.keys(tags).forEach(function (k) {
            if (value === null && k.toUpperCase() === MARKER_KEY.toUpperCase()) value = tags[k];
        });
        if (value === null || value === undefined) return empty;

        var parts = String(value).split(';');
        // 第一段是 schema 版本。将来格式变了，靠它决定怎么解析，老版本宁可不认。
        var vm = /^v(\d+)$/.exec(String(parts[0]).trim());
        if (!vm || parseInt(vm[1], 10) !== MARKER_VERSION) return empty;

        var out = { compressed: true, version: MARKER_VERSION, count: 0, date: '', codec: '', mode: '' };
        for (var i = 1; i < parts.length; i++) {
            var eq = parts[i].indexOf('=');
            if (eq === -1) continue;
            var key = parts[i].slice(0, eq).trim();
            var val = parts[i].slice(eq + 1).trim();
            if (key === 'count') out.count = parseInt(val, 10) || 0;
            else if (key === 'date') out.date = val;
            else if (key === 'codec') out.codec = val;
            else if (key === 'mode') out.mode = val;
        }
        return out;
    }

    /**
     * 生成要写进容器的标记值。
     * 已压过的文件次数累加 —— 「压过几次」比「压过没有」有用得多。
     */
    function buildCompressionMarker(meta, settings, now) {
        var prev = (meta && meta.compression) || { count: 0 };
        return [
            'v' + MARKER_VERSION,
            'codec=' + (settings.codec || ''),
            'mode=' + (settings.mode || ''),
            'date=' + todayStamp(now),
            'count=' + ((parseInt(prev.count, 10) || 0) + 1)
        ].join(';');
    }

    /**
     * 压缩标记的写入参数。
     * 容器不支持时返回空数组，调用方据此如实告诉用户「这个格式写不进标记」。
     */
    function markerArgs(ext, meta, settings, now) {
        if (!settings || settings.writeCompressionMarker === false) return [];
        var mode = MARKER_CONTAINERS[String(ext).toLowerCase()];
        if (!mode) return [];

        var args = [];
        if (mode === 'movflags') args.push('-movflags', '+use_metadata_tags');
        args.push('-metadata', MARKER_KEY + '=' + buildCompressionMarker(meta, settings, now));
        return args;
    }

    /** 该容器能不能存压缩标记。UI 用它决定要不要提示「此格式不支持标记」。 */
    function supportsCompressionMarker(ext) {
        return !!MARKER_CONTAINERS[String(ext).toLowerCase()];
    }

    /**
     * 当前设置会不会破坏 HDR。
     *
     * 关键风险：H.264 在编码表里是 tenBit:false，HDR 源一旦选它就会被强制降到
     * 8-bit —— HDR 信息直接没了、颜色发灰，而这类损失是不可逆的。
     * 这里只做判断，不替用户改设置。
     */
    function hdrRisk(meta, settings) {
        var no = { atRisk: false, reason: '' };
        if (!meta || !meta.video || !meta.video.hdr || !meta.video.hdr.isHdr) return no;

        var codec = CODECS[settings && settings.codec] || CODECS.h264;
        // 复制视频流不动像素格式，HDR 不受影响。
        if (codec.id === 'copy') return no;
        if (codec.tenBit) return no;

        return {
            atRisk: true,
            reason: '该文件是 HDR，改用 ' + codec.label.split(' ')[0] +
                ' 会被降到 8-bit，HDR 信息将丢失且不可逆'
        };
    }

    function normalizeProbe(raw, filePath, statSize) {
        var format = raw.format || {};
        var streams = raw.streams || [];
        var video = null, audio = null;
        // 【track 计数不能省】ffmpeg 的默认流选择是「每类只留一路」，
        // 双音轨源压完会静默掉一条。只留第一条音轨的写法让这个故障
        // 在探测阶段就变成不可见的了 —— 上层既没法提醒，也没法校验产物。
        var counts = { video: 0, audio: 0, subtitle: 0 };
        var subtitleCodecs = [];
        for (var i = 0; i < streams.length; i++) {
            var s = streams[i];
            if (s.codec_type === 'video') {
                // 封面（attached_pic）不是正片，既不当主视频流也不计入
                if (s.disposition && s.disposition.attached_pic) continue;
                if (!video) video = s;
                counts.video++;
            } else if (s.codec_type === 'audio') {
                if (!audio) audio = s;
                counts.audio++;
            } else if (s.codec_type === 'subtitle') {
                counts.subtitle++;
                subtitleCodecs.push(s.codec_name || '');
            }
        }

        var duration = parseFloat(format.duration);
        if (!isFinite(duration) && video) duration = parseFloat(video.duration);
        if (!isFinite(duration)) duration = 0;

        var size = isFinite(statSize) ? statSize : (parseInt(format.size, 10) || 0);
        var totalBitrate = parseInt(format.bit_rate, 10) || 0;
        if (!totalBitrate && duration > 0) totalBitrate = Math.round(size * 8 / duration);

        // MKV / WebM 经常把码率只记在容器层，流级 bit_rate 是 0。
        // 这里用「容器码率 - 音轨码率」兜底，避免界面上显示 0 kbps。
        var audioBitrate = audio ? (parseInt(audio.bit_rate, 10) || 0) : 0;
        var videoBitrate = video ? (parseInt(video.bit_rate, 10) || 0) : 0;
        if (!videoBitrate && totalBitrate) videoBitrate = Math.max(0, totalBitrate - audioBitrate);

        var tags = format.tags || {};
        var bitDepth = video ? bitDepthOf(video) : 0;

        return {
            path: filePath,
            duration: duration,
            size: size,
            // 各类流的数量。buildPlan 靠它决定字幕能不能留，verifyOutput 靠它
            // 判断产物有没有丢轨 —— 两者都是「覆盖原文件前」的保险。
            tracks: counts,
            subtitleCodecs: subtitleCodecs,
            // 容器 tag。压缩标记就存在这里，UI 也靠它显示「此文件压过几次」。
            tags: tags,
            compression: parseCompressionMarker(tags),
            // ffprobe 对 mp4 常返回 "mov,mp4,m4a,3gp,3g2,mj2"，直接显示会撑爆布局，
            // 取第一段作为容器名即可
            container: (format.format_name || '').split(',')[0] || '',
            containerLong: format.format_long_name || '',
            totalBitrate: totalBitrate,
            video: video ? {
                codec: video.codec_name || '',
                codecLong: video.codec_long_name || '',
                profile: video.profile || '',
                width: parseInt(video.width, 10) || 0,
                height: parseInt(video.height, 10) || 0,
                fps: parseFrameRate(video.avg_frame_rate || video.r_frame_rate),
                fpsRaw: video.avg_frame_rate || video.r_frame_rate || '',
                pixFmt: video.pix_fmt || '',
                bitDepth: bitDepth,
                bitrate: videoBitrate,
                frames: parseInt(video.nb_frames, 10) || 0,
                // HDR 判定要拿到完整色彩信息：transfer 决定 PQ/HLG，
                // side_data 里还有杜比视界和 HDR10+。
                colorTransfer: video.color_transfer || '',
                colorPrimaries: video.color_primaries || '',
                colorSpace: video.color_space || '',
                hdr: detectHdr(video, bitDepth)
            } : null,
            audio: audio ? {
                codec: audio.codec_name || '',
                codecLong: audio.codec_long_name || '',
                sampleRate: parseInt(audio.sample_rate, 10) || 0,
                channels: parseInt(audio.channels, 10) || 0,
                bitrate: parseInt(audio.bit_rate, 10) || 0
            } : null
        };
    }

    /**
     * 探测单个视频文件的完整元信息。
     * @returns {Promise<object>} normalizeProbe 的返回结构
     */
    function probe(binaries, filePath) {
        return new Promise(function (resolve, reject) {
            var statSize = NaN;
            var statMtime = 0;
            try {
                var st = fs.statSync(filePath);
                statSize = st.size;
                // mtime 顺手在这里取走：采样预估的缓存键要它，而渲染线程上任何
                // 一次同步 stat 都会卡住界面（网络盘 / 移动硬盘上可以是几百毫秒）。
                statMtime = st.mtimeMs || 0;
            } catch (e) {}

            var args = [
                '-v', 'error',
                '-print_format', 'json',
                '-show_format',
                '-show_streams',
                filePath
            ];

            var p = cp.spawn(binaries.ffprobe, args);
            var out = '', err = '';

            p.stdout.on('data', function (d) { out += d.toString(); });
            p.stderr.on('data', function (d) { err += d.toString(); });
            p.on('error', reject);
            p.on('close', function (code) {
                if (code !== 0) {
                    return reject(new Error('无法读取该文件（可能不是有效的视频文件）：' + (err || '').trim()));
                }
                var parsed;
                try {
                    parsed = JSON.parse(out);
                } catch (e) {
                    return reject(new Error('解析视频信息失败'));
                }
                if (!parsed.streams || !parsed.streams.some(function (s) { return s.codec_type === 'video'; })) {
                    return reject(new Error('该文件没有视频流，已跳过'));
                }
                var meta = normalizeProbe(parsed, filePath, statSize);
                // 只有真实探测才会带上 mtime；手工构造的 meta（测试 / 回退路径）
                // 没有这个字段时，采样缓存键退化为「路径 + 体积 + 参数」。
                meta.mtimeMs = statMtime;
                resolve(meta);
            });
        });
    }

    // ---------------------------------------------------------------------
    // 编码参数构建
    // ---------------------------------------------------------------------
    function isVideoFile(filePath) {
        var ext = path.extname(filePath || '').toLowerCase();
        return VIDEO_EXTENSIONS.indexOf(ext) !== -1;
    }

    function resolveTargetHeight(meta, settings) {
        if (!meta.video) return 0;
        if (settings.resolution === 'source') return 0;
        var h = settings.resolution === 'custom'
            ? parseInt(settings.customHeight, 10)
            : parseInt(settings.resolution, 10);
        if (!isFinite(h) || h <= 0) return 0;
        // 只缩小，绝不放大
        if (h >= meta.video.height) return 0;
        return h;
    }

    /**
     * 目标文件大小模式：反推视频码率。
     * 总目标 = 视频码率 × 时长 + 音频码率 × 时长 + 容器开销(约 2%)
     */
    function calcTargetVideoKbps(meta, settings) {
        var duration = meta.duration > 0 ? meta.duration : 1;
        var targetBits = settings.targetSizeMB * 1024 * 1024 * 8;

        var audioKbps = 0;
        if (settings.audioMode === 'aac') {
            audioKbps = settings.audioBitrate;
        } else if (settings.audioMode === 'copy' && meta.audio) {
            audioKbps = (meta.audio.bitrate || 128000) / 1000;
        }

        var audioBits = audioKbps * 1000 * duration;
        var videoBits = targetBits * 0.98 - audioBits;
        var kbps = Math.floor(videoBits / duration / 1000);

        return {
            kbps: Math.max(50, kbps),
            tooSmall: videoBits <= 0 || kbps < 50
        };
    }

    /**
     * 预估输出大小（字节）。CRF 模式无法准确预估，返回 null。
     */
    function estimateOutputSize(meta, settings) {
        if (settings.mode === 'crf') return null;   // CRF 画质恒定，体积取决于内容，无法预估
        var duration = meta.duration > 0 ? meta.duration : 1;

        var audioKbps = 0;
        if (settings.audioMode === 'aac') {
            audioKbps = settings.audioBitrate;
        } else if (settings.audioMode === 'copy' && meta.audio) {
            audioKbps = (meta.audio.bitrate || 128000) / 1000;
        }
        if (settings.audioMode === 'none') audioKbps = 0;

        if (settings.codec === 'copy') {
            // 仅重新封装：视频体积不变，只有音轨可能变化
            var srcAudioKbps = (meta.audio && meta.audio.bitrate ? meta.audio.bitrate : 128000) / 1000;
            var vBitrate = (meta.video && meta.video.bitrate)
                || Math.max(0, meta.totalBitrate - srcAudioKbps * 1000);
            return Math.round((vBitrate + audioKbps * 1000) * duration / 8);
        }

        var videoKbps = settings.mode === 'bitrate'
            ? settings.videoBitrate
            : calcTargetVideoKbps(meta, settings).kbps;

        return Math.round((videoKbps + audioKbps) * 1000 * duration / 8);
    }

    /**
     * 构建一个任务的编码计划。
     * @returns {{ passes: Array<Array<string>>, outputExt: string, passLogPrefix: string|null }}
     */
    /**
     * 分辨率 / 帧率滤镜。
     * 采样预估必须复用这段：只要滤镜和正式编码不一样，算出来的码率就对不上。
     */
    function videoFilters(meta, settings) {
        var vf = [];
        var targetH = resolveTargetHeight(meta, settings);
        if (targetH > 0) {
            // -2 表示自动取偶数，避免 libx264 对奇数尺寸报错
            vf.push('scale=-2:' + targetH);
        }
        if (settings.fps !== 'source') {
            var f = parseFloat(settings.fps);
            if (isFinite(f) && f > 0) {
                var cur = (meta.video && meta.video.fps) || 0;
                if (Math.abs(cur - f) > 0.01) vf.push('fps=' + f);
            }
        }
        return vf;
    }

    // ---------------------------------------------------------------------
    // 参数拼接小工具
    // ---------------------------------------------------------------------
    /**
     * 往 x265 / SVT-AV1 的私有参数串里追加一段。
     *
     * 这两家都把一堆设置塞进一个开关（`-x265-params a=1:b=2`，冒号分隔）。
     * 不能直接再 push 一个同名开关：ffmpeg 只认最后一个，先出现的那个会被
     * 静默丢掉 —— 于是「限线程池」「调质量」「关慢速首遍」里总有一个不生效，
     * 而且从命令行上完全看不出来。
     */
    function appendPrivateParams(args, flag, extra) {
        var i = args.indexOf(flag);
        if (i === -1) return args.concat([flag, extra]);
        if (String(args[i + 1]).indexOf(extra) !== -1) return args;
        var next = args.slice();
        next[i + 1] = args[i + 1] + ':' + extra;
        return next;
    }

    /** 替换（或补上）`-preset` 的取值。两遍编码给两遍降档时用。 */
    function withPreset(args, value) {
        var i = args.indexOf('-preset');
        if (i === -1) return args.concat(['-preset', value]);
        var next = args.slice();
        next[i + 1] = value;
        return next;
    }

    /**
     * 两遍编码里第一遍该用哪个速度档。
     *
     * 第一遍的目的只是给第二遍收集统计信息，画质档位拉满纯属浪费：
     * x264 内部有 turbo 兜底（会自己关掉一部分昂贵工具），x265 没有
     * （默认 slow-firstpass=1），所以 -preset veryslow 的目标大小模式
     * 实际是把全片按最慢档编了两遍。
     *
     * 降两档是在「统计信息够用」和「省时间」之间取的点：降太多会让第二遍
     * 的码率控制失准，目标大小就守不住。已经是最快档时保持不变。
     */
    function pass1SpeedIndex(codec, settings) {
        if (!codec.speeds || !codec.speeds.length) return -1;
        var i = isFinite(settings.speedIndex) ? settings.speedIndex : 2;
        i = Math.max(0, Math.min(codec.speeds.length - 1, i));
        return i - 2;
    }

    /**
     * VP9 的行级多线程与 tile 划分。
     *
     * 实测（1080p / 6s / -cpu-used 4）：不开 row-mt 是 4.05s，加上
     * -row-mt 1 -tile-columns 2 后 2.41s（1.68×）。原因是不开 row-mt 时
     * 并行度被 tile 数卡死，1080p 默认 tile-columns=0，等于把多核机器当
     * 单核用。
     *
     * 列数按宽度给：列数太少 row-mt 也并行不起来，太多则每块的预测范围被
     * 切断、压缩率下降。4K 及以上给 3（8 列），1080p 级给 2（4 列），
     * 小分辨率给 1。
     */
    function vp9ParallelArgs(width) {
        var w = Number(width) || 0;
        var cols = w >= 3000 ? 3 : (w >= 1200 ? 2 : 1);
        return ['-row-mt', '1', '-tile-columns', String(cols)];
    }

    /**
     * 硬件编码器的「恒定画质」参数。
     *
     * 三家厂商的开关完全不同名，写错一个就是整条命令报废，所以按家族分开：
     *   - nvenc  -rc constqp -qp N         （本机 RTX 4070 Ti SUPER 实测通过）
     *   - qsv    -global_quality N         （Intel 文档，未在本机验证）
     *   - amf    -rc cqp -qp_i/-qp_p N     （AMD 文档，未在本机验证）
     * 未验证的两家靠 app.js 的「硬件失败回退 CPU」兜底，不会把任务卡死。
     */
    var HW_QUALITY_ARGS = {
        nvenc: function (qp) { return ['-rc', 'constqp', '-qp', String(qp)]; },
        qsv: function (qp) { return ['-global_quality', String(qp)]; },
        amf: function (qp) { return ['-rc', 'cqp', '-qp_i', String(qp), '-qp_p', String(qp)]; },
        videotoolbox: function (q) { return ['-q:v', String(q)]; }
    };

    /**
     * 视频编码参数（-c:v / -preset / -pix_fmt / -crf / -profile:v）。
     * 抽出来是给采样预估用的 —— 采样片段必须用和正式编码完全一样的参数，
     * 否则「预估」跟「实际」根本不是一回事。
     *
     * @param {object} [enc] resolveEncoder 的结果；省略则按纯 CPU 处理。
     */
    function videoEncodeArgs(meta, settings, codec, args, enc) {
        if (codec.id === 'copy') {
            args.push('-c:v', 'copy');
            return args;
        }

        args.push('-c:v', (enc && enc.encoder) || codec.encoder);

        if (isHardwareEncoder(enc)) {
            // 只给 NVENC 映射速度档位。QSV 的 -preset 用的是另一套词表，
            // AV1 走 QSV 时更是没有 -preset 这个选项（SVT-AV1 的 '8' 传过去
            // 会直接报无法识别），所以其余两家一律用编码器默认值，
            // 宁可让「编码速度」这一项暂时无效，也不能让整条命令起不来。
            if (enc.kind === 'nvenc') {
                args.push('-preset', NVENC_PRESETS[settings.speedIndex] || NVENC_PRESETS[2]);
            }

            // 像素格式：硬件 10-bit 用各自的 p010 变体。
            // hevc_nvenc + p010le 已实测可用（含 HDR 源）。
            var hwBd = (meta.video && meta.video.bitDepth) || 8;
            if (hwBd >= 10 && enc.hw && enc.hw.tenBit) {
                args.push('-pix_fmt', enc.hw.tenBitPixFmt || 'p010le');
                // VideoToolbox 不会由 p010le 自己推出 Main10：不给这一句它会按
                // Main 去编 10-bit 流，产物在 Apple 自家的解码器上直接打不开。
                if (enc.kind === 'videotoolbox' && codec.id === 'h265') {
                    args.push('-profile:v', 'main10');
                }
            } else {
                args.push('-pix_fmt', 'yuv420p');
            }

            if (settings.mode === 'crf') {
                var crf = isFinite(settings.crf) ? settings.crf : codec.crf.def;
                var builder = HW_QUALITY_ARGS[enc.kind];
                args = args.concat(builder ? builder(crfToHwQuality(crf, codec.id, enc.kind)) : []);
            } else {
                var hwKbps = settings.mode === 'bitrate'
                    ? settings.videoBitrate
                    : calcTargetVideoKbps(meta, settings).kbps;
                args.push('-b:v', hwKbps + 'k');
                // VBR 的瞬时峰值会冲得很高，给个上限避免网络播放时卡顿。
                args.push('-maxrate', Math.round(hwKbps * 1.5) + 'k', '-bufsize', (hwKbps * 2) + 'k');
                // NVENC 自己的「多遍」：比单遍更贴近目标码率，代价很小。
                if (enc.kind === 'nvenc') args.push('-multipass', '2');
            }

            return args;
        }

        // worker 数已按整机预算收敛；这里再给每个编码器明确线程上限，
        // 防止 x264/x265/AV1 默认自动吃满全部核心，导致多任务反而更慢。
        //
        // runtimeThreads 由 app.js 在每轮运行前算好写进 settings。万一缺失
        // （直接调用 buildPlan、或老版本调用方）也不能放任不限流，退化成
        // 「单 worker 时这台机器的推荐线程数」。
        var threads = parseInt(settings.runtimeThreads, 10);
        if (!isFinite(threads) || threads <= 0) {
            threads = recommendedThreadCount(os.cpus().length, 1, codec.id);
        }
        args.push('-threads', String(threads));

        // -threads 对这两个编码器形同虚设，必须走各自的私有参数：
        //   · libx265  实测 -threads 2 时日志仍是 "Thread pool created using
        //     14 threads"；换成 -x265-params pools=2 才真的变成 2 线程
        //     （耗时 6.05s → 17.4s，反证此前一直在吃满）。
        //   · libsvtav1 的 "Level of Parallelism" 恒定 5，完全不读 -threads，
        //     要 -svtav1-params lp=N 才收得住（见 P1-06b）。
        // 只有最后一次出现的 -x265-params / -svtav1-params 生效，所以这里
        // 用 appendPrivateParams 合并进同一个冒号分隔串，不能各推一份。
        if (codec.id === 'h265') {
            args = appendPrivateParams(args, '-x265-params', 'pools=' + threads);
        } else if (codec.id === 'av1') {
            args = appendPrivateParams(args, '-svtav1-params', 'lp=' + threads);
        }

        if (codec.speeds) {
            var speed = codec.speeds[settings.speedIndex] || codec.speeds[2];
            args = args.concat(codec.speedArgs(speed, meta, settings));
        }

        // SVT-AV1 默认 tune=1（PSNR 调优）。PSNR 高不等于看着好 —— 它倾向于
        // 保留数值误差最小的块，代价是抹掉细节和纹理。本插件的目标是
        // 「肉眼差不多、体积明显小」，所以显式切到 tune=0（主观视觉质量）。
        // 实测日志里能看到默认值：SVT [config]: preset / tune / pred struct : 8 / PSNR / random access
        if (codec.id === 'av1') args = appendPrivateParams(args, '-svtav1-params', 'tune=0');

        // 像素格式 / 位深：10-bit 片源在支持 10-bit 的编码器上保留，否则统一降到 8-bit
        var bd = (meta.video && meta.video.bitDepth) || 8;
        if (bd >= 10 && codec.tenBit) args.push('-pix_fmt', 'yuv420p10le');
        else args.push('-pix_fmt', 'yuv420p');

        // 码率控制
        if (settings.mode === 'crf') {
            var crf2 = isFinite(settings.crf) ? settings.crf : codec.crf.def;
            args.push('-crf', String(crf2));
            // VP9 的 CRF 模式必须显式把码率上限设为 0
            if (codec.id === 'vp9') args.push('-b:v', '0');
        } else {
            var kbps = settings.mode === 'bitrate'
                ? settings.videoBitrate
                : calcTargetVideoKbps(meta, settings).kbps;
            args.push('-b:v', kbps + 'k');
            // VBR 的瞬时峰值会冲得很高，给个上限避免网络播放时卡顿。
            // 注意条件不是 codec.id === 'x264'（那个 id 根本不存在，永远是
            // 'h264'，这个分支从来没执行过 —— 见 P0-04）：所有非 CRF 模式都要给。
            // CRF 模式则必须保持干净，否则恒定画质会退化成受限 VBR。
            args.push('-maxrate', Math.round(kbps * 1.5) + 'k', '-bufsize', (kbps * 2) + 'k');
        }

        // H.264 / H.265 通用兼容性：主线程 profile
        if (codec.id === 'h264') args.push('-profile:v', 'high');
        return args;
    }

    // 这些容器走 QuickTime/MP4 的 sample entry 体系，Apple 的解码器要求 hvc1。
    // MKV / WebM / TS 用自己的封装，不需要也不接受这个标签。
    var HVC1_CONTAINERS = ['.mp4', '.mov', '.m4v'];

    /**
     * 判断输出视频流最终是不是 HEVC。
     *
     * 「复制视频流」模式下 codec.id 是 copy，真正决定码流格式的是源文件本身，
     * 所以必须回看探测结果，否则会给 H.264 源硬套 HEVC 标签。
     */
    function outputIsHevc(codec, meta) {
        if (!codec) return false;
        if (codec.id === 'h265') return true;
        if (codec.id === 'copy') {
            return !!(meta && meta.video && /^(hevc|h265)$/i.test(meta.video.codec || ''));
        }
        return false;
    }

    /**
     * 输出容器兼容性参数。
     *
     * FFmpeg 对 H.265 写 MP4 / MOV 时默认使用 hev1 sample entry，把 VPS/SPS/PPS
     * 留在码流里。FFmpeg / Chrome 能自行解析，所以 Eagle 内可以播放；但 macOS
     * Finder、Quick Look 和 QuickTime 要求 hvc1（参数集放进容器描述），否则
     * 表现就是「Eagle 里能放，系统里打不开也预览不了」。本地实测：hev1 产物经
     * AVFoundation 解出的 isPlayable 为 false、硬解码直接报 Cannot Decode，
     * 换成 hvc1 后全部恢复。
     *
     * 反过来也一样要小心：把 hvc1 套在 H.264 流上，mp4 muxer 会直接写头失败
     * （Tag hvc1 incompatible with output codec id '27'），整个任务报废。
     * 所以这里只认真正的 HEVC 流。
     */
    function containerCompatibilityArgs(ext, codec, meta) {
        if (HVC1_CONTAINERS.indexOf(ext) === -1) return [];
        return outputIsHevc(codec, meta) ? ['-tag:v', 'hvc1'] : [];
    }

    // 走 QuickTime/MP4 sample entry 体系的容器：字幕只吃文本（mov_text），
    // 也不接受附件流。位图字幕（PGS / DVD）硬塞进去会让整条命令失败。
    var MP4_FAMILY = ['.mp4', '.mov', '.m4v', '.3gp'];

    // Matroska 系：字幕与附件（.ass 依赖的字体）都能原样带走。
    var MATROSKA_FAMILY = ['.mkv', '.webm'];

    // 能被转成 mov_text 的文本字幕。位图类一律不在此列。
    var TEXT_SUBTITLE_CODECS = [
        'subrip', 'srt', 'ass', 'ssa', 'mov_text', 'webvtt', 'text',
        'subviewer', 'microdvd', 'realtext', 'vplayer', 'pjs', 'mpl2', 'jacosub', 'sami'
    ];

    function isTextSubtitle(name) {
        return TEXT_SUBTITLE_CODECS.indexOf(String(name || '').toLowerCase()) !== -1;
    }

    /**
     * 本次输出对字幕的处理方式。
     *
     * 难点在于「产物要覆盖原文件」，输出容器被源扩展名钉死了，于是
     * 「源字幕能不能进这个容器」必须由我们来判，不能交给 ffmpeg 默认行为。
     *
     * @returns {{mode:string, kept:number}} mode: copy / mov_text / drop / none
     *          kept 是预期保留下来的字幕条数（verifyOutput 用它做校验门槛）
     */
    function subtitlePlan(ext, meta) {
        var tracks = (meta && meta.tracks) || {};
        var count = Number(tracks.subtitle) || 0;
        var codecs = (meta && meta.subtitleCodecs) || [];
        // 字幕 codec 没探测到时按「可能有问题」处理：宁可丢字幕也不要让
        // 整条命令在 mux 阶段失败（失败即整个任务报废，丢字幕只是少一条轨道）。
        var knownText = count > 0 && codecs.length > 0 && codecs.every(isTextSubtitle);

        if (MP4_FAMILY.indexOf(ext) !== -1) {
            if (count > 0 && knownText) return { mode: 'mov_text', kept: count };
            return { mode: count > 0 ? 'drop' : 'none', kept: 0 };
        }
        if (MATROSKA_FAMILY.indexOf(ext) !== -1) {
            return { mode: count > 0 ? 'copy' : 'none', kept: count };
        }
        // 其余容器（avi / ts / wmv …）只敢原样复制文本字幕
        if (count > 0 && knownText) return { mode: 'copy', kept: count };
        return { mode: count > 0 ? 'drop' : 'none', kept: 0 };
    }

    /**
     * 显式流映射。
     *
     * 【不加这一组参数的后果是静默丢素材】FFmpeg 的默认流选择是「每类只挑一路」：
     * 双音轨 + 内挂字幕的源压完只剩一条音轨，退出码依然是 0，没有任何警告。
     * 而产物接下来要覆盖原文件 —— 这等于不可逆地删掉了用户的素材。
     *
     * 0:a? / 0:s? 的问号是刻意的：源没有这类流时该映射变成 no-op，
     * 而不是让整条命令失败。
     */
    function streamMapArgs(ext, meta, settings) {
        var sub = subtitlePlan(ext, meta);
        var args = ['-map', '0:v:0'];

        if (settings.audioMode !== 'none' && meta.audio) args.push('-map', '0:a?');

        // 字幕塞不进目标容器时主动丢弃（-sn），比让 mux 阶段报错好：
        // 前者只是少一条轨道，后者是整个任务报废。
        if (sub.mode === 'drop') args.push('-sn');
        else if (sub.mode === 'mov_text') args.push('-map', '0:s?', '-c:s', 'mov_text');
        else args.push('-map', '0:s?', '-c:s', 'copy');

        // 字体附件：外挂 .ass 依赖它，漏掉会导致字幕渲染成方块。
        // 只有 Matroska 系能装附件流，MP4 加了会直接报 muxer 错误。
        if (MATROSKA_FAMILY.indexOf(ext) !== -1) args.push('-map', '0:t?');

        // 容器级 metadata 与章节不会随 -map 自动继承，必须显式指定。
        args.push('-map_metadata', '0', '-map_chapters', '0');
        return args;
    }

    /**
     * HDR 色彩元数据的保底参数。
     *
     * x265/x264 通常会自动继承输入帧的色彩信息，但那只覆盖「码流里写了」的情况。
     * 有些文件的 transfer 只存在于容器（本地 HLG 样本就没写进码流），重编码后就
     * 丢了。这里显式钉住，让「压完还是 HDR」不依赖编码器的心情。
     *
     * 选项名必须是 -color_trc / -color_primaries / -colorspace：
     * -color_transfer / -color_space 在 ffmpeg 里并不存在，实测会直接报
     * Unrecognized option 让整个任务失败。
     *
     * 只在重编码时加。复制视频流加这些参数没有意义，还可能触发 streamcopy 冲突。
     */
    function hdrPreservationArgs(meta, codec) {
        var hdr = meta && meta.video && meta.video.hdr;
        if (!hdr || !hdr.isHdr) return [];
        if (!codec || codec.id === 'copy') return [];

        var args = [];
        if (hdr.transfer) args.push('-color_trc', hdr.transfer);
        if (hdr.primaries) args.push('-color_primaries', hdr.primaries);
        if (hdr.space) args.push('-colorspace', hdr.space);
        return args;
    }

    function buildPlan(meta, settings, outputPath, passLogPrefix, hw) {
        var codec = CODECS[settings.codec] || CODECS.h264;
        var ext = path.extname(meta.path).toLowerCase();

        // 编码前预检，不兼容直接抛错，避免任务跑到一半才失败
        var check = validatePlan(meta, settings);
        if (!check.ok) {
            var e = new Error(check.reason + (check.suggestion ? '。' + check.suggestion : ''));
            e.name = 'IncompatibleCodecError';
            e.suggestion = check.suggestion;
            throw e;
        }

        var enc = resolveEncoder(settings.codec, settings, hw);

        var args = [];

        // 全局参数
        // -progress pipe:1 把机器可读的进度打到 stdout，避免解析 stderr 里带 \r 的人类可读进度
        // -nostats 关掉 stderr 上的重复统计，减少噪音
        args.push('-hide_banner', '-loglevel', 'error', '-nostdin', '-y');
        args.push('-progress', 'pipe:1', '-nostats');

        // ---- 输入侧 ----
        // 硬件解码必须写在这里：它是输入选项，放到 -i 之后 FFmpeg 直接报错拒绝执行。
        args = args.concat(hwInputArgs(enc, hw));
        args.push('-i', meta.path);

        // ---- 流映射 ----
        // 必须显式写 -map：默认流选择会静默丢掉第二条音轨和内挂字幕。
        args = args.concat(streamMapArgs(ext, meta, settings));

        var vf = videoFilters(meta, settings);
        var targetH = resolveTargetHeight(meta, settings);

        // ---- 视频流 ----
        args = videoEncodeArgs(meta, settings, codec, args, enc);

        // 复制视频流时不能挂滤镜，ffmpeg 会直接报错
        // （Streamcopy requested ... filtered），所以 copy 模式下忽略分辨率与帧率设置
        if (vf.length && codec.id !== 'copy') args.push('-vf', vf.join(','));

        // ---- 音轨 ----
        var audioCopied = false;
        if (settings.audioMode === 'none' || !meta.audio) {
            args.push('-an');
        } else if (settings.audioMode === 'copy') {
            args.push('-c:a', 'copy');
            audioCopied = true;
        } else if (shouldCopyAudio(meta, settings, ext)) {
            // 源音轨已经是目标格式且够小：再压一次只会更差，直接带走。
            args.push('-c:a', 'copy');
            audioCopied = true;
        } else {
            args.push('-c:a', resolveAudioEncoder(ext), '-b:a', settings.audioBitrate + 'k');
        }

        // ---- 容器兼容性 ----
        args = args.concat(containerCompatibilityArgs(ext, codec, meta));

        // ---- HDR 色彩元数据 ----
        args = args.concat(hdrPreservationArgs(meta, codec));

        // ---- 两遍编码 ----
        // 硬件编码器不吃这套：NVENC 的 -pass 会被静默忽略，白白多跑一遍
        // 全片（实测 pass1 正常退出、passlogfile 却是 0 字节），目标码率反而更不准。
        // 它有自己的 -multipass，已经在 videoEncodeArgs 里加过了，这里必须排除。
        var passes;
        var wantTwoPass = settings.mode === 'target' && codec.twoPass &&
            codec.id !== 'copy' && !isHardwareEncoder(enc);

        if (wantTwoPass) {
            var kbps2 = calcTargetVideoKbps(meta, settings).kbps;

            // 第一遍降档：见 pass1SpeedIndex。x265 额外关掉 slow-firstpass，
            // 否则改了 -preset 也只是省一点，它仍会按第二遍的完整工具集跑统计。
            var pass1Base = args;
            var p1Idx = pass1SpeedIndex(codec, settings);
            if (p1Idx >= 0 && p1Idx < codec.speeds.length) {
                pass1Base = withPreset(args, codec.speeds[p1Idx]);
                if (codec.id === 'h265') {
                    pass1Base = appendPrivateParams(pass1Base, '-x265-params', 'slow-firstpass=0');
                }
            }

            // 输出用 -f null -：第一遍的产物本来就要丢掉，走 mp4 muxer
            // 是白白烧一遍 CPU 和 IO（4K 母带上这点开销不小）。
            var pass1 = pass1Base.slice();
            pass1.push('-pass', '1', '-passlogfile', passLogPrefix, '-an', '-f', 'null', '-');

            // 压缩标记只写进最终产物。第一遍输出到 /dev/null，挂上去纯属浪费。
            var pass2 = args.slice().concat(markerArgs(ext, meta, settings));
            pass2.push('-pass', '2', '-passlogfile', passLogPrefix, outputPath);

            passes = [pass1, pass2];
        } else {
            passes = [args.concat(markerArgs(ext, meta, settings), [outputPath])];
        }

        return {
            passes: passes,
            outputExt: path.extname(meta.path).toLowerCase(),
            passLogPrefix: passes.length > 1 ? passLogPrefix : null,
            targetHeight: targetH,
            // 回传给调用方：UI 要显示「GPU」标记，失败时要知道该回退成哪个 CPU 编码器。
            encoder: enc,
            // 音轨是否被原样带走。调用方拿它写日志：用户看到「体积没怎么变」
            // 时需要知道音轨本来就没动过，而不是怀疑压缩失败了。
            audioCopied: audioCopied
        };
    }

    /**
     * 生成用于 CRF 体积预估的采样窗口。
     *
     * 常规视频从前 / 中 / 后抽 3 段，每段最多 2 秒；短视频直接采完整片段。
     * 只抽开头会漏掉片尾演唱会、动作场景等高复杂度镜头；均匀分层抽样至少能
     * 把这种明显偏差压下来。这里刻意不做“随机抽样”，同一文件/同一设置下的
     * 预估应可复现，用户调整参数后才容易判断体积为什么变化。
     */
    function sampleWindows(duration) {
        if (!isFinite(duration) || duration <= 0) return [];
        if (duration <= 6) return [{ start: 0, duration: duration }];

        var len = Math.min(2, Math.max(1.2, duration / 20));
        var points = duration <= 15 ? [0.18, 0.72] : [0.10, 0.50, 0.90];
        return points.map(function (point) {
            var start = duration * point - len / 2;
            start = Math.max(0, Math.min(start, Math.max(0, duration - len)));
            return { start: start, duration: len };
        });
    }

    /**
     * CRF 的采样预估。
     *
     * 这不是根据原文件大小拍脑袋，而是拿当前“正式编码同一套视频参数”压缩
     * 多个代表性片段，再把实测码率外推到全片。音频不放进采样，避免每段单独
     * 封装产生的音频头部扰动；它按用户设置的码率 / 原音轨码率单独投影。
     *
     * 返回区间而不是伪精确单值：CRF 的目标是画质，画面复杂度在未抽到的镜头
     * 里仍可能突变。区间下限 / 上限会随样本之间的码率离散程度自动变宽。
     */
    function estimateCrfBySampling(binaries, meta, settings, opts) {
        opts = opts || {};
        if (settings.mode !== 'crf') return Promise.resolve(null);
        if (!meta || !meta.video || !meta.duration || meta.duration <= 0) {
            return Promise.reject(new Error('视频时长或视频流信息缺失，无法采样预估'));
        }

        var check = validatePlan(meta, settings);
        if (!check.ok) return Promise.reject(new Error(check.reason));

        var codec = CODECS[settings.codec] || CODECS.h264;
        if (codec.id === 'copy' || !codec.crf) return Promise.resolve(null);

        var windows = sampleWindows(meta.duration);
        if (!windows.length) return Promise.reject(new Error('无法生成采样片段'));

        var ext = path.extname(meta.path).toLowerCase() || '.mp4';
        var filters = videoFilters(meta, settings);
        var token = opts.cancelToken || { cancelled: false };
        var rates = [];
        var details = [];
        // 采样必须与正式编码用同一套编码器，否则估出来的码率对不上实际产物。
        // 硬件编码本来就快，采样开销几乎可以忽略。
        var enc = resolveEncoder(settings.codec, settings, opts.hw);

        function audioKbps() {
            if (settings.audioMode === 'none' || !meta.audio) return 0;
            if (settings.audioMode === 'aac') return Math.max(0, Number(settings.audioBitrate) || 0);
            return Math.max(0, (meta.audio.bitrate || 128000) / 1000);
        }

        function one(index) {
            if (token.cancelled) return Promise.reject(CancelledError());
            var win = windows[index];
            var tmp = path.join(os.tmpdir(), 'eagle-vc-sample-' +
                Date.now().toString(36) + '-' + index + '-' + Math.random().toString(36).slice(2) + ext);
            var args = [
                '-hide_banner', '-loglevel', 'error', '-nostdin', '-y'
            ];
            // 硬件解码是输入选项，必须排在 -i 之前。
            args = args.concat(hwInputArgs(enc, opts.hw));
            // 输入前定位优先速度。采样是预览，不应为了精确帧定位去把长片解码一遍。
            args.push('-ss', String(win.start), '-i', meta.path,
                '-t', String(win.duration), '-map', '0:v:0');
            args = videoEncodeArgs(meta, settings, codec, args, enc);
            if (filters.length) args.push('-vf', filters.join(','));
            args.push('-an', tmp);

            if (opts.onProgress) opts.onProgress({
                index: index + 1, total: windows.length, start: win.start, duration: win.duration, phase: 'start'
            });

            return run(binaries.ffmpeg, args, { cancelToken: token })
                .then(function () {
                    if (token.cancelled) throw CancelledError();
                    var bytes = fs.statSync(tmp).size;
                    var kbps = bytes * 8 / Math.max(win.duration, 0.1) / 1000;
                    if (!isFinite(kbps) || kbps <= 0) throw new Error('采样产物为空');
                    rates.push(kbps);
                    details.push({ start: win.start, duration: win.duration, bytes: bytes, kbps: kbps });
                    if (opts.onProgress) opts.onProgress({
                        index: index + 1, total: windows.length, start: win.start, duration: win.duration, phase: 'done'
                    });
                })
                .then(function () { try { fs.unlinkSync(tmp); } catch (e) {} })
                .catch(function (err) {
                    try { fs.unlinkSync(tmp); } catch (e) {}
                    throw err;
                });
        }

        var chain = Promise.resolve();
        windows.forEach(function (_, i) {
            chain = chain.then(function () { return one(i); });
        });

        return chain.then(function () {
            var sum = rates.reduce(function (a, b) { return a + b; }, 0);
            var avg = sum / rates.length;
            var variance = rates.reduce(function (a, rate) {
                return a + Math.pow(rate - avg, 2);
            }, 0) / rates.length;
            var deviation = Math.sqrt(variance);

            // 短片段没有足够的 GOP / 码控热身，会系统性略低估；此前用不同
            // 分辨率和编码器的校准试验得到约 14% 偏低，取 1.16 做保守修正。
            // 短视频直接采了完整片段时不存在这个偏差，不能再额外抬高 16%。
            var sampledWholeVideo = windows.length === 1 && windows[0].duration >= meta.duration * 0.99;
            var correctedVideoKbps = avg * (sampledWholeVideo ? 1 : 1.16);
            var totalKbps = correctedVideoKbps + audioKbps();
            // 给容器元数据留 2% 余量；区间默认 ±15%，样本离散越大区间越宽。
            var estimate = Math.round(totalKbps * 1000 * meta.duration / 8 * 1.02);
            var relativeSpread = Math.max(0.15, Math.min(0.40, (deviation / Math.max(avg, 1)) * 1.25 + 0.08));

            return {
                estimate: estimate,
                low: Math.round(estimate * (1 - relativeSpread)),
                high: Math.round(estimate * (1 + relativeSpread)),
                sampleCount: rates.length,
                sampleDuration: windows.reduce(function (a, w) { return a + w.duration; }, 0),
                videoKbps: Math.round(correctedVideoKbps),
                spread: relativeSpread,
                details: details
            };
        });
    }

    // ---------------------------------------------------------------------
    // 进程执行 + 进度解析
    // ---------------------------------------------------------------------
    /**
     * 执行一条 ffmpeg 命令，解析 `-progress pipe:1` 输出。
     *
     * @param {string} bin      ffmpeg 路径
     * @param {Array}  args     参数数组
     * @param {object} opts
     * @param {(p:{time:number,size:number,fps:number,speed:string})=>void} opts.onProgress
     * @param {(s:string)=>void} [opts.onStderr]
     * @param {{cancelled:boolean}} [opts.cancelToken]
     * @returns {Promise<void>}
     */
    function run(bin, args, opts) {
        opts = opts || {};
        return new Promise(function (resolve, reject) {
            var child;
            try {
                child = cp.spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
            } catch (e) {
                return reject(e);
            }

            var stderr = '';
            var buf = '';
            var killed = false;
            var cur = {};

            function emitProgress(done) {
                var time = parseFloat(cur.out_time_us || '0') / 1000000;
                var size = parseInt(cur.total_size || '0', 10);
                if (opts.onProgress) {
                    opts.onProgress({
                        time: isFinite(time) ? time : 0,
                        size: isFinite(size) ? size : 0,
                        fps: parseFloat(cur.fps || '0') || 0,
                        speed: cur.speed || '',
                        done: !!done
                    });
                }
                cur = {};
            }

            function onStdoutChunk(d) {
                buf += d.toString();
                var idx;
                while ((idx = buf.indexOf('\n')) >= 0) {
                    var line = buf.slice(0, idx).trim();
                    buf = buf.slice(idx + 1);
                    if (!line) continue;
                    var eq = line.indexOf('=');
                    if (eq < 0) continue;
                    var key = line.slice(0, eq);
                    var val = line.slice(eq + 1);
                    cur[key] = val;
                    if (key === 'progress') emitProgress(val === 'end');
                }
            }

            child.stdout.on('data', onStdoutChunk);
            child.stderr.on('data', function (d) {
                var s = d.toString();
                stderr = tailText(stderr + s, STDERR_TAIL_LIMIT);
                if (opts.onStderr) opts.onStderr(s);
            });
            child.on('error', reject);
            child.on('close', function (code) {
                if (killed) return reject(CancelledError());
                if (code === 0) return resolve();
                var tail = stderr.trim().split(/\r?\n/).slice(-6).join('\n');
                reject(new Error('ffmpeg 退出码 ' + code + '\n' + tail));
            });

            if (opts.cancelToken) {
                var timer = setInterval(function () {
                    if (!opts.cancelToken.cancelled || killed) return;
                    killed = true;
                    clearInterval(timer);
                    // 先给 SIGTERM：ffmpeg 收到它会正常收尾 ——
                    // 两遍编码的 passlog 会被清掉、临时产物不会停在半写状态。
                    // SIGKILL 不给任何收尾机会，素材目录里就会残留垃圾。
                    // 但也不能只等不杀：卡在 IO 上的进程可能永远不退出，
                    // 所以 800ms 后再补一次 SIGKILL 兜底。
                    try { child.kill('SIGTERM'); } catch (e) {}
                    setTimeout(function () {
                        try { child.kill('SIGKILL'); } catch (e) {}
                    }, GRACEFUL_KILL_TIMEOUT_MS);
                }, 200);
                child.on('close', function () { clearInterval(timer); });
            }
        });
    }

    /**
     * 执行一个完整的编码计划（自动处理两遍）。
     * @param {object} binaries
     * @param {object} plan      buildPlan 的返回值
     * @param {object} meta
     * @param {object} opts      { onProgress(pct, info), onStderr, cancelToken }
     */
    function executePlan(binaries, plan, meta, opts) {
        opts = opts || {};
        var duration = meta.duration > 0 ? meta.duration : 0;
        var total = plan.passes.length;
        var stderrLog = '';

        function runPass(i) {
            var passArgs = plan.passes[i];
            var base = total > 1 ? (i / total) : 0;
            var span = total > 1 ? (1 / total) : 1;

            return run(binaries.ffmpeg, passArgs, {
                cancelToken: opts.cancelToken,
                onStderr: function (s) {
                    stderrLog = tailText(stderrLog + s, STDERR_TAIL_LIMIT);
                    if (opts.onStderr) opts.onStderr(s);
                },
                onProgress: function (p) {
                    if (!opts.onProgress) return;
                    // ffmpeg 最后一帧的 out_time_us 通常略小于总时长，
                    // 因此收到 progress=end 时直接按 100% 计算，避免永远停在 99%
                    var ratio = p.done ? 1 : (duration > 0 ? Math.min(1, p.time / duration) : 0);
                    var pct = Math.min(100, Math.round((base + ratio * span) * 100));
                    opts.onProgress(pct, {
                        pass: i + 1,
                        totalPass: total,
                        time: p.time,
                        outSize: p.size,
                        fps: p.fps,
                        speed: p.speed
                    });
                }
            });
        }

        var chain = Promise.resolve();
        for (var i = 0; i < total; i++) {
            (function (idx) {
                chain = chain.then(function () { return runPass(idx); });
            })(i);
        }

        return chain.then(function () {
            return { stderr: stderrLog };
        });
    }

    /**
     * 比对「产物轨道数」与「源轨道数」，返回缺失项的文字描述。
     *
     * 只在能确定「本次本该保留」的时候才判缺失：
     *   - 音轨被用户主动去掉（audioMode=none）不算缺失
     *   - 字幕数由 buildPlan 的容器兼容性决定，以 opts.subtitleKept 为准
     *   - 源信息缺失（tracks 未探测）时不猜，直接放行
     */
    function missingTracks(sourceMeta, outTracks, opts) {
        opts = opts || {};
        var missing = [];
        var src = sourceMeta && sourceMeta.tracks;
        if (!src) return missing;

        if (src.video > 0 && outTracks.video < 1) {
            missing.push('视频流');
        }
        if (opts.audioMode !== 'none' && src.audio > outTracks.audio) {
            missing.push('音轨（原 ' + src.audio + ' 条，产物 ' + outTracks.audio + ' 条）');
        }
        // 字幕：只有调用方明确说「本次保留了几条」才校验，否则无法区分
        // 「丢了」和「容器装不下主动丢弃」。
        if (isFinite(opts.subtitleKept) && opts.subtitleKept > outTracks.subtitle) {
            missing.push('字幕（应保留 ' + opts.subtitleKept + ' 条，产物 ' + outTracks.subtitle + ' 条）');
        }
        return missing;
    }

    /** 统计一个 ffprobe 结果里各类流的数量。封面（attached_pic）不算正片。 */
    function countStreams(parsed) {
        var counts = { video: 0, audio: 0, subtitle: 0 };
        var streams = (parsed && parsed.streams) || [];
        for (var i = 0; i < streams.length; i++) {
            var s = streams[i];
            if (s.codec_type === 'video') {
                if (s.disposition && s.disposition.attached_pic) continue;
                counts.video++;
            } else if (s.codec_type === 'audio') counts.audio++;
            else if (s.codec_type === 'subtitle') counts.subtitle++;
        }
        return counts;
    }

    /**
     * 校验编码产物是否可用：文件存在、非空、能被 ffprobe 读出时长，
     * 且**没有比源文件少轨道**。
     *
     * 最后这一条是覆盖原文件前的最后一道闸门。丢轨不会让 ffprobe 报错，
     * 时长也完全对得上 —— 只校验大小与时长的话，一个少了条音轨的产物会被
     * 判定为「校验通过」，然后不可逆地覆盖掉原始素材。
     *
     * @param {object} [sourceMeta] 源文件的探测结果，用来比对轨道数
     * @param {object} [opts] { audioMode, subtitleKept } 本次「应该」保留的数量，
     *                        避免把用户主动去掉的音轨误判成丢轨
     */
    function verifyOutput(binaries, outputPath, sourceDuration, sourceMeta, opts) {
        opts = opts || {};
        return new Promise(function (resolve, reject) {
            fs.stat(outputPath, function (err, stat) {
                if (err) return reject(new Error('输出文件不存在，编码可能失败'));
                if (stat.size <= 0) return reject(new Error('输出文件为空，编码失败'));

                var args = ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', outputPath];
                var p = cp.spawn(binaries.ffprobe, args);
                var out = '', errText = '';
                p.stdout.on('data', function (d) { out += d.toString(); });
                p.stderr.on('data', function (d) { errText += d.toString(); });
                p.on('error', function () {
                    resolve({ size: stat.size, duration: 0 });
                });
                p.on('close', function (code) {
                    if (code !== 0) {
                        return reject(new Error('输出文件无法解析，已放弃替换原文件：' + errText.trim()));
                    }
                    var parsed = null;
                    try { parsed = JSON.parse(out); } catch (e) {}
                    var dur = 0;
                    try {
                        dur = parseFloat(parsed.format.duration) || 0;
                    } catch (e) {}
                    // 时长偏差超过 2 秒或 2% 视为异常
                    if (sourceDuration > 0 && dur > 0) {
                        var diff = Math.abs(dur - sourceDuration);
                        if (diff > 2 && diff / sourceDuration > 0.02) {
                            return reject(new Error('输出时长与原片差异过大（' +
                                dur.toFixed(1) + 's vs ' + sourceDuration.toFixed(1) + 's），已放弃替换原文件'));
                        }
                    }
                    var outTracks = countStreams(parsed);
                    var missing = missingTracks(sourceMeta, outTracks, opts);
                    if (missing.length) {
                        return reject(new Error('产物比原片少了轨道（' + missing.join('、') +
                            '），已放弃替换原文件 —— 覆盖是不可逆的，宁可保留原始素材'));
                    }
                    resolve({ size: stat.size, duration: dur, tracks: outTracks });
                });
            });
        });
    }

    // ---------------------------------------------------------------------
    // 导出
    // ---------------------------------------------------------------------
    return {
        CODECS: CODECS,
        SPEED_LABELS: SPEED_LABELS,
        RESOLUTIONS: RESOLUTIONS,
        AUDIO_MODES: AUDIO_MODES,
        AUDIO_BITRATES: AUDIO_BITRATES,
        VIDEO_EXTENSIONS: VIDEO_EXTENSIONS,
        CONTAINER_SUPPORT: CONTAINER_SUPPORT,

        FfmpegNotFoundError: FfmpegNotFoundError,
        CancelledError: CancelledError,

        resolveBinaries: resolveBinaries,
        purgeStaleTemp: purgeStaleTemp,
        probe: probe,
        buildPlan: buildPlan,
        validatePlan: validatePlan,
        executePlan: executePlan,
        verifyOutput: verifyOutput,
        estimateOutputSize: estimateOutputSize,
        estimateCrfBySampling: estimateCrfBySampling,
        calcTargetVideoKbps: calcTargetVideoKbps,
        isVideoFile: isVideoFile,
        resolveAudioEncoder: resolveAudioEncoder,

        // 硬件加速
        detectHardware: detectHardware,
        resetHardwareCache: resetHardwareCache,
        resolveEncoder: resolveEncoder,
        isHardwareEncoder: isHardwareEncoder,
            crfToHwQp: crfToHwQp,
            HW_FAMILY_LABEL: HW_FAMILY_LABEL,
            HW_MAX_WORKERS: HW_MAX_WORKERS,
            // 资源预算常量：UI 要按同一套阈值决定给用户哪些选项
            MAX_WORKERS: MAX_WORKERS,
            MAX_WORKERS_MIN_CORES: MAX_WORKERS_MIN_CORES,

        // UI 需要的判断：HDR 破坏风险和容器能否存标记
        hdrRisk: hdrRisk,
        supportsCompressionMarker: supportsCompressionMarker,
        detectHdr: detectHdr,
        parseCompressionMarker: parseCompressionMarker,

        // 以下为纯函数，便于单测
        _internal: {
            parseFrameRate: parseFrameRate,
            bitDepthOf: bitDepthOf,
            normalizeProbe: normalizeProbe,
            resolveTargetHeight: resolveTargetHeight,
            sampleWindows: sampleWindows,
            buildCompressionMarker: buildCompressionMarker,
            markerArgs: markerArgs,
            hdrPreservationArgs: hdrPreservationArgs,
            MARKER_KEY: MARKER_KEY,
            tailText: tailText,
            preferredTempDir: preferredTempDir,
            noteTempDir: noteTempDir,
            purgeStaleTemp: purgeStaleTemp,
            TEMP_NAME_PREFIXES: TEMP_NAME_PREFIXES,
            COMMIT_MIN_RATIO: COMMIT_MIN_RATIO,
            shouldCommit: shouldCommit,
            subtitlePlan: subtitlePlan,
            streamMapArgs: streamMapArgs,
            shouldCopyAudio: shouldCopyAudio,
            vp9ParallelArgs: vp9ParallelArgs,
            pass1SpeedIndex: pass1SpeedIndex,
            crfToVtQuality: crfToVtQuality,
            crfToHwQuality: crfToHwQuality,
            countStreams: countStreams,
            missingTracks: missingTracks,
            recommendedWorkerCount: recommendedWorkerCount,
            recommendedThreadCount: recommendedThreadCount,
            withTimeout: withTimeout,
            videoEncodeArgs: videoEncodeArgs,
            hwInputArgs: hwInputArgs,
            parseEncoderNames: parseEncoderNames,
            HW_QUALITY_ARGS: HW_QUALITY_ARGS,
            NVENC_PRESETS: NVENC_PRESETS,
            HW_FAMILY_ORDER: HW_FAMILY_ORDER
        }
    };
});
