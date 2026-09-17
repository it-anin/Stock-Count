// explain-sku.js — อธิบายว่า "ทำไม SKU นี้ถึงขึ้นให้รีเช็ค (audit)"
//
// วิธีใช้: เปิดหน้าเว็บที่ login สาขานั้นแล้ว → F12 → Console → วางไฟล์นี้ทั้งไฟล์ → กด Enter
//          แล้วพิมพ์:  explainSku('100659')
//
// ⚠️ อ่านอย่างเดียว ไม่เขียนอะไรทั้งสิ้น — ดึงจาก state ในหน่วยความจำก่อน
//    ถ้าไม่เจอค่อยอ่าน Firestore 1 document (ไม่แตะ ไม่แก้ ไม่ลบ)
//
// เลขทุกตัวที่ใช้ตัดสินถูก "แช่" ไว้บน item ตอน Confirm แล้ว (soldQty/inboundQty/r16103Qty/
// effectiveQty/systemQty) ⇒ อ่านย้อนหลังได้ตรงตามที่ตัดสินจริง ไม่ใช่คำนวณใหม่ด้วยข้อมูลวันนี้

window.explainSku = async function explainSku(sku){
  sku=String(sku).trim();
  const out=(...a)=>console.log(...a);

  let sd=state?.scanData?.get?.(sku);
  let src='state ในเครื่องนี้';

  if(!sd&&typeof getScanItemsRef==='function'&&typeof _db!=='undefined'&&_db){
    try{
      const snap=await getScanItemsRef().doc(sku).get({source:'server'});
      if(snap.exists){sd=snap.data();src='Firestore (อ่านอย่างเดียว)';}
    }catch(e){out('อ่าน Firestore ไม่ได้:',e.code||e.message);}
  }

  if(!sd){out(`❌ ไม่พบ SKU ${sku} — ยังไม่ถูกสแกนในรอบนับนี้ (= pending)`);return;}

  const si=state?.skuMap?.get?.(sku);
  const n=v=>Number(v||0);

  out(`\n═══ SKU ${sku} — ${si?.productName||sd.productName||'(ไม่มีชื่อ)'} ═══`);
  out(`ที่มาข้อมูล : ${src}`);
  out(`สถานะตอนนี้ : ${sd.status}${sd.auditor?`  (ยืนยันโดย ${sd.auditor})`:''}`);
  out(`นับโดย      : ${sd.scannedBy||'-'}   เวลานับ: ${sd.firstScanAt||sd.timestamp||'-'}`);

  // ค่าที่แช่ไว้ตอน Confirm
  const cnt=n(sd.countedQty), sold=n(sd.soldQty), inb=n(sd.inboundQty),
        r103=n(sd.r16103Qty), sys=sd.systemQty!==undefined?n(sd.systemQty):undefined,
        eff=sd.effectiveQty!==undefined?n(sd.effectiveQty):undefined;

  if(sys===undefined||eff===undefined){
    out('\n⚠️ ยังไม่มีเลขที่แช่ไว้ = รายการนี้ยังไม่ผ่าน Confirm (ยังเป็น scanning)');
    out(`   นับได้ตอนนี้ ${cnt} · ยอดระบบสด ${si?.systemQty??'-'}`);
    return;
  }

  out(`\n── สูตรที่ใช้ตัดสิน (เลขที่แช่ไว้ตอน Confirm) ──`);
  out(`  นับได้          ${cnt}`);
  out(`  + ขายไปแล้ว     ${sold}   (R16.104 ที่เกิดก่อน/ตรงเวลานับ)`);
  out(`  + รับเข้ายังไม่ขึ้นชั้น ${r103}   (R16.103)`);
  out(`  − รับเข้าแล้ว    ${inb}   (R16.104 ขารับ)`);
  out(`  ─────────────────────`);
  out(`  = ยอดที่ควรเป็น  ${eff}`);
  out(`    ยอดระบบ (R01)  ${sys}`);
  out(`    ส่วนต่าง        ${eff-sys}`);

  out(`\n── สรุป ──`);
  if(eff===sys){
    out('  ✅ ลงตัวพอดี → ควรเป็น pass');
    if(sd.status==='audit')out('  ⚠️ แต่สถานะเป็น audit = ถูกตัดสินตอนที่ข้อมูลยังไม่เท่านี้ (R16/R01 เปลี่ยนทีหลัง)');
  }else{
    const d=eff-sys;
    out(`  🔍 ไม่ลงตัว ต่างกัน ${Math.abs(d)} → ระบบส่งให้รีเช็ค (audit)`);
    out(d>0
      ? `  ของบนชั้นมากกว่าที่ระบบบอก ${d} — มักเกิดจาก: รับเข้าแล้วแต่ R16 ที่ใช้ยังไม่ครอบ, นับเกิน, หรือของถูกคืน`
      : `  ของบนชั้นน้อยกว่าที่ระบบบอก ${Math.abs(d)} — มักเกิดจาก: ขายไปแล้วแต่ R16 ที่ใช้ยังไม่ครอบ, นับตก, ของหาย หรือค้างส่งลูกค้า`);
  }

  // ตัวช่วยไล่สาเหตุที่พบบ่อย: R16 ครอบไม่ถึงเวลานับ
  if(sold===0&&inb===0&&r103===0){
    out('\n  💡 ทั้งขายและรับเข้าเป็น 0 ทั้งหมด — ให้เช็คว่าไฟล์ R16 ที่ใช้ตอน Confirm');
    out('     ครอบถึงเวลานับ ('+(sd.firstScanAt||sd.timestamp||'?')+') หรือยัง');
    out('     ถ้า export R16 ก่อนเวลานับ ยอดขาย/รับเข้าจะเป็น 0 แล้วรีเช็คเกินจริง');
  }

  out(`\n── เวอร์ชันไฟล์ที่ใช้ตัดสิน ──`);
  out(`  R01: ${sd.r01Version||'-'}`);
  out(`  R16.104: ${sd.r16Version||'-'}   R16.103: ${sd.r16_103Version||'-'}`);
  out(`  ยืนยันเมื่อ: ${sd.confirmedAt||sd.countConfirmedAt||'-'} โดย ${sd.confirmedBy||'-'}`);

  if(sd.recheckQty!==undefined&&sd.recheckQty!==null){
    out(`\n── รอบรีเช็ค ──`);
    out(`  รีเช็คได้ ${n(sd.recheckQty)} โดย ${sd.recheckBy||'-'} เมื่อ ${sd.recheckAt||'-'}`);
    if(sd.recheckSystemQty!==undefined)out(`  ยอดระบบที่แช่ตอนรีเช็ค ${n(sd.recheckSystemQty)} (ตอนนี้ ${si?.systemQty??'-'})`);
  }
  out('');
  return sd;
};

console.log('พร้อมแล้ว — พิมพ์:  explainSku(\'100659\')');
