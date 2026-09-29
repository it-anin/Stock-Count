// ★ Pending field test #2a (CLAUDE.md): pharmacy Confirm รอบแรก on schema v2 —
// status resolution via effectiveQty, the mid-work abort guard.
// Entry point is the real one: validateAndProcess() → _confirmPharmacyBatched().
// ก.ย. 2026: สาขายาไม่ตรง → stock_adjustment ทันที (ไม่ผ่าน Audit) — ดู pharmacy-direct-adj.spec.js (e2e + logic)
const { test, expect, closeApp, requireEmulator } = require('../../lib/hooks');
const { bootFreshCount, bootJoinCount, armR16, PROJECT_ID } = require('../../lib/scenario');
const { waitForDoc, getDoc, adminDb } = require('../../lib/emulator');

async function scanTimes(page, barcode, times) {
  await page.evaluate(({ barcode, times }) => {
    for (let i = 0; i < times; i++) scanQueue.push(parseScanLine(barcode));
    drainQueue();
  }, { barcode, times });
}

// PDA scans the three outcome classes, then pushes them to the cloud.
async function seedScannedItems(pda) {
  await scanTimes(pda.page, 'B-NORM', 10);  // S-NORM sys 10 → pass
  await scanTimes(pda.page, 'B-F05', 3);    // S-F05  sys 5  → stock_adjustment (mismatch · ไม่ผ่าน Audit แล้ว)
  await scanTimes(pda.page, 'B-NEG', 3);    // S-NEG sys -3: บวกปกติ → 3 · ไม่มี R16 รับเข้ามาอธิบาย → 3 ≠ -3 → stock_adjustment
  await scanTimes(pda.page, 'B-ZERO', 1);   // S-ZERO sys 0: บวก 1 ตามปกติ (ไม่มีกฎนับ 0 แล้ว) → stock_adjustment
  await pda.page.waitForFunction(() => state.scanData.get('S-NORM')?.countedQty === 10 &&
    state.scanData.get('S-F05')?.countedQty === 3 && state.scanData.get('S-NEG')?.countedQty === 3 &&
    state.scanData.get('S-ZERO')?.countedQty === 1,
    null, { polling: 100 });
  await pda.page.evaluate(() => _flushDirtySkus());
  await waitForDoc(PROJECT_ID, 'stock_sessions/SRC/items/S-NORM', (d) => d && d.countedQty === 10);
  await waitForDoc(PROJECT_ID, 'stock_sessions/SRC/items/S-NEG', (d) => d && d.countedQty === 3);
  await waitForDoc(PROJECT_ID, 'stock_sessions/SRC/items/S-ZERO', (d) => d && d.countedQty === 1);
}

test.describe('pharmacy Confirm รอบแรก (schema v2)', () => {
  test.beforeEach(() => requireEmulator());
  test.setTimeout(90_000);

  test('happy path: pass / stock_adjustment (ไม่ผ่าน Audit) resolved, ไม่มี audit marker, lock released', async ({ browser }) => {
    const desk = await bootFreshCount(browser, { role: 'pharmacist', user: 'Pharm', mode: 'desktop' });
    await armR16(desk.page);
    const pda = await bootJoinCount(browser, { role: 'assistant', user: 'PDA-A', mode: 'pda', expectEpoch: desk.epoch });
    await seedScannedItems(pda);

    await desk.page.evaluate(() => validateAndProcess());

    const norm = await waitForDoc(PROJECT_ID, 'stock_sessions/SRC/items/S-NORM', (d) => d && d.status === 'pass', { timeout: 25000 });
    // ก.ย. 2026: ไม่ตรง → stock_adjustment ทันที พร้อมแช่คู่ effectiveQty/systemQty ณ ตอน Confirm (ใบปรับสต็อกคิดจากคู่นี้)
    const f05 = await waitForDoc(PROJECT_ID, 'stock_sessions/SRC/items/S-F05', (d) => d && d.status === 'stock_adjustment');
    // ระบบติดลบ + ระบบ 0 ที่ยิงมา ก็ไม่ผ่าน Audit แล้วเหมือนกัน (ย้อนกติกา ก.ค. 2026 ตามคำสั่งผู้ใช้) — ห้ามเป็น pass
    const neg = await waitForDoc(PROJECT_ID, 'stock_sessions/SRC/items/S-NEG', (d) => d && d.status === 'stock_adjustment');
    const zero = await waitForDoc(PROJECT_ID, 'stock_sessions/SRC/items/S-ZERO', (d) => d && d.status === 'stock_adjustment');
    expect(norm.directAdj).toBeUndefined();
    expect(f05).toMatchObject({ countedQty: 3, auditStatus: 'stock_adjustment', initialStatus: 'stock_adjustment', directAdj: true, effectiveQty: 3, systemQty: 5 });
    expect(neg).toMatchObject({ countedQty: 3, auditStatus: 'stock_adjustment', directAdj: true, effectiveQty: 3, systemQty: -3 });
    expect(zero).toMatchObject({ countedQty: 1, auditStatus: 'stock_adjustment', directAdj: true, effectiveQty: 1, systemQty: 0 });

    // ไม่มีอะไรเข้า Audit worklist — marker (ถ้ามี doc อยู่แล้วจากตอน login) ต้องว่าง
    const markers = await getDoc(PROJECT_ID, 'stock_sessions/SRC_pharmacy_audit_markers');
    expect(Object.keys((markers && markers.items) || {})).toEqual([]);

    // lock released in finally
    expect(await getDoc(PROJECT_ID, 'stock_sessions/SRC_confirm_lock')).toBeNull();

    await closeApp(pda);
    await closeApp(desk);
  });

  test('mid-work change aborts the whole batch — nothing confirmed, lock released', async ({ browser }) => {
    const desk = await bootFreshCount(browser, { role: 'pharmacist', user: 'Pharm', mode: 'desktop' });
    await armR16(desk.page);
    const pda = await bootJoinCount(browser, { role: 'assistant', user: 'PDA-A', mode: 'pda', expectEpoch: desk.epoch });
    await seedScannedItems(pda);

    // Another device bumps an item between the "initial" read (2nd call) and the "latest" read (3rd).
    await desk.page.exposeFunction('__mutateMidConfirm', async () => {
      const ref = adminDb(PROJECT_ID).doc('stock_sessions/SRC/items/S-NORM');
      const cur = (await ref.get()).data();
      await ref.set({ ...cur, countedQty: 11, rev: Number(cur.rev || 0) + 1, updatedBy: 'OtherDevice' });
    });
    await desk.page.evaluate(() => {
      const orig = window._readBranchConfirmCloudState;
      let calls = 0;
      window._readBranchConfirmCloudState = async function (...args) {
        const res = await orig.apply(this, args);
        calls += 1;
        if (calls === 2) await window.__mutateMidConfirm();
        return res;
      };
    });

    await desk.page.evaluate(() => validateAndProcess());
    await desk.page.waitForFunction(() => _branchConfirming === false, null, { timeout: 30000, polling: 100 });

    // every item stays 'scanning' — abort must be all-or-nothing
    for (const sku of ['S-NORM', 'S-F05', 'S-NEG']) {
      const d = await getDoc(PROJECT_ID, `stock_sessions/SRC/items/${sku}`);
      expect(d.status, `${sku} must remain scanning`).toBe('scanning');
    }
    const markers = await getDoc(PROJECT_ID, 'stock_sessions/SRC_pharmacy_audit_markers');
    expect(Object.keys((markers && markers.items) || {})).toEqual([]);
    expect(await getDoc(PROJECT_ID, 'stock_sessions/SRC_confirm_lock')).toBeNull();

    await closeApp(pda);
    await closeApp(desk);
  });

  test('R01/R16 version mismatch blocks Confirm before any write', async ({ browser }) => {
    const desk = await bootFreshCount(browser, { role: 'pharmacist', user: 'Pharm', mode: 'desktop' });
    await armR16(desk.page);
    const pda = await bootJoinCount(browser, { role: 'assistant', user: 'PDA-A', mode: 'pda', expectEpoch: desk.epoch });
    await seedScannedItems(pda);

    // cloud master moves to a different R16 generation than this desktop holds
    await adminDb(PROJECT_ID).doc('stock_sessions/SRC_r01').set({ r16DetailVersion: 'R16-OTHER' }, { merge: true });

    await desk.page.evaluate(() => validateAndProcess());
    await desk.page.waitForFunction(() => _branchConfirming === false, null, { timeout: 30000, polling: 100 });

    expect((await getDoc(PROJECT_ID, 'stock_sessions/SRC/items/S-NORM')).status).toBe('scanning');
    expect(await getDoc(PROJECT_ID, 'stock_sessions/SRC_confirm_lock')).toBeNull();

    await closeApp(pda);
    await closeApp(desk);
  });
});
