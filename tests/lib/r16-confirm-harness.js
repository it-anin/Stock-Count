// ตัวช่วยร่วมของเทส Confirm โดยบอท auto-r16: โลกจำลอง (R01/PBM/R05/session/items/CSV) + รัน main() จริงของบอทกับ Firestore REST จำลอง
//
// ⚠️ ไม่แตะเครือข่าย: m._request ถูกแทนด้วย tests/lib/fake_firestore.py (ทุกฟังก์ชัน REST ของบอทผ่านจุดเดียว) · นาฬิกา (m._now_bkk) และ time.sleep ถูกคุมโดยเทส
//    จึงทดสอบ "เวลา 21:10" ได้ทุกเวลาที่รันเทส · ไฟล์สถานะ (shadow log / journal) เขียนลงโฟลเดอร์ชั่วคราว (AUTO_R16_STATE_DIR)
// ความเที่ยงตรงของ REST จริง (precondition/transform/query/rules) ตรวจที่ e2e/auto-r16-confirm.spec.js กับ Firestore emulator
const path = require('path');
const { runPython } = require('./python');
const F = require('./r16-104-fixture');

const FAKE = path.resolve(__dirname, 'fake_firestore.py');
const BRANCHES = ['SRC', 'KKL', 'SSS'];
const EPOCH = '2026-10-01T03:00:00.000Z';
const NOW = '2026-10-21T21:10:00+07:00';     // บอทรันตอน 21:10
const MTIME = '2026-10-21T21:05:00+07:00';   // BOTR16104 export เสร็จ 21:05 (นิ่งแล้ว 5 นาที)
const DAY = '2026-10-21';
const TODAY = '21/10/2026';                  // d/m/yyyy แบบ ProMaxx
const R01_VERSION = (b) => `2026-10-21T00:31:00.000Z-${b}`;

// item หนึ่งรายการตามรูปที่ PDA/Desktop เขียนจริง (_scanItemPayload): ไม่มี retries/scans/manualEditAt (field local)
function item(sku, count, time, extra = {}) {
  const at = `${DAY} ${time}`;
  return {
    sku, countResetAt: EPOCH, status: 'scanning', countedQty: count, timestamp: at, firstScanAt: at,
    scannedBy: 'พนักงานทดสอบ', auditor: '', auditStatus: 'pending', barcode: 'B-' + sku.slice(2), location: '',
    rev: 3, updatedBy: 'พนักงานทดสอบ', updatedAt: { __ts: `${DAY}T03:00:00.000000Z` },
    ...extra,
  };
}

// แถว R16.104 ของสาขา b: kind 'sale' (ORCM Col A=1 → ขายหน้าร้าน) | 'inbound' (OTFB Col A=0 → รับเข้า · ใช้กับ KKL/SSS)
function r16Row(b, [barcode, qty, time, kind = 'sale'], n) {
  const sku = 'S-' + barcode.slice(2);
  const tranNo = (kind === 'inbound' ? 'OTFBBY0012610' : 'ORCMBY0012610') + String(n).padStart(5, '0');
  return F.branchRow(b, { tranNo, colA: kind === 'inbound' ? '0' : '1', qty: `${qty}.0000`, barcode, sku, at: `${TODAY} ${time}` });
}

// โลกจำลองทั้งหมด: docs (rel path → plain) + csv
// opts: {branches, items:{b:[item…]}, sales:{b:[[barcode,qty,time,kind]…]}, sys:{sku:qty}, epoch, schema, r01Day, extraDocs}
function world(opts = {}) {
  const { branches = ['SSS'], items = {}, sales = {}, sys = {}, epoch = EPOCH, schema = 2, r01Day = TODAY, extraDocs = {} } = opts;
  const cat = F.catalog();
  const r01 = cat.r01.map((r) => (r.colE in sys ? { ...r, systemQty: sys[r.colE] } : r));
  const r05 = cat.r05.filter((r) => r.barcode && r.colE).map((r) => [r.barcode, r.colE, r.unitName, r.unitMultiplier, r.unitPrice]);
  const docs = { 'stock_sessions/global_r05': { data_json: JSON.stringify(r05), format: 'r05a1' } };
  const rows = [];
  let n = 1;
  for (const b of branches) {
    docs[`stock_sessions/${b}_r01`] = {
      data_json: JSON.stringify(r01), r01Version: R01_VERSION(b), r01UploadedAt: `07:31 น. ${r01Day}`, r16Loaded: false, r16DetailVersion: '',
    };
    docs[`stock_sessions/${b}_pm`] = { data_json: JSON.stringify(cat.pm) };
    docs[`stock_sessions/${b}`] = { schemaVersion: schema, session_data_json: JSON.stringify({ countResetAt: epoch, scanData: {} }) };
    for (const it of items[b] || []) docs[`stock_sessions/${b}/items/${it.sku}`] = it;
    // ทุกสาขาต้องมีอย่างน้อย 1 แถวในไฟล์ ไม่งั้นบอทข้ามสาขา — แถวกันตาย: ขาย SKU ที่ไม่มีใครนับ
    const list = [['B-01', 1, '09:00:00'], ...(sales[b] || [])];
    for (const s of list) rows.push(r16Row(b, s, n++));
  }
  Object.assign(docs, extraDocs);
  return { docs, csv: F.csvText(rows) };
}

// Python ฝั่งเทส: ประกอบโลก → รัน main() ตามลำดับ runs → คืนผลทุกอย่างที่เทสต้องตรวจ
const HARNESS = `
import os, io, json, time, tempfile, contextlib, importlib.util, threading, http.server
from datetime import datetime, timezone

spec2 = importlib.util.spec_from_file_location('fake_firestore', p['fake'])
ffm = importlib.util.module_from_spec(spec2); spec2.loader.exec_module(ffm)

clock = {'now': datetime.fromisoformat(p['now'])}
ff = ffm.FakeFirestore(m, clock['now'].astimezone(timezone.utc))
for rel, plain in p['docs'].items(): ff.put(rel, plain)
ff.script = p.get('script', [])
m._request = ff.request
m._now_bkk = lambda: clock['now']
sleeps = []
m.time.sleep = lambda s: sleeps.append(s)
for k, v in (p.get('consts') or {}).items(): setattr(m, k, v)

state_dir = tempfile.mkdtemp(prefix='r16conf')
os.environ['AUTO_R16_STATE_DIR'] = state_dir
os.environ['AUTO_R16_NOTIFY'] = '0'   # เทสห้ามยิง Telegram จริง (เครื่องพัฒนาอาจมี .env) — ดูเทสแจ้งเตือนที่ auto-r16-notify.spec.js
for k in ('TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID', 'AUTO_R16_TELEGRAM_BASE'): os.environ.pop(k, None)
script_dir = tempfile.mkdtemp(prefix='r16script')   # แทนโฟลเดอร์ข้างสคริปต์ (หา .env) — ไม่ให้ .env จริงของเครื่องพัฒนาเข้ามาปน
m._script_dir = lambda: script_dir

# เซิร์ฟเวอร์ Telegram จำลอง (เปิดเมื่อเทสสั่ง op 'telegram') — บล็อกด้วย threading.Event ไม่ใช่ time.sleep (ถูกแทนเป็น no-op ด้านบน)
tg = {'reqs': [], 'script': [], 'base': None}
def start_tg():
    if tg['base']:
        os.environ['AUTO_R16_TELEGRAM_BASE'] = tg['base']   # เทสอาจลบตัวแปรนี้ไประหว่างรอบ (op env) — เรียก op telegram อีกครั้ง = ชี้เซิร์ฟเวอร์จำลองใหม่
        return
    class H(http.server.BaseHTTPRequestHandler):
        def log_message(self, *a): pass
        def do_POST(self):
            n = int(self.headers.get('Content-Length') or 0)
            raw = self.rfile.read(n).decode('utf-8')
            try: body = json.loads(raw)
            except Exception: body = None
            tg['reqs'].append({'path': self.path, 'body': body, 'ctype': self.headers.get('Content-Type')})
            step = tg['script'].pop(0) if tg['script'] else {}
            if step.get('hang'): threading.Event().wait(step['hang'])
            status = step.get('status', 200)
            out = json.dumps(step.get('json', {'ok': status == 200})).encode('utf-8')
            try:
                self.send_response(status); self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(out))); self.end_headers(); self.wfile.write(out)
            except Exception: pass
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), H); srv.daemon_threads = True
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    tg['base'] = 'http://127.0.0.1:%d' % srv.server_address[1]
    os.environ['AUTO_R16_TELEGRAM_BASE'] = tg['base']

if p.get('breakJournal'):
    open(os.path.join(state_dir, 'confirm_journal'), 'w').write('x')   # มีไฟล์ชื่อโฟลเดอร์ journal อยู่แล้ว → สร้างโฟลเดอร์ไม่ได้
folder = tempfile.mkdtemp(prefix='r16csv')
csv_path = os.path.join(folder, 'R16104.CSV')
open(csv_path, 'wb').write(('\\ufeff' + p['csv']).encode('utf-8'))
def set_mtime(iso):
    t = datetime.fromisoformat(iso).timestamp(); os.utime(csv_path, (t, t))
set_mtime(p['mtime'])

def journal_files():
    d = os.path.join(state_dir, 'confirm_journal')
    return sorted(os.path.join(d, f) for f in os.listdir(d) if os.path.isfile(os.path.join(d, f))) if os.path.isdir(d) else []

def apply_ops(ops):
    for o in ops or []:
        if o['op'] == 'touch': ff.touch(o['path'], **o.get('set', {}))
        elif o['op'] == 'put': ff.put(o['path'], o['plain'])
        elif o['op'] == 'delete': ff.docs.pop(o['path'], None)
        elif o['op'] == 'now': clock['now'] = datetime.fromisoformat(o['at'])
        elif o['op'] == 'mtime': set_mtime(o['at'])
        elif o['op'] == 'script': ff.script = o['script']
        elif o['op'] == 'const': setattr(m, o['name'], o['value'])
        elif o['op'] == 'unlink_csv': os.remove(csv_path)
        elif o['op'] == 'env':   # ตั้ง/ลบตัวแปรระบบ (ใช้กับเทสแจ้งเตือน: AUTO_R16_NOTIFY · TELEGRAM_BOT_TOKEN · TELEGRAM_CHAT_ID)
            for k, v in (o.get('set') or {}).items(): os.environ[k] = v
            for k in o.get('unset') or []: os.environ.pop(k, None)
        elif o['op'] == 'dotenv':   # วางไฟล์ .env ข้างสคริปต์ (script) หรือในโฟลเดอร์ CSV (folder)
            open(os.path.join(script_dir if o['where'] == 'script' else folder, '.env'), 'w', encoding='utf-8').write(o['content'])
        elif o['op'] == 'telegram':   # เปิดเซิร์ฟเวอร์ Telegram จำลอง + กำหนดคำตอบทีละคำขอ [{status, json, hang}]
            start_tg(); tg['script'] = o.get('script', [])
        elif o['op'] == 'break':   # ทำให้ฟังก์ชันของบอทพัง (ZeroDivisionError) — ไว้ทดสอบทางออกที่ไม่คาดคิด
            setattr(m, o['name'], lambda *a, **k: 1 / 0)
        elif o['op'] == 'urlopen_raises':   # urlopen โยน exception ที่ "ข้อความมี URL เต็ม" (รวม token) — ไว้ตรวจว่าเหตุผลที่บอทเก็บเป็นแค่ชื่อชนิด error
            def _boom(req, timeout=None): raise RuntimeError('boom while calling ' + req.full_url)
            m.urllib.request.urlopen = _boom
        elif o['op'] == 'statefile':   # วางไฟล์/โฟลเดอร์ในโฟลเดอร์สถานะของบอท (ageDays = ให้ดูเก่ากี่วัน · dir = สร้างเป็นโฟลเดอร์)
            fp = os.path.join(state_dir, o['rel'])
            os.makedirs(os.path.dirname(fp), exist_ok=True)
            if o.get('dir'): os.makedirs(fp, exist_ok=True)
            else: open(fp, 'w', encoding='utf-8').write(o.get('content', '{"planted": true}'))
            if o.get('ageDays') is not None:
                t = time.time() - o['ageDays'] * 86400; os.utime(fp, (t, t))

initial = ff.snapshot()
runs = []
for spec in p['runs']:
    apply_ops(spec.get('ops'))
    jf = journal_files()
    args = [a.replace('{JOURNAL_LATEST}', jf[-1] if jf else 'NO-JOURNAL').replace('{JOURNAL_FIRST}', jf[0] if jf else 'NO-JOURNAL') for a in spec.get('args', [])]
    # ค่าเริ่มต้นของ --branch = สาขาที่มีในโลกจำลอง (บอทจริงดูแลทั้ง 3 สาขา แต่สาขาที่ไม่มีแถวในไฟล์จะตกด่าน exit 4 ซึ่งไม่ใช่สิ่งที่เทสส่วนใหญ่ต้องการ)
    if not any(a == '--branch' or a.startswith('--branch=') for a in args) and not any(a in ('--confirm-undo', '--confirm-compare') for a in args):
        args = ['--branch', ','.join(p['branches'])] + args
    n_req, n_wr, n_tg = len(ff.requests), len(ff.writes), len(tg['reqs'])
    buf = io.StringIO(); code = 0; t0 = time.time()
    with contextlib.redirect_stdout(buf), contextlib.redirect_stderr(buf):   # stderr รวมเข้า log ด้วย (traceback ของ "ผิดพลาดที่ไม่คาดคิด" ไม่ไปรกหน้าจอเทส)
        try: m.main(['--folder', folder] + args)
        except SystemExit as e: code = e.code if isinstance(e.code, int) else 0
    runs.append({'code': code, 'log': buf.getvalue(), 'requests': ff.requests[n_req:], 'writes': ff.writes[n_wr:], 'sleeps': list(sleeps), 'store': ff.snapshot(),
                 'telegram': tg['reqs'][n_tg:], 'elapsed': time.time() - t0})
    del sleeps[:]

files = {}
sp = os.path.join(state_dir, 'auto_r16_confirm_shadow.jsonl')
if os.path.exists(sp): files['shadow'] = [json.loads(l) for l in open(sp, encoding='utf-8') if l.strip()]
if os.path.exists(sp + '.1'): files['shadowOld'] = [json.loads(l) for l in open(sp + '.1', encoding='utf-8') if l.strip()]
files['journals'] = {os.path.basename(f): json.load(open(f, encoding='utf-8')) for f in journal_files()}
jd = os.path.join(state_dir, 'confirm_journal')
files['journalEntries'] = sorted(os.listdir(jd)) if os.path.isdir(jd) else []
files['stateDirEntries'] = sorted(os.listdir(state_dir))
print(json.dumps({'runs': runs, 'store': ff.snapshot(), 'initial': initial, 'files': files}, ensure_ascii=False))
`;

// opts: {docs, csv, runs:[{args, ops}], script, consts, now, mtime, breakJournal}
function run(opts = {}) {
  const docs = opts.docs || {};
  const branches = BRANCHES.filter((b) => `stock_sessions/${b}_r01` in docs);
  return runPython(HARNESS, { fake: FAKE, now: NOW, mtime: MTIME, runs: [{ args: [] }], branches, ...opts });
}

// ผลย่อ: item ของสาขา b หลังรันจบ (plain) · res = ผลทั้งชุด (สถานะหลังรอบสุดท้าย) หรือ res.runs[i] (สถานะหลังรอบที่ i)
const itemOf = (res, b, sku) => (res.store[`stock_sessions/${b}/items/${sku}`] || {}).fields;
const docOf = (res, rel) => (res.store[rel] || {}).fields;
// รายการ write "ของขั้น Confirm" = แตะ items/ · lock · audit log (แยกจากการเผยแพร่ timeline ที่ใช้ PATCH ธรรมดา)
// เอกสารที่ไม่ถูกเขียนเลยตลอดการรัน: updateTime เท่าตอนเริ่มเป๊ะ (จับได้แม้เขียนค่าเดิมซ้ำ)
const untouched = (res, rel) => !!res.initial[rel] && !!res.store[rel] && res.initial[rel].update === res.store[rel].update;
const confirmWrites = (r) => r.writes.filter((w) => /\/items\/|_confirm_lock|^stock_audit_log\//.test(w.path));

module.exports = { BRANCHES, EPOCH, NOW, MTIME, DAY, TODAY, R01_VERSION, item, world, run, itemOf, docOf, untouched, confirmWrites, FAKE };
