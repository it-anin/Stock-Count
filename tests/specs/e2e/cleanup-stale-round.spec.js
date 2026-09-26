// tools/cleanup-stale-round-items.js — สคริปต์ Console ที่ลบข้อมูลจริงบน production จึงต้องพิสูจน์ก่อนใช้ว่า
//   ① ลบเฉพาะเอกสารรอบที่ "เก่ากว่า" รอบปัจจุบัน · ไม่แตะรอบปัจจุบัน · รอบใหม่กว่า/แปลกแค่รายงาน
//   ② คืนเฉพาะรายการรอบนี้ที่สถานะ Confirm แล้วแต่เวลานับเก่ากว่าตอนเริ่มรอบ · scanning ไม่แตะ · pass ของจริงไม่แตะ
//   และ dry-run ไม่เขียนอะไรเลย · ลบจริงต้องพิมพ์ยืนยัน + ดาวน์โหลดสำเนาก่อนลบ
const fs = require('fs');
const path = require('path');
const { test, expect, closeApp, requireEmulator } = require('../../lib/hooks');
const { bootFreshCount, PROJECT_ID } = require('../../lib/scenario');
const { seedItems } = require('../../lib/seed');
const { getDoc } = require('../../lib/emulator');

const TOOL = fs.readFileSync(path.join(__dirname, '../../../tools/cleanup-stale-round-items.js'), 'utf8');
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
    // รอบปัจจุบัน: scanning จริง · pass ที่ถูกเขียนกลับ (เวลานับเก่า) · pass จริง · scanning ที่เวลานับเก่า (แบบ 800424)
    await seedItems(PROJECT_ID, 'SRC', a.epoch, [
      { sku: 'S-F05', status: 'scanning', countedQty: 5, firstScanAt: ts, timestamp: ts },
      { sku: 'S-F06', status: 'pass', initialStatus: 'pass', auditStatus: 'approved', countedQty: 6, ...old, rev: 2 },
      { sku: 'S-F07', status: 'pass', initialStatus: 'pass', auditStatus: 'approved', countedQty: 7, firstScanAt: ts, timestamp: ts },
      { sku: 'S-F08', status: 'scanning', countedQty: 3, firstScanAt: '2026-07-19 10:15:52', timestamp: ts, rev: 6 },
    ]);

    await a.page.addScriptTag({ content: TOOL });
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
    for (const s of ['S-F05', 'S-F06', 'S-F07', 'S-F08']) expect(await exists(s)).toBe(true); // รอบปัจจุบันไม่ถูกแตะ
    expect(await a.page.evaluate(() => window.__downloads.length)).toBe(1); // สำเนาก่อนลบ

    // ② dry-run: เจอเฉพาะ S-F06
    const dry2 = await a.page.evaluate(() => resetResurrectedItems());
    expect(dry2.skus).toEqual(['S-F06']);
    expect(await exists('S-F06')).toBe(true);

    // ② ลบจริง
    await a.page.evaluate(() => { window.__promptReply = 'คืน 1'; });
    const real2 = await a.page.evaluate(() => resetResurrectedItems({ dryRun: false }));
    expect(real2.deleted).toBe(1);
    expect(await exists('S-F06')).toBe(false);
    for (const s of ['S-F05', 'S-F07', 'S-F08']) expect(await exists(s)).toBe(true); // scanning / pass จริง / scanning เวลาเก่า
    expect(await a.page.evaluate(() => window.__downloads.length)).toBe(2);

    await closeApp(a);
  });
});
