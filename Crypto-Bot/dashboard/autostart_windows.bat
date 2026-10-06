@echo off
rem Zet de bot in de opstartmap: hij start dan vanzelf als je inlogt op Windows.
set "DIR=%~dp0"
set "LNK=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\Crypto-bot.lnk"
powershell -NoProfile -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut('%LNK%'); $s.TargetPath='%DIR%start_windows.bat'; $s.WorkingDirectory='%DIR%'; $s.WindowStyle=7; $s.Save()"
echo Klaar. De bot start voortaan vanzelf als je inlogt. Verwijderen: verwijder Crypto-bot uit de map shell:startup
pause
