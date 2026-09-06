#!/usr/bin/env node
/**
 * 多语言简述文档检查。
 *
 * docs/<语系>.md 是提交到 Eagle 插件中心和给用户看的简述，每个语系一份，
 * 结构必须完全一致 —— 只包含「插件简述 / 插件使用说明 / 版本日志」三节。
 * 章节标题本身要翻译，所以不能按标题文字来定位，用不可见的 HTML 注释锚点。
 *
 * 检查项：
 *   1. manifest.languages 里的每个语系都有对应的 docs/<语系>.md，且没有多余文件
 *   2. 每份文档恰好含三个锚点，顺序固定，没有第四个二级章节
 *   3. 三节都不为空
 *   4. 版本日志里最新的版本号 == manifest.json 的 version
 *      —— 发版时最容易漏的就是「改了 manifest 忘了写日志」
 *   5. 各语系的版本号列表完全一致（漏译某一版会让那个语系的用户看不到变更）
 *   6. 没有残留的占位符（TODO / TBD / <!-- fill -->）
 *   7. README.md / README.zh-CN.md 的变更日志最新条目也等于 manifest 的 version
 *
 * 用法:
 *   node tools/check-docs.js
 *   node tools/check-docs.js --json
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DOCS_DIR = path.join(ROOT, 'docs');

/** 三个章节锚点，顺序即文档中必须出现的顺序。 */
const SECTIONS = ['overview', 'usage', 'changelog'];
const SECTION_LABEL = { overview: '插件简述', usage: '插件使用说明', changelog: '版本日志' };

/** README 里变更日志的位置，用于和 manifest 版本对齐。 */
const READMES = ['README.md', 'README.zh-CN.md'];

// 必须大小写敏感：西班牙语的 "todo"、"Analizar todo" 是正常词，只有全大写的
// TODO/TBD/FIXME/XXX 才是脚本插入的待填占位符。
const PLACEHOLDER = /\b(TODO|TBD|FIXME|XXX)\b|<!--\s*fill\s*-->/;

const errors = [];
const warnings = [];
const fail = (m) => errors.push(m);
const warn = (m) => warnings.push(m);

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const declared = manifest.languages || [];
const version = manifest.version;

if (!/^\d+\.\d+\.\d+$/.test(String(version))) {
    fail(`manifest.json 的 version "${version}" 不是 x.y.z 形式`);
}

// ---- 1. 文件齐全 -------------------------------------------------------------

if (!fs.existsSync(DOCS_DIR)) {
    fail('docs/ 目录不存在');
    report();
    process.exit(1);
}

const onDisk = fs.readdirSync(DOCS_DIR).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3));
for (const lang of declared) {
    if (!onDisk.includes(lang)) fail(`manifest 声明了 ${lang}，但 docs/${lang}.md 不存在`);
}
for (const name of onDisk) {
    if (!declared.includes(name)) fail(`docs/${name}.md 不在 manifest.languages 里 —— 语系代码写错了？`);
}

// ---- 2~6. 逐份文档校验 -------------------------------------------------------

/** 按锚点把文档切成三段。返回 { overview, usage, changelog } 或 null。 */
function split(text) {
    const found = [];
    for (const m of text.matchAll(/<!--\s*section:(\w+)\s*-->/g)) {
        found.push({ name: m[1], start: m.index + m[0].length });
    }
    if (found.map((f) => f.name).join(',') !== SECTIONS.join(',')) return { bad: found.map((f) => f.name) };
    const out = {};
    found.forEach((f, i) => {
        const end = i + 1 < found.length ? text.lastIndexOf('<!--', found[i + 1].start) : text.length;
        out[f.name] = text.slice(f.start, end).trim();
    });
    return out;
}

/** 取出 "### 1.0.2" 这样的版本标题，按文档中出现的顺序返回。 */
function versionsOf(changelog) {
    return [...changelog.matchAll(/^###\s+v?(\d+\.\d+\.\d+)\s*$/gm)].map((m) => m[1]);
}

const versionsByLang = {};

for (const lang of declared) {
    const file = path.join(DOCS_DIR, `${lang}.md`);
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, 'utf8');

    const parts = split(text);
    if (parts.bad) {
        fail(`docs/${lang}.md 的章节锚点是 [${parts.bad.join(', ') || '无'}]，应为 [${SECTIONS.join(', ')}]`);
        continue;
    }

    // 除三个章节标题外不允许有别的二级标题：简述文档只放这三节。
    const h2 = [...text.matchAll(/^##\s+(.+)$/gm)].map((m) => m[1].trim());
    if (h2.length !== SECTIONS.length) {
        fail(`docs/${lang}.md 有 ${h2.length} 个二级标题（${h2.join(' / ')}），只允许 ${SECTIONS.length} 个：${SECTIONS.map((s) => SECTION_LABEL[s]).join(' / ')}`);
    }

    for (const name of SECTIONS) {
        const body = parts[name].replace(/^##\s+.+$/m, '').trim();
        if (!body) fail(`docs/${lang}.md 的「${SECTION_LABEL[name]}」是空的`);
    }

    if (PLACEHOLDER.test(text)) fail(`docs/${lang}.md 里还有没填完的占位符（TODO / TBD / <!-- fill -->）`);

    const versions = versionsOf(parts.changelog);
    versionsByLang[lang] = versions;

    if (!versions.length) {
        fail(`docs/${lang}.md 的版本日志里没有 "### x.y.z" 版本标题`);
    } else if (versions[0] !== version) {
        fail(`docs/${lang}.md 版本日志最新条目是 ${versions[0]}，manifest 的 version 是 ${version} —— 发版时漏写日志了`);
    }

    const sorted = [...versions].sort(cmpDesc);
    if (sorted.join(',') !== versions.join(',')) {
        fail(`docs/${lang}.md 的版本日志没有按版本号从新到旧排列：${versions.join(' > ')}`);
    }
}

function cmpDesc(a, b) {
    const pa = a.split('.').map(Number);
    const pb = b.split('.').map(Number);
    for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pb[i] - pa[i];
    return 0;
}

// ---- 5. 各语系版本列表一致 ---------------------------------------------------

const langs = Object.keys(versionsByLang);
if (langs.length > 1) {
    const ref = versionsByLang[manifest.fallbackLanguage] || versionsByLang[langs[0]];
    const refLang = versionsByLang[manifest.fallbackLanguage] ? manifest.fallbackLanguage : langs[0];
    for (const lang of langs) {
        if (versionsByLang[lang].join(',') !== ref.join(',')) {
            fail(`docs/${lang}.md 的版本列表 [${versionsByLang[lang].join(', ')}] 与 ${refLang} 的 [${ref.join(', ')}] 不一致`);
        }
    }
}

// ---- 7. README 变更日志对齐 --------------------------------------------------

for (const rel of READMES) {
    const file = path.join(ROOT, rel);
    if (!fs.existsSync(file)) { warn(`${rel} 不存在，已跳过版本对齐检查`); continue; }
    const versions = versionsOf(fs.readFileSync(file, 'utf8'));
    if (!versions.length) warn(`${rel} 里找不到 "### x.y.z" 变更日志标题`);
    else if (versions[0] !== version) {
        fail(`${rel} 的变更日志最新条目是 ${versions[0]}，manifest 的 version 是 ${version}`);
    }
}

// ---- 输出 -------------------------------------------------------------------

function report() {
    if (process.argv.includes('--json')) {
        console.log(JSON.stringify({ ok: errors.length === 0, version, errors, warnings }, null, 2));
        return;
    }
    for (const w of warnings) console.log(`  warn  ${w}`);
    for (const e of errors) console.log(`  FAIL  ${e}`);
    if (!errors.length) {
        console.log(`  docs OK — ${declared.length} 份简述文档结构一致，版本日志对齐 manifest ${version}` +
            (warnings.length ? `（${warnings.length} 条提示）` : ''));
    }
}

report();
process.exit(errors.length ? 1 : 0);
