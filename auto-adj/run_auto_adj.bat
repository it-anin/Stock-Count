@echo off
REM ============================================================
REM  Auto import R14.102 (LOT/EXP) + R05.105 (price level 4) -> Supabase
REM  Called daily by Windows Task Scheduler, after the ProMaxx export task
REM  has written both CSV files. This script does not care what time it runs,
REM  it only checks that each CSV was written today. See README.md.
REM
REM  KEEP THIS FILE PURE ASCII.
REM  Thai text in a .bat breaks the cmd.exe parser (it re-reads the file by byte
REM  offset, so multi-byte characters split lines into garbage commands).
REM  All Thai documentation lives in README.md instead.
REM
REM  Needs the Supabase service_role key, either:
REM      setx SUPABASE_SERVICE_KEY "<key>"
REM  or a file named .env next to this script containing one line:
REM      SUPABASE_SERVICE_KEY=<key>
REM  Never commit that file (it is in .gitignore).
REM
REM  CSV folder defaults to %USERPROFILE%\Desktop\run-upload-stock -- the same folder
REM  auto-r01 and auto-r05 watch. R05.105 (this bot) and R05.106 (auto-r05) share the
REM  "R05" name prefix but are different reports with different columns, so the export
REM  MUST use fixed names with no date suffix (R14.102.CSV / R05.105.CSV / R05.106.CSV)
REM  and auto-r05 must be the build that globs R05*106*.CSV. See README.md.
REM  If a machine keeps the files elsewhere, set it once:
REM      setx AUTO_ADJ_WATCH_FOLDER "D:\some\other\run-upload-stock"
REM ============================================================

set "LOG=%~dp0auto_adj.log"

REM --- log rotation: must happen before the >> handle is opened ---
if exist "%LOG%" (
  for %%F in ("%LOG%") do if %%~zF GTR 2097152 (
    if exist "%LOG%.1" del /q "%LOG%.1"
    move /y "%LOG%" "%LOG%.1" >nul
  )
)

REM --- locate Python: known install dirs, then PATH, then the py launcher ---
set "PYEXE="
for %%C in (
  "C:\Program Files\Python311\python.exe"
  "C:\Program Files\Python312\python.exe"
  "C:\Program Files\Python313\python.exe"
) do if not defined PYEXE if exist %%C set "PYEXE=%%~C"

if not defined PYEXE for /f "delims=" %%P in ('where python 2^>nul') do if not defined PYEXE set "PYEXE=%%P"
if not defined PYEXE for /f "delims=" %%P in ('where py 2^>nul') do if not defined PYEXE set "PYEXE=%%P"

REM Redirect is written BEFORE the echo on purpose. Trailing "%VAR%>> file" is a batch trap:
REM if the value ends in a digit, cmd reads it as a file-descriptor redirect (0>>, 2>> ...)
REM and the text escapes to the console instead of the log.
if not defined PYEXE (
  >>"%LOG%" echo [%DATE% %TIME%] ERROR: Python not found on this machine.
  >>"%LOG%" echo [%DATE% %TIME%] Install from https://www.python.org/downloads/ and tick "Add python.exe to PATH".
  exit /b 9
)

>>"%LOG%" echo [%DATE% %TIME%] --- run start on %COMPUTERNAME% as %USERNAME% using "%PYEXE%"
"%PYEXE%" "%~dp0auto_adj_import.py" %* >> "%LOG%" 2>&1
set "RC=%ERRORLEVEL%"
>>"%LOG%" echo [%DATE% %TIME%] --- run end, exit code %RC%
exit /b %RC%
