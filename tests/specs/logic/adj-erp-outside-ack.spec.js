// ใบ 📦 → ใบใน ERP นอกใบ: ที่มาของแต่ละบรรทัด + "รับทราบ" พร้อมหมายเหตุ (11 ต.ค. 2026 · ผู้ใช้สั่ง · สวิตช์ ADJ_ERP_OUTSIDE_ACK)
//   ที่มา: "ออกจากแอป" = เลขที่ใบ+SKU ตรงกับที่ Export Text จากใบ 📦 (🗂️ ประวัติที่ไม่ใช่ 📥) · อื่นๆ = "ปรับปรุง LOT สินค้า"
//     (ผู้ใช้ยืนยัน: งานนอกแอปมีแต่ปรับปรุง LOT — ORDS ออกจาก LOT ที่ไม่มีของจริง + IRPS SKU เดิมเข้า LOT ใหม่)
//   รับทราบ: เก็บ stock_sessions/{branch}_adjerpack ผูกรอบนับ · ไม่นับเป็นคำเตือนอีกแต่ยังอยู่ในรายการ · ใบเปลี่ยน = หมดอายุ เตือนใหม่
//
// เทสนี้ตรึง — ★ = ข้อที่พังแล้วคำเตือนหายเงียบหรือหน้างานเข้าใจผิด
//   1. ค่าเริ่มต้นสวิตช์ + DOM
//   2. ★ ที่มาของบรรทัด (ออกจากแอป / ปรับปรุง LOT สินค้า · 📥 นำเข้าไม่นับเป็นออกจากแอป) + คำบอก "ไม่ครบคู่/ไม่เท่ากัน" เฉพาะบรรทัดนอกแอป
//   3. ★ รับทราบ → cloud → ปุ่ม/ตาราง/เรียงลำดับ/Excel · ยกเลิกรับทราบ · Enter/Escape
//   4. ★ มีใบใหม่หลังรับทราบ = กลับมาเตือน (ห้ามถูกกลบเงียบ)
//   5. ★ atomic: cloud ล้ม/ไม่มี _db = ไม่เปลี่ยนในเครื่อง · รอบนับอื่น = ว่าง · ผลอ่านเก่าถูกทิ้ง · สองเครื่องรับทราบคนละตัวไม่ทับกัน
//   6. ผู้ช่วย/สวิตช์ปิด = ไม่มีรับทราบ (ทุกตัวเป็นคำเตือนเหมือนเดิม) · กัน XSS ในหมายเหตุ
//   7. ตารางไม่ล้นป็อปอัพที่ 1280px (คอลัมน์รับทราบอยู่ขวาสุด — ล้นแล้วต้องเลื่อนหา)
// (ข้อมูลสังเคราะห์ทั้งหมด — ห้ามใช้ CSV จริง)
const { test, expect, bootBare, closeApp } = require('../../lib/hooks');

const EPOCH = '2026-08-05T01:00:00.000Z';
const SCAN = '2026-08-10 16:00:00';
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
// ORDSBY001 = ใบที่ Export จากแอป (IN-Y + P-APP) แล้วมีบรรทัดอื่นพิมพ์ต่อท้าย · ORDSBY002/IRPSBY002 = ปรับปรุง LOT ทำใน ProMaxx
const FILE_O = sheet([
  line({ date: '24/9/2026 14:43', no: 'ORDSBY001', sku: 'IN-Y', qty: 2 }),
  line({ date: '24/9/2026 14:43', no: 'ORDSBY001', sku: 'P-APP', qty: 1 }),
  line({ date: '24/9/2026 14:43', no: 'ORDSBY001', sku: 'LOT-UNEVEN', qty: 3 }),
  line({ date: '25/9/2026 10:00', no: 'ORDSBY002', sku: 'LOT-PAIR', qty: 2 }),
]);
const FILE_I = sheet([
  line({ date: '24/9/2026 13:33', no: 'IRPSBY001', sku: 'P-FIRST', qty: 1 }),
  line({ date: '25/9/2026 10:05', no: 'IRPSBY002', sku: 'LOT-PAIR', qty: 2 }),
  line({ date: '25/9/2026 10:05', no: 'IRPSBY002', sku: 'LOT-UNEVEN', qty: 1 }),
]);
// ใบใหม่ของ P-FIRST หลังรับทราบ (ใบเปลี่ยน → รับทราบหมดอายุ)
const FILE_I_MORE = sheet([...FILE_I.slice(1), line({ date: '2/10/2026 09:00', no: 'IRPSBY003', sku: 'P-FIRST', qty: 1 })]);

async function seed(page, { role = 'pharmacist' } = {}) {
  await page.evaluate(({ role, EPOCH, SCAN, O, I }) => {
    ADJ_ERP_LOT_AWARE = true; ADJ_ERP_OUTSIDE_ACK = true; PHARMACY_ADJ_ERP_CARD = true; ADJUST_DOC_ERP_CHECK = true; ADJUST_DOC_HISTORY = true;
    currentBranch = 'SRC'; currentRole = role; currentUser = 'Pharm'; _countResetAt = EPOCH;
    _db = null; _adjErp = null; _adjErpBusy = false; _adjErpFilter = 'all'; _adjHist = null;
    _adjErpAck = null; _adjErpAckBusy = false; _adjErpAckEdit = '';
    _branchScanPaused = false; _adjDocFilter = 'ords'; _adjDocPage = 1; _adjLoading = false;
    _pharmacyAuditMarkerData = { branch: 'SRC', countResetAt: EPOCH, items: {} };
    state.skuMap.clear(); state.scanData.clear(); state.skuDirectMap.clear(); scanListMap.clear();
    const base = { auditor: '', countedQty: 4, timestamp: SCAN, firstScanAt: SCAN, scannedBy: 'Asst' };
    const add = (sku, sys, sd) => {
      state.skuMap.set(sku, { sku, productName: 'สินค้า ' + sku, unitPrice: 20, systemQty: sys, negSys: false, barcodes: [], isDel: false });
      state.scanData.set(sku, { ...base, ...sd });
    };
    const pass = (extra = {}) => ({ status: 'pass', auditStatus: 'approved', initialStatus: 'pass', ...extra });
    add('IN-Y', 10, { status: 'stock_adjustment', auditStatus: 'stock_adjustment', initialStatus: 'stock_adjustment', directAdj: true, effectiveQty: 8, systemQty: 10, countedQty: 8 });
    add('P-FIRST', 4, pass());                                                       // IRPS +1 นอกแอป · ขาเดียว
    add('P-APP', 9, pass({ initialStatus: 'audit', auditor: 'Pharm', recheckQty: 9, recheckSystemQty: 10, recheckAt: '2026-08-23T04:57:18.978Z' }));   // บรรทัดอยู่ในไฟล์ที่ Export จากแอป
    add('LOT-PAIR', 6, pass());                                                      // ORDS 2 + IRPS 2 = ปรับปรุง LOT ครบคู่
    add('LOT-UNEVEN', 6, pass());                                                    // ORDS 3 + IRPS 1 = ไม่เท่ากัน
    // 🗂️ ประวัติ: ORDSBY001 Export Text จากแอป (IN-Y + P-APP) · ไม่มี LOT-UNEVEN = บรรทัดนั้นพิมพ์เพิ่มใน ProMaxx
    _adjHistApply('SRC', EPOCH, [{ no: 'ORDSBY001', dir: 'ords', at: '2026-09-24T07:40:00.000Z', by: 'Pharm', rows: [['IN-Y', 2, 2, null, '', ''], ['P-APP', 1, 1, null, '', '']] }], 'Pharm', '');
    window.__erp = (sheets) => {
      let m = null;
      for (const rows of sheets) { const p = _parseAdjErpRows(rows, 'SRC', EPOCH); if (p.error) throw new Error(p.error); m = _mergeAdjErp(m, p, { at: '2026-10-11T03:00:00.000Z', by: 'Pharm' }); }
      _adjErp = { ...m, branch: 'SRC', epoch: EPOCH, updatedBy: 'Pharm', updatedAt: '2026-10-11T03:00:00.000Z', localOnly: false };
    };
    __erp([O, I]);
    // fake Firestore: doc().get + runTransaction(get/set) · __fail = ทำให้ transaction ล้ม · __getGate = ค้างการอ่าน
    window.__store = {}; window.__fail = null; window.__getGate = null;
    const ref = (p) => ({ path: p, get: async () => { const d = window.__store[p]; if (window.__getGate) await window.__getGate; return { exists: !!d, data: () => d }; } });
    window.__fakeDb = {
      collection: (c) => ({ doc: (id) => ref(c + '/' + id) }),
      runTransaction: async (fn) => {
        if (window.__fail) throw new Error(window.__fail);
        let pending = null;
        await fn({ get: async (r) => { const d = window.__store[r.path]; return { exists: !!d, data: () => d }; }, set: (r, data) => { pending = [r.path, data]; } });
        if (pending) window.__store[pending[0]] = { ...pending[1], updatedAt: { toDate: () => new Date('2026-10-11T03:05:00.000Z') } };
      },
    };
    _db = window.__fakeDb;
    window.__toasts = []; toast = (m, t) => { window.__toasts.push(`${t || 'info'}|${m}`); };
    window.__rows = () => [...document.querySelectorAll('#adjErpOutsideBody tr')].map((tr) => ({ sku: tr.dataset.sku, kind: tr.dataset.kind, acked: tr.dataset.acked === '1',
      type: tr.children[0].textContent, docs: tr.children[3].textContent, reason: tr.children[6].textContent, ack: tr.children[7] ? tr.children[7].textContent : null }));
    window.__btn = () => { const b = document.getElementById('adjErpOutsideBtn'); return b ? [b.textContent, b.classList.contains('warn')] : null; };
  }, { role, EPOCH, SCAN, O: FILE_O, I: FILE_I });
}
const ACK_KEY = 'stock_sessions/SRC_adjerpack';

test('ค่าเริ่มต้นที่ส่งมอบ: ADJ_ERP_OUTSIDE_ACK เปิด · หัวตารางวาดด้วย JS (thead มี id)', async ({ browser }) => {
  const app = await bootBare(browser);
  expect(await app.page.evaluate(() => [typeof ADJ_ERP_OUTSIDE_ACK, ADJ_ERP_OUTSIDE_ACK, ADJ_ERP_ACK_DEFAULT_NOTE, !!document.getElementById('adjErpOutsideThead')]))
    .toEqual(['boolean', true, 'ปรับปรุง LOT สินค้า', true]);
  await closeApp(app);
});

test('★ ที่มาของบรรทัด: ออกจากแอป / ปรับปรุง LOT สินค้า · 📥 นำเข้าไม่นับเป็นออกจากแอป · คำบอกไม่ครบคู่เฉพาะบรรทัดนอกแอป', async ({ browser }) => {
  const app = await bootBare(browser);
  await seed(app.page);
  const r = await app.page.evaluate(() => _adjErpOutsideList().map((x) => [x.kind, x.sku, x.reason, x.docs.map((d) => `${d.no}:${d.origin}`).join(',')]));
  expect(r).toEqual([
    ['outside', 'LOT-UNEVEN', 'Pass ตั้งแต่นับ — แอปไม่ได้สั่งปรับ · ปรับปรุง LOT ไม่เท่ากัน (ORDS 3 · IRPS 1)', 'ORDSBY001:lot,IRPSBY002:lot'],
    ['outside', 'P-APP', 'รีเช็คแล้ว Pass ก่อนออกใบ — แอปไม่ได้สั่งปรับ', 'ORDSBY001:app'],          // ออกจากแอป → ไม่บอกว่า LOT ไม่ครบคู่
    ['outside', 'P-FIRST', 'Pass ตั้งแต่นับ — แอปไม่ได้สั่งปรับ · ปรับปรุง LOT ไม่ครบคู่ (มีแต่ IRPS)', 'IRPSBY001:lot'],
    ['lotswap', 'LOT-PAIR', 'ORDS (LOT เดิม) + IRPS (LOT ใหม่) เท่ากัน — ยอดรวมไม่เปลี่ยน', 'ORDSBY002:lot,IRPSBY002:lot'],
  ]);
  // 📥 นำเข้าจาก ERP (src:'erp') เก็บทุกบรรทัดรวมที่พิมพ์เพิ่ม → บอกที่มาไม่ได้ ต้องไม่ถูกนับเป็นออกจากแอป
  const imported = await app.page.evaluate(({ EPOCH }) => {
    _adjHistApply('SRC', EPOCH, [{ no: 'ORDSBY001', dir: 'ords', at: '2026-09-24T07:43:00.000Z', by: '', src: 'erp', file: 'x.csv', impBy: 'Pharm', impAt: '2026-10-07T07:00:00.000Z',
      rows: [['IN-Y', 2, 2, null, '', ''], ['P-APP', 1, 1, null, '', ''], ['LOT-UNEVEN', 3, 3, null, '', '']] }], '', '');
    return _adjErpOutsideList().find((x) => x.sku === 'P-APP').docs.map((d) => d.origin);
  }, { EPOCH });
  expect(imported).toEqual(['lot']);
  // ป้ายบนจอ
  await seed(app.page);
  const rows = await app.page.evaluate(() => { openAdjErpOutsidePopup(); return __rows(); });
  expect(rows.find((x) => x.sku === 'P-APP').docs).toBe('ORDSBY001 · 24/09/2026 14:43 · −1 ออกจากแอป');
  expect(rows.find((x) => x.sku === 'LOT-PAIR').docs).toBe('ORDSBY002 · 25/09/2026 10:00 · −2 ปรับปรุง LOT สินค้าIRPSBY002 · 25/09/2026 10:05 · +2 ปรับปรุง LOT สินค้า');
  await closeApp(app);
});

test('★ รับทราบ → cloud → ปุ่ม/ตาราง/เรียงลำดับ/Excel · ยกเลิกรับทราบ · Enter/Escape', async ({ browser }) => {
  const app = await bootBare(browser);
  await app.page.evaluate(() => { _refreshAdjMaster = async () => {}; });
  await seed(app.page);
  const before = await app.page.evaluate(async () => { renderAdjustDocTable(true); document.getElementById('adjustDocPopupOverlay').style.display = 'flex'; openAdjErpOutsidePopup(); await new Promise((r) => setTimeout(r, 30)); return { btn: __btn(), rows: __rows() }; });
  expect(before.btn).toEqual(['⚠️ ปรับยอดนอกใบ 📦 3 · 🔁 ปรับปรุง LOT สินค้า 1', true]);
  expect(before.rows.map((x) => [x.sku, x.ack])).toEqual([['LOT-UNEVEN', 'รับทราบ'], ['P-APP', 'รับทราบ'], ['P-FIRST', 'รับทราบ'], ['LOT-PAIR', '—']]);

  // กดรับทราบ P-FIRST → ช่องหมายเหตุ (ค่าเริ่มต้น "ปรับปรุง LOT สินค้า") → แก้ → บันทึก
  const edit = await app.page.evaluate(() => {
    document.querySelector('#adjErpOutsideBody tr[data-sku="P-FIRST"] .adj-ack-btn').click();
    const inp = document.getElementById('adjErpAckNote');
    return { value: inp && inp.value, focused: document.activeElement === inp };
  });
  expect(edit).toEqual({ value: 'ปรับปรุง LOT สินค้า', focused: true });
  await app.page.evaluate(async () => {
    document.getElementById('adjErpAckNote').value = 'แก้ LOT 24/9 — ขา ORDS ทำแยก';
    document.querySelector('#adjErpOutsideBody tr[data-sku="P-FIRST"] .adj-ack-save').click();
    await new Promise((r) => setTimeout(r, 50));
  });
  const saved = await app.page.evaluate((k) => {
    const d = window.__store[k]; const acks = JSON.parse(d.acks_json);
    return { epoch: d.countResetAt, by: d.updatedBy, keys: Object.keys(acks), note: acks['P-FIRST'].note, ackBy: acks['P-FIRST'].by, sig: acks['P-FIRST'].sig,
      btn: __btn(), rows: __rows().map((x) => [x.sku, x.acked, x.type]), count: document.getElementById('adjErpOutsideCount').textContent, toast: window.__toasts.at(-1) };
  }, ACK_KEY);
  expect(saved).toMatchObject({ epoch: EPOCH, by: 'Pharm', keys: ['P-FIRST'], note: 'แก้ LOT 24/9 — ขา ORDS ทำแยก', ackBy: 'Pharm', sig: 'IRPSBY001:IRPS:1',
    btn: ['⚠️ ปรับยอดนอกใบ 📦 2 · ✓ รับทราบแล้ว 1 · 🔁 ปรับปรุง LOT สินค้า 1', true],
    count: '4 รายการ · ปรับยอดนอกใบ 3 (รับทราบแล้ว 1) · ปรับปรุง LOT สินค้า 1 · ปกติ 0', toast: 'success|✓ รับทราบ P-FIRST — แก้ LOT 24/9 — ขา ORDS ทำแยก' });
  expect(saved.rows).toEqual([['LOT-UNEVEN', false, '⚠️ ปรับยอดนอกใบ 📦'], ['P-APP', false, '⚠️ ปรับยอดนอกใบ 📦'],
    ['P-FIRST', true, '✓ ปรับยอดนอกใบ 📦 รับทราบแล้ว'], ['LOT-PAIR', false, '🔁 ปรับปรุง LOT สินค้า']]);   // รับทราบแล้วลงไปอยู่ใต้ที่ยังไม่รับทราบ
  expect((await app.page.evaluate(() => __rows().find((x) => x.sku === 'P-FIRST').ack))).toContain('✓ รับทราบแก้ LOT 24/9 — ขา ORDS ทำแยก');

  // Excel มีคอลัมน์รับทราบ
  const xl = await app.page.evaluate(() => {
    let got = null; const orig = XLSX.writeFile; XLSX.writeFile = (wb) => { got = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 }); };
    try { exportAdjErpOutsideExcel(); } finally { XLSX.writeFile = orig; }
    return got;
  });
  const xr = xl.find((row) => row[1] === 'P-FIRST');
  expect(xr[6]).toBe('IRPSBY001 24/09/2026 13:33 IRPS 1 (ปรับปรุง LOT สินค้า)');
  expect(xr[9]).toBe('แก้ LOT 24/9 — ขา ORDS ทำแยก');
  expect(xr[10]).toMatch(/^Pharm \d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/);
  expect(xl.find((row) => row[1] === 'P-APP')[9]).toBe('');

  // Enter = บันทึก (ค่าเริ่มต้น) · Escape = ยกเลิก
  await app.page.evaluate(async () => {
    document.querySelector('#adjErpOutsideBody tr[data-sku="P-APP"] .adj-ack-btn').click();
    document.getElementById('adjErpAckNote').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
  expect(await app.page.evaluate(() => [!!document.getElementById('adjErpAckNote'), _adjErpAckEdit])).toEqual([false, '']);
  await app.page.evaluate(async () => {
    document.querySelector('#adjErpOutsideBody tr[data-sku="P-APP"] .adj-ack-btn').click();
    document.getElementById('adjErpAckNote').value = '   ';                     // เว้นว่าง = ใช้หมายเหตุค่าเริ่มต้น
    document.getElementById('adjErpAckNote').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await new Promise((r) => setTimeout(r, 50));
  });
  expect(await app.page.evaluate((k) => Object.entries(JSON.parse(window.__store[k].acks_json)).map(([s, v]) => [s, v.note]), ACK_KEY))
    .toEqual([['P-FIRST', 'แก้ LOT 24/9 — ขา ORDS ทำแยก'], ['P-APP', 'ปรับปรุง LOT สินค้า']]);

  // ยกเลิกรับทราบ P-FIRST → กลับมาเตือน
  await app.page.evaluate(async () => {
    document.querySelector('#adjErpOutsideBody tr[data-sku="P-FIRST"] .adj-ack-undo').click();
    await new Promise((r) => setTimeout(r, 50));
  });
  expect(await app.page.evaluate((k) => ({ keys: Object.keys(JSON.parse(window.__store[k].acks_json)), btn: __btn() }), ACK_KEY))
    .toEqual({ keys: ['P-APP'], btn: ['⚠️ ปรับยอดนอกใบ 📦 2 · ✓ รับทราบแล้ว 1 · 🔁 ปรับปรุง LOT สินค้า 1', true] });
  // ลำดับ: ที่ยังไม่รับทราบ (เรียงรหัส) → รับทราบแล้ว (P-APP มาก่อน P-FIRST ตามรหัส แต่รับทราบแล้วจึงลงล่าง) → ปรับปรุง LOT
  expect(await app.page.evaluate(() => __rows().map((x) => x.sku))).toEqual(['LOT-UNEVEN', 'P-FIRST', 'P-APP', 'LOT-PAIR']);
  await closeApp(app);
});

test('★ มีใบใหม่หลังรับทราบ = กลับมาเตือน (ห้ามถูกกลบเงียบ)', async ({ browser }) => {
  const app = await bootBare(browser);
  await seed(app.page);
  const r = await app.page.evaluate(async ({ O, I2 }) => {
    openAdjErpOutsidePopup(); await new Promise((r) => setTimeout(r, 30));
    armAdjErpAck('P-FIRST'); await confirmAdjErpAck('P-FIRST');
    const okBefore = _adjErpOutsideList().find((x) => x.sku === 'P-FIRST').ack.valid;
    __erp([O, I2]); renderAdjErpOutsideTable();                                   // แนบไฟล์ใหม่: มี IRPS ของ P-FIRST เพิ่ม
    const x = _adjErpOutsideList().find((y) => y.sku === 'P-FIRST');
    const row = __rows().find((y) => y.sku === 'P-FIRST');
    let xl = null; const orig = XLSX.writeFile; XLSX.writeFile = (wb) => { xl = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 }); };
    try { exportAdjErpOutsideExcel(); } finally { XLSX.writeFile = orig; }
    return { okBefore, valid: x.ack.valid, net: x.net, acked: row.acked, ack: row.ack, type: row.type, counts: _adjErpOutsideCounts(_adjErpOutsideList()),
      xl: xl.find((y) => y[1] === 'P-FIRST')[9] };
  }, { O: FILE_O, I2: FILE_I_MORE });
  expect(r).toEqual({ okBefore: true, valid: false, net: 2, acked: false, ack: '⚠️ มีใบใหม่หลังรับทราบรับทราบใหม่', type: '⚠️ ปรับยอดนอกใบ 📦',
    counts: { warn: 3, acked: 0, lot: 1, ok: 0 }, xl: 'มีใบใหม่หลังรับทราบ (เดิม: ปรับปรุง LOT สินค้า)' });
  await closeApp(app);
});

test('★ atomic: cloud ล้ม/ไม่มี _db = ไม่เปลี่ยนในเครื่อง · รอบนับอื่น = ว่าง · ผลอ่านเก่าถูกทิ้ง · สองเครื่องคนละตัวไม่ทับกัน', async ({ browser }) => {
  const app = await bootBare(browser);
  await seed(app.page);
  // transaction ล้ม
  const fail = await app.page.evaluate(async (k) => {
    window.__fail = 'unavailable';
    openAdjErpOutsidePopup(); await new Promise((r) => setTimeout(r, 30));
    armAdjErpAck('P-FIRST'); await confirmAdjErpAck('P-FIRST');
    return { store: !!window.__store[k], acked: _adjErpOutsideCounts(_adjErpOutsideList()).acked, toast: window.__toasts.at(-1), editing: _adjErpAckEdit, busy: _adjErpAckBusy };
  }, ACK_KEY);
  expect(fail).toEqual({ store: false, acked: 0, toast: 'error|รับทราบไม่สำเร็จ: unavailable', editing: 'P-FIRST', busy: false });   // ช่องหมายเหตุยังเปิดให้ลองใหม่
  // ไม่มี _db
  const noDb = await app.page.evaluate(async () => { window.__fail = null; _db = null; await confirmAdjErpAck('P-FIRST'); const t = window.__toasts.at(-1); _db = window.__fakeDb; return [t, _adjErpOutsideCounts(_adjErpOutsideList()).acked]; });
  expect(noDb).toEqual(['error|รับทราบไม่สำเร็จ: ไม่ได้เชื่อมต่อ Cloud', 0]);
  // doc ของรอบนับอื่น = ว่าง (อ่านและตอนบันทึกเริ่มใหม่ ไม่พาของรอบเก่ามา)
  const epoch = await app.page.evaluate(async (k) => {
    window.__store[k] = { countResetAt: '2026-07-01T00:00:00.000Z', acks_json: JSON.stringify({ 'P-FIRST': { note: 'รอบเก่า', by: 'X', at: '2026-07-02T00:00:00.000Z', sig: 'IRPSBY001:IRPS:1' } }) };
    await _loadAdjErpAckFromCloud();
    const afterLoad = _adjErpOutsideCounts(_adjErpOutsideList()).acked;
    armAdjErpAck('P-APP'); await confirmAdjErpAck('P-APP');
    const d = window.__store[k];
    return { afterLoad, epoch: d.countResetAt, keys: Object.keys(JSON.parse(d.acks_json)) };
  }, ACK_KEY);
  expect(epoch).toEqual({ afterLoad: 0, epoch: EPOCH, keys: ['P-APP'] });
  // สองเครื่อง: เครื่องอื่นเพิ่งรับทราบ P-FIRST บน cloud → เครื่องนี้รับทราบ LOT-UNEVEN → transaction รวมกัน ไม่ทับ
  const merge = await app.page.evaluate(async (k) => {
    const acks = JSON.parse(window.__store[k].acks_json); acks['P-FIRST'] = { note: 'เครื่องอื่น', by: 'B', at: '2026-10-11T03:10:00.000Z', sig: 'IRPSBY001:IRPS:1' };
    window.__store[k] = { ...window.__store[k], acks_json: JSON.stringify(acks) };
    armAdjErpAck('LOT-UNEVEN'); await confirmAdjErpAck('LOT-UNEVEN');
    return { cloud: Object.keys(JSON.parse(window.__store[k].acks_json)).sort(), local: _adjErpOutsideCounts(_adjErpOutsideList()) };
  }, ACK_KEY);
  expect(merge).toEqual({ cloud: ['LOT-UNEVEN', 'P-APP', 'P-FIRST'], local: { warn: 0, acked: 3, lot: 1, ok: 0 } });
  // ผลอ่านที่ค้าง (เก่ากว่า) มาทีหลังบันทึก → ห้ามทับ
  const stale = await app.page.evaluate(async (k) => {
    const old = { countResetAt: _countResetAt, acks_json: '{}' };
    let open; window.__getGate = new Promise((r) => { open = r; });
    const keep = window.__store[k]; window.__store[k] = old;
    const pending = _loadAdjErpAckFromCloud();
    window.__store[k] = keep;
    await undoAdjErpAck('P-APP');                                                // บันทึกใหม่ระหว่างการอ่านค้าง
    window.__getGate = null; open(); await pending;
    return _adjErpOutsideCounts(_adjErpOutsideList());
  }, ACK_KEY);
  expect(stale).toEqual({ warn: 1, acked: 2, lot: 1, ok: 0 });                   // ผลจากการยกเลิก P-APP ยังอยู่ ไม่ถูกผลอ่านเก่า (ว่าง) ทับ
  await closeApp(app);
});

test('ผู้ช่วย/สวิตช์ปิด = ไม่มีรับทราบ (ทุกตัวเป็นคำเตือนเหมือนเดิม) · กัน XSS ในหมายเหตุ', async ({ browser }) => {
  const app = await bootBare(browser);
  await seed(app.page);
  // XSS
  const xss = await app.page.evaluate(async () => {
    openAdjErpOutsidePopup(); await new Promise((r) => setTimeout(r, 30));
    armAdjErpAck('P-FIRST');
    document.getElementById('adjErpAckNote').value = '<img src=x onerror="window.__xss=1">ok';
    await confirmAdjErpAck('P-FIRST');
    return { img: !!document.querySelector('#adjErpOutsideBody img'), flag: !!window.__xss, text: __rows().find((x) => x.sku === 'P-FIRST').ack.includes('<img src=x') };
  });
  expect(xss).toEqual({ img: false, flag: false, text: true });
  // สวิตช์ปิด: ไม่มีคอลัมน์/ปุ่ม · รับทราบเดิมไม่มีผล · Excel 9 คอลัมน์ · ไม่อ่าน cloud
  const off = await app.page.evaluate(async () => {
    ADJ_ERP_OUTSIDE_ACK = false;
    renderAdjustDocTable(true); renderAdjErpOutsideTable();
    let reads = 0; const realDb = _db; _db = { ...realDb, collection: (c) => { reads++; return realDb.collection(c); } };
    await _loadAdjErpAckFromCloud(); await confirmAdjErpAck('P-APP');
    _db = realDb;
    let xl = null; const orig = XLSX.writeFile; XLSX.writeFile = (wb) => { xl = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 }); };
    try { exportAdjErpOutsideExcel(); } finally { XLSX.writeFile = orig; }
    return { th: document.querySelectorAll('#adjErpOutsideThead th').length, ackBtns: document.querySelectorAll('#adjErpOutsideBody .adj-ack-btn').length,
      btn: __btn(), counts: _adjErpOutsideCounts(_adjErpOutsideList()), reads, header: xl[0].length };
  });
  expect(off).toEqual({ th: 7, ackBtns: 0, btn: ['⚠️ ปรับยอดนอกใบ 📦 3 · 🔁 ปรับปรุง LOT สินค้า 1', true], counts: { warn: 3, acked: 0, lot: 1, ok: 0 }, reads: 0, header: 9 });
  // ผู้ช่วย: ไม่มีสิทธิ์รับทราบ (การ์ด 🧾/📦 เป็นของเภสัช)
  const asst = await app.page.evaluate(async () => { ADJ_ERP_OUTSIDE_ACK = true; currentRole = 'assistant'; const before = window.__toasts.length; await confirmAdjErpAck('P-APP'); return [_adjErpAckOn(), window.__toasts.length === before]; });
  expect(asst).toEqual([false, true]);
  expect(await app.page.evaluate(() => { currentRole = 'pharmacist'; _adjErpAck = { branch: 'SRC', epoch: _countResetAt, acks: { X: {} } }; currentRole = ''; updateAdjustDocPanel(); return _adjErpAck; })).toBeNull();
  await closeApp(app);
});

test('ตารางไม่ล้นป็อปอัพที่ 1280px (เลขที่ใบ/ชื่อยาวเท่าของจริง) — คอลัมน์รับทราบเห็นโดยไม่ต้องเลื่อนขวา', async ({ browser }) => {
  const app = await bootBare(browser);
  await app.page.setViewportSize({ width: 1280, height: 900 });
  await seed(app.page);
  // เลขที่ใบยาวเท่าของจริง (ORDSBY006260900001) + ชื่อสินค้าภาษาไทยยาว + รับทราบหนึ่งตัว (ป้ายประเภท 2 บรรทัด)
  const long = (no) => no.replace(/^(ORDS|IRPS)BY(\d+)$/, (m, t, n) => `${t}BY006260900${n}`);
  const O = FILE_O.map((r, i) => (i ? Object.assign([...r], { 2: long(r[2]) }) : r));
  const I = FILE_I.map((r, i) => (i ? Object.assign([...r], { 2: long(r[2]) }) : r));
  const res = await app.page.evaluate(async ({ O, I }) => {
    __erp([O, I]);
    for (const [sku, si] of state.skuMap) si.productName = 'ยาสีฟัน ซอลส์ แอคทีฟ ไวท์ เฟรช มิ้นท์ 160 กรัม ' + sku;
    for (const id of ['branchModal', 'pinModal', 'employeeModal']) { const e = document.getElementById(id); if (e) e.style.display = 'none'; }
    openAdjErpOutsidePopup(); await new Promise((r) => setTimeout(r, 30));
    armAdjErpAck('P-FIRST'); await confirmAdjErpAck('P-FIRST');
    await new Promise((r) => setTimeout(r, 400));   // รอแอนิเมชันเปิดป็อปอัพ
    const body = document.querySelector('#adjErpOutsideCard .stock-popup-body');
    const ths = [...document.querySelectorAll('#adjErpOutsideThead th')];
    const lastTh = ths[ths.length - 1].getBoundingClientRect(), box = body.getBoundingClientRect();
    return { cols: ths.length, overflow: body.scrollWidth - body.clientWidth, ackVisible: lastTh.right <= box.right + 1,
      docs: __rows().find((x) => x.sku === 'LOT-PAIR').docs, type: __rows().find((x) => x.sku === 'P-FIRST').type };
  }, { O, I });
  expect(res).toEqual({ cols: 8, overflow: 0, ackVisible: true,
    docs: 'ORDSBY006260900002 · 25/09/2026 10:00 · −2 ปรับปรุง LOT สินค้าIRPSBY006260900002 · 25/09/2026 10:05 · +2 ปรับปรุง LOT สินค้า',
    type: '✓ ปรับยอดนอกใบ 📦 รับทราบแล้ว' });
  await closeApp(app);
});
