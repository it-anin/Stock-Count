// ใบ 📦 ปรับปรุงสินค้า: แบ่งหน้า 20 แถวต่อหน้า (ต.ค. 2026 · ผู้ใช้สั่ง — ลดงานวาด DOM)
//   สวิตช์ ADJUST_DOC_PAGE_SIZE (0 = ไม่แบ่งหน้า = ทางถอย) · _adjDocPage
//
// เทสนี้ตรึง 7 ด้าน — ข้อ 5 สำคัญที่สุด: การแบ่งหน้าต้องเป็น "การแสดงผลตาราง" ล้วน ไม่ลามไปที่ Export/ปุ่มนับ
//   1. 45 ORDS → 3 หน้า (20/20/5) · ลำดับต่อเนื่องข้ามหน้า · ปุ่มขอบ disabled · ยอดรวมของแท็บ (#adjustDocRowCount) คงเดิม
//   2. สลับ ORDS↔IRPS / เปิดป็อปอัพใหม่ → กลับหน้า 1 (ไม่จำหน้าเดิม)
//   3. ขอบ 20/21 แถว: 20 = ไม่มี pager · 21 = 2 หน้า · ใบว่าง = ไม่มี pager
//   4. re-render (เลือก LOT · แก้จำนวน · โหลดข้อมูลเสร็จ) คงหน้า · วาดจริงแค่ 20 แถว (select/ช่องจำนวน) · LOT ที่เลือกอยู่ข้ามหน้า
//   5. ★ Export Text/Excel ขณะอยู่หน้า 2 ได้ครบทุกแถวของแท็บ ไม่ใช่เฉพาะที่เห็น · ปุ่มนับ 📦 ยังนับทุกแถว
//   6. clamp หน้า (แถวหด · Infinity · NaN · ติดลบ · เกิน) · ใบว่างกลับหน้า 1
//   7. ทางถอย: ADJUST_DOC_PAGE_SIZE=0/ค่าผิด → วาดครบทุกแถว · ค่าอื่นถูกใช้จริง (ไม่ฮาร์ดโค้ด 20) · เปลี่ยนหน้า = เลื่อนขึ้นบนสุด แต่ re-render อื่นคงตำแหน่งเลื่อน
const { test, expect, bootBare, closeApp } = require('../../lib/hooks');

const T = '2026-09-20 09:00:00';
// Stock Adj ตรงของสาขายา (ตัวเลขแช่ไว้ตอน Confirm) — ผลต่าง = effectiveQty − systemQty
const DIRECT = (extra = {}) => ({ status: 'stock_adjustment', auditStatus: 'stock_adjustment', initialStatus: 'stock_adjustment', auditor: '',
  countedQty: 8, timestamp: T, firstScanAt: T, scannedBy: 'Asst', directAdj: true, ...extra });

// nO แถว ORDS (O001…: 8−10 = ขาด 2) แล้วต่อด้วย nI แถว IRPS (I001…: 13−10 = เกิน 3) — ลำดับใส่ = ลำดับในใบ
async function seed(page, { nO = 45, nI = 25, role = 'pharmacist' } = {}) {
  await page.evaluate(({ nO, nI, role, tpl }) => {
    ADJUST_DOC_PAGE_SIZE = 20; ADJUST_DOC_QTY_EDIT = true;
    currentBranch = 'SRC'; currentRole = role; currentUser = 'Pharm';
    _branchScanPaused = false; _adjDocFilter = 'ords'; _adjDocPage = 1; _adjLoading = false;
    _lotMap.clear(); _lotSelected.clear(); _priceMap.clear();
    state.skuMap.clear(); state.scanData.clear(); state.skuDirectMap.clear(); scanListMap.clear();
    window.__marked = []; _markSkuDirty = (s) => { window.__marked.push(String(s)); };   // ไม่แตะ Firestore
    window.__toasts = []; toast = (m) => { window.__toasts.push(String(m)); };
    _refreshAdjMaster = async () => {};                                                  // openAdjustDocPopup ต้องไม่ยิง Supabase
    window.__exports = [];
    URL.createObjectURL = (b) => { window.__exports.push(b); return 'blob:captured'; };
    URL.revokeObjectURL = () => {};
    HTMLAnchorElement.prototype.click = function () {};
    const pad = (n) => String(n).padStart(3, '0');
    const add = (sku, eff) => {
      state.skuMap.set(sku, { sku, productName: 'สินค้า ' + sku, unitPrice: 20, systemQty: 10, negSys: false, barcodes: [], isDel: false });
      state.skuDirectMap.set(sku, { barcode: 'B' + sku, unitName: 'เม็ด' });
      state.scanData.set(sku, { ...tpl, effectiveQty: eff, systemQty: 10 });
    };
    for (let i = 1; i <= nO; i++) add('O' + pad(i), 8);
    for (let i = 1; i <= nI; i++) add('I' + pad(i), 13);
  }, { nO, nI, role, tpl: DIRECT() });
}

// สิ่งที่ผู้ใช้เห็นบนจอ ณ ตอนนี้ — ผ่านตารางและ pager จริง
const read = (page) => page.evaluate(() => {
  const rows = [...document.querySelectorAll('#adjustDocBody tr')].filter((tr) => tr.children.length > 1);
  const pager = document.getElementById('adjustDocPager');
  return {
    skus: rows.map((tr) => tr.children[1].textContent.trim()),
    nums: rows.map((tr) => Number(tr.children[0].textContent.trim())),
    count: document.getElementById('adjustDocRowCount').textContent,
    page: _adjDocPage,
    pager: getComputedStyle(pager).display === 'none' ? null : {
      info: document.getElementById('adjPgInfo').textContent,
      off: ['adjPgFirst', 'adjPgPrev', 'adjPgNext', 'adjPgLast'].map((id) => document.getElementById(id).disabled),
    },
  };
});
const render = (page) => page.evaluate(() => renderAdjustDocTable());
const click = (page, id) => page.evaluate((id) => document.getElementById(id).click(), id);   // ผ่าน onclick จริงของปุ่ม
const gotoPage = (page, p) => page.evaluate((p) => setAdjDocPage(p), p);
const range = (p, a, b) => Array.from({ length: b - a + 1 }, (_, i) => p + String(a + i).padStart(3, '0'));
const nums = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const exportText = (page) => page.evaluate(async () => {
  const n = window.__exports.length;
  exportAdjustDocText();
  return window.__exports.length > n ? window.__exports[window.__exports.length - 1].text() : null;
});
const exportSheet = (page, name) => page.evaluate((name) => {
  let s = null; const orig = XLSX.writeFile;
  XLSX.writeFile = (wb) => { s = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1 }); };
  try { exportAdjustDocExcel(); } finally { XLSX.writeFile = orig; }
  return s;
}, name);

test('45 ORDS → 3 หน้า (20/20/5) · ลำดับต่อเนื่องข้ามหน้า · ปุ่มขอบถูกปิด · ยอดรวมของแท็บคงเดิม', async ({ browser }) => {
  const app = await bootBare(browser);
  await seed(app.page);
  await render(app.page);
  expect(await read(app.page)).toEqual({ skus: range('O', 1, 20), nums: nums(1, 20), count: '45 รายการ', page: 1,
    pager: { info: 'หน้า 1 / 3 (1–20)', off: [true, true, false, false] } });
  await click(app.page, 'adjPgNext');
  expect(await read(app.page)).toEqual({ skus: range('O', 21, 40), nums: nums(21, 40), count: '45 รายการ', page: 2,
    pager: { info: 'หน้า 2 / 3 (21–40)', off: [false, false, false, false] } });
  await click(app.page, 'adjPgNext');
  expect(await read(app.page)).toEqual({ skus: range('O', 41, 45), nums: nums(41, 45), count: '45 รายการ', page: 3,
    pager: { info: 'หน้า 3 / 3 (41–45)', off: [false, false, true, true] } });

  // « ‹ » ทำงานตามชื่อ
  await click(app.page, 'adjPgFirst'); expect((await read(app.page)).page).toBe(1);
  await click(app.page, 'adjPgLast'); expect((await read(app.page)).page).toBe(3);
  await click(app.page, 'adjPgPrev'); expect((await read(app.page)).page).toBe(2);
  // ปุ่มที่ถูกปิด (ขอบ) คลิกแล้วไม่มีผล
  await click(app.page, 'adjPgFirst'); await click(app.page, 'adjPgPrev'); expect((await read(app.page)).page).toBe(1);
  await click(app.page, 'adjPgLast'); await click(app.page, 'adjPgNext'); expect((await read(app.page)).page).toBe(3);
  await closeApp(app);
});

test('สลับ ORDS↔IRPS และเปิดป็อปอัพใหม่ → กลับหน้า 1 (ไม่จำหน้าเดิม) · IRPS แบ่ง 20/5', async ({ browser }) => {
  const app = await bootBare(browser);
  await seed(app.page);
  await render(app.page);
  await gotoPage(app.page, 3);
  expect((await read(app.page)).skus).toEqual(range('O', 41, 45));

  await app.page.evaluate(() => setAdjDocFilter('irps', document.getElementById('adjBtnIrps')));
  expect(await read(app.page)).toEqual({ skus: range('I', 1, 20), nums: nums(1, 20), count: '25 รายการ', page: 1,
    pager: { info: 'หน้า 1 / 2 (1–20)', off: [true, true, false, false] } });
  await click(app.page, 'adjPgNext');
  expect(await read(app.page)).toEqual({ skus: range('I', 21, 25), nums: nums(21, 25), count: '25 รายการ', page: 2,
    pager: { info: 'หน้า 2 / 2 (21–25)', off: [false, false, true, true] } });

  // กลับ ORDS = หน้า 1 (ไม่ใช่หน้า 3 ที่ค้างไว้)
  await app.page.evaluate(() => setAdjDocFilter('ords', document.getElementById('adjBtnOrds')));
  expect(await read(app.page)).toMatchObject({ page: 1, skus: range('O', 1, 20), count: '45 รายการ' });

  // เปิดป็อปอัพใหม่ขณะค้าง IRPS หน้า 2 → ORDS หน้า 1
  await app.page.evaluate(() => { setAdjDocFilter('irps', document.getElementById('adjBtnIrps')); setAdjDocPage(2); });
  expect((await read(app.page)).skus).toEqual(range('I', 21, 25));
  await app.page.evaluate(() => openAdjustDocPopup());
  expect(await read(app.page)).toMatchObject({ page: 1, skus: range('O', 1, 20) });
  expect(await app.page.evaluate(() => _adjDocFilter)).toBe('ords');
  await closeApp(app);
});

test('ขอบ 20/21 แถว: 20 = ไม่มี pager วาดครบ · 21 = 2 หน้า (หน้า 2 มี 1 แถว) · ใบว่าง = ไม่มี pager', async ({ browser }) => {
  const app = await bootBare(browser);
  await seed(app.page, { nO: 20, nI: 5 });
  await render(app.page);
  expect(await read(app.page)).toEqual({ skus: range('O', 1, 20), nums: nums(1, 20), count: '20 รายการ', page: 1, pager: null });

  await seed(app.page, { nO: 21, nI: 0 });
  await render(app.page);
  expect(await read(app.page)).toMatchObject({ skus: range('O', 1, 20), page: 1, pager: { info: 'หน้า 1 / 2 (1–20)' } });
  await click(app.page, 'adjPgNext');
  expect(await read(app.page)).toEqual({ skus: ['O021'], nums: [21], count: '21 รายการ', page: 2,
    pager: { info: 'หน้า 2 / 2 (21–21)', off: [false, false, true, true] } });

  await seed(app.page, { nO: 0, nI: 0 });
  await render(app.page);
  expect(await read(app.page)).toEqual({ skus: [], nums: [], count: '0 รายการ', page: 1, pager: null });
  expect(await app.page.evaluate(() => document.getElementById('adjustDocBody').textContent)).toContain('ไม่มีรายการ');
  await closeApp(app);
});

test('re-render (เลือก LOT · แก้จำนวน · โหลดข้อมูลเสร็จ) คงหน้า · วาดจริงแค่ 20 แถว · LOT ที่เลือกอยู่ข้ามหน้า', async ({ browser }) => {
  const app = await bootBare(browser);
  await seed(app.page);
  // ทุก SKU มี LOT ให้เลือก → ถ้าวาดครบทุกแถว จะมี <select> 45 ตัว (เดิม) — แบ่งหน้าแล้วต้องเหลือ 20
  await app.page.evaluate(() => {
    for (let i = 1; i <= 45; i++) _lotMap.set('O' + String(i).padStart(3, '0'), [{ lot: 'L1', exp: '01/01/2030' }, { lot: 'L2', exp: '01/02/2030' }]);
    renderAdjustDocTable();
  });
  const dom = () => app.page.evaluate(() => ({ selects: document.querySelectorAll('#adjustDocBody select').length, inputs: document.querySelectorAll('#adjustDocBody input.adj-qty-input').length }));
  expect(await dom()).toEqual({ selects: 20, inputs: 20 });

  await gotoPage(app.page, 2);
  await app.page.evaluate(() => renderAdjustDocTable());                       // เช่น _refreshAdjMaster โหลดเสร็จกลางคัน
  expect(await read(app.page)).toMatchObject({ page: 2, skus: range('O', 21, 40) });

  // เลือก LOT ผ่าน dropdown จริงของ O025 (หน้า 2) → วาดใหม่แต่ยังหน้า 2
  const pick = await app.page.evaluate(() => {
    const tr = [...document.querySelectorAll('#adjustDocBody tr')].find((r) => r.children[1].textContent.trim() === 'O025');
    const sel = tr.querySelector('select'); sel.value = 'L2'; sel.dispatchEvent(new Event('change', { bubbles: true }));
    const tr2 = [...document.querySelectorAll('#adjustDocBody tr')].find((r) => r.children[1].textContent.trim() === 'O025');
    return { page: _adjDocPage, stored: _lotSelected.get('O025'), shown: tr2.querySelector('select').value, exp: tr2.children[7].textContent.trim() };
  });
  expect(pick).toEqual({ page: 2, stored: 'L2', shown: 'L2', exp: '01/02/2030' });

  // ไปหน้า 1 แล้วกลับ → LOT ที่เลือกยังอยู่ (เก็บใน _lotSelected ไม่ผูกกับหน้า)
  await gotoPage(app.page, 1); await gotoPage(app.page, 2);
  expect(await app.page.evaluate(() => [...document.querySelectorAll('#adjustDocBody tr')].find((r) => r.children[1].textContent.trim() === 'O025').querySelector('select').value)).toBe('L2');

  // แก้จำนวนของ O030 (หน้า 2) → ยังหน้า 2 · ช่องแสดงค่าที่แก้ · ยอดรวมของแท็บนับ "แก้จำนวน 1"
  await app.page.evaluate(() => setAdjDocQty('O030', '1'));
  const edited = await app.page.evaluate(() => {
    const tr = [...document.querySelectorAll('#adjustDocBody tr')].find((r) => r.children[1].textContent.trim() === 'O030');
    return { page: _adjDocPage, value: tr.querySelector('input.adj-qty-input').value, count: document.getElementById('adjustDocRowCount').textContent };
  });
  expect(edited).toEqual({ page: 2, value: '1', count: '45 รายการ · แก้จำนวน 1' });
  expect(await dom()).toEqual({ selects: 20, inputs: 20 });
  await closeApp(app);
});

test('★ Export Text/Excel ขณะอยู่หน้า 2 ได้ครบทุกแถวของแท็บ (ไม่ใช่เฉพาะ 20 ที่เห็น) · IRPS ไม่ปน · ปุ่มนับ 📦 นับทุกแถว', async ({ browser }) => {
  const app = await bootBare(browser);
  await seed(app.page);
  await render(app.page);
  await gotoPage(app.page, 2);
  expect((await read(app.page)).skus).toEqual(range('O', 21, 40));            // จอเห็นแค่ 20 แถวของหน้า 2

  const text = await exportText(app.page);
  expect(text.trim().split('\r\n').map((l) => l.split('\t').slice(0, 2))).toEqual(range('O', 1, 45).map((s) => [s, '2']));
  expect(await app.page.evaluate(() => window.__toasts.find((m) => m.startsWith('Export ORDS')))).toContain('Export ORDS 45 รายการ');

  const sheet = await exportSheet(app.page, 'ORDS');
  expect(sheet.slice(1).map((r) => [r[0], r[1], r[4]])).toEqual(range('O', 1, 45).map((s, i) => [i + 1, s, 2]));   // ลำดับใน Excel 1–45 ไม่ถูกหน้าตัด

  // แท็บ IRPS หน้า 2 (เห็น 5 แถว) → ไฟล์ได้ครบ 25
  await app.page.evaluate(() => { setAdjDocFilter('irps', document.getElementById('adjBtnIrps')); setAdjDocPage(2); });
  expect((await read(app.page)).skus).toEqual(range('I', 21, 25));
  const textI = await exportText(app.page);
  expect(textI.trim().split('\r\n').map((l) => l.split('\t').slice(0, 2))).toEqual(range('I', 1, 25).map((s) => [s, '3']));

  // ปุ่มนับ / ชุด SKU ที่ขอ LOT-ราคา ไม่ผูกกับหน้า
  expect(await app.page.evaluate(() => [_countAdjustDocItems(), _adjustDocSkuSet().size])).toEqual([70, 70]);
  await closeApp(app);
});

test('clamp หน้า: แถวหดจนหน้าเดิมหาย → ถอยหน้าสุดท้ายที่ยังมี · Infinity = สุดท้าย · NaN/ติดลบ/เกิน · ใบว่างกลับหน้า 1', async ({ browser }) => {
  const app = await bootBare(browser);
  await seed(app.page);
  await render(app.page);
  await gotoPage(app.page, 3);
  expect((await read(app.page)).skus).toEqual(range('O', 41, 45));

  // ลบ O001 + O041–O045 → เหลือ 39 แถว (2 หน้า) ขณะที่ผู้ใช้ค้างอยู่หน้า 3 แล้ว re-render
  await app.page.evaluate(() => { state.scanData.delete('O001'); for (let i = 41; i <= 45; i++) state.scanData.delete('O' + String(i).padStart(3, '0')); renderAdjustDocTable(); });
  expect(await read(app.page)).toEqual({ skus: range('O', 22, 40), nums: nums(21, 39), count: '39 รายการ', page: 2,
    pager: { info: 'หน้า 2 / 2 (21–39)', off: [false, false, true, true] } });

  const pageAfter = async (p) => { await gotoPage(app.page, p); return (await read(app.page)).page; };
  expect(await pageAfter(Infinity)).toBe(2);
  expect(await pageAfter(NaN)).toBe(1);
  expect(await pageAfter(-3)).toBe(1);
  expect(await pageAfter(0)).toBe(1);
  expect(await pageAfter(99)).toBe(2);
  expect(await pageAfter(1.9)).toBe(1);                                         // เศษปัดลง

  // ใบว่าง (ค้างอยู่หน้า 2) → หน้า 1 · ไม่มี pager · ไม่มีรายการ
  await gotoPage(app.page, 2);
  await app.page.evaluate(() => { for (const k of [...state.scanData.keys()]) if (k.startsWith('O')) state.scanData.delete(k); renderAdjustDocTable(); });
  expect(await read(app.page)).toEqual({ skus: [], nums: [], count: '0 รายการ', page: 1, pager: null });
  await closeApp(app);
});

test('ทางถอย: ADJUST_DOC_PAGE_SIZE=0/ค่าผิด → ไม่แบ่งหน้า วาดครบ 45 แถว · ค่าอื่นถูกใช้จริง (ไม่ฮาร์ดโค้ด 20)', async ({ browser }) => {
  const app = await bootBare(browser);
  await seed(app.page);
  for (const v of [0, NaN, -5]) {
    await app.page.evaluate((v) => { ADJUST_DOC_PAGE_SIZE = v; _adjDocPage = 2; renderAdjustDocTable(); }, v);   // ค้างหน้า 2 ไว้ก่อน — ปิดสวิตช์แล้วต้องกลับมาหน้าเดียวครบ
    expect(await read(app.page), `ค่า ${v}`).toEqual({ skus: range('O', 1, 45), nums: nums(1, 45), count: '45 รายการ', page: 1, pager: null });
  }
  await app.page.evaluate(() => { ADJUST_DOC_PAGE_SIZE = 10; _adjDocPage = 1; renderAdjustDocTable(); });
  expect(await read(app.page)).toMatchObject({ skus: range('O', 1, 10), pager: { info: 'หน้า 1 / 5 (1–10)' } });
  await closeApp(app);
});

test('เปลี่ยนหน้า = เลื่อนขึ้นบนสุด · re-render อื่น (เลือก LOT) คงตำแหน่งเลื่อนเดิม', async ({ browser }) => {
  const app = await bootBare(browser);
  await app.page.setViewportSize({ width: 1465, height: 700 });
  await seed(app.page);
  await app.page.evaluate(() => {
    _lotMap.set('O030', [{ lot: 'L1', exp: '' }, { lot: 'L2', exp: '' }]);
    _adjDocPage = 2;
    openAdjustDocPopup();                                                        // แสดงป็อปอัพจริง (_refreshAdjMaster ถูก stub)
  });
  const pre = await app.page.evaluate(() => {
    const b = document.querySelector('#adjustDocPopupCard .stock-popup-body');
    b.scrollTop = 150;
    return { scrollable: b.scrollHeight > b.clientHeight, top: b.scrollTop };
  });
  expect(pre.scrollable, 'ต้องเลื่อนได้ ไม่งั้นเทสนี้ไม่ได้ตรวจอะไร').toBe(true);
  expect(pre.top).toBeGreaterThan(0);

  // re-render จากเลือก LOT → ตำแหน่งเลื่อนคงเดิม (ไม่เด้งขึ้นบน)
  const afterPick = await app.page.evaluate(() => { onAdjLotSelect('O030', 'L2'); return document.querySelector('#adjustDocPopupCard .stock-popup-body').scrollTop; });
  expect(afterPick).toBe(pre.top);

  // ผู้ใช้กดเปลี่ยนหน้า → เลื่อนขึ้นบนสุด (ไปหน้า 1 ที่เต็ม 20 แถวเท่ากัน — ถ้าไปหน้า 3 ที่มี 5 แถว เบราว์เซอร์จะ clamp scrollTop เป็น 0 เอง เทสนี้จะไม่ตรวจอะไร)
  const afterNav = await app.page.evaluate(() => { setAdjDocPage(1); return document.querySelector('#adjustDocPopupCard .stock-popup-body').scrollTop; });
  expect(afterNav).toBe(0);
  await closeApp(app);
});
