/**
 * 用例分片：CPU / 并发资源预算。
 *
 * 这一片全是纯函数，跑得最快，也最容易被「顺手改一下」弄坏 —— 所以除了待修的项，
 * 这里也锁了一批当前正确但语义微妙的行为（用户上限优先、任务数封顶、硬件收敛）。
 * 修 P1-06（线程真的能限住）之前不要动这里的 xfail，否则放开 worker 只会让
 * 多个 x265 进程各自吃满全部核心。
 */
'use strict';

const assert = require('assert');
const H = require('./helpers');

const cases = [];
function add(c) { cases.push(c); }

/** 取一份带内部函数的核心模块。 */
function core() { return H.loadCore(); }

// ---------------------------------------------------------------------------
// 线程预算
// ---------------------------------------------------------------------------

add({
    id: 'P1-08',
    title: '单 worker 跑 x265 / AV1 时线程上限不该卡在 8',
    area: 'budget',
    level: 'P1',
    status: 'implemented',
    issue: 'recommendedThreadCount 无条件 Math.min(8, ...)。对 x264 有道理（>16 线程收益递减且伤画质），' +
           '但在 16 / 24 核机器上跑单个 4K x265 任务时直接砍掉一半以上算力。',
    contract: '按编码器分档：x264 上限 16；x265 / AV1 不设硬上限（或 cores-1）',
    ref: 'js/ffmpeg.js recommendedThreadCount',
    run: function () {
        const t = core()._internal.recommendedThreadCount(16, 1, 'h265');
        assert(t >= 15, '16 核机器上单 worker 跑 x265 至少应拿到 15 线程，实际只有 ' + t +
            '（8 这个上限是为 x264 定的）');
    }
});

add({
    id: 'P1-08b',
    title: 'x264 的线程上限保持在 16 以内',
    area: 'budget',
    level: 'P1',
    status: 'implemented',
    issue: 'P1-08 放开上限时最容易写成「一律 cores-1」。x264 超过 16 线程后收益递减、且会轻微伤画质，' +
           '这条把 x264 那一侧钉住。',
    contract: 'x264 的线程上限 ≤ 16',
    ref: 'js/ffmpeg.js recommendedThreadCount',
    run: function () {
        const t = core()._internal.recommendedThreadCount(64, 1, 'h264');
        assert(t <= 16, 'x264 超过 16 线程收益递减且伤画质，实际给了 ' + t);
        assert(t >= 1, '至少要 1 个线程');
    }
});

add({
    id: 'LOCK-02',
    title: '多 worker 时线程按核心数均分，且至少 1',
    area: 'budget',
    level: 'P1',
    status: 'implemented',
    issue: '整套并发设计的前提：worker 数 × 每 worker 线程数 ≈ 核心数 - 1（留一个给 Eagle / UI）。',
    contract: 'recommendedThreadCount(cores, workers) ≈ floor((cores-1)/workers)，下限 1',
    ref: 'js/ffmpeg.js recommendedThreadCount',
    run: function () {
        const f = core()._internal.recommendedThreadCount;
        assert.strictEqual(f(8, 4), 1, '8 核 / 4 worker → 每 worker 1 线程（floor(7/4)=1）');
        assert.strictEqual(f(4, 1), 3, '4 核 / 1 worker → 3 线程（留一个核给 UI）');
        assert.strictEqual(f(1, 4), 1, '单核机器上再怎么分也至少 1 线程，不能算出 0');
        assert.strictEqual(f(9, 2), 4, '9 核 / 2 worker → floor(8/2)=4');
    }
});

// ---------------------------------------------------------------------------
// worker 预算
// ---------------------------------------------------------------------------

add({
    id: 'P1-09',
    title: 'AV1 在小分辨率 + 多核时应允许 2~3 路并发',
    area: 'budget',
    level: 'P1',
    status: 'implemented',
    issue: 'recommendedWorkerCount 对 av1 一律 cap=1。SVT-AV1 在低分辨率上的内部并行扩展性很差，' +
           '32 核机器压 20 个 720p 片段时单进程会闲置大量核心。',
    contract: 'AV1 且源高度 < 1080 且核数 ≥ 12 → 允许 2~3 路（4K 仍保持 1）',
    ref: 'js/ffmpeg.js recommendedWorkerCount',
    run: function () {
        const small = H.meta({ width: 1280, height: 720 });
        const w = core()._internal.recommendedWorkerCount(
            { codec: 'av1', mode: 'crf', concurrency: 4 }, 16, 20, 'cpu', small);
        assert(w >= 2, '16 核压 720p 的 AV1 至少该开 2 路，实际只有 ' + w);
    }
});

add({
    id: 'P1-09b',
    title: '两遍编码（目标大小模式）保持单 worker',
    area: 'budget',
    level: 'P1',
    status: 'implemented',
    issue: '这一条是「当前正确但容易被误改」：两遍编码每个 worker 要维护一份 passlog，' +
           '两遍之间还有顺序依赖，并发收益远小于内存与精度代价。',
    contract: 'mode === "target" 时 worker 数恒为 1',
    ref: 'js/ffmpeg.js recommendedWorkerCount',
    run: function () {
        const w = core()._internal.recommendedWorkerCount(
            { codec: 'h265', mode: 'target', concurrency: 4 }, 16, 20, 'cpu');
        assert.strictEqual(w, 1, '两遍编码并发收益小、passlog 与内存开销大，应保持单 worker');
    }
});

add({
    id: 'LOCK-03',
    title: '用户设定的并发数是硬上限，永远不会被抬高',
    area: 'budget',
    level: 'P1',
    status: 'implemented',
    issue: '用户选 1 就是 1。曾经这里出过「用户选 1、实际跑了 4 个」的问题，界面上完全看不出来。',
    contract: 'recommendedWorkerCount ≤ settings.concurrency',
    ref: 'js/ffmpeg.js recommendedWorkerCount',
    run: function () {
        const f = core()._internal.recommendedWorkerCount;
        assert.strictEqual(f({ codec: 'h265', mode: 'crf', concurrency: 1 }, 32, 20, 'cpu'), 1,
            '用户选 1 时必须只跑 1 个');
        assert.strictEqual(f({ codec: 'h265', mode: 'crf', concurrency: 2 }, 32, 20, 'cpu'), 2,
            '用户选 2 时必须只跑 2 个');
    }
});

add({
    id: 'LOCK-04',
    title: 'worker 数不超过待处理任务数',
    area: 'budget',
    level: 'P1',
    status: 'implemented',
    issue: '3 个文件开 4 个 worker，最后一个会立刻空转退出；更隐蔽的是它会让 ' +
           '「每 worker 线程数」按 4 来分，实际每个 worker 拿到的线程比预期少。',
    contract: 'recommendedWorkerCount ≤ taskCount',
    ref: 'js/ffmpeg.js recommendedWorkerCount',
    run: function () {
        const w = core()._internal.recommendedWorkerCount(
            { codec: 'h265', mode: 'crf', concurrency: 4 }, 16, 2, 'cpu');
        assert.strictEqual(w, 2, '只有 2 个任务时不该起 4 个 worker');
    }
});

add({
    id: 'LOCK-05',
    title: '硬件编码的并发收敛到 HW_MAX_WORKERS',
    area: 'budget',
    level: 'P1',
    status: 'implemented',
    issue: '实测（RTX 4070 Ti SUPER，1080p30）：1 路 2838ms，2 路 3057ms，3 路 3838ms，8 路 8220ms —— ' +
           '三路之后再加并发几乎换不到吞吐，只是把每路都拖慢。',
    contract: '硬件编码时 worker ≤ HW_MAX_WORKERS（2）',
    ref: 'js/ffmpeg.js recommendedWorkerCount / HW_MAX_WORKERS',
    run: function () {
        const w = core()._internal.recommendedWorkerCount(
            { codec: 'h265', mode: 'crf', concurrency: 4 }, 16, 20, 'nvenc');
        assert.strictEqual(w, 2, 'GPU 吞吐不随进程数线性增长，应收敛到 ' + 2 + ' 路，实际 ' + w);
    }
});

add({
    id: 'P2-02',
    title: '并发上限 4 在 24 核以上机器偏保守',
    area: 'budget',
    level: 'P2',
    status: 'implemented',
    issue: 'requested = Math.min(4, concurrency)，UI 选项也只到 4。压一堆 720p 小片时，' +
           '24 核机器上 4 路通常还没打满。',
    contract: '核数 ≥ 24 时允许并发到 8（需配合 P1-06 的真实限流一起改）',
    ref: 'js/ffmpeg.js recommendedWorkerCount',
    run: function () {
        const w = core()._internal.recommendedWorkerCount(
            { codec: 'h265', mode: 'crf', concurrency: 8 }, 32, 40, 'cpu');
        assert(w >= 8, '32 核机器压 40 个文件时用户选 8 路就该跑 8 路，实际 ' + w);
    }
});

module.exports = cases;
