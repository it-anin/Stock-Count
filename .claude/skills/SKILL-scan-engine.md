# SKILL: Scan Engine

โหลดไฟล์นี้เมื่อแก้ไขหรือ debug งานที่เกี่ยวกับ: การสแกน barcode, PDA detection, cloud sync,
role filter ใน scan list, Firestore listener, หรือ WH recheck workflow

---

## PDA vs Manual Detection

`handleScanInput()` ตรวจ inter-keystroke timing (`PDA_KEYSTROKE_THRESHOLD_MS = 150ms`):

- **PDA mode** — keystroke ติดกันภายใน 150ms → `_pdaMode = true` → auto-submit หลัง debounce 80ms (`SCAN_DEBOUNCE_MS`)
- **Manual mode** — keystroke ห่างกัน ≥150ms → `_pdaMode = false` → ไม่ auto-submit แต่มี fallback debounce 350ms ถ้า `value.trim().length >= 6`
- Detection เกิดจาก keystroke ที่ 2 (keystroke แรกไม่มี prev timestamp เทียบ)
- `_pdaMode` reset เป็น false หลังสแกนสำเร็จ

```js
const PDA_KEYSTROKE_THRESHOLD_MS = 150;
const SCAN_DEBOUNCE_MS = 80;
// fallback ใน handleScanInput:
} else if (e.target.value.trim().length >= 6) {
  _scanDebounceTimer = setTimeout(() => { processScan(); }, 350);
}
```

**Enter key:** `handleScanKey()` รับ `e.key==='Enter'`, `e.keyCode===13`, `e.which===13` (ครอบ PDA เก่า)
**Manual submit ⏎:** `submitScanManual()` → clear debounce/PDA state → `processScan()`

State: `_lastKeystrokeTime`, `_pdaMode` reset ใน `resetScanRuntimeState()`, `handleScanKey()` (Enter), debounce callback, `\r\n` path, `removeScanItem()`

### CSS ซ่อนตัวอักษรระหว่างรับ barcode

```css
.scan-input.pda-receiving { color: transparent; caret-color: transparent; }
```

ใส่ class เมื่อ PDA mode, เอาออกใน `processScan()` / `resetScanRuntimeState()`

---

## Scan Input Formats

```
barcode                 → qty = 1
barcode,qty
location,barcode,qty
SKU                     → resolve smallest-unit barcode
SKU,qty
location,SKU,qty
```

---

## handleBarcode() — Core Scan Logic

1. lookup `barcodeMap` → ถ้าไม่พบ → lookup `skuDirectMap`
2. ถ้า item confirmed (`pass`, `audit`, `stock_adjustment`) → block scan, toast "สแกนและ Confirm ไปแล้ว"
3. accumulate `countedQty`, set `status='scanning'`, `scannedBy=currentUser`, `firstScanAt` (ครั้งแรกเท่านั้น)

**WH recheck branch (warehouse role สแกน SKU ที่ `status==='audit'`):**
- สะสม `sd.recheckQty`, `sd.recheckBy = currentUser`
- status คง `audit` ไม่เปลี่ยน
- ไม่ผ่าน scan gap check (WH ข้าม gap ทั้งหมด)

**2-minute scan gap (สาขายา SRC/KKL/SSS เท่านั้น):**
- SKU เดิมสแกนซ้ำหลัง 2 นาที → `showScanGapModal()` + `beepWarn()` + vibrate
- กด confirm → `confirmScanGap()` reset `countedQty=0`, `sd.scans=[]`, barcode ที่ trigger ไม่นับ

---

## drainQueue & Render Decision

⚠️ **อย่าใช้ `size>prevSize || _pendingPatches.size>0`** — จะ full render ทุกสแกน

```js
// หลัง drain:
if (scanListMap.size > prevSize) {
  renderScanList(); // SKU ใหม่ = full render
} else if (_pendingPatches.size) {
  // patch ทีละ key, ถ้า patchScanRow คืน false → fallback renderScanList()
}
```

`patchScanRow(key)` — in-place DOM update เซลล์ QTY + ย้ายแถวขึ้นบนสุด
คืน `true` = patch สำเร็จ, `false` = ไม่เจอ row/cell → caller ต้อง fallback full render

---

## Scan List Filter by Role (rebuildScanListMap)

| Role | แสดง |
|---|---|
| assistant | เฉพาะ `scannedBy === currentUser` |
| warehouse | ของตัวเอง (scanning) + ทุกคน (audit → worklist รีเช็ค). PDA: แยก 2 tab "เริ่มนับ" / "รีเช็ค" |
| pharmacist | เฉพาะ `status === 'audit'` |
| supervisor | ทุกการสแกนของทุกคน; Desktop WH มี status filter row |
| ไม่ได้ login | ทั้งหมด |

**WH PDA 2 tab:** `_whResultTab === 'result'` (scanning) / `_whResultTab === 'recheck'` (audit)
`setWhResultTab(tab)` สลับ + rebuild; `updateWhResultTabs()` อัปเดต active + จำนวน

**Scan list QTY — audit exception:**
- pharmacist / warehouse / supervisor → แสดง `entry.totalQty` (bold) เสมอ ไม่ใช้ threshold >100
- เภสัช: `totalQty` = จาก `_avMap`; warehouse/supervisor: `totalQty` = `sd.recheckQty`

---

## Scan List QTY Masking

| Status | เงื่อนไข | แสดง |
|---|---|---|
| scanning | systemQty > 100 | inline `<input>` → `updateInlineQty` |
| scanning | systemQty ≤ 100 | `countedQty` (bold) |
| unknown | — | `countedQty` (bold) เสมอ |
| audit | pharmacist/supervisor | `totalQty` (bold, read-only) |
| pass/audit/etc | countedQty > 100 | แสดง (re-check warning) |
| pass/audit/etc | countedQty ≤ 100 | ซ่อน (กันเกิด counter bias) |

**WH warehouse override:**
- WH PDA (`noEditPda`): scanning ที่ systemQty > 100 → ได้ inline input; ≤100 + audit → `<span>` scan only
- WH Desktop: scanning → ได้ input เสมอ; audit (recheck) → `updateRecheckInlineQty()` เขียน `recheckQty`+`recheckBy`

เงื่อนไข: `sysQty > 100 || (whStaffEdit && !noEditPda)`
ทั้ง `renderScanList()` และ `patchScanRow()` ต้องเช็คเหมือนกัน

---

## WH Recheck Workflow

**warehouse PDA:**
- สแกนนับปกติ (scanning) → confirm โดย supervisor Desktop
- สแกนรีเช็ค audit → สะสม `recheckQty`, `recheckBy`, status คง `audit`
- ปุ่ม ✕ บนแถว audit → `resetRecheckItem(sku)` ลบ recheckQty/recheckBy, ยกเลิก debounce/queue, นับจาก 0 ใหม่

**supervisor Desktop:**
- **ยืนยันนับทีละคน:** `renderSupervisorCountButtons()` → ปุ่มน้ำเงิน per staff → `confirmCountByStaff(name)` → `evaluatePendingScans(name)`
- **ยืนยันรีเช็คทีละคน:** `renderSupervisorRecheckButtons()` → ปุ่มเขียว per staff → `confirmRecheckByStaff(name)`
- **ยืนยันรีเช็คทั้งหมด:** `confirmAllRecheckSupervisor()` → วน audit ที่มี `recheckQty && !auditor` → pass/stock_adjustment + `auditor=มายด์`

`canVerify = currentRole === 'pharmacist' || currentRole === 'supervisor'`
(warehouse ไม่มีสิทธิ์ verify — ใช้ช่อง scan หลักแทน)

---

## Cloud Sync — _applyCloudScanData()

Shared function ใช้โดย `pullFromCloud()` และ `startScanSessionListener()`

**Merge rules:**
1. **Epoch guard (ก่อนทุก rule):** `s.countResetAt > _countResetAt` → adopt epoch + `_resetLocalScanDataToPending()` (reset ทุก item รวม scanning + confirmed)
2. ดึงเฉพาะ cloud `pending`/`scanning` — confirmed ข้าม **ยกเว้น propagate path**
3. **Propagate confirmed (`_propagateConfirmed=true`):**
   - local มี `auditor` → เก็บ local
   - local confirmed + cloud ไม่มี auditor → mirror `recheckQty`/`recheckBy` เท่านั้น
   - cloud มี `auditor` หรือ local ยังไม่ confirm → ทับ local
4. local item confirmed → ไม่ overwrite (นอก propagate path)
5. `unknownScans` merge เพิ่มเฉพาะ barcode ที่ยังไม่มี
6. หลัง merge → `invalidatePopupRowsCache()` **ก่อน** `renderTable()` เสมอ

**WH recheckQty mirror guard (`currentRole !== 'warehouse'`):**
รัน mirror เฉพาะ supervisor Desktop ไม่รัน warehouse PDA (กัน snapshot เก่าทับค่าที่เพิ่งสแกน)

---

## Cloud Sync — syncToFirestore(overwrite=false)

เรียกอัตโนมัติ 3 วินาทีหลัง `saveSession()`

**Merge rules (overwrite=false):**
1. **Epoch guard:** cloud `countResetAt > local` → adopt + reset + return ทันที (ไม่เขียนทับ)
2. ดึง cloud state มา merge ก่อน แล้ว overwrite ด้วย local
3. local `pending` ไม่ overwrite cloud item ที่มี status อื่น
4. local `scanning`/`pending` ที่ไม่มีใน cloud → ไม่ re-upload
5. local `pass`/`audit`/`stock_adjustment` ที่ไม่มีใน cloud → ไม่ re-upload
6. cloud มี `auditor` แต่ local ยังไม่มี → ไม่ overwrite cloud (guard WH recheck race)

---

## Cloud Sync — startScanSessionListener() (onSnapshot)

เริ่มหลัง login (`initAfterLogin`) — ฟัง `stock_sessions/${branch}`
- เมื่อ snapshot fires → debounce 3s → `_applyCloudScanData()` → `rebuildScanListMap(true)` → render
- ไม่เรียก `saveSession()` ใน handler (กัน sync loop)
- ไม่ทำงานใน admin mode

---

## startNewCount() — ลำดับสำคัญ

**ต้องเรียก `syncToFirestore(true)` ก่อน `rebuildMaps()`** — ขณะที่ scanData ยังว่าง
ถ้าสลับ: `rebuildMaps()` จะ broadcast `pending` ทั้ง catalog ขึ้น cloud ก่อน → ด่านกัน resurrection เสีย

ต้องลบ master doc `${branch}_r01` ด้วย (ไม่ลบ `_r05`):
```js
await db.doc(getSessionId()+'_r01').delete(); // หลัง syncToFirestore(true)
```

---

## Known Pitfalls

**Cascade bug June 2026 (commit 58d9d2f→90f4bb8→6fefac9):**
1. แก้ `_applyCloudScanData` → scanning หายจาก RESULT 1-2 วิ
2. แก้ `syncToFirestore` → cloud มีแค่ scanning ไม่มี pending
3. listener delete loop → `state.scanData.get(sku)` undefined → สแกน "ไม่ติด" silent

**drainQueue render bug (มิ.ย. 2026):**
`size>prevSize || _pendingPatches.size>0` → full render ทุกสแกน → กระพริบ โดยเฉพาะ WH inline input
Fix: patch-first logic (ดู drainQueue section)

**เครื่องอื่นไม่เห็น PASS/AUDIT หลัง F5:**
1. Admin Mode ค้าง → `syncToFirestore` return ทุก call
2. `restoreFromFirestore()` early return (แก้ถาวรแล้ว commit 3baa421)
3. มีใครกด "เริ่มนับใหม่" บนเครื่องนั้น

`pullFromCloud()` / `_applyCloudScanData()` ไม่ช่วยกรณีนี้ — merge เฉพาะ `pending`/`scanning` เท่านั้น
