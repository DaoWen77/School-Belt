@echo off
chcp 65001 >nul
setlocal
rem O.M.V Dijiang - one-click local launcher (ASCII only in this file)
rem Starts API :3000 + Web :3100. Pass args like: -Rebuild  /  -Stop  /  -NoBrowser
set "PS=pwsh"
where pwsh >nul 2>nul || set "PS=powershell"
"%PS%" -NoProfile -ExecutionPolicy Bypass -File "%~dp0ops\start-local.ps1" %*
set "RC=%ERRORLEVEL%"
if not "%RC%"=="0" pause
endlocal & exit /b %RC%
