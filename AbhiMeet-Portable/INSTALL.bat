@echo off
echo ========================================
echo   AbhiMeet - Meeting Recorder Setup
echo ========================================
echo.

:: Check Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js not found!
    echo Download from: https://nodejs.org
    echo Install Node.js first, then run this again.
    pause
    exit /b 1
)
echo [OK] Node.js found:
node --version

:: Install dependencies
echo.
echo Installing dependencies...
npm install
if %errorlevel% neq 0 (
    echo [ERROR] npm install failed!
    pause
    exit /b 1
)
echo [OK] Dependencies installed

:: Download FFmpeg
echo.
echo Downloading FFmpeg...
if not exist "ffmpeg" mkdir ffmpeg
if not exist "ffmpeg\ffmpeg.exe" (
    curl -L -o ffmpeg\ffmpeg-release.zip "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip"
    powershell -Command "Expand-Archive -Path 'ffmpeg\ffmpeg-release.zip' -DestinationPath 'ffmpeg\temp' -Force"
    for /d %%i in (ffmpeg\temp\ffmpeg-*) do (
        copy "%%i\bin\ffmpeg.exe" "ffmpeg\ffmpeg.exe"
        copy "%%i\bin\ffprobe.exe" "ffmpeg\ffprobe.exe"
    )
    rmdir /s /q ffmpeg\temp
    del ffmpeg\ffmpeg-release.zip
    echo [OK] FFmpeg installed
) else (
    echo [OK] FFmpeg already exists
)

:: Create desktop shortcut
echo.
echo Creating desktop shortcut...
powershell -Command "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut([Environment]::GetFolderPath('Desktop') + '\AbhiMeet.lnk'); $s.TargetPath = (Get-Command node).Source.Replace('node.exe','') + '..\node_modules\electron\dist\electron.exe'; $s.Arguments = '.'; $s.WorkingDirectory = '%cd%'; $s.Description = 'AbhiMeet Meeting Recorder'; $s.Save()" 2>nul
if %errorlevel% neq 0 (
    echo [NOTE] Could not create shortcut. Run manually: npx electron .
) else (
    echo [OK] Desktop shortcut created
)

:: Create default recordings folder
if not exist "recordings" mkdir recordings
echo [OK] Default recordings folder: %cd%\recordings

echo.
echo ========================================
echo   Setup Complete!
echo ========================================
echo.
echo To start AbhiMeet:
echo   - Double-click the AbhiMeet desktop icon
echo   - OR run: npx electron .
echo.
echo To transfer recordings to server:
echo   Copy your recording folders to the server's
echo   AbhiMeet-Recordings directory, then ask Claude
echo   to transcribe and analyze them.
echo.
pause
