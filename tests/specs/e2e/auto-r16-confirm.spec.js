// e2e: Confirm โดยบอท auto-r16 กับ Firestore emulator + หน้าเว็บจริง (ต.ค. 2026)
//
// ทำไมต้องมี (นอกเหนือจาก logic/auto-r16-confirm-*.spec.js ที่ใช้ Firestore จำลอง):
//   · REST ที่บอทสร้าง (documents:commit + precondition + REQUEST_TIME · runQuery · lock) เซิร์ฟเวอร์ Firestore ต้องยอมรับจริง และอยู่ภายใต้ firestore.rules จริง
//   · lock ที่บอทเขียน ต้องทำให้ PDA/Desktop ตัวจริง "พักการสแกน" แล้วกลับมาสแกนต่อได้เมื่อบอทปล่อย
//   · ผลที่บอทเขียน ต้องเท่ากับที่ปุ่ม Confirm ของ Desktop จริง (validateAndProcess) เขียนบนข้อมูลชุดเดียวกัน — ทุกฟิลด์
//   · ย้อนผลด้วย --confirm-undo แล้ว Desktop กด Confirm เองต่อได้ตามปกติ
// ฝั่งบอทเป็น Python จริง (main()) · ที่แทนมีแค่นาฬิกาของบอท (เทสรันกี่โมงก็ได้) — ดู tests/lib/r16-bot-emulator.js
const fs = require('fs');
const { test, expect, closeApp, requireEmulator } = require('../../lib/hooks');
const { bootFreshCount, bootJoinCount, PROJECT_ID } = require('../../lib/scenario');
const { adminDb, getDoc, setDoc, waitForDoc } = require('../../lib/emulator');
const B = require('../../lib/r16-bot-emulator');
const F = require('../../lib/fixtures');
const R = require('../../lib/r16-104-fixture');

const DAY = B.bkkDay();                                   // วันนี้ตามเวลาไทย (ที่บอทใช้เป็น "วันนี้")
const SKU_BARCODE = Object.fromEntries(F.r05Rows.filter((r) => r.barcode).reverse().map((r) => [r.colE, r.barcode]));   // บาร์โค้ดแรกของแต่ละ SKU (ตัวท้ายชนะ → reverse)
const SKU_OF = Object.fromEntries(F.r05Rows.map((r) => [r.barcode, r.colE]));
const itemPath = (b, sku) => `stock_sessions/${b}/items/${sku}`;

// item หนึ่งรายการตามรูปที่ PDA เขียนจริง (_scanItemPayload): ไม่มี retries/scans/manualEditAt (field local)
function seedItem(epoch, sku, count, time, extra = {}) {
  const at = `${DAY.iso} ${time}`;
  return {
    sku, countResetAt: epoch, status: 'scanning', countedQty: count, timestamp: at, firstScanAt: at, scannedBy: 'พนักงานทดสอบ',
    auditor: '', auditStatus: 'pending', barcode: SKU_BARCODE[sku], location: '', rev: 1, updatedBy: 'พนักงานทดสอบ',
    updatedAt: new Date(Date.now() - 3600_000), ...extra,
  };
}

// แถว R16.104 ของสาขา b (ORCM Col A=1 ขายหน้าร้าน · OTFB Col A=0 รับเข้า — KKL/SSS: OTFB ทุกแถว = รับเข้า)
let tranSeq = 1;
const sale = (b, barcode, qty, time, extra = {}) => R.branchRow(b, { tranNo: 'ORCMBY0012610' + String(tranSeq++).padStart(5, '0'), colA: '1', qty: `${qty}.0000`, barcode, sku: SKU_OF[barcode], at: `${DAY.dmy} ${time}`, ...extra });
const inbound = (b, barcode, qty, time) => R.branchRow(b, { tranNo: 'OTFBBY0012610' + String(tranSeq++).padStart(5, '0'), colA: '0', qty: `${qty}.0000`, barcode, sku: SKU_OF[barcode], at: `${DAY.dmy} ${time}` });

// ชุดข้อมูลมาตรฐาน: ผลที่คาดตามสูตร (ไม่ใช่แค่ "บอทเท่า Desktop")
const ITEMS = [
  // [sku, นับ, เวลาสแกน, extra]
  ['S-NORM', 7, '11:00:00'],                         // ระบบ 10 · ขายก่อนสแกน 3 (+ขายหลังสแกน 4 ไม่นับ) → 7+3 = 10 → pass
  ['S-PRICEY', 3, '11:05:00'],                       // ระบบ 5 · 3 ≠ 5 → Stock Adj ตรง
  ['S-NOPRICE', 8, '11:10:00'],                      // ระบบ 8 → pass
  ['S-ZERO', 2, '11:15:00'],                         // ระบบ 0 · เจอของ 2 → Stock Adj ตรง
  ['S-NEG', 2, '11:20:00'],                          // ระบบ −3 · รับเข้าก่อนสแกน 5 → 2−5 = −3 → pass
  ['S-MULTI', 58, '11:25:00'],                       // ระบบ 60 · ขายก่อนสแกน 2 → pass
  ['S-CATA', 0, '11:30:00', { noStock: true }],      // ระบบ 4 · ผู้ช่วยยืนยันชั้นว่าง → Stock Adj (ไม่ใช่ directAdj)
  ['S-ONLYR01', 5, '11:35:00'],                      // DEL (อยู่ R01 ไม่อยู่ PBM) · ระบบ 6 · ขายก่อนสแกน 1 → pass
  ['S-F01', 1, '11:40:00'],                          // ระบบ 1 → pass
  ['S-F02', 5, '12:00:00'],                          // ระบบ 2 · ขาย 12:30 หลังสแกน ไม่นับ → 5 ≠ 2 → Stock Adj ตรง
  ['S-F03', 3, '12:10:00'],                          // ระบบ 3 · บิลขายที่ยกเลิกไม่นับ → pass
  ['S-F04', 4, '09:00:00', { status: 'pass', auditStatus: 'approved', initialStatus: 'pass' }],   // Confirm ไปแล้ว — ต้องไม่ถูกแตะ
];
const CONFIRMABLE = ITEMS.filter((i) => !i[3] || !i[3].status).map((i) => i[0]);
const EXPECT = {
  'S-NORM': { status: 'pass', soldQty: 3, rawCountedQty: 7 },
  'S-PRICEY': { status: 'stock_adjustment', directAdj: true, effectiveQty: 3, systemQty: 5 },
  'S-NOPRICE': { status: 'pass' },
  'S-ZERO': { status: 'stock_adjustment', directAdj: true, effectiveQty: 2, systemQty: 0 },
  'S-NEG': { status: 'pass', inboundQty: 5 },
  'S-MULTI': { status: 'pass', soldQty: 2, rawCountedQty: 58 },
  'S-CATA': { status: 'stock_adjustment' },
  'S-ONLYR01': { status: 'pass', soldQty: 1, rawCountedQty: 5 },
  'S-F01': { status: 'pass' },
  'S-F02': { status: 'stock_adjustment', directAdj: true, effectiveQty: 5, systemQty: 2 },
  'S-F03': { status: 'pass' },
};
const csvFor = (branches) => R.csvText(branches.flatMap((b) => [
  sale(b, 'B-NORM', 3, '10:00:00'), sale(b, 'B-NORM', 4, '15:00:00'),
  inbound(b, 'B-NEG', 5, '09:00:00'),
  sale(b, 'B-M1', 2, '09:30:00'),
  sale(b, 'B-ONLYR01', 1, '08:00:00'),
  sale(b, 'B-F02', 1, '12:30:00'),
  sale(b, 'B-F03', 9, '09:00:00', { cancel: '1' }),
  sale(b, 'B-F07', 1, '13:00:00'),                   // SKU ที่ไม่มีใครนับ
]));

// เตรียมสาขาหนึ่ง: R01 เป็นของวันนี้ (ด่านของบอท) + items ที่ seed
async function prepareBranch(app, branch, items = ITEMS) {
  await setDoc(PROJECT_ID, `stock_sessions/${branch}_r01`, { r01UploadedAt: DAY.thai });
  const db = adminDb(PROJECT_ID);
  const batch = db.batch();
  for (const [sku, count, time, extra] of items) batch.set(db.doc(itemPath(branch, sku)), seedItem(app.epoch, sku, count, time, extra || {}));
  await batch.commit();
}

// เอกสาร item แบบ plain (ตัด Timestamp ออก) ไว้เทียบ
async function readItems(branch, skus) {
  const out = {};
  for (const sku of skus) out[sku] = await getDoc(PROJECT_ID, itemPath(branch, sku));
  return out;
}
const strip = (d, extra = []) => { const { rev: _r, updatedBy: _u, updatedAt: _a, countResetAt: _c, ...rest } = d; for (const k of extra) delete rest[k]; return rest; };

async function auditLogItems(prefix) {
  const snap = await adminDb(PROJECT_ID).collection('stock_audit_log').get();
  const doc = snap.docs.find((d) => d.id.startsWith(prefix + '_'));
  return doc ? { id: doc.id, ...doc.data() } : null;
}

test.describe('Confirm โดยบอท auto-r16 (emulator)', () => {
  test.beforeEach(() => requireEmulator());
  test.setTimeout(240_000);

  test('★ dual-run: ผลที่บอทเขียน (KKL) = ผลที่ปุ่ม Confirm จริงของ Desktop เขียน (SSS) บนข้อมูลชุดเดียวกัน — ทุกฟิลด์ · โหมดเงา/compare/audit log ตรงด้วย', async ({ browser }) => {
    const kkl = await bootFreshCount(browser, { branch: 'KKL', role: 'pharmacist', user: 'Pharm-KKL', mode: 'desktop' });
    const sss = await bootFreshCount(browser, { branch: 'SSS', role: 'pharmacist', user: 'Pharm-SSS', mode: 'desktop', clear: false });
    await prepareBranch(kkl, 'KKL');
    await prepareBranch(sss, 'SSS');
    const sssBefore = {};
    for (const [sku] of ITEMS) sssBefore[sku] = (await adminDb(PROJECT_ID).doc(itemPath('SSS', sku)).get()).updateTime;
    const stateDir = B.newStateDir();

    // 1) บอท: เผยแพร่ timeline ทั้งสองสาขา · KKL Confirm จริง · SSS โหมดเงา
    const r1 = B.runBotSync({ stateDir, csv: csvFor(['KKL', 'SSS']), args: ['--branch', 'KKL,SSS', '--confirm', '--confirm-branch', 'KKL', '--confirm-shadow'] });
    expect(r1.code, r1.log).toBe(0);
    expect(r1.log).toContain('Confirm KKL confirmed(11)');
    expect(r1.log).toContain('Confirm SSS shadow(11)');

    // โหมดเงาไม่เขียนอะไรของ SSS เลย (updateTime เท่าเดิมเป๊ะ) · ไม่มี lock/audit log ของ SSS
    for (const [sku] of ITEMS) {
      const now = (await adminDb(PROJECT_ID).doc(itemPath('SSS', sku)).get()).updateTime;
      expect(now.isEqual(sssBefore[sku]), `SSS ${sku}: โหมดเงาต้องไม่เขียน`).toBe(true);
    }
    expect(await getDoc(PROJECT_ID, 'stock_sessions/SSS_confirm_lock')).toBeNull();
    expect(await getDoc(PROJECT_ID, 'stock_sessions/KKL_confirm_lock'), 'lock ของ KKL ถูกปล่อย').toBeNull();

    // 2) ผลของบอทตรงสูตร
    const bot = await readItems('KKL', ITEMS.map((i) => i[0]));
    for (const sku of CONFIRMABLE) {
      expect(bot[sku], `KKL ${sku}`).toMatchObject(EXPECT[sku]);
      expect(bot[sku].rev, `KKL ${sku}: rev 1→2`).toBe(2);
      expect(bot[sku].updatedBy).toBe('auto-r16');
      expect(bot[sku].initialStatus, `KKL ${sku}: initialStatus = ผลแรก`).toBe(EXPECT[sku].status);
      expect(bot[sku].scannedBy, 'ฟิลด์ของผู้สแกนไม่ถูกแตะ').toBe('พนักงานทดสอบ');
    }
    expect(bot['S-CATA'].directAdj, 'noStock ไม่ตั้ง directAdj').toBeUndefined();
    expect(strip(bot['S-F04']), 'ตัวที่ Confirm ไปแล้วไม่ถูกแตะ').toEqual(strip(seedItem(kkl.epoch, 'S-F04', 4, '09:00:00', ITEMS.find((i) => i[0] === 'S-F04')[3]), ['updatedAt']));
    expect(bot['S-F04'].rev).toBe(1);

    // 3) Desktop SSS: รับ timeline จาก Cloud เอง แล้วกด Confirm จริง
    await sss.page.waitForFunction(() => state.r16Loaded === true && state.r16RawMap.size > 0, null, { timeout: 30_000, polling: 100 });
    await sss.page.evaluate(() => validateAndProcess());
    await waitForDoc(PROJECT_ID, itemPath('SSS', 'S-F03'), (d) => d && d.status !== 'scanning', { timeout: 40_000 });
    for (const sku of CONFIRMABLE) await waitForDoc(PROJECT_ID, itemPath('SSS', sku), (d) => d && d.status !== 'scanning', { timeout: 40_000 });
    const desk = await readItems('SSS', ITEMS.map((i) => i[0]));

    // 4) ★ เท่ากันทุกฟิลด์ (ยกเว้น rev/updatedBy/updatedAt และ countResetAt ที่ต่างตามสาขา)
    for (const [sku] of ITEMS) {
      expect(strip(bot[sku], []), `${sku}: บอท (KKL) ต้องเท่า Desktop (SSS) ทุกฟิลด์`).toEqual(strip(desk[sku], []));
    }
    for (const sku of CONFIRMABLE) {
      expect(desk[sku], `SSS ${sku} (Desktop)`).toMatchObject(EXPECT[sku]);
      expect(desk[sku].updatedBy, 'Desktop เขียนในนามผู้ใช้').toBe('Pharm-SSS');
    }

    // 5) audit log: รูปแบบเดียวกัน · เนื้อหา items เท่ากัน (ลำดับต่างได้ — บอทเรียงตาม SKU)
    const logBot = await waitForDoc(PROJECT_ID, `stock_audit_log/KKL_${DAY.iso}`, (d) => d && Array.isArray(d.items), { timeout: 20_000 });
    let logDesk = null;
    for (let i = 0; i < 100 && !logDesk; i++) { logDesk = await auditLogItems('SSS'); if (!logDesk) await new Promise((r) => setTimeout(r, 200)); }
    expect(logDesk, 'Desktop เขียน audit log').toBeTruthy();
    const bySku = (x) => [...x.items].sort((a, b) => (a.sku < b.sku ? -1 : 1));
    expect(bySku(logBot).map((x) => x.sku)).toEqual(['S-F02', 'S-PRICEY', 'S-ZERO']);
    expect(bySku(logBot), 'audit log: items เท่ากับของ Desktop ทุกฟิลด์').toEqual(bySku(logDesk));
    expect(Object.keys(logBot).sort(), 'audit log: ชุดฟิลด์ระดับเอกสารเท่ากัน').toEqual(Object.keys(logDesk).filter((k) => k !== 'id').sort());
    expect(typeof logBot.updatedAt).toBe('string');

    // 6) compare: ผลที่โหมดเงาทำนายไว้ให้ SSS = ผลจริงที่ Desktop เขียน (ต่างกัน 0)
    const cmp = B.runBotSync({ stateDir, csv: csvFor(['KKL', 'SSS']), args: ['--confirm-compare', '--branch', 'SSS'] });
    expect(cmp.code, cmp.log).toBe(0);
    expect(cmp.log).toContain('ตรงกัน 11 · ต่างกัน 0');
    expect(cmp.log).toContain('ทำนาย 11 รายการ → Pass 7 · Stock Adj 4');

    // 7) journal ของ KKL: committed · ครบ 11 รายการ
    const journals = B.journalFiles(stateDir);
    expect(journals).toHaveLength(1);
    const j = B.readJournal(journals[0]);
    expect(j).toMatchObject({ version: 1, branch: 'KKL', state: 'committed', owner: 'auto-r16' });
    expect(j.items.map((x) => x.sku).sort()).toEqual([...CONFIRMABLE].sort());
    expect(j.items.every((x) => typeof x.update_time_after === 'string' && x.rev_after === 2)).toBe(true);

    await closeApp(sss);
    await closeApp(kkl);
  });

  test('★ lock ของบอท: PDA/Desktop ตัวจริงพักการสแกนขณะบอท Confirm แล้วกลับมาสแกนต่อได้เมื่อบอทปล่อย · แถบแจ้ง "โดย auto-r16"', async ({ browser }) => {
    const desk = await bootFreshCount(browser, { branch: 'SRC', role: 'pharmacist', user: 'Pharm', mode: 'desktop' });
    const pda = await bootJoinCount(browser, { branch: 'SRC', role: 'assistant', user: 'PDA-A', mode: 'pda', expectEpoch: desk.epoch });
    await prepareBranch(desk, 'SRC', ITEMS.filter((i) => ['S-NORM', 'S-NOPRICE', 'S-F01'].includes(i[0])));
    const stateDir = B.newStateDir();

    const run = B.runBotAsync({ stateDir, csv: csvFor(['SRC']), args: ['--branch', 'SRC', '--confirm', '--confirm-branch', 'SRC'] });
    await pda.page.waitForFunction(() => _branchScanPaused === true && _branchConfirmLockData && _branchConfirmLockData.owner === 'auto-r16', null, { timeout: 30_000, polling: 25 });
    const during = await pda.page.evaluate(() => {
      const before = state.scanData.get('S-F05')?.countedQty || 0;
      scanQueue.push(parseScanLine('B-F05')); drainQueue();
      const lk = _branchConfirmLockData;
      return { paused: _branchScanPaused, active: _isBranchConfirmLockActive(), owner: lk.owner, role: lk.role,
        // ชนิดข้อมูลที่ client ได้รับจริง: Desktop เขียน expiresAt/startedAt เป็น Firestore Timestamp — เว็บอ่านสตริง ISO ได้ด้วย (Date.parse) จึงต้องเช็คชนิดตรงๆ ไม่งั้นบอทเขียนเป็นสตริงแล้วทุกอย่างยังดูปกติ
        expiresIsTimestamp: typeof lk.expiresAt?.toMillis === 'function', startedIsTimestamp: typeof lk.startedAt?.toMillis === 'function',
        banner: document.getElementById('branchConfirmLockBanner').textContent, disabled: document.getElementById('scanInput').disabled,
        before, after: state.scanData.get('S-F05')?.countedQty || 0 };
    });
    expect(during).toMatchObject({ paused: true, active: true, owner: 'auto-r16', role: 'bot', disabled: true, before: 0, after: 0, expiresIsTimestamp: true, startedIsTimestamp: true });
    // (ค่า TTL 5 นาที เทียบนาฬิกาไม่ได้ที่นี่: e2e ให้บอทใช้นาฬิกาสมมติ 21:10 — ตรึงใน logic flow ข้อ "lock — เนื้อหาที่บอทเขียนตรงกับที่ PDA/Desktop อ่าน")
    expect(during.banner).toContain('auto-r16');
    expect(during.banner).toContain('พักการสแกนชั่วคราว');
    const deskDuring = await desk.page.evaluate(() => ({ paused: _branchScanPaused, banner: document.getElementById('branchConfirmLockBanner').textContent }));
    expect(deskDuring.paused, 'Desktop อีกเครื่องก็พักด้วย').toBe(true);

    const res = await run.promise;
    expect(res.code, res.log).toBe(0);
    expect(res.log).toContain('Confirm SRC confirmed(3)');
    await pda.page.waitForFunction(() => _branchScanPaused === false && !document.getElementById('scanInput').disabled, null, { timeout: 15_000, polling: 50 });
    expect(await getDoc(PROJECT_ID, 'stock_sessions/SRC_confirm_lock'), 'lock ถูกปล่อย').toBeNull();

    // ผลมาถึงหน้าจอของทั้งสองเครื่องผ่าน listener เอง
    for (const app of [pda, desk]) {
      await app.page.waitForFunction(() => state.scanData.get('S-NORM')?.status === 'pass' && state.scanData.get('S-F01')?.status === 'pass', null, { timeout: 20_000, polling: 100 });
      expect(await app.page.evaluate(() => state.scanData.get('S-NORM').soldQty), 'ชดเชยยอดขาย 3 ก่อนเวลาสแกน').toBe(3);
    }
    await closeApp(pda);
    await closeApp(desk);
  });

  test('★ PDA สแกนจริง → บอท Confirm → เครื่องทุกเครื่องเห็นผล · Desktop กดซ้ำไม่เปลี่ยนอะไร · ย้อนผลแล้ว Desktop กด Confirm เองได้ผลเดิม', async ({ browser }) => {
    const desk = await bootFreshCount(browser, { branch: 'SRC', role: 'pharmacist', user: 'Pharm', mode: 'desktop' });
    const pda = await bootJoinCount(browser, { branch: 'SRC', role: 'assistant', user: 'PDA-A', mode: 'pda', expectEpoch: desk.epoch });

    // สแกนจริงผ่านคิวสแกนของ PDA: S-NORM ×7 และ S-F03 ×3 (ระบบ 10 และ 3)
    await pda.page.evaluate(() => { for (let i = 0; i < 7; i++) scanQueue.push(parseScanLine('B-NORM')); for (let i = 0; i < 3; i++) scanQueue.push(parseScanLine('B-F03')); drainQueue(); });
    await pda.page.waitForFunction(() => state.scanData.get('S-NORM')?.countedQty === 7 && state.scanData.get('S-F03')?.countedQty === 3, null, { timeout: 20_000, polling: 100 });
    await pda.page.evaluate(() => _flushDirtySkus());
    await waitForDoc(PROJECT_ID, itemPath('SRC', 'S-NORM'), (d) => d && d.countedQty === 7);
    await waitForDoc(PROJECT_ID, itemPath('SRC', 'S-F03'), (d) => d && d.countedQty === 3);
    const real = await readItems('SRC', ['S-NORM', 'S-F03']);
    expect(real['S-NORM']).toMatchObject({ status: 'scanning', countedQty: 7, scannedBy: 'PDA-A', countResetAt: desk.epoch });
    expect(typeof real['S-NORM'].timestamp, 'timestamp รูป YYYY-MM-DD HH:mm:ss ที่บอทอ่านได้').toBe('string');

    // เวลาสแกนจริงขึ้นกับนาฬิกาเครื่องที่รันเทส → ตรึงเป็นเวลาที่รู้ค่า (ฟิลด์อื่นคงเป็นของจริงจาก PDA ทั้งหมด)
    await setDoc(PROJECT_ID, itemPath('SRC', 'S-NORM'), { timestamp: `${DAY.iso} 11:00:00`, firstScanAt: `${DAY.iso} 11:00:00` });
    await setDoc(PROJECT_ID, itemPath('SRC', 'S-F03'), { timestamp: `${DAY.iso} 12:10:00`, firstScanAt: `${DAY.iso} 12:10:00` });
    await setDoc(PROJECT_ID, 'stock_sessions/SRC_r01', { r01UploadedAt: DAY.thai });
    const stateDir = B.newStateDir();

    const r = B.runBotSync({ stateDir, csv: csvFor(['SRC']), args: ['--branch', 'SRC', '--confirm', '--confirm-branch', 'SRC'] });
    expect(r.code, r.log).toBe(0);
    expect(r.log).toContain('Confirm SRC confirmed(2)');
    const after = await readItems('SRC', ['S-NORM', 'S-F03']);
    expect(after['S-NORM']).toMatchObject({ status: 'pass', soldQty: 3, rawCountedQty: 7, initialStatus: 'pass', auditStatus: 'approved', updatedBy: 'auto-r16' });
    expect(after['S-F03']).toMatchObject({ status: 'pass', initialStatus: 'pass' });
    expect(after['S-NORM'].rev).toBe(real['S-NORM'].rev + 1);
    expect(strip(after['S-NORM'], ['status', 'auditStatus', 'initialStatus', 'soldQty', 'rawCountedQty', 'timestamp', 'firstScanAt'])).toEqual(
      strip(real['S-NORM'], ['status', 'auditStatus', 'initialStatus', 'timestamp', 'firstScanAt']));

    for (const app of [pda, desk]) {
      await app.page.waitForFunction(() => state.scanData.get('S-NORM')?.status === 'pass' && state.scanData.get('S-NORM')?.soldQty === 3, null, { timeout: 20_000, polling: 100 });
    }
    // Desktop ที่ได้ timeline จากบอท กด Confirm ซ้ำ: ไม่มีรายการรอ → ไม่เขียนอะไร
    await desk.page.waitForFunction(() => state.r16Loaded === true && state.r16RawMap.size > 0, null, { timeout: 20_000, polling: 100 });
    await desk.page.evaluate(() => validateAndProcess());
    await desk.page.waitForTimeout(2500);
    const again = await readItems('SRC', ['S-NORM', 'S-F03']);
    expect(again['S-NORM'].rev, 'Desktop กดซ้ำ: ไม่เขียนทับ').toBe(after['S-NORM'].rev);
    expect(again['S-NORM'].updatedBy).toBe('auto-r16');

    // ย้อนผล → ทุกเครื่องเห็นกลับเป็น scanning · ฟิลด์ที่บอทเพิ่มหาย
    const journal = B.journalFiles(stateDir)[0];
    const u = B.runBotSync({ stateDir, csv: csvFor(['SRC']), args: ['--confirm-undo', journal] });
    expect(u.code, u.log).toBe(0);
    for (const app of [pda, desk]) {
      await app.page.waitForFunction(() => state.scanData.get('S-NORM')?.status === 'scanning' && state.scanData.get('S-NORM')?.soldQty === undefined, null, { timeout: 20_000, polling: 100 });
    }
    const undone = await readItems('SRC', ['S-NORM', 'S-F03']);
    expect(strip(undone['S-NORM'], ['timestamp', 'firstScanAt'])).toEqual(strip(real['S-NORM'], ['timestamp', 'firstScanAt']));
    expect(undone['S-NORM'].rev).toBe(after['S-NORM'].rev + 1);
    expect(undone['S-NORM'].updatedBy).toBe('auto-r16-undo');
    expect(await getDoc(PROJECT_ID, 'stock_sessions/SRC_confirm_lock')).toBeNull();

    // Desktop กด Confirm เองหลังย้อน → ผลเดิม (pass · ชดเชย 3) = รายการที่ย้อนอยู่ในสภาพที่ Confirm ปกติรับได้
    await desk.page.evaluate(() => validateAndProcess());
    const redone = await waitForDoc(PROJECT_ID, itemPath('SRC', 'S-NORM'), (d) => d && d.status === 'pass', { timeout: 40_000 });
    expect(redone).toMatchObject({ soldQty: 3, rawCountedQty: 7, initialStatus: 'pass', updatedBy: 'Pharm' });

    await closeApp(pda);
    await closeApp(desk);
  });

  test('บอทอยู่ภายใต้ firestore.rules จริง: สาขา WH ไม่อยู่ในขอบเขต (flag ปฏิเสธ) · และเขียนเอกสารนอก 3 ที่ของ Confirm ไม่ได้เกิดขึ้นเลย', async ({ browser }) => {
    const desk = await bootFreshCount(browser, { branch: 'SSS', role: 'pharmacist', user: 'Pharm', mode: 'desktop' });
    await prepareBranch(desk, 'SSS', ITEMS.filter((i) => ['S-NOPRICE', 'S-F01', 'S-PRICEY'].includes(i[0])));
    const before = {};
    const snap = await adminDb(PROJECT_ID).collection('stock_sessions').get();
    for (const d of snap.docs) before[d.id] = d.updateTime.toMillis();
    const stateDir = B.newStateDir();

    const r = B.runBotSync({ stateDir, csv: csvFor(['SSS']), args: ['--branch', 'SSS', '--confirm', '--confirm-branch', 'SSS'] });
    expect(r.code, r.log).toBe(0);
    const snap2 = await adminDb(PROJECT_ID).collection('stock_sessions').get();
    const changed = snap2.docs.filter((d) => before[d.id] === undefined || before[d.id] !== d.updateTime.toMillis()).map((d) => d.id).sort();
    // เปลี่ยนได้เฉพาะ: การเผยแพร่ timeline (meta + chunk + master {branch}_r01) — ส่วน Confirm แตะแค่ items/lock/audit log (items เป็น subcollection จึงไม่อยู่ในรายการนี้)
    expect(changed.filter((id) => !/^SSS_r16_104_/.test(id) && id !== 'SSS_r01'), `เอกสารระดับบนที่ถูกแตะนอกเหนือ timeline: ${changed}`).toEqual([]);
    const sessionAfter = await getDoc(PROJECT_ID, 'stock_sessions/SSS');
    expect(sessionAfter.schemaVersion, 'ไม่แตะ schemaVersion ของ session').toBe(2);
    expect(await getDoc(PROJECT_ID, 'stock_sessions/WH_confirm_lock')).toBeNull();

    // flag: WH ไม่ใช่สาขาของบอท
    const wh = B.runBotSync({ stateDir, csv: csvFor(['SSS']), args: ['--branch', 'WH', '--confirm', '--confirm-branch', 'WH'] });
    expect(wh.code).toBe(2);
    await closeApp(desk);
    void fs;
  });
});
