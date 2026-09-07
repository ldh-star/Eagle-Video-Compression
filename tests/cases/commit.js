/**
 * 用例分片：提交安全（产物落盘这一段的正确性）。
 *
 * 这一段出错的代价最高：它直接改写用户的原始素材，且不可逆。
 * 所以这里既有「待修」的契约，也锁了几条当前已经正确、但一旦改坏就是
 * 数据丢失的行为（取消不留残file、提交后内容确实被换掉）。
 *
 * 需要 jsdom 的用例会走 env.makeApp()；缺 jsdom 时抛 H.skip，不算失败。
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const H = require('./helpers');
const Env = require('./env');

const cases = [];
function add(c) { cases.push(c); }

/** 造一个 7 小时前修改过的文件（超过 STALE_AGE_MS=6h，属于可回收的陈旧文件）。 */
function staleFile(dir, name) {
    const p = path.join(dir, name);
    fs.writeFileSync(p, 'x');
    const old = (Date.now() - 7 * 60 * 60 * 1000) / 1000;
    fs.utimesSync(p, old, old);
    return p;
}

function rmrf(p) {
    try { fs.rmSync(p, { recursive: true, force: true }); } catch (e) { /* 没有 rmSync 的老 Node，忽略 */ }
}

// ---------------------------------------------------------------------------
// P0 · 体积闸门
// ---------------------------------------------------------------------------

add({
    id: 'P0-02',
    title: '产物不比源文件小时必须跳过替换',
    area: 'commit',
    level: 'P0',
    status: 'implemented',
    issue: 'runTask 的流程是 verifyOutput → 备份 → 替换，中间没有任何体积闸门。' +
           'CRF 设太低、源片本来就很干、或者分辨率/帧率被放大时，产物可能比原文件还大 —— ' +
           '此时插件依然会覆盖原文件，用户拿到一个更大且画质更差的视频。',
    contract: '新增纯函数 shouldCommit(outSize, srcSize)：outSize >= srcSize * 0.98 → false；' +
              '闸门要在「备份之前」判定，否则白备份一个大文件；任务状态记为 skipped 而不是 done',
    ref: 'js/app.js runTask 步骤 4~5',
    run: function () {
        const f = H.loadCore()._internal.shouldCommit;
        assert.strictEqual(typeof f, 'function',
            '需要一个可单测的纯函数 shouldCommit(outSize, srcSize)，把体积闸门从 runTask 里拆出来');
        assert.strictEqual(f(100, 100), false, '产物和源文件一样大，不该替换');
        assert.strictEqual(f(99, 100), false, '只小 1%（99/100）在 0.98 阈值内，不该替换');
        assert.strictEqual(f(97, 100), true, '小 3% 应当放行');
        assert.strictEqual(f(50, 100), true, '小一半当然放行');
        // 边界：0 字节产物绝不能算成功
        assert.strictEqual(f(0, 100), false, '产物为 0 字节说明编码失败，绝不能覆盖原文件');
    }
});

// ---------------------------------------------------------------------------
// P0 · 临时文件回收
// ---------------------------------------------------------------------------

add({
    id: 'P0-03',
    title: '启动清理必须覆盖「临时产物实际会落到的目录」',
    area: 'commit',
    level: 'P0',
    status: 'implemented',
    issue: 'preferredTempDir 为了同卷 rename 会把临时产物写进**源目录**，而 purgeStaleTemp 只扫 ' +
           'os.tmpdir()。两者对不上：进程被硬杀后，几 GB 的 eagle-vc-out-*.mp4 会永久躺在' +
           '源目录里，谁也不会去删。',
    contract: 'purgeStaleTemp 的扫描范围必须覆盖 preferredTempDir 的返回值（两种合法修法：' +
              '① purgeStaleTemp 接受要扫的目录列表；② preferredTempDir 不再返回源目录）。' +
              '本用例测的是「写到哪就能清到哪」这个不变量，两种修法都能通过',
    ref: 'js/ffmpeg.js preferredTempDir / purgeStaleTemp',
    run: function () {
        const dir = H.tmpDir('eagle-vc-purge-');
        try {
            const source = path.join(dir, 'source.mp4');
            fs.writeFileSync(source, 'x');
            const pref = H.loadCore()._internal.preferredTempDir(source);

            const junk = staleFile(dir, 'eagle-vc-out-deadbeef.mp4');
            // 修好之后 purgeStaleTemp 应能接受要扫的目录
            H.loadCore().purgeStaleTemp([dir]);
            const left = fs.existsSync(junk);

            assert(!(pref === dir && left),
                'preferredTempDir 把临时产物写进源目录 ' + dir + '，但 purgeStaleTemp 清不掉它 —— ' +
                '异常退出后这个文件会永久留下（当前 purgeStaleTemp 只扫 ' + os.tmpdir() + '）');
        } finally {
            rmrf(dir);
        }
    }
});

add({
    id: 'P0-03b',
    title: '写在源目录里的临时文件必须对 Eagle 不可见',
    area: 'commit',
    level: 'P0',
    status: 'implemented',
    issue: '源目录通常就是 Eagle 的素材库目录。eagle-vc-out-<id>.mp4 是普通文件名，' +
           'Eagle 的目录监听会把它当成新素材导入 —— 用户压一次片，库里多一个半成品。' +
           '两遍编码的 passlog（eagle-vc-pass-*.log / .log.mbtree）同理。',
    contract: '临时文件名以 . 开头（Eagle 忽略隐藏文件），或干脆不写进源目录',
    ref: 'js/app.js runTask（tmpOut 拼接处）',
    run: function () {
        const dir = H.tmpDir('eagle-vc-hidden-');
        try {
            const source = path.join(dir, 'source.mp4');
            fs.writeFileSync(source, 'x');
            if (H.loadCore()._internal.preferredTempDir(source) !== dir) return; // 不写源目录则无此风险

            // 临时名的字面量目前只在 app.js 里有，改这条时要连那里一起改
            const appSrc = fs.readFileSync(path.join(H.ROOT, 'js', 'app.js'), 'utf8');
            assert(/['"`]\.eagle-vc-(out|pass|sample)-/.test(appSrc),
                '源目录里的临时文件必须以 . 开头，否则会被 Eagle 当成新素材导入');
        } finally {
            rmrf(dir);
        }
    }
});

// ---------------------------------------------------------------------------
// P1 · 提交路径
// ---------------------------------------------------------------------------

add({
    id: 'P1-10',
    title: '同一卷提交时应该直接 rename，不该再全量复制一遍',
    area: 'commit',
    level: 'P1',
    status: 'implemented',
    issue: 'atomicReplaceFileAsync 无条件先 copyFile(src → stage) 再 rename(stage → dest)。' +
           '但 tmpOut 本来就被 preferredTempDir 刻意放在源目录（同卷），这一次 copyFile 是' +
           '纯浪费：4K 母带要多写几个 GB，机械盘上就是几十秒。',
    contract: 'src 与 dest 同卷时直接 rename(src → dest)；仅当 rename 抛 EXDEV（跨卷）时才回退复制',
    ref: 'js/app.js atomicReplaceFileAsync',
    run: async function () {
        const app = await Env.makeApp();
        const dir = H.tmpDir('eagle-vc-commit-');
        const copySpy = H.spy(fs, 'copyFile');
        const renameSpy = H.spy(fs, 'rename');
        try {
            const src = path.join(dir, 'eagle-vc-out-1.mp4');
            const dest = path.join(dir, 'movie.mp4');
            fs.writeFileSync(src, 'new');
            fs.writeFileSync(dest, 'old');

            await app.win.App._internal.atomicReplaceFileAsync(src, dest, { cancelled: false });

            assert.strictEqual(copySpy.count, 0,
                '同卷提交应该直接 rename，实际复制了 ' + copySpy.count + ' 次（' +
                (fs.statSync(dest).size) + ' 字节级别的无谓写入）');
            assert(renameSpy.count >= 1, '同卷提交必须走 rename 才能保证原子性');
            assert.strictEqual(fs.readFileSync(dest, 'utf8'), 'new', '提交后目标文件应是新内容');
        } finally {
            copySpy.restore();
            renameSpy.restore();
            rmrf(dir);
            app.close();
        }
    }
});

// ---------------------------------------------------------------------------
// 锁定：当前正确、但改坏就是数据丢失的行为
// ---------------------------------------------------------------------------

add({
    id: 'LOCK-06',
    title: '提交被取消时不得留下 staging 残留文件',
    area: 'commit',
    level: 'P0',
    status: 'implemented',
    issue: '取消发生在 staging 拷贝之后、rename 之前时，原文件不能被动过，' +
           '而且 .eagle-vc-commit-* 必须被清掉 —— 否则用户每次取消都在素材目录里丢一个垃圾文件。',
    contract: 'cancelToken.cancelled 时 reject，且目标目录里不留 .eagle-vc-commit-*',
    ref: 'js/app.js atomicReplaceFileAsync',
    run: async function () {
        const app = await Env.makeApp();
        const dir = H.tmpDir('eagle-vc-cancel-');
        try {
            const src = path.join(dir, 'eagle-vc-out-1.mp4');
            const dest = path.join(dir, 'movie.mp4');
            fs.writeFileSync(src, 'new');
            fs.writeFileSync(dest, 'old');

            let rejected = false;
            try {
                await app.win.App._internal.atomicReplaceFileAsync(src, dest, { cancelled: true });
            } catch (e) {
                rejected = true;
            }
            assert(rejected, '取消时必须 reject，不能默默继续提交');
            assert.strictEqual(fs.readFileSync(dest, 'utf8'), 'old', '取消后原文件内容必须原封不动');
            const leftovers = fs.readdirSync(dir).filter(function (n) {
                return n.indexOf('.eagle-vc-commit-') === 0;
            });
            assert.deepStrictEqual(leftovers, [], '取消后不该留下 staging 残留：' + leftovers.join(', '));
        } finally {
            rmrf(dir);
            app.close();
        }
    }
});

add({
    id: 'LOCK-07',
    title: '正常提交后目标路径必须是完整的新内容',
    area: 'commit',
    level: 'P0',
    status: 'implemented',
    issue: '这是整套提交流程存在的唯一理由：结果只能是「旧文件」或「完整新文件」，' +
           '绝不能是写了一半的文件。P1-10 改成 rename 时最容易把这条改坏。',
    contract: 'atomicReplaceFileAsync 成功后 dest 内容与 src 完全一致',
    ref: 'js/app.js atomicReplaceFileAsync',
    run: async function () {
        const app = await Env.makeApp();
        const dir = H.tmpDir('eagle-vc-swap-');
        try {
            const payload = Buffer.alloc(64 * 1024, 7);
            const src = path.join(dir, 'eagle-vc-out-1.mp4');
            const dest = path.join(dir, 'movie.mp4');
            fs.writeFileSync(src, payload);
            fs.writeFileSync(dest, Buffer.alloc(10, 1));

            await app.win.App._internal.atomicReplaceFileAsync(src, dest, { cancelled: false });
            assert(fs.readFileSync(dest).equals(payload), '提交后目标文件内容应与产物完全一致');
        } finally {
            rmrf(dir);
            app.close();
        }
    }
});

// ---------------------------------------------------------------------------
// 拿不到：需要先导出内部函数
// ---------------------------------------------------------------------------

add({
    id: 'P1-18',
    title: 'uniquePath 不能用同步 existsSync 循环探测',
    area: 'commit',
    level: 'P1',
    status: 'implemented',
    issue: 'uniquePath 在 while 循环里同步 existsSync 找不冲突的备份名。备份目录在网络盘' +
           '（SMB/NFS）上时，一次 existsSync 可能几十毫秒，卡住整个渲染线程；' +
           '而且这个循环没有次数上限，目录里真堆了几百个同名备份就会一直转下去。',
    contract: '改成异步探测（fs.stat 回调）；冲突次数设上限，不要无限循环',
    ref: 'js/app.js uniquePathAsync',
    run: async function () {
        const app = await Env.makeApp();
        const dir = H.tmpDir('eagle-vc-unique-');
        const spy = H.spy(fs, 'existsSync');
        try {
            // 先占住前三个候选名，逼它真的走进循环
            fs.writeFileSync(path.join(dir, 'movie.mp4'), 'x');
            fs.writeFileSync(path.join(dir, 'movie-1.mp4'), 'x');
            fs.writeFileSync(path.join(dir, 'movie-2.mp4'), 'x');

            const p = await app.win.App._internal.uniquePathAsync(dir, 'movie.mp4');
            assert.strictEqual(path.basename(p), 'movie-3.mp4',
                '前三个名字都被占了，应该退到 movie-3.mp4，实际 ' + path.basename(p));
            assert.strictEqual(spy.count, 0,
                'uniquePathAsync 做了 ' + spy.count + ' 次同步 existsSync，会卡住渲染线程');

            // 上限：真撞满了要抛错，而不是无限循环下去
            await app.win.App._internal.uniquePathAsync(dir, 'movie.mp4', 1)
                .then(function () {
                    throw new Error('冲突超过上限时应该抛错，而不是一直循环');
                }, function (err) {
                    assert(/过多/.test(String(err && err.message)),
                        '超限时应给出可理解的报错，实际：' + err);
                });
        } finally {
            spy.restore();
            app.close();
        }
    }
});

module.exports = cases;
