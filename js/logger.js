/**
 * 日志模块
 *
 * 插件跑在 Eagle 的 Chromium 里，默认 devTools 是关的，一旦出错用户什么都
 * 看不到，只能干瞪眼。这里把日志同时送到三个地方：
 *
 *   1. 控制台（开着 devTools 时用）
 *   2. 内存环形缓冲（给插件内的日志面板看，默认保留最近 500 条）
 *   3. 磁盘文件（~/Library/Logs/… 或 %APPDATA%\…），方便出问题时直接翻
 *
 * 磁盘写入全部包 try/catch：Eagle 的沙箱、只读目录、权限问题都不允许让
 * 日志反过来把主流程拖垮。写不进去就只留内存副本，功能照常。
 */
;(function (root, factory) {
    var mod = factory();
    if (typeof module === 'object' && module.exports) module.exports = mod;
    root.Logger = mod;
})(typeof self !== 'undefined' ? self : globalThis, function () {
    'use strict';

    var MAX_LINES = 500;          // 内存缓冲保留条数
    var MAX_FILE_BYTES = 2 * 1024 * 1024;  // 日志文件超过 2MB 就轮转一次

    var buffer = [];
    var logFilePath = null;
    var diskOk = true;            // 磁盘是否可写，失败一次后不再重试每条的写操作
    var startedAt = new Date();
    var inConsoleEcho = false;    // emit 回显控制台时置位，防止接管 console 后无限递归
    var consoleCaptured = false;

    function nodeRequire(name) {
        try {
            if (typeof require === 'function') return require(name);
            if (typeof window !== 'undefined' && typeof window.require === 'function') {
                return window.require(name);
            }
        } catch (e) { /* 非 Node 环境 */ }
        return null;
    }

    function pad(n) { return n < 10 ? '0' + n : '' + n; }

    function stamp(d) {
        d = d || new Date();
        return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()) +
            '.' + String(d.getMilliseconds()).padStart(3, '0');
    }

    /** 计算日志文件路径（按平台） */
    function resolveLogPath() {
        if (logFilePath) return logFilePath;
        var os = nodeRequire('os');
        var path = nodeRequire('path');
        if (!os || !path) return null;
        try {
            var proc = nodeRequire('process');

            // 【测试隔离】本地 E2E 测试会加载真实的 index.html、跑真实的
            // Logger，默认就会往用户真实的 ~/Library/Logs 里写。跑一轮测试
            // 十几条记录，用户打开日志满屏都是测试造出来的 clip-A.mp4，
            // 根本分不清哪条是自己真正跑的那次 —— 日志直接失去排查价值。
            // 设置了这个环境变量就改道到临时目录，Eagle 里它永远不存在，
            // 正常路径不受影响。
            if (proc && proc.env && proc.env.EAGLE_PLUGIN_LOG_DIR) {
                logFilePath = path.join(
                    proc.env.EAGLE_PLUGIN_LOG_DIR, 'plugin.log');
                return logFilePath;
            }

            var home = os.homedir();
            var dir = (proc && proc.platform === 'win32')
                ? path.join(home, 'AppData', 'Roaming', 'Eagle 视频压缩')
                : path.join(home, 'Library', 'Logs', 'Eagle 视频压缩');
            logFilePath = path.join(dir, 'plugin.log');
            return logFilePath;
        } catch (e) {
            return null;
        }
    }

    /** 首次写入前确保目录存在 + 旧日志轮转 */
    var dirReady = false;
    function ensureDir() {
        if (dirReady) return true;
        var fs = nodeRequire('fs');
        var path = nodeRequire('path');
        var p = resolveLogPath();
        if (!fs || !path || !p) { dirReady = false; return false; }
        try {
            var dir = path.dirname(p);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            // 单文件超过上限就改名存档，避免无限增长
            try {
                var st = fs.statSync(p);
                if (st.size > MAX_FILE_BYTES) {
                    fs.renameSync(p, p.replace(/\.log$/, '.old.log'));
                }
            } catch (e) { /* 文件还不存在，正常 */ }
            dirReady = true;
        } catch (e) {
            diskOk = false;
            dirReady = false;
        }
        return dirReady;
    }

    function writeDisk(line) {
        if (!diskOk) return;
        var fs = nodeRequire('fs');
        if (!fs) { diskOk = false; return; }
        try {
            if (!ensureDir()) return;
            fs.appendFileSync(resolveLogPath(), line + '\n', 'utf8');
        } catch (e) {
            diskOk = false;   // 之后只保留内存副本，不再反复尝试
        }
    }

    function emit(level, args) {
        var msg;
        try {
            msg = Array.prototype.map.call(args, function (a) {
                if (a instanceof Error) return a.stack || (a.name + ': ' + a.message);
                if (typeof a === 'object') {
                    try { return JSON.stringify(a); } catch (e) { return String(a); }
                }
                return String(a);
            }).join(' ');
        } catch (e) {
            msg = '[日志序列化失败] ' + e.message;
        }

        var entry = { t: stamp(), level: level, msg: msg };
        buffer.push(entry);
        if (buffer.length > MAX_LINES) buffer.shift();

        var line = '[' + entry.t + '] [' + level + '] ' + msg;

        // 控制台。inConsoleEcho 用来告诉被接管的 console 包装器「这是回显，
        // 别再当成新日志收一遍」，否则 captureConsole 之后会无限递归。
        try {
            inConsoleEcho = true;
            if (level === 'ERROR') (console.error || console.log)(line);
            else if (level === 'WARN') (console.warn || console.log)(line);
            else (console.log || function () {})(line);
        } catch (e) { /* 忽略 */ } finally {
            inConsoleEcho = false;
        }

        writeDisk(line);
        return entry;
    }

    /**
     * 接管 console，让 console.log / warn / error 也一并进日志文件。
     *
     * 这条是被真实故障逼出来的：之前 plugin.js 里所有失败都只走了
     * console.error，而插件窗口默认没开 devTools —— 日志里干干净净一行
     * 错误都没有，只剩「插件启动」，排查时完全是黑盒。接管之后，任何一处
     * 忘了显式打日志的 catch 都会自动留下痕迹。
     *
     * 只能在真实浏览器环境里调（index.html 的内联脚本里），不要在
     * Node/jsdom 测试里调，否则测试输出会翻倍。
     */
    function captureConsole() {
        if (consoleCaptured) return;
        consoleCaptured = true;
        var levels = { log: 'info', info: 'info', debug: 'debug', warn: 'warn', error: 'error' };
        Object.keys(levels).forEach(function (name) {
            var orig;
            try { orig = console[name]; } catch (e) { return; }
            if (typeof orig !== 'function') return;
            var loggerName = levels[name];
            console[name] = function () {
                // emit 内部的回显：直接放行给原始实现，不要再收一次
                if (inConsoleEcho) return orig.apply(console, arguments);
                try {
                    emit(loggerName.toUpperCase(), arguments);   // emit 自己会回显一次
                } catch (e) {
                    try { orig.apply(console, arguments); } catch (e2) { /* 放弃 */ }
                }
            };
        });
    }

    /** 取最近 n 条（文本形式，给面板用） */
    function tail(n) {
        n = n || 200;
        var arr = buffer.slice(-n);
        return arr.map(function (e) {
            return '[' + e.t + '] [' + e.level + '] ' + e.msg;
        }).join('\n');
    }

    /** 全部日志（文本） */
    function dump() { return tail(MAX_LINES); }

    /**
     * 结构化诊断信息。出问题时让用户一键复制这个，
     * 比让他描述"点了一下没反应"有用得多。
     */
    function diagnostics(extra) {
        var os = nodeRequire('os');
        var proc = nodeRequire('process');
        // 这里必须用 resolveLogPath() 而不是缓存的 logFilePath：
        // 后者要等第一条日志真的落盘才会被赋值。插件刚起来还没写日志时
        // 它会是 null，诊断里就会显示「日志文件: (不可用)」——
        // 用户正想知道去哪儿看日志，却被这句话挡回去。
        var p = resolveLogPath();
        var info = {
            '插件': '视频压缩 v1.0.0',
            '时间': new Date().toString(),
            '启动时间': startedAt.toString(),
            '平台': os ? (os.platform() + ' ' + os.release() + ' ' + os.arch()) : '未知',
            'Node': proc ? proc.version : '未知',
            '用户代理': (typeof navigator !== 'undefined' && navigator.userAgent) || '未知',
            '日志文件': p || '(无法计算路径)',
            '日志已落盘': !!(p && dirReady && diskOk),
            '磁盘可写': diskOk
        };
        if (extra) Object.keys(extra).forEach(function (k) { info[k] = extra[k]; });
        return info;
    }

    return {
        info: function () { return emit('INFO', arguments); },
        warn: function () { return emit('WARN', arguments); },
        error: function () { return emit('ERROR', arguments); },
        debug: function () { return emit('DEBUG', arguments); },
        tail: tail,
        dump: dump,
        diagnostics: diagnostics,
        captureConsole: captureConsole,
        logPath: function () { return resolveLogPath(); },
        clear: function () { buffer.length = 0; },
        get lines() { return buffer.slice(); }
    };
});
