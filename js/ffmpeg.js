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
            speedArgs: function (v) { return ['-preset', v]; }
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
            speedArgs: function (v) { return ['-preset', v]; }
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
            speedArgs: function (v) { return ['-preset', v]; }
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
            speedArgs: function (v) { return ['-deadline', v === '0' ? 'best' : 'good', '-cpu-used', v]; }
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
            speedArgs: function () { return []; }
        }
    };

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
    var TEMP_PREFIXES = ['eagle-vc-out-', 'eagle-vc-pass-', 'eagle-vc-sample-'];

    // FFmpeg 在异常素材上可能持续输出错误信息；只需要最后几行诊断，不需要
    // 把完整 stderr 永久留在内存。64 KB 足够保留多个错误上下文，也不会让
    // 多路长任务的日志缓存无限增长。
    var STDERR_TAIL_LIMIT = 64 * 1024;

    var STALE_AGE_MS = 6 * 60 * 60 * 1000;   // 6 小时

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
     * 在源文件目录可写时，同卷写临时产物：之后覆盖原文件不需要跨卷复制。
     * 无权限、网络盘异常或路径不可解析时，安全回退系统临时目录。
     */
    function preferredTempDir(sourcePath) {
        var dir = path.dirname(sourcePath || '');
        try {
            if (dir && fs && fs.existsSync(dir)) {
                fs.accessSync(dir, fs.constants ? fs.constants.W_OK : fs.W_OK);
                return dir;
            }
        } catch (e) {}
        return os.tmpdir();
    }

    /**
     * 根据编码负载与可用 CPU 核数给出安全的实际 worker 数。
     * concurrency 仍是用户上限：用户选择 1 时绝不会被抬高；高负载编码器则
     * 适当收敛，避免多个自带多线程的 FFmpeg 进程互相抢满全部核心。
     */
    function recommendedWorkerCount(settings, cpuCount, taskCount) {
        settings = settings || {};
        var requested = Math.max(1, Math.min(4, Number(settings.concurrency) || 1));
        var cores = Math.max(1, Number(cpuCount) || 1);
        var tasks = Math.max(1, Number(taskCount) || 1);
        var cap;

        // AV1 与目标大小的两遍编码都属于高 CPU / 长任务，默认单 worker。
        if (settings.codec === 'av1' || settings.mode === 'target') cap = 1;
        else cap = Math.max(1, Math.min(4, Math.floor(cores / 4)));

        return Math.max(1, Math.min(requested, cap, tasks));
    }

    /**
     * 把总核心数分给实际 worker；只由运行时计划使用，不写回用户设置。
     * 留一个核心给 Eagle/UI，单 worker 时最多给 8 线程，避免极端机器上失控。
     */
    function recommendedThreadCount(cpuCount, workerCount) {
        var cores = Math.max(1, Number(cpuCount) || 1);
        var workers = Math.max(1, Number(workerCount) || 1);
        return Math.max(1, Math.min(8, Math.floor(Math.max(1, cores - 1) / workers)));
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
     * @returns {number} 清理掉的文件数
     */
    function purgeStaleTemp() {
        var dir = os.tmpdir();
        var now = Date.now();
        var removed = 0;

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
        } catch (e) { /* 读不了临时目录就算了，不该因此阻断启动 */ }

        return removed;
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

    function normalizeProbe(raw, filePath, statSize) {
        var format = raw.format || {};
        var streams = raw.streams || [];
        var video = null, audio = null;
        for (var i = 0; i < streams.length; i++) {
            var s = streams[i];
            if (s.codec_type === 'video' && !video && !(s.disposition && s.disposition.attached_pic)) video = s;
            else if (s.codec_type === 'audio' && !audio) audio = s;
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

        return {
            path: filePath,
            duration: duration,
            size: size,
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
                bitDepth: bitDepthOf(video),
                bitrate: videoBitrate,
                frames: parseInt(video.nb_frames, 10) || 0
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
            try { statSize = fs.statSync(filePath).size; } catch (e) {}

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
                resolve(normalizeProbe(parsed, filePath, statSize));
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

    /**
     * 视频编码参数（-c:v / -preset / -pix_fmt / -crf / -profile:v）。
     * 抽出来是给采样预估用的 —— 采样片段必须用和正式编码完全一样的参数，
     * 否则「预估」跟「实际」根本不是一回事。
     */
    function videoEncodeArgs(meta, settings, codec, args) {
        if (codec.id === 'copy') {
            args.push('-c:v', 'copy');
            return args;
        }

        args.push('-c:v', codec.encoder);

        // worker 数已按整机预算收敛；这里再给每个编码器明确线程上限，
        // 防止 x264/x265/AV1 默认自动吃满全部核心，导致多任务反而更慢。
        var threads = parseInt(settings.runtimeThreads, 10);
        if (isFinite(threads) && threads > 0) args.push('-threads', String(threads));

        if (codec.speeds) {
            var speed = codec.speeds[settings.speedIndex] || codec.speeds[2];
            args = args.concat(codec.speedArgs(speed));
        }

        // 像素格式 / 位深：10-bit 片源在支持 10-bit 的编码器上保留，否则统一降到 8-bit
        var bd = (meta.video && meta.video.bitDepth) || 8;
        if (bd >= 10 && codec.tenBit) args.push('-pix_fmt', 'yuv420p10le');
        else args.push('-pix_fmt', 'yuv420p');

        // 码率控制
        if (settings.mode === 'crf') {
            var crf = isFinite(settings.crf) ? settings.crf : codec.crf.def;
            args.push('-crf', String(crf));
            // VP9 的 CRF 模式必须显式把码率上限设为 0
            if (codec.id === 'vp9') args.push('-b:v', '0');
        } else {
            var kbps = settings.mode === 'bitrate'
                ? settings.videoBitrate
                : calcTargetVideoKbps(meta, settings).kbps;
            args.push('-b:v', kbps + 'k');
            if (settings.mode === 'target' && codec.id === 'x264') {
                // 单遍码率模式下给 x264 一个合理上限，避免峰值失控
                args.push('-maxrate', Math.round(kbps * 1.5) + 'k', '-bufsize', (kbps * 2) + 'k');
            }
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

    function buildPlan(meta, settings, outputPath, passLogPrefix) {
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

        var args = [];

        // 全局参数
        // -progress pipe:1 把机器可读的进度打到 stdout，避免解析 stderr 里带 \r 的人类可读进度
        // -nostats 关掉 stderr 上的重复统计，减少噪音
        args.push('-hide_banner', '-loglevel', 'error', '-nostdin', '-y');
        args.push('-progress', 'pipe:1', '-nostats');
        args.push('-i', meta.path);

        var vf = videoFilters(meta, settings);
        var targetH = resolveTargetHeight(meta, settings);

        // ---- 视频流 ----
        args = videoEncodeArgs(meta, settings, codec, args);

        // 复制视频流时不能挂滤镜，ffmpeg 会直接报错
        // （Streamcopy requested ... filtered），所以 copy 模式下忽略分辨率与帧率设置
        if (vf.length && codec.id !== 'copy') args.push('-vf', vf.join(','));

        // ---- 音轨 ----
        if (settings.audioMode === 'none' || !meta.audio) {
            args.push('-an');
        } else if (settings.audioMode === 'copy') {
            args.push('-c:a', 'copy');
        } else {
            args.push('-c:a', resolveAudioEncoder(ext), '-b:a', settings.audioBitrate + 'k');
        }

        // ---- 容器兼容性 ----
        args = args.concat(containerCompatibilityArgs(ext, codec, meta));

        // ---- 两遍编码 ----
        var passes;
        if (settings.mode === 'target' && codec.twoPass && codec.id !== 'copy') {
            var kbps2 = calcTargetVideoKbps(meta, settings).kbps;
            var nullOut = proc.platform === 'win32' ? 'NUL' : '/dev/null';

            var pass1 = args.slice();
            pass1.push('-pass', '1', '-passlogfile', passLogPrefix, '-an', '-f', 'mp4', nullOut);

            var pass2 = args.slice();
            pass2.push('-pass', '2', '-passlogfile', passLogPrefix, outputPath);

            passes = [pass1, pass2];
        } else {
            passes = [args.concat([outputPath])];
        }

        return {
            passes: passes,
            outputExt: path.extname(meta.path).toLowerCase(),
            passLogPrefix: passes.length > 1 ? passLogPrefix : null,
            targetHeight: targetH
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
                '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
                // 输入前定位优先速度。采样是预览，不应为了精确帧定位去把长片解码一遍。
                '-ss', String(win.start), '-i', meta.path,
                '-t', String(win.duration), '-map', '0:v:0'
            ];
            args = videoEncodeArgs(meta, settings, codec, args);
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
                    if (opts.cancelToken.cancelled && !killed) {
                        killed = true;
                        clearInterval(timer);
                        try { child.kill('SIGKILL'); } catch (e) {}
                    }
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
     * 校验编码产物是否可用：文件存在、非空、且能被 ffprobe 读出时长。
     */
    function verifyOutput(binaries, outputPath, sourceDuration) {
        return new Promise(function (resolve, reject) {
            fs.stat(outputPath, function (err, stat) {
                if (err) return reject(new Error('输出文件不存在，编码可能失败'));
                if (stat.size <= 0) return reject(new Error('输出文件为空，编码失败'));

                var args = ['-v', 'error', '-print_format', 'json', '-show_format', outputPath];
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
                    var dur = 0;
                    try {
                        dur = parseFloat(JSON.parse(out).format.duration) || 0;
                    } catch (e) {}
                    // 时长偏差超过 2 秒或 2% 视为异常
                    if (sourceDuration > 0 && dur > 0) {
                        var diff = Math.abs(dur - sourceDuration);
                        if (diff > 2 && diff / sourceDuration > 0.02) {
                            return reject(new Error('输出时长与原片差异过大（' +
                                dur.toFixed(1) + 's vs ' + sourceDuration.toFixed(1) + 's），已放弃替换原文件'));
                        }
                    }
                    resolve({ size: stat.size, duration: dur });
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

        // 以下为纯函数，便于单测
        _internal: {
            parseFrameRate: parseFrameRate,
            bitDepthOf: bitDepthOf,
            normalizeProbe: normalizeProbe,
            resolveTargetHeight: resolveTargetHeight,
            sampleWindows: sampleWindows,
            tailText: tailText,
            preferredTempDir: preferredTempDir,
            recommendedWorkerCount: recommendedWorkerCount,
            recommendedThreadCount: recommendedThreadCount,
            withTimeout: withTimeout
        }
    };
});
