---
name: eagle-plugin-verify
description: 「视频压缩」Eagle 插件的自动化测试与提交前校验。跑回归测试、语法检查、语言包与版本一致性检查，以及编写新的回归测试。改完代码要验证、提交前要过闸门时使用。
allowed-tools: Read, Write, Edit, Grep, Glob, Bash
---

# 自动化测试与校验

Eagle 插件没有构建步骤，也没有 CI。语法错误、缺失的翻译键、忘记同步的版本号，全都要等到人肉打开 Eagle 才会暴露；有些问题（比如某个语系缺键）只在切到那个语言时才看得到。所以所有能静态查出来的问题都集中到一条命令里。

## 一键闸门

```bash
./tools/verify.sh
```

依次执行：

| 步骤 | 检查什么 | 失败意味着 |
| --- | --- | --- |
| 环境 | Node ≥ 22 | 测试用到的新 API 在旧版本上会直接报错 |
| JSON 合法性 | `manifest.json` + 8 个语言包 | JSON 挂了 Eagle 会**拒载插件且不给任何提示** |
| JS 语法 | `js/` `tools/` `tests/` 全部 `node --check` | Chromium 里一个语法错 = 整份脚本不执行 |
| 回归测试 | `tests/*.js` 独立脚本全部跑一遍 | 见下文 |
| 标准用例集 | `node tools/run-tests.js`：41 条带 ID 的契约用例 | FAIL = 已实现的行为被改坏；XPASS = 缺陷已修但状态没翻 |
| 多语言 | `tools/check-i18n.js` | 见 `eagle-plugin-i18n` |
| 版本与文档 | `tools/check-docs.js` | 见 `eagle-plugin-release` |
| 打包卫生 | `tools/clean-workspace.sh --check`：`.DS_Store`、陈旧 git 锁、logo 体积、`sync-to-eagle.sh` 的排除项 | 开发期文件混进 `.eagleplugin` 会被审核挑出来 |

退出码非 0 表示有必须修复的问题。`warn` 只是提示，不影响退出码。

单独跑某一项：

```bash
node tools/check-i18n.js          # 只查语言包
node tools/check-docs.js          # 只查版本与简述文档
node tests/test_hdr_and_marker.js # 只跑一个测试
NODE=/path/to/node ./tools/verify.sh   # 指定 node
```

两个 check 脚本都支持 `--json`，需要机器可读输出时加上。

## 工作区清理

```bash
./tools/clean-workspace.sh           # 清理
./tools/clean-workspace.sh --check   # 只报告，不动文件（verify.sh 用这个）
```

这个脚本存在的原因是**`.git/index.lock` 在这个仓库里会反复出现**——Finder、Eagle 的目录扫描、以及编辑器的 git 集成都可能在同一时刻碰索引，留下一个空的锁文件；之后所有写索引的操作（`git add` / `git commit` / `git checkout`）都会以「无法创建 .git/index.lock：File exists」失败。

删锁文件本身是危险动作（真有 git 进程在写时删掉会损坏索引），所以脚本只在**三个条件同时成立**时才删：

1. `pgrep -x git` 查不到运行中的 git 进程；
2. 锁文件为空（非空说明有进程正在往里写）；
3. `find -mmin +1`，即文件已存在超过一分钟。

任何一条不满足就只报告并给出手动排查命令，绝不代替人做判断。**卡在 index.lock 时先跑这个脚本，不要直接 `rm`。** 如果脚本拒绝删，说明确实有进程占用，等它结束。

顺带清理 `.DS_Store`（Finder 每次浏览目录都会生成，会被打进 `.eagleplugin`）。

> Bash 陷阱：脚本里所有变量都写成 `${LOCK}` 而不是 `$LOCK`。中文全角括号不是分隔符，`$LOCK（` 会被当成一个变量名，报 `unbound variable`。

## 什么时候跑

- **改了 `js/` 下任何文件**：`./tools/verify.sh`
- **只改了语言包**：`node tools/check-i18n.js` 足够
- **提交被 index.lock 卡住**：`./tools/clean-workspace.sh`
- **准备提交**：`./tools/verify.sh`，必须全绿
- **准备发版**：先走 `eagle-plugin-release` 的流程，最后再跑一次 `./tools/verify.sh`

## 测试怎么写

`tests/` 下每个文件是**独立可执行的 Node 脚本**，不依赖测试框架：成功时打印 `PASS <一句话说明>` 并以 0 退出，失败时靠 `assert` 抛异常。`verify.sh` 靠这个约定收集结果。新增测试直接放进 `tests/`，会被自动纳入。

有两种测试形态，按被测对象选：

### 形态 A：纯逻辑（首选）

`js/ffmpeg.js` 不碰 DOM 也不碰 `eagle.*`，可以直接 require。参考 `tests/test_hevc_apple_compat.js`、`tests/test_hdr_and_marker.js`。

```js
const assert = require('assert');
const path = require('path');
const Core = require(path.join(__dirname, '..', 'js', 'ffmpeg.js'));

// 构造 ffprobe 的原始输出，检查 buildPlan 生成的参数。
// 不做真实编码：参数错了产物必然错，而参数检查足够快，每次改动都能跑。
```

**优先写这一类。** 新的编码决策逻辑应该放进 `js/ffmpeg.js` 而不是 `app.js`，就是为了保住这条低成本的测试路径。

### 形态 B：UI 与编排（jsdom）

需要验证渲染、队列交互、设置持久化时，用 jsdom 把 `index.html` + `js/app.js` 拉起来。参考 `tests/test_queue_intake.js`。

```js
const { JSDOM } = require(path.join(__dirname, '..', 'tools', 'require-jsdom.js'))();
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')
    .replace(/<script[\s\S]*?<\/script>/g, '');   // 脚本手动 eval，便于先注入桩

const dom = new JSDOM(html, {
    url: 'http://localhost/', runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(window) {
        window.require = require;
        window.FFmpegCore = makeCore();   // 桩
        window.Format = makeFormat();     // 桩
        window.I18n = { t: (_, fallback, vars) => /* 必须实现 {{}} 插值 */, apply: () => {} };
        window.eagle = { item: { getSelected: () => Promise.resolve(selected) } };
    }
});
win.eval(fs.readFileSync(path.join(ROOT, 'js/app.js'), 'utf8'));
await win.App.init(win.eagle);
```

写桩时有两条硬要求，违反了测试会变成假绿：

1. **`I18n.t` 的桩必须真的做 `{{...}}` 插值。** 否则含 `{{count}}` 的文案永远渲染成占位符，「数字到底有没有传进去」这类 bug 测不出来。
2. **`probe` 桩返回的结构要和真实 `normalizeProbe` 一致**，包括 `hdr` / `compression` 这些可能缺失的字段。渲染层的防御性判断正是要被盯住的地方。

> **jsdom 依赖**：本仓库故意不带 `package.json` / `node_modules`（Eagle 直接加载源码目录，`node_modules` 只会进包）。jsdom 由 `tools/require-jsdom.js` 按 `JSDOM_PATH` 环境变量 → 常规 `require` → npm 全局目录 → 本机已知路径的顺序解析，全部失败时会打印可执行的修复指引。**不要在本仓库里 `npm install`**，改用 `JSDOM_PATH=/绝对/路径 node tests/xxx.js` 或 `npm install -g jsdom`。

### 测试要盯什么

从这个仓库的历史故障看，值得写测试的是**「看起来成功的失败」**：

- 退出码 0、文件生成了，但预期的副作用没发生（metadata 被 muxer 静默丢弃）
- 数据里有标志位，但界面没渲染出来（HDR / 已压缩角标）
- 取消之后原文件是否完好（原子提交）
- 异步回调乱序时的状态（过期的选中素材回调、运行中追加任务）

不值得写的：真实编码耗时的端到端流程、UI 样式细节。

## 标准用例集（契约测试）

`tests/*.js` 那批脚本回答的是「现在的行为对不对」。但还有一批问题**现在就是错的**，且短时间内不打算改 —— 它们需要一个地方沉淀，否则每次评审都要从源码重新推一遍。

用例集就是干这个的：每条用例 = 一个带 ID 的**契约**，写明「故障是什么」和「修好之后必须满足什么」。

```bash
node tools/run-tests.js                  # 跑全部
node tools/run-tests.js --list           # 列出全部（ID / 级别 / 状态 / 标题）
node tools/run-tests.js --only P0        # 只跑 P0（也接受 P1 / P2 / LOCK / NEW / plan / area:ui / 具体 ID）
node tools/run-tests.js --contract P0-01 # 打印某条的完整故障描述与契约
node tools/run-tests.js --json           # 结构化输出，同时写入 tests/.run-result.json
node tools/run-tests.js -v               # 失败时打印堆栈
```

### 三种用例状态

| status | 含义 | 通过时 | 失败时 |
| --- | --- | --- | --- |
| `implemented` | 已经正确的行为，防回归 | `PASS` | `FAIL` —— **红了，必须修** |
| `xfail` | 已登记的缺陷，契约已写明 | `XPASS` —— **红了**，说明缺陷已修，逼你回来把 status 翻成 `implemented` | `KNOWN-FAIL` —— 预期内，不算红 |
| `blocked` | 契约明确但当前测不到（内部函数没导出等） | `BLOCKED` | 同上 |

XPASS 算失败是故意的：否则用例集会慢慢变成一堆没人维护的 `xfail`，失去意义。**修好一个缺陷的完整动作是：改代码 → 看到 XPASS → 把 status 翻成 `implemented` → 重跑全绿。**

### 目录

| 文件 | 内容 |
| --- | --- |
| `tests/cases/index.js` | 注册表，新增分片在这里加一行 |
| `tests/cases/helpers.js` | 公共构件：构造 meta/settings、读参数、`skip()`、`countingArray()`、`spy()` |
| `tests/cases/env.js` | jsdom 环境：起一个装好 `app.js` 的假 Eagle 窗口 |
| `tests/cases/plan.js` | 编码计划与 FFmpeg 参数（18 条） |
| `tests/cases/budget.js` | CPU / 并发资源预算（9 条） |
| `tests/cases/commit.js` | 提交安全：体积闸门、临时文件回收、原子替换（7 条） |
| `tests/cases/ui.js` | 界面渲染与导入期性能（7 条） |

### 新增用例

在对应分片里 `add({ ... })` 就行，字段：

```js
add({
    id: 'P0-99',                 // 前缀即级别：P0 / P1 / P2 / LOCK / NEW
    title: '一眼能看懂的一句话',
    area: 'plan',                // 与分片一致
    level: 'P0',
    status: 'xfail',             // implemented / xfail / blocked
    issue:   '故障是什么，最好带实测数据',
    contract:'修好之后必须满足什么，写成可以断言的形式',
    ref: 'js/ffmpeg.js buildPlan',
    run: function () { /* 抛异常 = 失败；可以 async */ }
});
```

写的时候三条经验：

1. **`issue` 里写复现数据，不写结论。** 「这里是 O(N²)」没有说服力，「导入 25 个文件共扫了任务表 9862 次，约 16×N²」有。
2. **`contract` 要能翻译成断言。** 写「应该更快」没法测；写「元素访问次数 ≤ 2N」可以。性能类断言用 `H.countingArray()` 数全表扫描次数，用 `H.spy(fs, 'copyFile')` 数真实 IO 次数 —— 比读源码可靠，源码改了行为没改（或反过来）时只有计数能抓到。
3. **顺手锁住「当前正确但语义微妙」的行为**（`LOCK-*` 前缀）。修缺陷时最容易误伤它们，比如 VP9 的 `-b:v 0`、x264 线程上限 16、两遍编码保持单 worker。

`id` 以 `LOCK-` 开头表示「锁定项」，`NEW-` 表示评审中新发现、还没归到原始编号体系里的问题。

### 与 `tests/*.js` 怎么选

- 验证**当前行为**、且是完整流程 → `tests/*.js` 独立脚本
- 描述**待修缺陷的契约**、或需要按级别/分片筛选、或要进 CI 报告 → 用例集

## 修复失败的顺序

1. **先看是不是测试自己坏了**：绝对路径失效、Node 版本、临时目录权限。
2. **JS 语法失败**：`node --check <文件>` 会直接给出行号。
3. **回归测试失败**：跑单个文件看完整输出，assert 的第三个参数写的就是「期望的行为」。
4. **用例集报 XPASS**：这是好消息 —— 缺陷已修。把那条用例的 `status` 从 `xfail` 改成 `implemented` 再跑一次。
5. **不要为了让测试通过而放宽断言。** 断言描述的是真实故障的复现条件，放宽等于把坑埋回去。

> **已知环境坑**：本机这份 jsdom 冷加载要约 40s（node_modules 冷缓存），之后每个窗口只要 ~90ms。所以 `tools/run-tests.js` 是边跑边打印的，全绿一轮大约 50s，其中 4s 是真正在跑用例。看到开头停顿属正常，别以为卡死。
