// ตัวช่วยเทสของ PromaxxHelper (promaxx-helper/) — เรียก Python ผ่าน findPython ของ tests/lib/python.js
//
//   runPy(body, payload)   รันโค้ด Python (m = promaxx_helper · fk = tests/lib/fake_ssmaxx.py · p = payload) แล้วอ่าน JSON ที่ print กลับมา
//   startServer(opts)      เปิดเซิร์ฟเวอร์จริง (tests/lib/serve_fake.py) พอร์ตสุ่ม → { port, origin, request(), stop() }
//   cli(args, env)         รัน `python promaxx_helper.py <args>` จริง (ดู exit code / ข้อความ) — ไม่ผ่าน adapter
//
// PROMAXX_HELPER_DIR = ชี้ไปโฟลเดอร์สำเนาที่ใส่บั๊กจงใจ (mutation testing — ธรรมเนียม repo: ต้องมี canary ว่าเทสจับบั๊กได้จริง) · ปกติไม่ตั้ง
//   สำเนาต้องมีทั้ง promaxx_helper.py และ promaxx_win.py
// ⚠️ ต้องมี Python 3: ไม่เจอให้โยน error ชัดๆ (ห้าม skip เงียบ) — findPython ทำให้แล้ว
const { execFileSync, spawn, spawnSync } = require('child_process');
const http = require('http');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { findPython } = require('./python');

const HELPER_DIR = process.env.PROMAXX_HELPER_DIR || path.resolve(__dirname, '..', '..', 'promaxx-helper');
const LIB_DIR = __dirname;
const PROD = 'https://anin-stock-count.vercel.app';

// ห้ามใช้ spec_from_file_location โดยไม่ลงทะเบียน sys.modules (dataclass พัง) — ใช้ sys.path + import ธรรมดา
const PRELUDE = `
import sys, json, os, tempfile
p = json.load(sys.stdin)
sys.path.insert(0, p['helper_dir']); sys.path.insert(0, p['lib_dir'])
import promaxx_helper as m
import fake_ssmaxx as fk
tmp = p.get('tmp') or tempfile.mkdtemp(prefix='pmx-')
`;

function mkTmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'pmx-')); }

function runPy(body, payload = {}) {
  const out = execFileSync(findPython(), ['-I', '-B', '-X', 'utf8', '-c', PRELUDE + body], {
    input: JSON.stringify({ helper_dir: HELPER_DIR, lib_dir: LIB_DIR, tmp: mkTmp(), ...payload }),
    encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  return JSON.parse(out.trim().split('\n').pop());
}

function cli(args, env = {}) {
  const r = spawnSync(findPython(), ['-I', '-B', '-X', 'utf8', path.join(HELPER_DIR, 'promaxx_helper.py'), ...args], {
    encoding: 'utf8', env: { ...process.env, ...env }, timeout: 30000,
  });
  return { status: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

// ยิง HTTP จริง · headers ใส่ Host เองได้ (ทดสอบ DNS rebinding) · body เป็น string/Buffer/object
function request(port, { method = 'GET', path: p = '/v1/health', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : (typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
    const h = { ...headers };
    if (data !== null && h['Content-Length'] === undefined) h['Content-Length'] = Buffer.byteLength(data);
    const req = http.request({ host: '127.0.0.1', port, method, path: p, headers: h, agent: false }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null; try { json = JSON.parse(text); } catch (e) { /* 204 ไม่มี body */ }
        resolve({ status: res.statusCode, headers: res.headers, text, json });
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => req.destroy(new Error('timeout')));
    if (data !== null) req.write(data);
    req.end();
  });
}

const POST_HEADERS = (origin = PROD) => ({ Origin: origin, 'Content-Type': 'application/json', 'X-Anin-Helper': '1' });

async function startServer(opts = {}) {
  const tmp = mkTmp();
  const child = spawn(findPython(), ['-I', '-B', '-X', 'utf8', path.join(LIB_DIR, 'serve_fake.py'),
    JSON.stringify({ helper_dir: HELPER_DIR, lib_dir: LIB_DIR, tmp, ...opts })], { stdio: ['pipe', 'pipe', 'pipe'] });
  let err = '';
  child.stderr.on('data', (d) => { err += d; });
  const port = await new Promise((resolve, reject) => {
    let buf = '';
    child.stdout.on('data', (d) => {
      buf += d;
      const line = buf.split('\n')[0];
      if (buf.includes('\n')) { try { resolve(JSON.parse(line).port); } catch (e) { reject(new Error('serve_fake: ' + buf + err)); } }
    });
    child.on('exit', (c) => reject(new Error('serve_fake exit ' + c + '\n' + err)));
    setTimeout(() => reject(new Error('serve_fake timeout\n' + err)), 20000);
  });
  return {
    port, tmp, origin: 'http://127.0.0.1:' + port,
    request: (o) => request(port, o),
    post: (body, headers) => request(port, { method: 'POST', path: '/v1/open-import', headers: { ...POST_HEADERS(), ...headers }, body }),
    stop: () => new Promise((resolve) => { child.once('exit', () => resolve()); try { child.stdin.end(); } catch (e) { resolve(); } setTimeout(() => { child.kill(); resolve(); }, 3000); }),
  };
}

module.exports = { runPy, cli, request, startServer, POST_HEADERS, PROD, HELPER_DIR, LIB_DIR, mkTmp };
