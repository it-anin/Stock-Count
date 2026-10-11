// ใบ 📦 ปรับปรุงสินค้า: แบ่งหน้า 20 แถวต่อหน้า (ต.ค. 2026 · ผู้ใช้สั่ง — ลดงานวาด DOM)
//   สวิตช์ ADJUST_DOC_PAGE_SIZE (0 = ไม่แบ่งหน้า = ทางถอย) · _adjDocPage
//   + Export Text ทีละหน้าที่เห็น (7 ต.ค. 2026 · ผู้ใช้สั่ง) — สวิตช์ ADJUST_DOC_EXPORT_TEXT_BY_PAGE (false = Export Text ทุกแถวของแท็บเหมือนเดิม = ทางถอย)
//
// เทสนี้ตรึง 10 ด้าน — ข้อ 5–7 สำคัญที่สุด: Export Text = "หน้าที่เห็น" เท่านั้น (ตรงกับตารางทุกหน้า · ทุกหน้าต่อกันครบไม่ซ้ำไม่ตก) ส่วน Export Excel/ปุ่มนับ ไม่ผูกกับหน้า
//   1. 45 ORDS → 3 หน้า (20/20/5) · ลำดับต่อเนื่องข้ามหน้า · ปุ่มขอบ disabled · ยอดรวมของแท็บ (#adjustDocRowCount) คงเดิม
//   2. สลับ ORDS↔IRPS / เปิดป็อปอัพใหม่ → กลับหน้า 1 (ไม่จำหน้าเดิม)
//   3. ขอบ 20/21 แถว: 20 = ไม่มี pager · 21 = 2 หน้า · ใบว่าง = ไม่มี pager
//   4. re-render (เลือก LOT · แก้จำนวน · โหลดข้อมูลเสร็จ) คงหน้า · วาดจริงแค่ 20 แถว (select/ช่องจำนวน) · LOT ที่เลือกอยู่ข้ามหน้า
//   5. ★ Export Text ขณะอยู่หน้า 2 = เฉพาะ 20 แถวที่เห็น · ชื่อไฟล์ _p2 · ป้ายปุ่ม/toast บอกหน้า · Excel ยังครบทุกแถว · ปุ่มนับ 📦 ยังนับทุกแถว
//   6. ★ Export Text ทุกหน้าตรงกับที่เห็นบนตารางหน้านั้นเป๊ะ และรวมกันได้ครบทุกแถว ไม่ซ้ำไม่ตก
//   7. ★ แถวแก้เป็น 0 / แก้จำนวน: ข้ามเฉพาะในหน้าที่ส่ง · toast นับเฉพาะหน้านั้น · หน้าที่ไม่มีแถวให้ส่ง = ไม่ออกไฟล์
//   8. clamp หน้า (แถวหด · Infinity · NaN · ติดลบ · เกิน) · ใบว่างกลับหน้า 1
//   9. ทางถอย: ADJUST_DOC_PAGE_SIZE=0/ค่าผิด → วาดครบทุกแถว · ค่าอื่นถูกใช้จริง (ไม่ฮาร์ดโค้ด 20) · เปลี่ยนหน้า = เลื่อนขึ้นบนสุด แต่ re-render อื่นคงตำแหน่งเลื่อน
//  10. ทางถอย Export Text: สวิตช์ปิด/ไม่แบ่งหน้า → ทุกแถวของแท็บ ข้อความ+ชื่อไฟล์เดิม · หน้าเดียว (≤20 แถว) = ข้อความ/ชื่อไฟล์เดิมทุกตัวอักษร
const { test, expect, bootBare, closeApp } = require('../../lib/hooks');

const T = '2026-09-20 09:00:00';
// Stock Adj ตรงของสาขายา (ตัวเลขแช่ไว้ตอน Confirm) — ผลต่าง = effectiveQty − systemQty
const DIRECT = (extra = {}) => ({ status: 'stock_adjustment', auditStatus: 'stock_adjustment', initialStatus: 'stock_adjustment', auditor: '',
  countedQty: 8, timestamp: T, firstScanAt: T, scannedBy: 'Asst', directAdj: true, ...extra });

// nO แถว ORDS (O001…: 8−10 = ขาด 2) แล้วต่อด้วย nI แถว IRPS (I001…: 13−10 = เกิน 3) — ลำดับใส่ = ลำดับในใบ
async function seed(page, { nO = 45, nI = 25, role = 'pharmacist' } = {}) {
  await page.evaluate(({ nO, nI, role, tpl }) => {
    ADJUST_DOC_PAGE_SIZE = 20; ADJUST_DOC_QTY_EDIT = true; ADJUST_DOC_EXPORT_TEXT_BY_PAGE = true;
    currentBranch = 'SRC'; currentRole = role; currentUser = 'Pharm';
    _branchScanPaused = false; _adjDocFilter = 'ords'; _adjDocPage = 1; _adjLoading = false;
    _lotMap.clear(); _lotSelected.clear(); _priceMap.clear();
    state.skuMap.clear(); state.scanData.clear(); state.skuDirectMap.clear(); scanListMap.clear();
    window.__marked = []; _markSkuDirty = (s) => { window.__marked.push(String(s)); };   // ไม่แตะ Firestore
    window.__toasts = []; toast = (m) => { window.__toasts.push(String(m)); };
    _refreshAdjMaster = async () => {};                                                  // openAdjustDocPopup ต้องไม่ยิง Supabase
    window.__exports = []; window.__downloads = [];
    URL.createObjectURL = (b) => { window.__exports.push(b); return 'blob:captured'; };
    URL.revokeObjectURL = () => {};
    HTMLAnchorElement.prototype.click = function () { window.__downloads.push(this.download); };   // ชื่อไฟล์ที่เบราว์เซอร์จะบันทึก
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
const sendLines = (text) => text.trim().split('\r\n').map((l) => l.split('\t').slice(0, 2));   // [[sku, qty], …] ของไฟล์ Text
const lastFile = (page) => page.evaluate(() => window.__downloads[window.__downloads.length - 1]);
const lastToast = (page, prefix) => page.evaluate((p) => [...window.__toasts].reverse().find((m) => m.startsWith(p)), prefix);
const exportBtn = (page) => page.evaluate(() => { const b = document.getElementById('adjExportTextBtn'); return { text: b.textContent, title: b.title }; });
const FILE_RE = (suffix = '') => new RegExp(`^stockadj_(ords|irps)_\\d{2}-\\d{2}-\\d{4}${suffix}\\.txt$`);

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

test('★ Export Text ขณะอยู่หน้า 2 = เฉพาะ 20 แถวที่เห็น · ชื่อไฟล์ _p2 · ป้ายปุ่ม/toast บอกหน้า · Excel ยังครบทุกแถว · IRPS ไม่ปน · ปุ่มนับ 📦 นับทุกแถว', async ({ browser }) => {
  const app = await bootBare(browser);
  await seed(app.page);
  await render(app.page);

  // หน้า 1 — ป้ายปุ่มบอกหน้าที่กดแล้วจะได้
  let b = await exportBtn(app.page);
  expect(b.text).toBe('⬇️ Export Text · หน้า 1/3');
  expect(b.title).toContain('แถวที่ 1–20 จาก 45');

  await gotoPage(app.page, 2);
  expect((await read(app.page)).skus).toEqual(range('O', 21, 40));            // จอเห็นแค่ 20 แถวของหน้า 2
  b = await exportBtn(app.page);
  expect(b.text).toBe('⬇️ Export Text · หน้า 2/3');
  expect(b.title).toContain('แถวที่ 21–40 จาก 45');
  expect(b.title).toContain('Export Excel ส่งออกทุกรายการ');                   // บอกทางไปเอาทุกแถว

  const text = await exportText(app.page);
  expect(sendLines(text)).toEqual(range('O', 21, 40).map((s) => [s, '2']));   // ★ ไม่ใช่ 45
  expect(await lastFile(app.page)).toMatch(FILE_RE('_p2'));
  expect(await lastToast(app.page, 'Export ORDS')).toBe('Export ORDS 20 รายการ (Text) สำเร็จ · หน้า 2/3');

  // หน้าสุดท้าย (5 แถว) · หน้าแรก
  await gotoPage(app.page, 3);
  expect((await exportBtn(app.page)).title).toContain('แถวที่ 41–45 จาก 45');   // หน้าสุดท้ายไม่เต็ม 20 → ช่วงต้องไม่เลยยอดรวม
  expect(sendLines(await exportText(app.page))).toEqual(range('O', 41, 45).map((s) => [s, '2']));
  expect(await lastFile(app.page)).toMatch(FILE_RE('_p3'));
  expect(await lastToast(app.page, 'Export ORDS')).toBe('Export ORDS 5 รายการ (Text) สำเร็จ · หน้า 3/3');
  await gotoPage(app.page, 1);
  expect(sendLines(await exportText(app.page))).toEqual(range('O', 1, 20).map((s) => [s, '2']));
  expect(await lastFile(app.page)).toMatch(FILE_RE('_p1'));

  // ★ Export Excel ไม่เปลี่ยน — ครบทุกแถวของแท็บแม้อยู่หน้า 2 (ลำดับ 1–45 ไม่ถูกหน้าตัด)
  await gotoPage(app.page, 2);
  const sheet = await exportSheet(app.page, 'ORDS');
  expect(sheet.slice(1).map((r) => [r[0], r[1], r[4]])).toEqual(range('O', 1, 45).map((s, i) => [i + 1, s, 2]));

  // แท็บ IRPS หน้า 2 (เห็น 5 แถว) → ไฟล์ Text ได้ 5 แถวนั้น (ไม่ปน ORDS)
  await app.page.evaluate(() => { setAdjDocFilter('irps', document.getElementById('adjBtnIrps')); setAdjDocPage(2); });
  expect((await read(app.page)).skus).toEqual(range('I', 21, 25));
  expect((await exportBtn(app.page)).text).toBe('⬇️ Export Text · หน้า 2/2');
  expect(sendLines(await exportText(app.page))).toEqual(range('I', 21, 25).map((s) => [s, '3']));
  expect(await lastFile(app.page)).toMatch(/^stockadj_irps_\d{2}-\d{2}-\d{4}_p2\.txt$/);
  expect(await lastToast(app.page, 'Export IRPS')).toBe('Export IRPS 5 รายการ (Text) สำเร็จ · หน้า 2/2');

  // ปุ่มนับ / ชุด SKU ที่ขอ LOT-ราคา ไม่ผูกกับหน้า
  expect(await app.page.evaluate(() => [_countAdjustDocItems(), _adjustDocSkuSet().size])).toEqual([70, 70]);
  await closeApp(app);
});

test('★ Export Text ทุกหน้าตรงกับที่เห็นบนตารางหน้านั้นเป๊ะ · ทุกหน้าต่อกันครบทุกแถว ไม่ซ้ำไม่ตก (ORDS 45 · IRPS 25)', async ({ browser }) => {
  const app = await bootBare(browser);
  await seed(app.page);
  await render(app.page);
  for (const [tab, prefix, total] of [['ords', 'O', 45], ['irps', 'I', 25]]) {
    await app.page.evaluate((tab) => setAdjDocFilter(tab, document.getElementById(tab === 'ords' ? 'adjBtnOrds' : 'adjBtnIrps')), tab);
    const pages = Math.ceil(total / 20);
    const sent = [];
    for (let p = 1; p <= pages; p++) {
      await gotoPage(app.page, p);
      const shown = (await read(app.page)).skus;                              // สิ่งที่ผู้ใช้เห็นบนตาราง
      const file = sendLines(await exportText(app.page)).map((l) => l[0]);   // สิ่งที่ไฟล์ได้
      expect(file, `${tab} หน้า ${p}`).toEqual(shown);
      sent.push(...file);
    }
    expect(sent, `${tab} ทุกหน้าต่อกัน`).toEqual(range(prefix, 1, total));
  }
  await closeApp(app);
});

test('★ แถวแก้เป็น 0 / แก้จำนวน: ข้ามเฉพาะในหน้าที่ส่ง · toast นับเฉพาะหน้านั้น · หน้าที่ไม่มีแถวให้ส่ง = ไม่ออกไฟล์', async ({ browser }) => {
  const app = await bootBare(browser);
  await seed(app.page);
  await render(app.page);
  // O025 (หน้า 2) แก้เป็น 0 · O043 (หน้า 3) แก้เป็น 1
  await app.page.evaluate(() => { setAdjDocQty('O025', '0'); setAdjDocQty('O043', '1'); });

  await gotoPage(app.page, 2);
  const t2 = await exportText(app.page);
  expect(sendLines(t2)).toEqual(range('O', 21, 40).filter((s) => s !== 'O025').map((s) => [s, '2']));   // O025 ยังเห็นบนจอ แต่ไม่ลงไฟล์ → 19 บรรทัด
  expect(await lastToast(app.page, 'Export ORDS')).toBe('Export ORDS 19 รายการ (Text) สำเร็จ · หน้า 2/3 · ข้าม 1 (แก้เป็น 0)');   // ไม่นับ O043 ที่อยู่หน้า 3

  await gotoPage(app.page, 3);
  const t3 = await exportText(app.page);
  expect(sendLines(t3)).toEqual([['O041', '2'], ['O042', '2'], ['O043', '1'], ['O044', '2'], ['O045', '2']]);   // ค่าที่แก้ลงไฟล์
  expect(await lastToast(app.page, 'Export ORDS')).toBe('Export ORDS 5 รายการ (Text) สำเร็จ · หน้า 3/3 · แก้จำนวน 1');   // ไม่นับ O025 ที่อยู่หน้า 2

  // ทั้งหน้า 2 แก้เป็น 0 → ไม่มีอะไรให้ส่ง: ไม่ออกไฟล์ · toast บอกหน้า · หน้าอื่นยังออกไฟล์ได้
  await app.page.evaluate(() => { for (let i = 21; i <= 40; i++) if (i !== 25) setAdjDocQty('O' + String(i).padStart(3, '0'), '0'); });
  await gotoPage(app.page, 2);
  const nFiles = await app.page.evaluate(() => window.__downloads.length);
  expect(await exportText(app.page)).toBeNull();
  expect(await app.page.evaluate(() => window.__downloads.length)).toBe(nFiles);
  expect(await lastToast(app.page, 'ไม่มีรายการให้ Export')).toBe('ไม่มีรายการให้ Export ตามแท็บที่เลือก · หน้า 2/3 · ข้าม 20 (แก้เป็น 0)');
  await gotoPage(app.page, 1);
  expect(sendLines(await exportText(app.page))).toEqual(range('O', 1, 20).map((s) => [s, '2']));
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

test('★ ทางถอย Export Text: สวิตช์ปิด/ไม่แบ่งหน้า → ทุกแถวของแท็บ ข้อความ+ชื่อไฟล์เดิม · หน้าเดียว (≤20 แถว) = เดิมทุกตัวอักษร · เปิดกลับ = ตามหน้า', async ({ browser }) => {
  const app = await bootBare(browser);
  // ค่าที่ส่งมอบ (ก่อน seed ตั้งค่าเอง): Export Text ตามหน้า = เปิด · 20 แถวต่อหน้า
  expect(await app.page.evaluate(() => [ADJUST_DOC_EXPORT_TEXT_BY_PAGE, ADJUST_DOC_PAGE_SIZE])).toEqual([true, 20]);
  await seed(app.page);
  await render(app.page);
  await gotoPage(app.page, 2);
  expect(sendLines(await exportText(app.page))).toHaveLength(20);              // ค่าเริ่มต้น = ตามหน้า

  // สวิตช์ปิด → ค้างหน้า 2 อยู่ก็ได้ทุกแถวของแท็บ · ป้ายปุ่ม/ชื่อไฟล์/toast กลับเป็นเดิม
  await app.page.evaluate(() => { ADJUST_DOC_EXPORT_TEXT_BY_PAGE = false; renderAdjustDocTable(); });
  expect(await exportBtn(app.page)).toEqual({ text: '⬇️ Export Text', title: 'Export ทุกรายการของแท็บนี้' });
  expect(sendLines(await exportText(app.page))).toEqual(range('O', 1, 45).map((s) => [s, '2']));
  expect(await lastFile(app.page)).toMatch(FILE_RE());
  expect(await lastToast(app.page, 'Export ORDS')).toBe('Export ORDS 45 รายการ (Text) สำเร็จ');
  expect((await read(app.page)).page).toBe(2);                                  // ตารางยังแบ่งหน้าตามเดิม (สวิตช์นี้คุมเฉพาะ Export Text)

  // เปิดกลับ → ตามหน้าอีกครั้ง (ไม่ได้ลบอะไร)
  await app.page.evaluate(() => { ADJUST_DOC_EXPORT_TEXT_BY_PAGE = true; renderAdjustDocTable(); });
  expect((await exportBtn(app.page)).text).toBe('⬇️ Export Text · หน้า 2/3');
  expect(sendLines(await exportText(app.page))).toEqual(range('O', 21, 40).map((s) => [s, '2']));

  // ไม่แบ่งหน้า (ADJUST_DOC_PAGE_SIZE ไม่ใช่เลขบวก) แม้สวิตช์เปิด → ทุกแถว · ไม่มีส่วนต่อท้าย
  for (const v of [0, NaN, -5]) {
    await app.page.evaluate((v) => { ADJUST_DOC_PAGE_SIZE = v; _adjDocPage = 2; renderAdjustDocTable(); }, v);
    expect(await exportBtn(app.page), `ค่า ${v}`).toEqual({ text: '⬇️ Export Text', title: 'Export ทุกรายการของแท็บนี้' });
    expect(sendLines(await exportText(app.page)), `ค่า ${v}`).toHaveLength(45);
    expect(await lastFile(app.page), `ค่า ${v}`).toMatch(FILE_RE());
    expect(await lastToast(app.page, 'Export ORDS')).toBe('Export ORDS 45 รายการ (Text) สำเร็จ');
  }

  // หน้าเดียว (20 แถว พอดีขอบ) → เดิมทุกตัวอักษร: ไม่มี _p · ไม่มี "หน้า" ใน toast · ป้ายปุ่มเดิม
  await seed(app.page, { nO: 20, nI: 5 });
  await render(app.page);
  expect(await exportBtn(app.page)).toEqual({ text: '⬇️ Export Text', title: 'Export ทุกรายการของแท็บนี้' });
  expect(sendLines(await exportText(app.page))).toEqual(range('O', 1, 20).map((s) => [s, '2']));
  expect(await lastFile(app.page)).toMatch(FILE_RE());
  expect(await lastToast(app.page, 'Export ORDS')).toBe('Export ORDS 20 รายการ (Text) สำเร็จ');

  // ใบที่เคยมีหลายหน้าแล้วว่างลง → ป้ายปุ่มกลับเป็นเดิม (ไม่ค้าง "หน้า 3/3") · ไม่ออกไฟล์ · toast เดิม
  await seed(app.page);
  await render(app.page);
  await gotoPage(app.page, 3);
  expect((await exportBtn(app.page)).text).toBe('⬇️ Export Text · หน้า 3/3');
  await app.page.evaluate(() => { state.scanData.clear(); renderAdjustDocTable(); });
  expect(await exportBtn(app.page)).toEqual({ text: '⬇️ Export Text', title: 'Export ทุกรายการของแท็บนี้' });
  expect(await exportText(app.page)).toBeNull();
  expect(await lastToast(app.page, 'ไม่มีรายการให้ Export')).toBe('ไม่มีรายการให้ Export ตามแท็บที่เลือก');
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
