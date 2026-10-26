// ↺ สแกนใหม่ → ⏳ รอนับ (restartPharmacyScan · สวิตช์ PHARMACY_RESCAN_TO_PENDING · 16 ต.ค. 2026) — เส้นทางจริงบน emulator หลายเครื่อง
//   A. Stock Adj ตรงจากรอบแรก (directAdj · ไม่มี marker): ↺ → item หายบน Cloud · PDA ผู้ช่วยเห็น pending · สแกนใหม่ → Confirm → ผลใหม่ตามสูตร
//   B. ★ Stock Adj ที่ผ่านรีเช็ค (มี final marker): marker + item หายใน commit เดียว · ทุกเครื่องเห็น pending และ "ไม่ฟื้น"
//      แม้ marker apply ซ้ำ + reconcile + flush + login เครื่องใหม่ (เส้นทางที่ทำให้รีเซ็ตหายเงียบถ้าลบแต่ item)
//   C. transaction ล้ม → Cloud/local เท่าเดิม → กดใหม่สำเร็จ
//   D. แก้ในใบ (dirty) แล้วกด ↺ ขณะ flush ตัดหน้า → ต้องไม่ถูกเขียนทับกลับ
//   E. flush ที่เริ่มระหว่างรอ transaction เขียนเอกสารเดิมฟื้นหลังลบ → flush ลบซ้ำต้องลบจริง (ธง _forceDelSkus · ไม่ถูกด่าน FLUSH_DEL_KEEP_CONFIRMED เก็บเศษกลับ)
// logic ล้วน (guards · รูป transaction · ข้อความ) อยู่ที่ specs/logic/pharmacy-stockadj-rescan.spec.js
const { test, expect, closeApp, requireEmulator, armDialog } = require('../../lib/hooks');
const { bootFreshCount, bootJoinCount, armR16, PROJECT_ID } = require('../../lib/scenario');
const { waitForDoc, getDoc } = require('../../lib/emulator');
const { seedItems } = require('../../lib/seed');

const ITEM = 'stock_sessions/SRC/items/S-F05';
const MARKERS = 'stock_sessions/SRC_pharmacy_audit_markers';

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
// เครื่องนี้ไม่มีงานเขียน item ค้างแล้ว — Confirm/ยืนยัน/รีเซ็ตจะ abort ถ้ามี write แทรกระหว่างอ่านสองรอบ
async function quiet(page) {
  await page.waitForFunction(() => _dirtySkus.size === 0 && _scanItemInFlight.size === 0 && !_scanItemFlushing,
    null, { timeout: 20000, polling: 100 });
}
const status = (page) => page.evaluate(() => state.scanData.get('S-F05')?.status);
const sheetSkus = (page) => page.evaluate(() => [..._buildAdjustDocRows('ords'), ..._buildAdjustDocRows('irps')].map((r) => r.sku));

// Stock Adj ตรง (ระบบ 5 · นับ 3) ที่ Desktop เภสัชโหลดแล้ว — seed ตรงเพื่อไม่ต้องผ่าน Confirm (ทดสอบเฉพาะการรีเซ็ต)
async function bootWithDirectAdj(browser) {
  const desk = await bootFreshCount(browser, { role: 'pharmacist', user: 'Pharm', mode: 'desktop' });
  await armR16(desk.page);
  await seedItems(PROJECT_ID, 'SRC', desk.epoch, [
    { sku: 'S-F05', status: 'stock_adjustment', auditStatus: 'stock_adjustment', initialStatus: 'stock_adjustment', directAdj: true, effectiveQty: 3, systemQty: 5, countedQty: 3, scannedBy: 'PDA-A' },
  ]);
  await desk.page.waitForFunction(() => state.scanData.get('S-F05')?.status === 'stock_adjustment' && _scanItemRev.get('S-F05') === 1, null, { timeout: 15000, polling: 100 });
  return desk;
}

test.describe('↺ สแกนใหม่ → ⏳ รอนับ', () => {
  test.beforeEach(() => requireEmulator());
  test.setTimeout(150_000);

  test('A. directAdj: ↺ → item หายบน Cloud · PDA เห็น pending · ผู้ช่วยสแกนใหม่ → Confirm → ผลใหม่ตามสูตร (ไม่ผ่านรีเช็ค)', async ({ browser }) => {
    const desk = await bootFreshCount(browser, { role: 'pharmacist', user: 'Pharm', mode: 'desktop' });
    await armR16(desk.page);
    const pda = await bootJoinCount(browser, { role: 'assistant', user: 'PDA-A', mode: 'pda', expectEpoch: desk.epoch });
    await pdaScan(pda, [['B-F05', 3]]);                          // ของจริงมี 5 นับได้ 3 → Stock Adj ตรง
    await desk.page.evaluate(() => validateAndProcess());
    await waitForDoc(PROJECT_ID, ITEM, (d) => d && d.status === 'stock_adjustment' && d.directAdj === true, { timeout: 25000 });
    await desk.page.waitForFunction(() => state.scanData.get('S-F05')?.directAdj === true, null, { timeout: 15000, polling: 100 });
    expect(await sheetSkus(desk.page)).toContain('S-F05');       // ก่อนรีเซ็ต: อยู่ในใบ 📦
    await quiet(desk.page); await quiet(pda.page);

    armDialog(desk.page, 'y');
    await desk.page.evaluate(() => restartPharmacyScan('S-F05'));
    await waitForDoc(PROJECT_ID, ITEM, (d) => d === null, { timeout: 20000 });
    expect(((await getDoc(PROJECT_ID, MARKERS)) || {}).items?.['S-F05']).toBeUndefined();
    expect(await status(desk.page)).toBe('pending');
    expect(await sheetSkus(desk.page)).not.toContain('S-F05');   // แถวหายจากใบทันที
    // ผู้ช่วย PDA (เครื่องที่สแกนไว้เอง) เห็นเองผ่าน listener — ต้องเป็น pending ก่อนถึงสแกนใหม่ได้ (สถานะอื่นถูกปฏิเสธ "สแกนและ Confirm ไปแล้ว")
    await pda.page.waitForFunction(() => state.scanData.get('S-F05')?.status === 'pending', null, { timeout: 20000, polling: 100 });

    // เภสัชสแกน pending ไม่ได้ (ต้องใช้รหัสผู้ช่วย) — ข้อความเดิมของ processPharmacistAuditScan
    const refused = await desk.page.evaluate(() => {
      const got = []; const real = window.toast; window.toast = (m) => got.push(String(m));
      try { document.getElementById('scanInput').value = 'B-F05'; processPharmacistAuditScan(); } finally { window.toast = real; }
      return got;
    });
    expect(refused).toEqual(['ใช้รหัสผู้ช่วยนับสินค้า']);

    // ผู้ช่วยนับใหม่ครบ 5 = ตรงระบบ → Confirm รอบแรกตามสูตรเดิม → pass (ไม่มีขั้นรีเช็ค)
    await pdaScan(pda, [['B-F05', 5]]);
    await desk.page.waitForFunction(() => { const s = state.scanData.get('S-F05'); return s?.status === 'scanning' && s.countedQty === 5; }, null, { timeout: 20000, polling: 100 });
    await quiet(desk.page); await quiet(pda.page);
    await desk.page.evaluate(() => validateAndProcess());
    const done = await waitForDoc(PROJECT_ID, ITEM, (d) => d && d.status === 'pass', { timeout: 25000 });
    expect(done).toMatchObject({ countedQty: 5, scannedBy: 'PDA-A' });
    expect(done.directAdj).toBeUndefined();
    expect(done.recheckQty).toBeUndefined();
    expect(await sheetSkus(desk.page)).not.toContain('S-F05');
    expect(await getDoc(PROJECT_ID, 'stock_sessions/SRC_confirm_lock')).toBeNull();

    await closeApp(pda);
    await closeApp(desk);
  });

  test('B. ★ Stock Adj ที่ผ่านรีเช็ค (มี final marker): marker + item หายใน commit เดียว · ทุกเครื่องเห็น pending และไม่ฟื้น (marker ซ้ำ · reconcile · flush · login ใหม่)', async ({ browser }) => {
    const desk = await bootFreshCount(browser, { role: 'pharmacist', user: 'Pharm', mode: 'desktop' });
    await armR16(desk.page);
    // Stock Adj ที่ Audit เดิมยืนยันแล้ว (ระบบ 5 · นับ 3 · รีเช็ค 4) — เหมือน pharmacy-reopen-recheck.spec.js
    await seedItems(PROJECT_ID, 'SRC', desk.epoch, [
      { sku: 'S-F05', status: 'stock_adjustment', auditStatus: 'stock_adjustment', initialStatus: 'audit', auditor: 'Pharm', countedQty: 3,
        recheckQty: 4, recheckBy: 'Pharm', recheckAt: '2026-09-29T03:00:00.000Z', recheckSystemQty: 5, scannedBy: 'PDA-A' },
    ]);
    const pda = await bootJoinCount(browser, { role: 'assistant', user: 'PDA-A', mode: 'pda', expectEpoch: desk.epoch });
    const desk2 = await bootJoinCount(browser, { role: 'pharmacist', user: 'Pharm2', mode: 'desktop', expectEpoch: desk.epoch });
    await desk.page.waitForFunction(() => state.scanData.get('S-F05')?.status === 'stock_adjustment', null, { timeout: 15000, polling: 100 });

    // สร้าง final marker จริงด้วยทางเดิม (↺ แบบเดิม → รีเช็ค 4 → ยืนยัน) แล้วเอา marker นั้นมาทดสอบการรีเซ็ต
    armDialog(desk.page, 'y');
    await desk.page.evaluate(() => reopenPharmacyAudit('S-F05'));
    await waitForDoc(PROJECT_ID, ITEM, (d) => d && d.status === 'audit', { timeout: 20000 });
    await quiet(desk.page);
    await desk.page.evaluate(() => { updatePharmacyRecheckQty('S-F05', 4); return _flushDirtySkus(); });
    await waitForDoc(PROJECT_ID, ITEM, (d) => d && d.recheckQty === 4 && d.status === 'audit');
    await quiet(desk.page);
    await desk.page.evaluate(() => _confirmPharmacyAuditBatched());
    await desk.page.waitForFunction(() => _branchConfirming === false, null, { timeout: 30000, polling: 100 });
    await waitForDoc(PROJECT_ID, ITEM, (d) => d && d.status === 'stock_adjustment' && d.auditor === 'Pharm' && d.recheckQty === 4);
    expect((await getDoc(PROJECT_ID, MARKERS)).items['S-F05']).toMatchObject({ status: 'stock_adjustment', auditor: 'Pharm' });
    // เครื่องอื่นรับ item + final marker ครบก่อนเริ่ม (ไม่งั้นไม่ได้ทดสอบ "marker ค้างใน cache")
    await desk2.page.waitForFunction(() => { const s = state.scanData.get('S-F05'); return s?.status === 'stock_adjustment' && s.auditor === 'Pharm' && _pharmacyAuditMarkerData.items?.['S-F05']?.auditor === 'Pharm'; },
      null, { timeout: 20000, polling: 100 });
    await pda.page.waitForFunction(() => state.scanData.get('S-F05')?.status === 'stock_adjustment', null, { timeout: 20000, polling: 100 });
    for (const dev of [desk, desk2, pda]) await quiet(dev.page);

    armDialog(desk.page, 'y');
    await desk.page.evaluate(() => restartPharmacyScan('S-F05'));
    await waitForDoc(PROJECT_ID, ITEM, (d) => d === null, { timeout: 20000 });
    expect(((await getDoc(PROJECT_ID, MARKERS)) || {}).items?.['S-F05']).toBeUndefined();   // marker หายพร้อม item
    expect(await status(desk.page)).toBe('pending');

    // ทุกเครื่องเห็นเอง → ไล่เส้นทางที่เคยทำให้ฟื้น: marker apply ซ้ำ · reconcile · flush
    for (const dev of [desk2, pda]) await dev.page.waitForFunction(() => state.scanData.get('S-F05')?.status === 'pending', null, { timeout: 20000, polling: 100 });
    for (const dev of [desk, desk2, pda]) {
      await dev.page.evaluate(async () => { _applyPharmacyAuditMarkersToState(); _applyPharmacyAuditMarkersToState(); _reconcileScanItems(); await _flushDirtySkus(); });
      expect(await status(dev.page)).toBe('pending');
    }
    expect(await getDoc(PROJECT_ID, ITEM)).toBeNull();
    expect(((await getDoc(PROJECT_ID, MARKERS)) || {}).items?.['S-F05']).toBeUndefined();

    // login เครื่องใหม่ (restore + _loadPharmacyAuditMarkerState รวม backfill) → ต้องเป็น pending
    const desk3 = await bootJoinCount(browser, { role: 'pharmacist', user: 'Pharm3', mode: 'desktop', expectEpoch: desk.epoch });
    await desk3.page.evaluate(() => _loadPharmacyAuditMarkerState());
    await desk3.page.evaluate(async () => { _reconcileScanItems(); await _flushDirtySkus(); });
    expect(await status(desk3.page)).toBe('pending');
    expect(await getDoc(PROJECT_ID, ITEM)).toBeNull();

    await closeApp(desk3); await closeApp(desk2); await closeApp(pda); await closeApp(desk);
  });

  test('C. transaction ล้ม → Cloud/local เท่าเดิม + toast error → กดใหม่สำเร็จ', async ({ browser }) => {
    const desk = await bootWithDirectAdj(browser);
    await quiet(desk.page);
    await desk.page.evaluate(() => {
      window.__toasts = []; toast = (m, t) => { window.__toasts.push(`${t || 'info'}|${m}`); };
      const real = _db.runTransaction.bind(_db); window.__failOnce = true;
      _db.runTransaction = (fn) => {
        if (window.__failOnce) { window.__failOnce = false; return Promise.reject(Object.assign(new Error('unavailable'), { code: 'unavailable' })); }
        return real(fn);
      };
    });
    armDialog(desk.page, 'y');
    await desk.page.evaluate(() => restartPharmacyScan('S-F05'));
    expect(await getDoc(PROJECT_ID, ITEM)).toMatchObject({ status: 'stock_adjustment', directAdj: true });   // Cloud เท่าเดิม
    expect(await desk.page.evaluate(() => [state.scanData.get('S-F05').status, _scanItemRev.get('S-F05'), _restartScanBusy.size])).toEqual(['stock_adjustment', 1, 0]);
    expect(await desk.page.evaluate(() => window.__toasts)).toEqual(['error|สแกนใหม่ไม่สำเร็จ: unavailable']);

    armDialog(desk.page, 'y');
    await desk.page.evaluate(() => restartPharmacyScan('S-F05'));
    await waitForDoc(PROJECT_ID, ITEM, (d) => d === null, { timeout: 20000 });
    expect(await status(desk.page)).toBe('pending');
    await closeApp(desk);
  });

  test('D. แก้ในใบ (dirty) แล้วกด ↺ ขณะ flush ตัดหน้า → ไม่ถูกเขียนทับกลับ · ล้างได้สำเร็จ', async ({ browser }) => {
    const desk = await bootWithDirectAdj(browser);
    await quiet(desk.page);
    await desk.page.evaluate(() => {
      // จำลอง flush ที่เริ่มพอดีระหว่างรอ transaction — ถ้ายังมี SKU นี้ใน dirty มันจะเขียน item เก่ากลับ (rev+1) ก่อนเรา แล้ว transaction เห็น rev เปลี่ยน
      const real = _db.runTransaction.bind(_db);
      _db.runTransaction = async (fn) => { await _flushDirtySkus(); return real(fn); };
      const s = state.scanData.get('S-F05'); s.adjQty = 2; s.adjBase = 2; s.adjBy = 'Pharm'; s.adjAt = new Date().toISOString();
      _markSkuDirty('S-F05');                                    // แก้จำนวนในใบ = รอ flush (ดีบาวซ์ 800ms)
    });
    armDialog(desk.page, 'y');
    await desk.page.evaluate(() => restartPharmacyScan('S-F05'));
    await waitForDoc(PROJECT_ID, ITEM, (d) => d === null, { timeout: 20000 });
    await desk.page.evaluate(async () => { _reconcileScanItems(); await _flushDirtySkus(); });
    expect(await getDoc(PROJECT_ID, ITEM)).toBeNull();           // ไม่ถูกฟื้น
    expect(await desk.page.evaluate(() => { const s = state.scanData.get('S-F05'); return [s.status, s.adjQty, s.directAdj]; })).toEqual(['pending', undefined, undefined]);
    await closeApp(desk);
  });

  test('E. ★ flush ที่เริ่มระหว่างรอ transaction เขียนเอกสารเดิม "ไปถึง server หลังเราลบ" (ฟื้น) → flush ลบซ้ำต้องลบจริง ไม่ถูกด่านรับผล Confirm (FLUSH_DEL_KEEP_CONFIRMED) เก็บเศษ Stock Adj กลับ', async ({ browser }) => {
    const desk = await bootWithDirectAdj(browser);
    await quiet(desk.page);
    await desk.page.evaluate(() => {
      // เขียนของ flush ไปถึง server ช้า 600 ms (หลัง transaction ของ ↺ ลบเอกสารแล้ว) = ฟื้นเอกสารเดิม rev+1
      const realBatch = _db.batch.bind(_db);
      _db.batch = () => { const b = realBatch(); const rc = b.commit.bind(b); b.commit = async () => { await new Promise((r) => setTimeout(r, 600)); return rc(); }; return b; };
      const real = _db.runTransaction.bind(_db);
      _db.runTransaction = async (fn) => {
        const s = state.scanData.get('S-F05'); s.adjQty = 2; s.adjBase = 2; s.adjBy = 'Pharm'; s.adjAt = new Date().toISOString();
        _markSkuDirty('S-F05');                                    // แก้จำนวนในใบระหว่างรอ → flush เริ่ม (local ยังเป็น Stock Adj) → เขียนเอกสารเดิม
        clearTimeout(_scanItemFlushTimer); _scanItemFlushTimer = null;
        window.__flushP = _flushDirtySkus();
        return real(fn);
      };
    });
    armDialog(desk.page, 'y');
    await desk.page.evaluate(() => restartPharmacyScan('S-F05'));
    // 1) ↺ ลบเอกสารสำเร็จ → 2) เขียนค้างของ flush ฟื้นเอกสารเดิม (พิสูจน์ว่าจังหวะแข่งเกิดจริง) → 3) flush ลบซ้ำต้องลบจริง
    await waitForDoc(PROJECT_ID, ITEM, (d) => d === null, { timeout: 20000 });
    const resurrected = await waitForDoc(PROJECT_ID, ITEM, (d) => d && d.status === 'stock_adjustment' && d.rev === 2, { timeout: 20000 });
    expect(resurrected.directAdj).toBe(true);
    await waitForDoc(PROJECT_ID, ITEM, (d) => d === null, { timeout: 30000 });
    await quiet(desk.page);
    expect(await getDoc(PROJECT_ID, ITEM)).toBeNull();
    expect(await desk.page.evaluate(() => { const s = state.scanData.get('S-F05'); return [s.status, s.directAdj, typeof _forceDelSkus === 'undefined' ? 0 : _forceDelSkus.size]; })).toEqual(['pending', undefined, 0]);   // typeof: ข้อนี้เป็นเทสพฤติกรรม (ผ่านกับโค้ดก่อนมีธงด้วย — ล้มเฉพาะเมื่อมีด่านแต่ไม่มีธง)
    expect(await sheetSkus(desk.page)).not.toContain('S-F05');
    await closeApp(desk);
  });
});
