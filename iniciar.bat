@echo off
rem Abre yogacentral en modo de prueba local (simulador de Apps Script).
cd /d "%~dp0"
where node >nul 2>nul || (echo Necesitas instalar Node.js: https://nodejs.org & pause & exit /b 1)
start "" http://localhost:8787
node dev\server.js
pause
