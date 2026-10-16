/*
 * ลบ SKU ที่ค้างใน RESULT ของสาขายา ซึ่งไม่อยู่ใน catalog ของสาขา (เช่น สแกนทดสอบ SKU ที่ไม่มีสินค้าจริง)
 *
 * ทำไมต้องมี: รายการ `audit` (รอรีเช็ค) ที่ SKU ไม่อยู่ใน skuMap — ไม่มีใน Product Master ของสาขาและไม่มีแถวใน R01 —
 * แสดงใน RESULT และนับในปุ่ม "✓ ยืนยันรีเช็ค (N)" แต่ยืนยันไม่ได้: `_confirmPharmacyAuditBatched` กรองด้วย
 * `state.skuMap.has(sku)` จนได้ toast "ไม่มีรายการรอยืนยัน" · ปุ่ม ✕ ในแถวแค่ล้างยอดรีเช็ค (สถานะยังเป็น audit แถวไม่หาย)
 * · การอัป R16 ไม่ช่วย (`reEvaluateAuditItems` ข้าม SKU ที่ไม่มี skuMap เหมือนกัน)
 *
 * วิธีใช้ (Desktop · login สาขายาที่ต้องการ):
 *   1. เปิดแอป → login → F12 → Console
 *   2. วางไฟล์นี้ทั้งไฟล์ แล้ว Enter          // ต้องวางใหม่ทุกครั้งที่รีโหลดหน้า
 *   3. await purgeTestSku('700414')                  // dry-run: แสดง item/marker อย่างเดียว ไม่เขียนอะไร
 *      await purgeTestSku('700414',{apply:true})     // ลบจริง (ตรวจ branch กับ item.status ใน dry-run ก่อนเสมอ)
 *
 * ทำอะไร (เมื่อ apply:true ตามลำดับ):
 *   1. ดาวน์โหลดไฟล์ JSON สำรอง (item + marker) — ทางกู้ทางเดียว
 *   2. ลบ SKU ออกจาก `{branch}_pharmacy_audit_markers` (transaction)
 *   3. ลบ `stock_sessions/{branch}/items/{sku}`
 *   4. ล้าง state ในเครื่องนี้ + refresh RESULT / ปุ่มยืนยัน
 *
 * Safety properties:
 * - dry-run เป็นค่าเริ่มต้น · ใช้ได้เฉพาะสาขายา · ปฏิเสธเมื่อมี Confirm/branch lock อยู่
 * - ปฏิเสธเมื่อ SKU อยู่ใน skuMap — รายการแบบนั้นยืนยันรีเช็คตามปกติได้ ไม่ควรลบ
 * - ⛔ ต้องลบ marker ก่อน item เสมอ: ถ้าลบ item ก่อน เครื่องอื่นที่เปิดอยู่จะได้ sd ว่างจาก `_applyScanItemRemoved`
 *   แล้ว `_applyPharmacyAuditMarkersToState` ใช้ marker ที่ยังอยู่ ตั้งสถานะ audit กลับมา (index.html ~2212)
 * - ลบเฉพาะ SKU เดียว — ไม่แตะ `stock_audit_log` (ประวัติ · ตัว backfill จาก log ข้าม SKU ที่ไม่อยู่ใน catalog)
 * - ยังไม่รองรับ WH (มี workflow Count/Recheck + confirm_ops แยก) · ไม่ลบหลาย SKU พร้อมกัน
 * - เครื่องอื่นของสาขาเห็นรายการหายผ่าน listener เอง · ถ้าค้าง F5 / ปิด-เปิดแอป PDA
 */
(() => {
'use strict';

async function purgeTestSku(sku, { apply = false } = {}) {
  sku = String(sku);
  if (!_db || !_isPharmacyBranch()) return console.log('❌ ใช้ได้เฉพาะสาขายาที่ login อยู่');
  if (_branchConfirming || _isBranchConfirmLockActive()) return console.log('❌ มีการ Confirm อยู่ — รอให้เสร็จก่อน');
  if (state.skuMap.has(sku)) return console.log('❌ SKU นี้อยู่ใน catalog สาขา — ยืนยันรีเช็คตามปกติได้ ไม่ต้องลบ');

  const itemRef = getScanItemsRef().doc(sku), markerRef = getPharmacyAuditMarkerRef();
  const [itemSnap, markerSnap] = await Promise.all([itemRef.get({ source: 'server' }), markerRef.get({ source: 'server' })]);
  const item = itemSnap.exists ? itemSnap.data() : null;
  const marker = markerSnap.exists ? ((markerSnap.data().items || {})[sku] || null) : null;
  console.log({ branch: currentBranch, sku, item, marker, local: state.scanData.get(sku) });
  if (!item && !marker) return console.log('ไม่พบ SKU นี้บน Cloud');
  if (!apply) return console.log(`dry-run — ถ้าถูกต้องรัน: await purgeTestSku('${sku}',{apply:true})`);

  // สำรองก่อนลบ
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(
    [JSON.stringify({ branch: currentBranch, sku, countResetAt: _countResetAt, item, marker }, null, 1)],
    { type: 'application/json' }));
  a.download = `backup_${currentBranch}_${sku}_${Date.now()}.json`;
  document.body.appendChild(a); a.click(); a.remove();

  // 1) marker ก่อน (ดูเหตุผลที่หัวไฟล์)
  if (marker) await _db.runTransaction(async tx => {
    const s = await tx.get(markerRef); if (!s.exists) return;
    const old = s.data() || {}; if (!old.items || !(sku in old.items)) return;
    const items = { ...old.items }; delete items[sku];
    tx.set(markerRef, { ...old, items, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
  });
  // 2) item
  if (item) await itemRef.delete();
  // 3) ในเครื่องนี้
  _dirtySkus.delete(sku); _scanItemRev.delete(sku); _scanItemSynced.delete(sku);
  state.scanData.delete(sku); scanListMap.delete(sku);
  invalidatePopupRowsCache(); rebuildScanListMap(true); renderScanList(); updateStats();
  updatePharmacistAuditConfirmBtn(); updateAuditVerifyCount(); scheduleSave();
  console.log('✅ ลบ', sku, 'แล้ว (marker:', !!marker, '· item:', !!item, ')');
}

window.purgeTestSku = purgeTestSku;
console.log("purgeTestSku พร้อมใช้ — เริ่มด้วย dry-run: await purgeTestSku('SKU')");
})();
