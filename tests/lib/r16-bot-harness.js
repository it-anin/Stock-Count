// ตัวช่วยร่วมของเทสบอท auto-r16: Firestore จำลองในหน่วยความจำ + รัน main() จริงของบอท (ใช้ทั้งเทส flow และเทสตัวอ่านฝั่งแอป)
// ⚠️ ไม่แตะเครือข่าย: get_doc / patch_doc / delete_doc ของบอทถูกแทนด้วยของจำลองที่จดทุกการเรียก
const { runPython } = require('./python');
const F = require('./r16-104-fixture');

const BRANCHES = ['SRC', 'KKL', 'SSS'];
const EPOCH = '2026-10-01T03:00:00.000Z';
const R01_VERSION = (b) => `2026-10-13T01:00:00.000Z-${b}`;

// วันนี้ (เวลาไทย) รูปแบบ d/m/yyyy ของ ProMaxx — ต้องตรงกับ "วันนี้" ที่บอทคำนวณ (UTC+7 คงที่)
function todayBkk(shiftDays = 0) {
  const d = new Date(Date.now() + 7 * 3600 * 1000 + shiftDays * 86400 * 1000);
  return `${d.getUTCDate()}/${d.getUTCMonth() + 1}/${d.getUTCFullYear()}`;
}

function csvRows(b, { at = `${todayBkk()} 09:00:00`, name } = {}) {
  const mk = (o) => F.branchRow(b, { at, ...(name ? { name } : {}), ...o });
  return [
    mk({ tranNo: 'ORCMBY001261000001', colA: '1', qty: '2.0000', barcode: 'B-01', sku: 'S-01' }),
    mk({ tranNo: 'ORCMBY001261000002', colA: '1', qty: '3.0000', barcode: 'B-02', sku: 'S-02', at: `${todayBkk()} 14:20:05` }),
    mk({ tranNo: 'OTFBBY001261000003', colA: '1', qty: '4.0000', barcode: 'B-03', sku: 'S-03' }),
    mk({ tranNo: 'ORCMBY001261000004', colA: '1', qty: '9.0000', barcode: 'B-04', sku: 'S-04', cancel: '1' }),
    mk({ tranNo: 'ORDSBY001261000005', colA: '1', qty: '1.0000', barcode: 'B-05', sku: 'S-05' }),
  ];
}

function baseDocs(over = {}) {
  const cat = F.catalog();
  const r05 = cat.r05.filter((r) => r.barcode && r.colE).map((r) => [r.barcode, r.colE, r.unitName, r.unitMultiplier, r.unitPrice]);
  const docs = { global_r05: { data_json: JSON.stringify(r05), format: 'r05a1' } };
  for (const b of BRANCHES) {
    docs[`${b}_r01`] = { data_json: JSON.stringify(cat.r01), r01Version: R01_VERSION(b), r01UploadedAt: '__TODAY__', r16Loaded: false, r16DetailVersion: '' };
    docs[`${b}_pm`] = { data_json: JSON.stringify(cat.pm) };
    docs[b] = { session_data_json: JSON.stringify({ countResetAt: EPOCH, scanData: {} }) };
  }
  for (const [k, v] of Object.entries(over)) { if (v === null) delete docs[k]; else docs[k] = { ...(docs[k] || {}), ...v }; }
  return docs;
}

const allCsv = () => F.csvText(BRANCHES.flatMap((b) => csvRows(b)));

// รัน main() จริงของบอทกับ Firestore จำลอง
// opts: {args, csv, ageSeconds, mtimeShiftDays, runs, failPatch[regex ของ doc id ที่ PATCH แล้วให้ล้ม], racing{สาขา: r01Version ใหม่ที่โผล่หลังเขียน meta}, docs}
const HARNESS = `
import os, io, re, json, tempfile, time, contextlib
from datetime import datetime, timedelta

os.environ['AUTO_R16_NOTIFY'] = '0'   # เทสห้ามยิง Telegram จริง (เครื่องพัฒนาอาจมี .env) — ดูเทสแจ้งเตือนที่ auto-r16-notify.spec.js

def conv(v):
    if v == '__TODAY__': return m.S(m.thai_ts(datetime.now(m.BKK)))
    if v == '__YESTERDAY__': return m.S(m.thai_ts(datetime.now(m.BKK) - timedelta(days=1)))
    if isinstance(v, bool): return m.B(v)
    if isinstance(v, int): return m.I(v)
    return m.S(v)

def plain(fields):
    out = {}
    for k, v in fields.items():
        t, x = next(iter(v.items()))
        out[k] = (int(x) if t == 'integerValue' else x)
    return out

store = {d: {k: conv(v) for k, v in f.items()} for d, f in p['docs'].items()}
calls = []

def fake_get(doc_id, fields=None):
    calls.append(['get', doc_id])
    d = store.get(doc_id)
    if d is None: return None
    return {k: d[k] for k in fields if k in d} if fields else dict(d)

def fake_patch(doc_id, typed_fields, mask_fields):
    for pat in p.get('failPatch', []):
        if re.search(pat, doc_id): raise RuntimeError('boom ' + doc_id)
    calls.append(['patch', doc_id, list(mask_fields)])
    store.setdefault(doc_id, {}).update({k: typed_fields[k] for k in mask_fields})
    for branch, newv in (p.get('racing') or {}).items():
        if doc_id == branch + '_r16_104_meta': store[branch + '_r01']['r01Version'] = m.S(newv)

def fake_delete(doc_id):
    calls.append(['delete', doc_id]); store.pop(doc_id, None)

m.get_doc, m.patch_doc, m.delete_doc = fake_get, fake_patch, fake_delete
folder = tempfile.mkdtemp(prefix='r16flow')
path = os.path.join(folder, 'R16104.CSV')
open(path, 'wb').write(('\\ufeff' + p['csv']).encode('utf-8'))
t = time.time() - p.get('ageSeconds', 300) - p.get('mtimeShiftDays', 0) * 86400
os.utime(path, (t, t))

runs = []
for _ in range(p.get('runs', 1)):
    del calls[:]
    buf = io.StringIO(); code = 0
    with contextlib.redirect_stdout(buf):
        try: m.main(['--folder', folder] + p.get('args', []))
        except SystemExit as e: code = e.code if isinstance(e.code, int) else 0
    runs.append({'code': code, 'log': buf.getvalue(), 'calls': [list(c) for c in calls]})
print(json.dumps({'runs': runs, 'store': {d: plain(f) for d, f in store.items()}}, ensure_ascii=False))
`;

function run(opts = {}) {
  return runPython(HARNESS, { docs: baseDocs(), csv: allCsv(), ...opts });
}

module.exports = { BRANCHES, EPOCH, R01_VERSION, todayBkk, csvRows, baseDocs, allCsv, HARNESS, run };
