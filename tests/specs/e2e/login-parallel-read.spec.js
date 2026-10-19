// อ่าน Cloud ตอนล็อกอินพร้อมกัน (สวิตช์ LOGIN_PARALLEL_READ) บน Firestore emulator จริง — ผลต้องเท่าเดิมทุกไบต์
//   ก. เปิด/ปิดสวิตช์: restoreFromFirestore(true) ได้ catalog · scanData · epoch · ตัวหาร Progress เท่ากัน (ข้อมูลจริงจาก emulator ไม่ใช่ _db ปลอม)
//   ข. เครื่องที่มี backup เก่า (epoch เก่า) แต่ Cloud เริ่มนับใหม่แล้ว: items ต้องถูกอ่านด้วย epoch "ของ session ที่เพิ่งอ่าน" ไม่ใช่ epoch ในเครื่อง
//      → ตรึงว่า items อ่านหลัง session doc เสมอ (ห้ามเอา items ไปอ่านล่วงหน้าพร้อม master) · item ของรอบเก่าที่ยังค้างบน Cloud ต้องไม่โผล่
const { test, expect, closeApp, requireEmulator } = require('../../lib/hooks');
const { bootFreshCount, PROJECT_ID, MIN_SKUS } = require('../../lib/scenario');
const { seedItems } = require('../../lib/seed');
const F = require('../../lib/fixtures');

const SNAP = () => ({
  skus: state.skuMap.size, r01: state.r01Data.length, r05: state.r05Data.length, pm: state.productMasterData.length,
  epoch: _countResetAt, schema: _schemaVersion, total: _cachedTotalSku,
  badges: ['ProductMaster', 'R01', 'R05'].map((k) => document.getElementById('badge' + k).textContent).join('/'),
  scan: [...state.scanData.entries()].filter(([, v]) => v.status !== 'pending').map(([k, v]) => [k, v.status, v.countedQty]).sort(),
});

// seed ผ่าน admin SDK แล้วหน้าเว็บยังมองไม่เห็นทันที (query ฝั่ง server ทันทีหลัง seed ได้ 0 · ไม่กี่ร้อยมิลลิวินาทีถัดมาได้ครบ) — รอให้ listener ของหน้าเห็นก่อนค่อยทดสอบ
// ไม่งั้นเทสวัดจังหวะ seed ไม่ใช่การอ่านตอนล็อกอิน (production เขียน items ผ่าน SDK ของแอปเอง ไม่มีช่องว่างนี้)
const waitSeen = (page, sku) => page.waitForFunction((k) => state.scanData.get(k)?.status === 'scanning', sku, { timeout: 15_000, polling: 100 });

test.describe('LOGIN_PARALLEL_READ — ผลเท่าเดิมบน emulator', () => {
  test.beforeEach(() => { requireEmulator(); });
  test.setTimeout(120_000);

  test('ก. เปิด/ปิดสวิตช์ → restoreFromFirestore(true) ได้ผลเท่ากัน (catalog · items · epoch · Progress)', async ({ browser }) => {
    const app = await bootFreshCount(browser, { branch: 'SRC', role: 'pharmacist' });
    const { page } = app;
    await seedItems(PROJECT_ID, 'SRC', app.epoch, [
      { sku: 'S-NORM', status: 'scanning', countedQty: 3, barcode: 'S-NORM-B' },
      { sku: 'S-F05', status: 'scanning', countedQty: 2, barcode: 'S-F05-B' },
    ]);
    await waitSeen(page, 'S-NORM'); await waitSeen(page, 'S-F05');
    const run = (parallel) => page.evaluate(async ({ parallel, snap }) => {
      LOGIN_PARALLEL_READ = parallel;
      try { await restoreFromFirestore(true); } finally { LOGIN_PARALLEL_READ = true; }
      return (new Function('return (' + snap + ')()'))();
    }, { parallel, snap: SNAP.toString() });
    const seq = await run(false);
    const par = await run(true);
    // กันเทสผ่านเปล่าๆ — ต้องโหลดของครบจริงทั้งสองโหมด
    expect(seq.skus).toBeGreaterThanOrEqual(MIN_SKUS);
    expect(seq.pm).toBeGreaterThan(0);
    expect(seq.epoch).toBe(app.epoch);
    expect(seq.scan).toEqual([['S-F05', 'scanning', 2], ['S-NORM', 'scanning', 3]]);
    expect(seq.total).toBeGreaterThan(0);
    expect(par).toEqual(seq);
    await closeApp(app);
  });

  test('ข. backup เก่า (epoch เก่า) แต่ Cloud เริ่มนับใหม่แล้ว → items อ่านด้วย epoch ของ session ที่เพิ่งอ่าน · ของรอบเก่าไม่โผล่ (ทั้งสองโหมด)', async ({ browser }) => {
    const app = await bootFreshCount(browser, { branch: 'SRC', role: 'pharmacist' });
    const { page } = app;
    const OLD_EPOCH = '2026-01-01T00:00:00.000Z';
    await seedItems(PROJECT_ID, 'SRC', app.epoch, [{ sku: 'S-NORM', status: 'scanning', countedQty: 4, barcode: 'S-NORM-B' }]);
    // เศษของรอบเก่าที่ยังค้างบน Cloud (doc id = SKU ใช้ร่วมทุกรอบ) — ต้องไม่ถูกอ่านเข้ามา
    await seedItems(PROJECT_ID, 'SRC', app.epoch, [{ sku: 'S-F05', status: 'scanning', countedQty: 9, barcode: 'S-F05-B', countResetAt: OLD_EPOCH }]);
    await waitSeen(page, 'S-NORM');
    const run = (parallel) => page.evaluate(async ({ parallel, oldEpoch, snap }) => {
      LOGIN_PARALLEL_READ = parallel;
      // จำลองเครื่องที่เปิดค้าง/มี backup ของรอบก่อน: epoch ในเครื่องเก่ากว่า Cloud, มี catalog + scanData อยู่แล้ว (เข้าเส้นทาง !force && hasLocal)
      _countResetAt = oldEpoch;
      state.scanData.set('S-F05', { ...state.scanData.get('S-F05'), status: 'scanning', countedQty: 7, scannedBy: 'Tester', timestamp: '2026-01-01 09:00:00' });
      try { await restoreFromFirestore(false); } finally { LOGIN_PARALLEL_READ = true; }
      return (new Function('return (' + snap + ')()'))();
    }, { parallel, oldEpoch: OLD_EPOCH, snap: SNAP.toString() });
    const seq = await run(false);
    const par = await run(true);
    expect(seq.epoch, 'ต้องรับ epoch ใหม่จาก session').toBe(app.epoch);
    expect(seq.scan).toEqual([['S-NORM', 'scanning', 4]]);           // รอบนี้มีแค่ S-NORM · S-F05 ของรอบเก่า/ยอดเก่าในเครื่องต้องไม่อยู่
    expect(par).toEqual(seq);
    await closeApp(app);
  });
});
