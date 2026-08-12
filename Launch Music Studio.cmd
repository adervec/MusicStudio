@echo off
title Music Studio
cd /d "%~dp0app"
if not exist "node_modules" echo Installing dependencies (first run only)... && call npm install
call npm run dev -- --open
