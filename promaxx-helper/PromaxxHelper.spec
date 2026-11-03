# -*- mode: python ; coding: utf-8 -*-
# PromaxxHelper.exe - ตัวช่วยของปุ่ม "บันทึกลง PROMAXX" (หน้า 📦 ปรับปรุงสินค้า ใน index.html)
# build ด้วย build_exe.bat → ได้ PromaxxHelper.exe ข้างไฟล์นี้ — ดู README.md §ติดตั้ง
import os

a = Analysis(
    [os.path.join(SPECPATH, 'promaxx_helper.py')],
    pathex=[SPECPATH],
    binaries=[],
    datas=[],
    # promaxx_win.py ถูก import ใน main() แบบ lazy · win32*/psutil/PIL ถูก import ภายใน WinAdapter → ระบุไว้กัน PyInstaller มองไม่เห็น
    hiddenimports=['promaxx_win', 'promaxx_uia', 'win32api', 'win32con', 'win32gui', 'win32process', 'win32security', 'psutil',
                   'PIL.Image', 'PIL.ImageDraw', 'PIL.ImageGrab'],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=['tkinter', 'numpy', 'cv2', 'pyautogui'],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name='PromaxxHelper',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
