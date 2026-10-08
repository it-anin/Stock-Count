// R16.104 · WH — OTFI (ใบโอน) ต้องตามทิศจริงของ Col A + R16.103 ไม่นับแถวหน้าร้าน (ต.ค. 2026)
// OTFI ทุกแถวมี FSTOCKMAIN=-1 = "ตัดของออกจากคลังตาม Col A" · ฝั่งรับของเปลี่ยนตอนมีใบรับ (ITSW→ITFW) ไม่ใช่ตอน OTFI
//   Col A=0 (Warehouse โอนออก)  → สต็อกคลังลดจริง → บวกกลับเหมือนยอดขาย (เดิมหักเป็น "รับเข้า" ผิดทิศ)
//   Col A=1 (Front Store โอนออก) → ไม่กระทบสต็อกคลัง → ข้าม
// เคสจริง 7 ต.ค. 2026 (WH · Confirm แล้ว · ตัวเลขลงตัวเป๊ะ):
//   SKU 101378: ระบบ 250 · นับ 150 · OTFI คลังส่งออก 100 (13:13) + ขายหน้าร้าน 50 (12:59) → เดิม 150+50−100=100 → audit → รีเช็ค → Stock Adj −100 (ซ้ำกับที่ ERP ตัดไปแล้ว)
//   SKU 100865: ระบบ 510 · นับ 510 · OTFI หน้าร้านส่ง 2 (10:22) → เดิม 510−2=508 → audit
//   SKU 700129 (8 ต.ค.): OTFI คลังส่งออก 310 + ITFW หน้าร้านรับ 310 (R16.103) → เดิมหักล้างกันพอดีทั้งที่ควร +310
// ตรึง 3 ด้านคู่กัน: "WH ตามทิศ Col A" · **"Col A ว่าง/ค่าอื่นต้องเท่าเดิม (fail-open)"** · **"สาขาอื่น + OTFB/ORTS ต้องเท่าเดิมเป๊ะ"**
// + ⚠️ แถวที่ข้ามต้องยังอยู่ใน r16Data — ด่านวันที่/coverage อ่านช่วงเวลาจาก r16Data
const { test, expect, bootBare, closeApp } = require('../../lib/hooks');

const csv = (text) => ({ name: 'r16.csv', mimeType: 'text/csv', buffer: Buffer.from(text, 'utf8') });

// index ตรงกับ r16-wh-front-store.spec.js / SKILL-data-files
// 0=SYSWAREHOUSEID(Col A) 1=TRANDATE 2=TRANNO(Col C) 9=FCANCEL(Col J) 14=SCANCODE(Col O) 17=BASEQUANTITY(Col R) 23=ITEMID(Col X)
const HEAD = ['SYSWAREHOUSEID', 'TRANDATE', 'TRANNO', 'REFERENCENO1', 'SYSVOUCHERID', 'SYSSALEID',
  'TOTAL', 'TOTALVAT', 'GRANDTOTAL', 'FCANCEL', 'TAXRATE', 'SYSPERSONID', 'c12', 'c13',
  'SCANCODE', 'ITEMNAME', 'c16', 'BASEQUANTITY', 'c18', 'c19', 'c20', 'c21', 'c22', 'ITEMID'];

function row({ colA, tranNo, qty, at = '7/10/2026 13:13:03' }) {
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
    state.skuMap.set('S-1', { productName: 'ของทดสอบ', unitPrice: 10, systemQty: 250, barcodes: [{ barcode: 'B-1', unitMultiplier: 1 }] });
  }, branch);
}

// R16.104 — loadR16 ตั้ง r16DetailVersion ใหม่ทุกครั้งที่สำเร็จ · ด่านวันที่/coverage ทำงานแบบ synchronous ก่อนถึงจุดนี้
async function upload(page, text) {
  await page.evaluate(() => { state.r16DetailVersion = 'BEFORE'; });
  await page.setInputFiles('#fileR16', csv(text));
  await page.waitForFunction(() => state.r16DetailVersion !== 'BEFORE', null, { polling: 50 });
  return page.evaluate(() => ({
    sold: state.r16SalesMap.get('S-1') || 0,
    soldRaw: (state.r16RawMap.get('S-1') || []).map((x) => x.soldQty),
    inbound: state.r16InboundMap.get('S-1') || 0,
    inboundRaw: (state.r16InboundRawMap.get('S-1') || []).map((x) => x.qty),
    rows: state.r16Data.length,
    skippedOtfi: state.r16Data.filter((x) => x.skipWh === 'otfi').length,
    skippedSale: state.r16Data.filter((x) => x.skipWh === 'sale').length,
    otfiOut: state.r16Data.filter((x) => x.otfiOut).length,
    mismatch: state.r16DateMismatch,
    toasts: [...document.querySelectorAll('#toastContainer .toast')].map((t) => t.textContent),
  }));
}

// R16.103 — ⚠️ ของ WH: toast อยู่หลัง await (snapshot/publish) จึงตั้ง _db=null (publish คืนค่าทันที) แล้วรอ toast ขึ้นจริง
async function upload103(page, text) {
  await page.evaluate(() => { state.r16_103Loaded = false; _db = null; });
  await page.setInputFiles('#fileR16_103', csv(text));
  await page.waitForFunction(() => state.r16_103Loaded === true, null, { polling: 50 });
  await page.waitForFunction(() => /R16\.103:/.test(document.getElementById('toastContainer')?.textContent || ''), null, { polling: 50 });
  return page.evaluate(() => ({
    sum: state.r16_103Map.get('S-1') || 0,
    raw: (state.r16_103RawMap.get('S-1') || []).map((x) => x.qty),
    toasts: [...document.querySelectorAll('#toastContainer .toast')].map((t) => t.textContent),
  }));
}

// ยอดที่ Confirm ใช้ตัดสิน ณ เวลาสแกน = นับ + ขาย(รวม OTFI ออก) + R16.103 − รับเข้า (ฟังก์ชันจริงของแอป)
const effective = (page, counted, ts) => page.evaluate(({ counted, ts }) =>
  counted + getSoldQtyBefore('S-1', ts) + getR16103QtyBefore('S-1', ts) - getInboundQtyBefore('S-1', ts), { counted, ts });

test('ค่าเริ่มต้นที่ส่งมอบ — สวิตช์ OTFI เปิด (อ่านจากหน้าที่เพิ่งบูต ไม่ผ่าน seed)', async ({ browser }) => {
  const app = await bootBare(browser);
  expect(await app.page.evaluate(() => typeof WH_R16_OTFI_OUT)).toBe('boolean');
  expect(await app.page.evaluate(() => WH_R16_OTFI_OUT)).toBe(true);
  expect(await app.page.evaluate(() => WH_R16_SKIP_FRONT_STORE)).toBe(true);
  await closeApp(app);
});

test('WH — OTFI Col A=0 (คลังโอนออก) บวกกลับเหมือนยอดขาย · ไม่หักเป็นรับเข้า · กรองตามเวลาสแกน', async ({ browser }) => {
  const app = await bootBare(browser);
  await seedCatalog(app.page, 'WH');

  const out = await upload(app.page, toCsv([
    row({ colA: '0', tranNo: 'OTFI261000096', qty: 100, at: '7/10/2026 13:13:03' }),
    row({ colA: '0', tranNo: 'ORCMBY001', qty: 2, at: '7/10/2026 10:00:00' }),
  ]));

  expect(out.sold).toBe(102);                // 100 (OTFI ออก) + 2 · ถ้าได้ 2 = ด่านไม่ทำงาน
  expect(out.soldRaw).toEqual([100, 2]);     // อยู่ใน timeline ที่ใช้กรองตามเวลาสแกน
  expect(out.inbound).toBe(0);               // ถ้าได้ 100 = ยังหักเป็นรับเข้า (บั๊กเดิม)
  expect(out.otfiOut).toBe(1);
  expect(out.toasts.join('|')).toContain('OTFI คลังโอนออก 1 แถว (Col A=0) บวกกลับ');

  // สแกนก่อนเวลาใบโอน = ไม่กระทบ (900222/900024 วันที่ 7 ต.ค.) · หลังเวลาใบ = บวกกลับเต็มจำนวน
  expect(await app.page.evaluate(() => getSoldQtyBefore('S-1', '2026-10-07 12:00:00'))).toBe(2);
  expect(await app.page.evaluate(() => getSoldQtyBefore('S-1', '2026-10-07 14:00:00'))).toBe(102);
  expect(await app.page.evaluate(() => getInboundQtyBefore('S-1', '2026-10-07 14:00:00'))).toBe(0);
  await closeApp(app);
});

test('WH — OTFI Col A=1 (หน้าร้านโอนออก) ถูกข้าม · ไม่เข้า sales/inbound · แถวยังอยู่ใน r16Data', async ({ browser }) => {
  const app = await bootBare(browser);
  await seedCatalog(app.page, 'WH');

  const out = await upload(app.page, toCsv([
    row({ colA: '1', tranNo: 'OTFI261000094', qty: 1, at: '7/10/2026 10:22:21' }),
    row({ colA: '1', tranNo: 'OTFI261000094', qty: 1, at: '7/10/2026 10:22:21' }),
    row({ colA: '0', tranNo: 'ORCMBY001', qty: 3, at: '7/10/2026 09:00:00' }),
  ]));

  expect(out.inbound).toBe(0);               // ถ้าได้ 2 = ยังหักเป็นรับเข้า (บั๊กเดิม)
  expect(out.sold).toBe(3);                  // มีแต่ขายจากคลัง · OTFI หน้าร้านไม่ถูกบวกกลับ
  expect(out.rows).toBe(3);                  // แถวที่ข้ามยังอยู่ใน r16Data (ด่านวันที่/coverage ใช้)
  expect(out.skippedOtfi).toBe(2);
  expect(out.toasts.join('|')).toContain('ข้ามหน้าร้านโอนออก 2 แถว (Col A=1)');
  await closeApp(app);
});

test('WH — Col A ว่าง/ค่าอื่น ต้องหักเป็นรับเข้าเหมือนเดิม (fail-open · ห้ามเป็น "เก็บเฉพาะ 0/1")', async ({ browser }) => {
  const app = await bootBare(browser);
  await seedCatalog(app.page, 'WH');

  const out = await upload(app.page, toCsv([
    row({ colA: '', tranNo: 'OTFI260900001', qty: 2 }),    // export ไม่ใส่ค่า
    row({ colA: '2', tranNo: 'OTFI260900002', qty: 4 }),   // รหัสคลังอื่น
    row({ colA: '10', tranNo: 'OTFI260900003', qty: 8 }),  // ขึ้นต้นด้วย 1 แต่ไม่ใช่ 1 / ไม่ใช่ 0 — ห้าม match
  ]));

  expect(out.inbound).toBe(14);              // ครบทุกแถวเหมือนเดิม · ถ้าได้ 0 = มีคนเปลี่ยนเป็น fail-closed
  expect(out.inboundRaw).toEqual([2, 4, 8]);
  expect(out.sold).toBe(0);
  expect(out.skippedOtfi).toBe(0);
  expect(out.otfiOut).toBe(0);
  await closeApp(app);
});

test('WH — OTFB/ORTS ไม่ถูกกระทบ (inbound เหมือนเดิมทุก Col A) · ยังไม่มีตัวอย่างที่นับแล้วให้ยืนยันทิศ', async ({ browser }) => {
  const app = await bootBare(browser);
  await seedCatalog(app.page, 'WH');

  const out = await upload(app.page, toCsv([
    row({ colA: '0', tranNo: 'OTFB261000053', qty: 5 }),
    row({ colA: '1', tranNo: 'OTFB261000054', qty: 3 }),
    row({ colA: '1', tranNo: 'ORTS260900001', qty: 4 }),
    row({ colA: '0', tranNo: 'ORTS260900002', qty: 2 }),
  ]));

  expect(out.inbound).toBe(14);              // 5+3+4+2 ครบ
  expect(out.sold).toBe(0);
  expect(out.skippedOtfi).toBe(0);
  expect(out.toasts.join('|')).not.toContain('OTFI คลังโอนออก');
  await closeApp(app);
});

test('SRC/KKL/SSS — OTFI เท่าเดิมเป๊ะ (ด่านนี้ใช้กับ WH เท่านั้น)', async ({ browser }) => {
  // SRC: Col A=0 (คลังชากค้อโอนออก) ข้าม · Col A=1 บวกกลับ · KKL/SSS: Col A=0 หักเป็นรับเข้า · Col A=1 บวกกลับ
  const expected = {
    SRC: { sold: 2, inbound: 3 },            // OTFI A=1 → ขาย 2 · inbound = ORTS 3 (OTFB A=0 + OTFI A=0 ข้าม)
    KKL: { sold: 2, inbound: 8 },            // OTFI A=0 (1) + ORTS (3) + OTFB (4)
    SSS: { sold: 2, inbound: 8 },
  };
  for (const branch of ['SRC', 'KKL', 'SSS']) {
    const app = await bootBare(browser);
    await seedCatalog(app.page, branch);

    const out = await upload(app.page, toCsv([
      row({ colA: '0', tranNo: 'OTFI260900001', qty: 1 }),
      row({ colA: '1', tranNo: 'OTFI260900002', qty: 2 }),
      row({ colA: '1', tranNo: 'ORTS260900001', qty: 3 }),
      row({ colA: '0', tranNo: 'OTFB260900001', qty: 4 }),
    ]));

    expect(out.sold, branch).toBe(expected[branch].sold);
    expect(out.inbound, branch).toBe(expected[branch].inbound);
    expect(out.skippedOtfi + out.skippedSale + out.otfiOut, branch).toBe(0);
    expect(out.toasts.join('|'), branch).not.toContain('OTFI คลังโอนออก');
    await closeApp(app);
  }
});

test('สวิตช์ — แยกถอยได้ทีละกติกา (OUT ปิด / SKIP ปิด / ปิดทั้งคู่ = พฤติกรรมก่อนแก้)', async ({ browser }) => {
  const FILE = toCsv([
    row({ colA: '0', tranNo: 'OTFI260900001', qty: 3 }),   // คลังโอนออก
    row({ colA: '1', tranNo: 'OTFI260900002', qty: 2 }),   // หน้าร้านโอนออก
  ]);
  const cases = [
    { name: 'OUT ปิด',  out: false, skip: true,  sold: 0, inbound: 3 },   // Col A=0 หักเหมือนเดิม · Col A=1 ยังถูกข้าม
    { name: 'SKIP ปิด', out: true,  skip: false, sold: 3, inbound: 2 },   // Col A=0 บวกกลับ · Col A=1 หักเหมือนเดิม
    { name: 'ปิดทั้งคู่', out: false, skip: false, sold: 0, inbound: 5 },  // = ก่อนแก้ทุกตัว
  ];
  for (const c of cases) {
    const app = await bootBare(browser);
    await seedCatalog(app.page, 'WH');
    await app.page.evaluate(({ out, skip }) => { WH_R16_OTFI_OUT = out; WH_R16_SKIP_FRONT_STORE = skip; }, c);

    const got = await upload(app.page, FILE);
    expect(got.sold, c.name).toBe(c.sold);
    expect(got.inbound, c.name).toBe(c.inbound);
    await closeApp(app);
  }
});

test('เล่นซ้ำเคสจริง 7–8 ต.ค. — 101378 / 100865 / 700129 ต้องลงตัว (pass)', async ({ browser }) => {
  // 101378: ระบบ 250 · นับ 150 (คลังส่งออก 100 ตอน 13:13) · ขายหน้าร้าน 50 ตอน 12:59 + 3 ตอน 16:54 · สแกน 14:00
  let app = await bootBare(browser);
  await seedCatalog(app.page, 'WH');
  await upload(app.page, toCsv([
    row({ colA: '1', tranNo: 'ORCMBY001261001999', qty: 50, at: '7/10/2026 12:59:22' }),
    row({ colA: '0', tranNo: 'OTFI261000096', qty: 100, at: '7/10/2026 13:13:03' }),
    row({ colA: '1', tranNo: 'ORCMBY001261002092', qty: 3, at: '7/10/2026 16:54:23' }),
  ]));
  expect(await effective(app.page, 150, '2026-10-07 14:00:00')).toBe(250);   // เดิม 100 (diff −150)
  await closeApp(app);

  // 100865: ระบบ 510 · นับ 510 · หน้าร้านโอนออก 1+1 ตอน 10:22 · สแกน 11:00
  app = await bootBare(browser);
  await seedCatalog(app.page, 'WH');
  await upload(app.page, toCsv([
    row({ colA: '1', tranNo: 'OTFI261000094', qty: 1, at: '7/10/2026 10:22:21' }),
    row({ colA: '1', tranNo: 'OTFI261000094', qty: 1, at: '7/10/2026 10:22:21' }),
  ]));
  expect(await effective(app.page, 510, '2026-10-07 11:00:00')).toBe(510);   // เดิม 508 (diff −2)
  await closeApp(app);

  // 700129: ระบบ 400 · คลังโอนออก 310 (R16.104 · 14:30) + ITFW หน้าร้านรับ 310 (R16.103 · 15:02) · นับ 90 ตอน 16:00
  app = await bootBare(browser);
  await seedCatalog(app.page, 'WH');
  await upload(app.page, toCsv([row({ colA: '0', tranNo: 'OTFI261000120', qty: 310, at: '8/10/2026 14:30:00' })]));
  await upload103(app.page, toCsv([row({ colA: '1', tranNo: 'ITFW261000100', qty: 310, at: '8/10/2026 15:02:28' })]));
  expect(await effective(app.page, 90, '2026-10-08 16:00:00')).toBe(400);    // เดิม 90−310+310=90 (diff −310)
  await closeApp(app);
});

test('WH — coverage: แถว OTFI หน้าร้านที่ลงเวลาหลังแถวคลังล่าสุดต้องไม่ทำให้ช่วงของไฟล์หด (ไม่เตือนผิด)', async ({ browser }) => {
  const app = await bootBare(browser);
  await seedCatalog(app.page, 'WH');
  // สินค้านับเมื่อ 15:00 · ไฟล์: ขายคลัง 10:00 + OTFI หน้าร้าน 16:00 — ถ้าตัดแถว OTFI ก่อน push เข้า r16Data ช่วงจะหดเหลือ 10:00
  await app.page.evaluate(() => {
    state.scanData.set('S-1', { countedQty: 5, status: 'scanning', timestamp: '2026-10-07 15:00:00', firstScanAt: '2026-10-07 15:00:00', scannedBy: 'X', auditor: '', scans: [] });
  });

  const out = await upload(app.page, toCsv([
    row({ colA: '0', tranNo: 'ORCMBY001', qty: 2, at: '7/10/2026 10:00:00' }),
    row({ colA: '1', tranNo: 'OTFI261000097', qty: 1, at: '7/10/2026 16:00:00' }),
  ]));

  expect(out.skippedOtfi).toBe(1);           // ข้ามจริง
  expect(out.mismatch).toBe(false);          // แต่ช่วงเวลาของไฟล์ยังครอบถึง 16:00
  expect(out.toasts.join('|')).not.toContain('R16 มีข้อมูลถึง');
  await closeApp(app);
});

test('R16.103 WH — แถว Col A=1 (หน้าร้าน เช่น ITFW) ถูกข้าม · Col A=0/ว่างยังนับ · บอกจำนวนที่ข้าม', async ({ browser }) => {
  const app = await bootBare(browser);
  await seedCatalog(app.page, 'WH');

  const out = await upload103(app.page, toCsv([
    row({ colA: '0', tranNo: 'IPOS261000174', qty: 11, at: '8/10/2026 11:06:49' }),
    row({ colA: '1', tranNo: 'ITFW261000100', qty: 310, at: '8/10/2026 15:02:28' }),
    row({ colA: '', tranNo: 'IPOS261000175', qty: 5, at: '8/10/2026 12:25:54' }),   // ว่าง = นับเหมือนเดิม (fail-open)
  ]));

  expect(out.sum).toBe(16);                  // 11+5 · ถ้าได้ 326 = ด่านไม่ทำงาน
  expect(out.raw).toEqual([11, 5]);
  const toasts = out.toasts.join('|');
  expect(toasts).toContain('R16.103: ข้ามรายการหน้าร้าน 1 แถว (Col A=1)');
  expect(toasts).toContain('จับคู่ได้ 2 SKU / 16 ชิ้น');   // ไม่นับแถวที่ข้าม
  await closeApp(app);
});

test('R16.103 — สาขาอื่น/สวิตช์ปิด นับทุกแถวเหมือนเดิม · ไฟล์ที่มีแต่ Col A=1 ต้องไม่ขึ้น "จับคู่ไม่ได้"', async ({ browser }) => {
  const FILE = toCsv([
    row({ colA: '0', tranNo: 'IPOS261000174', qty: 11, at: '8/10/2026 11:06:49' }),
    row({ colA: '1', tranNo: 'ITFW261000100', qty: 310, at: '8/10/2026 15:02:28' }),
  ]);

  let app = await bootBare(browser);                      // สาขาอื่น (loader เดียวกัน แต่ด่านเฉพาะ WH)
  await seedCatalog(app.page, 'SRC');
  let out = await upload103(app.page, FILE);
  expect(out.sum).toBe(321);
  expect(out.toasts.join('|')).not.toContain('ข้ามรายการหน้าร้าน');
  await closeApp(app);

  app = await bootBare(browser);                          // WH + สวิตช์ปิด = ก่อนแก้
  await seedCatalog(app.page, 'WH');
  await app.page.evaluate(() => { WH_R16_SKIP_FRONT_STORE = false; });
  out = await upload103(app.page, FILE);
  expect(out.sum).toBe(321);
  await closeApp(app);

  app = await bootBare(browser);                          // WH + ไฟล์มีแต่หน้าร้าน
  await seedCatalog(app.page, 'WH');
  out = await upload103(app.page, toCsv([row({ colA: '1', tranNo: 'ITFW261000100', qty: 310, at: '8/10/2026 15:02:28' })]));
  expect(out.sum).toBe(0);
  const toasts = out.toasts.join('|');
  expect(toasts).toContain('ข้ามรายการหน้าร้าน 1 แถว');
  expect(toasts).not.toContain('ไม่สามารถจับคู่');
  await closeApp(app);
});
