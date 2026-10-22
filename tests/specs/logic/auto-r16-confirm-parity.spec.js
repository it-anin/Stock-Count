// parity: ตัวประเมิน Confirm ของบอท auto-r16 (Python) ต้องให้ผล "เดียวกันทุกฟิลด์" กับ Confirm ของหน้าเว็บ (ต.ค. 2026)
//
// ทำไมต้องมี: บอทกด Confirm แทน Desktop ตอนกลางคืนโดยไม่มีคนเฝ้า — สูตรตัดสิน Pass/Stock Adj ถูกเขียนไว้ 2 ภาษา
// (_buildPendingScanEvaluation + _applyPendingScanEvaluation ใน index.html กับ evaluate_candidate + item_changes ในบอท)
// หลุดจากกันเมื่อไร = ผลตัดสินผิดแล้วเขียนลง Firestore เงียบๆ (Stock Adj ปลอมลง ERP / Pass ปลอมกลบของขาด)
//
// ⚠️ ฝั่ง JS เป็นโค้ดจริงของหน้าเว็บทั้งหมด (rebuildMaps → _applyWhR16Rows('104') → _buildPendingScanEvaluation → _applyPendingScanEvaluation)
//    ห้าม re-implement ที่นี่ · ฝั่ง Python import ฟังก์ชันจริงของบอท — ต้องมี Python 3 (ไม่มี = เทสล้ม ไม่ skip เงียบ)
// เทียบ 3 อย่าง: (1) skuMap ที่ rebuildMaps() สร้าง (systemQty/ชื่อ/DEL) (2) ผลตัดสินต่อรายการ (3) item ทั้งก้อนหลัง apply (ทุกฟิลด์ที่ Confirm แตะ)
// เทสชุดนี้ไม่ต้องใช้ Firestore emulator (หน้าเว็บบูตแบบ bare) — เทียบ "ตรรกะ" ล้วน · ส่วน REST/rules อยู่ที่ e2e/auto-r16-confirm.spec.js
const { test, expect, bootBare, closeApp } = require('../../lib/hooks');
const { runPython } = require('../../lib/python');
const F = require('../../lib/r16-104-fixture');

const BRANCHES = ['SRC', 'KKL', 'SSS'];
const DAY = '2026-10-13';

// ── ฝั่งหน้าเว็บ: โค้ดจริงของ Confirm ────────────────────────────────────────
async function webRun(page, sc) {
  return page.evaluate(({ branch, pm, r01, r05, timeline, items, direct }) => {
    currentBranch = branch; currentRole = 'pharmacist'; currentUser = 'Tester'; _r01BaselineAt = '';
    PHARMACY_DIRECT_STOCK_ADJ = direct;
    state.scanData.clear();
    state.r01Data = r01;
    state.productMasterData = pm;
    state.productMasterMap.clear();
    pm.forEach((r) => state.productMasterMap.set(r.sku, r.productName));
    state.r05Data = _parseR05Json(_serializeR05(r05));   // เหมือนที่ restore/listener อ่านกลับมา
    rebuildMaps();
    _applyWhR16Rows('104', timeline);                     // เหมือน _loadPharmacyR16Timeline (timeline ที่บอทเผยแพร่)
    for (const [sku, it] of Object.entries(items)) state.scanData.set(sku, JSON.parse(JSON.stringify(it)));
    const out = {};
    for (const sku of Object.keys(items)) {
      const sd = state.scanData.get(sku);
      const r = _buildPendingScanEvaluation(sku, sd);
      if (!r) { out[sku] = null; continue; }
      _applyPendingScanEvaluation(r);
      out[sku] = {
        res: { cnt: r.cnt, soldQty: r.soldQty, inboundQty: r.inboundQty, r16103Qty: r.r16103Qty, status: r.status,
          auditStatus: r.auditStatus, effectiveCnt: r.effectiveCnt, sys: r.sys, direct: r.direct },
        sd: JSON.parse(JSON.stringify(state.scanData.get(sku))),
      };
    }
    const skuMap = {};
    for (const [k, v] of state.skuMap) skuMap[k] = { systemQty: v.systemQty, productName: v.productName, isDel: v.isDel };
    return { skuMap, out };
  }, sc);
}

// ── ฝั่งบอท: ฟังก์ชันจริงของ auto_r16_import.py ─────────────────────────────
function pyRun(sc) {
  return runPython(`
infos = m.build_sku_infos(p['pm'], p['r01'])
tl = m.timeline_maps(p['timeline'])
out = {}
for sku, it in p['items'].items():
    r = m.evaluate_candidate(sku, it, infos, tl, direct_enabled=p['direct'])
    if r is None:
        out[sku] = None
        continue
    merged = dict(it)
    merged.update(m.item_changes(it, r))
    out[sku] = {'res': {'cnt': r['cnt'], 'soldQty': r['sold'], 'inboundQty': r['inbound'], 'r16103Qty': r['r103'], 'status': r['status'],
                        'auditStatus': r['auditStatus'], 'effectiveCnt': r['eff'], 'sys': r['sys'], 'direct': r['direct']}, 'sd': merged}
print(json.dumps({'skuMap': infos, 'out': out}, ensure_ascii=False))
`, sc);
}

// เทียบทั้งชุด: skuMap + ผลต่อรายการ + item หลัง apply
function expectParity(web, py, label) {
  expect(py.skuMap, `${label}: skuMap (systemQty/ชื่อ/DEL) ต้องตรงที่ rebuildMaps() สร้าง`).toEqual(web.skuMap);
  expect(Object.keys(py.out).sort(), `${label}: ชุด SKU ที่ประเมิน`).toEqual(Object.keys(web.out).sort());
  for (const sku of Object.keys(web.out)) {
    expect(py.out[sku], `${label}: ${sku}`).toEqual(web.out[sku]);
  }
}

// ── ตัวสร้างสถานการณ์ (กำหนดผลได้ด้วย seed) ─────────────────────────────────
const SYS = [-3, -1, 0, 0, 1, 2, 3, 5, 5, 7, 10, 12, 0.5, 2.5];
const CNT = [0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 12, 0.5, 2.5];
const QTY = [1, 2, 3, 4, 0.1, 0.2, 0.3, 2.5, 10, 7];
const pad = (n) => String(n).padStart(2, '0');
const skuName = (n) => 'S-' + pad(n);

// เวลา (h,m,s) → ข้อความ TRANDATE หลายรูปแบบที่ ProMaxx/ตัวอ่านของแอปรองรับ (รูปแบบไม่มีวินาที = ปัดเป็น :00)
function fmtTran(kind, h, m, s) {
  const ampm = (hh) => `${((hh + 11) % 12) + 1}:${pad(m)} ${hh < 12 ? 'AM' : 'PM'}`;
  switch (kind) {
    case 0: return `13/10/2026 ${pad(h)}:${pad(m)}:${pad(s)}`;
    case 1: return `13/10/2026 ${h}:${pad(m)}`;
    case 2: return `13/10/2026 ${ampm(h)}`;
    case 3: return `13-10-26 ${h}:${pad(m)}`;
    case 4: return `13/10/2026 ${h}:${pad(m)}:${pad(s)}`;
    default: return '';
  }
}

function genScenario(seed, branch, { direct = true } = {}) {
  const r = F.rng(seed);
  const pm = Array.from({ length: 30 }, (_, i) => ({ sku: skuName(i + 1), productName: 'PM ' + skuName(i + 1), unitPrice: 10 }))
    .concat([{ sku: 'PM-ONLY', productName: 'pm only', unitPrice: 10 }]);
  const r01 = [];
  for (let n = 16; n <= 40; n++) {                      // S-16..S-30 อยู่ทั้ง PBM+R01 · S-31..S-40 = DEL (R01 อย่างเดียว)
    r01.push({ colE: skuName(n), systemQty: F.pick(r, SYS), productName: r() < 0.7 ? 'R01 ' + skuName(n) : '' });
    if (r() < 0.25) r01.push({ colE: skuName(n), systemQty: F.pick(r, SYS), productName: r() < 0.5 ? 'R01b ' + skuName(n) : '' });   // ซ้ำ: PBM = ท้ายสุดชนะ · DEL = แถวแรกชนะ
  }
  const r05 = Array.from({ length: 40 }, (_, i) => ({ barcode: 'B-' + pad(i + 1), colE: skuName(i + 1), unitName: 'EA', unitMultiplier: 1, unitPrice: 10 }))
    .concat([{ barcode: 'B-PM', colE: 'PM-ONLY', unitName: 'EA', unitMultiplier: 1, unitPrice: 10 }]);

  // ยอดระบบที่ rebuildMaps() จะได้ (ไว้ทำให้บางรายการนับ = ระบบ จะได้มี Pass พอให้เทียบ): PBM = แถว R01 ท้ายสุดชนะ · DEL = แถวแรกชนะ · PBM ไม่มีแถว R01 = 0
  const pmSet = new Set(pm.map((x) => x.sku));
  const sysOf = {};
  for (const row of r01) if (pmSet.has(row.colE) || !(row.colE in sysOf)) sysOf[row.colE] = row.systemQty;
  const sysFor = (sku) => (sku in sysOf ? sysOf[sku] : pmSet.has(sku) ? 0 : undefined);

  const names = Array.from({ length: 40 }, (_, i) => skuName(i + 1)).concat(['PM-ONLY', 'NOPE-9']);   // NOPE-9 ไม่อยู่ใน skuMap
  const items = {};
  const timeline = [];
  for (const sku of names) {
    const st = r();
    const status = st < 0.84 ? 'scanning' : st < 0.89 ? 'pending' : st < 0.94 ? 'pass' : 'stock_adjustment';
    const h = 8 + Math.floor(r() * 12), mi = Math.floor(r() * 60), se = Math.floor(r() * 60);
    const tr = r();
    const timestamp = tr < 0.90 ? `${DAY} ${pad(h)}:${pad(mi)}:${pad(se)}` : tr < 0.93 ? '' : tr < 0.95 ? undefined : tr < 0.97 ? 'garbage' : `${DAY}T${pad(h)}:${pad(mi)}:${pad(se)}`;
    const want = sysFor(sku);
    const it = { countedQty: r() < 0.35 && want !== undefined && want >= 0 ? want : F.pick(r, CNT), status, retries: 0, timestamp, scannedBy: 'พนักงาน', auditor: '', auditStatus: 'pending', barcode: '', location: '' };
    if (r() < 0.10) it.noStock = true;
    if (r() < 0.12) it.initialStatus = F.pick(r, ['pass', 'scanning', 'stock_adjustment']);
    if (timestamp === undefined) delete it.timestamp;
    items[sku] = it;

    // แถว timeline ของ SKU นี้ (ประมาณ 60%) วางรอบเวลาสแกน: ก่อน / ตรงเป๊ะ / หลัง 1 วินาที / หลังเยอะ / วันที่อ่านไม่ได้ / ว่าง
    if (r() < 0.6) {
      const base = h * 3600 + mi * 60 + se;
      const mkRows = (key) => Array.from({ length: Math.floor(r() * 4) }, () => {
        const kind = Math.floor(r() * 7);                   // 5,6 = ว่าง/อ่านไม่ได้
        const q = F.pick(r, QTY);
        if (kind >= 5) return { [key]: q, tranDate: kind === 5 ? '' : 'garbage' };
        const place = r();
        const delta = place < 0.25 ? 0 : place < 0.45 ? -1 : place < 0.65 ? 1 : place < 0.8 ? -3600 : place < 0.9 ? 600 : -60;
        const t = Math.max(0, Math.min(23 * 3600 + 3599, base + delta));
        const hh = Math.floor(t / 3600), mm = Math.floor((t % 3600) / 60), ss = t % 60;
        return { [key]: q, tranDate: fmtTran(kind, hh, mm, ss) };
      });
      const rawS = mkRows('soldQty'), rawI = mkRows('qty');
      const totS = rawS.reduce((a, x) => a + x.soldQty, 0), totI = rawI.reduce((a, x) => a + x.qty, 0);
      timeline.push([sku, totS, totI, rawS, rawI]);
    }
  }
  return { branch, pm, r01, r05, timeline, items, direct };
}

for (const seed of [20261013, 7, 424242, 99, 31337]) {
  test(`fuzz seed ${seed} — 3 สาขา × ~40 รายการสุ่ม: ผลตัดสิน + item หลัง apply ต้องตรงเว็บทุกฟิลด์`, async ({ browser }) => {
    test.setTimeout(120_000);
    const app = await bootBare(browser);
    let evaluated = 0, passN = 0, adjN = 0, directN = 0, nulls = 0;
    for (const b of BRANCHES) {
      const sc = genScenario(seed + b.charCodeAt(0), b);
      const web = await webRun(app.page, sc);
      const py = pyRun(sc);
      expectParity(web, py, `${b} seed ${seed}`);
      for (const v of Object.values(web.out)) {
        if (!v) { nulls++; continue; }
        evaluated++;
        if (v.res.status === 'pass') passN++; else adjN++;
        if (v.res.direct) directN++;
      }
    }
    // ชุดสุ่มต้องครอบเส้นทางสำคัญจริง ไม่ใช่ผ่านเพราะไม่มีอะไรให้เทียบ
    expect(evaluated, 'มีรายการให้เทียบ').toBeGreaterThan(60);
    expect(passN, 'มีรายการ Pass').toBeGreaterThan(5);
    expect(adjN, 'มีรายการ Stock Adj').toBeGreaterThan(5);
    expect(directN, 'มี Stock Adj ตรง (directAdj)').toBeGreaterThan(3);
    expect(nulls, 'มีรายการที่ไม่ถูกประเมิน (ไม่ใช่ scanning / ไม่อยู่ใน skuMap)').toBeGreaterThan(3);
    await closeApp(app);
  });
}

test('ปิด PHARMACY_DIRECT_STOCK_ADJ — ผลตัดสินต้องตรงเว็บ (ไม่ตรง = audit/pending) แม้บอทจะไม่เขียนในโหมดนี้', async ({ browser }) => {
  const app = await bootBare(browser);
  for (const b of BRANCHES) {
    const sc = genScenario(555 + b.charCodeAt(0), b, { direct: false });
    const web = await webRun(app.page, sc);
    const py = pyRun(sc);
    expectParity(web, py, `${b} direct=false`);
    const statuses = new Set(Object.values(web.out).filter(Boolean).map((v) => v.res.status));
    expect(statuses.has('audit'), 'สวิตช์ปิด: ต้องมีรายการ audit').toBe(true);
    expect([...Object.values(web.out)].filter(Boolean).some((v) => v.res.direct)).toBe(false);
  }
  await closeApp(app);
});

// ── เคสที่เขียนมือ: ความหมายต้องตรงกติกา (ไม่ใช่แค่ตรงกันเอง) ───────────────
function handCase(name, { sys = 5, count, sold = [], inbound = [], noStock = false, ts = `${DAY} 15:00:00`, initialStatus, status = 'scanning' }) {
  const rawS = sold.map(([q, at]) => ({ soldQty: q, tranDate: at }));
  const rawI = inbound.map(([q, at]) => ({ qty: q, tranDate: at }));
  const sum = (a, k) => a.reduce((x, y) => x + y[k], 0);
  const it = { countedQty: count, status, retries: 0, timestamp: ts, scannedBy: 'พนักงาน', auditor: '', auditStatus: 'pending', barcode: '', location: '' };
  if (noStock) it.noStock = true;
  if (initialStatus) it.initialStatus = initialStatus;
  const sku = 'S-20';
  return {
    name,
    sc: {
      branch: 'SSS', pm: [{ sku, productName: 'PM', unitPrice: 10 }],
      r01: [{ colE: sku, systemQty: sys, productName: 'R01' }],
      r05: [{ barcode: 'B-20', colE: sku, unitName: 'EA', unitMultiplier: 1, unitPrice: 10 }],
      timeline: (rawS.length || rawI.length) ? [[sku, sum(rawS, 'soldQty'), sum(rawI, 'qty'), rawS, rawI]] : [],
      items: { [sku]: it }, direct: true,
    },
    sku,
  };
}

const HAND = [
  // [ชื่อเคส, อินพุต, ผลที่คาดตามกติกา (สถานะ, direct, effectiveCnt)]
  ['นับตรงระบบ → Pass', { sys: 5, count: 5 }, 'pass', false, 5],
  ['ขายก่อนสแกน 3 ชดเชย → Pass (นับ 7 + ขาย 3 = ระบบ 10) · ขายหลังสแกนไม่นับ', { sys: 10, count: 7, sold: [[3, '13/10/2026 14:00:00'], [4, '13/10/2026 16:30:00']] }, 'pass', false, 10],
  ['ขายเวลาเดียวกับสแกนพอดี (td <= scan) → นับรวม', { sys: 9, count: 7, sold: [[2, '13/10/2026 15:00:00']] }, 'pass', false, 9],
  ['ขายหลังสแกน 1 วินาที → ไม่นับ → Stock Adj ตรง', { sys: 9, count: 7, sold: [[2, '13/10/2026 15:00:01']] }, 'stock_adjustment', true, 7],
  ['รับเข้าก่อนสแกนต้องหักออก (นับ 8 − รับ 3 = ระบบ 5) → Pass', { sys: 5, count: 8, inbound: [[3, '13/10/2026 09:00:00']] }, 'pass', false, 5],
  ['ไม่ตรง → Stock Adj ตรง แช่ effectiveQty/systemQty', { sys: 5, count: 3 }, 'stock_adjustment', true, 3],
  ['noStock + นับ 0 + ระบบมีของ → Stock Adj (ไม่ใช่ directAdj)', { sys: 4, count: 0, noStock: true }, 'stock_adjustment', false, 0],
  ['noStock แต่ระบบ 0 และนับ 0 → Pass (eff = sys ก่อน)', { sys: 0, count: 0, noStock: true }, 'pass', false, 0],
  ['noStock แต่นับได้ 2 → ไม่เข้ากติกา noStock → Stock Adj ตรง', { sys: 4, count: 2, noStock: true }, 'stock_adjustment', true, 2],
  ['ระบบติดลบ −2 + รับเข้า 5 + นับ 3 → 3 − 5 = −2 → Pass', { sys: -2, count: 3, inbound: [[5, '13/10/2026 10:00:00']] }, 'pass', false, -2],
  ['ระบบติดลบ −2 + นับ 0 (อธิบายไม่ได้) → Stock Adj ตรง', { sys: -2, count: 0 }, 'stock_adjustment', true, 0],
  ['ทศนิยม 0.1 + 0.2 ต้องปัดเศษแบบเดียวกับ JS (ไม่ใช่ Decimal)', { sys: 0.3, count: 0, sold: [[0.1, '13/10/2026 10:00:00'], [0.2, '13/10/2026 11:00:00']] }, 'stock_adjustment', true, 0.30000000000000004],
  ['ไม่มีเวลาสแกน → ใช้ยอดรวมทั้งไฟล์ (fallback เดิมของแอป)', { sys: 10, count: 5, sold: [[5, '13/10/2026 20:00:00']], ts: '' }, 'pass', false, 10],
  ['วันที่ของแถวขายอ่านไม่ได้ → ไม่นับ', { sys: 8, count: 5, sold: [[3, 'garbage'], [3, '']] }, 'stock_adjustment', true, 5],
  ['initialStatus ที่มีอยู่เดิมต้องไม่ถูกทับ', { sys: 5, count: 5, initialStatus: 'stock_adjustment' }, 'pass', false, 5],
];

for (const [name, inp, status, direct, eff] of HAND) {
  test(`เคสกติกา — ${name}`, async ({ browser }) => {
    const app = await bootBare(browser);
    const c = handCase(name, inp);
    const web = await webRun(app.page, c.sc);
    const py = pyRun(c.sc);
    expectParity(web, py, name);
    const v = web.out[c.sku];
    expect(v.res.status, 'สถานะตามกติกา').toBe(status);
    expect(v.res.direct, 'directAdj').toBe(direct);
    expect(v.res.effectiveCnt, 'effectiveQty').toBe(eff);
    if (direct) { expect(v.sd.directAdj).toBe(true); expect(v.sd.effectiveQty).toBe(eff); expect(v.sd.systemQty).toBe(inp.sys); }
    else { expect(v.sd.directAdj).toBeUndefined(); expect(v.sd.effectiveQty).toBeUndefined(); }
    await closeApp(app);
  });
}

test('ไม่ใช่ scanning / SKU ไม่อยู่ใน skuMap → ไม่ประเมิน (ทั้งเว็บและบอทปล่อยไว้เหมือนกัน)', async ({ browser }) => {
  const app = await bootBare(browser);
  const c = handCase('x', { sys: 5, count: 5 });
  c.sc.items['NOPE-9'] = { ...c.sc.items[c.sku] };
  c.sc.items['S-21'] = { ...c.sc.items[c.sku], status: 'pass' };
  c.sc.items['S-22'] = { ...c.sc.items[c.sku], status: 'pending' };
  const web = await webRun(app.page, c.sc);
  const py = pyRun(c.sc);
  expectParity(web, py, 'null cases');
  expect(web.out['NOPE-9']).toBeNull();
  expect(web.out['S-21']).toBeNull();
  expect(web.out['S-22']).toBeNull();
  expect(web.out[c.sku]).not.toBeNull();
  await closeApp(app);
});

test('catalog: PBM ว่าง → skuMap = R01 ล้วน · แถวซ้ำในR01 → ท้ายสุดชนะ (PBM) / แถวแรกชนะ (DEL) · ตรงที่ rebuildMaps() สร้าง', async ({ browser }) => {
  const app = await bootBare(browser);
  for (const pmOn of [false, true]) {
    const sc = {
      branch: 'KKL',
      pm: pmOn ? [{ sku: 'A', productName: 'ชื่อ PBM A', unitPrice: 1 }, { sku: 'B', productName: '', unitPrice: 1 }, { sku: 'C', productName: 'C', unitPrice: 1 }] : [],
      r01: [
        { colE: 'A', systemQty: 1, productName: 'R01 A แรก' }, { colE: 'A', systemQty: 9, productName: 'R01 A หลัง' },
        { colE: 'B', systemQty: 4, productName: 'R01 B' }, { colE: 'B', systemQty: 6, productName: '' },
        { colE: 'D', systemQty: 2, productName: 'DEL D แรก' }, { colE: 'D', systemQty: 8, productName: 'DEL D หลัง' },
        { colE: 'E', systemQty: -5, productName: '' },
      ],
      r05: [{ barcode: 'BA', colE: 'A', unitName: 'EA', unitMultiplier: 1, unitPrice: 10 }],
      timeline: [], items: {}, direct: true,
    };
    const web = await webRun(app.page, sc);
    const py = pyRun(sc);
    expectParity(web, py, `pm=${pmOn}`);
    if (pmOn) {
      expect(web.skuMap.A.systemQty, 'PBM: ท้ายสุดชนะ').toBe(9);
      expect(web.skuMap.B.productName, 'ชื่อว่างใน PBM → ชื่อล่าสุดที่ไม่ว่างจาก R01').toBe('R01 B');
      expect(web.skuMap.C.systemQty, 'ไม่มีแถว R01 → 0').toBe(0);
      expect(web.skuMap.D, 'DEL: แถวแรกชนะ').toEqual({ systemQty: 2, productName: 'DEL D แรก', isDel: true });
      expect(web.skuMap.E.systemQty, 'ติดลบเก็บค่าดิบ ไม่ clamp').toBe(-5);
    }
  }
  await closeApp(app);
});

// ── เวลาสแกน: parse_scan_ts ต้องอ่านค่าเดียวกับ new Date(ts.replace(' ','T')) ของแอป ──────────────────
test('parse_scan_ts เหมือน new Date(ts.replace(" ","T")) ของแอป (รูปแบบที่แอปเขียนเอง) · รูปแบบแปลก = บอทถือว่าอ่านไม่ได้', async ({ browser }) => {
  const app = await bootBare(browser);
  const ok = ['2026-10-13 08:00:00', '2026-10-13 20:59:59', '2026-10-13T10:11:12', '2026-01-01 00:00:00', '2026-12-31 23:59:59', '2026-02-28 12:00:00'];
  const odd = ['', 'garbage', '2026-10-13', '2026-10-13 8:05:03', '2026-10-13 08:05', '13/10/2026 08:00:00', '2026-10-13 08:00:00Z',
    '2026-10-13 08:00:00+07:00', ' 2026-10-13 08:00:00 ', '2026-13-01 00:00:00', '2026-02-30 00:00:00', '2026-10-13 25:00:00',
    '2026-10-13 08:00:00\n', '2026-10-13T08:00:00\n', '2026-10-13 08:00:00 ', ' 2026-10-13 08:00:00', '2026-10-13  08:00:00', '2026-10-13 08:00:00\t'];
  const js = await app.page.evaluate((ss) => ss.map((s) => {
    const d = new Date(s.replace(' ', 'T'));
    return Number.isNaN(d.getTime()) ? null : [d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()];
  }), ok.concat(odd));
  const py = runPython(`
out = []
for s in p['strings']:
    d = m.parse_scan_ts(s)
    out.append(None if d is None else [d.year, d.month, d.day, d.hour, d.minute, d.second])
print(json.dumps(out))
`, { strings: ok.concat(odd) });
  // รูปแบบที่แอปเขียนเอง: ต้องได้ค่าเดียวกันเป๊ะ
  expect(py.slice(0, ok.length)).toEqual(js.slice(0, ok.length));
  expect(py.slice(0, ok.length).every((x) => x !== null)).toBe(true);
  // รูปแบบแปลก: บอทต้อง "ไม่เดา" (ไม่ Confirm รายการนั้น) — ถ้า JS อ่านได้แต่บอทอ่านไม่ได้ ผลคือบอทเข้มกว่า ไม่ใช่ผิด
  for (let i = ok.length; i < ok.length + odd.length; i++) {
    if (py[i] !== null) expect(py[i], `บอทรับ '${odd[i - ok.length]}' ต้องได้ค่าเดียวกับ JS`).toEqual(js[i]);
  }
  expect(py.slice(ok.length).filter((x) => x === null).length, 'รูปแบบแปลกส่วนใหญ่ต้องถูกปฏิเสธ').toBeGreaterThanOrEqual(8);
  await closeApp(app);
});

test('ค่าคงที่ PHARMACY_DIRECT_STOCK_ADJ ของบอท = ของเว็บ (ถ้าเว็บปิด บอทต้องไม่ Confirm)', async ({ browser }) => {
  const app = await bootBare(browser);
  const web = await app.page.evaluate(() => PHARMACY_DIRECT_STOCK_ADJ);
  const py = runPython(`print(json.dumps(m.PHARMACY_DIRECT_STOCK_ADJ))`);
  expect(py).toBe(web);
  await closeApp(app);
});
