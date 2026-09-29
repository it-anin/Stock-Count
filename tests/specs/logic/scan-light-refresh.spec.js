// ลดงานหลังสแกน (ก.ย. 2026) — ตรึงหลักการ "สแกนล้วนไม่ต้องคำนวณทั้ง catalog ซ้ำ" ที่ระดับฟังก์ชัน (ไม่ใช้ emulator)
//   · _afterScanRefresh   : สแกนล้วน (pending/scanning) ไม่เรียก updateStats · สถานะอื่นยังเดินเส้นทางเดิม · Unknown อัปเดตทันที
//   · _applyScanItemChange: doc ที่ผลเท่าของเดิม (echo ของเครื่องตัวเอง) ไม่ถูก apply · ของที่ต่างจริงยัง apply
//   · SCAN_LIGHT_REFRESH  : สวิตช์ปิดต้องกลับไปพฤติกรรมเดิมทุกอย่าง (rollback = ตั้ง false แล้ว deploy)
const { test, expect, bootBare, closeApp } = require('../../lib/hooks');

// สอดส่องฟังก์ชัน global (function declaration = property ของ window) — การเรียกภายในแอปเดินผ่าน global lookup จึงโดนด้วย
const SPY = `
  window.__log = [];
  const wrap = (n) => { const o = window[n]; window[n] = function (...a) { window.__log.push(n); return o.apply(this, a); }; };
  ['updateStats', 'scheduleStatsAfterScan', 'updateWhResultTabs', 'renderSupervisorCountButtons'].forEach(wrap);
`;

const seed = () => {
  const base = { countedQty: 0, retries: 0, timestamp: '', scannedBy: '', auditor: '', auditStatus: 'pending', barcode: '', location: '', scans: [] };
  state.scanData.set('S-PEND', { ...base, status: 'pending' });
  state.scanData.set('S-SCAN', { ...base, status: 'scanning', countedQty: 2, scannedBy: 'A' });
  state.scanData.set('S-AUD', { ...base, status: 'audit', countedQty: 2, scannedBy: 'A', recheckQty: 1 });
  state.scanData.set('S-PASS', { ...base, status: 'pass', countedQty: 2, scannedBy: 'A' });
};

test.describe('_afterScanRefresh — สแกนล้วนไม่เรียก updateStats ทั้ง catalog', () => {
  test('pending/scanning → ไม่เรียก updateStats/scheduleStatsAfterScan · นับเฉพาะ counters ที่สแกนเปลี่ยนได้จริง', async ({ browser }) => {
    const app = await bootBare(browser);
    const out = await app.page.evaluate(({ SPY, seed }) => {
      eval(SPY); (0, eval)('(' + seed + ')')(); // seed ใช้ state ใน scope global
      window.__log.length = 0;
      _afterScanRefresh(new Set(['S-SCAN']));
      _afterScanRefresh(new Set(['S-PEND']));
      return { log: [...window.__log], safetyArmed: _scanStatsSafetyTimer !== null };
    }, { SPY, seed: seed.toString() });
    expect(out.log).not.toContain('updateStats');
    expect(out.log).not.toContain('scheduleStatsAfterScan');
    expect(out.log).toContain('updateWhResultTabs');   // tab จำนวนของ WH PDA เปลี่ยนตามสแกน
    expect(out.safetyArmed).toBe(true);                // safety refresh ระยะยาวยังถูกตั้งไว้
    await closeApp(app);
  });

  test('สถานะอื่น (WH recheck = audit · สแกนซ้ำของที่ Confirm แล้ว) → เส้นทางเดิม scheduleStatsAfterScan', async ({ browser }) => {
    const app = await bootBare(browser);
    const out = await app.page.evaluate(({ SPY, seed }) => {
      eval(SPY); (0, eval)('(' + seed + ')')();
      const r = {};
      for (const k of ['S-AUD', 'S-PASS']) {
        window.__log.length = 0;
        _afterScanRefresh(new Set([k]));
        r[k] = [...window.__log];
      }
      return r;
    }, { SPY, seed: seed.toString() });
    expect(out['S-AUD']).toContain('scheduleStatsAfterScan');
    expect(out['S-PASS']).toContain('scheduleStatsAfterScan');
    await closeApp(app);
  });

  test('Unknown → อัปเดต #statUnknown ทันที ไม่เรียก updateStats', async ({ browser }) => {
    const app = await bootBare(browser);
    const out = await app.page.evaluate(({ SPY }) => {
      eval(SPY);
      state.unknownScans.push({ barcode: 'ZZ-1', count: 1, location: '', timestamp: 't', scannedBy: 'A' });
      window.__log.length = 0;
      _afterScanRefresh(new Set(['unknown:ZZ-1']));
      return { log: [...window.__log], text: document.getElementById('statUnknown').textContent };
    }, { SPY });
    expect(out.text).toBe('1');
    expect(out.log).not.toContain('updateStats');
    await closeApp(app);
  });

  test('ผสม: มีสถานะอื่นปนแม้ตัวเดียว → เดินเส้นทางเต็ม (ห้ามข้ามเพราะส่วนใหญ่เป็นสแกนล้วน)', async ({ browser }) => {
    const app = await bootBare(browser);
    const out = await app.page.evaluate(({ SPY, seed }) => {
      eval(SPY); (0, eval)('(' + seed + ')')();
      window.__log.length = 0;
      _afterScanRefresh(new Set(['S-SCAN', 'S-PEND', 'S-AUD']));
      return [...window.__log];
    }, { SPY, seed: seed.toString() });
    expect(out).toContain('scheduleStatsAfterScan');
    await closeApp(app);
  });

  test('SCAN_LIGHT_REFRESH=false → กลับพฤติกรรมเดิม: ทุกสแกนเข้า scheduleStatsAfterScan', async ({ browser }) => {
    const app = await bootBare(browser);
    const out = await app.page.evaluate(({ SPY, seed }) => {
      eval(SPY); (0, eval)('(' + seed + ')')();
      SCAN_LIGHT_REFRESH = false;
      window.__log.length = 0;
      _afterScanRefresh(new Set(['S-SCAN']));
      return [...window.__log];
    }, { SPY, seed: seed.toString() });
    expect(out).toContain('scheduleStatsAfterScan');
    expect(out).not.toContain('updateWhResultTabs');
    await closeApp(app);
  });
});

test.describe('_applyScanItemChange — echo ที่ผลเท่าของเดิมไม่ถูก apply', () => {
  const doc = (over = {}) => ({
    sku: 'S-E', countResetAt: '', rev: 5, updatedBy: 'A', updatedAt: 'ts',
    status: 'scanning', countedQty: 3, scannedBy: 'A', auditor: '', timestamp: 't', barcode: 'B', firstScanAt: 't', auditStatus: 'pending', ...over,
  });
  const local = () => ({ status: 'scanning', countedQty: 3, scannedBy: 'A', auditor: '', timestamp: 't', barcode: 'B', firstScanAt: 't', auditStatus: 'pending', location: '', retries: 0, scans: [{ q: 1 }], manualEditAt: 77 });

  test('เท่าเดิม → คืน false · object เดิมไม่ถูกแทน · scans/manualEditAt อยู่ครบ · rev/synced อัปเดต', async ({ browser }) => {
    const app = await bootBare(browser);
    const out = await app.page.evaluate(({ d, l }) => {
      const mine = l; state.scanData.set('S-E', mine);
      const r = _applyScanItemChange('S-E', d);
      return { r, same: state.scanData.get('S-E') === mine, scans: mine.scans.length, manual: mine.manualEditAt, rev: _scanItemRev.get('S-E'), synced: _scanItemSynced.has('S-E') };
    }, { d: doc(), l: local() });
    expect(out.r).toBe(false);
    expect(out.same).toBe(true);
    expect(out.scans).toBe(1);
    expect(out.manual).toBe(77);
    expect(out.rev).toBe(5);
    expect(out.synced).toBe(true);
    await closeApp(app);
  });

  test('ต่างจริง (เครื่องอื่นแก้ยอด) → apply ตามเดิม · คืน true · คง scans/manualEditAt ของเครื่องนี้', async ({ browser }) => {
    const app = await bootBare(browser);
    const out = await app.page.evaluate(({ d, l }) => {
      const mine = l; state.scanData.set('S-E', mine);
      const r = _applyScanItemChange('S-E', d);
      const now = state.scanData.get('S-E');
      return { r, replaced: now !== mine, qty: now.countedQty, scans: now.scans.length, manual: now.manualEditAt, rev: _scanItemRev.get('S-E') };
    }, { d: doc({ countedQty: 9, rev: 6 }), l: local() });
    expect(out.r).toBe(true);
    expect(out.replaced).toBe(true);
    expect(out.qty).toBe(9);
    expect(out.scans).toBe(1);
    expect(out.manual).toBe(77);
    expect(out.rev).toBe(6);
    await closeApp(app);
  });

  test('สถานะต่างกัน (Confirm จากเครื่องอื่น) → apply เสมอ ไม่ถูกข้ามเพราะยอดเท่ากัน', async ({ browser }) => {
    const app = await bootBare(browser);
    const out = await app.page.evaluate(({ d, l }) => {
      state.scanData.set('S-E', l);
      const r = _applyScanItemChange('S-E', d);
      return { r, status: state.scanData.get('S-E').status };
    }, { d: doc({ status: 'pass', auditStatus: 'approved', rev: 7 }), l: local() });
    expect(out.r).toBe(true);
    expect(out.status).toBe('pass');
    await closeApp(app);
  });

  test('guard เดิมยังอยู่: dirty / in-flight → ไม่ apply ไม่ว่าข้อมูลจะต่างหรือไม่', async ({ browser }) => {
    const app = await bootBare(browser);
    const out = await app.page.evaluate(({ d, l }) => {
      state.scanData.set('S-E', l);
      _dirtySkus.add('S-E');
      const dirty = _applyScanItemChange('S-E', d);
      _dirtySkus.clear(); _scanItemInFlight.add('S-E');
      const inflight = _applyScanItemChange('S-E', d);
      _scanItemInFlight.clear();
      return { dirty, inflight, qty: state.scanData.get('S-E').countedQty };
    }, { d: doc({ countedQty: 9, rev: 6 }), l: local() });
    expect(out.dirty).toBe(false);
    expect(out.inflight).toBe(false);
    expect(out.qty).toBe(3);   // ยอดในเครื่องไม่ถูกดึงกลับไปค่าเก่า/ค่าคนอื่นระหว่างรอเขียน
    await closeApp(app);
  });

  test('SCAN_LIGHT_REFRESH=false → เท่าเดิมก็ apply (พฤติกรรมเดิม)', async ({ browser }) => {
    const app = await bootBare(browser);
    const out = await app.page.evaluate(({ d, l }) => {
      SCAN_LIGHT_REFRESH = false;
      const mine = l; state.scanData.set('S-E', mine);
      const r = _applyScanItemChange('S-E', d);
      return { r, replaced: state.scanData.get('S-E') !== mine };
    }, { d: doc(), l: local() });
    expect(out.r).toBe(true);
    expect(out.replaced).toBe(true);
    await closeApp(app);
  });
});

test.describe('scheduleSave — backup ในเครื่องรวมงานแต่ไม่อดอยาก', () => {
  test('_cancelPendingSave ล้างทั้ง trailing และ maxWait — ไม่มี save ค้างหลัง reset', async ({ browser }) => {
    const app = await bootBare(browser);
    const out = await app.page.evaluate(async () => {
      SAVE_DEBOUNCE_MS = 200; SAVE_MAXWAIT_MS = 400;
      let saves = 0; const o = window.saveSession; window.saveSession = function () { saves++; return o.apply(this, arguments); };
      scheduleSave(); scheduleSave();
      const armed = { t: _saveTimer !== null, m: _saveMaxTimer !== null, dirty: _saveDirty };
      _cancelPendingSave();
      await new Promise((r) => setTimeout(r, 700));
      return { armed, saves, after: { t: _saveTimer, m: _saveMaxTimer, dirty: _saveDirty } };
    });
    expect(out.armed).toEqual({ t: true, m: true, dirty: true });
    expect(out.saves).toBe(0);
    expect(out.after).toEqual({ t: null, m: null, dirty: false });
    await closeApp(app);
  });

  test('สแกนรัวกว่า debounce → maxWait ยังบังคับ save (ไม่อดอยากจน backup ไม่เคยเกิด)', async ({ browser }) => {
    const app = await bootBare(browser);
    const out = await app.page.evaluate(async () => {
      SAVE_DEBOUNCE_MS = 400; SAVE_MAXWAIT_MS = 900;
      let saves = 0; const o = window.saveSession; window.saveSession = function () { saves++; return o.apply(this, arguments); };
      for (let i = 0; i < 12; i++) { scheduleSave(); await new Promise((r) => setTimeout(r, 200)); } // 2.4 วิ ห่างกว่า debounce ทุกครั้ง
      const during = saves;
      await new Promise((r) => setTimeout(r, 700));
      return { during, total: saves };
    });
    expect(out.during).toBeGreaterThanOrEqual(2);      // 0.9 วิ และ 1.8 วิ ระหว่างที่ยังสแกนอยู่
    expect(out.total).toBeLessThanOrEqual(out.during + 1);
    await closeApp(app);
  });

  test('สวิตช์หลัก SCAN_LIGHT_REFRESH=false → backup กลับ trailing 400 ms แบบเดิม (ไม่มี maxWait / dirty flag) — ย้อนกลับครบทั้ง Phase A', async ({ browser }) => {
    const app = await bootBare(browser);
    const out = await app.page.evaluate(async () => {
      SCAN_LIGHT_REFRESH = false;
      let saves = 0; const o = window.saveSession; window.saveSession = function () { saves++; return o.apply(this, arguments); };
      scheduleSave();
      const armed = { trailing: _saveTimer !== null, maxWait: _saveMaxTimer, dirty: _saveDirty };
      await new Promise((r) => setTimeout(r, 700));   // 400 ms เดิม — ไม่ใช่ trailing 4 วิ ของโหมดเบา
      return { armed, saves };
    });
    expect(out.armed).toEqual({ trailing: true, maxWait: null, dirty: false });
    expect(out.saves).toBe(1);
    await closeApp(app);
  });

  test('สวิตช์หลักเปิดกลับ (true) → กลับสู่หน้าต่าง backup ยาว · ตัวจับเวลาที่ค้างจากโหมดเดิมไม่ทำให้ save ซ้อน', async ({ browser }) => {
    const app = await bootBare(browser);
    const out = await app.page.evaluate(async () => {
      let saves = 0; const o = window.saveSession; window.saveSession = function () { saves++; return o.apply(this, arguments); };
      SCAN_LIGHT_REFRESH = false; scheduleSave();       // ตั้ง trailing 400 ms แบบเดิมค้างไว้
      SCAN_LIGHT_REFRESH = true; SAVE_DEBOUNCE_MS = 2000; SAVE_MAXWAIT_MS = 5000;
      scheduleSave();                                   // โหมดเบา: เขียนทับ trailing เดิม (clearTimeout) แล้วตั้ง maxWait
      const armed = { trailing: _saveTimer !== null, maxWait: _saveMaxTimer !== null, dirty: _saveDirty };
      await new Promise((r) => setTimeout(r, 700));     // เกิน 400 ms เดิมแล้ว แต่ยังต้องไม่ save (trailing ใหม่ 2 วิ)
      return { armed, savesAfter700: saves };
    });
    expect(out.armed).toEqual({ trailing: true, maxWait: true, dirty: true });
    expect(out.savesAfter700).toBe(0);
    await closeApp(app);
  });

  test('pagehide / visibilitychange→hidden / offline → flush ทันที เมื่อมีของค้างเท่านั้น', async ({ browser }) => {
    const app = await bootBare(browser);
    const out = await app.page.evaluate(() => {
      let saves = 0; const o = window.saveSession; window.saveSession = function () { saves++; return o.apply(this, arguments); };
      const r = {};
      window.dispatchEvent(new Event('pagehide'));                 // ไม่มีของค้าง → ไม่ save
      r.idle = saves;
      scheduleSave(); window.dispatchEvent(new Event('pagehide'));
      r.pagehide = saves;
      scheduleSave();
      Object.defineProperty(document, 'hidden', { value: true, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
      r.hidden = saves;
      Object.defineProperty(document, 'hidden', { value: false, configurable: true });
      scheduleSave(); window.dispatchEvent(new Event('offline'));
      r.offline = saves;
      return r;
    });
    expect(out).toEqual({ idle: 0, pagehide: 1, hidden: 2, offline: 3 });
    await closeApp(app);
  });
});
