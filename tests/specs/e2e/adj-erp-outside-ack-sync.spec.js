// ใบใน ERP นอกใบ 📦 → "รับทราบ" ข้ามเครื่อง (สาขายา · 11 ต.ค. 2026 · ADJ_ERP_OUTSIDE_ACK) — เส้นทางจริงบน emulator สองเครื่อง
//   เภสัช A แนบ R16.103 ที่มี IRPS ของสินค้าที่แอปเป็น Pass (= ปรับยอดนอกใบ) → A รับทราบ → stock_sessions/SRC_adjerpack
//   → เภสัช B เปิด 📦 เห็นรับทราบเดียวกัน · A กับ B รับทราบคนละตัว "พร้อมกัน" → transaction รวมกัน ไม่หาย
//   → เริ่มรอบนับใหม่ → รับทราบของรอบเก่าไม่ถูกใช้
// logic ล้วน (ที่มา · คำบอกไม่ครบคู่ · ใบใหม่หลังรับทราบ · ล้ม/รอบอื่น/ผลอ่านเก่า · สวิตช์) อยู่ที่ specs/logic/adj-erp-outside-ack.spec.js
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
// S-NORM / S-F05 เป็น Pass ในแอป แต่ ERP มีใบ = ปรับยอดนอกใบ (ขาเดียว)
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
const outside = (page) => page.evaluate(() => _adjErpOutsideList().map((x) => [x.sku, x.kind, x.ack ? (x.ack.valid ? x.ack.note : 'stale') : '']));
const acksOnCloud = async () => { const d = await getDoc(PROJECT_ID, 'stock_sessions/SRC_adjerpack'); return d && { epoch: d.countResetAt, acks: Object.fromEntries(Object.entries(JSON.parse(d.acks_json)).map(([k, v]) => [k, v.note])) }; };

test.describe('ใบใน ERP นอกใบ 📦 — รับทราบข้ามเครื่อง', () => {
  test.beforeEach(() => requireEmulator());
  test.setTimeout(150_000);

  test('A รับทราบ → B เห็น · รับทราบคนละตัวพร้อมกันไม่หาย · รอบนับใหม่ไม่ใช้ของเก่า', async ({ browser }) => {
    const A = await bootFreshCount(browser, { role: 'pharmacist', user: 'PharmA', mode: 'desktop' });
    const PASS = { status: 'pass', auditStatus: 'approved', initialStatus: 'pass', auditor: '', scannedBy: 'PDA-A' };
    await seedItems(PROJECT_ID, 'SRC', A.epoch, [{ sku: 'S-NORM', ...PASS, countedQty: 10 }, { sku: 'S-F05', ...PASS, countedQty: 5 }]);
    const B = await bootJoinCount(browser, { role: 'pharmacist', user: 'PharmB', mode: 'desktop', expectEpoch: A.epoch });
    for (const m of [A, B]) {
      // เปิดป็อปอัพ = ดึง LOT/ราคาจาก Supabase จริง (นอก 127.0.0.1 → isolation tripwire) — ไม่ใช่สิ่งที่เทสนี้ตรวจ จึงปิดไว้
      await m.page.evaluate(() => { _refreshAdjMaster = async () => {}; });
      await m.page.waitForFunction(() => ['S-NORM', 'S-F05'].every((s) => state.scanData.get(s)?.status === 'pass'), null, { timeout: 20000, polling: 100 });
    }
    await upload(A.page, 'R16.103.CSV', R16_103);
    await upload(A.page, 'R16.104.CSV', R16_104);
    await waitForDoc(PROJECT_ID, 'stock_sessions/SRC_adjerp', (d) => d && JSON.parse(d.cover_json).IRPS && JSON.parse(d.cover_json).ORDS);
    expect(await outside(A.page)).toEqual([['S-F05', 'outside', ''], ['S-NORM', 'outside', '']]);

    // A รับทราบ S-NORM → cloud · B เปิด 📦 → เห็นรับทราบเดียวกัน
    await A.page.evaluate(async () => { await openAdjustDocPopup(); openAdjErpOutsidePopup(); });
    await ack(A.page, 'S-NORM', 'ปรับปรุง LOT สินค้า — ขา ORDS อยู่ใบอื่น');
    await waitForDoc(PROJECT_ID, 'stock_sessions/SRC_adjerpack', (d) => d && d.acks_json.includes('S-NORM'));
    expect(await acksOnCloud()).toEqual({ epoch: A.epoch, acks: { 'S-NORM': 'ปรับปรุง LOT สินค้า — ขา ORDS อยู่ใบอื่น' } });
    await B.page.evaluate(() => openAdjustDocPopup());
    await B.page.waitForFunction(() => _adjErpCovered('IRPS') && _adjErpOutsideList().some((x) => x.sku === 'S-NORM' && x.ack && x.ack.valid), null, { timeout: 20000, polling: 100 });
    expect(await outside(B.page)).toEqual([['S-F05', 'outside', ''], ['S-NORM', 'outside', 'ปรับปรุง LOT สินค้า — ขา ORDS อยู่ใบอื่น']]);
    expect(await B.page.evaluate(() => document.getElementById('adjErpOutsideBtn').textContent)).toBe('⚠️ ปรับยอดนอกใบ 📦 1 · ✓ รับทราบแล้ว 1');

    // A และ B รับทราบคนละตัว "พร้อมกัน" → transaction รวมกัน ไม่มีตัวไหนหาย
    await B.page.evaluate(() => openAdjErpOutsidePopup());
    await Promise.all([ack(A.page, 'S-NORM', 'แก้หมายเหตุจาก A'), ack(B.page, 'S-F05', 'รับทราบจาก B')]);
    await waitForDoc(PROJECT_ID, 'stock_sessions/SRC_adjerpack', (d) => d && d.acks_json.includes('S-F05') && d.acks_json.includes('แก้หมายเหตุจาก A'));
    expect(await acksOnCloud()).toEqual({ epoch: A.epoch, acks: { 'S-NORM': 'แก้หมายเหตุจาก A', 'S-F05': 'รับทราบจาก B' } });

    // เริ่มรอบนับใหม่ที่ A → รับทราบของรอบเก่าบน cloud ไม่ถูกใช้ (doc ยังอยู่แต่คนละรอบ)
    await A.page.evaluate(async () => { const orig = window.prompt; window.prompt = () => CLEAR_PIN; try { await startNewCount(); } finally { window.prompt = orig; } });
    const newEpoch = await A.page.evaluate(() => _countResetAt);
    expect(newEpoch).not.toBe(A.epoch);
    await A.page.evaluate(() => _loadAdjErpAckFromCloud());
    expect(await A.page.evaluate(() => _adjErpAckCurrent() && Object.keys(_adjErpAckCurrent().acks).length)).toBe(0);
    expect((await acksOnCloud()).epoch).toBe(A.epoch);

    await closeApp(B);
    await closeApp(A);
  });
});
