@echo off
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js est requis : https://nodejs.org & pause & exit /b 1)
if not exist node_modules call npm install
call npm run build
start "" http://localhost:8787
call npm start
pause
