@echo off
chcp 65001 >nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0game_overlay\install-autostart.ps1"
echo.
pause
