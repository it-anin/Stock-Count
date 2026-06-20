# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## ⚠️ กฎสำคัญ — ห้ามแก้โค้ดสแกนโดยไม่แจ้งก่อน

**ก่อนแก้ฟังก์ชัน / logic ที่เกี่ยวกับการสแกนทุกครั้ง ต้องแจ้ง user และรอ approve ก่อน**

ฟังก์ชัน / logic ที่ถือว่าเป็น "scan-related":
- `handleScanInput`, `handleScanKey`, `processScan`, `processPharmacistAuditScan`, `submitScanManual`
- `handleBarcode`, `parseScanLine`, `drainQueue`, `scanQueue`
- `evaluatePendingScans`, `validateAndProcess`
- `appendScanRow`, `removeScanItem`, `resetRecheckItem`, `clearScanList`, `rebuildScanListMap`, `renderScanList`, `patchScanRow`
- `_applyCloudScanData`, `syncToFirestore` (scan data), `pullFromCloud`, `startScanSessionListener`, `restoreFromFirestore` (scan parts)
- `confirmScanGap`, `showScanGapModal`, `_scanGapHold`
- `handleAuditVerifyScan`, `confirmAuditVerifyItem`, `confirmAllAuditVerify`, `confirmRecheckBtn`, `confirmAllRecheckSupervisor` (WH recheck confirm)
- PDA keystroke detection: `PDA_KEYSTROKE_THRESHOLD_MS`, `SCAN_DEBOUNCE_MS`, `_pdaMode`, `_lastKeystrokeTime`
- Time gates สำหรับ scan
- Role check ใน scan list filter (`rebuildScanListMap` filterUser/filterAudit)

**เหตุผล:** การสแกนเป็น critical path — มี state, debounce, sync, listener หลายชั้นที่ interact กัน การแก้ผิดทำให้ "สแกนไม่ติด" หรือข้อมูลหาย ซึ่งกระทบ workflow จริงของพนักงานทันที และ debug ยาก (ต้องใช้ Console บน Desktop + PDA — PDA ไม่มี console native)

**ที่เคยเกิด cascade bug** (commit 58d9d2f → 90f4bb8 → 6fefac9 — June 2026):
1. แก้ `_applyCloudScanData` ป้องกัน scanning ถูก clobber → scanning items หายจาก RESULT 1-2 วิ
2. แก้ `syncToFirestore` ให้ upload scanning เมื่อ cloud empty → cloud มีแค่ scanning, ไม่มี pending
3. ผลพวง: listener delete loop wipe local pending → `state.scanData.get(sku)` undefined → สแกน "ไม่ติด" silent

**How to apply:** ก่อนแก้ฟังก์ชัน scan-related ใดก็ตาม → อธิบาย change + impact ให้ user → รอ approval → ทำ และเตือนให้ทดสอบทั้ง PDA + Desktop

---

## Running the App

No build step. Open `index.html` directly in a browser, or serve via any static HTTP server:

```bash
npx serve .
# or
python -m http.server 8080
```

The app is a PWA installable via the browser. The Service Worker (`sw.js`) caches static assets with cache-first strategy and uses network-first for HTML.

## Architecture

The entire application is a **single `index.html` file** containing all HTML structure, CSS (with CSS variables for theming), and JavaScript (~2400+ lines). There is no build system, no framework, and no module bundler.

**External dependencies** (loaded via CDN/local):
- `libs/papaparse.min.js` — CSV parsing
- `libs/xlsx.full.min.js` — Excel read/write
- Firebase Firestore v10.12.0 (compat CDN) — cloud sync

### Central State Object

All application data lives in a single `state` object:

```js
state = {
  productMasterData, productMasterMap,                         // Product catalog (all branches)
  r01Data,                                                     // Inventory quantities from R01.102
  r05Data,                                                     // Barcode mapping from R05.106
  r16Data, r16SalesMap, r16RawMap,                             // Sales-during-count (ORCM/OCTM) from R16.104
  r16InboundMap, r16InboundRawMap,                             // Inbound-during-count (OTFB/ORTS/OTFI) from R16.104
  r16DateMismatch,                                             // true when R16 TRANDATE dates don't overlap scan dates
  r16_103Map, r16_103RawMap,                                   // WH only: รับเข้าที่ยังไม่ขึ้นชั้น (IRNC/IRVC/IRNM/ICSM/ITFB/ITFW/IPOS/IRCN) from R16.103
  r16_103Loaded, r16_103UploadedAt,                            // WH R16.103 badge state
  skuMap,      // SKU → { productName, systemQty, barcodes[], isDel }
  barcodeMap,  // barcode → SKU
  skuDirectMap,// SKU → { barcode, unitName } (smallest-unit barcode)
  scanData,    // Map<SKU, { countedQty, status, timestamp, scannedBy, auditor, recheckQty, initialStatus, ... }>
  unknownScans,// items scanned but not in system
  locationMap, // Map<SKU, string> — WH only: location string e.g. "A1-01" (loaded from Firestore WH_location)
  zoneStaffMap // Map<zone, staff> — WH only: zone letter → staff name e.g. "A" → "มุก"
}
```

`_countResetAt` (module-level `let`, ไม่ใช่ใน state object) — ISO timestamp ที่ตั้งทุกครั้งที่ `startNewCount()` ถูกเรียก เป็น **reset epoch** ที่ "เดินหน้าทางเดียว (monotonic)" persisted ใน localStorage + Firestore ทุกจุดที่ reconcile กับ cloud (`_applyCloudScanData`, `syncToFirestore`, `restoreFromFirestore`) เทียบด้วย `cloud.countResetAt > local._countResetAt` (string ISO เทียบ lexicographic) — ถ้า cloud ใหม่กว่า = มีเครื่องกด startNewCount → adopt epoch + reset **scanData ทั้งหมดเป็น pending** ผ่าน helper `_resetLocalScanDataToPending()` (รวม scanning ค้าง + confirmed, คง location). ใช้ `>` ไม่ใช่ `!==` เพื่อกัน snapshot เก่า (epoch ต่ำกว่า) ทำให้ reset ผิด / revert epoch

`scanListMap` is a separate `Map` used only for rendering the live scan list UI (last 30 entries, `SCAN_LIST_MAX`). It is rebuilt from `state.scanData` via `rebuildScanListMap()`.

**Scan list filter by role:** `rebuildScanListMap(force=false)` applies role-based filtering:
- **assistant** — แสดงเฉพาะแถวที่ `sd.scannedBy === currentUser`
- **warehouse** — แสดงของตัวเอง (`sd.scannedBy === currentUser`) **แต่** audit items แสดงของ**ทุกคน** (worklist รีเช็ค, ข้าม filter `scannedBy`); แถว audit โชว์ `sd.recheckQty`
- **pharmacist** — แสดงเฉพาะ `sd.status === 'audit'` (รายการที่รอเภสัชตรวจ)
- **supervisor** — แสดงทุกการสแกนของพนักงานทั้งหมด (ไม่ filter); แถว audit โชว์ `sd.recheckQty`
- **ไม่ได้ login** — แสดงทั้งหมด

Stats cards (Scanned/Audit totals) always count all employees regardless of filter. The 📋 popup table (`renderTable`) is unfiltered for all roles and is **read-only** — pharmacist verification must be done exclusively through the Audit Verify panel.

**Pharmacist PDA workflow:** เภสัช login บน PDA → scan list แสดงเฉพาะ Audit items ทันที (ไม่มี popup) → สแกน barcode ผ่านช่อง scanInput → `processPharmacistAuditScan()` สะสมใน `_avMap` → ช่อง QTY ในแถวอัปเดตเป็นจำนวนที่สะสม (bold, ไม่มี toast) → กด "✓ ยืนยัน Audit" เพื่อ confirm ทั้งหมด. Popup "รายการสต็อกสินค้า" เมื่อเภสัชเปิด จะ default filter เป็น `audit` อัตโนมัติ

**Scan list QTY — audit exception (pharmacist / warehouse / supervisor):** สำหรับแถวที่ `status === 'audit'` และ `currentRole` เป็น `pharmacist` / `warehouse` / `supervisor` จะแสดง `entry.totalQty` เสมอ (bold) โดยไม่ใช้ threshold `> 100`. `entry.totalQty` คือ: เภสัช = จำนวนสะสมจาก `_avMap`; warehouse/supervisor = `sd.recheckQty` (จำนวนที่ warehouse สแกนรีเช็ค, set ใน `rebuildScanListMap` + recheck branch ของ `handleBarcode`). ทั้ง `renderScanList()` และ `patchScanRow()` ต้องตรวจสอบเงื่อนไขนี้

### Data Flow

1. **Upload files** → `loadR01()` / `loadR05()` / `loadProductMaster()` → `rebuildMaps()` builds `skuMap`, `barcodeMap`, `skuDirectMap` and initialises `scanData` with `pending` entries for every known SKU.

2. **Scan** → `handleBarcode()` → looks up in `barcodeMap` first, then `skuDirectMap` (for SKU direct scan) → accumulates `countedQty` in `state.scanData`; status set to `scanning`. Sets `sd.scannedBy = currentUser`. If item is already confirmed (`pass`, `audit`, `stock_adjustment`), scanning is blocked — `countedQty` and status remain unchanged, and a warn toast "สแกนและ Confirm ไปแล้ว โปรดสแกน SKU ถัดไป" is shown.

3. **Upload R16.104** → `loadR16()` → builds `r16SalesMap` + `r16RawMap` (sales: ORCM/OCTM) and `r16InboundMap` + `r16InboundRawMap` (inbound: OTFB/ORTS/OTFI) for time-filtered adjustment. After loading, automatically calls `reEvaluateAuditItems()` if matched > 0, and shows a date-mismatch warning if R16 TRANDATE dates don't overlap with scan dates.
   - ⚠️ **WH branch ข้ามยอดขาย (ORCM/OCTM)** — `loadR16()` ตั้ง `isWhBranch=currentBranch==='WH'` แล้ว `isSale=!isWhBranch && _matchR16Prefix(...)` → WH ไม่เก็บ sales เข้า `r16SalesMap`/`r16RawMap` เลย (ยอดขายเป็นรายการของสาขา ไม่เกี่ยวกับคลัง) WH ใช้เฉพาะ inbound (OTFB/ORTS/OTFI) + R16.103. สาขายา (SRC/KKL/SSS) ยังนับยอดขายตามเดิม

4. **Upload R16.103** (WH only) → `loadR16_103()` → builds `r16_103Map` + `r16_103RawMap` (รับเข้าที่ยังไม่ขึ้นชั้น: IRNC/IRVC/IRNM/ICSM/ITFB/ITFW/IPOS/IRCN) สำหรับ WH branch เท่านั้น ปุ่มแสดงเฉพาะ Desktop WH (`window.innerWidth > 600 && currentBranch === 'WH'`)

5. **Confirm** → `evaluatePendingScans()` → for each `scanning` item: `effectiveCnt = countedQty + getSoldQtyBefore(sku, timestamp) + getR16103QtyBefore(sku, timestamp) - getInboundQtyBefore(sku, timestamp)`, compare with `systemQty` → set `pass` or `audit`. Sets `sd.initialStatus` on first evaluation (never overwritten).

   **WH formula:** r16103Qty = สินค้าที่รับเข้าคลังแต่ยังไม่ขึ้นชั้น → อยู่ใน systemQty แต่พนักงานไม่ได้นับ → ต้องบวกกลับเข้า effectiveCnt

6. **Audit resolution** → pharmacist opens Audit Verify panel → scans in dedicated input → clicks **ยืนยันทั้งหมด** → status changes to `pass` or `stock_adjustment`.

### Status Lifecycle

```
pending → scanning → pass
                   → audit → (pharmacist verify pass)  → pass
                           → (pharmacist verify fail)  → stock_adjustment
```
`unknown` is a parallel track for barcodes not found in any reference file.

`audit_check` still exists in the codebase for compatibility but is no longer produced by the re-audit flow.

**WH terminology — "Audit" → "Recheck" (label เท่านั้น):** บน WH branch คำว่า "Audit" ที่ผู้ใช้เห็นถูกเปลี่ยนเป็น **"Recheck"** ทุกที่ (status pill ใน scan list, การ์ดสถิติ, popup pill/filter/header, Audit Verify panel/popup, dashboard, history, export) — สาขายา (SRC/KKL/SSS) ยังเป็น "Audit" ตามเดิม.
- **`_auditTerm()`** → คืน `'Recheck'` ถ้า `currentBranch==='WH'` ไม่งั้น `'Audit'` — ใช้ในทุก render function (getScanRowStyle, getStatusPill, dashboard, history, export, renderAuditVerifyTable ฯลฯ)
- **`applyAuditTerminology()`** → อัปเดต label ที่เป็น static HTML (มี id: `statAuditLabel`, `auditVerifyPanelTitle`, `auditVerifyBtnLabel`, `popupFilterAuditLabel`, `popupThAudit`, `avTabAuditLabel`) ตาม branch — เรียกใน `initAfterLogin()` + ตอนเลือกพนักงาน. การ์ด AUDIT label ยัง refresh ทุก `updateStats()` ด้วย
- ⚠️ **status code `'audit'` ไม่เปลี่ยน** — เปลี่ยนเฉพาะข้อความที่แสดง. ชื่อฟังก์ชัน/id (`openAuditVerifyPopup`, `pharmacistAuditBar` ฯลฯ) คงเดิม
- **ที่ตั้งใจไม่เปลี่ยน:** help paragraphs ที่อธิบาย flow เภสัชโดยเฉพาะ (อธิบายการทำงานร้านยา), `audit_check` (legacy), tooltip `title` attr ของปุ่ม PDA verify

**Stat card — Audit:**
- Large number: items still at `audit` (waiting for pharmacist).
- Progress bar: pharmacist-checked items / total audit items ever flagged.
- `auditGot` counts: `audit_check` + `stock_adjustment` + items where `sd.auditor && sd.status === 'pass'`
- `auditTotal` counts: all items that ever had `initialStatus === 'audit'` plus `audit_check`/`stock_adjustment`

**WH branch — stat cards (Desktop vs PDA):**

| Card | Desktop WH | PDA WH (≤600px) |
|---|---|---|
| Total SKU | ซ่อน (JS) | ซ่อน (JS) |
| SKU BRANCH | ซ่อน (JS) | ซ่อน (CSS nth-child(2)) |
| Counted → **Audit ทั้งหมด** | แสดง `auditTotal` | ซ่อน (JS — PDA ไม่ต้องการ) |
| Pass | แสดง | แสดง |
| Audit | แสดง | แสดง (2×2 grid กับ Pass) |
| Not in System | แสดง | ซ่อน (CSS nth-child(6)) |
| Progress | แสดง | ซ่อน (CSS nth-child(7)) |

Logic อยู่ใน `updateStats()` ท้ายฟังก์ชัน — ตรวจ `currentBranch === 'WH'` และ `window.innerWidth <= 600`

### Auto-Update (Service Worker)

When a new version is deployed, the Service Worker (`sw.js`) installs immediately via `skipWaiting()`. On `controllerchange`:
1. Current `currentUser` + `currentRole` are saved to `sessionStorage` (`_autoUpdateUser`, `_autoUpdateRole`, `_autoUpdate` flag).
2. A brief blue banner "🔄 กำลังอัพเดทเวอร์ชันใหม่..." appears for 1.5 s then `window.location.reload()`.
3. On `DOMContentLoaded` after reload: if `_autoUpdate` flag is set **and** `currentBranch` + user are known, skip branch selector / PIN modal / employee selector entirely and call `initAfterLogin()` directly.
4. If flag is set but user was not logged in (e.g. update fired during branch selection), falls back to normal `showBranchSelector()` flow.

### Branch / Auth System

Four branches: **SRC**, **KKL**, **SSS** (ร้านขายยา), **WH** (คลังกลาง). Each has its own localStorage key (`stockCountSession_${branch}`) and separate Firestore namespace. **WH** uses a different product master / R01 / R05 / R16 set — files are uploaded independently from the pharmacy branches.

- Branch PINs are hardcoded in `BRANCH_PINS` object.
- Admin PIN `22190` / `CLEAR_PIN` enables admin mode: bypasses time gates for R01.102 and R16.104, shows hidden upload panels (Product Master, R05), **disables Firestore sync** (local only), and shows the **🗑️ ล้างข้อมูลทั้งหมด** button.

> ⚠️ **Admin Mode + Firestore:** ทุกอย่างที่ทำใน Admin Mode (อัพ R16, Confirm, Audit) จะ**ไม่ถูก sync ขึ้น Firestore เลย** — ข้อมูลอยู่ใน localStorage เครื่องนั้นเท่านั้น เครื่องอื่นจะไม่เห็น ออก Admin Mode ด้วยการคลิกปุ่มอีกครั้ง → ระบบจะ `syncToFirestore(true)` อัตโนมัติทันที

### Time Gates

| Feature | Allowed window | Admin bypass | WH bypass |
|---|---|---|---|
| R01.102 upload | After 21:00 | ✓ | ✓ |
| R16.104 upload | 08:00 – 21:29 | ✓ | ✓ |
| R16.103 upload | ไม่มี gate | — | WH only |
| Scan (all roles) | 08:00 – 20:59 | ✗ | ✗ |

- R01.102 gate: `getHours() < 21` → blocked. **WH branch bypasses this** (`currentBranch !== 'WH'` check) — คลังกลางควบคุมสินค้าเข้าออกได้ตลอดเวลา
- R16.104 gate: `getHours() < 8 \|\| getHours() > 21 \|\| (getHours() === 21 && getMinutes() >= 30)` → blocked. **WH branch bypasses this** — warehouse needs to confirm stock at any time.
- Scan gate: checked in `processScan()` — `getHours() < 8 \|\| getHours() >= 21` → blocked, clears input and shows toast.
- **🗑️ ล้างข้อมูลทั้งหมด** is only accessible in Admin mode (button hidden otherwise, function guarded by `_adminMode` check).

**R16 upload success toast:** Shows "กดปุ่ม Confirm เพื่อตรวจสอบสินค้า" (success) instead of dumping technical stats. Match count / sales / inbound / errors are now `console.log` only. The warn toast (matched === 0) keeps the diagnostic info so users know why upload failed.

### Employee Profile System

After branch PIN is verified, an employee selector modal appears. Four roles:

| Role | Branches / Names |
|---|---|
| **เภสัช** (pharmacist) | SRC: เภอ๊อฟ / KKL: เภออด / SSS: เภเบส |
| **ผู้ช่วยเภสัช** (assistant) | SRC: ก้า, กิฟ, สุ่ย, นิกกี้ / KKL: แตงโม, ทราย / SSS: ออย, ฟ้าใส |
| **คลัง** (warehouse) | WH: มุก, ตั๋ง, แล็ค |
| **หัวหน้างาน** (supervisor) | WH: มายด์ |

Profiles are defined in `EMPLOYEE_PROFILES` constant. Each branch declares only the roles it uses (SRC/KKL/SSS = `pharmacist`+`assistant`; WH = `supervisor`+`warehouse`). `showEmployeeSelector` renders sections conditionally (`profiles.pharmacist`, `profiles.assistant`, `profiles.warehouse`, `profiles.supervisor`) and hides missing ones. Selected employee is stored in `currentUser` (string) and `currentRole` (`'pharmacist'` | `'assistant'` | `'warehouse'` | `'supervisor'`). The header displays the active user (`คลัง: ` for warehouse, `หัวหน้างาน: ` for supervisor). On branch switch, `currentUser`/`currentRole` are cleared and the selector re-appears.

### WH recheck workflow — warehouse scans on PDA, supervisor confirms on Desktop

⚠️ **กฎสำคัญ:** flow นี้แยกคนละ device + คนละ role โดยเจตนา — **warehouse รีเช็คบน PDA แต่ยืนยันไม่ได้ / supervisor (มายด์) ยืนยันบน Desktop เท่านั้น**

**Warehouse role (`'warehouse'`)** — 3 staff (มุก, ตั๋ง, แล็ค). นับสินค้าครั้งแรก **และ** สแกนรีเช็ค audit ได้ แต่ **ยืนยันไม่ได้** (`canVerify` ไม่รวม warehouse — เปิด Audit Verify popup ไม่ได้, ไอคอน 🔍 บน PDA ไม่ขึ้น).
- **นับครั้งแรก:** เหมือน `assistant` — scan list กรองเฉพาะของตัวเอง (`scannedBy === currentUser`)
- **รีเช็ค audit:** สแกน SKU ที่ `status==='audit'` ที่ **ช่อง scan หลัก** (ไม่ใช่ popup) → `handleBarcode` สะสมเข้า **`sd.recheckQty`** (persist + sync, ไม่ใช่ `_avMap` ชั่วคราว) + `sd.recheckBy = currentUser`, status คงเป็น `audit`
- **worklist:** `rebuildScanListMap` ให้ warehouse เห็น audit ของ**ทุกคน** (ข้าม filter `scannedBy`) เป็น worklist รีเช็ค; แถว audit โชว์ `sd.recheckQty` (ไม่ใช่ `countedQty`) — `renderScanList` + `patchScanRow` ครอบคลุม `warehouse`/`supervisor`
- **รีเซ็ตรีเช็ค:** แถว audit ของ warehouse มีปุ่ม **✕** เรียก `resetRecheckItem(sku)` → ลบ `recheckQty`/`recheckBy` (แถวเป็น 0, status คง audit) + ยกเลิก debounce/queue กัน PDA auto-submit → สแกนนับใหม่จาก 0

**Supervisor role (`'supervisor'`)** — มายด์ (WH). ไม่สแกนนับ/รีเช็คเอง — ทำหน้าที่ **ยืนยัน** บน Desktop.
- เห็นทุกการสแกนของพนักงานทั้งหมด (`rebuildScanListMap` ไม่ filter `scannedBy`), แถว audit โชว์ `recheckQty` ที่ sync มาจาก PDA
- มี 2 ปุ่มบน Desktop (`updateScanInputMode`, gate `currentRole==='supervisor' && window.innerWidth>600`): **✔ Confirm** (นับ → `evaluatePendingScans`) และ **✓ ยืนยันรีเช็ค** (`pharmacistAuditBar`, label สลับผ่าน `#pharmacistAuditBtnLabel`)
- ปุ่มยืนยันรีเช็คเรียก `confirmRecheckBtn()` → `confirmAllRecheckSupervisor()`: วนทุก audit item ที่มี `recheckQty !== undefined && !auditor` → เทียบ `recheckQty` vs `systemQty` → `pass` / `stock_adjustment`, ตั้ง `auditor = มายด์` → sync + `saveAuditLogToFirestore`
- count บนปุ่ม (`#pharmacistAuditCount`) นับ audit item ที่รีเช็คแล้วรอยืนยัน (refresh ใน `updateStats`)

**Cloud sync ของ recheckQty:** `_applyCloudScanData` (WH propagate path) **mirror `recheckQty`/`recheckBy` จาก cloud ตรงๆ** (ไม่ใช่ max) บน audit item ที่ทั้ง local+cloud เป็น `audit` และ cloud ยังไม่มี `auditor` — ต้อง mirror ตรงๆ ไม่งั้นการ **รีเซ็ต** (ค่าลดลง/หาย) จะไม่ sync จาก PDA ไป Desktop. ทิศย้อนกลับ (supervisor ยืนยัน → cloud มี `auditor`) จะ overwrite local audit บน PDA เป็น pass/stock_adjustment ตามปกติ

> **ข้อจำกัด:** recheckQty บน PDA เป็น authoritative ตัวเดียว ถ้า Desktop (supervisor) เผลอ trigger `saveSession` ระหว่างที่ warehouse กำลังรีเช็ค อาจ clobber ค่า cloud ด้วยค่าเก่าได้ (window สั้น ~3s, self-heal เมื่อ PDA สแกนต่อ) — listener ไม่เรียก `saveSession` จึงเกิดยาก. supervisor เห็น recheckQty ก่อนกดยืนยันเสมอ

### Location Master — WH คลังสินค้า

ฟีเจอร์สำหรับ **WH branch เท่านั้น** — จัดการตำแหน่งวางสินค้า (Location) และกำหนดโซนให้พนักงาน

**State:**
- `state.locationMap: Map<SKU, string>` — SKU → location string เช่น `"A1-01"`
- `state.zoneStaffMap: Map<zone, staff>` — zone letter → staff name เช่น `"A" → "มุก"`

**Firestore:** `stock_sessions/WH_location` — document เดียว shared ทั้ง WH, format: `{locationData:{SKU:loc}, zoneStaff:{zone:staff}, updatedAt}`

**ปุ่มเข้าถึง:** `#btnLocation` (📍 Location) — ซ่อนบน PDA (`window.innerWidth <= 600`) และซ่อนเมื่อ `currentBranch !== 'WH'`

**Functions:**
- `openLocationPopup()` / `closeLocationPopup()` — เปิด/ปิด popup `#locationPopupOverlay`
- `renderLocationTable()` — render ตาราง Location (เรียงตาม Location ascending, empty ท้าย) พร้อม filter zone/staff/search
- `updateLocationEntry(sku, loc)` — แก้ไข inline ใน popup table
- `saveLocationToFirestore()` — บันทึก locationData + zoneStaff ลง Firestore, อัปเดต status badge
- `loadLocationFromFirestore()` — โหลดข้อมูลจาก Firestore เข้า state (เรียกใน `initAfterLogin`)
- `startLocationListener()` / `stopLocationListener()` — `onSnapshot` listener สำหรับ real-time sync ระหว่างเครื่อง; ปิดเมื่อ switch branch
- `importLocationCSV(file)` — นำเข้า CSV/Excel; lookup SKU จาก `productMasterMap` (Firestore global_pm) เป็นหลัก เพราะไม่ต้องการ R01+R05
- `renderZoneStaffPanel()` — render dropdown ทุกโซน A–O ใน Zone Staff popup
- `updateZoneStaff(zone, staff)` — set `state.zoneStaffMap`, อัปเดตตาราง + เปลี่ยน status badge เป็น "ยังไม่ได้ Save"
- `openZoneStaffPopup()` / `closeZoneStaffPopup()` — popup `#zoneStaffPopupOverlay` สำหรับกำหนดโซน

**CSV Import format:**

| Col | Index | เนื้อหา |
|---|---|---|
| A | 0 | SKU หรือ Barcode |
| B | 1 | Barcode (ไม่ใช้โดยตรง) |
| C | 2 | ชื่อสินค้า (ไม่ใช้) |
| D | 3 | หน่วย (ไม่ใช้) |
| E | 4 | **Location** — ค่าที่ต้องการ |

Header row ตรวจจับอัตโนมัติ (ข้ามแถวที่ col A คือ `sku`, `barcode`, `รหัสสินค้า`, หรือ `location`). แถวที่ไม่มี Location ถูกข้าม (`skipped++`). SKU lookup priority: `productMasterMap` → `barcodeMap` → `skuMap`.

**Location table:**
- เรียง ascending ตาม `localeCompare({numeric:true})` — A2 ก่อน A10
- ตาราง 6 คอลัมน์: `#` / `SKU` / `Barcode` / `Product Name` / `Location` / `พนักงาน`
- **พนักงาน column:** ดึง zone จาก `loc.charAt(0).toUpperCase()` → `state.zoneStaffMap.get(zone)`
- Filter: zone dropdown (`A`–`O`) + staff dropdown (มุก/ตั๋ง/แล็ค) + text search
- Render สูงสุด `LOC_MAX_ROWS = 200` แถวเมื่อมี search/filter; แสดงทั้งหมดเมื่อไม่กรอง

**Zone Staff popup (⚙ กำหนดโซน):**
- `_LOCATION_ZONES = ['A'...'O']` (15 โซน), `_LOCATION_STAFF = ['มุก','ตั๋ง','แล็ค']`
- ปุ่มอยู่ใน toolbar ของ Location popup ถัดจาก title ก่อนปุ่ม Import CSV
- เปลี่ยนแล้วไม่ sync ทันที — ต้องกด 💾 Save ใน Location popup เพื่อบันทึกลง Firestore

**onSnapshot sync:** `startLocationListener()` ฟัง `WH_location` document — เมื่อข้อมูลเปลี่ยน อัปเดต `state.locationMap` + `state.zoneStaffMap` + re-render ทั้ง Zone panel และ Location table ถ้า popup เปิดอยู่

---

**Pharmacist re-audit flow** (`openAuditVerifyPopup`, `handleAuditVerifyScan`, `confirmAllAuditVerify`) — **ใช้กับร้านยา (SRC/KKL/SSS) เท่านั้น**; WH ใช้ flow ด้านบนแทน (popup ยังเปิดได้สำหรับ supervisor/pharmacist แต่ warehouse เปิดไม่ได้):
1. Pharmacist opens **Audit Verify** panel (visible to all roles; button disabled for non-pharmacist with 🔒 message).
2. Pharmacist scans barcode(s) in the dedicated scan input; `_avMap: Map<SKU, number>` accumulates qty.
3. On **ยืนยันทั้งหมด** (footer button): for each SKU in `_avMap`:
   - `pharmacistQty === systemQty` → `status: 'pass'`
   - `pharmacistQty !== systemQty` → `status: 'stock_adjustment'`
4. Saves `sd.recheckQty`, `sd.auditor = currentUser`, `sd.timestamp` = pharmacist's verification time.
5. Toast feedback after confirm:
   - **Pharmacy (SRC/KKL/SSS):** toast per item — `✅ <SKU> ผ่าน → Pass` หรือ `⚠️ <SKU> ไม่ตรง (สแกน N / ระบบ M) → Stock Adjustment`
   - **WH:** summary toast เดียวตอนกด **ยืนยันทั้งหมด** — `✅ ผ่าน N รายการ, ⚠️ ปรับสต็อก M รายการ` (ฝั่งที่ 0 ตัดทิ้ง) — `confirmAuditVerifyItem(sku, silent=true)` ใน loop เพื่อนับ pass/adj แล้ว toast ครั้งเดียว type=`warn` ถ้ามี adj else `success`. ปุ่ม `✓ ยืนยัน` รายตัวในแถวยัง toast per-item ปกติ (silent=default false)

### Persistence Layers

| Layer | Key/Path | When written |
|---|---|---|
| localStorage | `stockCountSession_${branch}` | Every `saveSession()`, debounced 400 ms |
| Firestore `stock_sessions/${branch}` | Scan data | 3 s after localStorage write |
| Firestore `stock_sessions/${branch}_r01/r05` | R01/R05 master data | After file upload |
| Firestore `stock_sessions/global_pm` | Product Master | After PM upload; real-time listener on all devices |
| Firestore `stock_sessions/WH_location` | Location master + zone-staff map | After 💾 Save in Location popup; `{locationData:{SKU:loc}, zoneStaff:{zone:staff}, updatedAt}` — WH only |
| Firestore `stock_audit_log/${branch}_${date}` | Audit items log | After `evaluatePendingScans()` + after pharmacist verify + after supervisor `confirmAllRecheckSupervisor()` |

> ⚠️ **ไม่มี history snapshot ที่ Firestore** — `startNewCount()` ลบ `scanData` + R01 ออกจาก localStorage และ overwrite Firestore โดย**ไม่บันทึก** snapshot ของรอบเก่าไปไหน ต้อง Export Excel เก็บเองก่อนกด เริ่มนับใหม่ (โค้ดเก่าเคยเขียน `stock_history/${branch}_${date}` แต่ถูกถอดออกแล้ว) `stock_audit_log` เป็น log สะสมต่อวัน ไม่ใช่ snapshot รอบนับ
>
> ⚠️ **ลำดับใน `startNewCount()` สำคัญ** — เรียก `syncToFirestore(true)` **ก่อน** `rebuildMaps()` (ตอน `scanData` ยังว่าง) → cloud ได้ `scanData={}` + epoch ใหม่ → ทุก SKU "หายจาก cloud" จริง. ห้ามสลับลำดับให้ `rebuildMaps()` มาก่อน เพราะจะ broadcast `pending` ทั้ง catalog กลับขึ้น cloud → ทำให้ด่านกัน resurrection ใน `syncToFirestore` (ที่พึ่ง `!mergedSd[k]` = "SKU หายจาก cloud") ใช้ไม่ได้ → confirmed/scanning ของเครื่องอื่นเด้งกลับ (บั๊กที่เคยเกิด มิ.ย. 2026)
>
> **ไม่มีปุ่ม Backup/Restore JSON** — ฟังก์ชัน `backup` / `restore` / `exportHistoryExcel` และ popup 📅 ประวัติ (`openHistoryPopup` + `stockCountHistory_${branch}` localStorage) ถูกถอดออกจากโค้ดทั้งหมดแล้ว เหลือเฉพาะ 📊 ประวัติการนับ (History Stats) ที่ดึงจาก `stock_audit_log` แบบ live

`global_pm` is **shared across all branches** with an `onSnapshot` real-time listener (`startProductMasterListener()`). All other data is per-branch.

**Persisted fields in scanData:** `scannedBy`, `auditor`, `recheckQty`, `recheckBy`, `initialStatus` are all persisted (not stripped) — both `saveSession()` and `syncToFirestore()` strip only `retries` and `scans`. `recheckQty`/`recheckBy` carry the WH recheck count from PDA to the supervisor's Desktop via cloud sync.

### Cloud Sync — `pullFromCloud()` และ `_applyCloudScanData()`

ปุ่ม **Cloud** ในหัว เรียก `pullFromCloud()` เพื่อดึงข้อมูลจาก Firestore มา merge กับ local

Merge logic ถูกแยกออกเป็น `_applyCloudScanData(s)` (shared function) เพื่อใช้ร่วมกับ `startScanSessionListener()`:

**Merge rules:**
- ดึงเฉพาะ cloud item ที่ `status === 'pending'` หรือ `'scanning'` เท่านั้น — item ที่ Confirm แล้ว (`pass`, `audit`, `stock_adjustment`) ใน cloud จะถูกข้าม **ยกเว้น propagate path ด้านล่าง**
- **Propagate confirmed (ทุกสาขา, `_propagateConfirmed=true`):** cloud item ที่ confirmed (audit/pass/stock_adjustment) จะถูก apply ลง local ด้วย — (1) local มี `auditor` → เก็บ local ไว้; (2) local confirmed + cloud ยังไม่มี `auditor` → ไม่ทับ status แต่ mirror `recheckQty`/`recheckBy` (WH); (3) cloud มี `auditor` หรือ local ยังไม่ confirm → **ทับ local ด้วย cloud**. จำเป็นสำหรับ **เภสัชยืม PDA ผู้ช่วยตรวจ audit ข้ามเครื่อง** (PDA ต้องรับ audit items ของทุกเครื่องเข้า local จึงจะเห็นใน worklist + ยืนยันได้) และ WH recheck (PDA รับ audit จาก Desktop Confirm). เดิมเป็น WH-only — ขยายเป็นทุกสาขา
- ถ้า local item นั้น Confirm แล้ว → ไม่ overwrite (นอกเหนือจาก propagate path)
- `unknownScans` จาก cloud merge เข้า local โดยเพิ่มเฉพาะ barcode ที่ยังไม่มี
- **Reset epoch (ก่อนทุก merge rule):** ถ้า `s.countResetAt > _countResetAt` → adopt epoch + `_resetLocalScanDataToPending()` (reset **ทุก** item เป็น pending รวม scanning ค้าง + confirmed) ก่อนเข้า loop merge — แทนที่โค้ดเดิมที่ลบเฉพาะ confirmed (ทำให้ scanning ค้างรอด → resurrect)
- หลัง merge ต้องเรียก `invalidatePopupRowsCache()` **ก่อน** `renderTable()` เสมอ — มิฉะนั้น popup จะ render ด้วย cache เก่า

**Workflow หลัง `startNewCount` (monotonic reset epoch):** กด startNewCount บนเครื่องหลัก → ล้าง `scanData` → `syncToFirestore(true)` (ตอน scanData ว่าง) ดัน `scanData={}` + `_countResetAt` ใหม่ขึ้น cloud → `rebuildMaps()` repopulate pending **เฉพาะ local** → PDA ทุกเครื่องรับ `onSnapshot` → `_applyCloudScanData` เห็น `countResetAt` ใหม่กว่า (`>`) → `_resetLocalScanDataToPending()` → `updateStats()` → stats reset เป็น 0. เพราะ cloud เป็น `{}` (SKU หายจาก cloud) เครื่องที่ยังถือ confirmed/scanning เก่า **re-upload ไม่ได้** (ด่าน `!mergedSd[k]` ทำงาน) + ถ้าเครื่องนั้น sync ก่อนรับ snapshot ก็โดน epoch-guard ใน `syncToFirestore` reset แทน (ดู section syncToFirestore)
> **ข้อจำกัด (rare):** ยังมี TOCTOU race เสี้ยววินาที — ถ้า PDA `ref.get()` cloud **ก่อน** เครื่องหลักเขียน reset แล้ว `set()` **หลัง** อาจ clobber ชั่วคราว แต่ self-heal เมื่อรับ snapshot/sync รอบถัดไป (ไม่ค้างถาวร). ปิด 100% ต้องใช้ Firestore transaction

### Cloud Sync — `startScanSessionListener()` (onSnapshot)

เริ่มทำงานอัตโนมัติหลัง login (`initAfterLogin`) — ฟัง real-time changes บน `stock_sessions/${branch}`:
- เมื่อเครื่องอื่น sync ขึ้น cloud → `onSnapshot` fires → debounce 3s → `_applyCloudScanData()` → `rebuildScanListMap(true)` → render
- **ไม่เรียก `saveSession()`** ใน handler เพื่อป้องกัน sync loop
- ปิด listener อัตโนมัติเมื่อ switch branch (`stopScanSessionListener()`)
- ไม่ทำงานใน admin mode (`_adminMode`)

**ข้อจำกัด debounce:** ถ้า 4 เครื่อง sync ต่อเนื่องทุก ~0.75s debounce 3s อาจถูก reset ซ้ำ (starvation) — จะ execute ได้เมื่อมีช่วงหยุดสแกน

### Cloud Sync — `syncToFirestore()`

`syncToFirestore(overwrite=false)` ถูกเรียกอัตโนมัติ 3 วินาทีหลัง `saveSession()` ทุกครั้ง

**Merge rules (overwrite=false):**
- **Epoch guard (เช็คก่อนทุกอย่าง):** ถ้า `s.countResetAt > _countResetAt` (cloud ถูก startNewCount ใหม่กว่า local) → adopt epoch + `_resetLocalScanDataToPending()` + `saveSession()` + re-render แล้ว **`return` ทันที (ไม่เขียนทับ cloud)** — กันเครื่องที่ยังถือข้อมูลเก่า re-upload confirmed/scanning กลับ + กัน revert epoch บน cloud (สาเหตุหลักที่ confirmed เด้งกลับหน้า supervisor). ทำงานแม้ listener ยังไม่ทันยิง snapshot
- ดึง cloud state มา merge ก่อน แล้วค่อย overwrite ด้วย local
- local item ที่เป็น `pending` จะไม่ overwrite cloud item ที่มี status อื่น (เพื่อไม่ reset สิ่งที่เครื่องอื่นสแกนแล้ว)
- **local item ที่เป็น `scanning`/`pending` แต่ไม่มีใน cloud → ไม่ re-upload** (ป้องกัน PDA เขียนข้อมูลเก่ากลับหลัง `startNewCount`)
- **local item ที่เป็น `pass`/`audit`/`stock_adjustment` แต่ไม่มีใน cloud → ไม่ re-upload** (ป้องกัน data resurrection หลัง `startNewCount`)
- **cloud item มี `auditor` (verify แล้ว) แต่ local ยังไม่มี `auditor` → ไม่ overwrite** (`if(mergedSd[k]?.auditor && !localSd[k].auditor)continue;`) — ป้องกัน **WH recheck race**: หลัง supervisor (มายด์) กดยืนยันรีเช็คบน Desktop (cloud = pass/stock_adj + auditor) แล้ว PDA ที่ยังถือ local `audit` เก่า เผลอ sync ทับ cloud กลับเป็น audit ทำให้ PDA ค้างที่ audit ไม่อัปเดต. สมมาตรกับ `_applyCloudScanData` (local-verified เก็บไว้ / cloud-verified ทับ local-unverified)

### Known Pitfalls — Cloud Sync

#### ปัญหา: เครื่องอื่นไม่เห็นข้อมูล PASS/AUDIT หลัง F5

**อาการ:** เครื่อง A มี PASS=11, AUDIT=8 แต่เครื่อง B หลัง F5 เห็น COUNTED=0, PASS=0, AUDIT=0

**สาเหตุที่พบบ่อย:**

1. **Admin Mode ค้างอยู่บนเครื่อง A** — `syncToFirestore()` มี guard `if(_adminMode)return` ทุก operation ที่ทำใน Admin Mode จะไม่ถึง Firestore เลย
   - ตรวจ: ปุ่มบนเครื่อง A เป็น "🔓 Administrator ON" (สีเหลือง) ไหม?
   - แก้: คลิกปุ่มออก Admin Mode → ระบบ `syncToFirestore(true)` อัตโนมัติ

2. **`restoreFromFirestore()` early return** — ถ้าเครื่อง B มี R01+R05 ใน localStorage อยู่แล้ว (`state.scanData.size > 0 && r01Data.length > 0 && r05Data.length > 0`) จะ return ก่อนโหลด scanData จาก Firestore
   - อาการ: เครื่อง B เห็นแค่ pending ทั้งหมด ไม่เห็น PASS/AUDIT
   - **แก้ถาวรแล้ว (commit 3baa421):** ตอนนี้ early return จะ merge confirmed items จาก Firestore เข้ามาก่อน return เสมอ
   - **Epoch guard ใน early-return:** ก่อน merge confirmed มีเช็ค `s.countResetAt > _countResetAt` — ถ้า cloud ถูก startNewCount หลัง localStorage ถูกเขียนล่าสุด → `_resetLocalScanDataToPending()` ก่อน เพื่อกัน login มาแล้วเห็น confirmed เก่าค้าง + กันเครื่องนั้น re-upload ของเก่า (resurrection ผ่าน login path)
   - แก้ทันที (กรณีใช้โค้ดเก่า): เปิด Console บนเครื่อง B พิมพ์ `restoreFromFirestore(true)`

3. **มีใครกด "🔄 เริ่มนับใหม่" บนเครื่อง B** — เรียก `syncToFirestore(true)` overwrite=true ล้าง Firestore ด้วย state ว่าง

**`_applyCloudScanData()` และ `pullFromCloud()` ไม่ช่วยกรณีนี้** — ฟังก์ชันเหล่านี้ merge เฉพาะ item ที่เป็น `pending`/`scanning` จาก cloud เท่านั้น (`UNCONFIRMED` set) — item ที่ Confirm แล้ว (`pass`, `audit`, `stock_adjustment`) จะถูกข้าม ดังนั้นกด Cloud ☁️ ไม่ช่วยให้เห็น PASS/AUDIT จากเครื่องอื่น

---

### R16 Re-evaluation — `reEvaluateAuditItems()`

เรียกอัตโนมัติทุกครั้งที่อัพ R16 ใหม่ (ถ้า matched > 0) เพื่อแก้สถานะที่อาจผิดจาก R16 ผิดไฟล์

**Re-evaluate เฉพาะ:**
- status `'audit'` หรือ `'pass'` ที่ **ยังไม่ได้เภสัชยืนยัน** (`sd.auditor` ว่าง)
- ข้าม `stock_adjustment` และ item ที่มี `sd.auditor` (เภสัชยืนยันแล้ว ถือเป็น final)

**เมื่อสถานะเปลี่ยน:**
- อัพเดท `sd.status`, `sd.auditStatus`, และ `sd.initialStatus` ให้ตรงกับ R16 ใหม่
- เรียก `saveAuditLogToFirestore()` เพื่ออัพเดท audit log ใน Firestore
- แสดง toast "R16 ใหม่: ปรับสถานะ N รายการ"

**R16 Date Mismatch Warning:**
หลังโหลด R16 สำเร็จ ระบบเปรียบเทียบวันที่ TRANDATE ใน R16 กับวันที่ใน `sd.timestamp` ของ item ที่สแกนแล้ว หากไม่มี overlap (รวมถึงวันถัดไปสำหรับการสแกนข้ามคืน) จะเกิดสิ่งต่อไปนี้พร้อมกัน:
1. Toast warn 7 วินาที พร้อมระบุวันที่ทั้งสองฝั่ง เช่น "⚠️ วันที่ R16 (13/05/2026) ไม่ตรงกับวันที่สแกน (14/05/2026)"
2. Badge R16 เปลี่ยนจาก **"Ready"** (เขียว) เป็น **"⚠️ ตรวจสอบวันที่"** (เหลือง, class `upload-file-badge-warn`) — แสดงถาวรจนกว่าจะอัพ R16 ใหม่ที่ถูกต้อง
3. `state.r16DateMismatch = true`

เมื่อผู้ใช้กด **Confirm** ขณะที่ `state.r16DateMismatch === true`:
- `validateAndProcess()` จะแสดง **`r16MismatchModal`** แทนที่จะ Confirm ต่อเลย
- Modal แสดงวันที่ R16 vs วันที่สแกน พร้อม 2 ปุ่ม:
  - **✕ ยกเลิก — อัพ R16 ใหม่** → ปิด modal กลับไปอัพไฟล์
  - **ยืนยันต่อไป →** → Confirm ต่อได้ถ้าแน่ใจ

Badge และ flag รีเซ็ตอัตโนมัติเมื่อ: อัพ R16 ใหม่สำเร็จ / เริ่มนับใหม่ / ล้างข้อมูลทั้งหมด

### R16.104 TRANDATE Filter Logic

`getSoldQtyBefore(sku, scanTimestamp)` compares each R16 sale's `TRANDATE` against the item's scan timestamp:
- `TRANDATE <= scanTimestamp` → sale happened before/during count → **include** in soldQty (add back to countedQty)
- `TRANDATE > scanTimestamp` → sale happened after count → **exclude**
- `TRANDATE missing/unparseable` → **exclude** (conservative — avoids false Audit)

This relies on `r16RawMap` (SKU → `[{soldQty, tranDate}]`), built during `loadR16()`. **`r16RawMap` is NOT persisted** to localStorage or Firestore — it only exists in memory for the current session. After page refresh, `getSoldQtyBefore` falls back to `r16SalesMap` (no time filter). This is acceptable because statuses are already saved after Confirm; re-evaluation only happens if R16 is re-uploaded (which rebuilds `r16RawMap`).

TRANDATE column is auto-detected from R16 header row by matching column name `TRANDATE` (case-insensitive). If not found, `tranDate = ''` for all rows. Check browser Console for `[R16] TRANDATE col index:` to verify detection.

`parseTranDate()` supports these formats:
- `DD/MM/YYYY H:mm[:ss] [AM/PM]` — Thai POS slash format
- `DD-MM-YY H:mm[:ss] [AM/PM]` — Thai POS dash format e.g. `25-04-26 8:07`
- `DD-MM-YYYY H:mm[:ss] [AM/PM]` — e.g. `25-04-2026 8:38:50 AM`
- `YYYY-MM-DD HH:mm:ss` — ISO format

AM/PM is handled correctly (12 AM → 0:00, 1 PM → 13:00, etc.).

R01.102 is uploaded once at 21:00 (time-gated in normal mode). SystemQty represents stock as of that snapshot. R16.104 covers sales from after the R01 snapshot until upload time. The formula: `effectiveCnt = countedQty + soldQty_before_scan` compared against `systemQty`.

### CSV/Excel Parsing

`parseFile()` handles `.csv` and `.xlsx`/`.xls`. For CSV, it auto-detects UTF-8 BOM → UTF-8 → Windows-874 (Thai Excel default) encoding.

Column mappings (zero-indexed, skip row 0 header):
- **R01.102**: Col E (index 4)=SKU, F (5)=ProductName, G (6)=SystemQty; rows with qty≤0 are skipped. Re-uploading clears previous data (`state.r01Data = []` first) then calls `rebuildMaps()`. ⚠️ **scanData ของ SKU เดิมไม่ถูกรีเซ็ตเป็น pending** — `rebuildMaps()` เพิ่ม pending เฉพาะ SKU ใหม่ที่ยังไม่มีใน scanData (`if(!state.scanData.has(sku))`) เท่านั้น. ของค้างถูกล้างด้วย `startNewCount()` หรือ `resetStaleScanningItems()` (login) เท่านั้น
- **R05.106**: Col A (0)=Barcode, E (4)=SKU, G (6)=unitName, H (7)=unitMultiplier.
> 📌 **ไฟล์ R16 (R16.103 + R16.104) ที่ export ออกมาจากระบบเป็นไฟล์รวมทุกสาขา + WH ในไฟล์เดียว** — ไม่ได้แยกตามสาขา ดังนั้น Col C prefix filter จึงเป็นกลไกหลักที่คัดเฉพาะรายการที่เกี่ยวข้อง และเป็นเหตุผลที่ **WH ต้องข้ามยอดขาย (ORCM/OCTM)** เพราะรายการขายเหล่านั้นเป็นของสาขายาที่ปนมาในไฟล์รวมเดียวกัน ไม่ใช่ของคลัง การ filter จึงต้องทำทั้งฝั่งสาขาและ WH (คนละ prefix set)

- **R16.104**: Col C (2) กำหนดประเภทเอกสาร — กรองเฉพาะ 5 ประเภทนี้ ที่เหลือข้ามทั้งหมด:

  | Col C prefix | ประเภท | ผลต่อ effectiveCnt |
  |---|---|---|
  | `ORCM`, `OCTM` | ยอดขาย (Sales) | หักออก → บวกกลับเข้า countedQty (`r16SalesMap`) — **WH ข้าม ไม่นับ** |
  | `OTFB`, `ORTS`, `OTFI` | รับเข้าคลัง (Inbound) | บวกเพิ่ม → หักออกจาก countedQty (`r16InboundMap`) |

  ⚠️ **WH branch:** `loadR16()` ข้ามยอดขาย (`ORCM`/`OCTM`) ทั้งหมด — `isSale=!isWhBranch && _matchR16Prefix(...)` ดังนั้น WH นับเฉพาะ inbound (OTFB/ORTS/OTFI) จาก R16.104 + R16.103. ยอดขายเป็นรายการของสาขา ไม่กระทบ effectiveCnt ของคลัง

  Col O (14)=Barcode; Col R (17)=BASEQUANTITY (แปลงเป็นหน่วยเล็กสุดแล้ว); Col X (23)=SKU; TRANDATE column auto-detected from header row (row 0).

- **R16.103** (WH only): คอลัมน์เหมือน R16.104 ทุกอย่าง กรองเฉพาะ:

  | Col C prefix | ประเภท | ผลต่อ effectiveCnt |
  |---|---|---|
  | `IRNC`, `IRVC`, `IRNM`, `ICSM`, `ITFB`, `ITFW`, `IPOS`, `IRCN` | รับเข้าที่ยังไม่ขึ้นชั้น | อยู่ใน systemQty แต่พนักงานไม่ได้นับ → บวกกลับเข้า countedQty (`r16_103Map`) |

  ใช้ TRANDATE filtering เหมือนกัน (`getR16103QtyBefore`). ไม่มี time gate. แสดงปุ่มเฉพาะ Desktop WH.

### Scan Input Formats

The scan input accepts comma-separated values:
```
barcode                    → qty defaults to 1
barcode,qty
location,barcode,qty
SKU                        → resolves to smallest-unit barcode
SKU,qty
location,SKU,qty
```

### PDA Barcode Scanner — PDA vs Manual Detection

`handleScanInput()` detects PDA scanner vs manual typing based on inter-keystroke timing (`PDA_KEYSTROKE_THRESHOLD_MS = 150 ms`):

- **PDA mode** — when a keystroke arrives within 150 ms of the previous one, `_pdaMode = true`. The 80 ms debounce (`SCAN_DEBOUNCE_MS`) auto-submits 80 ms after the last keystroke. This handles PDA scanners that don't send Enter.
- **Manual mode** — keystrokes ≥ 150 ms apart keep `_pdaMode = false`. **No auto-submit** via PDA debounce — but a **fallback debounce 350 ms** fires `processScan()` if `value.trim().length >= 6` (covers very slow scanners > 150 ms/char). Otherwise the user presses **Enter** or the **⏎ submit button**.
- The first keystroke can't be classified (no previous timestamp), so detection happens on the second keystroke. Once `_pdaMode = true`, it stays true until the scan is processed (then resets to `false`).
- 80 ms is safely wider than a full PDA scan (~20–50 ms total) but shorter than the minimum gap between two physical scans (~500 ms+), preventing concatenation.
- If Enter or `\r\n` arrives first, the debounce timer is cancelled and `processScan()` fires immediately.

**Manual submit button (⏎)** is rendered next to the scan input and calls `submitScanManual()`, which clears the debounce/PDA state and runs `processScan()`. It exists as a device-agnostic fallback when keyboard `keydown` events don't fire reliably (some Android/PDA browsers).

**Enter key fallback:** `handleScanKey()` accepts `e.key === 'Enter'`, `e.keyCode === 13`, or `e.which === 13` to cover older browsers and PDA devices that don't expose modern `e.key`.

State variables: `_lastKeystrokeTime` and `_pdaMode` are reset in `resetScanRuntimeState()`, `handleScanKey()` (on Enter), the debounce callback, the `\r\n` shortcut path, and `removeScanItem()`.

### Rendering

- All renders are debounced: `scheduleRender`→`renderTable` 80 ms, `schedulePopupRender`→`renderPopupTable` 160 ms (`POPUP_RENDER_DEBOUNCE_MS`), `scheduleScanListRender`→`renderScanList` 20 ms, `scheduleSave`→`saveSession` 400 ms.
- Scan list renders last **30** entries (`SCAN_LIST_MAX`).
- Popup table renders at most **500** rows (`POPUP_MAX_RENDER_ROWS`).
- `popupBaseRowsCache` caches the full popup row list; invalidated by `invalidatePopupRowsCache()` on any state change. Call this whenever `state.scanData` or `state.unknownScans` changes.
- `patchScanRow(key)` does targeted in-place DOM update for a single row without full re-render; used during batch scans.

### DEL Items

When both Product Master and R01 are loaded, SKUs present in R01 but absent from Product Master are flagged `isDel: true` in `skuMap`. They are shown in the popup table with a red **DEL** badge and are selectable via the **🗑️ DEL** filter button in the popup toolbar. They participate in scanning and evaluation normally. DEL items also appear in History Stats tabs (no filtering).

### Column Resizing

The scan list header columns are drag-resizable via `initColResize()`. Widths are stored in `_colWidths` (5 elements: `[98, 120, 0, 88, 128]`) and applied via `applyColWidths()` which sets `grid-template-columns` on every `.scan-list-header` and `.scan-row` element. The name column (index 2) is computed as the remaining space (`1fr`).

Scan list columns (5 total): **SKU** / **Barcode** / **Product Name** / **Qty** / **Status**. There is no separate remove-button column — the ✕ button (`btn-remove-sku`) is embedded inside the SKU cell as a flex child, visible only when `status === 'scanning'`.

**WH Supervisor Desktop — 7-column scan list:** เมื่อ `currentRole === 'supervisor' && currentBranch === 'WH' && window.innerWidth > 600`, `applyColWidths()` และ `renderScanList()` สลับเป็น 7 คอลัมน์: **SKU / Barcode / Product Name / Qty / Sys Qty / Location / Status**

- Header spans `#scanListHeaderSysQty` และ `#scanListHeaderLocation` แสดง/ซ่อนโดย `updateScanInputMode()`
- `renderScanList()` เพิ่ม div `.scan-row-sysqty` และ `.scan-row-loc` ต่อแถว
- **Column widths:** 7-col template = `82px 90px minmax(0,1fr) 60px 58px 65px 95px` — SKU(82) Barcode(90) **Name=`minmax(0,1fr)`** Qty(60) SysQty(58) Location(65) Status(95); fixed = 450px, Name เติมพื้นที่ที่เหลือพอดี. ใช้ `minmax(0,1fr)` (min=0) ไม่ใช่ `1fr` เพื่อให้ Name **ย่อได้ถึง 0** (ชื่อยาว clip ด้วย ellipsis ที่ `.scan-row-pn` + header span `overflow:hidden`) → grid ไม่เกิน container แม้ viewport แคบ. **ห้ามกลับไปคำนวณ `nameW = header.offsetWidth − 450` แบบ fixed px** — การวัด offsetWidth เพี้ยนตอน layout ไม่นิ่ง + floor 60px ทำให้รวม 510px เกิน container (Name เลยขอบ). `applyColWidths()` และ `renderScanList()` ใช้ template string เดียวกัน (header + rows align เสมอ)
- **Drag-resize ใน 7-col mode:** ไม่ทำงาน — `_colWidths` ยังคงเป็น 5 elements สำหรับ 5-col mode เท่านั้น

### History Stats Panel (📊 ประวัติการนับ)

Panel card visible to **all roles** after login. Opens `openHistoryStatsPopup()`. ปุ่มมี badge นับ (`#historyStatsCount`) แสดงจำนวน `stock_adjustment` ปัจจุบัน (`updateHistoryStatsCount`) — **ยกเว้น Desktop เภสัช** (`currentRole==='pharmacist' && window.innerWidth>600`) ที่**ซ่อน badge** (`display:none`); role/อุปกรณ์อื่นโชว์ตามปกติ. Has 4 tabs:

| Tab | เนื้อหา |
|---|---|
| 👥 ผู้ช่วยนับครั้งแรก | SKU ที่ `initialStatus === 'audit'` — โหลดจาก local state หรือ Firestore `stock_audit_log` |
| 🧑‍⚕️ เภสัชตรวจ | SKU ที่มี `sd.auditor` (เภสัชตรวจแล้ว) |
| 🔴 Stock Adj ทั้งหมด | SKU ที่ `status === 'stock_adjustment'` พร้อมปุ่ม Export Excel |
| 📂 อัพโหลดใบนับสินค้า | upload CSV/Excel เพื่อเปรียบเทียบ |

**Location column (WH branch):** ทุก tab ที่แสดงตาราง (👥 ผู้ช่วย, 🧑‍⚕️ ผู้รีเช็ค, 🔴 Stock Adj) จะเพิ่มคอลัมน์ **Location** หลัง Product Name เมื่อ `currentBranch === 'WH'` — ดึงจาก `state.locationMap.get(sku)` สาขาอื่นไม่มีคอลัมน์นี้

**Stock Adj columns (pharmacy):** # / SKU / Barcode / Product Name / หน่วย / จำนวนคงเหลือ (systemQty) / จำนวนปรับปรุง (recheckQty) / Diff (systemQty − recheckQty, บวก=ขาด/แดง, ลบ=เกิน/เขียว)

**Stock Adj columns (WH, ตารางบนจอ):** # / SKU / Barcode / Product Name / **Location** / หน่วย / จำนวนคงเหลือ / จำนวนปรับปรุง / Diff

**Export Excel layout (`exportStockAdjExcel`) — ใช้ร่วมกันทั้งสาขาและ WH (10 คอลัมน์, ตัด # ออก):** A=Location / B=SKU / C=Barcode / D=Product Name / E=หน่วย / F=จำนวนคงเหลือ / G=จำนวนปรับปรุง / H=Diff / I=พนักงานที่สแกน (`sd.scannedBy`) / J=เวลาที่นับ (`sd.timestamp`). สาขาที่ไม่มี Location (non-WH) คอลัมน์ A เว้นว่าง

`_hsFirestoreItems`: `null`=ยังไม่โหลด, `[]`=โหลดแล้วไม่มีข้อมูล, `[...]`=มีข้อมูล

**Firestore Audit Log** (`stock_audit_log/${branch}_${date}`):
- บันทึกโดย `saveAuditLogToFirestore()` หลัง Confirm และหลัง pharmacist verify
- โหลดโดย `loadAuditLogFromFirestore()` เมื่อ local state ว่างเปล่า
- เก็บเฉพาะ items ที่ `initialStatus === 'audit'`

### Dashboard Popup (📊 Dashboard)

ปุ่มอยู่ใน header bar แสดงให้ทุก role เห็น เปิด `openDashboardPopup()` → `refreshDashboard()` → ดึง Firestore แล้ว `buildDashboardData()` → `renderDashboard()`

**Branch filter — `getActiveDashBranches()`:**
- **WH login** (`currentBranch === 'WH'`) → แสดงเฉพาะ WH คลังสินค้า, title = `"📊 Dashboard — WH คลังสินค้า"`
- **สาขาอื่น** → แสดงทุกสาขา (SRC, KKL, SSS, WH), title = `"📊 Dashboard — สรุปการนับสต็อกทุกสาขา"`

`DASHBOARD_BRANCHES` constant ยังคงเป็น `['SRC','KKL','SSS','WH']` — `getActiveDashBranches()` เป็น runtime filter ทุก Dashboard function ใช้ `getActiveDashBranches()` แทน constant โดยตรง ได้แก่ `refreshDashboard`, `buildDashboardData`, `renderDashboard`, `renderDashAssistantTable`

**Sections ใน Dashboard:**
1. Branch summary doughnut cards (Pass/Audit/Stock Adj/Scanning per branch)
2. Per-assistant scan table (filterable by branch) — title/labels สลับด้วย `isWhDash` flag: WH → "👥 พนักงานคลัง — สรุปการสแกน", branch filter hidden (single branch)
3. Audit progress table — WH → "🔁 รีเช็ค Audit — ความคืบหน้า"; pharmacy → "🧑‍⚕️ ผู้ตรวจ Audit (เภสัช / คลัง) — ความคืบหน้า"
4. Daily activity bar chart (จาก `stock_audit_log`)
5. Audit % per staff bar chart — WH → "⚠️ Audit % ต่อพนักงานคลัง"

`isWhDash = currentBranch === 'WH'` คำนวณใน `renderDashboard()` เพื่อควบคุม label ทุก section แทนการใช้ constant โดยตรง

### Audit Verify Panel

Panel card แสดงให้ **ทุก role** เห็น แต่ปุ่มจะ disabled (เทา + 🔒 ข้อความ) สำหรับ role ที่ไม่มีสิทธิ์ verify — `canVerify = currentRole === 'pharmacist' || currentRole === 'supervisor'` (**warehouse ไม่มีสิทธิ์ verify แล้ว** — รีเช็คผ่านช่อง scan หลักบน PDA แทน ดูหัวข้อ "WH recheck workflow")

**Popup title สลับตาม branch (set ใน `openAuditVerifyPopup`):**
- SRC/KKL/SSS → `🔍 Audit Verify — ตรวจสอบสินค้า (เภสัช)`
- WH → `🔍 Audit Verify — รีเช็คสินค้า`

**PDA access** — panel เดิมที่อยู่ใน `.left-panel` ถูก CSS ซ่อนบน PDA (`.left-panel{display:none}`). มีปุ่มไอคอน `#btnPdaAuditVerify` (🔍 + badge นับ) ที่ header ข้างปุ่ม Cloud ทำหน้าที่เปิด popup เดียวกัน — แสดงเฉพาะ `window.innerWidth <= 600 && canVerify` (logic ใน `updateAuditVerifyPanel`). Badge sync กับ `updateAuditVerifyCount` — **นับเฉพาะ `status==='audit'` (รายการที่รอ verify) ไม่รวม `stock_adjustment`** (ตรวจเสร็จแล้ว); ใช้ค่าเดียวกันทั้งปุ่ม Desktop (`#auditVerifyCount`) และ PDA (`#btnPdaAuditCount`).

**Popup has two filter tabs:**

**⚠️ Audit tab** — shows items with `status === 'audit'`:
- Columns: `#` / `SKU` / `Barcode` / `Product Name` / `Count Qty` (assistant's count) / `Recheck` (pharmacist's accumulated scan) / `Status` / `Timestamp` / ปุ่ม `✓ ยืนยัน` per row
- Pharmacist scans barcode in the scan input (`handleAuditVerifyScan`) → accumulates qty in `_avMap: Map<SKU, number>`
- Footer: **ยืนยันทั้งหมด** button (`confirmAllAuditVerify`) — confirms all items in `_avMap` at once
- On confirm per item (`confirmAuditVerifyItem(sku, silent=false)`):
  - `pharmacistQty === systemQty` → `status: 'pass'`, returns `'pass'`
  - `pharmacistQty !== systemQty` → `status: 'stock_adjustment'`, returns `'stock_adjustment'`
  - Saves `sd.recheckQty`, `sd.auditor = currentUser`, `sd.timestamp` = pharmacist's time
  - `silent=true` → suppresses per-item toast (used by WH summary flow)
- Toast feedback differs by branch:
  - **Pharmacy (SRC/KKL/SSS)** — toast per item: `✅ <SKU> ผ่าน → Pass` / `⚠️ <SKU> ไม่ตรง (สแกน N / ระบบ M) → Stock Adjustment`
  - **WH** — `ยืนยันทั้งหมด` ยิง summary toast เดียว: `✅ ผ่าน N รายการ, ⚠️ ปรับสต็อก M รายการ` (ฝั่งที่ 0 ตัดทิ้ง, type `warn` ถ้ามี adj else `success`). ปุ่ม `✓ ยืนยัน` รายตัวในแถวยัง toast per-item ปกติ

**🔴 Stock Adj tab** — shows items with `status === 'stock_adjustment'`:
- Columns: `#` / `SKU` / `Barcode` / `Product Name` / `Sys Qty` / `Recheck Qty` / `Diff` / `เวลาที่เช็คล่าสุด`
- Diff = `recheckQty − systemQty`: negative=ขาด/แดง, positive=เกิน/เขียว (opposite sign from History Stats)
- Read-only view

`_avFilter` (`'audit'` | `'stock_adj'`) controls which tab is active. Resets to `'audit'` every time the popup is opened.

### Export Excel

ระบบมี **3 ปุ่ม Export** (ไม่มี Backup/Restore JSON):

| ปุ่ม | ฟังก์ชัน | เนื้อหา | ไฟล์ |
|---|---|---|---|
| ⬇️ Export Excel (popup รายการสต็อก toolbar) | `exportExcel()` | audit + stock_adj เท่านั้น — SKU, Barcode, ProductName, SystemQty, CountedQty, Status, Timestamp, Audit Status | `audit_${date}.xlsx` |
| ⬇️ Export Excel (History Stats → tab 🔴 Stock Adj) | `exportStockAdjExcel()` | stock_adj ปัจจุบัน — A=Location, B=SKU, C=Barcode, D=Product Name, E=หน่วย, F=จำนวนคงเหลือ, G=จำนวนปรับปรุง, H=Diff (`sysQty − recheckQty`; บวก=ขาด, ลบ=เกิน), I=พนักงานที่สแกน, J=เวลาที่นับ — layout เดียวกันทั้งสาขา/WH | `stockadj_${branch}_${date}.xlsx` |
| ⬇️ Export Excel (History Stats → tab 👥 นับครั้งแรก / 🧑‍⚕️ รีเช็ค) | `exportHsCountExcel()` | tab ที่ active — `Location, SKU, Barcode, NAME, Unit, CountQty, SystemQty, Diff, <ชื่อพนักงาน>, เวลาที่สแกน` โดย Location ดึงจาก `state.locationMap` (ไม่ใช่ `sd.location`); ชื่อพนักงาน: นับครั้งแรก=`scannedBy` (header WH "ชื่อผู้สแกน" / สาขา "ชื่อผู้ช่วย"), รีเช็ค=`auditor` (header WH "ชื่อผู้รีเช็ค" / สาขา "ชื่อเภสัช"); เวลาที่สแกน=`sd.timestamp` | `count_` / `recheck_${branch}_${date}.xlsx` |

### Scan List QTY Masking

QTY column behavior in the live scan list depends on status, `systemQty`, and role:

| Status | Condition | Displays |
|---|---|---|
| `scanning` | `systemQty > 100` | Inline editable `<input>` (calls `updateInlineQty` → `countedQty`) |
| `scanning` | `systemQty ≤ 100` | Actual `countedQty` (bold) |
| `unknown` | — | Actual `countedQty` (bold) — always shown |
| `audit` | role `pharmacist` / `supervisor` | `totalQty` (bold) — recheck/verify qty, read-only |
| other (`pass`, `audit`, etc.) | `countedQty > 100` | Number (re-check warning) |
| other | `countedQty ≤ 100` | Empty — intentionally hidden to prevent counter bias |

The inline input threshold changed from `countedQty > 100` → `systemQty > 100` (commit `b7cd9e7`).

**WH warehouse override — `whStaffEdit = currentRole==='warehouse' && currentBranch==='WH'`:** สำหรับ warehouse role (PDA คลัง) QTY **แก้ไขได้ inline ทุกรอบ** ข้าม threshold `systemQty > 100`:
- `scanning` (นับครั้งแรก) → `<input>` เสมอ ทุก `systemQty` → `updateInlineQty()` เขียน `countedQty`
- `audit` (รีเช็ค) → `<input>` เสมอ → **`updateRecheckInlineQty()`** เขียน `sd.recheckQty` + `recheckBy = currentUser` (ไม่ใช่ `countedQty`) → persist + sync ขึ้น cloud ให้ supervisor เห็น
- แก้มือ + สแกนสะสมทำงานร่วมกัน: `handleBarcode` บวกเพิ่มจากค่าที่พิมพ์ (scanning→`countedQty`, audit→`recheckQty`); พิมพ์ใหม่ = ตั้งค่าทับ
- role อื่น (assistant/pharmacist/supervisor) ไม่กระทบ — ใช้ logic เดิม. ⚠️ ต้องตั้ง PDA เป็น Broadcast Mode (`receiveBarcode` → `#scanInput`) เพื่อให้สแกนติดแม้ cursor อยู่ในช่อง qty

This applies to both `renderScanList()` (full re-render) and `patchScanRow()` (in-place patch) — ทั้งคู่เช็ค `whStaffEdit` เหมือนกัน.

### 2-Minute Scan Gap Reset

In `handleBarcode()`, if the same SKU is scanned again after more than 2 minutes since its last `timestamp`, a `scanGapModal` is shown requiring confirmation before continuing.

> ⚠️ **WH branch ข้าม gap นี้ทั้งหมด** — เงื่อนไขมี `currentBranch!=='WH'` นำหน้า. คลังนับสต็อกของจำนวนเยอะ สแกน SKU เดิมซ้ำได้นานเกิน 2 นาทีโดย `countedQty` ไม่ถูก reset (สแกนแล้วบวกสะสมปกติ). เฉพาะสาขายา (SRC/KKL/SSS) ที่ยังเตือน + reset. หมายเหตุ: WH audit recheck ไม่เคยเข้าบล็อกนี้อยู่แล้ว (อยู่คนละ branch — สะสม `recheckQty` แล้ว return ก่อน). กลไกแก้พลาดบน WH ใช้ปุ่ม ✕ / แก้ QTY inline แทน

`showScanGapModal()` triggers two alerts simultaneously:
- **`beepWarn()`** — siren sound: 880 Hz → 440 Hz → 880 Hz → 440 Hz, 4 cycles, `square` wave, 0.22s per pulse (Web Audio API)
- **`navigator.vibrate([200,100,200,100,200])`** — haptic pattern (ignored on desktop)

On confirm (`confirmScanGap()`): `countedQty` is reset to **0** and `sd.scans` is cleared. The barcode that triggered the gap is **not** counted — the user is expected to rescan from scratch. The modal displays "นับเดิม → 0" to make this clear.

`beepWarn()` uses a shared `_ac()` helper that lazily creates a single `AudioContext` (reused across calls). Requires a prior user gesture to unlock audio on mobile/WebView.

### Inline QTY Edit in Popup Table

In the popup table, `countedQty` is editable inline (`updatePopupQty`) when `systemQty > 100` AND status is `pending` or `scanning`. Editing is blocked for `pass`, `audit`, `audit_check`, and `stock_adjustment`.

### Product Master Col D Filter

In `loadProductMaster()`, rows where Col D (index 3) equals `P` or `REVIEW` (case-insensitive) are skipped.

### Clear Scan List vs Clear Data

The **✕ Clear** button calls `clearScanList()` which clears `scanListMap` + sets `_listCleared = true`. It does NOT reset `state.scanData`. To see data again, press **Cloud ☁️** (shows only `scanning`/`audit` items, excludes `pass`/`stock_adjustment`).

**`_listCleared` flag behavior:**
- `clearScanList()` → sets `_listCleared = true` → `onSnapshot` skips `rebuildScanListMap`/`renderScanList` (prevents list from reappearing)
- `appendScanRow()` → resets `_listCleared = false` (except startEmpty roles — see below)
- `pullFromCloud()` → resets `_listCleared = false` + rebuilds with `excludeStatuses = {pass, stock_adjustment}`

**RESULT starts empty (startEmpty roles):** `initAfterLogin()` sets `_listCleared = true` and clears `scanListMap` after restore for **WH PDA และ ผู้ช่วยเภสัช (assistant) PDA** — condition กลางคือ `window.innerWidth<=600 && (currentBranch==='WH' || currentRole==='assistant')`. `appendScanRow` บน startEmpty role เดียวกันนี้ **ไม่** reset `_listCleared` — `onSnapshot` จึงไม่ flood ของเก่ากลับ. ผลลัพธ์: เห็นเฉพาะสินค้าที่สแกนในรอบนี้ ไม่ต้องกด Clear เอง

> **เหตุผลที่รวม assistant:** เดิมผู้ช่วยเภสัชเปิดแอปกลับมาเห็นของ `pass`/`audit` ของตัวเองค้างเต็ม RESULT (filter assistant ใน `rebuildScanListMap` กรองแค่ `scannedBy` ไม่กรอง status) ต้องกด Clear ทุกครั้ง. เภสัช (pharmacist) **ไม่รวม** — ยังต้องเห็น audit worklist ตอนเปิดแอป

**Stale overnight scanning reset — `resetStaleScanningItems()`:** เรียกใน `initAfterLogin` หลัง `restoreFromFirestore()` แต่**ก่อน** `startScanSessionListener()`. วน `state.scanData` รีเซ็ต item ที่ `status==='scanning'` และ `sd.timestamp.substring(0,10) < วันนี้` (local date) กลับเป็น pending (countedQty=0, ฟิลด์เดียวกับ `removeScanItem`). บังคับนับใหม่สำหรับของที่สแกนค้างไว้ข้ามวัน (เผลอสแกน/ไปขายของแล้วไม่ Confirm).
- ถ้ามีการรีเซ็ต (n>0) → `saveSession()` + `await syncToFirestore(true)` ดันสถานะ pending ขึ้น cloud เป็น **authoritative ก่อน listener เริ่ม** — กัน `_applyCloudScanData` ดึง cloud scanning เก่ากลับมา resurrect (`syncToFirestore(false)` จะไม่ช่วยเพราะกฎ "local pending ไม่ overwrite cloud scanning")
- toast `♻️ รีเซ็ตของค้างข้ามวัน N รายการ` (เครื่องแรกที่ login เห็น, เครื่องอื่นเห็น cloud สะอาดแล้ว n=0)
- แตะเฉพาะ `scanning` — `pass`/`audit`/`stock_adjustment` (confirm แล้ว) ไม่ยุ่ง; ของที่สแกนวันนี้ (timestamp = วันนี้) ไม่ยุ่ง
- ⚠️ R01.102 re-upload **ไม่ได้** ล้างของค้าง (`rebuildMaps` เพิ่ม pending เฉพาะ SKU ใหม่ ไม่รีเซ็ตของเดิม) — กลไกที่ล้างของค้างจริงคือ `startNewCount` และ `resetStaleScanningItems` นี้เท่านั้น

**Login loader (visual mask) — barcode scan-line:** `initAfterLogin` แสดง overlay `#scanListLoading` (CSS `.sl-barcode` — แท่งบาร์โค้ด + เส้นเลเซอร์ accent กวาดขึ้นลง) คลุมพื้นที่ scan list ระหว่าง login. แสดงเมื่อ `_showLoader = _startEmpty || (currentRole==='pharmacist' && window.innerWidth>600)`:
- **startEmpty role** (WH PDA + assistant PDA) — กัน flash ของรายการเก่าก่อนถูก clear, ข้อความ "เตรียมข้อมูล..."
- **เภสัช Desktop** — โหลดสินค้า Audit จาก cloud (`restoreFromFirestore`) ใช้เวลา, ข้อความ "กำลังโหลดสินค้า Audit..." (set ผ่าน `.sl-loading-text`). **ไม่ใช่ startEmpty** จึงไม่ clear scan list — แค่ overlay ระหว่างรอโหลด

> ⚠️ **เภสัช login → ต้อง force rebuild scan list:** `initAfterLogin` เรียก `rebuildScanListMap(currentRole==='pharmacist')` — เพราะ `loadSession()`/`restoreFromFirestore()` restore `scanListMap` จาก localStorage/cloud (มี `pass` ปน) แล้ว `rebuildScanListMap()` ปกติติด guard `if(scanListMap.size>0)return` ไม่ได้กรองใหม่ → เภสัชจะเห็น pass ค้าง. force=true เคลียร์ก่อนแล้วกรอง audit-only (line `if(filterAudit&&sd.status!=='audit')continue;`)

เปิดด้วย `.classList.add('show')` ตอนต้น, ปิดใน `finally` (กันค้างถ้า error). เป็น UI-only — ไม่แตะ logic การสแกน/sync. animation ใช้ `transform:translate3d` + `will-change`/`translateZ(0)` เพื่อบังคับ GPU layer ให้ลื่นบน PDA (ห้ามใช้ `top` — trigger layout/paint = กระตุก)

To fully reset a scanned item, use the **✕** button on individual rows (`removeScanItem`), which resets that SKU's `scanData` entry back to `pending`.

**`removeScanItem(sku)` — full reset for re-scan:**
1. Resets `sd` fields: `countedQty=0`, `status='pending'`, `timestamp=''`, `barcode=''`, `scans=[]`, `scannedBy=''`, `auditor=''`, `auditStatus='pending'`. Deletes `soldQty`, `rawCountedQty`, `initialStatus`, `recheckQty`.
2. Cancels any in-flight scan: `clearTimeout(_scanDebounceTimer)`, resets `_lastKeystrokeTime`/`_pdaMode`, clears the `scanInput` field. This prevents a barcode that was injected by the PDA right before the user clicked ✕ from being auto-submitted via the 80 ms debounce after the reset.
3. Filters `scanQueue` to drop any pending entries that resolve to the same SKU (via `barcodeMap` or `skuDirectMap`).
4. Removes the DOM row immediately (`row.remove()`) instead of waiting for the 60 ms debounced render — prevents `patchScanRow()` from updating the stale row before the next render fires.
5. Toast: `"ลบแล้ว — สแกนใหม่เพื่อเริ่มนับ"` confirms the reset.

After `removeScanItem`, the SKU is fully clean — re-scanning starts `countedQty` from 0.

### Toast Notifications

Toasts appear center-screen with spring bounce animation (`@keyframes popIn`). Default duration: 2.5 s. Types: `info`, `success`, `warn`, `error`.

`toast(msg, type, ms)` — optional third parameter `ms` overrides the display duration (e.g. `toast('...', 'warn', 7000)` for a 7-second warning). Used for R16 date-mismatch warnings which need longer visibility.

**PDA toast override (`@media(max-width:600px)`):** Spring bounce is replaced with a lighter fade-slide animation to avoid jank on low-spec hardware:
```css
@keyframes toastFadePda { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }
.toast { animation: toastFadePda 0.2s ease-out !important; box-shadow: 0 2px 8px rgba(0,0,0,0.15) !important; border-radius: 10px !important; padding: 12px 20px !important; font-size: 0.85rem !important; }
```

### Responsive / Device Behaviour

- ≥820 px: two-column layout (left upload panel + center scan panel).
- ≤820 px: condensed column widths, reduced padding.
- ≤600 px (PDA/phone): single column, left panel hidden, Confirm button hidden. Page height is locked (`overflow:hidden`) and scan list body fills remaining height.
- Portrait orientation lock via `screen.orientation.lock('portrait')`.
- Scan input auto-refocuses on `visibilitychange` and on any click outside interactive elements — but skips refocus when any popup overlay is open (`stockPopupOverlay`, `historyStatsPopupOverlay`, `auditVerifyPopupOverlay`, `historyPopupOverlay`).

**PDA-specific UI (`@media(max-width:600px)`):**
- `.scan-header-bar` (SCAN title bar + help button) hidden (`display:none`)
- `#btnBranchChange` (Branch selector button) hidden
- `#pmStatusBadge` hidden
- Header buttons (Cloud ☁, ⚙ Settings, `#branchLabel`, `#userLabel`) shrunk to `padding:2px 7px`, `font-size:0.6rem`, `border-radius:5px`
- `#branchLabel` uses `inline-flex` + `align-items:center;justify-content:center` to keep text centered
- Scan list grid: `85px 1fr 52px 60px` (Barcode column hidden via `display:none`, Name col fills remaining space)
- Status label "⏳ รอยืนยัน" shortened to "⏳ รอ" on PDA (`window.innerWidth<=600` check in `getScanRowStyle()`)
- `#btnPdaAuditVerify` (🔍 icon + count badge) shown in header beside Cloud button — toggled by `updateAuditVerifyPanel` based on `window.innerWidth<=600 && canVerify` (replaces the `.left-panel` button hidden on PDA).
- **Audit Verify popup** (`#auditVerifyPopupOverlay`) PDA overrides:
  - `padding: 8px 4px !important` on the overlay (replaces 40px/16px)
  - `height: calc(100vh - 16px) !important` **and** `max-height: calc(100vh - 16px) !important` on `.stock-popup` — `height` forces full screen even when the table is empty (max-height alone only limits, so an empty popup would shrink to content and leave the bottom half of the overlay blank). Body section already uses `flex:1 + overflow-y:auto` to fill the remaining space.
  - Header padding compact `10px 14px`, h2 font 0.85rem
  - Footer padding compact `8px 14px`
  - Net: table scroll area ~503 px on a 360×640 PDA (vs ~395 px before), about 13 rows visible
- **Audit Verify popup** JS-controlled PDA changes (in `openAuditVerifyPopup` + `renderAuditVerifyTable`):
  - Tab row `#avTabRow` hidden (force Audit tab only — Stock Adj tab inaccessible from PDA)
  - Manual "สแกน" button `#avScanBtn` hidden (Broadcast Mode + Enter key handle it)
  - Table renders 3 columns only: `SKU` / `Name` / `Recheck` (vs 7 cols on Desktop) — Barcode column hidden on PDA เพื่อประหยัดพื้นที่
  - Empty-state cell uses `colspan="3"` on PDA / `7` on Desktop

**PDA WH — audit items: warehouse เห็น (worklist รีเช็ค), role อื่นซ่อน:** `rebuildScanListMap` filter ซ่อน audit เฉพาะเมื่อ `window.innerWidth<=600 && currentBranch==='WH' && currentRole!=='warehouse'` — **warehouse เห็น audit ทุกตัว**เพื่อรีเช็คในช่อง scan หลัก (ดู "WH recheck workflow"). สำหรับ role อื่นบน PDA WH ที่ยังซ่อน: `evaluatePendingScans` ลบออกจาก `scanListMap` (แทน upsert) เมื่อ item เป็น audit, และ `handleBarcode` (re-scan ของ SKU ที่ confirm แล้ว) ข้าม `appendScanRow` สำหรับ audit พร้อม toast `"สินค้านี้อยู่ใน Audit — เปิด Audit Verify popup เพื่อรีเช็ค"`. หมายเหตุ: warehouse จะไม่ตกเข้า path เหล่านี้เพราะ audit ของ warehouse ถูกดักที่ recheck branch ใน `handleBarcode` ก่อน (สะสม `sd.recheckQty`). Pharmacy branches และ Desktop unchanged.

## Firebase Config

The Firebase project credentials (`FIREBASE_CONFIG`) are hardcoded in `index.html`. The project is `stock-count-1d6e7`. Firestore is the only Firebase service used.

---

## Android App (PDA)

## ⚠️ กฎสำคัญ — แก้ Android ต้อง bump versionCode + version.json + push tag ทุกครั้ง

**ทุกครั้งที่แก้ไฟล์ใน `android-app/**` และต้องการสร้าง APK ใหม่ ต้องทำครบ 3 ขั้นตอนนี้พร้อมกัน:**
1. bump `versionCode` (+1) และ `versionName` ใน `android-app/app/build.gradle`
2. sync `version.json` ให้ตรง — `versionCode`, `versionName`, `downloadUrl`, `releaseNotes` (ภาษาไทย)
3. `git tag v<X.Y>` แล้ว `git push origin main --tags` → GitHub Actions build + Release อัตโนมัติ → PDA popup อัปเดต

**ถ้าขาดขั้นตอนใดขั้นตอนหนึ่ง:** PDA จะไม่รู้ว่ามี APK ใหม่ (version.json ไม่ตรง) หรือ GitHub ไม่สร้าง Release (ไม่มี tag)

---

WebView wrapper สำหรับ iTCAN IT68 PDA โหลด `https://anin-stock-count.vercel.app/` อยู่ใน `android-app/`

**ชื่อแอป:** `Anin Stock Count` — กำหนดใน `android-app/app/src/main/res/values/strings.xml` (`app_name`)

**App Icon:** PNG pre-composed (ไม่ใช่ vector/adaptive) — เปลี่ยนโดย replace ไฟล์ต่อไปนี้พร้อมกัน:
- `mipmap-mdpi/ic_launcher.png` (48px), `mipmap-hdpi` (72px), `mipmap-xhdpi` (96px), `mipmap-xxhdpi` (144px), `mipmap-xxxhdpi` (192px)
- `mipmap-*/ic_launcher_round.png` — ใช้รูปเดียวกัน
- `drawable/ic_launcher.png` (432px) — ใช้โดย adaptive icon XML สำหรับ Android 8+

Icon ปัจจุบัน: `Icon_StockCount.png` (อยู่ใน `C:\Users\Arm\Pictures\`)

เตรียมรูปต้นฉบับขนาด **1024×1024 px PNG** แล้ว resize ด้วย Python/Pillow:
```python
from PIL import Image
import os

src = r'C:\Users\Arm\Pictures\Icon_StockCount.png'
img = Image.open(src).convert("RGBA")

base = r'android-app\app\src\main\res'
sizes = [
    (os.path.join(base, 'mipmap-mdpi'),    48),
    (os.path.join(base, 'mipmap-hdpi'),    72),
    (os.path.join(base, 'mipmap-xhdpi'),   96),
    (os.path.join(base, 'mipmap-xxhdpi'),  144),
    (os.path.join(base, 'mipmap-xxxhdpi'), 192),
    (os.path.join(base, 'drawable'),       432),
]
for folder, px in sizes:
    resized = img.resize((px, px), Image.LANCZOS)
    for name in ['ic_launcher.png', 'ic_launcher_round.png']:
        resized.save(os.path.join(folder, name), 'PNG')
```

### Build

GitHub Actions build อัตโนมัติทุกครั้งที่ push ไปที่ `main` (path `android-app/**`):
- ดาวน์โหลด APK ได้จาก Actions → Artifacts → `StockCountPDA-N.apk`
- push tag `v*` (เช่น `v1.2`) → สร้าง GitHub Release พร้อม APK แนบ

**Workflow:** `.github/workflows/build-apk.yml`
- ใช้ `gradle/actions/setup-gradle@v3` + `gradle wrapper` (ไม่ commit gradlew JAR)
- rename APK เป็น `StockCountPDA.apk` (ตรงกับ `downloadUrl` ใน `version.json`)

### Signing Keystore

`android-app/app/stockcount.keystore` — committed ใน repo เพื่อให้ทุก build ใช้ signature เดิม

- storePassword / keyPassword: `stockcount123`
- keyAlias: `stockcount`
- ทั้ง debug และ release build ใช้ keystore นี้ผ่าน `signingConfig` ใน `app/build.gradle`

**สำคัญ:** ห้ามลบหรือสร้าง keystore ใหม่ — จะทำให้ PDA ที่ติดตั้งอยู่อัปเดตไม่ได้ (signature mismatch)

### Self-Update System

1. `version.json` (root, served by Vercel) เก็บ `versionCode`, `versionName`, `downloadUrl`, `releaseNotes`
2. `MainActivity.checkForUpdate()` fetch `version.json` เมื่อเปิดแอป เปรียบเทียบกับ `BuildConfig.VERSION_CODE`
3. ถ้า remote > local → แสดง dialog → ดาวน์โหลดผ่าน `DownloadManager` → ติดตั้งผ่าน `FileProvider`

**เมื่อ release APK ใหม่:**
1. bump `versionCode` ใน `android-app/app/build.gradle`
2. อัปเดต `version.json` ให้ตรงกัน (ทั้ง `versionCode`, `versionName`, `releaseNotes` ภาษาไทย)
3. push tag `v*` → GitHub Release → PDA จะ popup อัปเดตอัตโนมัติ

> ⚠️ **กฎสำหรับ Codex — Bump APK เฉพาะเมื่อแก้ native Android เท่านั้น:**
>
> APK เป็นแค่ WebView wrapper ที่โหลด `https://anin-stock-count.vercel.app/` (ดู `MainActivity.kt` const `WEB_URL`) — **โค้ดเว็บไม่ได้ติดอยู่ใน APK** การแก้ `index.html` ไป Vercel auto-deploy + Service Worker auto-update ของ PWA pushed ให้ PDA reload เอง ไม่ต้องสร้าง APK ใหม่
>
> **bump versionCode + push tag `v*` เมื่อแก้สิ่งเหล่านี้เท่านั้น:**
> - `android-app/app/src/**` (MainActivity, SettingsActivity, BroadcastReceiver, Kotlin/Java)
> - `android-app/app/src/main/AndroidManifest.xml` (permissions, intents)
> - `android-app/app/build.gradle` (dependencies, SDK versions, signing)
> - `android-app/app/src/main/res/**` (icons, drawables, strings, styles ที่ใช้ใน native UI)
> - `.github/workflows/build-apk.yml` (ถ้ากระทบผลลัพธ์การ build)
>
> **ไม่ bump** เมื่อแก้:
> - `index.html`, `sw.js`, `libs/**`, `manifest.json`, ไฟล์เว็บอื่นๆ — Vercel + Service Worker คุมเอง
> - `AGENTS.md`, `WORKFLOW.md`, `README.md`, `APK.md` — docs ล้วน ไม่กระทบ runtime
> - `.gitignore`, workflow ที่ไม่กระทบ build, การจัดระเบียบไฟล์
>
> **ขั้นตอน bump เมื่อจำเป็น:**
> 1. bump `versionCode` (+1) และ `versionName` (เช่น 1.5 → 1.6) ใน `android-app/app/build.gradle`
> 2. sync `version.json` ให้ตรง — เขียน `releaseNotes` ภาษาไทยสรุปการเปลี่ยนแปลง
> 3. commit ก้อนเดียวด้วยข้อความ `chore: bump to v<X.Y> (versionCode <N>) for <reason>`
> 4. `git tag v<X.Y>` แล้ว `git push origin main --tags`
> 5. แจ้ง user ว่า GitHub Actions จะ build APK + สร้าง Release อัตโนมัติใน ~3–5 นาที และ PDA จะเด้ง popup อัปเดต

### Scanner Integration — Intent Broadcast Mode

**วิธีที่ใช้งาน (เร็วที่สุด):** Intent Broadcast — scanner ส่ง barcode ทั้งก้อนเป็น Intent ครั้งเดียว

**ค่า default (iTCAN IT68 / KTE scanner):**
- Intent Action: `com.kte.scan.result`
- Extra Key: `code`

**ตั้งค่าบน PDA:** Scanner Settings → Data Output Mode → **Broadcast Mode** → Broadcast Action: `com.kte.scan.result`

**Flow:** Scanner → `BroadcastReceiver` (MainActivity) → `injectBarcode()` → `evaluateJavascript("receiveBarcode('...')")` → Web App

**`receiveBarcode` (index.html) routes by which popup is open:**
- If `#auditVerifyPopupOverlay` is visible (`display === 'flex'`) → write barcode to `#auditVerifyScanInput` and dispatch Enter → `handleAuditVerifyScan` accumulates into `_avMap` (verify flow).
- Otherwise → write to `#scanInput` and dispatch Enter → main scan flow.

This makes the Audit Verify popup usable with Broadcast Mode on PDA. Without the routing, every scan would silently fall into the main scan flow even while the popup was open.

`BroadcastReceiver` ลงทะเบียนใน `onResume` / unregister ใน `onPause` รองรับ fallback actions หลายยี่ห้อ:
- `com.kte.scan.result` (KTE / iTCAN IT68) ← **ค่า default**
- `com.android.server.scannerservice.broadcast`
- `nlscan.action.SCANNER_RESULT` (Newland)
- `com.urovo.i9000s.action` (Urovo)
- `scan.rcv.message` (Chainway)
- `android.intent.action.DECODE_DATA`

Fallback extra keys ลองตามลำดับ: `barcode_string`, `data`, `SCAN_BARCODE_1`, `scanResult`, `scannerdata`, `com.symbol.datawedge.data_string`, `decode_data`, `barcodeData`, `code`

### Settings Activity

เข้าได้จาก ⚙ (มุมขวาบน) — ตั้งค่า Intent Action / Extra Key โดยไม่ต้อง rebuild APK

- **Preset buttons:** KTE (iTCAN IT68), iTCAN/Generic, Newland, Honeywell, Zebra DataWedge ฯลฯ
- **ปุ่มทดสอบ:** ส่ง broadcast ทดสอบ barcode `8851111000429` เพื่อยืนยันว่า MainActivity รับได้
- บันทึกใน `SharedPreferences` key `ScannerPrefs`

### การแก้ปัญหาสแกน Barcode

#### ปัญหา 1 — barcode ต่อกัน (concatenation)
**อาการ:** สแกน 2 ครั้งติดกัน ได้ barcode เดียวที่ยาวผิดปกติ เช่น `49871760034854987176003485`

**สาเหตุ:** Keyboard Wedge ส่งตัวอักษรทีละตัว ถ้า `PDA_KEYSTROKE_THRESHOLD_MS` ต่ำเกินไป แอปจะมองว่าอักขระแรกของ barcode ที่ 2 ยังเป็นส่วนของ barcode แรก

**แก้:** เพิ่ม threshold จาก 50ms → 150ms และเพิ่ม fallback debounce 350ms สำหรับ input ≥ 6 ตัวอักษรในกรณี non-PDA mode

```javascript
const PDA_KEYSTROKE_THRESHOLD_MS = 150;  // ช่วงเวลา keystroke ที่ถือว่าเป็น PDA scan
const SCAN_DEBOUNCE_MS = 80;             // debounce หลัง keystroke สุดท้าย
// fallback debounce ใน handleScanInput:
} else if (e.target.value.trim().length >= 6) {
  _scanDebounceTimer = setTimeout(() => { processScan(); }, 350);
}
```

**วิธีที่ดีกว่า (ไม่มีปัญหานี้เลย):** เปลี่ยนไปใช้ **Intent Broadcast Mode** — barcode ส่งมาทั้งก้อนในครั้งเดียว ไม่มีการพิมพ์ทีละตัว

---

#### ปัญหา 2 — barcode แสดงทีละตัว (digits appear one by one)
**อาการ:** ระหว่างที่ Scanner กำลังส่งตัวอักษร เห็น `4`, `49`, `498`... ขึ้นในช่อง input ทีละตัว

**แก้:** CSS class `pda-receiving` ซ่อน text ให้โปร่งใสระหว่างที่รับ barcode

```css
.scan-input.pda-receiving { color: transparent; caret-color: transparent; }
```
```javascript
// handleScanInput: ใส่ class เมื่อ PDA mode
if (_pdaMode) { e.target.classList.add('pda-receiving'); }
// processScan / resetScanRuntimeState: เอา class ออก
inp.classList.remove('pda-receiving');
```

**หมายเหตุ:** ปัญหานี้ไม่เกิดใน Intent Broadcast Mode (barcode ไม่ผ่าน input field)

---

#### ปัญหา 3 — scan list กระตุก / แสดงช้า (jank)
**อาการ:** หลังสแกน รายการใหม่ขึ้นช้า หรือหน้าจอกระตุกทุกครั้งที่สแกน

**แก้ 3 จุด:**

1. **ลด animation** — เดิม animate ทุก `.scan-row` → เปลี่ยนเป็น animate เฉพาะ `:first-child` (แถวล่าสุด)
```css
.scan-row { contain: layout style; }          /* ไม่ animate ทุกแถว */
.scan-row:first-child { animation: rowSlide 0.15s ease; } /* เฉพาะแถวใหม่ */
```

2. **ลดจำนวนแถวใน scan list** — `SCAN_LIST_MAX` 100 → 30 (render น้อยลง)

3. **GPU acceleration ใน WebView** — เพิ่มใน `MainActivity.setupWebView()`:
```kotlin
webView.setLayerType(View.LAYER_TYPE_HARDWARE, null)
```

---

#### สรุป: วิธีที่แก้ได้ทุกปัญหาพร้อมกัน
เปลี่ยน Scanner Output Mode เป็น **Broadcast Mode** (ไม่ใช่ Keyboard Simulate):
- barcode ส่งมาทั้งก้อนเป็น Intent → ไม่มี concatenation, ไม่มีตัวอักษรทีละตัว
- ความเร็วเทียบเท่า native scanner app (~60ms)
- ตั้งค่าบน iTCAN IT68: Scanner Settings → Data Output Mode → Broadcast Mode

### WakeLock

`MainActivity` acquire `SCREEN_BRIGHT_WAKE_LOCK` ใน `onResume` / release ใน `onPause`
— หน้าจอไม่หรี่หรือล็อคระหว่างนับสินค้า (สูงสุด 4 ชั่วโมง)

### Key Files

| ไฟล์ | หน้าที่ |
|---|---|
| `android-app/app/src/main/java/.../MainActivity.kt` | WebView, BroadcastReceiver, WakeLock, self-update |
| `android-app/app/src/main/java/.../SettingsActivity.kt` | ตั้งค่า Intent Action/Key, preset buttons |
| `android-app/app/build.gradle` | versionCode, signingConfig |
| `android-app/app/stockcount.keystore` | signing key (ห้ามลบ) |
| `version.json` | update manifest (served by Vercel) |
| `.github/workflows/build-apk.yml` | CI build + GitHub Release |

---

## คู่มือผู้ใช้งาน (User Manuals)

ไฟล์ HTML standalone — เปิดในเบราว์เซอร์ได้เลย รองรับการพิมพ์ (print-friendly CSS)

| ไฟล์ | กลุ่มเป้าหมาย | เนื้อหา |
|---|---|---|
| `คู่มือการใช้งาน.html` | ทุก role (ภาพรวม) | ครอบคลุมทุก role ในไฟล์เดียว — login, สแกน, Confirm, Audit Verify, WH recheck, Export, ตารางสถานะ, ปัญหาที่พบบ่อย |
| `คู่มือ-สาขา.html` | ผู้ช่วยเภสัช + เภสัช (SRC/KKL/SSS) | เฉพาะ workflow ร้านยา — ผู้ช่วยสแกน → เภสัช Confirm → เภสัช Audit Verify → Export |
| `คู่มือ-คลัง.html` | พนักงานคลัง + หัวหน้างาน (WH) | เฉพาะ workflow คลังกลาง — ภาพรวม PDA/Desktop, นับครั้งแรก, Confirm, รีเช็ค Audit, ยืนยันรีเช็ค, Export |

**หมายเหตุสำหรับ Codex:** ไฟล์คู่มือเหล่านี้เป็น standalone HTML ไม่ได้ import หรือ link กับ `index.html` — แก้ไขได้อิสระโดยไม่กระทบระบบหลัก ไม่ต้อง bump APK เมื่อแก้ไฟล์เหล่านี้
