# Video komprimieren · Video Compress for Eagle

<!-- section:overview -->
## Kurzbeschreibung

Ein lokales Plugin für die Stapelkomprimierung von Videos in Eagle. Es lädt die aktuell ausgewählten Videos automatisch, kodiert sie mit FFmpeg neu und kann das ursprüngliche Eagle-Element nach erfolgreicher Komprimierung ersetzen.

- Die gesamte Verarbeitung erfolgt lokal. Es werden weder Videodateien hochgeladen noch Metadaten an einen Server gesendet.
- Standardausgabe ist H.265/HEVC; H.264, AV1, VP9 und reines Remuxen stehen ebenfalls zur Verfügung.
- Drei Komprimierungsmodi: Qualität zuerst (CRF), Zielbitrate und Zieldateigröße (H.264/H.265 mit Two-Pass-Kodierung).
- Die Größenschätzung im CRF-Modus beruht auf echten Stichproben-Kodierungen. Angezeigt wird deshalb ein Bereich statt eines irreführenden exakten Werts.
- Einstellbar sind Auflösung, Bildrate, Audio, Kodiergeschwindigkeit, Parallelität und der Umgang mit 10-Bit-Quellen.
- HDR-Quellen werden erkannt, und die Farbmetadaten bleiben beim Neukodieren erhalten. Bereits komprimierte Dateien werden markiert, damit kein zweiter verlustbehafteter Durchgang aus Versehen passiert.
- Die Sicherung ist standardmäßig deaktiviert und lässt sich erst nach Auswahl eines Sicherungsordners einschalten.
- Einstellungen bleiben erhalten, die Oberfläche folgt dem Eagle-Design, acht Sprachen werden unterstützt.

<!-- section:usage -->
## Bedienung

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

**Farben der Speicheränderung**: Grün bedeutet kleiner als das Original, Rot größer, und die normale Textfarbe bedeutet nahezu unverändert oder dass der Schätzbereich die Originalgröße überschneidet.

**Weitere Hinweise**

- Während der Komprimierung können Sie jederzeit **Anhalten und abbrechen** wählen. Laufende FFmpeg-Prozesse werden beendet, noch nicht gestartete Aufgaben sofort als abgebrochen markiert, und die Originaldateien bleiben unberührt.
- Ändern Sie die Auswahl in Eagle und öffnen das Plugin erneut, fragt es nach: Vorgang abbrechen, aktuelle Warteschlange ersetzen oder anhängen. Laufende Arbeit wird nie stillschweigend verworfen.
- Das Ersetzen der Originaldatei ist verlustbehaftet und nicht umkehrbar. Bewahren Sie von unersetzlichem Material stets eine eigene Kopie auf.

<!-- section:changelog -->
## Versionsverlauf

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
