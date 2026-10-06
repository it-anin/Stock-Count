// marker เภสัชพาธง directAdj (ต.ค. 2026) — รองรับการแปลง Audit ค้างเป็น Stock Adj ตรง (tools/convert-legacy-pharmacy-audits.js)
// + ↺ สแกนใหม่ ใช้กับ 🚫 ไม่มีของ (noStock · สวิตช์ PHARMACY_NOSTOCK_REOPEN)
//
// marker เป็น authoritative และถูก apply ซ้ำทุก snapshot → ผลแปลงต้องอยู่ใน marker ทั้งชุด ไม่งั้นกลับเป็น Audit / ใบคิดผิดสูตร
//   R1 _writePharmacyAuditMarkers: marker ผลแปลงห้ามถูกดันกลับโดย audit/pass ที่ไม่ใช่ final (R16 อัปซ้ำ · backfill จากเครื่องค้าง)
//      เปลี่ยนได้เฉพาะ ↺ (reopenedAt) · ผลยืนยันจริง (final) · ย้อนการแปลง (convertUndoneAt)
//   R2 _applyPharmacyAuditMarkersToState: ตั้ง/ล้าง sd.directAdj ตาม marker · same ต้องเห็นธง
//   R3 ↺ / ผลยืนยัน ส่ง directAdj:false (marker merge {...existing,...marker} ไม่งั้นธงค้าง)
// ★ ด้านที่สำคัญที่สุด: marker เก่าไม่มี field นี้ → ผลเท่าเดิมทุกกรณี
const { test, expect, bootBare, closeApp } = require('../../lib/hooks');

const E = 'E1';
const T0 = '2026-09-20T03:00:00.000Z';   // Confirm เดิม (Audit)
const T1 = '2026-10-06T10:00:00.000Z';   // แปลง
const T2 = '2026-10-06T11:00:00.000Z';   // หลังแปลง

// marker Audit ค้างแบบที่ _pharmacyAuditMarkerFromCountResult เขียน (นับ 10 + R16 ขาย 2 = 12 · ระบบ 15)
const AUDIT_MARKER = { countResetAt: E, status: 'audit', auditStatus: 'pending', initialStatus: 'audit', auditor: '', countedQty: 10, scannedBy: 'A',
  countTimestamp: '2026-09-20 09:00:00', timestamp: '2026-09-20 09:00:00', firstScanAt: '2026-09-20 09:00:00', soldQty: 2, inboundQty: 0, r16103Qty: 0,
  effectiveQty: 12, systemQty: 15, countConfirmedAt: T0, confirmedAt: T0, confirmedBy: 'Desk' };
const CONVERTED = { ...AUDIT_MARKER, status: 'stock_adjustment', auditStatus: 'stock_adjustment', initialStatus: 'stock_adjustment', directAdj: true,
  countConfirmedAt: T1, confirmedAt: T1, confirmedBy: 'Pharm', convertedFromAuditAt: T1, convertedBy: 'Pharm', origCountConfirmedAt: T0 };

// สาขา SRC + SKU S1 (ยอดระบบสด 9 — ต่างจากตอน Confirm โดยเจตนา) + sd ตามที่ส่งมา + marker ในหน่วยความจำ
async function prime(page, { sd, marker }) {
  await page.evaluate(({ E, sd, marker }) => {
    currentBranch = 'SRC'; currentRole = 'pharmacist'; currentUser = 'Pharm'; _countResetAt = E;
    state.skuMap.clear(); state.scanData.clear(); scanListMap.clear();
    state.skuMap.set('S1', { sku: 'S1', productName: 'x', unitPrice: 20, systemQty: 9, negSys: false, barcodes: [], isDel: false });
    if (sd) state.scanData.set('S1', sd);
    _pharmacyAuditMarkerData = { branch: 'SRC', countResetAt: E, items: marker ? { S1: marker } : {} };
  }, { E, sd, marker });
}
const snap = (page) => page.evaluate(() => {
  const s = state.scanData.get('S1');
  return { status: s.status, initialStatus: s.initialStatus, directAdj: s.directAdj, eff: s.effectiveQty, sys: s.systemQty, auditor: s.auditor,
    rq: s.recheckQty, pair: _directAdjPair(s), ords: _buildAdjustDocRows('ords').map((r) => [r.sku, r.qty]) };
});

// _db ปลอมเฉพาะ transaction ของ marker doc — พอสำหรับ _writePharmacyAuditMarkers
async function fakeMarkerDb(page, doc) {
  await page.evaluate((doc) => {
    window.__markerDoc = doc;
    const ref = { id: 'SRC_pharmacy_audit_markers' };
    _db = {
      collection: () => ({ doc: () => ref }),
      runTransaction: async (fn) => fn({
        get: async () => ({ exists: !!window.__markerDoc, data: () => JSON.parse(JSON.stringify(window.__markerDoc)) }),
        set: (_r, d) => { window.__markerDoc = JSON.parse(JSON.stringify({ ...d, updatedAt: 'ts' })); },
      }),
    };
  }, doc);
}
const writeMarkers = (page, markers) => page.evaluate(async (markers) => {
  await _writePharmacyAuditMarkers(markers);
  const m = window.__markerDoc.items.S1;
  return { status: m.status, directAdj: m.directAdj, auditor: m.auditor || '', reopenedAt: m.reopenedAt || '', countConfirmedAt: m.countConfirmedAt };
}, markers);

test('R2: marker ผลแปลง → sd เป็น Stock Adj ตรง (ธง + คู่แช่) · ใบใช้คู่แช่ ไม่ใช่ยอดสด · apply ซ้ำไม่วน', async ({ browser }) => {
  const app = await bootBare(browser);
  await prime(app.page, { sd: { status: 'audit', auditStatus: 'pending', initialStatus: 'audit', auditor: '', countedQty: 10, timestamp: '2026-09-20 09:00:00',
    pharmacyAuditMarkerAt: T0, pharmacyAuditCountConfirmedAt: T0 }, marker: CONVERTED });
  const changed = await app.page.evaluate(() => _applyPharmacyAuditMarkersToState());
  expect(changed).toEqual(['S1']);
  expect(await snap(app.page)).toEqual({ status: 'stock_adjustment', initialStatus: 'stock_adjustment', directAdj: true, eff: 12, sys: 15, auditor: '',
    rq: undefined, pair: { sys: 15, cnt: 12 }, ords: [['S1', 3]] }); // 15 − 12 = ขาด 3 (ยอดสด 9 ไม่เกี่ยว)
  expect(await app.page.evaluate(() => _applyPharmacyAuditMarkersToState())).toEqual([]); // same → ไม่ apply ซ้ำทุก snapshot

  // echo ของ item doc ที่ไม่มีธง (เครื่องรุ่นเก่าเขียน) แต่ markerAt เท่ากัน → ต้องไม่นับว่า "เหมือน" แล้วคืนธงให้
  const restored = await app.page.evaluate(() => { delete state.scanData.get('S1').directAdj; return _applyPharmacyAuditMarkersToState(); });
  expect(restored).toEqual(['S1']);
  expect((await snap(app.page)).directAdj).toBe(true);
  await closeApp(app);
});

test('R2: marker ส่ง directAdj:false (↺ / ผลยืนยัน) → ล้างธงใน sd', async ({ browser }) => {
  const app = await bootBare(browser);
  await prime(app.page, { sd: { status: 'stock_adjustment', auditStatus: 'stock_adjustment', initialStatus: 'stock_adjustment', auditor: '', directAdj: true,
    effectiveQty: 12, systemQty: 15, countedQty: 10, timestamp: '2026-09-20 09:00:00', pharmacyAuditMarkerAt: T1 },
    marker: { ...CONVERTED, status: 'audit', auditStatus: 'pending', initialStatus: 'audit', directAdj: false, reopenedAt: T2, countConfirmedAt: T2, confirmedAt: T2 } });
  await app.page.evaluate(() => _applyPharmacyAuditMarkersToState());
  const s = await snap(app.page);
  expect(s).toMatchObject({ status: 'audit', initialStatus: 'audit', directAdj: undefined, pair: null });
  await closeApp(app);
});

test('★ marker เก่าไม่มี field directAdj → ผลเท่าเดิม (ไม่ตั้ง/ไม่ลบธง · same เหมือนเดิม)', async ({ browser }) => {
  const app = await bootBare(browser);
  // audit ค้างธรรมดา
  await prime(app.page, { sd: null, marker: AUDIT_MARKER });
  await app.page.evaluate(() => _applyPharmacyAuditMarkersToState());
  expect(await snap(app.page)).toMatchObject({ status: 'audit', directAdj: undefined, pair: null, ords: [] });
  expect(await app.page.evaluate(() => _applyPharmacyAuditMarkersToState())).toEqual([]);

  // ผลยืนยันเก่า (final ไม่มี directAdj) ทับ sd ที่บังเอิญมีธงค้าง → ไม่แตะธง (พฤติกรรมเดิม — _isDirectAdjItem กันด้วย auditor อยู่แล้ว)
  await prime(app.page, { sd: { status: 'audit', directAdj: true, countedQty: 10, timestamp: 't' },
    marker: { ...AUDIT_MARKER, status: 'stock_adjustment', auditStatus: 'stock_adjustment', auditor: 'Ph', recheckQty: 11, recheckSystemQty: 15 } });
  await app.page.evaluate(() => _applyPharmacyAuditMarkersToState());
  expect(await snap(app.page)).toMatchObject({ status: 'stock_adjustment', directAdj: true, auditor: 'Ph', pair: null });

  // R16 พลิก Audit → Pass (non-final ไม่มี directAdj) → เหมือนเดิม
  await prime(app.page, { sd: null, marker: { ...AUDIT_MARKER, status: 'pass', auditStatus: 'approved', countConfirmedAt: T2, confirmedAt: T2 } });
  await app.page.evaluate(() => _applyPharmacyAuditMarkersToState());
  expect(await snap(app.page)).toMatchObject({ status: 'pass', directAdj: undefined });
  await closeApp(app);
});

test('R1: ผลแปลงไม่ถูกดันกลับโดย audit/pass ที่ไม่ใช่ final · ↺ / ผลยืนยัน / ย้อนการแปลง ยังเปลี่ยนได้', async ({ browser }) => {
  const app = await bootBare(browser);
  await prime(app.page, { sd: null, marker: null });
  const doc = { branch: 'SRC', countResetAt: E, items: { S1: CONVERTED } };

  // backfill จากเครื่องที่ยังถือ audit (เวลาใหม่กว่าเพื่อพิสูจน์ว่ากันด้วย R1 ไม่ใช่ลำดับเวลา) → ทิ้ง
  await fakeMarkerDb(app.page, doc);
  expect(await writeMarkers(app.page, [{ ...AUDIT_MARKER, sku: 'S1', countConfirmedAt: T2, confirmedAt: T2 }]))
    .toMatchObject({ status: 'stock_adjustment', directAdj: true, countConfirmedAt: T1 });
  // reEvaluateAuditItems พลิกเป็น pass (non-final) → ทิ้ง
  expect(await writeMarkers(app.page, [{ ...AUDIT_MARKER, sku: 'S1', status: 'pass', auditStatus: 'approved', countConfirmedAt: T2, confirmedAt: T2 }]))
    .toMatchObject({ status: 'stock_adjustment', directAdj: true });

  // ↺ (reopenedAt + directAdj:false) → ผ่าน และล้างธงใน marker ที่ merge
  expect(await writeMarkers(app.page, [{ sku: 'S1', status: 'audit', auditStatus: 'pending', initialStatus: 'audit', auditor: '', directAdj: false,
    reopenedAt: T2, confirmedAt: T2, countConfirmedAt: T2 }])).toEqual({ status: 'audit', directAdj: false, auditor: '', reopenedAt: T2, countConfirmedAt: T2 });

  // ผลยืนยันจริง (final) ทับผลแปลงได้ · ตัวสร้าง marker ผลยืนยันส่ง directAdj:false
  await fakeMarkerDb(app.page, doc);
  const fin = await app.page.evaluate(({ T2 }) => {
    state.scanData.set('S1', { status: 'audit', recheckQty: 15, recheckAt: T2, recheckSystemQty: 15, timestamp: '2026-09-20 09:00:00' });
    return _pharmacyAuditMarkerFromFinal('S1', state.scanData.get('S1'), T2, '2026-10-06 18:00:00', {});
  }, { T2 });
  expect(fin.directAdj).toBe(false);
  expect(await writeMarkers(app.page, [fin])).toMatchObject({ status: 'pass', directAdj: false, auditor: 'Pharm' });

  // ย้อนการแปลง (convertUndoneAt) → ผ่าน
  await fakeMarkerDb(app.page, doc);
  expect(await writeMarkers(app.page, [{ sku: 'S1', status: 'audit', auditStatus: 'pending', initialStatus: 'audit', auditor: '', directAdj: false,
    convertUndoneAt: T2, countConfirmedAt: T2, confirmedAt: T2 }])).toMatchObject({ status: 'audit', directAdj: false });
  await closeApp(app);
});

test('★ R1 ไม่แตะ marker เดิม: audit ใหม่กว่าทับ audit เก่าได้ · final ชนะ audit เหมือนเดิม', async ({ browser }) => {
  const app = await bootBare(browser);
  await prime(app.page, { sd: null, marker: null });
  await fakeMarkerDb(app.page, { branch: 'SRC', countResetAt: E, items: { S1: AUDIT_MARKER } });
  expect(await writeMarkers(app.page, [{ ...AUDIT_MARKER, sku: 'S1', status: 'pass', auditStatus: 'approved', countConfirmedAt: T2, confirmedAt: T2 }]))
    .toMatchObject({ status: 'pass', countConfirmedAt: T2 });
  await fakeMarkerDb(app.page, { branch: 'SRC', countResetAt: E, items: { S1: { ...AUDIT_MARKER, status: 'stock_adjustment', auditor: 'Ph', confirmedAt: T1 } } });
  expect(await writeMarkers(app.page, [{ ...AUDIT_MARKER, sku: 'S1', countConfirmedAt: T2, confirmedAt: T2 }]))
    .toMatchObject({ status: 'stock_adjustment', auditor: 'Ph' });
  await closeApp(app);
});

// ↺ บน Desktop — ตัด side effect ที่ต้องใช้ Firestore จริงออก แล้วดูเฉพาะการตัดสิน + payload ของ marker
async function reopen(page, { sd, noStockSwitch = true }) {
  return page.evaluate(async ({ sd, noStockSwitch }) => {
    PHARMACY_NOSTOCK_REOPEN = noStockSwitch;
    state.scanData.set('S1', sd);
    const written = []; const toasts = [];
    _writePharmacyAuditMarkers = async (m) => { written.push(...m); return {}; };
    syncToFirestore = async () => true; saveSession = () => {}; _markSkuDirty = () => {};
    const realToast = window.toast, realConfirm = window.confirm;
    window.toast = (m) => toasts.push(String(m)); window.confirm = () => true;
    try { await reopenPharmacyAudit('S1'); } finally { window.toast = realToast; window.confirm = realConfirm; }
    const s = state.scanData.get('S1');
    return { status: s.status, initialStatus: s.initialStatus, directAdj: s.directAdj, toasts, marker: written[0] || null };
  }, { sd, noStockSwitch });
}
const NOSTOCK_ADJ = { status: 'stock_adjustment', auditStatus: 'stock_adjustment', initialStatus: 'stock_adjustment', noStock: true, countedQty: 0,
  timestamp: '2026-10-01 10:00:00', firstScanAt: '2026-10-01 10:00:00', scannedBy: 'A' };

test('↺ ใช้กับ 🚫 ไม่มีของ (noStock) ได้ · marker ส่ง directAdj:false · สวิตช์ปิด = ปฏิเสธเหมือนเดิม · pass ปกติยังเปิดไม่ได้', async ({ browser }) => {
  const app = await bootBare(browser);
  await prime(app.page, { sd: null, marker: null });

  const on = await reopen(app.page, { sd: { ...NOSTOCK_ADJ } });
  expect(on).toMatchObject({ status: 'audit', initialStatus: 'audit', directAdj: undefined });
  expect(on.marker).toMatchObject({ sku: 'S1', status: 'audit', initialStatus: 'audit', directAdj: false, reopenedAt: expect.any(String) });

  const off = await reopen(app.page, { sd: { ...NOSTOCK_ADJ }, noStockSwitch: false });
  expect(off).toMatchObject({ status: 'stock_adjustment', marker: null, toasts: ['รายการนี้เปิดรีเช็คใหม่ไม่ได้'] });

  // pass ที่นับตรงตั้งแต่รอบแรก — ไม่เคยไม่ตรง → ย้อนไม่ได้ (ทั้งเปิด/ปิดสวิตช์)
  const pass = await reopen(app.page, { sd: { status: 'pass', auditStatus: 'approved', initialStatus: 'pass', countedQty: 5, timestamp: 't', noStock: true } });
  expect(pass).toMatchObject({ status: 'pass', marker: null });

  // Stock Adj ตรง (directAdj) ยังเปิดได้ และ marker ล้างธง
  const direct = await reopen(app.page, { sd: { status: 'stock_adjustment', auditStatus: 'stock_adjustment', initialStatus: 'stock_adjustment', directAdj: true,
    effectiveQty: 12, systemQty: 15, countedQty: 10, timestamp: 't' } });
  expect(direct).toMatchObject({ status: 'audit', directAdj: undefined });
  expect(direct.marker.directAdj).toBe(false);
  await closeApp(app);
});
