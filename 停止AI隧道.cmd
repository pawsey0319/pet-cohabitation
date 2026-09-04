@echo off
title Pet Demo - Stop AI Tunnel
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\stop-demo-model-tunnel.ps1"
echo.
pause
