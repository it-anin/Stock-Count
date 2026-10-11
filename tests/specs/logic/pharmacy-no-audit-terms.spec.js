// สาขายา (SRC/KKL/SSS) — จอไม่มีคำว่า "Audit" (ต.ค. 2026 · ผู้ใช้สั่ง "ตัดขั้น Audit ของเภสัช" · สวิตช์ PHARMACY_RECHECK_TERMS)
//
// แสดงผลล้วน: status code 'audit' ไม่เปลี่ยน · รายการที่รอเภสัช (Audit ค้าง / กด ↺ / R16 อัปซ้ำพลิก) เรียก "Stock Adj · รอรีเช็ค"
// เทสนี้ตรึง 4 ด้าน:
//   1. ★ ข้อความที่มองเห็นบนจอสาขายาไม่มี /Audit/ ทุกจุดที่เคยมี (การ์ด · แผง · RESULT · ปุ่มยืนยัน · ป็อปอัพ 2 ตัว · คู่มือ 2 ตัว · Dashboard · toast)
//   2. PDA ใช้ป้ายสั้น (ช่องสถานะแคบ)
//   3. ★ WH ไม่ถูกแตะ (ยังเป็น Recheck)
//   4. ★ สวิตช์ปิด = ข้อความเดิมทุกตัวอักษร
const { test, expect, bootBare, closeApp, newAppContext, waitForAppReady } = require('../../lib/hooks');

// สร้างสถานะสาขา: audit = รอรีเช็ค · adj = Stock Adj ตรง · pass
async function setup(page, { branch = 'SRC', role = 'pharmacist', audit = 2, adj = 1, terms = true } = {}) {
  await page.evaluate(({ branch, role, audit, adj, terms }) => {
    PHARMACY_RECHECK_TERMS = terms; PHARMACIST_STOCKADJ_ONLY = true;
    currentBranch = branch; currentRole = role; currentUser = 'T';
    state.scanData.clear(); state.skuMap.clear(); scanListMap.clear();
    const mk = (sku, status, extra = {}) => {
      state.skuMap.set(sku, { sku, productName: 'p-' + sku, unitPrice: 20, systemQty: 5, negSys: false, barcodes: [{ barcode: 'B' + sku, unitName: 'ชิ้น', unitMultiplier: 1 }], isDel: false });
      state.scanData.set(sku, { status, countedQty: 3, timestamp: '2026-09-30 10:00:00', firstScanAt: '2026-09-30 10:00:00', scannedBy: 'T', auditStatus: status, ...extra });
    };
    for (let i = 0; i < audit; i++) mk('AU' + i, 'audit', { initialStatus: 'audit', auditStatus: 'pending' });
    for (let i = 0; i < adj; i++) mk('SA' + i, 'stock_adjustment', { directAdj: true, effectiveQty: 3, systemQty: 5, initialStatus: 'stock_adjustment' });
    mk('PS0', 'pass', { initialStatus: 'pass', auditStatus: 'approved' });
    // แผงซ้ายถูกซ่อนจนกว่าจะ login — เรียกชุดเดียวกับตอน login ให้แผงแสดงจริง (ไม่งั้นตัวตรวจข้อความมองไม่เห็นแผง)
    updateAuditVerifyPanel(); updateHistoryStatsPanel(); updateAdjustDocPanel();
    updateScanInputMode(); applyAuditTerminology();
    rebuildScanListMap(true); renderScanList(); updateStats(); updateAuditVerifyCount(); updatePharmacistAuditConfirmBtn();
  }, { branch, role, audit, adj, terms });
}

// บรรทัดที่มีคำว่า Audit ในข้อความที่ผู้ใช้เห็น (innerText = เฉพาะที่แสดงจริง ไม่รวม display:none)
async function auditLines(page, selectors) {
  return page.evaluate((sels) => {
    const out = [];
    for (const sel of sels) {
      const el = document.querySelector(sel);
      if (!el) { out.push(`${sel}: (ไม่พบ element)`); continue; }
      for (const line of (el.innerText || '').split('\n')) if (/audit/i.test(line)) out.push(`${sel}: ${line.trim()}`);
    }
    return out;
  }, selectors);
}
const MAIN = ['.stats-bar', '.left-panel', '.center-panel'];

test('★ เภสัชสาขายา มีรายการรอรีเช็ค: การ์ด · แผง · RESULT · ปุ่มยืนยัน · ป็อปอัพทั้งสองแท็บ ไม่มีคำว่า Audit', async ({ browser }) => {
  const app = await bootBare(browser);
  for (const branch of ['SRC', 'KKL', 'SSS']) {
    await setup(app.page, { branch });
    expect(await auditLines(app.page, MAIN), branch).toEqual([]);
    const t = await app.page.evaluate(() => ({
      card: document.getElementById('statAuditLabel').textContent,
      sub: document.getElementById('auditProgressLabel').textContent,
      panel: document.getElementById('auditVerifyPanelTitle').textContent,
      btn: document.getElementById('pharmacistAuditBtnLabel').textContent,
      pill: document.querySelector('#scanListBody .scan-row[data-sku="AU0"] .pill').innerText, // Desktop แบ่ง 2 บรรทัด (ช่อง 128px)
    }));
    // การ์ดใบที่ 4 ของสาขายา = "Stock Adj เข้าระบบ" (ต.ค. 2026 · PHARMACY_ADJ_ERP_CARD — การ์ดรอรีเช็คเดิมตรึงไว้ในเทสสวิตช์ปิดด้านล่าง)
    expect(t, branch).toEqual({ card: 'Stock Adj เข้าระบบ', sub: 'เข้า ProMaxx แล้ว', panel: 'Stock Adj', btn: '✓ ยืนยันรีเช็ค', pill: '⚠️ Stock Adj\nรอรีเช็ค' });
    // ป้ายต้องไม่ล้นช่อง STATUS (เคยถูกตัดเป็น "Stock Adj · รอรีเช็…" เมื่ออยู่บรรทัดเดียว)
    const fit = await app.page.evaluate(() => { const p = document.querySelector('#scanListBody .scan-row[data-sku="AU0"] .pill'); const c = p.parentElement;
      return p.getBoundingClientRect().right <= c.getBoundingClientRect().right + 0.5; });
    expect(fit, branch).toBe(true);
  }

  // ป็อปอัพ Stock Adj — แท็บรอรีเช็ค (ค่าเริ่มต้นเมื่อมีรายการรอ) แล้วแท็บ Stock Adj
  await app.page.evaluate(() => openAuditVerifyPopup());
  expect(await auditLines(app.page, ['#auditVerifyPopupOverlay'])).toEqual([]);
  expect(await app.page.evaluate(() => ({ title: document.getElementById('auditVerifyTitle').textContent, tab: document.getElementById('avTabAuditLabel').textContent,
    count: document.getElementById('auditVerifyRowCount').textContent })))
    .toEqual({ title: '🔴 Stock Adj — ตรวจ/รีเช็คสินค้า (เภสัช)', tab: 'รอรีเช็ค', count: '2 รายการ รอรีเช็ค' });
  await app.page.evaluate(() => document.getElementById('avBtnStockAdj').click());
  expect(await auditLines(app.page, ['#auditVerifyPopupOverlay'])).toEqual([]);
  await app.page.evaluate(() => closeAuditVerifyPopup());

  // 📋 รายการสต็อค — ตัวกรอง/หัวคอลัมน์/ป้ายในตาราง (เภสัชเปิดมาที่ตัวกรองรอรีเช็ค)
  await app.page.evaluate(() => { openStockPopup(); renderPopupTable(); });
  await app.page.waitForFunction(() => document.querySelectorAll('#popupTableBody tr').length >= 2, null, { polling: 100 });
  expect(await auditLines(app.page, ['#stockPopupOverlay'])).toEqual([]);
  expect(await app.page.evaluate(() => [document.getElementById('popupFilterAuditLabel').textContent, document.getElementById('popupThAudit').textContent]))
    .toEqual(['รอรีเช็ค', 'ผลตรวจ']);
  await closeApp(app);
});

test('★ โหมด idle · ผู้ช่วย · คู่มือ 2 ตัว · Dashboard · ข้อความเตือนตอนสแกน Stock Adj — ไม่มีคำว่า Audit', async ({ browser }) => {
  const app = await bootBare(browser);
  // เภสัช idle (ไม่มีรอรีเช็ค)
  await setup(app.page, { audit: 0, adj: 2 });
  expect(await auditLines(app.page, MAIN)).toEqual([]);
  expect(await app.page.evaluate(() => document.getElementById('pharmIdleNoteTitle').textContent)).toBe('ไม่มีรายการรอรีเช็ค — เภสัชไม่ต้องสแกน');

  // ผู้ช่วย: RESULT ของตัวเองมีรายการรอรีเช็ค (ถูก ↺) ก็ต้องไม่มีคำว่า Audit
  await setup(app.page, { role: 'assistant' });
  expect(await auditLines(app.page, MAIN)).toEqual([]);

  // คู่มือ SCAN + คู่มืออัปโหลด
  await app.page.evaluate(() => { openScanGuide(); openGuideModal(); });
  expect(await auditLines(app.page, ['#scanGuidePopover', '#guidePopover'])).toEqual([]);
  await app.page.evaluate(() => { closeScanGuide(); closeGuideModal(); });

  // Dashboard (สร้างจากข้อมูลสังเคราะห์ — ข้อความในตารางที่ render ไว้)
  const dash = await app.page.evaluate(() => {
    const mkB = (b) => ({ branch: b, totalSku: 10, passCount: 5, auditCount: 2, stockAdjCount: 3, scanningCount: 0, auditTotal: 4, auditDone: 2, auditPending: 2,
      assistants: { A: { name: 'A', scanned: 10, pass: 5, audit: 2, stockAdj: 3 } }, dateActivity: { '2026-10-01': { date: '2026-10-01', total: 4, audit: 4 } }, r01Date: '01/10/2026' });
    renderDashboard({ SRC: mkB('SRC'), KKL: mkB('KKL'), SSS: mkB('SSS') });
    return document.getElementById('dashboardBody').textContent;
  });
  expect(dash).not.toMatch(/audit/i);
  // ป้ายแต่ละจุดต้องเป็นคำที่ถูกความหมาย ไม่ใช่แค่ "ไม่มีคำว่า Audit" (เช่น "รอรีเช็ค Rate" ก็ผิด — Rate คือนับไม่ตรงทั้งหมด)
  expect(dash).toContain('นับไม่ตรง: ');
  expect(dash).toContain('⚠️ นับไม่ตรง % ต่อผู้สแกน');
  expect(dash).toContain('🧑‍⚕️ รีเช็ค (เภสัช) — ความคืบหน้า');
  expect(dash).toContain('รีเช็คทั้งหมด');
  expect(dash).not.toContain('Rate');

  // เภสัชยิงสินค้า Stock Adj ที่ช่องสแกนหลัก (ยังไม่กด ↺) — ยังปฏิเสธเหมือนเดิม แต่บอกทางที่ถูก
  // + ยิงสินค้าที่ยังไม่ได้นับ (pending) → บอกให้ไปใช้รหัสผู้ช่วยนับ (6 ต.ค. 2026 · ผู้ใช้สั่ง) · สถานะอื่นคงข้อความเดิม
  await setup(app.page, { audit: 1, adj: 1 });
  const toasts = await app.page.evaluate(() => {
    const got = []; const real = window.toast; window.toast = (m) => got.push(String(m));
    try {
      state.skuMap.set('PE0', { sku: 'PE0', productName: 'p-PE0', unitPrice: 20, systemQty: 5, negSys: false, barcodes: [{ barcode: 'BPE0', unitName: 'ชิ้น', unitMultiplier: 1 }], isDel: false });
      state.scanData.set('PE0', { status: 'pending', countedQty: 0 });
      state.barcodeMap.set('BSA0', 'SA0'); state.barcodeMap.set('BPS0', 'PS0'); state.barcodeMap.set('BPE0', 'PE0');
      for (const bc of ['BSA0', 'BPE0', 'BPS0']) { document.getElementById('scanInput').value = bc; processPharmacistAuditScan(); }
    } finally { window.toast = real; }
    const pe = state.scanData.get('PE0');
    return { got, sa: state.scanData.get('SA0').status, rq: state.scanData.get('SA0').recheckQty, pe: [pe.status, pe.countedQty, pe.recheckQty] };
  });
  expect(toasts.got).toEqual(['SA0: Stock Adj — กด ↺ สแกนใหม่ ที่ Desktop ก่อน', 'ใช้รหัสผู้ช่วยนับสินค้า', 'PS0: Pass — ไม่ใช่รายการรอรีเช็ค']);
  expect([toasts.sa, toasts.rq]).toEqual(['stock_adjustment', undefined]); // เงื่อนไขปฏิเสธไม่เปลี่ยน
  expect(toasts.pe).toEqual(['pending', 0, undefined]); // pending ก็ไม่ถูกเขียนอะไร (ไม่นับ ไม่รีเช็ค)
  await closeApp(app);
});

test('PDA (≤600px + UA PDA): ป้ายรอรีเช็คแบบสั้น · toast ย่อรู้จักข้อความใหม่', async ({ browser }) => {
  const app = await newAppContext(browser, { login: false, mode: 'pda' });
  await app.page.goto('/index.html');
  await waitForAppReady(app.page, { login: false });
  await setup(app.page, { audit: 1, adj: 0 });
  const r = await app.page.evaluate(() => ({
    pill: getScanRowStyle('audit').label,
    statusPill: getStatusPill('audit'),
    // ข้อความ R16/R01 ไม่มีคำ Audit/รอรีเช็คแล้ว (ย่อ toast ต.ค. 2026) — ตรึงว่า PDA ยังย่อข้อความชุดปัจจุบันได้
    r16: _toastMessageForDevice('R16 อัปเดตแล้ว — ใช้คำนวณรายการที่นับวันนี้'),
    r01: _toastMessageForDevice('R01.102: 10 รายการ · ล้าง R16 แล้ว อัปใหม่ก่อน Confirm'),
    r01Wh: _toastMessageForDevice('R01.102: 10 รายการ · อัป R16.104/103 ใหม่ก่อน Confirm'),
  }));
  expect(r.pill).toBe('⚠️ รอรีเช็ค');
  expect(r.statusPill).toContain('⚠️ รอรีเช็ค');
  expect(r.r16).toBe('R16 อัปเดตแล้ว');
  expect(r.r01).toBe('R01: 10 รายการ — อัป R16 ก่อน Confirm');
  expect(r.r01Wh).toBe('R01: 10 รายการ — อัป R16 ใหม่ก่อน Confirm');
  await closeApp(app);
});

test('★ WH ไม่ถูกแตะ — ยังเป็น Recheck ทุกจุด', async ({ browser }) => {
  const app = await bootBare(browser);
  for (const role of ['supervisor', 'warehouse']) {
    await setup(app.page, { branch: 'WH', role });
    const t = await app.page.evaluate(() => ({
      term: _auditTerm(), mismatch: _mismatchTerm(), pill: getScanRowStyle('audit').label,
      card: document.getElementById('statAuditLabel').textContent, panel: document.getElementById('auditVerifyPanelTitle').textContent,
      th: document.getElementById('popupThAudit').textContent, title: (openAuditVerifyPopup(), document.getElementById('auditVerifyTitle').textContent),
      guide: document.getElementById('guideAuditPill').textContent,
    }));
    await app.page.evaluate(() => closeAuditVerifyPopup());
    expect(t, role).toEqual({ term: 'Recheck', mismatch: 'Recheck', pill: '⚠️ Recheck', card: 'Recheck', panel: 'Recheck', th: 'Recheck',
      title: '🔍 Recheck — รีเช็คสินค้า', guide: '⚠️ Recheck' });
  }
  await closeApp(app);
});

test('★ สวิตช์ปิด (PHARMACY_RECHECK_TERMS=false) → ข้อความเดิมทุกตัวอักษร', async ({ browser }) => {
  const app = await bootBare(browser);
  // ตรึงข้อความเดิมของการ์ดใบที่ 4 ด้วย → ปิดการ์ด "Stock Adj เข้าระบบ" (PHARMACY_ADJ_ERP_CARD) ไปพร้อมกัน = ทางถอยทั้งสองชั้น
  await app.page.evaluate(() => { PHARMACY_ADJ_ERP_CARD = false; });
  await setup(app.page, { terms: false });
  const t = await app.page.evaluate(() => {
    const txt = (id) => document.getElementById(id).textContent;
    const got = []; const real = window.toast; window.toast = (m) => got.push(String(m));
    try {
      state.scanData.set('PE0', { status: 'pending', countedQty: 0 });
      state.barcodeMap.set('BSA0', 'SA0'); state.barcodeMap.set('BPE0', 'PE0');
      for (const bc of ['BSA0', 'BPE0']) { document.getElementById('scanInput').value = bc; processPharmacistAuditScan(); }
    } finally { window.toast = real; }
    openAuditVerifyPopup();
    const title = txt('auditVerifyTitle'); closeAuditVerifyPopup();
    return {
      term: _auditTerm(), mismatch: _mismatchTerm(), pill: getScanRowStyle('audit').label, statusPill: getStatusPill('audit'),
      card: txt('statAuditLabel'), sub: txt('auditProgressLabel'), panel: txt('auditVerifyPanelTitle'), btn: txt('pharmacistAuditBtnLabel'),
      th: txt('popupThAudit'), filter: txt('popupFilterAuditLabel'), tab: txt('avTabAuditLabel'), title, idle: txt('pharmIdleNoteTitle'),
      step6: document.getElementById('guideStep6').innerHTML, rule: txt('guideRulePill'), gpill: txt('guideAuditPill'), gdesc: txt('guideAuditDesc'),
      toast: got[0], toastPending: got[1], check: getScanRowStyle('audit_check').label,
    };
  });
  expect(t).toEqual({
    term: 'Audit', mismatch: 'Audit', pill: '⚠️ Audit', statusPill: '<span class="pill pill-audit">⚠️ Audit</span>',
    card: 'Audit', sub: 'เภสัชตรวจแล้ว', panel: 'Audit Verify', btn: '✓ ยืนยัน Audit',
    th: 'Audit', filter: 'Audit', tab: 'Audit', title: '🔍 Audit Verify — ตรวจสอบสินค้า (เภสัช)', idle: 'เภสัชไม่ต้องสแกน / ทำ Audit',
    step6: 'รายการ <strong style="color:var(--yellow);">⚠️ Audit</strong> → เภสัชเปิด <strong>Audit Verify</strong> → สแกนนับซ้ำ → กด <strong>ยืนยันทั้งหมด</strong>',
    rule: 'Pass / Audit / Stock Adj', gpill: '⚠️ Audit', gdesc: 'จำนวนไม่ตรง — รอเภสัชตรวจซ้ำใน Audit Verify',
    toast: 'SA0: สถานะ "stock_adjustment" — ไม่ใช่ Audit', toastPending: 'PE0: สถานะ "pending" — ไม่ใช่ Audit', check: '✅ Audit Check',
  });
  // ตัวตรวจ "มองเห็นคำว่า Audit" ต้องเจอจริงเมื่อคำเดิมกลับมา — ไม่งั้นเทสด้านบนผ่านเพราะมองไม่เห็นอะไรเลย
  const seen = await auditLines(app.page, MAIN);
  expect(seen.some((l) => l.startsWith('.stats-bar'))).toBe(true);
  expect(seen.some((l) => l.startsWith('.left-panel'))).toBe(true);
  expect(seen.some((l) => l.startsWith('.center-panel'))).toBe(true);
  await app.page.evaluate(() => openAuditVerifyPopup());
  expect((await auditLines(app.page, ['#auditVerifyPopupOverlay'])).length).toBeGreaterThan(0);
  await closeApp(app);
});
