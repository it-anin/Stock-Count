@echo off
REM ============================================================
REM  Run PromaxxHelper from the Python source (development / calibration machine).
REM  Production machines use PromaxxHelper.exe (see build_exe.bat) - no Python needed there.
REM  Needs: python -m pip install pywin32 psutil pillow
REM  Pass options straight through, for example:
REM      run_promaxx_helper.bat --find
REM      run_promaxx_helper.bat --inspect --label S1-login
REM
REM  KEEP THIS FILE PURE ASCII (Thai text breaks the cmd.exe parser). Thai documentation lives in README.md.
REM ============================================================
setlocal
cd /d "%~dp0"

set "PYEXE="
for %%C in (
  "C:\Program Files\Python311\python.exe"
  "C:\Program Files\Python312\python.exe"
  "C:\Program Files\Python313\python.exe"
) do if not defined PYEXE if exist %%C set "PYEXE=%%~C"

if not defined PYEXE for /f "delims=" %%P in ('where python 2^>nul') do if not defined PYEXE set "PYEXE=%%P"
if not defined PYEXE for /f "delims=" %%P in ('where py 2^>nul') do if not defined PYEXE set "PYEXE=%%P"

if not defined PYEXE (
  echo ERROR: Python not found on this machine.
  echo Install from https://www.python.org/downloads/ and tick "Add python.exe to PATH".
  exit /b 9
)

"%PYEXE%" "%~dp0promaxx_helper.py" %*
exit /b %ERRORLEVEL%
