@echo off
setlocal
title AquaCore MX - Instalar inventario automatico
echo.
echo AquaCore MX - Instalador de inventario automatico
echo Descargando instalador seguro desde el repositorio de AquaCore...
echo.
set "PSFILE=%TEMP%\aquacore-sync-installer.ps1"
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Invoke-WebRequest -UseBasicParsing 'https://raw.githubusercontent.com/tomashirvinaragon-stack/aquacore-mx/main/tools/aquacore-sync-installer.ps1' -OutFile '%PSFILE%'"
if errorlevel 1 (
  echo.
  echo No se pudo descargar el instalador.
  pause
  exit /b 1
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%PSFILE%"
set "RC=%ERRORLEVEL%"
del "%PSFILE%" >nul 2>nul
exit /b %RC%
