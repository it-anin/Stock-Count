// บั๊กเดิม (พบ ต.ค. 2026): WH Supervisor Desktop ต้องกด F5 บ่อย เพราะการ์ด Recheck / ประวัติการนับ / ปรับปรุงสินค้า "หาย"
//   การ์ดทั้งสาม (#auditVerifyPanel #historyStatsPanel #adjustDocPanel) เป็น display:none ใน HTML
//   และถูกเปิดโดย selectEmployee() ที่เดียว (updateAuditVerifyPanel / updateHistoryStatsPanel / updateAdjustDocPanel)
//   เส้นทางรีโหลดอัตโนมัติ (stash _autoUpdate — ทั้ง heartbeat ETag และ service worker controllerchange)
//   ตั้ง currentRole เองแล้วเข้า initAfterLogin() โดยไม่เรียกตัวเปิดการ์ด → รีโหลดหลัง deploy ทุกครั้งการ์ดหาย
//
// ⚠️ tests/lib/boot.js ล็อกอินด้วย stash เดียวกันนี้ — เทสอื่นทั้งหมดจึงไม่เคยเห็นการ์ดเหล่านี้ที่ "ล็อกอินปกติ"
//    ไฟล์นี้เป็นตัวเดียวที่ล็อกอินผ่าน UI จริง (สาขา → PIN → ชื่อ) เป็นตัวควบคุม แล้วจำลองรีโหลดแบบเดียวกับ _safeReload(true)
const { test, expect, closeApp, requireEmulator, newAppContext, waitForAppReady } = require('../../lib/hooks');
const { emuPort, clearAll } = require('../../lib/emulator');
const { PROJECT_ID } = require('../../lib/scenario');

const PANELS = ['auditVerifyPanel', 'historyStatsPanel', 'adjustDocPanel'];

async function openApp(browser, opts) {
  const app = await newAppContext(browser, { mode: 'desktop', projectId: PROJECT_ID, firestorePort: emuPort(), ...opts });
  await app.page.goto('/index.html');
  await waitForAppReady(app.page, { login: opts.login !== false });
  return app;
}

test.describe('การ์ด Recheck / ประวัติการนับ / ปรับปรุงสินค้า ต้องไม่หายหลังรีโหลดอัตโนมัติ', () => {
  test.beforeEach(async () => { requireEmulator(); await clearAll(PROJECT_ID); });
  test.setTimeout(120_000);

  test('WH Supervisor: ล็อกอินด้วย UI จริง → การ์ดครบ → รีโหลดอัตโนมัติแบบหลัง deploy → การ์ดต้องยังครบ', async ({ browser }) => {
    const app = await openApp(browser, { branch: 'WH', login: false });
    const { page } = app;

    // ล็อกอินด้วย UI จริง: สาขา → PIN → ชื่อ (อ่าน PIN จากหน้า ไม่ฮาร์ดโค้ดในเทส)
    await page.locator('#branchModal button', { hasText: 'WH' }).click();
    await page.locator('#pinInput').fill(await page.evaluate(() => BRANCH_PINS.WH));
    await page.locator('#pinInput').press('Enter');
    await page.locator('#employeeSupervisorBtns button', { hasText: 'มายด์' }).click();
    await page.waitForFunction(() => currentUser === 'มายด์' && currentRole === 'supervisor', null, { timeout: 15_000, polling: 100 });

    for (const id of PANELS) await expect(page.locator('#' + id), `${id} หลังล็อกอินปกติ`).toBeVisible({ timeout: 10_000 });

    // เหมือน _safeReload(true,…) ใน index.html: stash ผู้ใช้/role แล้ว reload
    await page.evaluate(() => {
      sessionStorage.setItem('_autoUpdateUser', currentUser);
      sessionStorage.setItem('_autoUpdateRole', currentRole || '');
      sessionStorage.setItem('_autoUpdate', '1');
    });
    await page.reload();
    await waitForAppReady(page);
    expect(await page.evaluate(() => currentRole)).toBe('supervisor'); // ยังล็อกอินอยู่จริง ไม่ใช่หลุดไปหน้า login

    for (const id of PANELS) await expect(page.locator('#' + id), `${id} หลังรีโหลดอัตโนมัติ`).toBeVisible({ timeout: 10_000 });
    // ปุ่มข้างในต้องกดได้จริง ไม่ใช่แค่กล่องว่าง
    await expect(page.locator('#auditVerifyBtn')).toBeEnabled();
    await expect(page.locator('#adjustDocPanel .stock-list-btn')).toBeVisible();
    await expect(page.locator('#historyStatsPanel .stock-list-btn')).toBeVisible();

    await closeApp(app);
  });

  // เส้นทาง stash เดียวกัน (harness login) — ตรึงสิทธิ์ตาม role: ผู้ช่วยต้องไม่เห็นใบปรับปรุงสินค้า (กฎเดิมของ selectEmployee)
  const MATRIX = [
    { branch: 'WH',  role: 'supervisor', user: 'มายด์',  want: { auditVerifyPanel: true, historyStatsPanel: true, adjustDocPanel: true } },
    { branch: 'SRC', role: 'pharmacist', user: 'เภอ๊อฟ', want: { auditVerifyPanel: true, historyStatsPanel: true, adjustDocPanel: true } },
    { branch: 'SRC', role: 'assistant',  user: 'ก้า',    want: { auditVerifyPanel: true, historyStatsPanel: true, adjustDocPanel: false } },
  ];
  for (const c of MATRIX) {
    test(`รีโหลดอัตโนมัติ (stash) ${c.branch}/${c.role} → การ์ดตามสิทธิ์เหมือนล็อกอินปกติ`, async ({ browser }) => {
      const app = await openApp(browser, { branch: c.branch, role: c.role, user: c.user });
      for (const id of PANELS) {
        const loc = app.page.locator('#' + id);
        if (c.want[id]) await expect(loc, `${c.role} ต้องเห็น ${id}`).toBeVisible({ timeout: 10_000 });
        else await expect(loc, `${c.role} ต้องไม่เห็น ${id}`).toBeHidden({ timeout: 10_000 });
      }
      await closeApp(app);
    });
  }
});
