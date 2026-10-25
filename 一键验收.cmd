@echo off
chcp 65001 >nul
setlocal
rem O.M.V Dijiang - one-click acceptance launcher (ASCII only, do not add Chinese here)
rem Usage: run this file directly, or pass args like: -Mode ui -NoBrowser
set "PS=pwsh"
where pwsh >nul 2>nul || set "PS=powershell"
"%PS%" -NoProfile -ExecutionPolicy Bypass -File "%~dp0ops\acceptance\start.ps1" %*
set "RC=%ERRORLEVEL%"
if not "%RC%"=="0" pause
endlocal & exit /b %RC%
