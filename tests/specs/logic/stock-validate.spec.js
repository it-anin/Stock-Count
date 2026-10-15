// ✅ Stock Validate (14 ต.ค. 2026 · ผู้ใช้สั่ง · สาขายา) — การ์ดแผงซ้ายใต้ 📦 → ตาราง SKU ที่ status stock_adjustment
//   Col 1/2 = ตัวเลขตอนตัดสิน (แช่ไว้) · Col 3 = นับ − ระบบ · Col 4 = −ORDS · Col 5 = +IRPS · Col 6 = Col 4 + Col 5 · Col 7 = ตรง/ไม่ตรง
//   ORDS/IRPS = ทุกใบของสินค้านั้นในรายงานที่แนบที่การ์ด 🧾 ของรอบนี้ ("ทั้งเดือน" — ไม่ใช้ขอบล่างรายแถวแบบคอลัมน์ Report ใน 📦)
//
// เทสนี้ตรึง — ★ = ข้อที่พังแล้วเภสัชสรุปผิดว่าปรับเข้า ProMaxx ถูก/ผิด
//   1. ค่าเริ่มต้นที่ส่งมอบ + DOM (การ์ดอยู่ใต้ 📦)
//   2. ★ เลือกเฉพาะ stock_adjustment (รอรีเช็ค/Pass ไม่ขึ้น) · ไม่มีข้อมูลสินค้านับโชว์ท้ายตาราง (ไม่หายเงียบ)
//   3. ★ ตัวเลขตอนตัดสิน: Stock Adj ตรงไม่ขยับตาม R01 ล่าสุด · ยอดนับชดเชย R16 · รีเช็คเดิม/stale = ตอนรีเช็ค · 🚫 ไม่มีของ = R01 ล่าสุด
//   4. ★ Col 3 = ตัวเลขเดียวกับใบ 📦 ทุกแถว
//   5. ★ ORDS/IRPS ทั้งรายงาน (รวมใบก่อนวันที่นับสินค้านั้น) · หลายใบรวม · ปรับปรุง LOT สุทธิ
//   6. ★ ผลตรวจ + สี/เครื่องหมาย · ข้อยกเว้น "R01 ล่าสุดรวมใบแล้ว" เฉพาะแถว R01 ล่าสุด · ค่าที่แก้ในใบ 📦
//   7. ไม่มีรายงาน / ขาด IRPS / เห็นเฉพาะเครื่องนี้
//   8. เรียง · ชิป · แบ่งหน้า 20 · Export Excel ครบทุกแถวของตัวกรอง
//   9. สิทธิ์ (WH · ผู้ช่วย · PDA · สวิตช์ปิด · logout ปิดป็อปอัพ) · 10. รีเฟรชเองผ่าน hub คงหน้า · XSS · 11. คลิกในป็อปอัพไม่ดึงโฟกัสไปช่องสแกน
//   12. ตารางไม่ล้นที่หน้าต่าง 960px (แบ่งครึ่งจอคู่ ProMaxx)
// (ข้อมูลสังเคราะห์ทั้งหมด — ห้ามใช้ CSV จริง)
const { test, expect, bootBare, closeApp } = require('../../lib/hooks');

const EPOCH = '2026-08-05T01:00:00.000Z';   // เริ่มรอบ 5/8
const SCAN = '2026-08-10 16:00:00';          // นับ 10/8
const XSS_DOC = 'ORDS" ONMOUSEOVER="__SVXSS2=1';   // หลุดจาก title="…" ได้ถ้าไม่ escape

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
const O = (no, sku, qty) => line({ date: '24/9/2026 14:43', no, sku, qty });
const I = (no, sku, qty) => line({ date: '24/9/2026 13:33', no, sku, qty });
const FILE_O = sheet([O('ORDSBY001', 'D-ORDS', 2), O('ORDSBY001', 'D-COMP', 1), O('ORDSBY001', 'D-PART', 2), O('ORDSBY002', 'D-PART', 1),
  O('ORDSBY001', 'D-LOT', 3), O('ORDSBY001', 'D-EARLY', 1), O('ORDSBY001', 'D-EDIT', 3), O('ORDSBY001', 'R-OLD', 2), O('ORDSBY001', 'NS-CAUGHT', 4),
  O('ORDSBY001', 'R-FROZEN0', 1), O('ORDSBY001', 'PASS', 1), O('ORDSBY001', 'AUD', 1), O(XSS_DOC, 'D-XSS', 1)]);
const FILE_I = sheet([I('IRPSBY001', 'D-IRPS', 2), I('IRPSBY001', 'D-LOT', 1)]);
const FILE_I2 = sheet([line({ date: '25/9/2026 09:00', no: 'IRPSBY002', sku: 'D-NONE', qty: 2 })]);   // ใบที่มาทีหลัง (ทดสอบรีเฟรช · คนละวันกับ IRPSBY001 — merge ทับเฉพาะช่วงของไฟล์ใหม่)

const MISMATCH = ['D-EDIT', 'D-NONE', 'D-PART', 'NS-LIVE', 'R-FRESH', 'R-FROZEN0'];
const MATCH = ['D-COMP', 'D-EARLY', 'D-IRPS', 'D-LOT', 'D-ORDS', 'D-XSS', 'NS-CAUGHT', 'R-OLD'];

async function seed(page, { role = 'pharmacist', branch = 'SRC', files = [FILE_O, FILE_I], pages = 0 } = {}) {
  await page.evaluate(({ role, branch, EPOCH, SCAN, files, pages }) => {
    STOCK_VALIDATE = true; STOCK_VALIDATE_PAGE_SIZE = 20; ADJUST_DOC_ERP_CHECK = true; PHARMACY_ADJ_ERP_CARD = true; ADJ_ERP_LOT_AWARE = true;
    ADJUST_DOC_QTY_EDIT = true; PHARMACY_AUDIT_IN_ADJUST_DOC = true; ADJUST_DOC_SKIP_REOPENED = true; ADJUST_DOC_HISTORY = true;
    currentBranch = branch; currentRole = role; currentUser = 'Pharm'; _countResetAt = EPOCH;
    _db = null; _adjErp = null; _adjErpBusy = false; _adjErpFilter = 'all'; _adjHist = null; _svFilter = 'all'; _svPage = 1;
    _branchScanPaused = false; _adjDocFilter = 'ords'; _adjDocPage = 1; _adjLoading = false;
    _pharmacyAuditMarkerData = { branch, countResetAt: EPOCH, items: {} };
    state.skuMap.clear(); state.scanData.clear(); state.skuDirectMap.clear(); scanListMap.clear();
    for (const el of document.querySelectorAll('[id$="Modal"]')) if (el.style.display === 'flex') el.style.display = 'none';   // หน้าเลือกสาขา/PIN ของ bootBare บังการคลิก
    const base = { auditor: '', countedQty: 0, timestamp: SCAN, firstScanAt: SCAN, scannedBy: 'Asst' };
    const add = (sku, live, sd, name) => {
      if (live !== null) state.skuMap.set(sku, { sku, productName: name || ('สินค้า ' + sku), unitPrice: 20, systemQty: live, negSys: false, barcodes: [], isDel: false });
      if (sd) state.scanData.set(sku, { ...base, ...sd });
    };
    const direct = (eff, sys, extra = {}) => ({ status: 'stock_adjustment', auditStatus: 'stock_adjustment', initialStatus: 'stock_adjustment',
      directAdj: true, effectiveQty: eff, systemQty: sys, countedQty: eff, ...extra });
    const recheck = (rq, frozen) => ({ status: 'stock_adjustment', auditStatus: 'stock_adjustment', initialStatus: 'audit', auditor: 'Pharm',
      countedQty: rq + 1, recheckQty: rq, recheckSystemQty: frozen, recheckAt: '2026-08-23T04:57:18.978Z' });
    const noStock = { status: 'stock_adjustment', auditStatus: 'stock_adjustment', initialStatus: 'stock_adjustment', noStock: true, countedQty: 0 };
    add('D-ORDS', 99, direct(8, 10));                                    // R01 ล่าสุด 99 — ต้องไม่ถูกใช้ (ค่าแช่ตอน Confirm = 10)
    add('D-IRPS', 10, direct(12, 10), '<img src=x onerror="window.__SVXSS=1">ยา IRPS');
    add('D-COMP', 10, direct(9, 10, { countedQty: 7, rawCountedQty: 7, soldQty: 2 }));   // นับ 7 + ขายก่อนสแกน 2 = 9
    add('D-PART', 10, direct(5, 10));                                    // ต้อง ORDS 5 · ERP 2+1 = 3 → ไม่ตรง
    add('D-NONE', 4, direct(6, 4));                                      // ต้อง IRPS 2 · ไม่มีใบ → ไม่ตรง
    add('D-LOT', 10, direct(8, 10));                                     // ORDS 3 + IRPS 1 สุทธิ −2 → ตรง
    add('D-EARLY', 4, direct(3, 4, { firstScanAt: '2026-09-25 10:00:00', timestamp: '2026-09-25 10:00:00' }));   // นับ 25/9 · ใบ 24/9 (ก่อนวันที่นับ แต่อยู่ในรอบ)
    add('D-EDIT', 10, direct(6, 10, { adjQty: 3, adjBase: -4, adjBy: 'Pharm', adjAt: '2026-09-20T00:00:00.000Z' }));   // แก้ในใบเป็น 3 · ERP 3
    add('D-XSS', 10, direct(9, 10));
    add('R-OLD', 3, recheck(3, 5));                                      // รีเช็ค (ระบบตอนนั้น 5) · R01 ล่าสุด 3 = stale ในใบ 📦 · ERP ORDS 2
    add('R-FRESH', 6, recheck(4, 6));                                    // สด · ต้อง ORDS 2 · ไม่มีใบ
    add('R-FROZEN0', 5, recheck(5, 5));                                  // ผลต่างตอนรีเช็ค 0 · มีใบ ORDS 1 → ไม่ตรง (ข้อยกเว้นห้ามใช้)
    add('NS-LIVE', 5, noStock);                                          // 🚫 R01 ล่าสุด 5 · ไม่มีใบ
    add('NS-CAUGHT', 0, noStock);                                        // 🚫 R01 ล่าสุด 0 แล้ว · ใบ ORDS 4 → ตรง (R01 ตามทัน)
    add('PASS', 4, { status: 'pass', auditStatus: 'approved', initialStatus: 'pass', countedQty: 4 });
    add('AUD', 4, { status: 'audit', auditStatus: 'pending', initialStatus: 'audit', countedQty: 3, effectiveQty: 3, systemQty: 4 });
    add('NOSKU', null, direct(1, 2));                                    // ไม่มีใน skuMap (R05 ยังไม่โหลด)
    for (let i = 1; i <= pages; i++) add('PG-' + String(i).padStart(2, '0'), 2, direct(1, 2));   // ไม่ตรงทั้งหมด (ไม่มีใบ)
    window.__erp = (sheets, extra = {}) => {
      let m = null;
      for (const rows of sheets) { const p = _parseAdjErpRows(rows, branch, EPOCH); if (p.error) throw new Error(p.error); m = _mergeAdjErp(m, p, { at: '2026-10-10T03:00:00.000Z', by: 'Pharm' }); }
      _adjErp = { ...m, branch, epoch: EPOCH, updatedBy: 'Pharm', updatedAt: '2026-10-10T03:00:00.000Z', localOnly: false, ...extra };
    };
    if (files.length) __erp(files);
  }, { role, branch, EPOCH, SCAN, files, pages });
}
const svRows = (page) => page.evaluate(() => _stockValidateRows());
// แถวบนจอ: sku → ข้อความ/สีของทุกช่อง
const domRows = (page) => page.evaluate(() => [...document.querySelectorAll('#svBody tr[data-sku]')].map((tr) => {
  const c = [...tr.children];
  const main = (td) => { const s = td.querySelector('span'); return s ? s.textContent : td.textContent.trim(); };
  const color = (td) => { const s = td.querySelector('span'); return s ? s.style.color : ''; };
  const sub = (td) => [...td.querySelectorAll('.sv-sub')].map((x) => x.textContent).join(' | ');
  return { sku: tr.dataset.sku, no: c[0].textContent, name: c[2].textContent, sys: main(c[3]), sysSub: sub(c[3]), cnt: main(c[4]), cntSub: sub(c[4]),
    diff: main(c[5]), diffColor: color(c[5]), diffSub: sub(c[5]), ords: main(c[6]), ordsColor: color(c[6]), ordsSub: sub(c[6]), ordsTitle: c[6].title,
    irps: main(c[7]), irpsColor: color(c[7]), irpsTitle: c[7].title, net: c[8].textContent.trim(), netColor: c[8].style.color,
    res: main(c[9]), resColor: color(c[9]), resSub: sub(c[9]) };
}));

test('ค่าเริ่มต้นที่ส่งมอบ: STOCK_VALIDATE เปิด · หน้าละ 20 · การ์ดอยู่ใต้ 📦 ซ่อนจนล็อกอิน · มีป็อปอัพใน DOM', async ({ browser }) => {
  const app = await bootBare(browser);
  expect(await app.page.evaluate(() => [typeof STOCK_VALIDATE, STOCK_VALIDATE, STOCK_VALIDATE_PAGE_SIZE,
    document.getElementById('adjustDocPanel').nextElementSibling?.id, document.getElementById('stockValidatePanel').style.display,
    !!document.getElementById('stockValidateOverlay'), !!document.getElementById('svBody'), !!document.getElementById('svPager')]))
    .toEqual(['boolean', true, 20, 'stockValidatePanel', 'none', true, true, true]);
  await closeApp(app);
});

test('★ เลือกเฉพาะ stock_adjustment · รอรีเช็ค/Pass ไม่ขึ้น · ไม่มีข้อมูลสินค้า (R05) นับโชว์ท้ายตาราง', async ({ browser }) => {
  const app = await bootBare(browser);
  await seed(app.page);
  const r = await svRows(app.page);
  expect(r.rows.map((x) => x.sku).sort()).toEqual([...MISMATCH, ...MATCH].sort());
  expect(r.rows.some((x) => ['PASS', 'AUD', 'NOSKU'].includes(x.sku))).toBe(false);
  expect(r.skipped).toEqual({ noSku: 1, noBasis: 0 });
  await app.page.evaluate(() => openStockValidatePopup());
  expect(await app.page.textContent('#svRowCount')).toBe('14 รายการ · ไม่ตรง 6 · ตรง 8 · ไม่แสดง: ไม่มีข้อมูลสินค้า (R05) 1');
  await closeApp(app);
});

test('★ ตัวเลขตอนตัดสิน: ค่าแช่ไม่ขยับตาม R01 ล่าสุด · ยอดนับชดเชย R16 · รีเช็คเดิม/stale ใช้ยอดตอนรีเช็ค · 🚫 ใช้ R01 ล่าสุด', async ({ browser }) => {
  const app = await bootBare(browser);
  await seed(app.page);
  const pick = async () => Object.fromEntries((await svRows(app.page)).rows.map((x) => [x.sku, [x.sys, x.cnt, x.diff, x.src]]));
  expect(await pick()).toMatchObject({
    'D-ORDS': [10, 8, -2, 'confirm'], 'D-IRPS': [10, 12, 2, 'confirm'], 'D-COMP': [10, 9, -1, 'confirm'], 'D-EDIT': [10, 6, -4, 'confirm'],
    'R-OLD': [5, 3, -2, 'recheck'], 'R-FRESH': [6, 4, -2, 'recheck'], 'R-FROZEN0': [5, 5, 0, 'recheck'],
    'NS-LIVE': [5, 0, -5, 'live'], 'NS-CAUGHT': [0, 0, 0, 'live'],
  });
  // R01 ล่าสุดเปลี่ยน (บอทอัปทุกเช้า): แถวค่าแช่เท่าเดิม · แถว R01 ล่าสุดขยับตาม
  await app.page.evaluate(() => { for (const s of ['D-ORDS', 'D-COMP', 'R-OLD', 'R-FRESH']) state.skuMap.get(s).systemQty = 1; state.skuMap.get('NS-LIVE').systemQty = 4; });
  expect(await pick()).toMatchObject({ 'D-ORDS': [10, 8, -2, 'confirm'], 'D-COMP': [10, 9, -1, 'confirm'], 'R-OLD': [5, 3, -2, 'recheck'],
    'R-FRESH': [6, 4, -2, 'recheck'], 'NS-LIVE': [4, 0, -4, 'live'] });
  // บนจอ: ป้ายที่มา · ยอดนับดิบ + R16
  await app.page.evaluate(() => openStockValidatePopup());
  const d = Object.fromEntries((await domRows(app.page)).map((x) => [x.sku, x]));
  expect([d['D-ORDS'].sys, d['D-ORDS'].sysSub, d['R-OLD'].sysSub, d['NS-LIVE'].sysSub]).toEqual(['10', 'ตอน Confirm', 'ตอนรีเช็ค', 'R01 ล่าสุด']);
  expect([d['D-COMP'].cnt, d['D-COMP'].cntSub, d['D-ORDS'].cntSub]).toEqual(['9', 'นับ 7 · R16 +2', '']);
  await closeApp(app);
});

test('★ Col 3 = ตัวเลขเดียวกับใบ 📦 ทุกแถวที่อยู่ในใบ (ทิศ + จำนวน) · การ์ดสถิติยังคำนวณได้', async ({ browser }) => {
  const app = await bootBare(browser);
  await seed(app.page);
  const out = await app.page.evaluate(() => {
    const sv = new Map(_stockValidateRows().rows.map((x) => [x.sku, x.diff]));
    // ใบ 📦 มีรอรีเช็ค (audit) ด้วย — Stock Validate เฉพาะ stock_adjustment (ผู้ใช้เลือก) จึงเทียบเฉพาะแถวที่ไม่ใช่ pending
    const doc = [..._buildAdjustDocRows('ords').filter((r) => !r.pending).map((r) => [r.sku, -r.baseQty]), ..._buildAdjustDocRows('irps').filter((r) => !r.pending).map((r) => [r.sku, r.baseQty])];
    const s = _adjErpCardStats();
    return { pairs: doc.map(([sku, d]) => [sku, d, sv.get(sku)]), card: [s.done, s.total] };
  });
  expect(out.pairs.length).toBe(11);
  for (const [sku, d, v] of out.pairs) expect([sku, v]).toEqual([sku, d]);
  expect(out.card.every(Number.isFinite)).toBe(true);
  await closeApp(app);
});

test('★ ORDS/IRPS ทั้งรายงาน: รวมใบก่อนวันที่นับ (คอลัมน์ Report ใน 📦 ไม่นับ) · หลายใบรวม · ORDS ลบ IRPS บวก · ผล Diff = ผลรวม', async ({ browser }) => {
  const app = await bootBare(browser);
  await seed(app.page);
  const r = Object.fromEntries((await svRows(app.page)).rows.map((x) => [x.sku, [x.ords, x.irps, x.net, x.docs.length]]));
  expect(r).toMatchObject({ 'D-EARLY': [1, 0, -1, 1], 'D-PART': [3, 0, -3, 2], 'D-LOT': [3, 1, -2, 2], 'D-IRPS': [0, 2, 2, 1], 'D-NONE': [0, 0, 0, 0] });
  // คอลัมน์ Report ใน 📦 ใช้ขอบล่างรายแถว → ใบ 24/9 ไม่ใช่ของการนับ 25/9
  expect(await app.page.evaluate(() => { const r = _buildAdjustDocRows('ords').find((x) => x.sku === 'D-EARLY'); return _adjErpEval([r], 'ords').get('D-EARLY').state; })).toBe('none');
  await app.page.evaluate(() => openStockValidatePopup());
  const d = Object.fromEntries((await domRows(app.page)).map((x) => [x.sku, x]));
  expect([d['D-PART'].ords, d['D-PART'].ordsColor, d['D-PART'].ordsSub, d['D-PART'].irps, d['D-PART'].irpsColor, d['D-PART'].net]).toEqual(['-3', 'var(--red)', '2 เอกสาร', '0', 'var(--text3)', '-3']);
  expect(d['D-PART'].ordsTitle).toBe('ORDSBY001 · 24/09/2026 14:43 · ORDS 2\nORDSBY002 · 24/09/2026 14:43 · ORDS 1');
  expect([d['D-IRPS'].irps, d['D-IRPS'].irpsColor, d['D-IRPS'].ords, d['D-IRPS'].net, d['D-IRPS'].netColor]).toEqual(['+2', 'var(--green)', '0', '+2', 'var(--green)']);
  expect(d['D-NONE'].ordsTitle).toBe('ไม่มีใบ ORDS ของสินค้านี้ในรายงาน');
  await closeApp(app);
});

test('★ ผลตรวจ + สี/เครื่องหมาย · ข้อยกเว้น R01 ตามทันเฉพาะแถว R01 ล่าสุด · ค่าที่แก้ในใบ 📦', async ({ browser }) => {
  const app = await bootBare(browser);
  await seed(app.page);
  await app.page.evaluate(() => openStockValidatePopup());
  const d = Object.fromEntries((await domRows(app.page)).map((x) => [x.sku, x]));
  for (const s of MATCH) expect([s, d[s].res, d[s].resColor]).toEqual([s, 'ตรง', 'var(--green)']);
  for (const s of MISMATCH) expect([s, d[s].res, d[s].resColor]).toEqual([s, 'ไม่ตรง', 'var(--red)']);
  // เครื่องหมาย + สีของ Col 3: ลบแดง · บวกเขียว · 0 เทา
  expect([d['D-ORDS'].diff, d['D-ORDS'].diffColor, d['D-IRPS'].diff, d['D-IRPS'].diffColor, d['NS-CAUGHT'].diff, d['NS-CAUGHT'].diffColor])
    .toEqual(['-2', 'var(--red)', '+2', 'var(--green)', '0', 'var(--text3)']);
  expect([d['D-PART'].resSub, d['D-NONE'].resSub, d['NS-LIVE'].resSub, d['R-FROZEN0'].resSub]).toEqual(['ต่าง -2', 'ต่าง +2', 'ต่าง -5', 'ต่าง +1']);
  expect([d['NS-CAUGHT'].res, d['NS-CAUGHT'].resSub, d['NS-CAUGHT'].net]).toEqual(['ตรง', 'R01 ล่าสุดรวมใบแล้ว', '-4']);   // R01 ล่าสุดเหลือ 0 = ปรับแล้ว
  expect([d['R-FROZEN0'].res, d['R-FROZEN0'].diff]).toEqual(['ไม่ตรง', '0']);   // ค่าแช่ผลต่าง 0 แต่มีใบ = ไม่ตรง (ข้อยกเว้นห้ามใช้)
  expect([d['D-EDIT'].diff, d['D-EDIT'].diffSub, d['D-EDIT'].res, d['D-EDIT'].resSub]).toEqual(['-4', 'ใบ 📦 แก้เป็น 3', 'ไม่ตรง', 'ต่าง -1 | ตรงกับจำนวนที่แก้ในใบ 📦']);   // คนละบรรทัด
  await closeApp(app);
});

test('ไม่มีรายงาน = "—" + แถบบอกให้แนบ · ขาด IRPS = คอลัมน์ IRPS "—" + แจ้งบนแถบ · เห็นเฉพาะเครื่องนี้', async ({ browser }) => {
  const app = await bootBare(browser);
  await seed(app.page, { files: [] });
  await app.page.evaluate(() => { _applyStatAuditCardMode(); openStockValidatePopup(); });
  let d = await domRows(app.page);
  expect(d.every((x) => x.ords === '—' && x.irps === '—' && x.net === '—' && x.res === '—')).toBe(true);
  expect(await app.page.evaluate(() => [document.getElementById('svInfo').textContent, document.getElementById('svBar').style.display,
    document.getElementById('stockValidateCount').textContent, document.getElementById('svRowCount').textContent]))
    .toEqual(['ยังไม่แนบ R02.102 — แนบที่ 📦 ปรับปรุงสินค้า → 🧾 ตรวจสอบ รายงาน R02.102', 'none', '—', '14 รายการ · ไม่แสดง: ไม่มีข้อมูลสินค้า (R05) 1']);
  // มีแต่ ORDS (เช่นแนบ R16.104 ไฟล์เดียว)
  await app.page.evaluate(([o]) => { __erp([o]); _applyStatAuditCardMode(); }, [FILE_O]);
  d = Object.fromEntries((await domRows(app.page)).map((x) => [x.sku, x]));
  expect([d['D-IRPS'].irps, d['D-IRPS'].irpsTitle, d['D-IRPS'].net, d['D-IRPS'].res, d['D-ORDS'].res]).toEqual(['—', 'IRPS: ยังไม่มีข้อมูลในรายงานที่แนบ', '0', 'ไม่ตรง', 'ตรง']);
  // แถบช่วงที่รายงานครอบ: "ORDS <ช่วง> · IRPS <ช่วง>" (ไม่มีชื่อรายงาน/เวลาอัปเดต/คำว่า "ถึง") — วันเดียว = วันนั้นวันเดียว
  expect(await app.page.textContent('#svInfo')).toBe('ORDS 24/09/2026 14:43 · IRPS: ยังไม่มีข้อมูล');
  expect(await app.page.evaluate(() => [
    _svCoverRange({ fromDay: '2026-09-01', toAt: '2026-09-30 20:56' }),     // เดือนเดียวกัน → 1-30/09/2026 20:56
    _svCoverRange({ fromDay: '2026-09-24', toAt: '2026-09-24 14:43' }),     // วันเดียว
    _svCoverRange({ fromDay: '2026-08-05', toAt: '2026-09-30 16:57' }),     // ข้ามเดือน
    _svCoverRange({ fromDay: '2025-12-20', toAt: '2026-01-03 09:00' }),     // ข้ามปี
    _svCoverRange({ toAt: '2026-09-30 16:57' }),                            // ไม่มีวันเริ่ม = เหลือแค่ปลายช่วง
  ])).toEqual(['1-30/09/2026 20:56', '24/09/2026 14:43', '05/08-30/09/2026 16:57', '20/12/2025-03/01/2026 09:00', '30/09/2026 16:57']);
  await app.page.evaluate(([o, i]) => { __erp([o, i], { localOnly: true }); _applyStatAuditCardMode(); }, [FILE_O, FILE_I]);
  expect(await app.page.textContent('#svInfo')).toContain('⚠️ เห็นเฉพาะเครื่องนี้ (บันทึกขึ้น Cloud ไม่สำเร็จ)');
  await closeApp(app);
});

test('เรียงไม่ตรงก่อน · ชิปตัวกรอง · แบ่งหน้า 20 (ลำดับต่อเนื่อง) · Export Excel ครบทุกแถวของตัวกรอง ไม่ใช่เฉพาะหน้า', async ({ browser }) => {
  const app = await bootBare(browser);
  await seed(app.page, { pages: 25 });   // + PG-01..25 ไม่ตรงทั้งหมด → 39 แถว
  await app.page.evaluate(() => openStockValidatePopup());
  let d = await domRows(app.page);
  expect(d.length).toBe(20);
  expect(d.slice(0, 6).map((x) => x.sku)).toEqual(['D-EDIT', 'D-NONE', 'D-PART', 'NS-LIVE', 'PG-01', 'PG-02']);
  expect(await app.page.evaluate(() => [document.querySelector('#svPager [data-pg="info"]').textContent, document.getElementById('svPager').style.display]))
    .toEqual(['หน้า 1 / 2 (1–20)', 'flex']);
  await app.page.click('#svPager [data-pg="next"]');
  d = await domRows(app.page);
  expect([d.length, d[0].no, d[d.length - 1].sku]).toEqual([19, '21', 'R-OLD']);
  expect(d.filter((x) => x.res === 'ตรง').map((x) => x.sku)).toEqual(MATCH);
  // ชิป ไม่ตรง → กลับหน้า 1 · ยอดรวมของตัวกรอง
  const chips = await app.page.evaluate(() => [...document.querySelectorAll('#svBar .sv-chip')].map((b) => b.textContent));
  expect(chips).toEqual(['ทั้งหมด 39', '❌ ไม่ตรง 31', '✅ ตรง 8']);
  await app.page.click('#svBar [data-sv-filter="mismatch"]');
  expect(await app.page.evaluate(() => [_svPage, document.getElementById('svRowCount').textContent, document.querySelector('#svBar .sv-chip.active').dataset.svFilter]))
    .toEqual([1, '31 รายการ (จากทั้งหมด 39) · ไม่แสดง: ไม่มีข้อมูลสินค้า (R05) 1', 'mismatch']);
  await app.page.click('#svPager [data-pg="last"]');
  const xl = await app.page.evaluate(() => {
    let got = null; const orig = XLSX.writeFile;
    XLSX.writeFile = (wb, name) => { got = { name, sheet: wb.SheetNames[0], aoa: XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' }) }; };
    try { exportStockValidateExcel(); } finally { XLSX.writeFile = orig; }
    return got;
  });
  expect(xl.name).toMatch(/^stock_validate_SRC_\d{2}-\d{2}-\d{4}\.xlsx$/);
  expect(xl.sheet).toBe('Stock Validate');
  expect(xl.aoa[0]).toEqual(['รหัสสินค้า', 'ชื่อสินค้า', 'Stock ในระบบ (R01.102)', 'ยอดระบบ ณ', 'Stock นับจริง', 'Stock ที่ควรปรับ', 'ORDS', 'IRPS', 'ผล Diff (ORDS + IRPS)', 'ผลตรวจ', 'เลขที่เอกสาร', 'หมายเหตุ']);
  expect(xl.aoa.length - 1).toBe(31);   // ทุกแถวของตัวกรอง (หน้าที่เห็นมี 11)
  expect(xl.aoa.find((r) => r[0] === 'D-PART')).toEqual(['D-PART', 'สินค้า D-PART', 10, 'ตอน Confirm', 5, -5, -3, 0, -3, 'ไม่ตรง',
    'ORDSBY001 24/09/2026 14:43 ORDS 2, ORDSBY002 24/09/2026 14:43 ORDS 1', 'ต่าง -2']);
  expect(xl.aoa.find((r) => r[0] === 'D-EDIT')[11]).toBe('ใบ 📦 แก้เป็น 3 · ต่าง -1 · ตรงกับจำนวนที่แก้ในใบ 📦');
  expect(xl.aoa.find((r) => r[0] === 'NS-LIVE')[11]).toBe('ไม่ได้แช่ยอดระบบตอนตัดสิน — ใช้ R01 ล่าสุด · ต่าง -5');
  // ปิดแล้วเปิดใหม่ = ตัวกรอง "ทั้งหมด" หน้า 1 (ไม่จำของเดิม)
  await app.page.evaluate(() => { document.getElementById('stockValidateOverlay').style.display = 'none'; openStockValidatePopup(); });
  expect(await app.page.evaluate(() => [_svFilter, _svPage, document.querySelector('#svBar .sv-chip.active').dataset.svFilter, document.querySelectorAll('#svBody tr[data-sku]').length]))
    .toEqual(['all', 1, 'all', 20]);
  await closeApp(app);
});

test('สิทธิ์: เภสัชสาขายาเห็น · WH / ผู้ช่วย / PDA / สวิตช์ปิด ไม่เห็น · logout ระหว่างเปิด = ปิดป็อปอัพ', async ({ browser }) => {
  const app = await bootBare(browser);
  const vis = () => app.page.evaluate(() => { _applyStatAuditCardMode(); return [document.getElementById('stockValidatePanel').style.display, _stockValidateEnabled()]; });
  await seed(app.page);
  expect(await vis()).toEqual(['', true]);
  expect(await app.page.evaluate(() => [document.getElementById('stockValidateCount').textContent, document.getElementById('stockValidateCount').style.background]))
    .toEqual(['6', 'rgba(217, 48, 37, 0.9)']);
  for (const opt of [{ role: 'assistant' }, { branch: 'WH', role: 'supervisor', files: [] }]) {   // ไฟล์ SYSBRANCHID 0 ถูกปฏิเสธที่ WH — ไม่แนบ
    await seed(app.page, opt);
    expect([opt, await vis()]).toEqual([opt, ['none', false]]);
  }
  await seed(app.page);
  await app.page.evaluate(() => { STOCK_VALIDATE = false; openStockValidatePopup(); });
  expect(await vis()).toEqual(['none', false]);
  expect(await app.page.evaluate(() => document.getElementById('stockValidateOverlay').style.display)).toBe('none');
  // logout ระหว่างเปิด
  await seed(app.page);
  await app.page.evaluate(() => openStockValidatePopup());
  expect(await app.page.evaluate(() => document.getElementById('stockValidateOverlay').style.display)).toBe('flex');
  await app.page.evaluate(() => { currentRole = ''; currentUser = ''; updateAdjustDocPanel(); });
  expect(await app.page.evaluate(() => [document.getElementById('stockValidateOverlay').style.display, document.getElementById('stockValidatePanel').style.display])).toEqual(['none', 'none']);
  // PDA (UA) — แผงซ้ายซ่อนบน PDA อยู่แล้ว ไม่ต้องคำนวณ
  await app.page.evaluate(() => Object.defineProperty(navigator, 'userAgent', { value: 'Mozilla/5.0 StockCountPDA', configurable: true }));
  await seed(app.page);
  expect(await vis()).toEqual(['none', false]);
  await closeApp(app);
});

test('รีเฟรชเองผ่าน hub (_applyStatAuditCardMode) คงหน้าเดิม · ใบที่มาทีหลังเปลี่ยนผลตรวจ + badge · กัน XSS', async ({ browser }) => {
  const app = await bootBare(browser);
  await seed(app.page, { pages: 25 });
  await app.page.evaluate(() => { _applyStatAuditCardMode(); openStockValidatePopup(); setStockValidatePage(2); });
  expect(await app.page.textContent('#stockValidateCount')).toBe('31');
  await app.page.evaluate(([o, i, i2]) => { __erp([o, i, i2]); _applyStatAuditCardMode(); }, [FILE_O, FILE_I, FILE_I2]);
  expect(await app.page.evaluate(() => [_svPage, document.getElementById('stockValidateCount').textContent])).toEqual([2, '30']);
  const r = (await svRows(app.page)).rows.find((x) => x.sku === 'D-NONE');
  expect([r.state, r.irps, r.net]).toEqual(['match', 2, 2]);
  // XSS: ชื่อสินค้า + เลขที่ใบเป็นข้อความ ไม่ถูกตีความเป็น HTML
  await app.page.evaluate(() => setStockValidateFilter('match'));
  const x = await app.page.evaluate(() => {
    const tr = [...document.querySelectorAll('#svBody tr[data-sku]')];
    const ords = tr.find((t) => t.dataset.sku === 'D-XSS').children[6];
    return { xss: [window.__SVXSS, window.__SVXSS2], img: document.querySelectorAll('#svBody img').length, attrs: ords.getAttributeNames(),
      name: tr.find((t) => t.dataset.sku === 'D-IRPS').children[2].textContent, title: ords.title };
  });
  expect(x).toEqual({ xss: [undefined, undefined], img: 0, attrs: ['style', 'title'], name: '<img src=x onerror="window.__SVXSS=1">ยา IRPS',
    title: 'ORDS" ONMOUSEOVER="__SVXSS2=1 · 24/09/2026 14:43 · ORDS 1' });
  await closeApp(app);
});

test('คลิกในป็อปอัพไม่ดึงโฟกัสไปช่องสแกน (_loginModalOpen รู้จัก stockValidateOverlay) · ปิดแล้วกลับช่องสแกน', async ({ browser }) => {
  const app = await bootBare(browser);
  await seed(app.page);
  await app.page.evaluate(() => {
    for (const el of document.querySelectorAll('[id$="Modal"],[id$="Overlay"]')) if (el.style.display === 'flex') el.style.display = 'none';
    document.getElementById('stockValidatePanel').style.display = '';
  });
  // ตัวเทียบ: ไม่มีป็อปอัพเปิด → คลิกพื้นที่ว่างแล้วโฟกัสไปช่องสแกน (ตัวดักคลิกเดิมทำงานจริง)
  await app.page.click('#stockValidatePanel h3');
  expect(await app.page.evaluate(() => document.activeElement && document.activeElement.id)).toBe('scanInput');
  await app.page.evaluate(() => { document.activeElement.blur(); openStockValidatePopup(); });
  await app.page.click('#svBody tr[data-sku] td:nth-child(3)');
  expect(await app.page.evaluate(() => document.activeElement && document.activeElement.id)).not.toBe('scanInput');
  await app.page.evaluate(() => closeStockValidatePopup());
  await app.page.waitForFunction(() => document.getElementById('stockValidateOverlay').style.display === 'none' && document.activeElement?.id === 'scanInput', null, { polling: 100 });
  await closeApp(app);
});

test('ตารางไม่ล้นที่หน้าต่าง 960px (แบ่งครึ่งจอคู่ ProMaxx) — หมายเหตุยาวขึ้นบรรทัดใหม่', async ({ browser }) => {
  const app = await bootBare(browser);
  await app.page.setViewportSize({ width: 960, height: 900 });
  // ข้อมูลยาวเท่าของจริง: เลขที่ใบ 18 ตัว (ORDSBY006260900001) · ชื่อสินค้าไทยยาว
  const real = (sheetRows) => sheetRows.map((r, i) => { if (!i) return r; const c = r.slice(); c[2] = c[2] === 'ORDSBY002' ? 'ORDSBY006260900002' : c[2].startsWith('IRPS') ? 'IRPSBY006260900001' : 'ORDSBY006260900001'; return c; });
  await seed(app.page, { files: [] });
  await app.page.evaluate(([o, i]) => {
    for (const si of state.skuMap.values()) si.productName = 'ยาทดสอบชื่อยาวเท่าของจริง พาราเซตามอล 500 มก. ชนิดเม็ด 10 แผง x 10 เม็ด';
    __erp([o, i]); openStockValidatePopup();
  }, [real(FILE_O), real(FILE_I)]);
  expect(await app.page.evaluate(() => document.querySelector('#svBody tr[data-sku="D-PART"]').children[6].title)).toContain('ORDSBY006260900002');
  const m = await app.page.evaluate(() => { const b = document.querySelector('#stockValidateCard .stock-popup-body'); return { body: b.clientWidth, table: b.querySelector('table').scrollWidth }; });
  expect(m.table, JSON.stringify(m)).toBeLessThanOrEqual(m.body);
  await closeApp(app);
});
