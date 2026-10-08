// Fix: WH PDA recheck tab — the qty input used to lose focus and scroll to top mid-typing whenever
// *anyone else* in the branch changed any SKU, because startScanItemsListener() unconditionally called
// renderScanList() (body.innerHTML=...) on every snapshot. patchScanRow() already existed with a
// document.activeElement guard but the listener never called it. See CLAUDE.md §SCAN_ITEM_LISTENER_PATCH.
//
// WH always has many warehouse staff scanning concurrently, so "someone else changed a SKU" is the
// common case. rebuildScanListMap() filters PDA warehouse role to scannedBy===currentUser only
// (whWorklist — seeing everyone — requires Desktop width), so a coworker's own SKU never entered this
// device's scanListMap in the first place and must be skipped outright, not just patched.
const { test, expect, closeApp, requireEmulator } = require('../../lib/hooks');
const { bootFreshCount, bootJoinCount, PROJECT_ID } = require('../../lib/scenario');
const { setDoc } = require('../../lib/emulator');
const { makeWhCountItem, makeAuditItem, seedWhWorkflow } = require('../../lib/wh-workflow');

// Focuses the recheck qty input for sku, types value without committing (no blur/Enter), returns
// a probe of {activeElementIsInput, value} so the caller can assert focus survives a listener tick.
async function focusRecheckInput(page, sku, value) {
  return page.evaluate(({ sku, value }) => {
    setWhResultTab('recheck');
    const row = document.querySelector(`[data-sku="${sku}"]`);
    const input = row && row.querySelector('.inline-qty-input');
    if (!input) return { found: false };
    input.focus();
    input.value = String(value);
    window.__probeInput = input; // keep the exact element reference to compare identity later
    return { found: true, activeIsInput: document.activeElement === input, value: input.value };
  }, { sku, value });
}

async function probeStillFocused(page) {
  return page.evaluate(() => {
    const el = window.__probeInput;
    if (!el) return { found: false };
    return {
      found: true,
      sameElement: document.body.contains(el),
      activeIsInput: document.activeElement === el,
      value: el.value,
      scrollTop: document.getElementById('scanListBody')?.scrollTop ?? null,
    };
  });
}

test.describe('WH PDA recheck tab — listener must not steal focus while typing', () => {
  test.beforeEach(() => requireEmulator());
  test.setTimeout(120_000);

  test('coworker scanning a different (their own) SKU does not blow away focus on the qty being typed', async ({ browser }) => {
    const desk = await bootFreshCount(browser, { branch: 'WH', role: 'supervisor', user: 'มายด์', mode: 'desktop' });

    // Two audit items already "in progress": one scanned by มุก (this device), one by ตั๋ง (a coworker).
    const mineBase = makeWhCountItem({ sku: 'MINE-01', epoch: desk.epoch, qty: 5, staff: 'มุก' });
    const mine = makeAuditItem(mineBase, { systemQty: 7 });
    const friendBase = makeWhCountItem({ sku: 'FRIEND-01', epoch: desk.epoch, qty: 3, staff: 'ตั๋ง' });
    const friend = makeAuditItem(friendBase, { systemQty: 4 });
    await seedWhWorkflow(PROJECT_ID, { items: [mine, friend] });

    const pda = await bootJoinCount(browser, {
      branch: 'WH', role: 'warehouse', user: 'มุก', mode: 'pda', expectEpoch: desk.epoch,
    });
    await pda.page.waitForFunction(() => state.scanData.get('MINE-01')?.status === 'audit', null, { timeout: 25_000, polling: 100 });

    const focused = await focusRecheckInput(pda.page, 'MINE-01', '1');
    expect(focused).toEqual({ found: true, activeIsInput: true, value: '1' });

    // Coworker ตั๋ง scans more of FRIEND-01 — writes recheckQty on a SKU that never entered this
    // device's list (scannedBy mismatch). Must be a complete no-op for this device's DOM.
    await setDoc(PROJECT_ID, `stock_sessions/WH/items/${friend.sku}`,
      { ...friend, recheckQty: Number(friend.recheckQty || 0) + 1, rev: Number(friend.rev || 0) + 1 },
      { merge: true });

    await pda.page.waitForFunction(
      () => state.scanData.get('FRIEND-01')?.recheckQty === 1,
      null, { timeout: 15_000, polling: 100 },
    );
    const afterFriend = await probeStillFocused(pda.page);
    expect(afterFriend).toMatchObject({ found: true, activeIsInput: true, value: '1' });

    // Supervisor confirms/raises recheckQty on MINE-01 itself (status stays 'audit') — must patch
    // the row quietly, not rebuild, so the input the user is typing in is left alone.
    await setDoc(PROJECT_ID, `stock_sessions/WH/items/${mine.sku}`,
      { ...mine, recheckQty: Number(mine.recheckQty || 0) + 2, rev: Number(mine.rev || 0) + 1 },
      { merge: true });

    await pda.page.waitForFunction(
      (want) => state.scanData.get('MINE-01')?.recheckQty === want,
      Number(mine.recheckQty || 0) + 2,
      { timeout: 15_000, polling: 100 },
    );
    const afterOwnQtyChange = await probeStillFocused(pda.page);
    expect(afterOwnQtyChange).toMatchObject({ found: true, activeIsInput: true, value: '1' });

    await closeApp(pda);
    await closeApp(desk);
  });

  test('a status change on the SKU being typed (e.g. confirmed to pass) falls back to full render — accepted tradeoff', async ({ browser }) => {
    const desk = await bootFreshCount(browser, { branch: 'WH', role: 'supervisor', user: 'มายด์', mode: 'desktop' });
    const mineBase = makeWhCountItem({ sku: 'MINE-02', epoch: desk.epoch, qty: 5, staff: 'มุก' });
    const mine = makeAuditItem(mineBase, { systemQty: 5 });
    await seedWhWorkflow(PROJECT_ID, { items: [mine] });

    const pda = await bootJoinCount(browser, {
      branch: 'WH', role: 'warehouse', user: 'มุก', mode: 'pda', expectEpoch: desk.epoch,
    });
    await pda.page.waitForFunction(() => state.scanData.get('MINE-02')?.status === 'audit', null, { timeout: 25_000, polling: 100 });

    const focused = await focusRecheckInput(pda.page, 'MINE-02', '9');
    expect(focused).toEqual({ found: true, activeIsInput: true, value: '9' });

    // Simulate the SKU being confirmed to 'pass' while the user is mid-type — status changes,
    // so this must still fall back to a full renderScanList() (documented, accepted limitation).
    await setDoc(PROJECT_ID, `stock_sessions/WH/items/${mine.sku}`,
      { ...mine, status: 'pass', auditStatus: 'approved', rev: Number(mine.rev || 0) + 1 },
      { merge: true });

    await pda.page.waitForFunction(() => state.scanData.get('MINE-02')?.status === 'pass', null, { timeout: 15_000, polling: 100 });
    // The recheck tab only shows 'audit' rows, so a pass transition removes the row entirely —
    // the typed, uncommitted '9' is gone. This is the pre-existing, accepted fallback behavior.
    const row = await pda.page.evaluate(() => !!document.querySelector('[data-sku="MINE-02"]'));
    expect(row).toBe(false);

    await closeApp(pda);
    await closeApp(desk);
  });

  test('canary: with SCAN_ITEM_LISTENER_PATCH=false, the same coworker write DOES steal focus (proves the test catches the bug)', async ({ browser }) => {
    const desk = await bootFreshCount(browser, { branch: 'WH', role: 'supervisor', user: 'มายด์', mode: 'desktop' });
    const mineBase = makeWhCountItem({ sku: 'MINE-03', epoch: desk.epoch, qty: 5, staff: 'มุก' });
    const mine = makeAuditItem(mineBase, { systemQty: 7 });
    await seedWhWorkflow(PROJECT_ID, { items: [mine] });

    const pda = await bootJoinCount(browser, {
      branch: 'WH', role: 'warehouse', user: 'มุก', mode: 'pda', expectEpoch: desk.epoch,
    });
    await pda.page.waitForFunction(() => state.scanData.get('MINE-03')?.status === 'audit', null, { timeout: 25_000, polling: 100 });
    await pda.page.evaluate(() => { SCAN_ITEM_LISTENER_PATCH = false; });

    const focused = await focusRecheckInput(pda.page, 'MINE-03', '1');
    expect(focused).toEqual({ found: true, activeIsInput: true, value: '1' });

    await setDoc(PROJECT_ID, `stock_sessions/WH/items/${mine.sku}`,
      { ...mine, recheckQty: Number(mine.recheckQty || 0) + 2, rev: Number(mine.rev || 0) + 1 },
      { merge: true });

    // Don't wait for a specific recheckQty value here: with the switch off, renderScanList()
    // rebuilds the DOM, which makes the browser auto-fire blur on the destroyed input — and that
    // blur has onblur="updateRecheckInlineQty(sku, this.value)" wired to it, so the half-typed '1'
    // gets written back to Firestore too (a second, worse symptom of the same bug: not just lost
    // focus, but an uncommitted value silently saved). Wait for the DOM element itself to be gone
    // instead — that's the thing this canary is actually proving.
    await pda.page.waitForFunction(() => !document.body.contains(window.__probeInput), null, { timeout: 15_000, polling: 100 });
    const after = await probeStillFocused(pda.page);
    expect(after.sameElement).toBe(false);
    expect(after.activeIsInput).toBe(false);

    await closeApp(pda);
    await closeApp(desk);
  });
});
