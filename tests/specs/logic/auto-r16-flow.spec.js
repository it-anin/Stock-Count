// auto-r16: ลำดับงาน ด่าน และการเขียน Firestore ของบอท (ต.ค. 2026) — รัน main() จริงของ auto_r16_import.py กับ Firestore จำลองในหน่วยความจำ
//
// ไม่แตะเครือข่ายเลย: get_doc / patch_doc / delete_doc ถูกแทนด้วยของจำลองที่จดทุกการเรียก · ไฟล์ R16104.CSV เขียนลงโฟลเดอร์ชั่วคราว
// สิ่งที่ล็อกไว้:
//   1) ลำดับเขียน chunks → meta → master เสมอ (ผู้อ่านเชื่อ "master ประกาศแล้ว = chunks พร้อมแล้ว") · PATCH master เฉพาะ 3 field
//   2) ตกด่านใด = ไม่เขียนอะไรเลย (ไฟล์ไม่ใช่วันนี้/ยังไม่นิ่ง/หัวเพี้ยน/มีแถวไม่ใช่วันนี้/R01 ไม่ใช่วันนี้/ชื่อสาขาไม่ตรง)
//   3) เขียนล้มกลางทาง = ลบ chunk รุ่นใหม่ + คืน meta เดิม + ไม่ประกาศ master · สาขาหนึ่งล้มไม่หยุดสาขาอื่น
//   4) รันซ้ำเนื้อหาเดิม = ไม่เขียน · ลบ chunk รุ่นเก่าหลังประกาศเท่านั้น
const { test, expect } = require('@playwright/test');
const { runPython } = require('../../lib/python');
const F = require('../../lib/r16-104-fixture');

const { BRANCHES, EPOCH, R01_VERSION, todayBkk, csvRows, baseDocs, HARNESS, run } = require('../../lib/r16-bot-harness');

const patches = (r) => r.calls.filter((c) => c[0] === 'patch' || c[0] === 'delete');
const patched = (r, id) => r.calls.filter((c) => c[0] === 'patch' && c[1] === id);
const touchedBranch = (r, b) => r.calls.some((c) => (c[0] === 'patch' || c[0] === 'delete') && c[1].startsWith(b + '_'));

test('ทางปกติ — 3 สาขา: chunks → meta → master ตามลำดับ · master PATCH เฉพาะ 3 field · meta ครบ', () => {
  const { runs: [r], store } = run();
  expect(r.code, r.log).toBe(0);
  for (const b of BRANCHES) {
    const w = r.calls.filter((c) => c[0] === 'patch' && c[1].startsWith(b + '_'));
    const ids = w.map((c) => c[1]);
    expect(ids, `${b}: ลำดับเขียน`).toEqual([expect.stringMatching(new RegExp(`^${b}_r16_104_[0-9a-z]+_0000$`)), `${b}_r16_104_meta`, `${b}_r01`]);
    expect(w[2][2], `${b}: master เขียนเฉพาะ 3 field`).toEqual(['r16Loaded', 'r16UploadedAt', 'r16DetailVersion']);

    const meta = store[`${b}_r16_104_meta`];
    expect(meta).toMatchObject({ ready: true, kind: '104', chunkCount: 1, countResetAt: EPOCH, r01Version: R01_VERSION(b), dateMismatch: false, dateMismatchDetail: '', source: 'auto-r16', sourceFile: 'R16104.CSV' });
    expect(meta.rowCount).toBeGreaterThanOrEqual(2);
    expect(meta.version).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
    expect(meta.generation).toMatch(/^[0-9a-z]{9,}$/);
    expect(meta.uploadedAtText).toMatch(/^\d\d:\d\d น\. \d\d\/\d\d\/\d{4} · ข้อมูล \d\d\/\d\d \d\d:\d\d–\d\d\/\d\d \d\d:\d\d$/);

    const master = store[`${b}_r01`];
    expect(master).toMatchObject({ r16Loaded: true, r16DetailVersion: meta.version, r16UploadedAt: meta.uploadedAtText, r01Version: R01_VERSION(b) });
    expect(master.data_json, 'master.data_json ต้องไม่ถูกแตะ').toBe(baseDocs()[`${b}_r01`].data_json);

    const chunk = store[`${b}_r16_104_${meta.generation}_0000`];
    expect(chunk).toMatchObject({ kind: '104', version: meta.version, generation: meta.generation, index: 0, countResetAt: EPOCH });
    const rows = JSON.parse(chunk.data_json);
    // S-01 ขาย 2 · S-02 ขาย 3 · S-03 OTFB (SRC Col A=1 = หน้าร้านส่ง = ขาย 4 · KKL/SSS = รับเข้า 4) · S-04 ยกเลิก · S-05 ORDS → ไม่เข้า
    const bySku = Object.fromEntries(rows.map((x) => [x[0], [x[1], x[2]]]));
    expect(bySku['S-01']).toEqual([2, 0]);
    expect(bySku['S-02']).toEqual([3, 0]);
    expect(bySku['S-03']).toEqual(b === 'SRC' ? [4, 0] : [0, 4]);
    expect(bySku['S-04']).toBeUndefined();
    expect(bySku['S-05']).toBeUndefined();
    expect(rows.find((x) => x[0] === 'S-02')[3][0].tranDate).toBe(`${todayBkk()} 14:20:05`);
  }
  // ไม่แตะ session doc / r16_103 / R01 data
  expect(r.calls.filter((c) => c[0] === 'patch').map((c) => c[1]).filter((id) => !/_r16_104_|_r01$/.test(id))).toEqual([]);
  expect(r.calls.filter((c) => c[0] === 'patch' && c[1].endsWith('_r01')).flatMap((c) => c[2]).filter((f) => /103|data_json|r01/.test(f))).toEqual([]);
});

test('รันซ้ำเนื้อหาเดิม — ไม่เขียนอะไรเลย (ไม่เปลี่ยน version ไม่ปลุก Desktop)', () => {
  const { runs: [first, second] } = run({ runs: 2 });
  expect(patches(first).length).toBeGreaterThan(0);
  expect(second.code, second.log).toBe(0);
  expect(patches(second)).toEqual([]);
  expect(second.log).toContain('เนื้อหาเหมือนเดิมทุกไบต์');
});

test('รุ่นเก่า — ลบ chunk เดิมหลังประกาศ master เท่านั้น (ไม่ลบก่อน)', () => {
  const docs = baseDocs({
    SRC_r16_104_meta: { ready: true, kind: '104', version: '2026-10-12T14:00:00.000Z', generation: 'oldgen', chunkCount: 2, countResetAt: EPOCH, r01Version: 'x', contentHash: 'old' },
    SRC_r16_104_oldgen_0000: { data_json: '[]' }, SRC_r16_104_oldgen_0001: { data_json: '[]' },
  });
  const { runs: [r], store } = run({ docs });
  expect(r.code, r.log).toBe(0);
  const seq = r.calls.filter((c) => (c[0] === 'patch' || c[0] === 'delete') && c[1].startsWith('SRC_')).map((c) => `${c[0]} ${c[1]}`);
  const masterAt = seq.findIndex((s) => s === 'patch SRC_r01');
  expect(masterAt).toBeGreaterThan(0);
  expect(seq.slice(0, masterAt).filter((s) => s.startsWith('delete')), 'ห้ามลบรุ่นเก่าก่อนประกาศ master — เครื่องที่ยังถือรุ่นเก่าต้องโหลดได้จนกว่า master จะเปลี่ยน').toEqual([]);
  expect(seq.slice(masterAt + 1)).toEqual(['delete SRC_r16_104_oldgen_0000', 'delete SRC_r16_104_oldgen_0001']);
  expect(store.SRC_r16_104_oldgen_0000).toBeUndefined();
});

test('ไฟล์ไม่ได้แก้วันนี้ → exit 4 ไม่เขียนอะไร (--force ข้ามได้ — ตอนทดสอบเท่านั้น)', () => {
  const stale = run({ mtimeShiftDays: 1 }).runs[0];
  expect(stale.code).toBe(4);
  expect(patches(stale)).toEqual([]);
  expect(stale.log).toContain('ไม่ได้ถูกแก้ไขวันนี้');
  const forced = run({ mtimeShiftDays: 1, args: ['--force'] }).runs[0];
  expect(forced.code, forced.log).toBe(0);
  expect(patches(forced).length).toBeGreaterThan(0);
});

test('ไฟล์เพิ่งถูกแก้ (ยังไม่นิ่ง) → exit 4 ไม่เขียนอะไร', () => {
  const r = run({ ageSeconds: 5 }).runs[0];
  expect(r.code).toBe(4);
  expect(patches(r)).toEqual([]);
  expect(r.log).toContain('อาจกำลังเขียน');
});

test('หัวคอลัมน์เพี้ยน (สลับตำแหน่ง) → exit 4 ไม่เขียนอะไร · ไม่มี flag ข้ามด่านนี้', () => {
  const head = [...F.HEAD];
  [head[14], head[17]] = [head[17], head[14]];            // SCANCODE ↔ BASEQUANTITY
  const r = run({ csv: F.csvText(BRANCHES.flatMap((b) => csvRows(b)), { head }), args: ['--force'] }).runs[0];
  expect(r.code).toBe(4);
  expect(patches(r)).toEqual([]);
  expect(r.log).toMatch(/คอลัมน์ที่ 14 ควรเป็น SCANCODE/);
});

test('ขาดคอลัมน์ TRANDATE → exit 4', () => {
  const head = F.HEAD.map((h) => (h === 'TRANDATE' ? 'XDATE' : h));
  const r = run({ csv: F.csvText(BRANCHES.flatMap((b) => csvRows(b)), { head }) }).runs[0];
  expect(r.code).toBe(4);
  expect(r.log).toContain('ไม่พบคอลัมน์ TRANDATE');
});

test('มีแถวที่ไม่ใช่วันนี้ปนมา (ไฟล์หลายวัน) → exit 4 ไม่เขียนอะไร · แถวยกเลิกไม่นับ', () => {
  const rows = BRANCHES.flatMap((b) => csvRows(b));
  const old = F.branchRow('SRC', { at: `${todayBkk(-1)} 20:00:00`, barcode: 'B-09', sku: 'S-09' });
  const bad = run({ csv: F.csvText([...rows, old]) }).runs[0];
  expect(bad.code).toBe(4);
  expect(patches(bad)).toEqual([]);
  expect(bad.log).toContain('มีแถวที่ไม่ใช่วันนี้');
  // แถวเก่าที่ยกเลิกแล้วไม่ทำให้ตกด่าน
  const oldCancelled = F.branchRow('SRC', { at: `${todayBkk(-1)} 20:00:00`, barcode: 'B-09', sku: 'S-09', cancel: '1' });
  const ok = run({ csv: F.csvText([...rows, oldCancelled]) }).runs[0];
  expect(ok.code, ok.log).toBe(0);
  // วันที่อ่านไม่ได้
  const garbage = F.branchRow('SRC', { at: 'garbage', barcode: 'B-09', sku: 'S-09' });
  const bad2 = run({ csv: F.csvText([...rows, garbage]) }).runs[0];
  expect(bad2.code).toBe(4);
  expect(bad2.log).toContain('อ่านไม่ได้');
});

test('ไฟล์มีแต่หัวตาราง → exit 4', () => {
  const r = run({ csv: F.csvText([]) }).runs[0];
  expect(r.code).toBe(4);
  expect(patches(r)).toEqual([]);
});

test('R01 ของสาขาไม่ได้อัปวันนี้ → ข้ามเฉพาะสาขานั้น (สาขาอื่นยังเขียน) · exit 4', () => {
  const docs = baseDocs({ KKL_r01: { r01UploadedAt: '__YESTERDAY__' } });
  const r = run({ docs }).runs[0];
  expect(r.code).toBe(4);
  expect(touchedBranch(r, 'KKL')).toBe(false);
  expect(touchedBranch(r, 'SRC')).toBe(true);
  expect(touchedBranch(r, 'SSS')).toBe(true);
  expect(r.log).toContain('R01 ของสาขาไม่ได้อัปวันนี้');
  // --force ข้ามด่านวันที่ (ทดสอบเท่านั้น)
  const forced = run({ docs, args: ['--force'] }).runs[0];
  expect(forced.code, forced.log).toBe(0);
  expect(touchedBranch(forced, 'KKL')).toBe(true);
});

test('ไม่มี R01 ของสาขา (เช่นเพิ่งเริ่มนับใหม่) → ข้ามสาขานั้น ไม่โยน error', () => {
  const r = run({ docs: baseDocs({ SSS_r01: null }) }).runs[0];
  expect(r.code).toBe(4);
  expect(touchedBranch(r, 'SSS')).toBe(false);
  expect(touchedBranch(r, 'SRC') && touchedBranch(r, 'KKL')).toBe(true);
  expect(r.log).toContain('ไม่มี R01 ของสาขา');
});

test('ไม่มี global_r05 → ข้ามทุกสาขา exit 4 · ชื่อสาขาในไฟล์ไม่ตรง id → ข้ามสาขานั้น', () => {
  const noR05 = run({ docs: baseDocs({ global_r05: null }) }).runs[0];
  expect(noR05.code).toBe(4);
  expect(patches(noR05)).toEqual([]);
  const rows = [...csvRows('SRC'), ...csvRows('KKL'), ...csvRows('SSS', { name: 'ชื่อสาขาอื่น' })];
  const r = run({ csv: F.csvText(rows) }).runs[0];
  expect(r.code).toBe(4);
  expect(touchedBranch(r, 'SSS')).toBe(false);
  expect(touchedBranch(r, 'SRC') && touchedBranch(r, 'KKL')).toBe(true);
  expect(r.log).toContain('ชื่อสาขาในไฟล์ไม่ตรง');
});

test('สาขาที่ไม่มีแถวในไฟล์ → ข้ามสาขานั้น · สาขาอื่น (id ที่ไม่รู้จัก) ไม่ทำให้พัง', () => {
  const other = F.row({ branchId: '1', name: 'อนิน สาขาอ่อนนุช', barcode: 'B-01', sku: 'S-01', at: `${todayBkk()} 09:00:00` });
  const rows = [...csvRows('SRC'), ...csvRows('SSS'), other];
  const r = run({ csv: F.csvText(rows) }).runs[0];
  expect(r.code).toBe(4);
  expect(touchedBranch(r, 'KKL')).toBe(false);
  expect(r.log).toContain('ไม่มีแถวของสาขานี้ในไฟล์');
  expect(r.log).toContain('ข้ามสาขาอื่น 1 แถว');
});

test('สาขามีแต่เอกสารประเภทอื่น (ไม่มีขาย/รับเข้า) → เขียน timeline ว่าง (chunkCount 0) · ทุกแถวจับคู่ไม่ได้ → ข้าม', () => {
  const onlyOrds = [F.branchRow('SSS', { tranNo: 'ORDSBY001261000001', at: `${todayBkk()} 09:00:00` })];
  const r = run({ csv: F.csvText([...csvRows('SRC'), ...csvRows('KKL'), ...onlyOrds]) });
  expect(r.runs[0].code, r.runs[0].log).toBe(0);
  expect(r.store.SSS_r16_104_meta).toMatchObject({ ready: true, chunkCount: 0, rowCount: 0 });
  expect(r.store.SSS_r01.r16Loaded).toBe(true);
  // ผ่านด่านประเภทแต่ไม่มี SKU ไหนอยู่ในระบบเลย = R05/R01 ไม่ตรงไฟล์ → ไม่ประกาศ
  const ghosts = [F.branchRow('SSS', { barcode: 'GHOST-1', sku: 'GHOST', at: `${todayBkk()} 09:00:00` })];
  const g = run({ csv: F.csvText([...csvRows('SRC'), ...csvRows('KKL'), ...ghosts]) }).runs[0];
  expect(g.code).toBe(4);
  expect(touchedBranch(g, 'SSS')).toBe(false);
  expect(g.log).toContain('จับคู่ SKU ไม่ได้เลย');
});

test('เขียน meta ล้ม → ลบ chunk รุ่นใหม่ + คืน meta เดิม + ไม่ประกาศ master · สาขาอื่นยังเขียน · exit 1', () => {
  const oldMeta = { ready: true, kind: '104', version: '2026-10-12T14:00:00.000Z', generation: 'oldgen', chunkCount: 1, countResetAt: EPOCH, r01Version: 'x', contentHash: 'old' };
  const docs = baseDocs({ SRC_r16_104_meta: oldMeta, SRC_r16_104_oldgen_0000: { data_json: '[]' } });
  const { runs: [r], store } = run({ docs, failPatch: ['^SRC_r16_104_meta$'] });
  expect(r.code).toBe(1);
  expect(patched(r, 'SRC_r01')).toEqual([]);
  expect(Object.keys(store).filter((k) => /^SRC_r16_104_[0-9a-z]+_\d{4}$/.test(k) && !k.includes('oldgen'))).toEqual([]);   // chunk รุ่นใหม่ถูกลบ
  expect(store.SRC_r16_104_oldgen_0000, 'chunk รุ่นเก่าที่ master ยังชี้อยู่ต้องรอด').toBeDefined();
  expect(store.SRC_r16_104_meta.generation, 'meta เดิมต้องถูกคืน (หรือไม่เคยถูกแตะ)').toBe('oldgen');
  expect(store.SRC_r01.r16Loaded).toBe(false);
  expect(touchedBranch(r, 'KKL') && touchedBranch(r, 'SSS')).toBe(true);
});

test('เขียน chunk ล้ม (ยังไม่มี meta เดิม) → ไม่ทิ้งเศษ · เขียน master ล้ม → meta ใหม่ถูกยกเลิกด้วย', () => {
  const failChunk = run({ failPatch: ['^SRC_r16_104_[0-9a-z]+_0000$'] });
  expect(failChunk.runs[0].code).toBe(1);
  expect(failChunk.store.SRC_r16_104_meta, 'chunk ยังเขียนไม่เสร็จ → ต้องไม่มี meta ใหม่').toBeUndefined();
  expect(failChunk.store.SRC_r01.r16Loaded).toBe(false);
  expect(Object.keys(failChunk.store).filter((k) => /^SRC_r16_104_/.test(k))).toEqual([]);

  const failMaster = run({ failPatch: ['^KKL_r01$'] });
  expect(failMaster.runs[0].code).toBe(1);
  expect(failMaster.store.KKL_r01.r16Loaded).toBe(false);
  expect(failMaster.store.KKL_r16_104_meta, 'master ประกาศไม่ได้ → meta ใหม่ต้องไม่ค้าง').toBeUndefined();
  expect(Object.keys(failMaster.store).filter((k) => /^KKL_r16_104_[0-9a-z]+_\d{4}$/.test(k))).toEqual([]);
});

test('R01 ถูกอัปใหม่ระหว่างเขียน (r01Version เปลี่ยน) → ไม่ประกาศ master · เก็บกวาด · exit 1', () => {
  const { runs: [r], store } = run({ racing: { SRC: 'NEW-R01-VERSION' } });
  expect(r.code).toBe(1);
  expect(patched(r, 'SRC_r01')).toEqual([]);
  expect(store.SRC_r01.r16Loaded).toBe(false);
  expect(store.SRC_r16_104_meta).toBeUndefined();
  expect(r.log).toContain('R01 ของสาขาเปลี่ยนระหว่างเขียน');
});

test('--dry-run — อ่านอย่างเดียว ไม่เขียน/ลบอะไร exit 0 · --branch เลือกบางสาขา', () => {
  const dry = run({ args: ['--dry-run'] }).runs[0];
  expect(dry.code, dry.log).toBe(0);
  expect(patches(dry)).toEqual([]);
  expect(dry.log).toContain('[DRY]');
  const one = run({ args: ['--branch', 'KKL'] }).runs[0];
  expect(one.code, one.log).toBe(0);
  expect(touchedBranch(one, 'KKL')).toBe(true);
  expect(touchedBranch(one, 'SRC') || touchedBranch(one, 'SSS')).toBe(false);
});

test('flag แปลกปลอม / สาขาผิด → exit 2 ก่อนทำอะไร · import ไฟล์บอทต้องไม่มี side effect (ไม่อ่าน argv)', () => {
  expect(run({ args: ['--wat'] }).runs[0].code).toBe(2);
  expect(run({ args: ['--branch', 'XXX'] }).runs[0].code).toBe(2);
  // import "หลัง" ตั้ง argv แปลกปลอมต้องผ่าน (เทส parity import ไฟล์นี้ด้วย -c) — ตรวจ flag ใน main() เท่านั้น
  const out = runPython(`
sys.argv = ['x', '--wat', '--folder']
spec2 = importlib.util.spec_from_file_location('auto_r16_import_2', p['module'])
m2 = importlib.util.module_from_spec(spec2)
spec2.loader.exec_module(m2)
print(json.dumps({'ok': hasattr(m2, 'main')}))
`);
  expect(out.ok).toBe(true);
});

test('ไม่มีโฟลเดอร์ / ไม่มีไฟล์ → exit 2 (ไม่ใช่ 4: ไม่ใช่เรื่องข้อมูลไม่ผ่านด่าน)', () => {
  const out = runPython(`
import io, contextlib, tempfile
res = {}
for label, folder in (('nofolder', '/no/such/dir/anywhere'), ('nofile', tempfile.mkdtemp(prefix='r16empty'))):
    buf = io.StringIO(); code = 0
    with contextlib.redirect_stdout(buf):
        try: m.main(['--folder', folder])
        except SystemExit as e: code = e.code
    res[label] = code
print(json.dumps(res))
`);
  expect(out).toEqual({ nofolder: 2, nofile: 2 });
});

test('ไฟล์ .part ถูกข้าม — เลือกเฉพาะ R16104*.CSV ที่ใหม่สุด', () => {
  const out = runPython(`
import os, tempfile, time
d = tempfile.mkdtemp(prefix='r16part')
def touch(n, age):
    f = os.path.join(d, n); open(f, 'w').write('x'); t = time.time() - age; os.utime(f, (t, t))
touch('R16104.part.CSV', 1); touch('R16104.CSV', 500); touch('R16104_old.CSV', 900); touch('R05.106.CSV', 5)
print(json.dumps(os.path.basename(m.find_latest_file(d))))
`);
  expect(out).toBe('R16104.CSV');
});

test('ตัวช่วยเวลา — r01_date_of / thai_ts / iso_utc_ms / new_generation ตรงรูปแบบที่แอปใช้', () => {
  const out = runPython(`
from datetime import datetime
f = lambda s: {'r01UploadedAt': {'stringValue': s}}
print(json.dumps({
  'a': str(m.r01_date_of(f('08:10 น. 13/10/2026'))),
  'b': str(m.r01_date_of(f('8:10 น.9/9/2026'))),
  'c': str(m.r01_date_of({'updated_at': {'timestampValue': '2026-10-12T18:30:00.000Z'}})),
  'd': str(m.r01_date_of(f('ข้อความอื่น'))),
  'ts': m.thai_ts(datetime(2026, 10, 13, 21, 0)),
  'iso': m.iso_utc_ms(), 'gen': m.new_generation(),
}))
`);
  expect(out.a).toBe('2026-10-13');
  expect(out.b).toBe('2026-09-09');
  expect(out.c).toBe('2026-10-13');      // 12 ต.ค. 18:30 UTC = 13 ต.ค. 01:30 เวลาไทย
  expect(out.d).toBe('None');
  expect(out.ts).toBe('21:00 น. 13/10/2026');
  expect(out.iso).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
  expect(out.gen).toMatch(/^[0-9a-z]{9,}$/);
});
