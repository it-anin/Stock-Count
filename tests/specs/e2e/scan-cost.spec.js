// ต้นทุนงานหลังสแกนบน PDA (ก.ย. 2026) — วัด "ฟังก์ชันไหนถูกเรียกกี่ครั้ง / กินกี่ ms ต่อสแกน" บน catalog ขนาดจริง (~5,400 SKU)
//
// ทำไมต้องมี: ผู้ใช้ต้องการให้สแกนต่อเนื่องบน PDA ลื่นขึ้น · PDA สแกนห่างกัน ~1-3 วิ ซึ่งกว้างกว่าทุก debounce
// (80/400/800/1000 ms) จึงไม่ใช่ "รวมสแกนรัว" แต่เป็น "งานต่อสแกน 1 ครั้ง" ที่ต้องเบา
//
// เทสนี้มี 2 ส่วน:
//   1) วัด (พิมพ์ตาราง ไม่ assert เวลา — flaky) : จำนวนครั้ง + ms รวม + long task ภายใต้ CPU 4× (จำลอง PDA)
//      opt-in เพราะช้า (~50 วิ/เคส): SCAN_COST_MEASURE=1 npm run test:e2e -- scan-cost   (ปรับ SCAN_COST_CPU / SCAN_COST_GAP_MS ได้)
//   2) assert เชิงจำนวนครั้ง (deterministic) — ตรึงหลักการ "สแกนล้วนไม่ต้องคำนวณทั้ง catalog ซ้ำ" · รันทุกครั้งใน npm test
//
// ⚠️ catalog สังเคราะห์เท่านั้น (BIG-xxxxx) — ห้ามนำข้อมูลจริงเข้า repo
const { test, expect, closeApp, requireEmulator } = require('../../lib/hooks');
const { bootFreshCount, bootJoinCount, PROJECT_ID } = require('../../lib/scenario');
const { adminDb } = require('../../lib/emulator');

const BIG_SKUS = 5400;
// ปรับได้ด้วย env: SCAN_COST_CPU (ค่าเริ่มต้น 4 · PDA ระดับล่าง ≈ 6) / SCAN_COST_GAP_MS (ค่าเริ่มต้น 600 · หน้างานจริง ≈ 1500)
const CPU_RATE = Number(process.env.SCAN_COST_CPU) || 4;            // Emulation.setCPUThrottlingRate — จำลอง WebView บน PDA
const SCAN_GAP_MS = Number(process.env.SCAN_COST_GAP_MS) || 600;    // สแกนห่างกันมากกว่าทุก debounce ของแอป (สมจริงกว่ายิงรัว)
const SETTLE_MS = 5500;        // รอให้ syncToFirestore (3 วิหลัง saveSession) + flush ทำงานจบ

const FN = [
  'updateStats', 'renderScanList', 'rebuildScanListMap', 'patchScanRow',
  'saveSession', '_reconcileScanItems', '_flushDirtySkus', '_syncSessionMetaToFirestore',
  'updateConfirmBtn', 'updatePharmacistAuditConfirmBtn', 'updateWhResultTabs',
];

const pad = (n) => String(n).padStart(5, '0');

// ลำดับสแกน: ใหม่,ใหม่,ใหม่,ซ้ำตัวก่อนหน้า (ให้ทั้งเส้นทาง insert แถวใหม่ และ patch แถวเดิม) + Unknown 1 ครั้ง
function makeSequence(n) {
  const seq = [];
  let next = 0;
  for (let k = 0; k < n; k++) {
    if (k === 5) seq.push('ZZ-UNKNOWN-1');
    else if (k % 4 === 3) seq.push(seq[k - 1]);
    else seq.push('BB-' + pad(next++));
  }
  return seq;
}

async function injectBigCatalog(page, n) {
  await page.evaluate((n) => {
    const p = (i) => String(i).padStart(5, '0');
    for (let i = 0; i < n; i++) {
      const sku = 'BIG-' + p(i);
      state.productMasterData.push({ sku, productName: 'Synthetic ' + sku, unitPrice: 20, cat: 'A' });
      state.r01Data.push({ colE: sku, productName: 'Synthetic ' + sku, systemQty: 5 });
      state.r05Data.push({ barcode: 'BB-' + p(i), colE: sku, unitName: 'TAB', unitMultiplier: 1, unitPrice: 20 });
    }
    rebuildMaps();
    invalidatePopupRowsCache();
    updateStats();
  }, n);
  const size = await page.evaluate(() => state.skuMap.size);
  expect(size, 'catalog สังเคราะห์ต้องครบ').toBeGreaterThanOrEqual(n);
}

// wrap ฟังก์ชัน global (function declaration = property ของ window) ด้วยตัวนับ + เวลาส่วน sync
// ฟังก์ชัน async วัดได้เฉพาะช่วงก่อน await แรก — พอสำหรับดูว่าถูกเรียกกี่ครั้ง
async function instrument(page, names) {
  await page.evaluate((names) => {
    window.__cost = {};
    window.__lt = { n: 0, total: 0, max: 0 };
    for (const name of names) {
      const orig = window[name];
      if (typeof orig !== 'function' || orig.__wrapped) continue;
      window.__cost[name] = { calls: 0, ms: 0, callers: {} };
      const wrapper = function (...args) {
        const t = performance.now();
        // ใครเรียก: เอาชื่อฟังก์ชัน/บรรทัดจาก stack (ช่วยไล่ว่าคลื่นลูกที่สองมาจาก listener ตัวไหน)
        const line = (new Error().stack || '').split('\n')[2] || '';
        const m = line.match(/at (?:async )?([^ (]+)/);
        const who = (m ? m[1] : '?') + ':' + ((line.match(/:(\d+):\d+\)?$/) || [])[1] || '?');
        const c0 = window.__cost[name]; c0.callers[who] = (c0.callers[who] || 0) + 1;
        try { return orig.apply(this, args); }
        finally { const c = window.__cost[name]; c.calls++; c.ms += performance.now() - t; }
      };
      wrapper.__wrapped = true;
      wrapper.__orig = orig;
      window[name] = wrapper;
    }
    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) { window.__lt.n++; window.__lt.total += e.duration; window.__lt.max = Math.max(window.__lt.max, e.duration); }
      }).observe({ entryTypes: ['longtask'] });
    } catch (e) { /* longtask ไม่รองรับ = ข้าม */ }
  }, names);
}
const resetCost = (page) => page.evaluate(() => {
  for (const k of Object.keys(window.__cost)) window.__cost[k] = { calls: 0, ms: 0, callers: {} };
  window.__lt = { n: 0, total: 0, max: 0 };
});
const readCost = (page) => page.evaluate(() => ({ cost: window.__cost, lt: window.__lt }));

async function throttle(page, rate) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate });
  return cdp;
}

const scanBarcode = (page, bc) => page.evaluate((bc) => { scanQueue.push(parseScanLine(bc)); drainQueue(); }, bc);

async function runScans(page, seq, gapMs = SCAN_GAP_MS) {
  for (const bc of seq) {
    await scanBarcode(page, bc);
    await page.waitForTimeout(gapMs);
  }
}

function printTable(title, { cost, lt }, scans) {
  const rows = Object.entries(cost)
    .map(([fn, c]) => {
      const top = Object.entries(c.callers || {}).sort((x, y) => y[1] - x[1]).slice(0, 4).map(([w, n]) => `${w}×${n}`).join(' ');
      return `  ${fn.padEnd(34)} ${String(c.calls).padStart(5)} calls  ${(c.calls / scans).toFixed(2).padStart(6)}/scan  ${c.ms.toFixed(1).padStart(9)} ms  ${(c.ms / scans).toFixed(2).padStart(8)} ms/scan` + (c.calls ? `   ← ${top}` : '');
    })
    .join('\n');
  console.log(`\n=== ${title} — ${scans} scans ห่าง ${SCAN_GAP_MS} ms, catalog ${BIG_SKUS}, CPU ${CPU_RATE}× ===\n${rows}\n  long tasks (>50ms): ${lt.n} ครั้ง · รวม ${lt.total.toFixed(0)} ms · สูงสุด ${lt.max.toFixed(0)} ms\n  (ms ของ _syncSessionMetaToFirestore รวมช่วงที่เรียก _reconcileScanItems — นับซ้อน)`);
}

test.describe('ต้นทุนหลังสแกน (catalog ~5,400 SKU) — วัด · opt-in', () => {
  test.beforeEach(() => { test.skip(!process.env.SCAN_COST_MEASURE, 'ตั้ง SCAN_COST_MEASURE=1 เพื่อวัด'); requireEmulator(); });
  test.setTimeout(240_000);

  test('วัด · PDA ผู้ช่วยสาขายา (SRC) — RESULT เริ่มว่าง _listCleared=true', async ({ browser }) => {
    const a = await bootFreshCount(browser, { role: 'assistant', user: 'PDA-A', mode: 'pda' });
    await injectBigCatalog(a.page, BIG_SKUS);
    await instrument(a.page, FN);
    await throttle(a.page, CPU_RATE);
    await resetCost(a.page);

    const seq = makeSequence(24);
    await runScans(a.page, seq);
    await a.page.waitForTimeout(SETTLE_MS);

    printTable('PDA assistant SRC', await readCost(a.page), seq.length);
    // ความถูกต้องพื้นฐาน: ทุก SKU ที่สแกนต้องอยู่ใน state และมีแถวบนจอ
    const ok = await a.page.evaluate(() => ({ scanning: [...state.scanData.values()].filter((d) => d.status === 'scanning').length, rows: document.querySelectorAll('#scanListBody .scan-row').length }));
    expect(ok.scanning).toBeGreaterThan(0);
    expect(ok.rows).toBeGreaterThan(0);
    await closeApp(a);
  });

  test('วัด · PDA คลัง (WH warehouse) สแกน + Desktop หัวหน้าคลังดูอยู่ (echo/เครื่องอื่นสแกน)', async ({ browser }) => {
    const desk = await bootFreshCount(browser, { branch: 'WH', role: 'supervisor', user: 'มายด์', mode: 'desktop' });
    const pda = await bootJoinCount(browser, { branch: 'WH', role: 'warehouse', user: 'W-A', mode: 'pda', expectEpoch: desk.epoch });
    await injectBigCatalog(desk.page, BIG_SKUS);
    await injectBigCatalog(pda.page, BIG_SKUS);
    await instrument(desk.page, FN);
    await instrument(pda.page, FN);
    await throttle(desk.page, CPU_RATE);
    await throttle(pda.page, CPU_RATE);
    await resetCost(desk.page);
    await resetCost(pda.page);

    const seq = makeSequence(24);
    await runScans(pda.page, seq);
    await pda.page.waitForTimeout(SETTLE_MS);

    printTable('WH warehouse PDA (ผู้สแกน)', await readCost(pda.page), seq.length);
    printTable('WH supervisor Desktop (ผู้สังเกตการณ์ — งานที่เกิดจากเครื่องอื่นสแกน)', await readCost(desk.page), seq.length);
    await closeApp(pda);
    await closeApp(desk);
  });
});

// ───────────────────────────────────────────────────────────────────────────────────────────────
// ตรึงหลักการ (deterministic) — ห้ามแก้ให้หลวมลงโดยไม่วัดซ้ำด้วย SCAN_COST_MEASURE=1
// ───────────────────────────────────────────────────────────────────────────────────────────────
const SMALL_CATALOG = 200;                 // พอสำหรับสแกน 20 SKU ใหม่ — ไม่ต้องใช้ catalog เต็มเพราะเทสนับ "จำนวนครั้ง" ไม่ใช่เวลา
const skuRows = (page) => page.evaluate(() => [...document.querySelectorAll('#scanListBody .scan-row')].map((r) => ({
  key: r.dataset.sku,
  qty: (r.querySelector('.scan-row-qty input') || r.querySelector('.scan-row-qty')).value ?? r.querySelector('.scan-row-qty').textContent.trim(),
})));

test.describe('หลักการ: สแกนล้วนไม่ต้องคำนวณทั้ง catalog ซ้ำ (นับจำนวนครั้ง)', () => {
  test.beforeEach(() => requireEmulator());
  test.setTimeout(120_000);

  async function assistantRun(browser, { light }) {
    const a = await bootFreshCount(browser, { role: 'assistant', user: 'PDA-A', mode: 'pda' });
    await injectBigCatalog(a.page, SMALL_CATALOG);
    await a.page.evaluate((light) => { SCAN_LIGHT_REFRESH = light; }, light);
    await instrument(a.page, FN);
    await resetCost(a.page);
    await runScans(a.page, makeSequence(20), 150);   // 20 สแกน: ใหม่ 14 · ซ้ำ 5 · Unknown 1 — ห่างกว่า debounce 80 ms ทุกครั้ง
    await a.page.waitForTimeout(400);
    return { a, ...(await readCost(a.page)) };
  }

  test('PDA ผู้ช่วย · สแกน 20 ครั้งไม่เรียก updateStats ต่อสแกน · แถว/ลำดับ/ยอดถูก · Unknown ขึ้นทันที · backup รวมงานแต่ครบ', async ({ browser }) => {
    const { a, cost } = await assistantRun(browser, { light: true });

    // เพดาน 3 (ไม่ใช่ 0/1): listener/timer ช่วงบูตของแอปอาจตกเข้ามาในหน้าต่าง ~3.5 วิได้ 1-2 ครั้ง (เคยเจอ 2 ครั้งเดียวตอน cold start
    // รัน 9 รอบไม่ซ้ำ) ซึ่งไม่เกี่ยวกับสแกน · baseline ก่อนแก้ ≈ 20 ต่อ 20 สแกน จึงยังจับการย้อนกลับได้ชัด
    // ข้อความ assertion พิมพ์ "ใครเรียก" ไว้ด้วย — ถ้าเกินขึ้นมาจะไล่ต้นตอได้ทันที ไม่ต้องเดา
    expect(cost.updateStats.calls, `สแกนล้วนเปลี่ยนผล updateStats ไม่ได้ — ห้ามเรียกทั้ง catalog ต่อสแกน (baseline ≈ 20) · ผู้เรียก: ${JSON.stringify(cost.updateStats.callers)}`).toBeLessThanOrEqual(3);
    expect(cost.saveSession.calls, `backup ต้องรวมงาน — baseline ≈ 20 ครั้ง · ผู้เรียก: ${JSON.stringify(cost.saveSession.callers)}`).toBeLessThanOrEqual(2);
    expect(await a.page.evaluate(() => document.getElementById('statUnknown').textContent)).toBe('1');

    // ผลที่ผู้ใช้เห็นต้องเท่าเดิม: 14 SKU + 1 Unknown · ใหม่สุดบนสุด · แถวที่สแกนซ้ำถูกย้ายขึ้นและยอดรวม 2
    const rows = await skuRows(a.page);
    expect(rows).toHaveLength(15);
    expect(rows[0]).toEqual({ key: 'BIG-00013', qty: '2' });
    expect(rows[1].key).toBe('BIG-00012');
    expect(rows.some((r) => r.key === 'unknown:ZZ-UNKNOWN-1')).toBe(true);

    // ครบถ้วน: หลังหน้าต่าง trailing ของ backup ผ่านไป ต้องมี 20 สแกนใน localStorage (ยอดซ้ำรวมแล้ว)
    await a.page.waitForTimeout(4600);
    const saved = await a.page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem('stockCountSession_SRC') || '{}');
      return { first: s.scanData?.['BIG-00000']?.countedQty, dup: s.scanData?.['BIG-00002']?.countedQty, unknown: (s.unknownScans || []).length };
    });
    expect(saved).toEqual({ first: 1, dup: 2, unknown: 1 });
    await closeApp(a);
  });

  test('kill switch: SCAN_LIGHT_REFRESH=false → กลับพฤติกรรมเดิม (ทุกสแกนคำนวณ stats) — พิสูจน์ว่าย้อนกลับได้จริง', async ({ browser }) => {
    const { a, cost } = await assistantRun(browser, { light: false });
    expect(cost.updateStats.calls).toBeGreaterThanOrEqual(15);
    await closeApp(a);
  });

  test('WH PDA คลัง · tab จำนวนเดินตามสแกนทันที โดยไม่ต้องคำนวณ stats ทั้ง catalog', async ({ browser }) => {
    const pda = await bootFreshCount(browser, { branch: 'WH', role: 'warehouse', user: 'W-A', mode: 'pda' });
    await injectBigCatalog(pda.page, SMALL_CATALOG);
    await instrument(pda.page, FN);
    await resetCost(pda.page);
    await runScans(pda.page, Array.from({ length: 5 }, (_, i) => 'BB-' + pad(i)), 150);
    expect(await pda.page.evaluate(() => document.getElementById('whTabResultCount').textContent)).toBe('(5)');
    expect((await readCost(pda.page)).cost.updateStats.calls).toBeLessThanOrEqual(1);
    await closeApp(pda);
  });

  test('Desktop หัวหน้าคลัง · เพื่อนสแกนล้วน → ปุ่มนับรายพนักงานอัปเดต โดยไม่เรียก updateStats ต่อสแกน · แต่ Confirm ยังอัปเดตการ์ดทันที', async ({ browser }) => {
    const desk = await bootFreshCount(browser, { branch: 'WH', role: 'supervisor', user: 'มายด์', mode: 'desktop' });
    const pda = await bootJoinCount(browser, { branch: 'WH', role: 'warehouse', user: 'W-A', mode: 'pda', expectEpoch: desk.epoch });
    await injectBigCatalog(desk.page, SMALL_CATALOG);
    await injectBigCatalog(pda.page, SMALL_CATALOG);
    await instrument(desk.page, FN);
    await resetCost(desk.page);

    // ห่าง 900 ms > SCAN_ITEM_FLUSH_MS (800) → PDA flush ทีละสแกน → Desktop ได้ snapshot ทีละครั้ง (baseline: updateStats ต่อ snapshot)
    await runScans(pda.page, Array.from({ length: 8 }, (_, i) => 'BB-' + pad(i)), 900);
    await pda.page.evaluate(() => _flushDirtySkus());
    await desk.page.waitForFunction(
      () => [...document.querySelectorAll('#supervisorCountBtns button')].some((b) => b.title === 'Confirm: W-A (8)'),
      null, { timeout: 20_000, polling: 100 },
    );   // จำนวนต่อพนักงานที่ supervisor ใช้กดยืนยัน ต้องไม่ค้าง (นับ scanning ต่อคน — updateStats เต็มไม่ได้ทำให้)
    expect((await readCost(desk.page)).cost.updateStats.calls, 'เพื่อนสแกนล้วนเปลี่ยน stats ไม่ได้ (baseline ≥ 8)').toBeLessThanOrEqual(3);

    // สถานะเปลี่ยนจริง (Confirm จากที่อื่น) ต้องยังอัปเดตการ์ดทันที — กันการ "ข้าม" ที่กว้างเกินไป
    await adminDb(PROJECT_ID).doc('stock_sessions/WH/items/BIG-00000').update({ status: 'pass', auditStatus: 'approved' });
    await desk.page.waitForFunction(() => document.getElementById('statPass').textContent === '1', null, { timeout: 15_000, polling: 100 });
    await closeApp(pda);
    await closeApp(desk);
  });

  test('backup ในเครื่อง: pagehide flush ทันที · ออนไลน์รอ trailing · ออฟไลน์บันทึกเร็วกว่า', async ({ browser }) => {
    const a = await bootFreshCount(browser, { role: 'assistant', user: 'PDA-A', mode: 'pda' });
    await injectBigCatalog(a.page, SMALL_CATALOG);
    const savedStatus = (sku) => a.page.evaluate((sku) => JSON.parse(localStorage.getItem('stockCountSession_SRC') || '{}').scanData?.[sku]?.status || null, sku);

    await a.page.evaluate(() => saveSession());               // baseline: ทุก SKU ยัง pending
    expect(await savedStatus('BIG-00000')).toBe('pending');
    await scanBarcode(a.page, 'BB-00000');
    await a.page.waitForTimeout(1200);
    expect(await savedStatus('BIG-00000'), 'ออนไลน์: ยังไม่ save ภายใน trailing 4 วิ').toBe('pending');
    await a.page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    expect(await savedStatus('BIG-00000'), 'ปิดหน้า/ไป background ต้อง flush ทันที').toBe('scanning');

    await a.context.setOffline(true);
    await a.page.evaluate(() => { SAVE_OFFLINE_DEBOUNCE_MS = 300; SAVE_OFFLINE_MAXWAIT_MS = 600; });
    await scanBarcode(a.page, 'BB-00001');
    await a.page.waitForTimeout(1200);
    expect(await savedStatus('BIG-00001'), 'ออฟไลน์ backup ในเครื่องคือสำเนาเดียว — ต้องเร็วกว่า').toBe('scanning');
    await a.context.setOffline(false);
    await closeApp(a);
  });
});
