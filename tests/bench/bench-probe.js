'use strict';
/**
 * 真实 ffprobe 探测吞吐实测：导入 N 个文件，从触发到全部元信息读完要多久。
 * 新旧版本共用同一个真实 probe 实现（差异只有新版多读一个 mtime），
 * 所以这里测的是「探测是串行还是并发」这一个变量。
 * 用法：node bench-probe.js <old|new> <n>
 */
var ver = process.argv[2];
var n = parseInt(process.argv[3], 10);
var ROOT = ver === 'old' ? '/tmp/vc-base' : '/Users/hongliang/StudioProjects/Mine/视频压缩';
var ENV = require(ROOT + '/tests/cases/env.js');

// 两边都固定用当前工作区的真实 probe：探测本身不该有版本差异
var REAL = require('/Users/hongliang/StudioProjects/Mine/视频压缩/js/ffmpeg.js');
var FFPROBE = { ffprobe: '/opt/homebrew/bin/ffprobe', ffmpeg: '/opt/homebrew/bin/ffmpeg', version: '7.1.1' };

var watch = { probe: 0, inflight: 0, maxInflight: 0 };

function items(k) {
    var a = [];
    for (var i = 0; i < k; i++) a.push(ENV.eagleItem('/tmp/vcbench/gallery/clip-' + (i + 1) + '.mp4'));
    return a;
}

var t0 = 0;

ENV.makeApp({
    selected: items(n),
    settle: 0,
    core: {
        probe: function (bins, p) {
            watch.probe++; watch.inflight++;
            if (watch.inflight > watch.maxInflight) watch.maxInflight = watch.inflight;
            return REAL.probe(FFPROBE, p).then(function (m) {
                watch.inflight--; return m;
            }, function (e) { watch.inflight--; throw e; });
        }
    },
    beforeInit: function () { t0 = Date.now(); }
}).then(function (app) {
    return new Promise(function (resolve) {
        var done = 0, lastProbe = -1, stableSince = Date.now();
        var timer = setInterval(function () {
            if (watch.probe !== lastProbe) { lastProbe = watch.probe; stableSince = Date.now(); }
            var finished = watch.probe >= n && watch.inflight === 0;
            if (finished || Date.now() - t0 > 60000) {
                clearInterval(timer);
                resolve({
                    ver: ver, n: n, probes: watch.probe,
                    maxInflight: watch.maxInflight,
                    wall: Date.now() - t0,
                    tasks: app.win.App._state.tasks.length,
                    timedOut: Date.now() - t0 > 60000
                });
            }
        }, 10);
    });
}).then(function (r) {
    console.log(JSON.stringify(r));
    process.exit(0);
}).catch(function (e) {
    console.log(JSON.stringify({ ver: ver, n: n, error: String(e && e.message || e) }));
    process.exit(1);
});
