#!/usr/bin/env node
/**
 * 多语言语言包一致性检查。
 *
 * Eagle 在运行时按 manifest.languages 加载 _locales/<lang>.json，缺键时不会
 * 报错，只会把 key 原样渲染出来 —— 界面上出现 "ui.startCompression" 这种
 * 字符串是唯一的症状，而且只在切到那个语系时才看得到。所以键的一致性必须
 * 在提交前用脚本盯住，不能靠人肉切八种语言点一遍。
 *
 * 检查项：
 *   1. manifest.languages / fallbackLanguage 与 _locales/ 下的文件互相对齐
 *   2. 每个语系的键集合与 fallback 语系完全一致（缺键 / 多余键）
 *   3. 同一个键在各语系中的 {{占位符}} 集合一致
 *      —— 少写一个 {{count}}，那条文案就永远显示不出数字
 *   4. 每个语系都有 manifest.app.name（缺了插件名会变成原始的模板字符串）
 *   5. 值不为空、不与 fallback 语系逐字相同（后者只是提示，不算失败）
 *   6. 代码里引用了但语言包没定义的键（会直接漏出 key）
 *   7. 语言包定义了但代码从没引用的键（多半是删代码时漏掉的死键）
 *
 * 用法:
 *   node tools/check-i18n.js            # 检查
 *   node tools/check-i18n.js --json     # 机器可读输出
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const LOCALES_DIR = path.join(ROOT, '_locales');

/** 会被扫描 key 引用的源文件。新增源文件时记得加进来。 */
const SOURCE_FILES = ['index.html', 'js/app.js', 'js/ffmpeg.js', 'js/format.js', 'js/logger-ui.js', 'js/logger.js', 'js/i18n.js'];

/** 只有这些顶层命名空间下的字符串才会被当成翻译键，避免把 'settings.json'、'H.264' 误判成缺失的键。 */
const NAMESPACES = ['ui', 'runtime', 'manifest'];

/** 这些键由框架或宿主消费，代码里不会出现引用。 */
const IMPLICIT_KEYS = new Set(['manifest.app.name']);

/**
 * 已确认「与中文同形但翻译正确」的键，不再报疑似漏翻。
 *
 * ja_JP 的 runtime.analysisInProgress = "分析中…"：日语「分析」是正确用词，
 * 且该语言包里 waitingAnalysis / analysisDeferred / sampleProgress /
 * analysisStopped 等 7 个键统一用「分析」，只是这一条恰好和中文逐字相同。
 * 改成「解析」会破坏该语系内部的用词一致性。
 */
const KNOWN_IDENTICAL = {
    ja_JP: ['runtime.analysisInProgress']
};

const errors = [];
const warnings = [];

function fail(msg) { errors.push(msg); }
function warn(msg) { warnings.push(msg); }

function readJson(file) {
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
        fail(`${path.relative(ROOT, file)} 不是合法 JSON：${e.message}`);
        return null;
    }
}

/** 把嵌套对象拍平成 "ui.brandName" 这样的点分键。 */
function flatten(obj, prefix = '') {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
        const key = prefix + k;
        if (v && typeof v === 'object' && !Array.isArray(v)) Object.assign(out, flatten(v, key + '.'));
        else out[key] = v;
    }
    return out;
}

/** 取出文案里的 {{name}} 占位符名字集合。 */
function placeholders(text) {
    const set = new Set();
    for (const m of String(text).matchAll(/{{\s*([\w.]+)\s*}}/g)) set.add(m[1]);
    return set;
}

function sortedList(set) { return [...set].sort().join(', '); }

// ---- 1. manifest 与 _locales 目录对齐 --------------------------------------

const manifest = readJson(path.join(ROOT, 'manifest.json'));
if (!manifest) { report(); process.exit(1); }

const declared = manifest.languages || [];
const fallbackLang = manifest.fallbackLanguage;

if (!declared.length) fail('manifest.json 没有声明 languages');
if (!fallbackLang) fail('manifest.json 没有声明 fallbackLanguage');
else if (!declared.includes(fallbackLang)) fail(`fallbackLanguage "${fallbackLang}" 不在 languages 列表里`);

const onDisk = fs.existsSync(LOCALES_DIR)
    ? fs.readdirSync(LOCALES_DIR).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).sort()
    : [];

for (const lang of declared) {
    if (!onDisk.includes(lang)) fail(`manifest 声明了 ${lang}，但 _locales/${lang}.json 不存在`);
}
for (const lang of onDisk) {
    if (!declared.includes(lang)) fail(`_locales/${lang}.json 存在，但 manifest.languages 没有声明 —— Eagle 不会加载它`);
}

// Eagle 目前只认这八个语系代码，写错了 Eagle 会静默忽略整个语言包。
const EAGLE_SUPPORTED = ['en', 'ja_JP', 'es_ES', 'de_DE', 'zh_TW', 'zh_CN', 'ko_KR', 'ru_RU'];
for (const lang of declared) {
    if (!EAGLE_SUPPORTED.includes(lang)) fail(`"${lang}" 不是 Eagle 支持的语系代码，支持的是：${EAGLE_SUPPORTED.join(', ')}`);
}

// ---- 2~5. 键集合、占位符、空值 ----------------------------------------------

const tables = {};
for (const lang of onDisk) {
    const data = readJson(path.join(LOCALES_DIR, `${lang}.json`));
    if (data) tables[lang] = flatten(data);
}

const base = tables[fallbackLang];
if (!base) fail(`读不到 fallback 语系 ${fallbackLang} 的语言包，后续键检查已跳过`);

const definedKeys = base ? Object.keys(base) : [];

if (base) {
    const baseKeys = new Set(definedKeys);
    for (const [lang, table] of Object.entries(tables)) {
        if (lang === fallbackLang) continue;
        const keys = new Set(Object.keys(table));

        const missing = [...baseKeys].filter((k) => !keys.has(k));
        const extra = [...keys].filter((k) => !baseKeys.has(k));
        if (missing.length) fail(`${lang} 缺少 ${missing.length} 个键：${missing.join(', ')}`);
        if (extra.length) fail(`${lang} 多出 ${extra.length} 个 ${fallbackLang} 没有的键：${extra.join(', ')}`);

        for (const key of baseKeys) {
            if (!keys.has(key)) continue;
            const want = placeholders(base[key]);
            const got = placeholders(table[key]);
            if (sortedList(want) !== sortedList(got)) {
                fail(`${lang} 的 "${key}" 占位符不一致：期望 {${sortedList(want) || '空'}}，实际 {${sortedList(got) || '空'}}`);
            }
        }
    }

    for (const [lang, table] of Object.entries(tables)) {
        if (!table['manifest.app.name']) fail(`${lang} 缺少 manifest.app.name，插件名会显示成模板字符串`);
        for (const [key, value] of Object.entries(table)) {
            if (typeof value !== 'string') fail(`${lang} 的 "${key}" 不是字符串`);
            else if (!value.trim()) fail(`${lang} 的 "${key}" 是空字符串`);
        }
    }

    // 未翻译只是提示：H.265 / CRF 这类术语本来就不该翻译。
    // 简繁之间「取消」「移除」「未知」本来就同形，两者互比会刷出大量假阳性，跳过。
    const SAME_SCRIPT = [['zh_CN', 'zh_TW']];
    const sameScript = (a, b) => SAME_SCRIPT.some((pair) => pair.includes(a) && pair.includes(b));
    for (const [lang, table] of Object.entries(tables)) {
        if (lang === fallbackLang || sameScript(lang, fallbackLang)) continue;
        const allowed = new Set(KNOWN_IDENTICAL[lang] || []);
        const same = definedKeys.filter(
            (k) => !allowed.has(k) && table[k] === base[k] && /[\u4e00-\u9fa5]/.test(String(base[k]))
        );
        if (same.length) warn(`${lang} 有 ${same.length} 个键与 ${fallbackLang} 逐字相同，疑似漏翻：${same.join(', ')}`);
    }
}

// ---- 6~7. 代码引用与语言包定义的双向比对 -----------------------------------

let source = '';
for (const rel of SOURCE_FILES) {
    const file = path.join(ROOT, rel);
    if (fs.existsSync(file)) source += '\n' + fs.readFileSync(file, 'utf8');
}

// 键在代码里出现的形态不止 tr('x.y') 一种：还有 [['ui.codec', '编码格式'], ...]
// 这样的表驱动写法，以及 'ui.hdr_' + kind 这种拼接。所以按「字面量形状」收集，
// 再用命名空间过滤，比逐个匹配调用形式更不容易漏。
const literals = new Set();
for (const m of source.matchAll(/['"`]([A-Za-z][\w]*(?:\.[\w]+)*[._]?)['"`]/g)) literals.add(m[1]);
for (const m of source.matchAll(/data-i18n(?:-[\w-]+)?\s*=\s*"([\w.]+)"/g)) literals.add(m[1]);

const inNamespace = (s) => NAMESPACES.some((ns) => s === ns || s.startsWith(ns + '.'));
// 以 '.' 或 '_' 结尾的字面量是拼接前缀（'ui.hdr_' + kind），命中它的键都算被引用。
const prefixes = [...literals].filter((s) => inNamespace(s) && (s.endsWith('.') || s.endsWith('_')));
const referenced = new Set([...literals].filter(inNamespace));

if (base) {
    const definedSet = new Set(definedKeys);
    const missingInLocale = [...referenced].filter(
        (k) => !definedSet.has(k) && !k.endsWith('.') && !k.endsWith('_') && !prefixes.some((p) => k.startsWith(p))
    );
    for (const key of missingInLocale) {
        fail(`代码引用了 "${key}"，但 ${fallbackLang} 语言包没有定义 —— 界面会直接显示这个 key`);
    }

    const unreferenced = definedKeys.filter(
        (k) => !IMPLICIT_KEYS.has(k) && !referenced.has(k) && !prefixes.some((p) => k.startsWith(p) && k !== p)
    );
    for (const key of unreferenced) {
        warn(`"${key}" 在 8 个语言包里都有定义，但代码里找不到引用，疑似死键`);
    }
}

// ---- 输出 -------------------------------------------------------------------

function report() {
    const asJson = process.argv.includes('--json');
    if (asJson) {
        console.log(JSON.stringify({ ok: errors.length === 0, errors, warnings }, null, 2));
        return;
    }
    for (const w of warnings) console.log(`  warn  ${w}`);
    for (const e of errors) console.log(`  FAIL  ${e}`);
    if (errors.length === 0) {
        console.log(`  i18n OK — ${declared.length} 个语系 × ${definedKeys.length} 个键，占位符一致` +
            (warnings.length ? `（${warnings.length} 条提示）` : ''));
    }
}

report();
process.exit(errors.length ? 1 : 0);
