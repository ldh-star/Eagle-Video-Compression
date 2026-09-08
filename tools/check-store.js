#!/usr/bin/env node
/**
 * 校验 store/descriptions.json —— 插件中心提交表单里的名称与描述。
 *
 *   node tools/check-store.js [--json]
 *
 * 为什么需要它：这两个字段以前只存在于提交表单里，仓库里没有任何副本，
 * 也就没人能在提交前发现它们超限。1.1.1 因此被驳回（英文 255/200、
 * 简体中文 134/100，英文还被截断成 "...compressio"）。
 *
 * 长度按字符数（Array.from 计码点，避免把 emoji 或组合字符算成两个）。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const store = JSON.parse(fs.readFileSync(path.join(ROOT, 'store', 'descriptions.json'), 'utf8'));

// CJK 语系的上限更严：一个汉字承载的信息量大，商店给的额度也只有一半。
const CJK = ['zh_CN', 'zh_TW', 'ja_JP', 'ko_KR'];
const LIMIT_CJK = 100;
const LIMIT_LATIN = 200;

// 名称的上限不分语系：30 个字符，且空格分隔的语言不超过 6 个单词。
// 「名称或描述超过硬性长度限制」是审核标准里点名的常见驳回原因，
// 描述那边已经卡住了，名称这边以前是空的 —— 补齐才算闸门完整。
// 词数对 CJK 无害：不含空格的名称算一个词，永远过。
const LIMIT_NAME = 30;
const LIMIT_NAME_WORDS = 6;

// 句子必须完整收尾。1.1.1 的英文描述就是被硬截断在 "compressio" 上，
// 只查长度查不出这种「刚好没超但话没说完」的情况。
const SENTENCE_END = /[.。！!？?]$/;

const fails = [];
const warns = [];

function count(str) { return Array.from(str).length; }

const langs = manifest.languages;
const provided = Object.keys(store).filter((k) => k.charAt(0) !== '_');

langs.forEach((lang) => {
    if (provided.indexOf(lang) < 0) {
        fails.push(`manifest.languages 里的 ${lang} 在 store/descriptions.json 中缺失`);
    }
});
provided.forEach((lang) => {
    if (langs.indexOf(lang) < 0) {
        fails.push(`store/descriptions.json 里的 ${lang} 不在 manifest.languages 中`);
    }
});

provided.forEach((lang) => {
    const entry = store[lang];
    const limit = CJK.indexOf(lang) >= 0 ? LIMIT_CJK : LIMIT_LATIN;

    if (!entry || typeof entry.name !== 'string' || !entry.name.trim()) {
        fails.push(`${lang}: name 缺失或为空`);
    } else {
        // 名称与语言包不一致的话，商店页和插件窗口里会显示成两个名字。
        let localeName = null;
        try {
            const locale = JSON.parse(fs.readFileSync(path.join(ROOT, '_locales', lang + '.json'), 'utf8'));
            localeName = locale.manifest && locale.manifest.app && locale.manifest.app.name;
        } catch (e) { /* 语言包本身的问题交给 check-i18n.js */ }
        if (localeName && localeName !== entry.name) {
            fails.push(`${lang}: name "${entry.name}" 与 _locales/${lang}.json 的 manifest.app.name "${localeName}" 不一致`);
        }

        const nameLen = count(entry.name.trim());
        if (nameLen > LIMIT_NAME) {
            fails.push(`${lang}: name ${nameLen} 字符，超过上限 ${LIMIT_NAME}`);
        } else if (nameLen > LIMIT_NAME - 5) {
            warns.push(`${lang}: name ${nameLen}/${LIMIT_NAME} 字符，已接近上限`);
        }
        const words = entry.name.trim().split(/\s+/).length;
        if (words > LIMIT_NAME_WORDS) {
            fails.push(`${lang}: name ${words} 个单词，超过上限 ${LIMIT_NAME_WORDS}`);
        }
    }

    if (!entry || typeof entry.description !== 'string' || !entry.description.trim()) {
        fails.push(`${lang}: description 缺失或为空`);
        return;
    }
    const desc = entry.description;
    const n = count(desc);
    if (n > limit) {
        fails.push(`${lang}: description ${n} 字符，超过上限 ${limit}`);
    } else if (n > limit - 10) {
        warns.push(`${lang}: description ${n}/${limit} 字符，已接近上限`);
    }
    if (!SENTENCE_END.test(desc.trim())) {
        fails.push(`${lang}: description 结尾不是完整句子（缺句号），可能是被截断的`);
    }
    if (/\b(TODO|TBD|FIXME|XXX)\b/.test(desc)) {
        fails.push(`${lang}: description 里还有 TODO / TBD / FIXME / XXX`);
    }
});

if (process.argv.indexOf('--json') >= 0) {
    console.log(JSON.stringify({ fails, warns }, null, 2));
} else {
    warns.forEach((w) => console.log('  warn  ' + w));
    fails.forEach((f) => console.log('  FAIL  ' + f));
    if (!fails.length) {
        const summary = provided.map((lang) => {
            const limit = CJK.indexOf(lang) >= 0 ? LIMIT_CJK : LIMIT_LATIN;
            return `${lang} ${count(store[lang].description)}/${limit}`;
        }).join('，');
        console.log(`  store OK — ${provided.length} 个语系的名称与描述均合规（${summary}）`);
    }
}

process.exit(fails.length ? 1 : 0);
