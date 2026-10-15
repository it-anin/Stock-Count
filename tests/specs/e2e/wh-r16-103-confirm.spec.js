// R16.103 · WH Count Confirm จริงผ่าน emulator (ต.ค. 2026) — ตรึงผลของกติกาใหม่บน op result ที่ commit จริง
// ใช้ตัวโหลด R16.103 จริง (#fileR16_103 → publish ขึ้น emulator → sync meta ที่ master) แล้ว _confirmWhCountItems() จริง
// เคส (ตัวเลขเลียนแบบเคสจริง 7–14 ต.ค.): R01 = วันนี้ 07:31 · สแกน = วันนี้ 15:00
// ⚠️ วันที่ทั้งหมดต้องเป็น "วันนี้" ของเครื่องที่รันเทส (คำนวณตอนโหลดไฟล์) — ห้ามฮาร์ดโค้ดวันที่:
//    Count Confirm ตัดรายการที่ timestamp เป็นวันก่อนวันนี้ (_whCountSourceValid) → seed เวลาสแกนเป็นวันเก่า = ได้ "ไม่มีรายการรอยืนยัน"
//    (เจอจริง 15 ต.ค. 2026: สเปกนี้เคยฮาร์ดโค้ด 14 ต.ค. แล้วล้มทั้งสองข้อทันทีที่ข้ามเที่ยงคืน ทั้งที่แอปไม่ได้พัง)
//   S-MULTI  นับ 60 = ระบบ 60 + IPOS 320 หลัง R01 (FSTOCKMAIN=0)        → เดิม 380 audit · ใหม่ 60 pass   (เคส 200674)
//   S-ZERO   นับ 0  = ระบบ 0  + IRVC 120 หลัง R01 (ของยังไม่ขึ้นชั้น)    → เดิม 120 audit · ใหม่ 0 pass    (เคส 990184)
//   S-ABC0   นับ 72 ระบบ 0   + IRVC 72 หลัง R01 (ของขึ้นชั้นแล้ว)        → audit ทั้งก่อน/หลัง (ตามแผน: ต้องใช้สูตร "หักออก" — งานแยก) (เคส 400210)
//   S-NORM   นับ 4  ระบบ 10  + IRVC 6 ก่อน R01 (06:00)                  → pass ทั้งก่อน/หลัง · r16103Qty 6 (พฤติกรรมเดิมที่เลือกคงไว้)
// canary: ปิดสวิตช์ทั้งสองแล้วต้องได้ผลเดิม (audit ×3) — พิสูจน์ว่าเทสวัดตัวแก้จริง ไม่ผ่านด้วยเหตุผลอื่น
const { test, expect, closeApp, requireEmulator } = require('../../lib/hooks');
const { bootFreshCount, armWhR16, PROJECT_ID } = require('../../lib/scenario');
const { waitForDoc } = require('../../lib/emulator');
const { makeWhCountItem, seedWhWorkflow, listWhConfirmOps, readWhConfirmResults } = require('../../lib/wh-workflow');

const csv = (text) => ({ name: 'r16_103.csv', mimeType: 'text/csv', buffer: Buffer.from(text, 'utf8') });
// index ตรงกับไฟล์จริง: 0=SYSWAREHOUSEID 1=TRANDATE 2=TRANNO 9=FCANCEL 14=SCANCODE 17=BASEQUANTITY 23=ITEMID 27=FSTOCKMAIN
const HEAD = ['SYSWAREHOUSEID', 'TRANDATE', 'TRANNO', 'REFERENCENO1', 'SYSVOUCHERID', 'SYSSALEID',
  'TOTAL', 'TOTALVAT', 'GRANDTOTAL', 'FCANCEL', 'TAXRATE', 'SYSPERSONID', 'SYSBRANCHID', 'FPROCESS',
  'SCANCODE', 'ITEMNAME', 'SYSUNITID', 'BASEQUANTITY', 'QUANTITY', 'SYSITEMID', 'PRICE', 'AMOUNT', 'DETAILNO',
  'ITEMID', 'ITEMNAME', 'TOTALTRADDISCHAVEVAT', 'TOTALTRADDISCNONEVAT', 'FSTOCKMAIN'];
function row({ tranNo, at, qty, fsm, sku, barcode }) {
  const r = new Array(HEAD.length).fill('');
  r[0] = '0'; r[1] = at; r[2] = tranNo; r[9] = '0'; r[14] = barcode; r[17] = String(qty); r[23] = sku; r[27] = fsm;
  return r;
}
// วันนี้ (เวลาท้องถิ่น) — TRANDATE ในไฟล์ใช้รูปแบบ d/m/yyyy เหมือนที่ ProMaxx ส่งออก
const NOW = new Date();
const Y = NOW.getFullYear(), M = NOW.getMonth(), D = NOW.getDate();
const dmy = (hh, mm, ss) => `${D}/${M + 1}/${Y} ${hh}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
const R16_103_FILE = [HEAD,
  row({ tranNo: 'IPOS261000200', at: dmy(9, 47, 0), qty: 320, fsm: '0', sku: 'S-MULTI', barcode: 'B-M1' }),
  row({ tranNo: 'IRVC261000097', at: dmy(10, 35, 0), qty: 120, fsm: '1', sku: 'S-ZERO', barcode: 'B-ZERO' }),
  row({ tranNo: 'IRVC261000212', at: dmy(9, 11, 1), qty: 72, fsm: '1', sku: 'S-ABC0', barcode: 'B-ABC0' }),
  row({ tranNo: 'IRVC261000700', at: dmy(6, 0, 0), qty: 6, fsm: '1', sku: 'S-NORM', barcode: 'B-NORM' }),
].map((r) => r.join(',')).join('\r\n');

const SCAN_AT = new Date(Y, M, D, 15, 0, 0);   // เวลาท้องถิ่น — กรองด้วย TRANDATE ของไฟล์ (ท้องถิ่นเช่นกัน)
const R01_AT = [Y, M, D, 7, 31, 0];

async function waitForLocalScanning(page, count, { timeout = 45_000 } = {}) {
  await page.waitForFunction((n) => {
    let found = 0;
    for (const item of state.scanData.values()) if (item?.status === 'scanning') found += 1;
    return found >= n;
  }, count, { timeout, polling: 100 });
}

async function confirmWithR16103(browser, { switchesOn }) {
  const r01Iso = new Date(...R01_AT).toISOString();
  const desk = await bootFreshCount(browser, { branch: 'WH', role: 'supervisor', user: 'มายด์', mode: 'desktop', r01Version: r01Iso });
  expect(await desk.page.evaluate(() => state.r01Version)).toBe(r01Iso);   // ทั้งแอปและ master ต้องเป็นเวลา ISO เดียวกัน (Confirm เทียบเวอร์ชันทั้งสองฝั่ง)

  const items = [['S-MULTI', 60], ['S-ZERO', 0], ['S-ABC0', 72], ['S-NORM', 4]]
    .map(([sku, qty]) => makeWhCountItem({ sku, epoch: desk.epoch, qty, staff: 'มุก', at: SCAN_AT }));
  await seedWhWorkflow(PROJECT_ID, { items });
  await waitForLocalScanning(desk.page, items.length);
  await armWhR16(desk.page);

  await desk.page.evaluate((on) => { WH_R16_103_SKIP_NO_STOCK = on; WH_R16_103_BEFORE_R01_ONLY = on; }, switchesOn);

  // อัป R16.103 ผ่านตัวโหลดจริง (publish ขึ้น emulator + sync meta ไปที่ master) แล้วรอให้ master ได้เวอร์ชันเดียวกับในแอป
  await desk.page.setInputFiles('#fileR16_103', csv(R16_103_FILE));
  await desk.page.waitForFunction(() => state.r16_103Loaded === true && _whR16103TimelineReady && !_whR16TimelineLoading, null, { timeout: 30_000, polling: 100 });
  const v103 = await desk.page.evaluate(() => state.r16_103DetailVersion);
  expect(v103).toBeTruthy();
  await waitForDoc(PROJECT_ID, 'stock_sessions/WH_r01', (d) => d?.r16_103DetailVersion === v103, { timeout: 20_000 });

  await desk.page.evaluate(() => _confirmWhCountItems());
  await desk.page.waitForFunction(() => !_whCountConfirming, null, { timeout: 60_000, polling: 100 });

  const ops = await listWhConfirmOps(PROJECT_ID, { kind: 'count', state: 'committed' });
  expect(ops, 'ต้องมี op นับที่ commit แล้ว 1 รายการ').toHaveLength(1);
  const results = await readWhConfirmResults(PROJECT_ID, ops[0].id);
  return { desk, results, op: ops[0] };
}

test.describe('WH Count Confirm × R16.103 (บวกกลับเฉพาะใบที่อยู่ใน R01)', () => {
  test.beforeEach(() => requireEmulator());
  test.setTimeout(180_000);

  test('สวิตช์เปิด (ค่าเริ่มต้น): IPOS ไม่บวก · ใบ +1 หลัง R01 ไม่บวก · ใบ +1 ก่อน R01 ยังบวกกลับ · ของขึ้นชั้นแล้วยังเป็น audit', async ({ browser }) => {
    const { desk, results, op } = await confirmWithR16103(browser, { switchesOn: true });
    expect(Object.keys(results).sort()).toEqual(['S-ABC0', 'S-MULTI', 'S-NORM', 'S-ZERO']);

    expect(results['S-MULTI']).toMatchObject({ status: 'pass', r16103Qty: 0, effectiveQty: 60, systemQty: 60 });   // เดิม 380 audit
    expect(results['S-ZERO']).toMatchObject({ status: 'pass', r16103Qty: 0, effectiveQty: 0, systemQty: 0 });      // เดิม 120 audit
    expect(results['S-ABC0']).toMatchObject({ status: 'audit', r16103Qty: 0, effectiveQty: 72, systemQty: 0 });    // ยัง audit ตามแผน
    expect(results['S-NORM']).toMatchObject({ status: 'pass', r16103Qty: 6, effectiveQty: 10, systemQty: 10 });    // ก่อน R01 → บวกกลับเหมือนเดิม
    // ค่า R01/R16.103 ที่ใช้ตัดสินถูกแช่ไว้บน op (ตรวจย้อนหลังได้ว่าตัดสินด้วยเวอร์ชันไหน)
    expect(op.r01Version).toBe(new Date(...R01_AT).toISOString());
    expect(op.r16_103Version).toBeTruthy();

    // item ที่ materialize แล้วตรงกับ op
    await waitForDoc(PROJECT_ID, 'stock_sessions/WH/items/S-MULTI', (d) => d?.status === 'pass' && d.whCountOpId === op.id, { timeout: 30_000 });
    await closeApp(desk);
  });

  test('canary — ปิดสวิตช์ทั้งสอง = สูตรเดิม: IPOS/ใบหลัง R01 ถูกบวกกลับ → audit (พิสูจน์ว่าเทสข้างบนวัดตัวแก้จริง)', async ({ browser }) => {
    const { desk, results } = await confirmWithR16103(browser, { switchesOn: false });
    expect(results['S-MULTI']).toMatchObject({ status: 'audit', r16103Qty: 320, effectiveQty: 380, systemQty: 60 });
    expect(results['S-ZERO']).toMatchObject({ status: 'audit', r16103Qty: 120, effectiveQty: 120, systemQty: 0 });
    expect(results['S-ABC0']).toMatchObject({ status: 'audit', r16103Qty: 72, effectiveQty: 144, systemQty: 0 });
    expect(results['S-NORM']).toMatchObject({ status: 'pass', r16103Qty: 6, effectiveQty: 10, systemQty: 10 });
    await closeApp(desk);
  });
});
