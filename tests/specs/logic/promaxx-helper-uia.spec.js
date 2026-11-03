// PromaxxHelper — ส่วน UIA (ssmaxx.exe เป็นแอป WPF: ข้างในไม่มี HWND จึงหาเป้าด้วย UI Automation แล้วคลิกเมาส์จริงที่กึ่งกลางพิกัด)
// (3 พ.ย. 2026 · ขั้นที่ 1: ไปให้ถึงปุ่ม "นำเข้าไฟล์เอกสาร" แล้วหยุด)
//
// ตัวต่อปลอม tests/lib/fake_ssmaxx_uia.py จำลองโครงสร้างที่ตรวจจริง (ช่องล็อกอินสลับชนิดตามโฟกัส · ปุ่ม I/O ถูกเลื่อนออกนอกกรอบแต่ IsOffscreen=False ·
// ปุ่มนำเข้าติดกับปุ่มลบ/ยกเลิกรายการ · กล่อง #32770 Select File) และใช้ STEP_SPECS ที่ "ส่งมอบจริง" (ไม่ใช่ชุดตัวอย่างของเทส)
// ⚠️ ไม่พิสูจน์ว่าคลิก/พิมพ์จริงบน ssmaxx.exe ได้ผลตามนี้ — ส่วนนั้นต้องตรวจบนเครื่องจริง (--dry-run → คลิกทีละขั้น) · ตัวอ่าน PowerShell จริงตรวจแยกกับ ProMaxx จริง
//
// ตรึง: 1. เส้นทางปกติ ORDS/IRPS ตาม spec จริง · 2. ★ ด่านกันพลาดทุกแบบ (ซ้ำ · นอกกรอบ · HelpText ไม่ตรง · ฟอร์มผิดคลาส · โมดัลล็อก · เป้าขยับ)
//   หยุดโดยไม่คลิกเป้าที่ผิด · 3. โฟกัสไม่ถึงช่อง · รหัสผิดไม่ retry · UIA ล้ม · 4. dry-run + หลักฐานมี UIA dump · 5. ตัวช่วยย่อย
const { test, expect } = require('@playwright/test');
const { runPy } = require('../../lib/promaxx-helper-harness');

const SCEN = String.raw`
import fake_ssmaxx_uia as fu
fake = dict(p.get('fake') or {})
svc, ui, log, st = fu.make_uia(m, tmp, verified=p.get('verified', True), user=p.get('user', 'somchai'),
    password=p.get('password', 's3cret!pw'), uia=p.get('uia'), **fake)
if p.get('ui_password'): ui.password = p['ui_password']
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
out = dict(status=status, obj=obj, acts=ui.acts(), calls=[[str(x) for x in c] for c in ui.calls], clicked=ui.clicked, misfires=ui.misfires,
    fields=ui.fields, state=ui.state, stage=ui.stage, after_import=ui.acts_after_import, ev=ev, shots=ui.shots,
    leak=bool(p.get('password', 's3cret!pw') in blob), uia_calls=ui.uia_calls, login_clicks=ui.login_clicks, log='\n'.join(log.lines))
print(json.dumps(out, ensure_ascii=False, default=str))
`;
const scen = (payload = {}) => runPy(SCEN, payload);
const count = (acts, n) => acts.filter((a) => a === n).length;
const FORM = (menu, letter) => ({ start_state: 'doc', start_doc_menu: menu, start_letter: letter });   // เริ่มที่ฟอร์มที่เปิดแล้ว (เมนูถูกเลื่อนออกนอกกรอบ)
const MENU = (menu) => ({ start_state: 'doc', start_doc_menu: menu });                                  // เริ่มที่หน้าเมนูย่อย

for (const [type, menu, letter] of [['ORDS', 'เอกสารจ่าย', 'O'], ['IRPS', 'เอกสารรับ', 'I']]) {
  test(`1. ★ เส้นทางปกติ ${type} ตาม STEP_SPECS ที่ส่งมอบ — คลิกเป้าถูกตัว · พิมพ์ลงช่องที่โฟกัสแล้ว · รหัสครั้งเดียว · หยุดที่กล่อง Select File ไม่มี input เพิ่ม`, async () => {
    const r = scen({ type });
    expect([r.status, r.obj.ok, r.obj.reached]).toEqual([200, true, 'import-button']);
    expect(r.obj.steps.map((s) => s.name)).toEqual(['launch', 'login', 'menu', 'doc-button', 'import-button']);
    expect(r.acts, 'ลำดับลงมือเป๊ะ: เปิด → โฟกัส → คลิกช่องชื่อ → พิมพ์ → คลิกช่องรหัส → พิมพ์ → คลิก SIGN IN → เมนู → ปุ่ม I/O → ปุ่มนำเข้า')
      .toEqual(['launch', 'focus', 'click_at', 'type_text', 'click_at', 'type_text', 'click_at', 'click_at', 'click_at', 'click_at']);
    expect(r.clicked, 'องค์ประกอบที่ถูกคลิกจริงตามลำดับ').toEqual(['cf_empid:1', 'cf_pass:1', 'cb_Login', `ListItem:${menu}`, letter, 'uo_tran_bt_import']);
    expect(r.misfires, 'ไม่พิมพ์ลงช่องที่ไม่ได้โฟกัส · ไม่กดปุ่มข้างเคียง (แทรก/ลบ/ยกเลิก/อ้างอิง)').toEqual([]);
    expect(r.fields).toEqual({ username: 'somchai', password: 's3cret!pw' });
    expect(count(r.acts, 'type_text'), 'พิมพ์รหัสครั้งเดียว').toBe(2);
    const last = r.calls.filter((c) => c[0] === 'click_at').pop();
    expect(last.slice(1), 'คลิกปุ่มนำเข้าที่กึ่งกลางพิกัดจาก UIA (1591..1611, 256..276)').toEqual(['1601', '266']);
    expect([r.state, r.stage, r.after_import], 'จบที่กล่อง Select File · ไม่มี input หลังนั้น').toEqual(['import', 'form', 0]);
    expect(r.leak, 'รหัสผ่านไม่หลุดลง log/ผลลัพธ์/หลักฐาน').toBe(false);
    expect(r.uia_calls).toBeGreaterThan(8);
  });
}

test('2. ★ ด่านกันพลาด — หยุดโดยไม่คลิกเป้าที่ผิด (ซ้ำ · นอกกรอบหน้าต่าง · HelpText ไม่ตรง · ฟอร์มผิดคลาส · โมดัลล็อก · เป้าขยับ)', async () => {
  const stop = (r, code, step) => {
    expect([r.status, r.obj.ok, r.obj.code, r.obj.step], JSON.stringify(r.obj)).toEqual([500, false, code, step]);
    expect(r.clicked, 'ห้ามคลิกปุ่มนำเข้า/ลบ/ยกเลิกรายการเมื่อด่านไม่ผ่าน').not.toContain('uo_tran_bt_import');
    expect(r.misfires).toEqual([]);
  };
  // ปุ่ม SIGN IN ซ้ำ 2 ตัว → ไม่คลิกเดา (ล็อกอินไม่ถูกกด)
  const dup = scen({ uia: { dup_login_btn: true } });
  stop(dup, 'LOCATOR_NOT_UNIQUE', 'login');
  expect(dup.login_clicks).toBe(0);
  expect(dup.clicked).not.toContain('cb_Login');
  // HelpText ของปุ่มนำเข้าไม่ตรง (เช่น id สลับกับปุ่มลบรายการ) → ไม่ถึงขั้นคลิกปุ่มนำเข้า
  const help = scen({ uia: { import_help: 'ลบรายการ' } });
  stop(help, 'POSTCONDITION_FAILED', 'doc-button');
  expect(help.state, 'ไม่เปิดกล่อง Select File').not.toBe('import');
  // ฟอร์มผิดคลาส (ฟอร์มโอนสินค้า pn_trans_tb_out มีปุ่มนำเข้า id เดียวกัน) → หยุด
  stop(scen({ uia: { form_cls_override: 'pn_trans_tb_out' } }), 'POSTCONDITION_FAILED', 'doc-button');
  // ขั้นนำเข้าแต่ยังอยู่หน้าเมนูย่อย (ยังไม่มีฟอร์ม) → ไม่คลิกอะไร
  const early = scen({ only: 'import-button', fake: MENU('เอกสารจ่าย') });
  stop(early, 'PRECONDITION_FAILED', 'import-button');
  expect(early.acts).toEqual([]);
  // ปุ่ม O อยู่นอกกรอบหน้าต่างแต่ IsOffscreen=False (หลังเปิดฟอร์ม) → ต้องถือว่ามองไม่เห็น ไม่คลิก
  const outside = scen({ only: 'doc-button', fake: FORM('เอกสารจ่าย', 'O') });
  stop(outside, 'PRECONDITION_FAILED', 'doc-button');
  expect(outside.acts, 'ไม่คลิกลงไปนอกหน้าต่าง').toEqual([]);
  // หน้าต่างหลักถูกล็อก (มีกล่องโมดัลแต่ไม่ใช่ #32770) → ไม่คลิก
  const modal = scen({ only: 'import-button', fake: FORM('เอกสารจ่าย', 'O'), uia: { top_disabled: true } });
  stop(modal, 'UNEXPECTED_DIALOG', 'import-button');
  expect(modal.acts).toEqual([]);
  // เป้าขยับระหว่างเตรียมคลิก (reverify) → INTERFERENCE ไม่คลิกที่เดิม
  const drift = scen({ only: 'import-button', fake: FORM('เอกสารจ่าย', 'O'), uia: { drift_on_move: true }, opts: { hover_ms: 100 } });
  stop(drift, 'INTERFERENCE', 'import-button');
  expect(drift.acts, 'ขยับเมาส์ไปที่เป้าแต่ไม่กดปุ่ม').toEqual(['move_to']);
  expect(drift.obj.message).toContain('ขยับ');
});

test('3. ★ รหัสผ่าน/โฟกัส — ไม่พิมพ์ถ้าช่องไม่รับโฟกัส · รหัสผิดไม่ลองซ้ำ · UIA ล้มหยุด (ล้มชั่วคราวทนได้)', async () => {
  // ช่องไม่รับโฟกัสหลังคลิก → ห้ามพิมพ์ (ไม่ส่งชื่อผู้ใช้/รหัสลงที่อื่น)
  const nf = scen({ uia: { focus_never: true } });
  expect([nf.obj.code, nf.obj.step]).toEqual(['PRECONDITION_FAILED', 'login']);
  expect(nf.obj.message).toContain('ไม่พิมพ์');
  expect(count(nf.acts, 'type_text')).toBe(0);
  expect(nf.leak).toBe(false);
  // ช่องถูกสร้างแล้วแต่แป้นพิมพ์ยังไม่อยู่ที่ช่อง (เช่นหน้าต่างไม่ใช่ foreground) → ห้ามพิมพ์
  const uf = scen({ uia: { edit_unfocused: true } });
  expect([uf.obj.code, uf.obj.step]).toEqual(['PRECONDITION_FAILED', 'login']);
  expect(count(uf.acts, 'type_text'), 'ไม่พิมพ์เมื่อช่องไม่ได้โฟกัสแป้นพิมพ์').toBe(0);
  // ช่องรหัสผ่านเป็น TextBox ธรรมดา (ไม่ใช่ PasswordBox) → ห้ามพิมพ์รหัสลงช่องที่ไม่ปิดบังตัวอักษร (พิมพ์ได้แค่ชื่อผู้ใช้ที่ผ่านด่านก่อนหน้า)
  const pp = scen({ uia: { pass_plain: true } });
  expect([pp.obj.code, pp.obj.step]).toEqual(['PRECONDITION_FAILED', 'login']);
  expect(pp.fields.password, 'รหัสผ่านไม่ถูกพิมพ์').toBe('');
  expect(count(pp.acts, 'type_text'), 'พิมพ์แค่ชื่อผู้ใช้ 1 ครั้ง').toBe(1);
  expect(pp.leak).toBe(false);
  // รหัสผิด → LOGIN_FAILED · กด SIGN IN ครั้งเดียว · พิมพ์แค่ชุดเดียว (ไม่ retry)
  const bad = scen({ ui_password: 'อื่น' });
  expect([bad.status, bad.obj.code, bad.obj.step]).toEqual([500, 'LOGIN_FAILED', 'login']);
  expect(bad.login_clicks).toBe(1);
  expect(count(bad.acts, 'type_text')).toBe(2);
  expect(bad.leak).toBe(false);
  expect(bad.ev, 'เก็บหลักฐานตอนล้ม').not.toEqual({});
  // UIA ล้มถาวร → UIA_ERROR ที่ขั้น launch ไม่ลงมือต่อ · ล้ม 2 ครั้งแล้วหาย → ผ่านปกติ
  const dead = scen({ uia: { uia_always_fail: true } });
  expect([dead.status, dead.obj.code, dead.obj.step]).toEqual([500, 'UIA_ERROR', 'launch']);
  expect(dead.acts, 'ไม่คลิก/พิมพ์เมื่ออ่านหน้าจอไม่ได้').toEqual(['launch']);
  const flaky = scen({ uia: { uia_fail_first: 2 } });
  expect(flaky.status).toBe(200);
});

test('4. dry-run — ไม่ลงมือ · วาดกากบาทที่กึ่งกลางเป้าจาก UIA · และหลักฐานตอนล้มมี UIA dump', async () => {
  const d = scen({ only: 'import-button', fake: FORM('เอกสารจ่าย', 'O'), opts: { dry_run: true } });
  expect([d.status, d.obj.dryRun]).toEqual([200, true]);
  expect(d.acts, 'dry-run ไม่คลิก/พิมพ์/โฟกัส').toEqual([]);
  expect(d.shots).toHaveLength(1);
  const marks = d.shots[0].marks;
  expect(marks.find((x) => x.type === 'point').xy).toEqual([1601, 266]);
  expect(marks.find((x) => x.type === 'rect').rect).toEqual([1591, 256, 1611, 276]);
  const f = scen({ uia: { import_help: 'ลบรายการ' } });
  const dir = Object.keys(f.ev).find((k) => k.endsWith('POSTCONDITION_FAILED'));
  expect(dir, 'มีโฟลเดอร์หลักฐาน').toBeTruthy();
  expect(f.ev[dir], 'มี UIA dump ของหน้าต่างหลัก').toContain('uia_1_100.txt');
});

test('4b. ตัวหาเป้า (_resolve) — เป้าที่พบแต่มองไม่เห็น/ถูกตัดด้วยเงื่อนไข ต้องไม่ถูกคลิก และข้อความต้องบอกสาเหตุ', async () => {
  const r = runPy(`
import fake_ssmaxx_uia as fu
svc, ui, log, st = fu.make_uia(m, tmp, start_state='doc', start_doc_menu='เอกสารจ่าย', start_letter='O')
run = m.Runner(ui, st, log)
run.tokens = dict(m.DOC_TYPES['ORDS'])
top = [t for t in ui.top_windows([ui.PID]) if t.visible and t.w > 50][0]
def tryres(sel):
    try:
        res = run._resolve(dict(sel, kind='uia'), 'x'); return dict(ok=True, point=res.point)
    except m.HelperError as e:
        return dict(ok=False, code=e.code, msg=e.message)
sp = m._fmt(m.STEP_SPECS, run.tokens)
print(json.dumps(dict(
  shifted=tryres(sp['doc-button']['actions'][0]['target']),
  wronghelp=tryres(dict(sp['import-button']['actions'][0]['target'], help='ไม่ตรง')),
  wrongparent=tryres(dict(sp['import-button']['actions'][0]['target'], ancestor={'cls': 'pn_trans_tb_out'})),
  good=tryres(sp['import-button']['actions'][0]['target']),
), ensure_ascii=False))`);
  expect(r.shifted.ok, 'ปุ่ม O ถูกเลื่อนไปนอกกรอบหน้าต่าง (IsOffscreen=False) → ห้ามได้พิกัดให้คลิก').toBe(false);
  expect([r.shifted.code, r.shifted.msg]).toEqual(['LOCATOR_NOT_FOUND', expect.stringContaining('ไม่ได้อยู่ในหน้าจอ')]);
  expect(r.wronghelp.ok).toBe(false);
  expect(r.wronghelp.msg, 'ข้อความบอก HelpText ที่เจอจริง').toContain('HelpText');
  expect(r.wrongparent.ok).toBe(false);
  expect(r.wrongparent.msg, 'ข้อความบอกหน้าแม่ที่เจอจริง').toContain('หน้าแม่');
  expect(r.good.ok).toBe(true);
  expect(r.good.point).toEqual([1601, 266]);
});

test('4c. focus() ของ WinAdapter — ไม่ย่อหน้าต่างที่ขยายเต็มจออยู่ · กู้เฉพาะหน้าต่างที่ถูกย่อ (เฉพาะ Windows · ตัวต่อปลอมแทน win32)', async () => {
  test.skip(process.platform !== 'win32', 'focus() เรียก ctypes.windll (AttachThreadInput) — รันได้เฉพาะ Windows');
  const r = runPy(`
import promaxx_win as w, types
class G:
    def __init__(self, iconic): self.iconic, self.calls = iconic, []
    def IsIconic(self, h): return self.iconic
    def ShowWindow(self, h, cmd): self.calls.append(('ShowWindow', cmd))
    def SetForegroundWindow(self, h): self.calls.append(('SetForegroundWindow',))
    def GetForegroundWindow(self): return 1
class P:
    def GetWindowThreadProcessId(self, h): return (1, 2)
def run(iconic):
    a = object.__new__(w.WinAdapter)
    a.gui, a.proc, a.con = G(iconic), P(), types.SimpleNamespace(SW_RESTORE=9, SW_SHOW=5)
    import time; orig = time.sleep; time.sleep = lambda s: None
    try: a.focus(12345)
    finally: time.sleep = orig
    return a.gui.calls
print(json.dumps(dict(maximized=run(False), minimized=run(True))))`);
  expect(r.maximized.filter((c) => c[0] === 'ShowWindow'), 'หน้าต่างที่ไม่ได้ถูกย่อ ห้ามเรียก ShowWindow (SW_RESTORE จะย่อหน้าต่างที่ขยายเต็มจอ)').toEqual([]);
  expect(r.maximized.some((c) => c[0] === 'SetForegroundWindow'), 'ยังดึงขึ้นหน้าตามเดิม').toBe(true);
  expect(r.minimized.filter((c) => c[0] === 'ShowWindow').every((c) => c[1] === 9) && r.minimized.some((c) => c[0] === 'ShowWindow'), 'หน้าต่างที่ถูกย่อต้องถูกกู้ (SW_RESTORE)').toBe(true);
});

test('5. ตัวช่วยย่อย — _visible_in (กรอบ/กึ่งกลาง/สัดส่วน/ขนาด) · ค่าโทเคนของชนิดเอกสารไม่มีอักขระพิเศษของ regex · spec ที่ส่งมอบปลอดภัย', async () => {
  const r = runPy(`
W = (-8, -8, 1928, 1040)
vi = lambda rect: m._visible_in(rect, W)
tok_ok = all(__import__('re').escape(v) == v for d in m.DOC_TYPES.values() for v in d.values())
specs = m.STEP_SPECS
def targets(sp):
    return [a['target'] for s in sp.values() for a in s.get('actions', []) if a['do'] == 'click']
acts = [a for s in specs.values() for a in s.get('actions', [])]
ids_numeric = []
def walk(o):
    if isinstance(o, dict):
        for k, v in o.items():
            if k == 'id':
                for x in ([v] if isinstance(v, str) else v):
                    if str(x).isdigit(): ids_numeric.append(x)
            walk(v)
    elif isinstance(o, list):
        for x in o: walk(x)
walk(specs)
type_prev = []
for i, a in enumerate(specs['login']['actions']):
    if a['do'] == 'type': type_prev.append(specs['login']['actions'][i - 1]['do'])
print(json.dumps(dict(
  inside=vi((1591, 256, 1611, 276)), shifted=vi((2150, 192, 2400, 312)), none=vi(None), tiny=vi((10, 10, 12, 12)),
  half=vi((1900, 100, 1940, 140)), edge_ok=vi((1910, 100, 1930, 140)), above=vi((1599, -27, 1659, 23)),
  tok_ok=tok_ok, kinds=sorted({t['kind'] for t in targets(specs)}), reverify=[t.get('reverify') for t in targets({'i': specs['import-button']})],
  ids_numeric=ids_numeric, type_prev=type_prev, imp_allow=specs['import-button']['allow_dialogs'],
  imp_sel=[t for t in targets({'i': specs['import-button']})][0],
  keys=[a for a in acts if a['do'] == 'key'],
), ensure_ascii=False))`);
  expect(r.inside).toBe(true);
  expect(r.shifted, 'ปุ่มที่ถูกเลื่อนไปนอกกรอบ x=2150 ต้องไม่ถือว่ามองเห็น').toBe(false);
  expect([r.none, r.tiny]).toEqual([false, false]);
  expect([r.half, r.edge_ok, r.above], 'ครึ่งหนึ่งนอกกรอบ = ไม่ผ่าน · ส่วนใหญ่อยู่ในกรอบ = ผ่าน · กึ่งกลางอยู่เหนือกรอบ = ไม่ผ่าน').toEqual([false, true, false]);
  expect(r.tok_ok, 'ค่าใน DOC_TYPES ต้องไม่ถูก re.escape เปลี่ยน (ถูกแทนเข้า spec ผ่าน _fmt)').toBe(true);
  expect(r.kinds, 'ทุกการคลิกใน spec ที่ส่งมอบต้องเป็น UIA (ไม่มีพิกัดเศษส่วน/เมนู Win32)').toEqual(['uia']);
  expect(r.reverify, 'ปุ่มนำเข้า (ติดปุ่มลบ/ยกเลิก) ต้องอ่านเป้าซ้ำก่อนกด').toEqual([true]);
  expect(r.ids_numeric, 'ห้ามใช้ id ที่เป็นตัวเลข (เปลี่ยนทุกครั้งที่โหลดหน้า)').toEqual([]);
  expect(r.type_prev, 'ก่อนพิมพ์ทุกครั้งต้องรอให้ช่องรับโฟกัส (await)').toEqual(['await', 'await']);
  expect(r.keys, 'ไม่กด Enter/คีย์ใดๆ ใน spec (คลิก SIGN IN เท่านั้น)').toEqual([]);
  expect(r.imp_allow, 'อนุญาตเฉพาะกล่อง Select File').toEqual(['^Select File\\b']);
  expect(r.imp_sel.help).toBe('นำเข้าไฟล์เอกสาร');
  expect(r.imp_sel.ancestor).toEqual({ cls: '{form_cls}' });
});
