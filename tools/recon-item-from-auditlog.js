/*
 * ประกอบ "ไฟล์ผลอ่านย้อนหลัง" ของ item จากแถวใน stock_audit_log — ใช้เมื่อไม่มีไฟล์ PITR (before-*.json) ของ SKU นั้น
 * แล้วส่งให้ restoreFromPitr() (tools/restore-item-from-pitr.js) กู้เอกสาร items/{sku} กลับ
 *
 * ใช้ได้กับ item ที่ "ผ่านรีเช็คแล้วเป็น Stock Adj" เท่านั้น (แถวใน log มี auditor + status stock_adjustment)
 * ที่มาของตัวเลข: ค่าจริงจาก log = จำนวนนับ · ผู้นับ · เวลานับครั้งแรก · ผู้รีเช็ค · จำนวนรีเช็ค · เวลารีเช็ค
 *                 ค่าที่คำนวณย้อน = ยอดระบบตอนรีเช็ค = จำนวนรีเช็ค − ผลต่างที่ปรับเข้า ERP (diff)
 *                 ค่าที่ไม่รู้ (systemQty / effectiveQty ตอน Confirm ครั้งแรก) = ไม่ใส่ ไม่แต่งขึ้นเอง
 *
 * วิธีใช้ (Desktop · login สาขานั้นแล้ว · วางไฟล์ restore-item-from-pitr.js ก่อน แล้ววางไฟล์นี้):
 *   1. ดูแถวล่าสุดของ SKU ใน log (stock_audit_log) — เอา counted · scannedBy · firstScanAt · auditor · recheck · timestamp
 *   2. diff = ผลต่างของใบที่ปรับเข้า ProMaxx แล้ว: ใบ ORDS (ลดสต็อก) ใส่ค่าลบ เช่น -1 · ใบ IRPS (เพิ่ม) ใส่ค่าบวก เช่น 2
 *   3. ตรวจก่อน (ไม่เขียน):
 *        await restoreFromPitr({ files: [reconItem({ sku:'100026', counted:53, by:'ผู้นับ', first:'2026-08-11 14:33:57',
 *                                                       auditor:'ผู้รีเช็ค', recheck:19, last:'2026-09-24 11:59:31', diff:-1 })] })
 *      หลาย SKU ในครั้งเดียว = ใส่ reconItem(...) หลายตัวในอาร์เรย์ files
 *   4. เขียนจริง: เหมือนข้อ 3 แต่เพิ่ม dryRun:false แล้วพิมพ์ข้อความยืนยันตามที่ขึ้น
 *
 * ⛔ ก่อนเขียนจริงต้องเช็ค _rawSystemQty('<SKU>') ต้อง ≠ ยอดระบบตอนรีเช็ค (recheck − diff) — ถ้าเท่ากัน รายการจะกลับเข้าใบ 📦
 *    เป็นผลต่างเดิมอีกรอบ = ปรับเข้า ERP ซ้ำ · ตัวเลขทั้งหมดอยู่ในรายงาน dry-run ให้ตรวจด้วยตาก่อน
 */
(() => {
'use strict';

const REQUIRED = ['sku', 'counted', 'by', 'first', 'auditor', 'recheck', 'last', 'diff'];
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

function reconItem(o = {}) {
  if (typeof currentBranch === 'undefined' || !currentBranch) throw new Error('reconItem: ยังไม่ได้ login สาขา');
  if (typeof _countResetAt === 'undefined' || !_countResetAt) throw new Error('reconItem: ยังไม่มีรอบนับ (countResetAt) — login ให้เสร็จก่อน');
  for (const k of REQUIRED) if (o[k] === undefined || o[k] === null || o[k] === '') throw new Error(`reconItem: ขาดค่า "${k}"`);
  const sku = String(o.sku).trim();
  if (!sku || sku.includes('/')) throw new Error('reconItem: sku ไม่ถูกต้อง');
  if (!isNum(o.counted) || o.counted < 0) throw new Error('reconItem: counted ต้องเป็นตัวเลข ≥ 0');
  if (!isNum(o.recheck) || o.recheck < 0) throw new Error('reconItem: recheck ต้องเป็นตัวเลข ≥ 0');
  if (!Number.isInteger(o.diff) || o.diff === 0) throw new Error('reconItem: diff ต้องเป็นจำนวนเต็มที่ไม่ใช่ 0 (ORDS = ค่าลบ · IRPS = ค่าบวก)');
  const when = (s) => Date.parse(String(s).replace(' ', 'T'));
  if (!Number.isFinite(when(o.first)) || !Number.isFinite(when(o.last))) throw new Error('reconItem: first/last ต้องเป็นเวลารูปแบบ "YYYY-MM-DD HH:mm:ss"');
  // แอปถือว่า item เป็นของรอบนี้เมื่อเวลานับ ≥ เริ่มรอบ − 5 นาที — ไม่งั้น marker จะไม่ถูกสร้างกลับตอน login (_pharmacyItemInCurrentEpoch)
  if (when(o.first) < Date.parse(_countResetAt) - 5 * 60 * 1000) throw new Error(`reconItem: เวลานับครั้งแรก ${o.first} อยู่ก่อนรอบนับ ${_countResetAt} — ไม่ใช่ item ของรอบนี้`);
  const sysAtRecheck = o.recheck - o.diff;   // ORDS -1 → ระบบเดิม = รีเช็ค + 1 · IRPS +2 → ระบบเดิม = รีเช็ค − 2
  if (sysAtRecheck < 0) throw new Error(`reconItem: diff ${o.diff} ทำให้ยอดระบบตอนรีเช็คติดลบ (${sysAtRecheck}) — ตรวจเครื่องหมาย (ORDS = ลบ · IRPS = บวก)`);
  const F = (x) => { const f = {}; for (const [k, v] of Object.entries(x)) f[k] = typeof v === 'number' ? { integerValue: String(v) } : { stringValue: String(v) }; return f; };
  return {
    name: `reconstructed-${currentBranch}-${sku}.json`,
    json: [{ readTime: 'reconstructed-from-audit-log', found: {
      name: `projects/x/databases/(default)/documents/stock_sessions/${currentBranch}/items/${sku}`,
      fields: F({
        sku, barcode: o.barcode || sku, countResetAt: _countResetAt,
        status: 'stock_adjustment', auditStatus: 'stock_adjustment', initialStatus: 'audit',
        countedQty: o.counted, scannedBy: o.by, firstScanAt: o.first,
        auditor: o.auditor, recheckBy: o.recheckBy || o.auditor,
        recheckQty: o.recheck, recheckSystemQty: sysAtRecheck, recheckAt: o.last, timestamp: o.last,
        rev: 1,
      }),
    } }],
  };
}

window.reconItem = reconItem;
console.log('[recon] พร้อมใช้งาน — reconItem({sku, counted, by, first, auditor, recheck, last, diff}) · ใช้คู่กับ restoreFromPitr({files:[reconItem(...)]})');
})();
