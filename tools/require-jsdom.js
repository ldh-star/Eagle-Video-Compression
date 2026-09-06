/**
 * 解析 jsdom 的位置。
 *
 * jsdom 只在 UI 测试里用到，而这个仓库故意不带 package.json / node_modules
 * （Eagle 直接加载源码目录，多一个 node_modules 只会进包）。所以 jsdom 要么
 * 装在别处，要么由调用方指定路径。
 *
 * 原来的写法是在测试文件里硬编码一条绝对路径，换机器、换 Node 版本就报
 * "Cannot find module"，而且报错信息完全看不出该去装什么。这里按优先级依次
 * 尝试，全都失败时给出可执行的修复指引。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

/** 收集候选目录，顺序即优先级。 */
function candidates() {
    const list = [];

    // 1. 显式指定：JSDOM_PATH=/path/to/jsdom node tests/xxx.js
    if (process.env.JSDOM_PATH) list.push(process.env.JSDOM_PATH);

    // 2. 常规解析：仓库里装了 jsdom，或 NODE_PATH 指到了某个 node_modules
    list.push('jsdom');

    // 3. npm 全局目录
    try {
        const root = execFileSync('npm', ['root', '-g'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
        if (root) list.push(path.join(root, 'jsdom'));
    } catch (e) { /* 没有 npm 也不影响其他候选 */ }

    // 4. 本机开发环境里已知的一份。放最后：它是机器相关的，不该是唯一依赖。
    list.push(path.join(process.env.HOME || '', '.workbuddy/binaries/node/workspace/node_modules/jsdom'));

    return list;
}

module.exports = function requireJsdom() {
    const tried = [];
    for (const spec of candidates()) {
        // 绝对路径先看存不存在，避免把「路径不对」和「模块自身加载失败」混在一起。
        if (path.isAbsolute(spec) && !fs.existsSync(spec)) { tried.push(spec); continue; }
        try {
            return require(spec);
        } catch (e) {
            tried.push(`${spec} (${e.code || e.message})`);
        }
    }
    throw new Error(
        'UI 测试需要 jsdom，但没找到。已尝试：\n' +
        tried.map((t) => '  - ' + t).join('\n') +
        '\n\n任选一种解决方式：\n' +
        '  JSDOM_PATH=/绝对/路径/到/jsdom node tests/<测试>.js\n' +
        '  npm install -g jsdom\n' +
        '  NODE_PATH=/某个/node_modules node tests/<测试>.js\n' +
        '注意：不要在本仓库里 npm install —— node_modules 会被同步进 Eagle 并进入 .eagleplugin。'
    );
};
