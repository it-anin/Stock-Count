// ป็อปอัพ 📦 ปรับปรุงสินค้า ดึง LOT/EXP (R14.102) + ราคา Level 4 (R05.105) จาก Supabase (ก.ย. 2026)
//
// เดิมต้องแนบ 2 ไฟล์เองทุกครั้ง · ตอนนี้บอท auto-adj อัปขึ้นตาราง adj_* ทุกเช้า แล้วป็อปอัพดึงเฉพาะ SKU ในใบเอง
// Supabase ถูกจำลองด้วย tests/lib/supabase-fake.js — ไม่มี request ออกนอกเครื่อง
//
// เทสนี้ตรึง:
//   1. ขอเฉพาะ SKU ในใบ · ใช้แค่ชุด active_gen · Export Text ได้ราคาทันทีโดยรูปแบบบรรทัดเดิมเป๊ะ
//   2. LOT เกิน 1,000 แถวต้องมาครบ (Supabase ตัดผลที่ 1,000 แถวต่อ request — ไม่วนเพจ = LOT หายเงียบ)
//   3. Supabase ล้ม → ใช้ที่บันทึกไว้ใน {branch}_adjlot + เตือนบนการ์ด · แนบไฟล์เองยังใช้ได้
//   4. แนบไฟล์ระหว่างที่ Supabase ยังโหลด → ไฟล์ชนะ · Export ระหว่างโหลดถูกกั้น
//   5. ★ LOT ที่เลือกไว้แต่ไม่มีในข้อมูลชุดนี้ → ห้ามหลุดเข้าไฟล์ (จอไม่ได้แสดง) แต่ต้องไม่ถูกลบทิ้ง
//   6. ★ รอบโหลดที่ถูกแซงต้องไม่ทิ้งธง "กำลังโหลด" ค้าง (ไม่งั้น Export ถูกบล็อกถาวร)
//   7. บอทยังไม่เคยอัป → การ์ดบอกตรง ๆ ไม่ใช่ขึ้นว่าง ๆ
const { test, expect, bootBare, closeApp } = require('../../lib/hooks');
const { fakeSupabase, makeGate } = require('../../lib/supabase-fake');

const TODAY = new Date().toISOString();
const META = [
  { kind: 'r14', active_gen: 7, row_count: 3, sku_count: 2, uploaded_at: '2026-09-11T01:10:00.000Z', checked_at: TODAY },
  { kind: 'r05_105', active_gen: 9, row_count: 2, sku_count: 2, uploaded_at: '2026-09-01T01:10:00.000Z', checked_at: '2026-01-01T00:00:00.000Z' },
];
const LOTS = [
  { gen: 7, seq: 0, sku: 'A1', lot: 'L1', exp: '31/12/2027' },
  { gen: 7, seq: 1, sku: 'A1', lot: 'L2', exp: '30/06/2028' },
  { gen: 7, seq: 2, sku: 'C3', lot: 'LZ', exp: '01/01/2029' },
  { gen: 6, seq: 0, sku: 'A1', lot: 'OLD', exp: '01/01/2020' },   // ชุดก่อนหน้า — ต้องไม่โผล่
];
const PRICES = [
  { gen: 9, seq: 0, sku: 'A1', unit: 'แผง', price: 12.5 },
  { gen: 9, seq: 1, sku: 'B2', unit: 'ขวด', price: null },
  { gen: 8, seq: 0, sku: 'A1', unit: 'แผง', price: 999 },          // ชุดก่อนหน้า — ต้องไม่โผล่
];
// R14.102 ที่แนบเอง: ColB=EXP · ColJ=SKU · ColL=LOT
const LOT_CSV = 'H0,CF_EXPIREDATE_TEXT,H2,H3,H4,H5,H6,H7,H8,CF_ITEMID,H10,CF_LOTNO\r\nx,31/12/2029,n,,,,,,,A1,,FL1\r\n';

// ใบ: A1 ระบบ 5 นับ 3 → ORDS 2 · B2 ระบบ 2 นับ 1 → ORDS 1 · C3 pass (ไม่อยู่ในใบ ต้องไม่ถูกขอ)
async function seed(page, { cloud = null } = {}) {
  await page.evaluate(({ cloud }) => {
    currentBranch = 'SRC'; currentRole = 'pharmacist'; currentUser = 'Pharm';
    state.skuMap.clear(); state.scanData.clear(); state.skuDirectMap.clear(); scanListMap.clear();
    const add = (sku, live, cnt, status) => {
      state.skuMap.set(sku, { sku, productName: 'สินค้า ' + sku, unitPrice: 20, systemQty: live, negSys: false, barcodes: [], isDel: false });
      state.skuDirectMap.set(sku, { barcode: 'B' + sku, unitName: 'เม็ด' });
      state.scanData.set(sku, { status, auditStatus: status, countedQty: cnt, recheckQty: cnt, recheckBy: 'Pharm',
        recheckAt: '2026-09-01T03:00:00.000Z', recheckSystemQty: live, timestamp: '2026-09-01 10:00:00', scannedBy: 'Asst' });
    };
    add('A1', 5, 3, 'stock_adjustment');
    add('B2', 2, 1, 'stock_adjustment');
    add('C3', 4, 4, 'pass');
    // {branch}_adjlot อยู่บน Firestore ซึ่ง logic project ต่อพอร์ตที่ตาย — แทนด้วยค่าที่เทสกำหนด
    const toMap = (o) => (o ? new Map(Object.entries(o)) : null);
    _readAdjlotDoc = async () => (cloud
      ? { lotMap: toMap(cloud.lotMap), lotSelected: toMap(cloud.lotSelected), priceMap: toMap(cloud.priceMap), updatedBy: cloud.updatedBy || '' }
      : null);
    // เก็บไฟล์ที่ Export ไว้อ่าน แทนการดาวน์โหลดจริง
    window.__exports = [];
    URL.createObjectURL = (b) => { window.__exports.push(b); return 'blob:captured'; };
    URL.revokeObjectURL = () => {};
    HTMLAnchorElement.prototype.click = function () {};
  }, { cloud });
}

const exportText = (page) => page.evaluate(async () => {
  const n = window.__exports.length;
  exportAdjustDocText();
  return window.__exports.length > n ? window.__exports[window.__exports.length - 1].text() : null;
});
const attachLotFile = (page, csv) => page.evaluate((csv) => {
  handleAdjLotFile({ target: { files: [new File([csv], 'R14.102.csv')] } });
}, csv);
const lotsOf = (page) => page.evaluate(() => Object.fromEntries([..._lotMap].map(([k, v]) => [k, v.map((e) => e.lot)])));
const cardText = (page, which) => page.evaluate((w) => document.getElementById('adj' + w + 'Info').textContent, which);
const toastText = (page) => page.evaluate(() => document.getElementById('toastContainer').textContent);

test('เปิดป็อปอัพแล้วได้ LOT/ราคาจาก Supabase เฉพาะ SKU ในใบ และ Export ได้ทันที', async ({ browser }) => {
  const app = await bootBare(browser);
  const sb = await fakeSupabase(app.page, { meta: META, lots: LOTS, prices: PRICES });
  await seed(app.page);
  await app.page.evaluate(() => openAdjustDocPopup());

  expect(await lotsOf(app.page)).toEqual({ A1: ['L1', 'L2'] });   // ไม่มี C3 (ไม่อยู่ในใบ) · ไม่มี OLD (ชุดเก่า)
  const st = await app.page.evaluate(() => ({ a: _priceMap.get('A1'), b: _priceMap.get('B2'), src: { ..._adjSource } }));
  expect(st.a).toEqual({ unit: 'แผง', price: 12.5 });            // ไม่ใช่ 999 ของชุดเก่า
  expect(st.b).toEqual({ unit: 'ขวด', price: null });
  expect(st.src).toEqual({ Lot: 'supabase', Price: 'supabase' });

  // ขอเฉพาะ SKU ในใบ และกรองด้วย active_gen ทุกครั้ง
  const dataReqs = sb.requests.filter((q) => q.table !== 'adj_meta');
  expect(dataReqs.length).toBeGreaterThan(0);
  for (const q of dataReqs) {
    expect(q.params.sku).toContain('"A1"');
    expect(q.params.sku).toContain('"B2"');
    expect(q.params.sku).not.toContain('C3');
    expect(q.params.gen).toBe(q.table === 'adj_r14_lots' ? 'eq.7' : 'eq.9');
  }
  // anon key ต้องไปทั้ง apikey และ Authorization (Supabase ต้องการทั้งคู่)
  expect(sb.requests[0].headers.apikey).toBeTruthy();
  expect(sb.requests[0].headers.authorization).toBe('Bearer ' + sb.requests[0].headers.apikey);

  // การ์ด: ที่มา + จำนวน · ราคา checked_at ไม่ใช่วันนี้ → ต้องเตือนว่าบอทยังไม่ได้ตรวจวันนี้
  const lotCard = await cardText(app.page, 'Lot');
  expect(lotCard).toContain('Supabase');
  expect(lotCard).toContain('1/2 SKU มี LOT');
  expect(lotCard).not.toContain('บอทยังไม่ได้ตรวจวันนี้');
  expect(await cardText(app.page, 'Price')).toContain('บอทยังไม่ได้ตรวจวันนี้');

  // Export Text: รูปแบบเดิม SKU⇥จำนวน⇥ราคา⇥×6⇥LOT⇥EXP · ราคามาเลยโดยไม่ต้องแนบไฟล์
  expect(await exportText(app.page)).toBe('A1\t2\t12.5\t\t\t\t\t\t\t\r\nB2\t1\t\t\t\t\t\t\t\t\r\n');
  await app.page.evaluate(() => onAdjLotSelect('A1', 'L2'));
  const withLot = await exportText(app.page);
  expect(withLot.split('\r\n')[0]).toBe('A1\t2\t12.5\t\t\t\t\t\tL2\t30/06/2571');   // EXP ของ LOT ที่เลือก เป็น พ.ศ.
  await closeApp(app);
});

test('LOT เกิน 1,000 แถวต้องมาครบและเรียงตามลำดับในไฟล์ (วนเพจจริง)', async ({ browser }) => {
  const app = await bootBare(browser);
  const many = Array.from({ length: 1005 }, (_, i) => ({ gen: 7, seq: i, sku: 'A1', lot: 'L' + String(i).padStart(4, '0'), exp: '' }));
  const sb = await fakeSupabase(app.page, { meta: [META[0]], lots: many });
  await seed(app.page);
  await app.page.evaluate(() => openAdjustDocPopup());

  const lots = (await lotsOf(app.page)).A1;
  expect(lots.length).toBe(1005);
  expect(lots[0]).toBe('L0000');
  expect(lots[1004]).toBe('L1004');
  const offsets = sb.requests.filter((q) => q.table === 'adj_r14_lots').map((q) => q.params.offset);
  expect(offsets).toEqual(['0', '1000']);
  // ราคา: บอทยังไม่เคยอัป R05.105 → บอกตรง ๆ
  expect(await cardText(app.page, 'Price')).toContain('ยังไม่มีข้อมูลบน Supabase');
  await closeApp(app);
});

test('Supabase ล้ม → ใช้ที่บันทึกไว้ + เตือนบนการ์ด · แนบไฟล์เองยังใช้ได้', async ({ browser }) => {
  const app = await bootBare(browser);
  await fakeSupabase(app.page, {}, { fail: 503 });
  await seed(app.page, { cloud: {
    lotMap: { A1: [{ lot: 'CL1', exp: '31/12/2027' }] }, lotSelected: { A1: 'CL1' },
    priceMap: { A1: { unit: 'แผง', price: 7 } }, updatedBy: 'Pharm2',
  } });
  await app.page.evaluate(() => openAdjustDocPopup());
  await app.page.waitForFunction(() => _adjSource.Lot === 'cloud' && _adjSource.Price === 'cloud', null, { polling: 100 });

  const card = await cardText(app.page, 'Lot');
  expect(card).toContain('โหลดจาก Supabase ไม่ได้');
  expect(card).toContain('ใช้ที่บันทึกไว้');
  expect((await exportText(app.page)).split('\r\n')[0]).toBe('A1\t2\t7\t\t\t\t\t\tCL1\t31/12/2570');

  await attachLotFile(app.page, LOT_CSV);
  await app.page.waitForFunction(() => _adjSource.Lot === 'file', null, { polling: 100 });
  expect(await lotsOf(app.page)).toEqual({ A1: ['FL1'] });
  expect(await cardText(app.page, 'Lot')).toContain('แนบไฟล์เอง');
  await closeApp(app);
});

test('แนบไฟล์ระหว่างที่ Supabase ยังโหลด → ไฟล์ชนะ · กด Export ระหว่างโหลดถูกกั้น', async ({ browser }) => {
  const app = await bootBare(browser);
  const g = makeGate();
  await fakeSupabase(app.page, { meta: META, lots: LOTS, prices: PRICES }, { gate: g.gate });
  await seed(app.page);
  await app.page.evaluate(() => { window.__open = openAdjustDocPopup(); });
  await app.page.waitForFunction(() => _adjLoading === true, null, { polling: 100 });

  expect(await exportText(app.page)).toBeNull();                  // ไม่มีไฟล์หลุดออกไประหว่างโหลด
  expect(await toastText(app.page)).toContain('กำลังโหลด LOT/ราคา');
  expect(await cardText(app.page, 'Lot')).toContain('กำลังโหลด');

  await attachLotFile(app.page, LOT_CSV);
  await app.page.waitForFunction(() => _adjSource.Lot === 'file', null, { polling: 100 });
  g.open();
  await app.page.evaluate(() => window.__open);

  expect(await lotsOf(app.page)).toEqual({ A1: ['FL1'] });        // ผล Supabase ของ LOT ถูกทิ้ง
  const st = await app.page.evaluate(() => ({ src: { ..._adjSource }, price: _priceMap.get('A1'), loading: _adjLoading }));
  expect(st.src).toEqual({ Lot: 'file', Price: 'supabase' });     // ราคายังมาจาก Supabase ตามปกติ
  expect(st.price).toEqual({ unit: 'แผง', price: 12.5 });
  expect(st.loading).toBe(false);
  await closeApp(app);
});

test('★ LOT ที่เลือกไว้แต่ไม่มีในข้อมูลชุดนี้ → ไม่หลุดเข้าไฟล์ แต่ไม่ถูกลบทิ้ง', async ({ browser }) => {
  const app = await bootBare(browser);
  await fakeSupabase(app.page, { meta: META, lots: LOTS, prices: PRICES });
  // LOT ที่เคยเลือกและบันทึกไว้ (ข้อมูลรอบก่อน) — ชุดใหม่บน Supabase ไม่มี GONE แล้ว
  await seed(app.page, { cloud: { lotSelected: { A1: 'GONE' } } });
  await app.page.evaluate(() => openAdjustDocPopup());
  await app.page.waitForFunction(() => _lotSelected.get('A1') === 'GONE' && _adjSource.Lot === 'supabase', null, { polling: 100 });

  const line = (await exportText(app.page)).split('\r\n')[0];
  expect(line).toBe('A1\t2\t12.5\t\t\t\t\t\t\t');                  // LOT/EXP ว่าง = ตรงกับที่จอแสดง "— เลือก —"
  expect(await app.page.evaluate(() => _adjSelectedEntry('A1'))).toBeNull();
  expect(await app.page.evaluate(() => _lotSelected.get('A1'))).toBe('GONE');   // ยังอยู่ — ไม่ทำลายงานที่บันทึกไว้

  await app.page.evaluate(() => onAdjLotSelect('A1', 'L1'));
  expect((await exportText(app.page)).split('\r\n')[0]).toBe('A1\t2\t12.5\t\t\t\t\t\tL1\t31/12/2570');
  await closeApp(app);
});

test('★ รอบโหลดที่ถูกแซงต้องไม่ทิ้งธง "กำลังโหลด" ค้าง', async ({ browser }) => {
  const app = await bootBare(browser);
  const g = makeGate();
  await fakeSupabase(app.page, { meta: META, lots: LOTS, prices: PRICES }, { gate: g.gate });
  await seed(app.page);
  await app.page.evaluate(() => { window.__open = openAdjustDocPopup(); });
  await app.page.waitForFunction(() => _adjLoading === true, null, { polling: 100 });

  // ระหว่างรอ ทุกรายการออกจาก stock_adjustment แล้วเปิดป็อปอัพใหม่ (รอบใหม่ไม่มี SKU ให้โหลด)
  await app.page.evaluate(async () => {
    for (const sd of state.scanData.values()) { sd.status = 'pass'; sd.auditStatus = 'pass'; }
    await openAdjustDocPopup();
  });
  expect(await app.page.evaluate(() => _adjLoading)).toBe(false);
  g.open();
  await app.page.evaluate(() => window.__open);

  const st = await app.page.evaluate(() => ({ loading: _adjLoading, src: { ..._adjSource } }));
  expect(st.loading).toBe(false);
  expect(st.src).toEqual({ Lot: '', Price: '' });                  // ผลของรอบเก่าถูกทิ้ง
  await app.page.evaluate(() => exportAdjustDocText());
  const t = await toastText(app.page);
  expect(t).toContain('ไม่มีรายการให้ Export');                    // ไม่ใช่ "กำลังโหลด" ค้างถาวร
  expect(t).not.toContain('กำลังโหลด LOT/ราคา');
  await closeApp(app);
});

test('บอทยังไม่เคยอัปทั้งสองไฟล์ → การ์ดบอกตรง ๆ และไม่ยิงขอข้อมูลเปล่า ๆ', async ({ browser }) => {
  const app = await bootBare(browser);
  const sb = await fakeSupabase(app.page, { meta: [] });
  await seed(app.page);
  await app.page.evaluate(() => openAdjustDocPopup());

  expect(sb.requests.map((q) => q.table)).toEqual(['adj_meta']);
  expect(await cardText(app.page, 'Lot')).toContain('ยังไม่มีข้อมูลบน Supabase');
  expect(await cardText(app.page, 'Price')).toContain('ยังไม่มีข้อมูลบน Supabase');
  await closeApp(app);
});
