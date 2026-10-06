@echo off
cd /d "%~dp0"
if not exist .venv (
  echo Eerste keer: Python-omgeving installeren, dit duurt een paar minuten...
  python -m venv .venv
  .venv\Scripts\python -m pip install --upgrade pip
  .venv\Scripts\python -m pip install -r requirements.txt
)
start "" http://localhost:8000
:loop
.venv\Scripts\python server.py
echo Het programma is gestopt. Over 10 seconden automatisch opnieuw starten (sluit dit venster om echt te stoppen)...
timeout /t 10 /nobreak >nul
goto loop
