// R16.103 · WH — บวกกลับเฉพาะใบที่อยู่ใน R01 จริง (ต.ค. 2026 · ผู้ใช้สั่งตรวจกับไฟล์จริง ไม่เดา)
// สูตรเดิมบวกกลับ "ทุกแถว" ด้วยสมมติฐาน "อยู่ใน systemQty (R01) แต่พนักงานไม่ได้นับ" — ข้อมูล 7–14 ต.ค. ไม่รองรับ:
//   (1) IPOS มี FSTOCKMAIN=0 ทุกแถว (774/774 ในไฟล์ 14 วัน) = ไม่ตัด stock หลัก → ไม่เข้า R01 (ระบบ < ยอด IPOS ทุกบรรทัด)
//   (2) ไฟล์รายวันทุกแถวลงหลัง R01 07:31 (14/10: 134/134) → ใบที่ลงหลัง R01 ไม่อยู่ใน systemQty จึงไม่มีอะไรให้บวกกลับ
// ข้อแก้แยกสองสวิตช์:  WH_R16_103_SKIP_NO_STOCK (ตัดตอนโหลด)  ·  WH_R16_103_BEFORE_R01_ONLY (ตอนอ่านตามเวลา R01)
// ตรึง 3 ด้านคู่กัน: "ข้าม/ตัดตามกติกา" · **"fail-open: ไม่มีคอลัมน์/ว่าง/ค่าอื่น/r01Version ไม่ใช่เวลา = เท่าเดิมเป๊ะ"** · **"สาขาอื่น/สวิตช์ปิด = เท่าเดิม"**
// ★ replay 7 เคสจริงที่ติด audit ทั้งหมด (7–14 ต.ค.): ก่อนแก้ 0/7 ผ่าน → หลังแก้ 5/7 (อีก 2 = ของขึ้นชั้นแล้วแต่ใบลงหลัง R01 — ยังเป็น audit ตามแผน)
const fs = require('fs');
const { test, expect, bootBare, closeApp } = require('../../lib/hooks');

const csv = (text) => ({ name: 'r16_103.csv', mimeType: 'text/csv', buffer: Buffer.from(text, 'utf8') });

// index ตรงกับไฟล์จริง: 0=SYSWAREHOUSEID(Col A) 1=TRANDATE 2=TRANNO(Col C) 9=FCANCEL 14=SCANCODE 17=BASEQUANTITY 23=ITEMID 27=FSTOCKMAIN
const HEAD = ['SYSWAREHOUSEID', 'TRANDATE', 'TRANNO', 'REFERENCENO1', 'SYSVOUCHERID', 'SYSSALEID',
  'TOTAL', 'TOTALVAT', 'GRANDTOTAL', 'FCANCEL', 'TAXRATE', 'SYSPERSONID', 'SYSBRANCHID', 'FPROCESS',
  'SCANCODE', 'ITEMNAME', 'SYSUNITID', 'BASEQUANTITY', 'QUANTITY', 'SYSITEMID', 'PRICE', 'AMOUNT', 'DETAILNO',
  'ITEMID', 'ITEMNAME', 'TOTALTRADDISCHAVEVAT', 'TOTALTRADDISCNONEVAT', 'FSTOCKMAIN'];

const bcOf = (sku) => 'B-' + sku.replace(/^S-/, '');

// fsm = undefined → ไม่ใส่ค่า (ช่องว่าง) · fsmIdx = ตำแหน่งคอลัมน์ FSTOCKMAIN ในไฟล์นี้ (ทดสอบว่าหาตามชื่อ ไม่ใช่ตำแหน่ง)
function row({ colA = '0', tranNo, qty, at, fsm, sku = 'S-1', fsmIdx = 27, width = HEAD.length }) {
  const r = new Array(width).fill('');
  r[0] = colA; r[1] = at; r[2] = tranNo; r[9] = '0';
  r[14] = bcOf(sku); r[17] = String(qty); r[23] = sku;
  if (fsm !== undefined && fsmIdx < width) r[fsmIdx] = fsm;
  return r;
}
const toCsv = (rows, head = HEAD) => [head, ...rows].map((r) => r.join(',')).join('\r\n');
// หัวไฟล์ที่ไม่มี FSTOCKMAIN เลย (24 คอลัมน์ — แบบเดียวกับสเปก R16 เดิม)
const HEAD24 = HEAD.slice(0, 24);
// หัวไฟล์ที่ย้าย FSTOCKMAIN ไปคอลัมน์ 3 (ตรวจว่าหาตามชื่อ)
const HEAD_REORDER = HEAD.map((h, i) => (i === 3 ? 'FSTOCKMAIN' : i === 27 ? 'XTRA' : h));

async function seedCatalog(page, branch, skus /* {sku: systemQty} */) {
  await page.evaluate(({ b, skus }) => {
    currentBranch = b; currentRole = b === 'WH' ? 'supervisor' : 'pharmacist'; currentUser = 'Tester';
    _r01BaselineAt = '';   // ไม่ให้ _isPreBaselineItem ทำให้สูตรข้าม R16
    state.barcodeMap.clear(); state.skuMap.clear();
    for (const [sku, sys] of Object.entries(skus)) {
      const bc = 'B-' + sku.replace(/^S-/, '');
      state.barcodeMap.set(bc, sku);
      state.skuMap.set(sku, { productName: 'ของทดสอบ ' + sku, unitPrice: 10, systemQty: sys, barcodes: [{ barcode: bc, unitMultiplier: 1 }] });
    }
  }, { b: branch, skus });
}

// R16.103 — ⚠️ ของ WH: toast อยู่หลัง await (snapshot/publish) จึงตั้ง _db=null (publish คืนค่าทันที) แล้วรอ toast ขึ้นจริง
// ล้าง toast เก่าก่อนทุกครั้ง — อัปหลายรอบบนหน้าเดียวกันต้องไม่อ่านข้อความของรอบก่อน
async function upload103(page, text) {
  await page.evaluate(() => {
    state.r16_103Loaded = false; _db = null;
    const c = document.getElementById('toastContainer'); if (c) c.innerHTML = '';
  });
  await page.setInputFiles('#fileR16_103', csv(text));
  await page.waitForFunction(() => state.r16_103Loaded === true, null, { polling: 50 });
  await page.waitForFunction(() => /จับคู่/.test(document.getElementById('toastContainer')?.textContent || ''), null, { polling: 50 });
  return page.evaluate(() => ({
    map: Object.fromEntries(state.r16_103Map),
    raw: Object.fromEntries([...state.r16_103RawMap].map(([k, v]) => [k, v.map((x) => x.qty)])),
    toasts: [...document.querySelectorAll('#toastContainer .toast')].map((t) => t.textContent),
  }));
}

// ตั้งเวลา R01 จากเวลาท้องถิ่น (ไม่ขึ้นกับโซนเวลาของเครื่องที่รันเทส) แล้วคืนค่า ISO
const setR01Local = (page, y, mo, d, h, mi, s = 0) => page.evaluate(([y, mo, d, h, mi, s]) => {
  state.r01Version = new Date(y, mo - 1, d, h, mi, s).toISOString(); return state.r01Version;
}, [y, mo, d, h, mi, s]);

test('ค่าเริ่มต้นที่ส่งมอบ — สวิตช์ทั้งสองเปิด (อ่านจากหน้าที่เพิ่งบูต ไม่ผ่าน seed)', async ({ browser }) => {
  const app = await bootBare(browser);
  expect(await app.page.evaluate(() => typeof WH_R16_103_SKIP_NO_STOCK)).toBe('boolean');
  expect(await app.page.evaluate(() => WH_R16_103_SKIP_NO_STOCK)).toBe(true);
  expect(await app.page.evaluate(() => typeof WH_R16_103_BEFORE_R01_ONLY)).toBe('boolean');
  expect(await app.page.evaluate(() => WH_R16_103_BEFORE_R01_ONLY)).toBe(true);
  await closeApp(app);
});

test('WH — แถว FSTOCKMAIN=0 (IPOS) ถูกข้าม · ใบ +1 เข้าเหมือนเดิม · นับ matched · บอกจำนวนที่ข้าม', async ({ browser }) => {
  const app = await bootBare(browser);
  await seedCatalog(app.page, 'WH', { 'S-1': 250 });

  const out = await upload103(app.page, toCsv([
    row({ tranNo: 'IPOS261000200', qty: 320, at: '9/10/2026 09:47:00', fsm: '0' }),
    row({ tranNo: 'IRVC261000097', qty: 120, at: '9/10/2026 10:35:00', fsm: '1' }),
    row({ tranNo: 'ITFB261000005', qty: 5, at: '9/10/2026 10:36:00', fsm: '1' }),
  ]));

  expect(out.map['S-1']).toBe(125);          // 120+5 · ถ้าได้ 445 = ด่านไม่ทำงาน
  expect(out.raw['S-1']).toEqual([120, 5]);  // IPOS ไม่อยู่ใน timeline
  const toasts = out.toasts.join('|');
  expect(toasts).toContain('R16.103: ข้ามใบที่ไม่ตัดสต็อก 1 แถว (FSTOCKMAIN=0)');
  expect(toasts).toContain('จับคู่ได้ 2 SKU / 125 ชิ้น');   // ไม่นับแถวที่ข้าม
  await closeApp(app);
});

test('fail-open — ไม่มีคอลัมน์ FSTOCKMAIN / ค่าว่าง / ไม่ใช่ตัวเลข / ≠ 0 = บวกกลับเหมือนเดิม (ห้ามเป็น "เก็บเฉพาะ 1")', async ({ browser }) => {
  let app = await bootBare(browser);                      // (ก) ไฟล์ที่ไม่มีคอลัมน์นี้เลย
  await seedCatalog(app.page, 'WH', { 'S-1': 250 });
  let out = await upload103(app.page, toCsv([
    row({ tranNo: 'IPOS261000200', qty: 320, at: '9/10/2026 09:47:00', width: 24 }),
    row({ tranNo: 'IRVC261000097', qty: 120, at: '9/10/2026 10:35:00', width: 24 }),
  ], HEAD24));
  expect(out.map['S-1']).toBe(440);                       // ครบทุกแถวเหมือนเดิม · ถ้าได้ 120 = ไม่ fail-open
  expect(out.toasts.join('|')).not.toContain('ข้ามใบที่ไม่ตัดสต็อก');
  await closeApp(app);

  app = await bootBare(browser);                          // (ข) มีคอลัมน์ แต่ค่าไม่ใช่ "0"
  await seedCatalog(app.page, 'WH', { 'S-1': 250 });
  out = await upload103(app.page, toCsv([
    row({ tranNo: 'IPOS261000201', qty: 1, at: '9/10/2026 09:00:00' }),                    // ว่าง — ⛔ Number('')===0 ห้ามหลุดเป็น 0
    row({ tranNo: 'IPOS261000202', qty: 2, at: '9/10/2026 09:01:00', fsm: 'abc' }),
    row({ tranNo: 'IPOS261000203', qty: 4, at: '9/10/2026 09:02:00', fsm: '-' }),
    row({ tranNo: 'IRVC261000204', qty: 8, at: '9/10/2026 09:03:00', fsm: '1' }),
    row({ tranNo: 'IRCN261000205', qty: 16, at: '9/10/2026 09:04:00', fsm: '-1' }),        // ติดลบ ≠ 0 → ไม่ข้าม (กัน "≤ 0")
    row({ tranNo: 'IRNC261000206', qty: 32, at: '9/10/2026 09:05:00', fsm: '2' }),
  ]));
  expect(out.map['S-1']).toBe(1 + 2 + 4 + 8 + 16 + 32);   // 63 · ครบทุกแถวเหมือนเดิม
  expect(out.toasts.join('|')).not.toContain('ข้ามใบที่ไม่ตัดสต็อก');
  await closeApp(app);
});

test('ค่า 0 หลายรูปแบบถูกข้าม · หาคอลัมน์ตามชื่อ (ไม่ผูกตำแหน่ง 27)', async ({ browser }) => {
  let app = await bootBare(browser);
  await seedCatalog(app.page, 'WH', { 'S-1': 250 });
  let out = await upload103(app.page, toCsv([
    row({ tranNo: 'IPOS261000301', qty: 1, at: '9/10/2026 09:00:00', fsm: '0' }),
    row({ tranNo: 'IPOS261000302', qty: 2, at: '9/10/2026 09:01:00', fsm: '0.0000' }),     // รูปแบบที่ ProMaxx ส่งออกบางครั้ง
    row({ tranNo: 'IPOS261000303', qty: 4, at: '9/10/2026 09:02:00', fsm: ' 0 ' }),
    row({ tranNo: 'IPOS261000304', qty: 8, at: '9/10/2026 09:03:00', fsm: '-0' }),
    row({ tranNo: 'IRVC261000305', qty: 16, at: '9/10/2026 09:04:00', fsm: '1' }),
  ]));
  expect(out.map['S-1']).toBe(16);                        // เหลือแต่ใบ +1
  expect(out.toasts.join('|')).toContain('ข้ามใบที่ไม่ตัดสต็อก 4 แถว');
  await closeApp(app);

  app = await bootBare(browser);                          // FSTOCKMAIN อยู่คอลัมน์ 3
  await seedCatalog(app.page, 'WH', { 'S-1': 250 });
  out = await upload103(app.page, toCsv([
    row({ tranNo: 'IPOS261000401', qty: 5, at: '9/10/2026 09:00:00', fsm: '0', fsmIdx: 3 }),
    row({ tranNo: 'IRVC261000402', qty: 7, at: '9/10/2026 09:01:00', fsm: '1', fsmIdx: 3 }),
  ], HEAD_REORDER));
  expect(out.map['S-1']).toBe(7);
  expect(out.toasts.join('|')).toContain('ข้ามใบที่ไม่ตัดสต็อก 1 แถว');
  await closeApp(app);
});

test('สวิตช์ปิด / สาขาอื่น = บวกกลับทุกแถวเหมือนเดิม · แถวหน้าร้าน (Col A=1) ยังข้ามตามเดิมและนับแยก', async ({ browser }) => {
  const FILE = toCsv([
    row({ tranNo: 'IPOS261000200', qty: 320, at: '9/10/2026 09:47:00', fsm: '0' }),
    row({ tranNo: 'IRVC261000097', qty: 120, at: '9/10/2026 10:35:00', fsm: '1' }),
    row({ colA: '1', tranNo: 'ITFW261000100', qty: 310, at: '9/10/2026 11:00:00', fsm: '1' }),
  ]);

  let app = await bootBare(browser);                      // WH + สวิตช์ปิด = ก่อนแก้
  await seedCatalog(app.page, 'WH', { 'S-1': 250 });
  await app.page.evaluate(() => { WH_R16_103_SKIP_NO_STOCK = false; });
  let out = await upload103(app.page, FILE);
  expect(out.map['S-1']).toBe(440);                       // 320+120 · หน้าร้าน 310 ยังข้าม (สวิตช์อีกตัว)
  expect(out.toasts.join('|')).not.toContain('ข้ามใบที่ไม่ตัดสต็อก');
  expect(out.toasts.join('|')).toContain('ข้ามรายการหน้าร้าน 1 แถว');
  await closeApp(app);

  app = await bootBare(browser);                          // สาขาอื่น (loader เดียวกัน แต่ด่านเฉพาะ WH)
  await seedCatalog(app.page, 'SRC', { 'S-1': 250 });
  out = await upload103(app.page, FILE);
  expect(out.map['S-1']).toBe(750);                       // 320+120+310 ทุกแถวเหมือนเดิม
  expect(out.toasts.join('|')).not.toContain('ข้ามใบที่ไม่ตัดสต็อก');
  await closeApp(app);

  app = await bootBare(browser);                          // WH + สวิตช์เปิด: ข้ามทั้งสองแบบ · matched นับครบ
  await seedCatalog(app.page, 'WH', { 'S-1': 250 });
  out = await upload103(app.page, FILE);
  expect(out.map['S-1']).toBe(120);
  const toasts = out.toasts.join('|');
  expect(toasts).toContain('ข้ามรายการหน้าร้าน 1 แถว');
  expect(toasts).toContain('ข้ามใบที่ไม่ตัดสต็อก 1 แถว');
  expect(toasts).toContain('จับคู่ได้ 1 SKU / 120 ชิ้น');
  await closeApp(app);
});

test('ไฟล์ที่ถูกข้ามทั้งไฟล์ (มีแต่ IPOS) — โหลดสำเร็จ · บอกจำนวนที่ข้าม · ไม่ขึ้น "จับคู่ไม่ได้" · publish ได้ (0 chunk)', async ({ browser }) => {
  const app = await bootBare(browser);
  await seedCatalog(app.page, 'WH', { 'S-1': 250 });
  const out = await upload103(app.page, toCsv([
    row({ tranNo: 'IPOS261000501', qty: 400, at: '14/10/2026 15:05:01', fsm: '0' }),
    row({ tranNo: 'IPOS261000502', qty: 36, at: '14/10/2026 10:19:00', fsm: '0' }),
    row({ tranNo: 'IPOS261000503', qty: 7, at: '14/10/2026 11:00:00', fsm: '0' }),
  ]));
  expect(out.map).toEqual({});
  const toasts = out.toasts.join('|');
  expect(toasts).toContain('ข้ามใบที่ไม่ตัดสต็อก 3 แถว (FSTOCKMAIN=0)');
  expect(toasts).toContain('จับคู่ได้ 0 SKU / 0 ชิ้น');
  expect(toasts).not.toContain('จับคู่ไม่ได้');
  expect(await app.page.evaluate(() => document.getElementById('badgeR16_103').textContent)).toBe('Ready');
  // เส้นทาง publish: ไม่มีแถวเหลือ → 0 chunk (ไม่ throw) แล้วอ่านกลับได้เป็น 0 แถว
  expect(await app.page.evaluate(() => ({ rows: _whR16Rows('103').length, chunks: _chunkWhR16Rows(_whR16Rows('103')).length }))).toEqual({ rows: 0, chunks: 0 });
  await closeApp(app);
});

test('บวกกลับเฉพาะใบที่ลงก่อนเวลา R01 — ขอบ ≤ · ใบหลัง R01 ไม่นับ · เวลาสแกนยังเป็นขอบบนเหมือนเดิม', async ({ browser }) => {
  const app = await bootBare(browser);
  await seedCatalog(app.page, 'WH', { 'S-1': 250 });
  await upload103(app.page, toCsv([
    row({ tranNo: 'IRVC261000601', qty: 10, at: '14/10/2026 06:00:00', fsm: '1' }),   // ก่อน R01
    row({ tranNo: 'IRVC261000602', qty: 20, at: '14/10/2026 07:31:00', fsm: '1' }),   // เท่ากับเวลา R01 พอดี → นับ (≤)
    row({ tranNo: 'IRVC261000603', qty: 40, at: '14/10/2026 09:11:00', fsm: '1' }),   // หลัง R01 → ไม่อยู่ใน R01
  ]));
  await setR01Local(app.page, 2026, 10, 14, 7, 31, 0);
  const q = (scan) => app.page.evaluate((s) => getR16103QtyBefore('S-1', s), scan);

  expect(await q('2026-10-14 15:00:00')).toBe(30);        // 10+20 · ถ้าได้ 70 = ไม่กรองเวลา R01 · ถ้าได้ 10 = ขอบเป็น <
  expect(await q('2026-10-14 07:00:00')).toBe(10);        // สแกนก่อนใบที่สอง → ขอบบนเวลาสแกนยังทำงาน
  expect(await q('2026-10-14 09:30:00')).toBe(30);        // ใบหลัง R01 ที่ลงก่อนสแกน ก็ไม่นับ
  await closeApp(app);
});

test('เวลา R01 ใช้ไม่ได้ / สวิตช์ปิด / สาขาอื่น / ไม่มี raw timeline = เท่าเดิม (fail-open)', async ({ browser }) => {
  const app = await bootBare(browser);
  await seedCatalog(app.page, 'WH', { 'S-1': 250 });
  await upload103(app.page, toCsv([
    row({ tranNo: 'IRVC261000601', qty: 10, at: '14/10/2026 06:00:00', fsm: '1' }),
    row({ tranNo: 'IRVC261000602', qty: 20, at: '14/10/2026 07:31:00', fsm: '1' }),
    row({ tranNo: 'IRVC261000603', qty: 40, at: '14/10/2026 09:11:00', fsm: '1' }),
  ]));
  const q = () => app.page.evaluate(() => getR16103QtyBefore('S-1', '2026-10-14 15:00:00'));
  const LEGACY = 70;

  // r01Version ไม่ใช่เวลา ISO → ไม่กรอง (เทสเดิมใช้ 'R01-TEST-1' · parser ของ Chrome ยอมรับข้อความมั่ว จึงต้องตรวจรูปแบบก่อน)
  for (const v of ['', 'R01-TEST-1', 'garbage 1', '2026', '2026-10-14']) {
    await app.page.evaluate((x) => { state.r01Version = x; }, v);
    expect(await q(), `r01Version=${JSON.stringify(v)}`).toBe(LEGACY);
  }

  // ยืนยันว่า R01 ที่เป็นเวลาจริงกรองจริง (กันเทสข้างบนผ่านเพราะสวิตช์/โค้ดไม่ทำงาน)
  await setR01Local(app.page, 2026, 10, 14, 7, 31, 0);
  expect(await q()).toBe(30);

  await app.page.evaluate(() => { WH_R16_103_BEFORE_R01_ONLY = false; });          // สวิตช์ปิด
  expect(await q()).toBe(LEGACY);
  await app.page.evaluate(() => { WH_R16_103_BEFORE_R01_ONLY = true; currentBranch = 'SRC'; });   // สาขาอื่น
  expect(await q()).toBe(LEGACY);
  await app.page.evaluate(() => { currentBranch = 'WH'; state.r16_103RawMap.clear(); });          // ไม่มี raw → ยอดรวมเดิม
  expect(await q()).toBe(LEGACY);
  await closeApp(app);
});

// ───────── ★ replay 7 เคสจริง (Firestore items + ไฟล์ 16103.CSV 1–14 ต.ค. 2026) ─────────
// scan = firstScanAt ของ item · R01 = r01Version ที่แช่บน item (แปลงเป็นเวลาท้องถิ่น) · cnt/sys = ค่าที่แช่ตอน Confirm
// doc = ใบเดียวในไฟล์ R16.103 ของ SKU นั้นที่ลงก่อนเวลาสแกน (TRANNO · เวลา · จำนวน · FSTOCKMAIN)
const CASES = [
  { sku: 'S-200674', real: '200674', r01: [2026, 10, 9, 7, 31, 28], scan: '2026-10-09 12:28:13', cnt: 60, sys: 60, doc: ['IPOS261000200', '9/10/2026 09:47:00', 320, '0'], eff: 380, after: 'pass' },
  { sku: 'S-100680', real: '100680', r01: [2026, 10, 9, 7, 31, 28], scan: '2026-10-09 10:53:11', cnt: 31, sys: 31, doc: ['IPOS261000202', '9/10/2026 09:49:00', 264, '0'], eff: 295, after: 'pass' },
  { sku: 'S-700099', real: '700099', r01: [2026, 10, 7, 8, 53, 31], scan: '2026-10-07 10:23:52', cnt: 10, sys: 10, doc: ['IPOS261000118', '7/10/2026 10:19:00', 36, '0'], eff: 46, after: 'pass' },
  { sku: 'S-701294', real: '701294', r01: [2026, 10, 14, 7, 31, 37], scan: '2026-10-14 15:33:20', cnt: 0, sys: 0, doc: ['IPOS261000251', '14/10/2026 15:05:01', 400, '0'], eff: 400, after: 'pass' },
  { sku: 'S-990184', real: '990184', r01: [2026, 10, 9, 7, 31, 28], scan: '2026-10-09 14:19:11', cnt: 0, sys: 0, doc: ['IRVC261000097', '9/10/2026 10:35:00', 120, '1'], eff: 120, after: 'pass' },
  // ของขึ้นชั้นแล้ว (นับ 72 / 48) แต่ใบลงหลัง R01 → ยังเป็น audit ตามแผน (ต้องใช้สูตร "หักออก" — งานแยก ขออนุมัติต่างหาก)
  { sku: 'S-400210', real: '400210', r01: [2026, 10, 14, 7, 31, 37], scan: '2026-10-14 15:04:17', cnt: 72, sys: 0, doc: ['IRVC261000212', '14/10/2026 09:11:01', 72, '1'], eff: 144, after: 'audit' },
  { sku: 'S-200241', real: '200241', r01: [2026, 10, 14, 7, 31, 37], scan: '2026-10-14 14:58:13', cnt: 48, sys: 0, doc: ['IRVC261000213', '14/10/2026 09:12:57', 48, '1'], eff: 96, after: 'audit' },
];

async function replay(app, { fixed }) {
  const res = {};
  for (const c of CASES) {
    await seedCatalog(app.page, 'WH', { [c.sku]: c.sys });
    await app.page.evaluate((on) => { WH_R16_103_SKIP_NO_STOCK = on; WH_R16_103_BEFORE_R01_ONLY = on; }, fixed);
    await upload103(app.page, toCsv([row({ tranNo: c.doc[0], at: c.doc[1], qty: c.doc[2], fsm: c.doc[3], sku: c.sku })]));
    await setR01Local(app.page, ...c.r01);
    res[c.real] = await app.page.evaluate(({ sku, cnt, scan }) => {
      const eff = cnt + getSoldQtyBefore(sku, scan) + getR16103QtyBefore(sku, scan) - getInboundQtyBefore(sku, scan);
      return { eff, sys: state.skuMap.get(sku).systemQty, status: eff === state.skuMap.get(sku).systemQty ? 'pass' : 'audit' };
    }, { sku: c.sku, cnt: c.cnt, scan: c.scan });
  }
  return res;
}

test('★ replay 7 เคสจริงที่ติด audit (7–14 ต.ค.) — ก่อนแก้ 0/7 ผ่าน · หลังแก้ 5/7 · effectiveQty ก่อนแก้ตรงกับที่แช่ไว้บน Firestore', async ({ browser }) => {
  test.setTimeout(120_000);
  const app = await bootBare(browser);

  const before = await replay(app, { fixed: false });     // สวิตช์ปิด = สูตรเดิม
  for (const c of CASES) {
    expect(before[c.real].eff, `ก่อนแก้ ${c.real}`).toBe(c.eff);      // ตรงกับ effectiveQty บน item จริง
    expect(before[c.real].status, `ก่อนแก้ ${c.real}`).toBe('audit');
  }

  const after = await replay(app, { fixed: true });       // ค่าเริ่มต้นที่ส่งมอบ
  for (const c of CASES) expect(after[c.real].status, `หลังแก้ ${c.real} (eff=${after[c.real].eff})`).toBe(c.after);
  expect(Object.values(after).filter((x) => x.status === 'pass')).toHaveLength(5);
  // IPOS ไม่บวกเลย (eff = นับ) · ใบ +1 หลัง R01 ก็ไม่บวก
  for (const c of CASES) expect(after[c.real].eff, `หลังแก้ ${c.real}`).toBe(c.cnt);
  await closeApp(app);
});

test('ใบ +1 ที่ลงก่อน R01 ยังบวกกลับตามเดิม (พฤติกรรมเดิมที่ผู้ใช้เลือกคงไว้) · IPOS ก่อน R01 ก็ไม่บวก', async ({ browser }) => {
  const app = await bootBare(browser);
  await seedCatalog(app.page, 'WH', { 'S-1': 10 });
  await upload103(app.page, toCsv([
    row({ tranNo: 'IRVC261000700', qty: 6, at: '14/10/2026 06:00:00', fsm: '1' }),    // ก่อน R01 → บวกกลับ (นับ 4 + 6 = 10 = ระบบ)
    row({ tranNo: 'IPOS261000701', qty: 50, at: '14/10/2026 06:10:00', fsm: '0' }),   // IPOS ไม่เข้า R01 ไม่ว่าลงเมื่อไร → ไม่บวก
  ]));
  await setR01Local(app.page, 2026, 10, 14, 7, 31, 0);
  const eff = await app.page.evaluate(() => 4 + getSoldQtyBefore('S-1', '2026-10-14 15:00:00') + getR16103QtyBefore('S-1', '2026-10-14 15:00:00') - getInboundQtyBefore('S-1', '2026-10-14 15:00:00'));
  expect(eff).toBe(10);
  await closeApp(app);
});

test('ข้อความช่วยเหลือในแอป (guideHtml) ตามสถานะสวิตช์ · สวิตช์ปิด = ข้อความเดิม · สาขายาไม่มีหัวข้อ R16.103', async ({ browser }) => {
  const app = await bootBare(browser);
  const on = await app.page.evaluate(() => guideHtml(true));
  expect(on).toContain('ITFW/IRCN');                          // IPOS ออกจากรายการบวกกลับ
  expect(on).not.toContain('ITFW/IPOS/IRCN');
  expect(on).toContain('เฉพาะเอกสารที่ลงก่อนเวลา R01');
  expect(on).toContain('FSTOCKMAIN = 0');
  expect(on).toContain('ห้ามอัพข้ามวัน');

  const off = await app.page.evaluate(() => { WH_R16_103_SKIP_NO_STOCK = false; WH_R16_103_BEFORE_R01_ONLY = false; return guideHtml(true); });
  expect(off).toContain('ITFW/IPOS/IRCN');                    // ข้อความเดิมทุกตัวอักษรของรายการนี้
  expect(off).not.toContain('เฉพาะเอกสารที่ลงก่อนเวลา R01');
  expect(off).not.toContain('FSTOCKMAIN = 0');
  expect(off).not.toContain('ห้ามอัพข้ามวัน');

  expect(await app.page.evaluate(() => guideHtml(false))).not.toContain('R16.103');
  await closeApp(app);
});

// ───────── ไฟล์จริง (opt-in) ─────────
// R16103_REAL_FILE=<path ของ 16103.CSV> — ไม่ commit ไฟล์จริงเข้า repo (root .gitignore กัน *.csv)
// ตัวคาดการณ์เขียนแยกใน Node (ไม่ใช้โค้ดของแอป): ข้าม Col A=1 ก่อน แล้วข้าม FSTOCKMAIN ที่เป็นตัวเลข 0
test('ไฟล์จริง (opt-in R16103_REAL_FILE) — แถว FSTOCKMAIN=0 ถูกข้ามทั้งหมด · แถวชนิดอื่นรวมยอดเท่าเดิม', async ({ browser }) => {
  test.skip(!process.env.R16103_REAL_FILE, 'ตั้ง R16103_REAL_FILE=<path> เพื่อรันกับไฟล์จริง');
  test.setTimeout(180_000);
  const text = fs.readFileSync(process.env.R16103_REAL_FILE, 'utf8').replace(/^﻿/, '');
  const app = await bootBare(browser);
  const parsed = await app.page.evaluate((t) => Papa.parse(t, { skipEmptyLines: true }).data, text);
  const hdr = parsed[0].map((h) => String(h).trim().toUpperCase());
  const iFsm = hdr.indexOf('FSTOCKMAIN');
  expect(iFsm, 'ไฟล์จริงต้องมีคอลัมน์ FSTOCKMAIN').toBeGreaterThanOrEqual(0);
  const PREFIX = ['IRNC', 'IRVC', 'IRNM', 'ICSM', 'ITFB', 'ITFW', 'IPOS', 'IRCN'];

  const catalog = {}; let expectNoStock = 0, expectFront = 0, expectSum = 0, ipos = 0, iposKept = 0;
  for (const r of parsed.slice(1)) {
    const no = String(r[2] ?? '').trim().toUpperCase();
    if (!PREFIX.some((p) => no.startsWith(p))) continue;
    const bc = String(r[14] ?? '').trim(); const rawQty = String(r[17] ?? '').replace(/,|\s/g, '').trim(); const sku = String(r[23] ?? '').trim();
    if (!bc || rawQty === '') continue;
    catalog[sku] = bc;                                    // 1 SKU = 1 บาร์โค้ดพอสำหรับจับคู่
    const qty = isFinite(+rawQty) && +rawQty > 0 ? +rawQty : 0;
    const colA = String(r[0] ?? '').trim();
    const fsm = String(r[iFsm] ?? '').replace(/,|\s/g, '').trim();
    if (no.startsWith('IPOS')) ipos++;
    if (colA === '1') { expectFront++; continue; }
    if (fsm !== '' && isFinite(+fsm) && +fsm === 0) { expectNoStock++; continue; }
    if (no.startsWith('IPOS')) iposKept++;
    expectSum += qty;
  }
  expect(Object.keys(catalog).length).toBeGreaterThan(0);

  await app.page.evaluate((cat) => {
    currentBranch = 'WH'; currentRole = 'supervisor'; currentUser = 'Tester'; _r01BaselineAt = '';
    state.barcodeMap.clear(); state.skuMap.clear();
    for (const [sku, bc] of Object.entries(cat)) {
      state.barcodeMap.set(bc, sku);
      state.skuMap.set(sku, { productName: sku, unitPrice: 1, systemQty: 0, barcodes: [{ barcode: bc, unitMultiplier: 1 }] });
    }
  }, catalog);
  const out = await upload103(app.page, text);
  const got = Object.values(out.map).reduce((a, b) => a + b, 0);
  console.log(`[R16103_REAL_FILE] แถว IPOS ${ipos} · ข้ามหน้าร้าน ${expectFront} · ข้ามไม่ตัดสต็อก ${expectNoStock} · รวมยอดบวกกลับ ${got}`);
  expect(got).toBe(expectSum);                            // ยอดรวมที่เข้า timeline = ยอดที่คาด
  expect(iposKept).toBe(0);                               // IPOS ไม่เหลือเลย (ไฟล์จริง FSTOCKMAIN=0 ทุกแถว)
  if (expectNoStock > 0) expect(out.toasts.join('|')).toContain(`ข้ามใบที่ไม่ตัดสต็อก ${expectNoStock} แถว`);
  await closeApp(app);
});
