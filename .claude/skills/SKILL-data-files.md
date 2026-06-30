# SKILL: Data Files & Persistence

โหลดไฟล์นี้เมื่อแก้ไขหรือ debug งานที่เกี่ยวกับ: อัพโหลดไฟล์ R01/R05/R16, column mapping,
DEL/P items, Export Excel, Firestore persistence layers, หรือ Location master

---

## Data Flow

```
1. Upload R01.102 + R05.106 + Product Master
   → loadR01() / loadR05() / loadProductMaster()
   → rebuildMaps() → skuMap, barcodeMap, skuDirectMap
   → init scanData (pending) สำหรับทุก SKU ที่รู้จัก

2. Scan → handleBarcode() → accumulate countedQty

3. Upload R16.104 → loadR16()
   → r16SalesMap + r16RawMap (sales: ORCM/OCTM) — WH ข้าม
   → r16InboundMap + r16InboundRawMap (inbound: OTFB/ORTS/OTFI)
   → auto reEvaluateAuditItems() ถ้า matched > 0
   → R16 Date Mismatch warning ถ้าวันไม่ overlap

4. Upload R16.103 (WH only) → loadR16_103()
   → r16_103Map + r16_103RawMap (รับเข้ายังไม่ขึ้นชั้น)

5. Confirm → evaluatePendingScans()
   effectiveCnt = countedQty
               + getSoldQtyBefore(sku, timestamp)      [สาขา]
               + getR16103QtyBefore(sku, timestamp)    [WH]
               - getInboundQtyBefore(sku, timestamp)
   เทียบกับ systemQty → pass / audit
```

---

## Column Mappings (zero-indexed, skip row 0 header)

### R01.102
| Col | Index | Field |
|---|---|---|
| E | 4 | SKU |
| F | 5 | ProductName |
| G | 6 | SystemQty |

- ข้ามเฉพาะแถวที่ qty ว่าง/ไม่ใช่ตัวเลข
- **qty ≤ 0 (ติดลบ/0) เก็บไว้ด้วยค่าจริง** ไม่ clamp — เพื่อให้ DEL ที่ระบบติดลบแต่มีของจริงบนชั้นนับได้
- Re-upload: `state.r01Data = []` ก่อน → `rebuildMaps()` — scanData ของ SKU เดิมไม่ถูกรีเซ็ต
- ⚠️ WH: อย่า re-upload R01 กลางรอบ / ในวันรีเช็ค (cross-day) — baseline จะเลื่อน
- **สาขายา (SRC/KKL/SSS): re-upload R01 ทุกวันได้ตั้งใจ** (baseline หลัง restock) — ดู "R01 Daily Reset" ด้านล่าง

### R01 Daily Reset (สาขายา เท่านั้น)

Re-upload R01 บน**สาขายา** (`_isPharmacyBranch()` → SRC/KKL/SSS) trigger `resetUnverifiedAuditForNewR01()`:
- ทุก `scanData` entry ที่ `status==='audit' && !sd.auditor` → กลับเป็น `pending` (ล้าง countedQty, ลบจาก scanListMap + `_avMap`)
- ไม่แตะ `pass`/`stock_adjustment` ที่มี `auditor` (เภสัชยืนยันแล้ว = final)
- หลังรีเซ็ต → `reEvaluateAuditItems({silent:true})` ปรับ `pass` ที่ยังไม่ยืนยันตาม baseline ใหม่
- **WH ไม่มีพฤติกรรมนี้** — WH re-upload R01 ไม่รีเซ็ต audit

**Cross-device sync:** `_r01BaselineAt` (module-level, ไม่ใช่ใน state) persist ใน `r01BaselineAt` field — ทุกเครื่องเช็ค `cloud.r01BaselineAt > local._r01BaselineAt` ใน `startScanSessionListener`/`syncToFirestore`/`pullFromCloud`/`restoreFromFirestore` → ถ้าใหม่กว่า เรียก `_applyR01BaselineUpdate()` โหลด R01 จาก `${branch}_r01` master doc + รัน reset เดียวกัน

**Workflow รายวัน:**
| วัน | ขั้นตอน |
|---|---|
| Day 1 | อัพ R01 → สแกน → อัพ R16 → Confirm → ติด Audit (ถ้าไม่ตรง) |
| Day 2 | อัพ R01 ใหม่ (Audit ค้างรีเซ็ตเป็น pending) → สแกนใหม่ → อัพ R16 วันนั้น → Confirm → เภสัช Audit Verify |

⚠️ **อัพ R01 ทำให้ audit ที่รอเภสัชตรวจกลับเป็น pending ทันที** — ถ้าต้องการให้เภสัชตรวจ Audit ของเมื่อวานก่อน **อย่าอัพ R01 ใหม่จนกว่าจะ Verify เสร็จ**

### R05.106
| Col | Index | Field |
|---|---|---|
| A | 0 | Barcode |
| E | 4 | SKU |
| G | 6 | unitName |
| H | 7 | unitMultiplier |

### R16.104 — Document Types (Col C)

> ไฟล์ R16 export รวมทุกสาขา + WH ในไฟล์เดียว → Col C prefix เป็น filter หลัก

| Col C prefix | ประเภท | ผลต่อ effectiveCnt | WH |
|---|---|---|---|
| ORCM, OCTM | ยอดขาย | **บวกกลับ** → `r16SalesMap` | **ข้าม** |
| OTFB, ORTS | รับเข้าคลัง | **หักออก** → `r16InboundMap`. **SRC เท่านั้น:** OTFB ใช้ Col A เหมือน OTFI — Col A=`0`/ว่าง (คลังส่ง) → **ข้าม**; Col A=`1` (สาขาส่ง) → **บวกกลับ**. KKL/SSS: OTFB ทุกแถวเป็น inbound ตามปกติ | ใช้ |
| OTFI | ดูด้านล่าง | branch-aware | ดูด้านล่าง |

⚠️ **SRC ("อนิน สาขาแยกชากค้อ")** สาขา+คลังรวมกันใน POS แยกไม่ได้ → ต้องใช้ Col A บอกทิศของ OTFB เหมือน OTFI (`isSrcOtfb` ใน `loadR16`, ตัวแปร `R16_INBOUND_PREFIXES`/`R16_OUTBOUND_PREFIXES`) สาขาอื่น (KKL/SSS) ไม่มี carve-out นี้

**OTFI — ทิศสองทาง (สาขายา SRC/KKL/SSS):**
- Col A (index 0) = `'1'` → สาขา→คลัง (โอนออก) → **บวกกลับ** (`r16SalesMap`)
- Col A = `'0'` หรือว่าง → คลัง→สาขา (รับเข้า) → **หักออก** (`r16InboundMap`)

**OTFI (WH):** ไม่อ่าน Col A → **หักออกเสมอ** (คลังเป็นฝั่งรับโอน)

logic: `isOutbound = !isWhBranch && match(OTFI) && colA==='1'`

**Columns อื่น R16.104:**
- Col O (14) = Barcode
- Col R (17) = BASEQUANTITY (แปลงเป็นหน่วยเล็กสุดแล้ว)
- Col X (23) = SKU
- TRANDATE = auto-detect จาก header row (case-insensitive match `TRANDATE`)

**Upload date sync (cross-device):** `loadR16()` เขียน `r16UploadedAt`+`r16Loaded` ลง master doc `${branch}_r01` ผ่าน `syncR16MetaToFirestore()` (merge, ไม่ใช่ session doc) — อ่านกลับทุก login ผ่าน `_applyR16MetaFromDoc()` ใน `restoreMasterFromFirestore()` เหมือน pattern ของ R01 ดู Known Pitfalls ด้านล่าง

### R16.103 (WH only) — Document Types

| Col C prefix | ประเภท | ผลต่อ effectiveCnt |
|---|---|---|
| IRNC, IRVC, IRNM, ICSM, ITFB, ITFW, IPOS, IRCN | รับเข้ายังไม่ขึ้นชั้น | **บวกกลับ** → `r16_103Map` |

อยู่ใน systemQty แต่พนักงานไม่ได้นับ → ต้องบวกกลับ
ปุ่มแสดงเฉพาะ Desktop WH (`window.innerWidth > 600 && currentBranch === 'WH'`)

---

## R16 TRANDATE Filter

`getSoldQtyBefore(sku, scanTimestamp)`:
- `TRANDATE <= scanTimestamp` → include (ขายก่อน/ระหว่างนับ)
- `TRANDATE > scanTimestamp` → exclude
- TRANDATE ว่าง/parse ไม่ได้ → exclude (conservative)

`parseTranDate()` รองรับ:
- `DD/MM/YYYY H:mm[:ss] [AM/PM]`
- `DD-MM-YY H:mm[:ss] [AM/PM]` (เช่น `25-04-26 8:07`)
- `DD-MM-YYYY H:mm[:ss] [AM/PM]`
- `YYYY-MM-DD HH:mm:ss`

`r16RawMap` ไม่ persist (in-memory only) — หลัง refresh ใช้ `r16SalesMap` (no time filter)
Debug: `console.log('[R16] TRANDATE col index:')` ใน browser Console

---

## R16 Date Mismatch Warning

หลังโหลด R16: เปรียบเทียบ TRANDATE กับ scan dates (รวม +1 วันสำหรับ cross-night)
ถ้าไม่ overlap:
1. Toast warn 7 วินาที
2. Badge เปลี่ยน "Ready" → "⚠️ ตรวจสอบวันที่" (class `upload-file-badge-warn`)
3. `state.r16DateMismatch = true`

กด Confirm ขณะ `r16DateMismatch === true` → `r16MismatchModal` ต้อง confirm ก่อน

---

## DEL Items

SKU อยู่ใน R01 แต่ไม่อยู่ใน Product Master → `isDel: true` ใน `skuMap`
- แสดงใน popup ด้วย badge แดง **DEL** + ปุ่ม filter **🗑️ DEL**
- นับ + evaluate ปกติ
- **filter `'pending'`** ใน popup ไม่รวม DEL → ดู DEL รอนับผ่านปุ่ม **🗑️ DEL**

## P Items (หมวด P)

Product Master Col D = `P` → เก็บด้วย `cat:'P'`, flag `skuMap[sku].isP = true`
- แสดง badge **P สีม่วง** (`.tag-p`) ในป็อปอัพ + ปุ่ม filter **🏷️ P**
- โผล่ใน filter "รอนับ" ด้วย (ต่างจาก DEL ที่ถูก exclude)
- ต้องอัพ PM ใหม่ 1 ครั้งหลัง deploy เพื่อให้ของเก่าใน cloud มี `cat`

Col D filter: `REVIEW` → ข้าม; `A` → `cat:'A'`; `P` → `cat:'P'`; อื่น → ไม่มี field `cat`

---

## Export Excel (3 ปุ่ม)

### 1. exportExcel() — popup toolbar
เนื้อหา: **ตรงกับปุ่ม filter ที่เลือกอยู่ในป็อปอัพเสมอ** (ใช้ `getFilteredPopupRows()` ตัวเดียวกับที่ตารางแสดงผล — รวม status filter + staff filter + คำค้นหา) ไม่ใช่ audit/stock_adj ตายตัวแบบเดิม
คอลัมน์: SKU, Barcode, ProductName, SystemQty, CountedQty, Status, Timestamp, Audit Status
ไฟล์: `audit_${date}.xlsx` เมื่อ filter เป็น Audit, อื่นๆ เป็น `stock_<filter>_${date}.xlsx` (เช่น `stock_p_${date}.xlsx`, `stock_del_${date}.xlsx`)

### 2. exportStockAdjExcel() — History Stats tab 🔴 Stock Adj
Layout เดียวกันทั้งสาขา/WH (10 คอลัมน์):
A=Location / B=SKU / C=Barcode / D=ProductName / E=หน่วย /
F=จำนวนคงเหลือ / G=จำนวนปรับปรุง / H=Diff (sysQty−recheckQty; บวก=ขาด) /
I=พนักงานที่สแกน / J=เวลาที่นับ
ไฟล์: `stockadj_${branch}_${date}.xlsx`

### 3. exportHsCountExcel() — History Stats tab 👥 / 🧑‍⚕️
คอลัมน์: Location, SKU, Barcode, NAME, Unit, CountQty, SystemQty, Diff, ชื่อพนักงาน, เวลา

ชื่อพนักงาน:
- นับครั้งแรก: `scannedBy` (header WH "ชื่อผู้สแกน" / สาขา "ชื่อผู้ช่วย")
- รีเช็ค WH: **`recheckBy`** (ไม่ใช่ `auditor` ซึ่งเป็นหัวหน้าที่กดยืนยัน)
- รีเช็ค สาขา: `auditor` (เภสัชสแกนและยืนยันเอง)

ไฟล์: `count_` / `recheck_${branch}_${date}.xlsx`

### exportCountReportExcel() — History Stats tab 📋 (WH supervisor)

12 คอลัมน์ สร้างจาก `_buildCountReportRows()`:
A=วันที่สแกน (`firstScanAt` || `timestamp`) / B=Location / C=SKU / D=Barcode / E=Name /
F=SystemQty / G=หน่วย / H=Count / I=DIFF (countedQty−systemQty; บวก=เกิน) /
J=Recheck / K=DIFF Recheck / L=Check By

ไฟล์: `count_report_${branch}_${date}.xlsx`

---

## Persistence Layers

| Layer | Key/Path | เมื่อไหร่เขียน |
|---|---|---|
| localStorage | `stockCountSession_${branch}` | ทุก `saveSession()` debounce 400ms |
| Firestore `stock_sessions/${branch}` | scan data | 3s หลัง localStorage |
| Firestore `stock_sessions/${branch}_r01/r05` | R01/R05 master + R16 upload metadata | หลัง upload (R01/R05); R16: `r16UploadedAt`/`r16Loaded` merge เข้า `_r01` doc ทุกครั้ง `loadR16()` |
| Firestore `stock_sessions/global_pm` | Product Master | หลัง PM upload; real-time listener |
| Firestore `stock_sessions/WH_location` | Location + zone-staff | หลัง Save ใน Location popup |
| Firestore `stock_audit_log/${branch}_${date}` | Audit log | หลัง evaluatePendingScans + verify + recheck confirm |

**Persisted scan fields:** `scannedBy`, `auditor`, `recheckQty`, `recheckBy`, `initialStatus`, `firstScanAt`
Strip เฉพาะ: `retries`, `scans`

⚠️ **ไม่มี history snapshot** — Export Excel ก่อนกด "เริ่มนับใหม่"
⚠️ `startNewCount()` ต้องลบ `${branch}_r01` master doc ด้วย (ไม่ลบ `_r05`) — ลบทั้ง doc จึงล้าง `r16UploadedAt`/`r16Loaded` ไปด้วยโดยอัตโนมัติ (ถูกต้อง — นับใหม่ควรเคลียร์วันที่ R16 เก่าด้วย)
⚠️ ลำดับ: `syncToFirestore(true)` → `rebuildMaps()` (scanData ว่างก่อน)

---

## Known Pitfalls

**R16 upload date ไม่ตรงกันข้ามเครื่อง (มิ.ย. 2026, แก้แล้ว):**
- **อาการ:** เครื่อง A อัพ R16 วันนี้ badge ขึ้นวันที่ใหม่ แต่เครื่อง B สาขาเดียวกันยังเห็นวันที่เก่าเป็นเดือน
- **สาเหตุ:** `r16UploadedAt` เดิมเก็บใน session doc (`stock_sessions/${branch}`) ใบเดียวกับ scanData — ทุกเครื่องที่สแกนแล้ว trigger `syncToFirestore()` (ทุก ~3s) ดันค่า `r16UploadedAt` ของตัวเอง (อาจเก่าค้าง) ทับ cloud แบบ last-write-wins ไม่เทียบว่าใหม่กว่าใคร + `restoreFromFirestore()` รีเฟรช badge จาก cloud แค่ครั้งเดียวตอน `r16Loaded` เปลี่ยน false→true เครื่องที่เคยโหลด R16 แล้วจะไม่เช็ค cloud ซ้ำอีกเลย
- **แก้:** ย้าย `r16UploadedAt`/`r16Loaded` ไปเก็บใน master doc เดียวกับ R01 (`${branch}_r01`) เขียนผ่าน `syncR16MetaToFirestore()` (เรียกจาก `loadR16()` เท่านั้น ไม่ถูก sync รอบสแกนแตะ) + อ่านกลับทุก login ผ่าน `_applyR16MetaFromDoc()` ใน `restoreMasterFromFirestore()` — pattern เดียวกับที่ R01 ใช้อยู่แล้ว
- **ผลข้างเคียงที่ต้องรู้:** `syncMasterToFirestore()` เปลี่ยนเป็น `.set(...,{merge:true})` ไม่งั้น R01 re-upload จะลบ field r16 ที่เพิ่งเขียนทิ้งไปด้วย
- **Transitional:** สาขาที่ยังไม่มีใครอัพ R16 ใหม่หลัง deploy fix นี้ — `_r01` doc จะยังไม่มี field `r16UploadedAt` → `_applyR16MetaFromDoc` guard (`r16UploadedAt===undefined`) ข้ามไปเฉยๆ ไม่เด้ง badge ผิด จะ sync ถูกต้องทันทีที่มีคนอัพ R16 ครั้งต่อไปของสาขานั้น

---

## CSV/Excel Parsing

`parseFile()` รองรับ `.csv` และ `.xlsx`/`.xls`
CSV encoding auto-detect: UTF-8 BOM → UTF-8 → Windows-874 (Thai Excel default)

---

## Location Master (WH only)

Firestore: `stock_sessions/WH_location` — `{locationData:{SKU:loc}, zoneStaff:{zone:staff}, updatedAt}`

**CSV Import format:**
| Col | Index | เนื้อหา |
|---|---|---|
| A | 0 | SKU หรือ Barcode |
| E | 4 | **Location** |

Header auto-detect (ข้ามแถวที่ col A = `sku`, `barcode`, `รหัสสินค้า`, `location`)
SKU lookup: `productMasterMap` → `barcodeMap` → `skuMap`

Zone: A–O (15 โซน), Staff: มุก/ตั๋ง/แล็ค
`_LOCATION_ZONES = ['A'...'O']`

---

## Firebase Config

Project: `stock-count-1d6e7`
`FIREBASE_CONFIG` hardcoded ใน `index.html`
ใช้แค่ Firestore (ไม่มี Auth, Storage, Functions)
