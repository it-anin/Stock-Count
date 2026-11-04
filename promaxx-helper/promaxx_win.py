# -*- coding: utf-8 -*-
r"""
ตัวต่อ Windows ของ PromaxxHelper — ส่วนเดียวที่แตะหน้าต่าง/เมาส์/คีย์บอร์ดจริง

แยกจาก promaxx_helper.py เพื่อให้ตรรกะ (ตรวจ request, ลำดับขั้นตอน, pre/post-condition) เทสบน Linux ได้ด้วยตัวต่อปลอม
  - import win32*/psutil/PIL ภายใน WinAdapter เท่านั้น (ไฟล์นี้ import บน Linux ได้ แต่สร้าง WinAdapter ไม่ได้)
  - รับคลาส WinInfo/MenuItem จากแกนเข้ามา (ไม่ import promaxx_helper → ไม่มี circular และไม่โหลดโมดูลซ้ำตอนรันเป็น __main__)

เทคนิคคัดลอกมาจากบอทเดิม auto-r01/bot-export/auto_r01_export.py (พิสูจน์แล้วกับ PowerBuilder 12.5 ของ ProMaxx) — ไม่ import ข้าม exe:
  - force_foreground (AttachThreadInput) · _type_unicode (SendInput KEYEVENTF_UNICODE) · _promaxx_dialogs · mutex · ปิดด้วย WM_CLOSE ก่อน terminate
  - ช่องกรอกของ PowerBuilder ต้องเป็น keystroke จริง (ห้าม paste/WM_SETTEXT) · เนื้อใน DataWindow (pbdw*) ต้องคลิกด้วย mouse_event
  - ไม่กรอง IsWindowVisible ของ control ลูก (PB คืน False ทั้งที่เห็นอยู่) · ห้ามเรียก SetProcessDpiAwareness (เมาส์ไม่ขยับ) · Scaling ต้อง 100%
ต่างจากบอทเดิม: คลิกด้วยข้อความ (BM_CLICK/WM_COMMAND) ใช้ PostMessage ไม่ใช่ SendMessage — ปุ่มที่เปิด dialog แบบ modal จะบล็อก SendMessage จนกว่า dialog ปิด
⚠️ ไฟล์นี้ยังไม่เคยรันบน Windows จริง (เขียนบน Linux) — ตรวจกับเครื่องจริงใน Gate 0 ก่อนเชื่อผล (ดู README.md §ตรวจหน้าต่างจริง)
"""
import ctypes
import os
import subprocess
import sys
import time

KEYEVENTF_KEYUP = 0x0002
VK_KEYS = {"enter": 0x0D, "tab": 0x09, "esc": 0x1B}
MF_BYPOSITION = 0x400

# ── SendInput (ต้องมี MOUSEINPUT ใน union ให้ sizeof(INPUT) = 40 บน 64-bit ไม่งั้น SendInput เงียบ) ──
_PUL = ctypes.POINTER(ctypes.c_ulong)


class _KEYBDINPUT(ctypes.Structure):
    _fields_ = [("wVk", ctypes.c_ushort), ("wScan", ctypes.c_ushort), ("dwFlags", ctypes.c_ulong),
                ("time", ctypes.c_ulong), ("dwExtraInfo", _PUL)]


class _MOUSEINPUT(ctypes.Structure):
    _fields_ = [("dx", ctypes.c_long), ("dy", ctypes.c_long), ("mouseData", ctypes.c_ulong),
                ("dwFlags", ctypes.c_ulong), ("time", ctypes.c_ulong), ("dwExtraInfo", _PUL)]


class _INPUTUNION(ctypes.Union):
    _fields_ = [("ki", _KEYBDINPUT), ("mi", _MOUSEINPUT)]


class _INPUT(ctypes.Structure):
    _fields_ = [("type", ctypes.c_ulong), ("u", _INPUTUNION)]


MAIN_TITLE = "SeniorSoft ProMaxx"      # ชื่อหน้าต่างหลักของ ssmaxx.exe (ตรวจจริง) — ใช้หาหน้าต่างที่ถูกซ่อนค้าง


def _norm_menu(text):
    text = (text or "").split("\t", 1)[0].replace("&", "")
    return " ".join(text.split())


class WinAdapter:
    def __init__(self, win_cls, menu_cls, log, uia_cls=None):
        import win32api
        import win32con
        import win32gui
        import win32process
        import psutil
        self.api, self.con, self.gui, self.proc, self.ps = win32api, win32con, win32gui, win32process, psutil
        self.WinInfo, self.MenuItem, self.log = win_cls, menu_cls, log
        self._mutex = {}
        self._uia_cls = uia_cls
        self._uia = None
        self._init_ctypes()

    # ── UIA (ssmaxx.exe เป็น WPF — อ่านผ่าน promaxx_uia.PsUia · อ่านอย่างเดียว) ──
    def _uia_backend(self):
        if self._uia is None:
            if self._uia_cls is None:
                raise RuntimeError("ไม่ได้ส่ง uia_cls ให้ WinAdapter")
            import promaxx_uia
            self._uia = promaxx_uia.PsUia(self._uia_cls, self.log)
        return self._uia

    def uia_find(self, hwnd, ids=(), ctype="", name=""):
        return self._uia_backend().find(hwnd, ids=ids, ctype=ctype, name=name)

    def uia_dump(self, hwnd, max_nodes=1500):
        return self._uia_backend().dump(hwnd, max_nodes=max_nodes)

    def uia_stats(self):
        return self._uia.stats() if self._uia else None

    def uia_act(self, hwnd, ids=(), ctype="", name="", rect=None, pattern=""):
        """สั่งปุ่ม (Invoke) / รายการ (Select) แบบไม่ใช้เมาส์ — ใช้เฉพาะตอนหน้าต่างถูกซ่อน (รุ่น 2026-11-04.5) · คืน (สำเร็จ, เหตุผล)
        สั่งได้เฉพาะชนิด/pattern ที่ promaxx_uia.ACT_PATTERNS อนุญาต และต้องพบเป้า 1 รายการพอดีที่พิกัดตรง"""
        try:
            self._uia_backend().act(hwnd, ids=ids, ctype=ctype, name=name, rect=rect, pattern=pattern)
            return True, ""
        except Exception as e:      # noqa: BLE001  (UiaError และข้อผิดพลาดอื่น — ผู้เรียกหยุด ไม่ลองซ้ำ)
            return False, "%s: %s" % (type(e).__name__, str(e)[:160])

    # ── ctypes ─────────────────────────────────────────────────
    def _init_ctypes(self):
        from ctypes import wintypes
        self.wt = wintypes
        u, k = ctypes.windll.user32, ctypes.windll.kernel32
        self.u, self.k = u, k
        vp, ci, cu = ctypes.c_void_p, ctypes.c_int, ctypes.c_uint
        u.GetMenu.argtypes, u.GetMenu.restype = [vp], vp
        u.GetMenuItemCount.argtypes, u.GetMenuItemCount.restype = [vp], ci
        u.GetSubMenu.argtypes, u.GetSubMenu.restype = [vp, ci], vp
        u.GetMenuItemID.argtypes, u.GetMenuItemID.restype = [vp, ci], cu
        u.GetMenuStringW.argtypes, u.GetMenuStringW.restype = [vp, cu, ctypes.c_wchar_p, ci, cu], ci
        u.GetMenuState.argtypes, u.GetMenuState.restype = [vp, cu, cu], cu
        u.WindowFromPoint.argtypes, u.WindowFromPoint.restype = [wintypes.POINT], vp
        u.GetCursorPos.argtypes, u.GetCursorPos.restype = [ctypes.POINTER(wintypes.POINT)], ctypes.c_bool
        u.SetCursorPos.argtypes, u.SetCursorPos.restype = [ci, ci], ctypes.c_bool
        u.GetSystemMetrics.argtypes, u.GetSystemMetrics.restype = [ci], ci
        k.CreateMutexW.argtypes, k.CreateMutexW.restype = [vp, ctypes.c_bool, ctypes.c_wchar_p], vp
        k.WaitForSingleObject.argtypes, k.WaitForSingleObject.restype = [vp, ctypes.c_uint32], ctypes.c_uint32
        k.ReleaseMutex.argtypes = [vp]
        k.CloseHandle.argtypes = [vp]

    # ── ข้อมูลเครื่อง/โปรเซส ───────────────────────────────────
    def file_exists(self, path):
        return os.path.isfile(path)

    def pids(self, name):
        want, out = (name or "").lower(), []
        for p in self.ps.process_iter(["pid", "name"]):
            try:
                if (p.info["name"] or "").lower() == want:
                    out.append(int(p.info["pid"]))
            except Exception:
                continue
        return out

    def running_names(self, names):
        want, found = {n.lower() for n in names}, set()
        for p in self.ps.process_iter(["name"]):
            try:
                n = (p.info["name"] or "").lower()
                if n in want:
                    found.add(n)
            except Exception:
                continue
        return sorted(found)

    def session_ok(self):
        """มีหน้าจอ (desktop) ของผู้ใช้ให้คลิกไหม — session 0 (service) หรือจอล็อกอยู่ = ไม่มี"""
        try:
            sid = ctypes.c_uint32()
            self.k.ProcessIdToSessionId(os.getpid(), ctypes.byref(sid))
            if sid.value == 0:
                return False
            return bool(self.gui.GetForegroundWindow())
        except Exception:
            return True

    def dpi_percent(self):
        try:
            return int(ctypes.windll.shcore.GetScaleFactorForDevice(0))   # 100 = 100%
        except Exception:
            return None

    def acquire_mutex(self, name):
        try:
            h = self.k.CreateMutexW(None, False, name)
            if not h:
                return True          # สร้าง mutex ไม่ได้ = ไม่ขวางงาน (เหมือนบอทเดิม)
            r = self.k.WaitForSingleObject(h, 0)
            if r in (0x0, 0x80):     # WAIT_OBJECT_0 / WAIT_ABANDONED (ตัวก่อนตายค้าง = ได้ล็อกต่อ)
                self._mutex[name] = h
                return True
            self.k.CloseHandle(h)
            return False
        except Exception as e:      # noqa: BLE001
            self.log("สร้าง mutex ไม่ได้ (%s) — ทำงานต่อโดยไม่ล็อก" % type(e).__name__)
            return True

    def release_mutex(self, name):
        h = self._mutex.pop(name, None)
        if h:
            try:
                self.k.ReleaseMutex(h)
                self.k.CloseHandle(h)
            except Exception:
                pass

    def launch(self, exe, args, cwd):
        # cwd = โฟลเดอร์โปรแกรม (PowerBuilder ต้องการ working dir ถูกต้องเพื่อหา INI/DLL)
        return subprocess.Popen([exe] + list(args or ()), cwd=cwd or None).pid

    def close_processes(self, pids):
        """ปิดแบบสุภาพ (WM_CLOSE) ก่อน แล้วค่อย terminate · ใช้เฉพาะ --close-ssmaxx --allow-close"""
        n = 0
        for pid in list(pids or []):
            try:
                for t in self.top_windows([pid]):
                    try:
                        self.gui.PostMessage(t.hwnd, self.con.WM_CLOSE, 0, 0)
                    except Exception:
                        pass
                time.sleep(1.0)
                p = self.ps.Process(pid)
                if p.is_running():
                    p.terminate()
                    try:
                        p.wait(timeout=8)
                    except self.ps.TimeoutExpired:
                        p.kill()
                n += 1
            except self.ps.NoSuchProcess:
                n += 1
            except Exception as e:      # noqa: BLE001
                self.log("ปิด pid=%s ไม่ได้ (%s)" % (pid, type(e).__name__))
        return n

    # ── หน้าต่าง ────────────────────────────────────────────────
    def _pid_of(self, h):
        try:
            return int(self.proc.GetWindowThreadProcessId(h)[1])
        except Exception:
            return 0

    def _info(self, h, parent, pid):
        g = self.gui
        try:
            text = g.GetWindowText(h)
        except Exception:
            text = ""
        try:
            cls = g.GetClassName(h)
        except Exception:
            cls = ""
        try:
            rect = tuple(g.GetWindowRect(h))
        except Exception:
            rect = (0, 0, 0, 0)
        try:
            cid = int(g.GetDlgCtrlID(h))
        except Exception:
            cid = 0
        return self.WinInfo(hwnd=int(h), cls=cls, text=text, rect=rect, visible=bool(g.IsWindowVisible(h)),
                            enabled=bool(g.IsWindowEnabled(h)), ctrl_id=cid, pid=int(pid), parent=int(parent or 0))

    def top_windows(self, pids):
        want, out = set(pids or []), []

        def cb(h, _):
            try:
                pid = self._pid_of(h)
                if pid in want:
                    out.append(self._info(h, 0, pid))
            except Exception:
                pass
            return True
        try:
            self.gui.EnumWindows(cb, None)
        except Exception:
            pass
        return out

    def child_windows(self, hwnd):
        """ลูกหลานทั้งหมด (ไม่กรอง visible — PowerBuilder คืน False ทั้งที่เห็นอยู่)"""
        out, pid = [], self._pid_of(hwnd)

        def cb(h, _):
            try:
                out.append(self._info(h, self.gui.GetParent(h), pid))
            except Exception:
                pass
            return True
        try:
            self.gui.EnumChildWindows(hwnd, cb, None)
        except Exception:
            pass
        return out

    def menus(self, hwnd):
        out = []
        try:
            hm = self.u.GetMenu(hwnd)
            if hm:
                self._walk_menu(hm, (), out, 0)
        except Exception as e:      # noqa: BLE001
            self.log("อ่านเมนูไม่ได้ (%s)" % type(e).__name__)
        return out

    def _walk_menu(self, hm, path, out, depth):
        if depth > 6:
            return
        n = self.u.GetMenuItemCount(hm)
        for i in range(max(n, 0)):
            buf = ctypes.create_unicode_buffer(256)
            self.u.GetMenuStringW(hm, i, buf, 255, MF_BYPOSITION)
            text = _norm_menu(buf.value)
            iid = self.u.GetMenuItemID(hm, i)
            state = self.u.GetMenuState(hm, i, MF_BYPOSITION)
            enabled = not (state != 0xFFFFFFFF and (state & 0x3))      # MF_GRAYED | MF_DISABLED
            sub = self.u.GetSubMenu(hm, i)
            p = path + (text,)
            if sub:
                out.append(self.MenuItem(path=p, id=0, enabled=enabled, submenu=True))
                self._walk_menu(sub, p, out, depth + 1)
            elif text and iid not in (0, 0xFFFFFFFF):                   # 0 = separator
                out.append(self.MenuItem(path=p, id=int(iid), enabled=enabled, submenu=False))

    def foreground_pid(self):
        try:
            h = self.gui.GetForegroundWindow()
            return self._pid_of(h) if h else None
        except Exception:
            return None

    def _restore_if_iconic(self, hwnd):
        """กู้หน้าต่างกลับมาแสดง "เฉพาะเมื่อถูกย่ออยู่" — SW_RESTORE กับหน้าต่างที่ขยายเต็มจออยู่จะย่อมันกลับเป็นขนาดปกติ
        (บั๊กเดิมของ focus(): ProMaxx ที่ขยายเต็มจอถูกย่อทุกครั้งที่ต้องดึงขึ้นหน้า · แก้ 3 พ.ย. 2026 ผู้ใช้อนุญาต)"""
        g, c = self.gui, self.con
        try:
            if g.IsIconic(hwnd):
                g.ShowWindow(hwnd, c.SW_RESTORE)
        except Exception:
            pass

    def hide_window(self, hwnd):
        """ซ่อนหน้าต่าง (SW_HIDE) — โปรเซสยังทำงานต่อ · UIA ยังอ่านพิกัดและสั่งปุ่มได้ผ่าน hwnd (ตรวจจริง 4 พ.ย. 2026) · ไม่ส่งคีย์/คลิก"""
        self.gui.ShowWindow(hwnd, self.con.SW_HIDE)

    def show_window(self, hwnd):
        """แสดงหน้าต่างที่ถูกซ่อนกลับมา (ย่ออยู่ = SW_RESTORE) · ไม่ส่งคีย์/คลิก"""
        g, c = self.gui, self.con
        g.ShowWindow(hwnd, c.SW_RESTORE if g.IsIconic(hwnd) else c.SW_SHOW)

    def reveal_hidden(self, pids):
        """กู้หน้าต่างหลักของ ProMaxx ที่ถูกซ่อนค้าง (เช่นตัวช่วยถูกปิดกลางงานตอนซ่อนอยู่) → คืนจำนวนหน้าต่างที่แสดงกลับ"""
        n = 0
        for w in self.top_windows(pids):
            if not w.visible and (w.text or "") == MAIN_TITLE and "ssmaxx" in (w.cls or "").lower():
                try:
                    self.show_window(w.hwnd)
                    n += 1
                except Exception:      # noqa: BLE001
                    pass
        return n

    def focus(self, hwnd):
        """ดึงหน้าต่างขึ้นหน้าสุด (foreground) — ตรวจจริง 3 พ.ย. 2026: Windows บล็อก SetForegroundWindow จากโปรเซสที่ไม่ใช่ foreground
        (ปุ่มบน taskbar กะพริบแทน) ทั้งตอนทดสอบ (Claude อยู่หน้า) และตอนใช้งานจริง (เบราว์เซอร์อยู่หน้า) → ต้องผูกคิวอินพุตกับเธรด
        foreground เดิมและเธรดเป้าก่อน แล้ว BringWindowToTop + SetForegroundWindow (ลองแล้วได้ผล) · ไม่ได้ผลค่อย SwitchToThisWindow
          1) กู้เฉพาะหน้าต่างที่ถูกย่อ (SW_RESTORE กับหน้าต่างที่ขยายเต็มจอจะย่อมันกลับเป็นขนาดปกติ)
          2) ไม่เรียก SetForegroundWindow ก่อนผูกเธรด (ถูกบล็อกอยู่แล้วและทำให้ taskbar กะพริบ)
          3) ปลดการผูกเธรดใน finally เสมอ (เดิมถ้าขั้นกลางล้ม การผูกค้างอยู่)
        ไม่ส่งคีย์/คลิกใดๆ — เปลี่ยนแค่หน้าต่างที่อยู่ด้านหน้า"""
        g, u = self.gui, ctypes.windll.user32
        cur, attached = ctypes.windll.kernel32.GetCurrentThreadId(), []
        try:
            self._restore_if_iconic(hwnd)
            fg = g.GetForegroundWindow()
            threads = {self.proc.GetWindowThreadProcessId(fg)[0] if fg else 0, self.proc.GetWindowThreadProcessId(hwnd)[0]}
            for t in threads:
                if t and t != cur and u.AttachThreadInput(cur, t, True):
                    attached.append(t)
            for step in (g.BringWindowToTop, g.SetForegroundWindow):
                try:
                    step(hwnd)
                except Exception:
                    pass
            if self.foreground_pid() != self._pid_of(hwnd):
                u.SwitchToThisWindow(hwnd, True)
        except Exception:
            pass
        finally:
            for t in attached:
                try:
                    u.AttachThreadInput(cur, t, False)
                except Exception:
                    pass
        time.sleep(0.5)

    # ── input ────────────────────────────────────────────────────
    def type_text(self, text, per_char_delay=0.03):
        """พิมพ์เป็น Unicode keystroke จริง (ไม่ผ่าน keyboard layout · PB commit ค่าเข้าช่องได้) — ห้าม log ตัวอักษรที่พิมพ์"""
        send = ctypes.windll.user32.SendInput
        for ch in str(text):
            code = ord(ch)
            for up in (False, True):
                flags = 0x0004 | (KEYEVENTF_KEYUP if up else 0)     # KEYEVENTF_UNICODE
                ki = _KEYBDINPUT(0, code, flags, 0, None)
                inp = _INPUT(1, _INPUTUNION(ki=ki))                  # INPUT_KEYBOARD
                send(1, ctypes.byref(inp), ctypes.sizeof(_INPUT))
            time.sleep(per_char_delay)

    def press_key(self, name):
        vk = VK_KEYS.get(str(name).lower())
        if vk is None:
            raise ValueError("key ไม่รู้จัก: %r" % name)
        self.api.keybd_event(vk, 0, 0, 0)
        time.sleep(0.05)
        self.api.keybd_event(vk, 0, KEYEVENTF_KEYUP, 0)

    def _cursor(self):
        pt = self.wt.POINT()
        self.u.GetCursorPos(ctypes.byref(pt))
        return pt.x, pt.y

    def move_to(self, x, y):
        self.u.SetCursorPos(int(x), int(y))
        time.sleep(0.12)
        cx, cy = self._cursor()
        if abs(cx - int(x)) > 2 or abs(cy - int(y)) > 2:
            return False, "เมาส์ไม่อยู่ที่เป้า (ตอนนี้ %d,%d เป้า %d,%d)" % (cx, cy, x, y)
        return True, ""

    def click_at(self, x, y, pids=None):
        """คลิกซ้ายด้วยเมาส์จริง (mouse_event) — ใช้กับเนื้อใน DataWindow · คืน (สำเร็จ, เหตุผลถ้าไม่สำเร็จ)
        ตรวจ 2 อย่างก่อนกด: เมาส์อยู่ที่เป้าจริง และหน้าต่างใต้เมาส์เป็นของ ssmaxx (ไม่คลิกทะลุไปโปรแกรมอื่น)"""
        ok, why = self.move_to(x, y)
        if not ok:
            return False, why
        if pids:
            h = self.u.WindowFromPoint(self.wt.POINT(int(x), int(y)))
            if not h or self._pid_of(h) not in set(pids):
                return False, "ใต้เมาส์เป็นหน้าต่างของโปรแกรมอื่น"
        time.sleep(0.1)
        cx, cy = self._cursor()
        if abs(cx - int(x)) > 2 or abs(cy - int(y)) > 2:
            return False, "เมาส์ถูกขยับก่อนคลิก"
        self.api.mouse_event(self.con.MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0)
        time.sleep(0.05)
        self.api.mouse_event(self.con.MOUSEEVENTF_LEFTUP, 0, 0, 0, 0)
        return True, ""

    def click_button(self, hwnd):
        self.gui.PostMessage(hwnd, self.con.BM_CLICK, 0, 0)            # PostMessage ไม่ใช่ SendMessage (กันค้างเมื่อเปิด dialog modal)

    def invoke_menu(self, hwnd, menu_id):
        self.gui.PostMessage(hwnd, self.con.WM_COMMAND, int(menu_id), 0)

    # ── กล่องข้อความ ─────────────────────────────────────────────
    def dialogs(self, pids):
        """กล่องข้อความมาตรฐาน (#32770) ที่ ProMaxx แสดงอยู่ → [(title, (ข้อความ…))] · อ่านอย่างเดียว"""
        out, want = [], set(pids or [])
        if not want:
            return out

        def top_cb(h, _):
            try:
                if self._pid_of(h) not in want or self.gui.GetClassName(h) != "#32770" or not self.gui.IsWindowVisible(h):
                    return True
                texts = []

                def child_cb(c, __):
                    try:
                        if self.gui.GetClassName(c) == "Static":
                            t = " ".join(self.gui.GetWindowText(c).split())
                            if t:
                                texts.append(t)
                    except Exception:
                        pass
                    return True
                try:
                    self.gui.EnumChildWindows(h, child_cb, None)
                except Exception:
                    pass
                out.append((self.gui.GetWindowText(h), tuple(texts[:6])))
            except Exception:
                pass
            return True
        try:
            self.gui.EnumWindows(top_cb, None)
        except Exception:
            pass
        return out

    # ── หลักฐาน ─────────────────────────────────────────────────
    def screenshot(self, path, rect=None, marks=()):
        """จับภาพทั้งจอ (ทุกจอ) + วาดกรอบเขียว/กากบาทแดงตามพิกัดหน้าจอใน marks · คืน True/False"""
        try:
            from PIL import ImageDraw, ImageGrab
            img = ImageGrab.grab(all_screens=True)
            vx, vy = self.u.GetSystemMetrics(76), self.u.GetSystemMetrics(77)     # SM_XVIRTUALSCREEN / SM_YVIRTUALSCREEN
            d = ImageDraw.Draw(img)
            for m in marks:
                if m.get("type") == "rect":
                    l, t, r, b = m["rect"]
                    d.rectangle([l - vx, t - vy, r - vx, b - vy], outline=(0, 200, 0), width=3)
                elif m.get("type") == "point":
                    x, y = m["xy"][0] - vx, m["xy"][1] - vy
                    d.line([x - 25, y, x + 25, y], fill=(255, 0, 0), width=3)
                    d.line([x, y - 25, x, y + 25], fill=(255, 0, 0), width=3)
                    d.ellipse([x - 12, y - 12, x + 12, y + 12], outline=(255, 0, 0), width=3)
            if rect:
                img = img.crop((rect[0] - vx, rect[1] - vy, rect[2] - vx, rect[3] - vy))
            os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
            img.save(path)
            return True
        except Exception as e:      # noqa: BLE001
            self.log("จับภาพหน้าจอไม่ได้ (%s)" % type(e).__name__)
            return False

    def _as_dict(self, w):
        d = {"hwnd": w.hwnd, "parent": w.parent, "pid": w.pid, "cls": w.cls, "text": w.text, "rect": list(w.rect),
             "visible": w.visible, "enabled": w.enabled, "ctrl_id": w.ctrl_id}
        try:
            d["style"] = hex(self.gui.GetWindowLong(w.hwnd, self.con.GWL_STYLE) & 0xFFFFFFFF)
            d["exstyle"] = hex(self.gui.GetWindowLong(w.hwnd, self.con.GWL_EXSTYLE) & 0xFFFFFFFF)
        except Exception:
            pass
        return d

    def dump(self, pids):
        """ทุกหน้าต่างระดับบนของ pids + ลูกหลาน + เมนู HMENU · others = หน้าต่างอื่นที่เห็นอยู่ (ไว้ดูว่าหน้าต่างจริงเป็นของโปรเซสชื่ออะไร)"""
        want = set(pids or [])
        fg = None
        try:
            h = self.gui.GetForegroundWindow()
            fg = {"hwnd": int(h), "pid": self._pid_of(h), "cls": self.gui.GetClassName(h), "text": self.gui.GetWindowText(h)} if h else None
        except Exception:
            pass
        d = {"time": time.strftime("%Y-%m-%d %H:%M:%S"), "foreground": fg, "cursor": list(self._cursor()),
             "dpi": self.dpi_percent(), "note": "" if want else "ไม่มีโปรเซส ssmaxx — ดู others", "windows": [], "others": []}
        for t in self.top_windows(want):
            w = self._as_dict(t)
            w["menu"] = [{"path": list(m.path), "id": m.id, "enabled": m.enabled, "submenu": m.submenu} for m in self.menus(t.hwnd)]
            w["children"] = [self._as_dict(c) for c in self.child_windows(t.hwnd)]
            d["windows"].append(w)

        def cb(h, _):
            try:
                if self.gui.IsWindowVisible(h):
                    pid = self._pid_of(h)
                    text = self.gui.GetWindowText(h)
                    if pid not in want and text:
                        try:
                            exe = self.ps.Process(pid).name()
                        except Exception:
                            exe = "?"
                        d["others"].append({"hwnd": int(h), "pid": pid, "exe": exe, "cls": self.gui.GetClassName(h), "text": text})
            except Exception:
                pass
            return True
        try:
            self.gui.EnumWindows(cb, None)
        except Exception:
            pass
        return d

    # ── --find ───────────────────────────────────────────────────
    def _elevated(self, pid):
        try:
            import win32security
            hproc = self.api.OpenProcess(0x1000, False, pid)           # PROCESS_QUERY_LIMITED_INFORMATION
            tok = win32security.OpenProcessToken(hproc, win32security.TOKEN_QUERY)
            return bool(win32security.GetTokenInformation(tok, win32security.TokenElevation))
        except Exception:
            return None

    def env_info(self, proc_name, candidates, exe_path):
        info = {}
        info["python"] = "%s · %s" % (sys.version.split()[0], "exe" if getattr(sys, "frozen", False) else "สคริปต์")
        try:
            info["helper รันแบบ Administrator"] = bool(ctypes.windll.shell32.IsUserAnAdmin())
        except Exception:
            info["helper รันแบบ Administrator"] = "ไม่ทราบ"
        try:
            sid = ctypes.c_uint32()
            self.k.ProcessIdToSessionId(os.getpid(), ctypes.byref(sid))
            info["session ของ helper"] = sid.value
            info["session ของหน้าจอ (console)"] = int(self.k.WTSGetActiveConsoleSessionId())
        except Exception:
            pass
        fg = None
        try:
            h = self.gui.GetForegroundWindow()
            fg = "%s %r" % (self.gui.GetClassName(h), self.gui.GetWindowText(h)) if h else "(ไม่มี — จอล็อก/ไม่ใช่ session ผู้ใช้?)"
        except Exception:
            pass
        info["หน้าต่าง foreground"] = fg
        info["Display Scaling"] = ("%s%%" % self.dpi_percent()) if self.dpi_percent() else "ไม่ทราบ"
        if exe_path:
            info["PROMAXX_EXE_PATH"] = "%s · %s" % (exe_path, "พบไฟล์" if os.path.isfile(exe_path) else "ไม่พบไฟล์")
        for c in candidates:
            info["พาธที่ลองหา"] = info.get("พาธที่ลองหา", "") + ("%s=%s; " % (c, "พบ" if os.path.isfile(c) else "ไม่พบ"))
        rel = []
        for p in self.ps.process_iter(["pid", "name", "ppid"]):
            try:
                n = (p.info["name"] or "")
                if proc_name.lower() == n.lower() or "maxx" in n.lower() or "seniorsoft" in n.lower():
                    try:
                        exe = p.exe()
                    except Exception:
                        exe = "(อ่านพาธไม่ได้ — อาจรันสิทธิ์สูงกว่า)"
                    sid = ctypes.c_uint32()
                    self.k.ProcessIdToSessionId(int(p.info["pid"]), ctypes.byref(sid))
                    rel.append("%s pid=%s ppid=%s session=%s elevated=%s exe=%s" % (n, p.info["pid"], p.info["ppid"], sid.value,
                                                                                  self._elevated(int(p.info["pid"])), exe))
            except Exception:
                continue
        info["โปรเซสที่เกี่ยวกับ ProMaxx"] = " | ".join(rel) if rel else "(ไม่มี)"
        try:                                    # ตรวจว่าตัวอ่าน UIA (PowerShell) ใช้ได้บนเครื่องนี้ — อ่านอย่างเดียว ไม่แตะ ProMaxx
            r = self._uia_backend().ping()
            info["UIA (PowerShell)"] = "ใช้ได้ · PowerShell %s · %d ms" % (r.get("ps"), r.get("ms", 0))
        except Exception as e:      # noqa: BLE001
            info["UIA (PowerShell)"] = "ใช้ไม่ได้: %s %s" % (type(e).__name__, str(e)[:120])
        return info
