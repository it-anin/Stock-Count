// โหลดทั้งหน้าหลังใส่ PIN (Skeleton) บนเส้นทางล็อกอินจริงทั้งสองทาง — ผ่าน Firestore emulator (ต.ค. 2026 · สวิตช์ LOGIN_SKELETON_LOADER)
//   ก. ล็อกอินด้วย UI จริง: สาขา → PIN → เลือกชื่อ → initAfterLogin (selectEmployee callback)
//   ข. รีโหลดอัตโนมัติ (stash _autoUpdate — heartbeat/SW หลัง deploy) → initAfterLogin ใน DOMContentLoaded
// ตรึง: overlay ต้อง "เคยขึ้น" ก่อนข้อมูลพร้อม แล้ว "ปิดเอง" เมื่อโหลดเสร็จ · ข้อมูลหน้าหลังพร้อมก่อน overlay หาย (ไม่ใช่หายก่อนแล้วหน้าว่าง)
// MutationObserver ติดตั้งก่อนสคริปต์หน้า (addInitScript) เพื่อไม่พลาดช่วงสั้นๆ
const { test, expect, closeApp, requireEmulator, newAppContext, waitForAppReady } = require('../../lib/hooks');
const { emuPort, clearAll } = require('../../lib/emulator');
const { PROJECT_ID } = require('../../lib/scenario');

async function openApp(browser, opts) {
  const app = await newAppContext(browser, { mode: 'desktop', projectId: PROJECT_ID, firestorePort: emuPort(), ...opts });
  await app.page.addInitScript(() => {
    window.__sk = [];
    const note = (shown) => window.__sk.push({ shown, user: typeof currentUser !== 'undefined' ? currentUser : null, t: Date.now() });
    const arm = () => {
      const el = document.getElementById('loginSkeleton');
      if (!el) return false;
      new MutationObserver(() => {
        const shown = el.classList.contains('show');
        if (!window.__sk.length || window.__sk[window.__sk.length - 1].shown !== shown) note(shown);
      }).observe(el, { attributes: true, attributeFilter: ['class'] });
      return true;
    };
    document.addEventListener('DOMContentLoaded', arm);
  });
  await app.page.goto('/index.html');
  await waitForAppReady(app.page, { login: opts.login !== false });
  return app;
}

const seq = (page) => page.evaluate(() => window.__sk.map((e) => e.shown));
const hidden = (page) => page.evaluate(() => getComputedStyle(document.getElementById('loginSkeleton')).display === 'none');

test.describe('Skeleton หลังใส่ PIN — เส้นทางล็อกอินจริง', () => {
  test.beforeEach(async () => { requireEmulator(); await clearAll(PROJECT_ID); });
  test.setTimeout(120_000);

  test('ก. ล็อกอินด้วย UI จริง (สาขา → PIN → ชื่อ): ขึ้นหลังเลือกชื่อ → ปิดเองเมื่อโหลดเสร็จ · ก่อนหน้านั้นไม่ขึ้น', async ({ browser }) => {
    const app = await openApp(browser, { branch: 'SRC', login: false });
    const { page } = app;
    expect(await seq(page), 'หน้าเลือกสาขา/PIN ต้องยังไม่มี overlay').toEqual([]);

    await page.locator('#branchModal button', { hasText: 'SRC' }).click();
    await page.locator('#pinInput').fill(await page.evaluate(() => BRANCH_PINS.SRC));
    await page.locator('#pinInput').press('Enter');
    await page.waitForFunction(() => getComputedStyle(document.getElementById('employeeModal')).display === 'flex', null, { polling: 100 });
    expect(await seq(page), 'ระหว่างเลือกชื่อ (หลัง PIN ผ่าน) ยังไม่มี overlay').toEqual([]);

    await page.locator('#employeePharmacistBtns button').first().click();
    await page.waitForFunction(() => !!currentUser, null, { timeout: 15_000, polling: 50 });
    await page.waitForFunction(() => window.__sk.length >= 2, null, { timeout: 20_000, polling: 50 });

    expect(await seq(page)).toEqual([true, false]);   // ขึ้นหนึ่งครั้ง ปิดหนึ่งครั้ง ไม่กะพริบซ้ำ
    expect(await hidden(page)).toBe(true);
    // ปิดหลังข้อมูลหน้าหลักพร้อมแล้ว (ไม่ใช่ปิดก่อนแล้วหน้าว่าง) — header แสดงสาขา/ผู้ใช้ และสถานะล็อกอินครบ
    expect(await page.evaluate(() => ({ b: currentBranch, r: currentRole, label: document.getElementById('branchLabel').textContent.trim() })))
      .toMatchObject({ b: 'SRC', r: 'pharmacist', label: expect.stringContaining('SRC') });
    await closeApp(app);
  });

  test('ข. รีโหลดอัตโนมัติ (stash _autoUpdate): overlay ขึ้นตั้งแต่เริ่ม initAfterLogin แล้วปิดเอง · ล็อกอินยังอยู่', async ({ browser }) => {
    const app = await openApp(browser, { branch: 'SRC', role: 'assistant', user: 'Tester' });
    const { page } = app;
    await page.waitForFunction(() => window.__sk.length >= 2, null, { timeout: 20_000, polling: 50 });
    expect(await seq(page)).toEqual([true, false]);
    expect(await hidden(page)).toBe(true);
    expect(await page.evaluate(() => [currentBranch, currentRole, currentUser])).toEqual(['SRC', 'assistant', 'Tester']);
    await closeApp(app);
  });

  test('ค. สวิตช์ปิด (canary): ล็อกอิน UI จริงด้วยสวิตช์ปิด → ไม่มี overlay เลยตลอดทาง', async ({ browser }) => {
    const app = await openApp(browser, { branch: 'SRC', login: false });
    const { page } = app;
    await page.evaluate(() => { LOGIN_SKELETON_LOADER = false; });   // let ระดับสคริปต์ — ตั้งผ่าน window ไม่ได้
    await page.locator('#branchModal button', { hasText: 'SRC' }).click();
    await page.locator('#pinInput').fill(await page.evaluate(() => BRANCH_PINS.SRC));
    await page.locator('#pinInput').press('Enter');
    await page.waitForFunction(() => getComputedStyle(document.getElementById('employeeModal')).display === 'flex', null, { polling: 100 });
    await page.locator('#employeePharmacistBtns button').first().click();
    await page.waitForFunction(() => !!currentUser, null, { timeout: 15_000, polling: 50 });
    // รอให้ initAfterLogin จบจริง (marker ของ restore: ปุ่มสถานะ DB หรือ listener เริ่ม) ก่อนสรุปว่า "ไม่เคยมี overlay"
    await page.waitForFunction(() => document.getElementById('userLabel') && getComputedStyle(document.getElementById('userLabel')).display !== 'none', null, { timeout: 15_000, polling: 100 });
    await page.waitForTimeout(1500);
    expect(await seq(page)).toEqual([]);
    expect(await hidden(page)).toBe(true);
    await closeApp(app);
  });
});
