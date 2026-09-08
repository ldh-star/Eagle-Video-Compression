---
name: eagle-plugin-release
description: 「视频压缩」Eagle 插件的发版流程：更新版本号、维护中英文 README 变更日志与 docs/ 下八种语言的简述文档、打包前检查。要发新版本、写变更日志或更新简述文档时使用。
allowed-tools: Read, Write, Edit, Grep, Glob, Bash
---

# 发版：版本号、变更日志、多语言简述文档

## 版本号散落在哪儿

| 位置 | 作用 | 谁维护 |
| --- | --- | --- |
| `manifest.json` 的 `version` | **Eagle 唯一读取的版本号** | `tools/bump-version.js` |
| `README.md` → `## Changelog` | 面向开发者的完整变更记录（英文） | 人工填写，脚本插骨架 |
| `README.zh-CN.md` → `## 更新日志` | 同上（中文） | 人工填写，脚本插骨架 |
| `docs/<语系>.md` → 版本日志一节 | 面向用户的简述，八个语系各一份 | 人工填写，脚本插骨架 |

手动改必漏一处。`tools/check-docs.js` 会拦住不一致。

## 简述文档：docs/

`docs/` 下每个语系一份 `.md`，语系代码与 `manifest.languages` 严格一一对应。**每份文档只包含三节，不多不少**：

```markdown
# <插件名>

<!-- section:overview -->
## 插件简述
...

<!-- section:usage -->
## 插件使用说明
...

<!-- section:changelog -->
## 版本日志

### 1.0.2
- ...

### 1.0.1
- ...
```

**HTML 注释锚点是必需的。** 章节标题本身要翻译成各语系（「版本日志」/「Changelog」/「変更履歴」/「История версий」……），按标题文字定位不可靠，所以用渲染时不可见的锚点。锚点名固定为 `overview` / `usage` / `changelog`，顺序固定。

约束（`tools/check-docs.js` 逐条检查）：

- 每个 `manifest.languages` 里的语系都有对应文件，没有多余文件
- 恰好三个锚点，恰好三个二级标题，三节都不为空
- 版本日志里最新的 `### x.y.z` == `manifest.json` 的 `version`
- 版本号从新到旧排列
- **各语系的版本号列表完全一致**——漏译某一版，那个语系的用户就看不到该版变更
- 没有残留的 `TODO` / `TBD` / `FIXME` / `XXX`（大小写敏感，西班牙语的 `todo` 是正常词）
- 两个 README 的变更日志最新条目也等于 `manifest` 的 version

### 简述 vs README 的分工

- `docs/` 是**给用户看的简述**：一句话说清能干什么、怎么用、每版改了什么。条目一行一条，不展开技术细节。
- `README` 是**给开发者看的**：可以写清根因、FFmpeg 参数、为什么这么修。

同一个变更在两边的措辞不同，不要直接互相复制。

## 发版流程

### 1. 决定版本号

- `patch`：修 bug、内部改进，不改变用户可见的操作方式
- `minor`：新增功能或新增用户可见的选项
- `major`：破坏性变化（本工程目前不涉及）

### 2. 插入骨架

```bash
node tools/bump-version.js patch --dry-run   # 先看会改哪些文件
node tools/bump-version.js patch             # 实际执行
```

脚本会：改 `manifest.json` 的 version；在两个 README 和八份简述文档的日志区顶部插入 `### <新版本>` 加一条 `- TODO`。已经存在该版本条目的文件会被跳过，不会重复插入。拒绝版本号回退。

也可以直接指定：`node tools/bump-version.js 1.1.0`。

### 3. 收集本版真实变更

不要凭印象写。用 git 拿事实：

```bash
git log --oneline $(git describe --tags --abbrev=0 2>/dev/null || git rev-list --max-parents=0 HEAD)..HEAD
git diff --stat HEAD~1
```

对每条变更问三个问题，这决定了它值不值得写进用户可见的日志：

- **用户会察觉到吗？** 察觉不到的内部重构不写进 `docs/`，只写进 README。
- **修复的话，症状是什么？** 用户是按症状搜索的。写「H.265 输出在 macOS 快速查看里打不开」，不要写「修复 hev1 tag 问题」。
- **有没有行为变化需要用户知道？** 比如某个开关默认打开、某种容器不支持某功能——这类必须写。

### 4. 填写日志

**README（两份）**：按 `**Added**` / `**Fixed**` / `**Improved**`（中文 `**新增**` / `**修复**` / `**改进**`）分组。修复类要写清根因和现象，参考已有的 1.0.1 / 1.0.2 条目——那是这个工程认可的详细程度。

**docs（八份）**：每条一行，用户视角。先写修复和行为变化，再写新增，最后写改进。八个语系的条目**数量和顺序必须一致**，只有语言不同。

翻译时注意：
- 产品名词（H.265、CRF、FFmpeg、HDR10、Dolby Vision、`hvc1`）保持原文不译
- 界面按钮名要和该语系 `_locales/<lang>.json` 里的实际文案一致，不要另起译名
- 中文 `docs/zh_CN.md` 是事实来源，其余语系从它翻译

### 5. 校验

```bash
./tools/verify.sh
```

必须全绿。`check-docs.js` 会抓出没填完的 TODO、版本号不一致、某个语系漏了一版。

### 6. 提交

提交信息沿用本仓库的格式：标题 `Release <version>: <一句话概括>`，正文按 `Fix / Add / Improve / Docs / Tests` 分段，用完整句子说明根因，最后一行写 `Verified:` 加实测结果。参考 `git log 662bf36` 和 `e69730e`。

### 7. 打包

```bash
./tools/build-package.sh --zip      # 产出 dist/video-compress-<version>.eagleplugin
```

**不要从仓库根目录打包。** 1.1.1 投稿被拒的原因之一就是 `tests/` `tools/` `reports/` `sync-to-eagle.sh` `SUBMISSION.md` 全都进了安装包——当时 `sync-to-eagle.sh` 里确实有排除列表，但打包源是仓库根目录，那份黑名单从头到尾没参与。

现在唯一的事实来源是 `tools/build-package.sh` 顶部的 `INCLUDE` **白名单**：`manifest.json` / `index.html` / `logo.png` / `LICENSE` / `css` / `js` / `_locales`。README、`docs/`、`REVIEW.md`、`SUBMISSION.md` 都不进包——README 是给开发者看的，使用说明在商店页。

- 新增运行时文件（新的 `js/`、新图标）必须同时登记进 `INCLUDE` 和 `tools/verify.sh` 打包卫生那一节的顶层白名单正则，否则插件会当场加载失败或校验报红。这是白名单相对黑名单的关键好处：**漏登记 5 秒内就暴露，而不是等审核回信**。
- 开发期同步用 `./sync-to-eagle.sh`（等价于 `build-package.sh --install`），装完重启 Eagle（Eagle 只在启动时扫描插件目录）。
- 打包前跑 `./tools/verify.sh`，「打包卫生」一节必须绿。
- 跑 `./tools/clean-workspace.sh` 清掉 `.DS_Store`。

提交到插件中心前，对照官方的[投稿前检查清单](https://developer.eagle.cool/plugin-api/zh-cn/distribution/prepare)。
