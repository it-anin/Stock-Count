# PromaxxHelper — ตัวช่วยของปุ่ม "🖥️ บันทึกลง PROMAXX" (หน้า 📦 ปรับปรุงสินค้า)

> ⚠️ **สถานะ (3 พ.ย. 2026 รุ่น `2026-11-03.2`): ตรวจโครงหน้าต่างจริงแล้ว (อ่านอย่างเดียว) และเติม `STEP_SPECS` แล้ว แต่ยัง "ไม่เคยคลิก/พิมพ์ ProMaxx จริงเลย"**
> ตรวจพบว่า `ssmaxx.exe` เป็นแอป **WPF (.NET)** — ข้างในไม่มี HWND/HMENU ให้ Win32 มองเห็น (ต่างจากบอทเดิมที่ขับ `promaxxreport.exe` แบบ PowerBuilder Win32)
> ตัวช่วยจึงหาเป้าด้วย **UI Automation (UIA)** ผ่าน `promaxx_uia.py` แล้วคลิกเมาส์จริงที่กึ่งกลางพิกัดที่ UIA ให้ (ดู §UIA ด้านล่าง)
> `LOCATORS_VERIFIED = False` ยังคงอยู่ — ปุ่มบนเว็บยังได้ `UNVERIFIED` และไม่คลิกอะไร จนกว่าจะพิสูจน์ด้วยการ `--dry-run` → คลิกจริงทีละขั้น → ORDS ×10 / IRPS ×10 จาก cold start (§ตรวจหน้าต่างจริง ขั้น 3–4)

## คืออะไร / ทำไมต้องมี

หน้าเว็บ (เบราว์เซอร์) สั่งเปิด/คลิกโปรแกรม Windows โดยตรงไม่ได้ จึงมีโปรแกรมเล็กๆ นี้รันบน**เครื่องเดียวกับ ProMaxx** คอยฟังคำสั่งที่ `127.0.0.1` (เฉพาะในเครื่อง)

```
[Chrome/Edge: หน้า 📦 บน https://anin-stock-count.vercel.app]   (Desktop · pharmacist/supervisor)
   │ กดปุ่ม "บันทึกลง PROMAXX"   (ชนิดมาจากแท็บ: ords → ORDS/เอกสารจ่าย/O · irps → IRPS/เอกสารรับ/I)
   │ fetch POST http://127.0.0.1:47831/v1/open-import   {"proto":1,"type":"ORDS"|"IRPS"}
   ▼
[PromaxxHelper.exe — เครื่องเดียวกัน เปิดตอน Windows login]
   │ เปิด ssmaxx.exe → ล็อกอิน (ครั้งเดียว ไม่ retry) → เมนูเอกสารรับ/จ่าย → ปุ่ม I/O → ปุ่ม "นำเข้าไฟล์เอกสาร" → หยุด
   ▼
[ssmaxx.exe]
```

**ขั้นที่ 1 หยุดที่ปุ่ม "นำเข้าไฟล์เอกสาร" โดยตั้งใจ** — ยังไม่เลือกไฟล์ ไม่นำเข้า ไม่บันทึกอะไรลง ProMaxx (ผู้ใช้สั่ง: "ทำแค่ถึงตรงนี้ก่อน เพื่อตรวจว่าคลิกถูกและแม่นยำ")

## ไฟล์ในโฟลเดอร์นี้

| ไฟล์ | หน้าที่ |
|---|---|
| `promaxx_helper.py` | ตรรกะทั้งหมดที่ไม่ผูกกับ Windows: ค่าตั้ง/`.env` · เซิร์ฟเวอร์ HTTP · ตรวจ Origin/Host/header · single-flight · ตัวรันขั้นตอน (เงื่อนไขก่อน/หลังทุกขั้น) · รหัส error · CLI · log · `STEP_SPECS` |
| `promaxx_win.py` | ตัวต่อ Windows (`pywin32`/`psutil`/`pillow` — import แบบ lazy): หา process/หน้าต่าง · เมนู · SendInput · เมาส์ · screenshot · dump · mutex |
| `promaxx_uia.py` | ตัวอ่าน UIA ของ ssmaxx.exe ผ่าน Windows PowerShell 5.1 + .NET (ไม่ต้องลงแพ็กเกจเพิ่ม · อ่านอย่างเดียว): `ping` / `find` / `dump` · สคริปต์ ASCII ล้วนฝังในไฟล์ · คำถามส่งเป็น base64 |
| `.env.example` | แม่แบบค่าตั้ง (คัดลอกเป็น `.env` — **ห้ามเข้า git**) |
| `build_exe.bat` · `PromaxxHelper.spec` | build เป็น `PromaxxHelper.exe` (PyInstaller) — exe **ไม่เข้า git** |
| `run_promaxx_helper.bat` | รันจากซอร์ส (เครื่องปรับจูน) |
| `install_startup.bat` | ใส่ shortcut ใน Startup ให้ตัวช่วยเปิดเองตอน Windows login |

เทสอัตโนมัติ (รันบน Linux ได้ ไม่ต้องมี Windows/ProMaxx): `tests/specs/logic/promaxx-helper-core.spec.js` + `tests/specs/logic/adjust-doc-promaxx.spec.js` — ใช้หน้าต่าง ssmaxx **ปลอม** (`tests/lib/fake_ssmaxx.py`) ชื่อ class/ป้าย/พิกัดในนั้นเป็นของสมมติสำหรับเทสเท่านั้น **ไม่ใช่ข้อมูลของ ProMaxx จริง**

## ติดตั้งบนเครื่อง ProMaxx แต่ละเครื่อง

1. **build** (ทำครั้งเดียว บนเครื่องที่มี Python 3.11+): `python -m pip install pywin32 psutil pillow pyinstaller` แล้วดับเบิลคลิก `build_exe.bat` → ได้ `PromaxxHelper.exe` ข้างไฟล์ (ท้าย build พิมพ์ `--version` ให้ดู)
2. **วางไฟล์** `PromaxxHelper.exe` ไว้โฟลเดอร์เดียวกับ `.env` (เช่น `C:\PromaxxHelper\`)
3. **สร้าง `.env`** จาก `.env.example` — ใส่ `PROMAXX_USERNAME` / `PROMAXX_PASSWORD` (บัญชีที่เอกสารจะลงชื่อ) · ใส่ `PROMAXX_EXE_PATH` เฉพาะเมื่อ `ssmaxx.exe` ไม่ได้อยู่ที่ `C:\SeniorSoft ProMaxx\`
   - ⛔ `.env` มีรหัสผ่าน — **repo นี้เป็น PUBLIC ห้ามเข้า git** (อยู่ใน `.gitignore` แล้ว) · หน้าเว็บไม่เคยเห็นหรือส่งรหัสนี้ · ตัวช่วยไม่ใส่รหัสลง log/ผลลัพธ์/screenshot
   - ควรจำกัดสิทธิ์ไฟล์ให้เฉพาะผู้ใช้ Windows ของเครื่องนั้น (คลิกขวา → Properties → Security)
4. **ตรวจรุ่น**: `PromaxxHelper.exe --version` → `PromaxxHelper 2026-11-03.1 proto=1 locatorsVerified=False`
5. **ตรวจสภาพเครื่อง**: `PromaxxHelper.exe --find` (อ่านอย่างเดียว) แล้วดูข้อต่อไปนี้ให้ครบ
   - Display Scaling ต้อง **100%** (ไม่ใช่ 125%/150% — พิกัดคลิกจะเพี้ยน)
   - `session ของ helper` ต้องเท่ากับ `session ของหน้าจอ (console)` (ไม่งั้นมองไม่เห็นหน้าต่างของผู้ใช้)
   - `helper รันแบบ Administrator` ต้องเท่ากับสิทธิ์ที่ ssmaxx.exe รัน — ถ้า ProMaxx รันแบบ Administrator แต่ตัวช่วยไม่ใช่ ข้อความที่พิมพ์/คลิกจะไม่ถึง (Windows กั้น) ⇒ ให้รันตัวช่วยด้วยสิทธิ์เดียวกัน
   - พบ `ssmaxx.exe` (บรรทัด "พาธที่ลองหา")
6. **ให้เปิดตอน Windows login**: ดับเบิลคลิก `install_startup.bat` (ทำเป็นผู้ใช้ที่นั่งทำงานที่เครื่องนั้น ไม่ใช่ผู้ใช้อื่น) — ถอนด้วยการลบ `PromaxxHelper.lnk` ในโฟลเดอร์ที่เปิดด้วย `explorer shell:startup`
   - ตัวช่วยเปิดเป็นหน้าต่างคอนโซล (ย่อไว้) · **ปิดหน้าต่างนั้น = ตัวช่วยหยุด**
7. **เบราว์เซอร์: สิทธิ์ Local Network Access (LNA)** — ดูหัวข้อถัดไป

### เบราว์เซอร์ถามสิทธิ์ Local Network Access

Chrome/Edge รุ่นใหม่จะถามสิทธิ์เมื่อหน้าเว็บ https เรียก `127.0.0.1` (หน้าเว็บส่ง `targetAddressSpace:'loopback'` และตรวจสถานะด้วย `navigator.permissions.query({name:'loopback-network'})` ไว้แล้ว):

- **กดปุ่มครั้งแรก** เบราว์เซอร์อาจขึ้นกล่องถาม → เลือก **Allow** (ถ้าเคยกด Block ให้เปิดที่ไอคอนหน้าเว็บข้าง URL → Site settings → Local network → Allow)
- **อนุญาตล่วงหน้าทุกเครื่องด้วย policy** (IT) — ⚠️ **ตัวอย่างนี้ยังไม่ได้ทดสอบกับ Chrome/Edge รุ่นที่ใช้จริงในร้าน** ชื่อ policy และ path มาจากเอกสารทางการ ([Chrome](https://developer.chrome.com/docs/modern-web-guidance/guides/security/local-network-access) · [Microsoft Learn](https://learn.microsoft.com/ecdn/how-to/configure-local-network-access-policy)) แต่แหล่งต่างๆ ระบุรุ่นที่เริ่มบังคับไม่ตรงกัน ⇒ ทำแล้วเปิด `chrome://policy` / `edge://policy` ตรวจว่า `LocalNetworkAccessAllowedForUrls` ขึ้นสถานะ **OK** (ถ้าขึ้น Unknown policy = ชื่อไม่ตรงรุ่นนั้น ให้ลบ key แล้วใช้วิธีกด Allow)

```powershell
# รันใน PowerShell แบบ Administrator — เขียน policy ระดับเครื่อง (ทุกผู้ใช้ของเครื่องนี้)
$site = 'https://anin-stock-count.vercel.app'
foreach ($p in 'HKLM:\SOFTWARE\Policies\Google\Chrome\LocalNetworkAccessAllowedForUrls',
               'HKLM:\SOFTWARE\Policies\Microsoft\Edge\LocalNetworkAccessAllowedForUrls') {
  New-Item -Path $p -Force | Out-Null
  New-ItemProperty -Path $p -Name '1' -Value $site -PropertyType String -Force | Out-Null
}
# ถอน: Remove-Item 'HKLM:\SOFTWARE\Policies\Google\Chrome\LocalNetworkAccessAllowedForUrls','HKLM:\SOFTWARE\Policies\Microsoft\Edge\LocalNetworkAccessAllowedForUrls' -Recurse
```

- Firefox/Safari ไม่รองรับ/ไม่รับประกัน — ใช้ Chrome หรือ Edge

## สัญญา HTTP (หน้าเว็บ ↔ ตัวช่วย)

ฟังที่ `127.0.0.1` เท่านั้น (พอร์ต `HELPER_PORT` ค่าเริ่มต้น **47831** — ต้องตรงกับ `PROMAXX_HELPER_URL` ใน `index.html`)

| คำขอ | หน้าที่ |
|---|---|
| `OPTIONS *` | preflight — ตอบ `Access-Control-Allow-Origin` เฉพาะ Origin ที่อนุญาต + `Access-Control-Allow-Private-Network: true` + `Vary: Origin` |
| `GET /v1/health` | `{ok,proto,version,ssmaxxRunning,busy,locatorsVerified}` — ตรวจว่าตัวช่วยเปิดอยู่ (หน้าเว็บ**ไม่**ยิงตอนเปิดป็อปอัพ เพื่อไม่ให้ prompt สิทธิ์โผล่เอง) |
| `POST /v1/open-import` | body `{"proto":1,"type":"ORDS"\|"IRPS"}` เท่านั้น → 200 `{ok:true,reached,steps:[{name,ok,ms}],elapsedMs}` หรือ `{ok:false,code,step,message,steps}` |

ด่านตรวจทุกคำขอ (ไม่ผ่าน = ปฏิเสธก่อนแตะ ProMaxx): `Host` ต้องเป็น `127.0.0.1:พอร์ต`/`localhost:พอร์ต` (กัน DNS rebinding) · `Origin` ต้องอยู่ใน allow-list (`https://anin-stock-count.vercel.app` + `HELPER_ALLOWED_ORIGINS`) · `Content-Type: application/json` + header `X-Anin-Helper: 1` (บังคับให้เบราว์เซอร์ส่ง preflight) · body ≤ 2 KB · field ต้องมีแค่ `proto`,`type` · `type` ต้องเป็น `ORDS` หรือ `IRPS`

### รหัสที่ตัวช่วยตอบ (และหน้าเว็บแสดงอะไร)

| `code` | HTTP | ความหมาย | วิธีแก้ |
|---|---|---|---|
| `UNVERIFIED` | 422 | ตัวช่วยยังไม่ผ่านการตรวจหน้าต่างจริง (`LOCATORS_VERIFIED=False`) | ทำ §ตรวจหน้าต่างจริง · **สถานะปัจจุบันของทุกเครื่อง** |
| `NOT_CONFIGURED` | 422 | `.env` ไม่มีรหัส หรือหา `ssmaxx.exe` ไม่เจอ | เติม `PROMAXX_USERNAME/PASSWORD` · `PROMAXX_EXE_PATH` |
| `NO_DESKTOP` | 422 | ไม่มีหน้าจอให้คลิก (ล็อกจอ/ไม่ใช่ session ผู้ใช้) | ปลดล็อกจอ · รันตัวช่วยใน session ของผู้ใช้ที่นั่งอยู่ |
| `UNSUPPORTED_DPI` | 422 | Display Scaling ไม่ใช่ 100% | Settings → Display → Scale = 100% แล้วออก/เข้า Windows ใหม่ |
| `ALREADY_RUNNING` | 409 | `ssmaxx.exe` เปิดอยู่แล้ว (ผู้ใช้เลือก: ปฏิเสธ ไม่เกาะหน้าต่างเดิม) | ปิด ProMaxx ก่อนแล้วกดใหม่ |
| `OTHER_BOT_RUNNING` | 409 | บอทอื่นกำลังใช้ ProMaxx (`SeniorsoftExport.exe`/`AutoR01Export.exe`) | รอให้จบ (บอทใช้เมาส์จริง ขับพร้อมกันไม่ได้) |
| `BUSY` | 409 | ตัวช่วยกำลังทำงานคำสั่งก่อนหน้า | รอ |
| `NOT_RUNNING` | 409 | (CLI `--step` เท่านั้น) ขั้นกลางต้องเปิด `ssmaxx.exe` ค้างไว้ที่หน้าก่อนหน้าก่อน | เปิดโปรแกรมไปที่หน้านั้นแล้วรันใหม่ |
| `FORBIDDEN_ORIGIN/HOST/HEADER` | 403 | เว็บที่เรียกไม่อยู่ใน allow-list / Host ผิด / ขาด header | ถ้าเปิดจาก Vercel preview ให้เพิ่มใน `HELPER_ALLOWED_ORIGINS` |
| `PROTO_MISMATCH` / `BAD_REQUEST` | 400 | รุ่นตัวช่วยกับหน้าเว็บไม่ตรง หรือ body ผิด | อัปเดต `PromaxxHelper.exe` |
| `LAUNCH_FAILED` | 500 | เปิด ProMaxx ไม่ขึ้น/ขึ้นกล่องผิดพลาด (เช่นต่อ SQL Server ไม่ได้) | อ่านข้อความ · ตรวจว่าเครื่อง SQL Server (BIGYAMAINPC) เปิดอยู่ |
| `LOGIN_FAILED` | 500 | ล็อกอินไม่ผ่าน — **ไม่ลองซ้ำ** (กันบัญชีถูกล็อก) | ตรวจรหัสใน `.env` · ล็อกอินมือเองเพื่อดูว่าบัญชีถูกล็อกหรือไม่ |
| `INTERFERENCE` | 500 | เมาส์ไม่อยู่ที่เป้าหลังสั่งขยับ (ผู้ใช้ขยับเมาส์ระหว่างทำงาน) | อย่าแตะเมาส์/คีย์บอร์ด ~1 นาที แล้วลองใหม่ |
| `UNEXPECTED_DIALOG` / `FOCUS_LOST` | 500 | มีกล่องข้อความแปลกแทรก / หน้าต่าง ProMaxx ไม่อยู่ด้านหน้า | อ่านข้อความ (อยู่ใน `runs/<เวลา>_<code>/`) |
| `LOCATOR_MISSING` / `LOCATOR_NOT_FOUND` / `LOCATOR_NOT_UNIQUE` | 500 | ยังไม่มีค่าตั้งของขั้นนั้น / ไม่พบเป้า / พบเป้ามากกว่า 1 (ไม่เดา) | ทำ §ตรวจหน้าต่างจริง หรือหน้าต่าง ProMaxx เปลี่ยนหน้าตา |
| `PRECONDITION_FAILED` / `POSTCONDITION_FAILED` | 500 | ก่อนลงมือ: ยังไม่เห็นหน้าจอที่ขั้นนั้นต้องใช้ (รอครบเวลาแล้ว — ยังไม่คลิก/ไม่พิมพ์อะไร) / หลังคลิก: หน้าจอไม่เปลี่ยนเป็นหน้าที่ควรเป็น | ดู `runs/` · อาจมี popup หรือขั้นก่อนหน้าไม่ได้พาไปถึงหน้านั้นจริง |
| `UIA_ERROR` | 500 | อ่านโครงหน้าต่างด้วย UIA (PowerShell) ไม่ได้ ติดกันเกิน 3 ครั้ง / หมดเวลา / ผลไม่ใช่ JSON — ไม่คลิกต่อ | รัน `--find` ดูบรรทัด "UIA (PowerShell)" · ตรวจว่า Windows PowerShell 5.1 ใช้ได้ (นโยบายองค์กร/โปรแกรมป้องกันไวรัสอาจบล็อก) |
| `INTERNAL` / `STEP_FAILED` | 500 | ข้อผิดพลาดภายในตัวช่วย / ฝ่าฝืนกติกา "ห้ามส่ง input หลังปุ่มนำเข้า" | ดู `promaxx_helper.log` ข้างตัวช่วย แล้วแจ้งผู้พัฒนา |

เมื่อขั้นตอนล้ม ตัวช่วยเก็บหลักฐาน (`dump.txt` / `dump.json` / `screen.png` / `result.json`) ที่ `runs\<เวลา>_<code>\` **ข้างตัวช่วยบนเครื่องนั้น** (เก็บล่าสุด 30 โฟลเดอร์) — รหัสผ่านถูกปิดเป็น `***` · ภาพหน้าจออาจมีข้อมูลธุรกิจ ⛔ **ห้ามเข้า git** (อยู่ใน `.gitignore`)

## กติกาที่ห้ามละเมิดเมื่อแก้โค้ด

1. หน้าเว็บส่งได้แค่ `type` = `ORDS`|`IRPS` — **ห้ามรับ path/คำสั่ง/รหัสผ่านจากเว็บ** (field แปลกปลอม = 400)
2. ขับเฉพาะหน้าต่างของ process `ssmaxx.exe` · ก่อนพิมพ์/คลิกทุกครั้ง foreground ต้องเป็นของ ssmaxx · หา control ต้อง **พบ 1 รายการพอดี** (0 หรือ >1 = หยุด ห้ามเดา)
3. **ล็อกอินครั้งเดียว ห้าม retry อัตโนมัติ** · รหัสผ่านห้ามลง log/ผลลัพธ์/screenshot
4. `ssmaxx.exe` เปิดอยู่แล้ว = ปฏิเสธ ไม่แตะอะไร
5. `LOCATORS_VERIFIED` เป็น `True` ได้ต่อเมื่อมีผลตรวจจริงครบ (ดูด้านล่าง) — ⛔ ห้ามเปลี่ยนเพื่อให้ปุ่มทำงาน
6. หลังคลิกปุ่ม "นำเข้าไฟล์เอกสาร" **ห้ามส่ง input เพิ่ม** (ขั้นถัดไปต้องขออนุมัติ)
7. ห้ามขับ ProMaxx พร้อมบอทอื่น (`HELPER_BLOCK_PROCS`)
8. ห้ามเรียก `SetProcessDpiAwareness` · ช่องกรอกของ PowerBuilder ต้องเป็น keystroke จริง (SendInput Unicode — ห้าม paste/`WM_SETTEXT`) · เนื้อใน DataWindow (`pbdw125`) ต้องคลิกด้วยเมาส์จริง (บทเรียนจากบอท `auto-r01/bot-export/CLAUDE.md`)
9. แก้โค้ดแล้วเปลี่ยน `VERSION` ใน `promaxx_helper.py` ทุกครั้ง (ใช้ตรวจด้วย `--version` ว่าวางไฟล์ถูกรุ่น) · เครื่องร้านไม่ใช่ git clone — ต้องก๊อป `PromaxxHelper.exe` ไปวางเองทุกครั้ง

## UIA — ที่มาของ `STEP_SPECS` (ตรวจ 3 พ.ย. 2026 · Build ProMaxx 10.00.10.0025 · อ่านอย่างเดียว ยังไม่เคยคลิกจริง)

เก็บโครงสร้างด้วย UIA ทีละหน้าจอ (หน้า Login → หน้าหลัก → เมนูเอกสารรับ/จ่าย → ฟอร์มเอกสาร → กล่อง Select File) ได้ข้อมูลดังนี้ (เก็บเฉพาะโครงสร้าง ไม่มีข้อมูลธุรกิจ):

| ขั้น | เป้า (AutomationId / ชนิด) | ตัวตรวจผล |
|---|---|---|
| launch | หน้าต่างระดับบน class `HwndWrapper[ssmaxx.exe;;<GUID เปลี่ยนทุกครั้ง>]` ชื่อ "SeniorSoft ProMaxx" (ต้องใช้ `cls_re`) | `uo_login_panel` มองเห็น |
| login | ช่องชื่อผู้ใช้ `cf_empid` (TextBox) ↔ `cf_empid:1` (DWTextBlock) · รหัสผ่าน `cf_pass` (**PasswordBox**) ↔ `cf_pass:1` · ปุ่ม `cb_Login` | `uo_login_panel` หาย + ListItem "เอกสารรับ" ใน `lbx_manumain` |
| menu | ListItem ชื่อ "เอกสารรับ"/"เอกสารจ่าย" ใต้ `lbx_manumain` (**ไม่มี id** ต้องใช้ชื่อ) | Button id `I`/`O` ใต้หน้าคลาส `ui_mainmenu_tranin/tranout_style2` |
| doc-button | Button id `I` (รับ) / `O` (จ่าย) | TabItem ชื่อเมนู ใต้ `MDI_TAB` + ปุ่มนำเข้าใต้ฟอร์มคลาส `pn_trans_in` / `pn_trans_out` |
| import-button | Button `uo_tran_bt_import` · **HelpText ต้องตรง "นำเข้าไฟล์เอกสาร"** · ใต้คลาสฟอร์มข้างต้น | หน้าต่างระดับบน `#32770` ชื่อ "Select File" ของ ssmaxx (หน้าต่างหลักถูกล็อก) |

**กติกาที่ต้องจำ (เจอจริงจากการตรวจ):**
- ช่องล็อกอินเป็น PowerBuilder DataWindow ที่ **สลับชนิดตามโฟกัส** (TextBox/PasswordBox เมื่อกำลังพิมพ์ · DWTextBlock เมื่อไม่ได้โฟกัส) → spec ระบุ id ทั้งสองแบบ และ **ต้อง `await` ให้ช่องที่ถูกชนิด (คลาส `TextBox` / `PasswordBox`) ได้รับโฟกัสก่อนพิมพ์** ไม่งั้นหยุด (ไม่พิมพ์รหัสลงช่องที่ไม่ใช่ช่องรหัสผ่าน)
- `IsOffscreen` ของ UIA **เชื่อไม่ได้อย่างเดียว**: หลังเปิดฟอร์ม หน้าเมนูถูกเลื่อนไปนอกกรอบหน้าต่าง (x ≈ +1900) แต่ปุ่ม I/O ยังรายงาน `IsOffscreen=False` → ตัวช่วยตรวจพิกัดด้วย (`_visible_in`: กึ่งกลางอยู่ในกรอบหน้าต่าง และอยู่ในกรอบ ≥ 80% ของพื้นที่)
- ชื่อ (Name) ของปุ่มทูลบาร์ใช้ไม่ได้ ("Contactus"/"Exit" ถูกคัดลอกผิดมา) → ใช้ id + HelpText · ปุ่ม **แทรก/ลบ/ยกเลิกรายการ ติดกับปุ่มนำเข้า (ห่าง 4px)** จึงมี `reverify` (อ่านเป้าซ้ำก่อนกด ขยับเกิน 2px = หยุด)
- id `uo_tran_bt_import` มีในฟอร์ม **โอนสินค้าระหว่างสาขา (`pn_trans_tb_out`) ด้วย** → ต้องเช็คคลาสฟอร์ม ไม่ใช่แค่ id
- `Custom id` ที่เป็นตัวเลข (เช่น `17`, `23`, `295`) เปลี่ยนทุกครั้งที่โหลดหน้า → ห้ามใช้ · id ซ้ำข้ามหน้า (`B W A C D R H`) → เช็คคลาสหน้าแม่ (`ancestor`) เสมอ
- ฟอร์ม `pn_trans_out` (ปุ่ม O) เปิดมาด้วยประเภทเอกสารเริ่มต้นเป็น **"ใบเสร็จรับเงิน(เงินสด)" (ORCM)** ไม่ใช่ ORDS · ฟอร์ม `pn_trans_in` (ปุ่ม I) เริ่มเป็น "ใบปรับปรุงเพิ่มสินค้า" (IRPS) → **ก่อน "นำเข้าจริง" (เฟส 2) ต้องมีขั้นตั้งและตรวจประเภทเอกสาร/สาขา** (ขั้นที่ 1 หยุดก่อนถึงจุดนั้น)
- UIA ล้ม 1–3 ครั้งติดกันระหว่างรอเงื่อนไขทนได้ (ช่วงโปรแกรมกำลังเปิด) · ครบ 4 = `UIA_ERROR` · แต่ละครั้งใช้เวลาประมาณ 1.2 วินาที (วัดบน Windows 11 / PowerShell 5.1.26100 — ยังไม่ได้วัดทั้งขั้นตอน)
- ต้องมี Windows PowerShell 5.1 (มากับ Windows) — ตัวช่วยเรียกด้วย `-NoProfile -NonInteractive -ExecutionPolicy Bypass -File` (ข้ามนโยบายเฉพาะโปรเซสนั้น ไม่แก้ค่าเครื่อง) · โปรแกรมป้องกันไวรัสบางตัวอาจเตือนการเรียก PowerShell จากโปรแกรมอื่น — `--find` จะรายงานสถานะ "UIA (PowerShell)"

**เครื่องมือ:** `--inspect --label <ชื่อ>` เขียน `uia_<n>_<hwnd>.txt` (โครงสร้าง UIA ของหน้าต่างที่มองเห็นทุกใบ · ไม่อ่านค่าที่พิมพ์ในช่องกรอก) เพิ่มจาก `dump.txt`/`screen.png` · ตอนขั้นตอนล้มก็เก็บ `uia_*.txt` ให้ใน `runs\` ด้วย

## ตรวจหน้าต่างจริง (Gate 0) — ต้องทำก่อนปุ่มจะคลิกได้

> ใครทำ: ผม (Claude) ผ่าน Remote Control บนเครื่อง Windows ที่มี `ssmaxx.exe` + มี clone ของ repo นี้ หรือ IT ทำเองตามขั้นตอนนี้แล้วส่งโฟลเดอร์ `runs\` (ตัดข้อมูลธุรกิจออกจากภาพถ้าจำเป็น) มาให้

**เตรียมเครื่อง:** เปิดเครื่อง SQL Server (BIGYAMAINPC) · ปิด `ssmaxx.exe` ทุกตัว · ปลดล็อกจอ · Scaling 100% · สร้าง `.env` (ผู้ใช้สร้างเอง — ⛔ ห้ามส่งรหัสในแชท) · `python -m pip install pywin32 psutil pillow`

**ขั้น 1 — เก็บ "ความจริง" ของหน้าต่าง (อ่านอย่างเดียว ไม่คลิก):** เปิด ProMaxx ด้วย shortcut เดียวกับที่พนักงานใช้ แล้วในแต่ละสถานะรัน `run_promaxx_helper.bat --inspect --label <ชื่อ>`

| สถานะที่ต้องหยุดรอที่หน้านั้น | `--label` |
|---|---|
| หน้า Login (ยังไม่พิมพ์อะไร) | `S1-login` |
| ล็อกอินเองแล้ว หน้าหลัก | `S2-main` |
| เข้าเมนู **เอกสารรับ** แล้ว | `S3-menu-receive` |
| เข้าเมนู **เอกสารจ่าย** แล้ว | `S3-menu-issue` |
| คลิกปุ่ม **I** แล้ว / ปุ่ม **O** แล้ว | `S4-button-I` / `S4-button-O` |
| คลิก **นำเข้าไฟล์เอกสาร** แล้ว (หยุด — ยังไม่เลือกไฟล์ · ปิดกล่องเองด้วยมือ) | `S5-import` |

แต่ละครั้งได้ `runs\<เวลา>_<label>\dump.txt` (ทุกหน้าต่างของ ssmaxx + ลูก: class / ข้อความ / rect / id / style + เมนู HMENU) กับ `screen.png` — ถ้า dump ไม่เจอหน้าต่างของโปรเซส ssmaxx ให้ดูท้ายไฟล์ ("หน้าต่างอื่นที่เห็นอยู่") ว่าหน้าต่างจริงเป็นของโปรเซสชื่ออะไร (อาจเป็นโปรเซสลูก/ตัวห่อ — ต้องปรับ `SSMAXX_PROC_NAME`)

**ขั้น 2 — เติม `STEP_SPECS`** *(ทำแล้วในรุ่น `2026-11-03.2` ตาม §UIA — ข้อความด้านล่างเป็นวิธีทำเมื่อ ProMaxx อัปเดตหน้าตาแล้วต้องตรวจใหม่ · ⚠️ ProMaxx เป็น WPF จึงใช้ `kind:"uia"` ไม่ใช่ `menu`/`control`/`point`)* ใน `promaxx_helper.py` ตามรูปแบบที่อธิบายไว้เหนือตัวแปรนั้น (ชุดตัวอย่างเต็มอยู่ใน `tests/lib/fake_ssmaxx.py` — เป็นข้อมูลสมมติ ห้ามคัดลอกค่า) โดย
- เป้า "เมนู" → ใช้ `kind:"menu"` (ส่ง `WM_COMMAND` ไม่ใช้เมาส์) · ปุ่มที่เป็น `Button` จริง → `kind:"control"` · ปุ่มที่อยู่ใน DataWindow ไม่มี HWND → `kind:"point"` (เมาส์จริง · พิกัดเป็นเศษส่วนของ rect — ต้องมีเงื่อนไขหลังคลิกที่ตรวจได้ ห้ามคลิกตามพิกัดเฉยๆ แล้วไม่ตรวจผล)
- ทุกขั้นต้องมี `post` (หน้าต่าง/ข้อความที่พิสูจน์ว่าไปถึงหน้าที่ควรเป็น) และ regex ต้อง**ตรงเป้าเดียว**
- **แนวทางจากบอทเดิม** (`auto-r01/bot-export/CLAUDE.md` — ขับ `promaxxreport.exe` ซึ่งเป็น**คนละโปรแกรม** ใช้เป็นแนวทางเท่านั้น ห้ามถือว่า `ssmaxx.exe` เหมือนกัน): หน้า Login ของมันคลิกช่องที่พิกัด % ของหน้าต่าง (ชื่อผู้ใช้ ~72%,35% · รหัสผ่าน ~72%,50%) แล้วพิมพ์ Unicode → กด Enter → คลิกเมาส์จริงที่ปุ่ม (~50%,67%) = ฟอร์มเป็น DataWindow ไม่มี HWND · ช่องของ PowerBuilder commit ค่าก็ต่อเมื่อมี keystroke จริงหรือเสียโฟกัสจริงเท่านั้น — `BM_CLICK` / paste / `WM_SETTEXT` ไม่ commit ⇒ ถ้าปุ่มยืนยันของ `ssmaxx.exe` ทำให้ค่าที่เพิ่งพิมพ์ไม่ถูกใช้ ให้เปลี่ยน `kind:"control"` จาก `via:"message"` เป็น `via:"mouse"`, ใช้ `kind:"point"`, หรือใช้ `{"do":"key","key":"enter"}` แทน

**ขั้น 3 — ดูด้วยตาก่อนคลิกจริง** (ปิด ProMaxx แล้วเปิดไว้ที่หน้าก่อนขั้นนั้น): ขณะ `LOCATORS_VERIFIED=False` ทุกคำสั่งที่ทำงานกับ ProMaxx ต้องใส่ `--force-unverified`

```bat
run_promaxx_helper.bat --step doc-button --type irps --dry-run --force-unverified
```
`--dry-run` = หาเป้า + วาดกรอบ/กากบาทลง `runs\…\NN_<step>.png` แต่**ไม่คลิก** (ขั้น login จะไม่พิมพ์อะไรเลย) · ตรวจภาพว่ากากบาทอยู่บนเป้าจริง แล้วค่อยรัน `--hover-ms 1500` (เมาส์ไปค้างเหนือเป้าให้คนดูทัน) และสุดท้ายไม่ใส่ทั้งสองตัว (คลิกจริงทีละขั้น)

**ขั้น 4 — เกณฑ์ "แม่นยำ" (ต้องผ่านครบก่อนตั้ง `LOCATORS_VERIFIED = True`):**
- `--open ords` ×10 และ `--open irps` ×10 จาก **cold start** (ปิด ProMaxx ทุกรอบ: `--close-ssmaxx --allow-close`) ถึงหน้านำเข้าทุกครั้ง · ยืนยันด้วย `result.json`/ภาพ ไม่มีคลิกหลุด ไม่มีกล่องแปลก
- เคสลบ: ProMaxx เปิดอยู่ → `ALREADY_RUNNING` ไม่คลิก · รหัสผิด → หยุดที่ login **ไม่ลองซ้ำ** · SQL Server ปิด → จดข้อความต่อฐานข้อมูลไม่ได้แล้วหยุด · ขยับเมาส์กลางทาง → `INTERFERENCE` · มี popup แทรก → หยุดพร้อมข้อความ · ล็อกจอ → `NO_DESKTOP`
- หลังปุ่มนำเข้า ตัวช่วยไม่ส่ง input เพิ่ม (เทสอัตโนมัติตรึงอยู่แล้ว — ตรวจด้วยตาอีกครั้งบนของจริง)

**ขั้น 5 — เปิดใช้งาน:** ตั้ง `LOCATORS_VERIFIED = True` + เปลี่ยน `VERSION` (คอมมิตแยก) · build exe ใหม่ · ลองกดปุ่มจากหน้าเว็บ**จริง**บน Chrome และ Edge ของเครื่องนั้น (ดู prompt LNA · ทดสอบ policy) — ต้องมี Origin จริง (หน้า production หรือ Vercel preview + `HELPER_ALLOWED_ORIGINS`) · แล้วเติมตาราง "ผลตรวจจริง" ด้านล่าง

## คำสั่ง CLI (ใช้ตอนตรวจ/ปรับจูน)

| คำสั่ง | ทำอะไร |
|---|---|
| (ดับเบิลคลิก) หรือ `--serve` | รอรับคำสั่งจากหน้าเว็บ |
| `--version` | พิมพ์รุ่น/proto/`locatorsVerified` |
| `--find` | ตรวจสภาพเครื่อง: พาธ ssmaxx · session · สิทธิ์ Administrator · Scaling · โปรเซสที่เกี่ยวกับ ProMaxx (อ่านอย่างเดียว) |
| `--inspect --label S3-menu` | dump หน้าต่าง/เมนู + screenshot ลง `runs\` (อ่านอย่างเดียว ไม่คลิก) |
| `--open ords\|irps` | ทำทั้งขั้นตอน (เส้นทางเดียวกับปุ่มบนเว็บ) |
| `--step <launch\|login\|menu\|doc-button\|import-button> --type ords\|irps` | ทำเฉพาะขั้นเดียวจากหน้าที่เปิดค้างไว้ · เสริม `--dry-run` / `--hover-ms N` |
| `--close-ssmaxx --allow-close` | ปิด `ssmaxx.exe` ทุกตัว (เครื่องทดสอบเท่านั้น) |
| `--force-unverified` / `--force-dpi` | ข้ามด่าน UNVERIFIED / Scaling 100% (เครื่องทดสอบเท่านั้น) · `--port N` ทับ `HELPER_PORT` |

exit code: `0` สำเร็จ · `1` ไม่สำเร็จ · `2` ตัวเลือกผิด/ตั้งค่าไม่ครบ · `3` ไม่ได้ทำอะไร (มีตัวช่วยอื่น/ProMaxx เปิดอยู่/พอร์ตถูกใช้)

## ถอด / ย้อนกลับ

| ระดับ | ทำอะไร |
|---|---|
| ปิดปุ่มบนเว็บ | `let ADJUST_DOC_PROMAXX=false;` ใน `index.html` → push (ตัวช่วยบนเครื่องไม่กระทบอะไร) |
| หยุดตัวช่วยบนเครื่องหนึ่ง | ปิดหน้าต่างคอนโซลของ PromaxxHelper · ลบ `PromaxxHelper.lnk` ใน `explorer shell:startup` · ลบโฟลเดอร์ตัวช่วย (ลบ `.env` ด้วย) · ลบ policy LNA ถ้าเคยใส่ |
| ถอนโค้ด | `git revert --no-edit $(git log --no-merges --format=%h --grep='^feat(adj-promaxx)' <จุดก่อนแก้>..HEAD)` (+ `feat(promaxx-helper)` ถ้าจะถอนตัวช่วยด้วย) — ดูรายการก่อนรัน · ⛔ ห้าม `reset --hard`/force-push |

ไม่มีผลต่อ Firestore / `firestore.rules` / `sw.js` / `vercel.json` / APK ⇒ ย้อนโดยไม่ต้อง migrate

## ข้อจำกัดที่ยอมรับ

- ต้องติดตั้งตัวช่วยทุกเครื่องที่จะใช้ปุ่ม (build exe เอง — ไม่เข้า git)
- ใช้เมาส์/คีย์บอร์ดจริงประมาณ 1 นาที — **ห้ามแตะระหว่างทำงาน**
- หลังจบ ProMaxx ค้างเปิดที่หน้านำเข้า ⇒ กดปุ่มซ้ำจะถูกปฏิเสธ (`ALREADY_RUNNING`) จนกว่าจะปิดเอง
- ProMaxx อัปเดตหน้าตา = ค่าตั้งขั้นนั้นพัง → ด่านเงื่อนไขหลังคลิกหยุดเองและไม่คลิกต่อ (ต้องตรวจใหม่)
- ยังไม่รู้ว่า `ssmaxx.exe` ตรวจสาขา/คลังตามบัญชีที่ล็อกอินหรือไม่ — ขั้นถัดไปควรตรวจว่าสาขาใน ProMaxx ตรงกับสาขาที่เปิดแอปก่อนนำเข้า
- **สถานะหลักฐานจริงของ `promaxx_win.py` (3 พ.ย. 2026):** รันบน Windows แล้วเฉพาะส่วน **อ่านอย่างเดียว** — `--find` · `--inspect` (หน้าต่าง/screenshot/UIA) · `pids` · `top_windows`/`child_windows` · `dpi_percent` · UIA ผ่าน PowerShell ✅ · **ยังไม่เคยรันจริง:** `launch` · `focus` · `click_at` · `type_text` · `press_key` · `dialogs()` · `close_processes` · mutex ข้ามโปรเซส · เทสอัตโนมัติใช้หน้าต่าง `ssmaxx.exe` **ปลอม** (`tests/lib/fake_ssmaxx.py` แบบ Win32 และ `fake_ssmaxx_uia.py` แบบ WPF+UIA ที่จำลองตามโครงที่ตรวจจริง) จึงพิสูจน์ได้แค่ตรรกะของตัวช่วย (ด่านความปลอดภัย · ลำดับขั้น · การหยุด) ไม่ใช่ว่าคลิก/พิมพ์ถูกบน ProMaxx จริง
- **ข้อสังเกตที่ยังไม่ได้แก้ (รอตัดสินใจ):** `WinAdapter.focus()` เรียก `ShowWindow(SW_RESTORE)` ทุกครั้ง ซึ่งจะ**ย่อหน้าต่างที่ขยายเต็มจออยู่กลับเป็นขนาดปกติ** — ควรเรียก restore เฉพาะตอนหน้าต่างถูกย่อ (iconic) อยู่ · UIA อ่านพิกัดหลังโฟกัสทุกครั้งจึงยังคลิกถูกจุด แต่จะเห็นหน้าต่างเปลี่ยนขนาด
- หน้าต่าง ProMaxx ที่ถูกย่อ (minimized — พิกัดซ้ายสุด ≤ −30000): ตัวกรองหน้าต่างระดับบน `Runner._tops()` ใน `promaxx_helper.py` ยอมรับหน้าต่างแบบนี้ และ `_ensure_focus()` → `adapter.focus()` ต้องกู้กลับมาแสดง — **ไม่มีเทสครอบและยังไม่เคยลองบน Windows จริง** · ตอน Gate 0 ให้ลองย่อหน้าต่าง ProMaxx ระหว่าง `--step ... --dry-run` แล้วดูว่ากู้ได้และพิกัดถูกอ่านใหม่หลังโฟกัส

## นอกขอบเขตขั้นที่ 1 (รออนุมัติ หลังยืนยันว่าคลิกแม่นยำแล้ว)

เลือกไฟล์ / ส่งแถวข้อมูลให้ตัวช่วย / นำเข้า / บันทึก / อ่านเลขที่เอกสารกลับ / ปิด ProMaxx หลังจบ / แจ้ง Status ใน 🗂️ ประวัติ

## ผลตรวจจริง (เติมหลัง Gate 0 — เก็บเป็นข้อความโครงสร้างอย่างเดียว: class / ป้าย / ตำแหน่งสัมพัทธ์ · ⛔ ห้ามแปะภาพหน้าจอหรือข้อมูลธุรกิจ)

| รายการ | ผล |
|---|---|
| พาธ `ssmaxx.exe` / ชื่อโปรเซสที่เป็นเจ้าของหน้าต่างจริง | ⏳ ยังไม่ตรวจ |
| ssmaxx รันแบบ Administrator หรือไม่ | ⏳ ยังไม่ตรวจ |
| หน้า Login: class / ช่อง username-password / ปุ่ม | ⏳ ยังไม่ตรวจ |
| หน้าหลัก: มีเมนู HMENU จริงหรือเป็น DataWindow | ⏳ ยังไม่ตรวจ |
| เมนู เอกสารรับ / เอกสารจ่าย: ป้าย + id | ⏳ ยังไม่ตรวจ |
| ปุ่ม I / O: เป็น `Button` จริงหรือจุดใน DataWindow | ⏳ ยังไม่ตรวจ |
| ปุ่ม "นำเข้าไฟล์เอกสาร": class / ป้าย | ⏳ ยังไม่ตรวจ |
| ORDS ×10 / IRPS ×10 จาก cold start | ⏳ ยังไม่ทดสอบ |
| Chrome / Edge: prompt LNA และ policy ล่วงหน้า | ⏳ ยังไม่ทดสอบ |
