// ↺ แล้วใบ 📦 ต้องไม่ขึ้นเลขที่เชื่อไม่ได้ (6 ต.ค. 2026 · ผู้ใช้เลือก — เคส 200402) · สวิตช์ ADJUST_DOC_SKIP_REOPENED
//
// เส้นทางจริงบน emulator (ไม่ใช่ marker จำลอง): Stock Adj ที่เภสัชยืนยันแล้ว → กด ↺ (marker เขียนขึ้น Firestore)
//   → login รอบถัดไปรัน _backfillPharmacyAuditMarkersFromLocal เขียน marker ซ้ำจาก sd ในเครื่อง → ใบ 📦
// ร่องรอยที่เห็นบน production (marker ของ 200402): confirmedBy ว่างทั้งที่ ↺ เขียนชื่อผู้กด · effectiveQty = ยอดนับ — เทสนี้ยืนยันว่าเส้นทางนี้ทำให้เกิดจริง
// แล้วตรึงว่าใบไม่ขึ้นเลขนั้น และยืนยันรีเช็คเสร็จแล้วค่อยขึ้นใบตามกติกาเดิม
const { test, expect, closeApp, requireEmulator, armDialog } = require('../../lib/hooks');
const { bootFreshCount, armR16, PROJECT_ID } = require('../../lib/scenario');
const { waitForDoc, getDoc } = require('../../lib/emulator');
const { seedItems } = require('../../lib/seed');

const MARKERS = 'stock_sessions/SRC_pharmacy_audit_markers';

async function quiet(page) {
  await page.waitForFunction(() => _dirtySkus.size === 0 && _scanItemInFlight.size === 0 && !_scanItemFlushing,
    null, { timeout: 20000, polling: 100 });
}
const sheet = (page) => page.evaluate(() => ({
  ords: _buildAdjustDocRows('ords').map((r) => [r.sku, r.qty]), irps: _buildAdjustDocRows('irps').map((r) => [r.sku, r.qty]),
  reopened: _adjustDocAudit().reopened.map((x) => x.sku),
}));

test.describe('↺ แล้วใบ 📦', () => {
  test.beforeEach(() => requireEmulator());
  test.setTimeout(120_000);

  test('↺ + backfill ตอน login เขียน marker ทับ → ใบไม่ขึ้นเลขนั้น · ยืนยันรีเช็คแล้วค่อยขึ้นใบ · ปิดสวิตช์ = เลขข้ามเวลาโผล่ (เหตุที่ต้องมีสวิตช์นี้)', async ({ browser }) => {
    const desk = await bootFreshCount(browser, { role: 'pharmacist', user: 'Pharm', mode: 'desktop' });
    await armR16(desk.page);
    // Stock Adj ที่เภสัชยืนยันแล้ว (ระบบ 5 · นับ 3 · รีเช็ค 4) — เหมือน bootWithVerifiedAdj ของ pharmacy-reopen-recheck.spec.js
    await seedItems(PROJECT_ID, 'SRC', desk.epoch, [
      { sku: 'S-F05', status: 'stock_adjustment', auditStatus: 'stock_adjustment', initialStatus: 'audit', auditor: 'Pharm', countedQty: 3,
        recheckQty: 4, recheckBy: 'Pharm', recheckAt: '2026-09-29T03:00:00.000Z', recheckSystemQty: 5, scannedBy: 'PDA-A' },
    ]);
    await desk.page.waitForFunction(() => state.scanData.get('S-F05')?.status === 'stock_adjustment', null, { timeout: 15000, polling: 100 });

    // กด ↺ → marker (reopenedAt) ขึ้น Firestore · ใบยังไม่มีแถว (รอรีเช็คหลัง ↺)
    armDialog(desk.page, 'y');
    await desk.page.evaluate(() => reopenPharmacyAudit('S-F05'));
    await waitForDoc(PROJECT_ID, 'stock_sessions/SRC/items/S-F05', (d) => d && d.status === 'audit', { timeout: 20000 });
    const afterReopen = (await getDoc(PROJECT_ID, MARKERS)).items['S-F05'];
    expect(afterReopen).toMatchObject({ status: 'audit', reopenedAt: expect.any(String), confirmedBy: 'Pharm', directAdj: false });
    expect(await sheet(desk.page)).toEqual({ ords: [], irps: [], reopened: ['S-F05'] });
    await quiet(desk.page);

    // login รอบถัดไป: backfill เขียน marker ซ้ำจาก sd ในเครื่อง — ได้ร่องรอยเดียวกับ marker ของ 200402
    await desk.page.evaluate(() => _backfillPharmacyAuditMarkersFromLocal());
    const overwritten = (await getDoc(PROJECT_ID, MARKERS)).items['S-F05'];
    expect(overwritten.reopenedAt).toBe(afterReopen.reopenedAt);       // merge เก็บ reopenedAt ไว้ — ใบจึงรู้ว่าเป็น ↺
    expect(overwritten.confirmedBy).toBe('');                           // ↺ เขียน 'Pharm' แต่ backfill เขียนทับเป็นค่าว่าง (ร่องรอย 200402)
    expect(overwritten.effectiveQty).toBe(3);                           // effectiveQty ถอยไปใช้ยอดนับ (↺ ลบ sd.effectiveQty ทิ้ง)
    expect(await sheet(desk.page)).toEqual({ ords: [], irps: [], reopened: ['S-F05'] });   // ใบยังไม่ขึ้นเลขที่ถูกเขียนทับ

    // ปิดสวิตช์ = พฤติกรรมก่อนแก้: ใบขึ้นเลขข้ามเวลา (ยอดนับ 3 − ระบบ 5 = ขาด 2) ทั้งที่ยังไม่มีใครรีเช็ค
    expect(await desk.page.evaluate(() => { ADJUST_DOC_SKIP_REOPENED = false; const r = _buildAdjustDocRows('ords').map((x) => [x.sku, x.qty]); ADJUST_DOC_SKIP_REOPENED = true; return r; }))
      .toEqual([['S-F05', 2]]);

    // เภสัชรีเช็ค 4 แล้วยืนยัน → ตัดสินใหม่ด้วยกติกาเดิมของ Stock Adj (4 ≠ 5 → ขาด 1) · ใบขึ้นแถวและไม่ถูกรายงานว่า ↺ อีก
    await desk.page.evaluate(() => { updatePharmacyRecheckQty('S-F05', 4); return _flushDirtySkus(); });
    await waitForDoc(PROJECT_ID, 'stock_sessions/SRC/items/S-F05', (d) => d && d.recheckQty === 4 && d.status === 'audit');
    await quiet(desk.page);
    expect(await sheet(desk.page)).toEqual({ ords: [], irps: [], reopened: ['S-F05'] });   // ร่างรีเช็คที่ยังไม่ยืนยันไม่เปลี่ยนใบ
    await desk.page.evaluate(() => _confirmPharmacyAuditBatched());
    await desk.page.waitForFunction(() => _branchConfirming === false, null, { timeout: 30000, polling: 100 });
    await waitForDoc(PROJECT_ID, 'stock_sessions/SRC/items/S-F05', (d) => d && d.status === 'stock_adjustment' && d.recheckQty === 4 && d.auditor === 'Pharm');
    expect(await sheet(desk.page)).toEqual({ ords: [['S-F05', 1]], irps: [], reopened: [] });

    await closeApp(desk);
  });
});
