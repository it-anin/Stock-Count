// items listener ตอนล็อกอิน (สวิตช์ LOGIN_ITEMS_LISTENER_ONCE) บนเส้นทางล็อกอินจริง — Firestore emulator (ต.ค. 2026)
//   ก. ล็อกอินด้วย UI จริง (สาขา → PIN → ชื่อ): เปิดสวิตช์ = สร้าง items listener "ตัวเดียว" หลังขั้น ③ (marker) เสร็จ · ปิด = 2 ตัว (ตัวแรกก่อนขั้น ③)
//   ข. เครื่องอื่นเขียน item ในช่วงที่ listener ยังไม่ถูกผูก (หลัง restore เสร็จ ก่อนขั้น ④) → ต้องโผล่หลังล็อกอินทั้งสองโหมด (snapshot แรกของ listener คือสถานะปัจจุบัน)
//   ค. เปลี่ยนชื่อผู้ใช้โดยไม่ผ่าน selectBranch (selectEmployee ไม่มี callback → startScanSessionListener ผูกใหม่): เปิด = ไม่อ่านซ้ำ · ปิด = ทิ้งแล้วอ่านใหม่
// ห่อฟังก์ชันตอน DOMContentLoaded เพื่อจดลำดับเหตุการณ์จริงของหน้าเว็บ (ไม่ใช่ stub) — ลำดับ: restore → marker → stale reset → session listener → items listener
const { test, expect, closeApp, requireEmulator, newAppContext, waitForAppReady } = require('../../lib/hooks');
const { emuPort } = require('../../lib/emulator');
const { bootFreshCount, PROJECT_ID } = require('../../lib/scenario');
const { seedItems } = require('../../lib/seed');

async function seedCount(browser) {
  const setup = await bootFreshCount(browser, { branch: 'SRC', role: 'pharmacist', user: 'Tester' });
  await seedItems(PROJECT_ID, 'SRC', setup.epoch, [{ sku: 'S-NORM', status: 'scanning', countedQty: 2, barcode: 'B-NORM' }]);
  const epoch = setup.epoch;
  await closeApp(setup);
  return epoch;
}

// เปิดแอป (ยังไม่ล็อกอิน) พร้อมตัวจดเหตุการณ์ · on=false ตั้งสวิตช์เป็นปิดตั้งแต่ก่อนล็อกอิน
async function openApp(browser, { on, gap = null }) {
  const app = await newAppContext(browser, { branch: 'SRC', role: 'pharmacist', user: 'Tester', mode: 'desktop', projectId: PROJECT_ID, firestorePort: emuPort(), login: false });
  if (gap) await app.page.exposeFunction('__writeGap', gap);
  await app.page.addInitScript((on) => {
    window.__ev = [];
    const ev = (n) => window.__ev.push(n);
    document.addEventListener('DOMContentLoaded', () => {
      LOGIN_ITEMS_LISTENER_ONCE = on;
      const wrapAsync = (name, before, after) => {
        const o = window[name];
        window[name] = async function (...a) { if (before) ev(before); try { return await o.apply(this, a); } finally { if (after) ev(after); } };
      };
      wrapAsync('restoreFromFirestore', 'restore-start', 'restore-end');
      wrapAsync('initAfterLogin', null, 'login-done');
      const om = window._loadPharmacyAuditMarkerState;
      window._loadPharmacyAuditMarkerState = async function (...a) {
        try { return await om.apply(this, a); } finally { ev('marker-end'); if (window.__writeGap) { await window.__writeGap(); ev('gap-written'); } }
      };
      const orst = window.resetStaleScanningItems;
      window.resetStaleScanningItems = function (...a) { ev('stale-reset'); return orst.apply(this, a); };
      const ossl = window.startScanSessionListener;
      window.startScanSessionListener = function (...a) { ev('ssl'); return ossl.apply(this, a); };
      const g = window.getScanItemsRef;
      window.getScanItemsRef = function (...a) {
        const ref = g.apply(this, a); const ow = ref.where.bind(ref);
        ref.where = function (...b) {
          const q = ow(...b); const os = q.onSnapshot.bind(q); const og = q.get.bind(q);
          q.onSnapshot = function (...c) { ev('items-listener'); return os(...c); };
          q.get = function (...c) { ev('items-get'); return og(...c).then((s) => { ev('items-get-done'); return s; }); };
          return q;
        };
        return ref;
      };
    });
  }, on);
  await app.page.goto('/index.html');
  await waitForAppReady(app.page, { login: false });
  return app;
}

async function uiLogin(page) {
  await page.locator('#branchModal button', { hasText: 'SRC' }).click();
  await page.locator('#pinInput').fill(await page.evaluate(() => BRANCH_PINS.SRC));
  await page.locator('#pinInput').press('Enter');
  await page.waitForFunction(() => getComputedStyle(document.getElementById('employeeModal')).display === 'flex', null, { polling: 100 });
  await page.locator('#employeePharmacistBtns button').first().click();
  await page.waitForFunction(() => window.__ev.includes('login-done'), null, { timeout: 30_000, polling: 50 });
}

const events = (page) => page.evaluate(() => window.__ev);
const count = (ev, name) => ev.filter((e) => e === name).length;

test.describe('LOGIN_ITEMS_LISTENER_ONCE — เส้นทางล็อกอินจริง', () => {
  test.beforeEach(() => { requireEmulator(); });
  test.setTimeout(150_000);

  test('ก. ล็อกอิน UI จริง: เปิด = items listener ตัวเดียว สร้างหลังขั้น ③ (marker) และหลังรีเซ็ตของค้างข้ามวัน · ปิด = 2 ตัว ตัวแรกก่อนขั้น ③', async ({ browser }) => {
    await seedCount(browser);
    const run = async (on) => {
      const app = await openApp(browser, { on });
      await uiLogin(app.page);
      await app.page.waitForFunction(() => window.__ev.includes('items-listener'), null, { timeout: 15_000, polling: 50 });
      const ev = await events(app.page);
      const loaded = await app.page.evaluate(() => [...state.scanData.entries()].filter(([, v]) => v.status !== 'pending').map(([k, v]) => [k, v.status, v.countedQty]));
      await closeApp(app);
      return { ev, loaded };
    };
    const on = await run(true);
    const off = await run(false);
    // กันเทสผ่านเปล่าๆ — items ถูกโหลดจริงทั้งสองโหมด และผลเท่ากัน
    expect(on.loaded).toEqual([['S-NORM', 'scanning', 2]]);
    expect(off.loaded).toEqual(on.loaded);
    // เปิด: อ่านด้วย get() รอบเดียว + listener ตัวเดียว สร้างหลังขั้น ③ และหลัง stale reset (ตรงเจตนาคอมเมนต์ใน initAfterLogin)
    expect(count(on.ev, 'items-get')).toBe(1);
    expect(count(on.ev, 'items-listener'), JSON.stringify(on.ev)).toBe(1);
    const i = (n) => on.ev.indexOf(n);
    expect(i('items-get-done')).toBeLessThan(i('restore-end'));
    expect(i('restore-end')).toBeLessThan(i('marker-end'));
    expect(i('marker-end')).toBeLessThan(i('stale-reset'));
    expect(i('stale-reset')).toBeLessThan(i('ssl'));
    expect(i('ssl')).toBeLessThan(i('items-listener'));
    // ปิด (พฤติกรรมเดิม): listener ตัวแรกเริ่มก่อนขั้น ③ แล้วถูกทิ้ง-สร้างใหม่ตอน startScanSessionListener
    expect(count(off.ev, 'items-listener'), JSON.stringify(off.ev)).toBe(2);
    expect(off.ev.indexOf('items-listener')).toBeLessThan(off.ev.indexOf('marker-end'));
  });

  test('ข. เครื่องอื่นเขียน item ช่วงที่ listener ยังไม่ถูกผูก (หลัง restore ก่อนขั้น ④) → โผล่หลังล็อกอินทั้งสองโหมด', async ({ browser }) => {
    const epoch = await seedCount(browser);
    for (const on of [true, false]) {
      const gap = async () => { await seedItems(PROJECT_ID, 'SRC', epoch, [{ sku: 'S-MULTI', status: 'scanning', countedQty: 4, barcode: 'B-M1', scannedBy: 'Other' }]); };
      const app = await openApp(browser, { on, gap });
      await uiLogin(app.page);
      await app.page.waitForFunction(() => state.scanData.get('S-MULTI')?.status === 'scanning', null, { timeout: 20_000, polling: 100 });
      const got = await app.page.evaluate(() => ({ multi: state.scanData.get('S-MULTI')?.countedQty, norm: state.scanData.get('S-NORM')?.countedQty }));
      const ev = await events(app.page);
      expect(ev.indexOf('gap-written'), `on=${on}`).toBeGreaterThan(ev.indexOf('marker-end'));   // เขียนหลัง restore เสร็จจริง
      expect(got, `on=${on}`).toEqual({ multi: 4, norm: 2 });
      await closeApp(app);
    }
  });

  test('ค. เปลี่ยนชื่อผู้ใช้โดยไม่ผ่าน selectBranch (selectEmployee ไม่มี callback): เปิด = items listener คงเดิม ไม่อ่านซ้ำ · ปิด = ทิ้งแล้วสร้างใหม่', async ({ browser }) => {
    await seedCount(browser);
    const result = {};
    for (const on of [true, false]) {
      const app = await openApp(browser, { on });
      await uiLogin(app.page);
      await app.page.waitForFunction(() => window.__ev.includes('items-listener'), null, { timeout: 15_000, polling: 50 });
      const before = count(await events(app.page), 'items-listener');
      await app.page.evaluate(() => { _employeeCallback = null; selectEmployee('Tester2', 'pharmacist'); });
      await app.page.waitForFunction(() => window.__ev.filter((e) => e === 'ssl').length >= 2, null, { timeout: 10_000, polling: 50 });
      result[on] = { before, after: count(await events(app.page), 'items-listener'), user: await app.page.evaluate(() => currentUser) };
      await closeApp(app);
    }
    expect(result.true).toEqual({ before: 1, after: 1, user: 'Tester2' });
    expect(result.false.after).toBe(result.false.before + 1);
  });
});
