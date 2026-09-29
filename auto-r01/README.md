# Auto R01.102 Import → Firestore

ทุกเช้า**ก่อน 08:00** สั่ง `AutoR01Export.exe` (บอทใน `bot-export/`) ส่งออก `Allstock.CSV` (R01.102 รวมทุก branch)
จาก ProMaxx ใหม่ 1 รอบ แล้วแยกตาม **Col D (`CF_WNAME`)** เป็น 4 branch เขียนเข้า **Firestore อย่างเดียว**
— ไม่ต้องเปิดเว็บ ไม่ต้องอัปไฟล์เอง · ไม่แตะ Supabase (ตาราง `stock` ใน Supabase เป็นงานของตัววน `bot-export` ต้นฉบับ)

> ⏳ **เปลี่ยนเมื่อ 28 ก.ย. 2026:** เดิมรัน 08:10 แล้วอ่านไฟล์ที่ตัววนของ bot-export ส่งออกทิ้งไว้ · ตอนนี้ส่งออกเองก่อนแล้วค่อยอัป
> ต้องวาง `AutoR01Export.exe` + `.env` ที่ `BIGYAMAINPC` และตั้งเวลา Task ใหม่ก่อนถึงจะมีผล (§ขั้น export · §ตั้งเวลา)

| Col D ในไฟล์ | → Firestore doc | แถวจริง (มิ.ย. 2026) |
|---|---|---|
| `Warehouse` | `stock_sessions/WH_r01` | 6,653 |
| `Front Store` | `stock_sessions/SRC_r01` | 5,348 |
| `Main KKL` | `stock_sessions/KKL_r01` | 3,912 |
| `Main SSS` | `stock_sessions/SSS_r01` | 3,138 |

⚠️ **ต้องแยกไฟล์ก่อนเขียนเสมอ** — ในไฟล์เดียวมี SKU unique 6,687 ตัว และ **5,373 ตัวโผล่ใน ≥2 branch**
ถ้าอัป `Allstock.CSV` ทั้งไฟล์ผ่านหน้าเว็บ `qtyMap.set()` ใน `_rebuildCountableSkus()` เป็น last-wins
→ ทุกสาขาจะได้ยอดของ branch ที่อยู่ท้ายไฟล์ **ห้ามอัปไฟล์รวมผ่าน UI**

---

## ไฟล์ในโฟลเดอร์นี้

| ไฟล์ | หน้าที่ |
|---|---|
| `auto_r01_import.py` | สคริปต์หลัก (Python stdlib ล้วน — ไม่ต้องลง pip) |
| `run_auto_r01.bat` | ตัวเรียกสำหรับ Task Scheduler + เก็บ log (หมุนไฟล์ที่ 2 MB) |
| `auto_r01.log` | log การรัน (สร้างอัตโนมัติ) · รุ่นก่อนหน้าอยู่ที่ `auto_r01.log.1` |
| `TODO-safe-enable.md` | ประวัติบั๊กที่แก้ไปแล้ว + วิธีปิดฉุกเฉิน |
| `AutoR01Export.exe` | ตัวส่งออก R01 จาก ProMaxx (~70 MB · **ไม่เข้า git** — build ด้วย `bot-export\build_exe.bat`) |
| `.env` | username/password ของ ProMaxx ให้ exe (**ไม่เข้า git — repo นี้ PUBLIC**) · แม่แบบ `.env.example` |
| `bot-export/` | ซอร์สของ exe = สำเนาบอท `it-anin/bot-export` ที่ตัด Supabase ออก · วิธีคลิก ProMaxx อยู่ใน `bot-export/CLAUDE.md` |
| `export_bot_last.txt` · `auto_r01_export_log.txt` | ข้อความสรุป / log ละเอียดของ exe รอบล่าสุด (สร้างอัตโนมัติ · ไม่เข้า git) |

---

## ⚙️ ค่าที่ตั้งไว้ (แก้ได้ในหัวไฟล์ `auto_r01_import.py`)

```python
FILE_GLOB           = "Allstock*.csv"          # เลือกไฟล์ใหม่สุดที่ตรงรูปแบบ
AUTO_BRANCHES       = {"WH", "SRC", "KKL", "SSS"}   # ปิด branch ไหนก็เอาออกจาก set นี้
MIN_ROWS_PER_BRANCH = 500                      # น้อยกว่านี้ = ไฟล์ผิดปกติ ยกเลิกทั้งงาน
MAX_DOC_KB          = 950                      # เพดาน Firestore 1 MiB
```

**โฟลเดอร์ CSV ไม่ต้องแก้โค้ด** — หาอัตโนมัติตามลำดับ:

| ลำดับ | ที่มา | ใช้เมื่อ |
|---|---|---|
| 1 | `--folder "<path>"` | ทดสอบครั้งเดียว |
| 2 | ตัวแปรระบบ `AUTO_R01_WATCH_FOLDER` | เครื่องที่วางไฟล์ไว้ที่อื่น |
| 3 | `%USERPROFILE%\Desktop\run-upload-stock` | **ค่าปกติ** |

ข้อ 3 ทำให้ไฟล์ชุดเดียวใช้ได้ทุกเครื่อง เพราะทุกเครื่องวางไฟล์ที่ `Desktop\run-upload-stock` เหมือนกัน
ต่างกันแค่ชื่อผู้ใช้ (`BigYa-spare` / `AninMainPC` / …) · บรรทัดแรกของ log บอกเสมอว่ารอบนั้นใช้โฟลเดอร์ไหนและมาจากที่มาใด

---

## 🤖 ขั้น export — ส่งออกไฟล์ใหม่ก่อนอ่าน (28 ก.ย. 2026)

ก่อนอ่านไฟล์ สคริปต์สั่ง `AutoR01Export.exe --save-dir "<โฟลเดอร์ข้างบน>"` ให้ ProMaxx ส่งออก `Allstock.CSV` ใหม่ 1 รอบ
แล้ว**อัปเฉพาะเมื่อได้ไฟล์ที่เขียนหลังเวลาเริ่มจริง** (ขนาดนิ่งแล้ว) — ไม่ได้ = **exit 5 ไม่เขียน Firestore และไม่ถอยไปใช้ไฟล์เก่า**
ตัดสินจากไฟล์ ไม่ใช่จาก exit code ของ exe

| สถานการณ์ตอนเริ่ม | ทำอะไร |
|---|---|
| ไม่มีใครใช้ ProMaxx | รอ 45 วินาทีแล้วตรวจซ้ำ → เปิด exe · ให้เวลาไม่เกิน 20 นาที เกิน = ปิดทิ้งทั้ง process tree + ProMaxx ที่ค้างจากรอบนี้ |
| มี `SeniorsoftExport.exe` (ตัววน) · `promaxxreport.exe` · หรือ exe ของเราค้างจากรอบก่อน รันอยู่ | **ไม่เปิดซ้อน** · รอไฟล์รอบถัดไปของตัวนั้นไม่เกิน 20 นาที (ตัววนส่งออกทุก 5 นาที) |
| exe ตอบ exit 3 (มีตัวอื่นแทรกเข้ามาพอดี) | ไปทางรอเหมือนแถวบน |
| exe จบแต่ไม่มีไฟล์ใหม่ / ไม่พบตัว exe | exit 5 |

⛔ **ห้ามให้บอทสองตัวขับ ProMaxx พร้อมกัน** — `step_login()` ของบอทหาหน้าต่างด้วย class `FNWNS3125` อย่างเดียว
ซึ่งเป็น class เดียวกับ popup "เงื่อนไขการสร้างรายงาน" ⇒ ตัวที่สองพิมพ์รหัสผ่านลง popup ของตัวแรก (รายละเอียด `bot-export/CLAUDE.md`)
ด่านข้างบนกันได้เฉพาะตอน**เริ่ม** · ถ้าตัววน (08:00) หรือ `BOT05106` เริ่ม**ระหว่าง**ที่ exe ทำงาน จะชนกัน ⇒ **ต้องตั้งเวลาให้ถูก** (§ตั้งเวลา)

| flag | ผล |
|---|---|
| (ไม่มี — ที่ Task ใช้) | ส่งออก แล้วอัป Firestore |
| `--no-export` | ข้ามขั้นส่งออก ใช้ไฟล์ล่าสุดในโฟลเดอร์ — **ทางกู้มือวันที่บอทล้ม** (ส่งออกจาก ProMaxx เองแล้วรันตัวนี้) |
| `--dry-run` | ไม่ส่งออก ไม่เขียนอะไร (ความหมายเดิม) |
| `--dry-run --with-export` | ซ้อมเต็ม: ส่งออกจริง (**ขับ ProMaxx แย่งเมาส์**) แต่ไม่เขียน Firestore |
| `--resync-nc` | ไม่ส่งออกเสมอ (guard ข้อ 5 ต้องใช้ไฟล์ชุดเดิม) · ใส่ `--with-export` คู่กัน = ปฏิเสธ |
| `--export-exe "<path>"` | ระบุตัว exe · หรือตั้ง `setx AUTO_R01_EXPORT_EXE "<path>"` · ค่าปกติ = ข้างสคริปต์นี้ |

- **flag ที่ไม่รู้จัก = ยกเลิก exit 2** (เพิ่ม 28 ก.ย. — เดิมพิมพ์ `--dryrun` ผิดแล้วเข้าโหมดจริงทันที)
  ⚠️ **สคริปต์รุ่นเก่าบนเครื่องจริงยังไม่ตรวจ** และไม่รู้จัก `--no-export`/`--with-export` ⇒ ตรวจเวอร์ชันก่อนใช้ flag ใหม่เสมอ (§ติดตั้ง)
- ข้อความของ exe ถูกยกมาใส่ `auto_r01.log` เป็นบรรทัด `[exe] ...` · log ละเอียดอยู่ที่ `auto_r01_export_log.txt` ข้าง exe (รอบก่อนเป็น `.1`)
- exe พิมพ์**ชื่อไฟล์ชั่วคราวไม่ซ้ำ** (`AR01<เวลา>.CSV`) ลงหน้าต่าง Save แล้วไล่หาทั่วโฟลเดอร์ผู้ใช้ ย้ายเป็น `Allstock.CSV`
  — หน้าต่าง Save ของ ProMaxx เซฟลงโฟลเดอร์ล่าสุดที่คนเคยเลือก ถ้าพิมพ์ `Allstock.CSV` ตรงๆ จะกด Yes ทับไฟล์ชื่อเดียวกันที่นั่น
  (เกิดจริงตอนเทส 28 ก.ย. 2026 · ดู `bot-export/CLAUDE.md` กติกาข้อ 6)
- ปรับเวลาได้ที่หัวไฟล์ `auto_r01_import.py`: `EXPORT_TIMEOUT_MIN` · `WAIT_OTHER_BOT_MIN` · `PRESTART_SETTLE_SEC`
- ⚠️ exe เซฟลงโฟลเดอร์ที่ส่งให้ (`--save-dir`) แต่**ตัววนต้นฉบับเซฟลง `Desktop\run-upload-stock` เสมอ**
  ⇒ ถ้าตั้ง `AUTO_R01_WATCH_FOLDER` ไว้ที่อื่น ทางรอไฟล์จากตัววนจะไม่มีวันเจอไฟล์
- exe อ่าน username/password ของ ProMaxx จากตัวแปรระบบ `PROMAXX_USERNAME`/`PROMAXX_PASSWORD` → ไฟล์ `.env` ข้าง exe
  (ตั้ง `PROMAXX_EXE_PATH` ได้ถ้าติดตั้ง ProMaxx ไว้ที่อื่น) · ⛔ **ห้ามใส่รหัสจริงในไฟล์ที่เข้า git** — repo นี้ PUBLIC

---

## 🖥️ ติดตั้งบนเครื่องอื่น (เช่น `AninMainPC`)

> ⚠️ **อ่าน "รันหลายเครื่องพร้อมกัน" ท้ายหัวข้อนี้ก่อน** — ปกติควรมีเครื่องเดียวที่เปิด Task ไว้

**1. ก๊อปโฟลเดอร์ `auto-r01` ทั้งโฟลเดอร์** ไม่ใช่แค่ `.bat`
`run_auto_r01.bat` เรียก `auto_r01_import.py` ที่อยู่ข้างๆ กัน (`%~dp0`) — ขาดตัวใดตัวหนึ่งไม่ทำงาน
วางที่ไหนก็ได้ เช่น `C:\Users\AninMainPC\Desktop\auto-r01\`
(ถ้าเครื่องนั้นมี repo อยู่แล้วให้ `git pull` แทน จะได้อัปเดตตามได้)

**ตั้งแต่ 28 ก.ย. 2026 ต้องมีอีก 2 ไฟล์ในโฟลเดอร์เดียวกัน ซึ่ง `git pull` / GitHub ไม่มีให้** — ก๊อปจากเครื่องพัฒนาไปวางเอง:
- `AutoR01Export.exe` — build ที่เครื่องพัฒนาด้วย `bot-export\build_exe.bat` (exe ไม่เข้า git)
- `.env` — username/password ของ ProMaxx (ไม่เข้า git เพราะ repo นี้ PUBLIC · แม่แบบคือ `.env.example`)

> ⚠️ **`BIGYAMAINPC` (เครื่องที่รันจริงทุกเช้า) ไม่ใช่ git clone — เป็นไฟล์ที่ก๊อปไปวางเฉยๆ** (ยืนยัน ก.ย. 2026)
> ⇒ **แก้สคริปต์ใน repo แล้วเครื่องนั้นไม่ได้ตามเอง ต้องเอาไปวางเองทุกครั้ง** · `git pull` ที่นั่นไม่มีผล
> เคยเกือบทำให้รันสคริปต์เวอร์ชันเก่าด้วย flag ใหม่มาแล้ว ซึ่งอันตรายเพราะ**รุ่นก่อน 28 ก.ย. 2026 ไม่ตรวจ flag แปลกปลอม**
> (อ่านด้วย `"--resync-nc" in sys.argv` เฉยๆ) ⇒ ตัวเก่าจะเมิน flag แล้วเดินเข้าโหมดปกติซึ่ง**เขียนจริงทันที**
> (รุ่นใหม่ปฏิเสธ flag ที่ไม่รู้จักแล้ว แต่ช่วยไม่ได้ถ้าไฟล์บนเครื่องยังเป็นรุ่นเก่า)
>
> **ตรวจก่อนรันเสมอ** ว่าไฟล์บนเครื่องนั้นเป็นเวอร์ชันที่ต้องการจริง:
> ```powershell
> Select-String -Path auto_r01_import.py -Pattern "def run_export_step" -Quiet   # ต้องได้ True (รุ่นที่ส่งออกเอง)
> Select-String -Path auto_r01_import.py -Pattern "def resync_nc" -Quiet         # ต้องได้ True
> .\AutoR01Export.exe --version    # ปลอดภัย ไม่เปิด ProMaxx · ต้องเห็นรุ่นเดียวกับที่ build ล่าสุด
> ```
> **วิธีอัปเดตไฟล์เดียว** (repo เป็น public จึงดึงตรงได้ ไม่ต้อง login):
> ```powershell
> Copy-Item auto_r01_import.py auto_r01_import.py.bak -Force
> [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
> Invoke-WebRequest -UseBasicParsing -OutFile auto_r01_import.py `
>   -Uri "https://raw.githubusercontent.com/it-anin/Stock-Count/main/auto-r01/auto_r01_import.py"
> ```
> ไฟล์จาก GitHub เป็น LF ส่วนสำเนาในเครื่องพัฒนาเป็น CRLF — **hash จึงต่างกันโดยปกติ** ให้เทียบกับ
> `git show main:auto-r01/auto_r01_import.py | sha256sum` ไม่ใช่กับไฟล์ในโฟลเดอร์ · Python รันได้ทั้งสองแบบ
> ⚠️ วิธีนี้ได้แค่ `.py` — **`AutoR01Export.exe` ไม่อยู่บน GitHub** แก้ `bot-export/auto_r01_export.py` แล้วต้อง build ใหม่และก๊อป exe ไปวางเอง

**2. ตรวจว่ามี Python** — `.bat` หาให้เองจาก `C:\Program Files\Python311/312/313`, `PATH` แล้ว `py` launcher
ถ้าไม่มีจะเขียน `ERROR: Python not found` ลง log แล้วออกด้วย exit 9
ติดตั้งจาก <https://www.python.org/downloads/> แล้ว **ติ๊ก "Add python.exe to PATH"** · ไม่ต้องลง pip อะไรเพิ่ม

**3. ตรวจว่าไฟล์อยู่ถูกที่** — ถ้าเป็น `C:\Users\AninMainPC\Desktop\run-upload-stock\Allstock.CSV` ไม่ต้องตั้งอะไรเลย
ถ้าอยู่ที่อื่น ตั้งครั้งเดียว (แล้วเปิด CMD ใหม่):
```powershell
setx AUTO_R01_WATCH_FOLDER "D:\path\to\run-upload-stock"
```

**4. ทดสอบก่อน** (ไม่เขียน Firestore) — `--force` ใช้ข้าม guard "ไฟล์ต้องเป็นของวันนี้" ตอนทดสอบเท่านั้น
```powershell
cd "C:\Users\AninMainPC\Desktop\auto-r01"
.\run_auto_r01.bat --dry-run --force
Get-Content .\auto_r01.log -Tail 20
```
ต้องเห็นโฟลเดอร์ที่ถูกต้อง, `Col D ที่ map ไม่ได้` ไม่โผล่, และยอดครบ 4 branch

**4b. ซ้อมขั้นส่งออก** (ขับ ProMaxx จริงไม่กี่นาที — ห้ามแตะเมาส์/คีย์บอร์ดระหว่างนั้น · ยังไม่เขียน Firestore)
```powershell
.\AutoR01Export.exe --version
.\run_auto_r01.bat --dry-run --with-export
Get-Content .\auto_r01.log -Tail 40 -Encoding UTF8
```
ต้องเห็น `exe จบใน ... · exit 0` แล้ว `✅ ได้ไฟล์ใหม่` ตามด้วยบรรทัด `[DRY]` ครบ 4 branch และ ProMaxx ต้องถูกปิดเองตอนจบ
⚠️ **ซ้อมตอนตัววนไม่ทำงาน** (หลัง 20:50 หรือก่อน 08:00) — ถ้าตัววนรันอยู่ สคริปต์จะไม่เปิด exe แต่รอไฟล์จากตัววนแทน
= ไม่ได้ทดสอบ exe ของเราเลย · ดูเวลาที่ exe ใช้จริงจากบรรทัด `exe จบใน ...` เพื่อใช้เลือกเวลาในขั้น 0 ของ §ตั้งเวลา

**5. ตั้ง Task Scheduler** ตาม §⏰ ด้านล่าง

### รันหลายเครื่องพร้อมกัน

**ไม่แนะนำ** — สคริปต์ไม่มี lock ระหว่างเครื่อง ถ้าสองเครื่องรันเช้าเดียวกันจะเกิด:
- เขียน `{branch}_r01` ซ้อนกัน 2 รอบ ด้วย `r01Version`/`r01BaselineAt` คนละค่า
- ทุกเครื่องที่เปิดเว็บอยู่จะโหลด R01 ใหม่ **2 ครั้ง** และโดนล้าง R16 **2 ครั้ง** พร้อม toast ซ้ำ
- ถ้าเครื่องหนึ่งมี CSV เก่ากว่า → guard "ไฟล์เก่า" จะกันไว้ให้ แต่ถ้าทั้งคู่ไฟล์ของวันนี้แต่คนละเวลา export ยอดจะเป็นของเครื่องที่เขียนทีหลัง

**ให้เลือกเครื่องเดียวเป็นเจ้าภาพ** — ควรเป็นเครื่องที่เปิดตลอดเช้าและเป็นที่ที่ POS export ไฟล์ลงจริง
ย้ายเจ้าภาพ = ตั้ง Task บนเครื่องใหม่ แล้ว **ปิดของเครื่องเก่า**:
```powershell
Disable-ScheduledTask -TaskName "AutoR01Import"     # รันบนเครื่องเก่า
```
เครื่องสำรองติดตั้งไว้ได้แต่ให้ `Disable` ไว้ พอเครื่องหลักเสียค่อย `Enable-ScheduledTask`

---

## สิ่งที่สคริปต์เขียนลง `{branch}_r01`

เขียนแบบ **PATCH + `updateMask`** เท่านั้น (ระบุ field ที่แตะทุกตัวใน `WRITE_FIELDS`)
PATCH ที่ไม่มี `updateMask` = replace ทั้ง document → จะลบ field ที่เว็บเขียนไว้ทิ้ง

| field | ค่า | ใครใช้ |
|---|---|---|
| `data_json` | `[{colE,productName,systemQty[,nc]}]` ของ branch นั้น · `nc:1` = ตัดเด็ดขาด (หมวด `11.`) · `nc:2` = นับเฉพาะเมื่อมีของ (หมวด `DELETE`) | `restoreMasterFromFirestore()`, `_applyWhR01Doc()` |
| `r01UploadedAt` | `HH:MM น. DD/MM/YYYY` | ป้ายเวลาใต้ปุ่ม R01 |
| `r01Version` | ISO UTC มิลลิวินาที (เช่น `2026-08-26T01:10:00.123Z`) | `_branchConfirmVersions()` ตรวจก่อน Confirm · `_applyWhR01Doc()` ใช้ตัดสินว่าจะ adopt ไหม |
| `r01BaselineAt` | **ค่าเดียวกับ `r01Version`** | trigger ให้ listener ของสาขายาเรียก `_applyR01BaselineUpdate()` |
| `r16Loaded`, `r16UploadedAt`, `r16DetailVersion` | `false`, `""`, `""` | ล้าง R16 เมื่อวาน — ตรงกับที่ `syncR16MetaToFirestore()` เขียนตอนอัพด้วยมือ |
| `r16_103*` | `false`, `""`, `""` | คู่ขนานสำหรับ WH |
| `updated_at` | timestamp | — |

**❌ สคริปต์ไม่แตะ session doc (`stock_sessions/{branch}`) เด็ดขาด** — `r01BaselineAt` เดิมฝังรวมกับ `scanData`
ในก้อน `session_data_json` (schema v1) การอ่าน-แก้-เขียนกลับเสี่ยงทับยอดสแกนของพนักงาน
จึงพา baseline ผ่าน master doc แทน แล้วให้ `syncToFirestore()` ของเครื่องที่ adopt แล้วพาลง session เอง

### แอปรับต่อยังไง

| branch | เส้นทาง |
|---|---|
| SRC/KKL/SSS | listener ของ `{branch}_r01` เห็น `r01BaselineAt` ใหม่ → `_applyR01BaselineUpdate(mb, data)` → โหลด R01 + `rebuildMaps()` + `_clearR16ForNewBaseline()` + toast |
| WH | `_applyWhR01Doc()` เห็น `r01Version` ใหม่กว่า → adopt `data_json` + `rebuildMaps()` · Supervisor เรียก `_loadWhR16CloudTimelines()` ต่อ ซึ่งเช็ค `meta.r01Version !== state.r01Version` แล้ว **ล้าง R16 ให้เอง** |
| ทุก branch ตอน reload หน้า | `restoreMasterFromFirestore()` โหลด `data_json` ใหม่เมื่อ `r01Version` บน cloud ต่างจากในเครื่อง |

---

## 🔧 `--resync-nc` — sync ธง `nc` บน cloud ให้ตรงกติกาหมวด (งานครั้งเดียว)

ธง `nc` ถูกตัดสิน **ตอน parse** แล้วตรึงลง `data_json` ⇒ แก้ `R01_NON_COUNT_*` / `R01_STOCK_ONLY_*` อย่างเดียว
**ไม่มีผลกับข้อมูลที่ค้างบน cloud** จนกว่าบอทจะรันรอบถัดไป โหมดนี้เขียนธงใหม่ให้ทันทีโดยไม่รบกวนรอบนับ

รายงานจะแยกให้เห็นทั้ง 2 ชนิด (`nc:1` ตัดเด็ดขาด · `nc:2` มีของถึงนับ) และบอกจำนวน SKU ที่ธงเปลี่ยน
พร้อมบรรทัด "หมวด DELETE ที่จัดชั้น A/B/C/REVIEW ไว้ด้วย" ซึ่งเป็นเคสที่ธง `nc:2` มีไว้กันโดยเฉพาะ

```powershell
python auto_r01_import.py --resync-nc                    # dry-run (ค่าเริ่มต้น — ไม่เขียนอะไร)
python auto_r01_import.py --resync-nc --yes              # เขียนจริง
python auto_r01_import.py --resync-nc --yes --branch SRC # ทีละสาขา
```

**เขียนเฉพาะ `data_json` ด้วย `updateMask.fieldPaths=data_json`** — ไม่แตะ `r01Version`, `r01BaselineAt`,
`r01UploadedAt`, `r16*`, `updated_at` ⇒ ไม่ trigger `_applyR01BaselineUpdate()` (R16 ไม่ถูกล้าง · audit ไม่ถูก freeze),
ไม่ invalidate R16 ของ WH และ Confirm ที่กำลังรันอยู่ไม่ abort (`_branchConfirmVersions()` เทียบแค่ version)

- **guard เทียบแถว (ชั้นที่ 5)** — เทียบ `data_json` เดิมกับที่ parse ได้ทุก field ยกเว้น `nc`
  ต่างแม้แถวเดียว = **ยกเลิกสาขานั้น** ⇒ บังคับให้ใช้ไฟล์ Allstock ชุดเดียวกับที่บอทเขียนขึ้นไป
  ⛔ **ห้ามเพิ่ม flag ให้ข้าม guard นี้** — ถ้าข้ามแล้วรันด้วยไฟล์คนละวัน `systemQty` จะถูกทับด้วยยอดคนละรอบ
- สำรอง `data_json` เดิมลง `auto-r01/backup/{branch}_r01_data_json_{วันเวลา}.json` ก่อนเขียนทุกครั้ง
- รายงาน `nc` ก่อน/หลัง, จำนวนที่ถอด/เพิ่ม, ขนาด KB และ **Total SKU ก่อน/หลัง** (อ่าน `{branch}_pm` มาคำนวณ)
- idempotent — ถ้าธงตรงกติกาอยู่แล้วจะไม่เขียน · rollback = revert ค่าคงที่แล้วรันซ้ำ

⚠️ **เครื่องที่เปิดค้างจะยังไม่เห็นจนกว่าจะ reload** (ไม่มี listener ไหนโหลด `data_json` ใหม่ถ้า version ไม่ขยับ)
⇒ **รันโหมดนี้ก่อน แล้วค่อย deploy เว็บ** — auto-refresh จะ reload ให้ทุกเครื่องเองภายใน 15 นาที
ถ้า deploy ก่อน ทุกเครื่องจะ reload ไปเจอธงเก่าแล้วต้องรอ reload รอบสอง

---

## 🛡️ Guard 5 ชั้น

| guard | เงื่อนไข | ผล |
|---|---|---|
| ไฟล์เก่า | `mtime` ไม่ใช่วันนี้ | **ยกเลิกทั้งงาน** exit 4 · ข้ามด้วย `--force` (ทดสอบเท่านั้น) |
| Col D ใหม่ | `norm(Col D)` ไม่อยู่ใน `BRANCH_MAP` | **ยกเลิกทั้งงาน** exit 4 — POS เปลี่ยนชื่อคลัง/เพิ่มสาขา ต้องมีคนมาดูก่อน |
| branch แถวน้อย | แถว < `MIN_ROWS_PER_BRANCH` | **ยกเลิกทั้งงาน** exit 4 (ตรวจครบทุก branch **ก่อน** เขียนตัวแรก) |
| doc ใหญ่ | > `MAX_DOC_KB` | ข้าม **เฉพาะ branch นั้น** + exit 1 — branch อื่นยังได้ข้อมูลวันนี้ (ปัญหาการโต ไม่ใช่ไฟล์เพี้ยน) |
| แถวไม่ตรง cloud (`--resync-nc` เท่านั้น) | `colE`/`productName`/`systemQty` หรือจำนวนแถวต่างจาก `data_json` เดิม | ข้าม **เฉพาะ branch นั้น** + exit 1 — ไฟล์คนละชุดกับที่บอทเขียนไว้ ⛔ ห้ามทำ flag ให้ข้าม |

> guard "ไฟล์เก่า" สำคัญเป็นพิเศษเพราะ Task Scheduler ตั้ง `StartWhenAvailable` = รันชดเชยข้ามวันได้
> ถ้าไม่มี guard นี้ การเปิดเครื่องวันถัดไปจะเขียนข้อมูลเก่าทับแล้วล้าง R16 ของทุกเครื่องฟรี

นอกจาก 5 ชั้นนี้ **ขั้น export มีด่านของตัวเอง**: ไม่ได้ไฟล์ที่เขียนหลังเวลาเริ่ม = ยกเลิกทั้งงาน exit 5
(`--force` ข้ามไม่ได้ · กู้มือด้วย `--no-export` · ดู §ขั้น export)

**exit code:** `0` สำเร็จ · `1` เขียนบาง branch ไม่ผ่าน · `2` ไม่พบไฟล์/flag ผิด · `3` ไม่มีรายการที่ใช้ได้ · `4` guard ไม่ผ่าน · `5` ขั้นส่งออกไม่ได้ไฟล์ใหม่

---

## ✅ ทดสอบก่อนใช้จริง (ไม่เขียน Firestore)

```powershell
python "C:\Users\BigYa-spare\Desktop\Stock-Count\auto-r01\auto_r01_import.py" --dry-run
```

ควรเห็นยอดใกล้เคียงตารางด้านบน และ **ไม่มีบรรทัด "Col D ที่ map ไม่ได้"**
(`--dry-run` เฉยๆ ไม่ส่งออก · ใส่ `--with-export` ด้วยถ้าจะซ้อมขั้นส่งออก — ดูขั้น 4b ของ §ติดตั้ง)

## ▶️ รันจริง (ส่งออกด้วย exe แล้วเขียน Firestore)

```powershell
python "C:\Users\BigYa-spare\Desktop\Stock-Count\auto-r01\auto_r01_import.py"
```

ใช้ไฟล์ที่ส่งออกเองแทน (วันที่บอทล้ม): เติม `--no-export`

---

## ⏰ ตั้งเวลาทุกเช้าก่อน 08:00 (Windows Task Scheduler)

ใช้ PowerShell — `schtasks` ตั้ง `StartWhenAvailable` (รันชดเชยเมื่อเครื่องปิด) ไม่ได้

### ขั้น 0 — ดูตารางบอทตัวอื่นบนเครื่องก่อน (สำคัญที่สุด)

ตั้งแต่ 28 ก.ย. 2026 สคริปต์**ขับ ProMaxx เอง** ⇒ ช่วงที่มันทำงานต้องไม่มีบอทตัวอื่นขับ ProMaxx
บน `BIGYAMAINPC` มีอย่างน้อย 2 ตัว: ตัววน `SeniorsoftExport.exe` ของ bot-export (08:00–20:50) และ `BOT05106` (ส่งออก R05 เสร็จ ~07:55)
**อ่านจากเครื่องจริงเสมอ** (กฎ 0 ใน `CLAUDE.md`):

```powershell
Get-ScheduledTask | Where-Object { $_.Actions.Execute -match 'SeniorsoftExport' -or $_.TaskName -eq 'BOT05106' } |
  Select-Object TaskName, State, @{n='Exe';e={$_.Actions.Execute}}, @{n='At';e={$_.Triggers.StartBoundary}}
(Get-Item "$env:USERPROFILE\Desktop\run-upload-stock\R05.106.CSV").LastWriteTime   # BOT05106 เขียนเสร็จกี่โมง
```

เลือกเวลาเริ่ม `T` ให้ **`T` + 20 นาที (`EXPORT_TIMEOUT_MIN`) จบก่อน `BOT05106` เริ่ม และก่อน 08:00**
เช่น ถ้า BOT05106 เริ่ม 07:40 ให้ตั้งไม่เกิน 07:15 · เวลาที่ exe ใช้จริงดูจากบรรทัด `exe จบใน ...` ในขั้น 4b ของ §ติดตั้ง
⚠️ เครื่องต้อง**เปิด + login ค้าง + ไม่ล็อกจอ**ตั้งแต่ก่อน `T` (บอทคลิกหน้าจอจริง)
⚠️ **ฐานข้อมูลของ ProMaxx อยู่บน BIGYAMAINPC เอง** (SQL Server `BIGYAMAINPC\SQLSERVER` ฐาน `MSMAXX`) ⇒ ตอน `T` บริการ SQL Server ต้องพร้อมแล้ว
ถ้าเครื่องเพิ่งเปิดใหม่ตอนเช้า ต้องตั้งหลังจากที่ SQL Server เริ่มเสร็จ · ที่เห็นจริง: 28 ก.ย. เครื่องนั้นไม่ตอบ ping ตั้งแต่ราว 23:00
และเช้า 29 ก.ย. ฐานข้อมูลพร้อมแล้วตอน 07:07 (เห็นวันเดียว ยังไม่รู้ว่าปิด-เปิดตามเวลาหรือไม่) · วิธีเช็คว่าพร้อม **ห้ามดูพอร์ต 1433**
(เป็น named instance · ใช้คำสั่งถาม SQL Browser ใน `bot-export/CLAUDE.md` §ฐานข้อมูล)
ต่อไม่ได้เมื่อไร log จะมี `[exe]    ProMaxx แจ้ง: Microsoft SQL Server Login - Connection failed ...` (ดู `bot-export/CLAUDE.md`)
📌 ถ้าส่งออกก่อนร้านเปิด R01 จะยังไม่มียอดขายของวันนั้น ⇒ ไม่เกิดยอดขายถูกบวกซ้ำกับ R16 (แบบเคส SRC 100048 · 27 ก.ย. 2026)

### ขั้น 1 — ทดสอบด้วยมือให้ผ่านก่อน

```powershell
cd "$env:USERPROFILE\Desktop\auto-r01"      # หรือ path ที่วางโฟลเดอร์ไว้จริง
.\run_auto_r01.bat --dry-run --force
Get-Content .\auto_r01.log -Tail 25 -Encoding UTF8
```

ต้องเห็นครบ 4 branch และไม่มีบรรทัด `Col D ที่ map ไม่ได้` — **ถ้าขั้นนี้ไม่ผ่าน อย่าเพิ่งตั้ง Task**
แล้วซ้อมขั้นส่งออกตามขั้น 4b ของ §ติดตั้ง (`--dry-run --with-export`) ให้ผ่านด้วย

### ขั้น 2 — ลงทะเบียน Task

แก้ `$Root` กับ `$Time` (จากขั้น 0 — **ห้ามเดา**) แล้ววางทั้งก้อนใน PowerShell
(Task เดิมชื่อเดียวกันจะถูกแทนที่ด้วย `-Force` — ใช้คำสั่งนี้ย้ายเวลาจาก 08:10 ได้เลย):

```powershell
$Root = "$env:USERPROFILE\Desktop\auto-r01"          # <-- ที่วางโฟลเดอร์
$Time = ""                                           # <-- เวลาจากขั้น 0 เช่น "07:10"
$Bat  = Join-Path $Root "run_auto_r01.bat"
if (-not (Test-Path $Bat)) { throw "ไม่พบ $Bat" }
if (-not (Test-Path (Join-Path $Root "AutoR01Export.exe"))) { throw "ไม่พบ AutoR01Export.exe ใน $Root" }
if (-not $Time) { throw "ยังไม่ได้ใส่เวลา (ดูขั้น 0)" }

$A = New-ScheduledTaskAction -Execute $Bat -WorkingDirectory $Root
$T = New-ScheduledTaskTrigger -Daily -At $Time
$S = New-ScheduledTaskSettingsSet `
       -StartWhenAvailable `
       -ExecutionTimeLimit (New-TimeSpan -Minutes 60) `
       -MultipleInstances IgnoreNew `
       -DontStopIfGoingOnBatteries -AllowStartIfOnBatteries

Register-ScheduledTask -TaskName "AutoR01Import" -Action $A -Trigger $T -Settings $S `
       -Description "ส่งออก R01.102 จาก ProMaxx (AutoR01Export.exe) แล้วอัปขึ้น Firestore ทุกเช้า (WH/SRC/KKL/SSS)" -Force
```

| ค่า | ทำไมต้องมี |
|---|---|
| `-StartWhenAvailable` | เครื่องปิดตอนถึงเวลา → รันชดเชยทันทีที่เปิด · ถ้าตอนนั้นตัววน/BOT05106 ขับ ProMaxx อยู่ จะไม่เปิด exe แต่รอไฟล์จากตัววนแทน · guard "ไฟล์เก่า" กันไม่ให้เขียนข้อมูลข้ามวัน |
| ~~`-RestartCount 3 -RestartInterval 20m`~~ **ถอดออกแล้ว (28 ก.ย. 2026)** | รอบลองใหม่ที่ห่าง 20/40/60 นาทีอาจตกช่วงที่ BOT05106/ตัววนขับ ProMaxx อยู่ · ขั้นส่งออกลองในตัว 2 ครั้งแล้ว · ล้มทั้งวัน = กู้มือด้วย `--no-export` |
| `-MultipleInstances IgnoreNew` | กันซ้อนถ้ารอบก่อนยังค้าง |
| `-ExecutionTimeLimit 60m` | ส่งออก ≤ 20 นาที + รอไฟล์จากตัวอื่น ≤ 20 นาที + อ่าน/เขียน ~1 นาที · เดิม 15 นาทีไม่พอแล้ว (Task จะถูกฆ่ากลางส่งออก) |
| `-WorkingDirectory` | สุขอนามัย · ตัวสคริปต์อ้าง path ด้วย `%~dp0` อยู่แล้วจึงไม่พึ่งค่านี้ |

#### ทางเลือก: ตั้งผ่านหน้าจอ Task Scheduler (Create Task) — ได้ค่าเท่ากับคำสั่งข้างบน

ถ้ามี `AutoR01Import` ตัวเดิมอยู่ ให้คลิกขวา → **Delete** ก่อน (หรือเปิด Properties แล้วแก้ทีละแท็บตามนี้) ·
ใช้ **Create Task...** ไม่ใช่ Create Basic Task (แบบ Basic ตั้งค่าในแท็บ Settings ไม่ครบ)

| แท็บ | ช่อง | ค่า |
|---|---|---|
| **General** | Name | `AutoR01Import` |
| | Description | `ส่งออก R01.102 จาก ProMaxx แล้วอัปขึ้น Firestore ทุกเช้า` |
| | When running the task, use the following user account | ผู้ใช้ที่ login ค้างไว้ (`AninMainPC`) — ถ้าไม่ใช่ กด Change User or Group... |
| | **Run only when user is logged on** | ✅ เลือกข้อนี้ — ⛔ **ห้ามเลือก "Run whether user is logged on or not"** (ไม่มีหน้าจอให้บอทคลิก ส่งออกล้มทุกวัน) |
| | Run with highest privileges | ☐ ไม่ติ๊ก |
| **Triggers** → New | Begin the task | On a schedule |
| | Settings | **Daily** · Start = เวลาที่เลือกจากขั้น 0 · Recur every 1 days |
| | Advanced | ✅ Enabled · ที่เหลือไม่ติ๊ก (ไม่ต้อง Delay / Repeat / Stop ในแท็บนี้) |
| **Actions** → New | Action | Start a program |
| | Program/script | `C:\Users\AninMainPC\Desktop\auto-r01\run_auto_r01.bat` (กด Browse ได้) |
| | Add arguments | ว่าง |
| | Start in | `C:\Users\AninMainPC\Desktop\auto-r01` — **ไม่ใส่เครื่องหมายคำพูด** |
| **Conditions** | Start the task only if the computer is on AC power | ☐ ไม่ติ๊ก (และ Stop if ... battery ก็ไม่ติ๊ก) |
| | Idle / Network / Wake the computer | ☐ ไม่ติ๊กทั้งหมด |
| **Settings** | Allow task to be run on demand | ✅ |
| | Run task as soon as possible after a scheduled start is missed | ✅ |
| | **If the task fails, restart every** | ☐ **ไม่ติ๊ก** (รอบลองใหม่อาจตกช่วงบอทอื่น) |
| | Stop the task if it runs longer than | ✅ **1 hour** |
| | If the running task does not end when requested, force it to stop | ✅ |
| | If the task is already running | **Do not start a new instance** |

กด OK (แบบ "Run only when user is logged on" ไม่ถามรหัสผ่าน) · ช่อง **Last Run Result** ในหน้ารายการคือ exit code:
`0x0` สำเร็จ · `0x1` เขียนบางสาขาไม่ผ่าน · `0x2` ไม่พบไฟล์/flag ผิด · `0x4` guard ไม่ผ่าน · `0x5` ขั้นส่งออกไม่ได้ไฟล์ใหม่ · `0x41301` กำลังรัน
⚠️ คลิกขวา → **Run** = รันจริง (ส่งออก + เขียน Firestore + ล้าง R16 ทุกเครื่อง) — ทดสอบด้วย `--dry-run --with-export` จาก PowerShell แทน

### ขั้น 3 — ทดสอบ Task จริง

```powershell
Start-ScheduledTask -TaskName "AutoR01Import"
# รอจนหน้าต่างดำของ Task ปิดเอง (ขั้นส่งออกใช้ไม่กี่นาที) แล้วค่อยรันสามบรรทัดล่าง — ระหว่างนั้นห้ามแตะเมาส์
Get-ScheduledTask -TaskName "AutoR01Import" | Get-ScheduledTaskInfo |
  Select-Object LastRunTime, LastTaskResult, NextRunTime
Get-Content "$Root\auto_r01.log" -Tail 25 -Encoding UTF8
```

`LastTaskResult` คือ exit code ของสคริปต์ตรงๆ: `0` สำเร็จ · `1` เขียนบาง branch ไม่ผ่าน · `2` ไม่พบไฟล์/โฟลเดอร์/flag ผิด · `4` guard ไม่ผ่าน · `5` ขั้นส่งออกไม่ได้ไฟล์ใหม่ · `9` ไม่พบ Python

> ⚠️ ขั้นนี้ **เขียน Firestore จริง** (ไม่ใช่ dry-run) จะดัน R01 ใหม่ให้ทุกเครื่องและล้าง R16
> ทำในวันที่ไม่มีการนับ หรือแจ้งทีมก่อน · และ**ขับ ProMaxx จริง** (แย่งเมาส์ไม่กี่นาที) — ถ้าตัววนทำงานอยู่
> สคริปต์จะไม่เปิด exe แต่รอไฟล์จากตัววนแทน ⇒ ทดสอบขั้นส่งออกจริงต้องทำตอนตัววนไม่ทำงาน

### ตัวเลือกเรื่องบัญชีผู้ใช้

**ต้องเป็น "รันเฉพาะตอน login อยู่" เท่านั้น** (ค่าเริ่มต้นของคำสั่งในขั้น 2) — บังคับตั้งแต่ 28 ก.ย. 2026
เพราะ `AutoR01Export.exe` คลิกหน้าจอจริง · มีหน้าต่างดำเปิดค้างระหว่างส่งออกไม่กี่นาที · `%USERPROFILE%` ชี้ถูกเสมอ

> ⛔ **ห้ามใช้ `S4U` ("รันแม้ไม่ได้ login") แล้ว** — เดิมแนะนำไว้สำหรับรันตอนล็อกจอ แต่แบบนั้นไม่มีหน้าจอให้บอทคลิก
> ขั้นส่งออกจะล้มทุกวัน (exit 5) · Task ที่เคยตั้งเป็น S4U ต้องลงทะเบียนใหม่ด้วยคำสั่งในขั้น 2

> ⛔ **ห้ามตั้งให้รันด้วย `SYSTEM`** — `%USERPROFILE%` จะกลายเป็น `C:\Windows\system32\config\systemprofile`
> สคริปต์จะหาโฟลเดอร์ CSV ไม่เจอแล้วออกด้วย exit 2 · ถ้าจำเป็นต้องใช้ SYSTEM จริงๆ ต้องตั้ง
> `AUTO_R01_WATCH_FOLDER` แบบ system-wide (`setx /M`) ให้ชี้ path เต็ม

### คำสั่งจัดการ

```powershell
Get-ScheduledTask     -TaskName "AutoR01Import" | Get-ScheduledTaskInfo   # ดูผลรันล่าสุด
Start-ScheduledTask   -TaskName "AutoR01Import"                           # สั่งรันทันที
Disable-ScheduledTask -TaskName "AutoR01Import"                           # ⛔ ปิดฉุกเฉิน
Enable-ScheduledTask  -TaskName "AutoR01Import"                           # เปิดกลับ
Unregister-ScheduledTask -TaskName "AutoR01Import" -Confirm:$false        # ลบทิ้ง
```

เปลี่ยนเวลาโดยไม่ต้องลงทะเบียนใหม่:
```powershell
Set-ScheduledTask -TaskName "AutoR01Import" -Trigger (New-ScheduledTaskTrigger -Daily -At 08:40)
```

### แก้ปัญหา

| อาการ | สาเหตุ / ทางแก้ |
|---|---|
| `LastTaskResult = 2` | โฟลเดอร์/ไฟล์ไม่เจอ — ดู log บรรทัด `โฟลเดอร์:` ว่าชี้ไปไหน · ตั้ง `AUTO_R01_WATCH_FOLDER` |
| `LastTaskResult = 5` | ขั้นส่งออกไม่ได้ไฟล์ใหม่ — ดูบรรทัด `[exe]` ใน `auto_r01.log` และ `auto_r01_export_log.txt` · ที่พบบ่อย: จอล็อก/ไม่ได้ login, Display scaling ≠ 100%, ไม่มี `.env`, ไม่มี exe · **วันนั้นกู้มือ:** ส่งออกจาก ProMaxx เองแล้ว `run_auto_r01.bat --no-export` |
| log มี `ProMaxx แจ้ง: Microsoft SQL Server Login - Connection failed` | ProMaxx ต่อฐานข้อมูลไม่ได้ — SQL Server บน BIGYAMAINPC ยังไม่เริ่ม/ปิดอยู่ · เลื่อนเวลา Task ให้หลัง SQL Server พร้อม หรือรันซ้ำเมื่อพร้อม |
| log มี `exit 3` / `ไม่เปิด exe ซ้อน` แล้วรอจนหมดเวลา | มีโปรแกรมอื่นเปิด ProMaxx ค้างไว้ (คน/BOT05106) · เจอทุกวัน = เวลา Task ทับบอทอื่น → เลือกเวลาใหม่ตามขั้น 0 |
| ตัววน 08:00 login ไม่ผ่านหลังรอบของ auto-r01 | ProMaxx ค้าง — exe ต้องปิดเองทุกครั้ง · ดู `auto_r01_export_log.txt` บรรทัดท้ายๆ |
| `LastTaskResult = 4` | ไฟล์ผิดปกติ (Col D ใหม่ / แถวน้อย) — ดู log · ถ้าใช้ `--no-export`: ไฟล์ไม่ใช่ของวันนี้ |
| `LastTaskResult = 9` | ไม่มี Python — ลงจาก python.org แล้วติ๊ก "Add python.exe to PATH" |
| `LastTaskResult = 267011` | Task ยังไม่เคยรัน (ไม่ใช่ error) |
| `LastTaskResult = 2147942401` | มักเป็น path ผิดใน `-Execute` — ตรวจว่า `$Bat` มีจริง |
| Task ขึ้น Running ค้าง | ครบ 15 นาทีจะถูกฆ่าเอง · ดู log ว่าค้างตรงไหน |
| log ไม่ขยับเลย | Task ไม่ได้รัน — เช็ค `NextRunTime` และ History ใน Task Scheduler UI |

---

## ข้อควรรู้ / ข้อจำกัด

- **ไม่ติด time gate ของเว็บ** — สคริปต์เขียน Firestore ตรง ไม่ผ่าน UI (กฎ "แนะนำอัพหลัง 21:00" อยู่ฝั่งหน้าเว็บเท่านั้น)
- **เครื่องเป้าหมายต้องเปิด + login ค้าง + ไม่ล็อกจอ + Display scaling 100%** ก่อนเวลา Task (บอทคลิกหน้าจอจริง) · ถ้าเครื่องปิด `StartWhenAvailable` จะรันชดเชยตอนเปิด แล้วขั้นส่งออกตัดสินว่าจะส่งออกเองหรือรอไฟล์จากตัววน
- **WH ถูกอัปทุกเช้าด้วย** ผลคือ **R16.104/103 ของ WH ถูก invalidate ทุกวัน** Supervisor ต้องอัป R16 ชุดใหม่ก่อน Confirm
  และ `systemQty` ของคลังจะขยับใต้รอบนับที่ค้างอยู่ · ถ้ารบกวนงาน ให้เอา `"WH"` ออกจาก `AUTO_BRANCHES`
- **นาฬิกาเครื่องนี้กำหนด `r01Version` ของทั้งระบบ** — เครื่องอื่นเทียบด้วย `>` แบบ lexicographic ถ้าเวลาเพี้ยนย้อนหลังจะไม่มีใคร adopt ควรเปิด time sync อัตโนมัติ
- การเขียนใช้ Firebase REST API + API key สาธารณะ (ตัวเดียวกับเว็บ) ภายใต้ Firestore rules ปัจจุบัน
- **`WH_r01` = 670 KB จาก 6,653 แถว** เพดาน 1 MiB ≈ 10,000 แถว · ถ้าโตเกินนี้ต้องเปลี่ยน `data_json` เป็น array-of-arrays แบบที่ R05 ใช้ (`_serializeR05()` ใน `index.html`) ซึ่งลดได้ ~40%

---

## ตรวจ log

```powershell
Get-Content "C:\Users\BigYa-spare\Desktop\Stock-Count\auto-r01\auto_r01.log" -Tail 30
```

บรรทัดผลลัพธ์ต่อ branch มี: จำนวนรายการ · `nc` (หมวดไม่นับ) · ขนาด KB · `r01Version` ที่เขียน
`r01Version` เป็นค่าเดียวกันทั้ง 4 branch ในรอบเดียว ใช้จับคู่ย้อนหลังกับ doc บน Console ได้
