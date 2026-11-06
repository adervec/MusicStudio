@echo off
rem Music Studio folder helper — one-time, per-user install (no admin needed).
rem Copies open-folder.ps1 to %LOCALAPPDATA%\MusicStudio and registers the musicstudio-open: link
rem type for YOUR account only (HKCU). Undo with uninstall.cmd.
setlocal
set "DEST=%LOCALAPPDATA%\MusicStudio"
if not exist "%DEST%" mkdir "%DEST%"
copy /y "%~dp0open-folder.ps1" "%DEST%\open-folder.ps1" >nul || (echo Copy failed. & exit /b 1)
set "CMD=powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"%DEST%\open-folder.ps1\" \"%%1\""
reg add "HKCU\Software\Classes\musicstudio-open" /ve /d "URL:Music Studio folder helper" /f >nul
reg add "HKCU\Software\Classes\musicstudio-open" /v "URL Protocol" /d "" /f >nul
reg add "HKCU\Software\Classes\musicstudio-open\shell\open\command" /ve /d "%CMD%" /f >nul
echo Installed. In Music Studio: Settings - tick "Folder helper installed".
echo The first time you click a folder button, Chrome asks to open the helper - tick "Always allow".
