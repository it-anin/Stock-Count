// ใบรับที่ "รออนุมัติ" ของโอนระหว่างคลัง (ITSW) + จับคู่เอกสารรออนุมัติด้วย (SYSBRANCHID, TRANNO) — 18 พ.ย. 2026 · ผู้ใช้สั่ง
//
// ที่มา (ไฟล์จริงของ SRC/KKL/SSS 18 พ.ย. 2026 ก่อน/หลังปลายทางกดอนุมัติ — ข้อมูลจริงห้ามเข้า repo · เทสนี้ใช้ฟิกซ์เจอร์สังเคราะห์ที่จำลองรูปเดียวกัน):
//   · โอนระหว่างคลัง (ชากค้อ คลัง 0 → หน้าร้านคลัง 1): ใบรออนุมัติ = ITSW (Col A 1 · FSTOCKMAIN 0 · อยู่ใน R04.166) ·
//     หลังอนุมัติ ProMaxx "ลบ ITSW แล้วออกใบใหม่ ITFW" (FSTOCKMAIN +1 · TRANDATE เดิม · REFERENCENO1 เดิม · ใบเดิมหายจาก R16103 และ R04.166)
//   · โอนระหว่างสาขา: ITFS รออนุมัติ → ITFB (แบบเดียวกัน) — สองประเภทนี้อยู่ในรายการใบรับอยู่แล้ว
//   · ช่องว่างที่แก้: ITSW ที่ยังรออนุมัติไม่อยู่ในรายการประเภทใบรับ → ถูกข้าม → นับหลังรับของ = Stock Adj ปลอม (นับครบ) / Pass ปลอม (นับขาด)
//   · R04.166 export ครบทุกสาขา (รวมสาขาที่บอทไม่ดูแล) และมีคอลัมน์ SYSBRANCHID (0=ชากค้อ 4=เก้ากิโล 5=สวนเสือศรีราชา) —
//     ตรงกับ SYSBRANCHID/คลัง/เวลาของใบเดียวกันใน R16.103 ทุกใบที่เทียบได้ → จับคู่ด้วย (SYSBRANCHID, TRANNO) กันเลขที่ชนข้ามสาขา
// เทสนี้: (1) กติกาคัดแถว ITSW (build_receipts_103) (2) Confirm: ITSW รออนุมัติ = ITFW หลังอนุมัติ ผลเท่ากัน
//   (3) load_pending_file + pending_for_branch จับคู่ตามสาขา (4) flow จริง (main + Firestore จำลอง) ต่อสายถึง receipts_for_branch
// ⚠️ ฝั่ง Python = ฟังก์ชันจริงของบอท (ต้องมี Python 3 — ไม่มี = ล้ม ไม่ skip เงียบ) · ห้าม re-implement สูตรที่นี่
const { test, expect } = require('@playwright/test');
const { runPython } = require('../../lib/python');
const H = require('../../lib/r16-confirm-harness');
const F = require('../../lib/r16-104-fixture');
const R = require('../../lib/r16-103-fixture');

const DMY = '21/10/2026';                     // วันที่ในไฟล์ (d/m/yyyy แบบ ProMaxx)
const ISO = '2026-10-21';                     // วันที่ของเวลาสแกน (YYYY-MM-DD HH:mm:ss แบบที่แอปเขียน)
const R01 = '2026-10-21T00:31:00.000Z';      // = 07:31 เวลาไทย
const at = (t) => `${DMY} ${t}`;

const PY_STATS = `
def jstats(st):
    return {k: (dict(v) if isinstance(v, m.Counter) else (v.isoformat() if hasattr(v, 'isoformat') else v)) for k, v in st.items()}
`;
function pyReceipts(branch, csv, { skuSet, bmap, pending = [] }) {
  return runPython(PY_STATS + `
rows = m.parse_csv_text(p['csv'])
rec, st = m.build_receipts_103(rows, p['branch'], set(p['skuSet']), p['bmap'], m.r01_cutoff_local(p['cutoff']), pending=frozenset(p['pending']))
print(json.dumps({'rec': rec, 'st': jstats(st)}, ensure_ascii=False))
`, { branch, csv, skuSet, bmap, cutoff: R01, pending });
}

// ── (1) กติกาคัดแถว: ITSW นับเป็นใบรับ "เฉพาะตอนรออนุมัติ" ──────────────────────
const SKUS = ['S-01', 'S-02', 'S-03', 'S-04', 'S-05'];
const BMAP = Object.fromEntries(SKUS.map((s) => ['B-' + s.slice(2), s]));
// SRC (คลังหน้าร้าน = 1) · รูปตามไฟล์จริง: ITSW261100041 = หน้าร้านเบิกด่วน 4 รายการ 09:28:16 รออนุมัติ
const rs = (o) => R.receipt('SRC', { at: at('09:28:16'), qty: '5.0000', barcode: 'B-01', sku: 'S-01', ...o });
const ROWS = [
  rs({ tranNo: 'ITSW261100041', stockMain: '0', qty: '10.0000', barcode: 'B-01', sku: 'S-01' }),                 // ✔ ITSW รออนุมัติ
  rs({ tranNo: 'ITSW261100041', stockMain: '0', qty: '100.0000', barcode: 'B-02', sku: 'S-02' }),                // ✔
  rs({ tranNo: 'ITSW261100041', stockMain: '0', qty: '5.0000', barcode: 'B-03', sku: 'S-03' }),                  // ✔
  rs({ tranNo: 'ITSW261100041', stockMain: '0', qty: '12.0000', barcode: 'B-04', sku: 'S-04' }),                 // ✔
  rs({ tranNo: 'ITSW261100044', stockMain: '0', qty: '3.0000', barcode: 'B-05', sku: 'S-05', at: at('07:00:00') }),   // ✔ คีย์ก่อน R01 ก็หัก (รออนุมัติ = ยังไม่อยู่ใน R01)
  rs({ tranNo: 'ITSW261100042', stockMain: '0', colA: '0' }),                                                    // ✗ คลังชากค้อ (Col A 0) — ข้ามที่ SRC แม้รออนุมัติ (ตรวจคลังก่อนประเภท)
  rs({ tranNo: 'ITSW261100045', stockMain: '0' }),                                                               // ✗ ไม่อยู่ใน R04.166 + FSTOCKMAIN 0 = ไม่ตัดสต็อก
  rs({ tranNo: 'ITSW261100046', stockMain: '1' }),                                                               // ✗ อยู่ใน R04.166 แต่ +1 → ไม่ใช่รออนุมัติจริง · ITSW ไม่ใช่ประเภทใบรับ
  rs({ tranNo: 'ITSW261100047', stockMain: '1' }),                                                               // ✗ ITSW +1 ไม่อยู่ใน R04.166 — ไม่เคยเห็นในไฟล์จริง · ยังข้ามและเตือน
  rs({ tranNo: 'ITSW261100048', stockMain: '0', cancel: '1' }),                                                  // ✗ ยกเลิก
  rs({ tranNo: 'ITSW261100049', stockMain: '0', qty: '0.0000' }),                                                // ✗ จำนวน 0
  rs({ tranNo: 'ITFW261100167', stockMain: '1', qty: '10.0000', barcode: 'B-04', sku: 'S-04', at: at('11:58:12') }),   // ✔ หลังอนุมัติ: ใบใหม่ ITFW +1 เวลาเดิม
];
const PENDING = ['ITSW261100041', 'ITSW261100044', 'ITSW261100042', 'ITSW261100046', 'ITSW261100048', 'ITSW261100049'];

test('ITSW รออนุมัติ (SRC คลัง 1) = ใบรับ แม้คีย์ก่อน R01 · ITSW อื่นๆ (คลังชากค้อ · ไม่อยู่ใน R04.166 · +1 · ยกเลิก · จำนวน 0) ยังข้าม · ITFW หลังอนุมัติถูกนับ', () => {
  const got = pyReceipts('SRC', R.csvText(ROWS), { skuSet: SKUS, bmap: BMAP, pending: PENDING });
  expect(got.rec).toEqual({
    'S-01': [{ qty: 10, tranDate: at('09:28:16') }],
    'S-02': [{ qty: 100, tranDate: at('09:28:16') }],
    'S-03': [{ qty: 5, tranDate: at('09:28:16') }],
    'S-04': [{ qty: 12, tranDate: at('09:28:16') }, { qty: 10, tranDate: at('11:58:12') }],
    'S-05': [{ qty: 3, tranDate: at('07:00:00') }],
  });
  expect(got.st).toMatchObject({
    file_rows: ROWS.length, kept: 6, skus: 5, docs: 3, qty_total: 10 + 100 + 5 + 12 + 3 + 10,
    cancelled: 1, no_stock: 1, warehouse: 1, zero_qty: 1, before_r01: 0,
    pending_rows: 8, pending_kept: 5, pending_added: 1, pending_other_type: {}, other_type: { ITSW: 2 },
    pending_docs: ['ITSW261100041', 'ITSW261100044'],
  });
});

test('ITSW ไม่ส่ง R04.166 (ชุดว่าง / ไม่ส่งพารามิเตอร์) = ข้ามทั้งหมดเหมือนก่อนแก้ — มีผลเฉพาะใบที่ R04.166 บอกว่ารออนุมัติ · ITFW/ITFB/ITFS ปกติไม่ถูกแตะ', () => {
  const none = pyReceipts('SRC', R.csvText(ROWS), { skuSet: SKUS, bmap: BMAP, pending: [] });
  expect(none.rec).toEqual({ 'S-04': [{ qty: 10, tranDate: at('11:58:12') }] });   // เหลือแค่ ITFW +1 (ปกติ)
  // FSTOCKMAIN 0 ที่ไม่อยู่ใน R04.166 ตกที่ด่าน "ไม่ตัดสต็อก" ก่อนด่านคลัง/ประเภท (ITSW…042 คลัง 0 จึงนับเป็น no_stock ไม่ใช่ warehouse)
  expect(none.st).toMatchObject({ kept: 1, no_stock: 8, cancelled: 1, warehouse: 0, other_type: { ITSW: 2 }, pending_rows: 0, pending_kept: 0, pending_other_type: {} });
});

// ── (2) Confirm: ITSW รออนุมัติ = ITFW หลังอนุมัติ (เวลาเดิม · จำนวนเดิม) → ผลตัดสินเท่ากันทุกกรณี ─────────
const CASE_SKUS = ['S-P1', 'S-P2', 'S-P3'];
const CAT = {
  pm: CASE_SKUS.map((s) => ({ sku: s, productName: 'P ' + s, unitPrice: 10 })),
  r01: CASE_SKUS.map((s) => ({ colE: s, systemQty: 10, productName: 'R ' + s })),     // ระบบ (R01) 10 ทุกตัว · R01 07:31
  r05: CASE_SKUS.map((s) => ({ barcode: 'B-' + s.slice(2), colE: s, unitName: 'EA', unitMultiplier: 1, unitPrice: 10 })),
};
const scan = (cnt, t) => ({ status: 'scanning', countedQty: cnt, timestamp: `${ISO} ${t}`, scannedBy: 'Tester' });
// ทุกตัวรับโอน +5 คีย์ 09:28:16 (ITSW รออนุมัติ → ITFW หลังอนุมัติ · เวลาเดิม)
const ITEMS = {
  'S-P1': scan(15, '15:00:00'),   // นับครบ (10 + 5) หลังรับของ → 15 − 5 = 10 = R01 → Pass (ไม่หัก = Stock Adj +5 ปลอม)
  'S-P2': scan(10, '15:00:00'),   // นับ 10 ทั้งที่ควรมี 15 → ขาด 5 จริง → 10 − 5 = 5 ≠ R01 → Stock Adj (ไม่หัก = Pass ปลอมที่ซ่อนของขาด)
  'S-P3': scan(10, '09:00:00'),   // สแกนก่อนคีย์ใบรับ (09:28) → ไม่หัก → 10 = R01 → Pass
};
const R103_PENDING = ['S-P1', 'S-P2', 'S-P3'].map((s) => R.receipt('SRC', { tranNo: 'ITSW261100041', stockMain: '0', qty: '5.0000', barcode: 'B-' + s.slice(2), sku: s, at: at('09:28:16') }));
const R103_APPROVED = ['S-P1', 'S-P2', 'S-P3'].map((s) => R.receipt('SRC', { tranNo: 'ITFW261100167', stockMain: '1', qty: '5.0000', barcode: 'B-' + s.slice(2), sku: s, at: at('09:28:16') }));

function pyVerdicts() {
  return runPython(`
infos = m.build_sku_infos(p['pm'], p['r01'])
sku_set = m.build_sku_set(p['pm'], p['r01'])
bmap = {r['barcode']: r['colE'] for r in p['r05']}
cut = m.r01_cutoff_local(p['r01v'])
def verdict(csv103, pending):
    rows = m.parse_csv_text(csv103)
    rec, st = m.build_receipts_103(rows, 'SRC', sku_set, bmap, cut, pending=frozenset(pending))
    maps = m.timeline_maps(m.merge_receipts([], rec))
    out = {}
    for sku, it in p['items'].items():
        r = m.evaluate_candidate(sku, it, infos, maps)
        out[sku] = {'status': r['status'], 'eff': r['eff'], 'inbound': r['inbound']}
    return out
print(json.dumps({
    'beforeApproval': verdict(p['csvPending'], ['ITSW261100041']),    # R04.166 ยังมี ITSW
    'afterApproval': verdict(p['csvApproved'], []),                    # ITSW หาย → ITFW ใหม่ · R04.166 ว่าง
    'notListed': verdict(p['csvPending'], []),                         # (ซ้อมเหตุอนุมัติระหว่าง export สองไฟล์) R16103 ยังมี ITSW แต่ R04.166 ไม่มีแล้ว
}, ensure_ascii=False))
`, { ...CAT, r01v: R01, items: ITEMS, csvPending: R.csvText(R103_PENDING), csvApproved: R.csvText(R103_APPROVED) });
}

test('★ Confirm — ITSW รออนุมัติหักเท่า ITFW หลังอนุมัติ (เวลาเดิม · จำนวนเดิม): นับครบ = Pass · นับขาด = Stock Adj · สแกนก่อนคีย์ใบ = ไม่หัก · อนุมัติแล้วผลไม่เปลี่ยน', () => {
  const got = pyVerdicts();
  const want = {
    'S-P1': { status: 'pass', eff: 10, inbound: 5 },
    'S-P2': { status: 'stock_adjustment', eff: 5, inbound: 5 },
    'S-P3': { status: 'pass', eff: 10, inbound: 0 },
  };
  expect(got.beforeApproval, 'ก่อนอนุมัติ (ITSW + R04.166)').toEqual(want);
  expect(got.afterApproval, 'หลังอนุมัติ (ITFW · R04.166 ว่าง) = ผลเดียวกัน').toEqual(want);
  // ไม่หักซ้ำ/ไม่หักเกินแม้ R04.166 กับ R16103 export คนละจังหวะ: ITSW ที่ R04.166 ไม่ได้บอกว่ารออนุมัติ = ไม่ตัดสต็อก = ไม่นับ (เหมือนก่อนแก้)
  expect(got.notListed['S-P1']).toMatchObject({ status: 'stock_adjustment', eff: 15, inbound: 0 });
  expect(got.notListed['S-P2']).toMatchObject({ status: 'pass', eff: 10, inbound: 0 });
});

// ── (3) load_pending_file + pending_for_branch: จับคู่ด้วย (SYSBRANCHID, TRANNO) ─────────
const T21 = `${ISO}T21:05:00+07:00`;
function pyLoadScoped({ text, extra = {} }) {
  return runPython(`
import os, io, tempfile, contextlib
from datetime import datetime
folder = tempfile.mkdtemp(prefix='r4166')
fp = os.path.join(folder, 'R04.166.CSV')
open(fp, 'wb').write(('\\ufeff' + p['text']).encode('utf-8'))
t = datetime.fromisoformat(p['mtime']).timestamp(); os.utime(fp, (t, t))
buf = io.StringIO()
with contextlib.redirect_stdout(buf):
    info = m.load_pending_file(folder, datetime.fromisoformat(p['now']), False, datetime.fromisoformat(p['mtime']))
r103 = {'pending': frozenset(info['pending']), 'pending_by_branch': {k: frozenset(v) for k, v in info['pending_by_branch'].items()},
        'pending_unscoped': frozenset(info['pending_unscoped'])}
legacy = {'pending': frozenset(info['pending'])}   # ผู้เรียกรูปเดิม: ไม่มี pending_by_branch
print(json.dumps({
    'problems': info['problems'], 'pending': sorted(info['pending']),
    'byBranch': {k: sorted(v) for k, v in sorted(info['pending_by_branch'].items())}, 'unscoped': sorted(info['pending_unscoped']),
    'forBranch': {b: sorted(m.pending_for_branch(r103, b)) for b in ('SRC', 'KKL', 'SSS')},
    'legacyForBranch': {b: sorted(m.pending_for_branch(legacy, b)) for b in ('SRC', 'KKL', 'SSS')},
    'log': buf.getvalue(),
}, ensure_ascii=False))
`, { text, mtime: T21, now: `${ISO}T21:10:00+07:00`, ...extra });
}
const blankBranch = (tranNo) => { const r = R.pendingRow(tranNo, 'SSS'); r[1] = ''; return r; };      // SYSBRANCHID ว่าง = ไม่รู้สาขา
const otherBranch = (tranNo, id) => { const r = R.pendingRow(tranNo, 'SSS'); r[1] = id; return r; };  // สาขาที่บอทไม่ดูแล (เช่น 2)
const SCOPED_FILE = F.csvText([
  R.pendingRow('ITSW261100041', 'SRC'), R.pendingRow('ITFSBY006261100017', 'SRC'),
  R.pendingRow('ITFSBY001261100013', 'KKL'), R.pendingRow('ITSW261100099', 'KKL'),          // ★ เลขที่นี้ R04.166 บอกว่าเป็นของ KKL
  R.pendingRow('ITFSBY001261100002', 'SSS'), R.pendingRow('ITFSBY001261100003', 'SSS', { cancel: '1' }),
  otherBranch('ITSW261100088', ' 2 '), blankBranch(' itsw261100077 '),
], { head: R.HEAD_4166 });

test('load_pending_file แยกใบรออนุมัติตาม SYSBRANCHID (trim) · ว่าง = ไม่ระบุสาขา · pending เดิม (ทุกสาขารวม) ไม่เปลี่ยน · log บอกจำนวนต่อสาขา', () => {
  const got = pyLoadScoped({ text: SCOPED_FILE });
  expect(got.problems).toEqual([]);
  expect(got.pending, 'ชุดรวม = รูปเดิม (ใช้ log/เทสเดิม)').toEqual(['ITFSBY001261100002', 'ITFSBY001261100013', 'ITFSBY006261100017',
    'ITSW261100041', 'ITSW261100077', 'ITSW261100088', 'ITSW261100099']);
  expect(got.byBranch).toEqual({
    0: ['ITFSBY006261100017', 'ITSW261100041'],
    2: ['ITSW261100088'],
    4: ['ITFSBY001261100013', 'ITSW261100099'],
    5: ['ITFSBY001261100002'],          // ITFSBY001261100003 ยกเลิก = ไม่นับ
  });
  expect(got.unscoped).toEqual(['ITSW261100077']);
  expect(got.log).toContain('เอกสารรออนุมัติในไฟล์ R4166: 7 ใบ (7 แถว)');
  expect(got.log).toContain('แยกตามสาขา (SYSBRANCHID): SRC 2 · KKL 2 · SSS 1 · สาขาอื่น 1 · ไม่ระบุสาขา 1');
});

test('pending_for_branch — เลขที่ของสาขาอื่นไม่ทำให้ใบเลขเดียวกันของสาขานี้เป็นรออนุมัติ · ไม่ระบุสาขา = ใช้กับทุกสาขา · รูปเดิมไม่มี pending_by_branch = ทั้งชุดเหมือนเดิม', () => {
  const got = pyLoadScoped({ text: SCOPED_FILE });
  expect(got.forBranch).toEqual({
    SRC: ['ITFSBY006261100017', 'ITSW261100041', 'ITSW261100077'],
    KKL: ['ITFSBY001261100013', 'ITSW261100077', 'ITSW261100099'],
    SSS: ['ITFSBY001261100002', 'ITSW261100077'],
  });
  for (const b of ['SRC', 'KKL', 'SSS']) expect(got.legacyForBranch[b], `${b} รูปเดิม`).toEqual(got.pending);

  // ใบ ITSW261100099 ใน R16103 ของ SRC (คลัง 1 · FSTOCKMAIN 0) — R04.166 บอกว่าเป็นของ KKL ไม่ใช่ SRC
  const rows = R.csvText([rs({ tranNo: 'ITSW261100099', stockMain: '0', qty: '4.0000', barcode: 'B-01', sku: 'S-01' })]);
  const scoped = pyReceipts('SRC', rows, { skuSet: SKUS, bmap: BMAP, pending: got.forBranch.SRC });
  expect(scoped.rec, 'จับคู่ตามสาขา: ไม่ใช่รออนุมัติของ SRC = ไม่ตัดสต็อก = ไม่นับ').toEqual({});
  expect(scoped.st).toMatchObject({ kept: 0, no_stock: 1, pending_rows: 0 });
  const legacy = pyReceipts('SRC', rows, { skuSet: SKUS, bmap: BMAP, pending: got.legacyForBranch.SRC });
  expect(legacy.rec, 'ชุดรวมทุกสาขา (รูปเดิม) จะนับผิด — นี่คือเหตุที่ต้องจับคู่ตามสาขา').toEqual({ 'S-01': [{ qty: 4, tranDate: at('09:28:16') }] });
});

// ── (4) flow จริง (main + Firestore จำลอง): R04.166 → pending_by_branch → receipts_for_branch ──────
// SSS · ระบบ (R01) S-26/S-27 = 5 (catalog) · นับ S-26 = 6 (15:00) · S-27 = 7 (10:00)
const { item, world, run, docOf, itemOf } = H;
const T = (t) => `${H.TODAY} ${t}`;
const W = () => world({ branches: ['SSS'], items: { SSS: [item('S-26', 6, '15:00:00'), item('S-27', 7, '10:00:00')] }, sales: { SSS: [] }, sys: {}, r01Version: H.R01_ISO });
const ON = ['--r103', '--r103-branch', 'SSS'];
const CONFIRM = ['--confirm', '--confirm-branch', 'SSS'];
const ROWS_FLOW = [
  R.receipt('SSS', { tranNo: 'ITFSBY001261100001', stockMain: '0', qty: '1.0000', barcode: 'B-26', sku: 'S-26', at: T('11:02:19') }),    // ITFS รออนุมัติ
  R.receipt('SSS', { tranNo: 'ITSW261100041', stockMain: '0', qty: '2.0000', barcode: 'B-27', sku: 'S-27', at: T('07:00:00') }),         // ITSW รออนุมัติ (คีย์ก่อน R01)
];
function published(res, b = 'SSS') {
  const meta = docOf(res, `stock_sessions/${b}_r16_104_meta`);
  const chunks = [];
  for (let i = 0; i < meta.chunkCount; i++) chunks.push(docOf(res, `stock_sessions/${b}_r16_104_${meta.generation}_${String(i).padStart(4, '0')}`).data_json);
  return { meta, rows: chunks.flatMap((c) => JSON.parse(c)) };
}
const rowOf = (pub, sku) => pub.rows.find((r) => r[0] === sku);

test('★ flow — R04.166 บอกใบรออนุมัติถูกสาขา: ITFS + ITSW ถูกหัก (Confirm → Pass) · บอกเป็นของสาขาอื่น: ใบนั้นไม่ถูกหัก (Stock Adj) · log บอกจำนวนต่อสาขา', () => {
  const csv103 = R.csvText(ROWS_FLOW);
  const right = F.csvText([R.pendingRow('ITFSBY001261100001', 'SSS'), R.pendingRow('ITSW261100041', 'SSS')], { head: R.HEAD_4166 });
  const wrong = F.csvText([R.pendingRow('ITFSBY001261100001', 'SSS'), R.pendingRow('ITSW261100041', 'KKL')], { head: R.HEAD_4166 });

  const ok = run({ ...W(), csv103, csv4166: right, runs: [{ args: [...ON, ...CONFIRM] }] });
  expect(ok.runs[0].code, ok.runs[0].log).toBe(0);
  const pubOk = published(ok);
  expect(rowOf(pubOk, 'S-26')).toEqual(['S-26', 0, 1, [], [{ qty: 1, tranDate: T('11:02:19') }]]);
  expect(rowOf(pubOk, 'S-27')).toEqual(['S-27', 0, 2, [], [{ qty: 2, tranDate: T('07:00:00') }]]);
  expect(pubOk.meta).toMatchObject({ r103Mode: 'on', r103Rows: 2, r103Pending: 2 });
  expect(ok.runs[0].log).toContain('เอกสารรออนุมัติในไฟล์ R4166: 2 ใบ (2 แถว)');
  expect(ok.runs[0].log).toContain('แยกตามสาขา (SYSBRANCHID): SRC 0 · KKL 0 · SSS 2 · สาขาอื่น 0');
  expect(itemOf(ok, 'SSS', 'S-26')).toMatchObject({ status: 'pass', inboundQty: 1 });
  expect(itemOf(ok, 'SSS', 'S-27')).toMatchObject({ status: 'pass', inboundQty: 2 });

  const bad = run({ ...W(), csv103, csv4166: wrong, runs: [{ args: [...ON, ...CONFIRM] }] });
  expect(bad.runs[0].code, bad.runs[0].log).toBe(0);
  const pubBad = published(bad);
  expect(rowOf(pubBad, 'S-26'), 'ITFS ของ SSS ยังหัก').toEqual(['S-26', 0, 1, [], [{ qty: 1, tranDate: T('11:02:19') }]]);
  expect(rowOf(pubBad, 'S-27'), 'ITSW261100041 R04.166 บอกว่าเป็นของ KKL → ไม่ใช่รออนุมัติของ SSS → ไม่หัก').toBeUndefined();
  expect(pubBad.meta).toMatchObject({ r103Rows: 1, r103Pending: 1 });
  expect(bad.runs[0].log).toContain('แยกตามสาขา (SYSBRANCHID): SRC 0 · KKL 1 · SSS 1 · สาขาอื่น 0');
  // ไม่หายเงียบ: เลขที่ตรงแต่ R04.166 ระบุเป็นของสาขาอื่น → ⚠️ บอกเลขที่ (ผู้ใช้เห็นว่าทำไมใบรออนุมัติไม่ถูกหัก) · ถูกสาขา = ไม่มี ⚠️ นี้
  expect(bad.runs[0].log).toContain('เลขที่เอกสาร 1 ใบของสาขานี้ (ITSW261100041) ตรงกับใบรออนุมัติใน R04.166 แต่ R04.166 ระบุเป็นของสาขาอื่น (SYSBRANCHID)');
  expect(ok.runs[0].log).not.toContain('R04.166 ระบุเป็นของสาขาอื่น');
  expect(itemOf(bad, 'SSS', 'S-27')).toMatchObject({ status: 'stock_adjustment', effectiveQty: 7, systemQty: 5 });
});
