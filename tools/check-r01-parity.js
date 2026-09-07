#!/usr/bin/env node
/**
 * check-r01-parity.js — พิสูจน์ว่า "อัป R01 ผ่านหน้าเว็บ" กับ "บอท auto-r01" ให้ผลเหมือนกันทุกไบต์
 *
 * ทำไมต้องมี: กติกา parse R01 ถูกเขียนไว้ 2 ภาษา (JS ใน index.html · Python ใน auto_r01_import.py)
 * ถ้าหลุดจากกันเมื่อไร ยอด systemQty ของสาขาจะต่างกันขึ้นกับว่าใครอัป — หายากมากเพราะไม่มีอาการ
 * เอกสารเคยบรรยายวิธีตรวจไว้แต่ไม่มีสคริปต์ จึงไม่มีใครรันจริงตั้งแต่ ส.ค. 2026
 *
 * READ-ONLY: อ่าน index.html + auto_r01_import.py + ไฟล์ CSV · ไม่แก้ไฟล์ ไม่ต่อเน็ต ไม่แตะ Firestore
 *
 * ใช้:  node tools/check-r01-parity.js "<path ไป Allstock.CSV>"
 * exit 0 = ตรงกัน · exit 1 = ต่างกัน (พิมพ์แถวแรกที่ต่างให้ดู)
 *
 * ⚠️ ห้าม re-implement ตรรกะ parse ในไฟล์นี้เด็ดขาด — ต้องดึงโค้ดจริงจาก index.html มารัน
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
if (!csvPath) { console.error('ใช้: node tools/check-r01-parity.js "<path ไป Allstock.CSV>"'); process.exit(2); }
if (!fs.existsSync(csvPath)) { console.error(`ไม่พบไฟล์: ${csvPath}`); process.exit(2); }

// ── ดึงโค้ดจริงจาก index.html ───────────────────────────────────────────────
const html = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');
function grab(re, label) {
  const m = html.match(re);
  if (!m) { console.error(`❌ ดึงโค้ดจาก index.html ไม่เจอ: ${label}\n   โครงโค้ดอาจเปลี่ยน — แก้ regex ในไฟล์นี้ก่อน`); process.exit(2); }
  return m[0];
}
const src = [
  grab(/const R01_NON_COUNT_PREFIXES=\[[^\]]*\];/, 'R01_NON_COUNT_PREFIXES'),
  grab(/const R01_NON_COUNT_KEYWORDS=\[[^\]]*\];/, 'R01_NON_COUNT_KEYWORDS'),
  grab(/function _isNonCountR01Category\(colP\)\{[\s\S]*?\n\}/, '_isNonCountR01Category'),
].join('\n');
const parseLoop = grab(
  /for\(let i=1;i<rows\.length;i\+\+\)\{const r=rows\[i\];[^\n]*state\.r01Data\.push\([^\n]*\}/,
  'ลูป parse ใน loadR01',
);
// state/sk/nc เป็นตัวแปรที่ลูปต้องใช้ — จำลองให้ครบเหมือนใน loadR01
const runLoop = new Function('rows', `${src}\nconst state={r01Data:[]};let sk=0,nc=0;\n${parseLoop}\nreturn state.r01Data;`);

// ── อ่าน CSV ด้วย config เดียวกับ parseFile() ใน index.html ─────────────────
function decode(buf) {
  if (buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) return buf.slice(3).toString('utf8');
  const utf8 = buf.toString('utf8');
  return utf8.includes('�') ? new TextDecoder('windows-874').decode(buf) : utf8;
}
const allRows = Papa.parse(decode(fs.readFileSync(csvPath)),
  { header: false, skipEmptyLines: true, delimiter: ',', quoteChar: '"' }).data;

// ── แยก branch ด้วยกติกาเดียวกับ BRANCH_MAP + norm() ใน auto_r01_import.py ──
const BRANCH_MAP = { 'warehouse': 'WH', 'front store': 'SRC', 'main kkl': 'KKL', 'main sss': 'SSS' };
const norm = (s) => String(s ?? '').trim().toLowerCase().split(/\s+/).join(' ');
const perBranch = {};
for (const r of allRows.slice(1)) {
  const b = BRANCH_MAP[norm(r[3])];   // COL_BRANCH = 3
  if (b) (perBranch[b] ||= []).push(r);
}
// ลูปจริงเริ่มที่ i=1 (ข้าม header) → ใส่แถวหลอกไว้หัวลิสต์ให้มันข้าม
const jsOut = {};
for (const [b, rows] of Object.entries(perBranch)) jsOut[b] = runLoop([['(header)'], ...rows]);

// ── ฝั่ง Python: โหลด auto_r01_import.py เป็น module แล้ว dump parse_file() ──
// ไม่แตะสคริปต์ production (มันรันจริงทุกเช้า) — เรียกจากนอกด้วย -c เท่านั้น
const tmp = path.join(os.tmpdir(), `r01-parity-${process.pid}.json`);
const pyCode = `
import json, importlib.util, sys
spec = importlib.util.spec_from_file_location('m', r'''${path.join(REPO, 'auto-r01', 'auto_r01_import.py')}''')
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
branches, _ = m.parse_file(r'''${csvPath}''')
open(r'''${tmp}''', 'w', encoding='utf-8').write(json.dumps(branches, ensure_ascii=False))
`;
try {
  execFileSync('python', ['-c', pyCode], { stdio: ['ignore', 'ignore', 'pipe'] });
} catch (e) {
  console.error('❌ รัน auto_r01_import.py ไม่สำเร็จ:\n' + String(e.stderr || e.message));
  process.exit(2);
}
const py = JSON.parse(fs.readFileSync(tmp, 'utf8'));
fs.unlinkSync(tmp);

// ── เทียบ ──────────────────────────────────────────────────────────────────
console.log(`ไฟล์: ${csvPath}\n`);
console.log('branch   index.html   auto_r01.py   ผล');
let ok = true;
for (const b of ['KKL', 'SRC', 'SSS', 'WH']) {
  const A = jsOut[b] || [], B = py[b] || [];
  const same = JSON.stringify(A) === JSON.stringify(B);
  if (!same) ok = false;
  console.log(`${b.padEnd(8)} ${String(A.length).padStart(6)}       ${String(B.length).padStart(6)}       ${same ? '✅ ตรงกันทุกไบต์' : '❌ ต่างกัน'}`);
  if (!same) {
    for (let i = 0; i < Math.max(A.length, B.length); i++) {
      if (JSON.stringify(A[i]) !== JSON.stringify(B[i])) {
        console.log(`   แถวแรกที่ต่าง #${i}\n     index.html : ${JSON.stringify(A[i])}\n     auto_r01.py: ${JSON.stringify(B[i])}`);
        break;
      }
    }
  }
}
console.log(ok
  ? '\n✅ PARITY ผ่าน — อัปผ่านเว็บกับให้บอทอัป ได้ผลเหมือนกันทุกไบต์'
  : '\n❌ PARITY ไม่ผ่าน — แก้ให้ตรงกันก่อนปล่อยบอทรัน (ดู auto-r01/TODO-safe-enable.md §Parity)');
process.exit(ok ? 0 : 1);
