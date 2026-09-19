@echo off
setlocal
cd /d "%~dp0"

docker compose -f compose.yaml pull
if errorlevel 1 (
  echo Das neue Docker-Image konnte nicht geladen werden.
  pause
  exit /b 1
)

docker compose -f compose.yaml up -d
if errorlevel 1 (
  echo Die Anwendung konnte nach dem Update nicht gestartet werden.
  pause
  exit /b 1
)

start "" "http://localhost:3006"
exit /b 0
