/**
 * HEVC 在 Apple 生态下的容器兼容性回归。
 *
 * 起因是真实故障：H.265 压出来的 MP4 在 Eagle 里能播，在 macOS Finder /
 * Quick Look / QuickTime 里却打不开。根因是 FFmpeg 默认写 hev1 sample entry，
 * 而 Apple 的解码器要求 hvc1。
 *
 * 这里不做真实编码，只检查 buildPlan 生成的参数——参数错了产物必然错，
 * 而参数检查足够快，可以每次改动都跑。
 */
const assert = require('assert');
const path = require('path');
const Core = require(path.join(__dirname, '..', 'js', 'ffmpeg.js'));

function meta(filePath, videoCodec) {
    return {
        path: filePath,
        duration: 12,
        audio: { bitrate: 128000 },
        video: {
            width: 3840,
            height: 2160,
            fps: 30,
            bitDepth: 8,
            bitrate: 12000000,
            codec: videoCodec || 'h264'
        }
    };
}

function settings(codec) {
    return {
        codec: codec,
        mode: 'crf',
        crf: 28,
        speedIndex: 2,
        resolution: 'source',
        fps: 'source',
        audioMode: 'aac',
        audioBitrate: 128,
        concurrency: 1
    };
}

function containsPair(args, flag, value) {
    return args.some(function (arg, index) {
        return arg === flag && args[index + 1] === value;
    });
}

// 第一条 pass 就是最终产物那次编码（或单遍模式下唯一一次编码）。
function firstPass(plan) {
    return plan.passes[0];
}

// ---- H.265 重编码：必须打 hvc1，否则 Apple 侧解不了 ----
['.mp4', '.mov'].forEach(function (ext) {
    const plan = Core.buildPlan(
        meta('/tmp/input' + ext), settings('h265'), '/tmp/output' + ext, '/tmp/pass'
    );
    assert(
        containsPair(firstPass(plan), '-tag:v', 'hvc1'),
        'H.265 output in ' + ext + ' must use the hvc1 sample entry so Finder / Quick Look can decode it'
    );
});

// ---- H.264：绝不能套 HEVC 标签，否则 mp4 muxer 直接写头失败 ----
['.mp4', '.mov'].forEach(function (ext) {
    const plan = Core.buildPlan(
        meta('/tmp/input' + ext, 'h264'), settings('h264'), '/tmp/output' + ext, '/tmp/pass'
    );
    assert(
        !containsPair(firstPass(plan), '-tag:v', 'hvc1'),
        'H.264 output in ' + ext + ' must not receive an HEVC-only hvc1 tag'
    );
});

// ---- 复制视频流：源是 HEVC 就得修标签，否则坏文件会被原样复制出来 ----
const copyHevc = Core.buildPlan(
    meta('/tmp/input.mp4', 'hevc'), settings('copy'), '/tmp/output.mp4', '/tmp/pass'
);
assert(
    containsPair(firstPass(copyHevc), '-tag:v', 'hvc1'),
    'Copying an HEVC stream into MP4 must normalise the tag to hvc1'
);

// ---- 复制视频流：源是 H.264 时打 hvc1 会让整个任务报废 ----
const copyH264 = Core.buildPlan(
    meta('/tmp/input.mp4', 'h264'), settings('copy'), '/tmp/output.mp4', '/tmp/pass'
);
assert(
    !containsPair(firstPass(copyH264), '-tag:v', 'hvc1'),
    'Copying an H.264 stream must not receive an HEVC-only hvc1 tag'
);

// ---- MKV / WebM 不走 QuickTime sample entry，加了反而是错的 ----
['.mkv', '.webm'].forEach(function (ext) {
    const codec = ext === '.webm' ? 'vp9' : 'h265';
    const plan = Core.buildPlan(
        meta('/tmp/input' + ext, codec === 'h265' ? 'hevc' : 'vp9'),
        settings(codec), '/tmp/output' + ext, '/tmp/pass'
    );
    assert(
        !containsPair(firstPass(plan), '-tag:v', 'hvc1'),
        ext + ' must not receive a QuickTime-specific hvc1 tag'
    );
});

console.log('PASS HEVC Apple compatibility: hvc1 applied only to HEVC streams in QuickTime containers');
