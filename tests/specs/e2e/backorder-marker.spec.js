// "ค้างส่ง" ผ่านเส้นทางยืนยันจริง (_confirmPharmacyAuditBatched) — ต้องจบเป็น Pass และไม่เข้าใบ ORDS/IRPS (19 ต.ค. 2026)
//
// บั๊กเดิม: marker ผลสุดท้ายตัดสินด้วยสูตร (นับ+R16 == ระบบ) โดยไม่ดูธง backorder → ค้างส่ง (นับ 0 vs ระบบติดลบ) ได้ stock_adjustment
//   แล้ว _applyPharmacyAuditMarkersToState ทับ pass ในเครื่องด้วย marker → รายการกลับเข้าใบ IRPS (ผลจริงที่วัดได้ก่อนแก้: item=stock_adjustment
//   · marker=stock_adjustment · IRPS +3) · backorder-mark.spec.js เรียกแค่ confirmAuditVerifyItem ตรงๆ จึงไม่เห็น
//
// เทสนี้ตรึง 4 ด้าน:
//   1. ค้างส่งที่มาร์คแล้วยืนยัน → item + marker บน Cloud เป็น pass · ธง backorder อยู่ · ไม่มีแถวในใบ
//   2. ติดลบที่ "ไม่ได้มาร์ค" (รีเช็คได้ 0) → ยังเป็น stock_adjustment และยังเข้าใบ IRPS เหมือนเดิม (ห้ามเหมารวม)
//   3. รายการอื่นใน batch เดียวกันไม่ถูกกระทบ (ตรง → pass · ไม่ตรง → stock_adjustment เข้าใบ ORDS)
//   4. เครื่องที่ล็อกอินทีหลังเห็น pass จาก Cloud (marker ไม่ฟื้นกลับเป็น Stock Adj)
const { test, expect, closeApp, requireEmulator, armDialog } = require('../../lib/hooks');
const { bootFreshCount, bootJoinCount, armR16, PROJECT_ID } = require('../../lib/scenario');
const { waitForDoc, getDoc } = require('../../lib/emulator');
const { seedItems } = require('../../lib/seed');

const nowTs = () => {
  const d = new Date(), p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};
const ITEM = (sku) => `stock_sessions/SRC/items/${sku}`;
const MARKERS = 'stock_sessions/SRC_pharmacy_audit_markers';

async function quiet(page) {
  await page.waitForFunction(() => _dirtySkus.size === 0 && _scanItemInFlight.size === 0 && !_scanItemFlushing, null, { timeout: 20000, polling: 100 });
}

test.describe('ค้างส่ง · ยืนยันผ่าน marker จริง', () => {
  test.beforeEach(() => requireEmulator());
  test.setTimeout(120_000);

  test('ค้างส่ง → pass (item + marker) ไม่เข้าใบ · ติดลบที่ไม่มาร์คยังเข้าใบ · รายการอื่นไม่กระทบ · ล็อกอินทีหลังเห็น pass', async ({ browser }) => {
    const desk = await bootFreshCount(browser, { role: 'pharmacist', user: 'Pharm', mode: 'desktop' });
    await armR16(desk.page);
    const ts = nowTs();
    const audit = (sku, countedQty) => ({ sku, status: 'audit', auditStatus: 'pending', initialStatus: 'audit', countedQty, scannedBy: 'PDA-A', firstScanAt: ts, timestamp: ts });
    // S-NEG ระบบ −3 (มาร์คค้างส่ง) · S-DELCATNEG ระบบ −2 (ติดลบแต่ไม่มาร์ค) · S-NORM ระบบ 10 (รีเช็ค 10 = ตรง) · S-F05 ระบบ 5 (รีเช็ค 4 = ขาด 1)
    const SKUS = ['S-NEG', 'S-DELCATNEG', 'S-NORM', 'S-F05'];
    await seedItems(PROJECT_ID, 'SRC', desk.epoch, [audit('S-NEG', 0), audit('S-DELCATNEG', 0), audit('S-NORM', 8), audit('S-F05', 2)]);
    await desk.page.waitForFunction((skus) => skus.every((s) => state.scanData.get(s)?.status === 'audit'), SKUS, { timeout: 15000, polling: 100 });
    // marker รอรีเช็ค — เหมือนที่ login รอบถัดไปเขียนให้ (backfill จากสถานะในเครื่อง) แล้วรอให้ apply กลับ (ไม่งั้นร่างรีเช็คที่กรอกก่อน marker ถูกทิ้ง)
    await desk.page.evaluate(() => _backfillPharmacyAuditMarkersFromLocal());
    await desk.page.waitForFunction((skus) => skus.every((s) => !!state.scanData.get(s)?.pharmacyAuditCountConfirmedAt), SKUS, { timeout: 20000, polling: 100 });

    armDialog(desk.page, 'y');
    await desk.page.evaluate(() => {
      markBackorderItem('S-NEG');                    // ค้างส่ง
      updatePharmacyRecheckQty('S-DELCATNEG', 0);    // ติดลบเหมือนกัน แต่เภสัชไม่ได้มาร์ค = "รีเช็คได้ 0" ธรรมดา
      updatePharmacyRecheckQty('S-NORM', 10);
      updatePharmacyRecheckQty('S-F05', 4);
      return _flushDirtySkus();
    });
    await waitForDoc(PROJECT_ID, ITEM('S-NEG'), (d) => d && d.backorder === true && d.recheckQty === 0);
    await waitForDoc(PROJECT_ID, ITEM('S-F05'), (d) => d && d.recheckQty === 4);
    await quiet(desk.page);

    await desk.page.evaluate(() => _confirmPharmacyAuditBatched());
    await desk.page.waitForFunction(() => _branchConfirming === false, null, { timeout: 30000, polling: 100 });
    for (const sku of SKUS) await waitForDoc(PROJECT_ID, ITEM(sku), (d) => d && d.auditor === 'Pharm');

    // ① Cloud: item + marker
    const items = {}; for (const sku of SKUS) items[sku] = await getDoc(PROJECT_ID, ITEM(sku));
    const markers = (await getDoc(PROJECT_ID, MARKERS)).items;
    expect(SKUS.map((s) => [s, items[s].status, markers[s].status])).toEqual([
      ['S-NEG', 'pass', 'pass'],                          // ← หัวใจ: เดิมเป็น stock_adjustment ทั้งคู่
      ['S-DELCATNEG', 'stock_adjustment', 'stock_adjustment'],
      ['S-NORM', 'pass', 'pass'],
      ['S-F05', 'stock_adjustment', 'stock_adjustment'],
    ]);
    expect(items['S-NEG']).toMatchObject({ backorder: true, recheckQty: 0, auditor: 'Pharm' });
    expect(markers['S-NEG']).toMatchObject({ backorder: true, auditStatus: 'approved' });
    expect(items['S-DELCATNEG'].backorder).toBeFalsy();

    // ② ในเครื่อง + ใบ 📦: ค้างส่งไม่เข้าใบ · ติดลบที่ไม่มาร์คเข้าใบ IRPS (+2) · ขาดเข้าใบ ORDS (1)
    const local = await desk.page.evaluate(() => ({
      status: state.scanData.get('S-NEG').status, backorder: !!state.scanData.get('S-NEG').backorder,
      ords: _buildAdjustDocRows('ords').map((r) => [r.sku, r.qty]).sort(),
      irps: _buildAdjustDocRows('irps').map((r) => [r.sku, r.qty]).sort(),
    }));
    expect(local).toEqual({ status: 'pass', backorder: true, ords: [['S-F05', 1]], irps: [['S-DELCATNEG', 2]] });

    // ③ เครื่องที่ล็อกอินทีหลัง (restore จาก Cloud + backfill ตอน login) ต้องเห็น pass เหมือนกัน ไม่ถูกฟื้นเป็น Stock Adj
    const late = await bootJoinCount(browser, { role: 'assistant', user: 'PDA-B', mode: 'pda', expectEpoch: desk.epoch });
    await late.page.waitForFunction(() => state.scanData.get('S-NEG')?.status === 'pass' && state.scanData.get('S-DELCATNEG')?.status === 'stock_adjustment', null, { timeout: 20000, polling: 100 });
    const lateSeen = await late.page.evaluate(() => ({ neg: state.scanData.get('S-NEG').status, backorder: !!state.scanData.get('S-NEG').backorder }));
    expect(lateSeen).toEqual({ neg: 'pass', backorder: true });

    await closeApp(late);
    await closeApp(desk);
  });
});
