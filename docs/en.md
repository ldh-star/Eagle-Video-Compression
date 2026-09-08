# Video Compress for Eagle

<!-- section:overview -->
## Overview

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

<!-- section:usage -->
## How to use

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

<!-- section:changelog -->
## Changelog

### 1.1.2

- Fixed: items appended to a running queue started compressing and replaced their originals immediately, while the prompt showed only a count and file names. Appending during a run now opens its own confirmation that lists the new files, states they will be compressed at once and replace the files at their original paths, and reports this run's actual backup state — with an explicit warning when the originals cannot be recovered.
- Fixed: the overwrite, backup and unrecoverable warnings shown before a run were hard-coded Simplified Chinese and invisible in every other language. They now come from the locale files, with full translations for all eight languages.
- Fixed: the wording implied the original was only replaced when "Sync back to the Eagle library" was on. The file at the original path is replaced either way; that option only decides whether Eagle's replace API updates the linked item and its thumbnail. The interface and the docs have been corrected.
- Improved: the usage section now opens with a "before you start" block stating that a working FFmpeg and ffprobe are both required, and what happens when neither is found.
- Fixed: the "Start compression" and "Stop and cancel" buttons jumped sideways once the summary figures were calculated. In a narrow window the buttons wrapped to a second row while the spacer that pushed them right stayed on the first, leaving them flush left. They now align right on their own, wrapped or not.
- Improved: the log panel now shows the full path of both the settings file and the log file, and the usage section gained a "Data the plugin keeps" block stating what is left behind after uninstalling and how to remove it.

### 1.1.1

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
