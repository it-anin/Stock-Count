// PromaxxHelper (promaxx-helper/) — แกนที่ไม่ผูก Windows: ตรวจ request · ลำดับขั้นตอน · pre/post-condition · ความปลอดภัย
// (3 พ.ย. 2026 · ปุ่ม "บันทึกลง PROMAXX" ในหน้า 📦 ขั้นที่ 1: ไปให้ถึงปุ่ม "นำเข้าไฟล์เอกสาร" แล้วหยุด)
//
// ทำไมต้องมี: ตัวช่วยนี้ "ขับเมาส์/คีย์บอร์ดจริง" บนเครื่องร้านและพิมพ์รหัสผ่าน ProMaxx — ผิดพลาด = คลิกผิดที่/พิมพ์รหัสลงผิดหน้าต่าง/ล็อกบัญชี
//   เทสนี้ใช้ตัวต่อปลอมของ ssmaxx (tests/lib/fake_ssmaxx.py · state machine + ฉีดความล้มเหลว) พิสูจน์ตรรกะ "ก่อนถึงหน้าต่างจริง"
//   ⚠️ ไม่ได้พิสูจน์ว่าคลิกถูกบน ssmaxx.exe จริง — ชื่อ class/ข้อความ/พิกัดในตัวต่อปลอมเป็นค่าสมมติ · ส่วน Windows (promaxx_win.py) ต้องตรวจบนเครื่องจริง (README §ตรวจหน้าต่างจริง)
//
// ตรึง:
//   1. ค่าที่ส่งมอบ — LOCATORS_VERIFIED=False · STEP_SPECS ว่าง (ห้ามมี locator ที่เดา) · ชนิดเอกสาร/พอร์ต/origin ตามที่ผู้ใช้สั่ง · แกนไม่ import win32/psutil
//   2. ค่าตั้ง (.env · ตัวแปรระบบ · พอร์ต · origin · บอทที่ห้ามชน) 3. ด่าน HTTP: Host/Origin/header/ชนิด/ขนาด/JSON/field แปลก/proto/type + CORS + PNA
//   4. ด่าน preflight ทุกแบบ ต้องปฏิเสธโดย "ไม่ลงมือทำอะไร" (ไม่ launch/พิมพ์/คลิก) · ลำดับความสำคัญของรหัส
//   5. ★ เส้นทางปกติ ORDS/IRPS: ลำดับ action เป๊ะ · เมนู/ปุ่มถูกชนิด · พิมพ์รหัสครั้งเดียว · หยุดหลังปุ่มนำเข้า (ไม่มี input เพิ่ม)
//   6. ★ ความล้มเหลวทุกแบบ: รหัส/ขั้นถูก · ไม่คลิกต่อ · เก็บหลักฐาน · ล็อกอินพลาดไม่ retry
//   7. dry-run · --step · NOT_RUNNING 8. ★ รหัสผ่านไม่หลุดทุกช่องทาง 9. HTTP จริง (socket) 10. inspect/find/CLI/log
//   13–15. ช่องว่างที่ mutation testing พบ (3 พ.ย. 2026): ตัวแยกเป้า · อ่านพิกัดหลังโฟกัส · hover · allow_dialogs · รหัสผ่านใน dump/inspect/main
//          · ผูกเฉพาะ 127.0.0.1 · เปิดซ้อนไม่ได้ · ข้อผิดพลาดภายในไม่รั่ว · exit code ทุกรหัส · flag ผิดรูป · health · prune ค่าเริ่มต้น
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { runPy, cli, startServer, POST_HEADERS, PROD, HELPER_DIR } = require('../../lib/promaxx-helper-harness');

const PW = 's3cret!pw';
const SCEN = String.raw`
specs = p.get('specs')
if p.get('specs_drop'):
    specs = {k: v for k, v in fk.SPECS.items() if k not in p['specs_drop']}
if p.get('allow_dialogs'):
    import copy
    specs = copy.deepcopy(fk.SPECS)
    for k in ('menu', 'doc-button', 'import-button'):
        specs[k]['allow_dialogs'] = p['allow_dialogs']
fake = dict(p.get('fake') or {})
svc, ui, log, st = fk.make(m, tmp, verified=p.get('verified', True), specs=specs,
    user=p.get('user', 'somchai'), password=p.get('password', 's3cret!pw'),
    ui_password=p.get('ui_password'), settings_kw=p.get('settings_kw'), **fake)
if p.get('pre_lock'): svc._lock.acquire()
opts = m.JobOpts(**(p.get('opts') or {}))
status, obj = svc.run_job(p.get('type', 'ORDS'), opts, only_step=p.get('only'))
if p.get('pre_lock'): svc._lock.release()
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
out = dict(status=status, obj=obj, acts=ui.acts(), calls=[[str(x) for x in c] for c in ui.calls], t=ui.t, state=ui.state,
    menu=ui.menu_choice, letter=ui.letter_choice, after_import=ui.acts_after_import, ev=ev, shots=ui.shots, fields=ui.fields,
    mutexes=sorted(ui.mutexes), leak=bool(p.get('password', 's3cret!pw') in blob), busy=svc.busy, exe=ui.exe,
    cwd=os.path.dirname(ui.exe), log='\n'.join(log.lines))
print(json.dumps(out, ensure_ascii=False, default=str))
`;
const scen = (payload = {}) => runPy(SCEN, payload);
const HAPPY_ACTS = ['launch', 'focus', 'click_at', 'type_text', 'click_at', 'type_text', 'press_key', 'invoke_menu', 'click_button', 'click_at'];
const count = (acts, n) => acts.filter((a) => a === n).length;

test('1. ค่าที่ส่งมอบ — ปิดการคลิกไว้ · ไม่มี locator ที่เดา · ชนิดเอกสารตามที่ผู้ใช้สั่ง · แกนไม่ผูก Windows', async () => {
  const r = runPy(`
print(json.dumps(dict(verified=m.LOCATORS_VERIFIED, specs=m.STEP_SPECS, proto=m.PROTO, port=m.DEFAULT_PORT, prod=m.PROD_ORIGIN,
  docs=m.DOC_TYPES, proc=m.PROC_NAME, order=list(m.STEP_ORDER), imp=m.IMPORT_STEP, block=list(m.DEFAULT_BLOCK_PROCS), body=m.MAX_BODY,
  ver=m.VERSION), ensure_ascii=False))`);
  expect(r.verified, 'LOCATORS_VERIFIED ต้องเป็น False จนกว่าจะตรวจหน้าต่างจริงครบ (แก้เป็น True ต้องมีผลตรวจ + อัปเดตเทสนี้)').toBe(false);
  expect(r.specs, 'STEP_SPECS ที่ส่งมอบต้องว่าง — ห้ามใส่ class/พิกัดที่เดา (รอ Gate 0)').toEqual({});
  expect(r.proto).toBe(1);
  expect(r.port).toBe(47831);
  expect(r.prod).toBe('https://anin-stock-count.vercel.app');
  expect(r.docs).toEqual({ ORDS: { letter: 'O', menu_th: 'เอกสารจ่าย' }, IRPS: { letter: 'I', menu_th: 'เอกสารรับ' } });
  expect(r.proc).toBe('ssmaxx.exe');
  expect(r.order).toEqual(['launch', 'login', 'menu', 'doc-button', 'import-button']);
  expect(r.imp).toBe('import-button');
  expect(r.block).toEqual(['seniorsoftexport.exe', 'autor01export.exe']);
  expect(r.body).toBe(2048);
  expect(r.ver).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/);
  const core = fs.readFileSync(path.join(HELPER_DIR, 'promaxx_helper.py'), 'utf8');
  expect(core, 'แกนต้องไม่ import win32/psutil/ctypes/PIL (เทสบน Linux ได้)').not.toMatch(/^\s*(import|from)\s+(win32\w*|psutil|pyautogui|ctypes|PIL)\b/m);
  expect(core).not.toMatch(/windll/);
  const win = fs.readFileSync(path.join(HELPER_DIR, 'promaxx_win.py'), 'utf8');
  expect(win, 'promaxx_win.py ต้อง import win32* แบบ lazy (ภายใน WinAdapter) ไม่ใช่ระดับโมดูล').not.toMatch(/^(import|from)\s+(win32\w*|psutil|pyautogui|PIL)\b/m);
  const v = cli(['--version']);
  expect(v.status).toBe(0);
  expect(v.out).toMatch(/PromaxxHelper \d{4}-\d{2}-\d{2}\.\d+ proto=1 locatorsVerified=False/);
});

test('2. ค่าตั้ง — .env (BOM · เครื่องหมายคำพูด · คอมเมนต์) · ตัวแปรระบบชนะไฟล์ · พอร์ต/origin/บอทที่ห้ามชน ตรวจและเตือน', async () => {
  const r = runPy(String.raw`
base = os.path.join(tmp, 'a'); os.makedirs(base)
open(os.path.join(base, '.env'), 'w', encoding='utf-8-sig').write('PROMAXX_USERNAME="user1"\n# คอมเมนต์\nPROMAXX_PASSWORD=pa ss=1\nPROMAXX_EXE_PATH=C:\\x\\ssmaxx.exe\nPROMAXX_EXE_ARGS=/b=SRC /c\nHELPER_PORT=50000\nHELPER_ALLOWED_ORIGINS=http://localhost:8080/, https://*.evil.com, ftp://x, http://127.0.0.1:4173, https://a.b/path\nHELPER_BLOCK_PROCS=Foo.exe, BAR.exe\n')
w1 = []; s1 = m.load_settings(base, environ={}, warn=w1.append)
w2 = []; s2 = m.load_settings(base, environ={'PROMAXX_USERNAME': 'envuser', 'HELPER_PORT': '1023'}, warn=w2.append)
w3 = []; s3 = m.load_settings(os.path.join(tmp, 'none'), environ={}, warn=w3.append)
base2 = os.path.join(tmp, 'b'); os.makedirs(base2)
open(os.path.join(base2, '.env'), 'w', encoding='utf-8').write('HELPER_PORT=abc\n')
w4 = []; s4 = m.load_settings(base2, environ={}, warn=w4.append)
d = lambda s: dict(u=s.username, pw=s.password, exe=s.exe_path, args=list(s.exe_args), port=s.port, origins=list(s.allowed_origins), block=list(s.block_procs), env=bool(s.env_file), proc=s.proc_name)
print(json.dumps(dict(a=d(s1), wa=len(w1), b=d(s2), wb=len(w2), c=d(s3), wc=len(w3), dd=d(s4), wd=w4), ensure_ascii=False))`);
  expect(r.a).toMatchObject({ u: 'user1', pw: 'pa ss=1', exe: 'C:\\x\\ssmaxx.exe', port: 50000, env: true, proc: 'ssmaxx.exe', block: ['foo.exe', 'bar.exe'] });
  expect(r.a.args).toEqual(['/b=SRC', '/c']);
  expect(r.a.origins, 'ตัด / ท้าย · ตัด * / scheme แปลก / path ทิ้ง · prod อยู่หน้าสุดเสมอ').toEqual([PROD, 'http://localhost:8080', 'http://127.0.0.1:4173']);
  expect(r.wa, '3 origin ที่ถูกข้ามต้องมีคำเตือนครบ').toBe(3);
  expect(r.b.u, 'ตัวแปรระบบชนะ .env').toBe('envuser');
  expect(r.b.port, 'พอร์ต <1024 ใช้ค่าเริ่มต้น').toBe(47831);
  expect(r.wb).toBeGreaterThanOrEqual(1);
  expect(r.c).toMatchObject({ u: '', pw: '', exe: '', port: 47831, env: false, block: ['seniorsoftexport.exe', 'autor01export.exe'] });
  expect(r.c.origins).toEqual([PROD]);
  expect(r.wc).toBe(0);
  expect(r.dd.port).toBe(47831);
  expect(r.wd.join('')).toContain('HELPER_PORT');
});

test('3. ด่าน HTTP — Host · Origin · header · ชนิด · ขนาด · JSON · field แปลก · proto · type + CORS/PNA (ปฏิเสธทุกแบบโดยไม่แตะ ProMaxx)', async () => {
  const r = runPy(String.raw`
svc, ui, log, st = fk.make(m, tmp)
O = m.PROD_ORIGIN
good = {'Host': '127.0.0.1:47831', 'Origin': O, 'Content-Type': 'application/json', 'X-Anin-Helper': '1'}
P = '/v1/open-import'
def hh(**kw):
    h = dict(good); h.update(kw); return {k: v for k, v in h.items() if v is not None}
J = lambda o: json.dumps(o).encode()
OK = J({'proto': 1, 'type': 'ORDS'})
cases = []
def case(name, method, path, headers, body=b'', declared=None):
    s, h, b = svc.handle(method, path, headers, body, declared)
    j = json.loads(b.decode('utf-8')) if b else None
    cases.append(dict(name=name, status=s, code=(j or {}).get('code'), msg=(j or {}).get('message'), acao=h.get('Access-Control-Allow-Origin'), h=h, empty=(b == b'')))
case('health-no-origin', 'GET', '/v1/health', {'Host': '127.0.0.1:47831'})
case('health-allowed', 'GET', '/v1/health', {'Host': '127.0.0.1:47831', 'Origin': O})
case('health-evil', 'GET', '/v1/health', {'Host': '127.0.0.1:47831', 'Origin': 'https://evil.example'})
case('host-evil', 'GET', '/v1/health', hh(Host='evil.example:47831'))
case('host-localhost', 'GET', '/v1/health', hh(Host='localhost:47831'))
case('host-noport', 'GET', '/v1/health', hh(Host='127.0.0.1'))
case('host-otherport', 'GET', '/v1/health', hh(Host='127.0.0.1:8080'))
case('pre-ok', 'OPTIONS', P, hh(**{'Access-Control-Request-Method': 'POST'}))
case('pre-evil', 'OPTIONS', P, hh(Origin='https://evil.example'))
case('pre-noorigin', 'OPTIONS', P, hh(Origin=None))
case('post-noorigin', 'POST', P, hh(Origin=None), OK)
case('post-evil', 'POST', P, hh(Origin='https://evil.example'), OK)
case('post-nohdr', 'POST', P, hh(**{'X-Anin-Helper': None}), OK)
case('post-hdr0', 'POST', P, hh(**{'X-Anin-Helper': '0'}), OK)
case('post-text', 'POST', P, hh(**{'Content-Type': 'text/plain'}), OK)
case('post-big', 'POST', P, hh(), b'', 5000)
case('post-bigbody', 'POST', P, hh(), b'x' * 3000)
case('post-empty', 'POST', P, hh(), b'')
case('post-badjson', 'POST', P, hh(), b'{nope')
case('post-array', 'POST', P, hh(), b'[1]')
case('post-extra', 'POST', P, hh(), J({'proto': 1, 'type': 'ORDS', 'path': 'C:\\evil.exe'}))
case('post-proto2', 'POST', P, hh(), J({'proto': 2, 'type': 'ORDS'}))
case('post-noproto', 'POST', P, hh(), J({'type': 'ORDS'}))
case('post-badtype', 'POST', P, hh(), J({'proto': 1, 'type': 'XXXX'}))
case('post-lower', 'POST', P, hh(), J({'proto': 1, 'type': 'ords'}))
case('post-notype', 'POST', P, hh(), J({'proto': 1}))
case('get-open', 'GET', P, hh())
case('put-open', 'PUT', P, hh(), OK)
case('post-health', 'POST', '/v1/health', hh(), OK)
case('unknown', 'GET', '/v1/other', hh())
case('unknown-evil', 'GET', '/v1/other', hh(Origin='https://evil.example'))
acts_refused = ui.acts()
case('ctype-charset', 'POST', P, hh(**{'Content-Type': 'Application/JSON; charset=utf-8'}), J({'proto': 1, 'type': 'IRPS'}))
print(json.dumps(dict(cases=cases, acts_refused=acts_refused, acts_all=ui.acts(), state=ui.state), ensure_ascii=False))`);
  const c = Object.fromEntries(r.cases.map((x) => [x.name, x]));
  const eq = (name, status, code) => { expect([name, c[name].status, c[name].code]).toEqual([name, status, code]); };
  eq('health-no-origin', 200, null);
  expect(c['health-no-origin'].acao, 'ไม่มี Origin (ตรวจเองด้วย curl) ผ่านได้ แต่ไม่ใส่ CORS header').toBeNull();
  eq('health-allowed', 200, null);
  expect(c['health-allowed'].acao).toBe(PROD);
  expect(c['health-allowed'].h.Vary).toBe('Origin');
  eq('health-evil', 403, 'FORBIDDEN_ORIGIN');
  expect(c['health-evil'].acao).toBeNull();
  eq('host-evil', 403, 'FORBIDDEN_HOST');
  expect(c['host-evil'].acao, 'Host ผิดต้องไม่ได้ CORS header แม้ Origin อยู่ใน list').toBeNull();
  eq('host-localhost', 200, null);
  eq('host-noport', 403, 'FORBIDDEN_HOST');
  eq('host-otherport', 403, 'FORBIDDEN_HOST');
  eq('pre-ok', 204, null);
  expect(c['pre-ok'].empty).toBe(true);
  expect(c['pre-ok'].acao).toBe(PROD);
  expect(c['pre-ok'].h['Access-Control-Allow-Private-Network'], 'Chrome/Edge ส่ง PNA preflight เมื่อหน้า https เรียก 127.0.0.1').toBe('true');
  expect(c['pre-ok'].h['Access-Control-Allow-Methods']).toContain('POST');
  expect(c['pre-ok'].h['Access-Control-Allow-Headers']).toContain('X-Anin-Helper');
  expect(c['pre-ok'].h['Access-Control-Allow-Headers']).toContain('Content-Type');
  expect(c['pre-ok'].h['Access-Control-Max-Age']).toBe('600');
  eq('pre-evil', 403, 'FORBIDDEN_ORIGIN');
  eq('pre-noorigin', 403, 'FORBIDDEN_ORIGIN');
  eq('post-noorigin', 403, 'FORBIDDEN_ORIGIN');
  eq('post-evil', 403, 'FORBIDDEN_ORIGIN');
  expect(c['post-evil'].acao).toBeNull();
  eq('post-nohdr', 403, 'FORBIDDEN_HEADER');
  eq('post-hdr0', 403, 'FORBIDDEN_HEADER');
  eq('post-text', 415, 'UNSUPPORTED_MEDIA');
  eq('post-big', 413, 'PAYLOAD_TOO_LARGE');
  eq('post-bigbody', 413, 'PAYLOAD_TOO_LARGE');
  eq('post-empty', 400, 'BAD_REQUEST');
  eq('post-badjson', 400, 'BAD_REQUEST');
  eq('post-array', 400, 'BAD_REQUEST');
  eq('post-extra', 400, 'BAD_REQUEST');
  expect(c['post-extra'].msg, 'field แปลก (เช่น path) ต้องถูกปฏิเสธและบอกชื่อ field').toContain('path');
  eq('post-proto2', 400, 'PROTO_MISMATCH');
  eq('post-noproto', 400, 'PROTO_MISMATCH');
  eq('post-badtype', 400, 'BAD_REQUEST');
  eq('post-lower', 400, 'BAD_REQUEST');
  eq('post-notype', 400, 'BAD_REQUEST');
  eq('get-open', 405, 'METHOD_NOT_ALLOWED');
  eq('put-open', 405, 'METHOD_NOT_ALLOWED');
  eq('post-health', 405, 'METHOD_NOT_ALLOWED');
  eq('unknown', 404, 'NOT_FOUND');
  expect(c.unknown.acao, 'Origin ถูกต้อง → หน้าเว็บต้องอ่าน error ได้').toBe(PROD);
  eq('unknown-evil', 403, 'FORBIDDEN_ORIGIN');
  for (const x of r.cases) {
    expect(x.h['Cache-Control'], x.name).toBe('no-store');
    expect(x.h['X-Content-Type-Options'], x.name).toBe('nosniff');
    if (x.status !== 204) expect(x.h['Content-Type'], x.name).toBe('application/json; charset=utf-8');
  }
  expect(r.acts_refused, 'ทุกคำขอที่ผิดเงื่อนไขจนถึงก่อนคำขอสุดท้าย ต้องไม่ลงมือทำอะไรกับ ProMaxx').toEqual([]);
  eq('ctype-charset', 200, null);   // Content-Type ตัวพิมพ์ใหญ่ + charset ผ่านได้ · คำขอสุดท้ายเดียวที่ถูกต้อง = ลงมือทำจริงครั้งเดียว
  expect(r.acts_all.length).toBeGreaterThan(0);
});

test('4. ด่าน preflight — ปฏิเสธทุกแบบโดยไม่ launch/พิมพ์/คลิก · ลำดับความสำคัญของรหัส', async () => {
  const none = (r, status, code) => {
    expect([r.status, r.obj.code, r.obj.step]).toEqual([status, code, 'preflight']);
    expect(r.acts, `${code}: ต้องไม่ลงมือทำอะไร`).toEqual([]);
    expect(r.ev, `${code}: ไม่เก็บหลักฐาน (ไม่ได้แตะ ProMaxx)`).toEqual({});
    expect(r.mutexes, 'ปล่อย mutex ทุกครั้ง').toEqual([]);
    expect(r.busy).toBe(false);
  };
  none(scen({ verified: false }), 422, 'UNVERIFIED');
  none(scen({ user: '' }), 422, 'NOT_CONFIGURED');
  none(scen({ password: '' }), 422, 'NOT_CONFIGURED');
  expect(scen({ user: '' }).obj.message).toContain('PROMAXX_USERNAME');
  none(scen({ fake: { fs: [] } }), 422, 'NOT_CONFIGURED');
  expect(scen({ fake: { fs: [] } }).obj.message).toContain('PROMAXX_EXE_PATH');
  none(scen({ settings_kw: { exe_path: 'D:\\ไม่มี\\ssmaxx.exe' } }), 422, 'NOT_CONFIGURED');
  none(scen({ fake: { session: false } }), 422, 'NO_DESKTOP');
  none(scen({ fake: { dpi: 125 } }), 422, 'UNSUPPORTED_DPI');
  expect(scen({ fake: { dpi: 125 } }).obj.message).toContain('125%');
  none(scen({ fake: { existing_pids: [777] } }), 409, 'ALREADY_RUNNING');
  expect(scen({ fake: { existing_pids: [777] } }).obj.message, 'ข้อความต้องบอกให้ปิด ssmaxx.exe').toContain('ปิด ssmaxx.exe');
  none(scen({ fake: { blockers: ['seniorsoftexport.exe'] } }), 409, 'OTHER_BOT_RUNNING');
  expect(scen({ fake: { blockers: ['seniorsoftexport.exe'] } }).obj.message).toContain('seniorsoftexport.exe');
  expect(scen({ fake: { blockers: ['notepad.exe'] } }).status, 'โปรเซสอื่นที่ไม่อยู่ใน list ไม่ขวาง').toBe(200);
  // BUSY: ล็อกในโปรเซส · mutex ข้ามโปรเซส — ต้องปฏิเสธโดยไม่แตะอะไรและไม่ปล่อยของคนอื่น
  const b1 = scen({ pre_lock: true });
  expect([b1.status, b1.obj.code]).toEqual([409, 'BUSY']);
  expect(b1.acts).toEqual([]);
  const b2 = scen({ fake: { external_mutexes: ['Local\\AninPromaxxHelperJob'] } });
  expect([b2.status, b2.obj.code]).toEqual([409, 'BUSY']);
  expect(b2.acts).toEqual([]);
  expect(b2.mutexes, 'mutex ของโปรเซสอื่นต้องไม่ถูกเราปล่อย').toEqual(['Local\\AninPromaxxHelperJob']);
  // ลำดับ: UNVERIFIED ชนะทุกอย่าง · รหัสผ่านไม่ครบชนะ "เปิดอยู่แล้ว"
  none(scen({ verified: false, user: '', fake: { existing_pids: [1], dpi: 150, blockers: ['seniorsoftexport.exe'] } }), 422, 'UNVERIFIED');
  none(scen({ user: '', fake: { existing_pids: [1] } }), 422, 'NOT_CONFIGURED');
  none(scen({ fake: { dpi: 150, existing_pids: [1] } }), 422, 'UNSUPPORTED_DPI');
  // ข้ามด่านได้เฉพาะที่ตั้งใจให้ข้าม (เครื่องทดสอบ) — Scaling เท่านั้น
  const fd = scen({ fake: { dpi: 125 }, opts: { force_dpi: true } });
  expect(fd.status).toBe(200);
  // force_unverified + STEP_SPECS ที่ส่งมอบ (ว่าง) = ไม่มี locator ให้ใช้ → ต้องหยุดที่ขั้นแรกโดยไม่ลงมือ (ไม่คลิกสุ่ม)
  const sh = scen({ verified: false, specs: 'shipped', opts: { force_unverified: true } });
  expect([sh.status, sh.obj.code, sh.obj.step]).toEqual([500, 'LOCATOR_MISSING', 'launch']);
  expect(sh.acts, 'ไม่มี spec = ไม่ launch ไม่คลิก').toEqual([]);
  expect(sh.obj.message).toContain('รอตรวจหน้าต่าง');
  const sh2 = scen({ verified: false, specs: 'shipped' });
  expect([sh2.status, sh2.obj.code]).toEqual([422, 'UNVERIFIED']);
});

for (const [type, menu, letter] of [['ORDS', 'เอกสารจ่าย', 'O'], ['IRPS', 'เอกสารรับ', 'I']]) {
  test(`5. ★ เส้นทางปกติ ${type} — เมนู${menu} · ปุ่ม ${letter} · ลำดับ action เป๊ะ · พิมพ์รหัสครั้งเดียว · หยุดหลังปุ่มนำเข้า`, async () => {
    const r = scen({ type });
    expect([r.status, r.obj.ok, r.obj.type, r.obj.reached, r.obj.dryRun, r.obj.proto]).toEqual([200, true, type, 'import-button', false, 1]);
    expect(r.obj.steps.map((s) => s.name)).toEqual(['launch', 'login', 'menu', 'doc-button', 'import-button']);
    expect(r.obj.steps.every((s) => s.ok && Number.isInteger(s.ms))).toBe(true);
    expect(Number.isInteger(r.obj.elapsedMs)).toBe(true);
    expect(r.acts, 'ลำดับ action จริง').toEqual(HAPPY_ACTS);
    expect([r.menu, r.letter], `${type} ต้องเข้าเมนู${menu} และกดปุ่ม ${letter}`).toEqual([menu, letter]);
    expect(r.state, 'ปลายทาง = หน้าต่างนำเข้าไฟล์เอกสาร').toBe('import');
    expect(r.after_import, 'หลังคลิกปุ่มนำเข้า ห้ามมี input เพิ่ม').toBe(0);
    expect(r.calls[0].slice(0, 2), 'เปิดด้วยพาธที่ตั้งไว้').toEqual(['launch', r.exe]);
    expect(r.calls[0][3], 'cwd = โฟลเดอร์โปรแกรม (PB ต้องการหา INI/DLL)').toBe(r.cwd);
    const typed = r.calls.filter((c) => c[0] === 'type_text').map((c) => c[1]);
    expect(typed, 'พิมพ์ username แล้ว password อย่างละครั้งเดียว').toEqual(['somchai', PW]);
    expect(r.calls.filter((c) => c[0] === 'press_key').map((c) => c[1])).toEqual(['enter']);
    expect(r.fields).toEqual({ username: 'somchai', password: PW });
    expect(r.ev, 'สำเร็จ = ไม่มีโฟลเดอร์หลักฐาน').toEqual({});
    expect(r.mutexes).toEqual([]);
    expect(r.busy).toBe(false);
    expect(r.leak, 'รหัสผ่านไม่หลุดใน log/ผลลัพธ์').toBe(false);
  });
}

test('6. ★ ความล้มเหลวทุกแบบ — รหัส/ขั้นถูก · ไม่คลิกต่อ · เก็บหลักฐานครบ · ล็อกอินพลาดไม่ retry', async () => {
  const EVID = ['dump.json', 'dump.txt', 'result.json', 'screen.png'];
  const bad = (r, status, code, step) => {
    expect([r.status, r.obj.ok, r.obj.code, r.obj.step], r.obj.message).toEqual([status, false, code, step]);
    expect(r.mutexes).toEqual([]);
    expect(r.busy).toBe(false);
    const dirs = Object.keys(r.ev);
    expect(dirs.length, 'ต้องมีโฟลเดอร์หลักฐาน 1 อัน').toBe(1);
    expect(dirs[0]).toMatch(new RegExp(`^\\d{8}_\\d{6}_${code}$`));
    expect(r.ev[dirs[0]]).toEqual(EVID);
  };
  // launch: ต่อ SQL Server ไม่ได้ (เคสจริง 28 ก.ย. 2026) → บอกสาเหตุ
  const l1 = scen({ fake: { dialog_on_launch: ['Microsoft SQL Server Login', ["Connection failed: SQLState: '08001'"]] } });
  bad(l1, 500, 'LAUNCH_FAILED', 'launch');
  expect(l1.obj.message).toContain('ต่อฐานข้อมูลไม่ได้');
  expect(l1.acts, 'launch แล้วไม่ทำอะไรต่อ').toEqual(['launch']);
  const l2 = scen({ fake: { no_login_window: true } });
  bad(l2, 500, 'LAUNCH_FAILED', 'launch');
  expect(l2.obj.message).toContain('ไม่พบหน้า Login');
  expect(l2.acts).toEqual(['launch']);
  const l3 = scen({ fake: { launch_delay: 30, crash_after_launch: true } });
  bad(l3, 500, 'LAUNCH_FAILED', 'launch');
  expect(l3.obj.message).toContain('ปิดตัวเอง');
  const l4 = scen({ settings_kw: { exe_path: 'D:\\x\\ssmaxx.exe' }, fake: { fs: ['D:\\x\\ssmaxx.exe', 'C:\\other.exe'] }, specs_drop: [] });
  expect(l4.status).toBe(200);   // พาธใน .env ถูกใช้แทนค่าเริ่มต้น
  expect(l4.calls[0][1]).toBe('D:\\x\\ssmaxx.exe');
  // login: รหัสผิด → LOGIN_FAILED · พิมพ์ครั้งเดียว (ไม่ retry กันบัญชีถูกล็อก) · ไม่คลิกต่อ
  const g1 = scen({ ui_password: 'อีกอัน' });
  bad(g1, 500, 'LOGIN_FAILED', 'login');
  expect(g1.obj.message).toContain('ไม่ลองซ้ำ');
  expect(count(g1.acts, 'type_text'), 'พิมพ์ username+password แค่ครั้งเดียว').toBe(2);
  expect(count(g1.acts, 'press_key'), 'กด Enter ครั้งเดียว').toBe(1);
  expect(g1.acts).not.toContain('invoke_menu');
  // login: ใช้เวลานานเกินกำหนด (หน้าหลักไม่ขึ้น) → LOGIN_FAILED เช่นกัน
  const g2 = scen({ fake: { login_delay: 99 } });
  bad(g2, 500, 'LOGIN_FAILED', 'login');
  expect(count(g2.acts, 'press_key')).toBe(1);
  // menu: ไม่พบ / พบซ้ำ → ไม่กดเดา
  const m1 = scen({ fake: { no_menu: true } });
  bad(m1, 500, 'LOCATOR_NOT_FOUND', 'menu');
  expect(m1.acts).not.toContain('invoke_menu');
  const m2 = scen({ type: 'IRPS', fake: { dup_menu: true } });
  bad(m2, 500, 'LOCATOR_NOT_UNIQUE', 'menu');
  expect(m2.obj.message).toContain('2');
  expect(m2.acts).not.toContain('invoke_menu');
  // ปุ่มนำเข้าซ้ำสองปุ่ม → ไม่คลิกเดา (ขั้น import-button ไม่คลิกเลย)
  const m3 = scen({ type: 'ORDS', fake: { dup_menu: true } });
  bad(m3, 500, 'LOCATOR_NOT_UNIQUE', 'import-button');
  expect(m3.acts, 'ไม่คลิกปุ่มนำเข้า').toEqual(HAPPY_ACTS.slice(0, -1));
  // โฟกัส: ไม่ได้อยู่หน้าสุด → ไม่พิมพ์ ไม่คลิก
  const f1 = scen({ fake: { focus_fails: true } });
  bad(f1, 500, 'FOCUS_LOST', 'login');
  expect(f1.acts, 'พยายามโฟกัสแล้วหยุด').toEqual(['launch', 'focus']);
  // เมาส์ถูกขยับ/คลิกไม่เข้าเป้า → ยกเลิกก่อนพิมพ์
  const d1 = scen({ fake: { click_drift: true } });
  bad(d1, 500, 'INTERFERENCE', 'login');
  expect(d1.acts).not.toContain('type_text');
  expect(d1.obj.message).toContain('อย่าแตะเมาส์');
  // กล่องข้อความแทรกหลังเข้าเมนู → หยุดก่อนกดปุ่ม I/O และบอกข้อความของกล่อง
  const x1 = scen({ type: 'IRPS', fake: { dialog_after_menu: ['SeniorSoft ProMaxx', ['ไม่มีสิทธิ์เข้าเมนูนี้']] } });
  bad(x1, 500, 'UNEXPECTED_DIALOG', 'doc-button');
  expect(x1.obj.message).toContain('ไม่มีสิทธิ์เข้าเมนูนี้');
  expect(x1.acts).not.toContain('click_button');
  // คลิกปุ่มนำเข้าแล้วหน้าต่างไม่ขึ้น → POSTCONDITION_FAILED · คลิกครั้งเดียว ไม่ลองซ้ำ
  const p1 = scen({ fake: { import_no_effect: true } });
  bad(p1, 500, 'POSTCONDITION_FAILED', 'import-button');
  expect(p1.acts).toEqual(HAPPY_ACTS);
  expect(count(p1.acts, 'click_at')).toBe(3);
  // ขั้นที่ยังไม่ตั้งค่า spec → หยุดที่ขั้นนั้น ไม่ลงมือ
  const s1 = scen({ specs_drop: ['menu'] });
  bad(s1, 500, 'LOCATOR_MISSING', 'menu');
  expect(s1.acts).toEqual(HAPPY_ACTS.slice(0, 7));
  expect(s1.obj.steps.map((s) => [s.name, s.ok])).toEqual([['launch', true], ['login', true], ['menu', false]]);
  const s2 = scen({ specs_drop: ['launch'] });
  bad(s2, 500, 'LOCATOR_MISSING', 'launch');
  expect(s2.acts, 'ไม่มี spec launch = ไม่เปิดโปรแกรม').toEqual([]);
});

test('7. dry-run และ --step — ไม่ลงมือ · วาดเป้าลงภาพ · ต้องเปิดโปรแกรมไว้ที่หน้าที่ถูกต้องก่อน', async () => {
  // dry-run ขั้น menu (หน้าหลักเปิดอยู่): หาเป้าแล้ววาดกรอบ ไม่ส่งข้อความเมนู
  const a = scen({ type: 'IRPS', only: 'menu', opts: { dry_run: true }, fake: { start_state: 'main' } });
  expect([a.status, a.obj.ok, a.obj.dryRun, a.obj.reached]).toEqual([200, true, true, 'menu']);
  expect(a.acts, 'dry-run ห้ามลงมือใดๆ').toEqual([]);
  expect(a.shots.length).toBe(1);
  expect(a.shots[0].marks.map((x) => x.type)).toEqual(['rect']);
  expect(Object.keys(a.ev)[0]).toMatch(/_dry$/);
  expect(a.ev[Object.keys(a.ev)[0]]).toEqual(['01_menu.png']);
  expect(a.state).toBe('main');
  // dry-run ขั้น login: จุดคลิก 2 จุดถูกวาด · ไม่พิมพ์ ไม่กด Enter
  const b = scen({ only: 'login', opts: { dry_run: true }, fake: { start_state: 'login' } });
  expect(b.status).toBe(200);
  expect(b.acts).toEqual([]);
  expect(b.shots.length).toBe(2);
  expect(b.shots.map((s) => s.marks.map((x) => x.type))).toEqual([['rect', 'point'], ['rect', 'point']]);
  expect(b.shots[0].marks[1].xy[1]).toBeLessThan(b.shots[1].marks[1].xy[1]);   // username อยู่เหนือ password
  expect(b.fields).toEqual({ username: '', password: '' });
  // dry-run ที่หาเป้าไม่เจอ = ล้มพร้อมรหัส (ไม่ใช่ผ่านเงียบ)
  const c = scen({ only: 'menu', opts: { dry_run: true }, fake: { start_state: 'main', no_menu: true } });
  expect([c.status, c.obj.code]).toEqual([500, 'LOCATOR_NOT_FOUND']);
  expect(c.acts).toEqual([]);
  // --step จริงทีละขั้นจากหน้าที่เปิดค้างไว้ (ใช้ปรับจูน)
  const d = scen({ type: 'ORDS', only: 'menu', fake: { start_state: 'main' } });
  expect([d.status, d.menu]).toEqual([200, 'เอกสารจ่าย']);
  expect(d.acts).toEqual(['invoke_menu']);
  const e = scen({ type: 'ORDS', only: 'import-button', fake: { start_state: 'doc', start_doc_menu: 'เอกสารจ่าย', start_letter: 'O' } });
  expect([e.status, e.state, e.after_import]).toEqual([200, 'import', 0]);
  expect(e.acts).toEqual(['click_at']);
  // ต้องเปิดโปรแกรมไว้ก่อน (ไม่ล็อกอิน/เปิดแทนในโหมดนี้) · --step launch ขณะเปิดอยู่ = ปฏิเสธ
  const f = scen({ only: 'menu' });
  expect([f.status, f.obj.code, f.acts]).toEqual([409, 'NOT_RUNNING', []]);
  const g = scen({ only: 'launch', fake: { start_state: 'login' } });
  expect([g.status, g.obj.code, g.acts]).toEqual([409, 'ALREADY_RUNNING', []]);
  // รันผิดหน้า (เมนูหายไปเพราะอยู่หน้า login) → precondition ล้ม ไม่คลิกมั่ว
  const h = scen({ only: 'menu', fake: { start_state: 'login' } });
  expect([h.status, h.obj.code, h.obj.step]).toEqual([500, 'PRECONDITION_FAILED', 'menu']);
  expect(h.acts).toEqual([]);
  // CLI: --dry-run ต้องคู่กับ --step · --step ที่ต้องใช้ชนิดต้องระบุ --type · --allow-close ต้องคู่กับ --close-ssmaxx
  expect(cli(['--open', 'ords', '--dry-run']).status).toBe(2);
  expect(cli(['--step', 'menu']).status).toBe(2);
  expect(cli(['--allow-close']).status).toBe(2);
  expect(cli(['--close-ssmaxx']).status).toBe(2);
  expect(cli(['--hover-ms', '99999', '--version']).status).toBe(0);   // --version จบก่อนตรวจอย่างอื่น
  expect(cli(['--bogus']).status).toBe(2);
});

test('8. หลังปุ่มนำเข้าไฟล์เอกสาร ห้ามส่ง input เพิ่ม — ตัวกันในตัวรัน (กันขั้นถัดไปที่ยังไม่ได้อนุมัติ)', async () => {
  const r = runPy(String.raw`
svc, ui, log, st = fk.make(m, tmp)
rn = m.Runner(ui, st, log, specs=fk.SPECS, clock=ui.clock, sleep=ui.sleep)
status, obj = rn.run('ORDS')
res = {'status': status, 'after': rn._after_import}
for act in ({'do': 'key', 'key': 'enter', 'within': fk.IMPORTWIN}, {'do': 'type', 'what': 'username', 'within': fk.IMPORTWIN},
            {'do': 'click', 'target': {'kind': 'point', 'within': fk.IMPORTWIN, 'x': 0.5, 'y': 0.5}}):
    try:
        rn._act(act, 'import-button', None); res[act['do']] = 'NO ERROR'
    except m.HelperError as e:
        res[act['do']] = e.code
res['acts'] = ui.acts(); res['blocked'] = rn.actions_after_import
print(json.dumps(res))`);
  expect(r.status).toBe(200);
  expect(r.after).toBe(true);
  expect([r.key, r.type, r.click]).toEqual(['STEP_FAILED', 'STEP_FAILED', 'STEP_FAILED']);
  expect(r.acts, 'ไม่มี action เพิ่มจากเดิม').toEqual(HAPPY_ACTS);
  expect(r.blocked).toBe(3);
});

test('9. ★ รหัสผ่านไม่หลุด — log · ผลลัพธ์ · ไฟล์หลักฐาน · แม้กล่องข้อความของโปรแกรมสะท้อนรหัสกลับมา', async () => {
  const CANARY = 'Zq9!leak-CANARY';
  for (const payload of [
    { password: CANARY },                                                                  // สำเร็จ
    { password: CANARY, ui_password: 'x', fake: { login_dialog_echo_password: true } },    // ล็อกอินพลาด + กล่องสะท้อนรหัส
    { password: CANARY, fake: { dialog_on_launch: ['SQL', ['รหัส ' + CANARY + ' ผิด']] } },  // กล่องก่อนล็อกอินมีรหัสในข้อความ
    { password: CANARY, fake: { import_no_effect: true } },
    { password: CANARY, specs_drop: ['doc-button'] },
  ]) {
    const r = scen(payload);
    expect(r.leak, JSON.stringify(payload.fake || payload) + ' → รหัสหลุดใน log/ผลลัพธ์/ไฟล์หลักฐาน').toBe(false);
  }
  const echo = scen({ password: CANARY, ui_password: 'x', fake: { login_dialog_echo_password: true } });
  expect(echo.obj.message, 'ข้อความจากกล่องที่สะท้อนรหัสต้องถูกปิดเป็น ***').toContain('***');
  // log ต้องไม่บอกเนื้อหาที่พิมพ์ — บอกแค่ชนิดและจำนวนตัวอักษร
  const ok = scen({ password: CANARY });
  expect(ok.log).toContain('พิมพ์ password (' + CANARY.length + ' ตัวอักษร)');
  expect(ok.log).not.toContain(CANARY);
});

test('10. HTTP จริงผ่าน socket — health · preflight · POST · Host ปลอม · ขนาด · พร้อมกัน=409 · เปิดอยู่แล้ว=409', async () => {
  const srv = await startServer({ fake: { real_delay: 0.03 } });
  try {
    const h0 = await srv.request({ path: '/v1/health' });
    expect(h0.status).toBe(200);
    expect(h0.json).toMatchObject({ ok: true, proto: 1, ssmaxxRunning: false, busy: false, locatorsVerified: true });
    expect(h0.json.stepsConfigured).toEqual(['launch', 'login', 'menu', 'doc-button', 'import-button']);
    expect(h0.headers['access-control-allow-origin']).toBeUndefined();
    const pre = await srv.request({ method: 'OPTIONS', path: '/v1/open-import', headers: { Origin: PROD, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Private-Network': 'true' } });
    expect([pre.status, pre.headers['access-control-allow-origin'], pre.headers['access-control-allow-private-network']]).toEqual([204, PROD, 'true']);
    const evil = await srv.post({ proto: 1, type: 'ORDS' }, { Origin: 'https://evil.example' });
    expect([evil.status, evil.json.code, evil.headers['access-control-allow-origin']]).toEqual([403, 'FORBIDDEN_ORIGIN', undefined]);
    const spoof = await srv.post({ proto: 1, type: 'ORDS' }, { Host: 'evil.example' });
    expect([spoof.status, spoof.json.code]).toEqual([403, 'FORBIDDEN_HOST']);
    const big = await srv.request({ method: 'POST', path: '/v1/open-import', headers: POST_HEADERS(), body: 'x'.repeat(3000) });
    expect(big.status).toBe(413);
    const bad = await srv.post({ proto: 1, type: 'ORDS', lines: ['A\t1'] });
    expect([bad.status, bad.json.code]).toEqual([400, 'BAD_REQUEST']);
    expect(bad.headers['access-control-allow-origin'], 'หน้าเว็บอ่าน error ได้').toBe(PROD);
    // พร้อมกัน: ตัวแรกกำลังทำงาน → ตัวที่สองต้องได้ 409 BUSY ทันที
    const first = srv.post({ proto: 1, type: 'IRPS' });
    let busy = false;
    for (let i = 0; i < 100 && !busy; i++) { busy = (await srv.request({ path: '/v1/health' })).json.busy; if (!busy) await new Promise((r) => setTimeout(r, 20)); }
    expect(busy, 'ต้องเห็น busy ระหว่างทำงาน').toBe(true);
    const second = await srv.post({ proto: 1, type: 'ORDS' });
    expect([second.status, second.json.code]).toEqual([409, 'BUSY']);
    const done = await first;
    expect([done.status, done.json.ok, done.json.type, done.json.reached]).toEqual([200, true, 'IRPS', 'import-button']);
    expect(done.headers['access-control-allow-origin']).toBe(PROD);
    // ProMaxx เปิดค้างที่หน้านำเข้า → กดซ้ำถูกปฏิเสธ (โปรแกรมเปิดซ้อนไม่ได้ · ผู้ใช้เลือก)
    const again = await srv.post({ proto: 1, type: 'IRPS' });
    expect([again.status, again.json.code]).toEqual([409, 'ALREADY_RUNNING']);
    const h1 = await srv.request({ path: '/v1/health' });
    expect(h1.json).toMatchObject({ ssmaxxRunning: true, busy: false });
  } finally { await srv.stop(); }
});

test('11. เครื่องมือตรวจ — --inspect/--find อ่านอย่างเดียว · ชื่อโฟลเดอร์ปลอดภัย · prune · main() และ exit code', async () => {
  const r = runPy(String.raw`
svc, ui, log, st = fk.make(m, tmp, start_state='doc', start_doc_menu='เอกสารรับ')
folder = m.run_inspect(ui, st, log, '../../S3 menu!')
files = sorted(os.listdir(folder))
txt = open(os.path.join(folder, 'dump.txt'), encoding='utf-8').read()
dj = json.load(open(os.path.join(folder, 'dump.json'), encoding='utf-8'))
for i in range(5):
    os.makedirs(os.path.join(st.runs_dir, '2020010%d_000000_x' % i), exist_ok=True)
m.prune_runs(st.runs_dir, keep=3)
left = sorted(os.listdir(st.runs_dir))
# main() ผ่านตัวต่อปลอม (main ไม่รับ specs → อ่าน STEP_SPECS ของโมดูล: ใส่ชุดเต็มของตัวต่อปลอมแทนระหว่างเทส)
m.STEP_SPECS = fk.SPECS
svc2, ui2, log2, st2 = fk.make(m, os.path.join(tmp, 'm2'), start_state='closed')
run = lambda a: m.main(a, adapter_factory=lambda: ui2, settings=st2, log=log2, clock=ui2.clock, sleep=ui2.sleep)
rc_find = run(['--find'])
rc_inspect = run(['--inspect', '--label', 'S1-login'])
rc_open = run(['--open', 'irps'])
rc_again = run(['--open', 'irps'])
rc_close_no = run(['--close-ssmaxx'])
state_before = ui2.state
rc_close = run(['--close-ssmaxx', '--allow-close'])
rc_step = run(['--step', 'menu', '--type', 'ords', '--dry-run'])
print(json.dumps(dict(folder=os.path.basename(folder), files=files, txt=txt, wins=len(dj['windows']), acts=ui.acts(), left=left,
    rc=[rc_find, rc_inspect, rc_open, rc_again, rc_close_no, rc_close, rc_step], state_before=state_before, state_after=ui2.state,
    close_calls=[c[0] for c in ui2.calls if c[0] == 'close_processes'], dumpcalls=ui.dump_calls), ensure_ascii=False))`);
  expect(r.folder, 'label ถูกล้างอักขระอันตราย (../ ช่องว่าง !) — ไม่ออกนอก runs/').toMatch(/^\d{8}_\d{6}_[A-Za-z0-9_.-]+$/);
  expect(r.folder).not.toContain('/');
  expect(r.files).toEqual(['dump.json', 'dump.txt', 'screen.png']);
  expect(r.acts, '--inspect อ่านอย่างเดียว ห้ามลงมือใดๆ').toEqual([]);
  expect(r.wins).toBeGreaterThanOrEqual(3);
  expect(r.txt).toContain('MENU เอกสารรับ  id=301');
  expect(r.txt).toContain("cls='Button' text='I'");
  expect(r.txt).toContain('other pid=1 exe=notepad.exe');
  expect(r.left, 'prune เหลือ 3 โฟลเดอร์ล่าสุด').toHaveLength(3);
  expect(r.rc[0]).toBe(0);                 // --find
  expect(r.rc[1]).toBe(0);                 // --inspect
  expect(r.rc[2]).toBe(0);                 // --open สำเร็จ
  expect(r.rc[3], 'เปิดซ้ำขณะ ProMaxx ค้างอยู่ = 3 (ไม่ได้ทำอะไร)').toBe(3);
  expect(r.rc[4]).toBe(2);                 // --close-ssmaxx ไม่มี --allow-close
  expect(r.state_before).toBe('import');
  expect(r.rc[5]).toBe(0);
  expect(r.state_after).toBe('closed');
  expect(r.close_calls).toHaveLength(1);   // ปิดจริงเฉพาะครั้งที่มี --allow-close
  expect(r.rc[6], '--step menu ตอนปิดอยู่ = NOT_RUNNING → exit 3').toBe(3);
  if (process.platform !== 'win32') expect(cli(['--find']).status, 'Linux ไม่มี pywin32 → แจ้งแล้ว exit 2').toBe(2);
});

test('12. ตัวช่วยย่อย — _fmt escape regex · Logger ปิดรหัส/หมุนไฟล์ · render_dump_text', async () => {
  const r = runPy(String.raw`
a = m._fmt({'t': ['^{menu_th}$', {'x': '{letter}'}], 'n': 5}, {'menu_th': 'เอกสาร(รับ)+', 'letter': 'I'})
f = os.path.join(tmp, 'x.log')
open(f, 'w').write('x' * 100)
lg = m.Logger(f, echo=False, keep=True, max_bytes=50)
lg.add_secret('hunter2'); lg.add_secret('')
lg('รหัสคือ hunter2 และ hunter2')
rotated = os.path.exists(f + '.1')
body = open(f, encoding='utf-8').read()
print(json.dumps(dict(a=a, rotated=rotated, body=body, kept=lg.lines, scrub=lg.scrub('hunter2!'), norm=m._norm_menu('&ไฟล์\tCtrl+O'),
    norm2=m._norm_menu('  เอกสาร   รับ '), c=m._center((0, 0, 11, 21))), ensure_ascii=False))`);
  expect(r.a.t[0]).toBe('^เอกสาร\\(รับ\\)\\+$');
  expect(r.a.t[1]).toEqual({ x: 'I' });
  expect(r.a.n).toBe(5);
  expect(r.rotated, 'log ใหญ่เกินเกณฑ์ → หมุนเป็น .1').toBe(true);
  expect(r.body).not.toContain('hunter2');
  expect(r.body).toContain('รหัสคือ *** และ ***');
  expect(r.kept[0]).not.toContain('hunter2');
  expect(r.scrub).toBe('***!');
  expect(r.norm).toBe('ไฟล์');
  expect(r.norm2).toBe('เอกสาร รับ');
  expect(r.c).toEqual([5, 10]);
});

test('13. ★ ตัวแยกเป้า — หน้าต่างซ้ำ/ซ่อน/เล็ก · เมนูหัวข้อ/ลึกกว่า · ปุ่มและเมนูที่ disabled · อ่านพิกัดหลังโฟกัส · hover · allow_dialogs · cwd/argument · dry-run ไม่เปิดโปรแกรม', async () => {
  const nu = (r, code, step) => expect([r.status, r.obj.code, r.obj.step], r.obj.message).toEqual([500, code, step]);
  // หน้าต่างหลักซ้ำสองอัน → ไม่คลิกเดา (เมนูไม่ถูกกด)
  const t1 = scen({ type: 'IRPS', fake: { dup_top: true } });
  nu(t1, 'LOCATOR_NOT_UNIQUE', 'menu');
  expect(t1.acts).not.toContain('invoke_menu');
  // ปุ่ม I/O และเมนูที่ disabled → ไม่กด
  const t2 = scen({ type: 'IRPS', fake: { disabled_button: true } });
  nu(t2, 'LOCATOR_NOT_FOUND', 'doc-button');
  expect(t2.obj.message).toContain('disabled');
  expect(t2.acts).not.toContain('click_button');
  const t3 = scen({ type: 'ORDS', fake: { disabled_menu: true } });
  nu(t3, 'LOCATOR_NOT_FOUND', 'menu');
  expect(t3.obj.message).toContain('disabled');
  expect(t3.acts).not.toContain('invoke_menu');
  // ตัวหลอก: หน้าต่างซ่อน/เล็กที่ชื่อเหมือนเป้า · เมนูหัวข้อ (id=0) ชื่อเดียวกับเป้า · เมนูที่ลึกกว่าและขึ้นต้นด้วยชื่อเป้า → ต้องไม่นับเป็นเป้า
  for (const [type, id] of [['ORDS', '302'], ['IRPS', '301']]) {
    const d = scen({ type, fake: { window_decoys: true, menu_decoys: true } });
    expect(d.status, JSON.stringify(d.obj)).toBe(200);
    expect(d.acts).toEqual(HAPPY_ACTS);
    expect(d.calls.find((c) => c[0] === 'invoke_menu'), `${type}: ต้องกดเมนูจริง (id ${id}) ไม่ใช่หัวข้อ/เมนูที่ลึกกว่า`).toEqual(['invoke_menu', '200', id]);
  }
  // หน้าต่างอยู่ผิดที่จนกว่าจะโฟกัส (เช่นถูกย่อ) → ต้องอ่านพิกัดหลังโฟกัส ไม่งั้นคลิกพลาด
  const sh = scen({ fake: { rect_shift_until_focus: true } });
  expect(sh.status, JSON.stringify(sh.obj)).toBe(200);
  expect(sh.acts).toEqual(HAPPY_ACTS);
  // --hover-ms: เลื่อนเมาส์ไปค้างเหนือเป้าก่อนคลิกเมาส์ทุกครั้ง (login 2 + นำเข้า 1) แล้วรอตามที่ขอ
  const h0 = scen({ opts: { hover_ms: 0 } });
  const h1 = scen({ opts: { hover_ms: 1500 } });
  expect(count(h0.acts, 'move_to'), 'ไม่ขอ hover = ไม่เลื่อนเมาส์ล่วงหน้า').toBe(0);
  expect(count(h1.acts, 'move_to')).toBe(3);
  const seq = h1.calls.filter((c) => c[0] === 'move_to' || c[0] === 'click_at');
  seq.forEach((c, i) => {
    if (i % 2) return;
    expect([c[0], seq[i + 1][0]]).toEqual(['move_to', 'click_at']);
    expect(c.slice(1), 'ค้างเหนือจุดเดียวกับที่จะคลิก').toEqual(seq[i + 1].slice(1));
  });
  expect(h1.t - h0.t, 'รอจริงตามที่ขอ (3 ครั้ง × 1.5 วินาที)').toBeGreaterThanOrEqual(4.4);
  // allow_dialogs: กล่องที่ตรงกับรายการอนุญาตผ่านได้ · กล่องอื่นยังหยุด
  const al1 = scen({ type: 'IRPS', allow_dialogs: ['ไม่มีข้อมูลค้าง'], fake: { dialog_after_menu: ['แจ้งเตือน', ['ไม่มีข้อมูลค้าง']] } });
  expect(al1.status, JSON.stringify(al1.obj)).toBe(200);
  expect(al1.acts).toEqual(HAPPY_ACTS);
  const al2 = scen({ type: 'IRPS', allow_dialogs: ['ไม่มีข้อมูลค้าง'], fake: { dialog_after_menu: ['ผิดพลาด', ['Connection failed']] } });
  nu(al2, 'UNEXPECTED_DIALOG', 'doc-button');
  expect(al2.acts).not.toContain('click_button');
  // launch ใช้พาธ/argument ของ shortcut และโฟลเดอร์ของ exe เป็น cwd (PowerBuilder หา INI/DLL จากโฟลเดอร์นั้น) — ใช้พาธแบบ posix เพราะ Linux ไม่ถือ \ เป็นตัวคั่น
  const lc = scen({ settings_kw: { exe_path: '/opt/pmx/ssmaxx.exe', exe_args: ['/s', '-x'] }, fake: { fs: ['/opt/pmx/ssmaxx.exe'] } });
  expect(lc.status, JSON.stringify(lc.obj)).toBe(200);
  expect(lc.calls[0]).toEqual(['launch', '/opt/pmx/ssmaxx.exe', "('/s', '-x')", '/opt/pmx']);
  // dry-run + ขั้น launch = ไม่เปิดโปรแกรมจริง
  const dl = scen({ only: 'launch', opts: { dry_run: true } });
  expect(dl.status, JSON.stringify(dl.obj)).toBe(200);
  expect(dl.acts, 'dry-run ไม่เปิดโปรแกรม').toEqual([]);
});

test('14. ★ รหัสผ่านไม่หลุดแม้หน้าต่างของโปรแกรมสะท้อนรหัสกลับมา — dump.json/dump.txt · --inspect · main() ลงทะเบียนรหัสเอง', async () => {
  // หน้าต่างล็อกอินสะท้อนรหัสที่พิมพ์ + กล่องผิดพลาดสะท้อนรหัส → หลักฐานทุกไฟล์/log/ผลลัพธ์ต้องไม่มีรหัส
  const r = scen({ ui_password: 'อีกอัน', fake: { window_echo_password: true, login_dialog_echo_password: true } });
  expect([r.obj.code, r.obj.step]).toEqual(['LOGIN_FAILED', 'login']);
  const dir = Object.keys(r.ev)[0];
  expect(r.ev[dir]).toEqual(['dump.json', 'dump.txt', 'result.json', 'screen.png']);
  expect(r.leak, 'ผลลัพธ์/log/ไฟล์หลักฐานต้องไม่มีรหัส').toBe(false);
  const e = runPy(String.raw`
pw = 's3cret!pw'
svc, ui, log, st = fk.make(m, tmp, verified=True, ui_password='อีกอัน', window_echo_password=True, login_dialog_echo_password=True)
svc.run_job('ORDS')
raw = json.dumps(ui.dump([ui.PID]), ensure_ascii=False)
folder = m.run_inspect(ui, st, log, 'S1-login')
txt = open(os.path.join(folder, 'dump.txt'), encoding='utf-8').read() + open(os.path.join(folder, 'dump.json'), encoding='utf-8').read()
m.STEP_SPECS = fk.SPECS
svc2, ui2, log2, st2 = fk.make(m, os.path.join(tmp, 'm2'), verified=True, ui_password='อีกอัน', login_dialog_echo_password=True)
fresh = m.Logger(None, echo=False, keep=True)      # ยังไม่รู้จักรหัส — main() ต้องลงทะเบียนเอง
rc = m.main(['--open', 'ords'], adapter_factory=lambda: ui2, settings=st2, log=fresh, clock=ui2.clock, sleep=ui2.sleep)
blob = '\n'.join(fresh.lines)
for root, _, files in os.walk(os.path.join(tmp, 'm2')):
    for fn in files:
        if not fn.endswith('.png'):
            blob += open(os.path.join(root, fn), encoding='utf-8', errors='replace').read()
print(json.dumps(dict(raw_has=pw in raw, inspect_has=pw in txt, rc=rc, main_has=pw in blob, nlines=len(fresh.lines)), ensure_ascii=False))`);
  expect(e.raw_has, 'ตัวหลอกต้องสะท้อนรหัสจริง (ไม่งั้นเทสนี้ผ่านเปล่า)').toBe(true);
  expect(e.inspect_has, '--inspect ปิดรหัสก่อนเขียนไฟล์').toBe(false);
  expect(e.rc, 'ล็อกอินพลาด = exit 1').toBe(1);
  expect(e.nlines).toBeGreaterThan(3);
  expect(e.main_has, 'main() ลงทะเบียนรหัสกับ Logger เองก่อนทำงาน').toBe(false);
});

test('15. ตัวช่วยฟังเฉพาะ 127.0.0.1 · เปิดซ้อนไม่ได้ · ข้อผิดพลาดภายในไม่รั่วและไม่ค้างล็อก · exit code ทุกรหัส · flag ผิดรูป · health · prune ค่าเริ่มต้น', async () => {
  const r = runPy(String.raw`
svc, ui, log, st = fk.make(m, tmp, verified=True)
srv = m.make_server(svc, '127.0.0.1', 0)
bound = srv.server_address[0]; srv.server_close()
# main --serve: host ที่ส่งให้ make_server ต้องเป็น loopback · พอร์ตชน → exit 3
seen = []; orig = m.make_server
def fake_make(service, host='127.0.0.1', port=None):
    seen.append((host, port)); raise OSError('port busy')
m.make_server = fake_make
sA, uA, lA, stA = fk.make(m, os.path.join(tmp, 'a'), verified=True)
rc_busy = m.main(['--serve', '--port', '50555'], adapter_factory=lambda: uA, settings=stA, log=lA)
first = list(seen); seen.clear()
# เปิดซ้อน: มีตัวช่วยอื่นถือ serve mutex อยู่ → ไม่ bind พอร์ตเลย
sB, uB, lB, stB = fk.make(m, os.path.join(tmp, 'b'), verified=True)
uB.mutexes.add(m.SERVE_MUTEX)
rc_dup = m.main(['--serve'], adapter_factory=lambda: uB, settings=stB, log=lB)
after_dup = list(seen)
m.make_server = orig
# ข้อผิดพลาดภายในที่ไม่คาดคิด: HTTP → 500 INTERNAL ไม่รั่วข้อความ · CLI → exit 1 ไม่ crash · ปล่อย mutex/ล็อกเสมอ
def boom(*a, **k): raise RuntimeError('SECRET-DETAIL-xyz')
sC, uC, lC, stC = fk.make(m, os.path.join(tmp, 'c'), verified=True)
uC.dpi_percent = boom
hdr = {'Host': '127.0.0.1:47831', 'Origin': m.PROD_ORIGIN, 'Content-Type': 'application/json', 'X-Anin-Helper': '1'}
hs, hh, hp = sC.handle('POST', '/v1/open-import', hdr, json.dumps({'proto': 1, 'type': 'ORDS'}).encode())
sD, uD, lD, stD = fk.make(m, os.path.join(tmp, 'd'), verified=True)
uD.dpi_percent = boom
m.STEP_SPECS = fk.SPECS
rc_cli = m.main(['--open', 'ords'], adapter_factory=lambda: uD, settings=stD, log=lD, clock=uD.clock, sleep=uD.sleep)
# exit code ของทุกรหัส (Task Scheduler/สคริปต์อ่านค่านี้)
codes = {c: m.exit_code_for({'code': c}) for c in ['BUSY', 'ALREADY_RUNNING', 'OTHER_BOT_RUNNING', 'NOT_RUNNING', 'NOT_CONFIGURED', 'UNVERIFIED',
    'UNSUPPORTED_DPI', 'NO_DESKTOP', 'LOGIN_FAILED', 'LAUNCH_FAILED', 'INTERNAL', 'POSTCONDITION_FAILED']}
codes['ok'] = m.exit_code_for(None)
# flag ที่ผิดรูป/ขัดกัน → exit 2 และไม่ทำอะไรกับ ProMaxx
sE, uE, lE, stE = fk.make(m, os.path.join(tmp, 'e'), verified=True)
def run(a): return m.main(a, adapter_factory=lambda: uE, settings=stE, log=lE, clock=uE.clock, sleep=uE.sleep)
rc_flags = dict(dry_open=run(['--open', 'ords', '--dry-run']), hover_neg=run(['--step', 'launch', '--hover-ms', '-5']),
    hover_big=run(['--step', 'launch', '--hover-ms', '20000']), allow_alone=run(['--allow-close']), step_no_type=run(['--step', 'menu']))
acts_flags = uE.acts()
# health: บอกสถานะ locatorsVerified ตามจริง
hv = {}
for v in (False, True):
    sF, uF, lF, stF = fk.make(m, os.path.join(tmp, 'f%d' % v), verified=v)
    hv[str(v)] = sF.health()['locatorsVerified']
# prune ค่าเริ่มต้นเก็บ 30 โฟลเดอร์ล่าสุด
runs = os.path.join(tmp, 'runs'); os.makedirs(runs)
for i in range(35): os.makedirs(os.path.join(runs, '202001%02d_000000_x' % (i + 1)))
m.prune_runs(runs)
left = sorted(os.listdir(runs))
print(json.dumps(dict(bound=bound, first=first, rc_busy=rc_busy, after_dup=after_dup, rc_dup=rc_dup, hs=hs, hp=hp.decode('utf-8'),
    mutex=sorted(uC.mutexes), busy=sC.busy, rc_cli=rc_cli, mutex_cli=sorted(uD.mutexes), log_cli='\n'.join(lD.lines), log_http='\n'.join(lC.lines),
    codes=codes, rc_flags=rc_flags, acts_flags=acts_flags, hv=hv, left=left), ensure_ascii=False))`);
  expect(r.bound, 'เซิร์ฟเวอร์ผูกเฉพาะ loopback (เครื่องอื่นในร้านเรียกไม่ได้)').toBe('127.0.0.1');
  expect(r.first, 'main --serve ส่ง host loopback ให้ make_server').toEqual([['127.0.0.1', 50555]]);
  expect(r.rc_busy, 'พอร์ตชน = exit 3').toBe(3);
  expect(r.after_dup, 'ตัวช่วยตัวที่สองไม่ bind พอร์ตเลย').toEqual([]);
  expect(r.rc_dup).toBe(3);
  expect(r.hs).toBe(500);
  expect(JSON.parse(r.hp)).toMatchObject({ ok: false, code: 'INTERNAL' });
  expect(r.hp, 'ข้อความ exception ภายในไม่รั่วให้หน้าเว็บ').not.toContain('SECRET-DETAIL-xyz');
  expect(r.log_http).toContain('RuntimeError');
  expect(r.log_http, 'log เก็บแค่ชื่อชนิด error').not.toContain('SECRET-DETAIL-xyz');
  expect(r.mutex, 'ปล่อย mutex แม้ผิดพลาดภายใน').toEqual([]);
  expect(r.busy).toBe(false);
  expect(r.rc_cli, 'CLI: ข้อผิดพลาดภายใน = exit 1 ไม่ crash').toBe(1);
  expect(r.mutex_cli).toEqual([]);
  expect(r.log_cli).not.toContain('SECRET-DETAIL-xyz');
  expect(r.codes).toEqual({ BUSY: 3, ALREADY_RUNNING: 3, OTHER_BOT_RUNNING: 3, NOT_RUNNING: 3, NOT_CONFIGURED: 2, UNVERIFIED: 2, UNSUPPORTED_DPI: 2, NO_DESKTOP: 2,
    LOGIN_FAILED: 1, LAUNCH_FAILED: 1, INTERNAL: 1, POSTCONDITION_FAILED: 1, ok: 1 });
  expect(Object.values(r.rc_flags), 'flag ผิดรูป/ขัดกัน = exit 2 ทุกแบบ').toEqual([2, 2, 2, 2, 2]);
  expect(r.acts_flags, 'flag ผิดรูปต้องไม่ลงมือกับ ProMaxx').toEqual([]);
  expect(r.hv).toEqual({ False: false, True: true });
  expect(r.left, 'prune ค่าเริ่มต้นเก็บ 30 โฟลเดอร์ล่าสุด').toHaveLength(30);
  expect(r.left[0]).toBe('20200106_000000_x');
});
