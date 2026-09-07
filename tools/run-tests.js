#!/usr/bin/env node
/**
 * 标准用例运行器。
 *
 *   node tools/run-tests.js                 跑全部
 *   node tools/run-tests.js --list          列出全部用例（ID / 级别 / 状态 / 契约）
 *   node tools/run-tests.js --only P0       只跑 P0（也接受 P1 / LOCK / NEW / area:ui / 具体 ID）
 *   node tools/run-tests.js --json          结构化输出，供 CI 与其它工具消费
 *   node tools/run-tests.js --contract P0-01 打印某条用例的完整契约说明
 *
 * 退出码：0 = 没有意外结果；1 = 有 FAIL 或 XPASS。
 * XPASS（标着 xfail 却通过了）算失败是故意的 —— 说明缺陷已修，必须回来把
 * 状态翻成 implemented，否则这份用例集会慢慢失去意义。
 *
 * 设计上刻意不引入任何测试框架：本仓库不带 package.json / node_modules
 * （node_modules 会被同步进 Eagle 并进包），用例文件必须是裸 Node 就能跑的。
 */
'use strict';

const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const REGISTRY = path.join(ROOT, 'tests', 'cases', 'index.js');
const RESULT_FILE = path.join(ROOT, 'tests', '.run-result.json');

// ---------------------------------------------------------------------------
// 参数
// ---------------------------------------------------------------------------

function parseArgs(argv) {
    const opts = { list: false, json: false, only: [], contract: null, verbose: false };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--list') opts.list = true;
        else if (a === '--json') opts.json = true;
        else if (a === '--verbose' || a === '-v') opts.verbose = true;
        else if (a === '--only') { opts.only.push(argv[++i]); }
        else if (a.startsWith('--only=')) { opts.only.push(a.slice(7)); }
        else if (a === '--contract') { opts.contract = argv[++i]; }
        else if (a === '--help' || a === '-h') { opts.help = true; }
        else { opts.unknown = a; }
    }
    // --only P0,P1 这种逗号写法也支持
    opts.only = opts.only.join(',').split(',').map((s) => s.trim()).filter(Boolean);
    return opts;
}

function usage() {
    return [
        '用法: node tools/run-tests.js [选项]',
        '',
        '  --list              列出全部用例（ID / 级别 / 状态 / 契约）',
        '  --only <spec>       只跑匹配 spec 的用例，可重复或逗号分隔',
        '                      spec = 级别前缀(P0/P1/P2/LOCK/NEW) | area:ui | 用例 ID 前缀',
        '  --json              结构化输出（同时写入 tests/.run-result.json）',
        '  --contract <ID>     打印某条用例的完整契约说明',
        '  -v, --verbose       失败时打印堆栈',
        '',
        '退出码 0 = 无意外结果；1 = 有 FAIL 或 XPASS（XPASS 说明缺陷已修，需翻转状态）'
    ].join('\n');
}

/** --only 的匹配规则：级别前缀(P0/LOCK) / 分片名(plan/ui) / area:xxx / 用例 ID 前缀。 */
function matches(c, spec) {
    if (!spec) return true;
    const s = spec.toUpperCase();
    if (spec.indexOf('area:') === 0) return c.area === spec.slice(5);
    if (c.id.toUpperCase() === s) return true;
    if (c.id.toUpperCase().indexOf(s) === 0) return true;
    if (c.level.toUpperCase() === s) return true;
    if (String(c.area).toUpperCase() === s) return true;
    return false;
}

// ---------------------------------------------------------------------------
// 执行
// ---------------------------------------------------------------------------

function isSkip(err) {
    return !!(err && err.skip);
}

/**
 * 跑一条用例。
 * @returns {Promise<{id, status, result, ms, message, stack}>}
 */
async function runCase(c) {
    const started = Date.now();
    const out = {
        id: c.id, area: c.area, level: c.level, title: c.title,
        declared: c.status, result: 'pass', ms: 0, message: '', stack: ''
    };

    if (c.status === 'blocked') {
        try {
            await c.run();
        } catch (e) {
            out.message = isSkip(e) ? e.message : String(e.message || e);
        }
        out.result = 'blocked';
        out.ms = Date.now() - started;
        return out;
    }

    try {
        await c.run();
        // 跑通了：implemented 是对的；xfail 说明缺陷已修，要提醒翻状态
        out.result = c.status === 'xfail' ? 'xpass' : 'pass';
    } catch (e) {
        if (isSkip(e)) {
            out.result = 'skip';
            out.message = e.message;
        } else if (c.status === 'xfail') {
            out.result = 'known-fail';
            out.message = String(e.message || e).split('\n')[0];
        } else {
            out.result = 'fail';
            out.message = String(e.message || e).split('\n')[0];
            out.stack = String(e.stack || '');
        }
    }
    out.ms = Date.now() - started;
    return out;
}

const TAG = {
    'pass': 'PASS      ',
    'known-fail': 'KNOWN-FAIL',
    'xpass': 'XPASS     ',
    'fail': 'FAIL      ',
    'skip': 'SKIP      ',
    'blocked': 'BLOCKED   '
};

function pad(s, n) {
    s = String(s);
    return s.length >= n ? s : s + ' '.repeat(n - s.length);
}

function printList(cases) {
    console.log('');
    console.log(pad('ID', 10) + pad('级别', 7) + pad('分片', 9) + pad('状态', 13) + '标题');
    console.log('-'.repeat(100));
    cases.forEach(function (c) {
        console.log(pad(c.id, 10) + pad(c.level, 7) + pad(c.area, 9) + pad(c.declared || c.status, 13) + c.title);
    });
    console.log('');
    const byStatus = {};
    cases.forEach(function (c) { byStatus[c.status] = (byStatus[c.status] || 0) + 1; });
    console.log('合计 ' + cases.length + ' 条：' +
        Object.keys(byStatus).map(function (k) { return k + ' ' + byStatus[k]; }).join('，'));
    console.log('');
}

function printContract(c) {
    console.log('');
    console.log(c.id + '  ' + c.title);
    console.log('-'.repeat(80));
    console.log('级别    : ' + c.level + ' / 分片 ' + c.area + ' / 状态 ' + c.status);
    console.log('源码位置: ' + (c.ref || '—'));
    console.log('');
    console.log('故障：');
    console.log(wrap(c.issue || '—', 4));
    console.log('');
    console.log('契约：');
    console.log(wrap(c.contract || '—', 4));
    console.log('');
}

function wrap(text, indent) {
    const padStr = ' '.repeat(indent || 0);
    const width = 76;
    const lines = [];
    String(text).split('\n').forEach(function (para) {
        // 先按空格切成词（英文/代码），超长的词（中文长句）再硬切
        const words = para.split(' ');
        let cur = '';
        words.forEach(function (w) {
            while (w.length > width) {
                if (cur) { lines.push(cur); cur = ''; }
                lines.push(w.slice(0, width));
                w = w.slice(width);
            }
            if (!cur) cur = w;
            else if (cur.length + 1 + w.length <= width) cur += ' ' + w;
            else { lines.push(cur); cur = w; }
        });
        if (cur) lines.push(cur);
    });
    return lines.map(function (l) { return padStr + l; }).join('\n');
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

(async function main() {
    const opts = parseArgs(process.argv.slice(2));

    if (opts.help || opts.unknown) {
        if (opts.unknown) console.error('无法识别的参数：' + opts.unknown);
        console.log(usage());
        process.exit(opts.help ? 0 : 2);
    }

    const all = require(REGISTRY).load();

    if (opts.contract) {
        const c = all.find(function (x) { return x.id.toUpperCase() === String(opts.contract).toUpperCase(); });
        if (!c) {
            console.error('没有这条用例：' + opts.contract + '（用 --list 查看全部）');
            process.exit(2);
        }
        printContract(c);
        process.exit(0);
    }

    const selected = opts.only.length
        ? all.filter(function (c) { return opts.only.some(function (s) { return matches(c, s); }); })
        : all;

    if (opts.list) {
        if (opts.json) {
            console.log(JSON.stringify(selected.map(function (c) {
                return { id: c.id, level: c.level, area: c.area, status: c.status, title: c.title, issue: c.issue, contract: c.contract, ref: c.ref };
            }), null, 2));
        } else {
            printList(selected);
        }
        process.exit(0);
    }

    const started = Date.now();
    const results = [];
    const tally = { pass: 0, 'known-fail': 0, xpass: 0, fail: 0, skip: 0, blocked: 0 };

    // 边跑边打印：ui 分片第一次要加载 jsdom（本机冷缓存下约 40s），
    // 全跑完再输出会让人以为卡死了。--json 模式下保持 stdout 纯净。
    if (!opts.json) console.log('');
    for (const c of selected) {
        // 顺序执行：用例之间共享 fs 与 jsdom 全局，并发会互相干扰
        const r = await runCase(c);
        results.push(r);
        tally[r.result]++;
        if (!opts.json) {
            console.log(TAG[r.result] + '  ' + pad(r.id, 10) + pad(r.level, 6) + r.title);
            if (r.message && (r.result === 'fail' || r.result === 'known-fail' ||
                              r.result === 'skip' || r.result === 'blocked')) {
                console.log('            └─ ' + r.message);
            }
            if (r.result === 'xpass') {
                console.log('            └─ 缺陷已修复！请把 ' + r.id + ' 的 status 从 xfail 改成 implemented');
            }
            if (r.result === 'fail' && opts.verbose && r.stack) console.log(r.stack);
        }
    }
    const elapsed = Date.now() - started;

    if (opts.json) {
        const payload = {
            generatedAt: new Date().toISOString(),
            elapsedMs: elapsed,
            node: process.version,
            tally: tally,
            results: results
        };
        try { fs.writeFileSync(RESULT_FILE, JSON.stringify(payload, null, 2) + '\n'); } catch (e) {}
        console.log(JSON.stringify(payload, null, 2));
    } else {
        console.log('');
        console.log('-'.repeat(90));
        console.log('通过 ' + tally.pass + ' | 已知缺陷 ' + tally['known-fail'] +
            ' | XPASS ' + tally.xpass + ' | 失败 ' + tally.fail +
            ' | 跳过 ' + tally.skip + ' | 待补入口 ' + tally.blocked +
            '  （' + (elapsed / 1000).toFixed(1) + 's，Node ' + process.version + '）');

        if (tally.fail) {
            console.log('');
            console.log('以下用例必须修复：');
            results.filter(function (r) { return r.result === 'fail'; }).forEach(function (r) {
                console.log('  FAIL ' + r.id + '  ' + r.title);
            });
        }
        if (tally.xpass) {
            console.log('');
            console.log('以下用例标记为「已知缺陷」却通过了 —— 缺陷已修，请翻转状态后重跑：');
            results.filter(function (r) { return r.result === 'xpass'; }).forEach(function (r) {
                console.log('  XPASS ' + r.id + '  ' + r.title);
            });
        }
        if (tally.skip) {
            console.log('');
            console.log('跳过（环境缺失，非功能问题）：');
            results.filter(function (r) { return r.result === 'skip'; }).forEach(function (r) {
                console.log('  SKIP ' + r.id + '  ' + r.message);
            });
        }
        console.log('');
    }

    process.exit(tally.fail || tally.xpass ? 1 : 0);
})().catch(function (e) {
    console.error('运行器自身出错：' + (e && e.stack ? e.stack : e));
    process.exit(2);
});
