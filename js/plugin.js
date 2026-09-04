/**
 * Eagle 插件入口
 *
 * 只负责接住 Eagle 的生命周期回调，具体逻辑交给 App。
 *
 * 【重要】初始化入口做了多层保护，每一条都是踩过坑之后加的：
 *
 * 1. 多入口触发：onPluginCreate / onPluginRun / onPluginShow / window.onload
 *    外加一个轮询兜底，靠 booted 标志防重入。Eagle 官方文档明确说「如果插件
 *    不需要 manifest 信息就可以运行，也可以使用 window.onload 来开发」——说明
 *    onPluginCreate 并不是在所有情况下都保证触发。只挂单一入口时，一旦它没被
 *    调用，App.init() 就永远不会执行，表现是：下拉框全是空的、状态栏永远停在
 *    HTML 里的初始文案「正在检测 FFmpeg…」。
 *
 * 2. 逐个安全注册：每个生命周期回调单独 try/catch。如果某个 Eagle 版本少了
 *    其中一个 API，抛错只会让那一个注册失败，不会连带炸掉整个 IIFE（IIFE 一炸，
 *    后面的初始化代码就全不执行了）。
 *
 * 3. 不假设 eagle 已经注入：全局 eagle 可能是异步挂上来的。脚本执行时如果它
 *    还不存在，就直接引用会抛 ReferenceError（严格模式下未声明变量不能读），
 *    而这个异常会被 catch 吃掉再 console.error 出去 —— 日志里一片空白，界面
 *    完全没反应，用户只能看到「卡住了」。现在改成：取不到就等，每 200ms 看一次。
 *
 * 4. 降级启动：eagle 迟迟不来不代表插件没用。只要 window.App 在，就以「无 Eagle
 *    API」模式启动 —— 本地文件照样能压缩，只是读不到 Eagle 选中素材、也回写不了。
 *    总比整个界面死掉强。
 *
 * 5. 全程留痕：任何一步失败都写进日志文件，不再只走 console.error。真到
 *    走投无路时，直接在界面上弹一条红色提示，告诉用户去哪儿看日志。
 */
(function () {
    'use strict';

    var booted = false;
    var POLL_MS = 200;          // 轮询间隔
    var MAX_WAIT_MS = 10000;    // 等 eagle / App 出现的上限
    var waited = 0;
    var attempts = 0;
    var lastWaitLog = -1;

    /** 写日志。Logger 不在时退回 console，绝不因为记日志再抛一次 */
    function L(level, msg) {
        try {
            if (typeof Logger !== 'undefined' && Logger && typeof Logger[level] === 'function') {
                Logger[level](msg);
                return;
            }
        } catch (e) { /* 落到 console */ }
        try { (console[level] || console.log)(msg); } catch (e) {}
    }

    /**
     * 安全取 eagle。
     * 注意不能直接写 `eagle` —— 严格模式下变量未声明时读取会抛
     * ReferenceError，而 `typeof eagle` 是安全的。
     */
    function getEagle() {
        try {
            if (typeof eagle !== 'undefined' && eagle) return eagle;
        } catch (e) { /* 忽略 */ }
        try {
            if (typeof window !== 'undefined' && window.eagle) return window.eagle;
        } catch (e) { /* 忽略 */ }
        return null;
    }

    function appReady() {
        try {
            return !!(window.App && typeof window.App.init === 'function');
        } catch (e) {
            return false;
        }
    }

    function escapeHtml(s) {
        return String(s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function logPathText() {
        try {
            if (typeof Logger !== 'undefined' && Logger && Logger.logPath) {
                return Logger.logPath() || '(不可用)';
            }
        } catch (e) { /* 忽略 */ }
        return '(不可用)';
    }

    /** 走投无路时，把失败原因直接拍到界面上，别让用户对着「正在检测」发呆 */
    function banner(title, detail, isFatal) {
        L(isFatal ? 'error' : 'warn', title + ' | ' + detail);
        try { if (window.LogUI && typeof window.LogUI.show === 'function') window.LogUI.show(true); }
        catch (e) { /* 忽略 */ }
        try {
            if (document.getElementById('bootBanner')) return;
            var box = document.createElement('div');
            box.id = 'bootBanner';
            box.className = 'boot-banner' + (isFatal ? ' fatal' : '');
            box.innerHTML =
                '<div class="bb-title">' + escapeHtml(title) + '</div>' +
                '<div class="bb-detail">' + escapeHtml(detail) + '</div>' +
                '<div class="bb-path">日志：' + escapeHtml(logPathText()) + '（点右上角「日志」可直接查看）</div>';
            document.body.appendChild(box);
        } catch (e) { /* 忽略 */ }
    }

    function boot(reason) {
        if (booted) return;

        var api = getEagle();
        var ready = appReady();

        if (!ready) {
            L('warn', '[boot:' + reason + '] App 尚未就绪（app.js 未执行完？），继续等待');
            return;
        }

        if (!api && waited < MAX_WAIT_MS) {
            // eagle 还没注入。不要在这里硬启动，再等等看。
            // 轮询每 200ms 一次，全量记会刷出几十行同样的日志把有用的信息淹掉，
            // 所以每 2 秒才记一条。
            if (waited - lastWaitLog >= 2000) {
                lastWaitLog = waited;
                L('warn', '[boot:' + reason + '] eagle 尚未注入，继续等待（已等 ' + waited + 'ms）');
            }
            return;
        }

        // eagle 是异步注入的话，脚本执行那会儿注册落空了，这里补一次
        registerAll(api);

        booted = true;
        attempts++;
        if (!api) {
            banner('未能获取 Eagle API', '将以「本地文件」模式启动：可以添加文件压缩，但读不到 Eagle 选中素材、也无法回写替换。', false);
        }
        L('info', '[boot:' + reason + '] 开始初始化（eagle=' + (api ? '就绪' : '缺失') + '）');

        try {
            var r = window.App.init(api);
            if (r && typeof r.catch === 'function') {
                r.catch(function (err) {
                    L('error', '[boot:' + reason + '] 初始化失败: ' +
                        (err && err.stack ? err.stack : (err && err.message ? err.message : String(err))));
                });
            }
        } catch (e) {
            booted = false;   // 允许后续入口重试
            attempts++;
            L('error', '[boot:' + reason + '] 初始化抛异常: ' + (e && e.stack ? e.stack : String(e)));
            if (attempts >= 3) {
                banner('插件初始化失败', (e && e.message ? e.message : String(e)), true);
            }
        }
    }

    /** 安全注册一个生命周期回调，单个失败不影响其他 */
    function on(api, apiName, handler) {
        try {
            if (!api || typeof api[apiName] !== 'function') {
                L('warn', '[视频压缩] Eagle 不支持 ' + apiName + '，已跳过');
                return;
            }
            api[apiName](handler);
        } catch (e) {
            L('error', '[视频压缩] 注册 ' + apiName + ' 失败: ' + (e && e.message ? e.message : String(e)));
        }
    }

    var registered = false;

    /**
     * 注册全部生命周期回调。
     *
     * 必须允许「拿到 eagle 之后再补注册」：eagle 如果是异步注入的，脚本
     * 执行的那一刻它还不存在，此时注册会全部落空，而且永远不会重来一次 ——
     * 插件就再也收不到 onPluginRun / onPluginShow / 主题切换了。
     */
    function registerAll(api) {
        if (registered || !api) return;
        registered = true;

        on(api, 'onPluginCreate', function (plugin) {
            L('info', '[视频压缩] onPluginCreate ' + (plugin && plugin.manifest ? plugin.manifest.name : ''));
            boot('onPluginCreate');
        });

        // 窗口再次显示时，顺带补一次 Eagle 选中素材的自动导入。
        // 只放在 onShow 里：boot() 有 booted 防重入，靠它补不了；
        // 而 App.onShow() 内部只在列表为空时才真的动手，不会覆盖用户
        // 已经编辑过的内容。
        function onShowSafe() {
            try {
                if (window.App && typeof window.App.onShow === 'function') window.App.onShow();
            } catch (e) {
                L('warn', '[视频压缩] onShow 回调失败: ' + (e && e.message ? e.message : e));
            }
        }

        on(api, 'onPluginRun', function () {
            L('info', '[视频压缩] onPluginRun');
            boot('onPluginRun');   // 再次打开插件面板时补一次
            onShowSafe();
        });

        on(api, 'onPluginShow', function () {
            L('info', '[视频压缩] onPluginShow');
            boot('onPluginShow');
            onShowSafe();
        });

        on(api, 'onPluginHide', function () {
            L('debug', '[视频压缩] onPluginHide');
        });

        on(api, 'onPluginBeforeExit', function () {
            L('debug', '[视频压缩] onPluginBeforeExit');
        });

        on(api, 'onThemeChanged', function (theme) {
            L('debug', '[视频压缩] theme changed: ' + theme);
            try { window.App.applyTheme(); } catch (e) {}
        });
    }

    L('info', '[plugin.js] 已加载 | eagle=' + (getEagle() ? '就绪' : '缺失') +
        ' | App=' + (appReady() ? '就绪' : '缺失'));

    // 入口一：Eagle 生命周期。脚本执行时 eagle 可能已经在，也可能还没到，
    // 后者靠 boot() 里拿到 api 之后补注册。
    registerAll(getEagle());

    // 入口二：文档推荐的标准兜底
    window.addEventListener('load', function () {
        L('info', '[视频压缩] window.onload');
        boot('window.onload');
    });

    // 入口三：轮询兜底。
    // 前面几道都是「一次性机会」，全都错过就没人再尝试了。这里持续轮询，
    // 直到 eagle 和 App 都到位、或者超过上限后降级启动。
    var pollTimer = setInterval(function () {
        if (booted) { clearInterval(pollTimer); return; }
        waited += POLL_MS;
        boot('poll-' + waited + 'ms');
        if (waited >= MAX_WAIT_MS) {
            clearInterval(pollTimer);
            if (!booted) {
                // 到点还没起来：能降级就降级，连 App 都没有才是真的没救
                if (appReady()) {
                    var api = getEagle();
                    booted = true;
                    banner('Eagle API 超时未就绪',
                        '10 秒内没有拿到 Eagle API，已以「本地文件」模式启动：可添加文件压缩，但读不到 Eagle 选中素材、也无法回写替换。',
                        false);
                    try {
                        var r = window.App.init(api);
                        if (r && typeof r.catch === 'function') {
                            r.catch(function (err) {
                                L('error', '降级启动后初始化仍失败: ' + (err && err.stack ? err.stack : String(err)));
                            });
                        }
                    } catch (e) {
                        booted = false;
                        banner('插件初始化失败', (e && e.message ? e.message : String(e)), true);
                    }
                } else {
                    banner('插件初始化失败',
                        '等待 ' + (MAX_WAIT_MS / 1000) + ' 秒后仍未检测到 App 模块（app.js 未加载成功？），插件无法启动。',
                        true);
                }
            }
        }
    }, POLL_MS);
})();
