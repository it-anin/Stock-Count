// ✅ Stock Validate → badge นับเอกสารนอกใบตั้งแต่ login จริง (สาขายา · 16 ต.ค. 2026 · STOCK_VALIDATE_OUTSIDE) — เส้นทางจริงบน emulator สองเครื่อง
//   เภสัช A แนบ R16.103/R16.104 ที่มีเอกสารของสินค้า Pass 2 ตัว (S-NORM · S-F05) + มี Stock Adj ตรง 1 ตัวที่ยังไม่ปรับ (S-MULTI)
//   → A เปิดรายการนอกใบจากปุ่มในหน้า Stock Validate แล้วรับทราบ S-NORM → stock_sessions/SRC_adjerpack
//   → เภสัช B "login ใหม่หลังจากนั้น" (restore → initAfterLogin → updateStats → hub) → badge ต้องถูกเลยโดยไม่มีใครเปิดป็อปอัพ:
//     1 ไม่ตรง (S-MULTI) + 1 นอกใบที่ยังไม่รับทราบ (S-F05) = 2 · ไม่นับ S-NORM ที่ A รับทราบแล้ว (ไม่งั้นได้ 3 แล้วลดเองตอนเปิดป็อปอัพ)
//   → A รับทราบ S-F05 ต่อ → B เปิด Stock Validate (อ่านรับทราบใหม่) → badge ลดเหลือ 1
// logic ล้วน (กติกา badge · lazy load ครั้งเดียวต่อรอบ · ซ้อนป็อปอัพ · สวิตช์) อยู่ที่ specs/logic/stock-validate-outside.spec.js
const { test, expect, closeApp, requireEmulator } = require('../../lib/hooks');
const { bootFreshCount, bootJoinCount, PROJECT_ID } = require('../../lib/scenario');
const { waitForDoc, getDoc } = require('../../lib/emulator');
const { seedItems } = require('../../lib/seed');

const HDR = ['SYSWAREHOUSEID', 'TRANDATE', 'TRANNO', 'REFERENCENO1', 'SYSVOUCHERID', 'SYSSALEID', 'TOTAL', 'TOTALVAT', 'GRANDTOTAL', 'FCANCEL',
  'TAXRATE', 'SYSPERSONID', 'SYSBRANCHID', 'FPROCESS', 'SCANCODE', 'ITEMNAME', 'SYSUNITID', 'BASEQUANTITY', 'QUANTITY', 'SYSITEMID', 'PRICE',
  'AMOUNT', 'DETAILNO', 'ITEMID', 'ITEMNAME', 'TOTALTRADDISCHAVEVAT', 'TOTALTRADDISCNONEVAT', 'FSTOCKMAIN', 'FMLDISCOUNTITEM', 'FMLDISCOUNTROW',
  'DISCOUNTPROMOTION', 'NAME'];
const now = new Date();
const TODAY = `${now.getDate()}/${now.getMonth() + 1}/${now.getFullYear()}`;   // วันเดียวกับวันที่นับ (seedItems ใส่ timestamp = ตอนนี้)
function line({ time, no, sku, qty }) {
  const r = Array(HDR.length).fill('');
  r[0] = '1'; r[1] = `${TODAY} ${time}`; r[2] = no; r[9] = '0'; r[12] = '0'; r[14] = sku; r[17] = String(qty); r[23] = sku; r[31] = 'สาขาทดสอบ SRC';
  return r;
}
const csv = (lines) => [HDR, ...lines].map((r) => r.join(',')).join('\r\n');
// S-NORM / S-F05 เป็น Pass ในแอป แต่ ERP มีใบ (ขาเดียว) = เอกสารนอกใบที่ต้องเตือน
const R16_103 = csv([line({ time: '12:00', no: 'IRPSBY901', sku: 'S-NORM', qty: 1 })]);
const R16_104 = csv([line({ time: '13:00', no: 'ORDSBY901', sku: 'S-F05', qty: 1 })]);
const upload = (page, name, text) => page.evaluate(async ({ name, text }) => {
  await handleAdjErpFiles({ target: { files: [new File([text], name, { type: 'text/csv' })] } });
}, { name, text });
const ack = (page, sku, note) => page.evaluate(async ({ sku, note }) => {
  armAdjErpAck(sku);
  document.getElementById('adjErpAckNote').value = note;
  await confirmAdjErpAck(sku);
}, { sku, note });
const badge = (page) => page.evaluate(() => document.getElementById('stockValidateCount').textContent);
const waitBadge = (page, v) => page.waitForFunction((v) => document.getElementById('stockValidateCount').textContent === v, v, { timeout: 20000, polling: 100 });
const acksOnCloud = async () => { const d = await getDoc(PROJECT_ID, 'stock_sessions/SRC_adjerpack'); return d && Object.keys(JSON.parse(d.acks_json)).sort(); };
const popupsClosed = (page) => page.evaluate(() => ['adjustDocPopupOverlay', 'adjErpOutsideOverlay', 'stockValidateOverlay'].map((id) => document.getElementById(id).style.display));

test.describe('✅ Stock Validate — badge นับเอกสารนอกใบตั้งแต่ login', () => {
  test.beforeEach(() => requireEmulator());
  test.setTimeout(150_000);

  test('B login หลัง A รับทราบ → badge ถูกตั้งแต่เปิดหน้า (ไม่เปิดป็อปอัพ) · A รับทราบเพิ่ม → B เปิด Stock Validate แล้ว badge ลด', async ({ browser }) => {
    const A = await bootFreshCount(browser, { role: 'pharmacist', user: 'PharmA', mode: 'desktop' });
    const PASS = { status: 'pass', auditStatus: 'approved', initialStatus: 'pass', auditor: '', scannedBy: 'PDA-A', countedQty: 5 };
    const DIRECT = { status: 'stock_adjustment', auditStatus: 'stock_adjustment', initialStatus: 'stock_adjustment', auditor: '', directAdj: true, scannedBy: 'PDA-A' };
    await seedItems(PROJECT_ID, 'SRC', A.epoch, [
      { sku: 'S-NORM', ...PASS }, { sku: 'S-F05', ...PASS },
      { sku: 'S-MULTI', ...DIRECT, countedQty: 55, effectiveQty: 55, systemQty: 60 },   // ต้อง ORDS 5 · ไม่มีใบ → ไม่ตรง
    ]);
    await A.page.evaluate(() => { _refreshAdjMaster = async () => {}; });   // ไม่เปิด Supabase จริง (isolation tripwire) — ไม่ใช่สิ่งที่ตรวจ
    const ready = () => ['S-NORM', 'S-F05'].every((s) => state.scanData.get(s)?.status === 'pass') && state.scanData.get('S-MULTI')?.status === 'stock_adjustment';
    await A.page.waitForFunction(ready, null, { timeout: 20000, polling: 100 });

    // A แนบรายงาน 2 ไฟล์ → เอกสารนอกใบ 2 ตัว + ไม่ตรง 1 = badge 3
    await upload(A.page, 'R16.103.CSV', R16_103);
    await upload(A.page, 'R16.104.CSV', R16_104);
    await waitForDoc(PROJECT_ID, 'stock_sessions/SRC_adjerp', (d) => d && JSON.parse(d.cover_json).IRPS && JSON.parse(d.cover_json).ORDS);
    await waitBadge(A.page, '3');

    // A เปิดรายการนอกใบ "จากปุ่มในหน้า Stock Validate" แล้วรับทราบ S-NORM → badge A ลดเป็น 2 เอง · ปุ่มเป็น ✓ รับทราบแล้ว 1
    await A.page.evaluate(() => openStockValidatePopup());
    await A.page.waitForFunction(() => !!document.getElementById('svOutsideBtn'), null, { timeout: 20000, polling: 100 });
    expect(await A.page.evaluate(() => document.getElementById('svOutsideBtn').textContent)).toBe('⚠️ ใบปรับปรุงลดสินค้า 1 · ใบปรับปรุงเพิ่มสินค้า 1');
    await A.page.click('#svOutsideBtn');
    expect(await A.page.evaluate(() => document.getElementById('adjErpOutsideOverlay').style.display)).toBe('flex');
    await ack(A.page, 'S-NORM', 'ปรับปรุง LOT สินค้า — ขา ORDS อยู่ใบอื่น');
    await waitForDoc(PROJECT_ID, 'stock_sessions/SRC_adjerpack', (d) => d && d.acks_json.includes('S-NORM'));
    expect(await acksOnCloud()).toEqual(['S-NORM']);
    await waitBadge(A.page, '2');
    expect(await A.page.evaluate(() => document.getElementById('svOutsideBtn').textContent)).toBe('⚠️ ใบปรับปรุงลดสินค้า 1 · ✓ รับทราบแล้ว 1');

    // B login "หลังจากนั้น" (เส้นทาง restore + initAfterLogin จริง) → badge = 2 โดยไม่มีใครเปิดป็อปอัพ
    const B = await bootJoinCount(browser, { role: 'pharmacist', user: 'PharmB', mode: 'desktop', expectEpoch: A.epoch });
    await B.page.evaluate(() => { _refreshAdjMaster = async () => {}; });
    await B.page.waitForFunction(ready, null, { timeout: 20000, polling: 100 });
    await waitBadge(B.page, '2');
    // ไม่ได้เปิดป็อปอัพใด · แต่ B รู้ว่า S-NORM รับทราบแล้ว (อ่านโดย hub ตอน login — ทางเดียวที่เหลือ)
    expect(await popupsClosed(B.page)).toEqual(['none', 'none', 'none']);
    expect(await B.page.evaluate(() => { const a = _adjErpAckCurrent(); return a && Object.keys(a.acks); })).toEqual(['S-NORM']);
    expect(await B.page.evaluate(() => [document.getElementById('stockValidatePanel').style.display, document.getElementById('stockValidateCount').style.background]))
      .toEqual(['', 'rgba(217, 48, 37, 0.9)']);

    // A รับทราบ S-F05 ต่อ → B เปิด Stock Validate (อ่านรับทราบใหม่) → badge เหลือ 1 (ไม่ตรง S-MULTI) · ปุ่มเป็น ✓ รับทราบแล้ว 2
    await ack(A.page, 'S-F05', 'ตรวจของจริงแล้ว');
    await waitForDoc(PROJECT_ID, 'stock_sessions/SRC_adjerpack', (d) => d && d.acks_json.includes('S-F05'));
    expect(await acksOnCloud()).toEqual(['S-F05', 'S-NORM']);
    await B.page.evaluate(() => openStockValidatePopup());
    await waitBadge(B.page, '1');
    await B.page.waitForFunction(() => (document.getElementById('svOutsideBtn') || {}).textContent === '✓ รับทราบแล้ว 2', null, { timeout: 20000, polling: 100 });
    // ตารางยังเป็น Stock Adj ล้วน (ปุ่ม/badge ไม่เปลี่ยนแถวของตาราง)
    expect(await B.page.evaluate(() => [...document.querySelectorAll('#svBody tr[data-sku]')].map((tr) => tr.dataset.sku))).toEqual(['S-MULTI']);

    await closeApp(B);
    await closeApp(A);
  });
});
