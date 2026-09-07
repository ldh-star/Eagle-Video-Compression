'use strict';
/** UI 实测（单次运行）：node bench-ui.js <old|new> <n> */
var ver = process.argv[2];
var n = parseInt(process.argv[3], 10);
var ROOT = ver === 'old' ? '/tmp/vc-base' : '/Users/hongliang/StudioProjects/Mine/视频压缩';
var ENV = require(ROOT + '/tests/cases/env.js');
var H = require(ROOT + '/tests/cases/helpers.js');

function paths(k) {
    var a = [];
    for (var i = 0; i < k; i++) a.push(ENV.eagleItem('/tmp/vcbench/gallery/clip-' + (i + 1) + '.mp4'));
    return a;
}

var counted = null, sp = null, t0 = 0;

ENV.makeApp({
    selected: paths(n),
    settle: 0,
    beforeInit: function (win) {
        counted = H.countingArray(win.App._state.tasks);
        win.App._state.tasks = counted.proxy;
        sp = {
            summary: H.spy(win.App._internal, 'renderSummary'),
            task: H.spy(win.App._internal, 'renderTask'),
            list: H.spy(win.App._internal, 'renderList')
        };
        t0 = Date.now();
    }
}).then(function (app) {
    var core = app.core;
    return new Promise(function (resolve) {
        var last = -1, stableSince = Date.now();
        var timer = setInterval(function () {
            var done = core.counts.probe >= n;
            if (sp.summary.count !== last) { last = sp.summary.count; stableSince = Date.now(); }
            if ((done && Date.now() - stableSince > 250) || Date.now() - t0 > 15000) {
                clearInterval(timer);
                resolve({
                    ver: ver, n: n,
                    visits: counted.stats.visits,
                    summary: sp.summary.count,
                    task: sp.task.count,
                    list: sp.list.count,
                    inflight: core.probeWatch.maxInflight,
                    wall: Date.now() - t0,
                    probes: core.counts.probe,
                    tasks: app.win.App._state.tasks.length,
                    timedOut: Date.now() - t0 > 15000
                });
            }
        }, 20);
    });
}).then(function (r) {
    console.log(JSON.stringify(r));
    process.exit(0);
}).catch(function (e) {
    console.log(JSON.stringify({ ver: ver, n: n, error: String(e && e.message || e) }));
    process.exit(1);
});
