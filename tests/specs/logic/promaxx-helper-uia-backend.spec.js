// PromaxxHelper — ตัวอ่าน UIA (promaxx-helper/promaxx_uia.py · PowerShell + .NET UIAutomationClient · อ่านอย่างเดียว)
// (3 พ.ย. 2026)
//
// ตรึง: 1. สคริปต์ PowerShell เป็น ASCII ล้วน + ไม่มีคำสั่งที่เขียน/คลิก/รันคำสั่งอื่น · ไฟล์สคริปต์ UTF-8 BOM ชื่อมีแฮชและถูกเขียนทับถ้าถูกแก้
//       2. บรรทัดคำสั่ง (ข้าม ExecutionPolicy เฉพาะโปรเซส · ภาษาไทยในคำถามไปทาง base64) · แปลงผลเป็น UiaEl · ทุกความล้มเหลว = UiaError
//       3. (เฉพาะ Windows) PowerShell จริง: ping · hwnd ผิดต้องล้มอย่างชัดเจน · (opt-in) หน้าต่าง WPF จริงที่ผมสร้างเอง ตรวจ id/ชื่อไทย/HelpText/พิกัด
// ⚠️ ข้อ 3 ที่ opt-in (PROMAXX_UIA_REAL_WINDOW=1) เปิดหน้าต่างเล็กๆ บนหน้าจอ ~2 วินาที จึงไม่รันโดยปริยาย — บั๊กจริงที่เจอ 3 พ.ย. 2026
//   ("$Q" ชนกับ "$q" เพราะ PowerShell ไม่สนตัวพิมพ์ · ArrayList serialize ไม่ได้) ตรวจได้เฉพาะกับ PowerShell จริง ไม่ใช่ runner ปลอม
const { test, expect } = require('@playwright/test');
const { runPy } = require('../../lib/promaxx-helper-harness');

test('1. สคริปต์ PowerShell — ASCII ล้วน · ไม่มีคำสั่งเขียน/คลิก/รันคำสั่งอื่น · ไฟล์ UTF-8 BOM ชื่อมีแฮช เขียนทับเมื่อถูกแก้', async () => {
  const r = runPy(`
import promaxx_uia as u
S = u.SCRIPT
bad = [w for w in ('Invoke-Expression', 'iex ', 'ValuePattern', 'InvokePattern', 'SetValue', 'SetFocus', 'Start-Process', 'Remove-Item', 'Out-File',
                   'Add-Content', 'Set-Content', 'New-Item', '-Command', 'DownloadString', 'Net.WebClient', 'Invoke-WebRequest', 'SendKeys', 'mouse_event')
       if w.lower() in S.lower()]
pu = u.PsUia(m.UiaEl, script_dir=tmp)
path = pu.script_path()
raw = open(path, 'rb').read()
open(path, 'wb').write(b'tampered')
path2 = u.PsUia(m.UiaEl, script_dir=tmp).script_path()
print(json.dumps(dict(ascii=all(ord(c) < 128 for c in S), bad=bad, bom=raw[:3].hex(), body_ascii=all(b < 128 for b in raw[3:]),
  name=os.path.basename(path), same=path == path2, restored=open(path2, 'rb').read() == raw,
  param_ok='[string]$QueryB64' in S and '[string]$Q)' not in S, ro=[o for o in ('ping', 'find', 'dump') if ("'" + o + "'") in S])))`);
  expect(r.ascii, 'SCRIPT ต้องเป็น ASCII ล้วน (PowerShell 5.1 อ่าน .ps1 ที่ไม่มี BOM เป็นรหัสเดิมของเครื่อง ภาษาไทยพังได้)').toBe(true);
  expect(r.bad, 'ห้ามมีคำสั่งที่เขียน/คลิก/โหลดอะไรจากภายนอก/รันคำสั่งอื่น').toEqual([]);
  expect(r.bom).toBe('efbbbf');
  expect(r.body_ascii).toBe(true);
  expect(r.name).toMatch(/^uia_[0-9a-f]{10}\.ps1$/);
  expect([r.same, r.restored], 'ไฟล์ที่ถูกแก้ต้องถูกเขียนทับกลับเป็นของจริง').toEqual([true, true]);
  expect(r.param_ok, 'พารามิเตอร์ชื่อ $QueryB64 (ห้ามชื่อ $Q ซึ่งชนกับ $q — PowerShell ไม่สนตัวพิมพ์เล็ก/ใหญ่)').toBe(true);
  expect(r.ro).toEqual(['ping', 'find', 'dump']);
});

test('2. บรรทัดคำสั่ง + แปลงผล + ความล้มเหลวทุกแบบ (runner ปลอม) — ภาษาไทยผ่าน base64 · UiaError ทุกกรณี · สถิติ', async () => {
  const r = runPy(`
import promaxx_uia as u, base64, subprocess
ELS = {"ok": True, "ms": 5, "total": 1, "els": [{"id": "uo_tran_bt_import", "type": "Button", "name": "Contactus",
  "help": "\\u0e19\\u0e33\\u0e40\\u0e02\\u0e49\\u0e32", "cls": "Button", "rect": [1591, 256, 1611, 276], "enabled": True, "offscreen": False,
  "focusable": True, "focused": False, "password": False, "parents": [{"id": "", "cls": "pn_trans_in"}, {"id": "MDI_TAB", "cls": "TabControl"}]}]}
seen = []
def mk(code=0, out=None, err=b"", raise_=None, bom=False):
    def run(cmd, timeout):
        seen.append((cmd, timeout))
        if raise_: raise raise_
        body = out if out is not None else json.dumps(ELS)
        data = body.encode("ascii") if isinstance(body, str) else body
        return code, (b"\\xef\\xbb\\xbf" + data if bom else data), err
    return run
def attempt(**kw):
    pu = u.PsUia(m.UiaEl, runner=mk(**kw), script_dir=tmp, ps_exe="powershell.exe")
    try:
        r = pu.find(4242, ids=["a"], ctype="Button", name="\\u0e40\\u0e2d\\u0e01\\u0e2a\\u0e32\\u0e23")
        return dict(ok=True, n=len(r), el=r[0].__dict__ if r else None, stats=pu.stats())
    except u.UiaError as e:
        return dict(ok=False, msg=str(e), stats=pu.stats())
good = attempt(bom=True)
cmd = seen[0][0]
q = json.loads(base64.b64decode(cmd[cmd.index("-QueryB64") + 1]).decode("utf-8"))
res = dict(good=good, cmd=cmd[:7], q=q, timeout=seen[0][1],
  nonzero=attempt(code=1), notjson=attempt(out="oops"), fail=attempt(out=json.dumps({"ok": False, "error": "ArgumentException: hwnd"})),
  timed=attempt(raise_=subprocess.TimeoutExpired("ps", 45)), oserr=attempt(raise_=FileNotFoundError("x")), empty=attempt(out=""))
pu = u.PsUia(m.UiaEl, runner=mk(), script_dir=tmp)
errs = []
for kw in (dict(), dict(ids=["1", "2", "3", "4", "5"])):
    try: pu.find(1, **kw)
    except u.UiaError as e: errs.append(str(e))
res["errs"] = errs
print(json.dumps(res, ensure_ascii=False, default=str))`);
  expect(r.good.ok).toBe(true);
  expect(r.good.el.help, 'ภาษาไทยจากผลลัพธ์ที่ escape เป็น \\uXXXX ถอดกลับถูก (รวม BOM นำหน้า)').toBe('นำเข้า');
  expect(r.good.el.rect).toEqual([1591, 256, 1611, 276]);
  expect(r.good.el.parents).toEqual([['', 'pn_trans_in'], ['MDI_TAB', 'TabControl']]);
  expect(r.cmd.slice(1, 6), 'ข้าม ExecutionPolicy เฉพาะโปรเซสนี้ · ไม่โหลดโปรไฟล์ · ไม่โต้ตอบ · ใช้ไฟล์สคริปต์')
    .toEqual(['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File']);
  expect(r.q, 'ชื่อภาษาไทยไปทางคำถาม base64 (ไม่อยู่ในบรรทัดคำสั่งเป็นข้อความดิบ)').toEqual({ op: 'find', hwnd: 4242, ids: ['a'], type: 'Button', name: 'เอกสาร', limit: 40 });
  expect(r.timeout).toBe(45);
  for (const k of ['nonzero', 'notjson', 'fail', 'timed', 'oserr', 'empty']) expect(r[k].ok, `${k} ต้องเป็น UiaError`).toBe(false);
  expect(r.fail.msg).toContain('ArgumentException');
  expect(r.timed.msg).toContain('หมดเวลา');
  expect(r.errs, 'คำถามว่าง/id เกิน 4 ตัว ปฏิเสธก่อนเรียก PowerShell').toHaveLength(2);
  expect(r.good.stats.calls).toBe(1);
});

test('3. PowerShell จริง (เฉพาะ Windows) — ping ใช้ได้ · hwnd ผิด/ไม่มีอยู่ ล้มอย่างชัดเจน (UiaError ไม่ใช่ผลว่าง)', async () => {
  test.skip(process.platform !== 'win32', 'ต้องมี Windows PowerShell 5.1 + .NET UIAutomation (เทสจริงของตัวอ่าน — ที่อื่นรันไม่ได้)');
  const r = runPy(`
import promaxx_uia as u
pu = u.PsUia(m.UiaEl, script_dir=tmp)
out = dict(ping=pu.ping())
for label, kw in (('badhwnd', dict(hwnd=1, ids=['x'])), ('nohwnd', dict(hwnd=0, ids=['x']))):
    try:
        pu.find(**kw); out[label] = 'NO ERROR'
    except u.UiaError as e:
        out[label] = str(e)[:160]
out['stats'] = pu.stats()
print(json.dumps(out, ensure_ascii=False))`);
  expect(r.ping.ok).toBe(true);
  expect(r.ping.ps, 'Windows PowerShell 5.1').toMatch(/^5\./);
  expect(r.badhwnd, 'hwnd ที่ไม่ใช่หน้าต่าง ต้องล้ม ไม่ใช่คืนรายการว่าง').not.toBe('NO ERROR');
  expect(r.nohwnd).not.toBe('NO ERROR');
  expect(r.stats.calls).toBe(3);
});

test('3b. (opt-in) หน้าต่าง WPF จริงที่สร้างเอง — find ด้วย id/ชนิด/ชื่อไทย/OR ของหลาย id · HelpText จาก ToolTip · พิกัด · dump ไม่มีค่าที่พิมพ์', async () => {
  test.skip(process.platform !== 'win32' || !process.env.PROMAXX_UIA_REAL_WINDOW,
    'เปิดหน้าต่างจริงบนหน้าจอ ~2 วินาที — ตั้ง PROMAXX_UIA_REAL_WINDOW=1 เพื่อรัน (Windows เท่านั้น)');
  const r = runPy(`
import subprocess, sys, promaxx_uia as u
ps = u.powershell_exe()
script = r'''
Add-Type -AssemblyName PresentationFramework, PresentationCore, WindowsBase
$w = New-Object System.Windows.Window
$w.Title = 'pmx-uia-test'; $w.Width = 420; $w.Height = 240; $w.WindowStartupLocation = 'Manual'; $w.Left = 40; $w.Top = 40; $w.ShowInTaskbar = $false
$sp = New-Object System.Windows.Controls.StackPanel
$b = New-Object System.Windows.Controls.Button; $b.Content = 'x'; $b.Width = 120; $b.Height = 30
[System.Windows.Automation.AutomationProperties]::SetAutomationId($b, 't_btn')
[System.Windows.Automation.AutomationProperties]::SetName($b, [string]::Join('', ([char[]](0x0e17, 0x0e14, 0x0e2a, 0x0e2d, 0x0e1a))))
$b.ToolTip = [string]::Join('', ([char[]](0x0e19, 0x0e33, 0x0e40, 0x0e02, 0x0e49, 0x0e32)))
$t = New-Object System.Windows.Controls.TextBox; $t.Text = 'SECRET-TYPED-VALUE'; $t.Width = 200
[System.Windows.Automation.AutomationProperties]::SetAutomationId($t, 't_edit')
[void]$sp.Children.Add($b); [void]$sp.Children.Add($t)
$w.Content = $sp
$w.Add_ContentRendered({ [Console]::Out.WriteLine([string]([System.Windows.Interop.WindowInteropHelper]$w).Handle.ToInt64()); [Console]::Out.Flush() })
$t2 = New-Object System.Windows.Threading.DispatcherTimer; $t2.Interval = [TimeSpan]::FromSeconds(25); $t2.Add_Tick({ $w.Close() }); $t2.Start()
[void]$w.ShowDialog()
'''
p = subprocess.Popen([ps, '-NoProfile', '-NonInteractive', '-Sta', '-ExecutionPolicy', 'Bypass', '-Command', script], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
try:
    hwnd = int(p.stdout.readline().strip())
    pu = u.PsUia(m.UiaEl, script_dir=tmp)
    b = pu.find(hwnd, ids=['t_btn'], ctype='Button')
    byname = pu.find(hwnd, ctype='Button', name='\\u0e17\\u0e14\\u0e2a\\u0e2d\\u0e1a')
    either = pu.find(hwnd, ids=['nope', 't_btn', 't_edit'])
    lines = pu.dump(hwnd, max_nodes=50)
    out = dict(n=len(b), el=b[0].__dict__ if b else None, byname=len(byname), either=sorted(e.id for e in either), dump=lines, stats=pu.stats())
finally:
    p.kill()
print(json.dumps(out, ensure_ascii=False, default=str))`);
  expect(r.n).toBe(1);
  expect(r.el.help, 'HelpText ได้จาก ToolTip (ภาษาไทยผ่านทั้งขาเข้า/ขาออก)').toBe('นำเข้า');
  expect(r.el.name).toBe('ทดสอบ');
  expect(r.el.type).toBe('Button');
  expect(r.byname, 'ค้นด้วยชื่อไทยผ่าน base64 ได้').toBe(1);
  expect(r.either, 'OR ของหลาย id (id ที่ไม่มีไม่ทำให้ล้ม)').toEqual(['t_btn', 't_edit']);
  expect(r.el.rect[2] - r.el.rect[0], 'พิกัดกว้างตามจริง').toBeGreaterThan(50);
  expect(JSON.stringify(r.dump), 'dump ไม่มีค่าที่พิมพ์ในช่องกรอก').not.toContain('SECRET-TYPED-VALUE');
  expect(r.dump.some((l) => l.includes('t_edit'))).toBe(true);
});
