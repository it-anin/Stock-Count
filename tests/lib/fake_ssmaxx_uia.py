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
import os

from fake_ssmaxx import FakeUI

MAIN_CLS = "HwndWrapper[ssmaxx.exe;;1cfdec26-319d-446c-96b1-0854e2680fe1]"
TITLE = "SeniorSoft ProMaxx"
WIN = (-8, -8, 1928, 1040)
MAIN_HWND = 100
DIALOG_HWND = 300
LIST_ITEMS = ["Dashboard", "ตั้งค่า", "คลังสินค้า", "บุคคล", "เอกสารรับ", "เอกสารจ่าย", "Utility"]
SHIFT = 1900                      # หน้าเมนูถูกเลื่อนไปทางขวาเท่านี้หลังเปิดฟอร์ม
IMPORT_HELP = "นำเข้าไฟล์เอกสาร"

UFLAGS = dict(uia_fail_first=0, uia_always_fail=False, dup_login_btn=False, import_help=IMPORT_HELP, form_cls_override=None,
              top_disabled=False, focus_never=False, drift_on_move=False, start_focus_field="username", list_hidden=False,
              edit_unfocused=False,   # ช่องกรอกถูกสร้างแล้วแต่ไม่ได้รับโฟกัสแป้นพิมพ์ (เช่นหน้าต่างไม่ใช่ foreground)
              pass_plain=False)       # ช่อง cf_pass เป็น TextBox ธรรมดา ไม่ใช่ PasswordBox (พิมพ์รหัสลงช่องที่ไม่ปิดบังไม่ได้)


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

    # ── สถานะ → หน้าต่าง Win32 ──────────────────────────────────
    def _model(self):
        self._tick()
        s, tops = self.state, []
        if s in ("login", "logging", "main", "doc", "import"):
            en = not (s == "import" or self.u["top_disabled"])
            tops.append((self.W(MAIN_HWND, MAIN_CLS, TITLE, WIN, True, en, 0, self.PID, 0), []))
            tops.append((self.W(101, "HwndWrapper[ssmaxx.exe;;213f64ff]", "", (0, 0, 136, 39), False, True, 0, self.PID, 0), []))
            tops.append((self.W(102, "HwndWrapper[ssmaxx.exe;;8de39fac]", "MediaContextNotificationWindow", (0, 0, 0, 0), False, True, 0, self.PID, 0), []))
        if s == "import":
            tops.append((self.W(DIALOG_HWND, "#32770", "Select File", (482, 203, 1865, 962), True, True, 0, self.PID, 0), []))
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
            els.append(E("", "TabItem", (2, 85, 106, 111), name=self.menu_choice, cls="TabItem", parents=tab))
            fp = (("", "GroupBox"), ("", "UserObject"), ("", self._form_cls()), ("", "UserObject"), ("", "TabItem"), ("MDI_TAB", "TabControl"))
            dxi = 30 if self.drifted else 0
            for i, (bid, hp) in enumerate([("uo_tran_bt_import", self.u["import_help"]), ("uo_tran_bt_insert", "แทรกรายการ"),
                                           ("uo_tran_bt_delete", "ลบรายการ"), ("uo_tran_bt_cancel", "ยกเลิกรายการ"),
                                           ("uo_tran_bt_reference", "ดูรายละเอียดอ้างอิง")]):
                x0 = 1591 + 24 * i + (dxi if bid == "uo_tran_bt_import" else 0)
                els.append(E(bid, "Button", (x0, 256, x0 + 20, 276), name="Contactus", cls="Button", help=hp, parents=fp))
        return els

    # ── adapter: UIA ────────────────────────────────────────────
    def uia_find(self, hwnd, ids=(), ctype="", name=""):
        self.uia_calls += 1
        self.t += self.f.get("uia_cost", 0.0)
        if self.u["uia_always_fail"] or self.uia_calls <= self.u["uia_fail_first"]:
            raise RuntimeError("UIA ล้ม (ฉีดโดยเทส)")
        self._tick()
        if hwnd != MAIN_HWND:
            return []
        out = []
        for e in self._els():
            if ids and e.id not in ids:
                continue
            if ctype and e.type != ctype:
                continue
            if name and e.name != name:
                continue
            out.append(e)
        return out

    def uia_dump(self, hwnd, max_nodes=1500):
        return ["%s id=%s name=%r rect=%s off=%s" % (e.type, e.id, e.name, e.rect, e.offscreen) for e in self._els()][:max_nodes]

    def uia_stats(self):
        return {"calls": self.uia_calls, "totalMs": self.uia_calls * 10, "avgMs": 10, "maxMs": 10}

    # ── adapter: input ──────────────────────────────────────────
    def type_text(self, text):
        self._act("type_text", text)
        if self.state == "login" and self.has_focus and self.focus_field:
            self.fields[self.focus_field] = text
        else:
            self.misfires.append("type_unfocused")

    def move_to(self, x, y):
        self._act("move_to", int(x), int(y))
        if self.u["drift_on_move"] and self.stage == "form":
            self.drifted = True          # ผู้ใช้ขยับหน้าต่าง/เป้าเลื่อนระหว่างเตรียมคลิก
        return True, ""

    def click_at(self, x, y, pids=None):
        self._act("click_at", int(x), int(y))
        self._tick()
        if self.f["click_drift"]:
            return False, "เมาส์ถูกขยับก่อนคลิก"
        if not _contains(WIN, x, y):
            return False, "ใต้เมาส์เป็นหน้าต่างของโปรแกรมอื่น"
        if self.state == "import":
            return True, ""              # หน้าต่างหลักถูกล็อกด้วยกล่องโมดัล — คลิกไม่มีผล
        hits = [e for e in self._els() if not e.offscreen and _contains(e.rect, x, y) and e.type in ("Button", "ListItem", "Custom", "Edit")
                and e.id not in ("uo_login_panel",)]
        if not hits:
            return True, ""
        e = min(hits, key=lambda h: (h.rect[2] - h.rect[0]) * (h.rect[3] - h.rect[1]))
        self.clicked.append(e.id or "%s:%s" % (e.type, e.name))
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
        elif i == "uo_tran_bt_import":
            self.state = "import"
            self.dialogs_now = [("Select File", ("File &name:", "Files of &type:"))]
        elif i.startswith("uo_tran_bt_"):
            self.misfires.append(i)
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
