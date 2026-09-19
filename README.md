# Video-Analyse-App

Lokale Videoanalyse-App für öffentliche YouTube-Videos. Diese öffentliche Variante läuft als einzelner Docker-Container und speichert Jobs, Ergebnisse, Konfiguration und den lokalen Gemini-SecretStore im gemounteten Datenordner.

## Voraussetzungen

- Docker Desktop oder Docker Engine mit Docker Compose.
- Git für den öffentlichen Clone.
- Internetzugriff für den ersten Image-Pull, Gemini und öffentliche YouTube-Quellen.
- Node.js, npm, Python und ffmpeg müssen auf dem Host nicht installiert werden. Diese Laufzeitbestandteile befinden sich im Container.

## Schnellstart mit Docker-Image

```powershell
git clone "https://github.com/Candy-S99/Video-Analyse-App-Public.git"
Set-Location Video-Analyse-App-Public
docker compose up -d
docker compose ps
```

Das Repository ist öffentlich; für den Clone ist kein GitHub-Konto erforderlich. `docker compose up -d` lädt das versionierte Standard-Image `stable` automatisch aus der GitHub Container Registry. Für den ersten Start ist kein Gemini-Key und keine `.env`-Datei erforderlich.

Für echte Analysen muss der Betreiber anschließend den eigenen Gemini-Key über `Einstellungen` hinterlegen.

## Source-Build für Entwicklung

Der normale Schnellstart verwendet ein fertiges Image. Für lokale Änderungen am Quellcode steht der Build-Override zur Verfügung:

```powershell
docker compose -f docker-compose.yml -f docker-compose.build.yml up --build -d
```

Dieser Weg baut das Image lokal aus dem [Dockerfile](Dockerfile). Die Tests verwenden denselben Override. Für normale Installationen ist `--build` nicht erforderlich.

In `.env` kann vor dem Start ein eigener Gemini-Key eingetragen werden:

```dotenv
GEMINI_API_KEY=dein-eigener-gemini-api-key
```

Die Anwendung ist danach unter [http://localhost:3006](http://localhost:3006) erreichbar.

## Gemini-Key konfigurieren

Der Key ist für eine Analyse erforderlich, aber nicht für den Start des Containers.

### Variante A: `.env` beim ersten Start

Wenn `GEMINI_API_KEY` beim ersten Start gesetzt ist, übernimmt die App ihn einmalig in den lokalen SecretStore unter:

```text
/data/jobs/.video-analysis-secrets.json
```

Durch den Mount `./data/jobs:/data/jobs` bleibt der Key über Container-Neustarts erhalten. Der SecretStore ist von Git ausgeschlossen.

### Variante B: Einstellungen-UI

Der Container kann mit leerem `GEMINI_API_KEY` gestartet werden. Danach:

1. Weboberfläche öffnen.
2. `Einstellungen` öffnen.
3. Im Bereich `Gemini API Key` den Key eintragen.
4. `API Key speichern` auswählen.

Der Key wird serverseitig gespeichert und niemals vollständig zurückgegeben. Über die Einstellungen kann er auch wieder entfernt werden. Ein bereits vorhandener SecretStore wird durch spätere Änderungen an `.env` nicht automatisch überschrieben.

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
docker compose ps
docker compose logs --tail=100 video-analysis-app
```

`/health` muss `status: ok` und `/ready` muss `status: ready` liefern. Der Compose-Healthcheck verwendet intern ebenfalls `/health`.

## Stoppen, Neustart und Aktualisierung

```powershell
docker compose restart
docker compose down
docker compose pull
docker compose up -d
```

`docker compose down` entfernt den Container, aber nicht die Dateien unter `data/jobs`. Der Restart-Modus `on-failure:5` startet den Container nach einem fehlerhaften Prozessende bis zu fünfmal neu. Ein kontrolliertes Herunterfahren über die App endet erfolgreich und bleibt beendet.

### Feste Version oder Rollback

Standardmäßig wird `stable` verwendet. Für einen reproduzierbaren Stand kann vor dem Start ein Versionstag gesetzt werden:

```powershell
$env:APP_IMAGE_TAG = 'v0.1.0'
docker compose pull
docker compose up -d
```

Für die Rückkehr zum aktuellen stabilen Stand:

```powershell
Remove-Item Env:APP_IMAGE_TAG -ErrorAction SilentlyContinue
docker compose up -d
```

## Persistente Daten

- `data/jobs/`: Jobs, Manifeste, Transkripte, Videos, Screenshots, Konfiguration und SecretStore.
- `external-output/`: optionaler externer Ausgabeordner für kopierte Screenshots.
- `/tmp` im Container: temporäre Arbeitsdateien.

Die beiden Hostordner `data/jobs` und `external-output` dürfen nicht gelöscht werden, wenn Ergebnisse erhalten bleiben sollen. Externe Kopien werden nicht automatisch durch die Retention-Bereinigung entfernt.

## Konfiguration

Die wichtigsten optionalen Variablen in `.env` sind:

| Variable | Standard | Bedeutung |
|---|---:|---|
| `GEMINI_API_KEY` | leer | Initialer Gemini-Key; alternativ über Einstellungen setzen |
| `GEMINI_MODEL` | App-Standard | Zu verwendendes Gemini-Modell |
| `SEGMENT_LENGTH` | `30` | Segmentlänge der Analyse in Sekunden |
| `EXTRACT_TRANSCRIPT` | `true` | Transkriptextraktion aktivieren oder deaktivieren |
| `APP_PORT` | `3006` | Host-Port der lokalen Weboberfläche |
| `APP_IMAGE_TAG` | `stable` | Festes Image-Tag für Versionierung oder Rollback |

## Fehlerbehebung

- **`.env` fehlt:** Das ist beim Standardstart unproblematisch. Eine `.env` wird nur benötigt, wenn Port, Image-Tag oder optionale Startwerte angepasst werden sollen.
- **Port belegt:** In `.env` `APP_PORT` auf einen freien Host-Port setzen und die Anwendung über diesen Port öffnen.
- **Container startet nicht:** `docker compose logs --tail=100 video-analysis-app` prüfen.
- **Analyse verweigert:** Gemini-Key über `.env` beim ersten Start oder über `Einstellungen` hinterlegen.
- **YouTube-Fehler:** Nur öffentliche, ohne Login erreichbare Videos verwenden.
- **Image- oder Pull-Fehler:** Docker-Daemon und Internetzugriff prüfen; anschließend `docker compose pull` ausführen.
- **Source-Build-Fehler:** Für lokale Entwicklung `docker compose -f docker-compose.yml -f docker-compose.build.yml build --no-cache` verwenden.

## Sicherheit

Die Compose-Datei bindet die Weboberfläche standardmäßig nur an `127.0.0.1`. Die App besitzt in diesem Setup keine Benutzeranmeldung und ist nicht für eine direkte öffentliche Internetfreigabe vorgesehen. Für LAN- oder Internetbetrieb sind eine bewusste Bind-Adresse, Authentifizierung, Rate-Limiting und ein abgesicherter Reverse Proxy erforderlich.

## Automatische Prüfungen

GitHub Actions prüft bei Pull Requests und Pushes nach `main` die Dependency-Installation mit `npm ci`, die Tests, den Produktions-Build, die Compose-Konfiguration sowie einen Source-Docker-Start mit `/health`. Der Workflow benötigt keinen Gemini-Key und führt keine echte Videoanalyse aus.

Bei einem Versionstag wie `v0.1.0` baut ein separater Workflow das öffentliche Image für `linux/amd64` und `linux/arm64` und veröffentlicht es mit dem Versionstag sowie `stable` und `latest` in GHCR. Der normale Compose-Start lädt `stable`; für Rollbacks kann `APP_IMAGE_TAG` gesetzt werden.

Dependabot überwacht npm-, Python-, Docker- und GitHub-Action-Abhängigkeiten. Automatische Update-PRs sind auf Sicherheitsupdates begrenzt.

## Lizenz

Der Quellcode steht unter der [MIT-Lizenz](LICENSE). Die Anwendung darf weiterhin nur mit öffentlichen, ohne Login erreichbaren Videoquellen verwendet werden.

Weitere Informationen zur Ausgabe und API-Nutzung stehen in [output/README.md](output/README.md). Die Details zum SecretStore und kontrollierten Herunterfahren stehen in [docs/operations/app-lifecycle.md](docs/operations/app-lifecycle.md).

Die vollständige Übersicht zu REST-Schnittstellen, n8n-/Skript-Automatisierung, Polling, Schnittstellen-Netzwerk und Sicherheitsgrenzen steht in [docs/integrations/api-automation.md](docs/integrations/api-automation.md).
