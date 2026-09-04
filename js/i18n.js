/*
 * Eagle 内建 i18next 的轻量适配层。
 *
 * - 语言包由 manifest.json 的 languages / fallbackLanguage 声明并由 Eagle 加载。
 * - 所有调用都保留中文 fallback：本地 jsdom、旧版 Eagle 或 i18next 未就绪时，
 *   插件仍能正常启动，不会因翻译模块缺失变成空白页面。
 */
;(function (root) {
    'use strict';

    function getEagleLocale() {
        try {
            var api = (typeof eagle !== 'undefined' && eagle) || root.eagle;
            var value = api && api.app ? api.app.locale : null;
            return typeof value === 'string' && value ? value : 'zh_CN';
        } catch (e) {
            return 'zh_CN';
        }
    }

    function fallbackFormat(text, vars) {
        if (!vars) return text;
        return String(text).replace(/{{\s*([\w.]+)\s*}}/g, function (_, name) {
            return vars[name] === undefined || vars[name] === null ? '' : String(vars[name]);
        });
    }

    function t(key, fallback, vars) {
        var value = null;
        try {
            if (root.i18next && typeof root.i18next.t === 'function') {
                value = root.i18next.t(key, vars || {});
            }
        } catch (e) {
            // i18next 没就绪时使用 HTML / JS 中的中文 fallback，不阻断主流程。
        }
        if (!value || value === key) value = fallback || key;
        return fallbackFormat(value, vars);
    }

    function apply(scope) {
        var host = scope || document;
        var nodes = host.querySelectorAll ? host.querySelectorAll('[data-i18n]') : [];
        for (var i = 0; i < nodes.length; i++) {
            var node = nodes[i];
            var key = node.getAttribute('data-i18n');
            var fallback = node.getAttribute('data-i18n-fallback') || node.textContent;
            node.textContent = t(key, fallback);
        }
        var attrs = ['title', 'placeholder', 'aria-label'];
        for (var j = 0; j < attrs.length; j++) {
            var attr = attrs[j];
            var attrNodes = host.querySelectorAll ? host.querySelectorAll('[data-i18n-' + attr + ']') : [];
            for (var k = 0; k < attrNodes.length; k++) {
                var item = attrNodes[k];
                var attrKey = item.getAttribute('data-i18n-' + attr);
                item.setAttribute(attr, t(attrKey, item.getAttribute(attr) || ''));
            }
        }
        try { document.documentElement.lang = getEagleLocale().replace('_', '-'); } catch (e2) {}
    }

    root.I18n = {
        t: t,
        apply: apply,
        locale: getEagleLocale
    };
})(typeof self !== 'undefined' ? self : globalThis);
