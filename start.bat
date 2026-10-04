@echo off
rem Starts Gloss and opens it in the browser. Double-click this file, or run
rem "start.bat --dev" for live reload. Close the window or press Ctrl+C to stop.
title Gloss
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Gloss needs Node.js 22.13 or newer: https://nodejs.org
  pause
  exit /b 1
)

node scripts\start.mjs %*
if errorlevel 1 pause
