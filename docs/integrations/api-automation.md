# API, Automatisierung und Schnittstellen

Dieses Dokument beschreibt die lokalen REST-Schnittstellen der Video-Analyse-App und den Einsatz mit Automatisierungen wie n8n. Die Weboberfläche und externe Automatisierungen verwenden dieselbe Job-Pipeline.

## Schnittstellenübersicht

```text
Weboberfläche ─┐
               ├─ REST API ─ JobManager ─ Gemini / YouTube / ffmpeg
n8n / Skripte ─┘                  │
               └─ kanonischer Output unter output/ und internes Docker-Volume
```

Die Anwendung stellt im Docker-Setup zwei erreichbare Ports bereit:

- Host: `http://localhost:3006` (standardmäßig nur lokal)
- Container-intern: `http://video-analysis-app:3000`, wenn ein weiterer Container im selben Docker-Netzwerk angebunden wird

Wenn n8n in einem separaten Docker-Container läuft, ist unter Docker Desktop typischerweise `http://host.docker.internal:3006` als Basis-URL erforderlich. Die aktuelle Compose-Datei startet n8n nicht mit; n8n wird als eigener Dienst betrieben und ruft die REST API auf.

## Betriebs- und Bereitschaftsprüfung

| Methode | Pfad | Bedeutung |
|---|---|---|
| `GET` | `/health` | Prozess lebt; erwartet wird `{ "status": "ok" }` |
| `GET` | `/ready` | Anwendung ist bereit; erwartet wird `{ "status": "ready" }` |

Der Docker-Healthcheck verwendet `/health`. Beide Endpunkte benötigen keine API-Key-Konfiguration.

## Konfiguration

### Aktuelle Konfiguration lesen

```http
GET /api/v1/video-analysis/config
```

Die Antwort enthält unter anderem `model`, `segment_length_seconds`, `extract_transcript`, die Screenshot-Parameter und `automatic_cleanup_enabled`. Der Gemini-Key wird niemals zurückgegeben; sichtbar ist nur `gemini_api_key_configured`.

### Laufzeitkonfiguration ändern

```http
PUT /api/v1/video-analysis/config
Content-Type: application/json

{
  "model": "gemini-3.8-flash",
  "segment_length_seconds": 30,
  "extract_transcript": true,
  "fine_search_window_seconds": 2,
  "fine_search_interval_seconds": 0.5,
  "max_screenshots_per_candidate": 4,
  "fine_search_fallback": "exact_timestamp",
  "automatic_cleanup_enabled": true
}
```

Es dürfen nur bekannte Felder übertragen werden. Hostpfade gehören nicht in den API-Vertrag. Die Konfiguration gilt für neu gestartete Jobs und wird persistent im internen Docker-Volume gespeichert. Jeder Job speichert zusätzlich einen Konfigurationssnapshot.

### Gemini-Key automatisiert verwalten

```http
PUT /api/v1/video-analysis/config/gemini-api-key
Content-Type: application/json

{ "api_key": "DEIN_GEMINI_KEY" }
```

```http
DELETE /api/v1/video-analysis/config/gemini-api-key
```

Der Schlüssel wird im persistenten SecretStore unter `/data/jobs/.video-analysis-secrets.json` gespeichert. In n8n sollte der Key über Credentials oder einen Secret Manager eingespeist werden, nicht als fest eingetragener Klartext in einem Workflow.

## Jobs und Ergebnisse

### Job starten

```http
POST /api/v1/video-analysis/jobs
Content-Type: application/json

{
  "source_url": "https://www.youtube.com/watch?v=abcdefghijk",
  "correlation_id": "n8n-video-2026-001"
}
```

Erfolgreich angenommen wird der Auftrag mit HTTP `202`:

```json
{
  "job_id": "<uuid>",
  "status": "QUEUED",
  "created_at": "2026-01-01T12:00:00.000Z"
}
```

`correlation_id` ist optional und hilft, einen n8n-Lauf oder einen externen Auftrag mit dem App-Job zu verbinden. Ohne Gemini-Key antwortet die App mit HTTP `409` und dem Fehlercode `GEMINI_API_KEY_REQUIRED`. Während des kontrollierten Herunterfahrens wird ein neuer Start mit HTTP `503` abgewiesen.

### Jobs abfragen

| Methode | Pfad | Zweck |
|---|---|---|
| `GET` | `/api/v1/video-analysis/jobs` | Persistierte Jobs als Übersicht |
| `GET` | `/api/v1/video-analysis/jobs/{job_id}` | Status, Phase und Fortschritt |
| `GET` | `/api/v1/video-analysis/jobs/{job_id}/result` | Vollständiges Jobresultat |
| `GET` | `/api/v1/video-analysis/jobs/{job_id}/events` | Ereignisse und Token-/Kostenübersicht des Jobs |
| `GET` | `/api/v1/video-analysis/jobs/events` | Globaler Ereignisverlauf |
| `POST` | `/api/v1/video-analysis/jobs/{job_id}/cancel` | Aktiven Job abbrechen |
| `DELETE` | `/api/v1/video-analysis/jobs` | Persistierte Job-Historie löschen |
| `DELETE` | `/api/v1/video-analysis/jobs/logs` | JSONL-Ereignislogs löschen |

Terminalstatus sind `COMPLETED`, `PARTIAL`, `FAILED` und `CANCELLED`. Während `QUEUED` oder `PROCESSING` ist das vollständige Resultat noch nicht verfügbar; der Resultat-Endpunkt antwortet dann mit HTTP `409`.

Ein einfaches Polling fragt den Status alle paar Sekunden ab und beendet die Schleife erst bei einem Terminalstatus. Danach lädt der Automatisierer das Resultat und bei Bedarf die Screenshots.

### Screenshots abrufen

| Methode | Pfad | Antwort |
|---|---|---|
| `GET` | `/api/v1/video-analysis/jobs/{job_id}/screenshots` | Sortierte Screenshot-Metadaten als JSON |
| `GET` | `/api/v1/video-analysis/jobs/{job_id}/screenshots/{screenshot_id}` | PNG-Binärantwort |

Ein physisch durch Retention entfernter Screenshot antwortet mit HTTP `410` und `SCREENSHOT_PURGED`. Das kanonische Jobresultat liegt zusätzlich als `manifest.json` im jeweiligen Jobordner unter `output/`.

## Kontrolliertes Herunterfahren

| Methode | Pfad | Zweck |
|---|---|---|
| `GET` | `/api/v1/video-analysis/system/status` | Lifecycle-Zustand und Anzahl aktiver Jobs lesen |
| `POST` | `/api/v1/video-analysis/system/shutdown` | Aktive Jobs kontrolliert abbrechen und Anwendung beenden |

Der Shutdown-POST ist absichtlich lokal geschützt. Er verlangt einen lokalen `Origin`-Header und den pro App-Start erzeugten Header `X-Video-Analysis-Shutdown-Token`, dessen Wert aus dem Status-Endpunkt stammt. Der Token ist flüchtig, darf nicht in n8n oder externen Systemen gespeichert werden und wird nach dem kontrollierten Shutdown ungültig.

### Retention steuern

```http
GET /api/v1/video-analysis/retention/preview
```

```http
POST /api/v1/video-analysis/retention/cleanup
Content-Type: application/json

{ "confirm": true }
```

Manifeste, Logs und das Ausgabehandbuch bleiben geschützt. Die Retention-Bereinigung wirkt direkt auf die sichtbaren Dateien unter `output/`.

## n8n- und Skript-Automatisierung

Die App besitzt keinen separaten Scheduler und keinen generischen Webhook. Ein Automatisierer startet einen Job direkt über `POST /api/v1/video-analysis/jobs`, wartet über den Status-Endpunkt und lädt danach das Ergebnis.

### Empfohlener n8n-Ablauf

1. **HTTP Request – Job starten**
   - Methode: `POST`
   - URL: `<BASIS_URL>/api/v1/video-analysis/jobs`
   - JSON-Body mit `source_url` und optional `correlation_id`
2. **Loop/Wait – Status pollen**
   - Methode: `GET`
   - URL: `<BASIS_URL>/api/v1/video-analysis/jobs/{{ $json.job_id }}`
   - Bei `QUEUED` oder `PROCESSING` einige Sekunden warten und erneut abfragen
3. **HTTP Request – Ergebnis laden**
   - Methode: `GET`
   - URL: `<BASIS_URL>/api/v1/video-analysis/jobs/{{ $json.job_id }}/result`
4. **Optional – Bilder und Ereignisse laden**
   - Screenshots: `/jobs/{job_id}/screenshots`
   - Einzelbild: `/jobs/{job_id}/screenshots/{screenshot_id}`
   - Ereignisse: `/jobs/{job_id}/events`

Für n8n auf dem Host ist `<BASIS_URL>` normalerweise `http://localhost:3006`. Für n8n in einem separaten Docker-Container unter Docker Desktop ist typischerweise `http://host.docker.internal:3006` erforderlich. Bei einem gemeinsam konfigurierten Docker-Netzwerk kann der Compose-Service über `http://video-analysis-app:3000` angesprochen werden.

### PowerShell-Beispiel

```powershell
$baseUrl = 'http://localhost:3006'
$body = @{
  source_url = 'https://www.youtube.com/watch?v=abcdefghijk'
  correlation_id = 'powershell-demo-001'
} | ConvertTo-Json

$job = Invoke-RestMethod -Method Post `
  -Uri "$baseUrl/api/v1/video-analysis/jobs" `
  -ContentType 'application/json' `
  -Body $body

do {
  Start-Sleep -Seconds 5
  $status = Invoke-RestMethod -Method Get `
    -Uri "$baseUrl/api/v1/video-analysis/jobs/$($job.job_id)"
} while ($status.status -in @('QUEUED', 'PROCESSING'))

$result = Invoke-RestMethod -Method Get `
  -Uri "$baseUrl/api/v1/video-analysis/jobs/$($job.job_id)/result"
$result | ConvertTo-Json -Depth 20
```

## Sicherheit und Grenzen

- Die Compose-Datei veröffentlicht die Weboberfläche standardmäßig nur auf `127.0.0.1`.
- Die normalen REST-Endpunkte haben in diesem lokalen Setup keine Benutzeranmeldung. Die App darf daher nicht ohne Reverse Proxy, Authentifizierung und Rate-Limiting öffentlich freigegeben werden.
- API-Keys gehören in `.env`, die UI, n8n-Credentials oder einen Secret Manager – niemals in Git, fest verdrahtete Workflows oder Logs.
- Der Shutdown-Endpunkt akzeptiert nur lokale Origins und den pro Start erzeugten Header `X-Video-Analysis-Shutdown-Token`. Der Token ist flüchtig und darf nicht an externe Automatisierungen weitergegeben werden.
- Öffentliche YouTube-URLs müssen ohne Login erreichbar sein; Cookies, Zugangsdaten und DRM-Umgehung werden nicht unterstützt.

## Weiterführende Dokumentation

- Docker-Erststart und Konfiguration: [`README.md`](../../README.md)
- Lifecycle, SecretStore und kontrolliertes Herunterfahren: [`docs/operations/app-lifecycle.md`](../operations/app-lifecycle.md)
- Ausgabeordner und Retention: [`output/README.md`](../../output/README.md)
