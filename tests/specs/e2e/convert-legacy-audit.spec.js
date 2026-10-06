// tools/convert-legacy-pharmacy-audits.js — แปลง Audit ค้างของสาขายาเป็น Stock Adj ตรง (ต.ค. 2026 · ผู้ใช้สั่ง)
// สคริปต์ Console ที่เขียนข้อมูลจริงบน production จึงต้องพิสูจน์ก่อนใช้ว่า:
//   ① dry-run ไม่เขียนอะไรเลย · ยืนยันผิด = ยกเลิก · แปลงเฉพาะรายการที่เข้าเกณฑ์ (↺ / มียอดรีเช็ค / ไม่มีตัวเลข / diff 0 = ข้าม)
//   ② ผลแปลงเป็น Stock Adj ตรงทั้ง marker + item ทุกเครื่องเห็นเหมือนกัน · ใบ 📦 ใช้ตัวเลขตอน Confirm เดิม · lock ถูกปลด
//   ③ เครื่องที่ข้อมูลค้างดันกลับเป็น audit ไม่ได้ · รันซ้ำ = 0 · ↺ ยังใช้ได้ · ย้อนการแปลงคืนเป็นรอรีเช็คได้
const fs = require('fs');
const path = require('path');
const { test, expect, closeApp, requireEmulator, armDialog } = require('../../lib/hooks');
const { bootFreshCount, bootJoinCount, PROJECT_ID } = require('../../lib/scenario');
const { seedItems } = require('../../lib/seed');
const { getDoc, setDoc, waitForDoc } = require('../../lib/emulator');

const TOOL = fs.readFileSync(path.join(__dirname, '../../../tools/convert-legacy-pharmacy-audits.js'), 'utf8');
const T0 = '2026-09-20T03:00:00.000Z';      // Confirm ก่อนตัดขั้น Audit
const T_LATE = '2026-10-02T03:00:00.000Z';  // Confirm หลัง 29 ก.ย. 19:40 (เครื่องโค้ดเก่า / R16 อัปซ้ำ) — ต้องถูกรายงาน
const ITEM = (sku) => `stock_sessions/SRC/items/${sku}`;
const MARKERS = 'stock_sessions/SRC_pharmacy_audit_markers';

const auditItem = (sku, countedQty, at = T0, extra = {}) => ({ sku, status: 'audit', auditStatus: 'pending', initialStatus: 'audit', auditor: '', countedQty,
  firstScanAt: '2026-09-20 09:00:00', timestamp: '2026-09-20 09:00:00', pharmacyAuditMarkerAt: at, pharmacyAuditCountConfirmedAt: at, ...extra });
const auditMarker = (epoch, countedQty, eff, sys, at = T0, extra = {}) => ({ countResetAt: epoch, status: 'audit', auditStatus: 'pending', initialStatus: 'audit',
  auditor: '', countedQty, scannedBy: 'PDA-A', countTimestamp: '2026-09-20 09:00:00', timestamp: '2026-09-20 09:00:00', firstScanAt: '2026-09-20 09:00:00',
  soldQty: Math.max(0, eff - countedQty), inboundQty: 0, r16103Qty: 0, effectiveQty: eff, systemQty: sys, countConfirmedAt: at, confirmedAt: at, confirmedBy: 'Desk-Old', ...extra });

async function quiet(page) {
  await page.waitForFunction(() => _dirtySkus.size === 0 && _scanItemInFlight.size === 0 && !_scanItemFlushing, null, { timeout: 20000, polling: 100 });
}
const SKUS = ['S-NORM', 'S-MULTI', 'S-1000', 'S-ZERO', 'S-NEG', 'S-CATA', 'S-999', 'S-PRICEY'];
async function cloudState() {
  const m = await getDoc(PROJECT_ID, MARKERS);
  const items = {};
  for (const s of SKUS) items[s] = await getDoc(PROJECT_ID, ITEM(s));
  return { markers: JSON.parse(JSON.stringify(m.items)), items: JSON.parse(JSON.stringify(items)) };
}

test.describe('tools/convert-legacy-pharmacy-audits.js', () => {
  test.beforeEach(() => requireEmulator());
  test.setTimeout(180_000);

  test('dry-run ไม่เขียน · แปลงเฉพาะที่เข้าเกณฑ์ · ทุกเครื่องเห็น Stock Adj ตรง · กันดันกลับ · รันซ้ำ = 0 · ↺ · ย้อนการแปลง', async ({ browser }) => {
    const desk = await bootFreshCount(browser, { role: 'pharmacist', user: 'Pharm', mode: 'desktop' });
    const E = desk.epoch;
    await seedItems(PROJECT_ID, 'SRC', E, [
      auditItem('S-NORM', 7),                                   // แปลงได้ — ORDS ขาด 2 (นับ 7 + ขาย 1 = 8 / ระบบ 10)
      auditItem('S-MULTI', 62, T_LATE),                         // แปลงได้ — IRPS เกิน 2 · Confirm หลังตัด Audit → ต้องถูกรายงาน
      auditItem('S-ZERO', 1, T0),                               // ↺ มา (reopenedAt) → ข้าม
      auditItem('S-NEG', 0, T0, { recheckQty: 0, recheckBy: 'Ph', recheckAt: '2026-10-01T03:00:00.000Z', recheckSystemQty: -3 }), // มียอดรีเช็ค → ข้าม
      auditItem('S-CATA', 2),                                   // marker ไม่มีตัวเลข → ข้าม
      auditItem('S-999', 3),                                    // diff 0 → ข้าม
      { sku: 'S-PRICEY', status: 'stock_adjustment', auditStatus: 'stock_adjustment', initialStatus: 'stock_adjustment', directAdj: true,
        effectiveQty: 3, systemQty: 5, countedQty: 3, firstScanAt: '2026-10-01 10:00:00', timestamp: '2026-10-01 10:00:00' }, // Stock Adj ตรงปกติ — ไม่เกี่ยว
    ]);
    const noNums = auditMarker(E, 2, 0, 0); delete noNums.effectiveQty; delete noNums.systemQty;
    await setDoc(PROJECT_ID, MARKERS, { branch: 'SRC', countResetAt: E, items: {
      'S-NORM': auditMarker(E, 7, 8, 10),
      'S-MULTI': auditMarker(E, 62, 62, 60, T_LATE),
      'S-1000': auditMarker(E, 1, 1, 3),                         // seed แค่ marker — item ถูกสร้างโดย sync ของเครื่อง (สถานะจริงบน production) → แปลงได้
      'S-ZERO': auditMarker(E, 1, 1, 0, T0, { reopenedAt: '2026-10-01T03:00:00.000Z', confirmedAt: '2026-10-01T03:00:00.000Z', countConfirmedAt: '2026-10-01T03:00:00.000Z' }),
      'S-NEG': auditMarker(E, 0, 0, -3),
      'S-CATA': noNums,
      'S-999': auditMarker(E, 3, 3, 3),
    } }, { merge: false });

    // เครื่องที่สอง (เภสัช Desktop อีกเครื่อง) — ต้องเห็นผลเดียวกันผ่าน listener
    const desk2 = await bootJoinCount(browser, { role: 'pharmacist', user: 'Pharm2', mode: 'desktop', expectEpoch: E });
    for (const p of [desk.page, desk2.page]) {
      await p.waitForFunction(() => ['S-NORM', 'S-MULTI', 'S-1000', 'S-999'].every((s) => state.scanData.get(s)?.status === 'audit'), null, { timeout: 20000, polling: 100 });
      // ให้สถานะนิ่งเหมือน production ก่อนเริ่ม: marker ที่เพิ่ง seed ทำให้ทุกเครื่อง saveSession → sync ตามเวลา → reconcile สร้าง item
      // ของ SKU ที่มีแต่ marker (S-1000) — ถ้าปล่อยให้เกิดกลางเทส เครื่องมือจะยกเลิกทั้งชุดอย่างถูกต้อง (rev เปลี่ยนระหว่างทำ)
      // แล้วหยุด safety net 60 วิ ไว้ ไม่งั้นการเทียบ "dry-run ไม่เขียน" สุ่มล้ม
      await p.evaluate(async () => { clearInterval(_scanItemReconcileTimer); clearTimeout(_firestoreSyncTimer); _firestoreSyncTimer = null; await syncToFirestore(); });
      await quiet(p);
    }
    await waitForDoc(PROJECT_ID, ITEM('S-1000'), (d) => d && d.status === 'audit');
    for (const p of [desk.page, desk2.page]) await p.evaluate(() => { clearTimeout(_firestoreSyncTimer); _firestoreSyncTimer = null; });

    await desk.page.addScriptTag({ content: TOOL });
    await desk.page.evaluate(() => {
      window.__downloads = []; window.__promptReply = null;
      window.prompt = () => window.__promptReply;
      const click = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function () { if (this.download) { window.__downloads.push(this.download); return; } return click.call(this); };
    });

    // ① dry-run — รายงานถูก ไม่เขียนอะไร
    const before = await cloudState();
    const dry = await desk.page.evaluate(() => convertLegacyAudits());
    expect(dry.skus).toEqual(['S-1000', 'S-MULTI', 'S-NORM']);
    expect(dry.ords).toBe(2);
    expect(dry.irps).toBe(1);
    expect(dry.afterSwitch).toEqual(['S-MULTI']);
    expect(dry.skipped).toEqual({
      'เภสัชกด ↺ มา — ให้รีเช็คต่อ': ['S-ZERO'],
      'มียอดรีเช็คแล้ว — ให้เภสัชกดยืนยันรีเช็ค': ['S-NEG'],
      'ไม่มีตัวเลขตอน Confirm': ['S-CATA'],
      'ตัวเลขตรงกัน (diff 0) — อาจเป็นฐาน clamp เก่า': ['S-999'],
    });
    expect(await cloudState()).toEqual(before);

    // ยืนยันผิด = ยกเลิก
    await desk.page.evaluate(() => { window.__promptReply = 'แปลง SRC 99'; });
    await desk.page.evaluate(() => convertLegacyAudits({ dryRun: false }));
    expect(await cloudState()).toEqual(before);
    expect(await desk.page.evaluate(() => window.__downloads.length)).toBe(0);

    // ② แปลงจริง
    await desk.page.evaluate(() => { window.__promptReply = 'แปลง SRC 3'; });
    const real = await desk.page.evaluate(() => convertLegacyAudits({ dryRun: false }));
    expect(real).toMatchObject({ converted: 3, synced: true });
    expect(await desk.page.evaluate(() => window.__downloads.length)).toBe(1);
    expect(await getDoc(PROJECT_ID, 'stock_sessions/SRC_confirm_lock')).toBeNull();

    const after = await cloudState();
    for (const [sku, eff, sys, at] of [['S-NORM', 8, 10, T0], ['S-MULTI', 62, 60, T_LATE], ['S-1000', 1, 3, T0]]) {
      expect(after.markers[sku], sku).toMatchObject({ status: 'stock_adjustment', initialStatus: 'stock_adjustment', directAdj: true, auditor: '',
        effectiveQty: eff, systemQty: sys, convertedBy: 'Pharm', origCountConfirmedAt: at });
      expect(after.items[sku], sku).toMatchObject({ status: 'stock_adjustment', initialStatus: 'stock_adjustment', directAdj: true, effectiveQty: eff, systemQty: sys });
    }
    for (const sku of ['S-ZERO', 'S-NEG', 'S-CATA', 'S-999', 'S-PRICEY']) {
      expect(after.markers[sku] ?? null, sku).toEqual(before.markers[sku] ?? null);
      expect(after.items[sku], sku).toEqual(before.items[sku]);
    }

    // ทุกเครื่องเห็น Stock Adj ตรง · ใบ 📦 ใช้ตัวเลขตอน Confirm เดิม (ไม่ใช่ยอดสด) · ที่ข้ามยังรอรีเช็ค
    const view = (p) => p.evaluate(() => ({
      st: ['S-NORM', 'S-MULTI', 'S-1000'].map((s) => { const d = state.scanData.get(s); return [s, d.status, d.directAdj === true]; }),
      ords: _buildAdjustDocRows('ords').map((r) => [r.sku, r.qty]).sort(), irps: _buildAdjustDocRows('irps').map((r) => [r.sku, r.qty]).sort(),
      waiting: _legacyAuditCount(),
    }));
    await desk2.page.waitForFunction(() => ['S-NORM', 'S-MULTI', 'S-1000'].every((s) => state.scanData.get(s)?.status === 'stock_adjustment' && state.scanData.get(s)?.directAdj === true),
      null, { timeout: 20000, polling: 100 });
    for (const p of [desk.page, desk2.page]) {
      const v = await view(p);
      expect(v.st).toEqual([['S-NORM', 'stock_adjustment', true], ['S-MULTI', 'stock_adjustment', true], ['S-1000', 'stock_adjustment', true]]);
      expect(v.ords).toEqual([['S-1000', 2], ['S-NORM', 2], ['S-PRICEY', 2]]);
      expect(v.irps).toEqual([['S-MULTI', 2]]);
      expect(v.waiting).toBe(4); // S-ZERO · S-NEG · S-CATA · S-999
    }

    // ③ เครื่องที่ยังถือ audit (backfill/R16 อัปซ้ำ) ดันกลับไม่ได้ — แม้เวลาใหม่กว่า
    await quiet(desk2.page);
    await desk2.page.evaluate((E) => _writePharmacyAuditMarkers([{ sku: 'S-NORM', status: 'audit', auditStatus: 'pending', initialStatus: 'audit', auditor: '',
      countedQty: 7, effectiveQty: 7, systemQty: 10, countConfirmedAt: new Date().toISOString(), confirmedAt: new Date().toISOString() }]), E);
    expect((await getDoc(PROJECT_ID, MARKERS)).items['S-NORM']).toMatchObject({ status: 'stock_adjustment', directAdj: true });

    // รันซ้ำ = ไม่มีอะไรให้แปลง
    await quiet(desk.page);
    expect((await desk.page.evaluate(() => convertLegacyAudits())).convert).toBe(0);

    // ↺ รายการที่แปลงแล้วยังใช้ได้ → รอรีเช็ค · ธงหายทั้ง marker และทุกเครื่อง
    armDialog(desk.page, 'y');
    await desk.page.evaluate(() => reopenPharmacyAudit('S-MULTI'));
    expect((await getDoc(PROJECT_ID, MARKERS)).items['S-MULTI']).toMatchObject({ status: 'audit', directAdj: false, reopenedAt: expect.any(String) });
    await desk2.page.waitForFunction(() => { const d = state.scanData.get('S-MULTI'); return d?.status === 'audit' && d.directAdj === undefined; }, null, { timeout: 20000, polling: 100 });

    // ย้อนการแปลง — ↺ ไปแล้ว (S-MULTI) ไม่อยู่ในรายการ
    await quiet(desk.page);
    const undoDry = await desk.page.evaluate(() => undoConvertLegacyAudits());
    expect(undoDry.skus).toEqual(['S-1000', 'S-NORM']);
    await desk.page.evaluate(() => { window.__promptReply = 'ย้อน SRC 2'; });
    const undo = await desk.page.evaluate(() => undoConvertLegacyAudits({ dryRun: false }));
    expect(undo).toMatchObject({ undone: 2, synced: true });
    expect(await getDoc(PROJECT_ID, 'stock_sessions/SRC_confirm_lock')).toBeNull();
    const back = await cloudState();
    for (const sku of ['S-NORM', 'S-1000']) {
      expect(back.markers[sku], sku).toMatchObject({ status: 'audit', initialStatus: 'audit', directAdj: false, convertUndoneAt: expect.any(String), effectiveQty: sku === 'S-NORM' ? 8 : 1 });
      expect(back.items[sku], sku).toMatchObject({ status: 'audit', initialStatus: 'audit' });
      expect(back.items[sku].directAdj, sku).toBeUndefined();
    }
    await desk2.page.waitForFunction(() => ['S-NORM', 'S-1000'].every((s) => state.scanData.get(s)?.status === 'audit' && state.scanData.get(s)?.directAdj === undefined),
      null, { timeout: 20000, polling: 100 });
    expect((await view(desk.page)).ords).toEqual([['S-PRICEY', 2]]); // ออกจากใบแล้ว

    await closeApp(desk2);
    await closeApp(desk);
  });
});
