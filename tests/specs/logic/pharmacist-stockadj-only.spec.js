// เภสัชสาขายา (SRC/KKL/SSS) ทำ Stock Adj อย่างเดียว ไม่ทำ Audit (30 ก.ย. 2026 · ผู้ใช้สั่ง · สวิตช์ PHARMACIST_STOCKADJ_ONLY)
//
// UI-gating ล้วน — โหมดตัดสินจากจำนวน audit ที่ค้างอยู่ใน state.scanData:
//   idle (เภสัช + สาขายา + audit = 0) → ซ่อนช่องสแกน/RESULT/ปุ่มยืนยัน Audit · แผงเหลือ "Stock Adj" · ป็อปอัพเปิดแท็บ Stock Adj (ยังมี ↺)
//   มี audit ค้าง (ของเดิม หรือรายการที่กด ↺ กลับมา) → UI เดิมครบทุกอย่าง
//
// เทสนี้ตรึง 4 ด้าน — ด้านที่ 3-4 สำคัญที่สุดเพราะกติกาใหม่ต้องไม่ลามไปที่อื่น:
//   1. idle: ซ่อน/แสดงถูกจุด  2. มี audit ค้าง = เท่าเดิม และสลับโหมดได้ทั้งสองทิศทางระหว่างใช้งาน
//   3. สวิตช์ปิด = เท่าเดิม  4. ★ role/สาขาอื่น (ผู้ช่วย · หัวหน้า WH · เภสัช WH) ไม่ถูกแตะ
//
// ต.ค. 2026: ป้ายสาขายาไม่มีคำว่า Audit แล้ว (PHARMACY_RECHECK_TERMS) — แผง/ปุ่มเป็น "Stock Adj" ทุกโหมด
//   โครงสร้าง (ซ่อน/แสดง) ยังตัดสินด้วย PHARMACIST_STOCKADJ_ONLY เหมือนเดิม · ปิดทั้งสองสวิตช์ = ข้อความเดิมทุกตัวอักษร
//   ข้อความทั้งจอตรึงไว้ที่ pharmacy-no-audit-terms.spec.js
const { test, expect, bootBare, closeApp } = require('../../lib/hooks');

// ตั้ง role/สาขา/รายการ แล้วสั่งให้ UI คำนวณโหมดใหม่ผ่านเส้นทางจริง (updateAuditVerifyCount)
async function setup(page, { branch = 'SRC', role = 'pharmacist', audit = 0, adj = 1, on = true, terms = true } = {}) {
  await page.evaluate(({ branch, role, audit, adj, on, terms }) => {
    PHARMACIST_STOCKADJ_ONLY = on; PHARMACY_RECHECK_TERMS = terms;
    currentBranch = branch; currentRole = role; currentUser = 'T';
    state.scanData.clear(); state.skuMap.clear();
    const mk = (sku, status) => {
      state.skuMap.set(sku, { sku, productName: 'p-' + sku, unitPrice: 20, systemQty: 5, negSys: false, barcodes: [], isDel: false });
      state.scanData.set(sku, { status, countedQty: 3, timestamp: '2026-09-30 10:00:00', scannedBy: 'A', auditStatus: status,
        ...(status === 'stock_adjustment' ? { directAdj: true, effectiveQty: 3, systemQty: 5, initialStatus: 'stock_adjustment' } : { initialStatus: 'audit' }) });
    };
    for (let i = 0; i < audit; i++) mk('AU' + i, 'audit');
    for (let i = 0; i < adj; i++) mk('SA' + i, 'stock_adjustment');
    // ลำดับเดียวกับ initAfterLogin: updateScanInputMode (เปิดแถบยืนยัน Audit ของเภสัช) → applyAuditTerminology (ตั้งป้ายแผงแล้วให้โหมดทับ)
    updateScanInputMode(); applyAuditTerminology();
    updateAuditVerifyCount();
  }, { branch, role, audit, adj, on, terms });
}

// สถานะที่ผู้ใช้เห็นจริง (computed style — ไม่ใช่แค่ class)
async function ui(page) {
  return page.evaluate(() => {
    const vis = (sel) => { const e = document.querySelector(sel); return !!e && getComputedStyle(e).display !== 'none'; };
    const txt = (id) => (document.getElementById(id) || {}).textContent;
    return {
      idleClass: document.body.classList.contains('pharm-audit-idle'),
      scanBlock: vis('#scanInputBlock'), resultBar: vis('.result-bar'), listCard: vis('.scan-list-card'),
      auditBar: vis('#pharmacistAuditBar'), note: vis('#pharmIdleNote'),
      panelTitle: txt('auditVerifyPanelTitle'), panelBtn: txt('auditVerifyBtnLabel'),
    };
  });
}
async function popup(page) {
  return page.evaluate(() => {
    const vis = (id) => { const e = document.getElementById(id); return !!e && getComputedStyle(e).display !== 'none'; };
    return {
      filter: _avFilter, title: document.getElementById('auditVerifyTitle').textContent,
      tabAudit: vis('avBtnAudit'), scanRow: vis('avScanRow'), confirmAll: vis('avConfirmAllBtn'),
      activeTab: (document.querySelector('#auditVerifyPopupOverlay .popup-filter.active') || {}).id,
      reopenBtns: document.querySelectorAll('#auditVerifyTableBody button[onclick^="reopenPharmacyAudit"]').length,
    };
  });
}

const IDLE_UI = { idleClass: true, scanBlock: false, resultBar: false, listCard: false, auditBar: false, note: true, panelTitle: 'Stock Adj', panelBtn: 'Stock Adj' };
const NORMAL_UI = { idleClass: false, scanBlock: true, resultBar: true, listCard: true, auditBar: true, note: false, panelTitle: 'Stock Adj', panelBtn: 'Stock Adj' };
// ปิด PHARMACY_RECHECK_TERMS ด้วย = หน้าจอก่อนเปลี่ยนคำ (ababb7a) ทุกตัวอักษร
const NORMAL_UI_OLD = { ...NORMAL_UI, panelTitle: 'Audit Verify', panelBtn: 'Audit Verify' };
const RECHECK_TITLE = '🔴 Stock Adj — ตรวจ/รีเช็คสินค้า (เภสัช)';
const OLD_TITLE = '🔍 Audit Verify — ตรวจสอบสินค้า (เภสัช)';

test('เภสัช + ไม่มี audit ค้าง → ซ่อนช่องสแกน/RESULT/ปุ่มยืนยัน Audit · แผงเป็น Stock Adj · ป็อปอัพเปิดแท็บ Stock Adj มี ↺', async ({ browser }) => {
  const app = await bootBare(browser);
  await setup(app.page, { audit: 0, adj: 2 });
  expect(await ui(app.page)).toEqual(IDLE_UI);

  await app.page.evaluate(() => openAuditVerifyPopup());
  expect(await popup(app.page)).toEqual({
    filter: 'stock_adj', title: '🔴 Stock Adj — ตรวจ/ย้อนรายการ (เภสัช)', tabAudit: false, scanRow: false, confirmAll: false,
    activeTab: 'avBtnStockAdj', reopenBtns: 2, // ↺ เก็บไว้ในหน้า Stock Adj (คำตอบผู้ใช้ข้อ 2)
  });
  await closeApp(app);
});

test('มี audit ค้าง (รอรีเช็ค) → โครงเดิมครบ (ช่องสแกน · ปุ่มยืนยัน · ป็อปอัพแท็บรอรีเช็ค + แถวสแกน) · ป้ายเป็น Stock Adj', async ({ browser }) => {
  const app = await bootBare(browser);
  await setup(app.page, { audit: 1, adj: 1 });
  expect(await ui(app.page)).toEqual(NORMAL_UI);

  await app.page.evaluate(() => openAuditVerifyPopup());
  expect(await popup(app.page)).toEqual({
    filter: 'audit', title: RECHECK_TITLE, tabAudit: true, scanRow: true, confirmAll: false,
    activeTab: 'avBtnAudit', reopenBtns: 0, // ตารางแท็บรอรีเช็คไม่มีปุ่ม ↺
  });
  // ปิดสวิตช์คำ → ข้อความเดิมเป๊ะ
  await setup(app.page, { audit: 1, adj: 1, terms: false });
  expect(await ui(app.page)).toEqual(NORMAL_UI_OLD);
  await app.page.evaluate(() => openAuditVerifyPopup());
  expect((await popup(app.page)).title).toBe(OLD_TITLE);
  await closeApp(app);
});

test('สลับโหมดระหว่างใช้งาน: กด ↺ (audit เข้า) → UI Audit โผล่เอง · ปิด audit ครบ → กลับ idle และป็อปอัพเลื่อนจากแท็บ Audit ไปแท็บ Stock Adj', async ({ browser }) => {
  const app = await bootBare(browser);
  await setup(app.page, { audit: 0, adj: 1 });
  expect(await ui(app.page)).toEqual(IDLE_UI);
  await app.page.evaluate(() => openAuditVerifyPopup());

  // ↺ = รายการ Stock Adj กลับเป็น audit (จำลองสถานะที่ reopenPharmacyAudit ทิ้งไว้) แล้ว updateStats/updateAuditVerifyCount ตามมาเอง
  await app.page.evaluate(() => { const s = state.scanData.get('SA0'); s.status = 'audit'; s.auditStatus = 'pending'; s.initialStatus = 'audit'; updateAuditVerifyCount(); });
  expect(await ui(app.page)).toEqual(NORMAL_UI);
  const mid = await popup(app.page);
  expect(mid).toMatchObject({ tabAudit: true, scanRow: true, title: RECHECK_TITLE });

  // เภสัชอยู่บนแท็บ Audit ตอนที่ audit รายการสุดท้ายถูกปิด → แท็บ Audit ถูกซ่อน ต้องเลื่อนไป Stock Adj ไม่ค้างที่แท็บว่างที่กดกลับไม่ได้
  await app.page.evaluate(() => { document.getElementById('avBtnAudit').click(); });
  expect((await popup(app.page)).filter).toBe('audit');
  await app.page.evaluate(() => { const s = state.scanData.get('SA0'); s.status = 'stock_adjustment'; s.auditStatus = 'stock_adjustment'; updateAuditVerifyCount(); });
  expect(await ui(app.page)).toEqual(IDLE_UI);
  expect(await popup(app.page)).toMatchObject({ filter: 'stock_adj', activeTab: 'avBtnStockAdj', tabAudit: false, scanRow: false, reopenBtns: 1 });
  await closeApp(app);
});

test('สวิตช์ปิด (PHARMACIST_STOCKADJ_ONLY=false) → โครงเท่าเดิมทุกจุด แม้ไม่มี audit ค้าง · ปิดสวิตช์คำด้วย = ข้อความเดิม', async ({ browser }) => {
  const app = await bootBare(browser);
  await setup(app.page, { audit: 0, adj: 1, on: false });
  expect(await ui(app.page)).toEqual(NORMAL_UI);
  await app.page.evaluate(() => openAuditVerifyPopup());
  expect(await popup(app.page)).toMatchObject({ filter: 'audit', tabAudit: true, scanRow: true, activeTab: 'avBtnAudit', title: RECHECK_TITLE });
  await setup(app.page, { audit: 0, adj: 1, on: false, terms: false });
  expect(await ui(app.page)).toEqual(NORMAL_UI_OLD);
  await app.page.evaluate(() => openAuditVerifyPopup());
  expect(await popup(app.page)).toMatchObject({ filter: 'audit', tabAudit: true, scanRow: true, activeTab: 'avBtnAudit', title: OLD_TITLE });
  await closeApp(app);
});

test('★ สวิตช์ปิดกลางทาง (อยู่ idle อยู่) → ป้าย/ปุ่ม/แถวสแกนถูกย้อนกลับ ไม่ค้างเป็น Stock Adj', async ({ browser }) => {
  const app = await bootBare(browser);
  await setup(app.page, { audit: 0, adj: 1 });
  expect(await ui(app.page)).toEqual(IDLE_UI);
  await app.page.evaluate(() => { PHARMACIST_STOCKADJ_ONLY = false; updateAuditVerifyCount(); });
  expect(await ui(app.page)).toEqual(NORMAL_UI);
  // ปิดทั้งสองสวิตช์กลางทาง → ป้ายกลับเป็นคำเดิม (ไม่ค้าง Stock Adj)
  await app.page.evaluate(() => { PHARMACIST_STOCKADJ_ONLY = true; updateAuditVerifyCount(); PHARMACY_RECHECK_TERMS = false; PHARMACIST_STOCKADJ_ONLY = false; applyAuditTerminology(); updateAuditVerifyCount(); });
  expect(await ui(app.page)).toEqual(NORMAL_UI_OLD);
  await closeApp(app);
});

test('★ role/สาขาอื่นไม่ถูกแตะ: ผู้ช่วยสาขายา · เภสัช WH · หัวหน้า WH — ไม่มี idle แม้ audit = 0 และป้ายเป็นคำตามสาขาเดิม', async ({ browser }) => {
  const app = await bootBare(browser);
  const cases = [
    { branch: 'SRC', role: 'assistant', title: 'Stock Adj' },               // สาขายา: ป้ายเปลี่ยนตามคำใหม่ทุก role (PHARMACY_RECHECK_TERMS) แต่ไม่มี idle
    { branch: 'KKL', role: 'supervisor', title: 'Stock Adj' },
    { branch: 'SSS', role: 'assistant', title: 'Audit Verify', terms: false }, // ปิดสวิตช์คำ = คำเดิม
    { branch: 'WH', role: 'pharmacist', title: 'Recheck' },   // WH ไม่ใช่สาขายา — เภสัชบน WH (ถ้ามี) ต้องไม่เข้าโหมดนี้
    { branch: 'WH', role: 'supervisor', title: 'Recheck' },
    { branch: 'WH', role: 'warehouse', title: 'Recheck' },
  ];
  for (const c of cases) {
    await setup(app.page, { branch: c.branch, role: c.role, audit: 0, adj: 1, terms: c.terms !== false });
    const u = await ui(app.page);
    expect(u.idleClass, `${c.branch}/${c.role}`).toBe(false);
    expect(u.note, `${c.branch}/${c.role}`).toBe(false);
    expect(u.scanBlock, `${c.branch}/${c.role}`).toBe(true);
    expect(u.panelTitle, `${c.branch}/${c.role}`).toBe(c.title);
    expect(u.panelBtn, `${c.branch}/${c.role}`).toBe(c.title);
  }
  await closeApp(app);
});

test('การแก้นี้ไม่แตะเส้นทางสแกน/ยืนยัน: processPharmacistAuditScan ยังปฏิเสธ SKU ที่ไม่ใช่ Audit (ด่านกันสแกนในโหมด idle)', async ({ browser }) => {
  const app = await bootBare(browser);
  await setup(app.page, { audit: 0, adj: 1 });
  // สแกน SKU ที่เป็น Stock Adj ตอนเภสัช idle (เช่น เครื่องสแกน PDA ยิงเข้ามาเอง) — ต้องไม่เขียน recheck ใดๆ
  const r = await app.page.evaluate(() => {
    state.barcodeMap.set('BC-SA0', 'SA0');
    document.getElementById('scanInput').value = 'BC-SA0';
    processPharmacistAuditScan();
    const s = state.scanData.get('SA0');
    return { status: s.status, recheckQty: s.recheckQty, recheckBy: s.recheckBy };
  });
  expect(r).toEqual({ status: 'stock_adjustment', recheckQty: undefined, recheckBy: undefined });
  await closeApp(app);
});
