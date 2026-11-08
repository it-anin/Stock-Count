// Exercises deployed-rule semantics through the browser SDK; admin SDK is seed/inspect only.
const { test, expect, closeApp, requireEmulator } = require('../../lib/hooks');
const { bootFreshCount, PROJECT_ID } = require('../../lib/scenario');
const { adminDb, getDoc, setDoc } = require('../../lib/emulator');
const fs = require('fs');
const nodePath = require('path');
const PURGE_TOOL = fs.readFileSync(nodePath.join(__dirname, '../../../tools/purge-test-sku.js'), 'utf8');

const path = (branch, sku) => `stock_sessions/${branch}/items/${sku}`;
const result = (sku, epoch, status = 'pass') => ({ sku, countResetAt: epoch, status, rev: 1,
  countedQty: 3, timestamp: '2026-11-03 15:00:00', firstScanAt: '2026-11-03 15:00:00' });

test.describe('pharmacy confirmed deletion — server guard', () => {
  test.beforeEach(() => requireEmulator());
  test.setTimeout(90_000);

  for (const branch of ['SRC', 'KKL', 'SSS']) {
    test(`${branch}: cached client plain delete and mixed batch cannot remove confirmed results`, async ({ browser }) => {
      const app = await bootFreshCount(browser, { branch });
      for (const status of ['pass', 'audit', 'audit_check', 'stock_adjustment', 'scanning']) {
        await setDoc(PROJECT_ID, path(branch, status), result(status, app.epoch, status));
      }
      const attempts = await app.page.evaluate(async () => {
        const attempt = async fn => { try { await fn(); return 'allowed'; } catch (e) { return e.code; } };
        const out = [];
        for (const status of ['pass', 'audit', 'audit_check', 'stock_adjustment']) {
          out.push(await attempt(() => getScanItemsRef().doc(status).delete()));
        }
        const batch = _db.batch();
        batch.delete(getScanItemsRef().doc('pass')); batch.delete(getScanItemsRef().doc('scanning'));
        out.push(await attempt(() => batch.commit()));
        return out;
      });
      expect(attempts).toEqual(Array(5).fill('permission-denied'));
      expect(await getDoc(PROJECT_ID, path(branch, 'scanning'))).not.toBeNull(); // whole batch rejected
      await app.page.evaluate(() => getScanItemsRef().doc('scanning').delete());
      await app.page.evaluate(() => getScanItemsRef().doc('scanning').delete()); // idempotent missing-document delete
      expect(await getDoc(PROJECT_ID, path(branch, 'scanning'))).toBeNull();
      for (const status of ['pass', 'audit', 'audit_check', 'stock_adjustment']) {
        expect((await getDoc(PROJECT_ID, path(branch, status))).status).toBe(status);
      }
      await closeApp(app);
    });
  }

  test('an earlier intent cannot be replayed in another request', async ({ browser }) => {
    const app = await bootFreshCount(browser, { branch: 'KKL' });
    await setDoc(PROJECT_ID, path('KKL', 'GUARD'), result('GUARD', app.epoch));
    const code = await app.page.evaluate(async () => {
      const ref = getScanItemsRef().doc('GUARD'), snap = await ref.get({ source: 'server' });
      const batch = _db.batch();
      _writePharmacyDeleteIntent(batch, [{ sku: 'GUARD', data: snap.data() }], 'cleanup_epoch');
      await batch.commit();
      try { await ref.delete(); return 'allowed'; } catch (e) { return e.code; }
    });
    expect(code).toBe('permission-denied');
    expect(await getDoc(PROJECT_ID, path('KKL', 'GUARD'))).not.toBeNull();
    await closeApp(app);
  });

  test('result changed after the deletion snapshot: reject the complete atomic write', async ({ browser }) => {
    const app = await bootFreshCount(browser, { branch: 'KKL' });
    await setDoc(PROJECT_ID, path('KKL', 'GUARD'), result('GUARD', app.epoch));
    await app.page.evaluate(async () => {
      const ref = getScanItemsRef().doc('GUARD'), snap = await ref.get({ source: 'server' });
      window.__deleteBatch = _db.batch();
      _writePharmacyDeleteIntent(__deleteBatch, [{ sku: 'GUARD', data: snap.data() }], 'cleanup_epoch');
      __deleteBatch.delete(ref);
    });
    await setDoc(PROJECT_ID, path('KKL', 'GUARD'), { rev: 2, countedQty: 8 });
    const code = await app.page.evaluate(async () => {
      try { await __deleteBatch.commit(); return 'allowed'; } catch (e) { return e.code; }
    });
    expect(code).toBe('permission-denied');
    expect((await getDoc(PROJECT_ID, path('KKL', 'GUARD'))).countedQty).toBe(8);
    expect(await getDoc(PROJECT_ID, 'stock_sessions/KKL/delete_intents/current')).toBeNull();
    await closeApp(app);
  });

  test('deliberate bulk reset deletes 451 confirmed results across batches within rule access limits', async ({ browser }) => {
    const app = await bootFreshCount(browser, { branch: 'KKL' });
    const batch = adminDb(PROJECT_ID).batch();
    for (let i = 0; i < 451; i++) {
      const sku = 'BULK-' + String(i).padStart(3, '0');
      batch.set(adminDb(PROJECT_ID).doc(path('KKL', sku)), result(sku, app.epoch));
    }
    await batch.commit();
    expect(await app.page.evaluate(() => _deleteAllScanItems())).toBe(451);
    expect((await adminDb(PROJECT_ID).collection('stock_sessions/KKL/items').get()).size).toBe(0);
    const intent = await getDoc(PROJECT_ID, 'stock_sessions/KKL/delete_intents/current');
    expect(intent.reason).toBe('clear_all');
    expect(Object.keys(intent.sources)).toHaveLength(1);
    await closeApp(app);
  });

  test('delayed X and restart retry preserve a newer server confirmation', async ({ browser }) => {
    const app = await bootFreshCount(browser, { branch: 'KKL' });
    const old = result('S-F05', app.epoch, 'stock_adjustment');
    await setDoc(PROJECT_ID, path('KKL', 'S-F05'), { ...old, status: 'pass', rev: 2, timestamp: '2026-11-04 10:00:00' });
    const status = await app.page.evaluate(async ({ old }) => {
      stopScanItemsListener();
      state.scanData.set('S-F05', { status: 'pending', countedQty: 0 });
      _forceDelSkus.set('S-F05', Date.now() + 60000);
      _forceDelSources.set('S-F05', _restartScanResultKey(old));
      _dirtySkus.add('S-F05');
      await _flushDirtySkus();
      return state.scanData.get('S-F05').status;
    }, { old });
    expect(status).toBe('pass');
    expect((await getDoc(PROJECT_ID, path('KKL', 'S-F05'))).rev).toBe(2);
    await app.page.evaluate(() => {
      state.scanData.set('S-F05', { status: 'scanning', countedQty: 1 });
      removeScanItem('S-F05');
    });
    await app.page.waitForFunction(() => state.scanData.get('S-F05')?.status === 'pass');
    expect((await getDoc(PROJECT_ID, path('KKL', 'S-F05'))).rev).toBe(2);
    await closeApp(app);
  });

  test('WH deletion behavior remains unchanged', async ({ browser }) => {
    const app = await bootFreshCount(browser, { branch: 'WH', role: 'supervisor' });
    await setDoc(PROJECT_ID, path('WH', 'GUARD'), result('GUARD', app.epoch));
    await app.page.evaluate(() => getScanItemsRef().doc('GUARD').delete());
    expect(await getDoc(PROJECT_ID, path('WH', 'GUARD'))).toBeNull();
    await closeApp(app);
  });

  test('actual startNewCount and administrator clear keep their explicit deletion behavior', async ({ browser }) => {
    const app = await bootFreshCount(browser, { branch: 'KKL' });
    await setDoc(PROJECT_ID, path('KKL', 'GUARD'), result('GUARD', app.epoch));
    const nextEpoch = await app.page.evaluate(async () => {
      const original = window.prompt;
      window.prompt = () => CLEAR_PIN;
      try { await startNewCount(); return _countResetAt; } finally { window.prompt = original; }
    });
    expect(nextEpoch).not.toBe(app.epoch);
    expect(await getDoc(PROJECT_ID, path('KKL', 'GUARD'))).toBeNull();
    expect((await getDoc(PROJECT_ID, 'stock_sessions/KKL/delete_intents/current')).reason).toBe('new_count');
    await setDoc(PROJECT_ID, path('KKL', 'GUARD'), result('GUARD', nextEpoch));
    await app.page.evaluate(async () => {
      const original = window.prompt;
      _adminMode = true; window.prompt = () => CLEAR_PIN;
      try { await clearAllData(); } finally { window.prompt = original; }
    });
    expect(await getDoc(PROJECT_ID, path('KKL', 'GUARD'))).toBeNull();
    expect(await getDoc(PROJECT_ID, 'stock_sessions/KKL')).toBeNull();
    expect((await getDoc(PROJECT_ID, 'stock_sessions/KKL/delete_intents/current')).reason).toBe('clear_all');
    await closeApp(app);
  });

  test('out-of-catalog cleanup: dry-run preserves both records, apply deletes marker and item atomically', async ({ browser }) => {
    const app = await bootFreshCount(browser, { branch: 'KKL' });
    const sku = 'OUTSIDE-CATALOG';
    await setDoc(PROJECT_ID, path('KKL', sku), result(sku, app.epoch, 'audit'));
    const markerPath = 'stock_sessions/KKL_pharmacy_audit_markers';
    await setDoc(PROJECT_ID, markerPath, { branch: 'KKL', countResetAt: app.epoch, items: {
      [sku]: { sku, countResetAt: app.epoch, status: 'audit', countedQty: 3 },
    } });
    await app.page.evaluate(async source => { (0, eval)(source); await purgeTestSku('OUTSIDE-CATALOG'); }, PURGE_TOOL);
    expect(await getDoc(PROJECT_ID, path('KKL', sku))).not.toBeNull();
    expect((await getDoc(PROJECT_ID, markerPath)).items[sku]).toBeDefined();
    await app.page.evaluate(() => purgeTestSku('OUTSIDE-CATALOG', { apply: true }));
    expect(await getDoc(PROJECT_ID, path('KKL', sku))).toBeNull();
    expect((await getDoc(PROJECT_ID, markerPath)).items[sku]).toBeUndefined();
    expect((await getDoc(PROJECT_ID, 'stock_sessions/KKL/delete_intents/current')).reason).toBe('cleanup_epoch');
    await closeApp(app);
  });

  test('epoch moves during rescan cleanup: preserve revision and fingerprint from the new round', async ({ browser }) => {
    const app = await bootFreshCount(browser, { branch: 'KKL' });
    const old = result('S-F05', app.epoch, 'stock_adjustment');
    await setDoc(PROJECT_ID, path('KKL', 'S-F05'), old);
    await app.page.evaluate(({ old }) => {
      stopScanItemsListener(); clearInterval(_scanItemReconcileTimer); _scanItemReconcileTimer = null;
      state.scanData.set('S-F05', { status: 'pending', countedQty: 0 });
      _forceDelSkus.set('S-F05', Date.now() + 60000);
      _forceDelSources.set('S-F05', _restartScanResultKey(old));
      _dirtySkus.clear(); _dirtySkus.add('S-F05');
      const gate = new Promise(resolve => { window.__releaseCleanup = resolve; });
      const real = _db.runTransaction.bind(_db);
      _db.runTransaction = fn => real(tx => fn({
        get: async ref => { const snap = await tx.get(ref); window.__cleanupRead = true; await gate; return snap; },
        set: (...args) => tx.set(...args), delete: ref => tx.delete(ref),
      }));
      window.__cleanupPending = _flushDirtySkus();
    }, { old });
    await app.page.waitForFunction(() => window.__cleanupRead === true);
    const retained = await app.page.evaluate(async () => {
      _countResetAt = new Date(Date.parse(_countResetAt) + 60000).toISOString();
      _scanItemRev.set('S-F05', 7); _scanItemSynced.set('S-F05', 'new-round-fingerprint');
      __releaseCleanup(); await __cleanupPending;
      return [_scanItemRev.get('S-F05'), _scanItemSynced.get('S-F05')];
    });
    expect(retained).toEqual([7, 'new-round-fingerprint']);
    expect((await getDoc(PROJECT_ID, path('KKL', 'S-F05'))).rev).toBe(1);
    await closeApp(app);
  });

  test('missing metadata update returns not-found instead of a rules evaluation error', async ({ browser }) => {
    const app = await bootFreshCount(browser, { branch: 'KKL' });
    const code = await app.page.evaluate(async () => {
      try { await _db.collection('stock_sessions').doc('KKL_missing_guard_test').update({ r16Loaded: false }); return 'allowed'; }
      catch (e) { return e.code; }
    });
    expect(code).toBe('not-found');
    expect(await getDoc(PROJECT_ID, 'stock_sessions/KKL_missing_guard_test')).toBeNull();
    await closeApp(app);
  });

  test('reset waits for marker cleanup even when the R01 update fails', async ({ browser }) => {
    const app = await bootFreshCount(browser, { branch: 'KKL' });
    await app.page.evaluate(() => {
      const originalCollection = _db.collection.bind(_db), originalRebuild = window.rebuildMaps;
      const gate = new Promise(resolve => { window.__releaseMarkerDelete = resolve; });
      window.__cleanupEvents = [];
      _db.collection = name => {
        const col = originalCollection(name);
        if (name !== 'stock_sessions') return col;
        const originalDoc = col.doc.bind(col);
        col.doc = id => {
          const ref = originalDoc(id);
          if (id === 'KKL_r01') ref.update = async () => { throw Object.assign(new Error('injected metadata failure'), { code: 'permission-denied' }); };
          if (id === 'KKL_pharmacy_audit_markers') {
            const originalDelete = ref.delete.bind(ref);
            ref.delete = async () => { window.__markerCleanupStarted = true; __cleanupEvents.push('delete-start'); await gate; await originalDelete(); __cleanupEvents.push('delete-end'); };
          }
          return ref;
        };
        return col;
      };
      window.rebuildMaps = function (...args) { if (window.__markerCleanupStarted) __cleanupEvents.push('rebuild'); return originalRebuild.apply(this, args); };
      const originalPrompt = window.prompt; window.prompt = () => CLEAR_PIN;
      window.__resetWithCleanup = startNewCount().finally(() => {
        window.prompt = originalPrompt; _db.collection = originalCollection; window.rebuildMaps = originalRebuild;
      });
    });
    await app.page.waitForFunction(() => window.__markerCleanupStarted === true);
    const events = await app.page.evaluate(async () => {
      __releaseMarkerDelete(); await __resetWithCleanup; return __cleanupEvents;
    });
    expect(events.indexOf('delete-end')).toBeGreaterThan(events.indexOf('delete-start'));
    expect(events.indexOf('rebuild')).toBeGreaterThan(events.indexOf('delete-end'));
    await closeApp(app);
  });

  test('empty log backfill with a stale local cache preserves authoritative server markers', async ({ browser }) => {
    const app = await bootFreshCount(browser, { branch: 'KKL' });
    const markers = { 'S-F05': { sku: 'S-F05', countResetAt: app.epoch, status: 'audit', countedQty: 1, effectiveQty: 1, systemQty: 5 } };
    await app.page.evaluate(() => {
      if (_pharmacyAuditMarkerUnsubscribe) { _pharmacyAuditMarkerUnsubscribe(); _pharmacyAuditMarkerUnsubscribe = null; }
      stopScanItemsListener();
      _pharmacyAuditMarkerData = { branch: currentBranch, countResetAt: _countResetAt, items: {} };
    });
    await setDoc(PROJECT_ID, 'stock_sessions/KKL_pharmacy_audit_markers', {
      branch: 'KKL', countResetAt: app.epoch, items: markers, preserveCustomMetadata: true,
    }, { merge: false });
    await app.page.evaluate(() => _backfillPharmacyAuditMarkersFromLog());
    const after = await getDoc(PROJECT_ID, 'stock_sessions/KKL_pharmacy_audit_markers');
    expect(after.items).toEqual(markers);
    expect(after.preserveCustomMetadata).toBe(true);
    expect(after.legacyLogBackfilledAt).toBeDefined();
    await closeApp(app);
  });
});
