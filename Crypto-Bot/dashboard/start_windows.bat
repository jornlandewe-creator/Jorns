@echo off
cd /d "%~dp0"
where python >nul 2>nul || (echo Python niet gevonden. Installeer Python 3.11 of nieuwer van python.org en vink "Add Python to PATH" aan. & pause & exit /b 1)
if not exist .venv (
  echo Eerste keer: Python-omgeving installeren, dit duurt een paar minuten...
  python -m venv .venv || (echo Kon geen Python-omgeving maken. & pause & exit /b 1)
  .venv\Scripts\python -m pip install --upgrade pip
  .venv\Scripts\python -m pip install -r requirements.txt || (echo Installeren mislukt, zie de melding hierboven. Probeer: .venv\Scripts\python -m pip install -r requirements.txt & pause & exit /b 1)
)
if not exist poort.txt echo 8001> poort.txt
set /p PORT=<poort.txt
start "" http://localhost:%PORT%
:loop
.venv\Scripts\python server.py
echo Het programma is gestopt. Over 10 seconden automatisch opnieuw starten (sluit dit venster om echt te stoppen)...
timeout /t 10 /nobreak >nul
goto loop
