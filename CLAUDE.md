# CLAUDE.md — Anin Stock Count

**ไฟล์นี้เป็นเอกสารหลักไฟล์เดียวของ repo** — อ่านก่อนเริ่มงานทุกครั้ง แล้วอ่าน skill ที่เกี่ยวข้อง (§Skills)
`AGENTS.md` ถูกรวมเข้าไฟล์นี้แล้วและลบทิ้ง (29 ก.ย. 2026 · ผู้ใช้สั่ง) — **ห้ามสร้าง `AGENTS.md` กลับ** ของที่เคยอยู่ที่นั่นให้เขียนที่นี่หรือใน skill

ก่อนแก้/สรุปสาเหตุ: ตรวจ `git status --short` + branch + commit ล่าสุด (**ห้ามถือว่า working tree สะอาด** — มักมีงานค้างของ session อื่น) และอ่านโค้ดจริง + ประวัติ commit ที่เกี่ยวข้อง ห้ามอาศัยชื่อฟังก์ชันหรือเอกสารอย่างเดียว

Single-file PWA (`index.html`, ~8,950 บรรทัดรวม HTML/CSS/JS) + Android WebView wrapper (`android-app/`).
No build system. No framework.

**Current baseline (7 ก.ย. 2026):** APK `1.11` (`versionCode 12`, tag `v1.11`) — native ไม่ได้แก้มาตั้งแต่นั้น
ระบบผ่าน technical verification เบื้องต้นแล้ว แต่ยังรอ User Acceptance Test (UAT) จากผู้ใช้งานจริง ห้ามเปลี่ยน business flow จากการคาดเดา

**สภาพ production ที่ยืนยันแล้ว 9 ก.ย. 2026** (อย่าเชื่อของเก่ากว่านี้โดยไม่ตรวจซ้ำ):

| | สถานะ | ตรวจซ้ำยังไง |
|---|---|---|
| schema v2 | **ครบทั้ง 4 สาขา** | `stock_sessions/{branch}.schemaVersion === 2` |
| Firebase | **แผน Blaze** (ไม่มี hard-stop แล้ว) | Console → Billing |
| `firestore.rules` | Publish รุ่น `confirm_ops` แล้ว | snippet ในหัวไฟล์ `firestore.rules` |
| composite index `countResetAt`+`status` | มีแล้ว | snippet ใน §Automated Tests |
| auto-r01 | **รันจริงทุกเช้าครบ 4 สาขา** บนเครื่อง `BIGYAMAINPC` (ยืนยัน 9 ก.ย. 2026: `r01UploadedAt` = `08:10 น. 09/09/2026` ทั้ง 4 สาขา ตรงกับเวลาที่ตั้ง Task ไว้ · เคยเห็นรัน ~09:36 มาก่อน = รอบรันชดเชยจาก `-StartWhenAvailable`) · ⏳ **ขั้นส่งออก (28 ก.ย. 2026) มีใน repo แต่ยังไม่ได้วางบนเครื่องจริง**: รุ่นใหม่สั่ง `AutoR01Export.exe` (`auto-r01/bot-export/` = สำเนาบอท `it-anin/bot-export` ที่ตัด Supabase ออก) ส่งออก `Allstock.CSV` ใหม่ก่อน แล้วอัป Firestore อย่างเดียว · Task ต้องย้ายไป**ก่อน 08:00** ไม่ทับตัววน `SeniorsoftExport.exe` (08:00–20:50) และ `BOT05106` — ต้องวาง exe (build เอง ไม่อยู่ใน git) + `.env` (รหัส ProMaxx · repo PUBLIC ห้ามเข้า git) + สคริปต์ แล้วลงทะเบียน Task ใหม่ตาม `auto-r01/README.md` §ขั้น export / §ตั้งเวลา (ตรวจ: `Select-String -Path auto_r01_import.py -Pattern "def run_export_step" -Quiet`) · 29 ก.ย. 07:28 อัปจริงครั้งแรกด้วยขั้นส่งออก**จากเครื่องพัฒนา BIG-IT** (ผู้ใช้สั่ง — ไม่ใช่บอทบน BIGYAMAINPC) · ⚠️ ก่อนหน้านั้น WH/SSS ค้างที่ 26 ก.ย. = บอทบน BIGYAMAINPC น่าจะไม่ได้เขียนตั้งแต่ 27 ก.ย. (ยังไม่ได้ดู log บนเครื่องนั้น — ดู `auto-r01/TODO-safe-enable.md`) · ⚠️ **เครื่องนั้นไม่ใช่ git clone — ก๊อปไฟล์ไปวางเฉยๆ** ⇒ แก้สคริปต์ใน repo แล้วต้องเอาไปวางเองทุกครั้ง (`git pull` ที่นั่นไม่มีผล) และ**ต้องตรวจเวอร์ชันก่อนรันเสมอ** เพราะสคริปต์รุ่นก่อน 28 ก.ย. ไม่ตรวจ flag แปลกปลอม ตัวเก่าจะเมิน flag ใหม่แล้วเดินเข้าโหมดปกติซึ่งเขียนจริงทันที — วิธีอัปเดต/ตรวจอยู่ใน `auto-r01/README.md` §ติดตั้งบนเครื่องอื่น | `{branch}_r01.r01UploadedAt` ต้องเป็นเช้าวันนี้ |
| auto-r05 | **ใช้งานจริงแล้ว 9 ก.ย. 2026** — Task `AutoR05Import` 09:00 บน `BIGYAMAINPC` (โฟลเดอร์ `C:\Users\AninMainPC\Desktop\auto-r05` · Python 3.13) เขียนครั้งแรกสำเร็จ 11:33 น. `global_r05` 10,857 → **10,864 บาร์โค้ด** · ⚠️ **เครื่องนั้นไม่ใช่ git clone เหมือน auto-r01** ต้องก๊อปไฟล์ไปวางเองทุกครั้ง · ตัวป้อนไฟล์คือ Task ชื่อ **`BOT05106`** (ไม่ใช่ `ProMaxxReportBot` ตามที่เอกสารของโปรเจกต์นั้นยกตัวอย่างไว้) เขียนไฟล์เสร็จ ~07:55 · ⏳ **สคริปต์บนเครื่องนั้นยังเป็นรุ่นก่อนมี `checked_at` (14 ก.ย. 2026)** ต้องเอารุ่นใหม่ไปวาง ไม่งั้นการ์ดขึ้นเตือนทั้งที่บอทรันปกติ (ตรวจ: `Select-String -Path auto_r05_import.py -Pattern "STATUS_DOC_ID" -Quiet`) | **`global_r05_status.checked_at` ต้องเป็นวันนี้** (ตัวชี้ขาดตัวใหม่) · `global_r05.updated_at` ค้างหลายวันได้ตามปกติ · แยก "ไม่เปลี่ยนจริง" ออกจาก "บอทพัง" ใน 1 บรรทัด: `Get-ScheduledTask -TaskName "AutoR05Import" \| Get-ScheduledTaskInfo` → `LastTaskResult` **0** = ปกติ · **4** = ตกด่าน |
| ธง `nc` บน `{branch}_r01` | **หมวด DELETE ถูกถอดธงแล้วครบ 4 สาขา (8 ก.ย. 16:57 ผ่าน `--resync-nc`)** ⇒ ของที่ยังมียอด 745 รายการเข้า Progress แล้ว · ⏳ **ธงชนิด `nc:2` ยังไม่ขึ้น cloud — ยืนยัน 9 ก.ย. ว่ายังเป็น 0 ทั้ง 4 สาขา** (SRC `nc:1`=68 · KKL 35 · SSS 54 · WH 143 · `nc:2`=0 ทุกสาขา) บอทรันเช้านี้แล้วแต่ยังใช้ `auto_r01_import.py` **รุ่นเก่า** ⇒ **ยังต้องเอาไฟล์ไปวางที่ `BIGYAMAINPC` ด้วยมือ** (ตรวจด้วย `Select-String -Path auto_r01_import.py -Pattern "STOCK_ONLY" -Quiet` ต้องได้ `True`) · ระหว่างนี้หมวด DELETE ถูกมองเป็นหมวดปกติ ซึ่งให้ผลเท่ากันเพราะไม่มีตัวไหนอยู่ใน PBM | `state.r01Data.filter(r=>r.nc===1).length` (หมวด `11.`) · `r.nc===2` (หมวด DELETE) |
| auto-adj (LOT/ราคา ใบปรับปรุง → Supabase) | **✅ ใช้งานจริงบน `BIGYAMAINPC` แล้ว 14 ก.ย. 2026** — Task `AutoAdjImport` (โฟลเดอร์ `C:\Users\AninMainPC\Desktop\auto-adj` · Python 3.13) · เขียนสำเร็จ 13:50 น.: `adj_r14_lots` = **35,322 คู่ SKU+LOT · 5,139 SKU** (จาก `ADJ_R14.102.CSV` 131,004 แถว) · `adj_r05_prices` = **6,674 SKU มีราคาครบ** · เว็บ deploy แล้ว · ⚠️ **Task ยังตั้งไว้ 08:15 แต่ไฟล์ export เสร็จ ~18:15 ⇒ รอบเช้าเจอไฟล์เมื่อวานแล้วปฏิเสธทุกวัน (exit 4)** ต้องเลื่อนเป็นเย็น (`Set-ScheduledTask ... -Trigger (New-ScheduledTaskTrigger -Daily -At "19:00")`) · ⚠️ เครื่องนั้นไม่ใช่ git clone เหมือน auto-r01/r05 ต้องก๊อปไฟล์ไปวางเอง · service key อ่านจาก env → `.env` ข้างสคริปต์ → `.env` ในโฟลเดอร์ CSV (ลำดับ 2 ชนะ 3 เสมอ — ไฟล์ผิดที่วางไว้ข้างสคริปต์จะบังของที่ถูก) · หัวคอลัมน์ R14.102 ยืนยันกับไฟล์จริงแล้ว (คอลัมน์ที่ 1 ชื่อ `EXPIREDATE` ไม่ใช่ `CF_EXPIREDATE_TEXT` ที่อยู่คอลัมน์ที่ 2 — `index.html` อ่านคอลัมน์ที่ 1 มาตลอด **ห้ามย้ายข้างเดียว**) · ⛔ **ไฟล์ราคาต้องชื่อ `ADJ_R05105.CSV` (มีคำนำหน้า) ห้ามใช้ `R05.105.CSV` ล้วน** — `auto-r05` (**ห้ามแก้ ทำงานดีอยู่แล้ว**) ค้นด้วย `R05*.CSV` ซึ่งกินชื่อล้วนไปด้วย · ห้ามต่อวันที่ท้ายชื่อ (วันที่บางวันมีเลข 105/106 ปน) | `adj_meta.checked_at` ต้องเป็นวันนี้ · การ์ดในป็อปอัพไม่มี `⚠️ บอทยังไม่ได้ตรวจวันนี้` |
| ยังไม่ได้ทำ | Budget Alert · ย้าย Confirm ไป Cloud Function (Stage 2) | — |

---

## ⚠️ กฎ 0 — วินิจฉัยก่อนตั้งทฤษฎี (เพิ่ม ก.ย. 2026 หลังไล่ผิดทาง 3 รอบ)

**เมื่อพบว่า document บน Firestore หายไป หรือข้อมูลไม่ตรงที่คาด ให้ไล่ตามลำดับนี้เสมอ ห้ามข้าม:**

1. **"มีใครกดอะไรไปล่าสุด"** — ตรวจ `countResetAt` (epoch) ของ session ก่อนเป็นอันดับแรก
   `startNewCount()` ลบ `{branch}_r01`, `{branch}_adjlot`, `{branch}_pharmacy_audit_markers` · `clearAllData()` ลบมากกว่านั้นอีก
   **การกระทำของผู้ใช้อธิบายของหายได้บ่อยกว่าบั๊ก**
2. **อ่าน log ของตัวที่เขียนข้อมูลนั้น** — `auto-r01/auto_r01.log` **บนเครื่องที่รันจริง** (`BIGYAMAINPC`)
3. **ค่อยตั้งสมมติฐานว่าโค้ดพัง** และต้องยืนยัน premise ก่อนเสมอ

### กับดัก 3 ข้อที่ทำให้สรุปผิดมาแล้ว — อย่าทำซ้ำ

| # | สรุปผิดว่า | เพราะ | บทเรียน |
|---|---|---|---|
| 1 | "auto-r01 ยังไม่เคยรัน" | เช็ค `Get-ScheduledTask` + `auto_r01.log` **บนเครื่องที่นั่งอยู่** (`BigYa-spare` = เครื่องพัฒนา) แต่บอทรันบน `BIGYAMAINPC` | **ระบบนี้มีหลายเครื่อง — สถานะ runtime ต้องอ่านจาก Firestore ไม่ใช่จากเครื่องที่เปิดอยู่** (`{branch}_r01.r01UploadedAt`) |
| 2 | "บอทไม่ครอบ KKL" | เห็นว่าสคริปต์เป็น all-or-none แล้วอนุมานว่า "3 สาขาสำเร็จ ⇒ KKL ไม่ได้เปิดใช้" — แต่ all-or-none อยู่ที่ **guard ตอน parse** เท่านั้น ส่วน**ลูปเขียนวนต่อเมื่อล้ม** | **อย่าเหมาการรับประกันจากโค้ดส่วนหนึ่งไปยังอีกส่วน** · log มีคำตอบอยู่แล้วแต่ไปขอช้า |
| 3 | "R01 อัปไม่ขึ้นเพราะอัป `Allstock.CSV` รวมสาขาผ่านหน้าเว็บ" | สร้างทฤษฎีที่อธิบายหลักฐานได้ครบ (เกิน 1 MiB + ล้มเงียบ) แล้วนำเสนอเหมือนเป็นข้อสรุป **ทั้งที่ไม่เคยยืนยันว่ามีใครอัปแบบนั้นจริง** | **"ทฤษฎีที่อธิบายได้ครบ" ≠ หลักฐาน** — ต้องยืนยัน premise ก่อนเสมอ |

**ต้นเหตุจริงของทั้ง 3 รอบ:** ผู้ใช้กด "เริ่มนับใหม่" บน KKL หลังบอทรัน ⇒ `_r01` ถูกลบตามดีไซน์
เอกสารเขียนเตือนเรื่องนี้ไว้อยู่แล้ว — **มีข้อมูลครบแต่ไม่ได้เอามาใช้กับสิ่งที่สังเกตเห็น**

---

## ⚠️ กฎ 1 — ห้ามแก้ scan-related โดยไม่แจ้ง

ฟังก์ชัน / logic ต่อไปนี้ถือเป็น **scan-related** — ต้องอธิบาย change + impact + test plan ให้ user approve ก่อนทุกครั้ง:

`receiveBarcode`, `handleScanInput`, `handleScanKey`, `processScan`, `processPharmacistAuditScan`, `submitScanManual`,
`handleBarcode`, `parseScanLine`, `drainQueue`, `scanQueue`,
`evaluatePendingScans`, `_buildPendingScanEvaluation`, `validateAndProcess`, `_confirmPharmacyBatched`,
`appendScanRow`, `removeScanItem`, `resetRecheckItem`, `clearScanList`, `rebuildScanListMap`, `renderScanList`, `patchScanRow`,
`_applyCloudScanData`, `syncToFirestore` (scan data), `pullFromCloud`, `startScanSessionListener`, `restoreFromFirestore`,
`confirmScanGap`, `showScanGapModal` (dead code ก.ค. 2026 — gap 2 นาทีถูกถอด แต่ `_scanGapHold` ยังเป็น hold-guard ทุกจุด ห้ามลบ), `confirmNoStock` (flag `noStock` — ดู SKILL-scan-engine),
`showZeroSysModal`, `confirmZeroSys` (dead code ก.ค. 2026 — modal ถูกถอด แทนด้วย `_zeroSysFirstScan` แต่ `_zeroSysHold` ยังเป็น hold-guard ทุกจุด ห้ามลบ),
`handleAuditVerifyScan`, `confirmAuditVerifyItem`, `confirmAllAuditVerify`, `confirmRecheckBtn`, `confirmAllRecheckSupervisor`,
`_confirmWhCountItems`, `confirmCountByStaff`, `confirmRecheckByStaff`, WH Count/Recheck inbox + confirmation listeners,
branch confirm lock (`_acquireBranchConfirmLock`, `_restampBranchConfirmLock`, `_releaseBranchConfirmLock`, lock listener และ scan guards),
`PDA_KEYSTROKE_THRESHOLD_MS`, `SCAN_DEBOUNCE_MS`, `_pdaMode`, `_lastKeystrokeTime`,
time gates ใน scan, role check ใน `rebuildScanListMap`,
`_confirmPharmacyAuditBatched`, `_sameBranchRecheck`, `_addRecheckScanQty`, `getPharmacistAuditPendingMap`, session/inbox/marker listeners + restore/backfill (รวม `_writePharmacyAuditMarkers` · `_applyPharmacyAuditMarkersToState` · `reopenPharmacyAudit` — marker พาธง `directAdj` ต.ค. 2026),
**WH workflow v2 ทุกจุด:** `confirm_ops`/`results` reader-listener · prepare/commit/materialize/recovery · legacy dual-read · migration/cleanup,
**schema v2:** `getScanItemsRef`, `_markSkuDirty`, `_flushDirtySkus`, `_writeScanningItem`, `_scanItemPayload`, `_scanItemToLocal`, `_scanItemFingerprint`, `_scanItemLastQty`,
`_reconcileScanItems`, `startScanItemsListener`, `_applyScanItemChange`, `_applyScanItemRemoved`, `_applyCloudSessionMeta`, `_loadScanItemsFromCloud`,
`_deleteScanItemsForEpoch`, `_deleteScanItemsNotInEpoch`, `_applyConfirmItemsToState`, `_writeConfirmedItems`, `_syncSessionMetaToFirestore`, `_schemaVersion`, constant `SCAN_ITEM_*`

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

**Current native policy (APK 1.11):** ใช้ `FLAG_KEEP_SCREEN_ON` เฉพาะช่วงใช้งานและปล่อยหลัง idle 2 นาที ห้ามนำ `SCREEN_BRIGHT_WAKE_LOCK`, `ON_AFTER_RELEASE` หรือ permission `WAKE_LOCK` กลับมา

---

## ⚠️ กฎ 3 — Cloud confirmation เป็น authoritative

- WH Supervisor ใช้ Cloud เป็น source of truth; localStorage เป็น cache เท่านั้น
- WH schema v2 ใช้ `{branch}/items/{sku}` เป็น live state และใช้เฉพาะผลใน `WH/confirm_ops/{opId}` ที่ `state==='committed'` เป็น final marker; operation ที่ยัง `preparing`/`aborted` ต้องไม่มีผลต่อ UI
- Precedence ต้องคงเป็น R01/R16 master → item base → Count final (committed op หรือ legacy marker ระหว่าง compatibility) → Count pending เฉพาะที่ยังไม่มี final → Recheck final → Recheck pending เฉพาะที่ยังไม่มี final
- committed Recheck ต้องชนะ Count final ที่ยังเป็น `audit`; final ใน `countResetAt` เดียวกันต้องชนะ PDA snapshot/legacy inbox ที่มาช้าเสมอ
- Count/Recheck Confirm ต้องอ่าน server ล่าสุดและตรวจ epoch/master/source fingerprint ก่อน publish; เปลี่ยน local state หลัง transaction ที่ flip operation เป็น `committed` สำเร็จและโหลด results ครบ+hash ตรงเท่านั้น
- การ materialize committed result กลับลง `WH/items/{sku}` และล้าง legacy inbox ทำภายหลังได้แบบ idempotent; ล้มกลางชุดห้ามทำให้ committed op เสียอำนาจหรือทำให้ผู้ใช้เห็นผลบางส่วน
- generic `audit` ที่ไม่มี `auditor` ห้ามทับ `pass`/`stock_adjustment` ที่ Supervisor ยืนยันแล้ว
- ห้าม simplify `_applyCloudScanData()`/`syncToFirestore()` หรือเปลี่ยน merge order โดยไม่ทดสอบ stale snapshot, delayed PDA write, offline และสอง Desktop พร้อมกัน
- Pharmacy Confirm ต้องทำบน Desktop ผ่าน branch lock + batch processing PDA ห้ามเรียก Confirm โดยตรง
- ห้าม Firestore delete แบบ fire-and-forget ใน confirmation flow ที่ต้อง atomic · R01/R16 version ไม่ตรงหรือเครื่องที่ Confirm ออฟไลน์ = abort ทั้งชุด ห้ามเปลี่ยนสถานะบางส่วน

---

## ⚠️ กฎ 4 — ไฟล์ห้ามแตะ + Git safety

**ห้ามแตะถ้างานไม่ได้ระบุตรงๆ:**
- `android-app/app/stockcount.keystore` — ห้ามแก้/แทนที่/แสดงเนื้อหา/เผยแพร่ข้อมูล signing
- `libs/**` (vendored/minified) · `vercel.json` (deploy headers — ห้ามรวม dirty change ที่ไม่เกี่ยว) · `api/ip.js` (ห้ามเปลี่ยน contract โดยไม่ตรวจ caller)
- `firestore.rules` — ห้ามเปลี่ยนสิทธิ์เงียบๆ แก้แล้วต้องแจ้งขั้นตอน Publish · ถ้า runtime เพิ่ม subcollection ใหม่ต้อง Publish **ก่อน** deploy เว็บ ไม่งั้นทุกเครื่องได้ `permission-denied`
- sample CSV, backup, `.windsurf/`, `.claude/settings.local.json` และไฟล์ local อื่น — ห้ามลบหรือ commit เว้นแต่ผู้ใช้สั่ง · คู่มือ/HTML ตัวอย่างไม่ใช่ runtime
- PIN, credential, API secret, keystore material, Supabase service_role key — ห้ามใส่ในเอกสาร/log/คำตอบ (**repo นี้ PUBLIC**)

**Git:**
- ห้าม `git reset --hard`, `git checkout --` หรือคำสั่งทำลายงานผู้ใช้โดยไม่มีคำสั่งชัดเจน · ห้าม amend/rebase/force-push โดยไม่ได้รับอนุมัติ
- ห้าม `git add .` ใน dirty worktree — stage เฉพาะไฟล์ของงานนั้น · แสดงรายการไฟล์ก่อน commit
- ⚠️ stage บางส่วนของไฟล์ที่มีงานอื่นปน: **ห้ามใช้ patch `-U0` + `--unidiff-zero`** (อิงเลขบรรทัดของ working copy → วางผิดที่ · เกิดจริง 29 ก.ย. 2026) · ให้สร้างเนื้อหาจาก `HEAD` แทรกตามข้อความ แล้ว `git hash-object -w` + `git update-index --cacheinfo` และเปิด `git diff --cached` ของไฟล์นั้นดูก่อน commit เสมอ

---

## Architecture

```
CLAUDE.md           ← เอกสารหลักไฟล์เดียว: กฎ critical path + architecture + ข้อห้าม/invariant/bug ledger (ไฟล์นี้)
index.html          ← runtime เว็บทั้งหมด (HTML + CSS + JS รวมไฟล์เดียว ~6,600+ บรรทัด)
sw.js               ← Service Worker (cache-first static, network-first HTML)
libs/
  papaparse.min.js  ← CSV parsing
  xlsx.full.min.js  ← Excel read/write
android-app/        ← WebView wrapper (Kotlin)
version.json        ← APK self-update manifest
firestore.rules     ← สำเนา rules; deploy จริงต้อง Publish ผ่าน Firebase Console
auto-r01/           ← R01 auto import ทุกเช้า (ก่อน 08:00 ตั้งแต่ 28 ก.ย. 2026) ครบ 4 branch แยกตาม Col D (Windows Task Scheduler)
  bot-export/       ← ซอร์ส AutoR01Export.exe: สำเนาบอท it-anin/bot-export ที่ตัด Supabase ออก — ส่งออก Allstock.CSV รอบเดียวก่อน auto-r01 อัป Firestore
auto-r05/           ← R05.106 auto import ทุกเช้า ลง `global_r05` (doc กลาง ใช้ร่วมทุกสาขา)
auto-adj/           ← R14.102 (LOT/EXP) + R05.105 (ราคา Level 4) → Supabase ทุกเช้า ให้ป็อปอัพ 📦 ปรับปรุงสินค้า
api/ip.js           ← Vercel function สำหรับ login log IP
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
  productMasterData, productMasterMap,   // Product Branch Master — catalog ของ "สาขานี้" ({branch}_pm)
  r01Data, r01Version,                   // Inventory qty + cloud master version (R01.102)
  r05Data,                               // Barcode mapping (R05.106)
  r16Data, r16SalesMap, r16RawMap,       // Sales during count (R16.104)
  r16InboundMap, r16InboundRawMap,       // Inbound during count (R16.104)
  r16DetailVersion,                      // active R16.104 generation/version
  r16DateMismatch,                       // true = R16 TRANDATE ไม่ overlap scan dates
  r16_103Map, r16_103RawMap,             // WH only: รับเข้ายังไม่ขึ้นชั้น (R16.103)
  r16_103DetailVersion,                  // active R16.103 generation/version
  skuMap,       // SKU → { productName, unitPrice, systemQty, negSys, barcodes[], isDel }
  barcodeMap,   // barcode → SKU
  skuDirectMap, // SKU → { barcode, unitName }
  scanData,     // Map<SKU, { countedQty, status, timestamp, scannedBy, auditor,
                //             countAt, recheckQty, recheckBy, recheckAt,
                //             initialStatus, firstScanAt, noStock, ... }>
  unknownScans,
  locationMap,  // WH only: Map<SKU, string> e.g. "A1-01"
  zoneStaffMap  // WH only: Map<zone, staff> e.g. "A" → "มุก"
}
```

### Product Branch Master + Total SKU / Progress (ส.ค. 2026)

**Product Master แยกไฟล์ต่อสาขาแล้ว** — Firestore `stock_sessions/{branch}_pm` (`SRC_pm`/`KKL_pm`/`SSS_pm`/`WH_pm`) ไม่ใช่ `global_pm` ตัวเดียว
- `getProductMasterMetaRef(branch=currentBranch)` เป็นจุดเดียวที่ผูก doc id · **ไม่มี fallback ไป `global_pm`** โดยเจตนา — สาขาที่ยังไม่อัป PBM ต้องเห็น badge "ยังไม่โหลด" ไม่ใช่หยิบ catalog สาขาอื่นมาใช้เงียบๆ
- `restoreMasterFromFirestore()` ต้องล้าง `productMasterData`/`productMasterMap` เมื่อ `doc.exists===false` (เดิมเป็น no-op เงียบ ซึ่งไม่มีปัญหาตอน PM เป็น global แต่ตอนนี้ค้าง catalog ของสาขาก่อนหน้าได้)
- **Col D filter:** ข้ามแถวที่ `D` / `P` เท่านั้น (ส.ค. 2026 รอบ 2 — `REVIEW` ถูกถอดออกจากลิสต์ที่กรองแล้ว ดูข้อถัดไป) · ไม่มี field `isP` แล้ว (โหมด Progress CatA + ปุ่มกรอง `CAT[A]`/`P` ถูกถอดออกทั้งหมด)
- **field `cat`** = ค่า Col D ที่เก็บไว้ **เฉพาะแถว `A`/`B`/`C`/`REVIEW`** (`_isForceCountColD()`) — เป็นตัวตัดสิน `_countableSkus` ดูหัวข้อถัดไป
  ⚠️ **`REVIEW` ได้สิทธิ์เต็มรูปแบบเหมือน `A`/`B`/`C` ทุกอย่าง** ไม่ใช่แค่กติกานับ — อยู่ใน PBM catalog ปกติ, **ไม่ติดแท็ก DEL**, ชื่อสินค้ามาจาก PBM ไม่ใช่ R01 (ต่างจาก `D`/`P` ที่ยังถูกกรองทิ้งเหมือนเดิม)
  ⚠️ **ห้ามเก็บ `cat` ให้ทุกแถว** — `{branch}_pm` มีเพดาน 1 MiB เหมือน `global_r05` ที่เคยชนแล้วเงียบ · `syncProductMasterToFirestore()` เตือนที่ ≥ 800 KB และ **ต้อง toast error เมื่อเขียนไม่ผ่าน** (ห้าม catch เงียบ)
- SKU ที่ถูกกรองออกแต่ยังมีสต็อกใน R01 → จัดเป็น **DEL** ตามกลไกเดิม · ยังสแกน/Confirm/เข้าใบปรับสต็อก และ **ยังนับใน Progress** ผ่านเงื่อนไข `G ≠ 0`
- อัป PBM ลง **สาขาที่เลือกอยู่ตอนนั้น** เท่านั้น — อัปผิดสาขา = catalog **และตัวหาร Progress** ของสาขานั้นผิดทันทีผ่าน listener · toast แสดงชื่อสาขา + จำนวน A/B/C/REVIEW ไว้กัน (แก้ข้อความต้องแก้ regex ใน `_toastMessageForDevice` คู่กัน)
  - ขั้นตอนอัปจริง: **อัปทีละสาขา 4 รอบ** (สลับสาขาก่อนทุกครั้ง ตรวจชื่อบนหัวจอ) · คำนวณ Total SKU ที่คาดหวังใน Excel ไว้ก่อน · ตรวจ toast ว่า `A/B/C/REVIEW` ไม่เป็น 0 · **แจ้งหน้างานล่วงหน้า** เพราะตัวหาร Progress ทุกเครื่องเปลี่ยนทันที ไม่งั้นจะถูกรายงานว่า "ระบบพัง"

**`_countableSkus` = "SKU ที่ต้องนับ"** — สร้างใน `_rebuildCountableSkus()` ซึ่ง `rebuildMaps()` เรียกก่อน early-return ของ R05

```
นับ ⟺ มีแถวใน R01.102  และ  ธง nc ไม่ใช่ 1
      และ ( G ≠ 0  หรือ  ( ธง nc ไม่ใช่ 2  และ  Col D ใน PBM ∈ {A,B,C,REVIEW} ) )
```

- `G ≠ 0` = กติกาเดิม (ระบบบอกว่ามีของ → ต้องไปนับ) · `Col D A/B/C/REVIEW` = ที่เพิ่มมา ส.ค. 2026 (สินค้าขายดี/รอตรวจสอบ → ต้องไปดูของบนชั้นจริง **แม้ระบบขึ้น 0**)
- **ธง `nc:2` (หมวด `DELETE`) เป็นข้อยกเว้นเดียวของวงเล็บ `หรือ`** (ก.ย. 2026) — ของกลุ่มนี้ถูกมาร์คลบแล้ว ยอด 0 จึงแปลว่า "ไม่มีและไม่ต้องมี" ต่างจากสินค้าขายดีที่ต้องไปดูชั้นทุกวัน ⇒ ชั้น A/B/C/REVIEW ดึงเข้าไม่ได้ · ดูตารางธง 2 ชนิดด้านล่าง
- ⚠️ **เงื่อนไขกลุ่มนี้ต้องเป็น `หรือ` ห้ามเปลี่ยนเป็น `และ`** — มันมีแต่ "เพิ่ม" ไม่มีทางตัดออก จึงทำให้ PBM ไฟล์เก่าที่ไม่มี field `cat` ให้ผลเท่ากติกาเดิมเป๊ะโดยอัตโนมัติ **ไม่ต้องมี feature flag ใดๆ** · ถ้าเปลี่ยนเป็น `และ` ทุกสาขาที่ยังไม่อัป PBM จะได้ Total SKU = 0 ทันทีที่ deploy
- ⚠️ **`REVIEW` ไม่ใช่แค่กติกานับ — ได้สิทธิ์เต็มรูปแบบเหมือน `A`/`B`/`C`** (ส.ค. 2026 รอบ 2): ไม่ถูกกรองออกจาก PBM parser, ไม่ติดแท็ก DEL, ชื่อสินค้ามาจาก PBM · ต่างจาก `D`/`P` ที่ยังถูกกรองทิ้งและติด DEL เหมือนเดิม
- **หมวดใน R01 คอลัมน์ P ติดธง `nc` ตอน `loadR01` — มี 2 ชนิด (ก.ย. 2026)**

  | ธง | หมวด | พฤติกรรม |
  |---|---|---|
  | `nc:1` | ขึ้นต้น `11.` (`R01_NON_COUNT_PREFIXES` · `_isNonCountR01Category()`) | **ตัดเด็ดขาด** ชนะทั้งยอดและชั้น A/B/C/REVIEW |
  | `nc:2` | มีคำว่า `DELETE` (`R01_STOCK_ONLY_KEYWORDS` · `_isStockOnlyR01Category()`) | **นับเฉพาะเมื่อ `G ≠ 0`** — ชั้น A/B/C/REVIEW ดึงของที่ยอด 0 เข้าไม่ได้ |
  | ไม่มีธง | หมวดปกติ | `G ≠ 0` **หรือ** ชั้น A/B/C/REVIEW |

- ⛔ **`DELETE` ต้องอยู่ใน `R01_STOCK_ONLY_KEYWORDS` เท่านั้น ห้ามย้ายกลับไป `R01_NON_COUNT_KEYWORDS`** — ของจริง **745 รายการยังมียอดคงเหลือ** (ในนั้นติดลบ 29 = ค้างส่งลูกค้า) และ**มีบาร์โค้ดใน R05 ครบทุกตัว** = ของบนชั้นจริงที่ต้องเดินไปนับ · ส่วนอีก ~6,100 รายการที่ยอดเป็น 0 ต้องไม่โผล่เป็นงาน **แม้ถูกจัดชั้น A/B/C/REVIEW ไว้ก็ตาม** (เหตุผลที่ต้องแยกธงเป็น 2 ชนิด แทนที่จะปล่อยให้เงื่อนไข `หรือ` ดึงเข้ามา) · `R01_NON_COUNT_KEYWORDS` ต้องคงอยู่เป็น array ว่าง **ห้ามลบตัวแปร** (`tools/check-r01-parity.js` ดึงบรรทัดนี้ด้วย regex)
- ⚠️ **อ่านธงแบบ truthy เสมอตอน sticky** (`if(r.nc)`) แล้วเก็บค่าที่เข้มที่สุด (`1` ชนะ `2`) — doc เก่าที่มีแต่ `nc:1` ต้องให้ผลเท่าเดิมเป๊ะ · ระหว่าง rollout ที่ยังไม่ resync เครื่องรุ่นใหม่จะเห็นหมวด DELETE เป็น `nc:1` (ถูกตัดหมด) = ย้อนไปพฤติกรรมก่อน ก.ย. 2026 ไม่ใช่ข้อมูลเสียหาย
- ⚠️ **กติกาตัดหมวดถูกทำซ้ำ 3 ที่ ต้องแก้พร้อมกันเสมอ:** `index.html` · `auto-r01/auto_r01_import.py` · `tools/list-r01-categories.js` แล้วรัน `node tools/check-r01-parity.js "<Allstock.CSV>"` ยืนยันว่าอัปผ่านเว็บกับให้บอทอัปได้ผลตรงกันทุกไบต์ (checker ดึงค่าคงที่และฟังก์ชันทั้ง 2 ชนิดมาเทียบ — เพิ่มชนิดใหม่ต้องเติม regex ในไฟล์นั้นด้วย)
- ⚠️ **ธง `nc` ถูกตัดสินตอน parse แล้วตรึงลง `{branch}_r01.data_json`** — แก้กติกาอย่างเดียวไม่มีผลกับข้อมูลที่ค้างบน cloud จนกว่าบอทจะรันรอบถัดไป · ถ้าต้องให้มีผลกับรอบนับที่ทำอยู่ ใช้ `python auto_r01_import.py --resync-nc --yes` ซึ่งเขียนเฉพาะ `data_json` (ไม่แตะ `r01Version`/`r01BaselineAt`/`r16*` จึงไม่ล้าง R16 ไม่ freeze audit ไม่ทำให้ Confirm abort) แล้วทุกเครื่องจะเห็นเมื่อ reload — **ต้อง resync ก่อน deploy** ไม่งั้นเสีย auto-reload ไปหนึ่งรอบ
- ⚠️ **เก็บแค่ธง `nc` ห้ามเก็บข้อความหมวดลง `r01Data`** — `{branch}_r01` มีเพดาน 1 MiB · ข้อความไทย ~45 ตัวอักษร × 5,400 แถว ≈ 750 KB ชนเพดานทันที
- SKU ที่หลุดจากชุดนี้ยังอยู่ครบ: สแกนได้ · Confirm ได้ผลถูกต้อง · เห็นในรายการสินค้า — ตัดออกเฉพาะจาก Total SKU/Progress
- `_cachedTotalSku = _countableSkus.size` เป็นทั้ง **การ์ด Total SKU และตัวหาร Progress** · ตัวเศษคือ SKU ในชุดเดียวกันที่ **สแกนแล้ว** (สาขายา · `PROGRESS_BY_SCAN` — 30 ก.ย. 2026) หรือ **Confirm แล้ว** (WH · ปิดสวิตช์)
- **การ์ดบนแถบสถิติแบ่งเป็น 2 แกน อย่าพยายามทำให้บวกลงตัว** (ส.ค. 2026 · `updateStats()`)

| การ์ด | กรองด้วย `_countableSkus` | เหตุผล |
|---|---|---|
| Total SKU · **Counted** · **Pass** · ตัวเศษ Progress | ✅ กรอง (ชุดเดียวกันหมด) | `Counted === progNum` เป๊ะ · `Counted ≤ Total SKU` · `Pass ≤ Counted` |
| **Audit** + sub-progress (`auditGot/auditTotal`) | ❌ **ห้ามกรอง** | เป็นงานค้างที่เภสัชต้องไปตรวจจริง · ต้องเท่ากับ badge ปุ่ม Audit Verify (`updateAuditVerifyCount()` ไม่กรอง) — กรองแล้ว = ซ่อนงานที่ยังไม่เสร็จ |
| Not in System | — | `unknownScans` อยู่นอก `skuMap` อยู่แล้ว |
| **WH การ์ดที่ 2 "Recheck ทั้งหมด"** | ❌ ไม่แตะ | WH เขียนทับ `c` ด้วย `auditTotal` โดยเจตนา — **คนละความหมายกับ Counted ของสาขายา ห้ามแก้ให้ตรงกับ Progress** |

  - ⚠️ ในลูปของ `updateStats()` บรรทัด `if(!_countableSkus.has(sku))continue;` **ต้องอยู่ใต้การนับ `f`/`auditTotal`/`auditGot` เสมอ** ไม่งั้น Audit โดนกรองไปด้วยเงียบๆ
  - ผลที่ตั้งใจ: `Pass + Audit ≠ Counted` (Audit นับกว้างกว่า) · SKU นอกชุดที่ Confirm เป็น `pass` จะไม่โผล่บนแถบสถิติเลย (ยังดูได้ใน 📋 รายการสินค้า / Export / ใบปรับสต็อก)
  - **Dashboard ข้ามสาขา (`buildDashboardData`) ไม่กรองโดยเจตนา** — ไม่มี `_countableSkus` ของสาขาอื่น ถ้าจะกรองต้องโหลด PBM+R01 ทุกสาขา = กิน read เปล่า · Dashboard ตอบคำถาม "Confirm ไปแล้วกี่รายการ" คนละคำถามกับ Progress ของสาขา
  - ⚠️ **นิยามปัจจุบันของสาขายา (SRC/KKL/SSS · ทุกอุปกรณ์ Desktop+PDA) — สวิตช์ `PROGRESS_BY_SCAN` (30 ก.ย. 2026 · ผู้ใช้สั่ง)** — Counted / Pass / Progress นับ **"ตามที่สแกน"** ไม่ใช่ตามที่ Confirm (`_progressByScanOn()` = สวิตช์เปิด && สาขายา):
    - **เหตุผล:** ตัดขั้น Audit แล้ว (29 ก.ย.) ⇒ "เสร็จ" ของหน้างานคือ **สแกนครบ** ไม่ต้องรอ Desktop Confirm · ผู้ใช้ยอมรับแล้วว่า Progress 100% ≠ Confirm ครบ, Progress ลดได้ (กด ✕), Desktop ไม่มีตัวบอกจำนวนที่รอ Confirm
    - **Counted = ตัวเศษ Progress = SKU ในชุดที่ต้องนับ (`_countableSkus`) ที่สถานะไม่ใช่ `pending`** (สแกนครั้งแรกก็นับ · รวม `scanning` ที่ยังไม่ Confirm · ทุกเครื่องในสาขา) · **Pass = สถานะ `pass` จริง ในชุดเดียวกัน** (ไม่รวม `stock_adjustment`/`audit_check`) · **Progress = Counted / Total SKU ไม่เกิน 100%**
    - ⇒ **invariant ในตารางด้านบนยังจริงทุกจอสาขายา** (`Counted === progNum` · `Counted ≤ Total SKU` · `Pass ≤ Counted`) · **ของนอกชุดที่ต้องนับสแกนแล้วเลขไม่ขยับ** (ยังเห็นใน RESULT/📋 — ถ้ากรองข้างเดียว Progress จะทะลุ 100% ซ้ำรอยบั๊กเดิม) · Audit card ไม่กรองเหมือนเดิม
    - **กลไก:** `_scanProgressCounts()` (วนรอบเดียวบน `scanData` ≈0.8 ms/สแกน วัดที่ catalog 5,400 · CPU 4×) → `_writeScanProgress()` เขียน `statCounted`/`statPass`/`statPct`/`progressFill`/`progressCount` · เรียกจาก `_refreshScanCounters()` (ครอบทั้งสแกนเอง `_afterScanRefresh` และเพื่อนสแกนผ่าน listener โดยไม่แก้ `handleBarcode`/`drainQueue`/listener) และท้าย `updateStats()` เป็นตัวสุดท้ายเสมอ (ทับค่าที่ลูปแบบ Confirm คำนวณไว้ด้านบน) · ✕ ลบใช้ `scheduleStats()` เดิม · ⛔ ห้ามให้ `updateStats()` ต่อสแกนกลับมา
    - **ไม่เปลี่ยน:** WH (Counted = Recheck ทั้งหมด · Progress ยังนับที่ Confirm แล้ว) · การ์ด Audit · Dashboard ข้ามสาขา · สูตร Confirm · ข้อมูลใน Firestore · `Pass` ยังขยับตอน Desktop กด Confirm เท่านั้น (PDA/Desktop ตัดสิน pass/stock_adjustment ก่อน Confirm ไม่ได้ — ต้องใช้ R16 ทั้งช่วง) · PASS ลดลงทันทีหลัง deploy เพราะตัด Stock Adj ออก
    - เทส `tests/specs/{logic,e2e}/progress-by-scan.spec.js` (ทำซ้ำเคสหลักบนทั้ง PDA และ Desktop · สวิตช์ปิด = เท่าเดิม · WH เท่าเดิม · เส้นทางเบา = updateStats ในสถานะสุ่ม · สแกนล้วนไม่เรียก `updateStats` · e2e เพื่อนสแกน/Confirm จริง/เปิดเครื่องทีหลัง) · ทางถอย §"ย้อนกลับ Counted/Pass/Progress ตามสแกน"
- **ปุ่มกรองใน 📋 รายการสต็อคสินค้าต้องอิง `_countableSkus` ด้วย** (ส.ค. 2026) — `getFilteredPopupRows()`
  - ⏳ **"ยังไม่ได้นับ"** (key `pending`) = `_countableSkus` ที่ยังไม่เข้าตัวเศษ → **จำนวนแถว = ตัวหาร − ตัวเศษ** เสมอ · **สาขายา (`PROGRESS_BY_SCAN` เปิด): เฉพาะ `pending`** (`scanning` เข้าตัวเศษแล้ว ไม่ค้างในลิสต์) · **WH / ปิดสวิตช์: `pending` + `scanning`** (ตัวเศษ = Confirm แล้ว — ห้ามตัด `scanning` ออก จะเกิด "รายการหมดแต่ Progress ไม่ 100%") · ห้ามถอด `_countableSkus` (รายการจะยาวกว่าที่เหลือจริง)
  - 🗑️ **DEL** = `isDel && _countableSkus.has(sku)` → เป็น "งานที่ต้องเดินไปหา" ไม่ใช่รายงานของนอกแคตตาล็อกทั้งหมด · **แท็ก DEL แดงในตารางยังขึ้นครบทุกตัว** (คนละเรื่องกัน)
  - แก้ตรงนี้ **มีผลกับ Export Excel ของ filter นั้นด้วย** (filter chain ร่วมกันโดยเจตนา)
- **invariant: ตัวเศษกับตัวหารต้องมาจากชุดเดียวกันเสมอ** — เดิมตัวเศษวนจาก `scanData` แต่ตัวหารนับจาก `r01Data` คนละแหล่ง ทำให้ % ทะลุ 100 ได้เมื่อกรองข้างเดียว
- ⚠️ **อ่านค่า G จาก `state.r01Data` เท่านั้น** — เป็นแหล่งความจริงเดียวของยอดระบบ · `skuMap.systemQty` เก็บค่าดิบเหมือนกันแล้วตั้งแต่เลิก clamp (ส.ค. 2026 รอบ 2) แต่มันถูก derive มาอีกทอดและอาจค้างเมื่อ R05 ยังมาไม่ถึง
- `cat_coded:true` บน `{branch}_pm` เป็น **marker สำหรับดูบน Console เท่านั้น** ว่าสาขาไหนอัปไฟล์รุ่นใหม่แล้ว — **ไม่มีโค้ดอ่าน** อย่าเอาไปทำ logic
- ระหว่าง rollout เครื่องรุ่นเก่ายังนับ `G ≠ 0` อย่างเดียว (ไม่รู้จัก `cat`) จึงเห็น Total SKU **น้อยกว่า** เครื่องรุ่นใหม่ — บังคับให้โหลดรุ่นใหม่ครบก่อนอัป PBM ที่มี Col D
- ⚠️ **PBM เป็นตัวตัดสินตัวหารแล้ว → ทุกจุดที่ PBM/R01 เปลี่ยนต้องรีคำนวณ แม้ R05 ยังมาไม่ถึง** — guard เดิม `if(state.r05Data.length)rebuildMaps()` ทำให้ตัวเลขค้าง จึงต้องมี `else {_rebuildCountableSkus();updateStats();}` คู่กันทุกจุด (`applyProductMasterMeta`, `_applyR01BaselineUpdate`, `loadSession`, `restoreFromFirestore`, `restoreMasterFromFirestore` สาย "ไม่มี PBM")
  เรียก `rebuildMaps()` ทั้งก้อนแทนไม่ได้ เพราะมันเคลียร์ `skuMap`/`barcodeMap` ก่อนแล้ว early-return
- ไม่มี R01 → Total SKU = 0 จริงๆ (ตัด fallback chain เดิมที่ตกไปใช้ขนาด catalog ทิ้งแล้ว) · SKU ที่อยู่ใน PBM แต่ไม่มีแถวใน R01 ไม่นับ
- การ์ด `SKU BRANCH` ถูกลบ · WH เห็น Total SKU บน Desktop แต่ซ่อนบน PDA · ป้าย `Stock100 · `/`CatA · ` ใต้ Progress ถูกตัดออก
- ⚠️ ลบ/เพิ่มการ์ดใน `.stats-bar` ต้องไล่เลข `nth-child` ใน `@media(max-width:600px)` และจำนวนคอลัมน์ใน `@media(max-width:820px)` ใหม่ทุกครั้ง

### กฎราคาและสิทธิ์กรอกจำนวน (ย้ายมาที่ R05.106 Col B — ก.ค. 2026)

**ราคาผูกกับ "บาร์โค้ด" ไม่ใช่ SKU** — อ่านจาก R05.106 คอลัมน์ B (ราคาต่อหน่วยของบาร์โค้ดนั้น) ผ่าน `_parseProductMasterPrice()` เดิม
เดิมใช้ ProductMaster คอลัมน์ J ต่อ SKU · **ProductMaster คอลัมน์ J ยังอ่านอยู่แต่ไม่ใช่ตัวตัดสินกฎราคาแล้ว** (`rebuildMaps` เขียนทับ `skuMap.unitPrice` ด้วยค่าจาก R05)

- **สแกน `barcode,qty`** ใช้ราคาของ**บาร์โค้ดที่ยิงจริง** (`_canEnterCountQtyPrice(scanPrice)` ใน `handleBarcode`) → บาร์โค้ดกล่องแพงถูกบล็อกได้ แม้บาร์โค้ดเม็ดของ SKU เดียวกันจะกรอกได้ · สแกน SKU ตรง (`skuDirectMap`) ใช้ราคาหน่วยเล็กสุด
- **ช่อง QTY ใน RESULT row / stock popup** ผูกกับรายการไม่ใช่บาร์โค้ด → ใช้ `skuMap.unitPrice` ที่ `_baseUnitPrice()` derive มาจาก **บาร์โค้ดตัวคูณต่ำสุด**; ตัวคูณเท่ากันหลายอันเลือกราคาสูงสุด และถ้ามีตัวใดไม่มีราคา → `null` (บังคับสแกนทีละชิ้น)
- `< 1000` เท่านั้นที่แสดงและยอมรับช่อง QTY แบบยอดรวมหน่วยย่อย (absolute); `>= 1000`, ค่าว่าง/อ่านไม่ได้, Unknown, หรือบาร์โค้ดที่ไม่มีใน R05 ต้องสแกนทีละชิ้น
- **ข้อยกเว้นเดียวของกฎราคา (ส.ค. 2026): สินค้าที่ระบบว่าง `G ≤ 0` กรอกได้แม้ติดกฎราคา แต่รับเฉพาะค่า `0`**
  - จำเป็นเพราะกติกา A/B/C ดึงสินค้า `G=0` เข้าตัวหาร Progress แต่ "ชั้นว่างจริง" คือเคสปกติของกลุ่มนี้ → สแกนไม่ได้ (ไม่มีของให้ยิง) และปุ่ม 🚫 ติดเงื่อนไข `systemQty>0` → **ค้าง `pending` ถาวร Progress ไม่มีวันถึง 100%**
  - ไม่ขัดเจตนากฎเดิม: กฎมีไว้กัน "พิมพ์เลขผิดแล้วยอดพอง" ซึ่งการกรอก `0` ทำไม่ได้ · ของแพงที่มีของจริงบนชั้นยังต้องสแกนทีละชิ้นเหมือนเดิม (กรอกเลขอื่นยังถูกปฏิเสธ)
  - `_canEnterZeroOnly()` = เงื่อนไขแสดงช่อง · `_canEnterCountQtyValue(skuInfo,v)` = เงื่อนไขรับค่า — **ทั้งคู่ต้องแก้พร้อมกันเสมอ** ทั้ง 5 จุด (`renderScanList`, `patchScanRow`, `updateInlineQty`, `updatePopupQty`, `renderPopupTable`)
  - ⚠️ **ต้องอ่าน G ผ่าน `_rawSystemQty()`** (map `_r01RawQty` สร้างคู่กับ `_countableSkus` ใน `_rebuildCountableSkus()`) — ผูกกับ `state.r01Data` โดยตรง จึงถูกต้องแม้ `skuMap` ยังไม่ถูกสร้าง (R05 มาไม่ถึง → `rebuildMaps()` early-return)
  - ครอบทั้ง WH และสาขายา · `G<0` เข้าข่ายด้วย → กรอก 0 แล้ว Confirm ตัดสินด้วยสูตรปกติ (ลงตัวพอดี = pass · ไม่ลงตัว = audit) ดู §Status Lifecycle
  - เทสตรึงไว้ที่ `tests/specs/logic/zero-qty-gate.spec.js` (ตรึงทั้ง "0 ต้องผ่าน" และ "ค่าอื่นต้องไม่ผ่าน")
- **DEL กรอกได้แล้วถ้าบาร์โค้ดมีราคา < 1000** (เปลี่ยนจากเดิมที่บล็อกทุกกรณี — `_canEnterCountQty` ไม่เช็ค `isDel` อีกต่อไป)
- กฎราคาต้องครอบทั้ง RESULT row, stock popup, `barcode,qty` และฟังก์ชันแก้จำนวน — **จุดที่ตัดสินใจว่า "แสดงช่อง input หรือไม่" (`renderScanList`, `patchScanRow`) ต้องใช้กฎเดียวกับจุดที่ตรวจ** ไม่งั้นช่องจะโผล่ให้พิมพ์แล้วค่อยเด้งปฏิเสธ; ห้ามนำ threshold จาก `systemQty` กลับมา
- กฎนี้ไม่ใช้กับ Audit/Recheck และไม่เปลี่ยน `unitMultiplier` ของการสแกน Barcode ปกติ
- **หลัง deploy ต้องอัปโหลด R05.106 ใหม่หนึ่งครั้ง** เพื่อเติม `unitPrice` ให้ `global_r05` (ไฟล์กลางใช้ร่วมทุกสาขา อัปครั้งเดียวจบ) — ก่อนอัป ทุกบาร์โค้ดจะไม่มีราคา = สแกนทีละชิ้นทั้งระบบ (fail-safe โดยตั้งใจ)
- **`global_r05` เก็บเป็น array-of-arrays (`format:'r05a1'`) ไม่ใช่ object** — ของจริง 10,619 บาร์โค้ดในรูป object = **1,069 KB ชนเพดาน 1 MiB แล้ว Firestore ปฏิเสธเงียบๆ** (เจอ ก.ค. 2026 ทันทีที่เพิ่มราคา) แล้ว listener ดึง doc เก่ากลับมาทับ state ที่เพิ่งอัป ผู้ใช้เห็นแค่ "R05.106 อัปเดตจากเครื่องอื่น" โดยไม่รู้ว่าไฟล์หาย
  - เขียนด้วย `_serializeR05()` อ่านด้วย `_parseR05Json()` เสมอ — **ห้ามใช้ `JSON.stringify(state.r05Data)`/`JSON.parse` ตรงๆ กับ R05 อีก** และ `_lastAppliedR05Json` ต้องเป็นสตริงรูปแบบเดียวกับที่เขียนขึ้น cloud ไม่งั้น echo guard ของ listener พัง (เด้ง "อัปเดตจากเครื่องอื่น" ทุกครั้งแล้วทับตัวเอง)
  - `_parseR05Json()` ยังอ่านรูปแบบ object เดิมได้ **ห้ามถอด fallback จนกว่าทุกสาขาจะอัป R05 ใหม่**
  - รูปแบบใหม่ ~520 KB ที่ 10,619 บาร์โค้ด (เหลือที่ ~2 เท่า) ถ้าโตเกินนี้ต้องแตก chunk แบบ WH R16
- ⚠️ **มีบอทเขียน `global_r05` ให้ทุกเช้าแล้ว (ก.ย. 2026) ⇒ ตรรกะ parse/serialize ถูกเขียนไว้ 2 ภาษา** — `loadR05()` + `_parseProductMasterPrice()` + `_serializeR05()` ใน `index.html` มีคู่แฝดเป็น `parse_file()` + `parse_price()` + `serialize_r05()` ใน `auto-r05/auto_r05_import.py`
  **แก้ที่ใดที่หนึ่งต้องแก้อีกที่เสมอ** แล้วยืนยันด้วย `node tools/check-r05-parity.js "<R05.106.CSV>"` (ต้อง exit 0)
  ตัวตรวจเทียบถึงระดับ **สตริง JSON ที่จะเขียนลง Firestore** ไม่ใช่แค่โครงข้อมูล เพราะทั้ง echo guard ของ listener (`_lastAppliedR05Json`) และด่าน "เนื้อหาเหมือนเดิมจึงไม่เขียน" ของบอท ต่างก็เทียบสตริงตรงๆ — ต่างกันแม้ช่องว่างเดียวก็ทำให้บอทเขียนซ้ำทุกวันโดยเปล่าประโยชน์ และทุกเครื่องเด้ง toast ทุกเช้า
  ⚠️ **ห้ามเปลี่ยนชื่อ/signature ของ `parse_file()` กับ `serialize_r05()`** — `tools/check-r05-parity.js` import ตรงๆ
- **การ์ด R05.106 โชว์ "อัปโหลดล่าสุด" แล้ว (ก.ย. 2026)** — อ่านจาก field `updated_at` ของ doc โดยตรงผ่าน `_r05UploadedAtFromDocData()` → `_setR05Ts()` (คู่ขนานกับ `_r01UploadedAtFromDocData`/`_setR01Ts`) ⇒ **เป็นเวลาที่เขียนขึ้น cloud จริง ไม่ใช่เวลาที่เครื่องนี้โหลด**
  - ตั้งค่า 3 ทาง: `startR05Listener` · `loadR05` · `restoreMasterFromFirestore` · ล้างใน `selectBranch` + `clearAllData` (ตรงกับจุดที่ badge ถูกรีเซ็ต) · **ไม่ล้างใน `startNewCount()`** โดยเจตนา — R05 เป็น doc กลาง เริ่มนับใหม่ไม่แตะ
  - ⚠️ **ต้องเรียก `_setR05Ts()` ก่อน echo guard ใน `startR05Listener`** — snapshot แรกหลัง login มี `data_json` ตรงกับที่ `restoreMasterFromFirestore` เพิ่งใส่ใน `_lastAppliedR05Json` แล้ว listener จึง `return` ตรงนั้นทุกครั้ง · ย้ายไปตั้งทีหลัง = การ์ดว่างจนกว่าจะมีคนอัปไฟล์ใหม่ (อาการที่ไม่มีใครสังเกตเห็น) · ตรึงไว้ที่ `tests/specs/e2e/upload-path.spec.js`
  - การ์ดอยู่ใน `#r05UploadSection` ซึ่งซ่อนจนกว่าจะเข้า Admin Mode (เดิมเป็นแบบนี้อยู่แล้ว)
  - ⚠️ **วันที่ "อัปโหลดล่าสุด" ไม่ขยับ ≠ บอทพัง** — `auto-r05` ไม่เขียนถ้าตารางบาร์โค้ดไม่เปลี่ยน เวลาจึงค้างที่รอบก่อนโดยตั้งใจ (เคสจริง 11–14 ก.ย. 2026 ค้าง 3 วันเพราะบาร์โค้ดไม่เปลี่ยนจริง ๆ)
  - **การ์ดจึงมี 2 เวลาแล้ว (ก.ย. 2026):** `อัปโหลดล่าสุด` (จาก `global_r05.updated_at`) คู่กับ `ตรวจล่าสุด` (จาก **`stock_sessions/global_r05_status.checked_at`** — doc แยกที่บอทเขียนทุกรอบที่ตรวจสำเร็จ รวมรอบที่ไม่ได้เขียนข้อมูล) · `checked_at` ไม่ใช่วันนี้ = การ์ดขึ้น `⚠️ บอทยังไม่ได้ตรวจวันนี้`
    - ⛔ **ห้ามย้าย `checked_at` ไปไว้ใน `global_r05`** — การอัปผ่านเว็บเป็น `set()` ทั้ง document จะลบ field ส่วนเกินทิ้ง สัญญาณจะหายเงียบ
    - ⛔ **บอทห้ามเขียน `checked_at` เมื่อตกด่าน** (ไฟล์ไม่สด/หัวคอลัมน์เพี้ยน/หยิบไฟล์ผิด) ไม่งั้นการ์ดเขียวทั้งที่บอทหยุด
    - อ่านผ่าน `refreshR05CheckedTs()` ตอน login + ตอน listener เห็นข้อมูลใหม่ · ไม่ต้องแก้ `firestore.rules` (doc ใหม่ใต้ `stock_sessions` เขียนได้ตามกฎที่ Publish อยู่) · เทส `tests/specs/logic/r05-checked-ts.spec.js`
  - **เคสจริงที่ทำให้ต้องมี (11–14 ก.ย. 2026):** `updated_at` ค้าง 3 วัน แล้วแยกไม่ออกว่า "ไม่เปลี่ยนจริง" หรือ "บอทพัง" — ต้องไล่ถึงขั้น remote เข้า `BIGYAMAINPC` เปิด log
    คำตอบคือ**ไม่เปลี่ยนจริง** (`LastTaskResult=0` ทุกวัน) · พอเนื้อหาเปลี่ยนวันที่ 14 บอทก็เขียนเอง — ที่ต่างคือแถวเดียว: SKU `901320` เคยใช้รหัสสินค้าเป็นบาร์โค้ด เปลี่ยนเป็น EAN จริง `8850678305189` (จำนวนแถวเท่าเดิม 10,864 จึงดูเหมือนไม่มีอะไรเปลี่ยน)
    ⚠️ **จำนวนแถวเท่ากันไม่ได้แปลว่าข้อมูลเหมือนกัน** — บอทเทียบทั้งสตริง ห้ามเปลี่ยนไปเทียบแค่ `row_count`
  - ⚠️ **รูปแบบวันที่ EXP ใน R14.102 ต่างกันได้ตามเครื่องที่ export** (`1/1/1999` หรือ `01-Jan-99`) — ทดสอบ 14 ก.ย. 2026 แล้วว่า `parseTranDate()`+`_toBeDMY()` แปลงถูกทั้งคู่ (ได้ `01/01/2542` เท่ากัน) **ห้าม "แก้" ให้เหลือรูปแบบเดียว** โดยไม่ทดสอบทั้งสองแบบก่อน
- toast ตอนอัปโหลดโชว์ขนาดจริงทุกครั้ง เตือนเมื่อ ≥ 800 KB และ **ถ้าเขียน cloud ไม่ผ่านต้องเด้ง error ให้ผู้ใช้เห็น** (`syncMasterToFirestore` เดิม catch เงียบ)

`_countResetAt` — module-level ISO timestamp, reset epoch (monotonic). ใช้ `>` เปรียบเทียบ lexicographic
`_r01BaselineAt` — module-level ISO timestamp, อัพ R01 ล่าสุดบน**สาขายา**เท่านั้น (`_isPharmacyBranch()`) — ตัวตัดสิน `_isPreBaselineItem` (freeze audit/pass ที่นับก่อน baseline — audit อยู่รอดข้ามการอัพ R01 ให้เภสัชรีเช็ค) + trigger ล้าง R16 ข้ามเครื่อง ดู [[SKILL-data-files]] R01 Daily Baseline

WH R16 raw timeline เก็บ cache ใน IndexedDB (`stock-count-cache` / `r16Snapshots`) แต่ Cloud meta/chunks เป็น source of truth เครื่อง Supervisor ต้องโหลด generation ที่ตรงกับ R01 และ `countResetAt` ก่อน Confirm

### Status Lifecycle

```
สาขายา (SRC/KKL/SSS) — ตั้งแต่ 29 ก.ย. 2026 ไม่ผ่าน Audit:
pending → scanning → pass
                   → stock_adjustment  (ไม่ตรง: directAdj — แช่ effectiveQty/systemQty ตอน Confirm)
                   → stock_adjustment  (noStock — ผู้ช่วยยืนยันชั้นว่างทั้งที่ระบบมีของ)

WH · Audit ที่ค้างอยู่ก่อนสลับ · สวิตช์ PHARMACY_DIRECT_STOCK_ADJ ปิด:
pending → scanning → pass
                   → audit → (verify pass)  → pass
                           → (verify fail)  → stock_adjustment
```
`unknown` = barcode ไม่พบในระบบ (parallel track)
`audit_check` = legacy, ยังอยู่ใน codebase แต่ไม่ถูกผลิตใหม่แล้ว
`negSys` = **ตายแล้ว (ส.ค. 2026 รอบ 2)** — เลิก clamp ค่าติดลบ ธงจึงเป็น `false` เสมอ · field ยังอยู่ใน `skuMap` ห้ามลบ (`showZeroSysModal` อ่านอยู่)

**สาขายา — ตัดขั้น Audit (29 ก.ย. 2026 · ผู้ใช้สั่ง · สลับกลางรอบโดยไม่ `startNewCount`)**
Confirm รอบแรกไม่ตรง → `stock_adjustment` ทันที · ตัดสินที่ `_buildPendingScanEvaluation` ผ่าน `_directStockAdjEnabled()` = สวิตช์ `PHARMACY_DIRECT_STOCK_ADJ` (`let` — เทสสลับกลับได้ · rollback = ตั้ง `false` แล้ว deploy) **&& `_isPharmacyBranch()`** ⇒ **WH คง `audit` เสมอ** (`evaluatePendingScans` ยังถูกเรียกจากทางที่ไม่ใช่สาขายา)
- **ทุกกลุ่มไม่ผ่าน Audit รวม G≤0/ติดลบ** — ย้อนกติกา ก.ค. 2026 ("ระบบ 0 แต่สแกนเจอของ = เภสัชรีเช็คก่อน ห้ามลัดไป stock_adjustment") ตามคำสั่งผู้ใช้ที่รับทราบผลแล้ว: G=0 ยิงครั้งเดียว → IRPS เพิ่มสต็อก ERP ทันที · ติดลบที่ R16 อธิบายไม่ได้ → ปรับทุกวัน · ปุ่ม `📦 ค้างส่ง` ใช้ได้เฉพาะรายการ Audit เดิม
- รายการที่ออกทางนี้ติด **`directAdj:true` + แช่ `effectiveQty`/`systemQty` ณ ตอน Confirm** (ชื่อ field เดียวกับที่ audit marker ใช้ · `_scanItemPayload` พาขึ้น Cloud เอง) · `initialStatus` ยังเป็น `'stock_adjustment'` (ไม่ใช่ `'audit'`) · **`noStock` ไม่ตั้ง `directAdj`**
- **Audit ที่ค้างอยู่ตอนสลับคงอยู่ใน flow Audit เดิมต่อ ห้ามแปลงอัตโนมัติ** (ยอดรีเช็คที่เภสัชกรอกไว้จะหาย + ส่วนหนึ่งจะ Pass เอง) — ต.ค. 2026 ผู้ใช้สั่งแปลงตัวที่ยังไม่มีใครรีเช็คด้วยเครื่องมือครั้งเดียว `tools/convert-legacy-pharmacy-audits.js` (คนสั่งเอง ไม่ใช่ runtime · ดู §สาขายาไม่มีคำว่า Audit) · **ห้ามลบโค้ด Audit Verify / markers / `confirmAuditVerifyItem` / `backorder`** — ยังใช้กับของเดิมและรายการที่ ↺ ย้อนกลับมา
- **ฐานตัวเลข Stock Adj ตรง = `effectiveQty − systemQty` ที่แช่ไว้** ผ่าน `_directAdjPair(sd)` ครบ 5 จุด (`_buildAdjustDocRows` · `_adjustDocAudit` · Audit Verify แท็บ Stock Adj · ประวัติการนับแท็บ Stock Adj · `exportStockAdjExcel`) — ⛔ ห้ามใช้ `countedQty − ยอดสด`: `countedQty` เป็นยอดดิบ (ไม่รวม R16 ชดเชย) และเทียบข้ามเวลากับ R01 วันถัดไป · ไม่มีด่านความสด (ฐานแช่ไว้ ไม่หมดอายุ) · ดู §Pharmacy Audit Verify → ใบปรับปรุง
- **ทางถอยทางเดียว = ↺ `reopenPharmacyAudit`** (รับ `directAdj` แล้ว · ล้างธง + `initialStatus='audit'` → Audit ปกติ) · `reEvaluateAuditItems` **ไม่แตะ** Stock Adj ตรง (R16 อัปทีหลังไม่ flip · ระบบยังไม่มี `issuedAt`)
- `saveAuditLogToFirestore` ใช้ `_wasFirstCountMismatch(sd)` (= `initialStatus==='audit' || directAdj`) + log `directAdj/effectiveQty/systemQty` · **`_backfillPharmacyAuditMarkersFromLog` ข้ามรายการ `directAdj`** (ไม่งั้นถูกฟื้นเป็น Audit) · บาร์ "เภสัชตรวจแล้ว" ไม่นับ `directAdj` (`updateStats`)
- ⚠️ **ข้อเสียที่ผู้ใช้รับทราบแล้ว:** SKU ที่นับไม่ครบตอน Confirm กลายเป็น Stock Adj (สแกนซ้ำ/✕ ไม่ได้ · ใช้ ↺ ย้อนทีละตัว) · R16/R01 คลาดเวลา → ลง ERP ตรงๆ (เคส 200379/OTFI ที่เคยติด Audit) · ไม่มีผู้ตรวจคนที่สอง (`auditor` ว่าง)
- เทสตรึงไว้ที่ `tests/specs/{logic,e2e}/pharmacy-direct-adj.spec.js`

**กฎ "สแกนครั้งแรกนับ 0" ถูกถอดออกหมดแล้ว (ส.ค. 2026) — ห้ามนำกลับมา**
ทั้ง G=0 และ G ติดลบ สแกนแล้ว **บวกตามปกติ** เหมือน SKU อื่น
- **G = 0** → ยิงมาจริง → ไม่ตรง → `audit` (**สาขายาตั้งแต่ 29 ก.ย. 2026 = `stock_adjustment` ตรง** ดูบล็อกด้านบน) · จะอยู่ใน Progress หรือไม่ขึ้นกับ PBM Col D (A/B/C/REVIEW = อยู่) ดู §Total SKU / Progress
- **G ติดลบ → ตัดสินด้วยสูตรปกติ `effectiveCnt === sys` (ส.ค. 2026 รอบ 2 — เปลี่ยนจากเดิมที่บังคับ audit เสมอ)**
  - **เลิก clamp แล้ว** — `_clampNeg=false` ทุก branch ใน `rebuildMaps()` → `skuMap.systemQty` เก็บค่าติดลบดิบ · `negSys` เป็น `false` เสมอ
  - เหตุผลที่ถอดกฎเดิม: สมมติฐาน *"ติดลบ = ข้อมูลผิดแน่นอน"* **ไม่จริง** — เคสจริงคือจ่ายของให้ลูกค้าเท่าที่มีแต่ R01 ของไม่พอ ยอดเลยติดลบ (ค้างลูกค้า) พอคลังส่งของมาเติมก็ถูกต้องแล้ว แต่ระบบยังบังคับ audit ทุกวันทั้งที่ไม่มีอะไรผิด
  - พอ `sys` เป็นค่าดิบ สูตรเดิมตัดสินได้ถูกเอง **ไม่ต้องแก้สูตร Confirm**:
    `R01 = −2` · คลังส่ง 5 (R16 inbound) · นับได้ 3 → `effectiveCnt = 3 − 5 = −2 === sys(−2)` → **pass**
  - ตัวคุมความปลอดภัยเปลี่ยนจาก "ธง `negSys`" เป็น **"สูตรต้องลงตัวพอดี"** ซึ่งเข้มกว่าเพราะต้องมีหลักฐาน R16 มายืนยัน:
    `R01 = −2` · ไม่มีรับเข้า · นับ 0 → `0 ≠ −2` → **ไม่ตรง** (`audit` · สาขายาตั้งแต่ 29 ก.ย. 2026 = `stock_adjustment` ตรง)
  - ⛔ **ห้ามนำ clamp กลับมา** — clamp ทำให้ `sys` เป็น 0 แล้ว "นับ 0" จะ pass เงียบๆ จนต้องมีธง `negSys` มากันอีกชั้น (วงจรเดิมที่เพิ่งถอดออก)
  - ⚠️ `_buildPendingScanEvaluation` กับ `reEvaluateAuditItems` ต้องใช้กติกาเดียวกันเป๊ะ ไม่งั้นอัพ R16 ใหม่แล้วสถานะแกว่ง
  - **ผลพลอยได้: แก้บั๊กใบปรับสต็อกที่ซ่อนอยู่** — เดิม clamp ทำให้ `diff = cnt − 0` ของติดลบที่รีเช็คได้ 0 กลายเป็น `0`
    แล้วถูกกรองออกจาก **ทั้ง ORDS และ IRPS** (`diff>=0` / `diff<=0`) → แถวหายเงียบ ยอดติดลบไม่เคยถูกแก้ในระบบ · ตอนนี้ได้ IRPS `+2` ถูกต้อง
  - เทสตรึงไว้ที่ `tests/specs/logic/negsys-pass.spec.js` (ตรึง "อธิบายได้ → pass", **"อธิบายไม่ได้ → ต้องไม่ pass"** และ "ใบปรับสต็อกต้องไม่หายเงียบ") — ทำงานใน context ไม่มีสาขา (ทางเก่า `audit`) · ผลของสาขายาหลัง 29 ก.ย. 2026 อยู่ที่ `pharmacy-direct-adj.spec.js`
- `zeroSysModal`/`showZeroSysModal`/`confirmZeroSys` ยังเป็น dead code ที่ต้องเก็บไว้ และ `_zeroSysHold` ยังเป็น hold-guard ทุกจุด **ห้ามลบ**
- **ยอดรีเช็ค 0 รองรับแล้ว** (`updatePharmacyRecheckQty` + `getPharmacistAuditPendingMap`) = "เภสัชดูแล้วไม่มีของ" ต่างจาก "ยังไม่รีเช็ค" (`recheckQty == null`)
  จำเป็นเพราะ negSys ส่วนใหญ่ไม่มีของจริง ถ้ากรอก 0 ไม่ได้จะค้าง audit ถาวร · ผลตัดสินใช้สูตรเดิม (เทียบกับ `recheckSystemQty` ที่ freeze ไว้)
`noStock` = สาขายาเท่านั้น: ระบบมี stock แต่ผู้ช่วยยืนยันว่าไม่มีของจริง → Confirm เป็น `stock_adjustment` ตามกติกาปัจจุบัน
`backorder` = **สาขายาเท่านั้น: เภสัชมาร์คว่า "ค้างส่งลูกค้า" (ส.ค. 2026 รอบ 2)** — เคสกลับด้านของ `noStock`
- ปุ่ม `📦 ค้างส่ง` ในป็อปอัพ Audit Verify · `_canMarkBackorder()` เปิดเฉพาะ `status==='audit'` + ยังไม่มี `auditor` + role เภสัช + **`_rawSystemQty(sku) <= 0`** (ระบบไม่มีของ) · **ตั้งแต่ 29 ก.ย. 2026 ใช้ได้เฉพาะรายการ Audit เดิม** — Confirm ใหม่ของสาขายาไม่ผ่าน audit จึงไม่มีที่ให้กด (ผู้ใช้รับทราบ) · ↺ ย้อนรายการกลับมาเป็น Audit แล้วกดได้
- **ทำไมต้องมี:** ยอดติดลบเกิดเพราะการขายถูกบันทึกแล้วแต่ของยังไม่เข้า = เป็นหนี้ลูกค้าอยู่จริง
  ถ้าออกใบปรับสต็อกดันยอดกลับเป็น 0 = ลบร่องรอยหนี้ แล้วส่วนต่างไปโผล่ใหม่ตอนของเข้า
  (`ปรับเป็น 0` → คลังส่ง 5 → ระบบ 5 · ของจริง 5 → จ่ายของค้าง 2 ที่ขายไปแล้ว → ระบบ 5 · ของจริง 3 = **เพี้ยน**)
- **เดินรางเดียวกับ "รีเช็คได้ 0" ทุกประการ** — `markBackorderItem()` ตั้ง `recheckQty=0` + `recheckBy/At` + `_freezeRecheckBaseline()` แล้วเติมธง `backorder:true`
  จึงเข้าคิว `getPharmacistAuditPendingMap()` เองโดยไม่ต้องแก้ · **ไม่บันทึกจำนวนปลอม** — 0 คือของจริงบนชั้น ธงบอกว่า "ว่างเพราะค้างส่ง ไม่ใช่ของหาย"
- `confirmAuditVerifyItem()` เช็ค `sd.backorder` **ก่อนสูตร** → `pass` (ถ้าปล่อยลงสูตร `0` ไม่มีทางเท่า `baseSys` ติดลบ → จะได้ `stock_adjustment`)
- **กด PDA ได้ แต่ pass จริงตอน Confirm บน Desktop** — ตรงกับรูปแบบเดิม "PDA มาร์ค → Desktop ยืนยัน" (ปุ่ม Confirm ยัง guard `_isPdaApp()`)
- ⚠️ **ธงต้องเดินทางครบทุก path** — marker payload, `_applyPharmacyAuditMarkersToState` (ตั้ง/ล้าง), audit log, `resetRecheckItem`, `reopenPharmacyAudit`, `_addRecheckScanQty` (สแกนทับ = ถอนธง), reset ข้ามรอบ
  `_scanItemPayload`/`_scanItemFingerprint` พาไปเองเพราะวนทุก field ที่ไม่ใช่ `SCAN_ITEM_LOCAL_FIELDS`
- ⚠️ **`_sameBranchRecheck()` ต้องเทียบ `backorder`** — ธงพลิกผลจาก `stock_adjustment` เป็น `pass` ถ้าไม่เทียบ คนกดปุ่มกลางงาน Confirm จะไม่ถูกจับว่าเปลี่ยน
- **ข้อจำกัดที่ยอมรับแล้ว:** ไม่ได้แก้ R01 → พรุ่งนี้ยอดยังติดลบ เข้า audit ใหม่ ต้องกดอีก จนของเข้าจริง (แล้ว R16 จะอธิบายได้เอง)
  และถ้าเภสัชกดกับของที่หายจริง ยอดจะไม่มีวันถูกแก้ — ร่องรอยมีแค่ `auditor` + `backorder` ใน Audit Log
- เทสตรึงไว้ที่ `tests/specs/logic/backorder-mark.spec.js` (ตรึงทั้ง "มาร์คแล้วไม่เข้าใบปรับสต็อก" และ **"ไม่ได้มาร์คต้องยังเข้าใบเหมือนเดิม"**)

สูตร Confirm รอบแรกห้ามเปลี่ยนโดยพลการ:

```text
effectiveQty = countedQty + soldQty + r16103Qty - inboundQty
```

⚠️ **`soldQty` ไม่รวมบิลที่ถูกยกเลิก (ก.ย. 2026)** — R16.104 คอลัมน์ J (`FCANCEL`) เท่ากับ `1` คือบิลยกเลิก สินค้าไม่ได้ออกจากชั้นจริง `loadR16()` จึงข้ามทั้งแถว
เดิมไม่เคยอ่านคอลัมน์นี้ ⇒ ยอดขายพองเกินจริง → **ของที่พนักงานนับถูกต้องติด audit** (อาการที่ผู้ใช้รายงาน)
- ⛔ **ห้ามเปลี่ยนเป็น "เก็บเฉพาะค่า 0"** — ไฟล์ที่ไม่มีคอลัมน์นี้/ส่งค่าว่างจะถูกทิ้งทุกแถวเงียบๆ แล้วติด audit ยกแผง · รายละเอียดและเทสอยู่ใน [[SKILL-data-files]] §Col J
- ⚠️ **หลัง deploy ต้องอัปโหลด R16.104 ใหม่ 1 ครั้ง** ถึงจะมีผล — ยอดที่อัปไปแล้วถูกบวกรวมเก็บบน cloud และไม่มีตัวไหนทำให้ chunk เก่าหมดอายุตามรุ่นของ parser
- ใช้กับ R16.104 อย่างเดียว **ไม่แตะ `loadR16_103`** (ยังไม่ยืนยันว่าไฟล์จริงมีคอลัมน์นี้)

⚠️ **`inboundQty` ของ SRC ไม่รวม OTFI/OTFB ที่ Col A (`SYSWAREHOUSEID`) = 0 (29 ก.ย. 2026 · commit `1feb7a5`)** — SRC อยู่ `SYSBRANCHID` เดียวกับคลังชากค้อ แต่แยกได้ด้วย Col A (0=คลัง · 1=หน้าร้าน) · Col A=0 = คลังโอนออก ของไม่เข้าหน้าร้าน → `isSrcOtfiSkip` ข้าม
- เดิมหักเป็นรับเข้า ⇒ ของที่นับตรงติด audit/Stock Adj (28 ก.ย. โดน 14/16 รายการ เช่น 900202: `2 − 1 = 1 ≠ 2`)
- ⛔ **ห้ามขยายไป KKL/SSS โดยไม่มีไฟล์ยืนยัน** — Col A=0 ของสองสาขานั้นคือตัวร้านเอง · ยังไม่ยืนยัน: ORCM/OCTM ที่ Col A=0 (ขายจากคลัง) ยังบวกกลับให้หน้าร้าน · หลักฐาน/เทสอยู่ [[SKILL-data-files]] §R16.104 + `r16-src-otfi.spec.js`
- ⚠️ **R16 ไม่มีขอบล่างของเวลาในโค้ด** (`get*QtyBefore` กรองแค่ `td <= scanTimestamp`) ⇒ ตัวไฟล์ต้องครอบ **[เวลา export R01 ที่ใช้อยู่ → เวลานับล่าสุด]** เท่านั้น · และ `reEvaluateAuditItems()` ท้าย `loadR16()` รันโดยไม่ดู `r16DateMismatch` (ธงนั้นกั้นแค่ Confirm รอบแรก) — อัป R16 ผิดช่วง = สถานะถูกตัดสินใหม่ทันที

ห้ามแก้เครื่องหมายบวก/ลบ, TRANDATE cutoff, การจัดการค่าติดลบ, เงื่อนไข `noStock` หรือความหมายของ Pass/Audit/Stock Adjustment โดยไม่ได้รับอนุมัติ**พร้อมชุดทดสอบข้อมูลจริง**

WH Recheck รอบสองเปรียบเทียบ `recheckQty` กับ `systemQty` จาก `WH_r01` ล่าสุดโดยตรง ไม่ใช้ local `skuMap` ที่อาจค้าง

### Roles & Branches

| Role | Branch | สิทธิ์หลัก |
|---|---|---|
| assistant | SRC/KKL/SSS | สแกนนับ |
| pharmacist | SRC/KKL/SSS | **ออกใบ Stock Adj (📦 ปรับปรุงสินค้า) + ↺ ย้อนรายการ + รีเช็คได้ตลอด** — ต.ค. 2026 จอไม่มีคำว่า Audit: `audit` เรียก "รอรีเช็ค" · ปุ่ม "✓ ยืนยันรีเช็ค" (§สาขายาไม่มีคำว่า Audit) · **6 ต.ค. 2026 (รอบ 3):** รอรีเช็คขึ้นใบ 📦 ทันที + แก้ "จำนวน" ในใบได้ + ปิดโหมดซ่อน (ช่องสแกน/ปุ่มยืนยันรีเช็คอยู่ตลอด แม้ไม่มี audit ค้าง) — §📦 รอรีเช็คขึ้นใบทันที · (โหมดซ่อน 30 ก.ย. ยังอยู่ในโค้ดเป็นทางถอย: `PHARMACIST_STOCKADJ_ONLY`) |
| supervisor | WH | ยืนยันนับ + ยืนยันรีเช็ค (Desktop only) |
| warehouse | WH | สแกนนับ + สแกนรีเช็ค (PDA) |

สาขายา (`SRC`/`KKL`/`SSS`) ใช้ Confirm รอบแรกบน Desktop เท่านั้น ปุ่มถูกซ่อนและ guard ด้วย User-Agent `StockCountPDA` โดยตรง ไม่อิง viewport
Audit Verify ของเภสัชก็เช่นกัน — สแกนรีเช็คบน PDA ได้ แต่ปุ่มยืนยันถูก disable และ guard ด้วย `_isPdaApp()`

### Firestore Workflow Documents (ปัจจุบัน)

| Document ใน `stock_sessions` | หน้าที่ |
|---|---|
| `{branch}` | session หลัก — `schemaVersion:2` = metadata อย่างเดียว (ไม่มี `scanData`/`scanListMap`) |
| `{branch}/items/{sku}` | **schema v2:** 1 document ต่อ SKU ต่อรอบนับ (subcollection) |
| `{branch}_r01` | R01 master/version + R16 upload metadata |
| `{branch}_pm` | **Product Branch Master** — catalog ชื่อสินค้า + การจัดชั้น Col D ต่อสาขา (`SRC_pm`/`KKL_pm`/`SSS_pm`/`WH_pm`) · ส.ค. 2026 แทน `global_pm` · field `cat_coded:true` = แถวมี `cat` แล้ว (ตัวสวิตช์ของกติกา A/B/C) |
| `global_r05` | shared Barcode master (ยัง global — ใช้ร่วมทุกสาขา) |
| `global_pm` | **legacy read-only** — ไม่มีโค้ดอ่าน/เขียนแล้ว เก็บไว้เพื่อ rollback **ห้ามลบ** |
| `WH/confirm_ops/{opId}` | WH workflow v2 operation; publish ทั้งชุดด้วย `state:'committed'` |
| `WH/confirm_ops/{opId}/results/{sku}` | ผล Count/Recheck ที่เตรียมไว้ต่อ SKU; reader ใช้เมื่อ parent op committed และ hash ครบเท่านั้น |
| `WH_counts`, `WH_count_confirmations` | legacy Count inbox/marker — dual-read ระหว่าง compatibility เท่านั้น ห้ามใช้เขียน final ใหม่ |
| `WH_rechecks`, `WH_recheck_confirmations` | legacy Recheck inbox/marker — dual-read ระหว่าง compatibility เท่านั้น ห้ามใช้เขียน final ใหม่ |
| `WH_r16_104_meta`, `WH_r16_103_meta` | active timeline generation/version |
| `WH_r16_{kind}_{generation}_{index}` | R16 chunk เป้าหมายไม่เกินประมาณ 650 KB |
| `{branch}_confirm_lock` | Pharmacy Desktop Confirm lock (SRC/KKL/SSS) |
| `{branch}_pharmacy_audit_markers` | authoritative Pharmacy Audit worklist/final result (SRC/KKL/SSS) |
| `WH_location` | location + zone/staff mapping |

### Scan data schema v2 (ก.ค. 2026) — 1 document ต่อ SKU

เดิม `scanData` ทั้งชุดถูก serialize ลง `session_data_json` ก้อนเดียว ทำให้ชนเพดาน 1 MiB ของ Firestore
เมื่อนับครบทั้งสาขา (~5,400 SKU × ~305 B ≈ 1.6 MB) และบังคับให้ต้องเขียน merge เองทุกกรณี

- `_schemaVersion===2` (อ่านจาก field `schemaVersion` ใน session doc) = สาขานี้ cutover แล้ว ค่าอื่น = เดิน blob path เดิมทั้งหมด
- **rollback = ตั้ง `schemaVersion` กลับเป็น 1 พร้อมคืน blob จาก `{branch}_v1_backup`** โค้ด blob เดิมยังอยู่ครบ ห้ามลบจนกว่าจะผ่านรอบนับจริงอย่างน้อย 2 รอบ
  หลัง Publish schema guard แล้ว Browser/PDA ทำ rollback เองไม่ได้: ต้องหยุด client ทุกเครื่องและใช้สิทธิ์ผู้ดูแล หรือผ่อน Rules ชั่วคราวใน maintenance window แล้ว Publish guard กลับทันที
- cutover ทำได้ 2 ทาง: `startNewCount()` (ตอน `scanData` ว่าง) หรือ `migrateSessionToSchemaV2()` (ระหว่างรอบนับ) — **ห้าม dual-write blob+items**
- **ทั้ง 4 สาขาเป็น v2 แล้ว (7 ก.ย. 2026)** — SRC/WH ด้วย live migration (24 ก.ค.) · SSS ตอน `startNewCount()` (5 ส.ค.) · KKL ตอน `startNewCount()` (7 ก.ย.)
  ⚠️ **`{branch}_v1_backup` มีเฉพาะ SRC/WH** — `startNewCount()` ไม่สร้าง backup ให้ (ต่างจาก `migrateSessionToSchemaV2()`) ⇒ KKL/SSS ไม่มี snapshot v1 เหลืออยู่เลย
  และ rollback ถูก Rules ปิดไปแล้ว (`preservesScanSchemaVersion` ปฏิเสธ `2 → 1`) ⇒ **ทางกลับมีทางเดียวคือ backup ที่ดาวน์โหลดไว้เองก่อนกดปุ่ม**
- ระหว่าง migrate ต้องหยุดสแกนสาขานั้น — เครื่องที่ยังเป็น v1 เขียน session doc ด้วย `ref.set()` แบบไม่ merge
  ถ้าเขียนหลัง cutover จะลบ field `schemaVersion` ทิ้งแล้วทุกเครื่องหลุดกลับ v1 พร้อมกัน
- ไม่เขียน doc สำหรับ `pending` — ไม่มี doc = `pending` (ตรงกับพฤติกรรม cloud เดิมที่ merge rule กัน pending ไม่ให้ขึ้น)
- เขียนผ่าน dirty queue: `_markSkuDirty(sku)` → `_flushDirtySkus()` debounce 800 ms → `writeBatch` 450 ops/ชุด
- `scanning` เขียนด้วย `runTransaction` ต่อ item + **delta** (`countedQty` ปัจจุบัน ลบค่าที่ sync แล้วใน `_scanItemSynced`)
  ห้ามกลับไปใช้ "เลือก `countedQty` ที่สูงกว่า" — สอง PDA สแกน SKU เดียวกันจะทำยอดหาย
- `_writeScanningItem()` ต้อง freeze `startQty`/payload ก่อน `await transaction`; หลัง commit ให้บวกเฉพาะ scan ที่เกิดระหว่างรอเข้ากับยอด commit
  และตั้ง `_scanItemSynced` จาก payload ที่ commit จริงเท่านั้น — ห้ามนำผล transaction เก่าทับ local ล่าสุด (เคยทำให้ WH เด้ง 13→11, 15→13)
- WH PDA scan queue ใช้ `scheduleStatsAfterScan()` รวม full stats refresh หลังหยุดยิง 1 วินาที; scan row/qty และ Cloud sync ต้องยังทำทันที
  ห้ามกลับไปเรียก `updateStats()`/`scheduleStats()` ทุก scan เพราะหนึ่ง refresh กวาด catalog หลายรอบและทำให้ PDA หน่วง
- `manualEditAt` สด = เขียนทับตรงๆ (absolute) ไม่ใช่ delta — ผู้ใช้สั่ง "ให้เป็นเลขนี้"
- listener ข้าม `snapshot.metadata.hasPendingWrites` และข้าม SKU ที่อยู่ใน `_dirtySkus`/`_scanItemInFlight`
  **ห้ามลบ guard นี้** — echo ของ write ตัวก่อนจะดึงยอดกลับไปค่าเก่าหลังผู้ใช้สแกนเพิ่ม
- `_scanItemToLocal()` ต้องคง `scans`/`retries`/`manualEditAt` ของเครื่องเดิมไว้ — `scans` ถูกอ่านโดย `_zeroSysFirstScan`
  ถ้าล้างทิ้ง สินค้า `negSys`/`systemQty===0` จะถูกมองว่า "สแกนครั้งแรก" ซ้ำแล้วบันทึก 0 อีกรอบ
- `_reconcileScanItems()` (ทุก 60 วิ + ก่อน sync metadata) เป็น safety net หา SKU ที่ mutation site ลืม mark
- Confirm อ่านเฉพาะ status ที่ต้องใช้ (`scanning` / `audit`) และตรวจ "เปลี่ยนกลางงาน" ด้วย `rev`
- ⚠️ **doc id คือ SKU ใช้ร่วมทุกรอบ ⇒ เศษรอบเก่าที่ `startNewCount` ลบไม่หมดอยู่ใต้ id เดียวกับของรอบใหม่** (SRC 22 ก.ย. 2026 · รีเฟรชระหว่างลบ → ค้าง ≥500 docs)
  query ตามรอบกรองได้ แต่อ่านตาม id (`tx.get(ref)`) เจอเศษเสมอ ⇒ **ทุกจุดที่อ่าน item ตาม id ต้องเช็ค `countResetAt` เอง**
  - `_writeScanningItem` ถือเอกสารรอบอื่นเป็น "ไม่มี" · ⛔ ห้าม abort `confirmed` จากเอกสารที่ไม่ใช่รอบนี้ — เดิมดึง pass ของรอบ 19 ก.ค. มาทับยอดที่เพิ่งสแกนแล้วเขียนกลับในนามรอบใหม่ (26 ก.ย. เจอ 9 รายการ)
  - login สาขายา: confirmed ในเครื่องที่ Cloud รอบนี้ไม่มีเอกสาร → รีเซ็ตเป็น pending ก่อน reconcile (กติกาเดียวกับ blob เดิมที่หายไปตอนย้ายเป็น v2)
  - เทส `tests/specs/e2e/stale-round-resurrect.spec.js` · ล้างเศษบน cloud `tools/cleanup-stale-round-items.js` · ไล่อาการ `tools/diagnose-reset-resurrect.js`
  - ⚠️ ตัดสินว่า "ของรอบเก่าที่ถูกเขียนกลับ" ต้องใช้ค่าที่**ใหม่กว่า**ระหว่าง `firstScanAt` กับ `timestamp` — ✕ (`removeScanItem`) ไม่ล้าง `firstScanAt` งานจริงที่โดนดึงผลเก่าแล้วกด ✕ สแกนใหม่จึงมีเวลาสแกนครั้งแรกเป็นวันรอบเก่า (SRC 26 ก.ย.: เกณฑ์แรกเกือบลบ 800424 ที่ Confirm ในรอบนี้แล้ว) · ผลจริงที่ล้างไป: เศษรอบ 19 ก.ค. หมด + คืน 40 รายการ
  - ✅ **`startNewCount` แข็งแรงขึ้นแล้ว (26 ก.ย. 2026):** ลบ items **ทุกรอบที่ไม่ใช่รอบใหม่** (`_deleteScanItemsNotInEpoch` — เดิมลบแค่รอบก่อนหน้า · วนจน query ว่างจริง เพดาน 100 ชุด)
    · ถือ branch lock **ทุกสาขาที่ใช้ lock** (เดิมเฉพาะ WH — สาขายากดชน Confirm ของ Desktop อื่นได้ ผล Confirm บางส่วนจะถูกเขียนลงรอบใหม่ผิดๆ)
    · `_restampBranchConfirmLock` เปลี่ยนป้ายรอบบน lock เป็นรอบใหม่**ก่อนลบ** — ไม่งั้นเครื่องที่รับรอบใหม่แล้วมองว่า lock ป้ายรอบเก่า "ไม่ active" แล้วสแกนแทรกระหว่างลบ
    · แถบ "กำลังเริ่มนับใหม่" บังจอ + `beforeunload` ถามก่อนออก + heartbeat ไม่รีโหลด (`_countResetInProgress`) · ลบไม่ครบ = toast เตือน ห้ามเงียบ
    ⛔ **ห้ามกดเริ่มนับใหม่เพื่อแก้อาการ "ผลรอบเก่าโผล่"** — ล้างยอดที่พนักงานสแกนค้างทั้งสาขา ให้ใช้ `tools/cleanup-stale-round-items.js` แทน
  - ✅ ✕ (`removeScanItem`) ปฏิเสธรายการที่ Confirm แล้ว และ abort `confirmed` ใน `_writeScanningItem` อัปเดตแถว RESULT ตามผลที่รับมา — เดิมแถวค้างเป็น scanning พร้อม ✕ (PDA ผู้ช่วย `_listCleared` ไม่มี rebuild มาแก้) แล้วกด ✕ = ลบเอกสารผลยืนยันทิ้ง (Pass หาย) · ✕ ยังไม่ล้าง `firstScanAt` โดยตัดสินใจข้าม (กระทบแค่เวลาในรายงาน)
- **`firestore.rules` ต้องแยก parent `stock_sessions/{document}` ออกจาก `stock_sessions/{branch}/items/{sku}`**
  และห้ามมี recursive broad allow `{document=**}` ซ้อนอยู่ เพราะ allow ใช้แบบ OR แล้วจะข้าม schema guard
  - parent ที่ยังเป็น v1 อัปเดตและ cutover เป็น v2 ได้ตามเดิม
  - เมื่อค่าเดิม `schemaVersion>=2`, ค่าใหม่ต้องเป็นตัวเลขและห้ามต่ำลง; v1 `ref.set()` ที่ทำ field หายจึงถูกปฏิเสธ
  - delete parent ยังอนุญาตเพื่อคง `clearAllData()`; Rules นี้เป็น data-integrity guard ไม่ใช่ authentication/security เต็มรูปแบบ
  ต้อง copy Rules ไป Publish ใน Firebase Console ด้วย — แก้ไฟล์ใน Git อย่างเดียวไม่มีผลกับระบบจริง
- composite index `countResetAt` + `status` ต้องสร้างใน Console ก่อน cutover (✅ มีแล้ว ยืนยัน 7 ก.ย. 2026 · index scope เป็น collection id `items` จึงครอบทุกสาขาในตัว)

Stage 0 safety net (blob path): `_checkSessionBlobSize()` เตือนที่ 800 KB — **เตือนอย่างเดียว ห้าม block การเขียน**
ถ้า block เอง จะทำให้ payload ที่ Firestore ยังรับได้เขียนไม่ผ่าน = regression กับรอบนับที่กำลังทำอยู่ และทำให้ branch lock ค้าง
ปล่อยให้ Firestore ตัดสิน แล้ว `_reportSyncError()` แยกกรณี "เอกสารใหญ่เกิน" ออกมารายงานให้ชัดแทนการ throw เงียบ

**Live migration (ก.ค. 2026):** `migrateSessionToSchemaV2()` / `rollbackSessionToSchemaV1()` เรียกจาก Console บน Desktop
ใช้เมื่อ session doc ใกล้เพดานระหว่างรอบนับจนรอ cutover ที่ `startNewCount()` ไม่ได้ — ย้ายโดยไม่ทิ้งของที่นับไว้
ลำดับห้ามสลับ: อ่าน server → สำรองลง `{branch}_v1_backup` → เขียน items ครบ → **อ่านกลับมานับให้ครบ** → ค่อยเขียน session doc เป็น metadata-only
ถ้าล้มก่อนขั้นสุดท้าย ระบบยังเป็น v1 เต็มรูปแบบ รันซ้ำได้ · `{dryRun:true}` ตรวจได้โดยไม่เขียน

#### ⏳ schema v2 — สิ่งที่ยังค้าง (อ่านก่อนทำงานต่อกับ scan/sync)

Schema v2 deploy จริงครั้งแรก 24 ก.ค. 2026 (commit `6ccdf69`) **ยังไม่ผ่าน field test ครบ** — งานที่ค้างเรียงตามความสำคัญ:

1. **3 เคสเสี่ยงผ่าน automated test แล้ว (ก.ค. 2026) แต่ยังไม่ผ่านสนามจริง** — ผ่าน emulator ไม่ได้แปลว่าผ่าน PDA จริง (Intent scanner, จังหวะ keystroke, เน็ตสาขา):
   - **สอง PDA สแกน SKU เดียวกันพร้อมกัน → ยอดต้องรวม ไม่ใช่ทับ** (จุดเสี่ยงสูงสุด — `_writeScanningItem` delta/transaction) · `tests/specs/e2e/concurrent-scan.spec.js`
   - Confirm รอบแรก + Audit Verify บน v2 (query `scanning`/`audit` + `rev` check + `writeBatch`) · `confirm-count.spec.js`, `audit-verify.spec.js`
   - offline PDA สแกนค้างแล้วกลับ online → `_reconcileScanItems` push ครบ ไม่ทับของเครื่องอื่น · `offline-reconcile.spec.js`
2. ~~composite index `countResetAt` + `status`~~ — ✅ **ยืนยันแล้วว่ามีบน production (7 ก.ย. 2026)** · **automated test จับเคสนี้ไม่ได้** เพราะ emulator ไม่บังคับ index จึงต้องตรวจกับของจริง — วิธีตรวจ read-only อยู่ที่ §Automated Tests
3. ~~KKL/SSS ยังเป็น v1~~ — ✅ **ครบทั้ง 4 สาขาแล้ว (7 ก.ย. 2026)** ดูรายละเอียดด้านบน
   ⚠️ บทเรียนจากรอบ KKL ที่ต้องเก็บไว้: **`startNewCount()` ไม่สร้าง `{branch}_v1_backup`** (ต่างจาก `migrateSessionToSchemaV2()`) และ `_syncSessionMetaToFirestore()` เขียนทับ `session_data_json` ทั้ง field ⇒ **blob เดิมหายทันทีที่กดปุ่ม** ต้องสำรองด้วย `tools/backup-branch.js` ก่อนเสมอ
   ⚠️ และ **`startNewCount()` ลบ `{branch}_r01` ด้วย** ([:3455](index.html)) ⇒ สาขานั้นจะไม่มี R01 จนกว่า auto-r01 จะรันรอบถัดไป — **กดช่วงบ่าย/เย็นเพื่อให้บอทเติมให้เช้าวันรุ่งขึ้น** ถ้ากดหลังบอทรันจะเสียไปหนึ่งวัน
4. **WH workflow v2 (Stage 1b, ส.ค. 2026)** — `WH_count_confirmations` ชนเพดาน 40,000 index entries ก่อนถึง 1 MiB (873 markers; Confirm ที่เหลือเริ่มล้ม) จึงห้ามเพิ่ม final ลง dynamic-map docs อีก ใช้ `WH/confirm_ops/{opId}/results/{sku}` + atomic committed pointer ตาม §WH Count/Recheck ด้านล่าง ระหว่าง rollout ต้อง dual-read legacy และ roll-forward จาก committed op; `{branch}_pharmacy_audit_markers` ยังเป็น blob ที่ต้องเฝ้าแยกต่างหาก

สถานะหลังแก้: WH Count/Recheck รุ่นใหม่ถูก commit และ push แล้ว โดยผล final ใหม่ไม่เพิ่มลง `WH_count_confirmations`/`WH_recheck_confirmations` อีก จึงไม่ควรเกิดปัญหาเพดาน index เดิมซ้ำในรอบถัดไป · **Rules ที่รองรับ `confirm_ops` ยืนยันแล้วว่า Publish จริงบน Console (7 ก.ย. 2026)** — วิธีตรวจซ้ำแบบ read-only อยู่ในหัวไฟล์ `firestore.rules` · เหลือแค่ต้องแน่ใจว่า Supervisor/PDA โหลดเว็บรุ่นใหม่ครบทุกเครื่อง หาก Confirm ล้มเหลวอีก ให้ตรวจเว็บ/Rules รุ่น, R01/R16 version, lock/การยืนยันพร้อมกัน, network และ quota ก่อนสรุปว่าเป็นปัญหาเดิม
5. **Confirm ยังคำนวณฝั่ง client → กฎ Desktop-only ยังอยู่ (Stage 2)** — ปลดได้เมื่อย้ายสูตร `effectiveQty` ไป Cloud Function
6. **มี automated test แล้ว (`tests/`) แต่ไม่แทนการทดสอบมือ** — ดู §Automated Tests ด้านล่าง; PDA จริง, composite index และ WH inbox flow ยังไม่ครอบ
7. **เก็บกวาดหลังเสถียร:** เมื่อผ่านรอบนับจริง ≥2 รอบ ค่อยลบ blob path เดิม (`_applyCloudScanData` merge guard, blob branch ใน `syncToFirestore`/`restoreFromFirestore`) และลบ `{branch}_v1_backup` — **ห้ามลบก่อนหน้านั้น** เพราะ rollback พึ่งพาอยู่

`{branch}_v1_backup` = สำเนา blob ก่อน migrate (SRC/WH) เก็บไว้จน confirm ว่า v2 เสถียร

**ทุก reader ที่อ่าน `scanData` จาก session blob ต้องมี v2 branch ที่อ่านจาก items แทน** — จุดที่มีแล้ว: `syncToFirestore`, `_applyCloudScanData`/listener, `restoreFromFirestore`, `pullFromCloud`, `_removeSkuFromFirestore`, `_readBranchConfirmCloudState`, **`buildDashboardData`** (Dashboard ข้ามสาขา — เคยลืม ทำให้ SRC/WH ขึ้น 0 ขณะ SSS v1 ปกติ, แก้ ก.ค. 2026 ให้ดึง items เมื่อ `schemaVersion===2`) · ถ้าเพิ่ม reader ใหม่ที่ parse `session_data_json.scanData` ต้องเติม v2 path ด้วยเสมอ
- Dashboard ของ schema v2 ต้อง query `items` ด้วย `countResetAt` ของ session ปัจจุบันและอ่านจาก server โดยตรง ห้ามอ่านทั้ง subcollection แบบไม่กรอง epoch; ถ้าอ่าน session/items ล้มเหลวต้องแสดง error ไม่ย้อนใช้ metadata-only blob แล้วแสดงยอด 0/ยอดบางส่วน
- Dashboard จำกัด `stock_audit_log` ย้อนหลัง 60 วันด้วยช่วง documentId (`{branch}_{YYYY-MM-DD}` → sentinel `{branch}_9999-99-99`) และมี cooldown 60 วิ (`DASH_REFRESH_COOLDOWN_MS` — ภายใน cooldown แสดงข้อมูลเดิม ไม่ยิง server) — ห้ามกลับไป `where('branch','==',b)` ทั้ง collection เพราะอ่านทุกวันสะสมไม่จำกัดและเป็นสาเหตุ read quota เต็ม (ก.ค. 2026)
- การกู้รายการที่ขาดจาก local backup ให้ใช้ `tools/recover-src-local-backup.js`: ตรวจ SHA-256 + branch + `countResetAt`, บังคับ dry-run, ดาวน์โหลดสำรอง session/items จาก Cloud ก่อนเขียน และใช้ transaction เขียนเฉพาะ SKU ที่ไม่มี document อยู่ในทุก epoch เท่านั้น ห้าม overwrite item เดิมทุกกรณี
- ถ้า `schemaVersion` ของ session หายแต่ items รอบปัจจุบันครบแล้ว ห้าม migrate/recover ซ้ำ: ใช้ `repairSrcSchemaVersion()` ตรวจจำนวน+status+hash, สำรอง Cloud แล้ว transaction merge เฉพาะ `{schemaVersion:2}`; `session_data_json` และ items ต้อง hash เท่าเดิมหลังซ่อม
- ก่อน schema-only repair ต้องพัก background sync/listener ของหน้า v1, ตั้ง local `_schemaVersion=2`, รอ `waitForPendingWrites()` และตรวจ server ซ้ำก่อน transaction มิฉะนั้น `syncToFirestore()` v1 ที่ตั้งเวลาไว้จะ `set()` session ทั้ง document แล้วลบ field `schemaVersion` ที่เพิ่ง merge; หลังซ่อมให้คงหน้านั้นในโหมดพักจนรีโหลด

### Pharmacy Desktop Confirm

- `_confirmPharmacyBatched()` ต้องออนไลน์และ acquire `{branch}_confirm_lock` ก่อนเริ่ม
- lock เก็บ token/owner/`countResetAt`/เวลาเริ่ม/หมดอายุ 5 นาที (`BRANCH_CONFIRM_LOCK_MS`) และปลดด้วย token เจ้าของเท่านั้น · แบตช์ละ `BRANCH_CONFIRM_BATCH_SIZE` (25)
- PDA ออนไลน์ฟัง lock แล้วบล็อก Intent barcode, queue, input และการแก้จำนวนชั่วคราว
- Desktop รอ PDA sync แล้ว snapshot เฉพาะ `scanning`; คำนวณ batch ละ 25 ผ่าน event loop พร้อม progress
- ก่อน apply อ่าน server ซ้ำและตรวจ `countResetAt`, R01/R16 version, `countedQty`, `timestamp`, `scannedBy`; เปลี่ยนกลางงาน = abort ทั้งชุด
- ถ้า cloud sync หลัง apply ล้มเหลว ผล local ยังคงอยู่และ lock อยู่จน retry สำเร็จหรือ TTL หมด เพื่อกันกดซ้ำ
- รายการที่คำนวณเป็น Audit ต้องเขียน `{branch}_pharmacy_audit_markers` ก่อน apply local; marker ใน epoch เดียวกันชนะ session/local ที่ stale และซ่อม SKU ที่หายกลับเข้า session
- `syncToFirestore(true)` สงวนไว้สำหรับ `startNewCount()` เท่านั้น; login stale reset และออก Admin Mode ต้อง merge

### Pharmacy Audit Verify (ก.ค. 2026)

> ⚠️ **29 ก.ย. 2026: Confirm รอบแรกของสาขายาไม่ผ่าน Audit แล้ว** (ดู §Status Lifecycle) — หัวข้อนี้ใช้กับ **Audit ที่ค้างอยู่ก่อนสลับ + รายการที่ ↺ ย้อนกลับมา** เท่านั้น · ห้ามลบโค้ดฝั่งนี้
> ⚠️ **30 ก.ย. 2026: เภสัชไม่ทำ Audit เมื่อไม่มี audit ค้าง** — UI ฝั่งนี้ถูกซ่อนอัตโนมัติ (`PHARMACIST_STOCKADJ_ONLY` · ดู §เภสัชทำ Stock Adj อย่างเดียว) โค้ดยังอยู่ครบและกลับมาเองเมื่อมีรายการ `audit` (เช่นหลังกด ↺)
> ⏸ **6 ต.ค. 2026 (รอบ 3): ปิดโหมดซ่อนแล้ว** (`PHARMACIST_STOCKADJ_ONLY=false` · ผู้ใช้สั่ง "รหัสเภสัชรีเช็คได้ตลอด") — เภสัชเห็น UI ฝั่งนี้ตลอด · และรายการ `audit` **ขึ้นใบ 📦 ทันที** ด้วยเลขตอน Confirm (§📦 รอรีเช็คขึ้นใบทันที) — ใบแสดงผลที่ตัดสินแล้วเท่านั้น ไม่ดูยอดรีเช็คที่ยังไม่ยืนยัน
> ⚠️ **ต.ค. 2026: จอสาขายาไม่มีคำว่า Audit แล้ว** — `audit` แสดงเป็น "รอรีเช็ค" · แผง/ป็อปอัพชื่อ Stock Adj · ปุ่ม "✓ ยืนยันรีเช็ค" (`PHARMACY_RECHECK_TERMS` · แสดงผลล้วน — status code และกลไกในหัวข้อนี้ไม่เปลี่ยน)

- เภสัชสแกนรีเช็คบน PDA ได้ แต่กด "✓ ยืนยัน Audit" ได้เฉพาะ Desktop — guard ด้วย `_isPdaApp()` (User-Agent) ไม่อิง viewport
- ยอดที่สแกนเก็บใน `sd.recheckQty`/`recheckBy`/`recheckAt` (sync ผ่าน session doc) ห้ามกลับไปใช้ map ใน memory ที่ไม่ persist
- **`recheckQty` ต้องตัดสินเทียบกับ `recheckSystemQty` (ยอดระบบที่ freeze ตอนสแกน) เสมอ ห้ามใช้ `si.systemQty` สด** — ทุกจุดที่ตั้ง `recheckQty` ต้องเรียก `_freezeRecheckBaseline()` และทุกจุดที่ตัดสินต้องใช้ `_recheckBaselineSystemQty()` (ข้อยกเว้นเดียวคือใบปรับปรุง ดูด้านล่าง)
- เภสัชแก้จำนวนรีเช็คในแถว RESULT ได้ทั้ง PDA + Desktop ผ่าน `updatePharmacyRecheckQty()` (ก.ค. 2026) — เขียนทับแบบ SET + ตั้ง `manualEditAt` + `_markSkuDirty` เหมือนเส้นทางสแกน ห้ามเรียก inbox `WH_rechecks`; **รับยอด 0 ได้ (ส.ค. 2026) = "ตรวจแล้วไม่มีของ"** ปฏิเสธเฉพาะค่าติดลบ · ล้างค่ากลับเป็น "ยังไม่รีเช็ค" ใช้ ✕ รีเซ็ตรีเช็ค · ไม่ใช้กฎราคากับช่องนี้ (กฎราคาครอบเฉพาะ Count รอบแรก)
- `getPharmacistAuditPendingMap()` ต้องอ่านจาก `state.scanData` เท่านั้น — `scanListMap.totalQty` เป็น countedQty รอบแรกในสาขายา ใช้ตัดสินไม่ได้
- `_confirmPharmacyAuditBatched()` ใช้ branch lock / แบตช์ 25 / ตรวจ R01+R16 version ชุดเดียวกับ Confirm รอบแรก และ abort ทั้งชุดถ้า `recheckQty`/`recheckBy`/`recheckAt` เปลี่ยนกลางงาน
- ก่อน apply Verify ต้องเขียน final marker; ยืนยันทีละชุดจึงเปลี่ยนเฉพาะ SKU ที่มี `recheckQty` และ Audit ที่เหลือยังอยู่ใน marker
- ทุก pharmacy client ฟัง marker และ overlay หลัง session snapshot; rollout ครั้งแรก backfill จาก Audit Log ตาม `countResetAt` เพื่อกู้รายการที่ session รุ่นเก่าทำหาย
- candidate = `status==='audit'` + มี `recheckQty` + ยังไม่มี `auditor`; audit ที่ยังไม่ได้สแกนคงสถานะเดิมรอรอบถัดไป
- เหตุผลที่ต้องเป็น Desktop: `getSoldQtyBefore()`/`getInboundQtyBefore()` fallback เป็นยอดรวมทั้งช่วงถ้าเครื่องไม่มี R16 raw timeline (`r16RawMap`) → PDA ตัดสิน pass/stock_adjustment ผิดได้
- เครื่องที่กำลังสแกน/กด ✕ เอง ต้องไม่ถูก cloud snapshot เก่า mirror ทับ — ใช้ `manualEditAt` + `MANUAL_EDIT_PROTECT_MS` ทั้งใน `_applyCloudScanData()` และ merge ของ `syncToFirestore()`
- **ย้อนผลที่ Confirm แล้วมีทางเดียว: `reopenPharmacyAudit()` (ก.ย. 2026)** — เขียน marker `reopenedAt` ขึ้น cloud **ก่อน** แก้ local (`reopenedAt` เป็นทางเดียวที่ชนะ guard "final ชนะ audit เสมอ" ใน `_writePharmacyAuditMarkers`) แล้วล้าง `recheckQty/recheckBy/recheckAt/recheckSystemQty/backorder` และคืน `sd.timestamp` เป็นเวลานับรอบแรก
  - ⚠️ **ยอดที่กรอกหลัง ↺ ต้องไม่หายเอง (29 ก.ย. 2026 · แก้แล้ว)** — เดิม ↺ → กรอกรีเช็ค → ภายในไม่กี่วินาทียอดหาย แล้วกดยืนยันได้ "ไม่มีรายการรอยืนยัน" และ flush ถัดไปเขียนการสูญเสียขึ้น cloud ถาวร (ตรวจซ้ำบน index.html ก่อนแก้ ล้มทุกรอบ · ไม่เคยมีเทส e2e ของ ↺ มาก่อน)
    ต้นเหตุ (trace จริง): flush ตอนกด ↺ จับ payload **ก่อน** marker snapshot apply → item บน cloud มี `pharmacyAuditMarkerAt` เป็นค่าเก่า → echo ของมันย้อน `sd` กลับเป็นค่าเก่า → session snapshot ถัดไป (`_applyCloudSessionMeta`) apply marker ซ้ำ และ reopen marker ปฏิเสธ `keepDraft` ทุกกรณี → ลบยอดที่เพิ่งกรอก
    **แก้ 2 ชั้น ห้ามถอดชั้นใดชั้นหนึ่ง** (ถอดทีละชั้นแล้วเทส e2e ล้มตรงจุดที่ตั้งใจ): (ก) `reopenPharmacyAudit` ตั้ง `pharmacyAuditMarkerAt`/`pharmacyAuditCountConfirmedAt` = `at` เองก่อน `_markSkuDirty` · (ข) `keepDraft` ของ reopen marker คงยอดที่ `recheckAt` **ใหม่กว่า** `reopenedAt` (เทียบเป็น ms ผ่าน `_auditTimeMs` — ⛔ ห้ามเทียบสตริง: เวลามีทั้ง ISO และ `YYYY-MM-DD HH:mm:ss` ท้องถิ่น และ `' ' < 'T'`) · **ยอดเก่าที่ ↺ ตั้งใจล้างยังต้องไม่เด้งกลับ** (recheckAt เก่ากว่า/ไม่มี = ล้างเหมือนเดิม)
    ข้อจำกัดที่รู้: ยอดที่กรอกบนเครื่องที่นาฬิกาช้ากว่าเครื่องกด ↺ เกินช่วงหน่วงระหว่างสองการกระทำ จะถูกมองว่าเก่ากว่า (ชั้น ข ไม่ช่วย แต่ชั้น ก ยังกันการ apply ซ้ำได้) · เทส `tests/specs/logic/reopen-marker-draft.spec.js` + `tests/specs/e2e/pharmacy-reopen-recheck.spec.js`
  - ⛔ **`removeScanItem()` / แก้ `state.scanData` ตรงๆ ใช้ย้อนไม่ได้** — ไม่เขียน marker แล้ว `_applyPharmacyAuditMarkersToState()` **สร้าง `sd` ใหม่ให้เอง** เมื่อ SKU อยู่ใน `skuMap` แล้วทับ status กลับใน snapshot ถัดไป · ยอดที่นับหายฟรี
  - ⛔ **PDA สแกนทับของที่ Confirm แล้วไม่ได้** — `handleBarcode` return ตั้งแต่ guard `!['pending','scanning'].includes(sd.status)` **ก่อน**บรรทัดบวก `countedQty` (ได้แค่ toast "สแกนและ Confirm ไปแล้ว") · ปุ่ม ✕ ก็ขึ้นเฉพาะแถว `scanning` ⇒ "ให้นับใหม่เฉพาะบาง SKU" ไม่มีในระบบ ทางเลือกมีแค่ `reopenPharmacyAudit` (→ `audit`) หรือ `startNewCount()` (ล้างทั้งสาขา)
  - guard `initialStatus==='audit' || directAdj` (29 ก.ย. 2026 รับ Stock Adj ตรงด้วย — เป็นทางถอยทางเดียวของกลุ่มนั้น) ทำให้ item ที่ `pass` ตั้งแต่ Count รอบแรกย้อนไม่ได้เลย · และ **`pass` ไม่โผล่ในแท็บไหนของ Audit Verify** (`_avFilter` มีแค่ `audit`/`stock_adj`) ⇒ ต้องหาจาก 📋 → ✅ Pass → **Export** (`exportExcel()` มีคอลัมน์ `SystemQty`) เพราะป็อปอัพซ่อนคอลัมน์นั้นบนสาขายา
  - `tools/list-negative-confirmed.js` (ก.ย. 2026) — read-only survey วางใน Console แล้วเรียก `listNegativeConfirmed()` · **ไม่แตะ Firestore เลย** (อ่าน state ในหน่วยความจำ 0 reads) แยกกลุ่มให้ว่าตัวไหนมีปุ่ม ↺ อยู่แล้ว / ตัวไหนต้อง Console / ตัวไหน `initialStatus` ไม่ใช่ `audit` จึง reopen ไม่ได้ · คอลัมน์ `ฐานถูก_clamp` ชี้รายการที่ถูกตัดสินด้วยฐาน `0` สมัยยัง clamp
- **ใบปรับปรุงคำนวณจากยอดระบบ "ค่าสด" เสมอ แต่รับเฉพาะยอดรีเช็คที่ยังสด (ก.ย. 2026 รอบ 2)**
  - เป้าหมายของใบคือ **"ทำให้ระบบเหลือเท่ากับยอดที่เภสัชนับได้"** (ระบบ 2 · นับ 1 → ORDS ลด 1 → ระบบเหลือ 1)
    ⇒ `_buildAdjustDocRows()` ต้องคิด `diff = cnt − si.systemQty` จาก **ค่าสด** เพราะเลขที่ส่งไปจะถูกบวก/ลบกับยอดที่ระบบมี ณ ตอนนั้น
    ⛔ **ห้ามเปลี่ยนไปคำนวณด้วย `recheckSystemQty`** — จะได้ `ปัจจุบัน − ส่วนต่างเก่า` ซึ่งไม่ใช่ยอดที่นับได้ (เคยเสนอแล้วถอน)
  - กติกานี้ใช้ได้เมื่อ **"ยอดที่นับยังล่าสุดจริง"** เท่านั้น — เดิมไม่เคยตรวจ จึงเกิดเคสนี้ทุกวันที่บอทอัป R01:
    รีเช็คเดือนก่อน (ระบบ 2 · นับ 1) → ขายไป 1 → ระบบ 1 · ชั้นเหลือ 0 · ใบคิด `1−1=0` → ไม่ทำอะไรทั้งที่ของยังขาด
    และแถวหลุด**พร้อมกันทั้ง** ORDS (`diff>=0`) และ IRPS (`diff<=0`) แบบเงียบสนิท ขณะที่ badge (`_countAdjustDocItems()`) ยังนับอยู่
  - ⇒ `_isAdjustRowFresh(sku,sd,liveSys)` = ด่านใน `_buildAdjustDocRows()`: `_recheckBaselineSystemQty() === live` เท่านั้นถึงขึ้นใบ
    **`recheckSystemQty` เป็นตัวจับว่า "ยอดหมดอายุ" ไม่ใช่ตัวคำนวณ** · ตัวกรองต้องอยู่ในฟังก์ชันนี้จุดเดียว เพื่อให้ตาราง/Export Text/Export Excel ใช้ประตูเดียวกัน
  - `_adjustDocAudit()` คืน `{stale, noSku, settled}` → `_warnAdjustDocDropped()` เด้ง toast ตอน Export (บอกจำนวน + สาเหตุ)
    ⚠️ **แถบเตือน `#adjustDocWarn` ในป็อปอัพถูกถอดออกแล้วตามที่ผู้ใช้สั่ง (24 ก.ย. 2026)** — toast ตอน Export จึงเป็นสัญญาณเดียวที่เหลือว่ามีรายการหลุดจากใบ **ห้ามถอด toast นี้ตามไปด้วย** ไม่งั้นกลับไปหายเงียบ
    `stale` = ต้องรีเช็คใหม่ (ตัดออกจากใบ) · `noSku` = R05 ยังไม่โหลด · `settled` = สดแล้วและตรงพอดี ไม่ต้องปรับ (งานจบ ไม่ใช่ของตกหล่น)
    ⚠️ **ห้ามไล่ `settled` ไปรีเช็คซ้ำ** และ **`noStock` จากรอบนับแรกไม่มี `recheckSystemQty` → fallback เป็นค่าสด ⇒ ถือว่าสด ⇒ พฤติกรรมเดิมไม่กระทบ**
    เทสตรึงไว้ที่ `tests/specs/logic/adjust-doc-dropped.spec.js` (ตรึงทั้ง "หมดอายุต้องออกจากใบ + ถูกรายงาน", "แยก stale ออกจาก settled" และ **"ของสดต้องผ่านตัวเลขเดิม ไม่เตือนผิดตัว"**)
  - **`exportStockAdjExcel()` จงใจไม่ใช้ด่านนี้** — เป็นรายงานภาพรวมจาก 📊 ประวัติการนับ (มี จำนวนคงเหลือ + จำนวนปรับปรุง + Diff ให้คนดูเอง) ไม่ใช่ไฟล์ที่ import เข้า ERP · มีตัวนับ `skipZero`/`skipNoSku` + toast ของตัวเอง **อย่า "ทำให้ตรงกัน"**
  - ระบบ**ไม่มี** field `issuedAt`/`exportedAt` ที่ไหนเลย = ไม่มีอะไรกัน double-adjust ⇒ ห้ามย้อนสถานะหลังส่งใบเข้าระบบหลังบ้านแล้ว
  - ⚠️ **ข้อยกเว้น WH (24 ก.ย. 2026 · ผู้ใช้สั่ง): Stock Adj ของคลังคิดจาก "R01 ของวันที่ Recheck" ไม่ใช่ค่าสด** — กติกาค่าสดและด่านความสดทั้งหมดข้างบน**ใช้กับสาขายาเท่านั้น**
    - ฐาน = `sd.systemQty` ที่แช่ไว้ตอน Supervisor ยืนยันรีเช็ค (ผล Recheck Confirm เขียน `systemQty` จาก `WH_r01` ณ ตอนนั้น → `_applyWhRecheckConfirmationToSku`) คู่กับ `sd.recheckQty` วันนั้น = ตัวเลขชุดเดียวกับที่ใช้ตัดสินว่า "ไม่ตรง → Stock Adj" ⇒ บอทอัป R01 ทุกเช้าจึงไม่ทำให้ตัวเลขขยับ
    - ผ่าน `_whStockAdjBaseQty(sku,sd)` จุดเดียว ใช้ครบ 4 ที่: ใบ ORDS/IRPS (`_buildAdjustDocRows` + `_adjustDocAudit`) · แท็บ 🔴 Stock Adj ใน Audit Verify · 📊 ประวัติการนับ แท็บ Stock Adj ทั้งหมด · `exportStockAdjExcel()` — **เพิ่มจุดแสดง Stock Adj ของ WH ใหม่ต้องเรียกตัวนี้ด้วย** ไม่งั้นตัวเลขแต่ละหน้าไม่ตรงกัน
    - WH **ไม่มีด่านความสด** (ฐานแช่ไว้แล้ว ไม่มีวันหมดอายุ) · ข้อมูลรุ่นเก่าที่ไม่มี `systemQty` (marker รีเช็คก่อน workflow v2 → `Number(undefined)` = NaN) ถอยไปใช้ค่าสด
    - ⚠️ **ผลข้างเคียงที่ต้องรู้: ใบของ WH ไม่ "หายเอง" หลังส่งเข้า ERP แล้ว** — ค่าสดเคยทำให้แถวเป็น 0 เองเมื่อ R01 ตามทัน แต่ฐานแช่ไม่ขยับ ⇒ Export ซ้ำวันถัดไปได้เลขเดิม **ต้องระวังส่งซ้ำ** (ระบบยังไม่มีตัวกัน ดูข้อบน)
    - เทสตรึงไว้ที่ `tests/specs/logic/wh-stock-adj-base.spec.js` (ตรึงทั้ง "WH ทุกจุดใช้ยอดวัน Recheck", "ทิศขาด/เกินต้องตามที่ตัดสิน", "ข้อมูลเก่าไม่เป็น NaN" และ **"สาขายาต้องได้พฤติกรรมเดิม"**)
  - ⚠️ **ข้อยกเว้นสาขายา: Stock Adj ตรงจากรอบแรก (`directAdj` · 29 ก.ย. 2026 — ไม่ผ่าน Audit)** — ฐาน = `sd.effectiveQty − sd.systemQty` ที่แช่ไว้ตอน Confirm (DIFF ที่ทำให้เกิดสถานะนั้นจริง) ผ่าน `_directAdjPair(sd)` **ครบ 5 จุด:** `_buildAdjustDocRows` · `_adjustDocAudit` · แท็บ Stock Adj ใน Audit Verify · ประวัติการนับแท็บ Stock Adj · `exportStockAdjExcel` — **เพิ่มจุดแสดง Stock Adj ของสาขายาใหม่ต้องเรียกตัวนี้ด้วย** ไม่งั้นตัวเลขแต่ละหน้าไม่ตรงกัน
    - ⛔ **ห้ามใช้ `countedQty − ยอดสด` กับรายการนี้** — `countedQty` เป็นยอดดิบ (ไม่รวม R16 ชดเชย) และเทียบข้ามเวลากับ R01 วันถัดไป (นับ 10 · R16 ขาย 2 · ระบบตอน Confirm 15 → ที่ถูกคือ `12−15 = −3` แต่สูตรเดิมได้ `10−11 = −1` เมื่อ R01 ใหม่เข้าแล้ว)
    - ฐานแช่ไว้จึง **ไม่มีด่านความสด และไม่ขยับเมื่อ R01 ใหม่เข้า** · `directAdj` ที่ขาดคู่ตัวเลข (ข้อมูลไม่ครบ) ถอยไปกติกาเดิม ห้ามเป็น NaN · `noStock` และ Stock Adj ที่ผ่าน Audit เดิม **ไม่ใช้** ยังเป็นค่าสด + ด่านความสด
    - ⚠️ ถูกต้องเท่าที่ R16 ถูก — R16 ครอบไม่ถึง/คลาดเวลา = ความคลาดไหลเข้าใบตรงๆ (เดิม Audit วันถัดไปเทียบ R01 ใหม่ช่วยกรอง) · ทางแก้รายตัวคือ ↺
    - เทสตรึงไว้ที่ `tests/specs/logic/pharmacy-direct-adj.spec.js` (ตรึง "ตัวเลขเท่าเดิมหลัง R01 ใหม่เข้า" และ **"Stock Adj ที่ผ่าน Audit เดิม/noStock ได้ตัวเลขเดิม"**)

### ป็อปอัพ 📦 ปรับปรุงสินค้า — LOT/ราคาจาก Supabase (ก.ย. 2026)

> ⏩ **6 ต.ค. 2026 (รอบ 3):** ใบนี้นับ `audit` ของสาขายา (รอรีเช็ค) เป็นงานของใบด้วย (`_isAdjustDocItem`) + "จำนวน" แก้ได้ (เภสัช·สาขายา·Desktop) — กติกา/ข้อห้าม/ทางถอยอยู่ที่ §📦 รอรีเช็คขึ้นใบทันที (ท้ายหัวข้อ "สาขายาไม่มีคำว่า Audit") · ประโยค "ดึงเฉพาะ `stock_adjustment`" ในเอกสารเก่าด้านล่างใช้ไม่ได้แล้วสำหรับสาขายา

เดิมต้องแนบ R14.102 (LOT/EXP · มากกว่า 200,000 แถว ใส่ Firestore ไม่ได้) + R05.105 (ราคา Level 4) เองทุกครั้ง
ตอนนี้บอท `auto-adj/` อัปทั้งไฟล์ขึ้น Supabase (`adj_r14_lots` / `adj_r05_prices` / `adj_meta`) แล้วป็อปอัพดึง**เฉพาะ SKU ในใบ**เอง **ทุกครั้งที่เปิด** — รายละเอียดใน [[SKILL-data-files]] และ `auto-adj/README.md`
- **Supabase เป็นที่เดียวในระบบที่ไม่ใช่ Firestore** · เว็บใช้ anon key อ่านอย่างเดียว (RLS) · ⛔ ห้ามใส่ service_role key ใน `index.html` · ไม่ผูกรอบนับ (`startNewCount()` ไม่แตะ)
- ลำดับที่มา **แยกต่อไฟล์** (`_adjSource`): ไฟล์ที่แนบเอง → Supabase → `{branch}_adjlot` (ข้อมูลสำรอง) ⇒ Supabase ไม่มี/ไม่ตอบ = กลับไปพฤติกรรมเดิมเอง
- **การ์ดแนบไฟล์กดไม่ได้แล้ว ยกเว้น Admin Mode** (ก.ย. 2026 · `openAdjFilePicker()` เป็นด่านจุดเดียว · คลาส `adj-card-locked` ถอด cursor/hover ออกเพื่อไม่ให้เข้าใจผิด) — `handleAdjLotFile`/`handleAdjPriceFile` ยังเรียกตรงได้จาก Console และจากเทส
- ⚠️ **ข้อความบนการ์ด/toast ห้ามเอ่ยชื่อ "Supabase" ให้ผู้ใช้เห็น** — ใช้คำว่า `Ready` (ป้ายและข้อความ) · เคสโหลดไม่ได้บอกให้ "ลองเปิดหน้านี้ใหม่ หรือแจ้ง IT" ไม่ใช่ "คลิกเพื่อแนบไฟล์เอง" เพราะกดไม่ได้แล้ว · เทสตรึงข้อความชุดนี้ไว้ (`adjust-doc-supabase.spec.js`)
- ⚠️ ทุก query ต้องกรอง `gen=eq.<adj_meta.active_gen>` (ตารางเก็บหลาย generation) และ**ต้องวนเพจละ 1,000 แถว** (Supabase ตัดผลที่ 1,000 แถว — ไม่วน = LOT หายเงียบ)
- ⚠️ `_adjLoading` กั้น Export ระหว่างโหลด และ**ต้องถูกล้างที่ต้น `_refreshAdjMaster()` ทุกรอบ** — ไม่งั้นรอบที่ถูกแซงทิ้งธงค้าง Export ถูกบล็อกถาวร
- ⚠️ Export Text/Excel อ่าน LOT ผ่าน `_adjSelectedEntry()` เท่านั้น — LOT ที่เลือกไว้แต่ไม่มีในข้อมูลชุดปัจจุบันต้องไม่หลุดเข้าไฟล์ (จอแสดง "— เลือก —") และต้องไม่ถูกลบจาก `_lotSelected`
- ⚠️ **parse อยู่ 2 ภาษา**: `_parseAdjLotRows`/`_parseAdjPriceRows` (index.html) ↔ `parse_lot_rows`/`parse_price_rows` (`auto_adj_import.py`) → แก้คู่กันแล้วรัน `node tools/check-adj-parity.js "<R14.102.CSV>" "<R05.105.CSV>"` · **ห้ามเปลี่ยนชื่อ/signature**
- ⛔ **R05.105 (ตารางราคา · auto-adj) กับ R05.106 (ตารางบาร์โค้ด · auto-r05) เป็นรายงานคนละตัว ไม่มีคอลัมน์ไหนตรงกันเลย** (34 vs 27 คอลัมน์ · ยืนยันกับไฟล์จริง 12 ก.ย. 2026) แต่อยู่โฟลเดอร์ `run-upload-stock` เดียวกัน ⇒ **ไฟล์ราคาต้องชื่อ `ADJ_R05.105.CSV`** (ไม่ขึ้นต้นด้วย `R05`) เพราะ auto-r05 ค้นด้วย `R05*.CSV` แล้วหยิบไฟล์ใหม่สุด · **ห้ามแก้ `auto-r05`** — กันที่ชื่อไฟล์แทน · รูปแบบของ auto-adj จึงเป็น `*R05*105*.CSV` (มี `*` หน้าสุด) และสคริปต์เตือนใน log ถ้าเจอชื่อขึ้นต้น `R05`
- สูตรใบ (`_buildAdjustDocRows`/`_isAdjustRowFresh`) **ไม่ได้แตะ** · เทส: `tests/specs/logic/adjust-doc-supabase.spec.js` (Supabase จำลองที่ `tests/lib/supabase-fake.js`)

#### 📄 แบ่งหน้า 20 แถวในใบ 📦 (ORDS / IRPS · ผู้ใช้สั่ง 6 ต.ค. 2026)

เดิม `renderAdjustDocTable()` วาด**ทุกแถวของแท็บ** (แต่ละแถวมี `<select>` LOT + ช่องจำนวน) แล้ววาดซ้ำทุกครั้งที่เลือก LOT/แก้จำนวน/โหลดข้อมูลเสร็จ (ตอนเปิดป็อปอัพ 3 รอบ) ⇒ แบ่งหน้าละ 20 แถว (`ADJUST_DOC_PAGE_SIZE`) · UI ล้วน ไม่แตะฟังก์ชัน scan-related/schema/`firestore.rules`/APK/`sw.js`
- ⛔ **แบ่งเฉพาะ "การวาดตาราง" ใน `renderAdjustDocTable`** — `_buildAdjustDocRows` · Export Text/Excel · ปุ่มนับ (`_countAdjustDocItems`) · `_adjustDocAudit` · `_adjustDocSkuSet` (ตัวขอ LOT/ราคา) ยังครอบ **ทุกแถว** · **Export ออกทุกแถวของแท็บ ไม่ใช่เฉพาะหน้าที่เห็น** (ปุ่ม Export มี `title` บอกไว้) · ห้ามย้ายการตัดหน้าไปไว้ในฟังก์ชันพวกนั้น — ไฟล์ที่ส่ง ERP จะออกไม่ครบโดยเงียบ
- ยอด `#adjustDocRowCount` = ยอดรวมของแท็บ · ลำดับแถวต่อเนื่องข้ามหน้า (`start+i+1`) · pager (`« ‹ หน้า X / Y (a–b) › »` ที่ฟุตเตอร์ซ้าย) ซ่อนเมื่อ ≤ 20 แถว ⇒ ใบเล็กหน้าตาเหมือนเดิมทุกจุด
- `_adjDocPage` (เริ่มที่ 1) **รีเซ็ตเป็น 1** เมื่อเปิดป็อปอัพ/สลับ ORDS↔IRPS (ไม่จำหน้าเดิม) · re-render อื่น (เลือก LOT · แก้จำนวน · โหลด LOT/ราคาเสร็จ) **คงหน้า+ตำแหน่งเลื่อน** · เฉพาะ `setAdjDocPage()` (ผู้ใช้กดเปลี่ยนหน้า) ที่เลื่อนขึ้นบนสุด · clamp ทำใน `renderAdjustDocTable` (รับ `Infinity` = หน้าสุดท้าย · แถวหดจนหน้าเดิมหาย = ถอยมาหน้าสุดท้ายที่ยังมี · ⛔ ห้ามใช้ `|0` — `Infinity|0===0`)
- **การดึง LOT/ราคาจาก Supabase ยังดึงครบทุก SKU ในใบ ไม่ทำทีละหน้า (ตั้งใจ)** — Export ต้องมี LOT/ราคาครบทุกแถวของแท็บ · `_adjExportBusy` + การ์ด `N/need SKU` ผูกกับการโหลดทั้งชุด · ดึงบางส่วน = ไฟล์ Export ราคาว่างโดยเงียบ · คอขวดที่แก้คือการวาด DOM
- **ทางถอย:** จุดก่อนแก้ = `1ce80f9` · คอมมิตของงานนี้ควรขึ้นต้น **`feat(adj-paging):`** · ไม่มีการเปลี่ยน schema/รูปแบบข้อมูล ย้อนโดยไม่ต้อง migrate

  | ระดับ | ทำอะไร | ใช้เมื่อ |
  |---|---|---|
  | **1 สวิตช์** (เร็วสุด) | `let ADJUST_DOC_PAGE_SIZE=0;` (หรือค่าที่ไม่ใช่เลขบวก = ไม่แบ่งหน้า วาดครบเหมือนก่อนแก้) → commit → push | แบ่งหน้าสร้างความสับสน/อยากเห็นทั้งแท็บพร้อมกัน |
  | **2 revert** | `git revert --no-edit $(git log --format=%h --grep='^feat(adj-paging)' 1ce80f9..HEAD)` → push · **ดูรายการก่อนรัน** · ⛔ ห้าม `reset --hard`/force-push | ระดับ 1 ไม่พอ |
  | **3 Vercel** | promote deployment ก่อนหน้า | เว็บพังหนัก · ⚠️ ต้อง revert ใน git ตามด้วย |

- หลัง deploy/ย้อน ให้ F5 บน Desktop ที่เปิดอยู่ (heartbeat ไม่รีโหลดเครื่องที่เคยสแกน — ดู Known limitations) · ตรวจรุ่น (Console): `typeof ADJUST_DOC_PAGE_SIZE` = `'number'` → รุ่นใหม่
- **อาการที่ควรสงสัยงานนี้:** Export ได้ไฟล์น้อยกว่ายอดรวมบนจอ (**ห้ามเกิด**) · ลำดับแถวเริ่ม 1 ใหม่ทุกหน้า · เลือก LOT/แก้จำนวนแล้วเด้งกลับหน้า 1 · เปลี่ยนแท็บแล้วค้างหน้าเดิม/ว่างเปล่า · pager โผล่ทั้งที่ ≤ 20 แถว
- เทส: `tests/specs/logic/adjust-doc-paging.spec.js` (8 ข้อ: 20/20/5 + ลำดับต่อเนื่อง + ปุ่มขอบ · รีเซ็ตหน้า · ขอบ 20/21/ว่าง · re-render คงหน้า + วาดจริง 20 แถว · ★ Export Text/Excel ครบทุกแถวจากหน้า 2 · clamp · ทางถอย · เลื่อนขึ้นบนสุดเฉพาะตอนเปลี่ยนหน้า)
- **ตรวจแล้ว 6 ต.ค. 2026:** `npm test` ทั้งชุดผ่าน (logic 189 · e2e 73 + เทสวัดที่ opt-in ข้าม 2) · ใส่บั๊กจงใจ 17 แบบลงสำเนาชั่วคราว (ไม่ clamp / ตัดหน้าที่ชั้นข้อมูลจน Export ไม่ครบ / ลำดับเริ่ม 1 ทุกหน้า / ไม่รีเซ็ตหน้าตอนสลับแท็บและตอนเปิดป็อปอัพ / pager ไม่ซ่อน-ซ่อนผิดเงื่อนไข / ขนาดหน้าฮาร์ดโค้ด 20 / ค่า 0 ตีเป็น 20 / วาดทุกแถว / `|0` / re-render รีเซ็ตหน้า / ไม่เลื่อนขึ้นบน / เลื่อนขึ้นบนทุก re-render / ปุ่มขอบไม่ disabled / ช่วงเลขคลาด / ยอดรวมแสดงเฉพาะหน้า) **เทสจับได้ครบ 17** (รอบแรกหลุด 1 = ไม่เลื่อนขึ้นบนเมื่อเปลี่ยนหน้า เพราะเทสไปหน้าที่มี 5 แถว ซึ่งเบราว์เซอร์ clamp scrollTop เองอยู่แล้ว → แก้ให้ไปหน้าที่เต็ม 20 แถว) · ภาพจอ Desktop 1465/1180px (ORDS 214 แถว 11 หน้า · IRPS 37 · ใบเล็ก 12 แถวไม่มี pager) pager ไม่ล้นฟุตเตอร์ · ⏳ **ยังไม่ได้ทดสอบมือบน Desktop จริง** และ **ยังไม่ได้พิสูจน์ `git revert` ระดับ 2 ใน worktree แยก** (ทำหลัง commit)

### WH Count/Recheck

- WH R01/R16 master และ raw timeline ถูก sync ผ่าน Firestore เพื่อให้ Supervisor หลายเครื่องเห็นข้อมูลชุดเดียวกัน; localStorage/IndexedDB เป็น cache ที่ต้อง version ตรงเท่านั้น
- ปุ่ม R01.102 แสดงเวลาอัปโหลดล่าสุดจาก Cloud เพื่อให้เครื่องอื่นรู้ว่า master ถูกอัปแล้ว
- warehouse PDA เขียน live Count/Recheck ลง `stock_sessions/WH/items/{sku}`; `WH_counts`/`WH_rechecks` เป็น legacy bridge ชั่วคราวสำหรับ client เก่าและห้ามนำยอดจากสอง path มาบวกกัน เพราะเป็น scan เดียวกันซ้ำกัน ให้เลือก source ล่าสุดด้วย `countAt`/`recheckAt`
- final ของ Count/Recheck ใช้ operation schema:
  - `stock_sessions/WH/confirm_ops/{opId}` มี `kind` (`count|recheck`), `state` (`preparing|committed|aborted`), `countResetAt`, `staffName`, `candidateCount`, `candidateHash`, `r01Version`, `r16Version`, `r16_103Version`, `owner`, `createdAt`, `committedAt`
  - `stock_sessions/WH/confirm_ops/{opId}/results/{sku}` มี `opId`, `kind`, `sku`, `countResetAt`, `sourceRev`, `sourceAt` และ marker fields เดิมทั้งหมดที่ใช้ render/export/audit
  - item ที่ materialize แล้วเก็บ `whCountOpId`/`whRecheckOpId`; field เหล่านี้เป็น provenance ไม่ใช่ตัวแทน parent committed state — reader ยังต้องตรวจ operation
- Confirm สร้าง op เป็น `preparing` → เขียน immutable results เป็น batch ไม่เกิน 400 → อ่านจาก server ตรวจ `candidateCount` + canonical `candidateHash` → transaction อ่าน epoch, R01/R16 meta, candidate item/legacy source และ fingerprint ซ้ำ → flip parent op เป็น `committed` เพียง write เดียว
- Rules บังคับ result เป็น create-once (read/create/delete แต่ update ไม่ได้) และ parent op update ได้เฉพาะเมื่อ state เดิมเป็น `preparing` ไป `preparing|committed|aborted`; committed/aborted ห้ามย้อน แต่ delete ยังใช้ได้ตอน cleanup
- Reader ต้อง ignore `preparing`/`aborted`; สำหรับ committed op ต้องโหลด results ครบและ hash ตรงก่อน overlay **ทั้งชุดพร้อมกัน** ถ้าขาด/อ่านพลาดให้แสดง error และคง state ก่อนหน้า ห้าม apply บาง SKU
- หลัง commit ให้ materialize result ลง `WH/items/{sku}` และล้าง legacy pending แบบ chunk/idempotent; ถ้าหน้าปิดหรือเน็ตหลุดกลางงาน ให้ recovery ทำต่อจาก committed results โดยห้ามคำนวณผลใหม่
- Supervisor Confirm รายคนต้องแตะเฉพาะ candidate ของคนนั้น; pending ของคนอื่นห้ามถูก materialize/ลบ การ Confirm ทั้งหมดที่เกิน transaction/write limit ห้ามแอบแบ่งเป็นหลาย final operations เพราะจะเปลี่ยน all-or-none เป็น partial
- Supervisor ไม่รีเช็คเอง — ป็อปอัพ Audit Verify เป็น read-only (`_isWhSupervisorAuditReadonly()`) ซ่อนช่องสแกน และปุ่มยืนยันในป็อปอัพต้อง dispatch ไป `confirmAllRecheckSupervisor()` (transaction) ห้ามยืนยันแบบ local ล้วน
- Count marker `audit` เปิดงาน Recheck โดยเริ่ม `recheckQty` ว่าง/0 ตาม UI; warehouse สแกนแล้ว status ยังเป็น `audit` จน Supervisor Confirm รอบสอง
- listener/load/pull ทั้ง Supervisor/PDA ต้อง overlay committed op หลัง item snapshot ทุกครั้ง; committed result ต้องชนะ legacy marker/inbox และ delayed offline write ใน epoch เดียวกัน
- migration กลางรอบต้องหยุด WH ด้วย lock, รอทุก PDA `Synced`, สำรอง legacy docs+current items, stage same-epoch legacy final เป็น committed migration op, verify count/hash จาก server แล้วจึง cutover; legacy pending กับ item ที่เป็น scan เดียวกันห้าม sum
- legacy docs เก็บ read-only เป็น forensic/compatibility backup ห้ามลบเพื่อเพิ่มพื้นที่และห้าม rollback กลับไปเขียน marker ก้อนเดิมหลังมี post-cutover committed op; หลังจุดนั้น recovery = roll-forward จาก op results เท่านั้น
- เริ่มนับใหม่/ล้างข้อมูลต้องล้าง inbox/legacy markers, WH R16 meta/chunks/cache และลบ `results` ใต้ op ก่อนลบ op parent (Firestore ไม่ลบ subcollection ตาม parent); reader กรอง `countResetAt` เสมอเพื่อให้เศษ cleanup รอบเก่าไม่มีผล
- `firestore.rules` ต้องมี match แยกสำหรับ `WH/confirm_ops/{opId}` และ `results/{sku}` และต้อง Publish ก่อน deploy runtime; Rules ต้องคง immutable result + monotonic op state ตามด้านบน และ update `WH/items/{sku}` ใน epoch เดียวกันต้องคง `whCountOpId`/`whRecheckOpId` ที่มีอยู่แล้ว เพื่อกัน delayed PDA replace ลบ final provenance (branch อื่น, epoch ใหม่, create/delete คง behavior เดิม)

### รายงานผลการนับ (count_report) — ค่าสด vs ค่าที่แช่ไว้ (ก.ย. 2026)

`_buildCountReportRows()` ผลิตแถวให้ทั้งตารางบนจอและ `exportCountReportExcel()` (ประตูเดียวกันโดยเจตนา)
**12 คอลัมน์ ทุกเลขมาจากเวลาเดียวกัน = ตอน Confirm (ตัดค่าสดออกหมดแล้ว ก.ย. 2026 รอบ 2)**

| # | คอลัมน์ | ที่มา |
|---|---|---|
| 1–6 | `วันที่สแกน` · `Location` · `SKU` · `Barcode` · `Name` · `หน่วย` | catalog/scan |
| 7 | `Count` | แช่ไว้ตอนนับ |
| 8 | **`DIFF`** | `sd.effectiveQty − sd.systemQty` = **เลขที่ทำให้เกิดสถานะนั้นจริง** |
| 9 | `System Qty (ตอน Confirm)` | `sd.systemQty` แช่ไว้ |
| 10–12 | `Recheck` · `DIFF(Recheck)` · `Check By` | `sd.recheckQty − sd.systemQty` (ฐานเดียวกับ DIFF) |

- ⛔ **ห้ามเอา `si.systemQty` (ค่าสด) กลับมาเป็นฐานของช่อง DIFF ใดๆ** — เคยเป็นแบบนั้นถึง ก.ย. 2026 แล้วได้ "ยอดวันนี้ − ยอดที่นับเมื่อวาน" = **เทียบข้ามเวลา วัดการนับผิดไม่ได้** · บอทอัป R01 **ทุกเช้า** จึงเพี้ยนเป็นปกติ ไม่ใช่เคสหายาก (สำรวจของจริงเจอ "หลายตัว") · field `systemQty` ยังอยู่ใน row object แต่**ไม่มีคอลัมน์ไหนแสดง**
- **เคสจริงที่ทำให้ต้องรื้อ (SKU 100659 · WH):** ตัดสินด้วยยอดระบบ 36 (นับได้ 33 · R16 ขาย 4 → `33+4=37 ≠ 36` → audit) แต่เช้าถัดมา R01 ลดเหลือ 33 ⇒ ไฟล์เคยโชว์ `SystemQty 33 · Count 33 · DIFF 0` **ทั้งที่สถานะเป็น Stock Adjustment** — อ่านแล้วสรุปว่า "นับถูก" ซึ่งผิด · ตอนนี้โชว์ `DIFF +1 · System Qty (ตอน Confirm) 36` ตรงกับความจริง
  ต้นเหตุจริงคือ **R01 กับ R16 เหลื่อมเวลากัน**: R01 ตัดขายไปแล้ว 1 ชิ้นจาก 4 แต่ R16 รายงานครบ 4 ⇒ บวกกลับซ้ำ 1 · ของบนชั้นถูกต้องมาตลอด
- ⚠️ **หัวคอลัมน์บนจอกับในไฟล์ Excel ต้องตรงกันเป๊ะ** (ผู้ใช้สั่งไว้ ก.ย. 2026 รอบ 2 — เดิมจอ 14 ไฟล์ 15 แล้วสับสน) ⇒ แก้ `renderHistoryStatsTable()` สาย `countreport` ต้องแก้ `exportCountReportExcel()` คู่กันทุกครั้ง · `colspan` ของแถว "ยังไม่มีรายการ" ต้องไล่ตามด้วย
- ⚠️ **ไฟล์เปลี่ยนจาก 15 → 12 คอลัมน์ และตำแหน่งขยับตั้งแต่ช่อง F** — สูตร Excel ที่อ้างคอลัมน์เดิมต้องแก้ · ผู้ใช้ตัดสินใจยอมแลกเองเพื่อให้เหลือเลขชุดเดียว (รอบแรกเลือก "คงช่องเดิม" แล้วพบว่าสองชุดสับสนกว่า)
- ⚠️ **item ที่ไม่มี `sd.systemQty` (ยังไม่ผ่าน Confirm จริง / data เก่า) ตกไปใช้ค่าสดเป็นฐาน** ผ่านตัวแปร `base` — ให้ผลเท่าพฤติกรรมเดิม และช่อง `System Qty (ตอน Confirm)` ขึ้น `—` ให้เห็นว่าเลขนั้นไม่ใช่ค่าแช่
- ⚠️ **snapshot ใน `stock_countreport` เก็บ `rows_json` ที่คำนวณไว้แล้ว** ⇒ วันเก่าที่บันทึกก่อนรอบนี้ยังถือเลข `diffCount` ที่คิดด้วยฐานค่าสด **แก้ย้อนหลังไม่ได้** · `sysAtConfirm` ที่หายไปแสดง `—` (เช็คด้วย `== null` ไม่ใช่ `===` — field ที่ไม่มีเป็น `undefined` เคยหลุดไปโชว์คำว่า undefined มาแล้ว)
- แถวที่ยอดระบบขยับหลัง Confirm ไม่มีคอลัมน์ ⚠️ เตือนแล้ว (ตัดออกพร้อม `sysDrift`) — กลุ่มนี้ **ใบปรับสต็อกตัดออกให้เองอยู่แล้ว** ผ่าน `_isAdjustRowFresh()` (ดู §ใบปรับปรุง) จึงไม่มีใบผิดหลุดออกไป · ดูรายการได้จาก `tools/list-stale-sysqty.js`
- ⛔ **รายงานนี้เป็นตัวอ่าน ห้ามเอาเลขในนี้ไปตัดสินสถานะ** — การย้อนสถานะที่ Confirm แล้วมีทางเดียวคือ `reopenPharmacyAudit()` (สาขายา) หรือรีเช็ค/Confirm รอบสอง (WH)

### PDA power/audio/toast policy

- Native Android ใช้ screen-on idle timer 2 นาที ไม่ใช้ bright WakeLock และไม่ปลุกจอเองหลังดับ
- Web Audio บน PDA suspend หลังเสียงจบประมาณ 1.5 วินาทีและ resume ก่อนเสียงถัดไป เสียงสแกนและเสียงกรอกจำนวนต้องคงอยู่
- `body.pda-power-save` ปิดเฉพาะ decorative animation ห้ามลด Firestore realtime listeners เพื่อประหยัดแบต
- Toast บน PDA ย่อผ่าน `_toastMessageForDevice()`; Desktop ใช้ข้อความเต็ม และ action toast ต้องใช้ callback/`textContent` ไม่ประกอบ input ด้วย unsafe `innerHTML`

### ต้นทุนงานหลังสแกน (ก.ย. 2026) — รายละเอียดและตัวเลขที่วัดจริงอยู่ใน [[SKILL-scan-engine]] §ต้นทุนงานหลังสแกน

- **ห้ามนำ `updateStats()` ต่อสแกนกลับมา** — สแกนล้วน (`pending`/`scanning`) เปลี่ยนผลของมันไม่ได้ (ลูปข้ามสถานะเหล่านี้ทั้งหมด) · `drainQueue` ใช้ `_afterScanRefresh` · ตัวเลขที่สแกนล้วนเปลี่ยนได้ (Unknown, tab WH PDA, ปุ่มนับรายพนักงาน, **Counted/Pass/Progress ของสาขายา** — `PROGRESS_BY_SCAN`) อัปเดตแยกใน `_refreshScanCounters()`
- PDA สแกนห่าง ~1-3 วิ > ทุก debounce ⇒ debounce ไม่ลดงาน ต้อง "ข้ามงานที่เปลี่ยนไม่ได้" หรือทำแบบ O(1) · วัดด้วย `SCAN_COST_MEASURE=1 npm run test:e2e -- scan-cost` **ก่อนและหลัง** แก้เส้นทางหลังสแกนทุกครั้ง
- `scheduleSave()` (backup localStorage) = trailing 4 วิ + maxWait 12 วิ ออนไลน์ / 1.5 + 3 วิ ออฟไลน์ + flush ตอน background/pagehide/offline · ใช้ `_cancelPendingSave()` แทน `clearTimeout(_saveTimer)` · items ขึ้น Firestore ทุก 800 ms เหมือนเดิม
- แถว RESULT ที่ได้ SKU/Unknown ใหม่ = ใส่แถวเดียว (`insertScanRowTop`) ไม่ rebuild 30 แถว · **template แถวมีที่เดียว `_scanRowHtml`** — ห้ามก๊อปไปวางที่อื่น · DOM ไม่สอดคล้อง = fallback `renderScanList()` เสมอ
- ผลวัด: ~49 → ~10 ms ต่อสแกน (catalog 5,400 · CPU 6× · สแกนห่าง 1.5 วิ · PDA ผู้ช่วย)

#### ⏪ ย้อนกลับงานหลังสแกนได้ทุกเมื่อ (ผู้ใช้สั่ง 29 ก.ย. 2026 — "ถ้าไม่ดีหรือ Bug เกินให้ย้อนกลับไปก่อนแก้ได้")

- **จุดก่อนแก้ = `ab95bf0`** (ผ่าน `npm test` เต็มชุดก่อน push: logic 93 · e2e 61) · คอมมิตของงานนี้: `a366e14` (Phase A) · `4da376e` (Phase B) · และคอมมิตข้อความขึ้นต้น **`perf(rollback):`** (สวิตช์หลัก + คู่มือนี้) — หาทั้งหมดด้วย `git log --oneline --grep='^perf' ab95bf0..HEAD`
- **ไม่มีการเปลี่ยน schema / รูปแบบข้อมูล / `firestore.rules` / APK / `sw.js`** ⇒ ย้อนได้ทั้งสองทางโดยไม่ต้อง migrate: localStorage · session doc · `items/{sku}` เขียนรูปแบบเดิมทุกไบต์ (ที่ต่างมีแค่ "จังหวะ" การบันทึกในเครื่องและงานที่ UI ข้าม)
- **สวิตช์หลักตัวเดียว = `SCAN_LIGHT_REFRESH`** คุม Phase A ครบทั้ง 3 ส่วน (ข้าม stats ต่อสแกน · ตัด echo ตัวเอง · backup ในเครื่อง — ปิดแล้ว `scheduleSave` กลับ trailing 400 ms เดิม) · `SCAN_INCREMENTAL_ROW` คุม Phase B (แถว RESULT) · ทั้งสองเป็น `let` ใกล้ `_afterScanRefresh` ใน `index.html` · เส้นทางเดิมยังอยู่ครบและมีเทสคุมทั้งคู่

| ระดับ | ทำอะไร | ใช้เมื่อ |
|---|---|---|
| **1 สวิตช์** (เร็วสุด) | แก้ 2 บรรทัดเป็น `let SCAN_LIGHT_REFRESH=false;` และ `let SCAN_INCREMENTAL_ROW=false;` → commit → `git push origin main` | อาการเจาะจงในงานหลังสแกน (สถิติ/แถว/backup) หรือยังไม่รู้ว่าตัวไหน — ใช้ทดลองแยกได้ทีละตัว |
| **2 revert ทั้งหมด** | `git revert --no-edit $(git log --format=%h --grep='^perf' ab95bf0..HEAD)` → `git push origin main` | ระดับ 1 ไม่พอ หรืออยากได้ไฟล์ตรง `ab95bf0` เป๊ะ · **ดูรายการก่อนรัน** (`git log --oneline --grep='^perf' ab95bf0..HEAD` ต้องเป็นของงานนี้ล้วน — คอมมิต `perf…` อื่นที่มาทีหลังจะถูกย้อนไปด้วย ให้ระบุ SHA เองแทน) · ⛔ ห้าม `reset --hard` / force-push (`git revert` ไม่ทำลายประวัติ) |
| **3 Vercel** | Dashboard → Deployments → promote deployment ก่อนหน้า (ถ้าแผนที่ใช้มี Instant Rollback) | เว็บพังหนักและต้องการเร็วกว่ารอ build · ⚠️ ต้อง revert ใน git ตามด้วย ไม่งั้น push ถัดไปดึงของใหม่กลับมา |

- **⚠️ อย่าเชื่อว่า PDA จะรับรุ่นที่ย้อนเอง — deploy/ย้อนแล้วต้องรีสตาร์ทเครื่องที่กำลังใช้งาน:** heartbeat เทียบ ETag ทุก 15 นาที + ตอนเปิดจอ (ห่างกัน ≥5 นาที) แต่จะ reload ได้ต่อเมื่อผ่าน `_reloadGateOk` ซึ่งเช็ค `_pendingPatches.size` — `drainQueue` ล้าง Set นี้เฉพาะ "ตอนเริ่ม drain ถัดไป" (และ `resetScanRuntimeState`) ⇒ **เครื่องที่สแกนแล้วหลัง login/reset ค้างด่านปิดไปตลอด ไม่รีโหลดเอง** (พฤติกรรมเดิมตั้งแต่ก่อนงานนี้ — `ab95bf0` ก็เป็น · ยังไม่ได้แก้เพราะเป็นโค้ด scan-related ต้องขออนุมัติ) ⇒ หลังย้อน/deploy ให้ **ปิดแอปให้จบแล้วเปิดใหม่** ที่ PDA ทุกเครื่องที่ใช้งานอยู่ (HTML เป็น network-first จึงได้รุ่นใหม่ทันที) · Desktop กด F5 · **แจ้งหน้างานก่อนย้อนบนสาขาที่กำลังนับ**
- **ตรวจว่าเครื่องไหนรุ่นไหน (Desktop Console):** `typeof SCAN_LIGHT_REFRESH` = `'boolean'` → รุ่นใหม่ (ค่า `false` = โหมดเดิม) · `'undefined'` → ก่อนแก้
- **อาการที่ควรสงสัยงานนี้:** แถว RESULT ไม่ขึ้น/ลำดับผิด/ซ้ำ · ยอดในแถวไม่ตรงที่สแกน · การ์ด Pass/Audit/Progress ไม่ขยับหลัง Confirm หรือหลังเพื่อนสแกน · ปุ่มยืนยันนับรายพนักงาน (supervisor) ค้าง · ปิดแอปตอนออฟไลน์แล้วสแกนล่าสุดหาย (backup ในเครื่องช้ากว่าเดิม ≤12 วิ/≤3 วิ) — ลองระดับ 1 ทีละตัวเพื่อแยกสาเหตุก่อนย้อนทั้งหมด
- **ตรวจแล้ว 29 ก.ย. 2026:** ทดลอง `git revert` ครบทุกคอมมิตของงานนี้ใน worktree แยก (ไม่แตะโฟลเดอร์งาน) → `git diff ab95bf0 HEAD` **ว่างทั้งต้นไม้** (ไม่ใช่แค่ `index.html`) · สวิตช์มีเทสคุมทั้งเปิดและปิด (`scan-light-refresh` · `scan-row-parity` · `scan-cost`) · `npm test` ทั้งชุดผ่าน (logic 123 · e2e 67 + เทสวัด 2 ข้อที่ opt-in) · ⏳ **ยังไม่ได้ทดสอบบน PDA จริง** (สแกนต่อเนื่อง/ออฟไลน์/สองเครื่อง — ตาม §เมื่องานเสร็จ)
- หลังย้อนระดับ 2 รัน `cd tests && npm test` ให้ผ่านครบ (เทสของงานนี้ `scan-cost`/`scan-light-refresh`/`scan-row-parity` ถูก revert ไปพร้อมกัน — ถูกต้อง)

#### ⏪ ย้อนกลับ Counted/Pass/Progress ตามสแกน (สาขายา · ผู้ใช้สั่ง 30 ก.ย. 2026 — แนวเดียวกับงานหลังสแกนด้านบน)

- **จุดก่อนแก้ = `48c8194`** (ผ่าน `npm test` เต็มชุดก่อนแก้: logic 123 · e2e 67) · คอมมิตของงานนี้ขึ้นต้น **`feat(scan-progress):`** — หาด้วย `git log --oneline --grep='^feat(scan-progress)' 48c8194..HEAD`
- **ไม่มีการเปลี่ยน schema / รูปแบบข้อมูล / `firestore.rules` / APK / `sw.js`** — เปลี่ยนเฉพาะ "ตัวเลขและตัวกรองที่ UI แสดง" ของสาขายา (Desktop+PDA) ⇒ ย้อนได้ทั้งสองทางโดยไม่ต้อง migrate
- **สวิตช์ตัวเดียว = `PROGRESS_BY_SCAN`** (`let` ใกล้ `SCAN_LIGHT_REFRESH` ใน `index.html`) — ปิดแล้ว `updateStats()` · `_refreshScanCounters()` · ตัวกรอง 📋 "ยังไม่ได้นับ" กลับเท่าเดิมครบ (Counted/Progress = Confirm แล้ว · Pass = pass+stock_adj+audit_check) · มีเทสคุมทั้งเปิดและปิด

| ระดับ | ทำอะไร | ใช้เมื่อ |
|---|---|---|
| **1 สวิตช์** (เร็วสุด) | แก้เป็น `let PROGRESS_BY_SCAN=false;` → commit → `git push origin main` | ตัวเลขสร้างความสับสน/หน้างานอยากกลับไปนับตาม Confirm โดยไม่แตะโค้ดอื่น |
| **2 revert** | `git revert --no-edit $(git log --format=%h --grep='^feat(scan-progress)' 48c8194..HEAD)` → `git push origin main` | ระดับ 1 ไม่พอ · **ดูรายการก่อนรัน** (`git log --oneline --grep=...` ต้องเป็นของงานนี้ล้วน) · ⛔ ห้าม `reset --hard` / force-push |
| **3 Vercel** | promote deployment ก่อนหน้า (ถ้าแผนมี Instant Rollback) | เว็บพังหนัก · ⚠️ ต้อง revert ใน git ตามด้วย |

- หลังย้อน/deploy ต้อง **ปิดแอปแล้วเปิดใหม่** ที่ PDA ทุกเครื่องที่ใช้งานอยู่ (heartbeat ไม่รีโหลดเครื่องที่สแกนแล้ว — ดู Known limitations) · **ตรวจรุ่น (Console):** `typeof PROGRESS_BY_SCAN` = `'boolean'` → รุ่นใหม่ · `'undefined'` → ก่อนแก้
- **อาการที่ควรสงสัยงานนี้:** Counted/Progress ไม่ขยับหลังสแกน (ทั้ง Desktop และ PDA) หรือไม่ลดหลังกด ✕ · Progress เกิน 100% (ห้ามเกิด) · Counted ≠ ตัวเศษ Progress · Pass ไม่ขยับหลัง Desktop Confirm · ตัวเลข PDA ≠ Desktop · 📋 "ยังไม่ได้นับ" ไม่เท่า ตัวหาร − ตัวเศษ · (เป็นเจตนา ไม่ใช่บั๊ก) Progress 100% ทั้งที่ยังไม่ Confirm · Pass ลดลงหลัง deploy เพราะตัด Stock Adj
- **ตรวจแล้ว 30 ก.ย. 2026:** ทำตามระดับ 2 (`git revert` คอมมิตของงานนี้) ใน worktree แยก (ไม่แตะโฟลเดอร์งาน) → `git diff 48c8194 HEAD` **ว่างทั้งต้นไม้** · สวิตช์มีเทสคุมทั้งเปิดและปิด (`progress-by-scan` logic 23 + e2e 3) · ใส่บั๊กจงใจ 7 แบบลงสำเนาชั่วคราว (ไม่กรองชุดนับ / เส้นทางเบาไม่เขียนการ์ด / Pass รวม Stock Adj / `updateStats` ไม่เขียนทับ / ตัวกรอง "ยังไม่ได้นับ" ยังรวม scanning / สวิตช์ปิดเป็นค่าเริ่มต้น / ตัด PDA ออก) แล้วเทสจับได้ทุกแบบ (ล้ม 3–20 ข้อต่อแบบ) · `npm test` ทั้งชุดผ่าน (logic 146 · e2e 70 + เทสวัด 2 ข้อที่ opt-in) · ต้นทุนเพิ่มต่อสแกน ≈0.8 ms (`_writeScanProgress` · catalog 5,400 · CPU 4× · ไม่มี long task · `updateStats` ไม่ถูกเรียกต่อสแกน) · ⏳ **ยังไม่ได้ทดสอบบน PDA/Desktop จริง** (สแกนต่อเนื่อง/หลายเครื่อง/Desktop Confirm — ตาม §เมื่องานเสร็จ)

#### 🧑‍⚕️ เภสัชทำ Stock Adj อย่างเดียว ไม่ทำ Audit (สาขายา · ผู้ใช้สั่ง 30 ก.ย. 2026)

ต่อจาก 29 ก.ย. ที่ตัด Audit ออกจาก Confirm รอบแรก (`ab95bf0`) — งานนี้ถอด **บทบาท Audit ของรหัสเภสัช** (UI ล้วน · ไม่แตะฟังก์ชัน scan-related ตัวใดเลย · ไม่เปลี่ยน schema/rules/APK/sw.js)

> ⏸ **6 ต.ค. 2026 (รอบ 3): สวิตช์ `PHARMACIST_STOCKADJ_ONLY` ตั้งเป็น `false` แล้ว** ตามคำสั่ง "รหัสเภสัชรีเช็คได้ตลอด" — หัวข้อนี้จึงอธิบายพฤติกรรมเมื่อสวิตช์**เปิด** (= ทางถอย: ตั้ง `true` แล้ว deploy) · โค้ด idle/`_applyPharmacistAuditMode`/CSS `pharm-audit-idle` เก็บไว้ครบ ห้ามลบ · เทส `pharmacist-stockadj-only.spec.js` ตั้งสวิตช์เองทุกเคสจึงยังตรึงพฤติกรรม idle ได้

- **สวิตช์ `PHARMACIST_STOCKADJ_ONLY`** (`let` · `index.html` ใกล้ `PHARMACY_DIRECT_STOCK_ADJ`) · **โหมด idle** = สวิตช์เปิด && สาขายา && `currentRole==='pharmacist'` && **จำนวน `audit` ใน `scanData` = 0** (`_pharmAuditIdle(n)` · นับด้วย `_legacyAuditCount()`)
- **idle:** ซ่อนช่องสแกน/RESULT/ปุ่ม "✓ ยืนยัน Audit" (CSS `body.pharm-audit-idle` + `#pharmIdleNote`) · แผงเปลี่ยนชื่อเป็น **Stock Adj** · ป็อปอัพเปิดแท็บ Stock Adj (ซ่อนแท็บ Audit/แถวสแกน/ปุ่มยืนยันทั้งหมด) · **ปุ่ม ↺ สแกนใหม่ อยู่ครบ** = ทางแก้รายตัวเดียว
- **มี `audit` ค้าง (ของเดิมก่อน 29 ก.ย. หรือรายการที่กด ↺ กลับมา):** UI Audit เดิมกลับมาเอง **ครบทุกอย่าง** จนปิดหมด แล้วกลับ idle เอง · จุดสลับเดียวคือ `_applyPharmacistAuditMode(n)` เรียกจากท้าย `updateAuditVerifyCount()` (ซึ่ง `updateStats`/snapshot/marker/↺ เรียกอยู่แล้ว) + `applyAuditTerminology()` + `openAuditVerifyPopup()` — **ห้ามเพิ่ม hook ในเส้นทางสแกน**
- ⛔ **ห้ามแปลง `audit` ค้างเป็น Stock Adj อัตโนมัติ** (ยอดรีเช็คหาย) — ยกเว้นเครื่องมือแปลงครั้งเดียวที่คนสั่งเอง (ต.ค. 2026 · ดู §สาขายาไม่มีคำว่า Audit) · ⛔ **ห้ามลบโค้ด Audit Verify/marker/`reopenPharmacyAudit`** — ↺ ต้องพารายการกลับเป็น `audit` ซึ่งใช้โค้ดฝั่งนั้น · role/สาขาอื่น (ผู้ช่วย · หัวหน้า/พนักงาน WH · เภสัชบน WH) **ไม่ถูกแตะ** (เทสตรึงไว้)
- **ด่านกันสแกนในโหมด idle มีอยู่เดิม:** `processPharmacistAuditScan` ปฏิเสธ SKU ที่ไม่ใช่ `audit` ([index.html](index.html) ข้อความ `— ไม่ใช่ Audit`) จึงไม่ต้องแก้ฟังก์ชันสแกน — เครื่องสแกน PDA ของเภสัชยิงเข้ามาก็ไม่เขียนอะไร
- **ข้อเสียที่ผู้ใช้รับทราบแล้ว:** ไม่มีผู้ตรวจคนที่สอง (`auditor` ว่าง — นับผิด/R16 คลาดเวลาไหลเข้าใบตรงๆ) · ทางแก้รายตัวมีทางเดียวคือ ↺ (Desktop เท่านั้น) · ยอดติดลบที่เป็นหนี้ลูกค้าถูกดันเป็น 0 ในใบ (📦 ค้างส่งใช้ได้เฉพาะรายการที่ ↺ กลับเป็น Audit) · PDA ต้องปิด-เปิดแอปหลัง deploy
- ⚠️ **ข้อสังเกตเอกสาร (ยังไม่ได้ยืนยันหน้างาน):** `updateScanInputMode` ซ่อนแถว Confirm ของรหัสเภสัช (`confirmClearRow` · `isPharm`) แต่ `คู่มือ-สาขา.html` ตาราง "ปุ่ม" ระบุ Confirm = "เภสัช (Desktop)" — ในโค้ด Confirm รอบแรกที่ Desktop ทำได้ด้วยรหัสอื่น (ผู้ช่วย) ไม่ใช่รหัสเภสัช · ไม่ได้แก้เพราะอยู่นอกขอบเขตงานนี้ · ⚠️ ตรวจไม่ได้จากเครื่องพัฒนาว่า Firestore จริงมี `audit` ค้างกี่รายการ (ออกแบบให้ถูกต้องทั้งสองกรณี)

**ทางถอย (แนวเดียวกับงานก่อนหน้า):** จุดก่อนแก้ = `966778b` · คอมมิตของงานนี้ควรขึ้นต้น **`feat(pharm-stockadj):`** (หาด้วย `git log --oneline --grep='^feat(pharm-stockadj)' 966778b..HEAD`) · ไม่มีการเปลี่ยนรูปแบบข้อมูลจึงย้อนโดยไม่ต้อง migrate

| ระดับ | ทำอะไร | ใช้เมื่อ |
|---|---|---|
| **1 สวิตช์** (เร็วสุด) | แก้เป็น `let PHARMACIST_STOCKADJ_ONLY=false;` → commit → push | UI เภสัชสร้างความสับสน/อยากให้เภสัชกลับไปเห็น Audit เหมือนเดิม — ย้อนได้ทันที ป้ายแผง/แถวสแกน/ปุ่มยืนยันกลับเป็นเดิมเมื่อ `updateAuditVerifyCount` ถัดไปทำงาน (เทสตรึงกรณีสวิตช์ปิดกลางทาง) |
| **2 revert** | `git revert --no-edit $(git log --format=%h --grep='^feat(pharm-stockadj)' 966778b..HEAD)` → push | ระดับ 1 ไม่พอ · **ดูรายการก่อนรัน** · ⛔ ห้าม `reset --hard` / force-push |
| **3 Vercel** | promote deployment ก่อนหน้า | เว็บพังหนัก · ⚠️ ต้อง revert ใน git ตามด้วย |

- หลัง deploy/ย้อน ต้อง **ปิดแอปแล้วเปิดใหม่** ที่ PDA ทุกเครื่อง (heartbeat ไม่รีโหลดเครื่องที่สแกนแล้ว — ดู Known limitations) · **ตรวจรุ่น (Console):** `typeof PHARMACIST_STOCKADJ_ONLY` = `'boolean'` → รุ่นใหม่
- **อาการที่ควรสงสัยงานนี้:** เภสัชไม่เห็นปุ่มยืนยัน Audit ทั้งที่มี audit ค้าง · แผงยังชื่อ Audit Verify ทั้งที่ไม่มี audit · ป็อปอัพเปิดแท็บ Audit ว่างเปล่า · หน้าจอผู้ช่วย/หัวหน้า WH เปลี่ยนไป (**ห้ามเกิด**) · ↺ แล้วโหมด Audit ไม่โผล่
- **ตรวจแล้ว 30 ก.ย. 2026:** เทส `tests/specs/logic/pharmacist-stockadj-only.spec.js` 7 ข้อ (idle · มี audit ค้าง · สลับโหมดสองทิศทางระหว่างใช้งาน · สวิตช์ปิด · สวิตช์ปิดกลางทาง · role/สาขาอื่นไม่ถูกแตะ · ด่านกันสแกน) · ใส่บั๊กจงใจ 10 แบบลงสำเนาชั่วคราว (ไม่เช็ค audit=0 / ไม่ย้อนของที่ idle แตะ / ตัดเช็คสาขายา / ตัดเช็ค role / ไม่เลื่อนแท็บ / ไม่เรียกโหมดจาก `updateAuditVerifyCount` / ไม่ซ่อนแถวสแกน / CSS ไม่ซ่อนปุ่มยืนยัน / ป้ายแผงไม่เปลี่ยน) เทสจับได้ **9 แบบ** · อีก 1 แบบ (เปิดป็อปอัพไม่เลือกแท็บ Stock Adj ตอน idle) **หลุดเพราะเป็น equivalent mutant** — ทาง "เลื่อนแท็บอัตโนมัติ" ใน `_applyPharmacistAuditMode` ทับให้ผลเท่ากัน · พิสูจน์ด้วยการถอดสองชั้นพร้อมกันแล้วเทสล้ม 2 ข้อ · `npm test` ทั้งชุดผ่าน (logic 153 · e2e 70 + เทสวัด 2 ข้อที่ opt-in) · ⏳ **ยังไม่ได้ทดสอบบน PDA/Desktop จริง** (เภสัชล็อกอินรอบที่ไม่มี audit → กด ↺ หนึ่งรายการ → ยืนยัน → กลับ idle — ตาม §เมื่องานเสร็จ)

#### 🔁 สาขายาไม่มีคำว่า Audit + แปลง Audit ค้างเป็น Stock Adj (ผู้ใช้สั่ง 6 ต.ค. 2026)

ต่อจาก 29–30 ก.ย. — จอเภสัช SRC ยังเป็น "Audit" 135 รายการ (Audit ค้างก่อนสลับ · ยังไม่มีใครรีเช็ค → `_pharmAuditIdle` false → UI Audit เดิมกลับมาตามดีไซน์) ผู้ใช้สั่ง:
(1) **แปลง Audit ค้างที่ยังไม่มีใครรีเช็คเป็น Stock Adj ด้วยตัวเลขตอน Confirm เดิม** — รับความเสี่ยงแล้วว่า Audit ที่เกิดจาก R16/R01 คลาดเวลาหรือบั๊ก OTFI ของ SRC (แก้ 29 ก.ย.) จะเป็นใบปรับสต็อกผิดเข้า ERP
(2) จอสาขายาไม่มีคำว่า Audit (3) สแกน Stock Adj ที่หน้าหลัก **ต้องกด ↺ ก่อน** — ไม่แก้เส้นทางสแกน (4) ↺ ใช้กับ 🚫 noStock ได้
⛔ **เปลี่ยนแค่ป้าย Audit → "Stock Adjustment" ผิด** (ผู้ใช้เคยเสนอ) — ข้อมูลยังเป็น `audit` จึงไม่เข้า 📦 (ตอนนั้นกรอง `status==='stock_adjustment'` อย่างเดียว) เภสัชจะเข้าใจว่าจบแล้วแต่ยอดไม่ถูกปรับ · ⏩ **แก้แล้วในรอบ 3 (6 ต.ค.):** `audit` ของสาขายาขึ้นใบ 📦 ด้วยเลขตอน Confirm โดยตรง (`PHARMACY_AUDIT_IN_ADJUST_DOC`) — ดู §📦 รอรีเช็คขึ้นใบทันที ด้านล่าง

- **ป้าย (`PHARMACY_RECHECK_TERMS` · แสดงผลล้วน · status code `audit` ไม่เปลี่ยน · WH ไม่แตะ):** `audit` ของสาขายา = **"รอรีเช็ค"** (Stock Adj ที่เภสัชกด ↺ / ค้างจากรอบก่อน / R16 อัปซ้ำพลิก) · ป้ายแถว Desktop `⚠️ Stock Adj · รอรีเช็ค` · PDA `⚠️ รอรีเช็ค` · แผง/ปุ่ม `Stock Adj` ทุกโหมด · `✓ ยืนยันรีเช็ค` · Dashboard `นับไม่ตรง`
  - helper: `_auditTerm()` · `_auditPillLabel()` · `_mismatchTerm()` · `_avPanelLabel()` · `_avPopupTitle()` · `_pharmTxt(old,new)` — **ข้อความใหม่บนจอสาขายาที่เคยมีคำว่า Audit ต้องผ่าน helper เหล่านี้** · HTML คงข้อความเดิม (JS ทับหลัง login) ⇒ ปิดสวิตช์ = เดิมทุกตัวอักษร
  - toast ที่เปลี่ยนต้องแก้ `_PDA_TOAST_SHORT`/regex ใน `_toastMessageForDevice` คู่กัน **และเก็บรายการเดิมไว้** (สวิตช์ปิดยังส่งข้อความเดิม)
- **marker พาธง `directAdj` (กฎ 1 · ไม่มีสวิตช์โดยเจตนา):** marker เป็น authoritative และถูก apply ซ้ำทุก snapshot ⇒ ผลแปลงต้องอยู่ใน marker ทั้งชุด · `_isDirectAdjMarker(m)` = `directAdj===true && status==='stock_adjustment' && !auditor`
  - **R1** `_writePharmacyAuditMarkers`: existing เป็น direct marker → ทิ้ง incoming ที่ไม่ใช่ final / ↺ (`reopenedAt`) / ย้อนแปลง (`convertUndoneAt`) — กัน `reEvaluateAuditItems` (อัป R16 ซ้ำ) และ `_backfillPharmacyAuditMarkersFromLocal` ของเครื่องที่ยังถือ audit (เช่นเครื่องในโหมด Admin ที่ listener หยุด) ดันกลับ
  - **R2** `_applyPharmacyAuditMarkersToState`: ตั้ง `sd.directAdj` ตาม direct marker · `marker.directAdj===false` → ลบ · `same` ต้องเห็นธง (ไม่งั้น echo ของ item ที่ไม่มีธงทำให้ใบคิดผิดสูตรค้าง)
  - **R3** ↺ (`reopenPharmacyAudit`) และ `_pharmacyAuditMarkerFromFinal` ส่ง `directAdj:false` — marker merge `{...existing,...marker}` ถ้าไม่ส่ง ธงของผลแปลงค้าง
  - **marker เก่าไม่มี field นี้ ⇒ ผลเท่าเดิมทุกกรณี** (เทสตรึง) · ไม่มีสวิตช์เพราะปิดหลังแปลงข้อมูลแล้ว = รายการที่แปลงเพี้ยน
- **เครื่องมือ `tools/convert-legacy-pharmacy-audits.js`** (Console · Desktop · รหัสเภสัช · สาขาที่ login · นอกเวลานับ ไม่มีใครรีเช็ค/อัป R16): `await convertLegacyAudits()` = dry-run → `{dryRun:false}` = พิมพ์ `แปลง <สาขา> <จำนวน>` · ดาวน์โหลด JSON สำรอง (marker doc + items) · branch lock · รอ 3.8 วิ · อ่าน server ซ้ำ (rev/marker/ตัวเลขทุกรายการต้องเหมือนตอนสำรวจ ไม่งั้นยกเลิกทั้งชุด) → marker ก่อน → apply → ตรวจว่าเป็น Stock Adj ตรงจริง → `_writeConfirmedItems` → ปลด lock (finally)
  - แปลงเฉพาะ: marker รอบนี้ `audit` ไม่มีผู้ยืนยัน · ไม่ใช่ ↺ · ไม่มียอดรีเช็ค/ค้างส่ง · มี `effectiveQty`/`systemQty` และ**ไม่เท่ากัน** · SKU อยู่ใน skuMap — ที่เหลือ**ข้ามและรายงานแยกกลุ่ม** (คงเป็นรอรีเช็ค)
  - ผลแปลง = `initialStatus:'stock_adjustment'` + `directAdj:true` + คู่ตัวเลขเดิม + `convertedFromAuditAt`/`convertedBy`/`origCountConfirmedAt` · ⚠️ `countConfirmedAt` ต้องเป็นเวลาแปลง (ลำดับ marker non-final ตัดสินด้วยค่านี้ — ใช้ค่าเดิม = backfill จากเครื่องค้างชนะ)
  - dry-run รายงาน `afterSwitch` = Confirm หลัง 29 ก.ย. 19:40 ที่ไม่ใช่ ↺ → เครื่องที่ยังรันโค้ดเก่า (ดู Known limitations เรื่อง reload) หรือ R16 อัปซ้ำ — ถ้าเป็นเครื่องโค้ดเก่า **รีโหลดเครื่องนั้นก่อนแปลง** ไม่งั้น Audit ใหม่เกิดต่อ
  - `await undoConvertLegacyAudits()` ย้อนเป็นรอรีเช็ค (ไม่รวมตัวที่ ↺ ไปแล้ว) · ⛔ **ก่อน Export ใบ 📦 ส่ง ERP เท่านั้น** (ระบบไม่มีตัวกันส่งซ้ำ)
  - ⚠️ สถานะที่ยัง "ไม่นิ่ง" (marker เพิ่งเปลี่ยน → ทุกเครื่อง `saveSession` → sync ตามเวลา → reconcile เขียน item) ทำให้รอบทำจริงยกเลิกเพราะ rev เปลี่ยน = **ถูกต้อง** · รัน dry-run ใหม่แล้วทำซ้ำ
  - ⏳ **สถานะ production (6 ต.ค. 2026): ยังไม่ได้รัน** — ต้อง deploy + ทุกเครื่องรีโหลด/ปิด-เปิดแอปก่อน แล้วรัน SRC ก่อน · KKL/SSS ดู dry-run
- **↺ กับ noStock (`PHARMACY_NOSTOCK_REOPEN`):** `reopenPharmacyAudit` รับ `noStock && status==='stock_adjustment'` เพิ่ม (เดิมปุ่มขึ้นแต่กดแล้ว "เปิดรีเช็คใหม่ไม่ได้") · หลัง ↺ เดิน flow รอรีเช็คเดิม · `noStock` ไม่ถูกลบ (ไม่มีโค้ดอ่านหลัง Confirm)
- **ยังเหลือ (ตั้งใจไม่แก้):** `reEvaluateAuditItems` ยังพลิก pass → รอรีเช็ค เมื่ออัป R16 ซ้ำ (คงไว้: R16 ถัดไปตัดสินใหม่ได้ · ถ้าพลิกเป็น Stock Adj จะแช่แล้วพลิกกลับไม่ได้) · สแกน Stock Adj ที่หน้าหลักโดยไม่กด ↺ ยังถูกปฏิเสธ (ผู้ใช้เลือก) — ข้อความบอกให้กด ↺ ที่ Desktop ก่อน
- เทส: `tests/specs/logic/pharmacy-no-audit-terms.spec.js` (จอสาขายาไม่มี /Audit/ ทุกจุด + ตัวตรวจต้องมองเห็นคำเดิมจริงเมื่อปิดสวิตช์ · PDA ป้ายสั้น · WH เท่าเดิม · สวิตช์ปิด = เดิมทุกตัวอักษร) · `tests/specs/logic/pharmacy-convert-marker.spec.js` (R1–R3 · marker เก่าเท่าเดิม · ↺ noStock) · `tests/specs/e2e/convert-legacy-audit.spec.js` (dry-run ไม่เขียน · แปลงเฉพาะที่เข้าเกณฑ์ · สองเครื่อง · กันดันกลับ · รันซ้ำ = 0 · ↺ · undo)

**ทางถอย:** จุดก่อนแก้ = `ababb7a` · คอมมิตของงานนี้ขึ้นต้น **`feat(no-audit):`** (หาด้วย `git log --oneline --grep='^feat(no-audit)' ababb7a..HEAD`)

| ระดับ | ทำอะไร | ใช้เมื่อ |
|---|---|---|
| **1 สวิตช์** | `let PHARMACY_RECHECK_TERMS=false;` (ป้าย) · `let PHARMACY_NOSTOCK_REOPEN=false;` (↺ noStock) → commit → push | คำใหม่สับสน / ไม่ต้องการ ↺ กับ noStock — ไม่กระทบข้อมูล |
| **ข้อมูลที่แปลง** | `undoConvertLegacyAudits({dryRun:false})` หรือคืนจาก JSON สำรอง | แปลงผิด — **ก่อน Export ใบ 📦 ส่ง ERP เท่านั้น** |
| **2 revert** | **ย้อนข้อมูลที่แปลงก่อน** แล้ว `git revert --no-edit $(git log --format=%h --grep='^feat(no-audit)' ababb7a..HEAD)` → push · **ดูรายการก่อนรัน** · ⛔ ห้าม `reset --hard`/force-push | ระดับ 1 ไม่พอ · revert ทั้งที่ยังมีผลแปลง = ไม่มีด่าน R1/R2 (เครื่องค้างดันกลับได้ · ช่วงที่ marker มาก่อน item ใบคิดผิดสูตร) |
| **3 Vercel** | promote deployment ก่อนหน้า | เว็บพังหนัก · ⚠️ ต้อง revert ใน git ตามด้วย |

- ตรวจรุ่น (Console): `typeof PHARMACY_RECHECK_TERMS` = `'boolean'` · `typeof _isDirectAdjMarker` = `'function'` · หลัง deploy ต้อง **ปิด-เปิดแอป PDA ทุกเครื่อง + รีโหลด Desktop** (ดู Known limitations)
- **อาการที่ควรสงสัยงานนี้:** คำว่า Audit โผล่บนจอสาขายา · ป้าย/หัวป็อปอัพของ WH เปลี่ยน (**ห้ามเกิด**) · รายการที่แปลงแล้วกลับเป็นรอรีเช็คเอง · ใบ 📦 ของรายการที่แปลงไม่ตรง `effectiveQty − systemQty` ใน marker · ↺ noStock ไม่ทำงาน
- ป้ายในตาราง RESULT บน Desktop แบ่ง 2 บรรทัด (`⚠️ Stock Adj` / `รอรีเช็ค` · `_auditPillLabel(true)`) — บรรทัดเดียวล้นช่อง STATUS 128px จนถูกตัด (เห็นจากภาพจริง) · 📋 ใช้บรรทัดเดียว · เทสตรึงว่าป้ายไม่ล้นช่อง
- ตัวเลขบนปุ่มแผง "Stock Adj" = **จำนวนรอรีเช็ค** (ไม่ใช่จำนวน Stock Adj) — ตั้งใจคงไว้เพราะ invariant เดิม "การ์ดรอรีเช็ค (เดิม Audit) = badge ปุ่มแผง" (`countable-set.spec.js`) · จำนวน Stock Adj ดูที่ 📦 ปรับปรุงสินค้า / แท็บ Stock Adj
- **ตรวจแล้ว 6 ต.ค. 2026:** `npm test` ทั้งชุดผ่าน (logic 164 · e2e 71 + เทสวัด 2 ข้อที่ opt-in) · e2e เครื่องมือแปลงรันซ้ำ 4 รอบผ่านทุกรอบ · ใส่บั๊กจงใจ 14 แบบลงสำเนาชั่วคราว (ถอด R1 / ถอดตั้งธง R2 / ถอดลบธง R2 / ถอด same R2 / ถอด `directAdj:false` ของ ↺ / ของผลยืนยัน / ถอด guard noStock / ป้ายแถวเดิม / ปุ่มยืนยันเดิม / `_auditTerm` เดิม / ป้ายแผงรั่วไป WH / สวิตช์ถูกเมิน / ป้าย Dashboard Rate เดิม / ข้อความเตือนสแกนเดิม) **เทสจับได้ครบ 14** (รอบแรกหลุด 1 = Dashboard "รอรีเช็ค Rate" ไม่มีคำว่า Audit จึงผ่านตัวตรวจคำ → เพิ่มการตรวจป้ายตามความหมาย) · ภาพจอ Desktop 1465px + PDA 393px ป้ายไม่ล้น · ทำตามระดับ 2 (`git revert` คอมมิต `feat(no-audit)` ทั้งหมด) ใน worktree แยก → `git diff ababb7a HEAD` **ว่างทั้งต้นไม้** · ⏳ **ยังไม่ได้ทดสอบบน PDA/Desktop จริง และยังไม่ได้รันเครื่องมือแปลงบน production**

#### 📦 รอรีเช็คขึ้นใบทันที + แก้จำนวนในใบ + เภสัชรีเช็คได้ตลอด (สาขายา · ผู้ใช้สั่ง 6 ต.ค. 2026 รอบ 3)

ผู้ใช้สั่ง: (1) สินค้านับผิด/ไม่ตรง**ทั้งหมด**เข้าหน้า 📦 ปรับปรุงสินค้าทันที ไม่รอเภสัชรีเช็ค/"⚠️ Stock Adj รอรีเช็ค" (2) หน้า 📦 แก้ "จำนวน" ได้ (3) รหัสเภสัชรีเช็คได้ตลอด — ผู้ใช้เลือก: แก้ช่อง "จำนวน" ที่ออกใบโดยตรง (ไม่ใช่แก้ยอดนับ) · ยกเลิกโหมดซ่อน · **เฉพาะสาขายา SRC/KKL/SSS (WH ไม่แตะ)** · งานนี้ไม่แก้ฟังก์ชัน scan-related ตัวใด (ไม่แตะ `reopenPharmacyAudit`/`confirmAuditVerifyItem`/`processPharmacistAuditScan`/marker/`_scanItemPayload`) · ไม่เปลี่ยน `firestore.rules`/`sw.js`/APK/Supabase · ไม่ bump APK

- **สวิตช์ 3 ตัว** (`let` ใน `index.html`): `PHARMACY_AUDIT_IN_ADJUST_DOC` (audit ขึ้นใบ) · `ADJUST_DOC_QTY_EDIT` (ช่องแก้จำนวน + ใช้ค่าที่แก้) · `PHARMACIST_STOCKADJ_ONLY=false` (ปิดโหมดซ่อน — โค้ด idle เก็บครบ) · **ปิดครบทั้งสาม = ใบ/จอเภสัชเท่าเดิมทุกจุด** (เทสตรึงทั้งเปิดและปิด)
- **audit ขึ้นใบ:** ผ่าน `_isAdjustDocItem(sd)` = `stock_adjustment` ทุกตัว + `_isAuditAdjItem(sd)` (สาขายา · `audit` · ไม่มี `auditor` · **ไม่ใช่ `backorder`** — ค้างส่ง = เภสัชตัดสินแล้วว่าไม่ต้องปรับ) · ตัวเลข = **คู่ที่ marker แช่ไว้ตอน Confirm** (`_auditAdjPair(sd,sku)`: `effectiveQty − systemQty` ต้องเป็นตัวเลขจำกัดทั้งคู่ · อ่านจาก `sd` ก่อน ถ้า `sd` ไม่มีเลข (marker "same" ไปแล้วแต่ไม่เคย apply เลขลง item) ถอยไปอ่านจาก `_pharmacyAuditMarkerData` ของรอบนี้ที่ยังเป็น `audit` ไม่มีผู้ยืนยัน — ต้นทางเดียวกับเครื่องมือแปลง Audit · `sd` ที่มีเลขชนะ marker) = คู่เดียวกับ Stock Adj ตรง → ไม่ผ่านด่านความสด ไม่ขยับตาม R01 ใหม่ · ไม่ครบทั้งสองที่ = ไม่ขึ้นใบ + `_adjustDocAudit().noBasis` + toast ตอน Export (**ห้ามหายเงียบ**) · แถวมีป้าย "รอรีเช็ค" · ปุ่มนับ `_countAdjustDocItems` นับ audit ด้วย · LOT/ราคาถูกขอให้ audit ด้วย (`_adjustDocSkuSet`) · ⚠️ **ยกเว้นรายการที่ถูก ↺** — เลขใน marker ถูกเขียนทับจนไม่ใช่เลขตอน Confirm ใบจึงข้ามจนกว่ายืนยันรีเช็ค (ดู "↺ รอรีเช็คไม่ขึ้นใบ" ด้านล่าง)
- ⛔ **ใบแสดง "ผลที่ตัดสินแล้ว" เท่านั้น — ห้ามเอายอดรีเช็คที่ยังไม่ยืนยัน (ร่าง `recheckQty` บน audit) มาคำนวณ** · ยืนยันรีเช็คเมื่อไร ผลใหม่แทนเอง: pass = ออกจากใบ · stock_adjustment = กติกาเดิม (ยอดรีเช็ค − ยอดสด + ด่านความสด `_isAdjustRowFresh`) · ถ้าจะให้ร่างมีผลต้องจำลองการตัดสิน `effectiveQty(recheck)===baseSys` ซ้ำในใบ แล้วกติกาจะเพี้ยนจาก Confirm จริง
- **`_adjustDocDiff(sku,sd,si,wh)`** = ตัวเลขแถวเดียว (แยกออกจากลูปเดิม พฤติกรรมเดิมทุกกรณี) ใช้ร่วมโดย `_buildAdjustDocRows` กับ `setAdjDocQty` · ⚠️ `_adjustDocAudit` ยังเขียนเงื่อนไขซ้ำคู่กัน (เหมือนเดิม) — **แก้ที่ใดต้องแก้อีกที่**
- **แก้ "จำนวน" ในใบ (`setAdjDocQty`/`resetAdjDocQty`)** — เฉพาะเภสัช · สาขายา · Desktop · ไม่ติดล็อก Confirm (`_canEditAdjDocQty`) · เก็บเป็น**ฟิลด์แบนบน item:** `adjQty` (จำนวน) · `adjBase` (ผลต่างลงนามที่ค่านี้ทับอยู่) · `adjBy` · `adjAt` → ซิงก์ผ่าน `_markSkuDirty` (`_scanItemPayload`/`_scanItemToLocal` วนทุกฟิลด์เอง · เขียนด้วย `batch.set` ทั้ง doc จึงล้างค่าด้วยการ `delete` ได้)
  - ⛔ **ห้ามเก็บเป็น object ซ้อน** — Firestore คืน key ของ map เรียงตัวอักษร ทำให้ `_scanItemFingerprint` (เรียงเฉพาะ key ชั้นบน) เห็นว่า "เปลี่ยน" ทุก echo → rebuild/stats เกินหนึ่งรอบต่อการแก้ (เจอตอนเขียนเทส · เทสตรึง)
  - ใช้ได้เฉพาะเมื่อผลต่างปัจจุบัน `=== adjBase` (`_adjQtyOverride`) → รีเช็ค/R16/↺ เปลี่ยนหลักฐาน = ค่าที่แก้หลุดเอง ไม่ค้างเป็นเลขที่ไม่มีใครตรวจ · ผลต่างกลับมาตรง `adjBase` เดิมค่าที่แก้ใช้ได้อีก (ผูกกับผลต่าง ไม่ใช่เวลา — ป้าย "เดิม N" ยังโชว์ให้เห็น)
  - ทิศ ORDS/IRPS แก้ในช่องนี้**ไม่ได้** (ต้อง ↺ รีเช็ค) · พิมพ์ `0` = แถวคงบนจอ (ไว้คืนค่า) แต่**ไม่ลง Export Text/Excel** (`rows.filter(r=>r.qty>0)` · toast บอกจำนวนที่แก้/ข้าม `_adjEditNote`) · พิมพ์เท่าค่าคำนวณ = ล้างค่า (`_clearAdjQty` ล้างครบ 4 ฟิลด์) · ติดลบ/ไม่ใช่ตัวเลข = ปฏิเสธ · ค่าเท่าเดิม (blur) ไม่สั่งเขียน
  - ค่าที่แก้มีผลกับ**ใบ 📦 (ตาราง + Export Text/Excel) เท่านั้น** — แท็บ Stock Adj · 📋 ประวัติ · Export Stock Adj · Pass/Audit/สถานะ ยังโชว์เลขเดิม · ฟิลด์ `adj*` ไม่อยู่ใน marker → `_applyPharmacyAuditMarkersToState` ไม่ล้าง · WH ไม่แตะ (`_adjQtyOverride` ตรวจ `_isPharmacyBranch()` ด้วย)
  - `renderAdjustDocTable(force)` ไม่วาดทับช่องที่กำลังพิมพ์ (`_adjRenderDeferred` — `_refreshAdjMaster` โหลดเสร็จกลางคันเคยทำให้ช่องรีเซ็ต) · `setAdjDocQty`/`resetAdjDocQty` ส่ง `force` วาดทันที
- **เภสัชรีเช็คตลอด:** `PHARMACIST_STOCKADJ_ONLY=false` → ช่องสแกน/RESULT/แท็บรอรีเช็ค/ปุ่ม ✓ ยืนยันรีเช็ค อยู่ตลอดแม้ไม่มี audit ค้าง · สแกน Stock Adj ที่ยังไม่ ↺ **ยังถูกปฏิเสธ** (`processPharmacistAuditScan` ไม่ถูกแตะ — ผู้ใช้เลือกไม่แก้ เพราะเป็นฟังก์ชัน scan-related · ถ้าจะให้สแกนเปิดรีเช็คเองได้ต้องขออนุมัติแยก)
- **ข้อเสียที่ผู้ใช้ต้องรู้:** ① ระบบ**ไม่มี `issuedAt`** — แถวอยู่ในใบจนกว่าสถานะ/ผลต่างเปลี่ยน ⇒ ส่งใบเดิมซ้ำ หรือส่ง audit ก่อนรีเช็คแล้วรีเช็คเปลี่ยนผล = ERP ถูกปรับสองรอบได้ (ยังไม่มีตัวกัน — ข้อเสนอแยก ไม่ทำในงานนี้) ② audit ที่เกิดจาก R16/R01 คลาดเวลาหรือบั๊ก OTFI ของ SRC (แก้ 29 ก.ย.) ขึ้นใบด้วยเลขผิดได้จนกว่าจะอัป R16 ใหม่ (`reEvaluateAuditItems` พลิกเป็น pass เอง) หรือรีเช็ค — ป้าย "รอรีเช็ค" ไว้ให้ตรวจก่อนส่ง (ความเสี่ยงเดียวกับเครื่องมือแปลง Audit ที่ผู้ใช้รับแล้ว) ③ แก้ข้ามทิศไม่ได้ ④ PDA/Desktop ต้องปิด-เปิดแอปหลัง deploy (ดู Known limitations)
- เทส: `tests/specs/logic/adjust-doc-audit-edit.spec.js` (audit ขึ้นใบถูกทิศ/จำนวน · อ่านเลขจาก marker เมื่อ `sd` ไม่มี · ★ ไม่ขึ้นใบ: ค้างส่ง/ไม่มีเลข/ร่างรีเช็ค/WH/สวิตช์ปิด · ยืนยันรีเช็คแล้วผลใหม่แทน · แก้จำนวน/0/เท่าเดิม/ค่าผิด/คืนค่า · ค่าที่แก้หลุดเมื่อผลต่างเปลี่ยน · ★ สิทธิ์ · ไม่วาดทับช่องที่พิมพ์ · ค่าเริ่มต้นโหมดซ่อนปิด · payload/fingerprint) · `tests/specs/e2e/adjust-doc-edit-sync.spec.js` (สองเครื่อง: แก้→cloud→อีกเครื่องเห็น · marker apply ซ้ำไม่ล้าง · คืนค่า · รีเช็คยืนยันแล้วค่าที่แก้หลุด) · เทสเดิมที่ตรึง "audit ไม่ขึ้นใบ" ถูกปรับตามคำสั่งผู้ใช้: `pharmacy-convert-marker.spec.js` (ข้อ "marker เก่า" — ตรึงทั้งสวิตช์เปิด/ปิด) · `e2e/convert-legacy-audit.spec.js` (รอรีเช็คที่ข้าม + ที่ย้อนการแปลง **อยู่ในใบ** พร้อมป้าย pending)

**ทางถอย:** จุดก่อนแก้ = `fbc2336` · คอมมิตของงานนี้ควรขึ้นต้น **`feat(adj-doc):`** (หาด้วย `git log --oneline --grep='^feat(adj-doc)' fbc2336..HEAD`) · ไม่มีการเปลี่ยน schema/รูปแบบข้อมูล — ฟิลด์ `adj*` ที่ค้างบน cloud หลังย้อนไม่มีโค้ดอ่านแล้ว (ไม่ต้อง migrate)

| ระดับ | ทำอะไร | ใช้เมื่อ |
|---|---|---|
| **1 สวิตช์** (เร็วสุด ปิดทีละตัวได้) | `let PHARMACY_AUDIT_IN_ADJUST_DOC=false;` (รอรีเช็คไม่ขึ้นใบ) · `let ADJUST_DOC_QTY_EDIT=false;` (ไม่มีช่องพิมพ์ + ค่าที่แก้ไม่ถูกใช้ → ใบ/ไฟล์ตรงเดิม) · `let PHARMACIST_STOCKADJ_ONLY=true;` (กลับโหมดซ่อน) → commit → push | เลขในใบสร้างความสับสน / ส่งผิด / อยากให้เภสัชกลับไปไม่เห็นช่องสแกนตอนไม่มี audit |
| **2 revert** | `git revert --no-edit $(git log --format=%h --grep='^feat(adj-doc)' fbc2336..HEAD)` → push · **ดูรายการก่อนรัน** · ⛔ ห้าม `reset --hard`/force-push | ระดับ 1 ไม่พอ |
| **3 Vercel** | promote deployment ก่อนหน้า | เว็บพังหนัก · ⚠️ ต้อง revert ใน git ตามด้วย |

- **อาการที่ควรสงสัยงานนี้:** ใบ 📦 มีแถว "รอรีเช็ค" ที่เลขไม่ตรงความจริง · ปุ่ม 📦 ตัวเลขมากกว่าแถวบนใบ (audit ไม่มีเลขตอน Confirm → `noBasis`) · ช่องจำนวนไม่ขึ้น/ค่าที่แก้หาย/ไม่ซิงก์อีกเครื่อง · Export ได้เลขไม่ตรงจอ · เภสัชเห็นช่องสแกนตอนไม่มี audit (ตั้งใจ) · หน้าจอผู้ช่วย/หัวหน้า WH/เภสัช WH เปลี่ยนไป (**ห้ามเกิด**)
- ตรวจรุ่น (Console): `typeof ADJUST_DOC_QTY_EDIT` = `'boolean'` → รุ่นใหม่ · ค่าที่เก็บบน cloud: ฟิลด์ `adjQty/adjBase/adjBy/adjAt` ใน `stock_sessions/{branch}/items/{sku}`
- **ตรวจแล้ว 6 ต.ค. 2026:** `npm test` ทั้งชุดผ่าน (logic 176 · e2e 72 + เทสวัด 2 ข้อที่ opt-in) · **ทางถอยระดับสวิตช์พิสูจน์แล้ว:** สำเนาที่ใช้เทสเดิมจาก `fbc2336` (ไม่รวมเทสใหม่) + ตั้งสวิตช์ทั้งสามกลับค่าเดิม ผ่านครบ (logic 164 · e2e 71 + 2 opt-in = เท่าชุดก่อนแก้) · ใส่บั๊กจงใจ 23 แบบลงสำเนาชั่วคราว (ไม่รวม audit / ไม่ตัดค้างส่ง / ค่าแก้ไม่ผูก `adjBase` / Export รวมแถว 0 (Text และ Excel) / audit ของ WH รั่วเข้าใบ / ทุก role แก้ได้ / ปิดสวิตช์แล้วยังใช้ค่าแก้ / ปุ่มนับไม่รวม audit / ร่างรีเช็คมีผลกับใบ / LOT-ราคาไม่ขอให้ audit / ล้างค่าไม่ครบ / รับค่าติดลบ / ไม่เช็คล็อก Confirm / ไม่รายงาน `noBasis` / โหมดซ่อนเปิดเป็นค่าเริ่มต้น / ไม่ force วาดหลังบันทึก / วาดทับช่องที่พิมพ์ / ไม่ส่ง `adjBase` / audit ตรงพอดีไม่ settled / marker ผิดรอบ 2 ระดับ / marker ที่ไม่ใช่ audit รอ) **เทสจับได้ครบ 23** (รอบแรกข้าม 1 แบบเพราะสคริปต์ใส่บั๊กยังใช้ signature เก่า — แก้สคริปต์แล้วจับได้) · ภาพจอ Desktop 1465px (ช่องพิมพ์ · ป้ายรอรีเช็ค · ค่าที่แก้ · แถว 0 ขีดฆ่า ไม่ล้น) · ระหว่างเขียนเทสเจอ 2 เรื่องที่แก้แล้ว: เก็บค่าแก้เป็น object ซ้อนทำ fingerprint เปลี่ยนทุก echo (→ ฟิลด์แบน) · `sd` ที่ marker "same" ไปแล้วอาจไม่มีเลขตอน Confirm (→ ถอยอ่านจาก marker) · ทำตามระดับ 2 (`git revert` คอมมิตงานนี้ `3675373`) ใน worktree แยก (ไม่แตะโฟลเดอร์งาน) → `git diff fbc2336 HEAD` **ว่างทั้งต้นไม้** · ⏳ **ยังไม่ได้ทดสอบบน PDA/Desktop จริง** (เภสัชเปิด 📦 → เห็นแถวรอรีเช็ค · แก้จำนวน → เครื่องที่สองเห็น · Export Text/Excel · login เภสัชตอนไม่มี audit เห็นช่องสแกน — ตาม §เมื่องานเสร็จ)

#### ↺ รอรีเช็คไม่ขึ้นใบ 📦 จนกว่ายืนยันรีเช็ค (สาขายา · ผู้ใช้เลือก 6 ต.ค. 2026 รอบ 4 — เคส 200402)

ผู้ใช้ถามว่าทำไม 200402 (รอรีเช็คใน RESULT) ไม่เข้าใบ 📦 → วินิจฉัยด้วย Console: `นับ 6 = ระบบ 6` (ผลต่าง 0 → `settled`) และ marker มี `reopenedAt` (ถูกกด ↺ วันนั้น) · ปุ่ม 📦 = 269 = ORDS 214 + IRPS 37 + settled 18 (อย่าทึกทักว่าทั้ง 18 เป็นรายการ ↺ — ไม่เคยแยกนับ)

- **ต้นเหตุ (จำลองซ้ำบน emulator แล้ว — `e2e/adjust-doc-reopened.spec.js`):** ↺ (`reopenPharmacyAudit`) เขียน marker ด้วย `effectiveQty=ยอดนับดิบ` · `systemQty=ระบบสด ณ ตอนกด` · `soldQty/inboundQty=0` และลบ `sd.effectiveQty` → ตอน login ครั้งถัดไป `_backfillPharmacyAuditMarkersFromLocal` (รันทุกครั้งใน `_loadPharmacyAuditMarkerState`) เขียน marker ซ้ำจาก sd ในเครื่อง — `countConfirmedAt` เท่ากับของ ↺ จึงผ่าน guard "ไม่ลด confirmedAt" ใน `_writePharmacyAuditMarkers` — ได้ `effectiveQty=ยอดนับ` (fallback) · `systemQty`/`soldQty`/`inboundQty`/เวอร์ชัน R01-R16 เป็นค่าเก่าของ sd · `confirmedBy` ว่าง (ร่องรอยใน marker ของ 200402) ⇒ **เลขใน marker ของรายการ ↺ ไม่ใช่เลขตอน Confirm อีกต่อไป** — รอบ 3 สมมติว่าใช่ (ช่องโหว่ที่เพิ่งพบ)
- **ผลก่อนแก้:** ใบหาแถว (ผลต่าง 0 → `settled`) หรือขึ้นเลขข้ามเวลา (นับดิบ − ระบบ ไม่รวมชดเชย R16) ทั้งที่ยังไม่มีใครรีเช็ค — ทั้งสองแบบส่งผิดเข้า ERP ได้
- **กติกาใหม่ (ฝั่งใบอย่างเดียว):** `_isReopenedAudit(sku)` = marker ของรอบนี้ `status==='audit' && !auditor && reopenedAt` (อ่านผ่าน `_getPharmacyAuditMarker`) → `_adjustDocDiff` คืน null (ไม่ขึ้นใบ) · `_adjustDocAudit().reopened` รายงาน (`_adjustDocDiff` กับ `_adjustDocAudit` ต้องตรงกันเสมอ) · `_warnAdjustDocDropped` toast ตอน Export "รอรีเช็คหลังกด ↺ N — ยืนยันรีเช็คแล้วจะขึ้นใบ" (**ห้ามหายเงียบ**) · ปุ่ม `_countAdjustDocItems` ยังนับ (ยังเป็นงานค้าง) · ยืนยันรีเช็คแล้ว (status ไม่ใช่ audit) ผลใหม่ขึ้นใบตามกติกาเดิมของ Stock Adj แม้ marker ยังเก็บ `reopenedAt` · ค้างส่ง (`backorder`) ชนะเสมอ (ไม่ใช่งานของใบตั้งแต่ต้น · ไม่ถูกนับเป็น reopened)
- ⛔ **ไม่แตะ `reopenPharmacyAudit` / marker / backfill / สแกน** (ผู้ใช้เลือกทางนี้) — ทางเลือก "เก็บเลขตอน Confirm ไว้ข้าม ↺" ต้องแก้ฟังก์ชัน scan-related และเสี่ยงส่งซ้ำเพราะไม่มี `issuedAt` · marker ยังถูกเขียนทับเหมือนเดิม แต่ไม่มีใครอ่านเลขนั้นมาตัดสินแล้วจนกว่าผลยืนยันรีเช็ค (final marker) ทับ · ถ้าวันหนึ่งมีโค้ดใหม่อ่าน `effectiveQty/systemQty` ของ marker ที่เป็น audit ต้องรู้ว่ารายการ ↺ เชื่อไม่ได้
- ⚠️ ต้องมี marker ของรอบนี้ในหน่วยความจำ (`_pharmacyAuditMarkerData` — ปกติมาจาก listener) · **Admin Mode หยุด listener** → ช่วงนั้นรายการ ↺ ถูกมองเป็น audit ธรรมดา (เลขจาก sd) ไม่เป็นปัญหาถ้าไม่ Export ระหว่าง Admin Mode · `sd` ไม่เก็บ `reopenedAt` (จงใจ ไม่แตะ ↺)
- **สวิตช์ `ADJUST_DOC_SKIP_REOPENED`** (`let` ข้าง `ADJUST_DOC_QTY_EDIT`) — ปิดแล้วรายการ ↺ กลับไปใช้เลขใน marker ทุกตัวเลขเหมือนก่อนแก้ (เทสตรึง · e2e พิสูจน์ว่าปิดแล้วเลขข้ามเวลาโผล่จริง) · **ทางถอย:** จุดก่อนแก้ = `4d79e7d` · ตั้ง `let ADJUST_DOC_SKIP_REOPENED=false;` → commit → push · หรือ `git revert` คอมมิตที่ขึ้นต้น `fix(adj-doc):` (หาด้วย `git log --oneline --grep='^fix(adj-doc)' 4d79e7d..HEAD` · ดูรายการก่อนรัน · ⛔ ห้าม `reset --hard`/force-push) · ไม่มีการเปลี่ยน schema/ข้อมูล/rules/APK/sw.js
- **อาการที่ควรสงสัยงานนี้:** รายการรอรีเช็คที่เพิ่งกด ↺ ไม่โผล่ในใบ (ตั้งใจ) · ปุ่ม 📦 มากกว่าแถวบนใบ (ตั้งใจ — ผลต่าง 0 / รอรีเช็คหลัง ↺ / ไม่มีเลข) · toast Export เตือนจำนวน ↺ · ยืนยันรีเช็คแล้วแต่ไม่ขึ้นใบ (**ห้ามเกิด** — ต้องขึ้นตามกติกา Stock Adj เดิมถ้ายอดไม่ตรง)
- เทส: `tests/specs/logic/adjust-doc-reopened.spec.js` (↺ ไม่ขึ้นใบ + รายงาน reopened + ยังนับในปุ่ม · ที่ไม่เคย ↺ ขึ้นเหมือนเดิม · ยืนยันรีเช็คแล้วขึ้นใบ · marker ผิดรอบ/ไม่มี/ค้างส่ง ไม่ถือเป็น ↺ · สวิตช์ปิด = เดิมทุกตัวเลข · แก้จำนวนไม่ได้ + toast Export) · `tests/specs/e2e/adjust-doc-reopened.spec.js` (เส้นทางจริง ↺ → backfill → ใบ → รีเช็ค → ยืนยัน) · ปรับ `e2e/convert-legacy-audit.spec.js` (S-ZERO ที่ ↺ ไม่ขึ้นใบแล้ว)
- ⏳ **ยังไม่ได้ทดสอบบน Desktop จริง** และ **ยังไม่ได้ทดลอง `git revert` ใน worktree แยก** (ทำหลัง commit) · ใบที่ Export ไปก่อนแก้อาจมีรายการ ↺ ที่เลขผิด — ตรวจย้อนหลังจาก marker: `audit` ที่มี `reopenedAt`

### Known limitations / rollout assumptions

- **Auto-refresh (heartbeat ETag) ไม่รีโหลดเครื่องที่สแกนแล้วหลัง login/reset** — ด่าน `_reloadGateOk` เช็ค `_pendingPatches.size` แต่ Set นี้ถูกล้างแค่ตอนเริ่ม drain ถัดไป/`resetScanRuntimeState` (ตรวจแล้ว 29 ก.ย. 2026: `ab95bf0` เป็นแบบนี้อยู่แล้ว) ⇒ deploy ใหม่ไม่ถึง PDA ที่กำลังใช้งานจนกว่าจะปิด-เปิดแอป · **reload บังคับข้ามวัน (หลัง 04:00) ก็ผ่านด่านเดียวกัน** ⇒ Desktop ที่เคยสแกน (เช่นเครื่องที่ผู้ช่วยยิงแล้วกด Confirm) ค้างรุ่นเก่าข้ามวันได้จนกว่าจะปิดเบราว์เซอร์ — เครื่องแบบนี้ยัง Confirm เป็น `audit` แบบก่อน 29 ก.ย. (ตรวจด้วย `typeof PHARMACY_DIRECT_STOCK_ADJ`) · อย่าสรุปว่า "deploy แล้ว PDA ได้รุ่นใหม่เอง" — ยืนยันด้วยตา/สั่งรีสตาร์ท · แก้ได้ (ล้าง Set หลังจบ drain) แต่เป็น scan-related ต้องขออนุมัติ
- PDA ที่ออฟไลน์รับ branch lock ไม่ได้ทันที รายการใหม่จะ sync ภายหลังและรอ Confirm รอบถัดไป
- Pharmacy Desktop ต้องออนไลน์ระหว่าง Confirm และระหว่างยืนยัน Audit Verify
- WH สแกนได้ 24 ชั่วโมง ส่วนสาขายายังมี time gate ตามเวลาทำการ
- เภสัชที่สแกนรีเช็คบน PDA ออฟไลน์ ยอดจะขึ้น Cloud ตอนกลับมาออนไลน์ Desktop จึงจะยืนยันได้
- Audit Verify รองรับ pending quantity 0 แล้ว (ส.ค. 2026) = "ตรวจแล้วไม่มีของ" — ห้ามกลับไปกรอง `> 0` ไม่งั้น negSys ค้าง audit ถาวร
- Firestore rules ปัจจุบันเปิด read/write ให้ collections ที่แอปใช้ การ tighten rules เป็น security/migration แยกและต้องทดสอบทุก client
- สาขายาที่รับ R16 ผ่าน legacy session sync อาจมีเฉพาะ aggregate maps ไม่มี raw TRANDATE timeline; ห้ามสมมติว่าป้ายวันที่ R16 ตรงกันแล้ว derived result ทุกเครื่องจะตรงโดยอัตโนมัติ
- **Firestore quota — อยู่บนแผน Blaze แล้ว (7 ก.ย. 2026):** โควต้าฟรีรายวันยังได้เท่าเดิม (50K reads / 20K writes / 20K deletes) แต่ **เกินแล้วคิดเงินแทนที่จะ hard-stop** ⇒ ความเสี่ยง "Confirm ล้มกลางรอบนับเพราะโควต้าเต็ม" หายไปแล้ว ห้ามอ้างเหตุผลนี้เตือนผู้ใช้อีก
  - ประเมิน ~178K reads/วันช่วงรอบนับ = เกินฟรี ~128K ≈ **2–3 บาท/วันเฉพาะวันที่นับ** — ค่าใช้จ่ายไม่ใช่ข้อจำกัดในทางปฏิบัติ
  - ⚠️ guardrail ตัวเดียวที่เหลือคือ **budget alert** (ไม่มี hard-stop แล้ว) — จำเป็นกรณี loop bug/listener รั่วยิง read ไม่หยุด
  - backlog ลด read ยังควรทำเพราะแก้ **ความช้าตอน login** ไม่ใช่เพื่อประหยัดโควต้าแล้ว (ทุกข้อแตะ scan-related ต้องขอ approve กฎ 1 + field test): login สาขา v2 อ่าน items ซ้ำ 2 รอบ (`_loadScanItemsFromCloud` + listener initial ≈ 2×N/reload), ไม่ได้เปิด Firestore offline persistence, `WH_counts` เขียนทุกสแกนไม่ debounce (echo 1 read/สแกนไป Supervisor) · Pharmacy Confirm อ่าน server 3 รอบเป็น integrity check **ห้ามลดโดยพลการ**
  - `startNewCount` สาขา v2 กิน ~N deletes + ~N reads ต่อครั้ง — บน Blaze รันสองสาขาวันเดียวกันได้แล้ว (เดิมชนเพดาน deletes 20K ของ Spark)

---

## Running the App

```bash
npx serve .
# or
python -m http.server 8080
```

ไม่มี build step — เปิด `index.html` ใน browser ได้เลย

---

## Automated Tests (`tests/` — ก.ค. 2026)

Playwright + Firestore Emulator **แยกขาดจาก production 100%** รันได้แม้ขณะพนักงานกำลังสแกน (ไม่แตะข้อมูลจริง ไม่กินโควต้า) — รายละเอียดเต็มใน `tests/README.md`

```powershell
cd tests
npm install && npm run setup && npm run preflight   # ครั้งแรกเท่านั้น (ต้องมี Java 11+ สำหรับ emulator)
npm run test:logic   # ~7 วิ ไม่ใช้ emulator — inner loop ตอนแก้สูตร/merge
npm test             # ทั้งหมด (logic + e2e ผ่าน emulator)
```

**ห้ามพังหลักการเหล่านี้เวลาเพิ่ม/แก้เทส:**
- **ห้ามแก้ไฟล์ production เพื่อให้เทสผ่าน** — redirect ไป emulator ทำโดย inject script ตอนเสิร์ฟ (`tests/lib/static-server.mjs` + `routes.js`) `index.html` ต้องไม่มีโค้ดรู้จักเทสเลย
- inject ต้องทำที่ static server **ไม่ใช่ `route.fulfill`** — document ที่ fulfill ผ่าน Playwright เสีย address space แล้ว Chromium บล็อก fetch ข้ามพอร์ตไป emulator (ERR_FAILED)
- ทุกเทสปิดด้วย `closeApp()` ซึ่ง assert ว่าไม่มี request ออกนอก `127.0.0.1` — ถ้าลบ assert นี้ isolation หายทันที
- ห้าม sleep: ใช้ `waitForFunction(..., {polling:100})` + `waitForDoc()` · บังคับ flush ด้วย `_flushDirtySkus()` · offline ต้องปลด `_scanItemBackoffUntil` ก่อน flush
- fixture ต้องสังเคราะห์เท่านั้น (`tests/lib/fixtures.js`) — ห้ามนำ CSV ข้อมูลจริงเข้า repo (root `.gitignore` กัน `*.csv` ไว้แล้ว)

**เทสแทนการทดสอบมือไม่ได้ในเรื่องเหล่านี้:** PDA จริง (Intent scanner/keystroke/WebView/เสียง/APK), composite index บน production (emulator ไม่บังคับ), blob path v1 เต็มรูปแบบ (ไม่มีสาขาไหนเป็น v1 แล้ว แต่โค้ดยังอยู่เพื่อ rollback), WH Count/Recheck inbox flow

**ตรวจ production ที่ emulator ทำแทนไม่ได้ — 2 อย่างนี้เช็คได้แบบ read-only** (วางใน Console ของหน้าเว็บที่ login แล้ว · ไม่เขียนอะไรเลย)
- **composite index `countResetAt`+`status`** — login สาขาไหนก็ได้ (v2 ครบทั้ง 4 แล้ว) แต่สาขานั้นต้องมี items อยู่บ้าง · index ขาดจะได้ `failed-precondition` พร้อมลิงก์สร้าง
  ```js
  try { await getScanItemsRef().where('countResetAt','==',_countResetAt||'').where('status','==','scanning').limit(1).get({source:'server'});
        console.log('✅ composite index มีแล้ว'); }
  catch (e) { console.log(e.code==='failed-precondition' ? '❌ ยังไม่มี index:\n'+e.message : '⚠️ '+e.code); }
  ```
- **Rules ที่ Publish จริงตรงกับไฟล์ไหม** — ดูวิธีในหัวไฟล์ `firestore.rules`

✅ ทั้งสองข้อยืนยันแล้วบน production 7 ก.ย. 2026

---

## Skills (โหลดเมื่อ task เกี่ยวข้อง)

- **Scan Engine:** `.claude/skills/SKILL-scan-engine.md`
  → PDA detection, debounce, scan formats, drainQueue/patchScanRow, role filter, Firestore sync, cloud sync rules

- **Data Files:** `.claude/skills/SKILL-data-files.md`
  → R01/R05/R16.104/R16.103 columns, OTFI direction, DEL/P items, exports, persistence layers

**เอกสารบอท (อ่านก่อนแตะบอทนั้น — รายละเอียด/ข้อห้ามอยู่ที่นั่น ไม่ซ้ำในไฟล์นี้):**
- `auto-r01/README.md` · `auto-r01/TODO-safe-enable.md` · `auto-r01/bot-export/CLAUDE.md` — บอทสองตัวห้ามขับ ProMaxx พร้อมกัน (`FNWNS3125`), ตัดสินจากไฟล์ไม่ใช่ exit code, ห้ามพิมพ์ `Allstock.CSV` ลงหน้าต่าง Save, SQL Server ห้ามดูพอร์ต 1433, ห้ามใส่ `qty <= 0 → ข้าม`, ปิดฉุกเฉิน
  - 2 ข้อที่ยังไม่มีในเอกสารนั้น: `_run_exporter()` ต้องส่ง `stdin=DEVNULL` และส่ง stdout ลงไฟล์ ไม่ใช่ pipe (ไม่งั้นรอจนหมดเวลา 20 นาที) · ตรวจ flag ที่ไม่รู้จัก (exit 2) ใน `main()` เท่านั้น **ห้ามย้ายไปตอน import** — `tools/check-r01-parity.js` import ไฟล์นี้ด้วย `python -c`
- `auto-r05/README.md` — ด่านหัวคอลัมน์ห้ามข้าม, `global_r05` เขียนแค่ 4 field (แทนที่ทั้งชุด ไม่ merge), กับดักเวลา `06:30`, ปิดฉุกเฉิน
- `auto-adj/README.md` — generation (`active_gen`), `supabase-adj.sql` ต้องรันใน SQL Editor เอง (แก้ไฟล์ใน Git ไม่มีผลกับของจริง), service key ห้าม commit

## Bug ที่แก้แล้ว — ห้ามทำให้ย้อนกลับ (ยุคก่อน ส.ค. 2026 · ย้ายจาก AGENTS.md)

รายการใหม่กว่านี้บันทึกไว้ในหัวข้อของเรื่องนั้นๆ ด้านบนแล้ว

| Commit | สิ่งที่ห้ามทำให้ย้อนกลับ |
|---|---|
| `9c7e507` | แก้จำนวนด้วยมือแล้ว local edit protection ต้องชนะ cloud snapshot เก่าชั่วคราว |
| `bb06a0a` | ลบแถวโดยตั้งใจแล้ว session เก่าห้าม resurrect กลับมา |
| `1914cd4`, `546cccd` | ลำดับ Recheck ต้องคงบนลงล่างหลัง listener snapshot และหลัง rebuild/reload |
| `04ec420`, `48f5174`, `0ee325d`, `12a4900` | ยอด Recheck 0 ต้อง valid · `null` ≠ รีเช็คแล้ว · ใช้ `recheckQty/recheckBy/recheckAt` |
| `c1e2255`, `1556267` | `WH_rechecks`/`WH_counts` inbox + backfill + ปุ่มรายพนักงาน realtime ต้องยังทำงาน (ระหว่าง compatibility) |
| `d11f21a` | Recheck confirmation ต้องชนะ audit เก่า (ปุ่มไม่เด้งวน) |
| `63946a3` | Count Confirm ต้องอ่าน server ล่าสุด และเขียน marker + ลบ inbox แบบ atomic |
| `177271b` | Cloud master/versioned chunks เป็น source of truth ของ WH · localStorage เป็น cache |
| (ส.ค. 2026) | **แสดงผล/export เวลานับต้องใช้ `firstScanAt \|\| timestamp`** — `sd.timestamp` ถูกทับตอน verify · จุดคำนวณห้ามเปลี่ยน |

## เมื่องานเสร็จ
หลังทำ feature หรือ fix bug เสร็จ ให้ propose การอัพเดท CLAUDE.md (ไฟล์นี้)
หรือ SKILL file ที่เกี่ยวข้อง โดยเพิ่มเฉพาะ context ที่ถ้าไม่มีแล้วจะทำผิดพลาด — invariant, ข้อห้าม, deployment rule และ bug regression สำคัญให้อยู่ในไฟล์นี้

ก่อนส่งงานอย่างน้อยต้องตรวจ inline JavaScript syntax (ถ้าแก้ `index.html`), `git diff --check`, regression ของ branch/role ที่แชร์ฟังก์ชัน และ `git status --short` ว่าไม่มีไฟล์ unrelated ถูกแก้หรือ stage
- **งานที่แตะ scan/sync ต้องรัน `cd tests && npm test` ให้ผ่านครบก่อนส่ง** และยังต้องมี manual scenario ตาม flow จริง
- งาน sync/confirm ต้องทดสอบ stale snapshot, offline/transaction failure, สองเครื่องพร้อมกัน และ `countResetAt` เปลี่ยนกลางงาน
- งาน ordering ต้องทดสอบหลัง listener snapshot และหลัง rebuild/reload ไม่ใช่เฉพาะทันทีหลังสแกน
- งาน native Android ต้อง build APK และทดสอบ Intent barcode, foreground/background, screen timeout และเสียง

---

## คู่มือผู้ใช้

| ไฟล์ | กลุ่มเป้าหมาย |
|---|---|
| `คู่มือการใช้งาน.html` | ทุก role |
| `คู่มือ-สาขา.html` | assistant + pharmacist (SRC/KKL/SSS) |
| `คู่มือ-คลัง.html` | warehouse + supervisor (WH) |

ไฟล์คู่มือเป็น standalone HTML — แก้ได้อิสระ ไม่กระทบ `index.html` ไม่ต้อง bump APK
