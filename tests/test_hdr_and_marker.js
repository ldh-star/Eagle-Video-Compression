/**
 * HDR 识别与「已压缩」标记的回归测试。
 *
 * 两个需求都来自真实使用场景，也都有实测踩出来的坑：
 *
 * 1. HDR 不能只信 color_transfer。实测 HLG 样本里 transfer 压根没写进容器，
 *    只留了 color_space=bt2020nc —— 单字段判定会整片漏判，必须多条件兜底。
 *
 * 2. 压缩标记在 MP4/MOV 里必须配合 -movflags +use_metadata_tags，
 *    否则 muxer 会「静默丢弃」不认识的 key：ffmpeg 退出码是 0，文件也生成了，
 *    标记却不在。这类"看起来成功"的失败正是最该被测试钉死的。
 *    另外 MKV/WebM 会把 key 大写，读取必须忽略大小写。
 *    AVI / TS 容器根本不支持任意 metadata，写不进去，不能假装成功。
 */
const assert = require('assert');
const path = require('path');
const Core = require(path.join(__dirname, '..', 'js', 'ffmpeg.js'));

// ---------------------------------------------------------------------------
// 构造 ffprobe 原始输出
// ---------------------------------------------------------------------------
function rawProbe(opts) {
    opts = opts || {};
    const video = {
        codec_type: 'video',
        codec_name: opts.codec || 'hevc',
        width: 3840,
        height: 2160,
        avg_frame_rate: '30/1',
        pix_fmt: opts.pixFmt || 'yuv420p10le',
        bit_rate: '12000000'
    };
    if (opts.transfer) video.color_transfer = opts.transfer;
    if (opts.primaries) video.color_primaries = opts.primaries;
    if (opts.space) video.color_space = opts.space;
    if (opts.sideData) video.side_data_list = opts.sideData;

    return {
        format: {
            format_name: 'mov,mp4',
            duration: '12.000000',
            size: '18000000',
            bit_rate: '12000000',
            tags: opts.tags || {}
        },
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
        writeCompressionMarker: true
    };
}

function containsPair(args, flag, value) {
    return args.some(function (arg, index) {
        return arg === flag && args[index + 1] === value;
    });
}

function markerValue(args) {
    const i = args.indexOf('-metadata');
    if (i === -1) return null;
    const v = args[i + 1] || '';
    return v.indexOf(Core._internal.MARKER_KEY + '=') === 0 ? v.slice(Core._internal.MARKER_KEY.length + 1) : null;
}

// ===========================================================================
// HDR 识别
// ===========================================================================

// PQ / SMPTE ST 2084 → HDR10
let m = Core._internal.normalizeProbe(rawProbe({
    transfer: 'smpte2084', primaries: 'bt2020', space: 'bt2020nc'
}), '/tmp/a.mp4', 18000000);
assert.strictEqual(m.video.hdr.isHdr, true, 'PQ transfer must be recognised as HDR');
assert.strictEqual(m.video.hdr.kind, 'hdr10', 'PQ transfer must be classified as HDR10');

// HLG / ARIB STD-B67 → HLG
m = Core._internal.normalizeProbe(rawProbe({
    transfer: 'arib-std-b67', primaries: 'bt2020', space: 'bt2020nc'
}), '/tmp/hlg.mp4', 18000000);
assert.strictEqual(m.video.hdr.isHdr, true, 'HLG transfer must be recognised as HDR');
assert.strictEqual(m.video.hdr.kind, 'hlg', 'HLG transfer must be classified as hlg');

// 杜比视界：即使 transfer 缺失，side_data 也该认出来
m = Core._internal.normalizeProbe(rawProbe({
    sideData: [{ side_data_type: 'DOVI configuration record' }]
}), '/tmp/dv.mp4', 18000000);
assert.strictEqual(m.video.hdr.isHdr, true, 'Dolby Vision side data must be recognised as HDR');
assert.strictEqual(m.video.hdr.kind, 'dolbyVision', 'Dolby Vision must be classified as dolbyVision');

// HDR10+
m = Core._internal.normalizeProbe(rawProbe({
    transfer: 'smpte2084',
    sideData: [{ side_data_type: 'HDR Dynamic Metadata SMPTE2094-40 (HDR10+)' }]
}), '/tmp/hdr10plus.mp4', 18000000);
assert.strictEqual(m.video.hdr.hdr10Plus, true, 'HDR10+ dynamic metadata must be flagged');

// 关键兜底：transfer 没写进容器（实测 HLG 就是这种情况），
// 只凭 BT.2020 + 10-bit 也要认出是 HDR，不能漏判。
m = Core._internal.normalizeProbe(rawProbe({
    space: 'bt2020nc', pixFmt: 'yuv420p10le'
}), '/tmp/containerless.mp4', 18000000);
assert.strictEqual(
    m.video.hdr.isHdr, true,
    'BT.2020 + 10-bit without a container transfer must still be recognised as HDR'
);
assert.strictEqual(m.video.hdr.kind, 'hdr', 'Container-metadata-less HDR must fall back to generic hdr');

// 普通 SDR：绝不能误报
m = Core._internal.normalizeProbe(rawProbe({
    transfer: 'bt709', primaries: 'bt709', space: 'bt709', pixFmt: 'yuv420p'
}), '/tmp/sdr.mp4', 18000000);
assert.strictEqual(m.video.hdr.isHdr, false, 'BT.709 SDR must not be reported as HDR');

// 完全没有色彩信息：也要稳住不崩、不误报
m = Core._internal.normalizeProbe(rawProbe({ pixFmt: 'yuv420p' }), '/tmp/bare.mp4', 18000000);
assert.strictEqual(m.video.hdr.isHdr, false, 'A stream without colour metadata must not be reported as HDR');

// 8-bit 的 BT.2020 不算 HDR（HDR 实际都要 10-bit 以上）
m = Core._internal.normalizeProbe(rawProbe({
    space: 'bt2020nc', pixFmt: 'yuv420p'
}), '/tmp/bt2020-8bit.mp4', 18000000);
assert.strictEqual(m.video.hdr.isHdr, false, '8-bit BT.2020 must not be reported as HDR');

// ===========================================================================
// 压缩标记解析
// ===========================================================================

let parsed = Core.parseCompressionMarker({ EagleVideoCompress: 'v1;codec=h265;mode=crf;date=2026-09-06;count=2' });
assert.strictEqual(parsed.compressed, true, 'A well-formed marker must be recognised');
assert.strictEqual(parsed.count, 2, 'Compression count must be parsed');
assert.strictEqual(parsed.date, '2026-09-06', 'Compression date must be parsed');
assert.strictEqual(parsed.codec, 'h265', 'Compression codec must be parsed');

// MKV/WebM 会把 key 大写 —— 必须忽略大小写，否则 MKV 上的标记等于白写
parsed = Core.parseCompressionMarker({ EAGLEVIDEOCOMPRESS: 'v1;codec=h265;date=2026-09-06;count=1' });
assert.strictEqual(parsed.compressed, true, 'Matroska upper-cases tag keys; lookup must be case-insensitive');

// 无关 tag 不能误判
assert.strictEqual(
    Core.parseCompressionMarker({ title: 'EagleVideoCompress=v1;count=1' }).compressed, false,
    'An unrelated tag must not be mistaken for the compression marker'
);
assert.strictEqual(Core.parseCompressionMarker({}).compressed, false, 'Empty tags must not be a marker');
assert.strictEqual(Core.parseCompressionMarker(null).compressed, false, 'Null tags must not throw');
assert.strictEqual(
    Core.parseCompressionMarker({ EagleVideoCompress: 'garbage' }).compressed, false,
    'A malformed marker must be rejected instead of mis-parsed'
);
assert.strictEqual(
    Core.parseCompressionMarker({ EagleVideoCompress: 'v99;count=1' }).compressed, false,
    'An unknown marker schema version must be rejected'
);

// ===========================================================================
// 压缩标记写入
// ===========================================================================

// MP4 必须同时带 -movflags +use_metadata_tags，否则标记被静默丢弃
let plan = Core.buildPlan(
    Core._internal.normalizeProbe(rawProbe({ transfer: 'bt709', pixFmt: 'yuv420p' }), '/tmp/in.mp4', 18000000),
    settings('h265'), '/tmp/out.mp4', '/tmp/pass'
);
assert(
    containsPair(plan.passes[0], '-movflags', '+use_metadata_tags'),
    'MP4 needs +use_metadata_tags or the muxer silently drops the custom marker'
);
assert(markerValue(plan.passes[0]), 'MP4 output must carry the compression marker');

// 二次压缩：次数必须累加，日期更新
const already = Core._internal.normalizeProbe(rawProbe({
    transfer: 'bt709', pixFmt: 'yuv420p',
    tags: { EagleVideoCompress: 'v1;codec=h265;mode=crf;date=2026-09-06;count=2' }
}), '/tmp/in2.mp4', 18000000);
assert.strictEqual(already.compression.compressed, true, 'Probe must surface an existing compression marker');
assert.strictEqual(already.compression.count, 2, 'Probe must surface the existing compression count');

plan = Core.buildPlan(already, settings('h265'), '/tmp/out2.mp4', '/tmp/pass');
let value = markerValue(plan.passes[0]);
assert(value, 'Re-compression must write a marker');
assert.strictEqual(
    Core.parseCompressionMarker({ EagleVideoCompress: value }).count, 3,
    'Re-compressing an already-compressed file must increment the count'
);

// 关闭开关后绝不写标记
const off = settings('h265');
off.writeCompressionMarker = false;
plan = Core.buildPlan(
    Core._internal.normalizeProbe(rawProbe({ transfer: 'bt709', pixFmt: 'yuv420p' }), '/tmp/in.mp4', 18000000),
    off, '/tmp/out.mp4', '/tmp/pass'
);
assert.strictEqual(markerValue(plan.passes[0]), null, 'Disabling the setting must suppress the marker entirely');
assert(
    !containsPair(plan.passes[0], '-movflags', '+use_metadata_tags'),
    'Disabling the marker must not leave the movflags behind'
);

// MKV 原生支持任意 tag，不需要 movflags
plan = Core.buildPlan(
    Core._internal.normalizeProbe(rawProbe({ transfer: 'bt709', pixFmt: 'yuv420p' }), '/tmp/in.mkv', 18000000),
    settings('h265'), '/tmp/out.mkv', '/tmp/pass'
);
assert(markerValue(plan.passes[0]), 'MKV must carry the marker');
assert(
    !containsPair(plan.passes[0], '-movflags', '+use_metadata_tags'),
    'MKV stores tags natively and must not receive QuickTime movflags'
);

// AVI / TS 容器不支持任意 metadata，写了也白写 —— 宁可不写，也别假装成功
['.avi', '.ts'].forEach(function (ext) {
    const p = Core.buildPlan(
        Core._internal.normalizeProbe(rawProbe({ transfer: 'bt709', pixFmt: 'yuv420p' }), '/tmp/in' + ext, 18000000),
        settings('h265'), '/tmp/out' + ext, '/tmp/pass'
    );
    assert.strictEqual(
        markerValue(p.passes[0]), null,
        ext + ' cannot store arbitrary metadata; the plugin must not pretend it did'
    );
});

// 标记不能破坏 hvc1 修复（上次 hev1 的教训）
plan = Core.buildPlan(
    Core._internal.normalizeProbe(rawProbe({ transfer: 'smpte2084', pixFmt: 'yuv420p10le' }), '/tmp/hdr.mp4', 18000000),
    settings('h265'), '/tmp/out.mp4', '/tmp/pass'
);
assert(
    containsPair(plan.passes[0], '-tag:v', 'hvc1'),
    'The compression marker must not regress the hvc1 Apple compatibility fix'
);

// 两遍编码：标记只能落在最终产物那次，不能污染第一遍
const twoPass = settings('h265');
twoPass.mode = 'target';
twoPass.targetSizeMB = 50;
plan = Core.buildPlan(
    Core._internal.normalizeProbe(rawProbe({ transfer: 'bt709', pixFmt: 'yuv420p' }), '/tmp/in.mp4', 18000000),
    twoPass, '/tmp/out.mp4', '/tmp/pass'
);
assert.strictEqual(plan.passes.length, 2, 'Target-size mode must use two passes');
assert(markerValue(plan.passes[1]), 'The final pass must carry the marker');
assert.strictEqual(markerValue(plan.passes[0]), null, 'The analysis pass must not carry the marker');

// ===========================================================================
// HDR 破坏风险
// ===========================================================================

const hdrMeta = Core._internal.normalizeProbe(rawProbe({
    transfer: 'smpte2084', primaries: 'bt2020', space: 'bt2020nc', pixFmt: 'yuv420p10le'
}), '/tmp/hdr.mp4', 18000000);

// H.264 写死 tenBit:false，会把 HDR 源降到 8-bit —— 必须给出警告
let risk = Core.hdrRisk(hdrMeta, settings('h264'));
assert.strictEqual(risk.atRisk, true, 'Encoding HDR to H.264 strips HDR and must be reported');

// H.265 支持 10-bit，HDR 保得住
risk = Core.hdrRisk(hdrMeta, settings('h265'));
assert.strictEqual(risk.atRisk, false, 'H.265 keeps 10-bit and must not be reported as risky');

// 复制视频流不会动像素格式，HDR 不受影响
risk = Core.hdrRisk(hdrMeta, settings('copy'));
assert.strictEqual(risk.atRisk, false, 'Remuxing must not be reported as an HDR risk');

// 非 HDR 源没有任何风险
risk = Core.hdrRisk(
    Core._internal.normalizeProbe(rawProbe({ transfer: 'bt709', pixFmt: 'yuv420p' }), '/tmp/sdr.mp4', 18000000),
    settings('h264')
);
assert.strictEqual(risk.atRisk, false, 'An SDR source must never be reported as an HDR risk');

// HDR 源编码时应显式带上色彩参数，作为元数据只在容器里时的保险。
// 注意选项名：ffmpeg 只认 -color_trc / -colorspace，
// -color_transfer / -color_space 是不存在的选项，实测会直接报
// "Unrecognized option" 让整个任务失败。这里不接受后者。
plan = Core.buildPlan(hdrMeta, settings('h265'), '/tmp/out.mp4', '/tmp/pass');
assert(
    containsPair(plan.passes[0], '-color_trc', 'smpte2084'),
    'HDR output must pin the transfer characteristics with -color_trc'
);
assert(
    containsPair(plan.passes[0], '-colorspace', 'bt2020nc'),
    'HDR output must pin the colour space with -colorspace'
);
assert(
    !plan.passes[0].some(function (a) { return a === '-color_transfer' || a === '-color_space'; }),
    '-color_transfer / -color_space do not exist in ffmpeg and would abort the encode'
);

console.log('PASS HDR detection and compression marker');
