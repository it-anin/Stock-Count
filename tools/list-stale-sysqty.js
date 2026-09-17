/*
 * Read-only survey — หา "รายการที่ตัวเลขในไฟล์ count_report ดูตรง แต่สถานะไม่ตรง"
 *
 * ทำไมต้องมี: ไฟล์ count_report_WH เอาเลขคนละเวลามาปนในแถวเดียว (index.html:8699)
 *   - ช่อง SYS QTY  = ยอดระบบ "ค่าสด" ณ ตอนกด Export  (ขยับทุกเช้าที่บอทอัป R01)
 *   - ช่อง COUNTED  = ยอดที่นับ (แช่ไว้ ไม่ขยับ)
 *   - ช่อง STATUS   = ผลตัดสินตอน Confirm (แช่ไว้ ไม่ขยับ)
 *   ⇒ ช่อง DIFF = "ยอดวันนี้ − ยอดที่นับเมื่อวาน" = เทียบข้ามเวลา ไม่ใช่เลขที่ใช้ตัดสินจริง
 *   ยอดที่ใช้ตัดสินจริงคือ sd.systemQty ซึ่งไฟล์ไม่มีช่องไหนแสดงเลย
 *
 * สคริปต์นี้เทียบ "ยอดตอน Confirm" กับ "ยอดระบบตอนนี้" ให้เห็นว่าต่างกันกี่ตัว
 *
 * วิธีใช้ (Desktop · login WH · role supervisor · โหลด R01 + R05 ครบแล้ว):
 *   1. เปิดแอป → login → F12 → Console
 *   2. วางไฟล์นี้ทั้งไฟล์ แล้ว Enter
 *   3. listStaleSysQty()                    // เฉพาะตัวที่ยอดระบบขยับหลัง Confirm
 *      listStaleSysQty({all:true})          // ดูทุกรายการที่ Confirm แล้ว
 *
 * Safety properties:
 * - อ่านอย่างเดียว 100% และ **ไม่แตะ Firestore เลย** — อ่านจาก state ในหน่วยความจำล้วน
 *   (0 reads · ไม่กินโควต้า · รันระหว่างพนักงานสแกนอยู่ได้ ไม่กระทบใคร)
 * - ไม่แก้ state ไม่หยุด listener ไม่ยกเลิก timer ไม่ render อะไรใหม่
 */
(() => {
'use strict';

const CONFIRMED = new Set(['pass', 'audit', 'audit_check', 'stock_adjustment']);

// ยอดระบบดิบจาก R01 — ผูกกับ state.r01Data โดยตรง (ถูกต้องแม้ skuMap ยังไม่ถูกสร้าง)
function liveSys(sku) {
  if (typeof _rawSystemQty === 'function') {
    const v = _rawSystemQty(sku);
    if (v !== null && v !== undefined) return v;
  }
  const si = state.skuMap.get(sku);
  return si ? Number(si.systemQty || 0) : null;
}

function listStaleSysQty(opts = {}) {
  const showAll = !!opts.all;

  if (!state || !state.scanData || !state.scanData.size) {
    console.log('❌ ยังไม่มีข้อมูลการนับใน state — login และรอโหลดให้ครบก่อน');
    return [];
  }

  const rows = [];
  let nConfirmed = 0, nNoSku = 0;

  for (const [sku, sd] of state.scanData.entries()) {
    if (!CONFIRMED.has(sd.status)) continue;
    nConfirmed++;

    const live = liveSys(sku);
    if (live === null) { nNoSku++; continue; }

    // ยอดที่ระบบใช้ตัดสินจริงตอน Confirm (แช่ไว้บน item)
    const atConfirm = sd.systemQty !== undefined ? Number(sd.systemQty) : null;
    if (atConfirm === null) continue;   // ยังไม่ผ่าน Confirm จริง

    const drift = live - atConfirm;      // ยอดระบบขยับไปเท่าไรหลัง Confirm
    if (!showAll && drift === 0) continue;

    const cnt = Number(sd.countedQty || 0);
    const si = state.skuMap.get(sku);

    // DIFF ที่ผู้ใช้เห็นในไฟล์ (เทียบกับค่าสด) vs DIFF ที่ระบบใช้ตัดสินจริง
    const diffInFile = cnt - live;
    const diffReal = Number(sd.effectiveQty !== undefined ? sd.effectiveQty : cnt) - atConfirm;

    rows.push({
      SKU: sku,
      ชื่อ: (si?.productName || '').slice(0, 30),
      สถานะ: sd.status,
      นับได้: cnt,
      ยอดตอนConfirm: atConfirm,
      ยอดระบบตอนนี้: live,
      ระบบขยับ: drift,
      DIFFในไฟล์: diffInFile,
      DIFFจริงตอนตัดสิน: diffReal,
      หลอกตา: (diffInFile === 0 && sd.status !== 'pass') ? '⚠️ ใช่' : '',
      เวลานับ: sd.firstScanAt || sd.timestamp || ''
    });
  }

  rows.sort((a, b) => Math.abs(b.ระบบขยับ) - Math.abs(a.ระบบขยับ));

  console.log(`\n═══ สรุป ═══`);
  console.log(`Confirm แล้วทั้งหมด        ${nConfirmed} รายการ`);
  console.log(`ยอดระบบขยับหลัง Confirm   ${rows.filter(r => r.ระบบขยับ !== 0).length} รายการ`);
  const misleading = rows.filter(r => r.หลอกตา);
  console.log(`⚠️ "ตัวเลขดูตรงแต่สถานะไม่ตรง"  ${misleading.length} รายการ  ← กลุ่มที่ทำให้อ่านไฟล์แล้วเข้าใจผิด`);
  if (nNoSku) console.log(`(ข้าม ${nNoSku} รายการที่ไม่มีใน R01/R05)`);

  if (!rows.length) {
    console.log('\n✅ ไม่มีรายการที่ยอดระบบขยับหลัง Confirm — ไฟล์ count_report อ่านได้ตรงตามจริง');
    return [];
  }

  console.log(`\n── รายการ (เรียงตามยอดที่ขยับมากสุด) ──`);
  console.table(rows);

  if (misleading.length) {
    console.log(`\n── เฉพาะกลุ่มหลอกตา (DIFF ในไฟล์เป็น 0 แต่สถานะไม่ใช่ Pass) ──`);
    console.table(misleading);
    console.log('กลุ่มนี้ถ้าดูจากไฟล์อย่างเดียวจะสรุปว่า "นับถูก" ทั้งที่ระบบสั่งให้รีเช็ค/ปรับสต็อก');
    console.log('สาเหตุ: ยอดระบบขยับหลัง Confirm จนบังเอิญมาตรงกับยอดที่นับได้');
  }

  return rows;
}

window.listStaleSysQty = listStaleSysQty;
console.log('พร้อมแล้ว — พิมพ์:  listStaleSysQty()      // เฉพาะตัวที่ยอดระบบขยับ');
console.log('                  listStaleSysQty({all:true})   // ดูทุกรายการที่ Confirm แล้ว');
})();
