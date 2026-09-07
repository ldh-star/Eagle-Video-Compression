/**
 * 用例集注册表。
 *
 * 新增分片只要在这里加一行；运行器不关心分片内部怎么组织。
 * 顺序即报告里的展示顺序（按重要性排，不是按文件名排）。
 */
'use strict';

const AREAS = [
    {
        file: './plan',
        area: 'plan',
        title: '编码计划与 FFmpeg 参数',
        why: '参数错了产物必然错；参数检查是毫秒级，可以每次改动都跑'
    },
    {
        file: './budget',
        area: 'budget',
        title: 'CPU / 并发资源预算',
        why: '纯函数，跑得最快，也最容易被「顺手改一下」弄坏'
    },
    {
        file: './commit',
        area: 'commit',
        title: '提交安全',
        why: '这一段出错直接改写用户原始素材，不可逆'
    },
    {
        file: './ui',
        area: 'ui',
        title: '界面渲染与导入期性能',
        why: '把 O(N²) 这类论断写成可断言的数字上限'
    }
];

/**
 * 加载全部用例。
 *
 * @returns {Array} 用例对象数组
 */
function load() {
    const out = [];
    AREAS.forEach(function (a) {
        const list = require(a.file);
        list.forEach(function (c) {
            out.push(Object.assign({}, c, { area: c.area || a.area }));
        });
    });
    return out;
}

/**
 * 用例状态说明。写用例时按这个语义选 status。
 */
const STATUS = {
    implemented: '已实现的行为，必须通过',
    xfail: '已知缺陷，期望失败；一旦通过说明缺陷已修，必须把状态翻成 implemented',
    blocked: '契约明确但当前测不到（内部函数没导出等），需要先补测试入口'
};

module.exports = { AREAS: AREAS, load: load, STATUS: STATUS };
