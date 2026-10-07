// ใบ 📦 🗂️ ประวัติปรับปรุง — เส้นทางจริงบน emulator สองเครื่อง (7 ต.ค. 2026)
//   เภสัช Desktop A กด Export Text → กรอกเลขที่เอกสาร → stock_sessions/SRC_adjhist (ผูก countResetAt) → เภสัช Desktop B เปิดป็อปอัพเห็นแถวหายจากตาราง + เห็นเอกสาร
//   → A กับ B กด Export "หน้าเดียวกัน" พร้อมกัน → transaction ให้ผ่านแค่เครื่องเดียว อีกเครื่องถูกบล็อก (ไม่ดาวน์โหลด · ตารางอัปเดตตาม cloud)
//   → A กด ↩ คืนรายการ → B เปิดใหม่เห็นแถวกลับมา → เริ่มรอบนับใหม่ → ประวัติรอบเก่าไม่ถูกใช้
// + 📥 นำเข้าประวัติจาก ERP (R16.104/R16.103): A นำเข้า → cloud → B เห็น 📥 ERP · ไม่ซ่อนแถวบนใบ · สองเครื่องนำเข้าคนละไฟล์พร้อมกันไม่หาย · รอบใหม่ว่าง
// logic ล้วน (คีย์ซ่อนแถว · modal · atomic · WH · ทางถอย) อยู่ที่ specs/logic/adjust-doc-history.spec.js · นำเข้า: specs/logic/adjust-doc-history-import.spec.js
// ใช้ SKU จาก catalog สังเคราะห์ (S-F01…S-F05) + ตั้งขนาดหน้าเป็น 2 แถว เพื่อให้มีหลายหน้าโดยไม่ต้องมีสินค้า 20+ ตัว
const { test, expect, closeApp, requireEmulator } = require('../../lib/hooks');
const { bootFreshCount, bootJoinCount, PROJECT_ID } = require('../../lib/scenario');
const { waitForDoc, getDoc } = require('../../lib/emulator');
const { seedItems } = require('../../lib/seed');

// Stock Adj ตรงที่แช่เลขตอน Confirm: ทุก SKU ขาด 2 (ระบบ 10 · นับ 8) → ORDS ทั้งหมด
const DIRECT = { status: 'stock_adjustment', auditStatus: 'stock_adjustment', initialStatus: 'stock_adjustment', auditor: '', directAdj: true, scannedBy: 'PDA-A', countedQty: 8, effectiveQty: 8, systemQty: 10 };
const SKUS = ['S-F01', 'S-F02', 'S-F03', 'S-F04', 'S-F05'];
const ids = (a, b) => SKUS.slice(a - 1, b);

const prep = async (m) => {
  // เปิดป็อปอัพ = ดึง LOT/ราคาจาก Supabase จริง (นอก 127.0.0.1 → isolation tripwire) — ไม่ใช่สิ่งที่เทสนี้ตรวจ จึงปิดไว้
  // ตัวอ่านประวัติ (_loadAdjHistFromCloud → emulator) ไม่ถูกปิด = เส้นทางที่ตรวจจริง
  await m.page.evaluate(() => {
    _refreshAdjMaster = async () => {};
    ADJUST_DOC_PAGE_SIZE = 2;
    window.__exports = []; window.__downloads = [];
    URL.createObjectURL = (b) => { window.__exports.push(b); return 'blob:captured'; };
    URL.revokeObjectURL = () => {};
    HTMLAnchorElement.prototype.click = function () { window.__downloads.push(this.download); };
  });
  await m.page.waitForFunction((skus) => skus.every((s) => state.scanData.get(s)?.status === 'stock_adjustment' && state.skuMap.has(s)), SKUS, { timeout: 20000, polling: 100 });
};
const tableSkus = (page) => page.evaluate(() => [...document.querySelectorAll('#adjustDocBody tr')].filter((tr) => tr.children.length > 1).map((tr) => tr.children[1].textContent.trim()));
const openPopup = async (page) => { await page.evaluate(() => openAdjustDocPopup()); await page.waitForFunction(() => document.getElementById('adjustDocPopupOverlay').style.display === 'flex', null, { timeout: 5000, polling: 50 }); };
const doExport = async (page, no) => {
  await page.evaluate(() => document.getElementById('adjExportTextBtn').click());
  await page.evaluate((no) => { const i = document.getElementById('adjDocNoInput'); i.value = no; i.dispatchEvent(new Event('input', { bubbles: true })); }, no);
  await page.evaluate(async () => { await confirmAdjDocNo(); });
};
const histDoc = async () => {
  const d = await getDoc(PROJECT_ID, 'stock_sessions/SRC_adjhist');
  return d && { epoch: d.countResetAt, by: d.updatedBy, entries: JSON.parse(d.entries_json).map((e) => [e.no, e.dir, e.by, e.rows.map((r) => r[0])]) };
};
const badge = (page) => page.evaluate(() => document.getElementById('adjustDocCount').textContent);
// R16 สังเคราะห์ (หัว 40 คอลัมน์ตามไฟล์จริง · ข้อมูลสมมติ) — SRC = SYSBRANCHID 0 + SYSWAREHOUSEID 1 (หน้าร้าน) · วันที่ = วันนี้ (ต้องไม่ก่อนวันเริ่มรอบ)
const HDR = ['SYSWAREHOUSEID', 'TRANDATE', 'TRANNO', 'REFERENCENO1', 'SYSVOUCHERID', 'SYSSALEID', 'TOTAL', 'TOTALVAT', 'GRANDTOTAL', 'FCANCEL', 'TAXRATE', 'SYSPERSONID', 'SYSBRANCHID', 'FPROCESS', 'SCANCODE', 'ITEMNAME', 'SYSUNITID', 'BASEQUANTITY', 'QUANTITY', 'SYSITEMID', 'PRICE', 'AMOUNT', 'DETAILNO', 'ITEMID', 'ITEMNAME', 'TOTALTRADDISCHAVEVAT', 'TOTALTRADDISCNONEVAT', 'FSTOCKMAIN', 'FMLDISCOUNTITEM', 'FMLDISCOUNTROW', 'DISCOUNTPROMOTION', 'NAME', 'EMPID', 'CF_UNITNAME', 'CF_COMPANY', 'FNAME', 'CF_TRANEXTRAINFO_PRENAME', 'CF_TRANEXTRAINFO_FNAME', 'CF_TRANEXTRAINFO_LNAME', 'CF_TRANDATE'];
const now = new Date();
const TODAY = `${now.getDate()}/${now.getMonth() + 1}/${now.getFullYear()}`;
function r16Line({ time, no, sku, qty }) {
  const r = Array(HDR.length).fill('');
  r[0] = '1'; r[1] = `${TODAY} ${time}`; r[2] = no; r[9] = '0'; r[12] = '0'; r[17] = String(qty); r[23] = sku; r[31] = 'สาขาทดสอบ SRC';
  return r;
}
const r16 = (lines) => [HDR, ...lines].map((r) => r.join(',')).join('\r\n');
const R16_ORDS_1 = r16([r16Line({ time: '10:00:00', no: 'ORDSIMP001', sku: 'S-F01', qty: 2 }), r16Line({ time: '10:00:00', no: 'ORDSIMP001', sku: 'S-F02', qty: 2 })]);   // ขนาดเดียวกับแถวบนใบ (ขาด 2) — ต้องไม่ซ่อนแถว
const R16_ORDS_2 = r16([r16Line({ time: '11:00:00', no: 'ORDSIMP002', sku: 'S-F05', qty: 7 })]);
const R16_IRPS = r16([r16Line({ time: '09:30:00', no: 'IRPSIMP001', sku: 'S-F03', qty: 1 })]);
const importOn = (m, specs) => m.page.evaluate(async (specs) => {   // เลือกไฟล์ → ตัวอย่าง (modal เปิด) — ยังไม่เขียน cloud
  await handleAdjHistImportFiles({ target: { files: specs.map(([n, t]) => new File([t], n, { type: 'text/csv' })) } });
}, specs);
const confirmOn = (m) => m.page.evaluate(async () => { await confirmAdjHistImport(); });
const histRaw = async () => { const d = await getDoc(PROJECT_ID, 'stock_sessions/SRC_adjhist'); return d && { epoch: d.countResetAt, entries: JSON.parse(d.entries_json).map((e) => [e.no, e.dir, e.src || 'app', e.rows.map((r) => r[0] + ':' + r[1]).join(',')]) }; };
const histRows = (page) => page.evaluate(() => [...document.querySelectorAll('#adjHistBody > tr[data-no]')].map((tr) => [...tr.children].map((td) => td.textContent.replace(/\s+/g, ' ').trim()).slice(0, 6)));

test.describe('ใบ 📦 — ประวัติปรับปรุงซิงก์ข้ามเครื่อง', () => {
  test.beforeEach(() => requireEmulator());
  test.setTimeout(150_000);

  test('A ส่งออก → cloud → B เห็นแถวหาย+เห็นเอกสาร · ส่งหน้าเดียวกันพร้อมกันผ่านแค่เครื่องเดียว · ↩ คืนรายการข้ามเครื่อง · รอบนับใหม่ไม่ใช้ผลเก่า', async ({ browser }) => {
    const A = await bootFreshCount(browser, { role: 'pharmacist', user: 'PharmA', mode: 'desktop' });
    await seedItems(PROJECT_ID, 'SRC', A.epoch, SKUS.map((sku) => ({ sku, ...DIRECT })));
    const B = await bootJoinCount(browser, { role: 'pharmacist', user: 'PharmB', mode: 'desktop', expectEpoch: A.epoch });
    for (const m of [A, B]) await prep(m);

    // A เปิดป็อปอัพ → 5 แถว ORDS (หน้าละ 2) · ยังไม่มีประวัติ
    await openPopup(A.page);
    expect(await tableSkus(A.page)).toEqual(ids(1, 2));
    expect(await histDoc()).toBeNull();

    // A กด Export Text → modal → กรอก → cloud มีเอกสาร · A เห็นแถวหาย
    await doExport(A.page, 'ordsa001');
    await waitForDoc(PROJECT_ID, 'stock_sessions/SRC_adjhist', (d) => d && d.countResetAt === A.epoch);
    expect(await histDoc()).toEqual({ epoch: A.epoch, by: 'PharmA', entries: [['ORDSA001', 'ords', 'PharmA', ids(1, 2)]] });
    expect(await tableSkus(A.page)).toEqual(ids(3, 4));
    expect(await A.page.evaluate(() => window.__downloads)).toHaveLength(1);
    expect(await badge(A.page)).toBe('3');                                                  // ป้ายปุ่ม 📦 ลดตาม (5 − 2)

    // B เปิดป็อปอัพ → อ่านจาก cloud → ตารางเห็นแถวที่เหลือ (ไม่ใช่ 5 แถว) · ปุ่มประวัติแสดง 1 เอกสาร
    await openPopup(B.page);
    await B.page.waitForFunction(() => _adjHistEntries().length === 1, null, { timeout: 20000, polling: 100 });
    expect(await tableSkus(B.page)).toEqual(ids(3, 4));
    expect(await B.page.evaluate(() => document.getElementById('adjHistCount').textContent)).toBe('1');
    expect(await badge(B.page)).toBe('3');

    // ส่งออก "หน้าเดียวกัน" (S-F03, S-F04) พร้อมกันจากสองเครื่อง → transaction ให้ผ่านแค่เครื่องเดียว · อีกเครื่องถูกบล็อก ไม่ดาวน์โหลด
    await Promise.all([doExport(A.page, 'ORDSA002'), doExport(B.page, 'ORDSB002')]);
    await waitForDoc(PROJECT_ID, 'stock_sessions/SRC_adjhist', (d) => d && JSON.parse(d.entries_json).length === 2);
    const doc2 = await histDoc();
    expect(doc2.entries).toHaveLength(2);
    expect(doc2.entries[1][3]).toEqual(ids(3, 4));
    const winner = doc2.entries[1][0] === 'ORDSA002' ? A : B;
    const loser = winner === A ? B : A;
    expect(await winner.page.evaluate(() => window.__downloads)).toHaveLength(winner === A ? 2 : 1);   // A ส่งไปแล้ว 1 ไฟล์ก่อนหน้า
    expect(await loser.page.evaluate(() => window.__downloads)).toHaveLength(loser === A ? 1 : 0);     // แพ้ = ไม่มีไฟล์เพิ่ม
    expect(await tableSkus(loser.page)).toEqual(['S-F05']);                                            // แพ้ → ตารางอัปเดตตาม cloud (แถวนั้นถูกส่งไปแล้ว)
    expect(await tableSkus(winner.page)).toEqual(['S-F05']);
    expect(await loser.page.evaluate(() => document.getElementById('adjDocNoModal').style.display)).toBe('none');   // แถวทับ (overlap) → ปิด modal

    // A คืนรายการของเอกสารแรก → B เปิดป็อปอัพใหม่เห็นแถว S-F01/S-F02 กลับมา · ใช้ ORDSA001 ซ้ำได้
    await A.page.evaluate(async () => { await undoAdjHistEntry('ORDSA001'); });
    await waitForDoc(PROJECT_ID, 'stock_sessions/SRC_adjhist', (d) => d && JSON.parse(d.entries_json).every((e) => e.no !== 'ORDSA001'));
    expect(await tableSkus(A.page)).toEqual(ids(1, 2));
    await openPopup(B.page);
    await B.page.waitForFunction(() => _adjHistEntries().every((e) => e.no !== 'ORDSA001'), null, { timeout: 20000, polling: 100 });
    expect(await tableSkus(B.page)).toEqual(ids(1, 2));

    // เริ่มรอบนับใหม่ที่ A → ประวัติรอบเก่าบน cloud ไม่ถูกใช้ (doc ยังอยู่แต่คนละรอบ)
    await A.page.evaluate(async () => { const orig = window.prompt; window.prompt = () => CLEAR_PIN; try { await startNewCount(); } finally { window.prompt = orig; } });
    const newEpoch = await A.page.evaluate(() => _countResetAt);
    expect(newEpoch).not.toBe(A.epoch);
    await A.page.evaluate(() => _loadAdjHistFromCloud());
    expect(await A.page.evaluate(() => _adjHistEntries())).toEqual([]);
    expect((await histDoc()).epoch).toBe(A.epoch);

    await closeApp(B);
    await closeApp(A);
  });

  test('📥 A นำเข้าประวัติจาก ERP → cloud → B เห็น 📥 ERP · ไม่ซ่อนแถวบนใบ · สองเครื่องนำเข้าคนละไฟล์พร้อมกันไม่หาย · รอบนับใหม่ไม่ใช้ผลเก่า', async ({ browser }) => {
    const A = await bootFreshCount(browser, { role: 'pharmacist', user: 'PharmA', mode: 'desktop' });
    await seedItems(PROJECT_ID, 'SRC', A.epoch, SKUS.map((sku) => ({ sku, ...DIRECT })));
    const B = await bootJoinCount(browser, { role: 'pharmacist', user: 'PharmB', mode: 'desktop', expectEpoch: A.epoch });
    for (const m of [A, B]) await prep(m);
    await openPopup(A.page); await openPopup(B.page);
    expect(await tableSkus(A.page)).toEqual(ids(1, 2));
    expect(await badge(A.page)).toBe('5');

    // A นำเข้า ORDS 1 ใบ (S-F01 ×2 · S-F02 ×2 = ขนาดเดียวกับแถวบนใบ) → ดูตัวอย่างก่อน (ยังไม่เขียน cloud) → ยืนยัน
    await importOn(A, [['16104ords.CSV', R16_ORDS_1]]);
    expect(await A.page.evaluate(() => document.getElementById('adjHistImportModal').style.display)).toBe('flex');
    expect(await histRaw()).toBeNull();
    await confirmOn(A);
    await waitForDoc(PROJECT_ID, 'stock_sessions/SRC_adjhist', (d) => d && d.countResetAt === A.epoch && JSON.parse(d.entries_json).length === 1);
    expect(await histRaw()).toEqual({ epoch: A.epoch, entries: [['ORDSIMP001', 'ords', 'erp', 'S-F01:2,S-F02:2']] });
    expect(await tableSkus(A.page)).toEqual(ids(1, 2));                                  // ประวัติอย่างเดียว — แถวบนใบไม่หาย
    expect(await badge(A.page)).toBe('5');

    // B เปิด 🗂️ → อ่านจาก cloud → เห็นเอกสารที่ A นำเข้า (📥 ERP · เข้าระบบแล้ว) · ตารางของ B ไม่เปลี่ยน
    await B.page.evaluate(() => openAdjHistPopup());
    await B.page.waitForFunction(() => _adjHistEntries().length === 1, null, { timeout: 20000, polling: 100 });
    expect(await histRows(B.page)).toEqual([['▸ ORDSIMP001', '🔻 ORDS', expect.stringMatching(/^\d{2}\/\d{2}\/\d{4} 10:00$/), '📥 ERP', '2', 'เข้าระบบแล้ว']]);
    expect(await tableSkus(B.page)).toEqual(ids(1, 2));
    expect(await badge(B.page)).toBe('5');

    // B นำเข้าไฟล์เดิมซ้ำ → ไม่มีเอกสารใหม่ (อ่านจาก cloud แล้ว) · ปุ่มทำหน้าที่ "ปิด"
    await importOn(B, [['again.CSV', R16_ORDS_1]]);
    expect(await B.page.evaluate(() => document.getElementById('adjHistImportOk').textContent)).toBe('ปิด');
    await B.page.evaluate(() => closeAdjHistImportModal());

    // สองเครื่องนำเข้า "คนละไฟล์" พร้อมกัน → transaction รวมกัน ไม่มีเอกสารไหนหาย
    await importOn(A, [['16103irps.CSV', R16_IRPS]]);
    await importOn(B, [['16104ords2.CSV', R16_ORDS_2]]);
    await Promise.all([confirmOn(A), confirmOn(B)]);
    await waitForDoc(PROJECT_ID, 'stock_sessions/SRC_adjhist', (d) => d && JSON.parse(d.entries_json).length === 3);
    expect((await histRaw()).entries.map((e) => e[0]).sort()).toEqual(['IRPSIMP001', 'ORDSIMP001', 'ORDSIMP002']);

    // เปิดใหม่ทั้งสองเครื่อง → เห็นครบ 3 เอกสาร · แถวบนใบยังครบ (นำเข้าไม่ซ่อนแถว)
    for (const m of [A, B]) {
      await m.page.evaluate(() => openAdjHistPopup());
      await m.page.waitForFunction(() => _adjHistEntries().length === 3, null, { timeout: 20000, polling: 100 });
      expect(await tableSkus(m.page)).toEqual(ids(1, 2));
    }
    // 🗑 ลบเอกสารที่นำเข้า (A) → B โหลดใหม่ไม่เห็น · ตารางไม่เปลี่ยน
    await A.page.evaluate(async () => { await undoAdjHistEntry('IRPSIMP001'); });
    await waitForDoc(PROJECT_ID, 'stock_sessions/SRC_adjhist', (d) => d && JSON.parse(d.entries_json).length === 2);
    await B.page.evaluate(() => _loadAdjHistFromCloud());
    await B.page.waitForFunction(() => _adjHistEntries().length === 2, null, { timeout: 20000, polling: 100 });
    expect(await tableSkus(B.page)).toEqual(ids(1, 2));

    // เริ่มรอบนับใหม่ที่ A → ประวัติที่นำเข้าในรอบเก่าไม่ถูกใช้ (doc ยังอยู่แต่คนละรอบ)
    await A.page.evaluate(async () => { const orig = window.prompt; window.prompt = () => CLEAR_PIN; try { await startNewCount(); } finally { window.prompt = orig; } });
    await A.page.evaluate(() => _loadAdjHistFromCloud());
    expect(await A.page.evaluate(() => _adjHistEntries())).toEqual([]);
    expect((await histRaw()).epoch).toBe(A.epoch);

    await closeApp(B);
    await closeApp(A);
  });
});
