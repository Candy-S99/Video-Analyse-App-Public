# Video-Analyse-Ausgabe

Dieser Ordner ist der sichtbare und kanonische Output der Video-Analyse-App. Jeder abgeschlossene Job liegt in einem eigenen Ordner `job-id--video-titel`.

## Ordnerstruktur

```text
output/
└── job-id--video-titel/
    ├── manifest.json
    ├── 00-source/source.txt
    ├── 01-metadata/
    ├── 02-transcript/
    ├── 03-video/video.mp4
    ├── 05-scenes/scenes.csv
    └── 06-screenshots/
```

`manifest.json` ist der maschinenlesbare, kanonische Jobstatus. `06-screenshots/` enthält ausschließlich echte, mit ffmpeg extrahierte PNG-Frames.

## REST und Automatisierung

Jobs werden über `POST /api/v1/video-analysis/jobs` mit `source_url` gestartet. Status ist über `GET /api/v1/video-analysis/jobs/{job_id}` verfügbar. Das Endergebnis liefert `GET /api/v1/video-analysis/jobs/{job_id}/result`.

Screenshot-Metadaten liefert `GET /api/v1/video-analysis/jobs/{job_id}/screenshots`; ein einzelnes PNG ist über `GET /api/v1/video-analysis/jobs/{job_id}/screenshots/{screenshot_id}` verfügbar.

Die Konfiguration liegt unter `GET` und `PUT /api/v1/video-analysis/config`. Die Einstellungen werden im internen Docker-Volume gespeichert. Es gibt keinen externen Screenshot-Mount und keine `external_output_dir`-Option mehr.

## Retention

`GET /api/v1/video-analysis/retention/preview` zeigt löschbare interne PNGs. `POST /api/v1/video-analysis/retention/cleanup` benötigt den JSON-Body `{ "confirm": true }`.

Manifeste, Logs und diese Dokumentation bleiben geschützt. Die Retention-Bereinigung wirkt auf die Dateien in diesem `output/`-Ordner.

## Docker

Das Containerimage enthält ffmpeg. Für Originalframes wird ein öffentlicher, ohne Login erreichbarer YouTube-Link benötigt. Keine Cookies, Zugangsdaten oder DRM-Umgehung werden verwendet.
