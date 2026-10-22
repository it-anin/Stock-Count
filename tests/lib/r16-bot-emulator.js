// รันบอท auto-r16 (Python จริง) กับ Firestore emulator ผ่าน REST จริง (HTTP) — ไม่จำลอง m._request
//
// ต่างจาก r16-confirm-harness.js (Firestore จำลองในหน่วยความจำ ไว้คุมความล้มเหลว): ที่นี่พิสูจน์ว่า "คำขอที่บอทสร้าง" เซิร์ฟเวอร์ Firestore ยอมรับจริง
// (documents:commit + precondition + REQUEST_TIME · runQuery · lock) และอยู่ภายใต้ firestore.rules จริง (บอทไม่ล็อกอิน เหมือนบน BIGYAMAINPC)
// ที่แทนมีแค่: นาฬิกา (m._now_bkk — เพื่อให้เทสรันกี่โมงก็ได้) และชี้ปลายทางไป emulator ด้วย env AUTO_R16_FIRESTORE_BASE / AUTO_R16_PROJECT_ID
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { findPython, runPython, AUTO_R16 } = require('./python');
const { HOST } = require('./emulator');

const PROJECT = 'demo-stock-count';

// วันนี้ตามเวลาไทย (คำนวณตอนรันเทส — ห้ามฮาร์ดโค้ดวันที่: เคยทำให้เทสล้มข้ามเที่ยงคืน)
function bkkDay(date = new Date()) {
  const d = new Date(date.getTime() + 7 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  const y = d.getUTCFullYear(), mo = d.getUTCMonth() + 1, da = d.getUTCDate();
  return { iso: `${y}-${p(mo)}-${p(da)}`, dmy: `${da}/${mo}/${y}`, thai: `07:31 น. ${p(da)}/${p(mo)}/${y}`, time: `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}` };
}

// นาฬิกาของบอท: อย่างน้อย 21:10 ของวันนี้ (ผ่านด่าน "Confirm จริงได้หลัง 21:00") — ถ้าเทสรันหลัง 21:10 ใช้เวลาจริง (lock หมดอายุเทียบกับเวลาจริงของหน้าเว็บได้ถูก)
// และไฟล์ R16 ถูก export 21:05 เสมอ (รายการที่เทส seed ต้องมีเวลาสแกน ≤ 21:05)
function botClock() {
  const real = new Date();
  const day = bkkDay(real);
  const floor = new Date(`${day.iso}T21:10:00+07:00`);
  const at = real > floor ? real : floor;
  const d = bkkDay(at);
  return { now: `${d.iso}T${d.time}+07:00`, mtime: `${day.iso}T21:05:00+07:00`, day };
}

// code เดียวกับ python.js (PRELUDE ไม่ถูก export) — โหลดบอทเป็นตัวแปร m
const PRELUDE = `
import sys, json, importlib.util
p = json.load(sys.stdin)
spec = importlib.util.spec_from_file_location('auto_r16_import', p['module'])
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
`;

// main() จริงของบอท ตั้งค่า env ให้ชี้ emulator · เขียน CSV เป็นไฟล์จริง (เวลาแก้ไข = mtime ที่กำหนด)
const BODY = `
import os, io, json, tempfile, contextlib
from datetime import datetime
os.environ['AUTO_R16_FIRESTORE_BASE'] = p['base']
os.environ['AUTO_R16_PROJECT_ID'] = p['project']
os.environ['AUTO_R16_STATE_DIR'] = p['stateDir']
m._now_bkk = lambda: datetime.fromisoformat(p['now'])
for k, v in (p.get('consts') or {}).items(): setattr(m, k, v)
folder = tempfile.mkdtemp(prefix='r16e2e')
csv_path = os.path.join(folder, 'R16104.CSV')
open(csv_path, 'wb').write(('\\ufeff' + p['csv']).encode('utf-8'))
t = datetime.fromisoformat(p['mtime']).timestamp(); os.utime(csv_path, (t, t))
buf = io.StringIO(); code = 0
with contextlib.redirect_stdout(buf):
    try: m.main(['--folder', folder] + p['args'])
    except SystemExit as e: code = e.code if isinstance(e.code, int) else 0
print(json.dumps({'code': code, 'log': buf.getvalue()}, ensure_ascii=False))
`;

function newStateDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'r16e2e-state-')); }

function payload(opts) {
  const clock = botClock();
  return {
    module: AUTO_R16, base: `http://${HOST}`, project: PROJECT, stateDir: opts.stateDir, now: opts.now || clock.now, mtime: opts.mtime || clock.mtime,
    csv: opts.csv, args: opts.args || [], consts: opts.consts || {},
  };
}

// รันแบบบล็อก (ใช้เมื่อไม่ต้องทำอะไรพร้อมกัน)
function runBotSync(opts) {
  return runPython(BODY, payload(opts));
}

// รันแบบไม่บล็อก — ให้เทสทำอย่างอื่นพร้อมกันได้ (เช่น ดู PDA ตอนบอทถือ lock) · คืน {promise}
function runBotAsync(opts) {
  const child = spawn(findPython(), ['-I', '-B', '-X', 'utf8', '-c', PRELUDE + BODY], { stdio: ['pipe', 'pipe', 'pipe'] });
  let out = '', err = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { err += d; });
  const promise = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`bot python exit ${code}\n${err}`));
      try { resolve(JSON.parse(out)); } catch (e) { reject(new Error(`bot output ไม่ใช่ JSON: ${out}\n${err}`)); }
    });
  });
  child.stdin.end(JSON.stringify(payload(opts)));
  return { promise };
}

const journalFiles = (stateDir) => {
  const d = path.join(stateDir, 'confirm_journal');
  return fs.existsSync(d) ? fs.readdirSync(d).sort().map((f) => path.join(d, f)) : [];
};
const readJournal = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const readShadow = (stateDir) => {
  const f = path.join(stateDir, 'auto_r16_confirm_shadow.jsonl');
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
};

module.exports = { PROJECT, bkkDay, botClock, newStateDir, runBotSync, runBotAsync, journalFiles, readJournal, readShadow };
