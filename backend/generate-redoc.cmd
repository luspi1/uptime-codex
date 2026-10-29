@echo off
setlocal
set "REDOCLY_TELEMETRY=off"
call npx.cmd --yes @redocly/cli@2.72.0 build-docs "%~dp0docs\openapi.json" --output "%~dp0docs\redoc.html" --inlineBundle --title "Uptime App API"
exit /b %errorlevel%
