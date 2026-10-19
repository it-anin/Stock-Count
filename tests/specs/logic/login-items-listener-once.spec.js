// items listener ตอนล็อกอิน (ต.ค. 2026 · สวิตช์ LOGIN_ITEMS_LISTENER_ONCE · ผู้ใช้อนุมัติแผนตามกฎ 1)
// เดิมตอนล็อกอิน items ถูกอ่านซ้ำ 3 รอบ: get() ใน _loadScanItemsFromCloud · listener ที่เริ่มท้าย restoreFromFirestore ·
// listener ที่ถูกทิ้งแล้วสร้างใหม่เพราะ startScanSessionListener() เรียก stopScanSessionListener() ที่หยุด items listener ด้วย
// ตอนนี้: (ก) startScanSessionListener ไม่ทิ้ง items listener ที่ฟัง epoch เดียวกันอยู่ (ข) restoreFromFirestore ไม่เริ่ม listener เอง
//        (ค) listener ที่ error ล้าง handle ทิ้ง — กันไม่ให้ guard "ฟัง epoch นี้อยู่แล้ว" บล็อกการสร้างใหม่ตลอดไป
// ตรึง: ★ เปิด = ไม่สร้าง listener ซ้ำ epoch เดียวกัน · ★ ปิด = พฤติกรรมเดิมเป๊ะ (ทิ้ง-สร้างใหม่) · ★ epoch เปลี่ยน = restart ทั้งสองโหมด
//       ★ selectBranch/Admin (stopScanSessionListener() ไม่ส่งพารามิเตอร์) หยุด items listener เหมือนเดิม · ★ restoreFromFirestore ไม่เริ่ม listener
//       ★ listener ที่ error ถูกสร้างใหม่ได้ · error ของ listener เก่าห้ามล้าง handle ของตัวใหม่
// ใช้ _db / getScanItemsRef ปลอมที่นับการสร้าง-การปล่อย listener — ไม่แตะ Firestore/emulator (logic project)
const { test, expect, bootBare, closeApp } = require('../../lib/hooks');

// ติดตั้งของปลอม: นับ onSnapshot ของ items query + session doc · คืนค่าเดิมด้วย UNINSTALL
const INSTALL = () => {
  const fk = window.__fk = { created: 0, unsub: 0, sessionCreated: 0, sessionUnsub: 0, epochs: [], errCbs: [], getCalls: 0, itemDocs: [] };
  fk.real = { db: _db, ref: window.getScanItemsRef, branch: currentBranch, admin: _adminMode, schema: _schemaVersion, epoch: _countResetAt, warn: console.warn, save: window.saveSession, sync: window.syncToFirestore };
  console.warn = () => {};
  _db = { collection: () => ({ doc: () => ({ onSnapshot: () => { fk.sessionCreated++; return () => { fk.sessionUnsub++; }; } }) }) };
  window.getScanItemsRef = () => ({ where: (f, op, v) => ({
    onSnapshot: (cb, ecb) => { fk.created++; fk.epochs.push(v); fk.errCbs.push(ecb); return () => { fk.unsub++; }; },
    get: async () => { fk.getCalls++; return { forEach: (fn) => fk.itemDocs.forEach((d) => fn({ id: d.sku, data: () => d })) }; },
  }) });
  window.saveSession = () => {}; window.syncToFirestore = async () => true;
  currentBranch = 'SRC'; _adminMode = false; _schemaVersion = SCAN_SCHEMA_V2; _countResetAt = 'E1';
  _scanItemsUnsubscribe = null; _scanItemsListenerEpoch = ''; _scanSessionUnsubscribe = null;
  window.__pick = () => ({ created: fk.created, unsub: fk.unsub, sessionCreated: fk.sessionCreated, sessionUnsub: fk.sessionUnsub, epochs: [...fk.epochs], live: !!_scanItemsUnsubscribe });
};
const UNINSTALL = () => {
  const r = window.__fk.real;
  try { stopScanSessionListener(); stopScanItemsListener(); } catch (e) {}
  _db = r.db; window.getScanItemsRef = r.ref; currentBranch = r.branch; _adminMode = r.admin; _schemaVersion = r.schema; _countResetAt = r.epoch;
  console.warn = r.warn; window.saveSession = r.save; window.syncToFirestore = r.sync; LOGIN_ITEMS_LISTENER_ONCE = true;
  localStorage.clear();
};
// รัน body บนหน้าเว็บ: ติดตั้งของปลอม → ตั้งสวิตช์ → รัน → คืนค่าเดิม (finally)
const run = (page, body, { on }) => page.evaluate(`(async()=>{(${INSTALL})();LOGIN_ITEMS_LISTENER_ONCE=${on ? 'true' : 'false'};try{return await (${body})();}finally{(${UNINSTALL})();}})()`);

test('ค่าเริ่มต้นที่ส่งมอบ — สวิตช์เปิด · stopScanSessionListener รับ keepItems (ไม่ส่ง = หยุดทั้งหมดเหมือนเดิม)', async ({ browser }) => {
  const app = await bootBare(browser);
  expect(await app.page.evaluate(() => [typeof LOGIN_ITEMS_LISTENER_ONCE, LOGIN_ITEMS_LISTENER_ONCE, stopScanSessionListener.length])).toEqual(['boolean', true, 0]);
  expect(await app.page.evaluate(() => stopScanSessionListener.toString().includes('keepItems'))).toBe(true);
  await closeApp(app);
});

test('★ เปิดสวิตช์: startScanSessionListener ไม่ทิ้ง items listener ที่ฟัง epoch เดียวกัน · ปิด = ทิ้งแล้วสร้างใหม่เหมือนเดิม', async ({ browser }) => {
  const app = await bootBare(browser);
  const body = () => { startScanItemsListener(); startScanSessionListener(); return __pick(); };
  const on = await run(app.page, body, { on: true });
  const off = await run(app.page, body, { on: false });
  expect(on).toEqual({ created: 1, unsub: 0, sessionCreated: 1, sessionUnsub: 0, epochs: ['E1'], live: true });   // รอบเดียว ไม่อ่านซ้ำ
  expect(off).toEqual({ created: 2, unsub: 1, sessionCreated: 1, sessionUnsub: 0, epochs: ['E1', 'E1'], live: true });   // พฤติกรรมเดิม: ทิ้งแล้วสร้างใหม่ epoch เดียวกัน
  await closeApp(app);
});

test('★ ไม่มี items listener อยู่ก่อน → startScanSessionListener สร้างให้ 1 ตัว (ทั้งสองโหมด) · เรียกซ้ำเปิดสวิตช์ไม่สร้างเพิ่ม', async ({ browser }) => {
  const app = await bootBare(browser);
  const body = () => { startScanSessionListener(); const first = __pick(); startScanSessionListener(); return { first, second: __pick() }; };
  const on = await run(app.page, body, { on: true });
  const off = await run(app.page, body, { on: false });
  expect(on.first).toMatchObject({ created: 1, unsub: 0, live: true });
  expect(on.second).toMatchObject({ created: 1, unsub: 0, sessionCreated: 2, sessionUnsub: 1, live: true });   // session listener ผูกใหม่ได้ · items คงเดิม
  expect(off.first).toMatchObject({ created: 1, unsub: 0, live: true });
  expect(off.second).toMatchObject({ created: 2, unsub: 1, sessionCreated: 2, sessionUnsub: 1, live: true });
  await closeApp(app);
});

test('★ epoch เปลี่ยนระหว่างนั้น → restart items listener ด้วย epoch ใหม่ (ทั้งสองโหมด) · ห้ามค้างฟัง epoch เก่า', async ({ browser }) => {
  const app = await bootBare(browser);
  const body = () => { startScanItemsListener(); _countResetAt = 'E2'; startScanSessionListener(); return __pick(); };
  for (const on of [true, false]) {
    const r = await run(app.page, body, { on });
    expect(r, `on=${on}`).toEqual({ created: 2, unsub: 1, sessionCreated: 1, sessionUnsub: 0, epochs: ['E1', 'E2'], live: true });
  }
  await closeApp(app);
});

test('★ stopScanSessionListener() ไม่ส่งพารามิเตอร์ (selectBranch / เข้า Admin Mode) หยุด items listener เหมือนเดิม · keepItems=true ไม่หยุด', async ({ browser }) => {
  const app = await bootBare(browser);
  const plainBody = () => { startScanItemsListener(); stopScanSessionListener(); return __pick(); };
  const keepBody = () => { startScanItemsListener(); stopScanSessionListener(true); return __pick(); };
  for (const on of [true, false]) {
    const plain = await run(app.page, plainBody, { on });
    expect(plain, `on=${on} plain`).toMatchObject({ created: 1, unsub: 1, live: false });     // ทุกผู้เรียกเดิม: หยุดทั้งหมด
    const keep = await run(app.page, keepBody, { on });
    expect(keep, `on=${on} keep`).toMatchObject({ created: 1, unsub: 0, live: true });
  }
  await closeApp(app);
});

test('★ listener ที่ error: เปิดสวิตช์ล้าง handle ทิ้ง → เริ่มใหม่ได้ · ปิด = handle ค้าง ไม่สร้างใหม่ (พฤติกรรมเดิม) · error ของตัวเก่าห้ามล้าง handle ของตัวใหม่', async ({ browser }) => {
  const app = await bootBare(browser);
  const body = () => {
    startScanItemsListener();
    window.__fk.errCbs[0](new Error('permission-denied'));
    const afterError = { live: !!_scanItemsUnsubscribe, epoch: _scanItemsListenerEpoch };
    startScanItemsListener();                      // ล็อกอินซ้ำ/ผูกใหม่หลัง error
    return { afterError, ...__pick() };
  };
  const on = await run(app.page, body, { on: true });
  const off = await run(app.page, body, { on: false });
  expect(on).toMatchObject({ afterError: { live: false, epoch: '' }, created: 2, live: true });
  expect(off).toMatchObject({ afterError: { live: true, epoch: 'E1' }, created: 1, live: true });   // ค้าง: guard "ฟังอยู่แล้ว" ไม่ยอมสร้างใหม่

  const stale = () => {
    startScanItemsListener();                      // L0
    stopScanItemsListener();                       // L0 ถูกปล่อย
    startScanItemsListener();                      // L1 (ตัวปัจจุบัน)
    window.__fk.errCbs[0](new Error('late error from L0'));   // error ที่มาช้าของตัวเก่า
    const afterLate = { live: !!_scanItemsUnsubscribe, epoch: _scanItemsListenerEpoch };
    startScanItemsListener();                      // ต้องข้าม (L1 ยังใช้ได้) ไม่สร้างตัวที่ 3
    return { afterLate, ...__pick() };
  };
  const r = await run(app.page, stale, { on: true });
  expect(r).toMatchObject({ afterLate: { live: true, epoch: 'E1' }, created: 2, live: true });
  await closeApp(app);
});

test('★ restoreFromFirestore (login แบบไม่ force มี backup ในเครื่อง): เปิดสวิตช์ไม่สร้าง items listener เอง · ปิด = สร้าง 1 ตัว · ผลลัพธ์ scanData เท่ากัน', async ({ browser }) => {
  const app = await bootBare(browser);
  const body = async () => {
    const r01Rows = [{ colE: 'A1', productName: 'ยา A', systemQty: 5 }, { colE: 'B2', productName: 'ยา B', systemQty: 0 }];
    const r05Rows = [{ barcode: '111', colE: 'A1', unitName: 'เม็ด', unitMultiplier: 1, unitPrice: 10 }, { barcode: '222', colE: 'B2', unitName: 'เม็ด', unitMultiplier: 1, unitPrice: 20 }];
    const docs = {
      SRC_r01: { data_json: JSON.stringify(r01Rows), r01Version: 'R01-X', r01UploadedAt: 'ทดสอบ' },
      global_r05: { data_json: _serializeR05(r05Rows), format: 'r05a1' },
      SRC_pm: { data_json: JSON.stringify([{ sku: 'A1', productName: 'ยา A', unitPrice: 10, cat: 'A' }, { sku: 'B2', productName: 'ยา B', unitPrice: 20, cat: 'A' }]), updated_at_text: 'pm-ทดสอบ' },
      SRC: { schemaVersion: 2, session_data_json: JSON.stringify({ countResetAt: 'E1', unknownScans: [] }) },
    };
    const fk = window.__fk;
    fk.itemDocs = [{ sku: 'A1', countResetAt: 'E1', rev: 1, status: 'scanning', countedQty: 3, barcode: '111', scannedBy: 'T', timestamp: '2026-10-19 09:00:00' }];
    _db = { collection: () => ({
      doc: (id) => ({ get: async () => ({ exists: docs[id] !== undefined, data: () => docs[id], id }), onSnapshot: () => { fk.sessionCreated++; return () => { fk.sessionUnsub++; }; } }),
    }) };
    state.r01Data = r01Rows; state.r01Version = 'R01-X'; state.r05Data = r05Rows;
    state.productMasterData = []; state.productMasterMap.clear(); state.skuMap.clear(); state.barcodeMap.clear(); state.skuDirectMap.clear(); state.scanData.clear(); scanListMap.clear();
    _dirtySkus.clear();
    rebuildMaps();                                  // เครื่องที่มี catalog + backup อยู่แล้ว → เข้าเส้นทาง !force && hasLocal
    await restoreFromFirestore(false);
    return { ...__pick(), getCalls: fk.getCalls, schema: _schemaVersion, epoch: _countResetAt,
      scan: [...state.scanData.entries()].filter(([, v]) => v.status !== 'pending').map(([k, v]) => [k, v.status, v.countedQty]).sort() };
  };
  const on = await run(app.page, body, { on: true });
  const off = await run(app.page, body, { on: false });
  expect(on.scan).toEqual([['A1', 'scanning', 3]]);                      // กันเทสผ่านเปล่าๆ — โหลด items จาก get() จริง
  expect(on).toMatchObject({ getCalls: 1, schema: 2, epoch: 'E1', created: 0, live: false });
  expect(off).toMatchObject({ getCalls: 1, schema: 2, epoch: 'E1', created: 1, live: true });
  expect(on.scan).toEqual(off.scan);                                      // ผลลัพธ์เท่ากันทั้งสองโหมด
  await closeApp(app);
});
