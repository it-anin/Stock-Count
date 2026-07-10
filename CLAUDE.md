# CLAUDE.md — Anin Stock Count

Single-file PWA (`index.html`, ~2400+ JS lines) + Android WebView wrapper (`android-app/`).
No build system. No framework.

---

## ⚠️ กฎ 1 — ห้ามแก้ scan-related โดยไม่แจ้ง

ฟังก์ชัน / logic ต่อไปนี้ถือเป็น **scan-related** — ต้องอธิบาย change + impact ให้ user approve ก่อนทุกครั้ง:

`handleScanInput`, `handleScanKey`, `processScan`, `processPharmacistAuditScan`, `submitScanManual`,
`handleBarcode`, `parseScanLine`, `drainQueue`, `scanQueue`,
`evaluatePendingScans`, `validateAndProcess`,
`appendScanRow`, `removeScanItem`, `resetRecheckItem`, `clearScanList`, `rebuildScanListMap`, `renderScanList`, `patchScanRow`,
`_applyCloudScanData`, `syncToFirestore` (scan data), `pullFromCloud`, `startScanSessionListener`, `restoreFromFirestore`,
`confirmScanGap`, `showScanGapModal`, `_scanGapHold`, `confirmNoStock` (flag `noStock` — ดู SKILL-scan-engine),
`handleAuditVerifyScan`, `confirmAuditVerifyItem`, `confirmAllAuditVerify`, `confirmRecheckBtn`, `confirmAllRecheckSupervisor`,
`PDA_KEYSTROKE_THRESHOLD_MS`, `SCAN_DEBOUNCE_MS`, `_pdaMode`, `_lastKeystrokeTime`,
time gates ใน scan, role check ใน `rebuildScanListMap`

**เหตุผล:** scan เป็น critical path มี state + debounce + Firestore sync + listener ซ้อนกันหลายชั้น
debug บน PDA ยาก (ไม่มี native console) — cascade bug เคยเกิดแล้ว (June 2026, commit 58d9d2f→90f4bb8→6fefac9)

---

## ⚠️ กฎ 2 — Bump APK เฉพาะแก้ native Android

APK เป็นแค่ WebView wrapper — แก้ `index.html` → Vercel auto-deploy → PWA Service Worker push ให้ PDA เอง

**Bump versionCode + push tag `v*` เฉพาะเมื่อแก้:**
- `android-app/app/src/**` (Kotlin/Java)
- `android-app/app/src/main/AndroidManifest.xml`
- `android-app/app/build.gradle`
- `android-app/app/src/main/res/**`
- `.github/workflows/build-apk.yml`

**ไม่ bump เมื่อแก้:** `index.html`, `sw.js`, `libs/**`, docs (CLAUDE.md, README.md ฯลฯ)

**ขั้นตอน bump:**
1. bump `versionCode` (+1) และ `versionName` ใน `build.gradle`
2. sync `version.json` (versionCode, versionName, releaseNotes ภาษาไทย)
3. commit → `git tag v<X.Y>` → `git push origin main --tags`

---

## Architecture

```
index.html          ← ทุกอย่าง (HTML + CSS + JS รวมไฟล์เดียว ~2400+ บรรทัด)
sw.js               ← Service Worker (cache-first static, network-first HTML)
libs/
  papaparse.min.js  ← CSV parsing
  xlsx.full.min.js  ← Excel read/write
android-app/        ← WebView wrapper (Kotlin)
version.json        ← APK self-update manifest
```

**Stack:** Vanilla JS/CSS, Firebase Firestore v10.12.0 (compat CDN), no bundler
**Hosting:** Vercel → `https://anin-stock-count.vercel.app/`
**Branches:** SRC, KKL, SSS (ร้านยา) + WH (คลังกลาง)

**Auto-refresh (July 2026):** `_updateHeartbeat` ใน DOMContentLoaded closure — HEAD เทียบ ETag ทุก 15 นาที + ตอนเปิดจอ → deploy ใหม่ = reload ไม่หลุด login (stash `_autoUpdate`); ข้ามวันหลัง 04:00 + idle 10 นาที = reload บังคับ login ใหม่ ทั้งสอง path flush save ก่อน (race 8s — ห้ามรอ syncToFirestore เพียวๆ offline จะค้างถาวร)
- **แก้ `sw.js` ต้อง bump `CACHE = 'stock-count-vN'`** ไม่งั้น cache เก่าไม่ purge
- URL ที่มี `_vchk=` ต้องผ่าน SW ตรงเสมอ (ห้าม cache) — guard อยู่ต้น fetch handler

### State Object (สรุป)

```js
state = {
  productMasterData, productMasterMap,   // Product catalog
  r01Data,                               // Inventory qty (R01.102)
  r05Data,                               // Barcode mapping (R05.106)
  r16Data, r16SalesMap, r16RawMap,       // Sales during count (R16.104)
  r16InboundMap, r16InboundRawMap,       // Inbound during count (R16.104)
  r16DateMismatch,                       // true = R16 TRANDATE ไม่ overlap scan dates
  r16_103Map, r16_103RawMap,             // WH only: รับเข้ายังไม่ขึ้นชั้น (R16.103)
  skuMap,       // SKU → { productName, systemQty, barcodes[], isDel, isP }
  barcodeMap,   // barcode → SKU
  skuDirectMap, // SKU → { barcode, unitName }
  scanData,     // Map<SKU, { countedQty, status, timestamp, scannedBy, auditor,
                //             recheckQty, recheckBy, initialStatus, firstScanAt, ... }>
  unknownScans,
  locationMap,  // WH only: Map<SKU, string> e.g. "A1-01"
  zoneStaffMap  // WH only: Map<zone, staff> e.g. "A" → "มุก"
}
```

`_countResetAt` — module-level ISO timestamp, reset epoch (monotonic). ใช้ `>` เปรียบเทียบ lexicographic
`_r01BaselineAt` — module-level ISO timestamp, อัพ R01 ล่าสุดบน**สาขายา**เท่านั้น (`_isPharmacyBranch()`) ดู [[SKILL-data-files]] R01 Daily Reset

### Status Lifecycle

```
pending → scanning → pass
                   → audit → (verify pass)  → pass
                           → (verify fail)  → stock_adjustment
                   → stock_adjustment  (สาขายา: negSys — ระบบติดลบ clamp เป็น 0, ข้ามเภสัช verify)
```

`unknown` = barcode ไม่พบในระบบ (parallel track)
`audit_check` = legacy, ยังอยู่ใน codebase แต่ไม่ถูกผลิตใหม่แล้ว
`negSys` = สาขายาเท่านั้น: systemQty < 0 ใน R01 → skuMap เก็บ 0 + flag (ดู SKILL-scan-engine)

### Roles & Branches

| Role | Branch | สิทธิ์หลัก |
|---|---|---|
| assistant | SRC/KKL/SSS | สแกนนับ |
| pharmacist | SRC/KKL/SSS | Audit Verify (scan + ยืนยัน) |
| supervisor | WH | ยืนยันนับ + ยืนยันรีเช็ค (Desktop only) |
| warehouse | WH | สแกนนับ + สแกนรีเช็ค (PDA) |

---

## Running the App

```bash
npx serve .
# or
python -m http.server 8080
```

ไม่มี build step — เปิด `index.html` ใน browser ได้เลย

---

## Skills (โหลดเมื่อ task เกี่ยวข้อง)

- **Scan Engine:** `.claude/skills/SKILL-scan-engine.md`
  → PDA detection, debounce, scan formats, drainQueue/patchScanRow, role filter, Firestore sync, cloud sync rules

- **Data Files:** `.claude/skills/SKILL-data-files.md`
  → R01/R05/R16.104/R16.103 columns, OTFI direction, DEL/P items, exports, persistence layers

## เมื่องานเสร็จ
หลังทำ feature หรือ fix bug เสร็จ ให้ propose การอัพเดท CLAUDE.md
หรือ SKILL file ที่เกี่ยวข้อง โดยเพิ่มเฉพาะ context ที่ถ้าไม่มีแล้วจะทำผิดพลาด

---

## คู่มือผู้ใช้

| ไฟล์ | กลุ่มเป้าหมาย |
|---|---|
| `คู่มือการใช้งาน.html` | ทุก role |
| `คู่มือ-สาขา.html` | assistant + pharmacist (SRC/KKL/SSS) |
| `คู่มือ-คลัง.html` | warehouse + supervisor (WH) |

ไฟล์คู่มือเป็น standalone HTML — แก้ได้อิสระ ไม่กระทบ `index.html` ไม่ต้อง bump APK
