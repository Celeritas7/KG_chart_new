@echo off
title KG Chart local server
REM Double-click to run the KG Chart app locally.
REM Put this .bat in the KG_chart_new folder (next to index.html). Keep this window open.
cd /d "%~dp0"

if not exist "index.html" (
  echo Could not find index.html here.
  echo Put this .bat in the KG_chart_new folder, next to index.html.
  echo Current folder: %CD%
  pause
  goto :eof
)

set "PORT=8142"
set "URL=http://127.0.0.1:%PORT%/"

REM --- Find Python (skips the Microsoft Store stub) ---
set "PY="
py -3 --version >nul 2>nul && set "PY=py -3"
if not defined PY python --version >nul 2>nul && set "PY=python"
if defined PY goto :python

REM --- Find Node ---
set "NPX="
where npx.cmd >nul 2>nul && set "NPX=npx.cmd"
if not defined NPX if exist "%ProgramFiles%\nodejs\npx.cmd" set "NPX=%ProgramFiles%\nodejs\npx.cmd"
if not defined NPX if exist "%LOCALAPPDATA%\Programs\nodejs\npx.cmd" set "NPX=%LOCALAPPDATA%\Programs\nodejs\npx.cmd"
if defined NPX goto :node

echo.
echo Could not find Python or Node.js.
echo Install Python from https://www.python.org (tick "Add python.exe to PATH"),
echo then double-click this file again.
echo.
pause
goto :eof

:python
call :banner Python
call :openwhenready
%PY% -m http.server %PORT% --bind 127.0.0.1
goto :stopped

:node
call :banner Node
call :openwhenready
call "%NPX%" --yes serve -l tcp://127.0.0.1:%PORT% .
goto :stopped

:banner
echo.
echo   KG Chart - local server (%1)
echo   App:    %URL%
echo   Admin:  %URL%kg-chart-admin.html
echo   Close this window to stop.
echo.
goto :eof

:openwhenready
REM Opens the browser only once the server answers (waits up to ~20s).
start "" /b powershell -NoProfile -WindowStyle Hidden -Command "for($i=0;$i -lt 80;$i++){try{Invoke-WebRequest -UseBasicParsing -TimeoutSec 1 '%URL%' | Out-Null; break}catch{Start-Sleep -Milliseconds 250}}; Start-Process '%URL%'"
goto :eof

:stopped
echo.
echo Server stopped. If you saw "address already in use", another copy is
echo running - close it, or change PORT at the top of this file.
pause
