// โหลดทั้งหน้าหลังใส่ PIN — วงแหวน + เช็กลิสต์ขั้นตอน (ต.ค. 2026 · ผู้ใช้เลือกแบบที่ 3 แทน Skeleton · สวิตช์ LOGIN_LOADER)
//
// เดิม: ใส่ PIN + เลือกชื่อแล้วหน้าหลักโผล่ทั้งที่ข้อมูลยังโหลดไม่เสร็จ (loader เดิมมีแค่ในกรอบ RESULT และเฉพาะบาง role)
// ใหม่: #loginLoader คลุมทั้งจอตั้งแต่เริ่ม initAfterLogin จนจบ (ปิดใน finally) · วงแหวนหมุนรอบโลโก้ + เช็กลิสต์ 4 ขั้น
//       ที่ติ๊กตามจุด await จริง: อ่านข้อมูลในเครื่อง → โหลดข้อมูลจาก Cloud → ตรวจสอบสถานะการนับ → เตรียมหน้าจอ
// UI ล้วน — ไม่แตะ state/sync/listener/สแกน · เทสนี้ตรึง:
//   1. ★ ค่าที่ส่งมอบ (สวิตช์เปิด · โครง DOM · z-index ใต้ toast/modal · ป้ายอ่านออกเสียง)
//   2. ★ ระหว่างโหลดคลุมทั้งจอจริง + ขั้นเดินตามจุด await จริง (ทุก role/สาขา/อุปกรณ์) + ปิดเมื่อจบ · loader RESULT เดิมไม่ซ้ำซ้อน
//   3. ★ error กลางทางต้องปิด (ห้ามจอค้าง) · สวิตช์ปิด = เดิมทุกอย่าง
//   4. ★ toast ยังอยู่เหนือ overlay · เลย์เอาต์ Desktop (แถว) / PDA (แนวตั้ง) ไม่ล้น/ไม่ขยับระหว่างขั้น · แอนิเมชั่น/reduced-motion
//      16 ต.ค. 2026 (ผู้ใช้สั่ง): แอป PDA (body.pda-power-save) ไม่มีวงแหวนรอบโลโก้ — เหลือโลโก้นิ่ง + เช็กลิสต์ · Desktop/หน้าจอแคบที่ไม่ใช่แอป PDA ยังมีวงแหวน
// ขั้นตอนจริงของ initAfterLogin จำลองด้วย stub ที่บันทึกสถานะของ overlay ณ จุดที่ถูกเรียก (ไม่ใช่เดาจากเวลา)
const { test, expect, newAppContext, waitForAppReady, bootBare, closeApp } = require('../../lib/hooks');

async function bootPda(browser) {
  const app = await newAppContext(browser, { login: false, mode: 'pda' });
  await app.page.goto('/index.html');
  await waitForAppReady(app.page, { login: false });
  return app;
}

const LABELS = ['อ่านข้อมูลในเครื่อง', 'โหลดข้อมูลจาก Cloud', 'ตรวจสอบสถานะการนับ', 'เตรียมหน้าจอ'];
// สถานะรายการที่ต้องเห็น ณ แต่ละจุดของ initAfterLogin (ขั้น i: ก่อนหน้า=done · i=cur · หลังจากนั้น=todo)
const AT = (i) => LABELS.map((_, k) => (k < i ? 'done' : k === i ? 'cur' : 'todo'));

// รัน initAfterLogin จริงโดย stub เฉพาะจุดที่ต้องรอ cloud/ตั้ง listener · ทุก stub บันทึก "overlay เห็นอยู่ไหม + ขั้นไหน"
// restoreMode: 'hold' = ค้างจนเรียก __release() · 'ok' = จบทันที · 'fail' = throw
async function arrange(page, { branch = 'SRC', role = 'assistant', loader = true, restoreMode = 'hold' } = {}) {
  await page.evaluate(({ branch, role, loader, restoreMode }) => {
    LOGIN_LOADER = loader;
    // หน้า bare ค้างที่ตัวเลือกสาขา (#branchModal z 9999) — ตอน initAfterLogin จริงปิดไปแล้ว ต้องปิดให้เหมือนกัน ไม่งั้นบัง overlay/toast ในเทส
    document.getElementById('branchModal').style.display = 'none';
    currentBranch = branch; currentRole = role; currentUser = 'T';
    window.__trace = [];
    const snap = (tag) => {
      const el = document.getElementById('loginLoader');
      const old = document.getElementById('scanListLoading');
      window.__trace.push({
        tag,
        shown: getComputedStyle(el).display !== 'none',
        items: [...el.querySelectorAll('.ll-ck li')].map((li) => li.className),
        step: el.dataset.step,
        sr: el.querySelector('.ll-sr').textContent,
        old: getComputedStyle(old).display !== 'none',
      });
    };
    const wrap = (name, fn) => { if (typeof window[name] === 'function') window[name] = fn; };
    const orig = window.loadSession;
    window.loadSession = function (...a) { snap('load'); return orig.apply(this, a); };
    window.restoreFromFirestore = () => {
      snap('restore');
      if (restoreMode === 'ok') return Promise.resolve();
      if (restoreMode === 'fail') return Promise.reject(new Error('boom'));
      return new Promise((r) => { window.__release = r; });
    };
    // จุดที่ initAfterLogin ไป "ตรวจสอบสถานะการนับ" ต่อจาก restore — สาขายา: marker + R16 timeline · WH: R16 (หัวหน้า) + workflow
    for (const n of ['_loadPharmacyAuditMarkerState', '_loadPharmacyR16Timeline', '_loadWhR16CloudTimelines', '_loadWhWorkflowCloudState']) wrap(n, async () => { snap('state'); });
    wrap('loadLocationFromFirestore', async () => {});
    wrap('startProductMasterListener', () => { snap('listeners'); });
    for (const n of ['startR05Listener', 'startWhMasterListeners', 'startScanSessionListener', 'startWhCountConfirmationListener', 'startWhCountInboxListener',
      'startWhRecheckConfirmationListener', 'startWhRecheckInboxListener', 'startWhConfirmOpsListener', 'startBranchConfirmLockListener',
      'startPharmacyAuditMarkerListener', 'startAdjErpListener', 'startLocationListener']) wrap(n, () => {});
  }, { branch, role, loader, restoreMode });
}

const visible = (page) => page.evaluate(() => getComputedStyle(document.getElementById('loginLoader')).display !== 'none');
const collapse = (tr) => tr.filter((t, i) => !(t.tag === 'state' && tr[i - 1] && tr[i - 1].tag === 'state'));   // 'state' ติดกันหลายครั้ง (marker + R16) = ขั้นเดียว

test('★ ค่าที่ส่งมอบ: สวิตช์เปิด · overlay มีอยู่แต่ซ่อน · 4 ขั้นตามลำดับ · อยู่ใต้ toast และ modal ทุกตัว · ป้ายอ่านออกเสียงได้', async ({ browser }) => {
  const app = await bootBare(browser);
  const r = await app.page.evaluate(() => {
    const el = document.getElementById('loginLoader');
    const z = (e) => Number(getComputedStyle(e).zIndex);
    const sr = el.querySelector('.ll-sr');
    return {
      sw: typeof LOGIN_LOADER === 'boolean' ? LOGIN_LOADER : null,
      exists: !!el, shown: getComputedStyle(el).display !== 'none',
      pos: getComputedStyle(el).position, bg: getComputedStyle(el).backgroundColor,
      zLoader: z(el), zToast: z(document.getElementById('toastContainer')), zPin: z(document.getElementById('pinModal')), zEmp: z(document.getElementById('employeeModal')),
      labels: [...el.querySelectorAll('.ll-ck li')].map((li) => li.textContent.trim()),
      initial: [...el.querySelectorAll('.ll-ck li')].map((li) => li.className),
      ringImg: el.querySelector('.ll-ring img').getAttribute('src'),
      arcs: el.querySelectorAll('.ll-ring svg circle').length,
      srRole: sr.getAttribute('role'), srLive: sr.getAttribute('aria-live'),
      decorative: [el.querySelector('.ll-ring').getAttribute('aria-hidden'), el.querySelector('.ll-ck').getAttribute('aria-hidden')],
      oldSkeleton: !!document.getElementById('loginSkeleton') || typeof LOGIN_SKELETON_LOADER !== 'undefined',
    };
  });
  expect(r).toMatchObject({
    sw: true, exists: true, shown: false, pos: 'fixed', srRole: 'status', srLive: 'polite', arcs: 2, ringImg: 'icon.png',
    decorative: ['true', 'true'], oldSkeleton: false,   // Skeleton เดิมถูกถอดออกหมด (ไม่ค้างโค้ด/สวิตช์เก่า)
  });
  expect(r.bg).not.toMatch(/rgba\(.*,\s*0(\.\d+)?\)$/);          // พื้นทึบ — ไม่เห็นหน้าหลังระหว่างโหลด
  expect(r.labels).toEqual(LABELS);
  expect(r.initial).toEqual(['todo', 'todo', 'todo', 'todo']);
  expect(r.zLoader).toBeLessThan(r.zToast);
  expect(r.zToast).toBeLessThan(r.zPin);
  expect(r.zPin).toBeLessThan(r.zEmp);
  await closeApp(app);
});

test('★ ระหว่างโหลด: คลุมทั้งจอจริง · ขั้นเดินตามจุด await จริง · ปิดเมื่อจบ · loader RESULT เดิมไม่ซ้ำซ้อน (ทุก role/สาขา/อุปกรณ์)', async ({ browser }) => {
  const cases = [
    { name: 'Desktop เภสัช SRC (เดิมมี loader RESULT)', boot: bootBare, branch: 'SRC', role: 'pharmacist' },
    { name: 'PDA ผู้ช่วย SRC (เดิมมี loader RESULT)', boot: bootPda, branch: 'SRC', role: 'assistant' },
    { name: 'Desktop ผู้ช่วย SRC (เดิมไม่มี loader เลย)', boot: bootBare, branch: 'SRC', role: 'assistant' },
    { name: 'Desktop หัวหน้า WH', boot: bootBare, branch: 'WH', role: 'supervisor' },
    { name: 'PDA คลัง WH (เดิมมี loader RESULT)', boot: bootPda, branch: 'WH', role: 'warehouse' },
  ];
  for (const c of cases) {
    const app = await c.boot(browser);
    const { page } = app;
    await arrange(page, { branch: c.branch, role: c.role });
    expect(await visible(page), `${c.name}: ก่อนเริ่มต้องซ่อน`).toBe(false);

    await page.evaluate(() => { window.__done = false; window.__p = initAfterLogin().then(() => { window.__done = true; }); });
    await page.waitForFunction(() => window.__release, null, { polling: 50 });

    // กำลังรอ cloud: overlay คลุมเต็มจอ — ทุกมุมและกลางจอ hit-test เจอ overlay (กดทะลุไปหน้าหลังไม่ได้)
    const mid = await page.evaluate(() => {
      const el = document.getElementById('loginLoader');
      const b = el.getBoundingClientRect();
      const hit = (x, y) => !!document.elementFromPoint(x, y)?.closest('#loginLoader');
      const W = innerWidth, H = innerHeight;
      return { box: [b.left, b.top, b.width, b.height], vp: [0, 0, W, H], hits: [hit(2, 2), hit(W - 3, 2), hit(2, H - 3), hit(W - 3, H - 3), hit(W / 2, H / 2)], done: window.__done };
    });
    expect(mid.box, c.name).toEqual(mid.vp);
    expect(mid.hits, `${c.name}: hit-test`).toEqual([true, true, true, true, true]);
    expect(mid.done).toBe(false);

    await page.evaluate(() => window.__release());
    await page.waitForFunction(() => window.__done, null, { polling: 50 });
    expect(await visible(page), `${c.name}: จบแล้วต้องปิด`).toBe(false);

    const tr = collapse(await page.evaluate(() => window.__trace));
    // ★ ขั้นเดินตามจุด await จริง: อ่านในเครื่อง → (รอ Cloud) → ตรวจสถานะ → ตั้ง listener
    expect(tr.map((t) => [t.tag, t.shown, t.step, t.items]), c.name).toEqual([
      ['load', true, '0', AT(0)],
      ['restore', true, '1', AT(1)],
      ['state', true, '2', AT(2)],
      ['listeners', true, '3', AT(3)],
    ]);
    expect(tr.map((t) => t.sr), `${c.name}: ป้ายอ่านออกเสียงตามขั้น`).toEqual(LABELS.map((l) => 'กำลัง' + l));
    expect(tr.every((t) => t.old === false), `${c.name}: loader RESULT เดิมต้องไม่ขึ้นซ้อนใต้ overlay`).toBe(true);
    await closeApp(app);
  }
});

test('★ error กลางทาง → overlay ต้องปิด (ห้ามจอค้าง) · error ยังโยนออกเหมือนเดิม', async ({ browser }) => {
  const app = await bootBare(browser);
  const { page } = app;
  await arrange(page, { restoreMode: 'fail' });
  const r = await page.evaluate(async () => {
    let err = null;
    try { await initAfterLogin(); } catch (e) { err = e.message; }
    return { err, shown: getComputedStyle(document.getElementById('loginLoader')).display !== 'none', trace: window.__trace.map((t) => t.tag) };
  });
  expect(r).toEqual({ err: 'boom', shown: false, trace: ['load', 'restore'] });
  await closeApp(app);
});

test('★ สวิตช์ปิด = เดิมทุกอย่าง: ไม่มี overlay เลย · loader RESULT เดิมกลับมา (เภสัช Desktop / PDA ผู้ช่วย) · ผู้ช่วย Desktop ไม่มี loader', async ({ browser }) => {
  const cases = [
    { boot: bootBare, role: 'pharmacist', wantOld: true },
    { boot: bootPda, role: 'assistant', wantOld: true },
    { boot: bootBare, role: 'assistant', wantOld: false },
  ];
  for (const c of cases) {
    const app = await c.boot(browser);
    const { page } = app;
    await arrange(page, { role: c.role, loader: false });
    await page.evaluate(() => { window.__done = false; window.__p = initAfterLogin().then(() => { window.__done = true; }); });
    await page.waitForFunction(() => window.__release, null, { polling: 50 });
    expect(await visible(page), `${c.role}: สวิตช์ปิดต้องไม่มี overlay ระหว่างโหลด`).toBe(false);
    await page.evaluate(() => window.__release());
    await page.waitForFunction(() => window.__done, null, { polling: 50 });
    const tr = await page.evaluate(() => window.__trace);
    expect(tr.every((t) => t.shown === false), `${c.role}: ทุกจุดต้องไม่มี overlay`).toBe(true);
    expect(tr.find((t) => t.tag === 'restore').old, `${c.role}: loader RESULT เดิม`).toBe(c.wantOld);
    expect(await page.evaluate(() => getComputedStyle(document.getElementById('scanListLoading')).display), 'ปิดท้ายต้องหาย').toBe('none');
    await closeApp(app);
  }
});

test('สวิตช์ถูกสลับปิดกลางทาง → overlay ที่เปิดไปแล้วยังถูกปิดตอนจบ (ไม่ผูก finally กับสวิตช์)', async ({ browser }) => {
  const app = await bootBare(browser);
  const { page } = app;
  await arrange(page);
  await page.evaluate(() => { window.__done = false; initAfterLogin().then(() => { window.__done = true; }); });
  await page.waitForFunction(() => window.__release, null, { polling: 50 });
  expect(await visible(page)).toBe(true);
  await page.evaluate(() => { LOGIN_LOADER = false; window.__release(); });
  await page.waitForFunction(() => window.__done, null, { polling: 50 });
  expect(await visible(page)).toBe(false);
  await closeApp(app);
});

test('เปิดซ้ำรอบที่สอง (ล็อกอินใหม่/เปลี่ยนสาขา): เริ่มจากขั้น 0 ใหม่ ไม่ค้างขั้นเดิมของรอบก่อน', async ({ browser }) => {
  const app = await bootBare(browser);
  const { page } = app;
  const r = await page.evaluate(() => {
    const items = () => [...document.querySelectorAll('#loginLoader .ll-ck li')].map((li) => li.className);
    _loginLoaderShow(); _loginLoaderStep(3);
    const first = items();
    _loginLoaderHide();
    _loginLoaderShow();
    return { first, second: items(), step: document.getElementById('loginLoader').dataset.step };
  });
  expect(r.first).toEqual(AT(3));
  expect(r.second).toEqual(AT(0));
  expect(r.step).toBe('0');
  await closeApp(app);
});

test('★ toast ยังอยู่เหนือ overlay ระหว่างโหลด (error/warn ต้องเห็น ไม่ถูกบัง)', async ({ browser }) => {
  for (const boot of [bootBare, bootPda]) {
    const app = await boot(browser);
    const { page } = app;
    await arrange(page);
    await page.evaluate(() => { initAfterLogin(); });
    await page.waitForFunction(() => window.__release, null, { polling: 50 });
    const r = await page.evaluate(() => {
      toast('ทดสอบข้อความระหว่างโหลด', 'error', 8000);
      const t = document.querySelector('#toastContainer .toast');
      const b = t.getBoundingClientRect();
      const top = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
      return { onTop: !!top?.closest('.toast'), inView: b.left >= 0 && b.right <= innerWidth };
    });
    expect(r).toEqual({ onTop: true, inView: true });
    await page.evaluate(() => window.__release());
    await closeApp(app);
  }
});

// วัดเลย์เอาต์จริงของชุดที่แสดงอยู่ — ทุกขั้น 0..3 ต้องอยู่ที่เดิม (ตัวหนาของขั้นปัจจุบันห้ามดันกล่อง/วงแหวนให้ขยับ)
const layout = (page) => page.evaluate(async () => {
  const el = document.getElementById('loginLoader');
  el.classList.add('show');
  const g = (s) => el.querySelector(s).getBoundingClientRect();
  const doc = document.documentElement;
  const steps = [];
  for (let i = 0; i < 4; i++) { _loginLoaderStep(i); const rg = g('.ll-ring'), ck = g('.ll-ck'); steps.push([rg.left, rg.top, ck.left, ck.top, ck.width].map((n) => Math.round(n * 10) / 10)); }
  _loginLoaderStep(1);
  await new Promise((r) => setTimeout(r, 450));   // รอ transition สี 0.25 วิของรายการจบ — ไม่งั้น computed style ยังเป็นค่าระหว่างทาง
  const ring = g('.ll-ring'), ck = g('.ll-ck'), box = g('.ll-box');
  const cs = (s, p) => getComputedStyle(el.querySelector(s), p);
  return {
    steps, vw: innerWidth, vh: innerHeight,
    ring: [ring.left, ring.top, ring.right, ring.bottom, ring.width],
    ck: [ck.left, ck.top, ck.right, ck.bottom],
    box: [box.left, box.top, box.right, box.bottom],
    noXScroll: doc.scrollWidth <= doc.clientWidth && doc.scrollHeight <= doc.clientHeight,
    ringAnim: cs('.ll-ring svg').animationName,
    svgDisplay: cs('.ll-ring svg').display, imgPos: cs('.ll-ring img').position, imgW: g('.ll-ring img').width, imgH: g('.ll-ring img').height,   // ขนาดที่เรนเดอร์จริง (ซ่อน = 0)
    isPdaClass: document.body.classList.contains('pda-power-save'),
    curAnim: cs('li.cur .c').animationName,
    doneBg: cs('li.done .c').backgroundColor, doneMark: cs('li.done .c', '::before').content,
    curBorderTop: cs('li.cur .c').borderTopColor, todoAnim: cs('li.todo .c').animationName,
    fontPx: parseFloat(cs('.ll-ck li').fontSize),
  };
});

// หน้าจอแคบที่ไม่ใช่แอป PDA (เบราว์เซอร์บนมือถือ/หน้าต่างแคบ): ไม่มีคลาส pda-power-save → ต้องยังมีวงแหวน (กติกา "ไม่มีวงแหวน" ผูกกับแอป PDA จริงเท่านั้น)
async function bootNarrowNonPda(browser) {
  const app = await bootBare(browser);
  await app.page.setViewportSize({ width: 390, height: 700 });
  return app;
}

test('โครงตามอุปกรณ์: Desktop = วงแหวนซ้าย/รายการขวา · แอป PDA = โลโก้นิ่งบน/รายการล่าง (ไม่มีวงแหวน) · อยู่กลางจอ ไม่ล้น ไม่ขยับระหว่างขั้น', async ({ browser }) => {
  const d = await bootBare(browser);
  const rd = await layout(d.page);
  // Desktop: แนวนอน — วงแหวนอยู่ซ้ายรายการ และกึ่งกลางแนวตั้งตรงกัน
  expect(rd.ring[2], 'วงแหวนต้องอยู่ซ้ายของรายการ').toBeLessThanOrEqual(rd.ck[0] + 0.5);
  expect(Math.abs((rd.ring[1] + rd.ring[3]) / 2 - (rd.ck[1] + rd.ck[3]) / 2)).toBeLessThan(2);
  expect(rd.ring[4]).toBe(132);
  expect(rd.steps.every((s) => JSON.stringify(s) === JSON.stringify(rd.steps[0])), `ตำแหน่งต้องเท่ากันทุกขั้น: ${JSON.stringify(rd.steps)}`).toBe(true);
  // กลางจอ
  expect(Math.abs((rd.box[0] + rd.box[2]) / 2 - rd.vw / 2)).toBeLessThan(2);
  expect(Math.abs((rd.box[1] + rd.box[3]) / 2 - rd.vh / 2)).toBeLessThan(2);
  expect(rd.noXScroll).toBe(true);
  expect(rd).toMatchObject({ isPdaClass: false, svgDisplay: 'block', ringAnim: 'llSpin', curAnim: 'llSpin', doneBg: 'rgb(26, 158, 92)', doneMark: '"✓"', todoAnim: 'none' });
  expect(rd.curBorderTop).toBe('rgba(0, 0, 0, 0)');   // ตัวหมุนของขั้นปัจจุบัน = วงกลมเว้นช่อง (ไม่ใช่วงกลมเต็ม)
  await closeApp(d);

  const p = await bootPda(browser);
  const rp = await layout(p.page);
  // แอป PDA (UA StockCountPDA → body.pda-power-save): ไม่มีวงแหวน — เหลือโลโก้นิ่ง 56px · แนวตั้ง: โลโก้อยู่เหนือรายการ และกึ่งกลางแนวนอนตรงกัน
  expect(rp, 'ต้องเป็นแอป PDA จริง (ไม่ใช่ผ่านเพราะ setup ผิด)').toMatchObject({ isPdaClass: true, svgDisplay: 'none', imgPos: 'static', imgW: 56, imgH: 56 });   // โลโก้ต้องยังเห็นอยู่ (นิ่ง 56px)
  expect(rp.ring[4], 'กล่องโลโก้ = ขนาดโลโก้ (ไม่เหลือที่ว่างของวงแหวน)').toBe(56);
  expect(rp.ring[3], 'โลโก้ต้องอยู่เหนือรายการ').toBeLessThanOrEqual(rp.ck[1] + 0.5);
  expect(Math.abs((rp.ring[0] + rp.ring[2]) / 2 - (rp.ck[0] + rp.ck[2]) / 2)).toBeLessThan(2);
  expect(rp.steps.every((s) => JSON.stringify(s) === JSON.stringify(rp.steps[0])), `ตำแหน่งต้องเท่ากันทุกขั้น: ${JSON.stringify(rp.steps)}`).toBe(true);
  expect(rp.box[0]).toBeGreaterThanOrEqual(0);
  expect(rp.box[2]).toBeLessThanOrEqual(rp.vw);
  expect(rp.box[1]).toBeGreaterThanOrEqual(0);
  expect(rp.box[3]).toBeLessThanOrEqual(rp.vh);
  expect(rp.noXScroll).toBe(true);
  expect(rp.fontPx).toBeLessThan(rd.fontPx);   // PDA ตัวอักษรเล็กลงเล็กน้อย
  await closeApp(p);
});

test('หน้าจอแคบที่ไม่ใช่แอป PDA (390px · ไม่มีคลาส PDA): ยังมีวงแหวนหมุนเหมือนเดิม · แนวตั้ง', async ({ browser }) => {
  const n = await bootNarrowNonPda(browser);
  const rn = await layout(n.page);
  expect(rn).toMatchObject({ isPdaClass: false, svgDisplay: 'block', ringAnim: 'llSpin', curAnim: 'llSpin' });
  expect(rn.ring[4]).toBe(112);                      // ขนาดวงแหวนช่วง ≤600px เดิม
  expect(rn.ring[3]).toBeLessThanOrEqual(rn.ck[1] + 0.5);
  expect(rn.noXScroll).toBe(true);
  await closeApp(n);
});

test('แอนิเมชั่น: Desktop วงแหวนหมุน · แอป PDA ไม่มีวงแหวน (ตัวหมุนเล็กของขั้นปัจจุบันยังหมุน = สัญญาณว่าไม่ค้าง) · reduced-motion หยุดทั้งหมด', async ({ browser }) => {
  const d = await bootBare(browser);
  expect(await d.page.evaluate(() => document.body.classList.contains('pda-power-save'))).toBe(false);
  const ds = await layout(d.page);
  expect([ds.svgDisplay, ds.ringAnim, ds.curAnim]).toEqual(['block', 'llSpin', 'llSpin']);
  await d.page.emulateMedia({ reducedMotion: 'reduce' });
  const dr = await layout(d.page);
  expect([dr.ringAnim, dr.curAnim], 'Desktop reduced-motion: ไม่มีอะไรหมุน').toEqual(['none', 'none']);
  expect(dr.doneBg).toBe('rgb(26, 158, 92)');       // ความคืบหน้ายังอ่านได้จากรายการ
  await closeApp(d);

  const p = await bootPda(browser);
  const ps = await layout(p.page);
  // PDA: วงแหวน display:none (ไม่ได้เรนเดอร์ = ไม่มีทั้งภาพและแอนิเมชั่น) · ตัวหมุนเล็กข้างขั้นปัจจุบันยังหมุน
  expect([ps.isPdaClass, ps.svgDisplay, ps.curAnim]).toEqual([true, 'none', 'llSpin']);
  await p.page.emulateMedia({ reducedMotion: 'reduce' });
  const pr = await layout(p.page);
  expect([pr.svgDisplay, pr.curAnim], 'PDA reduced-motion: ตัวหมุนเล็กหยุดด้วย').toEqual(['none', 'none']);
  await closeApp(p);
});
