# Video-Analyse-App

Lokale Videoanalyse-App für öffentliche YouTube-Videos. Die öffentliche Variante läuft als einzelner Docker-Container und verwendet ein fertiges Image aus der GitHub Container Registry.


> **Kurz erklärt:** Diese Webapp nimmt einen öffentlichen YouTube-Link entgegen und macht daraus eine strukturierte Videoanalyse mit Transkript, relevanten Zeitstempeln, Videometadaten und echten Original-Screenshots. So lassen sich lange Videos schneller verstehen, wichtige Stellen gezielt wiederfinden und die Ergebnisse für Recherche, Dokumentation oder Automatisierungen weiterverwenden.

Lokale Videoanalyse-App für öffentliche YouTube-Videos. Die Anwendung läuft als einzelner Docker-Container und speichert Jobs, Ergebnisse, Konfiguration und den lokalen Gemini-SecretStore im gemounteten Datenordner.

## Was macht die Anwendung?

Die Anwendung verwandelt ein öffentlich erreichbares YouTube-Video in eine nachvollziehbare Sammlung aus Analyseergebnissen und Originalmaterial. Ein typischer Ablauf sieht so aus:

1. **Video starten:** In der Weboberfläche wird ein öffentlicher YouTube-Link als neuer Analyse-Job eingegeben.
2. **Inhalt analysieren:** Das Video wird in Abschnitte aufgeteilt und mit Gemini ausgewertet. Dabei werden unter anderem Inhalt, Szenen und relevante Stellen erfasst.
3. **Transkript und Zeitstempel erzeugen:** Gesprochener Inhalt wird – sofern vorhanden – als Transkript gespeichert. Wichtige Szenen werden mit Zeitstempeln und Beschreibungen versehen.
4. **Bilder aus dem Originalvideo sichern:** Zu den erkannten Stellen extrahiert die App echte Einzelbilder aus dem Video. Die Screenshots werden nicht künstlich erzeugt, sondern stammen direkt aus der YouTube-Quelle.
5. **Ergebnisse bereitstellen:** In der Weboberfläche und im Ausgabeordner stehen anschließend unter anderem Transkriptdateien, JSON-/Manifestdaten, Videometadaten, Zeitstempel und PNG-Screenshots zur Verfügung. Die Ergebnisse können außerdem über die REST-API oder n8n weiterverarbeitet werden.

### Wofür ist das nützlich?

Die App hilft dabei, lange Videos nicht vollständig manuell durchsuchen zu müssen. Sie eignet sich beispielsweise für die Recherche in Vorträgen und Interviews, die Dokumentation von Videoinhalten, das Wiederfinden bestimmter Szenen sowie die automatisierte Weiterverarbeitung von Transkripten, Zeitstempeln und Bildern.


## Schnellstart per Release-ZIP

1. Docker Desktop installieren und starten.
2. Das aktuelle ZIP aus den [GitHub Releases](https://github.com/Candy-S99/Video-Analyse-App-Public/releases) herunterladen.
3. Das ZIP in einen eigenen Ordner entpacken.
4. `Start.cmd` doppelklicken.
5. Die Anwendung unter [http://localhost:3006](http://localhost:3006) öffnen.

`Start.cmd` lädt das stabile GHCR-Image automatisch und startet den Container. Für echte Analysen muss anschließend unter `Einstellungen` ein eigener Gemini API Key hinterlegt werden.

## Alternative: öffentlicher Repository-Clone

Ablauf für Entwickler und technische Nutzer verfügbar:

```powershell
git clone "https://github.com/Candy-S99/Video-Analyse-App-Public.git"
Set-Location Video-Analyse-App-Public
docker compose -f compose.yaml up -d
```

Für lokale Quellcodeänderungen wird der Entwicklungs-Override verwendet:

```powershell
docker compose -f compose.yaml -f compose.build.yaml up --build -d
```

Node.js, npm, Python und ffmpeg müssen auf dem Host nicht installiert werden.

## Start, Stop und Update

Im Release-ZIP stehen folgende Skripte zur Verfügung: (Scripte cmd müssen ggf. per Adminrechte ausgeführt werden falls die normale Ausführung nicht erlaubt wird)

- `Start.cmd`: Image laden, Container starten und Browser öffnen.
- `Stop.cmd`: Container stoppen; Daten bleiben erhalten.
- `Update.cmd`: aktuelles Image laden, Container neu erstellen und Browser öffnen.

Alternativ können dieselben Aktionen direkt mit Compose ausgeführt werden:

```powershell
docker compose -f compose.yaml restart
docker compose -f compose.yaml down
docker compose -f compose.yaml pull
docker compose -f compose.yaml up -d
```

`docker compose down` entfernt nicht das Volume `video-analysis-data`. Der kontrollierte Shutdown über die Weboberfläche beendet den Container ohne automatischen Neustart.

## Gemini API Key

Der Key ist für eine Analyse erforderlich, aber nicht für den Containerstart.

Der empfohlene Weg ist die Weboberfläche:

1. Anwendung öffnen.
2. `Einstellungen` öffnen.
3. Gemini API Key eingeben.
4. `API Key speichern` auswählen.

Der Key wird serverseitig im Docker-Volume gespeichert und niemals vollständig zurückgegeben. Alternativ kann `GEMINI_API_KEY` beim Start über eine lokale `.env` gesetzt werden.

Für lokale Automatisierung stehen dieselben Aktionen als API zur Verfügung:

```powershell
$body = @{ api_key = "dein-eigener-gemini-api-key" } | ConvertTo-Json
Invoke-RestMethod -Method Put `
  -Uri "http://localhost:3006/api/v1/video-analysis/config/gemini-api-key" `
  -ContentType "application/json" `
  -Body $body

Invoke-RestMethod -Method Delete `
  -Uri "http://localhost:3006/api/v1/video-analysis/config/gemini-api-key"
```

## Betrieb prüfen

```powershell
Invoke-RestMethod http://localhost:3006/health
Invoke-RestMethod http://localhost:3006/ready
docker compose -f compose.yaml ps
docker compose -f compose.yaml logs --tail=100 video-analysis-app
```

`/health` muss `status: ok` und `/ready` muss `status: ready` liefern.

## Persistente Daten

Die Anwendung verwendet zwei Speicherbereiche:

- `./output/`: vollständiger, sichtbarer Analyse-Output für den Benutzer.
- Docker-Volume `video-analysis-data`: SecretStore, normale Konfiguration, Ereignislogs und technische Jobdaten.

Der kanonische Output liegt ausschließlich unter `output/`. Retention-Bereinigung und Löschaktionen der App wirken daher direkt auf diesen Ordner.

Die normale App-Konfiguration wird unter `/data/jobs/.video-analysis-config.json` gespeichert. Änderungen an Modell, Segmentlänge, Transkription und Screenshot-Einstellungen bleiben nach Neustarts erhalten.
Für einen abgeschlossenen Job kann in der Jobliste `Output öffnen` ausgewählt werden. Der Browser-Viewer listet die Dateien aus dem kanonischen Jobordner auf und stellt unterstützte Text- und Bilddateien als Vorschau sowie andere Dateien als Download bereit. Der Viewer funktioniert unabhängig davon, ob Windows oder ein anderes Betriebssystem verwendet wird.
Ein Klick auf eine Dateizeile öffnet die Vorschau und markiert die Datei. Über die Checkboxen und die Toolbar können mehrere Dateien ausgewählt und als ein ZIP-Archiv heruntergeladen werden. Einzel- und Sammeldownloads öffnen nach Möglichkeit den nativen Speichern-unter-Dialog; ohne diese Browser-API wird der normale Browser-Download verwendet.

## Konfiguration

Eine `.env`-Datei ist beim Standardstart nicht erforderlich. Für fortgeschrittene Installationen können folgende Variablen gesetzt werden:

| Variable | Standard | Bedeutung |
|---|---:|---|
| `GEMINI_API_KEY` | leer | Initialer Gemini-Key |
| `GEMINI_MODEL` | App-Standard | Startwert für das Gemini-Modell |
| `SEGMENT_LENGTH` | `30` | Segmentlänge in Sekunden |
| `EXTRACT_TRANSCRIPT` | `true` | Legacy-Standard für Aufrufe ohne `output_mode` (`true` = `both`, `false` = `screenshots`) |
| `APP_PORT` | `3006` | Lokaler Host-Port |
| `APP_IMAGE_TAG` | `stable` | Image-Version oder Rollback-Tag |

Für einen reproduzierbaren Stand:

```powershell
$env:APP_IMAGE_TAG = 'v0.1.0'
docker compose -f compose.yaml pull
docker compose -f compose.yaml up -d
```

## Fehlerbehebung

- **Docker nicht gefunden:** Docker Desktop installieren und starten.
- **Port belegt:** In `.env` `APP_PORT` auf einen freien Port setzen; bei Verwendung der Skripte den Browser anschließend über diesen Port öffnen.
- **Container startet nicht:** `docker compose -f compose.yaml logs --tail=100 video-analysis-app` prüfen.
- **Analyse verweigert:** Gemini-Key über `Einstellungen` hinterlegen.
- **Image- oder Pull-Fehler:** Docker-Daemon und Internetzugriff prüfen; anschließend `Update.cmd` erneut ausführen.
- **YouTube-Fehler:** Nur öffentliche, ohne Login erreichbare Videos verwenden.

## Sicherheit

Die Weboberfläche bindet standardmäßig nur an `127.0.0.1`. Die App besitzt keine Benutzeranmeldung und ist nicht für eine direkte öffentliche Internetfreigabe vorgesehen.

## Hinweise zu bestehenden Installationen

Der Release-ZIP-Weg ist für neue Installationen vorgesehen. Alte Installationen mit `./data/jobs:/data/jobs` und `external-output` werden nicht automatisch migriert. Vor einem Wechsel müssen vorhandene Daten manuell gesichert werden.

Weitere Informationen stehen in [output/README.md](output/README.md), [docs/operations/app-lifecycle.md](docs/operations/app-lifecycle.md) und [docs/integrations/api-automation.md](docs/integrations/api-automation.md).

## Lizenz

Der Quellcode steht unter der MIT-Lizenz. Die Anwendung darf weiterhin nur mit öffentlichen, ohne Login erreichbaren Videoquellen verwendet werden.
