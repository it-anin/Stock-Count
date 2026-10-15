// ปิดช่องสแกนระหว่างหน้าโหลดหลังใส่ PIN (ต.ค. 2026 · ผู้ใช้อนุมัติแผนตามกฎ 1 · สวิตช์ LOGIN_SCAN_BLOCK)
//
// ช่องโหว่เดิม (ตรวจจริง 15 ต.ค. 2026): พื้นทึบของ #loginLoader เป็นแค่ภาพ — สแกนจาก PDA (Intent → receiveBarcode) หรือคีย์บอร์ด-เวดจ์
// ผ่านถึง handleBarcode ได้ ทั้งที่ catalog/R01/R05/session ยังโหลดไม่ครบ → กลายเป็น Unknown ลับหลังหน้าโหลด
// แก้: _blockScanForBranchConfirm (ด่านกลางของทุกทางสแกน) ตอบ "บล็อก" เมื่อหน้าโหลดแสดงอยู่ (_loginLoaderActive) → ทิ้งสแกน + beep + toast
//   พฤติกรรมตอนบล็อก = เหมือน Confirm lock เดิม: receiveBarcode ทิ้ง · processScan ล้างช่อง ไม่เข้าคิว · ของที่ค้างใน scanQueue อยู่ต่อแล้วเดินต่อหลังปล่อย
// เทสนี้ตรึง:
//   1. ค่าที่ส่งมอบ + ตอนปกติ (ไม่โหลด) สแกนผ่านเหมือนเดิม (ตัวควบคุมของเทสลบ)
//   2. ★ ระหว่างโหลด ทิ้งสแกนทุกทาง: Intent · Enter · พิมพ์ความเร็ว PDA (debounce) · handleBarcode ตรง — เตือนครั้งเดียวต่อ 2 วิ (Desktop + PDA)
//   3. ★ คิวที่ค้างไม่ถูกประมวลผลระหว่างโหลด และเดินต่อหลังปล่อย
//   4. ★ ธงถูกปล่อยเสมอ: initAfterLogin จริง จบปกติ / error / ค้างแล้วปล่อย — สแกนได้อีก (Desktop + PDA)
//   5. สวิตช์ปิด = เดิม (LOGIN_SCAN_BLOCK=false · LOGIN_LOADER=false) · 6. ข้อความ Confirm lock เดิมไม่เปลี่ยน + ลำดับก่อน/หลัง
// "ถูกประมวลผล" วัดจากผลจริง: บาร์โค้ดที่ไม่มีใน catalog ที่ผ่าน handleBarcode จะเพิ่ม state.unknownScans (หน้า bare ไม่มี catalog)
// ใช้ WH/warehouse — สาขายามีด่านเวลาปิดร้าน 21:00–08:00 ใน processScan ทำให้ผลขึ้นกับเวลาที่รันเทส
const { test, expect, newAppContext, waitForAppReady, bootBare, closeApp } = require('../../lib/hooks');

async function bootPda(browser) {
  const app = await newAppContext(browser, { login: false, mode: 'pda' });
  await app.page.goto('/index.html');
  await waitForAppReady(app.page, { login: false });
  return app;
}
const BOOTS = [['Desktop', bootBare], ['PDA', bootPda]];
const B1 = '8850001234567';
const B2 = '8850007654321';
const LOADING_MSG = 'ยังโหลดไม่เสร็จ — รอสักครู่แล้วสแกนใหม่';
const LOCK_MSG = 'กำลัง Confirm ที่ Desktop — รอสักครู่';

// หน้า bare ที่เหมือนหลังเลือกชื่อ · บันทึก toast/beepWarn · รีเซ็ตตัวหน่วงข้อความของด่าน
async function arm(page, { loader = true, scanBlock = true } = {}) {
  await page.evaluate(({ loader, scanBlock }) => {
    LOGIN_LOADER = loader; LOGIN_SCAN_BLOCK = scanBlock;
    document.getElementById('branchModal').style.display = 'none';
    currentBranch = 'WH'; currentRole = 'warehouse'; currentUser = 'T';
    _branchLockToastAt = 0;
    window.__toasts = []; window.__beeps = 0;
    window.toast = (m) => { window.__toasts.push(String(m)); };
    window.beepWarn = () => { window.__beeps++; };
  }, { loader, scanBlock });
}
// รอให้ rAF/debounce ของทางสแกนทำงานจบ (SCAN_DEBOUNCE_MS เป็นค่าคงที่ของแอป) — ใช้ยืนยันว่า "ไม่มีอะไรเกิดขึ้น"
const settle = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, SCAN_DEBOUNCE_MS + 200)))));
const snap = (page) => page.evaluate(({ LOADING_MSG, LOCK_MSG }) => ({
  unknown: state.unknownScans.length, queue: scanQueue.length, input: document.getElementById('scanInput').value,
  loadingToasts: window.__toasts.filter((t) => t === LOADING_MSG).length, lockToasts: window.__toasts.filter((t) => t === LOCK_MSG).length, beeps: window.__beeps,
  active: _loginLoaderActive,
}), { LOADING_MSG, LOCK_MSG });

// รัน initAfterLogin จริงโดย stub เฉพาะจุดที่ต้องรอ cloud/ตั้ง listener (แบบเดียวกับ login-loader.spec) · restoreMode: hold | ok | fail
async function stubInit(page, restoreMode) {
  await page.evaluate((restoreMode) => {
    window.restoreFromFirestore = () => {
      if (restoreMode === 'ok') return Promise.resolve();
      if (restoreMode === 'fail') return Promise.reject(new Error('boom'));
      return new Promise((r) => { window.__release = r; });
    };
    for (const n of ['_loadPharmacyAuditMarkerState', '_loadPharmacyR16Timeline', '_loadWhR16CloudTimelines', '_loadWhWorkflowCloudState', 'loadLocationFromFirestore']) if (typeof window[n] === 'function') window[n] = async () => {};
    for (const n of ['startProductMasterListener', 'startR05Listener', 'startWhMasterListeners', 'startScanSessionListener', 'startWhCountConfirmationListener', 'startWhCountInboxListener',
      'startWhRecheckConfirmationListener', 'startWhRecheckInboxListener', 'startWhConfirmOpsListener', 'startBranchConfirmLockListener',
      'startPharmacyAuditMarkerListener', 'startAdjErpListener', 'startLocationListener']) if (typeof window[n] === 'function') window[n] = () => {};
  }, restoreMode);
}

test('ค่าที่ส่งมอบ: สวิตช์เปิด · ธงปิด · ตอนปกติ (ไม่โหลด) ด่านไม่บล็อกและสแกนผ่านเหมือนเดิม (ตัวควบคุมของเทสลบ)', async ({ browser }) => {
  const app = await bootBare(browser);
  const { page } = app;
  expect(await page.evaluate(() => [typeof LOGIN_SCAN_BLOCK, LOGIN_SCAN_BLOCK, _loginLoaderActive, _blockScanForBranchConfirm(false)])).toEqual(['boolean', true, false, false]);
  await arm(page);
  await page.evaluate((b) => receiveBarcode(b), B1);
  await page.waitForFunction(() => state.unknownScans.length === 1, null, { polling: 50 });   // ผ่านถึง handleBarcode จริง → ตัววัด "ถูกประมวลผล" ใช้ได้
  const s = await snap(page);
  expect(s).toMatchObject({ unknown: 1, queue: 0, loadingToasts: 0, lockToasts: 0, beeps: 0, active: false });
  await closeApp(app);
});

test('★ ระหว่างโหลด ทิ้งสแกนทุกทาง: Intent · Enter · พิมพ์ความเร็ว PDA · handleBarcode ตรง — ไม่เข้าคิว ไม่เป็น Unknown · เตือนครั้งเดียว (Desktop + PDA)', async ({ browser }) => {
  for (const [name, boot] of BOOTS) {
    const app = await boot(browser);
    const { page } = app;
    await arm(page);
    await page.evaluate(() => _loginLoaderShow());
    expect(await page.evaluate(() => _loginLoaderActive), `${name}: ธงเปิดพร้อมหน้าโหลด`).toBe(true);

    await page.evaluate((b) => {
      const inp = document.getElementById('scanInput');
      receiveBarcode(b);                                                       // 1) PDA Intent
      inp.value = b; processScan();                                            // 2) Enter / ปุ่ม (ผ่าน processScan)
      inp.value = b; inp.dispatchEvent(new Event('input', { bubbles: true }));  // 3) พิมพ์ความเร็ว PDA: 2 ตัวห่าง < 50ms → _pdaMode → debounce → processScan
      inp.value = b; inp.dispatchEvent(new Event('input', { bubbles: true }));
      handleBarcode({ location: '', barcode: b, qty: null });                   // 4) ตรงเข้า handleBarcode
    }, B1);
    await settle(page);

    const s = await snap(page);
    expect(s, `${name}: ไม่มีอะไรถูกประมวลผล`).toMatchObject({ unknown: 0, queue: 0, input: '' });
    expect(s.loadingToasts, `${name}: เตือนครั้งเดียวต่อ 2 วิ (หลายทางสแกนติดกัน)`).toBe(1);
    expect(s.beeps, `${name}: beep ครั้งเดียว`).toBe(1);
    expect(s.lockToasts, `${name}: ไม่ใช่ข้อความ Confirm lock`).toBe(0);
    await closeApp(app);
  }
});

test('★ เตือนซ้ำได้เมื่อพ้นช่วงหน่วง 2 วิ (ไม่ใช่ปิดเสียงถาวร)', async ({ browser }) => {
  const app = await bootBare(browser);
  const { page } = app;
  await arm(page);
  const r = await page.evaluate((b) => {
    _loginLoaderShow();
    receiveBarcode(b); receiveBarcode(b);
    const first = window.__toasts.filter((t) => t.startsWith('ยังโหลด')).length;
    _branchLockToastAt = Date.now() - 2500;          // จำลองว่าผ่านไป 2.5 วิ
    receiveBarcode(b);
    return { first, after: window.__toasts.filter((t) => t.startsWith('ยังโหลด')).length };
  }, B1);
  expect(r).toEqual({ first: 1, after: 2 });
  await closeApp(app);
});

test('★ คิวที่ค้างอยู่ไม่ถูกประมวลผลระหว่างโหลด (คงอยู่) และเดินต่อหลังปล่อย', async ({ browser }) => {
  const app = await bootBare(browser);
  const { page } = app;
  await arm(page);
  await page.evaluate((b) => { scanQueue.push({ location: '', barcode: b, qty: null }); _loginLoaderShow(); drainQueue(); }, B1);
  await settle(page);
  expect(await snap(page), 'ระหว่างโหลด: คิวไม่ลด ไม่เป็น Unknown').toMatchObject({ unknown: 0, queue: 1, loadingToasts: 0 });   // drainQueue เรียกด่านแบบเงียบ (showMessage=false)
  await page.evaluate(() => { _loginLoaderHide(); drainQueue(); });
  await page.waitForFunction(() => state.unknownScans.length === 1 && scanQueue.length === 0, null, { polling: 50 });
  await closeApp(app);
});

test('★ ธงถูกปล่อยเสมอ: initAfterLogin จริง ค้างแล้วปล่อย / จบปกติ / error — ระหว่างค้างบล็อก หลังจบสแกนได้อีก (Desktop + PDA)', async ({ browser }) => {
  for (const [name, boot] of BOOTS) {
    // ก) ค้างที่ restore → บล็อก → ปล่อย → จบ → สแกนได้
    let app = await boot(browser);
    await arm(app.page);
    await stubInit(app.page, 'hold');
    await app.page.evaluate(() => { window.__done = false; initAfterLogin().then(() => { window.__done = true; }); });
    await app.page.waitForFunction(() => window.__release, null, { polling: 50 });
    await app.page.evaluate((b) => receiveBarcode(b), B1);
    await settle(app.page);
    expect(await snap(app.page), `${name}: ระหว่าง initAfterLogin ค้าง`).toMatchObject({ unknown: 0, queue: 0, loadingToasts: 1, active: true });
    await app.page.evaluate(() => window.__release());
    await app.page.waitForFunction(() => window.__done, null, { polling: 50 });
    expect(await app.page.evaluate(() => _loginLoaderActive), `${name}: จบแล้วปล่อยธง`).toBe(false);
    await app.page.evaluate((b) => receiveBarcode(b), B2);
    await app.page.waitForFunction(() => state.unknownScans.length === 1, null, { polling: 50 });
    await closeApp(app);

    // ข) error กลางทาง (finally ต้องปล่อยธง)
    app = await boot(browser);
    await arm(app.page);
    await stubInit(app.page, 'fail');
    const err = await app.page.evaluate(async () => { try { await initAfterLogin(); return null; } catch (e) { return e.message; } });
    expect(err, `${name}: error ยังโยนออกเหมือนเดิม`).toBe('boom');
    expect(await app.page.evaluate(() => _loginLoaderActive), `${name}: error แล้วต้องปล่อยธง`).toBe(false);
    await app.page.evaluate((b) => receiveBarcode(b), B1);
    await app.page.waitForFunction(() => state.unknownScans.length === 1, null, { polling: 50 });
    await closeApp(app);
  }
});

test('สวิตช์ปิด = พฤติกรรมเดิม: LOGIN_SCAN_BLOCK=false สแกนผ่านระหว่างหน้าโหลด · LOGIN_LOADER=false ไม่มีหน้าโหลด/ไม่ตั้งธง', async ({ browser }) => {
  let app = await bootBare(browser);
  await arm(app.page, { scanBlock: false });
  await app.page.evaluate((b) => { _loginLoaderShow(); receiveBarcode(b); }, B1);
  await app.page.waitForFunction(() => state.unknownScans.length === 1, null, { polling: 50 });
  expect(await snap(app.page)).toMatchObject({ unknown: 1, loadingToasts: 0, beeps: 0, active: true });   // หน้าโหลดยังขึ้น (ธงเปิด) แต่สวิตช์ปิดไม่บล็อก
  await closeApp(app);

  app = await bootBare(browser);
  await arm(app.page, { loader: false });
  await stubInit(app.page, 'hold');
  await app.page.evaluate(() => { window.__done = false; initAfterLogin().then(() => { window.__done = true; }); });
  await app.page.waitForFunction(() => window.__release, null, { polling: 50 });
  expect(await app.page.evaluate(() => [_loginLoaderActive, getComputedStyle(document.getElementById('loginLoader')).display])).toEqual([false, 'none']);
  await app.page.evaluate((b) => receiveBarcode(b), B1);
  await app.page.waitForFunction(() => state.unknownScans.length === 1, null, { polling: 50 });   // ระหว่าง restore ค้าง สแกนผ่านเหมือนวันนี้
  await app.page.evaluate(() => window.__release());
  await app.page.waitForFunction(() => window.__done, null, { polling: 50 });
  await closeApp(app);
});

test('ข้อความ Confirm lock เดิมไม่เปลี่ยน · หน้าโหลดตรวจก่อน (ข้อความโหลดชนะ) · ปล่อยหน้าโหลดแล้วข้อความ Confirm lock กลับมา', async ({ browser }) => {
  const app = await bootBare(browser);
  const { page } = app;
  await arm(page);
  const r = await page.evaluate((b) => {
    const T = () => window.__toasts.slice();
    const out = {};
    _branchScanPaused = true;                                   // เหมือนตอนอีกเครื่องกำลัง Confirm
    receiveBarcode(b); out.lockOnly = T(); window.__toasts = []; _branchLockToastAt = 0;
    _loginLoaderShow();
    receiveBarcode(b); out.both = T(); window.__toasts = []; _branchLockToastAt = 0;
    _loginLoaderHide();
    receiveBarcode(b); out.lockAgain = T();
    _branchScanPaused = false;
    out.unknown = state.unknownScans.length;
    return out;
  }, B1);
  expect(r.lockOnly).toEqual([LOCK_MSG]);
  expect(r.both).toEqual([LOADING_MSG]);
  expect(r.lockAgain).toEqual([LOCK_MSG]);
  expect(r.unknown, 'ทั้งสามช่วงสแกนไม่ถูกประมวลผล').toBe(0);
  await closeApp(app);
});
