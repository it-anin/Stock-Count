// อ่าน Cloud ตอนล็อกอินพร้อมกัน (ต.ค. 2026 · สวิตช์ LOGIN_PARALLEL_READ · ผู้ใช้อนุมัติแผนตามกฎ 1)
// เดิม restoreFromFirestore รอ [R01+R05] → PM meta → session doc ต่อกันทีละรอบ Cloud แล้วค่อยอ่าน items
// ตอนนี้เริ่มอ่าน PM meta + session doc พร้อมกับ R01+R05 (items ยังอ่านหลัง session เพราะ query ด้วย countResetAt)
// ตรึง: ★ เปิดสวิตช์ = ออก request ทั้ง 4 ก่อนมีตัวไหนตอบ + เร็วกว่าแบบเดิมชัดเจน · ★ ปิดสวิตช์ = ลำดับเดิมเป๊ะ
//       ★ "ผลลัพธ์" (catalog · scanData · epoch · badge · สถานะ) เท่ากันทุกโหมดและทุกจังหวะที่ตอบ (PM/session มาก่อน R01 ก็ต้องได้ผลเดิม)
//       ★ อ่านล้ม = ไม่ throw · ไม่ขึ้น unhandled rejection แม้ล้มก่อนถึงจุด await · ผลของตัวที่ไม่ล้มยังถูก apply
// ใช้ _db ปลอมที่หน่วงเวลาได้ — ไม่แตะ Firestore/emulator (logic project)
const { test, expect, bootBare, closeApp } = require('../../lib/hooks');

// รันฟังก์ชันจริง restoreFromFirestore บนหน้าเว็บด้วย _db ปลอม · คืน: ลำดับเหตุการณ์ · เวลา · snapshot ผลลัพธ์ · คำเตือนที่ console.warn
async function runRestore(page, { parallel, force = true, latency = {}, fail = {}, noPm = false, local = false, def = 80 }) {
  return page.evaluate(async ({ parallel, force, latency, fail, noPm, local, def }) => {
    const realDb = _db, realBranch = currentBranch, realWarn = console.warn, realAdmin = _adminMode;
    const warns = [];
    console.warn = (...a) => { warns.push(a.map(String).join(' ')); };
    _adminMode = true;   // กัน saveSession ตั้ง sync ไปที่ _db ปลอม
    LOGIN_PARALLEL_READ = parallel;
    currentBranch = 'SRC';
    // เริ่มจากหน้าว่าง (หรือมี backup ในเครื่องเมื่อ local=true) — รูปเดียวกับตอนเพิ่งเปิดหน้า
    state.r01Data = []; state.r01Version = ''; state.r05Data = []; state.productMasterData = []; state.productMasterMap.clear();
    state.skuMap.clear(); state.barcodeMap.clear(); state.skuDirectMap.clear(); state.scanData.clear(); scanListMap.clear();
    _countResetAt = ''; _schemaVersion = 1; _dirtySkus.clear();
    const r01Rows = [{ colE: 'A1', productName: 'ยา A', systemQty: 5 }, { colE: 'B2', productName: 'ยา B', systemQty: 0 }];
    const r05Rows = [{ barcode: '111', colE: 'A1', unitName: 'เม็ด', unitMultiplier: 1, unitPrice: 10 }, { barcode: '222', colE: 'B2', unitName: 'เม็ด', unitMultiplier: 1, unitPrice: 20 }];
    const docs = {
      SRC_r01: { data_json: JSON.stringify(r01Rows), r01Version: 'R01-X', r01UploadedAt: 'ทดสอบ' },
      global_r05: { data_json: _serializeR05(r05Rows), format: 'r05a1' },
      SRC_pm: noPm ? undefined : { data_json: JSON.stringify([{ sku: 'A1', productName: 'ยา A', unitPrice: 10, cat: 'A' }, { sku: 'B2', productName: 'ยา B', unitPrice: 20, cat: 'A' }]), updated_at_text: 'pm-ทดสอบ' },
      SRC: { session_data_json: JSON.stringify({ countResetAt: '2026-10-01T00:00:00.000Z', unknownScans: [],
        scanData: { A1: { countedQty: 2, status: 'pass', timestamp: '2026-10-19 10:00:00', scannedBy: 'T', barcode: '111' } } }) },
    };
    if (local) {   // เครื่องที่มี backup ในเครื่องอยู่แล้ว + login แบบไม่ force
      state.r01Data = r01Rows; state.r01Version = 'R01-X'; state.r05Data = r05Rows;
      _countResetAt = '2026-10-01T00:00:00.000Z';
      rebuildMaps();
      state.scanData.set('A1', { ...state.scanData.get('A1'), countedQty: 1, status: 'scanning', scannedBy: 'T', timestamp: '2026-10-19 09:00:00', barcode: '111' });
    }
    const ev = [];
    const t0 = performance.now();
    const snapDoc = (exists, data) => ({ exists, data: () => data, id: 'x' });
    _db = { collection: () => ({ doc: (id) => ({ get: () => {
      ev.push('issue:' + id);
      return new Promise((res, rej) => setTimeout(() => {
        if (fail[id]) { ev.push('fail:' + id); rej(new Error(id + ' BOOM')); } else { ev.push('done:' + id); res(snapDoc(docs[id] !== undefined, docs[id])); }
      }, latency[id] ?? def));
    } }) }) };
    let threw = null;
    try { await restoreFromFirestore(force); } catch (e) { threw = String(e); }
    const ms = Math.round(performance.now() - t0);
    const snap = {
      r01: state.r01Data.length, r05: state.r05Data.length, pm: state.productMasterData.length, skus: state.skuMap.size,
      pmBadge: document.getElementById('badgeProductMaster').textContent, r01Badge: document.getElementById('badgeR01').textContent,
      epoch: _countResetAt, db: document.getElementById('dbStatus').textContent,
      scan: [...state.scanData.entries()].filter(([, v]) => v.status !== 'pending').map(([k, v]) => [k, v.status, v.countedQty]).sort(),
      countable: _cachedTotalSku,
    };
    _db = realDb; currentBranch = realBranch; console.warn = realWarn; _adminMode = realAdmin; LOGIN_PARALLEL_READ = true;
    localStorage.clear();
    return { ev, ms, snap, threw, warns };
  }, { parallel, force, latency, fail, noPm, local, def });
}

const firstDone = (ev) => ev.findIndex((e) => e.startsWith('done:') || e.startsWith('fail:'));
const idx = (ev, e) => ev.indexOf(e);

test('ค่าเริ่มต้นที่ส่งมอบ — สวิตช์เปิด · ตัวช่วยมีอยู่', async ({ browser }) => {
  const app = await bootBare(browser);
  expect(await app.page.evaluate(() => [typeof LOGIN_PARALLEL_READ, LOGIN_PARALLEL_READ, typeof _prefetchRead, typeof _prefetchedValue])).toEqual(['boolean', true, 'function', 'function']);
  await closeApp(app);
});

test('★ เปิดสวิตช์: ออก request ทั้ง 4 (R01 · R05 · PM · session) ก่อนมีตัวไหนตอบ · เร็วกว่าแบบเดิมชัดเจน', async ({ browser }) => {
  const app = await bootBare(browser);
  const par = await runRestore(app.page, { parallel: true, def: 120 });
  expect(par.threw).toBeNull();
  const firstFour = par.ev.slice(0, 4);
  expect([...firstFour].sort()).toEqual(['issue:SRC', 'issue:SRC_pm', 'issue:SRC_r01', 'issue:global_r05']);   // ครบ 4 ก่อนมี done/fail ตัวแรก
  expect(firstDone(par.ev)).toBe(4);
  // เอกสารละ 1 ครั้ง — ห้าม prefetch แล้วอ่านซ้ำ (เสียโควต้า) · global_r05_status คือการอ่านเดิมของ refreshR05CheckedTs (มีทั้งสองโหมด ไม่ใช่ของงานนี้)
  const issued = par.ev.filter((e) => e.startsWith('issue:'));
  expect(new Set(issued).size, `อ่านซ้ำ: ${issued.join(' ')}`).toBe(issued.length);
  const seq = await runRestore(app.page, { parallel: false, def: 120 });
  expect(seq.threw).toBeNull();
  expect([...seq.ev.filter((e) => e.startsWith('issue:'))].sort(), 'ชุดเอกสารที่อ่านต้องเท่าเดิมทุกตัว').toEqual([...issued].sort());
  // แบบเดิมคือ 3 รอบต่อกัน (≈360ms) แบบใหม่ 1 รอบ (≈120ms) — เผื่อเครื่องช้า: ต่างกันอย่างน้อย 1 รอบ
  expect(seq.ms - par.ms, `par=${par.ms}ms seq=${seq.ms}ms`).toBeGreaterThanOrEqual(120);
  await closeApp(app);
});

test('★ ปิดสวิตช์ (ทางถอย): ลำดับเดิมเป๊ะ — [R01+R05] → PM → session ทีละรอบ', async ({ browser }) => {
  const app = await bootBare(browser);
  const r = await runRestore(app.page, { parallel: false });
  expect(r.threw).toBeNull();
  expect(r.ev.slice(0, 2)).toEqual(['issue:SRC_r01', 'issue:global_r05']);                 // R01+R05 ออกพร้อมกันเหมือนเดิม
  expect(idx(r.ev, 'issue:SRC_pm')).toBeGreaterThan(idx(r.ev, 'done:SRC_r01'));              // PM รอ R01 เสร็จ
  expect(idx(r.ev, 'issue:SRC_pm')).toBeGreaterThan(idx(r.ev, 'done:global_r05'));           // และ R05 เสร็จ
  expect(idx(r.ev, 'issue:SRC')).toBeGreaterThan(idx(r.ev, 'done:SRC_pm'));                  // session รอ PM เสร็จ
  await closeApp(app);
});

test('★ ผลลัพธ์เท่ากันทุกโหมดและทุกจังหวะตอบ (PM/session ตอบก่อน R01 ก็ต้องได้ผลเดิม) · ไม่ใช่ผลว่างเปล่า', async ({ browser }) => {
  const app = await bootBare(browser);
  const base = await runRestore(app.page, { parallel: false });
  // กันเทสผ่านเปล่าๆ — ผลต้องมีของครบจริง
  expect(base.snap).toMatchObject({ r01: 2, r05: 2, pm: 2, skus: 2, epoch: '2026-10-01T00:00:00.000Z', pmBadge: 'Ready', r01Badge: 'Ready' });
  expect(base.snap.scan).toEqual([['A1', 'pass', 2]]);
  expect(base.snap.db).toBe('Synced ☁️');
  for (const latency of [{}, { SRC: 5, SRC_pm: 5, SRC_r01: 90, global_r05: 90 }, { SRC: 90, SRC_pm: 5, SRC_r01: 40, global_r05: 5 }, { SRC_pm: 100 }]) {
    const par = await runRestore(app.page, { parallel: true, latency });
    expect(par.threw).toBeNull();
    expect(par.snap, `latency=${JSON.stringify(latency)}`).toEqual(base.snap);
    expect(par.warns).toEqual(base.warns);
  }
  await closeApp(app);
});

test('★ เครื่องที่มี backup ในเครื่อง (login ไม่ force): ผลเท่ากัน · อ่านเฉพาะ R01 + PM + session พร้อมกัน (ไม่อ่าน R05 ซ้ำ)', async ({ browser }) => {
  const app = await bootBare(browser);
  const seq = await runRestore(app.page, { parallel: false, force: false, local: true });
  const par = await runRestore(app.page, { parallel: true, force: false, local: true });
  expect(par.snap).toEqual(seq.snap);
  expect(par.snap.scan).toEqual([['A1', 'pass', 2]]);            // ผลที่ Confirm บน Cloud ถูก merge เข้าเครื่อง (เส้นทาง hasLocal)
  expect([...par.ev.slice(0, 3)].sort()).toEqual(['issue:SRC', 'issue:SRC_pm', 'issue:SRC_r01']);
  expect(firstDone(par.ev)).toBe(3);
  expect(par.ev.some((e) => e.endsWith('global_r05'))).toBe(false);   // เส้นทางนี้ไม่เคยอ่าน R05 — ห้ามเพิ่ม
  await closeApp(app);
});

test('★ สาขาที่ไม่มี PBM (doc ไม่มี): ผลเท่ากันทั้งสองโหมด — PM ว่าง · badge "ยังไม่โหลด"', async ({ browser }) => {
  const app = await bootBare(browser);
  const seq = await runRestore(app.page, { parallel: false, noPm: true });
  const par = await runRestore(app.page, { parallel: true, noPm: true });
  expect(par.snap).toEqual(seq.snap);
  expect(par.snap).toMatchObject({ pm: 0, pmBadge: 'ยังไม่โหลด', r01: 2, r05: 2 });
  await closeApp(app);
});

test('★ อ่านล้ม: session ล้ม → ไม่ throw · สถานะ Ready · master ที่อ่านได้ยังถูก apply · ทั้งสองโหมดเหมือนกัน (ล้มก่อน/หลัง master เสร็จ)', async ({ browser }) => {
  const app = await bootBare(browser);
  const seq = await runRestore(app.page, { parallel: false, fail: { SRC: true } });
  expect(seq.threw).toBeNull();
  expect(seq.snap).toMatchObject({ db: 'Ready', r01: 2, r05: 2, pm: 2, scan: [] });
  // ล้มเร็ว (5ms) ขณะ master ยังรออยู่ (90ms) = ล้มก่อนถึงจุด await — ต้องไม่ขึ้น unhandled rejection (closeApp ตรวจ pageerror)
  const early = await runRestore(app.page, { parallel: true, fail: { SRC: true }, latency: { SRC: 5, SRC_r01: 90, global_r05: 90, SRC_pm: 90 } });
  expect(early.threw).toBeNull();
  expect(early.snap).toEqual(seq.snap);
  expect(seq.warns.some((w) => w.includes('Firestore restore:') && w.includes('SRC BOOM'))).toBe(true);   // สาเหตุจริงถูกเตือน
  expect(early.warns).toEqual(seq.warns);   // error ต้องถูกโยนที่จุดใช้งานด้วยข้อความเดิม — ไม่ใช่ถูกกลืนแล้วไปล้มเป็น TypeError (doc undefined)
  const late = await runRestore(app.page, { parallel: true, fail: { SRC: true }, latency: { SRC: 120, SRC_r01: 10, global_r05: 10, SRC_pm: 10 } });
  expect(late.snap).toEqual(seq.snap);
  expect(late.warns).toEqual(seq.warns);
  await closeApp(app);   // ไม่มี pageerror = ไม่มี unhandled rejection
});

test('★ อ่านล้ม: PM ล้ม → เตือนใน console เหมือนเดิม · R01/R05/session ยังใช้ได้ · ล้มก่อนถึงจุด await ก็ไม่ขึ้น unhandled rejection', async ({ browser }) => {
  const app = await bootBare(browser);
  const seq = await runRestore(app.page, { parallel: false, fail: { SRC_pm: true } });
  expect(seq.threw).toBeNull();
  expect(seq.warns.some((w) => w.includes('Firestore product branch master restore') && w.includes('SRC_pm BOOM'))).toBe(true);
  expect(seq.snap).toMatchObject({ r01: 2, r05: 2, pm: 0 });
  expect(seq.snap.scan).toEqual([['A1', 'pass', 2]]);
  const early = await runRestore(app.page, { parallel: true, fail: { SRC_pm: true }, latency: { SRC_pm: 5, SRC_r01: 90, global_r05: 90, SRC: 90 } });
  expect(early.threw).toBeNull();
  expect(early.snap).toEqual(seq.snap);
  expect(early.warns).toEqual(seq.warns);   // ข้อความเตือนเดียวกันทุกตัวอักษร (error ถูกโยนที่จุดใช้งานเหมือนเดิม ไม่ใช่ที่จุด prefetch)
  await closeApp(app);
});

test('★ R01 ล้ม (ในกลุ่ม Promise.all เดิม) → พฤติกรรมเดิม: เตือน "master restore" · PM/session ยังอ่านต่อ', async ({ browser }) => {
  const app = await bootBare(browser);
  const seq = await runRestore(app.page, { parallel: false, fail: { SRC_r01: true } });
  const par = await runRestore(app.page, { parallel: true, fail: { SRC_r01: true } });
  expect(par.snap).toEqual(seq.snap);
  expect(par.warns).toEqual(seq.warns);
  expect(seq.warns.some((w) => w.includes('Firestore master restore'))).toBe(true);
  expect(par.snap.pm).toBe(2);
  await closeApp(app);
});

test('prefetch สร้าง ref ไม่ได้ (โยนทันที/ไม่มี ref) → ไม่ prefetch · จุดใช้งานอ่านเองแบบเดิม ไม่พัง', async ({ browser }) => {
  const app = await bootBare(browser);
  const r = await app.page.evaluate(async () => {
    const out = {};
    out.nullRef = _prefetchRead(() => null);                                  // ไม่มี ref (เช่น ไม่มี _db)
    out.throws = _prefetchRead(() => { throw new Error('sync boom'); });      // สร้าง ref ไม่ได้
    LOGIN_PARALLEL_READ = false;
    out.off = _prefetchRead(() => ({ get: () => Promise.resolve(1) }));       // สวิตช์ปิด = ไม่เรียก get เลย
    LOGIN_PARALLEL_READ = true;
    const ok = _prefetchRead(() => ({ get: () => Promise.resolve('V') }));
    out.okValue = await _prefetchedValue(ok);
    const bad = _prefetchRead(() => ({ get: () => Promise.reject(new Error('E1')) }));
    out.badErr = await _prefetchedValue(bad).then(() => 'resolved', (e) => e.message);
    const undef = _prefetchRead(() => ({ get: () => Promise.reject(undefined) }));
    out.undefErr = await _prefetchedValue(undef).then(() => 'resolved', () => 'rejected');   // reject ด้วย undefined ก็ต้องยัง reject (ไม่กลืน)
    return out;
  });
  expect(r).toEqual({ nullRef: null, throws: null, off: null, okValue: 'V', badErr: 'E1', undefErr: 'rejected' });
  await closeApp(app);
});
