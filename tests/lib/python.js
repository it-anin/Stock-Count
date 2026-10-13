// เรียก Python 3 จากเทส — ใช้กับบอท auto-r16 (เขียนด้วย Python) ที่ต้องได้ผล "เดียวกันทุกไบต์" กับ loadR16() ฝั่ง JS
//
// ⚠️ Python ต้องมี: ถ้าไม่เจอให้โยน error ชัดๆ ห้าม skip เงียบ — เทส parity ที่ถูกข้ามเงียบ = ปล่อยให้สองภาษาหลุดจากกันโดยไม่มีใครรู้
//    (ตั้ง PYTHON=<path> ถ้าไม่ได้อยู่ใน PATH)
// -I = isolated (ไม่อ่าน env/cwd/site) · -B = ไม่เขียน __pycache__ ลงโฟลเดอร์ auto-r16 · -X utf8 = stdin/stdout เป็น UTF-8 บน Windows
const { spawnSync, execFileSync } = require('child_process');
const path = require('path');

// AUTO_R16_MODULE = ชี้ไปสำเนาที่ใส่บั๊กจงใจ (mutation testing — ธรรมเนียม repo: ต้องมี canary ว่าเทสจับบั๊กได้จริง) · ปกติไม่ตั้ง
const AUTO_R16 = process.env.AUTO_R16_MODULE || path.resolve(__dirname, '..', '..', 'auto-r16', 'auto_r16_import.py');

let cached = null;
function findPython() {
  if (cached) return cached;
  const candidates = [process.env.PYTHON, 'python', 'python3', 'py'].filter(Boolean);
  for (const c of candidates) {
    const r = spawnSync(c, ['-X', 'utf8', '--version'], { encoding: 'utf8' });
    if (r.status === 0 && /^Python 3\./.test(String(r.stdout || r.stderr || '').trim())) { cached = c; return c; }
  }
  throw new Error('ไม่พบ Python 3 — เทสของบอท auto-r16 ต้องใช้ (ตั้ง PYTHON=<path ไป python.exe> ถ้าไม่ได้อยู่ใน PATH)');
}

// code อ่าน JSON จาก stdin (payload) แล้วพิมพ์ JSON ผลลัพธ์ทาง stdout · payload.module = path ของ auto_r16_import.py
const PRELUDE = `
import sys, json, importlib.util
p = json.load(sys.stdin)
spec = importlib.util.spec_from_file_location('auto_r16_import', p['module'])
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
`;

function runPython(body, payload = {}) {
  const out = execFileSync(findPython(), ['-I', '-B', '-X', 'utf8', '-c', PRELUDE + body], {
    input: JSON.stringify({ module: AUTO_R16, ...payload }),
    encoding: 'utf8',
    maxBuffer: 512 * 1024 * 1024,
  });
  return JSON.parse(out);
}

module.exports = { findPython, runPython, AUTO_R16 };
