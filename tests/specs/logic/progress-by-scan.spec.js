// Counted / Pass / Progress ของ "สาขายา" นับตามที่สแกน (ก.ย. 2026 · ผู้ใช้สั่ง · สวิตช์ PROGRESS_BY_SCAN)
//
//   ทุกอุปกรณ์ในสาขายา (Desktop + PDA) — เหตุผล: ตัดขั้น Audit แล้ว "เสร็จ" ของหน้างานคือสแกนครบ ไม่ต้องรอ Confirm
//     Counted = ตัวเศษ Progress = SKU ในชุดที่ต้องนับ (_countableSkus) ที่สถานะไม่ใช่ pending (สแกนครั้งแรกก็นับ)
//     Pass    = สถานะ pass จริง ในชุดเดียวกัน (ไม่รวม stock_adjustment / audit_check)
//     Progress = Counted / Total SKU → ไม่เกิน 100% · ลดได้เมื่อกด ✕ · Audit card ไม่เปลี่ยน (ไม่กรอง)
//   WH ไม่เปลี่ยน · ปิดสวิตช์ต้องกลับเท่าเดิมครบ · สแกนล้วนต้องไม่กลับไปเรียก updateStats() ต่อสแกน (หลักการ SCAN_LIGHT_REFRESH)
//
// ไม่ใช้ emulator/Firestore: _adminMode=true ตัด _markSkuDirty / inbox / sync ออก เหลือเฉพาะเส้นทาง state + DOM (เหมือน scan-row-parity)
// ⚠️ ห้ามส่งฟังก์ชันจาก Node เข้า page.evaluate (serialize ไม่ได้) — ตัวช่วยทั้งหมดอยู่ใน IN_PAGE
const { test, expect, newAppContext, waitForAppReady, closeApp } = require('../../lib/hooks');

async function bootBareMode(browser, mode) {
  const app = await newAppContext(browser, { login: false, mode });
  await app.page.goto('/index.html');
  await waitForAppReady(app.page, { login: false });
  return app;
}

// โค้ดที่รันในหน้า — ประกอบเป็นสตริงเดียวเพื่อใช้ซ้ำทุกเคส
const IN_PAGE = `
  const p3 = (i) => String(i).padStart(3, '0');
  window.__cb = (i) => 'CB-' + p3(i);      // บาร์โค้ดของ SKU ในชุดนับ
  window.__nb = (i) => 'NB-' + p3(i);      // บาร์โค้ดของ SKU นอกชุดนับ
  window.__sku = (i) => 'CD-' + p3(i);     // รหัส SKU ในชุดนับ
  window.__off = (i) => 'NC-' + p3(i);     // รหัส SKU นอกชุดนับ
  // countable = ในชุดนับ (G≠0) · offPlan = หมวด 11. (nc:1) → ยังสแกนได้ แต่ไม่อยู่ใน _countableSkus
  window.__setup = ({ role, branch, user, countable, offPlan }) => {
    currentRole = role; currentBranch = branch; currentUser = user;   // ต้องตั้งก่อน rebuildMaps (updateStats อ่านสาขา)
    _adminMode = true;                                                // ตัด Firestore/inbox/sync — เหลือเฉพาะ state + DOM
    for (let i = 0; i < countable; i++) {
      const sku = __sku(i);
      state.productMasterData.push({ sku, productName: 'Synthetic ' + sku, unitPrice: 20, cat: 'A' });
      state.r01Data.push({ colE: sku, productName: 'Synthetic ' + sku, systemQty: 5 });
      state.r05Data.push({ barcode: __cb(i), colE: sku, unitName: 'TAB', unitMultiplier: 1, unitPrice: 20 });
    }
    for (let i = 0; i < offPlan; i++) {
      const sku = __off(i);
      state.productMasterData.push({ sku, productName: 'Off-plan ' + sku, unitPrice: 20 });
      state.r01Data.push({ colE: sku, productName: 'Off-plan ' + sku, systemQty: 5, nc: 1 });
      state.r05Data.push({ barcode: __nb(i), colE: sku, unitName: 'TAB', unitMultiplier: 1, unitPrice: 20 });
    }
    rebuildMaps();
    updateStats();
    window.__statsCalls = 0;                                          // นับเฉพาะหลัง setup — ตอน setup เรียกอยู่แล้วโดยธรรมชาติ
  };
  window.__cards = () => {
    const t = (id) => document.getElementById(id).textContent;
    return { counted: t('statCounted'), pass: t('statPass'), audit: t('statFail'), total: t('statTotal'),
             progress: t('progressCount'), pct: t('statPct'), fill: document.getElementById('progressFill').style.width };
  };
  window.__scan = (bc) => { scanQueue.push(parseScanLine(bc)); drainQueue(); };
  // จำลอง "ผลจาก Desktop Confirm" ที่มาถึงเครื่องนี้ (สถานะเปลี่ยนจาก scanning เป็นผลตัดสิน)
  window.__setStatus = (sku, status) => { Object.assign(state.scanData.get(sku), { status, countedQty: 5 }); };
  // ชุดสถานะผสมที่ใช้เทียบทุกโหมด: 7 SKU สแกน → pass×2 · stock_adjustment · audit · audit_check · scanning×2
  window.__mixed = () => {
    for (let i = 0; i < 7; i++) __scan(__cb(i));
    __setStatus(__sku(0), 'pass'); __setStatus(__sku(1), 'pass');
    __setStatus(__sku(2), 'stock_adjustment'); __setStatus(__sku(3), 'audit'); __setStatus(__sku(4), 'audit_check');
    updateStats();
  };
  // นับครั้งที่ updateStats() ทั้งก้อนถูกเรียก — สแกนล้วนต้องไม่เรียก
  window.__statsCalls = 0;
  { const orig = window.updateStats; window.updateStats = function () { window.__statsCalls++; return orig.apply(this, arguments); }; }
`;

// ── ทำซ้ำทุกเคสหลักบนทั้งสองอุปกรณ์: ผลต้องเหมือนกัน (นี่คือเป้าหมาย "ตัวเลขเท่ากันทุกจอ") ──
for (const { mode, label } of [{ mode: 'pda', label: 'PDA' }, { mode: 'desktop', label: 'Desktop' }]) {
  test.describe(`${label} สาขายา · Counted/Pass/Progress ตามสแกน`, () => {
    test('สแกนทีละ SKU → Counted และตัวเศษ Progress +1 ทุกครั้ง (สแกนครั้งแรกก็นับ) · Pass ไม่ขยับ · ไม่เรียก updateStats ต่อสแกน', async ({ browser }) => {
      const app = await bootBareMode(browser, mode);
      const r = await app.page.evaluate(async ({ IN_PAGE }) => {
        (0, eval)(IN_PAGE);
        __setup({ role: 'assistant', branch: 'SRC', user: 'U-A', countable: 20, offPlan: 0 });
        const before = __cards();
        const seen = [];
        for (let i = 0; i < 5; i++) { __scan(__cb(i)); seen.push(__cards()); }
        __scan(__cb(2));          // สแกนซ้ำ SKU เดิม → ไม่เพิ่ม
        const afterRepeat = __cards();
        __scan('ZZ-NOPE-1');      // บาร์โค้ดที่ไม่มีในระบบ → ไม่ใช่ SKU ไม่นับ
        const afterUnknown = __cards();
        await new Promise((res) => setTimeout(res, 250));   // เกิน debounce 80 ms — ถ้ามี updateStats แอบตามมา จะโผล่ตรงนี้
        return { before, seen, afterRepeat, afterUnknown, statsCalls: __statsCalls };
      }, { IN_PAGE });

      expect(r.before).toMatchObject({ counted: '0', progress: '0 / 20', pct: '0%' });
      expect(r.seen.map((c) => c.counted)).toEqual(['1', '2', '3', '4', '5']);
      expect(r.seen.map((c) => c.progress)).toEqual(['1 / 20', '2 / 20', '3 / 20', '4 / 20', '5 / 20']);   // ตัวเศษ = Counted เสมอ
      expect(r.seen.map((c) => c.pct)).toEqual(['5%', '10%', '15%', '20%', '25%']);
      expect(r.seen.map((c) => c.fill)).toEqual(['5%', '10%', '15%', '20%', '25%']);                       // แถบ Progress ขยับตาม
      expect(r.seen.every((c) => c.pass === '0')).toBe(true);      // สแกนแล้วยังไม่ Pass — Pass ตัดสินตอน Desktop Confirm
      expect(r.afterRepeat.counted).toBe('5');
      expect(r.afterUnknown.counted).toBe('5');
      expect(r.statsCalls, 'หลักการ SCAN_LIGHT_REFRESH: สแกนล้วนห้ามกลับไปกวาด catalog ด้วย updateStats() ต่อสแกน').toBe(0);
      await closeApp(app);
    });

    test('Progress ถึง 100% เมื่อสแกนครบทุก SKU ที่ต้องนับ (ยังไม่ Confirm สักตัว) · ไม่เกิน 100% แม้สแกนของนอกชุดด้วย', async ({ browser }) => {
      const app = await bootBareMode(browser, mode);
      const r = await app.page.evaluate(({ IN_PAGE }) => {
        (0, eval)(IN_PAGE);
        __setup({ role: 'assistant', branch: 'SRC', user: 'U-A', countable: 6, offPlan: 4 });
        for (let i = 0; i < 5; i++) __scan(__cb(i));
        const almost = __cards();
        __scan(__cb(5));
        const full = __cards();
        for (let i = 0; i < 4; i++) __scan(__nb(i));                  // ของนอกชุด (หมวด 11.) — ต้องไม่ดันเกิน
        const withOffPlan = __cards();
        const statuses = [...state.scanData.values()].filter((s) => s.status === 'scanning').length;
        return { almost, full, withOffPlan, scanning: statuses, countableSize: _countableSkus.size };
      }, { IN_PAGE });

      expect(r.countableSize).toBe(6);
      expect(r.almost).toMatchObject({ counted: '5', progress: '5 / 6', pct: '83%' });
      expect(r.full).toMatchObject({ counted: '6', progress: '6 / 6', pct: '100%', fill: '100%' });   // สแกนครบ = 100% ทั้งที่ Confirm ศูนย์ตัว
      expect(r.withOffPlan).toMatchObject({ counted: '6', progress: '6 / 6', pct: '100%' });          // ของนอกชุดสแกนแล้วเลขไม่ขยับ → ไม่ทะลุ 100%
      expect(r.scanning).toBe(10);                                                                     // ทั้ง 10 ยังเป็น scanning จริง (ไม่ได้ Confirm)
      expect(Number(r.withOffPlan.counted)).toBeLessThanOrEqual(Number(r.withOffPlan.total));
      await closeApp(app);
    });

    test('Pass จริง = pass เท่านั้น ในชุดนับ · Stock Adj / Audit / Audit Check ไม่นับ · Counted = ตัวเศษ Progress · Audit ไม่ถูกกรอง', async ({ browser }) => {
      const app = await bootBareMode(browser, mode);
      const r = await app.page.evaluate(({ IN_PAGE }) => {
        (0, eval)(IN_PAGE);
        __setup({ role: 'assistant', branch: 'SRC', user: 'U-A', countable: 20, offPlan: 3 });
        __mixed();                                                   // ในชุด: pass×2 · stock_adj · audit · audit_check · scanning×2
        __setStatus(__off(0), 'pass');                               // นอกชุด: pass → ต้องไม่เข้า Counted/Pass
        __setStatus(__off(1), 'audit');                              // นอกชุด: audit → Audit card นับ (ไม่กรอง) แต่ Counted ไม่นับ
        updateStats();
        return __cards();
      }, { IN_PAGE });

      expect(r.counted).toBe('7');               // ในชุดที่สแกนแล้ว 7 (รวม scanning 2 ตัวที่ยังไม่ Confirm) · นอกชุดไม่นับ
      expect(r.pass).toBe('2');                  // pass จริงในชุด 2 — ไม่รวม stock_adjustment / audit_check / นอกชุด
      expect(r.audit).toBe('2');                 // Audit ไม่กรอง: ในชุด 1 + นอกชุด 1
      expect(r.progress).toBe('7 / 20');         // ตัวเศษ = Counted เสมอ
      expect(Number(r.pass)).toBeLessThanOrEqual(Number(r.counted));
      expect(Number(r.counted)).toBeLessThanOrEqual(Number(r.total));
      await closeApp(app);
    });

    test('Desktop Confirm มาถึงทีหลัง → Counted/Progress คงเดิม (scanning → ผลตัดสินยังนับ) · Pass ขยับตาม pass จริง', async ({ browser }) => {
      const app = await bootBareMode(browser, mode);
      const r = await app.page.evaluate(({ IN_PAGE }) => {
        (0, eval)(IN_PAGE);
        __setup({ role: 'assistant', branch: 'SRC', user: 'U-A', countable: 20, offPlan: 0 });
        for (let i = 0; i < 3; i++) __scan(__cb(i));
        const scanned = __cards();
        __setStatus(__sku(0), 'pass'); __setStatus(__sku(1), 'stock_adjustment'); __setStatus(__sku(2), 'pass');
        updateStats();
        return { scanned, confirmed: __cards() };
      }, { IN_PAGE });

      expect(r.scanned).toMatchObject({ counted: '3', pass: '0', progress: '3 / 20' });
      expect(r.confirmed).toMatchObject({ counted: '3', pass: '2', progress: '3 / 20' });   // Counted/Progress ไม่เปลี่ยน · Pass = 2 (Stock Adj 1 ตัวไม่นับ)
      await closeApp(app);
    });

    test('เพื่อน PDA สแกน (listener → _refreshScanCounters เท่านั้น ไม่มี updateStats) → ขยับทั้ง Counted/Progress · เพื่อนลบ → ลด', async ({ browser }) => {
      const app = await bootBareMode(browser, mode);
      const r = await app.page.evaluate(({ IN_PAGE }) => {
        (0, eval)(IN_PAGE);
        __setup({ role: 'assistant', branch: 'SRC', user: 'U-A', countable: 20, offPlan: 1 });
        // เส้นทางเดียวกับ startScanItemsListener เมื่อ pending↔scanning เท่านั้น: apply แล้วเรียก _refreshScanCounters()
        state.scanData.get(__sku(4)).status = 'scanning';
        state.scanData.get(__sku(5)).status = 'scanning';
        state.scanData.get(__off(0)).status = 'scanning';             // ของนอกชุดที่เพื่อนสแกน → ไม่นับ
        _refreshScanCounters();
        const friendScanned = __cards();
        state.scanData.get(__sku(5)).status = 'pending';              // _applyScanItemRemoved
        _refreshScanCounters();
        return { friendScanned, friendRemoved: __cards(), statsCalls: __statsCalls };
      }, { IN_PAGE });

      expect(r.friendScanned).toMatchObject({ counted: '2', progress: '2 / 20', pct: '10%' });
      expect(r.friendRemoved).toMatchObject({ counted: '1', progress: '1 / 20', pct: '5%' });
      expect(r.statsCalls).toBe(0);
      await closeApp(app);
    });

    test('ปุ่ม ✕ ลบรายการที่สแกนค้าง → Counted/Progress ลด (removeScanItem → scheduleStats เดิม)', async ({ browser }) => {
      const app = await bootBareMode(browser, mode);
      const r = await app.page.evaluate(async ({ IN_PAGE }) => {
        (0, eval)(IN_PAGE);
        __setup({ role: 'assistant', branch: 'SRC', user: 'U-A', countable: 20, offPlan: 0 });
        for (let i = 0; i < 3; i++) __scan(__cb(i));
        const before = __cards();
        removeScanItem(__sku(1));
        await new Promise((res) => setTimeout(res, 250));         // scheduleStats() debounce 80 ms → updateStats()
        return { before, after: __cards() };
      }, { IN_PAGE });

      expect(r.before).toMatchObject({ counted: '3', progress: '3 / 20' });
      expect(r.after).toMatchObject({ counted: '2', progress: '2 / 20' });
      await closeApp(app);
    });

    test('ปิด SCAN_LIGHT_REFRESH (เส้นทางเดิมเรียก updateStats หลังสแกน) → ได้ผลเท่ากัน', async ({ browser }) => {
      const app = await bootBareMode(browser, mode);
      const r = await app.page.evaluate(async ({ IN_PAGE }) => {
        (0, eval)(IN_PAGE);
        __setup({ role: 'assistant', branch: 'SRC', user: 'U-A', countable: 20, offPlan: 0 });
        SCAN_LIGHT_REFRESH = false;
        for (let i = 0; i < 4; i++) __scan(__cb(i));
        await new Promise((res) => setTimeout(res, 250));
        return { cards: __cards(), statsCalls: __statsCalls };
      }, { IN_PAGE });

      expect(r.cards).toMatchObject({ counted: '4', progress: '4 / 20', pct: '20%' });
      expect(r.statsCalls).toBeGreaterThan(0);   // เส้นทางเก่าเรียก updateStats จริง — และ updateStats เขียนทับชุดนี้ได้ผลเดียวกัน
      await closeApp(app);
    });

    test('PROGRESS_BY_SCAN=false → ทุกอย่างเท่าเดิมครบ (Counted = Confirm แล้ว ∩ ชุดนับ · Pass = pass+stock_adj+audit_check) และสแกนไม่ขยับ', async ({ browser }) => {
      const app = await bootBareMode(browser, mode);
      const r = await app.page.evaluate(({ IN_PAGE }) => {
        (0, eval)(IN_PAGE);
        __setup({ role: 'assistant', branch: 'SRC', user: 'U-A', countable: 20, offPlan: 0 });
        PROGRESS_BY_SCAN = false;
        __mixed();
        const mixed = __cards();
        __scan(__cb(10));                                          // สแกนเพิ่ม → Counted/Progress เดิมต้องไม่ขยับ
        return { mixed, afterScan: __cards(), on: _progressByScanOn() };
      }, { IN_PAGE });

      expect(r.on).toBe(false);
      expect(r.mixed).toMatchObject({ counted: '5', pass: '4', audit: '1', progress: '5 / 20' });
      expect(r.afterScan).toMatchObject({ counted: '5', progress: '5 / 20' });
      await closeApp(app);
    });

    test('📋 "ยังไม่ได้นับ" = ชุดนับที่ยัง pending เท่านั้น → แถว = ตัวหาร − ตัวเศษ · ปิดสวิตช์ = เท่าเดิม (รวม scanning)', async ({ browser }) => {
      const app = await bootBareMode(browser, mode);
      const r = await app.page.evaluate(({ IN_PAGE }) => {
        (0, eval)(IN_PAGE);
        __setup({ role: 'assistant', branch: 'SRC', user: 'U-A', countable: 6, offPlan: 2 });
        for (let i = 0; i < 4; i++) __scan(__cb(i));                // scanning×4
        __setStatus(__sku(0), 'pass'); __setStatus(__sku(1), 'audit');   // pass·audit (Confirm แล้ว) · scanning×2
        updateStats();
        const rowsOf = () => { invalidatePopupRowsCache(); popupFilterState = 'pending'; return getFilteredPopupRows().map((x) => x.sku).sort(); };
        const on = { rows: rowsOf(), progress: __cards().progress };
        PROGRESS_BY_SCAN = false; updateStats();
        const off = { rows: rowsOf(), progress: __cards().progress };
        return { on, off };
      }, { IN_PAGE });

      expect(r.on.progress).toBe('4 / 6');                           // สแกนแล้ว 4 จาก 6
      expect(r.on.rows).toEqual(['CD-004', 'CD-005']);               // เหลือเฉพาะที่ยังไม่สแกน — ตัวที่สแกนแล้ว (scanning) ไม่ค้างในลิสต์
      expect(r.on.rows.length).toBe(6 - 4);                          // invariant: แถว = ตัวหาร − ตัวเศษ
      expect(r.off.progress).toBe('2 / 6');                          // กติกาเดิม: Confirm แล้ว 2
      expect(r.off.rows).toEqual(['CD-002', 'CD-003', 'CD-004', 'CD-005']);   // รวม scanning
      expect(r.off.rows.length).toBe(6 - 2);
      await closeApp(app);
    });

    test('ตัวเลขจาก _refreshScanCounters (เบา) ต้องตรง updateStats (เต็ม) และตรงนิยามจริง ในสถานะสุ่ม 25 รอบ', async ({ browser }) => {
      const app = await bootBareMode(browser, mode);
      const r = await app.page.evaluate(({ IN_PAGE }) => {
        (0, eval)(IN_PAGE);
        __setup({ role: 'assistant', branch: 'SRC', user: 'U-A', countable: 30, offPlan: 5 });
        // PRNG คงที่ (mulberry32) — เทสต้องทำซ้ำได้
        let a = 20260930;
        const rnd = () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
        const STATUSES = ['pending', 'scanning', 'pass', 'audit', 'stock_adjustment', 'audit_check'];
        const skus = [...state.scanData.keys()];
        const grab = () => { const c = __cards(); return { counted: c.counted, pass: c.pass, pct: c.pct, progress: c.progress, fill: c.fill }; };
        const bad = [];
        for (let round = 0; round < 25; round++) {
          let wantScanned = 0, wantPass = 0;
          for (const sku of skus) {
            const status = STATUSES[Math.floor(rnd() * STATUSES.length)];
            state.scanData.get(sku).status = status;
            if (status !== 'pending' && _countableSkus.has(sku)) { wantScanned++; if (status === 'pass') wantPass++; }
          }
          updateStats();
          const full = grab();
          // ล้างค่าบนจอทิ้ง แล้วให้เส้นทางเบาเขียนใหม่ — ถ้าเส้นทางเบาลืมช่องไหน จะเห็นเป็น 'x'
          for (const id of ['statCounted', 'statPass', 'statPct', 'progressCount']) document.getElementById(id).textContent = 'x';
          document.getElementById('progressFill').style.width = '0%';
          _refreshScanCounters();
          const light = grab();
          const denom = _cachedTotalSku;
          const want = { counted: String(wantScanned), pass: String(wantPass), progress: wantScanned + ' / ' + denom };
          if (JSON.stringify(light) !== JSON.stringify(full)) bad.push({ round, kind: 'เบา≠เต็ม', light, full });
          if (full.counted !== want.counted || full.pass !== want.pass || full.progress !== want.progress) bad.push({ round, kind: 'ไม่ตรงนิยาม', full, want });
          if (Number(full.counted) > denom || parseInt(full.pct, 10) > 100) bad.push({ round, kind: 'เกินตัวหาร/100%', full });
        }
        return { bad };
      }, { IN_PAGE });

      expect(r.bad, JSON.stringify(r.bad.slice(0, 2))).toEqual([]);
      await closeApp(app);
    });
  });
}

test.describe('WH และตัวคุมขอบเขต', () => {
  test('WH warehouse PDA ต่อให้เปิดสวิตช์ → เท่าเดิม (Pass = pass + stock_adjustment · Progress ตัวเศษ = Confirm แล้ว) และไม่เข้าโหมดใหม่', async ({ browser }) => {
    const app = await bootBareMode(browser, 'pda');
    const r = await app.page.evaluate(({ IN_PAGE }) => {
      (0, eval)(IN_PAGE);
      __setup({ role: 'warehouse', branch: 'WH', user: 'W-A', countable: 20, offPlan: 0 });
      for (let i = 0; i < 3; i++) __scan(__cb(i));                   // scanning×3
      __setStatus(__sku(0), 'pass'); __setStatus(__sku(1), 'stock_adjustment'); __setStatus(__sku(2), 'audit');
      updateStats();
      return { cards: __cards(), on: _progressByScanOn() };
    }, { IN_PAGE });

    expect(r.on).toBe(false);
    expect(r.cards.pass).toBe('2');            // pass + stock_adjustment — WH ไม่ถูกแตะ
    expect(r.cards.progress).toBe('3 / 20');   // Confirm แล้ว 3 (pass · stock_adj · audit)
    await closeApp(app);
  });

  test('WH supervisor Desktop ต่อให้เปิดสวิตช์ → Progress ยังนับที่ Confirm แล้ว · สแกนล้วนไม่ขยับ', async ({ browser }) => {
    const app = await bootBareMode(browser, 'desktop');
    const r = await app.page.evaluate(({ IN_PAGE }) => {
      (0, eval)(IN_PAGE);
      __setup({ role: 'supervisor', branch: 'WH', user: 'Sup', countable: 20, offPlan: 0 });
      for (let i = 0; i < 4; i++) __scan(__cb(i));                   // scanning×4 (ยังไม่ Confirm)
      updateStats();
      const scanned = __cards();
      __setStatus(__sku(0), 'pass'); updateStats();
      return { scanned, confirmed: __cards(), on: _progressByScanOn() };
    }, { IN_PAGE });

    expect(r.on).toBe(false);
    expect(r.scanned.progress).toBe('0 / 20');   // สแกนแล้วยังไม่นับ (WH นับที่ Confirm)
    expect(r.confirmed.progress).toBe('1 / 20');
    await closeApp(app);
  });

  test('ทุกสาขายา (SRC/KKL/SSS) เข้าโหมดใหม่ · WH และยังไม่มีสาขา (ก่อน login) ไม่เข้า', async ({ browser }) => {
    const app = await bootBareMode(browser, 'desktop');
    const r = await app.page.evaluate(({ IN_PAGE }) => {
      (0, eval)(IN_PAGE);
      __setup({ role: 'assistant', branch: 'SRC', user: 'U-A', countable: 5, offPlan: 0 });
      const out = {};
      for (const b of ['SRC', 'KKL', 'SSS', 'WH', null]) { currentBranch = b; out[String(b)] = _progressByScanOn(); }
      return out;
    }, { IN_PAGE });

    expect(r).toEqual({ SRC: true, KKL: true, SSS: true, WH: false, null: false });
    await closeApp(app);
  });
});
