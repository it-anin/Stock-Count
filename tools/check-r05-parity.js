#!/usr/bin/env node
/**
 * check-r05-parity.js — พิสูจน์ว่า "อัป R05.106 ผ่านหน้าเว็บ" กับ "บอท auto-r05" ให้ผลเหมือนกันทุกไบต์
 *
 * ทำไมต้องมี: ตรรกะ parse + serialize R05 ถูกเขียนไว้ 2 ภาษา
 * (JS ใน index.html · Python ใน auto-r05/auto_r05_import.py) ถ้าหลุดจากกันเมื่อไร
 * ตารางบาร์โค้ดของทุกสาขาจะต่างกันขึ้นกับว่าใครอัป — และไม่มีอาการให้เห็นจนกว่าจะมีคนยิงไม่ติด
 *
 * เทียบถึงระดับ "สตริง JSON ที่จะถูกเขียนลง Firestore" ไม่ใช่แค่โครงข้อมูล เพราะ echo guard
 * ของ listener (_lastAppliedR05Json) กับ guard "เนื้อหาเหมือนเดิมจึงไม่เขียน" ของบอท
 * ต่างก็เทียบสตริงตรง ๆ ต่างกันแม้ช่องว่างเดียวก็ทำให้บอทเขียนซ้ำทุกวันโดยเปล่าประโยชน์
 *
 * READ-ONLY: อ่าน index.html + auto_r05_import.py + ไฟล์ CSV · ไม่แก้ไฟล์ ไม่ต่อเน็ต ไม่แตะ Firestore
 *
 * ใช้:  node tools/check-r05-parity.js "<path ไป R05.106.CSV>"
 * exit 0 = ตรงกัน · exit 1 = ต่างกัน (พิมพ์แถวแรกที่ต่างให้ดู)
 *
 * ⚠️ ห้าม re-implement ตรรกะ parse/serialize ในไฟล์นี้เด็ดขาด — ต้องดึงโค้ดจริงจาก index.html มารัน
 *    ไม่งั้นเทสจะผ่านทั้งที่ของจริงหลุดจากกันไปแล้ว
 * ⛔ ห้ามเขียน CSV parser เอง — ต้องใช้ libs/papaparse.min.js ตัวเดียวกับที่หน้าเว็บโหลด
 *    (เคยเขียนเองแล้วนับพลาด 371 แถว เพราะชื่อสินค้ามีเครื่องหมายนิ้ว เช่น `Gauze 2" x 2"`)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const os = require('os');

const REPO = path.resolve(__dirname, '..');
const Papa = require(path.join(REPO, 'libs', 'papaparse.min.js'));

const csvPath = process.argv[2];
if (!csvPath) { console.error('ใช้: node tools/check-r05-parity.js "<path ไป R05.106.CSV>"'); process.exit(2); }
if (!fs.existsSync(csvPath)) { console.error(`ไม่พบไฟล์: ${csvPath}`); process.exit(2); }

// ── ดึงโค้ดจริงจาก index.html ───────────────────────────────────────────────
const html = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');
function grab(re, label) {
  const m = html.match(re);
  if (!m) { console.error(`❌ ดึงโค้ดจาก index.html ไม่เจอ: ${label}\n   โครงโค้ดอาจเปลี่ยน — แก้ regex ในไฟล์นี้ก่อน`); process.exit(2); }
  return m[0];
}
const src = [
  grab(/function _parseProductMasterPrice\(value\)\{[\s\S]*?\n\}/, '_parseProductMasterPrice'),
  grab(/const R05_CLOUD_FORMAT='[^']*';/, 'R05_CLOUD_FORMAT'),
  grab(/function _serializeR05\(rows\)\{[\s\S]*?\n\}/, '_serializeR05'),
].join('\n');
// ลูป parse ของ loadR05 อยู่บรรทัดเดียว — anchor ที่ state.r05Data.push เพื่อไม่ให้ไปจับลูปของ loadR01
const parseLoop = grab(
  /for\(let i=1;i<rows\.length;i\+\+\)\{const r=rows\[i\];[^\n]*state\.r05Data\.push\([^\n]*\}/,
  'ลูป parse ใน loadR05',
);
// state/sk/priced เป็นตัวแปรที่ลูปต้องใช้ — จำลองให้ครบเหมือนใน loadR05
const runLoop = new Function('rows', `${src}
const state={r05Data:[]};let sk=0,priced=0;
${parseLoop}
return {json:_serializeR05(state.r05Data),rows:state.r05Data,n:state.r05Data.length,sk,priced,format:R05_CLOUD_FORMAT};`);

// ── อ่าน CSV ด้วย config เดียวกับ parseFile() ใน index.html ─────────────────
function decode(buf) {
  if (buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) return buf.slice(3).toString('utf8');
  const utf8 = buf.toString('utf8');
  return utf8.includes('�') ? new TextDecoder('windows-874').decode(buf) : utf8;
}
const allRows = Papa.parse(decode(fs.readFileSync(csvPath)),
  { header: false, skipEmptyLines: true, delimiter: ',', quoteChar: '"' }).data;
const js = runLoop(allRows);

// ── ฝั่ง Python: โหลด auto_r05_import.py เป็น module แล้ว dump ผลออกมา ──────
// ไม่แตะสคริปต์ production (มันรันจริงทุกเช้า) — เรียกจากนอกด้วย -c เท่านั้น
const tmp = path.join(os.tmpdir(), `r05-parity-${process.pid}.json`);
const pyCode = `
import json, importlib.util
spec = importlib.util.spec_from_file_location('m', r'''${path.join(REPO, 'auto-r05', 'auto_r05_import.py')}''')
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
rows, stats = m.parse_file(r'''${csvPath}''')
open(r'''${tmp}''', 'w', encoding='utf-8').write(json.dumps({
    'json': m.serialize_r05(rows),
    'n': len(rows),
    'sk': stats['skipped'],
    'priced': stats['priced'],
    'format': m.R05_CLOUD_FORMAT,
}, ensure_ascii=False))
`;
try {
  execFileSync('python', ['-c', pyCode], { stdio: ['ignore', 'ignore', 'pipe'] });
} catch (e) {
  console.error('❌ รัน auto_r05_import.py ไม่สำเร็จ:\n' + String(e.stderr || e.message));
  process.exit(2);
}
const py = JSON.parse(fs.readFileSync(tmp, 'utf8'));
fs.unlinkSync(tmp);

// ── เทียบ ──────────────────────────────────────────────────────────────────
const bytes = (s) => Buffer.byteLength(s, 'utf8');
console.log(`ไฟล์: ${csvPath}\n`);
console.log('                     index.html      auto_r05.py');
const line = (label, a, b) => console.log(`${label.padEnd(20)} ${String(a).padStart(12)}   ${String(b).padStart(12)}   ${a === b ? '✅' : '❌'}`);
line('บาร์โค้ดที่อ่านได้', js.n, py.n);
line('ข้าม (ไม่มี SKU)', js.sk, py.sk);
line('แถวที่มีราคา', js.priced, py.priced);
line('ขนาด JSON (ไบต์)', bytes(js.json), bytes(py.json));
line('ค่า format', js.format, py.format);

const same = js.json === py.json;
if (!same) {
  // ต่างที่ไหน: เทียบทีละแถวเพื่อชี้จุดให้แคบที่สุด
  let A = [], B = [];
  try { A = JSON.parse(js.json); B = JSON.parse(py.json); } catch (e) { /* ปล่อยให้ตกไปเทียบสตริงล้วน */ }
  let shown = false;
  for (let i = 0; i < Math.max(A.length, B.length); i++) {
    if (JSON.stringify(A[i]) !== JSON.stringify(B[i])) {
      console.log(`\n   แถวแรกที่ต่าง #${i}\n     index.html : ${JSON.stringify(A[i])}\n     auto_r05.py: ${JSON.stringify(B[i])}`);
      shown = true;
      break;
    }
  }
  if (!shown) {
    // โครงข้อมูลเหมือนกันแต่สตริงต่าง = ปัญหาการจัดรูปแบบ JSON (ช่องว่าง / .0 ต่อท้าย)
    const n = Math.min(js.json.length, py.json.length);
    let i = 0; while (i < n && js.json[i] === py.json[i]) i++;
    console.log(`\n   โครงข้อมูลเหมือนกันแต่สตริงต่างที่ตัวอักษรที่ ${i} — ปัญหาการจัดรูปแบบ JSON`);
    console.log(`     index.html : ...${js.json.slice(Math.max(0, i - 30), i + 30)}...`);
    console.log(`     auto_r05.py: ...${py.json.slice(Math.max(0, i - 30), i + 30)}...`);
    console.log('     เช็ค separators=(",",":") และการแปลงเลขลงตัวเป็นจำนวนเต็มใน serialize_r05()');
  }
}

console.log(same
  ? '\n✅ PARITY ผ่าน — อัปผ่านเว็บกับให้บอทอัป ได้ผลเหมือนกันทุกไบต์'
  : '\n❌ PARITY ไม่ผ่าน — แก้ให้ตรงกันก่อนปล่อยบอทรัน');
process.exit(same ? 0 : 1);
