# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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
  skuMap,      // SKU → { productName, systemQty, barcodes[], isDel }
  barcodeMap,  // barcode → SKU
  skuDirectMap,// SKU → { barcode, unitName } (smallest-unit barcode)
  scanData,    // Map<SKU, { countedQty, status, timestamp, scannedBy, auditor, recheckQty, initialStatus, ... }>
  unknownScans // items scanned but not in system
}
```

`scanListMap` is a separate `Map` used only for rendering the live scan list UI (last 100 entries). It is rebuilt from `state.scanData` via `rebuildScanListMap()`.

### Data Flow

1. **Upload files** → `loadR01()` / `loadR05()` / `loadProductMaster()` → `rebuildMaps()` builds `skuMap`, `barcodeMap`, `skuDirectMap` and initialises `scanData` with `pending` entries for every known SKU.

2. **Scan** → `handleBarcode()` → looks up in `barcodeMap` first, then `skuDirectMap` (for SKU direct scan) → accumulates `countedQty` in `state.scanData`; status set to `scanning`. Sets `sd.scannedBy = currentUser`.

3. **Upload R16.104** → `loadR16()` → builds `r16SalesMap` + `r16RawMap` (sales: ORCM/OCTM) and `r16InboundMap` + `r16InboundRawMap` (inbound: OTFB/ORTS/OTFI) for time-filtered adjustment. After loading, automatically calls `reEvaluateAuditItems()` if matched > 0, and shows a date-mismatch warning if R16 TRANDATE dates don't overlap with scan dates.

4. **Confirm** → `evaluatePendingScans()` → for each `scanning` item: `effectiveCnt = countedQty + getSoldQtyBefore(sku, timestamp) - getInboundQtyBefore(sku, timestamp)`, compare with `systemQty` → set `pass` or `audit`. Sets `sd.initialStatus` on first evaluation (never overwritten).

5. **Audit resolution** → pharmacist opens Audit Verify panel → scans in dedicated input → clicks **ยืนยันทั้งหมด** → status changes to `pass` or `stock_adjustment`.

### Status Lifecycle

```
pending → scanning → pass
                   → audit → (pharmacist verify pass)  → pass
                           → (pharmacist verify fail)  → stock_adjustment
```
`unknown` is a parallel track for barcodes not found in any reference file.

`audit_check` still exists in the codebase for compatibility but is no longer produced by the re-audit flow.

**Stat card — Audit:**
- Large number: items still at `audit` (waiting for pharmacist).
- Progress bar: pharmacist-checked items / total audit items ever flagged.
- `auditGot` counts: `audit_check` + `stock_adjustment` + items where `sd.auditor && sd.status === 'pass'`
- `auditTotal` counts: all items that ever had `initialStatus === 'audit'` plus `audit_check`/`stock_adjustment`

### Auto-Update (Service Worker)

When a new version is deployed, the Service Worker (`sw.js`) installs immediately via `skipWaiting()`. On `controllerchange`:
1. Current `currentUser` + `currentRole` are saved to `sessionStorage` (`_autoUpdateUser`, `_autoUpdateRole`, `_autoUpdate` flag).
2. A brief blue banner "🔄 กำลังอัพเดทเวอร์ชันใหม่..." appears for 1.5 s then `window.location.reload()`.
3. On `DOMContentLoaded` after reload: if `_autoUpdate` flag is set **and** `currentBranch` + user are known, skip branch selector / PIN modal / employee selector entirely and call `initAfterLogin()` directly.
4. If flag is set but user was not logged in (e.g. update fired during branch selection), falls back to normal `showBranchSelector()` flow.

### Branch / Auth System

Three branches: **SRC**, **KKL**, **SSS**. Each has its own localStorage key (`stockCountSession_${branch}`) and separate Firestore namespace.

- Branch PINs are hardcoded in `BRANCH_PINS` object.
- Admin PIN `22190` / `CLEAR_PIN` enables admin mode: bypasses time gates for R01.102 and R16.104, shows hidden upload panels (Product Master, R05), **disables Firestore sync** (local only), and shows the **🗑️ ล้างข้อมูลทั้งหมด** button.

### Time Gates

| Feature | Allowed window | Admin bypass |
|---|---|---|
| R01.102 upload | After 21:00 | ✓ |
| R16.104 upload | 08:00 – 21:29 | ✓ |
| Scan (all roles) | 08:00 – 20:59 | ✗ |

- R01.102 gate: `getHours() < 21` → blocked.
- R16.104 gate: `getHours() < 8 \|\| getHours() > 21 \|\| (getHours() === 21 && getMinutes() >= 30)` → blocked.
- Scan gate: checked in `processScan()` — `getHours() < 8 \|\| getHours() >= 21` → blocked, clears input and shows toast.
- **🗑️ ล้างข้อมูลทั้งหมด** is only accessible in Admin mode (button hidden otherwise, function guarded by `_adminMode` check).

### Employee Profile System

After branch PIN is verified, an employee selector modal appears. Two roles:

| Role | Branches / Names |
|---|---|
| **เภสัช** (pharmacist) | SRC: เภอ๊อฟ / KKL: เภออด / SSS: เภเบส |
| **ผู้ช่วยเภสัช** (assistant) | SRC: ก้า, กิฟ, สุ่ย, นิกกี้ / KKL: แตงโม, ทราย / SSS: ออย, ฟ้าใส |

Profiles are defined in `EMPLOYEE_PROFILES` constant. Selected employee is stored in `currentUser` (string) and `currentRole` (`'pharmacist'` | `'assistant'`). The header displays the active user. On branch switch, `currentUser`/`currentRole` are cleared and the selector re-appears.

**Pharmacist re-audit flow** (`openAuditVerifyPopup`, `handleAuditVerifyScan`, `confirmAllAuditVerify`):
1. Pharmacist opens **Audit Verify** panel (visible to all roles; button disabled for non-pharmacist with 🔒 message).
2. Pharmacist scans barcode(s) in the dedicated scan input; `_avMap: Map<SKU, number>` accumulates qty.
3. On **ยืนยันทั้งหมด** (footer button): for each SKU in `_avMap`:
   - `pharmacistQty === systemQty` → `status: 'pass'`
   - `pharmacistQty !== systemQty` → `status: 'stock_adjustment'`
4. Saves `sd.recheckQty`, `sd.auditor = currentUser`, `sd.timestamp` = pharmacist's verification time.
5. OS Web Notification fires on confirm.

### Persistence Layers

| Layer | Key/Path | When written |
|---|---|---|
| localStorage | `stockCountSession_${branch}` | Every `saveSession()`, debounced 400 ms |
| Firestore `stock_sessions/${branch}` | Scan data | 3 s after localStorage write |
| Firestore `stock_sessions/${branch}_r01/r05` | R01/R05 master data | After file upload |
| Firestore `stock_sessions/global_pm` | Product Master | After PM upload; real-time listener on all devices |
| Firestore `stock_history/${branch}_${date}` | Historical count records | On "เริ่มนับใหม่" |
| Firestore `stock_audit_log/${branch}_${date}` | Audit items log | After `evaluatePendingScans()` + after pharmacist verify |
| JSON file (download) | backup | On "Backup" button |

`global_pm` is **shared across all branches** with an `onSnapshot` real-time listener (`startProductMasterListener()`). All other data is per-branch.

**Persisted fields in scanData:** `scannedBy`, `auditor`, `recheckQty`, `initialStatus` are all persisted (not stripped). Only `retries` and `scans` are stripped on save.

### Cloud Sync — `pullFromCloud()`

ปุ่ม **Cloud** ในหัว (บรรทัด 336) เรียก `pullFromCloud()` เพื่อดึงข้อมูลจาก Firestore มา merge กับ local

**Merge rules:**
- ดึงเฉพาะ cloud item ที่ `status === 'pending'` หรือ `'scanning'` เท่านั้น — item ที่ Confirm แล้ว (`pass`, `audit`, `stock_adjustment`) ใน cloud จะถูกข้าม
- ถ้า local item นั้น Confirm แล้ว (`sd.auditor` set หรือ status เป็น `pass`/`audit`/`stock_adjustment`) → ไม่ overwrite
- `unknownScans` จาก cloud merge เข้า local โดยเพิ่มเฉพาะ barcode ที่ยังไม่มี
- **local item ที่เป็น `scanning`/`pending` แต่ไม่มีใน cloud อีกต่อไป → ลบออกจาก local** (กรณี `startNewCount` จากเครื่องอื่น)

ใช้สำหรับ: หลายเครื่องนับพร้อมกัน แต่ละเครื่อง sync ขึ้น cloud แล้วเครื่องอื่นกด Cloud เพื่อดึง pending/scanning ของทุกเครื่องมารวม

**Workflow หลัง `startNewCount`:** กด startNewCount บนเครื่องหลัก → PDA ทุกเครื่องกดปุ่ม **Cloud 1 ครั้ง** → รายการเก่าถูกล้าง → สแกนได้เลย ไม่ต้องกด Cloud อีก

### Cloud Sync — `syncToFirestore()`

`syncToFirestore(overwrite=false)` ถูกเรียกอัตโนมัติ 3 วินาทีหลัง `saveSession()` ทุกครั้ง

**Merge rules (overwrite=false):**
- ดึง cloud state มา merge ก่อน แล้วค่อย overwrite ด้วย local
- local item ที่เป็น `pending` จะไม่ overwrite cloud item ที่มี status อื่น (เพื่อไม่ reset สิ่งที่เครื่องอื่นสแกนแล้ว)
- **local item ที่เป็น `scanning`/`pending` แต่ไม่มีใน cloud → ไม่ re-upload** (ป้องกัน PDA เขียนข้อมูลเก่ากลับหลัง `startNewCount`)

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
- **R01.102**: Col E (index 4)=SKU, F (5)=ProductName, G (6)=SystemQty; rows with qty≤0 are skipped. Re-uploading clears previous data (`state.r01Data = []` first) and resets all scanData to pending.
- **R05.106**: Col A (0)=Barcode, E (4)=SKU, G (6)=unitName, H (7)=unitMultiplier.
- **R16.104**: Col C (2) กำหนดประเภทเอกสาร — กรองเฉพาะ 5 ประเภทนี้ ที่เหลือข้ามทั้งหมด:

  | Col C prefix | ประเภท | ผลต่อ effectiveCnt |
  |---|---|---|
  | `ORCM`, `OCTM` | ยอดขาย (Sales) | หักออก → บวกกลับเข้า countedQty (`r16SalesMap`) |
  | `OTFB`, `ORTS`, `OTFI` | รับเข้าคลัง (Inbound) | บวกเพิ่ม → หักออกจาก countedQty (`r16InboundMap`) |

  Col O (14)=Barcode; Col R (17)=BASEQUANTITY (แปลงเป็นหน่วยเล็กสุดแล้ว); Col X (23)=SKU; TRANDATE column auto-detected from header row (row 0).

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

`handleScanInput()` detects PDA scanner vs manual typing based on inter-keystroke timing (`PDA_KEYSTROKE_THRESHOLD_MS = 50 ms`):

- **PDA mode** — when a keystroke arrives within 50 ms of the previous one, `_pdaMode = true`. The 200 ms debounce (`SCAN_DEBOUNCE_MS`) auto-submits 200 ms after the last keystroke. This handles PDA scanners that don't send Enter.
- **Manual mode** — keystrokes ≥ 50 ms apart keep `_pdaMode = false`. **No auto-submit** — the user must press **Enter** or click the **⏎ submit button**. This prevents premature submission when typing barcodes by hand.
- The first keystroke can't be classified (no previous timestamp), so detection happens on the second keystroke. Once `_pdaMode = true`, it stays true until the scan is processed (then resets to `false`).
- 200 ms is safely wider than a full PDA scan (~20–50 ms total) but shorter than the minimum gap between two physical scans (~500 ms+), preventing concatenation.
- If Enter or `\r\n` arrives first, the debounce timer is cancelled and `processScan()` fires immediately.

**Manual submit button (⏎)** is rendered next to the scan input and calls `submitScanManual()`, which clears the debounce/PDA state and runs `processScan()`. It exists as a device-agnostic fallback when keyboard `keydown` events don't fire reliably (some Android/PDA browsers).

**Enter key fallback:** `handleScanKey()` accepts `e.key === 'Enter'`, `e.keyCode === 13`, or `e.which === 13` to cover older browsers and PDA devices that don't expose modern `e.key`.

State variables: `_lastKeystrokeTime` and `_pdaMode` are reset in `resetScanRuntimeState()`, `handleScanKey()` (on Enter), the debounce callback, the `\r\n` shortcut path, and `removeScanItem()`.

### Rendering

- All renders are debounced (80 ms for popup table, 60 ms for scan list, 400 ms for save).
- Scan list renders last **100** entries (`SCAN_LIST_MAX`).
- Popup table renders at most **500** rows (`POPUP_MAX_RENDER_ROWS`).
- `popupBaseRowsCache` caches the full popup row list; invalidated by `invalidatePopupRowsCache()` on any state change. Call this whenever `state.scanData` or `state.unknownScans` changes.
- `patchScanRow(key)` does targeted in-place DOM update for a single row without full re-render; used during batch scans.

### DEL Items

When both Product Master and R01 are loaded, SKUs present in R01 but absent from Product Master are flagged `isDel: true` in `skuMap`. They are shown in the popup table with a red **DEL** badge and are selectable via the **🗑️ DEL** filter button in the popup toolbar. They participate in scanning and evaluation normally. DEL items also appear in History Stats tabs (no filtering).

### Column Resizing

The scan list header columns are drag-resizable via `initColResize()`. Widths are stored in `_colWidths` (5 elements: `[98, 120, 0, 88, 128]`) and applied via `applyColWidths()` which sets `grid-template-columns` on every `.scan-list-header` and `.scan-row` element. The name column (index 2) is computed as the remaining space (`1fr`).

Scan list columns (5 total): **SKU** / **Barcode** / **Product Name** / **Qty** / **Status**. There is no separate remove-button column — the ✕ button (`btn-remove-sku`) is embedded inside the SKU cell as a flex child, visible only when `status === 'scanning'`.

### History Feature (📅 ประวัติ)

"📅 ประวัติ" button opens a history popup (`openHistoryPopup`). It reads `stockCountHistory_${branch}` from localStorage (up to 60 entries). Each entry is created by "เริ่มนับใหม่" and saved to `stock_history/${branch}_${date}` in Firestore. The popup has a date selector, renders the historical scan table, and supports Export Excel (`exportHistoryExcel`) — output: `history_${branch}_${date}.xlsx`.

### History Stats Panel (📊 ประวัติการนับ)

Panel card visible to **all roles** after login. Opens `openHistoryStatsPopup()`. Has 4 tabs:

| Tab | เนื้อหา |
|---|---|
| 👥 ผู้ช่วยนับครั้งแรก | SKU ที่ `initialStatus === 'audit'` — โหลดจาก local state หรือ Firestore `stock_audit_log` |
| 🧑‍⚕️ เภสัชตรวจ | SKU ที่มี `sd.auditor` (เภสัชตรวจแล้ว) |
| 🔴 Stock Adj ทั้งหมด | SKU ที่ `status === 'stock_adjustment'` พร้อมปุ่ม Export Excel |
| 📂 อัพโหลดใบนับสินค้า | upload CSV/Excel เพื่อเปรียบเทียบ |

**Stock Adj columns:** # / SKU / Barcode / Product Name / หน่วย / จำนวนคงเหลือ (systemQty) / จำนวนปรับปรุง (recheckQty) / Diff (systemQty − recheckQty, บวก=ขาด/แดง, ลบ=เกิน/เขียว)

`_hsFirestoreItems`: `null`=ยังไม่โหลด, `[]`=โหลดแล้วไม่มีข้อมูล, `[...]`=มีข้อมูล

**Firestore Audit Log** (`stock_audit_log/${branch}_${date}`):
- บันทึกโดย `saveAuditLogToFirestore()` หลัง Confirm และหลัง pharmacist verify
- โหลดโดย `loadAuditLogFromFirestore()` เมื่อ local state ว่างเปล่า
- เก็บเฉพาะ items ที่ `initialStatus === 'audit'`

### Audit Verify Panel (เภสัชเท่านั้นกด)

Panel card แสดงให้ **ทุก role** เห็น แต่ปุ่มจะ disabled (เทา + 🔒 ข้อความ) สำหรับผู้ช่วย — กดได้เฉพาะ `currentRole === 'pharmacist'`

**Popup has two filter tabs:**

**⚠️ Audit tab** — shows items with `status === 'audit'`:
- Columns: `#` / `SKU` / `Barcode` / `Product Name` / `Count Qty` (assistant's count) / `Recheck` (pharmacist's accumulated scan) / `Status` / `Timestamp` / ปุ่ม `✓ ยืนยัน` per row
- Pharmacist scans barcode in the scan input (`handleAuditVerifyScan`) → accumulates qty in `_avMap: Map<SKU, number>`
- Footer: **ยืนยันทั้งหมด** button (`confirmAllAuditVerify`) — confirms all items in `_avMap` at once, fires OS Web Notification
- On confirm per item (`confirmAuditVerifyItem`):
  - `pharmacistQty === systemQty` → `status: 'pass'`
  - `pharmacistQty !== systemQty` → `status: 'stock_adjustment'`
  - Saves `sd.recheckQty`, `sd.auditor = currentUser`, `sd.timestamp` = pharmacist's time

**🔴 Stock Adj tab** — shows items with `status === 'stock_adjustment'`:
- Columns: `#` / `SKU` / `Barcode` / `Product Name` / `Sys Qty` / `Recheck Qty` / `Diff` / `เวลาที่เช็คล่าสุด`
- Diff = `recheckQty − systemQty`: negative=ขาด/แดง, positive=เกิน/เขียว (opposite sign from History Stats)
- Read-only view

`_avFilter` (`'audit'` | `'stock_adj'`) controls which tab is active. Resets to `'audit'` every time the popup is opened.

### Export Excel

| ปุ่ม | ฟังก์ชัน | เนื้อหา | ไฟล์ |
|---|---|---|---|
| ⬇️ Export Excel (popup รายการสต็อก) | `exportExcel()` | audit + stock_adj เท่านั้น | `audit_${date}.xlsx` |
| ⬇️ Export Excel (popup ประวัติ) | `exportHistoryExcel()` | ประวัติวันที่เลือก | `history_${branch}_${date}.xlsx` |
| ⬇️ Export Excel (History Stats > Stock Adj) | `exportStockAdjExcel()` | stock_adj ปัจจุบัน พร้อม Diff | `stockadj_${branch}_${date}.xlsx` |

### Scan List QTY Masking

QTY column behavior in the live scan list depends on status and `systemQty`:

| Status | Condition | Displays |
|---|---|---|
| `scanning` | `systemQty > 100` | Inline editable `<input>` (calls `updateInlineQty`) |
| `scanning` | `systemQty ≤ 100` | Actual `countedQty` (bold) |
| `unknown` | — | Actual `countedQty` (bold) — always shown |
| other (`pass`, `audit`, etc.) | `countedQty > 100` | Number (re-check warning) |
| other | `countedQty ≤ 100` | Empty — intentionally hidden to prevent counter bias |

The inline input threshold changed from `countedQty > 100` → `systemQty > 100` (commit `b7cd9e7`).

This applies to both `renderScanList()` (full re-render) and `patchScanRow()` (in-place patch).

### 2-Minute Scan Gap Reset

In `handleBarcode()`, if the same SKU is scanned again after more than 2 minutes since its last `timestamp`, a `scanGapModal` is shown requiring confirmation before continuing.

On confirm (`confirmScanGap()`): `countedQty` is reset to **0** and `sd.scans` is cleared. The barcode that triggered the gap is **not** counted — the user is expected to rescan from scratch. The modal displays "นับเดิม → 0" to make this clear.

### Inline QTY Edit in Popup Table

In the popup table, `countedQty` is editable inline (`updatePopupQty`) when `systemQty > 100` AND status is `pending` or `scanning`. Editing is blocked for `pass`, `audit`, `audit_check`, and `stock_adjustment`.

### Product Master Col D Filter

In `loadProductMaster()`, rows where Col D (index 3) equals `P` or `REVIEW` (case-insensitive) are skipped.

### Clear Scan List vs Clear Data

The **✕ Clear** button calls `clearScanList()` which only clears `scanListMap` (the live scan list UI). It does NOT reset `state.scanData`. To fully reset a scanned item, use the **✕** button on individual rows (`removeScanItem`), which resets that SKU's `scanData` entry back to `pending`.

**`removeScanItem(sku)` — full reset for re-scan:**
1. Resets `sd` fields: `countedQty=0`, `status='pending'`, `timestamp=''`, `barcode=''`, `scans=[]`, `scannedBy=''`, `auditor=''`, `auditStatus='pending'`. Deletes `soldQty`, `rawCountedQty`, `initialStatus`, `recheckQty`.
2. Cancels any in-flight scan: `clearTimeout(_scanDebounceTimer)`, resets `_lastKeystrokeTime`/`_pdaMode`, clears the `scanInput` field. This prevents a barcode that was injected by the PDA right before the user clicked ✕ from being auto-submitted via the 200 ms debounce after the reset.
3. Filters `scanQueue` to drop any pending entries that resolve to the same SKU (via `barcodeMap` or `skuDirectMap`).
4. Removes the DOM row immediately (`row.remove()`) instead of waiting for the 60 ms debounced render — prevents `patchScanRow()` from updating the stale row before the next render fires.
5. Toast: `"ลบแล้ว — สแกนใหม่เพื่อเริ่มนับ"` confirms the reset.

After `removeScanItem`, the SKU is fully clean — re-scanning starts `countedQty` from 0.

### Toast Notifications

Toasts appear center-screen with spring bounce animation (`@keyframes popIn`). Default duration: 2.5 s. Types: `info`, `success`, `warn`, `error`.

`toast(msg, type, ms)` — optional third parameter `ms` overrides the display duration (e.g. `toast('...', 'warn', 7000)` for a 7-second warning). Used for R16 date-mismatch warnings which need longer visibility.

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

## Firebase Config

The Firebase project credentials (`FIREBASE_CONFIG`) are hardcoded in `index.html`. The project is `stock-count-1d6e7`. Firestore is the only Firebase service used.

---

## Android App (PDA)

WebView wrapper สำหรับ iTCAN IT68 PDA โหลด `https://anin-stock-count.vercel.app/` อยู่ใน `android-app/`

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
2. อัปเดต `version.json` ให้ตรงกัน
3. push tag `v*` → GitHub Release → PDA จะ popup อัปเดตอัตโนมัติ

### Scanner Integration — Intent Broadcast Mode

**วิธีที่ใช้งาน (เร็วที่สุด):** Intent Broadcast — scanner ส่ง barcode ทั้งก้อนเป็น Intent ครั้งเดียว

**ค่า default (iTCAN IT68 / KTE scanner):**
- Intent Action: `com.kte.scan.result`
- Extra Key: `code`

**ตั้งค่าบน PDA:** Scanner Settings → Data Output Mode → **Broadcast Mode** → Broadcast Action: `com.kte.scan.result`

**Flow:** Scanner → `BroadcastReceiver` (MainActivity) → `injectBarcode()` → `evaluateJavascript("receiveBarcode('...')")` → Web App

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
