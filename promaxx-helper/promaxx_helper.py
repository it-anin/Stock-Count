# -*- coding: utf-8 -*-
r"""
PromaxxHelper — ตัวช่วยบนเครื่อง ProMaxx ให้ปุ่ม "บันทึกลง PROMAXX" ของหน้า 📦 ปรับปรุงสินค้า (index.html) ใช้งานได้

ทำไมต้องมี: หน้าเว็บ (เบราว์เซอร์) สั่งเปิด/คลิกโปรแกรม Windows โดยตรงไม่ได้ จึงมีโปรแกรมเล็กๆ นี้รันบนเครื่องเดียวกับ ProMaxx
คอยฟังคำสั่งที่ 127.0.0.1 (เฉพาะในเครื่อง) แล้วขับหน้าต่าง ssmaxx.exe ตามขั้นตอน:

    เปิด ssmaxx.exe → ล็อกอิน (ครั้งเดียว ไม่ retry) → เมนูเอกสารรับ/เอกสารจ่าย → ปุ่ม I/O
    → ตั้งประเภทเอกสาร (ORDS=ใบปรับปรุงลดสินค้า · IRPS=ใบปรับปรุงเพิ่มสินค้า) → ตั้งคลังสินค้าเป็น Front Store → ปุ่ม "นำเข้าไฟล์เอกสาร" → หยุด

ขั้นที่ 1 (ไฟล์นี้) หยุดที่ปุ่ม "นำเข้าไฟล์เอกสาร" โดยตั้งใจ — ยังไม่เลือกไฟล์ ไม่นำเข้า ไม่บันทึก (ดู README.md และ CLAUDE.md §🖥️)
ขั้น doc-type/warehouse (รุ่น .5) เลือกค่าลงในฟอร์มที่ "ยังไม่บันทึก" เท่านั้น (ผู้ใช้สั่ง 3 พ.ย. 2026) · คลังต้องเป็น Front Store เท่านั้น (ผู้ใช้สั่ง)

⛔ กติกาห้ามละเมิด (แก้โค้ดแล้วต้องไม่ทำให้ข้อใดหาย):
  1. หน้าเว็บส่งได้แค่ type = ORDS | IRPS — ไม่รับ path/คำสั่ง/รหัสผ่านจากเว็บ (field แปลกปลอม = 400)
  2. รับคำสั่งจาก Origin ที่อยู่ใน allow-list เท่านั้น + ตรวจ Host (กัน DNS rebinding) + บังคับ header X-Anin-Helper (บังคับ preflight)
  3. ขับเฉพาะหน้าต่างของ process ssmaxx.exe · foreground ต้องเป็นของ ssmaxx ก่อนพิมพ์/คลิกทุกครั้ง · พบ control ต้อง "1 รายการพอดี" ไม่เดา
  4. ล็อกอินครั้งเดียว ห้าม retry อัตโนมัติ (กันบัญชีถูกล็อก) · รหัสผ่านห้ามลง log/ผลลัพธ์/screenshot
  5. ssmaxx.exe เปิดอยู่แล้ว = ปฏิเสธ ไม่แตะอะไร (โปรแกรมเปิดซ้อนไม่ได้อยู่แล้ว · ผู้ใช้เลือก 3 พ.ย. 2026)
  6. LOCATORS_VERIFIED = False → ปฏิเสธคลิกจริงจากเว็บ (UNVERIFIED) · จะเป็น True ได้ต่อเมื่อตรวจกับหน้าต่าง ssmaxx.exe จริงครบแล้วเท่านั้น
     (ตั้งเป็น True แล้วตั้งแต่รุ่น 2026-11-04.4 — แก้ STEP_SPECS/ProMaxx อัปเดตหน้าตา = ตั้ง False ระหว่างตรวจใหม่)
  7. หลังคลิกปุ่ม "นำเข้าไฟล์เอกสาร" ห้ามส่ง input เพิ่ม (ขั้นถัดไปต้องขออนุมัติ)
  7b. ก่อนคลิกปุ่มนำเข้า ต้องอ่านกลับได้ครบ: ประเภทเอกสารตรงชื่อ · เลขที่เอกสารขึ้นต้นรหัสประเภท · คลัง = Front Store — ไม่ตรงข้อใด = หยุด
      ห้ามเดา/ห้ามเชื่อค่าเริ่มต้นของฟอร์ม (ProMaxx เปิดฟอร์มมาเป็นประเภท/คลังต่างกันได้) · เลือกค่าในหน้าต่างรายการต้องเจอแถว "ชื่อตรงทุกตัวอักษร 1 แถวพอดี"
      และเครื่องหมายเลือกแถวต้องย้ายมาที่แถวนั้นก่อนกด "ตกลง" · หน้าต่างรายการเป็นหน้าต่างระดับบนใหม่ทุกครั้ง (hwnd/GUID เปลี่ยน) หาจากชื่อ ไม่จำ hwnd
  8. ไม่ขับ ProMaxx ซ้อนกับบอทอื่นที่แย่งเมาส์/คีย์บอร์ด (BLOCK_PROCS)
  9. ssmaxx.exe เป็นแอป WPF (ไม่มี HWND/HMENU ข้างใน) → หาเป้าด้วย UIA (promaxx_uia.py) เท่านั้น · เป้าต้อง "พบ 1 รายการพอดี" ที่
     มองเห็นอยู่จริง (ไม่ใช่แค่ IsOffscreen=False — ปุ่มที่เลื่อนไปนอกกรอบหน้าต่างยังรายงาน False) · ต้องตรวจคลาสของหน้าแม่และ HelpText
     ก่อนคลิกปุ่มที่ id ซ้ำข้ามหน้าได้ (ปุ่มนำเข้าไฟล์มีทั้งฟอร์มเอกสารรับ/จ่ายและฟอร์มโอนสินค้า) · พิมพ์ได้เมื่อช่องที่ถูกต้องรับโฟกัสแล้วเท่านั้น

ไฟล์นี้ไม่ import win32*/psutil เลย (ตัวต่อ Windows อยู่ promaxx_win.py + promaxx_uia.py) ⇒ เทสบน Linux ได้ด้วยตัวต่อปลอม

exit code: 0 สำเร็จ · 1 ไม่สำเร็จ · 2 ตัวเลือกผิด/ตั้งค่าไม่ครบ · 3 ไม่ได้ทำอะไร (มีตัวช่วยอื่น/ProMaxx เปิดอยู่/พอร์ตถูกใช้)
"""
import argparse
import json
import os
import re
import shlex
import sys
import threading
import time
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# ประวัติรุ่น (แก้โค้ดแล้วเปลี่ยนเลขนี้ทุกครั้ง — ใช้ตรวจด้วย --version ว่าวางไฟล์ถูกรุ่น)
#   2026-11-03.1  รุ่นแรก: โครง + เซิร์ฟเวอร์ + เครื่องมือตรวจ (--find/--inspect) · ขั้นตอนคลิกยังไม่มี locator (รอตรวจหน้าต่างจริง)
#   2026-11-03.2  เพิ่ม UIA (promaxx_uia.py · kind:"uia" · เงื่อนไข uia/uia_gone · action await) + เติม STEP_SPECS จากการตรวจจริง (ยังไม่เคยคลิกจริง)
#   2026-11-03.3  focus() ไม่ย่อหน้าต่างที่ขยายเต็มจอ (SW_RESTORE เฉพาะตอนหน้าต่างถูกย่ออยู่)
#   2026-11-03.4  focus() ดึงขึ้นหน้าสุดได้จริงเมื่อโปรเซสอื่น (เบราว์เซอร์/Claude) อยู่หน้า: ผูกเธรด + BringWindowToTop · ปลดการผูกใน finally
#   2026-11-03.5  ขั้นใหม่ doc-type-*/warehouse-* (ตั้งประเภทเอกสารตามชนิด + คลัง Front Store ผ่านหน้าต่างรายการ) · skip_if · action pick_row/note
#                 · name_re · โทเคนดิบ {=ชื่อ} · import-button ตรวจอ่านกลับก่อนคลิก (ยังไม่เคยคลิกจริง)
#   2026-11-04.1  ขั้น launch เปิดผ่าน ProMaxx.exe (ตัวเปิดโปรแกรมที่ทางลัดของพนักงานใช้) แทน ssmaxx.exe ตรงๆ — เปิดตรงแล้ว ProMaxx แจ้ง
#                 "Application to the program is open to change." ไม่ไปหน้า Login (เจอจริง 4 พ.ย. 2026) · PROMAXX_LAUNCH_DIRECT=1 = เปิดตรงตามเดิม
#                 · ด่าน "โปรแกรมปิดตัวเอง" แยก 2 แบบ: ไม่เคยเห็นโปรเซส ssmaxx รอได้ 30 วินาที (ตัวเปิดโปรแกรมช้า) · เห็นแล้วหายเกิน 6 วินาที = หยุด
#   2026-11-04.2  กู้หน้าต่าง ProMaxx ที่ถูกย่อ (พิกัด ≈ -32000) ก่อนตรวจเงื่อนไขของทุกขั้น — เดิมด่านก่อนเริ่มอ่านปุ่มไม่เห็นแล้วล้ม PRECONDITION_FAILED
#                 และ _ensure_focus ข้ามเพราะหน้าต่างที่ถูกย่อยังนับเป็น foreground · dry-run ไม่กู้ (แจ้งข้อความชัดเจน) · กู้ไม่สำเร็จ = FOCUS_LOST ไม่คลิก
#   2026-11-04.3  ตัวรับคำขอ HTTP ไม่ตัดการเชื่อมต่อที่ว่างเร็วเกินไป (15 → 200 วินาที): เบราว์เซอร์ถือการเชื่อมต่อรอคนกด Allow ของ Local Network Access
#                 ถ้ากดช้ากว่า 15 วินาที คำขอแรกล้ม (Failed to fetch) ทั้งที่สิทธิ์เป็น granted — เจอจากการทดสอบ Chrome/Edge จริง
#   2026-11-04.4  LOCATORS_VERIFIED = True (ผู้ใช้ยืนยัน 4 พ.ย. 2026 หลัง Gate 0 + สายเต็มเบราว์เซอร์→ProMaxx บน Chrome/Edge จริง) — ไม่แก้ตรรกะอื่น
VERSION = "2026-11-04.4"
PROTO = 1
DEFAULT_PORT = 47831
PROD_ORIGIN = "https://anin-stock-count.vercel.app"
MAX_BODY = 2048

# ✅ True ตั้งแต่ 2026-11-04.4 (ผู้ใช้ยืนยัน 4 พ.ย. 2026) หลังตรวจกับ ssmaxx.exe จริงครบ: ORDS×10 + IRPS×10 จาก cold start 20/20 · เคสขอบ (รหัสผิดด้วยชื่อปลอม · เปิดซ้อน ·
# เมาส์แทรก · กล่องแทรก · หน้าต่างถูกย่อ) · ขั้นประเภท/คลังคลิกจริงทั้งสองฟอร์ม · สายเต็มจาก Chrome/Edge จริง (ผลละเอียดอยู่ README.md §ผลตรวจจริง)
# ⛔ ห้ามปล่อยเป็น True หลังแก้ STEP_SPECS หรือเมื่อ ProMaxx อัปเดตหน้าตา/id — ตั้ง False ระหว่างตรวจ Gate 0 ใหม่ แล้วค่อยตั้ง True เมื่อมีผลตรวจ
LOCATORS_VERIFIED = True

PROC_NAME = "ssmaxx.exe"
# ทางลัด "ProMaxx" ที่พนักงานใช้ชี้ไป ProMaxx.exe (ตัวเปิดโปรแกรม) ซึ่งเปิด ssmaxx.exe ต่อให้ · เปิด ssmaxx.exe ตรงๆ แล้วได้กล่อง
# "Application to the program is open to change." (ตรวจจริง 4 พ.ย. 2026: 20/20 รอบเปิดผ่าน ProMaxx.exe ได้หน้า Login ใน ~8 วินาที)
# ซ็อกเก็ตที่เชื่อมต่อแล้วแต่ยังไม่ส่งคำขอ: Chrome/Edge ตรวจสิทธิ์ Local Network Access "หลังเชื่อมต่อ TCP" แล้วถือการเชื่อมต่อไว้ระหว่างรอคนกด Allow
# ถ้าตัวช่วยตัดการเชื่อมต่อก่อนคนกด (เดิม 15 วินาที) คำขอแรกล้ม ERR_SOCKET_NOT_CONNECTED/LocalNetworkAccessPermissionDenied ทั้งที่สิทธิ์เป็น granted
# (ตรวจจริง 4 พ.ย. 2026: กด Allow ที่ ~8 วินาที สำเร็จ · ที่ 26/39 วินาที ล้ม) ⇒ ต้อง ≥ เวลารอของหน้าเว็บ (PROMAXX_HELPER_TIMEOUT_MS = 180 วินาที)
# ตัวเลขนี้ไม่กระทบเวลาทำงานของงาน (ใช้กับการรอข้อมูลบนซ็อกเก็ตเท่านั้น) · ฟังเฉพาะ 127.0.0.1 จึงไม่เปิดช่อง slowloris ให้เครื่องอื่น
IDLE_CONN_TIMEOUT = 200
MINIMIZED_LEFT = -30000     # พิกัดซ้ายของหน้าต่างที่ถูกย่อ (Windows ให้ -32000 ทั้ง Win32 และ UIA) — ไม่ใช่หน้าต่างที่มองเห็นได้จริง
LAUNCHER_NAME = "ProMaxx.exe"
LAUNCH_SPAWN_GRACE = 30      # วินาที: สั่งเปิดแล้วยังไม่เคยเห็นโปรเซส ssmaxx เลย — รอตัวเปิดโปรแกรมได้เท่านี้ก่อนตัดสินว่าล้ม
LAUNCH_VANISH_GRACE = 6      # วินาที: เคยเห็นโปรเซส ssmaxx แล้วหายไปเกินนี้ = โปรแกรมปิดตัวเอง (เผื่อกะพริบตอนตัวเปิดโปรแกรมรีสตาร์ท)
JOB_MUTEX = "Local\\AninPromaxxHelperJob"        # กันสองโปรเซสขับ ProMaxx พร้อมกัน (เช่น --open ระหว่างที่ --serve กำลังทำงาน)
SERVE_MUTEX = "Local\\AninPromaxxHelperServe"    # กันเปิดตัวช่วยซ้อนกัน
DEFAULT_BLOCK_PROCS = ("seniorsoftexport.exe", "autor01export.exe")   # บอทที่ใช้เมาส์/คีย์บอร์ดจริง — ห้ามแย่งกัน
EXE_CANDIDATES = (
    r"C:\SeniorSoft ProMaxx\ssmaxx.exe",
    r"C:\Program Files (x86)\SeniorSoft ProMaxx\ssmaxx.exe",
    r"C:\Program Files\SeniorSoft ProMaxx\ssmaxx.exe",
)
EXIT_OK, EXIT_FAILED, EXIT_CONFIG, EXIT_BUSY = 0, 1, 2, 3

# ชนิดเอกสาร → ข้อความไทย/อักษรปุ่ม (ผู้ใช้ระบุ 3 พ.ย. 2026: IRPS = เอกสารรับ = อักษร I · ORDS = เอกสารจ่าย = อักษร O)
#   menu_cls = คลาสของหน้าเมนูย่อยที่ปุ่ม I/O อยู่ · form_cls = คลาสของฟอร์มเอกสารที่เปิดหลังกดปุ่ม (ตรวจจริง 3 พ.ย. 2026 — UIA ClassName)
#   code/type_name = รหัสและชื่อประเภทเอกสารที่ต้องตั้งก่อนนำเข้า (ผู้ใช้ระบุ 3 พ.ย. 2026: IRPS=ใบปรับปรุงเพิ่มสินค้า · ORDS=ใบปรับปรุงลดสินค้า ·
#   ชื่อ/รหัสในหน้าต่างรายการตรวจจริงแล้ว: แถวชื่อ "ORDS ใบปรับปรุงลดสินค้า" / "IRPS ใบปรับปรุงเพิ่มสินค้า")
#   ⚠️ ค่าทุกตัวต้องไม่มีอักขระพิเศษของ regex (เทสตรึง re.escape(v)==v) เพราะถูกแทนเข้า spec ผ่าน _fmt ที่ escape ให้
#      (ค่าที่มีช่องว่าง เช่นชื่อแถว "ORDS ใบปรับปรุงลดสินค้า" ไม่อยู่ที่นี่ — ประกอบใน Runner._run แล้วใช้โทเคนดิบ {=type_row})
DOC_TYPES = {
    "ORDS": {"letter": "O", "menu_th": "เอกสารจ่าย", "menu_cls": "ui_mainmenu_tranout_style2", "form_cls": "pn_trans_out",
             "code": "ORDS", "type_name": "ใบปรับปรุงลดสินค้า"},
    "IRPS": {"letter": "I", "menu_th": "เอกสารรับ", "menu_cls": "ui_mainmenu_tranin_style2", "form_cls": "pn_trans_in",
             "code": "IRPS", "type_name": "ใบปรับปรุงเพิ่มสินค้า"},
}
WAREHOUSE_NAME = "Front Store"      # คลังเดียวที่ยอมให้นำเข้า (ผู้ใช้สั่ง 3 พ.ย. 2026 "เลือกเป็น Front Store เท่านั้น") — ห้ามเพิ่มทางเลือกอื่น
UIA_MAX_ERRORS = 3          # อ่าน UIA ล้มติดกันกี่ครั้งในลูปรอเงื่อนไขก่อนยอมแพ้ (ครั้งเดียวอาจเป็นช่วงโปรแกรมกำลังเปิด)

# ลำดับขั้นตอนจริง (preflight ทำก่อนเสมอ) · doc-type-* / warehouse-* = เปิดหน้าต่างรายการ → เลือกแถว → ตกลง (แยกขั้นเพื่อให้ --dry-run ดูเป้าของแต่ละคลิกได้)
STEP_ORDER = ("launch", "login", "menu", "doc-button",
              "doc-type-open", "doc-type-pick", "doc-type-ok", "warehouse-open", "warehouse-pick", "warehouse-ok",
              "import-button")
IMPORT_STEP = STEP_ORDER[-1]                                              # ขั้นสุดท้าย — หลังขั้นนี้ห้ามมี input เพิ่ม

HTTP_STATUS = {
    "BAD_REQUEST": 400, "PROTO_MISMATCH": 400, "FORBIDDEN_HOST": 403, "FORBIDDEN_ORIGIN": 403, "FORBIDDEN_HEADER": 403,
    "NOT_FOUND": 404, "METHOD_NOT_ALLOWED": 405, "PAYLOAD_TOO_LARGE": 413, "UNSUPPORTED_MEDIA": 415,
    "BUSY": 409, "ALREADY_RUNNING": 409, "OTHER_BOT_RUNNING": 409, "NOT_RUNNING": 409,
    "NOT_CONFIGURED": 422, "UNSUPPORTED_DPI": 422, "UNVERIFIED": 422, "NO_DESKTOP": 422,
}   # รหัสอื่น (LAUNCH_FAILED · LOGIN_FAILED · STEP_FAILED · LOCATOR_* · …) = 500


# ─────────────────────────────────────────────────────────────
# ข้อมูลหน้าต่าง/เมนู (adapter คืนค่าเป็นสองชนิดนี้ — ตัวต่อ Windows รับคลาสเข้าไปสร้างเอง ไม่ import ไฟล์นี้)
# ─────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class WinInfo:
    hwnd: int
    cls: str = ""
    text: str = ""
    rect: tuple = (0, 0, 0, 0)       # (ซ้าย, บน, ขวา, ล่าง) พิกัดหน้าจอ
    visible: bool = True
    enabled: bool = True
    ctrl_id: int = 0
    pid: int = 0
    parent: int = 0                  # 0 = หน้าต่างระดับบน

    @property
    def w(self):
        return self.rect[2] - self.rect[0]

    @property
    def h(self):
        return self.rect[3] - self.rect[1]


@dataclass(frozen=True)
class MenuItem:
    path: tuple                      # ("เอกสาร", "เอกสารรับ") — ข้อความหลังตัด & และ \tคีย์ลัด
    id: int = 0                      # รหัสคำสั่ง (WM_COMMAND) · 0 = หัวข้อที่มีเมนูย่อย/เส้นคั่น
    enabled: bool = True
    submenu: bool = False


@dataclass(frozen=True)
class UiaEl:
    """องค์ประกอบหนึ่งชิ้นจาก UIA (promaxx_uia.PsUia.find) — ไม่มี 'ค่าที่พิมพ์ในช่อง' โดยตั้งใจ"""
    id: str = ""                     # AutomationId
    type: str = ""                   # ControlType เช่น Button / ListItem / Custom / Edit / TabItem
    name: str = ""
    help: str = ""                   # HelpText (WPF เปิดเผยข้อความ tooltip ผ่านช่องนี้)
    cls: str = ""                    # ClassName
    rect: tuple | None = None        # (ซ้าย, บน, ขวา, ล่าง) พิกัดหน้าจอ · None = ไม่มีพิกัด
    enabled: bool = True
    offscreen: bool = False          # ⚠️ ไม่น่าเชื่อถือคนเดียว: องค์ประกอบที่เลื่อนไปนอกกรอบหน้าต่างยังรายงาน False → ต้องเช็คพิกัดด้วย
    focusable: bool = False
    focused: bool = False
    password: bool = False
    parents: tuple = ()              # ((AutomationId, ClassName), …) ใกล้ → ไกล (สูงสุด 8 ชั้น)


class HelperError(Exception):
    """ข้อผิดพลาดที่รู้สาเหตุ — มี code ที่หน้าเว็บ map เป็นข้อความได้"""

    def __init__(self, code, message, step="", detail=None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.step = step
        self.detail = detail

    @property
    def http(self):
        return HTTP_STATUS.get(self.code, 500)


# ─────────────────────────────────────────────────────────────
# log (รหัสผ่านต้องไม่หลุดลงไฟล์/หน้าจอ/ผลลัพธ์)
# ─────────────────────────────────────────────────────────────

class Logger:
    def __init__(self, path=None, echo=True, keep=False, max_bytes=1024 * 1024):
        self.path = path
        self.echo = echo
        self.keep = keep                 # เก็บบรรทัดไว้ใน self.lines (ใช้ในเทส)
        self.lines = []
        self._secrets = []
        self._lock = threading.Lock()
        if path:
            try:
                if os.path.exists(path) and os.path.getsize(path) > max_bytes:
                    os.replace(path, path + ".1")
            except OSError:
                pass

    def add_secret(self, s):
        s = str(s or "")
        if s and s not in self._secrets:
            self._secrets.append(s)

    def scrub(self, text):
        text = str(text)
        for s in self._secrets:
            text = text.replace(s, "***")
        return text

    def __call__(self, msg):
        line = "%s %s" % (time.strftime("%H:%M:%S"), self.scrub(msg))
        with self._lock:
            if self.keep:
                self.lines.append(line)
            if self.echo:
                try:
                    sys.stdout.write(line + "\n")
                    sys.stdout.flush()
                except Exception:
                    pass
            if self.path:
                try:
                    with open(self.path, "a", encoding="utf-8") as f:
                        f.write(time.strftime("%Y-%m-%d ") + line + "\n")
                except OSError:
                    pass


# ─────────────────────────────────────────────────────────────
# ค่าตั้ง (.env ข้าง exe) — repo Stock-Count เป็น PUBLIC ห้ามรหัสเข้า git
# ─────────────────────────────────────────────────────────────

@dataclass
class Settings:
    username: str = ""
    password: str = ""
    exe_path: str = ""
    exe_args: tuple = ()
    launch_direct: bool = False      # PROMAXX_LAUNCH_DIRECT=1 → เปิดไฟล์ที่ตั้งไว้ตรงๆ ไม่สลับเป็น ProMaxx.exe
    proc_name: str = PROC_NAME
    port: int = DEFAULT_PORT
    allowed_origins: tuple = (PROD_ORIGIN,)
    block_procs: tuple = DEFAULT_BLOCK_PROCS
    runs_dir: str = ""
    log_path: str = ""
    env_file: str = ""


def app_dir():
    if getattr(sys, "frozen", False):        # รันเป็น exe (PyInstaller)
        return os.path.dirname(sys.executable)
    return os.path.dirname(os.path.abspath(__file__))


def read_env_file(path):
    vals = {}
    try:
        with open(path, "r", encoding="utf-8-sig") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, val = line.split("=", 1)
                vals[key.strip()] = val.strip().strip('"').strip("'")
    except OSError:
        pass
    return vals


def _csv(text):
    return tuple(x.strip() for x in str(text or "").split(",") if x.strip())


def load_settings(base_dir=None, environ=None, warn=None):
    """ลำดับ: ตัวแปรระบบ → .env ข้าง exe/สคริปต์ · ค่าที่อ่านไม่ได้ใช้ค่าเริ่มต้น (แจ้งผ่าน warn)"""
    base_dir = base_dir or app_dir()
    environ = os.environ if environ is None else environ
    warn = warn or (lambda m: None)
    env_path = os.path.join(base_dir, ".env")
    file_vals = read_env_file(env_path) if os.path.isfile(env_path) else {}

    def get(key):
        return str(environ.get(key, "")).strip() or file_vals.get(key, "")

    s = Settings(runs_dir=os.path.join(base_dir, "runs"), log_path=os.path.join(base_dir, "promaxx_helper.log"),
                 env_file=env_path if file_vals else "")
    s.username, s.password, s.exe_path = get("PROMAXX_USERNAME"), get("PROMAXX_PASSWORD"), get("PROMAXX_EXE_PATH")
    args = get("PROMAXX_EXE_ARGS")
    if args:
        try:
            s.exe_args = tuple(shlex.split(args, posix=False))
        except ValueError:
            warn("PROMAXX_EXE_ARGS อ่านไม่ได้ — ไม่ส่ง argument ให้ ssmaxx.exe")
    s.launch_direct = get("PROMAXX_LAUNCH_DIRECT").lower() in ("1", "true", "yes", "on")
    s.proc_name = get("SSMAXX_PROC_NAME") or PROC_NAME
    port = get("HELPER_PORT")
    if port:
        try:
            p = int(port)
            if 1024 <= p <= 65535:
                s.port = p
            else:
                warn("HELPER_PORT ต้องอยู่ระหว่าง 1024–65535 — ใช้ %d" % DEFAULT_PORT)
        except ValueError:
            warn("HELPER_PORT ไม่ใช่ตัวเลข — ใช้ %d" % DEFAULT_PORT)
    extra = []
    for o in _csv(get("HELPER_ALLOWED_ORIGINS")):
        o = o.rstrip("/")
        if re.match(r"^https?://[^/*\s]+$", o):
            extra.append(o)
        else:
            warn("HELPER_ALLOWED_ORIGINS: ข้าม %r (ต้องเป็น http(s)://host[:port] ไม่มี * และไม่มี path)" % o)
    s.allowed_origins = tuple(dict.fromkeys((PROD_ORIGIN,) + tuple(extra)))
    blocks = _csv(get("HELPER_BLOCK_PROCS"))
    s.block_procs = tuple(b.lower() for b in blocks) if blocks else DEFAULT_BLOCK_PROCS
    return s


# ─────────────────────────────────────────────────────────────
# ข้อกำหนดขั้นตอน (STEP_SPECS) — ค่าทุกตัวมาจากการตรวจหน้าต่าง ssmaxx.exe จริง 3 พ.ย. 2026 (UIA · อ่านอย่างเดียว) ห้ามเดา id/คลาส/พิกัด
# ─────────────────────────────────────────────────────────────
# รูปแบบ (เทสใช้ชุดตัวอย่างเต็มของ Win32 ใน tests/lib/fake_ssmaxx.py และของ UIA ใน tests/lib/fake_ssmaxx_uia.py):
#   STEP_SPECS = {
#     "launch":  {"post": COND, "post_timeout": 60},
#     "login":   {"pre": COND, "actions": [ACTION, ...], "post": COND},
#     "menu" | "doc-button" | "doc-type-*" | "warehouse-*" | "import-button":
#               {"pre": COND, "actions": [...], "post": COND, "allow_dialogs": [regex], "skip_if": COND, "pre_what": "..", "pre_timeout": 15, "post_timeout": 20}
#               skip_if = เงื่อนไขจริง ณ ตอนเริ่มขั้น → ข้ามขั้นนั้นทั้งขั้น (ค่าตรงที่ต้องการอยู่แล้ว ไม่แตะอะไร) · อ่านอย่างเดียว
#   }
#   W      = {"cls": "ชื่อ class (ไม่สนตัวพิมพ์)" | None, "cls_re": "regex ของ class" | None, "title": "regex ของข้อความหน้าต่าง" | None}
#            หน้าต่างระดับบนของ ssmaxx เท่านั้น (WPF: class = HwndWrapper[ssmaxx.exe;;<GUID ที่เปลี่ยนทุกครั้ง>] → ต้องใช้ cls_re)
#   COND   = {"win": W} | {"gone": W} | {"ctl": {"within": W, "cls": .., "text": regex}} | {"all": [COND..]} | {"any": [COND..]}
#          | {"uia": SEL}        มีองค์ประกอบตรง SEL ที่ "มองเห็นอยู่จริง" อย่างน้อย 1 ชิ้น (และโฟกัสอยู่ถ้า SEL.focused)
#          | {"uia_gone": SEL}   ไม่มีองค์ประกอบตรง SEL ที่มองเห็นอยู่ (หายไป/ซ่อน/นอกกรอบหน้าต่าง)
#   SEL    = {"within": W, "id": "AutomationId" | ["id1","id2"(สูงสุด 4)], "type": "Button|ListItem|Custom|Edit|TabItem|List|…",
#             "name": "ชื่อตรงตัว", "name_re": "regex ของชื่อ (กรองฝั่งตัวช่วย · ต้องมี id/type/name คู่ด้วย)", "cls": "ClassName ตรงตัว", "help": "HelpText ตรงตัว",
#             "ancestor": {"id": "AutomationId ของหน้าแม่", "cls": "ClassName ของหน้าแม่"}  (อย่างน้อยหนึ่งชั้นในสายแม่ต้องตรงทุกคีย์ที่ระบุ),
#             "focused": True}    ต้องมี id/type/name อย่างน้อยหนึ่งอย่าง · ห้ามใช้ id ที่เป็นตัวเลข (เปลี่ยนทุกครั้งที่โหลดหน้า)
#   ACTION = {"do": "click", "target": T} | {"do": "type", "what": "username"|"password", "within": W}
#          | {"do": "key", "key": "enter"|"tab", "within": W} | {"do": "wait", "sec": 0.5}
#          | {"do": "await", "cond": COND, "timeout": 6, "what": "ข้อความเมื่อไม่ตรง"}   รอเงื่อนไข (เช่น ช่องรับโฟกัส) ก่อนทำต่อ · dry-run ข้าม
#          | {"do": "pick_row", "row": SEL, "list": "AutomationId ของ DataWindow ที่เก็บแถว"}   คลิกแถวในหน้าต่างรายการ (แถวต้องชื่อตรง 1 แถว ·
#            อยู่ในกรอบรายการจริง · อ่านเป้าซ้ำก่อนกด) แล้วต้องเห็นเครื่องหมายเลือกแถว p_1:N ของแถวนั้น ไม่เห็น = หยุด ไม่กด "ตกลง"
#          | {"do": "note", "sel": SEL, "label": "ป้าย"}   อ่านชื่อขององค์ประกอบลง log เท่านั้น (ไม่ตัดสินอะไร · ใช้กับ dry-run ได้)
#   T      = {"kind": "menu",    "within": W, "path": [regex, ...]}                              คลิกเมนูด้วย WM_COMMAND (ไม่ใช้เมาส์)
#          | {"kind": "control", "within": W, "cls": "Button", "text": regex, "via": "message"|"mouse"}
#          | {"kind": "point",   "within": W, "child_cls": None|"pbdw125", "index": n, "x": 0..1, "y": 0..1}   เมาส์จริง · เศษส่วนของ rect
#          | {"kind": "uia", ...SEL, "reverify": True}   เมาส์จริงที่กึ่งกลางพิกัดที่ UIA ให้ · reverify = อ่านซ้ำก่อนกด ถ้าเป้าขยับ >2px หยุด
#   ข้อความ/regex ใน spec ใส่ {menu_th} {letter} {menu_cls} {form_cls} {code} {type_name} ได้ (แทนด้วยค่าของชนิดเอกสาร · re.escape ให้)
#   ช่องที่เทียบ "ตรงตัว" (name/help) แล้วค่ามีช่องว่าง ใช้โทเคนดิบ {=type_row} (ไม่ escape) — ห้ามใช้โทเคนดิบในช่อง regex
#
# ที่มาของค่า (ตรวจจริง · README §ผลตรวจจริง): หน้า Login = uo_login_panel · ช่องชื่อผู้ใช้/รหัสผ่านสลับชนิดตามโฟกัส
# (cf_empid=TextBox ↔ cf_empid:1=DWTextBlock · cf_pass=PasswordBox ↔ cf_pass:1=DWTextBlock) · เมนูซ้าย = ListBox lbx_manumain (ListItem ไม่มี id → ใช้ชื่อ)
# · ปุ่ม I/O = Button id I/O ใต้หน้าเมนูคลาส ui_mainmenu_tranin/tranout_style2 · ฟอร์มเอกสารคลาส pn_trans_in/pn_trans_out ใต้แท็บ MDI_TAB
# · ปุ่มนำเข้า = uo_tran_bt_import (HelpText "นำเข้าไฟล์เอกสาร") — id นี้มีในฟอร์มโอนสินค้า pn_trans_tb_out ด้วย จึงต้องเช็คคลาสฟอร์ม
# · หลังกดปุ่มนำเข้า = กล่อง #32770 "Select File" (หน้าต่างหลักถูกล็อก)
# · ส่วนหัวฟอร์ม (ใต้ DataWindow uo_tran_dw_newmaster · เป็น DWTextBlock ชื่อ = ค่าที่เห็นบนจอ): SYSVOUCHERID:1 = ประเภทเอกสาร · TRANNO:1 = เลขที่เอกสาร ·
#   SYSBRANCHID:1 = สาขา · SYSWAREHOUSEID:1 = คลังสินค้า (id ตัวพิมพ์ใหญ่ — ตัวพิมพ์เล็ก sysvoucherid_t:1 อยู่ในตัวกรองที่ซ่อนอยู่)
# · คลิกช่องประเภท/คลัง → เปิดหน้าต่างระดับบนใหม่ (ชื่อ sfw_winrespond · UIA id w_popup_select_ddw) หน้าต่างหลักถูกล็อก · ในนั้น: หัวข้อ
#   (Text ใต้ uo_popupdw_st_title) · แถว col1:N (DWTextBlock ใต้ uo_popupdw_dw_datatmp · ชื่อ "รหัส ชื่อไทย" ของประเภทเอกสาร / "Front Store" ของคลัง) ·
#   เครื่องหมายเลือกแถว p_1:N (Image · เห็นเฉพาะแถวที่เลือก) · ปุ่ม cb_ok "ตกลง" / cb_exit "ออก" (ใต้ uo_popupdw_uo_buttonbar)
#   คลิกแถวอย่างเดียวไม่เปลี่ยนค่าในฟอร์ม ต้องกด "ตกลง" (แถวที่คลิกจะกลายเป็นช่อง Edit id=col1 ชื่อว่าง) · ตรวจจริง D1–D6/E1–E2 3 พ.ย. 2026
_MAIN ={"cls_re": r"^HwndWrapper\[ssmaxx\.exe;;", "title": r"^SeniorSoft ProMaxx$"}
_LOGIN_PANEL = {"within": _MAIN, "id": "uo_login_panel", "type": "Custom"}
_UNDER_LOGIN = {"id": "uo_login_panel"}
_USER_CELL = {"within": _MAIN, "id": ["cf_empid", "cf_empid:1"], "ancestor": _UNDER_LOGIN}
_USER_EDIT = {"within": _MAIN, "id": "cf_empid", "type": "Edit", "cls": "TextBox", "focused": True, "ancestor": _UNDER_LOGIN}
_PASS_CELL = {"within": _MAIN, "id": ["cf_pass", "cf_pass:1"], "ancestor": _UNDER_LOGIN}
_PASS_EDIT = {"within": _MAIN, "id": "cf_pass", "type": "Edit", "cls": "PasswordBox", "focused": True, "ancestor": _UNDER_LOGIN}
_LOGIN_BTN = {"within": _MAIN, "id": "cb_Login", "type": "Button", "ancestor": _UNDER_LOGIN}
_MAIN_MENU_ANY = {"within": _MAIN, "type": "ListItem", "name": "เอกสารรับ", "ancestor": {"id": "lbx_manumain"}}
_MENU_ITEM = {"within": _MAIN, "type": "ListItem", "name": "{menu_th}", "ancestor": {"id": "lbx_manumain"}}
_MENU_BTN = {"within": _MAIN, "id": "{letter}", "type": "Button", "ancestor": {"cls": "{menu_cls}"}}
_DOC_TAB = {"within": _MAIN, "type": "TabItem", "name": "{menu_th}", "ancestor": {"id": "MDI_TAB"}}
_IMPORT_BTN = {"within": _MAIN, "id": "uo_tran_bt_import", "type": "Button", "help": "นำเข้าไฟล์เอกสาร", "ancestor": {"cls": "{form_cls}"}}
_FILE_DIALOG = {"cls": "#32770", "title": r"^Select File$"}

# ── ส่วนหัวฟอร์ม + หน้าต่างรายการ (ประเภทเอกสาร / คลังสินค้า) ──
_FORM = {"cls": "{form_cls}"}
_TYPE_FIELD = {"within": _MAIN, "id": "SYSVOUCHERID:1", "type": "Custom", "ancestor": _FORM}
_TYPE_IS_TARGET = dict(_TYPE_FIELD, name="{type_name}")
_NUMBER_PREFIX = {"within": _MAIN, "id": "TRANNO:1", "type": "Custom", "name_re": "^{code}", "ancestor": _FORM}
_BRANCH_FIELD = {"within": _MAIN, "id": "SYSBRANCHID:1", "type": "Custom", "ancestor": _FORM}
_WH_FIELD = {"within": _MAIN, "id": "SYSWAREHOUSEID:1", "type": "Custom", "ancestor": _FORM}
_WH_IS_TARGET = dict(_WH_FIELD, name=WAREHOUSE_NAME)
# หน้าต่างรายการเป็นหน้าต่างระดับบนใบใหม่ทุกครั้ง (hwnd และ GUID ในชื่อคลาสเปลี่ยน) → หาจาก "ชื่อ" เท่านั้น
_PICKER = {"cls_re": r"^HwndWrapper\[ssmaxx\.exe;;", "title": r"^sfw_winrespond$"}
_PICKER_LIST = "uo_popupdw_dw_datatmp"
_TYPE_PICKER_TITLE = {"within": _PICKER, "type": "Text", "name": "ประเภทเอกสาร", "ancestor": {"id": "uo_popupdw_st_title"}}
_WH_PICKER_TITLE = {"within": _PICKER, "type": "Text", "name": "คลังสินค้า", "ancestor": {"id": "uo_popupdw_st_title"}}
_TYPE_ROW = {"within": _PICKER, "type": "Custom", "name": "{=type_row}", "ancestor": {"id": _PICKER_LIST}}
_WH_ROW = {"within": _PICKER, "type": "Custom", "name": WAREHOUSE_NAME, "ancestor": {"id": _PICKER_LIST}}
_PICKER_OK = {"within": _PICKER, "id": "cb_ok", "type": "Button", "ancestor": {"id": "uo_popupdw_uo_buttonbar"}}


def _uia(sel, **extra):
    return dict(sel, kind="uia", **extra)


def _picker_steps(prefix, field, is_target, title, row):
    """ตั้งค่าช่องหนึ่งช่องผ่านหน้าต่างรายการ 3 ขั้น (เปิด → เลือกแถว → ตกลง) · ทุกขั้นข้ามได้เมื่อ "ค่าตรงอยู่แล้วและไม่มีหน้าต่างรายการค้าง"
    (ไม่แตะฟอร์มที่ถูกต้องอยู่แล้ว) · หน้าต่างรายการค้างอยู่ = ไม่ข้าม → ขั้น open จะหยุด (หน้าต่างหลักถูกล็อก) ไม่คลิกทะลุ"""
    no_need = {"all": [{"uia": is_target}, {"gone": _PICKER}]}
    ready = {"all": [{"uia": title}, {"uia": _PICKER_OK}]}
    return {
        prefix + "-open": {
            "skip_if": no_need,
            "pre": {"all": [{"uia": field}, {"uia": _IMPORT_BTN}]},
            "actions": [{"do": "click", "target": _uia(field)}],
            "post": {"uia": title},
            "post_timeout": 15,
        },
        prefix + "-pick": {
            "skip_if": no_need,
            "pre": ready,
            "actions": [{"do": "pick_row", "row": _uia(row, reverify=True), "list": _PICKER_LIST}],
            "post": ready,
            "post_timeout": 10,
        },
        prefix + "-ok": {
            "skip_if": no_need,
            "pre": ready,
            "actions": [{"do": "click", "target": _uia(_PICKER_OK)}],
            "post": {"all": [{"gone": _PICKER}, {"uia": is_target}]},
            "post_timeout": 15,
        },
    }


STEP_SPECS = {
    "launch": {"post": {"uia": _LOGIN_PANEL}, "post_timeout": 90},
    "login": {
        "pre": {"uia": _LOGIN_PANEL},
        "actions": [
            {"do": "click", "target": _uia(_USER_CELL)},
            {"do": "await", "cond": {"uia": _USER_EDIT}, "timeout": 8, "what": "ช่องชื่อผู้ใช้ยังไม่รับโฟกัส — ไม่พิมพ์"},
            {"do": "type", "what": "username", "within": _MAIN},
            {"do": "click", "target": _uia(_PASS_CELL)},
            {"do": "await", "cond": {"uia": _PASS_EDIT}, "timeout": 8, "what": "ช่องรหัสผ่านยังไม่รับโฟกัส — ไม่พิมพ์"},
            {"do": "type", "what": "password", "within": _MAIN},
            {"do": "click", "target": _uia(_LOGIN_BTN)},
        ],
        "post": {"all": [{"uia_gone": _LOGIN_PANEL}, {"uia": _MAIN_MENU_ANY}]},
        "post_timeout": 40,
    },
    "menu": {
        "pre": {"uia": _MENU_ITEM},
        "actions": [{"do": "click", "target": _uia(_MENU_ITEM)}],
        "post": {"uia": _MENU_BTN},
        "post_timeout": 15,
    },
    "doc-button": {
        "pre": {"uia": _MENU_BTN},
        "actions": [{"do": "click", "target": _uia(_MENU_BTN)}],
        "post": {"all": [{"uia": _DOC_TAB}, {"uia": _IMPORT_BTN}]},
        "post_timeout": 40,
    },
    **_picker_steps("doc-type", _TYPE_FIELD, _TYPE_IS_TARGET, _TYPE_PICKER_TITLE, _TYPE_ROW),
    **_picker_steps("warehouse", _WH_FIELD, _WH_IS_TARGET, _WH_PICKER_TITLE, _WH_ROW),
    "import-button": {
        # ⛔ ด่านสุดท้ายก่อนคลิกจริง: อ่านกลับครบ 3 อย่างว่าถูกต้อง (ประเภท · เลขที่ขึ้นต้นรหัสประเภท · คลัง Front Store) ไม่ตรง = ไม่คลิกปุ่มนำเข้า
        "pre": {"all": [{"uia": _IMPORT_BTN}, {"uia": _TYPE_IS_TARGET}, {"uia": _NUMBER_PREFIX}, {"uia": _WH_IS_TARGET}]},
        "pre_timeout": 8,
        "pre_what": "ฟอร์มยังไม่ใช่ประเภทเอกสาร/เลขที่/คลัง Front Store ที่ต้องการ (หรือไม่เห็นปุ่มนำเข้า) — ไม่คลิกปุ่มนำเข้า",
        "actions": [
            {"do": "note", "sel": _BRANCH_FIELD, "label": "สาขาในฟอร์ม"},        # บันทึกลง log เท่านั้น (ยังไม่ตัดสิน — รอสัญญา HTTP เฟส 2 ที่บอกสาขา)
            {"do": "click", "target": _uia(_IMPORT_BTN, reverify=True)},
        ],
        "allow_dialogs": [r"^Select File\b"],
        "post": {"win": _FILE_DIALOG},
        "post_timeout": 20,
    },
}


def _fmt(obj, tokens):
    """แทนโทเคนใน spec: {ชื่อ} = escape แบบ regex (ใช้ในช่อง regex และช่องเทียบตรงที่ค่าไม่มีอักขระพิเศษ) · {=ชื่อ} = ค่าดิบ ไม่ escape
    (ใช้เฉพาะช่องที่เทียบ "ตรงตัว" เช่น name ที่มีช่องว่าง — re.escape ใส่ \\ หน้าช่องว่างแล้วเทียบตรงไม่ได้)"""
    if isinstance(obj, str):
        for k, v in tokens.items():
            obj = obj.replace("{=%s}" % k, str(v))
        for k, v in tokens.items():
            obj = obj.replace("{%s}" % k, re.escape(str(v)))
        return obj
    if isinstance(obj, list):
        return [_fmt(x, tokens) for x in obj]
    if isinstance(obj, dict):
        return {k: _fmt(v, tokens) for k, v in obj.items()}
    return obj


def _norm_menu(text):
    text = (text or "").split("\t", 1)[0].replace("&", "")
    return " ".join(text.split())


def _match_win(w, spec):
    spec = spec or {}
    if spec.get("cls") and (w.cls or "").lower() != spec["cls"].lower():
        return False
    if spec.get("cls_re") and not re.search(spec["cls_re"], w.cls or "", re.I):
        return False
    if spec.get("title") and not re.search(spec["title"], w.text or "", re.I):
        return False
    return True


def _sel_ids(sel):
    i = sel.get("id")
    if not i:
        return []
    return [i] if isinstance(i, str) else [str(x) for x in i]


def _sel_label(sel):
    parts = []
    ids = _sel_ids(sel)
    if ids:
        parts.append("id=" + "|".join(ids))
    for k in ("type", "name", "name_re", "cls", "help"):
        if sel.get(k):
            parts.append("%s=%s" % (k, sel[k]))
    anc = sel.get("ancestor") or {}
    if anc:
        parts.append("ใต้ " + ",".join("%s=%s" % (k, v) for k, v in anc.items() if v))
    return "UIA[" + " ".join(parts) + "]"


def _visible_in(rect, top_rect, min_visible=0.8, min_size=4):
    """องค์ประกอบ 'มองเห็นอยู่จริง' ในกรอบหน้าต่างหรือไม่ — กึ่งกลางต้องอยู่ในกรอบ และส่วนที่อยู่ในกรอบ ≥ min_visible ของพื้นที่
    (IsOffscreen ของ UIA เชื่อไม่ได้: ปุ่มที่ถูกเลื่อนไปนอกกรอบหน้าต่างยังรายงาน False — เจอจริงกับปุ่ม I/O หลังเปิดฟอร์ม)"""
    if not rect:
        return False
    l, t, r, b = rect
    w, h = r - l, b - t
    if w < min_size or h < min_size:
        return False
    cx, cy = (l + r) / 2.0, (t + b) / 2.0
    tl, tt, tr, tb = top_rect
    if not (tl <= cx <= tr and tt <= cy <= tb):
        return False
    iw, ih = min(r, tr) - max(l, tl), min(b, tb) - max(t, tt)
    if iw <= 0 or ih <= 0:
        return False
    return (iw * ih) / float(w * h) >= min_visible


def _center(rect):
    return ((rect[0] + rect[2]) // 2, (rect[1] + rect[3]) // 2)


@dataclass
class JobOpts:
    dry_run: bool = False
    hover_ms: int = 0
    force_unverified: bool = False
    force_dpi: bool = False


@dataclass
class Resolved:
    kind: str
    via: str
    top: WinInfo
    hwnd: int
    rect: tuple
    point: tuple | None = None
    menu_id: int | None = None
    label: str = ""
    el_id: str = ""                  # AutomationId ขององค์ประกอบที่พบ (kind uia) — pick_row ใช้หาเครื่องหมายเลือกแถว p_1:N


# ─────────────────────────────────────────────────────────────
# ตัวรันขั้นตอน (ไม่รู้จัก Windows — คุยกับ adapter เท่านั้น)
# ─────────────────────────────────────────────────────────────

class Runner:
    POLL = 0.4          # วินาทีระหว่างตรวจเงื่อนไข
    SETTLE = 0.4        # รอหลังคลิก/พิมพ์

    def __init__(self, adapter, settings, log, specs=None, opts=None, clock=None, sleep=None):
        self.adapter = adapter
        self.settings = settings
        self.log = log
        self._scrub = getattr(log, "scrub", str)
        self.specs = STEP_SPECS if specs is None else specs
        self.opts = opts or JobOpts()
        self.clock = clock or time.monotonic
        self.sleep = sleep or time.sleep
        self.steps = []                  # [{"name","ok","ms"}]
        self.dialogs_seen = []           # [(title, texts)] ทุกกล่องที่เคยเห็น (ไว้บอกสาเหตุตอนล้ม)
        self.doc_type = ""
        self.tokens = {}
        self.exe = ""
        self.run_dir = ""
        self._shots = 0
        self._typed_creds = False
        self._after_import = False       # True หลังคลิกปุ่มนำเข้า — ห้ามมี input อีก (ตรวจใน _guard_no_input)
        self.actions_after_import = 0
        self._uia_errs = 0               # อ่าน UIA ล้มติดกันกี่ครั้ง (ใช้ในลูปรอเงื่อนไข — ดู UIA_MAX_ERRORS)

    # ── ตัวช่วย: หน้าต่างของ ssmaxx ──────────────────────────────
    def _pids(self):
        return self.adapter.pids(self.settings.proc_name)

    def _tops(self):
        out = []
        for w in self.adapter.top_windows(self._pids()):
            if not w.visible:
                continue
            if (w.w >= 50 and w.h >= 30) or w.rect[0] <= MINIMIZED_LEFT:     # -32000 = ย่อหน้าต่างอยู่
                out.append(w)
        return out

    def _find_tops(self, spec):
        return [w for w in self._tops() if _match_win(w, spec)]

    def _children(self, top, spec):
        cls, text = (spec.get("cls") or "").lower(), spec.get("text")
        min_w, min_h = spec.get("min_w", 6), spec.get("min_h", 6)
        out = []
        for c in self.adapter.child_windows(top.hwnd):
            if cls and (c.cls or "").lower() != cls:
                continue
            if text and not re.search(text, c.text or "", re.I):
                continue
            if c.w < min_w or c.h < min_h:
                continue
            out.append(c)
        out.sort(key=lambda c: (c.rect[1], c.rect[0]))
        return out

    def _one_top(self, spec, label, step):
        found = self._find_tops(spec)
        if not found:
            raise HelperError("LOCATOR_NOT_FOUND", "ไม่พบหน้าต่าง %s ของ ProMaxx" % label, step)
        if len(found) > 1:
            raise HelperError("LOCATOR_NOT_UNIQUE", "พบหน้าต่าง %s %d อัน — ไม่คลิกเดา" % (label, len(found)), step)
        return found[0]

    # ── UIA (ssmaxx.exe เป็น WPF — ข้างในไม่มี HWND) ─────────────
    def _uia_matches(self, top, sel, step):
        """คืน (ตรงตัวตน, มองเห็นอยู่, หมายเหตุว่าทำไมบางชิ้นถูกตัด)
        ตัวตน = id/type/name (ถามที่ UIA) + cls + HelpText + หน้าแม่ · มองเห็น = ไม่ offscreen และอยู่ในกรอบหน้าต่างจริง (_visible_in)"""
        try:
            els = list(self.adapter.uia_find(top.hwnd, ids=_sel_ids(sel), ctype=sel.get("type") or "", name=sel.get("name") or ""))
        except HelperError:
            raise
        except Exception as e:      # noqa: BLE001
            raise HelperError("UIA_ERROR", "อ่านโครงหน้าต่าง ProMaxx (UIA) ไม่ได้: %s %s" % (type(e).__name__, self._scrub(str(e))[:140]), step)
        anc = sel.get("ancestor") or {}
        ident, notes = [], []
        for e in els:
            if sel.get("cls") and e.cls != sel["cls"]:
                notes.append("ClassName=%r" % e.cls)
                continue
            if sel.get("help") is not None and e.help != sel["help"]:
                notes.append("HelpText=%r" % e.help)
                continue
            if sel.get("name_re") and not re.search(sel["name_re"], e.name or ""):
                notes.append("ชื่อ=%r" % e.name)
                continue
            if anc and not any((not anc.get("id") or pid == anc["id"]) and (not anc.get("cls") or pcls == anc["cls"]) for pid, pcls in e.parents):
                notes.append("หน้าแม่=%s" % ",".join(c or i for i, c in e.parents[:3]))
                continue
            ident.append(e)
        vis = [e for e in ident if not e.offscreen and _visible_in(e.rect, top.rect)]
        return ident, vis, notes

    # ── เงื่อนไข ─────────────────────────────────────────────────
    def _cond(self, c, step):
        if not c:
            raise HelperError("LOCATOR_MISSING", "ขั้น %s ยังไม่มีเงื่อนไขตรวจ (รอตรวจหน้าต่างจริง)" % step, step)
        if "all" in c:
            return all(self._cond(x, step) for x in c["all"])
        if "any" in c:
            return any(self._cond(x, step) for x in c["any"])
        if "win" in c:
            return bool(self._find_tops(c["win"]))
        if "gone" in c:
            return not self._find_tops(c["gone"])
        if "ctl" in c:
            spec = c["ctl"]
            return any(self._children(top, spec) for top in self._find_tops(spec.get("within")))
        if "uia" in c or "uia_gone" in c:
            gone = "uia_gone" in c
            sel = c["uia_gone" if gone else "uia"]
            seen = False
            for top in self._find_tops(sel.get("within")):
                try:
                    _, vis, _ = self._uia_matches(top, sel, step)
                except HelperError as e:
                    if e.code != "UIA_ERROR":
                        raise
                    self._uia_errs += 1          # ช่วงโปรแกรมกำลังเปิดอาจอ่านล้มชั่วคราว — ทนได้ UIA_MAX_ERRORS ครั้งติดกัน
                    if self._uia_errs > UIA_MAX_ERRORS:
                        raise
                    return False
                self._uia_errs = 0
                if sel.get("focused"):
                    vis = [e for e in vis if e.focused]
                seen = seen or bool(vis)
            return (not seen) if gone else seen
        raise HelperError("LOCATOR_MISSING", "เงื่อนไขของขั้น %s ไม่รู้จัก: %r" % (step, sorted(c)), step)

    def _wait_cond(self, cond, timeout, step, code, what, allow=None, each=None):
        deadline = self.clock() + timeout
        while True:
            if self._cond(cond, step):
                return
            self._guard_dialogs(step, allow)
            if each:
                each()
            if self.clock() >= deadline:
                raise HelperError(code, "%s ภายใน %d วินาที" % (what, timeout), step)
            self.sleep(self.POLL)

    # ── กล่องข้อความที่ไม่คาดคิด ────────────────────────────────
    def _guard_dialogs(self, step, allow=None):
        for title, texts in self.adapter.dialogs(self._pids()):
            key = (title, tuple(texts))
            if key not in self.dialogs_seen:
                self.dialogs_seen.append(key)
            blob = (title + " " + " ".join(texts))
            if allow and any(re.search(a, blob, re.I) for a in allow):
                continue
            raise HelperError("UNEXPECTED_DIALOG", "ProMaxx แสดงกล่องข้อความ: %s" % self._dialog_text(title, texts), step,
                              detail={"dialogs": [list(d[:1]) + [list(d[1])] for d in self.dialogs_seen]})

    @staticmethod
    def _dialog_text(title, texts):
        blob = " / ".join([title] + list(texts[:3])).strip(" /")
        low = blob.lower()
        hint = " — ProMaxx ต่อฐานข้อมูลไม่ได้ ตรวจว่าเครื่อง SQL Server (BIGYAMAINPC) เปิดอยู่" if ("sql server" in low or "connect" in low or "database" in low) else ""
        return blob[:160] + hint

    # ── โฟกัส/คลิก/พิมพ์ ────────────────────────────────────────
    def _restore_minimized(self, step):
        """หน้าต่างของ ProMaxx ถูกย่ออยู่ (พิกัด ≈ -32000) → UIA อ่านปุ่ม/ช่องไม่เห็นจนด่านก่อนเริ่มล้ม และขั้นโฟกัสก็ไม่กู้ให้
        (หน้าต่างที่ถูกย่อยังนับเป็น foreground ได้ — เจอจริง 4 พ.ย. 2026) ⇒ กู้กลับมาแสดงก่อนตรวจเงื่อนไขของขั้น
        · โหมดจริงเท่านั้น: dry-run ไม่ลงมือ จึงแจ้งอย่างเดียว · กู้ไม่สำเร็จ = หยุดโดยไม่คลิก/พิมพ์ · เปลี่ยนแค่หน้าต่างที่อยู่ด้านหน้า (focus() ไม่ส่งคีย์/คลิก)"""
        mins = [w for w in self._tops() if w.rect[0] <= MINIMIZED_LEFT]
        if not mins:
            return
        if self.opts.dry_run:
            raise HelperError("PRECONDITION_FAILED", "หน้าต่าง ProMaxx ถูกย่ออยู่ — dry-run ไม่กู้ให้ (โหมดจริงจะกู้กลับมาเอง)", step)
        self.log("[%s] หน้าต่าง ProMaxx ถูกย่ออยู่ — กู้กลับมาแสดง" % step)
        for w in mins:
            self.adapter.focus(w.hwnd)
        self.sleep(0.4)
        if any(w.rect[0] <= MINIMIZED_LEFT for w in self._tops()):
            raise HelperError("FOCUS_LOST", "หน้าต่าง ProMaxx ถูกย่ออยู่และกู้กลับมาไม่ได้ — ไม่คลิก/พิมพ์", step)

    def _ensure_focus(self, top, step):
        if self.adapter.foreground_pid() in self._pids() and top.rect[0] > MINIMIZED_LEFT:      # ย่ออยู่ = ยังต้องกู้ แม้เป็น foreground
            return
        self.adapter.focus(top.hwnd)
        self.sleep(0.4)
        if self.adapter.foreground_pid() not in self._pids():
            raise HelperError("FOCUS_LOST", "หน้าต่าง ProMaxx ไม่ได้อยู่ด้านหน้า — ไม่พิมพ์/คลิก", step)

    def _guard_no_input(self, step):
        if self._after_import:
            self.actions_after_import += 1
            raise HelperError("STEP_FAILED", "หลังปุ่มนำเข้าไฟล์เอกสารห้ามส่ง input เพิ่ม", step)

    def _resolve(self, t, step):
        kind = t.get("kind")
        top = self._one_top(t.get("within"), "(%s)" % kind, step)
        if kind == "menu":
            path = t.get("path") or []
            cands = [it for it in self.adapter.menus(top.hwnd)
                     if it.id and len(it.path) == len(path) and all(re.search(p, s, re.I) for p, s in zip(path, it.path))]
            if not cands:
                raise HelperError("LOCATOR_NOT_FOUND", "ไม่พบเมนู %s" % " > ".join(path), step)
            if len(cands) > 1:
                raise HelperError("LOCATOR_NOT_UNIQUE", "พบเมนู %s %d รายการ — ไม่คลิกเดา" % (" > ".join(path), len(cands)), step)
            it = cands[0]
            if not it.enabled:
                raise HelperError("LOCATOR_NOT_FOUND", "เมนู %s ใช้งานไม่ได้ (disabled)" % " > ".join(it.path), step)
            return Resolved("menu", "message", top, top.hwnd, top.rect, None, it.id, " > ".join(it.path))
        if kind == "control":
            cs = self._children(top, t)
            label = "%s:%s" % (t.get("cls") or "*", t.get("text") or "*")
            if not cs:
                raise HelperError("LOCATOR_NOT_FOUND", "ไม่พบ control %s" % label, step)
            if len(cs) > 1:
                raise HelperError("LOCATOR_NOT_UNIQUE", "พบ control %s %d รายการ — ไม่คลิกเดา" % (label, len(cs)), step)
            c = cs[0]
            if not c.enabled:
                raise HelperError("LOCATOR_NOT_FOUND", "control %s ใช้งานไม่ได้ (disabled)" % label, step)
            via = t.get("via", "message")
            return Resolved("control", via, top, c.hwnd, c.rect, _center(c.rect), None, label)
        if kind == "point":
            rect, hwnd, label = top.rect, top.hwnd, "จุดใน (%s)" % (top.cls or "?")
            if t.get("child_cls"):
                cs = [c for c in self._children(top, {"cls": t["child_cls"]})]
                if t.get("index") is not None:
                    idx = int(t["index"])
                    cs = cs[idx:idx + 1]
                if not cs:
                    raise HelperError("LOCATOR_NOT_FOUND", "ไม่พบ %s" % t["child_cls"], step)
                if len(cs) > 1:
                    raise HelperError("LOCATOR_NOT_UNIQUE", "พบ %s %d อัน (ระบุ index) — ไม่คลิกเดา" % (t["child_cls"], len(cs)), step)
                rect, hwnd, label = cs[0].rect, cs[0].hwnd, "จุดใน %s" % t["child_cls"]
            x = rect[0] + float(t["x"]) * (rect[2] - rect[0])
            y = rect[1] + float(t["y"]) * (rect[3] - rect[1])
            return Resolved("point", "mouse", top, hwnd, rect, (int(round(x)), int(round(y))), None, label)
        if kind == "uia":
            if not top.enabled:
                raise HelperError("UNEXPECTED_DIALOG", "หน้าต่างหลักของ ProMaxx ถูกล็อก (มีกล่องโมดัลเปิดอยู่) — ไม่คลิก", step)
            label = _sel_label(t)
            ident, vis, notes = self._uia_matches(top, t, step)
            if not ident:
                raise HelperError("LOCATOR_NOT_FOUND", "ไม่พบ %s%s" % (label, (" (ตัดทิ้ง: " + "; ".join(notes[:3]) + ")") if notes else ""), step)
            if not vis:
                raise HelperError("LOCATOR_NOT_FOUND", "พบ %s แต่ไม่ได้อยู่ในหน้าจอ (ซ่อน/นอกกรอบหน้าต่าง) — ไม่คลิก" % label, step)
            if len(vis) > 1:
                raise HelperError("LOCATOR_NOT_UNIQUE", "พบ %s %d รายการ — ไม่คลิกเดา" % (label, len(vis)), step)
            e = vis[0]
            if not e.enabled:
                raise HelperError("LOCATOR_NOT_FOUND", "%s ใช้งานไม่ได้ (disabled)" % label, step)
            return Resolved("uia", "mouse", top, top.hwnd, e.rect, _center(e.rect), None, label, e.id)
        raise HelperError("LOCATOR_MISSING", "ชนิดเป้าหมายไม่รู้จัก: %r" % kind, step)

    def _mark(self, res, step):
        """โหมด --dry-run: บันทึก screenshot ซ้อนกากบาท/กรอบตรงจุดที่จะคลิก (ไม่คลิก)"""
        self._shots += 1
        d = self._ensure_run_dir("dry")
        path = os.path.join(d, "%02d_%s.png" % (self._shots, step))
        marks = [{"type": "rect", "rect": res.rect, "label": res.label}]
        if res.point:
            marks.append({"type": "point", "xy": res.point, "label": res.label})
        ok = self.adapter.screenshot(path, marks=marks)
        self.log("[%s] dry-run: จะคลิก %s ที่ %s → %s" % (step, res.label, res.point or "(ส่งข้อความ)", path if ok else "บันทึกภาพไม่ได้"))

    def _click(self, t, step, allow):
        top = self._one_top(t.get("within"), "(%s)" % t.get("kind"), step)
        if not self.opts.dry_run:
            self._guard_no_input(step)
            self._guard_dialogs(step, allow)
            if t.get("via") == "mouse" or t.get("kind") in ("point", "uia"):       # uia = เมาส์จริงที่กึ่งกลางพิกัดจาก UIA เสมอ
                self._ensure_focus(top, step)
        res = self._resolve(t, step)                     # อ่านพิกัดหลังโฟกัส (หน้าต่างอาจถูกกู้จากย่อ → rect เปลี่ยน)
        if self.opts.dry_run:
            self._mark(res, step)
            return
        if res.via == "mouse":
            if self.opts.hover_ms > 0:
                self.adapter.move_to(*res.point)
                self.sleep(self.opts.hover_ms / 1000.0)
            if t.get("reverify"):
                # ปุ่มอันตรายอยู่ติดกัน (ลบ/ยกเลิกรายการห่าง 4px) — อ่านเป้าซ้ำก่อนกด ถ้าขยับเกิน 2px = หยุด ไม่กดเดา
                again = self._resolve(t, step)
                if abs(again.point[0] - res.point[0]) > 2 or abs(again.point[1] - res.point[1]) > 2:
                    raise HelperError("INTERFERENCE", "เป้า %s ขยับระหว่างเตรียมคลิก (%s → %s) — ไม่คลิก" % (res.label, res.point, again.point), step)
                res = again
            ok, why = self.adapter.click_at(res.point[0], res.point[1], self._pids())
            if not ok:
                raise HelperError("INTERFERENCE", "คลิกไม่ได้: %s — ยกเลิก (อย่าแตะเมาส์ระหว่างทำงาน)" % why, step)
            self.log("[%s] คลิก %s ที่ %s" % (step, res.label, res.point))
        elif res.kind == "menu":
            self.adapter.invoke_menu(res.top.hwnd, res.menu_id)
            self.log("[%s] เมนู %s (id=%s)" % (step, res.label, res.menu_id))
        else:
            self.adapter.click_button(res.hwnd)
            self.log("[%s] กดปุ่ม %s" % (step, res.label))
        self.sleep(self.SETTLE)

    def _note(self, a, step):
        """อ่านชื่อขององค์ประกอบลง log เท่านั้น (ไม่คลิก/ไม่ตัดสิน) — ใช้บันทึกสิ่งที่เห็นไว้ให้คนตรวจทีหลัง"""
        sel = a.get("sel") or {}
        top = self._one_top(sel.get("within"), "(อ่านค่า)", step)
        _, vis, _ = self._uia_matches(top, sel, step)
        shown = vis[0].name if len(vis) == 1 else ("(อ่านไม่ได้)" if not vis else "(พบ %d ตัว)" % len(vis))
        self.log("[%s] %s: %s" % (step, a.get("label") or _sel_label(sel), shown))

    def _pick_row(self, a, step, allow):
        """คลิกแถวในหน้าต่างรายการ แล้วต้องเห็นเครื่องหมายเลือกแถว (Image p_1:N) ของแถวนั้น — ยังไม่กด "ตกลง" (เป็นขั้นต่อไป)
        ด่าน: แถวชื่อตรงทุกตัวอักษร 1 แถวพอดี (_resolve) · อยู่ในกรอบรายการจริง (แถวที่ถูกเลื่อนออกนอกกรอบไม่ถูกคลิก) · อ่านเป้าซ้ำก่อนกด (reverify)"""
        sel = dict(a.get("row") or {}, kind="uia")
        list_id = a.get("list") or ""
        if not list_id:
            raise HelperError("LOCATOR_MISSING", "pick_row ต้องระบุ list (id ของ DataWindow ที่เก็บแถว)", step)
        top = self._one_top(sel.get("within"), "(หน้าต่างรายการ)", step)
        res = self._resolve(sel, step)                                   # 0 แถว/หลายแถว/ซ่อน/ปิดใช้ = หยุดที่นี่ (ยังไม่คลิก)
        m = re.match(r"^col1:(\d+)$", res.el_id or "")
        if not m:
            raise HelperError("LOCATOR_NOT_FOUND", "แถวที่พบไม่ใช่แถวรายการ (id=%r) — ไม่คลิก" % res.el_id, step)
        _, lst, _ = self._uia_matches(top, {"id": list_id, "type": "Custom"}, step)
        if len(lst) != 1 or not _visible_in(res.rect, lst[0].rect, min_visible=1.0):
            raise HelperError("LOCATOR_NOT_FOUND", "แถว %s อยู่นอกกรอบรายการ (ถูกเลื่อนออก) — ไม่คลิก" % res.label, step)
        self._click(sel, step, allow)                                    # dry-run: วาดกากบาทแล้วจบ · จริง: โฟกัส → hover → อ่านซ้ำ → คลิก
        if self.opts.dry_run:
            return
        marker = {"within": sel.get("within"), "id": "p_1:%s" % m.group(1), "type": "Image"}
        deadline = self.clock() + 6
        while True:
            top = self._one_top(sel.get("within"), "(หน้าต่างรายการ)", step)
            _, vis, _ = self._uia_matches(top, marker, step)
            if vis:
                self.log("[%s] เครื่องหมายเลือกแถวย้ายมาที่แถว %s แล้ว" % (step, m.group(1)))
                return
            self._guard_dialogs(step, allow)
            if self.clock() >= deadline:
                raise HelperError("POSTCONDITION_FAILED", "คลิก %s แล้วเครื่องหมายเลือกแถวไม่ย้ายมาที่แถวนั้นภายใน 6 วินาที — ไม่กด ตกลง" % res.label, step)
            self.sleep(self.POLL)

    def _act(self, a, step, allow):
        do = a.get("do")
        if do == "wait":
            if not self.opts.dry_run:
                self.sleep(float(a.get("sec", 0.5)))
            return
        if do == "await":
            # รอเงื่อนไขก่อนทำต่อ (เช่น ช่องรหัสผ่านรับโฟกัสแล้ว) — ไม่ตรง = หยุดก่อนพิมพ์ · dry-run ไม่คลิกจริงจึงข้าม
            if not self.opts.dry_run:
                self._wait_cond(a.get("cond"), float(a.get("timeout", 6)), step, "PRECONDITION_FAILED",
                                a.get("what") or "เงื่อนไขก่อนทำต่อไม่ตรง", allow)
            return
        if do == "click":
            return self._click(a.get("target") or {}, step, allow)
        if do == "note":
            return self._note(a, step)
        if do == "pick_row":
            return self._pick_row(a, step, allow)
        if do in ("type", "key"):
            if self.opts.dry_run:
                self.log("[%s] dry-run: ข้าม %s" % (step, do))
                return
            if not a.get("within"):
                raise HelperError("LOCATOR_MISSING", "action %s ต้องระบุ within" % do, step)
            self._guard_no_input(step)
            self._guard_dialogs(step, allow)
            top = self._one_top(a["within"], "(พิมพ์)", step)
            self._ensure_focus(top, step)
            if do == "type":
                what = a.get("what")
                if what not in ("username", "password"):
                    raise HelperError("LOCATOR_MISSING", "type.what ไม่รู้จัก: %r" % what, step)
                text = self.settings.username if what == "username" else self.settings.password
                self.adapter.type_text(text)
                self._typed_creds = True
                self.log("[%s] พิมพ์ %s (%d ตัวอักษร)" % (step, what, len(text)))
            else:
                self.adapter.press_key(a.get("key"))
                self.log("[%s] กดปุ่ม %s" % (step, a.get("key")))
            self.sleep(self.SETTLE)
            return
        raise HelperError("LOCATOR_MISSING", "action ไม่รู้จัก: %r" % do, step)

    # ── หลักฐานตอนล้ม ───────────────────────────────────────────
    def _ensure_run_dir(self, label):
        if not self.run_dir:
            self.run_dir = os.path.join(self.settings.runs_dir, "%s_%s" % (time.strftime("%Y%m%d_%H%M%S"), label))
            try:
                os.makedirs(self.run_dir, exist_ok=True)
            except OSError:
                pass
        return self.run_dir

    def _evidence(self, err):
        """เก็บ dump หน้าต่าง + screenshot ลง runs/ (ในเครื่องเท่านั้น · ห้ามเข้า git) — ล้มตรงนี้ต้องไม่ทับ error เดิม"""
        try:
            d = self._ensure_run_dir(err.code)
            dump = self.adapter.dump(self._pids())
            write_dump(d, dump, self._scrub)
            self.adapter.screenshot(os.path.join(d, "screen.png"))
            write_uia_dumps(self.adapter, d, self._pids(), self._scrub, self.log)
            result = {"code": err.code, "step": err.step, "message": err.message, "steps": self.steps,
                      "dialogs": [[t, list(x)] for t, x in self.dialogs_seen]}
            with open(os.path.join(d, "result.json"), "w", encoding="utf-8") as f:
                f.write(self._scrub(json.dumps(result, ensure_ascii=False, indent=1)))
            self.log("เก็บหลักฐานไว้ที่ %s" % d)
            prune_runs(self.settings.runs_dir)
        except Exception as e:      # noqa: BLE001
            self.log("เก็บหลักฐานไม่สำเร็จ (%s)" % type(e).__name__)

    # ── preflight ───────────────────────────────────────────────
    def resolve_exe(self):
        if self.settings.exe_path:
            return self.settings.exe_path if self.adapter.file_exists(self.settings.exe_path) else ""
        for c in EXE_CANDIDATES:
            if self.adapter.file_exists(c):
                return c
        return ""

    def _preflight(self, only_step):
        if not (LOCATORS_VERIFIED or self.opts.force_unverified):
            raise HelperError("UNVERIFIED", "ตัวช่วยยังไม่ผ่านการตรวจหน้าต่างจริง — ปิดการคลิกไว้", "preflight")
        st = self.settings
        if not st.username or not st.password:
            raise HelperError("NOT_CONFIGURED", "ยังไม่ได้ตั้ง PROMAXX_USERNAME / PROMAXX_PASSWORD ในไฟล์ .env", "preflight")
        self.exe = self.resolve_exe()
        if (not only_step or only_step == "launch") and not self.exe:
            raise HelperError("NOT_CONFIGURED", "ไม่พบ ssmaxx.exe — ตั้ง PROMAXX_EXE_PATH ในไฟล์ .env", "preflight")
        if not self.adapter.session_ok():
            raise HelperError("NO_DESKTOP", "ไม่มีหน้าจอให้คลิก (ล็อกจออยู่/ไม่ใช่ session ผู้ใช้)", "preflight")
        dpi = self.adapter.dpi_percent()
        if dpi not in (None, 100) and not self.opts.force_dpi:
            raise HelperError("UNSUPPORTED_DPI", "Display Scaling ต้องเป็น 100%% (ตอนนี้ %s%%)" % dpi, "preflight")
        running = bool(self._pids())
        if only_step and only_step != "launch":
            if not running:
                raise HelperError("NOT_RUNNING", "--step %s ต้องเปิด ssmaxx.exe ไว้ที่หน้าที่ถูกต้องก่อน" % only_step, "preflight")
        elif running:
            raise HelperError("ALREADY_RUNNING", "ProMaxx เปิดอยู่แล้ว — ปิด ssmaxx.exe ก่อนแล้วกดใหม่", "preflight")
        others = self.adapter.running_names(st.block_procs)
        if others:
            raise HelperError("OTHER_BOT_RUNNING", "มีบอทอื่นกำลังใช้ ProMaxx (%s) — รอให้จบก่อน" % ", ".join(others), "preflight")

    # ── ขั้นตอน ─────────────────────────────────────────────────
    def _spec(self, name):
        spec = self.specs.get(name)
        if not spec:
            raise HelperError("LOCATOR_MISSING", "ยังไม่ได้ตั้งค่าขั้น %s (รอตรวจหน้าต่าง ssmaxx.exe จริง)" % name, name)
        return _fmt(spec, self.tokens)

    def _launch_target(self):
        """ไฟล์ที่ต้องสั่งเปิดจริง · ssmaxx.exe → สลับเป็น ProMaxx.exe ในโฟลเดอร์เดียวกันถ้ามี (เหมือนทางลัดของพนักงาน)
        PROMAXX_LAUNCH_DIRECT=1 หรือพาธที่ตั้งไว้ไม่ใช่ ssmaxx.exe (เช่นชี้ ProMaxx.exe เอง) = เปิดตามที่ตั้งไว้ ไม่สลับ"""
        exe = self.exe
        if self.settings.launch_direct or os.path.basename(exe).lower() != self.settings.proc_name.lower():
            return exe
        launcher = os.path.join(os.path.dirname(exe), LAUNCHER_NAME)
        return launcher if self.adapter.file_exists(launcher) else exe

    def _step_launch(self, spec):
        if not spec.get("post"):
            raise HelperError("LOCATOR_MISSING", "ขั้น launch ไม่มี post (ต้องบอกว่าหน้า Login หน้าตาแบบไหน)", "launch")
        if self.opts.dry_run:
            self.log("[launch] dry-run: ไม่เปิดโปรแกรม")
            return
        exe = self._launch_target()
        self.log("[launch] เปิด %s%s" % (exe, "" if exe == self.exe else " (ตัวเปิดโปรแกรมของ ProMaxx — เปิด %s ตรงๆ แล้ว ProMaxx ไม่ไปหน้า Login)" % os.path.basename(self.exe)))
        try:
            self.adapter.launch(exe, self.settings.exe_args, os.path.dirname(exe))
        except Exception as e:      # noqa: BLE001
            raise HelperError("LAUNCH_FAILED", "เปิด ProMaxx ไม่ได้ (%s)" % type(e).__name__, "launch")
        started = self.clock()
        seen = {"any": False, "last": started}

        def vanished():
            now = self.clock()
            if self._pids():
                seen["any"], seen["last"] = True, now
            elif seen["any"]:
                # เคยเห็นโปรเซส ssmaxx แล้วหายเกินเกณฑ์ = โปรแกรมปิดตัวเอง (กะพริบสั้นๆ ตอนตัวเปิดโปรแกรมรีสตาร์ทไม่นับ)
                if now - seen["last"] > LAUNCH_VANISH_GRACE:
                    raise HelperError("LAUNCH_FAILED", "ProMaxx ปิดตัวเองหลังเปิด" + self._seen_hint(), "launch")
            elif now - started > LAUNCH_SPAWN_GRACE:
                # ไม่เคยเห็นโปรเซสเลย: ตัวเปิดโปรแกรม (ProMaxx.exe) อาจใช้เวลาก่อนเปิด ssmaxx — รอได้ถึงเกณฑ์นี้เท่านั้น
                raise HelperError("LAUNCH_FAILED", "สั่งเปิดแล้วแต่ไม่พบโปรเซส %s ภายใน %d วินาที" % (self.settings.proc_name, LAUNCH_SPAWN_GRACE)
                                  + self._seen_hint(), "launch")

        try:
            self._wait_cond(spec["post"], float(spec.get("post_timeout", 60)), "launch", "LAUNCH_FAILED",
                            "ไม่พบหน้า Login", spec.get("allow_dialogs"), each=vanished)
        except HelperError as e:
            if e.code == "UNEXPECTED_DIALOG":           # กล่องก่อนล็อกอิน = เปิดโปรแกรมไม่สำเร็จ (เช่น ต่อ SQL Server ไม่ได้)
                raise HelperError("LAUNCH_FAILED", e.message, "launch", e.detail)
            raise

    def _seen_hint(self):
        return " · กล่องที่เห็น: " + self._dialog_text(*self.dialogs_seen[-1]) if self.dialogs_seen else ""

    def _step_normal(self, name, spec):
        """คืน True ถ้าข้ามทั้งขั้น (skip_if ตรง = ค่าที่ต้องการมีอยู่แล้ว ไม่แตะอะไร) — ตรวจอ่านอย่างเดียว"""
        allow = spec.get("allow_dialogs")
        if not spec.get("actions"):
            raise HelperError("LOCATOR_MISSING", "ขั้น %s ไม่มี actions (รอตรวจหน้าต่างจริง)" % name, name)
        self._restore_minimized(name)          # ก่อนอ่านอะไรทั้งนั้น — หน้าต่างที่ถูกย่ออ่านพิกัดไม่ได้
        if spec.get("skip_if") and self._cond(spec["skip_if"], name):
            self.log("[%s] ข้าม: ค่าในฟอร์มตรงที่ต้องการอยู่แล้ว (ไม่แตะอะไร)" % name)
            return True
        self._wait_cond(spec.get("pre"), float(spec.get("pre_timeout", 15)), name, "PRECONDITION_FAILED",
                        spec.get("pre_what") or "ยังไม่พบหน้าจอที่ต้องใช้ในขั้นนี้", allow)
        for a in spec["actions"]:
            self._act(a, name, allow)
        if self.opts.dry_run:
            return
        try:
            self._wait_cond(spec.get("post"), float(spec.get("post_timeout", 20)), name, "POSTCONDITION_FAILED",
                            spec.get("post_what") or "หน้าจอหลังคลิกไม่ขึ้นตามที่คาด", allow)
        except HelperError as e:
            if name == "login" and self._typed_creds and e.code in ("POSTCONDITION_FAILED", "UNEXPECTED_DIALOG"):
                raise HelperError("LOGIN_FAILED", "เข้าสู่ระบบไม่สำเร็จ — ตรวจ PROMAXX_USERNAME/PASSWORD (ไม่ลองซ้ำ กันบัญชีถูกล็อก)"
                                  + ("" if e.code == "POSTCONDITION_FAILED" else " · " + e.message), "login", e.detail)
            raise
        if name == IMPORT_STEP:
            self._after_import = True
        return False

    def run_step(self, name):
        t0 = self.clock()
        self.log("── ขั้น %s ──" % name)
        skipped = False
        try:
            spec = self._spec(name)
            if name == "launch":
                self._step_launch(spec)
            else:
                skipped = bool(self._step_normal(name, spec))
        except HelperError as e:
            if not e.step:
                e.step = name
            self.steps.append({"name": name, "ok": False, "ms": int((self.clock() - t0) * 1000)})
            raise
        item = {"name": name, "ok": True, "ms": int((self.clock() - t0) * 1000)}
        if skipped:
            item["skipped"] = True          # ค่าตรงที่ต้องการอยู่แล้ว ไม่ได้แตะฟอร์ม
        self.steps.append(item)

    def _log_uia_stats(self):
        st = getattr(self.adapter, "uia_stats", None)
        if st:
            try:
                s = st()
                if s and s.get("calls"):
                    self.log("UIA: %d ครั้ง รวม %.1f วินาที (เฉลี่ย %d ms · ช้าสุด %d ms)" % (s["calls"], s["totalMs"] / 1000.0, s["avgMs"], s["maxMs"]))
            except Exception:       # noqa: BLE001
                pass

    def run(self, doc_type, only_step=None):
        """คืน (http_status, dict) — เส้นทางเดียวกันทั้ง HTTP และ CLI"""
        try:
            return self._run(doc_type, only_step)
        finally:
            self._log_uia_stats()

    def _run(self, doc_type, only_step=None):
        t0 = self.clock()
        self.doc_type = doc_type
        info = DOC_TYPES[doc_type]
        self.tokens = dict(info)         # letter · menu_th · menu_cls · form_cls · code · type_name (ทุกคีย์ใน DOC_TYPES แทนเข้า spec ได้)
        self.tokens["type_row"] = "%s %s" % (info["code"], info["type_name"])   # ชื่อแถวในหน้าต่างรายการ (มีช่องว่าง → ใช้เป็นโทเคนดิบ {=type_row} เท่านั้น)
        try:
            self._preflight(only_step)
            names = (only_step,) if only_step else STEP_ORDER
            for n in names:
                self.run_step(n)
            return 200, {"ok": True, "proto": PROTO, "version": VERSION, "type": doc_type, "dryRun": self.opts.dry_run,
                         "reached": names[-1], "elapsedMs": int((self.clock() - t0) * 1000), "steps": self.steps}
        except HelperError as e:
            self.log("✗ [%s] %s: %s" % (e.step or "?", e.code, e.message))
            if e.code not in ("BUSY", "UNVERIFIED", "NOT_CONFIGURED", "ALREADY_RUNNING", "OTHER_BOT_RUNNING", "NOT_RUNNING",
                              "UNSUPPORTED_DPI", "NO_DESKTOP") and not self.opts.dry_run:
                self._evidence(e)
            return e.http, error_body(e, self.log, self.steps)


def error_body(e, log, steps=None):
    scrub = getattr(log, "scrub", str)
    return {"ok": False, "proto": PROTO, "version": VERSION, "code": e.code, "step": e.step or "",
            "message": scrub(e.message), "steps": steps or []}


# ─────────────────────────────────────────────────────────────
# เครื่องมือตรวจ (อ่านอย่างเดียว) — dump หน้าต่าง/เมนู + screenshot ลง runs/
# ─────────────────────────────────────────────────────────────

def render_dump_text(dump):
    lines = ["PromaxxHelper dump  %s" % dump.get("time", ""),
             "foreground: %s" % (dump.get("foreground"),),
             "cursor: %s   dpi: %s   env: %s" % (dump.get("cursor"), dump.get("dpi"), dump.get("note", ""))]
    for w in dump.get("windows", []):
        lines.append("")
        lines.append("TOP hwnd=%s pid=%s cls=%r text=%r rect=%s vis=%s en=%s style=%s" % (
            w.get("hwnd"), w.get("pid"), w.get("cls"), w.get("text"), tuple(w.get("rect", ())), w.get("visible"), w.get("enabled"),
            w.get("style")))
        for it in w.get("menu", []):
            lines.append("  MENU %s  id=%s en=%s%s" % (" > ".join(it.get("path", [])), it.get("id"), it.get("enabled"),
                                                       " (submenu)" if it.get("submenu") else ""))
        for c in w.get("children", []):
            lines.append("  child hwnd=%s parent=%s id=%s cls=%r text=%r rect=%s vis=%s en=%s style=%s" % (
                c.get("hwnd"), c.get("parent"), c.get("ctrl_id"), c.get("cls"), c.get("text"), tuple(c.get("rect", ())),
                c.get("visible"), c.get("enabled"), c.get("style")))
    others = dump.get("others", [])
    if others:
        lines.append("")
        lines.append("หน้าต่างอื่นที่เห็นอยู่ (ไม่ใช่ของโปรเซส ssmaxx) — ใช้ดูว่าหน้าต่างจริงของ ProMaxx เป็นของโปรเซสชื่ออะไร:")
        for o in others:
            lines.append("  other pid=%s exe=%s cls=%r text=%r" % (o.get("pid"), o.get("exe"), o.get("cls"), o.get("text")))
    return "\n".join(lines) + "\n"


def write_dump(folder, dump, scrub=None):
    """scrub = ฟังก์ชันปิดรหัสผ่าน (Logger.scrub) — ไฟล์หลักฐานต้องไม่มีรหัสแม้หน้าต่างของโปรแกรมจะสะท้อนรหัสกลับมา"""
    scrub = scrub or str
    os.makedirs(folder, exist_ok=True)
    with open(os.path.join(folder, "dump.json"), "w", encoding="utf-8") as f:
        f.write(scrub(json.dumps(dump, ensure_ascii=False, indent=1)))
    with open(os.path.join(folder, "dump.txt"), "w", encoding="utf-8") as f:
        f.write(scrub(render_dump_text(dump)))


def write_uia_dumps(adapter, folder, pids, scrub=None, log=None):
    """UIA dump ของหน้าต่างระดับบนที่มองเห็นอยู่ทุกใบของ ssmaxx → uia_<n>_<hwnd>.txt (อ่านอย่างเดียว · ไม่อ่านค่าในช่องกรอก)
    ล้มได้โดยไม่กระทบงานหลัก (หลักฐานเป็นของเสริม) · scrub = ปิดรหัสผ่านเหมือนไฟล์หลักฐานอื่น"""
    if not hasattr(adapter, "uia_dump"):
        return 0
    scrub = scrub or str
    n = 0
    try:
        for w in adapter.top_windows(pids):
            if not w.visible or w.w < 10 or w.h < 10:
                continue
            try:
                lines = adapter.uia_dump(w.hwnd)
            except Exception as e:      # noqa: BLE001
                if log:
                    log("UIA dump ของหน้าต่าง %s ไม่สำเร็จ (%s)" % (w.hwnd, type(e).__name__))
                continue
            n += 1
            with open(os.path.join(folder, "uia_%d_%s.txt" % (n, w.hwnd)), "w", encoding="utf-8") as f:
                f.write(scrub("\n".join(lines) + "\n"))
    except Exception as e:      # noqa: BLE001
        if log:
            log("UIA dump ไม่สำเร็จ (%s)" % type(e).__name__)
    return n


def prune_runs(runs_dir, keep=30):
    """เก็บโฟลเดอร์หลักฐานล่าสุด keep อัน — กันดิสก์เต็ม"""
    try:
        subs = sorted(d for d in os.listdir(runs_dir) if os.path.isdir(os.path.join(runs_dir, d)))
        for d in subs[:-keep] if len(subs) > keep else []:
            p = os.path.join(runs_dir, d)
            for fn in os.listdir(p):
                try:
                    os.remove(os.path.join(p, fn))
                except OSError:
                    pass
            try:
                os.rmdir(p)
            except OSError:
                pass
    except OSError:
        pass


def run_inspect(adapter, settings, log, label=""):
    label = re.sub(r"[^A-Za-z0-9_.-]+", "_", label or "inspect")[:40] or "inspect"
    folder = os.path.join(settings.runs_dir, "%s_%s" % (time.strftime("%Y%m%d_%H%M%S"), label))
    pids = adapter.pids(settings.proc_name)
    if not pids:
        log("หมายเหตุ: ไม่พบโปรเซส %s ที่รันอยู่ — dump จะไม่มีหน้าต่างของ ProMaxx" % settings.proc_name)
    dump = adapter.dump(pids)
    write_dump(folder, dump, getattr(log, "scrub", None))
    shot = adapter.screenshot(os.path.join(folder, "screen.png"))
    n_uia = write_uia_dumps(adapter, folder, pids, getattr(log, "scrub", None), log)
    log("บันทึกผลตรวจ (อ่านอย่างเดียว ไม่คลิก): %s · หน้าต่างระดับบน %d · ภาพหน้าจอ %s · UIA %d หน้าต่าง" % (
        folder, len(dump.get("windows", [])), "ได้" if shot else "ไม่ได้", n_uia))
    prune_runs(settings.runs_dir)
    return folder


def run_find(adapter, settings, log):
    info = adapter.env_info(settings.proc_name, EXE_CANDIDATES, settings.exe_path)
    for k, v in info.items():
        log("%s: %s" % (k, v))
    return info


# ─────────────────────────────────────────────────────────────
# Service — ความหมายของ HTTP (ไม่ผูกกับ socket → เรียก handle() ตรงๆ ในเทสได้)
# ─────────────────────────────────────────────────────────────

class Service:
    def __init__(self, settings, adapter, log, specs=None, clock=None, sleep=None):
        self.settings = settings
        self.adapter = adapter
        self.log = log
        self.specs = specs
        self.clock = clock
        self.sleep = sleep
        self._lock = threading.Lock()        # single-flight ในโปรเซสนี้
        self.busy = False

    # ── งานขับ ProMaxx (HTTP และ CLI ใช้ตัวเดียวกัน) ─────────────
    def run_job(self, doc_type, opts=None, only_step=None):
        if not self._lock.acquire(blocking=False):
            return 409, error_body(HelperError("BUSY", "ตัวช่วยกำลังทำงานอยู่ — รอสักครู่", "preflight"), self.log)
        got_mutex = False
        try:
            if not self.adapter.acquire_mutex(JOB_MUTEX):
                return 409, error_body(HelperError("BUSY", "มีอีกโปรเซสของตัวช่วยกำลังขับ ProMaxx — รอสักครู่", "preflight"), self.log)
            got_mutex = True
            self.busy = True
            runner = Runner(self.adapter, self.settings, self.log, specs=self.specs, opts=opts, clock=self.clock, sleep=self.sleep)
            return runner.run(doc_type, only_step)
        except Exception as e:      # noqa: BLE001
            self.log("ข้อผิดพลาดที่ไม่คาดคิด: %s" % type(e).__name__)
            return 500, error_body(HelperError("INTERNAL", "ตัวช่วยผิดพลาดภายใน (%s) — ดู log" % type(e).__name__), self.log)
        finally:
            self.busy = False
            if got_mutex:
                self.adapter.release_mutex(JOB_MUTEX)
            self._lock.release()

    def health(self):
        return {"ok": True, "proto": PROTO, "version": VERSION, "ssmaxxRunning": bool(self.adapter.pids(self.settings.proc_name)),
                "busy": self.busy, "locatorsVerified": LOCATORS_VERIFIED,
                "stepsConfigured": [n for n in STEP_ORDER if (STEP_SPECS if self.specs is None else self.specs).get(n)]}

    # ── HTTP ────────────────────────────────────────────────────
    def handle(self, method, path, headers, body=b"", declared_length=None):
        """คืน (status, headers, bytes) · headers ของคำขอใส่ key ตัวพิมพ์เล็ก/ใหญ่อย่างไรก็ได้"""
        t0 = time.monotonic()
        h = {str(k).lower(): str(v) for k, v in (headers or {}).items()}
        origin = h.get("origin", "")
        origin_ok = bool(origin) and origin in self.settings.allowed_origins
        route = (path or "").split("?", 1)[0]
        preflight = False
        try:
            status, obj, preflight = self._route(str(method).upper(), route, h, origin, origin_ok, body, declared_length)
        except HelperError as e:
            status, obj = e.http, error_body(e, self.log)
        except Exception as e:      # noqa: BLE001
            self.log("HTTP ผิดพลาดภายใน: %s" % type(e).__name__)
            status, obj = 500, error_body(HelperError("INTERNAL", "ตัวช่วยผิดพลาดภายใน"), self.log)
        out = {"Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"}
        if origin_ok and obj.get("code") not in ("FORBIDDEN_HOST",):
            out["Access-Control-Allow-Origin"] = origin
            out["Vary"] = "Origin"
            if preflight:
                out["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
                out["Access-Control-Allow-Headers"] = "Content-Type, X-Anin-Helper"
                out["Access-Control-Allow-Private-Network"] = "true"
                out["Access-Control-Max-Age"] = "600"
        payload = b"" if status == 204 else json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.log("[HTTP] %s %s origin=%s → %s (%d ms)" % (method, route, origin or "-", status, int((time.monotonic() - t0) * 1000)))
        return status, out, payload

    def _route(self, method, route, h, origin, origin_ok, body, declared_length):
        port = self.settings.port
        if h.get("host", "") not in ("127.0.0.1:%d" % port, "localhost:%d" % port):
            raise HelperError("FORBIDDEN_HOST", "Host ไม่ถูกต้อง")
        if route not in ("/v1/health", "/v1/open-import"):
            if origin and not origin_ok:
                raise HelperError("FORBIDDEN_ORIGIN", "Origin ไม่อยู่ใน allow-list")
            raise HelperError("NOT_FOUND", "ไม่พบเส้นทาง")
        if method == "OPTIONS":
            if not origin_ok:
                raise HelperError("FORBIDDEN_ORIGIN", "Origin ไม่อยู่ใน allow-list (ตั้ง HELPER_ALLOWED_ORIGINS)")
            return 204, {}, True
        if route == "/v1/health":
            if method != "GET":
                raise HelperError("METHOD_NOT_ALLOWED", "ใช้ GET")
            if origin and not origin_ok:                 # ไม่มี Origin (curl/ตรวจเอง) ผ่านได้ · มี Origin แต่ไม่อยู่ใน list = ปฏิเสธ
                raise HelperError("FORBIDDEN_ORIGIN", "Origin ไม่อยู่ใน allow-list (ตั้ง HELPER_ALLOWED_ORIGINS)")
            return 200, self.health(), False
        # POST /v1/open-import
        if method != "POST":
            raise HelperError("METHOD_NOT_ALLOWED", "ใช้ POST")
        if not origin_ok:
            raise HelperError("FORBIDDEN_ORIGIN", "Origin ไม่อยู่ใน allow-list (ตั้ง HELPER_ALLOWED_ORIGINS)")
        if h.get("x-anin-helper") != "1":
            raise HelperError("FORBIDDEN_HEADER", "ขาด header X-Anin-Helper")
        if h.get("content-type", "").split(";")[0].strip().lower() != "application/json":
            raise HelperError("UNSUPPORTED_MEDIA", "Content-Type ต้องเป็น application/json")
        n = declared_length if declared_length is not None else len(body)
        if n > MAX_BODY or len(body) > MAX_BODY:
            raise HelperError("PAYLOAD_TOO_LARGE", "body ใหญ่เกิน %d ไบต์" % MAX_BODY)
        if n <= 0 or not body:
            raise HelperError("BAD_REQUEST", "body ว่าง")
        try:
            req = json.loads(body.decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            raise HelperError("BAD_REQUEST", "body ต้องเป็น JSON")
        if not isinstance(req, dict):
            raise HelperError("BAD_REQUEST", "body ต้องเป็น JSON object")
        extra = sorted(set(req) - {"proto", "type"})
        if extra:
            raise HelperError("BAD_REQUEST", "มี field ที่ตัวช่วยรุ่นนี้ไม่รู้จัก: %s (อัปเดต PromaxxHelper?)" % ", ".join(extra))
        if req.get("proto") != PROTO:
            raise HelperError("PROTO_MISMATCH", "proto ไม่ตรง (ตัวช่วยรุ่นนี้ใช้ %d)" % PROTO)
        if req.get("type") not in DOC_TYPES:
            raise HelperError("BAD_REQUEST", "type ต้องเป็น ORDS หรือ IRPS")
        status, obj = self.run_job(req["type"])
        return status, obj, False


def make_server(service, host="127.0.0.1", port=None):
    class Handler(BaseHTTPRequestHandler):
        server_version = "PromaxxHelper"
        sys_version = ""
        timeout = IDLE_CONN_TIMEOUT

        def _serve(self):
            try:
                length = int(self.headers.get("Content-Length") or 0)
            except ValueError:
                length = -1
            body = self.rfile.read(length) if 0 < length <= MAX_BODY else b""
            status, headers, payload = service.handle(self.command, self.path, dict(self.headers.items()), body, declared_length=length)
            self.send_response(status)
            for k, v in headers.items():
                self.send_header(k, v)
            self.send_header("Content-Length", str(len(payload)))
            self.send_header("Connection", "close")
            self.end_headers()
            if payload and self.command != "HEAD":
                self.wfile.write(payload)

        do_GET = do_POST = do_OPTIONS = do_PUT = do_DELETE = do_PATCH = do_HEAD = _serve

        def log_message(self, fmt, *args):      # ปิด log ดิบของ http.server (Service.handle จดเองแล้ว)
            pass

    srv = ThreadingHTTPServer((host, service.settings.port if port is None else port), Handler)
    srv.daemon_threads = True
    service.settings.port = srv.server_address[1]       # port=0 (เทส) → พอร์ตจริงที่ได้
    return srv


# ─────────────────────────────────────────────────────────────
# CLI
# ─────────────────────────────────────────────────────────────

def exit_code_for(obj):
    code = (obj or {}).get("code")
    if code in ("BUSY", "ALREADY_RUNNING", "OTHER_BOT_RUNNING", "NOT_RUNNING"):
        return EXIT_BUSY
    if code in ("NOT_CONFIGURED", "UNVERIFIED", "UNSUPPORTED_DPI", "NO_DESKTOP"):
        return EXIT_CONFIG
    return EXIT_FAILED


def build_parser():
    p = argparse.ArgumentParser(prog="PromaxxHelper", description="ตัวช่วยบนเครื่อง ProMaxx ให้ปุ่ม บันทึกลง PROMAXX ของหน้า 📦 (index.html)")
    g = p.add_mutually_exclusive_group()
    g.add_argument("--serve", action="store_true", help="รอรับคำสั่งจากหน้าเว็บที่ 127.0.0.1 (ค่าเริ่มต้นเมื่อดับเบิลคลิก)")
    g.add_argument("--find", action="store_true", help="ตรวจสภาพเครื่อง (พาธ ssmaxx · session · สิทธิ์ · DPI) อ่านอย่างเดียว")
    g.add_argument("--inspect", action="store_true", help="dump หน้าต่าง/เมนู/ภาพหน้าจอของ ssmaxx.exe ลง runs/ (อ่านอย่างเดียว ไม่คลิก)")
    g.add_argument("--open", choices=["ords", "irps"], help="ทำทั้งขั้นตอนครั้งเดียว (เส้นทางเดียวกับปุ่มบนเว็บ)")
    g.add_argument("--step", choices=list(STEP_ORDER), help="ทำเฉพาะขั้นเดียวจากหน้าที่เปิดค้างไว้ (ใช้ปรับจูน)")
    g.add_argument("--close-ssmaxx", action="store_true", help="ปิด ssmaxx.exe (ใช้ตอนทดสอบซ้ำเท่านั้น ต้องใส่ --allow-close)")
    g.add_argument("--version", action="store_true", help="พิมพ์รุ่นแล้วจบ")
    p.add_argument("--type", choices=["ords", "irps"], help="ชนิดเอกสาร (ใช้กับ --step)")
    p.add_argument("--label", default="", help="ชื่อกำกับโฟลเดอร์ของ --inspect เช่น S3-menu")
    p.add_argument("--dry-run", action="store_true", help="ใช้กับ --step: หา target + วาดกากบาทลง screenshot แต่ไม่คลิก")
    p.add_argument("--hover-ms", type=int, default=0, help="เลื่อนเมาส์ไปค้างเหนือเป้าก่อนคลิกกี่ ms (ให้คนดูทัน)")
    p.add_argument("--force-unverified", action="store_true", help="ข้ามด่าน UNVERIFIED (เฉพาะเครื่องทดสอบ)")
    p.add_argument("--force-dpi", action="store_true", help="ข้ามด่าน Scaling 100%% (เฉพาะเครื่องทดสอบ)")
    p.add_argument("--allow-close", action="store_true", help="อนุญาตให้ --close-ssmaxx ปิดโปรแกรม")
    p.add_argument("--port", type=int, help="พอร์ต (ทับ HELPER_PORT)")
    return p


def _utf8_console():
    for s in (sys.stdout, sys.stderr):
        try:
            s.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass


def main(argv=None, adapter_factory=None, settings=None, log=None, clock=None, sleep=None):
    args = build_parser().parse_args(argv)
    if args.version:
        print("PromaxxHelper %s proto=%d locatorsVerified=%s" % (VERSION, PROTO, LOCATORS_VERIFIED))
        return EXIT_OK
    if args.dry_run and not args.step:
        print("ใช้ --dry-run ได้กับ --step เท่านั้น (ต้องเปิด ssmaxx.exe ไว้ที่หน้าที่ถูกต้องก่อน — ไม่ล็อกอิน/เปิดโปรแกรมแทนในโหมดนี้)")
        return EXIT_CONFIG
    if args.hover_ms < 0 or args.hover_ms > 10000:
        print("--hover-ms ต้องอยู่ระหว่าง 0–10000")
        return EXIT_CONFIG
    if args.allow_close and not args.close_ssmaxx:
        print("--allow-close ใช้คู่กับ --close-ssmaxx เท่านั้น")
        return EXIT_CONFIG
    if args.step and args.step not in ("launch", "login") and not args.type:
        print("--step %s ต้องระบุ --type ords|irps" % args.step)
        return EXIT_CONFIG
    _utf8_console()

    warns = []
    st = settings or load_settings(warn=warns.append)
    if args.port:
        st.port = args.port
    log = log or Logger(st.log_path)
    log.add_secret(st.password)
    for w in warns:
        log("⚠ " + w)

    if adapter_factory is None:
        try:
            import promaxx_win
        except ImportError:
            print("ไม่พบ promaxx_win.py")
            return EXIT_CONFIG
        try:
            adapter_factory = lambda: promaxx_win.WinAdapter(WinInfo, MenuItem, log, uia_cls=UiaEl)   # noqa: E731
            adapter = adapter_factory()
        except ImportError as e:
            print("ต้องรันบน Windows และติดตั้ง pywin32 / psutil / pillow (%s)" % e)
            return EXIT_CONFIG
    else:
        adapter = adapter_factory()

    if args.find:
        run_find(adapter, st, log)
        return EXIT_OK
    if args.inspect:
        run_inspect(adapter, st, log, args.label)
        return EXIT_OK
    if args.close_ssmaxx:
        if not args.allow_close:
            print("--close-ssmaxx ต้องใส่ --allow-close (จะปิด ssmaxx.exe ทุกตัวที่เปิดอยู่ — ใช้ตอนทดสอบเท่านั้น)")
            return EXIT_CONFIG
        n = adapter.close_processes(adapter.pids(st.proc_name))
        log("ปิด ssmaxx.exe แล้ว %d โปรเซส" % n)
        return EXIT_OK

    svc = Service(st, adapter, log, clock=clock, sleep=sleep)
    if args.open or args.step:
        doc = (args.open or args.type or "ords").upper()
        opts = JobOpts(dry_run=args.dry_run, hover_ms=args.hover_ms, force_unverified=args.force_unverified, force_dpi=args.force_dpi)
        status, obj = svc.run_job(doc, opts, only_step=args.step)
        log("ผล: %s" % json.dumps(obj, ensure_ascii=False))
        return EXIT_OK if status == 200 else exit_code_for(obj)

    # --serve (ค่าเริ่มต้น)
    if not adapter.acquire_mutex(SERVE_MUTEX):
        log("มี PromaxxHelper อีกตัวเปิดอยู่แล้ว — ไม่ทำอะไร")
        return EXIT_BUSY
    try:
        srv = make_server(svc, "127.0.0.1", st.port)
    except OSError as e:
        log("เปิดพอร์ต %d ไม่ได้ (%s) — มีโปรแกรมอื่นใช้พอร์ตนี้อยู่? (เปลี่ยนด้วย HELPER_PORT ใน .env และค่า PROMAXX_HELPER_URL ในหน้าเว็บ)" % (st.port, e.__class__.__name__))
        return EXIT_BUSY
    log("=" * 56)
    log("PromaxxHelper %s · รอคำสั่งที่ http://127.0.0.1:%d" % (VERSION, st.port))
    log("อนุญาตเว็บ: %s" % ", ".join(st.allowed_origins))
    log("ค่าตั้ง .env: %s" % (st.env_file or "(ตัวแปรระบบ / ไม่พบ .env)"))
    log("ตั้ง PROMAXX_USERNAME/PASSWORD แล้ว: %s" % ("ใช่" if st.username and st.password else "ยังไม่ครบ"))
    if not LOCATORS_VERIFIED:
        log("⚠ ยังไม่ผ่านการตรวจหน้าต่าง ssmaxx.exe จริง — ปุ่มบนเว็บจะถูกปฏิเสธ (UNVERIFIED) · ใช้ --inspect/--find เพื่อตรวจ")
    log("ปิดหน้าต่างนี้ = ตัวช่วยหยุดทำงาน")
    log("=" * 56)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        log("หยุดโดยผู้ใช้")
    finally:
        srv.server_close()
    return EXIT_OK


if __name__ == "__main__":
    try:
        code = main(sys.argv[1:])
    except SystemExit as e:
        code = e.code if isinstance(e.code, int) else EXIT_CONFIG
    except KeyboardInterrupt:
        code = EXIT_FAILED
    sys.exit(code)
