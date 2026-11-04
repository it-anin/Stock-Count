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
DIALOG_HWND = 300
LIST_ITEMS = ["Dashboard", "ตั้งค่า", "คลังสินค้า", "บุคคล", "เอกสารรับ", "เอกสารจ่าย", "Utility"]
SHIFT = 1900                      # หน้าเมนูถูกเลื่อนไปทางขวาเท่านี้หลังเปิดฟอร์ม
IMPORT_HELP = "นำเข้าไฟล์เอกสาร"
PICKER_HWND = 400
PICKER_CLS = "HwndWrapper[ssmaxx.exe;;d89a72ff-dc5b-4af7-a4b7-e38be0bcee7e]"
PICKER_TITLE = "sfw_winrespond"
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
              header_decoy=False)                 # มีฟิลด์ id เดียวกันอีกชุดใต้ "ฟอร์มคนละคลาส" (ฟอร์มโอนสินค้า) ที่หน้าตาเหมือนค่าที่ต้องการ


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
        self.minimized = bool(self.u["minimized"])
        self.hidden = bool(self.u["start_hidden"])     # หน้าต่างหลักถูกซ่อน (SW_HIDE) — โปรเซสยังทำงาน · UIA ยังอ่าน/สั่งผ่าน hwnd ได้
        self.acted = []                                # uia_act ที่ "มีผล" (pattern, ชนิด:ชื่อ/id)
        super().__init__(W, M, **flags)
        self.focus_field = self.u["start_focus_field"] if self.state == "login" else None
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
        if self.picker:                  # หน้าต่างรายการเป็นหน้าต่างระดับบนใหม่ (เต็มจอ) ของโปรเซสเดียวกัน
            tops.append((self.W(PICKER_HWND, PICKER_CLS, PICKER_TITLE, (-7, -7, 1927, 1087), True, True, 0, self.PID, 0), []))
            if self.u["two_pickers"]:
                tops.append((self.W(PICKER_HWND + 1, PICKER_CLS.replace("d89a72ff", "aaaaaaaa"), PICKER_TITLE, (-7, -7, 1927, 1087), True, True, 0, self.PID, 0), []))
        return tops

    def _tick(self):
        super()._tick()
        if self.state == "import" and not self.dialogs_now:
            self.dialogs_now = [("Select File", ("File &name:", "Files of &type:"))]

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
        fg = self.has_focus
        els.append(E("uo_login_panel", "Custom", (561, 231, 1360, 825), cls="UserObject", off=logged_in, parents=wnd))
        if self.focus_field == "username" and not logged_in:
            els.append(E("cf_empid", "Edit", (767, 485, 1151, 509), cls="TextBox", focused=fg and not self.u["edit_unfocused"], parents=lp))
        else:
            els.append(E("cf_empid:1", "Custom", (767, 485, 1151, 509), name="" if not logged_in else "034", cls="DWTextBlock", off=logged_in, parents=lp))
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
        return els

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
        return "%sBY0012611%05d" % (code, 872 if code == "ORCM" else 1)

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
        return decoy + [E("TRANNO:1", "Custom", (122, 200, 290, 220), name=self._number(), cls="DWTextBlock", parents=hp),
                E("SYSBRANCHID:1", "Custom", (122, 154, 290, 174), name="อนิน สาขาแยกชากค้อ", cls="DWTextBlock", parents=hp),
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
        pool = self._picker_els() if (hwnd == PICKER_HWND and self.picker) else self._els()
        return ["%s id=%s name=%r rect=%s off=%s" % (e.type, e.id, e.name, e.rect, e.offscreen) for e in pool][:max_nodes]

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
        super().focus(hwnd)
        if not self.f["focus_fails"]:
            self.minimized = False       # SW_RESTORE เฉพาะหน้าต่างที่ถูกย่อ (WinAdapter.focus)

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
            self.dialogs_now = [("Select File", ("File &name:", "Files of &type:"))]
        elif i.startswith("uo_tran_bt_"):
            self.misfires.append(i)

    # ── adapter: ซ่อน/แสดงหน้าต่าง + สั่งแบบไม่ใช้เมาส์ (รุ่น .5) ─────────
    def hide_window(self, hwnd):
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
    kw = dict(username=user, password=password, runs_dir=os.path.join(tmp, "runs"), log_path="", port=47831)
    kw.update(settings_kw or {})
    st = m.Settings(**kw)
    fake_kw.setdefault("start_state", "closed")
    ui = FakeWpfUI(m.WinInfo, m.MenuItem, m.UiaEl, uia=uia, user=user, password=password, **fake_kw)
    ui.W = m.WinInfo
    log = m.Logger(log_path, echo=False, keep=True)
    log.add_secret(st.password)
    svc = m.Service(st, ui, log, specs=specs, clock=ui.clock, sleep=ui.sleep)
    return svc, ui, log, st
