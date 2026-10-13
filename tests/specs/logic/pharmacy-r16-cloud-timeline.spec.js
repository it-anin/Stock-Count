// ตัวอ่าน timeline R16.104 ของสาขายาจาก Cloud (ต.ค. 2026 · PHARMACY_R16_CLOUD_TIMELINE) — _loadPharmacyR16Timeline + hook ของ master listener
//
// ทำไมต้องมี: สาขายาไม่เคยมี raw timeline (r16RawMap) บน Cloud — Desktop ที่ไม่ได้อัปไฟล์เองได้แค่ยอดรวมต่อ SKU ⇒ getSoldQtyBefore
// บวกยอดขายทั้งวันไม่กรองเวลาสแกน ⇒ Stock Adj ปลอมลง ERP · บอท auto-r16 เขียน {branch}_r16_104_* ไว้ ตัวอ่านนี้ให้ Desktop โหลดเอง
// สิ่งที่เทสนี้ล็อกไว้:
//   1) apply แล้ว Confirm ปลดล็อก + getSoldQtyBefore "กรองตามเวลาสแกน" จริง (ไม่ใช่ยอดรวม)
//   2) ด่านทุกข้อต้องไม่ผ่านแบบเงียบ — ไม่แตะ state เลย (รอบนับ/R01/เวอร์ชันไม่ตรง · อัปมือที่ใหม่กว่า · PDA · WH · Admin · สวิตช์ปิด · กำลัง Confirm)
//   3) ล้ม/ถูกแซงระหว่างโหลด = คงสถานะเดิมทั้งก้อน ห้าม apply บางส่วน
//   4) เส้นทาง listener ห้าม saveSession (กัน sync loop) · toast สั้น · เส้นทาง login เรียก saveSession
//   5) ของที่บอทผลิตจริง (รัน main() ของบอทกับ Firestore จำลอง) ต้องถูกตัวอ่านนี้อ่านได้และให้ผลตรงกติกา
const { test, expect, bootBare, closeApp } = require('../../lib/hooks');
const H = require('../../lib/r16-bot-harness');

const EPOCH = H.EPOCH;
const R01V = 'R01-V1';
const V1 = '2026-10-13T14:00:00.000Z';
const ROWS = [
  ['S-01', 3, 0, [{ soldQty: 2, tranDate: '13/10/2026 09:00:00' }, { soldQty: 1, tranDate: '13/10/2026 15:00:00' }], []],
  ['S-02', 0, 4, [], [{ qty: 4, tranDate: '13/10/2026 10:00:00' }]],
];

function mkDocs({ branch = 'SRC', version = V1, generation = 'gen1', r01Version = R01V, epoch = EPOCH, meta = {}, rows = ROWS, perChunk = 1 } = {}) {
  const chunks = [];
  for (let i = 0; i < rows.length; i += perChunk) chunks.push(rows.slice(i, i + perChunk));
  const docs = {
    [`${branch}_r16_104_meta`]: {
      ready: true, kind: '104', version, generation, chunkCount: chunks.length, rowCount: rows.length, countResetAt: epoch,
      r01Version, uploadedAtText: '21:00 น. 13/10/2026 · ข้อมูล 13/10 09:00–13/10 20:58', dateMismatch: false, dateMismatchDetail: '', ...meta,
    },
  };
  chunks.forEach((c, i) => { docs[`${branch}_r16_104_${generation}_${String(i).padStart(4, '0')}`] = { data_json: JSON.stringify(c), kind: '104', version, generation, index: i, countResetAt: epoch }; });
  return docs;
}

// สร้าง Desktop เภสัชสาขา branch ที่ login แล้ว + Firestore จำลอง (อ่านอย่างเดียว) ในหน้าเว็บ
async function setup(page, { branch = 'SRC', docs, localVersion = '', switchOn = true } = {}) {
  await page.evaluate(({ branch, docs, EPOCH, R01V, localVersion, switchOn }) => {
    currentBranch = branch; currentRole = 'pharmacist'; currentUser = 'Tester';
    _adminMode = false; _branchConfirming = false; _countResetAt = EPOCH;
    PHARMACY_R16_CLOUD_TIMELINE = switchOn;
    state.r01Version = R01V;
    state.r16Loaded = false; state.r16DateMismatch = false; state.r16DetailVersion = localVersion; state.r16UploadedAt = '';
    state.r16SalesMap.clear(); state.r16InboundMap.clear(); state.r16RawMap.clear(); state.r16InboundRawMap.clear();
    window.__docs = docs; window.__reads = []; window.__beforeGet = null; window.__snapCbs = {};
    _db = { collection: () => ({ doc: (id) => ({
      id,
      get: async () => { __reads.push(id); if (window.__beforeGet) await window.__beforeGet(id); const d = __docs[id]; return { exists: !!d, id, ref: { id }, data: () => d }; },
      onSnapshot: (cb) => { __snapCbs[id] = cb; return () => {}; },
    }) }) };
    window.__saves = 0; window.__reeval = 0; window.__syncMeta = 0;
    // ตัวอ่านห้ามเรียกสองตัวนี้ (กันทุก Desktop พลิกสถานะพร้อมกัน · master ถูกบอทเขียนแล้ว) — นับไว้ให้เทสตรวจ
    reEvaluateAuditItems = async function () { window.__reeval++; };
    syncR16MetaToFirestore = async function () { window.__syncMeta++; };
    const origSave = window.__origSave || saveSession; window.__origSave = origSave;
    saveSession = function () { window.__saves++; return origSave.apply(this, arguments); };
  }, { branch, docs, EPOCH, R01V, localVersion, switchOn });
}

const snapshot = (page) => page.evaluate(() => ({
  loaded: state.r16Loaded, version: state.r16DetailVersion, raw: state.r16RawMap.size, sales: state.r16SalesMap.size,
  inbound: state.r16InboundMap.size, reads: __reads.slice(), saves: __saves, reeval: __reeval, syncMeta: __syncMeta,
  badge: document.getElementById('badgeR16').textContent, ts: document.getElementById('r16Timestamp').textContent,
}));
const load = (page, opts = {}) => page.evaluate((o) => _loadPharmacyR16Timeline(o), opts);
const toasts = (page) => page.evaluate(() => [...document.querySelectorAll('#toastContainer .toast')].map((t) => t.textContent));

test('ค่าเริ่มต้นที่ส่งมอบ — สวิตช์เปิด (อ่านจากหน้าที่เพิ่งบูต ไม่ผ่าน setup)', async ({ browser }) => {
  const app = await bootBare(browser);
  expect(await app.page.evaluate(() => typeof PHARMACY_R16_CLOUD_TIMELINE)).toBe('boolean');
  expect(await app.page.evaluate(() => PHARMACY_R16_CLOUD_TIMELINE)).toBe(true);
  await closeApp(app);
});

test('เส้นทาง login — apply: timeline กรองตามเวลาสแกนจริง · Confirm ปลดล็อก · badge/เวลา · saveSession', async ({ browser }) => {
  const app = await bootBare(browser);
  await setup(app.page, { docs: mkDocs(), localVersion: V1 });   // _applyR16MetaFromDoc ตั้ง state.r16DetailVersion จาก master แล้ว
  expect(await app.page.evaluate(() => document.getElementById('btnConfirm').disabled)).toBe(true);   // ยังไม่โหลด R16 = ปุ่มล็อก
  expect(await load(app.page)).toBe(true);

  const s = await snapshot(app.page);
  expect(s).toMatchObject({ loaded: true, version: V1, raw: 2, sales: 2, inbound: 2, badge: 'Ready', ts: '21:00 น. 13/10/2026 · ข้อมูล 13/10 09:00–13/10 20:58', saves: 1, reeval: 0, syncMeta: 0 });
  expect(await app.page.evaluate(() => document.getElementById('btnConfirm').disabled)).toBe(false);
  expect(await app.page.evaluate(() => state.r16DateMismatch)).toBe(false);
  // ★ หัวใจ: ยอดขาย/รับเข้า "ก่อนเวลาสแกน" ไม่ใช่ยอดรวมทั้งวัน
  const t = await app.page.evaluate(() => ({
    soldNoon: getSoldQtyBefore('S-01', '2026-10-13 12:00:00'), soldEve: getSoldQtyBefore('S-01', '2026-10-13 16:00:00'),
    soldBefore: getSoldQtyBefore('S-01', '2026-10-13 08:00:00'),
    inbEarly: getInboundQtyBefore('S-02', '2026-10-13 09:30:00'), inbLate: getInboundQtyBefore('S-02', '2026-10-13 11:00:00'),
    total: state.r16SalesMap.get('S-01'),
  }));
  expect(t).toEqual({ soldNoon: 2, soldEve: 3, soldBefore: 0, inbEarly: 0, inbLate: 4, total: 3 });
  expect(await toasts(app.page), 'เส้นทาง login ไม่ toast').toEqual([]);
  await closeApp(app);
});

test('เส้นทาง listener — apply ด้วย masterVersion · ห้าม saveSession · toast สั้น', async ({ browser }) => {
  const app = await bootBare(browser);
  await setup(app.page, { docs: mkDocs(), localVersion: '2026-10-13T01:00:00.000Z' });   // เครื่องถือรุ่นเก่า — master เพิ่งประกาศ V1
  expect(await load(app.page, { fromListener: true, masterVersion: V1 })).toBe(true);
  const s = await snapshot(app.page);
  expect(s).toMatchObject({ loaded: true, version: V1, raw: 2, saves: 0, reeval: 0, syncMeta: 0 });
  expect(await toasts(app.page)).toEqual(['R16 อัปเดตจาก Cloud แล้ว']);
  await closeApp(app);
});

test('ซ้ำรุ่นเดิม = ไม่โหลดใหม่ (ไม่อ่าน chunk ซ้ำ) · timeline ว่าง (chunkCount 0) ก็ idempotent', async ({ browser }) => {
  const app = await bootBare(browser);
  await setup(app.page, { docs: mkDocs(), localVersion: V1 });
  expect(await load(app.page)).toBe(true);
  const readsAfterFirst = (await snapshot(app.page)).reads.length;
  expect(await load(app.page)).toBe(false);
  const again = await snapshot(app.page);
  expect(again.reads.length - readsAfterFirst, 'รอบสองอ่านแค่ meta 1 doc').toBe(1);
  expect(again).toMatchObject({ loaded: true, raw: 2 });

  await setup(app.page, { docs: mkDocs({ rows: [] }), localVersion: V1 });
  expect(await load(app.page)).toBe(true);
  expect(await snapshot(app.page)).toMatchObject({ loaded: true, raw: 0, sales: 0 });
  expect(await load(app.page), 'timeline ว่างต้องไม่โหลดซ้ำทุกรอบ').toBe(false);
  await closeApp(app);
});

// ── ด่าน: ไม่ผ่านต้องไม่แตะ state เลย ──────────────────────────────────────────
const GUARDS = [
  ['meta ไม่มี', () => ({ docs: {} })],
  ['meta.ready ไม่ใช่ true', () => ({ docs: mkDocs({ meta: { ready: false } }) })],
  ['meta.kind ไม่ใช่ 104', () => ({ docs: mkDocs({ meta: { kind: '103' } }) })],
  ['meta ไม่มี generation', () => ({ docs: mkDocs({ meta: { generation: '' } }) })],
  ['รอบนับคนละรอบ (เศษรอบเก่า)', () => ({ docs: mkDocs({ epoch: '2026-09-01T00:00:00.000Z' }) })],
  ['R01 คนละรุ่น (ยอดระบบใหม่รวมยอดขายไปแล้ว — บวกซ้ำ = ผิด)', () => ({ docs: mkDocs({ r01Version: 'R01-OTHER' }) })],
  ['เวอร์ชันไม่ตรงที่ master ประกาศ (เครื่องถือ V0)', () => ({ docs: mkDocs(), localVersion: '2026-10-13T01:00:00.000Z' })],
  ['ยังไม่รู้เวอร์ชันของ master (ว่าง)', () => ({ docs: mkDocs(), localVersion: '' })],
  ['สวิตช์ปิด', () => ({ docs: mkDocs(), localVersion: V1, switchOn: false })],
];
for (const [name, mk] of GUARDS) {
  test(`ด่าน: ${name} → ไม่ apply · state ไม่ขยับ`, async ({ browser }) => {
    const app = await bootBare(browser);
    const o = mk();
    await setup(app.page, { localVersion: V1, ...o });
    const before = await snapshot(app.page);
    expect(await load(app.page)).toBe(false);
    const after = await snapshot(app.page);
    expect({ ...after, reads: 0 }).toEqual({ ...before, reads: 0 });
    expect(after.loaded).toBe(false);
    expect(after.raw).toBe(0);
    expect(after.saves).toBe(0);
    // ด่านระดับ meta ต้องล้มก่อนโหลดข้อมูล — ไม่งั้นทุก Desktop เสียการอ่าน chunk เปล่าทุกครั้งที่ master ขยับ (ด่านหลังโหลดเป็นแค่ตาข่ายชั้นสอง)
    expect(after.reads.filter((id) => /_gen1_\d{4}$/.test(id)), 'ต้องไม่อ่าน chunk').toEqual([]);
    await closeApp(app);
  });
}

test('ด่าน: อัปมือที่ใหม่กว่า (มี raw timeline ของเครื่องเอง) → ไม่ทับ', async ({ browser }) => {
  const app = await bootBare(browser);
  const newer = '2026-10-13T15:30:00.000Z';
  await setup(app.page, { docs: mkDocs(), localVersion: newer });
  await app.page.evaluate((v) => {
    state.r16Loaded = true;
    state.r16RawMap.set('S-77', [{ soldQty: 9, tranDate: '13/10/2026 11:00:00' }]); state.r16SalesMap.set('S-77', 9);
  }, newer);
  expect(await load(app.page, { fromListener: true, masterVersion: V1 })).toBe(false);
  expect(await app.page.evaluate(() => [...state.r16RawMap.keys()])).toEqual(['S-77']);
  expect((await snapshot(app.page)).version).toBe(newer);
  // แต่ถ้าอัปมือเก่ากว่า (บอทใหม่กว่า) → timeline ของบอทแทนที่ (ครอบคลุมกว่า)
  await setup(app.page, { docs: mkDocs(), localVersion: '2026-10-13T10:00:00.000Z' });
  await app.page.evaluate(() => { state.r16Loaded = true; state.r16RawMap.set('S-77', [{ soldQty: 9, tranDate: '13/10/2026 11:00:00' }]); });
  expect(await load(app.page, { fromListener: true, masterVersion: V1 })).toBe(true);
  expect(await app.page.evaluate(() => [...state.r16RawMap.keys()].sort())).toEqual(['S-01', 'S-02']);   // ของบอททั้งชุด · S-77 ของอัปมือเก่าถูกแทนที่
  await closeApp(app);
});

test('ด่านสภาพแวดล้อม: PDA · WH · Admin Mode · ไม่มี _db → ไม่อ่าน Cloud เลย', async ({ browser }) => {
  const app = await bootBare(browser);
  const cases = [
    ['PDA', () => { _isPdaApp = () => true; }],
    ['WH', () => { currentBranch = 'WH'; }],
    ['Admin Mode', () => { _adminMode = true; }],
    ['ไม่มี _db', () => { _db = null; }],
  ];
  for (const [label, mutate] of cases) {
    await setup(app.page, { docs: mkDocs(), localVersion: V1 });
    await app.page.evaluate((fn) => { window.__origPda = window.__origPda || _isPdaApp; eval('(' + fn + ')()'); }, mutate.toString());
    const reads = await app.page.evaluate(async () => { const r = await _loadPharmacyR16Timeline().catch((e) => 'ERR ' + e.message); return { r, reads: window.__docs && typeof __reads !== 'undefined' ? __reads.length : 0 }; });
    expect(reads, label).toEqual({ r: false, reads: 0 });
    expect((await app.page.evaluate(() => ({ l: state.r16Loaded, raw: state.r16RawMap.size }))), label).toEqual({ l: false, raw: 0 });
    await app.page.evaluate(() => { _isPdaApp = window.__origPda; });
  }
  await closeApp(app);
});

test('กำลัง Confirm → ไม่สลับ timeline กลางงาน · เส้นทาง listener นัดลองใหม่ (Confirm เสร็จแล้วโหลดได้)', async ({ browser }) => {
  const app = await bootBare(browser);
  await setup(app.page, { docs: mkDocs(), localVersion: V1 });
  await app.page.evaluate(() => { _branchConfirming = true; });
  expect(await load(app.page)).toBe(false);                                           // เส้นทาง login: ไม่นัดลองใหม่
  expect(await app.page.evaluate(() => _pharmR16ReloadTimer)).toBe(null);
  expect((await snapshot(app.page)).reads).toEqual([]);
  expect(await load(app.page, { fromListener: true, masterVersion: V1 })).toBe(false);  // เส้นทาง listener: นัดลองใหม่ 5 วิ
  expect(await app.page.evaluate(() => _pharmR16ReloadTimer !== null)).toBe(true);
  expect((await snapshot(app.page)).loaded).toBe(false);
  // Confirm จบแล้ว → ลองใหม่สำเร็จ
  await app.page.evaluate(() => { _branchConfirming = false; clearTimeout(_pharmR16ReloadTimer); });
  expect(await load(app.page, { fromListener: true, masterVersion: V1 })).toBe(true);
  await closeApp(app);
});

// ── ล้ม/ถูกแซงระหว่างโหลด ───────────────────────────────────────────────────
test('chunk หาย / version ไม่ตรง → โยน error และ state ไม่ขยับ (ห้าม apply บางส่วน)', async ({ browser }) => {
  const app = await bootBare(browser);
  const docs = mkDocs();
  delete docs.SRC_r16_104_gen1_0001;
  await setup(app.page, { docs, localVersion: V1 });
  const before = await snapshot(app.page);
  const err = await app.page.evaluate(() => _loadPharmacyR16Timeline().then(() => 'no error', (e) => e.message));
  expect(err).toContain('R16 chunk หาย');
  expect({ ...(await snapshot(app.page)), reads: 0 }).toEqual({ ...before, reads: 0 });

  const bad = mkDocs();
  bad.SRC_r16_104_gen1_0001.version = 'OTHER';
  await setup(app.page, { docs: bad, localVersion: V1 });
  expect(await app.page.evaluate(() => _loadPharmacyR16Timeline().then(() => 'no error', (e) => e.message))).toContain('chunk version ไม่ตรง');
  expect((await snapshot(app.page)).loaded).toBe(false);
  expect((await snapshot(app.page)).raw).toBe(0);
  await closeApp(app);
});

test('ระหว่างโหลด R01 เปลี่ยน / สลับสาขา / เริ่ม Confirm / รอบนับเปลี่ยน → ทิ้งผล ไม่ apply', async ({ browser }) => {
  const app = await bootBare(browser);
  const mutations = {
    'R01 ใหม่': () => { state.r01Version = 'R01-NEW'; },
    'สลับสาขา': () => { currentBranch = 'KKL'; },
    'เริ่ม Confirm': () => { _branchConfirming = true; },
    'รอบนับใหม่': () => { _countResetAt = '2026-10-14T00:00:00.000Z'; },
  };
  for (const [label, fn] of Object.entries(mutations)) {
    await setup(app.page, { docs: mkDocs(), localVersion: V1 });
    await app.page.evaluate((src) => { window.__beforeGet = async (id) => { if (/_gen1_0001$/.test(id)) eval('(' + src + ')()'); }; }, fn.toString());
    expect(await load(app.page), label).toBe(false);
    const s = await snapshot(app.page);
    expect({ loaded: s.loaded, raw: s.raw, saves: s.saves }, label).toEqual({ loaded: false, raw: 0, saves: 0 });
  }
  await closeApp(app);
});

test('เรียกซ้อน 2 รอบ — รอบเก่าที่ถูกแซงต้องทิ้งผล ไม่ทับรอบใหม่', async ({ browser }) => {
  const app = await bootBare(browser);
  await setup(app.page, { docs: mkDocs(), localVersion: V1 });
  const out = await app.page.evaluate(async () => {
    let release; const gate = new Promise((r) => { release = r; });
    let first = true;
    window.__beforeGet = async (id) => { if (/_gen1_0000$/.test(id) && first) { first = false; await gate; } };
    const a = _loadPharmacyR16Timeline();            // ค้างที่ chunk แรก
    await new Promise((r) => setTimeout(r, 50));
    const b = await _loadPharmacyR16Timeline();       // รอบใหม่แซง — apply
    release();
    const aRes = await a;
    return { a: aRes, b, loaded: state.r16Loaded, raw: state.r16RawMap.size };
  });
  expect(out).toEqual({ a: false, b: true, loaded: true, raw: 2 });

  // ค้างที่การอ่าน meta (ก่อนเริ่มโหลดข้อมูล) — รอบเก่าที่ถูกแซงต้องเลิกเลย ไม่ไปอ่าน chunk ซ้ำ
  await setup(app.page, { docs: mkDocs(), localVersion: V1 });
  const out2 = await app.page.evaluate(async () => {
    let release; const gate = new Promise((r) => { release = r; });
    let first = true;
    window.__beforeGet = async (id) => { if (/_meta$/.test(id) && first) { first = false; await gate; } };
    const a = _loadPharmacyR16Timeline();            // ค้างที่ meta
    await new Promise((r) => setTimeout(r, 50));
    const b = await _loadPharmacyR16Timeline();       // รอบใหม่แซง — apply
    release();
    const aRes = await a;
    return { a: aRes, b, chunkReads: __reads.filter((id) => /_gen1_\d{4}$/.test(id)).length, raw: state.r16RawMap.size };
  });
  expect(out2).toEqual({ a: false, b: true, chunkReads: 2, raw: 2 });   // chunk 2 อันอ่านครั้งเดียว (ของรอบที่แซง)
  await closeApp(app);
});

test('สลับสาขาระหว่างอ่าน meta → เลิกทันที ไม่ไปอ่าน chunk ของสาขาเดิม (ไม่เสียการอ่านเปล่า)', async ({ browser }) => {
  const app = await bootBare(browser);
  await setup(app.page, { docs: mkDocs(), localVersion: V1 });
  const out = await app.page.evaluate(async () => {
    let release; const gate = new Promise((r) => { release = r; });
    window.__beforeGet = async (id) => { if (/_meta$/.test(id)) await gate; };
    const a = _loadPharmacyR16Timeline();
    await new Promise((r) => setTimeout(r, 50));
    currentBranch = 'KKL';
    release();
    return { a: await a, chunkReads: __reads.filter((id) => /_gen1_\d{4}$/.test(id)).length, loaded: state.r16Loaded };
  });
  expect(out).toEqual({ a: false, chunkReads: 0, loaded: false });
  await closeApp(app);
});

// ── hook ของ master listener (startWhMasterListeners · สาขายา) ────────────────
async function fireMaster(page, data, { pda = false } = {}) {
  return page.evaluate(({ data, pda }) => {
    const origPda = _isPdaApp;
    if (pda) _isPdaApp = () => true;
    try {
      startWhMasterListeners();
      __snapCbs['SRC_r01']({ exists: true, data: () => data });
      return _pharmR16ReloadTimer !== null;
    } finally { _isPdaApp = origPda; }
  }, { data, pda });
}

test('master listener: ประกาศเวอร์ชันใหม่ → โหลด timeline เอง (Desktop ที่เปิดค้างตอน 21:00)', async ({ browser }) => {
  const app = await bootBare(browser);
  await setup(app.page, { docs: mkDocs(), localVersion: '2026-10-13T01:00:00.000Z' });
  const scheduled = await fireMaster(app.page, { data_json: '[]', r01Version: R01V, r01UploadedAt: '08:10 น. 13/10/2026', r16Loaded: true, r16DetailVersion: V1 });
  expect(scheduled).toBe(true);
  await app.page.waitForFunction(() => state.r16Loaded === true, null, { polling: 50, timeout: 5000 });
  expect(await snapshot(app.page)).toMatchObject({ loaded: true, version: V1, raw: 2, saves: 0 });
  expect(await toasts(app.page)).toContain('R16 อัปเดตจาก Cloud แล้ว');
  await closeApp(app);
});

test('master listener: ไม่นัดโหลดเมื่อ — เวอร์ชันเท่าที่ถือ · master ไม่ได้ประกาศ R16 · เวอร์ชันว่าง · PDA · สวิตช์ปิด', async ({ browser }) => {
  const app = await bootBare(browser);
  const base = { data_json: '[]', r01Version: R01V, r01UploadedAt: '08:10 น. 13/10/2026' };
  const cases = [
    ['เวอร์ชันเท่าที่ถือ', { ...base, r16Loaded: true, r16DetailVersion: V1 }, { localVersion: V1 }],
    ['master ไม่ได้ประกาศ R16 (r16Loaded:false)', { ...base, r16Loaded: false, r16DetailVersion: V1 }, {}],
    ['เวอร์ชันว่าง', { ...base, r16Loaded: true, r16DetailVersion: '' }, {}],
    ['PDA', { ...base, r16Loaded: true, r16DetailVersion: V1 }, { pda: true }],
    ['สวิตช์ปิด', { ...base, r16Loaded: true, r16DetailVersion: V1 }, { switchOn: false }],
  ];
  for (const [label, data, o] of cases) {
    await setup(app.page, { docs: mkDocs(), localVersion: o.localVersion ?? '2026-10-13T01:00:00.000Z', switchOn: o.switchOn ?? true });
    expect(await fireMaster(app.page, data, { pda: !!o.pda }), label).toBe(false);
  }
  await closeApp(app);
});

// ── ของที่บอทผลิตจริง ──────────────────────────────────────────────────────────
test('ของที่บอท (main() จริง) เขียน → ตัวอ่านอ่านได้และให้ผลตรงกติกา · ทั้ง 3 สาขา', async ({ browser }) => {
  const app = await bootBare(browser);
  const { runs: [r], store } = H.run();
  expect(r.code, r.log).toBe(0);
  const day = H.todayBkk().split('/');                                  // d/m/yyyy
  const iso = (hhmmss) => `${day[2]}-${String(day[1]).padStart(2, '0')}-${String(day[0]).padStart(2, '0')} ${hhmmss}`;
  for (const b of H.BRANCHES) {
    const master = store[`${b}_r01`];
    await setup(app.page, { branch: b, docs: store, localVersion: master.r16DetailVersion });
    await app.page.evaluate(({ R01V }) => { state.r01Version = R01V; }, { R01V: H.R01_VERSION(b) });
    expect(await load(app.page), `${b}: ตัวอ่านต้อง apply ของบอท`).toBe(true);
    const t = await app.page.evaluate(({ iso9, iso15 }) => ({
      s02at9: getSoldQtyBefore('S-02', iso9), s02at15: getSoldQtyBefore('S-02', iso15),
      s01at9: getSoldQtyBefore('S-01', iso9), loaded: state.r16Loaded, version: state.r16DetailVersion,
      badge: document.getElementById('badgeR16').textContent, ts: document.getElementById('r16Timestamp').textContent,
    }), { iso9: iso('10:00:00'), iso15: iso('15:00:00') });
    // S-02 ขาย 3 ชิ้นตอน 14:20:05 → ก่อน 10:00 ต้องไม่เห็น · หลัง 15:00 ต้องเห็น (ยอดรวมทั้งวันจะเห็นเสมอ = ผิด)
    expect(t, b).toMatchObject({ s02at9: 0, s02at15: 3, s01at9: 2, loaded: true, version: master.r16DetailVersion, badge: 'Ready', ts: master.r16UploadedAt });
  }
  await closeApp(app);
});
