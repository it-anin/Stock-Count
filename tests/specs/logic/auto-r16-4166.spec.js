// เอกสารรออนุมัติ R4166.CSV ของสาขายา — บอท auto-r16 หักใบรับที่ "รออนุมัติ" ตอน Confirm (17 พ.ย. 2026 · ผู้ใช้สั่ง)
//
// ทำไมต้องมี: ใบรับที่ยังรออนุมัติ (เช่น ITFS รับโอน) อยู่ใน R16103.CSV แต่ FSTOCKMAIN = 0 (ระบบยังไม่บวกสต็อก · ไม่อยู่ใน R01)
//   ขณะที่ของขึ้นชั้นแล้ว (ผู้ใช้ยืนยัน) → บอทเดิมข้ามแถว FSTOCKMAIN 0 (แบบ IPOS) → นับหลังรับของ = Stock Adj ปลอม
//   แก้: เชื่อมเลขที่เอกสาร (คอลัมน์ C ทั้งสองไฟล์) — แถวที่อยู่ใน R4166 และ FSTOCKMAIN 0 = ใบรับจริง: หัก · ไม่ตัดด้วยเวลา R01
//   เลขที่อยู่ใน R4166 แต่ FSTOCKMAIN +1 = ระบบบวกสต็อกแล้ว → กติกาใบรับปกติ (กัน R4166 ที่ปนเอกสารอนุมัติแล้ว → หักซ้ำกับ R01)
// เทสนี้ (ไม่ใช้ Firestore): กติกาคัดแถว · ไม่ส่งชุดรออนุมัติ = ผลเดิมทุกค่า · หัวคอลัมน์ · ด่านไฟล์ R4166
//   · ★ กรณีตามไฟล์จริงของ SSS (สังเคราะห์) ตัดสินด้วยบอท และด้วยโค้ดจริงของหน้าเว็บ ให้ผลเท่ากัน
//   · ไฟล์จริง (opt-in: R16103_PHARM_REAL_FILE + R4166_REAL_FILE — ไฟล์ข้อมูลจริงห้ามเข้า repo)
// flow (main() + Firestore จำลอง) อยู่ที่ auto-r16-103-flow.spec.js · e2e (emulator + Desktop จริง) อยู่ที่ e2e/auto-r16-103.spec.js
// ⚠️ ฝั่ง Python = ฟังก์ชันจริงของบอท (ต้องมี Python 3 — ไม่มี = ล้ม ไม่ skip เงียบ) · ฝั่งเว็บ = index.html จริง · ห้าม re-implement สูตรที่นี่
const fs = require('fs');
const path = require('path');
const { test, expect, bootBare, closeApp } = require('../../lib/hooks');
const { runPython } = require('../../lib/python');
const F = require('../../lib/r16-104-fixture');
const R = require('../../lib/r16-103-fixture');

const DMY = '21/10/2026';                     // วันที่ในไฟล์ (d/m/yyyy แบบ ProMaxx)
const ISO = '2026-10-21';                     // วันที่ของเวลาสแกน (YYYY-MM-DD HH:mm:ss แบบที่แอปเขียน)
const R01 = '2026-10-21T00:31:00.000Z';      // = 07:31 เวลาไทย
const at = (t) => `${DMY} ${t}`;

// stats แปลงเป็น JSON ได้ (Counter → dict · datetime → ISO)
const PY_STATS = `
def jstats(st):
    return {k: (dict(v) if isinstance(v, m.Counter) else (v.isoformat() if hasattr(v, 'isoformat') else v)) for k, v in st.items()}
`;

// pending: undefined = ไม่ส่งพารามิเตอร์เลย (รูปเรียกเดิม) · array = ส่งเป็น frozenset
function pyReceipts(branch, csv, { skuSet, bmap, cutoff = R01, pending }) {
  return runPython(PY_STATS + `
rows = m.parse_csv_text(p['csv'])
cut = m.r01_cutoff_local(p['cutoff']) if p['cutoff'] else None
if p.get('pending') is None:
    rec, st = m.build_receipts_103(rows, p['branch'], set(p['skuSet']), p['bmap'], cut)
else:
    rec, st = m.build_receipts_103(rows, p['branch'], set(p['skuSet']), p['bmap'], cut, pending=frozenset(p['pending']))
print(json.dumps({'rec': rec, 'st': jstats(st)}, ensure_ascii=False))
`, { branch, csv, skuSet, bmap, cutoff, pending: pending ?? null });
}

const SKUS = ['S-01', 'S-02', 'S-03', 'S-04', 'S-05'];
const BMAP = Object.fromEntries(SKUS.map((s) => ['B-' + s.slice(2), s]));
const PENDING_KEYS = ['pending_rows', 'pending_kept', 'pending_added', 'pending_other_type', 'pending_docs'];
const omit = (o, keys) => Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k)));

// แถวชุดใหญ่ของ SSS: ใบรออนุมัติทุกกรณี + ใบที่ไม่อยู่ใน R4166 (ต้องได้ผลเดิม)
const rx = (o) => R.receipt('SSS', { at: at('12:00:00'), qty: '1.0000', barcode: 'B-01', sku: 'S-01', ...o });
const ROWS = [
  rx({ tranNo: 'ITFSBY001261100001', stockMain: '0', at: at('11:02:19') }),                                   // ✔ รออนุมัติ (แบบไฟล์จริง SSS)
  rx({ tranNo: 'ITFBBY001261100002', stockMain: '0.0000', qty: '2.0000', barcode: 'B-02', sku: 'S-02' }),      // ✔ รออนุมัติ · FSTOCKMAIN รูป 0.0000
  rx({ tranNo: 'ITFSBY001261100003', stockMain: '0', qty: '3.0000', barcode: 'B-03', sku: 'S-03', at: at('07:00:00') }),   // ✔ คีย์ก่อน R01 — ยังไม่อยู่ใน R01
  rx({ tranNo: 'ITFSBY001261100004', stockMain: '0', barcode: 'B-04', sku: 'S-04', at: at('07:31:00') }),       // ✔ ตรงเวลา R01 พอดี — ไม่ตัด
  rx({ tranNo: 'IRVCBY001261100005', stockMain: '1', qty: '9.0000', at: at('07:00:00') }),                      // ✗ อยู่ใน R4166 แต่ +1 → ปกติ: ก่อน R01
  rx({ tranNo: 'IRVCBY001261100006', stockMain: '1', qty: '5.0000', barcode: 'B-02', sku: 'S-02', at: at('13:00:00') }),   // ✔ อยู่ใน R4166 แต่ +1 → ปกติ: หลัง R01
  rx({ tranNo: 'ITFSBY001261100007', stockMain: '0', cancel: '1' }),            // ✗ ยกเลิก (ไม่นับใน pending_rows)
  rx({ tranNo: 'ITFSBY001261100008', stockMain: '0', colA: '1' }),              // ✗ ไม่ใช่คลังของ R01 (SSS = 0)
  rx({ tranNo: 'IPOSBY001261100009', stockMain: '0' }),                         // ✗ รออนุมัติแต่ไม่ใช่ประเภทใบรับ (pending_other_type)
  rx({ tranNo: 'ITFSBY001261100010', stockMain: '-1' }),                        // ✗ ตัดออก
  rx({ tranNo: 'ITFSBY001261100011', stockMain: '' }),                          // ✗ FSTOCKMAIN ว่าง — ห้ามตีเป็น 0 แม้รออนุมัติ
  rx({ tranNo: 'ITFSBY001261100012', stockMain: '2' }),                         // ✗ ไม่ใช่ 0/+1
  rx({ tranNo: 'ITFSBY001261100013', stockMain: '0', qty: '0.0000' }),          // ✗ จำนวน 0
  rx({ tranNo: 'ITFSBY001261100014', stockMain: '0', at: 'garbage' }),          // ✗ วันที่อ่านไม่ได้
  rx({ tranNo: 'ITFSBY001261100015', stockMain: '0', barcode: 'B-NOPE', sku: 'NOPE' }),   // ✗ ไม่พบ SKU
  rx({ tranNo: ' itfsby001261100016 ', stockMain: '0', at: at('15:00:00') }),  // ✔ เลขที่ใน R16.103 มีช่องว่าง/ตัวเล็ก — เทียบแบบ trim + ตัวใหญ่
  rx({ tranNo: 'ITFSBY001261100017', stockMain: '0' }),                         // ✗ ไม่อยู่ใน R4166 + 0 = ไม่ตัดสต็อก (เดิม)
  rx({ tranNo: 'ITFSBY001261100018', stockMain: '1', qty: '4.0000', barcode: 'B-05', sku: 'S-05', at: at('14:00:00') }),   // ✔ ITFS +1 ปกติ (เพิ่ม ITFS ในรายการ)
  rx({ tranNo: 'IPOSBY001261100019', stockMain: '0' }),                         // ✗ ไม่อยู่ใน R4166 + 0 (เดิม)
  rx({ tranNo: 'IRPSBY001261100020', colA: '1' }),                              // ✗ คลังอื่น — ตรวจ Col A ก่อนประเภท: นับเป็นคลังอื่น ไม่ใช่ "ประเภทนอกรายการ"
];
const PENDING = ['ITFSBY001261100001', 'ITFBBY001261100002', 'ITFSBY001261100003', 'ITFSBY001261100004', 'IRVCBY001261100005',
  'IRVCBY001261100006', 'ITFSBY001261100007', 'ITFSBY001261100008', 'IPOSBY001261100009', 'ITFSBY001261100010', 'ITFSBY001261100011',
  'ITFSBY001261100012', 'ITFSBY001261100013', 'ITFSBY001261100014', 'ITFSBY001261100015', 'ITFSBY001261100016',
  'OTFBBY001261100122'];   // เอกสารรออนุมัติที่ไม่มีใน R16.103 (เช่นใบโอนออก) — ไม่มีผล

test('กติกาเอกสารรออนุมัติ (SSS) — อยู่ใน R4166 + FSTOCKMAIN 0 = ใบรับ (ไม่ตัดด้วยเวลา R01) · +1 = กติกาปกติ · ด่านอื่นเหมือนเดิม · ทุกแถวที่ข้ามนับใน stats', () => {
  const got = pyReceipts('SSS', R.csvText(ROWS), { skuSet: SKUS, bmap: BMAP, pending: PENDING });
  expect(got.rec).toEqual({
    'S-01': [{ qty: 1, tranDate: at('11:02:19') }, { qty: 1, tranDate: at('15:00:00') }],
    'S-02': [{ qty: 2, tranDate: at('12:00:00') }, { qty: 5, tranDate: at('13:00:00') }],
    'S-03': [{ qty: 3, tranDate: at('07:00:00') }],
    'S-04': [{ qty: 1, tranDate: at('07:31:00') }],
    'S-05': [{ qty: 4, tranDate: at('14:00:00') }],
  });
  expect(got.st).toMatchObject({
    file_rows: ROWS.length, kept: 7, skus: 5, docs: 7, qty_total: 1 + 2 + 3 + 1 + 5 + 1 + 4,
    cancelled: 1, no_stock: 2, stock_out: 1, bad_stock_main: 2, before_r01: 1, zero_qty: 1, bad_date: 1, missing: 1,
    warehouse: 0, other_type: {}, other_warehouse: { 1: 2 },
    pending_rows: 15, pending_kept: 5, pending_added: 2, pending_other_type: { IPOS: 1 },
    pending_docs: ['ITFBBY001261100002', 'ITFSBY001261100001', 'ITFSBY001261100003', 'ITFSBY001261100004', 'ITFSBY001261100016'],
    min_td: '2026-10-21T07:00:00', max_td: '2026-10-21T15:00:00',
  });
});

test('ไม่ส่งชุดรออนุมัติ / ชุดว่าง / เลขที่ไม่อยู่ในไฟล์ = ผลเดิมทุกค่า · ชุดที่มีแต่ใบ +1 = ใบรับเท่าเดิม (R4166 เปลี่ยนผลได้เฉพาะแถว FSTOCKMAIN 0)', () => {
  const csv = R.csvText(ROWS);
  const opt = { skuSet: SKUS, bmap: BMAP };
  const none = pyReceipts('SSS', csv, opt);
  const empty = pyReceipts('SSS', csv, { ...opt, pending: [] });
  const stranger = pyReceipts('SSS', csv, { ...opt, pending: ['OTFBBY001261100122', 'ZZZZ'] });
  const added = pyReceipts('SSS', csv, { ...opt, pending: ['IRVCBY001261100005', 'IRVCBY001261100006', 'ITFSBY001261100018'] });
  expect(empty).toEqual(none);
  expect(stranger).toEqual(none);
  expect(none.st).toMatchObject({ pending_rows: 0, pending_kept: 0, pending_added: 0, pending_other_type: {}, pending_docs: [] });
  // ผลเดิม (ก่อนมี R4166): เก็บเฉพาะ +1 หลัง R01 — ITFS +1 ถูกนับ (ITFS อยู่ในรายการใบรับแล้ว)
  expect(none.rec).toEqual({ 'S-02': [{ qty: 5, tranDate: at('13:00:00') }], 'S-05': [{ qty: 4, tranDate: at('14:00:00') }] });
  expect(none.st).toMatchObject({ kept: 2, no_stock: 12, before_r01: 1, other_type: {} });
  expect(added.rec, 'ใบ +1 ที่อยู่ใน R4166 = กติกาปกติ (ใบก่อน R01 ไม่ถูกหักซ้ำ)').toEqual(none.rec);
  expect(omit(added.st, PENDING_KEYS)).toEqual(omit(none.st, PENDING_KEYS));
  expect(added.st).toMatchObject({ pending_rows: 3, pending_added: 3, pending_kept: 0, pending_docs: [] });
});

test('ตรวจคลัง (Col A) ก่อนประเภท — IRPS ของคลังชากค้อที่ SRC = "คลังชากค้อ" ไม่ถูกเตือนว่าประเภทนอกรายการ · IRPS ของหน้าร้านยังถูกเตือน (ห้ามเพิ่มในรายการ)', () => {
  const mk = (o) => R.receipt('SRC', { at: at('12:00:00'), barcode: 'B-01', sku: 'S-01', ...o });
  const got = pyReceipts('SRC', R.csvText([mk({ tranNo: 'IRPSBY000261100001', colA: '0' }), mk({ tranNo: 'IRPSBY000261100002', colA: '1' }),
    mk({ tranNo: 'ITFWBY000261100003', colA: '0' }), mk({ tranNo: 'ITFWBY000261100004', colA: '1', qty: '2.0000' })]), { skuSet: SKUS, bmap: BMAP, pending: [] });
  expect(got.rec).toEqual({ 'S-01': [{ qty: 2, tranDate: at('12:00:00') }] });
  expect(got.st).toMatchObject({ kept: 1, warehouse: 2, other_type: { IRPS: 1 }, other_warehouse: {} });
});

test('หัวคอลัมน์ R4166 — คอลัมน์ C = TRANNO + มี SYSBRANCHID/TRANDATE/FCANCEL + ไม่มีคอลัมน์รายบรรทัด (กันหยิบ R16103.CSV มาแทน)', () => {
  const swapped = [...R.HEAD_4166]; [swapped[2], swapped[3]] = [swapped[3], swapped[2]];
  const noCancel = R.HEAD_4166.filter((h) => h !== 'FCANCEL');
  const lower = R.HEAD_4166.map((h) => ` ${h.toLowerCase()} `);
  const withItem = [...R.HEAD_4166, 'FSTOCKMAIN'];
  const got = runPython(`
print(json.dumps([m.pending_header_problems([h]) for h in p['heads']] + [m.pending_header_problems([])], ensure_ascii=False))
`, { heads: [R.HEAD_4166, lower, swapped, noCancel, F.HEAD, withItem, ['TRANNO']] });
  expect(got[0], 'หัวจริง 19 คอลัมน์').toEqual([]);
  expect(got[1], 'ตัวเล็ก/ช่องว่างรอบชื่อ').toEqual([]);
  expect(got[2].join(' ')).toContain('คอลัมน์ C ควรเป็น TRANNO แต่เจอ SYSSALEID');
  expect(got[3]).toEqual(['ไม่พบคอลัมน์ FCANCEL']);
  expect(got[4], 'R16.103 (คอลัมน์ C ก็เป็น TRANNO) ต้องไม่ผ่าน').toEqual(['มีคอลัมน์รายบรรทัด SCANCODE, BASEQUANTITY, FSTOCKMAIN — ดูเป็นรายงานใบรับรายบรรทัด (R16.103?) ไม่ใช่รายงานเอกสารรออนุมัติ R41.66']);
  expect(got[5].join(' ')).toContain('มีคอลัมน์รายบรรทัด FSTOCKMAIN');
  expect(got[6].join(' ')).toContain('คอลัมน์ C ควรเป็น TRANNO แต่เจอ (ว่าง)');
  expect(got[7]).toEqual(['ไฟล์ว่าง ไม่มีแม้แต่แถวหัวตาราง']);
});

// ── ด่านไฟล์ R4166 (load_pending_file) — ไฟล์จริงบนดิสก์ + นาฬิกาคงที่ ─────────
// files: [{name, text|dir, mtime}] · now/ref: ISO เวลาไทย · force
function pyLoad({ files, now = `${ISO}T21:10:00+07:00`, ref = `${ISO}T21:05:00+07:00`, force = false }) {
  return runPython(`
import os, io, tempfile, contextlib
from datetime import datetime
folder = tempfile.mkdtemp(prefix='r4166')
for f in p['files']:
    fp = os.path.join(folder, f['name'])
    if f.get('dir'): os.makedirs(fp)
    else: open(fp, 'wb').write(('\\ufeff' + f['text']).encode('utf-8'))
    t = datetime.fromisoformat(f['mtime']).timestamp(); os.utime(fp, (t, t))
buf = io.StringIO()
with contextlib.redirect_stdout(buf):
    info = m.load_pending_file(folder, datetime.fromisoformat(p['now']), p['force'], datetime.fromisoformat(p['ref']) if p['ref'] else None)
print(json.dumps({'file': info['file'], 'pending': sorted(info['pending']), 'rows': info['rows'], 'cancelled': info['cancelled'],
                  'problems': info['problems'], 'log': buf.getvalue()}, ensure_ascii=False))
`, { files, now, ref, force });
}
const T21 = `${ISO}T21:05:00+07:00`;
const GOOD = R.csvText([R.pendingRow('ITFSBY001261100001'), R.pendingRow(' itfbby001261100002 ', 'SSS'),
  R.pendingRow('ITFSBY001261100003', 'SSS', { cancel: '1' }), R.pendingRow('', 'SSS'), R.pendingRow('IRVCBY000261100004', 'SRC'),
  R.pendingRow('ITFSBY001261100001')], { head: R.HEAD_4166 });

test('load_pending_file — อ่านเลขที่เอกสาร (trim + ตัวใหญ่ · ข้ามใบยกเลิก/แถวว่าง · ซ้ำนับครั้งเดียว) · มีแต่หัว = ไม่มีใบรออนุมัติ (ปกติ)', () => {
  const ok = pyLoad({ files: [{ name: 'R4166.CSV', text: GOOD, mtime: T21 }] });
  expect(ok.problems).toEqual([]);
  expect(ok.file).toBe('R4166.CSV');
  expect(ok.pending).toEqual(['IRVCBY000261100004', 'ITFBBY001261100002', 'ITFSBY001261100001']);
  expect(ok).toMatchObject({ rows: 4, cancelled: 1 });
  expect(ok.log).toContain('เอกสารรออนุมัติในไฟล์ R4166: 3 ใบ (4 แถว) — IRVCBY000261100004, ITFBBY001261100002, ITFSBY001261100001 · ข้ามใบยกเลิก 1 แถว');
  const head = pyLoad({ files: [{ name: 'R4166.CSV', text: R.csv4166([]), mtime: T21 }] });
  expect(head).toMatchObject({ problems: [], pending: [], rows: 0, cancelled: 0 });
  expect(head.log).toContain('เอกสารรออนุมัติในไฟล์ R4166: 0 ใบ (0 แถว)');
  // หลายไฟล์ = ใช้ไฟล์ใหม่สุด · ไฟล์ .part. (BOTR16103 กำลังเขียน) ไม่ถูกหยิบ
  const two = pyLoad({ files: [{ name: 'R4166.CSV', text: 'ขยะ', mtime: `${ISO}T08:00:00+07:00` }, { name: 'R4166_2.CSV', text: GOOD, mtime: T21 },
    { name: 'R4166.part.CSV', text: 'ขยะ', mtime: `${ISO}T21:08:00+07:00` }] });
  expect(two).toMatchObject({ file: 'R4166_2.CSV', problems: [] });
});

test('load_pending_file — ด่าน: ไม่มีไฟล์ · ไม่ใช่วันนี้ · ยังไม่นิ่ง · ห่างจาก R16103 เกิน 30 นาที (--force ข้ามได้) · หัวผิด/อ่านไม่ได้ (--force ข้ามไม่ได้)', () => {
  const cases = [
    { name: 'ไม่มีไฟล์', files: [], msg: "ไม่พบไฟล์เอกสารรออนุมัติ 'R4166*.CSV' ในโฟลเดอร์", force: false },
    { name: 'มีแต่ .part.', files: [{ name: 'R4166.part.CSV', text: GOOD, mtime: T21 }], msg: "ไม่พบไฟล์เอกสารรออนุมัติ 'R4166*.CSV'", force: false },
    { name: 'ไม่ใช่วันนี้', files: [{ name: 'R4166.CSV', text: GOOD, mtime: '2026-10-20T21:05:00+07:00' }], ref: '2026-10-20T21:05:00+07:00',
      msg: 'ไฟล์ R4166 ไม่ได้ถูกแก้ไขวันนี้', force: true },
    { name: 'ยังไม่นิ่ง', files: [{ name: 'R4166.CSV', text: GOOD, mtime: `${ISO}T21:09:30+07:00` }], msg: 'ไฟล์ R4166 เพิ่งถูกแก้เมื่อ 30 วินาทีก่อน', force: true },
    { name: 'ห่างเกิน 30 นาที (ก่อน)', files: [{ name: 'R4166.CSV', text: GOOD, mtime: `${ISO}T20:34:59+07:00` }],
      msg: 'ไฟล์ R4166 (20:34) กับ R16103 (21:05) ส่งออกห่างกันเกิน 30 นาที', force: true },
    { name: 'ห่างเกิน 30 นาที (หลัง)', files: [{ name: 'R4166.CSV', text: GOOD, mtime: `${ISO}T21:05:00+07:00` }], ref: `${ISO}T20:34:00+07:00`,
      msg: 'ไฟล์ R4166 (21:05) กับ R16103 (20:34) ส่งออกห่างกันเกิน 30 นาที', force: true },
    { name: 'หัว = R16.103', files: [{ name: 'R4166.CSV', text: R.csvText([R.receipt('SSS')]), mtime: T21 }], msg: 'หัวคอลัมน์ R4166 ไม่ตรงที่คาด: มีคอลัมน์รายบรรทัด', force: false },
    { name: 'ไฟล์ว่าง', files: [{ name: 'R4166.CSV', text: '', mtime: T21 }], msg: 'หัวคอลัมน์ R4166 ไม่ตรงที่คาด: ไฟล์ว่าง', force: false },
    { name: 'อ่านไม่ได้', files: [{ name: 'R4166.CSV', dir: true, mtime: T21 }], msg: 'อ่านไฟล์ R4166 ไม่สำเร็จ', force: false },
  ];
  for (const c of cases) {
    const got = pyLoad({ files: c.files, ref: c.ref });
    expect(got.problems.join(' | '), c.name).toContain(c.msg);
    expect(got.pending, `${c.name}: ใช้ไม่ได้ = ไม่มีชุดรออนุมัติ`).toEqual([]);
    const fo = pyLoad({ files: c.files, ref: c.ref, force: true });
    if (c.force) {
      expect(fo.problems, `${c.name} + --force`).toEqual([]);
      expect(fo.pending, `${c.name} + --force`).toEqual(['IRVCBY000261100004', 'ITFBBY001261100002', 'ITFSBY001261100001']);
      expect(fo.log).toContain('แต่มี --force ดำเนินการต่อ');
    } else {
      expect(fo.problems.join(' | '), `${c.name} + --force ข้ามไม่ได้`).toContain(c.msg);
    }
  }
  // ขอบเขตพอดี: ห่าง 30 นาทีพอดี = ผ่าน · ไม่ส่งเวลา R16103 (ไฟล์ R16103 หาย) = ไม่ตรวจข้อนี้
  expect(pyLoad({ files: [{ name: 'R4166.CSV', text: GOOD, mtime: `${ISO}T20:35:00+07:00` }] }).problems).toEqual([]);
  expect(pyLoad({ files: [{ name: 'R4166.CSV', text: GOOD, mtime: `${ISO}T18:00:00+07:00` }], ref: null }).problems).toEqual([]);
});

// ── ★ กรณีตามไฟล์จริงของ SSS (สังเคราะห์) — บอท = หน้าเว็บจริง ─────────────
// ระบบ (R01) 10 ทุกตัว · R01 07:31
const CASE_SKUS = ['S-P1', 'S-P2', 'S-P3', 'S-P4', 'S-P5'];
const CAT = {
  pm: CASE_SKUS.map((s) => ({ sku: s, productName: 'P ' + s, unitPrice: 10 })),
  r01: CASE_SKUS.map((s) => ({ colE: s, systemQty: 10, productName: 'R ' + s })),
  r05: CASE_SKUS.map((s) => ({ barcode: 'B-' + s.slice(2), colE: s, unitName: 'EA', unitMultiplier: 1, unitPrice: 10 })),
};
const prc = (sku, tranNo, sm, qty, t) => R.receipt('SSS', { tranNo, stockMain: sm, qty: `${qty}.0000`, barcode: 'B-' + sku.slice(2), sku, at: at(t) });
const ROWS104 = [F.branchRow('SSS', { tranNo: 'ORCMBY006261100001', colA: '0', qty: '1.0000', barcode: 'B-P5', sku: 'S-P5', at: at('16:00:00') })];   // ขายหลังนับ = ไม่นับ
const ROWS103 = [
  prc('S-P1', 'ITFSBY001261100001', '0', 1, '11:02:19'),   // รออนุมัติ (แบบไฟล์จริง) · นับ 15:00 = 11 → 11 − 1 = 10 Pass (ไม่มี R4166 = Stock Adj ปลอม)
  prc('S-P2', 'ITFSBY001261100002', '0', 1, '11:02:19'),   // รออนุมัติ · นับ 10:00 ก่อนคีย์ใบ → ไม่หัก → 10 Pass
  prc('S-P3', 'ITFBBY001261100003', '0', 2, '07:00:00'),   // รออนุมัติ คีย์ก่อน R01 · นับ 09:00 = 12 → 12 − 2 = 10 Pass (ไม่ตัดด้วยเวลา R01)
  prc('S-P4', 'IRVCBY001261100004', '1', 3, '07:00:00'),   // อยู่ใน R4166 แต่ +1 คีย์ก่อน R01 (อยู่ใน R01 แล้ว) · นับ 10 → ห้ามหักซ้ำ → Pass
  prc('S-P5', 'IRVCBY001261100005', '1', 5, '12:00:00'),   // ใบรับปกติ (อนุมัติแล้ว) · นับ 15:00 = 15 → 15 − 5 = 10 Pass
];
const PENDING_CASES = ['ITFSBY001261100001', 'ITFSBY001261100002', 'ITFBBY001261100003', 'IRVCBY001261100004'];
const ITEMS = { 'S-P1': [11, '15:00:00'], 'S-P2': [10, '10:00:00'], 'S-P3': [12, '09:00:00'], 'S-P4': [10, '10:00:00'], 'S-P5': [15, '15:00:00'] };
const scanItem = ([cnt, t]) => ({ status: 'scanning', countedQty: cnt, timestamp: `${ISO} ${t}`, scannedBy: 'Tester' });
// base = ไม่มีใบรับ · r103 = ใบรับแต่ไม่มี R4166 (รุ่นก่อนหน้า) · pend = ใบรับ + R4166
const WANT = {
  'S-P1': { base: 'stock_adjustment', r103: 'stock_adjustment', pend: 'pass', inbound: 1 },
  'S-P2': { base: 'pass', r103: 'pass', pend: 'pass', inbound: 0 },
  'S-P3': { base: 'stock_adjustment', r103: 'stock_adjustment', pend: 'pass', inbound: 2 },
  'S-P4': { base: 'pass', r103: 'pass', pend: 'pass', inbound: 0 },
  'S-P5': { base: 'stock_adjustment', r103: 'pass', pend: 'pass', inbound: 5 },
};

function pyCases() {
  return runPython(`
infos = m.build_sku_infos(p['pm'], p['r01'])
sku_set = m.build_sku_set(p['pm'], p['r01'])
bmap = {r['barcode']: r['colE'] for r in p['r05']}
tl, _ = m.build_timeline(m.parse_csv_text(p['csv104']), 'SSS', sku_set, bmap)
rows103 = m.parse_csv_text(p['csv103'])
cut = m.r01_cutoff_local(p['r01v'])
rec0, _ = m.build_receipts_103(rows103, 'SSS', sku_set, bmap, cut)
rec1, st1 = m.build_receipts_103(rows103, 'SSS', sku_set, bmap, cut, pending=frozenset(p['pending']))
def ev(timeline):
    maps = m.timeline_maps(timeline); out = {}
    for sku, it in p['items'].items():
        r = m.evaluate_candidate(sku, it, infos, maps)
        out[sku] = {'status': r['status'], 'soldQty': r['sold'], 'inboundQty': r['inbound'], 'effectiveCnt': r['eff']}
    return out
t0, t1 = m.merge_receipts(tl, rec0), m.merge_receipts(tl, rec1)
print(json.dumps({'tl': {'base': tl, 'r103': t0, 'pend': t1}, 'ev': {'base': ev(tl), 'r103': ev(t0), 'pend': ev(t1)},
                  'pendingKept': st1['pending_kept'], 'pendingAdded': st1['pending_added']}, ensure_ascii=False))
`, { ...CAT, csv104: F.csvText(ROWS104), csv103: R.csvText(ROWS103), r01v: R01, pending: PENDING_CASES,
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

test('★ กรณีตามไฟล์จริงของ SSS — ใบรออนุมัติถูกหักเมื่อสแกนหลังเวลาคีย์ · คีย์ก่อน R01 ก็หัก · ใบ +1 ใน R4166 ไม่หักซ้ำ · บอท = หน้าเว็บจริงทุกค่า', async ({ browser }) => {
  const py = pyCases();
  for (const [sku, w] of Object.entries(WANT)) {
    for (const k of ['base', 'r103', 'pend']) expect(py.ev[k][sku].status, `${sku} ${k}`).toBe(w[k]);
    expect(py.ev.pend[sku].inboundQty, `${sku} รับเข้าก่อนเวลาสแกน`).toBe(w.inbound);
  }
  expect(py.ev.pend['S-P1'].effectiveCnt, 'S-P1: 11 − 1 = 10').toBe(10);
  expect(py.ev.pend['S-P3'].effectiveCnt, 'S-P3: 12 − 2 = 10').toBe(10);
  expect(py).toMatchObject({ pendingKept: 3, pendingAdded: 1 });
  const app = await bootBare(browser);
  try {
    for (const k of ['base', 'r103', 'pend']) expect(await webCases(app.page, py.tl[k]), `หน้าเว็บ = บอท (${k})`).toEqual(py.ev[k]);
  } finally {
    await closeApp(app);
  }
});

// ── ไฟล์จริง (opt-in · ไม่เข้า repo) ────────────────────────────────────────
// R16103_PHARM_REAL_FILE = R16103.CSV ของ BOTR16103 (3 สาขาในไฟล์เดียว) · R4166_REAL_FILE = R4166.CSV ของวันเดียวกัน
// ตรวจคุณสมบัติที่ต้องจริงเสมอ (ไม่ผูกกับตัวเลขของวันใดวันหนึ่ง): ใบรับที่ R4166 เพิ่มให้ = เฉพาะใบรออนุมัติ · ไม่ลบใบรับเดิม · หัวคอลัมน์ผ่าน
const REAL103 = process.env.R16103_PHARM_REAL_FILE;
const REAL4166 = process.env.R4166_REAL_FILE;
test('ไฟล์จริง (opt-in: R16103_PHARM_REAL_FILE + R4166_REAL_FILE) — R4166 เพิ่มได้เฉพาะใบรออนุมัติ (FSTOCKMAIN 0) · ใบรับเดิมอยู่ครบ', () => {
  test.skip(!REAL103 || !REAL4166, 'ตั้ง R16103_PHARM_REAL_FILE และ R4166_REAL_FILE เพื่อรันกับไฟล์จริง');
  const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'r4166real-'));
  fs.copyFileSync(REAL4166, path.join(dir, 'R4166.CSV'));
  const got = runPython(`
import os, io, contextlib
from collections import Counter
from datetime import datetime
rows = m.read_rows(p['f103'])
by_branch, _, _ = m.split_by_branch(rows)
buf = io.StringIO()
with contextlib.redirect_stdout(buf):
    info = m.load_pending_file(p['dir'], datetime.now(m.BKK), True, None)
day = None
for r in rows[1:]:
    d = m.parse_tran_date(m.normalize_tran_date(m.col(r, m.tran_date_col(rows[0]))))
    if d: day = d.date(); break
cut = datetime(day.year, day.month, day.day, 7, 31) if day else None
out = {'problems': info['problems'], 'header103': m.receipt_header_problems(rows), 'pending': sorted(info['pending']), 'branches': {}}
for b in ('SRC', 'KKL', 'SSS'):
    own = [rows[0]] + (by_branch.get(b) or [])
    skus = set(m.js_trim(m.col(r, m.COL_SKU)) for r in own[1:]) - {''}
    bmap = {m.normalize_barcode(m.js_trim(m.col(r, m.COL_BARCODE))): m.js_trim(m.col(r, m.COL_SKU)) for r in own[1:]}
    r0, s0 = m.build_receipts_103(own, b, skus, bmap, cut)
    r1, s1 = m.build_receipts_103(own, b, skus, bmap, cut, pending=frozenset(info['pending']))
    smi = m.stock_main_col(rows[0])
    sm0 = {m.js_trim(m.col(r, m.COL_TRANNO)).upper() for r in own[1:]
           if m.js_trim(m.col(r, smi)) != '' and m._js_number(m.js_trim(m.col(r, smi))) == 0}
    kept0 = sum(len(v) for v in r0.values()); kept1 = sum(len(v) for v in r1.values())
    subset = all(Counter(map(json.dumps, r1.get(k, []))) >= Counter(map(json.dumps, v)) for k, v in r0.items())
    out['branches'][b] = {'rows': len(own) - 1, 'kept0': kept0, 'kept1': kept1, 'pendingKept': s1['pending_kept'], 'subset': subset,
                          'pendingDocs': s1['pending_docs'], 'docsAreZero': all(d in sm0 for d in s1['pending_docs'])}
print(json.dumps(out, ensure_ascii=False))
`, { f103: REAL103, dir });
  console.log(JSON.stringify(got));
  expect(got.problems, 'R4166 จริงผ่านด่าน (--force ข้ามเรื่องวันที่/เวลา)').toEqual([]);
  expect(got.header103).toEqual([]);
  for (const [b, x] of Object.entries(got.branches)) {
    expect(x.subset, `${b}: ใบรับเดิมต้องอยู่ครบ`).toBe(true);
    expect(x.kept1 - x.kept0, `${b}: ที่เพิ่ม = บรรทัดรออนุมัติเท่านั้น`).toBe(x.pendingKept);
    expect(x.docsAreZero, `${b}: ใบรออนุมัติที่หักต้องเป็น FSTOCKMAIN 0 ในไฟล์`).toBe(true);
    for (const d of x.pendingDocs) expect(got.pending, `${b}: ${d} ต้องอยู่ใน R4166`).toContain(d);
  }
});
