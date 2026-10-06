// ใบ 📦: "รอรีเช็ค" ขึ้นใบทันที + แก้จำนวนในใบ — เส้นทางจริงบน emulator สองเครื่อง (ต.ค. 2026)
//   เภสัช Desktop A แก้ "จำนวน" → item บน cloud มี adjQty/adjBase/adjBy/adjAt (ฟิลด์แบน · สถานะ/เลขตอน Confirm ไม่เปลี่ยน)
//   → เภสัช Desktop B เห็นค่าเดียวกันในใบ · marker apply ซ้ำไม่ล้างค่าที่แก้ · คืนค่าที่ B → A เห็นว่าไม่มีแล้ว
//   → รีเช็คยืนยันแล้ว (ผลใหม่) ค่าที่แก้หลุดเอง ไม่ค้างเป็นเลขที่ไม่มีใครตรวจ
// logic ล้วน (ตัวเลข · สิทธิ์ · สวิตช์ · export) อยู่ที่ specs/logic/adjust-doc-audit-edit.spec.js
const { test, expect, closeApp, requireEmulator } = require('../../lib/hooks');
const { bootFreshCount, bootJoinCount, armR16, PROJECT_ID } = require('../../lib/scenario');
const { waitForDoc, getDoc } = require('../../lib/emulator');
const { seedItems } = require('../../lib/seed');

// เครื่องนี้ไม่มีงานเขียน item ค้างแล้ว — ก่อนอ่าน/ยืนยันบน cloud
async function quiet(page) {
  await page.waitForFunction(() => _dirtySkus.size === 0 && _scanItemInFlight.size === 0 && !_scanItemFlushing,
    null, { timeout: 20000, polling: 100 });
}
const rows = (page, dir) => page.evaluate((dir) => _buildAdjustDocRows(dir).map((r) => [r.sku, r.qty, r.edited, r.pending]), dir);

test.describe('ใบ 📦 — รอรีเช็คขึ้นใบ + แก้จำนวน ซิงก์ข้ามเครื่อง', () => {
  test.beforeEach(() => requireEmulator());
  test.setTimeout(120_000);

  test('A แก้จำนวน → cloud → B เห็น · marker apply ซ้ำไม่ล้าง · B คืนค่า → A เห็น · รีเช็คยืนยันแล้วค่าที่แก้หลุดเอง', async ({ browser }) => {
    const A = await bootFreshCount(browser, { role: 'pharmacist', user: 'PharmA', mode: 'desktop' });
    await armR16(A.page);
    // รอรีเช็คที่ marker แช่เลขไว้ (เหมือน Confirm รุ่นก่อน 29 ก.ย.): S-F05 ระบบ 5 นับได้ 3 → ขาด 2 · S-NORM ระบบ 10 effective 12 → เกิน 2
    await seedItems(PROJECT_ID, 'SRC', A.epoch, [
      { sku: 'S-F05', status: 'audit', auditStatus: 'pending', initialStatus: 'audit', auditor: '', countedQty: 3, effectiveQty: 3, systemQty: 5, scannedBy: 'PDA-A' },
      { sku: 'S-NORM', status: 'audit', auditStatus: 'pending', initialStatus: 'audit', auditor: '', countedQty: 12, effectiveQty: 12, systemQty: 10, scannedBy: 'PDA-A' },
    ]);
    const B = await bootJoinCount(browser, { role: 'pharmacist', user: 'PharmB', mode: 'desktop', expectEpoch: A.epoch });
    for (const m of [A, B]) {
      await m.page.waitForFunction(() => state.scanData.get('S-F05')?.status === 'audit' && state.scanData.get('S-NORM')?.status === 'audit', null, { timeout: 20000, polling: 100 });
    }

    // ทั้งสองเครื่องเห็นรอรีเช็คในใบ ด้วยเลขตอน Confirm
    for (const m of [A, B]) {
      expect(await rows(m.page, 'ords')).toEqual([['S-F05', 2, false, true]]);
      expect(await rows(m.page, 'irps')).toEqual([['S-NORM', 2, false, true]]);
      expect(await m.page.evaluate(() => [_countAdjustDocItems(), _canEditAdjDocQty()])).toEqual([2, true]);
    }

    // A แก้จำนวน → flush → item บน cloud มีฟิลด์แบนครบ · สถานะและเลขตอน Confirm ไม่ถูกแตะ
    await quiet(A.page);
    await A.page.evaluate(() => { setAdjDocQty('S-F05', '1'); return _flushDirtySkus(); });
    const doc = await waitForDoc(PROJECT_ID, 'stock_sessions/SRC/items/S-F05', (d) => d && d.adjQty === 1);
    expect(doc).toMatchObject({ adjQty: 1, adjBase: -2, adjBy: 'PharmA', status: 'audit', effectiveQty: 3, systemQty: 5 });
    expect(typeof doc.adjAt).toBe('string');
    expect(doc.auditor || '').toBe('');

    // B เห็นค่าที่แก้ผ่าน listener (ไม่ต้องรีโหลด)
    await B.page.waitForFunction(() => state.scanData.get('S-F05')?.adjQty === 1, null, { timeout: 20000, polling: 100 });
    expect(await rows(B.page, 'ords')).toEqual([['S-F05', 1, true, true]]);
    expect(await rows(B.page, 'irps')).toEqual([['S-NORM', 2, false, true]]);       // อีกรายการไม่ถูกแตะ

    // marker apply ซ้ำ (snapshot ของ session/marker ที่มาทุกครั้ง) ต้องไม่ล้างค่าที่แก้ — ทั้งสองเครื่อง
    for (const m of [A, B]) {
      const kept = await m.page.evaluate(() => { _applyPharmacyAuditMarkersToState(); _applyPharmacyAuditMarkersToState(); const s = state.scanData.get('S-F05'); return [s.adjQty, s.adjBase, s.adjBy]; });
      expect(kept).toEqual([1, -2, 'PharmA']);
    }

    // B คืนค่า → cloud ไม่มีฟิลด์แล้ว → A เห็นเป็นค่าคำนวณ
    await quiet(B.page);
    await B.page.evaluate(() => { resetAdjDocQty('S-F05'); return _flushDirtySkus(); });
    const cleared = await waitForDoc(PROJECT_ID, 'stock_sessions/SRC/items/S-F05', (d) => d && d.adjQty === undefined && d.status === 'audit');
    expect([cleared.adjBase, cleared.adjBy, cleared.adjAt]).toEqual([undefined, undefined, undefined]);
    await A.page.waitForFunction(() => state.scanData.get('S-F05')?.adjQty === undefined, null, { timeout: 20000, polling: 100 });
    expect(await rows(A.page, 'ords')).toEqual([['S-F05', 2, false, true]]);

    // A แก้ใหม่ แล้วเภสัชรีเช็คยืนยัน (นับได้ 4 · ระบบ 5 → ไม่ตรง ขาด 1) → ผลใหม่ใช้ยอดรีเช็ค ค่าที่แก้ (ผูกผลต่างเดิม −2) หลุดเอง
    await quiet(A.page);
    await A.page.evaluate(() => { setAdjDocQty('S-F05', '1'); return _flushDirtySkus(); });
    await waitForDoc(PROJECT_ID, 'stock_sessions/SRC/items/S-F05', (d) => d && d.adjQty === 1);
    await quiet(A.page);
    const verdict = await A.page.evaluate(() => {
      const sd = state.scanData.get('S-F05');
      sd.recheckQty = 4; sd.recheckBy = 'PharmA'; sd.recheckAt = new Date().toISOString(); _freezeRecheckBaseline('S-F05', sd);
      return confirmAuditVerifyItem('S-F05', true, true);
    });
    expect(verdict).toBe('stock_adjustment');
    expect(await rows(A.page, 'ords')).toEqual([['S-F05', 1, false, false]]);       // 4 − 5 = ขาด 1 จากยอดรีเช็ค · ไม่ใช่ค่าที่แก้เดิม (1 เท่ากันโดยบังเอิญจึงเช็ค edited=false)
    expect(await A.page.evaluate(() => _adjQtyOverride(state.scanData.get('S-F05'), -1))).toBeNull();

    // ไม่แตะผลตัดสิน/สถานะของรายการอื่น
    expect((await getDoc(PROJECT_ID, 'stock_sessions/SRC/items/S-NORM')).status).toBe('audit');

    await closeApp(B);
    await closeApp(A);
  });
});
