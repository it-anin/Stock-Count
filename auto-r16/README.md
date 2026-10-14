# Auto R16.104 Import → Firestore (สาขายา SRC / KKL / SSS)

อ่านไฟล์ `R16104.CSV` ที่บอท `BOTR16104` (ProMaxx GUI automation) export ไว้ใน `Desktop\run-upload-stock`
แล้วเขียน **timeline R16.104 ของแต่ละสาขา** ขึ้น Firestore ให้ Desktop สาขายาโหลดเอง —
แทนการที่พนักงาน export R16.104 แล้วอัปที่การ์ด **R16.104** (`upload-file-item`) ทุกเย็นก่อน Confirm

> ใช้ได้เฉพาะ **SRC / KKL / SSS** · **ไม่ทำ WH** (WH มีขั้นอัป R16 ของตัวเองอยู่แล้ว) · **ไม่ทำ R16.103**
> ต้องใช้คู่กับเว็บรุ่นที่มีตัวอ่าน `_loadPharmacyR16Timeline()` (สวิตช์ `PHARMACY_R16_CLOUD_TIMELINE`) — เขียน Firestore อย่างเดียว **ไม่ปลดล็อกปุ่ม Confirm**

## ทำไมต้องเป็น "timeline" ไม่ใช่ยอดรวม

Confirm ของสาขายาตัดสินด้วยสูตร `นับ + ขายก่อนเวลาสแกน + R16.103 − รับเข้าก่อนเวลาสแกน` เทียบกับ R01 ตอนเช้า
`getSoldQtyBefore()` กรองยอดขายด้วยเวลาสแกนของแต่ละ SKU — ต้องมี **raw timeline** (`r16RawMap`) ซึ่งเดิมอยู่ในหน่วยความจำของ Desktop ที่อัปไฟล์เองเท่านั้น
เครื่องที่ได้ R16 ผ่าน session sync มีแค่ยอดรวมต่อ SKU → บวกยอดขาย **หลัง** เวลาสแกนเข้าไปด้วย → ของที่นับถูกกลายเป็น Stock Adj ปลอมลง ERP (ตั้งแต่ 29 ก.ย. ไม่ผ่าน Audit)

เลยเก็บ timeline ขึ้น Cloud ด้วยรูปแบบเดียวกับ WH (`WH_r16_104_*`) แล้วให้ Desktop สาขายา (ไม่ใช่ PDA) โหลดเองตอน login และตอน master ประกาศเวอร์ชันใหม่

## ตำแหน่งในสายพาน

| ลำดับ | ใคร | ทำอะไร | เวลา |
|---|---|---|---|
| 1 | Task `BOT16104` (BOTR16104 · ProMaxx GUI) | export R16.104 "ประจำวัน = วันนี้" ของ **3 สาขาในไฟล์เดียว** → `Desktop\run-upload-stock\R16104.CSV` (เขียน `.part` แล้วค่อยเปลี่ยนชื่อ) | README ของบอทแนะนำ ~20:30 · **ยังไม่เคยให้ Task ยิงจริงบน AninMainPC — ตรวจ `LastWriteTime` บนเครื่องจริงก่อนเลือกเวลาข้อ 2** |
| 2 | **`auto-r16` (โฟลเดอร์นี้)** · Task `AutoR16Import` | อ่านไฟล์ → แยกตามสาขา → เขียน chunks + meta + ประกาศที่ `{branch}_r01` | **21:00** (ร้านปิดสแกน 21:00–08:00) · ต้องหลังข้อ 1 เสร็จ |
| 3 | เว็บ (Desktop สาขายา) | `_loadPharmacyR16Timeline()` โหลด timeline เข้า `r16RawMap` → ปุ่ม Confirm ปลดล็อก | ทันทีที่ master เปลี่ยน (เครื่องที่เปิดค้าง) หรือตอน login |
| — | `auto-r01` (เช้าวันถัดไป) | R01 ใหม่ + ล้าง `r16*` ใน master → timeline เมื่อวานใช้ไม่ได้เอง (r01Version ไม่ตรง) | ก่อน 08:00 |

ไฟล์จริง (ตัวอย่าง 13 ต.ค. 2026 14:25): 867 แถว · 40 คอลัมน์ · UTF-8 BOM · `SYSBRANCHID` **0 = อนิน สาขาแยกชากค้อ** (SRC หน้าร้าน Col A=1 + คลัง WH Col A=0 ปนกัน) · **4 = เก้ากิโล (KKL)** · **5 = ศรีราชา (SSS)**
แอป**ไม่กรองสาขาเอง** (`loadR16` เชื่อว่าผู้ใช้อัปไฟล์ถูกสาขา) — บอทต้องแยกแถวตาม `SYSBRANCHID` ก่อนเสมอ ไม่งั้นยอดขาย KKL/SSS ถูกบวกเข้า SRC

## ไฟล์ในโฟลเดอร์นี้

| ไฟล์ | หน้าที่ |
|---|---|
| `auto_r16_import.py` | สคริปต์หลัก (Python stdlib ล้วน — ไม่ต้องลง pip) |
| `run_auto_r16.bat` | ตัวเรียกสำหรับ Task Scheduler + เก็บ log (หมุนไฟล์ที่ 2 MB) · ASCII ล้วน (ภาษาไทยใน .bat ทำ cmd.exe พัง) |
| `auto_r16.log` | log การรัน (สร้างอัตโนมัติ · ไม่เข้า git) · รุ่นก่อนหน้า `auto_r16.log.1` |

## วิธีรัน

```powershell
python auto_r16_import.py --dry-run     # อ่าน Firestore + พิมพ์ตัวเลขต่อสาขา ไม่เขียนอะไรเลย  ← เริ่มที่นี่เสมอ
python auto_r16_import.py               # โหมดจริง
python auto_r16_import.py --branch KKL  # เฉพาะบางสาขา (คั่นด้วยจุลภาคได้)
python auto_r16_import.py --force       # ข้ามด่านวันที่/ไฟล์นิ่ง — ใช้ตอนทดสอบเท่านั้น
```

โฟลเดอร์ CSV หาตามลำดับ: `--folder "<path>"` → ตัวแปรระบบ `AUTO_R16_WATCH_FOLDER` → `%USERPROFILE%\Desktop\run-upload-stock` (ค่าปกติ)
**flag ที่ไม่รู้จักถูกปฏิเสธด้วย exit 2** (กันสคริปต์รุ่นเก่าเมิน flag ใหม่แล้วเขียนจริง — ตรวจใน `main()` เท่านั้น ห้ามย้ายไปตอน import เพราะเทส parity import ไฟล์นี้)

## สิ่งที่สคริปต์เขียน (ต่อสาขา · ลำดับห้ามสลับ)

| ลำดับ | doc | field |
|---|---|---|
| 1 | `{branch}_r16_104_{generation}_{index}` (chunk ≤ 650 KB) | `data_json` (แถวละ `[sku, ขายรวม, รับเข้ารวม, [{soldQty,tranDate}], [{qty,tranDate}]]`) · `kind` `version` `generation` `index` `countResetAt` `updatedAt` |
| 2 | `{branch}_r16_104_meta` | `ready` `kind` `version` `generation` `chunkCount` `rowCount` `countResetAt` `r01Version` `uploadedAtText` `dateMismatch:false` `dateMismatchDetail:''` `updatedAt` + `source:'auto-r16'` `contentHash` `sourceFile` `sourceMtime` `machine` |
| 3 | `{branch}_r01` (**PATCH + updateMask เฉพาะ 3 field**) | `r16Loaded:true` · `r16UploadedAt` (`HH:MM น. DD/MM/YYYY · ข้อมูล dd/mm hh:mm–dd/mm hh:mm`) · `r16DetailVersion` |
| 4 | chunk รุ่นเก่า | ลบ (best-effort) **หลัง**ประกาศแล้วเท่านั้น |

เหตุผลของลำดับ: ผู้อ่านเชื่อว่า "master ประกาศเวอร์ชันไหน = chunks ของเวอร์ชันนั้นพร้อมแล้ว" — ล้มกลางทางก่อนข้อ 3 จึงไม่มีผลกับใคร (บอทลบ chunk รุ่นใหม่ + คืน meta เดิมให้เอง)
⛔ **ห้ามแตะ** `r16_103*` · `data_json` · `r01*` ของ master · session doc `{branch}` (ทุกเครื่องเขียนทับเองตลอด — เขียนไปก็หาย) · ห้ามเขียน PATCH แบบไม่มี updateMask

## ด่านก่อนเขียน — ตกด่านไหนก็ไม่เขียน (exit 4)

**ระดับไฟล์ (ทุกสาขา):**

| # | ด่าน | ทำไม |
|---|---|---|
| 1 | ข้ามไฟล์ชื่อมี `.part.` | BOTR16104 เขียน `R16104.part.CSV` ก่อน — อ่านตัวที่ยังไม่เสร็จ = timeline ขาดครึ่ง |
| 2 | ไฟล์ต้องถูกแก้ไข**วันนี้** (เวลาไทย) | ไฟล์เก่า = BOTR16104 ไม่ได้รัน · R16 เมื่อวานบวกซ้ำกับ R01 วันนี้ = Confirm ผิด |
| 3 | ไม่ถูกแก้ใน 60 วินาทีล่าสุด | กันไฟล์ที่กำลังถูกเขียน |
| 4 | หัวคอลัมน์ตรงตำแหน่ง (0 `SYSWAREHOUSEID` · 2 `TRANNO` · 9 `FCANCEL` · 12 `SYSBRANCHID` · 14 `SCANCODE` · 17 `BASEQUANTITY` · 23 `ITEMID` · 31 `NAME` + มี `TRANDATE`) | `loadR16` อ่านด้วยเลขคอลัมน์ตายตัว — ProMaxx สลับคอลัมน์เมื่อไรจะได้ยอดมั่วแบบเงียบ · **ไม่มี flag ข้ามด่านนี้** |
| 5 | ทุกแถวที่ไม่ยกเลิกต้องเป็นของวันนี้และ `TRANDATE` อ่านได้ (รูปแบบ `dd-Mon-yy HH:mm:ss` เช่น `14-Oct-26 09:17:17` ที่บาง PC ให้ ถูกแปลงเป็น `dd/mm/yyyy` ให้เอง — ดูหมายเหตุด้านล่าง) | กันไฟล์หลายวัน/รูปแบบวันที่เปลี่ยน |

**ระดับสาขา (ข้ามเฉพาะสาขานั้น สาขาอื่นเดินต่อ):**

| # | ด่าน | ทำไม |
|---|---|---|
| 6 | `SYSBRANCHID → NAME` ตรงตาราง (0 ชากค้อ=SRC · 4 เก้ากิโล=KKL · 5 ศรีราชา=SSS) และมีแถวของสาขานั้น | รหัส/ชื่อเพี้ยนหรือ export ไม่ครอบสาขา |
| 7 | ต้องมี R01 (`r01Version`) + `global_r05` | เหมือนที่เว็บบังคับ "โหลด R01/R05 ก่อน" · เกิดเมื่อเพิ่งกดเริ่มนับใหม่ (`startNewCount` ลบ `{branch}_r01`) |
| 8 | `r01UploadedAt` ต้องเป็นวันนี้ | คู่มือกำหนด R16 = ตั้งแต่วันอัป R01 · ไฟล์วันนี้วันเดียวใช้ได้เมื่อ R01 เป็นของวันนี้เท่านั้น |
| 9 | แถวที่ผ่านด่านประเภทต้องจับคู่ SKU ได้อย่างน้อย 1 | จับคู่ไม่ได้เลย = R05/R01/PBM ไม่ตรงไฟล์ |
| 10 | เนื้อหา + r01Version + รอบนับ เหมือนที่ประกาศอยู่แล้ว → ไม่เขียน (`contentHash`) | รันซ้ำไม่ปลุกทุก Desktop |

ไม่มีแถวของสาขาที่ดูแลเลยแต่มีสาขาอื่น (เช่นอ่อนนุช) ในไฟล์ → ข้ามสาขาอื่นเฉย ๆ (log บอกจำนวน)

### รูปแบบวันที่ `TRANDATE` ต่างกันตามเครื่องที่ export

- เครื่องพัฒนาให้ `13/10/2026 13:06:32` · **BIGYAMAINPC ให้ `14-Oct-26 09:17:17`** (ชื่อเดือนอังกฤษ · ปี 2 หลัก) — พบจริง 14 ต.ค. 2026 (ครั้งแรกที่บอทรันกับไฟล์ที่เครื่องนั้น export ตกด่าน `TRANDATE อ่านไม่ได้ 260 แถว`)
- `parseTranDate()` ของแอปอ่านรูปแบบหลังไม่ได้ (ส่วนเดือนรับเลขเท่านั้น · ISO fallback ล้ม → `null` → `getSoldQtyBefore` ข้ามแถว = **ยอดขายก่อนเวลาสแกนไม่ถูกนับ**) ⇒ บอทแปลงด้วย `normalize_tran_date()` เป็น `14/10/2026 09:17:17` **ก่อนด่านวันที่และก่อนเก็บลง timeline** (แอปอ่านสตริงที่แปลงแล้วได้เวลาถูก — เทสเทียบกับ `parseTranDate()` จริงของหน้าเว็บ)
- รูปแบบอื่นทั้งหมดไม่ถูกแตะ (แค่ trim) · ส่วนเวลา/ชื่อเดือนผิดรูป (`14-Oct-26 garbage` · `14-Foo-26`) = ไม่แปลง → อ่านไม่ได้ → **ตกด่าน exit 4 ไม่เขียนอะไร** (fail-closed — ห้ามเดาเวลาเอง) · **log แสดงค่าจริงที่อ่านไม่ได้ให้ดูเลย** (`TRANDATE อ่านไม่ได้ 260 แถว … · ตัวอย่าง: '14-Oct-26 09:17:17', …` ไม่เกิน 3 แบบ) — เจอรูปแบบใหม่ก็วาง log ให้ผู้ดูแลได้ทันที ไม่ต้องเปิดไฟล์
- ⛔ ห้ามผ่อนให้ `parse_tran_date()` อ่านชื่อเดือนเอง — ฟังก์ชันนั้นต้องตรงกับ `parseTranDate()` ของแอปทุกกรณี (เทส parity) · การแปลงอยู่ที่ `normalize_tran_date()` ที่เดียว
- ⚠️ ผลข้างเคียงที่ตั้งใจ: chunk ของไฟล์รูปแบบนี้ **ไม่ตรง "สตริงดิบ" ของแอปแล้ว** (แอปเก็บ `14-Oct-26 …` ตามที่อ่าน แต่ถ้าผู้ใช้อัปมือไฟล์นั้น หน้าเว็บ **ปฏิเสธไฟล์** ด้วยด่านวันที่อ่านไม่ออก (`R16_UNREADABLE_DATE_GUARD` · 14 ต.ค. 2026) แล้วให้ export ใหม่เป็น `dd/mm/yyyy` — ไม่โหลดเงียบๆ ที่ยอดขายเป็น 0 · `parseTranDate()` เองยังอ่านไม่ได้) · ถ้าวันหนึ่งแอปอ่านรูปแบบนี้ได้เอง เทส canary (`normalize_tran_date`) จะล้มเพื่อให้ทบทวนว่ายังต้องแปลงหรือไม่

## 🔗 parity กับ `index.html` — สำคัญที่สุด

กติกา parse + แปลง ถูกเขียนไว้ **2 ภาษา**: `loadR16()` / `_whR16Rows()` / `_chunkWhR16Rows()` ใน `index.html` ↔ `build_timeline()` / `serialize_chunks()` / `build_barcode_map()` / `build_sku_set()` ในไฟล์นี้
**แก้ที่ใดที่หนึ่งต้องแก้อีกที่เสมอ** แล้วรัน (ต้องผ่านครบ):

```powershell
cd tests
npm run test:logic -- auto-r16-parity auto-r16-flow pharmacy-r16-cloud-timeline
$env:R16104_REAL_FILE = "$env:USERPROFILE\Desktop\run-upload-stock\R16104.CSV"; npm run test:logic -- auto-r16-parity   # เทียบไฟล์จริง (ไม่ commit ไฟล์จริง)
```

เทส parity อัป CSV ผ่านการ์ด `#fileR16` ของหน้าเว็บจริง แล้วเทียบ **สตริง JSON ของ chunk ทุกไบต์** กับที่บอทผลิต (ไม่ได้ re-implement ฝั่ง JS) — fuzz 3 สาขา × 3 seed · หลาย chunk · ขอบ chunk · `Number()`/`trim()`/`parseTranDate()` ของ JS กับ Python
กับดักที่จัดการแล้ว: `json.dumps` ใส่ช่องว่างหลังคอมมา (ใช้ `separators=(',',':')`) · เลขลงตัวต้องไม่มี `.0` · `float()` ของ Python รับเลขอาหรับ/`inf`/`1_0` แต่ JS ได้ NaN (`_js_number` รับเฉพาะรูปแบบที่ JS รับ) · `str.strip()` ต่างจาก `trim()` ของ JS (`\x1c`–`\x1f` `\x85` `\ufeff`) · ขอบ chunk นับ +1 คอมมากับแถวแรกของ chunk ใหม่ด้วย
⚠️ **ยังคงพฤติกรรมเดิมของแอป:** ORCM/OCTM ที่ Col A=0 (ขายจากคลัง) ของ SRC ถูกบวกให้หน้าร้าน (งานค้างใน CLAUDE.md — ห้ามแก้เงียบเฉพาะฝั่งบอท)

## 🖥️ ติดตั้งบน `BIGYAMAINPC` (เครื่องที่รัน BOTR16104)

> ⚠️ เครื่องนั้น**ไม่ใช่ git clone** — ก๊อปไฟล์ไปวางเอง · แก้สคริปต์ใน repo แล้วต้องเอาไปวางเองทุกครั้ง
> ตรวจเวอร์ชันก่อนรัน: `Select-String -Path auto_r16_import.py -Pattern "def normalize_tran_date" -Quiet` ต้องได้ `True` (รุ่นก่อน 14 ต.ค. 2026 ไม่มีตัวแปลงวันที่ `dd-Mon-yy` → ไฟล์จากเครื่องที่ export แบบนั้นตกด่าน `TRANDATE อ่านไม่ได้`)

1. **ลำดับ deploy (ห้ามสลับ):** push เว็บรุ่นที่มีตัวอ่านก่อน → F5 Desktop สาขายา/ปิด-เปิด PDA → ค่อยวางบอท (เว็บรุ่นใหม่อยู่เฉยๆ จนมี doc · บอทเขียนก่อนเว็บ = Desktop ไม่ได้อะไร)
2. ก๊อปโฟลเดอร์ `auto-r16` ทั้งโฟลเดอร์ (ไม่ใช่แค่ `.bat`) ไป `C:\Users\AninMainPC\Automation\auto-r16` · ต้องมี Python 3 (`.bat` หาจาก `C:\Program Files\Python311/312/313` → `PATH` → `py`)
3. **ขั้น 0 — ข้อมูลที่ต้องรู้ก่อนเลือกเวลา:** `(Get-Item "$env:USERPROFILE\Desktop\run-upload-stock\R16104.CSV").LastWriteTime` — ไฟล์ต้องเขียนเสร็จ**ก่อน**เวลา Task นี้ · และ Task `BOT16104` ต้องรันจริงเป็นประจำ (ดู Telegram + `logs\last_run.json` ของบอท — `LastTaskResult` ใช้ไม่ได้ เพราะห่อ `conhost --headless` เป็น 0 เสมอ)
   💡 ให้ BOTR16104 export **หลัง 21:00 เล็กน้อย** จะครอบทุกสแกน (ร้านสแกนได้ถึง 20:59) · export ก่อนนั้น = สแกนที่เกิดหลังเวลา export ไม่ถูกชดเชย (เหมือนอัปมือเวลาเดียวกัน)
4. `.\run_auto_r16.bat --dry-run` → `Get-Content .\auto_r16.log -Tail 40 -Encoding UTF8` (ต้องมี `-Encoding UTF8`) — ต้องเห็นโฟลเดอร์/ไฟล์ถูกต้อง · จำนวนแถวต่อสาขาสมเหตุสมผล · ไม่มี ❌ · **ถ้าไม่ผ่านอย่าเพิ่งตั้ง Task**
5. รันจริงครั้งแรกด้วยมือ **หลัง 21:00** (นอกเวลาสแกน) แล้วเปิด Desktop เภสัช: การ์ด R16.104 ขึ้น `Ready` + เวลา/ช่วงข้อมูล · ปุ่ม Confirm ปลดล็อก
6. ลงทะเบียน Task (แก้ 2 บรรทัดบนให้ตรงเครื่อง แล้ววางทั้งก้อนใน PowerShell):

```powershell
$Root = "$env:USERPROFILE\Automation\auto-r16"     # <-- ที่วางโฟลเดอร์
$Time = "21:00"                                    # <-- ต้องหลังเวลาที่ไฟล์เสร็จจริง (ขั้น 3)
$Bat  = Join-Path $Root "run_auto_r16.bat"
if (-not (Test-Path $Bat)) { throw "ไม่พบ $Bat" }

$A = New-ScheduledTaskAction -Execute $Bat -WorkingDirectory $Root
$T = New-ScheduledTaskTrigger -Daily -At $Time
$S = New-ScheduledTaskSettingsSet `
       -StartWhenAvailable `
       -ExecutionTimeLimit (New-TimeSpan -Minutes 15) `
       -MultipleInstances IgnoreNew `
       -DontStopIfGoingOnBatteries -AllowStartIfOnBatteries `
       -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 20)

Register-ScheduledTask -TaskName "AutoR16Import" -Action $A -Trigger $T -Settings $S `
       -Description "อัป R16.104 (timeline สาขายา SRC/KKL/SSS) ขึ้น Firestore ทุกวัน" -Force
```

`-RestartCount 3 -RestartInterval 20m` = ถ้า BOTR16104 ช้า (exit 4 เพราะไฟล์ยังไม่ใช่ของวันนี้/ยังไม่นิ่ง) ลองใหม่อีก 3 รอบ · `-StartWhenAvailable` = เครื่องปิดตอน 21:00 → รันชดเชยเมื่อเปิด (ไฟล์ต้องยังเป็นของวันนี้ ไม่งั้น exit 4 โดยปลอดภัย)
ปิดฉุกเฉิน: `Disable-ScheduledTask -TaskName AutoR16Import` (เว็บอ่านต่อได้ แต่ไม่มีของใหม่ — พนักงานอัปมือที่การ์ด R16.104 เหมือนเดิมได้เสมอ)

## exit code + ตรวจผล

| code | ความหมาย |
|---|---|
| `0` | สำเร็จ **หรือ** เนื้อหาเหมือนเดิมจึงไม่เขียน (`--dry-run` ก็ 0) |
| `1` | อ่าน/เขียน Firestore ล้ม (สาขาที่ล้มถูกเก็บกวาดแล้ว) |
| `2` | ไม่พบไฟล์/โฟลเดอร์ หรือ flag ไม่ถูกต้อง |
| `4` | ตกด่าน (ไฟล์ไม่ใช่วันนี้/ยังไม่นิ่ง · หัวคอลัมน์เพี้ยน · มีแถวไม่ใช่วันนี้ · มีสาขาที่ถูกข้าม) — **ไม่เขียนสาขานั้น** |
| `9` | ไม่พบ Python (`.bat`) |

เห็น exit 4 ติดกันหลายวัน = ไปแก้ที่ Task `BOT16104` (หรือบอท auto-r01) ไม่ใช่ที่นี่ · ตรวจบน Firestore: `{branch}_r01.r16DetailVersion` = `{branch}_r16_104_meta.version` และ `r16UploadedAt` เป็นเย็นวันนี้
`LastTaskResult` ของ Task นี้คือ exit code ของสคริปต์ตรงๆ (ต่างจาก BOT16104 ที่ห่อ conhost)

## ข้อจำกัดที่ต้องรู้

- สแกนที่เกิดหลังเวลา export ของไฟล์ไม่ถูกชดเชย · ไม่คำนวณ `dateMismatch` (ด่าน "ไฟล์วันนี้" แทน — เว็บเตือนตอนอัปมือเท่านั้น และบอทไม่อ่าน items)
- อัปมือที่ Desktop หลังบอท = local timeline เฉพาะเครื่อง (เครื่องอื่นเห็น version ไม่ตรง → ไม่โหลด timeline ของบอท) เท่ากับสถานะก่อนมีบอท
- `reEvaluateAuditItems()` ไม่ถูกเรียกตอนโหลดจาก Cloud (กันทุก Desktop พลิกสถานะพร้อมกัน) — สถานะที่ Confirm ไปแล้วไม่เปลี่ยนเอง
- KKL = `SYSBRANCHID 4` ยืนยันจากไฟล์ตัวอย่างไฟล์เดียว (บอทตรวจ id+ชื่อทุกรอบ) · ความหมาย Col A ของ OTFI/OTFB ของ KKL/SSS ยังไม่มีไฟล์ยืนยัน (ใช้กติกาแอปเดิม)
