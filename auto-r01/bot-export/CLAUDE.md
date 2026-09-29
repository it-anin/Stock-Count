# AutoR01Export — บอทส่งออก R01.102 รอบเดียวของ auto-r01

โฟลเดอร์นี้เป็น**สำเนา**ของบอท `it-anin/bot-export` (repo private · `seniorsoft_login.py` @ `434be0d` 22 ก.ย. 2026)
ปรับให้ทำงานเฉพาะของ auto-r01 คือ**ส่งออก `Allstock.CSV` รอบเดียวแล้วจบ ไม่อัป Supabase** แล้ว `../auto_r01_import.py`
อ่านไฟล์นั้นอัปขึ้น Firestore อย่างเดียว (ผู้ใช้สั่ง 28 ก.ย. 2026)

| | ต้นฉบับ `bot-export` (ตัววน) | สำเนานี้ `AutoR01Export.exe` |
|---|---|---|
| รอบ | วนทุก 5 นาที 08:00–20:50 | รอบเดียวแล้วจบ (ลอง "สร้างรายงาน → บันทึก" ได้ 2 ครั้ง) |
| Supabase | อัปตาราง `stock` ทุกรอบ | **ไม่อัปเลย** (ตัดโค้ดออกทั้งหมด) |
| รหัสผ่าน ProMaxx | ฝังในโค้ด | อ่านจากตัวแปรระบบ → `.env` ข้าง exe (**repo นี้ PUBLIC**) |
| โฟลเดอร์ปลายทาง | ฝังตอน build | `--save-dir` (auto-r01 ส่งโฟลเดอร์ที่มันอ่านมาให้) |
| path ของ ProMaxx | ฝังตอน build | `PROMAXX_EXE_PATH` ใน `.env` ได้ ไม่ต้อง build ใหม่ |
| เจอ ProMaxx / บอทอื่นเปิดอยู่ | ใช้ ProMaxx ตัวที่เปิดอยู่ต่อ | **ไม่ทำอะไร exit 3** |
| ชื่อที่พิมพ์ในหน้าต่าง Save | `Allstock.CSV` (กด Yes ทับไฟล์ชื่อเดียวกันในโฟลเดอร์ที่หน้าต่างจำไว้) | **ชื่อชั่วคราวไม่ซ้ำ `AR01<ปีเดือนวันเวลา>.CSV`** แล้วไล่หาทั่วโฟลเดอร์ผู้ใช้ ย้ายเป็น `Allstock.CSV` |
| ตัดสินว่าสำเร็จ | ProMaxx แจ้ง "ส่งออกสำเร็จ" (แม้หาไฟล์ไม่เจอ) | **ไฟล์อยู่ที่ `SAVE_DIR\Allstock.CSV` จริง** (`_collect_export`) |
| log ตอนล้ม | "ไม่พบหน้า Login ภายใน 60s" เฉยๆ | **จดทุกกล่องข้อความที่ ProMaxx แสดง** ตั้งแต่ตอนโผล่ (`_DialogWatcher`) + บอกสาเหตุถ้าต่อฐานข้อมูลไม่ได้ |
| เวลาทำการ | รอถึง 08:00 · ปิดตัวเอง 20:50 | ไม่มี — สั่งเมื่อไรทำเลย |
| ตอนจบ | ปิด ProMaxx ตอน 20:50 | ปิด ProMaxx ทันที |
| log ละเอียด | `seniorsoft_log.txt` (ทับทุกรอบ) | `auto_r01_export_log.txt` + `.1` (รอบก่อน) ข้าง exe |

⛔ **โค้ดคลิก ProMaxx เหมือนต้นฉบับทุกบรรทัด** — ช่วง `# Helpers` ถึงจบ `step_select_file()` ใน `auto_r01_export.py`
ก๊อปมาตรงๆ ไม่มีอะไร sync ให้ ⇒ ต้นฉบับแก้บั๊กคลิกเมื่อไรต้องพอร์ตมาเอง (diff เฉพาะช่วงนั้นกับ `seniorsoft_login.py`)
ส่วนที่เขียนใหม่มีแค่หัวไฟล์ (log/ค่าตั้ง) กับท้ายไฟล์ (`main()` รอบเดียว)

## ใช้งาน

auto-r01 เรียกให้เองทุกเช้า (`run_export_step()` ใน `../auto_r01_import.py` — ดู `../README.md` §ขั้น export)

```powershell
AutoR01Export.exe --save-dir "C:\Users\<ผู้ใช้>\Desktop\run-upload-stock"   # แบบที่ auto-r01 เรียก
AutoR01Export.exe --version    # พิมพ์รุ่นแล้วจบ ไม่เปิด ProMaxx ไม่สร้าง log — ใช้ตรวจว่าวางไฟล์ถูกรุ่น
```

| exit | ความหมาย | auto-r01 ทำต่อ |
|---|---|---|
| 0 | ส่งออกสำเร็จ | ตรวจว่ามีไฟล์ใหม่จริงแล้วอัป Firestore |
| 1 | ส่งออกไม่สำเร็จ / เปิดโปรแกรมหรือ login ไม่ได้ | exit 5 ไม่เขียน Firestore |
| 2 | ค่าตั้งไม่ครบ (`.env`) หรือตัวเลือกผิด | exit 5 |
| 3 | มี ProMaxx / ตัววน `SeniorsoftExport.exe` / `AutoR01Export` อีกตัว รันอยู่ — **ไม่ได้แตะอะไร** | รอไฟล์รอบถัดไปจากตัวที่รันอยู่ |

- ดับเบิลคลิกเอง: **รอกด Enter ไม่เกิน 60 วินาทีแล้วปิดเอง** (`CLOSE_PROMPT_SEC` · รุ่น `2026-09-29.1` ขึ้นไป · เทสแล้วปิดเองที่ 68 วินาทีนับรวมเวลาเปิดโปรแกรม)
  · รันจาก PowerShell/cmd (`_own_console()` เห็น shell อยู่ใน console เดียวกัน) หรือ auto-r01 เรียก (stdin = NUL): จบทันทีไม่รอ
  ⛔ **ห้ามกลับไปรอ Enter แบบไม่มีกำหนด** — หน้าต่างที่ลืมปิดทำให้โปรเซสยังอยู่ รอบเช้าของ auto-r01 จะเห็น `AutoR01Export.exe`
  รันอยู่แล้วถือว่ามีบอทอื่นทำงาน (ไม่ส่งออก · รอไฟล์จนหมดเวลา · exit 5 · R01 วันนั้นไม่ขึ้น) และ mutex ยังถูกถือไว้
  ⚠️ ตัดสินด้วย `GetConsoleMode` **ห้ามใช้ `isatty()`** — บน Windows อุปกรณ์ NUL คืน `isatty() = True` (ทดสอบแล้ว)
- stdout ที่ถูกส่งลงไฟล์ถูกบังคับเป็น UTF-8 (ไม่งั้นได้ cp874 แล้วบรรทัดที่มีตัวอักษรนอก cp874 หายทั้งบรรทัด)

## ⛔ กติกาห้ามละเมิด

1. **ห้ามขับ ProMaxx ซ้อนกับบอทอื่นเด็ดขาด** — `step_login()` หาหน้าต่างด้วย class `FNWNS3125` อย่างเดียว
   ซึ่งเป็น class เดียวกับ popup "เงื่อนไขการสร้างรายงาน" ⇒ ถ้ามีตัวอื่นเปิด ProMaxx อยู่ บอทจะพิมพ์ username/password
   ลง popup ของตัวนั้น · และปุ่มดาวเป็น toggle กดซ้ำ = ปิด
   - ด่านในตัว: mutex `Local\AninAutoR01Export` (กันตัวเองซ้อน) · ชื่อโปรเซส `SeniorsoftExport.exe` (ตัววน) ·
     `promaxxreport.exe` เปิดอยู่ ⇒ exit 3 ก่อนแตะอะไร (auto-r01 ตรวจด้วย `tasklist` ซ้ำอีกชั้นก่อนเรียก)
   - ⚠️ ตัววน (08:00) และ `BOT05106` (ส่งออก R05 เสร็จ ~07:55) **ไม่รู้จักด่านนี้** — ถ้ามันเริ่มระหว่างที่ตัวนี้ทำงาน
     จะชนกัน ⇒ **กันได้ด้วยการตั้งเวลา Task ของ auto-r01 เท่านั้น** (ดู `../README.md` §ตั้งเวลา)
2. **ห้ามใส่รหัสผ่านจริงในไฟล์ใดๆ ที่เข้า git** — `Stock-Count` เป็น repo **PUBLIC** (ต้นฉบับเป็น private จึงฝังได้)
   `USERNAME`/`PASSWORD` ในโค้ดต้องเป็นค่าว่างเสมอ · `.env` อยู่ใน `.gitignore` แล้ว
3. **ห้ามเติมโค้ดอัป Supabase กลับมา** — ตาราง `stock` เป็นงานของตัววนต้นฉบับ สำเนานี้มีหน้าที่แค่ส่งออกไฟล์
4. **ต้องปิด ProMaxx ทุกครั้งที่จบ** (`finally` ใน `main()`) — ตัววน 08:00 เจอ ProMaxx ค้างจะข้ามการเปิดแล้ว login ไม่ผ่าน
   ปิดแบบ `all_instances=True` ได้อย่างปลอดภัยเพราะด่านข้อ 1 ยืนยันแล้วว่าตอนเริ่มไม่มี ProMaxx เปิดอยู่
5. `ui()` ใช้อักษรไทย + ASCII เท่านั้น (เลี่ยง emoji/`→`/`•`) — กติกาเดิมของต้นฉบับเรื่อง console cp874
6. **ห้ามกลับไปพิมพ์ `Allstock.CSV` ลงหน้าต่าง Save ตรงๆ** — หน้าต่าง Save ของ ProMaxx เซฟลง**โฟลเดอร์ล่าสุดที่คนเคยเลือก**
   ซึ่งเป็นที่ไหนก็ได้ ถ้าที่นั่นมีไฟล์ชื่อเดียวกัน โค้ดคลิกจะกด Yes เขียนทับ · **เกิดจริง 28 ก.ย. 2026** ตอนเทสบนเครื่องพัฒนา:
   หน้าต่างจำ `Desktop\Grabmart-U\CSV` (มีคนส่งออก `kkl/src/sss.CSV` ด้วยมือไว้ตอนเช้า) ⇒ ทับ `Allstock.CSV` ของโปรเจกต์ Grabmart-U
   (ไม่ใช่ git · กู้ไม่ได้) แล้ว `find_saved_file()` ของต้นฉบับหาไม่เจอเพราะดูแค่โฟลเดอร์ชุดตายตัว แต่ยังรายงานสำเร็จ exit 0
   ⇒ `_temp_export_name()` ให้ชื่อไม่ซ้ำ (ไม่มีวันทับของใคร) · `_find_exported_file()` ไล่หาทั่วโฟลเดอร์ผู้ใช้ (ลึก 5 ชั้น
   ข้าม AppData/node_modules/โฟลเดอร์จุด · วัดจริง 0.4 วินาที) · `_collect_export()` ย้ายเป็น `Allstock.CSV` และเป็นตัวตัดสินว่าสำเร็จ
   - ชื่อชั่วคราวจงใจไม่ขึ้นต้นด้วย `Allstock`/`R05` และไม่มี `R14` — กัน auto-r01 (`Allstock*.csv`), auto-r05 (`R05*.CSV`)
     และ auto-adj หยิบไฟล์ชั่วคราวไปผิดตัว · ต้นฉบับยังพิมพ์ `Allstock.CSV` อยู่ (ไม่ได้แก้ repo ต้นฉบับ)

## ฐานข้อมูลของ ProMaxx อยู่บน BIGYAMAINPC (ยืนยัน 28 ก.ย. 2026)

ProMaxx ทุกเครื่องต่อ SQL Server **`BIGYAMAINPC\SQLSERVER` ฐาน `MSMAXX`** ผ่าน ODBC DSN ชื่อ `MSMAXX` (HKCU · ODBC Driver 17)
⇒ **BIGYAMAINPC ต้องเปิดอยู่และบริการ SQL Server ต้องพร้อม** ทั้งตอน Task รันจริง (บนเครื่องนั้นเอง) และตอนเทสจากเครื่องพัฒนา

อาการตอนต่อไม่ได้: ราววินาทีที่ 18 ขึ้นกล่อง `Microsoft SQL Server Login` — `Connection failed: SQLState: '08001' ...
Server is not found or not accessible` แล้ว**ค้างรอกด OK** หน้า Login (`FNWNS3125`) ไม่ขึ้น ⇒ `launch_program()` หมดเวลา 60 วินาที → exit 1
- ถ้ามีคนกด OK: ขึ้นกล่อง ODBC `SQL Server Login` → `Cannot Connect to Database` (Error code = 100) → `Connection error` แล้วโปรแกรมปิดตัวเอง
  ⇒ ตอนหมดเวลาไม่เหลือหน้าต่างให้ดู จึงต้องเก็บกล่องตั้งแต่ตอนโผล่ (`_DialogWatcher` อ่านอย่างเดียว ทุก 1 วินาที)
- log จะมีบรรทัด `ProMaxx แจ้ง: Microsoft SQL Server Login - Connection failed ...` ตามด้วย `สาเหตุ: ProMaxx ต่อฐานข้อมูลไม่ได้ ...`
- เคสจริง: 28 ก.ย. 2026 เทสรอบแรก 22:52 ต่อได้ · รอบสอง 23:03 ต่อไม่ได้ — BIGYAMAINPC ไม่ตอบ ping (เครื่องปิด/หลับ) · เช้า 29 ก.ย. 07:06 ตอบ ping แล้วและฐานข้อมูลพร้อมตอน 07:07
- ⚠️ **เช็คว่าฐานข้อมูลพร้อมห้ามดูพอร์ต 1433** — เป็น named instance ฟังพอร์ตที่ SQL Browser (UDP 1434) บอก (ตอนตรวจ 29 ก.ย. = TCP **53443** · เวอร์ชัน 17.0.1000.7)
  เมื่อคืนเคยสรุปผิดว่า "ฐานข้อมูลยังปิด" เพราะดูแค่ 1433 · วิธีเช็คที่ถูก (อ่านอย่างเดียว):
  ```powershell
  $u = New-Object Net.Sockets.UdpClient; $u.Client.ReceiveTimeout = 3000
  $q = [byte[]](,4) + [Text.Encoding]::ASCII.GetBytes("SQLSERVER") + [byte[]](,0); [void]$u.Send($q, $q.Length, "bigyamainpc", 1434)
  $ep = New-Object Net.IPEndPoint([Net.IPAddress]::Any, 0); [Text.Encoding]::ASCII.GetString($u.Receive([ref]$ep)); $u.Close()
  # ได้ข้อความที่มี tcp;<พอร์ต> = บริการพร้อม · ไม่ตอบ = เครื่องปิดหรือ SQL Browser ยังไม่เริ่ม
  ```

## ผลเทสจริงบนเครื่องพัฒนา (28 ก.ย. 2026)

| รอบ | ผล |
|---|---|
| 1 · 22:52 · รุ่นแรก | คลิกครบทุกขั้น **51 วินาที** ปิด ProMaxx เอง · ไฟล์ถูกต้อง 19,499 แถว (KKL 4,004 · SRC 5,458 · SSS 3,274 · WH 6,763) · **แต่ทับ `Grabmart-U\CSV\Allstock.CSV`** และรายงานสำเร็จทั้งที่ไฟล์ไม่อยู่ที่ปลายทาง — auto-r01 จับได้ (exit 5 ไม่เขียนอะไร) ⇒ ที่มาของกติกาข้อ 6 |
| 2 · 23:03 · รุ่น .2 | ต่อฐานข้อมูลไม่ได้ (ข้างบน) · ไม่มีไฟล์ไหนถูกแตะ · ชื่อชั่วคราวไปเทสผ่านในรอบ 4 |
| 3 · 23:1x · รุ่น .4 | ตั้งใจรันตอนฐานข้อมูลปิด เพื่อยืนยันว่าจดกล่อง `Connection failed` ลง log ได้ — ผ่าน |
| 4 · 29 ก.ย. 07:08 · รุ่น .4 | **ผ่านครบ** ผ่าน auto-r01 `--dry-run --with-export` · exe **51 วินาที** · หน้าต่าง Save เซฟ `AR01260929070905.CSV` ลง `Grabmart-U\CSV` (โฟลเดอร์ที่มันจำ) → `_collect_export` หาเจอแล้วย้ายเป็น `Allstock.CSV` · auto-r01 ได้ไฟล์ใหม่ 19,499 แถว ครบ 4 สาขา exit 0 · เทียบ hash แล้ว `Grabmart-U\CSV`, `ProMaxx_Export`, `run-upload-stock` เหมือนเดิมทุกไฟล์ ไม่มีไฟล์ชั่วคราวค้าง |

## ไฟล์

| ไฟล์ | หน้าที่ |
|---|---|
| `auto_r01_export.py` | ซอร์ส (ต้นฉบับ `seniorsoft_login.py`) |
| `AutoR01Export.spec` | ตั้งค่า PyInstaller |
| `build_exe.bat` | build → `..\AutoR01Export.exe` แล้วพิมพ์ `--version` ให้ดู |
| `appicon.ico` | ไอคอน (ก๊อปจากต้นฉบับ) |
| `..\.env.example` | แม่แบบ `.env` (วางข้าง exe) |

ไม่ได้ก๊อปมา (ยังอยู่ที่ต้นฉบับ): ตัวอัป Supabase แบบ Node (`upload-stock/`, `testupload/`) · สคริปต์ทดลอง/ดีบัก
(`create_report.py`, `read_stock.py`, `_diag*.py`, `test_*.py`) · `node_modules/` · `build/` · `dist/`

---

## โปรแกรมเป้าหมาย
- Process: `promaxxreport.exe`
- Framework: PowerBuilder (PB 12.5)

## Window Classes ที่สำคัญ
| Class | คำอธิบาย |
|---|---|
| `FNWND3125` | หน้าต่างหลัก Report |
| `FNWNS3125` | popup / dialog (login, เงื่อนไขสร้างรายงาน) |
| `pbdw125` | DataWindow — แสดงข้อมูลแบบ grid/form |
| `Button` | ปุ่มมาตรฐาน Win32 |

## วิธีหาหน้าต่าง

```python
import win32gui, win32process, psutil

def find_window(class_name, title_contains):
    found = []
    def cb(hwnd, _):
        if win32gui.GetClassName(hwnd) != class_name:
            return
        if title_contains not in win32gui.GetWindowText(hwnd):
            return
        r = win32gui.GetWindowRect(hwnd)
        if r[2]-r[0] > 50:
            found.append((hwnd, r))
    win32gui.EnumWindows(cb, None)
    return found[0] if found else None

# กรองด้วย process name (กันสับสนกับโปรแกรมอื่น)
def from_promaxx_only(hwnd):
    _, pid = win32process.GetWindowThreadProcessId(hwnd)
    return "promaxxreport" in psutil.Process(pid).name().lower()
```

## วิธีคลิกปุ่มที่ถูกต้อง ✓

### 1. ปุ่ม Win32 Button ทั่วไป (pyautogui)
```python
import win32gui, pyautogui

win32gui.SetForegroundWindow(hwnd)
time.sleep(0.5)
cx = (btn_rect[0] + btn_rect[2]) // 2
cy = (btn_rect[1] + btn_rect[3]) // 2
pyautogui.click(cx, cy)
```

### 2. ปุ่ม/ไอคอนใน DataWindow (pbdw125) — ใช้ mouse_event ✓
> ใช้สำหรับ: ปุ่มดินสอ, ปุ่มที่ render อยู่ใน DataWindow

```python
import ctypes, win32api, win32con

win32gui.SetForegroundWindow(popup_hwnd)
time.sleep(0.4)
ctypes.windll.user32.SetCursorPos(target_x, target_y)
time.sleep(0.3)
win32gui.SetForegroundWindow(popup_hwnd)  # ทำซ้ำหลัง SetCursorPos
time.sleep(0.2)
win32api.mouse_event(win32con.MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0)
time.sleep(0.05)
win32api.mouse_event(win32con.MOUSEEVENTF_LEFTUP, 0, 0, 0, 0)
```
> **สำคัญ:** ห้ามเรียก `SetProcessDpiAwareness()` — ทำให้เมาส์ไม่ขยับ

### 3. หาปุ่มจาก Text (ไม่ต้อง IsWindowVisible)
```python
found = []
def cb(child, _):
    if win32gui.GetClassName(child) != "Button":
        return
    if "ข้อความปุ่ม" not in win32gui.GetWindowText(child):
        return
    r = win32gui.GetWindowRect(child)
    if r[2]-r[0] > 5 and r[3]-r[1] > 5:  # ขนาด > 5px
        found.append((child, r))
win32gui.EnumChildWindows(parent_hwnd, cb, None)
```
> PowerBuilder บางปุ่ม `IsWindowVisible = False` แม้แสดงอยู่จริง — ไม่ต้องกรอง visibility

## Popup เงื่อนไขการสร้างรายงาน — พิกัดภายใน

> popup หาด้วย class `FNWNS3125` + title "เงื่อนไขการสร้างรายงาน" (รองรับทุก resolution)
> screen coords ด้านล่างอ้างอิงจากเครื่อง 1920×1080 เท่านั้น

```
rect = (768, 257, 1153, 607)   ขนาด 385x350 px  (1920×1080)
```

| ปุ่ม | x% | y% | screen coords (1920×1080) |
|---|---|---|---|
| ดินสอ (เลือกคลัง) | 84% | 31% | (1091, 365) |
| ตกลง (ซ้าย) | ~15% | ~10% | บริเวณ (826, 282) |
| ออก | ~85% | ~10% | บริเวณ (1095, 282) |

> ปุ่มดินสอคลิกด้วย % ของ rect → รองรับทุก resolution
> ปุ่ม "All" ใน DataWindow ใช้ offset คงที่ `dw_rect[0]+45, dw_rect[1]+9` — ถ้าคลิกไม่ตรงบนเครื่องอื่นให้ปรับ offset ตาม DPI

## ขั้นตอนใน `main()` (รอบเดียว)

1. อ่านตัวเลือก (`--version` จบตรงนี้เลย) → เปิด log → อ่านค่าตั้ง (`.env`) → ขาด username/password = exit 2
2. ด่านกันชน: mutex → โปรเซส `SeniorsoftExport.exe` → `promaxxreport.exe` เปิดอยู่ ⇒ exit 3
3. **ตั้งค่าครั้งเดียว:** `launch_program` → `step_login` → `step_click_star` → `step_click_r01102`
   ⚠ ห้ามกดปุ่มดาว (`step_click_star`) ซ้ำ — เป็น **toggle** (กดซ้ำ = ปิด favorite) ลองใหม่จึงเริ่มที่ "กดสร้างรายงาน"
4. **ส่งออก** (ลองได้ `EXPORT_ATTEMPTS = 2` ครั้ง พัก `RETRY_PAUSE_SEC = 30` วินาที):
   `run_one_cycle(hwnd, ชื่อชั่วคราว)` = `step_create_report` → snapshot → `step_popup_condition` → `step_wait_export` → `step_select_file`
   แล้ว `_collect_export()` หาไฟล์ชื่อชั่วคราว ย้ายเป็น `SAVE_DIR\Allstock.CSV` — หาไม่เจอ = ครั้งนั้นล้มเหลว (ดูกติกาข้อ 6)
   · หน้าต่าง Report หาย = `find_window_by(cls=MENU_CLS, ...)` หาใหม่ (แบบเดียวกับลูปต้นฉบับ)
   · เทสจริงบนเครื่องพัฒนา 28 ก.ย. 2026: ตั้งแต่เปิดโปรแกรมจนปิดใช้ **51 วินาที**
5. `finally`: `close_promaxx(all_instances=True)`

- บอทใช้ **เมาส์/คีย์บอร์ดจริง** + `force_foreground` แย่งโฟกัสตลอดรอบ → ต้องไม่ล็อกหน้าจอ (ล็อก = `SetForegroundWindow`/mouse_event ไม่ทำงาน)
  Task ของ auto-r01 จึงต้องเป็น "Run only when user is logged on" (**ห้าม S4U** — ไม่มีหน้าจอให้คลิก)
- `step_select_file` พิมพ์ชื่อชั่วคราว → เซฟลงโฟลเดอร์ที่หน้าต่างจำไว้ → ย้ายเข้า `SAVE_DIR` ถ้าเจอในโฟลเดอร์ชุดตายตัว
  ที่เหลือ `_collect_export` ตามหาเองแล้วเปลี่ยนชื่อเป็น `Allstock.CSV` (`SAVE_DIR` = `--save-dir`)

### การเปิดโปรแกรม + Login (auto_r01_export.py)
- **EXE_PATH** = `C:\SeniorSoft ProMaxx\promaxxreport.exe` (หาได้จาก `Get-Process promaxxreport | Select Path`)
- `launch_program()` — เช็ค `is_promaxx_running()` ก่อน ถ้าเปิดอยู่แล้วข้าม; เปิดด้วย `subprocess.Popen([EXE_PATH], cwd=os.path.dirname(EXE_PATH))` (ต้องตั้ง cwd ให้ PowerBuilder หา INI/DLL เจอ) แล้วรอหน้า Login (`FNWNS3125`)
  - ⚠ ถ้า promaxx **เปิดค้างอยู่แล้ว บอทจะไม่เปิดหน้าต่างใหม่** (ใช้ instance เดิม) → ดูเหมือน "ไม่เรียกโปรแกรม" แต่ถูกต้อง; อยากเห็นมันเปิดเองให้ปิด promaxx ให้หมดก่อนรัน
- credentials: อ่านจาก `PROMAXX_USERNAME` / `PROMAXX_PASSWORD` (ตัวแปรระบบ → `.env` ข้าง exe) · ⛔ ห้ามใส่ค่าจริงในโค้ด/เอกสาร (repo นี้ PUBLIC)
- ย้ายเครื่อง: ถ้าติดตั้ง ProMaxx คนละที่ ตั้ง `PROMAXX_EXE_PATH` ใน `.env` — ไม่ต้อง build ใหม่

### รอ generate เสร็จก่อนกด ส่งออก — ต้องใช้ snapshot hwnd (สำคัญ)
> **ห้ามเช็ค Waiting ด้วย `GetWindowText`** — Waiting dialog ของโปรแกรมนี้ title ว่าง (`''`) จะหาไม่เจอ แล้วกด ส่งออก เร็วเกินไปทั้งที่ยังโหลด

`step_wait_export(hwnd, pre_hwnds)` ใช้วิธี:
1. `main()` ถ่าย `snapshot_promaxx_hwnds()` **ก่อนกด ตกลง (popup)**
2. หลังกด ตกลง → Waiting = hwnd ใหม่ที่ไม่อยู่ใน snapshot (กรองขนาด > 30px)
3. รอ hwnd ใหม่โผล่ (Phase 1) แล้ว**รอจนมันหาย** (Phase 2) = generate เสร็จ
4. รอแบบไม่จำกัดตราบใดที่ Waiting ยังอยู่; ยอมแพ้เฉพาะเมื่อ Waiting หายแต่ไม่เจอปุ่ม ส่งออก ติดต่อกัน 120s

### วิธี Debug เมื่อ flow ติด

**Step 1 — dump window ขณะโปรแกรมอยู่ในสถานะที่ติด:**

```python
import win32gui, win32process, psutil

def dump_promaxx():
    def top_cb(hwnd, _):
        try:
            _, pid = win32process.GetWindowThreadProcessId(hwnd)
            if "promaxxreport" not in psutil.Process(pid).name().lower():
                return
        except Exception:
            return
        r = win32gui.GetWindowRect(hwnd)
        if r[2]-r[0] < 5 or r[3]-r[1] < 5:
            return
        print(f"\nTOP hwnd={hwnd} cls={win32gui.GetClassName(hwnd)!r} "
              f"txt={win32gui.GetWindowText(hwnd)!r} rect={r}")
        def cb(child, _):
            r2 = win32gui.GetWindowRect(child)
            if r2[2]-r2[0] < 3 or r2[3]-r2[1] < 3:
                return
            print(f"  child={child} cls={win32gui.GetClassName(child)!r:35s} "
                  f"txt={win32gui.GetWindowText(child)!r:25s} "
                  f"vis={win32gui.IsWindowVisible(child)} rect={r2}")
        try:
            win32gui.EnumChildWindows(hwnd, cb, None)
        except Exception:
            pass
    win32gui.EnumWindows(top_cb, None)

dump_promaxx()
```

**Step 2 — อ่านผล:** ดู `cls=` และ `txt=` ของ child ที่ต้องการ แล้วแก้โค้ดใน flow ให้ตรง

**Step 3 — ถ้าหน้าต่างมี title ว่างหรือหาด้วย text ไม่ได้:** ใช้วิธี snapshot hwnd (ดูหัวข้อ "ปัญหา 3")

## Standard Windows File Dialog (Select File)

> ⚠ อ่านหัวข้อ **"Select File dialog อายุสั้น — กฎเหล็ก"** ด้านล่างก่อน — snippet นี้เป็นโครงพื้นฐาน
> แต่ของจริง dialog อายุสั้น/hwnd หลุด/visibility กระพริบ ต้องทำตามกฎเหล็กถึงจะเซฟติด

```python
import ctypes, win32gui, win32api, win32con

# หา dialog โดย title
dlg_hwnd = None
def cb(hwnd, _):
    global dlg_hwnd
    if "Select File" in win32gui.GetWindowText(hwnd) and win32gui.IsWindowVisible(hwnd):
        dlg_hwnd = hwnd
win32gui.EnumWindows(cb, None)

# หา controls ใน dialog
# filename Edit: cls='Edit', visible, width>200px
# filetype ComboBox: cls='ComboBox', visible — เลือกตัวที่มี y สูงสุด (ต่ำสุดใน dialog) ← รองรับทุก resolution
# Save button: cls='Button', text='&Save' หรือ 'Open'

# อ่านและเลือก ComboBox item
buf = ctypes.create_unicode_buffer(512)
count = ctypes.windll.user32.SendMessageW(combo_hwnd, 0x0146, 0, 0)  # CB_GETCOUNT
for i in range(count):
    ctypes.windll.user32.SendMessageW(combo_hwnd, 0x0148, i, buf)    # CB_GETLBTEXT
    # ค้นหา "csv" แล้วใช้ CB_SETCURSEL

# ตั้งชื่อไฟล์
ctypes.windll.user32.SendMessageW(edit_hwnd, 0x000C, 0, "All_stock") # WM_SETTEXT

# กด Save
win32api.SendMessage(save_btn_hwnd, win32con.BM_CLICK, 0, 0)
```

### ⭐ FLOW เซฟไฟล์ปัจจุบัน (ไม่แตะ dropdown ใดเลย — เซฟ default แล้ว move)
> หลังกด ส่งออก → Select File โผล่ → **พิมพ์ `Allstock.CSV` ลงช่อง File name ตรงๆ → กด Save** → ไฟล์ลงโฟลเดอร์ default → **move ไป `SAVE_DIR` ทีหลัง**
> - **ไม่ต้องเลือก dropdown "Save as type"** (ชนิดไฟล์) เลย — ใส่นามสกุล `.CSV` ในชื่อไฟล์เอง โปรแกรมรู้ฟอร์แมตจากนามสกุล
> - การข้าม dropdown "Save as type" ทำให้ dialog **ไม่ถูกสร้างใหม่** (เดิมพอเลือก CSV ใน dropdown dialog จะถูก recreate hwnd เปลี่ยน ช่องชื่อถูกล้าง) → flow สั้นและเสถียรขึ้นมาก
> - **ไม่นำทาง dropdown "Save in" (โฟลเดอร์) ด้วย** — Seniorsoft เข้าโฟลเดอร์ย่อยไม่ได้ (ดูหัวข้อถัดไป) → ปล่อยเซฟ default แล้ว move
> - โค้ด: `step_select_file()` → `type_filename_once()` พิมพ์ `type_name` (= `os.path.basename(SAVE_NAME)`) → กด Save → `find_saved_file()` + `shutil.move` ย้ายไฟล์ไป `SAVE_DIR`

#### ❌ นำทางโฟลเดอร์ปลายทางใน Select File ไม่ได้ — ทั้ง 2 วิธีพิสูจน์แล้วว่าไม่เวิร์ก (แก้ไข 2026-06-17)
> เคยลองทำให้บอท "เลือกโฟลเดอร์ `run-upload-stock` เอง" ใน Select File dialog — **ล้มเหลวทั้งคู่** จึงถอดออก แล้วใช้วิธี move แทน

1. **คลิก item ใน dropdown "Save in"** — ❌ ไม่เวิร์ก
   - dropdown "Save in" **ไม่ใช่ list โฟลเดอร์ธรรมดา** แต่เป็น **shell tree** (Desktop / This PC / ไดรฟ์ / Network ...) render แบบ **owner-drawn + เยื้องชั้น + scroll ได้** (มี ~53 items)
   - หา item `run-upload-stock` เจอจริงด้วย `LB_GETTEXT` แต่ **คลิกตามพิกัดที่คำนวณจาก `LB_GETITEMRECT` แล้วเพี้ยน** — เคยคลิกพลาดไปโดน 'Network' → Save in กลายเป็น Network (**แย่กว่าไม่นำทาง** เพราะเซฟ Network root ไม่ได้)
2. **พิมพ์ full path + Enter ในช่อง File name** (หวังให้ dialog เข้าโฟลเดอร์) — ❌ ไม่เวิร์ก
   - Select File ของ Seniorsoft (PB custom) **ไม่ navigate เข้าโฟลเดอร์** เมื่อพิมพ์ path + Enter (ต่างจาก comdlg32 มาตรฐาน)
   - สอดคล้องกฎเดิม "ห้ามใส่ full path ลงช่อง File name" (หัวข้อ "กฎเหล็ก" ข้อ 7)

> ✅ **วิธีที่ใช้จริง:** ปล่อยเซฟลงโฟลเดอร์ default ของ dialog → `find_saved_file()` วนหาไฟล์ stem-match ในหลายโฟลเดอร์ (รวม Desktop/Documents/Downloads/EXE dir) ที่ mtime ใหม่กว่าเวลา Save → `shutil.move` ย้ายมา `SAVE_DIR` → ได้ไฟล์ที่ `run-upload-stock` เหมือนกัน

#### ⚠ ข้อบังคับเรื่องชื่อไฟล์ (เรียนมาด้วยการ test จริง)
- **`SAVE_NAME = "Allstock.CSV"`** (ค่าคงที่หัวไฟล์)
- **นามสกุลต้องเป็น `.CSV` ตัวใหญ่** — ถ้าพิมพ์ `.csv` ตัวเล็ก **โปรแกรมจะไม่เซฟให้** (export ไม่สำเร็จ)
- **ห้ามมี underscore** — โปรแกรมพิมพ์ `All_stock` ไม่ได้ จึงใช้ `Allstock`
- พิมพ์ **ชื่อเต็มรวมนามสกุล** ลงช่อง (ต่างจากเดิมที่พิมพ์ชื่อล้วนแล้วพึ่ง dropdown เลือกนามสกุล)

> ตาราง Save as type index เดิม (เก็บไว้อ้างอิงเฉยๆ — flow ปัจจุบัน **ไม่ใช้แล้ว**):
> `0`=XLS, `1`=HTM, `2`=TXT, `3`=XLSX, `4`=CSV(*.CSV)

### ⚠ Select File dialog "อายุสั้น" — กฎเหล็กที่เรียนมาด้วยความเจ็บปวด

> dialog นี้พิเศษมาก แก้ปัญหาวนซ้ำหลายรอบเพราะไม่รู้ข้อพวกนี้ — อ่านก่อนแก้ flow เซฟไฟล์

1. **dialog ปิดตัวเองภายใน ~2 วินาทีหลังโผล่** → ต้อง "พุ่ง" ไปพิมพ์ชื่อ + กด Save ทันที
   ห้ามมีขั้นที่หน่วงเวลา (loop scan หลายวิ, sleep ยาว) คั่นระหว่างเจอ dialog กับกด Save
   - อาการเวลา dialog ตายแล้ว: `EnumWindows` หา title "Select File" ได้ `[]` (ไม่มีเลย) และสุดท้ายโปรแกรม promaxx ปิดตัวเอง
2. **ห้ามส่ง `CDM_GETFOLDERPATH` (0x0466) ให้ dialog** — เป็นตัวต้องสงสัยทำ dialog ปิด (โค้ดเก่า `get_dlg_folder()` ทำ flow พังทุกครั้ง) — เอาออกแล้ว
3. **อย่าวน `resolve_filename_edit` / re-scan หลายรอบ** — เผา 2.4s จน dialog ตายก่อนพิมพ์เสร็จ
4. **ช่อง Edit filename มี `WS_VISIBLE` กระพริบ** — `IsWindowVisible` คืน False เป็นพักๆ ทั้งที่เห็นช่องอยู่จริง → **ห้ามกรอง visibility** ตอนสแกนหาช่อง ให้ match ด้วย class+ขนาด+ตำแหน่งแทน
5. **hwnd ของ dialog/Edit หลุดง่าย** (พอเลือก CSV บางทีทั้ง dialog ถูกสร้างใหม่ hwnd เปลี่ยน) →
   - ใช้ `find_select_file_dialog()` หา hwnd "ที่ยังมีชีวิต" จาก title ก่อนทุกครั้งที่จะ foreground/คลิก
   - คลิกด้วย **พิกัดหน้าจอ** (layout ตายตัว) ไม่ใช่ cached hwnd
6. **focus ต้องเข้าช่อง Edit จริง** — `force_foreground` บน hwnd เก่า/ผิด จะดึงหน้าต่างผิดมาบัง แล้วคลิก/พิมพ์ลงผิดที่ (ช่องว่างเปล่า) → ใช้ hwnd ของ dialog ที่ยังมีชีวิต + **คลิกช่อง 2 ครั้ง** ให้ focus เข้า edit
7. **พิมพ์ชื่อไฟล์เต็ม `Allstock.CSV`** (ชื่อ+นามสกุล `.CSV` ตัวใหญ่) — **ห้ามใส่ full path** ลงช่อง File name
   - **`.CSV` ต้องตัวใหญ่** ไม่งั้นโปรแกรมไม่เซฟ; **ห้าม underscore** (โปรแกรมพิมพ์ไม่ได้)
   - flow ปัจจุบัน **พิมพ์นามสกุลลงในชื่อเลย แล้ว Save ทันที** ไม่แตะ dropdown (ดูหัวข้อ "⭐ FLOW เซฟไฟล์ปัจจุบัน")
   - วิธีพิมพ์ที่ทน: ตั้ง clipboard = ชื่อไฟล์ → คลิกช่อง 2 ครั้ง → Ctrl+A → Delete → `_type_unicode` (SendInput); ถ้าอ่านกลับว่าง fallback Ctrl+V
   - อ่านยืนยันด้วย `WM_GETTEXT` (0x000D) จาก Edit ที่สแกนเจอ
8. **`_set_clipboard` ต้องตั้ง restype/argtypes เป็น `c_void_p`** ให้ `GlobalAlloc`/`GlobalLock`/`SetClipboardData` — บน Python 64-bit ถ้าไม่ตั้ง handle จะถูกตัดเหลือ 32-bit → `GlobalLock` คืน NULL → `memmove` ลง address 0 → access violation

### ความหมาย popup หลังกด Save (#32770 title "SeniorSoft ProMaxx")
- มี Static `'ส่งออกไฟล์ไม่สำเร็จ'` + ปุ่ม OK = **Save ถูกกดจริงแล้ว แต่โปรแกรม export ไม่สำเร็จ** (ไม่ใช่กด Cancel — ถ้า Cancel dialog ปิดเงียบ ไม่มี popup)
- มี Static `'...สำเร็จ'` = เซฟสำเร็จ

#### สาเหตุ "ส่งออกไฟล์ไม่สำเร็จ" — root cause ที่เจอ
- ❌ **ไม่ใช่เรื่องโฟลเดอร์** — ยืนยันแล้ว: Save in = `Documents\ProMaxx_Export` (เขียนได้), name = `All_stock.csv`, type = CSV ครบ **ก็ยังไม่สำเร็จ**
- ✅ **เซฟด้วยมือ (ค่าเดียวกันเป๊ะ) สำเร็จ** → โปรแกรม/โฟลเดอร์/ข้อมูลไม่มีปัญหา = **เป็นที่วิธีบอทกดล้วนๆ**
- 🎯 **Select File นี้เป็น dialog ของ PowerBuilder เอง** (ไอคอนม่วง ไม่ใช่ Windows comdlg32 มาตรฐาน) → มันอ่านชื่อไฟล์จาก binding ภายในที่ **commit เฉพาะเมื่อมี keystroke จริง / ช่องเสีย focus จริง**
  - **`Ctrl+V` (paste) ไม่ commit** — ช่องเห็นข้อความแต่ buffer ภายในยังว่าง → export ไม่สำเร็จ
  - **`BM_CLICK` ปุ่ม Save ไม่ commit** — เพราะไม่ย้าย focus ออกจากช่อง (ต่างจากคลิกเมาส์จริง)
- ✅ **วิธีแก้ที่ใช้ (เลียนแบบเซฟมือ):**
  1. ตั้งชื่อไฟล์ด้วย **`SendInput` + `KEYEVENTF_UNICODE`** (ฟังก์ชัน `_type_unicode`) — วิธีนี้ดีสุด:
     - เป็น **keystroke จริง** (fire WM_CHAR/EN_CHANGE) → PB dialog **commit** ชื่อไฟล์เข้า buffer
     - ส่ง **Unicode codepoint ตรงๆ ไม่ผ่าน keyboard layout** → ได้ "Allstock.CSV" ถูกทุกเครื่อง (ไทย/อังกฤษ)
     - ⚠ ห้าม `pyautogui.typewrite` — มันแปลตาม layout ปัจจุบัน, layout ไทยจะเหลือแค่ `"."`
     - ⚠ paste (`Ctrl+V`) ใส่ข้อความถูกแต่ **ไม่ commit** (PB ไม่ได้ keystroke event) → export ไม่สำเร็จ; ใช้เป็น fallback เท่านั้น
  2. กด Save ด้วย **`pyautogui.click` คลิกเมาส์จริง** ที่ตำแหน่งปุ่ม Save (คลิกจริง → ช่องเสีย focus → PB commit อีกชั้น) — `BM_CLICK` เป็น fallback เฉพาะตอน dialog ยังไม่ปิด
  > สรุปหลัก: **dialog PB custom commit เฉพาะตอนมี input event "จริง"** → ใช้ `SendInput`(KEYEVENTF_UNICODE) พิมพ์ชื่อ + คลิกเมาส์จริงกด Save; message ล้วน (WM_SETTEXT/paste/BM_CLICK) ไม่ commit; typewrite พังเพราะ layout ไทย

> ⚠ **ctypes `SendInput` struct ต้องเผื่อ `MOUSEINPUT` ใน union** ให้ `sizeof(INPUT)==40` บน 64-bit — ถ้าใส่แค่ `KEYBDINPUT` จะได้ 32 → `cbSize` ไม่ตรง → SendInput เงียบ (ไม่พิมพ์อะไร)

> ⚠ `create_report.py` (ไฟล์ของต้นฉบับ ไม่ได้ก๊อปมา) **ไม่ verify ว่าไฟล์เกิดจริง** — กด OK บน dialog SeniorSoft อะไรก็ตามแล้วเคลม "บันทึกเสร็จ" ดังนั้น "มันเคยทำงานได้" อาจล้มเหลวเงียบๆ มาตลอด อย่าใช้เป็นหลักฐานว่า flow ถูก

## พิกัด Select File dialog (1920×1080, layout ตายตัว)
| control | rect | center |
|---|---|---|
| ComboBox "Save in" (บนสุด) | (419, 278, 641, 300) | (530, 289) |
| Edit "File name" | (446, 777, 1186, 797) | (816, 787) |
| ComboBox "Save as type" (ล่างสุด) | (446, 807, 1186, 828) | (816, 817) |
| Button `&Save` | (1205, 776, 1280, 799) | (1242, 787) |
| Button `Cancel` | (1205, 805, 1280, 828) | (1242, 816) |

> ปุ่ม `Open as &read-only` มีคำว่า "Open" ในข้อความ → match ปุ่ม Save/Open ต้องใช้ `txt.replace("&","").strip().lower() in ("save","open")` (ตรงเป๊ะ) ไม่ใช่ `"Open" in txt`

## แนวทางแก้ปัญหาเมื่อปุ่มไม่กดตาม Flow

### ปัญหา 1: หาปุ่มไม่เจอ
| สาเหตุ | แนวทาง |
|---|---|
| `IsWindowVisible = False` แม้แสดงอยู่ | ไม่ต้องกรอง visibility ใช้แค่ขนาด `> 5px` |
| ปุ่มอยู่ใน DataWindow (render content) | ใช้พิกัด % ของ rect แทน EnumChildWindows |
| parent ผิด | สแกนทุก top-level ของ promaxxreport ไม่ใช่แค่ hwnd เดียว |

### ปัญหา 2: กดปุ่มแล้วไม่ตอบสนอง
| สาเหตุ | แนวทาง |
|---|---|
| หน้าต่างยัง focus ไม่ได้ | `SetForegroundWindow` + `sleep(0.4+)` ก่อนคลิก |
| ปุ่มอยู่ใน `pbdw125` | เปลี่ยนจาก `pyautogui.click` → `mouse_event` |
| dialog เป็น WinForms (`WindowsForms10.Window`) | ปุ่มไม่โผล่ใน EnumChildWindows → คลิกตำแหน่ง % ของ rect หรือกด `Enter` |

### ปัญหา 3: กดเร็วเกินไป (ยังโหลดไม่เสร็จ)
> **วิธี Snapshot hwnd** — ใช้เมื่อ dialog กำลังโหลดมี title ว่าง หรือหาด้วย text ไม่ได้

```python
# 1. snapshot ก่อน trigger
pre_hwnds = snapshot_promaxx_hwnds()

# 2. trigger action (สร้างรายงาน ฯลฯ)
click_action()

# 3. รอ hwnd ใหม่ปรากฏ
for _ in range(30):
    new = snapshot_promaxx_hwnds() - pre_hwnds
    new = {h for h in new if rect_size(h) > 30}
    if new:
        break
    time.sleep(0.5)

# 4. รอ hwnd ใหม่หายไป = action เสร็จ
while new & snapshot_promaxx_hwnds():
    time.sleep(1)
```
> Waiting dialog ของโปรแกรมนี้มี title ว่าง (`''`) เนื้อหา "Waiting..." render อยู่ใน `pbdw125` ข้างใน — หาด้วย `GetWindowText` ไม่ได้

### ปัญหา 4: dialog ทับไฟล์ "มีชื่อไฟล์นี้อยู่แล้ว คุณต้องการบันทึกทับหรือไม่" (Yes/No)
มี 2 แบบ — โค้ดรองรับทั้งคู่:
- **แบบ Win32 ปกติ:** ปุ่มเป็น `Button` (text `Yes`/`ใช่`) → `EnumChildWindows` หาเจอ คลิกกึ่งกลางปุ่มได้เลย
- **แบบ WinForms:** class `WindowsForms10.Window.8.app.0.141b42a_r6_ad1` ปุ่มไม่โผล่ใน EnumChildWindows → **fallback คลิกตำแหน่ง `x=30%, y=80%`** ของ dialog rect

> handler: ลอง EnumChildWindows หาปุ่ม `Yes`/`ใช่` ก่อน ถ้าไม่เจอค่อยคลิกตามตำแหน่ง — ครอบคลุมทั้ง 2 แบบ

**ข้อผิดพลาดที่พบ:** ค้นหา dialog ด้วย `"SeniorSoft" in title` แต่หน้าต่างหลัก (`FNWND3125`) ก็มีชื่อ "SeniorSoft ProMaxx" และถ้า minimize อยู่จะมี rect `(-32000, -32000, ...)` — ทำให้ได้พิกัดผิดเช่น `(-31960, -31977)`

**วิธีค้นหา dialog ที่ถูกต้อง — ต้องกรอง 3 อย่าง:**
```python
def conf_cb(h, _):
    nonlocal conf_hwnd
    if win32gui.GetClassName(h) in ("FNWND3125", "FNWNS3125"):
        return  # skip หน้าต่างหลัก PowerBuilder
    if "SeniorSoft" in win32gui.GetWindowText(h) and win32gui.IsWindowVisible(h):
        r = win32gui.GetWindowRect(h)
        if r[0] > -500 and r[2]-r[0] > 50 and r[3]-r[1] > 50:
            conf_hwnd = h
```
> ใช้รูปแบบนี้กับทุก dialog ที่ค้นหาด้วย title "SeniorSoft" (รวมถึง success dialog หลัง export)

## ความเข้ากันได้ข้ามเครื่อง

- **ตำแหน่งหน้าต่าง:** ไม่มีผล — โค้ดอ่าน `GetWindowRect` ทุกครั้งก่อนคลิก วางหน้าต่างไว้มุมไหนก็ได้
- **ขนาดหน้าต่าง:** ไม่มีผล — PowerBuilder 12.5 มีขนาด window คงที่ (resize ไม่ได้) ทุกเครื่องเท่ากัน
- **Resolution:** ไม่มีผล — พิกัดทุกจุดคำนวณจาก % ของ rect ที่อ่าน runtime
- **DPI Scaling:** ต้องเป็น **100% เท่านั้น** — ถ้า scaling ≠ 100% จะเกิด mismatch ระหว่าง logical กับ physical pixels
- **Minimize:** โค้ดจัดการแล้วด้วย `SW_RESTORE` ก่อนทำงาน

> สรุป: รันได้ทุกเครื่องที่ Windows Display Scaling = 100% โดยไม่ต้องปรับโค้ด

## Build + วางบนเครื่องจริง

ต้องมี Python + `python -m pip install pywin32 psutil pyautogui pyinstaller`
(เครื่องพัฒนา `BIG-IT` มีครบแล้ว: Python 3.11 · PyInstaller 6.16)

```powershell
.\auto-r01\bot-export\build_exe.bat
```

- ได้ **`auto-r01\AutoR01Export.exe`** (~70 MB · รวม Python + pywin32/psutil/pyautogui ในตัว — OpenCV ของเครื่อง build ติดมาด้วยเพราะ pyautogui import แบบ optional ต้นฉบับก็ขนาดเท่ากัน) — อยู่ใน `.gitignore`
  **ไม่เข้า git** ⇒ ต้อง build เองแล้วก๊อปไปวาง · build ซ้ำทุกครั้งที่แก้ `auto_r01_export.py`
- เครื่องปลายทางไม่ต้องมี Python/library แต่ต้อง **Display Scaling = 100%** · login ค้างไว้ · ห้ามล็อกจอ
- วางที่ `BIGYAMAINPC`: ก๊อป `AutoR01Export.exe` + `.env` ไปไว้**ข้าง `auto_r01_import.py`** แล้วรัน
  `AutoR01Export.exe --version` ต้องเห็นรุ่นที่ build (`VERSION` หัวไฟล์ — **แก้โค้ดแล้วเปลี่ยนเลขนี้ด้วย**)
- ⚠ ครั้งแรก Windows SmartScreen/Antivirus อาจเตือน (exe ไม่ได้ code-sign) → "More info → Run anyway"

### ✅ วิธียืนยันว่า .exe มีโค้ดใหม่จริง (ไม่ใช่ build เก่าค้าง)

1. **ดู build log** — ต้องมี `Building EXE from EXE-00.toc completed successfully` (`build_exe.bat` ใช้ `--clean` อยู่แล้ว)
2. **`AutoR01Export.exe --version`** — ปลอดภัย ไม่เปิด ProMaxx
3. **แกะ bytecode จากใน exe** (ชัวร์สุด):
   ```python
   import marshal
   from PyInstaller.archive.readers import CArchiveReader
   car  = CArchiveReader(r"auto-r01\AutoR01Export.exe")
   code = marshal.loads(car.extract("auto_r01_export"))    # โมดูลหลักอยู่ใน CArchive ไม่ใช่ PYZ
   print("upload_to_supabase" in code.co_names)            # ต้องได้ False
   print([c for c in code.co_consts if isinstance(c, str) and c.startswith("2026-")])  # VERSION
   ```
   - ⚠ grep หา string ในไฟล์ .exe ตรงๆ ไม่เจอ — PyInstaller เก็บ bytecode แบบ zlib-compressed ต้องแกะก่อน

## ข้อควรระวัง
- `pyautogui.click(x, y)` ใช้ได้กับปุ่ม Button ปกติ
- ไอคอนใน `pbdw125` DataWindow ต้องใช้ `mouse_event` เสมอ
- ต้อง `SetForegroundWindow` ก่อนคลิกทุกครั้ง และรอ `sleep(0.4+)` ให้หน้าต่าง active จริง
- Toolbar star button = ปุ่ม Button ขนาด 12–35px เรียงจากซ้าย index [2]
- ห้ามเรียก `SetProcessDpiAwareness()` — ทำให้เมาส์ไม่ขยับ
- **`pyautogui.FAILSAFE = False`** (หัวไฟล์, แก้ไข 2026-06-13) — บอทใช้เมาส์จริงตลอด ถ้าเปิด fail-safe ไว้ พอเมาส์ขยับไปโดน**มุมจอ** (ผู้ใช้เขยิบเมาส์/พิกัดตกมุม) จะ throw `FailSafeException` ทั้งรอบพัง; ปิดทิ้งเพื่อให้บอททนต่อการแย่งเมาส์
  - อาการตอนยังเปิด: `pyautogui.FailSafeException: ... fail-safe triggered from mouse moving to a corner` (เคยทำ loop ล้มทั้งรอบ)
- **`step_create_report` เช็ค minimize ก่อนคลิก** — ถ้า `btn_rect[0] < -500` (หน้าต่าง minimize → พิกัด `-32000`) ให้ `SW_RESTORE` + อ่าน rect ใหม่ก่อน `pyautogui.click` ไม่งั้นคลิกพิกัดติดลบ = ตกมุมจอ
