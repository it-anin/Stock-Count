# -*- coding: utf-8 -*-
"""
ตัวต่อปลอมของ ssmaxx.exe สำหรับเทส promaxx_helper บน Linux (ไม่มี Windows / ไม่มี ProMaxx จริง)

เป็น state machine ของหน้าต่างตามที่ผู้ใช้อธิบาย (3 พ.ย. 2026): เปิดโปรแกรม → หน้า Login → หน้าหลัก (มีเมนู เอกสารรับ/เอกสารจ่าย)
→ หน้าต่างเอกสาร (ปุ่ม I / O) → ปุ่ม "นำเข้าไฟล์เอกสาร" → หน้าต่างนำเข้า

⚠️ ชื่อ class/ข้อความ/พิกัดในไฟล์นี้ "สมมติ" เพื่อเทสตรรกะของตัวรันขั้นตอนเท่านั้น — ไม่ใช่ข้อมูลจริงของ ssmaxx.exe
   ข้อมูลจริงต้องมาจาก Gate 0 (ตรวจหน้าต่างจริง) · ห้ามเอาค่าในไฟล์นี้ไปใส่ STEP_SPECS ของ promaxx_helper.py

ฉีดความล้มเหลวด้วย kwargs ของ FakeUI (ดูใน __init__) · self.calls เก็บทุกการเรียกที่ "ลงมือทำ" (ACTING) ไว้ให้เทสตรวจลำดับ/จำนวน
"""
import os
import time

ACTING = ("launch", "type_text", "press_key", "click_at", "move_to", "click_button", "invoke_menu", "focus", "close_processes")

LOGIN = {"cls": "FNWNS3125", "title": "SeniorSoft"}
MAIN = {"cls": "FNWND3125"}
DOCWIN = {"cls": "FNWNS3125", "title": "^เอกสาร(รับ|จ่าย)$"}
IMPORTWIN = {"cls": "FNWNS3125", "title": "นำเข้า"}
IMPORT_BTN = {"cls": "Button", "text": "^นำเข้าไฟล์เอกสาร$"}

# ชุด spec เต็มสำหรับเทส (รูปแบบเดียวกับ STEP_SPECS ใน promaxx_helper.py)
SPECS = {
    "launch": {"post": {"win": LOGIN}, "post_timeout": 20},
    "login": {
        "pre": {"win": LOGIN},
        "actions": [
            {"do": "click", "target": {"kind": "point", "within": LOGIN, "child_cls": "pbdw125", "x": 0.72, "y": 0.2}},
            {"do": "type", "what": "username", "within": LOGIN},
            {"do": "click", "target": {"kind": "point", "within": LOGIN, "child_cls": "pbdw125", "x": 0.72, "y": 0.6}},
            {"do": "type", "what": "password", "within": LOGIN},
            {"do": "key", "key": "enter", "within": LOGIN},
        ],
        "post": {"all": [{"gone": LOGIN}, {"win": MAIN}]}, "post_timeout": 15,
    },
    "menu": {
        "pre": {"win": MAIN},
        "actions": [{"do": "click", "target": {"kind": "menu", "within": MAIN, "path": ["^{menu_th}$"]}}],
        "post": {"win": DOCWIN},
    },
    "doc-button": {
        "pre": {"win": DOCWIN},
        "actions": [{"do": "click", "target": {"kind": "control", "within": DOCWIN, "cls": "Button", "text": "^{letter}$", "via": "message"}}],
        "post": {"ctl": dict(IMPORT_BTN, within=DOCWIN)},
    },
    "import-button": {
        "pre": {"ctl": dict(IMPORT_BTN, within=DOCWIN)},
        "actions": [{"do": "click", "target": dict(IMPORT_BTN, kind="control", within=DOCWIN, via="mouse")}],
        "post": {"win": IMPORTWIN},
    },
}
# ขั้นตั้งประเภทเอกสาร/คลัง (promaxx_helper รุ่น .5) — ชุด Win32 ปลอมนี้ไม่มีช่องให้ตั้ง จึงเป็นขั้นที่ "ข้ามเสมอ" (skip_if ตรงตั้งแต่เริ่ม)
# เพื่อให้เทสเดิมของตรรกะตัวรัน (ลำดับขั้น · ด่าน · หลักฐาน) ยังวิ่งครบ STEP_ORDER ได้ · ของจริงของขั้นเหล่านี้ตรวจใน promaxx-helper-doctype.spec.js
for _n in ("doc-type-open", "doc-type-pick", "doc-type-ok", "warehouse-open", "warehouse-pick", "warehouse-ok"):
    SPECS[_n] = {"skip_if": {"win": DOCWIN}, "actions": [{"do": "wait", "sec": 0}], "post": {"win": DOCWIN}}


class FakeUI:
    PID = 4242

    def __init__(self, W, M, user="somchai", password="s3cret!pw", exe=r"C:\SeniorSoft ProMaxx\ssmaxx.exe", **flags):
        self.W, self.M = W, M
        self.user, self.password, self.exe = user, password, exe
        f = dict(existing_pids=[], blockers=[], fs=None, dpi=100, session=True, launch_delay=2.0, login_delay=1.0,
                 no_login_window=False, dialog_on_launch=None, crash_after_launch=False, no_menu=False, dup_menu=False,
                 focus_fails=False, click_drift=False, import_no_effect=False, dialog_after_menu=None, external_mutexes=(),
                 real_delay=0.0, login_dialog_echo_password=False, start_state="closed", start_doc_menu=None, start_letter=None,
                 dup_top=False, disabled_button=False, disabled_menu=False, menu_decoys=False, window_decoys=False,
                 rect_shift_until_focus=False, window_echo_password=False,
                 spawn_delay=0.0, pids_gap=None)      # spawn_delay = ตัวเปิดโปรแกรมช้า: โปรเซส ssmaxx โผล่หลังสั่งเปิดกี่วินาที · pids_gap = (จาก, ถึง) วินาทีหลังสั่งเปิดที่โปรเซสหายชั่วคราว
        unknown = set(flags) - set(f)
        if unknown:
            raise TypeError("flag ไม่รู้จัก: %s" % sorted(unknown))
        f.update(flags)
        self.f = f
        self.fs = set(f["fs"]) if f["fs"] is not None else {exe}
        self.calls = []
        self.t = 0.0
        self.state = f["start_state"]            # closed|launching|login|logging|main|doc|import|crashed
        self.launch_at = 0.0
        self.login_at = 0.0
        self.has_focus = f["start_state"] != "closed"
        self.fields = {"username": "", "password": ""}
        self.focus_field = None
        self.menu_choice = f["start_doc_menu"]    # "เอกสารรับ" | "เอกสารจ่าย"
        self.letter_choice = f["start_letter"]
        self.dialogs_now = []
        self.mutexes = set(f["external_mutexes"])
        self.shots = []
        self.acts_after_import = 0
        self.dump_calls = 0
        self.shifted = bool(f["rect_shift_until_focus"])     # หน้าต่างอยู่ผิดที่ (เช่นถูกย่อ) จนกว่า focus() จะกู้คืน

    # ── เวลาปลอม ────────────────────────────────────────────────
    def clock(self):
        return self.t

    def sleep(self, s):
        self.t += float(s)
        if self.f["real_delay"]:
            time.sleep(self.f["real_delay"])

    def _tick(self):
        f = self.f
        if self.state == "launching":
            if f["crash_after_launch"] and self.t >= self.launch_at + 7:
                self.state, self.dialogs_now = "closed", []
            elif self.t >= self.launch_at + f["launch_delay"]:
                if f["dialog_on_launch"]:
                    self.dialogs_now = [f["dialog_on_launch"]]
                    self.state = "blocked"
                elif not f["no_login_window"]:
                    self.state = "login"
        if self.state == "logging" and self.t >= self.login_at + f["login_delay"]:
            self.state = "main"

    def _act(self, name, *a):
        self.calls.append((name,) + a)
        if self.state == "import":
            self.acts_after_import += 1

    def acts(self):
        return [c[0] for c in self.calls if c[0] in ACTING]

    # ── โครงหน้าต่างตามสถานะ ───────────────────────────────────
    def _model(self):
        W0 = self.W
        self._tick()
        s, tops = self.state, []
        dx, dy = (400, 300) if self.shifted else (0, 0)

        def W(hwnd, cls, text, rect, visible, enabled, ctrl_id, pid, parent):
            r = (rect[0] + dx, rect[1] + dy, rect[2] + dx, rect[3] + dy)
            return W0(hwnd, cls, text, r, visible, enabled, ctrl_id, pid, parent)

        if s in ("login", "logging"):
            kids = [W(101, "pbdw125", "", (400, 230, 900, 480), True, True, 0, self.PID, 100)]
            if self.f["window_echo_password"] and self.fields["password"]:      # โปรแกรมสะท้อนรหัสที่พิมพ์กลับมาในหน้าต่าง (เทสป้องกันซ้อน)
                kids.append(W(102, "Static", "รหัสที่พิมพ์: " + self.fields["password"], (410, 485, 890, 499), True, True, 0, self.PID, 100))
            tops.append((W(100, "FNWNS3125", "SeniorSoft ProMaxx", (400, 200, 900, 500), True, True, 0, self.PID, 0), kids))
        if s in ("main", "doc", "import"):
            tops.append((W(200, "FNWND3125", "SeniorSoft ProMaxx", (0, 0, 1280, 720), True, True, 0, self.PID, 0), []))
            tooltip, hidden = ("เอกสารจ่าย", "เอกสารรับ") if self.f["window_decoys"] else ("tooltip", "hidden")
            tops.append((W(209, "FNWNS3125", tooltip, (10, 10, 20, 20), True, True, 0, self.PID, 0), []))      # เล็กเกินเกณฑ์ → ต้องถูกกรองทิ้ง
            tops.append((W(208, "FNWNS3125", hidden, (0, 0, 500, 400), False, True, 0, self.PID, 0), []))      # ไม่ visible → ต้องถูกกรองทิ้ง
            if self.f["dup_top"]:
                tops.append((W(201, "FNWND3125", "SeniorSoft ProMaxx (สำเนา)", (0, 0, 1280, 720), True, True, 0, self.PID, 0), []))
        if s in ("doc", "import") and self.menu_choice:
            en = not self.f["disabled_button"]
            kids = [W(212, "Button", "I", (320, 170, 360, 200), False, en, 0, self.PID, 210),      # visible=False โดยตั้งใจ (PowerBuilder คืน False ทั้งที่เห็น)
                    W(213, "Button", "O", (370, 170, 410, 200), True, en, 0, self.PID, 210)]
            if self.letter_choice:
                kids.append(W(214, "Button", "นำเข้าไฟล์เอกสาร", (320, 260, 520, 290), True, True, 0, self.PID, 210))
                if self.f["dup_menu"]:
                    kids.append(W(215, "Button", "นำเข้าไฟล์เอกสาร", (320, 300, 520, 330), True, True, 0, self.PID, 210))
            tops.append((W(210, "FNWNS3125", self.menu_choice, (300, 150, 900, 500), True, True, 0, self.PID, 0), kids))
        if s == "import":
            tops.append((W(220, "FNWNS3125", "นำเข้าไฟล์เอกสาร", (350, 200, 850, 450), True, True, 0, self.PID, 0), []))
        return tops

    # ── adapter: สภาพเครื่อง ─────────────────────────────────────
    def file_exists(self, path):
        return path in self.fs

    def pids(self, name):
        self._tick()
        if name != "ssmaxx.exe":
            return []
        if self.state in ("launching", "login", "logging", "main", "doc", "import", "blocked"):
            dt = self.t - self.launch_at
            if self.state == "launching" and dt < self.f["spawn_delay"]:
                return list(self.f["existing_pids"])          # ตัวเปิดโปรแกรมยังไม่ได้เปิด ssmaxx
            gap = self.f["pids_gap"]
            if gap and gap[0] <= dt < gap[1]:
                return list(self.f["existing_pids"])          # โปรเซสหายชั่วคราว (เช่นตัวเปิดโปรแกรมรีสตาร์ท ssmaxx)
            return [self.PID]
        return list(self.f["existing_pids"])

    def running_names(self, names):
        return sorted(n for n in names if n in self.f["blockers"])

    def session_ok(self):
        return self.f["session"]

    def dpi_percent(self):
        return self.f["dpi"]

    def acquire_mutex(self, name):
        if name in self.mutexes:
            return False
        self.mutexes.add(name)
        return True

    def release_mutex(self, name):
        self.mutexes.discard(name)

    def launch(self, exe, args, cwd):
        self._act("launch", exe, tuple(args), cwd)
        if exe not in self.fs:
            raise FileNotFoundError(exe)
        self.state, self.launch_at = "launching", self.t
        return self.PID

    def close_processes(self, pids):
        self._act("close_processes", tuple(pids))
        self.state = "closed"
        return len(list(pids))

    # ── adapter: หน้าต่าง ────────────────────────────────────────
    def top_windows(self, pids):
        if self.PID not in set(pids or []):
            return []
        return [t for t, _ in self._model()]

    def child_windows(self, hwnd):
        for t, kids in self._model():
            if t.hwnd == hwnd:
                return list(kids)
        return []

    def menus(self, hwnd):
        M = self.M
        self._tick()
        if hwnd != 200 or self.state not in ("main", "doc", "import") or self.f["no_menu"]:
            return []
        en = not self.f["disabled_menu"]
        items = [M(("ไฟล์",), 0, True, True), M(("ไฟล์", "ออก"), 399, True, False),
                 M(("เอกสารรับ",), 301, en, False), M(("เอกสารจ่าย",), 302, en, False),
                 M(("รายงาน",), 0, True, True), M(("รายงาน", "R01"), 401, True, False)]
        if self.f["menu_decoys"]:
            # หัวข้อที่มีเมนูย่อย (id=0 คลิกไม่ได้) ชื่อเดียวกับเป้า + เมนูย่อยลึกกว่าที่ขึ้นต้นด้วยชื่อเป้า — ต้องไม่ถูกนับเป็นเป้า
            items += [M(("เอกสารรับ",), 0, True, True), M(("เอกสารจ่าย",), 0, True, True),
                      M(("เอกสารรับ", "ย้อนหลัง"), 305, True, False), M(("เอกสารจ่าย", "ย้อนหลัง"), 306, True, False)]
        if self.f["dup_menu"]:
            items.append(M(("เอกสารรับ",), 303, True, False))
        return items

    def foreground_pid(self):
        return self.PID if self.has_focus else 1

    def focus(self, hwnd):
        self._act("focus", hwnd)
        if not self.f["focus_fails"]:
            self.has_focus = True
            self.shifted = False

    def dialogs(self, pids):
        self._tick()
        return list(self.dialogs_now) if self.PID in set(pids or []) else []

    # ── adapter: input ───────────────────────────────────────────
    def type_text(self, text):
        self._act("type_text", text)
        if self.state == "login" and self.has_focus and self.focus_field:
            self.fields[self.focus_field] = text

    def press_key(self, key):
        self._act("press_key", key)
        if key == "enter" and self.state == "login":
            if self.fields["username"] == self.user and self.fields["password"] == self.password:
                self.state, self.login_at = "logging", self.t
            else:
                echo = (" (%s)" % self.fields["password"]) if self.f["login_dialog_echo_password"] else ""
                self.dialogs_now = [("SeniorSoft ProMaxx", ("User หรือ Password ไม่ถูกต้อง" + echo,))]

    def move_to(self, x, y):
        self._act("move_to", int(x), int(y))
        return True, ""

    def click_at(self, x, y, pids=None):
        self._act("click_at", int(x), int(y))
        self._tick()
        if self.f["click_drift"]:
            return False, "เมาส์ถูกขยับก่อนคลิก"
        for top, kids in reversed(self._model()):          # หน้าต่างท้ายรายการอยู่บนสุด (z-order)
            r = top.rect
            if not (top.visible and r[0] <= x <= r[2] and r[1] <= y <= r[3]):
                continue
            if self.state == "login":
                self.focus_field = "username" if y < 330 else "password"
                return True, ""
            for k in kids:
                kr = k.rect
                if kr[0] <= x <= kr[2] and kr[1] <= y <= kr[3] and k.text == "นำเข้าไฟล์เอกสาร":
                    if not self.f["import_no_effect"]:
                        self.state = "import"
                    return True, ""
            return True, ""
        return False, "ใต้เมาส์เป็นหน้าต่างของโปรแกรมอื่น"

    def click_button(self, hwnd):
        self._act("click_button", hwnd)
        if hwnd in (212, 213) and self.state == "doc":
            self.letter_choice = "I" if hwnd == 212 else "O"
        elif hwnd == 214 and self.state == "doc":
            self.state = "import"

    def invoke_menu(self, hwnd, menu_id):
        self._act("invoke_menu", hwnd, menu_id)
        if hwnd == 200 and self.state in ("main", "doc") and menu_id in (301, 302):
            self.state = "doc"
            self.menu_choice = "เอกสารรับ" if menu_id == 301 else "เอกสารจ่าย"
            self.letter_choice = None
            if self.f["dialog_after_menu"]:
                self.dialogs_now = [self.f["dialog_after_menu"]]

    # ── adapter: หลักฐาน ─────────────────────────────────────────
    def screenshot(self, path, rect=None, marks=()):
        self.shots.append({"path": path, "marks": list(marks)})
        os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
        with open(path, "wb") as f:
            f.write(b"\x89PNG fake")
        return True

    def _d(self, w):
        return {"hwnd": w.hwnd, "parent": w.parent, "pid": w.pid, "cls": w.cls, "text": w.text, "rect": list(w.rect),
                "visible": w.visible, "enabled": w.enabled, "ctrl_id": w.ctrl_id, "style": "0x0"}

    def dump(self, pids):
        self.dump_calls += 1
        wins = []
        for t, kids in self._model():
            w = self._d(t)
            w["menu"] = [{"path": list(m.path), "id": m.id, "enabled": m.enabled, "submenu": m.submenu} for m in self.menus(t.hwnd)]
            w["children"] = [self._d(k) for k in kids]
            wins.append(w)
        return {"time": "fake", "foreground": {"pid": self.foreground_pid()}, "cursor": [0, 0], "dpi": self.f["dpi"], "note": "",
                "windows": wins, "others": [{"pid": 1, "exe": "notepad.exe", "cls": "Notepad", "text": "ไม่ใช่ของ ssmaxx"}]}

    def env_info(self, proc_name, candidates, exe_path):
        return {"fake": "yes", "proc": proc_name, "candidates": len(candidates)}


def make(m, tmp, verified=True, specs=None, user="somchai", password="s3cret!pw", settings_kw=None, ui_user=None, ui_password=None, log_path=None, **fake_kw):
    """สร้าง (Service, FakeUI, Logger, Settings) พร้อมใช้ · specs=None → ชุดเต็ม SPECS · specs='shipped' → STEP_SPECS ที่ส่งมอบ"""
    m.LOCATORS_VERIFIED = verified
    kw = dict(username=user, password=password, runs_dir=os.path.join(tmp, "runs"), log_path="", port=47831)
    kw.update(settings_kw or {})
    st = m.Settings(**kw)
    ui = FakeUI(m.WinInfo, m.MenuItem, user=ui_user if ui_user is not None else user,
                password=ui_password if ui_password is not None else password, **fake_kw)   # ui_* = รหัสที่ "โปรแกรมจริง" ยอมรับ (ต่างจากที่ helper ถือ = รหัสผิด)
    log = m.Logger(log_path, echo=False, keep=True)
    log.add_secret(st.password)
    use = None if specs == "shipped" else (SPECS if specs is None else specs)
    svc = m.Service(st, ui, log, specs=use, clock=ui.clock, sleep=ui.sleep)
    return svc, ui, log, st
