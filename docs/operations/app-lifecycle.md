# Anwendungsschlüssel und kontrolliertes Herunterfahren

## API-Key

Der Gemini API-Key kann auf zwei Wegen konfiguriert werden:

1. Optional vor dem ersten Start über `GEMINI_API_KEY` in `.env`.
2. Nach dem Start in der Weboberfläche unter `Einstellungen` über das Passwortfeld `Gemini API Key`.

Die zweite Variante ist der Standardweg für eine laufende Installation. Die normale Konfigurationsabfrage liefert nur `gemini_api_key_configured`; der tatsächliche Wert bleibt serverseitig.

Beim ersten Start wird ein vorhandener `GEMINI_API_KEY` aus der Umgebung einmalig in den lokalen SecretStore übernommen. Danach ist der Store die alleinige Laufzeitquelle. Die Datei liegt unter `DATA_DIR/.video-analysis-secrets.json` und ist von Git ausgeschlossen. Änderungen an `.env` überschreiben einen bereits vorhandenen Store nicht automatisch; der Key wird danach über die Einstellungen-UI ersetzt oder entfernt. Der Zustand „entfernt“ bleibt gespeichert, damit ein alter Umgebungswert nicht automatisch zurückkehrt.

Für eine automatisierte lokale Konfiguration stehen zusätzlich diese Endpunkte zur Verfügung:

- `PUT /api/v1/video-analysis/config/gemini-api-key` mit `{ "api_key": "..." }` speichert einen neuen Key.
- `DELETE /api/v1/video-analysis/config/gemini-api-key` entfernt den Key dauerhaft aus dem SecretStore.

Die Endpunkte sind für den lokalen Betrieb gedacht. Der Key erscheint weder in der normalen Konfigurationsantwort noch in Ereignislogs oder Fehlermeldungen.

Die vollständige REST- und Automatisierungsdokumentation mit Job-Polling, n8n-Netzwerkvarianten und Schnittstellenübersicht steht in [docs/integrations/api-automation.md](../integrations/api-automation.md).

## Shutdown-Endpunkte

- `GET /api/v1/video-analysis/system/status` liefert Lifecycle-Zustand, Anzahl aktiver Jobs und den flüchtigen UI-Token.
- `POST /api/v1/video-analysis/system/shutdown` startet den vollständigen Shutdown.

Der POST-Endpunkt verlangt einen lokalen Origin und den pro App-Start erzeugten Header `X-Video-Analysis-Shutdown-Token`. Es wird kein Docker-Socket verwendet.

## Betriebsmodi

### Docker

Der Node-Prozess läuft durch den direkten Docker-Aufruf als Container-PID 1. Nach Job-Abbruch, Prozess- und Dateicleanup, Server-Schließung und einem normalen Exit mit Code `0` stoppt der Container. `docker-compose.yml` verwendet `restart: on-failure:5`: Ein fehlerhafter Exit darf bis zu fünfmal neu gestartet werden, ein kontrollierter Shutdown wird nicht automatisch neu gestartet. Der Host-Port ist standardmäßig nur an `127.0.0.1` gebunden.

### Native Node-/EXE-Ausführung

Der gleiche Lifecycle beendet den eigenen Node-Prozess kontrolliert. Eine spätere EXE-/Launcher-Schicht kann denselben Exit beobachten. Fremde Browser- oder Host-Prozesse werden nicht beendet.

### Lokale Weboberfläche

Die Weboberfläche zeigt eine Bestätigung mit der Zahl aktiver Jobs, stoppt Polling und neutralisiert sich nach dem Shutdown. `window.close()` wird nur versucht; wenn der Browser das Schließen nicht erlaubt, bleibt eine neutrale Abschlussseite sichtbar.

## Persistente Daten

Job-Ergebnisse, Manifeste, Screenshots, Transkripte, Konfiguration und der SecretStore bleiben beim Shutdown erhalten. Nur eindeutig app-eigene temporäre Dateien und unvollständige Downloader-Artefakte werden bereinigt.
