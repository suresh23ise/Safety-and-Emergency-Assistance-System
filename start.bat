@echo off
title Safety ^& Emergency Assistance System
cd /d "%~dp0"
echo Installing dependencies (first run only)...
python -m pip install --quiet -r requirements.txt
echo.
echo Starting Safety ^& Emergency Assistance System...
python run.py
pause
