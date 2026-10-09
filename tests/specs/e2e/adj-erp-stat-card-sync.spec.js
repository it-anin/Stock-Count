// การ์ดสถิติ "Stock Adj เข้าระบบ" X / Y (สาขายา · ต.ค. 2026 · PHARMACY_ADJ_ERP_CARD) — เส้นทางจริงบน emulator สองเครื่อง
//   เภสัช Desktop A แนบ R16.104/R16.103 → stock_sessions/SRC_adjerp → ผู้ช่วย PDA B (ไม่มีสิทธิ์เปิด 📦) การ์ดขยับเองผ่าน listener
//   → แนบเพิ่มทีละไฟล์ การ์ด B ตามทุกครั้ง · ครบแล้วเขียว 100% → เริ่มรอบนับใหม่ → B ไม่ใช้ผล ERP รอบเก่า
// logic ล้วน (กติกาตัวเลข · ทางถอย · listener guard) อยู่ที่ specs/logic/adj-erp-stat-card.spec.js
const { test, expect, closeApp, requireEmulator } = require('../../lib/hooks');
const { bootFreshCount, bootJoinCount, PROJECT_ID } = require('../../lib/scenario');
const { waitForDoc } = require('../../lib/emulator');
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
const R16_104_V1 = csv([line({ time: '10:00', no: 'ORDSBY901', sku: 'S-F05', qty: 2 }), line({ time: '11:00', no: 'ORDSBY902', sku: 'S-MULTI', qty: 3 })]);
const R16_104_V2 = csv([line({ time: '10:00', no: 'ORDSBY901', sku: 'S-F05', qty: 2 }), line({ time: '11:00', no: 'ORDSBY902', sku: 'S-MULTI', qty: 3 }),
  line({ time: '13:00', no: 'ORDSBY903', sku: 'S-MULTI', qty: 2 })]);
const R16_103 = csv([line({ time: '12:00', no: 'IRPSBY901', sku: 'S-NORM', qty: 2 })]);
const upload = (page, name, text) => page.evaluate(async ({ name, text }) => {
  await handleAdjErpFiles({ target: { files: [new File([text], name, { type: 'text/csv' })] } });
}, { name, text });
const card = (page) => page.evaluate(() => {
  const sub = document.getElementById('statAuditSub');
  return { label: document.getElementById('statAuditLabel').textContent, value: document.getElementById('statFail').textContent,
    sub: sub.style.display === 'none' ? '' : sub.textContent, green: document.getElementById('statFail').classList.contains('green') };
});
const waitValue = (page, v) => page.waitForFunction((v) => document.getElementById('statFail').textContent === v, v, { timeout: 20000, polling: 100 });

test.describe('การ์ด Stock Adj เข้าระบบ — ซิงก์ข้ามเครื่อง', () => {
  test.beforeEach(() => requireEmulator());
  test.setTimeout(150_000);

  test('เภสัช A แนบไฟล์ → ผู้ช่วย PDA B การ์ดขยับเองโดยไม่เปิดป็อปอัพ · ครบ = เขียว · รอบใหม่ไม่ใช้ผลเก่า', async ({ browser }) => {
    const A = await bootFreshCount(browser, { role: 'pharmacist', user: 'PharmA', mode: 'desktop' });
    // Stock Adj ตรงที่แช่เลขตอน Confirm: S-F05 ขาด 2 · S-MULTI ขาด 5 · S-NORM เกิน 2
    const DIRECT = { status: 'stock_adjustment', auditStatus: 'stock_adjustment', initialStatus: 'stock_adjustment', auditor: '', directAdj: true, scannedBy: 'PDA-A' };
    await seedItems(PROJECT_ID, 'SRC', A.epoch, [
      { sku: 'S-F05', ...DIRECT, countedQty: 3, effectiveQty: 3, systemQty: 5 },
      { sku: 'S-MULTI', ...DIRECT, countedQty: 55, effectiveQty: 55, systemQty: 60 },
      { sku: 'S-NORM', ...DIRECT, countedQty: 12, effectiveQty: 12, systemQty: 10 },
    ]);
    const B = await bootJoinCount(browser, { role: 'assistant', user: 'AsstB', mode: 'pda', expectEpoch: A.epoch });
    await A.page.evaluate(() => { _refreshAdjMaster = async () => {}; });   // ไม่เปิด Supabase จริง (isolation tripwire) — ไม่ใช่สิ่งที่ตรวจ
    for (const m of [A, B]) {
      await m.page.waitForFunction(() => ['S-F05', 'S-MULTI', 'S-NORM'].every((s) => state.scanData.get(s)?.status === 'stock_adjustment'), null, { timeout: 20000, polling: 100 });
      await waitValue(m.page, '0 / 3');
      expect(await card(m.page)).toEqual({ label: 'Stock Adj เข้าระบบ', value: '0 / 3', sub: 'ยังไม่อัป R02.102', green: false });
    }
    expect(await B.page.evaluate(() => [_adjErpEnabled(), _adjErpCardOn(), !!_adjErpUnsubscribe])).toEqual([false, true, true]);   // ผู้ช่วย: ไม่มีสิทธิ์ 🧾 แต่ฟังผลให้การ์ด

    // A แนบ R16.104 (ORDS) → S-F05 เข้าแล้ว · S-MULTI บางส่วน 3/5 · IRPS ยังไม่มีข้อมูล
    await upload(A.page, 'R16.104.CSV', R16_104_V1);
    await waitForDoc(PROJECT_ID, 'stock_sessions/SRC_adjerp', (d) => d && d.countResetAt === A.epoch);
    for (const m of [A, B]) {
      await waitValue(m.page, '1 / 3');
      expect(await card(m.page)).toMatchObject({ value: '1 / 3', sub: 'IRPS: ยังไม่มีข้อมูล ERP · ⚠️ ไม่ตรง 1' });
    }
    expect(await B.page.evaluate(() => document.getElementById('adjustDocPopupOverlay').style.display)).not.toBe('flex');   // B ไม่ได้เปิดป็อปอัพ

    // A แนบ R16.103 (IRPS) แล้ว R16.104 รุ่นใหม่ (S-MULTI ครบ 5) → ครบ 3/3 เขียว
    await upload(A.page, 'R16.103.CSV', R16_103);
    await waitValue(B.page, '2 / 3');
    expect(await card(B.page)).toMatchObject({ sub: '⚠️ ไม่ตรง 1' });
    await upload(A.page, 'R16.104-v2.CSV', R16_104_V2);
    await waitValue(B.page, '3 / 3');
    expect(await card(B.page)).toEqual({ label: 'Stock Adj เข้าระบบ', value: '3 / 3', sub: '', green: true });

    // เริ่มรอบนับใหม่ที่ A → B รับรอบใหม่แล้วต้องไม่ใช้ผล ERP ของรอบเก่า (doc ยังอยู่บน cloud แต่คนละรอบ)
    await A.page.evaluate(async () => { const orig = window.prompt; window.prompt = () => CLEAR_PIN; try { await startNewCount(); } finally { window.prompt = orig; } });
    const newEpoch = await A.page.evaluate(() => _countResetAt);
    expect(newEpoch).not.toBe(A.epoch);
    await B.page.waitForFunction((e) => _countResetAt === e, newEpoch, { timeout: 20000, polling: 100 });
    expect(await B.page.evaluate(() => _adjErpCurrent())).toBeNull();
    await B.page.waitForFunction(() => document.getElementById('statFail').textContent === '0 / 0', null, { timeout: 20000, polling: 100 });

    await closeApp(B);
    await closeApp(A);
  });
});
