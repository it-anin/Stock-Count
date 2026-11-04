@echo off
REM ============================================================
REM  Create a Startup shortcut so PromaxxHelper.exe starts (minimized) when this Windows user logs on.
REM  Run it once per ProMaxx machine, as the user who works at that machine (not as another admin).
REM  To undo: delete PromaxxHelper.lnk from the folder opened by  explorer shell:startup
REM
REM  KEEP THIS FILE PURE ASCII (Thai text breaks the cmd.exe parser). Thai documentation lives in README.md.
REM ============================================================
setlocal
if not exist "%~dp0PromaxxHelper.exe" (
  echo ERROR: PromaxxHelper.exe not found next to this file.
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Startup')+'\PromaxxHelper.lnk'); $s.TargetPath='%~dp0PromaxxHelper.exe'; $s.WorkingDirectory='%~dp0'; $s.WindowStyle=7; $s.Save()"
if errorlevel 1 (
  echo FAILED to create the Startup shortcut.
  exit /b 1
)

echo Done. Startup shortcut created: PromaxxHelper.lnk
echo PromaxxHelper will start (minimized) the next time this user logs on.
exit /b 0
