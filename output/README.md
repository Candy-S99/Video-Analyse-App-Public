# Video-Analyse-Ausgabehandbuch

Dieses Verzeichnis enthält die dauerhaften Ergebnisse der Video-Analyse-App. Jeder Job liegt in einem eigenen Ordner `job-id--video-titel`; `manifest.json` ist der maschinenlesbare, kanonische Jobstatus.

## Ordnerstruktur

`00-source/source.txt` enthält die ursprüngliche und kanonische YouTube-URL. `01-metadata/` enthält Video-Metadaten und Beschreibung. `02-transcript/` enthält Transkriptdateien. `03-video/video.mp4` ist die lokal materialisierte öffentliche Quelle. `05-scenes/scenes.csv` listet Kandidaten. `06-screenshots/` enthält ausschließlich echte, mit ffmpeg extrahierte PNG-Frames.

## REST und n8n

Jobs werden über `POST /api/v1/video-analysis/jobs` mit `source_url` gestartet. Status ist über `GET /jobs/{job_id}` verfügbar, das Endergebnis über `GET /jobs/{job_id}/result`. Screenshot-Metadaten liefert `GET /jobs/{job_id}/screenshots`; ein einzelnes PNG `GET /jobs/{job_id}/screenshots/{screenshot_id}`. Diese Endpunkte können direkt aus n8n HTTP Request Nodes verwendet werden.

Der empfohlene Automatisierungsablauf besteht aus drei Schritten: Job mit `POST /jobs` starten, `GET /jobs/{job_id}` bis zu einem Terminalstatus pollen und anschließend `GET /jobs/{job_id}/result` sowie bei Bedarf Screenshots und Ereignisse laden. Netzwerkvarianten für n8n in Docker und vollständige PowerShell-/REST-Beispiele stehen in [docs/integrations/api-automation.md](../docs/integrations/api-automation.md).

Die flache Konfiguration liegt unter `GET` und `PUT /api/v1/video-analysis/config`: `external_output_dir`, `fine_search_window_seconds`, `fine_search_interval_seconds`, `max_screenshots_per_candidate`, `fine_search_fallback` und `automatic_cleanup_enabled`. Externe Ziele müssen im Container unter `/mnt/external-output` liegen.

## Retention

`GET /api/v1/video-analysis/retention/preview` zeigt löschbare interne PNGs. `POST /api/v1/video-analysis/retention/cleanup` benötigt den JSON-Body `{ "confirm": true }`. Manifeste, Logs und dieses Handbuch bleiben geschützt. Externe Kopien werden nie automatisch gelöscht.

## Docker

Das Containerimage enthält `ffmpeg`. Für Originalframes wird ein öffentlicher, ohne Login erreichbarer YouTube-Link benötigt. Keine Cookies, Zugangsdaten oder DRM-Umgehung werden verwendet.
