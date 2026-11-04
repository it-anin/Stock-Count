// PromaxxHelper รุ่น 2026-11-04.5 — ส่วน A "ใช้ ProMaxx ที่เปิด/ล็อกอินค้างต่อได้เมื่อปลอดภัย" + ส่วน B "ซ่อนหน้าต่างหลังล็อกอินแล้วสั่งผ่าน UIA ไม่ใช้เมาส์"
// (4 พ.ย. 2026 · ผู้ใช้เลือก "A/B ร่วมกัน" · ปฏิเสธเมื่อมีฟอร์มค้าง · ซ่อนแบบ Hide · ค่าเริ่มต้นเปิด · ใช้บัญชีที่ล็อกอินค้างได้)
//
// ตัวต่อปลอม tests/lib/fake_ssmaxx_uia.py จำลองหน้าต่างที่ซ่อน: UIA ยังอ่านพิกัด/สั่งปุ่มได้ผ่าน hwnd (ตรวจจริง 4 พ.ย. 2026) แต่เมาส์จริงคลิกทะลุไปโปรแกรมอื่น
// (click_at คืนล้ม) ⇒ ถ้าตัวช่วยเผลอใช้เมาส์ตอนซ่อน เทสจะล้มดังๆ · ⚠️ ไม่พิสูจน์ว่าบน ProMaxx จริงได้ผลตามนี้ (ตรวจจริงแยกแล้ว — README §ผลตรวจจริง)
//
// ตรึง: 1. ค่าตั้ง (dataclass = ปิด · .env = เปิดเป็นค่าเริ่มต้น · ปิดได้ด้วย 0/false/no/off)
//   2. ★ cold start แบบซ่อน: ล็อกอินด้วยเมาส์/คีย์จริง → ซ่อน → เมนู/O,I/นำเข้า ผ่าน UIA (ไม่มีเมาส์/คีย์/โฟกัสตอนซ่อน) → แสดงกลับ → ดึง Select File ขึ้นหน้าสุด
//   3. ปิดโหมดซ่อน = เส้นทางเมาส์เดิมทุกอย่าง  4. ★ ใช้เซสชันที่เปิดค้าง: พร้อมใช้/ค้างที่หน้า Login/มีหน้าต่างถูกซ่อนค้าง
//   5. ★ ปฏิเสธโดยไม่แตะอะไรเมื่อไม่ปลอดภัย: ฟอร์มค้าง · หน้าต่างรายการ · กล่อง Select File · กล่องข้อความ · หน้าต่างถูกล็อก · กำลังเปิด · อ่าน UIA ไม่ได้
//   6. ขั้นที่ต้องใช้เมาส์จริง (หน้าต่างรายการประเภท/คลัง) = แสดงหน้าต่างกลับก่อนแล้วใช้เส้นทางเดิม  7. ★ ล้มตอนซ่อน = แสดงกลับเสมอ (ก่อนเก็บหลักฐาน)
//   8. ซ่อนไม่สำเร็จ = ทำต่อแบบเห็นหน้าต่าง  9. หลังปุ่มนำเข้าไม่มี input เพิ่ม  10. กู้หน้าต่างที่ซ่อนค้าง (เริ่มทำงาน/--reveal-ssmaxx)
//   11. --step/dry-run ไม่ซ่อน  12. ข้อความปฏิเสธสั้นพอให้หน้าเว็บโชว์ (≤45)  13. ตัวต่อ Windows กับตัวต่อปลอมมี method/พารามิเตอร์ตรงกัน
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { runPy, HELPER_DIR, LIB_DIR } = require('../../lib/promaxx-helper-harness');

const SCEN = String.raw`
import fake_ssmaxx_uia as fu
fake = dict(p.get('fake') or {})
sk = {'attach_existing': True, 'hide_after_login': True}
sk.update(p.get('settings') or {})
svc, ui, log, st = fu.make_uia(m, tmp, verified=True, user='somchai', password='s3cret!pw', uia=p.get('uia'), settings_kw=sk, **fake)
if p.get('ui_password'): ui.password = p['ui_password']
if p.get('hook'): exec(p['hook'])
opts = m.JobOpts(**(p.get('opts') or {}))
status, obj = svc.run_job(p.get('type', 'ORDS'), opts, only_step=p.get('only'))
runs = os.path.join(tmp, 'runs')
ev = {}
if os.path.isdir(runs):
    for d in sorted(os.listdir(runs)):
        ev[d] = sorted(os.listdir(os.path.join(runs, d)))
blob = json.dumps(obj, ensure_ascii=False) + '\n'.join(log.lines)
for root, _, files in os.walk(tmp):
    for fn in files:
        if not fn.endswith('.png'):
            blob += open(os.path.join(root, fn), encoding='utf-8', errors='replace').read()
out = dict(status=status, obj=obj, calls=[[str(x) for x in c] for c in ui.calls], acted=ui.acted, clicked=ui.clicked, misfires=ui.misfires,
    state=ui.state, stage=ui.stage, hidden=ui.hidden, after_import=ui.acts_after_import, ev=ev, vtype=ui.vtype, wh=ui.wh, picker=ui.picker,
    fields=ui.fields, login_clicks=ui.login_clicks, leak=bool('s3cret!pw' in blob), log='\n'.join(log.lines), uia_calls=ui.uia_calls,
    consts=dict(form=m.NOT_READY_FORM, window=m.NOT_READY_WINDOW, wait=m.NOT_READY_WAIT))
print(json.dumps(out, ensure_ascii=False, default=str))
`;
const scen = (payload = {}) => runPy(SCEN, payload);
const names = (r) => r.calls.map((c) => c[0]);
const MOUSE_KEY = ['click_at', 'move_to', 'type_text', 'press_key', 'click_button', 'invoke_menu'];
const OK_ORDS = { start_type: 'ORDS ใบปรับปรุงลดสินค้า', start_wh: 'Front Store' };    // ฟอร์มที่เปิดมาถูกต้องอยู่แล้ว (ขั้นประเภท/คลังถูกข้าม)
const OK_IRPS = { start_type: 'IRPS ใบปรับปรุงเพิ่มสินค้า', start_wh: 'Front Store' };
const ALL_STEPS = ['launch', 'login', 'menu', 'doc-button', 'doc-type-open', 'doc-type-pick', 'doc-type-ok', 'warehouse-open', 'warehouse-pick', 'warehouse-ok', 'import-button'];
const SESSION = { start_state: 'main' };                                                // ProMaxx เปิด/ล็อกอินค้างอยู่ที่หน้าหลัก ไม่มีแท็บ
const FORM_OPEN = { start_state: 'doc', start_doc_menu: 'เอกสารจ่าย', start_letter: 'O' };   // ฟอร์มเอกสารเปิดค้างอยู่
const LOGIN_RESULT = ['launch', 'focus', 'click_at', 'type_text', 'click_at', 'type_text', 'click_at'];   // เปิด → โฟกัส → ล็อกอิน (เมาส์/คีย์จริง)

// เส้นทางสำเร็จแบบซ่อน: หลัง hide_window ห้ามมีเมาส์/คีย์/โฟกัส จนกว่าจะแสดงกลับ · แสดงกลับแล้วมีแค่ focus ของกล่อง Select File
function expectHiddenFlow(r, { acted, startsWith }) {
  const n = names(r);
  const h = n.indexOf('hide_window');
  const s = n.indexOf('show_window');
  expect(h, 'ต้องซ่อนหน้าต่าง').toBeGreaterThanOrEqual(0);
  expect(s, 'ต้องแสดงกลับ').toBeGreaterThan(h);
  expect(n.filter((x) => x === 'hide_window').length, 'ซ่อนครั้งเดียว').toBe(1);
  expect(n.filter((x) => x === 'show_window').length, 'แสดงกลับครั้งเดียว').toBe(1);
  expect(n.slice(0, h).filter((x) => x !== 'reveal_hidden'), 'ก่อนซ่อน: ' + startsWith.join('→')).toEqual(startsWith);
  expect(n.slice(h + 1, s), 'ระหว่างซ่อน: สั่งผ่าน UIA เท่านั้น — ห้ามเมาส์/คีย์/โฟกัส (หน้าต่างที่ซ่อนเสียโฟกัสให้โปรแกรมอื่น — ตัวช่วยต้องไม่แย่งกลับ)').toEqual(Array(acted.length).fill('uia_act'));
  expect(n.slice(s + 1), 'หลังแสดงกลับ: ดึงกล่อง Select File ขึ้นหน้าสุดอย่างเดียว (ไม่ใช่ input)').toEqual(['focus']);
  expect(r.calls.filter((c) => c[0] === 'focus').pop().slice(1), 'focus ที่กล่อง Select File (hwnd 300) ไม่ใช่หน้าต่างหลัก').toEqual(['300']);
  expect(r.acted, 'องค์ประกอบที่ถูกสั่งจริงตามลำดับ').toEqual(acted);
  expect(r.hidden, 'จบแล้วหน้าต่างต้องไม่ถูกซ่อนค้าง').toBe(false);
  expect([r.state, r.stage], 'จบที่กล่อง Select File').toEqual(['import', 'form']);
  expect(r.misfires).toEqual([]);
  expect(r.leak, 'รหัสผ่านไม่หลุดลง log/ผลลัพธ์/หลักฐาน').toBe(false);
}

test('1. ค่าตั้ง — dataclass ปิด (เทส/โค้ดเดิมได้พฤติกรรมเดิม) · .env เปิดเป็นค่าเริ่มต้น · ปิดด้วย 0/false/no/off · ค่าแปลกๆ ใช้ค่าเริ่มต้น', async () => {
  const r = runPy(`
d = m.Settings()
base = os.path.join(tmp, 'e'); os.makedirs(base)
def ld(env=None, file=None):
    if file is not None:
        open(os.path.join(base, '.env'), 'w', encoding='utf-8').write(file)
    elif os.path.exists(os.path.join(base, '.env')):
        os.remove(os.path.join(base, '.env'))
    s = m.load_settings(base, environ=env or {})
    return [s.attach_existing, s.hide_after_login]
out = dict(dataclass=[d.attach_existing, d.hide_after_login], default=ld(), file_off=ld(file='PROMAXX_ATTACH_EXISTING=0\\nPROMAXX_HIDE_AFTER_LOGIN=off\\n'),
  one_off=ld(file='PROMAXX_ATTACH_EXISTING=false\\n'), other_off=ld(file='PROMAXX_HIDE_AFTER_LOGIN=no\\n'),
  on_words=ld(file='PROMAXX_ATTACH_EXISTING=on\\nPROMAXX_HIDE_AFTER_LOGIN=yes\\n'), junk=ld(file='PROMAXX_ATTACH_EXISTING=maybe\\nPROMAXX_HIDE_AFTER_LOGIN=2\\n'),
  env_wins=ld(env={'PROMAXX_HIDE_AFTER_LOGIN': '0'}, file='PROMAXX_HIDE_AFTER_LOGIN=1\\n'), env_on=ld(env={'PROMAXX_ATTACH_EXISTING': '1'}, file='PROMAXX_ATTACH_EXISTING=0\\n'))
print(json.dumps(out))`);
  expect(r.dataclass, 'Settings() เปล่าๆ = ปิดทั้งคู่ (ไม่เปลี่ยนพฤติกรรมของโค้ดที่สร้าง Settings เอง)').toEqual([false, false]);
  expect(r.default, 'ไม่มี .env/ตัวแปร = เปิดทั้งคู่ (ผู้ใช้สั่ง 4 พ.ย. 2026)').toEqual([true, true]);
  expect(r.file_off).toEqual([false, false]);
  expect(r.one_off).toEqual([false, true]);
  expect(r.other_off).toEqual([true, false]);
  expect(r.on_words).toEqual([true, true]);
  expect(r.junk, 'ค่าที่ไม่รู้จัก = ค่าเริ่มต้น (เปิด)').toEqual([true, true]);
  expect(r.env_wins, 'ตัวแปรระบบชนะ .env').toEqual([true, false]);
  expect(r.env_on).toEqual([true, true]);
});

for (const [type, ok, menu, letter] of [['ORDS', OK_ORDS, 'เอกสารจ่าย', 'O'], ['IRPS', OK_IRPS, 'เอกสารรับ', 'I']]) {
  test(`2. ★ cold start แบบซ่อน ${type} — ล็อกอินด้วยเมาส์/คีย์จริง → ซ่อน → เมนู/${letter}/นำเข้าผ่าน UIA → แสดงกลับ + ดึงกล่อง Select File ขึ้นหน้าสุด`, async () => {
    const r = scen({ type, uia: ok });
    expect([r.status, r.obj.ok, r.obj.reached, r.obj.hidden, r.obj.attached], JSON.stringify(r.obj)).toEqual([200, true, 'import-button', true, undefined]);
    expect(r.obj.steps.map((s) => s.name)).toEqual(ALL_STEPS);
    expect(r.obj.steps.filter((s) => s.skipped).map((s) => s.name), 'ประเภท/คลังตรงอยู่แล้ว = ถูกข้ามทั้ง 6 ขั้น').toEqual(ALL_STEPS.slice(4, 10));
    expectHiddenFlow(r, { startsWith: LOGIN_RESULT, acted: [['select', `ListItem:${menu}`], ['invoke', letter], ['invoke', 'uo_tran_bt_import']] });
    // รายละเอียดคำสั่ง: ชนิด/pattern/พิกัดตรงกับที่ UIA อ่านได้ (กันสั่งผิดตัว)
    const acts = r.calls.filter((c) => c[0] === 'uia_act');
    expect(acts.map((c) => [c[2], c[3]]), 'pattern ตามชนิด: รายการเมนู=select · ปุ่ม=invoke').toEqual([['select', 'ListItem'], ['invoke', 'Button'], ['invoke', 'Button']]);
    expect(acts[2][6], 'ปุ่มนำเข้าสั่งที่พิกัดที่อ่านได้ (1591,256,1611,276)').toBe('(1591, 256, 1611, 276)');
    expect(acts.map((c) => [c[4], c[5]]), 'ระบุตัวตนด้วย id/ชื่อจาก "ข้อกำหนดของขั้น" (ไม่ใช่ชื่อที่องค์ประกอบรายงานเอง ซึ่งถูกตัดที่ 80 ตัวอักษรได้)').toEqual(
      [['()', menu], [`('${letter}',)`, ''], ["('uo_tran_bt_import',)", '']]);
    expect(acts.every((c) => c[1] === '100'), 'สั่งที่หน้าต่างหลัก (hwnd 100) ทุกครั้ง').toBe(true);
    expect([r.vtype, r.wh], 'ฟอร์มตอนกดนำเข้าถูกต้อง').toEqual([type === 'ORDS' ? 'ORDS ใบปรับปรุงลดสินค้า' : 'IRPS ใบปรับปรุงเพิ่มสินค้า', 'Front Store']);
    expect(r.fields, 'ล็อกอินพิมพ์ครั้งเดียว').toEqual({ username: 'somchai', password: 's3cret!pw' });
    expect([r.login_clicks, names(r).filter((x) => x === 'type_text').length]).toEqual([1, 2]);
    expect(r.log).toContain('ซ่อนหน้าต่าง ProMaxx แล้ว');
    expect(r.log).toContain('แสดงหน้าต่าง ProMaxx กลับมาแล้ว');
    expect(r.log, 'บันทึกสาขาในฟอร์มลง log เหมือนเดิม').toContain('สาขาในฟอร์ม: อนิน สาขาแยกชากค้อ');
    expect(r.ev, 'สำเร็จ = ไม่เก็บหลักฐาน').toEqual({});
  });
}

test('3. ปิดโหมดซ่อน (hide_after_login=false) = เส้นทางเมาส์เดิมทุกอย่าง — ไม่ซ่อน ไม่ uia_act ไม่ดึงโฟกัสเพิ่ม', async () => {
  const r = scen({ uia: OK_ORDS, settings: { hide_after_login: false } });
  expect([r.status, r.obj.ok, r.obj.hidden, r.obj.attached]).toEqual([200, true, undefined, undefined]);
  const n = names(r);
  for (const x of ['hide_window', 'show_window', 'uia_act', 'reveal_hidden']) expect(n, `ต้องไม่เรียก ${x}`).not.toContain(x);
  expect(n.filter((x) => x === 'click_at').length, 'ล็อกอิน 3 + เมนู + O + นำเข้า = 6 คลิกจริง').toBe(6);
  expect(r.hidden).toBe(false);
  expect(r.clicked).toEqual(['cf_empid:1', 'cf_pass:1', 'cb_Login', 'ListItem:เอกสารจ่าย', 'O', 'uo_tran_bt_import']);
  // ค่าตั้งทั้งคู่ปิด (เหมือน Settings() เดิม) ก็เท่ากัน
  const r2 = scen({ uia: OK_ORDS, settings: { hide_after_login: false, attach_existing: false } });
  expect(names(r2)).toEqual(n);
});

test('4. ★ ใช้เซสชันที่เปิดค้างต่อ — ล็อกอินแล้วไม่มีฟอร์มค้าง: ข้ามเปิดโปรแกรม+ล็อกอิน ซ่อน สั่งผ่าน UIA แสดงกลับ (ORDS/IRPS · อยู่หน้าหลักหรือหน้าเมนูย่อย)', async () => {
  for (const [type, ok, menu, letter] of [['ORDS', OK_ORDS, 'เอกสารจ่าย', 'O'], ['IRPS', OK_IRPS, 'เอกสารรับ', 'I']]) {
    for (const [label, fake] of [['หน้าหลัก', SESSION], ['หน้าเมนูย่อยของอีกชนิด', { start_state: 'doc', start_doc_menu: type === 'ORDS' ? 'เอกสารรับ' : 'เอกสารจ่าย' }]]) {
      const r = scen({ type, uia: ok, fake });
      const tag = `${type} @ ${label}`;
      expect([r.status, r.obj.ok, r.obj.attached, r.obj.hidden], `${tag}: ${JSON.stringify(r.obj)}`).toEqual([200, true, 'ready', true]);
      expect(r.obj.steps.map((s) => s.name), `${tag}: ข้ามเฉพาะ launch+login`).toEqual(ALL_STEPS.slice(2));
      expectHiddenFlow(r, { startsWith: [], acted: [['select', `ListItem:${menu}`], ['invoke', letter], ['invoke', 'uo_tran_bt_import']] });
      const n = names(r);
      for (const x of ['launch', 'type_text', 'press_key', 'click_at', 'move_to']) expect(n, `${tag}: ไม่ต้อง ${x}`).not.toContain(x);
      expect(r.login_clicks, 'ไม่ล็อกอินซ้ำ').toBe(0);
      expect(r.log).toContain('ใช้ ProMaxx ที่เปิดค้างอยู่ต่อ');
    }
  }
});

test('5. ใช้เซสชันที่เปิดค้างต่อ — ค้างที่หน้า Login: ล็อกอินต่อด้วยเมาส์/คีย์จริง แล้วซ่อน (ไม่เปิดโปรแกรมซ้ำ)', async () => {
  const r = scen({ uia: OK_ORDS, fake: { start_state: 'login' } });
  expect([r.status, r.obj.ok, r.obj.attached, r.obj.hidden], JSON.stringify(r.obj)).toEqual([200, true, 'login', true]);
  expect(r.obj.steps.map((s) => s.name)).toEqual(ALL_STEPS.slice(1));
  expectHiddenFlow(r, { startsWith: ['click_at', 'type_text', 'click_at', 'type_text', 'click_at'], acted: [['select', 'ListItem:เอกสารจ่าย'], ['invoke', 'O'], ['invoke', 'uo_tran_bt_import']] });
  expect(names(r), 'ไม่เปิดโปรแกรมซ้ำ').not.toContain('launch');
  expect(r.fields).toEqual({ username: 'somchai', password: 's3cret!pw' });
});

test('6. ★ เซสชันที่เปิดค้างแต่หน้าต่างถูกซ่อนค้าง (ตัวช่วยรอบก่อนถูกปิดกลางงาน) — แสดงกลับก่อนตรวจ แล้วใช้ต่อ', async () => {
  const r = scen({ uia: Object.assign({ start_hidden: true }, OK_ORDS), fake: SESSION });
  expect([r.status, r.obj.ok, r.obj.attached, r.obj.hidden], JSON.stringify(r.obj)).toEqual([200, true, 'ready', true]);
  expect(names(r).slice(0, 2), 'ลำดับ: แสดงกลับหน้าต่างค้าง → ซ่อนใหม่ (ของงานนี้)').toEqual(['reveal_hidden', 'hide_window']);
  expect(r.calls[0][1], 'reveal_hidden คืน 1 หน้าต่าง').toBe('1');
  expect(r.log).toContain('แสดงหน้าต่าง ProMaxx ที่ถูกซ่อนค้างกลับมา');
  expect(r.hidden).toBe(false);
});

test('7. ★ ปฏิเสธโดยไม่แตะอะไร — ฟอร์มค้าง · หน้าต่างรายการ · กล่อง Select File · กล่องข้อความ · หน้าต่างถูกล็อก · กำลังเปิด · อ่าน UIA ไม่ได้ (SESSION_NOT_READY 409)', async () => {
  const cases = [
    ['ฟอร์มเอกสารเปิดค้าง (เจอแท็บ+ปุ่มนำเข้า+หัวฟอร์ม)', { fake: FORM_OPEN }, 'form'],
    ['ฟอร์มเปิดค้างและเลื่อนเมนูไปแล้ว (IRPS)', { type: 'IRPS', fake: { start_state: 'doc', start_doc_menu: 'เอกสารรับ', start_letter: 'I' } }, 'form'],
    ['หน้าต่างรายการประเภทเอกสารเปิดค้าง', { fake: FORM_OPEN, uia: { picker_open: 'type' } }, 'window'],
    ['กล่อง Select File เปิดค้าง (มีคนกำลังเลือกไฟล์)', { fake: { start_state: 'import', start_doc_menu: 'เอกสารจ่าย', start_letter: 'O' } }, 'window'],
    ['กล่องข้อความของ ProMaxx ค้าง', { fake: SESSION, hook: "ui.dialogs_now = [('ProMaxx', ('มีข้อผิดพลาด',))]" }, 'window'],
    ['หน้าต่างหลักถูกล็อก (โมดัล)', { fake: SESSION, uia: { top_disabled: true } }, 'window'],
    ['กำลังเปิดโปรแกรม ยังไม่มีหน้าต่าง', { fake: { start_state: 'launching' } }, 'wait'],
    ['อ่านโครงหน้าต่าง (UIA) ไม่ได้', { fake: SESSION, uia: { uia_always_fail: true } }, 'wait'],
    ['ฟอร์มค้างแต่ไม่มีแท็บ MDI (ตัวบอกอื่นต้องจับได้)', { fake: FORM_OPEN, uia: { form_no_tab: true } }, 'form'],
    ['ฟอร์มค้างแต่ไม่มีทั้งแท็บและปุ่มนำเข้า (เหลือหัวฟอร์ม)', { fake: FORM_OPEN, uia: { form_no_tab: true, form_no_import: true } }, 'form'],
    ['มีหน้าต่าง ProMaxx อื่นเปิดอยู่ (ไม่ใช่กล่องข้อความ · หน้าต่างหลักยังไม่ถูกล็อก)', { fake: SESSION, uia: { extra_window: true } }, 'window'],
    ['ล็อกอินแล้วแต่ไม่เห็นเมนูหลักและไม่มีฟอร์ม (กำลังโหลด/หน้าจอผิดปกติ)', { fake: SESSION, uia: { list_hidden: true } }, 'wait'],
  ];
  for (const [label, payload, kind] of cases) {
    const r = scen(payload);
    const tag = `${label}: ${JSON.stringify(r.obj)}`;
    expect([r.status, r.obj.ok, r.obj.code, r.obj.step], tag).toEqual([409, false, 'SESSION_NOT_READY', 'preflight']);
    expect(r.obj.message, `${label}: ข้อความตามประเภทเหตุผล`).toBe(r.consts[kind]);
    for (const x of MOUSE_KEY.concat(['launch', 'focus', 'hide_window', 'show_window', 'uia_act', 'close_processes'])) expect(names(r), `${label}: ต้องไม่ ${x}`).not.toContain(x);
    expect(r.ev, `${label}: ปฏิเสธเพราะสถานะ = ไม่เก็บหลักฐาน`).toEqual({});
    expect(r.hidden).toBe(false);
    expect(r.log, `${label}: log บอกเหตุผลละเอียด`).toContain('ใช้ ProMaxx ที่เปิดอยู่ไม่ได้');
  }
});

test('8. ปิดส่วน A (attach_existing=false) หรือ dry-run/--step = กติกาเดิม: เปิดอยู่แล้วปฏิเสธ ALREADY_RUNNING · --step ไม่ซ่อน', async () => {
  const off = scen({ fake: SESSION, settings: { attach_existing: false } });
  expect([off.status, off.obj.code, off.obj.message]).toEqual([409, 'ALREADY_RUNNING', 'ProMaxx เปิดอยู่แล้ว — ปิด ssmaxx.exe ก่อนแล้วกดใหม่']);
  expect(names(off)).toEqual([]);
  const stepLaunch = scen({ fake: SESSION, only: 'launch' });
  expect([stepLaunch.status, stepLaunch.obj.code], '--step launch ตอนเปิดอยู่แล้ว = ALREADY_RUNNING (ไม่ใช้เซสชันเดิมเงียบๆ)').toEqual([409, 'ALREADY_RUNNING']);
  const dry = scen({ fake: SESSION, opts: { dry_run: true } });
  expect([dry.status, dry.obj.code], 'dry-run ไม่ใช้เซสชันที่เปิดค้างในโหมดเต็ม').toEqual([409, 'ALREADY_RUNNING']);
  // --step ต่อจากหน้าเมนูย่อยที่เปิดค้าง: ใช้เมาส์จริงตามเดิม ไม่ซ่อน ไม่ uia_act
  const step = scen({ uia: OK_ORDS, fake: { start_state: 'doc', start_doc_menu: 'เอกสารจ่าย' }, only: 'doc-button' });
  expect([step.status, step.obj.ok, step.obj.reached, step.obj.hidden]).toEqual([200, true, 'doc-button', undefined]);
  for (const x of ['hide_window', 'show_window', 'uia_act', 'reveal_hidden']) expect(names(step), `--step: ต้องไม่ ${x}`).not.toContain(x);
  expect(names(step)).toContain('click_at');
  // dry-run ของ --step: ไม่ลงมือ ไม่ซ่อน
  const dstep = scen({ uia: OK_ORDS, fake: { start_state: 'doc', start_doc_menu: 'เอกสารจ่าย' }, only: 'doc-button', opts: { dry_run: true } });
  expect(dstep.status).toBe(200);
  for (const x of ['hide_window', 'show_window', 'uia_act', 'click_at', 'type_text']) expect(names(dstep), `dry-run: ต้องไม่ ${x}`).not.toContain(x);
});

test('9. ★ ขั้นที่ต้องใช้เมาส์จริง (หน้าต่างรายการประเภท/คลัง) — แสดงหน้าต่างกลับก่อนแล้วใช้เส้นทางเดิม · ไม่ซ่อนซ้ำ · จบด้วยฟอร์มถูกต้อง', async () => {
  for (const [type, menu, letter, expectVtype] of [['ORDS', 'เอกสารจ่าย', 'O', 'ORDS ใบปรับปรุงลดสินค้า'], ['IRPS', 'เอกสารรับ', 'I', 'IRPS ใบปรับปรุงเพิ่มสินค้า']]) {
    const r = scen({ type });     // ฟอร์มที่เปิดใหม่ตามค่าเริ่มต้นของ ProMaxx: ORDS เปิดเป็น ORCM · IRPS เปิดเป็น IRPS แต่คลัง Warehouse → ต้องตั้งผ่านหน้าต่างรายการ
    expect([r.status, r.obj.ok, r.obj.hidden], `${type}: ${JSON.stringify(r.obj)}`).toEqual([200, true, true]);
    const n = names(r);
    const h = n.indexOf('hide_window');
    const s = n.indexOf('show_window');
    expect(n.slice(h + 1, s), `${type}: ก่อนแสดงกลับ สั่งเมนู+ปุ่ม I/O ผ่าน UIA`).toEqual(['uia_act', 'uia_act']);
    expect(r.acted.slice(0, 2)).toEqual([['select', `ListItem:${menu}`], ['invoke', letter]]);
    expect(n.filter((x) => x === 'show_window').length, 'แสดงกลับครั้งเดียว ไม่ซ่อนซ้ำ').toBe(1);
    expect(n.filter((x) => x === 'hide_window').length).toBe(1);
    expect(n.slice(s + 1).filter((x) => x === 'uia_act').length, 'หลังแสดงกลับใช้เมาส์จริงทั้งหมด').toBe(0);
    expect(n.slice(s + 1).filter((x) => x === 'click_at').length, 'คลิกจริง: ช่อง+แถว+ตกลง (+ปุ่มนำเข้า)').toBeGreaterThanOrEqual(4);
    expect([r.vtype, r.wh], `${type}: ตั้งค่าถูกต้องก่อนนำเข้า`).toEqual([expectVtype, 'Front Store']);
    expect([r.state, r.after_import >= 0, r.hidden, r.picker]).toEqual(['import', true, false, null]);
    expect(r.log).toContain('ขั้น ' + (type === 'ORDS' ? 'doc-type-open' : 'warehouse-open') + ' ต้องใช้เมาส์จริง');
    expect(r.leak).toBe(false);
  }
});

test('10. ★ ล้มตอนซ่อน = แสดงหน้าต่างกลับเสมอ (ก่อนเก็บหลักฐาน) — กล่องแทรก · สั่งไม่สำเร็จ · สั่งแล้วไม่มีผล · เลือกผิดตัว · ข้อผิดพลาดที่ไม่คาดคิด', async () => {
  const injectDialog = `
orig = ui.uia_act
def wrapped(*a, **k):
    r = orig(*a, **k)
    ui.dialogs_now = [('ProMaxx', ('เกิดข้อผิดพลาดที่ไม่คาดคิด',))]
    return r
ui.uia_act = wrapped`;
  const boomFind = `
orig_find = ui.uia_find
def boom(*a, **k):
    if 'hide_window' in [c[0] for c in ui.calls]:
        raise ValueError('boom while hidden')
    return orig_find(*a, **k)
ui.uia_find = boom`;
  const boomDialogs = `
orig_dlg = ui.dialogs
def boom(*a, **k):
    if 'hide_window' in [c[0] for c in ui.calls]:
        raise ValueError('boom while hidden')
    return orig_dlg(*a, **k)
ui.dialogs = boom`;
  const cases = [
    ['กล่องข้อความแทรกตอนซ่อน', { hook: injectDialog }, 500, 'UNEXPECTED_DIALOG', true],
    ['สั่งไม่สำเร็จ (act_fails)', { uia: Object.assign({ act_fails: true }, OK_ORDS) }, 500, 'STEP_FAILED', true],
    ['สั่งแล้วไม่มีผล (เมนูไม่เปลี่ยน)', { uia: Object.assign({ act_no_effect: true }, OK_ORDS) }, 500, 'POSTCONDITION_FAILED', true],
    ['เลือกเมนูผิดตัว (เอกสารรับแทนเอกสารจ่าย)', { uia: Object.assign({ act_wrong_target: true }, OK_ORDS) }, 500, 'POSTCONDITION_FAILED', true],
    ['อ่าน UIA ล้มตอนซ่อน (ข้อผิดพลาดถูกห่อเป็น UIA_ERROR)', { hook: boomFind }, 500, 'UIA_ERROR', true],
    ['ข้อผิดพลาดที่ไม่คาดคิดนอกกรอบ HelperError (Python ValueError → INTERNAL · กู้ด้วย finally)', { hook: boomDialogs }, 500, 'INTERNAL', false],
  ];
  for (const [label, payload, status, code, evidence] of cases) {
    const r = scen(Object.assign({ uia: OK_ORDS }, payload));
    const tag = `${label}: ${JSON.stringify(r.obj)}`;
    expect([r.status, r.obj.code], tag).toEqual([status, code]);
    const n = names(r);
    expect(n, `${label}: ต้องเคยซ่อน`).toContain('hide_window');
    expect(n.filter((x) => x === 'show_window').length, `${label}: แสดงกลับครั้งเดียว`).toBe(1);
    expect(r.hidden, `${label}: หน้าต่างต้องไม่ถูกซ่อนค้าง`).toBe(false);
    const after = n.slice(n.indexOf('show_window') + 1);
    for (const x of MOUSE_KEY.concat(['uia_act'])) expect(after, `${label}: หลังล้มห้าม ${x}`).not.toContain(x);
    if (evidence) {
      expect(Object.keys(r.ev).length, `${label}: เก็บหลักฐาน 1 ชุด`).toBe(1);
      const lines = r.log.split('\n');
      const iReveal = lines.findIndex((l) => l.includes('แสดงหน้าต่าง ProMaxx กลับมาแล้ว'));
      const iEvid = lines.findIndex((l) => l.includes('เก็บหลักฐานไว้ที่'));
      expect(iReveal, `${label}: แสดงกลับก่อนเก็บหลักฐาน (ภาพหน้าจอต้องเห็น ProMaxx)`).toBeGreaterThanOrEqual(0);
      expect(iEvid).toBeGreaterThan(iReveal);
    }
    expect(r.leak, label).toBe(false);
  }
});

test('10b. ★ เป้าขยับระหว่างเตรียมกดปุ่มนำเข้าตอนซ่อน (reverify) = หยุด INTERFERENCE ไม่สั่ง · แสดงหน้าต่างกลับ', async () => {
  const drift = `
orig_act = m.Runner._act_uia
def wrapped(self, t, res, step):
    if step == 'import-button':
        ui.drifted = True          # เป้าขยับหลัง _resolve ครั้งแรก ก่อนการอ่านซ้ำ (reverify) — เหมือนผู้ใช้ย้ายหน้าต่าง/เลย์เอาต์เลื่อน
    return orig_act(self, t, res, step)
m.Runner._act_uia = wrapped`;
  const r = scen({ uia: OK_ORDS, hook: drift });
  expect([r.status, r.obj.code, r.obj.step], JSON.stringify(r.obj)).toEqual([500, 'INTERFERENCE', 'import-button']);
  expect(r.acted, 'ปุ่มนำเข้าต้องไม่ถูกสั่ง').toEqual([['select', 'ListItem:เอกสารจ่าย'], ['invoke', 'O']]);
  expect([r.state, r.hidden], 'ไม่เปิดกล่อง Select File · หน้าต่างกลับมาแล้ว').toEqual(['doc', false]);
  expect(names(r)).toContain('show_window');
});

test('11. ล็อกอินพลาดก่อนซ่อน = ไม่ซ่อนเลย (รหัสผิดไม่ลองซ้ำ) · ซ่อนไม่สำเร็จ = ทำต่อแบบเห็นหน้าต่างด้วยเมาส์เดิม ไม่ล้ม', async () => {
  const bad = scen({ uia: OK_ORDS, ui_password: 'other' });
  expect([bad.status, bad.obj.code, bad.login_clicks]).toEqual([500, 'LOGIN_FAILED', 1]);
  for (const x of ['hide_window', 'show_window', 'uia_act']) expect(names(bad)).not.toContain(x);
  const hf = scen({ uia: Object.assign({ hide_fails: true }, OK_ORDS) });
  expect([hf.status, hf.obj.ok, hf.obj.hidden], JSON.stringify(hf.obj)).toEqual([200, true, undefined]);
  const n = names(hf);
  expect(n.filter((x) => x === 'hide_window').length, 'ลองซ่อนครั้งเดียว').toBe(1);
  for (const x of ['uia_act', 'show_window']) expect(n, `ซ่อนไม่สำเร็จ: ต้องไม่ ${x}`).not.toContain(x);
  expect(n.filter((x) => x === 'click_at').length, 'ใช้เมาส์เดิมครบ 6 คลิก').toBe(6);
  expect(hf.log).toContain('ซ่อนหน้าต่าง ProMaxx ไม่สำเร็จ');
  expect([hf.state, hf.hidden]).toEqual(['import', false]);
});

test('12. หลังปุ่มนำเข้าไม่มี input เพิ่ม — แสดงกลับ+ดึงโฟกัสกล่อง Select File ไม่นับเป็น input · uia_act หลังนำเข้า = 0', async () => {
  const r = scen({ uia: OK_ORDS });
  const n = names(r);
  const lastAct = n.lastIndexOf('uia_act');
  const tail = n.slice(lastAct + 1);
  expect(tail, 'หลังสั่งปุ่มนำเข้า: แสดงกลับ → โฟกัสกล่อง เท่านั้น').toEqual(['show_window', 'focus']);
  expect(r.acted[r.acted.length - 1]).toEqual(['invoke', 'uo_tran_bt_import']);
  expect(r.calls.filter((c) => c[0] === 'uia_act').length, 'สั่งปุ่มนำเข้าครั้งเดียว').toBe(3);
  // ตัวนับ input หลังนำเข้าของตัวต่อปลอมนับ uia_act ด้วย — ต้องเป็น 1 (focus ของกล่อง = _act เดิม) ไม่ใช่เพราะ uia_act ซ้ำ
  expect(r.after_import).toBe(1);
});

test('13. กู้หน้าต่างที่ซ่อนค้าง — reveal_stray · --reveal-ssmaxx (exit 0) · ตอนไม่มีอะไรซ่อนค้างคืน 0 · adapter รุ่นเก่าที่ไม่มี method คืน 0 ไม่ล้ม', async () => {
  const r = runPy(`
import fake_ssmaxx_uia as fu, fake_ssmaxx as fk
svc, ui, log, st = fu.make_uia(m, tmp, uia={'start_hidden': True}, start_state='main')
n1 = m.reveal_stray(ui, st); h1 = ui.hidden
n2 = m.reveal_stray(ui, st)
code = m.main(['--reveal-ssmaxx'], adapter_factory=lambda: ui, settings=st, log=log)
svc2, ui2, log2, st2 = fu.make_uia(m, tmp, uia={'start_hidden': True}, start_state='main')
code2 = m.main(['--reveal-ssmaxx'], adapter_factory=lambda: ui2, settings=st2, log=log2)
svc3, ui3, log3, st3 = fk.make(m, tmp)
class Old: pass
old = Old()
old.pids = lambda name: [1]
class Boom:
    def pids(self, name): return [1]
    def reveal_hidden(self, pids): raise OSError('x')
svc4, ui4, log4, st4 = fu.make_uia(m, tmp, uia={'start_hidden': True}, start_state='main')
def no_bind(*a, **k): raise OSError('port busy (test)')
m.make_server = no_bind
code4 = m.main([], adapter_factory=lambda: ui4, settings=st4, log=log4)
print(json.dumps(dict(serve=dict(code=code4, hidden=ui4.hidden, log=[l for l in log4.lines if 'ซ่อนค้าง' in l]),
  n1=n1, hidden_after=h1, n2=n2, code=code, code2=code2, hidden2=ui2.hidden, log2=[l for l in log2.lines if 'ซ่อนค้าง' in l],
  win32fake=m.reveal_stray(ui3, st3), old=m.reveal_stray(old, st), boom=m.reveal_stray(Boom(), st))))`);
  expect([r.n1, r.hidden_after, r.n2]).toEqual([1, false, 0]);
  expect([r.code, r.code2, r.hidden2], '--reveal-ssmaxx แสดงกลับแล้ว exit 0').toEqual([0, 0, false]);
  expect(r.log2.join('\n')).toContain('แสดงหน้าต่าง ProMaxx ที่ซ่อนค้างกลับมา 1 หน้าต่าง');
  expect([r.win32fake, r.old, r.boom], 'ตัวต่อรุ่นเก่า/ล้ม = 0 ไม่โยน error').toEqual([0, 0, 0]);
  expect([r.serve.code, r.serve.hidden], 'ตอนตัวช่วยเริ่มทำงาน (--serve) แสดงหน้าต่างที่ซ่อนค้างกลับก่อนเปิดพอร์ต (พอร์ตไม่ว่าง → exit 3 แต่หน้าต่างต้องกลับแล้ว)').toEqual([3, false]);
  expect(r.serve.log.join('\n')).toContain('จากตัวช่วยรอบก่อนที่หยุดกลางงาน');
});

test('14. HTTP — ผลสำเร็จมี attached/hidden (เพิ่มอย่างเดียว ไม่แตะ field เดิม) · ปฏิเสธ 409 SESSION_NOT_READY ข้อความสั้น ≤45 ตัวอักษรที่นับแบบหน้าเว็บ (_shortErr)', async () => {
  const r = runPy(`
import fake_ssmaxx_uia as fu, unicodedata
def vis(t): return sum(1 for c in t if unicodedata.category(c) != 'Mn')
def call(**kw):
    svc, ui, log, st = fu.make_uia(m, tmp, settings_kw={'attach_existing': True, 'hide_after_login': True}, **kw)
    h = {'Host': '127.0.0.1:%d' % st.port, 'Origin': m.PROD_ORIGIN, 'Content-Type': 'application/json', 'X-Anin-Helper': '1'}
    status, hd, payload = svc.handle('POST', '/v1/open-import', h, json.dumps({'proto': 1, 'type': 'ORDS'}).encode())
    return status, json.loads(payload.decode('utf-8'))
ok_status, ok = call(uia={'start_type': 'ORDS ใบปรับปรุงลดสินค้า', 'start_wh': 'Front Store'}, start_state='main')
no_status, no = call(start_state='doc', start_doc_menu='เอกสารจ่าย', start_letter='O')
print(json.dumps(dict(ok_status=ok_status, ok=ok, no_status=no_status, no=no, lens={n: vis(getattr(m, n)) for n in ('NOT_READY_FORM', 'NOT_READY_WINDOW', 'NOT_READY_WAIT')})))`);
  expect(r.ok_status).toBe(200);
  expect(Object.keys(r.ok).sort(), 'field เดิมครบ + attached/hidden เพิ่ม').toEqual(['attached', 'dryRun', 'elapsedMs', 'hidden', 'ok', 'proto', 'reached', 'steps', 'type', 'version'].sort());
  expect([r.ok.attached, r.ok.hidden, r.ok.reached]).toEqual(['ready', true, 'import-button']);
  expect([r.no_status, r.no.code, r.no.step, r.no.ok]).toEqual([409, 'SESSION_NOT_READY', 'preflight', false]);
  expect(Object.keys(r.no).sort(), 'รูปแบบข้อผิดพลาดเดิม').toEqual(['code', 'message', 'ok', 'proto', 'step', 'steps', 'version']);
  for (const [k, v] of Object.entries(r.lens)) expect(v, `${k} ต้องไม่ถูกตัดที่หน้าเว็บ (≤45)`).toBeLessThanOrEqual(45);
});

test('15b. ตัวต่อ Windows — hide_window/show_window/reveal_hidden ใช้คำสั่งถูกตัว (win32 ปลอม): ซ่อน=SW_HIDE · แสดง=SW_SHOW (ย่ออยู่=SW_RESTORE) · กู้เฉพาะหน้าต่างหลักของ ssmaxx ที่ไม่ได้แสดง', async () => {
  const r = runPy(`
import promaxx_win as w
class G:
    def __init__(s): s.calls = []; s.iconic = {8}
    def ShowWindow(s, h, c): s.calls.append((h, c))
    def IsIconic(s, h): return h in s.iconic
class C: SW_HIDE = 0; SW_SHOW = 5; SW_RESTORE = 9; SW_MINIMIZE = 6; SW_SHOWMINIMIZED = 2
a = w.WinAdapter.__new__(w.WinAdapter)
a.gui, a.con = G(), C()
a.hide_window(7); a.show_window(7); a.show_window(8)
basic = list(a.gui.calls)
W = m.WinInfo
MAIN = 'HwndWrapper[ssmaxx.exe;;aaaa]'
a.gui.calls.clear()
a.top_windows = lambda pids: [
    W(hwnd=1, cls=MAIN, text='SeniorSoft ProMaxx', visible=False),          # ถูกซ่อนค้าง → ต้องกู้
    W(hwnd=2, cls=MAIN, text='SeniorSoft ProMaxx', visible=True),           # แสดงอยู่แล้ว → ไม่แตะ
    W(hwnd=3, cls='HwndWrapper[ssmaxx.exe;;bbbb]', text='', visible=False), # หน้าต่างช่วยของโปรแกรม (ซ่อนเป็นปกติ) → ไม่แตะ
    W(hwnd=4, cls='Notepad', text='SeniorSoft ProMaxx', visible=False),     # ไม่ใช่ ssmaxx → ไม่แตะ
    W(hwnd=5, cls=MAIN, text='MediaContextNotificationWindow', visible=False)]
n = a.reveal_hidden([1])
print(json.dumps(dict(basic=basic, n=n, revealed=a.gui.calls)))`);
  expect(r.basic, 'ซ่อน = SW_HIDE(0) · แสดง = SW_SHOW(5) · ถ้าย่ออยู่ = SW_RESTORE(9)').toEqual([[7, 0], [7, 5], [8, 9]]);
  expect([r.n, r.revealed], 'กู้เฉพาะหน้าต่างหลักที่ซ่อนค้าง (hwnd 1)').toEqual([1, [[1, 5]]]);
});

test('15. ตัวต่อ Windows (promaxx_win.py) กับตัวต่อปลอมต้องมี method + พารามิเตอร์ตรงกัน — กัน fake เพี้ยนจากของจริงจนเทสผ่านทั้งที่ของจริงเรียกไม่ได้', async () => {
  const r = runPy(`
import ast
src = open(os.path.join(p['helper_dir'], 'promaxx_win.py'), encoding='utf-8').read()
tree = ast.parse(src)
win = {}
for node in ast.walk(tree):
    if isinstance(node, ast.ClassDef) and node.name == 'WinAdapter':
        for f in node.body:
            if isinstance(f, ast.FunctionDef):
                win[f.name] = [a.arg for a in f.args.args]
import inspect, fake_ssmaxx_uia as fu
fake = {}
for n in ('hide_window', 'show_window', 'reveal_hidden', 'uia_act', 'focus', 'uia_find'):
    fake[n] = [a for a in inspect.signature(getattr(fu.FakeWpfUI, n)).parameters]
win_src_has = dict(act_call='.act(hwnd, ids=ids, ctype=ctype, name=name, rect=rect, pattern=pattern)' in src,
                   sw_hide='SW_HIDE' in src, main_title='MAIN_TITLE = "SeniorSoft ProMaxx"' in src)
print(json.dumps(dict(win={k: win.get(k) for k in fake}, fake=fake, has=win_src_has)))`);
  for (const k of Object.keys(r.fake)) expect(r.win[k], `WinAdapter.${k} ต้องมีและพารามิเตอร์ตรงกับตัวต่อปลอม`).toEqual(r.fake[k]);
  expect(r.has).toEqual({ act_call: true, sw_hide: true, main_title: true });
  // ตัวช่วยหลักเรียก method เหล่านี้เท่านั้น (ไม่มีทางลัดอื่นเช่น ShowWindow ตรงๆ ในแกน)
  const core = fs.readFileSync(path.join(HELPER_DIR, 'promaxx_helper.py'), 'utf8');
  expect(core).not.toMatch(/ShowWindow|SetWindowPos|mouse_event|SendInput/);
});
