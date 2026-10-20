// ฉากขาวต่อเนื่อง: เปิดแอป → เลือกสาขา → PIN → เลือกชื่อ → หน้า Loading (ผู้ใช้อนุมัติ "ข้อ A" 20 ต.ค. 2026 · สวิตช์ LOGIN_WHITE_FLOW)
//
// เดิมระหว่างเข้าแอปบน PDA เห็นโครงหน้าเปล่าคั่น 3 ช่วง: (ก) เฟรมแรกก่อนหน้าเลือกสาขา (สคริปต์หลัก ~950 KB แปล/รัน + รอ maintenance.json)
//   (ข) หน้าเลือกชื่อ (ฉากหลังสีเข้มโปร่ง 75% ทับโครงหน้าเปล่า) (ค) หน้า Loading พื้น #f0f4f8 ไม่ใช่ขาว
// ใหม่ (HTML/CSS ล้วน + 3 จุดเรียกใน JS — ไม่แตะสแกน/sync/schema/rules/sw.js/APK):
//   · #bootCover ขาวเป็น element แรกใน body — ขึ้นตั้งแต่เฟรมแรกโดยไม่รอ JS · ปิดตอนหน้าเลือกสาขาขึ้น/เริ่ม initAfterLogin · ตัวกันค้าง CSS ล้วน 6 วิ
//   · #employeeModal ขาวทึบเฉพาะตอนล็อกอิน/สลับสาขา (มี callback) — เปลี่ยนชื่อระหว่างใช้งานคงสีเข้มโปร่งเดิม
//   · #loginLoader พื้น #fff · ทั้งหมดอยู่ใต้ html.login-white ที่สวิตช์ใน <head> เป็นคนใส่ (ปิดสวิตช์ = ไม่มีกฎไหนทำงาน)
//
// เทสนี้ตรึง:
//   1. ★ ค่าที่ส่งมอบ: สวิตช์เปิด · cover เป็น element แรกของ body · ลำดับ z-index · ตัวกันค้างตั้งไว้ 3–8 วิ
//   2. ★ เฟรมแรก (maintenance.json ค้าง): พิกเซลจริงขาวทั้งจอ · hit-test เจอ cover · modal ยังไม่ขึ้น → release แล้ว cover หาย modal ขึ้น (Desktop + PDA)
//   3. ★ ตัวกันค้างทำงานจริงโดยไม่พึ่ง JS (รอ ~6 วิจริง) แล้วกลับไปเห็นโครงหน้าเหมือนก่อนแก้
//   4. ★ หน้าเลือกชื่อ: ล็อกอิน=ขาวทึบไม่เฟด · เปลี่ยนชื่อ (PDA แตะชื่อบนหัวจอ)=เข้มโปร่งเดิม · คลาสไม่ค้างข้ามรอบ
//   5. ★ เส้นทางจริงคลิกทุกขั้น: ไม่มีเฟรมใดที่เห็นหน้าแอป (บันทึกทุกเฟรมด้วย requestAnimationFrame) · พิกเซลหน้าเลือกชื่อ/หน้า Loading ขาว (Desktop + PDA)
//   6. ★ เส้นทางรีโหลดอัตโนมัติ (ข้ามหน้าเลือกสาขา เข้า initAfterLogin ตรง): cover → หน้า Loading ไม่มีเฟรมที่เห็นหน้าแอป
//   7. ★ สวิตช์ปิด = เดิมจริง (แก้ HTML ที่เสิร์ฟ): ไม่มีคลาส/ฉากขาว · เห็นโครงหน้า · หน้าเลือกชื่อเข้มโปร่ง · หน้า Loading #f0f4f8 · ตัวตรวจเฟรมต้องจับความต่างนี้ได้ (control)
const fs = require('node:fs');
const path = require('node:path');
const { test, expect, newAppContext, waitForAppReady, closeApp } = require('../../lib/hooks');

const INDEX = path.join(__dirname, '..', '..', '..', 'index.html');
const SWITCH_ON = 'var LOGIN_WHITE_FLOW=true;';
const SWITCH_OFF = ['var LOGIN_WHITE_FLOW=true;', 'var LOGIN_WHITE_FLOW=false;'];

// บันทึก "ทุกเฟรมที่จะถูกวาด" ตั้งแต่เอกสารเริ่ม — requestAnimationFrame รันก่อนวาดทุกเฟรม จึงเห็นสถานะที่ผู้ใช้เห็นจริง
// covered = id ของตัวที่คลุมทั้งจอด้วยพื้นทึบ (cover / หน้า Loading / modal ที่ฉากหลังทึบเต็ม) · false = เห็นหน้าแอปข้างหลัง · null = ยังไม่มี body
// shell = โครงหน้า (.container) อยู่ใน DOM แล้ว = เฟรมนี้ "มีหน้าแอปให้เห็น" — ตัวตรวจนับเฉพาะเฟรมแบบนี้
//   ⚠️ ห้ามนับตั้งแต่เฟรมที่เพิ่งมี body: parser อาจสร้าง <body> แล้วยังไม่ถึง #bootCover ในเฟรมนั้น (เฟรมว่าง ไม่มีโครงหน้าให้เห็น)
//      รอบแรกนับแบบนั้นแล้ว flaky ~3% (1 ใน 36 รอบ) · cover เป็น element ก่อน .container เสมอ จึงต้องมีแล้วทุกเฟรมที่ shell=true (เว้นแต่ถูกเอาออก = บั๊กจริง)
const FRAME_LOG = () => {
  window.__frames = [];
  const solid = (id) => {
    const el = document.getElementById(id);
    if (!el) return false;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 1) return false;
    const m = /rgba?\(([^)]+)\)/.exec(cs.backgroundColor);
    if (!m) return false;
    const p = m[1].split(',').map(parseFloat);
    if (p.length === 4 && p[3] < 1) return false;
    const r = el.getBoundingClientRect();
    return r.left <= 0 && r.top <= 0 && r.right >= innerWidth && r.bottom >= innerHeight;
  };
  const loop = () => {
    const covered = document.body ? (['bootCover', 'loginLoader', 'branchModal', 'pinModal', 'employeeModal'].find(solid) || false) : null;
    window.__frames.push({ t: performance.now(), shell: !!document.querySelector('.container'), covered });
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
};

// boot ที่ "ค้างก่อนเปิดหน้าเลือกสาขา": DOMContentLoaded รอ maintenance.json ก่อนเรียก showBranchSelector → ตอบช้าจนกว่าจะ release()
async function bootHeld(browser, { mode = 'desktop', login = false, rewrite = null, hold = true } = {}) {
  const app = await newAppContext(browser, { login, mode });
  const { page, context } = app;
  let release = () => {};
  if (hold) {
    const gate = new Promise((r) => { release = r; });
    await context.route('**/maintenance.json*', async (route) => { await gate; await route.continue(); });
  }
  await context.addInitScript(FRAME_LOG);
  if (login) {
    // เส้นทางรีโหลดอัตโนมัติเข้า initAfterLogin ตรงๆ — ค้างที่ "โหลดข้อมูลจาก Cloud" ให้หน้า Loading อยู่ค้างพอตรวจ
    await context.addInitScript((LISTENERS) => {
      document.addEventListener('DOMContentLoaded', () => {
        window.restoreFromFirestore = () => new Promise((r) => { window.__release = r; });
        for (const n of ['_loadPharmacyAuditMarkerState', '_loadPharmacyR16Timeline', '_loadWhR16CloudTimelines', '_loadWhWorkflowCloudState', 'loadLocationFromFirestore']) window[n] = async () => {};
        for (const n of LISTENERS) window[n] = () => {};
      });
    }, LISTENERS);
  }
  if (rewrite) {
    await context.route('**/index.html', async (route) => {
      const res = await route.fetch();
      await route.fulfill({ response: res, body: (await res.text()).replace(rewrite[0], rewrite[1]) });
    });
  }
  await page.goto('/index.html');
  return { app, release };
}
const LISTENERS = ['startProductMasterListener', 'startR05Listener', 'startWhMasterListeners', 'startScanSessionListener', 'startWhCountConfirmationListener', 'startWhCountInboxListener',
  'startWhRecheckConfirmationListener', 'startWhRecheckInboxListener', 'startWhConfirmOpsListener', 'startBranchConfirmLockListener', 'startPharmacyAuditMarkerListener', 'startAdjErpListener', 'startLocationListener'];

// เส้นทางล็อกอินจริงต้องไม่ไปแตะ Cloud: ค้างที่ restoreFromFirestore (ปล่อยด้วย __release) · ที่เหลือเป็น no-op
async function stubLogin(page) {
  await page.evaluate(({ LISTENERS }) => {
    window.logLoginEvent = () => {};
    window.restoreFromFirestore = () => new Promise((r) => { window.__release = r; });
    for (const n of ['_loadPharmacyAuditMarkerState', '_loadPharmacyR16Timeline', '_loadWhR16CloudTimelines', '_loadWhWorkflowCloudState', 'loadLocationFromFirestore']) window[n] = async () => {};
    for (const n of LISTENERS) window[n] = () => {};
  }, { LISTENERS });
}

// พิกเซลจริงจากภาพหน้าจอ (ถอดรหัส PNG ด้วย canvas ในหน้า) — grid=true: 10×10 ทั้งจอ · false: 6 จุด = 4 มุม + กึ่งกลางขอบบน/ล่าง
// ⚠️ ไม่สุ่มขอบซ้าย/ขวาที่กึ่งกลางจอ: บน PDA การ์ดกว้างเกือบเต็มจอ จุดนั้นโดนเงานุ่มของการ์ด (ไม่ใช่ฉากหลัง) → ได้ 248,248,250 แทนขาว
async function pixels(page, { grid = false } = {}) {
  const png = await page.screenshot();
  return page.evaluate(async ({ b64, grid }) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const cv = document.createElement('canvas'); cv.width = bmp.width; cv.height = bmp.height;
    const g = cv.getContext('2d', { willReadFrequently: true }); g.drawImage(bmp, 0, 0);
    const pts = grid ? [...Array(10).keys()].flatMap((i) => [...Array(10).keys()].map((j) => [(i + 0.5) / 10, (j + 0.5) / 10]))
      : [[0.02, 0.02], [0.98, 0.02], [0.02, 0.98], [0.98, 0.98], [0.5, 0.03], [0.5, 0.97]];
    return pts.map(([fx, fy]) => Array.from(g.getImageData(Math.min(bmp.width - 1, Math.floor(fx * bmp.width)), Math.min(bmp.height - 1, Math.floor(fy * bmp.height)), 1, 1).data));
  }, { b64: png.toString('base64'), grid });
}
const WHITE = [255, 255, 255, 255];
const allWhite = (px) => px.every((p) => p.join() === WHITE.join());

// รอให้มีเฟรมใหม่ ≥ n เฟรม (ไม่ sleep) — ให้ตัวตรวจเฟรมเห็นทุกขั้นอย่างน้อยหนึ่งเฟรม
const waitFrames = (page, n = 3) => page.evaluate(async (n) => {
  const start = window.__frames.length;
  await new Promise((resolve) => { const t = setInterval(() => { if (window.__frames.length >= start + n) { clearInterval(t); resolve(); } }, 20); });
}, n);

// วิเคราะห์ log เฟรมก่อนเวลา tEnd เฉพาะเฟรมที่มีโครงหน้าให้เห็น (shell): first = เฟรมแรกที่มีโครงหน้า · seen = ตัวคลุมที่เคยเห็น
function analyze(frames, tEnd = Infinity) {
  const fr = frames.filter((f) => f.shell && f.t < tEnd);
  return { fr, first: fr[0], seen: new Set(fr.map((f) => f.covered).filter(Boolean)) };
}

const MODES = [['Desktop', 'desktop'], ['PDA', 'pda']];

// ⚠️ ข้อนี้เป็น "ตัวเฝ้าเดียว" ของ 2 กติกาเชิงโครงสร้าง — ห้ามผ่อน (ทดลอง mutation แล้ว: เทสเชิงพฤติกรรมข้ออื่นจับไม่ได้):
//   (ก) cover ต้องอยู่ก่อนโครงหน้าใน HTML — ในเครื่องเทส parser อ่าน HTML ทั้งก้อนเสร็จก่อนมีเฟรมแรก จึงจำลอง "วาดโครงหน้าก่อนอ่านถึง cover" ไม่ได้
//       (บน PDA ช้าจริงเกิดได้) · ย้าย cover ไปไว้หลังโครงหน้าแล้วข้ออื่นผ่านหมด
//   (ข) ลำดับ z-index cover < หน้า Loading < toast ≤ modal — ผิดลำดับแล้วไม่กระทบเส้นทางปกติ (cover ถูกเอาออกก่อน) จะเห็นเฉพาะตอน cover ค้าง
test('★ ค่าที่ส่งมอบ: สวิตช์เปิด · cover เป็น element แรกของ body ไม่มีลูก · ลำดับ z-index · ตัวกันค้าง 3–8 วิ · ประกาศสวิตช์ครั้งเดียวใน head', async ({ browser }) => {
  const html = fs.readFileSync(INDEX, 'utf8');
  expect(html.split(SWITCH_ON).length - 1, 'สวิตช์ต้องประกาศแบบ var LOGIN_WHITE_FLOW=true; หนึ่งแห่ง').toBe(1);
  expect(html.indexOf(SWITCH_ON), 'สวิตช์อยู่ใน head (ก่อน <body>)').toBeLessThan(html.indexOf('<body>'));
  expect(html.indexOf(SWITCH_ON), 'สวิตช์อยู่ก่อนสคริปต์ตัวแรก (ต้องตัดสินก่อนวาดเฟรมแรก)').toBeLessThan(html.indexOf('<script src='));

  for (const [name, mode] of MODES) {
    const { app } = await bootHeld(browser, { mode });
    const r = await app.page.evaluate(() => {
      const cover = document.getElementById('bootCover');
      const cs = getComputedStyle(cover);
      const z = (id) => Number(getComputedStyle(document.getElementById(id)).zIndex);
      const a = cover.getAnimations().find((x) => x.animationName === 'bootCoverOut');
      return {
        sw: typeof LOGIN_WHITE_FLOW === 'boolean' ? LOGIN_WHITE_FLOW : null,
        htmlClass: document.documentElement.classList.contains('login-white'),
        firstChild: document.body.firstElementChild?.id, kids: cover.childElementCount, text: cover.textContent.trim(), aria: cover.getAttribute('aria-hidden'),
        display: cs.display, pos: cs.position, bg: cs.backgroundColor, inset: [cs.top, cs.right, cs.bottom, cs.left],
        z: { cover: z('bootCover'), loader: z('loginLoader'), toast: z('toastContainer'), branch: z('branchModal'), pin: z('pinModal'), emp: z('employeeModal') },
        delay: a?.effect.getTiming().delay, fill: a?.effect.getTiming().fill,
      };
    });
    expect(r, name).toMatchObject({ sw: true, htmlClass: true, firstChild: 'bootCover', kids: 0, text: '', aria: 'true', display: 'block', pos: 'fixed', bg: 'rgb(255, 255, 255)', inset: ['0px', '0px', '0px', '0px'], fill: 'forwards' });
    // เหนือหน้าแอป · ใต้หน้า Loading และ modal ทุกตัวและ toast (error/warn ต้องไม่ถูกบัง)
    expect(r.z.cover, name).toBeGreaterThan(1);
    expect([r.z.cover < r.z.loader, r.z.loader < r.z.toast, r.z.toast <= r.z.branch, r.z.branch < r.z.pin, r.z.pin < r.z.emp], `${name}: ลำดับชั้น ${JSON.stringify(r.z)}`).toEqual([true, true, true, true, true]);
    expect(r.delay, `${name}: ตัวกันค้างต้องไม่สั้นจนซ่อนก่อนแอปพร้อม และไม่นานจนจอขาวค้าง`).toBeGreaterThanOrEqual(3000);
    expect(r.delay).toBeLessThanOrEqual(8000);
    await closeApp(app);
  }
});

test('★ เฟรมแรก (maintenance.json ค้าง): พิกเซลขาวทั้งจอ · hit-test เจอ cover ทุกจุด · modal ยังไม่ขึ้น → release แล้ว cover หาย + หน้าเลือกสาขาขึ้น (Desktop + PDA)', async ({ browser }) => {
  for (const [name, mode] of MODES) {
    const { app, release } = await bootHeld(browser, { mode });
    const { page } = app;
    await waitFrames(page, 5);
    const held = await page.evaluate(() => {
      const hit = (x, y) => document.elementFromPoint(x, y)?.id;
      const W = innerWidth, H = innerHeight;
      return {
        hits: [hit(2, 2), hit(W - 3, 2), hit(2, H - 3), hit(W - 3, H - 3), hit(W / 2, H / 2)],
        branchShown: getComputedStyle(document.getElementById('branchModal')).display !== 'none',
        coverInDom: !!document.getElementById('bootCover'),
        // โครงหน้าเปล่ามีอยู่จริงข้างหลัง (ถ้าไม่มีนี่เทสไม่ได้พิสูจน์อะไร): header + แถบสถิติ
        shellExists: !!document.querySelector('.container .header') && getComputedStyle(document.querySelector('.container')).display !== 'none',
      };
    });
    expect(held.hits, `${name}: ทุกมุมและกลางจอเจอ cover (กดทะลุไม่ได้)`).toEqual(Array(5).fill('bootCover'));
    expect(held, name).toMatchObject({ branchShown: false, coverInDom: true, shellExists: true });
    const px = await pixels(page, { grid: true });
    expect(allWhite(px), `${name}: เฟรมแรกต้องขาวทั้งจอ ไม่เห็นโครงหน้า — ตัวอย่างพิกเซลที่ไม่ขาว ${JSON.stringify(px.filter((p) => p.join() !== WHITE.join()).slice(0, 3))}`).toBe(true);

    release();
    await waitForAppReady(page, { login: false });
    await page.waitForFunction(() => getComputedStyle(document.getElementById('branchModal')).display !== 'none', null, { polling: 50 });
    const after = await page.evaluate(() => ({ cover: !!document.getElementById('bootCover'), branchBg: getComputedStyle(document.getElementById('branchModal')).backgroundColor }));
    expect(after, `${name}: หน้าเลือกสาขาขึ้นแล้ว cover ต้องถูกเอาออก (ไม่ค้างเป็น element ลอยเหนือแอป)`).toEqual({ cover: false, branchBg: 'rgb(255, 255, 255)' });
    await closeApp(app);
  }
});

test('★ ตัวกันค้างทำงานจริงโดยไม่พึ่ง JS: รอ ~6 วิ cover ซ่อนเอง → กลับไปเห็นโครงหน้าเหมือนก่อนแก้ (JS/เน็ตค้างก็ไม่ค้างจอขาว)', async ({ browser }) => {
  const { app, release } = await bootHeld(browser, { mode: 'pda' });   // JS ค้างที่ maintenance.json ตลอด — ไม่มีใครเรียก _bootCoverHide
  const { page } = app;
  const t0 = Date.now();
  await page.waitForFunction(() => getComputedStyle(document.getElementById('bootCover')).visibility === 'hidden', null, { polling: 100, timeout: 12000 });
  const took = Date.now() - t0;
  const r = await page.evaluate(() => ({
    inDom: !!document.getElementById('bootCover'), op: getComputedStyle(document.getElementById('bootCover')).opacity,
    center: document.elementFromPoint(innerWidth / 2, innerHeight / 2)?.closest('.container') != null,
  }));
  expect(r, 'ซ่อนแล้วเห็นโครงหน้า (พฤติกรรมเดิม) และไม่รับ event').toEqual({ inDom: true, op: '0', center: true });
  expect(took, `ต้องไม่ซ่อนก่อน ~3 วิ (วัดได้ ${took} ms)`).toBeGreaterThan(3000);
  release();                       // ปล่อยให้แอปไปต่อ: หน้าเลือกสาขาต้องขึ้นตามปกติ และ cover (ที่ซ่อนอยู่) ถูกเอาออก
  await waitForAppReady(page, { login: false });
  await page.waitForFunction(() => getComputedStyle(document.getElementById('branchModal')).display !== 'none' && !document.getElementById('bootCover'), null, { polling: 50 });
  await closeApp(app);
});

test('★ หน้าเลือกชื่อ: ล็อกอิน/สลับสาขา (มี callback)=ขาวทึบไม่เฟด · เปลี่ยนชื่อระหว่างใช้งาน=เข้มโปร่งเดิม · คลาสไม่ค้างข้ามรอบ · ปุ่มแตะชื่อบนหัวจอของ PDA คงเดิม', async ({ browser }) => {
  const { app, release } = await bootHeld(browser, { mode: 'pda' });
  const { page } = app;
  release(); await waitForAppReady(page, { login: false });
  const read = () => page.evaluate(() => {
    const ov = document.getElementById('employeeModal'); const card = document.getElementById('employeeModalCard');
    const o = getComputedStyle(ov); const c = getComputedStyle(card);
    const hit = (x, y) => document.elementFromPoint(x, y)?.id;
    return {
      cls: ov.classList.contains('ew-white'), bg: o.backgroundColor, anim: o.animationName, opacity: o.opacity, z: Number(o.zIndex),
      cardBorder: [c.borderTopWidth, c.borderTopStyle], cardShadow: c.boxShadow, cardBg: c.backgroundColor,
      corners: [hit(2, 2), hit(innerWidth - 3, 2), hit(2, innerHeight - 3), hit(innerWidth - 3, innerHeight - 3)],
    };
  });
  const close = () => page.evaluate(() => { document.getElementById('employeeModal').style.display = 'none'; });
  await page.evaluate(() => { document.getElementById('branchModal').style.display = 'none'; currentBranch = 'SRC'; });

  // ล็อกอิน (มี callback) — ขาวทึบ · ไม่เฟดเข้า (เฟดจะเห็นหน้าแอปแว้บ) · การ์ดขอบบาง+เงานุ่ม ไม่ใช่เงาดำหนักบนพื้นขาว
  await page.evaluate(() => showEmployeeSelector(() => {}));
  const login = await read();
  expect(login, 'ล็อกอิน').toMatchObject({ cls: true, bg: 'rgb(255, 255, 255)', anim: 'none', opacity: '1', z: 10001, cardBorder: ['1px', 'solid'], cardBg: 'rgb(255, 255, 255)' });
  expect(login.corners, 'ล็อกอิน: ฉากหลังปิดทั้งจอ').toEqual(Array(4).fill('employeeModal'));
  expect(login.cardShadow, 'เงาดำหนักเดิมต้องไม่กลับมาบนพื้นขาว').not.toContain('rgba(0, 0, 0, 0.28)');
  expect(login.cardShadow).not.toBe('none');
  await close();

  // เปลี่ยนชื่อ (ไม่มี callback) — เข้มโปร่งเดิม · เฟดเข้าเดิม · คลาสที่ค้างจากรอบล็อกอินต้องถูกถอด
  await page.evaluate(() => showEmployeeSelector());
  const rename = await read();
  expect(rename, 'เปลี่ยนชื่อ').toMatchObject({ cls: false, bg: 'rgba(10, 20, 40, 0.75)', anim: 'branchFadeIn', cardBg: 'rgb(255, 255, 255)' });
  expect(rename.cardBorder, 'การ์ดเดิมไม่มีขอบ').toEqual(['0px', 'none']);
  expect(rename.cardShadow, 'เงาเดิม').toContain('rgba(0, 0, 0, 0.28)');
  await close();

  // ทางจริงของการเปลี่ยนชื่อ: แตะชื่อบนหัวจอ (openUserLabelSelector · PDA ≤600px · ไม่ใช่ WH) — ต้องเข้มโปร่งเหมือนกัน
  const viaLabel = await page.evaluate(() => { currentBranch = 'SRC'; openUserLabelSelector(); const ov = document.getElementById('employeeModal'); return { cls: ov.classList.contains('ew-white'), bg: getComputedStyle(ov).backgroundColor, shown: getComputedStyle(ov).display !== 'none' }; });
  expect(viaLabel, 'แตะชื่อบนหัวจอ').toEqual({ cls: false, bg: 'rgba(10, 20, 40, 0.75)', shown: true });
  await close();

  // สลับกลับมาล็อกอินอีกครั้ง — ขาวอีกรอบ (toggle ทุกครั้งที่เปิด ไม่ใช่ตั้งครั้งเดียว)
  await page.evaluate(() => showEmployeeSelector(() => {}));
  expect((await read()).bg, 'ล็อกอินรอบสอง').toBe('rgb(255, 255, 255)');
  await close();
  await closeApp(app);
});

for (const [name, mode] of MODES) {
  test(`★ เส้นทางจริงคลิกทุกขั้น (${name}): ไม่มีเฟรมใดที่เห็นหน้าแอป · พิกเซลหน้าเลือกชื่อและหน้า Loading ขาว · สลับในแต่ละขั้นไม่มีช่องว่าง`, async ({ browser }) => {
    const { app, release } = await bootHeld(browser, { mode });
    const { page } = app;
    await waitFrames(page, 5);                                            // เฟรมแรกขณะ maintenance.json ค้าง
    release();
    await waitForAppReady(page, { login: false });
    await stubLogin(page);
    await page.waitForFunction(() => getComputedStyle(document.getElementById('branchModal')).display !== 'none', null, { polling: 50 });
    await waitFrames(page, 3);

    await page.click('#branchModal button[onclick="selectBranch(\'SRC\')"]');       // เลือกสาขา (คลิกจริง)
    await page.waitForFunction(() => getComputedStyle(document.getElementById('pinModal')).display !== 'none', null, { polling: 50 });
    await waitFrames(page, 3);

    const pin = await page.evaluate(() => BRANCH_PINS.SRC);              // อ่านจากแอปตอนรัน — ไม่เขียน PIN ลงเทส
    await page.fill('#pinInput', pin);
    await page.press('#pinInput', 'Enter');                              // ใส่ PIN (คีย์บอร์ดจริง)
    await page.waitForFunction(() => getComputedStyle(document.getElementById('employeeModal')).display !== 'none', null, { polling: 50 });
    await waitFrames(page, 8);                                           // ผ่านช่วงการ์ดสไลด์เข้า
    const empPx = await pixels(page);
    expect(allWhite(empPx), `${name}: หน้าเลือกชื่อ ฉากหลังต้องขาวล้วน (ไม่เห็นหน้าแอปลางๆ) — ${JSON.stringify(empPx.filter((p) => p.join() !== WHITE.join()).slice(0, 3))}`).toBe(true);

    await page.click('#employeeAssistantBtns button >> nth=0');          // เลือกชื่อ (คลิกจริง) → การ์ดสไลด์ออก 220 ms → initAfterLogin → หน้า Loading
    await page.waitForFunction(() => getComputedStyle(document.getElementById('loginLoader')).display !== 'none', null, { polling: 50 });
    await waitFrames(page, 8);
    const ld = await page.evaluate(() => ({ bg: getComputedStyle(document.getElementById('loginLoader')).backgroundColor, step: document.getElementById('loginLoader').dataset.step, cover: !!document.getElementById('bootCover') }));
    expect(ld, `${name}: หน้า Loading พื้นขาว (ไม่ใช่ #f0f4f8) และถึงขั้นรอ Cloud`).toEqual({ bg: 'rgb(255, 255, 255)', step: '1', cover: false });
    const ldPx = await pixels(page);
    expect(allWhite(ldPx), `${name}: หน้า Loading ริมจอต้องขาว — ${JSON.stringify(ldPx.filter((p) => p.join() !== WHITE.join()).slice(0, 3))}`).toBe(true);

    const tRelease = await page.evaluate(() => { const t = performance.now(); window.__release(); return t; });
    await page.waitForFunction(() => getComputedStyle(document.getElementById('loginLoader')).display === 'none', null, { polling: 50 });

    // ★ ตลอดเส้นทาง (ก่อนปล่อยหน้า Loading): ทุกเฟรมที่มีโครงหน้าให้เห็นมีตัวคลุมทึบเต็มจอ — ตั้งแต่เฟรมแรกที่มีโครงหน้า
    const a = analyze(await page.evaluate(() => window.__frames), tRelease);
    expect(a.first.covered, `${name}: เฟรมแรกที่มีโครงหน้าต้องถูกคลุมแล้ว (นี่คืออาการที่ผู้ใช้เห็น) — ${JSON.stringify(a.first)}`).toBe('bootCover');
    const gaps = a.fr.filter((f) => !f.covered);
    expect(gaps, `${name}: เฟรมที่เห็นหน้าแอป ${gaps.length} เฟรม`).toEqual([]);
    expect([...a.seen].sort(), `${name}: ต้องเห็นทุกขั้นอย่างน้อยหนึ่งเฟรม (กัน rAF ไม่ทำงานแล้วผ่านเปล่า)`).toEqual(['bootCover', 'branchModal', 'employeeModal', 'loginLoader', 'pinModal'].sort());
    expect(a.fr.length, `${name}: จำนวนเฟรมที่บันทึก`).toBeGreaterThan(30);
    // หลังโหลดเสร็จเห็นแอปปกติ (ไม่ค้างขาว)
    const done = await page.evaluate(() => ({ cover: !!document.getElementById('bootCover'), loader: getComputedStyle(document.getElementById('loginLoader')).display, userLabel: document.getElementById('userLabel').style.display }));
    expect(done, name).toMatchObject({ cover: false, loader: 'none' });

    // ท้ายสุด: เปลี่ยนชื่อระหว่างใช้งานบน PDA ต้องเป็นสีเข้มโปร่งเหมือนเดิม (คลาส ew-white ถูกถอดแม้เพิ่งใช้ในรอบล็อกอิน)
    if (mode === 'pda') {
      const rn = await page.evaluate(() => { openUserLabelSelector(); const ov = document.getElementById('employeeModal'); return { cls: ov.classList.contains('ew-white'), bg: getComputedStyle(ov).backgroundColor }; });
      expect(rn, 'PDA เปลี่ยนชื่อหลังล็อกอิน').toEqual({ cls: false, bg: 'rgba(10, 20, 40, 0.75)' });
    }
    await closeApp(app);
  });
}

test('★ เส้นทางรีโหลดอัตโนมัติ (ข้ามหน้าเลือกสาขา เข้า initAfterLogin ตรง): cover → หน้า Loading ขาว ไม่มีเฟรมที่เห็นหน้าแอป (Desktop + PDA)', async ({ browser }) => {
  for (const [name, mode] of MODES) {
    const { app, release } = await bootHeld(browser, { mode, login: true });
    const { page } = app;
    await waitFrames(page, 5);
    const held = await page.evaluate(() => ({ cover: getComputedStyle(document.getElementById('bootCover')).display, hit: document.elementFromPoint(innerWidth / 2, innerHeight / 2)?.id, loader: getComputedStyle(document.getElementById('loginLoader')).display }));
    expect(held, `${name}: ระหว่างรอ maintenance.json`).toEqual({ cover: 'block', hit: 'bootCover', loader: 'none' });

    release();
    await page.waitForFunction(() => getComputedStyle(document.getElementById('loginLoader')).display !== 'none', null, { polling: 50 });
    await waitFrames(page, 8);
    const ld = await page.evaluate(() => ({ cover: !!document.getElementById('bootCover'), bg: getComputedStyle(document.getElementById('loginLoader')).backgroundColor, branch: getComputedStyle(document.getElementById('branchModal')).display }));
    expect(ld, `${name}: หน้า Loading ขาว · cover ถูกเอาออก · ไม่ผ่านหน้าเลือกสาขา`).toEqual({ cover: false, bg: 'rgb(255, 255, 255)', branch: 'none' });
    const px = await pixels(page);
    expect(allWhite(px), `${name}: พิกเซลหน้า Loading ริมจอขาว`).toBe(true);

    const tRelease = await page.evaluate(() => { const t = performance.now(); window.__release(); return t; });
    await page.waitForFunction(() => window.__loginDone === true, null, { polling: 50 });
    const a = analyze(await page.evaluate(() => window.__frames), tRelease);
    expect(a.first.covered, `${name}: เฟรมแรกที่มีโครงหน้าถูกคลุมแล้ว — ${JSON.stringify(a.first)}`).toBe('bootCover');
    expect(a.fr.filter((f) => !f.covered), `${name}: เฟรมที่เห็นหน้าแอป`).toEqual([]);
    expect([...a.seen].sort(), name).toEqual(['bootCover', 'loginLoader']);
    await closeApp(app);
  }
});

test('★ สวิตช์ปิด (LOGIN_WHITE_FLOW=false) = เดิมจริง: ไม่มีคลาส/ฉากขาว · เห็นโครงหน้าก่อนหน้าเลือกสาขา · หน้าเลือกชื่อเข้มโปร่ง · หน้า Loading #f0f4f8 · ตัวตรวจเฟรมจับความต่างได้ (control)', async ({ browser }) => {
  const html = fs.readFileSync(INDEX, 'utf8');
  expect(html.split(SWITCH_OFF[0]).length - 1, 'ข้อความที่ใช้แทนที่ต้องมีหนึ่งแห่ง ไม่งั้น "ปิดสวิตช์" ในเทสนี้ไม่ได้ปิดอะไร').toBe(1);

  const { app, release } = await bootHeld(browser, { mode: 'desktop', rewrite: SWITCH_OFF });
  const { page } = app;
  await waitFrames(page, 5);
  const held = await page.evaluate(() => ({
    sw: LOGIN_WHITE_FLOW, htmlClass: document.documentElement.classList.contains('login-white'),
    coverDisplay: getComputedStyle(document.getElementById('bootCover')).display,
    center: document.elementFromPoint(innerWidth / 2, 120)?.closest('.container') != null,   // เห็น/โดนโครงหน้า (พฤติกรรมเดิม)
  }));
  expect(held, 'ปิดสวิตช์: ไม่มีคลาส ไม่มี cover เห็นโครงหน้า').toEqual({ sw: false, htmlClass: false, coverDisplay: 'none', center: true });
  expect(allWhite(await pixels(page, { grid: true })), 'control: เฟรมแรกตอนปิดสวิตช์ต้อง "ไม่ขาว" (ตัวตรวจพิกเซลมองเห็นโครงหน้าได้จริง)').toBe(false);

  release();
  await waitForAppReady(page, { login: false });
  await stubLogin(page);
  await page.waitForFunction(() => getComputedStyle(document.getElementById('branchModal')).display !== 'none', null, { polling: 50 });
  await page.click('#branchModal button[onclick="selectBranch(\'SRC\')"]');
  await page.waitForFunction(() => getComputedStyle(document.getElementById('pinModal')).display !== 'none', null, { polling: 50 });
  await page.fill('#pinInput', await page.evaluate(() => BRANCH_PINS.SRC));
  await page.press('#pinInput', 'Enter');
  await page.waitForFunction(() => getComputedStyle(document.getElementById('employeeModal')).display !== 'none', null, { polling: 50 });
  await waitFrames(page, 8);
  const emp = await page.evaluate(() => { const o = getComputedStyle(document.getElementById('employeeModal')); return { cls: document.getElementById('employeeModal').classList.contains('ew-white'), bg: o.backgroundColor, anim: o.animationName }; });
  expect(emp, 'ปิดสวิตช์: หน้าเลือกชื่อเข้มโปร่งเดิม').toEqual({ cls: false, bg: 'rgba(10, 20, 40, 0.75)', anim: 'branchFadeIn' });
  expect(allWhite(await pixels(page)), 'control: ฉากหลังเข้มโปร่งต้องไม่ใช่ขาว').toBe(false);

  await page.click('#employeeAssistantBtns button >> nth=0');
  await page.waitForFunction(() => getComputedStyle(document.getElementById('loginLoader')).display !== 'none', null, { polling: 50 });
  await waitFrames(page, 5);
  expect(await page.evaluate(() => getComputedStyle(document.getElementById('loginLoader')).backgroundColor), 'ปิดสวิตช์: หน้า Loading สีเดิม').toBe('rgb(240, 244, 248)');
  const tRelease = await page.evaluate(() => { const t = performance.now(); window.__release(); return t; });
  await page.waitForFunction(() => getComputedStyle(document.getElementById('loginLoader')).display === 'none', null, { polling: 50 });

  // control ของตัวตรวจเฟรม: โค้ดเดิมต้องมีเฟรมที่เห็นหน้าแอป (ก่อนหน้าเลือกสาขา + ตอนหน้าเลือกชื่อเข้มโปร่ง) — ถ้าไม่มี แปลว่าตัวตรวจไม่ได้ตรวจอะไร
  const a = analyze(await page.evaluate(() => window.__frames), tRelease);
  expect(a.first.covered, 'ปิดสวิตช์: เฟรมแรกที่มีโครงหน้าไม่ถูกคลุม (เห็นโครงหน้าเปล่า)').toBe(false);
  expect(a.fr.filter((f) => !f.covered).length, 'ปิดสวิตช์: ต้องมีเฟรมที่เห็นหน้าแอปหลายเฟรม').toBeGreaterThan(5);
  await closeApp(app);
});
