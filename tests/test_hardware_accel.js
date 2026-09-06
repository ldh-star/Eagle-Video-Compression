/**
 * 硬件加速（NVENC / QSV / AMF）核心逻辑的回归测试。
 *
 * 这套逻辑是性能优化的核心：默认 auto 下，检测到硬件编码器就走 GPU 编码，
 * 把 CPU 占用从 ~10 核压到 1 核以内、编码快 3~5 倍。但硬件路径有几处容易
 * 写错、一错就「看起来成功其实没用」或「整条命令失败」的地方，必须钉死：
 *
 * 1. resolveEncoder：auto 下要真的选到硬件编码器；cpu 模式必须无视硬件；
 *    copy 模式永远走 CPU（没有「硬件复制」这回事）。
 * 2. crfToHwQp：软件 CRF 与硬件 QP 刻度不同，换算错了产物体积会失控
 *    （NVENC 的 -cq 不是 x265 的 -crf；正确做法是 -rc constqp -qp，
 *     HEVC/H.264 用 +2 偏移、AV1 用 ×3.2）。
 * 3. buildPlan 的硬件分支：-hwaccel 必须放在 -i 之前；CRF 模式用 constqp、
 *    码率模式用 -multipass 2；硬件编码不管「目标大小」都不走真两遍
 *    （NVENC 的 -pass 会被静默忽略，白白多跑一遍全片）。
 * 4. recommendedWorkerCount：硬件编码的并发上限收敛到 HW_MAX_WORKERS（2），
 *    因为 GPU 吞吐不随进程数线性增长。
 */
const assert = require('assert');
const path = require('path');
const Core = require(path.join(__dirname, '..', 'js', 'ffmpeg.js'));

// 一台带 N 卡的机器（RTX 4070 Ti SUPER 实测环境）
const NV_HW = {
    families: ['nvenc'],
    encoders: { hevc_nvenc: true, h264_nvenc: true, av1_nvenc: true },
    decodeMethods: ['cuda', 'qsv']
};
const NO_HW = { families: [], encoders: {}, decodeMethods: [] };

function rawProbe(opts) {
    opts = opts || {};
    const video = {
        codec_type: 'video',
        codec_name: opts.codec || 'h264',
        width: 1920,
        height: 1080,
        avg_frame_rate: '30/1',
        pix_fmt: opts.pixFmt || 'yuv420p',
        bit_rate: '8000000'
    };
    return {
        format: { format_name: 'mov,mp4', duration: '30.000000', size: '30000000', bit_rate: '8000000', tags: {} },
        streams: [video, { codec_type: 'audio', codec_name: 'aac', bit_rate: '128000' }]
    };
}

function settings(codec) {
    return {
        codec: codec || 'h265',
        mode: 'crf',
        crf: 28,
        speedIndex: 2,
        resolution: 'source',
        fps: 'source',
        audioMode: 'aac',
        audioBitrate: 128,
        concurrency: 1,
        hwAccel: 'auto'
    };
}

function containsPair(args, flag, value) {
    return args.some(function (arg, i) {
        return arg === flag && args[i + 1] === value;
    });
}
function indexOfFlag(args, flag) {
    return args.indexOf(flag);
}

// ===========================================================================
// 1. resolveEncoder —— 选编码器
// ===========================================================================

// auto + 有硬件 → 选到 NVENC
let enc = Core.resolveEncoder('h265', settings('h265'), NV_HW);
assert.strictEqual(enc.kind, 'nvenc', 'auto + nvenc available should pick NVENC');
assert.strictEqual(enc.encoder, 'hevc_nvenc', 'H.265 should map to hevc_nvenc');
assert.strictEqual(Core.isHardwareEncoder(enc), true, 'NVENC must report as hardware encoder');

// cpu 模式 → 无视硬件，强制 libx265
enc = Core.resolveEncoder('h265', (function () { const s = settings('h265'); s.hwAccel = 'cpu'; return s; })(), NV_HW);
assert.strictEqual(enc.kind, 'cpu', 'cpu mode must ignore hardware entirely');
assert.strictEqual(enc.encoder, 'libx265', 'cpu mode must use the software encoder');

// gpu 模式 + 没硬件 → 回退 CPU（不报错，只是用软件）
enc = Core.resolveEncoder('h265', (function () { const s = settings('h265'); s.hwAccel = 'gpu'; return s; })(), NO_HW);
assert.strictEqual(enc.kind, 'cpu', 'gpu mode without hardware falls back to CPU, not crash');
assert.strictEqual(enc.encoder, 'libx265', 'fallback encoder must be the software one');

// copy 模式 → 永远 CPU，硬件无从谈起
enc = Core.resolveEncoder('copy', settings('copy'), NV_HW);
assert.strictEqual(enc.kind, 'cpu', 'copy never uses hardware');
assert.strictEqual(enc.encoder, 'copy', 'copy stays copy');

// AV1 在 N 卡上映射到 av1_nvenc
enc = Core.resolveEncoder('av1', settings('av1'), NV_HW);
assert.strictEqual(enc.kind, 'nvenc', 'AV1 should use hardware NVENC on N card');
assert.strictEqual(enc.encoder, 'av1_nvenc', 'AV1 maps to av1_nvenc');

// ===========================================================================
// 2. crfToHwQp —— 软件 CRF → 硬件 QP 刻度换算
// ===========================================================================

// HEVC/H.264: +2 偏移。crf 28 → 30（与 RTX 4070 Ti SUPER 实测对齐）
assert.strictEqual(Core.crfToHwQp(28, 'h265'), 30, 'H.265 crf 28 should map to QP 30 (+2)');
assert.strictEqual(Core.crfToHwQp(23, 'h264'), 25, 'H.264 crf 23 should map to QP 25 (+2)');

// AV1: ×3.2。crf 32 → round(102.4) = 102
assert.strictEqual(Core.crfToHwQp(32, 'av1'), 102, 'AV1 crf 32 should map to QP 102 (×3.2)');

// 边界夹紧
assert.strictEqual(Core.crfToHwQp(0, 'h265'), 2, 'minimum QP clamp (crf 0 → 2, not below 1)');
assert.strictEqual(Core.crfToHwQp(80, 'h265'), 51, 'maximum QP clamp (crf 80 → 51)');

// ===========================================================================
// 3. buildPlan —— 硬件分支的参数构建
// ===========================================================================

// --- CRF 模式：NVENC 用 constqp，且 -hwaccel 在 -i 之前 ---
let plan = Core.buildPlan(
    Core._internal.normalizeProbe(rawProbe({}), '/tmp/in.mp4', 30000000),
    (function () { const s = settings('h265'); s.crf = 28; return s; })(),
    '/tmp/out.mp4', '/tmp/pass', NV_HW
);
assert.strictEqual(plan.encoder.kind, 'nvenc', 'plan should use NVENC');
assert(containsPair(plan.passes[0], '-c:v', 'hevc_nvenc'), 'must select hevc_nvenc');
// NVENC preset 来自 speedIndex=2 → NVENC_PRESETS[2]='p4'
assert(containsPair(plan.passes[0], '-preset', 'p4'), 'speedIndex 2 must map to NVENC preset p4');
// CRF → constqp，QP = crfToHwQp(28,'h265') = 30
assert(containsPair(plan.passes[0], '-rc', 'constqp'), 'hardware CRF must use -rc constqp (not -cq)');
assert(containsPair(plan.passes[0], '-qp', '30'), 'constqp QP must be 30 for crf 28');
// 硬件解码必须排在 -i 之前
const hwaccelIdx = indexOfFlag(plan.passes[0], '-hwaccel');
const iIdx = indexOfFlag(plan.passes[0], '-i');
assert(hwaccelIdx !== -1, 'hardware decode must be requested');
assert(hwaccelIdx < iIdx, '-hwaccel must appear before -i or ffmpeg rejects it');
assert(containsPair(plan.passes[0], '-hwaccel', 'cuda'), 'NVIDIA decode method is cuda');
// 不应出现软件风格的 -crf
assert(indexOfFlag(plan.passes[0], '-crf') === -1, 'hardware path must not emit -crf');

// --- 码率模式：multipass 2，不真两遍 ---
const br = settings('h265');
br.mode = 'bitrate';
br.videoBitrate = 4000;
plan = Core.buildPlan(
    Core._internal.normalizeProbe(rawProbe({}), '/tmp/in.mp4', 30000000),
    br, '/tmp/out.mp4', '/tmp/pass', NV_HW
);
assert(containsPair(plan.passes[0], '-b:v', '4000k'), 'bitrate mode must set -b:v');
assert(containsPair(plan.passes[0], '-multipass', '2'), 'hardware bitrate should use -multipass 2');
assert(plan.passes.length === 1, 'hardware encoder must not run a real two-pass');
assert(indexOfFlag(plan.passes[0], '-pass') === -1, 'hardware path must not emit -pass');

// --- 目标大小 + 硬件：仍是单遍（multipass 2 代替真两遍）---
const tgt = settings('h265');
tgt.mode = 'target';
tgt.targetSizeMB = 50;
plan = Core.buildPlan(
    Core._internal.normalizeProbe(rawProbe({}), '/tmp/in.mp4', 30000000),
    tgt, '/tmp/out.mp4', '/tmp/pass', NV_HW
);
assert.strictEqual(plan.passes.length, 1, 'target mode on hardware must stay single-pass');
assert(containsPair(plan.passes[0], '-multipass', '2'), 'target mode should use -multipass 2 on hardware');

// --- 对照：目标大小 + CPU（无硬件）必须真两遍 ---
const tgtCpu = settings('h265');
tgtCpu.hwAccel = 'cpu';
tgtCpu.mode = 'target';
tgtCpu.targetSizeMB = 50;
plan = Core.buildPlan(
    Core._internal.normalizeProbe(rawProbe({}), '/tmp/in.mp4', 30000000),
    tgtCpu, '/tmp/out.mp4', '/tmp/pass', NO_HW
);
assert.strictEqual(plan.passes.length, 2, 'target mode on CPU must use a real two-pass');

// --- 10-bit 源 → 硬件用 p010le ---
plan = Core.buildPlan(
    Core._internal.normalizeProbe(rawProbe({ pixFmt: 'yuv420p10le' }), '/tmp/in.mp4', 30000000),
    settings('h265'), '/tmp/out.mp4', '/tmp/pass', NV_HW
);
assert(containsPair(plan.passes[0], '-pix_fmt', 'p010le'), '10-bit source must use p010le on hardware');

// --- 没有 cuda 解码能力时不应硬加 -hwaccel ---
const nvNoDecode = { families: ['nvenc'], encoders: { hevc_nvenc: true }, decodeMethods: ['qsv'] };
plan = Core.buildPlan(
    Core._internal.normalizeProbe(rawProbe({}), '/tmp/in.mp4', 30000000),
    settings('h265'), '/tmp/out.mp4', '/tmp/pass', nvNoDecode
);
assert(indexOfFlag(plan.passes[0], '-hwaccel') === -1, 'do not request -hwaccel if the method is unavailable');

// ===========================================================================
// 4. parseEncoderNames —— 探测输出解析
// ===========================================================================
const encText = [
    'Encoders:',
    ' V..... libx265              x265 H.265/HEVC encoder',
    ' V..... hevc_nvenc           NVIDIA NVENC H.265 encoder',
    ' V..... h264_nvenc           NVIDIA NVENC H.264 encoder',
    ' V..... av1_nvenc            NVIDIA NVENC AV1 encoder',
    ' A..... aac                  AAC encoder'
].join('\n');
const parsed = Core._internal.parseEncoderNames(encText);
assert.strictEqual(parsed.hevc_nvenc, true, 'hevc_nvenc must be parsed');
assert.strictEqual(parsed.h264_nvenc, true, 'h264_nvenc must be parsed');
assert.strictEqual(parsed.av1_nvenc, true, 'av1_nvenc must be parsed');
assert.strictEqual(typeof parsed, 'object', 'parseEncoderNames returns a map of all encoders');

// detectHardware 在拿到这份编码器表后，会按 CODECS[id].hw[fam].encoder 过滤，
// 只留下「有硬件实现的家族」。这里用同样的过滤逻辑验证一次：
const families = Core._internal.HW_FAMILY_ORDER.filter(function (fam) {
    return Object.keys(Core.CODECS).some(function (id) {
        const hw = Core.CODECS[id].hw;
        return !!(hw && hw[fam] && parsed[hw[fam].encoder]);
    });
});
assert.deepStrictEqual(families, ['nvenc'], 'only families with a real hw encoder survive detection');

// ===========================================================================
// 5. recommendedWorkerCount —— 硬件并发收敛
// ===========================================================================
// 高并发 + 多任务 + 16 核，硬件编码应被收敛到 HW_MAX_WORKERS(2)
let wc = Core._internal.recommendedWorkerCount(
    (function () { const s = settings('h265'); s.concurrency = 4; return s; })(),
    16, 10, 'nvenc'
);
assert.strictEqual(wc, Core.HW_MAX_WORKERS, 'hardware worker count must be capped at HW_MAX_WORKERS');

// 同样条件但走 CPU：不收敛，取 4
wc = Core._internal.recommendedWorkerCount(
    (function () { const s = settings('h265'); s.concurrency = 4; return s; })(),
    16, 10, 'cpu'
);
assert.strictEqual(wc, 4, 'CPU worker count must not be capped by HW_MAX_WORKERS');

// 用户选 1 时，硬件也不能被抬高
wc = Core._internal.recommendedWorkerCount(
    (function () { const s = settings('h265'); s.concurrency = 1; return s; })(),
    16, 10, 'nvenc'
);
assert.strictEqual(wc, 1, 'user concurrency 1 must never be raised');

console.log('PASS hardware acceleration core logic');
