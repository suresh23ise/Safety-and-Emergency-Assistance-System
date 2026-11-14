@echo off
title Aegis Assist
cd /d "%~dp0"
echo Installing dependencies (first run only)...
python -m pip install --quiet -r requirements.txt
echo.
echo Starting Aegis Assist...
python run.py
pause
