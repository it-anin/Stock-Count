// fixture สังเคราะห์ของ R16103.CSV (ใบรับสินค้าเข้าระหว่างวันของ 3 สาขาในไฟล์เดียว) — ห้ามนำข้อมูลจริงเข้า repo
// หัวคอลัมน์/ตำแหน่งเหมือน R16104.CSV (40 คอลัมน์ · SYSBRANCHID 12 · SCANCODE 14 · BASEQUANTITY 17 · ITEMID 23 · FSTOCKMAIN 27 · NAME 31)
//    ✅ หัว 40 คอลัมน์ยืนยันกับไฟล์จริงแล้ว 17 พ.ย. 2026 (BOTR16103 รันจริงครั้งแรก · last_run.json facts.csv_header = HEAD ของ r16-104-fixture ทุกตัว)
//    ⏳ เนื้อใน (ประเภทเอกสาร × FSTOCKMAIN × Col A ต่อสาขา) ยังไม่ได้ยืนยัน (ขั้น 0 ของแผน) — บอทตรวจหัวคอลัมน์ทุกรอบ ไฟล์จริงต่างจากนี้ = ตกด่าน ไม่หักผิดเงียบ
const F = require('./r16-104-fixture');

// SYSWAREHOUSEID ของคลังที่ R01 ของสาขาใช้ (ต้องตรง RECEIPT_WAREHOUSE ในบอท) — SRC หน้าร้าน = 1 · KKL/SSS main = 0
const WAREHOUSE = { SRC: '1', KKL: '0', SSS: '0' };

let seq = 1;
// แถวใบรับ 1 แถวของสาขา b (ค่าเริ่มต้น = IRVC รับจากผู้ขาย · FSTOCKMAIN +1 · คลังของ R01 สาขานั้น)
function receipt(b, o = {}) {
  const n = String(seq++).padStart(6, '0');
  return F.branchRow(b, { tranNo: `IRVCBY0012611${n}`, colA: WAREHOUSE[b], stockMain: '1', ...o });
}

// ---- R4166.CSV (เอกสารรออนุมัติ · 17 พ.ย. 2026) ----
// หัว 19 คอลัมน์ตามไฟล์จริงที่ผู้ใช้ส่งมา 17 พ.ย. 2026 (ข้อมูลจริงไม่เข้า repo) · บอทใช้แค่คอลัมน์ C (TRANNO) + ตรวจว่ามี SYSBRANCHID/TRANDATE/FCANCEL
const HEAD_4166 = ['CF_TRANDATE', 'SYSBRANCHID', 'TRANNO', 'SYSSALEID', 'SYSPERSONID', 'SYSWAREHOUSEID', 'TRANDATE', 'TOTAL', 'TOTALVAT',
  'GRANDTOTAL', 'FCANCEL', 'COMMENTS', 'NAME', 'PERSONID', 'FNAME', 'LNAME', 'EMPID', 'CF_COMPANY_NAME', 'CF_PRENAME'];

// แถวเอกสารรออนุมัติ 1 แถว (เลขที่เอกสาร tranNo · สาขา b) — ค่าอื่นเป็นค่าสังเคราะห์ที่บอทไม่อ่าน
function pendingRow(tranNo, b = 'SSS', o = {}) {
  const r = new Array(HEAD_4166.length).fill('');
  r[0] = o.day ?? '';
  r[1] = F.BRANCH_ID[b];
  r[2] = tranNo;
  r[5] = WAREHOUSE[b];
  r[6] = o.at ?? '';
  r[10] = o.cancel ?? '0';
  r[12] = 'ผู้จำหน่ายสังเคราะห์';
  return r;
}
// ข้อความไฟล์ R4166 (CRLF แบบไฟล์จริง · ไม่มี BOM — ตัวเขียนไฟล์ของ harness ใส่ BOM ให้เหมือน R16103) · ไม่ส่งเลขที่เอกสาร = มีแต่หัวตาราง
const csv4166 = (tranNos = [], b = 'SSS', o = {}) => F.csvText(tranNos.map((t) => pendingRow(t, b, o)), { head: o.head ?? HEAD_4166 });

module.exports = { WAREHOUSE, receipt, csvText: F.csvText, HEAD: F.HEAD, HEAD_4166, pendingRow, csv4166 };
