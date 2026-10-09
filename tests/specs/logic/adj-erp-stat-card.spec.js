// สาขายา: การ์ดสถิติใบที่ 4 "รอรีเช็ค" → "Stock Adj เข้าระบบ" X / Y (9 ต.ค. 2026 · ผู้ใช้สั่ง · สวิตช์ PHARMACY_ADJ_ERP_CARD)
//   X = เข้า ProMaxx แล้ว (ตรวจจาก R02.102/R16 ที่แนบที่ 📦 → 🧾 ตรวจกับ ERP) · Y = ที่ต้องปรับทั้งหมดของรอบนี้ (รวมที่เข้าแล้ว)
//   ทุก role ในสาขายา (ผู้ช่วย PDA/คอม + เภสัช) · WH ไม่แตะ
//
// เทสนี้ตรึง — ★ = ข้อที่พังแล้วเลขบนการ์ดหลอกหน้างาน
//   1. ★ กติกาตัวเลขทุกกลุ่ม: Stock Adj ตรง · รอรีเช็ค (เลขตอน Confirm) · 🚫 ไม่มีของ (ยอดสด) · Stock Adj เก่าที่ต้องรีเช็คใหม่ (เลขตอนรีเช็ค)
//      · ผลต่าง 0 แล้ว (มีใบ ERP = เข้าแล้ว · ไม่มี = ไม่นับ) · ค่าที่เภสัชแก้ · แก้เป็น 0 · ↺ / ไม่มีเลข / ค้างส่ง / R05 ไม่มี = ไม่นับ
//      · เข้าแล้ว = done เท่านั้น (บางส่วน/เกิน/ทิศตรงข้าม = ไม่ตรง) · ทิศที่ไฟล์ไม่ครอบ / ยังไม่อัป = ยังไม่เข้า + บอกบนการ์ด
//   2. ★ แถวที่ส่งออกไป 🗂️ แล้วยังอยู่ใน Y (ตารางในป็อปอัพซ่อนไปแล้ว) · ตัวเลขต่อทิศเทียบกับชิปในป็อปอัพได้
//   3. ★ ทุก role/สาขายาเห็น (Desktop + PDA) · WH / ยังไม่ล็อกอิน = การ์ดเดิม
//   4. ★ ทางถอย: สวิตช์ปิด / ADJUST_DOC_ERP_CHECK=false = การ์ดเดิมทุกตัวอักษร · สลับไปมาไม่ค้างสี/คำอธิบาย · ผู้ช่วยกลับไปถูกล้างผล ERP · ไม่ฟัง cloud
//   5. รีเฟรชเอง: applyAuditTerminology ไม่ทับป้าย · แนบไฟล์ · แก้/คืนจำนวนในใบ · ผู้ช่วยไม่ถูกล้างผล ERP
//   6. listener {branch}_adjerp: เครื่องอื่นแนบ → การ์ดขยับเอง · รอบอื่น = ว่าง · ไม่ทับผล "เฉพาะเครื่องนี้" · สาขาเปลี่ยน = ทิ้ง · ผลอ่านเก่าที่ค้างถูกทิ้ง · stop
//   7. ไม่กวน PROGRESS_BY_SCAN (Counted/Pass/Progress)
// (ข้อมูลสังเคราะห์ทั้งหมด — ห้ามใช้ CSV จริง)
const { test, expect, bootBare, closeApp, newAppContext, waitForAppReady } = require('../../lib/hooks');

const EPOCH = '2026-09-20T01:00:00.000Z';   // เริ่มรอบ = 20/09 (เวลาเครื่อง)
const SCAN = '2026-09-21 09:00:00';          // วันที่นับ = 21/09
const LABEL = 'Stock Adj เข้าระบบ';

// หัวคอลัมน์ R16 ตามลำดับไฟล์จริง (ชุดเดียวกับ adjust-doc-erp.spec.js)
const HDR = ['SYSWAREHOUSEID', 'TRANDATE', 'TRANNO', 'REFERENCENO1', 'SYSVOUCHERID', 'SYSSALEID', 'TOTAL', 'TOTALVAT', 'GRANDTOTAL', 'FCANCEL',
  'TAXRATE', 'SYSPERSONID', 'SYSBRANCHID', 'FPROCESS', 'SCANCODE', 'ITEMNAME', 'SYSUNITID', 'BASEQUANTITY', 'QUANTITY', 'SYSITEMID', 'PRICE',
  'AMOUNT', 'DETAILNO', 'ITEMID', 'ITEMNAME', 'TOTALTRADDISCHAVEVAT', 'TOTALTRADDISCNONEVAT', 'FSTOCKMAIN', 'FMLDISCOUNTITEM', 'FMLDISCOUNTROW',
  'DISCOUNTPROMOTION', 'NAME'];
function line({ date = '22/9/2026 10:00', no, sku, qty }) {
  const r = Array(HDR.length).fill('');
  r[0] = '1'; r[1] = date; r[2] = no; r[9] = '0'; r[12] = '0'; r[14] = sku; r[17] = String(qty); r[18] = String(qty); r[23] = sku; r[31] = 'สาขาทดสอบ';
  return r;
}
const sheet = (lines) => [HDR.slice(), ...lines];
const csvText = (rows) => rows.map((r) => r.join(',')).join('\r\n');
// R16.104 (ขาออก · ORDS) ของ SRC
const FILE_O = sheet([
  ['D-ORDS-DONE', 2], ['D-PARTIAL', 3], ['D-OVER', 4], ['AU-PAIR', 4], ['NS-LIVE', 3], ['NS-SETTLED-ERP', 5], ['LG-STALE-DONE', 2], ['EDIT-QTY', 2], ['EXPORTED', 4],
].map(([sku, qty]) => line({ no: 'ORDSBY001', sku, qty })));
// R16.103 (ขาเข้า · IRPS) ของ SRC — D-OPP อยู่แท็บ ORDS แต่ ERP มี IRPS = ทิศตรงข้าม
const FILE_I = sheet([['D-IRPS-DONE', 2], ['D-OPP', 1]].map(([sku, qty]) => line({ date: '22/9/2026 11:00', no: 'IRPSBY001', sku, qty })));

// สถานะสาขา: ทุกกลุ่มของกติกา (คอมเมนต์ = ผลที่การ์ดต้องได้ เมื่อแนบทั้งสองไฟล์)
async function seed(page, { branch = 'SRC', role = 'assistant' } = {}) {
  await page.evaluate(({ branch, role, EPOCH, SCAN }) => {
    PHARMACY_ADJ_ERP_CARD = true; ADJUST_DOC_ERP_CHECK = true; ADJUST_DOC_QTY_EDIT = true; PHARMACY_AUDIT_IN_ADJUST_DOC = true;
    ADJUST_DOC_SKIP_REOPENED = true; ADJUST_DOC_HISTORY = true; PROGRESS_BY_SCAN = true;
    currentBranch = branch; currentRole = role; currentUser = 'T'; _countResetAt = EPOCH;
    _db = null; _adjErp = null; _adjErpBusy = false; _adjErpFilter = 'all'; _adjHist = null;
    _branchScanPaused = false; _adjDocFilter = 'ords'; _adjDocPage = 1; _adjLoading = false;
    _pharmacyAuditMarkerData = { branch, countResetAt: EPOCH, items: {
      'AU-REOPEN': { status: 'audit', auditor: '', reopenedAt: '2026-09-25T03:00:00.000Z', countResetAt: EPOCH, effectiveQty: 3, systemQty: 10 },
    } };
    state.skuMap.clear(); state.scanData.clear(); state.skuDirectMap.clear(); scanListMap.clear(); state.unknownScans = [];
    const base = { auditor: '', countedQty: 0, timestamp: SCAN, firstScanAt: SCAN, scannedBy: 'Asst' };
    const add = (sku, sys, sd) => {
      if (sys !== null) state.skuMap.set(sku, { sku, productName: 'สินค้า ' + sku, unitPrice: 20, systemQty: sys, negSys: false, barcodes: [], isDel: false });
      state.scanData.set(sku, { ...base, ...sd });
    };
    const direct = (eff, sys, extra = {}) => ({ status: 'stock_adjustment', auditStatus: 'stock_adjustment', initialStatus: 'stock_adjustment',
      directAdj: true, effectiveQty: eff, systemQty: sys, countedQty: eff, ...extra });
    const legacy = (rq, frozen, extra = {}) => ({ status: 'stock_adjustment', auditStatus: 'stock_adjustment', initialStatus: 'audit', auditor: 'Pharm',
      countedQty: 3, recheckQty: rq, recheckSystemQty: frozen, recheckBy: 'Pharm', recheckAt: '2026-09-23T03:00:00.000Z', ...extra });
    const noStock = { status: 'stock_adjustment', auditStatus: 'stock_adjustment', initialStatus: 'stock_adjustment', noStock: true, countedQty: 0 };
    add('D-ORDS-DONE', 10, direct(8, 10));                      // ORDS 2 · ERP 2 → เข้าแล้ว
    add('D-ORDS-NONE', 10, direct(7, 10));                      // ORDS 3 · ERP ไม่มี → ยังไม่เข้า
    add('D-IRPS-DONE', 10, direct(12, 10));                     // IRPS 2 · ERP 2 → เข้าแล้ว
    add('D-PARTIAL', 10, direct(5, 10));                        // ORDS 5 · ERP 3 → บางส่วน (ไม่ตรง)
    add('D-OVER', 10, direct(9, 10));                           // ORDS 1 · ERP 4 → เกิน (ไม่ตรง)
    add('D-OPP', 10, direct(9, 10));                            // ORDS 1 · ERP มี IRPS 1 → ทิศตรงข้าม (ไม่ตรง)
    add('AU-PAIR', 10, { status: 'audit', auditStatus: 'pending', initialStatus: 'audit', countedQty: 6, effectiveQty: 6, systemQty: 10 }); // รอรีเช็ค ORDS 4 · ERP 4 → เข้าแล้ว
    add('AU-REOPEN', 10, { status: 'audit', auditStatus: 'pending', initialStatus: 'audit', countedQty: 3 });                               // ↺ → ไม่นับ
    add('AU-NOPAIR', 10, { status: 'audit', auditStatus: 'pending', initialStatus: 'audit', countedQty: 3 });                               // ไม่มีเลขตอน Confirm → ไม่นับ
    add('AU-BACKORDER', 10, { status: 'audit', auditStatus: 'pending', initialStatus: 'audit', countedQty: 0, effectiveQty: 0, systemQty: 10, backorder: true }); // ค้างส่ง → ไม่นับ
    add('NS-LIVE', 3, noStock);                                 // 🚫 ยอดสด 3 → ORDS 3 · ERP 3 → เข้าแล้ว
    add('NS-SETTLED-ERP', 0, noStock);                          // 🚫 ยอดระบบเหลือ 0 แล้ว + ERP มีใบ → เข้าแล้ว (+1 ทั้ง X และ Y)
    add('NS-SETTLED-NOERP', 0, noStock);                        // 🚫 ยอดระบบ 0 ไม่มีใบ → ไม่มีอะไรต้องปรับ (ไม่นับ)
    add('LG-STALE-DONE', 1, legacy(1, 3));                      // ต้องรีเช็คใหม่ · เลขตอนรีเช็ค 1−3 → ORDS 2 · ERP 2 → เข้าแล้ว
    add('LG-STALE-NONE', 5, legacy(4, 2));                      // ต้องรีเช็คใหม่ · 4−2 → IRPS 2 · ERP ไม่มี → ยังไม่เข้า
    add('LG-FRESH', 5, legacy(2, 5));                           // ยังสด → ORDS 3 · ยังไม่เข้า
    add('EDIT-ZERO', 10, direct(8, 10, { adjQty: 0, adjBase: -2, adjBy: 'Pharm', adjAt: '2026-09-25T00:00:00.000Z' })); // แก้เป็น 0 → ไม่นับ
    add('EDIT-QTY', 10, direct(7, 10, { adjQty: 2, adjBase: -3, adjBy: 'Pharm', adjAt: '2026-09-25T00:00:00.000Z' }));  // ส่ง 2 (แก้จาก 3) · ERP 2 → เข้าแล้ว
    add('EXPORTED', 10, direct(6, 10));                         // ORDS 4 · ส่งออกไป 🗂️ แล้ว (เภสัช) · ERP 4 → เข้าแล้ว
    add('NO-SKU', null, direct(5, 10));                         // R05 ไม่มี → ไม่นับ
    add('PASS1', 10, { status: 'pass', auditStatus: 'approved', initialStatus: 'pass', countedQty: 10 });
    window.__setErp = (sheets, { localOnly = false } = {}) => {
      let m = null;
      for (const rows of sheets) {
        const p = _parseAdjErpRows(rows, currentBranch, _countResetAt);
        if (p.error) throw new Error(p.error);
        m = _mergeAdjErp(m, p, { at: '2026-10-09T08:00:00.000Z', by: 'Pharm' });
      }
      _adjErp = m ? { ...m, branch: currentBranch, epoch: _countResetAt, updatedBy: 'Pharm', updatedAt: '2026-10-09T08:00:00.000Z', localOnly } : null;
    };
    window.__card = () => {
      const t = (id) => document.getElementById(id).textContent;
      const sub = document.getElementById('statAuditSub'); const wrap = document.getElementById('auditProgressWrap'); const val = document.getElementById('statFail');
      return { label: t('statAuditLabel'), value: t('statFail'), sub: sub.style.display === 'none' ? '' : sub.textContent,
        bar: wrap.style.display === 'none' ? null : [t('auditProgressLabel'), t('auditProgressPct'), document.getElementById('auditProgressFill').style.width],
        color: val.classList.contains('green') ? 'green' : val.classList.contains('red') ? 'red' : '?', title: val.closest('.stat-card').title };
    };
  }, { branch, role, EPOCH, SCAN });
}
const card = (page) => page.evaluate(() => window.__card());
const stats = (page) => page.evaluate(() => { const s = _adjErpCardStats(); return { done: s.done, total: s.total, issue: s.issue, by: s.by, uncovered: s.uncovered, stale: s.stale, exported: s.exported, settledDone: s.settledDone }; });

test('ค่าเริ่มต้นที่ส่งมอบ: PHARMACY_ADJ_ERP_CARD เปิด (อ่านจากหน้าที่เพิ่งบูต)', async ({ browser }) => {
  const app = await bootBare(browser);
  expect(await app.page.evaluate(() => [typeof PHARMACY_ADJ_ERP_CARD, PHARMACY_ADJ_ERP_CARD])).toEqual(['boolean', true]);
  await closeApp(app);
});

test('★ กติกาตัวเลข: X / Y ทุกกลุ่ม · ไม่ตรง · ทิศที่ไฟล์ไม่ครอบ · ยังไม่อัป · ไม่มีงาน', async ({ browser }) => {
  const app = await bootBare(browser);
  await seed(app.page);

  // ยังไม่อัป R02.102 → ยังไม่รู้ว่าเข้าอะไร (ผลต่าง 0 ไม่มีหลักฐาน = ไม่นับ) · บอกบนการ์ด
  await app.page.evaluate(() => updateStats());
  expect(await card(app.page)).toEqual({ label: LABEL, value: '0 / 13', sub: 'ยังไม่อัป R02.102', bar: ['เข้า ProMaxx แล้ว', '0%', '0%'], color: 'red',
    title: expect.stringContaining('ยังไม่อัป R02.102 — เภสัชแนบที่ 📦 ปรับปรุงสินค้า → 🧾 ตรวจกับ ERP') });

  // แนบทั้ง ORDS + IRPS
  await app.page.evaluate(({ O, I }) => { __setErp([O, I]); updateStats(); }, { O: FILE_O, I: FILE_I });
  expect(await stats(app.page)).toEqual({ done: 8, total: 14, issue: 3, by: { ORDS: { done: 6, total: 11 }, IRPS: { done: 1, total: 2 } },
    uncovered: [], stale: 2, exported: 0, settledDone: 1 });
  const c = await card(app.page);
  expect(c).toMatchObject({ label: LABEL, value: '8 / 14', sub: '⚠️ ไม่ตรง 3', bar: ['เข้า ProMaxx แล้ว', '57%', '57%'], color: 'red' });
  expect(c.title.split('\n')).toEqual([
    'Stock Adj ที่เข้า ProMaxx แล้ว / ที่ต้องปรับทั้งหมดของรอบนี้ (ตรวจจาก R02.102 ที่แนบที่ 📦 ปรับปรุงสินค้า)',
    'ORDS เข้าแล้ว 6/11 · IRPS เข้าแล้ว 1/2',
    'ไม่ตรงกับ ERP 3 (บางส่วน/เกิน/ทิศตรงข้าม) — ดูที่ 📦 ตัวกรอง ⚠️ ไม่ตรง',
    'ปรับเข้า ERP แล้วจนยอดระบบตรง 1',
    'รวม Stock Adj ที่ต้องรีเช็คใหม่ 2 (ไม่อยู่ในใบ 📦 · ใช้เลขตอนรีเช็ค)',
    expect.stringMatching(/^R16\.104 \+ R16\.103 อัปเดต วันที่ \d{2}\/\d{2}\/2026 เวลา \d{2}:\d{2}$/),
  ]);

  // แนบเฉพาะ ORDS → แถว IRPS ยังไม่เข้า · ทิศตรงข้ามตรวจไม่ได้ (IRPS ไม่ครอบ) → D-OPP เป็นยังไม่เข้า
  await app.page.evaluate(({ O }) => { __setErp([O]); updateStats(); }, { O: FILE_O });
  expect(await stats(app.page)).toMatchObject({ done: 7, total: 14, issue: 2, uncovered: ['IRPS'] });
  expect(await card(app.page)).toMatchObject({ value: '7 / 14', sub: 'IRPS: ยังไม่มีข้อมูล ERP · ⚠️ ไม่ตรง 2', bar: ['เข้า ProMaxx แล้ว', '50%', '50%'] });

  // ครบทุกตัว → เขียว 100% · ไม่มีงาน → 0 / 0 เขียว ไม่มีแถบ ไม่มีบรรทัดย่อย
  await app.page.evaluate(({ O, I }) => {
    for (const s of ['D-ORDS-NONE', 'D-PARTIAL', 'D-OVER', 'D-OPP', 'LG-STALE-NONE', 'LG-FRESH']) state.scanData.delete(s);
    __setErp([O, I]); updateStats();
  }, { O: FILE_O, I: FILE_I });
  expect(await card(app.page)).toMatchObject({ value: '8 / 8', sub: '', bar: ['เข้า ProMaxx แล้ว', '100%', '100%'], color: 'green' });
  await app.page.evaluate(() => { state.scanData.clear(); updateStats(); });
  expect(await card(app.page)).toMatchObject({ label: LABEL, value: '0 / 0', sub: '', bar: null, color: 'green' });
  await app.page.evaluate(() => { _adjErp = null; updateStats(); });   // ไม่มีงานและยังไม่อัป → ไม่ต้องเตือนให้อัป
  expect(await card(app.page)).toMatchObject({ value: '0 / 0', sub: '', bar: null, color: 'green' });
  await closeApp(app);
});

test('★ เภสัช: แถวที่ส่งออกไป 🗂️ แล้วยังอยู่ใน Y · ต่อทิศเทียบชิป ✅ ในป็อปอัพได้ (ต่างกันเฉพาะส่งออกแล้ว/ต้องรีเช็คใหม่)', async ({ browser }) => {
  const app = await bootBare(browser);
  await seed(app.page, { role: 'pharmacist' });
  const r = await app.page.evaluate(({ O, I, EPOCH }) => {
    _adjHistApply('SRC', EPOCH, [{ no: 'ORDSBY001', dir: 'ords', at: '2026-09-22T03:00:00.000Z', by: 'Pharm', rows: [['EXPORTED', 4, 4, null, '', '']] }], 'Pharm', '');
    __setErp([O, I]); updateStats();
    const chips = (dir) => { const vr = _adjustDocViewRows(dir); let done = 0; for (const x of vr.all) if (_adjErpGroup(vr.ev.get(x.sku)?.state) === 'done') done++; return { rows: vr.all.map((x) => x.sku), done }; };
    return { ords: chips('ords'), irps: chips('irps') };
  }, { O: FILE_O, I: FILE_I, EPOCH });
  expect(r.ords.rows).not.toContain('EXPORTED');          // ตารางซ่อนแถวที่ส่งออกแล้ว
  expect(r.ords.rows).not.toContain('LG-STALE-DONE');     // ใบตัดรายการที่ต้องรีเช็คใหม่
  expect(r.ords.done).toBe(4);                            // D-ORDS-DONE · AU-PAIR · NS-LIVE · EDIT-QTY
  expect(r.irps.done).toBe(1);
  const s = await stats(app.page);
  expect(s).toMatchObject({ done: 8, total: 14, exported: 1, stale: 2 });
  expect(s.by.ORDS.done).toBe(r.ords.done + 1 /* EXPORTED */ + 1 /* LG-STALE-DONE */);
  expect(s.by.IRPS.done).toBe(r.irps.done);
  expect((await card(app.page)).title).toContain('รวมที่ส่งออกแล้ว (🗂️ ประวัติปรับปรุง) 1');
  await closeApp(app);
});

test('★ ทุก role ในสาขายาเห็นการ์ดใหม่ (Desktop + PDA) · WH / ยังไม่ล็อกอิน = การ์ดเดิม', async ({ browser }) => {
  const app = await bootBare(browser);
  for (const branch of ['SRC', 'KKL', 'SSS']) for (const role of ['assistant', 'pharmacist']) {
    await seed(app.page, { branch, role });
    await app.page.evaluate(() => { updateStats(); applyAuditTerminology(); });
    expect(await card(app.page), `${branch}/${role}`).toMatchObject({ label: LABEL, value: '0 / 13', sub: 'ยังไม่อัป R02.102' });
  }
  for (const role of ['supervisor', 'warehouse']) {
    await seed(app.page, { branch: 'WH', role });
    await app.page.evaluate(() => { updateStats(); applyAuditTerminology(); });
    expect(await card(app.page), `WH/${role}`).toMatchObject({ label: 'Recheck', value: '4', title: '', color: 'red' });   // audit 4 ตัว = การ์ดเดิมของ WH
  }
  await seed(app.page, { branch: 'SRC', role: '' });
  await app.page.evaluate(() => { updateStats(); applyAuditTerminology(); });
  expect(await card(app.page)).toMatchObject({ label: 'รอรีเช็ค', value: '4', title: '' });
  await closeApp(app);

  // PDA ผู้ช่วย: การ์ดที่ 4 ของ 2×2 เป็นการ์ดใหม่และมองเห็นจริง
  const pda = await newAppContext(browser, { login: false, mode: 'pda' });
  await pda.page.goto('/index.html');
  await waitForAppReady(pda.page, { login: false });
  await seed(pda.page, { role: 'assistant' });
  await pda.page.evaluate(({ O, I }) => { __setErp([O, I]); updateStats(); applyAuditTerminology(); }, { O: FILE_O, I: FILE_I });
  expect(await card(pda.page)).toMatchObject({ label: LABEL, value: '8 / 14', sub: '⚠️ ไม่ตรง 3' });
  expect(await pda.page.evaluate(() => getComputedStyle(document.getElementById('statFail').closest('.stat-card')).display)).not.toBe('none');
  await closeApp(pda);
});

test('★ ทางถอย: สวิตช์ปิด / ADJUST_DOC_ERP_CHECK=false = การ์ดเดิมทุกตัวอักษร · สลับไปมาไม่ค้าง · ผู้ช่วยถูกล้างผล ERP · ไม่ฟัง cloud', async ({ browser }) => {
  const app = await bootBare(browser);
  await seed(app.page);
  // การ์ดเดิม: audit 4 ตัว · บาร์ "เภสัชรีเช็คแล้ว" = audit 4 + Stock Adj ที่ไม่ใช่ตรง 6 (นับแล้ว 6) → 6 / 10 = 60%
  const OLD = { label: 'รอรีเช็ค', value: '4', sub: '6 / 10', bar: ['เภสัชรีเช็คแล้ว', '60%', '60%'], color: 'red', title: '' };
  const r = await app.page.evaluate(({ O, I }) => {
    __setErp([O, I]);
    const out = {};
    PHARMACY_ADJ_ERP_CARD = false; updateStats(); applyAuditTerminology(); out.off = __card();
    PHARMACY_ADJ_ERP_CARD = true; updateStats(); out.on = __card();
    PHARMACY_ADJ_ERP_CARD = false; updateStats(); out.offAgain = __card();
    PHARMACY_ADJ_ERP_CARD = true; ADJUST_DOC_ERP_CHECK = false; updateStats(); applyAuditTerminology(); out.erpOff = __card();
    ADJUST_DOC_ERP_CHECK = true; updateStats(); out.erpOn = __card();
    return out;
  }, { O: FILE_O, I: FILE_I });
  expect(r.off).toEqual(OLD);
  expect(r.on).toMatchObject({ label: LABEL, value: '8 / 14' });
  expect(r.offAgain).toEqual(OLD);                        // สีเขียว/คำอธิบายของโหมดใหม่ไม่ค้าง
  expect(r.erpOff).toEqual(OLD);
  expect(r.erpOn).toMatchObject({ label: LABEL, value: '8 / 14' });

  // สวิตช์ปิด: ผู้ช่วยกลับไปถูกล้างผล ERP ตอน updateAdjustDocPanel (เหมือนก่อนแก้) · ไม่สมัครฟัง cloud
  const off = await app.page.evaluate(({ O }) => {
    window.__subs = 0;
    _db = { collection: () => ({ doc: () => ({ onSnapshot: () => { window.__subs++; return () => {}; }, get: async () => ({ exists: false }) }) }) };
    PHARMACY_ADJ_ERP_CARD = false; __setErp([O]); updateAdjustDocPanel();
    const cleared = _adjErp === null;
    startAdjErpListener();
    return { cleared, subs: window.__subs };
  }, { O: FILE_O });
  expect(off).toEqual({ cleared: true, subs: 0 });
  await closeApp(app);
});

test('รีเฟรชเอง: applyAuditTerminology ไม่ทับป้าย · แนบไฟล์ · แก้/คืนจำนวนในใบ · ผู้ช่วยไม่ถูกล้างผล ERP', async ({ browser }) => {
  const app = await bootBare(browser);
  await app.page.evaluate(() => { window.__toasts = []; toast = (m, t) => { window.__toasts.push(`${t || 'info'}|${m}`); }; _markSkuDirty = () => {}; _refreshAdjMaster = async () => {}; });
  await seed(app.page, { role: 'pharmacist' });
  await app.page.evaluate(() => { updateStats(); applyAuditTerminology(); });
  expect(await card(app.page)).toMatchObject({ label: LABEL, value: '0 / 13' });

  // แนบผ่าน handler จริง (ไม่มี cloud → เฉพาะเครื่องนี้) — การ์ดขยับเองโดยไม่ต้องรอ updateStats
  await app.page.evaluate(async ({ O, I }) => {
    const f = (name, text) => new File([text], name, { type: 'text/csv' });
    await handleAdjErpFiles({ target: { files: [f('r16104.csv', O), f('r16103.csv', I)] } });
  }, { O: csvText(FILE_O), I: csvText(FILE_I) });
  let c = await card(app.page);
  expect(c).toMatchObject({ value: '8 / 14', sub: '⚠️ ไม่ตรง 3' });
  expect(c.title).toContain('เห็นเฉพาะเครื่องนี้ (บันทึกขึ้น Cloud ไม่สำเร็จ)');

  // เภสัชแก้จำนวน D-PARTIAL 5 → 3 (= ที่ ERP มี) → เข้าแล้ว · คืนค่า → ไม่ตรงอีกครั้ง
  await app.page.evaluate(() => setAdjDocQty('D-PARTIAL', '3'));
  expect(await card(app.page)).toMatchObject({ value: '9 / 14', sub: '⚠️ ไม่ตรง 2' });
  await app.page.evaluate(() => resetAdjDocQty('D-PARTIAL'));
  expect(await card(app.page)).toMatchObject({ value: '8 / 14', sub: '⚠️ ไม่ตรง 3' });

  // เปลี่ยนเป็นผู้ช่วย (เครื่องเดียวกัน) → ผล ERP ยังอยู่ (ผู้ช่วยใช้กับการ์ด) · ล็อกเอาต์ (role ว่าง) → ล้าง
  const r = await app.page.evaluate(() => {
    currentRole = 'assistant'; updateAdjustDocPanel(); updateStats();
    const kept = !!_adjErp; const asst = __card();
    currentRole = ''; updateAdjustDocPanel();
    return { kept, asst, cleared: _adjErp === null };
  });
  expect(r).toMatchObject({ kept: true, asst: { label: LABEL, value: '8 / 14' }, cleared: true });
  await closeApp(app);
});

test('listener {branch}_adjerp: เครื่องอื่นแนบ → การ์ดขยับเอง · รอบอื่น = ว่าง · ไม่ทับ "เฉพาะเครื่องนี้" · สาขาเปลี่ยน = ทิ้ง · ผลอ่านเก่าถูกทิ้ง · WH ไม่ฟัง', async ({ browser }) => {
  const app = await bootBare(browser);
  await seed(app.page, { role: 'assistant' });
  await app.page.evaluate(({ O, I, EPOCH }) => {
    // fake Firestore: doc().onSnapshot (เก็บ callback) + get (ค้างได้)
    window.__subs = []; window.__getGate = null; window.__store = {};
    const ref = (p) => ({ path: p,
      onSnapshot: (cb) => { const s = { p, cb, on: true }; window.__subs.push(s); return () => { s.on = false; }; },
      get: async () => { if (window.__getGate) await window.__getGate; const d = window.__store[p]; return { exists: !!d, data: () => d }; } });
    _db = { collection: (c) => ({ doc: (id) => ref(c + '/' + id) }) };
    window.__emit = (p, d) => { window.__store[p] = d; for (const s of window.__subs) if (s.on && s.p === p) s.cb({ exists: !!d, data: () => d }); };
    window.__docOf = (sheets, epoch) => {
      let m = null; for (const rows of sheets) m = _mergeAdjErp(m, _parseAdjErpRows(rows, 'SRC', EPOCH), { at: '2026-10-09T08:00:00.000Z', by: 'Pharm' });
      return { countResetAt: epoch, docs_json: JSON.stringify(Object.values(m.docs)), cover_json: JSON.stringify(m.cover), branchName: '', note: '', updatedBy: 'Pharm',
        updatedAt: { toDate: () => new Date('2026-10-09T08:00:00.000Z') } };
    };
    window.__O = O; window.__I = I;
    updateStats();
  }, { O: FILE_O, I: FILE_I, EPOCH });

  const P = 'stock_sessions/SRC_adjerp';
  const r1 = await app.page.evaluate(({ P, EPOCH }) => {
    startAdjErpListener();
    const subs = window.__subs.filter((s) => s.on).map((s) => s.p);
    __emit(P, __docOf([__O, __I], EPOCH));                         // เภสัชเครื่องอื่นแนบ → ไม่เรียก updateStats เอง
    return { subs, card: __card() };
  }, { P, EPOCH });
  expect(r1.subs).toEqual([P]);
  expect(r1.card).toMatchObject({ label: LABEL, value: '8 / 14', sub: '⚠️ ไม่ตรง 3' });

  // doc ของรอบนับอื่น → ไม่ใช่ของรอบนี้ = ว่าง
  expect(await app.page.evaluate(({ P }) => { __emit(P, __docOf([__O, __I], '2026-08-01T01:00:00.000Z')); return __card(); }, { P }))
    .toMatchObject({ value: '0 / 13', sub: 'ยังไม่อัป R02.102' });

  // ผลในเครื่องที่ยังไม่ขึ้น cloud (localOnly) ไม่ถูก snapshot ทับ
  expect(await app.page.evaluate(({ P, EPOCH }) => { __setErp([__O], { localOnly: true }); __emit(P, __docOf([__O, __I], EPOCH)); return [_adjErp.localOnly, Object.keys(_adjErp.cover)]; }, { P, EPOCH }))
    .toEqual([true, ['ORDS']]);

  // สาขาเปลี่ยนแล้ว snapshot ของสาขาเดิมมาช้า → ทิ้ง
  expect(await app.page.evaluate(({ P, EPOCH }) => {
    _adjErp = null; currentBranch = 'KKL'; const before = _adjErp;
    __emit(P, __docOf([__O, __I], EPOCH)); const after = _adjErp; currentBranch = 'SRC';
    return [before, after];
  }, { P, EPOCH })).toEqual([null, null]);

  // เภสัชเปิดป็อปอัพ (get ค้าง) → snapshot ใหม่มาก่อน → ผลอ่านเก่ามาทีหลังต้องไม่ทับ
  const r2 = await app.page.evaluate(async ({ P, EPOCH }) => {
    currentRole = 'pharmacist';
    window.__store[P] = __docOf([__O], EPOCH);                       // ของเก่าบน cloud = ORDS อย่างเดียว
    let open; window.__getGate = new Promise((res) => { open = res; });
    const pending = _loadAdjErpFromCloud();
    __emit(P, __docOf([__O, __I], EPOCH));                           // snapshot ใหม่ (ORDS+IRPS)
    window.__store[P] = __docOf([__O], EPOCH); window.__getGate = null; open(); await pending;
    return Object.keys(_adjErp.cover).sort();
  }, { P, EPOCH });
  expect(r2).toEqual(['IRPS', 'ORDS']);

  // stop → ไม่ฟังแล้ว · WH ไม่สมัคร
  expect(await app.page.evaluate(() => {
    stopAdjErpListener(); const live = window.__subs.filter((s) => s.on).length;
    currentBranch = 'WH'; currentRole = 'supervisor'; startAdjErpListener(); const wh = window.__subs.filter((s) => s.on).length;
    return [live, wh];
  })).toEqual([0, 0]);
  await closeApp(app);
});

test('ไม่กวน PROGRESS_BY_SCAN: Counted / Pass / Progress เท่ากับ _scanProgressCounts ทั้งตอนเปิดและปิดการ์ด', async ({ browser }) => {
  const app = await bootBare(browser);
  await seed(app.page);
  const r = await app.page.evaluate(({ O, I }) => {
    _countableSkus.clear();
    for (const s of ['D-ORDS-DONE', 'D-ORDS-NONE', 'AU-PAIR', 'NS-LIVE', 'PASS1', 'LG-FRESH']) _countableSkus.add(s);
    state.scanData.set('TODO1', { status: 'pending', countedQty: 0 }); _countableSkus.add('TODO1');
    state.skuMap.set('TODO1', { sku: 'TODO1', productName: 'x', unitPrice: 20, systemQty: 4, negSys: false, barcodes: [], isDel: false });
    _cachedTotalSku = _countableSkus.size;
    __setErp([O, I]);
    const read = () => { const t = (id) => document.getElementById(id).textContent; return [t('statCounted'), t('statPass'), t('progressCount'), t('statPct')]; };
    const want = () => { const { scanned, pass } = _scanProgressCounts(); return [String(scanned), String(pass), `${scanned} / ${_cachedTotalSku}`, Math.round(scanned / _cachedTotalSku * 100) + '%']; };
    updateStats(); const on = { got: read(), want: want(), card: __card().value };
    PHARMACY_ADJ_ERP_CARD = false; updateStats(); const off = { got: read(), want: want() };
    return { on, off };
  }, { O: FILE_O, I: FILE_I });
  expect(r.on.got).toEqual(r.on.want);
  expect(r.on.got).toEqual(['6', '1', '6 / 7', '86%']);
  expect(r.on.card).toBe('8 / 14');
  expect(r.off.got).toEqual(r.on.got);
  await closeApp(app);
});
