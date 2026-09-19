@echo off
setlocal
cd /d "%~dp0"

docker compose -f compose.yaml down
if errorlevel 1 (
  echo Die Anwendung konnte nicht beendet werden.
  pause
  exit /b 1
)

echo Die Anwendung wurde beendet. Daten und Output bleiben erhalten.
exit /b 0
