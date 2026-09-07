'use strict';
var fs = require('fs');
function timeIt(fn) { return new Promise(function (res) { var t = Date.now(); fn(function (e) { res({ ms: Date.now() - t, err: e }); }); }); }
var sizes = [100, 500, 1000];
var out = [];
var chain = Promise.resolve();
sizes.forEach(function (s) {
    chain = chain.then(function () {
        var src = '/tmp/vcbench/big/f' + s + '.bin';
        var dstCopy = '/tmp/vcbench/big/copy-' + s + '.bin';
        var dstRename = '/tmp/vcbench/big/ren-' + s + '.bin';
        return timeIt(function (cb) { fs.copyFile(src, dstCopy, cb); }).then(function (c) {
            return timeIt(function (cb) { fs.rename(dstCopy, dstRename, cb); }).then(function (r) {
                out.push({ size: s, copyMs: c.ms, renameMs: r.ms });
                console.log(s + 'MB  copyFile=' + c.ms + 'ms  rename=' + r.ms + 'ms');
            });
        });
    });
});
chain.then(function () {
    fs.writeFileSync('/tmp/vcbench/commit-results.json', JSON.stringify(out, null, 2));
    // 清理
    out.forEach(function (r) { try { fs.unlinkSync('/tmp/vcbench/big/ren-' + r.size + '.bin'); } catch (e) {} });
    console.log('DONE');
});
