# Video Compress for Eagle

<!-- section:overview -->
## Overview

A local batch video compression plugin for Eagle. It picks up the videos you have selected, re-encodes them with FFmpeg, and can replace the original Eagle item once compression succeeds.

- Everything runs locally. Video files are never uploaded and no video metadata is sent to any server.
- H.265/HEVC by default, with H.264, AV1, VP9, and remux-only options.
- Three compression modes: quality first (CRF), target bitrate, and target file size (two-pass for H.264/H.265).
- CRF size estimates come from real stratified sample encodes, so the UI shows a range instead of a misleading exact number.
- Controls for resolution, frame rate, audio, encoding speed, concurrency, and 10-bit source handling.
- HDR sources are detected and their colour metadata is carried through re-encoding; already-compressed files are marked so you do not run a second lossy pass by accident.
- Backup is off by default and cannot be enabled until you pick a backup folder.
- Settings persist, the UI follows Eagle's theme, and eight languages are available.

<!-- section:usage -->
## How to use

**Requirements**: Eagle with the FFmpeg dependency available. A local FFmpeg/FFprobe installation is used as a fallback. macOS is the currently verified platform.

**Basic workflow**

1. Select one or more videos in Eagle.
2. Open **Video Compress**. The selected videos are imported into the task list automatically.
3. Choose a codec and a compression mode. H.265 with CRF 28 is the default.
4. Review the original size, estimated output size, and storage-change summary.
5. If you want to keep the original file, choose a backup folder first, then enable backup.
6. Click **Start compression** and confirm.

**Choosing a compression mode**

| Mode | Best for | Size behaviour |
| --- | --- | --- |
| Quality first (CRF) | General use, consistent visual quality | Final size depends on source complexity; the UI shows an estimated range from sample encodes |
| Target bitrate | A known delivery bitrate | Calculated from duration, video bitrate, and audio settings |
| Target file size | A strict size budget | H.264/H.265 use two-pass encoding; container and audio overhead can still cause a small difference |

**Storage-change colours**: green means the result is smaller than the original, red means larger, and the normal text colour means it is nearly unchanged or the estimate range crosses the original size.

**Other notes**

- You can click **Stop and cancel** at any time. Running FFmpeg processes are terminated, tasks that have not started are marked cancelled immediately, and originals are left untouched.
- If you change the Eagle selection and reopen the plugin mid-run, it asks whether to cancel the action, replace the current queue, or append to it. Work in progress is never discarded silently.
- Replacing the original file is lossy and irreversible. Keep an independent copy of irreplaceable media.

<!-- section:changelog -->
## Changelog

### 1.1.0

- Added GPU hardware encoding for NVIDIA NVENC, Intel Quick Sync, and AMD AMF. The new **Hardware acceleration** dropdown offers automatic, force GPU, or CPU only, and reports which family it detected.
- Fixed quality-scale conversion: CRF and hardware QP are different scales, so values are now converted to `-rc constqp -qp` (+2 for H.264/HEVC, ×3.2 for AV1) instead of producing files 45% to 340% off target.
- A failed hardware encode is retried once on the CPU rather than failing outright. VP9 has no hardware implementation and always uses the CPU.
- Concurrency is capped at two for hardware encoding, and the pre-compression size estimate now reflects the selected encoder.
- On 1080p30 test footage, H.265 went from roughly 28 seconds at about ten cores to roughly 3 seconds at under one core, within 0.12 dB PSNR.

### 1.0.2

- Added HDR detection, with an amber badge in the task list for HDR10 / HLG / Dolby Vision / HDR10+.
- Colour metadata is now carried through re-encoding, so an HDR source no longer comes out flagged as SDR.
- Added an "already compressed" marker written into the output. Reloading such a file shows how many times and on which date it was compressed. It can be turned off in settings. AVI and TS cannot store arbitrary metadata, so nothing is written for them.
- The summary now reports how many files in the queue have already been compressed by this plugin.
- Fixed: choosing H.264 for an HDR source silently destroyed the HDR information; this is now surfaced as a warning in the summary.

### 1.0.1

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

### 1.0.0

- First release: batch compression, multiple codecs and compression modes, size estimation, backup and replacement, and diagnostic logging.
