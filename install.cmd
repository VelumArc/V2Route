@echo off
chcp 65001 >nul
setlocal
if not exist "%~dp0runtime\python.exe" (
  echo Missing bundled runtime. Extract the complete ZIP first.
  pause
  exit /b 1
)
echo V2Route setup - current Windows user only. / 仅为当前 Windows 用户安装。
"%~dp0runtime\python.exe" -I -X utf8 "%~dp0setup.py" --install --interactive
set "SETUP_RESULT=%ERRORLEVEL%"
echo.
pause
exit /b %SETUP_RESULT%
