# 视频压缩插件 · 代码评审与性能改进方案

评审日期：2026-09-07　|　评审范围：`js/ffmpeg.js`（1824 行）、`js/app.js`（2570 行）、`tests/`、`tools/`
评审环境：macOS Apple Silicon、`ffmpeg 7.1.1`（homebrew，**只编译了 VideoToolbox**，无 NVENC / QSV / AMF）

> 本轮只做评审与测试建设，**没有改动任何业务代码**。下面所有「建议」都配套了一个可执行的用例，
> 见 `tests/cases/` 与 `node tools/run-tests.js --list`。未修复的项在用例集里是 `xfail` 状态：
> 现在报 `XFAIL`（不算红），修复后会自动变成 `XPASS` 并**让校验失败**，逼你回去把状态翻成 `implemented`。

---

## 一、结论先看

| 优先级 | 项 | 预期收益 | 风险 |
| --- | --- | --- | --- |
| **P0** | 多轨 / 字幕 / 章节静默丢弃 | 避免不可逆素材损毁 | 低 |
| **P0** | 产物变大仍替换原文件 | 安全 + 省时间 | 低 |
| **P0** | 源目录临时文件清不掉、会被 Eagle 当新素材导入 | 避免污染素材库 | 低 |
| **P0** | `codec.id === 'x264'` 死代码 | 码率上限从未生效 | 无 |
| **P1** | **接入 VideoToolbox** | 墙钟 2~10×，CPU 占用降到 1/14 | 中（需质量标定 + 回退） |
| **P1** | 音轨直通（已是 AAC/Opus 且码率够低） | 音轨编码耗时 → 0，且无损 | 低 |
| **P1** | 两遍编码 pass1 降档 | 目标大小模式总耗时 −40% | 低 |
| **P1** | VP9 开 `-row-mt 1` | 实测 1.68×（仅 VP9） | 低 |
| **P1** | 线程预算按编码器分档 | 16 核以上机器 1.5~2× | 中（多 worker 会互抢） |
| **P1** | ffprobe 并发 + 导入期 UI 批处理 | 200 文件首屏从「卡死」到秒级 | 低 |
| **P1** | 提交阶段免一次全量复制 | 5 GB 产物省 5 GB 读 + 5 GB 写 | 低 |

**最大的单点收益是 VideoToolbox。** 而这台机器上插件当前是 100% CPU 编码 —— 见下节实测。

---

## 二、实测数据（本机，不是估算）

### 2.1 硬件加速：插件在本机完全没接上

```
ffmpeg -hide_banner -encoders | grep -Ei "videotoolbox|nvenc|qsv|amf"
 → h264_videotoolbox / hevc_videotoolbox / prores_videotoolbox   （有！）
 → 无 nvenc / qsv / amf

js/ffmpeg.js:144  HW_FAMILY_ORDER = ['nvenc', 'qsv', 'amf']      （不含 videotoolbox）
```

于是 `detectHardware()` 在这台机器上返回 `families: []`，UI 显示「未检测到硬件编码」，全部任务走 libx265。

### 2.2 编码吞吐对比（1920×1080 / 30fps / 20s，testsrc2）

| 命令 | 墙钟 | CPU 占用 | 产物 |
| --- | --- | --- | --- |
| `libx265 -preset medium -crf 28`（插件现状） | **6.05 s** | **723 %**（约 7.2 核） | 11.32 MB |
| `hevc_videotoolbox -q:v 52` | **2.87 s** | **53 %**（约 0.5 核） | ≈11.3 MB（对齐点） |
| `hevc_videotoolbox` + `-hwaccel videotoolbox` | 2.93 s | 35 % | — |

墙钟只有 2.1× 是因为 testsrc2 是合成素材、x265 跑到了 99 fps；真实摄像机素材上 x265 medium 通常只有
20~30 fps，差距会放大到 5~10×。**而 CPU 占用已经是 14× 的差距** —— 这意味着硬件编码时可以把
省下来的核分给并发，整机吞吐的差距比单任务墙钟更大。

### 2.3 VideoToolbox 的 `-q:v` 标定（这条修正你的估算）

VT 的 `-q:v` 是「越大越好」，和 CRF 方向相反。实测扫点（同一素材）：

| `-q:v` | 产物 |
| --- | --- |
| 40 | 4.57 MB |
| 50 | 8.30 MB |
| 55 | 14.71 MB |
| 60 | 17.46 MB |
| 65 | 20.80 MB |

x265 `-crf 28` = 11.32 MB → 插值得到对齐点 **q ≈ 52.4**。
你给的 `q = 100 - crf * 1.6` 在 crf=28 时算出 55.2 → 14.7 MB，**比软件编码大约 30%**。
建议系数取 **1.7**（crf 28 → 52.4），并且这个系数必须在真实素材上复标一次 —— 合成素材的
率失真曲线和真片差得远，标定值只能当起点。

### 2.4 `-threads` 对各编码器的实际效果（实测日志）

| 编码器 | `-threads 2` 后的实际并行度 | 结论 |
| --- | --- | --- |
| `libx264` | 生效（1 线程 4.23 s → 8 线程 1.01 s，4.2×） | ✅ 不用改 |
| `libx265` | **无效**，日志仍是 `Thread pool created using 14 threads`；加 `-x265-params pools=2` 后变成 2 线程（耗时 6.05 s → 17.4 s，证明确实被限速） | ❌ 必须补 `pools=` |
| `libsvtav1` | **无效**，`Level of Parallelism` 恒定 5，不随 `-threads` 变化 | ❌ 必须补 `-svtav1-params lp=` |
| `libvpx-vp9` | 无 `row-mt` 时并行度受 tile 数限制 | ❌ 见下 |

### 2.5 VP9 `-row-mt`（实测）

1080p / 6s / `-cpu-used 4`：

- 现状：4.05 s
- 加 `-row-mt 1 -tile-columns 2`：**2.41 s**（**1.68×**）

### 2.6 多轨丢失：已复现

造一个 `1 视频 + 2 音轨(aac) + 1 字幕(srt)` 的 MKV，用插件自己的 `buildPlan` 生成命令并执行：

```
源: 0 h264/video  1 aac/audio  2 aac/audio  3 subrip/subtitle
产物: 0 hevc/video  1 aac/audio  2 ass/subtitle      ← 第二条音轨没了，退出码 0，无警告
```

且 `normalizeProbe` 只保留第一条音轨（`js/ffmpeg.js:983`），也就是说**界面上根本看不出这个文件有两条音轨**。

---

## 三、对你 18 条的逐条复核

图例：✅ 确认　⚠️ 确认但要修正细节　❌ 不成立

### P0 正确性

| # | 结论 | 复核说明 |
| --- | --- | --- |
| 1 | ✅ | 已复现（2.6）。**补充两点**：① `normalizeProbe` 只存第一条音轨，界面上完全看不出丢轨；② `verifyOutput` 只校验大小与时长，**不校验流数量**，所以修完 `-map` 之后仍缺一道「产物完整性」把关。建议 `verifyOutput` 增加流数/流编码比对，并在 UI 上显示音轨数。 |
| 2 | ✅ | 流程确实是 `verifyOutput → 备份 → 替换`，中间没有体积闸门。**补充**：判断点要放在**备份之前**，否则「变大不替换」还会白备份一次大文件。建议做成纯函数 `shouldCommit(outSize, srcSize)`，阈值 0.98，状态用新的 `skipped`。 |
| 3 | ✅ | `preferredTempDir` 写源目录、`purgeStaleTemp` 只扫 `os.tmpdir()`，确凿。**补充**：`eagle-vc-pass-*.log` / `.log.mbtree`（两遍编码的 passlog）也在源目录，同样收不掉，也是 Eagle 可见的非隐藏文件。`TEMP_PREFIXES` 里已经有 `eagle-vc-pass-`，只是扫描范围不对。 |
| 4 | ✅ | `js/ffmpeg.js:1278` `codec.id === 'x264'` 永远为假（id 是 `h264`）。**修正建议**：这个分支本意是「码率模式给个峰值上限」，不应只对 h264 生效 —— 应改成 `settings.mode !== 'crf'` 全覆盖（CRF 模式下 x264/x265 不需要、VP9 反而要求 `-b:v 0`）。 |

### P1 性能 · 编码吞吐

| # | 结论 | 复核说明 |
| --- | --- | --- |
| 5 | ✅ | 最大单点收益，实测见 2.1~2.3。**修正**：`-q:v` 系数建议 1.7 而非 1.6（2.3）；`HW_QUALITY_ARGS` 需要给 videotoolbox 单独一条（`-q:v N`，不是 constqp）；`HW_DECODE_METHOD` 补 `videotoolbox`（实测可用，能再省约 0.2 核）；10-bit 用 `-pix_fmt p010le` + `-profile:v main10`。 |
| 6 | ⚠️ | x265 / SVT-AV1 两条都实测成立（2.4）。**精确化**：x265 要 `-x265-params pools=N`（实测有效）；SVT-AV1 的 `-threads` 确实无效，但补 `lp=N` 之前建议先确认 ffmpeg 的 libsvtav1 版本是否转发该参数 —— 本机 v3.0.2 上 `-threads` 完全不转发，`lp=` 是否转发需要再验一次（用例 `P1-06b` 已钉住这一点）。 |
| 7 | ✅ | 实测 1.68×（2.5）。补充：`-tile-columns` 按宽度给（1080p→2，4K→3），`-cpu-used 0`（最慢档）时 row-mt 收益会变小，别指望全档位都是 4×。 |
| 8 | ✅ | `Math.min(8, ...)` 在 16/24 核机器上直接砍掉一半算力。建议按编码器分档：x264 上限 16（>16 线程收益递减且伤画质），x265/AV1 不设上限或 cores−1。 |
| 9 | ✅ | `cap = 1` 对 AV1 / 两遍模式。补充：这个 cap 和 #6 是耦合的 —— 先把线程预算修对（让单进程能真正限流），才谈得上放开多 worker，否则放开会互相抢核。顺序上 #6 应该在 #9 之前。 |
| 10 | ⚠️ | **收益面比预期小**：`runTask` 里只要 `settings.replaceInEagle && t.eagleItem` 成立，走的是 `t.eagleItem.replaceFile(tmpOut)`，**根本不经过 `atomicReplaceFileAsync`**。所以这项只在「关闭同步回 Eagle」或「没有关联 Eagle 素材 / replaceFile 失败回退」时生效。仍然值得修（本地文件模式就是主路径之一），但别按「所有任务都省一次全量复制」来估算收益。实现上 `rename` 失败再回退 `copy + rename` 是对的，注意 `EXDEV` 之外的错误要原样抛出。 |
| 11 | ✅ | 现状无条件 `-c:a aac -b:a 128k`。建议：源 codec ∈ {aac, opus} 且 `srcBitrate ≤ target × 1.1` → `-c:a copy`，并在日志里写明「源音轨已够小，直接复制」。注意 WebM 的 `resolveAudioEncoder` 返回 libopus，直通判断要对上。 |
| 12 | ✅ | pass1 复用 pass2 的 `-preset`。x264 内部有 turbo 兜底，x265 没有（默认 `slow-firstpass=1`），所以 x265 上就是两次 veryslow。**补充**：pass1 现在输出到 `-f mp4 /dev/null`，会走一遍 mp4 muxer；改成 `-f null -` 更省。 |
| 13 | ✅ | 串行 ffprobe。**补充**：比串行更严重的是 O(N²) —— 见下面「我额外发现」第 1 条。 |

### P1 性能 · UI 渲染

| # | 结论 | 复核说明 |
| --- | --- | --- |
| 14 | ✅ | `renderList` 全量 `innerHTML=''` + 重建，滚动位置丢失。已有 `t.el` / `t.view` 缓存，改增量 diff 成本不高。 |
| 15 | ✅ | `renderTask` 每次重建整行 `meta.innerHTML`（含 escapeHtml + estimateOutputSize），而 `refreshEstimate` 会对**所有**任务循环调用它。 |
| 16 | ✅ | `renderSummary` 内部多次 `filter` 全表，且挂在 worker 的每个 `.then` 上（`js/app.js:1454`）。建议一次 `reduce` 出全部计数 + 与进度同款 120 ms 节流。 |
| 17 | ✅ | `sampleCacheKey` 里的 `fs.statSync`，且被 `scheduleSamplingEstimates` 对所有任务调用。mtime 在 `probe` 时存进 `t.meta` 即可。 |
| 18 | ✅ | `uniquePath` 同步 `existsSync` 循环。它没导出到 `App._internal`，测试拿不到 —— 用例 `P1-18` 标为 `blocked`，需要先导出。 |

---

## 四、我额外发现的问题

### 4.1 UI：导入 N 个文件是 O(N²)，比 ffprobe 串行更严重 ⚠️

`probePendingTasks`（`js/app.js:770`）**每探测完一个文件**就调用：

```
refreshCodecUI()      // 全表 filter 数 10-bit 片源
refreshEstimate()     // → 对所有任务 renderTask() + scheduleSamplingEstimates()
renderSummary()       // 全表 filter ×5
```

而 `scheduleSamplingEstimates` 第一步就是 `cancelSamplingEstimates()` —— 前 3 个文件的采样被
反复取消重启。导入 200 个文件的真实表现不是「慢一点」，而是「界面卡住 + 采样永远跑不完」。

**这是首屏性能的主因，优先级应在 #13 之前。** 建议：探测期只做「标记状态 + 单行 renderTask」，
把 `refreshEstimate / renderSummary / renderNotices` 合并到 120 ms 节流的批处理里，探测全部结束后再补一次。

### 4.2 CRF 采样是串行的

`estimateCrfBySampling` 里 3 段采样用 `chain` 串行（`js/ffmpeg.js:1541`），且 `scheduleSamplingEstimates`
对多个任务也是串行 chain。批量「分析全部」时 = 3N 次串行 ffmpeg。空闲期可以并行 2~3 路。

### 4.3 硬件编码 + 缩放滤镜会掉回 CPU

`hwInputArgs` 用的是不带 `-hwaccel_output_format` 的形式（帧解码后回系统内存），所以 `-vf scale=...`
在 CPU 上跑完再传给 GPU 编码器。1080p→720p 时这部分开销不算小。要保住全 GPU 链路得上
`scale_cuda` / `scale_vt` + `hwupload`。**建议先不做**（组合矩阵复杂、踩坑成本高），但要知道现状。

### 4.4 取消用 SIGKILL

`js/ffmpeg.js:1656` `child.kill('SIGKILL')`。ffmpeg 收到 SIGINT/SIGQUIT 会正常收尾，SIGKILL 不会 ——
两遍编码的 passlog 会残留、临时产物处于半写状态。改成先 SIGTERM、800 ms 后再 SIGKILL 更稳。

### 4.5 `sampleEstimateCache` 无上限

长会话里不断改参数，缓存条目只增不减。建议 LRU 或按 revision 清理。

### 4.6 SVT-AV1 默认 `tune=1`（PSNR）

实测日志：`SVT [config]: preset / tune / pred struct : 8 / PSNR / random access`。
`tune=1` 针对 PSNR 优化，**对主观视觉质量不利**。AV1 分支建议补 `-svtav1-params tune=0`（VQ）。

### 4.7 VP9 / AV1 在「目标文件大小」模式下只跑单遍

`CODECS.vp9.twoPass = false`、`CODECS.av1.twoPass = false`。CRF 模式无所谓，但目标大小模式下
单遍码控精度明显差。至少 AV1 应该考虑放开（SVT-AV1 单遍 CRF 的码率误差可以到 ±30%）。

### 4.8 并发硬上限 4

`recommendedWorkerCount` 里 `Math.min(4, ...)` + UI 选项最多 4。在 24 核机器上压一堆 720p 小片时偏保守。
和 #8/#9 一起改。

### 4.9 运行时约束：代码是 Node 16，测试是 Node 22

`eagle-plugin-conventions` 里写的是宿主 Chromium 107 + **Node 16**。写 `js/` 下的修复时
**不能用 Node 18+ 才有的 API**（`fs.cp`、`structuredClone`、`Array.prototype.at`、`AbortSignal.timeout`）。
`tests/` 跑在本机 Node 22 上，不受此限。这个差异常常被忽略，值得在修复前先确认。

---

## 五、建议的修复顺序

按「收益 ÷ 风险」排，每批单独验证：

1. **批 1（P0 正确性，低风险）**：#1 多轨保留 + `verifyOutput` 流数校验 → #2 变大不替换 → #4 死代码 → #3 临时文件注册表 + 隐藏前缀
2. **批 2（低风险参数项）**：#11 音轨直通 → #12 pass1 降档 → #7 VP9 row-mt → 4.6 SVT-AV1 `tune=0`
3. **批 3（VideoToolbox）**：#5 接入 + `-q:v` 真实素材标定 + 硬解 + 失败回退（现有回退链路已经能兜住）
4. **批 4（资源预算）**：#6 线程 → #8 上限分档 → #9 worker 放开 → 4.9 并发上限
5. **批 5（UI）**：4.1 导入期 O(N²) → #13 ffprobe 并发 → #16 节流 → #14/#15 增量渲染 → #17 mtime → #18 异步 exists
6. **批 6**：#10 提交免复制（注意收益面，见复核表）→ 4.2 采样并行 → 4.4 优雅退出 → 4.5 缓存上限

批 4 之前必须先把批 4 的 #6 做完，否则放开 worker 只会让多个 x265 进程各自吃掉全部核心。

---

## 六、本次新增的测试能力

```bash
node tools/run-tests.js --list           # 列出全部用例（ID / 级别 / 状态 / 标题）
node tools/run-tests.js                  # 跑全部
node tools/run-tests.js --only P0        # 只跑 P0（也接受 P1/P2/LOCK/NEW、分片名 plan、area:ui、具体 ID）
node tools/run-tests.js --contract P0-01 # 打印某条的完整故障描述与契约
node tools/run-tests.js --json           # 结构化输出，同时写入 tests/.run-result.json
node tools/run-tests.js -v               # 失败时打印堆栈
```

- 运行器：`tools/run-tests.js`；用例集：`tests/cases/`
- `tools/verify.sh` 的回归测试步骤后面加了「标准用例集」一步，闸门语义不变：
  退出码非 0 = 有 `FAIL`（已实现的行为被改坏）或 `XPASS`（缺陷已修但状态没翻）

### 用例状态机

| status | 通过时 | 失败时 |
| --- | --- | --- |
| `implemented` | `PASS` | `FAIL` —— 红了，必须修 |
| `xfail` | `XPASS` —— **红了**：缺陷已修，请把 status 翻成 `implemented` | `KNOWN-FAIL` —— 预期内，不算红 |
| `blocked` | `BLOCKED`（缺导出/依赖，写明原因） | 同上 |

XPASS 算失败是故意的。不这么做的话，用例集会慢慢变成一堆没人维护的 `xfail`，
最后谁也不知道哪些缺陷其实早就被顺手修掉了。**修完一个缺陷的完整动作是：
改代码 → 看到 XPASS → 翻 status → 重跑全绿。**

### 当前基线（41 条）

```
通过 12 | 已知缺陷 28 | XPASS 0 | 失败 0 | 跳过 0 | 待补入口 1
```

| 分片 | 条数 | 覆盖 |
| --- | --- | --- |
| `plan.js` | 18 | 多轨保留、VideoToolbox、线程/并行度参数、VP9 row-mt、音轨直通、pass1 降档 |
| `budget.js` | 9 | 线程分档、worker 数、用户上限、硬件收敛 |
| `commit.js` | 7 | 体积闸门、临时文件回收与隐藏、同卷 rename、取消不留残file、原子提交 |
| `ui.js` | 7 | 增量渲染、renderSummary 扫描次数、导入期 O(N²)、ffprobe 并发、同步 stat |

其中 12 条 `LOCK-*` 是**锁定项**：当前正确但语义微妙、修缺陷时最容易误伤的行为
（VP9 的 `-b:v 0`、x264 线程上限 16、两遍编码保持单 worker、取消不留 staging……）。

### 几条用例把「性能问题」变成了数字

| 用例 | 实测 |
| --- | --- |
| `NEW-01` 导入期复杂度 | 25 个文件 → 任务表被扫 **9862** 次 ≈ 16×N²（线性上限 1250） |
| `P1-16` renderSummary | 100 个任务 → **301** 次元素访问（三次全表 filter + 一次 some；上限 200） |
| `P1-13` ffprobe 并发 | 最大同时在飞 **1**，严格串行 |
| `P1-15` 进度重绘 | 只改 progress 也会整行重建 meta 子树 |
| `P1-17` sampleCacheKey | 每次调用 **1 次**同步 `statSync` |
| `P1-10` 同卷提交 | 无条件多 **1 次** `copyFile` |

> 上面这张表（以及本节的基线数字）记录的都是**修复前**的实测值。
> 修复后的对照见第七节。

`js/` 下的业务代码本轮**一行未改**。

---

## 七、执行结果

按第五节的分批顺序全部修完。基线实测是 `通过 12 | 已知缺陷 21 | XPASS 7`（上一轮已把
P0 的代码改了但没翻状态），收尾是 **`通过 41 | 已知缺陷 0 | XPASS 0 | 失败 0`**，
`./tools/verify.sh` 全绿。

### 逐批落地

| 批 | 内容 | 关键改动 |
| --- | --- | --- |
| 1 | P0 正确性 | 多轨 `-map` + `verifyOutput` 流数校验；体积闸门放在备份之前（`shouldCommit`）；`#4` 死代码改成按 `mode !== 'crf'`；临时名统一加 `.` 前缀 + 临时目录注册表 |
| 2 | 低风险参数 | 音轨直通（codec 匹配且 `srcBps ≤ 目标 × 1.1`）；pass1 降档 + `-f null -`；VP9 `-row-mt` / 按宽度 `-tile-columns`；SVT-AV1 `tune=0` |
| 3 | VideoToolbox | 接入 `h264_videotoolbox` / `hevc_videotoolbox`，质量走 `-q:v`（系数 1.7，与 x265 crf 28 对齐到 q≈52.4）、硬件解码、10-bit 补 `-profile:v main10` |
| 4 | 资源预算 | `-x265-params pools=N` / `-svtav1-params lp=N`（`-threads` 对这两家无效）；线程上限按编码器分档（x264 16、x265/AV1 不设硬上限）；AV1 小分辨率放开 2~3 路；≥24 核时并发上限 4 → 8（UI 同步给出 6/8 选项） |
| 5 | UI 性能 | `renderList` 增量复用行；`renderTask` 按内容 diff；`renderSummary` 合并成一次遍历 + `updateButtons` 复用统计；探测期只更新单行、整表刷新合并到 120 ms 批处理；ffprobe 4 路并发；mtime 挪到探测阶段；`uniquePath` 改异步并设上限 |
| 6 | 提交与收尾 | 同卷直接 `rename`（仅 `EXDEV` 才回退复制）；取消先 SIGTERM、800 ms 后 SIGKILL；采样缓存 200 条 LRU；后台采样 2 路并发 |

### 几个实测数字

| 项 | 修前 | 修后 |
| --- | --- | --- |
| 导入 25 个文件的元素访问 | 9862（≈16×N²） | **606**（线性上限 1250） |
| `renderSummary`（100 任务） | 301 次 | **100** 次（单次遍历） |
| ffprobe 同时在飞 | 1 | **4** |
| 同卷提交的 `copyFile` | 1 次 | **0** 次 |
| x265 线程池（`-threads 2`） | 实际 14 线程 | **2** 线程（`pools=2`） |
| SVT-AV1 并行度（`-threads 2`） | 恒定 5 | **2**（`lp=2`，本机 ffmpeg 7.1.1 确认会转发） |

### 复核里存疑的两点，结论

* **SVT-AV1 `lp=` 到底转不转发**（#6）：本机 ffmpeg 7.1.1 上确认有效 ——
  不加时 `Level of Parallelism: 5`，加 `lp=2` 后变成 2。可以按「有效」处理，
  但如果在别的 ffmpeg 构建上发现不生效，`P1-06b` 会重新变红。
* **`P1-06a` / `-threads` 的关系**：`-threads` 对 x265 / SVT-AV1 不起作用但也不冲突，
  保留它（对 x264 / VP9 仍然有效）。

### 端到端复核

真实 ffmpeg 跑通 5 条路径（H.265 单遍 / H.265 两遍 / AV1 / VP9 / H.264 码率模式），
双音轨源压缩后产物仍是 `[video, audio, audio]`。
