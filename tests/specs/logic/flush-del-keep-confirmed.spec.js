// กัน "pending → ลบเอกสารบน Cloud" ทับผลที่ Confirm แล้ว (ต.ค. 2026 · สวิตช์ FLUSH_DEL_KEEP_CONFIRMED · ผู้ใช้อนุมัติแผนข้อ 1 ตามกฎ 1)
// เหตุการณ์จริง SRC 25–26 ต.ค. 2026: บอท auto-r16 Confirm 64 รายการตอน 21:10 (Pass 59 · Stock Adj 5) แล้วเช้าวันถัดไป 09:03 เอกสารทั้ง 64 หายพร้อมกัน
//   ต้นเหตุ: เครื่องที่ล็อกอินค้างข้ามคืนและหลับตอนบอท Confirm ตื่นขึ้นมา → runStaleGuard ตั้งรายการเมื่อวาน (ยัง scanning ในเครื่อง) เป็น pending
//   → _flushDirtySkus ส่ง batch.delete โดยไม่เช็คว่าบน server ตอนนี้ Confirm แล้ว (blob v1 เคยมีด่าน "ไม่ทับ status ของ cloud ด้วย local pending" — v2 ไม่มี)
// กติกาใหม่ (สาขายาเท่านั้น): pending → ลบด้วย transaction ที่ "อ่านก่อนลบ"
//   • server Confirm แล้วในรอบนี้ (pass/audit/audit_check/stock_adjustment) → ไม่ลบ + รับค่า server เข้าเครื่อง (rev/synced/จอ) + toast บอก
//   • server ยังเป็น scanning / ไม่มีเอกสาร / เป็นเศษรอบเก่า → ลบตามเดิม · เอกสารของรอบที่ใหม่กว่า → ไม่แตะ
//   • ล้ม (ออฟไลน์) → requeue + backoff (ไม่ลบแบบไม่มีเงื่อนไขเมื่อถามไม่ได้) · WH ไม่แตะ · สวิตช์ปิด = batch.delete เดิมทุกไบต์
// ใช้ _db / getScanItemsRef ปลอม (คุมจังหวะ transaction ได้) — ไม่แตะ Firestore/emulator (logic project) · ผ่านเส้นทางจริงบน emulator: specs/e2e/stale-guard-keeps-confirmed.spec.js
const { test, expect, bootBare, closeApp } = require('../../lib/hooks');

const INSTALL = () => {
  const fk = window.__fk = { batches: [], written: [], txGets: [], txDeletes: [], txSets: [], txCount: 0, txAttempts: 0, attempt: 0, saves: 0, server: new Map(), ver: {}, warns: [], toasts: [], ui: [], failTx: false, failBatch: false, txGate: null, afterGet: null, afterTx: null };
  fk.real = {
    db: _db, ref: window.getScanItemsRef, branch: currentBranch, admin: _adminMode, schema: _schemaVersion, epoch: _countResetAt, user: currentUser, role: currentRole,
    warn: console.warn, flushing: _scanItemFlushing, toast: window.toast, scheduleSave: window.scheduleSave, listCleared: _listCleared,
  };
  console.warn = (...a) => { fk.warns.push(a.join(' ')); };
  window.toast = (msg, kind) => { fk.toasts.push(String(msg)); };
  window.scheduleSave = () => { fk.saves++; };
  for (const n of ['updateStats', 'renderTable', 'rebuildScanListMap', 'renderScanList', 'updateConfirmBtn', 'updatePharmacistAuditConfirmBtn', 'invalidatePopupRowsCache']) {
    const o = window[n]; fk.real['ui_' + n] = o;
    window[n] = function (...a) { fk.ui.push(n); return o.apply(this, a); };
  }
  fk.deferTx = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); fk.txGate = { promise, resolve }; };
  const newBatch = () => {
    const b = { ops: [] };
    b.set = (ref, data, opts) => { b.ops.push({ t: 'set', path: ref.path, data, opts }); };
    b.delete = (ref) => { b.ops.push({ t: 'delete', path: ref.path }); };
    b.commit = async () => { if (fk.failBatch) throw Object.assign(new Error('unavailable'), { code: 'unavailable' }); fk.written.push(...b.ops); for (const o of b.ops) if (o.t === 'delete') fk.server.delete(o.path); };
    fk.batches.push(b);
    return b;
  };
  const newTx = () => {
    const pending = [], reads = new Map();
    return {
      pending, reads,
      async get(ref) {
        fk.txGets.push(ref.path);
        if (fk.failTx) throw Object.assign(new Error('unavailable'), { code: 'unavailable' });
        if (fk.txGate) await fk.txGate.promise;
        const d = fk.server.get(ref.path);
        reads.set(ref.path, fk.ver[ref.path] || 0);
        if (fk.afterGet && fk.attempt === 1) { const h = fk.afterGet; fk.afterGet = null; h(); }   // จำลองเครื่องอื่น/บอทเขียนแทรกหลังเราอ่านแล้ว
        return { exists: d !== undefined, data: () => d, ref, id: ref.id };
      },
      set(ref, data) { fk.txSets.push({ path: ref.path, data }); pending.push({ t: 'set', path: ref.path, data }); },
      delete(ref) { fk.txDeletes.push(ref.path); pending.push({ t: 'delete', path: ref.path }); },
    };
  };
  // เหมือน Firestore client: เอกสารที่อ่านถูกแก้ก่อน commit → ทำ callback ใหม่ทั้งก้อน (สูงสุด 5 รอบ) · pending ของรอบที่ชนถูกทิ้ง
  fk.setServer = (path, data) => { fk.server.set(path, data); fk.ver[path] = (fk.ver[path] || 0) + 1; };
  _db = { batch: newBatch, runTransaction: async (fn) => {
    fk.txCount++; if (fk.failFrom && fk.txCount >= fk.failFrom) fk.failTx = true;
    for (let attempt = 1; attempt <= 5; attempt++) {
      fk.attempt = attempt; fk.txAttempts++;
      const tx = newTx(); const r = await fn(tx);
      if ([...tx.reads].some(([p, v]) => (fk.ver[p] || 0) !== v)) continue;
      for (const w of tx.pending) { if (w.t === 'delete') { fk.server.delete(w.path); fk.ver[w.path] = (fk.ver[w.path] || 0) + 1; } else fk.setServer(w.path, w.data); }
      fk.attempt = 0;
      if (fk.afterTx) { const h = fk.afterTx; fk.afterTx = null; h(); }
      return r;
    }
    throw Object.assign(new Error('aborted'), { code: 'aborted' });
  } };
  window.getScanItemsRef = () => ({ doc: (sku) => ({ path: 'items/' + sku, id: sku }) });
  currentBranch = 'SRC'; currentUser = 'ก้า'; _adminMode = false; _schemaVersion = SCAN_SCHEMA_V2; _countResetAt = 'E1'; _scanItemFlushing = false; _listCleared = false;
  _dirtySkus.clear(); _scanItemInFlight.clear(); _scanItemRev.clear(); _scanItemSynced.clear(); state.scanData.clear(); scanListMap.clear();
  clearTimeout(_scanItemFlushTimer); _scanItemFlushTimer = null; _scanItemFailStreak = 0; _scanItemBackoffUntil = 0;
  // รับรอบใหม่เหมือน _applyCloudSessionMeta: ป้ายรอบ + local เป็น pending + ล้าง rev/synced/dirty/inflight
  fk.adoptNewEpoch = (e) => {
    _countResetAt = e; _resetLocalScanDataToPending();
    _scanItemRev.clear(); _scanItemSynced.clear(); _dirtySkus.clear(); _scanItemInFlight.clear(); _scanItemFailStreak = 0; _scanItemBackoffUntil = 0;
  };
  // สภาพที่ resetStaleScanningItems() ทิ้งไว้: pending + firstScanAt เดิมค้าง (ไม่ถูกล้าง) · เคยซิงก์แล้ว (rev/synced มีค่า) · mark dirty เหมือน _reconcileScanItems
  fk.stale = (sku) => {
    state.scanData.set(sku, { countedQty: 0, status: 'pending', retries: 0, scans: [], timestamp: '', scannedBy: '', auditor: '', auditStatus: 'pending', barcode: '', location: '', firstScanAt: '2026-10-25 16:55:41' });
    _scanItemRev.set(sku, 2); _scanItemSynced.set(sku, 'old-fingerprint');
    _markSkuDirty(sku);
    clearTimeout(_scanItemFlushTimer); _scanItemFlushTimer = null;
  };
  // เอกสารบน server (ผลที่บอท/เครื่องอื่น Confirm แล้ว) — ค่าเริ่มต้นเป็น pass ของรอบนี้
  fk.srv = (sku, o = {}) => {
    fk.server.set('items/' + sku, { sku, countResetAt: 'E1', status: 'pass', auditStatus: 'approved', initialStatus: 'pass', countedQty: 3, rev: 3, updatedBy: 'auto-r16',
      timestamp: '2026-10-25 16:55:41', firstScanAt: '2026-10-25 16:55:41', scannedBy: 'ก้า', auditor: '', ...o });
  };
  fk.batchDeletes = () => fk.written.filter((w) => w.t === 'delete').map((w) => w.path).sort();
  fk.statuses = (skus) => skus.map((s) => (state.scanData.get(s) || {}).status);
  fk.dropWarns = () => fk.warns.filter((w) => w.includes('รอบนับเปลี่ยนระหว่างส่ง'));
};
const UNINSTALL = () => {
  const r = window.__fk.real;
  clearTimeout(_scanItemFlushTimer); _scanItemFlushTimer = null;
  _dirtySkus.clear(); _scanItemInFlight.clear(); _scanItemRev.clear(); _scanItemSynced.clear(); _scanItemFailStreak = 0; _scanItemBackoffUntil = 0; state.scanData.clear(); scanListMap.clear();
  _db = r.db; window.getScanItemsRef = r.ref; currentBranch = r.branch; _adminMode = r.admin; _schemaVersion = r.schema; _countResetAt = r.epoch; currentUser = r.user;
  console.warn = r.warn; _scanItemFlushing = r.flushing; window.toast = r.toast; window.scheduleSave = r.scheduleSave; _listCleared = r.listCleared;
  for (const k of Object.keys(r)) if (k.startsWith('ui_')) window[k.slice(3)] = r[k];
  if (typeof _forceDelSkus !== 'undefined') _forceDelSkus.clear();
  if (typeof FLUSH_DEL_KEEP_CONFIRMED !== 'undefined') FLUSH_DEL_KEEP_CONFIRMED = true;
  if (typeof FLUSH_DEL_CHECK_CHUNK !== 'undefined') FLUSH_DEL_CHECK_CHUNK = 50;
};
// รัน body บนหน้าเว็บ: ติดตั้งของปลอม → ตั้งสวิตช์/สาขา → รัน → คืนค่าเดิม (finally)
const run = (page, body, { guard = true, branch = 'SRC', chunk = 0 } = {}) => page.evaluate(
  `(async()=>{(${INSTALL})();FLUSH_DEL_KEEP_CONFIRMED=${guard};${chunk ? `FLUSH_DEL_CHECK_CHUNK=${chunk};` : ''}currentBranch=${JSON.stringify(branch)};try{return await (${body})();}finally{(${UNINSTALL})();}})()`);

// ── เหตุการณ์ SRC 25–26 ต.ค.: Pass · Stock Adj ตรง (directAdj) · legacy audit ที่ server Confirm แล้ว แต่เครื่องนี้รีเซ็ตเป็น pending ──
const KEEP = async () => {
  const skus = ['P-1', 'P-2', 'P-3', 'A-1', 'R-1'];
  for (const s of skus) __fk.stale(s);
  __fk.srv('P-1'); __fk.srv('P-2', { countedQty: 7 }); __fk.srv('P-3', { rev: 5 });
  __fk.srv('A-1', { status: 'stock_adjustment', auditStatus: 'stock_adjustment', initialStatus: 'stock_adjustment', directAdj: true, effectiveQty: 81, systemQty: 33, soldQty: 49 });
  __fk.srv('R-1', { status: 'audit', auditStatus: 'pending', initialStatus: 'audit' });
  await _flushDirtySkus();
  const a = state.scanData.get('A-1');
  return {
    txCount: __fk.txCount, txDeletes: __fk.txDeletes.slice(), batchDeletes: __fk.batchDeletes(),
    serverKept: skus.every((s) => __fk.server.has('items/' + s)),
    status: __fk.statuses(skus), qty: skus.map((s) => state.scanData.get(s).countedQty), rev: skus.map((s) => _scanItemRev.get(s)),
    syncedMatches: skus.every((s) => _scanItemSynced.get(s) === _scanItemFingerprint(state.scanData.get(s))),
    adj: { directAdj: a.directAdj, eff: a.effectiveQty, sys: a.systemQty, sold: a.soldQty, first: a.firstScanAt },
    dirty: _dirtySkus.size, inflight: _scanItemInFlight.size, toasts: __fk.toasts.slice(), ui: [...new Set(__fk.ui)].sort(), saves: __fk.saves,
  };
};
const DELETE_UNCONFIRMED = async () => {
  const skus = ['S-1', 'S-2', 'M-1'];
  for (const s of skus) __fk.stale(s);
  __fk.srv('S-1', { status: 'scanning', auditStatus: 'pending', countedQty: 4 });
  __fk.srv('S-2', { status: 'scanning' });                       // M-1: ไม่มีเอกสารบน server
  await _flushDirtySkus();
  return {
    txCount: __fk.txCount, txDeletes: __fk.txDeletes.slice().sort(), batchDeletes: __fk.batchDeletes(), serverLeft: [...__fk.server.keys()],
    revKept: skus.filter((s) => _scanItemRev.has(s)), syncedKept: skus.filter((s) => _scanItemSynced.has(s)),
    status: __fk.statuses(skus), dirty: _dirtySkus.size, toasts: __fk.toasts.slice(), saves: __fk.saves,
  };
};
const MIXED = async () => {
  const skus = ['K-1', 'D-1', 'M-1', 'O-1', 'N-1', 'L-1'];
  for (const s of skus) __fk.stale(s);
  __fk.srv('K-1');                                                // pass ของรอบนี้ → เก็บ
  __fk.srv('D-1', { status: 'scanning' });                        // scanning → ลบ
  __fk.srv('O-1', { countResetAt: 'E0' });                        // pass ของ "รอบเก่า" (เศษ) → ไม่ใช่ของรอบนี้ → ลบตามเดิม
  __fk.srv('N-1', { countResetAt: 'E2' });                        // เอกสารของรอบที่ "ใหม่กว่า" (เครื่องอื่นเริ่มนับใหม่) → ห้ามแตะ · ไม่รับเข้ารอบนี้
  __fk.srv('L-1', { status: 'audit_check' });                     // legacy confirmed → เก็บ · M-1: ไม่มีบน server
  await _flushDirtySkus();
  return { txDeletes: __fk.txDeletes.slice().sort(), serverLeft: [...__fk.server.keys()].sort(), status: __fk.statuses(skus), dirty: _dirtySkus.size, toasts: __fk.toasts.slice() };
};
const CHUNKS = async () => {
  const skus = []; for (let i = 1; i <= 120; i++) skus.push('C-' + String(i).padStart(3, '0'));
  skus.forEach((s, i) => { __fk.stale(s); __fk.srv(s, i % 3 === 0 ? { status: 'scanning' } : {}); });    // 40 scanning · 80 pass
  await _flushDirtySkus();
  return { txCount: __fk.txCount, deleted: __fk.txDeletes.length, kept: skus.filter((s) => __fk.server.has('items/' + s)).length,
    pass: __fk.statuses(skus).filter((s) => s === 'pass').length, pending: __fk.statuses(skus).filter((s) => s === 'pending').length, dirty: _dirtySkus.size, toasts: __fk.toasts.slice() };
};
const FAIL_THEN_OK = async () => {
  for (const s of ['P-1', 'P-2']) { __fk.stale(s); __fk.srv(s); }
  __fk.failTx = true;                                              // อ่านไม่ได้ (ออฟไลน์/ล้ม)
  await _flushDirtySkus();
  const first = { dirty: [..._dirtySkus].sort(), backoff: _scanItemBackoffUntil > Date.now(), streak: _scanItemFailStreak, server: [...__fk.server.keys()].sort(), status: __fk.statuses(['P-1', 'P-2']), toasts: __fk.toasts.length, deletes: __fk.txDeletes.length + __fk.batchDeletes().length };
  __fk.failTx = false; _scanItemBackoffUntil = 0; clearTimeout(_scanItemFlushTimer); _scanItemFlushTimer = null;
  await _flushDirtySkus();
  return { first, second: { dirty: _dirtySkus.size, server: [...__fk.server.keys()].sort(), status: __fk.statuses(['P-1', 'P-2']), streak: _scanItemFailStreak, toasts: __fk.toasts.length } };
};
const EPOCH_MOVED = async () => {
  __fk.stale('P-1'); __fk.srv('P-1'); __fk.stale('D-1'); __fk.srv('D-1', { status: 'scanning' });
  __fk.deferTx();                                                  // tx.get ค้าง
  const p = _flushDirtySkus();
  __fk.adoptNewEpoch('E2');                                        // ระหว่างรอ: เครื่องนี้รับรอบใหม่
  _scanItemRev.set('P-1', 7); _scanItemSynced.set('P-1', 'fp-new-epoch');   // ตัวฟังรับเอกสารของรอบใหม่เข้ามาระหว่างรอ — ห้ามถูกล้างตามไปด้วย (ของรอบเก่าเท่านั้นที่ทิ้ง)
  __fk.txGate.resolve();
  await p;
  return { txDeletes: __fk.txDeletes.length, serverLeft: [...__fk.server.keys()].sort(), dirty: _dirtySkus.size, drops: __fk.dropWarns().length, toasts: __fk.toasts.length,
    newEpochState: [_scanItemRev.get('P-1'), _scanItemSynced.get('P-1')] };
};
const RESCANNED_DURING = async () => {
  for (const s of ['P-1', 'P-2']) { __fk.stale(s); __fk.srv(s); }
  __fk.deferTx();
  const p = _flushDirtySkus();
  const sd = state.scanData.get('P-1');                            // ระหว่างรอ: ผู้ใช้สแกน P-1 ใหม่ (scanning + dirty)
  sd.status = 'scanning'; sd.countedQty = 2; sd.timestamp = '2026-10-26 10:00:00'; _markSkuDirty('P-1'); clearTimeout(_scanItemFlushTimer); _scanItemFlushTimer = null;
  __fk.txGate.resolve();
  await p;
  return { p1: { status: state.scanData.get('P-1').status, qty: state.scanData.get('P-1').countedQty }, p2: state.scanData.get('P-2').status,
    dirty: [..._dirtySkus], serverKept: ['P-1', 'P-2'].every((s) => __fk.server.has('items/' + s)), txDeletes: __fk.txDeletes.length, toasts: __fk.toasts.slice() };
};

test('ค่าเริ่มต้นที่ส่งมอบ — สวิตช์เปิด · ตัวช่วยมีอยู่ · ขนาดชุดตรวจ 50', async ({ browser }) => {
  const app = await bootBare(browser);
  expect(await app.page.evaluate(() => [typeof FLUSH_DEL_KEEP_CONFIRMED, FLUSH_DEL_KEEP_CONFIRMED, typeof FLUSH_DEL_CHECK_CHUNK, FLUSH_DEL_CHECK_CHUNK, typeof _deleteScanItemsKeepConfirmed, typeof _adoptKeptConfirmedItems]))
    .toEqual(['boolean', true, 'number', 50, 'function', 'function']);
  await closeApp(app);
});

test('★ ผลที่ Confirm แล้ว (Pass · Stock Adj ตรง · audit) ห้ามถูกลบ — รับค่า server เข้าเครื่อง (สถานะ/ยอด/คู่ตัวเลข directAdj/rev/จอ) แล้วบอกผู้ใช้ · ทั้ง 3 สาขายา', async ({ browser }) => {
  const app = await bootBare(browser);
  for (const branch of ['SRC', 'KKL', 'SSS']) {
    const r = await run(app.page, KEEP, { branch });
    expect(r.txDeletes, branch).toEqual([]);
    expect(r.batchDeletes, branch).toEqual([]);
    expect(r.serverKept, branch).toBe(true);                                   // เอกสารบน Cloud อยู่ครบ
    expect(r.status, branch).toEqual(['pass', 'pass', 'pass', 'stock_adjustment', 'audit']);
    expect(r.qty, branch).toEqual([3, 7, 3, 3, 3]);
    expect(r.rev, branch).toEqual([3, 3, 5, 3, 3]);                            // rev ของ server (Confirm อ่าน rev ตรวจ "เปลี่ยนกลางงาน")
    expect(r.syncedMatches, branch).toBe(true);                                // ไม่ค้าง dirty ไม่เขียนซ้ำ
    expect(r.adj, branch).toEqual({ directAdj: true, eff: 81, sys: 33, sold: 49, first: '2026-10-25 16:55:41' });
    expect(r.dirty, branch).toBe(0); expect(r.inflight, branch).toBe(0);
    expect(r.toasts, branch).toHaveLength(1);
    expect(r.toasts[0], branch).toContain('5 รายการ');
    expect(r.ui, branch).toEqual(expect.arrayContaining(['rebuildScanListMap', 'renderScanList', 'updateStats', 'renderTable', 'updateConfirmBtn', 'invalidatePopupRowsCache']));
    expect(r.saves, branch).toBe(1);                                           // สำรองในเครื่องหลังรับผล (ไม่ค้างค่า pending เก่าใน localStorage)
  }
  await closeApp(app);
});

test('★ ปิดสวิตช์ = บั๊กเดิมกลับมาเป๊ะ (canary): batch.delete ผล Confirm ทั้งหมด · ไม่อ่าน server · ไม่รับค่าเข้าเครื่อง', async ({ browser }) => {
  const app = await bootBare(browser);
  const r = await run(app.page, KEEP, { guard: false });
  expect(r.txCount).toBe(0);                                                   // ไม่มี transaction อ่านก่อนลบ
  expect(r.batchDeletes).toEqual(['items/A-1', 'items/P-1', 'items/P-2', 'items/P-3', 'items/R-1']);   // ★ ผล Confirm ถูกลบหมด (อาการจริง 26 ต.ค.)
  expect(r.serverKept).toBe(false);
  expect(r.status).toEqual(['pending', 'pending', 'pending', 'pending', 'pending']);
  expect(r.toasts).toEqual([]);
  await closeApp(app);
});

test('★ รายการที่ server ยังไม่ Confirm (scanning / ไม่มีเอกสาร) ลบตามเดิม — รีเซ็ตของค้างข้ามวันที่ไม่มีใคร Confirm ยังทำงาน · rev/synced ถูกล้าง', async ({ browser }) => {
  const app = await bootBare(browser);
  const r = await run(app.page, DELETE_UNCONFIRMED);
  expect(r).toMatchObject({ txCount: 1, txDeletes: ['items/S-1', 'items/S-2'], batchDeletes: [], serverLeft: [], revKept: [], syncedKept: [], status: ['pending', 'pending', 'pending'], dirty: 0, toasts: [], saves: 0 });
  await closeApp(app);
});

test('★ ชุดผสม: เก็บ pass/audit_check ของรอบนี้ · ลบ scanning + เศษรอบเก่า · ไม่แตะเอกสารของรอบที่ใหม่กว่า (ไม่รับเข้ารอบนี้)', async ({ browser }) => {
  const app = await bootBare(browser);
  const r = await run(app.page, MIXED);
  expect(r.txDeletes).toEqual(['items/D-1', 'items/O-1']);
  expect(r.serverLeft).toEqual(['items/K-1', 'items/L-1', 'items/N-1']);
  expect(r.status).toEqual(['pass', 'pending', 'pending', 'pending', 'pending', 'audit_check']);   // K-1 · D-1 · M-1 · O-1 · N-1 · L-1
  expect(r.dirty).toBe(0);
  expect(r.toasts).toHaveLength(1); expect(r.toasts[0]).toContain('2 รายการ');
  await closeApp(app);
});

test('★ รายการมากกว่าขนาดชุด: 120 SKU / ชุดละ 50 → 3 transaction · ผลถูกต้องทุกชุด (ปรับขนาดชุดเป็น 25 → 5 transaction)', async ({ browser }) => {
  const app = await bootBare(browser);
  const r = await run(app.page, CHUNKS);
  expect(r).toMatchObject({ txCount: 3, deleted: 40, kept: 80, pass: 80, pending: 40, dirty: 0 });
  expect(r.toasts).toHaveLength(1); expect(r.toasts[0]).toContain('80 รายการ');
  const small = await run(app.page, CHUNKS, { chunk: 25 });
  expect(small).toMatchObject({ txCount: 5, deleted: 40, kept: 80, pass: 80, pending: 40, dirty: 0 });
  await closeApp(app);
});

test('★ ถาม server ไม่ได้ (ออฟไลน์/ล้ม) → ไม่ลบอะไร · requeue + backoff · พอกลับมาออนไลน์ค่อยตรวจแล้วเก็บผล Confirm ไว้ (ไม่ใช่ลบโดยไม่มีเงื่อนไข)', async ({ browser }) => {
  const app = await bootBare(browser);
  const r = await run(app.page, FAIL_THEN_OK);
  expect(r.first).toEqual({ dirty: ['P-1', 'P-2'], backoff: true, streak: 1, server: ['items/P-1', 'items/P-2'], status: ['pending', 'pending'], toasts: 0, deletes: 0 });
  expect(r.second).toEqual({ dirty: 0, server: ['items/P-1', 'items/P-2'], status: ['pass', 'pass'], streak: 0, toasts: 1 });
  await closeApp(app);
});

test('★ WH ไม่เปลี่ยน (batch.delete เดิม ไม่มี transaction) · ไม่ใช่สาขายาใดๆ ก็ไม่เปลี่ยน', async ({ browser }) => {
  const app = await bootBare(browser);
  const r = await run(app.page, KEEP, { branch: 'WH' });
  expect(r.txCount).toBe(0);
  expect(r.batchDeletes).toEqual(['items/A-1', 'items/P-1', 'items/P-2', 'items/P-3', 'items/R-1']);
  expect(r.toasts).toEqual([]);
  await closeApp(app);
});

test('★ รอบนับเปลี่ยนระหว่างตรวจ → ไม่ลบอะไร ไม่ requeue (ของรอบเก่า) ไม่รับค่าเข้า · เหมือนด่าน SCAN_FLUSH_EPOCH_GUARD เดิม', async ({ browser }) => {
  const app = await bootBare(browser);
  const r = await run(app.page, EPOCH_MOVED);
  expect(r).toMatchObject({ txDeletes: 0, serverLeft: ['items/D-1', 'items/P-1'], dirty: 0, toasts: 0, newEpochState: [7, 'fp-new-epoch'] });
  expect(r.drops).toBeGreaterThanOrEqual(1);
  await closeApp(app);
});

test('★ ผู้ใช้สแกน SKU นั้นใหม่ระหว่างที่กำลังตรวจ → ห้ามเอาค่า server ทับยอดที่เพิ่งสแกน (ยังเป็น scanning + dirty รอเขียนผ่าน transaction เดิมที่รับผล Confirm เอง) · SKU อื่นรับค่าปกติ', async ({ browser }) => {
  const app = await bootBare(browser);
  const r = await run(app.page, RESCANNED_DURING);
  expect(r.p1).toEqual({ status: 'scanning', qty: 2 });
  expect(r.p2).toBe('pass');
  expect(r.dirty).toEqual(['P-1']);
  expect(r.serverKept).toBe(true); expect(r.txDeletes).toBe(0);
  expect(r.toasts).toHaveLength(1); expect(r.toasts[0]).toContain('1 รายการ');
  await closeApp(app);
});

test('★ ล้มกลางชุด (ชุดที่ 2 เป็นต้นไป) → ชุดแรกที่ทำเสร็จแล้วคงอยู่ · ที่เหลือ requeue · ไม่ยิง transaction ต่อหลังเจอ error (backoff) · ไม่ลบอะไร', async ({ browser }) => {
  const app = await bootBare(browser);
  const r = await run(app.page, async () => {
    const skus = ['P-1', 'P-2', 'P-3'];
    for (const s of skus) { __fk.stale(s); __fk.srv(s); }
    __fk.failFrom = 2;                                               // transaction แรกผ่าน · ตั้งแต่ครั้งที่ 2 ล้ม
    await _flushDirtySkus();
    return { txCount: __fk.txCount, status: __fk.statuses(skus), dirty: [..._dirtySkus].sort(), backoff: _scanItemBackoffUntil > Date.now(), streak: _scanItemFailStreak,
      server: [...__fk.server.keys()].sort(), deletes: __fk.txDeletes.length + __fk.batchDeletes().length, toasts: __fk.toasts.length };
  }, { chunk: 1 });
  expect(r).toEqual({ txCount: 2, status: ['pass', 'pending', 'pending'], dirty: ['P-2', 'P-3'], backoff: true, streak: 1, server: ['items/P-1', 'items/P-2', 'items/P-3'], deletes: 0, toasts: 1 });
  await closeApp(app);
});

test('★ รีเฟรชจอล้ม (error ใน UI) หลังรับผล Confirm → ห้ามไหลเข้า catch ของ flush: ไม่ requeue · ไม่เขียนทับ · ค่าที่รับมาคงอยู่ · บันทึกคำเตือน', async ({ browser }) => {
  const app = await bootBare(browser);
  const r = await run(app.page, async () => {
    const skus = ['P-1', 'P-2'];
    for (const s of skus) { __fk.stale(s); __fk.srv(s); }
    window.rebuildScanListMap = () => { throw new Error('ui-boom'); };          // UNINSTALL คืนค่าเดิมให้เอง
    await _flushDirtySkus();
    return { status: __fk.statuses(skus), dirty: _dirtySkus.size, inflight: _scanItemInFlight.size, streak: _scanItemFailStreak, backoff: _scanItemBackoffUntil,
      synced: skus.every((s) => _scanItemSynced.get(s) === _scanItemFingerprint(state.scanData.get(s))), rev: skus.map((s) => _scanItemRev.get(s)),
      writes: __fk.written.length + __fk.txSets.length, deletes: __fk.txDeletes.length, serverKept: skus.every((s) => __fk.server.has('items/' + s)),
      warned: __fk.warns.some((w) => w.includes('รีเฟรชจอหลังรับผล Confirm ไม่สำเร็จ') && w.includes('ui-boom')), toasts: __fk.toasts.length };
  });
  expect(r).toEqual({ status: ['pass', 'pass'], dirty: 0, inflight: 0, streak: 0, backoff: 0, synced: true, rev: [3, 3], writes: 0, deletes: 0, serverKept: true, warned: true, toasts: 0 });
  await closeApp(app);
});

test('★ อ่านก่อนลบเป็น transaction จริง: บอท Confirm แทรกหลังเราอ่านแล้ว (ระหว่างอ่านกับ commit) → transaction ทำซ้ำ เห็นผล Confirm → ไม่ลบ · รับค่าเข้าเครื่อง (ไม่ใช่ลบจากสิ่งที่อ่านไว้ตอนแรก)', async ({ browser }) => {
  const app = await bootBare(browser);
  const r = await run(app.page, async () => {
    __fk.stale('P-1'); __fk.srv('P-1', { status: 'scanning', auditStatus: 'pending' });
    __fk.afterGet = () => __fk.setServer('items/P-1', { ...__fk.server.get('items/P-1'), status: 'pass', auditStatus: 'approved', rev: 4, updatedBy: 'auto-r16' });
    await _flushDirtySkus();
    return { attempts: __fk.txAttempts, serverStatus: (__fk.server.get('items/P-1') || {}).status, serverRev: (__fk.server.get('items/P-1') || {}).rev,
      local: state.scanData.get('P-1').status, rev: _scanItemRev.get('P-1'), dirty: _dirtySkus.size, toasts: __fk.toasts.length };
  });
  expect(r).toEqual({ attempts: 2, serverStatus: 'pass', serverRev: 4, local: 'pass', rev: 4, dirty: 0, toasts: 1 });
  await closeApp(app);
});

test('★ รอบนับเปลี่ยน "ระหว่างชุด" (หลังชุดแรก commit แล้ว ก่อนชุดที่ 2 เริ่ม) → ไม่ยิง transaction ชุดที่เหลือ · ไม่ลบ · ไม่ requeue', async ({ browser }) => {
  const app = await bootBare(browser);
  const r = await run(app.page, async () => {
    for (const s of ['P-1', 'P-2', 'P-3']) { __fk.stale(s); __fk.srv(s); }
    __fk.afterTx = () => __fk.adoptNewEpoch('E2');                   // ชุดแรกจบ → เครื่องนี้รับรอบใหม่
    await _flushDirtySkus();
    return { txCount: __fk.txCount, serverLeft: [...__fk.server.keys()].sort(), dirty: _dirtySkus.size, drops: __fk.dropWarns().length, deletes: __fk.txDeletes.length };
  }, { chunk: 1 });
  expect(r).toMatchObject({ txCount: 1, serverLeft: ['items/P-1', 'items/P-2', 'items/P-3'], dirty: 0, deletes: 0 });
  expect(r.drops).toBeGreaterThanOrEqual(1);
  await closeApp(app);
});

test('★ ↺ สแกนใหม่ (restartPharmacyScan) สั่งลบซ้ำเศษที่ flush ค้างเขียนฟื้น → ลบจริงเฉพาะ SKU ที่ติดธง _forceDelSkus (ไม่ถูกด่านรับผล Confirm) · ธงหมดอายุ/SKU อื่นยังผ่านด่านปกติ · ล้างธงหลังลบสำเร็จ', async ({ browser }) => {
  const app = await bootBare(browser);
  const r = await run(app.page, async () => {
    const skus = ['F-1', 'F-2', 'F-3'];
    for (const s of skus) { __fk.stale(s); __fk.srv(s, { status: 'stock_adjustment', auditStatus: 'stock_adjustment', initialStatus: 'stock_adjustment', directAdj: true, effectiveQty: 3, systemQty: 5 }); }
    _forceDelSkus.set('F-1', Date.now() + 60000);                    // ↺ สั่งลบซ้ำเศษของ F-1
    _forceDelSkus.set('F-2', Date.now() - 1);                        // ธงหมดอายุแล้ว → ต้องผ่านด่านปกติ (และถูกทิ้ง)
    await _flushDirtySkus();
    return { batchDeletes: __fk.batchDeletes(), txCount: __fk.txCount, txDeletes: __fk.txDeletes.length, serverLeft: [...__fk.server.keys()].sort(), status: __fk.statuses(skus), flags: [..._forceDelSkus.keys()], toasts: __fk.toasts.length };
  });
  expect(r).toEqual({ batchDeletes: ['items/F-1'], txCount: 1, txDeletes: 0, serverLeft: ['items/F-2', 'items/F-3'], status: ['pending', 'stock_adjustment', 'stock_adjustment'], flags: [], toasts: 1 });
  await closeApp(app);
});

test('★ ลบจริง (ติดธง) แล้วเขียนล้ม → ธงคงอยู่ · requeue · รอบถัดไปยังลบจริง ไม่กลายเป็นผ่านด่านรับผล Confirm', async ({ browser }) => {
  const app = await bootBare(browser);
  const r = await run(app.page, async () => {
    __fk.stale('F-1'); __fk.srv('F-1', { status: 'stock_adjustment', auditStatus: 'stock_adjustment', directAdj: true });
    _forceDelSkus.set('F-1', Date.now() + 60000);
    __fk.failBatch = true;
    await _flushDirtySkus();
    const first = { dirty: [..._dirtySkus], flag: _forceDelSkus.has('F-1'), server: __fk.server.has('items/F-1'), status: state.scanData.get('F-1').status, txCount: __fk.txCount };
    __fk.failBatch = false; _scanItemBackoffUntil = 0; clearTimeout(_scanItemFlushTimer); _scanItemFlushTimer = null;
    await _flushDirtySkus();
    return { first, second: { dirty: _dirtySkus.size, flag: _forceDelSkus.has('F-1'), server: __fk.server.has('items/F-1'), status: state.scanData.get('F-1').status, txCount: __fk.txCount, batchDeletes: __fk.batchDeletes() } };
  });
  expect(r.first).toEqual({ dirty: ['F-1'], flag: true, server: true, status: 'pending', txCount: 0 });
  expect(r.second).toEqual({ dirty: 0, flag: false, server: false, status: 'pending', txCount: 0, batchDeletes: ['items/F-1'] });
  await closeApp(app);
});

test('PDA ผู้ช่วย (RESULT เริ่มว่าง _listCleared=true) → รับผล Confirm แล้วไม่สร้างแถว RESULT ใหม่ (ไม่ rebuild) แต่การ์ด/ตัวกรองยังรีเฟรช · ปิด _listCleared = rebuild ตามปกติ', async ({ browser }) => {
  const app = await bootBare(browser);
  const body = async () => { __fk.stale('P-1'); __fk.srv('P-1'); await _flushDirtySkus(); return { ui: [...new Set(__fk.ui)].sort(), status: __fk.statuses(['P-1']) }; };
  const cleared = await run(app.page, `async()=>{_listCleared=true;return await (${body})();}`);
  expect(cleared.status).toEqual(['pass']);
  expect(cleared.ui).toEqual(expect.arrayContaining(['updateStats', 'renderTable', 'updateConfirmBtn', 'invalidatePopupRowsCache']));
  expect(cleared.ui).not.toContain('rebuildScanListMap'); expect(cleared.ui).not.toContain('renderScanList');
  const normal = await run(app.page, body);
  expect(normal.ui).toEqual(expect.arrayContaining(['rebuildScanListMap', 'renderScanList']));
  await closeApp(app);
});

test('SKU ที่ไม่มี entry ในเครื่องเลย (!sd) แต่ server Confirm แล้ว → ไม่ลบ · สร้าง entry จากค่า server', async ({ browser }) => {
  const app = await bootBare(browser);
  const r = await run(app.page, async () => {
    __fk.srv('X-1');
    state.scanData.delete('X-1'); _dirtySkus.add('X-1');
    await _flushDirtySkus();
    const sd = state.scanData.get('X-1');
    return { txDeletes: __fk.txDeletes.length, kept: __fk.server.has('items/X-1'), status: sd && sd.status, rev: _scanItemRev.get('X-1') };
  });
  expect(r).toEqual({ txDeletes: 0, kept: true, status: 'pass', rev: 3 });
  await closeApp(app);
});
