@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required to run the YouTubePanel sidecar.
  pause
  exit /b 1
)

where yt-dlp >nul 2>nul
if errorlevel 1 (
  echo yt-dlp is required. Install it with:
  echo   winget install yt-dlp.yt-dlp
  pause
  exit /b 1
)

set "MPV_OK="
where mpv >nul 2>nul && set "MPV_OK=1"
if not defined MPV_OK if exist "C:\Program Files\MPV Player\mpv.exe" set "MPV_OK=1"
if not defined MPV_OK (
  echo mpv is required. Install it with:
  echo   winget install shinchiro.mpv
  pause
  exit /b 1
)

if not exist config.json (
  copy /y config.example.json config.json >nul
  echo Created config.json from config.example.json
)

node sidecar.js
pause
