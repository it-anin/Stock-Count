// R16.104 Col J (FCANCEL) — บิลที่ถูกยกเลิกต้องไม่ถูกนับเป็นยอดขาย
// เดิมไม่เคยอ่านคอลัมน์นี้ ⇒ soldQty พองเกินจริง → ของที่นับถูกต้องติด audit (ก.ย. 2026)
// ตรึง 2 ด้านคู่กัน: "J=1 ต้องหายไป" และ **"ไฟล์ที่ไม่มีคอลัมน์ J ต้องให้ผลเท่าเดิมเป๊ะ"**
// ด้านหลังสำคัญกว่า — ถ้าใครเปลี่ยนเป็น "เก็บเฉพาะ 0" ยอดขายจะเป็น 0 ทั้งไฟล์แล้ว audit ยกแผง
const { test, expect, bootBare, closeApp } = require('../../lib/hooks');

const csv = (text) => ({ name: 'r16.csv', mimeType: 'text/csv', buffer: Buffer.from(text, 'utf8') });

// หัวคอลัมน์ R16.104 เท่าที่ loadR16 อ่านจริง — index ต้องตรงกับ SKILL-data-files
// 0=SYSWAREHOUSEID(Col A) 1=TRANDATE 2=TRANNO(Col C) 9=FCANCEL(Col J) 14=SCANCODE(Col O) 17=BASEQUANTITY(Col R) 23=ITEMID(Col X)
const HEAD = ['SYSWAREHOUSEID', 'TRANDATE', 'TRANNO', 'REFERENCENO1', 'SYSVOUCHERID', 'SYSSALEID',
  'TOTAL', 'TOTALVAT', 'GRANDTOTAL', 'FCANCEL', 'TAXRATE', 'SYSPERSONID', 'c12', 'c13',
  'SCANCODE', 'ITEMNAME', 'c16', 'BASEQUANTITY', 'c18', 'c19', 'c20', 'c21', 'c22', 'ITEMID'];

// สร้างแถวขาย ORCM หนึ่งแถว · cancel = ค่าที่จะใส่ใน Col J
function saleRow({ qty, cancel = '0', barcode = 'B-1', sku = 'S-1' }) {
  const r = new Array(24).fill('');
  r[0] = '1'; r[1] = '21/6/2026 11:44:06'; r[2] = 'ORCMBY001260606295';
  r[9] = cancel; r[14] = barcode; r[17] = String(qty); r[23] = sku;
  return r;
}
const toCsv = (rows) => [HEAD, ...rows].map((r) => r.join(',')).join('\r\n');

// ยัด catalog ขั้นต่ำที่ loadR16 ต้องใช้ (barcodeMap กัน early-return · skuMap ใช้ยืนยัน SKU)
async function seedCatalog(page) {
  await page.evaluate(() => {
    state.barcodeMap.clear(); state.skuMap.clear();
    state.barcodeMap.set('B-1', 'S-1');
    state.skuMap.set('S-1', { productName: 'ของทดสอบ', unitPrice: 10, systemQty: 100, barcodes: [{ barcode: 'B-1', unitMultiplier: 1 }] });
  });
}

// อัปไฟล์แล้วรอ parse จบ — loadR16 ตั้ง r16DetailVersion ใหม่ทุกครั้งที่สำเร็จ
async function upload(page, text) {
  await page.evaluate(() => { state.r16DetailVersion = 'BEFORE'; });
  await page.setInputFiles('#fileR16', csv(text));
  await page.waitForFunction(() => state.r16DetailVersion !== 'BEFORE', null, { polling: 50 });
  return page.evaluate(() => ({
    sold: state.r16SalesMap.get('S-1') || 0,
    rawCount: (state.r16RawMap.get('S-1') || []).length,
    rows: state.r16Data.length,
  }));
}

test('Col J — บิลยกเลิก (J=1) ต้องไม่ถูกนับเป็นยอดขาย', async ({ browser }) => {
  const app = await bootBare(browser);
  await seedCatalog(app.page);

  const out = await upload(app.page, toCsv([
    saleRow({ qty: 2, cancel: '0' }),   // ขายจริง → นับ
    saleRow({ qty: 5, cancel: '1' }),   // ยกเลิก → ต้องหาย
    saleRow({ qty: 3, cancel: '0' }),   // ขายจริง → นับ
    saleRow({ qty: 9, cancel: '1' }),   // ยกเลิก → ต้องหาย
  ]));

  expect(out.sold).toBe(5);       // 2+3 เท่านั้น · ถ้าเป็น 19 = ด่านไม่ทำงาน
  expect(out.rawCount).toBe(2);   // timeline ต้องไม่มีแถวที่ยกเลิกปนด้วย
  expect(out.rows).toBe(2);       // ถูกตัดตั้งแต่ก่อน push เข้า r16Data
  await closeApp(app);
});

test('Col J — ไฟล์ที่ไม่มีคอลัมน์ J ต้องให้ผลเท่าพฤติกรรมเดิมเป๊ะ', async ({ browser }) => {
  const app = await bootBare(browser);
  await seedCatalog(app.page);

  // ⚠️ ด่านนี้คือเหตุผลที่ต้องเช็ค "เท่ากับ 1" ไม่ใช่ "เก็บเฉพาะ 0"
  // แถวสั้นกว่า / ค่าว่าง / ค่าที่ไม่ใช่ 1 ทั้งหมดต้องถูกนับตามปกติ
  const out = await upload(app.page, toCsv([
    saleRow({ qty: 2, cancel: '' }),     // export ไม่ใส่ค่า
    saleRow({ qty: 3, cancel: '0' }),
    saleRow({ qty: 4, cancel: '10' }),   // ขึ้นต้นด้วย 1 แต่ไม่ใช่ 1 — ห้าม match
  ]));

  expect(out.sold).toBe(9);       // ครบทุกแถว · ถ้าได้ 0 แปลว่ามีคนเปลี่ยนเป็น "เก็บเฉพาะ 0" แล้ว
  expect(out.rawCount).toBe(3);
  await closeApp(app);
});

test('Col J — ไม่กรองยอดขายของ R16.103 (คนละรายงาน)', async ({ browser }) => {
  const app = await bootBare(browser);
  await seedCatalog(app.page);

  // R16.103 ใช้ prefix คนละชุด และตั้งใจไม่ใส่ด่าน Col J (ยังไม่ยืนยันว่าไฟล์จริงมีคอลัมน์นี้)
  // ถ้าวันหนึ่งมีคนไปใส่ด่านใน loadR16_103 ด้วย เทสนี้จะล้มให้เห็น แล้วค่อยตัดสินใจกันใหม่
  const rows = [saleRow({ qty: 7, cancel: '1' })];
  rows[0][2] = 'IRNC-0001';   // เปลี่ยนเป็น prefix ของ R16.103
  await app.page.setInputFiles('#fileR16_103', csv(toCsv(rows)));
  await app.page.waitForFunction(() => state.r16_103Loaded === true, null, { polling: 50 });

  const got = await app.page.evaluate(() => state.r16_103Map.get('S-1') || 0);
  expect(got).toBe(7);   // ยังนับเต็ม — ขอบเขตของการแก้รอบนี้คือ R16.104 อย่างเดียว
  await closeApp(app);
});
