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
     ★ ข้อยกเว้น (รุ่น .6 · ผู้ใช้อนุมัติ 4 พ.ย. 2026): เส้นทาง "นำเข้าอัตโนมัติ" (/v1/prepare-import · /v1/run-import · /v1/cancel-import) รับเฉพาะ field
       ที่ตรวจรูปแบบเข้ม: branch (SRC|KKL|SSS) · ticket (ที่ตัวช่วยออกให้เอง) · docNo (ต้องตรงที่อ่านจาก ProMaxx) · เนื้อไฟล์ Text (10 ช่อง ≤ 20 แถว + hash)
       ชื่อไฟล์/พาธ/คำสั่ง "ไม่รับจากเว็บ" — ตัวช่วยตั้งชื่อและเขียนไฟล์ในโฟลเดอร์ของตัวเองเท่านั้น · เส้นทางเดิม /v1/open-import ไม่เปลี่ยน
  2. รับคำสั่งจาก Origin ที่อยู่ใน allow-list เท่านั้น + ตรวจ Host (กัน DNS rebinding) + บังคับ header X-Anin-Helper (บังคับ preflight)
  3. ขับเฉพาะหน้าต่างของ process ssmaxx.exe · foreground ต้องเป็นของ ssmaxx ก่อนพิมพ์/คลิกทุกครั้ง · พบ control ต้อง "1 รายการพอดี" ไม่เดา
  4. ล็อกอินครั้งเดียว ห้าม retry อัตโนมัติ (กันบัญชีถูกล็อก) · รหัสผ่านห้ามลง log/ผลลัพธ์/screenshot
  5. ssmaxx.exe เปิดอยู่แล้ว = ปฏิเสธ ไม่แตะอะไร (โปรแกรมเปิดซ้อนไม่ได้อยู่แล้ว · ผู้ใช้เลือก 3 พ.ย. 2026)
     ★ ข้อยกเว้น (รุ่น .5 · ผู้ใช้สั่ง 4 พ.ย. 2026 · PROMAXX_ATTACH_EXISTING เปิดเป็นค่าเริ่มต้น): ใช้ ProMaxx ที่เปิดค้างต่อได้ "เฉพาะเมื่อปลอดภัย" =
       ล็อกอินแล้วและไม่มีแท็บฟอร์ม/ฟอร์มเอกสาร/กล่อง/หน้าต่างอื่นเปิดอยู่ (หรือค้างที่หน้า Login) — มีฟอร์มค้างหรือสถานะไม่ชัด = ปฏิเสธ SESSION_NOT_READY
       ไม่แตะงานของพนักงาน (ห้ามเปลี่ยนหน้าเองเมื่อมีฟอร์มเปิดอยู่) · ปิดได้ที่ .env = กลับเป็นปฏิเสธทุกกรณีที่เปิดอยู่
  6. LOCATORS_VERIFIED = False → ปฏิเสธคลิกจริงจากเว็บ (UNVERIFIED) · จะเป็น True ได้ต่อเมื่อตรวจกับหน้าต่าง ssmaxx.exe จริงครบแล้วเท่านั้น
     (ตั้งเป็น True แล้วตั้งแต่รุ่น 2026-11-04.4 — แก้ STEP_SPECS/ProMaxx อัปเดตหน้าตา = ตั้ง False ระหว่างตรวจใหม่)
  7. หลังคลิกปุ่ม "นำเข้าไฟล์เอกสาร" ห้ามส่ง input เพิ่ม (ขั้นถัดไปต้องขออนุมัติ)
     ★ ข้อยกเว้นเดียว (รุ่น .6 · ผู้ใช้อนุมัติ 4 พ.ย. 2026 · เฉพาะเส้นทางนำเข้าอัตโนมัติ · สาขา SRC/KKL/SSS): ส่งได้เฉพาะ (ก) ใส่ชื่อไฟล์ลงช่อง File name ของกล่อง
       Select File + กด Open (ผ่าน Windows message ไม่ใช้เมาส์) (ข) กด "ตกลง" (cb_ok) "ครั้งเดียว" หลังตารางรายละเอียดตรงไฟล์ทุกแถว (SKU + จำนวน + ยอดรวม)
       และ PROMAXX_AUTO_CONFIRM เปิด (ค่าเริ่มต้นปิด) — หลังกด "ตกลง" ห้ามมี input อีก · ห้ามกดปุ่มอื่นของแถบปุ่ม (เพิ่ม/ลบ/ยกเลิก/อนุมัติ ฯลฯ)
  7c. ก่อนกด "ตกลง": เลขที่เอกสาร/ประเภท/สาขา/คลังในฟอร์มต้องเหมือนตอนอ่านเลขที่ (จังหวะ 1) · ตารางต้องว่างก่อนนำเข้า · ตารางหลังนำเข้าต้องตรงไฟล์ทุกแถว
      ไม่ผ่านข้อใด = หยุด ไม่กด ดึง ProMaxx ขึ้นหน้าให้พนักงานตัดสินใจเอง · ไม่ลองซ้ำ
  7b. ก่อนคลิกปุ่มนำเข้า ต้องอ่านกลับได้ครบ: ประเภทเอกสารตรงชื่อ · เลขที่เอกสารขึ้นต้นรหัสประเภท · คลัง = Front Store — ไม่ตรงข้อใด = หยุด
      ห้ามเดา/ห้ามเชื่อค่าเริ่มต้นของฟอร์ม (ProMaxx เปิดฟอร์มมาเป็นประเภท/คลังต่างกันได้) · เลือกค่าในหน้าต่างรายการต้องเจอแถว "ชื่อตรงทุกตัวอักษร 1 แถวพอดี"
      และเครื่องหมายเลือกแถวต้องย้ายมาที่แถวนั้นก่อนกด "ตกลง" · หน้าต่างรายการเป็นหน้าต่างระดับบนใหม่ทุกครั้ง (hwnd/GUID เปลี่ยน) หาจากชื่อ ไม่จำ hwnd
  8. ไม่ขับ ProMaxx ซ้อนกับบอทอื่นที่แย่งเมาส์/คีย์บอร์ด (BLOCK_PROCS)
  8b. ★ โหมดซ่อนหน้าต่าง (รุ่น .5 · PROMAXX_HIDE_AFTER_LOGIN เปิดเป็นค่าเริ่มต้น · เฉพาะการทำงานเต็ม --open/HTTP ไม่ใช่ --step/--dry-run):
      ล็อกอินด้วยเมาส์/คีย์จริงตามเดิม (ช่องรหัสผ่านไม่มี ValuePattern) แล้วซ่อนหน้าต่างหลัก (SW_HIDE) และสั่งเมนู/ปุ่ม O,I/ปุ่มนำเข้าด้วย UIA
      (Invoke/Select — ไม่ใช้เมาส์/คีย์บอร์ด) ด้วยกติกาหาเป้าเดิมทุกข้อ (พบ 1 รายการพอดี · อ่านกลับประเภท/คลัง/สาขาก่อนกดนำเข้า)
      · ขั้นที่ต้องใช้เมาส์จริง (หน้าต่างรายการประเภท/คลัง) = แสดงหน้าต่างกลับก่อนแล้วใช้เส้นทางเดิม · ⛔ ต้องแสดงหน้าต่างกลับเสมอ
      ทุกทางออก (สำเร็จ/ล้ม/ข้อผิดพลาดที่ไม่คาดคิด) และตอนตัวช่วยเริ่มทำงาน/--reveal-ssmaxx (กันหน้าต่างหายค้าง) · แสดงกลับไม่นับเป็น input
  9. ssmaxx.exe เป็นแอป WPF (ไม่มี HWND/HMENU ข้างใน) → หาเป้าด้วย UIA (promaxx_uia.py) เท่านั้น · เป้าต้อง "พบ 1 รายการพอดี" ที่
     มองเห็นอยู่จริง (ไม่ใช่แค่ IsOffscreen=False — ปุ่มที่เลื่อนไปนอกกรอบหน้าต่างยังรายงาน False) · ต้องตรวจคลาสของหน้าแม่และ HelpText
     ก่อนคลิกปุ่มที่ id ซ้ำข้ามหน้าได้ (ปุ่มนำเข้าไฟล์มีทั้งฟอร์มเอกสารรับ/จ่ายและฟอร์มโอนสินค้า) · พิมพ์ได้เมื่อช่องที่ถูกต้องรับโฟกัสแล้วเท่านั้น

ไฟล์นี้ไม่ import win32*/psutil เลย (ตัวต่อ Windows อยู่ promaxx_win.py + promaxx_uia.py) ⇒ เทสบน Linux ได้ด้วยตัวต่อปลอม

exit code: 0 สำเร็จ · 1 ไม่สำเร็จ · 2 ตัวเลือกผิด/ตั้งค่าไม่ครบ · 3 ไม่ได้ทำอะไร (มีตัวช่วยอื่น/ProMaxx เปิดอยู่/พอร์ตถูกใช้)
"""
import argparse
import hashlib
import json
import os
import re
import secrets
import shlex
import sys
import threading
import time
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
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
#   2026-11-04.5  (ผู้ใช้สั่ง 4 พ.ย. 2026 "A/B ร่วมกัน") ส่วน A: ใช้ ProMaxx ที่เปิด/ล็อกอินค้างต่อได้เมื่อปลอดภัย (ไม่มีฟอร์ม/กล่องค้าง) มิฉะนั้น SESSION_NOT_READY
#                 ส่วน B: ซ่อนหน้าต่างหลังล็อกอินแล้วสั่งผ่าน UIA (op act ใน promaxx_uia.py) · แสดงกลับเสมอ · --reveal-ssmaxx · ปิดได้ทาง .env
#                 (PROMAXX_ATTACH_EXISTING / PROMAXX_HIDE_AFTER_LOGIN) · ตรวจจริงแล้วว่าซ่อนหน้าต่างแล้ว UIA ยังอ่านพิกัด/สั่งปุ่มได้
#   2026-11-04.6  (ผู้ใช้สั่ง 4 พ.ย. 2026) "นำเข้าอัตโนมัติ" 2 จังหวะ (เฉพาะสาขายา SRC/KKL/SSS · WH ไม่ใช้): /v1/prepare-import เปิดฟอร์ม + ตรวจสาขา/คลัง/ประเภท + อ่านเลขที่เอกสาร
#                 → เว็บใส่เลขที่ใน popup → /v1/run-import (ตัวช่วยเขียนไฟล์เอง · ใส่ชื่อไฟล์ + Open ผ่าน Windows message · เทียบตารางกับไฟล์ · กด "ตกลง" เมื่อเปิด
#                 PROMAXX_AUTO_CONFIRM) · /v1/cancel-import · ตั๋ว (ticket) ใช้ครั้งเดียว หมดอายุ 10 นาที · เส้นทางเดิม /v1/open-import ไม่เปลี่ยน
#                 ⚠️ ภายในรุ่นนี้ (ยังไม่ส่งออกเครื่องอื่น — เลขรุ่นจึงไม่ขยับ) แก้เพิ่ม 2 ครั้งหลังตรวจจริง 5 พ.ย. 2026: (ก) show_window_back ใช้ SW_SHOWNA ไม่ใช่ SW_SHOWNOACTIVATE
#                 (รีสตอร์หน้าต่างที่ขยายเต็มจอ → ปุ่มนำเข้าหลุดกรอบ) (ข) ขั้น verify-table/confirm ตรวจ "หน้าต่างอื่นของ ProMaxx ค้าง" (ป๊อปอัพเลือก Lot No.) → UNEXPECTED_DIALOG
#                 บอกสาเหตุ แทน TABLE_MISMATCH · ก่อนส่ง exe ไปเครื่องอื่นต้อง build ใหม่จากโค้ดล่าสุด และถ้าเครื่องไหนมี exe .6 รุ่นก่อนหน้านี้อยู่ให้เลื่อนเลขรุ่น
VERSION = "2026-11-05.1"
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
ACT_PATTERN = {"Button": "invoke", "ListItem": "select", "TabItem": "select"}     # ชนิดองค์ประกอบที่สั่งแบบไม่ใช้เมาส์ได้ (ตรงกับ promaxx_uia.ACT_PATTERNS)
# ข้อความปฏิเสธเมื่อเซสชันที่เปิดค้างไม่ปลอดภัยพอจะใช้ต่อ — ต้องสั้น: หน้าเว็บโชว์ "ไม่สำเร็จที่ขั้น … — <ข้อความ ≤45 ตัวอักษร>" (รายละเอียดอยู่ใน log)
NOT_READY_FORM = "มีฟอร์มเอกสารค้างใน ProMaxx — ปิดก่อนแล้วกดใหม่"
NOT_READY_WINDOW = "ProMaxx มีหน้าต่างหรือกล่องค้าง — ปิดก่อนแล้วกดใหม่"
NOT_READY_LOGIN = "หน้า Login มีข้อความค้างอยู่ — ปิด ProMaxx แล้วกดใหม่"
NOT_READY_WAIT = "ProMaxx ยังไม่พร้อม — รอสักครู่แล้วกดใหม่"
# ข้อความเมื่อมีหน้าต่างอื่นของ ProMaxx ค้างระหว่างนำเข้า (ตรวจจริง 5 พ.ย. 2026: ป๊อปอัพเลือก Lot No.) — หน้าเว็บโชว์ _shortErr(ข้อความ, 70) ซึ่งนับเฉพาะตัวที่กินที่
# (ไม่นับสระบน-ล่าง/วรรณยุกต์) ⇒ ต้องสั้นพอให้ส่วน "ต้องทำอะไร" ไม่ถูกตัด (เทสตรึงความยาว) · ชื่อหน้าต่างที่แทรกใน MSG_EXTRA_WINDOW ถูกตัดที่ EXTRA_TITLE_MAX ตัวอักษร
MSG_LOT_POPUP = "ProMaxx ขอให้เลือก Lot No. — ยังไม่บันทึก เลือกหรือกดออกเอง แล้วลองใหม่"
MSG_EXTRA_WINDOW = "ProMaxx มีหน้าต่างอื่นค้าง (%s) — ยังไม่บันทึก ปิดก่อนแล้วลองใหม่"
EXTRA_TITLE_MAX = 16
# ── ล็อกอินแบบ "ล่องหน" (รุ่น 2026-11-05.1 · PROMAXX_LOGIN_MODE=message) ──
# ส่งชื่อผู้ใช้/รหัสผ่านเข้าช่อง Login ด้วยข้อความ Windows (WM_CHAR) ขณะหน้าต่างถูกซ่อน — ไม่ใช้เมาส์/คีย์บอร์ดจริง ไม่ต้องเห็นหน้าต่าง
# ตรวจจริง 5 พ.ย. 2026 (BIG-IT · Build ProMaxx 10.4.28.0845.1): ProMaxx สร้างหน้าต่างหลักแล้ว "แสดงเอง" ~7.6 วินาทีหลังเปิดโปรแกรม → ซ่อนทันทีที่โผล่ (~0.3 วินาที) ·
# ช่องชื่อผู้ใช้ยังได้โฟกัส (UIA HasKeyboardFocus) ทั้งที่ซ่อน/ไม่ใช่ foreground · WM_CHAR เข้าช่องถูกต้อง · Tab ย้ายไปช่องรหัสผ่าน ·
# หลัง Tab ProMaxx แสดงชื่อที่พิมพ์เป็นชื่อของ cf_empid:1 (อ่านกลับตรวจได้โดยไม่ต้องอ่านค่าช่องกรอก) · ล็อกอินจริงสำเร็จ 2 ครั้ง · โฟกัสแป้นพิมพ์ยังอยู่ที่ Chrome ตลอด
LOGIN_MODES = ("message", "input")
MSG_CHAR_DELAY = 0.08       # วินาทีระหว่างตัวอักษรที่ส่งด้วยข้อความ (ค่าที่ตรวจจริง)
MSG_TAB_SETTLE = 1.0        # รอหลัง Tab ให้ช่องรหัสผ่านสร้าง/รับโฟกัส (ค่าที่ตรวจจริง)
MSG_SUBMIT_SETTLE = 0.6     # รอหลังส่งรหัสผ่านครบ ก่อนกด SIGN IN (ค่าที่ตรวจจริง)
MSG_USER_FOCUS_WAIT = 8     # วินาที: รอให้ช่องชื่อผู้ใช้รับโฟกัสก่อนส่งข้อความ · ไม่รับ = ใช้เมาส์/คีย์จริงแทน (ยังไม่ได้ส่งอะไร)
HIDE_POLL = 0.05            # วินาที: ความถี่ตรวจว่าหน้าต่างหลักโผล่ขึ้นมาตอนรอเปิดโปรแกรม (Win32 อย่างเดียว ไม่ผ่าน UIA ที่ช้า ~1.5 วินาทีต่อครั้ง)
HIDE_MAX = 30               # ซ่อนซ้ำเกินกี่ครั้งถือว่าผิดปกติ (หน้าต่างโผล่ซ้ำไม่หยุด) → เลิกเฝ้า
HIDE_FAIL_MAX = 3           # สั่งซ่อนแล้วยังมองเห็นอยู่ติดกันกี่ครั้งก่อนยอมแพ้ (ใช้วิธีเมาส์/คีย์จริงแทน)
LOT_POPUP_MARKS = ("ui_popup_lotnoBalance", "id=dw_lotno")      # โครง UIA ของป๊อปอัพ Lot No. (คลาสของ UserObject ข้างใน · id ของ DataWindow) — ตรวจจริง 5 พ.ย. 2026
EXTRA_PEEK_NODES = 80                                            # โหนดสูงสุดที่อ่านจากหน้าต่างที่ค้าง (คลาส ui_popup_lotnoBalance อยู่โหนดที่ ~6)
JOB_MUTEX = "Local\\AninPromaxxHelperJob"        # กันสองโปรเซสขับ ProMaxx พร้อมกัน (เช่น --open ระหว่างที่ --serve กำลังทำงาน)
SERVE_MUTEX = "Local\\AninPromaxxHelperServe"    # กันเปิดตัวช่วยซ้อนกัน
DEFAULT_BLOCK_PROCS = ("seniorsoftexport.exe", "autor01export.exe")   # บอทที่ใช้เมาส์/คีย์บอร์ดจริง — ห้ามแย่งกัน
EXE_CANDIDATES = (
    r"C:\SeniorSoft ProMaxx\ssmaxx.exe",
    r"C:\Program Files (x86)\SeniorSoft ProMaxx\ssmaxx.exe",
    r"C:\Program Files\SeniorSoft ProMaxx\ssmaxx.exe",
)
EXIT_OK, EXIT_FAILED, EXIT_CONFIG, EXIT_BUSY = 0, 1, 2, 3

# ── นำเข้าอัตโนมัติ (รุ่น .6 · เฉพาะสาขายา — WH ไม่ใช้ปุ่มนี้ · ผู้ใช้สั่ง 4 พ.ย. 2026) ──
# ชื่อสาขาที่ ProMaxx แสดงในหัวฟอร์ม (SYSBRANCHID:1) — SRC ตรวจจากฟอร์มจริง 4 พ.ย. 2026 · KKL/SSS ตรงกับชื่อที่บอท auto-r16 ตรวจกับ ProMaxx แล้ว
# ⛔ ไม่ตรง = หยุดก่อนส่งเลขที่ให้เว็บ (กันนำเข้าผิดสาขา) · สาขาที่ไม่อยู่ในนี้ (เช่น WH) = BRANCH_NOT_SUPPORTED ไม่แตะ ProMaxx
BRANCH_FORM_NAMES = {
    "SRC": "อนิน สาขาแยกชากค้อ",
    "KKL": "อนิน สาขาเก้ากิโล",
    "SSS": "อนิน สาขาสวนเสือศรีราชา",
}
TICKET_TTL = 600               # วินาที: ตั๋วจากจังหวะ 1 ใช้ได้กี่วินาที (ใช้ครั้งเดียว)
IMPORT_MAX_ROWS = 20           # แถวสูงสุดต่อเอกสาร = หน้าละ 20 ของใบ 📦 (ตารางใน ProMaxx มองเห็น ~24 แถว — ห้ามเกินจนกว่าจะตรวจการเลื่อนตาราง)
MAX_IMPORT_BODY = 131072       # ไบต์: เพดานของ POST /v1/run-import (เส้นทางอื่นใช้ MAX_BODY)
IMPORT_KEEP_DAYS = 30          # วัน: ไฟล์ใน import\ เก่ากว่านี้ถูกลบเอง (เฉพาะไฟล์ชื่อรูปแบบของเรา)
VERIFY_MAX_NODES = 6000        # โหนดสูงสุดตอน dump ตาราง (ฟอร์มว่าง ~1,230 โหนด · 20 แถวราว 1,800)
CONFIRM_OBSERVE_SEC = 20       # วินาที: หลังกด "ตกลง" รอสังเกตผลนานเท่านี้
DOCNO_RE = re.compile(r"^(ORDS|IRPS)[A-Z0-9]{6,30}$")

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
# นำเข้าอัตโนมัติ (รุ่น .6): จังหวะ 1 = เปิดฟอร์ม + ตั้งประเภท/คลัง + ตรวจสาขา + อ่านเลขที่ (ไม่กดปุ่มนำเข้า) · จังหวะ 2 = กดนำเข้า → ใส่ชื่อไฟล์ + Open → เทียบตาราง → ตกลง
STEP_ORDER_PREPARE = STEP_ORDER[:-1] + ("form-ready",)
STEP_ORDER_IMPORT = ("import-click", "select-file", "verify-table", "confirm")
POST_IMPORT_INPUT_STEPS = ("select-file", "confirm")                     # ขั้นเดียวที่ส่ง input ได้หลังกดปุ่มนำเข้า (เส้นทางนำเข้าอัตโนมัติ)

HTTP_STATUS = {
    "BAD_REQUEST": 400, "PROTO_MISMATCH": 400, "FORBIDDEN_HOST": 403, "FORBIDDEN_ORIGIN": 403, "FORBIDDEN_HEADER": 403,
    "NOT_FOUND": 404, "METHOD_NOT_ALLOWED": 405, "PAYLOAD_TOO_LARGE": 413, "UNSUPPORTED_MEDIA": 415,
    "BUSY": 409, "ALREADY_RUNNING": 409, "SESSION_NOT_READY": 409, "OTHER_BOT_RUNNING": 409, "NOT_RUNNING": 409,
    "NOT_CONFIGURED": 422, "UNSUPPORTED_DPI": 422, "UNVERIFIED": 422, "NO_DESKTOP": 422,
    "TICKET_INVALID": 409, "TICKET_EXPIRED": 409, "STATE_CHANGED": 409,
    "FILE_INVALID": 422, "BRANCH_NOT_SUPPORTED": 422, "TABLE_MISMATCH": 422,
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
    attach_existing: bool = False    # PROMAXX_ATTACH_EXISTING (ค่าเริ่มต้นของ .env = เปิด · dataclass = ปิดเพื่อให้โค้ด/เทสที่สร้าง Settings เองได้พฤติกรรมเดิม)
    hide_after_login: bool = False   # PROMAXX_HIDE_AFTER_LOGIN (เหมือนข้างบน)
    auto_confirm: bool = False       # PROMAXX_AUTO_CONFIRM (รุ่น .6) — เปิด = กด "ตกลง" เองหลังตารางตรงไฟล์ · ค่าเริ่มต้นปิด (ตัวช่วยหยุดก่อนตกลง) จนกว่าจะทดสอบกดจริงผ่าน
    import_dir: str = ""             # PROMAXX_IMPORT_DIR — โฟลเดอร์ที่ตัวช่วยเขียนไฟล์นำเข้า (ค่าเริ่มต้น <โฟลเดอร์ตัวช่วย>\import)
    login_mode: str = "input"        # PROMAXX_LOGIN_MODE: message = ล็อกอินด้วยข้อความ Windows ขณะซ่อนหน้าต่าง (ไม่ใช้เมาส์/คีย์จริง) · input = เมาส์/คีย์จริง (ค่าของ dataclass = input เพื่อให้โค้ด/เทสที่สร้าง Settings เองได้พฤติกรรมเดิม · .env เริ่มต้น = message)
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


def _flag(text, default):
    """ค่าเปิด/ปิดจาก .env: 1/true/yes/on = เปิด · 0/false/no/off = ปิด · ว่าง/อื่นๆ = ค่าเริ่มต้น"""
    t = str(text or "").strip().lower()
    if t in ("1", "true", "yes", "on"):
        return True
    if t in ("0", "false", "no", "off"):
        return False
    return default


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
    s.attach_existing = _flag(get("PROMAXX_ATTACH_EXISTING"), True)
    s.hide_after_login = _flag(get("PROMAXX_HIDE_AFTER_LOGIN"), True)
    mode = get("PROMAXX_LOGIN_MODE").strip().lower()
    if mode in LOGIN_MODES:
        s.login_mode = mode
    else:
        s.login_mode = "message"
        if mode:
            warn("PROMAXX_LOGIN_MODE ต้องเป็น message หรือ input — ใช้ message")
    s.auto_confirm = _flag(get("PROMAXX_AUTO_CONFIRM"), False)
    s.import_dir = get("PROMAXX_IMPORT_DIR") or os.path.join(base_dir, "import")
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
# ชื่อผู้ใช้ที่ ProMaxx "แสดง" หลังโฟกัสย้ายออกจากช่อง (DWTextBlock · ชื่อ = ข้อความที่พิมพ์) — ตรวจจริง 5 พ.ย. 2026: ส่ง zzprobe + Tab แล้ว name='zzprobe'
# ใช้ตรวจว่าชื่อผู้ใช้ที่ส่งด้วยข้อความเข้าช่องครบก่อนส่งรหัสผ่าน (ไม่ต้องอ่านค่าช่องกรอก/ValuePattern)
_USER_SHOWN = {"within": _MAIN, "id": "cf_empid:1", "type": "Custom", "cls": "DWTextBlock", "ancestor": _UNDER_LOGIN}
_PASS_CELL = {"within": _MAIN, "id": ["cf_pass", "cf_pass:1"], "ancestor": _UNDER_LOGIN}
_PASS_EDIT = {"within": _MAIN, "id": "cf_pass", "type": "Edit", "cls": "PasswordBox", "focused": True, "ancestor": _UNDER_LOGIN}
_LOGIN_BTN = {"within": _MAIN, "id": "cb_Login", "type": "Button", "ancestor": _UNDER_LOGIN}
_MAIN_MENU_ANY = {"within": _MAIN, "type": "ListItem", "name": "เอกสารรับ", "ancestor": {"id": "lbx_manumain"}}
# ตัวบอกว่ามีฟอร์มเปิดค้าง (ตรวจจริง 4 พ.ย. 2026: หลังล็อกอิน/หลังเปิดเมนูย่อยยังไม่มีแท็บเลย · เปิดฟอร์มแล้วมีแท็บใต้ MDI_TAB + ปุ่มนำเข้า + หัวฟอร์ม)
# อ่านจาก "ตัวตน" (ไม่ต้องมองเห็น) — conservative: พบแม้ซ่อนอยู่ก็นับว่ามีฟอร์มค้าง
_OPEN_TABS = {"within": _MAIN, "type": "TabItem", "ancestor": {"id": "MDI_TAB"}}
_ANY_IMPORT_BTN = {"within": _MAIN, "id": "uo_tran_bt_import", "type": "Button"}
_ANY_TYPE_FIELD = {"within": _MAIN, "id": "SYSVOUCHERID:1"}
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
# ── นำเข้าอัตโนมัติ (รุ่น .6) ── ชื่อ/เลขที่ใช้โทเคนดิบ {=...} (เทียบตรงตัว · ชื่อสาขามีช่องว่าง)
_BRANCH_IS_TARGET = dict(_BRANCH_FIELD, name="{=branch_name}")
_DOCNO_IS_TARGET = {"within": _MAIN, "id": "TRANNO:1", "type": "Custom", "name": "{=doc_no}", "ancestor": _FORM}
# ตารางรายละเอียดต้องว่างก่อนนำเข้า: ไม่มีเซลล์ CF_ITEMID:1 ที่ชื่อไม่ว่าง (ตรวจจริง 4 พ.ย. 2026: ฟอร์มใหม่แถว 1 ว่าง · หลังนำเข้า CF_ITEMID:1 = รหัสสินค้า)
_TABLE_EMPTY = {"uia_gone": {"within": _MAIN, "id": "CF_ITEMID:1", "type": "Custom", "name_re": r"\S", "ancestor": _FORM}}
# ปุ่ม "ตกลง" ของฟอร์ม = Button cb_ok (ชื่อ/HelpText ว่าง) ใต้ sfw_buttonbar_ui → uo_tran_uo_1 → uo_tran → ฟอร์ม · พบตัวเดียว (ตรวจจริง 4 พ.ย. 2026)
# ⚠️ อยู่ติดกับ ลบ(cb_delete)/ยกเลิก(cb_cancel) ห่าง 1px — ระบุด้วย AutomationId + reverify เท่านั้น ห้ามคลิกตามตำแหน่ง/ข้อความ
_CONFIRM_BTN = {"within": _MAIN, "id": "cb_ok", "type": "Button", "ancestor": {"cls": "{form_cls}"}}
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
    # ── นำเข้าอัตโนมัติ (รุ่น .6) ──
    # จังหวะ 1: ตรวจว่าฟอร์มถูกต้องครบ (ประเภท · เลขที่ขึ้นต้นรหัสประเภท · คลัง Front Store · สาขา) แล้ว "อ่านเลขที่" — ไม่กดอะไร
    "form-ready": {
        "pre": {"all": [{"uia": _IMPORT_BTN}, {"uia": _TYPE_IS_TARGET}, {"uia": _NUMBER_PREFIX}, {"uia": _WH_IS_TARGET}, {"uia": _BRANCH_IS_TARGET}]},
        "pre_timeout": 8,
        "pre_what": "ฟอร์มยังไม่ใช่ประเภทเอกสาร/เลขที่/คลัง Front Store/สาขาที่ต้องการ — ไม่ส่งเลขที่ให้เว็บ",
        "actions": [{"do": "read", "sel": _NUMBER_PREFIX, "store": "doc_no", "label": "เลขที่เอกสาร"}],
        "post": {"uia": _NUMBER_PREFIX},
        "post_timeout": 8,
    },
    # จังหวะ 2 ขั้นแรก: ด่านเดียวกับ import-button + "เลขที่ต้องเหมือนตอนอ่าน" + "ตารางต้องว่าง" แล้วกดปุ่มนำเข้า
    "import-click": {
        "pre": {"all": [{"uia": _IMPORT_BTN}, {"uia": _TYPE_IS_TARGET}, {"uia": _DOCNO_IS_TARGET}, {"uia": _WH_IS_TARGET}, {"uia": _BRANCH_IS_TARGET}, _TABLE_EMPTY]},
        "pre_timeout": 8,
        "pre_what": "ฟอร์มเปลี่ยนไปจากตอนอ่านเลขที่ (ประเภท/เลขที่/คลัง/สาขา) หรือตารางมีรายการอยู่แล้ว — ไม่กดนำเข้า",
        "actions": [{"do": "click", "target": _uia(_IMPORT_BTN, reverify=True)}],
        "allow_dialogs": [r"^Select File\b"],
        "post": {"win": _FILE_DIALOG},
        "post_timeout": 20,
    },
    # กล่อง Select File: ใส่ชื่อไฟล์ (WM_SETTEXT) + Open (BM_CLICK) — ขั้นนี้ทำใน Runner._step_select_file (ตรวจ control id 1148/1/1136 ตามที่ตรวจจริง)
    "select-file": {
        "pre": {"win": _FILE_DIALOG},
        "post": {"gone": _FILE_DIALOG},
        "post_timeout": 15,
        "allow_dialogs": [r"^Select File\b"],
    },
    # เทียบตารางกับไฟล์ — ทำใน Runner._step_verify_table (อ่านผ่าน UIA dump · ไม่กดอะไร)
    "verify-table": {"custom": True},
    # กด "ตกลง": ด่านก่อนกดเหมือน import-click (ยกเว้นตารางต้อง "ไม่ว่าง" แล้ว ซึ่ง verify-table ตรวจละเอียดไปก่อนหน้า)
    "confirm": {
        "pre": {"all": [{"uia": _CONFIRM_BTN}, {"uia": _TYPE_IS_TARGET}, {"uia": _DOCNO_IS_TARGET}, {"uia": _WH_IS_TARGET}, {"uia": _BRANCH_IS_TARGET}]},
        "pre_timeout": 8,
        "pre_what": "ฟอร์มเปลี่ยนไปจากตอนอ่านเลขที่ หรือไม่เห็นปุ่ม ตกลง — ไม่กด",
        "actions": [{"do": "click", "target": _uia(_CONFIRM_BTN, reverify=True)}],
    },
}


def _utf16_units(text):
    """ข้อความ → รายการหน่วย UTF-16 (ตัวอักษรนอก BMP เช่นอีโมจิเป็น 2 หน่วย) — WM_CHAR รับทีละหน่วย"""
    b = str(text).encode("utf-16-le", "surrogatepass")
    return [b[i] | (b[i + 1] << 8) for i in range(0, len(b), 2)]


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


# ─────────────────────────────────────────────────────────────
# นำเข้าอัตโนมัติ (รุ่น .6): ตรวจเนื้อไฟล์ · เขียนไฟล์ · อ่านตารางจาก UIA · เทียบตาราง — ฟังก์ชันบริสุทธิ์ (เทสบน Linux ได้ · ไม่แตะ ProMaxx)
# ─────────────────────────────────────────────────────────────

_SKU_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._\-]{0,29}$")
# re.ASCII: \d รับเฉพาะ 0-9 (ค่าเริ่มต้นของ Python รับเลขยูนิโค้ดเช่น ๑๒/١٢ ด้วย) — ต้องตรงกับตัวตรวจฝั่งหน้าเว็บ (_adjPromaxxCheckText ใน index.html · เทส parity เทียบทั้งสองฝั่ง)
_NUM_RE = re.compile(r"^\d{1,9}(\.\d{1,4})?$", re.ASCII)
_LOT_RE = re.compile(r"^[^\x00-\x1f\x7f]{0,40}$")
_EXP_RE = re.compile(r"^\d{2}/\d{2}/\d{4}$", re.ASCII)
_IMPORT_NAME_RE = re.compile(r"^stockadj_(ords|irps)_[A-Z0-9]{6,30}_\d{2}-\d{2}-\d{4}_\d{6}(_\d{1,2})?\.txt$")


def _dec(text):
    try:
        return Decimal(str(text).replace(",", "").strip())
    except (InvalidOperation, ValueError):
        return None


def parse_import_text(text):
    """ตรวจเนื้อไฟล์ Text ที่เว็บสร้าง (รูปแบบเดียวกับ Export Text: SKU⇥จำนวน⇥ราคา⇥ช่องว่าง×5⇥LOT⇥EXP · CRLF · 10 ช่อง · ≤ IMPORT_MAX_ROWS แถว)
    → [{"sku","qty"(Decimal),"price"(Decimal|None),"lot","exp"}] · ผิดรูปแบบข้อใดข้อหนึ่ง = FILE_INVALID ทั้งไฟล์ (ไม่เดา · ไม่ตัดแถวทิ้งให้)"""
    if not isinstance(text, str) or not text:
        raise HelperError("FILE_INVALID", "ไฟล์ว่าง")
    if len(text.encode("utf-8")) > MAX_IMPORT_BODY:
        raise HelperError("FILE_INVALID", "ไฟล์ใหญ่เกินกำหนด")
    if "\x00" in text:
        raise HelperError("FILE_INVALID", "ไฟล์มีอักขระต้องห้าม")
    lines = text.replace("\r\n", "\n").split("\n")
    if lines and lines[-1] == "":
        lines.pop()                                  # Export ปิดท้ายด้วย newline
    if not lines or len(lines) > IMPORT_MAX_ROWS:
        raise HelperError("FILE_INVALID", "จำนวนรายการต้องอยู่ระหว่าง 1–%d (ได้ %d)" % (IMPORT_MAX_ROWS, len(lines)))
    rows, seen = [], set()
    for i, ln in enumerate(lines, 1):
        f = ln.split("\t")
        if len(f) != 10 or any(f[k] != "" for k in (3, 4, 5, 6, 7)):
            raise HelperError("FILE_INVALID", "แถว %d: รูปแบบคอลัมน์ไม่ตรง" % i)
        sku, qty, price, lot, exp = f[0], f[1], f[2], f[8], f[9]
        if not _SKU_RE.match(sku):
            raise HelperError("FILE_INVALID", "แถว %d: รหัสสินค้าไม่ถูกต้อง" % i)
        if not _NUM_RE.match(qty) or _dec(qty) <= 0:
            raise HelperError("FILE_INVALID", "แถว %d: จำนวนไม่ถูกต้อง" % i)
        if price != "" and not _NUM_RE.match(price):
            raise HelperError("FILE_INVALID", "แถว %d: ราคาไม่ถูกต้อง" % i)
        if not _LOT_RE.match(lot) or (exp != "" and not _EXP_RE.match(exp)):
            raise HelperError("FILE_INVALID", "แถว %d: LOT/EXP ไม่ถูกต้อง" % i)
        if sku in seen:
            raise HelperError("FILE_INVALID", "แถว %d: รหัสสินค้าซ้ำ (%s)" % (i, sku))
        seen.add(sku)
        rows.append({"sku": sku, "qty": _dec(qty), "price": _dec(price) if price != "" else None, "lot": lot, "exp": exp})
    return rows


def import_file_sha256(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def safe_doc_no(doc_no):
    s = str(doc_no or "").strip().upper()
    if not DOCNO_RE.match(s):
        raise HelperError("BAD_REQUEST", "เลขที่เอกสารไม่ถูกต้อง")
    return s


def import_file_name(doc_type, doc_no, now=None):
    """ชื่อไฟล์ที่ตัวช่วยเขียน — มาจากค่าที่ตัวช่วยตรวจเองเท่านั้น (ไม่รับชื่อ/พาธจากเว็บ) · stockadj_<ords|irps>_<เลขที่>_<วว-ดด-ปปปป>_<ชชนนวว>.txt"""
    t = time.localtime(now if now is not None else time.time())
    return "stockadj_%s_%s_%s_%s.txt" % (str(doc_type).lower(), safe_doc_no(doc_no), time.strftime("%d-%m-%Y", t), time.strftime("%H%M%S", t))


def write_import_file(directory, doc_type, doc_no, text, now=None):
    """เขียนไฟล์ UTF-8 (ไม่มี BOM · เนื้อตามที่เว็บส่งทุกไบต์ รวม CRLF) ลงโฟลเดอร์ของตัวช่วยเอง · สร้างใหม่เท่านั้น ไม่ทับไฟล์เดิม → พาธเต็ม"""
    try:
        os.makedirs(directory, exist_ok=True)
    except OSError as e:
        raise HelperError("STEP_FAILED", "สร้างโฟลเดอร์ไฟล์นำเข้าไม่ได้ (%s)" % type(e).__name__)
    base = os.path.join(os.path.abspath(directory), import_file_name(doc_type, doc_no, now))
    data = text.encode("utf-8")
    for n in range(0, 21):
        path = base if n == 0 else base[:-4] + "_%d.txt" % n
        try:
            fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_BINARY", 0), 0o600)
        except FileExistsError:
            continue
        except OSError as e:
            raise HelperError("STEP_FAILED", "เขียนไฟล์นำเข้าไม่ได้ (%s)" % type(e).__name__)
        with os.fdopen(fd, "wb") as f:
            f.write(data)
        return path
    raise HelperError("STEP_FAILED", "เขียนไฟล์นำเข้าไม่ได้ (ชื่อซ้ำ)")


def prune_import_dir(directory, days=IMPORT_KEEP_DAYS, now=None):
    """ลบไฟล์นำเข้าเก่ากว่า days วัน — เฉพาะชื่อรูปแบบของเรา (ไฟล์อื่นในโฟลเดอร์ไม่แตะ) · ไม่โยนข้อผิดพลาด"""
    try:
        cutoff = (now if now is not None else time.time()) - days * 86400
        for fn in os.listdir(directory):
            p = os.path.join(directory, fn)
            if _IMPORT_NAME_RE.match(fn) and os.path.isfile(p) and os.path.getmtime(p) < cutoff:
                os.remove(p)
    except OSError:
        pass


_DUMP_RE = re.compile(r'^\s*(\w+) id=(\S*) name="(.*?)" cls=(\S+) rect=')
_CELL_RE = re.compile(r"^(CF_ITEMID|QUANTITY|PRICE|AMOUNT|ITEMNAME|SYSUNITID):(\d+)$")


def parse_detail_dump(lines):
    """อ่านตารางรายละเอียดสินค้า + ยอดรวมจากข้อความ dump ของ UIA (รูปแบบจริง: 'Custom id=CF_ITEMID:1 name="100593" cls=DWTextBlock rect=(…) …')
    คืน {"rows": {n: {"sku","qty","price","amount","name","unit"}}, "total_qty": Decimal|None, "ambiguous": [..], "orphans": [..]}
    · แถว = เลขท้าย :N ของ CF_ITEMID ที่ชื่อไม่ว่าง · เซลล์ id ซ้ำ (มีชุดซ่อนอยู่ ค่าว่าง) → ใช้ค่าไม่ว่าง · ค่าไม่ว่างต่างกัน = ambiguous (ผู้เรียกต้องหยุด)
    · orphans = แถวที่ไม่มี CF_ITEMID แต่มีจำนวน/ยอดไม่ใช่ศูนย์ (แถวว่างท้ายตารางมีจำนวน ".00" ตามปกติ — ไม่นับ)"""
    cells, totals = {}, set()
    for ln in lines:
        m = _DUMP_RE.match(ln)
        if not m:
            continue
        id_, name = m.group(2), m.group(3).strip()
        if id_ == "CF_TOTALQUANTITY:1":
            if name:
                totals.add(name)
            continue
        mm = _CELL_RE.match(id_)
        if mm and name:
            cells.setdefault((int(mm.group(2)), mm.group(1)), set()).add(name)
    ambiguous, per_row = [], {}
    for (n, f), vals in cells.items():
        if len(vals) > 1:
            ambiguous.append("%s:%d" % (f, n))
        per_row.setdefault(n, {})[f] = sorted(vals)[0]
    rows, orphans = {}, []
    for n, c in sorted(per_row.items()):
        if c.get("CF_ITEMID"):
            rows[n] = {"sku": c["CF_ITEMID"], "qty": _dec(c.get("QUANTITY", "")), "price": _dec(c.get("PRICE", "")),
                       "amount": _dec(c.get("AMOUNT", "")), "name": c.get("ITEMNAME", ""), "unit": c.get("SYSUNITID", "")}
        else:
            for f in ("QUANTITY", "AMOUNT"):
                d = _dec(c.get(f, ""))
                if d is not None and d != 0:
                    orphans.append("แถว %d: มี%s แต่ไม่มีรหัสสินค้า" % (n, "จำนวน" if f == "QUANTITY" else "ยอด"))
                    break
    if len(totals) == 1:
        total = _dec(next(iter(totals)))
    else:
        total = None
        if len(totals) > 1:
            ambiguous.append("CF_TOTALQUANTITY:1")
    return {"rows": rows, "total_qty": total, "ambiguous": ambiguous, "orphans": orphans}


def compare_table(expected, table):
    """เทียบแถวจากไฟล์ (parse_import_text) กับตารางใน ProMaxx (parse_detail_dump) → รายการปัญหา (ว่าง = ตรงทุกแถว)
    ตรวจ: อ่านได้ไม่กำกวม · จำนวนแถวเท่ากัน · เลขแถว 1..N ต่อเนื่อง · SKU ตรงและไม่ซ้ำ · จำนวนตรงทุกแถว · ยอดรวมจำนวนตรง
    ราคา/LOT/EXP "ไม่ใช่เงื่อนไขหยุด" (ProMaxx อาจใช้ราคาของตัวเอง — จำนวนต่างหากที่กระทบสต็อก)"""
    problems = []
    if table["ambiguous"]:
        problems.append("อ่านตารางไม่ชัดเจน (%s)" % ", ".join(table["ambiguous"][:3]))
    problems += table["orphans"][:3]
    rows = table["rows"]
    if len(rows) != len(expected):
        problems.append("จำนวนแถวในตาราง %d ≠ ไฟล์ %d" % (len(rows), len(expected)))
    if sorted(rows) != list(range(1, len(rows) + 1)):
        problems.append("เลขแถวในตารางไม่ต่อเนื่อง")
    by_sku = {}
    for n, r in rows.items():
        by_sku.setdefault(r["sku"], []).append(n)
    for sku, ns in by_sku.items():
        if len(ns) > 1:
            problems.append("SKU %s ซ้ำในตาราง (แถว %s)" % (sku, ",".join(str(x) for x in ns)))
    for e in expected:
        ns = by_sku.get(e["sku"])
        if not ns:
            problems.append("SKU %s ไม่อยู่ในตาราง" % e["sku"])
            continue
        q = rows[ns[0]]["qty"]
        if q is None or q != e["qty"]:
            problems.append("SKU %s จำนวนในตาราง %s ≠ ไฟล์ %s" % (e["sku"], q if q is not None else "?", e["qty"]))
    want_total = sum((e["qty"] for e in expected), Decimal(0))
    if table["total_qty"] is None:
        problems.append("อ่านยอดรวมจำนวนในตารางไม่ได้")
    elif table["total_qty"] != want_total:
        problems.append("ยอดรวมจำนวน %s ≠ ไฟล์ %s" % (table["total_qty"], want_total))
    extra = [s for s in by_sku if s not in {e["sku"] for e in expected}]
    if extra:
        problems.append("มี SKU เกินในตาราง: %s" % ", ".join(extra[:3]))
    return problems


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
    el: object = None                # UiaEl ที่พบ (kind uia) — โหมดซ่อนหน้าต่างใช้ชนิด/พิกัดสั่งแบบไม่ใช้เมาส์


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
        self.resume_from = ""            # "" = เปิดโปรแกรมเอง · "login"/"ready" = ใช้ ProMaxx ที่เปิดค้าง (ข้าม launch / launch+login)
        self._hidden = set()             # hwnd หน้าต่างที่ตัวช่วยซ่อนไว้ (ต้องแสดงกลับเสมอ)
        self._hide_tried = False
        self._was_hidden = False
        self.captured = {}               # ค่าที่ action read อ่านไว้ (เช่น doc_no = เลขที่เอกสารที่ ProMaxx แสดง)
        self._input_steps_after_import = ()      # ขั้นที่ส่ง input ได้หลังกดปุ่มนำเข้า (เส้นทางนำเข้าอัตโนมัติเท่านั้น — ดู POST_IMPORT_INPUT_STEPS)
        self._locked = False             # True หลังกด "ตกลง" — ห้ามมี input อีกเลย
        self._import_path = ""
        self._import_rows = []
        self._msg_login = False          # True = ล็อกอินด้วยข้อความ Windows ขณะซ่อนหน้าต่าง (ตัดสินหลัง preflight · ดู _decide_login_mode) · เปิดอยู่ = _hide_watch ซ่อนหน้าต่างหลักที่โผล่ขึ้นมาเอง
        self._prev_fg = 0                # หน้าต่างที่อยู่ด้านหน้าตอนเริ่มงาน (เบราว์เซอร์ของพนักงาน) — คืนโฟกัสให้ถ้า ProMaxx ไปแย่ง
        self._t_start = 0.0
        self._hide_fail = 0
        self.hide_events = []            # [(วินาทีนับจากเริ่มงาน, hwnd)] ทุกครั้งที่ _hide_watch ซ่อนหน้าต่าง (ไว้วัด/เทส)
        self.confirm_after = None        # สิ่งที่เห็นหลังกด ตกลง (ไว้บอกผล/วินิจฉัย)

    # ── ตัวช่วย: หน้าต่างของ ssmaxx ──────────────────────────────
    def _pids(self):
        return self.adapter.pids(self.settings.proc_name)

    def _tops(self):
        out = []
        for w in self.adapter.top_windows(self._pids()):
            if not w.visible and w.hwnd not in self._hidden:       # หน้าต่างที่ "เราซ่อนเอง" ยังเป็นเป้าของ UIA (พิกัดคงเดิม — ตรวจจริง 4 พ.ย. 2026)
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
            if self._hidden:
                self._restore_foreground("ระหว่างรอ")        # ProMaxx ที่ซ่อนอยู่ยังดึง foreground ได้ (เจอจริงหลังกด SIGN IN) — คืนให้เบราว์เซอร์ของพนักงาน
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

    # ── หน้าต่างระดับบนอื่นของ ProMaxx ที่ค้างอยู่ (ไม่ใช่กล่องข้อความมาตรฐาน) ─────────────
    def _extra_windows(self):
        """หน้าต่างระดับบนของ ProMaxx ที่มองเห็นอยู่ แต่ไม่ใช่หน้าต่างหลัก · เกณฑ์เดียวกับด่านก่อนนำเข้า (_preflight_import)
        ตรวจจริง 5 พ.ย. 2026: Lot ในไฟล์ไม่มียอดคงเหลือ → ProMaxx เปิดป๊อปอัพ 'Lot No.' เป็นหน้าต่างระดับบนใหม่ของ ssmaxx.exe (ชื่อ sfw_winrespond เต็มจอ
        · ไม่ใช่ #32770 จึง adapter.dialogs() มองไม่เห็น) ขณะที่หน้าต่างหลักยังเป็น enabled และแถวยังไม่ถูกเพิ่มลงตาราง — เดิมตัวช่วยอ่านตารางไม่เจอแถวแล้ว
        รายงาน TABLE_MISMATCH (ทำให้เข้าใจผิดว่าไฟล์/ตารางพัง) ทั้งที่สาเหตุคือ ProMaxx รอให้คนเลือก"""
        return [w for w in self._tops() if not _match_win(w, _MAIN)]

    def _guard_extra_windows(self, step):
        """มีหน้าต่างอื่นของ ProMaxx ค้าง = หยุดทันที (UNEXPECTED_DIALOG · ยังไม่กด ตกลง · ปล่อยหน้าต่างนั้นไว้ให้พนักงานจัดการ) · อ่านอย่างเดียว ไม่ส่ง input
        รู้จักป๊อปอัพเลือก Lot No. (อ่านโครง UIA ของหน้าต่างนั้น — เฉพาะตอนล้ม) · อ่านไม่ได้/ไม่ใช่ = ข้อความทั่วไปพร้อมชื่อหน้าต่าง"""
        extras = self._extra_windows()
        if not extras:
            return
        lot = False
        for w in extras[:2]:
            try:
                lines = self.adapter.uia_dump(w.hwnd, max_nodes=EXTRA_PEEK_NODES)
            except Exception as e:      # noqa: BLE001 — อ่านโครงไม่ได้ก็รายงานแบบทั่วไป (ห้ามบังสาเหตุจริง)
                self.log("[%s] อ่านโครงหน้าต่างที่ค้างไม่ได้ (%s) — รายงานแบบทั่วไป" % (step, type(e).__name__))
                continue
            if any(mark in ln for ln in lines for mark in LOT_POPUP_MARKS):
                lot = True
                break
        desc = [[(w.cls or "")[:60], (w.text or "")[:60]] for w in extras[:4]]
        self.log("[%s] มีหน้าต่างอื่นของ ProMaxx ค้าง: %s%s" % (
            step, "; ".join("%s %r" % (c[:30], t) for c, t in desc), " — เป็นป๊อปอัพเลือก Lot No." if lot else ""))
        title = (extras[0].text or "").strip()[:EXTRA_TITLE_MAX] or "ไม่มีชื่อ"
        raise HelperError("UNEXPECTED_DIALOG", MSG_LOT_POPUP if lot else MSG_EXTRA_WINDOW % title, step,
                          detail={"windows": desc, "lotPopup": lot})

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
        if self._locked:
            self.actions_after_import += 1
            raise HelperError("STEP_FAILED", "หลังกด ตกลง ห้ามส่ง input เพิ่ม", step)
        if self._after_import and step not in self._input_steps_after_import:
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
            return Resolved("uia", "mouse", top, top.hwnd, e.rect, _center(e.rect), None, label, e.id, e)
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
        bg = (not self.opts.dry_run) and t.get("kind") == "uia" and top.hwnd in self._hidden      # หน้าต่างถูกซ่อน → สั่งผ่าน UIA ไม่ใช้เมาส์/โฟกัส
        if not self.opts.dry_run:
            self._guard_no_input(step)
            self._guard_dialogs(step, allow)
            if not bg and (t.get("via") == "mouse" or t.get("kind") in ("point", "uia")):       # uia = เมาส์จริงที่กึ่งกลางพิกัดจาก UIA เสมอ
                self._ensure_focus(top, step)
        res = self._resolve(t, step)                     # อ่านพิกัดหลังโฟกัส (หน้าต่างอาจถูกกู้จากย่อ → rect เปลี่ยน)
        if self.opts.dry_run:
            self._mark(res, step)
            return
        if bg:
            return self._act_uia(t, res, step)
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

    def _read(self, a, step):
        """อ่านชื่อขององค์ประกอบ "ตัวเดียวที่มองเห็นอยู่" เก็บลง self.captured[store] — อ่านอย่างเดียว ไม่คลิก (ใช้กับ dry-run ได้)"""
        sel = a.get("sel") or {}
        key = a.get("store") or ""
        if not key:
            raise HelperError("LOCATOR_MISSING", "action read ต้องระบุ store", step)
        top = self._one_top(sel.get("within"), "(อ่านค่า)", step)
        _, vis, _ = self._uia_matches(top, sel, step)
        if len(vis) != 1:
            raise HelperError("LOCATOR_NOT_FOUND" if not vis else "LOCATOR_NOT_UNIQUE",
                              "อ่าน %s ไม่ได้ (พบ %d รายการที่มองเห็น)" % (a.get("label") or key, len(vis)), step)
        self.captured[key] = vis[0].name
        self.log("[%s] %s: %s" % (step, a.get("label") or key, vis[0].name))

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
        if do == "read":
            return self._read(a, step)
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

    # ── โหมดซ่อนหน้าต่าง (รุ่น .5) ──────────────────────────────
    @staticmethod
    def _hidden_capable(spec):
        """ขั้นนี้ทำแบบไม่ใช้เมาส์ได้ไหม: ทุก action ต้องเป็น wait/await/note หรือ click ที่เป้าเป็น UIA ชนิดปุ่ม/รายการที่สั่ง Invoke/Select ได้
        (พิมพ์ · กดคีย์ · คลิกพิกัด · คลิกช่องข้อความ/แถวในหน้าต่างรายการ ต้องใช้เมาส์/คีย์จริง → ไม่ผ่าน)"""
        for a in spec.get("actions") or []:
            do = a.get("do")
            if do in ("wait", "await", "note", "read"):
                continue
            if do == "click":
                t = a.get("target") or {}
                if t.get("kind") == "uia" and ACT_PATTERN.get(t.get("type") or ""):
                    continue
            return False
        return True

    def _act_uia(self, t, res, step):
        """กดปุ่ม (Invoke) / เลือกรายการ (Select) ของหน้าต่างที่ถูกซ่อน — ไม่ใช้เมาส์/คีย์บอร์ด · เป้าเป็นตัวเดียวกับที่ _resolve เลือกแล้ว (พิกัดตรง)"""
        e = res.el
        pattern = ACT_PATTERN.get(e.type if e else "")
        if not pattern:
            raise HelperError("STEP_FAILED", "%s สั่งแบบไม่ใช้เมาส์ไม่ได้ (ชนิด %s)" % (res.label, e.type if e else "?"), step)
        if t.get("reverify"):
            again = self._resolve(t, step)
            if abs(again.rect[0] - res.rect[0]) > 2 or abs(again.rect[1] - res.rect[1]) > 2:
                raise HelperError("INTERFERENCE", "เป้า %s ขยับระหว่างเตรียมกด (%s → %s) — ไม่กด" % (res.label, res.rect, again.rect), step)
            res, e = again, again.el
        ok, why = self.adapter.uia_act(res.top.hwnd, ids=_sel_ids(t), ctype=e.type, name=t.get("name") or "", rect=e.rect, pattern=pattern)
        if not ok:
            raise HelperError("STEP_FAILED", "สั่ง %s ไม่สำเร็จ: %s" % (res.label, self._scrub(str(why))[:140]), step)
        self.log("[%s] %s %s (เบื้องหลัง — ไม่ใช้เมาส์)" % (step, "กด" if pattern == "invoke" else "เลือก", res.label))
        self.sleep(self.SETTLE)
        self._restore_foreground("หลังสั่งเบื้องหลัง")

    def _hide_main(self, step):
        """ซ่อนหน้าต่างหลักครั้งเดียวหลังล็อกอิน (หรือก่อนขั้นแรกเมื่อใช้เซสชันที่ล็อกอินค้างอยู่) · ซ่อนไม่สำเร็จ = ทำต่อแบบเห็นหน้าต่าง ไม่ล้ม"""
        if self._hide_tried or self.opts.dry_run or not self.settings.hide_after_login:
            return
        if self._hidden:                 # ล็อกอินแบบข้อความซ่อนไว้แล้ว — ตรวจว่ายังซ่อนอยู่ (ProMaxx อาจแสดงหน้าต่างเองอีกหลังล็อกอิน) ไม่ซ่อน/ไม่ log ซ้ำ
            self._hide_tried = True
            self._hide_watch(force=True)
            return
        self._hide_tried = True
        if not (hasattr(self.adapter, "hide_window") and hasattr(self.adapter, "uia_act")):
            return
        mains = self._find_tops(_MAIN)
        if len(mains) != 1:
            self.log("[%s] ไม่ซ่อนหน้าต่าง: พบหน้าต่างหลัก %d อัน (ทำงานแบบเห็นหน้าต่างตามเดิม)" % (step, len(mains)))
            return
        w = mains[0]
        try:
            self.adapter.hide_window(w.hwnd)
        except Exception as e:      # noqa: BLE001
            self.log("[%s] ซ่อนหน้าต่างไม่สำเร็จ (%s) — ทำงานแบบเห็นหน้าต่างตามเดิม" % (step, type(e).__name__))
            return
        self.sleep(0.4)
        if any(x.hwnd == w.hwnd and x.visible for x in self.adapter.top_windows(self._pids())):
            self.log("[%s] ซ่อนหน้าต่าง ProMaxx ไม่สำเร็จ (ยังมองเห็นอยู่) — ทำงานแบบเห็นหน้าต่างตามเดิม" % step)
            return
        self._hidden.add(w.hwnd)
        self._was_hidden = True
        self.log("[%s] ซ่อนหน้าต่าง ProMaxx แล้ว — สั่งเมนู/ปุ่มผ่านโครงสร้างภายใน (ไม่ใช้เมาส์/คีย์บอร์ด) จนถึงปุ่มนำเข้า" % step)

    def _reveal(self, why, focus_dialog=False):
        """แสดงหน้าต่างที่ซ่อนไว้กลับมา (ไม่ส่งคีย์/คลิก) · ไม่โยนข้อผิดพลาด · focus_dialog = ดึงกล่อง Select File ขึ้นหน้าสุดต่อ"""
        self._msg_login = False          # แสดงกลับแล้ว = เลิกเฝ้าซ่อน (ไม่งั้น _hide_watch จะซ่อนหน้าต่างที่ตั้งใจแสดง)
        if not self._hidden:
            return
        hs, self._hidden = list(self._hidden), set()
        for h in hs:
            try:
                self.adapter.show_window(h)
            except Exception as e:      # noqa: BLE001
                self.log("แสดงหน้าต่าง ProMaxx กลับไม่สำเร็จ (%s) — ใช้ --reveal-ssmaxx" % type(e).__name__)
        self.log("แสดงหน้าต่าง ProMaxx กลับมาแล้ว (%s)" % why)
        self.sleep(0.3)
        if focus_dialog:
            try:
                dlg = self._find_tops(_FILE_DIALOG)
                if len(dlg) == 1:
                    self.adapter.focus(dlg[0].hwnd)
            except Exception as e:      # noqa: BLE001
                self.log("ดึงกล่อง Select File ขึ้นหน้าไม่สำเร็จ (%s)" % type(e).__name__)

    def _reveal_quietly(self):
        try:
            self._reveal("สิ้นสุดงาน")
        except Exception:      # noqa: BLE001
            pass

    def _reveal_back(self, why):
        """แสดงหน้าต่างที่ซ่อนไว้กลับมา "โดยไม่ดึงขึ้นหน้า" (ไม่แย่งโฟกัสจากเบราว์เซอร์ของพนักงาน — อยู่หลังหน้าต่างอื่น เห็นบน taskbar) · ไม่โยนข้อผิดพลาด"""
        self._msg_login = False
        if not self._hidden:
            return
        hs, self._hidden = list(self._hidden), set()
        show = getattr(self.adapter, "show_window_back", None) or self.adapter.show_window
        for h in hs:
            try:
                show(h)
            except Exception as e:      # noqa: BLE001
                self.log("แสดงหน้าต่าง ProMaxx กลับไม่สำเร็จ (%s) — ใช้ --reveal-ssmaxx" % type(e).__name__)
        self.log("แสดงหน้าต่าง ProMaxx กลับมาแล้ว โดยไม่ดึงขึ้นหน้า (%s)" % why)

    def _send_main_back(self, why):
        """หน้าต่างหลักอยู่ด้านหน้า (เช่นขั้นเลือกประเภท/คลังต้องใช้เมาส์จริง) → ส่งไปอยู่หลังสุดโดยไม่ย่อ/ไม่ปิด เพื่อให้เบราว์เซอร์ของพนักงานกลับมาอยู่หน้า (ไม่ส่งคีย์/คลิก)"""
        fn = getattr(self.adapter, "show_window_back", None)
        if not fn:
            return
        try:
            mains = self._find_tops(_MAIN)
            if len(mains) == 1:
                fn(mains[0].hwnd)
                self.log("ส่งหน้าต่าง ProMaxx ไปอยู่หลังสุด (%s)" % why)
        except Exception as e:      # noqa: BLE001
            self.log("ส่งหน้าต่าง ProMaxx ไปหลังสุดไม่สำเร็จ (%s)" % type(e).__name__)

    def _bring_main_front(self, why):
        """แสดง + ดึงหน้าต่างหลักขึ้นหน้าสุด (ใช้เมื่อพนักงานต้องลงมือต่อเอง เช่น ตัวช่วยหยุดก่อน ตกลง)"""
        self._reveal(why)
        try:
            mains = self._find_tops(_MAIN)
            if len(mains) == 1:
                self.adapter.focus(mains[0].hwnd)
        except Exception as e:      # noqa: BLE001
            self.log("ดึงหน้าต่าง ProMaxx ขึ้นหน้าไม่สำเร็จ (%s)" % type(e).__name__)

    # ── ล็อกอินแบบ "ล่องหน" (รุ่น 2026-11-05.1) ──────────────────
    def _decide_login_mode(self, only_step):
        """ตัดสินหลัง preflight ว่าจะล็อกอินด้วยข้อความ (ไม่ใช้เมาส์/คีย์จริง) ไหม · เฉพาะงานเต็ม (ไม่ใช่ --step/dry-run) และเมื่อเปิดโหมดซ่อนหน้าต่างอยู่
        ใช้กับ cold start และ ProMaxx ที่ค้างหน้า Login · ล็อกอินแล้ว (ready) ไม่มีขั้นล็อกอิน · ตัวต่อที่ไม่มี method ครบ = ใช้วิธีเดิม"""
        self._msg_login = False
        st = self.settings
        if only_step or self.opts.dry_run or st.login_mode != "message" or not st.hide_after_login or self.resume_from == "ready":
            return
        if not all(callable(getattr(self.adapter, n, None)) for n in ("post_char", "post_key", "hide_window", "uia_act")):
            return
        self._msg_login = True
        self.log("[preflight] ล็อกอินแบบข้อความ: ซ่อนหน้าต่าง ProMaxx แล้วส่งชื่อผู้ใช้/รหัสผ่านด้วยข้อความ Windows (ไม่ใช้เมาส์/คีย์บอร์ดจริง)")

    def _remember_foreground(self, only_step):
        """จำหน้าต่างที่อยู่ด้านหน้าตอนเริ่มงาน (ปกติคือเบราว์เซอร์ที่พนักงานเพิ่งกดปุ่ม) ไว้คืนโฟกัสให้เมื่อ ProMaxx ไปแย่ง · อ่านอย่างเดียว"""
        self._prev_fg = 0
        self._t_start = self.clock()
        fn = getattr(self.adapter, "foreground_hwnd", None)
        if only_step or self.opts.dry_run or not callable(fn):
            return
        try:
            h = int(fn() or 0)
            fp = self.adapter.foreground_pid()
            if h and fp is not None and fp not in self._pids():
                self._prev_fg = h
        except Exception:      # noqa: BLE001
            self._prev_fg = 0

    def _restore_foreground(self, why):
        """ถ้าหน้าต่างด้านหน้าตอนนี้เป็นของ ProMaxx (แย่งโฟกัสแป้นพิมพ์จากเบราว์เซอร์ของพนักงาน — หน้าต่างที่ซ่อนแล้วก็ยังเป็น foreground ได้) ให้คืนให้หน้าต่างเดิม
        ไม่ใช่ของ ProMaxx = ไม่แตะ · ไม่ส่งคีย์/คลิก · ล้มไม่โยนข้อผิดพลาด"""
        h = self._prev_fg
        if not h or self.opts.dry_run:
            return False
        try:
            fp = self.adapter.foreground_pid()
            if fp is None or fp not in self._pids():
                return False
            self.adapter.focus(h)
        except Exception as e:      # noqa: BLE001
            self.log("คืนโฟกัสให้หน้าต่างเดิมไม่สำเร็จ (%s)" % type(e).__name__)
            return False
        self.log("คืนโฟกัสแป้นพิมพ์ให้หน้าต่างเดิมของพนักงาน (%s)" % why)
        return True

    def _hide_watch(self, force=False):
        """ซ่อนหน้าต่างหลักของ ProMaxx ที่ "โผล่ขึ้นมา" (ProMaxx แสดงหน้าต่างเองหลังโหลดเสร็จ) — อ่านหน้าต่างด้วย Win32 อย่างเดียว (เร็ว ไม่ผ่าน UIA)
        ทำงานเมื่อ _msg_login เปิดอยู่ (หรือ force) · ซ่อนแล้วเพิ่ม hwnd เข้า _hidden (UIA ยังอ่าน/สั่งผ่าน hwnd ได้) · ไม่ซ่อนหน้าต่างอื่น (กล่องข้อความ/ป๊อปอัพ ต้องให้พนักงานเห็น)
        ซ่อนแล้วยังมองเห็น HIDE_FAIL_MAX ครั้งติด หรือโผล่ซ้ำเกิน HIDE_MAX = เลิกเฝ้า (ล็อกอินจะใช้วิธีเมาส์/คีย์จริงถ้ายังไม่ได้ส่งอะไร)"""
        if self.opts.dry_run or not (self._msg_login or force):
            return False
        try:
            wins = self.adapter.top_windows(self._pids())
        except Exception:      # noqa: BLE001
            return False
        hid = False
        for w in wins:
            if not w.visible or not _match_win(w, _MAIN):
                continue
            if not ((w.w >= 50 and w.h >= 30) or w.rect[0] <= MINIMIZED_LEFT):
                continue
            try:
                self.adapter.hide_window(w.hwnd)
                still = any(x.hwnd == w.hwnd and x.visible for x in self.adapter.top_windows(self._pids()))
            except Exception as e:      # noqa: BLE001
                self.log("ซ่อนหน้าต่าง ProMaxx ไม่สำเร็จ (%s)" % type(e).__name__)
                still = True
            if still:
                self._hide_fail += 1
                if self._hide_fail >= HIDE_FAIL_MAX:
                    self.log("ซ่อนหน้าต่าง ProMaxx ไม่สำเร็จ %d ครั้งติด — เลิกเฝ้าซ่อน" % self._hide_fail)
                    self._msg_login = False
                continue
            self._hide_fail = 0
            again = w.hwnd in self._hidden
            self._hidden.add(w.hwnd)
            self._was_hidden = True
            self.hide_events.append((round(self.clock() - self._t_start, 2), w.hwnd))
            self.log("ซ่อนหน้าต่าง ProMaxx %s" % ("ที่โผล่กลับขึ้นมาอีก" if again else "ที่เพิ่งโผล่ขึ้นมา"))
            hid = True
            if len(self.hide_events) > HIDE_MAX:
                self.log("หน้าต่าง ProMaxx โผล่ซ้ำเกิน %d ครั้ง — เลิกเฝ้าซ่อน" % HIDE_MAX)
                self._msg_login = False
        if hid:
            self._restore_foreground("หลังซ่อนหน้าต่าง")
        return hid

    def _wait_launch_hidden(self, spec, vanished):
        """รอหน้า Login หลังสั่งเปิดโปรแกรม แบบเฝ้าซ่อนหน้าต่างที่โผล่ขึ้นมาเอง — วนเร็ว (HIDE_POLL) ด้วย Win32 ล้วน · ตรวจเงื่อนไข (UIA ช้า) ทุก POLL
        ก่อนหน้าต่างหลักโผล่ _cond ไม่เรียก UIA เลย (ไม่มีหน้าต่างที่มองเห็น/ที่เราซ่อน) จึงไม่เสียเวลาตอนที่ต้องจับจังหวะโผล่"""
        step = "launch"
        timeout = float(spec.get("post_timeout", 60))
        deadline = self.clock() + timeout
        next_eval = self.clock()
        while True:
            self._hide_watch()
            if self.clock() >= next_eval:
                if self._cond(spec["post"], step):
                    return
                self._guard_dialogs(step, spec.get("allow_dialogs"))
                vanished()
                next_eval = self.clock() + self.POLL
            if self.clock() >= deadline:
                raise HelperError("LAUNCH_FAILED", "ไม่พบหน้า Login ภายใน %d วินาที" % timeout, step)
            self.sleep(HIDE_POLL)

    def _message_login_blocker(self, step):
        """เหตุผลที่ล็อกอินด้วยข้อความไม่ได้ (ข้อความ) หรือ "" = ทำได้ — ตรวจ "ก่อนส่งอะไรทั้งนั้น" · ไม่ได้ = ใช้เมาส์/คีย์จริงแทน (ไม่มีอะไรค้างในช่อง)"""
        st = self.settings
        for what, text in (("ชื่อผู้ใช้", st.username), ("รหัสผ่าน", st.password)):
            if not text or any(ord(c) < 0x20 or ord(c) == 0x7F for c in text):
                return "%s ว่าง/มีอักขระควบคุม" % what
        mains = self._find_tops(_MAIN)
        if len(mains) != 1 or mains[0].hwnd not in self._hidden:
            return "ซ่อนหน้าต่าง ProMaxx ไม่สำเร็จ"
        if any(w.hwnd == mains[0].hwnd and w.visible for w in self.adapter.top_windows(self._pids())):
            return "หน้าต่าง ProMaxx ยังมองเห็นอยู่หลังสั่งซ่อน"
        if not mains[0].enabled:
            return "หน้าต่างหลักถูกล็อก (มีกล่องโมดัล)"
        try:
            self._wait_cond({"uia": _USER_EDIT}, MSG_USER_FOCUS_WAIT, step, "PRECONDITION_FAILED",
                            "ช่องชื่อผู้ใช้ยังไม่รับโฟกัสแป้นพิมพ์", None, each=self._hide_watch)
        except HelperError as e:
            if e.code == "PRECONDITION_FAILED":      # UNEXPECTED_DIALOG/UIA_ERROR ต้องหยุดจริง — ปล่อยให้ผู้เรียกโยนต่อ
                return e.message
            raise
        return ""

    def _post_units(self, hwnd, units, what, step, allow=None):
        """ส่งทีละหน่วย UTF-16 ด้วย WM_CHAR · ก่อนส่งทุกตัวตรวจกล่องข้อความของ ProMaxx (โผล่ = หยุด · หน้าต่างหลักที่ถูกล็อกด้วยกล่องรับข้อความไม่ได้) ·
        ส่งไม่เข้าคิวกลางทาง = STEP_FAILED (ห้ามลองซ้ำ — มีบางส่วนไปแล้ว) · ห้าม log ตัวอักษร"""
        pids = self._pids()
        for i, u in enumerate(units):
            self._guard_dialogs(step, allow)
            if not self.adapter.post_char(hwnd, u, pids):
                raise HelperError("STEP_FAILED", "ส่งข้อความเข้า ProMaxx ไม่สำเร็จ — ยังไม่ล็อกอิน", step,
                                  detail={"field": what, "sent": i, "total": len(units)})
            self.sleep(MSG_CHAR_DELAY)
            self._hide_watch()

    def _check_username_shown(self, step):
        """ProMaxx ต้องแสดงชื่อผู้ใช้ที่ส่งตรงกับ .env ก่อนส่งรหัสผ่าน (ส่งตก/ผิดช่อง/ปนกับของค้าง = หยุดตรงนี้ · ยังไม่มีการล็อกอิน จึงไม่นับเป็นล็อกอินผิด)
        เทียบแบบไม่สนตัวพิมพ์ใหญ่/เล็กและช่องว่างหัวท้าย (ProMaxx อาจแปลงตัวพิมพ์) · ชื่อใน UIA ถูกตัดที่ 80 ตัวอักษร"""
        top = self._one_top(_MAIN, "(ตรวจชื่อผู้ใช้)", step)
        _, vis, _ = self._uia_matches(top, _USER_SHOWN, step)
        want = (self.settings.username or "").strip().casefold()[:80]
        got = (vis[0].name or "").strip().casefold() if len(vis) == 1 else None
        if got is None or got != want:
            self.log("[%s] ชื่อผู้ใช้ที่ ProMaxx แสดงไม่ตรงกับที่ส่ง (ส่ง %d ตัวอักษร · เห็น %s) — ไม่ส่งรหัสผ่าน"
                     % (step, len(want), "ไม่ได้" if got is None else "%d ตัวอักษร" % len(got)))
            raise HelperError("STEP_FAILED", "ชื่อผู้ใช้ที่ ProMaxx รับไม่ตรง — ยังไม่ล็อกอิน", step)
        self.log("[%s] ProMaxx แสดงชื่อผู้ใช้ตรงกับที่ส่ง" % step)

    def _login_fallback(self, spec, why):
        """ล็อกอินด้วยข้อความไม่ได้ "ก่อนส่งอะไร" → ใช้วิธีเมาส์/คีย์จริง (แสดงหน้าต่างกลับ แล้วเดินขั้น login ตามเดิม) · เลิกเฝ้าซ่อน"""
        self.log("[login] ล็อกอินแบบข้อความไม่ได้ (%s) — ใช้เมาส์/คีย์บอร์ดจริงแทน (อย่าแตะเมาส์ระหว่างทำงาน)" % why)
        self._msg_login = False
        self._reveal("ล็อกอินแบบข้อความไม่ได้")
        return self._step_normal("login", spec)

    def _step_login_message(self, spec):
        """ขั้น login แบบล่องหน: ไม่ใช้เมาส์/คีย์บอร์ดจริง ไม่ต้องเห็นหน้าต่าง
        ก่อนส่งอะไร: ตรวจ _message_login_blocker + ข้อความแรกต้องเข้าคิว — ไม่ผ่านเป็นถอยไปวิธีเดิม (เมาส์/คีย์จริง)
        ส่งแล้ว = ไม่ถอยไปวิธีเดิม (ข้อความที่ค้างในช่องจะปนกับที่พิมพ์ใหม่) และไม่ลองซ้ำเด็ดขาด (กันบัญชีถูกล็อก):
          ชื่อผู้ใช้ → Tab → ช่องรหัสผ่านต้องได้โฟกัส → ProMaxx ต้องแสดงชื่อที่ส่งตรงกัน → รหัสผ่าน → กด SIGN IN (UIA Invoke) → รอเมนูหลัก
        ผิดพลาดก่อนส่งรหัสผ่าน = ยังไม่ได้ล็อกอิน (ไม่นับเป็นล็อกอินผิด)"""
        name = "login"
        st = self.settings
        allow = spec.get("allow_dialogs")
        self._guard_no_input(name)
        self._guard_dialogs(name, allow)
        self._wait_cond(spec.get("pre"), float(spec.get("pre_timeout", 15)), name, "PRECONDITION_FAILED",
                        spec.get("pre_what") or "ยังไม่พบหน้าจอที่ต้องใช้ในขั้นนี้", allow, each=self._hide_watch)
        self._hide_watch()
        why = self._message_login_blocker(name)
        if why:
            return self._login_fallback(spec, why)
        top = self._one_top(_MAIN, "(ส่งข้อความ)", name)
        pids = self._pids()
        units = _utf16_units(st.username)
        if not self.adapter.post_char(top.hwnd, units[0], pids):
            return self._login_fallback(spec, "ProMaxx ไม่รับข้อความ (อาจรันด้วยสิทธิ์สูงกว่าตัวช่วย)")
        self._typed_creds = True            # ส่งแล้ว: นับจากตรงนี้ว่าอาจมีข้อความค้างในช่อง — ห้ามถอยไปวิธีเดิม
        self.sleep(MSG_CHAR_DELAY)
        self._hide_watch()
        self._post_units(top.hwnd, units[1:], "ชื่อผู้ใช้", name, allow)
        self.log("[%s] ส่งชื่อผู้ใช้ด้วยข้อความ (%d ตัวอักษร) — ไม่ใช้เมาส์/คีย์บอร์ดจริง" % (name, len(st.username)))
        self._guard_dialogs(name, allow)
        if not self.adapter.post_key(top.hwnd, "tab", pids):
            raise HelperError("STEP_FAILED", "ส่ง Tab เข้า ProMaxx ไม่สำเร็จ — ยังไม่ล็อกอิน", name)
        self.sleep(MSG_TAB_SETTLE)
        self._hide_watch()
        try:
            self._wait_cond({"uia": _PASS_EDIT}, 8, name, "PRECONDITION_FAILED", "ช่องรหัสผ่านไม่รับโฟกัสหลัง Tab", allow, each=self._hide_watch)
        except HelperError as e:
            if e.code != "PRECONDITION_FAILED":
                raise
            self.log("[%s] %s — ไม่ส่งรหัสผ่าน" % (name, e.message))
            raise HelperError("PRECONDITION_FAILED", "ช่องรหัสผ่านไม่รับโฟกัสหลัง Tab — ยังไม่ล็อกอิน", name)       # ข้อความสั้นพอให้หน้าเว็บโชว์ครบ (ตัด 45 ตัวอักษร)
        self._check_username_shown(name)
        # กล่องข้อความที่โผล่หลัง Tab: _wait_cond คืนทันทีเมื่อเงื่อนไขจริงอยู่แล้ว (ไม่เรียกตรวจกล่อง) → _post_units ตรวจก่อนส่ง "ทุกตัวรวมตัวแรก" ของรหัสผ่านแทน
        self._post_units(top.hwnd, _utf16_units(st.password), "รหัสผ่าน", name, allow)
        self.log("[%s] ส่งรหัสผ่านด้วยข้อความ (%d ตัวอักษร)" % (name, len(st.password)))
        self.sleep(MSG_SUBMIT_SETTLE)
        self._hide_watch()
        self._guard_dialogs(name, allow)
        self._act({"do": "click", "target": _uia(_LOGIN_BTN)}, name, allow)           # หน้าต่างซ่อนอยู่ → _click สั่ง Invoke ผ่าน UIA (ไม่ใช้เมาส์)
        try:
            self._wait_cond(spec.get("post"), float(spec.get("post_timeout", 40)), name, "POSTCONDITION_FAILED",
                            spec.get("post_what") or "หน้าจอหลังคลิกไม่ขึ้นตามที่คาด", allow, each=self._hide_watch)
        except HelperError as e:
            if e.code in ("POSTCONDITION_FAILED", "UNEXPECTED_DIALOG"):
                raise HelperError("LOGIN_FAILED", "เข้าสู่ระบบไม่สำเร็จ — ตรวจ PROMAXX_USERNAME/PASSWORD (ไม่ลองซ้ำ กันบัญชีถูกล็อก)"
                                  + ("" if e.code == "POSTCONDITION_FAILED" else " · " + e.message), "login", e.detail)
            raise
        self._restore_foreground("หลังล็อกอิน")        # ProMaxx ดึง foreground ตอนเมนูหลักขึ้น (เจอจริง) — อาจตรงกับจังหวะที่เงื่อนไขรอเป็นจริงพอดี จึงตรวจอีกครั้งที่นี่
        self._msg_login = False             # ล็อกอินสำเร็จแล้ว — เลิกเฝ้าซ่อน (_hide_main ตรวจต่อให้) · ขั้นถัดไปไม่มีเมาส์/คีย์อยู่แล้ว
        return False

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
        attach = False
        if only_step and only_step != "launch":
            if not running:
                raise HelperError("NOT_RUNNING", "--step %s ต้องเปิด ssmaxx.exe ไว้ที่หน้าที่ถูกต้องก่อน" % only_step, "preflight")
        elif running:
            if st.attach_existing and not only_step and not self.opts.dry_run:
                attach = True          # ตัดสินว่าใช้ต่อได้ไหมหลังด่านบอทอื่น (ด้านล่าง)
            else:
                raise HelperError("ALREADY_RUNNING", "ProMaxx เปิดอยู่แล้ว — ปิด ssmaxx.exe ก่อนแล้วกดใหม่", "preflight")
        others = self.adapter.running_names(st.block_procs)
        if others:
            raise HelperError("OTHER_BOT_RUNNING", "มีบอทอื่นกำลังใช้ ProMaxx (%s) — รอให้จบก่อน" % ", ".join(others), "preflight")
        if attach:
            if reveal_stray(self.adapter, st):
                self.log("[preflight] แสดงหน้าต่าง ProMaxx ที่ถูกซ่อนค้างกลับมา")
            self.resume_from = self._classify_session()
            self.log("[preflight] ใช้ ProMaxx ที่เปิดค้างอยู่ต่อ (%s)" % ("ค้างที่หน้า Login — จะล็อกอินต่อ" if self.resume_from == "login" else "ล็อกอินแล้ว ไม่มีฟอร์มค้าง — ข้ามเปิดโปรแกรมและล็อกอิน"))

    def _classify_session(self):
        """ProMaxx เปิดค้างอยู่ — ใช้ต่อได้ไหม (อ่านอย่างเดียว) → "login" (ค้างที่หน้า Login) | "ready" (ล็อกอินแล้ว ไม่มีอะไรค้าง)
        ไม่ปลอดภัย/ไม่ชัดเจน = SESSION_NOT_READY (ไม่แตะอะไร): มีหน้าต่างอื่น/กล่องข้อความ · หน้าต่างหลักถูกล็อก · มีแท็บฟอร์ม (MDI_TAB) หรือฟอร์มเอกสารเปิดอยู่ ·
        ยังไม่เห็นทั้งหน้า Login และเมนู (กำลังเปิด) · อ่าน UIA ไม่ได้ — ห้ามเปลี่ยนหน้า/ปิดฟอร์มของพนักงานเอง"""
        step = "preflight"
        self._restore_minimized(step)
        dlgs = self.adapter.dialogs(self._pids())
        tops = self._tops()
        mains = [w for w in tops if _match_win(w, _MAIN)]
        others = [w for w in tops if not _match_win(w, _MAIN)]
        if dlgs or others:
            self.log("[preflight] ใช้ ProMaxx ที่เปิดอยู่ไม่ได้: มีหน้าต่าง/กล่องอื่น — %s" % "; ".join(
                [("กล่อง %s" % d[0]) for d in dlgs] + [("%s %s" % (w.cls[:18], w.text)) for w in others])[:200])
            raise HelperError("SESSION_NOT_READY", NOT_READY_WINDOW, step)
        if len(mains) != 1:
            self.log("[preflight] ใช้ ProMaxx ที่เปิดอยู่ไม่ได้: พบหน้าต่างหลัก %d อัน" % len(mains))
            raise HelperError("SESSION_NOT_READY", NOT_READY_WAIT, step)
        if not mains[0].enabled:
            self.log("[preflight] ใช้ ProMaxx ที่เปิดอยู่ไม่ได้: หน้าต่างหลักถูกล็อก (มีกล่องโมดัล)")
            raise HelperError("SESSION_NOT_READY", NOT_READY_WINDOW, step)
        top = mains[0]
        try:
            if self._cond({"uia": _LOGIN_PANEL}, step):
                # ช่องชื่อผู้ใช้ที่ไม่ได้โฟกัสแสดงข้อความที่พิมพ์ไว้เป็นชื่อของ cf_empid:1 (ตรวจจริง 5 พ.ย. 2026) · มีข้อความค้างอยู่ = รอบก่อนหยุดกลางทาง/พนักงานพิมพ์ค้างไว้
                # → พิมพ์ชื่อผู้ใช้ต่อท้ายจะได้ชื่อผิดแล้วล็อกอินพลาด (นับเป็นการล็อกอินผิด 1 ครั้ง) ⇒ ปฏิเสธ ไม่แตะอะไร
                _, shown, _ = self._uia_matches(top, _USER_SHOWN, step)
                stale = [e for e in shown if (e.name or "").strip()]
                if stale:
                    self.log("[preflight] ใช้ ProMaxx ที่ค้างหน้า Login ไม่ได้: ช่องชื่อผู้ใช้มีข้อความค้างอยู่ (%d ตัวอักษร)" % len(stale[0].name))
                    raise HelperError("SESSION_NOT_READY", NOT_READY_LOGIN, step)
                return "login"
            # ตรวจฟอร์มค้าง "ก่อน" ดูเมนู: เมื่อเปิดฟอร์มแล้วรายการเมนูซ้ายถูกเลื่อนออกนอกกรอบ (ตรวจจริง 4 พ.ย. 2026) จึงไม่ใช้ "เห็นเมนู" เป็นตัวบอกว่าว่าง
            for what, sel in (("แท็บฟอร์ม", _OPEN_TABS), ("ปุ่มนำเข้าของฟอร์ม", _ANY_IMPORT_BTN), ("หัวฟอร์มเอกสาร", _ANY_TYPE_FIELD)):
                ident, _, _ = self._uia_matches(top, sel, step)
                if ident:
                    self.log("[preflight] ใช้ ProMaxx ที่เปิดอยู่ไม่ได้: มีฟอร์มเปิดค้าง (พบ%s %d รายการ) — ไม่แตะงานที่ค้างอยู่" % (what, len(ident)))
                    raise HelperError("SESSION_NOT_READY", NOT_READY_FORM, step)
            if not self._cond({"uia": _MAIN_MENU_ANY}, step):
                self.log("[preflight] ใช้ ProMaxx ที่เปิดอยู่ไม่ได้: ยังไม่เห็นทั้งหน้า Login และเมนูหลัก")
                raise HelperError("SESSION_NOT_READY", NOT_READY_WAIT, step)
        except HelperError as e:
            if e.code == "UIA_ERROR":
                self.log("[preflight] ใช้ ProMaxx ที่เปิดอยู่ไม่ได้: อ่านโครงหน้าต่างไม่ได้ (%s)" % e.message[:100])
                raise HelperError("SESSION_NOT_READY", NOT_READY_WAIT, step)
            raise
        return "ready"

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
            if self._msg_login:
                self._wait_launch_hidden(spec, vanished)
            else:
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
        if self._hidden and not self._hidden_capable(spec):
            self._reveal("ขั้น %s ต้องใช้เมาส์จริง" % name)      # ถูกต้องก่อน ซ่อนทีหลัง: แสดงหน้าต่างกลับแล้วใช้เส้นทางเดิม (เมาส์จริง) ที่เหลือของงาน
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
        if name in (IMPORT_STEP, "import-click"):
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
            elif name == "select-file":
                self._step_select_file(spec)
            elif name == "verify-table":
                self._step_verify_table(spec)
            elif name == "confirm":
                self._step_confirm(spec)
            elif name == "login" and self._msg_login:
                skipped = bool(self._step_login_message(spec))
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
            self._reveal_quietly()          # หน้าต่างที่ซ่อนไว้ต้องกลับมาเสมอ แม้เกิดข้อผิดพลาดที่ไม่คาดคิด
            self._log_uia_stats()

    def _run(self, doc_type, only_step=None):
        t0 = self.clock()
        self.doc_type = doc_type
        info = DOC_TYPES[doc_type]
        self.tokens = dict(info)         # letter · menu_th · menu_cls · form_cls · code · type_name (ทุกคีย์ใน DOC_TYPES แทนเข้า spec ได้)
        self.tokens["type_row"] = "%s %s" % (info["code"], info["type_name"])   # ชื่อแถวในหน้าต่างรายการ (มีช่องว่าง → ใช้เป็นโทเคนดิบ {=type_row} เท่านั้น)
        try:
            self._remember_foreground(only_step)
            self._preflight(only_step)
            self._decide_login_mode(only_step)
            names = (only_step,) if only_step else STEP_ORDER
            if not only_step and self.resume_from:
                skip = ("launch",) if self.resume_from == "login" else ("launch", "login")
                names = tuple(n for n in names if n not in skip)
            for n in names:
                if not only_step and n not in ("launch", "login"):
                    self._hide_main(n)          # ครั้งเดียว: หลังล็อกอิน (หรือก่อนขั้นแรกเมื่อใช้เซสชันที่ล็อกอินค้างอยู่)
                self.run_step(n)
            hid = self._was_hidden
            self._reveal("พร้อมให้เลือกไฟล์", focus_dialog=True)
            body = {"ok": True, "proto": PROTO, "version": VERSION, "type": doc_type, "dryRun": self.opts.dry_run,
                    "reached": names[-1], "elapsedMs": int((self.clock() - t0) * 1000), "steps": self.steps}
            if self.resume_from:
                body["attached"] = self.resume_from
            if hid:
                body["hidden"] = True
            return 200, body
        except HelperError as e:
            return self._fail(e)

    def _fail(self, e):
        self.log("✗ [%s] %s: %s" % (e.step or "?", e.code, e.message))
        self._reveal_quietly()              # ก่อนเก็บหลักฐาน: ภาพหน้าจอ/dump ต้องเห็นหน้าต่าง ProMaxx
        if e.code not in ("BUSY", "UNVERIFIED", "NOT_CONFIGURED", "ALREADY_RUNNING", "SESSION_NOT_READY", "OTHER_BOT_RUNNING", "NOT_RUNNING",
                          "UNSUPPORTED_DPI", "NO_DESKTOP", "TICKET_INVALID", "TICKET_EXPIRED", "STATE_CHANGED", "FILE_INVALID",
                          "BRANCH_NOT_SUPPORTED") and not self.opts.dry_run:
            self._evidence(e)
        return e.http, error_body(e, self.log, self.steps)

    # ── นำเข้าอัตโนมัติ (รุ่น .6 · เฉพาะสาขายา) ───────────────────
    def _setup_tokens(self, doc_type, branch=None, doc_no=None):
        info = DOC_TYPES[doc_type]
        self.doc_type = doc_type
        self.tokens = dict(info)
        self.tokens["type_row"] = "%s %s" % (info["code"], info["type_name"])
        if branch:
            self.tokens["branch_name"] = BRANCH_FORM_NAMES[branch]
        if doc_no:
            self.tokens["doc_no"] = doc_no

    def run_prepare(self, doc_type, branch):
        """จังหวะ 1: เปิด/ใช้ ProMaxx → ตั้งประเภท/คลัง → ตรวจสาขา → อ่านเลขที่เอกสาร แล้วหยุด (ไม่กดปุ่มนำเข้า) · คืน (status, body) — body มี docNo"""
        try:
            return self._run_prepare(doc_type, branch)
        finally:
            self._reveal_quietly()
            self._log_uia_stats()

    def _run_prepare(self, doc_type, branch):
        t0 = self.clock()
        try:
            if branch not in BRANCH_FORM_NAMES:
                raise HelperError("BRANCH_NOT_SUPPORTED", "สาขา %s ไม่รองรับการนำเข้าอัตโนมัติ" % branch, "preflight")
            self._setup_tokens(doc_type, branch)
            self._remember_foreground(None)
            self._preflight(None)
            self._decide_login_mode(None)
            names = STEP_ORDER_PREPARE
            if self.resume_from:
                skip = ("launch",) if self.resume_from == "login" else ("launch", "login")
                names = tuple(n for n in names if n not in skip)
            for n in names:
                if n not in ("launch", "login"):
                    self._hide_main(n)
                self.run_step(n)
            try:
                doc_no = safe_doc_no(self.captured.get("doc_no", ""))
            except HelperError:
                raise HelperError("STEP_FAILED", "เลขที่เอกสารที่อ่านได้รูปแบบไม่ถูกต้อง", "form-ready")
            if not doc_no.startswith(DOC_TYPES[doc_type]["code"]):
                raise HelperError("STEP_FAILED", "เลขที่เอกสารไม่ขึ้นต้นด้วยรหัสประเภท", "form-ready")
            hid = self._was_hidden
            if self._hidden:
                self._reveal_back("ส่งเลขที่ให้เว็บ")
            else:
                self._send_main_back("ส่งเลขที่ให้เว็บ")
            self._restore_foreground("ส่งเลขที่ให้เว็บ")        # ProMaxx แย่ง foreground ไประหว่างทาง (เช่นขั้นที่ต้องใช้เมาส์จริง) → คืนให้เบราว์เซอร์ของพนักงาน
            body = {"ok": True, "proto": PROTO, "version": VERSION, "stage": "prepared", "type": doc_type, "branch": branch, "docNo": doc_no,
                    "elapsedMs": int((self.clock() - t0) * 1000), "steps": self.steps}
            if self.resume_from:
                body["attached"] = self.resume_from
            if hid:
                body["hidden"] = True
            return 200, body
        except HelperError as e:
            return self._fail(e)

    def _preflight_import(self, ticket):
        """จังหวะ 2: ProMaxx ต้องยังเป็นโปรเซสเดิมที่เตรียมไว้ในจังหวะ 1 และไม่มีกล่อง/หน้าต่างอื่นค้าง — ไม่แตะอะไรถ้าไม่ผ่าน"""
        step = "preflight"
        if not (LOCATORS_VERIFIED or self.opts.force_unverified):
            raise HelperError("UNVERIFIED", "ตัวช่วยยังไม่ผ่านการตรวจหน้าต่างจริง — ปิดการคลิกไว้", step)
        if not self.adapter.session_ok():
            raise HelperError("NO_DESKTOP", "ไม่มีหน้าจอให้คลิก (ล็อกจออยู่/ไม่ใช่ session ผู้ใช้)", step)
        dpi = self.adapter.dpi_percent()
        if dpi not in (None, 100) and not self.opts.force_dpi:
            raise HelperError("UNSUPPORTED_DPI", "Display Scaling ต้องเป็น 100%% (ตอนนี้ %s%%)" % dpi, step)
        pids = set(self._pids())
        if not pids or not set(ticket["pids"]) <= pids:
            raise HelperError("STATE_CHANGED", "ProMaxx ถูกปิดหรือเปิดใหม่หลังอ่านเลขที่ — เริ่มใหม่", step)
        others = self.adapter.running_names(self.settings.block_procs)
        if others:
            raise HelperError("OTHER_BOT_RUNNING", "มีบอทอื่นกำลังใช้ ProMaxx (%s) — รอให้จบก่อน" % ", ".join(others), step)
        if reveal_stray(self.adapter, self.settings):
            self.log("[preflight] แสดงหน้าต่าง ProMaxx ที่ถูกซ่อนค้างกลับมา")
        self._restore_minimized(step)
        dlgs = self.adapter.dialogs(self._pids())
        tops = self._tops()
        mains = [w for w in tops if _match_win(w, _MAIN)]
        others_w = [w for w in tops if not _match_win(w, _MAIN)]
        if dlgs or others_w:
            self.log("[preflight] ไม่นำเข้า: มีหน้าต่าง/กล่องอื่นค้าง — %s" % "; ".join(
                [("กล่อง %s" % d[0]) for d in dlgs] + [("%s %s" % (w.cls[:18], w.text)) for w in others_w])[:200])
            raise HelperError("SESSION_NOT_READY", NOT_READY_WINDOW, step)
        if len(mains) != 1 or not mains[0].enabled:
            raise HelperError("STATE_CHANGED", NOT_READY_WAIT, step)

    def _step_select_file(self, spec):
        """กล่อง Select File (หน้าต่างเลือกไฟล์มาตรฐานของ Windows · ตรวจจริง 4 พ.ย. 2026): ช่อง File name = ComboBoxEx32 id 1148 → Edit · ปุ่ม Open = Button id 1 ·
        ตัวกรองไฟล์ = ComboBox id 1136 (*.txt) — ใส่พาธเต็มด้วย WM_SETTEXT → อ่านกลับด้วย WM_GETTEXT ต้องตรงทุกตัวอักษร → BM_CLICK ปุ่ม Open (ไม่ใช้เมาส์/คีย์)
        ไม่ตรงข้อใด = หยุดโดยยังไม่กด Open (กล่องค้างไว้ให้พนักงานทำต่อเอง)"""
        step = "select-file"
        allow = spec.get("allow_dialogs")
        self._wait_cond(spec.get("pre"), 10, step, "PRECONDITION_FAILED", "ยังไม่เห็นกล่อง Select File", allow)
        dlg = self._one_top(_FILE_DIALOG, "Select File", step)
        kids = self.adapter.child_windows(dlg.hwnd)

        def pick(cls, cid, visible=True):
            return [c for c in kids if (c.cls or "").lower() == cls and c.ctrl_id == cid and (c.visible or not visible)]
        combos, edits, opens, types = pick("comboboxex32", 1148), pick("edit", 1148), pick("button", 1), pick("combobox", 1136)
        for label, found in (("ช่อง File name", edits), ("ปุ่ม Open", opens)):
            if not found:
                raise HelperError("LOCATOR_NOT_FOUND", "ไม่พบ%s ในกล่อง Select File — ไม่ใส่ชื่อไฟล์" % label, step)
            if len(found) > 1:
                raise HelperError("LOCATOR_NOT_UNIQUE", "พบ%s %d รายการ — ไม่ใส่ชื่อไฟล์" % (label, len(found)), step)
        if len(combos) != 1 or not types:
            raise HelperError("LOCATOR_NOT_FOUND", "โครงสร้างกล่อง Select File ไม่ตรงที่ตรวจไว้ — ไม่ใส่ชื่อไฟล์", step)
        if not edits[0].enabled or not opens[0].enabled:
            raise HelperError("LOCATOR_NOT_FOUND", "ช่อง File name/ปุ่ม Open ใช้งานไม่ได้ (disabled)", step)
        path = self._import_path
        self._guard_no_input(step)
        self._guard_dialogs(step, allow)
        self.adapter.set_text(edits[0].hwnd, path)
        got = self.adapter.get_text(edits[0].hwnd)
        if got != path:
            raise HelperError("STEP_FAILED", "ใส่ชื่อไฟล์ลงกล่อง Select File ไม่สำเร็จ (อ่านกลับไม่ตรง) — ไม่กด Open", step)
        self.log("[select-file] ใส่ชื่อไฟล์แล้ว (%s · %d แถว) — กด Open" % (os.path.basename(path), len(self._import_rows)))
        self.adapter.click_button(opens[0].hwnd)
        self.sleep(self.SETTLE)
        self._wait_cond(spec.get("post"), float(spec.get("post_timeout", 15)), step, "POSTCONDITION_FAILED",
                        "กด Open แล้วกล่อง Select File ไม่ปิด", allow)

    def _step_verify_table(self, spec):
        """เทียบตารางรายละเอียดสินค้าใน ProMaxx กับไฟล์ (SKU + จำนวน + ยอดรวม) — อ่านผ่าน UIA dump ครั้งเดียว · ไม่ตรง = TABLE_MISMATCH ไม่กด ตกลง"""
        step = "verify-table"
        problems, table = [], {"rows": {}}
        for attempt in (1, 2):
            top = self._one_top(_MAIN, "หน้าต่างหลัก", step)
            if not top.enabled:
                raise HelperError("UNEXPECTED_DIALOG", "หน้าต่างหลักของ ProMaxx ถูกล็อก (มีกล่องค้าง) — ไม่ตรวจตาราง/ไม่กด ตกลง", step)
            self._guard_dialogs(step)
            self._guard_extra_windows(step)         # ก่อนอ่านตาราง (อ่านนาน ~8 วินาที — ไม่เสียเวลาเปล่าถ้ามีป๊อปอัพรออยู่แล้ว)
            try:
                lines = self.adapter.uia_dump(top.hwnd, max_nodes=VERIFY_MAX_NODES)
            except Exception as e:      # noqa: BLE001
                raise HelperError("UIA_ERROR", "อ่านตารางใน ProMaxx (UIA) ไม่ได้: %s %s" % (type(e).__name__, self._scrub(str(e))[:140]), step)
            table = parse_detail_dump(lines)
            problems = compare_table(self._import_rows, table)
            if not problems:
                self._guard_extra_windows(step)     # ป๊อปอัพอาจขึ้นระหว่างอ่าน — ตารางที่ตรงแต่มีหน้าต่างค้างไม่ถือว่าพร้อม (ไม่ประกาศว่าตรง/ไม่ไปขั้น ตกลง)
                self.log("[verify-table] ตารางตรงไฟล์ครบ %d แถว (SKU + จำนวน · ยอดรวม %s)" % (len(self._import_rows), table["total_qty"]))
                return
            if attempt == 1 and len(table["rows"]) < len(self._import_rows):
                self.log("[verify-table] ตารางยังโหลดไม่ครบ (%d/%d) — รอแล้วอ่านใหม่" % (len(table["rows"]), len(self._import_rows)))
                self.sleep(2.0)
                continue
            break
        self._guard_extra_windows(step)             # ไม่ตรง: ถ้ามีหน้าต่างค้าง นั่นคือสาเหตุจริง (เช่น ป๊อปอัพ Lot No. — แถวยังไม่ถูกเพิ่ม) ไม่ใช่ตารางผิด
        raise HelperError("TABLE_MISMATCH", "ตารางใน ProMaxx ไม่ตรงไฟล์: " + "; ".join(problems[:3]) + " — ไม่กด ตกลง", step,
                          detail={"problems": problems})

    def _observe_after_confirm(self, doc_no):
        """หลังกด ตกลง: สังเกตผล (อ่านอย่างเดียว) — บันทึกเลขที่เอกสารตอนนี้ · ตารางว่างไหม · กล่องข้อความที่ขึ้น
        saved = เลขที่เอกสารเปลี่ยนไปจากเดิม หรือตารางถูกล้าง (ฟอร์มถูกรีเซ็ตเป็นใบใหม่) — ⚠️ ยังไม่เคยกด ตกลง จริง จึงยังไม่รู้ว่า ProMaxx ทำอะไร:
        ถ้าผลจริงต่างจากนี้ ตัวช่วยคืน CONFIRM_UNKNOWN (ไม่ใช่ 'สำเร็จ') แล้วดึง ProMaxx ขึ้นหน้าให้พนักงานตรวจ"""
        step = "confirm"
        info = {"saved": False, "docNo": None, "tableEmpty": None, "dialogs": []}
        no_sel = {"within": _MAIN, "id": "TRANNO:1", "type": "Custom", "ancestor": _FORM}
        row_sel = {"within": _MAIN, "id": "CF_ITEMID:1", "type": "Custom", "ancestor": _FORM}
        deadline = self.clock() + CONFIRM_OBSERVE_SEC
        while True:
            for title, texts in self.adapter.dialogs(self._pids()):
                d = self._dialog_text(title, texts)
                if d not in info["dialogs"]:
                    info["dialogs"].append(d)
            try:
                top = self._one_top(_MAIN, "หน้าต่างหลัก", step)
                _, vis, _ = self._uia_matches(top, _fmt(no_sel, self.tokens), step)
                names = [e.name for e in vis if (e.name or "").strip()]
                info["docNo"] = names[0] if len(names) == 1 else (None if not names else "(พบ %d ตัว)" % len(names))
                _, vis2, _ = self._uia_matches(top, _fmt(row_sel, self.tokens), step)
                info["tableEmpty"] = not any((e.name or "").strip() for e in vis2)
            except HelperError as e:
                if e.code not in ("UIA_ERROR", "LOCATOR_NOT_FOUND", "LOCATOR_NOT_UNIQUE"):
                    raise
            if (info["docNo"] and info["docNo"] != doc_no and not str(info["docNo"]).startswith("(")) or info["tableEmpty"] is True:
                info["saved"] = True
                return info
            if self.clock() >= deadline:
                return info
            self.sleep(1.5)

    def _step_confirm(self, spec):
        """กด "ตกลง" (cb_ok) ครั้งเดียว — เมื่อ PROMAXX_AUTO_CONFIRM เปิดและ verify-table ผ่านแล้วเท่านั้น (run_import เรียกตามลำดับ) · หลังกดห้ามมี input อีก"""
        step = "confirm"
        allow = spec.get("allow_dialogs")
        self._wait_cond(spec.get("pre"), float(spec.get("pre_timeout", 8)), step, "PRECONDITION_FAILED",
                        spec.get("pre_what") or "ฟอร์มเปลี่ยนไปจากตอนอ่านเลขที่ — ไม่กด ตกลง", allow)
        self._guard_extra_windows(step)      # ด่านสุดท้ายก่อนการกระทำที่ย้อนไม่ได้: UIA สั่งปุ่มของหน้าต่างหลักได้แม้มีป๊อปอัพ (เช่น Lot No.) เปิดอยู่ — มีหน้าต่างค้าง = ไม่กด ตกลง
        for a in spec["actions"]:
            self._act(a, step, allow)
        self._locked = True
        self.log("[confirm] กด ตกลง แล้ว — สังเกตผลไม่เกิน %d วินาที (ห้ามส่ง input เพิ่ม)" % CONFIRM_OBSERVE_SEC)
        self.confirm_after = self._observe_after_confirm(self.tokens.get("doc_no", ""))
        self.log("[confirm] ผลที่เห็น: %s" % json.dumps(self.confirm_after, ensure_ascii=False))
        if not self.confirm_after.get("saved"):
            raise HelperError("CONFIRM_UNKNOWN", "กดตกลงแล้ว แต่ยืนยันผลไม่ได้ — ตรวจใน ProMaxx ก่อนทำซ้ำ", step, detail=self.confirm_after)

    def run_import(self, ticket, rows, path):
        """จังหวะ 2: ตัวช่วยกดปุ่มนำเข้า → ใส่ชื่อไฟล์ + Open → เทียบตาราง → (ถ้าเปิด PROMAXX_AUTO_CONFIRM) กด ตกลง · คืน (status, body)"""
        try:
            return self._run_import(ticket, rows, path)
        finally:
            self._reveal_quietly()
            self._log_uia_stats()

    def _run_import(self, ticket, rows, path):
        t0 = self.clock()
        doc_type, branch, doc_no = ticket["type"], ticket["branch"], ticket["doc_no"]
        try:
            self._setup_tokens(doc_type, branch, doc_no)
            self._input_steps_after_import = POST_IMPORT_INPUT_STEPS
            self._import_path, self._import_rows = path, rows
            self._preflight_import(ticket)
            names = ("import-click", "select-file", "verify-table") + (("confirm",) if self.settings.auto_confirm else ())
            for n in names:
                if n == "import-click":
                    self._hide_main(n)
                self.run_step(n)
            confirmed = bool(self.settings.auto_confirm)
            hid = self._was_hidden
            if confirmed:
                if self._hidden:
                    self._reveal_back("นำเข้าและกด ตกลง แล้ว")
                else:
                    self._send_main_back("นำเข้าและกด ตกลง แล้ว")
            else:
                self._bring_main_front("ตัวช่วยหยุดก่อน ตกลง — พนักงานตรวจตารางแล้วกด ตกลง เอง")
            body = {"ok": True, "proto": PROTO, "version": VERSION, "stage": "imported", "type": doc_type, "branch": branch, "docNo": doc_no,
                    "rows": len(rows), "file": os.path.basename(path), "confirmed": confirmed,
                    "elapsedMs": int((self.clock() - t0) * 1000), "steps": self.steps}
            if hid:
                body["hidden"] = True
            if self.confirm_after:
                body["after"] = self.confirm_after
            return 200, body
        except HelperError as e:
            return self._fail(e)


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


def reveal_stray(adapter, settings):
    """แสดงหน้าต่างหลักของ ProMaxx ที่ถูกซ่อนค้าง (ตัวช่วยเดิมถูกปิดกลางงานตอนซ่อนอยู่) → จำนวนที่แสดงกลับ · ไม่โยนข้อผิดพลาด"""
    fn = getattr(adapter, "reveal_hidden", None)
    if not fn:
        return 0
    try:
        return int(fn(adapter.pids(settings.proc_name)) or 0)
    except Exception:      # noqa: BLE001
        return 0


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
        self._tlock = threading.Lock()       # ป้องกันตั๋วนำเข้าอัตโนมัติ (อ่าน/เขียนจากหลายเธรด HTTP)
        self.ticket = None                   # {"id","type","branch","doc_no","pids","expires"} — มีใบเดียว · ใช้ครั้งเดียว · หมดอายุ TICKET_TTL

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

    # ── นำเข้าอัตโนมัติ (รุ่น .6) ─────────────────────────────────
    def _now(self):
        return (self.clock or time.monotonic)()

    def _clear_ticket(self, only_id=None):
        with self._tlock:
            if self.ticket and (only_id is None or secrets.compare_digest(str(only_id), self.ticket["id"])):
                self.ticket = None
                return True
        return False

    def _acquire_job(self):
        """single-flight + mutex ข้ามโปรเซส → (ok, error_response) · ok=True ผู้เรียกต้องเรียก _release_job()"""
        if not self._lock.acquire(blocking=False):
            return False, (409, error_body(HelperError("BUSY", "ตัวช่วยกำลังทำงานอยู่ — รอสักครู่", "preflight"), self.log))
        if not self.adapter.acquire_mutex(JOB_MUTEX):
            self._lock.release()
            return False, (409, error_body(HelperError("BUSY", "มีอีกโปรเซสของตัวช่วยกำลังขับ ProMaxx — รอสักครู่", "preflight"), self.log))
        self.busy = True
        return True, None

    def _release_job(self):
        self.busy = False
        self.adapter.release_mutex(JOB_MUTEX)
        self._lock.release()

    def run_prepare_job(self, doc_type, branch):
        """จังหวะ 1 (HTTP /v1/prepare-import): ได้ docNo + ticket · ทุกครั้งที่เริ่มใหม่ ตั๋วเก่าถูกยกเลิก"""
        if branch not in BRANCH_FORM_NAMES:
            return 422, error_body(HelperError("BRANCH_NOT_SUPPORTED", "สาขา %s ไม่รองรับการนำเข้าอัตโนมัติ" % branch, "preflight"), self.log)
        ok, err = self._acquire_job()
        if not ok:
            return err
        try:
            self._clear_ticket()
            runner = Runner(self.adapter, self.settings, self.log, specs=self.specs, opts=JobOpts(), clock=self.clock, sleep=self.sleep)
            status, body = runner.run_prepare(doc_type, branch)
            if status == 200:
                t = {"id": secrets.token_urlsafe(24), "type": doc_type, "branch": branch, "doc_no": body["docNo"],
                     "pids": frozenset(runner._pids()), "expires": self._now() + TICKET_TTL}
                with self._tlock:
                    self.ticket = t
                body["ticket"] = t["id"]
                body["expiresInSec"] = TICKET_TTL
                body["autoConfirm"] = bool(self.settings.auto_confirm)      # หน้าเว็บใช้บอกพนักงานก่อนกดยืนยันว่า "ตกลง" จะถูกกดให้หรือไม่
            return status, body
        except Exception as e:      # noqa: BLE001
            self.log("ข้อผิดพลาดที่ไม่คาดคิด: %s" % type(e).__name__)
            return 500, error_body(HelperError("INTERNAL", "ตัวช่วยผิดพลาดภายใน (%s) — ดู log" % type(e).__name__), self.log)
        finally:
            self._release_job()

    def run_import_job(self, req):
        """จังหวะ 2 (HTTP /v1/run-import): ตรวจทุกอย่างที่ไม่ต้องแตะ ProMaxx ก่อน (ตั๋ว · hash · รูปแบบไฟล์) — ผิดข้อใดไม่แตะ ProMaxx และ "ไม่ใช้ตั๋วทิ้ง" ·
        ผ่านแล้วตั๋วถูกใช้ครั้งเดียว (ล้มกลางทางต้องเริ่มจังหวะ 1 ใหม่)"""
        with self._tlock:
            t = self.ticket
        if not t or not secrets.compare_digest(str(req["ticket"]), t["id"]):
            return 409, error_body(HelperError("TICKET_INVALID", "ตั๋วไม่ถูกต้องหรือถูกใช้ไปแล้ว — กดใหม่", "preflight"), self.log)
        if self._now() > t["expires"]:
            self._clear_ticket(t["id"])
            return 409, error_body(HelperError("TICKET_EXPIRED", "ตั๋วหมดอายุ — กดใหม่", "preflight"), self.log)
        try:
            doc_no = safe_doc_no(req["docNo"])
        except HelperError as e:
            return 400, error_body(e, self.log)
        if req["type"] != t["type"] or req["branch"] != t["branch"] or doc_no != t["doc_no"]:
            return 409, error_body(HelperError("TICKET_INVALID", "ตั๋วไม่ตรงกับคำขอ (ชนิด/สาขา/เลขที่) — กดใหม่", "preflight"), self.log)
        try:
            text = req["text"]
            rows = parse_import_text(text)
            if len(rows) != req["rows"]:
                raise HelperError("FILE_INVALID", "จำนวนแถวไม่ตรงที่แจ้ง (%d ≠ %s)" % (len(rows), req["rows"]), "preflight")
            if import_file_sha256(text) != str(req["sha256"]).lower():
                raise HelperError("FILE_INVALID", "hash ของไฟล์ไม่ตรง — ข้อมูลเสียหายระหว่างส่ง", "preflight")
        except HelperError as e:
            return e.http, error_body(e, self.log)
        ok, err = self._acquire_job()
        if not ok:
            return err
        try:
            with self._tlock:
                if self.ticket is not t:
                    return 409, error_body(HelperError("TICKET_INVALID", "ตั๋วถูกแทนที่แล้ว — กดใหม่", "preflight"), self.log)
                self.ticket = None                 # ใช้ครั้งเดียว: นับจากตรงนี้
            try:
                path = write_import_file(self.settings.import_dir, t["type"], t["doc_no"], text)
            except HelperError as e:
                return e.http, error_body(e, self.log)
            prune_import_dir(self.settings.import_dir)
            self.log("[run-import] เขียนไฟล์นำเข้า %s (%d แถว · sha256 %s…)" % (os.path.basename(path), len(rows), import_file_sha256(text)[:8]))
            runner = Runner(self.adapter, self.settings, self.log, specs=self.specs, opts=JobOpts(), clock=self.clock, sleep=self.sleep)
            return runner.run_import(t, rows, path)
        except Exception as e:      # noqa: BLE001
            self.log("ข้อผิดพลาดที่ไม่คาดคิด: %s" % type(e).__name__)
            return 500, error_body(HelperError("INTERNAL", "ตัวช่วยผิดพลาดภายใน (%s) — ดู log" % type(e).__name__), self.log)
        finally:
            self._release_job()

    def cancel_import(self, req):
        """ยกเลิกตั๋ว (ไม่แตะ ProMaxx — ฟอร์มที่เปิดค้างอยู่ พนักงานปิดเอง) · ตั๋วคนละใบ = ไม่ล้าง (กันยกเลิกงานใหม่ของอีกเครื่อง)"""
        return 200, {"ok": True, "proto": PROTO, "version": VERSION, "stage": "cancelled", "cleared": self._clear_ticket(req["ticket"])}

    def health(self):
        return {"ok": True, "proto": PROTO, "version": VERSION, "ssmaxxRunning": bool(self.adapter.pids(self.settings.proc_name)),
                "busy": self.busy, "locatorsVerified": LOCATORS_VERIFIED,
                "autoImport": True, "autoConfirm": bool(self.settings.auto_confirm), "loginMode": self.settings.login_mode, "branches": list(BRANCH_FORM_NAMES),
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
        if route not in ("/v1/health",) + tuple(REQUEST_SCHEMAS):
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
        limit = MAX_IMPORT_BODY if route == "/v1/run-import" else MAX_BODY
        n = declared_length if declared_length is not None else len(body)
        if n > limit or len(body) > limit:
            raise HelperError("PAYLOAD_TOO_LARGE", "body ใหญ่เกิน %d ไบต์" % limit)
        if n <= 0 or not body:
            raise HelperError("BAD_REQUEST", "body ว่าง")
        try:
            req = json.loads(body.decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            raise HelperError("BAD_REQUEST", "body ต้องเป็น JSON")
        if not isinstance(req, dict):
            raise HelperError("BAD_REQUEST", "body ต้องเป็น JSON object")
        schema = REQUEST_SCHEMAS[route]
        extra = sorted(set(req) - set(schema))
        if extra:
            raise HelperError("BAD_REQUEST", "มี field ที่ตัวช่วยรุ่นนี้ไม่รู้จัก: %s (อัปเดต PromaxxHelper?)" % ", ".join(extra))
        if req.get("proto") != PROTO:
            raise HelperError("PROTO_MISMATCH", "proto ไม่ตรง (ตัวช่วยรุ่นนี้ใช้ %d)" % PROTO)
        if route != "/v1/cancel-import" and req.get("type") not in DOC_TYPES:
            raise HelperError("BAD_REQUEST", "type ต้องเป็น ORDS หรือ IRPS")
        if route == "/v1/open-import":
            status, obj = self.run_job(req["type"])
            return status, obj, False
        missing = [k for k in schema if k not in req]
        if missing:
            raise HelperError("BAD_REQUEST", "ขาด field: %s" % ", ".join(missing))
        if route == "/v1/cancel-import":
            _need_str(req, "ticket", 80)
            status, obj = self.cancel_import(req)
            return status, obj, False
        branch = _need_str(req, "branch", 4)
        if not re.match(r"^[A-Za-z]{2,4}$", branch):
            raise HelperError("BAD_REQUEST", "branch ไม่ถูกต้อง")
        if branch not in BRANCH_FORM_NAMES:
            raise HelperError("BRANCH_NOT_SUPPORTED", "สาขา %s ไม่รองรับการนำเข้าอัตโนมัติ" % branch)
        if route == "/v1/prepare-import":
            status, obj = self.run_prepare_job(req["type"], branch)
            return status, obj, False
        # /v1/run-import
        _need_str(req, "ticket", 80)
        _need_str(req, "docNo", 40)
        _need_str(req, "sha256", 64)
        if not re.match(r"^[0-9a-fA-F]{64}$", req["sha256"]):
            raise HelperError("BAD_REQUEST", "sha256 ไม่ถูกต้อง")
        if not isinstance(req["rows"], int) or isinstance(req["rows"], bool) or not 1 <= req["rows"] <= IMPORT_MAX_ROWS:
            raise HelperError("BAD_REQUEST", "rows ต้องเป็นจำนวนเต็ม 1–%d" % IMPORT_MAX_ROWS)
        _need_str(req, "text", MAX_IMPORT_BODY)
        status, obj = self.run_import_job(req)
        return status, obj, False


# field ที่แต่ละเส้นทางรับ (ครบพอดี — เกิน = 400 · ขาด = 400) — เส้นทางเดิม /v1/open-import ยังรับแค่ {proto,type}
REQUEST_SCHEMAS = {
    "/v1/open-import": ("proto", "type"),
    "/v1/prepare-import": ("proto", "type", "branch"),
    "/v1/run-import": ("proto", "ticket", "type", "branch", "docNo", "rows", "sha256", "text"),
    "/v1/cancel-import": ("proto", "ticket"),
}


def _need_str(req, key, max_len):
    v = req.get(key)
    if not isinstance(v, str) or not v or len(v) > max_len:
        raise HelperError("BAD_REQUEST", "%s ไม่ถูกต้อง" % key)
    return v


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
            limit = MAX_IMPORT_BODY if self.path.split("?", 1)[0] == "/v1/run-import" else MAX_BODY
            body = self.rfile.read(length) if 0 < length <= limit else b""
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
    if code in ("BUSY", "ALREADY_RUNNING", "SESSION_NOT_READY", "OTHER_BOT_RUNNING", "NOT_RUNNING"):
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
    g.add_argument("--reveal-ssmaxx", action="store_true", help="แสดงหน้าต่าง ProMaxx ที่ถูกซ่อนค้างกลับมา (กรณีตัวช่วยถูกปิดกลางงานตอนซ่อนหน้าต่าง)")
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

    if args.reveal_ssmaxx:
        log("แสดงหน้าต่าง ProMaxx ที่ซ่อนค้างกลับมา %d หน้าต่าง" % reveal_stray(adapter, st))
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
    n_stray = reveal_stray(adapter, st)
    if n_stray:
        log("แสดงหน้าต่าง ProMaxx ที่ถูกซ่อนค้าง (จากตัวช่วยรอบก่อนที่หยุดกลางงาน) กลับมา %d หน้าต่าง" % n_stray)
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
    log("ใช้ ProMaxx ที่เปิดค้างต่อ (เมื่อไม่มีฟอร์มค้าง): %s · ซ่อนหน้าต่างหลังล็อกอิน: %s" % (
        "เปิด" if st.attach_existing else "ปิด", "เปิด" if st.hide_after_login else "ปิด"))
    log("นำเข้าอัตโนมัติ (สาขา %s): กด ตกลง เอง %s · โฟลเดอร์ไฟล์ %s" % (
        "/".join(BRANCH_FORM_NAMES), "เปิด" if st.auto_confirm else "ปิด (หยุดก่อน ตกลง)", st.import_dir))
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
