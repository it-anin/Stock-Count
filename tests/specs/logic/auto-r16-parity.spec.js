// parity: บอท auto-r16 (Python) ต้องผลิต "chunk เดียวกันทุกไบต์" กับ loadR16() ฝั่งเว็บ (ต.ค. 2026)
//
// ทำไมต้องมี: R16.104 ของสาขายาถูกเขียนไว้ 2 ภาษา — loadR16() ใน index.html กับ build_timeline()/serialize_chunks()
// ใน auto-r16/auto_r16_import.py ถ้าหลุดจากกันเมื่อไร Desktop จะได้ timeline ที่ไม่ตรงกับที่คนอัปมือให้ → Confirm ตัดสินผิดแบบเงียบ
// (Stock Adj ปลอมลง ERP) · เทียบถึงระดับ "สตริง JSON ของ chunk ที่จะเขียนลง Firestore" ไม่ใช่แค่โครงข้อมูล
//
// ⚠️ ฝั่ง JS เป็นโค้ดจริงของหน้าเว็บทั้งหมด (อัป CSV ผ่านการ์ด #fileR16 → _whR16Rows('104') → _chunkWhR16Rows) · ห้าม re-implement ที่นี่
//    ฝั่ง Python import ฟังก์ชันจริงของบอท — ต้องมี Python 3 (ไม่มี = เทสล้มพร้อมข้อความ ไม่ skip เงียบ)
// ⚠️ ไฟล์จริง opt-in: R16104_REAL_FILE=<path ไป R16104.CSV> npm run test:logic -- auto-r16-parity
const fs = require('fs');
const path = require('path');
const { test, expect, bootBare, closeApp } = require('../../lib/hooks');
const { runPython } = require('../../lib/python');
const F = require('../../lib/r16-104-fixture');

const BRANCHES = ['SRC', 'KKL', 'SSS'];

// ── ฝั่งหน้าเว็บ ─────────────────────────────────────────────────────────────
// ตั้ง catalog แล้วเรียก rebuildMaps() จริง (skuMap = PBM ∪ R01 · barcodeMap = R05 ที่ SKU อยู่ใน skuMap)
async function seed(page, branch, { pm, r01, r05 }) {
  return page.evaluate(({ branch, pm, r01, r05 }) => {
    currentBranch = branch; currentRole = 'pharmacist'; currentUser = 'Tester'; _r01BaselineAt = '';
    state.r01Data = r01;
    state.productMasterData = pm;
    state.productMasterMap.clear();
    pm.forEach((r) => state.productMasterMap.set(r.sku, r.productName));
    const r05Json = _serializeR05(r05);          // เหมือนที่อยู่บน cloud (global_r05)
    state.r05Data = _parseR05Json(r05Json);      // เหมือนที่ restore/listener อ่านกลับมา (กรองแถวเสียทิ้ง)
    rebuildMaps();
    return { r05Json, skuKeys: [...state.skuMap.keys()].sort() };
  }, { branch, pm, r01, r05 });
}

// อัปผ่านการ์ด R16.104 จริง แล้วเก็บ timeline ที่ _publishWhR16Timeline จะเขียน (ฟังก์ชันบริสุทธิ์ ไม่ต้องมี Firestore)
async function jsUpload(page, csv) {
  await page.evaluate(() => { state.r16DetailVersion = 'BEFORE'; });
  await page.setInputFiles('#fileR16', { name: 'R16104.csv', mimeType: 'text/csv', buffer: Buffer.from(csv, 'utf8') });
  await page.waitForFunction(() => state.r16DetailVersion !== 'BEFORE', null, { polling: 50, timeout: 90_000 });
  return page.evaluate(() => { const rows = _whR16Rows('104'); return { rows, chunks: _chunkWhR16Rows(rows) }; });
}

// ── ฝั่งบอท ─────────────────────────────────────────────────────────────────
function pyTimeline(branch, csv, { pm, r01 }, r05Json) {
  return runPython(`
rows = m.parse_csv_text(p['csv'])
sku_set = m.build_sku_set(p['pm'], p['r01'])
bmap = m.build_barcode_map(json.loads(p['r05']), sku_set)
tl, st = m.build_timeline(rows, p['branch'], sku_set, bmap)
print(json.dumps({'chunks': m.serialize_chunks(tl), 'skuSet': sorted(sku_set), 'stats': st['matched']}, ensure_ascii=False, default=str))
`, { branch, csv, pm, r01, r05: r05Json });
}

// แผนที่ sku → [ขาย, รับเข้า] จาก timeline ของเว็บ (ไว้เทียบความหมาย ไม่ใช่แค่ parity)
const byFields = (rows) => Object.fromEntries(rows.map((r) => [r[0], [r[1], r[2]]]));

// ── เคสที่เขียนมือ: ความหมายต้องตรงกติกา ──────────────────────────────────
const RULE_ROWS = (b) => [
  F.branchRow(b, { tranNo: 'ORCMBY001261000001', colA: '1', qty: '2.0000', barcode: 'B-01', sku: 'S-01' }),
  F.branchRow(b, { tranNo: 'OCTMBY001261000002', colA: '0', qty: '3.0000', barcode: 'B-02', sku: 'S-02' }),
  F.branchRow(b, { tranNo: 'OTFIBY001261000003', colA: '0', qty: '4.0000', barcode: 'B-03', sku: 'S-03' }),
  F.branchRow(b, { tranNo: 'OTFIBY001261000004', colA: '1', qty: '5.0000', barcode: 'B-04', sku: 'S-04' }),
  F.branchRow(b, { tranNo: 'OTFBBY001261000005', colA: '0', qty: '6.0000', barcode: 'B-05', sku: 'S-05' }),
  F.branchRow(b, { tranNo: 'OTFBBY001261000006', colA: '1', qty: '7.0000', barcode: 'B-06', sku: 'S-06' }),
  F.branchRow(b, { tranNo: 'ORTSBY001261000007', colA: '0', qty: '8.0000', barcode: 'B-07', sku: 'S-07' }),
  F.branchRow(b, { tranNo: 'ORCMBY001261000008', colA: '1', qty: '9.0000', barcode: 'B-08', sku: 'S-08', cancel: '1' }),
  F.branchRow(b, { tranNo: 'ORDSBY001261000009', colA: '1', qty: '10.0000', barcode: 'B-09', sku: 'S-09' }),
];

test('กติกาตามสาขา — SRC ข้าม OTFI/OTFB ของคลัง · KKL/SSS ไม่มี carve-out · ยกเลิก/ORDS ไม่เข้า (เว็บ = บอท)', async ({ browser }) => {
  const app = await bootBare(browser);
  const cat = F.catalog();
  for (const b of BRANCHES) {
    const seeded = await seed(app.page, b, cat);
    const csv = F.csvText(RULE_ROWS(b));
    const js = await jsUpload(app.page, csv);
    const got = byFields(js.rows);

    const common = { 'S-01': [2, 0], 'S-02': [3, 0], 'S-04': [5, 0], 'S-07': [0, 8] };
    const expected = b === 'SRC'
      ? { ...common, 'S-06': [7, 0] }                                   // OTFB Col A=1 (หน้าร้านส่ง) = บวกกลับ · OTFI/OTFB Col A=0 ข้าม
      : { ...common, 'S-03': [0, 4], 'S-05': [0, 6], 'S-06': [0, 7] };   // KKL/SSS: OTFI Col A=0 / OTFB ทุกแถว = รับเข้า
    expect(got, `${b}: ยอดต่อ SKU`).toEqual(expected);
    expect(got['S-08'], 'บิลยกเลิกต้องไม่เข้า').toBeUndefined();
    expect(got['S-09'], 'ORDS ต้องไม่เข้า').toBeUndefined();
    // raw timeline เก็บ tranDate เป็นสตริงดิบ (ไม่แปลง)
    expect(js.rows.find((r) => r[0] === 'S-01')[3]).toEqual([{ soldQty: 2, tranDate: '13/10/2026 09:00:00' }]);

    const py = pyTimeline(b, csv, cat, seeded.r05Json);
    expect(py.chunks, `${b}: chunk ของบอทต้องตรงเว็บ`).toEqual(js.chunks);
    expect(py.skuSet).toEqual(seeded.skuKeys);
  }
  await closeApp(app);
});

// ── fuzz: ค่าแปลกๆ ทุกชนิดที่ loadR16 ต้องรับมือ ───────────────────────────
const PREFIXES = ['ORCM', 'OCTM', 'orcm', 'Orcm', 'OTFI', 'OTFB', 'otfb', 'ORTS', 'ORDS', 'BYUSE', 'BKK', 'OOQ', 'XYZ'];
const COL_A = ['0', '1', '', '2', ' 1 ', '1 ', '0 '];
const CANCEL = ['0', '0', '0', '0', '1', '', ' 1', '1 ', '2'];
const QTY = ['1.0000', '2.0000', '3', '10.5', '1,000.00', ' 4 ', '0', '-1', 'abc', '', '0x10', '1e2', '.5', '5.', 'Infinity',
  '1_0', '١٢', '7.0000', '12 5', '0.1', '0.2', '+3', '00012', '1e1000', '-0'];
const AT = ['13/10/2026 08:02:37', '13/10/2026 20:58:01', '7/10/2026 9:02 AM', '13-10-26 8:07', '2026-10-13 08:02:37', '',
  'garbage', '13/10/2026', '13/10/2026 09:00:00', '13/10/2026 09:00:00', '13/10/2026 15:30:12'];
const SKUS = Array.from({ length: 40 }, (_, i) => 'S-' + String(i + 1).padStart(2, '0'))
  .concat(['S-2', 'S-10', 's-1', 'ก-ไทย', 'R01-ONLY', 'PM-ONLY', 'S-99']);
const BARCODES = Array.from({ length: 40 }, (_, i) => 'B-' + String(i + 1).padStart(2, '0'))
  .concat(['b-05', 'Zz-1', 'ZZ-2', 'DUP-1', 'ORPH-1', 'THAI-1', 'T-2', 'T-10', 't-1', 'UNKNOWN-1', ' B-03 ', 'B​-04',
    'B -05', 'b-01', 'B-01\t', 'B  -05', 'dup-1']);
const COL_X = ['', 'S-01', 'S-02', 'S-99', 'NOPE-1', 'S-03', 'ก-ไทย', ''];

function fuzzRows(branch, seed, n) {
  const r = F.rng(seed);
  const rows = [];
  for (let i = 0; i < n; i++) {
    const tranNo = F.pick(r, PREFIXES) + 'BY00126100' + String(i).padStart(4, '0');
    const x = F.branchRow(branch, {
      tranNo, colA: F.pick(r, COL_A), cancel: F.pick(r, CANCEL), qty: F.pick(r, QTY), at: F.pick(r, AT),
      barcode: F.pick(r, BARCODES), sku: F.pick(r, COL_X.concat(SKUS)),
    });
    rows.push(r() < 0.03 ? x.slice(0, 12 + Math.floor(r() * 5)) : x);   // แถวสั้นกว่าหัวตาราง — col() ต้องได้สตริงว่าง ไม่ใช่ error
  }
  return rows;
}

for (const fuzzSeed of [20261013, 7, 424242]) {
  test(`fuzz seed ${fuzzSeed} — 3 สาขา × 260 แถวสุ่ม: chunk ต้องตรงทุกไบต์`, async ({ browser }) => {
    test.setTimeout(120_000);
    const app = await bootBare(browser);
    const cat = F.catalog();
    for (const b of BRANCHES) {
      const seeded = await seed(app.page, b, cat);
      const csv = F.csvText(fuzzRows(b, fuzzSeed + b.charCodeAt(0), 260));
      const js = await jsUpload(app.page, csv);
      const py = pyTimeline(b, csv, cat, seeded.r05Json);
      expect(js.rows.length, `${b}: fuzz ต้องมีข้อมูลให้เทียบ`).toBeGreaterThan(5);
      expect(py.chunks, `${b} seed ${fuzzSeed}`).toEqual(js.chunks);
      expect(py.skuSet).toEqual(seeded.skuKeys);
    }
    await closeApp(app);
  });
}

test('ไม่มี PBM (สาขาที่ยังไม่อัป) — skuMap = R01 ล้วน · ตรงเว็บ', async ({ browser }) => {
  const app = await bootBare(browser);
  const cat = { ...F.catalog(), pm: [] };
  const seeded = await seed(app.page, 'KKL', cat);
  const csv = F.csvText(fuzzRows('KKL', 99, 200));
  const js = await jsUpload(app.page, csv);
  const py = pyTimeline('KKL', csv, cat, seeded.r05Json);
  expect(py.chunks).toEqual(js.chunks);
  expect(py.skuSet).toEqual(seeded.skuKeys);
  expect(seeded.skuKeys).not.toContain('PM-ONLY');
  await closeApp(app);
});

// ── หลาย chunk: ตัดขอบตรง _chunkWhR16Rows (รวมจุดแปลก +1 ของคอมมาที่ถูกนับกับแถวแรกของ chunk ใหม่) ──────────
test('หลาย chunk — 16,000 SKU ได้ ≥ 3 chunk และตรงทุกไบต์', async ({ browser }) => {
  test.setTimeout(240_000);
  const app = await bootBare(browser);
  const N = 16000;
  const id = (i) => String(i).padStart(5, '0');
  const r01 = Array.from({ length: N }, (_, i) => ({ colE: 'K-' + id(i), systemQty: 1, productName: 'x' }));
  const r05 = Array.from({ length: N }, (_, i) => ({ barcode: 'KB-' + id(i), colE: 'K-' + id(i), unitName: 'EA', unitMultiplier: 1, unitPrice: 10 }));
  const cat = { pm: [], r01, r05 };
  const seeded = await seed(app.page, 'KKL', cat);
  const rows = [];
  for (let i = 0; i < N; i++) {
    rows.push(F.branchRow('KKL', { tranNo: 'ORCMBY0012610' + id(i), barcode: 'KB-' + id(i), sku: 'K-' + id(i), qty: '2.0000', at: '13/10/2026 09:00:00' }));
    rows.push(F.branchRow('KKL', { tranNo: 'OTFBBY0012610' + id(i), barcode: 'KB-' + id(i), sku: 'K-' + id(i), qty: '1.0000', at: '13/10/2026 10:15:30', colA: '0' }));
  }
  const csv = F.csvText(rows);
  const js = await jsUpload(app.page, csv);
  expect(js.chunks.length).toBeGreaterThanOrEqual(3);
  const py = pyTimeline('KKL', csv, cat, seeded.r05Json);
  expect(py.chunks.length).toBe(js.chunks.length);
  expect(py.chunks).toEqual(js.chunks);
  await closeApp(app);
});

test('ขอบ chunk — เป้าหมายขนาดเล็กหลายค่า ตรงโค้ดจริงของ _chunkWhR16Rows ทุกไบต์', async ({ browser }) => {
  const app = await bootBare(browser);
  const cat = F.catalog();
  const seeded = await seed(app.page, 'SRC', cat);
  const js = await jsUpload(app.page, F.csvText(fuzzRows('SRC', 31337, 300)));
  const rows = js.rows;
  expect(rows.length).toBeGreaterThan(10);
  const maxRow = Math.max(...rows.map((r) => Buffer.byteLength(JSON.stringify(r), 'utf8')));
  // ต้อง ≥ maxRow+3: โค้ดจริงนับ +1 (คอมมา) กับแถวแรกของ chunk ใหม่ด้วย แล้วโยนถ้า partBytes+2 > target — เป้าที่ต่ำกว่านี้ทั้งสองฝั่งโยน error
  const targets = [maxRow + 3, maxRow + 4, maxRow + 40, maxRow * 2 + 1, maxRow * 3 + 7, maxRow * 5, 4096];
  for (const target of targets) {
    // ใช้ซอร์สจริงของ _chunkWhR16Rows โดยเปลี่ยนแค่ค่าคงที่เป้าหมาย — ไม่ re-implement
    const jsSmall = await app.page.evaluate(({ rows, target }) => {
      const src = _chunkWhR16Rows.toString().replace(/WH_R16_CHUNK_TARGET_BYTES/g, String(target));
      return new Function('return ' + src)()(rows);
    }, { rows, target });
    const pySmall = runPython(`print(json.dumps(m.serialize_chunks(p['rows'], target_bytes=p['target']), ensure_ascii=False))`, { rows, target });
    expect(jsSmall.length, `target ${target}`).toBeGreaterThan(1);
    expect(pySmall, `target ${target}`).toEqual(jsSmall);
  }
  await closeApp(app);
  void seeded;
});

// ── ตัวช่วยที่ต้อง "เหมือน JS" ───────────────────────────────────────────────
test('_js_number เหมือน Number() ของ JS (รวมเลขฐาน · Infinity · เลขอาหรับ · underscore)', async ({ browser }) => {
  const app = await bootBare(browser);
  const strings = ['', ' ', '0', '-0', '1', '1.5', '.5', '5.', '+5', '-5', '1e3', '1E3', '1e+3', '1e-3', '1e', 'e1', '0x10', '0X1f',
    '-0x10', '0b101', '0B11', '0o17', '0o8', '0x', '0xG', '1_0', 'inf', 'Infinity', '+Infinity', '-Infinity', 'infinity', 'INFINITY',
    'nan', 'NaN', '１２', '١٢', '12abc', '1 2', '1,5', ' 7 ', '\t8\n', '1e1000', '-1e1000', '0.1', '00012', '0x1_0', '0b102', '٣.٥',
    '++1', '1.2.3', '.', '-.5', '+.5e2', '0x10.5', ' 9 '];
  const js = await app.page.evaluate((ss) => ss.map((s) => {
    const n = Number(s);
    return Number.isNaN(n) ? 'NaN' : n === Infinity ? 'Infinity' : n === -Infinity ? '-Infinity' : String(n === 0 ? 0 : n);
  }), strings);
  const py = runPython(`
out = []
for s in p['strings']:
    v = m._js_number(s)
    if v is None or v != v: out.append('NaN')
    elif v == float('inf'): out.append('Infinity')
    elif v == float('-inf'): out.append('-Infinity')
    else: out.append(repr(m._js_num_out(v)))
print(json.dumps(out))
`, { strings });
  expect(py).toEqual(js);
  await closeApp(app);
});

test('js_trim / normalize_barcode เหมือน trim()/\\s ของ JS (NBSP · BOM · LS/PS · \\x1c · \\x85 · zero-width)', async ({ browser }) => {
  const app = await bootBare(browser);
  const strings = [' a ', ' a ', '﻿a', 'a﻿', ' a ', '\x1ca\x1c', '\x85a\x85', '᠎a', 'a​', '　a　',
    'a  b', 'a  b', 'a\tb\nc', 'a​b', '﻿​ a ‌', '   a b  ', 'B​-04', ''];
  const js = await app.page.evaluate((ss) => ss.map((s) => ({
    trim: s.trim(),
    norm: s.replace(/[​-‍﻿]/g, '').replace(/\s+/g, ' ').trim(),
  })), strings);
  const py = runPython(`print(json.dumps([{'trim': m.js_trim(s), 'norm': m.normalize_barcode(s)} for s in p['strings']], ensure_ascii=False))`, { strings });
  expect(py).toEqual(js);
  await closeApp(app);
});

test('parse_tran_date เหมือน parseTranDate() ของแอป (วัน/เดือน/ปี · AM/PM · dd-mm-yy · ISO · อ่านไม่ได้ = null)', async ({ browser }) => {
  const app = await bootBare(browser);
  const strings = ['13/10/2026 08:02:37', '13/10/2026 8:02', '13/10/2026', '7/10/2026 9:02 AM', '7/10/2026 12:15 AM', '7/10/2026 12:15 PM',
    '7/10/2026 1:05:09 pm', '13-10-26 8:07', '13-10-2026 8:38:50 AM', '25-04-26', '2026-10-13 08:02:37', '2026-10-13T08:02:37', '', 'garbage',
    '13/13/2026 10:00', '00/10/2026 10:00', ' 13/10/2026 09:00 ', '1/1/2026 0:00', '13/10/2026 23:59:59'];
  // ไม่ใส่ '31/02/2026' โดยตั้งใจ: V8 ยอมรับวันที่ 31 ของทุกเดือน (ได้ 3 มี.ค.) แต่ Python ถือว่าไม่ถูกต้อง — ProMaxx ไม่มีทางส่งวันที่แบบนี้
  const js = await app.page.evaluate((ss) => ss.map((s) => {
    const d = parseTranDate(s);
    return d ? [d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()] : null;
  }), strings);
  const py = runPython(`
out = []
for s in p['strings']:
    d = m.parse_tran_date(s)
    out.append(None if d is None else [d.year, d.month, d.day, d.hour, d.minute, d.second])
print(json.dumps(out))
`, { strings });
  expect(py).toEqual(js);
  await closeApp(app);
});

// ── ไฟล์จริง (opt-in) ────────────────────────────────────────────────────────
const REAL = process.env.R16104_REAL_FILE;
test('ไฟล์จริง R16104.CSV (opt-in: R16104_REAL_FILE) — แยกตามสาขาแล้วตรงเว็บทุกไบต์', async ({ browser }) => {
  test.skip(!REAL, 'ตั้ง R16104_REAL_FILE=<path ไป R16104.CSV> เพื่อเทียบกับไฟล์จริง (ไม่ commit ไฟล์จริงเข้า repo)');
  test.setTimeout(240_000);
  const Papa = require('../../../libs/papaparse.min.js');
  const raw = fs.readFileSync(REAL);
  const text = raw[0] === 0xEF && raw[1] === 0xBB && raw[2] === 0xBF ? raw.slice(3).toString('utf8') : raw.toString('utf8');
  const all = Papa.parse(text, { header: false, skipEmptyLines: true, delimiter: ',', quoteChar: '"' }).data;
  const head = all[0];
  const app = await bootBare(browser);
  let compared = 0;
  for (const b of BRANCHES) {
    const own = all.slice(1).filter((r) => (r[12] || '').trim() === F.BRANCH_ID[b]);
    if (!own.length) continue;
    // catalog จากไฟล์เอง: ~86% ของบาร์โค้ดมีใน R05 · ~9% ของ SKU ไม่มีใน R01 → ได้ทั้งเคส match/missing/fallback Col X
    const bcs = [...new Set(own.map((r) => (r[14] || '').trim()).filter(Boolean))];
    const sk = new Map(own.map((r) => [(r[14] || '').trim(), (r[23] || '').trim()]));
    const r05 = bcs.filter((_, i) => i % 7 !== 0).map((bc) => ({ barcode: bc, colE: sk.get(bc), unitName: 'EA', unitMultiplier: 1, unitPrice: 10 })).filter((x) => x.colE);
    const skus = [...new Set(r05.map((x) => x.colE))];
    const r01 = skus.filter((_, i) => i % 11 !== 0).map((s) => ({ colE: s, systemQty: 1, productName: 'x' }));
    const cat = { pm: [], r01, r05 };
    const seeded = await seed(app.page, b, cat);
    const csv = F.csvText(own, { head });
    const js = await jsUpload(app.page, csv);
    const py = pyTimeline(b, csv, cat, seeded.r05Json);
    expect(py.chunks, `${b} (ไฟล์จริง ${own.length} แถว)`).toEqual(js.chunks);
    expect(py.skuSet).toEqual(seeded.skuKeys);
    compared += 1;
    console.log(`[real-file] ${b}: ${own.length} แถว → timeline ${js.rows.length} SKU · ${js.chunks.length} chunk — ตรงทุกไบต์`);
  }
  expect(compared).toBeGreaterThan(0);
  await closeApp(app);
});
