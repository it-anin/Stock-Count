// 🗂️ ประวัติปรับปรุง: 📥 นำเข้าประวัติย้อนหลังจาก ERP (7 ต.ค. 2026 · ผู้ใช้สั่ง — เคส SSS ออกใบ ORDS/IRPS ก่อนมีฟีเจอร์ประวัติ จึงไม่เคยถูกบันทึก)
//   ปุ่ม 📥 ในป็อปอัพ 🗂️ → เลือก R16.104 (ORDS) / R16.103 (IRPS) .CSV (ตัวอ่านเดียวกับการ์ด 🧾) → ตัวอย่าง → นำเข้าเป็นเอกสารในประวัติ (src:'erp' · Status "เข้าระบบแล้ว")
//   สวิตช์ ADJUST_DOC_HISTORY_IMPORT (false = ไม่มีปุ่ม = ทางถอย) · ที่เก็บเดียวกับประวัติ stock_sessions/{branch}_adjhist (fake Firestore: get + runTransaction)
//   fixture สังเคราะห์ล้วน (หัวคอลัมน์ตรงรูปแบบ R16 จริง 40 คอลัมน์ · ข้อมูลสมมติ) — ห้ามนำ CSV จริงเข้า repo
//
// เทสนี้ตรึง 12 ด้าน — ข้อ 2–3 สำคัญที่สุด: "นำเข้าแล้วเป็นประวัติอย่างเดียว ไม่ซ่อนแถวบนใบ/ไม่บล็อก Export" และ "เขียน cloud ไม่ผ่านต้องไม่เปลี่ยนอะไร"
//   1. ค่าเริ่มต้นที่ส่งมอบ (สวิตช์เปิด · ปุ่ม/ช่องเลือกไฟล์/modal มีใน DOM) + แผนนำเข้า (ฟังก์ชันบริสุทธิ์): เรียงเวลา · รวมบรรทัดซ้ำ SKU · ตัดก่อนรอบ/ยกเลิก · ข้ามเลขที่ซ้ำ
//   2. ★ flow เต็ม: เลือก 2 ไฟล์ → ตัวอย่าง (สรุป+รายการ) → นำเข้า → doc บน cloud (src:'erp' · rows [sku,q,q,null,'','']) → ตาราง 🗂️ ใหม่สุดอยู่บน · 📥 ERP · "เข้าระบบแล้ว" · 🗑
//   3. ★ ประวัติอย่างเดียว: แถวบนใบที่ SKU/จำนวนตรงกับใบที่นำเข้า "ยังอยู่" และนับในป้าย · Export แถวนั้นด้วยเลขใหม่ได้ · ใช้เลขที่ของใบที่นำเข้าซ้ำ = บล็อก · โหลดจาก cloud ซ้ำแล้วธง src ไม่หาย
//   4. นำเข้าไฟล์เดิมซ้ำ = ไม่มีเอกสารใหม่ (ไม่เขียน cloud) · ผสมใหม่+เก่า = นำเข้าเฉพาะใหม่ · เลขที่ซ้ำกับเอกสารที่ Export จากแอป = ข้าม
//   5. เครื่องอื่นนำเข้า/Export เลขเดียวกันระหว่างดูตัวอย่าง → transaction ข้ามเอง ไม่ทับ ไม่ซ้ำ
//   6. ไฟล์ผิด: รายงานเคลื่อนไหวที่หัวไม่ครบ · ไม่ใช่ทั้ง R16/รายงานเคลื่อนไหว · สาขาไม่ตรง (SYSBRANCHID 0 ที่ SSS) · ผสมไฟล์ดี+ผิด = ตัวอย่างของไฟล์ดี + error ของไฟล์ผิด
//      (7 ต.ค. 2026: รายงานเคลื่อนไหวสินค้า CF_ 45 คอลัมน์ที่หัวครบ "รับแล้ว" — ดู ข้อ 13)
//   7. ★ atomic: cloud ล้ม/ไม่มี _db/ใหญ่เกินเพดาน = ไม่เปลี่ยนอะไร · modal ค้างให้ลองใหม่ · กลับมาออนไลน์แล้วกดซ้ำสำเร็จ · สาขา/รอบเปลี่ยนระหว่างรอ = ไม่เขียน
//   8. 🗑 ลบเอกสารที่นำเข้า: ยืนยัน 2 ขั้น · ข้อความเฉพาะ · ไม่กระทบตาราง 📦 · เอกสารที่ Export จากแอปยังเป็น ↩ คืนรายการ
//   9. สิทธิ์/สาขา: WH · ผู้ช่วย · สวิตช์ปิด = ไม่มีปุ่ม/นำเข้าไม่ได้ · ปิด 📦 ปิด modal ตัวอย่าง
//  10. XSS: เลขที่ใบ/ชื่อไฟล์ที่มีอักขระ HTML ไม่ถูกตีความ (ตัวอย่าง + ตาราง)
//  11. ใบที่ไม่มีบรรทัดจำนวน > 0 ไม่ถูกนำเข้า · ค่าจำนวนทศนิยมคงเดิม
//  12. เรียงตามเวลาของเอกสารแม้เพิ่มทีหลัง (ใบ ERP ย้อนหลังไม่ขึ้นบนสุด) · เวลาเท่ากัน = เพิ่มทีหลังอยู่บน
//  13. รายงานเคลื่อนไหวสินค้า (CF_ 45 คอลัมน์ · ไฟล์เดียว ORDS+IRPS) นำเข้าได้ — แผน/ตัวอย่าง/เอกสารบน cloud เท่านำเข้า R16 สองไฟล์ (ใช้ตัวอ่านเดียวกับการ์ด 🧾)
const { test, expect, bootBare, closeApp } = require('../../lib/hooks');
const { fromR16 } = require('../../lib/movement-report');

const EPOCH = '2026-09-20T05:00:00.000Z';   // เริ่มรอบ 20 ก.ย. (เที่ยงวัน UTC — วันที่ท้องถิ่นไม่ขยับในเขตเวลาใกล้ไทย)
const T = '2026-09-21 09:00:00';
const HDR = ['SYSWAREHOUSEID', 'TRANDATE', 'TRANNO', 'REFERENCENO1', 'SYSVOUCHERID', 'SYSSALEID', 'TOTAL', 'TOTALVAT', 'GRANDTOTAL', 'FCANCEL',
  'TAXRATE', 'SYSPERSONID', 'SYSBRANCHID', 'FPROCESS', 'SCANCODE', 'ITEMNAME', 'SYSUNITID', 'BASEQUANTITY', 'QUANTITY', 'SYSITEMID', 'PRICE',
  'AMOUNT', 'DETAILNO', 'ITEMID', 'ITEMNAME', 'TOTALTRADDISCHAVEVAT', 'TOTALTRADDISCNONEVAT', 'FSTOCKMAIN', 'FMLDISCOUNTITEM', 'FMLDISCOUNTROW',
  'DISCOUNTPROMOTION', 'NAME', 'EMPID', 'CF_UNITNAME', 'CF_COMPANY', 'FNAME', 'CF_TRANEXTRAINFO_PRENAME', 'CF_TRANEXTRAINFO_FNAME',
  'CF_TRANEXTRAINFO_LNAME', 'CF_TRANDATE'];
function line({ date, no, sku, qty, wh = '0', cancel = '0', branch = '5' }) {
  const r = Array(HDR.length).fill('');
  r[0] = wh; r[1] = date; r[2] = no; r[9] = cancel; r[12] = branch; r[17] = String(qty); r[23] = sku; r[31] = 'สาขาทดสอบ SSS';
  return r;
}
const csv = (lines) => [HDR, ...lines].map((r) => r.join(',')).join('\r\n');
// R16.104 (ORDS): 001 = 24/9 (A01×2 · A02×1) · 002 = 25/9 (A03 สองบรรทัด 2+2 → รวมเป็นบรรทัดเดียว = 4) · 003 = ยกเลิก · 000 = ก่อนวันเริ่มรอบ (10/9)
// (บรรทัดจำนวน 0 ตัวอ่านนับเป็น "ข้อมูลไม่ครบ" ไม่เข้า docs — เส้นทาง "ใบไม่มีบรรทัด > 0" ทดสอบผ่าน _adjHistImportPlan ตรงๆ)
const ORDS_LINES = [
  line({ date: '24/9/2026 14:43:28', no: 'ORDSBY001', sku: 'A01', qty: 2 }),
  line({ date: '24/9/2026 14:43:28', no: 'ORDSBY001', sku: 'A02', qty: 1 }),
  line({ date: '25/9/2026 9:10:00', no: 'ORDSBY002', sku: 'A03', qty: 2 }),
  line({ date: '25/9/2026 9:10:00', no: 'ORDSBY002', sku: 'A03', qty: 2 }),
  line({ date: '26/9/2026 8:00:00', no: 'ORDSBY003', sku: 'A07', qty: 5, cancel: '1' }),
  line({ date: '10/9/2026 8:00:00', no: 'ORDSBY000', sku: 'A08', qty: 1 }),
];
const ORDS = csv(ORDS_LINES);
// R16.103 (IRPS): 001 = 24/9 13:33 (A04×3 · A05×1.5)
const IRPS_LINES = [
  line({ date: '24/9/2026 13:33:14', no: 'IRPSBY001', sku: 'A04', qty: 3 }),
  line({ date: '24/9/2026 13:33:14', no: 'IRPSBY001', sku: 'A05', qty: 1.5 }),
];
const IRPS = csv(IRPS_LINES);
const MOVE_INCOMPLETE = ['CF_TSYSBRANCHID,CF_ITEMID,CF_TRANNO,CF_TRANDATE,TRANDATE,CF_TDBASEQUANTITY', '5,A01,ORDSBY001,24/09/2026,24/9/2026 14:43:28,2.0000'].join('\r\n');   // หัวแบบรายงานเคลื่อนไหวแต่ไม่ครบ (ขาด CF_TSYSWAREHOUSEID) — ต้องถูกปฏิเสธ
const NOT_REPORT = 'A,B\r\n1,2';                                                         // ไม่ใช่ทั้ง R16 และรายงานเคลื่อนไหว
// รายงานเคลื่อนไหวสินค้าฉบับเต็ม (45 คอลัมน์ · ไม่มี FCANCEL) จากบรรทัดชุดเดียวกับ ORDS+IRPS ด้านบน (ไฟล์เดียวรวมขาออก+ขาเข้า) — บรรทัดยกเลิก (ORDSBY003) ถูกตัดทิ้ง เพราะรายงานนี้ไม่มีคอลัมน์ยกเลิก
const MOVE_ALL = fromR16([HDR, ...ORDS_LINES], [HDR, ...IRPS_LINES]).map((r) => r.join(',')).join('\r\n');
const WRONG_BRANCH = csv([line({ date: '24/9/2026 14:43:28', no: 'ORDSBY050', sku: 'A01', qty: 1, branch: '0' })]);
const DIRECT = (extra = {}) => ({ status: 'stock_adjustment', auditStatus: 'stock_adjustment', initialStatus: 'stock_adjustment', auditor: '',
  countedQty: 8, timestamp: T, firstScanAt: T, scannedBy: 'Asst', directAdj: true, ...extra });

// สาขา SSS · เภสัช · fake Firestore เฉพาะที่ใช้ (doc().get() + runTransaction get/set) · A01 = Stock Adj ตรง ORDS 2 (ระบบ 10 นับ 8) · A04 = IRPS 3 (ระบบ 10 นับ 13)
async function seed(page, { role = 'pharmacist', branch = 'SSS' } = {}) {
  await page.evaluate(({ role, branch, tpl, epoch }) => {
    ADJUST_DOC_PAGE_SIZE = 20; ADJUST_DOC_HISTORY = true; ADJUST_DOC_HISTORY_IMPORT = true; ADJUST_DOC_ERP_CHECK = true;
    currentBranch = branch; currentRole = role; currentUser = 'เภสัช'; _countResetAt = epoch;
    _branchScanPaused = false; _adjDocFilter = 'ords'; _adjDocPage = 1; _adjLoading = false;
    _adjHist = null; _adjHistReadToken++; _adjHistBusy = false; _adjHistImportBusy = false; _adjHistImportCur = null; _adjHistExpanded.clear(); _adjHistUndoArm = ''; _adjErp = null;
    _lotMap.clear(); _lotSelected.clear(); _priceMap.clear();
    state.skuMap.clear(); state.scanData.clear(); state.skuDirectMap.clear(); scanListMap.clear();
    document.getElementById('adjustDocPopupOverlay').style.display = 'flex';
    for (const id of ['adjHistPopupOverlay', 'adjDocNoModal', 'adjHistImportModal']) document.getElementById(id).style.display = 'none';
    window.__marked = []; _markSkuDirty = (s) => { window.__marked.push(String(s)); };
    window.__toasts = []; toast = (m) => { window.__toasts.push(String(m)); };
    _refreshAdjMaster = async () => {};
    window.__exports = []; window.__downloads = [];
    URL.createObjectURL = (b) => { window.__exports.push(b); return 'blob:captured'; };
    URL.revokeObjectURL = () => {};
    HTMLAnchorElement.prototype.click = function () { window.__downloads.push(this.download); };
    window.__store = {}; window.__fail = null; window.__writes = 0;
    const doc = (p) => ({ path: p, get: async () => { const d = window.__store[p]; return { exists: !!d, data: () => d }; } });
    _db = {
      collection: (c) => ({ doc: (id) => doc(c + '/' + id) }),
      runTransaction: async (fn) => {
        if (window.__fail) throw new Error(window.__fail);
        let pending = null;
        await fn({ get: async (r) => { const d = window.__store[r.path]; return { exists: !!d, data: () => d }; }, set: (r, data) => { pending = [r.path, data]; } });
        if (pending) { window.__writes++; window.__store[pending[0]] = { ...pending[1], updatedAt: { toDate: () => new Date('2026-10-07T09:05:00.000Z') } }; }
      },
    };
    const add = (sku, eff) => {
      state.skuMap.set(sku, { sku, productName: 'สินค้า ' + sku, unitPrice: 20, systemQty: 10, negSys: false, barcodes: [], isDel: false });
      state.skuDirectMap.set(sku, { barcode: 'B' + sku, unitName: 'เม็ด' });
      state.scanData.set(sku, { ...tpl, effectiveQty: eff, systemQty: 10 });
    };
    add('A01', 8);    // ORDS 2 — ขนาดเดียวกับบรรทัดในใบ ERP ORDSBY001 (ต้องไม่ถูกซ่อนเมื่อนำเข้า)
    add('A04', 13);   // IRPS 3
    add('B01', 8);    // ORDS 2 — ไม่เกี่ยวกับใบ ERP
  }, { role, branch, tpl: DIRECT(), epoch: EPOCH });
  await render(page);
}
const render = (page) => page.evaluate(() => { renderAdjustDocTable(true); updateAdjustDocCount(); });
const files = (...specs) => specs;   // [[ชื่อไฟล์, ข้อความ], …]
const importFiles = (page, specs) => page.evaluate(async (specs) => {
  await handleAdjHistImportFiles({ target: { files: specs.map(([n, t]) => new File([t], n, { type: 'text/csv' })) } });
}, specs);
const modal = (page) => page.evaluate(() => {
  const m = document.getElementById('adjHistImportModal');
  return { open: m.style.display === 'flex', summary: document.getElementById('adjHistImportSummary').innerText.replace(/\s+/g, ' ').trim(),
    list: [...document.querySelectorAll('#adjHistImportList tbody tr')].map((tr) => [...tr.children].map((td) => td.textContent.trim())),
    ok: document.getElementById('adjHistImportOk').textContent, okDisabled: document.getElementById('adjHistImportOk').disabled };
});
const confirmImport = (page) => page.evaluate(async () => { await confirmAdjHistImport(); });
const store = (page, key = 'stock_sessions/SSS_adjhist') => page.evaluate((k) => {
  const d = window.__store[k]; if (!d) return null;
  return { epoch: d.countResetAt, by: d.updatedBy, entries: JSON.parse(d.entries_json) };
}, key);
const toasts = (page) => page.evaluate(() => window.__toasts.slice());
const lastToast = async (page) => (await toasts(page)).at(-1);
const tableRows = (page) => page.evaluate(() => [...document.querySelectorAll('#adjHistBody > tr')].filter((tr) => tr.dataset.no).map((tr) => [...tr.children].map((td) => td.textContent.replace(/\s+/g, ' ').trim())));
const sheet = (page, dir = 'ords') => page.evaluate((d) => _buildAdjustDocRows(d).map((r) => r.sku), dir);
const badge = (page) => page.evaluate(() => document.getElementById('adjustDocCount').textContent);
const openHist = (page) => page.evaluate(() => { openAdjHistPopup(); });
const importAll = async (page) => { await importFiles(page, files(['16104ords_sss.CSV', ORDS], ['16103irps_sss.CSV', IRPS])); await confirmImport(page); };

test('ค่าเริ่มต้นที่ส่งมอบ: สวิตช์เปิด · ปุ่ม/ช่องเลือกไฟล์/modal ตัวอย่างมีใน DOM · ปุ่มเรียก openAdjHistImportPicker', async ({ browser }) => {
  const app = await bootBare(browser);                                                   // ยังไม่เรียก seed — ค่าตามที่ index.html ส่งมอบ
  expect(await app.page.evaluate(() => ADJUST_DOC_HISTORY_IMPORT)).toBe(true);
  expect(await app.page.evaluate(() => ['adjHistImportBtn', 'adjHistImportInput', 'adjHistImportModal', 'adjHistImportSummary', 'adjHistImportList', 'adjHistImportOk'].map((id) => !!document.getElementById(id)))).toEqual(Array(6).fill(true));
  expect(await app.page.evaluate(() => document.getElementById('adjHistImportBtn').getAttribute('onclick'))).toBe('openAdjHistImportPicker()');
  expect(await app.page.evaluate(() => document.getElementById('adjHistImportInput').getAttribute('onchange'))).toBe('handleAdjHistImportFiles(event)');
  expect(await app.page.evaluate(() => document.getElementById('adjHistImportInput').multiple)).toBe(true);
  await closeApp(app);
});

test('แผนนำเข้า (บริสุทธิ์): เรียงตามเวลา · รวมบรรทัดซ้ำ SKU · ตัดก่อนรอบ/ใบยกเลิก/จำนวน 0 · ข้ามเลขที่ซ้ำ · เวลาเป็น ISO', async ({ browser }) => {
  const app = await bootBare(browser);
  await seed(app.page);
  const out = await app.page.evaluate(async ({ ORDS, IRPS }) => {
    const parse = async (name, text) => { const p = _parseAdjErpRows(await _parseFileAsync(new File([text], name, { type: 'text/csv' })), 'SSS', _countResetAt); p.file = name; return p; };
    const plan = _adjHistImportPlan([await parse('o.CSV', ORDS), await parse('i.CSV', IRPS)], [{ no: 'ORDSBY002', dir: 'ords', at: '', by: 'x', rows: [] }], { by: 'เภสัช', at: '2026-10-07T01:00:00.000Z' });
    return { entries: plan.entries.map((e) => ({ no: e.no, dir: e.dir, src: e.src, file: e.file, impBy: e.impBy, impAt: e.impAt, by: e.by, localAt: _adjHistFmtAt(e.at), isoOk: /^\d{4}-\d{2}-\d{2}T/.test(e.at), rows: e.rows })),
      skippedExisting: plan.skippedExisting, lines: plan.lines, stats: plan.stats, files: plan.files };
  }, { ORDS, IRPS });
  // ORDSBY002 มีในประวัติแล้ว → ข้าม · ORDSBY003 ยกเลิก · ORDSBY000 ก่อนรอบ
  expect(out.entries.map((e) => e.no)).toEqual(['IRPSBY001', 'ORDSBY001']);              // เก่า → ใหม่: IRPS 13:33 ก่อน ORDS 14:43
  expect(out.entries[0]).toMatchObject({ dir: 'irps', src: 'erp', file: 'i.CSV', impBy: 'เภสัช', impAt: '2026-10-07T01:00:00.000Z', by: '', localAt: '24/09/2026 13:33', isoOk: true,
    rows: [['A04', 3, 3, null, '', ''], ['A05', 1.5, 1.5, null, '', '']] });
  expect(out.entries[1]).toMatchObject({ dir: 'ords', localAt: '24/09/2026 14:43', rows: [['A01', 2, 2, null, '', ''], ['A02', 1, 1, null, '', '']] });
  expect(out).toMatchObject({ skippedExisting: 1, lines: 4, files: ['o.CSV', 'i.CSV'] });
  expect(out.stats).toEqual({ beforeRound: 1, otherWh: 0, bad: 0, cancelledDocs: 1 });
  // ใบที่ไม่มีบรรทัดจำนวน > 0 ไม่ถูกนำเข้า (ไม่ใช่เอกสารว่าง)
  const empty = await app.page.evaluate(() => _adjHistImportPlan([{ file: 'z.CSV', stats: {}, docs: [{ no: 'ORDSZ', type: 'ORDS', day: '2026-09-24', at: '2026-09-24 10:00', items: { A01: 0 } }] }], [], {}));
  expect(empty.entries).toEqual([]);
  await closeApp(app);
});

test('★ flow เต็ม: เลือก 2 ไฟล์ → ตัวอย่าง → นำเข้า → doc บน cloud → ตาราง 🗂️ (ใหม่สุดอยู่บน · 📥 ERP · เข้าระบบแล้ว · 🗑)', async ({ browser }) => {
  const app = await bootBare(browser);
  await seed(app.page);
  await openHist(app.page);
  expect(await app.page.evaluate(() => document.getElementById('adjHistImportBtn').style.display)).toBe('');   // สาขายา + เภสัช = เห็นปุ่ม

  await importFiles(app.page, files(['16104ords_sss.CSV', ORDS], ['16103irps_sss.CSV', IRPS]));
  const m = await modal(app.page);
  expect(m.open).toBe(true);
  expect(m.summary).toBe('ไฟล์ 2: 16104ords_sss.CSV · 16103irps_sss.CSV นำเข้า 3 เอกสาร (ORDS 2 · IRPS 1) · 5 รายการ ข้าม: ใบยกเลิก 1 ใบ · ก่อนวันเริ่มรอบนับ 1 บรรทัด');
  expect(m.list).toEqual([                                                               // ใหม่สุดอยู่บน
    ['ORDSBY002', '🔻 ORDS', '25/09/2026 09:10', '1'],
    ['ORDSBY001', '🔻 ORDS', '24/09/2026 14:43', '2'],
    ['IRPSBY001', '🔺 IRPS', '24/09/2026 13:33', '2'],
  ]);
  expect(m).toMatchObject({ ok: '📥 นำเข้า 3 เอกสาร', okDisabled: false });
  expect(await store(app.page)).toBeNull();                                              // ดูตัวอย่างอย่างเดียว ยังไม่เขียน cloud

  await confirmImport(app.page);
  expect((await modal(app.page)).open).toBe(false);
  const st = await store(app.page);
  expect(st).toMatchObject({ epoch: EPOCH, by: 'เภสัช' });
  expect(st.entries.map((e) => e.no)).toEqual(['IRPSBY001', 'ORDSBY001', 'ORDSBY002']);   // เก่า → ใหม่ (ลำดับเก็บ)
  expect(st.entries[1]).toMatchObject({ no: 'ORDSBY001', dir: 'ords', src: 'erp', file: '16104ords_sss.CSV', impBy: 'เภสัช', by: '', rows: [['A01', 2, 2, null, '', ''], ['A02', 1, 1, null, '', '']] });
  expect(st.entries[1].impAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  expect(await lastToast(app.page)).toBe('📥 นำเข้าประวัติจาก ERP แล้ว 3 เอกสาร');

  expect(await tableRows(app.page)).toEqual([                                            // ตาราง 🗂️ วาดใหม่เอง (ป็อปอัพเปิดอยู่)
    ['▸ ORDSBY002', '🔻 ORDS', '25/09/2026 09:10', '📥 ERP', '1', 'เข้าระบบแล้ว', '🗑 ลบ'],
    ['▸ ORDSBY001', '🔻 ORDS', '24/09/2026 14:43', '📥 ERP', '2', 'เข้าระบบแล้ว', '🗑 ลบ'],
    ['▸ IRPSBY001', '🔺 IRPS', '24/09/2026 13:33', '📥 ERP', '2', 'เข้าระบบแล้ว', '🗑 ลบ'],
  ]);
  expect(await app.page.evaluate(() => document.getElementById('adjHistCount').textContent)).toBe('3');   // ปุ่มประวัติบน Header 📦
  expect(await app.page.evaluate(() => document.querySelector('#adjHistBody > tr[data-no="ORDSBY001"] td:nth-child(4)').title)).toMatch(/^นำเข้าจาก ERP โดย เภสัช · \d{2}\/\d{2}\/\d{4} \d{2}:\d{2} · ไฟล์ 16104ords_sss\.CSV$/);
  // ขยายดูรายการ: ชื่อจาก skuMap (ไม่มีใน skuMap = ว่าง) · ไม่มีราคา/LOT/EXP = —
  await app.page.evaluate(() => document.querySelector('#adjHistBody > tr[data-no="ORDSBY001"]').click());
  expect(await app.page.evaluate(() => [...document.querySelectorAll('#adjHistBody table tbody tr')].map((tr) => [...tr.children].map((td) => td.textContent.trim())))).toEqual([
    ['1', 'A01', 'สินค้า A01', '2', '—', '—', '—'],
    ['2', 'A02', '', '1', '—', '—', '—'],
  ]);
  await closeApp(app);
});

test('★ ประวัติอย่างเดียว: แถวบนใบที่ตรงกับใบ ERP ยังอยู่ + นับในป้าย · Export ด้วยเลขใหม่ได้ · ใช้เลขที่ของใบที่นำเข้าซ้ำ = บล็อก · โหลดจาก cloud ซ้ำแล้วธง src ไม่หาย', async ({ browser }) => {
  const app = await bootBare(browser);
  await seed(app.page);
  expect(await sheet(app.page)).toEqual(['A01', 'B01']);
  expect(await badge(app.page)).toBe('3');
  await importAll(app.page);
  expect((await store(app.page)).entries).toHaveLength(3);
  // A01 ORDS 2 ตรงกับบรรทัดใน ORDSBY001 (SKU+จำนวน) แต่เป็นประวัติอย่างเดียว → ห้ามหายจากใบ · ป้ายยังนับครบ
  expect(await sheet(app.page)).toEqual(['A01', 'B01']);
  expect(await badge(app.page)).toBe('3');
  expect(await app.page.evaluate(() => { const ix = _adjHistIndex(); return [ix.keys.size, ix.skus.size]; })).toEqual([0, 0]);   // ไม่มีเอกสารที่ Export จากแอป → ดัชนีซ่อนแถวว่าง

  // โหลดจาก cloud ซ้ำ (state ว่าง) → ธง src คงอยู่ → ยังไม่ซ่อนแถว
  await app.page.evaluate(async () => { _adjHist = null; await _loadAdjHistFromCloud(); });
  expect(await app.page.evaluate(() => _adjHistEntries().map((e) => e.src))).toEqual(['erp', 'erp', 'erp']);
  expect(await sheet(app.page)).toEqual(['A01', 'B01']);

  // Export แถวบนใบ (A01 + B01) ด้วยเลขที่เอกสารใหม่ → ไม่ถูกบล็อกเป็น "แถวทับ" ของใบที่นำเข้า
  const exportWith = async (no) => {
    await app.page.evaluate(() => document.getElementById('adjExportTextBtn').click());
    await app.page.evaluate((no) => { const i = document.getElementById('adjDocNoInput'); i.value = no; i.dispatchEvent(new Event('input', { bubbles: true })); }, no);
    await app.page.evaluate(async () => { await confirmAdjDocNo(); });
  };
  // เลขที่ซ้ำกับใบที่นำเข้า (ORDSBY001) → บล็อกที่ช่องกรอก ไม่ดาวน์โหลด
  await exportWith('ordsby001');
  expect(await app.page.evaluate(() => document.getElementById('adjDocNoErr').textContent)).toMatch(/^เลขที่เอกสารนี้ถูกใช้แล้ว \(24\/09\/2026 14:43\) — ใช้เลขอื่น$/);
  expect(await app.page.evaluate(() => window.__downloads)).toEqual([]);
  await app.page.evaluate(() => { const i = document.getElementById('adjDocNoInput'); i.value = 'ORDSAPP9'; i.dispatchEvent(new Event('input', { bubbles: true })); });
  await app.page.evaluate(async () => { await confirmAdjDocNo(); });
  expect(await app.page.evaluate(() => window.__downloads)).toHaveLength(1);
  const st = await store(app.page);
  expect(st.entries.map((e) => [e.no, e.src || 'app'])).toEqual([['IRPSBY001', 'erp'], ['ORDSBY001', 'erp'], ['ORDSBY002', 'erp'], ['ORDSAPP9', 'app']]);
  expect(await sheet(app.page)).toEqual([]);                                             // เอกสารที่ Export จากแอปซ่อนแถวตามปกติ
  await closeApp(app);
});

test('นำเข้าไฟล์เดิมซ้ำ = ไม่มีเอกสารใหม่ (ไม่เขียน) · ผสมใหม่+เก่า = นำเข้าเฉพาะใหม่ · เลขซ้ำกับเอกสารที่ Export จากแอป = ข้าม', async ({ browser }) => {
  const app = await bootBare(browser);
  await seed(app.page);
  // ใบเดียวกันอยู่ในสองไฟล์ (ส่งออกซ้ำคนละช่วง) → นำเข้าครั้งเดียว
  await importFiles(app.page, files(['a.CSV', IRPS], ['b.CSV', IRPS]));
  expect((await modal(app.page)).summary).toContain('นำเข้า 1 เอกสาร (ORDS 0 · IRPS 1)');
  await app.page.evaluate(() => closeAdjHistImportModal());
  await importFiles(app.page, files(['16103irps_sss.CSV', IRPS]));
  await confirmImport(app.page);
  expect((await store(app.page)).entries.map((e) => e.no)).toEqual(['IRPSBY001']);
  const w1 = await app.page.evaluate(() => window.__writes);

  // ซ้ำทั้งไฟล์ → ไม่มีเอกสารใหม่ · ปุ่มทำหน้าที่ "ปิด" · ไม่เขียน cloud
  await importFiles(app.page, files(['16103irps_sss.CSV', IRPS]));
  expect(await modal(app.page)).toMatchObject({ open: true, summary: 'ไฟล์ 1: 16103irps_sss.CSV ไม่มีเอกสารใหม่ให้นำเข้า ข้าม: มีในประวัติแล้ว 1 เอกสาร', list: [], ok: 'ปิด' });
  await confirmImport(app.page);
  expect((await modal(app.page)).open).toBe(false);
  expect(await app.page.evaluate(() => window.__writes)).toBe(w1);

  // ผสม: IRPS (มีแล้ว) + ORDS (ใหม่ 2 ใบ) → นำเข้า 2 · ข้าม 1
  await importFiles(app.page, files(['i.CSV', IRPS], ['o.CSV', ORDS]));
  expect((await modal(app.page)).summary).toContain('นำเข้า 2 เอกสาร (ORDS 2 · IRPS 0)');
  expect((await modal(app.page)).summary).toContain('มีในประวัติแล้ว 1 เอกสาร');
  await confirmImport(app.page);
  expect((await store(app.page)).entries.map((e) => e.no).sort()).toEqual(['IRPSBY001', 'ORDSBY001', 'ORDSBY002']);

  // เลขซ้ำกับเอกสารที่ Export จากแอป → ข้าม (ไม่ทับ ไม่ซ้ำ)
  await app.page.evaluate(() => { _adjHistApply('SSS', _countResetAt, [{ no: 'ORDSBY001', dir: 'ords', at: '2026-10-07T01:00:00.000Z', by: 'เภสัช', rows: [['A01', 2, 2, null, '', '']] }], 'x', ''); });
  await importFiles(app.page, files(['o.CSV', ORDS]));
  expect((await modal(app.page)).summary).toContain('นำเข้า 1 เอกสาร (ORDS 1 · IRPS 0)');                 // ORDSBY001 ข้าม เหลือ ORDSBY002
  await app.page.evaluate(() => closeAdjHistImportModal());
  await closeApp(app);
});

test('เครื่องอื่นนำเข้า/Export เลขเดียวกันระหว่างดูตัวอย่าง → transaction ข้ามเอง (ไม่ทับ ไม่ซ้ำ) · ข้ามทั้งหมดก็ไม่เขียน', async ({ browser }) => {
  const app = await bootBare(browser);
  await seed(app.page);
  await importFiles(app.page, files(['i.CSV', IRPS], ['o.CSV', ORDS]));
  expect((await modal(app.page)).ok).toBe('📥 นำเข้า 3 เอกสาร');
  // ระหว่างที่ผู้ใช้ดูตัวอย่าง: อีกเครื่องนำเข้า ORDSBY001 ไปแล้ว (คนละไฟล์/ผู้นำเข้า)
  await app.page.evaluate((epoch) => {
    window.__store['stock_sessions/SSS_adjhist'] = { countResetAt: epoch, updatedBy: 'Other', entries_json: JSON.stringify([{ no: 'ORDSBY001', dir: 'ords', at: '2026-09-24T07:43:00.000Z', by: '', src: 'erp', file: 'other.CSV', impBy: 'Other', impAt: '2026-10-07T02:00:00.000Z', rows: [['A01', 2, 2, null, '', '']] }]) };
  }, EPOCH);
  const w0 = await app.page.evaluate(() => window.__writes);
  await confirmImport(app.page);
  const st = await store(app.page);
  expect(st.entries.map((e) => [e.no, e.file])).toEqual([['ORDSBY001', 'other.CSV'], ['IRPSBY001', 'i.CSV'], ['ORDSBY002', 'o.CSV']]);   // ของเครื่องอื่นอยู่เดิม · ที่เหลือต่อท้ายตามเวลา
  expect(await lastToast(app.page)).toBe('📥 นำเข้าประวัติจาก ERP แล้ว 2 เอกสาร · ข้าม 1 (มีในประวัติแล้ว)');
  expect(await app.page.evaluate(() => window.__writes)).toBe(w0 + 1);
  expect(await app.page.evaluate(() => _adjHistEntries().length)).toBe(3);                // state ในเครื่องตามผลจริงบน cloud

  // ทุกใบถูกอีกเครื่องนำเข้าไปก่อนหมด → ข้ามทั้งหมด · ไม่เขียน
  await importFiles(app.page, files(['i.CSV', IRPS]));
  expect((await modal(app.page)).ok).toBe('ปิด');
  await app.page.evaluate(() => closeAdjHistImportModal());
  await closeApp(app);
});

test('ไฟล์ผิด: รายงานเคลื่อนไหวหัวไม่ครบ · ไม่ใช่ทั้ง R16/รายงาน · สาขาไม่ตรง · ผสมไฟล์ดี+ผิด = ตัวอย่างของไฟล์ดี + error ของไฟล์ผิด · ไม่เขียนอะไร', async ({ browser }) => {
  const app = await bootBare(browser);
  await seed(app.page);
  await importFiles(app.page, files(['02102sss.CSV', MOVE_INCOMPLETE]));
  expect((await modal(app.page)).open).toBe(false);
  expect(await lastToast(app.page)).toBe('02102sss.CSV: ไม่ใช่รายงานเคลื่อนไหวสินค้า จาก ProMaxx (ไม่พบคอลัมน์ CF_TSYSWAREHOUSEID)');

  await importFiles(app.page, files(['other.CSV', NOT_REPORT]));
  expect((await modal(app.page)).open).toBe(false);
  expect(await lastToast(app.page)).toBe('other.CSV: ไม่ใช่ไฟล์ R16 จาก ProMaxx (ไม่พบคอลัมน์ SYSWAREHOUSEID, TRANDATE, TRANNO, FCANCEL, SYSBRANCHID, BASEQUANTITY, ITEMID)');

  await importFiles(app.page, files(['wrong.CSV', WRONG_BRANCH]));
  expect((await modal(app.page)).open).toBe(false);
  expect(await lastToast(app.page)).toBe('wrong.CSV: ไฟล์เป็นของสาขาชากค้อ (SYSBRANCHID 0 · สาขาทดสอบ SSS) ไม่ใช่ SSS');

  await importFiles(app.page, files(['bad.CSV', NOT_REPORT], ['16103irps_sss.CSV', IRPS]));
  expect((await toasts(app.page)).at(-1)).toMatch(/^bad\.CSV: ไม่ใช่ไฟล์ R16/);
  expect(await modal(app.page)).toMatchObject({ open: true, list: [['IRPSBY001', '🔺 IRPS', '24/09/2026 13:33', '2']] });
  await app.page.evaluate(() => closeAdjHistImportModal());
  expect(await store(app.page)).toBeNull();                                              // ไม่มีอะไรถูกเขียนระหว่างทดลอง
  expect(await app.page.evaluate(() => _adjHistImportBusy)).toBe(false);                  // ปลดล็อกแล้ว เลือกไฟล์ใหม่ได้

  // ยกเลิกที่ตัวอย่าง = ไม่เขียน
  await importFiles(app.page, files(['i.CSV', IRPS]));
  await app.page.evaluate(() => document.querySelector('#adjHistImportCard button').click());   // ปุ่ม "ยกเลิก"
  expect((await modal(app.page)).open).toBe(false);
  expect(await store(app.page)).toBeNull();
  await closeApp(app);
});

test('★ รายงานเคลื่อนไหวสินค้า (CF_ 45 คอลัมน์ · ไฟล์เดียว ORDS+IRPS): แผน/ตัวอย่าง/เอกสารบน cloud เท่านำเข้า R16 สองไฟล์ (ต่างแค่ไม่มีใบยกเลิกให้ตัด)', async ({ browser }) => {
  const app = await bootBare(browser);
  await seed(app.page);
  // ระดับแผน: ทุกเอกสาร/บรรทัดเท่ากัน (ต่างแค่ชื่อไฟล์ กับจำนวนใบยกเลิกที่รายงานนี้ไม่มี)
  const eq = await app.page.evaluate(async ({ ORDS, IRPS, MOVE_ALL }) => {
    const parse = async (name, text) => { const p = _parseAdjErpRows(await _parseFileAsync(new File([text], name, { type: 'text/csv' })), 'SSS', _countResetAt); p.file = name; return p; };
    const meta = { by: 'เภสัช', at: '2026-10-07T01:00:00.000Z' };
    const a = _adjHistImportPlan([await parse('o.CSV', ORDS), await parse('i.CSV', IRPS)], [], meta);
    const b = _adjHistImportPlan([await parse('m.CSV', MOVE_ALL)], [], meta);
    const strip = (pl) => pl.entries.map((e) => ({ ...e, file: '' }));
    return { a: strip(a), b: strip(b), aLines: a.lines, bLines: b.lines, aStats: a.stats, bStats: b.stats };
  }, { ORDS, IRPS, MOVE_ALL });
  expect(eq.b.map((e) => e.no)).toEqual(['IRPSBY001', 'ORDSBY001', 'ORDSBY002']);        // ไม่ว่างเปล่า
  expect(eq.b).toEqual(eq.a);
  expect(eq.bLines).toBe(eq.aLines);
  expect(eq.aStats).toEqual({ beforeRound: 1, otherWh: 0, bad: 0, cancelledDocs: 1 });
  expect(eq.bStats).toEqual({ beforeRound: 1, otherWh: 0, bad: 0, cancelledDocs: 0 });

  // flow เต็ม: ไฟล์เดียว → ตัวอย่าง → นำเข้า → cloud → ตาราง 🗂️
  await openHist(app.page);
  await importFiles(app.page, files(['02102sss.CSV', MOVE_ALL]));
  const m = await modal(app.page);
  expect(m.open).toBe(true);
  expect(m.summary).toBe('ไฟล์ 1: 02102sss.CSV นำเข้า 3 เอกสาร (ORDS 2 · IRPS 1) · 5 รายการ ข้าม: ก่อนวันเริ่มรอบนับ 1 บรรทัด');
  expect(m.list).toEqual([
    ['ORDSBY002', '🔻 ORDS', '25/09/2026 09:10', '1'],
    ['ORDSBY001', '🔻 ORDS', '24/09/2026 14:43', '2'],
    ['IRPSBY001', '🔺 IRPS', '24/09/2026 13:33', '2'],
  ]);
  await confirmImport(app.page);
  const st = await store(app.page);
  expect(st.entries.map((e) => [e.no, e.src, e.file])).toEqual([['IRPSBY001', 'erp', '02102sss.CSV'], ['ORDSBY001', 'erp', '02102sss.CSV'], ['ORDSBY002', 'erp', '02102sss.CSV']]);
  expect(st.entries[1].rows).toEqual([['A01', 2, 2, null, '', ''], ['A02', 1, 1, null, '', '']]);
  expect(st.entries[2].rows).toEqual([['A03', 4, 4, null, '', '']]);                      // 2 บรรทัด (LOT) ของ SKU เดียวรวมกัน
  expect(await tableRows(app.page)).toEqual([
    ['▸ ORDSBY002', '🔻 ORDS', '25/09/2026 09:10', '📥 ERP', '1', 'เข้าระบบแล้ว', '🗑 ลบ'],
    ['▸ ORDSBY001', '🔻 ORDS', '24/09/2026 14:43', '📥 ERP', '2', 'เข้าระบบแล้ว', '🗑 ลบ'],
    ['▸ IRPSBY001', '🔺 IRPS', '24/09/2026 13:33', '📥 ERP', '2', 'เข้าระบบแล้ว', '🗑 ลบ'],
  ]);
  await closeApp(app);
});

test('★ atomic: cloud ล้ม/ไม่มี _db/ใหญ่เกินเพดาน = ไม่เปลี่ยนอะไร (modal ค้างให้ลองใหม่) · สาขา/รอบเปลี่ยนระหว่างรอ = ไม่เขียน', async ({ browser }) => {
  const app = await bootBare(browser);
  await seed(app.page);
  await importFiles(app.page, files(['i.CSV', IRPS]));

  await app.page.evaluate(() => { window.__fail = 'unavailable'; });
  await confirmImport(app.page);
  expect(await lastToast(app.page)).toBe('นำเข้าประวัติขึ้น Cloud ไม่สำเร็จ (unavailable) — ยังไม่ได้นำเข้า ลองใหม่');
  expect(await modal(app.page)).toMatchObject({ open: true, ok: '📥 นำเข้า 1 เอกสาร', okDisabled: false });
  expect(await store(app.page)).toBeNull();
  expect(await app.page.evaluate(() => _adjHist)).toBeNull();
  expect(await app.page.evaluate(() => _adjHistBusy)).toBe(false);                        // ปลดล็อกแล้ว — กดซ้ำได้

  await app.page.evaluate(() => { window.__fail = null; window.__db = _db; _db = null; });
  await confirmImport(app.page);
  expect(await lastToast(app.page)).toBe('นำเข้าประวัติขึ้น Cloud ไม่สำเร็จ (ไม่ได้เชื่อมต่อ Cloud) — ยังไม่ได้นำเข้า ลองใหม่');
  await app.page.evaluate(() => { _db = window.__db; });
  await confirmImport(app.page);                                                         // กลับมาออนไลน์ → สำเร็จจาก modal เดิม
  expect((await modal(app.page)).open).toBe(false);
  expect((await store(app.page)).entries.map((e) => e.no)).toEqual(['IRPSBY001']);

  // ใหญ่เกินเพดาน (≥ 800 KB) → ล้มเหมือนกัน · doc เดิมไม่ถูกแตะ
  await app.page.evaluate((epoch) => {
    window.__store['stock_sessions/SSS_adjhist'] = { countResetAt: epoch, updatedBy: 'x', entries_json: JSON.stringify([{ no: 'BIG', dir: 'irps', at: '2026-09-22T00:00:00.000Z', by: 'x'.repeat(850 * 1024), rows: [] }]) };
    _adjHist = null;
  }, EPOCH);
  await importFiles(app.page, files(['o.CSV', ORDS]));
  await confirmImport(app.page);
  expect(await lastToast(app.page)).toMatch(/^นำเข้าประวัติขึ้น Cloud ไม่สำเร็จ \(ประวัติใหญ่ \d+ KB ใกล้เพดาน Firestore — นำเข้าช่วงวันที่สั้นลง\) — ยังไม่ได้นำเข้า ลองใหม่$/);
  expect((await store(app.page)).entries.map((e) => e.no)).toEqual(['BIG']);
  await app.page.evaluate(() => closeAdjHistImportModal());

  // รอบนับเปลี่ยนระหว่างรอ (ผู้ใช้อีกเครื่องกดเริ่มนับใหม่) → ไม่เขียน
  await importFiles(app.page, files(['o.CSV', ORDS]));
  const w0 = await app.page.evaluate(() => window.__writes);
  await app.page.evaluate(() => { _countResetAt = '2026-10-01T00:00:00.000Z'; });
  await confirmImport(app.page);
  expect(await lastToast(app.page)).toBe('สาขา/รอบนับเปลี่ยนระหว่างรอ — ไม่ได้นำเข้า เลือกไฟล์ใหม่');
  expect((await modal(app.page)).open).toBe(false);
  expect(await app.page.evaluate(() => window.__writes)).toBe(w0);
  await closeApp(app);
});

test('กันกดซ้ำ: เลือกไฟล์ซ้อน/ยืนยันซ้ำพร้อมกัน = ทำครั้งเดียว · ปิด modal ระหว่างบันทึกไม่ได้', async ({ browser }) => {
  const app = await bootBare(browser);
  await seed(app.page);
  // เลือกไฟล์ซ้อนระหว่างอ่านไฟล์ครั้งแรก → ครั้งที่สองถูกกัน (toast) · modal เปิดครั้งเดียวตามผลของครั้งแรก
  await app.page.evaluate(async ({ IRPS }) => {
    const mk = () => ({ target: { files: [new File([IRPS], 'i.CSV', { type: 'text/csv' })] } });
    await Promise.all([handleAdjHistImportFiles(mk()), handleAdjHistImportFiles(mk())]);
  }, { IRPS });
  expect(await toasts(app.page)).toEqual(['กำลังทำรายการก่อนหน้า — รอสักครู่']);
  expect((await modal(app.page)).open).toBe(true);
  expect(await app.page.evaluate(() => _adjHistImportBusy)).toBe(false);

  // ยืนยันซ้ำพร้อมกัน → เขียน cloud ครั้งเดียว (ครั้งที่สองถูกกันด้วย busy)
  const w0 = await app.page.evaluate(() => window.__writes);
  await app.page.evaluate(async () => { await Promise.all([confirmAdjHistImport(), confirmAdjHistImport()]); });
  expect(await app.page.evaluate(() => window.__writes)).toBe(w0 + 1);
  expect((await store(app.page)).entries.map((e) => e.no)).toEqual(['IRPSBY001']);
  expect((await toasts(app.page)).filter((t) => t.startsWith('📥 นำเข้าประวัติจาก ERP แล้ว'))).toHaveLength(1);

  // ระหว่างบันทึก (busy) ปิด modal ตัวอย่างไม่ได้ (ไม่งั้นผู้ใช้ไม่เห็นผล) · พ้น busy แล้วปิดได้
  await importFiles(app.page, files(['o.CSV', ORDS]));
  await app.page.evaluate(() => { _adjHistBusy = true; closeAdjHistImportModal(); });
  expect((await modal(app.page)).open).toBe(true);
  await app.page.evaluate(() => { _adjHistBusy = false; closeAdjHistImportModal(); });
  expect((await modal(app.page)).open).toBe(false);
  await closeApp(app);
});

test('🗑 ลบเอกสารที่นำเข้า: ยืนยัน 2 ขั้น · ข้อความเฉพาะ · ไม่กระทบตาราง 📦 · เอกสารที่ Export จากแอปยังเป็น ↩ คืนรายการ', async ({ browser }) => {
  const app = await bootBare(browser);
  await seed(app.page);
  await importFiles(app.page, files(['i.CSV', IRPS]));
  await confirmImport(app.page);
  // เอกสารที่ Export จากแอป (ORDS A01+B01) ไว้เทียบปุ่ม
  await app.page.evaluate(() => document.getElementById('adjExportTextBtn').click());
  await app.page.evaluate(() => { const i = document.getElementById('adjDocNoInput'); i.value = 'ORDSAPP1'; });
  await app.page.evaluate(async () => { await confirmAdjDocNo(); });
  await openHist(app.page);
  const btn = (no, text) => app.page.evaluate(({ no, text }) => { [...document.querySelectorAll(`#adjHistBody button[data-no="${no}"]`)].find((b) => b.textContent.trim() === text).click(); }, { no, text });
  const cell = (no) => app.page.evaluate((no) => document.querySelector(`#adjHistBody > tr[data-no="${no}"]`).textContent.replace(/\s+/g, ' '), no);
  expect(await cell('IRPSBY001')).toContain('🗑 ลบ');
  expect(await cell('ORDSAPP1')).toContain('↩ คืนรายการ');

  await btn('IRPSBY001', '🗑 ลบ');
  expect(await cell('IRPSBY001')).toContain('ยืนยันลบ');
  expect(await cell('IRPSBY001')).toContain('ลบเฉพาะรายการในประวัตินี้ — ไม่กระทบใบใน ERP และตาราง 📦');
  expect((await store(app.page)).entries).toHaveLength(2);                               // ขั้นแรกยังไม่ลบ
  await btn('IRPSBY001', 'ไม่');
  expect(await cell('IRPSBY001')).not.toContain('ยืนยันลบ');
  const sheetBefore = await sheet(app.page, 'irps');
  await btn('IRPSBY001', '🗑 ลบ'); await btn('IRPSBY001', 'ยืนยันลบ');
  await app.page.waitForFunction(() => !_adjHistBusy);
  expect((await store(app.page)).entries.map((e) => e.no)).toEqual(['ORDSAPP1']);
  expect(await lastToast(app.page)).toBe('🗑 ลบเอกสาร IRPSBY001 ออกจากประวัติแล้ว');
  expect(await sheet(app.page, 'irps')).toEqual(sheetBefore);                            // ตาราง 📦 ไม่เปลี่ยน (ใบ ERP ไม่เคยซ่อนแถว)
  expect(await app.page.evaluate(() => document.getElementById('adjHistCount').textContent)).toBe('1');

  // เอกสารที่ Export จากแอปยังเป็น ↩ → แถวกลับตาราง (ข้อความเดิม)
  await btn('ORDSAPP1', '↩ คืนรายการ');
  expect(await cell('ORDSAPP1')).toContain('ยืนยันคืน');
  expect(await cell('ORDSAPP1')).toContain('ถ้าไฟล์นี้นำเข้า ERP ไปแล้ว การส่งซ้ำจะปรับสต็อกซ้ำ');
  await btn('ORDSAPP1', 'ยืนยันคืน');
  await app.page.waitForFunction(() => !_adjHistBusy);
  expect(await lastToast(app.page)).toBe('↩ คืนรายการของเอกสาร ORDSAPP1 กลับตารางแล้ว');
  expect(await sheet(app.page)).toEqual(['A01', 'B01']);
  await closeApp(app);
});

test('สิทธิ์/สาขา: WH · ผู้ช่วย · สวิตช์ปิด = ไม่มีปุ่ม/นำเข้าไม่ได้ · ปิด 📦 ปิด modal ตัวอย่างด้วย', async ({ browser }) => {
  const app = await bootBare(browser);
  const btnShown = (page) => page.evaluate(() => { _refreshAdjHistImportBtn(); return document.getElementById('adjHistImportBtn').style.display !== 'none'; });
  await seed(app.page);
  expect(await btnShown(app.page)).toBe(true);

  // สวิตช์ปิด → ปุ่มซ่อน · นำเข้าตรงๆ ก็ไม่ทำงาน (ไม่เปิด modal ไม่เขียน)
  await app.page.evaluate(() => { ADJUST_DOC_HISTORY_IMPORT = false; });
  expect(await btnShown(app.page)).toBe(false);
  await importFiles(app.page, files(['i.CSV', IRPS]));
  expect((await modal(app.page)).open).toBe(false);
  await app.page.evaluate(() => { ADJUST_DOC_HISTORY_IMPORT = true; });
  // เอกสารที่นำเข้าไว้แล้วยังแสดงตามปกติเมื่อปิดสวิตช์นำเข้า (สวิตช์นี้คุมแค่ปุ่ม)
  await importFiles(app.page, files(['i.CSV', IRPS])); await confirmImport(app.page);
  await app.page.evaluate(() => { ADJUST_DOC_HISTORY_IMPORT = false; renderAdjHistTable(); });
  expect((await tableRows(app.page)).map((r) => r[0])).toEqual(['▸ IRPSBY001']);
  await app.page.evaluate(() => { ADJUST_DOC_HISTORY_IMPORT = true; });

  // role ผู้ช่วย / WH → ไม่มีปุ่ม
  await app.page.evaluate(() => { currentRole = 'assistant'; });
  expect(await btnShown(app.page)).toBe(false);
  await seed(app.page, { role: 'supervisor', branch: 'WH' });
  expect(await btnShown(app.page)).toBe(false);
  expect(await app.page.evaluate(() => _adjHistEnabled())).toBe(true);                    // WH ยังใช้ประวัติปกติ — แค่นำเข้าจาก R16 ไม่รองรับ
  await importFiles(app.page, files(['i.CSV', IRPS]));
  expect((await modal(app.page)).open).toBe(false);
  // หัวหน้าสาขายาเห็นปุ่ม
  await seed(app.page, { role: 'supervisor', branch: 'KKL' });
  expect(await btnShown(app.page)).toBe(true);

  // ปิดป็อปอัพ 📦 ระหว่างดูตัวอย่าง → modal ตัวอย่างปิดตาม
  await seed(app.page);
  await importFiles(app.page, files(['i.CSV', IRPS]));
  expect((await modal(app.page)).open).toBe(true);
  await app.page.evaluate(() => closeAdjustDocPopup());
  expect((await modal(app.page)).open).toBe(false);
  expect(await app.page.evaluate(() => _adjHistImportCur)).toBeNull();
  await closeApp(app);
});

test('XSS: เลขที่ใบ/ชื่อไฟล์ที่มีอักขระ HTML ไม่ถูกตีความ (ตัวอย่าง + ตาราง + tooltip)', async ({ browser }) => {
  const app = await bootBare(browser);
  await seed(app.page);
  // ไม่ใส่เครื่องหมายคำพูดใน CSV (PapaParse มองเป็น quote ผิดรูป) — ใช้ < > & ซึ่งเป็นตัวที่ต้อง escape จริง
  const evil = csv([line({ date: '24/9/2026 14:43:28', no: 'ORDS<b>X&amp;<i>', sku: 'A01', qty: 2 })]);
  // ชื่อไฟล์มีเครื่องหมายคำพูด + แท็ก: ต้องไม่หลุดออกจาก attribute title (เพิ่ม onmouseover) และไม่สร้าง element
  await importFiles(app.page, files(['<img src=x onerror=1>a" onmouseover="x.CSV', evil]));
  expect(await app.page.evaluate(() => document.querySelectorAll('#adjHistImportModal img, #adjHistImportList b, #adjHistImportList i').length)).toBe(0);
  expect((await modal(app.page)).list[0][0]).toBe('ORDS<B>X&AMP;<I>');                    // แสดงเป็นข้อความดิบ (ตัวพิมพ์ใหญ่ตามตัวอ่าน) — &amp; ไม่ถูกแปลงเป็น &
  expect((await modal(app.page)).summary).toContain('<img src=x onerror=1>a" onmouseover="x.CSV');
  await confirmImport(app.page);
  await openHist(app.page);
  expect(await app.page.evaluate(() => document.querySelectorAll('#adjHistBody b, #adjHistBody i, #adjHistBody img').length)).toBe(0);
  expect((await tableRows(app.page))[0][0]).toBe('▸ ORDS<B>X&AMP;<I>');
  expect(await app.page.evaluate(() => document.querySelector('#adjHistBody > tr[data-no] td:nth-child(4)').title)).toContain('<img src=x onerror=1>a" onmouseover="x.CSV');
  expect(await app.page.evaluate(() => document.querySelectorAll('#adjHistBody [onmouseover], #adjHistImportModal [onmouseover]').length)).toBe(0);   // ไม่หลุดออกจาก attribute
  await closeApp(app);
});

test('เรียงตามเวลาของเอกสาร: ใบ ERP ย้อนหลังที่เพิ่มทีหลังไม่ขึ้นบนสุด · เวลาเท่ากัน = เพิ่มทีหลังอยู่บน · เอกสารที่ Export วันนี้อยู่บนสุด', async ({ browser }) => {
  const app = await bootBare(browser);
  await seed(app.page);
  // Export จากแอป "ตอนนี้" ก่อน แล้วค่อยนำเข้าใบ ERP ย้อนหลัง (24–25 ก.ย.) — ถ้าเรียงตามลำดับเพิ่ม ใบย้อนหลังจะลอยขึ้นบนสุดผิดๆ
  await app.page.evaluate(() => document.getElementById('adjExportTextBtn').click());
  await app.page.evaluate(() => { document.getElementById('adjDocNoInput').value = 'ORDSAPP1'; });
  await app.page.evaluate(async () => { await confirmAdjDocNo(); });
  await importAll(app.page);
  await openHist(app.page);
  await app.page.evaluate(() => { _adjHist.entries.find((e) => e.no === 'ORDSAPP1').at = '2026-10-07T01:00:00.000Z'; renderAdjHistTable(); });   // ตรึงเวลา (ไม่พึ่งนาฬิกาเครื่องที่รันเทส)
  expect((await tableRows(app.page)).map((r) => r[0].replace('▸ ', ''))).toEqual(['ORDSAPP1', 'ORDSBY002', 'ORDSBY001', 'IRPSBY001']);

  // เวลาเท่ากัน → ที่เพิ่มทีหลังอยู่บน
  await app.page.evaluate(() => {
    const t = '2026-10-01T03:00:00.000Z';
    _adjHistApply('SSS', _countResetAt, [{ no: 'T1', dir: 'ords', at: t, by: 'a', rows: [] }, { no: 'T2', dir: 'ords', at: t, by: 'b', rows: [] }], '', '');
    renderAdjHistTable();
  });
  expect((await tableRows(app.page)).map((r) => r[0].replace('▸ ', ''))).toEqual(['T2', 'T1']);
  await closeApp(app);
});
