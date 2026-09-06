const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { JSDOM } = require(path.join(__dirname, '..', 'tools', 'require-jsdom.js'))();

const ROOT = path.resolve(__dirname, '..');
const settingsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eagle-vc-queue-test-'));
process.env.EAGLE_PLUGIN_SETTINGS_DIR = settingsDir;
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')
    .replace(/<script[\s\S]*?<\/script>/g, '');

function makeCore() {
    return {
        CODECS: {
            h265: { id: 'h265', label: 'H.265', crf: { min: 0, max: 51, def: 28 }, tenBit: true },
            copy: { id: 'copy', label: 'Copy', crf: null, tenBit: true }
        },
        SPEED_LABELS: ['Fast', 'Balanced', 'Slow'],
        RESOLUTIONS: [{ v: 'source', l: 'Keep source' }],
        AUDIO_MODES: [{ v: 'aac', l: 'AAC' }],
        AUDIO_BITRATES: [128],
        VIDEO_EXTENSIONS: ['.mp4'],
        isVideoFile: (p) => /\.mp4$/i.test(p),
        // 结构与真实 normalizeProbe 保持一致：缺了 hdr / compression，
        // 渲染层就得靠防御性判断兜底，那正是测试该盯住的地方。
        // 路径里带 hdr / compressed 的文件会返回对应的元数据，用于验证色块渲染。
        probe: (bins, p) => Promise.resolve({
            size: 1024, duration: 1, path: p,
            tags: {},
            compression: /compressed/.test(p || '')
                ? { compressed: true, version: 1, count: 3, date: '2026-09-06', codec: 'h265', mode: 'crf' }
                : { compressed: false, version: 0, count: 0, date: '', codec: '', mode: '' },
            video: {
                width: 320, height: 240, fps: 30, codec: 'h264', bitDepth: 8,
                hdr: /hdr/.test(p || '')
                    ? { isHdr: true, kind: 'hdr10', transfer: 'smpte2084', primaries: 'bt2020', space: 'bt2020nc', dolbyVision: false, hdr10Plus: false }
                    : { isHdr: false, kind: null, transfer: '', primaries: '', space: '', dolbyVision: false, hdr10Plus: false }
            }
        }),
        estimateOutputSize: () => 512,
        purgeStaleTemp: () => 0,
        hdrRisk: () => ({ atRisk: false, reason: '' }),
        supportsCompressionMarker: () => true,
        CancelledError: () => Object.assign(new Error('Cancelled'), { cancelled: true }),
        resolveBinaries: () => Promise.resolve({ version: 'test', ffmpeg: 'ffmpeg', source: 'test' }),
        _internal: {
            withTimeout: (p) => Promise.resolve(p),
            recommendedWorkerCount: () => 1,
            recommendedThreadCount: () => 1,
            preferredTempDir: () => '/tmp'
        }
    };
}

function makeFormat() {
    return {
        bytes: (n) => `${n} B`, duration: () => '1s', fps: () => '30 fps', codecName: (n) => n,
        bitrate: () => '', colorDepth: () => null, chromaLabel: () => '', savedPercent: () => 0,
        sizeRelation: () => 'same', sizeRangeRelation: () => 'same'
    };
}

function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

(async function run() {
    const selected = [];
    const dom = new JSDOM(html, {
        url: 'http://localhost/', runScripts: 'dangerously', pretendToBeVisual: true,
        beforeParse(window) {
            window.require = require;
            window.FFmpegCore = makeCore();
            window.Format = makeFormat();
            // 必须和真实 I18n.t 一样做 {{...}} 插值：否则含 {{count}} 的提示文案
            // 永远渲染成占位符，测试就盯不住“数字到底有没有传进去”这类 bug。
            window.I18n = {
                t: (_, fallback, vars) => {
                    if (!vars) return fallback;
                    return String(fallback).replace(/{{\s*([\w.]+)\s*}}/g, (m, name) =>
                        vars[name] === undefined || vars[name] === null ? '' : String(vars[name]));
                },
                apply: () => {}
            };
            window.eagle = { item: { getSelected: () => Promise.resolve(selected) } };
        }
    });
    const win = dom.window;
    win.eval(fs.readFileSync(path.join(ROOT, 'js/app.js'), 'utf8'));
    await win.App.init(win.eagle);
    await wait(30);

    win.App._state.tasks.push({
        id: 'existing', path: '/tmp/existing-video.mp4', name: 'existing-video.mp4', ext: '.mp4',
        meta: { size: 1024, duration: 1, video: {} }, status: 'queued', progress: 0
    });
    win.App._internal.renderSummary();
    selected.push({ filePath: '/tmp/new-video.mp4' });
    win.App.onShow();
    await wait(30);

    const mask = win.document.getElementById('selectionMask');
    assert(mask, 'Expected an Eagle selection decision modal');
    assert.strictEqual(mask.hidden, false, 'Expected reopening with new selection to show the decision modal');
    assert.strictEqual(win.App._state.tasks.length, 1, 'Expected new selection to wait for the user decision');

    win.document.getElementById('btnSelectionCancel').click();
    assert.strictEqual(mask.hidden, true, 'Expected cancel action to close the decision modal');
    assert.strictEqual(win.App._state.tasks.length, 1, 'Expected cancel action to preserve the current queue');

    win.App.onShow();
    await wait(30);
    win.document.getElementById('btnSelectionAppend').click();
    await wait(30);
    assert.strictEqual(win.App._state.tasks.length, 2, 'Expected append action to add new Eagle video to the queue');

    selected.splice(0, selected.length, { filePath: '/tmp/replacement-video.mp4' });
    win.App.onShow();
    await wait(30);
    win.document.getElementById('btnSelectionReplace').click();
    await wait(30);
    assert.strictEqual(win.App._state.tasks.length, 1, 'Expected replace action to clear all prior tasks');
    assert.strictEqual(win.App._state.tasks[0].path, '/tmp/replacement-video.mp4', 'Expected replacement selection to become the new queue');

    const replacement = win.App._state.tasks[0];
    replacement.status = 'queued';
    win.App._state.running = true;
    win.App._state.cancelToken = { cancelled: false };
    win.App._state.runSession = { queue: [replacement], pendingProbes: 0, waiters: [] };
    win.App._state.runPromise = Promise.resolve();

    selected.splice(0, selected.length, { filePath: '/tmp/live-append.mp4' });
    win.App.onShow();
    await wait(30);
    win.document.getElementById('btnSelectionAppend').click();
    await wait(30);
    assert(win.App._state.runSession.queue.some((task) => task.path === '/tmp/live-append.mp4'),
        'Expected a video appended while running to join the live worker queue');

    win.App._internal.renderSummary();
    win.document.getElementById('btnCancel').click();
    assert.strictEqual(win.App._state.cancelToken.cancelled, true, 'Expected stop button to signal cancellation to active FFmpeg work');
    assert.strictEqual(replacement.status, 'cancelled', 'Expected not-yet-started work to be marked cancelled immediately');

    const resolvers = [];
    win.eagle.item.getSelected = () => new Promise((resolve) => resolvers.push(resolve));
    win.App._state.running = false;
    win.App.onShow();
    win.App.onShow();
    await wait(0);
    resolvers[1]([{ filePath: '/tmp/latest-selection.mp4' }]);
    await wait(10);
    win.document.getElementById('btnSelectionCancel').click();
    resolvers[0]([{ filePath: '/tmp/stale-selection.mp4' }]);
    await wait(10);
    assert.strictEqual(win.document.getElementById('selectionMask').hidden, true,
        'Expected a stale selection request to be ignored after the newer dialog was dismissed');

    win.eagle.item.getSelected = () => { throw new Error('sync Eagle API failure'); };
    assert.doesNotThrow(() => win.App.onShow(), 'Expected a synchronous Eagle API failure to be contained by the selection loader');
    await wait(10);

    const originalPath = path.join(settingsDir, 'original.mp4');
    const outputPath = path.join(settingsDir, 'output.mp4');
    fs.writeFileSync(originalPath, 'original-bytes');
    fs.writeFileSync(outputPath, 'compressed-bytes');
    await assert.rejects(
        () => win.App._internal.atomicReplaceFileAsync(outputPath, originalPath, { cancelled: true }),
        (err) => err && err.cancelled,
        'Expected a cancelled task to stop before final replacement'
    );
    assert.strictEqual(fs.readFileSync(originalPath, 'utf8'), 'original-bytes',
        'Expected a cancellation before commit to preserve the original file');
    await win.App._internal.atomicReplaceFileAsync(outputPath, originalPath, { cancelled: false });
    assert.strictEqual(fs.readFileSync(originalPath, 'utf8'), 'compressed-bytes',
        'Expected final output to replace the original through the atomic commit helper');
    assert(!fs.readdirSync(settingsDir).some((name) => name.indexOf('.eagle-vc-commit-') === 0),
        'Expected no commit staging file to remain after replacement');
    // ---- HDR / 已压缩 色块必须真的渲染出来，而不只是数据里存在 ----
    win.App._state.tasks.length = 0;
    win.App._state.running = false;

    const badgePaths = [
        '/tmp/hdr-source.mp4',
        '/tmp/compressed-before.mp4',
        '/tmp/hdr-and-compressed.mp4'
    ];
    for (let i = 0; i < badgePaths.length; i++) {
        const p = badgePaths[i];
        // 直接喂 probe 结果，避开异步探测链，断言只盯渲染这一件事。
        const meta = await win.FFmpegCore.probe(null, p);
        win.App._state.tasks.push({
            id: 'badge-' + i, path: p, name: p.split('/').pop(), ext: '.mp4',
            meta: meta, status: 'queued', progress: 0
        });
    }
    win.App._internal.renderList();
    await wait(30);
    win.App._internal.renderSummary();
    await wait(20);

    const rows = [...win.document.querySelectorAll('.task-meta')].map((el) => el.innerHTML);
    assert.strictEqual(rows.length, 3, 'Expected three task rows to render');
    assert(
        rows.some((h) => h.includes('tag-hdr') && h.includes('HDR10')),
        'An HDR source must render the HDR badge, not just carry the flag in metadata'
    );
    assert(
        rows.some((h) => h.includes('tag-done')),
        'A previously compressed file must render the compressed badge'
    );
    const both = rows.find((h) => h.includes('tag-hdr') && h.includes('tag-done'));
    assert(both, 'A file that is both HDR and previously compressed must show both badges');

    const notice = win.document.getElementById('noticeRow');
    assert.strictEqual(notice.hidden, false, 'Expected the summary notice row to be visible');
    assert(
        notice.textContent.includes('2'),
        'Expected the notice to count the two previously compressed files'
    );

    console.log('PASS queue intake decision actions and visible cancellation control');
    console.log('PASS HDR and compression badges render in the task list');
})().catch((err) => {
    console.error(err.stack || err);
    process.exitCode = 1;
}).finally(() => {
    fs.rmSync(settingsDir, { recursive: true, force: true });
});
