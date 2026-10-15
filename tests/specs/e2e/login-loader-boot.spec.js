// โหลดทั้งหน้าหลังใส่ PIN (วงแหวน + เช็กลิสต์) บนเส้นทางล็อกอินจริงทั้งสองทาง — ผ่าน Firestore emulator (ต.ค. 2026 · สวิตช์ LOGIN_LOADER)
//   ก. ล็อกอินด้วย UI จริง: สาขา → PIN → เลือกชื่อ → initAfterLogin (selectEmployee callback)
//   ข. รีโหลดอัตโนมัติ (stash _autoUpdate — heartbeat/SW หลัง deploy) → initAfterLogin ใน DOMContentLoaded
//   ค. สวิตช์ปิด (canary): ล็อกอิน UI จริงด้วยสวิตช์ปิด → ไม่มี overlay เลยตลอดทาง
// ตรึง: overlay ต้อง "เคยขึ้น" ก่อนข้อมูลพร้อม แล้ว "ปิดเอง" เมื่อโหลดเสร็จ · ขั้นเดินครบ 0→1→2→3 ตามลำดับจริง (Firestore emulator จริง ไม่ใช่ stub)
//   ⚠️ ขั้น 0→1 เกิดในจังหวะ sync เดียวกัน (loadSession เป็น sync) ผู้ใช้จึงเห็น "อ่านข้อมูลในเครื่อง" ติ๊กแล้วตั้งแต่เฟรมแรก — ตรึงที่ "ลำดับการเรียก" ไม่ใช่สถานะที่เห็นบนจอ
// ห่อ _loginLoader* ตอน DOMContentLoaded (ก่อน handler ของแอป เพราะ init script ลงทะเบียนก่อน) เพื่อไม่พลาดการเรียกที่เกิดแล้วจบในไม่กี่มิลลิวินาที
const { test, expect, closeApp, requireEmulator, newAppContext, waitForAppReady } = require('../../lib/hooks');
const { emuPort, clearAll } = require('../../lib/emulator');
const { PROJECT_ID } = require('../../lib/scenario');

async function openApp(browser, opts) {
  const app = await newAppContext(browser, { mode: 'desktop', projectId: PROJECT_ID, firestorePort: emuPort(), ...opts });
  await app.page.addInitScript(() => {
    window.__ll = [];      // ลำดับการเรียก: show / step:N / hide
    window.__shown = [];   // การเปลี่ยนสถานะ visible ของ overlay (จาก MutationObserver)
    document.addEventListener('DOMContentLoaded', () => {
      const el = document.getElementById('loginLoader');
      new MutationObserver(() => {
        const shown = el.classList.contains('show');
        if (!window.__shown.length || window.__shown[window.__shown.length - 1] !== shown) window.__shown.push(shown);
      }).observe(el, { attributes: true, attributeFilter: ['class'] });
      for (const [name, tag] of [['_loginLoaderShow', () => 'show'], ['_loginLoaderStep', (a) => 'step:' + a[0]], ['_loginLoaderHide', () => 'hide']]) {
        const orig = window[name];
        window[name] = function (...a) { window.__ll.push(tag(a)); return orig.apply(this, a); };
      }
    });
  });
  await app.page.goto('/index.html');
  await waitForAppReady(app.page, { login: opts.login !== false });
  return app;
}

const calls = (page) => page.evaluate(() => window.__ll);
const shown = (page) => page.evaluate(() => window.__shown);
const hidden = (page) => page.evaluate(() => getComputedStyle(document.getElementById('loginLoader')).display === 'none');
// _loginLoaderShow เรียก _loginLoaderStep(0) ข้างใน (ผ่านชื่อ global ที่ห่อแล้ว) → ลำดับจริงที่บันทึกได้
const FULL = ['show', 'step:0', 'step:1', 'step:2', 'step:3', 'hide'];

test.describe('หน้าโหลดวงแหวน + เช็กลิสต์หลังใส่ PIN — เส้นทางล็อกอินจริง', () => {
  test.beforeEach(async () => { requireEmulator(); await clearAll(PROJECT_ID); });
  test.setTimeout(120_000);

  test('ก. ล็อกอินด้วย UI จริง (สาขา → PIN → ชื่อ): ไม่ขึ้นก่อนเลือกชื่อ → ขึ้นหลังเลือกชื่อ ขั้นเดินครบ → ปิดเองเมื่อโหลดเสร็จ', async ({ browser }) => {
    const app = await openApp(browser, { branch: 'SRC', login: false });
    const { page } = app;
    expect(await calls(page), 'หน้าเลือกสาขา/PIN ต้องยังไม่มี overlay').toEqual([]);

    await page.locator('#branchModal button', { hasText: 'SRC' }).click();
    await page.locator('#pinInput').fill(await page.evaluate(() => BRANCH_PINS.SRC));
    await page.locator('#pinInput').press('Enter');
    await page.waitForFunction(() => getComputedStyle(document.getElementById('employeeModal')).display === 'flex', null, { polling: 100 });
    expect(await calls(page), 'ระหว่างเลือกชื่อ (หลัง PIN ผ่าน) ยังไม่มี overlay').toEqual([]);

    await page.locator('#employeePharmacistBtns button').first().click();
    await page.waitForFunction(() => !!currentUser, null, { timeout: 15_000, polling: 50 });
    await page.waitForFunction(() => window.__ll.includes('hide'), null, { timeout: 20_000, polling: 50 });

    expect(await calls(page)).toEqual(FULL);             // ขั้นเดินครบ 0→1→2→3 แล้วปิด — หนึ่งรอบ ไม่กะพริบซ้ำ
    expect(await shown(page)).toEqual([true, false]);    // ขึ้นหนึ่งครั้ง ปิดหนึ่งครั้ง
    expect(await hidden(page)).toBe(true);
    // ปิดหลังข้อมูลหน้าหลักพร้อมแล้ว (ไม่ใช่ปิดก่อนแล้วหน้าว่าง) — header แสดงสาขา/ผู้ใช้ และสถานะล็อกอินครบ
    expect(await page.evaluate(() => ({ b: currentBranch, r: currentRole, label: document.getElementById('branchLabel').textContent.trim() })))
      .toMatchObject({ b: 'SRC', r: 'pharmacist', label: expect.stringContaining('SRC') });
    await closeApp(app);
  });

  test('ข. รีโหลดอัตโนมัติ (stash _autoUpdate): overlay ขึ้นตั้งแต่เริ่ม initAfterLogin ขั้นเดินครบ แล้วปิดเอง · ล็อกอินยังอยู่', async ({ browser }) => {
    const app = await openApp(browser, { branch: 'SRC', role: 'assistant', user: 'Tester' });
    const { page } = app;
    await page.waitForFunction(() => window.__ll.includes('hide'), null, { timeout: 20_000, polling: 50 });
    expect(await calls(page)).toEqual(FULL);
    expect(await shown(page)).toEqual([true, false]);
    expect(await hidden(page)).toBe(true);
    expect(await page.evaluate(() => [currentBranch, currentRole, currentUser])).toEqual(['SRC', 'assistant', 'Tester']);
    await closeApp(app);
  });

  test('ข2. WH หัวหน้า (รีโหลดอัตโนมัติ): เส้นทาง WH (R16 + workflow) ก็เดินครบทุกขั้นแล้วปิดเอง', async ({ browser }) => {
    const app = await openApp(browser, { branch: 'WH', role: 'supervisor', user: 'มายด์' });
    const { page } = app;
    await page.waitForFunction(() => window.__ll.includes('hide'), null, { timeout: 30_000, polling: 50 });
    expect(await calls(page)).toEqual(FULL);
    expect(await hidden(page)).toBe(true);
    await closeApp(app);
  });

  test('ค. สวิตช์ปิด (canary): ล็อกอิน UI จริงด้วยสวิตช์ปิด → ไม่มี overlay เลยตลอดทาง', async ({ browser }) => {
    const app = await openApp(browser, { branch: 'SRC', login: false });
    const { page } = app;
    await page.evaluate(() => { LOGIN_LOADER = false; });   // let ระดับสคริปต์ — ตั้งผ่าน window ไม่ได้
    await page.locator('#branchModal button', { hasText: 'SRC' }).click();
    await page.locator('#pinInput').fill(await page.evaluate(() => BRANCH_PINS.SRC));
    await page.locator('#pinInput').press('Enter');
    await page.waitForFunction(() => getComputedStyle(document.getElementById('employeeModal')).display === 'flex', null, { polling: 100 });
    await page.locator('#employeePharmacistBtns button').first().click();
    await page.waitForFunction(() => !!currentUser, null, { timeout: 15_000, polling: 50 });
    // รอให้ initAfterLogin จบจริง (ป้ายผู้ใช้โผล่ที่หัวหน้า) ก่อนสรุปว่า "ไม่เคยมี overlay"
    await page.waitForFunction(() => document.getElementById('userLabel') && getComputedStyle(document.getElementById('userLabel')).display !== 'none', null, { timeout: 15_000, polling: 100 });
    await page.waitForTimeout(1500);
    // finally เรียก _loginLoaderHide() เสมอ (ปิดซ้ำที่ไม่เคยเปิด = no-op) — สิ่งที่ห้ามมีคือ show/step · และ overlay ไม่เคยขึ้น
    expect(await calls(page)).toEqual(['hide']);
    expect(await shown(page)).toEqual([]);
    expect(await hidden(page)).toBe(true);
    await closeApp(app);
  });
});
