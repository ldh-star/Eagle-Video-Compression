# Video Compress for Eagle

[中文文档](README.zh-CN.md)

A local batch video compression plugin for [Eagle](https://eagle.cool/). It loads selected Eagle video items automatically, encodes them with FFmpeg, and can optionally replace the original Eagle item after compression.

> Videos are processed locally. This plugin does not upload video files or send video metadata to a remote service.

## Features

- **Batch compression** for selected Eagle video items or local files dropped into the plugin window.
- **H.265 / HEVC by default**, with H.264, AV1, VP9, and remux-only options.
- Three compression modes:
  - **Quality first (CRF)** for a consistent visual-quality target.
  - **Target bitrate** for predictable bitrate control.
  - **Target file size** using two-pass encoding for H.264 and H.265.
- **CRF size estimation** based on actual stratified sample encodes. The UI shows a range rather than a misleading exact size.
- Resolution, frame-rate, audio, speed, concurrency, and 10-bit source handling controls.
- Optional backup workflow: backup is disabled until you explicitly choose a backup folder.
- Optional Eagle replacement: after successful compression, the plugin can replace the original file and refresh its thumbnail.
- Persistent settings, reset-to-defaults, Eagle-theme following, and localized UI.
- Built-in diagnostics for failures; the log UI remains hidden during normal use.

## Requirements

- Eagle with the FFmpeg dependency available.
- A local FFmpeg/FFprobe installation is used as a fallback if Eagle's dependency module is unavailable.
- macOS is the currently verified platform. The manifest declares cross-platform support, but Windows still needs real-device validation before it is claimed as fully verified.

## Installation

### Install a packaged release

1. Download the `.eagleplugin` release file.
2. Open it with Eagle, or install it from Eagle's plugin panel.
3. Restart Eagle if it is already running so that the new plugin code is reloaded.

### Install from source for development

1. Clone this repository.
2. In Eagle, open the plugin panel and load the plugin directory that contains `manifest.json`.
3. Restart Eagle after source changes, or rerun the plugin from the plugin panel.

For the repository's local macOS development workflow, run:

```bash
./sync-to-eagle.sh
```

The script checks JavaScript syntax and synchronizes the plugin into Eagle's local plugin directory. It is a development helper and is not included in production packaging.

## Usage

1. Select one or more videos in Eagle.
2. Open **Video Compress**. The selected videos are imported automatically.
3. Choose a codec and compression mode. H.265 with CRF 28 is the default configuration.
4. Review the original size, estimated output size, and storage-change summary.
5. If you need a copy of the original file, choose a backup folder first, then enable backup.
6. Click **Start compression** and confirm the operation.

### Compression modes

| Mode | Best for | Size behavior |
| --- | --- | --- |
| Quality first (CRF) | General use and stable visual quality | The final size depends on source complexity. The plugin runs short sample encodes and displays an estimate range. |
| Target bitrate | A known delivery bitrate | Output size is calculated from duration, video bitrate, and audio settings. |
| Target file size | A strict size budget | H.264 and H.265 use two-pass encoding to get close to the target; container and audio overhead can still cause a small difference. |

### Storage-change colors

- **Green**: the processed or estimated size is strictly smaller than the original.
- **Red**: the processed or estimated size is strictly larger than the original.
- **Normal text color**: size is nearly unchanged, or an estimate range crosses the original size.

## Safety and privacy

- Video processing happens locally through FFmpeg.
- The plugin reads the selected source videos and writes encoded output to local temporary files before replacement.
- Replacing the original Eagle item happens only after you start and confirm compression.
- Backups are off by default. Selecting a backup directory is required before backup can be enabled.
- The plugin stores settings and diagnostic logs locally. It does not make network requests.

Always keep an independent copy of irreplaceable media. Like any transcoding workflow, compression is destructive when you choose to replace the original file.

## Localization

The UI uses Eagle's built-in i18next integration. Currently included locales are:

- `de_DE` — Deutsch
- `en` — English
- `es_ES` — Español
- `ja_JP` — 日本語
- `ko_KR` — 한국어
- `ru_RU` — Русский
- `zh_CN` — 简体中文 (fallback)
- `zh_TW` — 繁體中文

Locale files are located in [`_locales/`](_locales). Keep the same key structure in every locale file when adding or changing copy.

## Development and verification

The core encoding code is deliberately separated from Eagle UI orchestration so it can be tested in Node.js and jsdom.

The local verification suite covers, among other things:

- FFmpeg probing and encoding-plan generation
- source replacement, backup, cancellation, and temporary-file cleanup
- Eagle API fallbacks and nodeIntegration behavior
- UI interaction, settings persistence, CRF sampling estimates, and localization
- FFmpeg compatibility across the Eagle-provided and local FFmpeg versions

The regression tests kept in this repository run on Node.js 22 or newer with jsdom:

```bash
NODE=/Users/hongliang/.workbuddy/binaries/node/versions/22.12.0/bin/node
cd /Users/hongliang/StudioProjects/Mine/视频压缩

$NODE tests/test_hevc_apple_compat.js   # HEVC / Apple container compatibility
$NODE tests/test_queue_intake.js        # cancellation, queue intake, atomic commit
```

## Project structure

```text
├── manifest.json        # Eagle plugin manifest and locale declaration
├── index.html           # Plugin window markup
├── css/style.css        # Theme-aware UI styles
├── tests/               # Node.js + jsdom regression tests
├── js/
│   ├── app.js           # UI, task queue, settings, and Eagle orchestration
│   ├── ffmpeg.js        # FFmpeg probing, plans, execution, and sampling estimates
│   ├── format.js        # Presentation and size-format helpers
│   ├── i18n.js          # Safe adapter for Eagle's built-in i18next
│   ├── logger.js        # Local diagnostic logging
│   └── plugin.js        # Eagle lifecycle integration
└── _locales/            # Localized strings
```

## Changelog

### 1.0.2

**Added**

- **HDR detection.** Video sources are now probed for HDR and labelled in the task list with an amber badge: `HDR10`, `HLG`, `Dolby Vision`, `HDR10+`, or a generic `HDR` when only BT.2020 colour space plus 10-bit depth is available. Detection is driven by colour transfer characteristics (`smpte2084` for PQ/HDR10, `arib-std-b67` for HLG) and by Dolby Vision / SMPTE 2094-40 side data.
  - A fallback rule covers HLG files whose container carries no `color_transfer` at all — BT.2020 colour space at 10-bit or deeper is treated as HDR, because otherwise those files were silently missed.
- **Colour metadata is carried through re-encoding.** HDR sources are re-encoded with `-color_trc`, `-color_primaries`, and `-colorspace`, so the tone-mapping information survives. Without it, an HDR10 source could come out flagged as SDR.
- **A "compressed by this plugin" marker.** After encoding, a machine-readable tag is written into the output file. The next time that file is loaded, the task list shows it as already compressed, including how many times and on which date. This makes it possible to tell at a glance which sources have already been through a lossy pass.
  - The marker is recorded as `EagleVideoCompress` metadata. MP4, MOV, and M4V require `-movflags +use_metadata_tags`, because their muxers otherwise drop unrecognised metadata keys silently — the encode exits successfully, the file plays, and the marker is simply gone. MKV and WebM store it natively, but upper-case the key, so lookups are case-insensitive.
  - **AVI and TS cannot store arbitrary metadata at all.** Rather than pretend otherwise, the plugin writes nothing for those containers and says so in the settings hint.
  - Marker writing is on by default and can be turned off under **Write an "already compressed" marker after compressing**. When disabled, the plugin does not touch file metadata.
- **A summary notice for re-compression.** When the current queue contains files that this plugin has already compressed, a notice states how many and warns that compressing again degrades quality further.

**Fixed**

- **HDR sources could be silently destroyed by an H.264 encode.** The H.264 preset has no 10-bit path, so choosing it for an HDR source forces an 8-bit conversion and the HDR information is lost irreversibly, with no visible sign that anything was wrong. This is now surfaced as a warning in the summary notice. The warning does not block the encode or change settings automatically — the choice is left to you.

### 1.0.1

**Fixed**

- **H.265 output could not be played or previewed by macOS.** FFmpeg writes HEVC into MP4/MOV with the `hev1` sample entry by default, leaving VPS/SPS/PPS inside the bitstream. FFmpeg-based players (including Eagle) parse those fine, but Apple's decoding stack requires `hvc1`, where parameter sets live in the container description. The symptom was exactly what users reported: the file plays in Eagle but Finder, Quick Look, and QuickTime cannot open it. Outputs for `.mp4`, `.mov`, and `.m4v` now carry `-tag:v hvc1`.
  - The tag is applied only to genuine HEVC streams. In remux/copy mode, the target encoder is `copy`, so the real format is read back from the probed source codec — tagging an H.264 stream as `hvc1` makes the MP4 muxer fail while writing the header and destroys the whole task.
  - Already-compressed `hev1` files do not need re-encoding. Remux them losslessly: `ffmpeg -i broken.mp4 -map 0 -c copy -tag:v hvc1 fixed.mp4`.
- **Replacing the original file was not crash-safe.** The encoded output was copied directly over the source path, so a failure partway through could leave a truncated or partially overwritten original. The commit now writes a staging file next to the destination and swaps it in with an atomic rename; cancellation and I/O errors leave the original untouched.
- **A synchronous throw from `eagle.item.getSelected()` escaped its handler.** The call is now wrapped so that synchronous failures and asynchronous rejections share one catch path.
- **Stale selection callbacks could reopen a dismissed dialog.** Eagle may fire `onPluginRun` / `onPluginShow` in quick succession. Late-returning reads are now discarded by a monotonically increasing version, so the dialog does not reappear after the user dismissed it.

**Added**

- **A visible "Stop and cancel" control during compression.** It tells FFmpeg to terminate the encode in progress, immediately marks not-yet-started tasks cancelled, and then waits for child processes to exit and temporary files to be cleaned up before the UI settles.
- **A three-way choice when the plugin is reopened with new Eagle items selected.** Previously the window reopened but new items could not be added to a non-empty list. Now the plugin asks: cancel this action (keep the current queue), cancel all current tasks and load the new selection, or append the new items to the queue. It never silently discards work in progress.
- **Appending to a running queue.** New items added mid-compression are probed and then picked up by idle workers in the current run instead of waiting for the next one.
- **Sample-estimate controls.** Batch imports only sample a few items by default; the UI now shows sampling progress with "Analyze all" and "Stop analysis" controls.

**Improved**

- Concurrency is now a resource budget rather than a raw process count. Worker count is derived from CPU cores, encoder, and two-pass mode, and each encoder receives an explicit thread cap, so several multi-threaded FFmpeg processes no longer contend for every core.
- Temporary output is written next to the source when that directory is writable, avoiding an extra full-size copy when the source lives on an external or network volume. Falls back to the system temp directory when it is not.
- FFmpeg `stderr` is capped at a 64 KB tail instead of accumulating indefinitely across long multi-worker runs.
- Progress rendering is throttled to 120 ms and reuses cached task-row nodes instead of re-querying the DOM on every progress event.

## Contributing

Issues and pull requests are welcome. For behavioral changes, please keep the UI copy, locale keys, and relevant regression coverage in sync. Do not add third-party tracking, network uploads, or destructive file behavior without an explicit user-facing disclosure.

## License

This project is licensed under the [Apache License 2.0](LICENSE).
