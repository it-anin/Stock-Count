#!/usr/bin/env node
/**
 * list-r01-categories.js — ดูหมวดสินค้าจริง (R01 คอลัมน์ P) ในไฟล์ Allstock ว่ามีอะไรบ้าง
 * และหมวดไหนถูกตัดออกจากการนับด้วยกติกาปัจจุบัน
 *
 * ทำไมต้องมี: เคยมีโน้ตในเอกสารเขียนว่าหมวด "อุปกรณ์สำนักงาน / ค่าใช้จ่าย / ขนส่ง"
 * ไม่มีเลข `11.` นำหน้าจึงหลุดการกรอง — พอตรวจไฟล์จริง (7 ก.ย. 2026) พบว่ามีเลขนำหน้าและถูกตัดอยู่แล้ว
 * โน้ตผิดเกือบทำให้แก้โค้ดโดยไม่จำเป็น ⇒ ให้รันตัวนี้ดูของจริงแทนการเชื่อเอกสาร (ดู CLAUDE.md §กฎ 0)
 *
 * READ-ONLY: อ่านไฟล์อย่างเดียว · ไม่เขียนอะไร · ไม่ต่อเน็ต · ไม่แตะ Firestore
 *
 * ใช้:  node tools/list-r01-categories.js "<path ไป Allstock.CSV>"
 *      node tools/list-r01-categories.js "%USERPROFILE%\Desktop\run-upload-stock\Allstock.CSV"
 *
 * ⚠️ กติกาการตัดหมวดถูกทำซ้ำไว้ 3 ที่ ต้องแก้พร้อมกันเสมอ:
 *      index.html                  → R01_NON_COUNT_PREFIXES / R01_NON_COUNT_KEYWORDS
 *      auto-r01/auto_r01_import.py → ค่าเดียวกัน
 *      ไฟล์นี้                      → ค่าเดียวกัน (ใช้แค่แสดงผล ไม่ได้ตัดสินอะไรใน production)
 */
'use strict';
const fs = require('fs');

// ต้องตรงกับ index.html และ auto_r01_import.py เป๊ะ
const R01_NON_COUNT_PREFIXES = ['11.'];
const R01_NON_COUNT_KEYWORDS = ['DELETE'];
const isNonCount = (colP) => {
  const v = (colP ?? '').toString().trim().toUpperCase();
  if (!v) return false;
  return R01_NON_COUNT_PREFIXES.some((p) => v.startsWith(p)) || R01_NON_COUNT_KEYWORDS.some((k) => v.includes(k));
};

// index คอลัมน์ชุดเดียวกับ loadR01() / auto_r01_import.py
const COL_SKU = 4;   // E  CF_ITEMID
const COL_QTY = 6;   // G  CF_QUANTITY
const COL_CAT = 15;  // P  CF_ITEMGROUPL1_GROUPNAME

// ไฟล์จาก POS ออกมาได้ทั้ง UTF-8 (มี/ไม่มี BOM) และ TIS-620/CP874 — ยึดแนวเดียวกับ parseFile()/decode_bytes()
function decode(buf) {
  if (buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) return buf.slice(3).toString('utf8');
  const utf8 = buf.toString('utf8');
  if (!utf8.includes('�')) return utf8;
  return new TextDecoder('windows-874').decode(buf);
}

// ⛔ ห้ามเขียน CSV parser เอง — รุ่นแรกของไฟล์นี้เขียนเองแล้วนับพลาด 371 แถว
// เพราะชื่อสินค้าจริงมีเครื่องหมายนิ้ว เช่น `Klean Gauze 2" x 2" (10ชิ้น/bx)`
// ใช้ PapaParse ตัวเดียวกับที่ index.html โหลด และ config ต้องตรงกับ parseFile() เป๊ะ
const Papa = require('../libs/papaparse.min.js');
const PAPA_OPTS = { header: false, skipEmptyLines: true, delimiter: ',', quoteChar: '"' };

const file = process.argv[2];
if (!file) { console.error('ใช้: node tools/list-r01-categories.js "<path ไป Allstock.CSV>"'); process.exit(1); }
if (!fs.existsSync(file)) { console.error(`ไม่พบไฟล์: ${file}`); process.exit(1); }

const rows = Papa.parse(decode(fs.readFileSync(file)), PAPA_OPTS).data;

const cats = new Map();
let skipNoSku = 0, skipQty = 0;
for (const r of rows.slice(1)) {   // ข้าม header เหมือน loadR01 ที่เริ่ม i=1
  if (!r || r.length <= COL_QTY) continue;
  const sku = (r[COL_SKU] ?? '').trim();
  if (!sku) { skipNoSku++; continue; }
  const g = (r[COL_QTY] ?? '').replace(/,|\s/g, '').trim();
  if (g === '' || !isFinite(+g)) { skipQty++; continue; }   // parse_qty คืน None เฉพาะค่าว่าง/ไม่ใช่ตัวเลข
  const cat = (r[COL_CAT] ?? '').trim();
  if (!cats.has(cat)) cats.set(cat, { rows: 0, nonZero: 0 });
  const e = cats.get(cat);
  e.rows++;
  if (+g !== 0) e.nonZero++;
}

const list = [...cats.entries()].sort((a, b) => b[1].rows - a[1].rows);
const total = list.reduce((s, [, e]) => s + e.rows, 0);
const cut = list.filter(([c]) => isNonCount(c)).reduce((s, [, e]) => s + e.rows, 0);

console.log(`ไฟล์   : ${file}`);
console.log(`แถวที่ใช้ได้: ${total}   (ข้าม: ไม่มี SKU ${skipNoSku} · qty ไม่ใช่ตัวเลข ${skipQty})`);
console.log(`หมวด   : ${list.length}   ตัดออก ${cut} แถว · เหลือเข้าเกณฑ์นับ ${total - cut} แถว\n`);
console.log('        แถว    G≠0   หมวด');
for (const [cat, e] of list) {
  const mark = isNonCount(cat) ? '✂️ ตัด ' : '   นับ ';
  console.log(`${mark} ${String(e.rows).padStart(6)} ${String(e.nonZero).padStart(6)}   ${cat === '' ? '(ว่าง)' : cat}`);
}
console.log('\nหมายเหตุ: "นับ" = ไม่โดนตัดด้วยหมวด — ยังต้องผ่านเงื่อนไข G ≠ 0 หรือ PBM Col D ∈ {A,B,C,REVIEW} อีกชั้น');
