// fixture สังเคราะห์ของ R16104.CSV (รายงาน R16.104 จาก BOTR16104: 3 สาขาในไฟล์เดียว · 40 คอลัมน์) — ห้ามนำข้อมูลจริงเข้า repo
// หัวคอลัมน์/ตำแหน่งตรงกับไฟล์จริง 13 ต.ค. 2026 (SYSBRANCHID idx 12 · SCANCODE 14 · BASEQUANTITY 17 · ITEMID 23 · NAME 31)
const HEAD = ['SYSWAREHOUSEID', 'TRANDATE', 'TRANNO', 'REFERENCENO1', 'SYSVOUCHERID', 'SYSSALEID', 'TOTAL', 'TOTALVAT',
  'GRANDTOTAL', 'FCANCEL', 'TAXRATE', 'SYSPERSONID', 'SYSBRANCHID', 'FPROCESS', 'SCANCODE', 'ITEMNAME', 'SYSUNITID',
  'BASEQUANTITY', 'QUANTITY', 'SYSITEMID', 'PRICE', 'AMOUNT', 'DETAILNO', 'ITEMID', 'ITEMNAME', 'TOTALTRADDISCHAVEVAT',
  'TOTALTRADDISCNONEVAT', 'FSTOCKMAIN', 'FMLDISCOUNTITEM', 'FMLDISCOUNTROW', 'DISCOUNTPROMOTION', 'NAME', 'EMPID',
  'CF_UNITNAME', 'CF_COMPANY', 'FNAME', 'CF_TRANEXTRAINFO_PRENAME', 'CF_TRANEXTRAINFO_FNAME', 'CF_TRANEXTRAINFO_LNAME',
  'CF_TRANDATE'];

const BRANCH_ID = { SRC: '0', KKL: '4', SSS: '5' };
const BRANCH_NAME = { SRC: 'อนิน สาขาแยกชากค้อ', KKL: 'อนิน สาขาเก้ากิโล', SSS: 'อนิน สาขาสวนเสือศรีราชา' };

// แถวข้อมูล 1 แถว (ค่าเริ่มต้น = ขาย ORCM หน้าร้าน SRC ของวันนี้ 1 ชิ้น)
function row(o = {}) {
  const r = new Array(HEAD.length).fill('');
  r[0] = o.colA ?? '1';
  r[1] = o.at ?? '13/10/2026 09:00:00';
  r[2] = o.tranNo ?? 'ORCMBY001261000001';
  r[9] = o.cancel ?? '0';
  r[12] = o.branchId ?? '0';
  r[14] = o.barcode ?? 'B-01';
  r[17] = o.qty ?? '1.0000';
  r[23] = o.sku ?? 'S-01';
  r[27] = o.stockMain ?? '-1';
  r[31] = o.name ?? BRANCH_NAME.SRC;
  return r;
}

// แถวของสาขา b (ใส่ SYSBRANCHID + NAME ให้ตรงสาขา)
const branchRow = (b, o = {}) => row({ branchId: BRANCH_ID[b], name: BRANCH_NAME[b], ...o });

// เขียน CSV ด้วยกติกา quote มาตรฐาน (ฟิลด์ที่มี , " หรือขึ้นบรรทัดใหม่ถูกครอบด้วย ")
function csvText(rows, { head = HEAD, bom = false, eol = '\r\n' } = {}) {
  const q = (f) => (/[",\r\n]/.test(f) ? '"' + String(f).replace(/"/g, '""') + '"' : String(f));
  return (bom ? '﻿' : '') + [head, ...rows].map((r) => r.map(q).join(',')).join(eol) + eol;
}

// catalog สังเคราะห์: PBM กับ R01 ซ้อนกันบางส่วน (skuMap = PBM ∪ R01) · R05 มีของแปลกให้ทดสอบ fallback/ตัวท้ายชนะ/SKU กำพร้า
function catalog() {
  const sku = (n) => 'S-' + String(n).padStart(2, '0');
  const all = Array.from({ length: 40 }, (_, i) => sku(i + 1));
  const pm = all.slice(0, 30).map((s) => ({ sku: s, productName: 'PM ' + s, unitPrice: 10 }))
    .concat([{ sku: 'PM-ONLY', productName: 'pm only', unitPrice: 10 }, { sku: 'S-2', productName: 'x', unitPrice: 10 }]);
  const r01 = all.slice(19).map((s) => ({ colE: s, systemQty: 5, productName: 'R01 ' + s }))
    .concat([{ colE: 'R01-ONLY', systemQty: 1, productName: 'x' }, { colE: 'ก-ไทย', systemQty: 1, productName: 'thai' },
      { colE: 'S-10', systemQty: 1, productName: 'x' }, { colE: 's-1', systemQty: 1, productName: 'x' }]);
  const r05 = [
    ...all.map((s, i) => ({ barcode: 'B-' + String(i + 1).padStart(2, '0'), colE: s, unitName: 'EA', unitMultiplier: 1, unitPrice: 10 })),
    { barcode: 'b-05', colE: 'S-06', unitName: 'EA', unitMultiplier: 1, unitPrice: 10 },       // เล็กต่างจาก B-05 → exact ชนะ fallback
    { barcode: 'ZZ-1', colE: 'S-11', unitName: 'EA', unitMultiplier: 1, unitPrice: 10 },       // CSV 'Zz-1' → fallback upper
    { barcode: 'zz-2', colE: 'S-12', unitName: 'EA', unitMultiplier: 1, unitPrice: 10 },       // CSV 'ZZ-2' → fallback lower
    { barcode: 'DUP-1', colE: 'S-07', unitName: 'EA', unitMultiplier: 1, unitPrice: 10 },
    { barcode: 'DUP-1', colE: 'S-08', unitName: 'EA', unitMultiplier: 1, unitPrice: 10 },       // ตัวท้ายชนะ
    { barcode: 'ORPH-1', colE: 'NOPE-1', unitName: 'EA', unitMultiplier: 1, unitPrice: 10 },     // SKU ไม่อยู่ใน skuMap → ไม่เข้า barcodeMap
    { barcode: 'THAI-1', colE: 'ก-ไทย', unitName: 'EA', unitMultiplier: 1, unitPrice: 10 },
    { barcode: 'T-2', colE: 'S-2', unitName: 'EA', unitMultiplier: 1, unitPrice: 10 },
    { barcode: 'T-10', colE: 'S-10', unitName: 'EA', unitMultiplier: 1, unitPrice: 10 },
    { barcode: 't-1', colE: 's-1', unitName: 'EA', unitMultiplier: 1, unitPrice: 10 },
    { barcode: '', colE: 'S-01', unitName: 'EA', unitMultiplier: 1, unitPrice: 10 },            // ถูก _parseR05Json กรองทิ้ง
    { barcode: 'NOSKU-1', colE: '', unitName: 'EA', unitMultiplier: 1, unitPrice: 10 },        // ถูก _parseR05Json กรองทิ้ง
  ];
  return { pm, r01, r05 };
}

// สุ่มแบบกำหนดผลได้ (เทสต้องทำซ้ำได้ทุกรอบ)
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}
const pick = (r, arr) => arr[Math.floor(r() * arr.length)];

module.exports = { HEAD, BRANCH_ID, BRANCH_NAME, row, branchRow, csvText, catalog, rng, pick };
