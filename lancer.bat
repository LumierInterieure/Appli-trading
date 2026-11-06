@echo off
setlocal
cd /d "%~dp0"
title Market Desk

echo.
echo  === Market Desk ===
echo.

rem --- 1. Node.js present et assez recent ?
where node >nul 2>nul
if errorlevel 1 (
  echo [ERREUR] Node.js n'est pas installe.
  echo Installez la version LTS depuis https://nodejs.org puis relancez ce fichier.
  pause
  exit /b 1
)
for /f "tokens=1 delims=v." %%a in ('node -v') do set NODE_MAJOR=%%a
if %NODE_MAJOR% LSS 20 (
  echo [ERREUR] Node.js version 20 ou plus est requise. Version actuelle :
  node -v
  echo Installez la version LTS depuis https://nodejs.org puis relancez ce fichier.
  pause
  exit /b 1
)

rem --- 2. Dependances : installees si absentes ou incompletes
if not exist "node_modules\.bin\vite.cmd" goto install
if not exist "node_modules\.bin\tsx.cmd" goto install
goto build

:install
echo Installation des dependances (premiere fois, 1 a 2 minutes)...
call npm install --include=dev --no-audit --no-fund
if errorlevel 1 (
  echo.
  echo [ERREUR] L'installation des dependances a echoue ^(voir les messages ci-dessus^).
  echo Verifiez votre connexion internet, puis supprimez le dossier node_modules et relancez.
  pause
  exit /b 1
)

:build
echo.
echo Preparation de l'interface...
call npm run build
if errorlevel 1 (
  echo.
  echo [ERREUR] La compilation a echoue ^(voir les messages ci-dessus^).
  pause
  exit /b 1
)

rem --- 3. Ouvre le navigateur quelques secondes apres le demarrage du serveur
start "" /min cmd /c "timeout /t 4 /nobreak >nul & start http://localhost:8787"

echo.
echo Application disponible sur http://localhost:8787
echo Laissez cette fenetre ouverte. Fermez-la pour arreter l'application.
echo.
call npm start
pause
