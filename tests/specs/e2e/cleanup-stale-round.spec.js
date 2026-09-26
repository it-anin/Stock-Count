// tools/cleanup-stale-round-items.js — สคริปต์ Console ที่ลบข้อมูลจริงบน production จึงต้องพิสูจน์ก่อนใช้ว่า
//   ① ลบเฉพาะเอกสารรอบที่ "เก่ากว่า" รอบปัจจุบัน · ไม่แตะรอบปัจจุบัน · รอบใหม่กว่า/แปลกแค่รายงาน
//   ② คืนเฉพาะรายการรอบนี้ที่สถานะ Confirm แล้วแต่เวลานับเก่ากว่าตอนเริ่มรอบ · scanning ไม่แตะ · pass ของจริงไม่แตะ
//   และ dry-run ไม่เขียนอะไรเลย · ลบจริงต้องพิมพ์ยืนยัน + ดาวน์โหลดสำเนาก่อนลบ
const fs = require('fs');
const path = require('path');
const { test, expect, closeApp, requireEmulator } = require('../../lib/hooks');
const { bootFreshCount, PROJECT_ID } = require('../../lib/scenario');
const { seedItems } = require('../../lib/seed');
const { getDoc, setDoc } = require('../../lib/emulator');

const TOOL = fs.readFileSync(path.join(__dirname, '../../../tools/cleanup-stale-round-items.js'), 'utf8');
const DIAG = fs.readFileSync(path.join(__dirname, '../../../tools/diagnose-reset-resurrect.js'), 'utf8');
const OLD_EPOCH = '2026-07-19T02:39:21.626Z';
const FUTURE_EPOCH = '2099-01-01T00:00:00.000Z';
const ITEM = (sku) => `stock_sessions/SRC/items/${sku}`;

function nowTs() {
  const d = new Date(); const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
const exists = async (sku) => !!(await getDoc(PROJECT_ID, ITEM(sku)));

test.describe('tools/cleanup-stale-round-items.js', () => {
  test.beforeEach(() => requireEmulator());
  test.setTimeout(90_000);

  test('dry-run writes nothing · ① deletes only older-round docs · ② resets only resurrected confirmed items', async ({ browser }) => {
    const a = await bootFreshCount(browser, { role: 'pharmacist', user: 'Desk-A', mode: 'desktop' });
    const ts = nowTs();
    const old = { firstScanAt: '2026-07-19 09:53:24', timestamp: '2026-07-19 09:53:25' };
    // เศษรอบเก่า 3 ตัว (ต้องถูกลบ) + รอบที่ใหม่กว่าปัจจุบัน 1 ตัว (ห้ามลบ แค่รายงาน)
    await seedItems(PROJECT_ID, 'SRC', OLD_EPOCH, [
      { sku: 'S-F01', status: 'pass', initialStatus: 'pass', auditStatus: 'approved', countedQty: 1, ...old },
      { sku: 'S-F02', status: 'scanning', auditStatus: 'pending', countedQty: 2, ...old },
      { sku: 'S-F03', status: 'stock_adjustment', initialStatus: 'audit', auditStatus: 'stock_adjustment', auditor: 'Ph', countedQty: 3, ...old },
    ]);
    await seedItems(PROJECT_ID, 'SRC', FUTURE_EPOCH, [{ sku: 'S-F04', status: 'scanning', countedQty: 4, firstScanAt: ts, timestamp: ts }]);
    // รอบปัจจุบัน: scanning จริง · pass ที่ถูกเขียนกลับ (เวลาเก่าทั้งคู่) · pass จริง · scanning ที่เวลาสแกนครั้งแรกเก่า
    // + เคสจริง SRC 26 ก.ย. (800424/600677): โดนดึงผลเก่า → ✕ → สแกนใหม่ → Confirm ในรอบนี้
    //   = firstScanAt ค้างเป็นวันรอบเก่า (✕ ไม่ล้าง) แต่ timestamp/ยอด/สถานะเป็นของรอบนี้ → ห้ามลบ
    // + Audit ที่อยู่ใน marker รอบนี้ → ห้ามลบ (marker จะสร้างกลับอยู่ดี)
    await seedItems(PROJECT_ID, 'SRC', a.epoch, [
      { sku: 'S-F05', status: 'scanning', countedQty: 5, firstScanAt: ts, timestamp: ts },
      { sku: 'S-F06', status: 'pass', initialStatus: 'pass', auditStatus: 'approved', countedQty: 6, ...old, rev: 2 },
      { sku: 'S-F07', status: 'pass', initialStatus: 'pass', auditStatus: 'approved', countedQty: 7, firstScanAt: ts, timestamp: ts },
      { sku: 'S-F08', status: 'scanning', countedQty: 3, firstScanAt: '2026-07-19 10:15:52', timestamp: ts, rev: 6 },
      { sku: 'S-F09', status: 'pass', initialStatus: 'pass', auditStatus: 'approved', countedQty: 3, firstScanAt: '2026-07-19 10:15:52', timestamp: ts, rev: 7 },
      { sku: 'S-CATA', status: 'audit', initialStatus: 'audit', auditStatus: 'pending', countedQty: 5, firstScanAt: '2026-08-09 14:46:19', timestamp: '2026-08-09 14:46:20', rev: 7 },
    ]);
    const iso = new Date().toISOString();
    await setDoc(PROJECT_ID, 'stock_sessions/SRC_pharmacy_audit_markers', {
      branch: 'SRC', countResetAt: a.epoch,
      items: { 'S-CATA': { countResetAt: a.epoch, status: 'audit', auditStatus: 'pending', initialStatus: 'audit', auditor: '', countedQty: 5,
        scannedBy: 'Seeder', firstScanAt: '2026-08-09 14:46:19', countTimestamp: '2026-08-09 14:46:20', timestamp: '2026-08-09 14:46:20',
        confirmedAt: iso, countConfirmedAt: iso } },
    }, { merge: false });

    await a.page.addScriptTag({ content: TOOL });
    await a.page.addScriptTag({ content: DIAG });
    // ลบจริงต้องพิมพ์ยืนยัน + ดาวน์โหลดสำเนา — จับทั้งสองอย่างไว้ตรวจ (ไม่ให้เบราว์เซอร์เทสดาวน์โหลดไฟล์จริง)
    await a.page.evaluate(() => {
      window.__downloads = [];
      window.__promptReply = null;
      window.prompt = () => window.__promptReply;
      const click = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function () { if (this.download) { window.__downloads.push(this.download); return; } return click.call(this); };
    });

    // ① dry-run: รายงานถูก แต่ไม่ลบอะไร
    const dry1 = await a.page.evaluate(() => cleanupStaleRoundItems());
    expect(dry1.staleCount).toBe(3);
    expect(dry1.otherCount).toBe(1);
    expect(dry1.byStatus).toEqual({ pass: 1, scanning: 1, stock_adjustment: 1 });
    for (const s of ['S-F01', 'S-F02', 'S-F03', 'S-F04']) expect(await exists(s)).toBe(true);

    // ① ยืนยันผิด = ยกเลิก ไม่ลบ
    await a.page.evaluate(() => { window.__promptReply = 'ลบ 999'; });
    await a.page.evaluate(() => cleanupStaleRoundItems({ dryRun: false }));
    expect(await exists('S-F01')).toBe(true);

    // ① ลบจริง
    await a.page.evaluate(() => { window.__promptReply = 'ลบ 3'; });
    const real1 = await a.page.evaluate(() => cleanupStaleRoundItems({ dryRun: false }));
    expect(real1.deleted).toBe(3);
    expect(real1.skipped).toBe(0);
    for (const s of ['S-F01', 'S-F02', 'S-F03']) expect(await exists(s)).toBe(false);
    expect(await exists('S-F04')).toBe(true);                       // รอบใหม่กว่า → ไม่ลบ
    for (const s of ['S-F05', 'S-F06', 'S-F07', 'S-F08', 'S-F09', 'S-CATA']) expect(await exists(s)).toBe(true); // รอบปัจจุบันไม่ถูกแตะ
    expect(await a.page.evaluate(() => window.__downloads.length)).toBe(1); // สำเนาก่อนลบ

    // ② dry-run: เจอเฉพาะ S-F06 · S-F09 (สแกนในรอบนี้) กับ S-CATA (อยู่ใน marker) ถูกรายงานว่า "ไม่แตะ"
    const dry2 = await a.page.evaluate(() => resetResurrectedItems());
    expect(dry2.skus).toEqual(['S-F06']);
    expect(dry2.keptSkus).toEqual(['S-CATA', 'S-F09']);
    expect(await exists('S-F06')).toBe(true);

    // สคริปต์ตรวจผลต้องใช้เกณฑ์เดียวกัน — ไม่งั้นหลังคืนแล้วจะยังฟ้องว่ามี "ของรอบเก่า" ทั้งที่เป็นงานจริง
    const diagBefore = await a.page.evaluate(() => diagnoseReset());
    expect(diagBefore.currentRoundItems.oldCount).toBe(1);
    expect([...diagBefore.currentRoundItems.staleFirstScanOnly].sort()).toEqual(['S-CATA', 'S-F08', 'S-F09']);
    // ตารางไล่เฉพาะตัวน่าสงสัย — รายการที่ Confirm แล้วทั้งในจอและบน Cloud รอบนี้ (S-F07/S-F09/S-CATA) ต้องไม่ถูกฟ้องว่า
    // "มีเฉพาะในจอนี้" หรือ "มาจาก marker" (รุ่นแรกตัดที่ 100 ตัวรวมของรอบนี้ แล้วฟ้องผิด 169+13 รายการบน production)
    expect(diagBefore.rows.map((r) => [r.SKU, r['อยู่ที่']])).toEqual([['S-F06', 'items รอบนี้']]);

    // ② ลบจริง
    await a.page.evaluate(() => { window.__promptReply = 'คืน 1'; });
    const real2 = await a.page.evaluate(() => resetResurrectedItems({ dryRun: false }));
    expect(real2.deleted).toBe(1);
    expect(await exists('S-F06')).toBe(false);
    // scanning / pass จริง / scanning เวลาเก่า / Confirm ในรอบนี้แต่เวลาสแกนครั้งแรกค้าง / อยู่ใน marker
    for (const s of ['S-F05', 'S-F07', 'S-F08', 'S-F09', 'S-CATA']) expect(await exists(s)).toBe(true);
    expect(await a.page.evaluate(() => window.__downloads.length)).toBe(2);
    const diagAfter = await a.page.evaluate(() => diagnoseReset());
    expect(diagAfter.currentRoundItems.oldCount).toBe(0);
    expect(diagAfter.rows).toEqual([]);   // ไม่เหลือตัวน่าสงสัย = บรรทัดสรุปขึ้น "ไม่พบรายการรอบเก่าค้างอยู่ในรอบนี้"

    await closeApp(a);
  });
});
