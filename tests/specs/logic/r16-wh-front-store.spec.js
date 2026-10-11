// R16.104 · WH — ยอดขายหน้าร้าน (ORCM/OCTM ที่ Col A=1 = Front Store) ต้องไม่ถูกบวกกลับเข้ายอดของคลัง (ต.ค. 2026)
// Col A = SYSWAREHOUSEID · 0=Warehouse (คลังชากค้อ) / 1=Front Store · R01 ของ WH คือแถว Warehouse → ขายหน้าร้านไม่กระทบสต็อกคลัง
// เคสจริง 7 ต.ค. 2026 SKU 800082: นับ 39 = ระบบ 39 แต่ติด audit เพราะบิลขายหน้าร้าน (ORCM · Col A=1 · 08:24:40) 1 ชิ้นถูกบวกกลับ
// ไฟล์ R16.104 ของ "อนิน สาขาแยกชากค้อ" รวมสองคลังไว้ด้วยกัน — วันนั้นขาย 819 แถว: หน้าร้าน 794 / คลัง 25
// ตรึง 3 ด้านคู่กัน: "WH ข้าม Col A=1" · **"Col A ว่าง/ค่าอื่นต้องนับเหมือนเดิม (fail-open)"** · **"สาขาอื่นต้องได้ผลเท่าเดิมเป๊ะ"**
// + ⚠️ แถวที่ข้ามต้องยังอยู่ใน r16Data — ด่านวันที่/coverage อ่านช่วงเวลาจาก r16Data (ตัดก่อน push = เตือนผิด)
const { test, expect, bootBare, closeApp } = require('../../lib/hooks');

const csv = (text) => ({ name: 'r16.csv', mimeType: 'text/csv', buffer: Buffer.from(text, 'utf8') });

// index ตรงกับ r16-cancel-filter.spec.js / SKILL-data-files
// 0=SYSWAREHOUSEID(Col A) 1=TRANDATE 2=TRANNO(Col C) 9=FCANCEL(Col J) 14=SCANCODE(Col O) 17=BASEQUANTITY(Col R) 23=ITEMID(Col X)
const HEAD = ['SYSWAREHOUSEID', 'TRANDATE', 'TRANNO', 'REFERENCENO1', 'SYSVOUCHERID', 'SYSSALEID',
  'TOTAL', 'TOTALVAT', 'GRANDTOTAL', 'FCANCEL', 'TAXRATE', 'SYSPERSONID', 'c12', 'c13',
  'SCANCODE', 'ITEMNAME', 'c16', 'BASEQUANTITY', 'c18', 'c19', 'c20', 'c21', 'c22', 'ITEMID'];

function row({ colA, tranNo, qty, at = '7/10/2026 08:24:40' }) {
  const r = new Array(24).fill('');
  r[0] = colA; r[1] = at; r[2] = tranNo; r[9] = '0';
  r[14] = 'B-1'; r[17] = String(qty); r[23] = 'S-1';
  return r;
}
const toCsv = (rows) => [HEAD, ...rows].map((r) => r.join(',')).join('\r\n');

async function seedCatalog(page, branch) {
  await page.evaluate((b) => {
    currentBranch = b; currentRole = b === 'WH' ? 'supervisor' : 'pharmacist'; currentUser = 'Tester';
    _r01BaselineAt = '';   // ไม่ให้ _isPreBaselineItem ทำให้สูตรข้าม R16
    state.barcodeMap.clear(); state.skuMap.clear();
    state.barcodeMap.set('B-1', 'S-1');
    state.skuMap.set('S-1', { productName: 'ของทดสอบ', unitPrice: 10, systemQty: 39, barcodes: [{ barcode: 'B-1', unitMultiplier: 1 }] });
  }, branch);
}

// อัปไฟล์แล้วรอ parse จบ — loadR16 ตั้ง r16DetailVersion ใหม่ทุกครั้งที่สำเร็จ
// ด่านวันที่/coverage ทำงานแบบ synchronous ก่อนถึงจุดนี้ (ไม่มี await คั่น) จึงอ่าน r16DateMismatch ได้ทันที
async function upload(page, text) {
  await page.evaluate(() => { state.r16DetailVersion = 'BEFORE'; });
  await page.setInputFiles('#fileR16', csv(text));
  await page.waitForFunction(() => state.r16DetailVersion !== 'BEFORE', null, { polling: 50 });
  return page.evaluate(() => ({
    sold: state.r16SalesMap.get('S-1') || 0,
    soldRaw: (state.r16RawMap.get('S-1') || []).map((x) => x.soldQty),
    inbound: state.r16InboundMap.get('S-1') || 0,
    rows: state.r16Data.length,
    skipped: state.r16Data.filter((x) => x.skipWh).length,
    mismatch: state.r16DateMismatch,
    loaded: state.r16Loaded,
    toasts: [...document.querySelectorAll('#toastContainer .toast')].map((t) => t.textContent),
  }));
}

test('ค่าเริ่มต้นที่ส่งมอบ — สวิตช์เปิด (อ่านจากหน้าที่เพิ่งบูต ไม่ผ่าน seed)', async ({ browser }) => {
  const app = await bootBare(browser);
  expect(await app.page.evaluate(() => typeof WH_R16_SKIP_FRONT_STORE)).toBe('boolean');
  expect(await app.page.evaluate(() => WH_R16_SKIP_FRONT_STORE)).toBe(true);
  await closeApp(app);
});

test('WH — ORCM/OCTM Col A=1 (หน้าร้าน) ไม่ถูกบวกกลับ · Col A=0 (คลัง) ยังนับ', async ({ browser }) => {
  const app = await bootBare(browser);
  await seedCatalog(app.page, 'WH');

  const out = await upload(app.page, toCsv([
    row({ colA: '0', tranNo: 'ORCMBY001', qty: 2 }),   // ขายจากคลัง → นับ
    row({ colA: '1', tranNo: 'ORCMBY002', qty: 5 }),   // ขายหน้าร้าน → ข้าม
    row({ colA: '1', tranNo: 'OCTMBY003', qty: 7 }),   // OCTM หน้าร้าน → ข้าม
    row({ colA: '0', tranNo: 'OCTMBY004', qty: 3 }),   // OCTM คลัง → นับ
  ]));

  expect(out.sold).toBe(5);                  // 2+3 · ถ้าได้ 17 = ด่านไม่ทำงาน (บั๊กเดิม)
  expect(out.soldRaw).toEqual([2, 3]);       // timeline ที่ใช้กรองตามเวลาสแกนต้องไม่มีแถวหน้าร้านปน
  expect(out.rows).toBe(4);                  // แถวที่ข้ามต้องยังอยู่ใน r16Data (ด่านวันที่/coverage ใช้)
  expect(out.skipped).toBe(2);
  await closeApp(app);
});

test('WH — Col A ว่าง/ค่าอื่น ต้องนับเหมือนเดิม (fail-open · ห้ามเป็น "เก็บเฉพาะ 0")', async ({ browser }) => {
  const app = await bootBare(browser);
  await seedCatalog(app.page, 'WH');

  // ⚠️ ด่านนี้คือเหตุผลที่ต้องเช็ค "เท่ากับ '1'" ไม่ใช่ "ไม่เท่ากับ '0'"
  // ไฟล์ที่ไม่มี Col A / ส่งค่าว่าง / รหัสคลังอื่น จะถูกทิ้งเงียบๆ ทั้งไฟล์ถ้าเปลี่ยนเป็น fail-closed
  const out = await upload(app.page, toCsv([
    row({ colA: '', tranNo: 'ORCMBY001', qty: 2 }),    // export ไม่ใส่ค่า
    row({ colA: '2', tranNo: 'ORCMBY002', qty: 4 }),   // รหัสคลังอื่น
    row({ colA: '10', tranNo: 'ORCMBY003', qty: 8 }),  // ขึ้นต้นด้วย 1 แต่ไม่ใช่ 1 — ห้าม match
  ]));

  expect(out.sold).toBe(14);                 // ครบทุกแถว · ถ้าได้ 0 แปลว่ามีคนเปลี่ยนเป็น fail-closed แล้ว
  expect(out.soldRaw).toEqual([2, 4, 8]);
  expect(out.skipped).toBe(0);
  await closeApp(app);
});

test('SRC/KKL/SSS — ORCM Col A=1 และ 0 นับครบเหมือนเดิมเป๊ะ (ด่านนี้ใช้กับ WH เท่านั้น)', async ({ browser }) => {
  for (const branch of ['SRC', 'KKL', 'SSS']) {
    const app = await bootBare(browser);
    await seedCatalog(app.page, branch);

    const out = await upload(app.page, toCsv([
      row({ colA: '0', tranNo: 'ORCMBY001', qty: 2 }),
      row({ colA: '1', tranNo: 'ORCMBY002', qty: 3 }),
      row({ colA: '1', tranNo: 'OCTMBY003', qty: 4 }),
    ]));

    expect(out.sold, branch).toBe(9);        // ครบทุกแถวทุกสาขา
    expect(out.skipped, branch).toBe(0);
    expect(out.toasts.join('|'), branch).not.toContain('ข้ามยอดขายหน้าร้าน');
    await closeApp(app);
  }
});

// ⚠️ OTFI ของ WH ตามทิศ Col A แล้ว (8 ต.ค. 2026) — เทสของ OTFI อยู่ที่ r16-wh-transfer.spec.js · ที่นี่ตรึงเฉพาะ OTFB/ORTS ที่ยังไม่เปลี่ยน
test('WH — รับเข้า (OTFB/ORTS) ไม่ถูกกระทบ ทั้ง Col A=0 และ 1', async ({ browser }) => {
  const app = await bootBare(browser);
  await seedCatalog(app.page, 'WH');

  const out = await upload(app.page, toCsv([
    row({ colA: '1', tranNo: 'ORTS260900001', qty: 4 }),
    row({ colA: '0', tranNo: 'OTFB260900001', qty: 5 }),
    row({ colA: '1', tranNo: 'OTFB260900002', qty: 2 }),
    row({ colA: '0', tranNo: 'ORTS260900002', qty: 3 }),
  ]));

  expect(out.inbound).toBe(14);              // 4+5+2+3 · WH ไม่อ่าน Col A ของ OTFB/ORTS (พฤติกรรมเดิม)
  expect(out.sold).toBe(0);
  expect(out.skipped).toBe(0);
  await closeApp(app);
});

test('สวิตช์ปิด — WH นับ Col A=1 เหมือนก่อนแก้ · ไม่มี toast ข้ามแถว', async ({ browser }) => {
  const app = await bootBare(browser);
  await seedCatalog(app.page, 'WH');
  await app.page.evaluate(() => { WH_R16_SKIP_FRONT_STORE = false; });

  const out = await upload(app.page, toCsv([
    row({ colA: '0', tranNo: 'ORCMBY001', qty: 2 }),
    row({ colA: '1', tranNo: 'ORCMBY002', qty: 5 }),
  ]));

  expect(out.sold).toBe(7);                  // ทุกแถวเหมือนก่อนแก้
  expect(out.skipped).toBe(0);
  expect(out.toasts.join('|')).not.toContain('ข้ามยอดขายหน้าร้าน');
  await closeApp(app);
});

test('WH — บอกจำนวนแถวที่ข้าม (ไม่ให้หายเงียบ) · ไฟล์ที่มีแต่ขายหน้าร้านต้องไม่ขึ้น "จับคู่ไม่ได้"', async ({ browser }) => {
  const app = await bootBare(browser);
  await seedCatalog(app.page, 'WH');

  const out = await upload(app.page, toCsv([
    row({ colA: '1', tranNo: 'ORCMBY001', qty: 5 }),
    row({ colA: '1', tranNo: 'OCTMBY002', qty: 7 }),
  ]));

  expect(out.sold).toBe(0);
  expect(out.loaded).toBe(true);
  const toasts = out.toasts.join('|');
  expect(toasts).toContain('ข้ามยอดขายหน้าร้าน 2 แถว');
  // matched นับแถวที่ข้ามด้วย — ไม่งั้นวันที่คลังไม่มียอดขายเลยจะโดนข้อความ "R16.104 จับคู่ไม่ได้" ทั้งที่ไฟล์ถูกต้อง
  expect(toasts).not.toContain('จับคู่ไม่ได้');
  await closeApp(app);
});

test('WH — ด่านวันที่/coverage ยังเห็นช่วงเวลาของทั้งไฟล์ (แถวหน้าร้านที่ข้ามต้องไม่ทำให้ช่วงหด)', async ({ browser }) => {
  const app = await bootBare(browser);
  await seedCatalog(app.page, 'WH');
  // สินค้านับเมื่อ 15:00 · ไฟล์: ขายคลัง 10:00 (แถวคลังล่าสุด) + ขายหน้าร้าน 16:00 (หลังเวลานับ)
  // ถ้าแถวหน้าร้านถูกตัดก่อน push เข้า r16Data ช่วงที่ครอบจะหดเหลือ 10:00 → เตือน "R16 มีข้อมูลถึง 10:00 แต่มีสินค้าที่นับหลังจากนั้น"
  // แล้ว r16DateMismatch=true กั้น Confirm ผิดๆ
  await app.page.evaluate(() => {
    state.scanData.set('S-1', { countedQty: 5, status: 'scanning', timestamp: '2026-10-07 15:00:00', firstScanAt: '2026-10-07 15:00:00', scannedBy: 'X', auditor: '', scans: [] });
  });

  const out = await upload(app.page, toCsv([
    row({ colA: '0', tranNo: 'ORCMBY001', qty: 2, at: '7/10/2026 10:00:00' }),
    row({ colA: '1', tranNo: 'ORCMBY002', qty: 5, at: '7/10/2026 16:00:00' }),
  ]));

  expect(out.sold).toBe(2);                  // ข้ามหน้าร้านแล้วจริง
  expect(out.mismatch).toBe(false);          // แต่ช่วงเวลาของไฟล์ยังครอบถึง 16:00 → ไม่เตือน
  expect(out.toasts.join('|')).not.toContain('R16 มีข้อมูลถึง');
  await closeApp(app);
});

test('เคส SKU 800082 — ขายหน้าร้าน 08:24:40 ก่อนเวลานับ 09:23:45 ต้องไม่ทำให้ soldQty เป็น 1', async ({ browser }) => {
  const app = await bootBare(browser);
  await seedCatalog(app.page, 'WH');

  await upload(app.page, toCsv([
    row({ colA: '1', tranNo: 'ORCMBY001261001910', qty: 1, at: '7/10/2026 08:24:40' }),
  ]));

  // นับได้ 39 = ระบบ 39 · ยอดชดเชย R16 ที่ใช้ตัดสินตอน Confirm (getSoldQtyBefore) ต้องเป็น 0 → effective = 39 → pass
  const sold = await app.page.evaluate(() => getSoldQtyBefore('S-1', '2026-10-07 09:23:45'));
  expect(sold).toBe(0);
  expect(39 + sold).toBe(39);

  // เทียบกับพฤติกรรมเดิม: สวิตช์ปิดแล้วอัปไฟล์เดิมซ้ำ → soldQty=1 (effective=40 ≠ 39 → audit) ตามที่เกิดจริง
  await app.page.evaluate(() => { WH_R16_SKIP_FRONT_STORE = false; });
  await upload(app.page, toCsv([
    row({ colA: '1', tranNo: 'ORCMBY001261001910', qty: 1, at: '7/10/2026 08:24:40' }),
  ]));
  expect(await app.page.evaluate(() => getSoldQtyBefore('S-1', '2026-10-07 09:23:45'))).toBe(1);
  await closeApp(app);
});
