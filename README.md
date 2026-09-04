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

Run the main checks with Node.js 22 or newer:

```bash
NODE=/Users/hongliang/.workbuddy/binaries/node/versions/22.12.0/bin/node
cd /Users/hongliang/.workbuddy/skills/eagle-plugin-local-e2e/scripts
$NODE test_settings_and_ux.js
$NODE test_nodeintegration.js
$NODE test_ui.js
```

See the project test skill and test scripts for the complete suite used during development.

## Project structure

```text
├── manifest.json        # Eagle plugin manifest and locale declaration
├── index.html           # Plugin window markup
├── css/style.css        # Theme-aware UI styles
├── js/
│   ├── app.js           # UI, task queue, settings, and Eagle orchestration
│   ├── ffmpeg.js        # FFmpeg probing, plans, execution, and sampling estimates
│   ├── format.js        # Presentation and size-format helpers
│   ├── i18n.js          # Safe adapter for Eagle's built-in i18next
│   ├── logger.js        # Local diagnostic logging
│   └── plugin.js        # Eagle lifecycle integration
└── _locales/            # Localized strings
```

## Contributing

Issues and pull requests are welcome. For behavioral changes, please keep the UI copy, locale keys, and relevant regression coverage in sync. Do not add third-party tracking, network uploads, or destructive file behavior without an explicit user-facing disclosure.

## License

This project is licensed under the [Apache License 2.0](LICENSE).
