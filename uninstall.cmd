@echo off
chcp 65001 >nul
setlocal
if not exist "%~dp0runtime\python.exe" (
  echo Missing bundled runtime. Restore the complete package first.
  pause
  exit /b 1
)
echo Restore native host registration; preserve browser data and package files.
"%~dp0runtime\python.exe" -I -X utf8 "%~dp0setup.py" --uninstall
set "SETUP_RESULT=%ERRORLEVEL%"
echo.
pause
exit /b %SETUP_RESULT%
