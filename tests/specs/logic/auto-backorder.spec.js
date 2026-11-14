// ค้างส่งอัตโนมัติ (สาขายา · พ.ย. 2026 · สวิตช์ AUTO_BACKORDER_DEL · ผู้ใช้สั่ง)
//
// กติกา: SKU "นอก PBM" ที่อยู่ในชุดนับ (_countableSkus) และ R01 < 0 และ "ยังไม่ได้สแกน" (pending) ของสาขายา
//   → (1) แท็บ 📦 ค้างส่งมีแถว kind 'auto' (ไม่มีปุ่ม) (2) นับเป็นตัวเศษ Progress (ไม่นับเป็น Pass) (3) ไม่อยู่ใน 📋 "ยังไม่ได้นับ"
// คำนวณสดจาก R01 ไม่เขียนอะไรลง item/Firestore · สแกนแล้ว/R01 ≥ 0/PBM ว่าง = ออกจากกลุ่ม · WH/ปิดสวิตช์ = เท่าเดิมทุกตัวอักษร
//
// เทสนี้ตรึง:
//   ① ค่าที่ส่งมอบ + ชุด _autoBackorderSkus (ครบทุกเงื่อนไข · ⊆ ชุดนับ · ไม่ผูกกับสาขา)
//   ② Progress: ตัวเศษนับ auto · Pass ไม่เพิ่ม · invariant Pass ≤ Counted ≤ Total
//   ③ 📋 ยังไม่ได้นับ: จำนวนแถว = ตัวหาร − ตัวเศษ เสมอ (เปิด/ปิดสวิตช์)
//   ④ แท็บค้างส่ง: แถว auto (ป้าย/ช่อง/ไม่มีปุ่ม/ลำดับ/badge/hint)
//   ⑤ วงจร: สแกนแล้วออก · ✕ แล้วกลับเข้า · R01 เปลี่ยนวันใหม่ · PBM ว่าง/เปลี่ยน
//   ⑥ ไม่แตะ: WH · ปิดสวิตช์ · ปิด PROGRESS_BY_SCAN (ผูกกัน) · ไม่มีการเขียน item
const { test, expect, bootBare, closeApp } = require('../../lib/hooks');

// ── fixture สังเคราะห์ (ห้ามใช้ข้อมูลจริง) ──
//   ใน PBM:   P-NEG (R01 −2 · pending) · P-POS (5 · pass) · P-ADJ (−4 · stock_adjustment)
//   นอก PBM:  O-NEG-A (−3) · O-NEG-B (−1 · nc:2 DELETE) · O-NEG-SCAN (−2 · scanning) · O-COUPON (−199 · nc:1) · O-POS (+4) · O-ZERO (0)
//   ชุดนับ = P-NEG P-POS P-ADJ O-NEG-A O-NEG-B O-NEG-SCAN O-POS (7)
//   ชุดตามข้อมูล (_autoBackorderSkus) = O-NEG-A O-NEG-B O-NEG-SCAN (3) · กลุ่มที่ "ใช้งานอยู่" (ยัง pending) = O-NEG-A O-NEG-B (2) — O-NEG-SCAN สแกนแล้วจึงออกจากกลุ่ม
const R01 = [
  { colE: 'P-NEG', productName: 'ใน PBM ติดลบ', systemQty: -2 },
  { colE: 'P-POS', productName: 'ใน PBM ปกติ', systemQty: 5 },
  { colE: 'P-ADJ', productName: 'ใน PBM ติดลบ นับแล้วไม่ตรง', systemQty: -4 },
  { colE: 'O-NEG-A', productName: 'นอก PBM ติดลบ A', systemQty: -3 },
  { colE: 'O-NEG-B', productName: 'นอก PBM ติดลบ B (DELETE)', systemQty: -1, nc: 2 },
  { colE: 'O-NEG-SCAN', productName: 'นอก PBM ติดลบ สแกนแล้ว', systemQty: -2 },
  { colE: 'O-COUPON', productName: 'คูปอง (หมวด 11.)', systemQty: -199, nc: 1 },
  { colE: 'O-POS', productName: 'นอก PBM ยอดเป็นบวก', systemQty: 4 },
  { colE: 'O-ZERO', productName: 'นอก PBM ยอดศูนย์', systemQty: 0 },
];
const PBM_SKUS = ['P-NEG', 'P-POS', 'P-ADJ'];
const DATA_SET = ['O-NEG-A', 'O-NEG-B', 'O-NEG-SCAN'];   // ตามข้อมูล (ไม่ดูสถานะสแกน)
const AUTO = ['O-NEG-A', 'O-NEG-B'];                    // กลุ่มที่ใช้งานอยู่ = ชุดตามข้อมูล ∩ pending

// สาขา/role + R01 + PBM แล้ว rebuildMaps เหมือน login จริง · สถานะสแกนตั้งหลัง rebuild (rebuildMaps เติม pending ให้ทุก SKU)
async function setup(page, { branch = 'SRC', role = 'pharmacist', on = true, byScan = true, r01 = R01, pm = PBM_SKUS, status = true } = {}) {
  await page.evaluate(({ branch, role, on, byScan, r01, pm, status }) => {
    currentBranch = branch; currentRole = role; currentUser = 'Pharm'; _db = null;
    AUTO_BACKORDER_DEL = on; PROGRESS_BY_SCAN = byScan;
    PHARMACY_BACKORDER_TAB = true; PHARMACIST_STOCKADJ_ONLY = false; PHARMACY_ADJ_ERP_CARD = false;
    state.r01Data = JSON.parse(JSON.stringify(r01));
    state.productMasterData = pm.map((sku) => ({ sku, productName: 'PBM ' + sku, unitPrice: 10 }));
    state.productMasterMap.clear(); state.productMasterData.forEach((r) => state.productMasterMap.set(r.sku, r.productName));
    state.r05Data = r01.map((r) => ({ barcode: 'BC-' + r.colE, colE: r.colE, unitName: 'EA', unitMultiplier: 1, unitPrice: 10 }));
    state.scanData.clear(); scanListMap.clear();
    rebuildMaps();
    if (status) {
      const set = (sku, o) => Object.assign(state.scanData.get(sku), { countedQty: 0, scannedBy: 'Asst', timestamp: '2026-11-13 09:00:00', firstScanAt: '2026-11-13 09:00:00' }, o);
      set('O-NEG-SCAN', { status: 'scanning' });
      set('P-POS', { status: 'pass', countedQty: 5, auditStatus: 'approved' });
      set('P-ADJ', { status: 'stock_adjustment', countedQty: 0, directAdj: true, effectiveQty: 0, systemQty: -4, auditStatus: 'stock_adjustment', initialStatus: 'stock_adjustment' });
    }
    _avFilter = 'audit';
    applyAuditTerminology();
    updateStats(); invalidatePopupRowsCache();
  }, { branch, role, on, byScan, r01, pm, status });
}

const progress = (page) => page.evaluate(() => {
  const [num, denom] = document.getElementById('progressCount').textContent.split(' / ').map(Number);
  return { num, denom, counted: Number(document.getElementById('statCounted').textContent), pass: Number(document.getElementById('statPass').textContent), total: Number(document.getElementById('statTotal').textContent) };
});
const pendingRows = (page) => page.evaluate(() => { invalidatePopupRowsCache(); popupFilterState = 'pending'; popupStaffFilter = 'all'; return getFilteredPopupRows().map((r) => r.sku).sort(); });
const tabRows = (page) => page.evaluate(() => { renderAuditVerifyTable(); return {
  rows: [...document.querySelectorAll('#auditVerifyTableBody tr')].map((tr) => [...tr.children].map((td) => td.textContent.replace(/\s+/g, ' ').trim())),
  buttons: [...document.querySelectorAll('#auditVerifyTableBody tr')].map((tr) => [...tr.querySelectorAll('button')].map((b) => b.getAttribute('onclick'))),
  footer: document.getElementById('auditVerifyRowCount').textContent, badge: document.getElementById('avCountAudit').textContent,
  hint: getComputedStyle(document.getElementById('avBackorderHint')).display !== 'none' ? document.getElementById('avBackorderHint').textContent : null,
}; });

test('① ค่าที่ส่งมอบ: สวิตช์เปิด · ฟังก์ชันครบ · ชุดอัตโนมัติ = ครบทุกเงื่อนไข · ⊆ ชุดนับ · ไม่ผูกกับสาขา', async ({ browser }) => {
  const app = await bootBare(browser);
  const d = await app.page.evaluate(() => ({ sw: AUTO_BACKORDER_DEL, byScan: PROGRESS_BY_SCAN, fns: ['_autoBackorderOn', '_isAutoBackorder'].map((f) => typeof window[f]), hint: typeof AV_BACKORDER_HINT_AUTO }));
  expect(d).toEqual({ sw: true, byScan: true, fns: ['function', 'function'], hint: 'string' });

  await setup(app.page);
  const g = await app.page.evaluate(() => ({ auto: [..._autoBackorderSkus].sort(), countable: [..._countableSkus].sort(), total: _cachedTotalSku }));
  expect(g.auto).toEqual(DATA_SET);                                          // นอก PBM + ชุดนับ + R01<0 เท่านั้น
  expect(g.auto.every((s) => g.countable.includes(s))).toBe(true);           // ⊆ ชุดนับ → ตัวเศษไม่เกินตัวหาร
  expect(g.countable).toEqual(['O-NEG-A', 'O-NEG-B', 'O-NEG-SCAN', 'O-POS', 'P-ADJ', 'P-NEG', 'P-POS']);
  expect(g.countable).not.toContain('O-COUPON');                             // nc:1 ไม่เข้าชุดนับ → ไม่ถูกลากเข้าค้างส่ง
  for (const s of ['P-NEG', 'P-ADJ', 'O-POS', 'O-ZERO']) expect(g.auto, s).not.toContain(s);   // ใน PBM · ยอดบวก · ศูนย์ = ไม่ใช่
  // กลุ่มที่ใช้งานอยู่ = ชุดตามข้อมูล ∩ ยังไม่สแกน
  expect(await app.page.evaluate(() => [..._autoBackorderSkus].filter((s) => _isAutoBackorder(s, state.scanData.get(s))).sort())).toEqual(AUTO);

  // ชุดตามข้อมูลไม่ผูกกับสาขา: สลับสาขาไม่ต้อง rebuild · ตัวตัดสินตอนใช้ผูกกับสาขายา+สวิตช์
  const sw = await app.page.evaluate(() => {
    const out = {};
    for (const b of ['SRC', 'KKL', 'SSS', 'WH']) { currentBranch = b; out[b] = [_autoBackorderOn(), _isAutoBackorder('O-NEG-A', state.scanData.get('O-NEG-A'))]; }
    return out;
  });
  expect(sw).toEqual({ SRC: [true, true], KKL: [true, true], SSS: [true, true], WH: [false, false] });
  await closeApp(app);
});

test('② Progress: ตัวเศษนับ auto · Pass ไม่เพิ่ม · invariant · ปิดสวิตช์ = เท่าเดิม', async ({ browser }) => {
  const app = await bootBare(browser);
  // ตัวหาร 7 · สแกนแล้ว: O-NEG-SCAN (scanning) P-POS (pass) P-ADJ (stock_adjustment) = 3 · auto +2 = 5 · pass = 1
  await setup(app.page);
  const on = await progress(app.page);
  expect(on).toEqual({ num: 5, denom: 7, counted: 5, pass: 1, total: 7 });
  expect(on.pass).toBeLessThanOrEqual(on.counted); expect(on.counted).toBeLessThanOrEqual(on.total);   // Pass ≤ Counted ≤ Total SKU

  await setup(app.page, { on: false });
  const off = await progress(app.page);
  expect(off).toEqual({ num: 3, denom: 7, counted: 3, pass: 1, total: 7 });                              // เท่ากติกาเดิมเป๊ะ
  expect(on.num - off.num).toBe(AUTO.length);
  expect(on.pass).toBe(off.pass);                                                                        // ไม่นับเป็น Pass
  expect(on.denom).toBe(off.denom);                                                                      // ตัวหารไม่เปลี่ยน

  // เส้นทางเบา (หลังสแกน) ได้ตัวเลขเดียวกับ updateStats เต็ม
  await setup(app.page);
  const light = await app.page.evaluate(() => { _writeScanProgress(); const [n, d] = document.getElementById('progressCount').textContent.split(' / ').map(Number); return { n, d, ...(_scanProgressCounts()) }; });
  expect(light).toEqual({ n: 5, d: 7, scanned: 5, pass: 1 });
  await closeApp(app);
});

test('③ 📋 ยังไม่ได้นับ: จำนวนแถว = ตัวหาร − ตัวเศษ เสมอ · auto ไม่อยู่ในลิสต์ · ปิดสวิตช์ = กลับมาอยู่', async ({ browser }) => {
  const app = await bootBare(browser);
  await setup(app.page);
  const on = await progress(app.page);
  const rowsOn = await pendingRows(app.page);
  expect(rowsOn).toEqual(['O-POS', 'P-NEG']);                          // เหลือเฉพาะที่ยังต้องไปนับจริง (auto ถูกตัด)
  expect(rowsOn.length).toBe(on.denom - on.num);                       // invariant ที่ CLAUDE.md ล็อกไว้

  await setup(app.page, { on: false });
  const off = await progress(app.page);
  const rowsOff = await pendingRows(app.page);
  expect(rowsOff).toEqual(['O-NEG-A', 'O-NEG-B', 'O-POS', 'P-NEG']);
  expect(rowsOff.length).toBe(off.denom - off.num);

  // ตัวกรอง DEL ไม่เปลี่ยน (แท็กตามชุดนับ ไม่ใช่งานค้าง): เทียบเปิด/ปิดสวิตช์ต้องเท่ากัน
  const del = async (on) => { await setup(app.page, { on }); return app.page.evaluate(() => { invalidatePopupRowsCache(); popupFilterState = 'del'; return getFilteredPopupRows().map((r) => r.sku).sort(); }); };
  expect(await del(true)).toEqual(await del(false));
  await closeApp(app);
});

test('④ แท็บ 📦 ค้างส่ง: แถว auto (ป้าย · ช่องนับได้ "—" · ไม่มีปุ่ม · ลำดับท้ายสุด · badge · hint)', async ({ browser }) => {
  const app = await bootBare(browser);
  await setup(app.page);
  const v = await tabRows(app.page);
  // desktop: [#, SKU, Barcode, Name, ระบบ, นับได้, สถานะ, เวลานับ, ค้างส่ง]
  expect(v.rows.map((r) => r[1])).toEqual(['P-ADJ', 'O-NEG-A', 'O-NEG-B']);   // adj ก่อน · auto ตามหลังเรียงตาม SKU
  const [adj, a, b] = v.rows;
  expect(adj[6]).toContain('Stock Adj');
  for (const [row, sys] of [[a, '-3'], [b, '-1']]) {
    expect(row[4]).toBe(sys);                                   // ระบบ (R01) ติดลบ
    expect(row[5]).toBe('—');                                   // ยังไม่ได้สแกน = ไม่มียอดนับ
    expect(row[6]).toContain('ค้างส่ง · อัตโนมัติ');
    expect(row[7]).toBe('—');                                   // ไม่มีเวลานับ
    expect(row[8]).toBe('—');                                   // ไม่มีปุ่ม (ไม่ต้องทำอะไร)
  }
  expect(v.buttons[1]).toEqual([]); expect(v.buttons[2]).toEqual([]);          // แถว auto ไม่มีปุ่มเลย
  expect(v.footer).toBe('3 รายการ ค้างส่ง');
  expect(v.badge).toBe('3');
  expect(v.hint).toContain('อัตโนมัติ'); expect(v.hint).toContain('ติดลบ');
  // แถวที่ไม่ใช่งานของแท็บ: ใน PBM ติดลบแต่ยัง pending · คูปอง · ยอดบวก
  for (const s of ['P-NEG', 'O-COUPON', 'O-POS', 'O-ZERO', 'O-NEG-SCAN', 'P-POS']) expect(v.rows.map((r) => r[1]), s).not.toContain(s);

  await setup(app.page, { on: false });
  const off = await tabRows(app.page);
  expect(off.rows.map((r) => r[1])).toEqual(['P-ADJ']);                      // ปิดสวิตช์ = แท็บเดิมเป๊ะ
  expect(off.hint).not.toContain('อัตโนมัติ'); expect(off.footer).toBe('1 รายการ ค้างส่ง');

  // จอแคบ (PDA ขนาดจอ): ตารางย่อ [SKU, Name, ระบบ, ค้างส่ง] ยังขึ้นแถว auto · ไม่มี hint
  await setup(app.page);
  await app.page.setViewportSize({ width: 390, height: 700 });
  const pda = await tabRows(app.page);
  expect(pda.rows.map((r) => r[0])).toEqual(['P-ADJ', 'O-NEG-A', 'O-NEG-B']);
  expect(pda.hint).toBeNull();

  // SKU ที่ไม่อยู่ใน skuMap (เช่น R05 ยังไม่โหลด) ไม่มีชื่อ/บาร์โค้ดให้แสดง → แท็บต้องข้ามแถว ไม่เดาชื่อจากรหัส และไม่ error
  await app.page.setViewportSize({ width: 1280, height: 800 });   // กลับเป็นตาราง desktop (คอลัมน์ที่ 2 = SKU)
  await setup(app.page);
  await app.page.evaluate(() => state.skuMap.delete('O-NEG-A'));
  expect((await tabRows(app.page)).rows.map((r) => r[1])).toEqual(['P-ADJ', 'O-NEG-B']);
  await closeApp(app);
});

test('⑤ วงจรเข้า-ออกกลุ่ม: สแกนแล้วออก (นับครั้งเดียว) · ✕ แล้วกลับเข้า · R01 ใหม่รายวัน · PBM ว่าง/เปลี่ยน', async ({ browser }) => {
  const app = await bootBare(browser);
  await setup(app.page);
  const grp = () => app.page.evaluate(() => [..._autoBackorderSkus].filter((s) => _isAutoBackorder(s, state.scanData.get(s))).sort());
  expect(await grp()).toEqual(AUTO);
  const base = await progress(app.page);

  // สแกน O-NEG-A: ออกจากกลุ่ม · ตัวเศษไม่ขยับ (เดิมนับผ่าน auto แล้ว — ห้ามนับซ้ำสองทาง)
  await app.page.evaluate(() => { Object.assign(state.scanData.get('O-NEG-A'), { status: 'scanning', countedQty: 0 }); updateStats(); });
  expect(await grp()).toEqual(['O-NEG-B']);
  expect(await progress(app.page)).toEqual(base);
  expect((await tabRows(app.page)).rows.map((r) => r[1])).toEqual(['P-ADJ', 'O-NEG-B']);

  // Confirm แล้ว (Stock Adj ตามสูตร) ก็ยังนับครั้งเดียว · Pass ไม่เพิ่มจากการ Stock Adj
  await app.page.evaluate(() => { Object.assign(state.scanData.get('O-NEG-A'), { status: 'stock_adjustment', directAdj: true }); updateStats(); });
  expect(await progress(app.page)).toEqual(base);
  // ✕ ลบการสแกน = กลับ pending → กลับเข้ากลุ่ม (R01 ยังติดลบ)
  await app.page.evaluate(() => { Object.assign(state.scanData.get('O-NEG-A'), { status: 'pending', countedQty: 0, directAdj: undefined }); updateStats(); });
  expect(await grp()).toEqual(AUTO);
  expect(await progress(app.page)).toEqual(base);

  // เช้าวันใหม่: R01 ใหม่ — O-NEG-A กลับเป็นบวก (ใบรับของเข้าแล้ว) · P-NEG ใน PBM ไม่เกี่ยว · O-POS กลายเป็นติดลบ
  const next = await app.page.evaluate(() => {
    state.r01Data.find((r) => r.colE === 'O-NEG-A').systemQty = 2;
    state.r01Data.find((r) => r.colE === 'O-POS').systemQty = -6;
    _rebuildCountableSkus(); updateStats(); invalidatePopupRowsCache();
    return { auto: [..._autoBackorderSkus].filter((s) => _isAutoBackorder(s, state.scanData.get(s))).sort(), rows: null };
  });
  expect(next.auto).toEqual(['O-NEG-B', 'O-POS']);                             // ออก/เข้าเองตาม R01 ไม่ต้องมีงานตั้งเวลา
  expect(await pendingRows(app.page)).toEqual(['O-NEG-A', 'P-NEG']);           // O-NEG-A กลับเป็นงานนับปกติ (ยอดเป็นบวก)
  const p2 = await progress(app.page);
  expect((await pendingRows(app.page)).length).toBe(p2.denom - p2.num);

  // R01 ว่าง/ไม่มีแถว: ไม่มีชุด
  await app.page.evaluate(() => { state.r01Data = []; _rebuildCountableSkus(); });
  expect(await app.page.evaluate(() => _autoBackorderSkus.size)).toBe(0);

  // PBM ว่าง (ยังไม่โหลด/อัปผิด) = ไม่มีชุดเลย — ไม่งั้นทุก SKU ติดลบดูเป็น "นอก PBM"
  await setup(app.page, { pm: [] });
  expect(await app.page.evaluate(() => [_autoBackorderSkus.size, [..._countableSkus].length > 0])).toEqual([0, true]);
  expect((await tabRows(app.page)).rows.map((r) => r[1])).toEqual(['P-ADJ']);   // แท็บเหลือเฉพาะที่สแกนแล้วไม่ตรง (เท่าเดิม)
  // SKU ที่ถูกเพิ่มเข้า PBM (อัป PBM ใหม่) = ออกจากกลุ่มทันทีหลัง rebuild
  await setup(app.page);
  await app.page.evaluate(() => { state.productMasterData.push({ sku: 'O-NEG-A', productName: 'เข้า PBM แล้ว', unitPrice: 10 }); _rebuildCountableSkus(); });
  expect(await app.page.evaluate(() => [..._autoBackorderSkus].sort())).toEqual(['O-NEG-B', 'O-NEG-SCAN']);
  await closeApp(app);
});

test('⑥ ไม่แตะ: WH · ปิดสวิตช์ · ปิด PROGRESS_BY_SCAN (ผูกกัน) · ไม่มีการเขียน item/ธง', async ({ browser }) => {
  const app = await bootBare(browser);
  // WH: ตัวเศษ/ลิสต์/แท็บ = เท่าเดิม ไม่ว่าสวิตช์เปิดหรือปิด
  const wh = async (on) => { await setup(app.page, { branch: 'WH', role: 'supervisor', on }); return app.page.evaluate(() => ({ prog: document.getElementById('progressCount').textContent, isAuto: _isAutoBackorder('O-NEG-A', state.scanData.get('O-NEG-A')), tabOn: _backorderTabOn(), rows: (() => { invalidatePopupRowsCache(); popupFilterState = 'pending'; return getFilteredPopupRows().map((r) => r.sku).sort(); })() })); };
  const whOn = await wh(true), whOff = await wh(false);
  expect(whOn).toEqual(whOff);
  expect(whOn.isAuto).toBe(false); expect(whOn.tabOn).toBe(false);
  expect(whOn.rows).toContain('O-NEG-A');                                      // WH ยังเห็นเป็นงานนับ

  // PROGRESS_BY_SCAN ปิด = ตัวเศษแบบ Confirm → ชุดนี้ต้องปิดตามไม่งั้น 📋 กับ Progress ไม่ตรงกัน
  await setup(app.page, { byScan: false });
  const nb = await app.page.evaluate(() => ({ on: _autoBackorderOn(), tab: [..._autoBackorderSkus].filter((s) => _isAutoBackorder(s, state.scanData.get(s))) }));
  expect(nb).toEqual({ on: false, tab: [] });
  expect((await tabRows(app.page)).rows.map((r) => r[1])).toEqual(['P-ADJ']);
  const p = await progress(app.page); const rows = await pendingRows(app.page);
  expect(rows).toContain('O-NEG-A'); expect(rows).toContain('O-NEG-SCAN');     // โหมด Confirm: scanning ยังค้างในลิสต์ (พฤติกรรมเดิม)
  expect(p.denom).toBe(7);

  // ไม่เขียนอะไร: คำนวณสด — updateStats/ตาราง/ลิสต์ ต้องไม่ mark dirty ไม่เพิ่มธง backorder และไม่เปลี่ยนสถานะ
  await setup(app.page);
  const w = await app.page.evaluate(() => {
    let dirty = 0; const orig = _markSkuDirty; _markSkuDirty = (...a) => { dirty++; return orig(...a); };
    updateStats(); renderAuditVerifyTable(); invalidatePopupRowsCache(); popupFilterState = 'pending'; getFilteredPopupRows(); _writeScanProgress();
    _markSkuDirty = orig;
    return { dirty, sd: ['O-NEG-A', 'O-NEG-B'].map((s) => { const d = state.scanData.get(s); return [d.status, d.backorder ?? null, d.recheckQty ?? null]; }) };
  });
  expect(w.dirty).toBe(0);
  expect(w.sd).toEqual([['pending', null, null], ['pending', null, null]]);
  await closeApp(app);
});
