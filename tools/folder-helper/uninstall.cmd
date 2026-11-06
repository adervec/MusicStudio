@echo off
rem Removes the Music Studio folder helper (the musicstudio-open: link type and its script).
reg delete "HKCU\Software\Classes\musicstudio-open" /f >nul 2>&1
del /q "%LOCALAPPDATA%\MusicStudio\open-folder.ps1" >nul 2>&1
echo Folder helper removed.
