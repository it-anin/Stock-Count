// สาขายา PDA: ไม่มีแถวปุ่มใต้ RESULT (9 ต.ค. 2026 · ผู้ใช้สั่ง · สวิตช์ PHARMACY_PDA_HIDE_CONFIRM_ROW)
//
// เดิมผู้ช่วยสาขายาบน PDA เห็นแถว #confirmClearRow = ป้าย "Confirm ที่ Desktop เท่านั้น" (#pdaConfirmNotice) + ปุ่ม ✕ ซ่อนรายการ
// → ซ่อนทั้งแถวแบบเดียวกับ WH PDA · ลบโค้ดป้าย (HTML+CSS — ไม่มีใครอ่าน) · ตัดสินด้วย User-Agent ไม่ใช่ความกว้างจอ
//
// เทสนี้ตรึง 4 ด้าน — ด้านที่ 3-4 สำคัญที่สุดเพราะกติกาใหม่ต้องไม่ลามไปที่อื่น:
//   1. PDA สาขายาไม่เห็นแถว  2. สวิตช์ปิด = แถวกลับมา (ป้ายไม่กลับ — ลบโค้ดแล้ว)
//   3. ★ Desktop สาขายา / จอแคบที่ไม่ใช่ PDA app / WH ทุก role ไม่ถูกแตะ
//   4. ★ ด่านกัน Confirm บน PDA (validateAndProcess / updateConfirmBtn) ยังอยู่ครบ — ปุ่มซ่อนแล้วแต่ห้ามลบด่าน (กฎ 3)
const { test, expect, newAppContext, waitForAppReady, bootBare, closeApp } = require('../../lib/hooks');

async function bootPda(browser) {
  const app = await newAppContext(browser, { login: false, mode: 'pda' });
  await app.page.goto('/index.html');
  await waitForAppReady(app.page, { login: false });
  return app;
}

// ตั้ง สาขา/role แล้วให้ UI ตัดสินใหม่ผ่านเส้นทางจริง (updateScanInputMode) · คืนสิ่งที่ผู้ใช้เห็นจริง (computed style)
async function rowUi(page, { branch, role, on = true }) {
  return page.evaluate(({ branch, role, on }) => {
    PHARMACY_PDA_HIDE_CONFIRM_ROW = on;
    currentBranch = branch; currentRole = role; currentUser = 'T';
    updateScanInputMode();
    const disp = (id) => { const e = document.getElementById(id); return e ? getComputedStyle(e).display : 'missing'; };
    const row = disp('confirmClearRow') !== 'none';
    return {
      row,
      confirm: row && disp('btnConfirm') !== 'none',
      hideList: row && disp('btnHideList') !== 'none',
      hideListWh: disp('btnHideListWh') !== 'none',
    };
  }, { branch, role, on });
}

// ★ ด่านกัน Confirm: stub _confirmPharmacyBatched (ตัวที่ Desktop เรียกจริง) แล้วกด Confirm ผ่าน validateAndProcess
async function tryConfirm(page) {
  return page.evaluate(async () => {
    currentBranch = 'SRC'; currentRole = 'assistant'; currentUser = 'T';
    state.r16Loaded = true; state.r16DateMismatch = false; _branchConfirming = false;
    const realBatched = window._confirmPharmacyBatched; const realToast = window.toast;
    let called = 0; const got = [];
    window._confirmPharmacyBatched = async () => { called++; };
    window.toast = (m) => got.push(String(m));
    try { await validateAndProcess(); } finally { window._confirmPharmacyBatched = realBatched; window.toast = realToast; }
    updateConfirmBtn();
    const btn = document.getElementById('btnConfirm');
    return { called, got, disabled: btn.disabled, title: btn.title };
  });
}

const PHARM_PDA_HIDDEN = { row: false, confirm: false, hideList: false, hideListWh: false };

test('ค่าเริ่มต้นที่ส่งมอบ: สวิตช์เปิด · ป้าย "Confirm ที่ Desktop เท่านั้น" ถูกลบทั้ง HTML และ CSS', async ({ browser }) => {
  for (const boot of [bootBare, bootPda]) {
    const app = await boot(browser);
    const r = await app.page.evaluate(() => {
      let cssRefs = 0;
      for (const sh of document.styleSheets) {
        let rules; try { rules = sh.cssRules; } catch (e) { continue; }
        for (const ru of rules) if (String(ru.cssText).includes('pdaConfirmNotice')) cssRefs++;
      }
      return {
        type: typeof PHARMACY_PDA_HIDE_CONFIRM_ROW, on: PHARMACY_PDA_HIDE_CONFIRM_ROW,
        notice: document.getElementById('pdaConfirmNotice'), cssRefs,
        rowText: document.getElementById('confirmClearRow').textContent.includes('Desktop เท่านั้น'),
      };
    });
    expect(r).toEqual({ type: 'boolean', on: true, notice: null, cssRefs: 0, rowText: false });
    await closeApp(app);
  }
});

test('★ PDA สาขายา: ผู้ช่วยไม่เห็นแถวปุ่ม (ป้าย Confirm + ✕ ซ่อนรายการ) ทั้ง 3 สาขา · เภสัชเท่าเดิม · ปลดล็อก Confirm แล้วยังซ่อน', async ({ browser }) => {
  const app = await bootPda(browser);
  expect(await app.page.evaluate(() => [document.body.classList.contains('pda-power-save'), _isPdaApp(), window.innerWidth <= 600]))
    .toEqual([true, true, true]); // ยืนยันว่าเป็น PDA จริง ไม่ใช่ผ่านเพราะ setup ผิด
  for (const branch of ['SRC', 'KKL', 'SSS']) {
    expect(await rowUi(app.page, { branch, role: 'assistant' }), branch).toEqual(PHARM_PDA_HIDDEN);
    expect(await rowUi(app.page, { branch, role: 'pharmacist' }), branch + ' เภสัช').toEqual(PHARM_PDA_HIDDEN);
  }
  // ปลดล็อก Confirm (branch lock) เรียก updateScanInputMode ซ้ำ → ต้องไม่ดึงแถวกลับมา · รายการ RESULT ยังอยู่
  await rowUi(app.page, { branch: 'SRC', role: 'assistant' });
  const after = await app.page.evaluate(() => {
    _setBranchScanPaused(false);
    return {
      row: getComputedStyle(document.getElementById('confirmClearRow')).display,
      list: getComputedStyle(document.querySelector('.scan-list-card')).display !== 'none',
    };
  });
  expect(after).toEqual({ row: 'none', list: true });
  await closeApp(app);
});

test('★ Desktop สาขายาเท่าเดิม · จอแคบที่ไม่ใช่ PDA app เท่าเดิม (ตัดสินด้วย User-Agent ไม่ใช่ความกว้าง)', async ({ browser }) => {
  const app = await bootBare(browser);
  expect(await rowUi(app.page, { branch: 'SRC', role: 'assistant' })).toEqual({ row: true, confirm: true, hideList: true, hideListWh: false });
  expect(await rowUi(app.page, { branch: 'SRC', role: 'pharmacist' })).toEqual(PHARM_PDA_HIDDEN); // เภสัชไม่มีแถวนี้อยู่แล้ว
  await app.page.setViewportSize({ width: 390, height: 700 });
  expect(await app.page.evaluate(() => [window.innerWidth <= 600, _isPdaApp()])).toEqual([true, false]);
  for (const branch of ['SRC', 'KKL', 'SSS']) {
    expect(await rowUi(app.page, { branch, role: 'assistant' }), branch).toEqual({ row: true, confirm: true, hideList: true, hideListWh: false });
  }
  await closeApp(app);
});

test('★ WH ไม่ถูกแตะ: Desktop หัวหน้า/พนักงาน · PDA พนักงาน · เครื่อง UA PDA จอกว้าง', async ({ browser }) => {
  const desk = await bootBare(browser);
  expect(await rowUi(desk.page, { branch: 'WH', role: 'supervisor' })).toEqual({ row: true, confirm: true, hideList: false, hideListWh: true });
  expect(await rowUi(desk.page, { branch: 'WH', role: 'warehouse' })).toEqual({ row: true, confirm: true, hideList: true, hideListWh: false });
  await closeApp(desk);

  const pda = await bootPda(browser);
  expect(await rowUi(pda.page, { branch: 'WH', role: 'warehouse' })).toEqual(PHARM_PDA_HIDDEN); // _whPda เดิม
  // UA PDA แต่จอกว้าง: WH ยังเห็นแถว (กติกาใหม่เฉพาะสาขายา) · สาขายายังซ่อน (ตัดสินด้วย UA)
  await pda.page.setViewportSize({ width: 900, height: 700 });
  expect(await rowUi(pda.page, { branch: 'WH', role: 'supervisor' })).toEqual({ row: true, confirm: false, hideList: false, hideListWh: true });
  expect(await rowUi(pda.page, { branch: 'SRC', role: 'assistant' })).toEqual(PHARM_PDA_HIDDEN);
  await closeApp(pda);
});

test('ทางถอย: สวิตช์ปิด → PDA ผู้ช่วยสาขายาเห็นแถว + ✕ ซ่อนรายการ อีกครั้ง · ✓ Confirm ยังซ่อน · เปิดกลับ = ซ่อน', async ({ browser }) => {
  const app = await bootPda(browser);
  expect(await rowUi(app.page, { branch: 'SRC', role: 'assistant', on: false })).toEqual({ row: true, confirm: false, hideList: true, hideListWh: false });
  expect(await rowUi(app.page, { branch: 'SRC', role: 'assistant', on: true })).toEqual(PHARM_PDA_HIDDEN);
  await closeApp(app);
});

test('★ ด่านกัน Confirm บน PDA ยังอยู่ครบ (ห้ามลบแม้ปุ่มซ่อนแล้ว) · Desktop เรียก Confirm ได้ตามเดิม', async ({ browser }) => {
  const pda = await bootPda(browser);
  expect(await tryConfirm(pda.page)).toEqual({ called: 0, got: ['Confirm ที่ Desktop เท่านั้น'], disabled: true, title: 'Confirm สาขาได้เฉพาะ Desktop' });
  await closeApp(pda);

  // canary: เส้นทางเดียวกันบน Desktop ต้องถึง _confirmPharmacyBatched — พิสูจน์ว่า stub ใช้ได้จริง ข้อบนจึงไม่ผ่านเพราะ stub พัง
  const desk = await bootBare(browser);
  expect(await tryConfirm(desk.page)).toEqual({ called: 1, got: [], disabled: false, title: '' });
  await closeApp(desk);
});
