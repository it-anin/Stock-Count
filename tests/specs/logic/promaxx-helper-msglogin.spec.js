// PromaxxHelper รุ่น 2026-11-05.1 — "ล็อกอินแบบล่องหน": ส่งชื่อผู้ใช้/รหัสผ่านเข้าช่อง Login ด้วยข้อความ Windows (WM_CHAR) ขณะซ่อนหน้าต่าง
// (5 พ.ย. 2026 · ผู้ใช้สั่งต่อจากผลทดลองข้อ C: "เปิดโปรแกรมแล้วซ่อนทันที, ล็อกอินด้วยข้อความ, คืนโฟกัสให้เบราว์เซอร์, เก็บวิธีเดิมไว้เป็นทางสำรองหลังสวิตช์")
//
// ตัวต่อปลอม tests/lib/fake_ssmaxx_uia.py จำลองสิ่งที่ตรวจจริงกับ ProMaxx จริง 5 พ.ย. 2026: หน้าต่างหลักถูกสร้างแบบซ่อนแล้ว ProMaxx "แสดงเอง" ·
// ช่องชื่อผู้ใช้ได้โฟกัสในโปรแกรมทั้งที่หน้าต่างซ่อน/ไม่ใช่ foreground · WM_CHAR เข้าช่องที่ได้โฟกัส · Tab ย้ายไปช่องรหัสผ่าน · ช่องที่เสียโฟกัสแสดงชื่อที่พิมพ์
// ⚠️ ไม่พิสูจน์ว่า ProMaxx จริงเป็นแบบนี้ทุกเครื่อง (พิสูจน์แล้วที่ BIG-IT — README §ผลตรวจจริง) · ที่นี่ตรึง "ตรรกะของตัวช่วย" เท่านั้น
//
// ตรึง: 1. ค่าตั้ง (dataclass = input · .env = message · ปิดโหมดซ่อน = ไม่ใช้) + health  2. ★ cold start แบบล่องหน (ORDS/IRPS): ไม่มีเมาส์/คีย์จริงเลย ·
//   ซ่อนทันทีที่โผล่ (ค้างเห็น ≤ 0.1 วินาที) · ส่งครบ/ตรวจชื่อก่อนรหัส · กด SIGN IN ผ่าน UIA  3. โผล่ซ้ำหลังซ่อน = ซ่อนอีก  4. ★ ถอยไปเมาส์/คีย์จริง "เฉพาะก่อนส่งอะไร"
//   5. ★ เริ่มส่งแล้วล้ม = หยุด ไม่ถอย ไม่ส่งรหัสผ่านถ้าชื่อไม่ตรง ไม่ลองซ้ำ  6. คืนโฟกัสให้เบราว์เซอร์  7. attach หน้า Login / ready / --step / dry-run
//   8. ข้อความ (Unicode/อีโมจิ) · ความลับไม่หลุด  9. ตัวต่อ Windows (post_char/post_key/foreground_hwnd) กับตัวต่อปลอมตรงกัน  10. เฝ้าซ่อนไม่วนไม่จบ
const { test, expect } = require('@playwright/test');
const { runPy } = require('../../lib/promaxx-helper-harness');

const SCEN = String.raw`
import fake_ssmaxx_uia as fu
fake = dict(p.get('fake') or {})
sk = {'attach_existing': True, 'hide_after_login': True, 'login_mode': 'message'}
sk.update(p.get('settings') or {})
uia = dict(p.get('base_uia') or {})
uia.update(p.get('uia') or {})
pw = p.get('password') or 's3cret!pw'
svc, ui, log, st = fu.make_uia(m, tmp, verified=True, user='somchai', password=pw, uia=uia, settings_kw=sk, **fake)
if p.get('ui_password'): ui.password = p['ui_password']
if p.get('hook'): exec(p['hook'])
if p.get('mode') == 'open':
    status, obj = svc.run_job(p.get('type', 'ORDS'), m.JobOpts(**(p.get('opts') or {})), only_step=p.get('only'))
else:
    status, obj = svc.run_prepare_job(p.get('type', 'ORDS'), p.get('branch', 'SRC'))
again = None
if p.get('again'):
    n0, pb = len(ui.calls), len(ui.posted)
    s2, b2 = svc.run_prepare_job(p.get('type', 'ORDS'), p.get('branch', 'SRC'))
    again = dict(status=s2, ok=b2.get('ok'), code=b2.get('code'), message=b2.get('message'), new_calls=[c[0] for c in ui.calls[n0:]], new_posted=len(ui.posted) - pb)
runs = os.path.join(tmp, 'runs')
ev = {}
if os.path.isdir(runs):
    for d in sorted(os.listdir(runs)):
        ev[d] = sorted(os.listdir(os.path.join(runs, d)))
blob = json.dumps(obj, ensure_ascii=False) + '\n'.join(log.lines) + json.dumps([[str(x) for x in c] for c in ui.calls if c[0] != 'type_text'], ensure_ascii=False)
for root, _, files in os.walk(tmp):
    for fn in files:
        if not fn.endswith('.png'):
            blob += open(os.path.join(root, fn), encoding='utf-8', errors='replace').read()
out = dict(status=status, obj=obj, calls=[[str(x) for x in c] for c in ui.calls], posted=[list(map(str, x)) for x in ui.posted], fields=ui.fields,
    hidden=ui.hidden, exposures=ui.exposures, show_log=ui.show_log, show_posted=ui.show_posted, login_clicks=ui.login_clicks, misfires=ui.misfires, acted=ui.acted,
    log='\n'.join(log.lines), leak=bool(pw in blob), state=ui.state, has_focus=ui.has_focus, ev=ev, uia_calls=ui.uia_calls, clicked=ui.clicked, again=again, grab_times=ui.grab_times, focus_times=ui.focus_times)
print(json.dumps(out, ensure_ascii=False, default=str))
`;
const scen = (payload = {}) => runPy(SCEN, { base_uia: BASE, ...payload });
const names = (r) => r.calls.map((c) => c[0]);
const REAL_INPUT = ['type_text', 'press_key', 'click_at', 'move_to', 'click_button', 'invoke_menu'];
const OK_ORDS = { start_type: 'ORDS ใบปรับปรุงลดสินค้า', start_wh: 'Front Store' };        // ฟอร์มที่เปิดมาถูกต้องอยู่แล้ว (ขั้นประเภท/คลังถูกข้าม)
const OK_IRPS = { start_type: 'IRPS ใบปรับปรุงเพิ่มสินค้า', start_wh: 'Front Store' };
// สภาพแวดล้อมที่ตรวจจริง: ProMaxx สร้างหน้าต่างแบบซ่อนแล้วแสดงเอง · ช่องชื่อผู้ใช้ได้โฟกัสในโปรแกรมตั้งแต่หน้า Login พร้อม · เบราว์เซอร์ของพนักงานเป็น foreground
const BASE = { self_show_after: 5.0, focus_on_ready: true, logical_focus: true, browser_fg: true, ...OK_ORDS };
const USER_N = 'somchai'.length;      // 7
const PASS_N = 's3cret!pw'.length;    // 9
const KINDS = (r) => r.posted.map((x) => x[0]);
const effLen = (s) => [...s].filter((c) => !/[ัิ-ฺ็-๎]/.test(c)).length;      // นับเฉพาะตัวอักษรที่กินที่ (ไม่นับสระบน-ล่าง/วรรณยุกต์) — เหมือน _shortErr ของหน้าเว็บ

function expectMessageLoginClean(r, tag) {
  expect([r.status, r.obj.ok], `${tag}: ${JSON.stringify(r.obj)}`).toEqual([200, true]);
  const n = names(r);
  for (const x of REAL_INPUT) expect(n, `${tag}: ล็อกอินแบบข้อความต้องไม่ใช้ ${x}`).not.toContain(x);
  expect(n, `${tag}: ไม่ดึงโฟกัสไปที่ ProMaxx`).not.toContain('focus');
  expect(r.fields, `${tag}: ข้อความที่ส่งครบ`).toEqual({ username: 'somchai', password: 's3cret!pw' });
  expect(KINDS(r), `${tag}: ส่ง ชื่อผู้ใช้ → Tab → รหัสผ่าน`).toEqual([...Array(USER_N).fill('char'), 'key', ...Array(PASS_N).fill('char')]);
  expect(r.login_clicks, `${tag}: กด SIGN IN ครั้งเดียว`).toBe(1);
  expect(r.misfires, tag).toEqual([]);
  expect(r.leak, `${tag}: รหัสผ่านไม่หลุดลง log/ผลลัพธ์/หลักฐาน/รายการเรียก`).toBe(false);
}

test('1. ค่าตั้ง — dataclass = input (เทส/โค้ดเดิมได้พฤติกรรมเดิม) · .env เริ่มต้น = message · ค่าแปลก = message + เตือน · ตัวแปรระบบชนะ .env · /v1/health บอกโหมด', () => {
  const r = runPy(`
d = m.Settings()
base = os.path.join(tmp, 'e'); os.makedirs(base)
warns = []
def ld(env=None, file=None):
    if file is not None:
        open(os.path.join(base, '.env'), 'w', encoding='utf-8').write(file)
    elif os.path.exists(os.path.join(base, '.env')):
        os.remove(os.path.join(base, '.env'))
    del warns[:]
    s = m.load_settings(base, environ=env or {}, warn=warns.append)
    return [s.login_mode, list(warns)]
import fake_ssmaxx_uia as fu
svc, ui, log, st = fu.make_uia(m, tmp, verified=True, settings_kw={'login_mode': 'message'})
svc2, ui2, log2, st2 = fu.make_uia(m, tmp, verified=True)
out = dict(dataclass=d.login_mode, modes=list(m.LOGIN_MODES), default=ld(), msg=ld(file='PROMAXX_LOGIN_MODE=message\\n'), inp=ld(file='PROMAXX_LOGIN_MODE=input\\n'),
  upper=ld(file='PROMAXX_LOGIN_MODE= MESSAGE \\n'), junk=ld(file='PROMAXX_LOGIN_MODE=maybe\\n'), env_wins=ld(env={'PROMAXX_LOGIN_MODE': 'input'}, file='PROMAXX_LOGIN_MODE=message\\n'),
  health_msg=svc.health()['loginMode'], health_default=svc2.health()['loginMode'], version=m.VERSION)
print(json.dumps(out, ensure_ascii=False))`);
  expect(r.dataclass, 'Settings() เปล่าๆ = input (ไม่เปลี่ยนพฤติกรรมของโค้ดที่สร้าง Settings เอง)').toBe('input');
  expect(r.modes).toEqual(['message', 'input']);
  expect(r.default, 'ไม่มี .env/ตัวแปร = message (ผู้ใช้สั่ง 5 พ.ย. 2026) และไม่เตือน').toEqual(['message', []]);
  expect(r.msg).toEqual(['message', []]);
  expect(r.inp).toEqual(['input', []]);
  expect(r.upper, 'ไม่สนตัวพิมพ์/ช่องว่างหัวท้าย').toEqual(['message', []]);
  expect(r.junk[0], 'ค่าที่ไม่รู้จัก = message').toBe('message');
  expect(r.junk[1].join(' '), 'ต้องเตือนให้เห็น ไม่เงียบ').toContain('PROMAXX_LOGIN_MODE');
  expect(r.env_wins, 'ตัวแปรระบบชนะ .env').toEqual(['input', []]);
  expect([r.health_msg, r.health_default], '/v1/health บอกโหมดที่ตั้งไว้').toEqual(['message', 'input']);
  expect(r.version).toBe('2026-11-05.1');
});

for (const [type, ok, menu] of [['ORDS', OK_ORDS, 'เอกสารจ่าย'], ['IRPS', OK_IRPS, 'เอกสารรับ']]) {
  test(`2. ★ cold start แบบล่องหน ${type} — ไม่มีเมาส์/คีย์จริงเลยตั้งแต่เปิดโปรแกรม · ซ่อนทันทีที่โผล่ · ตรวจชื่อก่อนรหัสผ่าน · กด SIGN IN ผ่าน UIA · จบแล้วแสดงกลับไม่ดึงขึ้นหน้า`, () => {
    const r = scen({ type, uia: ok });
    expectMessageLoginClean(r, type);
    expect(r.obj.steps.map((s) => s.name)).toEqual(['launch', 'login', 'menu', 'doc-button', 'doc-type-open', 'doc-type-pick', 'doc-type-ok', 'warehouse-open', 'warehouse-pick', 'warehouse-ok', 'form-ready']);
    expect(r.obj.hidden, 'บอกเว็บว่าทำงานแบบซ่อน').toBe(true);
    const n = names(r);
    expect(n.filter((x) => x === 'hide_window').length, 'ซ่อนครั้งเดียว (ProMaxx แสดงหน้าต่างเองครั้งเดียว)').toBe(1);
    expect(n.indexOf('launch') < n.indexOf('hide_window') && n.indexOf('hide_window') < n.indexOf('post_char'), 'ลำดับ: เปิด → ซ่อน → ส่งข้อความ').toBe(true);
    expect(n.filter((x) => x === 'post_key').length).toBe(1);
    expect(r.acted.slice(0, 3), 'หลังส่งรหัสผ่าน: SIGN IN → เมนู → ปุ่ม ผ่าน UIA').toEqual([['invoke', 'cb_Login'], ['select', `ListItem:${menu}`], ['invoke', type === 'ORDS' ? 'O' : 'I']]);
    expect(r.show_log.length, 'ProMaxx แสดงหน้าต่างเองครั้งเดียว').toBe(1);
    expect(Math.max(...r.exposures), `ค้างให้เห็นก่อนซ่อน (วินาทีของเวลาปลอม) — ต้อง ≤ 0.1`).toBeLessThanOrEqual(0.1);
    expect(r.hidden, 'จบแล้วหน้าต่างไม่ค้างซ่อน').toBe(false);
    expect(n[n.length - 1], 'แสดงกลับแบบไม่ดึงขึ้นหน้า').toBe('show_window_back');
    expect(r.log).toContain('ล็อกอินแบบข้อความ');
    expect(r.log).toContain('ProMaxx แสดงชื่อผู้ใช้ตรงกับที่ส่ง');
    expect(r.log, 'log บอกจำนวนอักษร ไม่บอกตัวอักษร').toContain(`ส่งรหัสผ่านด้วยข้อความ (${PASS_N} ตัวอักษร)`);
    expect(r.ev, 'สำเร็จ = ไม่เก็บหลักฐาน').toEqual({});
  });
}

test('2b. เส้นทางเดิมของปุ่ม (open-import · Runner.run) ก็ล็อกอินแบบล่องหนได้ — จบที่กล่อง Select File', () => {
  const r = scen({ mode: 'open', uia: OK_ORDS });
  expect([r.status, r.obj.ok, r.obj.reached, r.obj.hidden], JSON.stringify(r.obj)).toEqual([200, true, 'import-button', true]);
  const n = names(r);
  const noInput = n.slice(0, n.indexOf('show_window'));
  for (const x of REAL_INPUT) expect(noInput, `ก่อนแสดงกลับ ต้องไม่ใช้ ${x}`).not.toContain(x);
  expect(r.fields).toEqual({ username: 'somchai', password: 's3cret!pw' });
  expect(r.state, 'จบที่กล่อง Select File').toBe('import');
  expect(r.leak).toBe(false);
});

test('2c. ProMaxx แสดงหน้าต่างพร้อมหน้า Login ทันที (ไม่สร้างแบบซ่อนก่อน) · UIA ช้า 1.5 วินาที/ครั้ง — ยังซ่อนได้ใน ≤ 0.1 วินาที เพราะก่อนหน้าต่างโผล่ลูปรอไม่เรียก UIA', () => {
  const r = scen({ uia: { self_show_after: null, ...OK_ORDS }, hook: "ui.f['uia_cost'] = 1.5" });
  expectMessageLoginClean(r, 'โผล่พร้อมหน้า Login');
  expect(Math.max(...r.exposures, 0), 'ซ่อนทันที').toBeLessThanOrEqual(0.1);
  const r2 = scen({ uia: { self_show_after: 5.0, ...OK_ORDS }, hook: "ui.f['uia_cost'] = 1.5" });
  expectMessageLoginClean(r2, 'โผล่หลัง 5 วินาที + UIA ช้า');
  expect(r2.show_log.length).toBe(1);
  expect(r2.exposures.length).toBe(1);
  expect(r2.exposures[0], 'UIA ช้าไม่ทำให้ซ่อนช้า: ก่อนโผล่ไม่มีหน้าต่างให้ UIA อ่าน จึงไม่เสียเวลาอ่าน').toBeLessThanOrEqual(0.1);
});

test('3. ProMaxx แสดงหน้าต่างเองซ้ำหลังถูกซ่อน (ระหว่างรอล็อกอิน) — เฝ้าซ่อนอีก · ซ่อนแล้วยังรอ/ตรวจต่อได้', () => {
  const r = scen({ uia: { reshow_after: [8.4, 9.1], ...OK_ORDS } });
  expectMessageLoginClean(r, 'โผล่ซ้ำ');
  expect(r.show_log.length, 'ProMaxx แสดงเอง 3 ครั้ง (ครั้งแรก + 2 ซ้ำ)').toBe(3);
  expect(r.exposures.length, 'ซ่อนทุกครั้ง').toBe(3);
  expect(Math.max(...r.exposures), 'ทุกครั้งค้างไม่เกิน 1.5 วินาทีของเวลาปลอม (กรณีแย่สุด = กำลังตรวจ UIA)').toBeLessThanOrEqual(1.5);
  expect(names(r).filter((x) => x === 'hide_window').length).toBe(3);
  expect(r.log).toContain('ที่โผล่กลับขึ้นมาอีก');
  expect(r.obj.hidden).toBe(true);
});

test('3b. _hide_main หลังล็อกอินแบบข้อความ — หน้าต่างที่ซ่อนไว้แล้วถูกแสดงเองอีก → ซ่อนใหม่ · ไม่ซ่อนซ้ำเมื่อยังซ่อนอยู่', () => {
  const r = runPy(`
import fake_ssmaxx_uia as fu
svc, ui, log, st = fu.make_uia(m, tmp, verified=True, settings_kw={'attach_existing': True, 'hide_after_login': True}, start_state='main')
rn = m.Runner(ui, st, log, clock=ui.clock, sleep=ui.sleep)
rn._hidden.add(fu.MAIN_HWND)
ui.hidden = True
rn._hide_main('menu')
a = [c[0] for c in ui.calls]
rn2 = m.Runner(ui, st, log, clock=ui.clock, sleep=ui.sleep)
rn2._hidden.add(fu.MAIN_HWND)
ui.hidden = False                       # ProMaxx แสดงหน้าต่างเองอีก
rn2._hide_main('menu')
print(json.dumps(dict(still_hidden_calls=a, reshown_calls=[c[0] for c in ui.calls][len(a):], hidden_after=ui.hidden, tried=rn2._hide_tried, ids=sorted(rn2._hidden))))`);
  expect(r.still_hidden_calls, 'ยังซ่อนอยู่ = ไม่สั่งซ่อนซ้ำ').toEqual([]);
  expect(r.reshown_calls, 'ถูกแสดงเองอีก = สั่งซ่อนใหม่').toEqual(['hide_window']);
  expect([r.hidden_after, r.tried, r.ids]).toEqual([true, true, [100]]);
});

test('4. ★ ถอยไปเมาส์/คีย์จริง "เฉพาะก่อนส่งอะไร" — ช่องไม่ได้โฟกัส · ProMaxx ไม่รับข้อความ · ซ่อนไม่ได้ · รหัสมีอักขระควบคุม → ล็อกอินสำเร็จด้วยวิธีเดิม ไม่มีข้อความค้างในช่อง', () => {
  const cases = [
    ['ช่องชื่อผู้ใช้ไม่ได้โฟกัสตอนซ่อน (UIA ผูกกับ foreground)', { uia: { logical_focus: false } }, 'ช่องชื่อผู้ใช้ยังไม่รับโฟกัส'],
    ['PostMessage ถูกบล็อก (ProMaxx รันสิทธิ์สูงกว่า — UIPI)', { uia: { post_blocked: true } }, 'ProMaxx ไม่รับข้อความ'],
    ['สั่งซ่อนหน้าต่างไม่ได้', { uia: { hide_fails: true } }, 'เลิกเฝ้าซ่อน'],
    ['รหัสผ่านมีอักขระควบคุม (Tab)', { password: 'pa\tss', uia: {} }, 'อักขระควบคุม'],
  ];
  for (const [label, payload, expectLog] of cases) {
    const r = scen({ uia: OK_ORDS, ...payload, ...(payload.uia ? { uia: { ...OK_ORDS, ...payload.uia } } : {}) });
    const tag = `${label}: ${JSON.stringify(r.obj).slice(0, 200)}`;
    expect([r.status, r.obj.ok], tag).toEqual([200, true]);
    expect(KINDS(r), `${label}: ไม่ส่งข้อความอะไรเข้าช่องเลย (ถอยก่อนส่ง)`).toEqual([]);
    const n = names(r);
    expect(n.filter((x) => x === 'type_text').length, `${label}: ล็อกอินด้วยวิธีเดิม พิมพ์ 2 ครั้ง`).toBe(2);
    expect(n, `${label}: คลิกจริงด้วย`).toContain('click_at');
    expect(r.fields, label).toEqual({ username: 'somchai', password: payload.password || 's3cret!pw' });
    expect(r.login_clicks, label).toBe(1);
    expect(r.misfires, label).toEqual([]);
    expect(r.log, `${label}: log บอกเหตุผลที่ถอย`).toContain(expectLog);
    expect(r.leak, label).toBe(false);
  }
});

test('5. ★ เริ่มส่งแล้วล้ม = หยุดทันที ไม่ถอยไปเมาส์/คีย์จริง ไม่ลองซ้ำ — ชื่อผู้ใช้ไม่ตรง/ตกหาย/ของค้างในช่อง → ไม่ส่งรหัสผ่าน ไม่กด SIGN IN (ยังไม่ล็อกอิน · ไม่นับเป็นล็อกอินผิด)', () => {
  const cases = [
    ['ตัวอักษรตกหาย 1 ตัวในชื่อผู้ใช้', { uia: { post_drop_at: 3 } }, 'STEP_FAILED', 'ชื่อผู้ใช้ที่ ProMaxx รับไม่ตรง', USER_N + 1],
    ['ในช่องมีข้อความค้างอยู่ก่อน (พนักงานพิมพ์ค้างไว้)', { hook: "ui.fields['username']='abc'; ui.field_units['username']=[97, 98, 99]" }, 'STEP_FAILED', 'ชื่อผู้ใช้ที่ ProMaxx รับไม่ตรง', USER_N + 1],
    ['Tab ไม่ย้ายโฟกัสไปช่องรหัสผ่าน', { uia: { tab_no_move: true } }, 'PRECONDITION_FAILED', 'ช่องรหัสผ่านไม่รับโฟกัส', USER_N + 1],
    ['ProMaxx ไม่รับข้อความเลย (เข้าคิวแต่ไม่มีอะไรเกิด)', { uia: { post_ignored: true } }, 'PRECONDITION_FAILED', 'ช่องรหัสผ่านไม่รับโฟกัส', USER_N + 1],
    ['PostMessage เริ่มถูกปฏิเสธกลางชื่อผู้ใช้', { uia: { post_blocked_after: 3 } }, 'STEP_FAILED', 'ส่งข้อความเข้า ProMaxx ไม่สำเร็จ', 3],
    ['Tab ถูกปฏิเสธหลังชื่อผู้ใช้ครบ', { uia: { post_blocked_after: USER_N } }, 'STEP_FAILED', 'ส่ง Tab เข้า ProMaxx ไม่สำเร็จ', USER_N],
  ];
  for (const [label, payload, code, msg, nPosted] of cases) {
    const r = scen({ uia: { ...OK_ORDS, ...(payload.uia || {}) }, hook: payload.hook });
    const tag = `${label}: ${JSON.stringify(r.obj).slice(0, 220)}`;
    expect([r.status >= 400, r.obj.ok, r.obj.code, r.obj.step], tag).toEqual([true, false, code, 'login']);
    expect(r.obj.message, `${label}: ข้อความบอกสาเหตุ`).toContain(msg);
    expect(r.obj.message, `${label}: ข้อความบอกว่ายังไม่ล็อกอิน`).toContain('ยังไม่ล็อกอิน');
    expect(effLen(r.obj.message), `${label}: ข้อความสั้นพอให้หน้าเว็บโชว์ครบ (_shortErr(…,45))`).toBeLessThanOrEqual(45);
    const n = names(r);
    expect(r.posted.length, `${label}: ส่งเท่าที่ควรแล้วหยุด (ไม่มีรหัสผ่านหลุดไป)`).toBe(nPosted);
    expect(r.fields.password, `${label}: ช่องรหัสผ่านต้องว่าง`).toBe('');
    expect(r.login_clicks, `${label}: ไม่กด SIGN IN`).toBe(0);
    for (const x of REAL_INPUT) expect(n, `${label}: ห้ามถอยไปใช้ ${x} (ข้อความที่ค้างในช่องจะปนกัน)`).not.toContain(x);
    expect(n, `${label}: ไม่ลองซ้ำ`).not.toContain('uia_act');
    expect(r.hidden, `${label}: แสดงหน้าต่างกลับให้พนักงานเห็น`).toBe(false);
    expect(Object.keys(r.ev).length, `${label}: เก็บหลักฐาน`).toBe(1);
    expect(r.leak, label).toBe(false);
  }
});

test('5b. รหัสผ่านผิด (ProMaxx ปฏิเสธ) = LOGIN_FAILED · กด SIGN IN ครั้งเดียว ไม่ลองซ้ำ · ไม่ส่งข้อความเพิ่มหลังกด · รหัสไม่หลุด', () => {
  const r = scen({ uia: OK_ORDS, ui_password: 'other-pass' });
  expect([r.status >= 400, r.obj.ok, r.obj.code, r.obj.step], JSON.stringify(r.obj).slice(0, 240)).toEqual([true, false, 'LOGIN_FAILED', 'login']);
  expect(r.login_clicks, 'กดครั้งเดียว').toBe(1);
  expect(KINDS(r), 'ส่งครบแล้วจบ ไม่ส่งเพิ่ม').toEqual([...Array(USER_N).fill('char'), 'key', ...Array(PASS_N).fill('char')]);
  const n = names(r);
  expect(n.filter((x) => x === 'uia_act').length, 'สั่งผ่าน UIA ครั้งเดียว (SIGN IN)').toBe(1);
  for (const x of REAL_INPUT) expect(n).not.toContain(x);
  expect(r.hidden).toBe(false);
  expect(r.leak).toBe(false);
});

test('6. ★ คืนโฟกัสให้เบราว์เซอร์ — ProMaxx แย่ง foreground แม้ซ่อนแล้ว → focus(เดิม) · ไม่แย่งไป = ไม่แตะ · ปลายทางของ prepare คืนโฟกัสถ้า ProMaxx ถือ foreground', () => {
  // ก) ProMaxx แสดงหน้าต่าง → ได้ foreground และซ่อนแล้วก็ยังถือ foreground (ตรวจจริงครั้งก่อน) → ต้องคืนให้เบราว์เซอร์ (hwnd 900)
  const a = scen({ uia: { ...OK_ORDS, grab_fg_on_show: true, hide_keeps_fg: true } });
  expectMessageLoginClean({ ...a, calls: a.calls.filter((c) => c[0] !== 'focus') }, 'ProMaxx แย่ง foreground');
  const fa = a.calls.filter((c) => c[0] === 'focus');
  expect(fa.map((c) => c.slice(1)), 'คืนโฟกัสครั้งเดียว ให้เบราว์เซอร์').toEqual([['900']]);
  const na = names(a);
  expect(na.indexOf('hide_window') + 1, 'คืนทันทีหลังซ่อน').toBe(na.indexOf('focus'));
  expect(a.has_focus, 'จบแล้ว foreground ไม่ใช่ ProMaxx').toBe(false);
  expect(a.log).toContain('คืนโฟกัสแป้นพิมพ์ให้หน้าต่างเดิม');
  // ข) ไม่แย่ง foreground เลย = ไม่เรียก focus สักครั้ง (ไม่รบกวนพนักงาน)
  const b = scen({ uia: OK_ORDS });
  expect(names(b), 'ไม่แย่ง = ไม่แตะโฟกัส').not.toContain('focus');
  // ค) วิธีเดิม (เมาส์/คีย์จริง) + ขั้นเลือกประเภทที่ต้องใช้เมาส์: ProMaxx ถือ foreground ตอนจบ → คืนให้เบราว์เซอร์ที่ปลายทาง
  const c = scen({ settings: { login_mode: 'input' }, uia: { browser_fg: true, self_show_after: null, start_type: null, start_wh: null, logical_focus: false, focus_on_ready: false } });
  expect([c.status, c.obj.ok], JSON.stringify(c.obj).slice(0, 200)).toEqual([200, true]);
  const nc = names(c);
  expect(nc[nc.length - 1], 'ปลายทางคืนโฟกัส').toBe('focus');
  expect(c.calls[c.calls.length - 1].slice(1), 'ให้เบราว์เซอร์').toEqual(['900']);
  expect(c.has_focus).toBe(false);
  // ง) เบราว์เซอร์ไม่ถูกจำ (ไม่มี foreground_hwnd = ตัวต่อเดิม) → ไม่คืนอะไร เหมือนก่อนแก้ทุกอย่าง
  const d = scen({ settings: { login_mode: 'input' }, uia: { browser_fg: false, self_show_after: null } });
  expect(d.calls.filter((x) => x[0] === 'focus').every((x) => x[1] !== '900')).toBe(true);
});

test('7. ขอบเขต — attach หน้า Login: ซ่อนแล้วล็อกอินด้วยข้อความ · attach ready: ไม่มีขั้นล็อกอิน (ไม่ส่งข้อความ) · --step/dry-run/ปิดโหมดซ่อน/โหมด input: ใช้เมาส์คีย์จริงเหมือนเดิม', () => {
  // attach ค้างที่หน้า Login (หน้าต่างมองเห็นอยู่ตั้งแต่ต้น) → ซ่อนทันที แล้วส่งข้อความ
  const a = scen({ fake: { start_state: 'login' }, uia: { ...OK_ORDS, self_show_after: null } });
  expectMessageLoginClean(a, 'attach หน้า Login');
  expect(a.obj.attached).toBe('login');
  expect(names(a).indexOf('hide_window'), 'ซ่อนก่อนส่งข้อความ').toBeLessThan(names(a).indexOf('post_char'));
  // attach ready
  const b = scen({ fake: { start_state: 'main' }, uia: OK_ORDS });
  expect([b.status, b.obj.ok, b.obj.attached]).toEqual([200, true, 'ready']);
  expect(KINDS(b), 'ล็อกอินอยู่แล้ว ไม่ส่งข้อความ').toEqual([]);
  expect(b.login_clicks).toBe(0);
  // โหมด input / ปิดโหมดซ่อน = วิธีเดิม
  for (const [label, settings] of [['login_mode=input', { login_mode: 'input' }], ['hide_after_login=false', { hide_after_login: false }]]) {
    const c = scen({ settings, uia: { ...OK_ORDS, self_show_after: null } });       // สภาพแวดล้อมที่โหมดข้อความทำได้ — สวิตช์ล้วนๆ ที่ทำให้ใช้เมาส์/คีย์จริง
    expect([c.status, c.obj.ok], `${label}: ${JSON.stringify(c.obj).slice(0, 200)}`).toEqual([200, true]);
    expect(KINDS(c), `${label}: ไม่ส่งข้อความ`).toEqual([]);
    expect(names(c).filter((x) => x === 'type_text').length, `${label}: พิมพ์จริง 2 ครั้ง`).toBe(2);
  }
  // --step login / launch และ dry-run ไม่ใช้โหมดข้อความ
  const s = scen({ mode: 'open', only: 'launch', uia: OK_ORDS, fake: { existing_pids: [] } });
  expect(KINDS(s)).toEqual([]);
  expect(names(s)).not.toContain('hide_window');
  const dry = scen({ mode: 'open', opts: { dry_run: true }, uia: OK_ORDS });
  expect(KINDS(dry), 'dry-run ไม่ส่งอะไร').toEqual([]);
  expect(names(dry).filter((x) => ['hide_window', 'post_char', 'post_key', 'launch'].includes(x))).toEqual([]);
});

test('8. ข้อความ — อีโมจิ (2 หน่วย UTF-16) · ภาษาไทย · ช่องว่าง ส่งครบและล็อกอินสำเร็จ · log ไม่มีตัวอักษรของรหัส · _utf16_units แยกหน่วยถูก', () => {
  const u = runPy(`
print(json.dumps(dict(ascii=m._utf16_units('ab'), thai=m._utf16_units('ก'), emoji=m._utf16_units('a\\U0001F600'), empty=m._utf16_units(''))))`);
  expect(u.ascii).toEqual([97, 98]);
  expect(u.thai).toEqual([0x0E01]);
  expect(u.emoji, 'อีโมจินอก BMP = ตัวแทนคู่ (surrogate pair)').toEqual([97, 0xD83D, 0xDE00]);
  expect(u.empty).toEqual([]);
  for (const pw of ['pw😀x', 'รหัสผ่านไทย 99', 'a b  c']) {
    const r = scen({ uia: OK_ORDS, password: pw });
    expect([r.status, r.obj.ok], `${pw}: ${JSON.stringify(r.obj).slice(0, 200)}`).toEqual([200, true]);
    expect(r.fields.password, `${pw}: ส่งครบ`).toBe(pw);
    expect(r.login_clicks).toBe(1);
    expect(r.leak, `${pw}: ไม่หลุดลง log`).toBe(false);
    expect(r.log).toContain('ส่งรหัสผ่านด้วยข้อความ (' + [...pw].length + ' ตัวอักษร)');
  }
});

test('9. ตัวต่อ Windows — post_char/post_key/foreground_hwnd: ข้อความที่ส่ง · ปฏิเสธหน้าต่างของโปรเซสอื่น · ล้ม = False · คีย์ที่ไม่ได้อนุญาต = ValueError · ไม่เรียก API เมาส์/คีย์จริง · พารามิเตอร์ตรงกับตัวต่อปลอม', () => {
  const r = runPy(`
import promaxx_win as w, inspect, fake_ssmaxx_uia as fu
w.time.sleep = lambda s: None
class G:
    def __init__(s, fail=False): s.calls = []; s.fail = fail
    def PostMessage(s, h, msg, wp, lp):
        if s.fail: raise RuntimeError('denied')
        s.calls.append((h, msg, wp, lp))
    def GetForegroundWindow(s): return 4242
    def __getattr__(s, name): raise AssertionError('ห้ามเรียก ' + name)       # SendInput/SetForegroundWindow/ShowWindow ฯลฯ ต้องไม่ถูกเรียก
class P:
    @staticmethod
    def GetWindowThreadProcessId(h): return (1, 555 if h == 10 else 777)
def mk(fail=False):
    a = object.__new__(w.WinAdapter); a.gui = G(fail); a.proc = P
    return a
a = mk()
res = {}
res['char'] = [a.post_char(10, 0x41), a.post_char(10, 0x0E01), a.post_char(10, 0x1F600 + 0x10000), a.post_char(10, 0xD83D)]
res['char_guard'] = [a.post_char(10, 0x41, [555]), a.post_char(11, 0x41, [555]), a.post_char(10, 0x41, [])]
res['key'] = a.post_key(10, 'tab')
res['key_guard'] = a.post_key(11, 'TAB', [555])
try:
    a.post_key(10, 'enter'); res['bad_key'] = 'no error'
except ValueError as e:
    res['bad_key'] = 'ValueError'
res['calls'] = a.gui.calls
f = mk(True)
res['fail'] = [f.post_char(10, 0x41), f.post_key(10, 'tab')]
res['fg'] = a.foreground_hwnd()
class G2(G):
    def GetForegroundWindow(s): raise RuntimeError('x')
b = mk(); b.gui = G2()
res['fg_err'] = b.foreground_hwnd()
res['consts'] = dict(char=w.WM_CHAR, down=w.WM_KEYDOWN, up=w.WM_KEYUP, keys=w.POST_KEYS)
res['params'] = {n: [list(inspect.signature(getattr(c, n)).parameters) for c in (w.WinAdapter, fu.FakeWpfUI)] for n in ('foreground_hwnd', 'post_char', 'post_key')}
print(json.dumps(res))`);
  expect(r.consts, 'ค่าคงที่ของ Windows').toEqual({ char: 0x102, down: 0x100, up: 0x101, keys: { tab: 9 } });
  expect(r.char, 'ส่งเข้าคิวสำเร็จทุกตัว').toEqual([true, true, true, true]);
  expect(r.char_guard, 'จำกัดด้วย pids: หน้าต่างของโปรเซสอื่น/รายการว่าง = ปฏิเสธ').toEqual([true, false, false]);
  expect(r.key).toBe(true);
  expect(r.key_guard, 'ตัวพิมพ์ใหญ่ก็รับ แต่หน้าต่างผิดโปรเซส = ปฏิเสธ').toBe(false);
  expect(r.bad_key, 'คีย์ที่ไม่ได้อนุญาต (ไม่ใช่ Tab)').toBe('ValueError');
  const msgs = r.calls.map((c) => [c[1], c[2], c[3]]);
  expect(msgs.slice(0, 4), 'WM_CHAR · wParam = หน่วย UTF-16 (ตัดที่ 16 บิต) · lParam = 1').toEqual([[0x102, 0x41, 1], [0x102, 0x0E01, 1], [0x102, (0x1F600 + 0x10000) & 0xFFFF, 1], [0x102, 0xD83D, 1]]);
  expect(msgs.slice(4, 6).concat(msgs.slice(6)), 'ลำดับ: post_char(ผ่าน pids) ×1 → post_key: KEYDOWN lParam 1 → KEYUP lParam 0xC0000001').toEqual([[0x102, 0x41, 1], [0x100, 9, 1], [0x101, 9, 0xC0000001]]);
  expect(r.fail, 'PostMessage ล้ม (สิทธิ์ไม่พอ) = False ไม่โยน').toEqual([false, false]);
  expect([r.fg, r.fg_err], 'foreground_hwnd: ค่าจริง / ล้ม = 0').toEqual([4242, 0]);
  for (const [n, [win, fake]] of Object.entries(r.params)) expect(win, `${n}: พารามิเตอร์ของตัวต่อ Windows ต้องตรงกับตัวต่อปลอม`).toEqual(fake);
});

test('10. เฝ้าซ่อนไม่วนไม่จบ — ProMaxx แสดงหน้าต่างเองรัวๆ ไม่หยุด: ซ่อนไม่เกินเพดาน HIDE_MAX แล้วเลิกเฝ้า (ล็อกอินที่ส่งข้อความไปแล้วเดินต่อจนจบ ไม่ถอย ไม่ค้าง)', () => {
  const many = Array.from({ length: 200 }, (_, i) => 0.3 + i * 0.05);       // แสดงเองทุก 0.05 วินาทีหลังหน้า Login พร้อม
  const r = scen({ uia: { ...OK_ORDS, self_show_after: 0.2, reshow_after: many }, hook: 'm.HIDE_MAX = 6' });
  expect([r.status, r.obj.ok], JSON.stringify(r.obj).slice(0, 220)).toEqual([200, true]);
  expect(r.log, 'ต้องบอกว่าเลิกเฝ้า ไม่เงียบ').toContain('โผล่ซ้ำเกิน 6 ครั้ง');
  const hides = names(r).filter((x) => x === 'hide_window').length;
  expect(hides, 'ซ่อนครบเพดาน (6) + ครั้งที่ทำให้เกิน (7) + ตรวจหลังล็อกอินอีกครั้ง — ไม่ซ่อนต่อเนื่องไม่จบ').toBeGreaterThanOrEqual(7);
  expect(hides).toBeLessThanOrEqual(9);
  expect(KINDS(r), 'ส่งข้อความครบแล้วเดินต่อจนจบ (ไม่ถอยไปวิธีเดิมกลางทาง)').toEqual([...Array(USER_N).fill('char'), 'key', ...Array(PASS_N).fill('char')]);
  for (const x of REAL_INPUT) expect(names(r), x).not.toContain(x);
  expect(r.fields).toEqual({ username: 'somchai', password: 's3cret!pw' });
  expect(r.leak).toBe(false);
  // ค่าจริงของเพดาน (ตรวจที่ระดับค่าคงที่): ไม่ต่ำจนซ่อนไม่ทันตอนปกติ ไม่สูงจนวนนาน
  const c = runPy("print(json.dumps(dict(max=m.HIDE_MAX, fail=m.HIDE_FAIL_MAX, poll=m.HIDE_POLL)))");
  expect(c).toEqual({ max: 30, fail: 3, poll: 0.05 });
});

test('10b. สั่งซ่อนไม่ได้ติดกัน HIDE_FAIL_MAX ครั้ง = เลิกเฝ้า · ก่อนส่งอะไรจึงใช้วิธีเดิม (ไม่ค้างวนซ่อนไม่จบ)', () => {
  const r = scen({ uia: { ...OK_ORDS, hide_fails: true } });
  expect([r.status, r.obj.ok], JSON.stringify(r.obj).slice(0, 220)).toEqual([200, true]);
  expect(r.log).toContain('เลิกเฝ้าซ่อน');
  expect(names(r).filter((x) => x === 'hide_window').length, 'ลองซ่อน 3 ครั้งแล้วเลิก (+ ครั้งหลังล็อกอินตามวิธีเดิม)').toBeLessThanOrEqual(5);
  expect(KINDS(r)).toEqual([]);
  expect(r.fields).toEqual({ username: 'somchai', password: 's3cret!pw' });
});

test('11. เปิดโปรแกรมไม่สำเร็จในโหมดข้อความ — ผลเหมือนวิธีเดิมทุกอย่าง (รหัส/ขั้น/ข้อความ): ปิดตัวเอง · กล่องข้อความตอนเปิด (SQL Server) · ไม่พบหน้า Login · และไม่ส่งข้อความอะไรเข้า ProMaxx', () => {
  const cases = [
    ['โปรเซสปิดตัวเองก่อนถึงหน้า Login', { no_login_window: true, crash_after_launch: true }],
    ['กล่องข้อความตอนเปิด (ต่อ SQL Server ไม่ได้)', { dialog_on_launch: ['SeniorSoft ProMaxx', ['ไม่สามารถเชื่อมต่อ SQL Server ได้']] }],
    ['ไม่พบหน้า Login ภายในเวลา', { no_login_window: true }],
  ];
  for (const [label, fake] of cases) {
    const m = scen({ fake, uia: { ...OK_ORDS, self_show_after: null } });
    const i = scen({ fake, uia: { ...OK_ORDS, self_show_after: null }, settings: { login_mode: 'input' } });
    const tag = `${label}: ${JSON.stringify(m.obj).slice(0, 220)}`;
    expect([m.status, m.obj.ok, m.obj.code, m.obj.step], tag).toEqual([i.status, false, 'LAUNCH_FAILED', 'launch']);
    expect(m.obj.message, `${label}: ข้อความเหมือนวิธีเดิม`).toBe(i.obj.message);
    expect(KINDS(m), `${label}: ไม่ส่งข้อความอะไรเข้า ProMaxx`).toEqual([]);
    expect(names(m).filter((x) => x === 'launch').length, `${label}: สั่งเปิดครั้งเดียว`).toBe(1);
    for (const x of REAL_INPUT) expect(names(m), `${label}: ${x}`).not.toContain(x);
    expect(m.hidden, `${label}: ไม่ค้างซ่อน`).toBe(false);
  }
});

test('12. กล่องข้อความของ ProMaxx โผล่กลางล็อกอิน (หลัง Tab ก่อนส่งรหัสผ่าน) = หยุด ไม่ส่งรหัสผ่าน ไม่ปิดกล่องแทนพนักงาน', () => {
  const hook = "orig = ui.post_key\ndef pk(*a, **k):\n    r = orig(*a, **k)\n    ui.dialogs_now = [('SeniorSoft ProMaxx', ('มีข้อผิดพลาดบางอย่าง',))]\n    return r\nui.post_key = pk";
  const r = scen({ uia: OK_ORDS, hook });
  expect([r.status >= 400, r.obj.ok, r.obj.code, r.obj.step], JSON.stringify(r.obj).slice(0, 220)).toEqual([true, false, 'UNEXPECTED_DIALOG', 'login']);
  expect(r.obj.message).toContain('มีข้อผิดพลาดบางอย่าง');
  expect(KINDS(r), 'ส่งชื่อผู้ใช้ + Tab แล้วหยุด ไม่มีรหัสผ่านหลุดไป').toEqual([...Array(USER_N).fill('char'), 'key']);
  expect(r.fields.password).toBe('');
  expect(r.login_clicks).toBe(0);
  expect(names(r), 'ไม่คลิก/ปิดกล่องแทนพนักงาน').not.toContain('click_button');
  expect(r.hidden).toBe(false);
});

test('12b. กล่องข้อความโผล่ "ระหว่างส่งรหัสผ่านทีละตัว" = หยุดทันที ไม่ส่งตัวที่เหลือ ไม่กด SIGN IN', () => {
  const hook = "pc = ui.post_char\ndef pc2(*a, **k):\n    r = pc(*a, **k)\n    if ui.post_count == " + (USER_N + 3) + ":\n        ui.dialogs_now = [('SeniorSoft ProMaxx', ('มีข้อผิดพลาดกลางทาง',))]\n    return r\nui.post_char = pc2";
  const r = scen({ uia: OK_ORDS, hook });
  expect([r.status >= 400, r.obj.ok, r.obj.code, r.obj.step], JSON.stringify(r.obj).slice(0, 220)).toEqual([true, false, 'UNEXPECTED_DIALOG', 'login']);
  expect(KINDS(r), 'ส่งชื่อผู้ใช้ + Tab + รหัสผ่าน 3 ตัวแล้วหยุด').toEqual([...Array(USER_N).fill('char'), 'key', 'char', 'char', 'char']);
  expect(r.login_clicks, 'ไม่กด SIGN IN').toBe(0);
  expect(names(r), 'ไม่ลองซ้ำด้วยเมาส์/คีย์').not.toContain('type_text');
});

test('13. ชื่อผู้ใช้ที่ ProMaxx แสดงต่างตัวพิมพ์ (ProMaxx แปลงเป็นตัวพิมพ์ใหญ่/เล็ก) = ยังถือว่าตรง · ต่างเนื้อหา = ไม่ตรง', () => {
  for (const c of ['upper', 'lower']) {
    const r = scen({ uia: { ...OK_ORDS, shown_case: c } });
    expectMessageLoginClean(r, `แสดงตัวพิมพ์ ${c}`);
  }
  const u = scen({ uia: { ...OK_ORDS, shown_case: 'upper' }, hook: "st.username = 'SomChai'; ui.user = 'SomChai'" });
  expectMessageLoginClean({ ...u, fields: { ...u.fields, username: 'somchai' } }, 'ชื่อผสมตัวพิมพ์ + ProMaxx แสดงตัวใหญ่');
  expect(u.fields.username, 'พิมพ์ตามที่ตั้งไว้ ไม่แปลงเอง').toBe('SomChai');
});

test('14. ตัดสินโหมดล็อกอิน (_decide_login_mode) ครบทุกเงื่อนไข · ด่านก่อนส่ง (_message_login_blocker) ตรวจทีละข้อ — ข้อความเหตุผลตรงตัว', () => {
  const r = runPy(`
import fake_ssmaxx_uia as fu, fake_ssmaxx as fk
def mk(uia=None, user='somchai', pw='s3cret!pw', settings=None, opts=None, **fake):
    sk = {'attach_existing': True, 'hide_after_login': True, 'login_mode': 'message'}
    sk.update(settings or {})
    base = {'logical_focus': True, 'focus_on_ready': True}
    base.update(uia or {})
    fake.setdefault('start_state', 'login')
    svc, ui, log, st = fu.make_uia(m, tmp, verified=True, user=user, password=pw, uia=base, settings_kw=sk, **fake)
    rn = m.Runner(ui, st, log, clock=ui.clock, sleep=ui.sleep, opts=m.JobOpts(**(opts or {})))
    return rn, ui
def decide(only=None, resume='', settings=None, opts=None):
    rn, ui = mk(settings=settings, opts=opts)
    rn.resume_from = resume
    rn._decide_login_mode(only)
    return rn._msg_login
out = dict(decide={})
D = out['decide']
D['base'] = decide()
D['resume_login'] = decide(resume='login')
D['resume_ready'] = decide(resume='ready')
D['only_step'] = decide(only='login')
D['dry_run'] = decide(opts={'dry_run': True})
D['input'] = decide(settings={'login_mode': 'input'})
D['no_hide'] = decide(settings={'hide_after_login': False})
svc, ui, log, st = fk.make(m, tmp, settings_kw={'login_mode': 'message', 'hide_after_login': True, 'attach_existing': True})     # ตัวต่อเดิม: ไม่มี post_char/post_key
rn = m.Runner(ui, st, log, clock=ui.clock, sleep=ui.sleep)
rn._decide_login_mode(None)
D['old_adapter'] = rn._msg_login
B = out['blocker'] = {}
def hidden(rn, ui, vis=False):
    rn._hidden.add(fu.MAIN_HWND); ui.hidden = not vis
rn, ui = mk(); hidden(rn, ui); B['ok'] = rn._message_login_blocker('login')
rn, ui = mk(); ui.hidden = False; B['not_hidden'] = rn._message_login_blocker('login')
rn, ui = mk(); hidden(rn, ui, True); B['visible'] = rn._message_login_blocker('login')
rn, ui = mk({'top_disabled': True}); hidden(rn, ui); B['locked'] = rn._message_login_blocker('login')
rn, ui = mk({'logical_focus': False}); hidden(rn, ui); ui.has_focus = False; B['nofocus'] = rn._message_login_blocker('login')
rn, ui = mk(pw='a\\tb'); hidden(rn, ui); B['ctrl_pw'] = rn._message_login_blocker('login')
rn, ui = mk(user='a\\x7fb'); hidden(rn, ui); B['ctrl_user'] = rn._message_login_blocker('login')
print(json.dumps(out, ensure_ascii=False))`);
  expect(r.decide, 'เปิดเฉพาะ: งานเต็ม + โหมด message + เปิดซ่อนหน้าต่าง + ไม่ใช่ล็อกอินแล้ว + ตัวต่อมี method ครบ').toEqual({
    base: true, resume_login: true, resume_ready: false, only_step: false, dry_run: false, input: false, no_hide: false, old_adapter: false });
  const B = r.blocker;
  expect(B.ok, 'ซ่อนแล้ว + ไม่ถูกล็อก + ช่องชื่อผู้ใช้ได้โฟกัส = ทำได้').toBe('');
  expect(B.not_hidden, 'หน้าต่างมองเห็นอยู่และเราไม่ได้ซ่อน').toBe('ซ่อนหน้าต่าง ProMaxx ไม่สำเร็จ');
  expect(B.visible, 'ซ่อนไว้แล้วแต่ยังมองเห็น (โผล่ซ้ำก่อนตรวจ)').toBe('หน้าต่าง ProMaxx ยังมองเห็นอยู่หลังสั่งซ่อน');
  expect(B.locked, 'มีกล่องโมดัลล็อกหน้าต่างหลัก').toBe('หน้าต่างหลักถูกล็อก (มีกล่องโมดัล)');
  expect(B.nofocus, 'ช่องชื่อผู้ใช้ไม่ได้โฟกัสแป้นพิมพ์ (รอครบเวลา)').toBe('ช่องชื่อผู้ใช้ยังไม่รับโฟกัสแป้นพิมพ์ ภายใน 8 วินาที');
  expect(B.ctrl_pw).toBe('รหัสผ่าน ว่าง/มีอักขระควบคุม');
  expect(B.ctrl_user).toBe('ชื่อผู้ใช้ ว่าง/มีอักขระควบคุม');
});

test('15. ProMaxx ค้างที่หน้า Login แต่ช่องชื่อผู้ใช้มีข้อความค้างอยู่ (รอบก่อนหยุดกลางทาง) = ปฏิเสธ SESSION_NOT_READY ไม่ส่งข้อความ/ไม่พิมพ์ — ทั้งโหมดข้อความและเมาส์/คีย์จริง · หน้า Login สะอาดผ่านได้', () => {
  // ก) โหมดข้อความ: รอบแรกตัวอักษรตกหาย → หยุดทิ้งข้อความค้างในช่อง → กดปุ่มใหม่ต้องไม่พิมพ์ซ้ำ (ไม่งั้นได้ชื่อผิดแล้วล็อกอินพลาด)
  const a = scen({ uia: { ...OK_ORDS, post_drop_at: 3 }, again: true });
  expect([a.obj.ok, a.obj.code], JSON.stringify(a.obj).slice(0, 200)).toEqual([false, 'STEP_FAILED']);
  expect([a.again.status, a.again.ok, a.again.code], JSON.stringify(a.again)).toEqual([409, false, 'SESSION_NOT_READY']);
  expect(a.again.message).toBe('หน้า Login มีข้อความค้างอยู่ — ปิด ProMaxx แล้วกดใหม่');
  expect(effLen(a.again.message), 'ข้อความสั้นพอให้หน้าเว็บโชว์ครบ (45)').toBeLessThanOrEqual(45);
  expect(a.again.new_posted, 'ไม่ส่งข้อความเพิ่ม').toBe(0);
  for (const x of [...REAL_INPUT, 'hide_window', 'uia_act', 'focus', 'launch']) expect(a.again.new_calls, `รอบสอง: ไม่แตะ ProMaxx (${x})`).not.toContain(x);
  expect(a.log).toContain('ช่องชื่อผู้ใช้มีข้อความค้างอยู่');
  // ข) โหมดเมาส์/คีย์จริง ก็ปฏิเสธเหมือนกัน (ไม่พิมพ์ต่อท้ายข้อความเดิม)
  const b = scen({ settings: { login_mode: 'input' }, fake: { start_state: 'login' }, uia: OK_ORDS,
    hook: "ui.fields['username']='abc'; ui.field_units['username']=[97, 98, 99]; ui.focus_field='password'" });
  expect([b.status, b.obj.code, b.obj.step, b.obj.message]).toEqual([409, 'SESSION_NOT_READY', 'preflight', 'หน้า Login มีข้อความค้างอยู่ — ปิด ProMaxx แล้วกดใหม่']);
  for (const x of [...REAL_INPUT, 'uia_act']) expect(names(b), x).not.toContain(x);
  // ค) หน้า Login สะอาด (ช่องชื่อผู้ใช้ว่าง แค่โฟกัสอยู่ที่ช่องรหัสผ่าน) = ไม่ปฏิเสธ · โหมดข้อความถอยไปเมาส์/คีย์จริงเพราะช่องชื่อผู้ใช้ไม่ได้โฟกัส
  const c = scen({ fake: { start_state: 'login' }, uia: OK_ORDS, hook: "ui.focus_field='password'" });
  expect([c.status, c.obj.ok, c.obj.attached], JSON.stringify(c.obj).slice(0, 200)).toEqual([200, true, 'login']);
  expect(KINDS(c), 'ยังไม่ได้ส่งอะไรเข้าช่อง').toEqual([]);
  expect(names(c).filter((x) => x === 'type_text').length, 'ล็อกอินด้วยวิธีเดิม').toBe(2);
  expect(c.fields).toEqual({ username: 'somchai', password: 's3cret!pw' });
});

test('16. ProMaxx ถือ foreground ตั้งแต่ก่อนเริ่มงาน (ไม่ใช่เบราว์เซอร์) = ไม่มีหน้าต่างเดิมให้คืน — ห้าม "คืนโฟกัส" ให้ ProMaxx เอง', () => {
  const r = scen({ fake: { start_state: 'main' }, uia: { ...OK_ORDS, hide_keeps_fg: true }, hook: 'ui.has_focus = True' });
  expect([r.status, r.obj.ok, r.obj.attached], JSON.stringify(r.obj).slice(0, 200)).toEqual([200, true, 'ready']);
  expect(names(r), 'ไม่มีหน้าต่างเดิมของพนักงานให้คืน').not.toContain('focus');
});

test('17. ซ่อนเฉพาะหน้าต่างหลัก — หน้าต่างอื่นของ ProMaxx ที่มองเห็นอยู่ (กล่องป๊อปอัพ/หน้าต่างรอง) ต้องไม่ถูกซ่อน', () => {
  const r = scen({ uia: { ...OK_ORDS, extra_window: true } });
  expectMessageLoginClean(r, 'มีหน้าต่างอื่นแสดงอยู่');
  const hides = r.calls.filter((c) => c[0] === 'hide_window');
  expect(hides.length).toBeGreaterThanOrEqual(1);
  expect(hides.every((c) => c[1] === '100'), `สั่งซ่อนเฉพาะหน้าต่างหลัก (hwnd 100): ${JSON.stringify(hides)}`).toBe(true);
});

test('18. สั่งซ่อนสำเร็จบ้างไม่สำเร็จบ้าง — ตัวนับ "ซ่อนไม่ได้ติดกัน" ต้องรีเซ็ตเมื่อซ่อนได้ (ไม่เลิกเฝ้าก่อนเวลา) · ซ่อนไม่ได้ติดกัน 3 ครั้งล้วน = เลิกเฝ้า', () => {
  const r = scen({ uia: { ...OK_ORDS, hide_script: [false, false, true, false, false, true], reshow_after: [5.5] } });
  expectMessageLoginClean(r, 'ซ่อนติดๆ ดับๆ');
  expect(r.log, 'ล้ม 2 ติด → สำเร็จ → ล้ม 2 ติด ไม่ถึง 3 ติด').not.toContain('เลิกเฝ้าซ่อน');
  expect(names(r).filter((x) => x === 'hide_window').length, 'สั่งซ่อนทั้งหมด 6 ครั้งตามสคริปต์').toBeGreaterThanOrEqual(6);
  const r2 = scen({ uia: { ...OK_ORDS, hide_script: [false, false, false, true] } });
  expect([r2.status, r2.obj.ok]).toEqual([200, true]);
  expect(r2.log, 'ล้ม 3 ติด = เลิกเฝ้า').toContain('เลิกเฝ้าซ่อน');
  expect(KINDS(r2), 'ก่อนส่งอะไรเลิกเฝ้า = ใช้วิธีเดิม ไม่ส่งข้อความ').toEqual([]);
});

test('19. ProMaxx แสดงหน้าต่างเองซ้ำหลังซ่อนครั้งแรก "ก่อนเริ่มส่งข้อความ" — ซ่อนอีกก่อนตัวอักษรแรก (ค้างเห็น ≤ 0.2 วินาที)', () => {
  const r = scen({ uia: { ...OK_ORDS, reshow_after: [5.4] } });
  expectMessageLoginClean(r, 'โผล่ก่อนเริ่มพิมพ์');
  expect(r.show_log.length, 'โผล่ 2 ครั้ง (ครั้งแรก + ก่อนเริ่มพิมพ์)').toBe(2);
  expect(r.show_posted, 'ครั้งที่ 2 โผล่ตอนยังไม่ได้ส่งอะไรเลย (ถ้าไม่ใช่ = จังหวะในตัวต่อเลื่อน เทสนี้ไม่ได้ตรึงสิ่งที่ตั้งใจแล้ว)').toEqual([0, 0]);
  expect(Math.max(...r.exposures), JSON.stringify(r.exposures)).toBeLessThanOrEqual(0.2);
});

test('19b. ★ ProMaxx แสดงหน้าต่างเอง "กลางการพิมพ์จริง" (กลางชื่อผู้ใช้ + กลางรหัสผ่าน) — ต้องซ่อนอีกภายในตัวอักษรถัดไป (ค้างเห็น ≤ 0.2 วินาที) ไม่รอถึงหลัง Tab/หลังส่งรหัสผ่านครบ', () => {
  // เวลาปลอมของตัวต่อ: หน้า Login พร้อม 2.0 → โผล่ครั้งแรก +5.0 → ชื่อผู้ใช้ ≈ 7.45–7.93 → Tab 8.01 → รหัสผ่าน ≈ 9.01–9.65 · +5.6 = 7.6 (กลางชื่อผู้ใช้) · +7.2 = 9.2 (กลางรหัสผ่าน)
  // บั๊กจงใจ P4 (ลบ _hide_watch ในลูป _post_units) รอดเทส 19 เดิมเพราะ 19 โผล่ "ก่อนเริ่มพิมพ์" ไม่ใช่กลางพิมพ์ — ข้อนี้ตรึงของจริง
  // (วัดกับสำเนา P4 เมื่อ 10 พ.ย. 2026: ตัวจริงค้างเห็น ≤ 0.05 วินาที · P4 ค้างเห็น 1.1–1.4 วินาที)
  const r = scen({ uia: { ...OK_ORDS, reshow_after: [5.6, 7.2] } });
  expectMessageLoginClean(r, 'โผล่กลางพิมพ์');
  expect(r.show_log.length, 'โผล่ 3 ครั้ง (ครั้งแรก + กลางชื่อผู้ใช้ + กลางรหัสผ่าน)').toBe(3);
  const [s0, s1, s2] = r.show_posted;
  expect(s0, 'ครั้งแรกโผล่ก่อนส่งอะไร').toBe(0);
  expect(s1 >= 1 && s1 <= USER_N - 1, `ครั้งที่ 2 ต้องโผล่กลางชื่อผู้ใช้ (ส่งไปแล้ว ${s1} จาก ${USER_N} ตัว)`).toBe(true);
  expect(s2 >= USER_N + 2 && s2 <= USER_N + PASS_N, `ครั้งที่ 3 ต้องโผล่กลางรหัสผ่าน (ส่งไปแล้ว ${s2} รายการ = ชื่อ ${USER_N} + Tab 1 + รหัสผ่านบางส่วน)`).toBe(true);
  expect(Math.max(...r.exposures), JSON.stringify(r.exposures)).toBeLessThanOrEqual(0.2);
});

test('20. ★ ProMaxx (ที่ซ่อนอยู่) ดึง foreground ของตัวเองหลังกด SIGN IN — เจอจริง 5 พ.ย. 2026 ถือค้าง ~18 วินาที · ตัวช่วยต้องคืนให้เบราว์เซอร์ทันที ไม่รอจนจบงาน', () => {
  const r = scen({ uia: { ...OK_ORDS, grab_fg_on_login: true } });
  expect([r.status, r.obj.ok], JSON.stringify(r.obj).slice(0, 200)).toEqual([200, true]);
  const fi = r.calls.map((c, i) => [c[0], c[1], i]).filter((x) => x[0] === 'focus');
  expect(fi.map((x) => x[1]), 'คืนโฟกัสให้เบราว์เซอร์ (hwnd 900) ครั้งเดียว').toEqual(['900']);
  const acts = r.calls.map((c, i) => [c[0], c[4], i]).filter((x) => x[0] === 'uia_act');
  const loginIdx = acts.find((x) => x[1] === "('cb_Login',)")[2];
  const menuIdx = acts[1][2];
  expect(fi[0][2] > loginIdx && fi[0][2] < menuIdx, `คืนทันทีหลังกด SIGN IN ก่อนสั่งเมนู (login=${loginIdx} focus=${fi[0][2]} menu=${menuIdx})`).toBe(true);
  expect(r.has_focus, 'จบแล้ว foreground ไม่ใช่ ProMaxx').toBe(false);
  expect(r.log).toContain('คืนโฟกัสแป้นพิมพ์ให้หน้าต่างเดิม');
  // ถูกแย่งระหว่างรอ (ไม่ใช่ทันทีหลังสั่ง) ก็คืน: ProMaxx ดึง foreground ตอนรอเมนูหลักขึ้น
  const w = scen({ uia: { ...OK_ORDS, grab_fg_on_login: true }, settings: { hide_after_login: true }, hook: "ui.f['login_delay'] = 3.0" });
  expect(w.calls.filter((c) => c[0] === 'focus').map((c) => c[1]), 'login_delay นานขึ้น (ProMaxx ดึงตอนขึ้นเมนูหลัก)').toEqual(['900']);
  // ไม่ถูกแย่ง = ไม่แตะโฟกัสเลย
  const n = scen({ uia: OK_ORDS });
  expect(names(n)).not.toContain('focus');
});

test('21. ProMaxx ที่ซ่อนอยู่แย่ง foreground "ระหว่างรอเมนูหลักขึ้น" (ไม่ใช่ทันทีหลังสั่ง) — ตัวช่วยต้องคืนภายใน ≤ 1 วินาทีหลังถูกแย่ง ไม่รอจนจบขั้น/จบงาน', () => {
  const r = scen({ uia: { ...OK_ORDS, grab_fg_after: 1.5 }, hook: "ui.f['login_delay'] = 4.0; ui.f['uia_cost'] = 0.3" });
  expect([r.status, r.obj.ok], JSON.stringify(r.obj).slice(0, 200)).toEqual([200, true]);
  expect(r.grab_times.length, 'ถูกแย่ง 1 ครั้ง').toBe(1);
  expect(r.focus_times.length, 'คืนโฟกัส 1 ครั้ง').toBe(1);
  expect(r.focus_times[0] - r.grab_times[0], `ความหน่วงในการคืน (วินาทีของเวลาปลอม) grab=${r.grab_times} focus=${r.focus_times}`).toBeLessThanOrEqual(1.0);
  expect(r.focus_times[0] >= r.grab_times[0]).toBe(true);
  expect(r.has_focus).toBe(false);
});

test('22. ★ ProMaxx ดึง foreground ทุกครั้งที่ถูกสั่ง (ตรงกับที่เจอจริง: SIGN IN / เมนู / ปุ่ม O) — ต้องมีการคืนโฟกัสหลังทุกคำสั่ง ก่อนคำสั่งถัดไป และตอนจบ foreground เป็นของเบราว์เซอร์', () => {
  const r = scen({ uia: { ...OK_ORDS, grab_fg_on_act: true } });
  expect([r.status, r.obj.ok], JSON.stringify(r.obj).slice(0, 200)).toEqual([200, true]);
  const seq = r.calls.map((c) => c[0]).filter((x) => x === 'uia_act' || x === 'focus' || x === 'show_window_back');
  expect(seq, 'หลัง uia_act ทุกครั้งต้องมี focus (คืนเบราว์เซอร์) ก่อน uia_act ถัดไป').toEqual(['uia_act', 'focus', 'uia_act', 'focus', 'uia_act', 'focus', 'show_window_back']);
  expect(r.calls.filter((c) => c[0] === 'focus').every((c) => c[1] === '900')).toBe(true);
  expect(r.has_focus, 'จบงานแล้วแป้นพิมพ์อยู่ที่เบราว์เซอร์').toBe(false);
  expect(r.grab_times.length).toBe(3);
});
