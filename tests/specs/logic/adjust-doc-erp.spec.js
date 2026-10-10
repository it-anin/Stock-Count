// ใบ 📦 ปรับปรุงสินค้า: 🧾 ตรวจกับ ERP (ต.ค. 2026 · ผู้ใช้สั่ง — สาขายาเท่านั้น · Export ตามตัวกรองที่เลือก)
//   เภสัชแนบ R16.104 (ORDS) / R16.103 (IRPS) ที่ Export จาก ProMaxx → เห็นว่าแถวไหนในใบ "ทำเข้า ERP แล้ว" (ระบบไม่มี issuedAt)
//   สวิตช์ ADJUST_DOC_ERP_CHECK (ปิด = หน้าตา/Export เท่าเดิมทุกจุด) · เก็บผลที่ stock_sessions/{branch}_adjerp ผูก countResetAt
//
// เทสนี้ตรึง 9 ด้าน — ★ = ข้อที่พังแล้วเภสัชส่งของผิดเข้า ERP
//   1. parser: เฉพาะ ORDS/IRPS · รวมบรรทัดตาม LOT ต่อ SKU · ใบยกเลิก/คลังชากค้อ/ก่อนรอบ/ข้อมูลไม่ครบ ถูกตัดและนับ · coverage จากขาเอกสาร O/I · หาคอลัมน์จากชื่อ
//   2. parser ด่านสาขา: หลายสาขา · SRC ต้องเป็น 0 · KKL/SSS ต้องไม่ใช่ 0 (และไม่กรองคลัง) · คอลัมน์ขาด (FCANCEL) · ไม่ใช่ไฟล์ R16 · ไฟล์ว่าง
//   3. merge: ไฟล์ใหม่ทับเฉพาะช่วงของมันต่อชนิด · ใบที่หายจาก ERP ในช่วงนั้นถูกลบ · นอกช่วงคงเดิม · ใบยกเลิกลบเสมอ · ชนิดอื่นไม่ถูกแตะ
//   4. ★ สถานะต่อแถว: เข้าแล้ว/บางส่วน/เกิน/ยังไม่เข้า/ทิศตรงข้าม/ไม่ส่ง · ขอบล่างรายแถว (ใบก่อนวันที่นับไม่นับ) · ค่าที่แก้ใช้เป็นยอดที่ต้องส่ง · หลายใบรวมกัน
//   5. แสดงผล: คอลัมน์ ERP/ชิป/สรุป "มีใน ERP แต่ไม่อยู่ในแท็บ" เฉพาะแท็บที่มีไฟล์ · ไม่มีไฟล์ = หน้าตาเดิม
//   6. ★ ตัวกรอง + แบ่งหน้า + Export: กรองแล้วหน้า 1 · ลำดับต่อเนื่อง · Export จากหน้า 2 ได้ทุกแถวของตัวกรอง · "ทั้งหมด" = Text เท่าเดิมทุกไบต์ · Excel +3 คอลัมน์ · เตือนส่งซ้ำ
//   7. ทางถอย/ขอบเขต: สวิตช์ปิด = เดิมทุกจุด · WH ไม่เห็นอะไร · ตัวกรองรีเซ็ตเมื่อเปิดป็อปอัพ · แท็บที่ไม่มีไฟล์ไม่ถูกกรอง
//   8. cloud: บันทึก/อ่าน {branch}_adjerp (fake Firestore) · แนบไฟล์ที่สองรวมกับของบน cloud · รอบนับใหม่ = ว่าง · บันทึกล้ม/ใหญ่เกิน = เฉพาะเครื่องนี้ + บอก · ผลอ่านที่ถูกแซงถูกทิ้ง
//   9. การ์ด/ไฟล์: นามสกุลผิด → error ไม่ค้าง "กำลังตรวจ" · logout ล้าง
//  10. รายงานเคลื่อนไหวสินค้า (CF_ 45 คอลัมน์ · 7 ต.ค. 2026 · ผู้ใช้สั่ง — ไม่มี FCANCEL · ไม่มีป้ายบนการ์ด · ไม่มีสวิตช์): ผลเท่า R16 ทุกฟิลด์ · เวลาจาก TRANDATE · ด่านสาขา/คลังชุดเดียวกัน
//      · R16 ที่ขาด FCANCEL ยังถูกปฏิเสธ (ข้อยกเว้นเฉพาะรูปแบบนี้) · ★ แนบไฟล์เดียวที่การ์ด → สถานะต่อแถวเท่าแนบ R16.104+R16.103
//  11. ชื่อ+คำอธิบายการ์ด (7 ต.ค. 2026 · ผู้ใช้สั่ง): ชื่อ "ตรวจกับ ERP · R02.102" · "R02.102 อัปเดต วันที่ … เวลา …" รูปเดียวกับการ์ด LOT/ราคา · ชื่อรายงานตามที่แนบ (cover[t].rpt) · ชนิดที่ไม่มีข้อมูลบอกต่อท้าย
//      · คำเตือน "เฉพาะเครื่องนี้"/หมายเหตุสิ่งที่ถูกตัดไม่หาย · ช่วงของไฟล์/ผู้แนบอยู่ใน tooltip
// (ข้อมูลสังเคราะห์ทั้งหมด — ห้ามใช้ CSV จริง)
const { test, expect, bootBare, closeApp } = require('../../lib/hooks');
const { MHDR, msheet, fromR16 } = require('../../lib/movement-report');

const EPOCH = '2026-09-20T01:00:00.000Z';   // เริ่มรอบ = 20/09 (เวลาเครื่อง)
const SCAN = '2026-09-21 09:00:00';          // วันที่นับ = 21/09
const DIRECT = (extra = {}) => ({ status: 'stock_adjustment', auditStatus: 'stock_adjustment', initialStatus: 'stock_adjustment', auditor: '',
  countedQty: 8, timestamp: SCAN, firstScanAt: SCAN, scannedBy: 'Asst', directAdj: true, systemQty: 10, ...extra });

// หัวคอลัมน์ R16 ตามลำดับไฟล์จริง (32 คอลัมน์แรก) · ITEMNAME ซ้ำสองครั้งเหมือนของจริง
const HDR = ['SYSWAREHOUSEID', 'TRANDATE', 'TRANNO', 'REFERENCENO1', 'SYSVOUCHERID', 'SYSSALEID', 'TOTAL', 'TOTALVAT', 'GRANDTOTAL', 'FCANCEL',
  'TAXRATE', 'SYSPERSONID', 'SYSBRANCHID', 'FPROCESS', 'SCANCODE', 'ITEMNAME', 'SYSUNITID', 'BASEQUANTITY', 'QUANTITY', 'SYSITEMID', 'PRICE',
  'AMOUNT', 'DETAILNO', 'ITEMID', 'ITEMNAME', 'TOTALTRADDISCHAVEVAT', 'TOTALTRADDISCNONEVAT', 'FSTOCKMAIN', 'FMLDISCOUNTITEM', 'FMLDISCOUNTROW',
  'DISCOUNTPROMOTION', 'NAME'];
function line({ wh = '1', date = '22/9/2026 10:00', no, cancel = '0', branch = '0', sku, qty, name = 'สาขาทดสอบ' }) {
  const r = Array(HDR.length).fill('');
  r[0] = wh; r[1] = date; r[2] = no; r[9] = cancel; r[12] = branch; r[14] = sku || ''; r[17] = String(qty); r[18] = String(qty); r[23] = sku || ''; r[31] = name;
  return r;
}
const sheet = (lines) => [HDR.slice(), ...lines];
const csvText = (rows) => rows.map((r) => r.map((v) => (/[",\r\n]/.test(v) ? `"${String(v).replace(/"/g, '""')}"` : v)).join(',')).join('\r\n');

// R16.104 ของ SRC (ขาออก) — ช่วง 18/09 08:00 → 26/09 18:30
const FILE_O = sheet([
  line({ wh: '0', date: '18/9/2026 8:00', no: 'OTFIBY500', sku: 'A01', qty: 4 }),            // ขาออกอื่น (คลัง) — แค่ขยายช่วงของไฟล์
  line({ date: '22/9/2026 10:00', no: 'ORDSBY001', sku: 'A01', qty: 2 }),
  line({ date: '22/9/2026 10:00', no: 'ORDSBY001', sku: 'A02', qty: 1 }),
  line({ date: '22/9/2026 10:00', no: 'ORDSBY001', sku: 'A03', qty: 2 }),
  line({ date: '23/9/2026 11:00', no: 'ORDSBY002', sku: 'A03', qty: 1 }),
  line({ date: '23/9/2026 11:00', no: 'ORDSBY002', sku: 'A09', qty: 1 }),
  line({ date: '24/9/2026 9:00', no: 'ORDSBY003', sku: 'A09', qty: 1 }),
  line({ date: '24/9/2026 9:00', no: 'ORDSBY003', sku: 'ZZZ', qty: 5 }),                    // SKU ที่ไม่อยู่ในใบ
  line({ date: '20/9/2026 15:00', no: 'ORDSBY004', sku: 'A06', qty: 2 }),                   // ก่อนวันที่นับ A06 (21/09)
  line({ date: '22/9/2026 12:00', no: 'ORDSBY005', sku: 'A08', qty: 3 }),
  line({ date: '25/9/2026 13:00', no: 'ORDSBY006', sku: 'A10', qty: 1 }),                   // A10: 2 บรรทัด (2 LOT) รวม 2
  line({ date: '25/9/2026 13:00', no: 'ORDSBY006', sku: 'A10', qty: 1 }),
  line({ wh: '0', date: '22/9/2026 16:00', no: 'ORDSBY090', sku: 'A04', qty: 2 }),          // คลังชากค้อ — ไม่ใช่ของ SRC
  line({ date: '22/9/2026 17:00', no: 'ORDSBY091', cancel: '1', sku: 'A04', qty: 2 }),       // ใบยกเลิก
  line({ date: '19/9/2026 9:00', no: 'ORDSBY092', sku: 'A04', qty: 2 }),                    // ก่อนเริ่มรอบ
  line({ date: '22/9/2026 18:00', no: 'ORDSBY093', sku: '', qty: 2 }),                      // ข้อมูลไม่ครบ (ไม่มี SKU)
  line({ date: '26/9/2026 18:30', no: 'ORCMBY100', sku: 'A01', qty: 1 }),                   // บิลขาย — ไม่ใช่ใบปรับปรุง
]);
// R16.103 ของ SRC (ขาเข้า) — ช่วง 21/09 08:00 → 23/09 10:00
const FILE_I = sheet([
  line({ date: '21/9/2026 8:00', no: 'IRNCBY700', sku: 'B02', qty: 9 }),
  line({ date: '23/9/2026 10:00', no: 'IRPSBY001', sku: 'B01', qty: 2 }),
  line({ date: '23/9/2026 10:00', no: 'IRPSBY001', sku: 'A05', qty: 2 }),                   // A05 อยู่แท็บ ORDS → ทิศตรงข้าม
]);

async function boot(browser) {
  const app = await bootBare(browser);
  await app.page.evaluate(() => {
    window.__toasts = []; toast = (m, type) => { window.__toasts.push(`${type || 'info'}|${m}`); };
    window.__marked = []; _markSkuDirty = (s) => { window.__marked.push(String(s)); };
    _refreshAdjMaster = async () => {};
    window.__exports = [];
    URL.createObjectURL = (b) => { window.__exports.push(b); return 'blob:captured'; };
    URL.revokeObjectURL = () => {};
    HTMLAnchorElement.prototype.click = function () {};
  });
  return app;
}
// ใบ ORDS: A01…A10 (ขาด 2 ยกเว้น A07/A08 ขาด 3 แต่แก้เป็น 0) · ใบ IRPS: B01 เกิน 2 · B02 เกิน 3
async function seedScenario(page, { branch = 'SRC', role = 'pharmacist' } = {}) {
  await page.evaluate(({ branch, role, EPOCH, tpl }) => {
    ADJUST_DOC_ERP_CHECK = true; ADJUST_DOC_PAGE_SIZE = 20; ADJUST_DOC_QTY_EDIT = true; ADJUST_DOC_EXPORT_TEXT_BY_PAGE = true;
    currentBranch = branch; currentRole = role; currentUser = 'Pharm'; _countResetAt = EPOCH;
    _db = null; _adjErp = null; _adjErpFilter = 'all'; _adjErpBusy = false;
    _branchScanPaused = false; _adjDocFilter = 'ords'; _adjDocPage = 1; _adjLoading = false;
    _lotMap.clear(); _lotSelected.clear(); _priceMap.clear();
    state.skuMap.clear(); state.scanData.clear(); state.skuDirectMap.clear(); scanListMap.clear();
    const add = (sku, eff, extra = {}) => {
      state.skuMap.set(sku, { sku, productName: 'สินค้า ' + sku, unitPrice: 20, systemQty: 10, negSys: false, barcodes: [], isDel: false });
      state.skuDirectMap.set(sku, { barcode: 'B' + sku, unitName: 'เม็ด' });
      state.scanData.set(sku, { ...tpl, effectiveQty: eff, ...extra });
    };
    ['A01', 'A02', 'A03', 'A04', 'A05', 'A06'].forEach((s) => add(s, 8));
    add('A07', 7, { adjQty: 0, adjBase: -3, adjBy: 'Pharm', adjAt: '2026-09-25T00:00:00.000Z' });   // แก้เป็น 0 ไม่มีใน ERP → ไม่ส่ง
    add('A08', 7, { adjQty: 0, adjBase: -3, adjBy: 'Pharm', adjAt: '2026-09-25T00:00:00.000Z' });   // แก้เป็น 0 แต่ ERP มี 3 → เกิน
    add('A09', 8);
    add('A10', 8, { firstScanAt: '2026-07-19 09:00:00' });   // firstScanAt ของรอบเก่า → ขอบล่าง = วันเริ่มรอบ
    add('B01', 12); add('B02', 13);
  }, { branch, role, EPOCH, tpl: DIRECT() });
}
// แนบไฟล์ผ่าน handler จริง (File → parseFile → parser → merge → บันทึก)
const upload = (page, files) => page.evaluate(async (files) => {
  const list = files.map((f) => new File([f.text], f.name, { type: 'text/csv' }));
  await handleAdjErpFiles({ target: { files: list } });
}, files.map((f) => ({ name: f.name, text: csvText(f.rows) })));
const stateOf = (page, dir = 'ords') => page.evaluate((dir) => {
  const rows = _buildAdjustDocRows(dir);
  const ev = _adjErpEval(rows, dir);
  return Object.fromEntries(rows.map((r) => { const e = ev.get(r.sku); return [r.sku, e ? [e.state, e.got, e.need, e.docs.map((d) => d.no)] : null]; }));
}, dir);
const read = (page) => page.evaluate(() => {
  const trs = [...document.querySelectorAll('#adjustDocBody tr')].filter((tr) => tr.children.length > 1);
  const bar = document.getElementById('adjErpBar');
  const pager = document.getElementById('adjustDocPager');
  return {
    head: [...document.querySelectorAll('#adjustDocThead th')].map((th) => th.textContent.trim()),
    skus: trs.map((tr) => tr.children[1].textContent.trim()),
    nums: trs.map((tr) => Number(tr.children[0].textContent.trim())),
    erp: trs.map((tr) => (tr.children.length > 9 ? tr.children[9].querySelector('span').textContent.trim() : null)),
    count: document.getElementById('adjustDocRowCount').textContent,
    bar: getComputedStyle(bar).display === 'none' ? null : {
      chips: [...bar.querySelectorAll('.adj-erp-chip')].map((b) => [b.dataset.erpFilter, Number(b.querySelector('b').textContent), b.classList.contains('active')]),
      extra: (bar.querySelector('#adjErpExtra') || {}).textContent || '',
    },
    card: getComputedStyle(document.getElementById('adjErpCard')).display === 'none' ? null : document.getElementById('adjErpInfo').textContent,
    tip: document.getElementById('adjErpCard').title,                      // tooltip การ์ด: ชื่อสาขา · ช่วงของไฟล์ · ผู้แนบ · วิธีแนบ
    page: _adjDocPage,
    pager: getComputedStyle(pager).display === 'none' ? null : document.getElementById('adjPgInfo').textContent,
  };
});
const exportText = (page) => page.evaluate(async () => {
  const n = window.__exports.length;
  exportAdjustDocText();
  return window.__exports.length > n ? window.__exports[window.__exports.length - 1].text() : null;
});
const exportSheet = (page, name) => page.evaluate((name) => {
  let s = null; const orig = XLSX.writeFile;
  XLSX.writeFile = (wb) => { s = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '' }); };
  try { exportAdjustDocExcel(); } finally { XLSX.writeFile = orig; }
  return s;
}, name);
const lastToasts = (page, from) => page.evaluate((from) => window.__toasts.slice(from), from);
const toastCount = (page) => page.evaluate(() => window.__toasts.length);

test('parser: เฉพาะ ORDS/IRPS · รวม LOT ต่อ SKU · ตัดคลังชากค้อ/ใบยกเลิก/ก่อนรอบ/ข้อมูลไม่ครบ (นับไว้) · coverage จากขาเอกสาร · หาคอลัมน์จากชื่อ', async ({ browser }) => {
  const app = await boot(browser);
  const out = await app.page.evaluate(({ FILE_O, FILE_I, EPOCH }) => {
    const simp = (p) => ({ error: p.error, branchId: p.branchId, branchName: p.branchName, cover: p.cover, stats: p.stats, cancelled: p.cancelled,
      docs: Object.fromEntries(p.docs.map((d) => [d.no, [d.type, d.day, d.at, d.items]])) });
    // สลับลำดับคอลัมน์ทั้งไฟล์ → ต้องได้ผลเดิม (หาคอลัมน์จากชื่อ ไม่ fix index)
    const perm = FILE_O[0].map((_, i) => i).reverse();
    const shuffled = FILE_O.map((r) => perm.map((i) => r[i]));
    return { o: simp(_parseAdjErpRows(FILE_O, 'SRC', EPOCH)), i: simp(_parseAdjErpRows(FILE_I, 'SRC', EPOCH)),
      same: JSON.stringify(simp(_parseAdjErpRows(shuffled, 'SRC', EPOCH))) === JSON.stringify(simp(_parseAdjErpRows(FILE_O, 'SRC', EPOCH))) };
  }, { FILE_O, FILE_I, EPOCH });
  expect(out.o).toEqual({
    error: '', branchId: '0', branchName: 'สาขาทดสอบ',
    cover: { ORDS: { fromDay: '2026-09-18', toAt: '2026-09-26 18:30' } },                     // ไม่มีเอกสารขาเข้า = ตรวจ IRPS ไม่ได้
    stats: { adjLines: 15, otherWh: 1, beforeRound: 1, bad: 1, badDate: 0, cancelledDocs: 1 },
    cancelled: ['ORDSBY091'],
    docs: {
      ORDSBY001: ['ORDS', '2026-09-22', '2026-09-22 10:00', { A01: 2, A02: 1, A03: 2 }],
      ORDSBY002: ['ORDS', '2026-09-23', '2026-09-23 11:00', { A03: 1, A09: 1 }],
      ORDSBY003: ['ORDS', '2026-09-24', '2026-09-24 09:00', { A09: 1, ZZZ: 5 }],
      ORDSBY004: ['ORDS', '2026-09-20', '2026-09-20 15:00', { A06: 2 }],
      ORDSBY005: ['ORDS', '2026-09-22', '2026-09-22 12:00', { A08: 3 }],
      ORDSBY006: ['ORDS', '2026-09-25', '2026-09-25 13:00', { A10: 2 }],                       // 2 บรรทัด (LOT) รวมเป็น 2
    },
  });
  expect(out.i).toMatchObject({ error: '', cover: { IRPS: { fromDay: '2026-09-21', toAt: '2026-09-23 10:00' } },
    docs: { IRPSBY001: ['IRPS', '2026-09-23', '2026-09-23 10:00', { B01: 2, A05: 2 }] } });
  expect(out.i.cover.ORDS).toBeUndefined();
  expect(out.same).toBe(true);
  await closeApp(app);
});

test('parser ด่านสาขา/รูปแบบ: หลายสาขา · SRC ต้องเป็น 0 · KKL ต้องไม่ใช่ 0 และไม่กรองคลัง · ขาด FCANCEL · ไม่ใช่ R16 · ไฟล์ว่าง', async ({ browser }) => {
  const app = await boot(browser);
  const out = await app.page.evaluate(({ HDR, EPOCH, kkl, multi, otherBranch, onlyB }) => {
    const p = (rows, br) => _parseAdjErpRows(rows, br, EPOCH);
    const noCancel = [HDR.map((h) => (h === 'FCANCEL' ? 'XCANCEL' : h)), ...kkl.slice(1)];
    const k = p(kkl, 'KKL');
    return {
      kkl: { error: k.error, docs: k.docs.map((d) => [d.no, d.items]), otherWh: k.stats.otherWh },
      kklAsSrc: p(kkl, 'SRC').error,
      srcAsKkl: p(otherBranch, 'KKL').error,
      multi: p(multi, 'SSS').error,
      noCancel: p(noCancel, 'KKL').error,
      notR16: p(onlyB, 'KKL').error,
      empty: p([], 'KKL').error,
      headerOnly: p([HDR], 'KKL').error,
    };
  }, {
    HDR, EPOCH,
    kkl: sheet([line({ wh: '0', branch: '7', no: 'ORDSBY010', sku: 'K1', qty: 2 }), line({ wh: '2', branch: '7', no: 'ORDSBY011', sku: 'K2', qty: 1 })]),
    multi: sheet([line({ branch: '7', no: 'ORDSBY010', sku: 'K1', qty: 2 }), line({ branch: '8', no: 'ORDSBY012', sku: 'K2', qty: 1 })]),
    otherBranch: sheet([line({ branch: '0', no: 'ORDSBY010', sku: 'K1', qty: 2, name: 'ชากค้อ' })]),
    onlyB: sheet([line({ branch: '7', no: 'BYUSEBY001', sku: 'K1', qty: 2 })]),
  });
  expect(out.kkl).toEqual({ error: '', docs: [['ORDSBY010', { K1: 2 }], ['ORDSBY011', { K2: 1 }]], otherWh: 0 });   // KKL/SSS ไม่กรองคลัง
  expect(out.kklAsSrc).toContain('ไม่ใช่ของสาขา SRC');
  expect(out.srcAsKkl).toContain('ชากค้อ');
  expect(out.multi).toContain('หลายสาขา');
  expect(out.noCancel).toContain('FCANCEL');
  expect(out.notR16).toContain('ไม่พบเอกสาร');
  expect(out.empty).toBe('ไฟล์ว่าง');
  expect(out.headerOnly).toContain('รหัสสาขา');
  await closeApp(app);
});

// ── รายงานเคลื่อนไหวสินค้า: spec เดียวสร้างทั้ง R16 (line/sheet) และรายงานเคลื่อนไหว (msheet) → ต้องได้ผลเท่ากัน ──
const EQ_SRC = [
  { wh: '0', date: '18/9/2026 8:00', no: 'OTFIBY500', sku: 'A01', qty: 4 },        // ขาออกอื่น (คลัง) — ขยายช่วงของไฟล์เฉยๆ
  { date: '22/9/2026 10:00', no: 'ORDSBY001', sku: 'A01', qty: 2 },
  { date: '22/9/2026 10:00', no: 'ORDSBY001', sku: 'A02', qty: 1.5 },              // ทศนิยม · 2 บรรทัด (LOT) ต่อ SKU
  { date: '22/9/2026 10:00', no: 'ORDSBY001', sku: 'A02', qty: 1.5 },
  { date: '23/9/2026 11:00', no: 'ORDS260900007', sku: 'A03', qty: 1 },            // เลขเอกสารรูปแบบเก่า (ไม่มี BY)
  { wh: '0', date: '22/9/2026 16:00', no: 'ORDSBY090', sku: 'A04', qty: 2 },       // คลังชากค้อ — ไม่ใช่ของ SRC
  { date: '19/9/2026 9:00', no: 'ORDSBY092', sku: 'A04', qty: 2 },                 // ก่อนเริ่มรอบ
  { date: '22/9/2026 18:00', no: 'ORDSBY093', sku: '', qty: 2 },                   // ข้อมูลไม่ครบ
  { date: '23/9/2026 10:00', no: 'IRPSBY001', sku: 'B01', qty: 2 },
  { date: '23/9/2026 10:00', no: 'IRPSBY001', sku: 'A05', qty: 2 },
  { date: '24/9/2026 12:00', no: 'IRPS260900003', sku: 'B02', qty: 3 },
];
const EQ_KKL = [
  { wh: '0', branch: '7', date: '22/9/2026 10:00', no: 'ORDSBY010', sku: 'K1', qty: 2 },
  { wh: '2', branch: '7', date: '22/9/2026 11:00', no: 'ORDSBY011', sku: 'K2', qty: 1 },
  { wh: '1', branch: '7', date: '23/9/2026 9:00', no: 'IRPSBY010', sku: 'K1', qty: 1 },
];

test('รายงานเคลื่อนไหวสินค้า (CF_ 45 คอลัมน์): ผลเท่า R16 ทุกฟิลด์ · เวลาจาก TRANDATE ไม่ใช่ CF_TRANDATE · ด่านคลัง SRC / KKL ไม่กรอง · ไม่มีใบยกเลิก · หาคอลัมน์จากชื่อ', async ({ browser }) => {
  const app = await boot(browser);
  const out = await app.page.evaluate(({ r16, mov, kklR16, kklMov, EPOCH }) => {
    const simp = (p) => ({ error: p.error, branchId: p.branchId, branchName: p.branchName, cover: p.cover, stats: p.stats, cancelled: p.cancelled,
      docs: Object.fromEntries(p.docs.map((d) => [d.no, [d.type, d.day, d.at, d.items]])) });
    const perm = mov[0].map((_, i) => i).reverse();                                  // สลับลำดับคอลัมน์ทั้งไฟล์
    const shuffled = mov.map((r) => perm.map((i) => r[i]));
    return {
      srcR16: simp(_parseAdjErpRows(r16, 'SRC', EPOCH)), srcMov: simp(_parseAdjErpRows(mov, 'SRC', EPOCH)),
      kklR16: simp(_parseAdjErpRows(kklR16, 'KKL', EPOCH)), kklMov: simp(_parseAdjErpRows(kklMov, 'KKL', EPOCH)),
      shuffled: simp(_parseAdjErpRows(shuffled, 'SRC', EPOCH)),
    };
  }, { r16: sheet(EQ_SRC.map(line)), mov: msheet(EQ_SRC), kklR16: sheet(EQ_KKL.map(line)), kklMov: msheet(EQ_KKL), EPOCH });
  expect(out.srcMov).toEqual(out.srcR16);                                           // เท่า R16 ทุกฟิลด์ (docs/cover/stats/ชื่อสาขา)
  expect(out.shuffled).toEqual(out.srcMov);                                         // หาคอลัมน์จากชื่อ ไม่ fix ตำแหน่ง
  expect(out.srcMov).toEqual({
    error: '', branchId: '0', branchName: 'สาขาทดสอบ', cancelled: [],
    cover: { ORDS: { fromDay: '2026-09-18', toAt: '2026-09-23 11:00' }, IRPS: { fromDay: '2026-09-23', toAt: '2026-09-24 12:00' } },   // ไฟล์เดียวครอบทั้งสองชนิด
    stats: { adjLines: 10, otherWh: 1, beforeRound: 1, bad: 1, badDate: 0, cancelledDocs: 0 },                                       // คลังชากค้อ · ก่อนรอบ · ไม่มี SKU = ถูกตัดและนับ
    docs: {
      ORDSBY001: ['ORDS', '2026-09-22', '2026-09-22 10:00', { A01: 2, A02: 3 }],   // เวลา 10:00 มาจาก TRANDATE (CF_TRANDATE มีแต่วัน — ถ้าอ่านผิดจะเป็น 23:59) · 2 LOT ต่อ SKU รวมกัน
      ORDS260900007: ['ORDS', '2026-09-23', '2026-09-23 11:00', { A03: 1 }],
      IRPSBY001: ['IRPS', '2026-09-23', '2026-09-23 10:00', { B01: 2, A05: 2 }],
      IRPS260900003: ['IRPS', '2026-09-24', '2026-09-24 12:00', { B02: 3 }],
    },
  });
  expect(out.kklMov).toEqual(out.kklR16);
  expect(out.kklMov.docs).toEqual({                                                  // KKL ไม่กรองคลัง (wh 0 / 2 / 1 เข้าหมด)
    ORDSBY010: ['ORDS', '2026-09-22', '2026-09-22 10:00', { K1: 2 }],
    ORDSBY011: ['ORDS', '2026-09-22', '2026-09-22 11:00', { K2: 1 }],
    IRPSBY010: ['IRPS', '2026-09-23', '2026-09-23 09:00', { K1: 1 }],
  });
  expect(out.kklMov.stats.otherWh).toBe(0);

  // ด่านสาขา/รูปแบบของรายงานเคลื่อนไหว
  const g = await app.page.evaluate(({ EPOCH, sss, src, multi, noQty, hybrid, whole0 }) => {
    const p = (rows, br) => _parseAdjErpRows(rows, br, EPOCH);
    const w = p(whole0, 'SRC');
    return { sssAsSrc: p(sss, 'SRC').error, srcAsKkl: p(src, 'KKL').error, multi: p(multi, 'SSS').error, noQty: p(noQty, 'SRC').error,
      hybrid: p(hybrid, 'KKL').error, plain: p([['a', 'b'], ['1', '2']], 'SRC').error, whole0: [w.error, w.docs.length, w.stats.otherWh] };
  }, {
    EPOCH,
    sss: msheet([{ branch: '5', wh: '0', no: 'ORDSBY001', sku: 'K1', qty: 1, name: 'สวนเสือ' }]),
    src: msheet([{ branch: '0', wh: '1', no: 'ORDSBY001', sku: 'K1', qty: 1 }]),
    multi: msheet([{ branch: '7', no: 'ORDSBY010', sku: 'K1', qty: 2 }, { branch: '8', no: 'ORDSBY012', sku: 'K2', qty: 1 }]),
    noQty: msheet([{ no: 'ORDSBY001', sku: 'A01', qty: 1 }]).map((r) => r.filter((_, j) => j !== MHDR.indexOf('CF_TDBASEQUANTITY'))),   // ขาดคอลัมน์จำนวน
    // R16 ที่ขาด FCANCEL + แทรก CF_TRANNO เข้ามา → ต้องไม่หลุดเข้าทางรายงานเคลื่อนไหว (ข้อยกเว้น FCANCEL ใช้ได้เฉพาะหัวรายงานเคลื่อนไหวครบ)
    hybrid: [[...HDR.map((h) => (h === 'FCANCEL' ? 'XCANCEL' : h)), 'CF_TRANNO'], ...sheet([line({ branch: '7', no: 'ORDSBY010', sku: 'K1', qty: 2 })]).slice(1).map((r) => [...r, 'ORDSBY010'])],
    whole0: msheet([{ wh: '0', no: 'ORDSBY001', sku: 'A01', qty: 1 }, { wh: '0', no: 'IRPSBY001', sku: 'A02', qty: 1 }]),               // export คลังมาผิด
  });
  expect(g.sssAsSrc).toBe('ไฟล์ไม่ใช่ของสาขา SRC (SYSBRANCHID 5 · สวนเสือ)');         // ชื่อสาขาอ่านจาก CF_BNAME
  expect(g.srcAsKkl).toBe('ไฟล์เป็นของสาขาชากค้อ (SYSBRANCHID 0 · สาขาทดสอบ) ไม่ใช่ KKL');
  expect(g.multi).toContain('หลายสาขา');
  expect(g.noQty).toBe('ไม่ใช่รายงานเคลื่อนไหวสินค้า จาก ProMaxx (ไม่พบคอลัมน์ CF_TDBASEQUANTITY)');
  expect(g.hybrid).toContain('ไม่ใช่รายงานเคลื่อนไหวสินค้า');
  expect(g.plain).toBe('ไม่ใช่ไฟล์ R16 จาก ProMaxx (ไม่พบคอลัมน์ SYSWAREHOUSEID, TRANDATE, TRANNO, FCANCEL, SYSBRANCHID, BASEQUANTITY, ITEMID)');   // ข้อความเดิมของ R16 ไม่เปลี่ยน
  expect(g.whole0).toEqual(['', 0, 2]);                                              // SRC: export คลังมาทั้งไฟล์ = ไม่มีใบเข้า + นับว่าข้ามเพราะคลังอื่น (ไม่ปนเป็นของหน้าร้าน)
  await closeApp(app);
});

test('merge: ไฟล์ใหม่ทับเฉพาะช่วงของมัน · ใบที่หายจาก ERP ในช่วงถูกลบ · นอกช่วงคงเดิม · ใบยกเลิกถูกลบ · ชนิดอื่นไม่ถูกแตะ', async ({ browser }) => {
  const app = await boot(browser);
  const out = await app.page.evaluate(({ FILE_O, FILE_I, NEXT, LATE, EPOCH }) => {
    const flat = (m) => Object.fromEntries(Object.values(m.docs).map((d) => [d.no, d.items]));
    let m = _mergeAdjErp(null, _parseAdjErpRows(FILE_O, 'SRC', EPOCH), { at: 'T1', by: 'A' });
    m = _mergeAdjErp(m, _parseAdjErpRows(FILE_I, 'SRC', EPOCH), { at: 'T2', by: 'B' });
    const next = _parseAdjErpRows(NEXT, 'SRC', EPOCH); next.file = 'next.csv';
    m = _mergeAdjErp(m, next, { at: 'T3', by: 'C' });
    const afterNext = { docs: flat(m), cover: m.cover };
    // ใบยกเลิกต้องถูกลบแม้อยู่นอกช่วงของไฟล์ใหม่ (บรรทัดยกเลิกอ่านวันที่ไม่ได้) — ไม่พึ่งกติกาช่วงวันที่อย่างเดียว
    const late = _parseAdjErpRows(LATE, 'SRC', EPOCH);
    const afterLate = flat(_mergeAdjErp(m, late, { at: 'T4', by: 'D' }));
    return { ...afterNext, afterLate, lateCancelled: late.cancelled };
  }, {
    FILE_O, FILE_I, EPOCH,
    // ไฟล์ช่วง 22/09 09:00 เท่านั้น + บรรทัดยกเลิกของ ORDSBY006 (25/09) ที่วันที่ว่าง → 006 อยู่นอกช่วง ต้องถูกลบเพราะยกเลิก
    LATE: sheet([
      line({ date: '22/9/2026 9:00', no: 'ORCMBY400', sku: 'A01', qty: 1 }),
      line({ date: '', no: 'ORDSBY006', cancel: '1', sku: 'A10', qty: 1 }),
    ]),
    // ไฟล์ช่วง 22/09 08:00 → 24/09 18:00: ORDSBY001 คงเดิม · ORDSBY002 ถูกยกเลิก · ORDSBY003 ถูกแก้ (ตัด ZZZ) · ORDSBY005 หายจาก ERP · ORDSBY007 ใหม่
    NEXT: sheet([
      line({ date: '22/9/2026 8:00', no: 'ORCMBY199', sku: 'A01', qty: 1 }),
      line({ date: '22/9/2026 10:00', no: 'ORDSBY001', sku: 'A01', qty: 2 }),
      line({ date: '22/9/2026 10:00', no: 'ORDSBY001', sku: 'A02', qty: 1 }),
      line({ date: '22/9/2026 10:00', no: 'ORDSBY001', sku: 'A03', qty: 2 }),
      line({ date: '23/9/2026 11:00', no: 'ORDSBY002', cancel: '1', sku: 'A03', qty: 1 }),
      line({ date: '23/9/2026 11:00', no: 'ORDSBY002', cancel: '1', sku: 'A09', qty: 1 }),
      line({ date: '24/9/2026 9:00', no: 'ORDSBY003', sku: 'A09', qty: 1 }),
      line({ date: '24/9/2026 10:00', no: 'ORDSBY007', sku: 'A04', qty: 2 }),
      line({ date: '24/9/2026 18:00', no: 'ORCMBY200', sku: 'A01', qty: 1 }),
    ]),
  });
  expect(out.docs).toEqual({
    ORDSBY001: { A01: 2, A02: 1, A03: 2 },                                                       // อยู่ในไฟล์ใหม่ = คงเดิม
    ORDSBY003: { A09: 1 },                                                                        // ถูกแก้ = แทนทั้งใบ
    ORDSBY004: { A06: 2 },                                                                        // 20/09 ก่อนช่วงไฟล์ใหม่ = คงเดิม
    ORDSBY006: { A10: 2 },                                                                        // 25/09 หลังช่วงไฟล์ใหม่ = คงเดิม
    ORDSBY007: { A04: 2 },                                                                        // ใหม่
    IRPSBY001: { B01: 2, A05: 2 },                                                                // IRPS ไม่ถูกแตะ
  });                                                                                             // 002 ยกเลิก · 005 หายจาก ERP ในช่วง → ลบ
  // ช่วงที่ตรวจแล้วรวมเป็นช่วงกว้างสุด · ผู้แนบ/ไฟล์ล่าสุดของแต่ละชนิด
  expect(out.cover.ORDS).toEqual({ fromDay: '2026-09-18', toAt: '2026-09-26 18:30', at: 'T3', by: 'C', file: 'next.csv', rpt: 'R16.104' });
  expect(out.cover.IRPS).toMatchObject({ fromDay: '2026-09-21', toAt: '2026-09-23 10:00', by: 'B' });
  expect(out.lateCancelled).toEqual(['ORDSBY006']);
  expect(Object.keys(out.afterLate).sort()).toEqual(['IRPSBY001', 'ORDSBY001', 'ORDSBY003', 'ORDSBY004', 'ORDSBY007']);   // 006 หาย · 001 (10:00 หลังช่วง 09:00) คงเดิม
  await closeApp(app);
});

test('★ สถานะต่อแถว + แสดงผล: เข้าแล้ว/บางส่วน/เกิน/ยังไม่เข้า/ทิศตรงข้าม/ไม่ส่ง · ขอบล่างรายแถว · คอลัมน์/ชิป/สรุปเฉพาะแท็บที่มีไฟล์', async ({ browser }) => {
  const app = await boot(browser);
  await seedScenario(app.page);
  // ข้อความ "มีใบใน ERP แต่ไม่อยู่ในแท็บนี้" เป็นของเดิม = ทางถอยของ ADJ_ERP_LOT_AWARE (เปิดแล้วแทนด้วยปุ่ม "นอกใบ 📦" — ดู adj-erp-lot-aware.spec.js)
  // สถานะต่อแถวที่เทสนี้ตรวจไม่มีเคสสลับ LOT (A05 สุทธิ −2 ≠ 2 = ทิศตรงข้ามทั้งเปิด/ปิดสวิตช์)
  await app.page.evaluate(() => { ADJ_ERP_LOT_AWARE = false; _adjDocFilter = 'ords'; renderAdjustDocTable(); _refreshAdjErpCard(); });
  const before = await read(app.page);
  expect(before.head).toHaveLength(9);                                       // ยังไม่แนบ = หน้าตาเดิม
  expect(before.bar).toBeNull();
  expect(before.card).toContain('แนบ R02.102');

  // แนบแค่ R16.104 → ตรวจ ORDS ได้ · IRPS ยังไม่มีไฟล์
  await upload(app.page, [{ name: 'r16104.csv', rows: FILE_O }]);
  expect(await stateOf(app.page, 'ords')).toEqual({
    A01: ['done', 2, 2, ['ORDSBY001']],
    A02: ['partial', 1, 2, ['ORDSBY001']],
    A03: ['over', 3, 2, ['ORDSBY001', 'ORDSBY002']],
    A04: ['none', 0, 2, []],                                                   // ใบคลังชากค้อ/ยกเลิก/ก่อนรอบ ไม่นับ
    A05: ['none', 0, 2, []],                                                   // ยังไม่มีไฟล์ IRPS = ยังตัดสินทิศตรงข้ามไม่ได้
    A06: ['none', 0, 2, []],                                                   // ใบลง 20/09 ก่อนวันที่นับ (21/09) — ไม่ใช่ของการนับนี้
    A07: ['skip', 0, 0, []],
    A08: ['over', 3, 0, ['ORDSBY005']],                                        // แก้เป็น 0 (ไม่ส่ง) แต่ ERP มี 3
    A09: ['done', 2, 2, ['ORDSBY002', 'ORDSBY003']],                           // สองใบรวมกัน
    A10: ['done', 2, 2, ['ORDSBY006']],                                        // firstScanAt รอบเก่า → ขอบล่าง = วันเริ่มรอบ
  });
  expect(await stateOf(app.page, 'irps')).toEqual({ B01: null, B02: null });  // แท็บ IRPS ยังไม่มีไฟล์
  await app.page.evaluate(() => renderAdjustDocTable());
  const r1 = await read(app.page);
  expect(r1.head[9]).toBe('ERP');
  expect(r1.erp).toEqual(['✅ เข้าแล้ว', '⚠️ บางส่วน 1/2', '⚠️ เกิน 3/2', '⬜ ยังไม่เข้า', '⬜ ยังไม่เข้า', '⬜ ยังไม่เข้า', '— ไม่ส่ง', '⚠️ เกิน 3/0', '✅ เข้าแล้ว', '✅ เข้าแล้ว']);
  expect(r1.bar.chips).toEqual([['all', 10, true], ['none', 3, false], ['done', 3, false], ['issue', 3, false]]);
  expect(r1.bar.extra).toContain('ไม่อยู่ในแท็บนี้ 1 SKU');                   // ZZZ
  expect(r1.card).toMatch(/^R16\.104 อัปเดต วันที่ \d{2}\/\d{2}\/\d{4} เวลา \d{2}:\d{2} · IRPS: ยังไม่มีข้อมูล/);   // ชื่อรายงานตามที่แนบ + รูปเวลาเดียวกับการ์ด LOT/ราคา · ชนิดที่ไม่มีข้อมูลบอกต่อท้าย
  expect(r1.card).toContain('ข้ามใบของคลังชากค้อ 1 บรรทัด');
  expect(r1.card).toContain('ใบยกเลิก 1 ใบ');
  expect(r1.card).not.toContain('ถึง');                                         // ช่วงของไฟล์ย้ายไปอยู่ใน tooltip
  expect(r1.tip).toBe('ไฟล์ของ: สาขาทดสอบ\nORDS ถึง 26/09 18:30 · IRPS: ยังไม่มีข้อมูล\nแนบล่าสุดโดย Pharm\nกดเพื่อแนบ R02.102 (หรือ R16.104 / R16.103) · เลือกได้หลายไฟล์ · ไฟล์ใหม่ทับเฉพาะช่วงวันที่ของมัน');
  // เลขที่ใบ + tooltip ครบทุกใบ
  const a09 = await app.page.evaluate(() => {
    const tr = [...document.querySelectorAll('#adjustDocBody tr')].find((r) => r.children[1].textContent.trim() === 'A09');
    return [tr.children[9].textContent, tr.children[9].title];
  });
  expect(a09[0]).toContain('ORDSBY002 · 23/09 +1');
  expect(a09[1]).toBe('ORDSBY002 · 23/09/2026 11:00 · ORDS 1\nORDSBY003 · 24/09/2026 09:00 · ORDS 1');

  // แนบ R16.103 เพิ่ม → IRPS ตรวจได้ · A05 กลายเป็นทิศตรงข้าม · ORDS เดิมยังอยู่ (รวมไฟล์)
  await upload(app.page, [{ name: 'r16103.csv', rows: FILE_I }]);
  const s2 = await stateOf(app.page, 'ords');
  expect(s2.A05).toEqual(['opposite', 0, 2, ['IRPSBY001']]);
  expect(s2.A01).toEqual(['done', 2, 2, ['ORDSBY001']]);
  expect(await stateOf(app.page, 'irps')).toEqual({ B01: ['done', 2, 2, ['IRPSBY001']], B02: ['none', 0, 3, []] });
  await app.page.evaluate(() => setAdjDocFilter('irps', document.getElementById('adjBtnIrps')));
  const r2 = await read(app.page);
  expect(r2.erp).toEqual(['✅ เข้าแล้ว', '⬜ ยังไม่เข้า']);
  expect(r2.bar.extra).toContain('มีใบ IRPS ใน ERP แต่ไม่อยู่ในแท็บนี้ 1 SKU');   // A05
  expect(r2.card).toMatch(/^R16\.104 \+ R16\.103 อัปเดต วันที่ \d{2}\/\d{2}\/\d{4} เวลา \d{2}:\d{2}/);   // ครบทั้งสองชนิดจากสองรายงาน → ชื่อทั้งสอง · ไม่มี "ยังไม่มีข้อมูล"
  expect(r2.card).not.toContain('ยังไม่มีข้อมูล');
  await closeApp(app);
});

test('★ แนบรายงานเคลื่อนไหวสินค้า (ไฟล์เดียว ORDS+IRPS) ที่การ์ด 🧾 → สถานะต่อแถวเท่าแนบ R16.104+R16.103 · การ์ดไม่มีป้ายเพิ่ม · ไม่มีใบของชนิดไหน = แท็บนั้นยังไม่มีสถานะ', async ({ browser }) => {
  const app = await boot(browser);
  await seedScenario(app.page);
  // อ้างอิง: แนบ R16 สองไฟล์ → สถานะต่อแถวทั้งสองแท็บ
  await upload(app.page, [{ name: 'r16104.csv', rows: FILE_O }, { name: 'r16103.csv', rows: FILE_I }]);
  const ref = { ords: await stateOf(app.page, 'ords'), irps: await stateOf(app.page, 'irps') };
  expect(ref.ords.A05).toEqual(['opposite', 0, 2, ['IRPSBY001']]);                 // อ้างอิงไม่ว่างเปล่า — มีหลายสถานะ/ทิศ
  expect(ref.ords.A03[0]).toBe('over');
  expect(ref.irps.B01[0]).toBe('done');

  // รายงานเคลื่อนไหวไฟล์เดียวที่มีใบเดียวกัน (ตัดบรรทัดยกเลิกออก — รายงานนี้ไม่มีคอลัมน์ยกเลิก)
  await app.page.evaluate(() => { _adjErp = null; _adjErpFilter = 'all'; _refreshAdjErpCard(); renderAdjustDocTable(); });
  const t0 = await toastCount(app.page);
  await upload(app.page, [{ name: '02102src.CSV', rows: fromR16(FILE_O, FILE_I) }]);
  expect({ ords: await stateOf(app.page, 'ords'), irps: await stateOf(app.page, 'irps') }).toEqual(ref);
  await app.page.evaluate(() => renderAdjustDocTable());
  const r = await read(app.page);
  expect(r.card).toMatch(/^R02\.102 อัปเดต วันที่ \d{2}\/\d{2}\/\d{4} เวลา \d{2}:\d{2}/);   // ไฟล์เดียวครอบทั้งสองชนิด → ชื่อรายงานเดียว (ไม่ใช่ R16)
  expect(r.card).not.toContain('R16');
  expect(r.card).not.toContain('ยังไม่มีข้อมูล');                                   // ครบทั้ง ORDS/IRPS — ไม่มีชนิดไหนค้าง
  expect(r.card).not.toContain('ยกเลิก');                                           // ไม่มีป้าย/หมายเหตุเรื่องใบยกเลิกบนการ์ด (ผู้ใช้สั่ง)
  expect(r.tip).toContain('ORDS ถึง 26/09 18:30 · IRPS ถึง 23/09 10:00');          // ช่วงของไฟล์อยู่ใน tooltip
  expect(await app.page.evaluate(() => [_adjErp.cover.ORDS.rpt, _adjErp.cover.IRPS.rpt])).toEqual(['R02.102', 'R02.102']);   // ชื่อรายงานถูกจดลง cover (ซิงก์ผ่าน cloud ด้วย)
  expect(r.bar.chips.map((c) => c.slice(0, 2))).toEqual([['all', 10], ['none', 2], ['done', 3], ['issue', 4]]);   // ชิปเท่าผล R16 (A05 = ทิศตรงข้าม นับเป็น "ไม่ตรง")
  expect((await lastToasts(app.page, t0))[0]).toContain('ORDS 6 ใบ · IRPS 1 ใบ');

  // ไฟล์ที่มีแต่ใบ ORDS (ไม่มี IRPS เลย) → ตรวจ ORDS ได้ · แท็บ IRPS ยังไม่มีสถานะ (ไม่รู้ว่าครอบ IRPS หรือไม่ จึงไม่อ้าง "ยังไม่เข้า")
  await app.page.evaluate(() => { _adjErp = null; });
  await upload(app.page, [{ name: 'ords-only.CSV', rows: fromR16(FILE_O) }]);
  expect((await stateOf(app.page, 'ords')).A01).toEqual(['done', 2, 2, ['ORDSBY001']]);
  expect(await stateOf(app.page, 'irps')).toEqual({ B01: null, B02: null });
  expect((await read(app.page)).card).toMatch(/^R02\.102 อัปเดต วันที่ \d{2}\/\d{2}\/\d{4} เวลา \d{2}:\d{2} · IRPS: ยังไม่มีข้อมูล/);
  await closeApp(app);
});

test('การ์ด 🧾 คำอธิบาย: "<รายงาน> อัปเดต วันที่ … เวลา …" (รูปเดียวกับการ์ด LOT/ราคา) · ชื่อรายงานตามที่แนบ · ชนิดที่ไม่มีข้อมูลบอกต่อท้าย · คำเตือน/หมายเหตุไม่หาย · ช่วง/ผู้แนบอยู่ใน tooltip', async ({ browser }) => {
  const app = await boot(browser);
  // HTML เริ่มต้น (ก่อน JS ทับ) ต้องไม่ค้างข้อความ R16 เดิม — ชื่อการ์ด · คำอธิบาย · tooltip ปุ่ม 📥 ในประวัติ
  expect(await app.page.evaluate(() => document.querySelector('#adjErpCard .upload-file-name').textContent)).toBe('ตรวจกับ ERP · R02.102');
  expect(await app.page.evaluate(() => document.getElementById('adjErpInfo').textContent)).toBe('แนบ R02.102 จาก ProMaxx เพื่อดูว่ารายการไหนทำเข้าระบบแล้ว');
  expect(await app.page.evaluate(() => document.getElementById('adjHistImportBtn').title)).toBe('นำเข้าใบ ORDS/IRPS ที่ออกใน ProMaxx แล้ว (R02.102 เป็น .CSV) เป็นประวัติ — ไม่กระทบรายการบนใบ 📦');
  await seedScenario(app.page);
  // seed state ตรงๆ (เวลาเป็นเวลาท้องถิ่นไม่มี Z → ผลไม่ขึ้นกับ timezone ของเครื่องที่รันเทส)
  const card = (cover, extra = {}) => app.page.evaluate(({ cover, extra, EPOCH }) => {
    const C = (rpt, toAt) => ({ fromDay: '2026-09-18', toAt, at: '', by: '', file: 'x.csv', ...(rpt ? { rpt } : {}) });
    const c = {}; for (const [t, v] of Object.entries(cover)) if (v) c[t] = C(v[0], v[1]);
    _adjErp = { docs: {}, cover: c, branchName: 'สาขาทดสอบ', note: '', branch: 'SRC', epoch: EPOCH, updatedBy: 'Pharm', updatedAt: '2026-10-07T15:37:00', localOnly: false, ...extra };
    _adjErpBusy = false; _refreshAdjErpCard();
    return { text: document.getElementById('adjErpInfo').textContent, tip: document.getElementById('adjErpCard').title, badge: document.querySelector('#adjErpBadge span').textContent,
      done: document.getElementById('adjErpCard').classList.contains('adj-card-done') };
  }, { cover, extra, EPOCH });
  const TIP = 'กดเพื่อแนบ R02.102 (หรือ R16.104 / R16.103) · เลือกได้หลายไฟล์ · ไฟล์ใหม่ทับเฉพาะช่วงวันที่ของมัน';

  // รายงาน R02.102 ครอบทั้งสองชนิด → คำอธิบายสั้นบรรทัดเดียวตามที่ผู้ใช้สั่ง
  expect(await card({ ORDS: ['R02.102', '2026-09-26 18:30'], IRPS: ['R02.102', '2026-09-23 10:00'] })).toEqual({
    text: 'R02.102 อัปเดต วันที่ 07/10/2026 เวลา 15:37',
    tip: `ไฟล์ของ: สาขาทดสอบ\nORDS ถึง 26/09 18:30 · IRPS ถึง 23/09 10:00\nแนบล่าสุดโดย Pharm\n${TIP}`, badge: 'ตรวจแล้ว', done: true });
  // มีแค่ ORDS → IRPS บอกต่อท้ายว่ายังไม่มีข้อมูล (ไม่ใช่คำว่า "ไฟล์ R16.103" อีกแล้ว)
  expect((await card({ ORDS: ['R02.102', '2026-09-26 18:30'] })).text).toBe('R02.102 อัปเดต วันที่ 07/10/2026 เวลา 15:37 · IRPS: ยังไม่มีข้อมูล');
  // R16 สองไฟล์ · เอกสารเก่าบน cloud ที่ไม่มีฟิลด์ rpt → ถือเป็น R16 ตามชนิด · ปน R16.104 กับ R02.102
  expect((await card({ ORDS: ['R16.104', '2026-09-26 18:30'], IRPS: ['R16.103', '2026-09-23 10:00'] })).text).toBe('R16.104 + R16.103 อัปเดต วันที่ 07/10/2026 เวลา 15:37');
  expect((await card({ ORDS: [null, '2026-09-26 18:30'], IRPS: [null, '2026-09-23 10:00'] })).text).toBe('R16.104 + R16.103 อัปเดต วันที่ 07/10/2026 เวลา 15:37');
  expect((await card({ ORDS: ['R16.104', '2026-09-26 18:30'], IRPS: ['R02.102', '2026-09-23 10:00'] })).text).toBe('R16.104 + R02.102 อัปเดต วันที่ 07/10/2026 เวลา 15:37');
  // คำเตือน "เห็นเฉพาะเครื่องนี้" + หมายเหตุสิ่งที่ถูกตัด ต้องไม่หาย (ห้ามหายเงียบ) · ป้ายสถานะเปลี่ยนตาม
  const warn = await card({ ORDS: ['R02.102', '2026-09-26 18:30'], IRPS: ['R02.102', '2026-09-23 10:00'] }, { localOnly: true, note: 'ข้ามใบของคลังชากค้อ 3 บรรทัด · ก่อนเริ่มรอบนับ 2 บรรทัด' });
  expect(warn.text).toBe('R02.102 อัปเดต วันที่ 07/10/2026 เวลา 15:37 · ⚠️ เห็นเฉพาะเครื่องนี้ (บันทึกขึ้น Cloud ไม่สำเร็จ) · ข้ามใบของคลังชากค้อ 3 บรรทัด · ก่อนเริ่มรอบนับ 2 บรรทัด');
  expect(warn).toMatchObject({ badge: 'เฉพาะเครื่องนี้', done: false });
  // ไม่มีเวลาอัปเดต (ข้อมูลเก่า/อ่านไม่ได้) → ไม่เด้ง undefined/ว่าง
  expect((await card({ ORDS: ['R02.102', '2026-09-26 18:30'], IRPS: ['R02.102', '2026-09-23 10:00'] }, { updatedAt: '', updatedBy: '' })).text).toBe('R02.102 อัปเดตแล้ว');
  // ยังไม่ได้แนบ / กำลังอ่านไฟล์
  const idle = await app.page.evaluate(() => { _adjErp = null; _adjErpBusy = false; _refreshAdjErpCard(); return [document.getElementById('adjErpInfo').textContent, document.getElementById('adjErpCard').title, document.querySelector('#adjErpBadge span').textContent]; });
  expect(idle).toEqual(['แนบ R02.102 จาก ProMaxx ช่วงวันเริ่มรอบนับ–วันนี้ เพื่อดูว่ารายการไหนทำเข้าระบบแล้ว', TIP, 'ยังไม่ได้ตรวจ']);
  expect(await app.page.evaluate(() => { _adjErpBusy = true; _refreshAdjErpCard(); const r = [document.getElementById('adjErpInfo').textContent, document.querySelector('#adjErpBadge span').textContent]; _adjErpBusy = false; return r; }))
    .toEqual(['กำลังอ่านไฟล์และบันทึกผล…', 'กำลังตรวจ']);
  await closeApp(app);
});

test('★ ตัวกรอง + แบ่งหน้า + Export: กรองแล้วหน้า 1 · Export Text ตามหน้าที่เห็นของตัวกรอง (Excel ทุกแถวของตัวกรอง) · "ทั้งหมด" = Text เท่าเดิมทุกไบต์ (ต่อหน้า) · Excel +3 คอลัมน์ · เตือนส่งซ้ำ', async ({ browser }) => {
  const app = await boot(browser);
  await seedScenario(app.page);
  // ใบ ORDS 45 แถว (O001…O045 ขาด 2) · ERP: O001–O015 เข้าครบ · O016–O020 เข้า 1 · ที่เหลือ 25 ยังไม่เข้า
  await app.page.evaluate(({ tpl }) => {
    state.skuMap.clear(); state.scanData.clear(); state.skuDirectMap.clear();
    for (let i = 1; i <= 45; i++) {
      const sku = 'O' + String(i).padStart(3, '0');
      state.skuMap.set(sku, { sku, productName: 'สินค้า ' + sku, unitPrice: 20, systemQty: 10, negSys: false, barcodes: [], isDel: false });
      state.skuDirectMap.set(sku, { barcode: 'B' + sku, unitName: 'เม็ด' });
      state.scanData.set(sku, { ...tpl, effectiveQty: 8 });
    }
    _priceMap.set('O001', { unit: 'เม็ด', price: 5 });
  }, { tpl: DIRECT() });
  // ก่อนแนบ ERP = ไฟล์ "เดิม": สวิตช์ปิด = ทั้งแท็บ 45 บรรทัด (ทางถอย) · สวิตช์เปิด (ค่าเริ่มต้น) = หน้า 1 = 20 บรรทัดแรกของไฟล์เดิมทุกไบต์
  await app.page.evaluate(() => { ADJUST_DOC_EXPORT_TEXT_BY_PAGE = false; });
  const textAll = await exportText(app.page);
  await app.page.evaluate(() => { ADJUST_DOC_EXPORT_TEXT_BY_PAGE = true; });
  const textBase = await exportText(app.page);
  expect(textAll.trim().split('\r\n')).toHaveLength(45);
  expect(textBase).toBe(textAll.trim().split('\r\n').slice(0, 20).join('\r\n') + '\r\n');
  const sheetBase = await exportSheet(app.page, 'ORDS');                      // Excel = ทุกแถว ไม่ผูกกับหน้า
  const erpLines = [];
  for (let i = 1; i <= 20; i++) erpLines.push(line({ date: '22/9/2026 10:00', no: 'ORDSBY' + String(i).padStart(3, '0'), sku: 'O' + String(i).padStart(3, '0'), qty: i <= 15 ? 2 : 1 }));
  await upload(app.page, [{ name: 'r16104.csv', rows: sheet(erpLines) }]);
  await app.page.evaluate(() => renderAdjustDocTable());

  // ★ ตัวกรอง "ทั้งหมด" (ค่าเริ่มต้น) → Export Text เท่าไฟล์เดิมทุกไบต์ · Excel 9 คอลัมน์แรกเท่าเดิม + 3 คอลัมน์ ERP
  let n0 = await toastCount(app.page);
  expect(await exportText(app.page)).toBe(textBase);
  const t1 = await lastToasts(app.page, n0);
  expect(t1.some((t) => t === 'success|Export ORDS 20 รายการ (Text) สำเร็จ · หน้า 1/3 (แถวที่ 1–20 จาก 45)')).toBe(true);   // ไม่มีคำว่า "เฉพาะ" (ไม่ได้กรอง ERP)
  expect(t1.some((t) => t === 'warn|⚠️ 20 รายการในไฟล์นี้มีใบใน ERP แล้ว (เข้าแล้ว 15 · บางส่วน 5) — ตรวจก่อนนำเข้า ระวังส่งซ้ำ')).toBe(true);
  const sAll = await exportSheet(app.page, 'ORDS');
  expect(sAll[0]).toEqual([...sheetBase[0], 'ERP เข้าแล้ว', 'สถานะ ERP', 'เลขที่เอกสาร ERP']);
  expect(sAll.map((r) => r.slice(0, 9))).toEqual(sheetBase);
  expect(sAll[1].slice(9)).toEqual([2, 'เข้าแล้ว', 'ORDSBY001']);
  expect(sAll[16].slice(9)).toEqual([1, 'บางส่วน 1/2', 'ORDSBY016']);
  expect(sAll[21].slice(9)).toEqual([0, 'ยังไม่เข้า', '']);

  // ★ เตือนส่งซ้ำนับเฉพาะแถวในไฟล์ที่ส่งออก: หน้า 2 ของ "ทั้งหมด" (O021–O040) ไม่มีใบใน ERP เลย → ไม่เตือน (ทั้งที่ O001–O020 อยู่หน้า 1 มี)
  await app.page.evaluate(() => setAdjDocPage(2));
  n0 = await toastCount(app.page);
  const tAll2 = await exportText(app.page);
  expect(tAll2.trim().split('\r\n')).toHaveLength(20);
  expect(tAll2.trim().split('\r\n')[0]).toBe(textAll.trim().split('\r\n')[20]);
  const tAll2Toasts = await lastToasts(app.page, n0);
  expect(tAll2Toasts.some((t) => t === 'success|Export ORDS 20 รายการ (Text) สำเร็จ · หน้า 2/3 (แถวที่ 21–40 จาก 45)')).toBe(true);
  expect(tAll2Toasts.some((t) => t.includes('ระวังส่งซ้ำ'))).toBe(false);

  // ไปหน้า 2 ของ "ทั้งหมด" แล้วเลือก "ยังไม่เข้า" → กลับหน้า 1 · 25 แถว 2 หน้า · ลำดับต่อเนื่อง · ยอด "25 รายการ (จากทั้งหมด 45)"
  await app.page.evaluate(() => setAdjDocPage(2));
  await app.page.evaluate(() => document.querySelector('#adjErpBar [data-erp-filter="none"]').click());
  let r = await read(app.page);
  expect(r).toMatchObject({ page: 1, count: '25 รายการ (จากทั้งหมด 45)', pager: 'หน้า 1 / 2 (1–20)' });
  expect(r.skus[0]).toBe('O021'); expect(r.nums.slice(0, 2)).toEqual([1, 2]);
  expect(r.bar.chips).toEqual([['all', 45, false], ['none', 25, true], ['done', 15, false], ['issue', 5, false]]);
  await app.page.evaluate(() => setAdjDocPage(2));
  r = await read(app.page);
  expect(r).toMatchObject({ page: 2, skus: ['O041', 'O042', 'O043', 'O044', 'O045'], nums: [21, 22, 23, 24, 25] });

  // ★ Export Text จากหน้า 2 ของตัวกรอง = 5 แถวที่เห็น (O041–O045) ไม่ใช่ 25 ของตัวกรอง และไม่ใช่ 45 ของแท็บ · ไม่มีคำเตือนส่งซ้ำ
  n0 = await toastCount(app.page);
  const tNone2 = await exportText(app.page);
  const want = Array.from({ length: 25 }, (_, i) => 'O' + String(21 + i).padStart(3, '0'));
  expect(tNone2.trim().split('\r\n').map((l) => l.split('\t')[0])).toEqual(want.slice(20));
  expect(tNone2.trim().split('\r\n')[0]).toBe(textAll.trim().split('\r\n')[40]);   // บรรทัดเดียวกันทุกไบต์ — เปลี่ยนแค่ "แถวไหนถูกส่ง"
  const t2 = await lastToasts(app.page, n0);
  expect(t2.some((t) => t === 'success|Export ORDS 5 รายการ (Text) สำเร็จ · หน้า 2/2 (แถวที่ 21–25 จาก 25) · เฉพาะ ⬜ ยังไม่เข้า ERP')).toBe(true);
  expect(t2.some((t) => t.includes('ระวังส่งซ้ำ'))).toBe(false);
  // หน้า 1 ของตัวกรอง = 20 แถวแรกของตัวกรอง (O021–O040) · ตัวกรองจัดหน้าเองหลังกรอง ไม่ใช่หน้าของแท็บ
  await app.page.evaluate(() => setAdjDocPage(1));
  const tNone1 = await exportText(app.page);
  expect(tNone1.trim().split('\r\n').map((l) => l.split('\t')[0])).toEqual(want.slice(0, 20));
  expect(tNone1.trim().split('\r\n')[0]).toBe(textAll.trim().split('\r\n')[20]);
  // Excel = ทุกแถวของตัวกรอง (25) ไม่ผูกกับหน้า
  const sNone = await exportSheet(app.page, 'ORDS');
  expect(sNone.slice(1).map((x) => [x[0], x[1], x[10]])).toEqual(want.map((s, i) => [i + 1, s, 'ยังไม่เข้า']));

  // "ไม่ตรง" ที่เหลือ 5 แถว → Export ได้ 5 + เตือน (บางส่วน = ส่งเต็มจำนวนจะซ้ำส่วนที่เข้าไปแล้ว)
  await app.page.evaluate(() => setAdjErpFilter('issue'));
  n0 = await toastCount(app.page);
  const tIssue = await exportText(app.page);
  expect(tIssue.trim().split('\r\n').map((l) => l.split('\t')[0])).toEqual(['O016', 'O017', 'O018', 'O019', 'O020']);
  expect((await lastToasts(app.page, n0)).some((t) => t.startsWith('warn|⚠️ 5 รายการในไฟล์นี้มีใบใน ERP แล้ว (บางส่วน 5)'))).toBe(true);

  // ตัวกรองไม่เหลือแถว → ชิปยังอยู่ให้กดกลับ · ข้อความชัด · colspan 10 · Export ไม่ออกไฟล์
  await app.page.evaluate(() => { for (let i = 1; i <= 20; i++) state.scanData.delete('O' + String(i).padStart(3, '0')); setAdjErpFilter('done'); });
  r = await read(app.page);
  expect(r.skus).toEqual([]);
  expect(r.bar.chips[2]).toEqual(['done', 0, true]);
  expect(await app.page.evaluate(() => [document.querySelector('#adjustDocBody td').colSpan, document.getElementById('adjustDocBody').textContent.trim()])).toEqual([10, 'ไม่มีรายการในตัวกรองนี้']);
  n0 = await toastCount(app.page);
  expect(await exportText(app.page)).toBeNull();
  expect((await lastToasts(app.page, n0))[0]).toBe('warn|ไม่มีรายการให้ Export ตามแท็บที่เลือก · เฉพาะ ✅ เข้า ERP แล้ว');
  await closeApp(app);
});

test('ทางถอย/ขอบเขต: สวิตช์ปิด = เดิมทุกจุด · WH ไม่เห็นอะไร · ตัวกรองรีเซ็ตเมื่อเปิดป็อปอัพ · แท็บที่ไม่มีไฟล์ไม่ถูกกรอง', async ({ browser }) => {
  const app = await boot(browser);
  await seedScenario(app.page);
  await upload(app.page, [{ name: 'r16104.csv', rows: FILE_O }]);

  // ตัวกรองค้างที่ "ยังไม่เข้า" → สลับไป IRPS (ไม่มีไฟล์) = ไม่กรอง ไม่มีคอลัมน์ · กลับ ORDS = ยังกรองอยู่ · เปิดป็อปอัพใหม่ = "ทั้งหมด"
  await app.page.evaluate(() => setAdjErpFilter('none'));
  expect((await read(app.page)).skus).toEqual(['A04', 'A05', 'A06']);
  await app.page.evaluate(() => setAdjDocFilter('irps', document.getElementById('adjBtnIrps')));
  let r = await read(app.page);
  expect(r).toMatchObject({ skus: ['B01', 'B02'], bar: null, count: '2 รายการ' });
  expect(r.head).toHaveLength(9);
  await app.page.evaluate(() => setAdjDocFilter('ords', document.getElementById('adjBtnOrds')));
  r = await read(app.page);
  expect(r.skus).toEqual(['A04', 'A05', 'A06']);
  expect(r.bar.chips.find((c) => c[2])[0]).toBe('none');                       // ชิปไม่ถูก setAdjDocFilter ล้าง .active
  await app.page.evaluate(() => openAdjustDocPopup());
  r = await read(app.page);
  expect(r.skus).toHaveLength(10);
  expect(r.bar.chips[0]).toEqual(['all', 10, true]);

  // สวิตช์ปิด → ไม่มีการ์ด/คอลัมน์/ชิป · ตัวกรองที่ค้างไม่มีผล · Export Text/Excel = ไฟล์เดิม
  await app.page.evaluate(() => setAdjErpFilter('none'));
  const textOn = await exportText(app.page);
  await app.page.evaluate(() => { ADJUST_DOC_ERP_CHECK = false; _refreshAdjCards(); renderAdjustDocTable(); });
  r = await read(app.page);
  expect(r).toMatchObject({ card: null, bar: null, count: '10 รายการ · แก้จำนวน 2' });   // ตัวกรองที่ค้างไม่มีผล (ไม่มี "จากทั้งหมด")
  expect(r.head).toHaveLength(9);
  const n0 = await toastCount(app.page);
  const textOff = await exportText(app.page);
  expect(textOff.trim().split('\r\n')).toHaveLength(8);                          // A07/A08 แก้เป็น 0 ไม่ลงไฟล์เหมือนเดิม
  expect(textOn.trim().split('\r\n')).toHaveLength(3);                            // ตอนเปิดสวิตช์ กรอง "ยังไม่เข้า" ได้ 3
  expect((await lastToasts(app.page, n0)).some((t) => t.includes('ระวังส่งซ้ำ') || t.includes('เฉพาะ'))).toBe(false);
  expect((await exportSheet(app.page, 'ORDS'))[0]).toHaveLength(9);
  await app.page.evaluate(() => openAdjErpFilePicker());                         // ปิดสวิตช์ = ไม่เปิดตัวเลือกไฟล์
  // เปิดกลับ → ผลเดิมกลับมาเอง (ไม่ได้ลบข้อมูล)
  await app.page.evaluate(() => { ADJUST_DOC_ERP_CHECK = true; _refreshAdjCards(); renderAdjustDocTable(); });
  expect((await read(app.page)).head).toHaveLength(10);

  // WH (หัวหน้าคลัง) — ผู้ใช้เลือกสาขายาเท่านั้น: ไม่มีการ์ด/คอลัมน์แม้มีผลค้างในหน่วยความจำ · แนบไฟล์ไม่ทำอะไร
  await seedScenario(app.page, { branch: 'WH', role: 'supervisor' });
  await app.page.evaluate(({ EPOCH }) => { _adjErp = { branch: 'WH', epoch: EPOCH, docs: {}, cover: { ORDS: { fromDay: '2026-09-18', toAt: '2026-09-26 18:30' } } }; _refreshAdjCards(); renderAdjustDocTable(); }, { EPOCH });
  r = await read(app.page);
  expect(r).toMatchObject({ card: null, bar: null });
  expect(r.head).toHaveLength(9);
  const before = await toastCount(app.page);
  await upload(app.page, [{ name: 'r16104.csv', rows: FILE_O }]);
  expect(await toastCount(app.page)).toBe(before);
  await closeApp(app);
});

test('cloud: บันทึก/อ่าน {branch}_adjerp · ไฟล์ที่สองรวมกับของบน cloud · รอบนับใหม่ = ว่าง · ล้ม/ใหญ่เกิน = เฉพาะเครื่องนี้ + บอก · ผลอ่านที่ถูกแซงถูกทิ้ง · logout ล้าง', async ({ browser }) => {
  test.setTimeout(60_000);
  const app = await boot(browser);
  await seedScenario(app.page);
  // fake Firestore เฉพาะที่ใช้: collection().doc().get() + runTransaction(get/set)
  await app.page.evaluate(() => {
    window.__store = {}; window.__fail = null; window.__getGate = null;
    const ref = (p) => ({ path: p, get: async () => {
      if (window.__getGate) await window.__getGate;
      const d = window.__store[p]; return { exists: !!d, data: () => d };
    } });
    _db = {
      collection: (c) => ({ doc: (id) => ref(c + '/' + id) }),
      runTransaction: async (fn) => {
        if (window.__fail) throw new Error(window.__fail);
        let pending = null;
        await fn({ get: async (r) => { const d = window.__store[r.path]; return { exists: !!d, data: () => d }; }, set: (r, data) => { pending = [r.path, data]; } });
        if (pending) window.__store[pending[0]] = { ...pending[1], updatedAt: { toDate: () => new Date('2026-10-06T09:05:00.000Z') } };
      },
    };
  });
  await upload(app.page, [{ name: 'r16104.csv', rows: FILE_O }]);
  const saved = await app.page.evaluate(() => {
    const d = window.__store['stock_sessions/SRC_adjerp'];
    return { epoch: d.countResetAt, by: d.updatedBy, docs: JSON.parse(d.docs_json).map((x) => x.no).sort(), cover: Object.keys(JSON.parse(d.cover_json)), local: _adjErp.localOnly, name: d.branchName };
  });
  expect(saved).toEqual({ epoch: EPOCH, by: 'Pharm', docs: ['ORDSBY001', 'ORDSBY002', 'ORDSBY003', 'ORDSBY004', 'ORDSBY005', 'ORDSBY006'], cover: ['ORDS'], local: false, name: 'สาขาทดสอบ' });
  expect(await app.page.evaluate(() => window.__toasts.some((t) => t.startsWith('success|ตรวจกับ ERP แล้ว · ORDS 6 ใบ — บันทึกแล้ว')))).toBe(true);

  // เครื่องอื่นแนบ R16.103 (state ในเครื่องว่าง) → transaction รวมกับของบน cloud ไม่ทับ ORDS
  await app.page.evaluate(() => { _adjErp = null; });
  await upload(app.page, [{ name: 'r16103.csv', rows: FILE_I }]);
  expect(await app.page.evaluate(() => { const d = window.__store['stock_sessions/SRC_adjerp']; return [JSON.parse(d.docs_json).length, Object.keys(JSON.parse(d.cover_json)).sort()]; })).toEqual([7, ['IRPS', 'ORDS']]);

  // เปิดป็อปอัพบนอีกเครื่อง (ไม่มี state) → อ่านจาก cloud แล้วเห็นผลเดียวกัน
  await app.page.evaluate(() => { _adjErp = null; });
  await app.page.evaluate(() => _loadAdjErpFromCloud());
  expect((await stateOf(app.page, 'ords')).A05).toEqual(['opposite', 0, 2, ['IRPSBY001']]);
  const { card, tip } = await read(app.page);
  expect(card).toMatch(/^R16\.104 \+ R16\.103 อัปเดต วันที่ \d{2}\/\d{2}\/\d{4} เวลา \d{2}:\d{2}$/);   // ชื่อรายงานซิงก์มากับ cover บน cloud (ORDS จากเครื่องแรก · IRPS จากเครื่องที่สอง)
  expect(tip).toContain('ORDS ถึง 26/09 18:30 · IRPS ถึง 23/09 10:00');
  expect(tip).toContain('แนบล่าสุดโดย Pharm');

  // ผลอ่านที่ถูกแซง: เริ่มอ่าน (ค้างไว้) → แนบไฟล์ใหม่ระหว่างนั้น → ผลอ่านเก่ามาทีหลังต้องไม่ทับ
  await app.page.evaluate(() => {
    window.__store['stock_sessions/SRC_adjerp'] = { ...window.__store['stock_sessions/SRC_adjerp'] };
    window.__stale = JSON.parse(JSON.stringify(window.__store['stock_sessions/SRC_adjerp'].docs_json));
    let open; window.__getGate = new Promise((res) => { open = res; }); window.__openGate = open;
    window.__pendingLoad = _loadAdjErpFromCloud();
  });
  await upload(app.page, [{ name: 'more.csv', rows: sheet([line({ date: '26/9/2026 9:00', no: 'ORDSBY008', sku: 'A04', qty: 2 }), line({ date: '26/9/2026 18:30', no: 'ORCMBY300', sku: 'A01', qty: 1 })]) }]);
  expect((await stateOf(app.page, 'ords')).A04[0]).toBe('done');
  await app.page.evaluate(async () => { window.__store['stock_sessions/SRC_adjerp'].docs_json = window.__stale; window.__getGate = null; window.__openGate(); await window.__pendingLoad; });
  expect((await stateOf(app.page, 'ords')).A04[0]).toBe('done');                 // ไม่ถูกผลอ่านเก่าทับ

  // รอบนับใหม่ → ผลรอบเก่าไม่ใช้ (การ์ดกลับเป็น "ยังไม่ได้ตรวจ") · อ่าน cloud ที่เป็นรอบเก่า = ว่าง
  await app.page.evaluate(() => { _countResetAt = '2026-10-05T01:00:00.000Z'; _refreshAdjCards(); renderAdjustDocTable(); });
  let r = await read(app.page);
  expect(r).toMatchObject({ bar: null });
  expect(r.card).toContain('แนบ R02.102');
  await app.page.evaluate(() => _loadAdjErpFromCloud());
  expect(await app.page.evaluate(() => _adjErpCurrent())).toBeNull();
  await app.page.evaluate(() => { _countResetAt = '2026-09-20T01:00:00.000Z'; });

  // บันทึกล้ม → ใช้ในเครื่องนี้ + toast เตือน + ป้าย "เฉพาะเครื่องนี้" · อ่าน cloud ไม่ทับผลในเครื่อง
  await app.page.evaluate(() => { window.__fail = 'unavailable'; _adjErp = null; });
  await upload(app.page, [{ name: 'r16104.csv', rows: FILE_O }]);
  expect(await app.page.evaluate(() => [_adjErp.localOnly, window.__toasts.at(-1)])).toEqual([true, 'warn|ตรวจกับ ERP แล้ว · ORDS 6 ใบ — แต่บันทึกขึ้น Cloud ไม่สำเร็จ (unavailable) ผลนี้เห็นเฉพาะเครื่องนี้']);
  r = await read(app.page);
  expect(r.card).toContain('เห็นเฉพาะเครื่องนี้');
  expect(await app.page.evaluate(() => document.querySelector('#adjErpBadge span').textContent)).toBe('เฉพาะเครื่องนี้');
  await app.page.evaluate(() => _loadAdjErpFromCloud());
  expect(await app.page.evaluate(() => _adjErp.localOnly)).toBe(true);

  // ใหญ่เกินเพดาน (~12,000 ใบ) → ไม่เขียน cloud · ใช้ในเครื่องได้ · บอกให้ Export ช่วงสั้นลง
  await app.page.evaluate(() => { window.__fail = null; _adjErp = null; window.__store = {}; });
  const big = [];
  for (let i = 0; i < 12000; i++) big.push(line({ date: '22/9/2026 10:00', no: 'ORDSBYX' + String(i).padStart(6, '0'), sku: 'S' + i, qty: 1 }));
  await upload(app.page, [{ name: 'big.csv', rows: sheet(big) }]);
  expect(await app.page.evaluate(() => [!!window.__store['stock_sessions/SRC_adjerp'], _adjErp.localOnly, Object.keys(_adjErp.docs).length])).toEqual([false, true, 12000]);
  expect(await app.page.evaluate(() => window.__toasts.at(-1))).toContain('ใกล้เพดาน Firestore — Export R16 ช่วงสั้นลง');

  // logout (role หาย) → ล้างผลในเครื่อง
  await app.page.evaluate(() => { currentRole = ''; updateAdjustDocPanel(); });
  expect(await app.page.evaluate(() => [_adjErp, _adjErpFilter])).toEqual([null, 'all']);
  await closeApp(app);
});

test('ไฟล์ผิดประเภท/ไม่ใช่ R16 → error ชัด ไม่ค้าง "กำลังตรวจ" · ไฟล์ดีในชุดเดียวกันยังถูกใช้', async ({ browser }) => {
  const app = await boot(browser);
  await seedScenario(app.page);
  await app.page.evaluate(async ({ good }) => {
    const files = [new File(['x'], 'note.txt'), new File(['a,b\r\n1,2'], 'other.csv'), new File([good], 'r16104.csv')];
    await handleAdjErpFiles({ target: { files } });
  }, { good: csvText(FILE_O) });
  const out = await app.page.evaluate(() => ({ busy: _adjErpBusy, toasts: window.__toasts.slice(), covered: _adjErpCovered('ORDS'), badge: document.querySelector('#adjErpBadge span').textContent }));
  expect(out.busy).toBe(false);
  expect(out.toasts[0]).toBe('error|note.txt: รองรับเฉพาะไฟล์ .csv / .xlsx');
  expect(out.toasts[1]).toContain('error|other.csv: ไม่ใช่ไฟล์ R16 จาก ProMaxx (ไม่พบคอลัมน์');
  expect(out.covered).toBe(true);
  expect(out.badge).toBe('เฉพาะเครื่องนี้');                                    // _db = null ในเทสนี้ → บันทึกไม่ได้ แต่ใช้ในเครื่องได้
  await closeApp(app);
});
