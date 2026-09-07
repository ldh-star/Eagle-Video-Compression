#!/usr/bin/env node
/**
 * 生成 SUBMISSION.md —— 提交给 Eagle 插件中心的各语系文案汇总。
 *
 *   node tools/gen-submission.js
 *
 * 从 docs/<语系>.md 里按 <!-- section:overview|usage|changelog --> 锚点抽出三段，
 * 按 manifest.languages 的顺序拼成一份文件，方便直接复制到插件中心的提交表单。
 *
 * 源只有 docs/ 一份，SUBMISSION.md 是产物 —— 内容要改就改 docs/ 再跑本脚本，
 * 不要直接编辑 SUBMISSION.md，否则下次生成会被覆盖。
 *
 * 注意：docs/ 下多一个 .md 就会被 tools/check-docs.js 当成语系文档报错，
 * 所以汇总文件只能放仓库根目录；它同时被 sync-to-eagle.sh 排除，
 * 不会被同步进 Eagle 打进 .eagleplugin。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DOCS_DIR = path.join(ROOT, 'docs');
const OUT_FILE = path.join(ROOT, 'SUBMISSION.md');

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const LANGS = manifest.languages;
const VERSION = manifest.version;

const NAMES = {
    de_DE: 'Deutsch',
    en: 'English',
    es_ES: 'Español',
    ja_JP: '日本語',
    ko_KR: '한국어',
    ru_RU: 'Русский',
    zh_CN: '简体中文',
    zh_TW: '繁體中文'
};

// [锚点名, 输出小标题]
const SECTIONS = [
    ['overview', '简述'],
    ['usage', '使用说明'],
    ['changelog', '版本日志']
];

function parse(file) {
    const text = fs.readFileSync(file, 'utf8');
    const marks = [];
    const re = /<!-- section:(\w+) -->/g;
    let m;
    while ((m = re.exec(text)) !== null) {
        // start 和 end 都要存：少了 start，下一段的起点算不出来，
        // slice(start, undefined) 会一路截到文件末尾，各段内容互相重复。
        marks.push({ name: m[1], start: m.index, end: re.lastIndex });
    }
    const out = {};
    for (let i = 0; i < marks.length; i++) {
        const start = marks[i].end;
        const stop = i + 1 < marks.length ? marks[i + 1].start : text.length;
        // 段落自带一个本地化的 ## 标题（各语系措辞不同），统一换成上面的固定小标题
        out[marks[i].name] = text.slice(start, stop).trim().replace(/^##[ \t]+.*$/m, '').trim();
    }
    return out;
}

const lines = [
    '# 视频压缩 · 各语言提交文案',
    '',
    `> 由 \`docs/<语系>.md\` 自动生成，对应版本 **${VERSION}**。`,
    '> 每个语系三节：简述 / 使用说明 / 版本日志，可直接复制到 Eagle 插件中心对应语系的字段。',
    '> 内容改动请改 `docs/` 下的源文件后重跑 `node tools/gen-submission.js`，不要直接改本文件。',
    ''
];

let bad = 0;
for (const lang of LANGS) {
    const file = path.join(DOCS_DIR, lang + '.md');
    if (!fs.existsSync(file)) {
        console.error('✗ 缺少 docs/' + lang + '.md');
        bad++;
        continue;
    }
    const sec = parse(file);
    lines.push('---', '', `## ${NAMES[lang] || lang}（${lang}）`, '');
    for (const [key, label] of SECTIONS) {
        if (!sec[key]) {
            console.error(`✗ docs/${lang}.md 缺少 ${key} 段落`);
            bad++;
            continue;
        }
        lines.push(`### ${label}`, '', sec[key], '');
    }
}

if (bad) {
    console.error(`生成失败：${bad} 处问题`);
    process.exit(1);
}

fs.writeFileSync(OUT_FILE, lines.join('\n'));
console.log(`已生成 ${path.relative(ROOT, OUT_FILE)} —— ${LANGS.length} 个语系，版本 ${VERSION}`);
