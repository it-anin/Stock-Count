// เครื่องมือรอบ Confirm ของบอท auto-r16: --confirm-undo (ย้อนผล) · --confirm-compare (เทียบโหมดเงา) · การตรวจ flag · exit code
//
// ทำไมต้องมี: ทางถอยต้องใช้ได้จริงตอนเกิดเรื่อง — ผู้ใช้สั่งชัดว่า "ถ้าไม่ดีหรือมี bug เกินให้ย้อนกลับได้" · flag ที่ตั้งผิดแล้ว "เงียบแต่ไม่ทำงาน"
// อันตรายกว่าปฏิเสธ (Task ตั้งไว้ในเครื่องที่ไม่ใช่ git clone ค่าที่ผิดอยู่นานโดยไม่มีใครเห็น)
// ฝั่งบอทเป็นโค้ดจริง · Firestore REST/นาฬิกา/sleep จำลองที่ tests/lib/r16-confirm-harness.js — ต้องมี Python 3
const { test, expect } = require('@playwright/test');
const H = require('../../lib/r16-confirm-harness');
const { runPython } = require('../../lib/python');
const { item, world, run, itemOf, docOf, untouched, confirmWrites } = H;

const GOOD = [
  item('S-21', 5, '10:00:00'),
  item('S-22', 3, '11:00:00'),
  item('S-23', 3, '11:00:00'),
  item('S-24', 4, '11:00:00'),
  item('S-25', 0, '11:30:00', { noStock: true }),
  item('S-26', 7, '10:00:00'),
];
const SALES = [['B-23', 2, '10:30:00'], ['B-24', 2, '12:00:00'], ['B-26', 2, '09:00:00', 'inbound']];
const baseWorld = (over = {}) => world({ branches: ['SSS'], items: { SSS: GOOD }, sales: { SSS: SALES }, ...over });
const REAL = ['--confirm', '--confirm-branch', 'SSS'];
const UNDO = ['--confirm-undo', '{JOURNAL_LATEST}'];
const SKUS = GOOD.map((g) => g.sku);
const itemPath = (sku) => `stock_sessions/SSS/items/${sku}`;

// ฟิลด์ที่ย้อนแล้วต้องเท่าเดิม (ยกเว้น rev/updatedBy/updatedAt ที่เดินหน้าอย่างเดียว)
const core = (o) => { const { rev: _r, updatedBy: _u, updatedAt: _a, ...rest } = o; return rest; };

// ── --confirm-undo ───────────────────────────────────────────────────────
test('undo — ทุกฟิลด์กลับเท่าก่อน Confirm เป๊ะ (รวมฟิลด์ที่บอทเพิ่มต้องถูกลบ) · rev เดินหน้า · lock ถือแล้วปล่อย · journal ถูกจดว่า undone · audit log ถูกล้าง', async () => {
  const w = baseWorld();
  const res = run({ ...w, runs: [{ args: REAL }, { args: UNDO }] });
  expect(res.runs[0].code, res.runs[0].log).toBe(0);
  const confirmed = res.runs[0];
  expect(itemOf(confirmed, 'SSS', 'S-22').directAdj, 'ก่อนย้อน: Confirm แล้ว').toBe(true);
  expect(docOf(confirmed, 'stock_audit_log/SSS_2026-10-21').items.length).toBe(2);

  const u = res.runs[1];
  expect(u.code, u.log).toBe(0);
  for (const g of GOOD) {
    const after = itemOf(u, 'SSS', g.sku);
    expect(core(after), `${g.sku}: ทุกฟิลด์กลับเท่าเดิม (ไม่มี soldQty/directAdj/initialStatus ฯลฯ ที่บอทเพิ่ม)`).toEqual(core(g));
    expect(after.rev, `${g.sku}: rev เดินหน้า (4 → 5) ไม่ถอย`).toBe(5);
    expect(after.updatedBy).toBe('auto-r16-undo');
    expect(after.updatedAt, `${g.sku}: updatedAt ใหม่`).not.toBe(itemOf(confirmed, 'SSS', g.sku).updatedAt);
  }
  const cw = confirmWrites(u);
  expect(cw.filter((x) => x.path.includes('/items/')).map((x) => x.path.split('/').pop()).sort()).toEqual(SKUS);
  expect(cw.find((x) => x.path === 'stock_sessions/SSS_confirm_lock' && x.op === 'update'), 'ถือ lock ตอนย้อน').toBeTruthy();
  expect(u.store['stock_sessions/SSS_confirm_lock'], 'ปล่อย lock แล้ว').toBeUndefined();
  expect(u.sleeps).toEqual([3.8]);
  expect(docOf(u, 'stock_audit_log/SSS_2026-10-21').items, 'รายการที่ย้อนออกจาก audit log (เขียน items ว่าง)').toEqual([]);
  const j = Object.values(res.files.journals)[0];
  expect(j.undoneCount).toBe(6);
  expect(typeof j.undoneAt).toBe('string');
  expect(u.log).toContain('ย้อนผล Confirm SSS แล้ว 6 รายการ');
});

test('undo ซ้ำ — รอบสองไม่มีอะไรให้ย้อน (updatedBy ไม่ใช่บอทแล้ว) ไม่เขียนอะไร exit 0 · แล้ว Confirm ใหม่ได้ตามปกติ', async () => {
  const w = baseWorld();
  const res = run({ ...w, runs: [{ args: REAL }, { args: UNDO }, { args: UNDO }, { args: REAL }] });
  expect(res.runs.map((r) => r.code)).toEqual([0, 0, 0, 0]);
  const second = res.runs[2];
  expect(second.log).toContain('ไม่มีรายการที่ต้องย้อน');
  expect(second.log).toContain('เคยถูกย้อนเมื่อ');
  expect(confirmWrites(second).filter((x) => x.path.includes('/items/'))).toEqual([]);
  const again = res.runs[3];
  expect(itemOf(again, 'SSS', 'S-21').status, 'Confirm ใหม่หลังย้อน').toBe('pass');
  expect(itemOf(again, 'SSS', 'S-21').rev, 'rev: 3 → 4 (Confirm) → 5 (undo) → 6 (Confirm ใหม่)').toBe(6);
});

test('undo --dry-run — แสดงสิ่งที่จะย้อนอย่างเดียว ไม่เขียนอะไร ไม่ถือ lock', async () => {
  const w = baseWorld();
  const res = run({ ...w, runs: [{ args: REAL }, { args: [...UNDO, '--dry-run'] }] });
  const d = res.runs[1];
  expect(d.code, d.log).toBe(0);
  expect(d.writes, 'dry-run ห้ามเขียนอะไร').toEqual([]);
  expect(d.requests.some((x) => x.includes('POST commit'))).toBe(false);
  expect(d.log).toContain('ย้อนได้ 6');
  expect(d.log).toContain('[DRY]');
  expect(d.sleeps).toEqual([]);
  expect(itemOf(d, 'SSS', 'S-22').directAdj, 'ผล Confirm ยังอยู่').toBe(true);
});

test('undo — รายการที่มีคนเปลี่ยนต่อหลังบอท (↺ รีเช็ค / rev ขยับ / ค่าเปลี่ยน) ห้ามถูกย้อนทับ · ที่เหลือย้อนปกติ · รายงานชัด', async () => {
  const w = baseWorld();
  const res = run({ ...w, runs: [
    { args: REAL },
    { args: UNDO, ops: [
      { op: 'touch', path: itemPath('S-22'), set: { status: 'audit', updatedBy: 'เภสัช' } },               // ↺ รีเช็ค: updatedBy เปลี่ยน
      { op: 'touch', path: itemPath('S-23'), set: { rev: 9 } },                                           // rev ขยับ (เครื่องอื่นเขียน) แต่ updatedBy ยังเป็นบอท
      { op: 'touch', path: itemPath('S-24'), set: { status: 'stock_adjustment', effectiveQty: 99 } },     // ค่า after เปลี่ยน
    ] },
  ] });
  const u = res.runs[1];
  expect(u.code, u.log).toBe(0);
  expect(u.log).toContain('ย้อนได้ 3');
  expect(itemOf(u, 'SSS', 'S-22')).toMatchObject({ status: 'audit', updatedBy: 'เภสัช', directAdj: true });
  expect(itemOf(u, 'SSS', 'S-23')).toMatchObject({ status: 'pass', rev: 9 });
  expect(itemOf(u, 'SSS', 'S-24').effectiveQty).toBe(99);
  for (const sku of ['S-21', 'S-25', 'S-26']) expect(itemOf(u, 'SSS', sku).status, `${sku}: ย้อนแล้ว`).toBe('scanning');
  expect(u.log).toContain('เปลี่ยนต่อหลังบอท');
  expect(u.log).toContain('S-22');
});

test('undo — รอบนับเปลี่ยนแล้ว (เริ่มนับใหม่) / lock มีคนถือ: ปฏิเสธ exit 4 ไม่เขียนอะไร', async () => {
  const w = baseWorld();
  const newEpoch = run({ ...w, runs: [{ args: REAL }, { args: UNDO, ops: [{ op: 'touch', path: 'stock_sessions/SSS', set: { session_data_json: JSON.stringify({ countResetAt: '2026-10-22T01:00:00.000Z' }) } }] }] });
  expect(newEpoch.runs[1].code, newEpoch.runs[1].log).toBe(4);
  expect(newEpoch.runs[1].log).toContain('รอบนับปัจจุบันไม่ตรงกับ journal');
  expect(confirmWrites(newEpoch.runs[1])).toEqual([]);

  const locked = run({ ...w, runs: [{ args: REAL }, { args: UNDO, ops: [{ op: 'put', path: 'stock_sessions/SSS_confirm_lock',
    plain: { token: 'd', branch: 'SSS', owner: 'เภสัช', role: 'pharmacist', countResetAt: H.EPOCH, expiresAt: { __ts: '2026-10-21T14:12:00.000000Z' } } }] }] });
  expect(locked.runs[1].code, locked.runs[1].log).toBe(4);
  expect(confirmWrites(locked.runs[1]).filter((x) => x.path.includes('/items/'))).toEqual([]);
  expect(itemOf(locked.runs[1], 'SSS', 'S-22').directAdj, 'ผล Confirm ยังอยู่').toBe(true);
});

test('undo — ไฟล์ journal ผิด (ไม่มีไฟล์ / ไม่ใช่ JSON / ไม่ใช่รูปแบบของบอท): exit 2 ไม่แตะ Firestore', async () => {
  const w = baseWorld();
  for (const arg of ['/nonexistent/journal.json']) {
    const res = run({ ...w, runs: [{ args: ['--confirm-undo', arg] }] });
    expect(res.runs[0].code, res.runs[0].log).toBe(2);
    expect(res.runs[0].requests, 'ไม่แตะ Firestore').toEqual([]);
  }
  // journal ที่ไม่ใช่รูปแบบของบอท: เขียนไฟล์ชั่วคราวผ่าน Python harness
  const out = runPython(`
import os, json, tempfile, io, contextlib
d = tempfile.mkdtemp()
cases = {'notjson.json': 'hello', 'wrongversion.json': json.dumps({'version': 2, 'branch': 'SSS', 'items': []}),
         'wrongbranch.json': json.dumps({'version': 1, 'branch': 'WH', 'items': []}), 'noitems.json': json.dumps({'version': 1, 'branch': 'SSS'})}
res = {}
for name, text in cases.items():
    path = os.path.join(d, name); open(path, 'w').write(text)
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        code = m.run_undo({'undo': path, 'dry_run': False})
    res[name] = [code, buf.getvalue()]
print(json.dumps(res, ensure_ascii=False))
`);
  for (const [name, [code, log]] of Object.entries(out)) {
    expect(code, `${name}\n${log}`).toBe(2);
    expect(log).toContain('อ่าน journal ไม่ได้');
  }
});

test('undo — commit ย้อนไม่สำเร็จ (เครือข่ายหลุด): exit 1 · lock ถูกปล่อย · รันซ้ำคำสั่งเดิมได้', async () => {
  const w = baseWorld();
  const res = run({ ...w, runs: [{ args: REAL }, { args: UNDO, ops: [{ op: 'script', script: [{ type: 'drop', match: '/items/', nth: 1, mode: '503' }] }] }, { args: UNDO }] });
  expect(res.runs[1].code, res.runs[1].log).toBe(1);
  expect(res.store['stock_sessions/SSS_confirm_lock']).toBeUndefined();
  expect(itemOf(res.runs[1], 'SSS', 'S-22').directAdj, 'ยังไม่ถูกย้อน').toBe(true);
  expect(res.runs[2].code, res.runs[2].log).toBe(0);
  expect(itemOf(res.runs[2], 'SSS', 'S-22').status).toBe('scanning');
});

// ── --confirm-compare ────────────────────────────────────────────────────
test('compare — เงาแล้วยังไม่มีใคร Confirm: รายงาน pending ทั้งหมด · exit 0 · ไม่เขียนอะไร', async () => {
  const w = baseWorld();
  const res = run({ ...w, runs: [{ args: ['--confirm-shadow'] }, { args: ['--confirm-compare'] }] });
  const c = res.runs[1];
  expect(c.code, c.log).toBe(0);
  expect(c.writes, 'compare อ่านอย่างเดียว').toEqual([]);
  expect(c.log).toContain('ทำนาย 6 รายการ → Pass 3 · Stock Adj 3');
  expect(c.log).toContain('ยังเป็น scanning (ยังไม่มีใคร Confirm) 6');
  expect(c.log).toContain('ตรงกัน 0 · ต่างกัน 0');
  expect(c.log).toContain('ยังไม่มีรายการที่ถูก Confirm จริงให้เทียบ');
});

test('compare — Desktop Confirm จริงตามหลัง: นับ ตรง/ต่าง/ยังรอ/หายไป ถูกต้อง และบอกรายละเอียดรายการที่ต่าง', async () => {
  const w = baseWorld();
  const res = run({ ...w, runs: [{ args: ['--confirm-shadow'] }, { args: ['--confirm-compare'], ops: [
    { op: 'touch', path: itemPath('S-21'), set: { status: 'pass' } },                                                                    // ตรง
    { op: 'touch', path: itemPath('S-22'), set: { status: 'stock_adjustment', directAdj: true, effectiveQty: 3, systemQty: 5 } },       // ตรง (direct)
    { op: 'touch', path: itemPath('S-23'), set: { status: 'stock_adjustment', directAdj: true, effectiveQty: 3, systemQty: 5 } },       // ต่าง: เงาทำนาย pass
    { op: 'touch', path: itemPath('S-24'), set: { status: 'stock_adjustment', directAdj: true, effectiveQty: 99, systemQty: 5 } },      // ต่าง: ตัวเลขแช่ไม่ตรง
    { op: 'touch', path: itemPath('S-25'), set: { status: 'stock_adjustment' } },                                                        // ตรง (noStock ไม่ direct)
    { op: 'delete', path: itemPath('S-26') },                                                                                           // หายไป (ถูกรีเซ็ต)
  ] }] });
  const c = res.runs[1];
  expect(c.code, c.log).toBe(0);
  expect(c.log).toContain('ตรงกัน 3 · ต่างกัน 2');
  expect(c.log).toContain('ไม่พบรายการ (ถูกรีเซ็ต/ลบ) 1');
  expect(c.log).toMatch(/S-23: เงาทำนาย pass .* → จริง stock_adjustment effectiveQty 3 ระบบ 5/);
  expect(c.log).toMatch(/S-24: เงาทำนาย stock_adjustment\(ตรง\) .* → จริง stock_adjustment effectiveQty 99 ระบบ 5/);
  expect(c.writes).toEqual([]);
});

test('compare — เลือกวันด้วย --confirm-date · ไม่มี shadow log = exit 2 · อ่าน Cloud ไม่ได้ = exit 1', async () => {
  const w = baseWorld();
  const none = run({ ...w, runs: [{ args: ['--confirm-compare'] }] });
  expect(none.runs[0].code, none.runs[0].log).toBe(2);
  expect(none.runs[0].log).toContain('ไม่พบบันทึกโหมดเงา');

  const res = run({ ...w, runs: [{ args: ['--confirm-shadow'] }, { args: ['--confirm-compare', '--confirm-date', '2026-10-21'] },
    { args: ['--confirm-compare', '--confirm-date', '2026-10-01'] },
    { args: ['--confirm-compare'], ops: [{ op: 'script', script: [{ type: 'http', match: 'runQuery', nth: 1, code: 503 }] }] }] });
  expect(res.runs[1].code, res.runs[1].log).toBe(0);
  expect(res.runs[1].log).toContain('ทำนาย 6 รายการ');
  expect(res.runs[2].code, res.runs[2].log).toBe(0);
  expect(res.runs[2].log).toContain('── SSS ── ไม่มีบันทึกโหมดเงา ของวันที่ 2026-10-01');   // ชี้ SSS เอง: SRC/KKL ไม่มีบันทึกเลย ข้อความทั่วไปจึงผ่านเปล่าๆ
  expect(res.runs[2].log, 'ต้องไม่หยิบบันทึกของวันอื่นมาเทียบ').not.toContain('ทำนาย');
  expect(res.runs[3].code, res.runs[3].log).toBe(1);
  expect(res.runs[3].log).toContain('อ่านรายการจริงจาก Cloud ไม่ได้');
});

test('compare — วันเดียวกันรันเงาหลายรอบ ใช้บันทึกรอบท้ายสุด', async () => {
  const w = baseWorld();
  const res = run({ ...w, runs: [{ args: ['--confirm-shadow'] }, { args: ['--confirm-shadow'], ops: [{ op: 'delete', path: itemPath('S-26') }, { op: 'now', at: '2026-10-21T21:30:00+07:00' }] },
    { args: ['--confirm-compare'] }] });
  expect(res.files.shadow).toHaveLength(2);
  expect(res.runs[2].log).toContain('ทำนาย 5 รายการ');
  expect(res.runs[2].log).toContain('21:30');
});

test('compare — บันทึกที่ถูกหมุนไป .1 ยังเทียบได้ (อ่านเก่า→ใหม่: ไฟล์หลักชนะ .1) · ไฟล์หลักว่างก็ยังเห็นของใน .1', async () => {
  const w = baseWorld();
  const res = run({ ...w, runs: [
    { args: ['--confirm-shadow'] },                                                                                                           // 21:10 → ไฟล์หลัก
    { ops: [{ op: 'const', name: 'SHADOW_LOG_MAX_BYTES', value: 300 }, { op: 'now', at: '2026-10-21T21:30:00+07:00' }], args: ['--confirm-shadow'] },   // หมุน: .1=21:10 · หลัก=21:30
    { args: ['--confirm-compare'] },
    { ops: [{ op: 'statefile', rel: 'auto_r16_confirm_shadow.jsonl', content: '' }], args: ['--confirm-compare'] },                          // ไฟล์หลักว่าง → เหลือแต่ .1
  ] });
  expect(res.runs[1].code, res.runs[1].log).toBe(0);
  expect(res.runs[2].code, res.runs[2].log).toBe(0);
  expect(res.runs[2].log, 'วันเดียวกัน: ใช้บันทึกใหม่สุด = ไฟล์หลัก (21:30)').toContain('(21:30)');
  expect(res.runs[3].code, res.runs[3].log).toBe(0);
  expect(res.runs[3].log, 'ไฟล์หลักว่าง: ยังเทียบกับบันทึกใน .1 ได้ (21:10)').toContain('(21:10)');
  expect(res.runs[3].log).toContain('ทำนาย 6 รายการ');
  expect(res.runs[3].writes).toEqual([]);
});

test('undo — query ตาม updatedBy ใช้ไม่ได้ (HTTP 400) → อ่านทีละรายการ แต่ยังไม่ย้อนรายการที่ updatedBy เปลี่ยนไปแล้ว', async () => {
  const w = baseWorld();
  const res = run({ ...w, runs: [{ args: REAL }, { args: UNDO, ops: [
    { op: 'script', script: [{ type: 'http', match: 'runQuery', nth: 1, code: 400, status: 'FAILED_PRECONDITION' }] },
    { op: 'touch', path: itemPath('S-22'), set: { updatedBy: 'พนักงานคนอื่น' } },   // มีคนเข้ามาแตะต่อหลังบอท (rev/ค่าเท่าเดิม — ต่างแค่ผู้แก้)
  ] }] });
  const u = res.runs[1];
  expect(u.code, u.log).toBe(0);
  expect(u.log).toContain('อ่านทีละรายการ');
  expect(itemOf(u, 'SSS', 'S-22').status, 'ไม่ย้อนทับของที่ผู้อื่นแตะต่อ').toBe('stock_adjustment');
  expect(itemOf(u, 'SSS', 'S-22').updatedBy).toBe('พนักงานคนอื่น');
  for (const sku of ['S-21', 'S-23', 'S-24', 'S-25', 'S-26']) expect(itemOf(u, 'SSS', sku).status, sku).toBe('scanning');
  expect(u.log).toContain('ย้อนผล Confirm SSS แล้ว 5 รายการ');
});

test('confirm_time_problems — ผ่านเฉพาะ now ≥ 21:00 และไฟล์ export ≥ 21:00 (ขอบ 21:00:00 ผ่าน · 20:59:59 ไม่ผ่าน) · พ้นเที่ยงคืนไม่ผ่าน', async () => {
  const cases = [
    ['2026-10-21T21:10:00+07:00', '2026-10-21T21:05:00+07:00'],   // ปกติ
    ['2026-10-21T21:00:00+07:00', '2026-10-21T21:00:00+07:00'],   // ขอบพอดี
    ['2026-10-21T20:59:59+07:00', '2026-10-21T21:05:00+07:00'],   // ยังไม่ถึงเวลา (ไฟล์ "มาจากอนาคต" — ทดสอบด่านนี้แยกจากด่านไฟล์)
    ['2026-10-21T21:10:00+07:00', '2026-10-21T20:59:59+07:00'],   // ไฟล์ export ก่อน 21:00
    ['2026-10-21T20:00:00+07:00', '2026-10-21T19:00:00+07:00'],   // ทั้งคู่ไม่ผ่าน
    ['2026-10-22T00:30:00+07:00', '2026-10-21T21:30:00+07:00'],   // พ้นเที่ยงคืน = วันใหม่ (21:00 ของวันใหม่ยังไม่ถึง)
  ];
  const out = runPython(`
from datetime import datetime
print(json.dumps([m.confirm_time_problems(datetime.fromisoformat(n), datetime.fromisoformat(t)) for n, t in p['cases']], ensure_ascii=False))
`, { cases });
  expect(out.map((x) => x.length)).toEqual([0, 0, 1, 1, 2, 2]);
  expect(out[2][0]).toContain('ยังไม่ถึง 21:00');
  expect(out[3][0]).toContain('export ก่อน 21:00');
  expect(out[5].some((x) => x.includes('ยังไม่ถึง 21:00')), 'พ้นเที่ยงคืน: ด่านเวลา').toBe(true);
});

// ── ตรวจ flag ────────────────────────────────────────────────────────────
function parseCases(cases) {
  return runPython(`
import io, contextlib
def parse(argv):
    buf = io.StringIO()
    try:
        with contextlib.redirect_stdout(buf):
            o = m.parse_args(argv)
        return {'ok': o}
    except SystemExit as e:
        return {'exit': e.code, 'log': buf.getvalue()}
print(json.dumps([parse(a) for a in p['cases']], ensure_ascii=False))
`, { cases });
}

test('flag — ที่ถูกต้องผ่าน และ normalize ตัวพิมพ์ใหญ่ · flag เดิมทุกตัวยังใช้ได้เหมือนเดิม · ค่าเริ่มต้นไม่เปิดอะไรของ Confirm', async () => {
  const [def, shadow, real, mixed, ratio, undo, cmp, cmpDate, legacy1, legacy2, legacy3] = parseCases([
    [], ['--confirm-shadow'], ['--confirm', '--confirm-branch', 'SSS'], ['--confirm', '--confirm-branch=sss,kkl', '--confirm-shadow'],
    ['--confirm-shadow', '--confirm-max-adj-ratio', '0.3'], ['--confirm-undo', 'j.json'], ['--confirm-compare'], ['--confirm-compare', '--confirm-date=2026-10-21'],
    ['--dry-run', '--force', '--folder', 'D:/x', '--branch', 'SRC,KKL'], ['-n', '--folder=D:/y', '--branch=sss'], ['--branch', 'SRC'],
  ]).map((x) => x.ok);
  expect(def).toMatchObject({ dry_run: false, force: false, confirm: false, confirm_shadow: false, confirm_branches: [], max_adj_ratio: null, undo: null, compare: false });
  expect(def.branches).toEqual(['SRC', 'KKL', 'SSS']);
  expect(shadow).toMatchObject({ confirm: false, confirm_shadow: true });
  expect(real).toMatchObject({ confirm: true, confirm_branches: ['SSS'] });
  expect(mixed).toMatchObject({ confirm: true, confirm_shadow: true, confirm_branches: ['SSS', 'KKL'] });
  expect(ratio.max_adj_ratio).toBe(0.3);
  expect(undo.undo).toBe('j.json');
  expect(cmp.compare).toBe(true);
  expect(cmpDate).toMatchObject({ compare: true, confirm_date: '2026-10-21' });
  expect(legacy1).toMatchObject({ dry_run: true, force: true, folder: 'D:/x', branches: ['SRC', 'KKL'] });
  expect(legacy2).toMatchObject({ dry_run: true, folder: 'D:/y', branches: ['SSS'] });
  expect(legacy3.branches).toEqual(['SRC']);
});

test('flag — ตั้งผิด/ไม่ครบ/ขัดกัน ต้องถูกปฏิเสธ exit 2 (ห้ามเงียบแล้วไม่ทำงาน)', async () => {
  const bad = [
    ['--confirm'],                                                                   // ไม่ระบุสาขา: ไม่มีค่าเริ่มต้น "ทุกสาขา" โดยตั้งใจ
    ['--confirm-branch', 'SSS'],                                                     // ตั้งสาขาไว้เฉยๆ ไม่มี --confirm
    ['--confirm', '--confirm-branch', 'XXX'],
    ['--confirm', '--confirm-branch', 'WH'],
    ['--confirm', '--confirm-branch', 'SSS', '--branch', 'KKL'],                     // สาขา Confirm ไม่อยู่ใน --branch
    ['--confirm', '--confirm-branch', ''],
    ['--confirm-max-adj-ratio', '0.5'],                                              // ไม่มี --confirm/--confirm-shadow
    ['--confirm-shadow', '--confirm-max-adj-ratio', '0'],
    ['--confirm-shadow', '--confirm-max-adj-ratio', '-0.1'],
    ['--confirm-shadow', '--confirm-max-adj-ratio', '1.5'],
    ['--confirm-shadow', '--confirm-max-adj-ratio', 'abc'],
    ['--confirm-shadow', '--confirm-max-adj-ratio'],
    ['--confirm-undo'],
    ['--confirm-undo', 'j.json', '--confirm'],
    ['--confirm-undo', 'j.json', '--confirm-shadow'],
    ['--confirm-undo', 'j.json', '--confirm-compare'],
    ['--confirm-compare', '--confirm', '--confirm-branch', 'SSS'],
    ['--confirm-date', '2026-10-21'],                                                // ต้องคู่กับ --confirm-compare
    ['--confirm-compare', '--confirm-date', '21/10/2026'],
    ['--confirm-compare', '--confirm-date', '2026-1-1'],
    ['--confirm-all'],                                                               // flag แปลกปลอม (กันตัวเก่า/พิมพ์ผิด)
    ['--confirmx'],
    ['--confirm=1'],
    ['--confirm-shadow=1'],
    ['--folder'], ['--branch'], ['--confirm-branch'],
  ];
  const outs = parseCases(bad);
  outs.forEach((o, i) => {
    expect(o.exit, `${JSON.stringify(bad[i])} ต้อง exit 2 (ได้ ${JSON.stringify(o)})`).toBe(2);
  });
  const help = parseCases([['-h']])[0];
  expect(help.exit, '-h ออกด้วย 0').toBe(0);
  expect(help.log).toContain('--confirm-shadow');
});

// ── exit code ของขั้น Confirm (ฟังก์ชันบริสุทธิ์) ─────────────────────────
test('_confirm_exit_code — นับเฉพาะสาขาที่สั่งเขียนจริง · ตกด่านโดยไม่เขียน = 4 · ล้ม/เขียนบางส่วน = 1 · โหมดเงาไม่ทำให้แดง', async () => {
  const cases = {
    ok: { SSS: { real: true, state: 'confirmed', written: 6 } },
    nothing: { SSS: { real: true, state: 'nothing' } },
    dry: { SSS: { real: true, state: 'dry' } },
    skipped: { SSS: { real: true, state: 'skipped' } },
    locked: { SSS: { real: true, state: 'locked' } },
    tripwire: { SSS: { real: true, state: 'tripwire' } },
    abortedClean: { SSS: { real: true, state: 'aborted', written: 0 } },
    abortedPartial: { SSS: { real: true, state: 'aborted', written: 450 } },
    failed: { SSS: { real: true, state: 'failed' } },
    failedPartial: { SSS: { real: true, state: 'failed', written: 3 } },
    shadowFailed: { KKL: { real: false, state: 'failed' } },
    shadowSkipped: { KKL: { real: false, state: 'skipped' } },
    mixed41: { SSS: { real: true, state: 'tripwire' }, KKL: { real: true, state: 'failed' } },
    mixedOkShadowFail: { SSS: { real: true, state: 'confirmed', written: 2 }, KKL: { real: false, state: 'failed' } },
    empty: {},
  };
  const out = runPython(`print(json.dumps({k: m._confirm_exit_code(v) for k, v in p['cases'].items()}))`, { cases });
  expect(out).toEqual({ ok: 0, nothing: 0, dry: 0, skipped: 4, locked: 4, tripwire: 4, abortedClean: 4, abortedPartial: 1, failed: 1, failedPartial: 1,
    shadowFailed: 0, shadowSkipped: 0, mixed41: 1, mixedOkShadowFail: 0, empty: 0 });
});

test('คำสั่งที่ไม่ใช่ Confirm — เปิดใช้ undo/compare ไม่ต้องมีไฟล์ CSV (ใช้ได้แม้โฟลเดอร์ export ว่างเปล่า)', async () => {
  const w = baseWorld();
  const res = run({ ...w, runs: [{ args: ['--confirm-shadow'] }, { args: ['--confirm-compare'], ops: [{ op: 'unlink_csv' }] }] });
  expect(res.runs[1].code, res.runs[1].log).toBe(0);
  expect(res.runs[1].log).toContain('ทำนาย 6 รายการ');
});

test('ทุกการเขียนของขั้น Confirm อยู่ใน 3 ที่เท่านั้น: items ของสาขาที่สั่ง · {branch}_confirm_lock · stock_audit_log (ไม่แตะ master/R01/R05/PBM/session)', async () => {
  const w = baseWorld();
  const res = run({ ...w, runs: [{ args: REAL }] });
  const nonPublish = res.runs[0].writes.filter((x) => x.commit); // writes ทั้งหมดจาก commit (REST :commit) — การเผยแพร่ timeline ใช้ PATCH ซึ่งไม่ผ่านรายการนี้
  for (const x of nonPublish) {
    expect(x.path, `write ที่ไม่คาดคิด: ${JSON.stringify(x)}`).toMatch(/^(stock_sessions\/SSS\/items\/S-\d+|stock_sessions\/SSS_confirm_lock|stock_audit_log\/SSS_2026-10-21)$/);
  }
  for (const rel of ['stock_sessions/SSS', 'stock_sessions/SSS_pm', 'stock_sessions/global_r05']) {
    expect(untouched(res, rel), `${rel} ต้องไม่ถูกแตะ`).toBe(true);
  }
});
