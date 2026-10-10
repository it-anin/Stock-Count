// ใบ 📦 / การ์ด "Stock Adj เข้าระบบ": แยก "สลับ LOT" ออกจาก "ปรับยอดนอกใบ 📦" (10 ต.ค. 2026 · ผู้ใช้สั่ง · สวิตช์ ADJ_ERP_LOT_AWARE)
//   เคสจริง SSS 24/9: พนักงานพิมพ์เพิ่ม 6 บรรทัดใน ProMaxx "เพื่อแก้ LOT" ทั้งที่แอปบอก Pass — ไฟล์ ERP ไม่มีเลข LOT (CF_SERIALNO ว่าง)
//   → ตัดสินจากผลรวมสุทธิต่อสินค้า (IRPS บวก · ORDS ลบ) ของใบตั้งแต่วันที่นับสินค้านั้น
//
// เทสนี้ตรึง — ★ = ข้อที่พังแล้วหน้างานแก้ ProMaxx ผิด/ไม่รู้ว่าต้องแก้
//   1. ★ สินค้าที่แอปสั่งปรับ: ใบสองทิศที่สุทธิเท่ายอดที่ต้องปรับ = เข้าแล้ว + "สลับ LOT" · สุทธิไม่เท่า = ทิศตรงข้ามเหมือนเดิม
//   2. ★ รายการนอกใบ: สลับ LOT (สุทธิ 0) · ปรับยอดนอกใบ + เหตุผลทุกแบบ (Pass ตั้งแต่นับ = 5 ตัวของ SSS · รีเช็ค Pass ก่อนออกใบ = 100429)
//      · ปกติ (ปรับก่อนรีเช็ค / ↺ รอรีเช็ค) · ใบก่อนวันที่นับไม่นับ · สินค้าใน Y / ผลต่าง 0 ที่ปรับจริง ไม่อยู่ในรายการ · เรียงตามประเภท
//   3. ★ การ์ด: ผลต่าง 0 + สลับ LOT ล้วน ไม่นับเป็นเข้าแล้ว · สลับ LOT ของสินค้าที่สั่งปรับนับเป็นเข้าแล้ว
//   4. ★ ใบที่ 📥 นำเข้าใน 🗂️ ไม่บังรายการ (เหตุที่ 6 ตัวของ SSS ไม่เคยถูกเตือน)
//   5. ปุ่มในแถบ 🧾 · ป็อปอัพรายการ · Export Excel · ปิด 📦 ปิดป็อปอัพ · กัน XSS · ผู้ช่วยเปิดไม่ได้
//   6. ★ ทางถอย: สวิตช์ปิด = ทุกอย่างเท่าก่อนแก้ (ทิศตรงข้าม · ข้อความเดิม "ไม่อยู่ในแท็บนี้" · การ์ดนับผลต่าง 0 ทุกใบ) · ค่าเริ่มต้นที่ส่งมอบ
// (ข้อมูลสังเคราะห์ทั้งหมด — ห้ามใช้ CSV จริง)
const { test, expect, bootBare, closeApp } = require('../../lib/hooks');

const EPOCH = '2026-08-05T01:00:00.000Z';   // เริ่มรอบ 5/8
const SCAN = '2026-08-10 16:00:00';          // นับ 10/8

const HDR = ['SYSWAREHOUSEID', 'TRANDATE', 'TRANNO', 'REFERENCENO1', 'SYSVOUCHERID', 'SYSSALEID', 'TOTAL', 'TOTALVAT', 'GRANDTOTAL', 'FCANCEL',
  'TAXRATE', 'SYSPERSONID', 'SYSBRANCHID', 'FPROCESS', 'SCANCODE', 'ITEMNAME', 'SYSUNITID', 'BASEQUANTITY', 'QUANTITY', 'SYSITEMID', 'PRICE',
  'AMOUNT', 'DETAILNO', 'ITEMID', 'ITEMNAME', 'TOTALTRADDISCHAVEVAT', 'TOTALTRADDISCNONEVAT', 'FSTOCKMAIN', 'FMLDISCOUNTITEM', 'FMLDISCOUNTROW',
  'DISCOUNTPROMOTION', 'NAME'];
function line({ date, no, sku, qty }) {
  const r = Array(HDR.length).fill('');
  r[0] = '1'; r[1] = date; r[2] = no; r[9] = '0'; r[12] = '0'; r[14] = sku; r[17] = String(qty); r[18] = String(qty); r[23] = sku; r[31] = 'สาขาทดสอบ';
  return r;
}
const sheet = (rows) => [HDR.slice(), ...rows];
// ORDS 24/9 14:43 · IRPS 24/9 13:33 (เวลาเดียวกับเคส SSS)
const FILE_O = sheet([['IN-Y', 2], ['LOTAPP', 3], ['OPPAPP', 3], ['PR-AFTER', 1], ['PR-BEFORE', 1], ['SWAP', 2], ['PEND', 1], ['NOROUND', 1],
  ['ZERO', 2], ['REOPEN', 1], ['SET-NET', 3], ['SET-SWAP', 1], ['P-OLD', 1]].map(([sku, qty]) => line({ date: '24/9/2026 14:43', no: 'ORDSBY001', sku, qty })));
const FILE_I = sheet([['P-FIRST', 1], ['SWAP', 2], ['BACK', 1], ['SET-SWAP', 1], ['LOTAPP', 1], ['OPPAPP', 2]]
  .map(([sku, qty]) => line({ date: '24/9/2026 13:33', no: 'IRPSBY001', sku, qty })));

async function seed(page, { role = 'pharmacist' } = {}) {
  await page.evaluate(({ role, EPOCH, SCAN, O, I }) => {
    ADJ_ERP_LOT_AWARE = true; PHARMACY_ADJ_ERP_CARD = true; ADJUST_DOC_ERP_CHECK = true; ADJUST_DOC_QTY_EDIT = true;
    PHARMACY_AUDIT_IN_ADJUST_DOC = true; ADJUST_DOC_SKIP_REOPENED = true; ADJUST_DOC_HISTORY = true;
    currentBranch = 'SRC'; currentRole = role; currentUser = 'Pharm'; _countResetAt = EPOCH;
    _db = null; _adjErp = null; _adjErpBusy = false; _adjErpFilter = 'all'; _adjHist = null;
    _branchScanPaused = false; _adjDocFilter = 'ords'; _adjDocPage = 1; _adjLoading = false;
    _pharmacyAuditMarkerData = { branch: 'SRC', countResetAt: EPOCH, items: {
      REOPEN: { status: 'audit', auditor: '', reopenedAt: '2026-09-20T03:00:00.000Z', countResetAt: EPOCH, effectiveQty: 3, systemQty: 4 },
    } };
    state.skuMap.clear(); state.scanData.clear(); state.skuDirectMap.clear(); scanListMap.clear();
    const base = { auditor: '', countedQty: 0, timestamp: SCAN, firstScanAt: SCAN, scannedBy: 'Asst' };
    const add = (sku, sys, sd) => {
      state.skuMap.set(sku, { sku, productName: 'สินค้า ' + sku, unitPrice: 20, systemQty: sys, negSys: false, barcodes: [], isDel: false });
      if (sd) state.scanData.set(sku, { ...base, ...sd });
    };
    const direct = (eff, sys, extra = {}) => ({ status: 'stock_adjustment', auditStatus: 'stock_adjustment', initialStatus: 'stock_adjustment',
      directAdj: true, effectiveQty: eff, systemQty: sys, countedQty: eff, ...extra });
    const pass = (extra = {}) => ({ status: 'pass', auditStatus: 'approved', initialStatus: 'pass', countedQty: 4, ...extra });
    const noStock = { status: 'stock_adjustment', auditStatus: 'stock_adjustment', initialStatus: 'stock_adjustment', noStock: true, countedQty: 0 };
    add('IN-Y', 10, direct(8, 10));                                    // สั่ง ORDS 2 · ERP ORDS 2 → เข้าแล้ว
    add('LOTAPP', 10, direct(8, 10));                                  // สั่ง ORDS 2 · ERP ORDS 3 + IRPS 1 (สุทธิ −2) → เข้าแล้ว · สลับ LOT
    add('OPPAPP', 10, direct(8, 10));                                  // สั่ง ORDS 2 · ERP ORDS 3 + IRPS 2 (สุทธิ −1) → ทิศตรงข้าม
    add('P-FIRST', 4, pass());                                         // Pass ตั้งแต่นับ · IRPS +1 → ปรับยอดนอกใบ (700958 ของ SSS)
    add('PR-AFTER', 9, pass({ initialStatus: 'audit', auditor: 'Pharm', countedQty: 10, recheckQty: 9, recheckSystemQty: 10, recheckAt: '2026-08-23T04:57:18.978Z' })); // รีเช็ค Pass 23/8 · ORDS 24/9 (100429)
    add('PR-BEFORE', 5, pass({ initialStatus: 'audit', auditor: 'Pharm', countedQty: 6, recheckQty: 5, recheckSystemQty: 5, recheckAt: '2026-09-25T03:00:00.000Z' })); // ORDS 24/9 แล้วรีเช็คตรง 25/9 → ปกติ
    add('SWAP', 6, pass());                                            // Pass · ORDS 2 + IRPS 2 → สลับ LOT
    add('PEND', 3, { status: 'pending', countedQty: 0, timestamp: '', firstScanAt: '' });   // ยังไม่นับ · ORDS 1
    add('BACK', 0, pass({ initialStatus: 'audit', auditor: 'Pharm', backorder: true, recheckQty: 0 }));   // ค้างส่ง · IRPS 1
    add('ZERO', 10, direct(8, 10, { adjQty: 0, adjBase: -2, adjBy: 'Pharm', adjAt: '2026-09-20T00:00:00.000Z' })); // แก้เป็น 0 · ERP ORDS 2
    add('REOPEN', 4, { status: 'audit', auditStatus: 'pending', initialStatus: 'audit', countedQty: 3 });   // ↺ รอรีเช็ค · ORDS 1 → ปกติ (รอแอปสรุป)
    add('SET-NET', 0, noStock);                                        // 🚫 ยอดระบบเหลือ 0 · ERP ORDS 3 → เข้าแล้ว (การ์ด)
    add('SET-SWAP', 0, noStock);                                       // 🚫 ยอดระบบเหลือ 0 · ERP ORDS 1 + IRPS 1 → สลับ LOT ล้วน ไม่ใช่การปรับยอด
    add('P-OLD', 4, pass({ firstScanAt: '2026-09-25 10:00:00' }));     // นับ 25/9 · ใบ 24/9 ก่อนวันที่นับ → ไม่นับ
    // NOROUND: มีใบใน ERP แต่ไม่อยู่ในรอบนับ (ไม่มีทั้ง skuMap และ scanData)
    window.__erp = (sheets) => {
      let m = null;
      for (const rows of sheets) { const p = _parseAdjErpRows(rows, 'SRC', EPOCH); if (p.error) throw new Error(p.error); m = _mergeAdjErp(m, p, { at: '2026-10-10T03:00:00.000Z', by: 'Pharm' }); }
      _adjErp = { ...m, branch: 'SRC', epoch: EPOCH, updatedBy: 'Pharm', updatedAt: '2026-10-10T03:00:00.000Z', localOnly: false };
    };
    __erp([O, I]);
  }, { role, EPOCH, SCAN, O: FILE_O, I: FILE_I });
}
const evalOf = (page, sku, dir = 'ords') => page.evaluate(({ sku, dir }) => {
  const r = _buildAdjustDocRows(dir).find((x) => x.sku === sku);
  const e = r && _adjErpEval([r], dir).get(sku);
  return e ? { state: e.state, got: e.got, opp: e.opp, need: e.need, lotSwap: e.lotSwap, text: _adjErpStateText(e) } : null;
}, { sku, dir });
const outside = (page) => page.evaluate(() => _adjErpOutsideList().map((x) => [x.kind, x.sku, x.net, x.reason]));
const cardStats = (page) => page.evaluate(() => { const s = _adjErpCardStats(); return { done: s.done, total: s.total, issue: s.issue, settledDone: s.settledDone }; });

test('ค่าเริ่มต้นที่ส่งมอบ: ADJ_ERP_LOT_AWARE เปิด (อ่านจากหน้าที่เพิ่งบูต) · มีป็อปอัพรายการใน DOM', async ({ browser }) => {
  const app = await bootBare(browser);
  expect(await app.page.evaluate(() => [typeof ADJ_ERP_LOT_AWARE, ADJ_ERP_LOT_AWARE, !!document.getElementById('adjErpOutsideOverlay'), !!document.getElementById('adjErpOutsideBody')]))
    .toEqual(['boolean', true, true, true]);
  await closeApp(app);
});

test('★ สินค้าที่แอปสั่งปรับ: สองทิศที่สุทธิ = ที่ต้องปรับ → เข้าแล้ว · สลับ LOT · สุทธิไม่เท่า → ทิศตรงข้าม', async ({ browser }) => {
  const app = await bootBare(browser);
  await seed(app.page);
  expect(await evalOf(app.page, 'LOTAPP')).toEqual({ state: 'done', got: 3, opp: 1, need: 2, lotSwap: true, text: 'เข้าแล้ว (สลับ LOT IRPS 1)' });
  expect(await evalOf(app.page, 'OPPAPP')).toMatchObject({ state: 'opposite', got: 3, opp: 2, need: 2, lotSwap: false });
  expect(await evalOf(app.page, 'IN-Y')).toMatchObject({ state: 'done', lotSwap: false, text: 'เข้าแล้ว' });
  // คอลัมน์ ERP บนตาราง 📦 บอกว่าเป็นสลับ LOT
  const cell = await app.page.evaluate(() => {
    renderAdjustDocTable(true);
    const tr = [...document.querySelectorAll('#adjustDocBody tr')].find((r) => r.children[1] && r.children[1].textContent.trim() === 'LOTAPP');
    return tr.children[9].querySelector('span').textContent.trim();
  });
  expect(cell).toBe('✅ เข้าแล้ว · สลับ LOT');
  await closeApp(app);
});

test('★ รายการนอกใบ: ปรับยอดนอกใบ + เหตุผล (เคส SSS) · สลับ LOT · ปกติ · ใบก่อนวันที่นับ/สินค้าใน Y ไม่อยู่ในรายการ', async ({ browser }) => {
  const app = await bootBare(browser);
  await seed(app.page);
  expect(await outside(app.page)).toEqual([
    ['outside', 'BACK', 1, 'ค้างส่ง — เภสัชตัดสินว่าไม่ต้องปรับ'],
    ['outside', 'NOROUND', -1, 'ไม่อยู่ในรอบนับนี้'],
    ['outside', 'P-FIRST', 1, 'Pass ตั้งแต่นับ — แอปไม่ได้สั่งปรับ'],
    ['outside', 'PEND', -1, 'ยังไม่ได้นับ'],
    ['outside', 'PR-AFTER', -1, 'รีเช็คแล้ว Pass ก่อนออกใบ — แอปไม่ได้สั่งปรับ'],
    ['outside', 'ZERO', -2, 'แก้จำนวนในใบ 📦 เป็น 0 (ไม่ส่ง)'],
    ['lotswap', 'SET-SWAP', 0, 'มีทั้ง ORDS และ IRPS เท่ากัน — ยอดรวมไม่เปลี่ยน'],
    ['lotswap', 'SWAP', 0, 'มีทั้ง ORDS และ IRPS เท่ากัน — ยอดรวมไม่เปลี่ยน'],
    ['ok', 'PR-BEFORE', -1, 'ปรับก่อนรีเช็ค แล้วรีเช็คตรง'],
    ['ok', 'REOPEN', -1, 'รอรีเช็ค — แอปยังไม่สรุป'],
  ]);
  // รายละเอียดของแถว: ยอดแยกทิศ · ใบ · สถานะในแอป · ชื่อ
  const row = await app.page.evaluate(() => _adjErpOutsideList().find((x) => x.sku === 'SWAP'));
  expect(row).toMatchObject({ ords: 2, irps: 2, net: 0, status: 'pass', name: 'สินค้า SWAP' });
  expect(row.docs.map((d) => d.no).sort()).toEqual(['IRPSBY001', 'ORDSBY001']);
  await closeApp(app);
});

test('★ การ์ด: สลับ LOT ของสินค้าที่สั่งปรับ = เข้าแล้ว · ผลต่าง 0 + สลับ LOT ล้วน ไม่นับ · สวิตช์ปิด = เท่าเดิม', async ({ browser }) => {
  const app = await bootBare(browser);
  await seed(app.page);
  // เปิด: IN-Y + LOTAPP + SET-NET เข้าแล้ว · OPPAPP ไม่ตรง · SET-SWAP ไม่นับ (สลับ LOT ไม่ใช่การปรับยอด)
  expect(await cardStats(app.page)).toEqual({ done: 3, total: 4, issue: 1, settledDone: 1 });
  // ปิด: LOTAPP กลับเป็นทิศตรงข้าม · SET-SWAP ถูกนับเป็นเข้าแล้วเหมือนก่อนแก้
  await app.page.evaluate(() => { ADJ_ERP_LOT_AWARE = false; });
  expect(await cardStats(app.page)).toEqual({ done: 3, total: 5, issue: 2, settledDone: 2 });
  await closeApp(app);
});

test('★ ใบที่ 📥 นำเข้าใน 🗂️ ประวัติไม่บังรายการ (เหตุที่ 6 ตัวของ SSS ไม่เคยถูกเตือน)', async ({ browser }) => {
  const app = await bootBare(browser);
  await seed(app.page);
  const before = await outside(app.page);
  const r = await app.page.evaluate(({ EPOCH }) => {
    const rows = ['P-FIRST', 'PR-AFTER', 'PEND', 'NOROUND', 'BACK', 'ZERO', 'SWAP'].map((s) => [s, 1, 1, null, '', '']);
    _adjHistApply('SRC', EPOCH, [{ no: 'ORDSBY001', dir: 'ords', at: '2026-09-24T07:43:00.000Z', by: '', src: 'erp', file: 'x.csv', impBy: 'Pharm', impAt: '2026-10-07T07:00:00.000Z', rows }], '', '');
    return { list: _adjErpOutsideList().map((x) => [x.kind, x.sku, x.net, x.reason]), oldMasked: _adjErpExtraSkus(_buildAdjustDocRows('ords'), 'ords').map((x) => x.sku) };
  }, { EPOCH });
  expect(r.list).toEqual(before);
  expect(r.oldMasked).not.toContain('P-FIRST');   // ข้อความเดิมถูกประวัติที่นำเข้าบัง — สาเหตุที่ต้องมีรายการนี้
  await closeApp(app);
});

test('ปุ่มในแถบ 🧾 · ป็อปอัพรายการ · Export Excel · ปิด 📦 ปิดป็อปอัพ · กัน XSS · ผู้ช่วยเปิดไม่ได้', async ({ browser }) => {
  const app = await bootBare(browser);
  await app.page.evaluate(() => { _refreshAdjMaster = async () => {}; window.__toasts = []; toast = (m, t) => { window.__toasts.push(`${t || 'info'}|${m}`); }; });
  await seed(app.page);
  await app.page.evaluate(() => { state.skuMap.get('P-FIRST').productName = '<img src=x onerror="window.__xss=1">เจล'; });
  const bar = await app.page.evaluate(() => {
    renderAdjustDocTable(true);
    const b = document.getElementById('adjErpOutsideBtn');
    return { text: b && b.textContent, warn: b && b.classList.contains('warn'), chips: document.querySelectorAll('#adjErpBar .adj-erp-chip').length, oldExtra: !!document.getElementById('adjErpExtra') };
  });
  expect(bar).toEqual({ text: '⚠️ ปรับยอดนอกใบ 📦 6 · 🔁 สลับ LOT 2', warn: true, chips: 4, oldExtra: false });
  const pop = await app.page.evaluate(() => {
    document.getElementById('adjErpOutsideBtn').click();
    const rows = [...document.querySelectorAll('#adjErpOutsideBody tr')];
    return { shown: document.getElementById('adjErpOutsideOverlay').style.display, count: document.getElementById('adjErpOutsideCount').textContent,
      first: [rows[0].dataset.kind, rows[0].dataset.sku, rows[0].children[0].textContent, rows[0].children[4].textContent],
      kinds: rows.map((r) => r.dataset.kind), xss: !!document.querySelector('#adjErpOutsideBody img') || !!window.__xss,
      pfirst: rows.find((r) => r.dataset.sku === 'P-FIRST').children[3].textContent };
  });
  expect(pop).toMatchObject({ shown: 'flex', count: '10 รายการ · ปรับยอดนอกใบ 6 · สลับ LOT 2 · ปกติ 2', first: ['outside', 'BACK', '⚠️ ปรับยอดนอกใบ 📦', '+1'], xss: false,
    kinds: ['outside', 'outside', 'outside', 'outside', 'outside', 'outside', 'lotswap', 'lotswap', 'ok', 'ok'] });
  expect(pop.pfirst).toBe('IRPSBY001 · 24/09/2026 13:33 · +1');
  // Export Excel = ทุกแถวของรายการ (ไม่ขึ้นกับแท็บ)
  const xl = await app.page.evaluate(() => {
    let got = null; const orig = XLSX.writeFile; XLSX.writeFile = (wb, name) => { got = { name, aoa: XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 }) }; };
    try { exportAdjErpOutsideExcel(); } finally { XLSX.writeFile = orig; }
    return got;
  });
  expect(xl.name).toMatch(/^erp_outside_SRC_\d{2}-\d{2}-\d{4}\.xlsx$/);
  expect(xl.aoa[0]).toEqual(['ประเภท', 'รหัสสินค้า', 'ชื่อสินค้า', 'ORDS (ลด)', 'IRPS (เพิ่ม)', 'ผลรวม', 'ใบใน ERP', 'สถานะในแอป', 'เหตุผล']);
  expect(xl.aoa).toHaveLength(11);
  expect(xl.aoa[1].slice(0, 6)).toEqual(['ปรับยอดนอกใบ', 'BACK', 'สินค้า BACK', 0, 1, 1]);
  // ปิด 📦 = ปิดป็อปอัพรายการ (ไม่ค้างลอย)
  expect(await app.page.evaluate(() => { closeAdjustDocPopup(); return document.getElementById('adjErpOutsideOverlay').style.display; })).toBe('none');
  // ผู้ช่วย: เปิดป็อปอัพไม่ได้ (การ์ด 🧾 / 📦 เป็นของเภสัช)
  expect(await app.page.evaluate(() => { currentRole = 'assistant'; openAdjErpOutsidePopup(); return document.getElementById('adjErpOutsideOverlay').style.display; })).toBe('none');
  await closeApp(app);
});

test('★ ทางถอย: ADJ_ERP_LOT_AWARE=false → ทิศตรงข้าม · ไม่มีรายการ/ปุ่ม · ข้อความเดิม "ไม่อยู่ในแท็บนี้" · เปิดป็อปอัพไม่ได้', async ({ browser }) => {
  const app = await bootBare(browser);
  await seed(app.page);
  await app.page.evaluate(() => { ADJ_ERP_LOT_AWARE = false; });
  expect(await evalOf(app.page, 'LOTAPP')).toEqual({ state: 'opposite', got: 3, opp: 1, need: 2, lotSwap: false, text: 'ทิศตรงข้าม (IRPS 1)' });
  const r = await app.page.evaluate(() => {
    renderAdjustDocTable(true);
    openAdjErpOutsidePopup();
    return { list: _adjErpOutsideList().length, btn: !!document.getElementById('adjErpOutsideBtn'), extra: (document.getElementById('adjErpExtra') || {}).textContent || '',
      shown: document.getElementById('adjErpOutsideOverlay').style.display };
  });
  expect(r).toEqual({ list: 0, btn: false, extra: '· มีใบ ORDS ใน ERP แต่ไม่อยู่ในแท็บนี้ 8 SKU', shown: 'none' });
  await closeApp(app);
});
