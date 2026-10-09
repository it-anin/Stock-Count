// สาขายา (SRC/KKL/SSS) ตัดขั้น Audit — Confirm รอบแรกไม่ตรง → stock_adjustment ทันที (ก.ย. 2026 · ผู้ใช้สั่ง)
//
// รายการที่ออกทางนี้ติด directAdj:true + แช่ effectiveQty/systemQty ณ ตอน Confirm
// ใบปรับสต็อกคิดจากคู่นั้น (effectiveQty − systemQty) ไม่ใช่ countedQty − ยอดสด:
//   countedQty เป็นยอดดิบ (ไม่รวม R16 ชดเชย) และเทียบข้ามเวลากับ R01 วันถัดไป
//
// เทสนี้ตรึง 4 ด้าน — ด้านที่ 4 สำคัญที่สุด เพราะกติกาใหม่ต้องไม่ลามไปที่อื่น:
//   1. ตัวตัดสินรอบแรก: สาขายาไม่ตรง → Stock Adj ตรง · ตรง → pass · WH/สวิตช์ปิด → audit เหมือนเดิม
//   2. ทุกจุดที่แสดง/ส่งออก Stock Adj ใช้คู่ที่แช่ไว้ชุดเดียวกัน และไม่ขยับเมื่อ R01 ใหม่เข้า
//   3. บาร์ "เภสัชตรวจแล้ว X/Y" ต้องไม่นับรายการที่ไม่มีเภสัชแตะ
//   4. ★ ของเดิมไม่เปลี่ยน: Audit เดิม · Stock Adj ที่ผ่าน Audit · noStock · reEvaluateAuditItems
const { test, expect, bootBare, closeApp } = require('../../lib/hooks');

// ── ตัวตัดสินรอบแรก ───────────────────────────────────────────────────────────
async function decide(page, o) {
  return page.evaluate(({ branch, sys, counted, sold, inbound, noStock, directOn }) => {
    currentBranch = branch;
    PHARMACY_DIRECT_STOCK_ADJ = directOn;
    state.skuMap.clear(); state.scanData.clear(); scanListMap.clear();
    state.skuMap.set('S1', { sku: 'S1', productName: 'x', unitPrice: 20, systemQty: sys, negSys: false, barcodes: [], isDel: false });
    // rawMap ว่าง → getSoldQtyBefore/getInboundQtyBefore ตกไปใช้ aggregate map (เส้นทางเดียวกับ negsys-pass.spec.js)
    state.r16InboundRawMap.clear(); state.r16InboundMap.clear();
    state.r16RawMap.clear(); state.r16SalesMap.clear();
    state.r16_103Map.clear(); state.r16_103RawMap.clear();
    if (sold) state.r16SalesMap.set('S1', sold);
    if (inbound) state.r16InboundMap.set('S1', inbound);
    const sd = { status: 'scanning', countedQty: counted, timestamp: '2026-08-27 10:00:00', scannedBy: 'T', ...(noStock ? { noStock: true } : {}) };
    state.scanData.set('S1', sd);
    const out = _buildPendingScanEvaluation('S1', sd);
    _applyPendingScanEvaluation(out);
    const a = state.scanData.get('S1');
    PHARMACY_DIRECT_STOCK_ADJ = true;
    return {
      status: out.status, direct: out.direct,
      sd: { status: a.status, auditStatus: a.auditStatus, initialStatus: a.initialStatus, directAdj: a.directAdj, effectiveQty: a.effectiveQty, systemQty: a.systemQty },
    };
  }, { branch: 'SRC', sys: 10, counted: 10, sold: 0, inbound: 0, noStock: false, directOn: true, ...o });
}

test('สาขายา: ไม่ตรง → stock_adjustment ทันที พร้อมแช่คู่ effectiveQty/systemQty · ตรง → pass', async ({ browser }) => {
  const app = await bootBare(browser);

  // ระบบ 15 · นับ 10 · R16 ขายก่อนสแกน 2 → effective 12 ≠ 15 (ขาด 3)
  for (const branch of ['SRC', 'KKL', 'SSS']) {
    const r = await decide(app.page, { branch, sys: 15, counted: 10, sold: 2 });
    expect(r.status, branch).toBe('stock_adjustment');
    expect(r.direct, branch).toBe(true);
    expect(r.sd, branch).toEqual({
      status: 'stock_adjustment', auditStatus: 'stock_adjustment', initialStatus: 'stock_adjustment',
      directAdj: true, effectiveQty: 12, systemQty: 15,
    });
  }

  // ตรงพอดีหลังชดเชย R16: 13 + 2 = 15 → pass · ไม่ติดธง ไม่แช่ค่า
  const ok = await decide(app.page, { sys: 15, counted: 13, sold: 2 });
  expect(ok.status).toBe('pass');
  expect(ok.sd.directAdj).toBeUndefined();
  expect(ok.sd.effectiveQty).toBeUndefined();

  await closeApp(app);
});

test('กลุ่ม G≤0 ก็ไม่ผ่าน Audit แล้ว (ตามคำสั่ง — ย้อนกติกา ก.ค. 2026): ติดลบที่อธิบายไม่ได้ · ระบบ 0 แต่ยิงเจอของ', async ({ browser }) => {
  const app = await bootBare(browser);

  // ติดลบ −2 ไม่มีรับเข้ามาอธิบาย นับ 0 → 0 ≠ −2
  const neg = await decide(app.page, { sys: -2, counted: 0 });
  expect(neg.status).toBe('stock_adjustment');
  expect(neg.sd).toMatchObject({ directAdj: true, effectiveQty: 0, systemQty: -2 });

  // ระบบ 0 ยิงเจอ 1 → effective 1 ≠ 0
  const zero = await decide(app.page, { sys: 0, counted: 1 });
  expect(zero.status).toBe('stock_adjustment');
  expect(zero.sd).toMatchObject({ directAdj: true, effectiveQty: 1, systemQty: 0 });

  // ★ ติดลบที่ R16 อธิบายได้พอดียังเป็น pass (สูตรเดิมไม่ถูกแตะ)
  const explained = await decide(app.page, { sys: -2, counted: 3, inbound: 5 });
  expect(explained.status).toBe('pass');

  await closeApp(app);
});

test('★ ของเดิมไม่เปลี่ยน: WH ยังเป็น audit · สวิตช์ปิดกลับไปทางเก่า · noStock ไม่ติด directAdj', async ({ browser }) => {
  const app = await bootBare(browser);

  // WH ต้องคง audit — evaluatePendingScans ยังถูกเรียกจากทางที่ไม่ใช่สาขายา
  const wh = await decide(app.page, { branch: 'WH', sys: 15, counted: 10, sold: 2 });
  expect(wh.status).toBe('audit');
  expect(wh.direct).toBe(false);
  expect(wh.sd.directAdj).toBeUndefined();
  expect(wh.sd.auditStatus).toBe('pending');

  // สวิตช์ปิด = ทางเก่าทุกประการ (rollback = ตั้ง false แล้ว deploy)
  const off = await decide(app.page, { sys: 15, counted: 10, sold: 2, directOn: false });
  expect(off.status).toBe('audit');
  expect(off.sd.directAdj).toBeUndefined();

  // noStock (ผู้ช่วยกด 🚫 ชั้นว่าง) → stock_adjustment เดิม · ไม่ติด directAdj → ใบใช้กติกาเดิม (ค่าสด + ด่านความสด)
  const ns = await decide(app.page, { sys: 5, counted: 0, noStock: true });
  expect(ns.status).toBe('stock_adjustment');
  expect(ns.direct).toBe(false);
  expect(ns.sd.directAdj).toBeUndefined();
  expect(ns.sd.effectiveQty).toBeUndefined();

  await closeApp(app);
});

// ── ใบปรับสต็อกและทุกจุดที่แสดง Stock Adj ─────────────────────────────────────
async function seedAdj(page) {
  await page.evaluate(() => {
    currentBranch = 'SRC'; currentRole = 'pharmacist'; currentUser = 'Pharm';
    state.skuMap.clear(); state.scanData.clear(); state.skuDirectMap.clear(); scanListMap.clear();
    const sku = (id, live) => {
      state.skuMap.set(id, { sku: id, productName: 'สินค้า ' + id, unitPrice: 20, systemQty: live, negSys: false, barcodes: [], isDel: false });
      state.skuDirectMap.set(id, { barcode: 'B' + id, unitName: 'เม็ด' });
    };
    const base = { auditStatus: 'stock_adjustment', timestamp: '2026-09-29 10:00:00', firstScanAt: '2026-09-29 10:00:00', scannedBy: 'Asst' };
    // Confirm ตอนระบบ 15 · นับ 10 + R16 ขาย 2 = effective 12 (ขาด 3) · วันถัดไป R01 ใหม่ทำให้ยอดสดเหลือ 11
    // สูตรเดิม (countedQty − ยอดสด) จะได้ 10−11 = −1 ซึ่งผิด — ที่ถูกคือ 12−15 = −3
    sku('DIR-SHORT', 11);
    state.scanData.set('DIR-SHORT', { ...base, status: 'stock_adjustment', initialStatus: 'stock_adjustment', countedQty: 10, directAdj: true, effectiveQty: 12, systemQty: 15 });
    // เกิน: Confirm ตอนระบบ 4 · effective 9 → +5 · ยอดสดตอนนี้ 3
    sku('DIR-OVER', 3);
    state.scanData.set('DIR-OVER', { ...base, status: 'stock_adjustment', initialStatus: 'stock_adjustment', countedQty: 9, directAdj: true, effectiveQty: 9, systemQty: 4 });
    // ★ ผ่าน Audit เดิม: ยอดรีเช็ค 1 · freeze 2 · สด 2 → ORDS 1 (ค่าสด + ด่านความสด เหมือนเดิม)
    sku('LEGACY', 2);
    state.scanData.set('LEGACY', { ...base, status: 'stock_adjustment', initialStatus: 'audit', countedQty: 5, recheckQty: 1, recheckBy: 'Pharm', recheckAt: '2026-09-29T03:00:00.000Z', recheckSystemQty: 2, auditor: 'Pharm' });
    // ★ noStock: ไม่มี directAdj → ORDS ตามยอดสด
    sku('NOSTOCK', 5);
    state.scanData.set('NOSTOCK', { ...base, status: 'stock_adjustment', initialStatus: 'stock_adjustment', countedQty: 0, noStock: true });
  });
}

test('ใบ ORDS/IRPS ของ Stock Adj ตรงคิดจากคู่ที่แช่ไว้ — ไม่ขยับตาม R01 ใหม่ · ของเดิมได้ตัวเลขเดิม', async ({ browser }) => {
  const app = await bootBare(browser);
  await seedAdj(app.page);
  const r = await app.page.evaluate(() => {
    const a = _adjustDocAudit();
    return {
      ords: _buildAdjustDocRows('ords').map((x) => [x.sku, x.qty]),
      irps: _buildAdjustDocRows('irps').map((x) => [x.sku, x.qty]),
      badge: _countAdjustDocItems(),
      stale: a.stale.map((x) => x.sku), settled: a.settled.map((x) => x.sku), noSku: a.noSku.map((x) => x.sku),
    };
  });

  expect(r.ords).toEqual([['DIR-SHORT', 3], ['LEGACY', 1], ['NOSTOCK', 5]]);   // DIR-SHORT = 15−12 ไม่ใช่ |10−11|
  expect(r.irps).toEqual([['DIR-OVER', 5]]);                                   // 9−4
  expect(r.badge).toBe(4);                                                     // ปุ่มนับทุก stock_adjustment
  expect(r.stale).toEqual([]);                                                 // ★ Stock Adj ตรงไม่มีวัน "หมดอายุ"
  expect(r.settled).toEqual([]);
  expect(r.noSku).toEqual([]);

  await closeApp(app);
});

test('ทุกจุดที่แสดง Stock Adj (ประวัติ · Audit Verify · Export) ใช้คู่เดียวกับใบ', async ({ browser }) => {
  const app = await bootBare(browser);
  await seedAdj(app.page);
  const r = await app.page.evaluate(() => {
    const rows = (sel) => [...document.querySelectorAll(`${sel} tr`)].map((tr) => [...tr.children].map((td) => td.textContent.trim().replace(/\s+/g, ' ')));
    const byName = (list, id) => list.find((c) => c.includes('สินค้า ' + id));
    _hsFilter = 'stockadj'; renderHistoryStatsTable();
    const hist = rows('#historyStatsBody');
    _avFilter = 'stock_adj'; renderAuditVerifyTable();
    const av = rows('#auditVerifyTableBody');
    let sheet = null;
    const orig = XLSX.writeFile;
    XLSX.writeFile = (wb) => { sheet = XLSX.utils.sheet_to_json(wb.Sheets.StockAdj, { header: 1 }); };
    try { exportStockAdjExcel(); } finally { XLSX.writeFile = orig; }
    return { hist: byName(hist, 'DIR-SHORT'), histLegacy: byName(hist, 'LEGACY'), av: byName(av, 'DIR-SHORT'), avLegacy: byName(av, 'LEGACY'), sheet };
  });

  // ประวัติ: [#, SKU, Barcode, Name, หน่วย, จำนวนคงเหลือ, จำนวนปรับปรุง, Diff]
  expect(r.hist.slice(5)).toEqual(['15', '12', '-3']);
  expect(r.histLegacy.slice(5)).toEqual(['2', '1', '-1']);            // ของเดิม: ยอดสด 2 · รีเช็ค 1
  // Audit Verify แท็บ Stock Adj: [#, SKU, Barcode, Name, Sys Qty, Recheck Qty, Diff, เวลานับ, แก้ไข]
  expect(r.av[4]).toContain('15');
  expect(r.av[4]).toContain('(จากวันที่อัป R01)');                     // ยอดสด 11 ≠ ฐาน 15 → มีป้ายบอกที่มา
  expect(r.av[5]).toBe('12');
  expect(r.av[6]).toBe('-3');
  expect(r.av[8]).toContain('สแกนใหม่');                              // ↺ ต้องมีให้ Stock Adj ตรงด้วย = ทางถอย
  expect(r.avLegacy[5]).toBe('1');
  // Export: [Location, SKU, Barcode, Name, หน่วย, จำนวนคงเหลือ, จำนวนปรับปรุง, Diff, พนักงานที่สแกน, เวลา]
  const ex = Object.fromEntries(r.sheet.slice(1).map((row) => [row[1], row.slice(5, 8)]));
  expect(ex['DIR-SHORT']).toEqual([15, 12, -3]);
  expect(ex['DIR-OVER']).toEqual([4, 9, 5]);
  expect(ex['LEGACY']).toEqual([2, 1, -1]);

  await closeApp(app);
});

test('_isDirectAdjItem — ต้องครบทุกเงื่อนไข ไม่งั้นถอยไปกติกาเดิม (ห้ามเป็น NaN)', async ({ browser }) => {
  const app = await bootBare(browser);
  const r = await app.page.evaluate(() => {
    const ok = { status: 'stock_adjustment', directAdj: true, effectiveQty: 12, systemQty: 15 };
    return {
      ok: _isDirectAdjItem(ok),
      noFlag: _isDirectAdjItem({ ...ok, directAdj: undefined }),
      noPair: _isDirectAdjItem({ status: 'stock_adjustment', directAdj: true, countedQty: 2 }),
      nan: _isDirectAdjItem({ ...ok, effectiveQty: NaN }),
      verified: _isDirectAdjItem({ ...ok, auditor: 'Pharm' }),          // ผ่านมือเภสัชแล้ว = ไม่ใช่ direct อีก
      notAdj: _isDirectAdjItem({ ...ok, status: 'pass' }),
      pair: _directAdjPair(ok), pairNull: _directAdjPair({ status: 'audit' }),
      // "ไม่ตรงตั้งแต่รอบแรก" = Audit เดิม หรือ Stock Adj ตรง — noStock/pass ไม่ใช่
      mismatch: [
        _wasFirstCountMismatch({ initialStatus: 'audit' }), _wasFirstCountMismatch(ok),
        _wasFirstCountMismatch({ initialStatus: 'stock_adjustment', noStock: true }), _wasFirstCountMismatch({ initialStatus: 'pass' }),
        _wasFirstCountMismatch(null),
      ],
    };
  });
  expect(r).toEqual({
    ok: true, noFlag: false, noPair: false, nan: false, verified: false, notAdj: false,
    pair: { sys: 15, cnt: 12 }, pairNull: null, mismatch: [true, true, false, false, false],
  });

  // ข้อมูลไม่ครบ (directAdj แต่ไม่มีคู่) → ใบต้องไม่พัง ใช้กติกาเดิม
  await app.page.evaluate(() => {
    currentBranch = 'SRC'; currentRole = 'pharmacist';
    state.skuMap.clear(); state.scanData.clear(); scanListMap.clear();
    state.skuMap.set('BROKEN', { sku: 'BROKEN', productName: 'x', unitPrice: 20, systemQty: 5, negSys: false, barcodes: [], isDel: false });
    state.scanData.set('BROKEN', { status: 'stock_adjustment', directAdj: true, countedQty: 2, timestamp: '2026-09-29 10:00:00' });
  });
  const rows = await app.page.evaluate(() => _buildAdjustDocRows('ords').map((x) => [x.sku, x.qty]));
  expect(rows).toEqual([['BROKEN', 3]]);                               // 2 − 5 ด้วยยอดสด ไม่ใช่ NaN

  await closeApp(app);
});

// ── สถิติ ────────────────────────────────────────────────────────────────────
test('บาร์ "เภสัชตรวจแล้ว X/Y" ไม่นับ Stock Adj ตรง — ไม่งั้นโชว์ว่าตรวจแล้วทั้งที่ไม่มีใครตรวจ', async ({ browser }) => {
  const app = await bootBare(browser);
  const r = await app.page.evaluate(() => {
    // บาร์นี้อยู่บนการ์ด "รอรีเช็ค" เดิม = ทางถอย (ต.ค. 2026 สาขายาใช้การ์ด "Stock Adj เข้าระบบ" แทน — ดู adj-erp-stat-card.spec.js)
    PHARMACY_ADJ_ERP_CARD = false;
    currentBranch = 'SRC'; currentRole = 'pharmacist';
    state.scanData.clear();
    const read = () => {
      updateStats();
      const sub = document.getElementById('statAuditSub');
      return { sub: sub.style.display === 'none' ? '' : sub.textContent, audit: Number(document.getElementById('statFail').textContent), wrap: document.getElementById('auditProgressWrap').style.display };
    };
    // มีแต่ Stock Adj ตรง → ไม่มีงานของเภสัช บาร์ต้องซ่อน
    state.scanData.set('D1', { status: 'stock_adjustment', directAdj: true, effectiveQty: 1, systemQty: 3, countedQty: 1, initialStatus: 'stock_adjustment' });
    const onlyDirect = read();
    // ผสม: Audit เดิมรอ 1 · ผ่านเภสัชแล้ว 1 · Stock Adj ตรง 1 → 1/2 (ตรงไม่นับ)
    state.scanData.set('L-AUDIT', { status: 'audit', countedQty: 1, initialStatus: 'audit' });
    state.scanData.set('L-DONE', { status: 'stock_adjustment', auditor: 'Pharm', recheckQty: 1, countedQty: 1, initialStatus: 'audit' });
    const mixed = read();
    return { onlyDirect, mixed };
  });

  expect(r.onlyDirect.sub).toBe('');
  expect(r.onlyDirect.wrap).toBe('none');
  expect(r.mixed.sub).toBe('1 / 2');
  expect(r.mixed.audit).toBe(1);             // การ์ด Audit นับเฉพาะ status audit — ไม่ปนกับ Stock Adj

  await closeApp(app);
});

// ── ★ อัป R16 ทีหลังไม่ flip Stock Adj ตรง (ยอมรับแล้ว — ถ้าผิดใช้ ↺) ───────────────
test('reEvaluateAuditItems ไม่แตะ Stock Adj ตรง แม้ R16 ใหม่อธิบายส่วนต่างได้แล้ว · Audit เดิมยัง flip เป็น pass ได้', async ({ browser }) => {
  const app = await bootBare(browser);
  const r = await app.page.evaluate(async () => {
    currentBranch = 'SRC'; currentRole = 'pharmacist'; currentUser = 'Pharm';
    state.skuMap.clear(); state.scanData.clear(); scanListMap.clear();
    state.r16InboundRawMap.clear(); state.r16InboundMap.clear(); state.r16RawMap.clear(); state.r16SalesMap.clear();
    state.r16_103Map.clear(); state.r16_103RawMap.clear();
    for (const id of ['DIR', 'OLD']) state.skuMap.set(id, { sku: id, productName: id, unitPrice: 20, systemQty: 15, negSys: false, barcodes: [], isDel: false });
    // R16 ใหม่บอกว่าขายไปแล้ว 2 ก่อนสแกน → นับ 13 + 2 = 15 ตรงพอดี
    state.r16SalesMap.set('DIR', 2); state.r16SalesMap.set('OLD', 2);
    const t = '2026-09-29 10:00:00';
    state.scanData.set('DIR', { status: 'stock_adjustment', auditStatus: 'stock_adjustment', initialStatus: 'stock_adjustment', countedQty: 13, timestamp: t, directAdj: true, effectiveQty: 13, systemQty: 15 });
    state.scanData.set('OLD', { status: 'audit', auditStatus: 'pending', initialStatus: 'audit', countedQty: 13, timestamp: t });
    // ไม่ให้แตะ Firestore: ไม่มี baseline → _isPreBaselineItem = false · marker ถูกเขียนเฉพาะรายการที่เปลี่ยน (OLD) จึงดัก _writePharmacyAuditMarkers
    const written = [];
    const origW = _writePharmacyAuditMarkers;
    _writePharmacyAuditMarkers = async (m) => { written.push(...m.map((x) => x.sku)); return {}; };
    try { await reEvaluateAuditItems({ silent: true }); } finally { _writePharmacyAuditMarkers = origW; }
    const d = state.scanData.get('DIR'), o = state.scanData.get('OLD');
    return { dir: { status: d.status, directAdj: d.directAdj }, old: o.status, written };
  });

  expect(r.dir).toEqual({ status: 'stock_adjustment', directAdj: true });   // ไม่ flip
  expect(r.old).toBe('pass');                                               // Audit เดิมยังได้ประโยชน์จาก R16 ใหม่
  expect(r.written).toEqual(['OLD']);

  await closeApp(app);
});
