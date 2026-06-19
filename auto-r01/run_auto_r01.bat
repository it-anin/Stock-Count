@echo off
chcp 65001 >nul
REM ===== Auto R01.102 import -> Firestore =====
REM เรียกโดย Windows Task Scheduler ทุกวัน 08:10
REM log สะสมที่ auto_r01.log ในโฟลเดอร์เดียวกัน

set "PYEXE=C:\Program Files\Python311\python.exe"
if not exist "%PYEXE%" set "PYEXE=python"

"%PYEXE%" "%~dp0auto_r01_import.py" >> "%~dp0auto_r01.log" 2>&1
