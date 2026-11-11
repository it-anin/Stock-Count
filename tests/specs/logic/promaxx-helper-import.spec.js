// PromaxxHelper — "นำเข้าอัตโนมัติ" 2 จังหวะ (รุ่น 2026-11-04.6 · ผู้ใช้สั่ง 4 พ.ย. 2026 · เฉพาะสาขายา SRC/KKL/SSS — WH ไม่ใช้)
//   จังหวะ 1 /v1/prepare-import: เปิด/ใช้ ProMaxx → ตั้งประเภท+คลัง Front Store → ตรวจสาขา → อ่านเลขที่เอกสาร แล้วหยุด (ออกตั๋วใช้ครั้งเดียว 10 นาที)
//   จังหวะ 2 /v1/run-import:   ตรวจตั๋ว+ไฟล์ → เขียนไฟล์เอง → กดปุ่มนำเข้า → ใส่ชื่อไฟล์ผ่าน WM_SETTEXT + อ่านกลับ → Open → เทียบตารางกับไฟล์ → (PROMAXX_AUTO_CONFIRM) กด "ตกลง" ครั้งเดียว
//
// ตัวต่อปลอม tests/lib/fake_ssmaxx_uia.py จำลองโครงที่ตรวจจริงกับ ssmaxx.exe เมื่อ 4 พ.ย. 2026 (กล่อง Select File · ตารางรายละเอียด · ปุ่ม cb_ok)
// ⚠️ ไม่พิสูจน์ว่าตัวต่อจริงทำงานตามนี้ — การกด "ตกลง" จริงบน ERP ยังไม่เคยทดสอบ (ดู README §ผลตรวจจริง)
//
// เทสนี้ตรึง 14 ด้าน — ข้อ 5 · 6 · 7 สำคัญที่สุด: "ไม่กด ตกลง เมื่อตารางไม่ตรงไฟล์" · "ทุกความผิดปกติหยุดก่อน ตกลง และไม่ใช้ปุ่มอื่นของแถบปุ่ม" · "ตั๋วใช้ครั้งเดียว/หมดอายุ/ถูกแทนที่"
//   1. ค่าที่ส่งมอบ: ค่าเริ่มต้น PROMAXX_AUTO_CONFIRM = ปิด · สาขายาเท่านั้น · เพดาน 20 แถว · เส้นทาง/ฟิลด์ที่รับ · ค่าคงที่ตรงหน้าเว็บ
//   2. ตรวจเนื้อไฟล์ (parse_import_text) ทุกเงื่อนไข + ขอบ
//   3. เลขที่เอกสาร · ชื่อไฟล์ · เขียนไฟล์ (ไม่ทับ · ไบต์ตรง · ไม่มี BOM) · ลบไฟล์เก่า (เฉพาะชื่อของเรา)
//   4. อ่านตารางจาก UIA + เทียบกับไฟล์ (parse_detail_dump / compare_table)
//   5. ★ สองจังหวะสำเร็จ 3 แบบ (เริ่มจากปิดโปรแกรม · ใช้เซสชันค้าง · PROMAXX_AUTO_CONFIRM เปิด/ปิด)
//   6. ★ ความผิดปกติทุกแบบ → หยุดก่อน ตกลง (ok_clicks=0) · ไม่ใช้ปุ่มอื่น (misfires=[]) · รหัส/ขั้นถูก
//   7. ★ ตั๋ว: ใช้ครั้งเดียว · หมดอายุ · ถูกแทนที่ด้วย prepare ใหม่ · cancel ไม่ล้างตั๋วของคนอื่น · ตรวจรูปแบบผิดไม่ทิ้งตั๋ว · ล้มหลังแตะ ProMaxx ทิ้งตั๋ว
//   8. หลังกดปุ่มนำเข้า input ได้เฉพาะขั้น select-file กับ confirm · หลัง "ตกลง" ห้ามมี input อีก
//   9. HTTP: ฟิลด์เกิน/ขาด/ผิดชนิด · สาขา WH/ไม่รู้จัก/มี path · ขนาด body · Origin/Host/header เหมือนเส้นทางเดิม
//  10. ความลับ: รหัสผ่านและเนื้อไฟล์ (LOT/ราคา) ไม่หลุด log/ผลลัพธ์
//  11. โหมดซ่อนหน้าต่าง: จังหวะ 1/2 ไม่ใช้เมาส์หลังล็อกอิน · หน้าต่างถูกส่งไปหลังสุด/แสดงกลับเสมอ (แม้ล้ม)
//  12. HTTP จริงผ่าน socket (ข้ามกับหน้าเว็บที่ adjust-doc-promaxx-auto.spec.js)
//  13. อะแดปเตอร์ Windows: show_window_back ต้องไม่รีสตอร์หน้าต่างที่ขยายเต็มจอ (SW_SHOWNA ไม่ใช่ SW_SHOWNOACTIVATE) · ย่ออยู่ = SW_SHOWMINNOACTIVE · ไม่แย่งโฟกัส
//  14. หน้าต่างอื่นของ ProMaxx ค้างระหว่างนำเข้า (ป๊อปอัพเลือก Lot No. — เจอจริงตอนกดปุ่มจากหน้าเว็บ 5 พ.ย. 2026): รายงานสาเหตุจริง (UNEXPECTED_DIALOG ไม่ใช่ TABLE_MISMATCH)
//      · ตรวจก่อนอ่านตาราง/ก่อนประกาศว่าตรง/ก่อนรายงานไม่ตรง · ไม่กด ตกลง · ไม่แตะหน้าต่างนั้น · ข้อความไม่ถูกตัดที่หน้าเว็บ (_shortErr 70)
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const { runPy, startServer, request, POST_HEADERS, PROD } = require('../../lib/promaxx-helper-harness');

const PRE = String.raw`
import fake_ssmaxx_uia as fu, hashlib
from decimal import Decimal
_n = [0]
def mk(uia=None, settings=None, **fake):
    _n[0] += 1      # โฟลเดอร์ไฟล์นำเข้าแยกต่อการสร้างตัวช่วย — ไม่ให้ไฟล์ของสถานการณ์ก่อนหน้าปนมา
    sk = {"attach_existing": True, "hide_after_login": True, "import_dir": os.path.join(tmp, "imp%d" % _n[0])}
    sk.update(settings or {})
    svc, ui, log, st = fu.make_uia(m, tmp, verified=True, uia=uia, settings_kw=sk, **fake)
    return svc, ui, log, st
TEXT = "100593\t1\t242.25\t\t\t\t\t\t\t\r\n200379\t12\t\t\t\t\t\t\tLOT-A1\t31/12/2570\r\n"
def req(t, docno, **kw):
    r = {"proto": 1, "ticket": t, "type": "ORDS", "branch": "SRC", "docNo": docno, "rows": 2, "sha256": hashlib.sha256(TEXT.encode()).hexdigest(), "text": TEXT}
    r.update(kw)
    return r
def ph(call):
    try:
        return call()
    except m.HelperError as e:
        return ("ERR", e.code)
`;
const py = (body, payload) => runPy(PRE + body, payload);
const TEXT = '100593\t1\t242.25\t\t\t\t\t\t\t\r\n200379\t12\t\t\t\t\t\t\tLOT-A1\t31/12/2570\r\n';
const L = (sku, qty, price = '', lot = '', exp = '') => `${sku}\t${qty}\t${price}\t\t\t\t\t\t${lot}\t${exp}`;
// ความกว้างที่หน้าเว็บนับตอนตัดข้อความ (_shortErr ใน index.html: ไม่นับสระบน-ล่าง/วรรณยุกต์) — ข้อความจากตัวช่วยที่ยาวกว่า 70 จะถูกตัด "ส่วนท้ายซึ่งบอกว่าต้องทำอะไร"
const effLen = (s) => [...s].filter((c) => !/[ัิ-ฺ็-๎]/.test(c)).length;
// ข้อความต้องตรงกับที่ adjust-doc-promaxx-auto.spec.js ข้อ 6 ส่งผ่านหน้าเว็บ (สองไฟล์ถือสำเนาตัวอักษรเดียวกัน — แก้ที่ใดต้องแก้ทั้งคู่ + promaxx_helper.py MSG_*)
const LOT_POPUP_MSG = 'ProMaxx ขอให้เลือก Lot No. — ยังไม่บันทึก เลือกหรือกดออกเอง แล้วลองใหม่';
const EXTRA_WINDOW_MSG = (title) => `ProMaxx มีหน้าต่างอื่นค้าง (${title}) — ยังไม่บันทึก ปิดก่อนแล้วลองใหม่`;

test('1. ค่าที่ส่งมอบ — PROMAXX_AUTO_CONFIRM ปิดเป็นค่าเริ่มต้น · สาขายาเท่านั้น · เพดาน 20 แถว · เส้นทาง/ฟิลด์ที่รับ · ตรงกับหน้าเว็บ', () => {
  const r = py(String.raw`
import tempfile
b1 = os.path.join(tmp, 'a'); os.makedirs(b1)
open(os.path.join(b1, '.env'), 'w', encoding='utf-8').write('PROMAXX_AUTO_CONFIRM=true\nPROMAXX_IMPORT_DIR=' + os.path.join(tmp, 'imp') + '\n')
b2 = os.path.join(tmp, 'b'); os.makedirs(b2)
def s(env, base):
    return m.load_settings(base, environ=env)
print(json.dumps(dict(
    version=m.VERSION, proto=m.PROTO, ttl=m.TICKET_TTL, maxrows=m.IMPORT_MAX_ROWS, maxbody=m.MAX_IMPORT_BODY, keep=m.IMPORT_KEEP_DAYS, verified=m.LOCATORS_VERIFIED,
    branches=list(m.BRANCH_FORM_NAMES), names=dict(m.BRANCH_FORM_NAMES), imp=list(m.STEP_ORDER_IMPORT), prep=list(m.STEP_ORDER_PREPARE), post=list(m.POST_IMPORT_INPUT_STEPS),
    schemas={k: list(v) for k, v in m.REQUEST_SCHEMAS.items()}, dataclass_auto=m.Settings().auto_confirm,
    specs=sorted(m.STEP_SPECS), wh_name=m.WAREHOUSE_NAME,
    envs=dict(none=s({}, b2).auto_confirm, one=s({'PROMAXX_AUTO_CONFIRM': '1'}, b2).auto_confirm, off=s({'PROMAXX_AUTO_CONFIRM': 'off'}, b2).auto_confirm,
              junk=s({'PROMAXX_AUTO_CONFIRM': 'maybe'}, b2).auto_confirm, file=s({}, b1).auto_confirm, file_overridden=s({'PROMAXX_AUTO_CONFIRM': '0'}, b1).auto_confirm),
    import_dirs=dict(default=os.path.relpath(s({}, b2).import_dir, b2), env=os.path.relpath(s({}, b1).import_dir, tmp)),
), ensure_ascii=False))`);
  expect(r.version).toBe('2026-11-05.1');
  expect(r).toMatchObject({ proto: 1, ttl: 600, maxrows: 20, maxbody: 131072, keep: 30, verified: true, wh_name: 'Front Store' });
  expect(r.branches, 'สาขายาเท่านั้น — WH ไม่อยู่ในรายการ').toEqual(['SRC', 'KKL', 'SSS']);
  expect(r.names).toEqual({ SRC: 'อนิน สาขาแยกชากค้อ', KKL: 'อนิน สาขาเก้ากิโล', SSS: 'อนิน สาขาสวนเสือศรีราชา' });
  expect(r.imp).toEqual(['import-click', 'select-file', 'verify-table', 'confirm']);
  expect(r.prep.at(-1)).toBe('form-ready');
  expect(r.prep, 'จังหวะ 1 ไม่มีขั้นกดปุ่มนำเข้า').not.toContain('import-button');
  expect(r.post, 'หลังกดปุ่มนำเข้า ส่ง input ได้เฉพาะ 2 ขั้นนี้').toEqual(['select-file', 'confirm']);
  expect(r.schemas).toEqual({
    '/v1/open-import': ['proto', 'type'], '/v1/prepare-import': ['proto', 'type', 'branch'],
    '/v1/run-import': ['proto', 'ticket', 'type', 'branch', 'docNo', 'rows', 'sha256', 'text'], '/v1/cancel-import': ['proto', 'ticket'] });
  for (const k of [...r.imp, 'form-ready']) expect(r.specs, `ต้องมี spec ของขั้น ${k}`).toContain(k);
  expect(r.dataclass_auto, 'ค่าเริ่มต้นของ Settings = ไม่กด ตกลง').toBe(false);
  expect(r.envs, 'ไม่ตั้ง/ตั้งผิด/ปิด = ไม่กด ตกลง · 1/true = กด · ตัวแปรระบบชนะไฟล์').toEqual({ none: false, one: true, off: false, junk: false, file: true, file_overridden: false });
  expect(r.import_dirs).toEqual({ default: 'import', env: 'imp' });
  // ค่าคงที่ที่ต้องตรงกับหน้าเว็บ
  const html = fs.readFileSync(path.resolve(__dirname, '..', '..', '..', 'index.html'), 'utf8');
  expect(html).toMatch(/const PROMAXX_IMPORT_MAX_ROWS=20;/);
  expect(Number(html.match(/const PROMAXX_IMPORT_MAX_ROWS=(\d+);/)[1])).toBe(r.maxrows);
  expect(html, 'ตั๋วหมดอายุ 10 นาที = TICKET_TTL').toContain('(เกิน 10 นาที)');
});

test('2. ตรวจเนื้อไฟล์ (parse_import_text) — ผ่าน/ไม่ผ่านทุกเงื่อนไข + ขอบ · รับเฉพาะเลขอารบิก', () => {
  const rows = (n) => Array.from({ length: n }, (_, i) => L('S' + i, 1)).join('\r\n') + '\r\n';
  const CASES = [
    ['ถูกต้อง 2 แถว', TEXT, true], ['LF ล้วน', TEXT.replace(/\r\n/g, '\n'), true], ['ไม่มี newline ท้าย', TEXT.replace(/\r\n$/, ''), true],
    ['20 แถว', rows(20), true], ['21 แถว', rows(21), false], ['ว่าง', '', false], ['newline อย่างเดียว', '\r\n', false],
    ['จำนวน 0', L('A1', 0) + '\r\n', false], ['จำนวนติดลบ', L('A1', -1) + '\r\n', false], ['จำนวนทศนิยม 4 ตำแหน่ง', L('A1', '1.1234') + '\r\n', true],
    ['จำนวนทศนิยม 5 ตำแหน่ง', L('A1', '1.12345') + '\r\n', false], ['จำนวน 9 หลัก', L('A1', '123456789') + '\r\n', true], ['จำนวน 10 หลัก', L('A1', '1234567890') + '\r\n', false],
    ['จำนวนมี 0 นำหน้า', L('A1', '00012') + '\r\n', true], ['จำนวนเป็นข้อความ', L('A1', 'abc') + '\r\n', false], ['จำนวนมีคอมมา', L('A1', '1,000') + '\r\n', false],
    ['จำนวนยกกำลัง', L('A1', '1e3') + '\r\n', false], ['จำนวนเลขไทย', L('A1', '๑๒') + '\r\n', false], ['จำนวนเลขอาหรับ-อินเดีย', L('A1', '١٢') + '\r\n', false],
    ['จำนวนเลขเต็มความกว้าง', L('A1', '１２') + '\r\n', false], ['จำนวนมีช่องว่าง', L('A1', ' 1') + '\r\n', false],
    ['ราคาว่าง', L('A1', 1, '') + '\r\n', true], ['ราคา 4 ทศนิยม', L('A1', 1, '99999.9999') + '\r\n', true], ['ราคา 5 ทศนิยม', L('A1', 1, '12.34567') + '\r\n', false], ['ราคาเป็นข้อความ', L('A1', 1, 'x') + '\r\n', false],
    ['SKU มีขีด/จุด/ขีดล่าง', L('AB-1.2_3', 1) + '\r\n', true], ['SKU 30 ตัว', L('x'.repeat(30), 1) + '\r\n', true], ['SKU 31 ตัว', L('x'.repeat(31), 1) + '\r\n', false],
    ['SKU ว่าง', L('', 1) + '\r\n', false], ['SKU ขึ้นต้นด้วยขีด', L('-A', 1) + '\r\n', false], ['SKU มีช่องว่าง', L('A B', 1) + '\r\n', false], ['SKU ภาษาไทย', L('ก', 1) + '\r\n', false],
    ['LOT 40 ตัว', L('A1', 1, '', 'a'.repeat(40)) + '\r\n', true], ['LOT 41 ตัว', L('A1', 1, '', 'a'.repeat(41)) + '\r\n', false], ['LOT ไทย', L('A1', 1, '', 'ล็อต ๑') + '\r\n', true],
    ['LOT มีอักขระควบคุม', L('A1', 1, '', 'A\u0007B') + '\r\n', false], ['LOT มี DEL', L('A1', 1, '', 'A\u007fB') + '\r\n', false],
    ['EXP ถูกต้อง', L('A1', 1, '', '', '31/12/2570') + '\r\n', true], ['EXP รูปแบบผิด', L('A1', 1, '', '', '2027-12-31') + '\r\n', false], ['EXP ปีสองหลัก', L('A1', 1, '', '', '31/12/27') + '\r\n', false],
    ['EXP เลขไทย', L('A1', 1, '', '', '๓๑/๑๒/๒๕๗๐') + '\r\n', false],
    ['SKU ซ้ำ', L('A1', 1) + '\r\n' + L('A1', 2) + '\r\n', false], ['9 ช่อง', L('A1', 1).split('\t').slice(0, 9).join('\t') + '\r\n', false], ['11 ช่อง', L('A1', 1) + '\t\r\n', false],
    ['คอลัมน์กลางไม่ว่าง', ['A1', '1', '', 'x', '', '', '', '', '', ''].join('\t') + '\r\n', false], ['มี NUL', L('A1', 1) + '\u0000\r\n', false],
    ['ปิดท้ายด้วยขยะ', TEXT + 'zzz', false], ['CR เดี่ยว', TEXT.replace(/\r\n/g, '\r'), false], ['ใหญ่เกิน 128 KB', 'x'.repeat(131073), false],
  ];
  const r = py(String.raw`
out = []
for label, text in p['cases']:
    try:
        rows = m.parse_import_text(text); out.append([label, True, len(rows)])
    except m.HelperError as e:
        out.append([label, False, e.code])
print(json.dumps(out, ensure_ascii=False))`, { cases: CASES.map(([l, t]) => [l, t]) });
  expect(r.length).toBe(CASES.length);
  for (const [i, [label, , want]] of CASES.entries()) {
    expect(r[i][1], `${label} → ${JSON.stringify(r[i])}`).toBe(want);
    if (!want) expect(r[i][2], label).toBe('FILE_INVALID');
  }
  expect(r[0][2], 'อ่านครบ 2 แถว').toBe(2);
  // ค่าที่อ่านได้: จำนวนเป็น Decimal (เทียบกับตารางด้วยค่าตัวเลข ไม่ใช่ข้อความ)
  const v = py(String.raw`
rows = m.parse_import_text(TEXT)
print(json.dumps([[r['sku'], str(r['qty']), None if r['price'] is None else str(r['price']), r['lot'], r['exp']] for r in rows], ensure_ascii=False))`);
  expect(v).toEqual([['100593', '1', '242.25', '', ''], ['200379', '12', null, 'LOT-A1', '31/12/2570']]);
});

test('3. เลขที่เอกสาร · ชื่อไฟล์ · เขียนไฟล์ (ไม่ทับ · ไบต์ตรง · ไม่มี BOM) · ลบไฟล์เก่าเฉพาะชื่อของเรา', () => {
  const r = py(String.raw`
import time
good = m.safe_doc_no(' ordsby001261100001 ')
bad = {}
for s in ['', 'ABC', 'ORDS', 'ORDS12345', 'ORDS../x', 'ORDS 123456', 'ORCMBY001261100001', 'ORDS' + 'A' * 31, 'ORDSBY00126110000€', 'ORDSBY0012611/0001', None]:
    bad[str(s)] = ph(lambda s=s: m.safe_doc_no(s))
name = m.import_file_name('ORDS', 'ORDSBY001261100001', now=1767225600)
name_bad = ph(lambda: m.import_file_name('ORDS', '../../evil'))
d = os.path.join(tmp, 'imp')
p1 = m.write_import_file(d, 'ORDS', 'ORDSBY001261100001', TEXT, now=1767225600)
p2 = m.write_import_file(d, 'ORDS', 'ORDSBY001261100001', TEXT + 'X', now=1767225600)
p3 = m.write_import_file(d, 'ORDS', 'ORDSBY001261100001', TEXT, now=1767225600)
data1 = open(p1, 'rb').read(); data2 = open(p2, 'rb').read()
blocker = os.path.join(tmp, 'afile'); open(blocker, 'w').write('x')
no_dir = ph(lambda: m.write_import_file(os.path.join(blocker, 'sub'), 'ORDS', 'ORDSBY001261100001', TEXT))
# ชนครบ 21 ชื่อ → ล้มอย่างปลอดภัย (ไม่ทับไฟล์ใดๆ)
d2 = os.path.join(tmp, 'imp2')
for _ in range(21):
    m.write_import_file(d2, 'IRPS', 'IRPSBY001261100009', TEXT, now=1767225600)
full = ph(lambda: m.write_import_file(d2, 'IRPS', 'IRPSBY001261100009', TEXT, now=1767225600))
# ลบไฟล์เก่า
old = time.time() - 40 * 86400
mine_old = os.path.join(d, 'stockadj_ords_ORDSBY001261100001_01-01-2020_010101.txt'); open(mine_old, 'w').write('x'); os.utime(mine_old, (old, old))
mine_new = os.path.join(d, 'stockadj_irps_IRPSBY001261100002_01-01-2026_010101.txt'); open(mine_new, 'w').write('x')
other_old = os.path.join(d, 'notes.txt'); open(other_old, 'w').write('x'); os.utime(other_old, (old, old))
fake_old = os.path.join(d, 'stockadj_ords_x.txt'); open(fake_old, 'w').write('x'); os.utime(fake_old, (old, old))
subdir = os.path.join(d, 'stockadj_ords_ORDSBY001261100003_01-01-2020_010101.txt'); os.makedirs(subdir); os.utime(subdir, (old, old))
m.prune_import_dir(d)
left = sorted(os.listdir(d))
m.prune_import_dir(os.path.join(tmp, 'does-not-exist'))      # ต้องไม่โยนข้อผิดพลาด
print(json.dumps(dict(good=good, bad=bad, name=name, name_bad=name_bad, files=[os.path.basename(x) for x in (p1, p2, p3)],
    bytes_equal=(data1 == TEXT.encode('utf-8')), bom=data1[:3] == b'\xef\xbb\xbf', crlf=b'\r\n' in data1, second_kept_own=(data2 == (TEXT + 'X').encode('utf-8')),
    no_dir=no_dir, full=full, left=left), ensure_ascii=False))`);
  expect(r.good).toBe('ORDSBY001261100001');
  for (const k of ['', 'ABC', 'ORDS', 'ORDS12345', 'ORDS../x', 'ORDS 123456', 'ORCMBY001261100001', 'ORDS' + 'A'.repeat(31), 'ORDSBY00126110000€', 'ORDSBY0012611/0001', 'None']) expect(r.bad[k], `เลขที่ ${k}`).toEqual(['ERR', 'BAD_REQUEST']);
  expect(r.name).toMatch(/^stockadj_ords_ORDSBY001261100001_\d{2}-\d{2}-\d{4}_\d{6}\.txt$/);
  expect(r.name_bad, 'ชื่อไฟล์ประกอบจากเลขที่ที่ตรวจแล้วเท่านั้น — พาธไม่ผ่าน').toEqual(['ERR', 'BAD_REQUEST']);
  expect(r.files[1]).toBe(r.files[0].replace(/\.txt$/, '_1.txt'));
  expect(r.files[2]).toBe(r.files[0].replace(/\.txt$/, '_2.txt'));
  expect(r).toMatchObject({ bytes_equal: true, bom: false, crlf: true, second_kept_own: true });
  expect(r.no_dir).toEqual(['ERR', 'STEP_FAILED']);
  expect(r.full, 'ชื่อชนครบ 21 → ล้มโดยไม่ทับ').toEqual(['ERR', 'STEP_FAILED']);
  expect(r.left, 'ลบเฉพาะไฟล์ชื่อของเราที่เก่ากว่า 30 วัน — ไฟล์อื่น/ไฟล์ใหม่/โฟลเดอร์ไม่แตะ').toEqual([
    'notes.txt', 'stockadj_ords_ORDSBY001261100001_' + r.files[0].split('_').slice(3).join('_'), 'stockadj_ords_ORDSBY001261100001_' + r.files[0].split('_').slice(3).join('_').replace(/\.txt$/, '_1.txt'),
    'stockadj_ords_ORDSBY001261100001_' + r.files[0].split('_').slice(3).join('_').replace(/\.txt$/, '_2.txt'), 'stockadj_ords_ORDSBY001261100003_01-01-2020_010101.txt', 'stockadj_ords_x.txt',
    'stockadj_irps_IRPSBY001261100002_01-01-2026_010101.txt'].sort());
});

test('4. อ่านตารางจาก UIA + เทียบกับไฟล์ — ปกติ · เซลล์ซ้ำ · กำกวม · แถวกำพร้า · ทุกความไม่ตรง', () => {
  const r = py(String.raw`
def L(id_, name):
    return '    Custom id=%s name="%s" cls=DWTextBlock rect=(1,2,3,4) off=0' % (id_, name)
def dump(rows, total='13.00', extra=()):
    out = []
    for n, (sku, q) in enumerate(rows, 1):
        out += [L('CF_ITEMID:%d' % n, sku), L('QUANTITY:%d' % n, q), L('PRICE:%d' % n, '10.00'), L('AMOUNT:%d' % n, '10.00'), L('ITEMNAME:%d' % n, 'สินค้า ' + sku), L('SYSUNITID:%d' % n, 'กล่อง')]
    out += [L('CF_ITEMID:%d' % (len(rows) + 1), ''), L('QUANTITY:%d' % (len(rows) + 1), '.00'), L('AMOUNT:%d' % (len(rows) + 1), '.00')]
    if total is not None:
        out.append(L('CF_TOTALQUANTITY:1', total))
    return out + list(extra)
exp = m.parse_import_text(TEXT)
def chk(lines):
    t = m.parse_detail_dump(lines)
    return dict(rows={k: [v['sku'], str(v['qty'])] for k, v in t['rows'].items()}, total=None if t['total_qty'] is None else str(t['total_qty']),
                amb=t['ambiguous'], orph=t['orphans'], problems=m.compare_table(exp, t))
good = [('100593', '1.00'), ('200379', '12.00')]
cases = {
  'ok': chk(dump(good)),
  'hidden_dup_empty': chk(dump(good, extra=[L('CF_ITEMID:1', ''), L('QUANTITY:1', '')])),
  'dup_same_value': chk(dump(good, extra=[L('CF_ITEMID:1', '100593')])),
  'dup_conflict': chk(dump(good, extra=[L('CF_ITEMID:1', '999999')])),
  'orphan_qty': chk(dump(good, extra=[L('QUANTITY:7', '5.00')])),
  'orphan_blank_row_ok': chk(dump(good)),
  'qty_mismatch': chk(dump([('100593', '2.00'), ('200379', '12.00')], total='14.00')),
  'missing_sku': chk(dump([('100593', '1.00')], total='1.00')),
  'extra_sku': chk(dump(good + [('111111', '1.00')], total='14.00')),
  'dup_sku': chk(dump(good + [('100593', '1.00')], total='14.00')),
  'wrong_sku': chk(dump([('100593', '1.00'), ('200380', '12.00')])),
  'total_mismatch': chk(dump(good, total='14.00')),
  'total_missing': chk(dump(good, total=None)),
  'total_conflict': chk(dump(good, extra=[L('CF_TOTALQUANTITY:1', '99.00')])),
  'gap_rows': chk([L('CF_ITEMID:1', '100593'), L('QUANTITY:1', '1.00'), L('CF_ITEMID:3', '200379'), L('QUANTITY:3', '12.00'), L('CF_TOTALQUANTITY:1', '13.00')]),
  'empty': chk([]),
  'thousands': chk(dump([('100593', '1.00'), ('200379', '12.00')], total='13.00')),
}
print(json.dumps(cases, ensure_ascii=False))`);
  expect(r.ok.problems).toEqual([]);
  expect(r.ok.rows).toEqual({ 1: ['100593', '1.00'], 2: ['200379', '12.00'] });
  expect(r.ok.total).toBe('13.00');
  expect(r.ok.orph, 'แถวว่างท้ายตาราง (จำนวน .00) ปกติ — ไม่นับเป็นแถวกำพร้า').toEqual([]);
  expect(r.hidden_dup_empty.problems, 'ชุดเซลล์ซ้ำที่ซ่อนอยู่ (ค่าว่าง) ไม่รบกวน').toEqual([]);
  expect(r.dup_same_value.problems).toEqual([]);
  expect(r.dup_conflict.amb).toEqual(['CF_ITEMID:1']);
  expect(r.dup_conflict.problems.join('|')).toContain('อ่านตารางไม่ชัดเจน');
  expect(r.orphan_qty.orph).toHaveLength(1);
  expect(r.orphan_qty.problems.join('|')).toContain('มีจำนวน แต่ไม่มีรหัสสินค้า');
  expect(r.qty_mismatch.problems.join('|')).toMatch(/SKU 100593 จำนวนในตาราง 2\.00 ≠ ไฟล์ 1/);
  expect(r.qty_mismatch.problems.join('|')).toMatch(/ยอดรวมจำนวน 14\.00 ≠ ไฟล์ 13/);
  expect(r.missing_sku.problems.join('|')).toMatch(/จำนวนแถวในตาราง 1 ≠ ไฟล์ 2/);
  expect(r.missing_sku.problems.join('|')).toMatch(/SKU 200379 ไม่อยู่ในตาราง/);
  expect(r.extra_sku.problems.join('|')).toMatch(/จำนวนแถวในตาราง 3 ≠ ไฟล์ 2/);
  expect(r.extra_sku.problems.join('|')).toMatch(/มี SKU เกินในตาราง: 111111/);
  expect(r.dup_sku.problems.join('|')).toMatch(/SKU 100593 ซ้ำในตาราง/);
  expect(r.wrong_sku.problems.join('|')).toMatch(/SKU 200379 ไม่อยู่ในตาราง/);
  expect(r.wrong_sku.problems.join('|')).toMatch(/มี SKU เกินในตาราง: 200380/);
  expect(r.total_mismatch.problems.join('|')).toMatch(/ยอดรวมจำนวน 14\.00 ≠ ไฟล์ 13/);
  expect(r.total_missing.problems.join('|')).toContain('อ่านยอดรวมจำนวนในตารางไม่ได้');
  expect(r.total_conflict.amb).toContain('CF_TOTALQUANTITY:1');
  expect(r.gap_rows.problems.join('|')).toContain('เลขแถวในตารางไม่ต่อเนื่อง');
  expect(r.empty.problems.join('|')).toMatch(/จำนวนแถวในตาราง 0 ≠ ไฟล์ 2/);
});

// ─── 5. สองจังหวะสำเร็จ ─────────────────────────────────────────────────────────────────────────────
const TWO = String.raw`
def two(settings=None, uia=None, **fake):
    svc, ui, log, st = mk(uia, settings, **fake)
    s1, b1 = svc.run_prepare_job("ORDS", "SRC")
    mid = dict(ok_clicks=ui.ok_clicks, files=sorted(os.listdir(st.import_dir)) if os.path.isdir(st.import_dir) else [], ticket=bool(svc.ticket), table=len(ui.table), hidden=ui.hidden, at_back=ui.at_back)
    n0 = len(ui.calls)
    s2, b2 = svc.run_import_job(req(b1["ticket"], b1["docNo"])) if b1.get("ok") else (None, None)
    files = sorted(os.listdir(st.import_dir)) if os.path.isdir(st.import_dir) else []
    data = open(os.path.join(st.import_dir, files[0]), "rb").read() if files else b""
    acts = [(c[0], (c[4][0] if c[4] else "?")) if c[0] == "uia_act" else (c[0],) for c in ui.calls[n0:] if c[0] in ("uia_act", "set_text", "click_button", "click_at", "type_text", "focus", "show_window", "show_window_back", "hide_window")]
    return dict(s1=s1, b1=b1, mid=mid, s2=s2, b2=b2, ok_clicks=ui.ok_clicks, saved=[[ [r["sku"], r["qty"]] for r in t] for t in ui.saved], table=[[r["sku"], r["qty"]] for r in ui.table],
                misfires=ui.misfires, files=files, file_bytes_equal=(data == TEXT.encode("utf-8")), file_bom=data[:3] == b"\xef\xbb\xbf", hidden=ui.hidden, at_back=ui.at_back,
                acts=acts, ticket_after=bool(svc.ticket), log="\n".join(log.lines), health=svc.health(), loaded=ui.file_loaded)
`;

test('5. ★ สองจังหวะสำเร็จ — เริ่มจากปิดโปรแกรม/ใช้เซสชันค้าง · PROMAXX_AUTO_CONFIRM ปิด (หยุดก่อน ตกลง) / เปิด (กด ตกลง ครั้งเดียว)', () => {
  const r = py(TWO + String.raw`
print(json.dumps(dict(
    cold_off=two(start_state="closed"),
    cold_on=two(settings={"auto_confirm": True}, start_state="closed"),
    attach_on=two(settings={"auto_confirm": True}, start_state="main"),
), ensure_ascii=False, default=str))`);
  for (const [label, k] of [['เริ่มจากปิดโปรแกรม · ปิด AUTO_CONFIRM', 'cold_off'], ['เริ่มจากปิดโปรแกรม · เปิด AUTO_CONFIRM', 'cold_on'], ['ใช้เซสชันค้าง · เปิด AUTO_CONFIRM', 'attach_on']]) {
    const x = r[k], on = k !== 'cold_off';
    // จังหวะ 1
    expect(x.s1, label).toBe(200);
    expect(x.b1, label).toMatchObject({ ok: true, proto: 1, stage: 'prepared', type: 'ORDS', branch: 'SRC', docNo: 'ORDSBY001261100001', expiresInSec: 600, autoConfirm: on });
    expect(x.b1.ticket, label).toMatch(/^[A-Za-z0-9_-]{24,}$/);
    expect(x.mid, `${label}: จังหวะ 1 ยังไม่กดนำเข้า/ไม่ตกลง/ไม่เขียนไฟล์`).toMatchObject({ ok_clicks: 0, files: [], ticket: true, table: 0, hidden: false });
    expect(x.mid.at_back, `${label}: หน้าต่าง ProMaxx ถูกส่งไปหลังสุด (เบราว์เซอร์ของพนักงานอยู่หน้า)`).toBe(true);
    // จังหวะ 2
    expect(x.s2, label).toBe(200);
    expect(x.b2, label).toMatchObject({ ok: true, stage: 'imported', type: 'ORDS', branch: 'SRC', docNo: 'ORDSBY001261100001', rows: 2, confirmed: on });
    expect(x.misfires, `${label}: ปุ่มอื่นของแถบปุ่มต้องไม่ถูกกด`).toEqual([]);
    expect(x.files, label).toHaveLength(1);
    expect(x.file_bytes_equal, `${label}: ไฟล์ = เนื้อที่ส่งทุกไบต์`).toBe(true);
    expect(x.file_bom).toBe(false);
    expect(x.ticket_after, 'ตั๋วถูกใช้แล้ว').toBe(false);
    if (on) {
      expect(x.ok_clicks, `${label}: กด ตกลง ครั้งเดียว`).toBe(1);
      expect(x.saved, 'ตารางที่บันทึก = ไฟล์').toEqual([[['100593', 1], ['200379', 12]]]);
      expect(x.b2.after).toMatchObject({ saved: true, tableEmpty: true });
      expect(x.acts.filter((a) => a[0] === 'uia_act').map((a) => a[1]), 'ลำดับสิ่งที่สั่ง: ปุ่มนำเข้า → (set_text/Open) → ตกลง').toEqual(['uo_tran_bt_import', 'cb_ok']);
    } else {
      expect(x.ok_clicks, `${label}: ไม่กด ตกลง`).toBe(0);
      expect(x.table, 'ตารางโหลดครบ รอพนักงานตรวจ').toEqual([['100593', 1], ['200379', 12]]);
      expect(x.at_back, 'หยุดก่อน ตกลง = ดึง ProMaxx ขึ้นหน้าให้พนักงานตรวจ').toBe(false);
      expect(x.acts.filter((a) => a[0] === 'uia_act').map((a) => a[1])).toEqual(['uo_tran_bt_import']);
    }
    expect(x.acts.filter((a) => a[0] === 'set_text' || a[0] === 'click_button').map((a) => a[0]), 'ใส่ชื่อไฟล์ผ่านข้อความ Windows แล้วกด Open — ไม่ใช้เมาส์/คีย์บอร์ดในจังหวะ 2').toEqual(['set_text', 'click_button']);
    expect(x.acts.filter((a) => a[0] === 'click_at' || a[0] === 'type_text'), `${label}: จังหวะ 2 ห้ามใช้เมาส์/พิมพ์`).toEqual([]);
  }
  expect(r.cold_off.b1.hidden, 'ล็อกอินเสร็จแล้วซ่อนหน้าต่างระหว่างสั่งด้วย UIA').toBe(true);
  expect(r.attach_on.b1.attached).toBe('ready');
  expect(r.cold_on.health).toMatchObject({ autoImport: true, autoConfirm: true, branches: ['SRC', 'KKL', 'SSS'] });
  expect(r.cold_off.health.autoConfirm).toBe(false);
});

// ─── 6. ความผิดปกติทุกแบบ ─────────────────────────────────────────────────────────────────────────────
const NEG = String.raw`
BETWEEN = {
    "seq": lambda ui, svc: setattr(ui, "number_seq", 5),
    "rows": lambda ui, svc: ui.table.append({"sku": "111111", "name": "x", "unit": "กล่อง", "qty": 1.0, "price": 5.0}),
    "pid": lambda ui, svc: setattr(ui, "PID", 9999),
    "dialog": lambda ui, svc: setattr(ui, "dialogs_now", [("SeniorSoft ProMaxx", ("something",))]),
}
MUT = {
    "hash": lambda r: dict(r, sha256="0" * 64), "rows": lambda r: dict(r, rows=3),
    "text": lambda r: dict(r, text="x\ty\r\n", sha256=hashlib.sha256(b"x\ty\r\n").hexdigest(), rows=1),
    "ticket": lambda r: dict(r, ticket="nope"), "type": lambda r: dict(r, type="IRPS"), "docno": lambda r: dict(r, docNo="ORDSBY001261100009"),
}
def neg(c):
    svc, ui, log, st = mk(c.get("uia"), c.get("settings"), **(c.get("fake") or {}))
    s1, b1 = svc.run_prepare_job("ORDS", "SRC")
    if not b1.get("ok"):
        return dict(phase="prepare", status=s1, code=b1.get("code"), step=b1.get("step"), ok_clicks=ui.ok_clicks, misfires=ui.misfires,
                    acts=[(x[0] if x[0] != "uia_act" else "act:" + (x[4][0] if x[4] else "?")) for x in ui.calls if x[0] in ("uia_act", "set_text", "click_button")], ticket=bool(svc.ticket), files=[])
    if c.get("between"):
        BETWEEN[c["between"]](ui, svc)
    r = req(b1["ticket"], b1["docNo"])
    if c.get("mut"):
        r = MUT[c["mut"]](r)
    n0 = len(ui.calls)
    s2, b2 = svc.run_import_job(r)
    acts = [(x[0] if x[0] != "uia_act" else "act:" + (x[4][0] if x[4] else "?")) for x in ui.calls[n0:] if x[0] in ("uia_act", "set_text", "click_button")]
    files = sorted(os.listdir(st.import_dir)) if os.path.isdir(st.import_dir) else []
    return dict(phase="import", status=s2, code=b2.get("code"), step=b2.get("step"), ok=b2.get("ok"), ok_clicks=ui.ok_clicks, misfires=ui.misfires, acts=acts,
                ticket=bool(svc.ticket), files=files, table=len(ui.table), msg=b2.get("message", ""), hidden=ui.hidden, at_back=ui.at_back,
                has_ui_input=any(x[0] in ("click_at", "type_text") for x in ui.calls[n0:]), popup=ui.popup)
print(json.dumps([neg(c) for c in p["cases"]], ensure_ascii=False, default=str))
`;
const A = { auto_confirm: true };
const NEG_CASES = [
  // [label, case, expected]
  ['ฟอร์มเป็นของสาขาอื่น (เก้ากิโล) แต่สั่ง SRC', { uia: { branch_name: 'อนิน สาขาเก้ากิโล' }, settings: A }, { phase: 'prepare', status: 500, code: 'PRECONDITION_FAILED', clicksNone: true }],
  ['เลขที่ในฟอร์มไม่ขึ้นต้นด้วยรหัสประเภท (ฟอร์มค้างเลขที่ของชนิดอื่น)', { uia: { number_stuck: 'ORCM' }, settings: A }, { phase: 'prepare', status: 500, code: 'PRECONDITION_FAILED', clicksNone: true }],
  ['เลขที่เอกสารเปลี่ยนระหว่างจังหวะ (มีคนบันทึกคั่น)', { settings: A, between: 'seq' }, { status: 500, code: 'PRECONDITION_FAILED', step: 'import-click', acts: [] }],
  ['ตารางมีรายการค้างก่อนนำเข้า', { settings: A, between: 'rows' }, { status: 500, code: 'PRECONDITION_FAILED', step: 'import-click', acts: [] }],
  ['WM_SETTEXT ไม่มีผล (ช่องไม่รับข้อความ)', { settings: A, uia: { settext_noop: true } }, { status: 500, code: 'STEP_FAILED', step: 'select-file', noOpen: true }],
  ['อ่านกลับได้ข้อความไม่ตรงที่ใส่', { settings: A, uia: { gettext_mismatch: true } }, { status: 500, code: 'STEP_FAILED', step: 'select-file', noOpen: true }],
  ['ไม่พบช่อง File name', { settings: A, uia: { dlg_no_edit: true } }, { status: 500, code: 'LOCATOR_NOT_FOUND', step: 'select-file', noSetText: true }],
  ['พบช่อง File name 2 ช่อง', { settings: A, uia: { dlg_dup_edit: true } }, { status: 500, code: 'LOCATOR_NOT_UNIQUE', step: 'select-file', noSetText: true }],
  ['ช่อง File name ใช้งานไม่ได้', { settings: A, uia: { dlg_edit_disabled: true } }, { status: 500, code: 'LOCATOR_NOT_FOUND', step: 'select-file', noSetText: true }],
  ['กด Open แล้วกล่องไม่ปิด', { settings: A, uia: { open_no_effect: true } }, { status: 500, code: 'POSTCONDITION_FAILED', step: 'select-file' }],
  ['ProMaxx แสดงกล่องข้อความหลังเปิดไฟล์', { settings: A, uia: { open_error_dialog: 'รูปแบบไฟล์ไม่ถูกต้อง' } }, { status: 500, code: 'UNEXPECTED_DIALOG', step: 'verify-table' }],
  // ★ เจอจริง 5 พ.ย. 2026: Lot ในไฟล์ไม่มียอดคงเหลือ → ProMaxx เปิดป๊อปอัพเลือก Lot No. (หน้าต่างระดับบนใหม่ ไม่ใช่ #32770 · หน้าต่างหลักยัง enabled · แถวยังไม่ถูกเพิ่ม)
  //   เดิมรายงาน TABLE_MISMATCH (ทำให้เข้าใจผิดว่าตารางพัง) → ต้องรายงาน UNEXPECTED_DIALOG ที่บอกสาเหตุ · ปล่อยป๊อปอัพไว้ให้พนักงาน · ไม่กด ตกลง แม้ PROMAXX_AUTO_CONFIRM เปิด
  ['ProMaxx เปิดป๊อปอัพเลือก Lot No. หลัง Open (แถวยังไม่ถูกเพิ่ม)', { settings: A, uia: { open_popup_window: 'lot' } }, { status: 500, code: 'UNEXPECTED_DIALOG', step: 'verify-table', msg: LOT_POPUP_MSG, effMax: 70, popup: 'lot' }],
  ['ProMaxx เปิดป๊อปอัพอื่น (ไม่ใช่ Lot No.) หลัง Open', { settings: A, uia: { open_popup_window: 'other' } }, { status: 500, code: 'UNEXPECTED_DIALOG', step: 'verify-table', msg: EXTRA_WINDOW_MSG('Another popup'), effMax: 70, popup: 'other' }],
  ['อ่านโครงป๊อปอัพไม่ได้ → รายงานแบบทั่วไป (ไม่บังสาเหตุจริง)', { settings: A, uia: { open_popup_window: 'lot', popup_dump_fails: true } }, { status: 500, code: 'UNEXPECTED_DIALOG', step: 'verify-table', msg: EXTRA_WINDOW_MSG('sfw_winrespond'), effMax: 70, popup: 'lot' }],
  ['ป๊อปอัพ Lot No. โผล่ระหว่างอ่านตาราง ทั้งที่ตารางตรงไฟล์ครบ (ห้ามประกาศว่าพร้อม)', { settings: A, uia: { popup_after_dumps: 1 } }, { status: 500, code: 'UNEXPECTED_DIALOG', step: 'verify-table', msg: LOT_POPUP_MSG, popup: 'lot' }],
  ['ป๊อปอัพ Lot No. โผล่ระหว่างอ่านตารางครั้งที่ 2 ที่ตารางยังว่าง (ห้ามรายงาน TABLE_MISMATCH)', { settings: A, uia: { open_slow: 10, popup_after_dumps: 2 } }, { status: 500, code: 'UNEXPECTED_DIALOG', step: 'verify-table', msg: LOT_POPUP_MSG, popup: 'lot' }],
  ['ป๊อปอัพ Lot No. หลัง Open โดยไม่เปิด PROMAXX_AUTO_CONFIRM (พนักงานกด ตกลง เอง)', { uia: { open_popup_window: 'lot' } }, { status: 500, code: 'UNEXPECTED_DIALOG', step: 'verify-table', msg: LOT_POPUP_MSG, popup: 'lot' }],
  ['ตารางจำนวนแถวแรกเพี้ยน', { settings: A, uia: { open_wrong_qty: true } }, { status: 422, code: 'TABLE_MISMATCH', step: 'verify-table' }],
  ['ตารางโหลดไม่ครบ (1 จาก 2)', { settings: A, uia: { open_loads_partial: 1 } }, { status: 422, code: 'TABLE_MISMATCH', step: 'verify-table' }],
  ['ตารางมีแถวเกิน', { settings: A, uia: { open_extra_row: true } }, { status: 422, code: 'TABLE_MISMATCH', step: 'verify-table' }],
  ['ตารางมีแถวซ้ำ', { settings: A, uia: { open_dup_row: true } }, { status: 422, code: 'TABLE_MISMATCH', step: 'verify-table' }],
  ['ตารางโหลดช้า 10 วินาที (เกินที่รอ)', { settings: A, uia: { open_slow: 10 } }, { status: 422, code: 'TABLE_MISMATCH', step: 'verify-table' }],
  ['ตารางโหลดช้า 1.5 วินาที (อ่านซ้ำแล้วผ่าน)', { settings: A, uia: { open_slow: 1.5 } }, { status: 200, ok: true, ok_clicks: 1 }],
  ['กด ตกลง แล้วฟอร์มไม่เปลี่ยน (ผลไม่แน่ชัด)', { settings: A, uia: { confirm_mode: 'keep' } }, { status: 500, code: 'CONFIRM_UNKNOWN', step: 'confirm', ok_clicks: 1 }],
  ['กด ตกลง แล้วมีกล่องข้อความ (ผลไม่แน่ชัด)', { settings: A, uia: { confirm_mode: 'dialog' } }, { status: 500, code: 'CONFIRM_UNKNOWN', step: 'confirm', ok_clicks: 1 }],
  ['hash ไม่ตรง', { settings: A, mut: 'hash' }, { status: 422, code: 'FILE_INVALID', step: 'preflight', acts: [], ticket: true }],
  ['จำนวนแถวที่แจ้งไม่ตรง', { settings: A, mut: 'rows' }, { status: 422, code: 'FILE_INVALID', step: 'preflight', acts: [], ticket: true }],
  ['เนื้อไฟล์ผิดรูปแบบ', { settings: A, mut: 'text' }, { status: 422, code: 'FILE_INVALID', acts: [], ticket: true }],
  ['ตั๋วไม่ถูกต้อง', { settings: A, mut: 'ticket' }, { status: 409, code: 'TICKET_INVALID', acts: [], ticket: true }],
  ['ชนิดไม่ตรงตั๋ว', { settings: A, mut: 'type' }, { status: 409, code: 'TICKET_INVALID', acts: [], ticket: true }],
  ['เลขที่ไม่ตรงตั๋ว', { settings: A, mut: 'docno' }, { status: 409, code: 'TICKET_INVALID', acts: [], ticket: true }],
  ['ProMaxx ถูกปิด/เปิดใหม่ระหว่างจังหวะ', { settings: A, between: 'pid' }, { status: 409, code: 'STATE_CHANGED', step: 'preflight', acts: [] }],
  ['มีกล่องข้อความค้างระหว่างจังหวะ', { settings: A, between: 'dialog' }, { status: 409, code: 'SESSION_NOT_READY', step: 'preflight', acts: [] }],
];

test('6. ★ ความผิดปกติทุกแบบ → หยุดก่อน ตกลง · ไม่ใช้ปุ่มอื่นของแถบปุ่ม · รหัส/ขั้นถูก · ไม่แตะ ProMaxx เมื่อปัญหาอยู่ที่คำขอ', () => {
  const out = py(NEG, { cases: NEG_CASES.map(([, c]) => c) });
  expect(out.length).toBe(NEG_CASES.length);
  for (const [i, [label, , want]] of NEG_CASES.entries()) {
    const x = out[i];
    const why = `${label} → ${JSON.stringify({ phase: x.phase, status: x.status, code: x.code, step: x.step, acts: x.acts, ok_clicks: x.ok_clicks })}`;
    expect(x.misfires, `${label}: ปุ่มอื่นของแถบปุ่มถูกกด`).toEqual([]);
    expect(x.status, why).toBe(want.status);
    if (want.phase) expect(x.phase, why).toBe(want.phase);
    else expect(x.phase, why).toBe('import');
    if (want.code) expect(x.code, why).toBe(want.code);
    if (want.step) expect(x.step, why).toBe(want.step);
    if (want.ok) expect(x.ok, why).toBe(true);
    // กด "ตกลง" ได้เฉพาะ 3 กรณี: สำเร็จ · ผลไม่แน่ชัด (ครั้งเดียว) — ที่เหลือต้อง 0 เสมอ
    expect(x.ok_clicks, `${label}: จำนวนครั้งที่กด ตกลง`).toBe(want.ok_clicks ?? 0);
    if (want.acts) expect(x.acts, `${label}: ต้องไม่แตะ ProMaxx`).toEqual(want.acts);
    if (want.ticket !== undefined) expect(x.ticket, `${label}: ตั๋ว`).toBe(want.ticket);
    if (want.noOpen) expect(x.acts, `${label}: ไม่กด Open`).not.toContain('click_button');
    if (want.noSetText) expect(x.acts, `${label}: ไม่ใส่ชื่อไฟล์`).not.toContain('set_text');
    if (want.msg) expect(x.msg, `${label}: ข้อความที่หน้าเว็บจะแสดง`).toBe(want.msg);
    if (want.effMax) expect(effLen(x.msg), `${label}: ข้อความยาวเกินที่หน้าเว็บนับ (_shortErr) — ส่วนท้ายที่บอกว่าต้องทำอะไรจะถูกตัด`).toBeLessThanOrEqual(want.effMax);
    if (want.popup !== undefined) expect(x.popup, `${label}: ต้องปล่อยหน้าต่างที่ค้างไว้ให้พนักงาน (ตัวช่วยไม่ปิดแทน)`).toBe(want.popup);
    if (want.clicksNone) expect(x.acts.filter((a) => a === 'set_text' || a === 'click_button'), label).toEqual([]);
    if (x.phase === 'import' && x.code && !['CONFIRM_UNKNOWN'].includes(x.code)) {
      // ล้มหลังแตะ ProMaxx → ไม่ใช้เมาส์/พิมพ์ในจังหวะ 2
      expect(x.has_ui_input, `${label}: จังหวะ 2 ห้ามใช้เมาส์/พิมพ์`).toBe(false);
    }
    if (x.phase === 'import' && x.ok !== true) expect(x.hidden, `${label}: ล้มแล้วต้องแสดงหน้าต่าง ProMaxx กลับ (ไม่ค้างซ่อน)`).toBe(false);
  }
});

// ─── 7. ตั๋ว ─────────────────────────────────────────────────────────────────────────────────────────
test('7. ★ ตั๋ว — ใช้ครั้งเดียว · หมดอายุ · ถูกแทนที่ด้วย prepare ใหม่ · cancel ไม่ล้างตั๋วของคนอื่น · ตรวจรูปแบบผิดไม่ทิ้งตั๋ว · ล้มหลังแตะ ProMaxx ทิ้งตั๋ว · cancel แล้วใช้ไม่ได้', () => {
  const r = py(String.raw`
out = {}
A = {"auto_confirm": True}
# ใช้ซ้ำ
svc, ui, log, st = mk(None, A)
s, b = svc.run_prepare_job("ORDS", "SRC"); t, d = b["ticket"], b["docNo"]
out["cancel_other"] = svc.cancel_import({"ticket": "other"})[1]["cleared"]; out["still_valid"] = svc.ticket is not None
s1, b1 = svc.run_import_job(req(t, d)); s2, b2 = svc.run_import_job(req(t, d))
out["reuse"] = [s1, b1.get("ok"), s2, b2.get("code")]
out["files_after_reuse"] = len(os.listdir(st.import_dir))
# หมดอายุ (นาฬิกาปลอมเดินหน้า 700 วินาที)
svc, ui, log, st = mk(None, A)
s, b = svc.run_prepare_job("ORDS", "SRC"); ui.t += 700
s2, b2 = svc.run_import_job(req(b["ticket"], b["docNo"]))
out["expired"] = [s2, b2.get("code"), svc.ticket is None, (len(os.listdir(st.import_dir)) if os.path.isdir(st.import_dir) else 0)]
# ยังไม่หมดอายุที่ 599 วินาที
svc, ui, log, st = mk(None, A)
s, b = svc.run_prepare_job("ORDS", "SRC"); ui.t += 599
s2, b2 = svc.run_import_job(req(b["ticket"], b["docNo"]))
out["not_yet_expired"] = [s2, b2.get("ok")]
# prepare ใหม่ขณะฟอร์มเปิด → SESSION_NOT_READY แต่ตั๋วเก่าถูกยกเลิกแล้ว (ทุกครั้งที่เริ่มใหม่ ตั๋วเก่าถูกทิ้ง)
svc, ui, log, st = mk(None, A)
s, b = svc.run_prepare_job("ORDS", "SRC"); t = b["ticket"]; d = b["docNo"]
s2, b2 = svc.run_prepare_job("ORDS", "SRC")
s3, b3 = svc.run_import_job(req(t, d))
out["replaced"] = [s2, b2.get("code"), s3, b3.get("code")]
# ล้มหลังแตะ ProMaxx → ตั๋วถูกใช้ไปแล้ว
svc, ui, log, st = mk({"settext_noop": True}, A)
s, b = svc.run_prepare_job("ORDS", "SRC"); t = b["ticket"]; d = b["docNo"]
s2, b2 = svc.run_import_job(req(t, d)); s3, b3 = svc.run_import_job(req(t, d))
out["consumed_on_failure"] = [b2.get("code"), b3.get("code")]
# ตรวจรูปแบบผิด → ตั๋วยังอยู่ ส่งใหม่ได้
svc, ui, log, st = mk(None, A)
s, b = svc.run_prepare_job("ORDS", "SRC"); t = b["ticket"]; d = b["docNo"]
s2, b2 = svc.run_import_job(req(t, d, sha256="0" * 64)); s3, b3 = svc.run_import_job(req(t, d))
out["validation_keeps"] = [b2.get("code"), s3, b3.get("ok")]
# cancel → ใช้ไม่ได้ + ไม่มีไฟล์
svc, ui, log, st = mk(None, A)
s, b = svc.run_prepare_job("ORDS", "SRC"); t = b["ticket"]; d = b["docNo"]
c = svc.cancel_import({"ticket": t})[1]; s2, b2 = svc.run_import_job(req(t, d))
out["cancel"] = [c["cleared"], b2.get("code"), (len(os.listdir(st.import_dir)) if os.path.isdir(st.import_dir) else 0)]
# cancel ซ้ำ
out["cancel_twice"] = svc.cancel_import({"ticket": t})[1]["cleared"]
# prepare ที่ล้ม ไม่ทิ้งตั๋วค้าง
svc, ui, log, st = mk({"branch_name": "อนิน สาขาเก้ากิโล"}, A)
s, b = svc.run_prepare_job("ORDS", "SRC")
out["failed_prepare_no_ticket"] = [b.get("ok"), svc.ticket is None, "ticket" in b]
# prepare สาขา WH / ไม่รู้จัก: ไม่แตะ ProMaxx
svc, ui, log, st = mk(None, A)
r1 = svc.run_prepare_job("ORDS", "WH"); r2 = svc.run_prepare_job("ORDS", "XYZ")
out["unsupported"] = [r1[0], r1[1].get("code"), r2[0], r2[1].get("code"), len(ui.calls)]
# ตั๋วเป็นสุ่มและไม่ซ้ำ
tickets = set()
for _ in range(5):
    svc, ui, log, st = mk(None, A)
    tickets.add(svc.run_prepare_job("ORDS", "SRC")[1]["ticket"])
out["tickets_unique"] = len(tickets)
print(json.dumps(out, ensure_ascii=False, default=str))`);
  expect(r.cancel_other, 'cancel ด้วยตั๋วคนอื่นไม่ล้างตั๋วที่ใช้งานอยู่').toBe(false);
  expect(r.still_valid).toBe(true);
  expect(r.reuse).toEqual([200, true, 409, 'TICKET_INVALID']);
  expect(r.files_after_reuse, 'ใช้ซ้ำ = ไม่เขียนไฟล์ซ้ำ').toBe(1);
  expect(r.expired).toEqual([409, 'TICKET_EXPIRED', true, 0]);
  expect(r.not_yet_expired).toEqual([200, true]);
  expect(r.replaced, 'prepare ใหม่ทิ้งตั๋วเก่า (แม้ prepare ใหม่จะล้ม)').toEqual([409, 'SESSION_NOT_READY', 409, 'TICKET_INVALID']);
  expect(r.consumed_on_failure).toEqual(['STEP_FAILED', 'TICKET_INVALID']);
  expect(r.validation_keeps, 'ตรวจ hash ผิดแล้วส่งใหม่ได้ด้วยตั๋วเดิม').toEqual(['FILE_INVALID', 200, true]);
  expect(r.cancel).toEqual([true, 'TICKET_INVALID', 0]);
  expect(r.cancel_twice).toBe(false);
  expect(r.failed_prepare_no_ticket).toEqual([false, true, false]);
  expect(r.unsupported).toEqual([422, 'BRANCH_NOT_SUPPORTED', 422, 'BRANCH_NOT_SUPPORTED', 0]);
  expect(r.tickets_unique).toBe(5);
});

// ─── 8. input หลังกดปุ่มนำเข้า ──────────────────────────────────────────────────────────────────────────
test('8. หลังกดปุ่มนำเข้า input ได้เฉพาะ select-file กับ confirm · ขั้นอื่นที่พยายามส่ง input ถูกตัวกันในตัวรันปฏิเสธ · หลัง "ตกลง" ห้ามมี input อีก', () => {
  const r = py(String.raw`
import inspect
src = inspect.getsource(m.Runner)
svc, ui, log, st = mk(None, {"auto_confirm": True})
runner = m.Runner(ui, st, log, specs=None, opts=m.JobOpts(), clock=ui.clock, sleep=ui.sleep)
runner._input_steps_after_import = m.POST_IMPORT_INPUT_STEPS
out = {}
# จำลอง: ขั้นที่ไม่อยู่ในรายการหลังปุ่มนำเข้า พยายามส่ง input
guard = [n for n in ("_guard_no_input",) if hasattr(runner, n)]
out["has_guard"] = bool(guard)
import re
out["mentions"] = dict(post_import=("_input_steps_after_import" in src), locked=("self._locked" in src))
print(json.dumps(out, ensure_ascii=False))`);
  expect(r.has_guard).toBe(true);
  expect(r.mentions).toEqual({ post_import: true, locked: true });
  // พฤติกรรมจริงของตัวกัน: ขั้นนำเข้าอัตโนมัติ (import-click) กดปุ่มนำเข้าแล้ว _past_import ต้องบล็อก input ของทุกขั้นนอกรายการ
  const g = py(String.raw`
svc, ui, log, st = mk(None, {"auto_confirm": True})
s1, b1 = svc.run_prepare_job("ORDS", "SRC")
s2, b2 = svc.run_import_job(req(b1["ticket"], b1["docNo"]))
# เส้นทาง "จังหวะ 2" ต้องไม่ส่งเมาส์/คีย์บอร์ดเลย (ใช้ UIA Invoke + ข้อความ Windows) ตั้งแต่ปุ่มนำเข้าเป็นต้นไป
after = ui.calls[[i for i, c in enumerate(ui.calls) if c[0] == "uia_act" and c[4] and c[4][0] == "uo_tran_bt_import"][0]:]
print(json.dumps(dict(ok=b2.get("ok"), inputs_after_import=[c[0] for c in after if c[0] in ("click_at", "type_text", "move_to")], ok_clicks=ui.ok_clicks), ensure_ascii=False))`);
  expect(g).toEqual({ ok: true, inputs_after_import: [], ok_clicks: 1 });
});

// ─── 9. HTTP ──────────────────────────────────────────────────────────────────────────────────────────
test('9. HTTP — ฟิลด์เกิน/ขาด/ผิดชนิด · สาขา WH/ไม่รู้จัก/มี path · ขนาด body · เส้นทางเดิมไม่รับ field ใหม่ · Origin/Host/header', () => {
  const r = py(String.raw`
PROD = m.PROD_ORIGIN
H = {"Host": "127.0.0.1:47831", "Origin": PROD, "Content-Type": "application/json", "X-Anin-Helper": "1"}
def post(svc, route, obj=None, headers=None, raw=None, drop_hdr=None):
    body = raw if raw is not None else json.dumps(obj).encode("utf-8")
    h = dict(H, **(headers or {}))
    for k in (drop_hdr or []):
        h.pop(k, None)
    st, hd, pl = svc.handle("POST", route, h, body, declared_length=len(body))
    try:
        j = json.loads(pl.decode("utf-8")) if pl else None
    except Exception:
        j = None
    return [st, (j or {}).get("code")]
svc, ui, log, st = mk(None, {"auto_confirm": True})
P = lambda **kw: dict({"proto": 1, "type": "ORDS", "branch": "SRC"}, **kw)
out = {
 "wh": post(svc, "/v1/prepare-import", P(branch="WH")), "xyz": post(svc, "/v1/prepare-import", P(branch="XYZ")), "dots": post(svc, "/v1/prepare-import", P(branch="../")),
 "lower": post(svc, "/v1/prepare-import", P(branch="src")), "no_branch": post(svc, "/v1/prepare-import", {"proto": 1, "type": "ORDS"}),
 "extra": post(svc, "/v1/prepare-import", P(file="x")), "proto2": post(svc, "/v1/prepare-import", P(proto=2)), "bad_type": post(svc, "/v1/prepare-import", P(type="ORCM")),
 "open_with_branch": post(svc, "/v1/open-import", {"proto": 1, "type": "ORDS", "branch": "SRC"}),
 "run_oversize": post(svc, "/v1/run-import", raw=b"{" + b" " * 140000 + b"}"),
 "prepare_oversize": post(svc, "/v1/prepare-import", raw=b"{" + b" " * 5000 + b"}"),
 "rows_str": post(svc, "/v1/run-import", dict(req("T", "ORDSBY001261100001"), rows="2")), "rows_bool": post(svc, "/v1/run-import", dict(req("T", "ORDSBY001261100001"), rows=True)),
 "rows_zero": post(svc, "/v1/run-import", dict(req("T", "ORDSBY001261100001"), rows=0)), "rows_21": post(svc, "/v1/run-import", dict(req("T", "ORDSBY001261100001"), rows=21)),
 "bad_sha": post(svc, "/v1/run-import", dict(req("T", "ORDSBY001261100001"), sha256="xyz")), "short_sha": post(svc, "/v1/run-import", dict(req("T", "ORDSBY001261100001"), sha256="ab")),
 "text_missing": post(svc, "/v1/run-import", {k: v for k, v in req("T", "ORDSBY001261100001").items() if k != "text"}),
 "text_empty": post(svc, "/v1/run-import", dict(req("T", "ORDSBY001261100001"), text="")),
 "text_number": post(svc, "/v1/run-import", dict(req("T", "ORDSBY001261100001"), text=5)),
 "extra_run": post(svc, "/v1/run-import", dict(req("T", "ORDSBY001261100001"), path="C:\\x")),
 "docno_junk": post(svc, "/v1/run-import", dict(req("T", "../../x"))),
 "cancel_missing": post(svc, "/v1/cancel-import", {"proto": 1}), "cancel_extra": post(svc, "/v1/cancel-import", {"proto": 1, "ticket": "t", "type": "ORDS"}),
 "cancel_ok": post(svc, "/v1/cancel-import", {"proto": 1, "ticket": "nothing"}),
 "wrong_origin": post(svc, "/v1/prepare-import", P(), headers={"Origin": "https://evil.example"}), "no_header": post(svc, "/v1/prepare-import", P(), drop_hdr=["X-Anin-Helper"]),
 "bad_host": post(svc, "/v1/prepare-import", P(), headers={"Host": "evil.example:47831"}), "bad_ct": post(svc, "/v1/prepare-import", P(), headers={"Content-Type": "text/plain"}),
 "not_json": post(svc, "/v1/prepare-import", raw=b"nope"), "json_list": post(svc, "/v1/prepare-import", raw=b"[1]"), "empty": post(svc, "/v1/prepare-import", raw=b""),
}
st_, hd_, pl_ = svc.handle("OPTIONS", "/v1/run-import", dict(H, **{"Access-Control-Request-Method": "POST"}), b"", declared_length=0)
out["options_run"] = [st_, hd_.get("Access-Control-Allow-Origin"), hd_.get("Access-Control-Allow-Private-Network"), hd_.get("Access-Control-Allow-Headers")]
st_, hd_, pl_ = svc.handle("OPTIONS", "/v1/run-import", dict(H, Origin="https://evil.example"), b"", declared_length=0)
out["options_run_evil"] = [st_, hd_.get("Access-Control-Allow-Origin")]
out["calls"] = len(ui.calls)
print(json.dumps(out, ensure_ascii=False))`);
  const want = {
    wh: [422, 'BRANCH_NOT_SUPPORTED'], xyz: [422, 'BRANCH_NOT_SUPPORTED'], dots: [400, 'BAD_REQUEST'], lower: [422, 'BRANCH_NOT_SUPPORTED'],      // ตัวพิมพ์เล็กผ่านรูปแบบแต่ไม่อยู่ในรายการสาขา (ไม่แปลงให้)
    no_branch: [400, 'BAD_REQUEST'], extra: [400, 'BAD_REQUEST'], proto2: [400, 'PROTO_MISMATCH'], bad_type: [400, 'BAD_REQUEST'], open_with_branch: [400, 'BAD_REQUEST'],
    run_oversize: [413, 'PAYLOAD_TOO_LARGE'], prepare_oversize: [413, 'PAYLOAD_TOO_LARGE'],
    rows_str: [400, 'BAD_REQUEST'], rows_bool: [400, 'BAD_REQUEST'], rows_zero: [400, 'BAD_REQUEST'], rows_21: [400, 'BAD_REQUEST'], bad_sha: [400, 'BAD_REQUEST'], short_sha: [400, 'BAD_REQUEST'],
    text_missing: [400, 'BAD_REQUEST'], text_empty: [400, 'BAD_REQUEST'], text_number: [400, 'BAD_REQUEST'], extra_run: [400, 'BAD_REQUEST'], docno_junk: [409, 'TICKET_INVALID'],
    cancel_missing: [400, 'BAD_REQUEST'], cancel_extra: [400, 'BAD_REQUEST'], cancel_ok: [200, null],
    wrong_origin: [403, 'FORBIDDEN_ORIGIN'], no_header: [403, 'FORBIDDEN_HEADER'], bad_host: [403, 'FORBIDDEN_HOST'], bad_ct: [415, 'UNSUPPORTED_MEDIA'],
    not_json: [400, 'BAD_REQUEST'], json_list: [400, 'BAD_REQUEST'], empty: [400, 'BAD_REQUEST'],
  };
  for (const [k, v] of Object.entries(want)) expect(r[k], k).toEqual(v);
  expect(r.options_run).toEqual([204, PROD, 'true', 'Content-Type, X-Anin-Helper']);
  expect(r.options_run_evil[0]).toBe(403);
  expect(r.options_run_evil[1], 'origin แปลก = ไม่มีส่วนหัวอนุญาต').toBeNull();
  expect(r.calls, 'ทุกคำขอที่ถูกปฏิเสธ = ไม่แตะ ProMaxx เลย').toBe(0);
});

// ─── 10. ความลับ ──────────────────────────────────────────────────────────────────────────────────────
test('10. ความลับไม่หลุด — รหัสผ่านและเนื้อไฟล์ (SKU/ราคา/LOT) ไม่อยู่ใน log · ผลลัพธ์ JSON · ข้อความ error · แม้ล้ม', () => {
  const r = py(String.raw`
PW = "s3cret!pw"
res = {}
for label, uia, mutate in [("ok", None, None), ("table_mismatch", {"open_wrong_qty": True}, None), ("confirm_unknown", {"confirm_mode": "dialog"}, None)]:
    svc, ui, log, st = mk(uia, {"auto_confirm": True}, user="somchai", password=PW)
    s1, b1 = svc.run_prepare_job("ORDS", "SRC")
    s2, b2 = svc.run_import_job(req(b1["ticket"], b1["docNo"]))
    blob = "\n".join(log.lines) + json.dumps(b1, ensure_ascii=False) + json.dumps(b2, ensure_ascii=False)
    ev = ""
    runs = os.path.join(tmp, "runs")
    if os.path.isdir(runs):
        for root, dirs, files in os.walk(runs):
            for f in files:
                if f.endswith((".txt", ".json")):
                    ev += open(os.path.join(root, f), encoding="utf-8", errors="replace").read()
    res[label] = dict(pw=(PW in blob) or (PW in ev), lot=("LOT-A1" in blob), price=("242.25" in blob), sku_in_log=("100593" in "\n".join(log.lines)), exp=("31/12/2570" in blob))
# ข้อความ error ของไฟล์ผิดรูปแบบต้องไม่สะท้อนเนื้อไฟล์
svc, ui, log, st = mk(None, {"auto_confirm": True})
s1, b1 = svc.run_prepare_job("ORDS", "SRC")
bad = "SECRETSKU\t1\tPRICE-LEAK\t\t\t\t\t\t\tLOT-LEAK\r\n"
s2, b2 = svc.run_import_job(req(b1["ticket"], b1["docNo"], text=bad, sha256=hashlib.sha256(bad.encode()).hexdigest(), rows=1))
res["invalid_echo"] = dict(code=b2.get("code"), leak=any(x in json.dumps(b2, ensure_ascii=False) + "\n".join(log.lines) for x in ("SECRETSKU", "PRICE-LEAK", "LOT-LEAK")))
print(json.dumps(res, ensure_ascii=False))`);
  // รหัสผ่าน/ราคา/LOT/EXP ห้ามหลุดทุกกรณี · รหัส SKU + จำนวนปรากฏเฉพาะข้อความ TABLE_MISMATCH (บอกว่าแถวไหนไม่ตรง — รหัสสินค้าไม่ใช่ความลับ)
  expect(r.ok, 'ok').toEqual({ pw: false, lot: false, price: false, sku_in_log: false, exp: false });
  expect(r.table_mismatch, 'table_mismatch').toEqual({ pw: false, lot: false, price: false, sku_in_log: true, exp: false });
  expect(r.confirm_unknown, 'confirm_unknown').toEqual({ pw: false, lot: false, price: false, sku_in_log: false, exp: false });
  expect(r.invalid_echo).toEqual({ code: 'FILE_INVALID', leak: false });
});

// ─── 11. โหมดซ่อนหน้าต่าง ────────────────────────────────────────────────────────────────────────────────
test('11. โหมดซ่อนหน้าต่าง — จังหวะ 1/2 ไม่ใช้เมาส์หลังล็อกอิน · หน้าต่างถูกส่งไปหลังสุดหรือแสดงกลับเสมอ (แม้ล้ม · แม้เกิด exception ที่ไม่คาดคิด) · ปิดโหมดซ่อนแล้วยังทำงานได้', () => {
  const r = py(TWO + NEG.split('print(json.dumps')[0] + String.raw`
res = {}
# ใช้เซสชันที่ล็อกอินค้างอยู่: ทั้งสองจังหวะต้องไม่มีเมาส์/พิมพ์เลย (ฟอร์มพร้อมอยู่แล้ว = แค่ UIA Invoke)
x = two(settings={"auto_confirm": True}, start_state="main")
res["attach_inputs"] = [a[0] for a in x["acts"] if a[0] in ("click_at", "type_text")]
res["attach_hidden_end"] = x["hidden"]
# ล้มกลางจังหวะ 2 → หน้าต่างต้องไม่ค้างซ่อน
for label, uia in [("mismatch", {"open_wrong_qty": True}), ("openfail", {"open_no_effect": True}), ("dialog", {"open_error_dialog": "x"})]:
    svc, ui, log, st = mk(uia, {"auto_confirm": True}, start_state="main")
    s1, b1 = svc.run_prepare_job("ORDS", "SRC")
    s2, b2 = svc.run_import_job(req(b1["ticket"], b1["docNo"]))
    res[label] = dict(ok=b2.get("ok"), hidden=ui.hidden)
# ปิดโหมดซ่อน (PROMAXX_HIDE_AFTER_LOGIN=0): ยังสำเร็จได้ ไม่เรียก hide_window
svc, ui, log, st = mk(None, {"auto_confirm": True, "hide_after_login": False}, start_state="main")
s1, b1 = svc.run_prepare_job("ORDS", "SRC"); s2, b2 = svc.run_import_job(req(b1["ticket"], b1["docNo"]))
res["nohide"] = dict(ok=[b1.get("ok"), b2.get("ok")], hide_calls=len([c for c in ui.calls if c[0] == "hide_window"]), ok_clicks=ui.ok_clicks)
# ข้อยกเว้น "ไม่คาดคิด" (ไม่ใช่ HelperError → ไม่ผ่าน _fail ที่แสดงหน้าต่างกลับให้) กลางงานตอนหน้าต่างถูกซ่อน → finally ของ run_import/run_prepare ต้องแสดงกลับ
# ตัวช่วยตอบ 500 INTERNAL (ไม่ตาย) — ตาข่ายสุดท้ายกัน ProMaxx ค้างซ่อนจนพนักงานหาไม่เจอ
seen = {}
svc, ui, log, st = mk(None, {"auto_confirm": True}, start_state="main")
s1, b1 = svc.run_prepare_job("ORDS", "SRC")
orig_vt = m.Runner._step_verify_table
def boom_vt(self, spec):
    seen["imp"] = ui.hidden
    raise RuntimeError("boom-import")
m.Runner._step_verify_table = boom_vt
try:
    s2, b2 = svc.run_import_job(req(b1["ticket"], b1["docNo"]))
finally:
    m.Runner._step_verify_table = orig_vt
res["boom_import"] = dict(status=s2, code=b2.get("code"), hidden_at_boom=seen.get("imp"), hidden_after=ui.hidden, ok_clicks=ui.ok_clicks, ticket=bool(svc.ticket))
svc, ui, log, st = mk({"start_type": "ORDS ใบปรับปรุงลดสินค้า", "start_wh": "Front Store"}, {"auto_confirm": True}, start_state="main")
orig_rs = m.Runner.run_step
def boom_rs(self, name):
    if name == "form-ready":
        seen["prep"] = ui.hidden
        raise RuntimeError("boom-prepare")
    return orig_rs(self, name)
m.Runner.run_step = boom_rs
try:
    s1, b1 = svc.run_prepare_job("ORDS", "SRC")
finally:
    m.Runner.run_step = orig_rs
res["boom_prepare"] = dict(status=s1, code=b1.get("code"), hidden_at_boom=seen.get("prep"), hidden_after=ui.hidden, ticket=bool(svc.ticket))
print(json.dumps(res, ensure_ascii=False))`);
  expect(r.attach_inputs, 'เซสชันค้าง: ไม่มีเมาส์/พิมพ์ทั้งสองจังหวะ').toEqual([]);
  // ข้อยกเว้นไม่คาดคิด: ต้องซ่อนอยู่จริงตอนพัง (ไม่งั้นข้อนี้ไม่ได้ตรวจอะไร) → หลังพังแสดงกลับ · 500 INTERNAL · ไม่กด ตกลง · ตั๋วถูกใช้ไปแล้ว (จังหวะ 2) / ไม่เคยออก (จังหวะ 1)
  expect(r.boom_import, 'จังหวะ 2: exception ที่ไม่ใช่ HelperError').toEqual({ status: 500, code: 'INTERNAL', hidden_at_boom: true, hidden_after: false, ok_clicks: 0, ticket: false });
  expect(r.boom_prepare, 'จังหวะ 1: exception ที่ไม่ใช่ HelperError').toEqual({ status: 500, code: 'INTERNAL', hidden_at_boom: true, hidden_after: false, ticket: false });
  expect(r.attach_hidden_end).toBe(false);
  for (const k of ['mismatch', 'openfail', 'dialog']) expect(r[k], k).toEqual({ ok: false, hidden: false });
  expect(r.nohide.ok).toEqual([true, true]);
  expect(r.nohide.hide_calls).toBe(0);
  expect(r.nohide.ok_clicks).toBe(1);
});

// ─── 12. HTTP จริงผ่าน socket ─────────────────────────────────────────────────────────────────────────────
test('12. HTTP จริงผ่าน socket (ตัวช่วยจริง + ตัวต่อปลอมแบบ WPF/UIA) — prepare → run → ผลตรงกับเรียกตรง · ขนาด body 128 KB ผ่านได้ · concurrency = 409', async () => {
  const srv = await startServer({ origins: [PROD], uia: true, debug: true, settings: { auto_confirm: true, attach_existing: true, hide_after_login: true }, fake: { start_state: 'closed' } });
  try {
    const post = (route, body, o = {}) => request(srv.port, { method: 'POST', path: route, headers: { ...POST_HEADERS(PROD), ...(o.headers || {}) }, body });
    const h = await srv.request({ path: '/v1/health' });
    expect(h.json).toMatchObject({ ok: true, proto: 1, version: '2026-11-05.1', autoImport: true, autoConfirm: true, branches: ['SRC', 'KKL', 'SSS'] });
    // prepare
    const p = await post('/v1/prepare-import', { proto: 1, type: 'ORDS', branch: 'SRC' });
    expect(p.status).toBe(200);
    expect(p.json).toMatchObject({ ok: true, stage: 'prepared', docNo: 'ORDSBY001261100001', autoConfirm: true });
    expect(p.headers['access-control-allow-origin']).toBe(PROD);
    expect(p.headers['cache-control']).toBe('no-store');
    // ตั๋วผิด → 409 ไม่แตะอะไร
    const bad = await post('/v1/run-import', { proto: 1, ticket: 'nope', type: 'ORDS', branch: 'SRC', docNo: p.json.docNo, rows: 2, sha256: require('crypto').createHash('sha256').update(TEXT).digest('hex'), text: TEXT });
    expect(bad.status).toBe(409);
    expect(bad.json.code).toBe('TICKET_INVALID');
    let st = await srv.state();
    expect([st.ok_clicks, st.files, st.ticket]).toEqual([0, [], true]);
    // run (สำเร็จ)
    const run = await post('/v1/run-import', { proto: 1, ticket: p.json.ticket, type: 'ORDS', branch: 'SRC', docNo: p.json.docNo, rows: 2, sha256: require('crypto').createHash('sha256').update(TEXT).digest('hex'), text: TEXT });
    expect(run.status).toBe(200);
    expect(run.json).toMatchObject({ ok: true, stage: 'imported', confirmed: true, rows: 2 });
    st = await srv.state();
    expect([st.ok_clicks, st.saved.length, st.misfires, st.files.length, st.ticket]).toEqual([1, 1, [], 1, false]);
    expect(st.filesData[st.files[0]]).toBe(TEXT);
    // ใช้ตั๋วซ้ำ → 409
    const again = await post('/v1/run-import', { proto: 1, ticket: p.json.ticket, type: 'ORDS', branch: 'SRC', docNo: p.json.docNo, rows: 2, sha256: require('crypto').createHash('sha256').update(TEXT).digest('hex'), text: TEXT });
    expect([again.status, again.json.code]).toEqual([409, 'TICKET_INVALID']);
    // เส้นทางเดิมยังอยู่ และโดนปฏิเสธเพราะฟอร์มค้าง (ไม่ใช่ field ใหม่)
    const legacy = await post('/v1/open-import', { proto: 1, type: 'IRPS' });
    expect([legacy.status, legacy.json.code]).toEqual([409, 'SESSION_NOT_READY']);
    // ขนาด body เกิน 128 KB → 413 (ไม่อ่านทั้งก้อน)
    // เซิร์ฟเวอร์ตอบ 413 แล้วปิดซ็อกเก็ตโดยยังไม่อ่านทั้งก้อน → ไคลเอนต์ที่ยังส่งอยู่อาจได้ ECONNRESET แทนคำตอบ (TCP RST) · ลองใหม่ได้ (ไม่มีผลข้างเคียง) แต่ต้องได้ 413 จริง
    let big = null;
    for (let i = 0; i < 5 && !big; i++) {
      try { big = await post('/v1/run-import', { proto: 1, ticket: 't', type: 'ORDS', branch: 'SRC', docNo: p.json.docNo, rows: 1, sha256: 'a'.repeat(64), text: 'x'.repeat(140000) }); }
      catch (e) { if (!/ECONNRESET|EPIPE/.test(String(e && (e.code || e.message || e)))) throw e; }
    }
    expect(big, 'ได้คำตอบ 413 ภายใน 5 ครั้ง').not.toBeNull();
    expect(big.status).toBe(413);
    // Origin แปลก
    const evil = await post('/v1/prepare-import', { proto: 1, type: 'ORDS', branch: 'SRC' }, { headers: { Origin: 'https://evil.example' } });
    expect(evil.status).toBe(403);
    expect(evil.headers['access-control-allow-origin']).toBeUndefined();
  } finally { await srv.stop(); }
});

// ─── 13. อะแดปเตอร์ Windows (พบจากการทดสอบจริงขั้น 1 บน ProMaxx จริง 5 พ.ย. 2026) ─────────────────────────────────────
// เดิม show_window_back ใช้ SW_SHOWNOACTIVATE ซึ่ง "รีสตอร์" หน้าต่างที่ขยายเต็มจอกลับเป็นขนาดปกติ (zoomed True→False) → ปุ่มนำเข้า/ช่องคลังหลุดนอกกรอบ
// → ด่าน "มองเห็นในกรอบ" ของ import-click ล้ม (PRECONDITION_FAILED) ทั้งที่ฟอร์มถูกต้อง · fake ของเทสอื่นไม่จำลองการรีสตอร์ จึงไม่เคยจับได้ → ตรึงที่ระดับค่าคงที่ที่ส่งให้ ShowWindow
test('13. อะแดปเตอร์ Windows — show_window_back ใช้ SW_SHOWNA (ไม่รีสตอร์หน้าต่างที่ขยายเต็มจอ) · ย่ออยู่ = SW_SHOWMINNOACTIVE · ส่งไปหลังสุดแบบไม่ activate · ไม่ส่งคีย์/คลิก', () => {
  const r = py(String.raw`
import promaxx_win as w
class G:
    def __init__(s, iconic): s.calls = []; s.iconic = iconic
    def IsIconic(s, h): return s.iconic
    def ShowWindow(s, h, cmd): s.calls.append(("ShowWindow", h, cmd))
    def SetWindowPos(s, h, after, x, y, cx, cy, flags): s.calls.append(("SetWindowPos", h, after, flags))
    def __getattr__(s, name): raise AssertionError("ห้ามเรียก " + name)       # SendInput/PostMessage/SetForegroundWindow ฯลฯ ต้องไม่ถูกเรียก
class C:      # ค่าจริงของ win32con
    SW_HIDE = 0; SW_SHOWNOACTIVATE = 4; SW_SHOW = 5; SW_SHOWMINNOACTIVE = 7; SW_SHOWNA = 8; SW_RESTORE = 9
    HWND_BOTTOM = 1; SWP_NOSIZE = 1; SWP_NOMOVE = 2; SWP_NOACTIVATE = 16
res = {}
for label, iconic in (("normal", False), ("iconic", True)):
    a = object.__new__(w.WinAdapter)
    a.con, a.gui = C, G(iconic)
    a.show_window_back(777)
    res[label] = a.gui.calls
print(json.dumps(res))`);
  expect(r.normal, 'ไม่ย่อ: แสดงตามสถานะปัจจุบัน (SW_SHOWNA=8) แล้วส่งไปหลังสุดแบบไม่ activate').toEqual([['ShowWindow', 777, 8], ['SetWindowPos', 777, 1, 2 | 1 | 16]]);
  expect(r.iconic, 'ย่ออยู่: คงย่อไว้ (SW_SHOWMINNOACTIVE=7)').toEqual([['ShowWindow', 777, 7], ['SetWindowPos', 777, 1, 2 | 1 | 16]]);
  expect(JSON.stringify(r), 'ห้ามใช้ SW_SHOWNOACTIVATE(4)/SW_RESTORE(9)/SW_SHOW(5) — รีสตอร์หน้าต่างหรือ activate').not.toMatch(/"ShowWindow",777,(4|5|9)\]/);
});

// ─── 14. หน้าต่างอื่นของ ProMaxx ค้างระหว่างนำเข้า (เจอจริงตอนกดปุ่มจากหน้าเว็บ 5 พ.ย. 2026) ───────────────────────────────
// ไฟล์ทดสอบของผู้ใช้ (SKU TEST · LOT "1") → ProMaxx เปิดป๊อปอัพ "Lot No." (ui_popup_lotnoBalance · หน้าต่างระดับบน sfw_winrespond เต็มจอ · ไม่ใช่ #32770 · หน้าต่างหลักยัง enabled)
// ตัวช่วยเดิมอ่านตารางไม่เจอแถวแล้วรายงาน TABLE_MISMATCH ("ตารางไม่ตรงไฟล์") ทั้งที่ตารางไม่ผิด — ProMaxx รอให้คนเลือก Lot · ตอนนี้ตรวจหน้าต่างค้างก่อนอ่านตาราง/ก่อนประกาศว่าตรง/ก่อนรายงานไม่ตรง
test('14. ★ หน้าต่างอื่นของ ProMaxx ค้าง (ป๊อปอัพ Lot No.) → UNEXPECTED_DIALOG บอกสาเหตุ · ไม่ใช่ TABLE_MISMATCH · ไม่กด ตกลง · ไม่แตะหน้าต่างนั้น · กดใหม่ทั้งที่ยังค้าง = ปฏิเสธ · ข้อความไม่ถูกตัดที่หน้าเว็บ', () => {
  const r = py(String.raw`
res = {}
def run(uia, settings=None, again=False, **fake):
    seen = {}
    svc, ui, log, st = mk(uia, settings if settings is not None else {"auto_confirm": True}, **fake)
    s1, b1 = svc.run_prepare_job("ORDS", "SRC")
    orig_fail = m.Runner._fail
    def spy_fail(self, e):
        seen["main_dumps"], seen["popup_dumps"] = ui.main_dumps, ui.popup_dumps      # ก่อนเก็บหลักฐาน (หลักฐานจะ dump หน้าต่างเพิ่มเอง)
        return orig_fail(self, e)
    m.Runner._fail = spy_fail
    n0 = len(ui.calls)
    try:
        s2, b2 = svc.run_import_job(req(b1["ticket"], b1["docNo"]))
    finally:
        m.Runner._fail = orig_fail
    out = dict(prep=b1.get("ok"), status=s2, ok=b2.get("ok"), code=b2.get("code"), step=b2.get("step"), msg=b2.get("message", ""), ok_clicks=ui.ok_clicks,
               main_dumps=seen.get("main_dumps"), popup_dumps=seen.get("popup_dumps"), popup=ui.popup, hidden=ui.hidden, misfires=ui.misfires,
               inputs=[x[0] for x in ui.calls[n0:] if x[0] in ("click_at", "type_text")], log="\n".join(log.lines))
    if again:     # พนักงานกดปุ่มใหม่ทั้งที่ป๊อปอัพยังค้าง → ต้องปฏิเสธโดยไม่แตะอะไร
        n1 = len(ui.calls)
        s3, b3 = svc.run_prepare_job("ORDS", "SRC")
        out["again"] = dict(status=s3, code=b3.get("code"), touched=[x[0] for x in ui.calls[n1:] if x[0] in ("uia_act", "click_at", "type_text", "set_text", "click_button")], popup=ui.popup)
    return out
res["lot"] = run({"open_popup_window": "lot"}, again=True)
res["other"] = run({"open_popup_window": "other"})
res["lot_dump_fails"] = run({"open_popup_window": "lot", "popup_dump_fails": True})
res["late_ok_table"] = run({"popup_after_dumps": 1})
res["late_mismatch"] = run({"open_slow": 10, "popup_after_dumps": 2})
res["manual_mode"] = run({"open_popup_window": "lot"}, {"auto_confirm": False})
res["happy"] = run(None)
# ด่านสุดท้ายก่อน ตกลง (เฉพาะเมื่อเปิด PROMAXX_AUTO_CONFIRM): ป๊อปอัพโผล่หลังตรวจตารางผ่านแล้ว แต่ก่อนขั้น ตกลง — UIA สั่งปุ่มของหน้าต่างหลักได้แม้มีป๊อปอัพเปิดอยู่ จึงต้องมีด่านนี้
svc, ui, log, st = mk(None, {"auto_confirm": True})
s1, b1 = svc.run_prepare_job("ORDS", "SRC")
orig_vt = m.Runner._step_verify_table
def vt_then_popup(self, spec):
    out = orig_vt(self, spec)
    ui.popup = "lot"
    return out
m.Runner._step_verify_table = vt_then_popup
n_before = len(ui.calls)      # นับ input เฉพาะจังหวะ 2 (ล็อกอินตอน cold start ของจังหวะ 1 ใช้เมาส์/พิมพ์ตามปกติ)
try:
    s2, b2 = svc.run_import_job(req(b1["ticket"], b1["docNo"]))
finally:
    m.Runner._step_verify_table = orig_vt
res["before_confirm"] = dict(status=s2, ok=b2.get("ok"), code=b2.get("code"), step=b2.get("step"), msg=b2.get("message", ""), ok_clicks=ui.ok_clicks, popup=ui.popup, saved=len(ui.saved),
                             inputs=[x[0] for x in ui.calls[n_before:] if x[0] in ("click_at", "type_text")])
orig_max = m.EXTRA_TITLE_MAX
m.EXTRA_TITLE_MAX = 5
try:
    res["trunc"] = run({"open_popup_window": "other"})
finally:
    m.EXTRA_TITLE_MAX = orig_max
res["consts"] = dict(lot=m.MSG_LOT_POPUP, extra=m.MSG_EXTRA_WINDOW % ("ก" * m.EXTRA_TITLE_MAX), title_max=m.EXTRA_TITLE_MAX, marks=list(m.LOT_POPUP_MARKS), peek=m.EXTRA_PEEK_NODES,
                    marker_index=min(i for i, ln in enumerate(fu.POPUP_LOT_LINES) if "ui_popup_lotnoBalance" in ln))
print(json.dumps(res, ensure_ascii=False, default=str))`);
  const C = r.consts;
  expect(C.lot, 'ข้อความป๊อปอัพ Lot No. ต้องตรงกับที่เทสฝั่งหน้าเว็บตรึง').toBe(LOT_POPUP_MSG);
  expect(C.extra, 'ข้อความทั่วไป (ชื่อหน้าต่างยาวสุด)').toBe(EXTRA_WINDOW_MSG('ก'.repeat(C.title_max)));
  expect(C.title_max).toBe(16);
  expect(effLen(C.lot), 'ข้อความ Lot No. ไม่ถูก _shortErr(70) ตัด').toBeLessThanOrEqual(70);
  expect(effLen(C.extra), 'ข้อความทั่วไปกรณีชื่อหน้าต่างยาวสุด ไม่ถูกตัด').toBeLessThanOrEqual(70);
  expect(C.lot, 'ข้อความต้องบอกว่ายังไม่บันทึก + ต้องทำอะไร').toMatch(/ยังไม่บันทึก.*ลองใหม่/);
  expect(C.marks, 'ตัวบ่งชี้ป๊อปอัพ Lot No. ที่ตรวจจริง 5 พ.ย. 2026 (คลาสของ UserObject ข้างใน · id ของ DataWindow)').toEqual(['ui_popup_lotnoBalance', 'id=dw_lotno']);
  // ของจริง: ตัวบ่งชี้ ui_popup_lotnoBalance เป็นโหนดที่ 6 ของ dump (index 5) — ตัวต่อปลอมเรียงเหมือนกัน · อ่านน้อยกว่านี้ = ไม่เห็นตัวบ่งชี้ ⇒ รายงานแบบทั่วไปทั้งที่เป็น Lot No.
  expect(C.marker_index, 'ตัวต่อปลอมเรียงโหนดเหมือนของจริง').toBe(5);
  expect(C.peek, 'อ่านโครงหน้าต่างที่ค้างมากพอให้เห็นตัวบ่งชี้ (ของจริงโหนดที่ 6) พร้อมส่วนเผื่อ').toBeGreaterThanOrEqual(12);

  const L1 = r.lot;
  expect([L1.prep, L1.status, L1.ok, L1.code, L1.step, L1.msg], 'ป๊อปอัพ Lot No. หลัง Open').toEqual([true, 500, false, 'UNEXPECTED_DIALOG', 'verify-table', LOT_POPUP_MSG]);
  expect(L1.main_dumps, 'เจอหน้าต่างค้างก่อนอ่านตารางหลัก — ไม่เสียเวลา dump ราว 8 วินาที').toBe(0);
  expect(L1.popup_dumps, 'อ่านโครงหน้าต่างที่ค้าง 1 ครั้ง (เพื่อรู้ว่าเป็น Lot No.)').toBe(1);
  expect(L1.ok_clicks, 'ไม่กด ตกลง แม้ PROMAXX_AUTO_CONFIRM เปิด').toBe(0);
  expect(L1.inputs, 'ไม่คลิก/พิมพ์ — ปล่อยให้พนักงานเลือก Lot หรือกด ออก เอง').toEqual([]);
  expect(L1.misfires).toEqual([]);
  expect(L1.popup, 'ป๊อปอัพยังอยู่ (ตัวช่วยไม่ปิดแทนพนักงาน)').toBe('lot');
  expect(L1.hidden, 'แสดงหน้าต่าง ProMaxx กลับ ไม่ค้างซ่อน').toBe(false);
  expect(L1.log).toContain('sfw_winrespond');
  expect(L1.log).toContain('เป็นป๊อปอัพเลือก Lot No.');
  expect(L1.again, 'กดปุ่มใหม่ทั้งที่ป๊อปอัพยังค้าง = ปฏิเสธ ไม่แตะอะไร').toEqual({ status: 409, code: 'SESSION_NOT_READY', touched: [], popup: 'lot' });

  const O = r.other;
  expect([O.status, O.code, O.step, O.msg, O.popup, O.main_dumps, O.popup_dumps]).toEqual([500, 'UNEXPECTED_DIALOG', 'verify-table', EXTRA_WINDOW_MSG('Another popup'), 'other', 0, 1]);
  expect(O.log).toContain('Another popup');
  expect(O.log, 'หน้าต่างอื่นไม่ถูกอ้างว่าเป็น Lot No.').not.toContain('เป็นป๊อปอัพเลือก Lot No.');

  const F = r.lot_dump_fails;
  expect([F.status, F.code, F.msg, F.popup_dumps, F.ok_clicks]).toEqual([500, 'UNEXPECTED_DIALOG', EXTRA_WINDOW_MSG('sfw_winrespond'), 1, 0]);
  expect(F.log, 'อ่านโครงไม่ได้ต้องบอกใน log ไม่เงียบ').toContain('อ่านโครงหน้าต่างที่ค้างไม่ได้');

  const T = r.late_ok_table;
  expect([T.status, T.ok, T.code, T.msg, T.main_dumps, T.ok_clicks, T.popup]).toEqual([500, false, 'UNEXPECTED_DIALOG', LOT_POPUP_MSG, 1, 0, 'lot']);
  expect(T.log, 'ห้ามประกาศว่าตารางตรงไฟล์ ทั้งที่มีหน้าต่างค้าง').not.toContain('ตารางตรงไฟล์ครบ');

  const M = r.late_mismatch;
  expect([M.status, M.code, M.msg, M.main_dumps, M.ok_clicks]).toEqual([500, 'UNEXPECTED_DIALOG', LOT_POPUP_MSG, 2, 0]);

  const N = r.manual_mode;
  expect([N.status, N.code, N.msg, N.ok_clicks, N.popup, N.main_dumps]).toEqual([500, 'UNEXPECTED_DIALOG', LOT_POPUP_MSG, 0, 'lot', 0]);

  const H = r.happy;
  expect([H.status, H.ok, H.code, H.ok_clicks, H.popup], 'ไม่มีป๊อปอัพ = นำเข้าสำเร็จตามเดิม (ด่านใหม่ไม่ยิงผิด)').toEqual([200, true, null, 1, null]);
  expect(H.main_dumps === null || H.main_dumps === undefined).toBe(true);     // ไม่ล้ม ⇒ ไม่เคยเรียก _fail (ไม่มีค่าที่จดไว้)

  const U = r.trunc;
  expect(U.msg, 'ชื่อหน้าต่างในข้อความถูกตัดที่ EXTRA_TITLE_MAX').toBe(EXTRA_WINDOW_MSG('Anoth'));

  const B = r.before_confirm;
  expect([B.status, B.ok, B.code, B.step, B.msg], 'ป๊อปอัพโผล่หลังตารางตรงแล้ว ก่อน ตกลง').toEqual([500, false, 'UNEXPECTED_DIALOG', 'confirm', LOT_POPUP_MSG]);
  expect(B.ok_clicks, 'ไม่กด ตกลง ทั้งที่ PROMAXX_AUTO_CONFIRM เปิดและตารางตรงไฟล์').toBe(0);
  expect(B.saved, 'ไม่มีเอกสารถูกบันทึก').toBe(0);
  expect(B.popup, 'ปล่อยป๊อปอัพไว้ให้พนักงาน').toBe('lot');
  expect(B.inputs, 'ไม่มีเมาส์/พิมพ์').toEqual([]);
});
