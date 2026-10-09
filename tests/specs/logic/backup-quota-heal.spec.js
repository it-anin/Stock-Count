// backup ในเครื่อง (localStorage) เต็ม → "แบ็คอัพล้มเหลว" ทุกรอบ save (ต.ค. 2026 · ผู้ใช้สั่ง)
// เคสจริง: Desktop ใช้ 5,220,607 จากโควต้า 5,242,880 ตัวอักษร = backup ครบ 4 สาขา (4.68M) + _whFocusDebugLog 543,050 (log debug 8 ต.ค.
// ที่ลบโค้ดแล้วแต่ข้อมูลค้าง) → backup ของสาขาที่เปิดอยู่ (2.2M) เขียนไม่ได้ (QuotaExceededError)
// ตรึง: ① เปิดแอปลบคีย์ที่ไม่มีโค้ดอ่านแล้ว ② save เต็ม → ลบให้น้อยที่สุด (คีย์เก่าก่อน → backup สาขาอื่น) แล้วเขียนซ้ำ
//   ★ ห้ามลบ backup ของสาขาที่เปิดอยู่ · ★ ห้ามลบเมื่อ error ไม่ใช่โควต้า/ยังไม่เลือกสาขา · ★ รูปแบบ backup เดิมทุก field (loadSession อ่านกลับได้)
//   ★ เลือกสาขาตอนเต็มต้องไม่ค้าง · ★ สวิตช์ปิด = ไม่ลบอะไร + ข้อความเดิม
const { test, expect, bootBare, newAppContext, waitForAppReady, closeApp } = require('../../lib/hooks');

const LEGACY = ['_whFocusDebugLog', 'stockCountSession', 'googleSheetTitle', 'googleSpreadsheetUrl', 'googleSpreadsheetId'];

// ทุกเทสใช้ helper ชุดเดียวกันในหน้า: เติม storage ให้เต็มพอดี · ห่อ toast ไว้นับ · ปิด sync (_adminMode) ไม่ให้ saveSession ตั้ง timer ขึ้น Cloud
async function setup(page) {
  await page.evaluate(() => {
    window.__toasts = []; window.__realToast = window.__realToast || toast;
    toast = (m, t) => { window.__toasts.push(`${t || 'info'}|${m}`); };
    _adminMode = true; _backupFailToastAt = 0; localStorage.clear();
    // เติมคีย์ที่ระบุจนเต็มพอดี (คีย์แรกๆ ได้ share ตัวอักษร · คีย์สุดท้ายหาขนาดใหญ่สุดที่ยังเขียนได้)
    window.__fillExactly = (keys, share) => {
      for (const k of keys.slice(0, -1)) localStorage.setItem(k, 'x'.repeat(share));
      const last = keys[keys.length - 1]; let lo = 0, hi = LOCAL_STORAGE_QUOTA_CHARS, best = 0;
      while (lo <= hi) { const mid = (lo + hi) >> 1; try { localStorage.setItem(last, 'x'.repeat(mid)); best = mid; lo = mid + 1; } catch (e) { hi = mid - 1; } }
      localStorage.setItem(last, 'x'.repeat(best));
      let roomFor1 = true; try { localStorage.setItem('__probe', 'y'); localStorage.removeItem('__probe'); } catch (e) { roomFor1 = false; }
      return roomFor1;   // false = เต็มจริง
    };
    // สาขาที่เปิดอยู่มีของสแกนจริง → payload ใหม่ใหญ่กว่าสำเนาเดิมในเครื่องแน่นอน
    window.__seedScans = (n) => {
      state.scanData.clear(); scanListMap.clear();
      for (let i = 0; i < n; i++) state.scanData.set('S-' + i, { countedQty: i + 1, status: 'scanning', timestamp: '2026-10-09 10:00:00', scannedBy: 'Tester', auditor: '', auditStatus: 'pending', barcode: 'B-' + i, location: '', retries: 0, scans: [] });
    };
  });
}
const done = (page) => page.evaluate(() => { toast = window.__realToast; _adminMode = false; localStorage.clear(); });
const keys = (page) => page.evaluate(() => _localStorageKeys().sort());

test('ค่าเริ่มต้นที่ส่งมอบ — สวิตช์เปิด · โควต้า 5,242,880 · รายการคีย์เก่า (อ่านจากหน้าที่เพิ่งบูต ไม่ผ่าน seed)', async ({ browser }) => {
  const app = await bootBare(browser);
  expect(await app.page.evaluate(() => [typeof BACKUP_QUOTA_HEAL, BACKUP_QUOTA_HEAL, LOCAL_STORAGE_QUOTA_CHARS, LEGACY_LOCAL_KEYS]))
    .toEqual(['boolean', true, 5242880, LEGACY]);
  await closeApp(app);
});

test('① เปิดแอป: ลบคีย์ที่ไม่มีโค้ดอ่านแล้ว · ไม่แตะ backup ทุกสาขา / selectedBranch / คีย์ที่ไม่รู้จัก', async ({ browser }) => {
  const app = await newAppContext(browser, { login: false });
  const logs = []; app.page.on('console', (m) => logs.push(m.text()));
  await app.context.addInitScript(({ legacy }) => {
    try {
      if (sessionStorage.getItem('__seeded')) return;
      for (const k of legacy) localStorage.setItem(k, 'x'.repeat(k === '_whFocusDebugLog' ? 5000 : 10));
      localStorage.setItem('progressMode_SRC', 'stock100'); localStorage.setItem('progressMode_WH', 'catA');
      localStorage.setItem('stockCountSession_SRC', '{"a":1}'); localStorage.setItem('stockCountSession_WH', '{"b":2}');
      localStorage.setItem('selectedBranch', 'SRC'); localStorage.setItem('someOtherApp', 'keep me');
      sessionStorage.setItem('__seeded', '1');
    } catch (e) {}
  }, { legacy: LEGACY });
  await app.page.goto('/index.html');
  await waitForAppReady(app.page, { login: false });
  expect(await keys(app.page)).toEqual(['selectedBranch', 'someOtherApp', 'stockCountSession_SRC', 'stockCountSession_WH']);
  expect(await app.page.evaluate(() => [localStorage.getItem('stockCountSession_SRC'), localStorage.getItem('stockCountSession_WH')])).toEqual(['{"a":1}', '{"b":2}']);
  expect(logs.some((l) => l.startsWith('[backup] ลบคีย์เก่าใน localStorage:') && l.includes('_whFocusDebugLog') && l.includes('progressMode_WH'))).toBe(true);
  await closeApp(app);
});

test('② เต็มเพราะ backup สาขาอื่น → ลบสาขาอื่น เขียนของสาขาที่เปิดได้ · ไม่เตือน · รูปแบบเดิมทุก field · loadSession อ่านกลับได้', async ({ browser }) => {
  const app = await bootBare(browser);
  const logs = []; app.page.on('console', (m) => logs.push(m.text()));
  await setup(app.page);
  const out = await app.page.evaluate(() => {
    currentBranch = 'WH';
    localStorage.setItem('selectedBranch', 'WH'); localStorage.setItem('stockCountSession_WH', '{"old":1}');
    const full = !__fillExactly(['stockCountSession_SRC', 'stockCountSession_SSS', 'stockCountSession_KKL'], 1500000);
    __seedScans(40);
    saveSession();
    const raw = localStorage.getItem('stockCountSession_WH'), saved = JSON.parse(raw);
    state.scanData.clear(); loadSession();
    return { full, fields: Object.keys(saved), savedS7: saved.scanData['S-7'], reloadedS7: state.scanData.get('S-7')?.countedQty, toasts: window.__toasts };
  });
  expect(out.full).toBe(true);                                   // precondition: เต็มจริงก่อน save
  expect(await keys(app.page)).toEqual(['selectedBranch', 'stockCountSession_WH']);
  expect(out.fields).toEqual(['r01UploadedAt', 'r01Version', 'r01BaselineAt', 'r16SalesMap', 'r16InboundMap', 'r16Loaded', 'r16UploadedAt', 'r16DetailVersion',
    'r16_103Map', 'r16_103Loaded', 'r16_103UploadedAt', 'r16_103DetailVersion', 'countResetAt', 'scanData', 'unknownScans', 'scanListMap']);
  expect(out.savedS7).toMatchObject({ countedQty: 8, status: 'scanning', barcode: 'B-7' });
  expect(out.savedS7.scans).toBeUndefined();                     // ยังตัด retries/scans เหมือนเดิม
  expect(out.reloadedS7).toBe(8);
  expect(out.toasts.filter((t) => t.includes('แบ็คอัพ'))).toEqual([]);
  const healLog = logs.find((l) => l.startsWith('[backup] localStorage เต็ม — ลบเพื่อคืนพื้นที่:')) || '';
  for (const k of ['stockCountSession_SRC', 'stockCountSession_SSS', 'stockCountSession_KKL']) expect(healLog).toContain(k);
  expect(healLog).not.toContain('stockCountSession_WH');
  await done(app.page);
  await closeApp(app);
});

test('② ลบให้น้อยที่สุด — ถ้าลบคีย์เก่าแล้วพอ ต้องไม่ลบ backup ของสาขาอื่น', async ({ browser }) => {
  const app = await bootBare(browser);
  await setup(app.page);
  await app.page.evaluate(() => {
    currentBranch = 'SRC'; localStorage.setItem('stockCountSession_SRC', '{"old":1}');
    localStorage.setItem('_whFocusDebugLog', 'x'.repeat(200000));
    __fillExactly(['stockCountSession_WH'], 0);
    __seedScans(40); saveSession();
  });
  expect(await keys(app.page)).toEqual(['stockCountSession_SRC', 'stockCountSession_WH']);
  expect(await app.page.evaluate(() => JSON.parse(localStorage.getItem('stockCountSession_SRC')).scanData['S-3'].countedQty)).toBe(4);
  expect(await app.page.evaluate(() => window.__toasts.filter((t) => t.includes('แบ็คอัพ')))).toEqual([]);
  await done(app.page);
  await closeApp(app);
});

test('★ ลบอะไรไม่ได้แล้วยังเต็ม → เตือน "พื้นที่เก็บในเครื่องเต็ม" ครั้งเดียว · สำเนาเดิมของสาขาที่เปิดอยู่ต้องไม่ถูกลบ · คีย์ที่ไม่รู้จักไม่ถูกแตะ', async ({ browser }) => {
  const app = await bootBare(browser);
  const logs = []; app.page.on('console', (m) => logs.push(m.text()));
  await setup(app.page);
  const out = await app.page.evaluate(() => {
    currentBranch = 'WH'; localStorage.setItem('selectedBranch', 'WH'); localStorage.setItem('stockCountSession_WH', '{"old":1}');
    const full = !__fillExactly(['someOtherApp'], 0);
    __seedScans(40); saveSession(); saveSession(); saveSession();
    return { full, wh: localStorage.getItem('stockCountSession_WH'), toasts: window.__toasts.filter((t) => t.includes('แบ็คอัพ')) };
  });
  expect(out.full).toBe(true);
  expect(out.wh).toBe('{"old":1}');
  expect(out.toasts).toEqual(['warn|แบ็คอัพล้มเหลว — พื้นที่เก็บในเครื่องเต็ม']);
  // console บอกชื่อ error + ขนาด + การใช้พื้นที่ (ไว้วินิจฉัยโดยไม่ต้องวาง snippet)
  expect(logs.some((l) => /^\[backup\] บันทึกสำรองในเครื่องไม่สำเร็จ: QuotaExceededError .* · ข้อมูล [\d,]+ ตัวอักษร · localStorage ใช้อยู่ [\d,]+ \/ 5,242,880$/.test(l))).toBe(true);
  expect(await keys(app.page)).toEqual(['selectedBranch', 'someOtherApp', 'stockCountSession_WH']);
  await done(app.page);
  await closeApp(app);
});

test('★ error ที่ไม่ใช่โควต้า → ไม่ลบอะไร · ข้อความบอกชื่อ error', async ({ browser }) => {
  const app = await bootBare(browser);
  await setup(app.page);
  const out = await app.page.evaluate(() => {
    currentBranch = 'SRC'; localStorage.setItem('stockCountSession_WH', '{"wh":1}'); localStorage.setItem('_whFocusDebugLog', 'x');
    __seedScans(3); state.scanData.set('BAD', null);           // รวมข้อมูลล้มก่อนถึงขั้นเขียน (TypeError)
    saveSession();
    return window.__toasts.filter((t) => t.includes('แบ็คอัพ'));
  });
  expect(out).toEqual(['warn|แบ็คอัพล้มเหลว (TypeError)']);
  expect(await keys(app.page)).toEqual(['_whFocusDebugLog', 'stockCountSession_WH']);
  await done(app.page);
  await closeApp(app);
});

test('★ ตอนเขียนเจอ error อื่นที่ไม่ใช่โควต้า (เช่น SecurityError) → ไม่ลบ backup สาขาอื่น', async ({ browser }) => {
  const app = await bootBare(browser);
  await setup(app.page);
  const out = await app.page.evaluate(() => {
    currentBranch = 'WH'; localStorage.setItem('stockCountSession_SRC', '{"src":1}'); localStorage.setItem('stockCountSession_WH', '{"old":1}');
    const real = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) { if (k === 'stockCountSession_WH') throw new DOMException('blocked', 'SecurityError'); return real.call(this, k, v); };
    try { __seedScans(5); saveSession(); } finally { Storage.prototype.setItem = real; }
    return window.__toasts.filter((t) => t.includes('แบ็คอัพ'));
  });
  expect(out).toEqual(['warn|แบ็คอัพล้มเหลว (SecurityError)']);
  expect(await keys(app.page)).toEqual(['stockCountSession_SRC', 'stockCountSession_WH']);
  await done(app.page);
  await closeApp(app);
});

test('★ ยังไม่ได้เลือกสาขา → ไม่ลบ backup ของสาขาใดเลยแม้เต็ม', async ({ browser }) => {
  const app = await bootBare(browser);
  await setup(app.page);
  await app.page.evaluate(() => {
    currentBranch = '';
    __fillExactly(['stockCountSession_SRC', 'stockCountSession_WH'], 2000000);
    __seedScans(40); saveSession();
  });
  expect(await keys(app.page)).toEqual(['stockCountSession_SRC', 'stockCountSession_WH']);
  expect(await app.page.evaluate(() => window.__toasts.filter((t) => t.includes('แบ็คอัพ')))).toEqual(['warn|แบ็คอัพล้มเหลว — พื้นที่เก็บในเครื่องเต็ม']);
  await done(app.page);
  await closeApp(app);
});

test('★ เลือกสาขาตอน localStorage เต็มพอดี → ต้องเข้าสาขาต่อได้ ไม่ค้างที่หน้าเลือกสาขา', async ({ browser }) => {
  const app = await bootBare(browser);
  await setup(app.page);
  const out = await app.page.evaluate(async () => {
    localStorage.setItem('selectedBranch', 'WH');
    const full = !__fillExactly(['someOtherApp'], 0);
    currentBranch = 'WH'; _pinVerified = false;
    let threw = null; try { await selectBranch('SRC'); } catch (e) { threw = e.name; }
    return { full, threw, currentBranch, modalHidden: document.getElementById('branchModal').style.display === 'none' };
  });
  expect(out).toEqual({ full: true, threw: null, currentBranch: 'SRC', modalHidden: true });
  await done(app.page);
  await closeApp(app);
});

test('★ สวิตช์ปิด (BACKUP_QUOTA_HEAL=false) → ไม่ลบอะไรเลย · ข้อความเดิม "แบ็คอัพล้มเหลว"', async ({ browser }) => {
  const app = await bootBare(browser);
  await setup(app.page);
  const out = await app.page.evaluate(() => {
    BACKUP_QUOTA_HEAL = false;
    currentBranch = 'WH'; localStorage.setItem('stockCountSession_WH', '{"old":1}'); localStorage.setItem('_whFocusDebugLog', 'x'.repeat(1000));
    __fillExactly(['stockCountSession_SRC'], 0);
    const cleaned = _cleanupLegacyLocalKeys();
    __seedScans(40); saveSession();
    return { cleaned, wh: localStorage.getItem('stockCountSession_WH'), toasts: window.__toasts.filter((t) => t.includes('แบ็คอัพ')) };
  });
  expect(out).toEqual({ cleaned: [], wh: '{"old":1}', toasts: ['warn|แบ็คอัพล้มเหลว'] });
  expect(await keys(app.page)).toEqual(['_whFocusDebugLog', 'stockCountSession_SRC', 'stockCountSession_WH']);
  await done(app.page);
  await closeApp(app);
});
