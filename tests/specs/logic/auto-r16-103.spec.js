// ใบรับสินค้าเข้าระหว่างวัน R16.103 ของสาขายา — บอท auto-r16 (พ.ย. 2026 · ผู้ใช้สั่ง)
//
// ทำไมต้องมี: R01 = ยอดระบบ ณ ~07:30 · ใบรับระหว่างวัน (IRVC รับจากผู้ขาย · ITFW/ITFB รับโอน) ทำให้ของบนชั้นเพิ่มแต่ R01 ไม่รู้
//   → พนักงานนับหลังรับของ = "นับเกินระบบ" → Stock Adj ปลอม → ใบ IRPS ซ้ำกับใบรับที่ ERP บันทึกไปแล้ว
// วิธีที่ส่งมอบ: บอทต่อใบรับท้ายช่อง "รับเข้า" ของ timeline R16.104 เดิม (merge_receipts) → สูตร Confirm เดิมของเว็บ/บอทหักเฉพาะใบที่ลง ≤ เวลาสแกน
// เทสนี้ (ไม่ใช้ Firestore): กติกาคัดแถว (build_receipts_103) · เวลา R01 · merge · หัวคอลัมน์
//   · ★ กรณีของผู้ใช้ทั้ง 4 แบบ ตัดสินด้วยบอท และด้วยโค้ดจริงของหน้าเว็บ (_applyWhR16Rows → _buildPendingScanEvaluation) ให้ผลเท่ากัน
// ⚠️ ฝั่ง Python = ฟังก์ชันจริงของบอท (ต้องมี Python 3 — ไม่มี = ล้ม ไม่ skip เงียบ) · ฝั่งเว็บ = index.html จริง · ห้าม re-implement สูตรที่นี่
const { test, expect, bootBare, closeApp } = require('../../lib/hooks');
const { runPython } = require('../../lib/python');
const F = require('../../lib/r16-104-fixture');
const R = require('../../lib/r16-103-fixture');

const DMY = '21/10/2026';                     // วันที่ในไฟล์ (d/m/yyyy แบบ ProMaxx)
const ISO = '2026-10-21';                     // วันที่ของเวลาสแกน (YYYY-MM-DD HH:mm:ss แบบที่แอปเขียน)
const R01 = '2026-10-21T00:31:00.000Z';      // = 07:31 เวลาไทย

// ── ตัวช่วยฝั่งบอท ───────────────────────────────────────────────────────────
// stats แปลงเป็น JSON ได้ (Counter → dict · datetime → ISO)
const PY_STATS = `
def jstats(st):
    return {k: (dict(v) if isinstance(v, m.Counter) else (v.isoformat() if hasattr(v, 'isoformat') else v)) for k, v in st.items()}
`;

function pyReceipts(branch, csv, { skuSet, bmap, cutoff = R01 }) {
  return runPython(PY_STATS + `
rows = m.parse_csv_text(p['csv'])
cut = m.r01_cutoff_local(p['cutoff']) if p['cutoff'] else None
rec, st = m.build_receipts_103(rows, p['branch'], set(p['skuSet']), p['bmap'], cut)
print(json.dumps({'rec': rec, 'st': jstats(st)}, ensure_ascii=False))
`, { branch, csv, skuSet, bmap, cutoff });
}

const SKUS = ['S-01', 'S-02', 'S-03', 'S-04', 'S-05'];
const BMAP = Object.fromEntries(SKUS.map((s) => ['B-' + s.slice(2), s]));
const at = (t) => `${DMY} ${t}`;

test('กติกาคัดแถว (SSS) — เก็บเฉพาะใบรับจริง (FSTOCKMAIN +1 · ประเภทในรายการ · คลังของ R01 · ลงหลัง R01) · ที่เหลือนับใน stats ไม่หายเงียบ', () => {
  const rx = (o) => R.receipt('SSS', { at: at('12:00:00'), qty: '1.0000', barcode: 'B-01', sku: 'S-01', ...o });
  const rows = [
    rx({ tranNo: 'IRVCBY006261100001', qty: '5.0000', at: at('12:00:00') }),                       // ✔ 5 @12:00
    rx({ tranNo: 'ITFWBY006261100002', qty: '2.0000', barcode: 'B-02', sku: 'S-02', at: at('10:30:00') }),   // ✔ รับโอน
    ...['ITFB', 'ICSM', 'IRNC', 'IRNM', 'IRCN'].map((t, i) => rx({ tranNo: `${t}BY006261100${10 + i}`, barcode: 'B-03', sku: 'S-03', at: at(`13:0${i}:00`) })),   // ✔ ครบรายการ
    rx({ tranNo: 'IRVCBY006261100003', cancel: '1' }),                     // ✗ ยกเลิก
    rx({ tranNo: 'IPOSBY006261100004', stockMain: '0' }),                  // ✗ ไม่ตัดสต็อก
    rx({ tranNo: 'ITSWBY006261100005', stockMain: '0.0000' }),             // ✗ ใบรอรับ ไม่ตัดสต็อก
    rx({ tranNo: 'IRVCBY006261100011', stockMain: '0' }),                  // ✗ ประเภทใบรับแต่ไม่ตัดสต็อก — FSTOCKMAIN ชนะประเภท
    rx({ stockMain: '' }),                                                 // ✗ FSTOCKMAIN ว่าง — ห้ามตีเป็น 0
    rx({ stockMain: 'abc' }),                                              // ✗ อ่านไม่ได้
    rx({ stockMain: '2' }),                                                // ✗ ไม่ใช่ +1
    rx({ stockMain: '-1' }),                                               // ✗ ตัดออก
    rx({ tranNo: 'IRPSBY006261100006' }),                                  // ✗ ใบปรับปรุงเพิ่ม (ไม่ใช่ใบรับ)
    rx({ tranNo: 'IXXXBY006261100007' }),                                  // ✗ ประเภทที่ไม่รู้จัก
    rx({ colA: '1' }),                                                     // ✗ ไม่ใช่คลังของ R01 (SSS = 0)
    rx({ colA: '' }),                                                      // ✗ Col A ว่าง
    rx({ at: at('07:00:00') }),                                            // ✗ ก่อน R01 (อยู่ใน R01 แล้ว)
    rx({ at: at('07:31:00') }),                                            // ✗ ตรงเวลา R01 พอดี (≤)
    rx({ tranNo: 'IRVCBY006261100008', qty: '3.0000', barcode: 'B-04', sku: 'S-04', at: at('07:31:01') }),   // ✔ หลัง R01 1 วินาที
    rx({ qty: '0.0000' }),                                                 // ✗ จำนวน 0
    rx({ qty: '' }),                                                       // ✗ ว่าง
    rx({ barcode: '' }),                                                   // ✗ ไม่มีบาร์โค้ด (กติกาเดียวกับ R16.104)
    rx({ barcode: 'B-NOPE', sku: 'NOPE' }),                                // ✗ ไม่พบ SKU
    rx({ tranNo: 'IRVCBY006261100009', barcode: 'B-NOPE', sku: 'S-05', qty: '1,200.0000', at: at('14:00:00') }),   // ✔ ถอยไปใช้ ITEMID · คอมมาในจำนวน
    rx({ at: 'garbage' }),                                                 // ✗ วันที่อ่านไม่ได้
    rx({ tranNo: 'IRVCBY006261100010', barcode: 'B-02', sku: 'S-02', qty: '4.0000', at: '21-Oct-26 15:00:00' }),  // ✔ วันที่แบบ BIGYAMAINPC
  ];
  const got = pyReceipts('SSS', R.csvText(rows), { skuSet: SKUS, bmap: BMAP });
  expect(got.rec).toEqual({
    'S-01': [{ qty: 5, tranDate: at('12:00:00') }],
    'S-02': [{ qty: 2, tranDate: at('10:30:00') }, { qty: 4, tranDate: '21/10/2026 15:00:00' }],
    'S-03': ['13:00:00', '13:01:00', '13:02:00', '13:03:00', '13:04:00'].map((t) => ({ qty: 1, tranDate: at(t) })),
    'S-04': [{ qty: 3, tranDate: at('07:31:01') }],
    'S-05': [{ qty: 1200, tranDate: at('14:00:00') }],
  });
  expect(got.st).toMatchObject({
    file_rows: rows.length, kept: 10, skus: 5, docs: 10, qty_total: 5 + 2 + 5 + 3 + 1200 + 4,
    cancelled: 1, no_stock: 3, bad_stock_main: 3, stock_out: 1,
    warehouse: 0, before_r01: 2, zero_qty: 1, skipped_blank: 2, missing: 1, bad_date: 1,
    min_td: '2026-10-21T07:31:01', max_td: '2026-10-21T15:00:00',
  });
  expect(got.st.other_type, 'นับเฉพาะประเภทที่ผ่านด่าน FSTOCKMAIN แล้ว (IPOS/ITSW ไม่ใช่ +1 จึงไม่โผล่)').toEqual({ IRPS: 1, IXXX: 1 });
  expect(got.st.other_warehouse).toEqual({ 1: 1, '(ว่าง)': 1 });
  expect(got.st.mismatch, 'ITEMID ใน Col X ไม่ตรงกับ SKU ที่จับคู่ได้ = นับไว้ (ไม่ใช่ปัญหา)').toBe(0);
});

test('Col A ต่อสาขา — SRC หน้าร้าน (1) เท่านั้น: ใบรับของคลังชากค้อ (0) ข้ามแบบไม่เตือน · KKL/SSS main (0) เท่านั้น', () => {
  const mk = (b, colA, n) => R.receipt(b, { colA, at: at('12:00:00'), qty: `${n}.0000`, barcode: 'B-01', sku: 'S-01' });
  const src = pyReceipts('SRC', R.csvText([mk('SRC', '1', 2), mk('SRC', '0', 7), mk('SRC', '3', 9)]), { skuSet: SKUS, bmap: BMAP });
  expect(src.rec).toEqual({ 'S-01': [{ qty: 2, tranDate: at('12:00:00') }] });
  expect(src.st).toMatchObject({ kept: 1, warehouse: 1, other_warehouse: { 3: 1 } });
  for (const b of ['KKL', 'SSS']) {
    const r = pyReceipts(b, R.csvText([mk(b, '0', 2), mk(b, '1', 7)]), { skuSet: SKUS, bmap: BMAP });
    expect(r.rec, b).toEqual({ 'S-01': [{ qty: 2, tranDate: at('12:00:00') }] });
    expect(r.st, b).toMatchObject({ kept: 1, warehouse: 0, other_warehouse: { 1: 1 } });
  }
});

test('เวลา R01 — อ่านเฉพาะ ISO UTC ที่บอท/เว็บเขียน (r01Version) แล้วแปลงเป็นเวลาไทย · รูปแบบอื่น = None (ผู้เรียกต้องไม่ใช้ใบรับ)', () => {
  const got = runPython(`
cases = p['cases']
print(json.dumps([(lambda d: d.isoformat() if d else None)(m.r01_cutoff_local(c)) for c in cases]))
`, { cases: ['2026-10-21T00:31:00.000Z', '2026-10-21T00:31:00Z', '2026-10-21T00:31:00.123456789Z', '2026-10-21T17:00:00.000Z',
    '', null, 'R01-TEST-1', '2026-10-21T00:31:00.000Z-SSS', '2026-10-21 00:31:00', '2026-10-21T00:31:00+07:00', '2026-13-01T00:00:00Z', ' 2026-10-21T00:31:00Z'] });
  expect(got).toEqual(['2026-10-21T07:31:00', '2026-10-21T07:31:00', '2026-10-21T07:31:00.123456', '2026-10-22T00:00:00',
    null, null, null, null, null, null, null, null]);
});

test('merge_receipts — ต่อท้ายช่องรับเข้าตามลำดับไฟล์ · SKU ใหม่แทรกตามลำดับ · ไม่แก้ timeline เดิม · ใบรับว่าง = chunk เดิมทุกไบต์', () => {
  const got = runPython(`
import copy
tl = p['tl']; orig = copy.deepcopy(tl)
merged = m.merge_receipts(tl, p['rec'])
same = m.merge_receipts(tl, {})
empty_list = m.merge_receipts(tl, {'S-09': []})
print(json.dumps({'merged': merged, 'untouched': tl == orig, 'sameChunks': m.serialize_chunks(same) == m.serialize_chunks(tl),
                  'emptyList': m.serialize_chunks(empty_list) == m.serialize_chunks(tl), 'mergedChunks': m.serialize_chunks(merged)}, ensure_ascii=False))
`, {
    tl: [['S-02', 3, 1, [{ soldQty: 3, tranDate: 'a' }], [{ qty: 1, tranDate: 'b' }]], ['S-05', 1, 0, [{ soldQty: 1, tranDate: 'x' }], []]],
    rec: { 'S-02': [{ qty: 2, tranDate: 'c' }, { qty: 4.5, tranDate: 'd' }], 'S-01': [{ qty: 5, tranDate: 'e' }], 'ก-ไทย': [{ qty: 1, tranDate: 'f' }] },
  });
  expect(got.merged).toEqual([
    ['S-01', 0, 5, [], [{ qty: 5, tranDate: 'e' }]],
    ['S-02', 3, 7.5, [{ soldQty: 3, tranDate: 'a' }], [{ qty: 1, tranDate: 'b' }, { qty: 2, tranDate: 'c' }, { qty: 4.5, tranDate: 'd' }]],
    ['S-05', 1, 0, [{ soldQty: 1, tranDate: 'x' }], []],
    ['ก-ไทย', 0, 1, [], [{ qty: 1, tranDate: 'f' }]],
  ]);
  expect(got.untouched, 'timeline เดิมต้องไม่ถูกแก้ (โหมดเงาเทียบสองชุด)').toBe(true);
  expect(got.sameChunks).toBe(true);
  expect(got.emptyList).toBe(true);
  expect(got.mergedChunks).toEqual(['[["S-01",0,5,[],[{"qty":5,"tranDate":"e"}]],["S-02",3,7.5,[{"soldQty":3,"tranDate":"a"}],[{"qty":1,"tranDate":"b"},{"qty":2,"tranDate":"c"},{"qty":4.5,"tranDate":"d"}]],["S-05",1,0,[{"soldQty":1,"tranDate":"x"}],[]],["ก-ไทย",0,1,[],[{"qty":1,"tranDate":"f"}]]]']);
});

test('หัวคอลัมน์ R16.103 — ตำแหน่งเดียวกับ R16.104 + ต้องมี FSTOCKMAIN (หาตามชื่อ)', () => {
  const noFsm = F.HEAD.map((h) => (h === 'FSTOCKMAIN' ? 'XFSTOCKMAIN' : h));
  const moved = [...F.HEAD]; [moved[14], moved[15]] = [moved[15], moved[14]];
  const got = runPython(`
print(json.dumps([m.receipt_header_problems([h]) for h in p['heads']] + [m.receipt_header_problems([])], ensure_ascii=False))
`, { heads: [F.HEAD, noFsm, moved] });
  expect(got[0]).toEqual([]);
  expect(got[1].join(' ')).toContain('FSTOCKMAIN');
  expect(got[2].join(' ')).toContain('SCANCODE');
  expect(got[3].length).toBeGreaterThan(0);
});

// ── ★ กรณีของผู้ใช้ — บอท = หน้าเว็บจริง ────────────────────────────────────
// catalog เล็ก (SSS): ระบบ 10 ทุกตัว ยกเว้น S-C6 (15 = รวมใบรับก่อน R01 แล้ว)
const CASE_SKUS = ['S-C1', 'S-C2', 'S-C3', 'S-C4', 'S-C5', 'S-C6', 'S-C7'];
const CAT = {
  pm: CASE_SKUS.map((s) => ({ sku: s, productName: 'P ' + s, unitPrice: 10 })),
  r01: CASE_SKUS.map((s) => ({ colE: s, systemQty: s === 'S-C6' ? 15 : 10, productName: 'R ' + s })),
  r05: CASE_SKUS.map((s) => ({ barcode: 'B-' + s.slice(2), colE: s, unitName: 'EA', unitMultiplier: 1, unitPrice: 10 })),
};
const sale = (bc, qty, t) => F.branchRow('SSS', { tranNo: 'ORCMBY006261100' + bc.slice(-1) + t.replace(/:/g, ''), colA: '0', qty: `${qty}.0000`, barcode: bc, sku: 'S-' + bc.slice(2), at: at(t) });
const rcv = (bc, qty, t, tranNo = 'IRVC') => R.receipt('SSS', { tranNo: `${tranNo}BY006261100${bc.slice(-1)}${t.replace(/:/g, '')}`, qty: `${qty}.0000`, barcode: bc, sku: 'S-' + bc.slice(2), at: at(t) });
const ROWS104 = [sale('B-C3', 15, '10:00:00'), sale('B-C4', 15, '12:00:00')];
const ROWS103 = [
  rcv('B-C1', 5, '12:00:00'),            // 1: รับหลังนับ (นับ 10:00)
  rcv('B-C2', 5, '12:00:00'),            // 2: รับก่อนนับ (นับ 15:00)
  rcv('B-C3', 6, '09:55:00', 'ITFW'),    // 3ก: เบิก/รับโอนก่อนขาย ก่อนนับ
  rcv('B-C4', 20, '12:00:00', 'ITFW'),   // 3ข: เบิก 20 + ขาย 15 หลังนับ
  rcv('B-C5', 5, '16:00:00'),            // ข้อจำกัด: ของมาถึงก่อนนับแต่คีย์ใบรับหลังนับ
  rcv('B-C6', 5, '07:00:00'),            // ใบรับก่อน R01 (อยู่ในยอดระบบ 15 แล้ว) → ห้ามหักซ้ำ
  rcv('B-C7', 5, '12:00:00'),            // ใบรับเวลาเดียวกับเวลาสแกนพอดี → หัก (≤)
];
const ITEMS = {
  'S-C1': [10, '10:00:00'], 'S-C2': [15, '15:00:00'], 'S-C3': [1, '15:00:00'], 'S-C4': [10, '10:00:00'],
  'S-C5': [15, '15:00:00'], 'S-C6': [15, '10:00:00'], 'S-C7': [15, '12:00:00'],
};
const scanItem = ([cnt, t]) => ({ status: 'scanning', countedQty: cnt, timestamp: `${ISO} ${t}`, scannedBy: 'Tester' });
// ผลที่ผู้ใช้ต้องการ (ก่อน = ไม่มีใบรับ · หลัง = มีใบรับ)
const WANT = {
  'S-C1': { before: 'pass', after: 'pass', inbound: 0 },
  'S-C2': { before: 'stock_adjustment', after: 'pass', inbound: 5 },
  'S-C3': { before: 'stock_adjustment', after: 'pass', inbound: 6, sold: 15 },
  'S-C4': { before: 'pass', after: 'pass', inbound: 0, sold: 0 },
  'S-C5': { before: 'stock_adjustment', after: 'stock_adjustment', inbound: 0 },   // ข้อจำกัดที่ยอมรับ: ระบบรู้แค่เวลาคีย์เอกสาร
  'S-C6': { before: 'pass', after: 'pass', inbound: 0 },
  'S-C7': { before: 'stock_adjustment', after: 'pass', inbound: 5 },
};

function pyCases() {
  return runPython(`
infos = m.build_sku_infos(p['pm'], p['r01'])
sku_set = m.build_sku_set(p['pm'], p['r01'])
bmap = {r['barcode']: r['colE'] for r in p['r05']}
tl, _ = m.build_timeline(m.parse_csv_text(p['csv104']), 'SSS', sku_set, bmap)
rec, _ = m.build_receipts_103(m.parse_csv_text(p['csv103']), 'SSS', sku_set, bmap, m.r01_cutoff_local(p['r01v']))
merged = m.merge_receipts(tl, rec)
def ev(timeline):
    maps = m.timeline_maps(timeline); out = {}
    for sku, it in p['items'].items():
        r = m.evaluate_candidate(sku, it, infos, maps)
        out[sku] = {'status': r['status'], 'soldQty': r['sold'], 'inboundQty': r['inbound'], 'effectiveCnt': r['eff']}
    return out
print(json.dumps({'base': tl, 'merged': merged, 'before': ev(tl), 'after': ev(merged)}, ensure_ascii=False))
`, { ...CAT, csv104: F.csvText(ROWS104), csv103: R.csvText(ROWS103), r01v: R01,
    items: Object.fromEntries(Object.entries(ITEMS).map(([k, v]) => [k, scanItem(v)])) });
}

async function webCases(page, timeline) {
  return page.evaluate(({ cat, timeline, items }) => {
    currentBranch = 'SSS'; currentRole = 'pharmacist'; currentUser = 'Tester'; _r01BaselineAt = '';
    state.scanData.clear();
    state.r01Data = cat.r01;
    state.productMasterData = cat.pm;
    state.productMasterMap.clear();
    cat.pm.forEach((r) => state.productMasterMap.set(r.sku, r.productName));
    state.r05Data = _parseR05Json(_serializeR05(cat.r05));
    rebuildMaps();
    _applyWhR16Rows('104', timeline);                      // = _loadPharmacyR16Timeline (timeline ที่บอทเผยแพร่)
    const out = {};
    for (const [sku, it] of Object.entries(items)) {
      state.scanData.set(sku, JSON.parse(JSON.stringify(it)));
      const r = _buildPendingScanEvaluation(sku, state.scanData.get(sku));
      out[sku] = { status: r.status, soldQty: r.soldQty, inboundQty: r.inboundQty, effectiveCnt: r.effectiveCnt };
    }
    return out;
  }, { cat: CAT, timeline, items: Object.fromEntries(Object.entries(ITEMS).map(([k, v]) => [k, scanItem(v)])) });
}

test('★ กรณีของผู้ใช้ (1 · 2 · 3ก · 3ข + ขอบเวลา) — ก่อน/หลังหักใบรับ ตามที่ผู้ใช้ต้องการ · บอท = หน้าเว็บจริงทุกค่า', async ({ browser }) => {
  const py = pyCases();
  for (const [sku, w] of Object.entries(WANT)) {
    expect(py.before[sku].status, `${sku} ไม่มีใบรับ`).toBe(w.before);
    expect(py.after[sku].status, `${sku} หักใบรับ`).toBe(w.after);
    expect(py.after[sku].inboundQty, `${sku} รับเข้าก่อนเวลาสแกน`).toBe(w.inbound);
    if (w.sold != null) expect(py.after[sku].soldQty, `${sku} ขายก่อนเวลาสแกน`).toBe(w.sold);
  }
  expect(py.after['S-C3'].effectiveCnt, 'กรณี 3ก: 1 + 15 − 6 = 10').toBe(10);
  const app = await bootBare(browser);
  try {
    expect(await webCases(app.page, py.merged), 'หน้าเว็บ (timeline ที่มีใบรับ) = บอท').toEqual(py.after);
    expect(await webCases(app.page, py.base), 'หน้าเว็บ (timeline เดิม) = บอท').toEqual(py.before);
  } finally {
    await closeApp(app);
  }
});
