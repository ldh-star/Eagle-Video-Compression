'use strict';
/**
 * 视频压缩插件：新旧版本编码性能实测（第二版）
 * 旧版 = git HEAD（已发布 1.1.0），新版 = 当前工作区
 * 同一素材、同一参数生成路径，只让代码自己决定线程 / 私有参数。
 * 口径：wall = 墙钟秒；cpu = 全部进程 utime 之和（总 CPU 消耗）；
 *       par = cpu / wall，即在飞的平均核数 —— 数字越大说明越霸占机器。
 */
var cp = require('child_process');
var fs = require('fs');
var path = require('path');

var OLD = require('/tmp/vc-base/js/ffmpeg.js');
var NEW = require('/Users/hongliang/StudioProjects/Mine/视频压缩/js/ffmpeg.js');

var SRC = '/tmp/vcbench/src5.mp4';
var OUT_DIR = '/tmp/vcbench/out';
var CPU = 14;
var FFMPEG = '/opt/homebrew/bin/ffmpeg';

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

function argsFor(Core, meta, codecId, settings, concurrency) {
    var codec = Core.CODECS[codecId];
    var s = JSON.parse(JSON.stringify(settings));
    var threads;
    try { threads = Core._internal.recommendedThreadCount(CPU, concurrency, codecId); }
    catch (e) { threads = Core._internal.recommendedThreadCount(CPU, concurrency); }
    s.runtimeThreads = threads;
    var args = Core._internal.videoEncodeArgs(meta, s, codec, [], null);
    return { args: args, threads: threads };
}

function fullArgs(videoArgs, input, output) {
    // 不压 loglevel，否则 bench: 行（info 级）也被吞掉
    return ['-y', '-hide_banner', '-benchmark']
        .concat(['-i', input])
        .concat(videoArgs)
        .concat(['-map', '0:v:0', '-map', '0:a', '-c:a', 'copy', output]);
}

function run(args) {
    return new Promise(function (resolve, reject) {
        var p = cp.spawn(FFMPEG, args, { stdio: ['ignore', 'ignore', 'pipe'] });
        var err = '';
        p.stderr.on('data', function (d) { err += d.toString(); });
        p.on('error', reject);
        p.on('close', function (code) {
            if (code !== 0) return reject(new Error('ffmpeg exit ' + code + ': ' + err.slice(-300)));
            var m = /bench:\s*utime=([\d.]+)s\s*stime=([\d.]+)s\s*rtime=([\d.]+)s/.exec(err);
            if (!m) return reject(new Error('no bench line: ' + err.slice(-200)));
            resolve({ utime: parseFloat(m[1]), stime: parseFloat(m[2]), rtime: parseFloat(m[3]) });
        });
    });
}

function sizeOf(f) { try { return fs.statSync(f).size; } catch (e) { return 0; } }

var CASES = [
    { id: 'h265', name: 'H.265 / HEVC', crf: 28 },
    { id: 'vp9', name: 'VP9', crf: 32 },
    { id: 'av1', name: 'AV1 (SVT)', crf: 32 },
    { id: 'h264', name: 'H.264 / AVC', crf: 23 }
];
var BASE = { mode: 'crf', speedIndex: 2, audioMode: 'copy' };
var out = { env: {}, single: [], concurrent: [] };

function measure(name, ver, fn) {
    console.error('[run] ' + name + ' [' + ver + ']');
    return fn().then(function (r) {
        console.error('      wall=' + r.wall.toFixed(2) + 's cpu=' + r.cpu.toFixed(1) +
            's par=' + (r.cpu / r.wall).toFixed(1) + ' size=' + (r.size / 1048576).toFixed(2) + 'MB');
        return r;
    });
}

Promise.all([OLD.resolveBinaries(null), NEW.resolveBinaries(null)])
    .then(function () { return NEW.probe({ ffprobe: '/opt/homebrew/bin/ffprobe' }, SRC); })
    .then(function (meta) {
        out.env = {
            cpu: CPU, ffmpeg: '7.1.1',
            source: meta.video.width + 'x' + meta.video.height + ' @' + meta.video.fps + 'fps, 5s',
            srcSize: sizeOf(SRC)
        };

        var chain = Promise.resolve();

        // ---------- A. 单文件 ----------
        CASES.forEach(function (c) {
            ['old', 'new'].forEach(function (ver) {
                chain = chain.then(function () {
                    var Core = ver === 'old' ? OLD : NEW;
                    var a = argsFor(Core, meta, c.id, Object.assign({}, BASE, { codec: c.id, crf: c.crf }), 1);
                    var dst = path.join(OUT_DIR, c.id + '-' + ver + '.mp4');
                    return measure('single ' + c.id, ver, function () {
                        var t0 = Date.now();
                        return run(fullArgs(a.args, SRC, dst)).then(function (r) {
                            return {
                                codec: c.id, name: c.name, ver: ver, threads: a.threads,
                                wall: (Date.now() - t0) / 1000, cpu: r.utime + r.stime,
                                rtime: r.rtime, size: sizeOf(dst), args: a.args.join(' ')
                            };
                        });
                    }).then(function (r) { out.single.push(r); });
                });
            });
        });

        // ---------- B. 并发 8 文件 ----------
        ['h265', 'av1'].forEach(function (cid) {
            ['old', 'new'].forEach(function (ver) {
                chain = chain.then(function () {
                    var Core = ver === 'old' ? OLD : NEW;
                    var a = argsFor(Core, meta, cid, Object.assign({}, BASE, { codec: cid, crf: cid === 'h265' ? 28 : 32 }), 8);
                    return measure('concurrent x8 ' + cid, ver, function () {
                        var t0 = Date.now();
                        var jobs = [];
                        for (var i = 1; i <= 8; i++) {
                            jobs.push(run(fullArgs(a.args, '/tmp/vcbench/q' + i + '.mp4',
                                path.join(OUT_DIR, 'c8-' + cid + '-' + ver + '-' + i + '.mp4'))));
                        }
                        return Promise.all(jobs).then(function (rs) {
                            var wall = (Date.now() - t0) / 1000;
                            var cpu = rs.reduce(function (s, r) { return s + r.utime + r.stime; }, 0);
                            var size = 0;
                            for (var i = 1; i <= 8; i++) size += sizeOf(path.join(OUT_DIR, 'c8-' + cid + '-' + ver + '-' + i + '.mp4'));
                            return { codec: cid, name: cid.toUpperCase(), ver: ver, threads: a.threads, wall: wall, cpu: cpu, size: size, files: 8, args: a.args.join(' ') };
                        });
                    }).then(function (r) { out.concurrent.push(r); });
                });
            });
        });

        return chain;
    })
    .then(function () {
        fs.writeFileSync('/tmp/vcbench/encode-results.json', JSON.stringify(out, null, 2));
        console.error('DONE');
    })
    .catch(function (e) { console.error('FAILED: ' + e.message); process.exit(1); });
