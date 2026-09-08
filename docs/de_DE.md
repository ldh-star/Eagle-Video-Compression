# Video komprimieren · Video Compress for Eagle

<!-- section:overview -->
## Kurzbeschreibung

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

<!-- section:usage -->
## Bedienung

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

<!-- section:changelog -->
## Versionsverlauf

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
