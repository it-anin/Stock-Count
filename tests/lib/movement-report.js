// รายงานเคลื่อนไหวสินค้ารายเอกสาร (ProMaxx · หัว CF_… 45 คอลัมน์) — fixture สังเคราะห์ตามหัวไฟล์จริง · ห้ามนำ CSV จริงเข้า repo
// ต่างจาก R16: ไม่มีคอลัมน์ FCANCEL (ไม่มีใบยกเลิกให้ตัด) · TRANDATE มีเวลา (d/m/yyyy H:mm:ss) / CF_TRANDATE มีแต่วัน (dd/mm/yyyy)
//   · จำนวนอยู่ CF_TDBASEQUANTITY (ทศนิยม 4 ตำแหน่ง) · สาขา/คลังอยู่ CF_TSYSBRANCHID/CF_TSYSWAREHOUSEID (CF_W… ค่าเดียวกันในใบปรับปรุง) · ชื่อสาขา CF_BNAME
// ใช้กับ index.html: ADJ_ERP_MOVE_COLS / _parseAdjErpRows (การ์ด 🧾 + 📥 นำเข้าประวัติ)
const MHDR = ['CF_TSYSBRANCHID', 'CF_TSYSWAREHOUSEID', 'CF_BNAME', 'CF_WNAME', 'CF_REFTRANFERSYSWAREHOUSE', 'CF_WSYSBRANCHID', 'CF_WSYSWAREHOUSEID',
  'CF_ITEMNAME', 'CF_ITEMID', 'CF_UNITNAME', 'CF_ITEMGROUPL1_GROUPNAME', 'CF_ITEMGROUPL2_GROUPNAME', 'CF_ITEMGROUPL3_GROUPNAME', 'CF_ITEMGROUPL4_GROUPNAME',
  'CF_ITEMGROUPL5_GROUPNAME', 'CF_TRANNO', 'CF_TRANDATE', 'TRANDATE', 'CF_SERIALNO', 'CC_BEG', 'CC_SUM_TOTAL', 'CC_END_REPORT', 'CF_TDBASEQUANTITY',
  'CF_FSTOCKMAIN', 'CF_VOUCHERTYPE', 'CF_TDPRICE', 'SYSITEMID', 'CF_TDORDINARY', 'CF_TDUNITPRICE', 'SYSITEMID', 'CF_COMPANY', 'CF_PERSON_FNAME',
  'CF_PERSON_LNAME', 'CF_PERSON_PRENAME', 'CF_SYSITEMGROUPL1ID', 'CF_SYSITEMGROUPL2ID', 'CF_SYSITEMGROUPL3ID', 'CF_SYSITEMGROUPL4ID', 'CF_SYSITEMGROUPL5ID',
  'CF_ITEMGROUPL1_ORDINARY', 'CF_ITEMGROUPL2_ORDINARY', 'CF_ITEMGROUPL3_ORDINARY', 'CF_ITEMGROUPL4_ORDINARY', 'CF_ITEMGROUPL5_ORDINARY', 'CF_TRANEXTRAINFO_FNAME'];

// spec หนึ่งบรรทัด = {wh,date,no,sku,qty,branch,name} (คีย์เดียวกับ line() ของ fixture R16 ใน spec ใบ 📦 — ส่ง spec เดียวกันสร้างได้ทั้งสองรูปแบบ)
function mline({ wh = '1', date = '22/9/2026 10:00', no, sku, qty, branch = '0', name = 'สาขาทดสอบ' }) {
  const r = Array(MHDR.length).fill('');
  const set = (h, v) => { r[MHDR.indexOf(h)] = v; };
  const [dmy, hm = '0:00'] = String(date).split(' ');
  set('CF_TSYSBRANCHID', branch); set('CF_TSYSWAREHOUSEID', wh); set('CF_WSYSBRANCHID', branch); set('CF_WSYSWAREHOUSEID', wh);
  set('CF_BNAME', name); set('CF_WNAME', wh === '1' ? 'Front Store' : 'Main');
  set('CF_ITEMID', sku || ''); set('CF_TRANNO', no);
  set('CF_TRANDATE', dmy.split('/').map((p) => p.padStart(2, '0')).join('/'));          // วันอย่างเดียว — ตัวอ่านต้องไม่ใช้ (ไม่งั้นเวลาเป็น 23:59)
  set('TRANDATE', `${dmy} ${hm.split(':').length < 3 ? hm + ':00' : hm}`);              // d/m/yyyy H:mm:ss เหมือนไฟล์จริง
  set('CF_TDBASEQUANTITY', Number(qty).toFixed(4));
  set('CF_FSTOCKMAIN', /^I/.test(no) ? '1' : '-1');                                      // ทิศ: ขาเข้า +1 / ขาออก −1
  set('CF_VOUCHERTYPE', 'NN');
  return r;
}
const msheet = (specs) => [MHDR.slice(), ...specs.map(mline)];

// แปลงแถว R16 ของ spec ใบ 📦 (ลำดับหัว: คลัง=0 วันที่=1 เลขที่=2 ยกเลิก=9 สาขา=12 จำนวน=17 SKU=23 ชื่อ=31) เป็นรายงานเคลื่อนไหว
// ตัดบรรทัดยกเลิกทิ้ง (รายงานนี้ไม่มีคอลัมน์ยกเลิก) · รับหลายชีต = รวมเป็นไฟล์เดียว (ขาออก+ขาเข้า)
const fromR16 = (...sheets) => msheet(sheets.flatMap((s) => s.slice(1)).filter((r) => r[9] !== '1')
  .map((r) => ({ wh: r[0], date: r[1], no: r[2], branch: r[12], sku: r[23], qty: r[17], name: r[31] })));

module.exports = { MHDR, mline, msheet, fromR16 };
