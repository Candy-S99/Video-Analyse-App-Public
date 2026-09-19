@echo off
setlocal
cd /d "%~dp0"

where docker >nul 2>&1
if errorlevel 1 (
  echo Docker Desktop wurde nicht gefunden.
  pause
  exit /b 1
)

docker info >nul 2>&1
if errorlevel 1 (
  echo Bitte Docker Desktop starten und erneut versuchen.
  pause
  exit /b 1
)

docker compose -f compose.yaml up -d
if errorlevel 1 (
  echo Die Anwendung konnte nicht gestartet werden.
  pause
  exit /b 1
)

start "" "http://localhost:3006"
exit /b 0
