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

// ---------------------------------------------------------------------------
// 队列清理：移除已压缩条目
// ---------------------------------------------------------------------------

/**
 * 造一条指定状态的任务。
 *
 * @param {string} id
 * @param {string} status
 * @param {boolean} [compressed] 探测到的文件里是否已有本插件的压缩标记
 */
function taskWith(id, status, compressed) {
    const t = makeTask(0);
    t.id = id;
    t.status = status;
    if (compressed) {
        t.meta.compression = {
            compressed: true, version: 1, count: 1, date: '', codec: 'h265', mode: 'crf'
        };
    }
    return t;
}

add({
    id: 'NEW-02',
    title: '「移除已压缩」只清掉压过的条目，没压过的和失败的必须留下',
    area: 'ui',
    level: 'P1',
    status: 'implemented',
    issue: '这个按钮和「清空列表」并排，最容易做错成「按状态过滤时把 error 也一起清了」。' +
           '失败条目清掉等于把一个可重试的入口直接抹掉；而没压过的条目被清掉，' +
           '用户就得重新去 Eagle 里选一遍素材。',
    contract: '移除 done / skipped / 探测到压缩标记的条目；queued、error、cancelled 一律保留',
    ref: 'js/app.js removeCompressedTasks',
    run: async function () {
        const app = await Env.makeApp();
        try {
            const st = app.win.App._state;
            st.tasks.length = 0;
            [
                taskWith('done1', 'done'),
                taskWith('skipped1', 'skipped'),
                taskWith('marked1', 'queued', true),
                taskWith('fresh1', 'queued'),
                taskWith('error1', 'error'),
                taskWith('cancel1', 'cancelled')
            ].forEach(function (t) { st.tasks.push(t); });
            app.win.App._internal.renderList();

            app.win.App._internal.removeCompressedTasks();

            const ids = st.tasks.map(function (t) { return t.id; });
            assert(!ids.includes('done1'), '本轮已完成的条目应该被移除');
            assert(!ids.includes('skipped1'), '已跳过（产物不值得替换）的条目应该被移除');
            assert(!ids.includes('marked1'), '文件里已有压缩标记的条目应该被移除');
            assert(ids.includes('fresh1'), '没压过的条目不该被动到');
            assert(ids.includes('error1'), '失败的条目必须留下，否则没法重试');
            assert(ids.includes('cancel1'), '已取消的条目必须留下');
            assert.strictEqual(st.tasks.length, 3, '应只剩 3 条，实际 ' + st.tasks.length);
        } finally {
            app.close();
        }
    }
});

add({
    id: 'NEW-03',
    title: '没有已压缩条目时「移除已压缩」按钮必须是禁用的',
    area: 'ui',
    level: 'P2',
    status: 'implemented',
    issue: '按钮文案里带命中数量，如果禁用条件写错（比如只看有没有任务），' +
           '列表里全是待压缩素材时它也会亮着 —— 点下去什么都没发生，' +
           '用户会以为功能坏了。',
    contract: '命中数为 0 时按钮 disabled；命中数 > 0 时可用且文案带数量',
    ref: 'js/app.js updateButtons',
    run: async function () {
        const app = await Env.makeApp();
        try {
            const st = app.win.App._state;
            const btn = app.win.document.getElementById('btnRemoveCompressed');
            assert(btn, '工具栏里应该有「移除已压缩」按钮');

            st.tasks.length = 0;
            st.tasks.push(taskWith('a', 'queued', false));
            app.win.App._internal.renderSummary();
            assert.strictEqual(btn.disabled, true, '没有已压缩条目时按钮不该可点');

            st.tasks.push(taskWith('b', 'done', false));
            app.win.App._internal.renderSummary();
            assert.strictEqual(btn.disabled, false, '有已压缩条目时按钮应该可点');
            assert(/1/.test(btn.textContent),
                '按钮文案里应该带命中数量，实际是「' + btn.textContent + '」');
        } finally {
            app.close();
        }
    }
});

// ---------------------------------------------------------------------------
// 压缩后打标签
// ---------------------------------------------------------------------------

add({
    id: 'NEW-04',
    title: '打标签必须是追加，不能覆盖素材上已有的标签',
    area: 'ui',
    level: 'P1',
    status: 'implemented',
    issue: 'Eagle 的 item.tags 是一个普通数组，写成 item.tags = [name] 最省事，' +
           '但那样会把用户自己打的标签全清掉 —— 素材元数据不可逆丢失，' +
           '而用户在 Eagle 里看到的是「标签莫名其妙没了」，根本联想不到是压缩干的。',
    contract: '新标签追加到已有标签之后，原标签原顺序保留；save() 只调一次',
    ref: 'js/app.js tagEagleItemAsync',
    run: async function () {
        const app = await Env.makeApp();
        try {
            const item = Env.eagleItem('/tmp/eagle-vc-tag-append.mp4');
            item.tags = ['旅行', '4K'];
            const t = { id: 'tag-a', name: 'a.mp4', path: item.filePath, eagleItem: item };

            const ok = await app.win.App._internal.tagEagleItemAsync(t, {
                tagCompressed: true, compressedTagName: '已压缩'
            });

            assert.strictEqual(ok, true, '应该报告标签已打上');
            assert.deepStrictEqual(item.tags, ['旅行', '4K', '已压缩'],
                '已有标签被覆盖或丢失：' + JSON.stringify(item.tags));
            assert.strictEqual(item.saves, 1, 'save() 应该只调一次，实际 ' + item.saves);
        } finally {
            app.close();
        }
    }
});

add({
    id: 'NEW-05',
    title: '已有同名标签不再重复添加；打不上时回滚内存里的改动',
    area: 'ui',
    level: 'P1',
    status: 'implemented',
    issue: '两条都得盯住：① Eagle 的标签名是精确匹配，「已压缩」和「已压缩 」是两个标签，' +
           '不做归一化就会打出一对肉眼分不出来的重复项；② 改完 tags 再 save 失败，' +
           '内存里的 item 还留着那个没存进去的标签，后续判断会以为已经打过了 —— ' +
           '这个 item 对象本轮还要复用（刷新缩略图等）。',
    contract: '同名（忽略大小写与首尾空格）视为已存在，不添加也不 save；save 失败时把 tags 还原',
    ref: 'js/app.js tagEagleItemAsync',
    run: async function () {
        const app = await Env.makeApp();
        try {
            // ① 尾空格去重
            const dup = Env.eagleItem('/tmp/eagle-vc-tag-dup.mp4');
            dup.tags = ['已压缩 '];
            const okDup = await app.win.App._internal.tagEagleItemAsync(
                { id: 'tag-b', name: 'b.mp4', path: dup.filePath, eagleItem: dup },
                { tagCompressed: true, compressedTagName: '已压缩' });
            assert.strictEqual(okDup, false, '已有同名标签应视为无需再打');
            assert.deepStrictEqual(dup.tags, ['已压缩 '], '不该改动已有标签');
            assert.strictEqual(dup.saves, 0, '已经打过就不该再 save 一次');

            // ② save 失败要回滚
            const bad = Env.eagleItem('/tmp/eagle-vc-tag-fail.mp4');
            bad.tags = ['旅行'];
            bad.save = function () { this.saves++; return Promise.reject(new Error('IPC 超时')); };
            const okBad = await app.win.App._internal.tagEagleItemAsync(
                { id: 'tag-c', name: 'c.mp4', path: bad.filePath, eagleItem: bad },
                { tagCompressed: true, compressedTagName: '已压缩' });
            assert.strictEqual(okBad, false, 'save 失败应返回 false 而不是抛出去');
            assert.deepStrictEqual(bad.tags, ['旅行'],
                'save 失败后必须把内存里的 tags 还原，否则后续会误判为已打过');
        } finally {
            app.close();
        }
    }
});

add({
    id: 'NEW-06',
    title: '标签设置必须真的接进界面：默认值、勾选联动、名字去空白',
    area: 'ui',
    level: 'P2',
    status: 'implemented',
    issue: '新增设置项最容易漏的是三处接线：applySettingsToUI 不写回、' +
           'refreshTagUI 不联动、readSettingsFromUI 不读。漏任何一处，' +
           '表现都是「界面上有这个开关但它是死的」，而且不报任何错。',
    contract: '启动时控件反映默认值；取消勾选后输入框禁用；带空格的名字在用之前被 trim',
    ref: 'js/app.js applySettingsToUI / refreshTagUI / compressedTagName',
    run: async function () {
        const app = await Env.makeApp();
        try {
            const doc = app.win.document;
            const chk = doc.getElementById('chkTagCompressed');
            const inp = doc.getElementById('inpTagName');
            assert(chk && inp, '标签设置控件应该存在');

            assert.strictEqual(chk.checked, true, '默认应该开启打标签');
            assert.strictEqual(inp.value, '',
                '默认标签名必须留空：写死中文的话英文界面会打出中文标签，' +
                '留空时由占位符显示当前语系的默认名');
            assert.strictEqual(inp.disabled, false, '勾选状态下输入框应该可编辑');

            chk.checked = false;
            chk.dispatchEvent(new app.win.Event('change'));
            assert.strictEqual(inp.disabled, true,
                '取消勾选后必须禁用输入框，否则「填了名字但没勾上」会被当成生效');

            chk.checked = true;
            chk.dispatchEvent(new app.win.Event('change'));
            assert.strictEqual(inp.disabled, false, '重新勾选后输入框应恢复');

            assert.strictEqual(
                app.win.App._internal.compressedTagName({ compressedTagName: '  已压缩  ' }),
                '已压缩', '标签名必须 trim：尾空格会打出一个肉眼分不出的重复标签');

            // 空值兜底：不填名字也必须能打标签，而且兜的是当前语系的默认名，
            // 不是写死的中文（测试环境里 tr 返回 fallback，正好等于语系默认值）。
            assert.strictEqual(
                app.win.App._internal.compressedTagName({ compressedTagName: '   ' }),
                '已压缩', '纯空白应视为没填，退回语系默认名');
            assert.strictEqual(
                app.win.App._internal.compressedTagName({}),
                '已压缩', '没这个字段时也要能拿到默认名');
            assert.strictEqual(
                app.win.App._internal.compressedTagName({ compressedTagName: 'Done ' }),
                'Done', '填了名字就用填的');
        } finally {
            app.close();
        }
    }
});

// ---------------------------------------------------------------------------
// 备份：同名并行不得互相覆盖
// ---------------------------------------------------------------------------

add({
    id: 'NEW-07',
    title: '不同目录的同名影片并行备份，两份备份都必须完整且互不被覆盖',
    area: 'ui',
    level: 'P0',
    status: 'implemented',
    issue: 'uniquePathAsync() 先 stat 出一个空位，随后 copyFileAsync() 以可覆盖方式写入。' +
           '两个 worker 各自 stat 到同一个空位，都认为没人占，后写的那一份就把先写的盖掉 —— ' +
           '分散在不同目录里的同名影片会抢到同一个备份名，而它们的原件接下来都会被压缩结果替换，' +
           '其中一份再也恢复不回来。备份开着却等于没开，这是不可逆的数据丢失。',
    contract: '挑名与写入合成为一次排他创建（COPYFILE_EXCL）；冲突时自动改名重试，' +
              '并发下每个源文件都拿到各自独立的备份文件',
    ref: 'js/app.js copyIntoDirExclusiveAsync',
    run: async function () {
        const app = await Env.makeApp();
        const dir = H.tmpDir('eagle-vc-backup-');
        try {
            // 两个不同目录、同一个文件名 —— 正是审核描述的场景
            const srcA = path.join(H.tmpDir('eagle-vc-srcA-'), 'movie.mp4');
            const srcB = path.join(H.tmpDir('eagle-vc-srcB-'), 'movie.mp4');
            fs.writeFileSync(srcA, 'original-A');
            fs.writeFileSync(srcB, 'original-B');

            const copy = app.win.App._internal.copyIntoDirExclusiveAsync;
            // 并行发起：如果是「先 stat 再 copy」，两次都会选中 movie.mp4
            const [outA, outB] = await Promise.all([
                copy(srcA, dir, 'movie.mp4'),
                copy(srcB, dir, 'movie.mp4')
            ]);

            assert.notStrictEqual(outA, outB,
                '两个源文件拿到了同一个备份路径（' + outA + '），后写的那份已经覆盖了先写的');
            assert.strictEqual(fs.readFileSync(outA, 'utf8'), 'original-A',
                '备份 A 的内容不是源文件 A 的 —— 它被另一份备份覆盖了');
            assert.strictEqual(fs.readFileSync(outB, 'utf8'), 'original-B',
                '备份 B 的内容不是源文件 B 的 —— 它被另一份备份覆盖了');
            assert.strictEqual(fs.readdirSync(dir).length, 2,
                '备份目录里应当留下 2 份备份，实际 ' + fs.readdirSync(dir).length + ' 份');
        } finally {
            app.close();
        }
    }
});

add({
    id: 'NEW-08',
    title: '备份目标已存在时必须报 EEXIST，绝不能覆盖已有文件',
    area: 'ui',
    level: 'P0',
    status: 'implemented',
    issue: '排他创建是 NEW-07 唯一的依靠。如果 copyFile 退化成可覆盖写入（比如忘了传 ' +
           'COPYFILE_EXCL，或者运行环境拿不到这个常量），冲突就不会报错，而是静默覆盖 —— ' +
           '用户界面上显示「已备份」，实际备份目录里少了一份原件。',
    contract: '目标已存在时 reject，err.code === EEXIST，且目标文件内容保持原样',
    ref: 'js/app.js copyFileExclusiveAsync',
    run: async function () {
        const app = await Env.makeApp();
        const dir = H.tmpDir('eagle-vc-excl-');
        try {
            const src = path.join(dir, 'src.mp4');
            const dest = path.join(dir, 'taken.mp4');
            fs.writeFileSync(src, 'new');
            fs.writeFileSync(dest, 'existing');

            let err = null;
            try {
                await app.win.App._internal.copyFileExclusiveAsync(src, dest);
            } catch (e) {
                err = e;
            }

            assert(err, '目标已存在却复制成功了 —— 排他标志没生效，备份会覆盖已有文件');
            assert.strictEqual(err.code, 'EEXIST',
                '应当以 EEXIST 报冲突，实际是 ' + err.code + '：' + err.message);
            assert.strictEqual(fs.readFileSync(dest, 'utf8'), 'existing',
                '已存在的备份文件被覆盖掉了');
        } finally {
            app.close();
        }
    }
});

// ---------------------------------------------------------------------------
// 确认范围：执行清单必须等于确认清单
// ---------------------------------------------------------------------------

add({
    id: 'NEW-09',
    title: '确认之后才探测完的素材不得进入本轮执行范围',
    area: 'ui',
    level: 'P0',
    status: 'implemented',
    issue: 'start() 用当时的 pendingTasks() 生成确认清单，doStart() 却重新读一次。' +
           '用户读确认框的那几秒里，剩下的素材正好探测完、状态从 probing 变成 queued，' +
           '于是被算进实际压缩范围 —— 覆盖的文件比确认框列出的多，而用户根本没见过那些文件名。' +
           '替换原文件不可逆，确认清单必须等于执行清单。',
    contract: '只执行确认快照里的条目；路径变了、已被移除、状态已变的都不执行；' +
              '快照之外的新条目一律不自动纳入',
    ref: 'js/app.js resolveConfirmedBatch',
    run: async function () {
        const app = await Env.makeApp();
        try {
            const st = app.win.App._state;
            st.tasks.length = 0;

            const confirmed1 = taskWith('c1', 'queued');
            const confirmed2 = taskWith('c2', 'queued');
            const confirmed3 = taskWith('c3', 'error');
            const late = taskWith('late', 'queued');       // 确认后才探测完
            st.tasks.push(confirmed1, confirmed2, confirmed3, late);

            // 只确认了前三条（late 当时还在 probing，不在 pendingTasks 里）
            const batch = {
                settings: {},
                entries: [
                    { id: 'c1', path: confirmed1.path, name: confirmed1.name },
                    { id: 'c2', path: confirmed2.path, name: confirmed2.name },
                    { id: 'c3', path: confirmed3.path, name: confirmed3.name }
                ]
            };

            // 用户读确认框期间：c1 被移除，c2 的路径被换掉，late 探测完成
            st.tasks.splice(st.tasks.indexOf(confirmed1), 1);
            confirmed2.path = '/tmp/eagle-vc-moved.mp4';

            const tasks = app.win.App._internal.resolveConfirmedBatch(batch);
            const ids = tasks.map(function (t) { return t.id; });

            assert(!ids.includes('late'),
                '确认之后才探测完的素材进了执行范围 —— 它没出现在确认框里，' +
                '用户不知情就被覆盖了原文件');
            assert(!ids.includes('c1'), '确认期间被移除的条目不该再执行');
            assert(!ids.includes('c2'), '路径在确认后变了的条目不该再执行');
            assert(ids.includes('c3'), '仅状态为 error 的已确认条目应当保留（重试是既定行为）');
            assert.strictEqual(tasks.length, 1, '实际执行清单应为 1 条，实际 ' + tasks.length + ' 条');
        } finally {
            app.close();
        }
    }
});

add({
    id: 'NEW-10',
    title: '运行中追加提示必须采用本轮设置且备份设置不得漂移',
    area: 'ui',
    level: 'P0',
    status: 'implemented',
    issue: '备份勾选框运行中仍可切换；追加确认读取界面并修改 state.settings，而 worker 沿用启动时的备份配置。',
    contract: '开始运行后锁住备份控件；追加确认展示 worker 正在使用的备份设置；迟到的目录选择不能修改运行设置。',
    ref: 'js/app.js doStart / appendSelectionToQueue / pickBackupDir',
    run: async function () {
        let releaseEncoding;
        const app = await Env.makeApp({ core: {
            resolveEncoder: function () { return { kind: 'cpu', encoder: 'libx265' }; },
            isHardwareEncoder: function () { return false; },
            validatePlan: function () { return { ok: true }; },
            buildPlan: function () { return { encoder: { kind: 'cpu', encoder: 'libx265' } }; },
            executePlan: function () { return new Promise(function (resolve, reject) { releaseEncoding = reject; }); }
        } });
        try {
            const win = app.win;
            const st = win.App._state;
            const chk = win.document.getElementById('chkBackup');
            st.settings.backupDir = '/tmp/previous-backup';
            chk.disabled = false; // 模拟启动前已经选好了目录、备份开关可操作
            chk.checked = false;
            st.settings.backup = false;
            st.tasks.push(taskWith('source', 'queued'));
            win.App._internal.renderSummary();

            // 用户在开始之前打开系统目录选择器，回调要等到运行以后才返回。
            let resolveDialog;
            win.eagle.dialog = { showOpenDialog: function () {
                return new Promise(function (resolve) { resolveDialog = resolve; });
            } };
            win.document.getElementById('btnPickBackup').click();
            win.document.getElementById('btnStart').click();
            assert.strictEqual(win.document.getElementById('confirmMask').hidden, false, '应先显示首次确认');
            win.document.getElementById('btnConfirmOk').click();
            assert.strictEqual(st.running, true, '前置条件：真实 worker 已启动');
            assert.strictEqual(chk.disabled, true, '运行中必须锁住备份开关');
            assert.strictEqual(st.runSession.settings.backup, false, '运行会话必须保存 worker 的备份设置');

            resolveDialog({ filePaths: ['/tmp/late-backup'] });
            await Env.wait(0);
            assert.strictEqual(st.settings.backupDir, '/tmp/previous-backup', '迟到的目录选择不得改写运行时备份目录');
            assert.strictEqual(chk.checked, false, '迟到的目录选择不得暗中打开备份');

            // 即使代码或外部事件改了 UI，也不能让确认文本重读并污染 worker 设置。
            chk.checked = true;
            chk.dispatchEvent(new win.Event('change'));
            app.selected.push(Env.eagleItem('/tmp/live-added.mp4'));
            win.App.onShow();
            await Env.wait(10);
            win.document.getElementById('btnSelectionAppend').click();
            const warning = win.document.getElementById('appendConfirmWarn').textContent;
            assert(warning.includes('本次未开启备份'), '追加确认必须如实显示本轮实际未备份：' + warning);
            assert(!warning.includes('本次已开启备份'), '追加确认不得报告 UI 的临时状态');
            assert.strictEqual(st.runSession.settings.backup, false, '确认期间 worker 的备份快照不得改变');
        } finally {
            if (releaseEncoding) releaseEncoding(Object.assign(new Error('cancelled'), { cancelled: true }));
            if (app.win.App._state.runPromise) await app.win.App._state.runPromise.catch(function () {});
            app.close();
        }
    }
});

add({
    id: 'NEW-12',
    title: 'ffprobe 启动失败后真实原文件保持不变',
    area: 'ui',
    level: 'P0',
    status: 'implemented',
    issue: '仅测 verifyOutput 拒绝不足以证明运行编排不会在失败后继续覆写原路径。',
    contract: '编码产物存在但 ffprobe 不可启动时，整轮任务报错，原文件字节不变且不生成备份。',
    ref: 'js/app.js runTask → js/ffmpeg.js verifyOutput',
    run: async function () {
        const dir = H.tmpDir('eagle-vc-guard-');
        const original = path.join(dir, 'source.mp4');
        const backupDir = path.join(dir, 'backups');
        fs.mkdirSync(backupDir);
        const sourceBytes = Buffer.alloc(4096, 0x61);
        fs.writeFileSync(original, sourceBytes);
        const app = await Env.makeApp({ core: {
            resolveEncoder: function () { return { kind: 'cpu', encoder: 'libx265' }; },
            isHardwareEncoder: function () { return false; },
            validatePlan: function () { return { ok: true }; },
            buildPlan: function (meta, settings, outputPath) {
                return { encoder: { kind: 'cpu', encoder: 'libx265' }, outputPath: outputPath };
            },
            executePlan: function (bins, plan) {
                fs.writeFileSync(plan.outputPath, Buffer.alloc(128, 0x62));
                return Promise.resolve();
            },
            verifyOutput: H.loadCore().verifyOutput
        } });
        try {
            const win = app.win;
            const st = win.App._state;
            st.bins.ffprobe = path.join(dir, 'missing-ffprobe');
            st.settings.backupDir = backupDir;
            st.settings.backup = true;
            const backupCheckbox = win.document.getElementById('chkBackup');
            backupCheckbox.checked = true;
            const task = makeTask('probe-guard');
            task.path = original;
            task.name = path.basename(original);
            task.meta = Env.probeMeta(original);
            task.meta.size = sourceBytes.length;
            st.tasks.push(task);
            win.App._internal.renderSummary();
            win.document.getElementById('btnStart').click();
            assert.strictEqual(win.document.getElementById('confirmMask').hidden, false);
            win.document.getElementById('btnConfirmOk').click();
            await st.runPromise;
            assert.strictEqual(task.status, 'error', '校验失败必须让任务报错');
            assert(/ffprobe/.test(task.error), '错误应指向 ffprobe 启动失败');
            assert(fs.readFileSync(original).equals(sourceBytes), 'ffprobe 失败时不能替换原文件');
            assert.strictEqual(fs.readdirSync(backupDir).length, 0,
                '已开启备份时，校验失败也不应进入备份阶段');
        } finally {
            app.close();
            fs.rmSync(dir, { recursive: true, force: true });
        }
    }
});

add({
    id: 'NEW-13',
    title: '运行前打开的本地文件选择器迟到时不得加入活队列',
    area: 'ui',
    level: 'P0',
    status: 'implemented',
    issue: '添加本地文件的对话框可能在启动压缩之后才返回，绕过运行中追加确认。',
    contract: '迟到的本地文件选择结果不得直接加入正在运行的 worker 队列。',
    ref: 'js/app.js addLocalFiles',
    run: async function () {
        let releaseEncoding;
        const app = await Env.makeApp({ core: {
            resolveEncoder: function () { return { kind: 'cpu', encoder: 'libx265' }; },
            isHardwareEncoder: function () { return false; },
            validatePlan: function () { return { ok: true }; },
            buildPlan: function () { return { encoder: { kind: 'cpu', encoder: 'libx265' } }; },
            executePlan: function () { return new Promise(function (resolve, reject) { releaseEncoding = reject; }); }
        } });
        try {
            const win = app.win;
            const st = win.App._state;
            let resolveDialog;
            win.eagle.dialog = { showOpenDialog: function () {
                return new Promise(function (resolve) { resolveDialog = resolve; });
            } };
            win.document.getElementById('btnAddFiles').click();
            st.tasks.push(makeTask('initial'));
            win.App._internal.renderSummary();
            win.document.getElementById('btnStart').click();
            win.document.getElementById('btnConfirmOk').click();
            assert.strictEqual(st.running, true, '前置条件：worker 正在运行');
            resolveDialog({ filePaths: ['/tmp/late-unconfirmed.mp4'] });
            await Env.wait(10);
            assert(!st.tasks.some(function (t) { return t.path === '/tmp/late-unconfirmed.mp4'; }),
                '迟到的本地文件没有追加确认，不得入队');
            assert(!st.runSession.queue.some(function (t) { return t.path === '/tmp/late-unconfirmed.mp4'; }),
                '未经确认的本地文件不得进入正在运行的 worker 队列');
        } finally {
            if (releaseEncoding) releaseEncoding(Object.assign(new Error('cancelled'), { cancelled: true }));
            if (app.win.App._state.runPromise) await app.win.App._state.runPromise.catch(function () {});
            app.close();
        }
    }
});

module.exports = cases;
