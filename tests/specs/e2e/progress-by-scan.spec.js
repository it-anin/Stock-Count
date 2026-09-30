// Counted / Pass / Progress ของสาขายา นับตามที่สแกน — เส้นทางจริงบน emulator (ก.ย. 2026 · สวิตช์ PROGRESS_BY_SCAN)
//   A. เพื่อน PDA สแกน → ทั้ง PDA อีกเครื่องและ Desktop ขยับผ่าน listener จริง (_refreshScanCounters ไม่มี updateStats) · เพื่อนกด ✕ → ลดทั้งคู่
//   B. Desktop กด Confirm จริง → ตัวเลข "เท่ากันทุกจอ": Counted/Progress คงเดิม · Pass นับเฉพาะ pass (Stock Adj ไม่นับ)
//   C. เปิดเครื่องใหม่ทีหลัง (login) เห็นตัวเลขตรงกับที่สแกนไว้แล้ว — เส้นทางโหลด items จาก Cloud ไม่ใช่แค่ listener
// logic ล้วน (นิยามการ์ด · kill switch · WH · ตัวกรอง "ยังไม่ได้นับ") อยู่ที่ specs/logic/progress-by-scan.spec.js
const { test, expect, closeApp, requireEmulator } = require('../../lib/hooks');
const { bootFreshCount, bootJoinCount, armR16, PROJECT_ID } = require('../../lib/scenario');
const { waitForDoc } = require('../../lib/emulator');
const { seedItems } = require('../../lib/seed');
const F = require('../../lib/fixtures');

const N = F.COUNTABLE_COUNT;                       // ตัวหาร Progress ของ fixture
const pctOf = (k) => `${Math.round(k / N * 100)}%`;

async function scanTimes(page, barcode, times) {
  await page.evaluate(({ barcode, times }) => {
    for (let i = 0; i < times; i++) scanQueue.push(parseScanLine(barcode));
    drainQueue();
  }, { barcode, times });
}

// รอจนการ์ดเป็นค่าที่ต้องการ (listener/Confirm มาถึงแบบ async) — polling 100 ms ตามแนวของโปรเจกต์
const waitCards = (page, want, timeout = 20000) => page.waitForFunction(
  (w) => ['statCounted', 'statPass', 'progressCount', 'statPct'].every((id, i) => document.getElementById(id).textContent === [w.counted, w.pass, w.progress, w.pct][i]),
  want, { timeout, polling: 100 },
);
const want = (counted, pass) => ({ counted: String(counted), pass: String(pass), progress: `${counted} / ${N}`, pct: pctOf(counted) });

test.describe('Counted/Pass/Progress ตามสแกน (emulator)', () => {
  test.beforeEach(() => requireEmulator());
  test.setTimeout(120_000);

  test('A. เพื่อน PDA สแกน → PDA อีกเครื่อง + Desktop ขยับ (listener) · เพื่อนกด ✕ → ลด · ไม่เรียก updateStats ต่อสแกนของเพื่อน', async ({ browser }) => {
    const desk = await bootFreshCount(browser, { role: 'pharmacist', user: 'Pharm', mode: 'desktop' });
    const a = await bootJoinCount(browser, { role: 'assistant', user: 'PDA-A', mode: 'pda', expectEpoch: desk.epoch });
    const b = await bootJoinCount(browser, { role: 'assistant', user: 'PDA-B', mode: 'pda', expectEpoch: desk.epoch });
    for (const dev of [desk, a, b]) expect(await dev.page.evaluate(() => _progressByScanOn())).toBe(true);
    await waitCards(desk.page, want(0, 0));
    await waitCards(b.page, want(0, 0));

    // นับ updateStats ฝั่งเครื่องที่ "ดูเพื่อนสแกน" — สแกนล้วนของเพื่อนต้องเดินเส้นทางเบา (_refreshScanCounters) ไม่ใช่ updateStats ทั้งก้อน
    for (const dev of [desk, b]) {
      await dev.page.evaluate(() => {
        window.__statsCalls = 0;
        const orig = window.updateStats;
        window.updateStats = function () { window.__statsCalls++; return orig.apply(this, arguments); };
      });
    }

    await scanTimes(a.page, 'B-NORM', 1);
    await scanTimes(a.page, 'B-F05', 1);
    await a.page.evaluate(() => _flushDirtySkus());
    await waitForDoc(PROJECT_ID, 'stock_sessions/SRC/items/S-F05', (d) => d && d.status === 'scanning');
    await waitCards(a.page, want(2, 0));       // เครื่องที่สแกนเอง
    await waitCards(b.page, want(2, 0));       // PDA อีกเครื่อง ไม่ได้สแกนเองแต่เห็น 2 SKU ที่ A สแกน
    await waitCards(desk.page, want(2, 0));    // Desktop เห็นเท่ากัน — ยังไม่ Confirm สักตัว
    for (const dev of [desk, b]) {
      expect(await dev.page.evaluate(() => window.__statsCalls), 'สแกนล้วนของเพื่อนต้องไม่กวาด catalog ด้วย updateStats').toBe(0);
    }

    // A กด ✕ ลบ S-F05 → เอกสารถูกลบบน cloud → ทุกเครื่องลดเหลือ 1
    await a.page.evaluate(() => removeScanItem('S-F05'));
    await waitCards(a.page, want(1, 0));
    await waitCards(b.page, want(1, 0));
    await waitCards(desk.page, want(1, 0));

    await closeApp(b);
    await closeApp(a);
    await closeApp(desk);
  });

  test('B. Desktop Confirm จริง → ตัวเลขเท่ากันทุกจอ: Counted/Progress คงเดิม · Pass นับเฉพาะ pass (Stock Adj ไม่นับ)', async ({ browser }) => {
    const desk = await bootFreshCount(browser, { role: 'pharmacist', user: 'Pharm', mode: 'desktop' });
    await armR16(desk.page);
    const pda = await bootJoinCount(browser, { role: 'assistant', user: 'PDA-A', mode: 'pda', expectEpoch: desk.epoch });

    await scanTimes(pda.page, 'B-NORM', 10);                     // S-NORM sys 10 → นับ 10 = pass
    await scanTimes(pda.page, 'B-F05', 3);                       // S-F05 sys 5 → นับ 3 = ไม่ตรง → Stock Adj ตรง (สาขายา ไม่ผ่าน Audit)
    await waitCards(pda.page, want(2, 0));                       // สแกนแล้ว: ขยับทันที · ยังไม่มี Pass เพราะยังไม่ Confirm
    await pda.page.evaluate(() => _flushDirtySkus());
    await pda.page.waitForFunction(() => _dirtySkus.size === 0 && _scanItemInFlight.size === 0 && !_scanItemFlushing,
      null, { timeout: 20000, polling: 100 });
    await waitCards(desk.page, want(2, 0));                      // Desktop เห็นเท่า PDA ตั้งแต่ก่อน Confirm (เดิมเป็น 0)

    await desk.page.evaluate(() => validateAndProcess());
    await waitForDoc(PROJECT_ID, 'stock_sessions/SRC/items/S-NORM', (d) => d && d.status === 'pass', { timeout: 25000 });
    await waitForDoc(PROJECT_ID, 'stock_sessions/SRC/items/S-F05', (d) => d && d.status === 'stock_adjustment');

    await waitCards(pda.page, want(2, 1));                       // Counted/Progress คงเดิม · Pass = S-NORM ตัวเดียว
    await waitCards(desk.page, want(2, 1));                      // Desktop = PDA เป๊ะ (เดิม Desktop เห็น Pass 2 เพราะนับ Stock Adj)

    await closeApp(pda);
    await closeApp(desk);
  });

  test('C. เปิดเครื่องใหม่ทีหลัง (login) เห็นตัวเลขตรงกับที่สแกนไว้แล้ว — Desktop และ PDA', async ({ browser }) => {
    const desk = await bootFreshCount(browser, { role: 'pharmacist', user: 'Pharm', mode: 'desktop' });
    // ของที่มีอยู่ก่อนแล้วใน Cloud: 2 ตัวสแกนค้าง (scanning) + 1 ตัว Confirm เป็น pass แล้ว · S-PRICEY ยังไม่สแกน
    await seedItems(PROJECT_ID, 'SRC', desk.epoch, [
      { sku: 'S-NORM', status: 'scanning', countedQty: 3, scannedBy: 'PDA-A' },
      { sku: 'S-F05', status: 'scanning', countedQty: 2, scannedBy: 'PDA-A' },
      { sku: 'S-MULTI', status: 'pass', auditStatus: 'approved', initialStatus: 'pass', countedQty: 60, scannedBy: 'PDA-A' },
    ]);

    const late = await bootJoinCount(browser, { role: 'assistant', user: 'PDA-Late', mode: 'pda', expectEpoch: desk.epoch });
    await late.page.waitForFunction(() => state.scanData.get('S-NORM')?.status === 'scanning' && state.scanData.get('S-MULTI')?.status === 'pass',
      null, { timeout: 20000, polling: 100 });
    await waitCards(late.page, want(3, 1));                      // สแกนแล้ว 3 (scanning×2 + pass) · Pass จริง 1

    // Desktop ที่เปิดอยู่ก่อนแล้ว รับ items ที่ seed ผ่าน listener → ต้องเท่ากัน
    await desk.page.waitForFunction(() => state.scanData.get('S-NORM')?.status === 'scanning', null, { timeout: 20000, polling: 100 });
    await waitCards(desk.page, want(3, 1));

    await closeApp(late);
    await closeApp(desk);
  });
});
