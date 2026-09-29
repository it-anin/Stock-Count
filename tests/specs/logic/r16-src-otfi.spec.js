// R16.104 · SRC OTFI Col A=0 — คลังชากค้อโอนออก ต้องไม่ถูกหักเป็น "รับเข้า" ของหน้าร้าน (ก.ย. 2026)
// Col A = SYSWAREHOUSEID · SRC: 0=Warehouse (คลังชากค้อ) / 1=Front Store · OTFI ทุกแถวมี FSTOCKMAIN=-1 (ตัดออกจากคลังตาม Col A)
// เคสจริง 28 ก.ย. 2026 SKU 900202: นับ 2 · ระบบ 2 · OTFI คลังโอนออก 1 → เดิมได้ 2−1=1≠2 → Stock Adjustment ทั้งที่นับถูก
// (วันนั้นโดน 14/16 รายการ · ยืนยันกับยอดปลายวัน: 11/12 SKU หน้าร้านไม่ขยับตาม OTFI จากคลัง)
// ตรึง 2 ด้านคู่กัน: "SRC ต้องข้าม" และ **"KKL ต้องได้ผลเท่าเดิมเป๊ะ"** — Col A=0 ของ KKL/SSS คือตัวร้านเอง ความหมายยังไม่ได้ยืนยัน
const { test, expect, bootBare, closeApp } = require('../../lib/hooks');

const csv = (text) => ({ name: 'r16.csv', mimeType: 'text/csv', buffer: Buffer.from(text, 'utf8') });

// index ตรงกับ r16-cancel-filter.spec.js / SKILL-data-files
// 0=SYSWAREHOUSEID(Col A) 1=TRANDATE 2=TRANNO(Col C) 9=FCANCEL(Col J) 14=SCANCODE(Col O) 17=BASEQUANTITY(Col R) 23=ITEMID(Col X)
const HEAD = ['SYSWAREHOUSEID', 'TRANDATE', 'TRANNO', 'REFERENCENO1', 'SYSVOUCHERID', 'SYSSALEID',
  'TOTAL', 'TOTALVAT', 'GRANDTOTAL', 'FCANCEL', 'TAXRATE', 'SYSPERSONID', 'c12', 'c13',
  'SCANCODE', 'ITEMNAME', 'c16', 'BASEQUANTITY', 'c18', 'c19', 'c20', 'c21', 'c22', 'ITEMID'];

function row({ colA, tranNo, qty, at = '28/9/2026 13:40' }) {
  const r = new Array(24).fill('');
  r[0] = colA; r[1] = at; r[2] = tranNo; r[9] = '0';
  r[14] = 'B-1'; r[17] = String(qty); r[23] = 'S-1';
  return r;
}
const toCsv = (rows) => [HEAD, ...rows].map((r) => r.join(',')).join('\r\n');

// ไฟล์เดียวกันใช้ทุกเทส — แต่ละแถวใช้จำนวนไม่ซ้ำกัน จะได้อ่านออกว่าแถวไหนถูกนับไปทางไหน
const MIXED = toCsv([
  row({ colA: '0', tranNo: 'OTFI260900279', qty: 1 }),   // คลังชากค้อโอนออก
  row({ colA: '1', tranNo: 'OTFI260900272', qty: 2 }),   // หน้าร้านโอนออก
  row({ colA: '1', tranNo: 'ORTS260900001', qty: 3 }),   // หน้าร้านรับเข้า
  row({ colA: '0', tranNo: 'OTFB260900001', qty: 4 }),   // คลังส่งสาขาอื่น
]);

async function seedCatalog(page, branch) {
  await page.evaluate((b) => {
    currentBranch = b; currentRole = 'pharmacist'; currentUser = 'Pharm';
    _r01BaselineAt = '';   // ไม่ให้ _isPreBaselineItem ทำให้สูตรข้าม R16
    state.barcodeMap.clear(); state.skuMap.clear();
    state.barcodeMap.set('B-1', 'S-1');
    state.skuMap.set('S-1', { productName: 'ของทดสอบ', unitPrice: 10, systemQty: 2, barcodes: [{ barcode: 'B-1', unitMultiplier: 1 }] });
  }, branch);
}

async function upload(page, text) {
  await page.evaluate(() => { state.r16DetailVersion = 'BEFORE'; });
  await page.setInputFiles('#fileR16', csv(text));
  await page.waitForFunction(() => state.r16DetailVersion !== 'BEFORE', null, { polling: 50 });
  return page.evaluate(() => ({
    sold: state.r16SalesMap.get('S-1') || 0,
    inbound: state.r16InboundMap.get('S-1') || 0,
    inboundRaw: (state.r16InboundRawMap.get('S-1') || []).map((x) => x.qty),
  }));
}

test('SRC — OTFI Col A=0 (คลังชากค้อโอนออก) ต้องถูกข้าม ไม่หักเป็นรับเข้า', async ({ browser }) => {
  const app = await bootBare(browser);
  await seedCatalog(app.page, 'SRC');

  const out = await upload(app.page, MIXED);

  expect(out.inbound).toBe(3);             // ORTS เท่านั้น · ถ้าได้ 4 = OTFI Col A=0 ถูกหักกลับมาอีก (บั๊กเดิม)
  expect(out.inboundRaw).toEqual([3]);     // timeline ที่ใช้กรองตามเวลาสแกนต้องไม่มีแถวคลังปน
  expect(out.sold).toBe(2);                // OTFI Col A=1 ยังบวกกลับเหมือนเดิม
  await closeApp(app);
});

test('SRC — เคส 900202: รีเช็ค 2 · ระบบ 2 · OTFI คลังโอนออก 1 → ต้องลงตัว (pass)', async ({ browser }) => {
  const app = await bootBare(browser);
  await seedCatalog(app.page, 'SRC');
  await upload(app.page, toCsv([row({ colA: '0', tranNo: 'OTFI260900279', qty: 1 })]));

  // เวลารีเช็คจริง 18:08 น. (หลังใบโอน 13:40) — ใช้ฟังก์ชันเดียวกับที่ confirmAuditVerifyItem เรียก
  const eff = await app.page.evaluate(() => getPharmacistAuditEffectiveQty('S-1', 2, '2026-09-28T11:08:20.578Z'));
  expect(eff.inboundQty).toBe(0);
  expect(eff.effectiveQty).toBe(2);        // = ระบบ 2 → pass · เดิมได้ 1 → Stock Adjustment
  await closeApp(app);
});

test('KKL — OTFI/OTFB ต้องได้ผลเท่าพฤติกรรมเดิมเป๊ะ (การแก้จำกัดเฉพาะ SRC)', async ({ browser }) => {
  const app = await bootBare(browser);
  await seedCatalog(app.page, 'KKL');

  const out = await upload(app.page, MIXED);

  // KKL ไม่มีข้อยกเว้นของ SRC: OTFI Col A=0 + ORTS + OTFB ทุกแถว = รับเข้า
  expect(out.inbound).toBe(1 + 3 + 4);
  expect(out.sold).toBe(2);
  await closeApp(app);
});
