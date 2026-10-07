@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install-dragon.ps1"
if errorlevel 1 pause
