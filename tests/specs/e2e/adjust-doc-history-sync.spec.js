// ใบ 📦 🗂️ ประวัติปรับปรุง — เส้นทางจริงบน emulator สองเครื่อง (7 ต.ค. 2026)
//   เภสัช Desktop A กด Export Text → กรอกเลขที่เอกสาร → stock_sessions/SRC_adjhist (ผูก countResetAt) → เภสัช Desktop B เปิดป็อปอัพเห็นแถวหายจากตาราง + เห็นเอกสาร
//   → A กับ B กด Export "หน้าเดียวกัน" พร้อมกัน → transaction ให้ผ่านแค่เครื่องเดียว อีกเครื่องถูกบล็อก (ไม่ดาวน์โหลด · ตารางอัปเดตตาม cloud)
//   → A กด ↩ คืนรายการ → B เปิดใหม่เห็นแถวกลับมา → เริ่มรอบนับใหม่ → ประวัติรอบเก่าไม่ถูกใช้
// logic ล้วน (คีย์ซ่อนแถว · modal · atomic · WH · ทางถอย) อยู่ที่ specs/logic/adjust-doc-history.spec.js
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
});
