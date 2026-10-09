// ช่อง Scan Barcode มีเลข SKU ขึ้นเอง (Desktop สาขายา · ผู้ใช้รายงาน 9 ต.ค. 2026)
//
// ต้นเหตุไม่ใช่โค้ดแอป: #pinInput เป็น type="password" ที่ไม่มี <form> → Password Manager ของ Chrome/Edge รวมช่องที่ไม่มี form
// ทั้งหน้าเป็นฟอร์มเดียว แล้วเดาว่าช่อง text ที่มองเห็นอยู่ก่อนช่องรหัส (#scanInput) คือ "ชื่อผู้ใช้"
// (autocomplete="off" กัน Password Manager ไม่ได้) → เคยกดบันทึกรหัสหลังพิมพ์ SKU = ครั้งต่อไปเบราว์เซอร์เติม SKU ลงช่อง Scan + เติม PIN เอง
// แก้: ช่อง PIN อยู่ใน #pinForm ของตัวเอง + autocomplete="one-time-code" (ผู้ใช้เลือกไม่ให้เบราว์เซอร์จำ PIN) · ไม่แตะเส้นทางสแกน
//
// Playwright จำลอง Password Manager ไม่ได้ → ตรึง 2 ด้าน:
//   1. ★ โครงสร้างที่ส่งมอบ (อ่านจากหน้าที่เพิ่งบูต): ช่อง Scan ไม่มีทางอยู่ฟอร์มเดียวกับช่องรหัส
//   2. ล็อกอินเหมือนเดิมทุกทาง (Enter / ปุ่ม / submit ของฟอร์ม เช่นปุ่ม Go บนคีย์บอร์ด PDA) · verifyPin ครั้งเดียวต่อการกด · หน้าไม่โหลดใหม่
// PIN อ่านจาก BRANCH_PINS ในหน้า — ห้ามฮาร์ดโค้ด/พิมพ์ลง log (repo PUBLIC)
const { test, expect, newAppContext, waitForAppReady, closeApp } = require('../../lib/hooks');

async function boot(browser, mode = 'desktop') {
  const app = await newAppContext(browser, { login: false, mode });
  await app.page.goto('/index.html');
  await waitForAppReady(app.page, { login: false });
  return app;
}

// เตรียมหน้า: นับการเรียก verifyPin · บันทึก submit ทุกครั้ง (window = bubble หลัง inline onsubmit → defaultPrevented ของจริง)
// · ตัวนับการโหลดหน้าใหม่ · marker ที่จะหายถ้าหน้าโหลดใหม่
async function arm(page) {
  const nav = { count: 0 };
  page.on('framenavigated', (f) => { if (f === page.mainFrame()) nav.count++; });
  await page.evaluate(() => {
    window.__marker = 'same-page';
    window.__vp = 0;
    window.__submits = [];
    const orig = window.verifyPin;
    window.verifyPin = function (...a) { window.__vp++; return orig.apply(this, a); };
    window.addEventListener('submit', (e) => window.__submits.push(e.defaultPrevented));
  });
  return nav;
}

async function openPin(page, branch = 'SRC') {
  await page.locator('#branchModal button', { hasText: branch }).click();
  await page.waitForFunction(() => getComputedStyle(document.getElementById('pinModal')).display === 'flex', null, { polling: 100 });
}

const probe = (page) => page.evaluate(() => ({
  vp: window.__vp,
  submits: window.__submits,
  marker: window.__marker,
  search: location.search,
  pin: getComputedStyle(document.getElementById('pinModal')).display,
  emp: getComputedStyle(document.getElementById('employeeModal')).display,
  verified: _pinVerified,
  pinValue: document.getElementById('pinInput').value,
  wrongToast: document.getElementById('toastContainer').textContent.includes('PIN ไม่ถูกต้อง'),
}));

const waitEmployee = (page) => page.waitForFunction(
  () => getComputedStyle(document.getElementById('employeeModal')).display === 'flex', null, { polling: 100 });

test('★ ค่าที่ส่งมอบ: ช่อง PIN อยู่ใน <form> ของตัวเอง · ช่อง Scan ไม่อยู่ฟอร์มเดียวกับช่องรหัสใดๆ · ช่อง Scan เท่าเดิม', async ({ browser }) => {
  for (const mode of ['desktop', 'pda']) {
    const app = await boot(browser, mode);
    const r = await app.page.evaluate(() => {
      const pin = document.getElementById('pinInput');
      const scan = document.getElementById('scanInput');
      const form = pin.form;
      const isTextLike = (e) => e.tagName === 'TEXTAREA' || (e.tagName === 'INPUT' && ['text', 'search', 'tel', 'email', 'url', 'number'].includes(e.type));
      const pwds = [...document.querySelectorAll('input[type=password]')];
      return {
        formId: form ? form.id : null,
        pinType: pin.type,
        pinAutocomplete: pin.getAttribute('autocomplete'),
        // กติกาทั่วไป: ช่องรหัสทุกช่องต้องมี form ของตัวเอง และในฟอร์มนั้นต้องไม่มีช่อง text ให้เบราว์เซอร์เดาเป็น "ชื่อผู้ใช้"
        formlessPasswords: pwds.filter((e) => !e.form).map((e) => e.id),
        textLikeInPasswordForms: pwds.flatMap((p) => (p.form ? [...p.form.elements].filter(isTextLike).map((e) => e.id || e.type) : [])),
        controlsInPinForm: form ? [...form.elements].filter((e) => e.matches('input,textarea,select')).map((e) => e.id) : [],
        buttonType: form ? (form.querySelector('button') || {}).type : null,
        scanForm: scan.form ? scan.form.id || '(form)' : null,
        scan: {
          type: scan.type,
          autocomplete: scan.getAttribute('autocomplete'),
          autofocus: scan.hasAttribute('autofocus'),
          onkeydown: scan.getAttribute('onkeydown'),
          oninput: scan.getAttribute('oninput'),
        },
      };
    });
    expect(r, mode).toEqual({
      formId: 'pinForm',
      pinType: 'password',
      pinAutocomplete: 'one-time-code',
      formlessPasswords: [],
      textLikeInPasswordForms: [],
      controlsInPinForm: ['pinInput'],
      buttonType: 'button',
      scanForm: null,
      scan: { type: 'text', autocomplete: 'off', autofocus: true, onkeydown: 'handleScanKey(event)', oninput: 'handleScanInput(event)' },
    });
    await closeApp(app);
  }
});

test('Enter: PIN ผิด → แจ้ง + ล้างช่อง + ยังอยู่หน้า PIN · PIN ถูก → หน้าเลือกชื่อ · verifyPin ครั้งเดียวต่อการกด · ไม่ submit ไม่โหลดหน้าใหม่', async ({ browser }) => {
  const app = await boot(browser);
  const { page } = app;
  const nav = await arm(page);
  await openPin(page);

  const wrong = await page.evaluate(() => (BRANCH_PINS.SRC === '0000' ? '1111' : '0000'));
  await page.locator('#pinInput').fill(wrong);
  await page.locator('#pinInput').press('Enter');
  await page.waitForFunction(() => document.getElementById('toastContainer').textContent.includes('PIN ไม่ถูกต้อง'), null, { polling: 100 });
  expect(await probe(page)).toMatchObject({ vp: 1, submits: [], marker: 'same-page', search: '', pin: 'flex', emp: 'none', verified: false, pinValue: '' });

  await page.locator('#pinInput').fill(await page.evaluate(() => BRANCH_PINS.SRC));
  await page.locator('#pinInput').press('Enter');
  await waitEmployee(page);
  expect(await probe(page)).toMatchObject({ vp: 2, submits: [], marker: 'same-page', search: '', pin: 'none', emp: 'flex', verified: true, pinValue: '' });
  expect(nav.count).toBe(0);
  await closeApp(app);
});

test('ปุ่ม "เข้าสู่ระบบ": เรียก verifyPin ครั้งเดียว · ไม่ submit ฟอร์ม', async ({ browser }) => {
  const app = await boot(browser);
  const { page } = app;
  const nav = await arm(page);
  await openPin(page);
  await page.locator('#pinInput').fill(await page.evaluate(() => BRANCH_PINS.SRC));
  await page.locator('#pinModal button', { hasText: 'เข้าสู่ระบบ' }).click();
  await waitEmployee(page);
  expect(await probe(page)).toMatchObject({ vp: 1, submits: [], marker: 'same-page', search: '', pin: 'none', emp: 'flex', verified: true });
  expect(nav.count).toBe(0);
  await closeApp(app);
});

test('submit ของฟอร์ม (เช่นปุ่ม Go บนคีย์บอร์ด PDA): เข้าสู่ระบบได้ · กัน submit จริง · กดซ้ำหลังผ่านแล้วไม่ขึ้น error', async ({ browser }) => {
  const app = await boot(browser);
  const { page } = app;
  const nav = await arm(page);
  await openPin(page);
  await page.locator('#pinInput').fill(await page.evaluate(() => BRANCH_PINS.SRC));
  await page.evaluate(() => document.getElementById('pinForm').requestSubmit());
  await waitEmployee(page);
  expect(await probe(page)).toMatchObject({ vp: 1, submits: [true], marker: 'same-page', search: '', pin: 'none', emp: 'flex', verified: true });

  await page.evaluate(() => document.getElementById('pinForm').requestSubmit());
  await page.waitForFunction(() => window.__vp === 2, null, { polling: 100 });
  expect(await probe(page)).toMatchObject({ vp: 2, submits: [true, true], marker: 'same-page', emp: 'flex', wrongToast: false });
  expect(nav.count).toBe(0);
  await closeApp(app);
});

test('PDA (UA StockCountPDA จอ 390): Enter เข้าสู่ระบบได้เหมือนเดิม', async ({ browser }) => {
  const app = await boot(browser, 'pda');
  const { page } = app;
  expect(await page.evaluate(() => [_isPdaApp(), window.innerWidth <= 600])).toEqual([true, true]); // PDA จริง ไม่ใช่ผ่านเพราะ setup ผิด
  const nav = await arm(page);
  await openPin(page);
  await page.locator('#pinInput').fill(await page.evaluate(() => BRANCH_PINS.SRC));
  await page.locator('#pinInput').press('Enter');
  await waitEmployee(page);
  expect(await probe(page)).toMatchObject({ vp: 1, submits: [], marker: 'same-page', search: '', pin: 'none', emp: 'flex', verified: true });
  expect(nav.count).toBe(0);
  await closeApp(app);
});
