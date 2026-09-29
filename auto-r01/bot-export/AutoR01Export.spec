# -*- mode: python ; coding: utf-8 -*-
# AutoR01Export.exe - ตัวส่งออก R01.102 รอบเดียวของ auto-r01 (สำเนาบอท it-anin/bot-export ที่ตัด Supabase ออก)
# build ด้วย build_exe.bat → ได้ ..\AutoR01Export.exe (ข้าง auto_r01_import.py) — ดู CLAUDE.md §Build
import os

a = Analysis(
    [os.path.join(SPECPATH, 'auto_r01_export.py')],
    pathex=[],
    binaries=[],
    datas=[],
    hiddenimports=[],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
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
    name='AutoR01Export',
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
    icon=[os.path.join(SPECPATH, 'appicon.ico')],
)
