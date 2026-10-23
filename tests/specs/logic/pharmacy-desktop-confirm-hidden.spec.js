// สาขายา Desktop: ซ่อนปุ่ม ✓ Confirm เมื่อบอท auto-r16 Confirm ให้ทุกคืน 21:10 (23 ต.ค. 2026 · ผู้ใช้สั่ง · สวิตช์ PHARMACY_DESKTOP_CONFIRM_BY_BOT)
//
// ส่งมอบพร้อมบอทโดย "ปิด" เป็นค่าเริ่มต้น — พลิกเป็น true ก็ต่อเมื่อบอทเขียนจริงผ่านเกณฑ์แล้ว (CLAUDE.md §🤖 Confirm โดยบอท) · เทสนี้ตรึง 5 ด้าน:
//   1. ค่าเริ่มต้นที่ส่งมอบ = ปิด  2. เปิด: ปุ่มหายเฉพาะสาขายา Desktop (✕ ซ่อนรายการยังอยู่) · ปิด = เท่าเดิมทุกพิกเซล
//   3. ★ WH / เภสัช / PDA ไม่ถูกแตะ  4. ★ ข้อความวิธีใช้ที่เคยบอกให้ "กด Confirm" เปลี่ยนตามสวิตช์ — ปิด/WH = เท่าเดิมทุกตัวอักษร
//   5. ★ ฟังก์ชัน Confirm ยังเรียกได้ (validateAndProcess → _confirmPharmacyBatched) — ซ่อนแค่ปุ่ม ไม่ลบทางสำรองของ IT (กฎ 1/กฎ 3)
const { test, expect, newAppContext, waitForAppReady, bootBare, closeApp } = require('../../lib/hooks');

async function bootPda(browser) {
  const app = await newAppContext(browser, { login: false, mode: 'pda' });
  await app.page.goto('/index.html');
  await waitForAppReady(app.page, { login: false });
  return app;
}

// ตั้ง สาขา/role/สวิตช์ แล้วให้ UI ตัดสินใหม่ผ่านเส้นทางจริง (updateScanInputMode) · คืนสิ่งที่ผู้ใช้เห็นจริง (computed style) + inline style ของปุ่ม
async function rowUi(page, { branch, role, bot }) {
  return page.evaluate(({ branch, role, bot }) => {
    PHARMACY_DESKTOP_CONFIRM_BY_BOT = bot;
    currentBranch = branch; currentRole = role; currentUser = 'T';
    updateScanInputMode();
    const disp = (id) => { const e = document.getElementById(id); return e ? getComputedStyle(e).display : 'missing'; };
    const row = disp('confirmClearRow') !== 'none';
    return {
      row,
      confirm: row && disp('btnConfirm') !== 'none',
      hideList: row && disp('btnHideList') !== 'none',
      hideListWh: disp('btnHideListWh') !== 'none',
      inline: document.getElementById('btnConfirm').style.display,   // '' = ไม่มี inline display (เหมือนก่อนมีสวิตช์) · 'none' = ถูกซ่อนด้วยสวิตช์
    };
  }, { branch, role, bot });
}

// ข้อความวิธีใช้ทั้งชุดที่ applyAuditTerminology/guideHtml ผลิต (ใช้ textContent/innerHTML ของ DOM จริง)
async function texts(page, { branch, role, bot }) {
  return page.evaluate(({ branch, role, bot }) => {
    PHARMACY_DESKTOP_CONFIRM_BY_BOT = bot;
    currentBranch = branch; currentRole = role; currentUser = 'T';
    applyAuditTerminology();
    const t = (id) => document.getElementById(id).textContent;
    return { step4: t('guideStep4'), step5: t('guideStep5'), step6: t('guideStep6'), note: t('noStockModalNote'), guide: guideHtml(branch === 'WH') };
  }, { branch, role, bot });
}

// ★ Confirm ยังเรียกได้: stub _confirmPharmacyBatched (ตัวที่ Desktop เรียกจริง) แล้วเรียก validateAndProcess ตรงๆ (= IT เรียกจาก Console)
async function tryConfirm(page, bot) {
  return page.evaluate(async (bot) => {
    PHARMACY_DESKTOP_CONFIRM_BY_BOT = bot;
    currentBranch = 'SRC'; currentRole = 'assistant'; currentUser = 'T';
    state.r16Loaded = true; state.r16DateMismatch = false; _branchConfirming = false;
    updateScanInputMode(); updateConfirmBtn();
    const realBatched = window._confirmPharmacyBatched; const realToast = window.toast;
    let called = 0; const got = [];
    window._confirmPharmacyBatched = async () => { called++; };
    window.toast = (m) => got.push(String(m));
    try { await validateAndProcess(); } finally { window._confirmPharmacyBatched = realBatched; window.toast = realToast; }
    const btn = document.getElementById('btnConfirm');
    return { called, got, disabled: btn.disabled, hidden: getComputedStyle(btn).display === 'none' };
  }, bot);
}

// ข้อความกล่องยืนยันของ ↺ สแกนใหม่ (restartPharmacyScan) — ตอบ "ยกเลิก" เพื่อไม่ให้ไปแตะ Firestore
async function rescanDialog(page, bot) {
  return page.evaluate(async (bot) => {
    PHARMACY_DESKTOP_CONFIRM_BY_BOT = bot;
    currentBranch = 'SRC'; currentRole = 'pharmacist'; currentUser = 'T';
    _db = _db || {}; _branchConfirming = false;
    state.scanData.set('S-1', { status: 'stock_adjustment', countedQty: 3 });
    state.skuMap.set('S-1', { productName: 'สินค้าทดสอบ' });
    const realConfirm = window.confirm; const seen = [];
    window.confirm = (m) => { seen.push(String(m)); return false; };
    try { await restartPharmacyScan('S-1'); } finally { window.confirm = realConfirm; }
    return seen;
  }, bot);
}

const SHOWN = { row: true, confirm: true, hideList: true, hideListWh: false, inline: '' };
const BUTTON_GONE = { row: true, confirm: false, hideList: true, hideListWh: false, inline: 'none' };
const ROW_GONE = { row: false, confirm: false, hideList: false, hideListWh: false, inline: '' };

// ข้อความเดิม (ก่อนมีสวิตช์) ทุกตัวอักษร — ปิดสวิตช์ต้องได้ตามนี้เป๊ะ
const OLD = {
  step4: 'อัพโหลด R16.104 ก่อนกด Confirm (ยอดขาย/รับเข้าระหว่างนับ)',
  step5: 'กด ✔ Confirm → ระบบเปรียบเทียบกับ System Qty อัตโนมัติ',
  step6Tail: 'ผู้ช่วยสแกนนับใหม่ → กด Confirm บน Desktop',
  note: 'หลังกด Confirm รายการนี้จะเข้าเอกสารปรับสต็อก (ขาด) ทันที',
  guide: [
    '<li>ก่อนกด Confirm → อัพโหลด <strong>R16.104</strong></li>',
    '<li>กด <strong>Confirm</strong> → ระบบตรวจสอบสินค้า</li>',
    '<li style="margin-top:3px;color:var(--orange);">อัพ R16 ก่อนกด Confirm <strong>R16 ต้องดึงรายงานจากแอพม่วงล่าสุดเท่านั้น</strong> → อัพ R16 ของวันใหม่ก่อนถึงจะ Confirm ได้</li>',
    '<li style="margin-top:3px;">หลังอัพ R01 → สแกนนับ → อัพ R16 เย็น → Confirm</li>',
    '2. R16.104 — ยอดขาย/รับเข้าระหว่างนับ (อัพก่อน Confirm)</strong>',
    'ส่งออก .CSV · อัพใหม่ทุกครั้งก่อน Confirm</li>',
  ],
  rescan: (sku, name) => `เริ่มนับใหม่: ${sku}\n${name}\n\nสแกนสินค้าใหม่และกด Confirm`,
};
const BOT = {
  step4: 'R16.104 — บอทอัปให้อัตโนมัติทุกคืน 21:10 (อัพมือที่การ์ด R16.104 เฉพาะเมื่อบอทพลาด)',
  step5: 'บอท Confirm ให้ 21:10 → ระบบเปรียบเทียบกับ System Qty อัตโนมัติ (เห็นผล Pass / Stock Adj เช้าวันถัดไป)',
  step6Tail: 'ผู้ช่วยสแกนนับใหม่ → บอท Confirm ให้คืนนั้น 21:10',
  note: 'บอท Confirm 21:10 แล้วรายการนี้จะเข้าเอกสารปรับสต็อก (ขาด)',
  guide: [
    '<li><strong>R16.104</strong> — บอทอัปให้อัตโนมัติทุกคืน 21:10 (อัพมือเฉพาะเมื่อบอทพลาด)</li>',
    '<li><strong>บอท Confirm ให้ 21:10</strong> → ระบบตรวจสอบสินค้า</li>',
    '<li style="margin-top:3px;color:var(--orange);">R16 บอทอัปให้ทุกคืน 21:10 · ถ้าบอทพลาด (มีข้อความแจ้งเตือน) ให้อัพมือ: <strong>R16 ต้องดึงรายงานจากแอพม่วงล่าสุดเท่านั้น</strong></li>',
    '<li style="margin-top:3px;">หลังอัพ R01 → สแกนนับ → 21:10 บอทอัป R16 และ Confirm ให้</li>',
    '2. R16.104 — ยอดขาย/รับเข้าระหว่างนับ (บอทอัปให้ทุกคืน · อัพมือเฉพาะเมื่อบอทพลาด)</strong>',
    'ส่งออก .CSV · (อัพมือเฉพาะเมื่อบอทพลาด)</li>',
  ],
  rescan: (sku, name) => `เริ่มนับใหม่: ${sku}\n${name}\n\nสแกนสินค้าใหม่ — บอท Confirm ให้คืนนี้ 21:10`,
};

test('ค่าเริ่มต้นที่ส่งมอบ: สวิตช์ "ปิด" — ปุ่ม Confirm ที่ Desktop ยังอยู่จนกว่าบอทจะผ่านเกณฑ์ (พลิกเป็น true คือการตัดสินใจแยก)', async ({ browser }) => {
  const app = await bootBare(browser);
  expect(await app.page.evaluate(() => [typeof PHARMACY_DESKTOP_CONFIRM_BY_BOT, PHARMACY_DESKTOP_CONFIRM_BY_BOT])).toEqual(['boolean', false]);
  // ก่อนแตะสวิตช์เอง: login-path จริง (updateScanInputMode) ต้องได้ปุ่มอยู่
  const r = await app.page.evaluate(() => {
    currentBranch = 'SRC'; currentRole = 'assistant'; currentUser = 'T';
    updateScanInputMode();
    const btn = document.getElementById('btnConfirm');
    return { shown: getComputedStyle(btn).display !== 'none', inline: btn.style.display };
  });
  expect(r).toEqual({ shown: true, inline: '' });
  await closeApp(app);
});

test('★ เปิดสวิตช์: Desktop สาขายา (ผู้ช่วย) ปุ่ม ✓ Confirm หายทั้ง 3 สาขา · ✕ ซ่อนรายการยังอยู่ · ปิดกลับ = ปุ่มคืนมาเท่าเดิม', async ({ browser }) => {
  const app = await bootBare(browser);
  for (const branch of ['SRC', 'KKL', 'SSS']) {
    expect(await rowUi(app.page, { branch, role: 'assistant', bot: false }), `${branch} ปิด`).toEqual(SHOWN);
    expect(await rowUi(app.page, { branch, role: 'assistant', bot: true }), `${branch} เปิด`).toEqual(BUTTON_GONE);
    expect(await rowUi(app.page, { branch, role: 'assistant', bot: false }), `${branch} ปิดกลับ`).toEqual(SHOWN);
  }
  // ซ่อนปุ่มแล้ว "ซ่อนรายการ" ต้องกว้างเต็มแถว (flex:1 เดี่ยวๆ) ไม่ใช่เหลือแต่ช่องว่าง
  await rowUi(app.page, { branch: 'SRC', role: 'assistant', bot: true });
  const w = await app.page.evaluate(() => {
    const row = document.getElementById('confirmClearRow').getBoundingClientRect();
    const hide = document.getElementById('btnHideList').getBoundingClientRect();
    return { rowW: Math.round(row.width), hideW: Math.round(hide.width) };
  });
  expect(w.hideW, 'ปุ่มที่เหลือกินพื้นที่แถว').toBeGreaterThan(w.rowW * 0.8);
  await closeApp(app);
});

test('★ เภสัช (ไม่มีแถวนี้อยู่แล้ว) · WH ทุก role · PDA สาขายา/WH — เปิดสวิตช์แล้วต้องไม่ต่างจากปิดสวิตช์เลย', async ({ browser }) => {
  const desk = await bootBare(browser);
  // สิ่งที่ผู้ใช้เห็น (computed style) ต้องเท่ากันทั้งปิด/เปิด · ส่วน inline style ของปุ่มที่ซ่อนอยู่ในแถวที่ถูกซ่อนอยู่แล้ว (เภสัช/PDA สาขายา) ไม่มีผลต่อสายตา — ไม่ตรึง
  // (สวิตช์ซ่อนปุ่มทุก role ของสาขายา = ถ้าวันหลังมีใครเปิดแถวให้ role อื่น ปุ่มก็ยังหายตามเจตนา) · WH ตรึงทุกอย่างรวม inline ('' = ไม่ถูกแตะเลย)
  const visible = ({ inline, ...v }) => v;
  const cases = [
    ['SRC', 'pharmacist', ROW_GONE, false],
    ['WH', 'supervisor', { row: true, confirm: true, hideList: false, hideListWh: true, inline: '' }, true],
    ['WH', 'warehouse', { row: true, confirm: true, hideList: true, hideListWh: false, inline: '' }, true],
  ];
  for (const [branch, role, want, strict] of cases) {
    for (const bot of [false, true]) {
      const got = await rowUi(desk.page, { branch, role, bot });
      expect(strict ? got : visible(got), `${branch}/${role} bot=${bot}`).toEqual(strict ? want : visible(want));
    }
  }
  await closeApp(desk);

  const pda = await bootPda(browser);
  for (const bot of [false, true]) {
    expect(visible(await rowUi(pda.page, { branch: 'SRC', role: 'assistant', bot })), `PDA สาขายา bot=${bot}`).toEqual(visible(ROW_GONE));
    expect(visible(await rowUi(pda.page, { branch: 'WH', role: 'warehouse', bot })), `PDA WH bot=${bot}`).toEqual(visible(ROW_GONE));
  }
  await closeApp(pda);
});

test('★ ข้อความวิธีใช้ — ปิดสวิตช์ = เดิมทุกตัวอักษร · เปิด = ไม่เหลือคำสั่ง "กด Confirm" ของสาขายา · WH ไม่เปลี่ยนแม้เปิด', async ({ browser }) => {
  const app = await bootBare(browser);
  // สาขายา ปิดสวิตช์ = ข้อความเดิม
  const off = await texts(app.page, { branch: 'SRC', role: 'assistant', bot: false });
  expect(off.step4).toBe(OLD.step4);
  expect(off.step5).toBe(OLD.step5);
  expect(off.step6).toContain(OLD.step6Tail);
  expect(off.note).toBe(OLD.note);
  for (const frag of OLD.guide) expect(off.guide, `ปิด: ต้องมี ${frag.slice(0, 40)}…`).toContain(frag);
  for (const frag of BOT.guide) expect(off.guide, `ปิด: ต้องไม่มี ${frag.slice(0, 40)}…`).not.toContain(frag);

  // สาขายา เปิดสวิตช์ = ข้อความใหม่ ไม่เหลือคำสั่งให้กดปุ่มที่ไม่มีแล้ว
  const on = await texts(app.page, { branch: 'KKL', role: 'assistant', bot: true });
  expect(on.step4).toBe(BOT.step4);
  expect(on.step5).toBe(BOT.step5);
  expect(on.step6).toContain(BOT.step6Tail);
  expect(on.step6).not.toContain('กด Confirm บน Desktop');
  expect(on.note).toBe(BOT.note);
  for (const frag of BOT.guide) expect(on.guide, `เปิด: ต้องมี ${frag.slice(0, 40)}…`).toContain(frag);
  for (const frag of OLD.guide) expect(on.guide, `เปิด: ต้องไม่มี ${frag.slice(0, 40)}…`).not.toContain(frag);
  expect(on.guide, 'ไม่มีคำสั่งกดปุ่มเหลือในขั้นตอนหลัก').not.toContain('<li>กด <strong>Confirm</strong>');

  // กลับมาปิดอีกครั้ง = คืนข้อความเดิม (idempotent สองทิศ)
  const back = await texts(app.page, { branch: 'SSS', role: 'assistant', bot: false });
  expect({ ...back, guide: undefined }).toEqual({ ...off, guide: undefined });
  expect(back.guide).toBe(await app.page.evaluate(() => guideHtml(false)));

  // WH: เปิดสวิตช์แล้วข้อความต้องเท่ากับปิดทุกตัวอักษร
  const whOff = await texts(app.page, { branch: 'WH', role: 'supervisor', bot: false });
  const whOn = await texts(app.page, { branch: 'WH', role: 'supervisor', bot: true });
  expect(whOn).toEqual(whOff);
  expect(whOn.step4).toBe(OLD.step4);
  expect(whOn.guide).toContain('<li>ก่อนกด Confirm → อัพโหลด <strong>R16.104</strong> + <strong>R16.103</strong></li>');
  await closeApp(app);
});

test('★ ข้อความวิธีใช้บน PDA — ตามสวิตช์เหมือน Desktop (ปิด = เดิมทุกตัวอักษร · เปิด = ข้อความบอท) · WH PDA ไม่เปลี่ยนแม้เปิด', async ({ browser }) => {
  // ปุ่ม Guide อยู่ใน left-panel ซึ่งซ่อนบนจอ ≤600px → PDA ไม่เห็นข้อความเหล่านี้ในวันนี้ · ตรึงไว้ว่าข้อความตามสวิตช์ "ทุกอุปกรณ์"
  // กันวันหลังมีทางเปิดคู่มือบน PDA แล้วเจอคำสั่ง "กด Confirm" ตกค้าง (สวิตช์ตัดสินด้วยสาขา ไม่ใช่ UA)
  const pda = await bootPda(browser);
  const off = await texts(pda.page, { branch: 'SRC', role: 'assistant', bot: false });
  const on = await texts(pda.page, { branch: 'SRC', role: 'assistant', bot: true });
  expect(off.step4).toBe(OLD.step4);
  expect(off.step5).toBe(OLD.step5);
  expect(off.note).toBe(OLD.note);
  for (const frag of OLD.guide) expect(off.guide, `PDA ปิด: ต้องมี ${frag.slice(0, 40)}…`).toContain(frag);
  expect(on.step4).toBe(BOT.step4);
  expect(on.step5).toBe(BOT.step5);
  expect(on.step6).toContain(BOT.step6Tail);
  expect(on.note).toBe(BOT.note);
  for (const frag of BOT.guide) expect(on.guide, `PDA เปิด: ต้องมี ${frag.slice(0, 40)}…`).toContain(frag);
  const whOff = await texts(pda.page, { branch: 'WH', role: 'warehouse', bot: false });
  const whOn = await texts(pda.page, { branch: 'WH', role: 'warehouse', bot: true });
  expect(whOn).toEqual(whOff);
  await closeApp(pda);
});

test('★ กล่องยืนยัน ↺ สแกนใหม่ — ปิด = "สแกนสินค้าใหม่และกด Confirm" เดิมทุกตัวอักษร · เปิด = บอท Confirm ให้คืนนี้ 21:10', async ({ browser }) => {
  const app = await bootBare(browser);
  expect(await rescanDialog(app.page, false)).toEqual([OLD.rescan('S-1', 'สินค้าทดสอบ')]);
  expect(await rescanDialog(app.page, true)).toEqual([BOT.rescan('S-1', 'สินค้าทดสอบ')]);
  await closeApp(app);
});

test('★ ซ่อนแค่ปุ่ม ไม่ลบทางสำรอง: validateAndProcess ยังเรียกได้ทั้งปิด/เปิดสวิตช์ (IT เรียกจาก Console) · ถึง _confirmPharmacyBatched ครั้งเดียว', async ({ browser }) => {
  const app = await bootBare(browser);
  expect(await tryConfirm(app.page, false)).toEqual({ called: 1, got: [], disabled: false, hidden: false });
  expect(await tryConfirm(app.page, true)).toEqual({ called: 1, got: [], disabled: false, hidden: true });
  await closeApp(app);

  // ด่านกัน Confirm บน PDA ยังอยู่ครบเมื่อเปิดสวิตช์ (กฎ 3 — PDA ไม่มี R16 raw timeline)
  const pda = await bootPda(browser);
  const r = await pda.page.evaluate(async () => {
    PHARMACY_DESKTOP_CONFIRM_BY_BOT = true;
    currentBranch = 'SRC'; currentRole = 'assistant'; currentUser = 'T';
    state.r16Loaded = true; state.r16DateMismatch = false; _branchConfirming = false;
    const realBatched = window._confirmPharmacyBatched; const realToast = window.toast;
    let called = 0; const got = [];
    window._confirmPharmacyBatched = async () => { called++; };
    window.toast = (m) => got.push(String(m));
    try { await validateAndProcess(); } finally { window._confirmPharmacyBatched = realBatched; window.toast = realToast; }
    return { called, got };
  });
  expect(r).toEqual({ called: 0, got: ['Confirm ที่ Desktop เท่านั้น'] });
  await closeApp(pda);
});
