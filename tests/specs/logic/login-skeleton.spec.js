// โหลดทั้งหน้าหลังใส่ PIN — Skeleton โครงหน้าจริง (ต.ค. 2026 · ผู้ใช้เลือกแบบที่ 4 · สวิตช์ LOGIN_SKELETON_LOADER)
//
// เดิม: ใส่ PIN + เลือกชื่อแล้วหน้าหลักโผล่ทั้งที่ข้อมูลยังโหลดไม่เสร็จ (loader เดิมมีแค่ในกรอบ RESULT และเฉพาะบาง role)
// ใหม่: #loginSkeleton คลุมทั้งจอตั้งแต่เริ่ม initAfterLogin จนจบ (ปิดใน finally) + ป้ายขั้นตอนตรงกับลำดับ await จริง
// UI ล้วน — ไม่แตะ state/sync/listener/สแกน · เทสนี้ตรึง:
//   1. ★ ค่าที่ส่งมอบ (สวิตช์เปิด · โครง DOM · z-index ใต้ toast/modal)
//   2. ★ ระหว่างโหลดคลุมทั้งจอจริง + ข้อความเรียงตามขั้นจริง + ปิดเมื่อจบ · loader RESULT เดิมไม่ซ้ำซ้อน
//   3. ★ error กลางทางต้องปิด (ห้ามจอค้าง) · สวิตช์ปิด = เดิมทุกอย่าง
//   4. ★ toast ยังอยู่เหนือ overlay · โครงเลย์เอาต์ Desktop/PDA ไม่ล้น
// ขั้นตอนจริงของ initAfterLogin จำลองด้วย stub ที่บันทึกสถานะ overlay ณ จุดที่ถูกเรียก (ไม่ใช่เดาจากเวลา)
const { test, expect, newAppContext, waitForAppReady, bootBare, closeApp } = require('../../lib/hooks');

async function bootPda(browser) {
  const app = await newAppContext(browser, { login: false, mode: 'pda' });
  await app.page.goto('/index.html');
  await waitForAppReady(app.page, { login: false });
  return app;
}

// รัน initAfterLogin จริงโดย stub เฉพาะจุดที่ต้องรอ cloud/ตั้ง listener · ทุก stub บันทึก "overlay เห็นอยู่ไหม + ข้อความอะไร"
// restoreMode: 'hold' = ค้างจนเรียก __release() · 'ok' = จบทันที · 'fail' = throw
async function arrange(page, { branch = 'SRC', role = 'assistant', skeleton = true, restoreMode = 'hold' } = {}) {
  await page.evaluate(({ branch, role, skeleton, restoreMode }) => {
    LOGIN_SKELETON_LOADER = skeleton;
    // หน้า bare ค้างที่ตัวเลือกสาขา (#branchModal z 9999) — ตอน initAfterLogin จริงปิดไปแล้ว ต้องปิดให้เหมือนกัน ไม่งั้นบัง overlay/toast ในเทส
    document.getElementById('branchModal').style.display = 'none';
    currentBranch = branch; currentRole = role; currentUser = 'T';
    const snap = (tag) => {
      const sk = document.getElementById('loginSkeleton');
      const old = document.getElementById('scanListLoading');
      window.__trace.push({
        tag,
        sk: getComputedStyle(sk).display !== 'none',
        text: sk.querySelector('.ls-st').textContent,
        old: getComputedStyle(old).display !== 'none',
      });
    };
    window.__trace = [];
    const wrap = (name, fn) => { if (typeof window[name] === 'function') window[name] = fn; };
    const orig = window.loadSession;
    window.loadSession = function (...a) { snap('loadSession'); return orig.apply(this, a); };
    window.restoreFromFirestore = () => {
      snap('restore');
      if (restoreMode === 'ok') return Promise.resolve();
      if (restoreMode === 'fail') return Promise.reject(new Error('boom'));
      return new Promise((r) => { window.__release = r; });
    };
    for (const n of ['_loadPharmacyAuditMarkerState', '_loadPharmacyR16Timeline', '_loadWhR16CloudTimelines', '_loadWhWorkflowCloudState', 'loadLocationFromFirestore']) wrap(n, async () => {});
    wrap('startProductMasterListener', () => { snap('listeners'); });
    for (const n of ['startR05Listener', 'startWhMasterListeners', 'startScanSessionListener', 'startWhCountConfirmationListener', 'startWhCountInboxListener',
      'startWhRecheckConfirmationListener', 'startWhRecheckInboxListener', 'startWhConfirmOpsListener', 'startBranchConfirmLockListener',
      'startPharmacyAuditMarkerListener', 'startAdjErpListener', 'startLocationListener']) wrap(n, () => {});
  }, { branch, role, skeleton, restoreMode });
}

const visible = (page) => page.evaluate(() => getComputedStyle(document.getElementById('loginSkeleton')).display !== 'none');

test('★ ค่าที่ส่งมอบ: สวิตช์เปิด · overlay มีอยู่แต่ซ่อน · อยู่ใต้ toast และ modal ทุกตัว · ป้ายอ่านออกเสียงได้', async ({ browser }) => {
  const app = await bootBare(browser);
  const r = await app.page.evaluate(() => {
    const sk = document.getElementById('loginSkeleton');
    const z = (e) => Number(getComputedStyle(e).zIndex);
    const chip = sk.querySelector('.ls-chip');
    return {
      sw: typeof LOGIN_SKELETON_LOADER === 'boolean' ? LOGIN_SKELETON_LOADER : null,
      exists: !!sk, shown: getComputedStyle(sk).display !== 'none',
      pos: getComputedStyle(sk).position,
      zSk: z(sk), zToast: z(document.getElementById('toastContainer')), zPin: z(document.getElementById('pinModal')), zEmp: z(document.getElementById('employeeModal')),
      chipRole: chip.getAttribute('role'), chipLive: chip.getAttribute('aria-live'),
      wrapHidden: sk.querySelector('.ls-wrap').getAttribute('aria-hidden'),
      stats: sk.querySelectorAll('.ls-stats>div').length,
    };
  });
  expect(r).toMatchObject({ sw: true, exists: true, shown: false, pos: 'fixed', chipRole: 'status', chipLive: 'polite', wrapHidden: 'true', stats: 6 });
  expect(r.zSk).toBeLessThan(r.zToast);
  expect(r.zToast).toBeLessThan(r.zPin);
  expect(r.zPin).toBeLessThan(r.zEmp);
  await closeApp(app);
});

test('★ ระหว่างโหลด: คลุมทั้งจอจริง · ข้อความเรียงตามขั้น · ปิดเมื่อจบ · loader RESULT เดิมไม่ซ้ำซ้อน (Desktop เภสัช · PDA ผู้ช่วย)', async ({ browser }) => {
  const cases = [
    { name: 'Desktop เภสัช SRC (เดิมมี loader RESULT)', boot: bootBare, branch: 'SRC', role: 'pharmacist' },
    { name: 'PDA ผู้ช่วย SRC (เดิมมี loader RESULT)', boot: bootPda, branch: 'SRC', role: 'assistant' },
    { name: 'Desktop ผู้ช่วย SRC (เดิมไม่มี loader เลย)', boot: bootBare, branch: 'SRC', role: 'assistant' },
    { name: 'Desktop หัวหน้า WH', boot: bootBare, branch: 'WH', role: 'supervisor' },
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
      const sk = document.getElementById('loginSkeleton');
      const b = sk.getBoundingClientRect();
      const hit = (x, y) => !!document.elementFromPoint(x, y)?.closest('#loginSkeleton');
      const W = innerWidth, H = innerHeight;
      return { box: [b.left, b.top, b.width, b.height], vp: [0, 0, W, H], hits: [hit(2, 2), hit(W - 3, 2), hit(2, H - 3), hit(W - 3, H - 3), hit(W / 2, H / 2)], done: window.__done };
    });
    expect(mid.box, c.name).toEqual(mid.vp);
    expect(mid.hits, `${c.name}: hit-test`).toEqual([true, true, true, true, true]);
    expect(mid.done).toBe(false);

    await page.evaluate(() => window.__release());
    await page.waitForFunction(() => window.__done, null, { polling: 50 });
    expect(await visible(page), `${c.name}: จบแล้วต้องปิด`).toBe(false);

    const tr = await page.evaluate(() => window.__trace);
    expect(tr.map((t) => [t.tag, t.sk, t.text]), c.name).toEqual([
      ['loadSession', true, 'อ่านข้อมูลในเครื่อง…'],
      ['restore', true, 'โหลดข้อมูลจาก Cloud…'],
      ['listeners', true, 'เตรียมหน้าจอ…'],
    ]);
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
    return { err, shown: getComputedStyle(document.getElementById('loginSkeleton')).display !== 'none', trace: window.__trace.map((t) => t.tag) };
  });
  expect(r).toEqual({ err: 'boom', shown: false, trace: ['loadSession', 'restore'] });
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
    await arrange(page, { role: c.role, skeleton: false });
    await page.evaluate(() => { window.__done = false; window.__p = initAfterLogin().then(() => { window.__done = true; }); });
    await page.waitForFunction(() => window.__release, null, { polling: 50 });
    expect(await visible(page), `${c.role}: สวิตช์ปิดต้องไม่มี overlay ระหว่างโหลด`).toBe(false);
    await page.evaluate(() => window.__release());
    await page.waitForFunction(() => window.__done, null, { polling: 50 });
    const tr = await page.evaluate(() => window.__trace);
    expect(tr.every((t) => t.sk === false), `${c.role}: ทุกจุดต้องไม่มี overlay`).toBe(true);
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
  await page.evaluate(() => { LOGIN_SKELETON_LOADER = false; window.__release(); });
  await page.waitForFunction(() => window.__done, null, { polling: 50 });
  expect(await visible(page)).toBe(false);
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

test('โครงตามหน้าจริง: Desktop = การ์ด 6 ใบ + แผงซ้าย · PDA = การ์ด 4 ใบ + ไม่มีแผงซ้าย + ไม่ล้นจอ + ป้ายอยู่ในจอ', async ({ browser }) => {
  const probe = (page) => page.evaluate(() => {
    document.getElementById('loginSkeleton').classList.add('show');
    const sk = document.getElementById('loginSkeleton');
    const vis = (sel) => [...sk.querySelectorAll(sel)].filter((e) => getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().width > 0).length;
    const chip = sk.querySelector('.ls-chip').getBoundingClientRect();
    const doc = document.documentElement;
    return {
      stats: vis('.ls-stats>div'),
      left: getComputedStyle(sk.querySelector('.ls-left')).display !== 'none',
      r2: getComputedStyle(sk.querySelector('.ls-r2')).display !== 'none',
      chipIn: chip.left >= 0 && chip.right <= innerWidth && chip.top >= 0 && chip.bottom <= innerHeight,
      noXScroll: doc.scrollWidth <= doc.clientWidth,
      wrapW: Math.round(sk.querySelector('.ls-wrap').getBoundingClientRect().width), vw: innerWidth,
      sweep: getComputedStyle(sk.querySelector('.ls-sweep'), '::after').animationName,
    };
  });
  const d = await bootBare(browser);
  const rd = await probe(d.page);
  expect(rd).toMatchObject({ stats: 6, left: true, r2: true, chipIn: true, noXScroll: true, sweep: 'lsSweep' });
  expect(rd.wrapW).toBeLessThanOrEqual(1400);
  await closeApp(d);

  const p = await bootPda(browser);
  const rp = await probe(p.page);
  expect(rp).toMatchObject({ stats: 4, left: false, r2: false, chipIn: true, noXScroll: true, wrapW: rp.vw });
  // PDA จริง (UA StockCountPDA → body.pda-power-save): ตัดแสงวิ่งชิ้นใหญ่ ป้ายและจุดยังอยู่
  await p.page.evaluate(() => document.body.classList.add('pda-power-save'));
  const ps = await p.page.evaluate(() => {
    const sk = document.getElementById('loginSkeleton');
    return { sweepAfter: getComputedStyle(sk.querySelector('.ls-sweep'), '::after').display, chip: getComputedStyle(sk.querySelector('.ls-chip')).display };
  });
  expect(ps).toEqual({ sweepAfter: 'none', chip: 'flex' }); // position:absolute → inline-flex ถูก blockify เป็น flex
  await closeApp(p);
});
