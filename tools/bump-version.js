#!/usr/bin/env node
/**
 * 版本号更新 + 变更日志骨架。
 *
 * 版本号在这个工程里分散在四处，手动改必漏一处：
 *   - manifest.json 的 version（Eagle 真正读的那个）
 *   - README.md / README.zh-CN.md 的变更日志
 *   - docs/<语系>.md 的版本日志（八份）
 * 这个脚本只做机械的部分：改 manifest、在每个日志区插入新版本的空骨架。
 * 骨架里的条目内容需要人（或模型）填写，check-docs.js 会拦住没填完的占位符。
 *
 * 用法:
 *   node tools/bump-version.js 1.0.3          # 指定版本
 *   node tools/bump-version.js patch          # 1.0.2 -> 1.0.3
 *   node tools/bump-version.js minor          # 1.0.2 -> 1.1.0
 *   node tools/bump-version.js major          # 1.0.2 -> 2.0.0
 *   node tools/bump-version.js patch --dry-run
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MANIFEST = path.join(ROOT, 'manifest.json');
const DOCS_DIR = path.join(ROOT, 'docs');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const target = args.find((a) => !a.startsWith('--'));

if (!target) {
    console.error('用法: node tools/bump-version.js <x.y.z | major | minor | patch> [--dry-run]');
    process.exit(2);
}

const manifestText = fs.readFileSync(MANIFEST, 'utf8');
const manifest = JSON.parse(manifestText);
const current = manifest.version;

if (!/^\d+\.\d+\.\d+$/.test(current)) {
    console.error(`manifest.json 当前 version "${current}" 不是 x.y.z 形式，请先手动修正`);
    process.exit(1);
}

const [maj, min, pat] = current.split('.').map(Number);
const next = ({
    major: `${maj + 1}.0.0`,
    minor: `${maj}.${min + 1}.0`,
    patch: `${maj}.${min}.${pat + 1}`
})[target] || target;

if (!/^\d+\.\d+\.\d+$/.test(next)) {
    console.error(`"${target}" 既不是 x.y.z，也不是 major/minor/patch`);
    process.exit(1);
}

const cmp = (a, b) => {
    const pa = a.split('.').map(Number);
    const pb = b.split('.').map(Number);
    for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
    return 0;
};

if (cmp(next, current) <= 0) {
    console.error(`新版本 ${next} 不高于当前的 ${current}，拒绝回退`);
    process.exit(1);
}

/**
 * 每份文档的变更日志标题不同（README 是 "## Changelog" / "## 更新日志"，
 * 简述文档是锚点后的二级标题），统一按「插入点」描述：找到锚定行，在其后
 * 插入新的 "### <version>" 段落。
 */
const targets = [
    // 锚点里用 [ \t]*$ 而不是 \s*$：\s 会吃掉换行，导致插入点落在标题后的空行之后，
    // 插完会多出一个空行。
    { file: 'README.md', anchor: /^##[ \t]+Changelog[ \t]*$/m, skeleton: (v) => `### ${v}\n\n**Fixed**\n\n- TODO\n` },
    { file: 'README.zh-CN.md', anchor: /^##[ \t]+更新日志[ \t]*$/m, skeleton: (v) => `### ${v}\n\n**修复**\n\n- TODO\n` }
];

if (fs.existsSync(DOCS_DIR)) {
    for (const name of fs.readdirSync(DOCS_DIR).filter((f) => f.endsWith('.md'))) {
        targets.push({
            file: path.join('docs', name),
            // 简述文档统一用锚点定位，跟标题语言无关。
            anchor: /^<!--[ \t]*section:changelog[ \t]*-->[ \t]*$/m,
            skeleton: (v) => `### ${v}\n\n- TODO\n`,
            afterHeading: true
        });
    }
}

const changes = [];

// manifest：只替换 version 那一行，别整份重新序列化 —— 会打乱缩进和键顺序。
const nextManifest = manifestText.replace(
    /("version"\s*:\s*")\d+\.\d+\.\d+(")/,
    `$1${next}$2`
);
if (nextManifest === manifestText) {
    console.error('没能在 manifest.json 里定位到 version 字段');
    process.exit(1);
}
changes.push(['manifest.json', nextManifest]);

for (const t of targets) {
    const file = path.join(ROOT, t.file);
    if (!fs.existsSync(file)) { console.warn(`  跳过 ${t.file}（不存在）`); continue; }
    const text = fs.readFileSync(file, 'utf8');

    if (new RegExp(`^###\\s+v?${next.replace(/\./g, '\\.')}\\s*$`, 'm').test(text)) {
        console.warn(`  跳过 ${t.file}（已经有 ${next} 的条目）`);
        continue;
    }

    const m = t.anchor.exec(text);
    if (!m) { console.warn(`  跳过 ${t.file}（找不到变更日志的插入位置）`); continue; }

    // 锚点行之后紧跟着一行本地化的二级标题（"## 版本日志" / "## Changelog"），
    // 新条目要插在它下面。标题文字随语系变化，所以只按「锚点后的第一个 ## 行」定位。
    let insertAt = m.index + m[0].length;
    if (t.afterHeading) {
        const window = text.slice(insertAt, insertAt + 200);
        const heading = /\n##[^\n]*/.exec(window);
        if (heading) insertAt += heading.index + heading[0].length;
    }

    changes.push([t.file, text.slice(0, insertAt) + '\n\n' + t.skeleton(next) + text.slice(insertAt).replace(/^\n+/, '\n')]);
}

console.log(`${current} -> ${next}${dryRun ? '（dry-run，未写入）' : ''}`);
for (const [rel, content] of changes) {
    console.log(`  ${dryRun ? '将更新' : '已更新'} ${rel}`);
    if (!dryRun) fs.writeFileSync(path.join(ROOT, rel), content);
}

if (!dryRun) {
    console.log('');
    console.log('接下来：把各文件里的 TODO 换成真实的变更条目，然后运行 tools/verify.sh。');
    console.log('check-docs.js 会拦住任何没填完的占位符。');
}
