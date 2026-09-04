/**
 * 日志面板交互
 *
 * 把 Logger 内存缓冲渲染到抽屉里，并提供「复制诊断信息 / 复制日志 /
 * 打开日志目录」三个出口。用户反馈问题时，直接把诊断信息贴过来，
 * 比描述现象有用得多。
 */
(function () {
    'use strict';

    var drawer, body, timer = null, visible = false;

    function $(id) { return document.getElementById(id); }

    function render() {
        if (!visible || !body) return;
        var txt = (window.Logger && window.Logger.tail(300)) || '(日志模块未加载)';
        body.textContent = txt;
        // 自动滚到底部，最新的一眼能看到
        body.scrollTop = body.scrollHeight;
    }

    function show(on) {
        visible = on;
        if (!drawer) return;
        drawer.hidden = !on;
        if (on) {
            render();
            // 转码过程中日志会持续增加，定时刷新
            if (!timer) timer = setInterval(render, 1000);
            var p = window.Logger && window.Logger.logPath();
            var el = $('logPath');
            if (el) el.textContent = p ? ('日志文件: ' + p) : '日志文件: 不可用（无磁盘权限）';
        } else if (timer) {
            clearInterval(timer);
            timer = null;
        }
    }

    /** 复制文本，优先用 Eagle/浏览器的剪贴板 API，失败就退回 execCommand */
    function copyText(text) {
        function fallback() {
            try {
                var ta = document.createElement('textarea');
                ta.value = text;
                ta.style.position = 'fixed';
                ta.style.opacity = '0';
                document.body.appendChild(ta);
                ta.select();
                var ok = document.execCommand('copy');
                document.body.removeChild(ta);
                return ok;
            } catch (e) { return false; }
        }
        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(text).then(function () {
                    flash('已复制到剪贴板');
                }, function () {
                    flash(fallback() ? '已复制到剪贴板' : '复制失败，请手动选择文本');
                });
                return;
            }
        } catch (e) { /* 走 fallback */ }
        flash(fallback() ? '已复制到剪贴板' : '复制失败，请手动选择文本');
    }

    var flashTimer = null;
    function flash(msg) {
        var el = $('logPath');
        if (!el) return;
        var old = el.textContent;
        el.textContent = msg;
        if (flashTimer) clearTimeout(flashTimer);
        flashTimer = setTimeout(function () { el.textContent = old; }, 1800);
    }

    /** 在文件管理器里显示日志文件 */
    function revealLog() {
        var p = window.Logger && window.Logger.logPath();
        if (!p) { flash('日志文件不可用'); return; }
        var done = false;
        try {
            // 优先用 Eagle 的 shell API
            if (window.eagle && window.eagle.shell &&
                typeof window.eagle.shell.showItemInFolder === 'function') {
                window.eagle.shell.showItemInFolder(p);
                done = true;
            }
        } catch (e) { /* 继续尝试系统命令 */ }

        if (!done) {
            try {
                var cp = window.require ? window.require('child_process') : null;
                var proc = window.require ? window.require('process') : null;
                if (cp) {
                    if (proc && proc.platform === 'darwin') cp.spawn('open', ['-R', p]);
                    else if (proc && proc.platform === 'win32') cp.spawn('explorer', ['/select,', p]);
                    else cp.spawn('xdg-open', [require('path').dirname(p)]);
                    done = true;
                }
            } catch (e) { /* 忽略 */ }
        }
        flash(done ? '已打开日志目录' : '无法自动打开，日志路径已显示在上方');
    }

    /**
     * 采集 Eagle 环境信息。
     *
     * 官方文档写明「extraModule 需要 Eagle 4.0 beta 7 以上」，低于该版本时
     * eagle.extraModule 根本不存在，依赖插件这条路直接走不通——这恰好是
     * 「一直检测不到 FFmpeg」的常见原因之一。把环境探测结果放进诊断信息，
     * 用户贴过来就能一眼看出是哪一环的问题，不用反复来回问。
     *
     * 全程只做存在性判断，不调用任何 API，避免在老版本上二次触发异常。
     */
    function eagleEnv() {
        var out = {};
        try {
            var e = window.eagle;
            if (!e) return { 'Eagle API': '(不可用)' };
            out['Eagle API'] = '已注入';
            if (e.app) {
                out['主题'] = e.app.theme || '(未知)';
                if (typeof e.app.version !== 'undefined') out['Eagle 版本'] = e.app.version;
                if (typeof e.app.build !== 'undefined') out['构建号'] = e.app.build;
            }
            var em = e.extraModule;
            if (!em) {
                out['extraModule'] = '不存在（Eagle 版本可能低于 4.0 beta 7，将直接使用系统 FFmpeg）';
                return out;
            }
            out['extraModule'] = '存在';
            var fm = em.ffmpeg;
            if (!fm) {
                out['FFmpeg 依赖插件'] = '未挂载';
                return out;
            }
            var methods = Object.keys(fm).filter(function (k) {
                return typeof fm[k] === 'function';
            });
            out['FFmpeg 依赖插件'] = '已挂载，方法: ' + (methods.join(', ') || '(无)');
        } catch (err) {
            out['环境探测异常'] = err && err.message ? err.message : String(err);
        }
        return out;
    }

    function bind() {
        drawer = $('logDrawer');
        body = $('logBody');
        if (!drawer) return;

        var btn = $('btnToggleLog');
        if (btn) btn.addEventListener('click', function () { show(!visible); });

        var close = $('btnCloseLog');
        if (close) close.addEventListener('click', function () { show(false); });

        var copyLog = $('btnCopyLog');
        if (copyLog) copyLog.addEventListener('click', function () {
            copyText((window.Logger && window.Logger.dump()) || '');
        });

        var copyDiag = $('btnCopyDiag');
        if (copyDiag) copyDiag.addEventListener('click', function () {
            // 先放 Eagle 环境，再放插件内部状态：排查时顺序就是「环境 → 依赖 → 自身」
            var extra = eagleEnv();
            try {
                var st = window.App && window.App._state;
                if (st) {
                    extra['FFmpeg 就绪'] = !!st.ready;
                    extra['FFmpeg 路径'] = st.bins ? st.bins.ffmpeg : '(未找到)';
                    extra['FFmpeg 来源'] = st.bins ? st.bins.source : '-';
                    extra['FFmpeg 版本'] = st.bins ? (st.bins.version || '未知') : '-';
                    extra['任务数'] = (st.tasks || []).length;
                } else {
                    extra['插件状态'] = '未初始化（App._state 不存在）';
                }
            } catch (e) { /* 忽略 */ }
            var info = (window.Logger && window.Logger.diagnostics(extra)) || {};
            var lines = Object.keys(info).map(function (k) { return k + ': ' + info[k]; });
            lines.push('', '----- 最近日志 -----', (window.Logger && window.Logger.tail(100)) || '');
            copyText(lines.join('\n'));
        });

        var reveal = $('btnRevealLog');
        if (reveal) reveal.addEventListener('click', revealLog);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bind);
    } else {
        bind();
    }

    window.LogUI = {
        show: show,
        isVisible: function () { return visible; },
        // 导出来给本地测试用：不用真的在 Eagle 里点按钮，也能验证诊断采集逻辑
        eagleEnv: eagleEnv
    };
})();
