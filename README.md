# Video-Analyse-App

Lokale Videoanalyse-App für öffentliche YouTube-Videos. Diese öffentliche Variante läuft als einzelner Docker-Container und speichert Jobs, Ergebnisse, Konfiguration und den lokalen Gemini-SecretStore im gemounteten Datenordner.

## Voraussetzungen

- Docker Desktop oder Docker Engine mit Docker Compose.
- Git für den öffentlichen Clone.
- Internetzugriff für den ersten Image-Build, Gemini und öffentliche YouTube-Quellen.
- Node.js, npm, Python und ffmpeg müssen auf dem Host nicht installiert werden. Diese Laufzeitbestandteile befinden sich im Container.

## Schnellstart

```powershell
$ErrorActionPreference = 'Stop'
$repoPath = Join-Path (Get-Location) 'Video-Analyse-App-Public'

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    throw 'Git fehlt. Installiere Git für Windows zuerst.'
}
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw 'Docker fehlt. Installiere und starte Docker Desktop zuerst.'
}
if (Test-Path $repoPath) {
    throw "Der Zielordner existiert bereits: $repoPath"
}

git -c "credential.helper=" clone "https://github.com/Candy-S99/Video-Analyse-App-Public.git" $repoPath
if ($LASTEXITCODE -ne 0) {
    throw 'Der öffentliche Clone ist fehlgeschlagen.'
}
Set-Location $repoPath
Copy-Item .env.example .env
docker compose up --build -d

$healthy = $false
for ($attempt = 1; $attempt -le 30; $attempt++) {
    try {
        $health = Invoke-RestMethod -Uri 'http://localhost:3006/health' -TimeoutSec 5
        if ($health.status -eq 'ok') {
            $healthy = $true
            break
        }
    } catch {
        Start-Sleep -Seconds 2
    }
}

if (-not $healthy) {
    docker compose logs --tail=100 video-analysis-app
    throw 'Der Container wurde nicht rechtzeitig gesund.'
}

docker compose ps
Write-Host 'Die Video-Analyse-App läuft unter http://localhost:3006.'
```

Das Repository ist öffentlich; für den Clone ist kein GitHub-Konto erforderlich. Für echte Analysen muss der Betreiber anschließend den eigenen Gemini-Key in `.env` oder über `Einstellungen` hinterlegen.

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
docker compose up --build -d
```

`docker compose down` entfernt den Container, aber nicht die Dateien unter `data/jobs`. Der Restart-Modus `on-failure:5` startet den Container nach einem fehlerhaften Prozessende bis zu fünfmal neu. Ein kontrolliertes Herunterfahren über die App endet erfolgreich und bleibt beendet.

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

## Fehlerbehebung

- **`.env` fehlt:** `Copy-Item .env.example .env` ausführen. Compose benötigt die Datei auch dann, wenn der Gemini-Key später über die UI gesetzt wird.
- **Port belegt:** In `.env` `APP_PORT` auf einen freien Host-Port setzen und die Anwendung über diesen Port öffnen.
- **Container startet nicht:** `docker compose logs --tail=100 video-analysis-app` prüfen.
- **Analyse verweigert:** Gemini-Key über `.env` beim ersten Start oder über `Einstellungen` hinterlegen.
- **YouTube-Fehler:** Nur öffentliche, ohne Login erreichbare Videos verwenden.
- **Build-Fehler:** Docker-Daemon und Internetzugriff prüfen; anschließend `docker compose build --no-cache` ausführen.

## Sicherheit

Die Compose-Datei bindet die Weboberfläche standardmäßig nur an `127.0.0.1`. Die App besitzt in diesem Setup keine Benutzeranmeldung und ist nicht für eine direkte öffentliche Internetfreigabe vorgesehen. Für LAN- oder Internetbetrieb sind eine bewusste Bind-Adresse, Authentifizierung, Rate-Limiting und ein abgesicherter Reverse Proxy erforderlich.

## Automatische Prüfungen

GitHub Actions prüft bei Pull Requests und Pushes nach `main` die Dependency-Installation mit `npm ci`, die Tests, den Produktions-Build, die Compose-Konfiguration sowie einen Docker-Start mit `/health`. Der Workflow benötigt keinen Gemini-Key und führt keine echte Videoanalyse aus.

Dependabot überwacht npm-, Python-, Docker- und GitHub-Action-Abhängigkeiten. Automatische Update-PRs sind auf Sicherheitsupdates begrenzt.

## Lizenz

Der Quellcode steht unter der [MIT-Lizenz](LICENSE). Die Anwendung darf weiterhin nur mit öffentlichen, ohne Login erreichbaren Videoquellen verwendet werden.

Weitere Informationen zur Ausgabe und API-Nutzung stehen in [output/README.md](output/README.md). Die Details zum SecretStore und kontrollierten Herunterfahren stehen in [docs/operations/app-lifecycle.md](docs/operations/app-lifecycle.md).

Die vollständige Übersicht zu REST-Schnittstellen, n8n-/Skript-Automatisierung, Polling, Schnittstellen-Netzwerk und Sicherheitsgrenzen steht in [docs/integrations/api-automation.md](docs/integrations/api-automation.md).
