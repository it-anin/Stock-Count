// 📋 รายการสต็อคสินค้า: แบ่งหน้า 20 แถวต่อหน้า (ต.ค. 2026 · ผู้ใช้สั่ง — แนวเดียวกับ 📦 ปรับปรุงสินค้า)
//   สวิตช์ POPUP_PAGE_SIZE (0 = ไม่แบ่งหน้า → เพดาน 500 แถวแบบเดิมเป๊ะ = ทางถอย) · _popupPage · ตัวช่วยร่วม _paginate/_renderPagerUi
//
// เทสนี้ตรึง 9 ด้าน — ข้อ 5 สำคัญที่สุด: การแบ่งหน้าต้องเป็น "การวาดตาราง" ล้วน ไม่ลามไปที่ตัวกรอง/Export/ยอดรวม
//   0. _paginate (ฟังก์ชันบริสุทธิ์ที่ใช้ร่วมกับ 📦): clamp/Infinity/NaN/เศษ/ปิดสวิตช์
//   1. 45 แถว → 3 หน้า (20/20/5) · ลำดับต่อเนื่อง · ปุ่มขอบ disabled · ยอดรวม "45 รายการ" (ไม่ใช่ "20/45") · ปุ่ม « ‹ › » ผ่าน onclick จริง
//   2. รีเซ็ตเป็นหน้า 1: เปิดป็อปอัพ · ปุ่มตัวกรอง · ตัวกรองผู้ช่วย · พิมพ์ค้นหา (oninput จริง ผ่าน debounce)
//   3. ขอบ 20/21/ว่าง · คงหน้าเมื่อ re-render (snapshot/แก้จำนวนจริงผ่าน updatePopupQty) · clamp เมื่อแถวหด
//   4. แถวที่ไม่มีในระบบ (unknownScans) ต่อท้ายแคตตาล็อกและแบ่งหน้าด้วย · WH หัวหน้า (คอลัมน์เพิ่ม) แบ่งหน้าได้
//   5. ★ Export Excel ครบทุกแถวตามตัวกรอง ไม่ว่าอยู่หน้าไหน · ตัวกรอง "ยังไม่ได้นับ" ยังเท่ากับตัวหาร−ตัวเศษ (ไม่ผูกกับหน้า)
//   6. ทางถอย: POPUP_PAGE_SIZE=0/ค่าผิด → วาดเพดาน 500 แถว + "500/520 รายการ" เหมือนเดิม · เปิดแล้วเห็นแถวที่เกิน 500 ได้
//   7. เปลี่ยนหน้า/ตัวกรอง/ค้นหา/เปิดป็อปอัพ = เลื่อนขึ้นบนสุด · re-render อื่นคงตำแหน่งเลื่อน
const { test, expect, bootBare, closeApp } = require('../../lib/hooks');

const pad = (n) => String(n).padStart(3, '0');
const range = (p, a, b) => Array.from({ length: b - a + 1 }, (_, i) => p + pad(a + i));
const nums = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

// n แถวแคตตาล็อก P001…: P001–P(pending) = ยังไม่สแกน · ถัดไป 10 แถว = pass · ที่เหลือ = audit · ต่อท้ายด้วย unknown แถวที่ไม่มีในระบบ (U001…)
// ทุก SKU อยู่ในชุดที่ต้องนับ (_countableSkus) ⇒ ตัวกรอง "ยังไม่ได้นับ" ได้ P001–P(pending) พอดี
async function seed(page, { n = 45, pending = 25, unknown = 0, branch = 'SRC', role = 'assistant' } = {}) {
  await page.evaluate(({ n, pending, unknown, branch, role }) => {
    POPUP_PAGE_SIZE = 20;
    currentBranch = branch; currentRole = role; currentUser = 'T'; _branchScanPaused = false;
    popupFilterState = 'all'; popupStaffFilter = 'all'; _popupPage = 1; _popupScrollTop = false;
    clearTimeout(popupRenderTimer);
    document.getElementById('popupSearch').value = '';
    state.skuMap.clear(); state.scanData.clear(); state.locationMap.clear(); scanListMap.clear(); state.unknownScans = [];
    window.__marked = []; _markSkuDirty = (s) => { window.__marked.push(String(s)); };   // ไม่แตะ Firestore
    window.__toasts = []; toast = (m) => { window.__toasts.push(String(m)); };
    const p3 = (i) => String(i).padStart(3, '0');
    const all = new Set();
    for (let i = 1; i <= n; i++) {
      const sku = 'P' + p3(i);
      all.add(sku);
      state.skuMap.set(sku, { sku, productName: 'สินค้า ' + sku, unitPrice: 20, systemQty: 10, negSys: false, barcodes: [{ barcode: 'B' + sku, unitName: 'เม็ด', unitMultiplier: 1 }], isDel: false });
      const status = i <= pending ? 'pending' : i <= pending + 10 ? 'pass' : 'audit';
      state.scanData.set(sku, { status, countedQty: status === 'pending' ? 0 : 10, retries: 0, scannedBy: status === 'pending' ? '' : 'สมชาย',
        timestamp: status === 'pending' ? '' : '2026-10-06 09:00:00', auditor: '', auditStatus: status === 'pass' ? 'approved' : 'pending', barcode: '', location: '' });
    }
    _countableSkus = all;
    for (let i = 1; i <= unknown; i++) state.unknownScans.push({ barcode: 'U' + p3(i), count: 1, location: '', timestamp: '2026-10-06 09:00:00', scannedBy: 'สมชาย' });
    invalidatePopupRowsCache();
  }, { n, pending, unknown, branch, role });
}

// สิ่งที่ผู้ใช้เห็นบนจอ ณ ตอนนี้ — ผ่านตารางและ pager จริง (SKU = ข้อความแรกของช่อง ไม่รวมแท็ก "ไม่มีในระบบ"/DEL)
const read = (page) => page.evaluate(() => {
  const rows = [...document.querySelectorAll('#popupTableBody tr')].filter((tr) => tr.children.length > 1);
  const pager = document.getElementById('popupPager');
  return {
    skus: rows.map((tr) => tr.children[1].childNodes[0].textContent.trim()),
    bcs: rows.map((tr) => tr.children[2].textContent.trim()),
    nums: rows.map((tr) => Number(tr.children[0].textContent.trim())),
    cells: rows.length ? rows[0].children.length : 0,
    count: document.getElementById('popupRowCount').textContent,
    page: _popupPage,
    pager: getComputedStyle(pager).display === 'none' ? null : {
      info: pager.querySelector('[data-pg="info"]').textContent,
      off: ['first', 'prev', 'next', 'last'].map((k) => pager.querySelector(`[data-pg="${k}"]`).disabled),
    },
  };
});
const flush = (page) => page.evaluate(() => { clearTimeout(popupRenderTimer); renderPopupTable(); });   // วาดทันที ไม่รอ debounce (ตัดตัวจับเวลาที่ค้างทิ้ง)
const click = (page, sel) => page.evaluate((sel) => document.querySelector(sel).click(), sel);          // ผ่าน onclick จริงของปุ่ม
const nav = (page, k) => click(page, `#popupPager [data-pg="${k}"]`);
const gotoPage = (page, p) => page.evaluate((p) => setPopupPage(p), p);
const exportRows = (page) => page.evaluate(() => {
  let s = null; const orig = XLSX.writeFile;
  XLSX.writeFile = (wb) => { s = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 }); };
  try { exportExcel(); } finally { XLSX.writeFile = orig; }
  return s;
});

test('_paginate (ตัวช่วยที่ใช้ร่วมกับ 📦): clamp หน้า · Infinity/NaN/ติดลบ/เศษ · ปิดสวิตช์ = หน้าเดียวทุกแถว', async ({ browser }) => {
  const app = await bootBare(browser);
  const run = (cases) => app.page.evaluate((cases) => cases.map(([t, s, p]) => _paginate(t, s, p)), cases);
  const on = (size, pages, page, start) => ({ on: true, size, pages, page, start });
  const off = (total) => ({ on: false, size: Math.max(total, 1), pages: 1, page: 1, start: 0 });
  const cases = [
    [[45, 20, 1], on(20, 3, 1, 0)], [[45, 20, 2], on(20, 3, 2, 20)], [[45, 20, 3], on(20, 3, 3, 40)],
    [[45, 20, 99], on(20, 3, 3, 40)],               // เกิน → หน้าสุดท้าย
    [[45, 20, Infinity], on(20, 3, 3, 40)],         // ปุ่ม » (⛔ |0 จะได้ 0 → หน้าแรก)
    [[45, 20, NaN], on(20, 3, 1, 0)], [[45, 20, 0], on(20, 3, 1, 0)], [[45, 20, -3], on(20, 3, 1, 0)], [[45, 20, null], on(20, 3, 1, 0)],
    [[45, 20, 1.9], on(20, 3, 1, 0)],               // เศษปัดลง
    [[45, 20, '2'], on(20, 3, 2, 20)],              // สตริงตัวเลขจาก DOM
    [[20, 20, 1], on(20, 1, 1, 0)], [[21, 20, 2], on(20, 2, 2, 20)], [[21, 20, 1], on(20, 2, 1, 0)],
    [[0, 20, 5], on(20, 1, 1, 0)],                  // ว่าง → 1 หน้า
    [[45, 20.7, 1], on(20, 3, 1, 0)],               // ขนาดหน้าที่ไม่เต็มเลข → ปัดลง
    [[45, 0, 2], off(45)], [[45, NaN, 2], off(45)], [[45, -5, 2], off(45)], [[45, Infinity, 2], off(45)], [[45, null, 2], off(45)], [[0, 0, 1], off(0)],
  ];
  const got = await run(cases.map((c) => c[0]));
  cases.forEach(([args], i) => expect(got[i], `_paginate(${args.map(String).join(', ')})`).toEqual(cases[i][1]));
  await closeApp(app);
});

test('45 แถว → 3 หน้า (20/20/5) · ลำดับต่อเนื่อง · ปุ่มขอบถูกปิด · ยอดรวมไม่ใช่ "20/45" · ปุ่ม « ‹ › » ผ่าน onclick จริง', async ({ browser }) => {
  const app = await bootBare(browser);
  await seed(app.page);
  await flush(app.page);
  expect(await read(app.page)).toEqual({ skus: range('P', 1, 20), bcs: range('BP', 1, 20), nums: nums(1, 20), cells: 10, count: '45 รายการ', page: 1,
    pager: { info: 'หน้า 1 / 3 (1–20)', off: [true, true, false, false] } });
  await nav(app.page, 'next');
  expect(await read(app.page)).toMatchObject({ skus: range('P', 21, 40), nums: nums(21, 40), count: '45 รายการ', page: 2,
    pager: { info: 'หน้า 2 / 3 (21–40)', off: [false, false, false, false] } });
  await nav(app.page, 'next');
  expect(await read(app.page)).toMatchObject({ skus: range('P', 41, 45), nums: nums(41, 45), count: '45 รายการ', page: 3,
    pager: { info: 'หน้า 3 / 3 (41–45)', off: [false, false, true, true] } });

  await nav(app.page, 'first'); expect((await read(app.page)).page).toBe(1);
  await nav(app.page, 'last'); expect((await read(app.page)).page).toBe(3);
  await nav(app.page, 'prev'); expect((await read(app.page)).page).toBe(2);
  // ปุ่มที่ถูกปิด (ขอบ) คลิกแล้วไม่มีผล
  await nav(app.page, 'first'); await nav(app.page, 'prev'); expect((await read(app.page)).page).toBe(1);
  await nav(app.page, 'last'); await nav(app.page, 'next'); expect((await read(app.page)).page).toBe(3);
  await closeApp(app);
});

test('รีเซ็ตเป็นหน้า 1: ปุ่มตัวกรอง · ตัวกรองผู้ช่วย · พิมพ์ค้นหา (oninput จริง) · เปิดป็อปอัพใหม่', async ({ browser }) => {
  const app = await bootBare(browser);
  await seed(app.page);                                                       // pending P001–P025 · pass P026–P035 · audit P036–P045
  await flush(app.page);
  await gotoPage(app.page, 3);
  expect((await read(app.page)).skus).toEqual(range('P', 41, 45));

  // ปุ่มตัวกรอง "ยังไม่ได้นับ" (ปุ่มจริง) → หน้า 1 · 25 แถว = 2 หน้า (20/5) · ยอดรวมตามตัวกรอง
  await click(app.page, '#popupStatusFilterRow .popup-filter[onclick*="\'pending\'"]');
  await app.page.waitForFunction(() => document.getElementById('popupRowCount').textContent === '25 รายการ', null, { polling: 100 });
  expect(await read(app.page)).toMatchObject({ page: 1, skus: range('P', 1, 20), count: '25 รายการ', pager: { info: 'หน้า 1 / 2 (1–20)', off: [true, true, false, false] } });
  await nav(app.page, 'next');
  expect(await read(app.page)).toMatchObject({ page: 2, skus: range('P', 21, 25), nums: nums(21, 25), pager: { info: 'หน้า 2 / 2 (21–25)' } });

  // กลับ "ทั้งหมด" ขณะอยู่หน้า 2 → หน้า 1
  await click(app.page, '#popupStatusFilterRow .popup-filter[onclick*="\'all\'"]');
  await app.page.waitForFunction(() => document.getElementById('popupRowCount').textContent === '45 รายการ', null, { polling: 100 });
  expect(await read(app.page)).toMatchObject({ page: 1, skus: range('P', 1, 20) });

  // พิมพ์ค้นหา (input event จริง → onPopupSearch → debounce) จากหน้า 3 → หน้า 1 · P04x = 6 แถว (P040–P045)
  await gotoPage(app.page, 3);
  await app.page.evaluate(() => { const el = document.getElementById('popupSearch'); el.value = 'p04'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await app.page.waitForFunction(() => document.getElementById('popupRowCount').textContent === '6 รายการ', null, { polling: 100 });
  expect(await read(app.page)).toMatchObject({ page: 1, skus: range('P', 40, 45), nums: nums(1, 6), pager: null });

  // เปิดป็อปอัพใหม่ขณะค้างหน้า 3 พร้อมคำค้นเก่า → หน้า 1 · ช่องค้นหาถูกล้าง · ได้ครบทุกแถว
  await app.page.evaluate(() => { document.getElementById('popupSearch').value = ''; clearTimeout(popupRenderTimer); renderPopupTable(); setPopupPage(3); });
  expect((await read(app.page)).page).toBe(3);
  await app.page.evaluate(() => { document.getElementById('popupSearch').value = 'คำค้นเก่า'; openStockPopup(); clearTimeout(popupRenderTimer); renderPopupTable(); });
  expect(await read(app.page)).toMatchObject({ page: 1, skus: range('P', 1, 20), count: '45 รายการ' });
  expect(await app.page.evaluate(() => document.getElementById('popupSearch').value)).toBe('');

  // ตัวกรองผู้ช่วย — ชุดที่กรองต้องยาว ≥ 2 หน้า และหน้าเดิมต้องยังมีอยู่ในชุดนั้น ไม่งั้น clamp ของ _paginate
  // จะกลบการลืมรีเซ็ตหน้าจนเทสไม่ตรวจอะไร (รอบแรกเทสนี้ผลกรองมีหน้าเดียว → ใส่บั๊ก "ไม่รีเซ็ต" แล้วเทสยังผ่าน)
  await seed(app.page, { n: 70, pending: 10 });                              // P011–P070 = 60 แถวของ 'สมชาย' = 3 หน้า · ทั้งหมด 70 แถว = 4 หน้า
  await flush(app.page);
  await gotoPage(app.page, 3);
  expect(await read(app.page)).toMatchObject({ page: 3, skus: range('P', 41, 60), count: '70 รายการ' });
  await app.page.evaluate(() => setPopupStaffFilter('สมชาย', document.createElement('button')));
  await app.page.waitForFunction(() => document.getElementById('popupRowCount').textContent === '60 รายการ', null, { polling: 100 });
  expect(await read(app.page)).toMatchObject({ page: 1, skus: range('P', 11, 30), nums: nums(1, 20), count: '60 รายการ', pager: { info: 'หน้า 1 / 3 (1–20)', off: [true, true, false, false] } });
  await closeApp(app);
});

test('ขอบ 20/21/ว่าง · คงหน้าเมื่อ re-render (snapshot · แก้จำนวนจริงผ่าน updatePopupQty) · clamp เมื่อแถวหด', async ({ browser }) => {
  const app = await bootBare(browser);
  await seed(app.page, { n: 20, pending: 10 });
  await flush(app.page);
  expect(await read(app.page)).toMatchObject({ skus: range('P', 1, 20), nums: nums(1, 20), count: '20 รายการ', page: 1, pager: null });
  await seed(app.page, { n: 21, pending: 10 });
  await flush(app.page);
  expect(await read(app.page)).toMatchObject({ skus: range('P', 1, 20), pager: { info: 'หน้า 1 / 2 (1–20)' } });
  await nav(app.page, 'next');
  expect(await read(app.page)).toMatchObject({ skus: ['P021'], nums: [21], count: '21 รายการ', page: 2, pager: { info: 'หน้า 2 / 2 (21–21)', off: [false, false, true, true] } });
  await seed(app.page, { n: 0, pending: 0 });
  await flush(app.page);
  expect(await read(app.page)).toEqual({ skus: [], bcs: [], nums: [], cells: 0, count: '0 รายการ', page: 1, pager: null });
  expect(await app.page.evaluate(() => document.getElementById('popupTableBody').textContent)).toContain('ไม่พบข้อมูล');

  // re-render จาก snapshot/สแกน (invalidate + วาดใหม่ ตามที่ renderTable ทำ) ไม่ดีดกลับหน้า 1
  await seed(app.page);
  await flush(app.page);
  await gotoPage(app.page, 2);
  await app.page.evaluate(() => { state.scanData.get('P030').countedQty = 99; invalidatePopupRowsCache(); renderPopupTable(); });
  expect(await read(app.page)).toMatchObject({ page: 2, skus: range('P', 21, 40), count: '45 รายการ' });

  // แก้จำนวนจริงในช่องของ P025 (หน้า 2) ผ่าน updatePopupQty → วาดใหม่ผ่าน debounce แต่ยังหน้า 2 · ช่องแสดงค่าใหม่
  await app.page.evaluate(() => updatePopupQty('P025', '3'));
  await app.page.waitForFunction(() => {
    const tr = [...document.querySelectorAll('#popupTableBody tr')].find((r) => r.children[1].textContent.trim().startsWith('P025'));
    return !!tr && tr.querySelector('input.popup-qty-input')?.value === '3';
  }, null, { polling: 100 });
  expect(await read(app.page)).toMatchObject({ page: 2, skus: range('P', 21, 40) });
  expect(await app.page.evaluate(() => window.__marked)).toContain('P025');

  // clamp: ค้างหน้า 3 แล้วแถวหด (P001 + P041–P045 หาย → 39 แถว 2 หน้า) → ถอยหน้า 2
  await gotoPage(app.page, 3);
  await app.page.evaluate(() => { state.skuMap.delete('P001'); for (let i = 41; i <= 45; i++) state.skuMap.delete('P' + String(i).padStart(3, '0')); invalidatePopupRowsCache(); renderPopupTable(); });
  expect(await read(app.page)).toMatchObject({ page: 2, skus: range('P', 22, 40), nums: nums(21, 39), count: '39 รายการ', pager: { info: 'หน้า 2 / 2 (21–39)', off: [false, false, true, true] } });
  const pageAfter = async (p) => { await gotoPage(app.page, p); return (await read(app.page)).page; };
  expect(await pageAfter(Infinity)).toBe(2);
  expect(await pageAfter(NaN)).toBe(1);
  expect(await pageAfter(-3)).toBe(1);
  expect(await pageAfter(99)).toBe(2);
  await closeApp(app);
});

test('แถวที่ไม่มีในระบบ (unknownScans) ต่อท้ายแคตตาล็อกและแบ่งหน้าด้วย · ตัวกรอง Unknown · WH หัวหน้า (คอลัมน์เพิ่ม) แบ่งหน้าได้', async ({ browser }) => {
  const app = await bootBare(browser);
  await seed(app.page, { n: 45, unknown: 25 });                               // ทั้งหมด 70 แถว = 4 หน้า (20/20/20/10)
  await flush(app.page);
  expect(await read(app.page)).toMatchObject({ count: '70 รายการ', page: 1, pager: { info: 'หน้า 1 / 4 (1–20)' } });
  await gotoPage(app.page, 3);                                                // แถว 41–60 = P041–P045 แล้ว unknown 15 แถว
  const p3 = await read(app.page);
  expect(p3.nums).toEqual(nums(41, 60));
  expect(p3.skus).toEqual([...range('P', 41, 45), ...Array(15).fill('—')]);
  expect(p3.bcs.slice(5)).toEqual(range('U', 1, 15));
  await gotoPage(app.page, 4);
  expect(await read(app.page)).toMatchObject({ nums: nums(61, 70), bcs: range('U', 16, 25), pager: { info: 'หน้า 4 / 4 (61–70)', off: [false, false, true, true] } });

  // ตัวกรอง Unknown: 25 แถว = 2 หน้า · กลับหน้า 1
  await click(app.page, '#popupStatusFilterRow .popup-filter[onclick*="\'unknown\'"]');
  await app.page.waitForFunction(() => document.getElementById('popupRowCount').textContent === '25 รายการ', null, { polling: 100 });
  expect(await read(app.page)).toMatchObject({ page: 1, bcs: range('U', 1, 20), pager: { info: 'หน้า 1 / 2 (1–20)' } });

  // WH หัวหน้างาน (12 ช่องต่อแถว: Sys Qty + Location) — แบ่งหน้าเหมือนกัน
  await seed(app.page, { n: 45, branch: 'WH', role: 'supervisor' });
  await flush(app.page);
  expect(await read(app.page)).toMatchObject({ cells: 12, skus: range('P', 1, 20), count: '45 รายการ', pager: { info: 'หน้า 1 / 3 (1–20)' } });
  await gotoPage(app.page, 3);
  expect(await read(app.page)).toMatchObject({ cells: 12, skus: range('P', 41, 45), nums: nums(41, 45) });
  await closeApp(app);
});

test('★ Export Excel ครบทุกแถวตามตัวกรอง ไม่ว่าอยู่หน้าไหน · ตัวกรอง "ยังไม่ได้นับ" ไม่ผูกกับหน้า', async ({ browser }) => {
  const app = await bootBare(browser);
  await seed(app.page, { n: 45, unknown: 25 });
  await flush(app.page);
  await gotoPage(app.page, 2);
  expect((await read(app.page)).skus).toEqual(range('P', 21, 40));            // จอเห็นแค่ 20 แถวของหน้า 2

  // ทั้งหมด: 45 + 25 = 70 แถว + หัวตาราง
  const all = await exportRows(app.page);
  expect(all.length).toBe(71);
  expect(all.slice(1, 46).map((r) => r[0])).toEqual(range('P', 1, 45));
  expect(all.slice(46).map((r) => r[1])).toEqual(range('U', 1, 25));          // Barcode ของแถวที่ไม่มีในระบบ ครบ 25
  expect(await app.page.evaluate(() => window.__toasts.find((m) => m.startsWith('Export')))).toContain('Export ทั้งหมด 70 รายการ');

  // ตัวกรอง "ยังไม่ได้นับ" (25 แถว · 2 หน้า) ขณะอยู่หน้า 2 → ไฟล์ได้ครบ 25 · จำนวนแถว = ตัวหาร − ตัวเศษ (ไม่ผูกกับหน้า)
  await click(app.page, '#popupStatusFilterRow .popup-filter[onclick*="\'pending\'"]');
  await app.page.waitForFunction(() => document.getElementById('popupRowCount').textContent === '25 รายการ', null, { polling: 100 });
  await gotoPage(app.page, 2);
  expect((await read(app.page)).skus).toEqual(range('P', 21, 25));
  const pend = await exportRows(app.page);
  expect(pend.slice(1).map((r) => r[0])).toEqual(range('P', 1, 25));
  expect(await app.page.evaluate(() => getFilteredPopupRows().length)).toBe(25);
  expect(await app.page.evaluate(() => window.__toasts.filter((m) => m.startsWith('Export')).pop())).toContain('Export ยังไม่ได้นับ 25 รายการ');

  // ตัวกรอง Unknown 25 แถว ขณะอยู่หน้า 2 → ไฟล์ได้ครบ 25
  await click(app.page, '#popupStatusFilterRow .popup-filter[onclick*="\'unknown\'"]');
  await app.page.waitForFunction(() => document.getElementById('popupRowCount').textContent === '25 รายการ' && popupFilterState === 'unknown', null, { polling: 100 });
  await gotoPage(app.page, 2);
  const unk = await exportRows(app.page);
  expect(unk.slice(1).map((r) => r[1])).toEqual(range('U', 1, 25));
  await closeApp(app);
});

test('ทางถอย: POPUP_PAGE_SIZE=0/ค่าผิด → วาดเพดาน 500 แถว + "500/520 รายการ" เหมือนเดิม · เปิดแล้วเห็นแถวที่เกิน 500 ได้ · ค่าอื่นถูกใช้จริง', async ({ browser }) => {
  const app = await bootBare(browser);
  await seed(app.page, { n: 520, pending: 100 });
  for (const v of [0, NaN, -5]) {
    await app.page.evaluate((v) => { POPUP_PAGE_SIZE = v; _popupPage = 3; clearTimeout(popupRenderTimer); renderPopupTable(); }, v);   // ค้างหน้า 3 ไว้ก่อน — ปิดสวิตช์แล้วต้องไม่แบ่งหน้า
    const r = await read(app.page);
    expect(r.skus.length, `ค่า ${v}`).toBe(500);
    expect(r, `ค่า ${v}`).toMatchObject({ skus: range('P', 1, 500), nums: nums(1, 500), count: '500/520 รายการ', page: 1, pager: null });
  }
  // เปิดแบ่งหน้า → แถวที่ 501–520 (เกินเพดานเดิม) เปิดดูได้ที่หน้าสุดท้าย
  await app.page.evaluate(() => { POPUP_PAGE_SIZE = 20; _popupPage = 1; clearTimeout(popupRenderTimer); renderPopupTable(); });
  expect(await read(app.page)).toMatchObject({ skus: range('P', 1, 20), count: '520 รายการ', pager: { info: 'หน้า 1 / 26 (1–20)' } });
  await gotoPage(app.page, Infinity);
  expect(await read(app.page)).toMatchObject({ skus: range('P', 501, 520), nums: nums(501, 520), count: '520 รายการ', page: 26, pager: { info: 'หน้า 26 / 26 (501–520)', off: [false, false, true, true] } });
  // ขนาดหน้าอื่นถูกใช้จริง (ไม่ฮาร์ดโค้ด 20)
  await app.page.evaluate(() => { POPUP_PAGE_SIZE = 100; _popupPage = 1; clearTimeout(popupRenderTimer); renderPopupTable(); });
  expect(await read(app.page)).toMatchObject({ skus: range('P', 1, 100), pager: { info: 'หน้า 1 / 6 (1–100)' } });
  await closeApp(app);
});

test('เปลี่ยนหน้า/ตัวกรอง/ค้นหา/เปิดป็อปอัพ = เลื่อนขึ้นบนสุด · re-render อื่น (snapshot/แก้จำนวน) คงตำแหน่งเลื่อน', async ({ browser }) => {
  const app = await bootBare(browser);
  await app.page.setViewportSize({ width: 1465, height: 700 });
  await seed(app.page, { n: 65, pending: 30 });                               // 65 แถว = 20/20/20/5 — หน้า 1–3 เต็มเท่ากัน (เลื่อนไม่ถูก clamp)
  await app.page.evaluate(() => { openStockPopup(); clearTimeout(popupRenderTimer); renderPopupTable(); });   // แสดงป็อปอัพจริง
  const SEL = '#stockPopupCard .stock-popup-body';
  const scrollable = () => app.page.evaluate((s) => { const b = document.querySelector(s); return b.scrollHeight > b.clientHeight; }, SEL);
  const setTop = () => app.page.evaluate((s) => { const b = document.querySelector(s); b.scrollTop = 150; return b.scrollTop; }, SEL);
  const top = () => app.page.evaluate((s) => document.querySelector(s).scrollTop, SEL);

  expect(await scrollable(), 'ต้องเลื่อนได้ ไม่งั้นเทสนี้ไม่ได้ตรวจอะไร').toBe(true);
  expect(await setTop()).toBeGreaterThan(0);
  const held = await top();

  // re-render อื่น (snapshot/แก้จำนวน/สแกน → renderTable) ไม่ดีดตำแหน่งเลื่อน
  await app.page.evaluate(() => { invalidatePopupRowsCache(); renderTable(); });
  expect(await top()).toBe(held);
  await app.page.evaluate(() => { clearTimeout(popupRenderTimer); renderPopupTable(); });
  expect(await top()).toBe(held);

  // ผู้ใช้กดเปลี่ยนหน้า → บนสุด (หน้า 1 → 2 เต็ม 20 แถวเท่ากัน — ถ้าไปหน้าที่มี 5 แถว เบราว์เซอร์ clamp เองจนเทสไม่ตรวจอะไร)
  await setTop();
  await app.page.evaluate(() => setPopupPage(2));
  expect(await top()).toBe(0);
  await setTop();
  await nav(app.page, 'prev');
  expect(await top()).toBe(0);

  // เปลี่ยนตัวกรอง (pass = P031–P040 ฯลฯ ใช้ "ทั้งหมด" เพื่อให้ยังเต็ม 20 แถว) → บนสุด
  await gotoPage(app.page, 2); await setTop();
  await click(app.page, '#popupStatusFilterRow .popup-filter[onclick*="\'all\'"]');
  await app.page.waitForFunction(() => _popupPage === 1 && _popupScrollTop === false, null, { polling: 100 });
  expect(await top()).toBe(0);

  // พิมพ์ค้นหา → บนสุด (ค้นหา 'สินค้า' ได้ทุกแถว = ยังเต็มหน้า)
  await gotoPage(app.page, 2); await setTop();
  await app.page.evaluate(() => { const el = document.getElementById('popupSearch'); el.value = 'สินค้า'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await app.page.waitForFunction(() => _popupPage === 1 && _popupScrollTop === false, null, { polling: 100 });
  expect(await top()).toBe(0);

  // เปิดป็อปอัพใหม่ → บนสุด
  await app.page.evaluate(() => { document.getElementById('popupSearch').value = ''; });
  await gotoPage(app.page, 2); await setTop();
  await app.page.evaluate(() => { openStockPopup(); });
  await app.page.waitForFunction(() => _popupPage === 1 && _popupScrollTop === false, null, { polling: 100 });
  expect(await top()).toBe(0);
  await closeApp(app);
});
