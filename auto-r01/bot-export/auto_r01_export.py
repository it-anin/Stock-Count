r"""
AutoR01Export - ส่งออก R01.102 (Allstock.CSV) จาก Seniorsoft ProMaxx "รอบเดียว" ให้ auto-r01

สำเนาจากบอท it-anin/bot-export (seniorsoft_login.py @ 434be0d · 22 ก.ย. 2026) แล้วปรับเป็นงานของ auto-r01:
  - ทำรอบเดียวแล้วจบ (ต้นฉบับวนทุก 5 นาที 08:00–20:50)
  - ไม่อัป Supabase เลย — auto_r01_import.py อ่านไฟล์นี้แล้วอัปขึ้น Firestore อย่างเดียว
  - รหัสผ่าน ProMaxx อ่านจาก .env / ตัวแปรระบบ ไม่ฝังในโค้ด (repo Stock-Count เป็น PUBLIC)
  - ไม่ขับ ProMaxx ซ้อนกับบอทอื่น: มี ProMaxx / ตัววนของ bot-export / ตัวเองอีกตัว เปิดอยู่ = exit 3 ทันที
  - จบแล้วปิด ProMaxx ที่เปิดไว้ (ตัววน 08:00 และ BOT05106 ต้องเจอเครื่องที่ไม่มี ProMaxx ค้าง)
  - พิมพ์ชื่อไฟล์ชั่วคราวไม่ซ้ำ (AR01<เวลา>.CSV) แทน Allstock.CSV แล้วไล่หาทั่วโฟลเดอร์ผู้ใช้ ย้ายเป็น Allstock.CSV
    และนับว่าสำเร็จเฉพาะเมื่อไฟล์อยู่ที่ปลายทางจริง — ต้นฉบับพิมพ์ Allstock.CSV แล้วกด Yes ทับไฟล์ชื่อเดียวกัน
    ในโฟลเดอร์ที่หน้าต่าง Save จำไว้ (28 ก.ย. 2026 ทับไฟล์ของโปรเจกต์อื่นมาแล้ว) และรายงานสำเร็จแม้หาไฟล์ไม่เจอ
ขั้นตอนคลิก ProMaxx (ช่วง "Helpers" ถึง step_select_file) เหมือนต้นฉบับทุกบรรทัด
ต้นฉบับแก้บั๊กคลิกเมื่อไรต้องพอร์ตมาเอง — ความรู้เรื่องหน้าต่าง/ปุ่ม/Select File dialog อยู่ใน CLAUDE.md ข้างไฟล์นี้

วิธีรัน:
    AutoR01Export.exe --save-dir "<โฟลเดอร์>"   auto-r01 เรียกแบบนี้ (ค่าปกติ %USERPROFILE%\Desktop\run-upload-stock)
    AutoR01Export.exe --version                 พิมพ์รุ่นแล้วจบ ไม่เปิด ProMaxx (ใช้ตรวจว่าวางไฟล์ถูกรุ่น)

exit code: 0 ส่งออกสำเร็จ · 1 ส่งออกไม่สำเร็จ · 2 ตั้งค่าไม่ครบ/ตัวเลือกผิด · 3 มีบอทอื่นหรือ ProMaxx เปิดอยู่ (ไม่ได้ทำอะไร)
"""

import os
import time
import sys
import ctypes
import subprocess
import threading
import win32gui
import win32con
import win32api
import win32process
import psutil
import pyautogui

pyautogui.FAILSAFE = False
pyautogui.PAUSE = 0.2

# ─── เขียน log ลงไฟล์ข้างๆ EXE (ไว้ debug เครื่องอื่น) ───
def _app_dir():
    if getattr(sys, "frozen", False):       # รันเป็น EXE (PyInstaller)
        return os.path.dirname(sys.executable)
    return os.path.dirname(os.path.abspath(__file__))

class _Tee:
    def __init__(self, *streams):
        self.streams = streams
    def write(self, data):
        for s in self.streams:
            try:
                s.write(data); s.flush()
            except Exception:
                pass
    def flush(self):
        for s in self.streams:
            try:
                s.flush()
            except Exception:
                pass

# auto-r01 เรียกโดยส่ง stdout ลงไฟล์ (ไม่ใช่ console) — บังคับ UTF-8
# ไม่งั้น Python ใช้ cp874 แล้วบรรทัดที่มีตัวอักษรนอก cp874 ถูกทิ้งทั้งบรรทัด (ui() กลืน error ไว้)
for _s in (sys.__stdout__, sys.__stderr__):
    try:
        if _s and not _s.isatty():
            _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

LOG_NAME = "auto_r01_export_log.txt"
# หน้าจอจริง (สำหรับข้อความสรุปที่ผู้ใช้ทั่วไปอ่าน) — แยกจาก log รายละเอียด
_console_out = sys.__stdout__
_logf = None


def _setup_log():
    """print() รายละเอียดทั้งหมด → ไฟล์ log ข้าง exe · เก็บรอบก่อนไว้ 1 รุ่น (.1)
    เรียกหลังเช็ค --version แล้ว ไม่ใช่ตอน import (ต้นฉบับเปิดตอน import ด้วยโหมด "w" = log รอบก่อนหายทุกครั้ง)"""
    global _logf
    try:
        path = os.path.join(_app_dir(), LOG_NAME)
        if os.path.exists(path):
            try:
                os.replace(path, path + ".1")
            except OSError:
                pass
        _logf = open(path, "w", encoding="utf-8")
        _logf.write(f"=== run {time.strftime('%Y-%m-%d %H:%M:%S')} ===\n")
        sys.stdout = _logf                        # print() รายละเอียดทั้งหมด → ลง log file เท่านั้น
        sys.stderr = _Tee(sys.__stderr__, _logf)  # error/traceback → โชว์บนหน้าจอด้วย + เก็บ log
    except Exception as e:
        print(f"เปิด log file ไม่ได้: {e}")


def ui(msg=""):
    """ข้อความสรุป 'ภาษาคน' สำหรับผู้ใช้ทั่วไป — แสดงบนหน้าจอ และบันทึกลง log ด้วย
    ใช้เฉพาะอักษรไทย+ASCII (เลี่ยง emoji/สัญลักษณ์พิเศษ กัน console บางเครื่อง encode ไม่ได้)"""
    text = str(msg)
    try:
        if _console_out:
            _console_out.write(text + "\n")
            _console_out.flush()
    except Exception:
        pass
    if _logf:
        try:
            _logf.write("[จอ] " + text + "\n")
            _logf.flush()
        except Exception:
            pass

# ประวัติรุ่น (แก้โค้ดแล้วเปลี่ยนเลขนี้ทุกครั้ง — ใช้ตรวจด้วย --version ว่าวางไฟล์ถูกรุ่น)
#   2026-09-28.2  ชื่อไฟล์ชั่วคราวไม่ซ้ำ + ไล่หาไฟล์ทั้งโฟลเดอร์ผู้ใช้ (หลังทับไฟล์ Grabmart-U)
#   2026-09-28.4  เก็บกล่องข้อความของ ProMaxx ตั้งแต่ตอนโผล่ ไว้จดตอนล้ม (.3 จดตอนจบ ไม่ทัน)
#   2026-09-29.1  ดับเบิลคลิก: รอกด Enter ไม่เกิน 60 วินาทีแล้วปิดเอง · รันจาก PowerShell/cmd ไม่รอเลย
VERSION = "2026-09-29.1"
CLOSE_PROMPT_SEC = 60      # ดับเบิลคลิกเอง: รอกด Enter ไม่เกินนี้แล้วปิดหน้าต่างเอง
# ⛔ ห้ามใส่ค่าจริงในไฟล์นี้ — repo Stock-Count เป็น PUBLIC · main() อ่านจาก PROMAXX_USERNAME / PROMAXX_PASSWORD
USERNAME   = ""
PASSWORD   = ""
TARGET_PROC = "promaxxreport.exe"
LOGIN_CLS   = "FNWNS3125"   # หน้าต่าง Login
MENU_CLS    = "FNWND3125"   # หน้าต่างหลัก Report
EXE_PATH    = r"C:\SeniorSoft ProMaxx\promaxxreport.exe"  # path โปรแกรม (ทับได้ด้วย PROMAXX_EXE_PATH)
# โฟลเดอร์ปลายทางที่จะเซฟไฟล์ CSV — auto-r01 ส่ง --save-dir มาให้ตรงกับโฟลเดอร์ที่มันอ่าน
# ⚠ ห้ามใช้ root ไดรฟ์ (เช่น C:\Reports) — PowerBuilder 12.5 เซฟลงไม่ได้ (legacy app)
#   ให้ใช้โฟลเดอร์ใต้ user profile เท่านั้น (Documents / Desktop ฯลฯ)
SAVE_DIR    = os.path.join(os.path.expanduser("~"), "Desktop", "run-upload-stock")
SAVE_NAME   = "Allstock.CSV"   # ชื่อไฟล์ที่จะเซฟ (พิมพ์ทั้งชื่อ+นามสกุลลงช่อง File name ตรงๆ — นามสกุลต้องเป็น .CSV ตัวใหญ่ ไม่งั้นโปรแกรมไม่เซฟ; โปรแกรมพิมพ์ underscore ไม่ได้ จึงไม่ใช้ All_stock)
BOT_STARTED_PROCESSES = set()      # PID ของ promaxxreport.exe ที่บอทเปิดเอง
# ค่าเริ่มต้นของ close_promaxx() — main() เรียกแบบ all_instances=True เองอยู่แล้ว
CLOSE_ALL_PROMAXX  = True

# ─── เฉพาะสำเนานี้ (auto-r01) ───
EXPORT_ATTEMPTS = 2            # ลอง "สร้างรายงาน → บันทึก" ได้กี่ครั้งในรอบเดียว (เปิดโปรแกรม/login ครั้งเดียว)
RETRY_PAUSE_SEC = 30
MUTEX_NAME = "Local\\AninAutoR01Export"   # กันตัวส่งออกของ auto-r01 รันซ้อนกันเอง
# บอทอื่นที่ขับ ProMaxx บนเครื่องเดียวกัน — เจอตัวไหนรันอยู่ = ไม่เริ่มงาน (exit 3)
#   SeniorsoftExport.exe = ตัววนทุก 5 นาทีของ it-anin/bot-export (08:00–20:50)
OTHER_BOT_PROCS = ("seniorsoftexport.exe",)
_INSTANCE_MUTEX = None
EXIT_OK, EXIT_FAILED, EXIT_CONFIG, EXIT_BUSY = 0, 1, 2, 3


# ────────────────────────────────────────────
# Helpers
# ────────────────────────────────────────────

def find_window_by(cls=None, title_kw=None, proc=None, must_visible=True,
                   min_size=50, timeout=30):
    """หา top-level window ที่ตรงเงื่อนไข"""
    print(f"รอหน้าต่าง cls={cls!r} title~={title_kw!r} ...")
    for attempt in range(timeout):
        result = []
        def cb(hwnd, _):
            if must_visible and not win32gui.IsWindowVisible(hwnd):
                return
            if cls and win32gui.GetClassName(hwnd) != cls:
                return
            title = win32gui.GetWindowText(hwnd)
            if title_kw and title_kw.lower() not in title.lower():
                return
            if proc:
                try:
                    _, pid = win32process.GetWindowThreadProcessId(hwnd)
                    pname = psutil.Process(pid).name().lower()
                    if proc.lower() not in pname:
                        return
                except Exception:
                    return
            rect = win32gui.GetWindowRect(hwnd)
            w = rect[2] - rect[0]
            h = rect[3] - rect[1]
            if min_size and (w < min_size or h < min_size):
                # ถ้า minimized (-32000) ให้ผ่าน แต่ต้องเป็น promaxxreport
                if rect[0] != -32000:
                    return
            result.append((hwnd, rect))
        win32gui.EnumWindows(cb, None)
        if result:
            hwnd, rect = result[0]
            print(f"  พบ hwnd={hwnd} rect={rect}")
            return hwnd
        if attempt % 5 == 0 and attempt > 0:
            print(f"  รอ... {attempt}/{timeout}s")
        time.sleep(1)
    return None


def force_foreground(hwnd):
    """บังคับ foreground ด้วย AttachThreadInput"""
    try:
        win32gui.ShowWindow(hwnd, win32con.SW_RESTORE)
        win32gui.SetForegroundWindow(hwnd)
    except Exception:
        pass
    try:
        cur  = ctypes.windll.kernel32.GetCurrentThreadId()
        fg   = win32gui.GetForegroundWindow()
        fgt, _ = win32process.GetWindowThreadProcessId(fg)
        tgt, _ = win32process.GetWindowThreadProcessId(hwnd)
        ctypes.windll.user32.AttachThreadInput(cur, fgt, True)
        ctypes.windll.user32.AttachThreadInput(cur, tgt,  True)
        win32gui.ShowWindow(hwnd, win32con.SW_RESTORE)
        win32gui.SetForegroundWindow(hwnd)
        ctypes.windll.user32.AttachThreadInput(cur, fgt, False)
        ctypes.windll.user32.AttachThreadInput(cur, tgt,  False)
    except Exception:
        pass
    time.sleep(0.5)


def click_and_type(x, y, text):
    pyautogui.click(x, y)
    time.sleep(0.25)
    pyautogui.hotkey("ctrl", "a")
    time.sleep(0.1)
    pyautogui.press("delete")
    time.sleep(0.1)
    pyautogui.typewrite(text, interval=0.08)


def _set_clipboard(text):
    """คัดลอก text ลง Windows clipboard (ไม่ต้องใช้ pyperclip)

    สำคัญ: ต้องตั้ง restype/argtypes ของ GlobalAlloc/GlobalLock/SetClipboardData
    เป็น pointer (c_void_p) ไม่งั้นบน Python 64-bit handle จะถูกตัดเหลือ 32-bit
    → GlobalLock คืน NULL → memmove ลง address 0 → access violation
    """
    CF_UNICODETEXT = 13
    GMEM_MOVEABLE  = 0x0002
    k = ctypes.windll.kernel32
    u = ctypes.windll.user32
    k.GlobalAlloc.restype  = ctypes.c_void_p
    k.GlobalAlloc.argtypes = [ctypes.c_uint, ctypes.c_size_t]
    k.GlobalLock.restype   = ctypes.c_void_p
    k.GlobalLock.argtypes  = [ctypes.c_void_p]
    k.GlobalUnlock.argtypes = [ctypes.c_void_p]
    u.SetClipboardData.restype  = ctypes.c_void_p
    u.SetClipboardData.argtypes = [ctypes.c_uint, ctypes.c_void_p]

    text_bytes = (text + '\0').encode('utf-16-le')
    hMem = k.GlobalAlloc(GMEM_MOVEABLE, len(text_bytes))
    if not hMem:
        raise OSError("GlobalAlloc failed")
    p = k.GlobalLock(hMem)
    if not p:
        k.GlobalFree(hMem)
        raise OSError("GlobalLock failed")
    ctypes.memmove(p, text_bytes, len(text_bytes))
    k.GlobalUnlock(hMem)
    if not u.OpenClipboard(0):
        k.GlobalFree(hMem)
        raise OSError("OpenClipboard failed")
    u.EmptyClipboard()
    if u.SetClipboardData(CF_UNICODETEXT, hMem):
        hMem = None   # ระบบเป็นเจ้าของ handle แล้ว ห้าม free
    u.CloseClipboard()
    if hMem:
        k.GlobalFree(hMem)


# ── พิมพ์ข้อความเป็น Unicode keystroke จริง (ผ่าน SendInput KEYEVENTF_UNICODE) ──
# ดีกว่า paste (ไม่ commit) และ typewrite (เพี้ยนตาม keyboard layout ไทย):
#   - เป็น keystroke จริง → fire WM_CHAR/EN_CHANGE → PB dialog commit ชื่อไฟล์เข้า buffer
#   - ส่ง Unicode codepoint ตรงๆ → ไม่ขึ้นกับ keyboard layout (ไทย/อังกฤษ ก็ได้ตัวอักษรถูก)
_PUL = ctypes.POINTER(ctypes.c_ulong)
class _KEYBDINPUT(ctypes.Structure):
    _fields_ = [("wVk", ctypes.c_ushort), ("wScan", ctypes.c_ushort),
                ("dwFlags", ctypes.c_ulong), ("time", ctypes.c_ulong),
                ("dwExtraInfo", _PUL)]
class _MOUSEINPUT(ctypes.Structure):   # ต้องมีใน union ให้ sizeof(INPUT) ถูก (40 bytes บน 64-bit)
    _fields_ = [("dx", ctypes.c_long), ("dy", ctypes.c_long),
                ("mouseData", ctypes.c_ulong), ("dwFlags", ctypes.c_ulong),
                ("time", ctypes.c_ulong), ("dwExtraInfo", _PUL)]
class _INPUTUNION(ctypes.Union):
    _fields_ = [("ki", _KEYBDINPUT), ("mi", _MOUSEINPUT)]
class _INPUT(ctypes.Structure):
    _fields_ = [("type", ctypes.c_ulong), ("u", _INPUTUNION)]

def _type_unicode(text, per_char_delay=0.03):
    INPUT_KEYBOARD    = 1
    KEYEVENTF_UNICODE = 0x0004
    KEYEVENTF_KEYUP   = 0x0002
    SendInput = ctypes.windll.user32.SendInput

    def _send(code, up):
        flags = KEYEVENTF_UNICODE | (KEYEVENTF_KEYUP if up else 0)
        ki = _KEYBDINPUT(0, code, flags, 0, None)
        inp = _INPUT(INPUT_KEYBOARD, _INPUTUNION(ki=ki))
        SendInput(1, ctypes.byref(inp), ctypes.sizeof(_INPUT))

    for ch in text:
        code = ord(ch)
        _send(code, False)   # key down
        _send(code, True)    # key up
        time.sleep(per_char_delay)


def find_small_buttons(parent_hwnd):
    """หาปุ่มขนาด 12-35px ทั้งหมดใน window เรียงซ้ายขวา (ไม่รวม scrollbar)"""
    btns = []
    def cb(hwnd, _):
        if not win32gui.IsWindowVisible(hwnd):
            return
        if win32gui.GetClassName(hwnd) != "Button":
            return
        r = win32gui.GetWindowRect(hwnd)
        bw, bh = r[2]-r[0], r[3]-r[1]
        if 12 <= bw <= 35 and 12 <= bh <= 35:
            btns.append((r[0], hwnd, r))
    try:
        win32gui.EnumChildWindows(parent_hwnd, cb, None)
    except Exception:
        pass
    btns.sort()
    return [(hwnd, r) for _, hwnd, r in btns]


def click_foreground(hwnd_parent, x, y):
    """SetForegroundWindow แล้วคลิก — ป้องกันคลิกผิด window"""
    try:
        win32gui.SetForegroundWindow(hwnd_parent)
    except Exception:
        pass
    time.sleep(0.3)
    pyautogui.click(x, y)


# ────────────────────────────────────────────
# Step 0: เปิดโปรแกรม promaxxreport.exe
# ────────────────────────────────────────────

def is_promaxx_running():
    """เช็คว่ามี process promaxxreport เปิดอยู่หรือยัง"""
    for p in psutil.process_iter(["name"]):
        try:
            if "promaxxreport" in (p.info["name"] or "").lower():
                return True
        except Exception:
            continue
    return False


def _matching_promaxx_hwnds(pid):
    """คืน list ของ hwnd ที่เป็นของ process id ที่กำหนด"""
    matches = []
    def cb(hwnd, _):
        try:
            _, hwnd_pid = win32process.GetWindowThreadProcessId(hwnd)
            if hwnd_pid == pid and win32gui.IsWindow(hwnd):
                r = win32gui.GetWindowRect(hwnd)
                if r[2] - r[0] > 5 and r[3] - r[1] > 5:
                    matches.append(hwnd)
        except Exception:
            pass
    try:
        win32gui.EnumWindows(cb, None)
    except Exception:
        pass
    return matches


def _all_promaxx_pids():
    """คืน set ของ pid ทุกตัวที่เป็น promaxxreport.exe (ไม่ว่าใครเปิด)"""
    pids = set()
    for p in psutil.process_iter(["pid", "name"]):
        try:
            if "promaxxreport" in (p.info["name"] or "").lower():
                pids.add(p.info["pid"])
        except Exception:
            continue
    return pids


def close_promaxx(all_instances=CLOSE_ALL_PROMAXX):
    """ปิดโปรแกรม promaxxreport.exe โดยส่ง WM_CLOSE ให้หน้าต่างก่อนแล้วค่อย terminate
    all_instances=True  → ปิดทุก process promaxxreport (รวมตัวที่ผู้ใช้เปิดค้างไว้ก่อนบอทรัน)
    all_instances=False → ปิดเฉพาะตัวที่บอทเปิดเอง (BOT_STARTED_PROCESSES)"""
    targets = set(BOT_STARTED_PROCESSES)
    if all_instances:
        targets |= _all_promaxx_pids()

    if not targets:
        ui("ไม่พบโปรแกรม Seniorsoft ที่ต้องปิด — ข้าม")
        return False

    closed = False
    for pid in list(targets):
        try:
            proc = psutil.Process(pid)
            if proc.name().lower() != "promaxxreport.exe":
                BOT_STARTED_PROCESSES.discard(pid)
                continue

            # 1) ปิดหน้าต่างที่เกี่ยวข้องก่อน (ให้โปรแกรมปิดแบบสะอาด)
            for hwnd in _matching_promaxx_hwnds(pid):
                try:
                    if win32gui.IsWindow(hwnd):
                        win32gui.ShowWindow(hwnd, win32con.SW_RESTORE)
                        win32gui.PostMessage(hwnd, win32con.WM_CLOSE, 0, 0)
                        print(f"ส่ง WM_CLOSE ให้ hwnd={hwnd} ของ pid={pid}")
                except Exception:
                    pass
            time.sleep(1.0)

            # 2) ถ้ายังมี process อยู่ ให้ terminate แบบ force
            try:
                proc = psutil.Process(pid)
                if proc.is_running():
                    print(f"ปิด process ที่บอทเปิดเอง: pid={pid}")
                    ui("กำลังปิดโปรแกรม Seniorsoft ที่บอทเปิดเอง...")
                    proc.terminate()
                    try:
                        proc.wait(timeout=8)
                    except psutil.TimeoutExpired:
                        proc.kill()
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                pass

            BOT_STARTED_PROCESSES.discard(pid)
            closed = True

        except (psutil.NoSuchProcess, psutil.AccessDenied):
            BOT_STARTED_PROCESSES.discard(pid)
        except Exception as e:
            print(f"close_promaxx error: {e}")

    if closed:
        ui("ปิดโปรแกรม Seniorsoft เรียบร้อยแล้ว")
    return closed


def launch_program():
    """เปิด promaxxreport.exe ถ้ายังไม่เปิด แล้วรอหน้า Login ปรากฏ"""
    if is_promaxx_running():
        print("promaxxreport เปิดอยู่แล้ว — ข้ามการเปิดโปรแกรม")
        return True

    if not os.path.exists(EXE_PATH):
        print(f"ไม่พบไฟล์โปรแกรม: {EXE_PATH}")
        print("แก้ค่า EXE_PATH ให้ตรงกับเครื่องนี้")
        sys.exit(1)

    print(f"เปิดโปรแกรม: {EXE_PATH}")
    # cwd = โฟลเดอร์โปรแกรม (PowerBuilder ต้องการ working dir ถูกต้องเพื่อหา INI/DLL)
    proc = subprocess.Popen([EXE_PATH], cwd=os.path.dirname(EXE_PATH))
    BOT_STARTED_PROCESSES.add(proc.pid)

    # รอหน้า Login ปรากฏ (find_window_by ใน step_login จะรอซ้ำอีกชั้น)
    print("รอโปรแกรมโหลด ...")
    hwnd = find_window_by(cls=LOGIN_CLS, proc=TARGET_PROC, timeout=60)
    if not hwnd:
        print("เปิดโปรแกรมแล้วแต่ไม่พบหน้า Login ภายใน 60s")
        sys.exit(1)
    print("โปรแกรมพร้อม Login")
    return True


# ────────────────────────────────────────────
# Step 1: Login
# ────────────────────────────────────────────

def step_login():
    hwnd = find_window_by(cls=LOGIN_CLS, proc=TARGET_PROC, timeout=30)
    if not hwnd:
        print("ไม่พบหน้าต่าง Login — เปิดโปรแกรม Seniorsoft แล้วรันใหม่")
        sys.exit(1)

    rect = win32gui.GetWindowRect(hwnd)
    x0, y0, x1, y1 = rect
    w = x1 - x0
    h = y1 - y0
    print(f"Login window: {w}x{h} at ({x0},{y0})")

    force_foreground(hwnd)

    print("กรอก Username ...")
    click_and_type(x0 + int(w * 0.72), y0 + int(h * 0.35), USERNAME)

    print("กรอก Password ...")
    click_and_type(x0 + int(w * 0.72), y0 + int(h * 0.50), PASSWORD)

    print("กด Sign In ...")
    force_foreground(hwnd)
    pyautogui.press("enter")
    time.sleep(0.5)
    pyautogui.click(x0 + int(w * 0.50), y0 + int(h * 0.67))
    time.sleep(1)
    print("Login เสร็จ")


# ────────────────────────────────────────────
# Step 2: คลิกปุ่มดาว
# ────────────────────────────────────────────

def step_click_star():
    print("รอหน้าต่าง Report Seniorsoft ProMaxx ...")
    hwnd = find_window_by(cls=MENU_CLS, proc=TARGET_PROC, timeout=20)
    if not hwnd:
        print("ไม่พบหน้าต่าง Report")
        return False

    # restore ถ้า minimized และรอให้ window วาดตัวเสร็จ
    win32gui.ShowWindow(hwnd, win32con.SW_RESTORE)
    time.sleep(2.0)
    force_foreground(hwnd)
    time.sleep(0.5)

    rect = win32gui.GetWindowRect(hwnd)
    x0, y0, x1, y1 = rect
    w = x1 - x0
    h = y1 - y0
    print(f"Report window: {w}x{h} at ({x0},{y0})")

    # หาปุ่มเล็ก 20x20 ทั้งหมด เรียงซ้ายขวา — 4 ปุ่มแรกคือ toolbar icons
    small_btns = find_small_buttons(hwnd)
    # กรองเฉพาะ 4 ปุ่มที่อยู่ติดกัน (ปุ่ม toolbar จะ x ห่างกันราว 20-25px)
    toolbar = []
    for bh, r in small_btns:
        if not toolbar:
            toolbar.append((bh, r))
        elif r[0] - toolbar[-1][1][0] < 50:   # อยู่ติดกัน
            toolbar.append((bh, r))
        else:
            if len(toolbar) < 4:
                toolbar = [(bh, r)]  # เริ่มกลุ่มใหม่

    print(f"พบ toolbar group: {len(toolbar)} ปุ่ม")
    for i, (bh, r) in enumerate(toolbar):
        print(f"  [{i}] hwnd={bh} center=({(r[0]+r[2])//2},{(r[1]+r[3])//2})")

    if len(toolbar) >= 3:
        star_hwnd, star_rect = toolbar[2]  # ดาว = ตัวที่ 3 จากซ้าย
        cx = (star_rect[0] + star_rect[2]) // 2
        cy = (star_rect[1] + star_rect[3]) // 2
        print(f"คลิกปุ่มดาว at ({cx},{cy})")
        click_foreground(hwnd, cx, cy)
        time.sleep(0.2)
        # BM_CLICK เป็น backup
        win32api.SendMessage(star_hwnd, win32con.BM_CLICK, 0, 0)
    else:
        star_x = x1 - int(w * 0.22)
        star_y = y0 + int(h * 0.10)
        print(f"fallback คลิก ({star_x},{star_y})")
        click_foreground(hwnd, star_x, star_y)

    time.sleep(0.8)
    return True, hwnd, rect


# ────────────────────────────────────────────
# Step 3: คลิก R01.102
# ────────────────────────────────────────────

def step_click_r01102(hwnd, rect):
    x0, y0, x1, y1 = rect
    w = x1 - x0

    # หา list panel = Button visible ขนาดใหญ่ (>200x100) ทางซ้าย (<40% ของ window)
    panels = []
    def find_list(child, _):
        if not win32gui.IsWindowVisible(child):
            return
        if win32gui.GetClassName(child) != "Button":
            return
        r = win32gui.GetWindowRect(child)
        bw, bh = r[2]-r[0], r[3]-r[1]
        if bw > 200 and bh > 100 and r[0] < x0 + w * 0.4:
            panels.append((r[0], r))
    win32gui.EnumChildWindows(hwnd, find_list, None)
    panels.sort()

    if panels:
        list_rect = panels[0][1]
        lx0, ly0, lx1, ly1 = list_rect
        click_x = (lx0 + lx1) // 2
        click_y = ly0 + 65   # ข้าม header ~28px + search box ~28px
        print(f"List panel: {list_rect}")
        print(f"คลิก R01.102 at ({click_x},{click_y})")
    else:
        click_x = x0 + int(w * 0.18)
        click_y = rect[1] + int((rect[3] - rect[1]) * 0.40)
        print(f"Fallback R01.102 at ({click_x},{click_y})")

    click_foreground(hwnd, click_x, click_y)
    time.sleep(1.5)
    print("เลือก R01.102 เสร็จ")


# ────────────────────────────────────────────
# Step 4: กดปุ่มสร้างรายงาน
# ────────────────────────────────────────────

def step_create_report(hwnd):
    """หาปุ่ม 'สร้างรายงาน' แล้วคลิก"""
    print("หาปุ่ม สร้างรายงาน ...")

    # ค้นใน child ทั้งหมด — ไม่กรอง visibility เพราะ PowerBuilder มักคืน False
    found = []
    def cb(child, _):
        if win32gui.GetClassName(child) != "Button":
            return
        txt = win32gui.GetWindowText(child)
        if "สร้างรายงาน" in txt:
            r = win32gui.GetWindowRect(child)
            w = r[2] - r[0]
            h = r[3] - r[1]
            if w > 5 and h > 5:   # มีขนาดจริง (ไม่ใช่ hidden ขนาด 0)
                found.append((child, r))

    win32gui.EnumChildWindows(hwnd, cb, None)

    if not found:
        print("ไม่พบปุ่ม สร้างรายงาน ใน child — ลองค้น top-level windows ...")
        # ค้นใน top-level windows ของ promaxxreport.exe ทั้งหมด
        def top_cb(w2, _):
            try:
                _, pid = win32process.GetWindowThreadProcessId(w2)
                if "promaxxreport" not in psutil.Process(pid).name().lower():
                    return
            except Exception:
                return
            def cb2(child, _):
                if win32gui.GetClassName(child) != "Button":
                    return
                txt = win32gui.GetWindowText(child)
                if "สร้างรายงาน" in txt:
                    r = win32gui.GetWindowRect(child)
                    if r[2]-r[0] > 5 and r[3]-r[1] > 5:
                        found.append((child, r))
            try:
                win32gui.EnumChildWindows(w2, cb2, None)
            except Exception:
                pass
        win32gui.EnumWindows(top_cb, None)

    if not found:
        print("ไม่พบปุ่ม สร้างรายงาน")
        return

    btn_hwnd, btn_rect = found[0]
    if btn_rect[0] < -500:
        print(f"ปุ่ม สร้างรายงาน rect={btn_rect} ดูเหมือน minimize — restore ก่อน")
        win32gui.ShowWindow(hwnd, win32con.SW_RESTORE)
        time.sleep(0.5)
        r2 = win32gui.GetWindowRect(btn_hwnd)
        if r2[0] > -500:
            btn_rect = r2
    cx = (btn_rect[0] + btn_rect[2]) // 2
    cy = (btn_rect[1] + btn_rect[3]) // 2
    print(f"พบปุ่ม สร้างรายงาน rect={btn_rect}  คลิก ({cx},{cy})")

    win32gui.SetForegroundWindow(hwnd)
    time.sleep(0.3)
    pyautogui.click(cx, cy)
    time.sleep(2.0)   # รอ popup เงื่อนไขการสร้างรายงาน ขึ้นมา
    print("กด สร้างรายงาน เสร็จ")


# ────────────────────────────────────────────
# Step 5: popup เงื่อนไขการสร้างรายงาน
#   → กดดินสอ (เลือกคลัง) → กด ตกลง
# ────────────────────────────────────────────

def find_popup(title_kw="เงื่อนไขการสร้างรายงาน", timeout=15):
    """รอ popup FNWNS3125 ที่มีชื่อตามกำหนด"""
    print(f"รอ popup '{title_kw}' ...")
    for _ in range(timeout):
        result = []
        def cb(hwnd, _):
            if win32gui.GetClassName(hwnd) != "FNWNS3125":
                return
            if title_kw in win32gui.GetWindowText(hwnd):
                r = win32gui.GetWindowRect(hwnd)
                if r[2]-r[0] > 50 and r[3]-r[1] > 50:
                    result.append((hwnd, r))
        win32gui.EnumWindows(cb, None)
        if result:
            hwnd, r = result[0]
            print(f"  พบ popup hwnd={hwnd} rect={r}")
            return hwnd, r
        time.sleep(1)
    return None, None


def step_popup_condition():
    hwnd, rect = find_popup()
    if not hwnd:
        print("ไม่พบ popup")
        return

    x0, y0, x1, y1 = rect
    w = x1 - x0
    h = y1 - y0

    # ปุ่มดินสออยู่แถว "เลือกคลัง" — x=84%, y=31% (ยืนยันจาก grid image)
    pencil_x = x0 + int(w * 0.84)
    pencil_y = y0 + int(h * 0.31)
    print(f"คลิกดินสอ at ({pencil_x},{pencil_y})")

    win32gui.SetForegroundWindow(hwnd)
    time.sleep(0.4)
    ctypes.windll.user32.SetCursorPos(pencil_x, pencil_y)
    time.sleep(0.3)
    win32gui.SetForegroundWindow(hwnd)
    time.sleep(0.2)
    win32api.mouse_event(win32con.MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0)
    time.sleep(0.05)
    win32api.mouse_event(win32con.MOUSEEVENTF_LEFTUP, 0, 0, 0, 0)
    time.sleep(1.0)

    # รอ dialog เลือกคลัง
    print("รอ dialog เลือกคลัง ...")
    wh_hwnd = None
    wh_rect = None
    for _ in range(10):
        def wh_cb(wh, _):
            nonlocal wh_hwnd, wh_rect
            if win32gui.GetClassName(wh) == "FNWNS3125":
                if "เลือกคลัง" in win32gui.GetWindowText(wh):
                    r = win32gui.GetWindowRect(wh)
                    if r[2]-r[0] > 50:
                        wh_hwnd = wh
                        wh_rect = r
        win32gui.EnumWindows(wh_cb, None)
        if wh_hwnd:
            print(f"  พบ dialog เลือกคลัง rect={wh_rect}")
            break
        time.sleep(0.5)

    if wh_hwnd:
        # หา DataWindow แล้วคลิก header "All"
        dw_hwnd = None
        dw_rect = None
        def wh_dw_cb(child, _):
            nonlocal dw_hwnd, dw_rect
            if win32gui.GetClassName(child) != "pbdw125":
                return
            if not win32gui.IsWindowVisible(child):
                return
            r = win32gui.GetWindowRect(child)
            if r[2]-r[0] > 50 and r[3]-r[1] > 50:
                if dw_hwnd is None or (r[3]-r[1]) > (dw_rect[3]-dw_rect[1]):
                    dw_hwnd = child
                    dw_rect = r
        try:
            win32gui.EnumChildWindows(wh_hwnd, wh_dw_cb, None)
        except Exception:
            pass

        if dw_hwnd:
            all_x = dw_rect[0] + 45
            all_y = dw_rect[1] + 9
            print(f"คลิก All at ({all_x},{all_y})")
            win32gui.SetForegroundWindow(wh_hwnd)
            time.sleep(0.4)
            ctypes.windll.user32.SetCursorPos(all_x, all_y)
            time.sleep(0.3)
            win32gui.SetForegroundWindow(wh_hwnd)
            time.sleep(0.2)
            win32api.mouse_event(win32con.MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0)
            time.sleep(0.05)
            win32api.mouse_event(win32con.MOUSEEVENTF_LEFTUP, 0, 0, 0, 0)
            time.sleep(0.3)
            print("คลิก All เสร็จ")

        # คลิก ตกลง ใน dialog เลือกคลัง (ซ้ายสุด)
        wh_ok = []
        def wh_ok_cb(child, _):
            if win32gui.GetClassName(child) != "Button":
                return
            if "ตกลง" not in win32gui.GetWindowText(child):
                return
            r = win32gui.GetWindowRect(child)
            if r[2]-r[0] > 5 and r[3]-r[1] > 5 and win32gui.IsWindowVisible(child):
                wh_ok.append((r[0], child, r))
        try:
            win32gui.EnumChildWindows(wh_hwnd, wh_ok_cb, None)
        except Exception:
            pass
        wh_ok.sort()
        if wh_ok:
            _, _, ok_rect = wh_ok[0]
            ocx = (ok_rect[0]+ok_rect[2])//2
            ocy = (ok_rect[1]+ok_rect[3])//2
            print(f"คลิก ตกลง (คลัง) at ({ocx},{ocy})")
            win32gui.SetForegroundWindow(wh_hwnd)
            time.sleep(0.3)
            pyautogui.click(ocx, ocy)
            time.sleep(0.5)
            print("คลิก ตกลง (คลัง) เสร็จ")

    # คลิก ตกลง ใน popup เงื่อนไขการสร้างรายงาน (ซ้ายสุด)
    ok_btns = []
    def cb(child, _):
        if win32gui.GetClassName(child) != "Button":
            return
        if "ตกลง" not in win32gui.GetWindowText(child):
            return
        r = win32gui.GetWindowRect(child)
        if r[2]-r[0] > 5 and r[3]-r[1] > 5:
            ok_btns.append((r[0], child, r))
    win32gui.EnumChildWindows(hwnd, cb, None)
    ok_btns.sort()

    if ok_btns:
        _, ok_hwnd, ok_rect = ok_btns[0]
        ocx = (ok_rect[0]+ok_rect[2])//2
        ocy = (ok_rect[1]+ok_rect[3])//2
        print(f"คลิก ตกลง (popup หลัก) at ({ocx},{ocy})")
        win32gui.SetForegroundWindow(hwnd)
        time.sleep(0.2)
        pyautogui.click(ocx, ocy)
        print("คลิก ตกลง เสร็จ — สร้างรายงานแล้ว")
    else:
        print("ไม่พบปุ่ม ตกลง ใน popup")


# ────────────────────────────────────────────
# Step 6: รอ report generate เสร็จแล้วกด ส่งออก (วิธี snapshot hwnd)
# ────────────────────────────────────────────

def snapshot_promaxx_hwnds():
    """คืน set ของ hwnd ทั้งหมด (top-level + child) ของ promaxxreport ณ ตอนนี้"""
    result = set()
    def top_cb(h, _):
        try:
            _, pid = win32process.GetWindowThreadProcessId(h)
            if "promaxxreport" not in psutil.Process(pid).name().lower():
                return
        except Exception:
            return
        r = win32gui.GetWindowRect(h)
        if r[2]-r[0] < 5 and r[3]-r[1] < 5:
            return
        result.add(h)
        def cc(ch, _):
            result.add(ch)
        try:
            win32gui.EnumChildWindows(h, cc, None)
        except Exception:
            pass
    win32gui.EnumWindows(top_cb, None)
    return result


def _find_export_button(pre_hwnds=None):
    """หาปุ่ม 'ส่งออก' ในทุก top-level window ของ promaxxreport

    - ค้นทุก top-level (ไม่ยึดหน้าต่างเมนูหลักเดิม) เพราะปุ่ม ส่งออก อยู่ใน
      หน้าต่าง preview รายงานที่เพิ่งเปิดหลัง generate
    - จับคู่ข้อความ "ตรงเป๊ะ" == 'ส่งออก' (ตัด & และช่องว่าง) ไม่ใช้ in แบบหลวม
    - คืน list ของ (btn_hwnd, btn_rect, top_hwnd) — เรียงให้หน้าต่างที่เพิ่งเปิด
      หลัง generate (top_hwnd ∉ pre_hwnds) มาก่อน → คลิกถูก context
    """
    if pre_hwnds is None:
        pre_hwnds = set()
    found = []   # (is_new, btn_hwnd, btn_rect, top_hwnd)
    def top_cb(top, _):
        try:
            _, pid = win32process.GetWindowThreadProcessId(top)
            if "promaxxreport" not in psutil.Process(pid).name().lower():
                return
        except Exception:
            return
        def ex_cb(child, _):
            if win32gui.GetClassName(child) != "Button":
                return
            if win32gui.GetWindowText(child).replace("&", "").strip() != "ส่งออก":
                return
            r = win32gui.GetWindowRect(child)
            if r[2]-r[0] > 5 and r[3]-r[1] > 5:
                found.append((top not in pre_hwnds, child, r, top))
        try:
            win32gui.EnumChildWindows(top, ex_cb, None)
        except Exception:
            pass
    win32gui.EnumWindows(top_cb, None)
    found.sort(key=lambda t: not t[0])   # หน้าต่างใหม่ (is_new=True) มาก่อน
    return [(b, r, top) for _is_new, b, r, top in found]


def _click_export_button(top_hwnd, btn_rect):
    """คลิกปุ่ม ส่งออก โดยดึง 'หน้าต่างที่ปุ่มอยู่จริง' มา foreground ก่อน
    (ไม่ดึงหน้าต่างเมนูหลัก — กันคลิกผิด context จน Select File dialog เพี้ยน)"""
    cx = (btn_rect[0]+btn_rect[2])//2
    cy = (btn_rect[1]+btn_rect[3])//2
    print(f"พบปุ่ม ส่งออก at ({cx},{cy}) ในหน้าต่าง top={top_hwnd} — คลิก")
    force_foreground(top_hwnd)
    time.sleep(0.3)
    pyautogui.click(cx, cy)
    print("คลิก ส่งออก เสร็จ")


def step_wait_export(hwnd, pre_hwnds=None, stall_timeout=120, max_total=1800):
    """รอ report generate เสร็จ (Waiting หาย) แล้วคลิกปุ่ม ส่งออก

    Waiting dialog ของโปรแกรมนี้ title ว่าง ('') หาด้วย GetWindowText ไม่ได้
    → ใช้ snapshot: ดู hwnd ใหม่ที่โผล่หลังกด ตกลง (= Waiting) แล้วรอจนมันหาย

    pre_hwnds     : snapshot hwnd ก่อนกด ตกลง (จาก main)
    stall_timeout : ยอมแพ้เมื่อ Waiting หายแต่ไม่เจอปุ่ม ส่งออก ติดต่อกันกี่วินาที
    max_total     : เพดานเวลารวม (กันลูปไม่รู้จบ)
    """
    if pre_hwnds is None:
        pre_hwnds = set()

    def get_new_hwnds():
        new = snapshot_promaxx_hwnds() - pre_hwnds
        visible = set()
        for h in new:
            try:
                r = win32gui.GetWindowRect(h)
                if r[2]-r[0] > 30 and r[3]-r[1] > 30:
                    visible.add(h)
            except Exception:
                pass
        return visible

    # Phase 1: รอ hwnd ใหม่ (Waiting dialog) โผล่
    print("รอ Waiting dialog ปรากฏ ...")
    appeared = False
    for _ in range(30):
        if get_new_hwnds():
            print("  เจอ Waiting dialog — รอให้ generate เสร็จ ...")
            appeared = True
            break
        time.sleep(0.5)
    if not appeared:
        print("  ไม่เจอ Waiting ใหม่ — อาจ generate เร็ว, รอ 3s")
        time.sleep(3)

    # Phase 2: รอจน Waiting หาย แล้วกด ส่งออก
    print(f"รอ Waiting หาย (เพดาน {max_total}s) ...")
    stall = 0
    settled = False   # รอ UI พร้อมหลัง Waiting หายแล้วหรือยัง
    for elapsed in range(max_total):
        if get_new_hwnds():            # ยังมี Waiting → รอต่อไม่จำกัด
            stall = 0
            settled = False            # มี Waiting อีก → ต้องรอ settle ใหม่
            if elapsed % 5 == 0:
                print(f"  กำลัง generate (Waiting)... {elapsed}s")
            time.sleep(1)
            continue

        # Waiting หายแล้ว — รอ UI วาดปุ่มให้พร้อมก่อน (ครั้งแรกที่ไม่มี Waiting)
        if not settled:
            print("  Waiting หาย — รอ UI พร้อม 1.5s ก่อนหาปุ่ม ส่งออก ...")
            time.sleep(1.5)
            settled = True

        found = _find_export_button(pre_hwnds)
        if found:
            btn_hwnd, btn_rect, top_hwnd = found[0]
            _click_export_button(top_hwnd, btn_rect)
            return True

        stall += 1
        if elapsed % 5 == 0:
            print(f"  รอปุ่ม ส่งออก (ไม่มี Waiting)... {stall}/{stall_timeout}s")
        if stall >= stall_timeout:
            print(f"ยอมแพ้: Waiting หายแต่ไม่เจอปุ่ม ส่งออก ติดต่อกัน {stall_timeout}s")
            return False
        time.sleep(1)

    print(f"timeout: เกินเพดาน {max_total}s")
    return False


# ────────────────────────────────────────────
# Step 7: Select File dialog → CSV + ชื่อไฟล์ + Save
# ────────────────────────────────────────────

def step_select_file(filename="All_stock", stall_timeout=120, max_total=1800):
    """รอ Select File dialog แล้วเลือก CSV + ตั้งชื่อไฟล์ + กด Save

    รอไม่จำกัดตราบใดที่ยังมีหน้าต่าง "Waiting" อยู่ (โปรแกรมกำลังเตรียม export)
    stall_timeout = ยอมแพ้เมื่อ "ไม่มี Waiting และไม่มี dialog" ติดต่อกันกี่วินาที (เผื่อค้างจริง)
    max_total     = เพดานเวลารวมกันสูงสุด (กันลูปไม่รู้จบ)
    """
    CB_GETCOUNT     = 0x0146
    CB_GETLBTEXT    = 0x0148
    CB_SETCURSEL    = 0x014E
    CB_SELECTSTRING = 0x014D
    WM_SETTEXT      = 0x000C
    WM_COMMAND      = 0x0111
    CBN_SELCHANGE   = 1

    print(f"รอ Select File dialog (รอจนกว่า Waiting จะหาย, เพดาน {max_total}s) ...")
    dlg_hwnd = None
    stall = 0       # นับวินาทีที่ไม่มี Waiting และไม่มี dialog ติดต่อกัน

    for elapsed in range(max_total):
        # 1. เจอ Select File dialog หรือยัง
        def dlg_cb(h, _):
            nonlocal dlg_hwnd
            if "Select File" in win32gui.GetWindowText(h) and win32gui.IsWindowVisible(h):
                dlg_hwnd = h
        win32gui.EnumWindows(dlg_cb, None)
        if dlg_hwnd:
            print(f"  พบ dialog hwnd={dlg_hwnd}")
            break

        # 2. ยังมี Waiting อยู่ไหม
        waiting = []
        def wt_cb(h, _):
            if "Waiting" in win32gui.GetWindowText(h) and win32gui.IsWindowVisible(h):
                waiting.append(h)
        win32gui.EnumWindows(wt_cb, None)

        if waiting:
            stall = 0   # ยังทำงานอยู่ → reset ตัวนับค้าง
            if elapsed % 5 == 0:
                print(f"  กำลังเตรียมข้อมูล (Waiting)... {elapsed}s")
        else:
            stall += 1
            if elapsed % 5 == 0:
                print(f"  รอ dialog (ไม่มี Waiting)... {stall}/{stall_timeout}s")
            if stall >= stall_timeout:
                print(f"ยอมแพ้: ไม่มี Waiting และไม่เจอ dialog ติดต่อกัน {stall_timeout}s")
                return False
        time.sleep(1)

    if not dlg_hwnd:
        print(f"ไม่พบ Select File dialog ภายในเพดาน {max_total}s")
        return False

    def scan_controls():
        edits = []   # (hwnd, rect) ของ Edit ที่ visible width>120
        combos = []  # (hwnd, rect) ของ ComboBox / ComboBoxEx32 ที่ visible
        save_btn = None

        def scan(child, _):
            nonlocal save_btn
            try:
                cls = win32gui.GetClassName(child)
                txt = win32gui.GetWindowText(child)
                r = win32gui.GetWindowRect(child)
            except Exception:
                return
            if cls == "Edit" and win32gui.IsWindowVisible(child) and r[2] - r[0] > 120:
                edits.append((child, r))
            if cls in ("ComboBox", "ComboBoxEx32") and win32gui.IsWindowVisible(child):
                combos.append((child, r))
            if cls == "Button" and ("Save" in txt or "Open" in txt) and win32gui.IsWindowVisible(child):
                save_btn = child

        win32gui.EnumChildWindows(dlg_hwnd, scan, None)
        return edits, combos, save_btn

    # dump รายละเอียด control ทุกตัวใน dialog (ไว้ debug ข้ามเครื่อง)
    def dump_cb(child, _):
        cls = win32gui.GetClassName(child)
        if cls not in ("Edit", "ComboBox", "Button", "ComboBoxEx32"):
            return
        r = win32gui.GetWindowRect(child)
        print(f"    [{cls:13s}] vis={int(win32gui.IsWindowVisible(child))} "
              f"txt={win32gui.GetWindowText(child)!r:30s} rect={r}")
    win32gui.EnumChildWindows(dlg_hwnd, dump_cb, None)

    def pick_filetype_combo(combos):
        live_combos = [(h, r) for h, r in combos if win32gui.IsWindow(h)]
        if not live_combos:
            return None
        live_combos.sort(key=lambda c: (c[1][1], c[1][0]))
        return live_combos[-1][0]

    def pick_filename_combo(combos):
        live_combos = [(h, r) for h, r in combos if win32gui.IsWindow(h)]
        if not live_combos:
            return None
        live_combos.sort(key=lambda c: (c[1][1], c[1][0]))
        if len(live_combos) >= 2:
            return live_combos[-2][0]
        return live_combos[-1][0]

    def pick_filename_edit(edits):
        live_edits = [(h, r) for h, r in edits if win32gui.IsWindow(h)]
        if not live_edits:
            return None
        live_edits.sort(key=lambda e: (e[1][1], e[1][0]))
        return live_edits[-1][0]

    def find_descendant_edit(parent):
        found = []

        def cb(h, _):
            if found:
                return
            try:
                if win32gui.GetClassName(h) == "Edit" and win32gui.IsWindowVisible(h):
                    found.append(h)
            except Exception:
                pass

        try:
            win32gui.EnumChildWindows(parent, cb, None)
        except Exception:
            pass
        return found[0] if found else None

    def resolve_filename_edit(retries=8, delay=0.3):
        """หาช่อง filename แบบสดๆ — เลือก standalone Edit ก่อนเสมอ
        (เสถียรกว่าการผูกกับ descendant ของ combo ซึ่ง handle หลุดง่าย
        หลังเปลี่ยน 'Save as type'). ลองซ้ำหลายรอบเผื่อ dialog กำลัง refresh
        แล้ว Edit ถูกสร้างใหม่ (hwnd เปลี่ยน)"""
        for _ in range(retries):
            e, c, _sb = scan_controls()
            fe = pick_filename_edit(e)              # standalone Edit (ดีสุดสำหรับ dialog แบบ classic)
            if fe and win32gui.IsWindow(fe):
                return fe
            fc = pick_filename_combo(c)             # fallback: dialog แบบ modern (#32770)
            de = find_descendant_edit(fc) if fc else None
            if de and win32gui.IsWindow(de):
                return de
            time.sleep(delay)
        return None

    # ── helper: หา dialog "Select File" ที่ยังมีชีวิตจริง (hwnd เปลี่ยนได้หลังเลือก CSV) ──
    #    ใช้ก่อน foreground/คลิกทุกครั้ง เพราะ hwnd ของ dialog นี้หลุดง่าย
    def find_select_file_dialog():
        res = [None]
        def cb(h, _):
            try:
                if "Select File" in win32gui.GetWindowText(h) and win32gui.IsWindowVisible(h):
                    r = win32gui.GetWindowRect(h)
                    if r[2]-r[0] > 100 and r[3]-r[1] > 100:
                        res[0] = h
            except Exception:
                pass
        win32gui.EnumWindows(cb, None)
        return res[0]

    # ⚠ อย่าหน่วงเวลาช่วงนี้ และห้ามส่ง CDM_GETFOLDERPATH (0x0466) ให้ dialog —
    #   dialog นี้ "อายุสั้น" (ปิดตัวเองภายใน ~2 วินาทีหลังโผล่) การเรียก
    #   resolve_filename_edit (วน scan 2.4s) หรือ get_dlg_folder ทำให้ dialog
    #   หายไปก่อนได้พิมพ์ชื่อ → ต้องพุ่งไปพิมพ์ + Save ทันที
    base = os.path.splitext(os.path.basename(filename))[0]
    # ชื่อที่จะพิมพ์ลงช่อง File name = ชื่อเต็ม + นามสกุล (เช่น Allstock.csv)
    #   พิมพ์ ".csv" ลงไปเอง → ไม่ต้องเลือก dropdown 'Save as type' (โปรแกรมรู้ฟอร์แมตจากนามสกุล)
    type_name = os.path.basename(filename)
    target = filename
    if SAVE_DIR:
        try:
            os.makedirs(SAVE_DIR, exist_ok=True)
            target = os.path.join(SAVE_DIR, os.path.basename(filename))
        except Exception as e:
            print(f"  สร้างโฟลเดอร์ {SAVE_DIR} ไม่ได้: {e} — ใช้โฟลเดอร์ default แทน")
    src_folder = ""   # ไม่อ่านโฟลเดอร์ default แล้ว (พิมพ์ full path ตรงๆ)

    # ── ตั้งชื่อไฟล์ = วาง "full path" ลงช่อง filename โดยตรง ──
    #   ระบุ path เต็ม → โปรแกรมเซฟตรงที่ต้องการเลย ไม่ต้องเดา/ย้ายโฟลเดอร์
    #   ใช้ clipboard + Ctrl+V → ไม่ขึ้นกับ keyboard layout (กัน \ : พิมพ์เพี้ยน)
    #   และอ่าน rect สดทันทีก่อนคลิก → เลี่ยงปัญหา hwnd ของ dialog นี้หลุดง่าย
    full_target = os.path.abspath(target)

    def scan_dialog_rects():
        """คืน (filename_edit_rect, save_hwnd, save_rect) จากการสแกนสดทันที

        ⚠ ห้ามกรอง IsWindowVisible — dialog PowerBuilder นี้ Edit/control มี
        WS_VISIBLE กระพริบดับๆ ติดๆ ตอน enumerate (แต่ผู้ใช้เห็นช่องอยู่จริง)
        กรอง visibility แล้วจะสแกนไม่เจอเป็นพักๆ → ผูกตามตำแหน่ง/ขนาดแทน
        """
        fe = [None]; sv = [None, None]
        def cb(c, _):
            try:
                cls = win32gui.GetClassName(c)
                r = win32gui.GetWindowRect(c)
                txt = win32gui.GetWindowText(c)
            except Exception:
                return
            if cls == "Edit" and r[2]-r[0] > 120 and r[3]-r[1] > 5:
                if fe[0] is None or r[1] > fe[0][1]:    # Edit ล่างสุด = ช่อง filename
                    fe[0] = r
            if cls == "Button":
                t = txt.replace("&", "").strip().lower()
                # match เฉพาะปุ่ม Save/Open จริง — กันชน 'Open as read-only'
                if t in ("save", "open"):
                    sv[0] = c; sv[1] = r
        try:
            win32gui.EnumChildWindows(dlg_hwnd, cb, None)
        except Exception:
            pass
        return fe[0], sv[0], sv[1]

    # อ่านข้อความช่อง filename (best effort) — ใช้ยืนยันว่าพิมพ์ติดไหม
    def read_filename_text():
        res = [""]
        def cb(c, _):
            try:
                if win32gui.GetClassName(c) != "Edit":
                    return
                r = win32gui.GetWindowRect(c)
                if r[2]-r[0] > 120 and r[3]-r[1] > 5:
                    b = ctypes.create_unicode_buffer(600)
                    ctypes.windll.user32.SendMessageW(c, 0x000D, 600, b)  # WM_GETTEXT
                    if b.value.strip():
                        res[0] = b.value.strip()
            except Exception:
                pass
        try:
            win32gui.EnumChildWindows(dlg_hwnd, cb, None)
        except Exception:
            pass
        return res[0]

    # อ่านโฟลเดอร์ปัจจุบันของ dialog (ช่อง "Save in" = combo บนสุด) ไว้ดูว่าจะเซฟลงไหน
    def read_save_in_folder():
        info = [""]
        def cb(c, _):
            try:
                if win32gui.GetClassName(c) not in ("ComboBox", "ComboBoxEx32"):
                    return
                r = win32gui.GetWindowRect(c)
                # combo บนสุด (y น้อยสุด) = Save in
                if info[0] == "" or r[1] < info[1]:
                    cur = ctypes.windll.user32.SendMessageW(c, 0x0147, 0, 0)  # CB_GETCURSEL
                    buf = ctypes.create_unicode_buffer(512)
                    ctypes.windll.user32.SendMessageW(c, 0x0148, cur, buf)    # CB_GETLBTEXT
                    info[0] = buf.value
                    info.append(r[1])
            except Exception:
                pass
        try:
            win32gui.EnumChildWindows(dlg_hwnd, cb, None)
        except Exception:
            pass
        return info[0]

    def select_save_in_folder(folder):
        """กำหนดโฟลเดอร์ปลายทางในช่อง Save in"""
        if not folder:
            return True
        folder = os.path.abspath(folder)
        if not os.path.isdir(folder):
            print(f"ไม่พบโฟลเดอร์ปลายทาง: {folder}")
            return False
        combos = []
        def cb(c, _):
            try:
                if win32gui.GetClassName(c) not in ("ComboBox", "ComboBoxEx32"):
                    return
                r = win32gui.GetWindowRect(c)
                if r[2] - r[0] > 120:
                    combos.append((r[1], c, r))
            except Exception:
                pass
        win32gui.EnumChildWindows(dlg_hwnd, cb, None)
        if not combos:
            print("ไม่พบช่อง Save in")
            return False
        _, _combo, rect = min(combos, key=lambda x: x[0])
        force_foreground(dlg_hwnd)
        pyautogui.click((rect[0] + rect[2]) // 2, (rect[1] + rect[3]) // 2)
        pyautogui.hotkey("ctrl", "a")
        _set_clipboard(folder)
        pyautogui.hotkey("ctrl", "v")
        pyautogui.press("enter")
        time.sleep(0.8)
        current = read_save_in_folder()
        print(f"Save in ปัจจุบัน = {current!r}")
        return os.path.basename(folder).lower() in current.lower() or current.lower() == folder.lower()

    # ════════════════════════════════════════════════════════════════
    # Flow ใหม่: (1) พิมพ์ชื่อไฟล์ → (2) เลือก Dropdown CSV → (3) กด Save
    # ════════════════════════════════════════════════════════════════

    # ════════════════════════════════════════════════════════════════
    # Flow: พิมพ์ "Allstock.csv" ลงช่อง File name ตรงๆ → กด Save
    #   ไม่เลือก dropdown 'Save as type' (พิมพ์นามสกุล .csv ลงไปเอง)
    # ════════════════════════════════════════════════════════════════

    # พิมพ์ชื่อเต็ม (เช่น Allstock.csv) ลงช่อง File name
    #   Unicode keystroke จริง → PB dialog commit ชื่อเข้า buffer (เหตุผลใน CLAUDE.md)
    #
    # ⚠ ไม่นำทาง Save in ไป SAVE_DIR ในนี้ — Select File ของ Seniorsoft (PB custom)
    #   นำทางเข้าโฟลเดอร์ย่อยไม่ได้ทั้ง 2 วิธี (พิสูจน์ด้วยการ test จริง):
    #     1) คลิก item ใน dropdown "Save in" → เป็น shell tree owner-drawn พิกัดเพี้ยน
    #        เคยคลิกพลาดไปโดน 'Network' (แย่กว่าไม่นำทาง)
    #     2) พิมพ์ path + Enter ในช่อง File name → dialog ไม่เข้าโฟลเดอร์ (ไม่ทำงาน)
    #   → ปล่อยเซฟลงโฟลเดอร์ default แล้วให้ find_saved_file + shutil.move ย้ายมา SAVE_DIR แทน
    _set_clipboard(type_name)

    def type_filename_once():
        """คลิกช่อง File name แล้วพิมพ์ type_name ด้วย Unicode keystroke; คืนข้อความที่อ่านกลับ"""
        nonlocal dlg_hwnd
        for attempt in range(12):
            live = find_select_file_dialog()      # หา dialog ที่ยังมีชีวิตจริง
            if live:
                dlg_hwnd = live
            fe_rect, _sh, _sr = scan_dialog_rects()
            if not (live and fe_rect):
                print(f"  [{attempt+1}] ยังหา dialog/ช่อง filename ไม่เจอ — รอ ...")
                time.sleep(0.3)
                continue
            cx = (fe_rect[0]+fe_rect[2])//2
            cy = (fe_rect[1]+fe_rect[3])//2
            print(f"  [{attempt+1}] พิมพ์ชื่อไฟล์ '{type_name}' ที่ช่อง ({cx},{cy}) dialog={live}")
            force_foreground(dlg_hwnd); time.sleep(0.3)
            pyautogui.click(cx, cy); time.sleep(0.15)
            pyautogui.click(cx, cy); time.sleep(0.15)   # คลิกซ้ำ ให้ focus เข้า edit จริง
            pyautogui.hotkey("ctrl", "a"); time.sleep(0.1)
            pyautogui.press("delete"); time.sleep(0.1)
            # Unicode keystroke จริง → ได้ตัวอักษรถูก (ไม่ขึ้นกับ layout ไทย) + PB commit
            print(f"  พิมพ์ (Unicode keystroke): {type_name}")
            _type_unicode(type_name); time.sleep(0.3)
            got = read_filename_text()
            if not got:
                # fallback: paste จาก clipboard (เผื่อ SendInput ไม่ติด)
                print("  Unicode keystroke ไม่ติด — ลอง paste")
                pyautogui.hotkey("ctrl", "a"); time.sleep(0.1)
                pyautogui.press("delete"); time.sleep(0.1)
                pyautogui.hotkey("ctrl", "v"); time.sleep(0.25)
                got = read_filename_text()
            print(f"  → ช่อง filename ตอนนี้ = {got!r}")
            print(f"  → โฟลเดอร์ที่จะเซฟลง (Save in) = {read_save_in_folder()!r}")
            return got
        return None

    # ── ไม่นำทาง Save in (Seniorsoft custom PB dialog เข้าโฟลเดอร์ย่อยไม่ได้) → พิมพ์ชื่อไฟล์เลย ──
    #   ไฟล์เซฟลงโฟลเดอร์ default ของ dialog แล้ว find_saved_file + shutil.move ย้ายไป SAVE_DIR ทีหลัง
    #   ได้รับการอนุมัติให้ใช้โฟลเดอร์เป้าหมายนี้โดยตรงและหลีกเลี่ยงการคลิก/select Save in ภายใน dialog
    print("ขั้นที่ 1: พิมพ์ชื่อไฟล์ (รวมนามสกุล .CSV)")
    if SAVE_DIR:
        print(f"  ปล่อยให้ dialog เซฟลง default ก่อน แล้วนำไฟล์ไปย้ายที่ {SAVE_DIR} ท้ายสุด")
    got = type_filename_once()
    if got is None:
        print("  !! หาช่อง filename ไม่เจอเลย — ยกเลิก")
        return False
    print(f"  → ยืนยันชื่อไฟล์ก่อนกด Save = {read_filename_text()!r}")

    # ลบไฟล์เดิมที่ target ก่อนเซฟ → กัน dialog ถามทับไฟล์
    for p in {full_target}:
        if p and os.path.isabs(p) and os.path.exists(p):
            try:
                os.remove(p); print(f"  ลบไฟล์เดิม {p}")
            except Exception as e:
                print(f"  ลบไฟล์เดิมไม่ได้ ({p}): {e}")
    save_click_time = time.time()

    # ── กด Save เท่านั้น (ห้ามแตะ Cancel/X) ──
    #   หาปุ่ม Save จาก dialog ที่ "ยังมีชีวิต" + match ข้อความ "save"/"open" ตรงเป๊ะ
    #   → คลิกกึ่งกลางปุ่ม + BM_CLICK เสริม (ปุ่ม Cancel/X ไม่เข้าเงื่อนไข จึงไม่มีทางโดน)
    def find_save_button():
        live = find_select_file_dialog()
        res = {"dlg": live, "hwnd": None, "rect": None}
        if not live:
            return res
        def cb(c, _):
            try:
                if win32gui.GetClassName(c) != "Button":
                    return
                t = win32gui.GetWindowText(c).replace("&", "").strip().lower()
                if t in ("save", "open"):
                    r = win32gui.GetWindowRect(c)
                    if r[2]-r[0] > 5 and r[3]-r[1] > 5:
                        res["hwnd"] = c; res["rect"] = r
            except Exception:
                pass
        try:
            win32gui.EnumChildWindows(live, cb, None)
        except Exception:
            pass
        return res

    # กด Save ด้วย "คลิกเมาส์จริง" ซ้ำจนกว่า Select File dialog จะปิด
    #   คลิกจริง → ช่อง filename เสีย focus → PB commit ชื่อไฟล์ (เหมือนเซฟมือ)
    #   คลิกซ้ำได้ทน: เผื่อ autocomplete dropdown บัง / foreground ไม่ขึ้น / คลิกพลาด
    #   (ถ้า dialog ปิดแล้ว = Save ติด จึงไม่กดซ้ำเกิน — ไม่ลั่น export ซ้ำ)
    print("กด Save (คลิกเมาส์จริง จนกว่า Select File จะปิด)")
    clicked = False
    for attempt in range(12):
        sb = find_save_button()
        if not sb["dlg"]:
            clicked = True
            print(f"  [{attempt+1}] Select File ปิดแล้ว = Save ติด ✓")
            break
        if not sb["rect"]:
            print(f"  [{attempt+1}] dialog ยังอยู่แต่หาปุ่ม Save ไม่เจอ — รอ")
            time.sleep(0.3)
            continue
        scx = (sb["rect"][0]+sb["rect"][2])//2
        scy = (sb["rect"][1]+sb["rect"][3])//2
        print(f"  [{attempt+1}] คลิก Save (เมาส์จริง) ที่ ({scx},{scy}) บน dialog {sb['dlg']}")
        force_foreground(sb["dlg"]); time.sleep(0.25)
        pyautogui.click(scx, scy)
        time.sleep(0.7)

    # fallback สุดท้าย: ถ้ายังไม่ปิด ลอง BM_CLICK
    if not clicked and not find_select_file_dialog():
        clicked = True
    if not clicked:
        sb = find_save_button()
        if sb["hwnd"] and win32gui.IsWindow(sb["hwnd"]):
            print("  คลิกเมาส์ไม่ทำให้ปิด — BM_CLICK เป็น fallback สุดท้าย")
            try:
                win32api.SendMessage(sb["hwnd"], win32con.BM_CLICK, 0, 0)
            except Exception:
                pass
            time.sleep(0.8)
            clicked = not find_select_file_dialog()
    if not clicked:
        print("  !! กด Save ไม่สำเร็จ (Select File ยังเปิด) — ไม่แตะ Cancel/X")
    time.sleep(1.0)

    # ── helper: dump dialog (title + ปุ่มทั้งหมด) ──
    def dump_dialog(h, tag):
        print(f"  [{tag}] hwnd={h} cls={win32gui.GetClassName(h)!r} "
              f"title={win32gui.GetWindowText(h)!r}")
        def cb(c, _):
            cls = win32gui.GetClassName(c)
            t = win32gui.GetWindowText(c)
            if t or "BUTTON" in cls.upper() or cls == "Button":
                r = win32gui.GetWindowRect(c)
                print(f"      child cls={cls!r:42s} txt={t!r:22s} "
                      f"vis={int(win32gui.IsWindowVisible(c))} rect={r}")
        try:
            win32gui.EnumChildWindows(h, cb, None)
        except Exception:
            pass

    # ── helper: หา dialog SeniorSoft (ไม่ใช่หน้าต่างหลัก) ที่ยังไม่ได้จัดการ ──
    def find_ss_dialog(skip):
        res = [None]
        def cb(h, _):
            if h in skip:
                return
            if win32gui.GetClassName(h) in ("FNWND3125", "FNWNS3125"):
                return
            if not win32gui.IsWindowVisible(h):
                return
            if "SeniorSoft" not in win32gui.GetWindowText(h):
                return
            r = win32gui.GetWindowRect(h)
            if r[0] > -500 and r[2]-r[0] > 50 and r[3]-r[1] > 50:
                res[0] = h
        win32gui.EnumWindows(cb, None)
        return res[0]

    def dialog_button_texts(h):
        texts = []

        def cb(c, _):
            try:
                cls = win32gui.GetClassName(c)
                if cls != "Button" and "BUTTON" not in cls.upper():
                    return
                text = win32gui.GetWindowText(c).replace("&", "").strip().lower()
                if text:
                    texts.append(text)
            except Exception:
                pass

        try:
            win32gui.EnumChildWindows(h, cb, None)
        except Exception:
            pass
        return texts

    # ── helper: คลิกปุ่มตามข้อความ (รองรับ Button ปกติ + WinForms) ──
    def click_button_by_text(h, texts):
        found = []
        def cb(c, _):
            cls = win32gui.GetClassName(c)
            if cls != "Button" and "BUTTON" not in cls.upper():
                return
            t = win32gui.GetWindowText(c).replace("&", "").strip().lower()
            if t in texts:
                r = win32gui.GetWindowRect(c)
                if r[2]-r[0] > 5 and r[3]-r[1] > 5:
                    found.append((c, r))
        try:
            win32gui.EnumChildWindows(h, cb, None)
        except Exception:
            pass
        if not found:
            return False
        _, r = found[0]
        cx, cy = (r[0]+r[2])//2, (r[1]+r[3])//2
        print(f"    คลิกปุ่ม {texts} at ({cx},{cy})")
        try:
            win32gui.SetForegroundWindow(h)
        except Exception:
            pass
        time.sleep(0.3)
        pyautogui.click(cx, cy)
        return True

    # ── วนจัดการ dialog หลัง Save ──
    #   ทับไฟล์ → Yes | สำเร็จ → OK (result=True) | ไม่สำเร็จ → OK (result=False)
    result_ok = None
    handled = set()
    for _ in range(60):
        dlg = find_ss_dialog(handled)
        if not dlg:
            if result_ok is not None:
                break
            time.sleep(0.5)
            continue
        title = win32gui.GetWindowText(dlg)
        dump_dialog(dlg, "post-save")
        button_texts = dialog_button_texts(dlg)

        # อ่านข้อความจาก Static child ด้วย — เพราะ dialog สำเร็จ/ไม่สำเร็จ
        # มี title เหมือนกัน ("SeniorSoft ProMaxx") ข้อความจริงอยู่ใน Static
        statics = []
        def st_cb(c, _):
            if win32gui.GetClassName(c) == "Static":
                statics.append(win32gui.GetWindowText(c))
        try:
            win32gui.EnumChildWindows(dlg, st_cb, None)
        except Exception:
            pass
        msg = title + " | " + " ".join(statics)

        if ("ไม่สำเร็จ" in msg) or ("ผิดพลาด" in msg) or ("error" in msg.lower()):
            print(f"  ** โปรแกรมแจ้ง: ส่งออกไม่สำเร็จ ** ({msg!r})")
            if not click_button_by_text(dlg, ("ok", "ตกลง", "yes", "ใช่")):
                win32gui.SetForegroundWindow(dlg); time.sleep(0.2); pyautogui.press("enter")
            result_ok = False
            handled.add(dlg); time.sleep(1.0)
            continue

        if "สำเร็จ" in msg:
            print(f"  โปรแกรมแจ้ง: ส่งออกสำเร็จ ({msg!r})")
            if not click_button_by_text(dlg, ("ok", "ตกลง")):
                win32gui.SetForegroundWindow(dlg); time.sleep(0.2); pyautogui.press("enter")
            result_ok = True
            handled.add(dlg); time.sleep(1.0)
            continue

        # กด Yes เฉพาะกรณีที่เห็นเค้าโครง prompt ทับไฟล์จริง ๆ
        if any(t in button_texts for t in ("yes", "ใช่")) or any(
            kw in msg.lower() for kw in (
                "overwrite", "replace", "ทับ", "existing", "already",
                "มีชื่อไฟล์นี้อยู่แล้ว", "คุณต้องการบันทึกหรือไม่", "บันทึกหรือไม่"
            )
        ):
            print("  น่าจะเป็น dialog ถามทับไฟล์ → กด Yes")
            if not click_button_by_text(dlg, ("yes", "ใช่", "ok", "ตกลง")):
                cr = win32gui.GetWindowRect(dlg)
                yes_x = cr[0] + int((cr[2]-cr[0]) * 0.30)
                yes_y = cr[1] + int((cr[3]-cr[1]) * 0.80)
                print(f"    ปุ่มไม่โผล่ — คลิก Yes by pos ({yes_x},{yes_y})")
                win32gui.SetForegroundWindow(dlg); time.sleep(0.3); pyautogui.click(yes_x, yes_y)
            handled.add(dlg); time.sleep(1.0)
            continue

        print("  ข้ามหน้าต่าง SeniorSoft ที่ไม่ใช่ prompt ส่งออก")
        handled.add(dlg)
        time.sleep(0.8)

    # ── ตามหาไฟล์ที่โปรแกรมเพิ่งเซฟ แล้วย้ายไป SAVE_DIR ──
    stem = os.path.splitext(base)[0].lower()

    def find_saved_file():
        # 1) เดาจากโฟลเดอร์ default + ชื่อไฟล์ (ลองหลายนามสกุล/ตัวพิมพ์)
        if src_folder:
            for nm in (base, base.upper(), stem + ".CSV", stem + ".csv"):
                c = os.path.join(src_folder, nm)
                if os.path.exists(c) and os.path.getmtime(c) >= save_click_time - 2:
                    return c
        # 2) fallback: ค้นไฟล์ stem.* ที่ถูกแก้หลังกด Save ในโฟลเดอร์ที่เป็นไปได้
        search_dirs = [d for d in (
            src_folder,
            SAVE_DIR,
            os.path.dirname(EXE_PATH),                 # โฟลเดอร์โปรแกรม (default ของ PB บ่อย)
            os.path.join(os.path.expanduser("~"), "Documents", "ProMaxx_Export"),  # default ของ Save dialog
            os.path.join(os.path.expanduser("~"), "Documents"),
            os.path.join(os.path.expanduser("~"), "Documents", "update_stock"),
            os.path.join(os.path.expanduser("~"), "Downloads"),
            os.path.join(os.path.expanduser("~"), "Desktop"),
            os.path.expanduser("~"),
        ) if d]
        best = None
        for d in search_dirs:
            try:
                for nm in os.listdir(d):
                    if stem in nm.lower() and nm.lower().endswith((".csv", ".xls", ".xlsx")):
                        fp = os.path.join(d, nm)
                        if os.path.getmtime(fp) >= save_click_time - 2:
                            if best is None or os.path.getmtime(fp) > os.path.getmtime(best):
                                best = fp
            except Exception:
                pass
        return best

    # พิมพ์ชื่อล้วน → ไฟล์ไปอยู่โฟลเดอร์ default ของโปรแกรม → ค้นหาแล้วย้ายมา SAVE_DIR
    # รอให้โปรแกรมเขียนไฟล์เสร็จก่อน (วนหา ~10s)
    saved = None
    for _ in range(20):
        saved = find_saved_file()
        if saved:
            break
        time.sleep(0.5)
    if saved:
        print(f"พบไฟล์ที่เซฟ: {saved} ({os.path.getsize(saved):,} bytes)")
        if SAVE_DIR and os.path.abspath(saved) != os.path.abspath(target):
            try:
                if os.path.exists(target):
                    os.remove(target)
                import shutil
                shutil.move(saved, target)
                print(f"ย้ายไฟล์ → {target}")
            except Exception as e:
                print(f"!! ย้ายไฟล์ไม่ได้: {e} (ไฟล์ยังอยู่ที่ {saved})")
                target = saved
        else:
            target = saved
        result_ok = True
    else:
        print("!! ไม่พบไฟล์ที่โปรแกรมเซฟ — การส่งออกไม่สำเร็จ")
        if result_ok is None:
            result_ok = False

    if result_ok and os.path.exists(target):
        print(f"ยืนยัน: ไฟล์พร้อมใช้งานที่ {target} ({os.path.getsize(target):,} bytes)")

    print("บันทึกไฟล์เสร็จ" if result_ok else "บันทึกไฟล์ไม่สำเร็จ")
    return bool(result_ok)


# ────────────────────────────────────────────
# Main — รอบเดียวแล้วจบ (เฉพาะสำเนานี้ · ต้นฉบับเป็นลูปทุก 5 นาที + อัป Supabase)
# ────────────────────────────────────────────

def run_one_cycle(hwnd, filename=SAVE_NAME):
    """หนึ่งรอบ: กดสร้างรายงาน → popup → รอ generate → ส่งออก → save
    คืน True ถ้า ProMaxx แจ้งว่าส่งออกสำเร็จ — ⚠ ไม่ได้แปลว่าไฟล์อยู่ที่ SAVE_DIR (ดู _collect_export)
    filename = ชื่อที่พิมพ์ลงช่อง File name · main() ส่งชื่อชั่วคราวไม่ซ้ำ (ดู _temp_export_name)"""
    ui("   กำลังสร้างรายงานสต๊อก...")
    step_create_report(hwnd)
    # snapshot hwnd ก่อนกด ตกลง (popup) → ใช้จับ Waiting dialog ที่ title ว่าง
    pre_hwnds = snapshot_promaxx_hwnds()
    step_popup_condition()
    ui("   กำลังประมวลผลข้อมูล (อาจใช้เวลาสักครู่)...")
    step_wait_export(hwnd, pre_hwnds)
    ui("   กำลังบันทึกไฟล์...")
    return step_select_file(filename)


# โฟลเดอร์ที่ข้ามตอนไล่หาไฟล์ที่ ProMaxx เพิ่งเซฟ (ใหญ่และไม่มีทางเป็นที่ที่คนเลือกเซฟรายงาน)
_FIND_SKIP_DIRS = {"appdata", "node_modules", "__pycache__", "$recycle.bin", "venv"}
FIND_MAX_DEPTH = 5


def _temp_export_name():
    """ชื่อไฟล์ชั่วคราวไม่ซ้ำใคร ใช้พิมพ์ลงหน้าต่าง Save แทน Allstock.CSV
    หน้าต่าง Save ของ ProMaxx เซฟลง "โฟลเดอร์ล่าสุดที่เคยเลือก" ซึ่งเป็นที่ไหนก็ได้ ถ้าที่นั่นมีไฟล์ชื่อเดียวกัน
    โค้ดคลิกของต้นฉบับจะกด Yes เขียนทับ — 28 ก.ย. 2026 บนเครื่องพัฒนาทับ Desktop\\Grabmart-U\\CSV\\Allstock.CSV
    ของอีกโปรเจกต์ไปแล้ว (หน้าต่างจำโฟลเดอร์นั้นจากการส่งออกด้วยมือตอนเช้า) ชื่อไม่ซ้ำ = ไม่มีวันทับของใคร
    กติกาชื่อของ ProMaxx: ห้าม underscore · นามสกุล .CSV ตัวใหญ่ · และจงใจไม่ขึ้นต้นด้วย Allstock/R05
    (กันสคริปต์ที่ค้นด้วย Allstock*.csv / R05*.CSV หยิบไฟล์ชั่วคราวไปผิดตัว)"""
    return "AR01%s.CSV" % time.strftime("%y%m%d%H%M%S")


def _find_exported_file(name, since, roots=None, max_depth=FIND_MAX_DEPTH):
    """หาไฟล์ชื่อ name (ไม่สนตัวพิมพ์) ที่แก้ไขหลัง since · ดูโฟลเดอร์ที่พบบ่อยก่อน แล้วค่อยไล่ทั้งโฟลเดอร์ผู้ใช้
    (find_saved_file ของต้นฉบับดูแค่โฟลเดอร์ชุดตายตัว ถ้าหน้าต่างเซฟไว้ที่อื่นจะหาไม่เจอแต่ยังรายงานว่าสำเร็จ)"""
    target = name.lower()

    def fresh(path):
        try:
            return os.path.isfile(path) and os.path.getmtime(path) >= since - 2
        except OSError:
            return False

    home = os.path.expanduser("~")
    quick = [SAVE_DIR, os.path.dirname(EXE_PATH), os.path.join(home, "Documents", "ProMaxx_Export"),
             os.path.join(home, "Documents"), os.path.join(home, "Downloads"), os.path.join(home, "Desktop"), home]
    for d in quick:
        if d and fresh(os.path.join(d, name)):
            return os.path.join(d, name)

    for root in (roots or [home]):
        base = os.path.abspath(root).rstrip("\\/").count(os.sep)
        for dirpath, dirnames, filenames in os.walk(root):
            if dirpath.rstrip("\\/").count(os.sep) - base >= max_depth:
                dirnames[:] = []
            else:
                dirnames[:] = [d for d in dirnames
                               if d.lower() not in _FIND_SKIP_DIRS and not d.startswith(".")]
            for f in filenames:
                if f.lower() == target and fresh(os.path.join(dirpath, f)):
                    return os.path.join(dirpath, f)
    return None


def _collect_export(temp_name, since, roots=None):
    """ย้ายไฟล์ชื่อชั่วคราวที่เพิ่งส่งออกไปเป็น SAVE_DIR\\Allstock.CSV · คืน path ปลายทาง หรือ None ถ้าหาไม่เจอ
    ตัวนี้คือตัวตัดสินว่า "สำเร็จจริง" — ถ้า None ต้องนับเป็นล้มเหลว แม้ ProMaxx จะแจ้งว่าส่งออกสำเร็จ"""
    found = _find_exported_file(temp_name, since, roots)
    if not found:
        print(f"!! หาไฟล์ {temp_name} ที่เพิ่งส่งออกไม่เจอ (ค้นทั้งโฟลเดอร์ผู้ใช้แล้ว)")
        return None
    print(f"พบไฟล์ที่ส่งออก: {found} ({os.path.getsize(found):,} bytes)")
    for _ in range(10):                    # รอ ProMaxx เขียนเสร็จ (ขนาดนิ่ง)
        size = os.path.getsize(found)
        time.sleep(1.0)
        if size > 0 and os.path.getsize(found) == size:
            break
    final = os.path.join(SAVE_DIR, SAVE_NAME)
    os.makedirs(SAVE_DIR, exist_ok=True)
    try:
        os.replace(found, final)           # ไดรฟ์เดียวกัน = rename ทับของเดิมทีเดียว (คงเวลาแก้ไขเดิม)
    except OSError:
        import shutil                      # ข้ามไดรฟ์ → ก๊อปแล้วลบต้นทาง
        shutil.copy2(found, final)
        try:
            os.remove(found)
        except OSError as e:
            print(f"ลบไฟล์ชั่วคราว {found} ไม่ได้: {e}")
    print(f"ย้ายไฟล์ → {final}")
    return final


def _promaxx_dialogs():
    """กล่องข้อความของ Windows (#32770) ที่ ProMaxx กำลังแสดงอยู่ → [(title, (ข้อความ, ...)), ...] · อ่านอย่างเดียว"""
    out = []
    try:
        pids = _all_promaxx_pids()
        if not pids:
            return out

        def top_cb(h, _):
            try:
                _, pid = win32process.GetWindowThreadProcessId(h)
                if pid not in pids or win32gui.GetClassName(h) != "#32770" or not win32gui.IsWindowVisible(h):
                    return
                texts = []

                def child_cb(c, __):
                    try:
                        if win32gui.GetClassName(c) == "Static":
                            t = " ".join(win32gui.GetWindowText(c).split())
                            if t:
                                texts.append(t)
                    except Exception:
                        pass
                try:
                    win32gui.EnumChildWindows(h, child_cb, None)
                except Exception:
                    pass
                out.append((win32gui.GetWindowText(h), tuple(texts[:6])))
            except Exception:
                pass

        win32gui.EnumWindows(top_cb, None)
    except Exception:
        pass
    return out


class _DialogWatcher(threading.Thread):
    """เก็บกล่องข้อความทุกอันที่ ProMaxx แสดงระหว่างรอบ (อ่านอย่างเดียว ไม่คลิก ไม่กด) ไว้จดตอนล้ม
    ต้องเก็บตั้งแต่ตอนมันโผล่ เพราะรอจดตอนจบไม่ทัน — 28 ก.ย. 2026 เทสตอนเครื่องฐานข้อมูลออฟไลน์:
    ProMaxx ขึ้น "Microsoft SQL Server Login / Connection failed SQLState 08001" แล้วค้างรอกด OK
    ถ้ามีคนกด OK กล่องถัดไปจะโผล่และโปรแกรมปิดตัวเอง ⇒ ตอนบอทหมดเวลา 60 วินาทีไม่เหลืออะไรให้ดู
    และ log บอกแค่ "ไม่พบหน้า Login" (เคยต้องไล่เปิดโปรแกรมเองถึงรู้ว่าต่อ SQL Server ไม่ได้)"""

    def __init__(self, interval=1.0):
        super().__init__(daemon=True)
        self.interval = interval
        self.seen = {}                    # (title, texts) -> วินาทีที่เห็นครั้งแรก
        self._halt = threading.Event()    # ห้ามตั้งชื่อ _stop — ทับเมธอดภายในของ threading.Thread

    def run(self):
        t0 = time.time()
        while not self._halt.is_set():
            for key in _promaxx_dialogs():
                self.seen.setdefault(key, time.time() - t0)
            self._halt.wait(self.interval)

    def stop(self):
        self._halt.set()
        self.join(timeout=5)

    def report(self):
        """จดทุกกล่องที่เห็นลง log + สรุปบนหน้าจอ · คืน True ถ้ามีกล่องบอกว่าต่อฐานข้อมูลไม่ได้"""
        db_down = False
        for (title, texts), at in sorted(self.seen.items(), key=lambda kv: kv[1]):
            print(f"กล่องข้อความของ ProMaxx (วินาทีที่ {at:.0f}): {title!r} {list(texts)}")
            ui("   ProMaxx แจ้ง: %s - %s" % (title, " / ".join(texts[:2])[:200]))
            blob = (title + " " + " ".join(texts)).lower()
            if "sql server" in blob or "connect" in blob or "database" in blob:
                db_down = True
        if db_down:
            ui("   สาเหตุ: ProMaxx ต่อฐานข้อมูลไม่ได้ - ตรวจว่าเครื่องที่มี SQL Server (BIGYAMAINPC) เปิดอยู่และบริการ SQL Server พร้อมแล้ว")
        return db_down


def _acquire_single_instance():
    """named mutex กัน AutoR01Export รันซ้อนกันเอง (เช่น ดับเบิลคลิกระหว่างที่ Task กำลังรัน)
    คืน False ถ้ามีตัวอื่นถืออยู่ · สร้าง mutex ไม่ได้ = ไม่ขวางงาน (คืน True)
    ⚠ ตัววนของ bot-export (SeniorsoftExport.exe) ไม่รู้จัก mutex นี้ — จึงต้องเช็คชื่อโปรเซสใน _other_bots_running() ด้วย"""
    global _INSTANCE_MUTEX
    try:
        k32 = ctypes.windll.kernel32
        k32.CreateMutexW.restype = ctypes.c_void_p
        k32.CreateMutexW.argtypes = [ctypes.c_void_p, ctypes.c_bool, ctypes.c_wchar_p]
        k32.WaitForSingleObject.restype = ctypes.c_uint32
        k32.WaitForSingleObject.argtypes = [ctypes.c_void_p, ctypes.c_uint32]
        k32.CloseHandle.argtypes = [ctypes.c_void_p]
        h = k32.CreateMutexW(None, False, MUTEX_NAME)
        if not h:
            return True
        r = k32.WaitForSingleObject(h, 0)
        if r in (0x0, 0x80):   # WAIT_OBJECT_0 / WAIT_ABANDONED (ตัวก่อนตายค้าง = ได้ล็อกต่อ)
            _INSTANCE_MUTEX = h    # เก็บ handle ไว้ตลอดอายุ process (ปล่อยเองตอนจบ)
            return True
        k32.CloseHandle(h)
        return False
    except Exception as e:
        print(f"สร้าง mutex ไม่ได้ ({e}) — ทำงานต่อโดยไม่ล็อก")
        return True


def _other_bots_running():
    """ชื่อโปรเซสของบอทตัวอื่นที่ขับ ProMaxx อยู่ (OTHER_BOT_PROCS)"""
    found = set()
    for p in psutil.process_iter(["name"]):
        try:
            name = (p.info["name"] or "").lower()
            if name in OTHER_BOT_PROCS:
                found.add(name)
        except Exception:
            continue
    return sorted(found)


def _read_env_file(path):
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


def _load_settings():
    """รหัสผ่าน ProMaxx ไม่ฝังในโค้ด (repo Stock-Count เป็น PUBLIC)
    ลำดับ: ตัวแปรระบบ → .env ข้าง exe (รันจากซอร์ส: ข้าง .py แล้วโฟลเดอร์แม่ = auto-r01\\.env)
    คืน (username, password, exe_path, ไฟล์ .env ที่ใช้ หรือ None)"""
    candidates = [os.path.join(_app_dir(), ".env")]
    if not getattr(sys, "frozen", False):
        candidates.append(os.path.join(os.path.dirname(_app_dir()), ".env"))
    file_vals, used = {}, None
    for c in candidates:
        if os.path.isfile(c):
            file_vals, used = _read_env_file(c), c
            break

    def get(key):
        return os.environ.get(key, "").strip() or file_vals.get(key, "")

    return get("PROMAXX_USERNAME"), get("PROMAXX_PASSWORD"), get("PROMAXX_EXE_PATH"), used


def _parse_args(argv):
    """--save-dir <path> (auto-r01 ส่งโฟลเดอร์ที่มันอ่านไฟล์มาให้) · --version"""
    opts = {"save_dir": None, "version": False, "bad": []}
    i = 0
    while i < len(argv):
        a = argv[i]
        if a == "--version":
            opts["version"] = True
        elif a == "--save-dir" and i + 1 < len(argv):
            opts["save_dir"] = argv[i + 1]
            i += 1
        elif a.startswith("--save-dir="):
            opts["save_dir"] = a.split("=", 1)[1]
        else:
            opts["bad"].append(a)
        i += 1
    return opts


def main(argv):
    global USERNAME, PASSWORD, EXE_PATH, SAVE_DIR
    opts = _parse_args(argv)
    if opts["version"]:
        ui("AutoR01Export %s - ส่งออก R01.102 รอบเดียว ไม่อัป Supabase" % VERSION)
        return EXIT_OK

    _setup_log()
    ui("=" * 48)
    ui("   AutoR01Export %s - ส่งออกสต๊อก R01.102 ให้ auto-r01" % VERSION)
    ui("=" * 48)
    if opts["bad"]:
        ui("ไม่รู้จักตัวเลือก: %s (ใช้ได้แค่ --save-dir กับ --version)" % " ".join(opts["bad"]))
        return EXIT_CONFIG
    if opts["save_dir"]:
        SAVE_DIR = opts["save_dir"]

    user, pwd, exe_path, env_file = _load_settings()
    if exe_path:
        EXE_PATH = exe_path
    if not user or not pwd:
        ui("ไม่พบ PROMAXX_USERNAME / PROMAXX_PASSWORD")
        ui("ใส่ไว้ในไฟล์ .env ข้าง AutoR01Export.exe (แม่แบบ: .env.example) หรือตั้งเป็นตัวแปรระบบ")
        return EXIT_CONFIG
    USERNAME, PASSWORD = user, pwd
    print(f"ค่าตั้ง: .env={env_file or '(ตัวแปรระบบ)'} · EXE_PATH={EXE_PATH} · SAVE_DIR={SAVE_DIR}")
    ui("ไฟล์ปลายทาง: %s" % os.path.join(SAVE_DIR, SAVE_NAME))

    # ── ห้ามขับ ProMaxx ซ้อนกับคนอื่นเด็ดขาด ──
    #   step_login() หาหน้าต่างด้วย class FNWNS3125 อย่างเดียว (class เดียวกับ popup เงื่อนไขรายงาน)
    #   ถ้ามีตัวอื่นเปิด ProMaxx อยู่ บอทจะพิมพ์รหัสผ่านลง popup ของตัวนั้น และปุ่มดาว (toggle) จะถูกกดซ้ำ
    if not _acquire_single_instance():
        ui("มี AutoR01Export อีกตัวกำลังทำงานอยู่ - ไม่ทำอะไร")
        return EXIT_BUSY
    others = _other_bots_running()
    if others:
        ui("มีบอทตัวอื่นกำลังทำงานอยู่ (%s) - ไม่ทำอะไร" % ", ".join(others))
        return EXIT_BUSY
    if is_promaxx_running():
        ui("โปรแกรม Seniorsoft เปิดอยู่แล้ว (บอทตัวอื่นหรือมีคนใช้งาน) - ไม่ทำอะไร")
        return EXIT_BUSY

    succeeded = False
    watcher = _DialogWatcher()
    watcher.start()
    try:
        ui("[1/4] กำลังเปิดโปรแกรม Seniorsoft...")
        launch_program()
        ui("[2/4] กำลังเข้าสู่ระบบ...")
        step_login()
        # ── ตั้งค่าครั้งเดียว: คลิกดาว (toggle — ห้ามกดซ้ำ) + เลือก R01.102 ──
        ui("[3/4] กำลังเลือกเมนูรายงานสต๊อก (R01.102)...")
        result = step_click_star()
        if not result:
            print("หยุด: ไม่พบหน้าต่าง Report")
            ui("ไม่พบหน้าต่างรายงานของโปรแกรม Seniorsoft")
            return EXIT_FAILED
        _, hwnd, rect = result
        step_click_r01102(hwnd, rect)

        for attempt in range(1, EXPORT_ATTEMPTS + 1):
            ui("[4/4] ส่งออก ครั้งที่ %d/%d (เริ่มเวลา %s)"
               % (attempt, EXPORT_ATTEMPTS, time.strftime("%H:%M:%S")))
            print(f"===================== ส่งออกครั้งที่ {attempt} =====================")
            try:
                # หน้าต่าง Report อาจถูกปิด/สร้างใหม่ระหว่างครั้ง → re-acquire hwnd ให้สด (แบบเดียวกับลูปต้นฉบับ)
                if not win32gui.IsWindow(hwnd):
                    print("หน้าต่าง Report เดิมหายไป — ค้นหาใหม่ ...")
                    new_hwnd = find_window_by(cls=MENU_CLS, proc=TARGET_PROC, timeout=20)
                    if not new_hwnd:
                        raise RuntimeError("report window not found")
                    win32gui.ShowWindow(new_hwnd, win32con.SW_RESTORE)
                    time.sleep(1.0)
                    hwnd = new_hwnd
                temp_name = _temp_export_name()
                started = time.time()
                print(f"ชื่อไฟล์ชั่วคราวรอบนี้: {temp_name}")
                if run_one_cycle(hwnd, temp_name):
                    # ProMaxx แจ้งสำเร็จ ≠ ไฟล์อยู่ที่ปลายทาง — ต้องหาไฟล์เจอและย้ายได้จริงถึงนับว่าสำเร็จ
                    final = _collect_export(temp_name, started)
                    if final:
                        print(f"ส่งออกครั้งที่ {attempt} สำเร็จ ✓ → {final}")
                        ui("บันทึกไฟล์สำเร็จ")
                        succeeded = True
                        return EXIT_OK
                    print(f"ส่งออกครั้งที่ {attempt}: ProMaxx แจ้งสำเร็จแต่หาไฟล์ {temp_name} ไม่เจอ")
                    ui("   โปรแกรมแจ้งว่าส่งออกสำเร็จ แต่หาไฟล์ที่เซฟไม่เจอ")
                else:
                    print(f"ส่งออกครั้งที่ {attempt} ไม่สำเร็จ")
                    ui("   บันทึกไฟล์ไม่สำเร็จ")
            except SystemExit:
                raise
            except Exception:
                import traceback
                print(f"!! ส่งออกครั้งที่ {attempt} เกิดข้อผิดพลาด:")
                traceback.print_exc()
                ui("   เกิดข้อผิดพลาดระหว่างส่งออก (รายละเอียดอยู่ใน log)")
            if attempt < EXPORT_ATTEMPTS:
                ui("   รอ %d วินาทีแล้วลองใหม่..." % RETRY_PAUSE_SEC)
                time.sleep(RETRY_PAUSE_SEC)
        ui("ส่งออกไม่สำเร็จครบ %d ครั้ง" % EXPORT_ATTEMPTS)
        return EXIT_FAILED
    finally:
        watcher.stop()
        if not succeeded:
            watcher.report()               # จดกล่องข้อความทุกอันที่ ProMaxx แสดงระหว่างรอบ (สาเหตุที่ล้ม)
            started_alive = [p for p in BOT_STARTED_PROCESSES if psutil.pid_exists(p)]
            if BOT_STARTED_PROCESSES and not started_alive:
                print("ProMaxx ที่บอทเปิดปิดตัวเองไปก่อนบอทจะปิด")
                ui("   ProMaxx ปิดตัวเองไปก่อน (มักตามหลังกล่องแจ้ง error ที่มีคนกด OK)")
        # ตอนเริ่มยืนยันแล้วว่าไม่มี ProMaxx เปิดอยู่ ⇒ ตัวที่เปิดอยู่ตอนนี้เป็นของรอบนี้ ปิดให้หมด
        # ตัววนของ bot-export (08:00) และ BOT05106 ต้องเจอเครื่องที่ไม่มี ProMaxx ค้าง ไม่งั้น login ไม่ผ่าน
        close_promaxx(all_instances=True)


def _interactive_console():
    """True = stdin เป็นหน้าต่าง console จริง (ดับเบิลคลิกเอง) · auto-r01 เรียกด้วย stdin=DEVNULL = False
    ⚠ ห้ามใช้ isatty() — บน Windows อุปกรณ์ NUL ก็คืน True (เป็น character device) ต้องถาม GetConsoleMode แทน"""
    try:
        import msvcrt
        handle = msvcrt.get_osfhandle(sys.__stdin__.fileno())
        k32 = ctypes.windll.kernel32
        k32.GetConsoleMode.argtypes = [ctypes.c_void_p, ctypes.POINTER(ctypes.c_uint32)]
        mode = ctypes.c_uint32()
        return bool(k32.GetConsoleMode(ctypes.c_void_p(handle), ctypes.byref(mode)))
    except Exception:
        return False


def _own_console():
    """True = หน้าต่าง console นี้ถูกเปิดมาให้โปรแกรมนี้โดยเฉพาะ (ดับเบิลคลิก) · รันจาก PowerShell/cmd = False
    exe แบบ PyInstaller onefile มี 2 โปรเซส (ตัวเปิด + ตัวทำงาน) ใน console เดียวกัน · มีมากกว่านั้น = มี shell อยู่ด้วย
    ซึ่งผลยังค้างให้อ่านใน shell อยู่แล้ว ไม่ต้องรอกด Enter (เช่น .\\AutoR01Export.exe --version ตอนตรวจรุ่น)"""
    try:
        procs = (ctypes.c_uint32 * 16)()
        n = ctypes.windll.kernel32.GetConsoleProcessList(procs, 16)
        return 0 < n <= (2 if getattr(sys, "frozen", False) else 1)
    except Exception:
        return False


def _wait_enter_or_close(seconds=CLOSE_PROMPT_SEC):
    """ให้คนอ่านผลก่อนหน้าต่างปิด: รอกด Enter ไม่เกิน seconds วินาที แล้วปิดเอง
    ห้ามรอไม่มีกำหนด — หน้าต่างที่ลืมปิดทำให้โปรเซสยังอยู่ รอบเช้าของ auto-r01 จะเห็น AutoR01Export.exe
    รันอยู่แล้วถือว่ามีบอทอื่นทำงาน (ไม่ส่งออก · รอไฟล์จนหมดเวลา · exit 5 · R01 วันนั้นไม่ขึ้น) และ mutex ยังถูกถือไว้"""
    import msvcrt
    deadline = time.time() + seconds
    shown = None
    try:
        while True:
            left = int(deadline - time.time() + 0.999)
            if left <= 0:
                break
            if left != shown:
                _console_out.write("\rกด Enter เพื่อปิดหน้าต่างนี้ (ปิดเองใน %2d วินาที)... " % left)
                _console_out.flush()
                shown = left
            if msvcrt.kbhit() and msvcrt.getwch() in ("\r", "\n"):
                break
            time.sleep(0.1)
        _console_out.write("\n")
        _console_out.flush()
    except Exception:
        pass


if __name__ == "__main__":
    code = EXIT_FAILED
    try:
        code = main(sys.argv[1:])
    except SystemExit as e:          # sys.exit(1) เดิมใน launch_program / step_login
        code = e.code if isinstance(e.code, int) else EXIT_FAILED
    except KeyboardInterrupt:
        ui("หยุดการทำงานโดยผู้ใช้")
        code = EXIT_FAILED
    except Exception:
        import traceback
        print("!! เกิดข้อผิดพลาด:")
        traceback.print_exc()
        ui("เกิดข้อผิดพลาดร้ายแรง (ดูรายละเอียดใน log)")
        code = EXIT_FAILED
    if _logf:
        ui("จบการทำงาน (exit %s) - log ละเอียด: %s" % (code, os.path.join(_app_dir(), LOG_NAME)))
        try:
            _logf.flush()
        except Exception:
            pass
    # ดับเบิลคลิกเอง → รอกด Enter ไม่เกิน CLOSE_PROMPT_SEC แล้วปิดเอง
    # auto-r01 เรียก (stdin = NUL) หรือรันจาก PowerShell/cmd (ผลค้างอยู่ใน shell) → จบทันที ไม่รอ
    if _interactive_console() and _own_console():
        _wait_enter_or_close()
    sys.exit(code)
