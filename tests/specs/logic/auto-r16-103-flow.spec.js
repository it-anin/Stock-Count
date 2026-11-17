// flow: ใบรับสินค้าเข้าระหว่างวัน R16.103 ของสาขายา — main() จริงของบอท auto-r16 กับ Firestore REST จำลอง + ไฟล์ R16103.CSV จริงบนดิสก์
//
// ทำไมต้องมี: ใบรับระหว่างวันทำให้ของบนชั้นมากกว่า R01 (07:30) → นับหลังรับของ = Stock Adj ปลอม → ใบ IRPS ซ้ำกับใบรับที่ ERP บันทึกแล้ว
//   บอทต่อใบรับเข้าช่อง "รับเข้า" ของ timeline R16.104 ที่เผยแพร่ (ไม่มี doc ใหม่ · เว็บไม่ต้องแก้) — เทสนี้พิสูจน์ว่า:
//   (1) ไม่มี flag --r103* = ไม่แตะไฟล์ R16103.CSV เลย ผลเดิมทุกไบต์  (2) เปิดใช้ = timeline/meta/Confirm ถูก ตามกรณีของผู้ใช้
//   (3) โหมดเงา = เผยแพร่แบบเดิม แต่รายงานว่าจะพลิกกี่รายการ  (4) ไฟล์ใบรับมีปัญหา = สาขาที่เปิดใช้ "ไม่เผยแพร่ + ❌ (exit 4)" ตามที่ผู้ใช้เลือก
//   (5) flag ผิด = exit 2 ก่อนแตะ Firestore  (6) ข้อความ Telegram บอกผลใบรับต่อสาขา
// ตรรกะคัดแถว/เวลา R01/merge และ "บอท = หน้าเว็บจริง" อยู่ที่ auto-r16-103.spec.js · REST/rules จริงอยู่ที่ e2e/auto-r16-103.spec.js
// ⚠️ ฝั่งบอทเป็นโค้ดจริง · ที่จำลองมีแค่ m._request (Firestore) นาฬิกา time.sleep และปลายทาง Telegram — ต้องมี Python 3
const { test, expect } = require('@playwright/test');
const H = require('../../lib/r16-confirm-harness');
const F = require('../../lib/r16-104-fixture');
const R = require('../../lib/r16-103-fixture');
const { item, world, run, itemOf, docOf, untouched, confirmWrites } = H;

const T = (t) => `${H.TODAY} ${t}`;
// ระบบ (R01): S-21..S-23 = 10 · S-24/S-25 = 5 (ค่าเริ่มต้นของ catalog) · R01 อัป 07:31 (r01Version เป็น ISO ล้วน — เวลาตัดของใบรับ)
const SYS = { 'S-21': 10, 'S-22': 10, 'S-23': 10 };
const ITEMS = [
  item('S-21', 15, '15:00:00'),   // กรณี 2: รับ +5 12:00 ก่อนนับ → 15 − 5 = 10 Pass (ไม่หัก = Stock Adj +5 ปลอม)
  item('S-22', 10, '10:00:00'),   // กรณี 1: รับ +5 12:00 หลังนับ → ไม่หัก → Pass ทั้งสองแบบ
  item('S-23', 1, '15:00:00'),    // กรณี 3ก: ขาย 15 (10:00) + รับโอน 6 (09:55) ก่อนนับ → 1 + 15 − 6 = 10 Pass
  item('S-24', 5, '11:00:00'),    // ข้อจำกัดที่ยอมรับ: คีย์ใบรับ +5 10:00 แต่ของยังไม่ขึ้นชั้นตอนนับ → หักเกิน → Pass→Stock Adj (ต้องโผล่ในรายงาน)
  item('S-25', 5, '10:00:00'),    // ใบรับก่อน R01 (07:00) + IPOS ไม่ตัดสต็อก → ไม่หัก → Pass ทั้งสองแบบ
];
const SALES = [['B-23', 15, '10:00:00']];
const RECEIPTS = (b = 'SSS') => [
  R.receipt(b, { qty: '5.0000', barcode: 'B-21', sku: 'S-21', at: T('12:00:00') }),
  R.receipt(b, { qty: '5.0000', barcode: 'B-22', sku: 'S-22', at: T('12:00:00') }),
  R.receipt(b, { tranNo: 'ITFWBY006261100001', qty: '6.0000', barcode: 'B-23', sku: 'S-23', at: T('09:55:00') }),
  R.receipt(b, { qty: '5.0000', barcode: 'B-24', sku: 'S-24', at: T('10:00:00') }),
  R.receipt(b, { qty: '3.0000', barcode: 'B-25', sku: 'S-25', at: T('07:00:00') }),                                                  // ก่อน R01 → อยู่ใน R01 แล้ว
  R.receipt(b, { tranNo: 'IPOSBY006261100002', stockMain: '0', qty: '9.0000', barcode: 'B-25', sku: 'S-25', at: T('11:00:00') }),   // ไม่ตัดสต็อก
];
const CSV103 = (rows = RECEIPTS()) => R.csvText(rows);
const W = (over = {}) => world({ branches: ['SSS'], items: { SSS: ITEMS }, sales: { SSS: SALES }, sys: SYS, r01Version: H.R01_ISO, ...over });
const ON = ['--r103', '--r103-branch', 'SSS'];
const SHADOW = ['--r103-shadow'];
const CONFIRM = ['--confirm', '--confirm-branch', 'SSS'];
const R103_FIELDS = ['r103Mode', 'r103Rows', 'r103Skus', 'r103Qty', 'r103SourceFile', 'r103SourceMtime', 'r103Pending'];
const SKUS = ITEMS.map((i) => i.sku);

// timeline ที่เผยแพร่อยู่ของสาขา (อ่านจาก meta → chunk ตามลำดับ) · res = ผลทั้งชุด หรือ res.runs[i] (สถานะหลังรอบที่ i)
function published(res, b = 'SSS') {
  const meta = docOf(res, `stock_sessions/${b}_r16_104_meta`);
  if (!meta) return null;
  const chunks = [];
  for (let i = 0; i < meta.chunkCount; i++) chunks.push(docOf(res, `stock_sessions/${b}_r16_104_${meta.generation}_${String(i).padStart(4, '0')}`).data_json);
  return { meta, chunks, rows: chunks.flatMap((c) => JSON.parse(c)) };
}
const rowOf = (pub, sku) => pub.rows.find((r) => r[0] === sku);
const patches = (r) => r.requests.filter((x) => x.startsWith('PATCH '));

// ── (1) ไม่มี flag = พฤติกรรมเดิมทุกไบต์ ──────────────────────────────────
test('ไม่มี flag --r103* — ไม่แตะไฟล์ R16103.CSV / R4166.CSV เลย (แม้ไฟล์เสียวางอยู่) · chunk/meta เท่ากับตอนไม่มีไฟล์ทุกไบต์ · ไม่มี field r103* · ไม่ query items', () => {
  const a = run({ ...W(), runs: [{ args: [] }] });
  const b = run({ ...W(), csv103: 'ขยะ,ไม่ใช่,CSV\n"เปิดแล้วพัง', csv4166: 'ขยะ\n"', runs: [{ args: [] }] });
  for (const res of [a, b]) expect(res.runs[0].code, res.runs[0].log).toBe(0);
  const pa = published(a), pb = published(b);
  expect(pb.chunks).toEqual(pa.chunks);
  expect(pb.meta.contentHash).toBe(pa.meta.contentHash);
  for (const k of R103_FIELDS) expect(pb.meta[k], k).toBeUndefined();
  expect(rowOf(pb, 'S-21'), 'ไม่มีใบรับใน timeline').toBeUndefined();
  expect(b.runs[0].log).not.toMatch(/R16\.103|R16103|R4166|รออนุมัติ/);
  expect(b.runs[0].requests.some((x) => x.includes('runQuery')), 'ไม่ query items').toBe(false);
  expect(b.files.r103Shadow).toBeUndefined();
  for (const sku of SKUS) expect(untouched(b, `stock_sessions/SSS/items/${sku}`), sku).toBe(true);
});

// ── (2) เปิดใช้ ───────────────────────────────────────────────────────────
test('★ --r103 --r103-branch SSS — ใบรับต่อท้ายช่องรับเข้าของ timeline ที่เผยแพร่ · meta บอกที่มา · รายงาน Stock Adj→Pass 2 · Pass→Stock Adj 1 · รอบสองไม่เขียนซ้ำ', () => {
  const res = run({ ...W(), csv103: CSV103(), runs: [{ args: ON }, { args: ON }] });
  const [r, r2] = res.runs;
  expect(r.code, r.log).toBe(0);
  const pub = published(r);
  expect(rowOf(pub, 'S-21')).toEqual(['S-21', 0, 5, [], [{ qty: 5, tranDate: T('12:00:00') }]]);
  expect(rowOf(pub, 'S-22')).toEqual(['S-22', 0, 5, [], [{ qty: 5, tranDate: T('12:00:00') }]]);
  expect(rowOf(pub, 'S-23')).toEqual(['S-23', 15, 6, [{ soldQty: 15, tranDate: T('10:00:00') }], [{ qty: 6, tranDate: T('09:55:00') }]]);
  expect(rowOf(pub, 'S-24')).toEqual(['S-24', 0, 5, [], [{ qty: 5, tranDate: T('10:00:00') }]]);
  expect(rowOf(pub, 'S-25'), 'ใบรับก่อน R01 + IPOS ต้องไม่ถูกหัก').toBeUndefined();
  expect(pub.meta).toMatchObject({ ready: true, kind: '104', r103Mode: 'on', r103Rows: 4, r103Skus: 4, r103Qty: 21, r103SourceFile: 'R16103.CSV' });
  expect(pub.meta.r103SourceMtime).toBe(pub.meta.sourceMtime);
  expect(docOf(r, 'stock_sessions/SSS_r01')).toMatchObject({ r16Loaded: true, r16DetailVersion: pub.meta.version });
  expect(r.log).toContain('ใบรับ R16.103 [เปิดใช้]: 4 บรรทัด · 4 ใบ · 4 SKU · 21 ชิ้น');
  expect(r.log).toContain('ข้าม: ไม่ตัดสต็อก 1 · ก่อนเวลา R01 1');
  expect(r.log).toContain('ใบรับ R16.103 [เปิดใช้] กับรายการรอ Confirm 5 รายการ: ใบรับลงก่อนเวลาสแกน 3 รายการ');
  expect(r.log).toContain('ผลพลิก Stock Adj→Pass 2 · Pass→Stock Adj 1');
  expect(r.log).toContain('⚠️ ใบรับ R16.103 ทำให้ Pass→Stock Adj 1 รายการ');
  expect(confirmWrites(r), 'ไม่มี --confirm = ไม่เขียน items').toEqual([]);
  for (const sku of SKUS) expect(untouched(res, `stock_sessions/SSS/items/${sku}`), sku).toBe(true);
  // รายงานจดลงไฟล์แยก (ไม่ปนกับ auto_r16_confirm_shadow.jsonl ที่ --confirm-compare อ่าน)
  expect(res.files.shadow, 'ไม่ปนไฟล์เงาของ Confirm').toBeUndefined();
  expect(res.files.r103Shadow).toHaveLength(2);
  const rec = res.files.r103Shadow[0];
  expect(rec).toMatchObject({ branch: 'SSS', mode: 'on', date: H.DAY, epoch: H.EPOCH, r01Version: H.R01_ISO(), file: 'R16103.CSV',
    receipts: { kept: 4, skus: 4, docs: 4, qty_total: 21, no_stock: 1, before_r01: 1 } });
  expect(rec.flips).toMatchObject({ candidates: 5, evaluated: 5, skipped: {}, to_adj: ['S-24'], changed: 3 });
  expect([...rec.flips.to_pass].sort()).toEqual(['S-21', 'S-23']);
  const bySku = Object.fromEntries(rec.rows.map((x) => [x.sku, x]));
  expect(bySku['S-21']).toMatchObject({ inboundBefore: 0, inboundAfter: 5, statusBefore: 'stock_adjustment', statusAfter: 'pass' });
  expect(bySku['S-23']).toMatchObject({ sold: 15, inboundBefore: 0, inboundAfter: 6, statusAfter: 'pass' });
  expect(bySku['S-24']).toMatchObject({ inboundAfter: 5, statusBefore: 'pass', statusAfter: 'stock_adjustment' });
  expect(bySku['S-22'], 'ใบรับหลังเวลาสแกน = ไม่หัก = ไม่อยู่ในรายการที่เปลี่ยน').toBeUndefined();
  // รอบสอง: เนื้อหาเดิม → ไม่เขียนอะไรเลย แต่ยังรายงานผลใบรับ
  expect(r2.code, r2.log).toBe(0);
  expect(r2.log).toContain('เนื้อหาเหมือนเดิมทุกไบต์');
  expect(patches(r2), 'รอบสองไม่ PATCH อะไร').toEqual([]);
  expect(published(r2).meta.version).toBe(pub.meta.version);
});

test('★ Confirm จริงพร้อมใบรับ — กรณี 2 และ 3ก เป็น Pass (inboundQty ถูกจด) · เทียบกับไม่หักใบรับที่เป็น Stock Adj ปลอม (canary)', () => {
  const on = run({ ...W(), csv103: CSV103(), runs: [{ args: [...ON, ...CONFIRM] }] });
  const off = run({ ...W(), csv103: CSV103(), runs: [{ args: CONFIRM }] });
  for (const res of [on, off]) expect(res.runs[0].code, res.runs[0].log).toBe(0);
  const pick = (res, sku) => {
    const it = itemOf(res, 'SSS', sku);
    return Object.fromEntries(['status', 'initialStatus', 'directAdj', 'effectiveQty', 'systemQty', 'soldQty', 'rawCountedQty', 'inboundQty']
      .filter((k) => it[k] !== undefined).map((k) => [k, it[k]]));
  };
  expect(pick(on, 'S-21')).toEqual({ status: 'pass', initialStatus: 'pass', inboundQty: 5 });
  expect(pick(on, 'S-22')).toEqual({ status: 'pass', initialStatus: 'pass' });
  expect(pick(on, 'S-23')).toEqual({ status: 'pass', initialStatus: 'pass', soldQty: 15, rawCountedQty: 1, inboundQty: 6 });
  expect(pick(on, 'S-24')).toEqual({ status: 'stock_adjustment', initialStatus: 'stock_adjustment', directAdj: true, effectiveQty: 0, systemQty: 5, inboundQty: 5 });
  expect(pick(on, 'S-25')).toEqual({ status: 'pass', initialStatus: 'pass' });
  // ไม่หักใบรับ (พฤติกรรมเดิม): กรณี 2/3ก กลายเป็น Stock Adj ปลอม — ยืนยันว่าเทสวัดของจริง
  expect(pick(off, 'S-21')).toEqual({ status: 'stock_adjustment', initialStatus: 'stock_adjustment', directAdj: true, effectiveQty: 15, systemQty: 10 });
  expect(pick(off, 'S-23')).toEqual({ status: 'stock_adjustment', initialStatus: 'stock_adjustment', directAdj: true, effectiveQty: 16, systemQty: 10, soldQty: 15, rawCountedQty: 1 });
  expect(pick(off, 'S-24')).toEqual({ status: 'pass', initialStatus: 'pass' });
  // audit log ของคืนนั้นนับตามผลจริง
  const log = docOf(on, `stock_audit_log/SSS_${H.DAY}`);
  expect(log, 'มี audit log').toBeTruthy();
  expect(on.runs[0].log).toContain('ผลพลิก Stock Adj→Pass 2 · Pass→Stock Adj 1');
});

// ── (3) โหมดเงา ───────────────────────────────────────────────────────────
test('★ --r103-shadow — เผยแพร่ timeline แบบไม่หักใบรับ (chunk เท่ากับไม่มี flag) · meta บอกว่าเป็นเงา · รายงานผลที่จะพลิก · ไม่แตะ items', () => {
  const base = run({ ...W(), runs: [{ args: [] }] });
  const res = run({ ...W(), csv103: CSV103(), runs: [{ args: SHADOW }] });
  const r = res.runs[0];
  expect(r.code, r.log).toBe(0);
  const pub = published(res);
  expect(pub.chunks, 'เงา = timeline เดิมทุกไบต์').toEqual(published(base).chunks);
  expect(pub.meta.contentHash).toBe(published(base).meta.contentHash);
  expect(pub.meta).toMatchObject({ r103Mode: 'shadow', r103Rows: 4, r103Skus: 4, r103Qty: 21, r103SourceFile: 'R16103.CSV' });
  expect(r.log).toContain('ใบรับ R16.103 [เงา]: 4 บรรทัด');
  expect(r.log).toContain('ผลพลิก Stock Adj→Pass 2 · Pass→Stock Adj 1');
  expect(res.files.r103Shadow).toHaveLength(1);
  expect(res.files.r103Shadow[0]).toMatchObject({ branch: 'SSS', mode: 'shadow', flips: { evaluated: 5, to_adj: ['S-24'], changed: 3 } });
  expect(confirmWrites(r)).toEqual([]);
  for (const sku of SKUS) expect(untouched(res, `stock_sessions/SSS/items/${sku}`), sku).toBe(true);
});

test('โหมดเงา + Confirm จริง — Confirm ใช้ timeline ที่ไม่หักใบรับ (ผลเท่าเดิม) แต่รายงานบอกว่ารายการไหนจะเปลี่ยนถ้าเปิดใช้', () => {
  const res = run({ ...W(), csv103: CSV103(), runs: [{ args: [...SHADOW, ...CONFIRM] }] });
  expect(res.runs[0].code, res.runs[0].log).toBe(0);
  expect(itemOf(res, 'SSS', 'S-21')).toMatchObject({ status: 'stock_adjustment', effectiveQty: 15 });
  expect(itemOf(res, 'SSS', 'S-21').inboundQty).toBeUndefined();
  expect(itemOf(res, 'SSS', 'S-24').status).toBe('pass');
  expect([...res.files.r103Shadow[0].flips.to_pass].sort()).toEqual(['S-21', 'S-23']);
});

test('สลับโหมดแล้วรุ่นที่เผยแพร่บอกความจริง — เปิดใช้ → ถอด flag: เผยแพร่ใหม่ (ไม่หักแล้ว) และ field r103* ถูกลบจาก meta · เงา → เปิดใช้: เผยแพร่ใหม่', () => {
  const res = run({ ...W(), csv103: CSV103(), runs: [{ args: ON }, { args: [] }, { args: SHADOW }, { args: ON }] });
  res.runs.forEach((r, i) => expect(r.code, `รอบ ${i}\n${r.log}`).toBe(0));
  const [p0, p1, p2, p3] = res.runs.map((r) => published(r));
  expect(rowOf(p0, 'S-21')).toBeTruthy();
  expect(rowOf(p1, 'S-21'), 'ถอด flag = ไม่หักใบรับแล้ว').toBeUndefined();
  expect(p1.meta.version).not.toBe(p0.meta.version);
  for (const k of R103_FIELDS) expect(p1.meta[k], `${k} ต้องถูกลบ (ไม่ให้ meta อ้างว่าหักใบรับ)`).toBeUndefined();
  expect(p2.meta.version, 'เงาหลังไม่มี flag = เนื้อหาเดิม ไม่เขียนซ้ำ').toBe(p1.meta.version);
  expect(p3.meta.version).not.toBe(p2.meta.version);
  expect(p3.meta.r103Mode).toBe('on');
  expect(rowOf(p3, 'S-21')).toBeTruthy();
});

test('เขียนล้มกลางทางตอนเปิดใช้ (R01 เปลี่ยนระหว่างเขียน) — คืน meta เดิมครบ และลบ field r103* ที่รุ่นที่ล้มเพิ่งใส่ (ไม่ค้างอ้างว่าหักใบรับ)', () => {
  const res = run({ ...W(), csv103: CSV103(), runs: [
    { args: [] },
    { args: ON, ops: [{ op: 'script', script: [{ type: 'touch_after_request', match: 'PATCH stock_sessions/SSS_r16_104_meta', nth: 1,
      path: 'stock_sessions/SSS_r01', set: { r01Version: '2026-10-21T05:00:00.000Z' } }] }] },
  ] });
  const [r0, r1] = res.runs;
  expect(r0.code, r0.log).toBe(0);
  expect(r1.code, r1.log).toBe(1);
  expect(r1.log).toContain('R01 ของสาขาเปลี่ยนระหว่างเขียน');
  const before = docOf(r0, 'stock_sessions/SSS_r16_104_meta');
  const after = docOf(r1, 'stock_sessions/SSS_r16_104_meta');
  for (const k of R103_FIELDS) expect(after[k], `${k} ต้องไม่ค้างหลังกู้`).toBeUndefined();
  expect(after, 'meta = รุ่นเดิมทุก field').toEqual(before);
  expect(docOf(r1, 'stock_sessions/SSS_r01').r16DetailVersion, 'master ยังชี้รุ่นเดิม').toBe(before.version);
  expect(Object.keys(r1.store).filter((k) => k.startsWith('stock_sessions/SSS_r16_104_') && !k.endsWith('_meta') && !k.includes(before.generation)),
    'chunk รุ่นที่ล้มถูกลบ').toEqual([]);
});

test('--dry-run + --r103 — อ่านอย่างเดียว: ไม่ PATCH/ลบอะไร · log บอกว่าจะรวมใบรับ · รายงานพลิกใน log แต่ไม่จดไฟล์', () => {
  const res = run({ ...W(), csv103: CSV103(), runs: [{ args: [...ON, '--dry-run'] }] });
  const r = res.runs[0];
  expect(r.code, r.log).toBe(0);
  expect(patches(r), 'ไม่ PATCH').toEqual([]);
  expect(r.requests.filter((x) => x.startsWith('DELETE ')), 'ไม่ลบ').toEqual([]);
  expect(r.log).toContain('[DRY] SSS: จะเขียน');
  expect(r.log).toContain(' · รวมใบรับ R16.103 แล้ว');
  expect(r.log).toContain('ผลพลิก Stock Adj→Pass 2 · Pass→Stock Adj 1');
  expect(res.files.r103Shadow, 'dry-run ไม่จดไฟล์รายงาน').toBeUndefined();
  expect(published(res)).toBeNull();
});

test('ไม่มี flag + เขียน chunk ล้ม — ยังคืน meta เดิมตามลำดับเดิม (คำขอชุดเดิม · ไม่มี error ถูกกลืนเงียบในทางกู้)', () => {
  const res = run({ ...W(), runs: [
    { args: [] },
    // เริ่มนับใหม่ (รอบนับเปลี่ยน) → เนื้อหาไม่ "เหมือนเดิม" → ต้องเผยแพร่ใหม่ → chunk แรกล้ม 503
    { args: [], ops: [{ op: 'put', path: 'stock_sessions/SSS', plain: { schemaVersion: 2, session_data_json: JSON.stringify({ countResetAt: '2026-10-21T10:00:00.000Z', scanData: {} }) } },
      { op: 'script', script: [{ type: 'http', match: 'PATCH stock_sessions/SSS_r16_104_', nth: 1, code: 503 }] }] },
  ] });
  const [r0, r1] = res.runs;
  expect(r0.code, r0.log).toBe(0);
  expect(r1.code, r1.log).toBe(1);
  const reqs = r1.requests;
  const failAt = reqs.findIndex((x) => x.includes('-> HTTP 503'));
  expect(failAt, 'chunk แรกล้ม').toBeGreaterThanOrEqual(0);
  expect(reqs.slice(failAt + 1), 'ทางกู้: PATCH meta เดิมกลับ (พฤติกรรมเดิมก่อนมีใบรับ)').toContain('PATCH stock_sessions/SSS_r16_104_meta');
  expect(docOf(r1, 'stock_sessions/SSS_r16_104_meta')).toEqual(docOf(r0, 'stock_sessions/SSS_r16_104_meta'));
});

// ── (4) ไฟล์ใบรับมีปัญหา ──────────────────────────────────────────────────
const NO_FSM = F.HEAD.map((h) => (h === 'FSTOCKMAIN' ? 'XFSTOCKMAIN' : h));
const PROBLEMS = [
  { name: 'ไม่มีไฟล์ R16103.CSV', w: {}, msg: "ไม่พบไฟล์ 'R16103*.CSV'", force: false },
  { name: 'ไฟล์ไม่ใช่ของวันนี้', w: { csv103: CSV103(), mtime103: '2026-10-20T21:05:00+07:00' }, msg: 'ไฟล์ R16.103 ไม่ได้ถูกแก้ไขวันนี้', force: true },
  { name: 'ไฟล์ยังไม่นิ่ง', w: { csv103: CSV103(), mtime103: '2026-10-21T21:09:30+07:00' }, msg: 'ไฟล์ R16.103 เพิ่งถูกแก้เมื่อ 30 วินาทีก่อน', force: true },
  { name: 'หัวคอลัมน์ไม่มี FSTOCKMAIN', w: { csv103: R.csvText(RECEIPTS(), { head: NO_FSM }) }, msg: 'หัวคอลัมน์ R16.103 ไม่ตรงที่คาด', force: false },
  { name: 'มีแถวของวันอื่น', w: { csv103: CSV103([...RECEIPTS(), R.receipt('SSS', { barcode: 'B-21', sku: 'S-21', at: '20/10/2026 12:00:00' })]) },
    msg: 'มีแถวที่ไม่ใช่วันนี้ (2026-10-21)', force: true },
];

for (const p of PROBLEMS) {
  test(`ไฟล์ใบรับมีปัญหา (${p.name}) — เปิดใช้: ไม่เผยแพร่ + ❌ exit 4 · Confirm ไม่ทำ · โหมดเงา: เผยแพร่แบบเดิม + ⚠️ exit 0 · --force ${p.force ? 'ข้ามได้' : 'ข้ามไม่ได้'}`, () => {
    const res = run({ ...W(), ...p.w, runs: [{ args: [...ON, ...CONFIRM] }] });
    const r = res.runs[0];
    expect(r.code, r.log).toBe(4);
    expect(r.log).toContain(`❌ ใบรับ R16.103: ${p.msg}`);
    expect(r.log).toContain('ไม่เผยแพร่ R16 ของสาขานี้');
    expect(r.log).toContain('รันซ้ำโดยเอา SSS ออกจาก --r103-branch');
    expect(published(res), 'ไม่มีรุ่นที่เผยแพร่').toBeNull();
    expect(docOf(res, 'stock_sessions/SSS_r01').r16Loaded).toBe(false);
    expect(confirmWrites(r), 'Confirm ไม่ทำ (ไม่มี Stock Adj ปลอม)').toEqual([]);
    for (const sku of SKUS) expect(itemOf(res, 'SSS', sku).status, sku).toBe('scanning');

    const sh = run({ ...W(), ...p.w, runs: [{ args: SHADOW }] });
    expect(sh.runs[0].code, sh.runs[0].log).toBe(0);
    expect(sh.runs[0].log).toContain(`⚠️ ใบรับ R16.103: ${p.msg}`);
    expect(published(sh).meta.r103Mode).toBe('shadow-unusable');
    expect(published(sh).meta.r103Rows).toBe(0);
    expect(sh.files.r103Shadow, 'ใช้ไม่ได้ = ไม่มีรายงานพลิก').toBeUndefined();

    const fo = run({ ...W(), ...p.w, runs: [{ args: [...ON, '--force'] }] });
    if (p.force) {
      expect(fo.runs[0].code, fo.runs[0].log).toBe(0);
      expect(fo.runs[0].log).toContain(`⚠️ ${p.msg}`);
      expect(fo.runs[0].log).toContain('แต่มี --force ดำเนินการต่อ');
      expect(published(fo).meta.r103Mode).toBe('on');
      expect(rowOf(published(fo), 'S-21')).toEqual(['S-21', 0, 5, [], [{ qty: 5, tranDate: T('12:00:00') }]]);
    } else {
      expect(fo.runs[0].code, fo.runs[0].log).toBe(4);
      expect(published(fo)).toBeNull();
    }
  });
}

test('ใบรับของสาขาใช้ไม่ได้ — ชื่อสาขาในไฟล์ไม่ตรง id · r01Version ไม่ใช่ ISO ล้วน (ไม่รู้เวลาตัด) → เปิดใช้ exit 4 / เงา exit 0', () => {
  const wrongName = CSV103([R.receipt('SSS', { name: 'อนิน สาขาอื่น', barcode: 'B-21', sku: 'S-21', at: T('12:00:00') })]);
  const a = run({ ...W(), csv103: wrongName, runs: [{ args: ON }, { args: SHADOW }] });
  expect(a.runs[0].code, a.runs[0].log).toBe(4);
  expect(a.runs[0].log).toContain("❌ ใบรับ R16.103 [เปิดใช้]: ชื่อสาขาในไฟล์ R16.103 ไม่ตรง (คาด 'อนิน สาขาสวนเสือศรีราชา'");
  expect(published(a.runs[0])).toBeNull();
  expect(a.runs[1].code, a.runs[1].log).toBe(0);
  expect(a.runs[1].log).toContain('⚠️ ใบรับ R16.103 [เงา]: ชื่อสาขาในไฟล์ R16.103 ไม่ตรง');

  const b = run({ ...W({ r01Version: H.R01_VERSION }), csv103: CSV103(), runs: [{ args: ON }, { args: SHADOW }] });
  expect(b.runs[0].code, b.runs[0].log).toBe(4);
  expect(b.runs[0].log).toContain("อ่านเวลา R01 (r01Version '2026-10-21T00:31:00.000Z-SSS') ไม่ได้");
  expect(b.runs[1].code, b.runs[1].log).toBe(0);
  expect(published(b.runs[1]).meta.r103Mode).toBe('shadow-unusable');
});

test('ไฟล์ใบรับมีแต่หัวตาราง (วันนี้ไม่มีใบรับ) — ปกติ: เปิดใช้ exit 0 · timeline เท่าไม่มีใบรับ · meta r103Rows 0 · เผยแพร่ใหม่ 1 ครั้งตอนเปิดใช้ครั้งแรก', () => {
  const res = run({ ...W(), csv103: CSV103([]), runs: [{ args: [] }, { args: ON }, { args: ON }] });
  res.runs.forEach((r, i) => expect(r.code, `รอบ ${i}\n${r.log}`).toBe(0));
  const [p0, p1, p2] = res.runs.map((r) => published(r));
  expect(p1.chunks).toEqual(p0.chunks);
  expect(p1.meta.version, 'ตัวกำกับ r103:on → เผยแพร่ใหม่ 1 ครั้ง (meta บอกได้ว่ารุ่นนี้ผ่านใบรับแล้ว)').not.toBe(p0.meta.version);
  expect(p1.meta).toMatchObject({ r103Mode: 'on', r103Rows: 0, r103Skus: 0, r103Qty: 0 });
  expect(p2.meta.version, 'รอบถัดไปไม่เขียนซ้ำ').toBe(p1.meta.version);
  expect(res.runs[1].log).toContain('(ไม่มีแถวของสาขานี้ในไฟล์ = วันนี้ไม่มีใบรับ)');
});

test('หลายสาขา — SSS เปิดใช้ · KKL เงา: ใบรับไม่ปนข้ามสาขา · Col A ของ KKL ต้องเป็น 0 · ไฟล์หาย = SSS ตกด่านแต่ KKL ยังเผยแพร่', () => {
  // KKL S-22: นับ 20 · รับ 5 ก่อนนับ → 20 ≠ 10 และ 15 ≠ 10 = Stock Adj ทั้งสองแบบ (ยอดรับเข้าเปลี่ยนแต่ผลไม่พลิก — ต้องนับใน changed ไม่ใช่ in to_pass)
  // KKL S-23: สแกน 21:06 หลังเวลา export (21:05) → Confirm ข้าม → รายงานพลิกต้องข้ามด้วย (ตัวคัดกรองเดียวกับ Confirm) แม้ใบรับจะทำให้ "พลิก" ได้
  const both = (over) => world({ branches: ['KKL', 'SSS'], items: { SSS: ITEMS, KKL: [item('S-21', 15, '15:00:00'), item('S-22', 20, '15:00:00'), item('S-23', 15, '21:06:00')] },
    sales: { SSS: SALES }, sys: SYS, r01Version: H.R01_ISO, ...over });
  const rows = [...RECEIPTS('SSS'),
    R.receipt('KKL', { qty: '5.0000', barcode: 'B-21', sku: 'S-21', at: T('12:00:00') }),
    R.receipt('KKL', { qty: '5.0000', barcode: 'B-22', sku: 'S-22', at: T('12:00:00') }),
    R.receipt('KKL', { qty: '5.0000', barcode: 'B-23', sku: 'S-23', at: T('12:00:00') }),
    R.receipt('KKL', { colA: '1', qty: '7.0000', barcode: 'B-21', sku: 'S-21', at: T('12:30:00') })];   // KKL Col A 1 = ไม่ใช่คลังของ R01
  const res = run({ ...both(), csv103: CSV103(rows), runs: [{ args: [...ON, ...SHADOW] }] });
  const r = res.runs[0];
  expect(r.code, r.log).toBe(0);
  expect(rowOf(published(res, 'SSS'), 'S-21')).toEqual(['S-21', 0, 5, [], [{ qty: 5, tranDate: T('12:00:00') }]]);
  expect(rowOf(published(res, 'KKL'), 'S-21'), 'KKL เงา = ไม่หัก').toBeUndefined();
  expect(published(res, 'KKL').meta).toMatchObject({ r103Mode: 'shadow', r103Rows: 3, r103Qty: 15 });
  expect(r.log).toContain('⚠️ ใบรับ R16.103: Col A ไม่ใช่คลังของ R01 (0) 1×1 — ไม่หัก');
  const byBranch = Object.fromEntries(res.files.r103Shadow.map((x) => [x.branch, x]));
  expect(byBranch.SSS.mode).toBe('on');
  expect(byBranch.KKL.flips).toEqual({ candidates: 3, evaluated: 2, skipped: { after_export: 1 }, to_pass: ['S-21'], to_adj: [], changed: 2 });
  expect(byBranch.KKL.mode).toBe('shadow');
  expect(byBranch.KKL.rows.find((x) => x.sku === 'S-22'), 'ยอดรับเข้าเปลี่ยนแต่ผลไม่พลิก').toMatchObject({ inboundBefore: 0, inboundAfter: 5,
    statusBefore: 'stock_adjustment', statusAfter: 'stock_adjustment' });

  const miss = run({ ...both(), runs: [{ args: [...ON, ...SHADOW] }] });
  expect(miss.runs[0].code, miss.runs[0].log).toBe(4);
  expect(published(miss, 'SSS')).toBeNull();
  expect(published(miss, 'KKL').meta.r103Mode).toBe('shadow-unusable');
  expect(docOf(miss, 'stock_sessions/KKL_r01').r16Loaded).toBe(true);
});

// ── (5) flag ผิด ──────────────────────────────────────────────────────────
test('flag --r103* ผิด/ขัดกัน — exit 2 ก่อนแตะ Firestore (Task ตั้งผิดต้องไม่ "เงียบแต่ไม่ทำงาน")', () => {
  const BAD = [
    { args: ['--r103'], msg: '--r103 ต้องระบุสาขาที่หักใบรับจริงด้วย --r103-branch' },
    { args: ['--r103-branch', 'SSS'], msg: '--r103-branch ต้องใช้คู่กับ --r103' },
    { args: ['--r103', '--r103-branch', 'XYZ'], msg: '--r103-branch ต้องเป็นสาขาที่อยู่ใน --branch ด้วย (เจอ: XYZ' },
    { args: ['--r103', '--r103-branch', 'SRC'], msg: '--r103-branch ต้องเป็นสาขาที่อยู่ใน --branch ด้วย (เจอ: SRC' },
    { args: ['--r103', '--r103-branch='], msg: '--r103-branch ต้องมีค่า' },
    { args: ['--r103-shadow', '--r103-branch=,'], msg: '--r103-branch ต้องมีค่า' },
    { args: ['--r103', '--r103-branch'], msg: '--r103-branch ต้องมีค่า' },
    { args: ['--r103-shadow', '--confirm-compare'], msg: 'ใช้ร่วมกับ --r103 / --r103-shadow / --r103-branch ไม่ได้' },
    { args: ['--notify-test', '--r103-shadow'], msg: '--notify-test ใช้เดี่ยวๆ' },
  ];
  const res = run({ ...W(), csv103: CSV103(), runs: BAD.map((b) => ({ args: b.args })) });
  res.runs.forEach((r, i) => {
    expect(r.code, `${BAD[i].args.join(' ')}\n${r.log}`).toBe(2);
    expect(r.log).toContain(BAD[i].msg);
    expect(r.requests, `${BAD[i].args.join(' ')}: ไม่แตะ Firestore`).toEqual([]);
  });
});

// ── (6) ข้อความ Telegram ───────────────────────────────────────────────────
const TOKEN = '123456789:AAFakeTokenForTestsOnly_abcdefghij012345';
const NOTIFY = [{ op: 'env', set: { TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_CHAT_ID: '987654321', COMPUTERNAME: 'BIGYAMAINPC' }, unset: ['AUTO_R16_NOTIFY', 'AUTO_R16_TELEGRAM_BASE'] },
  { op: 'telegram', script: [] }];

test('Telegram — บรรทัดไฟล์ใบรับ + ผลต่อสาขา (เปิดใช้ = "ทำให้" · เงา = "ถ้าเปิดใช้") · ใช้ไม่ได้ = ❌ + วิธีรันซ้ำที่มี flag ใบรับ · ไม่มี flag = ไม่มีคำว่าใบรับ', () => {
  const res = run({ ...W(), csv103: CSV103(), runs: [
    { args: [...ON, ...CONFIRM], ops: NOTIFY },
    { args: SHADOW, ops: NOTIFY },
    { args: [...ON, ...CONFIRM], ops: [...NOTIFY, { op: 'unlink_csv103' }] },
    { args: [], ops: NOTIFY },
  ] });
  const text = (i) => {
    expect(res.runs[i].telegram, `รอบ ${i}: ส่ง 1 ข้อความ\n${res.runs[i].log}`).toHaveLength(1);
    return res.runs[i].telegram[0].body.text;
  };
  const t0 = text(0);
  expect(t0).toContain('ไฟล์ใบรับ R16103.CSV (export 21:05 21/10)');
  expect(t0).toMatch(/SSS: R16 เผยแพร่แล้ว · ใบรับ R16\.103 \(เปิดใช้\) 4 บรรทัด\/4 SKU · ทำให้ Stock Adj→Pass 2 · Pass→Stock Adj 1 · /);
  const t1 = text(1);
  expect(t1).toContain('ใบรับ R16.103 (เงา) 4 บรรทัด/4 SKU · ถ้าเปิดใช้: Stock Adj→Pass 0 · Pass→Stock Adj 0');
  const t2 = text(2);
  expect(res.runs[2].code).toBe(4);
  expect(t2).toContain('ไฟล์ใบรับ (ไม่พบ R16103.CSV)');
  expect(t2).toContain("SSS: R16 ตกด่าน ไม่ได้เขียน · ❌ ใบรับ R16.103 (เปิดใช้): ไม่พบไฟล์ 'R16103*.CSV'");
  expect(t2).toContain('ใบรับ R16.103 ใช้ไม่ได้: ตรวจ Task BOT16103');
  expect(t2).toContain('.\\run_auto_r16.bat --confirm --confirm-branch SSS --r103 --r103-branch SSS');
  const t3 = text(3);
  expect(t3).not.toContain('ใบรับ');
  expect(t3).not.toContain('R16103');
  for (let i = 0; i < 4; i++) expect(res.runs[i].log).not.toContain(TOKEN);
});

// ── (7) เอกสารรออนุมัติ R4166.CSV (17 พ.ย. 2026) ─────────────────────────────
// ใบรับที่รออนุมัติอยู่ใน R16103.CSV แต่ FSTOCKMAIN 0 (ระบบยังไม่บวกสต็อก) — ของขึ้นชั้นแล้ว (ผู้ใช้ยืนยัน)
//   เลขที่อยู่ใน R4166 = หัก (ไม่ตัดด้วยเวลา R01) · R4166 ใช้ไม่ได้ = ปัญหาระดับไฟล์ของใบรับ (เปิดใช้: ไม่เผยแพร่ + ❌ · เงา: ⚠️)
// ระบบ (R01) S-26..S-28 = 5 (catalog)
const ITEMS_P = [...ITEMS,
  item('S-26', 6, '15:00:00'),    // ITFS รออนุมัติ +1 คีย์ 11:02:19 (แบบไฟล์จริง SSS) → 6 − 1 = 5 Pass (ไม่มี R4166 = Stock Adj ปลอม)
  item('S-27', 7, '10:00:00'),    // ITFB รออนุมัติ +2 คีย์ 07:00 ก่อนเวลา R01 → ยังไม่อยู่ใน R01 → 7 − 2 = 5 Pass
  item('S-28', 6, '15:00:00'),    // ใบ FSTOCKMAIN 0 ที่ R4166 บอกว่ายกเลิก → ไม่ใช่รออนุมัติ → ไม่หัก → Stock Adj (ไม่หักเกิน)
];
const SKUS_P = ITEMS_P.map((i) => i.sku);
const PEND_ROWS = (b = 'SSS') => [
  R.receipt(b, { tranNo: 'ITFSBY001261100001', stockMain: '0', qty: '1.0000', barcode: 'B-26', sku: 'S-26', at: T('11:02:19') }),
  R.receipt(b, { tranNo: 'ITFBBY001261100002', stockMain: '0', qty: '2.0000', barcode: 'B-27', sku: 'S-27', at: T('07:00:00') }),
  R.receipt(b, { tranNo: 'ITFSBY001261100003', stockMain: '0', qty: '1.0000', barcode: 'B-28', sku: 'S-28', at: T('11:30:00') }),
];
// R16103 ชุดเต็ม + R4166 ที่ตรงกัน — ปนของที่ต้องไม่ถูกหัก: ใบ +1 ก่อน R01 ของ S-25 (ระบบบวกสต็อกแล้ว · ห้ามหักซ้ำ)
//   · ใบ IPOS ของ S-25 (รออนุมัติแต่ไม่ใช่ใบรับ) · ใบโอนออกที่ไม่มีใน R16103 · ใบยกเลิกของ S-28
function pendWorld() {
  const rows = [...RECEIPTS(), ...PEND_ROWS()];
  const s25 = rows.find((r) => r[23] === 'S-25' && r[27] === '1')[2];
  const ipos = rows.find((r) => r[2].startsWith('IPOS'))[2];
  const r4166 = R.csvText([R.pendingRow('ITFSBY001261100001'), R.pendingRow('ITFBBY001261100002'),
    R.pendingRow('ITFSBY001261100003', 'SSS', { cancel: '1' }), R.pendingRow(s25), R.pendingRow(ipos), R.pendingRow('OTFBBY001261100122')], { head: R.HEAD_4166 });
  return { csv103: CSV103(rows), csv4166: r4166, s25 };
}
const WP = (over = {}) => W({ items: { SSS: ITEMS_P }, ...over });

test('★ R4166 — ใบรออนุมัติ (FSTOCKMAIN 0) ถูกหักทั้งที่ไม่ใช่ +1 และคีย์ก่อน R01 · R4166 ยกเลิก = ไม่หัก · ใบ +1 ใน R4166 = กติกาปกติ · Confirm ได้ Pass · meta/log/รายงานบอกจำนวน', () => {
  const pw = pendWorld();
  const res = run({ ...WP(), csv103: pw.csv103, csv4166: pw.csv4166, runs: [{ args: [...ON, ...CONFIRM] }] });
  const r = res.runs[0];
  expect(r.code, r.log).toBe(0);
  const pub = published(res);
  expect(rowOf(pub, 'S-26')).toEqual(['S-26', 0, 1, [], [{ qty: 1, tranDate: T('11:02:19') }]]);
  expect(rowOf(pub, 'S-27')).toEqual(['S-27', 0, 2, [], [{ qty: 2, tranDate: T('07:00:00') }]]);
  expect(rowOf(pub, 'S-28'), 'R4166 บอกว่ายกเลิก = ไม่ใช่รออนุมัติ').toBeUndefined();
  expect(rowOf(pub, 'S-25'), 'ใบ +1 ก่อน R01 ใน R4166 = ยังอยู่ใน R01 ห้ามหักซ้ำ').toBeUndefined();
  expect(pub.meta).toMatchObject({ r103Mode: 'on', r103Rows: 6, r103Skus: 6, r103Qty: 24, r103Pending: 2, r103SourceFile: 'R16103.CSV' });
  expect(r.log).toContain('ไฟล์เอกสารรออนุมัติ: R4166.CSV');
  expect(r.log).toContain('เอกสารรออนุมัติในไฟล์ R4166: 5 ใบ (5 แถว) — IPOSBY');
  expect(r.log).toContain(' · ข้ามใบยกเลิก 1 แถว');
  expect(r.log).toContain('ใบรับ R16.103 [เปิดใช้]: 6 บรรทัด · 6 ใบ · 6 SKU · 24 ชิ้น');
  expect(r.log).toContain(' · รออนุมัติ (หักเพราะของขึ้นชั้นแล้ว) 2 บรรทัด · ข้าม: ไม่ตัดสต็อก 1 · ก่อนเวลา R01 1');
  expect(r.log).toContain('⚠️ ใบรับ R16.103: เอกสารรออนุมัติประเภทที่ไม่อยู่ในรายการใบรับ IPOS×1 — ไม่หัก');
  expect(r.log).toContain('⚠️ ใบรับ R16.103: เลขที่เอกสารอยู่ใน R4166 แต่ FSTOCKMAIN +1 (ระบบบวกสต็อกแล้ว) 1 บรรทัด');
  expect(r.log).toContain('⚠️ ใบรับ R16.103: เอกสารรออนุมัติ 2 ใบ หักคืนนี้แล้ว (ITFBBY001261100002, ITFSBY001261100001)');
  expect(r.log).toContain('ผลพลิก Stock Adj→Pass 4 · Pass→Stock Adj 1');
  const pick = (sku) => {
    const it = itemOf(res, 'SSS', sku);
    return Object.fromEntries(['status', 'directAdj', 'effectiveQty', 'systemQty', 'inboundQty'].filter((k) => it[k] !== undefined).map((k) => [k, it[k]]));
  };
  expect(pick('S-26')).toEqual({ status: 'pass', inboundQty: 1 });
  expect(pick('S-27')).toEqual({ status: 'pass', inboundQty: 2 });
  expect(pick('S-28')).toEqual({ status: 'stock_adjustment', directAdj: true, effectiveQty: 6, systemQty: 5 });
  expect(pick('S-25'), 'ไม่หักซ้ำ').toEqual({ status: 'pass' });
  const rec = res.files.r103Shadow[0];
  expect(rec.receipts).toMatchObject({ kept: 6, no_stock: 1, pending_rows: 4, pending_kept: 2, pending_added: 1, pending_docs: ['ITFBBY001261100002', 'ITFSBY001261100001'] });
  expect([...rec.flips.to_pass].sort()).toEqual(['S-21', 'S-23', 'S-26', 'S-27']);
  expect(rec.flips.to_adj).toEqual(['S-24']);

  // canary: R4166 มีแต่หัว (คืนที่ไม่มีเอกสารรออนุมัติ) — ใบ FSTOCKMAIN 0 ทั้งหมดไม่ถูกหัก (พฤติกรรมก่อนมี R4166)
  const none = run({ ...WP(), csv103: pw.csv103, runs: [{ args: [...ON, ...CONFIRM] }] });
  expect(none.runs[0].code, none.runs[0].log).toBe(0);
  expect(published(none).meta).toMatchObject({ r103Rows: 4, r103Qty: 21, r103Pending: 0 });
  expect(none.runs[0].log).toContain('เอกสารรออนุมัติในไฟล์ R4166: 0 ใบ (0 แถว)');
  expect(none.runs[0].log).not.toContain('รออนุมัติ (หักเพราะของขึ้นชั้นแล้ว)');
  expect(itemOf(none, 'SSS', 'S-26')).toMatchObject({ status: 'stock_adjustment', effectiveQty: 6, systemQty: 5 });
  expect(itemOf(none, 'SSS', 'S-27')).toMatchObject({ status: 'stock_adjustment', effectiveQty: 7, systemQty: 5 });
});

test('R4166 + โหมดเงา — timeline เดิม (ไม่หัก) · รายงานบอกว่าใบรออนุมัติจะพลิกอะไร · meta r103Pending บอกจำนวน', () => {
  const pw = pendWorld();
  const base = run({ ...WP(), runs: [{ args: [] }] });
  const res = run({ ...WP(), csv103: pw.csv103, csv4166: pw.csv4166, runs: [{ args: SHADOW }] });
  expect(res.runs[0].code, res.runs[0].log).toBe(0);
  expect(published(res).chunks, 'เงา = timeline เดิมทุกไบต์').toEqual(published(base).chunks);
  expect(published(res).meta).toMatchObject({ r103Mode: 'shadow', r103Rows: 6, r103Pending: 2 });
  expect([...res.files.r103Shadow[0].flips.to_pass].sort()).toEqual(['S-21', 'S-23', 'S-26', 'S-27']);
  for (const sku of SKUS_P) expect(untouched(res, `stock_sessions/SSS/items/${sku}`), sku).toBe(true);
});

// ไฟล์ R4166 มีปัญหา (R16103 ปกติ) — กติกาเดียวกับไฟล์ R16103 มีปัญหา (ผู้ใช้เลือก)
const P4166 = [
  { name: 'ไม่มีไฟล์ R4166.CSV', w: { csv4166: null }, msg: "ไม่พบไฟล์เอกสารรออนุมัติ 'R4166*.CSV'", force: false },
  { name: 'R4166 ไม่ใช่ของวันนี้', w: { mtime4166: '2026-10-20T21:05:00+07:00' }, msg: 'ไฟล์ R4166 ไม่ได้ถูกแก้ไขวันนี้', force: true },
  { name: 'R4166 ยังไม่นิ่ง', w: { mtime4166: '2026-10-21T21:09:30+07:00' }, msg: 'ไฟล์ R4166 เพิ่งถูกแก้เมื่อ 30 วินาทีก่อน', force: true },
  { name: 'R4166 ส่งออกห่าง R16103 เกิน 30 นาที', w: { mtime4166: '2026-10-21T20:30:00+07:00' },
    msg: 'ไฟล์ R4166 (20:30) กับ R16103 (21:05) ส่งออกห่างกันเกิน 30 นาที', force: true },
  { name: 'R4166 เป็นรายงานรายบรรทัด (หยิบ R16103 มาแทน)', w: { csv4166: R.csvText([R.receipt('SSS')]) }, msg: 'หัวคอลัมน์ R4166 ไม่ตรงที่คาด: มีคอลัมน์รายบรรทัด', force: false },
];

for (const p of P4166) {
  test(`R4166 มีปัญหา (${p.name}) — เปิดใช้: ไม่เผยแพร่ + ❌ exit 4 · Confirm ไม่ทำ · เงา: เผยแพร่แบบเดิม + ⚠️ exit 0 · --force ${p.force ? 'ข้ามได้' : 'ข้ามไม่ได้'}`, () => {
    const pw = pendWorld();
    const wo = { ...WP(), csv103: pw.csv103, csv4166: pw.csv4166, ...p.w };
    const res = run({ ...wo, runs: [{ args: [...ON, ...CONFIRM] }] });
    const r = res.runs[0];
    expect(r.code, r.log).toBe(4);
    expect(r.log).toContain(`❌ ใบรับ R16.103: ${p.msg}`);
    expect(r.log).toContain('ไม่เผยแพร่ R16 ของสาขานี้');
    expect(published(res), 'ไม่มีรุ่นที่เผยแพร่').toBeNull();
    expect(docOf(res, 'stock_sessions/SSS_r01').r16Loaded).toBe(false);
    expect(confirmWrites(r), 'Confirm ไม่ทำ (ไม่มี Stock Adj ปลอม)').toEqual([]);
    for (const sku of SKUS_P) expect(itemOf(res, 'SSS', sku).status, sku).toBe('scanning');

    const sh = run({ ...wo, runs: [{ args: SHADOW }] });
    expect(sh.runs[0].code, sh.runs[0].log).toBe(0);
    expect(sh.runs[0].log).toContain(`⚠️ ใบรับ R16.103: ${p.msg}`);
    expect(published(sh).meta).toMatchObject({ r103Mode: 'shadow-unusable', r103Rows: 0, r103Pending: 0 });
    expect(sh.files.r103Shadow, 'ใช้ไม่ได้ = ไม่มีรายงานพลิก').toBeUndefined();

    const fo = run({ ...wo, runs: [{ args: [...ON, '--force'] }] });
    if (p.force) {
      expect(fo.runs[0].code, fo.runs[0].log).toBe(0);
      expect(fo.runs[0].log).toContain(`⚠️ ${p.msg}`);
      expect(fo.runs[0].log).toContain('แต่มี --force ดำเนินการต่อ');
      expect(published(fo).meta).toMatchObject({ r103Mode: 'on', r103Pending: 2 });
      expect(rowOf(published(fo), 'S-26')).toEqual(['S-26', 0, 1, [], [{ qty: 1, tranDate: T('11:02:19') }]]);
    } else {
      expect(fo.runs[0].code, fo.runs[0].log).toBe(4);
      expect(published(fo)).toBeNull();
    }
  });
}

test('R4166 หาย — สาขาที่เปิดใช้ตกด่าน แต่สาขาโหมดเงายังเผยแพร่ (KKL) · R16103 หายด้วย = ปัญหาทั้งสองไฟล์ถูกรายงาน', () => {
  const pw = pendWorld();
  const both = world({ branches: ['KKL', 'SSS'], items: { SSS: ITEMS_P, KKL: [item('S-21', 15, '15:00:00')] }, sales: { SSS: SALES }, sys: SYS, r01Version: H.R01_ISO });
  const res = run({ ...both, csv103: pw.csv103, csv4166: null, runs: [{ args: [...ON, ...SHADOW] }] });
  const r = res.runs[0];
  expect(r.code, r.log).toBe(4);
  expect(published(res, 'SSS')).toBeNull();
  expect(published(res, 'KKL').meta.r103Mode).toBe('shadow-unusable');
  expect(docOf(res, 'stock_sessions/KKL_r01').r16Loaded).toBe(true);
  const gone = run({ ...both, runs: [{ args: [...ON, ...SHADOW] }] });
  expect(gone.runs[0].code, gone.runs[0].log).toBe(4);
  expect(gone.runs[0].log).toContain("❌ ใบรับ R16.103: ไม่พบไฟล์ 'R16103*.CSV'");
  expect(gone.runs[0].log).toContain("❌ ใบรับ R16.103: ไม่พบไฟล์เอกสารรออนุมัติ 'R4166*.CSV'");
});

test('Telegram + R4166 — บรรทัดไฟล์บอกเวลา export ของทั้งสองไฟล์ · ต่อสาขาบอกจำนวนรออนุมัติ · R4166 หาย = ❌ + ชี้ทั้งสองไฟล์ · ไม่มี flag = ไม่มีคำว่า R4166', () => {
  const pw = pendWorld();
  const res = run({ ...WP(), csv103: pw.csv103, csv4166: pw.csv4166, runs: [
    { args: [...ON, ...CONFIRM], ops: NOTIFY },
    { args: [...ON, ...CONFIRM], ops: [...NOTIFY, { op: 'unlink_csv4166' }] },
    { args: [], ops: NOTIFY },
  ] });
  const text = (i) => {
    expect(res.runs[i].telegram, `รอบ ${i}: ส่ง 1 ข้อความ\n${res.runs[i].log}`).toHaveLength(1);
    return res.runs[i].telegram[0].body.text;
  };
  const t0 = text(0);
  expect(t0).toContain('ไฟล์ใบรับ R16103.CSV (export 21:05 21/10) · รออนุมัติ R4166.CSV (export 21:05 21/10)');
  expect(t0).toMatch(/SSS: R16 เผยแพร่แล้ว · ใบรับ R16\.103 \(เปิดใช้\) 6 บรรทัด\/6 SKU \(รออนุมัติ 2\) · ทำให้ Stock Adj→Pass 4 · Pass→Stock Adj 1 · /);
  const t1 = text(1);
  expect(res.runs[1].code).toBe(4);
  expect(t1).toContain('ไฟล์ใบรับ R16103.CSV (export 21:05 21/10) · รออนุมัติ (ไม่พบ R4166.CSV)');
  expect(t1).toContain("SSS: R16 ตกด่าน ไม่ได้เขียน · ❌ ใบรับ R16.103 (เปิดใช้): ไม่พบไฟล์เอกสารรออนุมัติ 'R4166*.CSV'");
  expect(t1).toContain('ใบรับ R16.103 ใช้ไม่ได้: ตรวจ Task BOT16103 + ไฟล์ R16103.CSV / R4166.CSV แล้วรันซ้ำ');
  const t2 = text(2);
  expect(t2).not.toContain('R4166');
  expect(t2).not.toContain('รออนุมัติ');
  for (let i = 0; i < 3; i++) expect(res.runs[i].log).not.toContain(TOKEN);
});
