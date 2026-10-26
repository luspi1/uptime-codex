@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0backend\dev.ps1"
exit /b %errorlevel%
