@echo off
chcp 65001 >nul
setlocal
if not exist "%~dp0runtime\python.exe" (
  echo Missing bundled runtime. Extract the complete ZIP first.
  pause
  exit /b 1
)
"%~dp0runtime\python.exe" -I -X utf8 "%~dp0setup.py" --choose-v2
set "SETUP_RESULT=%ERRORLEVEL%"
echo.
pause
exit /b %SETUP_RESULT%
