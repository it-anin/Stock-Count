// R05 ขึ้น cloud เป็น array-of-arrays เพราะ object form ทำให้ 10,600 บาร์โค้ดชนเพดาน 1 MiB
// (ของจริงเคยขึ้น 1,069 KB แล้ว Firestore ปฏิเสธเงียบๆ — listener ดึงของเก่ากลับมาทับ)
const { test, expect, bootBare, closeApp } = require('../../lib/hooks');

test('_serializeR05 / _parseR05Json — round-trip keeps every field', async ({ browser }) => {
  const app = await bootBare(browser);
  const out = await app.page.evaluate(() => {
    const rows = [
      { barcode: 'B1', colE: 'S1', unitName: 'กล่อง', unitMultiplier: 12, unitPrice: 1500 },
      { barcode: 'B2', colE: 'S1', unitName: 'TAB', unitMultiplier: 1, unitPrice: 0 },
      { barcode: 'B3', colE: 'S2', unitName: '', unitMultiplier: 1, unitPrice: null },
    ];
    return { json: _serializeR05(rows), parsed: _parseR05Json(_serializeR05(rows)) };
  });
  expect(out.json.startsWith('[[')).toBe(true);          // compact form, not objects
  expect(out.json).not.toContain('unitMultiplier');      // field names must not be repeated per row
  expect(out.parsed).toEqual([
    { barcode: 'B1', colE: 'S1', unitName: 'กล่อง', unitMultiplier: 12, unitPrice: 1500 },
    { barcode: 'B2', colE: 'S1', unitName: 'TAB', unitMultiplier: 1, unitPrice: 0 },
    { barcode: 'B3', colE: 'S2', unitName: '', unitMultiplier: 1, unitPrice: null },
  ]);
  await closeApp(app);
});

test('_parseR05Json — still reads the legacy object form written before the compact cutover', async ({ browser }) => {
  const app = await bootBare(browser);
  const out = await app.page.evaluate(() => _parseR05Json(JSON.stringify([
    { barcode: 'B1', colE: 'S1', unitName: 'TAB', unitMultiplier: 1 },            // pre-price doc
    { barcode: 'B2', colE: 'S2', unitName: 'BOX', unitMultiplier: 6, unitPrice: 900 },
    { barcode: '', colE: 'S3', unitName: 'X', unitMultiplier: 1 },                 // junk row dropped
  ])));
  expect(out).toEqual([
    { barcode: 'B1', colE: 'S1', unitName: 'TAB', unitMultiplier: 1, unitPrice: null }, // no price → gated
    { barcode: 'B2', colE: 'S2', unitName: 'BOX', unitMultiplier: 6, unitPrice: 900 },
  ]);
  await closeApp(app);
});

// บอท auto-r05 เขียน global_r05 ทุกเช้าด้วย serialize_r05() ฝั่ง Python ที่ต้องได้สตริง "เดียวกันทุกไบต์"
// ถ้าไม่ตรง: ด่าน "เนื้อหาเหมือนเดิมจึงไม่เขียน" ของบอทจะไม่มีวันเป็นจริง → เขียนซ้ำทุกเช้าโดยเปล่าประโยชน์
// และทุกเครื่องเด้ง toast "R05.106 อัปเดตจากเครื่องอื่น" พร้อม rebuildMaps() ทุกวัน
//
// เทสนี้ตรึง "รูปแบบไบต์" ไว้เพราะ tools/check-r05-parity.js ต้องใช้ไฟล์ CSV จริงซึ่งไม่มีใน repo
// จึงไม่มีทางรันอัตโนมัติได้ · ตัวนี้จับได้ตั้งแต่ตอนแก้ index.html โดยไม่ต้องมีไฟล์อะไรเลย
// แก้เทสนี้ให้ผ่านเฉยๆ ไม่ได้ — ต้องแก้ auto-r05/auto_r05_import.py ให้ตรงกันด้วยเสมอ
test('_serializeR05 — รูปแบบไบต์ที่ auto-r05 ฝั่ง Python ต้องผลิตให้ตรง', async ({ browser }) => {
  const app = await bootBare(browser);
  const json = await app.page.evaluate(() => _serializeR05([
    { barcode: 'B1', colE: 'S1', unitName: 'กล่อง', unitMultiplier: 12, unitPrice: 1500 },
    { barcode: 'B2', colE: 'S2', unitName: '', unitMultiplier: 1.5, unitPrice: 0 },
    { barcode: 'B3', colE: 'S3', unitName: 'TAB', unitMultiplier: 1, unitPrice: null },
  ]));
  // ทุกอย่างในสตริงนี้เป็นกับดัก parity ที่เคยทำให้ Python เขียนต่างจาก JS:
  //   ไม่มีช่องว่างหลัง , และ :        → Python ต้องใส่ separators=(',',':')
  //   1500 ไม่ใช่ 1500.0 · 12 ไม่ใช่ 12.0 → Python ต้องแปลงเลขลงตัวเป็น int ก่อนเขียน
  //   1.5 ต้องคงเศษไว้                  → แปลงเป็น int แบบเหมารวมไม่ได้
  //   ราคา 0 ต้องเป็น 0 ไม่ใช่ ""        → เช็ค None ไม่ใช่เช็ค falsy
  //   ราคา null ต้องเป็น "" ไม่ใช่ null  → JSON.stringify(null) คนละอย่างกับ ''
  //   ภาษาไทยต้องเป็นตัวอักษรจริง       → Python ต้องใส่ ensure_ascii=False
  expect(json).toBe('[["B1","S1","กล่อง",12,1500],["B2","S2","",1.5,0],["B3","S3","TAB",1,""]]');
  await closeApp(app);
});

test('compact form is small enough for a real 10,600-barcode catalog', async ({ browser }) => {
  const app = await bootBare(browser);
  const out = await app.page.evaluate(() => {
    const rows = [];
    for (let i = 0; i < 10619; i++) {
      rows.push({ barcode: '88500000' + String(i).padStart(5, '0'), colE: String(100000 + i), unitName: 'กล่อง', unitMultiplier: 1, unitPrice: 72 });
    }
    const compact = _sessionBlobBytes(_serializeR05(rows));
    const legacy = _sessionBlobBytes(JSON.stringify(rows));
    return { compact, legacy, limit: SESSION_BLOB_LIMIT_BYTES };
  });
  expect(out.legacy).toBeGreaterThan(out.limit);   // ยืนยันว่ารูปแบบเดิมชนเพดานจริง
  expect(out.compact).toBeLessThan(out.limit * 0.7);
  await closeApp(app);
});
