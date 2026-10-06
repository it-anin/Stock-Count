// ใบ 📦 🧾 ตรวจกับ ERP — เส้นทางจริงบน emulator สองเครื่อง (ต.ค. 2026)
//   เภสัช Desktop A แนบ R16.104 → stock_sessions/SRC_adjerp (ผูก countResetAt) → เภสัช Desktop B เปิดป็อปอัพเห็นสถานะเดียวกัน
//   → A แนบ R16.104 รุ่นใหม่ "พร้อมกับ" B แนบ R16.103 → transaction รวมกัน ไม่มีชนิดไหนหาย · ทั้งสองเครื่องเปิดใหม่เห็นครบ
//   → เริ่มรอบนับใหม่ → ผลรอบเก่าบน cloud ไม่ถูกใช้
// logic ล้วน (parser · merge · สถานะ · ตัวกรอง · Export · ทางถอย) อยู่ที่ specs/logic/adjust-doc-erp.spec.js
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
function line({ time, no, sku, qty, wh = '1', cancel = '0' }) {
  const r = Array(HDR.length).fill('');
  r[0] = wh; r[1] = `${TODAY} ${time}`; r[2] = no; r[9] = cancel; r[12] = '0'; r[14] = sku; r[17] = String(qty); r[23] = sku; r[31] = 'สาขาทดสอบ SRC';
  return r;
}
const csv = (lines) => [HDR, ...lines].map((r) => r.join(',')).join('\r\n');
const R16_104_V1 = csv([
  line({ time: '08:00', no: 'ORCMBY800', sku: 'S-NORM', qty: 1 }),
  line({ time: '10:00', no: 'ORDSBY901', sku: 'S-F05', qty: 2 }),
  line({ time: '11:00', no: 'ORDSBY902', sku: 'S-MULTI', qty: 3 }),
  line({ time: '11:30', no: 'ORDSBY950', sku: 'S-MULTI', qty: 40, wh: '0' }),               // คลังชากค้อ — ห้ามนับเป็นของ SRC
]);
const R16_104_V2 = csv([                                                                    // export ทีหลัง: ครบทั้งวัน + ใบใหม่
  line({ time: '08:00', no: 'ORCMBY800', sku: 'S-NORM', qty: 1 }),
  line({ time: '10:00', no: 'ORDSBY901', sku: 'S-F05', qty: 2 }),
  line({ time: '11:00', no: 'ORDSBY902', sku: 'S-MULTI', qty: 3 }),
  line({ time: '13:00', no: 'ORDSBY903', sku: 'S-MULTI', qty: 2 }),
]);
const R16_103 = csv([
  line({ time: '09:00', no: 'IRNCBY700', sku: 'S-NORM', qty: 6 }),
  line({ time: '12:00', no: 'IRPSBY901', sku: 'S-NORM', qty: 2 }),
]);
const upload = (page, name, text) => page.evaluate(async ({ name, text }) => {
  await handleAdjErpFiles({ target: { files: [new File([text], name, { type: 'text/csv' })] } });
}, { name, text });
const states = (page, dir) => page.evaluate((dir) => {
  const rows = _buildAdjustDocRows(dir); const ev = _adjErpEval(rows, dir);
  return Object.fromEntries(rows.map((r) => { const e = ev.get(r.sku); return [r.sku, e ? `${e.state} ${e.got}/${e.need}` : null]; }));
}, dir);
const cellText = (page, sku) => page.evaluate((sku) => {
  const tr = [...document.querySelectorAll('#adjustDocBody tr')].find((r) => r.children[1] && r.children[1].textContent.trim() === sku);
  return tr && tr.children[9] ? tr.children[9].querySelector('span').textContent.trim() : null;
}, sku);
const docOf = async () => {
  const d = await getDoc(PROJECT_ID, 'stock_sessions/SRC_adjerp');
  return d && { epoch: d.countResetAt, by: d.updatedBy, docs: JSON.parse(d.docs_json).map((x) => x.no).sort(), cover: Object.keys(JSON.parse(d.cover_json)).sort() };
};

test.describe('ใบ 📦 — ตรวจกับ ERP ซิงก์ข้ามเครื่อง', () => {
  test.beforeEach(() => requireEmulator());
  test.setTimeout(150_000);

  test('A แนบ → cloud → B เห็น · แนบพร้อมกันคนละรายงานไม่หาย · รอบนับใหม่ไม่ใช้ผลเก่า', async ({ browser }) => {
    const A = await bootFreshCount(browser, { role: 'pharmacist', user: 'PharmA', mode: 'desktop' });
    // Stock Adj ตรงที่แช่เลขตอน Confirm: S-F05 ขาด 2 · S-MULTI ขาด 5 · S-NORM เกิน 2
    const DIRECT = { status: 'stock_adjustment', auditStatus: 'stock_adjustment', initialStatus: 'stock_adjustment', auditor: '', directAdj: true, scannedBy: 'PDA-A' };
    await seedItems(PROJECT_ID, 'SRC', A.epoch, [
      { sku: 'S-F05', ...DIRECT, countedQty: 3, effectiveQty: 3, systemQty: 5 },
      { sku: 'S-MULTI', ...DIRECT, countedQty: 55, effectiveQty: 55, systemQty: 60 },
      { sku: 'S-NORM', ...DIRECT, countedQty: 12, effectiveQty: 12, systemQty: 10 },
    ]);
    const B = await bootJoinCount(browser, { role: 'pharmacist', user: 'PharmB', mode: 'desktop', expectEpoch: A.epoch });
    for (const m of [A, B]) {
      // เปิดป็อปอัพ = ดึง LOT/ราคาจาก Supabase จริง (นอก 127.0.0.1 → isolation tripwire) — ไม่ใช่สิ่งที่เทสนี้ตรวจ จึงปิดไว้
      // ตัวอ่านผล ERP (_loadAdjErpFromCloud → emulator) ไม่ถูกปิด = เส้นทางที่ตรวจจริง
      await m.page.evaluate(() => { _refreshAdjMaster = async () => {}; });
      await m.page.waitForFunction(() => ['S-F05', 'S-MULTI', 'S-NORM'].every((s) => state.scanData.get(s)?.status === 'stock_adjustment'), null, { timeout: 20000, polling: 100 });
      expect(await states(m.page, 'ords')).toEqual({ 'S-F05': null, 'S-MULTI': null });   // ยังไม่มีใครแนบ
    }

    // A แนบ R16.104 → doc บน cloud ผูกรอบนี้ · ใบของคลังชากค้อไม่ถูกเก็บ
    await A.page.evaluate(() => openAdjustDocPopup());
    await upload(A.page, 'R16.104.CSV', R16_104_V1);
    await waitForDoc(PROJECT_ID, 'stock_sessions/SRC_adjerp', (d) => d && d.countResetAt === A.epoch);
    expect(await docOf()).toEqual({ epoch: A.epoch, by: 'PharmA', docs: ['ORDSBY901', 'ORDSBY902'], cover: ['ORDS'] });
    expect(await states(A.page, 'ords')).toEqual({ 'S-F05': 'done 2/2', 'S-MULTI': 'partial 3/5' });
    expect(await A.page.evaluate(() => _adjErp.localOnly)).toBe(false);

    // B เปิดป็อปอัพ → อ่านจาก cloud → เห็นสถานะเดียวกันบนตาราง
    await B.page.evaluate(() => openAdjustDocPopup());
    await B.page.waitForFunction(() => _adjErpCovered('ORDS'), null, { timeout: 20000, polling: 100 });
    expect(await states(B.page, 'ords')).toEqual({ 'S-F05': 'done 2/2', 'S-MULTI': 'partial 3/5' });
    expect(await cellText(B.page, 'S-F05')).toBe('✅ เข้าแล้ว');
    expect(await cellText(B.page, 'S-MULTI')).toBe('⚠️ บางส่วน 3/5');

    // แนบพร้อมกัน: A = R16.104 รุ่นใหม่ (ORDS) · B = R16.103 (IRPS) → transaction รวมกัน ไม่มีชนิดไหนหาย
    await Promise.all([upload(A.page, 'R16.104-v2.CSV', R16_104_V2), upload(B.page, 'R16.103.CSV', R16_103)]);
    await waitForDoc(PROJECT_ID, 'stock_sessions/SRC_adjerp', (d) => d && JSON.parse(d.cover_json).IRPS && JSON.parse(d.docs_json).some((x) => x.no === 'ORDSBY903'));
    expect(await docOf()).toMatchObject({ epoch: A.epoch, docs: ['IRPSBY901', 'ORDSBY901', 'ORDSBY902', 'ORDSBY903'], cover: ['IRPS', 'ORDS'] });

    // ทั้งสองเครื่องเปิดใหม่ → เห็นครบทั้ง ORDS และ IRPS
    for (const m of [A, B]) {
      await m.page.evaluate(() => openAdjustDocPopup());
      await m.page.waitForFunction(() => _adjErpCovered('ORDS') && _adjErpCovered('IRPS') && _adjErpCurrent().docs.ORDSBY903, null, { timeout: 20000, polling: 100 });
      expect(await states(m.page, 'ords')).toEqual({ 'S-F05': 'done 2/2', 'S-MULTI': 'done 5/5' });
      expect(await states(m.page, 'irps')).toEqual({ 'S-NORM': 'done 2/2' });
    }

    // เริ่มรอบนับใหม่ที่ A → ผลรอบเก่าบน cloud ไม่ถูกใช้ (doc ยังอยู่แต่คนละรอบ)
    await A.page.evaluate(async () => { const orig = window.prompt; window.prompt = () => CLEAR_PIN; try { await startNewCount(); } finally { window.prompt = orig; } });
    const newEpoch = await A.page.evaluate(() => _countResetAt);
    expect(newEpoch).not.toBe(A.epoch);
    await A.page.evaluate(() => _loadAdjErpFromCloud());
    expect(await A.page.evaluate(() => _adjErpCurrent())).toBeNull();
    expect((await docOf()).epoch).toBe(A.epoch);

    await closeApp(B);
    await closeApp(A);
  });
});
