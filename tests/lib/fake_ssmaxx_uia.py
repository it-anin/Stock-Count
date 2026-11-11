# -*- coding: utf-8 -*-
"""
ตัวต่อปลอมของ ssmaxx.exe "แบบ WPF + UIA" สำหรับเทส promaxx_helper (ต่อยอด FakeUI ของ fake_ssmaxx.py)

โครงสร้างจำลองตามที่ตรวจจริงกับ ssmaxx.exe เมื่อ 3 พ.ย. 2026 (Build 10.00.10.0025 · อ่านอย่างเดียวด้วย UIA):
  - หน้าต่างหลักใบเดียวคลาส HwndWrapper[ssmaxx.exe;;GUID] ไม่มี child HWND · ข้างในเป็นต้นไม้ UIA
  - ช่องชื่อผู้ใช้/รหัสผ่านสลับชนิดตามโฟกัส: cf_empid (TextBox) ↔ cf_empid:1 (DWTextBlock) · cf_pass (PasswordBox) ↔ cf_pass:1
  - เมนูซ้าย = ListBox lbx_manumain (ListItem ไม่มี id) · ปุ่ม I/O = Button id I/O ใต้หน้าเมนูคลาส ui_mainmenu_tranin/tranout_style2
  - กดปุ่ม I/O → เปิดแท็บในหน้าต่างเดิม (ฟอร์ม pn_trans_in/out) และ "หน้าเมนูถูกเลื่อนไปนอกกรอบหน้าต่างแต่ยังรายงาน IsOffscreen=False"
  - ปุ่มนำเข้า uo_tran_bt_import เรียงติดกับ แทรก/ลบ/ยกเลิกรายการ (ห่าง 4px) · กดแล้วขึ้นกล่อง #32770 "Select File" และหน้าต่างหลักถูกล็อก

ค่าในไฟล์นี้ (ต่างจาก fake_ssmaxx.py) มาจากข้อมูลจริง — แต่ยังเป็น "แบบจำลอง": ไม่พิสูจน์ว่าการคลิก/พิมพ์จริงบน ssmaxx.exe ได้ผลตามนี้
"""
import dataclasses
import os

from fake_ssmaxx import FakeUI

MAIN_CLS = "HwndWrapper[ssmaxx.exe;;1cfdec26-319d-446c-96b1-0854e2680fe1]"
TITLE = "SeniorSoft ProMaxx"
WIN = (-8, -8, 1928, 1040)
MINI_WIN = (-32000, -32000, -31840, -31972)     # หน้าต่างที่ถูกย่อ (ตรวจจริง 4 พ.ย. 2026)
MAIN_HWND = 100
BROWSER_HWND = 900               # หน้าต่างของพนักงาน (เบราว์เซอร์) ที่เป็น foreground ก่อนเริ่มงาน — เปิดด้วย uia browser_fg
DIALOG_HWND = 300
LIST_ITEMS = ["Dashboard", "ตั้งค่า", "คลังสินค้า", "บุคคล", "เอกสารรับ", "เอกสารจ่าย", "Utility"]
SHIFT = 1900                      # หน้าเมนูถูกเลื่อนไปทางขวาเท่านี้หลังเปิดฟอร์ม
IMPORT_HELP = "นำเข้าไฟล์เอกสาร"
PICKER_HWND = 400
PICKER_CLS = "HwndWrapper[ssmaxx.exe;;d89a72ff-dc5b-4af7-a4b7-e38be0bcee7e]"
PICKER_TITLE = "sfw_winrespond"
# ป๊อปอัพ Lot No. (ui_popup_lotnoBalance) ตรวจจริง 5 พ.ย. 2026: หน้าต่างระดับบนของโปรเซสเดียวกัน ชื่อ sfw_winrespond เต็มจอ (-7,-7,1927,1087) — ไม่ใช่ #32770 · หน้าต่างหลักยัง enabled
POPUP_HWND = 600
POPUP_CLS = "HwndWrapper[ssmaxx.exe;;95e4025f-0306-4176-a350-253c0abdd5c8]"
POPUP_TITLE = "sfw_winrespond"
POPUP_RECT = (-7, -7, 1927, 1087)
# โครงที่อ่านได้จริงจากป๊อปอัพ Lot No. (ตัดเหลือส่วนที่เทสใช้) · DataWindow dw_lotno ว่าง (ไม่มียอดคงเหลือของ Lot ใด)
POPUP_LOT_LINES = [      # ลำดับโหนดตามของจริง: Window → Text "Ready" → Pane → Custom uo_popup → Pane → Custom (ui_popup_lotnoBalance) = โหนดที่ 6 · DataWindow dw_lotno อยู่ท้าย
    'Window id=w_popup_tran_main name="sfw_winrespond" cls=Window rect=(-7,-7,1927,1087) en=True off=False focus=False',
    '  Text id= name="Ready" cls=TextBlock rect=(empty) en=True off=True focus=False',
    '  Pane id=WindowSV name="" cls=ScrollViewer rect=(-7,-7,1927,1087) en=True off=False focus=False',
    '    Custom id=uo_popup name="" cls=UserObject rect=(710,340,1210,740) en=True off=False focus=True',
    '      Pane id=UOSV name="" cls=ScrollViewer rect=(710,340,1210,740) en=True off=False focus=False',
    '        Custom id=39 name="" cls=ui_popup_lotnoBalance rect=(710,340,1210,740) en=True off=False focus=False',
    '          Pane id=UOSV name="" cls=ScrollViewer rect=(710,340,1210,740) en=True off=False focus=False',
    '                    Button id=cb_ok name="" cls=Button rect=(722,349,792,377) en=True off=False focus=False',
    '                    Button id=cb_exit name="" cls=Button rect=(1135,349,1205,377) en=True off=False focus=False',
    '            Custom id=dw_lotno name="" cls=DataWindow rect=(720,385,1200,730) en=True off=False focus=False',
]
POPUP_OTHER_LINES = [
    'Window id=w_other_popup name="sfw_winrespond" cls=Window rect=(-7,-7,1927,1087) en=True off=False focus=False',
    '  Custom id=uo_popup name="" cls=ui_popup_something_else rect=(710,340,1210,740) en=True off=False focus=True',
]
# รายการในหน้าต่างเลือกตามที่ตรวจจริง (D2/D6/E1) — ORDS: 13 แถว (ไม่มีแถบเลื่อน) · IRPS: 15 แถวขึ้นไป · คลัง: 2 แถว
TYPE_ROWS = {
    "O": ["ORDS ใบปรับปรุงลดสินค้า", "ORCM ใบเสร็จรับเงิน(เงินสด)", "OCTM •••• ภาษี7%(เงินสด) ••••", "OCTC ใบเสร็จรับเงิน/ใบกำกับภาษี(เงินเชื่อ...",
          "OBNM ใบเสร็จรับเงิน(จากใบวางบิล)", "OOQ *****ใบเสนอราคา", "OORD ใบสั่งจอง", "ORNC ใบส่งสินค้า (เงินเชื่อ)", "BYUSE สินค้าใช้ภายในร้าน",
          "LOST สินค้าหมดอายุ/เสียหาย", "BYITD ใบจ่ายสินค้าภายใน", "ONL Online Order", "BKK BKK Transfer"],
    "I": ["IRBS ใบยืมสินค้าเข้า", "IRPS ใบปรับปรุงเพิ่มสินค้า", "IRNC ใบรับสินค้าเข้า(เงินเชื่อ) IRNC", "IRVC ใบรับสินค้า/ใบกำกับภาษี(เงินเชื่อ) ...",
          "IRNM ใบรับสินค้าเข้า/ใบเสร็จรับเงิน(เงิน...", "IRVM ใบรับสินค้า/ใบเสร็จรับเงิน/ใบกำกับภ...", "IRCM ใบเสร็จรับเงิน(เงินสด)", "IRCC ใบเสร็จรับเงิน(เงินเชื่อ) IRCC",
          "PV ใบสำคัญจ่าย", "IBNV ใบเสร็จรับเงิน/ใบกำกับภาษี(จากใบวาง...", "IVVS ใบกำกับภาษีซื้อ", "IPOS ใบสั่งซื้อ", "ICS ใบนับสินค้าเข้าสต็อก",
          "ICSM ใบรับสินค้าเข้า(ของแถม)", "IRDP ใบส่งคืนสินค้าฝาก"],
}
WH_ROWS = ["Warehouse", "Front Store"]
# ค่าเริ่มต้นของฟอร์มที่เปิดใหม่ (ตรวจจริง): ORDS เปิดมาเป็นประเภทไหนก็ได้ (ตอน 20:55 เป็น ORCM · ภายหลังเป็น ORDS) คลัง Front Store · IRPS เปิดมาเป็น IRPS คลัง Warehouse
DEFAULTS = {"O": ("ORCM ใบเสร็จรับเงิน(เงินสด)", "Front Store"), "I": ("IRPS ใบปรับปรุงเพิ่มสินค้า", "Warehouse")}

UFLAGS = dict(uia_fail_first=0, uia_always_fail=False, dup_login_btn=False, import_help=IMPORT_HELP, form_cls_override=None,
              top_disabled=False, focus_never=False, drift_on_move=False, start_focus_field="username", list_hidden=False,
              edit_unfocused=False,   # ช่องกรอกถูกสร้างแล้วแต่ไม่ได้รับโฟกัสแป้นพิมพ์ (เช่นหน้าต่างไม่ใช่ foreground)
              minimized=False,        # หน้าต่างหลักถูกย่ออยู่จนกว่า focus() จะกู้ — ตามที่ตรวจจริง 4 พ.ย. 2026: ทั้งหน้าต่างและทุกองค์ประกอบมีพิกัด ≈ -32000
                                      # แต่ foreground_pid ยังเป็น ProMaxx (หน้าต่างที่ถูกย่อยังนับเป็น foreground) · focus_fails=True = กู้ไม่ได้
              pass_plain=False,       # ช่อง cf_pass เป็น TextBox ธรรมดา ไม่ใช่ PasswordBox (พิมพ์รหัสลงช่องที่ไม่ปิดบังไม่ได้)
              # ── โหมดซ่อนหน้าต่าง + สั่งแบบไม่ใช้เมาส์ (รุ่น .5) ──
              start_hidden=False,     # เริ่มโดยหน้าต่างหลักถูกซ่อนค้าง (ตัวช่วยรอบก่อนถูกปิดกลางงาน)
              hide_fails=False,       # hide_window ไม่มีผล (หน้าต่างยังมองเห็น)
              act_fails=False,        # uia_act ล้ม (คืน False)
              act_no_effect=False,    # uia_act รายงานสำเร็จแต่ไม่มีอะไรเกิดขึ้น (ต้องจับได้ที่เงื่อนไขหลังคลิก)
              act_wrong_target=False, # uia_act รายงานสำเร็จแต่เลือกเมนูผิดตัว (เอกสารรับแทนเอกสารจ่าย)
              form_no_tab=False,      # ฟอร์มเปิดอยู่แต่ไม่มีแท็บ MDI (โครงจริงเปลี่ยน) — ตัวบอกอื่น (ปุ่มนำเข้า/หัวฟอร์ม) ต้องยังจับได้
              form_no_import=False,   # ฟอร์มเปิดอยู่แต่ไม่มีปุ่มนำเข้า (เช่นฟอร์มอื่นที่ไม่มีปุ่มนี้) — หัวฟอร์มต้องยังจับได้
              extra_window=False,     # มีหน้าต่างระดับบนอื่นของ ProMaxx ที่มองเห็นอยู่ (ไม่ใช่กล่องข้อความ/หน้าต่างรายการ) โดยหน้าต่างหลักยังไม่ถูกล็อก
              # ── หน้าต่างเลือกประเภทเอกสาร/คลัง ──
              start_type=None, start_wh=None,     # ค่าตั้งต้นของฟอร์มที่เปิดแล้ว (ชื่อแถวเต็ม เช่น "ORDS ใบปรับปรุงลดสินค้า") · None = ค่าเริ่มต้นตามชนิดฟอร์ม
              picker_open=None,                   # "type" | "wh" = เริ่มโดยมีหน้าต่างรายการเปิดค้าง
              rows_missing=False,                 # รายการประเภทไม่มีแถวเป้า (ORDS/IRPS) · wh_missing = รายการคลังไม่มี Front Store
              wh_missing=False,
              rows_dup=False,                     # แถวเป้าซ้ำ 2 แถว
              rows_decoy=False,                   # มีแถวชื่อ "ขึ้นต้นเหมือนเป้าแต่ไม่ตรงทั้งชื่อ" (ORDS ...(เก่า) / Front Store 2) — ต้องไม่ถูกนับเป็นเป้า
              pick_no_effect=False,               # คลิกแถวแล้วเครื่องหมายเลือกแถวไม่ย้าย
              pick_wrong_row=False,               # คลิกแถวหนึ่งแต่ระบบเลือกอีกแถว (คลิกพลาด) → ตกลงแล้วได้ค่าอื่น
              ok_no_effect=False,                 # กด ตกลง แล้วไม่มีอะไรเปลี่ยน/หน้าต่างไม่ปิด
              ok_wrong_value=False,               # เครื่องหมายอยู่ถูกแถว แต่ ตกลง ใส่ค่าของแถวอื่น
              ok_keeps_open=False,                # ตกลง ใส่ค่าถูก แต่หน้าต่างรายการไม่ปิด
              picker_wrong_title=False,           # หัวข้อหน้าต่างรายการไม่ตรง (คนละรายการ)
              wh_resets_type=False,               # เปลี่ยนคลังแล้วประเภทถูกรีเซ็ตกลับค่าเริ่มต้น (ต้องจับได้ที่ด่านก่อนนำเข้า)
              type_resets_wh=False,               # เปลี่ยนประเภทแล้วคลังถูกรีเซ็ตกลับค่าเริ่มต้น
              picker_scrolled=False,              # แถวเป้าอยู่นอกกรอบรายการ (ถูกเลื่อนออก) แต่ UIA ยังรายงาน IsOffscreen=False
              two_pickers=False,                  # มีหน้าต่างรายการสองใบ (ซ้ำ)
              number_stuck=None,                  # เลขที่เอกสารขึ้นต้นด้วยรหัสนี้เสมอ แม้ประเภทเปลี่ยนแล้ว (เช่น "ORCM") — ด่านเลขที่ต้องจับได้
              row_drift=False,                    # เมาส์ขยับไปที่แถวแล้วแถวในรายการเลื่อนตำแหน่ง (reverify ต้องจับได้)
              header_decoy=False,                 # มีฟิลด์ id เดียวกันอีกชุดใต้ "ฟอร์มคนละคลาส" (ฟอร์มโอนสินค้า) ที่หน้าตาเหมือนค่าที่ต้องการ
              # ── นำเข้าอัตโนมัติ (รุ่น .6) ── ตามที่ตรวจจริง 4 พ.ย. 2026: กล่อง Select File = ComboBoxEx32/ComboBox/Edit id 1148 · ComboBox 1136 · Button 1 (Open)/2 (Cancel)
              #   โหลดไฟล์แล้วตารางรายละเอียด = CF_ITEMID:N/ITEMNAME/SYSUNITID/QUANTITY/PRICE/AMOUNT + CF_TOTALQUANTITY:1 + แถวว่างท้ายตาราง · ปุ่ม ตกลง = cb_ok ในแถบปุ่ม
              branch_name="อนิน สาขาแยกชากค้อ",   # ชื่อสาขาที่ฟอร์มแสดง (SYSBRANCHID:1)
              dlg_no_edit=False,                  # กล่อง Select File ไม่มีช่อง File name (โครงเปลี่ยน)
              dlg_dup_edit=False,                 # มีช่อง File name สองช่อง
              dlg_edit_disabled=False,            # ช่อง File name ใช้งานไม่ได้
              settext_noop=False,                 # WM_SETTEXT ไม่มีผล (ช่องไม่รับข้อความ)
              gettext_mismatch=False,             # อ่านกลับได้ข้อความต่างจากที่ใส่
              open_no_effect=False,               # กด Open แล้วกล่องไม่ปิด/ไม่มีอะไรเกิด
              open_loads_partial=None,            # โหลดเฉพาะ N แถวแรก
              open_wrong_qty=False,               # แถวแรกจำนวนในตาราง +1 จากไฟล์
              open_extra_row=False,               # มีแถวเกิน (SKU 999999)
              open_dup_row=False,                 # แถวแรกซ้ำสองแถว
              open_slow=0.0,                      # ตารางขึ้นหลังกด Open กี่วินาที (ก่อนหน้านั้นยังว่าง)
              open_error_dialog=None,             # กด Open แล้วขึ้นกล่องข้อความผิดพลาดของ ProMaxx (ข้อความ)
              confirm_mode="reset",               # ผลของการกด ตกลง: reset = บันทึกแล้วฟอร์มเป็นใบใหม่ (เลขที่ถัดไป ตารางว่าง) · keep = ไม่มีอะไรเปลี่ยน · dialog = ขึ้นกล่อง "บันทึกเรียบร้อย"
              table_start_rows=None,              # ตารางมีรายการอยู่แล้วตั้งแต่ต้น (เช่นพนักงานพิมพ์ค้างไว้)
              # ── ป๊อปอัพที่ ProMaxx เปิดเองระหว่างนำเข้า (ตรวจจริง 5 พ.ย. 2026: Lot ในไฟล์ไม่มียอดคงเหลือ → ป๊อปอัพเลือก Lot No.) ──
              open_popup_window=None,             # None | "lot" | "other": กด Open แล้ว ProMaxx เปิดป๊อปอัพเป็นหน้าต่างระดับบนใหม่ (ไม่ใช่ #32770) และ "ยังไม่เพิ่มแถวลงตาราง"
              popup_after_dumps=None,             # N: โหลดแถวปกติ แต่ป๊อปอัพ Lot No. โผล่หลังตัวช่วย dump ตารางหลักครั้งที่ N (จำลองป๊อปอัพที่ขึ้นช้ากว่าด่านแรก)
              popup_dump_fails=False)             # อ่านโครงของหน้าต่างป๊อปอัพไม่ได้ (uia_dump ของหน้าต่างนั้นล้ม) — ต้องรายงานแบบทั่วไป ไม่บังสาเหตุ


# ── ล็อกอินแบบล่องหน (รุ่น 2026-11-05.1) — ตามที่ตรวจจริง 5 พ.ย. 2026 กับ ProMaxx จริง ──
#   หน้าต่างหลักถูกสร้างแบบซ่อนแล้ว ProMaxx "แสดงเอง" ไม่กี่วินาทีหลังเปิดโปรแกรม · ช่องชื่อผู้ใช้ได้โฟกัสในโปรแกรมตั้งแต่เปิดและยังรายงาน HasKeyboardFocus=True
#   แม้หน้าต่างถูกซ่อน/ไม่ใช่ foreground · WM_CHAR เข้าช่องที่ได้โฟกัส · Tab ย้ายไปช่องรหัสผ่าน · ช่องที่เสียโฟกัสกลายเป็น DWTextBlock ชื่อ = ข้อความที่พิมพ์
UFLAGS.update(dict(
    self_show_after=None,   # None = หน้าต่างหลักโผล่พร้อมหน้า Login (เดิม) · ตัวเลข = ProMaxx สร้างหน้าต่างแบบซ่อนแล้ว "แสดงเอง" หลังหน้า Login พร้อมกี่วินาที (ของจริง ≈ 5 วินาที)
    reshow_after=(),        # เวลา (วินาทีนับจากหน้า Login พร้อม) ที่ ProMaxx แสดงหน้าต่างเองซ้ำหลังถูกซ่อน (เช่นหลังล็อกอิน)
    focus_on_ready=False,   # หน้า Login พร้อม = ช่องชื่อผู้ใช้ได้โฟกัสในโปรแกรมทันที (ของจริง) · False = ไม่มีช่องไหนโฟกัสจนกว่าจะคลิก (ตัวต่อเดิม)
    logical_focus=False,    # ช่องที่ได้โฟกัสในโปรแกรมรายงาน HasKeyboardFocus=True แม้หน้าต่างไม่ใช่ foreground/ถูกซ่อน (ของจริง) · False = ผูกกับ foreground (ตัวต่อเดิม)
    post_blocked=False,     # PostMessage ถูกบล็อก (UIPI: ProMaxx รันสิทธิ์สูงกว่า) — post_char/post_key คืน False ทุกครั้ง
    post_blocked_after=None,  # ส่งได้ N หน่วยแล้วเริ่มถูกปฏิเสธ (กลางทาง)
    post_ignored=False,     # ข้อความเข้าคิวแต่โปรแกรมไม่รับ (ไม่มีอะไรเกิดในช่อง · Tab ไม่ทำงาน)
    post_drop_at=None,      # ทิ้งหน่วยที่ N (นับจาก 1 ตลอดงาน) — จำลองตัวอักษรหาย
    tab_no_move=False,      # Tab ไม่ย้ายโฟกัส
    browser_fg=False,       # foreground ตอนเริ่มเป็นเบราว์เซอร์ของพนักงาน (hwnd 900) · foreground_hwnd() รายงานตามจริง · focus(900) คืนโฟกัสให้
    grab_fg_on_show=False,  # ProMaxx แสดงหน้าต่าง → แย่ง foreground
    grab_fg_after=None,     # N วินาที (เวลาปลอม) หลังกด SIGN IN ProMaxx ดึง foreground ของตัวเอง (ทั้งที่ซ่อนอยู่) — จำลองถูกแย่งระหว่างรอเมนูหลักขึ้น (ตัวช่วยต้องคืนทันทีที่เห็น ไม่รอจบขั้น)
    grab_fg_on_act=False,   # ทุกครั้งที่ถูกสั่งผ่าน UIA (Invoke/Select) ProMaxx ดึง foreground ของตัวเอง — ตรงกับที่เจอจริง 3 ครั้งต่อ 1 งาน
    grab_fg_on_login=False,  # ล็อกอินสำเร็จแล้ว ProMaxx ดึง foreground ของตัวเอง (ทั้งที่ซ่อนอยู่) — เจอจริงหลังกด SIGN IN
    hide_script=None,       # รายการผลการสั่งซ่อนทีละครั้งตามลำดับ: True = ซ่อนได้ · False = ไม่มีผล · หมดรายการ = ซ่อนได้ตามปกติ (จำลองซ่อนติดๆ ดับๆ)
    shown_case=None,        # "upper" | "lower": ProMaxx แสดงชื่อผู้ใช้ที่พิมพ์เป็นตัวพิมพ์ใหญ่/เล็กทั้งหมด (ตัวช่วยต้องเทียบแบบไม่สนตัวพิมพ์)
    hide_keeps_fg=False))   # ซ่อนหน้าต่างแล้ว foreground ยังเป็นของ ProMaxx (หน้าต่างที่ซ่อนยัง "ได้" foreground)


def _contains(r, x, y):
    return r and r[0] <= x <= r[2] and r[1] <= y <= r[3]


class FakeWpfUI(FakeUI):
    def __init__(self, W, M, U, uia=None, **flags):
        self.U = U
        self.u = dict(UFLAGS)
        bad = set(uia or {}) - set(UFLAGS)
        if bad:
            raise TypeError("uia flag ไม่รู้จัก: %s" % sorted(bad))
        self.u.update(uia or {})
        self.field_units = {"username": [], "password": []}      # หน่วย UTF-16 ที่ post_char ส่งเข้าช่อง (fields ถอดจากตรงนี้)
        self.post_count = 0
        self.posted = []                                         # post_char/post_key ที่เข้าคิว: ("char", hwnd) | ("key", ชื่อ) — ไม่เก็บตัวอักษร
        self.pending_shows = []                                  # เวลาปลอมที่ ProMaxx จะแสดงหน้าต่างเอง
        self.last_show_at = None
        self.exposures = []                                      # วินาที (เวลาปลอม) ที่หน้าต่างโผล่ค้างก่อนถูกตัวช่วยซ่อน
        self.show_log = []
        self.show_posted = []                                    # จำนวนข้อความที่ส่งแล้ว (ตัวอักษร+Tab) ตอนที่ ProMaxx แสดงหน้าต่างเอง — ไว้ยืนยันว่าเทสวางจังหวะโผล่ "กลางการพิมพ์" จริง
        self.ready_at = None
        self.login_grabbed = False
        self.grab_at = None
        self.grab_times = []                                     # เวลา (ปลอม) ที่ ProMaxx แย่ง foreground
        self.focus_times = []                                    # เวลา (ปลอม) ที่ตัวช่วยคืนโฟกัสให้เบราว์เซอร์
        self.minimized = bool(self.u["minimized"])
        self.hidden = bool(self.u["start_hidden"])     # หน้าต่างหลักถูกซ่อน (SW_HIDE) — โปรเซสยังทำงาน · UIA ยังอ่าน/สั่งผ่าน hwnd ได้
        self.popup = None                              # None | "lot" | "other": ป๊อปอัพที่ ProMaxx เปิดค้างอยู่ (หน้าต่างระดับบนแยก)
        self.main_dumps = 0                            # จำนวนครั้งที่ตัวช่วย dump หน้าต่างหลัก (ไว้จำลองป๊อปอัพที่โผล่ช้า)
        self.popup_dumps = 0                           # จำนวนครั้งที่ตัวช่วยอ่านโครงของป๊อปอัพ
        self.acted = []                                # uia_act ที่ "มีผล" (pattern, ชนิด:ชื่อ/id)
        super().__init__(W, M, **flags)
        self.focus_field = self.u["start_focus_field"] if self.state == "login" else None
        if self.u["browser_fg"]:
            self.has_focus = False
        # menu | form (ใช้เมื่อ state=doc/import) — start_letter ใส่ = เริ่มที่ฟอร์มที่เปิดแล้ว
        self.stage = ("form" if self.letter_choice else "menu") if self.state in ("doc", "import") else None
        self.uia_calls = 0
        self.uia_ms = []
        self.clicked = []               # id (หรือ type:name) ขององค์ประกอบที่ถูกคลิกจริง
        self.misfires = []              # พิมพ์ลงช่องที่ไม่ได้โฟกัส · กดปุ่มทูลบาร์ที่ไม่ใช่ปุ่มนำเข้า
        self.drifted = False
        self.login_clicks = 0
        self.vtype = None               # ชื่อแถวเต็มของประเภทเอกสารที่ตั้งอยู่ในฟอร์ม (เช่น "ORDS ใบปรับปรุงลดสินค้า")
        self.wh = None                  # ชื่อคลังที่ตั้งอยู่ในฟอร์ม
        self.picker = None              # None | {"kind": "type"|"wh", "sel": แถวที่มีเครื่องหมายเลือก, "edit": แถวที่ถูกคลิกจนกลายเป็นช่อง Edit}
        self.row_shift = False          # row_drift: แถวในรายการเลื่อนหลังเมาส์ขยับมาที่แถว
        self.picker_log = []            # ประวัติ ("open", kind) | ("row", kind, ชื่อแถว) | ("ok", kind, sel) | ("exit", kind)
        self.table = [dict(r) for r in (self.u["table_start_rows"] or [])]     # แถวในตารางรายละเอียด: {sku,name,unit,qty,price}
        self.table_ready_at = 0.0
        self.dlg_text = ""              # ข้อความในช่อง File name ของกล่อง Select File
        self.file_loaded = ""
        self.number_seq = 1             # เลขลำดับท้ายเลขที่เอกสาร (…00001) — เทสเปลี่ยนระหว่างจังหวะเพื่อจำลอง "มีคนบันทึกคั่น"
        self.ok_clicks = 0              # จำนวนครั้งที่กด ตกลง (cb_ok ของฟอร์ม)
        self.saved = []                 # ตารางที่ถูกบันทึกตอนกด ตกลง
        self.at_back = False            # หน้าต่างหลักอยู่หลังหน้าต่างอื่น (show_window_back) — focus() ทำให้กลับมาอยู่หน้า
        if self.stage == "form":
            self._open_form_defaults()
            if self.u["picker_open"]:
                self._open_picker(self.u["picker_open"])

    # ── สถานะ → หน้าต่าง Win32 ──────────────────────────────────
    def _model(self):
        self._tick()
        s, tops = self.state, []
        if s in ("login", "logging", "main", "doc", "import"):
            en = not (s == "import" or self.u["top_disabled"] or self.picker)
            tops.append((self.W(MAIN_HWND, MAIN_CLS, TITLE, MINI_WIN if self.minimized else WIN, not self.hidden, en, 0, self.PID, 0), []))
            tops.append((self.W(101, "HwndWrapper[ssmaxx.exe;;213f64ff]", "", (0, 0, 136, 39), False, True, 0, self.PID, 0), []))
            tops.append((self.W(102, "HwndWrapper[ssmaxx.exe;;8de39fac]", "MediaContextNotificationWindow", (0, 0, 0, 0), False, True, 0, self.PID, 0), []))
        if s in ("login", "logging", "main", "doc", "import") and self.u["extra_window"]:
            tops.append((self.W(500, "HwndWrapper[ssmaxx.exe;;eeeeeeee-0000-4000-8000-000000000000]", "Another ProMaxx window", (100, 100, 900, 700), True, True, 0, self.PID, 0), []))
        if s == "import":
            tops.append((self.W(DIALOG_HWND, "#32770", "Select File", (482, 203, 1865, 962), True, True, 0, self.PID, 0), []))
        if self.popup:                   # ป๊อปอัพที่ ProMaxx เปิดเอง (เช่นเลือก Lot No.) — หน้าต่างระดับบนเต็มจอ โปรเซสเดียวกัน หน้าต่างหลักยัง enabled
            tops.append((self.W(POPUP_HWND, POPUP_CLS, POPUP_TITLE if self.popup == "lot" else "Another popup", POPUP_RECT, True, True, 0, self.PID, 0), []))
        if self.picker:                  # หน้าต่างรายการเป็นหน้าต่างระดับบนใหม่ (เต็มจอ) ของโปรเซสเดียวกัน
            tops.append((self.W(PICKER_HWND, PICKER_CLS, PICKER_TITLE, (-7, -7, 1927, 1087), True, True, 0, self.PID, 0), []))
            if self.u["two_pickers"]:
                tops.append((self.W(PICKER_HWND + 1, PICKER_CLS.replace("d89a72ff", "aaaaaaaa"), PICKER_TITLE, (-7, -7, 1927, 1087), True, True, 0, self.PID, 0), []))
        return tops

    def _tick(self):
        super()._tick()
        if self.state == "import" and not self.dialogs_now:
            self.dialogs_now = [("Select File", ("File &name:", "Files of &type:"))]
        if self.state == "login" and self.ready_at is None and self.f["start_state"] == "closed":
            self.ready_at = self.launch_at + self.f["launch_delay"]          # หน้า Login พร้อมตอนนี้ (เปิดโปรแกรมเอง)
            if self.u["focus_on_ready"]:
                self.focus_field = self.u["start_focus_field"]
            if self.u["self_show_after"] is not None:
                self.hidden = True                                           # ProMaxx สร้างหน้าต่างแบบซ่อนก่อน
                self.pending_shows = [self.ready_at + self.u["self_show_after"]] + [self.ready_at + x for x in self.u["reshow_after"]]
        if self.u["grab_fg_on_login"] and self.state == "main" and not self.login_grabbed:
            self.login_grabbed = True
            self.has_focus = True
            self.grab_times.append(round(self.t, 3))
        if self.grab_at is not None and self.t >= self.grab_at:
            self.has_focus = True
            self.grab_times.append(round(self.grab_at, 3))
            self.grab_at = None
        for ts in sorted(x for x in self.pending_shows if self.t >= x):
            self.pending_shows.remove(ts)
            if self.hidden:
                self.hidden = False                                          # ProMaxx แสดงหน้าต่างเอง
                self.last_show_at = ts
                self.show_log.append(round(ts, 3))
                self.show_posted.append(len(self.posted))
                if self.u["grab_fg_on_show"]:
                    self.has_focus = True

    # ── ต้นไม้ UIA ตามสถานะ ─────────────────────────────────────
    def _e(self, id, type, rect, name="", cls="", help="", enabled=True, off=False, focused=False, password=False, parents=()):
        return self.U(id=id, type=type, name=name, help=help, cls=cls, rect=rect, enabled=enabled, offscreen=off, focusable=True,
                      focused=focused, password=password, parents=tuple(parents))

    def _form_cls(self):
        return self.u["form_cls_override"] or ("pn_trans_in" if self.letter_choice == "I" else "pn_trans_out")

    def _els(self):
        s, E = self.state, self._e
        if s not in ("login", "logging", "main", "doc", "import"):
            return []
        els = []
        logged_in = s in ("main", "doc", "import")
        wnd = (("WindowSV", "ScrollViewer"), ("w_mainframe", "Window"))
        lp = (("dw_login_emp", "DataWindow"), ("27", "u_login_metro_style1"), ("uo_login_panel", "UserObject")) + wnd
        fg = self.has_focus or self.u["logical_focus"]
        els.append(E("uo_login_panel", "Custom", (561, 231, 1360, 825), cls="UserObject", off=logged_in, parents=wnd))
        if self.focus_field == "username" and not logged_in:
            els.append(E("cf_empid", "Edit", (767, 485, 1151, 509), cls="TextBox", focused=fg and not self.u["edit_unfocused"], parents=lp))
        else:
            els.append(E("cf_empid:1", "Custom", (767, 485, 1151, 509), name=self._shown_user() if not logged_in else "034", cls="DWTextBlock", off=logged_in, parents=lp))
        if self.focus_field == "password" and not logged_in:
            els.append(E("cf_pass", "Edit", (768, 531, 1152, 555), cls="TextBox" if self.u["pass_plain"] else "PasswordBox",
                         focused=fg and not self.u["edit_unfocused"], password=not self.u["pass_plain"], parents=lp))
        else:
            els.append(E("cf_pass:1", "Custom", (768, 531, 1152, 555), name="Password", cls="DWTextBlock", off=logged_in, parents=lp))
        els.append(E("cb_Login", "Button", (762, 657, 1158, 683), cls="Button", off=logged_in, parents=lp))
        if self.u["dup_login_btn"]:
            els.append(E("cb_Login", "Button", (762, 657, 1158, 683), cls="Button", off=logged_in, parents=lp))
        els += [E("txtEmpid", "Edit", (791, 732, 1021, 762), cls="TextBox", off=logged_in, parents=lp),
                E("txtEmpid", "Edit", (791, 686, 1021, 716), cls="TextBox", off=logged_in, parents=lp)]
        # รายการเมนูซ้าย: ตอนยังไม่ล็อกอินมี ListBox ว่าง (4x4) · หลังล็อกอินมี 7 รายการ · หลังเปิดฟอร์มถูกเลื่อนออกนอกกรอบแต่ off=False
        lb = (("lbx_manumain", "ListBox"), ("scrollViewer", "ScrollViewer"), ("w_mainframe", "Window"))
        if not logged_in:
            els.append(E("lbx_manumain", "List", (0, 83, 4, 87), cls="ListBox", parents=wnd))
        elif not self.u["list_hidden"]:
            dx = SHIFT if (s in ("doc", "import") and self.stage == "form") else 0
            els.append(E("lbx_manumain", "List", (20 + dx, 83, 224 + dx, 647), cls="ListBox", parents=wnd))
            for i, nm in enumerate(LIST_ITEMS):
                els.append(E("", "ListItem", (22 + dx, 85 + 80 * i, 222 + dx, 165 + 80 * i), name=nm, cls="ListBoxItem", parents=lb))
        # หน้าเมนูย่อย (ui_mainmenu_tranin/tranout_style2) — เลื่อนออกนอกกรอบเมื่อเปิดฟอร์ม
        if s in ("doc", "import") and self.menu_choice:
            dx = SHIFT if self.stage == "form" else 0
            mcls = "ui_mainmenu_tranin_style2" if self.menu_choice == "เอกสารรับ" else "ui_mainmenu_tranout_style2"
            mp = (("", mcls), ("uo_contlormenu", "UserObject")) + wnd[1:]
            btns = ({"I": "เอกสารรับ", "B": "รับโอนสินค้าระหว่างสาขา", "W": "รับโอนสินค้าระหว่างคลัง", "A": "สินค้าคงเหลือและทุน", "C": "เช็คจ่าย"}
                    if mcls.endswith("tranin_style2") else
                    {"O": "เอกสารจ่าย", "B": "โอนสินค้าระหว่างสาขา", "W": "โอนสินค้าระหว่างคลัง", "C": "เช็ครับ", "A": "Shift Verify"})
            for i, (bid, nm) in enumerate(btns.items()):
                x0 = 250 + 250 * (i % 3) + dx
                y0 = 192 + 121 * (i // 3)
                els.append(E(bid, "Button", (x0, y0, x0 + 250, y0 + 120), name=nm, cls="Button", parents=mp))
        # ฟอร์มเอกสาร (แท็บ MDI)
        if s in ("doc", "import") and self.stage == "form":
            tab = (("MDI_TAB", "TabControl"),) + wnd[1:]
            if not self.u["form_no_tab"]:
                els.append(E("", "TabItem", (2, 85, 106, 111), name=self.menu_choice, cls="TabItem", parents=tab))
            fp = (("", "GroupBox"), ("", "UserObject"), ("", self._form_cls()), ("", "UserObject"), ("", "TabItem"), ("MDI_TAB", "TabControl"))
            dxi = 30 if self.drifted else 0
            for i, (bid, hp) in enumerate([("uo_tran_bt_import", self.u["import_help"]), ("uo_tran_bt_insert", "แทรกรายการ"),
                                           ("uo_tran_bt_delete", "ลบรายการ"), ("uo_tran_bt_cancel", "ยกเลิกรายการ"),
                                           ("uo_tran_bt_reference", "ดูรายละเอียดอ้างอิง")]):
                if bid == "uo_tran_bt_import" and self.u["form_no_import"]:
                    continue
                x0 = 1591 + 24 * i + (dxi if bid == "uo_tran_bt_import" else 0)
                els.append(E(bid, "Button", (x0, 256, x0 + 20, 276), name="Contactus", cls="Button", help=hp, parents=fp))
            els += self._header_els()
            els += self._toolbar_els() + self._table_els()
        return els

    def _shown_user(self):
        """ชื่อที่ช่องผู้ใช้แสดงหลังเสียโฟกัส (DWTextBlock) = ข้อความที่พิมพ์ (ตรวจจริง 5 พ.ย. 2026) · shown_case จำลอง ProMaxx ที่แปลงตัวพิมพ์"""
        t, c = self.fields["username"], self.u["shown_case"]
        return t.upper() if c == "upper" else (t.lower() if c == "lower" else t)

    def _toolbar_els(self):
        """แถบปุ่มของฟอร์ม (Button ชื่อ/HelpText ว่าง · แยกด้วย AutomationId) — ติดกันห่าง 1px ตามที่ตรวจจริง: ลบ/ตกลง/ค้นหา/ยกเลิก ฯลฯ"""
        E = self._e
        bar = (("7", "sfw_buttonbar_ui"), ("uo_tran_uo_1", "UserObject"), ("uo_tran", "UserObject"), ("23", self._form_cls()),
               ("UOSV", "ScrollViewer"), ("MDI_SHEET_CLIENT", "UserObject"), ("", "TabItem"), ("MDI_TAB", "TabControl"))
        spec = [("cb_add", 6, 76), ("cb_delete", 77, 147), ("cb_ok", 148, 218), ("cb_search", 219, 289), ("cb_previous", 290, 360),
                ("cb_next", 361, 431), ("cb_cancel", 432, 502), ("cb_approve", 742, 832)]
        return [E(i, "Button", (a, 98, b, 126), cls="Button", parents=bar) for i, a, b in spec]

    def _table_els(self):
        """ตารางรายละเอียดสินค้า: แถว 1..N + แถวว่างท้ายตาราง (จำนวน .00) + ยอดรวม CF_TOTALQUANTITY:1 + ชุดซ่อน id ซ้ำค่าว่าง (ตามของจริง)"""
        E = self._e
        dp = (("uo_tran_dw_detail", "DataWindow"), ("UOSV", "ScrollViewer"), ("23", self._form_cls()), ("UOSV", "ScrollViewer"),
              ("MDI_SHEET_CLIENT", "UserObject"), ("", "TabItem"), ("MDI_TAB", "TabControl"))
        rows = self.table if self.t >= self.table_ready_at else []
        out = []
        for n, r in enumerate(rows, 1):
            y = 313 + 24 * (n - 1)
            out += [E("CF_ITEMID:%d" % n, "Custom", (75, y, 150, y + 20), name=r["sku"], cls="DWTextBlock", parents=dp),
                    E("ITEMNAME:%d" % n, "Custom", (254, y, 669, y + 20), name=r["name"], cls="DWTextBlock", parents=dp),
                    E("SYSUNITID:%d" % n, "Custom", (673, y, 743, y + 20), name=r["unit"], cls="DWTextBlock", parents=dp),
                    E("QUANTITY:%d" % n, "Custom", (747, y, 806, y + 20), name="%.2f" % r["qty"], cls="DWTextBlock", parents=dp),
                    E("PRICE:%d" % n, "Custom", (810, y, 890, y + 20), name="%.2f" % r["price"], cls="DWTextBlock", parents=dp),
                    E("AMOUNT:%d" % n, "Custom", (1206, y, 1300, y + 20), name="%.2f" % (r["qty"] * r["price"]), cls="DWTextBlock", parents=dp)]
        n = len(rows) + 1
        y = 313 + 24 * (n - 1)
        out += [E("CF_ITEMID:%d" % n, "Custom", (75, y, 150, y + 20), name="", cls="DWTextBlock", parents=dp),
                E("QUANTITY:%d" % n, "Custom", (747, y, 806, y + 20), name=".00", cls="DWTextBlock", parents=dp),
                E("PRICE:%d" % n, "Custom", (810, y, 890, y + 20), name=".00", cls="DWTextBlock", parents=dp),
                E("AMOUNT:%d" % n, "Custom", (1206, y, 1300, y + 20), name=".00", cls="DWTextBlock", parents=dp),
                E("CF_TOTALQUANTITY:1", "Custom", (722, 1000, 878, 1020), name="%.2f" % sum(r["qty"] for r in rows), cls="DWTextBlock", parents=dp),
                E("QUANTITY:1", "Custom", (747, 50, 806, 70), name="", cls="DWTextBlock", off=True, parents=dp)]
        return out

    # ── ฟอร์ม: ค่าเริ่มต้น · ส่วนหัว · หน้าต่างรายการ ───────────────
    def _open_form_defaults(self):
        d_type, d_wh = DEFAULTS[self.letter_choice]
        self.vtype = self.u["start_type"] or d_type
        self.wh = self.u["start_wh"] or d_wh

    def _target_prefix(self):
        return "ORDS " if self.letter_choice == "O" else "IRPS "

    def _rows(self, kind):
        if kind == "wh":
            rows = list(WH_ROWS)
            if self.u["wh_missing"]:
                rows = [r for r in rows if r != "Front Store"]
            if self.u["rows_decoy"]:
                rows.insert(0, "Front Store 2")
            return rows
        rows = list(TYPE_ROWS[self.letter_choice])
        if self.u["rows_missing"]:
            rows = [r for r in rows if not r.startswith(self._target_prefix())]
        if self.u["rows_decoy"]:
            tgt = [r for r in TYPE_ROWS[self.letter_choice] if r.startswith(self._target_prefix())][0]
            rows.insert(0, tgt + " (เก่า)")
        if self.u["rows_dup"]:
            rows.insert(5, [r for r in TYPE_ROWS[self.letter_choice] if r.startswith(self._target_prefix())][0])
        return rows

    def _open_picker(self, kind):
        rows = self._rows(kind)
        cur = self.vtype if kind == "type" else self.wh
        self.picker = {"kind": kind, "sel": rows.index(cur) if cur in rows else None, "edit": None}
        self.picker_log.append(("open", kind))

    def _type_name(self):
        return (self.vtype or "").split(" ", 1)[-1]

    def _number(self):
        code = self.u["number_stuck"] or (self.vtype or "").split(" ", 1)[0]
        return "%sBY0012611%05d" % (code, 872 if code == "ORCM" else self.number_seq)

    def _row_rect(self, i):
        y = 409 + 25 * i + (400 if self.u["picker_scrolled"] else 0)
        x = 30 if self.row_shift else 0
        return (798 + x, y, 1101 + x, y + 20)

    def _picker_els(self):
        if not self.picker:
            return []
        E, kind = self._e, self.picker["kind"]
        rows = self._rows(kind)
        bar = (("UOSV", "ScrollViewer"), ("7", "sfw_buttonbar_ui"), ("UOSV", "ScrollViewer"), ("uo_popupdw_uo_buttonbar", "UserObject"),
               ("UOSV", "ScrollViewer"), ("uo_popupdw", "UserObject"))
        lst = (("uo_popupdw_dw_datatmp", "DataWindow"), ("UOSV", "ScrollViewer"), ("uo_popupdw", "UserObject"))
        title = "ประเภทเอกสาร" if kind == "type" else "คลังสินค้า"
        if self.u["picker_wrong_title"]:
            title = "คลังสินค้า" if kind == "type" else "ประเภทเอกสาร"
        els = [E("cb_ok", "Button", (777, 299, 847, 327), cls="Button", parents=bar),
               E("cb_exit", "Button", (1075, 299, 1145, 327), cls="Button", parents=bar),
               E("cb_search", "Button", (847, 299, 917, 327), cls="Button", off=True, parents=bar),
               E("", "Text", (781, 340, 1141, 361), name=title, cls="TextBlock", parents=(("uo_popupdw_st_title", "Text"),) + lst[1:]),
               E("input1", "Edit", (864, 373, 1094, 395), cls="TextBox", focused=True, parents=(("uo_popupdw_dw_search", "DataWindow"),) + lst[1:]),
               E("uo_popupdw_dw_datatmp", "Custom", (780, 405, 1140, 780), cls="DataWindow", parents=lst[1:])]
        for i, nm in enumerate(rows):
            r = self._row_rect(i)
            if self.picker["edit"] == i:
                els.append(E("col1", "Edit", r, cls="TextBox", focused=True, parents=lst))          # แถวที่ถูกคลิกกลายเป็นช่อง Edit ชื่อว่าง (ตรวจจริง D3a)
            else:
                els.append(E("col1:%d" % (i + 1), "Custom", r, name=nm, cls="DWTextBlock", parents=lst))
            els.append(E("p_1:%d" % (i + 1), "Image", (1103, r[1] + 2, 1112, r[1] + 13), cls="Image", off=self.picker["sel"] != i, parents=lst))
        return els

    def _header_els(self):
        E = self._e
        hp = (("uo_tran_dw_newmaster", "DataWindow"), ("UOSV", "ScrollViewer"), ("23", self._form_cls()), ("UOSV", "ScrollViewer"),
              ("MDI_SHEET_CLIENT", "UserObject"), ("", "TabItem"), ("MDI_TAB", "TabControl"))
        decoy = []
        if self.u["header_decoy"]:
            # ฟอร์มโอนสินค้า (pn_trans_tb_out) ที่ซ่อนอยู่ มีฟิลด์ id เดียวกัน — ชื่อเหมือนค่าที่ต้องการ ต้องไม่ถูกเอามาตัดสินแทนฟอร์มจริง
            dp = (("uo_tran_dw_newmaster", "DataWindow"), ("UOSV", "ScrollViewer"), ("23", "pn_trans_tb_out"), ("UOSV", "ScrollViewer"))
            decoy = [E("SYSVOUCHERID:1", "Custom", (122, 177, 290, 197), name="ใบปรับปรุงลดสินค้า", cls="DWTextBlock", parents=dp),
                     E("SYSWAREHOUSEID:1", "Custom", (978, 200, 1154, 220), name="Front Store", cls="DWTextBlock", parents=dp),
                     E("TRANNO:1", "Custom", (122, 200, 290, 220), name="ORDSBY001261100001", cls="DWTextBlock", parents=dp)]
        return decoy + [E("TRANNO:1", "Custom", (122, 300, 290, 320), name="", cls="DWTextBlock", off=True, parents=hp),   # ชุดซ่อน (ค่าว่าง) — ของจริงมี TRANNO:1 สองตัว
                E("TRANNO:1", "Custom", (122, 200, 290, 220), name=self._number(), cls="DWTextBlock", parents=hp),
                E("SYSBRANCHID:1", "Custom", (122, 154, 290, 174), name=self.u["branch_name"], cls="DWTextBlock", parents=hp),
                E("SYSVOUCHERID:1", "Custom", (122, 177, 290, 197), name=self._type_name(), cls="DWTextBlock", parents=hp),
                E("SYSWAREHOUSEID:1", "Custom", (978, 200, 1154, 220), name=self.wh or "", cls="DWTextBlock", parents=hp),
                # ตัวกรองที่ซ่อนอยู่ใช้ id ตัวพิมพ์เล็ก — ต้องไม่ถูกเข้าใจผิดว่าเป็นช่องหัวฟอร์ม
                E("sysvoucherid_t:1", "Custom", (12, 320, 210, 342), name="", cls="DWTextBlock", off=True, parents=hp)]

    # ── adapter: UIA ────────────────────────────────────────────
    def uia_find(self, hwnd, ids=(), ctype="", name=""):
        self.uia_calls += 1
        self.t += self.f.get("uia_cost", 0.0)
        if self.u["uia_always_fail"] or self.uia_calls <= self.u["uia_fail_first"]:
            raise RuntimeError("UIA ล้ม (ฉีดโดยเทส)")
        self._tick()
        if hwnd == MAIN_HWND:
            pool = self._els()
            if self.minimized:          # ทุกองค์ประกอบถูกย้ายไปมุม -32000 พร้อมหน้าต่าง (IsOffscreen ยังเป็น False — เชื่อไม่ได้)
                pool = [dataclasses.replace(e, rect=(e.rect[0] - 32000, e.rect[1] - 32000, e.rect[2] - 32000, e.rect[3] - 32000)) for e in pool]
        elif hwnd == PICKER_HWND and self.picker:
            pool = self._picker_els()
        else:
            return []
        out = []
        for e in pool:
            if ids and e.id not in ids:
                continue
            if ctype and e.type != ctype:
                continue
            if name and e.name != name:
                continue
            out.append(e)
        return out

    def uia_dump(self, hwnd, max_nodes=1500):
        """รูปแบบเดียวกับ dump จริง (promaxx_uia.py): 'Type id=… name="…" cls=… rect=(l,t,r,b) en=… off=… focus=…'"""
        self.uia_calls += 1
        self.t += self.f.get("uia_cost", 0.0)
        if hwnd == POPUP_HWND and self.popup:
            self.popup_dumps += 1
            if self.u["popup_dump_fails"]:
                raise RuntimeError("UIA ล้ม (อ่านโครงป๊อปอัพไม่ได้ · ฉีดโดยเทส)")
            return list(POPUP_LOT_LINES if self.popup == "lot" else POPUP_OTHER_LINES)[:max_nodes]
        pool = self._picker_els() if (hwnd == PICKER_HWND and self.picker) else (self._els() if hwnd == MAIN_HWND else [])
        out = ['  %s id=%s name="%s" cls=%s rect=(%d,%d,%d,%d) en=%s off=%s focus=%s' % (
            e.type, e.id, e.name, e.cls, e.rect[0], e.rect[1], e.rect[2], e.rect[3], e.enabled, e.offscreen, e.focused) for e in pool][:max_nodes]
        if hwnd == MAIN_HWND:
            self.main_dumps += 1
            n = self.u["popup_after_dumps"]
            if n is not None and self.main_dumps >= n and not self.popup:
                self.popup = "lot"       # ป๊อปอัพขึ้นระหว่างตัวช่วยอ่านตาราง (ผลที่คืนครั้งนี้ยังเป็นภาพก่อนหน้านั้น)
        return out

    def uia_stats(self):
        return {"calls": self.uia_calls, "totalMs": self.uia_calls * 10, "avgMs": 10, "maxMs": 10}

    # ── adapter: input ──────────────────────────────────────────
    def type_text(self, text):
        self._act("type_text", text)
        if self.state == "login" and self.has_focus and self.focus_field and not self.hidden:
            self.fields[self.focus_field] = text
        else:
            self.misfires.append("type_unfocused")

    def move_to(self, x, y):
        self._act("move_to", int(x), int(y))
        if self.u["drift_on_move"] and self.stage == "form":
            self.drifted = True          # ผู้ใช้ขยับหน้าต่าง/เป้าเลื่อนระหว่างเตรียมคลิก
        if self.u["row_drift"] and self.picker:
            self.row_shift = True        # รายการเลื่อนหลังเมาส์ขยับมาที่แถว
        return True, ""

    def focus(self, hwnd):
        if hwnd == BROWSER_HWND:         # คืนโฟกัสให้เบราว์เซอร์ของพนักงาน
            self._act("focus", hwnd)
            self.has_focus = False
            self.focus_times.append(round(self.t, 3))
            return
        super().focus(hwnd)
        if not self.f["focus_fails"]:
            self.minimized = False       # SW_RESTORE เฉพาะหน้าต่างที่ถูกย่อ (WinAdapter.focus)
            self.at_back = False

    def click_at(self, x, y, pids=None):
        self._act("click_at", int(x), int(y))
        self._tick()
        if self.minimized:
            return False, "ใต้เมาส์เป็นหน้าต่างของโปรแกรมอื่น"       # หน้าต่างอยู่มุม -32000 — ใต้เมาส์ไม่ใช่ ProMaxx
        if self.hidden:
            return False, "ใต้เมาส์เป็นหน้าต่างของโปรแกรมอื่น"       # หน้าต่างถูกซ่อน — เมาส์จริงคลิกทะลุไปโปรแกรมอื่น (ต้องไม่เกิดขึ้นในโหมดซ่อน)
        if self.f["click_drift"]:
            return False, "เมาส์ถูกขยับก่อนคลิก"
        if not _contains(WIN, x, y):
            return False, "ใต้เมาส์เป็นหน้าต่างของโปรแกรมอื่น"
        if self.state == "import":
            return True, ""              # หน้าต่างหลักถูกล็อกด้วยกล่องโมดัล — คลิกไม่มีผล
        if self.picker:
            return self._click_picker(x, y)
        hits = [e for e in self._els() if not e.offscreen and _contains(e.rect, x, y) and e.type in ("Button", "ListItem", "Custom", "Edit")
                and e.id not in ("uo_login_panel",)]
        if not hits:
            return True, ""
        e = min(hits, key=lambda h: (h.rect[2] - h.rect[0]) * (h.rect[3] - h.rect[1]))
        self.clicked.append(e.id or "%s:%s" % (e.type, e.name))
        self._el_effect(e)
        return True, ""

    def _el_effect(self, e):
        """ผลของการ "กด/เลือก" องค์ประกอบหนึ่งชิ้น — ใช้ร่วมกันระหว่างคลิกเมาส์จริง (click_at) และสั่งผ่าน UIA (uia_act)"""
        i = e.id
        if i in ("cf_empid", "cf_empid:1"):
            if not self.u["focus_never"]:
                self.focus_field = "username"
        elif i in ("cf_pass", "cf_pass:1"):
            if not self.u["focus_never"]:
                self.focus_field = "password"
        elif i == "cb_Login":
            self.login_clicks += 1
            if self.u["grab_fg_after"] is not None:
                self.grab_at = self.t + self.u["grab_fg_after"]
            if self.fields["username"] == self.user and self.fields["password"] == self.password:
                self.state, self.login_at = "logging", self.t
            else:
                self.dialogs_now = [("SeniorSoft ProMaxx", ("User หรือ Password ไม่ถูกต้อง",))]
        elif e.type == "ListItem" and e.name in ("เอกสารรับ", "เอกสารจ่าย"):
            self.state, self.stage, self.menu_choice, self.letter_choice = "doc", "menu", e.name, None
        elif i in ("I", "O") and self.state == "doc" and self.stage == "menu":
            self.stage, self.letter_choice = "form", i
            self._open_form_defaults()
        elif i == "SYSVOUCHERID:1" and self.stage == "form":
            self._open_picker("type")
        elif i == "SYSWAREHOUSEID:1" and self.stage == "form":
            self._open_picker("wh")
        elif i == "uo_tran_bt_import":
            self.state = "import"
            self.dlg_text = ""
            self.dialogs_now = [("Select File", ("File &name:", "Files of &type:"))]
        elif i == "cb_ok" and self.stage == "form":
            self.ok_clicks += 1
            mode = self.u["confirm_mode"]
            if mode == "reset":
                self.saved.append([dict(r) for r in self.table])
                self.table = []
                self.number_seq += 1
            elif mode == "dialog":
                self.dialogs_now = [("SeniorSoft ProMaxx", ("บันทึกข้อมูลเรียบร้อย",))]
        elif i.startswith("cb_") and self.stage == "form":
            self.misfires.append(i)          # ปุ่มอื่นของแถบปุ่ม (เพิ่ม/ลบ/ยกเลิก/อนุมัติ …) ต้องไม่ถูกกดเด็ดขาด
        elif i.startswith("uo_tran_bt_"):
            self.misfires.append(i)

    # ── adapter: ซ่อน/แสดงหน้าต่าง + สั่งแบบไม่ใช้เมาส์ (รุ่น .5) ─────────
    def hide_window(self, hwnd):
        keep_fg = self.u["hide_keeps_fg"] and self.has_focus
        script = self.u["hide_script"]
        fail = bool(script) and not script.pop(0)       # ครั้งนี้ซ่อน "ไม่มีผล" ตามสคริปต์
        if hwnd == MAIN_HWND and not self.hidden and not self.u["hide_fails"] and not fail and self.last_show_at is not None:
            self.exposures.append(round(self.t - self.last_show_at, 3))      # หน้าต่างโผล่ค้างกี่วินาทีก่อนถูกซ่อน
            self.last_show_at = None
        if fail:
            self.calls.append(("hide_window", hwnd))
            return
        self._hide_window_base(hwnd)
        if keep_fg:
            self.has_focus = True

    def _hide_window_base(self, hwnd):
        self.calls.append(("hide_window", hwnd))
        if hwnd == MAIN_HWND and not self.u["hide_fails"]:
            self.hidden = True
            self.has_focus = False       # หน้าต่างที่ถูกซ่อนเสียโฟกัส — Windows ส่งโฟกัสให้หน้าต่างถัดไป (เช่นเบราว์เซอร์) ⇒ ตัวช่วยที่เผลอ "ดึงโฟกัส" ตอนซ่อนจะเห็นเป็น focus()

    def show_window(self, hwnd):
        self.calls.append(("show_window", hwnd))
        if hwnd == MAIN_HWND:
            self.hidden = False

    def reveal_hidden(self, pids):
        n = 1 if (self.hidden and self.PID in set(pids or [])) else 0
        self.calls.append(("reveal_hidden", n))
        if n:
            self.hidden = False
        return n

    # ── นำเข้าอัตโนมัติ (รุ่น .6): กล่อง Select File + ข้อความ/ปุ่มผ่าน Windows message ───────────
    EDIT_HWND, OPEN_HWND, CANCEL_HWND = 303, 305, 306

    # ── ส่งข้อความเข้าหน้าต่างโดยตรง (รุ่น 2026-11-05.1) ─────────────────────
    def foreground_hwnd(self):
        if not self.u["browser_fg"]:
            return 0                                   # ไม่จำลองเบราว์เซอร์ = ตัวช่วยไม่คืนโฟกัสให้ใคร (เทสเดิมไม่เห็น focus เพิ่ม)
        return MAIN_HWND if self.has_focus else BROWSER_HWND

    def _post_ok(self, hwnd, pids):
        u = self.u
        if u["post_blocked"] or hwnd != MAIN_HWND or (pids is not None and self.PID not in set(pids)):
            return False
        return u["post_blocked_after"] is None or self.post_count < u["post_blocked_after"]

    def post_char(self, hwnd, code, pids=None):
        self.calls.append(("post_char", hwnd))
        if not self._post_ok(hwnd, pids):
            return False
        self.post_count += 1
        self.posted.append(("char", hwnd))
        if self.state != "login" or self.u["post_ignored"] or not self.focus_field or self.u["post_drop_at"] == self.post_count:
            return True
        units = self.field_units[self.focus_field]
        units.append(int(code))
        self.fields[self.focus_field] = b"".join(x.to_bytes(2, "little") for x in units).decode("utf-16-le", "surrogatepass")
        return True

    def post_key(self, hwnd, name, pids=None):
        self.calls.append(("post_key", hwnd, name))
        if name != "tab":
            raise ValueError("key ไม่รู้จัก: %r" % name)
        if not self._post_ok(hwnd, pids):
            return False
        self.posted.append(("key", name))
        if self.state == "login" and not self.u["post_ignored"] and not self.u["tab_no_move"] and self.focus_field == "username":
            self.focus_field = "password"
        return True

    def child_windows(self, hwnd):
        if hwnd == DIALOG_HWND and self.state == "import":
            W, pid, u = self.W, self.PID, self.u
            kids = [W(301, "Static", "File &name:", (670, 907, 724, 922), True, True, 1090, pid, DIALOG_HWND)]
            if not u["dlg_no_edit"]:
                kids += [W(302, "ComboBoxEx32", "", (729, 903, 1399, 927), True, True, 1148, pid, DIALOG_HWND),
                         W(self.EDIT_HWND, "Edit", "", (733, 908, 1379, 923), True, not u["dlg_edit_disabled"], 1148, pid, 302)]
                if u["dlg_dup_edit"]:
                    kids.append(W(307, "Edit", "", (733, 908, 1379, 923), True, True, 1148, pid, 302))
            kids += [W(304, "ComboBox", "", (1411, 903, 1599, 926), True, True, 1136, pid, DIALOG_HWND),
                     W(self.OPEN_HWND, "Button", "&Open", (1411, 932, 1499, 958), True, True, 1, pid, DIALOG_HWND),
                     W(self.CANCEL_HWND, "Button", "Cancel", (1511, 932, 1599, 958), True, True, 2, pid, DIALOG_HWND),
                     W(308, "Edit", "", (702, 129, 1297, 144), False, True, 41477, pid, DIALOG_HWND)]      # ช่องที่อยู่ (ซ่อน)
            return kids
        return super().child_windows(hwnd)

    def set_text(self, hwnd, text):
        self._act("set_text", hwnd, text)
        if hwnd == self.EDIT_HWND and self.state == "import" and not self.u["settext_noop"]:
            self.dlg_text = str(text)
        return 1

    def get_text(self, hwnd):
        self._act("get_text", hwnd)
        if hwnd == self.EDIT_HWND and self.state == "import":
            return self.dlg_text + ("x" if self.u["gettext_mismatch"] else "")
        return ""

    def click_button(self, hwnd):
        if self.state == "import" and hwnd in (self.OPEN_HWND, self.CANCEL_HWND):
            self._act("click_button", hwnd)
            if hwnd == self.OPEN_HWND:
                self._do_open()
            else:
                self.state, self.dialogs_now = "doc", []
            return
        super().click_button(hwnd)

    def _do_open(self):
        """กด Open: อ่านไฟล์จริงจากดิสก์ที่ช่อง File name ชี้ → โหลดแถวลงตาราง (ตามแฟล็กที่จำลองความผิดพลาด) · กล่องปิด หน้าต่างหลักกลับมาใช้งานได้"""
        u = self.u
        if u["open_no_effect"]:
            return
        path = self.dlg_text
        if not os.path.isfile(path):
            self.dialogs_now = [("Select File", ("The file name you typed was not found.",))]
            return
        if u["open_popup_window"]:       # ProMaxx เปิดป๊อปอัพ (เช่นเลือก Lot No.) แทนการเพิ่มแถว — กล่อง Select File ปิดแล้ว ตารางยังไม่เปลี่ยน
            self.popup = u["open_popup_window"]
            self.file_loaded = path
            self.state, self.dialogs_now = "doc", []
            return
        raw = open(path, "rb").read().decode("utf-8")
        rows = []
        for ln in raw.replace("\r\n", "\n").split("\n"):
            if not ln:
                continue
            f = ln.split("\t")
            rows.append({"sku": f[0], "name": "สินค้า " + f[0], "unit": "กล่อง", "qty": float(f[1]), "price": float(f[2]) if f[2] else 10.0})
        if u["open_loads_partial"] is not None:
            rows = rows[:u["open_loads_partial"]]
        if u["open_wrong_qty"] and rows:
            rows[0]["qty"] += 1
        if u["open_extra_row"]:
            rows.append({"sku": "999999", "name": "สินค้า 999999", "unit": "กล่อง", "qty": 1.0, "price": 10.0})
        if u["open_dup_row"] and rows:
            rows.append(dict(rows[0]))
        self.table, self.table_ready_at, self.file_loaded = rows, self.t + u["open_slow"], path
        self.state, self.dialogs_now = "doc", []
        if u["open_error_dialog"]:
            self.dialogs_now = [("SeniorSoft ProMaxx", (u["open_error_dialog"],))]

    def show_window_back(self, hwnd):
        self.calls.append(("show_window_back", hwnd))
        if hwnd == MAIN_HWND:
            self.hidden = False
            self.at_back = True

    def uia_act(self, hwnd, ids=(), ctype="", name="", rect=None, pattern=""):
        """Invoke (ปุ่ม) / Select (รายการ) — ไม่ผ่านเมาส์ จึงทำงานได้แม้หน้าต่างถูกซ่อน · ต้องพบเป้า 1 รายการพอดีที่พิกัดตรง (±2px) เหมือนของจริง"""
        self.calls.append(("uia_act", hwnd, pattern, ctype, tuple(ids), name, tuple(rect) if rect else None))
        if self.state == "import":
            self.acts_after_import += 1
        self._tick()
        if self.u["act_fails"]:
            return False, "UiaError: target count 0"
        if hwnd != MAIN_HWND:
            return False, "UiaError: hwnd"
        if {"Button": "invoke", "ListItem": "select", "TabItem": "select"}.get(ctype) != pattern:
            return False, "UiaError: pattern not allowed for this control type"
        hits = [e for e in self._els() if (not ids or e.id in ids) and e.type == ctype and (not name or e.name == name)
                and e.rect and rect and all(abs(a - b) <= 2 for a, b in zip(e.rect, rect))]
        if len(hits) != 1:
            return False, "UiaError: target count %d" % len(hits)
        e = hits[0]
        if not e.enabled:
            return False, "UiaError: target disabled"
        if self.u["act_no_effect"] or self.state == "import" or self.picker:
            return True, ""                      # หน้าต่างหลักถูกล็อกด้วยกล่องโมดัล / ไม่มีผล
        if self.u["act_wrong_target"] and e.type == "ListItem":
            e = [x for x in self._els() if x.type == "ListItem" and x.name == "เอกสารรับ"][0]
        self.acted.append((pattern, e.id or "%s:%s" % (e.type, e.name)))
        self._el_effect(e)
        if self.u["grab_fg_on_act"]:
            self.has_focus = True
            self.grab_times.append(round(self.t, 3))
        return True, ""

    def _click_picker(self, x, y):
        """คลิกในหน้าต่างรายการ (หน้าต่างหลักถูกล็อก — คลิกนอกปุ่ม/แถวไม่มีผล)"""
        rows = self._rows(self.picker["kind"])
        hits = [e for e in self._picker_els() if not e.offscreen and _contains(e.rect, x, y) and e.type in ("Button", "Custom", "Edit")
                and e.id not in ("uo_popupdw_dw_datatmp",)]
        if not hits:
            return True, ""
        e = min(hits, key=lambda h: (h.rect[2] - h.rect[0]) * (h.rect[3] - h.rect[1]))
        self.clicked.append(e.id or "%s:%s" % (e.type, e.name))
        if e.id.startswith("col1"):
            i = self.picker["edit"] if e.id == "col1" else int(e.id.split(":")[1]) - 1
            self.picker_log.append(("row", self.picker["kind"], rows[i]))
            if not self.u["pick_no_effect"]:
                j = (i + 1) % len(rows) if self.u["pick_wrong_row"] else i
                self.picker["sel"], self.picker["edit"] = j, j
        elif e.id == "cb_ok":
            self.picker_log.append(("ok", self.picker["kind"], self.picker["sel"]))
            if self.u["ok_no_effect"] or self.picker["sel"] is None:
                return True, ""
            val = rows[self.picker["sel"]]
            if self.u["ok_wrong_value"]:
                val = rows[0] if self.picker["sel"] != 0 else rows[1]
            if self.picker["kind"] == "type":
                self.vtype = val
                if self.u["type_resets_wh"]:
                    self.wh = DEFAULTS[self.letter_choice][1]
            else:
                self.wh = val
                if self.u["wh_resets_type"]:
                    self.vtype = DEFAULTS[self.letter_choice][0]
            if not self.u["ok_keeps_open"]:
                self.picker = None
        elif e.id == "cb_exit":
            self.picker_log.append(("exit", self.picker["kind"]))
            self.picker = None
        return True, ""


def make_uia(m, tmp, verified=True, specs=None, user="somchai", password="s3cret!pw", settings_kw=None, uia=None, log_path=None, **fake_kw):
    """สร้าง (Service, FakeWpfUI, Logger, Settings) · specs=None → ใช้ STEP_SPECS ที่ส่งมอบจริง (ตรวจ spec จริงด้วยตัวต่อปลอม)"""
    m.LOCATORS_VERIFIED = verified
    kw = dict(username=user, password=password, runs_dir=os.path.join(tmp, "runs"), log_path="", port=47831,
              import_dir=os.path.join(tmp, "import"))      # ไฟล์นำเข้า (รุ่น .6) เขียนใต้ tmp เสมอ — เทสห้ามเขียนลงโฟลเดอร์จริงของตัวช่วย
    kw.update(settings_kw or {})
    st = m.Settings(**kw)
    fake_kw.setdefault("start_state", "closed")
    ui = FakeWpfUI(m.WinInfo, m.MenuItem, m.UiaEl, uia=uia, user=user, password=password, **fake_kw)
    ui.W = m.WinInfo
    log = m.Logger(log_path, echo=False, keep=True)
    log.add_secret(st.password)
    svc = m.Service(st, ui, log, specs=specs, clock=ui.clock, sleep=ui.sleep)
    return svc, ui, log, st
