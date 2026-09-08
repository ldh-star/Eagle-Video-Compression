# 视频压缩 · 各语言提交文案

> 由 `docs/<语系>.md` 自动生成，对应版本 **1.1.2**。
> 每个语系三节：简述 / 使用说明 / 版本日志，可直接复制到 Eagle 插件中心对应语系的字段。
> 内容改动请改 `docs/` 下的源文件后重跑 `node tools/gen-submission.js`，不要直接改本文件。

---

## Deutsch（de_DE）

### 简述

Ein lokales Plugin für die Stapelkomprimierung von Videos in Eagle. Es lädt die aktuell ausgewählten Videos automatisch (lokale Videodateien lassen sich auch per Drag-and-drop ins Fenster ziehen), kodiert sie mit FFmpeg neu und ersetzt nach erfolgreicher Komprimierung die Datei im ursprünglichen Pfad.

- Die gesamte Verarbeitung erfolgt lokal. Es werden weder Videodateien hochgeladen noch Metadaten an einen Server gesendet.
- Standardausgabe ist H.265/HEVC; H.264, AV1, VP9 und reines Remuxen stehen ebenfalls zur Verfügung.
- Drei Komprimierungsmodi: Qualität zuerst (CRF), Zielbitrate und Zieldateigröße (H.264/H.265 mit Two-Pass-Kodierung).
- Die Größenschätzung im CRF-Modus beruht auf echten Stichproben-Kodierungen. Angezeigt wird deshalb ein Bereich statt eines irreführenden exakten Werts.
- Einstellbar sind Auflösung, Bildrate, Audio, Kodiergeschwindigkeit, Parallelität und der Umgang mit 10-Bit-Quellen.
- HDR-Quellen werden erkannt, und die Farbmetadaten bleiben beim Neukodieren erhalten. Bereits komprimierte Dateien werden markiert, damit kein zweiter verlustbehafteter Durchgang aus Versehen passiert.
- Optionale GPU-Hardwarekodierung (NVIDIA NVENC, Intel Quick Sync, AMD AMF), die bei vorhandener geeigneter Hardware automatisch genutzt wird und sonst auf die CPU-Softwarekodierung zurückfällt.
- Die Sicherung ist standardmäßig deaktiviert und lässt sich erst nach Auswahl eines Sicherungsordners einschalten. Bleibt sie aus, existiert keine Kopie der Originaldatei.
- Einstellungen bleiben erhalten, die Oberfläche folgt dem Eagle-Design, acht Sprachen werden unterstützt.

### 使用说明

**Vor der ersten Nutzung**

Das Plugin benötigt **sowohl** ein funktionierendes FFmpeg als auch ffprobe.

- Empfohlen: Installieren Sie in Eagle das Abhängigkeits-Plugin „FFmpeg“. Das Plugin nutzt es automatisch.
- Alternativ können Sie FFmpeg (inklusive ffprobe) selbst systemweit installieren; das Plugin greift dann auf diese Installation zurück.
- Wird keines von beiden gefunden, ist keine Komprimierung möglich: Die Statusleiste meldet, dass FFmpeg nicht verfügbar ist, das Protokoll klappt automatisch auf, und über „Diagnose kopieren“ sehen Sie die durchsuchten Pfade.

Verifizierte Plattform ist derzeit macOS.

**Grundlegender Ablauf**

1. Wählen Sie in Eagle ein oder mehrere Videos aus.
2. Öffnen Sie **Video komprimieren**. Die ausgewählten Videos werden automatisch in die Aufgabenliste übernommen. Sie können lokale Videodateien auch ins Fenster ziehen.
3. Wählen Sie Codec und Komprimierungsmodus. Voreinstellung ist H.265 mit CRF 28.
4. Prüfen Sie Originalgröße, geschätzte Ausgabegröße und die Zusammenfassung der Speicheränderung.
5. Wenn Sie die Originaldatei behalten möchten, wählen Sie zuerst einen Sicherungsordner und aktivieren Sie dann die Sicherung.
6. Klicken Sie auf **Komprimierung starten** und bestätigen Sie, nachdem Sie die Hinweise zu Überschreiben und Sicherung im Bestätigungsdialog gelesen haben.

**Welchen Modus wählen?**

| Modus | Geeignet für | Verhalten der Dateigröße |
| --- | --- | --- |
| Qualität zuerst (CRF) | Allgemeine Nutzung, gleichbleibende Bildqualität | Die Endgröße hängt von der Komplexität der Quelle ab; angezeigt wird ein geschätzter Bereich aus Stichproben-Kodierungen |
| Zielbitrate | Bekannte Zielbitrate | Wird aus Dauer, Videobitrate und Audioeinstellungen berechnet |
| Zieldateigröße | Striktes Größenbudget | H.264/H.265 nähern sich per Two-Pass an; Container- und Audio-Overhead können eine kleine Abweichung verursachen |

**Hardwarebeschleunigung wählen**

Die Auswahl „Hardwarebeschleunigung“ bietet drei Optionen:

| Option | Verhalten |
| --- | --- |
| Automatisch (… erkannt) | Nutzt die GPU, wenn ein brauchbarer Hardware-Encoder vorhanden ist, sonst die CPU. Dies ist die Voreinstellung; die erkannte Familie wird angezeigt |
| GPU-Hardwarekodierung erzwingen | Ausschließlich Hardwarekodierung; schlägt fehl, wenn kein brauchbarer Hardware-Encoder vorhanden ist |
| Nur CPU-Softwarekodierung | Durchgehend Softwarekodierung, das am besten vorhersehbare Ergebnis |

- Unterstützt werden NVIDIA NVENC, Intel Quick Sync Video und AMD AMF. Hardwarekodierung ist typischerweise 3–5× schneller und beansprucht die CPU weit weniger; bei gleicher Bitrate ist die Qualität etwa gleichauf mit der Softwarekodierung.
- VP9 hat keine Hardware-Implementierung und läuft immer über die CPU.
- Eine fehlgeschlagene Hardwarekodierung wird einmal auf der CPU wiederholt, statt die Aufgabe sofort als fehlgeschlagen zu markieren.
- Unter macOS fällt das Plugin auf Softwarekodierung zurück, wenn keine der drei verfügbar ist. Das ist erwartetes Verhalten.

**Farben der Speicheränderung**: Grün bedeutet kleiner als das Original, Rot größer, und die normale Textfarbe bedeutet nahezu unverändert oder dass der Schätzbereich die Originalgröße überschneidet.

**Weitere Hinweise**

- Während der Komprimierung können Sie jederzeit **Anhalten und abbrechen** wählen. Laufende FFmpeg-Prozesse werden beendet, noch nicht gestartete Aufgaben sofort als abgebrochen markiert, und die Originaldateien bleiben unberührt.
- Ändern Sie die Auswahl in Eagle und öffnen das Plugin erneut, fragt es nach: Vorgang abbrechen, aktuelle Warteschlange ersetzen oder anhängen. Laufende Arbeit wird nie stillschweigend verworfen.
- Bei „Zur Aufgabenliste hinzufügen“ folgt eine zweite Rückfrage: Die hinzugefügten Dateien werden sofort komprimiert und ersetzen ihre Originale. Der Dialog listet die neuen Dateien auf und nennt den tatsächlichen Sicherungsstatus dieses Durchlaufs. Während der Komprimierung lassen sich die Sicherungseinstellungen nicht ändern.

**Zum Ersetzen der Dateien**

- Nach erfolgreicher Komprimierung wird die Datei im ursprünglichen Pfad ersetzt – auch bei Dateien, die Sie ins Fenster gezogen haben. Das ist verlustbehaftet und nicht umkehrbar.
- Auch wenn „Nach Abschluss mit der Eagle-Bibliothek abgleichen“ deaktiviert ist, wird die Originaldatei **trotzdem ersetzt**. Diese Option steuert nicht das Überschreiben, sondern nur, ob das verknüpfte Element über die Ersetzungs-API von Eagle aktualisiert und das Vorschaubild erneuert wird. Sie eignet sich nicht dazu, das Original zu behalten.
- Um das Original zu behalten, wählen Sie zuerst über „Sicherungsordner wählen…“ ein Ziel und prüfen Sie, dass „Original vor der Komprimierung sichern“ aktiviert ist. Ohne gewählten Ordner ist das Kontrollkästchen deaktiviert und es wird nichts gesichert.
- Dateien, die nach der Komprimierung nicht kleiner sind, werden übersprungen; das Original bleibt unverändert.
- Bewahren Sie von unersetzlichem Material stets eine eigene, separate Kopie auf.

**Gespeicherte Daten und deren Entfernung**

- Das Plug-in schreibt genau zwei Dateien auf den Rechner: die Einstellungen unter `~/Library/Application Support/Eagle 视频压缩/settings.json` und das Laufzeitprotokoll unter `~/Library/Logs/Eagle 视频压缩/plugin.log`. Unter Windows liegen beide in `%APPDATA%\Eagle 视频压缩\`.
- Beide Pfade stehen oben im Bereich „Laufzeitprotokoll“ des Plug-ins und lassen sich dort direkt ablesen und kopieren.
- „Einstellungen zurücksetzen“ in der Kopfzeile stellt nur die Standardwerte wieder her und löscht die Datei nicht.
- Beim Deinstallieren bleiben diese beiden Dateien erhalten. Für eine vollständige Bereinigung die beiden oben genannten Ordner von Hand löschen.
- Temporäre Dateien der Komprimierung entstehen neben der Quelldatei und werden nach dem Durchlauf oder beim nächsten Start automatisch entfernt, sammeln sich also nicht an.

### 版本日志

### 1.1.2

- Behoben: Während eines Laufs angehängte Elemente wurden sofort komprimiert und ersetzten ihre Originale, obwohl der Hinweis nur Anzahl und Dateinamen zeigte. Das Anhängen während eines Laufs öffnet jetzt einen eigenen Bestätigungsdialog, der die neuen Dateien auflistet, das sofortige Komprimieren und Ersetzen der Dateien im ursprünglichen Pfad benennt und den tatsächlichen Sicherungsstatus dieses Laufs angibt — mit deutlicher Warnung, wenn die Originale nicht wiederhergestellt werden können.
- Behoben: Die Warnungen zu Überschreiben, Sicherung und Unwiederbringlichkeit vor dem Start waren fest in vereinfachtem Chinesisch hinterlegt und in allen anderen Sprachen unsichtbar. Sie stammen jetzt aus den Sprachdateien, mit vollständigen Übersetzungen für alle acht Sprachen.
- Behoben: Die Formulierung legte nahe, dass das Original nur bei aktivem „Nach Abschluss mit der Eagle-Bibliothek abgleichen“ ersetzt wird. Die Datei im ursprünglichen Pfad wird in jedem Fall ersetzt; die Option entscheidet nur, ob das verknüpfte Element und sein Vorschaubild über die Ersetzungs-API von Eagle aktualisiert werden. Oberfläche und Dokumentation wurden korrigiert.
- Verbessert: Das Paket wird jetzt aus einer Positivliste erstellt und enthält nur Programm, Stile, Symbol, Sprachdateien und die Lizenz.
- Verbessert: Name und Beschreibung für den Plugin-Store haben eine einzige Quelle, und die sprachabhängigen Längenbegrenzungen werden vor der Einreichung geprüft.
- Verbessert: Die Bedienung beginnt nun mit „Vor der ersten Nutzung“ und benennt, dass sowohl FFmpeg als auch ffprobe erforderlich sind und was passiert, wenn keines gefunden wird.
- Behoben: Die Schaltflächen „Komprimierung starten“ und „Anhalten und abbrechen“ sprangen seitlich, sobald die Zusammenfassung berechnet war. In einem schmalen Fenster rutschten sie in eine zweite Zeile, während das Füllelement, das sie nach rechts schob, in der ersten blieb — die Schaltflächen standen dann links. Sie richten sich jetzt selbst rechts aus, mit oder ohne Umbruch.
- Verbessert: Das Protokollfenster zeigt jetzt die vollständigen Pfade von Einstellungs- und Protokolldatei, und die Bedienhinweise haben einen Abschnitt „Gespeicherte Daten und deren Entfernung“ erhalten, der beschreibt, was nach dem Deinstallieren zurückbleibt und wie es sich entfernen lässt.

### 1.1.1

- Behoben: Nach der Komprimierung blieb von mehreren Tonspuren nur eine übrig. Jetzt werden alle Tonspuren unverändert übernommen.
- Behoben: Ein Ergebnis, das größer als die Quelle war, ersetzte trotzdem das Original. Solche Dateien werden jetzt übersprungen und das Original bleibt unangetastet.
- Behoben: Beim Abbrechen konnte eine beschädigte, halb geschriebene Datei zurückbleiben. Der laufende Prozess wird jetzt zuerst zum sauberen Beenden aufgefordert und erst danach zwangsweise beendet.
- Behoben: Temporäre Dateien aus der Komprimierung wurden von Eagle als neue Elemente in die Bibliothek aufgenommen.
- Verbessert: Das Importieren großer Mengen an Elementen blockiert die Oberfläche nicht mehr; bei 100 Dateien sank der Aufwand auf etwa 1/144.
- Verbessert: Das Auslesen der Dateiinformationen ist etwa dreimal so schnell; 25 Dateien brauchten 1,3 s, jetzt 0,45 s.
- Verbessert: VP9 kodiert jetzt mit mehreren Threads zugleich; bei 1080p-Material war es im Test etwa 2,2× schneller.
- Verbessert: Das Übernehmen des Ergebnisses erfolgt per Umbenennen; das Zurückschreiben einer 1 GB großen Datei dauerte etwa 1 Sekunde, jetzt praktisch nichts.
- Verbessert: Bei mehreren gleichzeitig laufenden Aufgaben werden die Kodier-Threads nach einem Gesamtbudget für den Rechner verteilt; die CPU-Last insgesamt sinkt um etwa 6–9 %.
- Neu: Auf Rechnern mit 24 oder mehr Kernen lässt sich die Parallelität auf 6 oder 8 einstellen.

### 1.1.0

- GPU-Hardware-Encoding hinzugefügt: NVIDIA NVENC, Intel QSV und AMD AMF werden unterstützt. Die neue Auswahl „Hardwarebeschleunigung" bietet automatisch, GPU erzwingen oder nur CPU (Standard: automatisch, mit Anzeige der erkannten GPU).
- Umrechnung der Qualitätsskala korrigiert: CRF und Hardware-QP sind unterschiedliche Skalen, daher wird jetzt auf `-rc constqp -qp` umgerechnet (+2 bei H.264/HEVC, ×3.2 bei AV1). Zuvor wich die Dateigröße um 45 % bis +340 % ab.
- Fehlgeschlagene Hardware-Kodierung wird einmal auf der CPU wiederholt. VP9 hat keine Hardware-Implementierung und läuft immer auf der CPU.
- Bei Hardware-Kodierung ist die Parallelität auf 2 begrenzt; die Größenschätzung vor der Komprimierung berücksichtigt den gewählten Encoder.
- Im Test mit 1080p30-Material sank H.265 von etwa 28 Sekunden bei rund 10 Kernen auf etwa 3 Sekunden bei unter einem Kern, PSNR-Differenz unter 0,12 dB.

### 1.0.2

- HDR-Erkennung hinzugefügt, mit einem bernsteinfarbenen Abzeichen für HDR10 / HLG / Dolby Vision / HDR10+ in der Aufgabenliste.
- Farbmetadaten werden beim Neukodieren mitgeführt, sodass eine HDR-Quelle nicht mehr als SDR ausgegeben wird.
- Markierung „bereits komprimiert“ hinzugefügt. Sie wird in die Ausgabe geschrieben und zeigt beim erneuten Laden Anzahl und Datum der Komprimierungen. In den Einstellungen abschaltbar. AVI und TS können keine beliebigen Metadaten speichern, dort wird nichts geschrieben.
- Die Zusammenfassung meldet nun, wie viele Dateien in der Warteschlange bereits von diesem Plugin komprimiert wurden.
- Behoben: Die Wahl von H.264 für eine HDR-Quelle zerstörte die HDR-Informationen unbemerkt; darauf wird jetzt in der Zusammenfassung hingewiesen.

### 1.0.1

- Behoben: H.265-Ausgaben ließen sich in macOS Finder, Übersicht und QuickTime nicht abspielen (jetzt mit `hvc1` gekennzeichnet).
- Behoben: Das Ersetzen der Originaldatei läuft nun über eine Zwischendatei plus atomares Umbenennen, sodass Abbruch oder E/A-Fehler keine beschädigte Quelle hinterlassen.
- Behoben: Eine synchrone Ausnahme der Eagle-Auswahl-API entkam ihrer Fehlerbehandlung.
- Behoben: Ein verspäteter Auswahl-Callback konnte einen bereits geschlossenen Dialog erneut öffnen.
- Neu: Sichtbare Schaltfläche **Anhalten und abbrechen** während der Komprimierung.
- Neu: Dreifachauswahl beim erneuten Öffnen mit neuer Eagle-Auswahl – abbrechen, Warteschlange ersetzen oder anhängen.
- Neu: Elemente können an eine laufende Warteschlange angehängt und von freien Workern übernommen werden.
- Neu: Fortschrittsanzeige der Stichprobenschätzung mit **Alle analysieren** und **Analyse stoppen**.
- Verbessert: Die Worker-Anzahl wird aus CPU-Kernen, Codec und Two-Pass-Modus abgeleitet, mit einer expliziten Thread-Obergrenze pro Codec.
- Verbessert: Temporäre Ausgaben werden nach Möglichkeit neben der Quelle abgelegt, was eine zusätzliche Vollkopie auf externen oder Netzlaufwerken vermeidet.

### 1.0.0

- Erste Veröffentlichung: Stapelkomprimierung, mehrere Codecs und Komprimierungsmodi, Größenschätzung, Sicherung und Ersetzung sowie Diagnoseprotokoll.

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
- Optional GPU hardware encoding (NVIDIA NVENC, Intel Quick Sync, AMD AMF), used automatically when suitable hardware is present and falling back to CPU software encoding otherwise.
- Backup is off by default and cannot be enabled until you pick a backup folder. Without it there is no copy of the original.
- Settings persist, the UI follows Eagle's theme, and eight languages are available.

### 使用说明

**Before you start**

This plugin needs a working FFmpeg **and** ffprobe. Both are required:

- Recommended: install the **FFmpeg** dependency plugin in Eagle. This plugin picks it up automatically.
- Alternatively, install FFmpeg yourself (it ships with ffprobe); the plugin falls back to your system installation.
- If neither is found, compression cannot run: the status bar reports that FFmpeg is unavailable and the runtime log opens automatically — use **Copy diagnostics** to see which paths were searched.

macOS is the currently verified platform.

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

- NVIDIA NVENC, Intel Quick Sync Video, and AMD AMF are supported. Hardware encoding is typically 3–5× faster and uses far less CPU, with quality at a given bitrate about equal to software encoding.
- VP9 has no hardware implementation and always uses the CPU.
- A failed hardware encode is retried once on the CPU rather than failing the task outright.
- On macOS, if none of the three is available, the plugin falls back to software encoding. This is expected.

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

### 1.1.2

- Fixed: items appended to a running queue started compressing and replaced their originals immediately, while the prompt showed only a count and file names. Appending during a run now opens its own confirmation that lists the new files, states they will be compressed at once and replace the files at their original paths, and reports this run's actual backup state — with an explicit warning when the originals cannot be recovered.
- Fixed: the overwrite, backup and unrecoverable warnings shown before a run were hard-coded Simplified Chinese and invisible in every other language. They now come from the locale files, with full translations for all eight languages.
- Fixed: the wording implied the original was only replaced when "Sync back to the Eagle library" was on. The file at the original path is replaced either way; that option only decides whether Eagle's replace API updates the linked item and its thumbnail. The interface and the docs have been corrected.
- Improved: the package is now built from an allow-list and contains only the program, styles, icon, locales and the licence.
- Improved: the plugin store name and description have a single source of truth, with per-language length limits checked before submission.
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

---

## Español（es_ES）

### 简述

Un complemento de transcodificación local para comprimir vídeos por lotes en Eagle. Carga automáticamente los vídeos seleccionados (también puedes arrastrar archivos de vídeo locales a la ventana), los vuelve a codificar con FFmpeg y, si la compresión tiene éxito, sustituye el archivo de la ruta original.

- Todo el procesamiento ocurre localmente. No se suben archivos de vídeo ni se envían metadatos a ningún servidor.
- Salida H.265/HEVC por defecto, con opciones H.264, AV1, VP9 y solo remultiplexado.
- Tres modos de compresión: calidad primero (CRF), tasa de bits objetivo y tamaño de archivo objetivo (H.264/H.265 con codificación en dos pasadas).
- La estimación de tamaño en modo CRF se basa en codificaciones de muestra reales, por lo que la interfaz muestra un intervalo en lugar de una cifra exacta engañosa.
- Controles de resolución, velocidad de fotogramas, audio, velocidad de codificación, concurrencia y tratamiento de fuentes de 10 bits.
- Detecta fuentes HDR y conserva sus metadatos de color al recodificar; marca los archivos ya comprimidos para evitar una segunda pasada con pérdida por descuido.
- Codificación por GPU opcional (NVIDIA NVENC, Intel Quick Sync, AMD AMF), que se usa automáticamente cuando hay hardware compatible y vuelve a la codificación por software en CPU en caso contrario.
- La copia de seguridad está desactivada por defecto y no puede activarse hasta elegir una carpeta de destino. Si la dejas desactivada, no quedará ninguna copia del archivo original.
- Los ajustes se conservan, la interfaz sigue el tema de Eagle y hay ocho idiomas disponibles.

### 使用说明

**Antes de empezar**

Este complemento necesita **tanto** un FFmpeg funcional **como** ffprobe.

- Recomendado: instala el complemento de dependencia «FFmpeg» en Eagle. El complemento lo usará automáticamente.
- También puedes instalar FFmpeg (con ffprobe incluido) en tu sistema; en ese caso se recurre a esa instalación local.
- Si no encuentra ninguno de los dos, no podrá comprimir: la barra de estado avisará de que FFmpeg no está disponible, el registro se desplegará automáticamente y con «Copiar diagnóstico» podrás ver las rutas exploradas.

La plataforma verificada actualmente es macOS.

**Flujo básico**

1. Selecciona uno o varios vídeos en Eagle.
2. Abre **Comprimir vídeo**. Los vídeos seleccionados se importan automáticamente a la lista de tareas. También puedes arrastrar archivos de vídeo locales a la ventana.
3. Elige el códec y el modo de compresión. El valor predeterminado es H.265 con CRF 28.
4. Revisa el tamaño original, el tamaño de salida estimado y el resumen del cambio de almacenamiento.
5. Si quieres conservar el archivo original, elige primero una carpeta de copia de seguridad y luego activa la copia.
6. Haz clic en **Iniciar compresión** y confirma después de leer los avisos de sobrescritura y copia de seguridad del diálogo.

**Cómo elegir el modo**

| Modo | Recomendado para | Comportamiento del tamaño |
| --- | --- | --- |
| Calidad primero (CRF) | Uso general, calidad visual constante | El tamaño final depende de la complejidad de la fuente; se muestra un intervalo estimado a partir de muestras |
| Tasa de bits objetivo | Cuando ya conoces la tasa de bits | Se calcula a partir de la duración, la tasa de bits de vídeo y los ajustes de audio |
| Tamaño de archivo objetivo | Presupuesto de tamaño estricto | H.264/H.265 usan dos pasadas para acercarse al objetivo; la sobrecarga del contenedor y del audio puede causar una pequeña diferencia |

**Cómo elegir la aceleración por hardware**

El selector «Aceleración por hardware» ofrece tres opciones:

| Opción | Comportamiento |
| --- | --- |
| Automático (se detectó …) | Usa la GPU si hay un codificador por hardware utilizable y vuelve a la CPU en caso contrario. Es el valor predeterminado y muestra la familia detectada |
| Forzar codificación por GPU | Solo codificación por hardware; falla si este equipo no tiene ningún codificador utilizable |
| Solo codificación por software en CPU | Codificación por software de principio a fin, el resultado más predecible |

- Se admiten NVIDIA NVENC, Intel Quick Sync Video y AMD AMF. La codificación por hardware suele ser de 3 a 5 veces más rápida y reduce mucho el uso de CPU, con una calidad a igual tasa de bits prácticamente equivalente a la codificación por software.
- VP9 no tiene implementación por hardware y siempre usa la CPU.
- Si la codificación por hardware falla, se reintenta una vez en CPU en lugar de marcar la tarea como fallida de inmediato.
- En macOS, si ninguna de las tres está disponible, el complemento vuelve a la codificación por software. Es el comportamiento esperado.

**Colores del cambio de almacenamiento**: verde significa menor que el original, rojo significa mayor, y el color de texto normal indica que apenas hay cambio o que el intervalo estimado cruza el tamaño original.

**Otras notas**

- Puedes pulsar **Detener y cancelar** en cualquier momento. Los procesos FFmpeg en curso se terminan, las tareas no iniciadas se marcan como canceladas de inmediato y los originales no se ven afectados.
- Si cambias la selección en Eagle y vuelves a abrir el complemento durante una ejecución, te preguntará si cancelar la acción, sustituir la cola actual o añadir a ella. El trabajo en curso nunca se descarta en silencio.
- Al elegir «Añadir a la cola de tareas» se pide una segunda confirmación: los archivos añadidos empiezan a comprimirse de inmediato y sustituyen a sus originales. El diálogo enumera los archivos nuevos e indica el estado real de la copia de seguridad de esta ejecución. Durante la compresión no se pueden cambiar los ajustes de copia.

**Sobre la sustitución de archivos**

- Si la compresión tiene éxito, se sustituye el archivo de la ruta original, incluidos los archivos que hayas arrastrado a la ventana. Es una operación con pérdida e irreversible.
- Desactivar «Sincronizar con la biblioteca de Eagle al terminar» **no evita** la sustitución del archivo original. Esa opción no controla la sobrescritura: solo decide si se actualiza el elemento vinculado mediante la API de sustitución de Eagle y se regenera la miniatura, así que no sirve para conservar el original.
- Para conservar el original, elige primero una carpeta con «Elegir ubicación de copia…» y comprueba que «Hacer copia del original antes de comprimir» esté activado. Sin carpeta elegida la casilla está desactivada y no se hace ninguna copia.
- Los archivos que no reducen su tamaño tras la compresión se omiten y el original se mantiene intacto.
- Conserva siempre una copia independiente del material irremplazable.

**Datos que se conservan y cómo eliminarlos**

- El complemento escribe exactamente dos archivos en tu equipo: los ajustes en `~/Library/Application Support/Eagle 视频压缩/settings.json` y el registro de ejecución en `~/Library/Logs/Eagle 视频压缩/plugin.log`. En Windows ambos están dentro de `%APPDATA%\Eagle 视频压缩\`.
- Ambas rutas aparecen en la parte superior del panel «Registro de ejecución» del complemento, donde puedes verlas y copiarlas directamente.
- «Restablecer ajustes» en la barra superior solo devuelve las opciones a sus valores por defecto; no borra el archivo.
- Desinstalar el complemento no elimina estos archivos. Para una limpieza completa, borra a mano las dos carpetas indicadas.
- Los archivos temporales de la compresión se crean junto al archivo original y se eliminan al terminar la tarea o en el siguiente arranque, así que no se acumulan.

### 版本日志

### 1.1.2

- Corregido: los elementos añadidos a una cola en ejecución empezaban a comprimirse y sustituían sus originales de inmediato, mientras el aviso solo mostraba un recuento y los nombres de archivo. Añadir durante una ejecución abre ahora su propio diálogo de confirmación, que enumera los archivos nuevos, indica que se comprimirán al momento y sustituirán los archivos de la ruta original, y muestra el estado real de la copia de seguridad de esta ejecución, con un aviso explícito cuando los originales no se pueden recuperar.
- Corregido: los avisos de sobrescritura, copia de seguridad e irreversibilidad previos a la ejecución estaban fijados en chino simplificado y no aparecían en ningún otro idioma. Ahora provienen de los archivos de idioma, con traducción completa en los ocho idiomas.
- Corregido: la redacción daba a entender que el original solo se sustituía con «Sincronizar con la biblioteca de Eagle al terminar» activado. El archivo de la ruta original se sustituye en ambos casos; esa opción solo decide si la API de sustitución de Eagle actualiza el elemento vinculado y su miniatura. Se han corregido la interfaz y la documentación.
- Mejorado: el paquete se construye ahora a partir de una lista de inclusión y contiene solo el programa, los estilos, el icono, los idiomas y la licencia.
- Mejorado: el nombre y la descripción para la tienda de complementos tienen una fuente única, y los límites de longitud por idioma se comprueban antes de enviarlos.
- Mejorado: las instrucciones de uso empiezan con «Antes de empezar», que indica que hacen falta FFmpeg y ffprobe y qué ocurre si no se encuentra ninguno.
- Corregido: los botones «Iniciar compresión» y «Detener y cancelar» daban un salto lateral en cuanto se calculaban las cifras del resumen. En una ventana estrecha pasaban a una segunda fila mientras el elemento que los empujaba a la derecha se quedaba en la primera, dejándolos pegados a la izquierda. Ahora se alinean a la derecha por sí mismos, haya salto de línea o no.
- Mejorado: el panel de registro muestra ahora la ruta completa del archivo de ajustes y del archivo de registro, y las instrucciones incluyen «Datos que se conservan y cómo eliminarlos», que indica qué queda tras desinstalar y cómo borrarlo.

### 1.1.1

- Corregido: en los archivos con varias pistas de audio solo quedaba una pista después de comprimir. Ahora se conservan todas las pistas tal cual.
- Corregido: si el resultado salía más grande que el original, aun así lo sustituía. Ahora esos archivos se omiten y el original queda intacto.
- Corregido: al cancelar una tarea podía quedar un archivo a medias y dañado. Ahora se pide primero una salida ordenada y solo después se fuerza el final.
- Corregido: los archivos temporales generados durante la compresión aparecían en Eagle como elementos nuevos de la biblioteca.
- Mejorado: importar gran cantidad de elementos ya no bloquea la interfaz; con 100 archivos el trabajo se redujo a aproximadamente 1/144 del anterior.
- Mejorado: la lectura de la información de los archivos es unas 3 veces más rápida; 25 archivos pasaron de 1,3 s a 0,45 s.
- Mejorado: VP9 ahora codifica con varios hilos a la vez; en material 1080p fue unas 2,2 veces más rápido en las pruebas.
- Mejorado: el resultado se aplica mediante un simple renombrado; escribir de vuelta un archivo de 1 GB pasó de unos 1 s a prácticamente nada.
- Mejorado: al comprimir varias tareas a la vez, los hilos de codificación se reparten según un presupuesto global del equipo; el uso total de CPU baja aproximadamente un 6–9 %.
- Añadido: en equipos de 24 núcleos o más, la concurrencia puede ajustarse a 6 u 8.

### 1.1.0

- Se añade codificación por GPU: compatible con NVIDIA NVENC, Intel QSV y AMD AMF. El nuevo selector «Aceleración por hardware» ofrece automático, forzar GPU o solo CPU (automático por defecto, con el nombre de la GPU detectada).
- Se corrige la conversión de la escala de calidad: CRF y QP por hardware son escalas distintas, así que ahora se convierte a `-rc constqp -qp` (+2 en H.264/HEVC, ×3.2 en AV1). Antes el tamaño se desviaba entre un 45 % y un +340 %.
- Si la codificación por hardware falla, se reintenta una vez en CPU. VP9 no tiene implementación por hardware y siempre usa la CPU.
- Con codificación por hardware la concurrencia se limita a 2, y la estimación de tamaño previa tiene en cuenta el codificador seleccionado.
- En material 1080p30, H.265 pasó de unos 28 s y unos 10 núcleos a unos 3 s y menos de un núcleo, con una diferencia de PSNR inferior a 0,12 dB.

### 1.0.2

- Añadida la detección de HDR, con una insignia ámbar en la lista de tareas para HDR10 / HLG / Dolby Vision / HDR10+.
- Los metadatos de color se conservan al recodificar, de modo que una fuente HDR ya no se marca como SDR.
- Añadida una marca de «ya comprimido» escrita en la salida. Al volver a cargar el archivo se muestra cuántas veces y en qué fecha se comprimió. Se puede desactivar en los ajustes. AVI y TS no admiten metadatos arbitrarios, así que en ellos no se escribe nada.
- El resumen indica cuántos archivos de la cola ya han sido comprimidos por este complemento.
- Corregido: elegir H.264 para una fuente HDR destruía la información HDR sin aviso; ahora aparece como advertencia en el resumen.

### 1.0.1

- Corregido: la salida H.265 no se reproducía en Finder, Vista rápida ni QuickTime de macOS (ahora se etiqueta como `hvc1`).
- Corregido: la sustitución del archivo original se hace mediante un archivo intermedio y un renombrado atómico, de modo que una cancelación o un error de E/S no dejan la fuente truncada.
- Corregido: una excepción síncrona de la API de selección de Eagle escapaba de su manejador.
- Corregido: una respuesta tardía de selección podía reabrir un diálogo ya cerrado.
- Añadido: control visible **Detener y cancelar** durante la compresión.
- Añadido: elección triple al reabrir el complemento con una nueva selección de Eagle: cancelar, sustituir la cola o añadir.
- Añadido: se pueden añadir elementos a una cola en ejecución; los procesos libres los recogen.
- Añadido: progreso de la estimación por muestreo con los controles **Analizar todo** y **Detener análisis**.
- Mejorado: el número de procesos se deriva de los núcleos de CPU, el códec y el modo de dos pasadas, con un límite explícito de hilos por códec.
- Mejorado: la salida temporal se escribe junto a la fuente cuando es posible, evitando una copia completa adicional en volúmenes externos o de red.

### 1.0.0

- Primera versión: compresión por lotes, varios códecs y modos de compresión, estimación de tamaño, copia de seguridad y sustitución, y registro de diagnóstico.

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
- GPU ハードウェアエンコード（NVIDIA NVENC / Intel QSV / AMD AMF）に対応。既定は自動で、利用可能なハードウェアがない場合は CPU ソフトウェアエンコードにフォールバックします。
- バックアップは既定でオフ。バックアップ先フォルダーを指定するまで有効にできません。オフのままだと元ファイルの控えは残りません。
- 設定は保存され、UI は Eagle のテーマに追従し、8 言語に対応します。

### 使用说明

**使う前の準備**

本プラグインには、動作する FFmpeg と ffprobe の**両方**が必要です。

- 推奨：Eagle で「FFmpeg」依存プラグインをインストールしてください。本プラグインが自動で利用します。
- ご自身でシステムに FFmpeg（ffprobe 同梱）をインストールしても構いません。その場合はローカルのインストールにフォールバックします。
- どちらも見つからない場合は圧縮できません。ステータスバーに FFmpeg が利用できない旨が表示され、実行ログが自動で開きます。「診断情報をコピー」で探索したパスを確認できます。

現時点で検証済みのプラットフォームは macOS です。

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

- NVIDIA NVENC、Intel Quick Sync Video、AMD AMF に対応。ハードウェアエンコードは通常 3〜5 倍高速で CPU 負荷も大幅に下がり、同一ビットレートでの画質はソフトウェアエンコードとほぼ同等です。
- VP9 にはハードウェア実装がないため、常に CPU を使用します。
- ハードウェアエンコードが失敗した場合は CPU で 1 回だけ再実行し、即座に失敗とはしません。
- macOS でこの 3 種類がいずれも利用できない場合、ソフトウェアエンコードにフォールバックします。これは想定どおりの動作です。

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

### 1.1.2

- 修正：圧縮中にキューへ追加した素材が、すぐに圧縮を始めて元ファイルを置き換えていました（表示は件数とファイル名のみ）。実行中の追加では専用の確認ダイアログを開き、追加ファイルの一覧、すぐに圧縮して元のパスのファイルを置き換えること、今回の実際のバックアップ状態を表示します。バックアップが無効なときは元に戻せない旨を明示します。
- 修正：実行前の確認に出る上書き・バックアップ・復元不可の警告が簡体字中国語のハードコードで、他の言語では表示されませんでした。現在はすべて言語リソースから取得し、8 言語すべてに翻訳があります。
- 修正：「完了後に Eagle ライブラリへ反映」をオンにしたときだけ元素材が置き換わるかのような表現でした。オンでもオフでも元のパスのファイルは置き換わります。このオプションは Eagle の置き換え API で関連アイテムとサムネイルを更新するかどうかを決めるだけです。UI とドキュメントを修正しました。
- 改善：パッケージを許可リスト方式に変更し、プログラム・スタイル・アイコン・言語リソースとライセンスだけを含めるようにしました。
- 改善：プラグインストア用の名称と説明文に単一の管理元を用意し、提出前に言語ごとの文字数上限を検査するようにしました。
- 改善：使い方の冒頭に「使う前の準備」を追加し、FFmpeg と ffprobe の両方が必要であること、どちらも見つからない場合の挙動を明記しました。
- 修正：集計値が算出されたタイミングで「圧縮を開始」「停止してキャンセル」が左右に動いていました。ウィンドウが狭いとボタンが 2 行目に折り返される一方、右へ押し出すスペーサーは 1 行目に残るため左寄せになっていました。現在は折り返しの有無にかかわらずボタン自身が右に揃います。
- 改善：ログパネルの上部に設定ファイルとログファイルの完全なパスを表示し、使い方に「保存されるデータと削除方法」を追加して、アンインストール後に残るファイルの場所と手動削除の手順を明記しました。

### 1.1.1

- 修正：音声トラックが複数ある素材で、圧縮後に 1 つしか残らなくなる問題。現在はすべての音声トラックがそのまま保持されます。
- 修正：圧縮後にかえってファイルサイズが大きくなる場合でも元ファイルを置き換えていた問題。現在はそのファイルをスキップし、元ファイルをそのまま残します。
- 修正：タスクのキャンセルで、途中までしか書き込まれていない壊れたファイルが残ることがある問題。現在は正常な終了を要求してから強制終了します。
- 修正：圧縮中に生成される一時ファイルが、Eagle に新しいアイテムとして自動的に取り込まれてしまう問題。
- 改善：大量の素材を一括で取り込んでも UI が固まらなくなりました。100 ファイルでは従来の約 1/144 の処理量になります。
- 改善：素材の情報を読み取る速度が約 3 倍に向上しました。25 ファイルでは 1.3 秒から 0.45 秒に短縮されます。
- 改善：VP9 エンコードがマルチスレッドの分割処理に対応し、1080p の素材で実測約 2.2 倍高速になりました。
- 改善：元ファイルの置き換えを名前の変更で行うようになり、1GB ファイルの書き込みが約 1 秒からほぼゼロになりました。
- 改善：複数のタスクを同時に圧縮する際、スレッドをマシン全体の予算内で割り当てるようにし、CPU 使用率の合計が約 6%〜9% 下がりました。
- 追加：24 コア以上のマシンでは、並行数を 6 または 8 に設定できるようになりました。

### 1.1.0

- GPU ハードウェアエンコードを追加しました。NVIDIA NVENC / Intel QSV / AMD AMF に対応し、「ハードウェアアクセラレーション」で自動・GPU 強制・CPU のみを選択できます（既定は自動、検出した GPU 名を表示）。
- 品質スケールの換算を修正しました。CRF とハードウェア QP は別の尺度なので、`-rc constqp -qp` に変換します（H.264/HEVC は +2、AV1 は ×3.2）。従来はファイルサイズが 45%〜+340% ずれていました。
- ハードウェアエンコード失敗時は CPU で 1 回だけ再実行します。VP9 はハードウェア実装がないため常に CPU を使用します。
- ハードウェアエンコード時の並行数は 2 に制限し、圧縮前のサイズ見積もりも選択したエンコーダーを反映します。
- 1080p30 の素材での実測では、H.265 が約 28 秒・約 10 コアから約 3 秒・1 コア未満になり、PSNR 差は 0.12 dB 以内です。

### 1.0.2

- HDR ソースの判別を追加。タスクリストに HDR10 / HLG / Dolby Vision / HDR10+ の琥珀色バッジを表示します。
- 再エンコード時に色情報を引き継ぐようになり、HDR ソースが SDR として出力されることがなくなりました。
- 「圧縮済み」マーカーを追加。出力に書き込まれ、再度読み込んだときに圧縮回数と日付を表示します。設定でオフにできます。AVI と TS は任意のメタデータを保持できないため、書き込みません。
- キュー内にこのプラグインで圧縮済みのファイルがある場合、サマリーにその件数を表示します。
- 修正：HDR ソースに H.264 を選ぶと HDR 情報が黙って失われていた問題を、サマリー欄の警告として表示するようにしました。

### 1.0.1

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

### 1.0.0

- 初回リリース：一括圧縮、複数のコーデックと圧縮方式、サイズ推定、バックアップと置き換え、診断ログ。

---

## 한국어（ko_KR）

### 简述

Eagle에서 동영상을 일괄 압축하는 로컬 트랜스코딩 플러그인입니다. 실행하면 현재 선택된 동영상을 자동으로 불러오고(로컬 동영상 파일을 창으로 끌어다 놓을 수도 있습니다) FFmpeg으로 다시 인코딩한 뒤, 성공하면 원본 경로의 파일을 대체합니다.

- 모든 처리는 로컬에서 이루어집니다. 동영상 파일을 업로드하지 않으며 메타데이터도 외부로 전송하지 않습니다.
- 기본 출력은 H.265/HEVC이며 H.264, AV1, VP9, 리먹스 전용도 지원합니다.
- 압축 방식 세 가지: 화질 우선(CRF), 비트레이트 지정, 목표 파일 크기(H.264/H.265는 2패스 인코딩).
- CRF 모드의 용량 예측은 실제 샘플 인코딩을 기반으로 하므로, 오해를 부르는 정확한 수치 대신 범위를 표시합니다.
- 해상도, 프레임 레이트, 오디오, 인코딩 속도, 동시 실행 수, 10비트 소스 처리 방식을 조절할 수 있습니다.
- HDR 소스를 자동으로 감지하고 재인코딩 시 색상 메타데이터를 보존합니다. 이미 압축된 파일에는 표식을 남겨 중복 손실 압축을 방지합니다.
- GPU 하드웨어 인코딩(NVIDIA NVENC / Intel QSV / AMD AMF)을 지원하며 기본값은 자동, 사용할 수 있는 하드웨어가 없으면 CPU 소프트웨어 인코딩으로 대체합니다.
- 백업은 기본적으로 꺼져 있으며, 백업 폴더를 지정해야 활성화할 수 있습니다. 꺼 둔 채로 실행하면 원본 사본이 남지 않습니다.
- 설정이 유지되고, UI는 Eagle 테마를 따르며, 8개 언어를 지원합니다.

### 使用说明

**사용 전 준비**

이 플러그인은 사용할 수 있는 FFmpeg과 ffprobe가 **둘 다** 있어야 동작합니다.

- 권장: Eagle에서 「FFmpeg」 종속 플러그인을 설치하세요. 이 플러그인이 자동으로 사용합니다.
- 직접 시스템에 FFmpeg(ffprobe 포함)을 설치해도 됩니다. 이 경우 로컬 설치본으로 대체합니다.
- 둘 다 찾지 못하면 압축할 수 없습니다. 상태 표시줄에 FFmpeg을 사용할 수 없다는 안내가 뜨고 실행 로그가 자동으로 펼쳐지며, 「진단 정보 복사」로 탐색한 경로를 확인할 수 있습니다.

현재 검증된 플랫폼은 macOS입니다.

**기본 흐름**

1. Eagle에서 동영상을 하나 이상 선택합니다.
2. **동영상 압축**을 엽니다. 선택한 동영상이 작업 목록에 자동으로 추가됩니다. 로컬 동영상 파일을 창으로 끌어다 놓아도 됩니다.
3. 코덱과 압축 방식을 선택합니다. 기본값은 H.265 + CRF 28입니다.
4. 원본 크기, 예상 출력 크기, 저장 공간 변화 요약을 확인합니다.
5. 원본 파일을 남기려면 먼저 백업 폴더를 지정한 다음 백업을 활성화합니다.
6. **압축 시작**을 클릭하고, 확인 창의 덮어쓰기·백업 안내를 읽은 뒤 확인합니다.

**압축 방식 선택 기준**

| 방식 | 적합한 경우 | 용량 특성 |
| --- | --- | --- |
| 화질 우선(CRF) | 일상적인 사용, 일관된 화질 | 최종 용량은 소스 복잡도에 따라 달라지며, 샘플 인코딩 기반 예상 범위를 표시합니다 |
| 비트레이트 지정 | 목표 비트레이트가 정해진 경우 | 길이, 영상 비트레이트, 오디오 설정으로 계산합니다 |
| 목표 파일 크기 | 용량 상한이 엄격한 경우 | H.264/H.265는 2패스로 목표에 근접시키며, 컨테이너와 오디오 오버헤드로 약간의 오차가 생깁니다 |

**하드웨어 가속 선택 기준**

「하드웨어 가속」에는 세 가지 선택지가 있습니다.

| 선택지 | 동작 |
| --- | --- |
| 자동(… 감지됨) | 사용할 수 있는 하드웨어 인코더가 있으면 GPU를 쓰고, 없으면 CPU로 대체합니다. 기본값이며 감지된 계열을 표시합니다 |
| GPU 하드웨어 인코딩 강제 | 하드웨어 인코딩만 사용하며, 사용할 수 있는 인코더가 없으면 실패합니다 |
| CPU 소프트웨어 인코딩만 | 처음부터 끝까지 소프트웨어 인코딩. 결과를 가장 예측하기 쉽습니다 |

- NVIDIA NVENC, Intel Quick Sync Video, AMD AMF를 지원합니다. 하드웨어 인코딩은 보통 3~5배 빠르고 CPU 점유율도 크게 낮으며, 같은 비트레이트에서 화질은 소프트웨어 인코딩과 거의 같습니다.
- VP9은 하드웨어 구현이 없어 항상 CPU를 사용합니다.
- 하드웨어 인코딩이 실패하면 CPU로 한 번 다시 시도하며, 바로 실패로 처리하지 않습니다.
- macOS에서 세 가지 모두 사용할 수 없다면 소프트웨어 인코딩으로 대체합니다. 이는 정상적인 동작입니다.

**저장 공간 변화 색상**: 초록색은 원본보다 작아짐, 빨간색은 커짐, 기본 색상은 거의 변화가 없거나 예상 범위가 원본 크기를 넘나든다는 뜻입니다.

**기타 안내**

- 압축 중 언제든 **중지 및 취소**를 누를 수 있습니다. 실행 중인 FFmpeg이 종료되고, 시작 전 작업은 즉시 취소로 표시되며, 원본 파일은 영향을 받지 않습니다.
- 압축 중에 Eagle에서 선택을 바꾸고 플러그인을 다시 열면 이번 작업 취소, 현재 대기열 교체, 대기열에 추가 중 하나를 묻습니다. 진행 중인 작업을 조용히 버리지 않습니다.
- 「작업 대기열에 추가」를 고르면 한 번 더 확인합니다. 추가된 소재는 곧바로 압축이 시작되고 원본 파일을 대체하므로, 확인 창에 추가 파일 목록과 이번 실행의 실제 백업 상태를 표시합니다. 압축 중에는 백업 설정을 변경할 수 없습니다.

**파일 대체 안내**

- 압축에 성공하면 원본 경로의 파일을 대체합니다. 창으로 끌어다 놓은 로컬 파일도 마찬가지입니다. 손실이 있으며 되돌릴 수 없습니다.
- 「완료 후 Eagle 라이브러리에 반영」을 꺼도 원본 파일은 **그대로 대체됩니다**. 이 옵션은 덮어쓰기 여부를 제어하지 않고, Eagle의 대체 API로 연결된 항목을 갱신하고 미리보기를 새로 만들지만 결정할 뿐이므로 원본을 남기는 용도로 쓸 수 없습니다.
- 원본을 남기려면 먼저 「백업 위치 선택…」으로 폴더를 지정하고 「압축 전 원본 백업」이 켜져 있는지 확인하세요. 폴더를 지정하지 않으면 이 체크박스는 비활성 상태이며 백업도 이루어지지 않습니다.
- 압축해도 용량이 줄지 않은 파일은 건너뛰고 원본을 그대로 둡니다.
- 중요한 자료는 반드시 별도로 백업해 두세요.

**남는 데이터와 정리 방법**

- 이 플러그인이 내 컴퓨터에 쓰는 파일은 두 개뿐입니다. 설정은 `~/Library/Application Support/Eagle 视频压缩/settings.json`, 실행 로그는 `~/Library/Logs/Eagle 视频压缩/plugin.log`입니다. Windows에서는 둘 다 `%APPDATA%\Eagle 视频压缩\` 아래에 있습니다.
- 두 경로는 플러그인의 「실행 로그」 패널 상단에 표시되어 바로 확인하고 복사할 수 있습니다.
- 상단 바의 「설정 초기화」는 선택 항목만 기본값으로 되돌리며 파일을 삭제하지는 않습니다.
- 플러그인을 삭제해도 이 두 파일은 남습니다. 완전히 지우려면 위의 두 폴더를 직접 삭제하세요.
- 압축 중 생기는 임시 파일은 원본 파일 옆에 만들어지며 작업이 끝나거나 다음 실행 때 자동으로 정리되므로 계속 공간을 차지하지 않습니다.

### 版本日志

### 1.1.2

- 수정: 압축 중 대기열에 추가한 소재가 곧바로 압축을 시작해 원본을 대체했고, 안내에는 개수와 파일 이름만 표시되었습니다. 이제 실행 중 추가하면 전용 확인 창이 열려 추가 파일 목록, 즉시 압축되어 원본 경로의 파일을 대체한다는 사실, 이번 실행의 실제 백업 상태를 보여 줍니다. 백업이 꺼져 있으면 복구할 수 없다고 명확히 경고합니다.
- 수정: 실행 전 확인 창의 덮어쓰기·백업·복구 불가 경고가 간체 중국어로 하드코딩되어 다른 언어에서는 보이지 않았습니다. 이제 모두 언어 리소스에서 가져오며 8개 언어 번역이 모두 준비되어 있습니다.
- 수정: 「완료 후 Eagle 라이브러리에 반영」을 켰을 때만 원본이 대체되는 것처럼 읽히는 문구였습니다. 켜든 끄든 원본 경로의 파일은 대체됩니다. 이 옵션은 Eagle의 대체 API로 연결된 항목과 미리보기를 갱신할지만 결정합니다. UI와 문서를 모두 바로잡았습니다.
- 개선: 설치 패키지를 허용 목록 방식으로 바꿔 실행 프로그램, 스타일, 아이콘, 언어 리소스와 라이선스만 포함합니다.
- 개선: 플러그인 스토어용 이름과 설명에 단일 관리처를 두고, 제출 전에 언어별 글자 수 상한을 검사합니다.
- 개선: 사용 방법 앞부분에 「사용 전 준비」를 추가해 FFmpeg과 ffprobe가 모두 필요하다는 점과 둘 다 없을 때의 동작을 밝혔습니다.
- 수정: 요약 수치가 계산되는 순간 「압축 시작」과 「중지 및 취소」 버튼이 좌우로 튀었습니다. 창이 좁으면 버튼이 둘째 줄로 넘어가는데 버튼을 오른쪽으로 밀던 여백 요소는 첫 줄에 남아 왼쪽에 붙었습니다. 이제 줄바꿈 여부와 상관없이 버튼이 스스로 오른쪽에 정렬됩니다.
- 개선: 로그 패널 상단에 설정 파일과 로그 파일의 전체 경로를 함께 표시하고, 사용 방법에 「남는 데이터와 정리 방법」을 추가해 삭제 후 남는 파일 위치와 수동 정리 방법을 밝혔습니다.

### 1.1.1

- 수정: 오디오 트랙이 여러 개인 소재가 압축 후 트랙 하나만 남던 문제. 이제 모든 오디오 트랙이 그대로 유지됩니다.
- 수정: 압축 후 오히려 파일 크기가 커져도 원본 파일을 대체하던 문제. 이제 해당 파일은 건너뛰고 원본을 그대로 남깁니다.
- 수정: 작업을 취소하면 깨진 중간 파일이 남을 수 있던 문제. 이제 정상 종료를 요청한 뒤 강제 종료합니다.
- 수정: 압축 중 생성된 임시 파일이 Eagle에 새 항목으로 자동 추가되던 문제.
- 개선: 소재를 대량으로 일괄 불러와도 UI가 멈추지 않습니다. 100개 파일의 처리량이 기존의 약 1/144로 줄었습니다.
- 개선: 소재 정보를 읽는 속도가 약 3배 빨라졌습니다. 25개 파일이 1.3초에서 0.45초로 단축되었습니다.
- 개선: VP9 인코딩이 멀티스레드 분할 처리를 사용해 1080p 소재 실측에서 약 2.2배 빨라졌습니다.
- 개선: 원본 파일 대체가 이름 변경 방식으로 바뀌어 1GB 파일 기록 시간이 약 1초에서 거의 0으로 줄었습니다.
- 개선: 여러 작업을 동시에 압축할 때 스레드를 시스템 전체 예산에 맞춰 배분해 CPU 점유율이 약 6%~9% 낮아졌습니다.
- 추가: 24코어 이상 시스템에서는 동시 실행 수를 6 또는 8로 선택할 수 있습니다.

### 1.1.0

- GPU 하드웨어 인코딩을 추가했습니다. NVIDIA NVENC / Intel QSV / AMD AMF를 지원하며, 「하드웨어 가속」에서 자동·GPU 강제·CPU 전용을 선택할 수 있습니다(기본값 자동, 감지된 GPU 이름 표시).
- 화질 척도 변환을 수정했습니다. CRF와 하드웨어 QP는 다른 척도이므로 `-rc constqp -qp`로 변환합니다(H.264/HEVC는 +2, AV1은 ×3.2). 이전에는 파일 크기가 45%~+340% 벗어났습니다.
- 하드웨어 인코딩이 실패하면 CPU로 한 번만 다시 시도합니다. VP9은 하드웨어 구현이 없어 항상 CPU를 사용합니다.
- 하드웨어 인코딩 시 동시 실행 수는 2로 제한하고, 압축 전 크기 예측도 선택한 인코더를 반영합니다.
- 1080p30 소재 실측에서 H.265가 약 28초·약 10코어에서 약 3초·1코어 미만으로 줄었으며 PSNR 차이는 0.12 dB 이내입니다.

### 1.0.2

- HDR 소스 감지를 추가했습니다. 작업 목록에 HDR10 / HLG / Dolby Vision / HDR10+ 앰버 배지를 표시합니다.
- 재인코딩 시 색상 메타데이터를 함께 전달하여 HDR 소스가 SDR로 출력되지 않습니다.
- "이미 압축됨" 표식을 추가했습니다. 출력 파일에 기록되어 다시 불러올 때 압축 횟수와 날짜를 보여 줍니다. 설정에서 끌 수 있습니다. AVI와 TS는 임의 메타데이터를 저장할 수 없어 기록하지 않습니다.
- 대기열에 이미 압축된 파일이 있으면 요약 영역에 개수를 알립니다.
- 수정: HDR 소스에 H.264를 선택하면 HDR 정보가 조용히 사라지던 문제를 요약 영역의 경고로 표시합니다.

### 1.0.1

- 수정: H.265 출력이 macOS Finder / 훑어보기 / QuickTime에서 재생되지 않던 문제(`hvc1` 태그 적용).
- 수정: 원본 파일 대체를 임시 파일 + 원자적 이름 변경 방식으로 변경했습니다. 취소나 I/O 오류로 원본이 손상되지 않습니다.
- 수정: Eagle 선택 항목 조회 API의 동기 예외가 처리기 밖으로 새던 문제.
- 수정: 늦게 도착한 선택 콜백이 이미 닫힌 대화 상자를 다시 여는 문제.
- 추가: 압축 중 표시되는 **중지 및 취소** 버튼.
- 추가: 새 선택 항목이 있는 상태로 플러그인을 다시 열 때 취소 / 교체 / 추가 세 가지 선택지.
- 추가: 실행 중인 대기열에 항목 추가. 대기 중인 워커가 이어서 처리합니다.
- 추가: 샘플 예측 진행 표시와 **전체 분석** / **분석 중지** 컨트롤.
- 개선: 동시 실행 수를 CPU 코어, 코덱, 2패스 여부로 산출하고 코덱별 스레드 수에 상한을 두었습니다.
- 개선: 임시 파일을 가능한 한 소스 옆에 기록하여 외장/네트워크 볼륨에서 전체 복사가 한 번 더 일어나지 않게 했습니다.

### 1.0.0

- 첫 배포 버전: 일괄 압축, 다양한 코덱과 압축 방식, 용량 예측, 백업과 대체, 진단 로그.

---

## Русский（ru_RU）

### 简述

Плагин для локального пакетного сжатия видео в Eagle. Он автоматически загружает выбранные видео (локальные видеофайлы можно просто перетащить в окно), перекодирует их с помощью FFmpeg и после успешного сжатия заменяет файл по исходному пути.

- Вся обработка выполняется локально. Видеофайлы не загружаются в сеть, метаданные никуда не отправляются.
- По умолчанию выводится H.265/HEVC; доступны также H.264, AV1, VP9 и режим только перепаковки.
- Три режима сжатия: качество прежде всего (CRF), целевой битрейт и целевой размер файла (для H.264/H.265 используется двухпроходное кодирование).
- Оценка размера в режиме CRF строится на реальных пробных кодированиях, поэтому интерфейс показывает диапазон, а не обманчиво точное число.
- Настраиваются разрешение, частота кадров, звук, скорость кодирования, параллельность и обработка 10-битных источников.
- HDR-источники распознаются, а метаданные цвета сохраняются при перекодировании. Уже сжатые файлы помечаются, чтобы случайно не выполнить второй проход с потерями.
- Опциональное аппаратное кодирование на GPU (NVIDIA NVENC, Intel Quick Sync, AMD AMF): применяется автоматически при наличии подходящего оборудования, иначе используется программное кодирование на CPU.
- Резервное копирование выключено по умолчанию и включается только после выбора папки для копий. Если оставить его выключенным, копии исходного файла не останется.
- Настройки сохраняются, интерфейс следует теме Eagle, поддерживаются восемь языков.

### 使用说明

**Подготовка к работе**

Плагину нужны **и** работающий FFmpeg, **и** ffprobe.

- Рекомендуется установить в Eagle модуль-зависимость «FFmpeg» — плагин задействует его автоматически.
- Можно также установить FFmpeg (вместе с ffprobe) в системе самостоятельно: тогда плагин перейдёт на локальную установку.
- Если не найдено ни того, ни другого, сжатие невозможно: в строке состояния появится сообщение о недоступности FFmpeg, журнал раскроется автоматически, а кнопка «Скопировать диагностику» покажет проверенные пути.

На данный момент проверена работа на macOS.

**Основной порядок работы**

1. Выберите в Eagle одно или несколько видео.
2. Откройте **Сжатие видео**. Выбранные видео автоматически попадут в список задач. Локальные видеофайлы можно также перетащить в окно.
3. Выберите кодек и режим сжатия. По умолчанию — H.265 с CRF 28.
4. Проверьте исходный размер, ожидаемый размер результата и сводку изменения занимаемого места.
5. Если нужно сохранить оригинал, сначала укажите папку для резервных копий, затем включите резервное копирование.
6. Нажмите **Начать сжатие** и подтвердите, прочитав в диалоге предупреждения о перезаписи и резервном копировании.

**Как выбрать режим**

| Режим | Подходит для | Поведение размера |
| --- | --- | --- |
| Качество прежде всего (CRF) | Повседневное использование, стабильное качество | Итоговый размер зависит от сложности источника; показывается диапазон, полученный по пробным кодированиям |
| Целевой битрейт | Известный целевой битрейт | Рассчитывается по длительности, видеобитрейту и настройкам звука |
| Целевой размер файла | Жёсткое ограничение по размеру | H.264/H.265 приближаются к цели за два прохода; накладные расходы контейнера и звука дают небольшое отклонение |

**Как выбрать аппаратное ускорение**

Список «Аппаратное ускорение» предлагает три варианта:

| Вариант | Поведение |
| --- | --- |
| Авто (обнаружено …) | Использует GPU, если найден пригодный аппаратный кодер, иначе возвращается к CPU. Это вариант по умолчанию, и в списке показывается обнаруженное семейство |
| Принудительно GPU | Только аппаратное кодирование; завершается ошибкой, если на этом компьютере нет пригодного кодера |
| Только CPU | Программное кодирование от начала до конца, наиболее предсказуемый результат |

- Поддерживаются NVIDIA NVENC, Intel Quick Sync Video и AMD AMF. Аппаратное кодирование обычно в 3–5 раз быстрее и заметно меньше нагружает CPU, а качество при том же битрейте примерно равно программному.
- У VP9 нет аппаратной реализации, он всегда идёт через CPU.
- При сбое аппаратного кодирования задача один раз повторяется на CPU, а не сразу помечается как неудачная.
- В macOS, если ни один из трёх вариантов недоступен, плагин возвращается к программному кодированию. Это ожидаемое поведение.

**Цвета изменения занимаемого места**: зелёный — результат меньше оригинала, красный — больше, обычный цвет текста — размер почти не изменился либо диапазон оценки пересекает исходный размер.

**Прочее**

- В любой момент можно нажать **Остановить и отменить**. Запущенные процессы FFmpeg завершаются, ещё не начатые задачи сразу помечаются как отменённые, исходные файлы не затрагиваются.
- Если изменить выбор в Eagle и снова открыть плагин во время работы, он спросит: отменить действие, заменить текущую очередь или добавить к ней. Выполняемая работа никогда не отбрасывается молча.
- При выборе «Добавить в очередь задач» плагин запросит подтверждение ещё раз: добавленные файлы начнут сжиматься сразу и заменят свои оригиналы. В диалоге перечислены новые файлы и указано фактическое состояние резервного копирования для этого запуска. Во время сжатия настройки резервного копирования изменить нельзя.

**О замене файлов**

- После успешного сжатия файл по исходному пути заменяется — в том числе для файлов, перетащенных в окно. Операция выполняется с потерями и необратима.
- Даже если выключить «Синхронизировать с библиотекой Eagle после завершения», исходный файл **всё равно будет заменён**. Этот параметр не управляет перезаписью, а только определяет, обновлять ли связанный элемент через API замены Eagle и перестраивать ли миниатюру. Сохранить оригинал с его помощью нельзя.
- Чтобы сохранить оригинал, сначала укажите папку через «Выбрать папку для копии…» и убедитесь, что включён параметр «Создать копию оригинала перед сжатием». Без выбранной папки этот флажок недоступен, и копия не создаётся.
- Файлы, которые после сжатия не стали меньше, пропускаются, а оригинал остаётся нетронутым.
- Всегда держите отдельную копию незаменимых материалов.

**Какие данные остаются и как их удалить**

- Плагин записывает на компьютер ровно два файла: настройки в `~/Library/Application Support/Eagle 视频压缩/settings.json` и журнал выполнения в `~/Library/Logs/Eagle 视频压缩/plugin.log`. В Windows оба находятся в `%APPDATA%\Eagle 视频压缩\`.
- Оба пути показаны в верхней части панели «Журнал выполнения» внутри плагина — их можно сразу прочитать и скопировать.
- Кнопка «Сбросить настройки» в верхней панели только возвращает параметры к значениям по умолчанию и файл не удаляет.
- Удаление плагина эти файлы не затрагивает. Для полной очистки удалите указанные выше две папки вручную.
- Временные файлы сжатия создаются рядом с исходным файлом и удаляются по окончании задачи или при следующем запуске, поэтому они не накапливаются.

### 版本日志

### 1.1.2

- Исправлено: элементы, добавленные в очередь во время работы, сразу начинали сжиматься и заменяли свои оригиналы, хотя в подсказке были только количество и имена файлов. Теперь добавление во время выполнения открывает отдельный диалог подтверждения: он перечисляет новые файлы, сообщает, что они будут сжаты немедленно и заменят файлы по исходным путям, и показывает фактическое состояние резервного копирования этого запуска — с явным предупреждением, когда оригиналы восстановить не удастся.
- Исправлено: предупреждения о перезаписи, резервной копии и необратимости перед запуском были жёстко зашиты на упрощённом китайском и не отображались на других языках. Теперь они берутся из языковых файлов, перевод есть для всех восьми языков.
- Исправлено: формулировка создавала впечатление, что оригинал заменяется только при включённой опции «Синхронизировать с библиотекой Eagle после завершения». Файл по исходному пути заменяется в любом случае; эта опция лишь определяет, обновит ли API замены Eagle связанный элемент и его миниатюру. Интерфейс и документация исправлены.
- Улучшено: пакет собирается по белому списку и содержит только программу, стили, значок, языковые файлы и лицензию.
- Улучшено: название и описание для каталога плагинов имеют единый источник, а ограничения по длине для каждого языка проверяются до отправки.
- Улучшено: раздел с инструкцией начинается с «Подготовки к работе», где сказано, что нужны и FFmpeg, и ffprobe, и что происходит, если не найден ни один из них.
- Исправлено: кнопки «Начать сжатие» и «Остановить и отменить» смещались вбок, как только вычислялись сводные значения. В узком окне они переносились на вторую строку, а распорка, отодвигавшая их вправо, оставалась на первой — кнопки прижимались к левому краю. Теперь они выравниваются по правому краю сами, независимо от переноса.
- Улучшено: в панели журнала теперь показаны полные пути к файлу настроек и файлу журнала, а в инструкцию добавлен раздел «Какие данные остаются и как их удалить» с описанием того, что сохраняется после удаления плагина и как это убрать.

### 1.1.1

- Исправлено: после сжатия из нескольких звуковых дорожек оставалась только одна. Теперь все дорожки сохраняются без изменений.
- Исправлено: если результат получался больше исходного файла, он всё равно заменял оригинал. Теперь такие файлы пропускаются, а оригинал остаётся нетронутым.
- Исправлено: при отмене задачи мог остаться повреждённый, записанный наполовину файл. Теперь сначала запрашивается штатное завершение, и только потом процесс принудительно снимается.
- Исправлено: временные файлы, создаваемые при сжатии, попадали в библиотеку Eagle как новые элементы.
- Улучшено: импорт большого числа элементов больше не подвешивает интерфейс; для 100 файлов объём работы снизился примерно до 1/144 от прежнего.
- Улучшено: чтение информации о файлах ускорилось примерно в 3 раза: 25 файлов вместо 1,3 с теперь обрабатываются за 0,45 с.
- Улучшено: VP9 теперь кодируется в несколько потоков; на материале 1080p в тестах ускорение составило примерно 2,2 раза.
- Улучшено: результат подменяется простым переименованием; обратная запись файла размером 1 GB занимала около 1 с, а теперь — практически ничего.
- Улучшено: при одновременном сжатии нескольких задач потоки кодирования распределяются по общему бюджету компьютера; суммарная загрузка CPU снижается примерно на 6–9 %.
- Добавлено: на компьютерах с 24 ядрами и больше уровень параллелизма можно выставить равным 6 или 8.

### 1.1.0

- Добавлено аппаратное кодирование на GPU: поддерживаются NVIDIA NVENC, Intel QSV и AMD AMF. Новый список «Аппаратное ускорение» предлагает режимы «авто», «только GPU» и «только CPU» (по умолчанию — авто, с названием обнаруженной видеокарты).
- Исправлен пересчёт шкалы качества: CRF и аппаратный QP — разные шкалы, поэтому теперь используется преобразование в `-rc constqp -qp` (+2 для H.264/HEVC, ×3,2 для AV1). Ранее размер файла отклонялся на 45–340 %.
- При сбое аппаратного кодирования задача один раз повторяется на CPU. У VP9 нет аппаратной реализации, он всегда идёт через CPU.
- При аппаратном кодировании параллелизм ограничен двумя потоками, а предварительная оценка размера учитывает выбранный кодек.
- На тестовом материале 1080p30 H.265 ускорился примерно с 28 с и около 10 ядер до примерно 3 с и менее одного ядра при разнице PSNR до 0,12 дБ.

### 1.0.2

- Добавлено распознавание HDR: в списке задач появляется янтарная метка HDR10 / HLG / Dolby Vision / HDR10+.
- Метаданные цвета переносятся при перекодировании, поэтому HDR-источник больше не выдаётся как SDR.
- Добавлена метка «уже сжато», записываемая в результат. При повторной загрузке файла показывается количество сжатий и дата. Отключается в настройках. AVI и TS не хранят произвольные метаданные, для них ничего не записывается.
- В сводке указывается, сколько файлов в очереди уже были сжаты этим плагином.
- Исправлено: выбор H.264 для HDR-источника незаметно уничтожал информацию HDR; теперь об этом предупреждает сводка.

### 1.0.1

- Исправлено: вывод H.265 не воспроизводился в Finder, Быстром просмотре и QuickTime на macOS (теперь применяется тег `hvc1`).
- Исправлено: замена исходного файла выполняется через промежуточный файл и атомарное переименование, поэтому отмена или ошибка ввода-вывода больше не оставляют повреждённый оригинал.
- Исправлено: синхронное исключение из API выбора Eagle выходило за пределы обработчика.
- Исправлено: запоздавший обратный вызов выбора мог снова открыть уже закрытый диалог.
- Добавлено: видимая кнопка **Остановить и отменить** во время сжатия.
- Добавлено: выбор из трёх вариантов при повторном открытии плагина с новым выделением в Eagle — отменить, заменить очередь или добавить.
- Добавлено: элементы можно добавлять в уже выполняющуюся очередь, их подхватывают свободные обработчики.
- Добавлено: индикация хода выборочной оценки с кнопками **Анализировать все** и **Остановить анализ**.
- Улучшено: число параллельных процессов рассчитывается по ядрам ЦП, кодеку и режиму двух проходов, для каждого кодека задан предел потоков.
- Улучшено: временный файл по возможности пишется рядом с источником, что избавляет от лишней полной копии на внешних и сетевых томах.

### 1.0.0

- Первый выпуск: пакетное сжатие, несколько кодеков и режимов сжатия, оценка размера, резервное копирование и замена, диагностический журнал.

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
- 支持 GPU 硬件编码（NVIDIA NVENC / Intel QSV / AMD AMF），默认自动选择，检测不到可用硬件时回退 CPU 软件编码。
- 备份默认关闭，必须先指定备份目录才能开启；不开备份就没有原文件副本。
- 设置持久化保存，界面跟随 Eagle 主题，支持八种语言。

### 使用说明

**使用前准备**

本插件需要可用的 FFmpeg 和 ffprobe，两者缺一不可：

- 推荐在 Eagle 中安装「FFmpeg」依赖插件，本插件会自动使用它。
- 也可以自行在系统里安装 FFmpeg（自带 ffprobe），插件会回退到本机安装的版本。
- 两者都找不到时插件无法压缩：状态栏会提示 FFmpeg 不可用，并自动展开运行日志，可点「复制诊断信息」查看具体的查找路径。

目前在 macOS 上完成验证。

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

- 支持 NVIDIA NVENC、Intel Quick Sync Video 与 AMD AMF。硬件编码通常快 3~5 倍并大幅降低 CPU 占用，同码率画质与软件编码基本持平。
- VP9 没有对应的硬件实现，固定走 CPU。
- 硬件编码失败会自动回退 CPU 重跑一次，不会直接把任务判为失败。
- macOS 上若三家硬件编码器都不可用，会自动回退软件编码，属于预期行为。

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

### 1.1.2

- 修复：压缩进行中把新素材加入队列时，它们会立即开始压缩并覆盖原文件，而提示只列了数量和文件名。现在会单独弹出确认框，列出新增文件、说明会立即压缩并替换原路径上的文件，并给出本次的实际备份状态；未开启备份时明确提示原件无法恢复。
- 修复：开始压缩前的覆盖、备份与不可恢复警告是硬编码的简体中文，其他语言界面看不到。现在全部改用语系资源，八个语系都有完整翻译。
- 修复：文案让人以为只有开启「同步回 Eagle 素材库」才会替换原素材。无论是否勾选，原路径上的文件都会被替换；该选项只决定是否通过 Eagle 的替换接口更新关联素材与缩略图。界面与文档都已改正。
- 改进：安装包改用白名单打包，只包含运行程序、样式、图标、语系与许可证。
- 改进：插件中心的名称与描述有了统一来源，并在提交前校验各语系的字数上限。
- 改进：使用说明新增「使用前准备」，写明需要可用的 FFmpeg 与 ffprobe，以及两者都找不到时的表现。
- 修复：操作栏的「开始压缩」「停止并取消」会在汇总数字算出来时左右跳一下。窄窗口下按钮会折到第二行，而顶开它们的占位元素留在第一行，按钮就贴到了左边。现在按钮自己靠右，与是否换行无关。
- 改进：日志面板顶部同时显示设置文件与日志文件的完整路径，使用说明新增「数据保留与清理」，写明卸载后残留的文件位置与手动清除方式。

### 1.1.1

- 修复：多音轨素材压缩后只剩一条音轨，现在所有音轨都会原样保留。
- 修复：压缩后体积反而变大时仍会覆盖原文件，现在会跳过并保留原件。
- 修复：取消任务可能留下损坏的半截文件，现在先请求正常退出，再强制结束。
- 修复：压缩过程中产生的临时文件会被 Eagle 当成新素材扫进素材库。
- 改进：批量导入大量素材不再卡顿，100 个文件的界面处理量降到原来的约 1/144。
- 改进：读取素材信息的速度提升约 3 倍，25 个文件从 1.3 秒缩短到 0.45 秒。
- 改进：VP9 编码启用多线程分块，1080p 素材实测提速约 2.2 倍。
- 改进：替换原文件改为直接重命名，1GB 文件的写入耗时从约 1 秒降到几乎为零。
- 改进：多任务同时压缩时按整机预算分配线程，CPU 总占用降低约 6%~9%。
- 新增：24 核及以上的机器上，并发数可选到 6 或 8。

### 1.1.0

- 新增 GPU 硬件编码：支持 NVIDIA NVENC / Intel QSV / AMD AMF，「硬件加速」下拉可选自动、强制 GPU、仅 CPU，默认自动并回填检测到的显卡名。
- 修正画质档位换算：CRF 与硬件 QP 不是同一刻度，现在按 H.264/HEVC +2、AV1 ×3.2 换算，不再出现体积偏离 45%~+340%。
- 硬件编码失败会自动回退 CPU 重跑一次；VP9 无硬件实现，固定走 CPU。
- 硬件编码时并发收敛到 2 路，压缩前的体积预估也按所选编码器给出。
- 实测 1080p30 素材，H.265 从约 28 秒、约 10 核占用降到约 3 秒、不足 1 核，画质差距在 0.12 dB 以内。

### 1.0.2

- 新增 HDR 素材识别，在任务列表中用琥珀色角标标注 HDR10 / HLG / Dolby Vision / HDR10+。
- 重编码时携带色彩元数据，HDR 素材不再被错误输出成 SDR。
- 新增「已压缩」标记：压缩后写入文件，再次导入时显示压缩次数与日期，可在设置中关闭。AVI 与 TS 容器无法存储自定义元数据，这两种格式不写标记。
- 队列中存在已压缩文件时，汇总栏给出提示。
- 修复：对 HDR 素材选用 H.264 会不可逆地丢失 HDR 信息，现在会在汇总栏给出警告。

### 1.0.1

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

### 1.0.0

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
- 支援 GPU 硬體編碼（NVIDIA NVENC / Intel QSV / AMD AMF），預設自動選擇，偵測不到可用硬體時回退 CPU 軟體編碼。
- 備份預設關閉，必須先指定備份資料夾才能啟用；不開備份就沒有原檔副本。
- 設定會持久保存，介面跟隨 Eagle 佈景主題，支援八種語言。

### 使用说明

**使用前準備**

本外掛需要可用的 FFmpeg 與 ffprobe，兩者缺一不可：

- 建議在 Eagle 中安裝「FFmpeg」相依套件，本外掛會自動使用它。
- 也可以自行在系統中安裝 FFmpeg（內含 ffprobe），外掛會改用本機安裝的版本。
- 兩者都找不到時外掛無法壓縮：狀態列會提示 FFmpeg 不可用，並自動展開執行日誌，可點「複製診斷資訊」查看實際的搜尋路徑。

目前已在 macOS 上完成驗證。

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

- 支援 NVIDIA NVENC、Intel Quick Sync Video 與 AMD AMF。硬體編碼通常快 3~5 倍並大幅降低 CPU 佔用，同位元率畫質與軟體編碼基本持平。
- VP9 沒有對應的硬體實作，固定走 CPU。
- 硬體編碼失敗會自動回退 CPU 重跑一次，不會直接把工作判為失敗。
- macOS 上若三家硬體編碼器都不可用，會自動回退軟體編碼，屬於預期行為。

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

### 1.1.2

- 修正：壓縮進行中將新素材加入佇列時，它們會立即開始壓縮並覆蓋原檔案，而提示只列出數量與檔案名稱。現在會單獨彈出確認視窗，列出新增檔案、說明會立即壓縮並取代原路徑上的檔案，並給出本次的實際備份狀態；未開啟備份時明確提示原檔無法復原。
- 修正：開始壓縮前的覆蓋、備份與無法復原警告是寫死的簡體中文，其他語言介面看不到。現在全部改用語系資源，八個語系都有完整翻譯。
- 修正：文案讓人以為只有開啟「同步回 Eagle 素材庫」才會取代原素材。無論是否勾選，原路徑上的檔案都會被取代；該選項只決定是否透過 Eagle 的取代介面更新關聯素材與縮圖。介面與文件都已修正。
- 改進：安裝包改用白名單打包，只包含執行程式、樣式、圖示、語系與授權條款。
- 改進：外掛中心的名稱與描述有了統一來源，並在提交前檢查各語系的字數上限。
- 改進：使用說明新增「使用前準備」，寫明需要可用的 FFmpeg 與 ffprobe，以及兩者都找不到時的行為。
- 修正：操作列的「開始壓縮」「停止並取消」會在彙總數字算出來時左右跳一下。視窗較窄時按鈕會折到第二行，而頂開它們的佔位元素留在第一行，按鈕就貼到了左邊。現在按鈕自己靠右，與是否換行無關。
- 改進：記錄面板頂部同時顯示設定檔與記錄檔的完整路徑，使用說明新增「資料保留與清理」，寫明解除安裝後殘留的檔案位置與手動清除方式。

### 1.1.1

- 修復：多音軌素材壓縮後只剩一條音軌，現在所有音軌都會原樣保留。
- 修復：壓縮後體積反而變大時仍會覆蓋原檔，現在會跳過並保留原件。
- 修復：取消任務可能留下損壞的半截檔案，現在先請求正常結束，再強制終止。
- 修復：壓縮過程中產生的暫存檔會被 Eagle 當成新素材掃進素材庫。
- 改進：批次匯入大量素材不再卡頓，100 個檔案的介面處理量降到原來的約 1/144。
- 改進：讀取素材資訊的速度提升約 3 倍，25 個檔案從 1.3 秒縮短到 0.45 秒。
- 改進：VP9 編碼啟用多執行緒分塊，1080p 素材實測提速約 2.2 倍。
- 改進：替換原檔改為直接重新命名，1GB 檔案的寫入耗時從約 1 秒降到幾乎為零。
- 改進：多任務同時壓縮時按整機預算分配執行緒，CPU 總佔用降低約 6%~9%。
- 新增：24 核心及以上的機器上，並行數可選到 6 或 8。

### 1.1.0

- 新增 GPU 硬體編碼：支援 NVIDIA NVENC / Intel QSV / AMD AMF，「硬體加速」下拉可選自動、強制 GPU、僅 CPU，預設自動並回填偵測到的顯示卡名稱。
- 修正畫質檔位換算：CRF 與硬體 QP 不是同一刻度，現在按 H.264/HEVC +2、AV1 ×3.2 換算，不再出現體積偏離 45%~+340%。
- 硬體編碼失敗會自動退回 CPU 重跑一次；VP9 無硬體實作，固定走 CPU。
- 硬體編碼時併發收斂到 2 路，壓縮前的體積預估也按所選編碼器給出。
- 實測 1080p30 素材，H.265 從約 28 秒、約 10 核佔用降到約 3 秒、不足 1 核，畫質差距在 0.12 dB 以內。

### 1.0.2

- 新增 HDR 素材辨識，在工作清單中以琥珀色標籤標註 HDR10 / HLG / Dolby Vision / HDR10+。
- 重新編碼時帶上色彩中繼資料，HDR 素材不再被錯誤輸出成 SDR。
- 新增「已壓縮」標記：壓縮後寫入檔案，再次匯入時顯示壓縮次數與日期，可於設定中關閉。AVI 與 TS 容器無法儲存自訂中繼資料，這兩種格式不寫入標記。
- 佇列中存在已壓縮檔案時，摘要列會提出提示。
- 修正：對 HDR 素材選用 H.264 會不可逆地失去 HDR 資訊，現在會在摘要列提出警告。

### 1.0.1

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

### 1.0.0

- 首個發行版本：批次壓縮、多種編碼格式與壓縮方式、體積預估、備份與取代、日誌診斷。
