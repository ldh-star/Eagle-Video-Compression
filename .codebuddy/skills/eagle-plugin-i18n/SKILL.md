---
name: eagle-plugin-i18n
description: 「视频压缩」Eagle 插件的多语言维护：新增或修改界面文案时同步八个语系的语言包、检查键与占位符一致性、清理死键。改动任何用户可见文案时使用。
allowed-tools: Read, Write, Edit, Grep, Glob, Bash
---

# 多语言维护

Eagle 内建 i18next，按 `manifest.languages` 加载 `_locales/<lang>.json`。**缺键时 Eagle 不报错，只把 key 原样渲染出来**——界面上出现 `ui.startCompression` 这种字符串是唯一症状，而且只在切到那个语系时才看得到。所以一致性必须靠脚本盯住。

## 八个语系

`de_DE`、`en`、`es_ES`、`ja_JP`、`ko_KR`、`ru_RU`、`zh_CN`（fallback）、`zh_TW`。

这正好是 Eagle 支持的全部语系，不能多也不能改名——写错的代码 Eagle 会**静默忽略整个语言包**。

`zh_CN` 是 fallback，也是事实来源：新文案先写中文，再翻其余七种。

## 文案怎么写进代码

### JS 里

```js
tr('ui.startCompression', '开始压缩')                    // 无变量
tr('runtime.listStat', '共 {{count}} 个文件，{{size}}', { count: n, size: s })
```

`tr()` 定义在 `js/app.js` 顶部，`js/i18n.js` 是对 Eagle 内建 i18next 的安全适配层。

**第二个参数（中文 fallback）必须写全。** i18next 未就绪、旧版 Eagle、本地 jsdom 测试环境下，它是唯一会显示的内容。省略 fallback 会让插件在这些场景下变成空白页。

### HTML 里

```html
<span data-i18n="ui.brandName" data-i18n-fallback="视频压缩">视频压缩</span>
<button data-i18n-title="ui.themeTitle" title="主题：跟随 Eagle">…</button>
```

支持的属性：`data-i18n`（文本）、`data-i18n-title` / `data-i18n-placeholder` / `data-i18n-aria-label`（属性值）。

### 表驱动与动态键

`app.js` 里有按结构定位的表驱动写法，以及 `tr('ui.hdr_' + kind, ...)` 这类拼接。`check-i18n.js` 已经能识别这两种形态（拼接前缀按「以 `.` 或 `_` 结尾的字面量」处理）。新增动态键时保持这个形状，否则会被误报成死键。

## 命名空间

| 前缀 | 用途 |
| --- | --- |
| `manifest.app.name` | 插件名。**每个语系都必须有**，缺了插件名会显示成模板字符串 |
| `ui.*` | 静态界面文案：标签、按钮、提示 |
| `runtime.*` | 运行期动态文案：状态、汇总、通知 |

## 新增或修改文案的流程

1. **先改 `_locales/zh_CN.json`**，放进正确的命名空间。
2. **同步其余七个文件**，键路径完全一致。
3. **代码里用 `tr(key, 中文原文)` 引用**，fallback 就是 zh_CN 里的那句。
4. **跑检查**：

```bash
node tools/check-i18n.js
```

### 占位符规则

`{{name}}` 形式。**同一个键在八个语系里的占位符集合必须完全一致**——某个语系少写一个 `{{count}}`，那条文案在该语言下就永远显示不出数字，而且没有任何报错。`check-i18n.js` 逐键比对。

翻译时占位符不要翻译、不要改名、不要加空格变体（`{{ count }}` 和 `{{count}}` 都能解析，但保持统一）。

### 翻译时的约定

- **产品名词不译**：H.264 / H.265 / HEVC / AV1 / VP9 / CRF / FFmpeg / HDR10 / HLG / Dolby Vision / `hvc1` / BT.2020
- **界面按钮名要和 `docs/<语系>.md` 里提到的一致**，两边别用不同译名
- **德语、俄语文案通常比中文长 1.5～2 倍**，涉及按钮和窄栏位的文案要挑短词，改完在 Eagle 里切到该语言看一眼有没有截断
- **韩语、日语的助词随前后文变化**，不要把带 `{{}}` 的句子拆成拼接片段
- 简繁之间「取消」「移除」「未知」等词本来就同形，`check-i18n.js` 不会对 zh_CN/zh_TW 报「疑似漏翻」

## check-i18n.js 检查什么

| 级别 | 检查项 |
| --- | --- |
| FAIL | `manifest.languages` 与 `_locales/` 目录不对齐 |
| FAIL | 语系代码不在 Eagle 支持的八个里 |
| FAIL | 某语系相对 fallback 缺键或多键 |
| FAIL | 同一键在不同语系的 `{{占位符}}` 不一致 |
| FAIL | 缺 `manifest.app.name`；值为空字符串或非字符串 |
| FAIL | 代码引用了但语言包没定义的键（界面会漏出 key） |
| warn | 语言包定义了但代码找不到引用的键（疑似死键） |
| warn | 某语系的值与 fallback 逐字相同且含中文（疑似漏翻）。zh_CN/zh_TW 之间不检查；已确认正确的同形译文列在 `KNOWN_IDENTICAL` 里 |

`--json` 输出机器可读结果。

## 处理告警

**死键**：先用 `Grep` 确认代码里真的没有任何形式的引用（含拼接、表驱动），确认后从八个语言包一起删。不确定就留着——多一个键的代价远小于删错。

**疑似漏翻**：先确认是不是误报。术语（`H.265`、`CRF`）本来就该保持原文；有些词在两种语言里本来就同形，比如 ja_JP 的 `runtime.analysisInProgress = "分析中…"`——日语「分析」是正确用词，且该语言包里 7 个相关键统一用「分析」，改成「解析」反而破坏一致性。**确认无误的同形译文加进 `check-i18n.js` 顶部的 `KNOWN_IDENTICAL`，并在注释里写清为什么**，不要靠每次人工忽略。真的是漏翻就补上。

## 新增源文件时

`tools/check-i18n.js` 顶部的 `SOURCE_FILES` 列出被扫描的文件。新增 `js/*.js` 时记得加进去，否则该文件里的键引用不会被统计，会误报成死键。

## 相关

- 用户可见的多语言简述文档 `docs/<语系>.md` 由 `eagle-plugin-release` 维护。语言包和简述文档是两套东西：前者是界面字符串，后者是插件说明。
