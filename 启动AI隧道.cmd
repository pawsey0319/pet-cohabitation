@echo off
title Pet Demo - AI Tunnel
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\restart-demo-ai.ps1"
echo.
echo The tunnel command has ended. See the messages above.
pause
