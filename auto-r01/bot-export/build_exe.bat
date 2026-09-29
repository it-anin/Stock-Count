@echo off
REM ============================================================
REM  Build AutoR01Export.exe
REM  (export-only copy of the it-anin/bot-export bot: one round, no Supabase)
REM
REM  Output: ..\AutoR01Export.exe  - next to auto_r01_import.py,
REM          which is where auto-r01 looks for it by default.
REM  Needs:  python -m pip install pywin32 psutil pyautogui pyinstaller
REM
REM  KEEP THIS FILE PURE ASCII (Thai text breaks the cmd.exe parser).
REM  Thai documentation lives in CLAUDE.md next to this file.
REM ============================================================
setlocal
cd /d "%~dp0"

python -m PyInstaller "%~dp0AutoR01Export.spec" --noconfirm --clean --distpath "%~dp0.." --workpath "%~dp0build"
if errorlevel 1 (
  echo BUILD FAILED
  exit /b 1
)

echo.
"%~dp0..\AutoR01Export.exe" --version
exit /b %ERRORLEVEL%
