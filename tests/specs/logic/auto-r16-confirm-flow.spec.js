// flow: ขั้น Confirm โดยบอท auto-r16 (main() จริง) กับ Firestore REST จำลอง — ด่าน · lock · atomic · โหมดเงา · tripwire · journal/undo · compare · exit code
//
// ทำไมต้องมี: บอทกด Confirm แทน Desktop ตอนกลางคืนโดยไม่มีคนเฝ้า เขียนผลลง items ของพนักงานจริง
// เทสนี้คุมจังหวะ/ความล้มเหลวที่ emulator ทำซ้ำให้แน่นอนไม่ได้ (เครือข่ายหลุดหลัง commit · เอกสารเปลี่ยนระหว่างคำนวณ · lock ชน)
// ตรรกะตัดสิน Pass/Stock Adj เทียบกับหน้าเว็บจริงที่ auto-r16-confirm-parity.spec.js · REST/rules จริงที่ e2e/auto-r16-confirm.spec.js
// ⚠️ ฝั่งบอทเป็นโค้ดจริง (main → process_branch → confirm_branch) · ที่จำลองมีแค่ m._request (Firestore) นาฬิกา และ time.sleep — ต้องมี Python 3
const { test, expect } = require('@playwright/test');
const H = require('../../lib/r16-confirm-harness');
const { runPython } = require('../../lib/python');
const { item, world, run, itemOf, docOf, untouched, confirmWrites } = H;

// ── สถานการณ์มาตรฐาน: SSS มี 6 รายการที่ Confirm ได้ + ตัวหลอกที่ต้องไม่ถูกแตะ ──────────────────────
const GOOD = [
  item('S-21', 5, '10:00:00'),                      // นับ 5 = ระบบ 5 → Pass
  item('S-22', 3, '11:00:00'),                      // นับ 3 ≠ 5 → Stock Adj ตรง (eff 3 / sys 5)
  item('S-23', 3, '11:00:00'),                      // นับ 3 + ขายก่อนสแกน 2 = 5 → Pass
  item('S-24', 4, '11:00:00'),                      // ขาย 12:00 เกิดหลังสแกน → ไม่นับ → 4 ≠ 5 → Stock Adj ตรง
  item('S-25', 0, '11:30:00', { noStock: true }),   // noStock + นับ 0 + ระบบ 5 → Stock Adj (ไม่ใช่ directAdj)
  item('S-26', 7, '10:00:00'),                      // นับ 7 − รับเข้าก่อนสแกน 2 = 5 → Pass
];
const DECOYS = [
  item('S-27', 5, '09:00:00', { status: 'pass', auditStatus: 'approved', initialStatus: 'pass' }),   // Confirm ไปแล้ว
  item('S-28', 0, '', { status: 'pending', timestamp: '', firstScanAt: '' }),                        // ยังไม่ได้สแกน
  item('S-29', 3, '10:00:00', { countResetAt: '2026-09-01T03:00:00.000Z' }),                        // เศษรอบเก่า (query ตามรอบไม่เห็น)
  item('S-30', 3, '10:00:00', { timestamp: '2026-10-20 10:00:00', firstScanAt: '2026-10-20 10:00:00' }),   // ค้างข้ามวัน
  item('S-31', 3, '21:06:00'),                                                                       // สแกนหลังเวลา export ของไฟล์ (21:05)
  item('S-32', 3, '10:00:00', { countedQty: null }),                                                 // ไม่มียอดนับ
  item('S-33', 3, '10:00:00', { timestamp: 'garbage' }),                                             // เวลาอ่านไม่ได้
  item('S-34', 3, '10:00:00', { timestamp: '' }),                                                    // ไม่มีเวลา
  item('NOPE-1', 3, '10:00:00'),                                                                     // ไม่อยู่ใน skuMap
];
const SALES = [['B-23', 2, '10:30:00'], ['B-24', 2, '12:00:00'], ['B-26', 2, '09:00:00', 'inbound']];

const baseWorld = (over = {}) => world({ branches: ['SSS'], items: { SSS: [...GOOD, ...DECOYS] }, sales: { SSS: SALES }, ...over });
const REAL = ['--confirm', '--confirm-branch', 'SSS'];
const CONFIRMED_SKUS = ['S-21', 'S-22', 'S-23', 'S-24', 'S-25', 'S-26'];
const UNTOUCHED = DECOYS.map((d) => d.sku);

// ผลที่คาดของ 6 รายการ (field ที่ Confirm แตะเท่านั้น — field อื่นต้องคงเดิมทุกตัว)
const EXPECT = {
  'S-21': { status: 'pass', auditStatus: 'approved', initialStatus: 'pass' },
  'S-22': { status: 'stock_adjustment', auditStatus: 'stock_adjustment', initialStatus: 'stock_adjustment', directAdj: true, effectiveQty: 3, systemQty: 5 },
  'S-23': { status: 'pass', auditStatus: 'approved', initialStatus: 'pass', soldQty: 2, rawCountedQty: 3 },
  'S-24': { status: 'stock_adjustment', auditStatus: 'stock_adjustment', initialStatus: 'stock_adjustment', directAdj: true, effectiveQty: 4, systemQty: 5 },
  'S-25': { status: 'stock_adjustment', auditStatus: 'stock_adjustment', initialStatus: 'stock_adjustment' },
  'S-26': { status: 'pass', auditStatus: 'approved', initialStatus: 'pass', inboundQty: 2 },
};

function expectConfirmedItems(res) {
  for (const it of GOOD) {
    const after = itemOf(res, 'SSS', it.sku);
    const { updatedAt: _u, ...beforeRest } = it;
    const { updatedAt: _a, ...afterRest } = after;
    expect(afterRest, `${it.sku}: ทุกฟิลด์ = ก่อน + ผล Confirm + rev+1 + updatedBy`).toEqual({ ...beforeRest, ...EXPECT[it.sku], rev: it.rev + 1, updatedBy: 'auto-r16' });
    expect(after.updatedAt, `${it.sku}: updatedAt ต้องถูกตั้งโดยเซิร์ฟเวอร์ใหม่`).not.toBe(it.updatedAt.__ts);
  }
}

const SSS = (b = 'SSS') => `stock_sessions/${b}`;

// ── ไม่มี flag --confirm* = พฤติกรรมเดิม ────────────────────────────────────
test('ไม่มี flag --confirm* — ไม่ query items · ไม่แตะ lock/items/audit log · items ไม่เปลี่ยนทั้งก้อน (พฤติกรรมเดิมของบอท)', async () => {
  const w = baseWorld();
  const res = run({ ...w, runs: [{ args: [] }] });
  const r = res.runs[0];
  expect(r.code, r.log).toBe(0);
  expect(confirmWrites(r), 'ไม่มี write ของขั้น Confirm').toEqual([]);
  expect(r.requests.some((x) => x.includes('runQuery')), 'ไม่ query items').toBe(false);
  expect(r.sleeps, 'ไม่รอ settle').toEqual([]);
  for (const it of [...GOOD, ...DECOYS]) expect(itemOf(res, 'SSS', it.sku).status, it.sku).toBe(it.status);
  expect(res.files.shadow, 'ไม่มี shadow log').toBeUndefined();
  expect(res.files.journals).toEqual({});
  expect(r.log).not.toContain('Confirm [');
  expect(docOf(res, 'stock_sessions/SSS_r01').r16Loaded, 'ยังเผยแพร่ timeline ตามเดิม').toBe(true);
});

// ── โหมดเงา ──────────────────────────────────────────────────────────────
test('โหมดเงา --confirm-shadow — คำนวณครบ จดลง shadow log แต่ไม่เขียน items/lock/audit log แม้แต่ครั้งเดียว', async () => {
  const w = baseWorld();
  const res = run({ ...w, runs: [{ args: ['--confirm-shadow'] }] });
  const r = res.runs[0];
  expect(r.code, r.log).toBe(0);
  expect(confirmWrites(r), 'โหมดเงาห้ามเขียนอะไรของขั้น Confirm').toEqual([]);
  expect(r.requests.some((x) => x.includes('POST commit')), 'ไม่มี commit เลย').toBe(false);
  expect(r.sleeps, 'โหมดเงาไม่ถือ lock จึงไม่รอ settle').toEqual([]);
  for (const it of [...GOOD, ...DECOYS]) expect(untouched(res, `stock_sessions/SSS/items/${it.sku}`), `${it.sku}: ไม่ถูกเขียนเลย (updateTime เท่าเดิม)`).toBe(true);
  expect(res.store['stock_sessions/SSS_confirm_lock'], 'ไม่มี lock').toBeUndefined();
  expect(res.store['stock_audit_log/SSS_2026-10-21'], 'ไม่เขียน audit log').toBeUndefined();

  expect(res.files.shadow).toHaveLength(1);
  const rec = res.files.shadow[0];
  expect(rec).toMatchObject({ branch: 'SSS', mode: 'shadow', early: false, date: '2026-10-21', evaluated: 6, candidates: 12 });
  expect(rec.summary).toMatchObject({ pass: 3, adj: 3, tripwire: false });
  expect(rec.skipped).toEqual({ stale: 1, after_export: 1, no_count: 1, bad_timestamp: 1, no_timestamp: 1, not_in_skumap: 1 });
  const bySku = Object.fromEntries(rec.results.map((x) => [x.sku, x]));
  expect(Object.keys(bySku).sort()).toEqual(CONFIRMED_SKUS);
  expect(bySku['S-21']).toMatchObject({ cnt: 5, sold: 0, inbound: 0, eff: 5, sys: 5, status: 'pass', direct: false });
  expect(bySku['S-22']).toMatchObject({ status: 'stock_adjustment', direct: true, eff: 3, sys: 5 });
  expect(bySku['S-23']).toMatchObject({ cnt: 3, sold: 2, eff: 5, status: 'pass' });
  expect(bySku['S-24']).toMatchObject({ cnt: 4, sold: 0, eff: 4, status: 'stock_adjustment', direct: true });
  expect(bySku['S-25']).toMatchObject({ status: 'stock_adjustment', direct: false, eff: 0 });
  expect(bySku['S-26']).toMatchObject({ cnt: 7, inbound: 2, eff: 5, status: 'pass' });
  expect(r.log).toContain('[เงา]');
});

test('โหมดเงา — รันก่อน 21:00 หรือไฟล์ export ก่อน 21:00 ก็ยังคำนวณ แต่ติดธง early (ไว้ดูตัวเลขตั้งแต่หัวค่ำ)', async () => {
  const w = baseWorld();
  const res = run({ ...w, now: '2026-10-21T20:30:00+07:00', mtime: '2026-10-21T20:25:00+07:00', runs: [{ args: ['--confirm-shadow'] }] });
  expect(res.runs[0].code, res.runs[0].log).toBe(0);
  expect(res.files.shadow[0]).toMatchObject({ early: true, evaluated: 6 });
  expect(confirmWrites(res.runs[0])).toEqual([]);
});

test('โหมดเงาทุกสาขาที่ผ่านด่าน — SRC/KKL/SSS ได้บันทึกสาขาละ 1 รายการ · สาขาที่ R01 ไม่ใช่ของวันนี้ถูกข้าม (ไม่มีบันทึก) และ exit 4 ตามเดิม', async () => {
  const w = world({ branches: ['SRC', 'KKL', 'SSS'], items: { SRC: [item('S-21', 5, '10:00:00')], KKL: [item('S-21', 4, '10:00:00')], SSS: [item('S-21', 5, '10:00:00')] } });
  const res = run({ ...w, runs: [{ args: ['--confirm-shadow'] }] });
  expect(res.runs[0].code, res.runs[0].log).toBe(0);
  expect(res.files.shadow.map((x) => x.branch).sort()).toEqual(['KKL', 'SRC', 'SSS']);

  const w2 = world({ branches: ['SRC', 'KKL'], items: { SRC: [item('S-21', 5, '10:00:00')], KKL: [item('S-21', 4, '10:00:00')] } });
  w2.docs['stock_sessions/KKL_r01'].r01UploadedAt = '07:31 น. 20/10/2026';   // R01 เมื่อวาน
  const res2 = run({ ...w2, runs: [{ args: ['--confirm-shadow'] }] });
  expect(res2.runs[0].code, 'สาขาตกด่าน = exit 4 ตามเดิม').toBe(4);
  expect(res2.files.shadow.map((x) => x.branch)).toEqual(['SRC']);
  expect(res2.runs[0].log).toContain('Confirm KKL ── ข้าม');
});

// ── Confirm จริง: ทางปกติ ───────────────────────────────────────────────────
test('Confirm จริง — ผลถูกทุกฟิลด์ · rev+1 · updatedBy · ตัวหลอกไม่ถูกแตะ · lock ถือแล้วปล่อย · audit log · journal', async () => {
  const w = baseWorld();
  const res = run({ ...w, runs: [{ args: REAL }] });
  const r = res.runs[0];
  expect(r.code, r.log).toBe(0);
  expectConfirmedItems(res);

  for (const d of DECOYS) expect(itemOf(res, 'SSS', d.sku), `${d.sku}: ต้องไม่ถูกแตะ`).toEqual(expect.objectContaining({ status: d.status, rev: d.rev, updatedBy: d.updatedBy }));
  for (const d of DECOYS) {
    const { updatedAt: _a, ...after } = itemOf(res, 'SSS', d.sku);
    const { updatedAt: _b, ...before } = d;
    expect(after, `${d.sku}: ทุกฟิลด์เท่าเดิม`).toEqual(before);
    expect(untouched(res, `stock_sessions/SSS/items/${d.sku}`), `${d.sku}: ไม่ถูกเขียนเลย`).toBe(true);
  }

  // ลำดับ: lock → items (1 commit) → audit log → ปล่อย lock
  const cw = confirmWrites(r);
  const lockUp = cw.find((x) => x.path === 'stock_sessions/SSS_confirm_lock' && x.op === 'update');
  const lockDel = cw.find((x) => x.path === 'stock_sessions/SSS_confirm_lock' && x.op === 'delete');
  const itemsW = cw.filter((x) => x.path.includes('/items/'));
  const auditW = cw.find((x) => x.path === 'stock_audit_log/SSS_2026-10-21');
  expect(lockUp && lockDel && auditW, 'ถือ lock · เขียน audit log · ปล่อย lock').toBeTruthy();
  expect(itemsW.map((x) => x.path.split('/').pop()).sort()).toEqual(CONFIRMED_SKUS);
  expect(new Set(itemsW.map((x) => x.commit)).size, 'items ทั้งชุดอยู่ใน commit เดียว (atomic)').toBe(1);
  expect(lockUp.commit).toBeLessThan(itemsW[0].commit);
  expect(itemsW[0].commit).toBeLessThan(auditW.commit);
  expect(auditW.commit).toBeLessThan(lockDel.commit);
  expect(res.store['stock_sessions/SSS_confirm_lock'], 'lock ถูกปล่อย').toBeUndefined();
  expect(r.sleeps, 'รอ settle 3.8 วิหลังถือ lock').toEqual([3.8]);

  // audit log: เฉพาะรายการที่ไม่ตรงตั้งแต่นับรอบแรก (directAdj) · รูปแบบเดียวกับ saveAuditLogToFirestore
  const log = docOf(res, 'stock_audit_log/SSS_2026-10-21');
  expect(log).toMatchObject({ branch: 'SSS', date: '2026-10-21' });
  expect(log.updatedAt).toMatch(/^2026-10-21T14:10:00\.\d{3}Z$/);
  expect(log.items.map((x) => x.sku)).toEqual(['S-22', 'S-24']);
  expect(log.items[0]).toEqual({ sku: 'S-22', productName: 'PM S-22', barcode: 'B-22', countedQty: 3, scannedBy: 'พนักงานทดสอบ', timestamp: '2026-10-21 11:00:00',
    firstScanAt: '2026-10-21 11:00:00', status: 'stock_adjustment', auditor: '', recheckQty: null, backorder: false, directAdj: true, effectiveQty: 3, systemQty: 5 });

  // journal
  const names = Object.keys(res.files.journals);
  expect(names).toHaveLength(1);
  expect(names[0]).toMatch(/^2026-10-21_211000_SSS\.json$/);
  const j = res.files.journals[names[0]];
  expect(j).toMatchObject({ version: 1, branch: 'SSS', owner: 'auto-r16', epoch: H.EPOCH, state: 'committed', summary: { pass: 3, adj: 3 } });
  expect(j.items.map((x) => x.sku).sort()).toEqual(CONFIRMED_SKUS);
  const j22 = j.items.find((x) => x.sku === 'S-22');
  expect(j22).toMatchObject({ rev_before: 3, rev_after: 4, before: { status: 'scanning', auditStatus: 'pending' }, after: EXPECT['S-22'] });
  expect(j22.absent.sort()).toEqual(['directAdj', 'effectiveQty', 'initialStatus', 'systemQty']);
  expect(typeof j22.update_time_before).toBe('string');
  expect(typeof j22.update_time_after).toBe('string');
  expect(r.log).toContain('Confirm SSS สำเร็จ 6 รายการ — Pass 3, Stock Adj 3');
  expect(r.log).toContain('Confirm SSS confirmed(6)');
});

test('Confirm จริงซ้ำรอบสอง (Task รันซ้ำ/ตามชดเชย) — ไม่มีรายการ scanning แล้ว: ไม่เขียน items · ไม่แตะผลเดิม · exit 0', async () => {
  const w = baseWorld();
  const res = run({ ...w, runs: [{ args: REAL }, { args: REAL }] });
  expect(res.runs[0].code, res.runs[0].log).toBe(0);
  const second = res.runs[1];
  expect(second.code, second.log).toBe(0);
  expect(second.log).toContain('ไม่มีรายการให้ Confirm');
  expect(confirmWrites(second).filter((x) => x.path.includes('/items/')), 'รอบสองไม่เขียน items').toEqual([]);
  expectConfirmedItems(res);
  expect(Object.keys(res.files.journals), 'journal มีรอบแรกรอบเดียว').toHaveLength(1);
});

test('rev: item ที่ยังไม่มี rev เริ่มจาก 1 · ที่มี rev 7 เป็น 8 · ไม่ใช่ตัวเลข (ข้อมูลเพี้ยน) ถือเป็น 0 → 1', async () => {
  const items = [item('S-21', 5, '10:00:00', { rev: 7 }), item('S-22', 5, '10:00:00', { rev: 'x' }), item('S-23', 5, '10:00:00')];
  delete items[2].rev;
  const w = world({ branches: ['SSS'], items: { SSS: items } });
  const res = run({ ...w, runs: [{ args: REAL }] });
  expect(res.runs[0].code, res.runs[0].log).toBe(0);
  expect(itemOf(res, 'SSS', 'S-21').rev).toBe(8);
  expect(itemOf(res, 'SSS', 'S-22').rev).toBe(1);
  expect(itemOf(res, 'SSS', 'S-23').rev).toBe(1);
});

// ── ด่านเวลา ─────────────────────────────────────────────────────────────
test('ด่านเวลา — ก่อน 21:00 หรือไฟล์ export ก่อน 21:00: ไม่เขียนอะไร exit 4 · --force ข้ามได้', async () => {
  const w = baseWorld();
  for (const [label, now, mtime] of [['ยังไม่ถึง 21:00', '2026-10-21T20:59:00+07:00', '2026-10-21T20:50:00+07:00'],
    ['ไฟล์ export ก่อน 21:00', '2026-10-21T21:10:00+07:00', '2026-10-21T20:55:00+07:00']]) {
    const res = run({ ...w, now, mtime, runs: [{ args: REAL }] });
    const r = res.runs[0];
    expect(r.code, `${label}\n${r.log}`).toBe(4);
    expect(confirmWrites(r), `${label}: ไม่เขียนอะไร`).toEqual([]);
    expect(itemOf(res, 'SSS', 'S-21').status).toBe('scanning');
    expect(r.log).toContain('Confirm SSS skipped');
  }
  const forced = run({ ...w, now: '2026-10-21T20:59:00+07:00', mtime: '2026-10-21T20:50:00+07:00', runs: [{ args: [...REAL, '--force'] }] });
  expect(forced.runs[0].code, forced.runs[0].log).toBe(0);
  expect(itemOf(forced, 'SSS', 'S-21').status, '--force ข้ามด่านเวลา').toBe('pass');
});

// ── --dry-run ───────────────────────────────────────────────────────────
test('--dry-run --confirm — คำนวณและรายงานอย่างเดียว: ไม่ถือ lock · ไม่เขียนอะไรเลย (รวมไม่เผยแพร่ timeline) · ไม่จดโหมดเงา', async () => {
  const w = baseWorld();
  const res = run({ ...w, runs: [{ args: [...REAL, '--dry-run'] }] });
  const r = res.runs[0];
  expect(r.code, r.log).toBe(0);
  expect(r.writes, 'dry-run ห้ามเขียนอะไรทั้งสิ้น').toEqual([]);
  expect(r.requests.some((x) => x.startsWith('PATCH') || x.includes('POST commit')), 'ไม่มีคำขอเขียน').toBe(false);
  expect(r.log).toContain('Confirm [DRY');
  expect(r.log).toContain('ประเมินได้ 6 → Pass 3 · Stock Adj 3');
  expect(res.files.shadow, 'dry-run ไม่จดโหมดเงา').toBeUndefined();
  expect(itemOf(res, 'SSS', 'S-21').status).toBe('scanning');
});

// ── lock ────────────────────────────────────────────────────────────────
const LOCK = (exp, over = {}) => ({ token: 'desktop-token', branch: 'SSS', owner: 'พนักงานเภสัช', role: 'pharmacist', countResetAt: H.EPOCH,
  expiresAt: { __ts: exp }, startedAt: { __ts: '2026-10-21T14:00:00.000000Z' }, ...over });

test('lock — Desktop ถืออยู่ (ยังไม่หมดอายุ): บอทไม่เขียน items · ไม่แตะ lock ของเขา · exit 4', async () => {
  const w = baseWorld();
  w.docs['stock_sessions/SSS_confirm_lock'] = LOCK('2026-10-21T14:12:00.000000Z');   // บอทรันเวลา 14:10Z → ยังเหลือ 2 นาที
  const res = run({ ...w, runs: [{ args: REAL }] });
  const r = res.runs[0];
  expect(r.code, r.log).toBe(4);
  expect(confirmWrites(r)).toEqual([]);
  expect(docOf(res, 'stock_sessions/SSS_confirm_lock').token, 'lock ของ Desktop ต้องไม่ถูกแตะ').toBe('desktop-token');
  expect(itemOf(res, 'SSS', 'S-21').status).toBe('scanning');
  expect(r.log).toContain('มี lock ถืออยู่');
});

test('lock — หมดอายุแล้ว: บอทยึดต่อได้ · ปล่อยเมื่อเสร็จ (ลบ lock ของตัวเอง)', async () => {
  const w = baseWorld();
  w.docs['stock_sessions/SSS_confirm_lock'] = LOCK('2026-10-21T14:09:00.000000Z');   // หมดไปแล้ว 1 นาที
  const res = run({ ...w, runs: [{ args: REAL }] });
  expect(res.runs[0].code, res.runs[0].log).toBe(0);
  expect(itemOf(res, 'SSS', 'S-21').status).toBe('pass');
  expect(res.store['stock_sessions/SSS_confirm_lock'], 'ปล่อยแล้ว').toBeUndefined();
});

test('lock — เนื้อหาที่บอทเขียนตรงกับที่ PDA/Desktop อ่าน: token · branch · owner · role · countResetAt · expiresAt(timestamp +5 นาที) · startedAt จากเซิร์ฟเวอร์', async () => {
  // หยุดกลางทางด้วย hook เพื่อดู lock ขณะถืออยู่: ทำให้ commit ของ items ล้ม (503 ก่อนเขียน) → verify อ่านกลับพบว่ายังเป็น scanning → aborted · lock ถูกปล่อยใน finally
  // เราจับสำเนา lock จาก write แรก ๆ ผ่านการอ่านสถานะก่อนปล่อย: ใช้ script touch_before_commit ที่ items เพื่อให้ commit ล้ม แล้วดู journal/ล็อกไม่ได้ → ใช้ทางตรง:
  const w = baseWorld();
  const res = run({ ...w, runs: [{ args: REAL }], script: [{ type: 'drop', match: '_confirm_lock', nth: 2, mode: 'before' }] });   // commit ที่ 2 ที่แตะ lock = ปล่อย lock → ล้ม → lock ค้างอยู่ให้ตรวจ
  const lock = docOf(res, 'stock_sessions/SSS_confirm_lock');
  expect(lock, 'ปล่อย lock ล้ม (เครือข่ายหลุด) → lock ค้างให้ตรวจ').toBeTruthy();
  expect(lock).toMatchObject({ branch: 'SSS', owner: 'auto-r16', role: 'bot', countResetAt: H.EPOCH });
  expect(lock.token).toMatch(/^[0-9a-f]{32}$/);
  expect(lock.expiresAt).toMatch(/^2026-10-21T14:15:00\.\d+Z$/);
  expect(lock.startedAt).toMatch(/^2026-10-21T14:10:00\.\d+Z$/);
  expect(res.runs[0].log).toContain('ปล่อย lock ไม่สำเร็จ');
  expect(res.runs[0].code, 'ผล Confirm สำเร็จแล้ว การปล่อย lock ไม่สำเร็จเป็นแค่คำเตือน (หมดอายุเองใน 5 นาที)').toBe(0);
  expect(itemOf(res, 'SSS', 'S-21').status).toBe('pass');
});

test('lock — เครื่องอื่นแย่ง lock ระหว่างบอทอ่านกับเขียน: acquire ล้มด้วย precondition → ไม่เขียน items · exit 4', async () => {
  const w = baseWorld();
  w.docs['stock_sessions/SSS_confirm_lock'] = LOCK('2026-10-21T14:09:00.000000Z');   // หมดอายุแล้ว → บอทจะยึด (ใช้ updateTime precondition)
  const res = run({ ...w, runs: [{ args: REAL }], script: [{ type: 'touch_before_commit', match: '_confirm_lock', nth: 1, path: 'stock_sessions/SSS_confirm_lock',
    set: { token: 'another-desktop', expiresAt: { __ts: '2026-10-21T14:20:00.000000Z' } } }] });
  const r = res.runs[0];
  expect(r.code, r.log).toBe(4);
  expect(confirmWrites(r).filter((x) => x.path.includes('/items/'))).toEqual([]);
  expect(itemOf(res, 'SSS', 'S-21').status).toBe('scanning');
  expect(r.log).toContain('แย่ง lock');
});

// ── preflight: สถานะบน Cloud ต้องยังตรงกับตอนเผยแพร่ timeline ───────────────
test('preflight — รอบนับเปลี่ยน / schema v1 / R01 เปลี่ยน / master ไม่ประกาศ timeline รุ่นนี้: ไม่เขียนอะไร exit 4', async () => {
  const cases = [
    ['รอบนับเปลี่ยนจากตอนเผยแพร่', 'stock_sessions/SSS', { session_data_json: JSON.stringify({ countResetAt: '2026-10-21T01:00:00.000Z' }) }, 'รอบนับเปลี่ยน'],
    ['schema v1', 'stock_sessions/SSS', { schemaVersion: 1 }, 'schema v2'],
  ];
  for (const [label, path, set, msg] of cases) {
    const w = baseWorld();
    // เปลี่ยนหลังเผยแพร่แต่ก่อน Confirm: ใช้ ops ใน run ที่ 1 ไม่ได้ (เผยแพร่และ Confirm อยู่ใน main เดียวกัน) → ตั้ง hook ให้เปลี่ยนตอน commit ครั้งแรกของ master
    const res = run({ ...w, runs: [{ args: REAL }], script: [{ type: 'touch_before_commit', match: '_confirm_lock', nth: 1, path, set }] });
    const r = res.runs[0];
    expect(r.code, `${label}\n${r.log}`).toBe(4);
    expect(confirmWrites(r).filter((x) => x.path.includes('/items/')), `${label}: ไม่เขียน items`).toEqual([]);
    expect(itemOf(res, 'SSS', 'S-21').status).toBe('scanning');
    expect(r.log, label).toContain(msg);
    expect(res.store['stock_sessions/SSS_confirm_lock'], `${label}: lock ถูกปล่อย`).toBeUndefined();
  }
});

test('preflight — master ไม่ได้ประกาศ timeline รุ่นที่บอทเพิ่งเผยแพร่ (มีคนอัป R16 ทับ) / R01 ใหม่เข้ามา: ไม่เขียน', async () => {
  for (const [label, set, msg] of [
    ['R16 ถูกอัปทับ', { r16DetailVersion: 'OTHER-VERSION' }, 'master ไม่ได้ประกาศ timeline รุ่นนี้'],
    ['R01 ใหม่', { r01Version: '2026-10-21T14:00:00.000Z-NEW' }, 'R01 ของสาขาเปลี่ยน'],
  ]) {
    const w = baseWorld();
    // preflight ครั้งแรกอ่าน master ก่อนถือ lock — hook ทำงานที่ commit ครั้งแรกที่แตะ lock (หลัง preflight แรก) จึงถูกจับที่ preflight ครั้งที่สองหลังรอ settle
    const res = run({ ...w, runs: [{ args: REAL }], script: [{ type: 'touch_before_commit', match: '_confirm_lock', nth: 1, path: 'stock_sessions/SSS_r01', set }] });
    const r = res.runs[0];
    expect(r.code, `${label}\n${r.log}`).toBe(4);
    expect(confirmWrites(r).filter((x) => x.path.includes('/items/'))).toEqual([]);
    expect(r.log, label).toContain(msg);
    expect(r.log).toContain('Confirm SSS aborted');
  }
});

test('PHARMACY_DIRECT_STOCK_ADJ ปิด (เว็บส่งรายการไม่ตรงเข้า audit ซึ่งบอทไม่รองรับ) — โหมดเขียนจริงปฏิเสธ ไม่เขียนอะไร', async () => {
  const w = baseWorld();
  const res = run({ ...w, consts: { PHARMACY_DIRECT_STOCK_ADJ: false }, runs: [{ args: REAL }] });
  expect(res.runs[0].code, res.runs[0].log).toBe(4);
  expect(confirmWrites(res.runs[0])).toEqual([]);
  expect(res.runs[0].log).toContain('PHARMACY_DIRECT_STOCK_ADJ ปิดอยู่');
});

// ── atomic / commit ล้ม ───────────────────────────────────────────────────
test('atomic — item หนึ่งตัวเปลี่ยนระหว่างบอทคำนวณ (updateTime ไม่ตรง): commit ล้มทั้งชุด ไม่มี item ใดถูกเขียน · lock ถูกปล่อย · exit 4', async () => {
  const w = baseWorld();
  const res = run({ ...w, runs: [{ args: REAL }], script: [{ type: 'touch_before_commit', match: '/items/', nth: 1, path: 'stock_sessions/SSS/items/S-24', set: { countedQty: 9 } }] });
  const r = res.runs[0];
  expect(r.code, r.log).toBe(4);
  for (const sku of CONFIRMED_SKUS) expect(itemOf(res, 'SSS', sku).status, `${sku}: ยังเป็น scanning`).toBe('scanning');
  expect(itemOf(res, 'SSS', 'S-24').countedQty, 'การแก้ของเครื่องอื่นอยู่ครบ').toBe(9);
  expect(confirmWrites(r).filter((x) => x.path.includes('/items/')), 'ไม่มี item ใดถูกเขียน').toEqual([]);
  expect(res.store['stock_sessions/SSS_confirm_lock']).toBeUndefined();
  expect(r.log).toContain('Confirm SSS aborted');
  expect(r.log).not.toContain('Confirm SSS สำเร็จ');
  expect(Object.values(res.files.journals)[0].state, 'journal ถูกจดก่อนเขียนเสมอ แต่ไม่ถูกตีว่า committed').toBe('planned');
});

test('หลาย commit (ชุดละ 2 รายการ): ชุดแรกสำเร็จ ชุดที่สองล้ม → เขียนบางส่วน = exit 1 · journal partial · ย้อนด้วย --confirm-undo ได้', async () => {
  const w = baseWorld();
  const res = run({ ...w, consts: { CONFIRM_BATCH_SIZE: 2 },
    script: [{ type: 'touch_before_commit', match: '/items/', nth: 2, path: 'stock_sessions/SSS/items/S-23', set: { countedQty: 9 } }],
    runs: [{ args: REAL }, { args: ['--confirm-undo', '{JOURNAL_LATEST}'] }] });
  const r = res.runs[0];
  expect(r.code, 'เขียนไปแล้วบางส่วน = ต้องมีคนดู (exit 1)\n' + r.log).toBe(1);
  const writtenItems = confirmWrites(r).filter((x) => x.path.includes('/items/')).map((x) => x.path.split('/').pop()).sort();
  expect(writtenItems, 'ชุดแรก (2 รายการ) เขียนแล้ว ชุดอื่นไม่ถูกเขียน').toEqual(['S-21', 'S-22']);
  expect(itemOf(r, 'SSS', 'S-21').status, 'หลังรอบที่ 1 (ก่อนย้อน)').toBe('pass');
  expect(itemOf(r, 'SSS', 'S-22').status).toBe('stock_adjustment');
  expect(itemOf(r, 'SSS', 'S-23').status).toBe('scanning');
  expect(docOf(r, 'stock_audit_log/SSS_2026-10-21').items.map((x) => x.sku), 'audit log สะท้อนสิ่งที่เขียนแล้ว').toEqual(['S-22']);
  const j = Object.values(res.files.journals)[0];
  expect(j.state).toBe('partial');
  expect(r.log).toContain('เขียนไปแล้ว 2/6');
  expect(r.log).toContain('--confirm-undo');

  const u = res.runs[1];
  expect(u.code, u.log).toBe(0);
  expect(itemOf(res, 'SSS', 'S-21').status, 'ย้อนแล้วกลับเป็น scanning').toBe('scanning');
  expect(itemOf(res, 'SSS', 'S-22').status).toBe('scanning');
});

test('commit ไม่รู้ผล (เครือข่ายหลุดหลังเขียนสำเร็จ): บอทอ่านกลับเห็นว่าเขียนครบ → ถือว่าสำเร็จ ไม่เขียนซ้ำ', async () => {
  const w = baseWorld();
  const res = run({ ...w, runs: [{ args: REAL }], script: [{ type: 'drop', match: '/items/', nth: 1, mode: 'after' }] });
  const r = res.runs[0];
  expect(r.code, r.log).toBe(0);
  expectConfirmedItems(res);
  expect(r.log).toContain('commit ไม่รู้ผล');
  expect(confirmWrites(r).filter((x) => x.path.includes('/items/')).length, 'เขียนครั้งเดียว ไม่มีรอบซ้ำ').toBe(6);
  const j = Object.values(res.files.journals)[0];
  expect(j.state).toBe('committed');
  expect(j.items.every((x) => x.update_time_after === null), 'ไม่รู้ updateTime หลังเขียน (ตอบไม่ถึง)').toBe(true);
});

test('commit ไม่รู้ผล (เครือข่ายหลุดก่อนเขียน หรือ 503): อ่านกลับเห็นว่ายังไม่เขียน → aborted ไม่เขียนอะไร exit 4 (ไม่ลองซ้ำเอง)', async () => {
  for (const mode of ['before', '503']) {
    const w = baseWorld();
    const res = run({ ...w, runs: [{ args: REAL }], script: [{ type: 'drop', match: '/items/', nth: 1, mode }] });
    const r = res.runs[0];
    expect(r.code, `${mode}\n${r.log}`).toBe(4);
    for (const sku of CONFIRMED_SKUS) expect(itemOf(res, 'SSS', sku).status, `${mode} ${sku}`).toBe('scanning');
    expect(confirmWrites(r).filter((x) => x.path.includes('/items/'))).toEqual([]);
    expect(r.log).toContain('commit ไม่สำเร็จ (ผลอ่านกลับ: none)');
    expect(res.store['stock_sessions/SSS_confirm_lock']).toBeUndefined();
  }
});

test('เขียน journal ไม่ได้ → ไม่เขียน Cloud เลย (ถ้าผิดจะย้อนไม่ได้) · exit 1 · lock ถูกปล่อย', async () => {
  const w = baseWorld();
  const res = run({ ...w, runs: [{ args: REAL }], breakJournal: true });
  const r = res.runs[0];
  expect(r.code, r.log).toBe(1);
  expect(r.log).toContain('เขียน journal ไม่ได้');
  expect(confirmWrites(r).filter((x) => x.path.includes('/items/') || x.path.startsWith('stock_audit_log'))).toEqual([]);
  expect(itemOf(res, 'SSS', 'S-21').status).toBe('scanning');
  expect(res.store['stock_sessions/SSS_confirm_lock']).toBeUndefined();
});

test('เขียน stock_audit_log ไม่สำเร็จ → ผล Confirm ยังอยู่ (เป็นแค่คำเตือน) exit 0', async () => {
  const w = baseWorld();
  const res = run({ ...w, runs: [{ args: REAL }], script: [{ type: 'drop', match: 'stock_audit_log/', nth: 1, mode: '503' }] });
  expect(res.runs[0].code, res.runs[0].log).toBe(0);
  expectConfirmedItems(res);
  expect(res.runs[0].log).toContain('เขียน stock_audit_log ไม่สำเร็จ');
  expect(res.store['stock_audit_log/SSS_2026-10-21']).toBeUndefined();
});

// ── tripwire ─────────────────────────────────────────────────────────────
function bigWorld({ pass, adj }) {
  const items = [];
  const sales = [];
  // S-21.. ไม่พอ (ระบบ 5 เฉพาะ S-20+ ใน fixture) → ใช้ SKU S-20..S-40 วนซ้ำไม่ได้ จึงสร้างรายการหลาย SKU ด้วยเลข 2 หลักช่วง 20–40 และพึ่ง 21 SKU
  const skus = Array.from({ length: 21 }, (_, i) => 'S-' + String(20 + i));
  const total = pass + adj;
  for (let i = 0; i < total; i++) items.push(item(skus[i], i < pass ? 5 : 2, '10:00:00'));
  return world({ branches: ['SSS'], items: { SSS: items }, sales: { SSS: sales } });
}

test('tripwire — Stock Adj เกิน 50% ของ ≥20 รายการ: ไม่เขียนอะไร exit 4 · --confirm-max-adj-ratio ปรับเพดานแล้วเขียนได้', async () => {
  const w = bigWorld({ pass: 5, adj: 16 });   // 21 รายการ · adj 76%
  const res = run({ ...w, runs: [{ args: REAL }, { args: [...REAL, '--confirm-max-adj-ratio', '0.9'] }] });
  const a = res.runs[0];
  expect(a.code, a.log).toBe(4);
  expect(a.log).toContain('TRIPWIRE');
  expect(confirmWrites(a).filter((x) => x.path.includes('/items/'))).toEqual([]);
  expect(itemOf(a, 'SSS', 'S-20').status).toBe('scanning');
  const b = res.runs[1];
  expect(b.code, b.log).toBe(0);
  expect(itemOf(b, 'SSS', 'S-20').status).toBe('pass');
  expect(itemOf(b, 'SSS', 'S-40').status).toBe('stock_adjustment');
});

test('tripwire — ต่ำกว่า 20 รายการไม่ทำงาน (รอบเล็กสัดส่วนแกว่งเป็นปกติ) · เท่าเพดานพอดีไม่ติด · เกินเล็กน้อยติด', async () => {
  const small = bigWorld({ pass: 0, adj: 19 });   // 19 รายการ adj 100%
  const r1 = run({ ...small, runs: [{ args: REAL }] }).runs[0];
  expect(r1.code, r1.log).toBe(0);
  expect(r1.log).not.toContain('TRIPWIRE');
  const edge = bigWorld({ pass: 10, adj: 10 });   // 20 รายการ adj 50% = เพดาน (ไม่เกิน)
  const r2 = run({ ...edge, runs: [{ args: REAL }] }).runs[0];
  expect(r2.code, r2.log).toBe(0);
  const over = bigWorld({ pass: 9, adj: 11 });    // 55%
  const r3 = run({ ...over, runs: [{ args: REAL }] }).runs[0];
  expect(r3.code, r3.log).toBe(4);
  expect(r3.log).toContain('TRIPWIRE');
});

test('tripwire ในโหมดเงา — จดธง tripwire ลง shadow log และเตือนใน log แต่ exit 0', async () => {
  const w = bigWorld({ pass: 5, adj: 16 });
  const res = run({ ...w, runs: [{ args: ['--confirm-shadow'] }] });
  expect(res.runs[0].code, res.runs[0].log).toBe(0);
  expect(res.files.shadow[0].summary.tripwire).toBe(true);
  expect(res.runs[0].log).toContain('ถ้าเป็นโหมดเขียนจริงจะไม่เขียน');
});

// ── exit code / สาขาผสม ───────────────────────────────────────────────────
test('สาขาผสม — SSS เขียนจริง · KKL โหมดเงา · SRC ไม่ติด flag: เขียนเฉพาะ SSS · KKL มีบันทึกเงา · SRC ไม่มีอะไร', async () => {
  const mk = () => item('S-21', 5, '10:00:00');
  const w = world({ branches: ['SRC', 'KKL', 'SSS'], items: { SRC: [mk()], KKL: [mk()], SSS: [mk()] } });
  const res = run({ ...w, runs: [{ args: ['--confirm', '--confirm-branch', 'SSS', '--confirm-shadow', '--branch', 'KKL,SSS'] }, { args: ['--confirm', '--confirm-branch', 'SSS'] }] });
  const a = res.runs[0];
  expect(a.code, a.log).toBe(0);
  expect(itemOf(res, 'SSS', 'S-21').status).toBe('pass');
  expect(itemOf(res, 'KKL', 'S-21').status, 'KKL เป็นโหมดเงา').toBe('scanning');
  expect(itemOf(res, 'SRC', 'S-21').status, 'SRC ไม่อยู่ใน --branch').toBe('scanning');
  expect(res.files.shadow.map((x) => x.branch)).toEqual(['KKL']);
  // รอบสอง: ไม่มี --confirm-shadow → KKL/SRC ไม่ถูกแตะ (ไม่มีบันทึกเงาเพิ่ม)
  expect(res.files.shadow).toHaveLength(1);
});

test('exit code — โหมดเงาล้มไม่ทำให้ Task แดง (งานหลักคือเผยแพร่ timeline) · โหมดเขียนจริงที่ล้มกลางทางเป็น 1 และปล่อย lock', async () => {
  const w = baseWorld();
  const sh = run({ ...w, runs: [{ args: ['--confirm-shadow'] }], script: [{ type: 'http', match: 'runQuery', nth: 1, code: 503 }] });
  expect(sh.runs[0].code, 'เงาล้ม → exit 0\n' + sh.runs[0].log).toBe(0);
  expect(sh.runs[0].log).toContain('Confirm SSS ล้ม');
  expect(sh.runs[0].log).toContain('Confirm SSS failed');
  expect(docOf(sh, 'stock_sessions/SSS_r01').r16Loaded, 'timeline ยังถูกเผยแพร่').toBe(true);
  expect(sh.files.shadow, 'ไม่มีบันทึกเงาเมื่อคำนวณไม่สำเร็จ').toBeUndefined();

  const real = run({ ...w, runs: [{ args: REAL }], script: [{ type: 'http', match: 'runQuery', nth: 1, code: 503 }] });
  expect(real.runs[0].code, 'เขียนจริงล้ม → exit 1\n' + real.runs[0].log).toBe(1);
  expect(confirmWrites(real.runs[0]).filter((x) => x.path.includes('/items/'))).toEqual([]);
  expect(real.store['stock_sessions/SSS_confirm_lock'], 'lock ถูกปล่อย').toBeUndefined();
  expect(itemOf(real, 'SSS', 'S-21').status).toBe('scanning');
});

// ── นาฬิกาเครื่องคลาด: ด่านเวลา 21:00 และอายุ lock พึ่งนาฬิกาเครื่องนี้ ───────────────────────────────
// บอทเทียบนาฬิกาเครื่องกับส่วนหัว Date ของคำตอบล่าสุดจาก Firestore — ต่างเกิน 120 วินาที (เร็วหรือช้า) = ไม่ Confirm จริง
// เทสตั้ง m._last_http_date ตรงๆ (ปกติ _request ตั้งให้ — ที่นี่ _request ถูกแทนด้วย Firestore จำลอง) ให้ห่างจากเวลาจริงตามต้องการ
// ส่วนหัวจริงจาก HTTP จริงตรวจที่ e2e/auto-r16-confirm.spec.js
const httpDate = (machineAheadSec) => new Date(Date.now() - machineAheadSec * 1000).toUTCString();
const withDate = (w, machineAheadSec) => ({ ...w, consts: { _last_http_date: httpDate(machineAheadSec) } });

test('นาฬิกาเครื่องคลาดจากเซิร์ฟเวอร์เกิน 120 วิ (เร็วหรือช้า) — โหมดเขียนจริงไม่เขียนอะไร exit 4 · ข้อความบอกจำนวนวินาที', async () => {
  const w = baseWorld();
  for (const [label, ahead, sign] of [['เครื่องเร็วกว่า', 600, '+'], ['เครื่องช้ากว่า', -600, '-']]) {
    const res = run({ ...withDate(w, ahead), runs: [{ args: REAL }] });
    const r = res.runs[0];
    expect(r.code, `${label}\n${r.log}`).toBe(4);
    expect(confirmWrites(r), `${label}: ไม่เขียนอะไร`).toEqual([]);
    expect(itemOf(res, 'SSS', 'S-21').status, label).toBe('scanning');
    expect(r.log, label).toMatch(new RegExp(`นาฬิกาเครื่องนี้คลาดจากเซิร์ฟเวอร์ Firestore \\${sign}[56]\\d\\d วินาที`));   // 600 วิ ± เวลาที่ผ่านไประหว่างตั้งกับตรวจ (เครื่องช้ากว่า → -599)
    expect(r.log, label).toContain('Confirm SSS skipped');
  }
});

test('นาฬิกาเครื่องคลาดไม่เกิน 120 วิ · ไม่มีส่วนหัว Date · ส่วนหัวอ่านไม่ได้/ว่าง — Confirm ได้ตามปกติ (ไม่ขึ้นข้อความคลาด)', async () => {
  const w = baseWorld();
  for (const [label, consts] of [['คลาด 90 วิ (เครื่องเร็ว)', { _last_http_date: httpDate(90) }], ['คลาด 90 วิ (เครื่องช้า)', { _last_http_date: httpDate(-90) }],
    ['ไม่เคยได้ส่วนหัว', {}], ['ส่วนหัวอ่านไม่ได้', { _last_http_date: 'not a date' }], ['ส่วนหัวว่าง', { _last_http_date: '' }]]) {
    const res = run({ ...w, consts, runs: [{ args: REAL }] });
    expect(res.runs[0].code, `${label}\n${res.runs[0].log}`).toBe(0);
    expectConfirmedItems(res);
    expect(res.runs[0].log, label).not.toContain('นาฬิกาเครื่องนี้คลาด');
  }
});

test('นาฬิกาคลาด + --force — ข้ามด่านได้เหมือนด่านเวลาอื่น (เตือน ⚠️ ไม่ใช่ ❌)', async () => {
  const res = run({ ...withDate(baseWorld(), 600), runs: [{ args: [...REAL, '--force'] }] });
  expect(res.runs[0].code, res.runs[0].log).toBe(0);
  expectConfirmedItems(res);
  expect(res.runs[0].log).toMatch(/⚠️ นาฬิกาเครื่องนี้คลาด/);
  expect(res.runs[0].log).not.toMatch(/❌ นาฬิกาเครื่องนี้คลาด/);
});

test('นาฬิกาคลาดในโหมดเงา — ยังคำนวณและจดบันทึก (ติดธง early) · เตือน ⚠️ · ไม่เขียนอะไร · exit 0', async () => {
  const res = run({ ...withDate(baseWorld(), 600), runs: [{ args: ['--confirm-shadow'] }] });
  const r = res.runs[0];
  expect(r.code, r.log).toBe(0);
  expect(r.log).toMatch(/⚠️ นาฬิกาเครื่องนี้คลาด/);
  expect(res.files.shadow).toHaveLength(1);
  expect(res.files.shadow[0].early, 'ปัญหาเวลาทุกชนิดทำให้บันทึกติดธง early (ตัวเลขนี้ไม่ใช่ของ 21:10 จริง)').toBe(true);
  expect(res.files.shadow[0].results).toHaveLength(6);
  expect(confirmWrites(r)).toEqual([]);
});

test('_request จริง (HTTP ผ่านเซิร์ฟเวอร์จำลองในเครื่อง) จำส่วนหัว Date ของคำตอบล่าสุด และ clock_skew_seconds() คำนวณถูกทั้งสองทิศ · คำตอบที่ไม่มี Date ไม่ล้างค่าเดิม', async () => {
  // Firestore emulator ไม่ส่งส่วนหัว Date (ตรวจแล้ว) จึงใช้เซิร์ฟเวอร์ http.server เล็กๆ ที่กำหนด Date เองได้ · Firestore จริงส่ง Date ทุกคำตอบ
  const out = runPython(`
import os, threading, http.server
from datetime import datetime, timezone, timedelta
from email.utils import format_datetime
state = {'date': None}
class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_GET(self):
        body = b'{"name":"x","fields":{}}'
        self.send_response_only(200)
        self.send_header('Content-Type', 'application/json')
        if state['date'] is not None: self.send_header('Date', state['date'])
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)
srv = http.server.HTTPServer(('127.0.0.1', 0), Handler)
threading.Thread(target=srv.serve_forever, daemon=True).start()
os.environ['AUTO_R16_FIRESTORE_BASE'] = 'http://127.0.0.1:%d' % srv.server_address[1]
os.environ['AUTO_R16_PROJECT_ID'] = 'demo-skew'
def probe(date):
    state['date'] = date
    doc = m.get_doc('X', ['a'])
    return {'ok': doc is not None, 'date': m._last_http_date, 'skew': m.clock_skew_seconds()}
now = datetime.now(timezone.utc)
out = {'start': {'date': m._last_http_date, 'skew': m.clock_skew_seconds()}}
out['noHeader'] = probe(None)
out['exact'] = probe(format_datetime(now, usegmt=True))
out['ahead'] = probe(format_datetime(now - timedelta(seconds=600), usegmt=True))
out['behind'] = probe(format_datetime(now + timedelta(seconds=300), usegmt=True))
out['keptWhenMissing'] = probe(None)
out['garbage'] = probe('not a date')
srv.shutdown()
print(json.dumps(out))
`, {});
  expect(out.start, 'ก่อนมีคำตอบ: ไม่รู้ → None').toEqual({ date: null, skew: null });
  expect(out.noHeader, 'คำตอบแรกไม่มี Date: ยังไม่รู้ → None (ด่านถูกข้ามอย่างปลอดภัย)').toEqual({ ok: true, date: null, skew: null });
  expect(out.exact.ok).toBe(true);
  expect(Math.abs(out.exact.skew), 'Date = เวลาจริง → ต่างไม่กี่วินาที').toBeLessThan(5);
  expect(out.ahead.skew, 'Date ย้อนหลัง 600 วิ → เครื่องเร็วกว่า (+)').toBeGreaterThan(595);
  expect(out.ahead.skew).toBeLessThan(610);
  expect(out.behind.skew, 'Date ล้ำหน้า 300 วิ → เครื่องช้ากว่า (−)').toBeLessThan(-295);
  expect(out.behind.skew).toBeGreaterThan(-310);
  expect(out.keptWhenMissing.date, 'คำตอบที่ไม่มี Date ไม่ล้างค่าเดิม').toBe(out.behind.date);
  expect(out.garbage.date).toBe('not a date');
  expect(out.garbage.skew, 'อ่านวันที่ไม่ออก → None ไม่ใช่ error').toBeNull();
});

// ── journal เก่า: ย้อนผลได้ภายใน 45 วัน แล้วถูกลบหลัง Confirm จริงสำเร็จ ─────────────────────────────
const JOURNAL = (name, ageDays, extra = {}) => ({ op: 'statefile', rel: `confirm_journal/${name}`, ageDays, ...extra });
const OLD_SSS = '2026-08-30_021000_SSS.json';

test('journal เก่ากว่า 45 วันถูกลบหลัง Confirm จริงสำเร็จ — ของที่ยังอยู่ในช่วงย้อนผล · ของรอบนี้ · ไฟล์ที่ไม่ใช่รูปแบบของบอทไม่ถูกแตะ', async () => {
  const ops = [
    JOURNAL(OLD_SSS, 50),                          // เก่า → ลบ
    JOURNAL('2026-08-31_021000_KKL.json', 46),     // เก่า → ลบ
    JOURNAL('2026-09-10_021000_SRC.json', 40),     // ยังอยู่ในช่วงย้อนผล → คง
    JOURNAL('notes.txt', 90),                      // ไม่ใช่รูปแบบของบอท → คง
    JOURNAL('2026-08-30_021000_WH.json', 90),      // WH ไม่ใช่สาขาของบอท → คง
    JOURNAL(OLD_SSS + '.bak', 90),                 // นามสกุลต่าง → คง
    JOURNAL('x2026-08-30_021000_SSS.json', 90),    // ชื่อไม่ตรงทั้งชื่อ (regex ต้องยึดต้นชื่อ) → คง
  ];
  const res = run({ ...baseWorld(), runs: [{ ops, args: REAL }] });
  expect(res.runs[0].code, res.runs[0].log).toBe(0);
  const names = res.files.journalEntries;
  expect(names).not.toContain(OLD_SSS);
  expect(names).not.toContain('2026-08-31_021000_KKL.json');
  expect(names).toEqual(expect.arrayContaining(['2026-09-10_021000_SRC.json', 'notes.txt', '2026-08-30_021000_WH.json', OLD_SSS + '.bak', 'x2026-08-30_021000_SSS.json']));
  expect(names, 'journal ของรอบนี้ต้องอยู่ครบ').toContain('2026-10-21_211000_SSS.json');
  expectConfirmedItems(res);
});

test('ลบ journal เก่าไม่ได้ (ไฟล์ล็อก/สิทธิ์) — ข้ามไฟล์นั้น ลบไฟล์อื่นต่อ · Confirm ไม่เสีย exit 0', async () => {
  // โฟลเดอร์ที่ตั้งชื่อเหมือน journal และดูเก่า: os.remove ลบไม่ได้ (เลียนแบบไฟล์ที่ถูกล็อกบน Windows)
  const ops = [JOURNAL('2026-08-01_021000_KKL.json', 60, { dir: true }), JOURNAL('2026-08-02_021000_SRC.json', 60), JOURNAL('2026-08-03_021000_SSS.json', 60)];
  const res = run({ ...baseWorld(), runs: [{ ops, args: REAL }] });
  expect(res.runs[0].code, res.runs[0].log).toBe(0);
  expectConfirmedItems(res);
  expect(res.runs[0].log).toContain('ลบ journal เก่า');
  expect(res.runs[0].log).toContain('ไม่สำเร็จ');
  expect(res.files.journalEntries).toContain('2026-08-01_021000_KKL.json');
  expect(res.files.journalEntries, 'ไฟล์ที่ลบได้ยังถูกลบแม้เจอไฟล์ที่ลบไม่ได้').not.toContain('2026-08-02_021000_SRC.json');
  expect(res.files.journalEntries).not.toContain('2026-08-03_021000_SSS.json');
});

test('journal เก่าไม่ถูกลบเมื่อรอบนี้ไม่ได้ Confirm จริงสำเร็จ — โหมดเงา · --dry-run · ตกด่านเวลา · tripwire · ไม่พบรายการ (journal คือทางย้อนของผลที่เขียนไปแล้ว)', async () => {
  const plant = () => [JOURNAL(OLD_SSS, 50)];
  const cases = [
    ['โหมดเงา', baseWorld(), ['--confirm-shadow'], {}, 0],
    ['--dry-run', baseWorld(), [...REAL, '--dry-run'], {}, 0],
    ['ตกด่านเวลา', baseWorld(), REAL, { now: '2026-10-21T20:59:00+07:00', mtime: '2026-10-21T20:50:00+07:00' }, 4],
    ['tripwire', bigWorld({ pass: 5, adj: 16 }), REAL, {}, 4],
    ['ไม่มีรายการให้ Confirm', world({ branches: ['SSS'], items: { SSS: [] } }), REAL, {}, 0],
  ];
  for (const [label, w, args, extra, code] of cases) {
    const res = run({ ...w, ...extra, runs: [{ ops: plant(), args }] });
    expect(res.runs[0].code, `${label}\n${res.runs[0].log}`).toBe(code);
    expect(res.files.journalEntries, label).toContain(OLD_SSS);
  }
});

// ── shadow log: เกินเพดานขนาดหมุนเป็น .1 ─────────────────────────────────────────────────────────────
test('shadow log เกินเพดานขนาด — หมุนเป็น .1 (เก็บแค่ 2 ไฟล์) แล้วเขียนไฟล์ใหม่ · ค่าเริ่มต้น (30 MB) ไม่หมุน', async () => {
  const w = baseWorld();
  const at = (mm) => ({ op: 'now', at: `2026-10-21T21:${mm}:00+07:00` });
  const SHADOW = ['--confirm-shadow'];
  const small = run({ ...w, consts: { SHADOW_LOG_MAX_BYTES: 300 }, runs: [{ args: SHADOW }, { ops: [at(11)], args: SHADOW }, { ops: [at(12)], args: SHADOW }] });
  for (const r of small.runs) expect(r.code, r.log).toBe(0);
  const mins = (recs) => recs.map((x) => x.ts.slice(11, 16));
  expect(mins(small.files.shadow), 'ไฟล์หลักมีเฉพาะบันทึกหลังหมุนล่าสุด').toEqual(['21:12']);
  expect(mins(small.files.shadowOld), '.1 = ไฟล์ก่อนหน้า (ไฟล์ก่อนนั้นถูกแทนที่)').toEqual(['21:11']);
  expect(small.files.stateDirEntries).toContain('auto_r16_confirm_shadow.jsonl.1');

  const def = run({ ...w, runs: [{ args: SHADOW }, { ops: [at(11)], args: SHADOW }, { ops: [at(12)], args: SHADOW }] });
  expect(mins(def.files.shadow), 'ค่าเริ่มต้น: ไม่หมุน เก็บครบ').toEqual(['21:10', '21:11', '21:12']);
  expect(def.files.shadowOld).toBeUndefined();
  expect(def.files.stateDirEntries).not.toContain('auto_r16_confirm_shadow.jsonl.1');
});

// ── ตัวกรองรายการ/audit log: ขอบที่ข้อมูลจริงไม่ค่อยชน แต่บอทไม่มีคนเฝ้า ───────────────────────────────
test('ยอดนับเป็น true/false (ข้อมูลเพี้ยน) ไม่ถูกนับเป็น 1/0 — ข้ามเป็น no_count ไม่ถูกแตะ', async () => {
  const w = world({ branches: ['SSS'], items: { SSS: [item('S-21', 5, '10:00:00'), item('S-22', true, '10:00:00'), item('S-23', false, '10:00:00')] } });
  const sh = run({ ...w, runs: [{ args: ['--confirm-shadow'] }] });
  expect(sh.files.shadow[0].skipped).toEqual({ no_count: 2 });
  expect(sh.files.shadow[0].evaluated).toBe(1);
  const res = run({ ...w, runs: [{ args: REAL }] });
  expect(res.runs[0].code, res.runs[0].log).toBe(0);
  expect(itemOf(res, 'SSS', 'S-21').status).toBe('pass');
  for (const sku of ['S-22', 'S-23']) {
    expect(itemOf(res, 'SSS', sku).status, sku).toBe('scanning');
    expect(untouched(res, `stock_sessions/SSS/items/${sku}`), `${sku}: ไม่ถูกเขียนเลย`).toBe(true);
  }
});

test('audit log — รายการ directAdj ที่ SKU ไม่อยู่ในแคตตาล็อกปัจจุบัน: ชื่อสินค้าว่าง (เหมือน `si?si.productName:\'\'` ของเว็บ) ไม่ใช่ SKU/เครื่องหมายอื่น', async () => {
  const old = item('NOPE-9', 3, '10:00:00', { status: 'stock_adjustment', auditStatus: 'stock_adjustment', initialStatus: 'stock_adjustment', directAdj: true, effectiveQty: 3, systemQty: 5 });
  const legacyAudit = item('S-27', 4, '10:00:00', { status: 'audit', auditStatus: 'pending', initialStatus: 'audit' });   // Audit ค้างก่อน 29 ก.ย. — Desktop ก็ลงบันทึกของรอบนี้
  const w = world({ branches: ['SSS'], items: { SSS: [item('S-21', 5, '10:00:00'), old, legacyAudit] } });
  const res = run({ ...w, runs: [{ args: REAL }] });
  expect(res.runs[0].code, res.runs[0].log).toBe(0);
  const log = docOf(res, 'stock_audit_log/SSS_2026-10-21');
  const aud = log.items.find((x) => x.sku === 'S-27');
  expect(aud, 'Audit เดิม (initialStatus=audit) ต้องอยู่ใน audit log ด้วย เหมือนที่ Desktop เขียนจากทั้งรอบ').toBeTruthy();
  expect(aud).toEqual({ sku: 'S-27', productName: 'PM S-27', barcode: 'B-27', countedQty: 4, scannedBy: 'พนักงานทดสอบ', timestamp: '2026-10-21 10:00:00',
    firstScanAt: '2026-10-21 10:00:00', status: 'audit', auditor: '', recheckQty: null, backorder: false });
  const nope = log.items.find((x) => x.sku === 'NOPE-9');
  expect(nope, 'รายการเดิมที่เป็น directAdj ต้องอยู่ใน audit log ของรอบ').toBeTruthy();
  expect(nope.productName).toBe('');
  expect(nope).toMatchObject({ directAdj: true, effectiveQty: 3, systemQty: 5, status: 'stock_adjustment' });
  expect(untouched(res, 'stock_sessions/SSS/items/NOPE-9'), 'ไม่ถูกแตะ (ไม่ใช่ scanning)').toBe(true);
});

// ── preflight ครั้งแรก (ก่อนถือ lock): เปลี่ยนหลังเผยแพร่ timeline แต่ก่อนบอทเริ่ม Confirm ─────────────────
// hook ระดับคำขอของ Firestore จำลอง: touch_before_request / touch_after_request (แก้เอกสารรอบ PATCH ประกาศที่ master ซึ่งเป็นขั้นสุดท้ายของการเผยแพร่)
test('preflight ครั้งแรก — รอบนับ/schema/R01/timeline ของ master เปลี่ยนหลังเผยแพร่: ไม่ถือ lock เลย · ไม่เขียน items · exit 4', async () => {
  const MASTER = 'PATCH stock_sessions/SSS_r01';
  const cases = [
    ['รอบนับเปลี่ยน', { type: 'touch_before_request', match: MASTER, path: 'stock_sessions/SSS', set: { session_data_json: JSON.stringify({ countResetAt: '2026-10-21T01:00:00.000Z' }) } }, 'รอบนับเปลี่ยนจากตอนเผยแพร่ timeline'],
    ['schema v1', { type: 'touch_before_request', match: MASTER, path: 'stock_sessions/SSS', set: { schemaVersion: 1 } }, 'สาขายังไม่ใช่ schema v2'],
    ['R01 ใหม่เข้ามา', { type: 'touch_before_request', match: MASTER, path: 'stock_sessions/SSS_r01', set: { r01Version: '2026-10-21T14:00:00.000Z-NEW' } }, 'R01 ของสาขาเปลี่ยน'],
    ['R16 ถูกอัปทับ', { type: 'touch_after_request', match: MASTER, path: 'stock_sessions/SSS_r01', set: { r16DetailVersion: 'OTHER-VERSION' } }, 'master ไม่ได้ประกาศ timeline รุ่นนี้'],
  ];
  for (const [label, hook, msg] of cases) {
    const res = run({ ...baseWorld(), runs: [{ args: REAL }], script: [hook] });
    const r = res.runs[0];
    expect(r.code, `${label}\n${r.log}`).toBe(4);
    expect(r.log, label).toContain(msg);
    expect(r.log, label).toContain('Confirm SSS skipped');
    expect(r.writes.filter((x) => x.path.includes('_confirm_lock')), `${label}: ยังไม่ถือ lock`).toEqual([]);
    expect(confirmWrites(r).filter((x) => x.path.includes('/items/')), `${label}: ไม่เขียน items`).toEqual([]);
    expect(r.sleeps, `${label}: ไม่ถึงขั้นรอ settle`).toEqual([]);
    expect(itemOf(res, 'SSS', 'S-21').status, label).toBe('scanning');
  }
});

test('lock ถูกเครื่องอื่นยึดต่อระหว่างบอททำงาน (บอทช้าจน lock หมดอายุ) — บอทปล่อยเฉพาะ lock ของตัวเอง ไม่ลบของเขา', async () => {
  const w = baseWorld();
  const res = run({ ...w, runs: [{ args: REAL }], script: [{ type: 'touch_before_commit', match: '/items/', nth: 1, path: 'stock_sessions/SSS_confirm_lock', set: { token: 'DESKTOP-TOKEN', owner: 'Desktop' } }] });
  const r = res.runs[0];
  expect(r.code, r.log).toBe(0);
  expectConfirmedItems(res);
  expect(docOf(res, 'stock_sessions/SSS_confirm_lock'), 'lock ของเครื่องอื่นต้องยังอยู่ครบ').toMatchObject({ token: 'DESKTOP-TOKEN', owner: 'Desktop' });
  expect(confirmWrites(r).filter((x) => x.path.endsWith('_confirm_lock') && x.op === 'delete'), 'บอทไม่ลบ lock').toEqual([]);
});
