# -*- coding: utf-8 -*-
r"""
ตัวอ่าน UI Automation (UIA) ของ ssmaxx.exe ผ่าน Windows PowerShell + .NET (UIAutomationClient) — อ่านอย่างเดียว

ทำไมต้องมี: ssmaxx.exe เป็นแอป WPF (.NET) ข้างในไม่มี HWND/HMENU ให้ Win32 มองเห็น (ตรวจจริง 3 พ.ย. 2026 · README §ผลตรวจจริง)
แต่ WPF เปิดเผยทุกปุ่ม/ช่อง/รายการผ่าน UIA พร้อม AutomationId ที่คงที่ → ใช้หาเป้า + อ่านพิกัด/สถานะ
(การคลิกปกติใช้เมาส์จริงของ promaxx_win.py ที่กึ่งกลางพิกัดที่ UIA ให้ · ยกเว้นโหมด "ซ่อนหน้าต่าง" (รุ่น 2026-11-04.5) ที่ใช้ op act ด้านล่าง)

⛔ กติกา (แก้โค้ดแล้วต้องไม่ทำให้ข้อใดหาย):
  1. สคริปต์ PowerShell เป็นค่าคงที่ในไฟล์นี้เท่านั้น · ไม่รับสคริปต์/คำสั่งจากภายนอก · ส่งเฉพาะ "ข้อมูลคำถาม" เป็น JSON→base64
     ห้ามต่อสตริงจากข้อมูลภายนอกเข้าไปในตัวสคริปต์ (ไม่มี Invoke-Expression/ไม่มี -Command)
  2. op ping/find/dump อ่านอย่างเดียว: ไม่ Invoke/SetValue/SetFocus/คลิก · ไม่อ่านค่าที่พิมพ์ในช่องกรอก (ไม่ใช้ ValuePattern) · ตัดชื่อที่ 80 ตัวอักษร
     ★ op act (เพิ่ม 4 พ.ย. 2026 รุ่น .5) สั่งได้เพียง 2 อย่างเท่านั้น: Button → InvokePattern.Invoke() · ListItem/TabItem → SelectionItemPattern.Select()
       ไม่มี SetValue/SendKeys/SetFocus/ValuePattern · ต้องระบุพิกัดเป้า และต้องพบเป้า "1 รายการพอดี" ที่พิกัดตรง (±2px) และเปิดใช้งานอยู่ ไม่งั้นไม่สั่ง
       (ใช้เฉพาะตอนหน้าต่างถูกซ่อน — ช่องรหัสผ่านไม่มี ValuePattern จึงล็อกอินต้องใช้เมาส์/คีย์จริงเสมอ)
  3. สคริปต์ต้องเป็น ASCII ล้วน (เทสตรึง) — Windows PowerShell 5.1 อ่านไฟล์ .ps1 ที่ไม่มี BOM เป็นรหัสเดิมของเครื่อง ภาษาไทยจะพังและ
     บางไบต์ถอดเป็นเครื่องหมายคำพูดโค้งทำให้สตริงขาดกลางคัน · ข้อความไทยส่งเข้าเป็น base64 (UTF-8) และผลลัพธ์ escape เป็น \uXXXX
  4. ผลลัพธ์ล้มเหลว/หมดเวลา/ไม่ใช่ JSON = UiaError (ไม่เดา · ผู้เรียกต้องหยุดไม่คลิก)

ไฟล์นี้ import บน Linux ได้ (ไม่ผูก Windows จนกว่าจะเรียก PsUia จริง) → เทสได้ด้วย runner ปลอม
"""
import base64
import hashlib
import json
import os
import subprocess
import tempfile
import time

CREATE_NO_WINDOW = 0x08000000
MAX_IDS = 4
ACT_PATTERNS = {"Button": "invoke", "ListItem": "select", "TabItem": "select"}   # ชนิดองค์ประกอบ → pattern ที่ op act ยอมสั่ง (ห้ามขยายโดยไม่ขออนุมัติ)

# ─────────────────────────────────────────────────────────────
# สคริปต์ PowerShell (ASCII ล้วน — เทสตรึง) · ops: ping | find | dump
# ─────────────────────────────────────────────────────────────
SCRIPT = r'''
param([Parameter(Mandatory = $true)][string]$QueryB64)
$ErrorActionPreference = 'Stop'
# NOTE: PowerShell variable names are case-INSENSITIVE. The parameter must not be called $Q because the parsed query below is $q;
# a typed [string] parameter would silently turn the parsed dictionary into a string (found on the first real run).
$ser = $null

function Write-Result($obj) {
  $s = $ser.Serialize($obj)
  $s = [regex]::Replace($s, '[^\x20-\x7e]', [System.Text.RegularExpressions.MatchEvaluator]{ param($m) ('\u{0:x4}' -f [int][char]$m.Value) })
  [Console]::Out.Write($s)
}

function Cut([string]$s, [int]$n) {
  if ($null -eq $s) { return '' }
  $s = ($s -replace '[\r\n\t]+', ' ')
  if ($s.Length -gt $n) { return $s.Substring(0, $n) }
  return $s
}

function Get-Rect($el) {
  try {
    $r = $el.Current.BoundingRectangle
    if ($r.IsEmpty) { return $null }
    return @([long][math]::Round($r.Left), [long][math]::Round($r.Top), [long][math]::Round($r.Right), [long][math]::Round($r.Bottom))
  } catch { return $null }
}

function Describe($el, $walker, $nParents) {
  $c = $el.Current
  $ps = New-Object System.Collections.ArrayList
  $p = $el
  for ($i = 0; $i -lt $nParents; $i++) {
    try { $p = $walker.GetParent($p) } catch { break }
    if ($null -eq $p) { break }
    $pc = $p.Current
    [void]$ps.Add(@{ id = (Cut $pc.AutomationId 60); cls = (Cut $pc.ClassName 60) })
  }
  $isPw = $false
  try { $isPw = [bool]$c.IsPassword } catch {}
  return @{
    id = (Cut $c.AutomationId 80)
    type = ($c.ControlType.ProgrammaticName -replace '^ControlType\.', '')
    name = (Cut $c.Name 80)
    help = (Cut $c.HelpText 120)
    cls = (Cut $c.ClassName 60)
    rect = (Get-Rect $el)
    enabled = [bool]$c.IsEnabled
    offscreen = [bool]$c.IsOffscreen
    focusable = [bool]$c.IsKeyboardFocusable
    focused = [bool]$c.HasKeyboardFocus
    password = $isPw
    parents = $ps.ToArray()
  }
}

function New-PropCond($prop, $val) {
  return New-Object System.Windows.Automation.PropertyCondition($prop, $val)
}

function Join-Conds($kind, $list) {
  if ($list.Count -eq 1) { return $list[0] }
  $arr = New-Object 'System.Windows.Automation.Condition[]' $list.Count
  for ($i = 0; $i -lt $list.Count; $i++) { $arr[$i] = $list[$i] }
  if ($kind -eq 'or') { return New-Object System.Windows.Automation.OrCondition -ArgumentList (, $arr) }
  return New-Object System.Windows.Automation.AndCondition -ArgumentList (, $arr)
}

function Build-Cond($q) {
  $conds = New-Object System.Collections.ArrayList
  $ids = New-Object System.Collections.ArrayList
  if ($null -ne $q['ids']) { foreach ($x in $q['ids']) { if ([string]$x -ne '') { [void]$ids.Add([string]$x) } } }
  if ($ids.Count -gt 4) { throw 'too many ids' }
  if ($ids.Count -gt 0) {
    $idc = New-Object System.Collections.ArrayList
    foreach ($i in $ids) { [void]$idc.Add((New-PropCond ([System.Windows.Automation.AutomationElement]::AutomationIdProperty) $i)) }
    [void]$conds.Add((Join-Conds 'or' $idc))
  }
  $tname = [string]$q['type']
  if ($tname -ne '') {
    if ($tname -notmatch '^[A-Za-z]{2,24}$') { throw 'bad control type' }
    $fld = [System.Windows.Automation.ControlType].GetField($tname)
    if ($null -eq $fld) { throw 'unknown control type' }
    [void]$conds.Add((New-PropCond ([System.Windows.Automation.AutomationElement]::ControlTypeProperty) ($fld.GetValue($null))))
  }
  $nm = [string]$q['name']
  if ($nm -ne '') { [void]$conds.Add((New-PropCond ([System.Windows.Automation.AutomationElement]::NameProperty) $nm)) }
  if ($conds.Count -eq 0) { throw 'empty query' }
  return (Join-Conds 'and' $conds)
}

$script:count = 0
$script:lines = $null
$script:maxNodes = 1500
$script:maxDepth = 14
$script:rawWalker = $null

function Walk($el, [int]$depth) {
  if ($script:count -ge $script:maxNodes) { return }
  try { if ($el.Current.ControlType -eq [System.Windows.Automation.ControlType]::ScrollBar) { return } } catch {}
  $script:count++
  try {
    $c = $el.Current
    $r = Get-Rect $el
    $rect = '(empty)'
    if ($null -ne $r) { $rect = '(' + $r[0] + ',' + $r[1] + ',' + $r[2] + ',' + $r[3] + ')' }
    $pw = ''
    try { if ($c.IsPassword) { $pw = ' PASSWORD' } } catch {}
    $line = ('  ' * $depth) + ($c.ControlType.ProgrammaticName -replace '^ControlType\.', '') + ' id=' + (Cut $c.AutomationId 60) + ' name="' + (Cut $c.Name 80) + '" cls=' + (Cut $c.ClassName 50) + ' rect=' + $rect + ' en=' + $c.IsEnabled + ' off=' + $c.IsOffscreen + ' focus=' + $c.HasKeyboardFocus + $pw
    [void]$script:lines.Add($line)
  } catch { [void]$script:lines.Add(('  ' * $depth) + '(unreadable element)') }
  if ($depth -ge $script:maxDepth) { return }
  try {
    $ch = $script:rawWalker.GetFirstChild($el)
    while ($null -ne $ch) {
      if ($script:count -ge $script:maxNodes) { [void]$script:lines.Add(('  ' * ($depth + 1)) + '... (node cap reached)'); break }
      Walk $ch ($depth + 1)
      $ch = $script:rawWalker.GetNextSibling($ch)
    }
  } catch {}
}

try {
  Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, System.Web.Extensions
  $ser = New-Object System.Web.Script.Serialization.JavaScriptSerializer
  $ser.MaxJsonLength = 100000000
  $json = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($QueryB64))
  $q = $ser.DeserializeObject($json)
  $op = [string]$q['op']
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  $AE = [System.Windows.Automation.AutomationElement]

  if ($op -eq 'ping') {
    Write-Result @{ ok = $true; ps = $PSVersionTable.PSVersion.ToString(); ms = [int]$sw.ElapsedMilliseconds }
    exit 0
  }

  if ($op -eq 'act') {
    # validate the (control type, pattern) pair BEFORE touching any window: only Button->invoke and ListItem/TabItem->select are allowed
    $pat = [string]$q['pattern']
    $ct = [string]$q['type']
    $okPair = (($pat -eq 'invoke') -and ($ct -eq 'Button')) -or (($pat -eq 'select') -and (($ct -eq 'ListItem') -or ($ct -eq 'TabItem')))
    if (-not $okPair) { throw 'pattern not allowed for this control type' }
  }

  $root = $AE::FromHandle([IntPtr][int64]$q['hwnd'])

  if ($op -eq 'find') {
    $cond = Build-Cond $q
    $found = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $cond)
    $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
    $limit = 40
    if ($null -ne $q['limit']) { $limit = [int]$q['limit'] }
    $els = New-Object System.Collections.ArrayList
    $n = $found.Count
    for ($i = 0; $i -lt [math]::Min($n, $limit); $i++) { [void]$els.Add((Describe $found.Item($i) $walker 8)) }
    Write-Result @{ ok = $true; ms = [int]$sw.ElapsedMilliseconds; total = $n; els = $els.ToArray() }
    exit 0
  }

  if ($op -eq 'act') {
    $want = @($q['rect'])
    if ($want.Count -ne 4) { throw 'rect required' }
    $cond = Build-Cond $q
    $found = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $cond)
    $hits = New-Object System.Collections.ArrayList
    for ($i = 0; $i -lt $found.Count; $i++) {
      $el = $found.Item($i)
      $r = Get-Rect $el
      if ($null -eq $r) { continue }
      $same = $true
      for ($k = 0; $k -lt 4; $k++) { if ([math]::Abs([long]$r[$k] - [long]$want[$k]) -gt 2) { $same = $false } }
      if ($same) { [void]$hits.Add($el) }
    }
    if ($hits.Count -ne 1) { throw ('target count ' + $hits.Count) }
    $tgt = $hits[0]
    if (-not $tgt.Current.IsEnabled) { throw 'target disabled' }
    if ($pat -eq 'invoke') { $tgt.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke() }
    else { $tgt.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern).Select() }
    Write-Result @{ ok = $true; acted = $pat; ms = [int]$sw.ElapsedMilliseconds }
    exit 0
  }

  if ($op -eq 'dump') {
    if ($null -ne $q['maxNodes']) { $script:maxNodes = [int]$q['maxNodes'] }
    if ($null -ne $q['maxDepth']) { $script:maxDepth = [int]$q['maxDepth'] }
    $script:lines = New-Object System.Collections.ArrayList
    $script:rawWalker = [System.Windows.Automation.TreeWalker]::RawViewWalker
    Walk $root 0
    Write-Result @{ ok = $true; ms = [int]$sw.ElapsedMilliseconds; nodes = $script:count; lines = $script:lines.ToArray() }
    exit 0
  }

  throw 'unknown op'
} catch {
  $msg = $_.Exception.GetType().Name + ': ' + $_.Exception.Message
  $msg = [regex]::Replace($msg, '[^A-Za-z0-9 :._-]', '?')
  if ($msg.Length -gt 160) { $msg = $msg.Substring(0, 160) }
  [Console]::Out.Write('{"ok":false,"error":"' + $msg + '"}')
  exit 0
}
'''


class UiaError(Exception):
    """อ่าน UIA ไม่สำเร็จ (PowerShell ล้ม/หมดเวลา/ผลไม่ใช่ JSON/สคริปต์รายงานข้อผิดพลาด) — ผู้เรียกต้องหยุด ไม่คลิก"""


def encode_query(query):
    """dict → base64(UTF-8 JSON) · ภาษาไทยในคำถามส่งผ่านทางนี้เท่านั้น (ไม่ผ่านบรรทัดคำสั่งเป็นข้อความดิบ)"""
    return base64.b64encode(json.dumps(query, ensure_ascii=False).encode("utf-8")).decode("ascii")


def powershell_exe(environ=None):
    environ = os.environ if environ is None else environ
    p = os.path.join(environ.get("SystemRoot", r"C:\Windows"), "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
    return p if os.path.isfile(p) else "powershell.exe"


def _default_runner(cmd, timeout):
    kw = {"capture_output": True, "timeout": timeout, "stdin": subprocess.DEVNULL}
    if os.name == "nt":
        kw["creationflags"] = CREATE_NO_WINDOW
    r = subprocess.run(cmd, **kw)
    return r.returncode, r.stdout or b"", r.stderr or b""


class PsUia:
    """el_cls = dataclass ที่รับ keyword: id type name help cls rect enabled offscreen focusable focused password parents"""

    def __init__(self, el_cls, log=None, runner=None, script_dir=None, timeout=45, ps_exe=None, clock=None):
        self.el_cls = el_cls
        self.log = log or (lambda m: None)
        self.runner = runner or _default_runner
        self.script_dir = script_dir
        self.timeout = timeout
        self.ps_exe = ps_exe
        self.clock = clock or time.monotonic
        self._script_path = None
        self.calls = 0
        self.total_ms = 0
        self.max_ms = 0

    # ── ไฟล์สคริปต์ (เขียนครั้งเดียว · UTF-8 BOM · ชื่อมีแฮชของเนื้อหา) ──
    def script_path(self):
        if self._script_path and os.path.isfile(self._script_path):
            return self._script_path
        data = b"\xef\xbb\xbf" + SCRIPT.replace("\r\n", "\n").encode("ascii")
        d = self.script_dir or os.path.join(tempfile.gettempdir(), "PromaxxHelper_uia")
        os.makedirs(d, exist_ok=True)
        path = os.path.join(d, "uia_%s.ps1" % hashlib.sha1(data).hexdigest()[:10])
        try:
            with open(path, "rb") as f:
                same = f.read() == data
        except OSError:
            same = False
        if not same:
            tmp = path + ".%d.tmp" % os.getpid()
            with open(tmp, "wb") as f:
                f.write(data)
            os.replace(tmp, path)
        self._script_path = path
        return path

    def command(self, query):
        return [self.ps_exe or powershell_exe(), "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
                "-File", self.script_path(), "-QueryB64", encode_query(query)]

    # ── เรียกจริง ──
    def _call(self, query):
        t0 = self.clock()
        try:
            code, out, err = self.runner(self.command(query), self.timeout)
        except subprocess.TimeoutExpired:
            raise UiaError("หมดเวลา %d วินาที" % self.timeout)
        except OSError as e:
            raise UiaError("เรียก PowerShell ไม่ได้ (%s)" % type(e).__name__)
        ms = int((self.clock() - t0) * 1000)
        self.calls += 1
        self.total_ms += ms
        self.max_ms = max(self.max_ms, ms)
        if code != 0:
            raise UiaError("PowerShell จบด้วยรหัส %s" % code)
        text = (out or b"").decode("utf-8-sig", "replace").strip()
        try:
            res = json.loads(text)
        except ValueError:
            raise UiaError("ผลลัพธ์ไม่ใช่ JSON (%d ไบต์)" % len(out or b""))
        if not isinstance(res, dict) or not res.get("ok"):
            raise UiaError("UIA รายงานข้อผิดพลาด: %s" % (res.get("error") if isinstance(res, dict) else "?"))
        return res

    def stats(self):
        return {"calls": self.calls, "totalMs": self.total_ms, "maxMs": self.max_ms,
                "avgMs": int(self.total_ms / self.calls) if self.calls else 0}

    # ── ops ──
    def ping(self):
        return self._call({"op": "ping"})

    def find(self, hwnd, ids=(), ctype="", name="", limit=40):
        ids = [str(i) for i in (ids or ()) if str(i) != ""]
        if len(ids) > MAX_IDS:
            raise UiaError("id มากเกินไป (%d)" % len(ids))
        if not (ids or ctype or name):
            raise UiaError("คำถามว่าง (ต้องมี id/type/name อย่างน้อยหนึ่งอย่าง)")
        res = self._call({"op": "find", "hwnd": int(hwnd), "ids": ids, "type": ctype or "", "name": name or "", "limit": int(limit)})
        out = []
        for e in res.get("els") or []:
            rect = e.get("rect")
            out.append(self.el_cls(
                id=str(e.get("id", "")), type=str(e.get("type", "")), name=str(e.get("name", "")), help=str(e.get("help", "")),
                cls=str(e.get("cls", "")), rect=tuple(int(v) for v in rect) if rect and len(rect) == 4 else None,
                enabled=bool(e.get("enabled", True)), offscreen=bool(e.get("offscreen", False)),
                focusable=bool(e.get("focusable", False)), focused=bool(e.get("focused", False)),
                password=bool(e.get("password", False)),
                parents=tuple((str(p.get("id", "")), str(p.get("cls", ""))) for p in (e.get("parents") or []))))
        return out

    def act(self, hwnd, ids=(), ctype="", name="", rect=None, pattern=""):
        """สั่งองค์ประกอบ "ตัวเดียว" โดยไม่ใช้เมาส์: Button → invoke · ListItem/TabItem → select · ต้องระบุพิกัดที่อ่านมาจาก find (กันสั่งผิดตัว)
        UiaError เมื่อไม่พบ/พบหลายตัว/ถูกปิดใช้งาน/ชนิดกับ pattern ไม่ตรง — ผู้เรียกต้องหยุด"""
        ids = [str(i) for i in (ids or ()) if str(i) != ""]
        if len(ids) > MAX_IDS:
            raise UiaError("id มากเกินไป (%d)" % len(ids))
        if ACT_PATTERNS.get(ctype or "") != pattern:
            raise UiaError("ชนิด %r สั่งด้วย %r ไม่ได้" % (ctype, pattern))
        if not (ids or name):
            raise UiaError("act ต้องมี id หรือ name อย่างน้อยหนึ่งอย่าง")
        if not rect or len(rect) != 4:
            raise UiaError("act ต้องระบุพิกัดเป้า (กันสั่งผิดตัว)")
        return self._call({"op": "act", "hwnd": int(hwnd), "ids": ids, "type": ctype, "name": name or "",
                           "rect": [int(v) for v in rect], "pattern": pattern})

    def dump(self, hwnd, max_nodes=1500, max_depth=14):
        res = self._call({"op": "dump", "hwnd": int(hwnd), "maxNodes": int(max_nodes), "maxDepth": int(max_depth)})
        return [str(x) for x in (res.get("lines") or [])]
