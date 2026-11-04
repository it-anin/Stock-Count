@echo off
REM ============================================================
REM  Build PromaxxHelper.exe
REM  (helper for the "Save to PROMAXX" button in the stock-adjustment popup of index.html)
REM
REM  Output: PromaxxHelper.exe next to this file.
REM  Needs:  python -m pip install pywin32 psutil pillow pyinstaller
REM
REM  KEEP THIS FILE PURE ASCII (Thai text breaks the cmd.exe parser).
REM  Thai documentation lives in README.md next to this file.
REM ============================================================
setlocal
cd /d "%~dp0"

REM  "%~dp0" ends with a backslash, so "%~dp0" would escape the closing quote ("...\" becomes a literal quote)
REM  and break --distpath. Use "%~dp0." (ends with a dot) for any argument that must end at the folder itself.
python -m PyInstaller "%~dp0PromaxxHelper.spec" --noconfirm --clean --distpath "%~dp0." --workpath "%~dp0build"
if errorlevel 1 (
  echo BUILD FAILED
  exit /b 1
)

echo.
"%~dp0PromaxxHelper.exe" --version
exit /b %ERRORLEVEL%
