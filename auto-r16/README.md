# Auto R16.104 Import → Firestore (สาขายา SRC / KKL / SSS)

อ่านไฟล์ `R16104.CSV` ที่บอท `BOTR16104` (ProMaxx GUI automation) export ไว้ใน `Desktop\run-upload-stock`
แล้วเขียน **timeline R16.104 ของแต่ละสาขา** ขึ้น Firestore ให้ Desktop สาขายาโหลดเอง —
แทนการที่พนักงาน export R16.104 แล้วอัปที่การ์ด **R16.104** (`upload-file-item`) ทุกเย็นก่อน Confirm

> ใช้ได้เฉพาะ **SRC / KKL / SSS** · **ไม่ทำ WH** (WH มีขั้นอัป R16 ของตัวเองอยู่แล้ว) · **ไม่ทำ R16.103**
> ต้องใช้คู่กับเว็บรุ่นที่มีตัวอ่าน `_loadPharmacyR16Timeline()` (สวิตช์ `PHARMACY_R16_CLOUD_TIMELINE`) — เขียน Firestore อย่างเดียว **ไม่ปลดล็อกปุ่ม Confirm**
>
> 🤖 **Confirm โดยบอท (ต.ค. 2026 · ผู้ใช้สั่ง):** บอทตัวนี้ "กด Confirm ให้เลย" หลังอัป R16 ได้ด้วย (ตัดสิน Pass / Stock Adj แทนปุ่ม Confirm ของ Desktop) —
> **ปิดเป็นค่าเริ่มต้น** ต้องใส่ flag `--confirm-shadow` / `--confirm` เอง · อ่านหัวข้อ [🤖 Confirm โดยบอท](#-confirm-โดยบอท) **ก่อนเปิด** · ไม่ใส่ flag = ทำงานเหมือนเดิมทุกอย่าง
>
> 📣 **แจ้งเตือน Telegram (23 ต.ค. 2026 · ผู้ใช้สั่ง "ถ้าบอทไม่ Confirm ให้ส่ง Telegram"):** บอทส่งสรุปทุกคืนหลังรันจบ (✅ สำเร็จ / ❌ ไม่สำเร็จพร้อมสาเหตุ) — **ตั้งค่าใน `.env` ก่อนจึงจะส่ง** (ไม่ตั้ง = ไม่ส่ง ทำงานเหมือนเดิม) · อ่านหัวข้อ [📣 แจ้งเตือน Telegram](#-แจ้งเตือน-telegram)

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
| 2b | **`auto-r16` ต่อท้ายข้อ 2 ในการรันเดียวกัน — เฉพาะเมื่อใส่ `--confirm*`** (ปิดเป็นค่าเริ่มต้น) | **Confirm ให้เลย:** ตัดสิน Pass / Stock Adj ของรายการ `scanning` ทั้งสาขา (ดู [🤖 Confirm โดยบอท](#-confirm-โดยบอท)) | หลังเผยแพร่ timeline ครบทุกสาขา · **~21:10** (หลัง 21:00 และหลังไฟล์ export) |
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
| `confirm_journal/` | **ทางย้อนผล Confirm ของบอท** — 1 ไฟล์ต่อสาขาต่อคืนที่ Confirm จริง (`YYYY-MM-DD_HHMMSS_<สาขา>.json`: ค่า item ก่อน/หลังทุกรายการ) · ลบเองเมื่อเก่ากว่า 45 วันหลัง Confirm จริงสำเร็จ · ไม่เข้า git · **อย่าลบมือเอง** ถ้ายังอยากย้อนผลได้ |
| `auto_r16_confirm_shadow.jsonl` | บันทึกโหมดเงา (`--confirm-shadow`): ผลที่บอท "จะ" ตัดสินต่อ SKU ทุกคืน · เกิน 30 MB หมุนเป็น `.jsonl.1` (เก็บ 2 ไฟล์) · ไม่เข้า git |

## วิธีรัน

```powershell
python auto_r16_import.py --dry-run     # อ่าน Firestore + พิมพ์ตัวเลขต่อสาขา ไม่เขียนอะไรเลย  ← เริ่มที่นี่เสมอ
python auto_r16_import.py               # โหมดจริง
python auto_r16_import.py --branch KKL  # เฉพาะบางสาขา (คั่นด้วยจุลภาคได้)
python auto_r16_import.py --force       # ข้ามด่านวันที่/ไฟล์นิ่ง — ใช้ตอนทดสอบเท่านั้น

# Confirm โดยบอท (ปิดเป็นค่าเริ่มต้น · อ่านหัวข้อ "🤖 Confirm โดยบอท" ก่อน)
python auto_r16_import.py --confirm-shadow                                  # โหมดเงา: คำนวณ+จดไฟล์ ไม่เขียน items
python auto_r16_import.py --confirm --confirm-branch SSS --confirm-shadow   # SSS เขียนจริง · สาขาอื่นเงา
python auto_r16_import.py --confirm-compare                                 # เทียบผลโหมดเงากับสถานะจริง (อ่านอย่างเดียว)
python auto_r16_import.py --confirm-undo .\confirm_journal\<ไฟล์>.json      # ย้อนผล (ใส่ --dry-run ดูก่อน)
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
| 7 | ต้องมี R01 (`r01Version`) + `global_r05` | เหมือนที่เว็บบังคับ "โหลด R01/R05 ก่อน" · เกิดเมื่อ `{branch}_r01` ถูกลบ: กดเริ่มนับใหม่ด้วยเว็บรุ่นก่อน 28 ต.ค. 2026 (หรือเครื่องที่ยังไม่ปิด-เปิดแอป/F5 หรือสวิตช์ `PHARMACY_KEEP_R01_ON_NEW_COUNT` ปิด) · Admin `clearAllData()` — เว็บรุ่นใหม่ `startNewCount` **คง R01 ของบอทไว้** จึงไม่ถูกข้ามเพราะข้อนี้อีก |
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

## 🤖 Confirm โดยบอท

**เป้าหมาย (ผู้ใช้สั่ง 22 ต.ค. 2026):** วันที่ 1 พนักงานสแกน → จบวัน บอทอัป R16 แล้ว **Confirm ให้เลย** (ตัดสิน Pass / Stock Adj) → วันที่ 2 พนักงานเห็น Stock Adj ได้ทันทีและสแกนต่อได้ โดยไม่ต้องรอใครเปิด Desktop กด Confirm

> ⏳ **สถานะ: เขียนแล้ว + ผ่านเทสอัตโนมัติ แต่ยังไม่เคยรันกับข้อมูลจริง และยังไม่ได้วางบน `BIGYAMAINPC`** · ค่าเริ่มต้น**ปิด** · ลำดับเปิดที่ตกลงไว้: **โหมดเงาก่อน** → เขียนจริงทีละสาขา SSS → KKL → SRC
> ตอนนี้ร้านยังไม่มีการนับ ⇒ โหมดเงา**ยังไม่มีอะไรให้เทียบ** จนกว่าจะเริ่มนับรอบใหม่

### หลักการ

- ผลที่บอทเขียน = ผลที่ปุ่ม Confirm ของ Desktop (`validateAndProcess`) เขียนบนข้อมูลชุดเดียวกัน **ทุกฟิลด์** — พิสูจน์ด้วยเทส (ตรรกะเทียบหน้าเว็บจริง + fuzz · dual-run บน emulator) ดู CLAUDE.md §Confirm โดยบอท
- เฉพาะสาขายา (ไม่ผ่าน Audit — `PHARMACY_DIRECT_STOCK_ADJ`): `นับ + ขายก่อนเวลาสแกน − รับเข้าก่อนเวลาสแกน` = ระบบ → **pass** · ไม่ตรง → **stock_adjustment** (`directAdj` + แช่ `effectiveQty`/`systemQty`) · `noStock` ตามกติกาเดิม
- ใช้ lock ตัวเดียวกับ Desktop (`{branch}_confirm_lock`) — ระหว่างบอททำงานทุกเครื่องขึ้นแถบ "กำลัง Confirm ที่ Desktop โดย auto-r16 — พักการสแกนชั่วคราว" (ไม่กี่วินาที)
- ⚠️ **สูตรนี้มีสำเนาที่ 3 แล้ว** (`_buildPendingScanEvaluation` · `reEvaluateAuditItems` ใน `index.html` · `evaluate_candidate()` ที่นี่) — แก้สูตรฝั่งเว็บต้องแก้ที่นี่ด้วยแล้วรัน `cd tests && npm run test:logic -- auto-r16-confirm-parity auto-r16-confirm-flow auto-r16-confirm-tools` และ `npm run test:e2e -- auto-r16-confirm`
- ⛔ ห้ามเปลี่ยนชื่อ/signature ของ `build_sku_infos` · `timeline_maps` · `evaluate_candidate` · `item_changes` — เทส parity import ตรงๆ

### flag

| flag | ทำอะไร |
|---|---|
| (ไม่ใส่) | ทำงานเหมือนเดิมทุกอย่าง — เผยแพร่ timeline อย่างเดียว |
| `--confirm-shadow` | **โหมดเงา:** ทุกสาขาที่ผ่านด่าน บอทคำนวณผล Confirm ครบทุกรายการแล้ว**จดลงไฟล์** `auto_r16_confirm_shadow.jsonl` — ไม่เขียน items / lock / audit log เลย |
| `--confirm --confirm-branch SSS[,KKL,SRC]` | **เขียนจริง** เฉพาะสาขาที่ระบุ (ต้องอยู่ใน `--branch` ด้วย · ไม่มีค่าเริ่มต้น "ทุกสาขา" โดยตั้งใจ) · สาขาที่เหลือเป็นโหมดเงาถ้ามี `--confirm-shadow` |
| `--confirm-max-adj-ratio 0.5` | เพดานสัดส่วน Stock Adj ที่บอทยอมเขียนเอง (tripwire) · `1` = ปิดเพดาน |
| `--confirm-undo <journal.json>` | **ย้อนผล** Confirm ของบอท (ใส่ `--dry-run` ดูก่อนได้) |
| `--confirm-compare [--confirm-date YYYY-MM-DD]` | เทียบผลโหมดเงากับสถานะจริงบน Cloud (อ่านอย่างเดียว) |
| `--dry-run` | คำนวณและรายงานอย่างเดียว ไม่ถือ lock ไม่เขียนอะไร (ไม่จดโหมดเงาด้วย) |
| `--force` | ข้ามด่านเวลา/นาฬิกา — **ใช้ตอนทดสอบเท่านั้น** |
| `--notify-test` | ส่งข้อความทดสอบ Telegram แล้วจบ (ใช้เดี่ยวๆ) — ดู [📣 แจ้งเตือน Telegram](#-แจ้งเตือน-telegram) |
| `--no-notify` | รอบนี้ไม่ส่งแจ้งเตือน (ปกติ `--dry-run` / `--confirm-compare` / `--confirm-undo` ไม่ส่งอยู่แล้ว) |

flag ผิดรูป/ขัดกัน (เช่น `--confirm` ไม่มี `--confirm-branch` · `--confirm-branch` ไม่มี `--confirm` · สาขานอก `--branch`) → **ปฏิเสธ exit 2** ไม่เงียบ

### บอททำอะไรต่อสาขา (เขียนจริง · ลำดับห้ามสลับ)

1. **ด่านเวลา:** ต้องหลัง 21:00 (ร้านปิดสแกน 21:00–08:00) · ไฟล์ R16 ต้อง export หลัง 21:00 · นาฬิกาเครื่องต้องตรงเซิร์ฟเวอร์ Firestore (ต่างเกิน 120 วิ = ไม่ทำ) · ทำได้ภายในวันเดียวกันเท่านั้น (พ้นเที่ยงคืน = ตกด่าน)
2. **preflight:** สาขาเป็น schema v2 · รอบนับ/R01/timeline เหมือนตอนเผยแพร่เมื่อกี้ (มีคนอัป R16 ทับ/กดเริ่มนับใหม่ = ไม่ทำ)
3. **ถือ lock** แล้วรอ 3.8 วิให้ PDA ส่งของค้างขึ้น Cloud → ตรวจ preflight ซ้ำ
4. **อ่านรายการ `scanning` ของรอบนี้ → คัดกรอง (เข้มกว่า Desktop โดยตั้งใจ เพราะไม่มีคนเฝ้า):** **ไม่ Confirm** และปล่อยเป็น `scanning`: สแกนก่อนวันนี้ (ค้างข้ามวัน) · สแกนหลังเวลา export ของไฟล์ · ไม่มี/อ่านเวลาสแกนไม่ได้ · ไม่มียอดนับ · SKU ไม่อยู่ในแคตตาล็อกสาขา — log บอกจำนวนแต่ละกลุ่ม
5. **tripwire:** Stock Adj เกิน 50% ของ ≥ 20 รายการ = สงสัย R01/R16 ผิดชุด → ไม่เขียนอะไร (exit 4) รอคนตรวจ · ⚠️ ค่า 50% ตั้งจากข้อมูลจริงที่มีน้อยมาก (Confirm ยุคไม่ผ่าน Audit มีวันเดียว = KKL 7 ต.ค. 33/447 = 7.4% · วันอื่นของ 3 สาขา 0–16%) — **ยังไม่ได้ปรับเทียบด้วยโหมดเงา** ดูอัตราใน log ทุกคืนแล้วค่อยปรับ (`--confirm-max-adj-ratio`)
6. **journal ก่อนเขียน:** บันทึกค่า item ก่อน/หลังลง `confirm_journal/` (เขียน journal ไม่ได้ = ไม่เขียน Cloud เลย เพราะถ้าผิดจะย้อนไม่ได้)
7. **เขียนแบบ atomic ต่อชุด (≤ 450 รายการ):** `documents:commit` + เงื่อนไข `updateTime` ของทุก item — มี item ใดเปลี่ยนระหว่างบอทคำนวณ (พนักงานสแกนเพิ่ม/เครื่องอื่น Confirm) = ชุดนั้นไม่ถูกเขียนเลย (ทั้งก้อนหรือไม่เลย) · เขียนแต่ละ item แบบ mask เฉพาะฟิลด์ที่ Confirm แตะ + `rev + 1` + `updatedBy: 'auto-r16'` + `updatedAt` จากเซิร์ฟเวอร์ · commit ที่ไม่รู้ผล (เครือข่ายหลุด) = ไม่ลองซ้ำเอง อ่านกลับดูก่อน
8. **เขียน `stock_audit_log/{สาขา}_{วันที่}`** (Dashboard/ประวัติผู้ช่วยอ่าน) แบบเดียวกับที่ Desktop เขียน — ล้มแค่เตือน ผล Confirm ไม่กระทบ
9. **ปล่อย lock** (เฉพาะ lock ที่ token เป็นของบอทเอง) · แล้วลบ journal ที่เก่ากว่า 45 วัน (เฉพาะหลัง Confirm จริงสำเร็จ)

> ⚠️ สาขาที่มี > 450 รายการในคืนเดียวจะถูกแบ่งเป็นหลาย commit — **atomic เฉพาะภายในชุด** ถ้าชุดหลังล้มจะเหลือรายการบางส่วน (exit 1 · journal `partial` · รันคำสั่งเดิมซ้ำได้ รายการที่ Confirm แล้วไม่ถูกแตะซ้ำ · หรือ `--confirm-undo`)

### โหมดเงา + เทียบผล

- `--confirm-shadow` จด 1 บรรทัดต่อสาขาต่อรอบ (ผลทำนายต่อ SKU: นับ/ขาย/รับเข้า/ระบบ/สถานะ) — ติดธง `early` ถ้ารันก่อน 21:00 หรือไฟล์ export ก่อน 21:00 หรือนาฬิกาเครื่องคลาด (ตัวเลขนั้นไม่ใช่ของ 21:10 จริง)
- `python auto_r16_import.py --confirm-compare` เทียบบันทึกล่าสุดของแต่ละสาขากับสถานะจริงบน Cloud: **ตรงกัน / ต่างกัน / ยังเป็น scanning (ยังไม่มีใคร Confirm) / ไม่พบ (ถูกรีเซ็ต)** + รายการที่ต่างพร้อมตัวเลข — อ่านอย่างเดียว · ต้องมีคนกด Confirm จริงที่ Desktop ในรอบเดียวกันก่อน จึงมีอะไรให้เทียบ

### ย้อนผล

```powershell
Get-ChildItem .\confirm_journal | Sort-Object Name | Select-Object -Last 3        # หา journal ของคืนที่ต้องการ
python auto_r16_import.py --confirm-undo .\confirm_journal\2026-10-22_211000_SSS.json --dry-run   # ดูก่อน (ไม่เขียน)
python auto_r16_import.py --confirm-undo .\confirm_journal\2026-10-22_211000_SSS.json             # ย้อนจริง
```

- ย้อนเฉพาะรายการที่ **ยังเป็นผลของบอทเป๊ะ** (`updatedBy` = auto-r16 · `rev` และค่าตรงที่บอทเขียน) — รายการที่มีคนเปลี่ยนต่อแล้ว (↺ สแกนใหม่ / ✕ / แก้จากเครื่องอื่น) ไม่ถูกแตะ และ log บอก SKU ที่ข้าม
- ย้อนแล้วรายการกลับเป็น `scanning` (ฟิลด์ที่บอทเพิ่มถูกลบ) · `rev` เดินหน้าอย่างเดียว · Desktop กด Confirm เองต่อได้ตามปกติ (เทส e2e พิสูจน์ว่าได้ผลเดิม) · audit log ของคืนนั้นถูกเขียนใหม่ให้ตรง
- ⛔ ย้อนไม่ได้ถ้ารอบนับเปลี่ยนแล้ว (กดเริ่มนับใหม่) หรือมี lock ถืออยู่ · **ใบ 📦 ที่ Export ไป ERP แล้วย้อนตามไม่ได้** — ตรวจก่อน Export ใบ Stock Adj ของคืนที่เพิ่งเปิดใช้

### ขั้นตอนเปิดใช้ (บน `BIGYAMAINPC`)

1. **วางไฟล์:** ก๊อปโฟลเดอร์ `auto-r16` ทั้งโฟลเดอร์ทับ (เครื่องนั้นไม่ใช่ git clone) แล้วตรวจรุ่น: `Select-String -Path auto_r16_import.py -Pattern "def evaluate_candidate" -Quiet` ต้องได้ `True` — รุ่นเก่าไม่รู้จัก flag `--confirm*` และ**ปฏิเสธด้วย exit 2** (ไม่ใช่เขียนเงียบ) ⚠️ แปลว่า**ต้องวางไฟล์ใหม่ + ตรวจรุ่นให้ผ่านก่อนแตะ `-Argument` ของ Task เสมอ** — ถ้าใส่ flag ก่อน สคริปต์เก่าจะ exit 2 ตั้งแต่ต้น และ**คืนนั้นไม่เผยแพร่ timeline เลย** (ปุ่ม Confirm ของ Desktop ต้องรออัปมือ)
2. **ซ้อมแห้ง:** `.\run_auto_r16.bat --dry-run --confirm-shadow` หลัง 21:00 ตอนมีรายการ `scanning` → log ต้องไม่มี ❌ และตัวเลข Pass / Stock Adj สมเหตุสมผล
3. **เปิดโหมดเงา** ใน Task (ย้ายเวลาเป็นหลัง BOT16104 เสร็จและหลัง 21:00 เช่น 21:10):

```powershell
$Root = "$env:USERPROFILE\Automation\auto-r16"
$A = New-ScheduledTaskAction -Execute (Join-Path $Root "run_auto_r16.bat") -Argument "--confirm-shadow" -WorkingDirectory $Root
$T = New-ScheduledTaskTrigger -Daily -At "21:10"
Set-ScheduledTask -TaskName "AutoR16Import" -Action $A -Trigger $T
```

4. **ทุกเช้า:** `Get-Content .\auto_r16.log -Tail 60 -Encoding UTF8` (หา `Confirm SSS shadow(N)`) แล้ว `python auto_r16_import.py --confirm-compare`
5. **เกณฑ์ผ่านโหมดเงา (ข้อเสนอ — ปรับได้):** อย่างน้อย 3 คืนที่มีรายการประเมิน ≥ 20 รายการต่อสาขา และ `ต่างกัน 0` (ถ้ามีรายการต่างต้องอธิบายได้ทุกตัว) และอัตรา Stock Adj อยู่ในช่วงปกติ
6. **เปิดเขียนจริงทีละสาขา** (SSS ก่อน): เปลี่ยน `-Argument` เป็น `"--confirm --confirm-branch SSS --confirm-shadow"` (SSS เขียนจริง · KKL/SRC ยังเงา) → เช้าวันถัดไปตรวจ: Desktop เห็น Pass/Stock Adj ครบ · ไม่มี `scanning` ค้างยกเว้นที่ log ระบุว่าข้ามโดยตั้งใจ · ไม่ถูกต้อง → `--confirm-undo`
7. ขยาย KKL → SRC (`--confirm-branch SSS,KKL` → `SSS,KKL,SRC`) โดยเว้นอย่างน้อย 1–2 คืนต่อสาขา

#### ทางที่ผู้ใช้เลือกจริง (23 ต.ค. 2026): เขียนจริง 3 สาขาพร้อมกัน + แจ้งเตือน Telegram

ผู้ใช้สั่งข้ามลำดับ SSS → KKL → SRC ด้านบน (ผลโหมดเงาคืน 22 ต.ค. ตรงกับปุ่มจริง 1/1 รายการ) — **ยังไม่เคยเขียนจริงกับข้อมูลจริงเลยสักคืน และ tripwire ยังไม่ได้ปรับเทียบ** จึงชดเชยด้วย: Telegram สรุปทุกคืน (ความเงียบ = มีปัญหา) · journal + `--confirm-undo` · tripwire · **เก็บปุ่ม Confirm ที่ Desktop ไว้เป็นทางสำรองจนกว่าจะผ่านเกณฑ์** (สวิตช์ `PHARMACY_DESKTOP_CONFIRM_BY_BOT` ใน `index.html` ค่าเริ่มต้นปิด — เกณฑ์พลิกอยู่ใน CLAUDE.md)

ลำดับ (ห้ามสลับ — ข้อ 1–2 ก่อนข้อ 5 เสมอ: ① สคริปต์รุ่นเก่าที่ไม่รู้จัก flag ใหม่ → exit 2 → คืนนั้นไม่เผยแพร่ timeline เลย ② ต่อให้เป็นรุ่น 22 ต.ค. ที่รู้จัก `--confirm` ก็ไม่มี Telegram → คืนแรกที่เขียนจริงจะเงียบ ซึ่งคือสิ่งที่แจ้งเตือนมีไว้กัน — และต้องเห็นข้อความ `--notify-test` ในแชทจริงก่อนจึงเปิดเขียนจริง):

1. ก๊อป `auto-r16` ทั้งโฟลเดอร์ทับ (ห้ามลบโฟลเดอร์ — log/`confirm_journal` อยู่ในนั้น) → `Select-String -Path auto_r16_import.py -Pattern "def send_telegram" -Quiet` ต้องได้ `True`
2. สร้าง `.env` + `python auto_r16_import.py --notify-test` ต้องได้ข้อความในแชท (ดู [📣 แจ้งเตือน Telegram](#-แจ้งเตือน-telegram))
3. ตั้ง RestartCount (ตอนนี้บน `BIGYAMAINPC` เป็น 0 — ไม่ลองใหม่เลย): ถ้าไฟล์ BOT16104 มาช้าบอทจะลองใหม่ 21:30 / 21:50 / 22:10 ซึ่งยังอยู่ในวันเดียวกัน
4. ซ้อมด้วยคำสั่งจริงของ Task: `.\run_auto_r16.bat --dry-run --confirm --confirm-branch SSS,KKL,SRC; $LASTEXITCODE` ต้องได้ `0` (ถ้าเป็น `2` = สคริปต์เป็นรุ่นเก่าหรือ flag ผิด — ห้ามไปข้อ 5) · `.bat` เขียนผลลง `auto_r16.log` (ดู `Get-Content .\auto_r16.log -Tail 40 -Encoding UTF8`) · ซ้อมแล้วไม่ส่ง Telegram (`--dry-run` ไม่ส่ง) — ข้อความทดสอบมาจากข้อ 2 เท่านั้น
5. เปลี่ยน `-Argument` ของ Task

```powershell
$Root = "C:\Users\AninMainPC\Automation\auto-r16"
$Bat  = Join-Path $Root "run_auto_r16.bat"
if (-not (Test-Path $Bat)) { throw "ไม่พบ $Bat" }

# 3) ลองใหม่ได้ 3 ครั้งทุก 20 นาที (exit ≠ 0 เช่น ไฟล์ BOT16104 ยังไม่ใช่ของวันนี้)
$S = (Get-ScheduledTask -TaskName "AutoR16Import").Settings
$S.RestartCount = 3
$S.RestartInterval = "PT20M"
Set-ScheduledTask -TaskName "AutoR16Import" -Settings $S

# 5) เปิดเขียนจริงทั้ง 3 สาขา
$A = New-ScheduledTaskAction -Execute $Bat -Argument "--confirm --confirm-branch SSS,KKL,SRC" -WorkingDirectory $Root
Set-ScheduledTask -TaskName "AutoR16Import" -Action $A

# ตรวจผล
$t = Get-ScheduledTask -TaskName "AutoR16Import"
$t.Actions | Select-Object Execute, Arguments
$t.Settings | Select-Object RestartCount, RestartInterval
```

6. **คืนแรกที่มีรายการสแกนจริง:** อ่านข้อความ Telegram → เช้าวันถัดไปตรวจ: Desktop เห็น Pass/Stock Adj ครบ · ไม่มี `scanning` ค้างยกเว้นที่ข้อความระบุว่าข้าม · สุ่มเทียบ `confirm_journal\*.json` 5 SKU กับสูตร · **เภสัชตรวจ Stock Adj ก่อน Export ใบ 📦 ไป ERP** (`--confirm-undo` ย้อนได้เฉพาะก่อน Export — หลัง Export ย้อนตามไม่ได้)

**ปิดฉุกเฉิน (เร็วสุดก่อน):** เอา `--confirm …` ออกจาก `-Argument` ของ Task (กลับไปเผยแพร่ timeline อย่างเดียว) · หรือ `Disable-ScheduledTask -TaskName AutoR16Import` · พนักงานกด Confirm ที่ Desktop เหมือนเดิมได้ตราบที่ปุ่มยังไม่ถูกซ่อน (สวิตช์ `PHARMACY_DESKTOP_CONFIRM_BY_BOT` = `false` ซึ่งเป็นค่าเริ่มต้น — ถ้าพลิกเป็น `true` แล้วต้องตั้งกลับ `false` + deploy + F5 ทุก Desktop ก่อน ไม่งั้นไม่มีปุ่มให้กด)

### exit code ของขั้น Confirm

| สถานการณ์ | exit |
|---|---|
| Confirm สำเร็จ / ไม่มีรายการ / `--dry-run` / โหมดเงา (แม้โหมดเงาล้ม) | `0` |
| ตกด่านโดย**ไม่ได้เขียนอะไร**: เวลา/นาฬิกา · lock ถือโดยเครื่องอื่น · preflight ไม่ผ่าน · tripwire · item เปลี่ยนระหว่างคำนวณ | `4` |
| ล้ม หรือเขียนไปแล้วบางส่วน | `1` |
| flag ผิด/ไม่ครบ | `2` |

โหมดเงาล้ม**ไม่ทำให้ Task แดง** (งานหลักคือเผยแพร่ timeline) — ดูใน log · Confirm ของสาขาหนึ่งล้มไม่ทำให้สาขาอื่นไม่ถูกเผยแพร่ timeline (เผยแพร่ครบทุกสาขาก่อนเริ่ม Confirm เสมอ)

### ข้อจำกัดของ Confirm โดยบอท

- **ยังไม่เคยรันกับข้อมูลจริง** — ตรรกะตัดสินเทียบกับหน้าเว็บจริงด้วย fuzz และตรวจรูปแบบ item กับข้อมูล production (อ่านอย่างเดียว) แล้ว แต่การเขียนผ่านเทสบน Firestore emulator เท่านั้น · tripwire ยังไม่ได้ปรับเทียบ
- **ตั้งเวลา 1 ครั้งต่อคืน** (~21:10 — ไม่มี Task ชดเชยแยก) · ถ้า Task ตั้ง `-RestartCount 3 -RestartInterval 20m` จะ**ถูกรันซ้ำเอง**สูงสุด 3 ครั้งทุก 20 นาทีเมื่อจบด้วย exit ≠ 0 (ไม่ได้ยืนยันบนเครื่องจริงว่า Task Scheduler นับ exit 4 เป็น "ล้ม" · ⚠️ **22 ต.ค. 2026 Task บน `BIGYAMAINPC` เป็น `RestartCount 0`** ทั้งที่เอกสารรุ่นก่อนเขียนว่าตั้งไว้แล้ว — ตรวจด้วย `(Get-ScheduledTask AutoR16Import).Settings | Select RestartCount, RestartInterval` ไม่ใช่เชื่อเอกสาร) — Confirm รันซ้ำได้ปลอดภัย (รายการที่ Confirm แล้วไม่ใช่ `scanning` จึงไม่ถูกแตะซ้ำ · ถือ lock + precondition ทุกรอบ · ถ้ารอบแรกเขียนไปบางส่วน รอบถัดไปทำส่วนที่เหลือต่อ แต่จะมี journal 2 ไฟล์ให้ย้อน) · ไม่ต้องการให้ Confirm ถูกลองซ้ำ = ตั้ง `-RestartCount 0` · ทุกรอบที่รันซ้ำส่ง Telegram หนึ่งข้อความ (❌ ของรอบที่ล้ม แล้ว ✅ ของรอบที่สำเร็จ) · พลาดคืนไหน (ไฟล์ R16 มาช้า/lock ชน/tripwire) พนักงานกด Confirm ที่ Desktop เองได้ตราบที่ปุ่มยังไม่ถูกซ่อน · ⚠️ รายการที่ไม่ถูก Confirm และยังเป็น `scanning` ถูก**รีเซ็ตเช้าวันถัดไป**ตามกฎเดิมของเว็บ (`runStaleGuard` → toast "รีเซ็ตของค้างข้ามวัน") ถ้าไม่มีใครกด Confirm ก่อน — และ R16 ถูกล้างเช้านั้นด้วย (auto-r01) จึงไม่มีทาง Confirm ย้อนหลังข้ามวัน
- ผลเท่ากับที่ Desktop จะได้ถ้ากด Confirm ตอน 21:10 — สแกนหลังเวลา export ไม่ถูกชดเชย (ร้านปิดสแกน 21:00 จึงไม่ควรมี)
- ไม่รองรับ WH · ไม่รองรับกรณีที่เว็บเปิด `PHARMACY_DIRECT_STOCK_ADJ=false` (ส่งเข้า Audit) — บอทปฏิเสธไม่ Confirm
- เครื่องบอทต้องตั้งเวลาให้ตรง (เทียบส่วนหัว `Date` ของ Firestore) · ใช้ไฟล์ R16 ที่ export หลัง 21:00 เท่านั้น
- ต้องใช้เว็บรุ่นที่มีตัวอ่าน timeline (`_loadPharmacyR16Timeline`) ตามหัวข้อบนสุดเหมือนเดิม — Confirm โดยบอทไม่เปลี่ยนฝั่งเว็บเลย (ไม่ต้อง deploy เว็บเพิ่ม · ไม่ bump APK)

## 📣 แจ้งเตือน Telegram

**ทำไม:** บอทนี้ Confirm แทนพนักงานทุกคืน — คืนไหนไม่ Confirm (ตกด่าน / ล้ม / เครื่องดับ) รายการ `scanning` ของวันนั้นถูกรีเซ็ตเช้าวันถัดไป (ต้องนับใหม่) และบอท `auto-r*` ไม่เคยมีแจ้งเตือนเลย · ผู้ใช้สั่ง 23 ต.ค. 2026: "ถ้าบอทไม่ Confirm ให้ส่ง Telegram"

**ส่งอะไร:** หลังรันจบทุกครั้ง (รวมรันซ้ำของ Task) **1 ข้อความ** — ไม่ใช่เฉพาะตอนล้ม:
- `✅ auto-r16 · 21:10 21/10/2026 · BIGYAMAINPC — เรียบร้อย` + ไฟล์ที่ใช้ + ต่อสาขา: `SSS: R16 เผยแพร่แล้ว · Confirm 6 รายการ (Pass 3 · Stock Adj 3)` (ถ้าบอทข้ามบางรายการ จะระบุจำนวน/เหตุผลและเตือนว่ายังเป็น `scanning` จะถูกรีเซ็ตเช้าพรุ่งนี้)
- `❌ … ไม่สำเร็จ (exit N: …)` + สถานะรายสาขา + บรรทัด ❌/⚠️ จาก log + คำสั่ง "รันซ้ำคืนนี้ก่อนเที่ยงคืน"
- ถ้า Task ไม่มี `--confirm*` ข้อความ ✅ จะมี `⚠️ Confirm โดยบอทปิดอยู่` (กันลืม) · โหมดเงาระบุ "เงา (ไม่เขียน)"

**ทำไมส่งแม้สำเร็จ:** ถ้าเครื่อง `BIGYAMAINPC` ดับ / Task ไม่รัน / ไม่มีเน็ต บอทไม่มีโอกาสส่งอะไรเลย — **ความเงียบคือสัญญาณเดียวที่เหลือ** · ถึง ~22:00 แล้วยังไม่มีข้อความของคืนนี้ = ต้องเข้าไปดูเครื่อง (ข้อจำกัด: ยังไม่มีตัวเฝ้าอิสระที่แจ้งเมื่อ "ไม่มีข้อความ" — ถ้าต้องการ ต้องทำแยก)

**ไม่ส่งเมื่อ:** `--dry-run` · `--confirm-compare` · `--confirm-undo` · `--help` · `--no-notify` · `--notify-test` (ส่งข้อความทดสอบข้อความเดียว) · ไม่ได้ตั้งค่า (log บอกเหตุผล 1 บรรทัด) · `AUTO_R16_NOTIFY=0`

### ตั้งค่า (บน `BIGYAMAINPC`)

สร้างไฟล์ `.env` **ข้างสคริปต์** (`C:\Users\AninMainPC\Automation\auto-r16\.env`):

```
TELEGRAM_BOT_TOKEN=123456789:AAH...ค่าจาก @BotFather
TELEGRAM_CHAT_ID=987654321
```

- ใช้บอท/แชทเดียวกับ BOT16104 ได้ (เลขแชทของกลุ่ม/ช่องขึ้นต้นด้วย `-` หรือใช้ `@ชื่อช่อง`) · หา chat id: ส่งข้อความหาบอท แล้วเปิด `https://api.telegram.org/bot<TOKEN>/getUpdates` ในเบราว์เซอร์เครื่องตัวเอง → `chat.id` (⚠️ URL นี้มี token — อย่าแชร์/แปะที่ไหน)
- ลำดับที่หาค่า (แยกทีละตัวแปร): **ตัวแปรระบบ** → `.env` ข้างสคริปต์ → `.env` ในโฟลเดอร์ CSV (`run-upload-stock`) · ไวยากรณ์: `KEY=ค่า` · `export KEY=ค่า` · `KEY="ค่า"  # คอมเมนต์` · บรรทัดขึ้นต้น `#` ข้าม · ไฟล์บันทึกเป็น UTF-8 (มี BOM ก็ได้)
- ค่าตัวอย่างในวงเล็บมุม `<...>` หรือรูปแบบผิดถูกปฏิเสธ (log บอกว่าตัวไหนผิด **โดยไม่พิมพ์ค่านั้นซ้ำ**)
- ทดสอบ: `python auto_r16_import.py --notify-test` (พิมพ์ผลที่หน้าจอ · หรือ `.\run_auto_r16.bat --notify-test; $LASTEXITCODE` — ⚠️ `.bat` เขียนผลลง `auto_r16.log` ไม่ใช่หน้าจอ ให้ดูด้วย `Get-Content .\auto_r16.log -Tail 15 -Encoding UTF8`) → exit `0` + ข้อความ 🔔 ในแชท · exit `2` = ตั้งค่าไม่ครบ/ผิด/ปิดด้วย `AUTO_R16_NOTIFY` · exit `1` = ส่งไม่สำเร็จ (log บอกเหตุผลสั้น: `HTTP 401` = token ผิด · `HTTP 403` = บอทถูกบล็อก/ไม่ได้อยู่ในกลุ่ม · `URLError` = ไม่มีเน็ต/ถูกบล็อก)
- ปิดชั่วคราวโดยไม่แก้ Task: `setx AUTO_R16_NOTIFY 0` (เปิด CMD ใหม่) หรือใส่ `--no-notify` ใน `-Argument`

### ความปลอดภัย / ความเสถียร

- ⛔ `.env` อยู่ใน `.gitignore` (repo นี้ **PUBLIC**) — **ห้าม commit / ห้ามแปะ token ในแชท-เอกสาร** · token หลุด = ใครก็ส่งข้อความในนามบอทได้ → เพิกถอนที่ @BotFather (`/revoke`) แล้วออก token ใหม่
- บอทไม่พิมพ์ token ลง log หรือข้อความ (เหตุผลที่ส่งไม่สำเร็จเป็นแค่ชื่อชนิด error / `HTTP nnn`) และซ่อนสิ่งที่หน้าตาเหมือน token / `key=` ในข้อความด้วย — เป็นชั้นกันพลาด ไม่ใช่เหตุผลให้ประมาท
- **ส่งไม่ได้/ช้า/ตั้งค่าผิด ไม่เปลี่ยน exit code และไม่ทำให้งานหลักล้ม** · ส่งใน thread แยก รอไม่เกิน 30 วินาที (ต่อคำขอ 10 วินาที) · ลองซ้ำ 1 ครั้งหลังรอ 1.5 วินาที เฉพาะ 429 / 5xx / เครือข่าย (4xx อื่น = ค่าผิด ไม่ลองซ้ำ) · ข้อความยาวเกิน 3,500 ตัวอักษรถูกตัดท้าย
- ข้อมูลที่ส่งออกนอกเครื่อง: ชื่อเครื่อง · เวลา · ชื่อไฟล์ · จำนวนรายการ Pass/Stock Adj ต่อสาขา · บรรทัดเตือนจาก log (อาจมีรหัส SKU, path ในเครื่อง และ**ชื่อผู้ใช้ที่ถือ lock อยู่** เช่น `มี lock ถืออยู่ (ชื่อ…)` — ไม่มีชื่อสินค้า/ข้อมูลลูกค้า) → ใช้แชทส่วนตัว/กลุ่มภายในเท่านั้น

### คืนที่ได้ ❌ ทำอะไร

1. `Get-Content .\auto_r16.log -Tail 60 -Encoding UTF8` — ข้อความ Telegram ชี้สาเหตุหลักไว้แล้ว (ไฟล์ไม่ใช่วันนี้ → ตรวจ Task `BOT16104` · มี lock → Desktop กำลัง Confirm รอ 5 นาที · tripwire → ตรวจ R01/R16 ว่าผิดชุดไหม · exit 1 → Firestore/เครือข่าย)
2. แก้สาเหตุแล้ว **รันซ้ำก่อนเที่ยงคืน** (ด่านเวลายังบังคับ: หลัง 21:00 · ไฟล์ R16 export หลัง 21:00 · วันเดียวกัน): `.\run_auto_r16.bat --confirm --confirm-branch SSS,KKL,SRC` — รันซ้ำปลอดภัย (รายการที่ Confirm แล้วไม่ถูกแตะซ้ำ)
3. ไม่ทัน → รายการ `scanning` ถูกรีเซ็ตเช้าพรุ่งนี้ + R16 ถูกล้าง (auto-r01) ⇒ ต้องนับใหม่ · ทางสำรองระหว่างปุ่มยังอยู่: พนักงานกด Confirm ที่ Desktop เอง (ต้องมี R16 ของวันนี้โหลดอยู่ — ถ้าบอทไม่ได้เผยแพร่ให้อัปมือที่การ์ด R16.104 ก่อน)

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
| `1` | อ่าน/เขียน Firestore ล้ม (สาขาที่ล้มถูกเก็บกวาดแล้ว) · **หรือ Confirm ล้ม/เขียนไปแล้วบางส่วน** |
| `2` | ไม่พบไฟล์/โฟลเดอร์ หรือ flag ไม่ถูกต้อง |
| `4` | ตกด่าน (ไฟล์ไม่ใช่วันนี้/ยังไม่นิ่ง · หัวคอลัมน์เพี้ยน · มีแถวไม่ใช่วันนี้ · มีสาขาที่ถูกข้าม · **หรือขั้น Confirm ตกด่านโดยไม่ได้เขียนอะไร**) — **ไม่เขียนสาขานั้น** |
| `9` | ไม่พบ Python (`.bat`) |

เห็น exit 4 ติดกันหลายวัน = ไปแก้ที่ Task `BOT16104` (หรือบอท auto-r01) ไม่ใช่ที่นี่ · ตรวจบน Firestore: `{branch}_r01.r16DetailVersion` = `{branch}_r16_104_meta.version` และ `r16UploadedAt` เป็นเย็นวันนี้
`LastTaskResult` ของ Task นี้คือ exit code ของสคริปต์ตรงๆ (ต่างจาก BOT16104 ที่ห่อ conhost)

## ข้อจำกัดที่ต้องรู้

- สแกนที่เกิดหลังเวลา export ของไฟล์ไม่ถูกชดเชย · ไม่คำนวณ `dateMismatch` (ด่าน "ไฟล์วันนี้" แทน — เว็บเตือนตอนอัปมือเท่านั้น และบอทไม่อ่าน items)
- อัปมือที่ Desktop หลังบอท = local timeline เฉพาะเครื่อง (เครื่องอื่นเห็น version ไม่ตรง → ไม่โหลด timeline ของบอท) เท่ากับสถานะก่อนมีบอท
- `reEvaluateAuditItems()` ไม่ถูกเรียกตอนโหลดจาก Cloud (กันทุก Desktop พลิกสถานะพร้อมกัน) — สถานะที่ Confirm ไปแล้วไม่เปลี่ยนเอง
- KKL = `SYSBRANCHID 4` ยืนยันจากไฟล์ตัวอย่างไฟล์เดียว (บอทตรวจ id+ชื่อทุกรอบ) · ความหมาย Col A ของ OTFI/OTFB ของ KKL/SSS ยังไม่มีไฟล์ยืนยัน (ใช้กติกาแอปเดิม)
- ข้อจำกัดของขั้น **Confirm โดยบอท** อยู่ในหัวข้อ [🤖 Confirm โดยบอท](#-confirm-โดยบอท) (ยังไม่เคยรันกับข้อมูลจริง · tripwire ยังไม่ปรับเทียบ · รอบเดียวต่อคืน)
