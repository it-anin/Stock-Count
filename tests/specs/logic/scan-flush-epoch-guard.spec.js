// กันเอกสารผีของ WH (ต.ค. 2026 · สวิตช์ SCAN_FLUSH_EPOCH_GUARD + WH_GHOST_OP_CHECK · ผู้ใช้อนุมัติแผนตามกฎ 1)
// ผี = ผลยืนยันรอบเก่า (เนื้อหา 25 ก.ย. · อ้าง op ที่ถูกลบ) ที่ถูกเขียนกลับขึ้น Cloud ด้วยป้ายรอบใหม่ rev 1 → PDA สแกนแล้วขึ้น Pass แต่ Desktop ขึ้น รอนับ
//   ต้นเหตุที่จำลองซ้ำได้: _flushDirtySkus สร้างชุดถัดไป (ชุดละ 450) "หลัง await commit ชุดก่อน" ด้วยป้ายรอบสด + item ที่จับไว้ก่อนเปลี่ยนรอบ
//   (1) SCAN_FLUSH_EPOCH_GUARD: รอบเปลี่ยนระหว่างส่ง → ทิ้งที่เหลือ ไม่เขียน ไม่ลบ ไม่ requeue · _writeScanningItem ไม่ tx.set ถ้ารอบเปลี่ยนระหว่างรอ transaction
//   (2) WH_GHOST_OP_CHECK: _writeScanningItem เจอเอกสาร confirmed ที่ผูก op ที่ไม่ใช่ committed ของรอบนี้ (อ่านจาก server ใน transaction เดียวกัน) = ผี → ไม่รับเป็น Confirm
//       เขียนทับผีตรงๆ ไม่ได้ (firestore.rules ห้ามทิ้ง whCountOpId · e2e พิสูจน์แล้ว) → ลบผีใน transaction แรก แล้วสร้างยอดสแกนจริงใน transaction ที่สอง
// ใช้ _db / getScanItemsRef / getWhConfirmOpsRef ปลอมที่คุมจังหวะ commit และ transaction ได้ — ไม่แตะ Firestore/emulator (logic project)
// ตรึง: ★ เปิดสวิตช์ = ไม่เขียนชุดหลังเปลี่ยนรอบ/ไม่ requeue/ไม่ tx.set · ★ ปิด = บั๊กเดิมกลับมาเป๊ะ (canary) · ★ op committed จริงต้องไม่ถูกทับ (ทุกทางที่ op ไม่ครบ = ผี)
//       ★ ไม่ผูก op / ไม่ใช่ WH / อ่าน op ล้ม = ไม่ทับ (fail-closed)
const { test, expect, bootBare, closeApp } = require('../../lib/hooks');

const INSTALL = () => {
  const fk = window.__fk = { batches: [], gates: {}, failBatch: 0, written: [], txSets: [], txDeletes: [], txGets: [], txGate: null, failOpGet: false, server: new Map(), warns: [], txCount: 0, afterTx: null, failItemGetFromTx: 0 };
  fk.real = {
    db: _db, ref: window.getScanItemsRef, opsRef: window.getWhConfirmOpsRef, branch: currentBranch, admin: _adminMode, schema: _schemaVersion,
    epoch: _countResetAt, user: currentUser, warn: console.warn, flushing: _scanItemFlushing,
  };
  console.warn = (...a) => { fk.warns.push(a.join(' ')); };
  fk.gate = (n) => { let resolve; const promise = new Promise((r) => { resolve = r; }); fk.gates[n] = { promise, resolve }; };
  fk.deferTx = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); fk.txGate = { promise, resolve }; };
  const newBatch = () => {
    const b = { n: fk.batches.length + 1, ops: [] };
    b.set = (ref, data, opts) => { b.ops.push({ t: 'set', path: ref.path, data, opts }); };
    b.delete = (ref) => { b.ops.push({ t: 'delete', path: ref.path }); };
    b.commit = async () => {
      if (fk.gates[b.n]) await fk.gates[b.n].promise;
      if (fk.failBatch === b.n) throw Object.assign(new Error('unavailable'), { code: 'unavailable' });
      fk.written.push(...b.ops);
    };
    fk.batches.push(b);
    return b;
  };
  // transaction ปลอม: เขียนจริง (ลง fk.server) เมื่อ callback จบโดยไม่ error — ให้ transaction ที่สองเห็นผลของที่หนึ่ง (ลบผีแล้วสร้างใหม่)
  const newTx = (n) => {
    const pending = [];
    return {
      pending,
      async get(ref) {
        fk.txGets.push(ref.path);
        if (ref.path.startsWith('confirm_ops/') && fk.failOpGet) throw new Error('op read failed');
        if (fk.txGate && ref.path.startsWith('items/')) await fk.txGate.promise;
        if (ref.path.startsWith('items/') && fk.failItemGetFromTx && n >= fk.failItemGetFromTx) throw Object.assign(new Error('unavailable'), { code: 'unavailable' });
        const d = fk.server.get(ref.path);
        return { exists: d !== undefined, data: () => d, ref };
      },
      set(ref, data, opts) { fk.txSets.push({ path: ref.path, data, opts }); pending.push({ t: 'set', path: ref.path, data }); },
      delete(ref) { fk.txDeletes.push(ref.path); pending.push({ t: 'delete', path: ref.path }); },
    };
  };
  _db = { batch: newBatch, runTransaction: async (fn) => {
    const n = ++fk.txCount; const tx = newTx(n); const r = await fn(tx);
    for (const w of tx.pending) { if (w.t === 'delete') fk.server.delete(w.path); else fk.server.set(w.path, w.data); }
    if (fk.afterTx) fk.afterTx(n);
    return r;
  } };
  window.getScanItemsRef = () => ({ doc: (sku) => ({ path: 'items/' + sku, id: sku }) });
  window.getWhConfirmOpsRef = () => ({ doc: (id) => ({ path: 'confirm_ops/' + id, id }) });
  currentBranch = 'WH'; currentUser = 'ตั๋ง'; _adminMode = false; _schemaVersion = SCAN_SCHEMA_V2; _countResetAt = 'E1'; _scanItemFlushing = false;
  _dirtySkus.clear(); _scanItemInFlight.clear(); _scanItemRev.clear(); _scanItemSynced.clear(); state.scanData.clear();
  // รับรอบใหม่เหมือน _applyCloudSessionMeta: ป้ายรอบ + local เป็น pending + ล้าง rev/synced/dirty/inflight
  fk.adoptNewEpoch = (e) => {
    _countResetAt = e; _resetLocalScanDataToPending();
    _scanItemRev.clear(); _scanItemSynced.clear(); _dirtySkus.clear(); _scanItemInFlight.clear(); _scanItemFailStreak = 0; _scanItemBackoffUntil = 0;
  };
  // item ที่ยืนยันแล้วของรอบเก่า (เนื้อหา 25 ก.ย. อ้าง op เก่า) จำนวน n ใบ ทั้งหมด mark dirty
  fk.seedConfirmed = (n, prefix = 'G-') => {
    for (let i = 1; i <= n; i++) {
      const sku = prefix + String(i).padStart(4, '0');
      state.scanData.set(sku, { countedQty: 3, status: 'pass', retries: 0, scans: [], timestamp: '2026-09-25 17:14:34', scannedBy: 'ตั๋ง', auditor: '', auditStatus: 'approved',
        whCountOpId: 'count_old', countConfirmedAt: '2026-09-25T10:14:43.000Z' });
      _markSkuDirty(sku);
    }
    clearTimeout(_scanItemFlushTimer); _scanItemFlushTimer = null;
  };
  fk.hist = (key) => { const h = {}; for (const w of fk.written.filter((x) => x.t === 'set')) { const k = String(w.data[key]); h[k] = (h[k] || 0) + 1; } return h; };
  fk.dropWarns = () => fk.warns.filter((w) => w.includes('รอบนับเปลี่ยนระหว่างส่ง'));
};
const UNINSTALL = () => {
  const r = window.__fk.real;
  clearTimeout(_scanItemFlushTimer); _scanItemFlushTimer = null;
  _dirtySkus.clear(); _scanItemInFlight.clear(); _scanItemRev.clear(); _scanItemSynced.clear(); _scanItemFailStreak = 0; _scanItemBackoffUntil = 0; state.scanData.clear();
  _db = r.db; window.getScanItemsRef = r.ref; window.getWhConfirmOpsRef = r.opsRef; currentBranch = r.branch; _adminMode = r.admin; _schemaVersion = r.schema;
  _countResetAt = r.epoch; currentUser = r.user; console.warn = r.warn; _scanItemFlushing = r.flushing;
  SCAN_FLUSH_EPOCH_GUARD = true; WH_GHOST_OP_CHECK = true;
};
// รัน body บนหน้าเว็บ: ติดตั้งของปลอม → ตั้งสวิตช์ → รัน → คืนค่าเดิม (finally)
const run = (page, body, { epoch = true, ghost = true, branch = 'WH' } = {}) => page.evaluate(
  `(async()=>{(${INSTALL})();SCAN_FLUSH_EPOCH_GUARD=${epoch};WH_GHOST_OP_CHECK=${ghost};currentBranch=${JSON.stringify(branch)};try{return await (${body})();}finally{(${UNINSTALL})();}})()`);

// ── flush หลายชุดคร่อมการเปลี่ยนรอบ ──
const STRADDLE = async () => {
  __fk.seedConfirmed(1000);
  __fk.gate(1);                       // commit ชุดแรกค้าง (เน็ตสะดุด/เครื่องหลับ)
  const flushP = _flushDirtySkus();   // ชุดที่ 1 (450) ถูกสร้างแล้วด้วยรอบ E1 · ค้างรอ commit
  __fk.adoptNewEpoch('E2');           // ระหว่างรอ: เครื่องนี้รับรอบใหม่
  __fk.gates[1].resolve();
  await flushP;
  return { batches: __fk.batches.length, byEpoch: __fk.hist('countResetAt'), byRev: __fk.hist('rev'), dirty: _dirtySkus.size, drops: __fk.dropWarns(), deletes: __fk.written.filter((x) => x.t === 'delete').length };
};
const STRADDLE_ERROR = async () => {
  __fk.seedConfirmed(1000);
  __fk.gate(1); __fk.failBatch = 1;   // ชุดแรกล้ม (หลังรอบเปลี่ยน)
  const flushP = _flushDirtySkus();
  __fk.adoptNewEpoch('E2');
  __fk.gates[1].resolve();
  await flushP;
  return { batches: __fk.batches.length, written: __fk.written.length, dirty: _dirtySkus.size, drops: __fk.dropWarns() };
};
const SCANNING_STRADDLE = async () => {
  state.scanData.set('S-1', { countedQty: 2, status: 'scanning', retries: 0, scans: [], timestamp: '2026-10-07 08:50:00', scannedBy: 'ตั๋ง', auditor: '' });
  __fk.deferTx();                     // tx.get ค้าง
  const p = _writeScanningItem(getScanItemsRef(), 'S-1', 'E1');
  _countResetAt = 'E2';               // ระหว่างรอ: รับรอบใหม่
  __fk.txGate.resolve();
  await p;
  return { sets: __fk.txSets.map((s) => ({ path: s.path, epoch: s.data.countResetAt, rev: s.data.rev, status: s.data.status })) };
};

// ── ผี: เอกสาร confirmed ที่ op ไม่ใช่ committed ของรอบนี้ ──
const GHOST_CASE = (setup) => `async()=>{
  const itemDoc = { sku: 'S-1', countResetAt: 'E1', status: 'pass', countedQty: 5, rev: 3, scannedBy: 'ตั๋ง', whCountOpId: 'count_x', countConfirmedAt: '2026-09-25T10:14:43.000Z', initialStatus: 'pass' };
  (${setup})(itemDoc);
  state.scanData.set('S-1', { countedQty: 2, status: 'scanning', retries: 0, scans: [], timestamp: '2026-10-21 10:00:00', scannedBy: 'ตั๋ง', auditor: '', barcode: 'B-S-1' });
  await _writeScanningItem(getScanItemsRef(), 'S-1', 'E1');
  const sd = state.scanData.get('S-1');
  return { sets: __fk.txSets.map((s) => ({ status: s.data.status, qty: s.data.countedQty, rev: s.data.rev, epoch: s.data.countResetAt, op: s.data.whCountOpId || s.data.whRecheckOpId || '' })),
    deletes: __fk.txDeletes.slice(), txs: __fk.txCount, opReads: __fk.txGets.filter((p) => p.startsWith('confirm_ops/')), local: { status: sd.status, qty: sd.countedQty } };
}`;

test('ค่าเริ่มต้นที่ส่งมอบ — สวิตช์เปิดทั้งคู่ · ตัวช่วยมีอยู่', async ({ browser }) => {
  const app = await bootBare(browser);
  expect(await app.page.evaluate(() => [typeof SCAN_FLUSH_EPOCH_GUARD, SCAN_FLUSH_EPOCH_GUARD, typeof WH_GHOST_OP_CHECK, WH_GHOST_OP_CHECK, typeof _flushEpochMoved, typeof _whItemOpIsGhost]))
    .toEqual(['boolean', true, 'boolean', true, 'function', 'function']);
  // _flushEpochMoved: สวิตช์ปิด = false เสมอ · เปิด = เทียบกับรอบสด
  expect(await app.page.evaluate(() => { const e0 = _countResetAt; _countResetAt = 'E1'; const r = [_flushEpochMoved('E1'), _flushEpochMoved('E0')]; SCAN_FLUSH_EPOCH_GUARD = false; r.push(_flushEpochMoved('E0')); SCAN_FLUSH_EPOCH_GUARD = true; _countResetAt = e0; return r; }))
    .toEqual([false, true, false]);
  await closeApp(app);
});

test('★ เปิดสวิตช์: รอบเปลี่ยนระหว่างรอ commit ชุดแรก → ไม่สร้าง/เขียนชุดถัดไป · ไม่ requeue · ปิด = ชุดหลังถูกเขียนด้วยป้ายรอบใหม่ rev 1 (บั๊กเดิม)', async ({ browser }) => {
  const app = await bootBare(browser);
  const on = await run(app.page, STRADDLE, { epoch: true });
  expect(on.batches).toBe(1);                              // สร้างแค่ชุดแรก (ก่อนรอบเปลี่ยน)
  expect(on.byEpoch).toEqual({ E1: 450 });                 // ไม่มีเอกสารป้ายรอบใหม่เลย
  expect(on.dirty).toBe(0);                                // ไม่ requeue
  expect(on.deletes).toBe(0);
  expect(on.drops).toHaveLength(1);                        // บอก console ว่าทิ้งกี่รายการ
  expect(on.drops[0]).toContain('550');
  const off = await run(app.page, STRADDLE, { epoch: false });
  expect(off.batches).toBe(3);                             // 450 + 450 + 100
  expect(off.byEpoch).toEqual({ E1: 450, E2: 550 });       // ★ ผี: 550 ใบเนื้อหาเก่า ป้ายรอบใหม่
  expect(off.byRev).toEqual({ 1: 1000 });                   // ลายเซ็นผี: rev 1 ทั้งหมด (rev map ถูกล้างตอนรับรอบ)
  expect(off.drops).toHaveLength(0);
  await closeApp(app);
});

test('★ ชุดแรกล้มหลังรอบเปลี่ยน → ไม่ requeue ของรอบเก่า (ไม่งั้นรอบ flush ถัดไปกลายเป็นคำสั่งลบ doc ตาม SKU ของรอบใหม่) · ปิด = requeue ทั้ง 1,000', async ({ browser }) => {
  const app = await bootBare(browser);
  const on = await run(app.page, STRADDLE_ERROR, { epoch: true });
  expect(on).toMatchObject({ batches: 1, written: 0, dirty: 0 });
  expect(on.drops).toHaveLength(1);
  expect(on.drops[0]).toContain('ทิ้ง 1000 รายการ');      // 450 ที่ requeue จากชุดแรกที่ล้ม + 550 ที่ยังไม่ได้สร้าง
  const off = await run(app.page, STRADDLE_ERROR, { epoch: false });
  expect(off).toMatchObject({ batches: 1, written: 0, dirty: 1000 });   // เดิม: SKU ของรอบเก่ากลับเข้า dirty หลังรับรอบใหม่
  await closeApp(app);
});

test('★ รอบไม่เปลี่ยน → flush หลายชุดเขียนครบเหมือนเดิม (ทั้งสองโหมด) · ไม่มี drop', async ({ browser }) => {
  const app = await bootBare(browser);
  const body = async () => {
    __fk.seedConfirmed(1000);
    __fk.gate(1);
    const flushP = _flushDirtySkus();
    __fk.gates[1].resolve();           // ไม่มีใครเปลี่ยนรอบ
    await flushP;
    return { batches: __fk.batches.length, byEpoch: __fk.hist('countResetAt'), dirty: _dirtySkus.size, drops: __fk.dropWarns().length };
  };
  for (const epoch of [true, false]) {
    expect(await run(app.page, body, { epoch }), `epoch=${epoch}`).toEqual({ batches: 3, byEpoch: { E1: 1000 }, dirty: 0, drops: 0 });
  }
  await closeApp(app);
});

test('★ รอบเปลี่ยนก่อนเริ่มชุดแรก/ระหว่างวง scanning → ทิ้งทั้งหมด · scanning 25 ตัวแรกต่อรอบยังเขียนปกติเมื่อรอบไม่เปลี่ยน', async ({ browser }) => {
  const app = await bootBare(browser);
  // รอบเปลี่ยนระหว่างเขียน scanning ตัวแรก (tx.get ค้าง) → ตัวที่เหลือไม่ถูกเขียน ไม่ requeue
  const body = async () => {
    for (let i = 1; i <= 5; i++) { state.scanData.set('S-' + i, { countedQty: i, status: 'scanning', retries: 0, scans: [], timestamp: '2026-10-07 08:50:00', scannedBy: 'ตั๋ง', auditor: '' }); _markSkuDirty('S-' + i); }
    clearTimeout(_scanItemFlushTimer); _scanItemFlushTimer = null;
    __fk.deferTx();
    const flushP = _flushDirtySkus();
    __fk.adoptNewEpoch('E2');
    __fk.txGate.resolve();
    await flushP;
    return { sets: __fk.txSets.length, dirty: _dirtySkus.size, drops: __fk.dropWarns().length };
  };
  expect(await run(app.page, body, { epoch: true })).toEqual({ sets: 0, dirty: 0, drops: 1 });
  const off = await run(app.page, body, { epoch: false });
  expect(off.sets).toBeGreaterThan(0);            // เดิม: เขียนต่อด้วยป้ายรอบใหม่
  // รอบไม่เปลี่ยน: 5 ตัวเขียนครบ
  const same = async () => {
    for (let i = 1; i <= 5; i++) { state.scanData.set('S-' + i, { countedQty: i, status: 'scanning', retries: 0, scans: [], timestamp: '2026-10-07 08:50:00', scannedBy: 'ตั๋ง', auditor: '' }); _markSkuDirty('S-' + i); }
    clearTimeout(_scanItemFlushTimer); _scanItemFlushTimer = null;
    await _flushDirtySkus();
    return { sets: __fk.txSets.map((s) => s.data.countResetAt), dirty: _dirtySkus.size };
  };
  for (const epoch of [true, false]) expect(await run(app.page, same, { epoch }), `epoch=${epoch}`).toEqual({ sets: ['E1', 'E1', 'E1', 'E1', 'E1'], dirty: 0 });
  await closeApp(app);
});

test('★ _writeScanningItem: รอบเปลี่ยนระหว่างรอ tx.get → ไม่ tx.set · ปิด = tx.set ด้วยป้ายรอบใหม่ (ผี scanning)', async ({ browser }) => {
  const app = await bootBare(browser);
  expect(await run(app.page, SCANNING_STRADDLE, { epoch: true })).toEqual({ sets: [] });
  const off = await run(app.page, SCANNING_STRADDLE, { epoch: false });
  expect(off.sets).toEqual([{ path: 'items/S-1', epoch: 'E2', rev: 1, status: 'scanning' }]);
  await closeApp(app);
});

test('★ ผีบน Cloud (op ถูกลบ) → PDA สแกนได้ ไม่รับเป็น Pass · ลบผีก่อน (transaction 1) แล้วสร้างยอดสแกนจริง (transaction 2) ไม่มี op ค้าง · ปิดสวิตช์ = รับเป็น Pass (อาการเดิม)', async ({ browser }) => {
  const app = await bootBare(browser);
  const noOp = GHOST_CASE((d) => { __fk.server.set('items/S-1', d); });   // เอกสาร confirmed อ้าง op ที่ไม่มีบน server เลย (ถูกลบตอนเริ่มนับใหม่)
  const on = await run(app.page, noOp, { ghost: true });
  expect(on.opReads).toEqual(['confirm_ops/count_x']);     // อ่าน op ครั้งเดียว (transaction แรก) — transaction ที่สองไม่เจอเอกสารแล้ว
  expect(on.deletes).toEqual(['items/S-1']);               // ★ ลบผี (rules ห้ามเขียนทับตรงๆ — ดู e2e)
  expect(on.txs).toBe(2);
  expect(on.sets).toEqual([{ status: 'scanning', qty: 2, rev: 4, epoch: 'E1', op: '' }]);   // ยอดสแกนจริง (ไม่ใช่ 5 ของผี · ไม่บวกซ้อน) · rev ต่อจากผี (3 → 4) · ไม่มี op
  expect(on.local).toEqual({ status: 'scanning', qty: 2 });
  const off = await run(app.page, noOp, { ghost: false });
  expect(off.opReads).toEqual([]);                  // ไม่อ่าน op เลย = พฤติกรรมเดิม
  expect(off.deletes).toEqual([]);
  expect(off.txs).toBe(1);
  expect(off.sets).toEqual([]);                     // abort 'confirmed'
  expect(off.local).toEqual({ status: 'pass', qty: 5 });   // ★ PDA เห็น Pass ทั้งที่ Desktop ไม่เห็นผลนั้น
  await closeApp(app);
});

test('★ op ที่ไม่ครบเงื่อนไข = ผีทุกแบบ (preparing · aborted · คนละรอบ · recheck ผี แม้ count op committed) · committed ของรอบนี้ = Confirm จริง ห้ามทับ', async ({ browser }) => {
  const app = await bootBare(browser);
  const cases = {
    preparing: GHOST_CASE((d) => { __fk.server.set('items/S-1', d); __fk.server.set('confirm_ops/count_x', { state: 'preparing', countResetAt: 'E1' }); }),
    aborted: GHOST_CASE((d) => { __fk.server.set('items/S-1', d); __fk.server.set('confirm_ops/count_x', { state: 'aborted', countResetAt: 'E1' }); }),
    otherRound: GHOST_CASE((d) => { __fk.server.set('items/S-1', d); __fk.server.set('confirm_ops/count_x', { state: 'committed', countResetAt: 'E0' }); }),
    recheckGhost: GHOST_CASE((d) => { d.whRecheckOpId = 'recheck_y'; __fk.server.set('items/S-1', d); __fk.server.set('confirm_ops/count_x', { state: 'committed', countResetAt: 'E1' }); }),   // reader ใช้ recheck ก่อน count
    committed: GHOST_CASE((d) => { __fk.server.set('items/S-1', d); __fk.server.set('confirm_ops/count_x', { state: 'committed', countResetAt: 'E1' }); }),
    committedBoth: GHOST_CASE((d) => { d.whRecheckOpId = 'recheck_y'; __fk.server.set('items/S-1', d); __fk.server.set('confirm_ops/count_x', { state: 'committed', countResetAt: 'E1' }); __fk.server.set('confirm_ops/recheck_y', { state: 'committed', countResetAt: 'E1' }); }),
  };
  for (const name of ['preparing', 'aborted', 'otherRound', 'recheckGhost']) {
    const r = await run(app.page, cases[name], {});
    expect(r.deletes, name).toEqual(['items/S-1']);
    expect(r.sets, name).toHaveLength(1);
    expect(r.sets[0], name).toMatchObject({ status: 'scanning', qty: 2, op: '' });
    expect(r.local, name).toEqual({ status: 'scanning', qty: 2 });
  }
  for (const name of ['committed', 'committedBoth']) {
    const r = await run(app.page, cases[name], {});
    expect(r.deletes, name).toEqual([]);                                 // ★ ไม่ลบ Confirm จริง
    expect(r.sets, name).toEqual([]);                                    // ไม่ทับ Confirm จริง
    expect(r.local, name).toEqual({ status: 'pass', qty: 5 });           // รับผล server เหมือนเดิม
  }
  await closeApp(app);
});

test('★ ไม่เข้าข่ายผี → พฤติกรรมเดิม ไม่อ่าน op: เอกสารไม่ผูก op (legacy) · ไม่ใช่ WH · เอกสารยังเป็น scanning', async ({ browser }) => {
  const app = await bootBare(browser);
  // legacy: ไม่มี op id → Confirm แล้วตามเดิม
  const legacy = GHOST_CASE((d) => { delete d.whCountOpId; __fk.server.set('items/S-1', d); });
  const l = await run(app.page, legacy, {});
  expect(l.opReads).toEqual([]); expect(l.deletes).toEqual([]); expect(l.sets).toEqual([]); expect(l.local).toEqual({ status: 'pass', qty: 5 });
  // สาขายา: มี field op ติดมา (ไม่ควรมี) ก็ไม่อ่าน op — ด่านนี้ของ WH เท่านั้น
  const pharm = GHOST_CASE((d) => { __fk.server.set('items/S-1', d); });
  const p = await run(app.page, pharm, { branch: 'SRC' });
  expect(p.opReads).toEqual([]); expect(p.deletes).toEqual([]); expect(p.sets).toEqual([]); expect(p.local).toEqual({ status: 'pass', qty: 5 });
  // เอกสาร scanning ปกติ (เครื่องอื่นสแกนอยู่): บวก delta เหมือนเดิม ไม่อ่าน op
  const scanning = GHOST_CASE((d) => { d.status = 'scanning'; d.countedQty = 5; delete d.whCountOpId; __fk.server.set('items/S-1', d); });
  const s = await run(app.page, scanning, {});
  expect(s.opReads).toEqual([]);
  expect(s.deletes).toEqual([]);
  expect(s.sets).toHaveLength(1);
  expect(s.sets[0]).toMatchObject({ status: 'scanning', qty: 7, rev: 4 });   // base 5 + delta 2
  await closeApp(app);
});

test('★ อ่าน op ไม่สำเร็จ → transaction ล้มทั้งก้อน ไม่เขียนทับ (fail-closed) · _writeScanningItem โยน error ให้ flush จัดการ backoff', async ({ browser }) => {
  const app = await bootBare(browser);
  const body = async () => {
    __fk.server.set('items/S-1', { sku: 'S-1', countResetAt: 'E1', status: 'pass', countedQty: 5, rev: 3, whCountOpId: 'count_x' });
    __fk.failOpGet = true;
    state.scanData.set('S-1', { countedQty: 2, status: 'scanning', retries: 0, scans: [], timestamp: '2026-10-21 10:00:00', scannedBy: 'ตั๋ง', auditor: '' });
    let err = '';
    try { await _writeScanningItem(getScanItemsRef(), 'S-1', 'E1'); } catch (e) { err = e.message; }
    return { err, sets: __fk.txSets.length, deletes: __fk.txDeletes.length, still: __fk.server.has('items/S-1') };
  };
  expect(await run(app.page, body, {})).toEqual({ err: 'op read failed', sets: 0, deletes: 0, still: true });   // ผียังอยู่ครบ — ไม่ลบเมื่อยังตัดสินไม่ได้
  await closeApp(app);
});

// ── ลบผีแล้ว: เหตุการณ์ระหว่างสอง transaction ──
const GHOST_DOC = { sku: 'S-1', countResetAt: 'E1', status: 'pass', countedQty: 5, rev: 3, scannedBy: 'ตั๋ง', whCountOpId: 'count_x', countConfirmedAt: '2026-09-25T10:14:43.000Z', initialStatus: 'pass' };
const SCAN_S1 = "state.scanData.set('S-1', { countedQty: 2, status: 'scanning', retries: 0, scans: [], timestamp: '2026-10-21 10:00:00', scannedBy: 'ตั๋ง', auditor: '', barcode: 'B-S-1' });";

test('★ ผีโผล่ซ้ำหลังลบ (เครื่องอื่นเขียนผีกลับมา) → ลบครั้งเดียวไม่วน · เจอ confirmed รอบสองรับตามเดิม (ผีมี rev / ไม่มี rev)', async ({ browser }) => {
  const app = await bootBare(browser);
  const { rev: _drop, ...NO_REV } = GHOST_DOC;      // ผีที่ไม่มี field rev (ghostRev ต้องไม่เป็น 0 ไม่งั้นด่านกันวนหลุด)
  for (const [name, first, again] of [['มี rev', GHOST_DOC, { ...GHOST_DOC, rev: 9 }], ['ไม่มี rev', NO_REV, NO_REV]]) {
    const r = await run(app.page, `async()=>{
      __fk.server.set('items/S-1', ${JSON.stringify(first)});
      __fk.afterTx = (n) => { if (n === 1) __fk.server.set('items/S-1', ${JSON.stringify(again)}); };   // หลัง transaction แรก (ลบ) มีผีโผล่กลับมา
      ${SCAN_S1}
      await _writeScanningItem(getScanItemsRef(), 'S-1', 'E1');
      const sd = state.scanData.get('S-1');
      return { txs: __fk.txCount, deletes: __fk.txDeletes.length, sets: __fk.txSets.length, opReads: __fk.txGets.filter((p) => p.startsWith('confirm_ops/')).length, local: { status: sd.status, qty: sd.countedQty } };
    }`, {});
    expect(r, name).toEqual({ txs: 2, deletes: 1, sets: 0, opReads: 1, local: { status: 'pass', qty: 5 } });   // ไม่ลบรอบสอง ไม่อ่าน op รอบสอง ไม่วนไม่รู้จบ
  }
  await closeApp(app);
});

test('★ ลบผีแล้ว transaction สร้างใหม่ล้ม (ออฟไลน์) → requeue + backoff · ผีหายจาก server แล้ว · รอบถัดไปสร้างยอดสแกนได้ตามปกติ', async ({ browser }) => {
  const app = await bootBare(browser);
  const r = await run(app.page, `async()=>{
    __fk.server.set('items/S-1', ${JSON.stringify(GHOST_DOC)});
    ${SCAN_S1}
    _markSkuDirty('S-1'); clearTimeout(_scanItemFlushTimer); _scanItemFlushTimer = null;
    __fk.failItemGetFromTx = 2;                 // transaction ที่สอง (สร้างใหม่) อ่านไม่ได้
    await _flushDirtySkus();
    const first = { dirty: [..._dirtySkus], ghostGone: !__fk.server.has('items/S-1'), backoff: _scanItemBackoffUntil > Date.now(), deletes: __fk.txDeletes.length, sets: __fk.txSets.length };
    __fk.failItemGetFromTx = 0; _scanItemBackoffUntil = 0; _scanItemFailStreak = 0; clearTimeout(_scanItemFlushTimer); _scanItemFlushTimer = null;
    await _flushDirtySkus();
    const doc = __fk.server.get('items/S-1');
    return { first, second: { dirty: [..._dirtySkus], doc: doc && { status: doc.status, qty: doc.countedQty, rev: doc.rev, op: doc.whCountOpId || '' }, deletes: __fk.txDeletes.length, sets: __fk.txSets.length } };
  }`, {});
  expect(r.first).toEqual({ dirty: ['S-1'], ghostGone: true, backoff: true, deletes: 1, sets: 0 });
  expect(r.second).toEqual({ dirty: [], doc: { status: 'scanning', qty: 2, rev: 1, op: '' }, deletes: 1, sets: 1 });   // ไม่มีผีให้ลบอีก · สร้างใหม่ (rev เริ่ม 1 เพราะรอบนี้ไม่รู้ rev ของผีแล้ว)
  await closeApp(app);
});

test('★ รอบเปลี่ยนระหว่างรอ transaction ที่เจอผี → ไม่ลบผี ไม่สร้าง (ของรอบเก่าไม่แตะ Cloud) · ปิด SCAN_FLUSH_EPOCH_GUARD = ลบผีแล้วสร้างด้วยป้ายรอบใหม่', async ({ browser }) => {
  const app = await bootBare(browser);
  const body = `async()=>{
    __fk.server.set('items/S-1', ${JSON.stringify(GHOST_DOC)});
    ${SCAN_S1}
    __fk.deferTx();
    const p = _writeScanningItem(getScanItemsRef(), 'S-1', 'E1');
    _countResetAt = 'E2';                         // ระหว่างรอ tx.get: เครื่องนี้รับรอบใหม่
    __fk.txGate.resolve();
    await p;
    return { deletes: __fk.txDeletes.length, sets: __fk.txSets.map((s) => s.data.countResetAt), ghost: __fk.server.has('items/S-1') && __fk.server.get('items/S-1').whCountOpId === 'count_x' };
  }`;
  expect(await run(app.page, body, { epoch: true })).toEqual({ deletes: 0, sets: [], ghost: true });
  const off = await run(app.page, body, { epoch: false });
  expect(off.deletes).toBe(1);                    // เดิม: ไปต่อ — ลบผีของรอบเก่า แล้วเขียนป้ายรอบใหม่
  expect(off.sets).toEqual(['E2']);
  await closeApp(app);
});
