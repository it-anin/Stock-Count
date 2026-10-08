// บั๊กเดิม (พบ ต.ค. 2026): WH Supervisor กด F5 แล้ว "ยอดรีเช็คที่ PDA กรอกไว้" หายเป็น 0 ทั้ง Cloud
//   restoreFromFirestore(force) ของ Supervisor อ่าน items ก่อนโหลด op → _loadScanItemsFromCloud ข้าม item ที่ผูก op ทุกตัว
//   → sd ถูกสร้างจาก marker (ไม่มี recheckQty) และ _scanItemSynced/_scanItemRev ว่าง
//   → _reconcileScanItems ถือว่า "ไม่เคย sync" → _flushDirtySkus batch.set(merge:false) ทับ item บน Cloud (rev=1)
// สวิตช์ WH_ITEM_LOAD_GUARD: (1) โหลด op ก่อนอ่าน items (2) reconcile ไม่ดัน item ผูก op ที่เครื่องนี้ไม่เคย sync
//
// ทุกเทสต้องพิสูจน์ว่า Count Confirm commit op จริง (listWhConfirmOps) และยอดรีเช็คขึ้น Cloud จริงก่อน F5
// ไม่งั้นเทสผ่านด้วยเหตุผลผิด (ไม่มีอะไรให้หายตั้งแต่แรก)
const { test, expect, closeApp, requireEmulator } = require('../../lib/hooks');
const { bootFreshCount, bootJoinCount, armWhR16, PROJECT_ID } = require('../../lib/scenario');
const { adminDb, getDoc, waitForDoc } = require('../../lib/emulator');
const { waitForAppReady } = require('../../lib/boot');
const F = require('../../lib/fixtures');
const { makeWhCountItem, seedWhWorkflow, listWhConfirmOps } = require('../../lib/wh-workflow');

const SKUS = ['RC-01', 'RC-02', 'RC-03'];
const RECHECK = { 'RC-01': 10, 'RC-02': 11, 'RC-03': 12 };
const itemPath = (sku) => `stock_sessions/WH/items/${sku}`;

async function extendWhR01(rows) {
  const ref = adminDb(PROJECT_ID).doc('stock_sessions/WH_r01');
  const snap = await ref.get();
  const data = snap.data() || {};
  await ref.set({ ...data, data_json: JSON.stringify([...F.r01Rows, ...rows]) });
}

// Supervisor Count Confirm จริง → item เป็น audit (นับ 5 ≠ ระบบ 9) + ผูก whCountOpId · PDA กรอกยอดรีเช็คผ่านช่องจริง (fill + Enter)
async function setupAuditWithPdaRecheck(browser) {
  const desk = await bootFreshCount(browser, { branch: 'WH', role: 'supervisor', user: 'มายด์', mode: 'desktop' });
  await extendWhR01(SKUS.map((sku) => ({ colE: sku, productName: `Synthetic ${sku}`, systemQty: 9 })));
  await seedWhWorkflow(PROJECT_ID, { items: SKUS.map((sku) => makeWhCountItem({ sku, epoch: desk.epoch, qty: 5, staff: 'มุก' })) });
  const pda = await bootJoinCount(browser, { branch: 'WH', role: 'warehouse', user: 'มุก', mode: 'pda', expectEpoch: desk.epoch });

  await desk.page.waitForFunction((l) => l.every((s) => state.scanData.get(s)?.status === 'scanning'), SKUS, { timeout: 20_000, polling: 100 });
  await armWhR16(desk.page);
  await desk.page.evaluate(() => _confirmWhCountItems('มุก'));
  await desk.page.waitForFunction(() => !_whCountConfirming, null, { timeout: 60_000, polling: 100 });
  expect((await listWhConfirmOps(PROJECT_ID, { kind: 'count', state: 'committed' })).length).toBeGreaterThan(0);

  await pda.page.waitForFunction((l) => l.every((s) => state.scanData.get(s)?.status === 'audit'), SKUS, { timeout: 30_000, polling: 100 });
  await pda.page.evaluate(() => setWhResultTab('recheck'));
  for (const sku of SKUS) {
    const input = pda.page.locator(`[data-sku="${sku}"] .inline-qty-input`);
    await input.fill(String(RECHECK[sku]));
    await input.press('Enter'); // Enter → blur → updateRecheckInlineQty
  }
  for (const sku of SKUS) {
    await waitForDoc(PROJECT_ID, itemPath(sku), (d) => d?.recheckQty === RECHECK[sku] && d.whCountOpId, { timeout: 20_000 });
  }
  return { desk, pda };
}

async function readCloudRecheck() {
  const out = {};
  for (const sku of SKUS) { const d = await getDoc(PROJECT_ID, itemPath(sku)); out[sku] = { recheckQty: d?.recheckQty, rev: d?.rev, recheckBy: d?.recheckBy }; }
  return out;
}

// จำลองเวลาผ่านไป 60 วิ (reconcile) แล้วบังคับ flush — ทางที่ทำให้ของเดิมเขียนทับ
async function reconcileAndFlush(page) {
  await page.evaluate(async () => { _reconcileScanItems(); await _flushDirtySkus(); });
  await new Promise((r) => setTimeout(r, 1500));
}

test.describe('WH Supervisor F5 / รีโหลด — ยอดรีเช็คที่ PDA กรอกไว้ต้องไม่หาย', () => {
  test.beforeEach(() => requireEmulator());
  test.setTimeout(180_000);

  test('Supervisor F5 จริง → Cloud ยังมียอดรีเช็คครบ · rev ไม่ถูกรีเซ็ต · Desktop เห็นยอด · PDA ไม่เด้งเป็น 0', async ({ browser }) => {
    const { desk, pda } = await setupAuditWithPdaRecheck(browser);
    const before = await readCloudRecheck();

    await desk.page.reload();
    await waitForAppReady(desk.page);
    // Desktop ต้องโหลด item พร้อมยอดรีเช็คจาก Cloud (ไม่ใช่สร้างจาก marker ที่ไม่มี recheckQty)
    await desk.page.waitForFunction((exp) => Object.entries(exp).every(([s, q]) => state.scanData.get(s)?.recheckQty === q), RECHECK, { timeout: 30_000, polling: 100 });
    await new Promise((r) => setTimeout(r, 3500)); // ให้ syncToFirestore หลังโหลดวิ่ง (ทางที่เคยทับ)
    await reconcileAndFlush(desk.page);

    const after = await readCloudRecheck();
    for (const sku of SKUS) {
      expect(after[sku].recheckQty, `${sku} recheckQty`).toBe(RECHECK[sku]);
      expect(after[sku].recheckBy, `${sku} recheckBy`).toBe('มุก');
      expect(after[sku].rev, `${sku} rev ต้องไม่ถูกรีเซ็ตเป็น 1`).toBeGreaterThanOrEqual(before[sku].rev);
    }
    const pdaVals = await pda.page.evaluate((l) => Object.fromEntries(l.map((s) => [s, state.scanData.get(s)?.recheckQty])), SKUS);
    expect(pdaVals).toEqual(RECHECK);

    await closeApp(pda);
    await closeApp(desk);
  });

  test('PDA ปิด-เปิดแอปใหม่ → ยอดรีเช็คของตัวเองยังอยู่ทั้งในเครื่องและบน Cloud', async ({ browser }) => {
    const { desk, pda } = await setupAuditWithPdaRecheck(browser);

    await pda.page.reload();
    await waitForAppReady(pda.page);
    await pda.page.waitForFunction((exp) => Object.entries(exp).every(([s, q]) => state.scanData.get(s)?.recheckQty === q), RECHECK, { timeout: 30_000, polling: 100 });
    await reconcileAndFlush(pda.page);

    const after = await readCloudRecheck();
    for (const sku of SKUS) expect(after[sku].recheckQty, `${sku}`).toBe(RECHECK[sku]);

    await closeApp(pda);
    await closeApp(desk);
  });

  test('reconcile ไม่ดัน item ที่ผูก op และเครื่องนี้ไม่เคย sync (ด่านชั้นที่สอง) · item ธรรมดายังถูกดันตามเดิม', async ({ browser }) => {
    const desk = await bootFreshCount(browser, { branch: 'WH', role: 'supervisor', user: 'มายด์', mode: 'desktop' });
    const r = await desk.page.evaluate(() => {
      const mk = (extra) => ({ countedQty: 3, status: 'audit', scannedBy: 'มุก', auditor: '', retries: 0, scans: [], ...extra });
      const run = (guard) => {
        WH_ITEM_LOAD_GUARD = guard;
        _dirtySkus.clear(); _scanItemSynced.delete('G-OP'); _scanItemSynced.delete('G-RECHECK-OP'); _scanItemSynced.delete('G-PLAIN');
        state.scanData.set('G-OP', mk({ whCountOpId: 'count_x' }));          // ผูก op ของ Count
        state.scanData.set('G-RECHECK-OP', mk({ whRecheckOpId: 'recheck_x' })); // ผูก op ของ Recheck
        state.scanData.set('G-PLAIN', mk({}));                                  // item ธรรมดา ไม่ผูก op
        _reconcileScanItems();
        const queued = [..._dirtySkus].filter((s) => s.startsWith('G-')).sort();
        clearTimeout(_scanItemFlushTimer); _dirtySkus.clear();                  // ไม่ให้ flush จริงขึ้น emulator
        return queued;
      };
      const on = run(true);
      const off = run(false);
      WH_ITEM_LOAD_GUARD = true;
      return { on, off };
    });
    expect(r.on).toEqual(['G-PLAIN']);                                   // สวิตช์เปิด: ข้ามเฉพาะที่ผูก op
    expect(r.off).toEqual(['G-OP', 'G-PLAIN', 'G-RECHECK-OP']);          // สวิตช์ปิด = พฤติกรรมเดิมทุกไบต์
    await closeApp(desk);
  });

  test('canary: ปิดสวิตช์แล้วรันลำดับบูตของ Supervisor ซ้ำ → ยอดรีเช็คบน Cloud หายจริง (พิสูจน์ว่าเทสจับบั๊กได้)', async ({ browser }) => {
    const { desk, pda } = await setupAuditWithPdaRecheck(browser);

    // ลำดับเดียวกับ initAfterLogin ของ Supervisor: restoreFromFirestore(force) → _loadWhWorkflowCloudState (op ยังว่างตอนอ่าน items)
    await desk.page.evaluate(async () => {
      WH_ITEM_LOAD_GUARD = false;
      stopWhConfirmOpsListener(); // ล้าง _whCommittedOps เหมือนเพิ่งบูต
      await restoreFromFirestore(true);
      await _loadWhWorkflowCloudState();
    });
    await reconcileAndFlush(desk.page);

    const after = await readCloudRecheck();
    expect(SKUS.some((s) => after[s].recheckQty === undefined), 'ถ้าไม่มีด่านกัน ยอดรีเช็คต้องหายอย่างน้อยหนึ่ง SKU').toBe(true);

    await closeApp(pda);
    await closeApp(desk);
  });
});
