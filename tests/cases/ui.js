/**
 * 用例分片：界面渲染与导入期性能。
 *
 * 这一片测的是「O(N²)」这类论断。它们不写在注释里而是写成数字上限，
 * 因为注释不会在有人改坏的时候失败，断言会。
 *
 * 全部需要 jsdom：app.js 一上来就摸 document。
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const H = require('./helpers');
const Env = require('./env');

const cases = [];
function add(c) { cases.push(c); }

function makeTask(i) {
    const p = '/tmp/eagle-vc-ui-' + i + '.mp4';
    return {
        id: 't' + i,
        path: p,
        name: path.basename(p),
        ext: '.mp4',
        meta: Env.probeMeta(p),
        status: 'queued',
        progress: 0,
        liveInfo: ''
    };
}

function pushTasks(app, n) {
    const list = [];
    for (let i = 0; i < n; i++) list.push(makeTask(i));
    app.win.App._state.tasks.length = 0;
    list.forEach(function (t) { app.win.App._state.tasks.push(t); });
    app.win.App._internal.renderList();
    return list;
}

// ---------------------------------------------------------------------------
// 渲染：增量更新
// ---------------------------------------------------------------------------

add({
    id: 'P1-14',
    title: '刷新列表时必须复用已有行，不能整表重建',
    area: 'ui',
    level: 'P1',
    status: 'implemented',
    issue: 'renderList 一上来就 dom.fileList.innerHTML = \'\'，然后逐条 buildTaskEl。' +
           '每次追加素材都会把已经渲染好的几十行全部丢弃重建：DOM 节点、事件监听、' +
           '滚动位置和文本选区全丢，卡顿时用户能看到列表整体闪一下。',
    contract: '已存在任务的行必须复用（同一 DOM 节点），只追加新增行、移除已删行',
    ref: 'js/app.js renderList',
    run: async function () {
        const app = await Env.makeApp();
        try {
            pushTasks(app, 3);
            const before = app.win.document.querySelector('[data-id="t1"]');
            assert(before, 'renderList 之后应该能按 data-id 找到任务行');

            app.win.App._internal.renderList();
            const after = app.win.document.querySelector('[data-id="t1"]');

            assert.strictEqual(after, before,
                'renderList 重建了整个列表：t1 的行已经不是同一个 DOM 节点了');
        } finally {
            app.close();
        }
    }
});

add({
    id: 'P1-15',
    title: '进度更新时只改动变化的部分，不重建整行子树',
    area: 'ui',
    level: 'P1',
    status: 'implemented',
    issue: 'renderTask 每次都重算 meta / result 的 innerHTML。FFmpeg 的进度事件每秒来好几次，' +
           '于是每行每秒被重建好几次——而绝大多数时候 meta（体积/时长/分辨率/编码）根本没变。' +
           '叠加 P1-14 之后，编码过程中的 UI 开销和视频数量、码率都成正比。',
    contract: '元信息未变化时不得重建 view.meta / view.result 的子树（按内容 diff，或只在字段变化时更新）',
    ref: 'js/app.js renderTask',
    run: async function () {
        const app = await Env.makeApp();
        try {
            const list = pushTasks(app, 1);
            const t = list[0];
            const metaNode = t.view.meta;
            const firstChild = metaNode.firstChild;
            assert(firstChild, '任务行应该已经渲染出元信息');

            // 最典型的重绘触发：进度变了，元信息没变
            t.progress = 42;
            t.liveInfo = 'speed=1.2x';
            app.win.App._internal.renderTask(t);

            assert.strictEqual(t.view.meta.firstChild, firstChild,
                '进度更新不该重建元信息子树：meta 的第一个子节点都换掉了');
        } finally {
            app.close();
        }
    }
});

// ---------------------------------------------------------------------------
// 渲染：复杂度
// ---------------------------------------------------------------------------

add({
    id: 'P1-16',
    title: 'renderSummary 一次调用对任务表的扫描应该是 O(N) 而不是常数倍 O(N)',
    area: 'ui',
    level: 'P1',
    status: 'implemented',
    issue: 'renderSummary 里连续做了三次全表 filter（done / pending / ready），末尾 updateButtons ' +
           '又用 some 再扫一遍。实测 100 个任务 = 301 次元素访问。' +
           '它在每个任务探测完成、每次进度变化后都会被调用，这个常数会被外面的调用频率乘上去。',
    contract: '一次 renderSummary 对任务表的元素访问次数 ≤ 2N（合并成一次遍历即可）',
    ref: 'js/app.js renderSummary',
    run: async function () {
        const app = await Env.makeApp();
        try {
            const N = 100;
            const list = pushTasks(app, N);
            const counted = H.countingArray(list);
            app.win.App._state.tasks = counted.proxy;

            app.win.App._internal.renderSummary();

            const limit = 2 * N;
            assert(counted.stats.visits <= limit,
                'renderSummary 扫了任务表 ' + counted.stats.visits + ' 次（' + N + ' 个任务），' +
                '超过 ' + limit + ' 次上限 —— 存在多余的全表遍历');
        } finally {
            app.close();
        }
    }
});

add({
    id: 'NEW-01',
    title: '导入 N 个文件的总渲染开销必须与 N 成线性',
    area: 'ui',
    level: 'P1',
    status: 'implemented',
    issue: '这是首屏卡顿的主因，比单条 ffprobe 串行严重得多：probePendingTasks 每探测完一个文件，' +
           '就跑一遍 renderTask + renderSummary + updateButtons + refreshCodecUI + refreshEstimate，' +
           '而 refreshEstimate 自己又 forEach 全表两次并再调 renderSummary。' +
           '于是导入 N 个文件 = O(N²) 次渲染：30 个文件约 8000 次元素访问，' +
           '200 个文件就是 40 万量级，界面会彻底冻住。',
    contract: '导入 N 个文件的总元素访问次数 ≤ 50N；探测全部结束后统一刷新一次',
    ref: 'js/app.js probePendingTasks',
    run: async function () {
        const app = await Env.makeApp();
        try {
            const N = 25;
            const counted = H.countingArray([]);
            app.win.App._state.tasks = counted.proxy;

            for (let i = 0; i < N; i++) {
                app.selected.push(Env.eagleItem('/tmp/eagle-vc-import-' + i + '.mp4'));
            }
            app.win.App.onShow();
            await Env.wait(1500);

            assert.strictEqual(app.core.counts.probe, N,
                '前置条件：应当正好探测 ' + N + ' 个文件，实际 ' + app.core.counts.probe);

            const limit = 50 * N;
            assert(counted.stats.visits <= limit,
                '导入 ' + N + ' 个文件共扫了任务表 ' + counted.stats.visits + ' 次，' +
                '超过线性上限 ' + limit + '（约 ' + Math.round(counted.stats.visits / (N * N)) +
                '×N²）—— 每个文件探测完都在全表重绘');
        } finally {
            app.close();
        }
    }
});

// ---------------------------------------------------------------------------
// 探测并发
// ---------------------------------------------------------------------------

add({
    id: 'P1-13',
    title: '导入多个文件时 ffprobe 应该有并发，而不是严格串行',
    area: 'ui',
    level: 'P1',
    status: 'implemented',
    issue: 'probePendingTasks 用 chain = chain.then(...) 把探测串成一条链。注释写的是' +
           '「避免并发 ffprobe 抢占 CPU」，但 ffprobe 只读元数据、单次通常几十毫秒，' +
           '真正的时间是进程启动开销 —— 串行等于把 N 次启动开销逐个付一遍。' +
           '素材在机械盘或网络盘上时，串行还要多付 N 次寻道/往返。',
    contract: '探测阶段允许 2~4 路并发（小并发即可，不需要全开），并保证结果顺序回填',
    ref: 'js/app.js probePendingTasks',
    run: async function () {
        const app = await Env.makeApp();
        try {
            const N = 8;
            for (let i = 0; i < N; i++) {
                app.selected.push(Env.eagleItem('/tmp/eagle-vc-probe-' + i + '.mp4'));
            }
            app.win.App.onShow();
            await Env.wait(1500);

            assert.strictEqual(app.core.counts.probe, N,
                '前置条件：应当正好探测 ' + N + ' 个文件，实际 ' + app.core.counts.probe);
            assert(app.core.probeWatch.maxInflight >= 2,
                '探测是严格串行的（最大同时在飞 ' + app.core.probeWatch.maxInflight + '），' +
                '应允许 2~4 路并发以摊掉进程启动开销');
        } finally {
            app.close();
        }
    }
});

// ---------------------------------------------------------------------------
// 同步 IO
// ---------------------------------------------------------------------------

add({
    id: 'P1-17',
    title: 'sampleCacheKey 不得在主线程做同步 stat',
    area: 'ui',
    level: 'P1',
    status: 'implemented',
    issue: 'sampleCacheKey 里有一句 fs.statSync(t.path)。它在 scheduleSamplingEstimates 里' +
           '对每个任务各调一次，而后者在每次设置变动时都会重跑一遍。' +
           '备份/素材目录在 SMB、NFS 或没插的移动硬盘上时，一次 statSync 可能几十到几百毫秒，' +
           '渲染线程直接卡住，界面无响应。',
    contract: '不在渲染线程同步 stat：mtime 应在 probe 阶段一并取回，或用异步 stat 后更新 key',
    ref: 'js/app.js sampleCacheKey',
    run: async function () {
        const app = await Env.makeApp();
        const dir = H.tmpDir('eagle-vc-stat-');
        const spy = H.spy(fs, 'statSync');
        try {
            const p = path.join(dir, 'movie.mp4');
            fs.writeFileSync(p, 'x');
            const t = makeTask(0);
            t.path = p;

            const key = app.win.App._internal.sampleCacheKey(t);
            assert(key, 'sampleCacheKey 应该返回非空 key');
            assert.strictEqual(spy.count, 0,
                'sampleCacheKey 做了 ' + spy.count + ' 次同步 statSync，会卡住渲染线程');
        } finally {
            spy.restore();
            app.close();
        }
    }
});

// ---------------------------------------------------------------------------
// 锁定：基本渲染契约
// ---------------------------------------------------------------------------

add({
    id: 'LOCK-08',
    title: 'renderList 后每个任务都有独立可定位的行',
    area: 'ui',
    level: 'P1',
    status: 'implemented',
    issue: 'data-id 是「按任务增量更新」的唯一抓手。P1-14 / P1-15 改成增量渲染时，' +
           '最容易顺手把 data-id 去掉或者改成下标 —— 那样一旦有任务被移除，后续更新就会错位。',
    contract: '每行带 data-id，且等于任务 id',
    ref: 'js/app.js buildTaskEl',
    run: async function () {
        const app = await Env.makeApp();
        try {
            const list = pushTasks(app, 4);
            list.forEach(function (t) {
                const row = app.win.document.querySelector('[data-id="' + t.id + '"]');
                assert(row, '任务 ' + t.id + ' 应该有自己的行');
                assert.strictEqual(row.querySelector('.task-name').textContent, t.name,
                    '行内应显示文件名');
            });
            const rows = app.win.document.querySelectorAll('#fileList .task');
            assert.strictEqual(rows.length, 4, '应有且仅有 4 行');
        } finally {
            app.close();
        }
    }
});

module.exports = cases;
