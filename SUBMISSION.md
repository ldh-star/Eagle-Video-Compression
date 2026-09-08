# 视频压缩 · 各语言提交文案

> 由 `docs/<语系>.md` 自动生成，对应版本 **1.1.2**。
> 每个语系三节：简述 / 使用说明 / 版本日志，可直接复制到 Eagle 插件中心对应语系的字段。
> 只含投稿要求的 4 个语系；其余语系的 `docs/` 是插件界面语言的说明来源，不进提交表单。
> 内容改动请改 `docs/` 下的源文件后重跑 `node tools/gen-submission.js`，不要直接改本文件。

---

## English（en）

### 简述

A local batch video compression plugin for Eagle. It picks up the videos you have selected — or local files you drop into the window — re-encodes them with FFmpeg, and replaces the file at its original path once compression succeeds.

- Everything runs locally. Video files are never uploaded and no video metadata is sent to any server.
- H.265/HEVC by default, with H.264, AV1, VP9, and remux-only options.
- Three compression modes: quality first (CRF), target bitrate, and target file size (two-pass for H.264/H.265).
- CRF size estimates come from real stratified sample encodes, so the UI shows a range instead of a misleading exact number.
- Controls for resolution, frame rate, audio, encoding speed, concurrency, and 10-bit source handling.
- HDR sources are detected and their colour metadata is carried through re-encoding; already-compressed files are marked so you do not run a second lossy pass by accident.
- Optional GPU hardware encoding: Apple VideoToolbox on macOS, and NVIDIA NVENC, Intel Quick Sync or AMD AMF on Windows. Used automatically when suitable hardware is present, falling back to CPU software encoding otherwise.
- Backup is off by default and cannot be enabled until you pick a backup folder. Without it there is no copy of the original.
- Settings persist, the UI follows Eagle's theme, and eight languages are available.

### 使用说明

**Before you start**

This plugin needs a working FFmpeg **and** ffprobe. Both are required:

- Recommended: install the **FFmpeg** dependency plugin in Eagle. This plugin picks it up automatically.
- Alternatively, install FFmpeg yourself (it ships with ffprobe); the plugin falls back to your system installation.
- If neither is found, compression cannot run: the status bar reports that FFmpeg is unavailable and the runtime log opens automatically — use **Copy diagnostics** to see which paths were searched.

**Basic workflow**

1. Select one or more videos in Eagle.
2. Open **Video Compress**. The selected videos are imported into the task list automatically; you can also drop local video files into the window.
3. Choose a codec and a compression mode. H.265 with CRF 28 is the default.
4. Review the original size, estimated output size, and storage-change summary.
5. If you want to keep the original file, choose a backup folder first, then enable backup.
6. Click **Start compression**, read the overwrite and backup notes in the confirmation dialog, then confirm.

**Choosing a compression mode**

| Mode | Best for | Size behaviour |
| --- | --- | --- |
| Quality first (CRF) | General use, consistent visual quality | Final size depends on source complexity; the UI shows an estimated range from sample encodes |
| Target bitrate | A known delivery bitrate | Calculated from duration, video bitrate, and audio settings |
| Target file size | A strict size budget | H.264/H.265 use two-pass encoding; container and audio overhead can still cause a small difference |

**Choosing hardware acceleration**

The **Hardware acceleration** dropdown has three options:

| Option | Behaviour |
| --- | --- |
| Auto (detected …) | Uses the GPU when a usable hardware encoder is found, otherwise falls back to the CPU. This is the default, and the dropdown reports which family it detected |
| Force GPU hardware encoding | Hardware encoding only; fails if this machine has no usable hardware encoder |
| CPU software encoding only | Software encoding throughout, the most predictable result |

- Apple VideoToolbox is used on macOS; NVIDIA NVENC, Intel Quick Sync Video and AMD AMF require Windows with a matching GPU. Hardware encoding is there to cut wall-clock time and CPU load, and how much it helps depends on the source, the settings and the GPU. Quality at a given bitrate can differ from software encoding, so pick **CPU software encoding only** when quality matters most.
- VP9 has no hardware implementation and always uses the CPU.
- A failed hardware encode is retried once on the CPU rather than failing the task outright.
- When no usable hardware encoder is found at all, **Auto** simply runs software encoding. This is expected.

**Storage-change colours**: green means the result is smaller than the original, red means larger, and the normal text colour means it is nearly unchanged or the estimate range crosses the original size.

**Other notes**

- You can click **Stop and cancel** at any time. Running FFmpeg processes are terminated, tasks that have not started are marked cancelled immediately, and originals are left untouched.
- If you change the Eagle selection and reopen the plugin mid-run, it asks whether to cancel the action, replace the current queue, or append to it. Work in progress is never discarded silently.
- Choosing **Add to task queue** asks for one more confirmation: appended items start compressing immediately and overwrite their originals, so the dialog lists exactly which files are being added and whether backup is actually on for this run. Backup settings cannot be changed while compression is running.

**How files are replaced**

- On success, the file at its original path is replaced — including local files you dropped into the window. This is lossy and irreversible.
- Turning off **Sync back to the Eagle library** still replaces the original. That option does not control overwriting; it only decides whether the linked Eagle item is updated and its thumbnail refreshed. It cannot be used to keep the source file.
- To keep originals, click **Choose backup location…** first, then make sure **Back up original before compression** is checked. Without a folder the checkbox stays disabled and no backup happens.
- Files that do not get smaller are skipped and their originals left untouched.
- For irreplaceable media, keep an independent copy of your own.

**Data the plugin keeps, and how to remove it**

- The plugin writes exactly two files on your machine: settings at `~/Library/Application Support/Eagle 视频压缩/settings.json` and the runtime log at `~/Library/Logs/Eagle 视频压缩/plugin.log`. On Windows both live under `%APPDATA%\Eagle 视频压缩\`.
- Both paths are shown at the top of the "Runtime log" panel inside the plugin, so you can read and copy them directly.
- "Reset settings" in the top bar only restores the defaults; it does not delete the file.
- Uninstalling the plugin does not remove these files. To clear everything, delete the two folders above by hand.
- Temporary files created while compressing are written next to the source file and cleaned up when the run ends or at the next start, so they do not accumulate.

### 版本日志

#### 1.1.2

- Fixed: items appended to a running queue started compressing and replaced their originals immediately, while the prompt showed only a count and file names. Appending during a run now opens its own confirmation that lists the new files, states they will be compressed at once and replace the files at their original paths, and reports this run's actual backup state — with an explicit warning when the originals cannot be recovered.
- Fixed: the overwrite, backup and unrecoverable warnings shown before a run were hard-coded Simplified Chinese and invisible in every other language. They now come from the locale files, with full translations for all eight languages.
- Fixed: the wording implied the original was only replaced when "Sync back to the Eagle library" was on. The file at the original path is replaced either way; that option only decides whether Eagle's replace API updates the linked item and its thumbnail. The interface and the docs have been corrected.
- Improved: the usage section now opens with a "before you start" block stating that a working FFmpeg and ffprobe are both required, and what happens when neither is found.
- Fixed: the "Start compression" and "Stop and cancel" buttons jumped sideways once the summary figures were calculated. In a narrow window the buttons wrapped to a second row while the spacer that pushed them right stayed on the first, leaving them flush left. They now align right on their own, wrapped or not.
- Improved: the log panel now shows the full path of both the settings file and the log file, and the usage section gained a "Data the plugin keeps" block stating what is left behind after uninstalling and how to remove it.

#### 1.1.1

- Fixed: files with multiple audio tracks lost all but one track after compression. Every track is now kept.
- Fixed: an output larger than the source still replaced the original. Such files are now skipped and the original left untouched.
- Fixed: cancelling a task could leave a truncated half-written file. FFmpeg is now asked to exit cleanly before being killed.
- Fixed: temporary files produced during compression showed up in Eagle as new items.
- Improved: importing many files no longer stalls the interface — for 100 files the work dropped to roughly 1/144 of before.
- Improved: reading file metadata is about 3× faster; 25 files went from 1.3 s to 0.45 s.
- Improved: VP9 now encodes with multi-threaded tiles and rows — about 2.2× faster on 1080p footage.
- Improved: committing the result uses a rename instead of a full copy; writing back a 1 GB file went from about 1 second to nearly nothing.
- Improved: encoder threads are budgeted across the machine, cutting total CPU use by roughly 6–9% when several tasks run at once.
- Added: Apple VideoToolbox hardware encoding on macOS (H.264 and H.265). **Auto** uses it when it is detected.
- Added: on machines with 24 cores or more, concurrency can be set to 6 or 8.

#### 1.1.0

- Added GPU hardware encoding for NVIDIA NVENC, Intel Quick Sync, and AMD AMF. The new **Hardware acceleration** dropdown offers automatic, force GPU, or CPU only, and reports which family it detected.
- Fixed quality-scale conversion: CRF and hardware QP are different scales, so values are now converted to `-rc constqp -qp` (+2 for H.264/HEVC, ×3.2 for AV1) instead of producing files 45% to 340% off target.
- A failed hardware encode is retried once on the CPU rather than failing outright. VP9 has no hardware implementation and always uses the CPU.
- Concurrency is capped at two for hardware encoding, and the pre-compression size estimate now reflects the selected encoder.
- On 1080p30 test footage, H.265 went from roughly 28 seconds at about ten cores to roughly 3 seconds at under one core, within 0.12 dB PSNR.

#### 1.0.2

- Added HDR detection, with an amber badge in the task list for HDR10 / HLG / Dolby Vision / HDR10+.
- Colour metadata is now carried through re-encoding, so an HDR source no longer comes out flagged as SDR.
- Added an "already compressed" marker written into the output. Reloading such a file shows how many times and on which date it was compressed. It can be turned off in settings. AVI and TS cannot store arbitrary metadata, so nothing is written for them.
- The summary now reports how many files in the queue have already been compressed by this plugin.
- Fixed: choosing H.264 for an HDR source silently destroyed the HDR information; this is now surfaced as a warning in the summary.

#### 1.0.1

- Fixed: H.265 output could not be played by macOS Finder, Quick Look, or QuickTime (now tagged `hvc1`).
- Fixed: replacing the original file now goes through a staging file plus atomic rename, so cancellation or an I/O error can no longer leave a truncated source.
- Fixed: a synchronous throw from the Eagle selection API escaped its handler.
- Fixed: a late selection callback could reopen a dialog the user had already dismissed.
- Added: a visible **Stop and cancel** control during compression.
- Added: a three-way choice when the plugin is reopened with a new Eagle selection — cancel, replace the queue, or append.
- Added: items can be appended to a running queue and are picked up by idle workers.
- Added: sampling progress with **Analyze all** and **Stop analysis** controls.
- Improved: worker count is derived from CPU cores, encoder, and two-pass mode, with an explicit per-encoder thread cap.
- Improved: temporary output is written beside the source when possible, avoiding an extra full-size copy on external or network volumes.

#### 1.0.0

- First release: batch compression, multiple codecs and compression modes, size estimation, backup and replacement, and diagnostic logging.

---

## 日本語（ja_JP）

### 简述

Eagle 内で動画を一括圧縮するローカルトランスコードプラグインです。起動時に選択中の動画を自動で読み込み（ウィンドウにローカルファイルをドラッグすることもできます）、FFmpeg で再エンコードし、成功すると元のパスにあるファイルを置き換えます。

- すべての処理はローカルで完結します。動画ファイルはアップロードされず、メタデータも外部に送信されません。
- 既定の出力は H.265/HEVC。H.264、AV1、VP9、再多重化のみにも対応します。
- 圧縮方式は 3 種類：画質優先（CRF）、ビットレート指定、目標ファイルサイズ（H.264/H.265 は 2 パスエンコード）。
- CRF モードのサイズ推定は実際のサンプルエンコードに基づくため、誤解を招く単一の数値ではなく範囲で表示します。
- 解像度、フレームレート、音声、エンコード速度、並列数、10bit ソースの扱いを調整できます。
- HDR ソースを自動判別し、再エンコード時に色情報を保持します。圧縮済みファイルにはマーカーを書き込み、二重の劣化を防ぎます。
- GPU ハードウェアエンコードに対応：macOS では Apple VideoToolbox、Windows では NVIDIA NVENC / Intel QSV / AMD AMF。既定は自動で、利用可能なハードウェアがない場合は CPU ソフトウェアエンコードにフォールバックします。
- バックアップは既定でオフ。バックアップ先フォルダーを指定するまで有効にできません。オフのままだと元ファイルの控えは残りません。
- 設定は保存され、UI は Eagle のテーマに追従し、8 言語に対応します。

### 使用说明

**使う前の準備**

本プラグインには、動作する FFmpeg と ffprobe の**両方**が必要です。

- 推奨：Eagle で「FFmpeg」依存プラグインをインストールしてください。本プラグインが自動で利用します。
- ご自身でシステムに FFmpeg（ffprobe 同梱）をインストールしても構いません。その場合はローカルのインストールにフォールバックします。
- どちらも見つからない場合は圧縮できません。ステータスバーに FFmpeg が利用できない旨が表示され、実行ログが自動で開きます。「診断情報をコピー」で探索したパスを確認できます。

**基本の流れ**

1. Eagle で動画を 1 つ以上選択します。
2. 「動画圧縮」を開くと、選択した動画がタスクリストに自動で取り込まれます。ローカルの動画ファイルをウィンドウにドラッグすることもできます。
3. コーデックと圧縮方式を選びます。既定は H.265 + CRF 28 です。
4. 元のサイズ、推定出力サイズ、容量変化のサマリーを確認します。
5. 元ファイルを残したい場合は、先にバックアップ先フォルダーを指定してからバックアップを有効にします。
6. 「圧縮を開始」をクリックし、確認ダイアログの上書きとバックアップに関する説明を読んでから確定します。

**圧縮方式の選び方**

| 方式 | 向いている用途 | サイズの挙動 |
| --- | --- | --- |
| 画質優先（CRF） | 通常利用、安定した画質 | 最終サイズはソースの複雑さ次第。サンプルエンコードによる推定範囲を表示します |
| ビットレート指定 | 目標ビットレートが決まっている場合 | 長さ・映像ビットレート・音声設定から算出します |
| 目標ファイルサイズ | サイズ上限が厳密な場合 | H.264/H.265 は 2 パスで目標に近づけます。コンテナと音声のオーバーヘッドでわずかな差が出ます |

**ハードウェアアクセラレーションの選び方**

「ハードウェアアクセラレーション」には 3 つの選択肢があります。

| 選択肢 | 動作 |
| --- | --- |
| 自動（… を検出） | 利用可能なハードウェアエンコーダーがあれば GPU を使い、なければ CPU にフォールバックします。既定値で、検出した種別を表示します |
| GPU ハードウェアエンコードを強制 | ハードウェアエンコードのみ。利用可能なエンコーダーがない場合は失敗します |
| CPU ソフトウェアエンコードのみ | 終始ソフトウェアエンコード。結果が最も予測しやすい選択です |

- macOS では Apple VideoToolbox を使用します。NVIDIA NVENC、Intel Quick Sync Video、AMD AMF は Windows と対応する GPU が必要です。ハードウェアエンコードは所要時間と CPU 負荷を下げるためのもので、効果は素材・設定・GPU によって変わります。同一ビットレートでの画質はソフトウェアエンコードと異なる場合があるため、画質を最優先する場合は「CPU ソフトウェアエンコードのみ」を選んでください。
- VP9 にはハードウェア実装がないため、常に CPU を使用します。
- ハードウェアエンコードが失敗した場合は CPU で 1 回だけ再実行し、即座に失敗とはしません。
- 利用できるハードウェアエンコーダーが 1 つも見つからない場合、「自動」はそのままソフトウェアエンコードで実行します。これは想定どおりの動作です。

**容量変化の色**：緑は元より小さい、赤は元より大きい、通常色はほぼ変化なし、または推定範囲が元のサイズをまたいでいることを示します。

**その他**

- 圧縮中はいつでも「停止してキャンセル」できます。実行中の FFmpeg は終了され、未開始のタスクは即座にキャンセル扱いになり、元ファイルは影響を受けません。
- 圧縮中に Eagle 側で選択を変更してプラグインを開き直すと、「今回の操作を取り消す」「現在のキューを置き換える」「キューに追加する」のいずれかを尋ねます。進行中の作業を黙って破棄することはありません。
- 「タスクキューに追加」を選ぶともう一度確認します。追加した素材はすぐに圧縮が始まり元ファイルを置き換えるため、確認ダイアログに追加ファイルの一覧と今回の実際のバックアップ状態を表示します。圧縮中はバックアップ設定を変更できません。

**ファイルの置き換えについて**

- 圧縮に成功すると、元のパスにあるファイルを置き換えます。ウィンドウにドラッグしたローカルファイルも同様です。これは非可逆かつ元に戻せない操作です。
- 「完了後に Eagle ライブラリへ反映」をオフにしても、元ファイルは**やはり置き換えられます**。このオプションは上書きの有無を制御するものではなく、Eagle の置き換え API で関連アイテムを更新してサムネイルを再生成するかどうかを決めるだけです。元ファイルを残す用途には使えません。
- 元ファイルを残すには、先に「バックアップ場所を選択…」でフォルダーを指定し、「圧縮前に元ファイルをバックアップ」がオンになっていることを確認してください。フォルダー未指定のときこのチェックボックスは無効で、バックアップも行われません。
- 圧縮してもサイズが小さくならなかったファイルはスキップされ、元ファイルはそのまま残ります。
- 大切な素材は、必ず別途バックアップを取っておいてください。

**保存されるデータと削除方法**

- 本プラグインがローカルに書き込むのは 2 つのファイルだけです。設定は `~/Library/Application Support/Eagle 视频压缩/settings.json`、実行ログは `~/Library/Logs/Eagle 视频压缩/plugin.log` です。Windows ではどちらも `%APPDATA%\Eagle 视频压缩\` の下にあります。
- この 2 つのパスはプラグイン内の「実行ログ」パネル上部に表示され、そのまま確認・コピーできます。
- 上部バーの「設定をリセット」は選択内容を初期値に戻すだけで、ファイルは削除しません。
- アンインストールしてもこの 2 つのファイルは残ります。完全に消すには上記の 2 つのフォルダを手動で削除してください。
- 圧縮中の一時ファイルは元ファイルの隣に作られ、処理の終了時または次回起動時に自動で削除されるため、容量を占有し続けることはありません。

### 版本日志

#### 1.1.2

- 修正：圧縮中にキューへ追加した素材が、すぐに圧縮を始めて元ファイルを置き換えていました（表示は件数とファイル名のみ）。実行中の追加では専用の確認ダイアログを開き、追加ファイルの一覧、すぐに圧縮して元のパスのファイルを置き換えること、今回の実際のバックアップ状態を表示します。バックアップが無効なときは元に戻せない旨を明示します。
- 修正：実行前の確認に出る上書き・バックアップ・復元不可の警告が簡体字中国語のハードコードで、他の言語では表示されませんでした。現在はすべて言語リソースから取得し、8 言語すべてに翻訳があります。
- 修正：「完了後に Eagle ライブラリへ反映」をオンにしたときだけ元素材が置き換わるかのような表現でした。オンでもオフでも元のパスのファイルは置き換わります。このオプションは Eagle の置き換え API で関連アイテムとサムネイルを更新するかどうかを決めるだけです。UI とドキュメントを修正しました。
- 改善：使い方の冒頭に「使う前の準備」を追加し、FFmpeg と ffprobe の両方が必要であること、どちらも見つからない場合の挙動を明記しました。
- 修正：集計値が算出されたタイミングで「圧縮を開始」「停止してキャンセル」が左右に動いていました。ウィンドウが狭いとボタンが 2 行目に折り返される一方、右へ押し出すスペーサーは 1 行目に残るため左寄せになっていました。現在は折り返しの有無にかかわらずボタン自身が右に揃います。
- 改善：ログパネルの上部に設定ファイルとログファイルの完全なパスを表示し、使い方に「保存されるデータと削除方法」を追加して、アンインストール後に残るファイルの場所と手動削除の手順を明記しました。

#### 1.1.1

- 修正：音声トラックが複数ある素材で、圧縮後に 1 つしか残らなくなる問題。現在はすべての音声トラックがそのまま保持されます。
- 修正：圧縮後にかえってファイルサイズが大きくなる場合でも元ファイルを置き換えていた問題。現在はそのファイルをスキップし、元ファイルをそのまま残します。
- 修正：タスクのキャンセルで、途中までしか書き込まれていない壊れたファイルが残ることがある問題。現在は正常な終了を要求してから強制終了します。
- 修正：圧縮中に生成される一時ファイルが、Eagle に新しいアイテムとして自動的に取り込まれてしまう問題。
- 改善：大量の素材を一括で取り込んでも UI が固まらなくなりました。100 ファイルでは従来の約 1/144 の処理量になります。
- 改善：素材の情報を読み取る速度が約 3 倍に向上しました。25 ファイルでは 1.3 秒から 0.45 秒に短縮されます。
- 改善：VP9 エンコードがマルチスレッドの分割処理に対応し、1080p の素材で実測約 2.2 倍高速になりました。
- 改善：元ファイルの置き換えを名前の変更で行うようになり、1GB ファイルの書き込みが約 1 秒からほぼゼロになりました。
- 改善：複数のタスクを同時に圧縮する際、スレッドをマシン全体の予算内で割り当てるようにし、CPU 使用率の合計が約 6%〜9% 下がりました。
- 追加：macOS で Apple VideoToolbox によるハードウェアエンコード（H.264 / H.265）に対応しました。「自動」では検出時にこれを優先します。
- 追加：24 コア以上のマシンでは、並行数を 6 または 8 に設定できるようになりました。

#### 1.1.0

- GPU ハードウェアエンコードを追加しました。NVIDIA NVENC / Intel QSV / AMD AMF に対応し、「ハードウェアアクセラレーション」で自動・GPU 強制・CPU のみを選択できます（既定は自動、検出した GPU 名を表示）。
- 品質スケールの換算を修正しました。CRF とハードウェア QP は別の尺度なので、`-rc constqp -qp` に変換します（H.264/HEVC は +2、AV1 は ×3.2）。従来はファイルサイズが 45%〜+340% ずれていました。
- ハードウェアエンコード失敗時は CPU で 1 回だけ再実行します。VP9 はハードウェア実装がないため常に CPU を使用します。
- ハードウェアエンコード時の並行数は 2 に制限し、圧縮前のサイズ見積もりも選択したエンコーダーを反映します。
- 1080p30 の素材での実測では、H.265 が約 28 秒・約 10 コアから約 3 秒・1 コア未満になり、PSNR 差は 0.12 dB 以内です。

#### 1.0.2

- HDR ソースの判別を追加。タスクリストに HDR10 / HLG / Dolby Vision / HDR10+ の琥珀色バッジを表示します。
- 再エンコード時に色情報を引き継ぐようになり、HDR ソースが SDR として出力されることがなくなりました。
- 「圧縮済み」マーカーを追加。出力に書き込まれ、再度読み込んだときに圧縮回数と日付を表示します。設定でオフにできます。AVI と TS は任意のメタデータを保持できないため、書き込みません。
- キュー内にこのプラグインで圧縮済みのファイルがある場合、サマリーにその件数を表示します。
- 修正：HDR ソースに H.264 を選ぶと HDR 情報が黙って失われていた問題を、サマリー欄の警告として表示するようにしました。

#### 1.0.1

- 修正：H.265 の出力が macOS の Finder / クイックルック / QuickTime で再生できない問題（`hvc1` タグを付与）。
- 修正：元ファイルの置き換えをステージングファイル＋アトミックリネーム方式に変更。キャンセルや I/O エラーで元ファイルが壊れることがなくなりました。
- 修正：Eagle の選択取得 API からの同期例外がハンドラーの外に漏れていた問題。
- 修正：遅れて返る選択コールバックが、閉じたはずのダイアログを再度開いてしまう問題。
- 追加：圧縮中に表示される「停止してキャンセル」ボタン。
- 追加：新しい選択がある状態でプラグインを開き直したときの 3 択（取り消し／置き換え／追加）。
- 追加：実行中のキューへの追加。アイドル状態のワーカーが引き受けます。
- 追加：サンプル推定の進捗表示と「すべて解析」「解析を停止」の操作。
- 改善：並列数を CPU コア数・エンコーダー・2 パスの有無から算出し、エンコーダーごとのスレッド数に上限を設けました。
- 改善：一時ファイルを可能な限りソースと同じ場所に書き出し、外付け／ネットワークボリュームでの余分なフルコピーを回避します。

#### 1.0.0

- 初回リリース：一括圧縮、複数のコーデックと圧縮方式、サイズ推定、バックアップと置き換え、診断ログ。

---

## 简体中文（zh_CN）

### 简述

在 Eagle 中批量压缩视频的本地转码插件。打开插件后会自动读取当前选中的视频，也可以直接把本机视频文件拖进窗口，用 FFmpeg 重新编码，成功后替换原路径上的文件。

- 所有处理都在本机完成，不上传视频文件，也不把视频元数据发往任何服务器。
- 默认输出 H.265/HEVC，同时支持 H.264、AV1、VP9 与仅重封装。
- 三种压缩方式：画质优先（CRF）、指定码率、目标文件大小（H.264/H.265 走两遍编码）。
- CRF 模式的体积预估基于真实的分段抽样试压，界面给出的是区间而不是一个会骗人的精确值。
- 可调分辨率、帧率、音轨、编码速度、并发数与 10bit 素材的处理方式。
- 自动识别 HDR 素材并在重编码时保留色彩元数据；对已经压过的文件会打标记，避免重复有损压缩。
- 支持 GPU 硬件编码：macOS 上使用 Apple VideoToolbox，Windows 上支持 NVIDIA NVENC、Intel QSV 与 AMD AMF。默认自动选择，检测不到可用硬件时回退 CPU 软件编码。
- 备份默认关闭，必须先指定备份目录才能开启；不开备份就没有原文件副本。
- 设置持久化保存，界面跟随 Eagle 主题，支持八种语言。

### 使用说明

**使用前准备**

本插件需要可用的 FFmpeg 和 ffprobe，两者缺一不可：

- 推荐在 Eagle 中安装「FFmpeg」依赖插件，本插件会自动使用它。
- 也可以自行在系统里安装 FFmpeg（自带 ffprobe），插件会回退到本机安装的版本。
- 两者都找不到时插件无法压缩：状态栏会提示 FFmpeg 不可用，并自动展开运行日志，可点「复制诊断信息」查看具体的查找路径。

**基本流程**

1. 在 Eagle 中选中一个或多个视频。
2. 打开「视频压缩」，选中的视频会自动导入任务列表；也可以把本机视频文件拖进窗口。
3. 选择编码格式与压缩方式，默认是 H.265 + CRF 28。
4. 核对原始体积、预计输出体积和空间变化汇总。
5. 需要保留原文件时，先指定备份目录，再打开备份开关。
6. 点击「开始压缩」，阅读确认框里的覆盖与备份提示后再确认。

**压缩方式怎么选**

| 方式 | 适合 | 体积表现 |
| --- | --- | --- |
| 画质优先（CRF） | 日常使用、追求稳定画质 | 最终体积取决于素材复杂度，界面显示抽样得出的预估区间 |
| 指定码率 | 已知目标码率 | 按时长、视频码率和音频设置直接算出 |
| 目标文件大小 | 有严格体积上限 | H.264/H.265 用两遍编码逼近目标，容器和音频开销会带来少量偏差 |

**硬件加速怎么选**

「硬件加速」下拉提供三档：

| 选项 | 行为 |
| --- | --- |
| 自动（检测到 …） | 检测到可用硬件编码器时走 GPU，否则回退 CPU。默认选项，界面会回填检测到的硬件家族 |
| 强制 GPU 硬件编码 | 只走硬件编码；本机没有可用硬件编码器时会失败 |
| 仅 CPU 软件编码 | 完全走软件编码，结果最可预期 |

- macOS 上使用 Apple VideoToolbox；NVIDIA NVENC、Intel Quick Sync Video 与 AMD AMF 需要 Windows 加上对应品牌的显卡。硬件编码主要用于缩短耗时、降低 CPU 占用，实际幅度取决于素材、参数与显卡型号；同码率下的画质与软件编码可能有差异，对画质要求严格时建议选「仅 CPU 软件编码」。
- VP9 没有对应的硬件实现，固定走 CPU。
- 硬件编码失败会自动回退 CPU 重跑一次，不会直接把任务判为失败。
- 机器上没有任何可用的硬件编码器时，「自动」会直接走软件编码，属于预期行为。

**空间变化的颜色**：绿色表示压完比原文件小，红色表示比原文件大，正常颜色表示基本没变或预估区间跨过了原始体积。

**其他说明**

- 压缩过程中可以随时点「停止并取消」，正在跑的 FFmpeg 会被终止，尚未开始的任务立即标记为已取消，原文件不受影响。
- 压缩期间在 Eagle 里重新选中素材再打开插件，会询问：取消本次操作、清空当前队列换成新选中的、或者追加到队列。不会静默丢弃正在进行的工作。
- 选「加入任务队列」时会再确认一次：追加进来的素材会立即开始压缩并覆盖原文件，确认框会列出新增文件清单和本次的实际备份状态。压缩进行中无法更改备份设置。

**文件替换说明**

- 压缩成功后会替换原路径上的文件，包括拖进窗口的本地文件。这是有损且不可逆的。
- 关闭「同步回 Eagle 素材库」**仍然会**替换原文件。这个选项不控制是否覆盖，只决定要不要通过 Eagle 的素材替换接口更新关联素材、刷新缩略图，不能用来保留原件。
- 要保留原文件，必须先点「选择备份位置…」指定目录，再确认「压缩前备份原文件」已勾选。没指定目录时这个勾选框是禁用的，备份也不会发生。
- 压缩后体积没有变小的文件会被跳过，原文件保持不变。
- 重要素材请自行另留一份独立备份。

**数据保留与清理**

- 插件在本机只写两个文件：设置 `~/Library/Application Support/Eagle 视频压缩/settings.json`，运行日志 `~/Library/Logs/Eagle 视频压缩/plugin.log`。Windows 上两者都在 `%APPDATA%\Eagle 视频压缩\` 下。
- 这两个路径会显示在插件内「运行日志」面板的顶部，可以直接看到并复制。
- 顶栏的「重置设置」只把选项恢复默认，不会删除文件。
- 卸载插件不会清除这两个文件。要彻底清理，手动删除上面那两个目录即可。
- 压缩过程中的临时文件写在源文件旁边，任务结束或下次启动时自动清理，不会长期占用空间。

### 版本日志

#### 1.1.2

- 修复：压缩进行中把新素材加入队列时，它们会立即开始压缩并覆盖原文件，而提示只列了数量和文件名。现在会单独弹出确认框，列出新增文件、说明会立即压缩并替换原路径上的文件，并给出本次的实际备份状态；未开启备份时明确提示原件无法恢复。
- 修复：开始压缩前的覆盖、备份与不可恢复警告是硬编码的简体中文，其他语言界面看不到。现在全部改用语系资源，八个语系都有完整翻译。
- 修复：文案让人以为只有开启「同步回 Eagle 素材库」才会替换原素材。无论是否勾选，原路径上的文件都会被替换；该选项只决定是否通过 Eagle 的替换接口更新关联素材与缩略图。界面与文档都已改正。
- 改进：使用说明新增「使用前准备」，写明需要可用的 FFmpeg 与 ffprobe，以及两者都找不到时的表现。
- 修复：操作栏的「开始压缩」「停止并取消」会在汇总数字算出来时左右跳一下。窄窗口下按钮会折到第二行，而顶开它们的占位元素留在第一行，按钮就贴到了左边。现在按钮自己靠右，与是否换行无关。
- 改进：日志面板顶部同时显示设置文件与日志文件的完整路径，使用说明新增「数据保留与清理」，写明卸载后残留的文件位置与手动清除方式。

#### 1.1.1

- 修复：多音轨素材压缩后只剩一条音轨，现在所有音轨都会原样保留。
- 修复：压缩后体积反而变大时仍会覆盖原文件，现在会跳过并保留原件。
- 修复：取消任务可能留下损坏的半截文件，现在先请求正常退出，再强制结束。
- 修复：压缩过程中产生的临时文件会被 Eagle 当成新素材扫进素材库。
- 改进：批量导入大量素材不再卡顿，100 个文件的界面处理量降到原来的约 1/144。
- 改进：读取素材信息的速度提升约 3 倍，25 个文件从 1.3 秒缩短到 0.45 秒。
- 改进：VP9 编码启用多线程分块，1080p 素材实测提速约 2.2 倍。
- 改进：替换原文件改为直接重命名，1GB 文件的写入耗时从约 1 秒降到几乎为零。
- 改进：多任务同时压缩时按整机预算分配线程，CPU 总占用降低约 6%~9%。
- 新增：macOS 上支持 Apple VideoToolbox 硬件编码（H.264 与 H.265），「自动」检测到时会优先使用。
- 新增：24 核及以上的机器上，并发数可选到 6 或 8。

#### 1.1.0

- 新增 GPU 硬件编码：支持 NVIDIA NVENC / Intel QSV / AMD AMF，「硬件加速」下拉可选自动、强制 GPU、仅 CPU，默认自动并回填检测到的显卡名。
- 修正画质档位换算：CRF 与硬件 QP 不是同一刻度，现在按 H.264/HEVC +2、AV1 ×3.2 换算，不再出现体积偏离 45%~+340%。
- 硬件编码失败会自动回退 CPU 重跑一次；VP9 无硬件实现，固定走 CPU。
- 硬件编码时并发收敛到 2 路，压缩前的体积预估也按所选编码器给出。
- 实测 1080p30 素材，H.265 从约 28 秒、约 10 核占用降到约 3 秒、不足 1 核，画质差距在 0.12 dB 以内。

#### 1.0.2

- 新增 HDR 素材识别，在任务列表中用琥珀色角标标注 HDR10 / HLG / Dolby Vision / HDR10+。
- 重编码时携带色彩元数据，HDR 素材不再被错误输出成 SDR。
- 新增「已压缩」标记：压缩后写入文件，再次导入时显示压缩次数与日期，可在设置中关闭。AVI 与 TS 容器无法存储自定义元数据，这两种格式不写标记。
- 队列中存在已压缩文件时，汇总栏给出提示。
- 修复：对 HDR 素材选用 H.264 会不可逆地丢失 HDR 信息，现在会在汇总栏给出警告。

#### 1.0.1

- 修复：H.265 输出在 macOS 访达 / 快速查看 / QuickTime 中无法播放（改用 `hvc1` 标记）。
- 修复：替换原文件改为暂存文件加原子重命名，取消或 I/O 出错都不会留下损坏的原素材。
- 修复：读取 Eagle 选中素材时的同步异常会逃逸出处理逻辑。
- 修复：迟到的选中素材回调会重新弹开已经被关掉的对话框。
- 新增：压缩过程中可见的「停止并取消」按钮。
- 新增：重新打开插件且有新选中素材时，提供取消 / 替换 / 追加三选项。
- 新增：压缩进行中也能把新素材追加进队列，由空闲的工作线程接手。
- 新增：抽样预估的进度显示，以及「分析全部」「停止分析」控制。
- 改进：并发数按 CPU 核心、编码器和是否两遍编码推导，并限制单个编码器的线程数。
- 改进：临时文件优先写在源文件旁边，避免外置盘或网络盘上多一次全量拷贝。

#### 1.0.0

- 首个发布版本：批量压缩、多种编码格式与压缩方式、体积预估、备份与替换、日志诊断。

---

## 繁體中文（zh_TW）

### 简述

在 Eagle 中批次壓縮影片的本機轉檔外掛。開啟後會自動讀取目前選取的影片，也可以直接把本機影片檔案拖進視窗，以 FFmpeg 重新編碼，成功後取代原路徑上的檔案。

- 所有處理都在本機完成，不會上傳影片檔案，也不會把影片中繼資料送往任何伺服器。
- 預設輸出 H.265/HEVC，同時支援 H.264、AV1、VP9 與僅重新封裝。
- 三種壓縮方式：畫質優先（CRF）、指定位元率、目標檔案大小（H.264/H.265 採兩階段編碼）。
- CRF 模式的體積預估以實際的分段取樣試壓為準，介面顯示的是區間而非會誤導人的精確值。
- 可調整解析度、影格率、音軌、編碼速度、並行數以及 10bit 素材的處理方式。
- 自動辨識 HDR 素材並在重新編碼時保留色彩中繼資料；對已壓縮過的檔案會寫入標記，避免重複有損壓縮。
- 支援 GPU 硬體編碼：macOS 上使用 Apple VideoToolbox，Windows 上支援 NVIDIA NVENC、Intel QSV 與 AMD AMF。預設自動選擇，偵測不到可用硬體時回退 CPU 軟體編碼。
- 備份預設關閉，必須先指定備份資料夾才能啟用；不開備份就沒有原檔副本。
- 設定會持久保存，介面跟隨 Eagle 佈景主題，支援八種語言。

### 使用说明

**使用前準備**

本外掛需要可用的 FFmpeg 與 ffprobe，兩者缺一不可：

- 建議在 Eagle 中安裝「FFmpeg」相依套件，本外掛會自動使用它。
- 也可以自行在系統中安裝 FFmpeg（內含 ffprobe），外掛會改用本機安裝的版本。
- 兩者都找不到時外掛無法壓縮：狀態列會提示 FFmpeg 不可用，並自動展開執行日誌，可點「複製診斷資訊」查看實際的搜尋路徑。

**基本流程**

1. 在 Eagle 中選取一個或多個影片。
2. 開啟「影片壓縮」，選取的影片會自動匯入工作清單；也可以把本機影片檔案拖進視窗。
3. 選擇編碼格式與壓縮方式，預設為 H.265 + CRF 28。
4. 核對原始體積、預估輸出體積與空間變化摘要。
5. 需要保留原檔時，先指定備份資料夾，再開啟備份開關。
6. 點擊「開始壓縮」，閱讀確認視窗中的覆寫與備份提示後再確認。

**壓縮方式怎麼選**

| 方式 | 適合 | 體積表現 |
| --- | --- | --- |
| 畫質優先（CRF） | 日常使用、追求穩定畫質 | 最終體積取決於素材複雜度，介面顯示取樣得出的預估區間 |
| 指定位元率 | 已知目標位元率 | 依時長、影片位元率與音訊設定直接計算 |
| 目標檔案大小 | 有嚴格體積上限 | H.264/H.265 採兩階段編碼逼近目標，容器與音訊額外開銷會造成少量偏差 |

**硬體加速怎麼選**

「硬體加速」下拉提供三種選項：

| 選項 | 行為 |
| --- | --- |
| 自動（偵測到 …） | 偵測到可用硬體編碼器時走 GPU，否則回退 CPU。預設選項，介面會回填偵測到的硬體家族 |
| 強制 GPU 硬體編碼 | 只走硬體編碼；本機沒有可用硬體編碼器時會失敗 |
| 僅 CPU 軟體編碼 | 完全走軟體編碼，結果最可預期 |

- macOS 上使用 Apple VideoToolbox；NVIDIA NVENC、Intel Quick Sync Video 與 AMD AMF 需要 Windows 加上對應品牌的顯示卡。硬體編碼主要用於縮短耗時、降低 CPU 佔用，實際幅度取決於素材、參數與顯示卡型號；同位元率下的畫質與軟體編碼可能有差異，對畫質要求嚴格時建議選「僅 CPU 軟體編碼」。
- VP9 沒有對應的硬體實作，固定走 CPU。
- 硬體編碼失敗會自動回退 CPU 重跑一次，不會直接把工作判為失敗。
- 機器上沒有任何可用的硬體編碼器時，「自動」會直接走軟體編碼，屬於預期行為。

**空間變化的顏色**：綠色表示壓縮後比原檔小，紅色表示比原檔大，一般顏色表示幾乎沒變或預估區間跨過原始體積。

**其他說明**

- 壓縮過程中可隨時點「停止並取消」，執行中的 FFmpeg 會被終止，尚未開始的工作立即標記為已取消，原檔不受影響。
- 壓縮期間在 Eagle 中重新選取素材再開啟外掛，會詢問：取消這次操作、清空目前佇列改用新選取的、或是追加到佇列。不會靜默丟棄進行中的工作。
- 選「加入任務佇列」時會再確認一次：追加進來的素材會立即開始壓縮並覆寫原檔，確認視窗會列出新增檔案清單與這次的實際備份狀態。壓縮進行中無法變更備份設定。

**檔案取代說明**

- 壓縮成功後會取代原路徑上的檔案，包含拖進視窗的本機檔案。這是有損且不可逆的。
- 關閉「同步回 Eagle 素材庫」**仍然會**取代原檔。這個選項不控制是否覆寫，只決定要不要透過 Eagle 的素材取代介面更新關聯素材、重新整理縮圖，不能用來保留原件。
- 要保留原檔，必須先點「選擇備份位置…」指定資料夾，再確認「壓縮前備份原始檔案」已勾選。沒指定資料夾時這個核取方塊是停用的，備份也不會發生。
- 壓縮後體積沒有變小的檔案會被跳過，原檔保持不變。
- 重要素材請自行另外保留一份獨立備份。

**資料保留與清理**

- 外掛在本機只寫兩個檔案：設定 `~/Library/Application Support/Eagle 视频压缩/settings.json`，執行記錄 `~/Library/Logs/Eagle 视频压缩/plugin.log`。Windows 上兩者都在 `%APPDATA%\Eagle 视频压缩\` 之下。
- 這兩個路徑會顯示在外掛內「執行記錄」面板的頂部，可以直接看到並複製。
- 頂列的「重置設定」只會把選項還原成預設值，不會刪除檔案。
- 解除安裝不會清除這兩個檔案。要徹底清理，手動刪除上述兩個目錄即可。
- 壓縮過程中的暫存檔寫在來源檔案旁邊，工作結束或下次啟動時自動清理，不會長期佔用空間。

### 版本日志

#### 1.1.2

- 修正：壓縮進行中將新素材加入佇列時，它們會立即開始壓縮並覆蓋原檔案，而提示只列出數量與檔案名稱。現在會單獨彈出確認視窗，列出新增檔案、說明會立即壓縮並取代原路徑上的檔案，並給出本次的實際備份狀態；未開啟備份時明確提示原檔無法復原。
- 修正：開始壓縮前的覆蓋、備份與無法復原警告是寫死的簡體中文，其他語言介面看不到。現在全部改用語系資源，八個語系都有完整翻譯。
- 修正：文案讓人以為只有開啟「同步回 Eagle 素材庫」才會取代原素材。無論是否勾選，原路徑上的檔案都會被取代；該選項只決定是否透過 Eagle 的取代介面更新關聯素材與縮圖。介面與文件都已修正。
- 改進：使用說明新增「使用前準備」，寫明需要可用的 FFmpeg 與 ffprobe，以及兩者都找不到時的行為。
- 修正：操作列的「開始壓縮」「停止並取消」會在彙總數字算出來時左右跳一下。視窗較窄時按鈕會折到第二行，而頂開它們的佔位元素留在第一行，按鈕就貼到了左邊。現在按鈕自己靠右，與是否換行無關。
- 改進：記錄面板頂部同時顯示設定檔與記錄檔的完整路徑，使用說明新增「資料保留與清理」，寫明解除安裝後殘留的檔案位置與手動清除方式。

#### 1.1.1

- 修復：多音軌素材壓縮後只剩一條音軌，現在所有音軌都會原樣保留。
- 修復：壓縮後體積反而變大時仍會覆蓋原檔，現在會跳過並保留原件。
- 修復：取消任務可能留下損壞的半截檔案，現在先請求正常結束，再強制終止。
- 修復：壓縮過程中產生的暫存檔會被 Eagle 當成新素材掃進素材庫。
- 改進：批次匯入大量素材不再卡頓，100 個檔案的介面處理量降到原來的約 1/144。
- 改進：讀取素材資訊的速度提升約 3 倍，25 個檔案從 1.3 秒縮短到 0.45 秒。
- 改進：VP9 編碼啟用多執行緒分塊，1080p 素材實測提速約 2.2 倍。
- 改進：替換原檔改為直接重新命名，1GB 檔案的寫入耗時從約 1 秒降到幾乎為零。
- 改進：多任務同時壓縮時按整機預算分配執行緒，CPU 總佔用降低約 6%~9%。
- 新增：macOS 上支援 Apple VideoToolbox 硬體編碼（H.264 與 H.265），「自動」偵測到時會優先使用。
- 新增：24 核心及以上的機器上，並行數可選到 6 或 8。

#### 1.1.0

- 新增 GPU 硬體編碼：支援 NVIDIA NVENC / Intel QSV / AMD AMF，「硬體加速」下拉可選自動、強制 GPU、僅 CPU，預設自動並回填偵測到的顯示卡名稱。
- 修正畫質檔位換算：CRF 與硬體 QP 不是同一刻度，現在按 H.264/HEVC +2、AV1 ×3.2 換算，不再出現體積偏離 45%~+340%。
- 硬體編碼失敗會自動退回 CPU 重跑一次；VP9 無硬體實作，固定走 CPU。
- 硬體編碼時併發收斂到 2 路，壓縮前的體積預估也按所選編碼器給出。
- 實測 1080p30 素材，H.265 從約 28 秒、約 10 核佔用降到約 3 秒、不足 1 核，畫質差距在 0.12 dB 以內。

#### 1.0.2

- 新增 HDR 素材辨識，在工作清單中以琥珀色標籤標註 HDR10 / HLG / Dolby Vision / HDR10+。
- 重新編碼時帶上色彩中繼資料，HDR 素材不再被錯誤輸出成 SDR。
- 新增「已壓縮」標記：壓縮後寫入檔案，再次匯入時顯示壓縮次數與日期，可於設定中關閉。AVI 與 TS 容器無法儲存自訂中繼資料，這兩種格式不寫入標記。
- 佇列中存在已壓縮檔案時，摘要列會提出提示。
- 修正：對 HDR 素材選用 H.264 會不可逆地失去 HDR 資訊，現在會在摘要列提出警告。

#### 1.0.1

- 修正：H.265 輸出在 macOS 訪達 / 快速查看 / QuickTime 中無法播放（改用 `hvc1` 標記）。
- 修正：取代原檔改為暫存檔加上原子重新命名，取消或 I/O 錯誤都不會留下損毀的原素材。
- 修正：讀取 Eagle 選取素材時的同步例外會逸出處理邏輯。
- 修正：延遲返回的選取回呼會重新開啟已被關閉的對話框。
- 新增：壓縮過程中可見的「停止並取消」按鈕。
- 新增：重新開啟外掛且有新選取素材時，提供取消 / 取代 / 追加三種選擇。
- 新增：壓縮進行中也能將新素材追加至佇列，由閒置的工作執行緒接手。
- 新增：取樣預估的進度顯示，以及「分析全部」「停止分析」控制項。
- 改進：並行數依 CPU 核心、編碼器與是否兩階段編碼推導，並限制單一編碼器的執行緒數。
- 改進：暫存檔優先寫在來源檔旁邊，避免外接硬碟或網路磁碟上多一次完整複製。

#### 1.0.0

- 首個發行版本：批次壓縮、多種編碼格式與壓縮方式、體積預估、備份與取代、日誌診斷。
