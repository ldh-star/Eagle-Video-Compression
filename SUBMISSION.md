# 视频压缩 · 各语言提交文案

> 由 `docs/<语系>.md` 自动生成，对应版本 **1.1.0**。
> 每个语系三节：简述 / 使用说明 / 版本日志，可直接复制到 Eagle 插件中心对应语系的字段。
> 内容改动请改 `docs/` 下的源文件后重跑 `node tools/gen-submission.js`，不要直接改本文件。

---

## Deutsch（de_DE）

### 简述

Ein lokales Plugin für die Stapelkomprimierung von Videos in Eagle. Es lädt die aktuell ausgewählten Videos automatisch, kodiert sie mit FFmpeg neu und kann das ursprüngliche Eagle-Element nach erfolgreicher Komprimierung ersetzen.

- Die gesamte Verarbeitung erfolgt lokal. Es werden weder Videodateien hochgeladen noch Metadaten an einen Server gesendet.
- Standardausgabe ist H.265/HEVC; H.264, AV1, VP9 und reines Remuxen stehen ebenfalls zur Verfügung.
- Drei Komprimierungsmodi: Qualität zuerst (CRF), Zielbitrate und Zieldateigröße (H.264/H.265 mit Two-Pass-Kodierung).
- Die Größenschätzung im CRF-Modus beruht auf echten Stichproben-Kodierungen. Angezeigt wird deshalb ein Bereich statt eines irreführenden exakten Werts.
- Einstellbar sind Auflösung, Bildrate, Audio, Kodiergeschwindigkeit, Parallelität und der Umgang mit 10-Bit-Quellen.
- HDR-Quellen werden erkannt, und die Farbmetadaten bleiben beim Neukodieren erhalten. Bereits komprimierte Dateien werden markiert, damit kein zweiter verlustbehafteter Durchgang aus Versehen passiert.
- Optionale GPU-Hardwarekodierung (NVIDIA NVENC, Intel Quick Sync, AMD AMF), die bei vorhandener geeigneter Hardware automatisch genutzt wird und sonst auf die CPU-Softwarekodierung zurückfällt.
- Die Sicherung ist standardmäßig deaktiviert und lässt sich erst nach Auswahl eines Sicherungsordners einschalten.
- Einstellungen bleiben erhalten, die Oberfläche folgt dem Eagle-Design, acht Sprachen werden unterstützt.

### 使用说明

**Voraussetzungen**: Eagle mit verfügbarer FFmpeg-Abhängigkeit. Ist sie nicht erreichbar, wird auf eine lokale FFmpeg-/FFprobe-Installation zurückgegriffen. Verifizierte Plattform ist derzeit macOS.

**Grundlegender Ablauf**

1. Wählen Sie in Eagle ein oder mehrere Videos aus.
2. Öffnen Sie **Video komprimieren**. Die ausgewählten Videos werden automatisch in die Aufgabenliste übernommen.
3. Wählen Sie Codec und Komprimierungsmodus. Voreinstellung ist H.265 mit CRF 28.
4. Prüfen Sie Originalgröße, geschätzte Ausgabegröße und die Zusammenfassung der Speicheränderung.
5. Wenn Sie die Originaldatei behalten möchten, wählen Sie zuerst einen Sicherungsordner und aktivieren Sie dann die Sicherung.
6. Klicken Sie auf **Komprimierung starten** und bestätigen Sie.

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
- Das Ersetzen der Originaldatei ist verlustbehaftet und nicht umkehrbar. Bewahren Sie von unersetzlichem Material stets eine eigene Kopie auf.

### 版本日志

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

A local batch video compression plugin for Eagle. It picks up the videos you have selected, re-encodes them with FFmpeg, and can replace the original Eagle item once compression succeeds.

- Everything runs locally. Video files are never uploaded and no video metadata is sent to any server.
- H.265/HEVC by default, with H.264, AV1, VP9, and remux-only options.
- Three compression modes: quality first (CRF), target bitrate, and target file size (two-pass for H.264/H.265).
- CRF size estimates come from real stratified sample encodes, so the UI shows a range instead of a misleading exact number.
- Controls for resolution, frame rate, audio, encoding speed, concurrency, and 10-bit source handling.
- HDR sources are detected and their colour metadata is carried through re-encoding; already-compressed files are marked so you do not run a second lossy pass by accident.
- Optional GPU hardware encoding (NVIDIA NVENC, Intel Quick Sync, AMD AMF), used automatically when suitable hardware is present and falling back to CPU software encoding otherwise.
- Backup is off by default and cannot be enabled until you pick a backup folder.
- Settings persist, the UI follows Eagle's theme, and eight languages are available.

### 使用说明

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
- Replacing the original file is lossy and irreversible. Keep an independent copy of irreplaceable media.

### 版本日志

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

Un complemento de transcodificación local para comprimir vídeos por lotes en Eagle. Carga automáticamente los vídeos seleccionados, los vuelve a codificar con FFmpeg y, si lo deseas, sustituye el elemento original de Eagle al terminar.

- Todo el procesamiento ocurre localmente. No se suben archivos de vídeo ni se envían metadatos a ningún servidor.
- Salida H.265/HEVC por defecto, con opciones H.264, AV1, VP9 y solo remultiplexado.
- Tres modos de compresión: calidad primero (CRF), tasa de bits objetivo y tamaño de archivo objetivo (H.264/H.265 con codificación en dos pasadas).
- La estimación de tamaño en modo CRF se basa en codificaciones de muestra reales, por lo que la interfaz muestra un intervalo en lugar de una cifra exacta engañosa.
- Controles de resolución, velocidad de fotogramas, audio, velocidad de codificación, concurrencia y tratamiento de fuentes de 10 bits.
- Detecta fuentes HDR y conserva sus metadatos de color al recodificar; marca los archivos ya comprimidos para evitar una segunda pasada con pérdida por descuido.
- Codificación por GPU opcional (NVIDIA NVENC, Intel Quick Sync, AMD AMF), que se usa automáticamente cuando hay hardware compatible y vuelve a la codificación por software en CPU en caso contrario.
- La copia de seguridad está desactivada por defecto y no puede activarse hasta elegir una carpeta de destino.
- Los ajustes se conservan, la interfaz sigue el tema de Eagle y hay ocho idiomas disponibles.

### 使用说明

**Requisitos**: Eagle con la dependencia FFmpeg disponible. Si no está accesible, se recurre a una instalación local de FFmpeg / FFprobe. La plataforma verificada actualmente es macOS.

**Flujo básico**

1. Selecciona uno o varios vídeos en Eagle.
2. Abre **Comprimir vídeo**. Los vídeos seleccionados se importan automáticamente a la lista de tareas.
3. Elige el códec y el modo de compresión. El valor predeterminado es H.265 con CRF 28.
4. Revisa el tamaño original, el tamaño de salida estimado y el resumen del cambio de almacenamiento.
5. Si quieres conservar el archivo original, elige primero una carpeta de copia de seguridad y luego activa la copia.
6. Haz clic en **Iniciar compresión** y confirma.

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
- Sustituir el archivo original implica pérdida y es irreversible. Conserva siempre una copia independiente del material irremplazable.

### 版本日志

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

Eagle 内で動画を一括圧縮するローカルトランスコードプラグインです。起動時に選択中の動画を自動で読み込み、FFmpeg で再エンコードし、完了後に Eagle 内の元アイテムを置き換えることもできます。

- すべての処理はローカルで完結します。動画ファイルはアップロードされず、メタデータも外部に送信されません。
- 既定の出力は H.265/HEVC。H.264、AV1、VP9、再多重化のみにも対応します。
- 圧縮方式は 3 種類：画質優先（CRF）、ビットレート指定、目標ファイルサイズ（H.264/H.265 は 2 パスエンコード）。
- CRF モードのサイズ推定は実際のサンプルエンコードに基づくため、誤解を招く単一の数値ではなく範囲で表示します。
- 解像度、フレームレート、音声、エンコード速度、並列数、10bit ソースの扱いを調整できます。
- HDR ソースを自動判別し、再エンコード時に色情報を保持します。圧縮済みファイルにはマーカーを書き込み、二重の劣化を防ぎます。
- GPU ハードウェアエンコード（NVIDIA NVENC / Intel QSV / AMD AMF）に対応。既定は自動で、利用可能なハードウェアがない場合は CPU ソフトウェアエンコードにフォールバックします。
- バックアップは既定でオフ。バックアップ先フォルダーを指定するまで有効にできません。
- 設定は保存され、UI は Eagle のテーマに追従し、8 言語に対応します。

### 使用说明

**動作要件**：Eagle の FFmpeg 依存モジュールが利用できること。取得できない場合はローカルの FFmpeg / FFprobe にフォールバックします。現時点で検証済みのプラットフォームは macOS です。

**基本の流れ**

1. Eagle で動画を 1 つ以上選択します。
2. 「動画圧縮」を開くと、選択した動画がタスクリストに自動で取り込まれます。
3. コーデックと圧縮方式を選びます。既定は H.265 + CRF 28 です。
4. 元のサイズ、推定出力サイズ、容量変化のサマリーを確認します。
5. 元ファイルを残したい場合は、先にバックアップ先フォルダーを指定してからバックアップを有効にします。
6. 「圧縮を開始」をクリックして確認します。

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
- 元ファイルの置き換えは不可逆かつ非可逆圧縮です。かけがえのない素材は必ず別途バックアップしてください。

### 版本日志

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

Eagle에서 동영상을 일괄 압축하는 로컬 트랜스코딩 플러그인입니다. 실행하면 현재 선택된 동영상을 자동으로 불러와 FFmpeg으로 다시 인코딩하고, 완료 후 Eagle의 원본 항목을 대체할 수도 있습니다.

- 모든 처리는 로컬에서 이루어집니다. 동영상 파일을 업로드하지 않으며 메타데이터도 외부로 전송하지 않습니다.
- 기본 출력은 H.265/HEVC이며 H.264, AV1, VP9, 리먹스 전용도 지원합니다.
- 압축 방식 세 가지: 화질 우선(CRF), 비트레이트 지정, 목표 파일 크기(H.264/H.265는 2패스 인코딩).
- CRF 모드의 용량 예측은 실제 샘플 인코딩을 기반으로 하므로, 오해를 부르는 정확한 수치 대신 범위를 표시합니다.
- 해상도, 프레임 레이트, 오디오, 인코딩 속도, 동시 실행 수, 10비트 소스 처리 방식을 조절할 수 있습니다.
- HDR 소스를 자동으로 감지하고 재인코딩 시 색상 메타데이터를 보존합니다. 이미 압축된 파일에는 표식을 남겨 중복 손실 압축을 방지합니다.
- GPU 하드웨어 인코딩(NVIDIA NVENC / Intel QSV / AMD AMF)을 지원하며 기본값은 자동, 사용할 수 있는 하드웨어가 없으면 CPU 소프트웨어 인코딩으로 대체합니다.
- 백업은 기본적으로 꺼져 있으며, 백업 폴더를 지정해야 활성화할 수 있습니다.
- 설정이 유지되고, UI는 Eagle 테마를 따르며, 8개 언어를 지원합니다.

### 使用说明

**실행 요건**: Eagle에 FFmpeg 종속 모듈이 설치되어 있어야 합니다. 사용할 수 없으면 로컬에 설치된 FFmpeg / FFprobe로 대체합니다. 현재 검증된 플랫폼은 macOS입니다.

**기본 흐름**

1. Eagle에서 동영상을 하나 이상 선택합니다.
2. **동영상 압축**을 엽니다. 선택한 동영상이 작업 목록에 자동으로 추가됩니다.
3. 코덱과 압축 방식을 선택합니다. 기본값은 H.265 + CRF 28입니다.
4. 원본 크기, 예상 출력 크기, 저장 공간 변화 요약을 확인합니다.
5. 원본 파일을 남기려면 먼저 백업 폴더를 지정한 다음 백업을 활성화합니다.
6. **압축 시작**을 클릭하고 확인합니다.

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
- 원본 파일 대체는 손실이 있으며 되돌릴 수 없습니다. 중요한 자료는 별도로 백업해 두세요.

### 版本日志

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

Плагин для локального пакетного сжатия видео в Eagle. Он автоматически загружает выбранные видео, перекодирует их с помощью FFmpeg и при желании заменяет исходный элемент в Eagle после успешного сжатия.

- Вся обработка выполняется локально. Видеофайлы не загружаются в сеть, метаданные никуда не отправляются.
- По умолчанию выводится H.265/HEVC; доступны также H.264, AV1, VP9 и режим только перепаковки.
- Три режима сжатия: качество прежде всего (CRF), целевой битрейт и целевой размер файла (для H.264/H.265 используется двухпроходное кодирование).
- Оценка размера в режиме CRF строится на реальных пробных кодированиях, поэтому интерфейс показывает диапазон, а не обманчиво точное число.
- Настраиваются разрешение, частота кадров, звук, скорость кодирования, параллельность и обработка 10-битных источников.
- HDR-источники распознаются, а метаданные цвета сохраняются при перекодировании. Уже сжатые файлы помечаются, чтобы случайно не выполнить второй проход с потерями.
- Опциональное аппаратное кодирование на GPU (NVIDIA NVENC, Intel Quick Sync, AMD AMF): применяется автоматически при наличии подходящего оборудования, иначе используется программное кодирование на CPU.
- Резервное копирование выключено по умолчанию и включается только после выбора папки для копий.
- Настройки сохраняются, интерфейс следует теме Eagle, поддерживаются восемь языков.

### 使用说明

**Требования**: Eagle с доступным модулем FFmpeg. Если он недоступен, используется локально установленный FFmpeg / FFprobe. На данный момент проверена работа на macOS.

**Основной порядок работы**

1. Выберите в Eagle одно или несколько видео.
2. Откройте **Сжатие видео**. Выбранные видео автоматически попадут в список задач.
3. Выберите кодек и режим сжатия. По умолчанию — H.265 с CRF 28.
4. Проверьте исходный размер, ожидаемый размер результата и сводку изменения занимаемого места.
5. Если нужно сохранить оригинал, сначала укажите папку для резервных копий, затем включите резервное копирование.
6. Нажмите **Начать сжатие** и подтвердите.

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
- Замена исходного файла происходит с потерями и необратима. Всегда держите отдельную копию незаменимых материалов.

### 版本日志

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

在 Eagle 中批量压缩视频的本地转码插件。打开插件后会自动读取当前选中的视频，用 FFmpeg 重新编码，压缩完成后可以选择替换 Eagle 中的原素材。

- 所有处理都在本机完成，不上传视频文件，也不把视频元数据发往任何服务器。
- 默认输出 H.265/HEVC，同时支持 H.264、AV1、VP9 与仅重封装。
- 三种压缩方式：画质优先（CRF）、指定码率、目标文件大小（H.264/H.265 走两遍编码）。
- CRF 模式的体积预估基于真实的分段抽样试压，界面给出的是区间而不是一个会骗人的精确值。
- 可调分辨率、帧率、音轨、编码速度、并发数与 10bit 素材的处理方式。
- 自动识别 HDR 素材并在重编码时保留色彩元数据；对已经压过的文件会打标记，避免重复有损压缩。
- 支持 GPU 硬件编码（NVIDIA NVENC / Intel QSV / AMD AMF），默认自动选择，检测不到可用硬件时回退 CPU 软件编码。
- 备份默认关闭，必须先指定备份目录才能开启。
- 设置持久化保存，界面跟随 Eagle 主题，支持八种语言。

### 使用说明

**运行要求**：Eagle 已安装 FFmpeg 依赖；取不到时会回退使用本机安装的 FFmpeg / FFprobe。目前在 macOS 上完成验证。

**基本流程**

1. 在 Eagle 中选中一个或多个视频。
2. 打开「视频压缩」，选中的视频会自动导入任务列表。
3. 选择编码格式与压缩方式，默认是 H.265 + CRF 28。
4. 核对原始体积、预计输出体积和空间变化汇总。
5. 需要保留原文件时，先指定备份目录，再打开备份开关。
6. 点击「开始压缩」并确认。

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
- 选择替换原文件是有损且不可逆的。重要素材请自行保留独立备份。

### 版本日志

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

在 Eagle 中批次壓縮影片的本機轉檔外掛。開啟後會自動讀取目前選取的影片，以 FFmpeg 重新編碼，壓縮完成後可以選擇取代 Eagle 中的原素材。

- 所有處理都在本機完成，不會上傳影片檔案，也不會把影片中繼資料送往任何伺服器。
- 預設輸出 H.265/HEVC，同時支援 H.264、AV1、VP9 與僅重新封裝。
- 三種壓縮方式：畫質優先（CRF）、指定位元率、目標檔案大小（H.264/H.265 採兩階段編碼）。
- CRF 模式的體積預估以實際的分段取樣試壓為準，介面顯示的是區間而非會誤導人的精確值。
- 可調整解析度、影格率、音軌、編碼速度、並行數以及 10bit 素材的處理方式。
- 自動辨識 HDR 素材並在重新編碼時保留色彩中繼資料；對已壓縮過的檔案會寫入標記，避免重複有損壓縮。
- 支援 GPU 硬體編碼（NVIDIA NVENC / Intel QSV / AMD AMF），預設自動選擇，偵測不到可用硬體時回退 CPU 軟體編碼。
- 備份預設關閉，必須先指定備份資料夾才能啟用。
- 設定會持久保存，介面跟隨 Eagle 佈景主題，支援八種語言。

### 使用说明

**執行需求**：Eagle 已安裝 FFmpeg 相依套件；取不到時會改用本機安裝的 FFmpeg / FFprobe。目前已在 macOS 上完成驗證。

**基本流程**

1. 在 Eagle 中選取一個或多個影片。
2. 開啟「影片壓縮」，選取的影片會自動匯入工作清單。
3. 選擇編碼格式與壓縮方式，預設為 H.265 + CRF 28。
4. 核對原始體積、預估輸出體積與空間變化摘要。
5. 需要保留原檔時，先指定備份資料夾，再開啟備份開關。
6. 點擊「開始壓縮」並確認。

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
- 選擇取代原檔是有損且不可逆的。重要素材請自行保留獨立備份。

### 版本日志

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
