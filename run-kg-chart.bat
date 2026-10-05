@echo off
title KG Chart local server
REM Double-click to run the KG Chart app locally.
REM Keep this .bat AND kg-serve.js in the KG_chart_new folder, next to index.html.
cd /d "%~dp0"

if exist "index.html" goto :found
echo Could not find index.html here.
echo Put this .bat in the KG_chart_new folder, next to index.html.
echo Current folder: "%CD%"
pause
goto :eof
:found

set "PORT=8142"
set "URL=http://localhost:%PORT%/"

REM --- Find Node ---
set "NODE="
if exist "%ProgramFiles%\nodejs\node.exe" set "NODE=%ProgramFiles%\nodejs\node.exe"
if not defined NODE if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "NODE=%LOCALAPPDATA%\Programs\nodejs\node.exe"
if not defined NODE for /f "delims=" %%i in ('where node.exe 2^>nul') do if not defined NODE set "NODE=%%i"
if defined NODE if exist "kg-serve.js" goto :node

REM --- Fall back to Python ---
set "PY="
py -3 --version >nul 2>nul && set "PY=py -3"
if not defined PY python --version >nul 2>nul && set "PY=python"
if defined PY goto :python

echo.
if defined NODE echo kg-serve.js is missing. Put it next to this .bat file.
if not defined NODE echo Could not find Node.js. Install it from https://nodejs.org and run this again.
echo.
pause
goto :eof

:node
call :banner Node
REM kg-serve.js opens the browser itself the moment it is listening.
"%NODE%" kg-serve.js %PORT% --open
goto :stopped

:python
call :banner Python
call :openwhenready
%PY% -m http.server %PORT% --bind 127.0.0.1
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
REM Python fallback only: opens the browser once the port accepts connections.
REM Plain TCP check on 127.0.0.1 - avoids slow web-request/proxy start-up.
start "" /b powershell -NoProfile -WindowStyle Hidden -Command "for($i=0;$i -lt 80;$i++){try{(New-Object Net.Sockets.TcpClient).Connect('127.0.0.1',%PORT%); break}catch{Start-Sleep -Milliseconds 250}}; Start-Process 'http://127.0.0.1:%PORT%/'"
goto :eof

:stopped
echo.
echo Server stopped. If the port was already in use, another copy is
echo running - close it, or change PORT at the top of this file.
pause
