// สาขายา ตัดขั้น Audit (ก.ย. 2026) — เส้นทางจริงบน emulator
//   A. Confirm รอบแรก → Stock Adj ตรง · audit log บันทึกครบ · backfill ไม่ฟื้นรายการนั้นกลับเป็น Audit
//   B. ↺ ทางถอย: Stock Adj ตรง → Audit → เภสัชรีเช็ค → ยืนยัน (ตัวกรณีล้วนของ ↺ อยู่ที่ pharmacy-reopen-recheck.spec.js)
//   C. ★ อยู่ร่วมกับ Audit เดิมในรอบเดียวกัน: Audit เดิมยืนยันได้ปกติ · Stock Adj ตรงไม่ถูกแตะ
// logic ล้วน (ตัวตัดสิน · ใบปรับสต็อก · สถิติ) อยู่ที่ specs/logic/pharmacy-direct-adj.spec.js
const { test, expect, closeApp, requireEmulator, armDialog } = require('../../lib/hooks');
const { bootFreshCount, bootJoinCount, armR16, PROJECT_ID } = require('../../lib/scenario');
const { waitForDoc, getDoc, setDoc } = require('../../lib/emulator');
const { seedItems } = require('../../lib/seed');

async function scanTimes(page, barcode, times) {
  await page.evaluate(({ barcode, times }) => {
    for (let i = 0; i < times; i++) scanQueue.push(parseScanLine(barcode));
    drainQueue();
  }, { barcode, times });
}

// PDA สแกนแล้วดันขึ้น cloud ให้ครบก่อน Confirm (เหมือนหน้างานจริง: Confirm หลังทุกเครื่อง sync แล้ว)
async function pdaScan(pda, list) {
  for (const [barcode, times] of list) await scanTimes(pda.page, barcode, times);
  await pda.page.waitForFunction((n) => [...state.scanData.values()].filter((s) => s.status === 'scanning').length >= n,
    list.length, { timeout: 15000, polling: 100 });
  await pda.page.evaluate(() => _flushDirtySkus());
}

// เครื่องนี้ไม่มีงานเขียน item ค้างแล้ว — Confirm/ยืนยัน Audit จะ abort ทั้งชุดถ้ามี write แทรกระหว่างอ่านสองรอบ
async function quiet(page) {
  await page.waitForFunction(() => _dirtySkus.size === 0 && _scanItemInFlight.size === 0 && !_scanItemFlushing,
    null, { timeout: 20000, polling: 100 });
}

// marker เป็น authoritative และ overlay หลัง session — ยอดรีเช็คที่กรอกก่อน marker ลงจะถูกทิ้ง (ดู audit-verify.spec.js)
async function markerApplied(page, sku) {
  await page.waitForFunction((s) => !!state.scanData.get(s)?.pharmacyAuditCountConfirmedAt, sku, { timeout: 20000, polling: 100 });
}

const dayOf = (page) => page.evaluate(() => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
});

test.describe('สาขายา ตัดขั้น Audit — Stock Adj ตรงจาก Confirm รอบแรก', () => {
  test.beforeEach(() => requireEmulator());
  test.setTimeout(120_000);

  test('A. Confirm → Stock Adj ตรง · audit log มีรายการ · backfill ข้ามรายการ directAdj แต่ยังฟื้น Audit เดิมได้', async ({ browser }) => {
    const desk = await bootFreshCount(browser, { role: 'pharmacist', user: 'Pharm', mode: 'desktop' });
    await armR16(desk.page);
    const pda = await bootJoinCount(browser, { role: 'assistant', user: 'PDA-A', mode: 'pda', expectEpoch: desk.epoch });
    await pdaScan(pda, [['B-NORM', 10], ['B-F05', 3]]);          // S-NORM sys 10 → pass · S-F05 sys 5 → ขาด 2

    await desk.page.evaluate(() => validateAndProcess());
    await waitForDoc(PROJECT_ID, 'stock_sessions/SRC/items/S-NORM', (d) => d && d.status === 'pass', { timeout: 25000 });
    const f05 = await waitForDoc(PROJECT_ID, 'stock_sessions/SRC/items/S-F05', (d) => d && d.status === 'stock_adjustment');
    expect(f05).toMatchObject({ directAdj: true, effectiveQty: 3, systemQty: 5, initialStatus: 'stock_adjustment' });

    // audit log: รายการไม่ตรงถูกบันทึก (ประวัติ/แท็บผู้ช่วยหลังเริ่มนับใหม่) · pass ไม่เข้า log
    const day = await dayOf(desk.page);
    const logPath = `stock_audit_log/SRC_${day}`;
    const log = await waitForDoc(PROJECT_ID, logPath, (d) => d && (d.items || []).some((i) => i.sku === 'S-F05'), { timeout: 20000 });
    const logged = log.items.find((i) => i.sku === 'S-F05');
    expect(logged).toMatchObject({ status: 'stock_adjustment', directAdj: true, effectiveQty: 3, systemQty: 5, auditor: '' });
    expect(log.items.some((i) => i.sku === 'S-NORM')).toBe(false);

    // ★ backfill จาก log ห้ามฟื้นรายการ directAdj เป็น Audit (จะกลายเป็นงานเภสัชที่ไม่มีใครสั่ง) — แต่ Audit เดิมใน log ยังต้องฟื้นได้
    const now = await desk.page.evaluate(() => {
      const d = new Date(), p = (n) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
    });
    const legacy = { sku: 'S-ZERO', productName: 'x', barcode: 'B-ZERO', countedQty: 1, scannedBy: 'PDA-A', timestamp: now, firstScanAt: now, status: 'audit', auditor: '', recheckQty: null, backorder: false };
    await setDoc(PROJECT_ID, logPath, { branch: 'SRC', date: day, updatedAt: new Date().toISOString(), items: [...log.items, legacy] }, { merge: false });
    await desk.page.evaluate(async () => {
      _pharmacyAuditMarkerData = { ..._pharmacyAuditMarkerData, legacyLogBackfilledAt: undefined };   // ให้ backfill รันซ้ำ
      await _backfillPharmacyAuditMarkersFromLog();
    });
    const markers = await getDoc(PROJECT_ID, 'stock_sessions/SRC_pharmacy_audit_markers');
    expect(Object.keys(markers.items || {})).toEqual(['S-ZERO']);
    expect((await getDoc(PROJECT_ID, 'stock_sessions/SRC/items/S-F05')).status).toBe('stock_adjustment');

    await closeApp(pda);
    await closeApp(desk);
  });

  test('B. ↺ ทางถอย: Stock Adj ตรง → Audit → เภสัชรีเช็ค → ยืนยันเป็น pass', async ({ browser }) => {
    const desk = await bootFreshCount(browser, { role: 'pharmacist', user: 'Pharm', mode: 'desktop' });
    await armR16(desk.page);
    const pda = await bootJoinCount(browser, { role: 'assistant', user: 'PDA-A', mode: 'pda', expectEpoch: desk.epoch });
    await pdaScan(pda, [['B-F05', 3]]);                          // นับครึ่งชั้น (ของจริงมี 5) → Stock Adj ตรง

    await desk.page.evaluate(() => validateAndProcess());
    await waitForDoc(PROJECT_ID, 'stock_sessions/SRC/items/S-F05', (d) => d && d.status === 'stock_adjustment' && d.directAdj === true, { timeout: 25000 });
    await desk.page.waitForFunction(() => state.scanData.get('S-F05')?.directAdj === true, null, { timeout: 15000, polling: 100 });

    // ↺ ต้องกดได้กับ Stock Adj ตรง (เดิม guard ต้อง initialStatus===audit)
    armDialog(desk.page, 'y');
    await desk.page.evaluate(() => reopenPharmacyAudit('S-F05'));
    // ↺ ต้องตั้ง pharmacyAuditMarkerAt เองก่อน flush (ไม่รอ marker snapshot) — ไม่งั้น echo ของ flush ย้อนค่ากลับแล้ว marker ถูก apply ซ้ำจนยอดรีเช็คหาย
    const at = await desk.page.evaluate(() => { const s = state.scanData.get('S-F05'), m = _pharmacyAuditMarkerData.items['S-F05']; return { sd: s.pharmacyAuditMarkerAt, marker: m.confirmedAt, reopenedAt: m.reopenedAt }; });
    expect(at.sd).toBe(at.marker);
    expect(at.reopenedAt).toBe(at.marker);
    const reopened = await waitForDoc(PROJECT_ID, 'stock_sessions/SRC/items/S-F05', (d) => d && d.status === 'audit', { timeout: 20000 });
    expect(reopened.pharmacyAuditMarkerAt).toBe(at.marker);      // payload ของ flush มีค่าใหม่ — echo จึงไม่ย้อนของเก่ากลับมา
    expect(reopened.directAdj).toBeUndefined();                 // ธงถูกล้าง — ตัดสินใหม่ด้วยยอดรีเช็ค ใบกลับไปใช้กติกาเดิม
    expect(reopened.initialStatus).toBe('audit');
    expect(reopened.auditor || '').toBe('');
    const markers = await getDoc(PROJECT_ID, 'stock_sessions/SRC_pharmacy_audit_markers');
    expect(markers.items['S-F05']).toMatchObject({ status: 'audit', initialStatus: 'audit' });
    expect(markers.items['S-F05'].reopenedAt).toBeTruthy();

    // เภสัชนับใหม่ครบ 5 = ตรงระบบ → กรอกยอด → marker ถูก apply ซ้ำ (เหมือน session snapshot) → ยอดต้องไม่หาย → ยืนยัน → pass
    await quiet(desk.page);
    await desk.page.evaluate(() => { updatePharmacyRecheckQty('S-F05', 5); return _flushDirtySkus(); });
    await waitForDoc(PROJECT_ID, 'stock_sessions/SRC/items/S-F05', (d) => d && d.recheckQty === 5);
    await quiet(desk.page);
    const kept = await desk.page.evaluate(() => { _applyPharmacyAuditMarkersToState(); _applyPharmacyAuditMarkersToState(); return state.scanData.get('S-F05').recheckQty; });
    expect(kept).toBe(5);
    await desk.page.evaluate(() => _confirmPharmacyAuditBatched());
    await desk.page.waitForFunction(() => _branchConfirming === false, null, { timeout: 30000, polling: 100 });

    const done = await waitForDoc(PROJECT_ID, 'stock_sessions/SRC/items/S-F05', (d) => d && d.status === 'pass');
    expect(done).toMatchObject({ auditor: 'Pharm', recheckQty: 5 });
    expect(done.directAdj).toBeUndefined();
    expect(await getDoc(PROJECT_ID, 'stock_sessions/SRC_confirm_lock')).toBeNull();

    await closeApp(pda);
    await closeApp(desk);
  });

  test('C. ★ Audit เดิมกับ Stock Adj ตรงอยู่รอบเดียวกัน — Audit เดิมยืนยันได้ปกติ · Stock Adj ตรงไม่ถูกแตะ', async ({ browser }) => {
    const desk = await bootFreshCount(browser, { role: 'pharmacist', user: 'Pharm', mode: 'desktop' });
    await armR16(desk.page);
    // Audit ที่ค้างอยู่ก่อนสลับ flow (จำลองด้วยการ seed ตรง เหมือน Confirm รุ่นเก่าเคยทำ)
    await seedItems(PROJECT_ID, 'SRC', desk.epoch, [
      { sku: 'S-NORM', status: 'audit', auditStatus: 'pending', initialStatus: 'audit', countedQty: 8, scannedBy: 'PDA-A' },
    ]);
    const pda = await bootJoinCount(browser, { role: 'assistant', user: 'PDA-A', mode: 'pda', expectEpoch: desk.epoch });
    await pda.page.waitForFunction(() => state.scanData.get('S-NORM')?.status === 'audit', null, { timeout: 15000, polling: 100 });
    await pdaScan(pda, [['B-F05', 3]]);

    await desk.page.evaluate(() => validateAndProcess());
    await waitForDoc(PROJECT_ID, 'stock_sessions/SRC/items/S-F05', (d) => d && d.status === 'stock_adjustment' && d.directAdj === true, { timeout: 25000 });
    // Confirm รอบใหม่ต้องไม่แตะ Audit เดิม
    expect((await getDoc(PROJECT_ID, 'stock_sessions/SRC/items/S-NORM')).status).toBe('audit');

    // เภสัชรีเช็ค Audit เดิม (ระบบ 10 นับ 10) → pass — คิวยืนยันต้องไม่มี S-F05 ปนเข้ามา
    await markerApplied(desk.page, 'S-NORM');
    const pending = await desk.page.evaluate(async () => {
      updatePharmacyRecheckQty('S-NORM', 10);
      const keys = [...getPharmacistAuditPendingMap().keys()];
      await _flushDirtySkus();
      return keys;
    });
    expect(pending).toEqual(['S-NORM']);
    await waitForDoc(PROJECT_ID, 'stock_sessions/SRC/items/S-NORM', (d) => d && d.recheckQty === 10);
    await quiet(desk.page);
    await desk.page.evaluate(() => _confirmPharmacyAuditBatched());
    await desk.page.waitForFunction(() => _branchConfirming === false, null, { timeout: 30000, polling: 100 });

    const oldPass = await waitForDoc(PROJECT_ID, 'stock_sessions/SRC/items/S-NORM', (d) => d && d.status === 'pass');
    expect(oldPass.auditor).toBe('Pharm');
    const direct = await getDoc(PROJECT_ID, 'stock_sessions/SRC/items/S-F05');
    expect(direct).toMatchObject({ status: 'stock_adjustment', directAdj: true, effectiveQty: 3, systemQty: 5 });
    expect(direct.auditor || '').toBe('');

    await closeApp(pda);
    await closeApp(desk);
  });
});
