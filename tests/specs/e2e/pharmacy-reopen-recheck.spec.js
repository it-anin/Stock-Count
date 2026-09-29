// ↺ (reopenPharmacyAudit) → เภสัชกรอกยอดรีเช็ค → กดยืนยัน Audit — ยอดที่กรอกต้องไม่หายเอง (ก.ย. 2026)
//
// เดิมขั้นนี้ไม่มีเทส e2e เลย และพังจริง: ยอดรีเช็คถูกลบภายในไม่กี่วินาทีหลังกรอก แล้วกดยืนยันได้ "ไม่มีรายการรอยืนยัน"
// (ต้นเหตุ + วิธีแก้ 2 ชั้นดู specs/logic/reopen-marker-draft.spec.js — ทดสอบซ้ำบน index.html ก่อนแก้ ล้มทุกรอบ)
// เทสนี้ใช้รายการ "ผ่านเภสัชแล้ว" (Stock Adj ที่ Audit ยืนยัน) ซึ่งเป็นเคสหลักของ ↺ — ไม่เกี่ยวกับ directAdj
// (เคส directAdj ของ ↺ อยู่ที่ pharmacy-direct-adj.spec.js ข้อ B)
const { test, expect, closeApp, requireEmulator, armDialog } = require('../../lib/hooks');
const { bootFreshCount, bootJoinCount, armR16, PROJECT_ID } = require('../../lib/scenario');
const { waitForDoc, getDoc } = require('../../lib/emulator');
const { seedItems } = require('../../lib/seed');

// เครื่องนี้ไม่มีงานเขียน item ค้างแล้ว — ยืนยัน Audit จะ abort ทั้งชุดถ้ามี write แทรกระหว่างอ่านสองรอบ
async function quiet(page) {
  await page.waitForFunction(() => _dirtySkus.size === 0 && _scanItemInFlight.size === 0 && !_scanItemFlushing,
    null, { timeout: 20000, polling: 100 });
}

// Stock Adj ที่เภสัชยืนยันแล้วเมื่อวาน (ระบบ 5 · นับ 3 · รีเช็ค 4) → วันนี้เภสัชกด ↺ เพราะยอดที่ยืนยันไปไม่สะท้อนของจริง
async function bootWithVerifiedAdj(browser) {
  const desk = await bootFreshCount(browser, { role: 'pharmacist', user: 'Pharm', mode: 'desktop' });
  await armR16(desk.page);
  await seedItems(PROJECT_ID, 'SRC', desk.epoch, [
    { sku: 'S-F05', status: 'stock_adjustment', auditStatus: 'stock_adjustment', initialStatus: 'audit', auditor: 'Pharm', countedQty: 3,
      recheckQty: 4, recheckBy: 'Pharm', recheckAt: '2026-09-29T03:00:00.000Z', recheckSystemQty: 5, scannedBy: 'PDA-A' },
  ]);
  const pda = await bootJoinCount(browser, { role: 'assistant', user: 'PDA-A', mode: 'pda', expectEpoch: desk.epoch });
  await desk.page.waitForFunction(() => state.scanData.get('S-F05')?.status === 'stock_adjustment', null, { timeout: 15000, polling: 100 });
  return { desk, pda };
}

test.describe('↺ เปิดรีเช็คใหม่ → กรอกยอด → ยืนยัน', () => {
  test.beforeEach(() => requireEmulator());
  test.setTimeout(120_000);

  test('ยอดที่กรอกหลัง ↺ อยู่รอดจนยืนยัน · ยอดเก่าไม่เด้งกลับ · ผลตัดสินด้วยยอดใหม่', async ({ browser }) => {
    const { desk, pda } = await bootWithVerifiedAdj(browser);

    armDialog(desk.page, 'y');
    await desk.page.evaluate(() => reopenPharmacyAudit('S-F05'));

    // (ก) ↺ ตั้ง pharmacyAuditMarkerAt เองก่อน flush — ไม่รอ marker snapshot
    //     ไม่งั้น flush เขียน item ด้วยค่าเก่า แล้ว echo ของมันย้อน sd กลับ → marker ถูก apply ซ้ำ → ยอดที่เพิ่งกรอกหาย
    const at = await desk.page.evaluate(() => {
      const s = state.scanData.get('S-F05'), m = _pharmacyAuditMarkerData.items['S-F05'];
      return { sd: s.pharmacyAuditMarkerAt, cnt: s.pharmacyAuditCountConfirmedAt, marker: m.confirmedAt, reopenedAt: m.reopenedAt,
        oldRecheck: s.recheckQty, status: s.status };
    });
    expect(at.sd).toBe(at.marker);
    expect(at.cnt).toBe(at.marker);
    expect(at.reopenedAt).toBe(at.marker);
    expect(at.oldRecheck).toBeUndefined();                     // ยอดเดิม (4) ถูกล้างตามเจตนาของ ↺
    expect(at.status).toBe('audit');
    const reopened = await waitForDoc(PROJECT_ID, 'stock_sessions/SRC/items/S-F05', (d) => d && d.status === 'audit', { timeout: 20000 });
    expect(reopened.pharmacyAuditMarkerAt).toBe(at.marker);   // payload ของ flush มีค่าใหม่ ไม่ใช่ค่าที่ค้างมาจากตอนยืนยันเมื่อวาน
    expect(reopened.recheckQty).toBeUndefined();

    // marker (reopen) ถูก apply ซ้ำได้ทุกครั้งที่ session/item snapshot มา — ระหว่างนี้ต้องไม่ดึงยอดเก่า (4) กลับมา
    const afterReapply = await desk.page.evaluate(() => { _applyPharmacyAuditMarkersToState(); _applyPharmacyAuditMarkersToState(); return state.scanData.get('S-F05').recheckQty; });
    expect(afterReapply).toBeUndefined();

    // เภสัชนับใหม่ได้ 4 (ระบบ 5) → กรอกยอด → marker ถูก apply ซ้ำอีก → ยอดต้องไม่หาย
    await quiet(desk.page);
    await desk.page.evaluate(() => { updatePharmacyRecheckQty('S-F05', 4); return _flushDirtySkus(); });
    await waitForDoc(PROJECT_ID, 'stock_sessions/SRC/items/S-F05', (d) => d && d.recheckQty === 4 && d.status === 'audit');
    await quiet(desk.page);
    const kept = await desk.page.evaluate(() => {
      _applyPharmacyAuditMarkersToState(); _applyPharmacyAuditMarkersToState();
      const s = state.scanData.get('S-F05');
      return { rq: s.recheckQty, by: s.recheckBy, pending: [...getPharmacistAuditPendingMap().keys()] };
    });
    expect(kept).toEqual({ rq: 4, by: 'Pharm', pending: ['S-F05'] });

    // (ข) ★ กรณีที่เกิดจริงบนหน้างาน: ค่า marker ใน sd ถูกย้อนเป็นของเก่า (echo/snapshot เก่า) แล้ว marker apply ซ้ำ — ยอดต้องไม่หาย
    const stale = await desk.page.evaluate(() => {
      const s = state.scanData.get('S-F05');
      s.pharmacyAuditMarkerAt = '2026-09-29 00:00:00'; s.pharmacyAuditCountConfirmedAt = '2026-09-29 00:00:00';
      const changed = _applyPharmacyAuditMarkersToState();
      return { changed, rq: s.recheckQty, mAt: s.pharmacyAuditMarkerAt, reopenedAt: _pharmacyAuditMarkerData.items['S-F05'].reopenedAt };
    });
    expect(stale.changed).toEqual(['S-F05']);                  // apply จริง ไม่ใช่ same ข้ามไป — ไม่งั้นข้อนี้ไม่ได้ทดสอบอะไร
    expect(stale.rq).toBe(4);
    expect(stale.mAt).toBe(stale.reopenedAt);                  // marker ตามทัน → รอบถัดไป same ข้ามได้เอง

    // ยืนยัน → ตัดสินด้วยยอดใหม่ (4 ≠ 5 → Stock Adj ด้วยยอดรีเช็คใหม่ ไม่ใช่ "ไม่มีรายการรอยืนยัน")
    await quiet(desk.page);
    await desk.page.evaluate(() => _confirmPharmacyAuditBatched());
    await desk.page.waitForFunction(() => _branchConfirming === false, null, { timeout: 30000, polling: 100 });
    const done = await waitForDoc(PROJECT_ID, 'stock_sessions/SRC/items/S-F05', (d) => d && d.status === 'stock_adjustment' && d.recheckQty === 4 && d.auditor === 'Pharm');
    expect(done.recheckSystemQty).toBe(5);
    expect(await getDoc(PROJECT_ID, 'stock_sessions/SRC_confirm_lock')).toBeNull();

    await closeApp(pda);
    await closeApp(desk);
  });

  test('อุปกรณ์อื่นที่ได้รับ marker reopen ทีหลังก็เห็นสถานะเดียวกัน และกรอกยอดต่อได้', async ({ browser }) => {
    const { desk, pda } = await bootWithVerifiedAdj(browser);
    // เครื่องที่สอง (เภสัชบน PDA — กรอกรีเช็คได้ แต่ยืนยันไม่ได้) เปิดค้างอยู่ก่อนกด ↺
    const pharmPda = await bootJoinCount(browser, { role: 'pharmacist', user: 'PharmPDA', mode: 'pda', expectEpoch: desk.epoch });
    await pharmPda.page.waitForFunction(() => state.scanData.get('S-F05')?.status === 'stock_adjustment', null, { timeout: 15000, polling: 100 });

    armDialog(desk.page, 'y');
    await desk.page.evaluate(() => reopenPharmacyAudit('S-F05'));

    // เครื่องที่สองรับ item + marker ผ่าน listener → ต้องเป็น audit ไม่มียอดเก่า
    await pharmPda.page.waitForFunction(() => { const s = state.scanData.get('S-F05'); return s?.status === 'audit' && s.recheckQty == null && !!_pharmacyAuditMarkerData.items?.['S-F05']?.reopenedAt; },
      null, { timeout: 20000, polling: 100 });
    await quiet(pharmPda.page);

    // เภสัชบน PDA สแกน/กรอกรีเช็ค → sync ขึ้น cloud → Desktop เห็นยอดนั้นและยืนยันได้
    await pharmPda.page.evaluate(() => { updatePharmacyRecheckQty('S-F05', 5); return _flushDirtySkus(); });
    await waitForDoc(PROJECT_ID, 'stock_sessions/SRC/items/S-F05', (d) => d && d.recheckQty === 5 && d.recheckBy === 'PharmPDA');
    await quiet(pharmPda.page);
    await desk.page.waitForFunction(() => state.scanData.get('S-F05')?.recheckQty === 5, null, { timeout: 20000, polling: 100 });
    await quiet(desk.page);
    await desk.page.evaluate(() => _confirmPharmacyAuditBatched());
    await desk.page.waitForFunction(() => _branchConfirming === false, null, { timeout: 30000, polling: 100 });
    const done = await waitForDoc(PROJECT_ID, 'stock_sessions/SRC/items/S-F05', (d) => d && d.status === 'pass');
    expect(done).toMatchObject({ auditor: 'Pharm', recheckQty: 5, recheckBy: 'PharmPDA' });

    await closeApp(pharmPda);
    await closeApp(pda);
    await closeApp(desk);
  });
});
