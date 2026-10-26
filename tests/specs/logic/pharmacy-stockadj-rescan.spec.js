// ↺ สแกนใหม่ (แท็บ Stock Adj · สาขายา) → กลับเป็น ⏳ รอนับ (pending) เริ่มสแกนใหม่ตั้งแต่ต้น · ไม่เข้ารีเช็ค (16 ต.ค. 2026 · ผู้ใช้สั่ง)
// สวิตช์ PHARMACY_RESCAN_TO_PENDING · ฟังก์ชัน restartPharmacyScan · reopenPharmacyAudit (↺ → รอรีเช็คเดิม) ไม่ถูกแตะ
//
// ตรึง 5 ด้าน — ด้านที่ 2 สำคัญที่สุด เพราะ marker เป็น authoritative (ลบแต่ item = เครื่องอื่น/login รอบถัดไปสร้างกลับจาก marker):
//   1. ปุ่มในแท็บ Stock Adj ผูกฟังก์ชันใหม่ (ปิดสวิตช์ = ผูก reopenPharmacyAudit เดิม) · WH/ผู้ช่วย/PDA ไม่มีปุ่ม
//   2. ★ transaction เดียวลบ marker + item (เก็บ marker ของ SKU อื่น + field อื่นของ doc) · direct Stock Adj ไม่มี marker = ลบ item อย่างเดียว
//   3. ★ ล้ม/abort = ไม่เปลี่ยนอะไรเลย (local + Cloud) · กดซ้ำได้ · ไม่ลบของที่เครื่องอื่นเพิ่งแก้ · เศษรอบอื่นไม่ถูกแตะ
//   4. guards: role · สาขา · PDA · Confirm lock · ออนไลน์ · สถานะ · ยกเลิก confirm · เขียนค้างอยู่ · กดซ้ำ
//   5. ข้อความช่วยเหลือสองโหมด — ปิดสวิตช์ = ข้อความเดิมทุกตัวอักษร
// เส้นทางข้ามเครื่อง (listener · login · reconcile) อยู่ที่ specs/e2e/pharmacy-stockadj-rescan.spec.js
const { test, expect, bootBare, closeApp } = require('../../lib/hooks');

const E = 'E1';
const SCAN = '2026-10-16 10:00:00';
const T = '2026-10-16T03:00:00.000Z';
const ITEMS = 'stock_sessions/SRC/items/';
const MARKERS = 'stock_sessions/SRC_pharmacy_audit_markers';

// สาขา SRC + เภสัช + รายการตัวอย่าง + _db ปลอม (doc/collection + runTransaction get/set/delete) + stub toast/confirm/saveSession
//   SA0 = Stock Adj ตรงจากรอบแรก (directAdj · ไม่มี marker) · SA1/SA2 = Stock Adj ที่ผ่านรีเช็ค (มี final marker)
//   PS0 pass · AU0 audit · SC0 scanning · PE0 pending
async function prime(page, o = {}) {
  await page.evaluate(({ E, SCAN, T, o }) => {
    const opt = { branch: 'SRC', role: 'pharmacist', rescan: true, terms: true, markers: true, items: true, ...o };
    PHARMACY_RESCAN_TO_PENDING = opt.rescan; PHARMACY_RECHECK_TERMS = opt.terms;
    currentBranch = opt.branch; currentRole = opt.role; currentUser = 'Pharm'; _countResetAt = E;
    _schemaVersion = 2; _adminMode = false; _branchScanPaused = false; _branchConfirming = false; _branchConfirmLockData = null;
    state.skuMap.clear(); state.scanData.clear(); scanListMap.clear();
    _scanItemRev.clear(); _scanItemSynced.clear(); _dirtySkus.clear(); _scanItemInFlight.clear(); _restartScanBusy.clear();
    const base = { countedQty: 3, timestamp: SCAN, firstScanAt: SCAN, scannedBy: 'PDA-A', location: 'L1', scans: [{ barcode: 'x', qty: 1 }], retries: 0, auditor: '' };
    const add = (sku, sys, sd) => {
      state.skuMap.set(sku, { sku, productName: 'สินค้า ' + sku, unitPrice: 20, systemQty: sys, negSys: false, barcodes: [{ barcode: 'B-' + sku, unitName: 'ชิ้น', unitMultiplier: 1, unitPrice: 20 }], isDel: false });
      state.scanData.set(sku, { ...base, ...sd });
    };
    const verified = { status: 'stock_adjustment', auditStatus: 'stock_adjustment', initialStatus: 'audit', auditor: 'Pharm', recheckQty: 4, recheckBy: 'Pharm', recheckAt: T,
      recheckSystemQty: 5, pharmacyAuditMarkerAt: T, pharmacyAuditCountConfirmedAt: T };
    add('SA0', 5, { status: 'stock_adjustment', auditStatus: 'stock_adjustment', initialStatus: 'stock_adjustment', directAdj: true, effectiveQty: 3, systemQty: 5 });
    add('SA1', 5, verified); add('SA2', 5, verified);
    add('PS0', 5, { status: 'pass', auditStatus: 'approved', initialStatus: 'pass' });
    add('AU0', 5, { status: 'audit', auditStatus: 'pending', initialStatus: 'audit' });
    add('SC0', 5, { status: 'scanning', auditStatus: 'pending' });
    add('PE0', 5, { status: 'pending', auditStatus: 'pending', countedQty: 0, timestamp: '', scannedBy: '', scans: [] });
    const marker = (sku) => ({ countResetAt: E, status: 'stock_adjustment', auditStatus: 'stock_adjustment', initialStatus: 'audit', directAdj: false, auditor: 'Pharm',
      confirmedAt: T, confirmedBy: 'Pharm', countedQty: 3, recheckQty: 4, recheckBy: 'Pharm', recheckAt: T, recheckSystemQty: 5, reopenedAt: '2026-10-15T03:00:00.000Z', sku });
    const markerDoc = { branch: 'SRC', countResetAt: E, items: { SA1: marker('SA1'), SA2: marker('SA2') }, legacyLogBackfilledAt: 'LOG-T', updatedAt: 'old' };
    if (opt.flag === false) delete markerDoc.legacyLogBackfilledAt;   // doc ที่ไม่มี flag migration (ไม่มี login ไหนในรอบนี้ที่ skuMap พร้อม — เจอใน e2e)
    _pharmacyAuditMarkerData = JSON.parse(JSON.stringify(markerDoc));
    // เอกสารบน Cloud จำลอง: path → data (ไม่มี = ไม่มีเอกสาร)
    window.__store = {};
    if (opt.items) for (const sku of ['SA0', 'SA1', 'SA2']) window.__store['stock_sessions/SRC/items/' + sku] = { sku, countResetAt: E, status: 'stock_adjustment', rev: 3 };
    if (opt.markers) window.__store['stock_sessions/SRC_pharmacy_audit_markers'] = JSON.parse(JSON.stringify(markerDoc));
    for (const sku of ['SA0', 'SA1', 'SA2']) _scanItemRev.set(sku, 3);
    window.__ops = []; window.__txCount = 0; window.__fail = null; window.__duringTx = null;
    const mkRef = (path) => ({ path, collection: (c) => ({ doc: (id) => mkRef(path + '/' + c + '/' + id) }) });
    _db = {
      collection: (c) => ({ doc: (id) => mkRef(c + '/' + id) }),
      runTransaction: async (fn) => {
        window.__txCount++;
        if (window.__fail) throw Object.assign(new Error(window.__fail), { code: window.__fail });
        const writes = [];
        const tx = {
          get: async (r) => { const d = window.__store[r.path]; return { exists: d !== undefined, data: () => JSON.parse(JSON.stringify(d)) }; },
          set: (r, data) => writes.push(['set', r.path, data]),
          delete: (r) => writes.push(['delete', r.path]),
        };
        await fn(tx);
        if (window.__duringTx) window.__duringTx();
        for (const w of writes) {
          window.__ops.push(w.slice(0, 2));
          if (w[0] === 'set') window.__store[w[1]] = { ...w[2], updatedAt: 'ts' }; else delete window.__store[w[1]];
        }
      },
    };
    window.__toasts = []; toast = (m, t) => { window.__toasts.push(`${t || 'info'}|${m}`); };
    window.__confirms = []; window.__confirmAnswer = true; window.confirm = (m) => { window.__confirms.push(String(m)); return window.__confirmAnswer; };
    window.__saved = 0; saveSession = () => { window.__saved++; };
    _scheduleScanFlush = () => {};
    // prime ถูกเรียกซ้ำในเทสเดียว — คืนค่าที่เทสก่อนหน้าอาจ override ไว้ (PDA / ออฟไลน์)
    _isPdaApp = () => navigator.userAgent.includes('StockCountPDA');
    try { delete navigator.onLine; } catch (e) {}
  }, { E, SCAN, T, o });
}
const toasts = (page) => page.evaluate(() => window.__toasts);
const local = (page, sku) => page.evaluate((s) => { const d = state.scanData.get(s); return d ? JSON.parse(JSON.stringify(d)) : null; }, sku);
const cloud = (page) => page.evaluate(() => ({ store: JSON.parse(JSON.stringify(window.__store)), ops: window.__ops, tx: window.__txCount, confirms: window.__confirms.length }));
// รายการตัวอย่างต้องไม่ถูกแตะ (ใช้ยืนยันว่า guard/ล้มแล้วไม่เปลี่ยนอะไรเลย)
const untouched = async (page, sku = 'SA0') => {
  const d = await local(page, sku);
  expect(d.status, `${sku} ต้องยังเป็น Stock Adj`).toBe('stock_adjustment');
  expect(d.countedQty).toBe(3);
  expect(await page.evaluate((s) => _scanItemRev.get(s), sku)).toBe(3);
};

const PENDING_SA0 = { countedQty: 0, status: 'pending', retries: 0, timestamp: '', scannedBy: '', auditor: '', auditStatus: 'pending', barcode: '', location: 'L1', scans: [] };

test('ค่าเริ่มต้นที่ส่งมอบ: สวิตช์เปิด · ฟังก์ชันใหม่ · helper ใช้เฉพาะสาขายา', async ({ browser }) => {
  const app = await bootBare(browser);
  expect(await app.page.evaluate(() => [typeof PHARMACY_RESCAN_TO_PENDING, PHARMACY_RESCAN_TO_PENDING, typeof restartPharmacyScan, typeof reopenPharmacyAudit])).toEqual(['boolean', true, 'function', 'function']);
  await prime(app.page);
  expect(await app.page.evaluate(() => _rescanToPendingOn())).toBe(true);
  await app.page.evaluate(() => { currentBranch = 'WH'; });
  expect(await app.page.evaluate(() => _rescanToPendingOn())).toBe(false);
  await app.page.evaluate(() => { currentBranch = 'SRC'; PHARMACY_RESCAN_TO_PENDING = false; });
  expect(await app.page.evaluate(() => _rescanToPendingOn())).toBe(false);
  await closeApp(app);
});

test('★ ปุ่ม ↺ ในแท็บ Stock Adj ผูก restartPharmacyScan · ปิดสวิตช์ = ผูก reopenPharmacyAudit เดิม · WH/ผู้ช่วย/PDA ไม่มีปุ่ม', async ({ browser }) => {
  const app = await bootBare(browser);
  const buttons = () => app.page.evaluate(() => {
    _avFilter = 'stock_adj'; renderAuditVerifyTable();
    return [...document.querySelectorAll('#auditVerifyTableBody button')].map((b) => [b.getAttribute('onclick'), b.title, b.textContent.trim()]);
  });
  await prime(app.page);
  const NEW = ['ล้างผลนับ แล้วสแกนนับใหม่ตั้งแต่ต้น (⏳ รอนับ)', '↺ สแกนใหม่'];
  expect(await buttons()).toEqual([["restartPharmacyScan('SA0')", ...NEW], ["restartPharmacyScan('SA1')", ...NEW], ["restartPharmacyScan('SA2')", ...NEW]]);

  await prime(app.page, { rescan: false });
  const OLD = ['เปิดกลับไปสแกนรีเช็คใหม่', '↺ สแกนใหม่'];
  expect(await buttons()).toEqual([["reopenPharmacyAudit('SA0')", ...OLD], ["reopenPharmacyAudit('SA1')", ...OLD], ["reopenPharmacyAudit('SA2')", ...OLD]]);

  // ไม่ใช่เภสัชสาขายาบน Desktop = ไม่มีปุ่มเลย (ทั้งสองโหมด)
  for (const o of [{ role: 'assistant' }, { branch: 'WH', role: 'supervisor' }]) {
    await prime(app.page, o);
    expect(await buttons(), JSON.stringify(o)).toEqual([]);
  }
  await prime(app.page);
  await app.page.evaluate(() => { _isPdaApp = () => true; });
  expect(await buttons()).toEqual([]);
  await closeApp(app);
});

test('★ direct Stock Adj (ไม่มี marker): confirm → transaction เดียวลบ item · ไม่เขียน marker · local เป็น pending · แถวหายจากแท็บ/ใบ', async ({ browser }) => {
  const app = await bootBare(browser);
  await prime(app.page, { markers: false });
  await app.page.evaluate(() => { _dirtySkus.add('SA0'); scanListMap.set('SA0', { sku: 'SA0', barcodes: [], totalQty: 3, status: 'stock_adjustment' }); });
  expect(await app.page.evaluate(() => _buildAdjustDocRows('ords').filter((r) => r.sku === 'SA0').map((r) => [r.sku, r.qty]))).toEqual([['SA0', 2]]);   // ก่อนรีเซ็ต: ขาด 2 อยู่ในใบ
  // เปิดแท็บ Stock Adj + ป้ายตัวเลขปุ่ม 📦 ไว้ก่อน — หลังรีเซ็ตต้องตามทันเอง (ฟังก์ชันต้อง refresh เอง ไม่ใช่ให้เทสวาดใหม่)
  expect(await app.page.evaluate(() => { _avFilter = 'stock_adj'; renderAuditVerifyTable(); updateAdjustDocCount(); return [document.getElementById('avCountStockAdj').textContent, document.getElementById('adjustDocCount').textContent]; })).toEqual(['3', '4']);   // ปุ่ม 📦 นับ Stock Adj 3 + รอรีเช็ค AU0 (audit ขึ้นใบด้วย)
  await app.page.evaluate(() => restartPharmacyScan('SA0'));

  const c = await cloud(app.page);
  expect(c.confirms).toBe(1);
  expect(c.tx).toBe(1);
  expect(c.ops).toEqual([['delete', ITEMS + 'SA0']]);             // marker doc ไม่ถูกเขียน (ไม่มีอะไรให้ลบ)
  expect(c.store[ITEMS + 'SA0']).toBeUndefined();
  expect(c.store[ITEMS + 'SA1']).toBeDefined();                   // SKU อื่นไม่ถูกแตะ

  expect(await local(app.page, 'SA0')).toEqual(PENDING_SA0);       // รูปเดียวกับ _applyScanItemRemoved — ไม่เหลือ directAdj/effectiveQty/ผู้นับ/เวลา/ผลตัดสิน
  const s = await app.page.evaluate(() => ({
    rev: _scanItemRev.has('SA0'), synced: _scanItemSynced.has('SA0'), dirty: _dirtySkus.has('SA0'), row: scanListMap.has('SA0'),
    pendingRecheck: getPharmacistAuditPendingMap().has('SA0'), saved: window.__saved,
    ords: _buildAdjustDocRows('ords').map((r) => r.sku).sort(), irps: _buildAdjustDocRows('irps').map((r) => r.sku),
    pill: getStatusPill(state.scanData.get('SA0').status),
    adjRows: [...document.querySelectorAll('#auditVerifyTableBody tr .ptd-sku')].map((e) => e.textContent),   // ไม่วาดซ้ำเอง — ต้องเป็นผลที่ฟังก์ชัน refresh ไว้
    adjCount: document.getElementById('avCountStockAdj').textContent, docBtn: document.getElementById('adjustDocCount').textContent,
  }));
  expect(s).toMatchObject({ rev: false, synced: false, dirty: false, row: false, pendingRecheck: false, ords: ['SA1', 'SA2'], irps: [], adjRows: ['SA1', 'SA2'], adjCount: '2', docBtn: '3' });   // ใบเหลือแต่ SKU อื่น
  expect(s.pill).toContain('⏳ รอนับ');
  expect(s.saved).toBeGreaterThan(0);
  const t = await toasts(app.page);
  expect(t).toEqual(['success|↺ SA0 กลับเป็น ⏳ รอนับ — ให้ผู้ช่วยสแกนใหม่']);
  const dlg = (await cloud(app.page)) && await app.page.evaluate(() => window.__confirms[0]);
  expect(dlg).toBe('เริ่มนับใหม่: SA0\nสินค้า SA0\n\nสแกนสินค้าใหม่และกด Confirm');
  await closeApp(app);
});

test('★ Stock Adj ที่ผ่านรีเช็ค (มี final marker): ลบ marker + item ใน transaction เดียว · เก็บ marker ของ SKU อื่นและ field อื่นของ doc · ไม่ฟื้นกลับ', async ({ browser }) => {
  const app = await bootBare(browser);
  await prime(app.page);
  await app.page.evaluate(() => restartPharmacyScan('SA1'));

  const c = await cloud(app.page);
  expect(c.tx).toBe(1);                                            // ต้องเป็นก้อนเดียว — ล้มกลางคันจะไม่ค้างครึ่งทาง
  expect(c.ops).toEqual([['set', 'stock_sessions/SRC_pharmacy_audit_markers'], ['delete', ITEMS + 'SA1']]);
  const doc = c.store['stock_sessions/SRC_pharmacy_audit_markers'];
  expect(Object.keys(doc.items)).toEqual(['SA2']);                // SKU อื่นยังอยู่
  expect(doc.items.SA2).toMatchObject({ status: 'stock_adjustment', auditor: 'Pharm', reopenedAt: expect.any(String) });
  expect(doc).toMatchObject({ branch: 'SRC', countResetAt: E, legacyLogBackfilledAt: 'LOG-T', updatedAt: 'ts' });   // flag migration ไม่หาย (ไม่งั้น backfill จาก log รันซ้ำ)
  expect(c.store[ITEMS + 'SA1']).toBeUndefined();
  expect(c.store[ITEMS + 'SA2']).toBeDefined();

  expect(Object.keys(await app.page.evaluate(() => _pharmacyAuditMarkerData.items))).toEqual(['SA2']);   // cache ในเครื่องตามทัน
  const sd = await local(app.page, 'SA1');
  expect(sd).toMatchObject({ status: 'pending', countedQty: 0, auditor: '' });
  expect(sd.recheckQty).toBeUndefined();
  expect(sd.pharmacyAuditMarkerAt).toBeUndefined();
  // marker snapshot ถัดไป (listener/session) apply ซ้ำ → ต้องไม่สร้าง Stock Adj กลับ
  expect(await app.page.evaluate(() => { const r1 = _applyPharmacyAuditMarkersToState(), r2 = _applyPharmacyAuditMarkersToState(); return [r1, r2, state.scanData.get('SA1').status]; })).toEqual([[], [], 'pending']);

  // control: ถ้า marker ยังอยู่ (เครื่องที่ cache เก่า) แล้ว apply → ฟื้นเป็น Stock Adj ทันที — นี่คือเหตุผลที่ต้องลบ marker ใน transaction เดียวกับ item
  const resurrected = await app.page.evaluate(() => {
    _pharmacyAuditMarkerData = { branch: 'SRC', countResetAt: 'E1', items: { SA1: { countResetAt: 'E1', status: 'stock_adjustment', auditStatus: 'stock_adjustment', initialStatus: 'audit', auditor: 'Pharm',
      confirmedAt: '2026-10-16T03:00:00.000Z', recheckQty: 4, recheckBy: 'Pharm', recheckAt: '2026-10-16T03:00:00.000Z', countedQty: 3 } } };
    _applyPharmacyAuditMarkersToState();
    return state.scanData.get('SA1').status;
  });
  expect(resurrected).toBe('stock_adjustment');

  // ★ doc ที่ยังไม่มี flag migration: ต้องตั้ง legacyLogBackfilledAt ในก้อนเดียวกัน — ไม่งั้น login เครื่องถัดไปอ่าน stock_audit_log แล้วสร้าง marker final กลับ
  //   (รายการ audit/ผ่านรีเช็คในลอกไม่มี directAdj) ทับยอดที่ผู้ช่วยเพิ่งนับใหม่ · เจอจริงใน e2e (ดู specs/e2e/pharmacy-stockadj-rescan.spec.js ข้อ B)
  await prime(app.page, { flag: false });
  expect(await app.page.evaluate(() => [window.__store['stock_sessions/SRC_pharmacy_audit_markers'].legacyLogBackfilledAt, _pharmacyAuditMarkerData.legacyLogBackfilledAt])).toEqual([undefined, undefined]);
  await app.page.evaluate(() => restartPharmacyScan('SA1'));
  const flagged = await cloud(app.page);
  expect(flagged.store['stock_sessions/SRC_pharmacy_audit_markers'].legacyLogBackfilledAt).toBeTruthy();
  expect(Object.keys(flagged.store['stock_sessions/SRC_pharmacy_audit_markers'].items)).toEqual(['SA2']);
  expect(await app.page.evaluate(() => !!_pharmacyAuditMarkerData.legacyLogBackfilledAt)).toBe(true);
  // flag ตั้งแล้ว → backfill จาก log ออกทันที (ถ้ายังรันจะพังที่ fake _db ไม่มี stock_audit_log)
  await app.page.evaluate(() => _backfillPharmacyAuditMarkersFromLog());
  expect((await local(app.page, 'SA1')).status).toBe('pending');
  // directAdj ไม่มี marker ให้ลบ → ไม่แตะ doc marker เลย (flag ไม่ถูกตั้งเอง — log ของ directAdj ถูก backfill ข้ามอยู่แล้ว)
  await prime(app.page, { flag: false });
  await app.page.evaluate(() => restartPharmacyScan('SA0'));
  expect((await cloud(app.page)).store['stock_sessions/SRC_pharmacy_audit_markers'].legacyLogBackfilledAt).toBeUndefined();
  await closeApp(app);
});

test('item ไม่มีบน Cloud แล้ว (idempotent) · marker ต่าง epoch ไม่แตะ · เศษ item ต่างรอบไม่ลบและไม่ขวาง', async ({ browser }) => {
  const app = await bootBare(browser);
  // ไม่มี item และไม่มี marker → สำเร็จโดยไม่เขียนอะไร (กดซ้ำหลังสำเร็จครั้งก่อนแต่หน้าจอยังไม่ตามทัน)
  await prime(app.page, { items: false, markers: false });
  await app.page.evaluate(() => restartPharmacyScan('SA0'));
  let c = await cloud(app.page);
  expect(c.ops).toEqual([]);
  expect((await local(app.page, 'SA0')).status).toBe('pending');
  expect((await toasts(app.page))[0]).toMatch(/^success\|/);

  // marker doc ของรอบอื่น: ไม่ใช่ของรอบนี้ → ไม่แตะ · เศษ item รอบอื่น (doc id = SKU ใช้ร่วมทุกรอบ) → ไม่ใช่ของรอบนี้ ไม่ลบ ไม่ abort
  await prime(app.page);
  await app.page.evaluate(() => {
    window.__store['stock_sessions/SRC_pharmacy_audit_markers'].countResetAt = 'E0';
    window.__store['stock_sessions/SRC/items/SA1'] = { sku: 'SA1', countResetAt: 'E0', status: 'pass', rev: 9 };
  });
  await app.page.evaluate(() => restartPharmacyScan('SA1'));
  c = await cloud(app.page);
  expect(c.ops).toEqual([]);                                       // ไม่มีอะไรของรอบนี้ให้ลบ
  expect(c.store[ITEMS + 'SA1']).toMatchObject({ countResetAt: 'E0', rev: 9 });
  expect(c.store['stock_sessions/SRC_pharmacy_audit_markers'].items.SA1).toBeDefined();
  expect((await local(app.page, 'SA1')).status).toBe('pending');
  await closeApp(app);
});

test('★ ล้ม/abort = ไม่เปลี่ยนอะไรเลย (local + Cloud) · busy ถูกปล่อย กดใหม่ได้ · เครื่องอื่นแก้ระหว่างทาง = ไม่ลบทับ', async ({ browser }) => {
  const app = await bootBare(browser);
  await prime(app.page);
  const before = await cloud(app.page);

  // transaction ล้ม (ออฟไลน์/หมดเวลา) → local และ Cloud เท่าเดิม · toast error
  await app.page.evaluate(() => { window.__fail = 'deadline-exceeded'; });
  await app.page.evaluate(() => restartPharmacyScan('SA1'));
  let c = await cloud(app.page);
  expect(c.store).toEqual(before.store);
  expect(c.ops).toEqual([]);
  await untouched(app.page, 'SA1');
  expect(await app.page.evaluate(() => Object.keys(_pharmacyAuditMarkerData.items))).toEqual(['SA1', 'SA2']);
  expect((await toasts(app.page))[0]).toMatch(/^error\|สแกนใหม่ไม่สำเร็จ: /);
  expect(await app.page.evaluate(() => _restartScanBusy.size)).toBe(0);

  // เครื่องอื่นเปลี่ยนรายการนี้แล้ว (ไม่ใช่ Stock Adj / rev ต่าง) → abort ไม่ลบทับ
  for (const patch of [{ status: 'pass' }, { rev: 4 }]) {
    await app.page.evaluate((patch) => { window.__fail = null; window.__toasts.length = 0; Object.assign(window.__store['stock_sessions/SRC/items/SA1'], patch); }, patch);
    await app.page.evaluate(() => restartPharmacyScan('SA1'));
    c = await cloud(app.page);
    expect(c.ops, JSON.stringify(patch)).toEqual([]);
    expect(c.store[ITEMS + 'SA1'], JSON.stringify(patch)).toBeDefined();
    expect(c.store['stock_sessions/SRC_pharmacy_audit_markers'].items.SA1, JSON.stringify(patch)).toBeDefined();
    await untouched(app.page, 'SA1');
    expect(await toasts(app.page), JSON.stringify(patch)).toEqual(['warn|รายการนี้เปลี่ยนจากเครื่องอื่น — ยังไม่ล้างผล รอ Sync แล้วกดใหม่']);
    await app.page.evaluate(() => { Object.assign(window.__store['stock_sessions/SRC/items/SA1'], { status: 'stock_adjustment', rev: 3 }); });
  }

  // rev ที่เครื่องนี้ไม่รู้จัก (0) → ไม่ถือว่าเปลี่ยน · แล้วกดใหม่หลังหายล้มสำเร็จ
  await app.page.evaluate(() => { window.__toasts.length = 0; _scanItemRev.delete('SA1'); window.__store['stock_sessions/SRC/items/SA1'].rev = 9; });
  await app.page.evaluate(() => restartPharmacyScan('SA1'));
  expect((await local(app.page, 'SA1')).status).toBe('pending');
  expect((await cloud(app.page)).store[ITEMS + 'SA1']).toBeUndefined();
  await closeApp(app);
});

test('แก้ที่ยังไม่ flush: ถูกทิ้งไปกับผลนับเดิม · ล้มแล้ว reconcile ส่งซ้ำเอง · เขียนที่เริ่มระหว่างรอ transaction → ให้ flush ลบซ้ำ', async ({ browser }) => {
  const app = await bootBare(browser);
  await prime(app.page);
  // ล้ม: dirty ถูกเอาออก (กัน flush เขียนเอกสารเดิมทับตอนลบ) แต่ reconcile เห็นว่าต่างจากที่ sync แล้วและส่งคืนเอง = ไม่เสียงานที่แก้ไว้
  await app.page.evaluate(() => {
    _dirtySkus.add('SA0'); _scanItemSynced.set('SA0', 'stale-fingerprint'); window.__fail = 'unavailable';
  });
  await app.page.evaluate(() => restartPharmacyScan('SA0'));
  expect(await app.page.evaluate(() => _dirtySkus.has('SA0'))).toBe(false);
  expect(await app.page.evaluate(() => { _reconcileScanItems(); return _dirtySkus.has('SA0'); })).toBe(true);

  // สำเร็จ แต่มีเขียนเริ่มระหว่างรอ transaction → ต้องค้างใน dirty ให้ flush (sd เป็น pending = batch.delete) ลบซ้ำ
  await app.page.evaluate(() => { window.__fail = null; _dirtySkus.clear(); window.__duringTx = () => { _scanItemInFlight.add('SA0'); }; });
  await app.page.evaluate(() => restartPharmacyScan('SA0'));
  expect(await app.page.evaluate(() => [state.scanData.get('SA0').status, _dirtySkus.has('SA0')])).toEqual(['pending', true]);
  // FLUSH_DEL_KEEP_CONFIRMED: เศษที่ฟื้นเป็นของเครื่องนี้เอง → ต้องติดธง "ลบจริง" (มีอายุ) ไม่ให้ flush ถือเป็นผล Confirm ของคนอื่นแล้วรับกลับ
  expect(await app.page.evaluate(() => (_forceDelSkus.get('SA0') || 0) > Date.now())).toBe(true);
  await app.page.evaluate(() => _forceDelSkus.clear());
  // ไม่มีเขียนระหว่างรอ → ไม่ค้าง dirty · ไม่ติดธง
  await prime(app.page);
  await app.page.evaluate(() => restartPharmacyScan('SA0'));
  expect(await app.page.evaluate(() => _dirtySkus.has('SA0'))).toBe(false);
  expect(await app.page.evaluate(() => _forceDelSkus.has('SA0'))).toBe(false);
  await closeApp(app);
});

test('guards: role · สาขา · PDA · Confirm lock · ออนไลน์ · สถานะ · ยกเลิก confirm · เขียนค้างอยู่ · กดซ้ำ — ไม่มี transaction / ไม่เปลี่ยน local', async ({ browser }) => {
  const app = await bootBare(browser);
  const run = async (setup, sku = 'SA0') => {
    await prime(app.page);
    await app.page.evaluate(setup);
    await app.page.evaluate((s) => restartPharmacyScan(s), sku);
    return { c: await cloud(app.page), t: await toasts(app.page) };
  };
  const refuse = (r, toastText, confirms = 0) => { expect(r.c.tx).toBe(0); expect(r.c.ops).toEqual([]); expect(r.c.confirms).toBe(confirms); expect(r.t).toEqual(toastText ? [toastText] : []); };

  refuse(await run(() => { currentRole = 'assistant'; }), 'warn|เฉพาะเภสัชกรเท่านั้น');
  await untouched(app.page);
  refuse(await run(() => { currentBranch = 'WH'; }), 'warn|เฉพาะเภสัชกรเท่านั้น');
  refuse(await run(() => { _isPdaApp = () => true; }), 'warn|สแกนใหม่ที่ Desktop เท่านั้น');
  refuse(await run(() => { _branchScanPaused = true; }), 'warn|กำลัง Confirm ที่ Desktop — รอสักครู่');   // Confirm lock จากอีกเครื่อง
  await untouched(app.page);
  refuse(await run(() => { _branchConfirming = true; }), null);
  refuse(await run(() => { _db = null; }), 'error|ต้องออนไลน์เพื่อสแกนใหม่');
  refuse(await run(() => { Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false }); }), 'error|ต้องออนไลน์เพื่อสแกนใหม่');
  await app.page.evaluate(() => { delete navigator.onLine; });
  for (const sku of ['PS0', 'AU0', 'SC0', 'PE0', 'NOPE']) refuse(await run(() => {}, sku), 'warn|รายการนี้สแกนใหม่ไม่ได้');
  expect((await local(app.page, 'AU0')).status).toBe('audit');   // ไม่ใช่ Stock Adj = ไม่ถูกแตะ (ปุ่มนี้ไม่ใช่ทางของ "รอรีเช็ค")
  refuse(await run(() => { window.__confirmAnswer = false; }), null, 1);                       // ผู้ใช้กดยกเลิก
  await untouched(app.page);
  refuse(await run(() => { _scanItemInFlight.add('SA0'); }), 'warn|กำลังบันทึกรายการนี้ — รอสักครู่แล้วกดใหม่', 1);   // กำลังเขียนอยู่

  // กดซ้ำระหว่างรอ transaction → ครั้งที่สองถูกทิ้งเงียบ (confirm/transaction เกิดครั้งเดียว)
  await prime(app.page);
  await app.page.evaluate(() => Promise.all([restartPharmacyScan('SA0'), restartPharmacyScan('SA0')]));
  const c = await cloud(app.page);
  expect([c.tx, c.confirms]).toEqual([1, 1]);
  expect((await local(app.page, 'SA0')).status).toBe('pending');
  await closeApp(app);
});

test('ข้อความช่วยเหลือ: สวิตช์เปิด = ↺ → ⏳ รอนับ → ผู้ช่วยนับใหม่ · ปิดสวิตช์/ปิดสวิตช์คำ/WH = ข้อความเดิมทุกตัวอักษร', async ({ browser }) => {
  const app = await bootBare(browser);
  const texts = () => app.page.evaluate(() => { applyAuditTerminology(); return { step6: document.getElementById('guideStep6').innerHTML, desc: document.getElementById('guideAuditDesc').textContent, guide: guideHtml(false) }; });
  const OLD6 = 'รายการ <strong style="color:var(--red);">⚠️ Stock Adj</strong> (รวม <strong style="color:var(--yellow);">รอรีเช็ค</strong>) → เภสัชออกใบที่ <strong>📦 ปรับปรุงสินค้า</strong> (แก้จำนวนในใบได้) · สงสัยรายการไหน กด <strong>↺ สแกนใหม่</strong> (Desktop) → <strong style="color:var(--yellow);">รอรีเช็ค</strong> → สแกนนับใหม่ → กด <strong>✓ ยืนยันรีเช็ค</strong> บน Desktop';
  const OLD_DESC = 'Stock Adj ที่เภสัชกด ↺ (หรือค้างจากรอบก่อน) — ขึ้นใบ 📦 แล้ว · สแกนนับใหม่แล้วยืนยันบน Desktop เพื่อปรับผล';

  await prime(app.page);
  let t = await texts();
  expect(t.step6).toContain('กด <strong>↺ สแกนใหม่</strong> (Desktop) → <strong>⏳ รอนับ</strong> → ผู้ช่วยสแกนนับใหม่ → กด <strong>Confirm</strong> บน Desktop');
  expect(t.step6).not.toContain('✓ ยืนยันรีเช็ค');
  expect(t.desc).toBe('Stock Adj ที่ค้างจากรอบก่อน — ขึ้นใบ 📦 แล้ว · สแกนนับใหม่แล้วยืนยันบน Desktop เพื่อปรับผล');   // รอรีเช็คตอนนี้ไม่ได้มาจาก ↺ แล้ว
  expect(t.guide).toContain('กด ↺ สแกนใหม่ แล้วให้ผู้ช่วยนับใหม่)');
  expect(t.guide).not.toContain('แล้วรีเช็ค)');
  for (const s of [t.step6, t.desc]) expect(s).not.toMatch(/Audit/);   // สาขายาไม่มีคำว่า Audit บนจอ

  await prime(app.page, { rescan: false });
  t = await texts();
  expect(t.step6).toBe(OLD6);
  expect(t.desc).toBe(OLD_DESC);
  expect(t.guide).toContain('กด ↺ สแกนใหม่ แล้วรีเช็ค)');
  expect(t.guide).not.toContain('แล้วให้ผู้ช่วยนับใหม่');

  // ปิดสวิตช์คำ (PHARMACY_RECHECK_TERMS) = ข้อความ Audit เดิม ไม่ว่าสวิตช์ใหม่จะเปิดอยู่
  await prime(app.page, { terms: false });
  t = await texts();
  expect(t.step6).toBe('รายการ <strong style="color:var(--yellow);">⚠️ Audit</strong> → เภสัชเปิด <strong>Audit Verify</strong> → สแกนนับซ้ำ → กด <strong>ยืนยันทั้งหมด</strong>');
  expect(t.desc).toBe('จำนวนไม่ตรง — รอเภสัชตรวจซ้ำใน Audit Verify');

  // WH ไม่ถูกแตะ
  await prime(app.page, { branch: 'WH', role: 'supervisor' });
  t = await texts();
  expect(t.step6).toBe('รายการ <strong style="color:var(--yellow);">⚠️ Recheck</strong> → <strong>warehouse</strong> สแกนรีเช็คที่ช่อง scan หลัก → <strong>หัวหน้างาน</strong>กด <strong>✓ ยืนยันรีเช็ค</strong> บน Desktop');
  expect(t.desc).toBe('จำนวนไม่ตรง — รอ warehouse รีเช็ค + หัวหน้างานยืนยันรีเช็ค');
  await closeApp(app);
});
