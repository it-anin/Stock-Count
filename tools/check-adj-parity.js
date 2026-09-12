#!/usr/bin/env node
/**
 * check-adj-parity.js — พิสูจน์ว่า "แนบไฟล์เองในป็อปอัพปรับปรุงสินค้า" กับ "บอท auto-adj" อ่านไฟล์ได้ผลเดียวกัน
 *
 * ทำไมต้องมี: ตรรกะ parse R14.102 (LOT/EXP) และ R05.105 (ราคา Level 4) ถูกเขียนไว้ 2 ภาษา
 *   index.html               : _parseAdjLotRows() · _parseAdjPriceRows()
 *   auto-adj/auto_adj_import.py : parse_lot_rows() · parse_price_rows()
 * ป็อปอัพใช้ข้อมูลจาก Supabase (ที่บอทอัป) เป็นหลัก แต่ยังรับไฟล์ที่แนบเองเป็นทางสำรอง
 * ถ้าสองฝั่งหลุดจากกัน ใบ ORDS/IRPS จะได้ LOT/ราคาต่างกันขึ้นกับว่าข้อมูลมาทางไหน — และไม่มีอาการให้เห็น
 *
 * เทียบ: ชุด SKU · LOT และลำดับใน dropdown ของแต่ละ SKU · EXP · หน่วย · ราคา (เทียบค่าตัวเลข)
 *
 * READ-ONLY: อ่าน index.html + auto_adj_import.py + ไฟล์ CSV · ไม่แก้ไฟล์ ไม่ต่อเน็ต ไม่แตะ Supabase/Firestore
 *
 * ใช้:  node tools/check-adj-parity.js "<R14.102.CSV>" "<R05.105.CSV>"
 *       ใส่ - แทนไฟล์ที่ไม่มี เช่น  node tools/check-adj-parity.js - "<R05.105.CSV>"
 * exit 0 = ตรงกัน · exit 1 = ต่างกัน (พิมพ์ SKU แรกที่ต่างให้ดู) · exit 2 = ใช้งานผิด/ดึงโค้ดไม่เจอ
 *
 * ⚠️ ห้าม re-implement ตรรกะ parse ในไฟล์นี้ — ต้องดึงโค้ดจริงจาก index.html มารัน
 * ⛔ ห้ามเขียน CSV parser เอง — ใช้ libs/papaparse.min.js ตัวเดียวกับหน้าเว็บ (บทเรียนจาก check-r05-parity.js)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const REPO = path.resolve(__dirname, '..');
const Papa = require(path.join(REPO, 'libs', 'papaparse.min.js'));

const [r14Path, r05Path] = process.argv.slice(2);
const want = (p) => p && p !== '-';
if (!want(r14Path) && !want(r05Path)) {
  console.error('ใช้: node tools/check-adj-parity.js "<R14.102.CSV>" "<R05.105.CSV>"   (ใส่ - แทนไฟล์ที่ไม่มี)');
  process.exit(2);
}
for (const p of [r14Path, r05Path]) if (want(p) && !fs.existsSync(p)) { console.error(`ไม่พบไฟล์: ${p}`); process.exit(2); }

// ── ดึงโค้ดจริงจาก index.html ───────────────────────────────────────────────
const html = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');
function grab(re, label) {
  const m = html.match(re);
  if (!m) { console.error(`❌ ดึงโค้ดจาก index.html ไม่เจอ: ${label}\n   โครงโค้ดอาจเปลี่ยน — แก้ regex ในไฟล์นี้ก่อน`); process.exit(2); }
  return m[0];
}
const web = new Function(`${grab(/function _parseAdjLotRows\(rows,need\)\{[\s\S]*?\n\}/, '_parseAdjLotRows')}
${grab(/function _parseAdjPriceRows\(rows,need\)\{[\s\S]*?\n\}/, '_parseAdjPriceRows')}
return {_parseAdjLotRows, _parseAdjPriceRows};`)();

// ── อ่าน CSV ด้วย config เดียวกับ parseFile() ใน index.html ─────────────────
function decode(buf) {
  if (buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) return new TextDecoder('utf-8').decode(buf.slice(3));
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch (e) { return new TextDecoder('windows-874').decode(buf); }
}
const readRows = (p) => Papa.parse(decode(fs.readFileSync(p)),
  { header: false, skipEmptyLines: true, delimiter: ',', quoteChar: '"' }).data;

// need = ทุก SKU ที่มีในแถวข้อมูล (ข้ามแถวหัวแบบเดียวกับบอท) → เว็บเก็บทุก SKU เหมือนบอท
// ใช้ค่าจากฝั่งเว็บเอง ไม่ใช่จากผลของ Python — ถ้า Python ตกหล่น SKU ไหนจะถูกจับได้
const needFrom = (rows, colIdx) => new Set(rows.slice(1).map((r) => (r && r[colIdx] != null ? r[colIdx] : '').toString().trim()).filter(Boolean));

// ── ฝั่ง Python: โหลด auto_adj_import.py เป็น module แล้ว dump ผลออกมา ─────
// ไม่แตะสคริปต์ production — เรียกจากนอกด้วย -c เท่านั้น
function runPython(fn, csvPath) {
  const tmp = path.join(os.tmpdir(), `adj-parity-${process.pid}-${fn}.json`);
  const pyCode = `
import json, importlib.util
spec = importlib.util.spec_from_file_location('m', r'''${path.join(REPO, 'auto-adj', 'auto_adj_import.py')}''')
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
rows = m.read_rows(r'''${csvPath}''')
open(r'''${tmp}''', 'w', encoding='utf-8').write(json.dumps(m.${fn}(rows), ensure_ascii=False))
`;
  try {
    execFileSync('python', ['-c', pyCode], { stdio: ['ignore', 'ignore', 'pipe'] });
  } catch (e) {
    console.error('❌ รัน auto_adj_import.py ไม่สำเร็จ:\n' + String(e.stderr || e.message));
    process.exit(2);
  }
  const out = JSON.parse(fs.readFileSync(tmp, 'utf8'));
  fs.unlinkSync(tmp);
  return out;
}

// เทียบสองก้อน {sku: value} — คืน SKU แรกที่ต่าง (เรียงคีย์ ค่าตัวเลขผ่าน JSON.parse แล้วจึงเทียบค่า ไม่ใช่รูปสตริง)
function firstDiff(a, b) {
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
  for (const k of keys) {
    const x = JSON.stringify(a[k]), y = JSON.stringify(b[k]);
    if (x !== y) return { sku: k, web: x, py: y };
  }
  return null;
}
const line = (label, a, b) => console.log(`${label.padEnd(26)} ${String(a).padStart(10)}   ${String(b).padStart(10)}   ${a === b ? '✅' : '❌'}`);

let ok = true;

if (want(r14Path)) {
  const rows = readRows(r14Path);
  const { map, matched } = web._parseAdjLotRows(rows, needFrom(rows, 9));
  const webObj = Object.fromEntries([...map].map(([k, v]) => [k, v]));
  const py = runPython('parse_lot_rows', r14Path);
  const pyObj = {};
  [...py].sort((x, y) => x.seq - y.seq).forEach((r) => { (pyObj[r.sku] = pyObj[r.sku] || []).push({ lot: r.lot, exp: r.exp }); });
  console.log(`\nR14.102: ${r14Path}`);
  console.log('                            index.html   auto_adj.py');
  line('คู่ SKU+LOT', matched, py.length);
  line('SKU', Object.keys(webObj).length, Object.keys(pyObj).length);
  const d = firstDiff(webObj, pyObj);
  if (d) { ok = false; console.log(`\n   SKU แรกที่ต่าง: ${d.sku}\n     index.html : ${d.web}\n     auto_adj.py: ${d.py}`); }
  else if (matched !== py.length) ok = false;
}

if (want(r05Path)) {
  const rows = readRows(r05Path);
  const { map, matched } = web._parseAdjPriceRows(rows, needFrom(rows, 1));
  const webObj = Object.fromEntries([...map].map(([k, v]) => [k, { unit: v.unit, price: v.price }]));
  const py = runPython('parse_price_rows', r05Path);
  const pyObj = Object.fromEntries(py.map((r) => [r.sku, { unit: r.unit, price: r.price }]));
  const priced = (o) => Object.values(o).filter((v) => v.price != null).length;
  console.log(`\nR05.105: ${r05Path}`);
  console.log('                            index.html   auto_adj.py');
  line('SKU ที่มีแถว Level 4', matched, py.length);
  line('SKU ที่มีราคา', priced(webObj), priced(pyObj));
  const d = firstDiff(webObj, pyObj);
  if (d) { ok = false; console.log(`\n   SKU แรกที่ต่าง: ${d.sku}\n     index.html : ${d.web}\n     auto_adj.py: ${d.py}`); }
  else if (matched !== py.length) ok = false;
}

console.log(ok
  ? '\n✅ PARITY ผ่าน — แนบไฟล์เองกับให้บอทอัป ได้ LOT/ราคาเหมือนกัน'
  : '\n❌ PARITY ไม่ผ่าน — แก้ index.html กับ auto_adj_import.py ให้ตรงกันก่อนปล่อยบอทรัน');
process.exit(ok ? 0 : 1);
