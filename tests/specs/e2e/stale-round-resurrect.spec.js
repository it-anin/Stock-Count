// เหตุการณ์จริง SRC ก.ย. 2026 — กด "เริ่มนับใหม่" แล้วรายการของรอบเก่ากลับมาเป็น Pass ในรอบใหม่
//
// ต้นเหตุ 2 ชั้น (รายละเอียด: tools/diagnose-reset-resurrect.js · CLAUDE.md กฎ 0):
//   1. startNewCount ลบ items รอบเก่าไม่เสร็จ (ถูกรีโหลดกลางคัน) → เอกสารรอบเก่าค้างอยู่ใต้ doc id เดียวกับ SKU
//      แล้ว _writeScanningItem เปิดเจอสถานะ pass ของรอบเก่า → คิดว่า "เครื่องอื่น Confirm แล้ว" → เอามาแทน
//      ยอดที่เพิ่งสแกน · สแกนซ้ำระหว่างรอ transaction ทำให้ SKU ค้าง dirty → เขียนผลรอบเก่ากลับขึ้นไปในนามรอบใหม่
//      (ลายเซ็นบน production: rev 2 = rev 1 ของเอกสารรอบเก่า + 1)
//   2. schema v2 ไม่มีด่าน "ของที่ Confirm แล้วในเครื่อง แต่ Cloud รอบนี้ไม่มี ห้ามดันกลับ" (รุ่น blob เคยมี)
//      → เครื่องที่ localStorage ถือผลเก่าไว้ login ใหม่แล้ว reconcile ดันขึ้นไป (ลายเซ็น: rev 1 · batch เดียวกัน)
const { test, expect, closeApp, requireEmulator } = require('../../lib/hooks');
const { bootFreshCount, bootJoinCount, PROJECT_ID } = require('../../lib/scenario');
const { seedItems } = require('../../lib/seed');
const { waitForDoc, getDoc, setDoc } = require('../../lib/emulator');

const OLD_EPOCH = '2026-07-19T02:39:21.626Z'; // รอบก่อนหน้าของ SRC ตัวจริง — เก่ากว่าทุกรอบที่เทสสร้าง
const ITEM = (sku) => `stock_sessions/SRC/items/${sku}`;

function nowTs() {
  const d = new Date(); const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
async function scanOnce(page, line) {
  await page.evaluate((l) => { scanQueue.push(parseScanLine(l)); drainQueue(); }, line);
}
async function quiesce(page) {
  await page.waitForFunction(() => !_scanItemFlushing && !_scanItemInFlight.size, null, { timeout: 15000, polling: 100 });
}
const localOf = (page, sku) => page.evaluate((s) => {
  const d = state.scanData.get(s);
  return d ? { status: d.status, countedQty: d.countedQty, firstScanAt: d.firstScanAt || '', scannedBy: d.scannedBy || '' } : null;
}, sku);

test.describe('stale round items must not resurrect into a new count', () => {
  test.beforeEach(() => requireEmulator());
  test.setTimeout(90_000);

  test('scan over a leftover confirmed doc from an OLDER round → counts normally, old result never comes back', async ({ browser }) => {
    const a = await bootFreshCount(browser, { role: 'assistant', user: 'PDA-A', mode: 'pda' });
    expect(OLD_EPOCH < a.epoch).toBe(true);
    // เศษรอบเก่าที่ startNewCount ลบไม่หมด — รูปเดียวกับที่ migrate/confirm เขียนไว้ (rev 1)
    await seedItems(PROJECT_ID, 'SRC', OLD_EPOCH, [{
      sku: 'S-F05', status: 'pass', auditStatus: 'approved', initialStatus: 'pass', auditor: '',
      countedQty: 7, scannedBy: 'OldRound', barcode: 'B-F05',
      firstScanAt: '2026-07-19 09:53:24', timestamp: '2026-07-19 09:53:25', rev: 1,
    }]);

    // ยิงครั้งแรก → flush → ระหว่างรอ transaction ยิงซ้ำอีกครั้ง (จังหวะนับของหลายชิ้นติดกันตามปกติของหน้างาน)
    await scanOnce(a.page, 'B-F05');
    await a.page.evaluate(() => {
      const p = _flushDirtySkus();
      scanQueue.push(parseScanLine('B-F05')); drainQueue();
      return p;
    });
    await quiesce(a.page);
    await a.page.evaluate(() => _flushDirtySkus());
    await quiesce(a.page);

    // เครื่องนี้ต้องยังนับต่อได้ ไม่ใช่ถูกเปลี่ยนเป็น pass ของรอบเก่า
    const local = await localOf(a.page, 'S-F05');
    expect(local.status).toBe('scanning');
    expect(local.countedQty).toBe(2);
    expect(local.firstScanAt).not.toMatch(/^2026-07-19/);

    // บน Cloud ต้องกลายเป็นเอกสารของรอบนี้ที่มียอดสแกนวันนี้ ไม่ใช่ผลรอบเก่าที่ติดป้ายรอบใหม่
    const doc = await waitForDoc(PROJECT_ID, ITEM('S-F05'), (d) => d && d.countResetAt === a.epoch && d.countedQty === 2, { timeout: 20000 });
    expect(doc.status).toBe('scanning');
    expect(doc.scannedBy).toBe('PDA-A');
    expect(String(doc.firstScanAt)).not.toMatch(/^2026-07-19/);
    await closeApp(a);
  });

  test('same-round confirm that lands while a PDA is still scanning → PDA adopts the confirmed result (unchanged behavior)', async ({ browser }) => {
    const a = await bootFreshCount(browser, { role: 'assistant', user: 'PDA-A', mode: 'pda' });

    // กัน flush ไว้ก่อน เพื่อให้ Desktop "Confirm แทรก" ได้ระหว่างที่ PDA ยังถือ scanning ค้าง
    await a.page.evaluate(() => { _scanItemBackoffUntil = Date.now() + 60_000; });
    await scanOnce(a.page, 'B-F07');
    await a.page.waitForFunction(() => state.scanData.get('S-F07')?.status === 'scanning' && _dirtySkus.has('S-F07'), null, { polling: 100 });

    // ผลยืนยันของ "รอบนี้" จากเครื่องอื่น
    await setDoc(PROJECT_ID, ITEM('S-F07'), {
      sku: 'S-F07', countResetAt: a.epoch, status: 'pass', auditStatus: 'approved', initialStatus: 'pass', auditor: '',
      countedQty: 7, scannedBy: 'Desk', barcode: 'B-F07', firstScanAt: nowTs(), timestamp: nowTs(), rev: 3, updatedBy: 'Desk',
    }, { merge: false });

    await a.page.evaluate(() => { _scanItemBackoffUntil = 0; _scanItemFailStreak = 0; return _flushDirtySkus(); });
    await quiesce(a.page);

    const local = await localOf(a.page, 'S-F07');
    expect(local.status).toBe('pass');
    expect(local.countedQty).toBe(7);
    const doc = await getDoc(PROJECT_ID, ITEM('S-F07'));
    expect(doc.rev).toBe(3);          // scanning สดต้องไม่เขียนทับผลที่ยืนยันแล้ว
    expect(doc.countedQty).toBe(7);
    await closeApp(a);
  });

  test('login with a stale local cache: confirmed items missing from the current round are dropped, offline scans still sync', async ({ browser }) => {
    const a = await bootFreshCount(browser, { role: 'pharmacist', user: 'Desk-A', mode: 'desktop' });
    const ts = nowTs();
    // localStorage ของเครื่องที่ปิดไปตอนยังถือผลรอบเก่า (ป้ายรอบตรงกับ Cloud แต่ Cloud ไม่มีเอกสารนั้นแล้ว)
    // + ยอดที่สแกนออฟไลน์ค้างไว้วันนี้ ซึ่งต้องยังขึ้น Cloud ได้ตามปกติ
    const localSession = {
      countResetAt: a.epoch,
      scanData: {
        'S-F06': { countedQty: 7, status: 'pass', auditStatus: 'approved', initialStatus: 'pass', scannedBy: 'OldRound', auditor: '',
          barcode: 'B-F06', location: '', firstScanAt: '2026-07-19 09:53:24', timestamp: '2026-07-19 09:53:25' },
        'S-F08': { countedQty: 2, status: 'scanning', auditStatus: 'pending', scannedBy: 'PDA-B', auditor: '',
          barcode: 'B-F08', location: '', firstScanAt: ts, timestamp: ts },
      },
      unknownScans: [], scanListMap: {},
    };
    const b = await bootJoinCount(browser, { role: 'assistant', user: 'PDA-B', mode: 'pda', expectEpoch: a.epoch, localSession });
    // precondition: login ต้องวิ่งเส้นทาง "ใช้ข้อมูลในเครื่อง" จริง (ยอดออฟไลน์ยังอยู่) — ถ้าหลุดไปเส้นทาง
    // full-replace ที่ล้างทุกอย่าง เทสนี้จะผ่านแบบไม่ได้พิสูจน์อะไร
    expect(await localOf(b.page, 'S-F08')).toMatchObject({ status: 'scanning', countedQty: 2 });

    await b.page.evaluate(async () => { _reconcileScanItems(); await _flushDirtySkus(); });
    await quiesce(b.page);

    // ยอดสแกนออฟไลน์ของรอบนี้ต้องขึ้น Cloud ตามเดิม
    await waitForDoc(PROJECT_ID, ITEM('S-F08'), (d) => d && d.countResetAt === a.epoch && d.countedQty === 2 && d.status === 'scanning', { timeout: 20000 });
    // ผลรอบเก่าต้องไม่ถูกดันขึ้นไป และในเครื่องต้องกลับเป็น "ยังไม่ได้นับ"
    expect(await getDoc(PROJECT_ID, ITEM('S-F06'))).toBeNull();
    expect((await localOf(b.page, 'S-F06')).status).toBe('pending');

    await closeApp(b);
    await closeApp(a);
  });
});
