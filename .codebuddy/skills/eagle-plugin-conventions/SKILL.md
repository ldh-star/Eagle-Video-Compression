---
name: eagle-plugin-conventions
description: 「视频压缩」Eagle 插件的运行时约束、工程结构与历史踩坑记录。改动本仓库任何代码前先读，避免重复踩已经付出过代价的坑。
user-invocable: false
---

# Eagle 插件工程约定（视频压缩）

本仓库是一个 Eagle 窗口插件。下面的内容不是通用最佳实践，而是这个工程实际付出过代价换来的约束。

## 一、运行时是什么

| 项 | 事实 | 后果 |
| --- | --- | --- |
| 宿主 | Eagle 内嵌 Chromium 107 + Node 16 | 可以用 Node 原生 API 和第三方模块，但别用 Node 18+ 才有的 API |
| 加载 | Eagle **只在启动时扫描插件目录** | 改完代码必须重启 Eagle，不是刷新窗口 |
| 构建 | **没有构建步骤**，源码即产物 | 一个语法错误 = 整份脚本不执行 = 界面卡在 HTML 初始文案，且没有任何报错弹窗 |
| 打包 | Eagle 插件面板右键「打包插件」导出 `.eagleplugin` | 整个目录进包，开发期文件也会一起进去 |
| 跨域 | 不受 CORS 限制 | —— |

## 二、manifest.json 的硬约束

- `version` 必须是 `x.y.z`。它是 Eagle 唯一读取的版本号来源。
- `languages` 只能取 Eagle 支持的八个语系代码：`en`、`ja_JP`、`es_ES`、`de_DE`、`zh_TW`、`zh_CN`、`ko_KR`、`ru_RU`。写错的代码 Eagle 会**静默忽略**整个语言包。
- `fallbackLanguage` 必须在 `languages` 里。本工程是 `zh_CN`。
- `name` 用 `{{manifest.app.name}}` 占位，真正的名字在每个 `_locales/<lang>.json` 的 `manifest.app.name`。缺了这个键，插件名会直接显示成模板字符串。
- `dependencies: ["ffmpeg"]` 让 Eagle 提供 FFmpeg；取不到时代码会回退到本机安装的 FFmpeg/FFprobe。
- `logo` 指向 `/logo.png`。保持 **512×512、带 alpha**，控制在 512 KB 以内——`.eagleplugin` 是整个目录进包，一张 1000px 的原图能占掉整包的绝大部分体积。本机没有 pngquant/optipng 时用系统自带的 `sips -Z 512 logo.png --out logo.png` 降采样即可（保留 alpha 和 8 位深）。

## 三、工程结构

```text
manifest.json        Eagle 清单与语系声明
index.html           插件窗口
css/style.css        跟随 Eagle 主题的样式
js/plugin.js         生命周期入口（多入口 + 轮询兜底 + 降级启动）
js/app.js            界面、任务队列、设置、Eagle 编排
js/ffmpeg.js         探测、编码计划、执行、抽样预估（纯逻辑，可在 Node 里直接 require）
js/format.js         展示与体积格式化
js/i18n.js           Eagle 内建 i18next 的安全适配层
js/logger.js         本地诊断日志
js/logger-ui.js      日志面板
_locales/*.json      八种语系的语言包
tests/*.js           Node + jsdom 回归测试，每个文件独立可执行
tools/*              校验与发版脚本（见 eagle-plugin-verify / eagle-plugin-release）
docs/<语系>.md       八种语言的简述文档（见 eagle-plugin-release）
sync-to-eagle.sh     开发期同步到本机 Eagle 插件目录
```

**分层原则**：`js/ffmpeg.js` 只做纯逻辑，不碰 DOM、不碰 `eagle.*`，所以能在 Node 里 `require` 后直接单测。任何新增的编码决策逻辑都应该放这里，而不是塞进 `app.js`。破坏这条分层，测试就只能走 jsdom 全量拉起，成本会上一个数量级。

## 四、已经付出过代价的坑

这些都是真实故障，改相关代码前务必知道：

1. **生命周期回调不保证触发。** 官方文档明确说「不需要 manifest 信息的插件也可以用 `window.onload`」，意味着 `onPluginCreate` 并非总会被调用。`js/plugin.js` 因此挂了四个入口（`onPluginCreate` / `onPluginRun` / `onPluginShow` / `window.onload`）加 200ms 轮询兜底，用 `booted` 防重入。**不要把它简化成单一入口。**

2. **`eagle` 全局是异步注入的。** 脚本执行那一刻它可能还不存在。严格模式下直接读未声明变量会抛 `ReferenceError`，异常被 catch 吞掉后表现是「界面完全没反应」。必须用 `typeof eagle !== 'undefined'` 判断。同理，生命周期注册要允许「拿到 eagle 之后补注册」。

3. **HEVC 写进 MP4/MOV/M4V 必须打 `-tag:v hvc1`。** FFmpeg 默认写 `hev1`，Eagle 自己能播，但 macOS 访达 / 快速查看 / QuickTime 打不开。而且这个 tag **只能给真 HEVC 流打**——copy 模式下要回读探测到的源编码，把 H.264 标成 hvc1 会让 MP4 muxer 写头时失败，整个任务报废。

4. **MP4/MOV/M4V 写自定义 metadata 必须加 `-movflags +use_metadata_tags`。** 否则 muxer 会静默丢弃不认识的 key：退出码 0、文件能播、标记没了。MKV/WebM 原生支持但会把 key 大写，读取要忽略大小写。**AVI 和 TS 根本存不了任意 metadata**，不要假装写成功了。

5. **替换原文件必须走「暂存 + 原子 rename」。** 直接覆盖写在中途失败会留下截断的原素材。见 `App._internal.atomicReplaceFileAsync`。

6. **Eagle 会连续快速触发 `onPluginRun` / `onPluginShow`。** 迟到的选中素材读取回调会把用户已经关掉的对话框重新弹开。用递增的版本号丢弃过期回调。

7. **HDR 判定不能只看 `color_transfer`。** 实测有 HLG 样本容器里根本没写这个字段，只留了 `color_space=bt2020nc`。必须有「BT.2020 且位深 ≥10bit 视为 HDR」的兜底规则。

8. **H.264 预设没有 10bit 路径。** 对 HDR 素材选 H.264 会强制转 8bit、不可逆丢失 HDR 信息，而且没有任何可见迹象。当前策略是在汇总栏警告，**不阻断、不自动改设置**——选择权留给用户。

## 五、写代码时的约定

- 注释写「为什么」，尤其是防御性代码要写清防的是哪个具体故障；只描述「做了什么」的注释不要写。
- 所有面向用户的文案都要走 `tr(key, 中文fallback)`，fallback 必须写全，因为 i18next 未就绪时它是唯一显示的内容。详见 `eagle-plugin-i18n`。
- 新增行为改动时，UI 文案、语言包键、回归测试三者要同步，不要拆到不同提交。
- 不要引入第三方追踪、网络上传，或没有明确用户提示的破坏性文件操作。

## 六、相关技能

- 提交 / 发版前的校验：`eagle-plugin-verify`
- 版本号、变更日志、简述文档：`eagle-plugin-release`
- 语言包维护：`eagle-plugin-i18n`
