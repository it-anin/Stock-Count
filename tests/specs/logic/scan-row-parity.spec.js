// แถว RESULT: เส้นทาง "ใส่แถวเดียว" (SCAN_INCREMENTAL_ROW) ต้องให้ผลบนจอเท่า "render เต็ม" ทุกสแกน (ก.ย. 2026)
//
// เทียบ snapshot ที่สร้างจาก DOM (ไม่ใช่ innerHTML — patchScanRow ตั้ง input.value เป็น property ซึ่งไม่สะท้อนใน attribute)
// รันลำดับสแกนเดียวกันสองรอบในหน้าเดียวกัน: รอบแรกปิดสวิตช์ (render เต็มทุกครั้ง = พฤติกรรมเดิม) รอบสองเปิดสวิตช์
// แล้วเทียบ snapshot ทีละสแกน — ผ่านเปล่าไม่ได้: ต้องมีการใส่แถวเดียวจริง (inserted) มากกว่าที่ fallback (ตรวจนับด้วย)
// ไม่ใช้ emulator/Firestore: _adminMode=true ตัด _markSkuDirty / inbox / sync ออก เหลือเฉพาะเส้นทาง state + DOM ที่ต้องการวัด
const { test, expect, newAppContext, waitForAppReady, closeApp } = require('../../lib/hooks');

const ROLES = [
  { name: 'ผู้ช่วยสาขายา · PDA', role: 'assistant', branch: 'SRC', user: 'PDA-A', mode: 'pda' },
  { name: 'พนักงานคลัง · PDA', role: 'warehouse', branch: 'WH', user: 'W-A', mode: 'pda' },
  { name: 'หัวหน้าคลัง · Desktop (มีคอลัมน์ Sys Qty/Location)', role: 'supervisor', branch: 'WH', user: 'มายด์', mode: 'desktop' },
  { name: 'เภสัช · Desktop', role: 'pharmacist', branch: 'SRC', user: 'Ph', mode: 'desktop' },
];

async function bootBareMode(browser, mode) {
  const app = await newAppContext(browser, { login: false, mode });
  await app.page.goto('/index.html');
  await waitForAppReady(app.page, { login: false });
  return app;
}

// โค้ดที่รันในหน้า — ประกอบเป็นสตริงเดียวเพื่อใช้ซ้ำทุกเคส
const IN_PAGE = `
  window.__setup = ({ role, branch, user, catalog }) => {
    const p = (i) => String(i).padStart(3, '0');
    for (let i = 0; i < catalog; i++) {
      const sku = 'ROW-' + p(i);
      state.productMasterData.push({ sku, productName: 'Synthetic ' + sku, unitPrice: 20, cat: 'A' });
      state.r01Data.push({ colE: sku, productName: 'Synthetic ' + sku, systemQty: 5 });
      state.r05Data.push({ barcode: 'RB-' + p(i), colE: sku, unitName: 'TAB', unitMultiplier: 1, unitPrice: 20 });
    }
    rebuildMaps();
    currentRole = role; currentBranch = branch; currentUser = user;
    _adminMode = true;   // ตัด Firestore/inbox/sync — เหลือเฉพาะ state + DOM
  };
  window.__snap = () => {
    const body = document.getElementById('scanListBody');
    return {
      banner: (body.querySelector('.scan-list-limit') || {}).textContent || null,
      empty: !!body.querySelector('.scan-list-empty'),
      rows: [...body.querySelectorAll('.scan-row')].map((r) => {
        const q = r.querySelector('.scan-row-qty');
        const inp = q.querySelector('input');
        return {
          key: r.dataset.sku, style: r.getAttribute('style'),
          sku: r.querySelector('.scan-row-sku .sku-text')?.textContent, remove: !!r.querySelector('.btn-remove-row'),
          bc: r.querySelector('.scan-row-bc')?.textContent, pn: r.querySelector('.scan-row-pn')?.textContent.trim(),
          qty: inp ? inp.value : q.textContent.trim(), qtyIsInput: !!inp, qtyColor: q.getAttribute('style'),
          status: r.querySelector('.pill')?.textContent, pill: r.querySelector('.pill')?.className, cells: r.children.length,
        };
      }),
    };
  };
  window.__reset = () => {
    scanQueue.length = 0; _pendingPatches.clear(); scanListMap.clear();
    for (const k of [...state.scanData.keys()]) state.scanData.set(k, { countedQty: 0, status: 'pending', retries: 0, timestamp: '', scannedBy: '', auditor: '', auditStatus: 'pending', barcode: '', location: '', scans: [] });
    state.unknownScans = []; _listCleared = false; renderScanList();
  };
  // ห่อ insertScanRowTop เพื่อนับว่าเส้นทางใส่แถวเดียวถูกใช้จริงกี่ครั้ง
  window.__counts = { inserted: 0, fellBack: 0 };
  { const orig = window.insertScanRowTop; window.insertScanRowTop = function (k) { const r = orig.call(this, k); r ? window.__counts.inserted++ : window.__counts.fellBack++; return r; }; }
  // groups = [[line,...], ...] — แต่ละกลุ่มถูก push รวมแล้ว drain ครั้งเดียว (กลุ่มที่มีหลายบรรทัด = หลายสแกนใน drain เดียว)
  window.__run = (flag, groups) => {
    SCAN_INCREMENTAL_ROW = flag; __reset(); __counts.inserted = 0; __counts.fellBack = 0;
    const steps = [];
    for (const g of groups) { for (const line of g) scanQueue.push(parseScanLine(line)); drainQueue(); steps.push(__snap()); }
    return { steps, counts: { ...__counts } };
  };
`;

const one = (lines) => lines.map((l) => [l]);
const bc = (i) => 'RB-' + String(i).padStart(3, '0');

// 40 SKU ใหม่ติดกัน → ผ่านเพดาน 30 แถว (banner "แสดง 30 / N" + ตัดแถวท้าย)
const SEQ_OVERFLOW = one(Array.from({ length: 40 }, (_, i) => bc(i)));
// ผสม: ใหม่ · ซ้ำ · Unknown · Unknown ซ้ำ · ซ้ำตัวเก่า (ถูกดันลงล่างแล้ว) · ใหม่
const SEQ_MIXED = one([bc(0), bc(1), bc(0), bc(2), 'ZZ-NOPE-1', bc(3), 'ZZ-NOPE-1', bc(1), bc(4), bc(5), bc(2), 'ZZ-NOPE-2', bc(6)]);
// หลายสแกนใน drain เดียว (เดินเส้นทางเดิม) ผสมกับสแกนเดี่ยว
const SEQ_BATCHED = [[bc(0)], [bc(1), bc(2)], [bc(1), bc(3), bc(1)], [bc(4)], [bc(5), 'ZZ-NOPE-3'], [bc(6)]];

for (const cfg of ROLES) {
  test.describe(`parity · ${cfg.name}`, () => {
    for (const [label, groups, expectIncremental] of [['เกินเพดาน 30 แถว', SEQ_OVERFLOW, true], ['ผสม ใหม่/ซ้ำ/Unknown', SEQ_MIXED, true], ['หลายสแกนใน drain เดียว', SEQ_BATCHED, false]]) {
      test(label, async ({ browser }) => {
        const app = await bootBareMode(browser, cfg.mode);
        const { full, inc } = await app.page.evaluate(({ IN_PAGE, cfg, groups }) => {
          (0, eval)(IN_PAGE);
          __setup({ role: cfg.role, branch: cfg.branch, user: cfg.user, catalog: 60 });
          const full = __run(false, groups);   // พฤติกรรมเดิม: render เต็มทุก drain
          const inc = __run(true, groups);     // ใส่แถวเดียวเมื่อแตะ key เดียวและเป็นแถวใหม่
          return { full, inc };
        }, { IN_PAGE, cfg, groups });

        // ทีละสแกน: ผลบนจอต้องเท่ากันทุกจุด (ไล่หาจุดแรกที่ต่างเพื่อรายงานให้อ่านง่าย)
        expect(inc.steps).toHaveLength(full.steps.length);
        for (let i = 0; i < full.steps.length; i++) expect(inc.steps[i], `สแกนที่ ${i + 1} ต่างจาก render เต็ม`).toEqual(full.steps[i]);

        if (expectIncremental) {
          // ต้องใช้เส้นทางใส่แถวเดียวจริง (ไม่ใช่ผ่านเปล่าเพราะ fallback หมด) — fallback ได้เฉพาะครั้งแรก (placeholder ว่าง)
          expect(inc.counts.inserted).toBeGreaterThan(inc.counts.fellBack);
          expect(inc.counts.fellBack).toBeLessThanOrEqual(1);
        }
        await closeApp(app);
      });
    }
  });
}

test.describe('parity · ความทนทาน', () => {
  test('DOM ถูกแก้/ไม่สอดคล้องกับ scanListMap → fallback render เต็ม ผลยังถูก (ไม่ใส่แถวทับซ้อน)', async ({ browser }) => {
    const app = await bootBareMode(browser, 'pda');
    const r = await app.page.evaluate(({ IN_PAGE }) => {
      (0, eval)(IN_PAGE);
      __setup({ role: 'assistant', branch: 'SRC', user: 'PDA-A', catalog: 60 });
      SCAN_INCREMENTAL_ROW = true; __reset();
      for (const b of ['RB-000', 'RB-001', 'RB-002']) { scanQueue.push(parseScanLine(b)); drainQueue(); }
      document.querySelector('#scanListBody .scan-row:last-child').remove();   // จำลอง DOM หลุดจาก scanListMap
      __counts.inserted = 0; __counts.fellBack = 0;
      scanQueue.push(parseScanLine('RB-003')); drainQueue();
      const got = __snap();
      renderScanList();
      return { got, expected: __snap(), counts: { ...__counts } };
    }, { IN_PAGE });
    expect(r.counts).toEqual({ inserted: 0, fellBack: 1 });   // ตรวจพบว่าไม่สอดคล้อง → ไม่ใส่แถวเดียว
    expect(r.got).toEqual(r.expected);                        // ผลสุดท้ายเท่า render เต็ม
    expect(r.got.rows.map((x) => x.key)).toEqual(['ROW-003', 'ROW-002', 'ROW-001', 'ROW-000']);
    await closeApp(app);
  });

  test('แถวแรกสุด (มี placeholder "รอการสแกน...") → render เต็มก่อน แล้วสแกนถัดไปจึงใส่แถวเดียว', async ({ browser }) => {
    const app = await bootBareMode(browser, 'pda');
    const r = await app.page.evaluate(({ IN_PAGE }) => {
      (0, eval)(IN_PAGE);
      __setup({ role: 'assistant', branch: 'SRC', user: 'PDA-A', catalog: 60 });
      SCAN_INCREMENTAL_ROW = true; __reset();
      const before = document.getElementById('scanListBody').querySelector('.scan-list-empty') !== null;
      scanQueue.push(parseScanLine('RB-000')); drainQueue();
      const c1 = { ...__counts };
      scanQueue.push(parseScanLine('RB-001')); drainQueue();
      return { before, c1, c2: { ...__counts }, empty: __snap().empty, keys: __snap().rows.map((x) => x.key) };
    }, { IN_PAGE });
    expect(r.before).toBe(true);
    expect(r.c1).toEqual({ inserted: 0, fellBack: 1 });
    expect(r.c2).toEqual({ inserted: 1, fellBack: 1 });
    expect(r.empty).toBe(false);
    expect(r.keys).toEqual(['ROW-001', 'ROW-000']);
    await closeApp(app);
  });

  test('SCAN_INCREMENTAL_ROW=false → ไม่ใช้เส้นทางใส่แถวเดียวเลย (kill switch)', async ({ browser }) => {
    const app = await bootBareMode(browser, 'pda');
    const r = await app.page.evaluate(({ IN_PAGE }) => {
      (0, eval)(IN_PAGE);
      __setup({ role: 'assistant', branch: 'SRC', user: 'PDA-A', catalog: 60 });
      const out = __run(false, [['RB-000'], ['RB-001'], ['RB-002']]);
      return out.counts;
    }, { IN_PAGE });
    expect(r).toEqual({ inserted: 0, fellBack: 0 });
    await closeApp(app);
  });
});
