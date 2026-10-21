// กันเอกสารผีของ WH (ต.ค. 2026 · สวิตช์ SCAN_FLUSH_EPOCH_GUARD + WH_GHOST_OP_CHECK) — จำลองเหตุการณ์ 7 ต.ค. ด้วยโค้ดจริงบน emulator
// ผี = ผลยืนยันรอบเก่า (เนื้อหา 25 ก.ย. · อ้าง op ที่ถูกลบ) ที่ถูกเขียนกลับด้วยป้ายรอบใหม่ rev 1 · อาการ: PDA สแกนแล้วขึ้น Pass แต่ Desktop ขึ้น รอนับ
//   A) PDA ส่ง item ของรอบเก่าขึ้น Cloud >450 ใบ (ชุดละ 450) แล้วหัวหน้ากด "เริ่มนับใหม่" ระหว่างที่ชุดแรกยังรอ commit (เน็ตสะดุด/เครื่องหลับ)
//      เดิม: ชุดท้ายถูกสร้างหลังรับรอบใหม่ → ป้ายรอบใหม่ + เนื้อหาเก่า + rev 1 · ตอนนี้: ทิ้งชุดที่เหลือ (SCAN_FLUSH_EPOCH_GUARD)
//   B) ผีที่อยู่บน Cloud แล้ว (op ถูกลบ) · PDA สแกน SKU นั้น — เดิมรับเป็น Pass เอง · ตอนนี้ถือว่าไม่มี Confirm: ลบผีแล้วสร้างยอดสแกนจริง (WH_GHOST_OP_CHECK)
//      ⚠️ เขียนทับผีตรงๆ ไม่ได้: firestore.rules (preservesWhWorkflowOpIds) ห้าม update ที่ทิ้ง whCountOpId — ข้อ "กฎ Firestore" ตรึงข้อเท็จจริงนี้ด้วย rules จริงบน emulator
//   C) Confirm จริง (op committed) ต้องไม่ถูกทับ/ลบ แม้ PDA ยังไม่รู้จัก op (ตัดสินจาก server ไม่ใช่ _whCommittedOps)
// ทุกข้อมี canary: ปิดสวิตช์แล้วบั๊กเดิมต้องกลับมาจริง (ไม่งั้นเทสผ่านโดยไม่ได้ตรวจอะไร)
const { test, expect, closeApp, requireEmulator } = require('../../lib/hooks');
const { bootFreshCount, bootJoinCount, armWhR16, PROJECT_ID } = require('../../lib/scenario');
const { adminDb, getDoc, waitForDoc } = require('../../lib/emulator');
const { makeWhCountItem, seedWhWorkflow, listWhConfirmOps, readCollectionMap } = require('../../lib/wh-workflow');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const itemPath = (sku) => `stock_sessions/WH/items/${sku}`;
const GHOST_OP = 'count_mugt0rln_deadbeef00000000';   // op ของ 25 ก.ย. ที่ไม่มีอยู่บน Cloud แล้ว
const resetFromDesk = (desk) => desk.page.evaluate(async () => {
  const orig = window.prompt; window.prompt = () => CLEAR_PIN;
  try { await startNewCount(); } finally { window.prompt = orig; }
});
const scanOnce = (page, barcode) => page.evaluate((b) => { scanQueue.push(parseScanLine(b)); drainQueue(); }, barcode);

test.describe('WH ghost docs — flush epoch guard + ghost-op check', () => {
  test.beforeEach(() => requireEmulator());
  test.setTimeout(240_000);

  // PDA ถือ item ของรอบเก่า n ใบ (ยืนยันแล้ว ผูก op เก่า) ทั้งหมด dirty · ชุดแรก (450) ค้างรอ commit delayMs · หัวหน้ากดเริ่มนับใหม่ระหว่างรอ
  async function straddle(browser, { guardOn, n = 460, delayMs = 16_000 }) {
    const desk = await bootFreshCount(browser, { branch: 'WH', role: 'supervisor', user: 'มายด์', mode: 'desktop' });
    const E0 = desk.epoch;
    const pda = await bootJoinCount(browser, { branch: 'WH', role: 'warehouse', user: 'ตั๋ง', mode: 'pda', expectEpoch: E0 });
    const drops = [];
    pda.page.on('console', (m) => { if (m.text().includes('รอบนับเปลี่ยนระหว่างส่ง')) drops.push(m.text()); });
    await pda.page.evaluate(({ n, guardOn, delayMs, op }) => {
      SCAN_FLUSH_EPOCH_GUARD = guardOn;
      for (let i = 1; i <= n; i++) {
        const sku = 'GH-' + String(i).padStart(4, '0');
        state.scanData.set(sku, { countedQty: 3, status: 'pass', retries: 0, scans: [], timestamp: '2026-09-25 17:14:34', firstScanAt: '2026-09-25 17:14:34', scannedBy: 'ตั๋ง', auditor: '',
          auditStatus: 'approved', barcode: 'B-' + sku, location: 'A1-01', countAt: '2026-09-25T10:14:00.000Z', initialStatus: 'pass',
          countConfirmedAt: '2026-09-25T10:14:43.000Z', countConfirmedBy: 'มายด์', whCountOpId: op });
        _markSkuDirty(sku);
      }
      clearTimeout(_scanItemFlushTimer); _scanItemFlushTimer = null;
      // commit ชุดแรกค้าง (จำลองเน็ตสะดุด/เครื่องหลับ) — ชุดถัดไปไม่หน่วง
      const proto = Object.getPrototypeOf(_db.batch()); const orig = proto.commit; let armed = true;
      proto.commit = function (...a) { const slow = armed; armed = false; return slow ? new Promise((r) => setTimeout(r, delayMs)).then(() => orig.apply(this, a)) : orig.apply(this, a); };
      _flushDirtySkus();   // ไม่ await: ชุดที่ 1 ถูกสร้างตอนนี้ด้วยรอบ E0 แล้วค้างรอ commit
    }, { n, guardOn, delayMs, op: GHOST_OP });
    await pda.page.waitForFunction(() => _scanItemFlushing === true, null, { timeout: 5_000, polling: 50 });   // พิสูจน์ว่า flush เริ่มแล้วและค้าง

    await resetFromDesk(desk);                                      // หัวหน้ากดเริ่มนับใหม่ (รอบ E1) ขณะชุดแรกของ PDA ยังรอ commit
    const E1 = await desk.page.evaluate(() => _countResetAt);
    expect(E1 > E0).toBe(true);
    await pda.page.waitForFunction((e) => _countResetAt === e, E1, { timeout: 60_000, polling: 100 });   // PDA รับรอบใหม่แล้ว (ระหว่างรอ commit)
    await pda.page.waitForFunction(() => _scanItemFlushing === false, null, { timeout: 90_000, polling: 200 });   // flush จบ (commit ชุดแรกคืน + ชุดที่เหลือถูกตัดสินแล้ว)
    await sleep(2500);                                              // ให้ commit ถึง server
    const items = await readCollectionMap(PROJECT_ID, 'stock_sessions/WH/items');
    const ghosts = Object.entries(items).filter(([sku, d]) => sku.startsWith('GH-') && d.countResetAt === E1);
    const leftovers = Object.entries(items).filter(([sku, d]) => sku.startsWith('GH-') && d.countResetAt === E0);
    return { desk, pda, drops, ghosts, leftovers, E0, E1, n };
  }

  test('★ A) รอบเปลี่ยนระหว่างส่งหลายชุด → ไม่เกิดผีป้ายรอบใหม่ (ชุดท้ายถูกทิ้ง · บอก console)', async ({ browser }) => {
    const r = await straddle(browser, { guardOn: true });
    expect(r.drops, 'ต้องเกิดเหตุการณ์คร่อมรอบจริง (guard ทำงาน) — ไม่งั้นเทสนี้ไม่ได้ตรวจอะไร').toHaveLength(1);
    expect(r.drops[0]).toContain(`ทิ้ง ${r.n - 450} รายการ`);
    expect(r.ghosts, 'ห้ามมีเอกสารป้ายรอบใหม่ที่เนื้อหาเก่า').toEqual([]);
    expect(await pdaState(r.pda.page)).toMatchObject({ dirty: 0, epoch: r.E1 });   // ไม่ requeue ของรอบเก่า
    await closeApp(r.pda); await closeApp(r.desk);
  });

  test('canary: ปิด SCAN_FLUSH_EPOCH_GUARD → ชุดท้ายถูกเขียนเป็นผี (ป้ายรอบใหม่ · rev 1 · updatedBy ผู้ล็อกอิน · อ้าง op เก่า)', async ({ browser }) => {
    const r = await straddle(browser, { guardOn: false });
    expect(r.drops).toHaveLength(0);
    expect(r.ghosts).toHaveLength(r.n - 450);                       // ผีหางชุด — ขนาดเล็กแบบเดียวกับที่เจอจริง (6 และ 2 ใบ)
    for (const [, d] of r.ghosts) {
      expect(d).toMatchObject({ status: 'pass', rev: 1, updatedBy: 'ตั๋ง', whCountOpId: GHOST_OP, countResetAt: r.E1 });
    }
    // และ op ของผีไม่มีอยู่จริง (Desktop จึงมองไม่เห็นผลนั้น)
    expect(await listWhConfirmOps(PROJECT_ID)).toEqual([]);
    await closeApp(r.pda); await closeApp(r.desk);
  });

  // ผีบน Cloud แล้ว: เอกสาร pass ของรอบปัจจุบัน อ้าง op ที่ไม่มีอยู่ (เหมือนข้อมูลจริง 8 ใบ) · PDA สแกน SKU นั้น
  async function ghostScan(browser, { ghostCheck }) {
    const desk = await bootFreshCount(browser, { branch: 'WH', role: 'supervisor', user: 'มายด์', mode: 'desktop' });
    const ghost = { ...makeWhCountItem({ sku: 'S-F03', epoch: desk.epoch, qty: 3, status: 'pass', staff: 'ตั๋ง', rev: 1 }),
      auditStatus: 'approved', initialStatus: 'pass', whCountOpId: GHOST_OP, countConfirmedAt: '2026-09-25T10:14:43.000Z', countConfirmedBy: 'มายด์',
      timestamp: '2026-09-25 17:14:34', firstScanAt: '2026-09-25 17:14:34', updatedBy: 'ตั๋ง' };
    await seedWhWorkflow(PROJECT_ID, { items: [ghost] });
    const pda = await bootJoinCount(browser, { branch: 'WH', role: 'warehouse', user: 'ตั๋ง', mode: 'pda', expectEpoch: desk.epoch });
    await sleep(1500);   // listener รับ snapshot ผีแล้วถูกด่าน op ข้าม
    expect(await pda.page.evaluate(() => state.scanData.get('S-F03')?.status), 'ผียังไม่ถูกรับตอนโหลด (ด่านอ่านทำงานอยู่แล้ว)').toBe('pending');
    await pda.page.evaluate((g) => { WH_GHOST_OP_CHECK = g; }, ghostCheck);
    await scanOnce(pda.page, 'B-F03');
    await pda.page.waitForFunction(() => (state.scanData.get('S-F03') || {}).countedQty >= 1 || (state.scanData.get('S-F03') || {}).status === 'pass', null, { timeout: 10_000, polling: 100 });
    await pda.page.evaluate(() => _flushDirtySkus());
    await sleep(1500);
    return { desk, pda, ghost };
  }

  test('★ B) ผีบน Cloud (op ถูกลบ) → PDA สแกนแล้วนับต่อได้ ไม่ขึ้น Pass · ผีถูกลบแล้วสร้างเป็น scanning ไม่มี op (ผ่าน rules จริง) · Desktop เห็นตรงกัน', async ({ browser }) => {
    const { desk, pda } = await ghostScan(browser, { ghostCheck: true });
    const doc = await waitForDoc(PROJECT_ID, itemPath('S-F03'), (d) => d?.status === 'scanning' && d.countedQty === 1, { timeout: 15_000 });
    expect(doc.whCountOpId).toBeUndefined();          // ผีหายไป (ลบแล้วสร้างใหม่ — เขียนทับตรงๆ rules ไม่ยอม)
    // rev ต่อจากผี (1 → 2) · ≥ 2 ไม่ใช่ === 2: _reconcileScanItems ที่รันกลางการส่งครั้งแรกเห็น SKU ใหม่ "ยังไม่เคย sync" แล้วสั่งส่งซ้ำ
    // (ยอดเท่าเดิม ไม่นับซ้ำ → rev 3) — เกิดกับการสแกน SKU ปกติได้เช่นกัน (โค้ดเดิมก่อนแก้เจอ 2 ใน 38 รอบ) · ผีใช้ 2 transaction
    // หน้าต่างส่งยาวกว่าจึงเจอบ่อยกว่า (2 ใน 6 รอบ) · ดู CLAUDE.md §เอกสารผี
    expect(doc.rev).toBeGreaterThanOrEqual(2);
    expect(doc.rev).toBeLessThanOrEqual(3);
    expect(doc.countResetAt).toBe(desk.epoch);
    expect(await pda.page.evaluate(() => { const s = state.scanData.get('S-F03'); return { status: s.status, qty: s.countedQty }; })).toEqual({ status: 'scanning', qty: 1 });
    await desk.page.waitForFunction(() => { const s = state.scanData.get('S-F03'); return s && s.status === 'scanning' && s.countedQty === 1; }, null, { timeout: 15_000, polling: 100 });
    await closeApp(pda); await closeApp(desk);
  });

  test('canary: ปิด WH_GHOST_OP_CHECK → อาการเดิม PDA ขึ้น Pass (รับผี) แต่ Desktop ขึ้น รอนับ · ผียังอยู่บน Cloud', async ({ browser }) => {
    const { desk, pda, ghost } = await ghostScan(browser, { ghostCheck: false });
    expect(await pda.page.evaluate(() => state.scanData.get('S-F03').status)).toBe('pass');
    expect(await desk.page.evaluate(() => state.scanData.get('S-F03')?.status)).toBe('pending');
    const doc = await getDoc(PROJECT_ID, itemPath('S-F03'));
    expect(doc).toMatchObject({ status: 'pass', whCountOpId: GHOST_OP, rev: 1, countedQty: ghost.countedQty });
    await closeApp(pda); await closeApp(desk);
  });

  // ตรึงข้อเท็จจริงที่ทำให้ต้อง "ลบก่อนแล้วสร้างใหม่" (พบ 21 ต.ค. 2026 ตอนรัน e2e ข้อ B ครั้งแรก: เขียนทับผีตรงๆ → permission-denied วนไม่จบ)
  test('กฎ Firestore: เขียนทับผีตรงๆ ไม่ได้ (set · delete+set ใน transaction เดียว) — ลบ แล้วสร้างใหม่คนละ transaction ผ่าน (ที่มาของ WH_GHOST_OP_CHECK แบบสองขั้น)', async ({ browser }) => {
    const desk = await bootFreshCount(browser, { branch: 'WH', role: 'supervisor', user: 'มายด์', mode: 'desktop' });
    const mkGhost = (sku) => ({ ...makeWhCountItem({ sku, epoch: desk.epoch, qty: 3, status: 'pass', staff: 'ตั๋ง', rev: 1 }),
      auditStatus: 'approved', initialStatus: 'pass', whCountOpId: GHOST_OP, countConfirmedAt: '2026-09-25T10:14:43.000Z', countConfirmedBy: 'มายด์', updatedBy: 'ตั๋ง' });
    await seedWhWorkflow(PROJECT_ID, { items: [mkGhost('S-F01'), mkGhost('S-F02')] });
    const pda = await bootJoinCount(browser, { branch: 'WH', role: 'warehouse', user: 'ตั๋ง', mode: 'pda', expectEpoch: desk.epoch });
    const out = await pda.page.evaluate(async () => {
      const payload = (sku) => ({ sku, countResetAt: _countResetAt, rev: 2, status: 'scanning', countedQty: 1, scannedBy: 'ตั๋ง', updatedBy: 'ตั๋ง' });
      const tryTx = async (fn) => { try { await _db.runTransaction(fn); return 'ok'; } catch (e) { return e.code || String(e); } };
      const r = {};
      r.overwrite = await tryTx(async (tx) => { const ref = getScanItemsRef().doc('S-F01'); await tx.get(ref); tx.set(ref, payload('S-F01'), { merge: false }); });
      r.deleteThenSetOneTx = await tryTx(async (tx) => { const ref = getScanItemsRef().doc('S-F01'); await tx.get(ref); tx.delete(ref); tx.set(ref, payload('S-F01'), { merge: false }); });
      r.delete = await tryTx(async (tx) => { const ref = getScanItemsRef().doc('S-F02'); await tx.get(ref); tx.delete(ref); });
      r.createAfterDelete = await tryTx(async (tx) => { const ref = getScanItemsRef().doc('S-F02'); const s = await tx.get(ref); r.existsBeforeCreate = s.exists; tx.set(ref, payload('S-F02'), { merge: false }); });
      return r;
    });
    expect(out).toEqual({ overwrite: 'permission-denied', deleteThenSetOneTx: 'permission-denied', delete: 'ok', existsBeforeCreate: false, createAfterDelete: 'ok' });
    // ผีของ S-F01 ยังอยู่ครบ (ไม่มีอะไรเขียนผ่าน) · S-F02 เป็นเอกสารใหม่ไม่มี op
    expect(await getDoc(PROJECT_ID, itemPath('S-F01'))).toMatchObject({ status: 'pass', whCountOpId: GHOST_OP, rev: 1 });
    const fresh = await getDoc(PROJECT_ID, itemPath('S-F02'));
    expect(fresh).toMatchObject({ status: 'scanning', countedQty: 1 });
    expect(fresh.whCountOpId).toBeUndefined();
    await closeApp(pda); await closeApp(desk);
  });

  test('★ C) Confirm จริง (op committed) ไม่ถูกทับ แม้ PDA ยังไม่รู้จัก op — ตัดสินจาก server ไม่ใช่ _whCommittedOps', async ({ browser }) => {
    const desk = await bootFreshCount(browser, { branch: 'WH', role: 'supervisor', user: 'มายด์', mode: 'desktop' });
    // S-F01..S-F03 มียอดระบบ 1..3 → นับเท่ายอดระบบ = pass จริง
    const items = [1, 2, 3].map((i) => makeWhCountItem({ sku: `S-F0${i}`, epoch: desk.epoch, qty: i, staff: 'ตั๋ง' }));
    await seedWhWorkflow(PROJECT_ID, { items });
    await desk.page.waitForFunction(() => ['S-F01', 'S-F02', 'S-F03'].every((s) => state.scanData.get(s)?.status === 'scanning'), null, { timeout: 30_000, polling: 100 });
    await armWhR16(desk.page);
    await desk.page.evaluate(() => _confirmWhCountItems());
    await desk.page.waitForFunction(() => !_whCountConfirming, null, { timeout: 60_000, polling: 100 });
    const ops = await listWhConfirmOps(PROJECT_ID, { kind: 'count', state: 'committed' });
    expect(ops).toHaveLength(1);
    const before = await waitForDoc(PROJECT_ID, itemPath('S-F03'), (d) => d?.status === 'pass' && d.whCountOpId === ops[0].id, { timeout: 60_000 });

    const pda = await bootJoinCount(browser, { branch: 'WH', role: 'warehouse', user: 'ตั๋ง', mode: 'pda', expectEpoch: desk.epoch });
    await pda.page.waitForFunction(() => _whCommittedOps.size === 1, null, { timeout: 30_000, polling: 100 });
    // เครื่องที่ยังโหลด op ไม่ครบ (เพิ่งล็อกอิน/F5): ล้างความรู้เรื่อง op + หยุด listener แล้วทำให้ local เป็น pending เหมือนเครื่องใหม่
    await pda.page.evaluate(() => {
      stopWhConfirmOpsListener();
      state.scanData.set('S-F03', { countedQty: 0, status: 'pending', retries: 0, timestamp: '', scannedBy: '', auditor: '', auditStatus: 'pending', barcode: '', location: 'A1-01', scans: [] });
      scanListMap.delete('S-F03'); _scanItemRev.delete('S-F03'); _scanItemSynced.delete('S-F03');
    });
    expect(await pda.page.evaluate(() => _whCommittedOps.size)).toBe(0);
    await scanOnce(pda.page, 'B-F03');
    await pda.page.evaluate(() => _flushDirtySkus());
    await pda.page.waitForFunction(() => state.scanData.get('S-F03')?.status === 'pass', null, { timeout: 15_000, polling: 100 });   // รับผล Confirm ของ server เหมือนเดิม
    const after = await getDoc(PROJECT_ID, itemPath('S-F03'));
    expect(after).toMatchObject({ status: 'pass', rev: before.rev, whCountOpId: ops[0].id, countedQty: before.countedQty });   // เอกสารเดิมทุกไบต์ ไม่ถูกเขียนทับ
    await closeApp(pda); await closeApp(desk);
  });
});

const pdaState = (page) => page.evaluate(() => ({ dirty: _dirtySkus.size, epoch: _countResetAt }));
