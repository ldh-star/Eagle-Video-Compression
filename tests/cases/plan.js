/**
 * 用例分片：编码计划与 FFmpeg 参数。
 *
 * 这一片盯的是「buildPlan 生成的命令行」。之所以不做真实编码：参数错了产物必然错，
 * 而参数检查是毫秒级，可以每次改动都跑。只有 P0-01e / P0-05 两个端到端用例用到
 * 真实 ffmpeg —— 它们验证的是「ffmpeg 的默认行为」，不跑一遍就没有可信度。
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const H = require('./helpers');

const { meta, settings, plan, args, hasFlag, hasPair, valueOf, paramsString } = H;

const cases = [];
function add(c) { cases.push(c); }

// ---------------------------------------------------------------------------
// P0 · 流完整性
// ---------------------------------------------------------------------------

add({
    id: 'P0-01',
    title: '多轨源必须显式 -map，不能依赖 ffmpeg 默认流选择',
    area: 'plan',
    level: 'P0',
    status: 'implemented',
    issue: 'buildPlan 从头到尾没有一个 -map，走 ffmpeg 默认流选择 = 每类只留一路。' +
           '实测：2 音轨 + 1 字幕的 MKV 压完只剩 1 音轨，退出码 0、无任何警告，而原文件已被覆盖。',
    contract: 'MKV / WebM 输出必须带 -map 0:v:0 -map 0:a? -map 0:s? -map_metadata 0 -map_chapters 0',
    ref: 'js/ffmpeg.js buildPlan',
    run: function () {
        const a = args(meta({ path: '/tmp/input.mkv' }), settings({ codec: 'h265' }));
        assert(hasPair(a, '-map', '0:v:0'), '必须显式选主视频流，否则多视频轨（含封面/附件）会被默认规则挑错');
        assert(hasPair(a, '-map', '0:a?'), '必须显式选全部音轨（0:a? 而不是 0:a:0），否则双音轨源会静默丢一条');
        assert(hasPair(a, '-map', '0:s?'), '必须显式选全部字幕流，否则内挂字幕会丢失');
        assert(hasPair(a, '-map_metadata', '0'), '必须继承容器级 metadata，否则标题/演职员信息会丢');
        assert(hasPair(a, '-map_chapters', '0'), '必须继承章节信息');
    }
});

add({
    id: 'P0-01b',
    title: 'MP4 输出同样要保留多轨（并取得容器能承载的字幕）',
    area: 'plan',
    level: 'P0',
    status: 'implemented',
    issue: 'MP4 最常见，丢轨的破坏面也最大。但它的字幕 muxer 只吃文本字幕（mov_text），' +
           'PGS 这类位图字幕塞进去会让整条命令失败，所以不能无脑照抄 MKV 的参数。',
    contract: 'MP4 也必须 -map 0:v:0 -map 0:a?；字幕按源字幕类型决定 -c:s copy/mov_text 还是 -sn',
    ref: 'js/ffmpeg.js buildPlan',
    run: function () {
        const a = args(meta({ path: '/tmp/input.mp4' }), settings({ codec: 'h265' }));
        assert(hasPair(a, '-map', '0:v:0'), 'MP4 输出同样必须显式选主视频流');
        assert(hasPair(a, '-map', '0:a?'), 'MP4 输出同样必须保留全部音轨');
        assert(hasPair(a, '-map_metadata', '0'), 'MP4 输出同样必须继承容器 metadata');
    }
});

add({
    id: 'P0-01c',
    title: 'normalizeProbe 必须暴露音轨数 / 字幕流列表',
    area: 'plan',
    level: 'P0',
    status: 'implemented',
    issue: 'normalizeProbe 只保留第一条音轨、完全不记字幕流，于是「这个文件有几条轨」这个信息' +
           '在探测阶段就被丢掉了 —— 界面上看不出丢轨，buildPlan 也没法按容器能力决定字幕怎么处理。',
    contract: 'normalizeProbe 的结果要带 tracks: { video, audio, subtitle } 计数（或等价的流清单）',
    ref: 'js/ffmpeg.js normalizeProbe',
    run: function () {
        const Core = H.loadCore();
        const raw = {
            format: { format_name: 'matroska,webm', duration: '12.0', size: '1000', bit_rate: '800000', tags: {} },
            streams: [
                { codec_type: 'video', codec_name: 'h264', width: 1920, height: 1080, avg_frame_rate: '30/1', pix_fmt: 'yuv420p' },
                { codec_type: 'audio', codec_name: 'aac', bit_rate: '128000', tags: { language: 'chi' } },
                { codec_type: 'audio', codec_name: 'aac', bit_rate: '128000', tags: { language: 'yue' } },
                { codec_type: 'subtitle', codec_name: 'subrip' }
            ]
        };
        const m = Core._internal.normalizeProbe(raw, '/tmp/x.mkv', 1000);
        assert(m.tracks, 'normalizeProbe 必须给出流计数，否则上层无法判断有没有丢轨');
        assert.strictEqual(m.tracks.audio, 2, '两条音轨必须被记为 2，只留第一条会让丢轨变成不可见故障');
        assert.strictEqual(m.tracks.subtitle, 1, '字幕流必须被记下来，容器能力判断依赖它');
        assert.strictEqual(m.tracks.video, 1, '视频轨计数应为 1');
    }
});

add({
    id: 'P0-01e',
    title: '端到端：2 音轨源压缩后产物仍有 2 条音轨',
    area: 'plan',
    level: 'P0',
    status: 'implemented',
    requires: 'ffmpeg',
    issue: '参数层面的推断最终要用真实 ffmpeg 验一次：默认流选择的具体行为因容器/版本而异，' +
           '不跑一遍就无法断言「真的会丢」。',
    contract: '用插件自己生成的命令行压缩一个 2 音轨 + 1 字幕的 MKV，产物音轨数必须等于源音轨数',
    ref: 'js/ffmpeg.js buildPlan',
    run: async function () {
        const bins = H.ffmpegBins();
        const cp = require('child_process');
        const dir = H.tmpDir('eagle-vc-case-track-');
        try {
            const src = path.join(dir, 'src.mkv');
            const sub = path.join(dir, 'sub.srt');
            const out = path.join(dir, 'out.mkv');
            fs.writeFileSync(sub, '1\n00:00:00,500 --> 00:00:02,000\n第一行\n\n');
            // 3 秒小片，压得快；重点在轨道结构不在画质
            cp.spawnSync(bins.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y',
                '-f', 'lavfi', '-i', 'testsrc2=s=320x240:r=24:d=3',
                '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3',
                '-f', 'lavfi', '-i', 'sine=frequency=880:duration=3',
                '-i', sub,
                '-map', '0:v', '-map', '1:a', '-map', '2:a', '-map', '3:s',
                '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-b:a', '64k',
                '-c:s', 'srt', src]);

            const m = H.meta({ path: src, width: 320, height: 240, duration: 3 });
            // 输出路径必须显式传给 buildPlan：默认路径在 /tmp 下，
            // 那样 ffprobe 检查的文件根本不是这次的产物。
            const p = plan(m, settings({ codec: 'h265', audioMode: 'copy' }), undefined, out);
            const r = cp.spawnSync(bins.ffmpeg, p.passes[0], { encoding: 'utf8' });
            assert.strictEqual(r.status, 0, '插件生成的命令必须能跑通：' + String(r.stderr).trim().split('\n').slice(-3).join(' | '));

            const probe = cp.spawnSync(bins.ffprobe,
                ['-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', out], { encoding: 'utf8' });
            const counts = String(probe.stdout).trim().split('\n').reduce(function (acc, line) {
                // csv=p=0 只输出值（一行一个 "audio"）；不带 p=0 时才是 "stream,audio"。
                // 取最后一段两种格式都能解析，免得换个 ffprobe 版本就把用例变成永远红。
                const parts = line.split(',');
                const t = parts[parts.length - 1];
                if (t) acc[t] = (acc[t] || 0) + 1;
                return acc;
            }, {});
            assert.strictEqual(counts.audio, 2, '源有 2 条音轨，产物必须也有 2 条；少一条就是不可逆的素材损毁');
            assert.strictEqual(counts.subtitle, 1, '源有 1 条字幕，产物必须也有 1 条');
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    }
});

add({
    id: 'P0-05',
    title: 'verifyOutput 必须能发现「产物比源少了轨道」',
    area: 'plan',
    level: 'P0',
    status: 'implemented',
    requires: 'ffmpeg',
    issue: 'verifyOutput 只校验文件大小与时长。只要时长对得上，丢音轨 / 丢字幕的产物会被判定为' +
           '「校验通过」然后去覆盖原文件 —— 即使 buildPlan 的 -map 修好了，这里仍是敞开的口子。',
    contract: 'verifyOutput(bins, outPath, srcDuration, srcMeta) 必须在产物轨道数少于源时 reject',
    ref: 'js/ffmpeg.js verifyOutput',
    run: async function () {
        const bins = H.ffmpegBins();
        const cp = require('child_process');
        const Core = H.loadCore();
        const dir = H.tmpDir('eagle-vc-case-verify-');
        try {
            const src = path.join(dir, 'src.mkv');
            const out = path.join(dir, 'out.mkv');
            cp.spawnSync(bins.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y',
                '-f', 'lavfi', '-i', 'testsrc2=s=320x240:r=24:d=3',
                '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3',
                '-f', 'lavfi', '-i', 'sine=frequency=880:duration=3',
                '-map', '0:v', '-map', '1:a', '-map', '2:a',
                '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-b:a', '64k', src]);
            // 人为造一个「丢了一条音轨」的产物
            cp.spawnSync(bins.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y',
                '-i', src, '-map', '0:v:0', '-map', '0:a:0', '-c', 'copy', out]);

            const srcMeta = await Core.probe(bins, src);
            await assert.rejects(
                function () { return Core.verifyOutput(bins, out, srcMeta.duration, srcMeta); },
                '产物比源少一条音轨时，verifyOutput 必须拒绝提交 —— 这是覆盖原文件前的最后一道闸门'
            );
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    }
});

// ---------------------------------------------------------------------------
// P0 · 死代码
// ---------------------------------------------------------------------------

add({
    id: 'P0-04',
    title: '码率模式必须给 -maxrate / -bufsize（x264 死代码）',
    area: 'plan',
    level: 'P0',
    status: 'implemented',
    issue: 'js/ffmpeg.js:1278 判断的是 codec.id === "x264"，而 id 永远是 "h264"，' +
           '这个分支从未执行过 —— VBR 的瞬时峰值没有任何上限。',
    contract: 'mode 为 bitrate / target 时都要给 -maxrate 与 -bufsize；CRF 模式不要给',
    ref: 'js/ffmpeg.js videoEncodeArgs',
    run: function () {
        const a = args(meta(), settings({ codec: 'h265', mode: 'bitrate', videoBitrate: 4000 }));
        assert(hasFlag(a, '-maxrate'), '码率模式必须限制峰值码率，否则网络播放会卡顿');
        assert(hasFlag(a, '-bufsize'), '-maxrate 必须配 -bufsize 才有意义');
    }
});

add({
    id: 'P0-04b',
    title: 'CRF 模式不得出现 -maxrate（会破坏恒定画质）',
    area: 'plan',
    level: 'P0',
    status: 'implemented',
    issue: '修 P0-04 时最容易顺手把条件写成「总是加 maxrate」，那会连 CRF 一起改坏 —— ' +
           '这条用例把「CRF 分支必须干净」钉死。',
    contract: 'CRF 模式下不得有 -maxrate / -bufsize',
    ref: 'js/ffmpeg.js videoEncodeArgs',
    run: function () {
        const a = args(meta(), settings({ codec: 'h265', mode: 'crf', crf: 28 }));
        assert(!hasFlag(a, '-maxrate'), 'CRF 是恒定画质，加 -maxrate 会把它变成受限 VBR');
        assert(!hasFlag(a, '-bufsize'), 'CRF 模式不需要 -bufsize');
    }
});

// ---------------------------------------------------------------------------
// P1 · 硬件编码：VideoToolbox
// ---------------------------------------------------------------------------

const VT_HW = {
    families: ['videotoolbox'],
    encoders: { hevc_videotoolbox: true, h264_videotoolbox: true },
    decodeMethods: ['videotoolbox']
};

add({
    id: 'P1-05',
    title: '必须支持 macOS VideoToolbox 硬件编码',
    area: 'plan',
    level: 'P1',
    status: 'implemented',
    issue: 'HW_FAMILY_ORDER = ["nvenc","qsv","amf"]，没有 videotoolbox。Apple Silicon 上' +
           'ffmpeg 明明编进了 hevc_videotoolbox，插件却报「未检测到硬件编码」，全部走 CPU。' +
           '实测 1080p20s：x265 medium 6.05s / 723% CPU，hevc_videotoolbox 2.87s / 53% CPU（CPU 占用差 14 倍）。',
    contract: 'HW_FAMILY_ORDER 含 videotoolbox；h264/h265 有对应条目；resolveEncoder 在 auto 下能选中它',
    ref: 'js/ffmpeg.js HW_FAMILY_ORDER / CODECS.*.hw / resolveEncoder',
    run: function () {
        const Core = H.loadCore();
        assert(Core._internal.HW_FAMILY_ORDER.indexOf('videotoolbox') !== -1,
            'Apple 平台上 VideoToolbox 是唯一可用的硬件编码家族，不列进来等于 Mac 用户永远用不上 GPU');
        assert(Core.CODECS.h265.hw.videotoolbox, 'H.265 必须有 videotoolbox 条目（默认编码就是 H.265）');
        assert(Core.CODECS.h264.hw.videotoolbox, 'H.264 必须有 videotoolbox 条目');

        const enc = Core.resolveEncoder('h265', { hwAccel: 'auto' }, VT_HW);
        assert.strictEqual(enc.kind, 'videotoolbox', 'auto 模式下检测到 VT 就应该走 VT');
        assert.strictEqual(enc.encoder, 'hevc_videotoolbox', 'H.265 对应 hevc_videotoolbox');
    }
});

add({
    id: 'P1-05b',
    title: 'VideoToolbox 的质量参数用 -q:v，不能套 constqp / CRF',
    area: 'plan',
    level: 'P1',
    status: 'implemented',
    issue: 'VideoToolbox 的 -q:v 是 0~100 且「越大越好」，与 CRF 方向相反，也不是 NVENC 的 -rc constqp。' +
           '实测标定：x265 -crf 28 = 11.32MB，hevc_videotoolbox 对齐点在 q≈52（q=55 → 14.7MB，q=50 → 8.3MB）。',
    contract: 'VT 分支输出 -q:v <1..100>，且不得出现 -rc constqp / -qp / -crf',
    ref: 'js/ffmpeg.js HW_QUALITY_ARGS / videoEncodeArgs',
    run: function () {
        const a = args(meta(), settings({ codec: 'h265', mode: 'crf', crf: 28, hwAccel: 'auto' }), VT_HW);
        assert(hasFlag(a, '-q:v'), 'VideoToolbox 的恒定画质开关是 -q:v');
        const q = Number(valueOf(a, '-q:v'));
        assert(q >= 1 && q <= 100, '-q:v 的取值范围是 1~100，实际是 ' + valueOf(a, '-q:v'));
        assert(!hasPair(a, '-rc', 'constqp'), 'VT 不吃 NVENC 的 -rc constqp');
        assert(!hasFlag(a, '-crf'), 'VT 不使用 CRF：它的 -q:v 刻度与 CRF 相反，直接换算会让体积失控');
    }
});

add({
    id: 'P1-05c',
    title: 'VideoToolbox 走硬件解码（hwaccel 在 -i 之前）',
    area: 'plan',
    level: 'P1',
    status: 'implemented',
    issue: 'HW_DECODE_METHOD 只给 nvenc 配了 cuda。实测 -hwaccel videotoolbox 可用，能再省一部分 CPU。',
    contract: 'VT 分支在 -i 之前输出 -hwaccel videotoolbox',
    ref: 'js/ffmpeg.js HW_DECODE_METHOD / hwInputArgs',
    run: function () {
        const a = args(meta(), settings({ codec: 'h265', mode: 'crf', hwAccel: 'auto' }), VT_HW);
        assert(hasPair(a, '-hwaccel', 'videotoolbox'), 'VT 应该配硬件解码');
        assert(H.indexOfFlag(a, '-hwaccel') < H.indexOfFlag(a, '-i'),
            '-hwaccel 是输入选项，必须排在 -i 之前，否则 ffmpeg 直接报错');
    }
});

// ---------------------------------------------------------------------------
// P1 · 线程预算
// ---------------------------------------------------------------------------

add({
    id: 'P1-06a',
    title: 'libx265 必须显式限制线程池（-threads 无效）',
    area: 'plan',
    level: 'P1',
    status: 'implemented',
    issue: '实测：给 -threads 2 后 x265 日志仍是 "Thread pool created using 14 threads"；' +
           '加 -x265-params pools=2 才变成 2 线程（耗时 6.05s → 17.4s，证明确实被限速）。' +
           '于是 recommendedThreadCount 的整套设计意图在 x265 上完全落空，多 worker 时各个进程互相抢满核心。',
    contract: '软件 x265 分支必须输出 -x265-params 且包含 pools=<N>',
    ref: 'js/ffmpeg.js videoEncodeArgs',
    run: function () {
        const a = args(meta(), settings({ codec: 'h265', mode: 'crf' }));
        const p = paramsString(a, '-x265-params');
        assert(p, 'x265 必须显式给 -x265-params：-threads 只映射成 frame-threads，worker pool 仍吃满全部核心');
        H.assertIncludes(p, 'pools=', '-x265-params 必须包含 pools=，否则限不住线程池（实测 ' + p + '）');
    }
});

add({
    id: 'P1-06b',
    title: 'libsvtav1 必须显式限制并行度（-threads 无效）',
    area: 'plan',
    level: 'P1',
    status: 'implemented',
    issue: '实测：SVT-AV1 的 "Level of Parallelism" 恒定 5，完全不随 -threads 变化。',
    contract: 'SVT-AV1 分支必须输出 -svtav1-params 且包含 lp=<N>',
    ref: 'js/ffmpeg.js videoEncodeArgs',
    run: function () {
        const a = args(meta(), settings({ codec: 'av1', mode: 'crf', crf: 32 }));
        const p = paramsString(a, '-svtav1-params');
        assert(p, 'SVT-AV1 必须显式给 -svtav1-params：它不读 -threads，并行度是自动值');
        H.assertIncludes(p, 'lp=', '-svtav1-params 必须包含 lp=（实际 ' + p + '）');
    }
});

add({
    id: 'P1-07',
    title: 'VP9 必须开 -row-mt 并按宽度给 -tile-columns',
    area: 'plan',
    level: 'P1',
    status: 'implemented',
    issue: 'speedArgs 只给了 -deadline / -cpu-used。libvpx-vp9 不开 row-mt 时并行度受 tile 数限制，' +
           '1080p 默认 tile-columns=0，等于浪费掉大部分核心。实测 1080p/6s：-cpu-used 4 从 4.05s 降到 2.41s（1.68×）。',
    contract: 'VP9 分支必须有 -row-mt 1，并按宽度给 -tile-columns（1080p → 2，4K → 3）',
    ref: 'js/ffmpeg.js CODECS.vp9.speedArgs',
    run: function () {
        const a = args(meta({ path: '/tmp/input.webm', width: 1920, height: 1080 }),
            settings({ codec: 'vp9', mode: 'crf', crf: 32 }));
        assert(hasPair(a, '-row-mt', '1'), '不开 row-mt 时 VP9 基本是半单线程在跑');
        const tc = valueOf(a, '-tile-columns');
        assert(tc !== null && Number(tc) >= 2, '1080p 至少要 2 列 tile，否则 row-mt 也并行不起来（实际 ' + tc + '）');
    }
});

add({
    id: 'LOCK-01',
    title: 'VP9 的 CRF 模式必须显式 -b:v 0',
    area: 'plan',
    level: 'P1',
    status: 'implemented',
    issue: 'libvpx-vp9 的 CRF 模式要求把目标码率显式设成 0，否则会走 ABR。' +
           '这是已经生效的正确行为，改 speedArgs（P1-07）时很容易顺手弄丢，钉一条。',
    contract: 'VP9 + CRF 必须有 -b:v 0',
    ref: 'js/ffmpeg.js videoEncodeArgs',
    run: function () {
        const a = args(meta({ path: '/tmp/input.webm' }), settings({ codec: 'vp9', mode: 'crf', crf: 32 }));
        assert(hasPair(a, '-b:v', '0'), 'VP9 的 CRF 模式必须显式把码率设为 0');
    }
});

// ---------------------------------------------------------------------------
// P1 · 音轨与两遍编码
// ---------------------------------------------------------------------------

add({
    id: 'P1-11',
    title: '源音轨已是 AAC 且码率够低时直接复制，不要重编码',
    area: 'plan',
    level: 'P1',
    status: 'implemented',
    issue: 'audioMode=aac 时无条件 -c:a aac -b:a 128k。源本来就是 128k AAC 也要重压一遍，' +
           '白花时间还多一次有损。',
    contract: '源 codec ∈ {aac, opus} 且 bitrate ≤ 目标 × 1.1 → -c:a copy',
    ref: 'js/ffmpeg.js buildPlan',
    run: function () {
        const a = args(meta({ audioBitrate: 128000 }), settings({ audioMode: 'aac', audioBitrate: 128 }));
        assert(hasPair(a, '-c:a', 'copy'), '源已经是 128k AAC，目标是 128k AAC，应该直接复制而不是再压一次');
    }
});

add({
    id: 'P1-11b',
    title: '源音轨码率高于目标时仍然要重编码',
    area: 'plan',
    level: 'P1',
    status: 'implemented',
    issue: 'P1-11 修过头就会变成「永远 copy」，那音轨就再也压不动了。这条把边界的另一侧钉住。',
    contract: '源 codec 相同但 bitrate > 目标 × 1.1 → 仍然 -c:a <编码器>',
    ref: 'js/ffmpeg.js buildPlan',
    run: function () {
        const a = args(meta({ audioBitrate: 320000 }), settings({ audioMode: 'aac', audioBitrate: 128 }));
        assert(!hasPair(a, '-c:a', 'copy'), '源 320k 明显高于目标 128k，必须重编码');
        assert(hasPair(a, '-c:a', 'aac'), 'MP4 容器的重编码目标是 AAC');
    }
});

add({
    id: 'P1-12',
    title: '两遍编码的 pass1 必须降档',
    area: 'plan',
    level: 'P1',
    status: 'implemented',
    issue: 'pass1 复用了和 pass2 完全相同的 -preset。x264 内部有 turbo 兜底，x265 没有' +
           '（默认 slow-firstpass=1），所以 -preset veryslow 的目标大小模式实际是跑了两次 veryslow。',
    contract: 'pass1 的 preset 必须比 pass2 快（或给 x265 加 slow-firstpass=0）',
    ref: 'js/ffmpeg.js buildPlan 两遍分支',
    run: function () {
        const Core = H.loadCore();
        const speeds = Core.CODECS.h265.speeds;   // 索引 0 最快 → 4 最慢
        const p = plan(meta(), settings({ codec: 'h265', mode: 'target', targetSizeMB: 20, speedIndex: 4 }));
        assert.strictEqual(p.passes.length, 2, 'H.265 + 目标大小应该是两遍编码');
        const p1 = valueOf(p.passes[0], '-preset');
        const p2 = valueOf(p.passes[1], '-preset');
        assert(p1 && p2, '两遍都要有 -preset');
        assert(speeds.indexOf(p1) < speeds.indexOf(p2),
            'pass1 的 preset（' + p1 + '）必须比 pass2（' + p2 + '）快，否则等于全片编码两次');
    }
});

add({
    id: 'P2-01',
    title: 'pass1 应写 -f null 而不是 -f mp4 /dev/null',
    area: 'plan',
    level: 'P2',
    status: 'implemented',
    issue: 'pass1 的产物是丢掉的，但 -f mp4 会真的走一遍 MP4 muxer，白烧 CPU 和 IO。',
    contract: 'pass1 输出用 -f null（或等价的空 muxer）',
    ref: 'js/ffmpeg.js buildPlan 两遍分支',
    run: function () {
        const p = plan(meta(), settings({ codec: 'h265', mode: 'target', targetSizeMB: 20 }));
        assert.strictEqual(p.passes.length, 2, '目标大小模式应为两遍');
        assert.strictEqual(valueOf(p.passes[0], '-f'), 'null',
            'pass1 的产物会被丢弃，不该再走一遍 mp4 muxer');
    }
});

module.exports = cases;
