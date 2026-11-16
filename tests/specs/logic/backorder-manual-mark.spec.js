// ค้างส่ง "กดเอง" โดยไม่ต้องมีผลนับ (สาขายา · 16 พ.ย. 2026 · สวิตช์ BACKORDER_MANUAL_MARK · ผู้ใช้สั่ง "ต้องกดค้างส่งเอง เมื่อ R01 ติดลบ")
//
// กติกา: สินค้าชุดนับที่ R01 ติดลบและยังไม่สแกน (ทุกตัว ไม่ดู PBM) ขึ้นแท็บ 📦 ค้างส่ง เป็น ⏳ รอตัดสิน + ปุ่ม 📦 ค้างส่ง (เภสัช Desktop)
//   กด → {branch}_bomarks (transaction) → นับเป็นตัวเศษ Progress (ไม่นับ Pass) · ไม่อยู่ใน 📋 "ยังไม่ได้นับ" · ✕ ถอนได้
//   ไม่กด = งานนับปกติ (อยู่ใน 📋 · ไม่เข้าตัวเศษ) · มาร์คมีผลเฉพาะตอน pending + R01 ยังติดลบ · ไม่เขียน item/marker/ธง backorder
//
// เทสนี้ตรึง:
//   ① ค่าที่ส่งมอบ + ชุดผู้สมัคร (_negBackorderSkus ⊆ ชุดนับ · รวม SKU ใน PBM) + ยังไม่กด = เท่ากติกาเดิมก่อนมีค้างส่งอัตโนมัติ
//   ② แท็บ: แถว todo/bomark (ป้าย · ปุ่ม · ลำดับ · footer · badge · hint · PDA · กัน XSS)
//   ③ กด/ถอนผ่าน Firestore จำลอง: เอกสารที่เขียน · ตัวเศษ/📋/แท็บ · confirm · ไม่แตะ item
//   ④ สิทธิ์/ด่าน: ผู้ช่วย · PDA · WH · สแกนแล้ว · ไม่ติดลบ · ออฟไลน์ · กดซ้ำ · ไม่มีรอบนับ · สวิตช์
//   ⑤ ล้ม/atomic: transaction ล้ม · ไม่มี Cloud · รอบนับเปลี่ยนระหว่างบันทึก · doc ของรอบอื่นไม่ถูกรวม
//   ⑥ วงจร: สแกนแล้วนับครั้งเดียว · ✕ กลับมามีผล · R01 ≥ 0 ไม่มีผล · รอบ/สาขาอื่นไม่มีผล · ชุดมาร์คที่ไม่ใช่ผู้สมัครไม่เข้าตัวเศษ
//   ⑦ listener: snapshot ข้ามเครื่อง · ซ้ำไม่วาดใหม่ · รอบอื่น/ลบ doc · ไม่ฟังเมื่อ WH/ปิดสวิตช์ · stop
//   ⑧ ทางถอย: BACKORDER_MANUAL_MARK=false = โหมดอัตโนมัติเดิม · AUTO_BACKORDER_DEL=false = ไม่มีอะไร
const { test, expect, bootBare, closeApp } = require('../../lib/hooks');

const EPOCH = '2026-11-10T01:00:00.000Z';
// ── fixture สังเคราะห์ (ห้ามใช้ข้อมูลจริง) ──
//   ใน PBM:   P-NEG (−2 · pending) · P-POS (5 · pass) · P-ADJ (−4 · stock_adjustment)
//   นอก PBM:  O-NEG-A (−3) · O-NEG-B (−1 · nc:2 DELETE) · O-NEG-SCAN (−2 · scanning) · O-COUPON (−199 · nc:1) · O-POS (+4) · O-ZERO (0)
//   ชุดนับ = P-NEG P-POS P-ADJ O-NEG-A O-NEG-B O-NEG-SCAN O-POS (7) · ผู้สมัคร (ติดลบในชุดนับ) = P-ADJ P-NEG O-NEG-A O-NEG-B O-NEG-SCAN (5)
const R01 = [
  { colE: 'P-NEG', productName: 'ใน PBM ติดลบ', systemQty: -2 },
  { colE: 'P-POS', productName: 'ใน PBM ปกติ', systemQty: 5 },
  { colE: 'P-ADJ', productName: 'ใน PBM ติดลบ นับแล้วไม่ตรง', systemQty: -4 },
  { colE: 'O-NEG-A', productName: 'นอก PBM ติดลบ A', systemQty: -3 },
  { colE: 'O-NEG-B', productName: 'นอก PBM ติดลบ B (DELETE)', systemQty: -1, nc: 2 },
  { colE: 'O-NEG-SCAN', productName: 'นอก PBM ติดลบ สแกนแล้ว', systemQty: -2 },
  { colE: 'O-COUPON', productName: 'คูปอง (หมวด 11.)', systemQty: -199, nc: 1 },
  { colE: 'O-POS', productName: 'นอก PBM ยอดเป็นบวก', systemQty: 4 },
  { colE: 'O-ZERO', productName: 'นอก PBM ยอดศูนย์', systemQty: 0 },
];
const PBM_SKUS = ['P-NEG', 'P-POS', 'P-ADJ'];
const CANDIDATES = ['O-NEG-A', 'O-NEG-B', 'O-NEG-SCAN', 'P-ADJ', 'P-NEG'];

// สาขา/role + R01 + PBM แล้ว rebuildMaps เหมือน login จริง + Firestore จำลอง (doc().get/onSnapshot · runTransaction get/set)
//   __fail = ทำให้ transaction ล้ม · __hook = รันหลัง fn ก่อน commit · __txDelay = หน่วง transaction (ทดสอบกดซ้ำ) · __emit(path) = ส่ง snapshot ให้ listener
async function setup(page, { branch = 'SRC', role = 'pharmacist', manual = true, on = true, byScan = true, marks = null, r01 = R01, epoch = EPOCH } = {}) {
  await page.evaluate(({ branch, role, manual, on, byScan, marks, r01, epoch, EPOCH, PBM_SKUS }) => {
    currentBranch = branch; currentRole = role; currentUser = 'Pharm'; _countResetAt = epoch;
    AUTO_BACKORDER_DEL = on; PROGRESS_BY_SCAN = byScan; BACKORDER_MANUAL_MARK = manual;
    PHARMACY_BACKORDER_TAB = true; PHARMACIST_STOCKADJ_ONLY = false; PHARMACY_ADJ_ERP_CARD = false;
    Object.defineProperty(navigator, 'onLine', { get: () => true, configurable: true });
    Object.defineProperty(navigator, 'userAgent', { get: () => 'Mozilla/5.0 Chrome/120', configurable: true });
    state.r01Data = JSON.parse(JSON.stringify(r01));
    state.productMasterData = PBM_SKUS.map((sku) => ({ sku, productName: 'PBM ' + sku, unitPrice: 10 }));
    state.productMasterMap.clear(); state.productMasterData.forEach((r) => state.productMasterMap.set(r.sku, r.productName));
    state.r05Data = r01.map((r) => ({ barcode: 'BC-' + r.colE, colE: r.colE, unitName: 'EA', unitMultiplier: 1, unitPrice: 10 }));
    state.scanData.clear(); scanListMap.clear();
    rebuildMaps();
    const set = (sku, o) => Object.assign(state.scanData.get(sku), { countedQty: 0, scannedBy: 'Asst', timestamp: '2026-11-13 09:00:00', firstScanAt: '2026-11-13 09:00:00' }, o);
    set('O-NEG-SCAN', { status: 'scanning' });
    set('P-POS', { status: 'pass', countedQty: 5, auditStatus: 'approved' });
    set('P-ADJ', { status: 'stock_adjustment', countedQty: 0, directAdj: true, effectiveQty: 0, systemQty: -4, auditStatus: 'stock_adjustment', initialStatus: 'stock_adjustment' });

    // ── Firestore จำลอง ──
    window.__store = {}; window.__fail = null; window.__hook = null; window.__txDelay = 0; window.__txs = 0; window.__subs = []; window.__unsubs = 0;
    const ref = (p) => ({
      path: p,
      get: async () => { const d = window.__store[p]; return { exists: !!d, data: () => d }; },
      onSnapshot: (cb, err) => {
        const sub = { p, cb, err, dead: false }; window.__subs.push(sub);
        const d = window.__store[p]; cb({ exists: !!d, data: () => d });
        return () => { window.__unsubs++; sub.dead = true; };
      },
    });
    window.__emit = (p) => { const d = window.__store[p]; for (const s of window.__subs) if (s.p === p && !s.dead) s.cb({ exists: !!d, data: () => d }); };
    window.__fakeDb = {
      collection: (c) => ({ doc: (id) => ref(c + '/' + id) }),
      runTransaction: async (fn) => {
        window.__txs++;
        if (window.__txDelay) await new Promise((r) => setTimeout(r, window.__txDelay));
        if (window.__fail) throw new Error(window.__fail);
        let pending = null;
        await fn({ get: async (r) => { const d = window.__store[r.path]; return { exists: !!d, data: () => d }; }, set: (r, data) => { pending = [r.path, data]; } });
        if (window.__hook) await window.__hook();
        if (pending) window.__store[pending[0]] = { ...pending[1] };
      },
    };
    _db = window.__fakeDb;
    window.__toasts = []; toast = (m, t) => { window.__toasts.push(`${t || 'info'}|${m}`); };
    window.__confirms = []; window.__confirmAns = true; window.confirm = (m) => { window.__confirms.push(m); return window.__confirmAns; };
    window.__dirty = 0; if (!window.__origDirty) window.__origDirty = _markSkuDirty; _markSkuDirty = (...a) => { window.__dirty++; return window.__origDirty(...a); };

    // ชุดมาร์คเริ่มต้น (ในเครื่อง — ไม่ผ่าน Cloud)
    _boMarks = new Map(); _boMarksEpoch = ''; _boMarksBranch = ''; _boMarksSig = '';
    if (marks) _boSetMarks(branch, EPOCH, Object.fromEntries(marks.map((s) => [s, { by: 'X', at: '2026-11-14T03:05:00.000Z', g: -1 }])));
    _avFilter = 'audit';
    applyAuditTerminology();
    updateStats(); invalidatePopupRowsCache();
  }, { branch, role, manual, on, byScan, marks, r01, epoch, EPOCH, PBM_SKUS });
}

const progress = (page) => page.evaluate(() => {
  const [num, denom] = document.getElementById('progressCount').textContent.split(' / ').map(Number);
  return { num, denom, counted: Number(document.getElementById('statCounted').textContent), pass: Number(document.getElementById('statPass').textContent), total: Number(document.getElementById('statTotal').textContent) };
});
const pendingRows = (page) => page.evaluate(() => { invalidatePopupRowsCache(); popupFilterState = 'pending'; popupStaffFilter = 'all'; return getFilteredPopupRows().map((r) => r.sku).sort(); });
const tabRows = (page) => page.evaluate(() => { renderAuditVerifyTable(); return {
  rows: [...document.querySelectorAll('#auditVerifyTableBody tr')].map((tr) => [...tr.children].map((td) => td.textContent.replace(/\s+/g, ' ').trim())),
  buttons: [...document.querySelectorAll('#auditVerifyTableBody tr')].map((tr) => [...tr.querySelectorAll('button')].map((b) => b.getAttribute('onclick'))),
  footer: document.getElementById('auditVerifyRowCount').textContent, badge: document.getElementById('avCountAudit').textContent,
  hint: getComputedStyle(document.getElementById('avBackorderHint')).display !== 'none' ? document.getElementById('avBackorderHint').textContent : null,
}; });
const store = (page, branch = 'SRC') => page.evaluate((b) => { const d = window.__store[`stock_sessions/${b}_bomarks`]; return d ? { epoch: d.countResetAt, marks: JSON.parse(d.marks_json), by: d.updatedBy } : null; }, branch);
const toasts = (page) => page.evaluate(() => window.__toasts.slice());
const invariants = async (page) => {
  const p = await progress(page); const rows = await pendingRows(page);
  expect(p.pass, 'Pass ≤ Counted').toBeLessThanOrEqual(p.counted);
  expect(p.counted, 'Counted ≤ Total').toBeLessThanOrEqual(p.total);
  expect(p.num).toBe(p.counted);
  expect(rows.length, '📋 ยังไม่ได้นับ = ตัวหาร − ตัวเศษ').toBe(p.denom - p.num);
  return p;
};

test('① ค่าที่ส่งมอบ: โหมดกดเองเปิด · ผู้สมัคร = ชุดนับ ∩ R01<0 (รวมใน PBM) · ⊆ ชุดนับ · ยังไม่กด = เท่ากติกาเดิม', async ({ browser }) => {
  const app = await bootBare(browser);
  const d = await app.page.evaluate(() => ({ manual: BACKORDER_MANUAL_MARK, auto: AUTO_BACKORDER_DEL, fns: ['_boManualOn', '_boActiveMarks', '_boMarksSave', 'markBackorderManual', 'unmarkBackorderManual', 'startBoMarksListener', 'stopBoMarksListener', '_canBoMark', '_boFmtAt'].map((f) => typeof window[f]), hint: typeof AV_BACKORDER_HINT_MANUAL }));
  expect(d).toEqual({ manual: true, auto: true, fns: Array(9).fill('function'), hint: 'string' });

  await setup(app.page);
  const g = await app.page.evaluate(() => ({ neg: [..._negBackorderSkus].sort(), countable: [..._countableSkus].sort(), total: _cachedTotalSku }));
  expect(g.neg).toEqual(CANDIDATES);                                          // รวม SKU ใน PBM (P-NEG · P-ADJ) · ไม่รวมคูปอง/ยอดบวก/ศูนย์
  expect(g.neg.every((s) => g.countable.includes(s))).toBe(true);             // ⊆ ชุดนับ → ตัวเศษไม่เกินตัวหาร
  expect(g.neg).not.toContain('O-COUPON');
  for (const s of ['P-POS', 'O-POS', 'O-ZERO']) expect(g.neg, s).not.toContain(s);

  // ยังไม่กดสักตัว: ไม่มีใครถูกปิดงานเป็นค้างส่ง → ตัวเศษ/📋 เท่ากติกาเดิมก่อนมีค้างส่งอัตโนมัติ (3 / 7)
  expect(await app.page.evaluate(() => [..._negBackorderSkus].filter((s) => _isAutoBackorder(s, state.scanData.get(s))))).toEqual([]);
  expect(await invariants(app.page)).toEqual({ num: 3, denom: 7, counted: 3, pass: 1, total: 7 });
  expect(await pendingRows(app.page)).toEqual(['O-NEG-A', 'O-NEG-B', 'O-POS', 'P-NEG']);   // ต้องไปนับตามปกติ
  await closeApp(app);
});

test('② แท็บ 📦 ค้างส่ง: แถว ⏳ รอตัดสิน (ปุ่ม) · 📦 มาร์คแล้ว (✕ ถอน) · ลำดับ · footer · badge · hint · PDA · กัน XSS', async ({ browser }) => {
  const app = await bootBare(browser);
  await setup(app.page);
  let v = await tabRows(app.page);
  // desktop: [#, SKU, Barcode, Name, ระบบ, นับได้, สถานะ, เวลานับ, ค้างส่ง]
  expect(v.rows.map((r) => r[1])).toEqual(['P-ADJ', 'O-NEG-A', 'O-NEG-B', 'P-NEG']);   // Stock Adj ก่อน · ⏳ รอตัดสิน (ทั้งนอก/ใน PBM) ตามหลังเรียงตาม SKU
  expect(v.rows[0][6]).toContain('Stock Adj');
  for (const [i, sys] of [[1, '-3'], [2, '-1'], [3, '-2']]) {
    const row = v.rows[i];
    expect(row[4]).toBe(sys);                                    // ระบบ (R01) ติดลบ
    expect(row[5]).toBe('—');                                    // ยังไม่สแกน = ไม่มียอดนับ
    expect(row[6]).toContain('รอตัดสิน');
    expect(row[7]).toBe('—');
  }
  expect(v.buttons).toEqual([["markBackorderFromAdj('P-ADJ')"], ["markBackorderManual('O-NEG-A')"], ["markBackorderManual('O-NEG-B')"], ["markBackorderManual('P-NEG')"]]);
  expect(v.footer).toBe('4 รายการ ค้างส่ง · รอตัดสิน 3');
  expect(v.badge).toBe('4');
  expect(v.hint).toContain('รอตัดสิน'); expect(v.hint).toContain('กด 📦 ค้างส่ง'); expect(v.hint).not.toContain('อัตโนมัติ');
  for (const s of ['O-COUPON', 'O-POS', 'O-ZERO', 'O-NEG-SCAN', 'P-POS']) expect(v.rows.map((r) => r[1]), s).not.toContain(s);   // สแกนแล้ว/ไม่ติดลบ/คูปอง ไม่ใช่งานของแท็บนี้

  // มาร์คแล้ว: ป้าย · ✕ ถอน · เวลากด · ลำดับท้ายสุด
  await setup(app.page, { marks: ['P-NEG', 'O-NEG-A'] });
  v = await tabRows(app.page);
  expect(v.rows.map((r) => r[1])).toEqual(['P-ADJ', 'O-NEG-B', 'O-NEG-A', 'P-NEG']);   // todo ก่อน · มาร์คแล้วตามหลัง
  expect(v.rows[1][6]).toContain('รอตัดสิน');
  for (const i of [2, 3]) { expect(v.rows[i][6]).toContain('มาร์คแล้ว'); expect(v.rows[i][5]).toBe('—'); expect(v.rows[i][7]).toMatch(/^\d{2}\/\d{2} \d{2}:\d{2}$/); }
  expect(v.buttons).toEqual([["markBackorderFromAdj('P-ADJ')"], ["markBackorderManual('O-NEG-B')"], ["unmarkBackorderManual('O-NEG-A')"], ["unmarkBackorderManual('P-NEG')"]]);
  expect(v.footer).toBe('4 รายการ ค้างส่ง · รอตัดสิน 1');

  // ไม่มีรายการรอตัดสินเลย → footer ไม่ต่อท้าย
  await setup(app.page, { marks: ['P-NEG', 'O-NEG-A', 'O-NEG-B'] });
  expect((await tabRows(app.page)).footer).toBe('4 รายการ ค้างส่ง');

  // เภสัชบน PDA (UA) → ไม่มีปุ่มกด/ถอนเลย (เภสัชทำที่ Desktop เท่านั้น) · ผู้ช่วย → ไม่มีคอลัมน์/ปุ่ม
  await setup(app.page, { marks: ['P-NEG'] });
  const pdaBtn = await app.page.evaluate(() => { Object.defineProperty(navigator, 'userAgent', { get: () => 'Mozilla/5.0 StockCountPDA/1.11', configurable: true }); renderAuditVerifyTable(); return [...document.querySelectorAll('#auditVerifyTableBody button')].map((x) => x.getAttribute('onclick')); });
  expect(pdaBtn).toEqual([]);
  await setup(app.page, { role: 'assistant', marks: ['P-NEG'] });
  const asst = await tabRows(app.page);
  expect(asst.buttons.flat()).toEqual([]); expect(asst.rows[0].length).toBe(8);

  // แท็บอ่านยอดดิบซ้ำอีกชั้น: ยอดดิบกับชุดผู้สมัครไม่ตรงกัน (ไม่ควรเกิด) → ไม่ลิสต์แถวที่ไม่ติดลบ
  await setup(app.page);
  await app.page.evaluate(() => _r01RawQty.set('O-NEG-A', 2));
  expect((await tabRows(app.page)).rows.map((r) => r[1])).toEqual(['P-ADJ', 'O-NEG-B', 'P-NEG']);

  // จอแคบ (PDA ขนาดจอ): ตารางย่อ [SKU, Name, ระบบ, ค้างส่ง] ยังขึ้นแถว · ไม่มี hint
  await setup(app.page);
  await app.page.setViewportSize({ width: 390, height: 700 });
  const pda = await tabRows(app.page);
  expect(pda.rows.map((r) => r[0])).toEqual(['P-ADJ', 'O-NEG-A', 'O-NEG-B', 'P-NEG']);
  expect(pda.hint).toBeNull();
  await app.page.setViewportSize({ width: 1280, height: 800 });

  // ชื่อผู้กดมาจากข้อมูลบน Cloud → ต้อง escape (ใส่ใน title ของช่องเวลา)
  await setup(app.page);
  const html = await app.page.evaluate(() => {
    _boSetMarks('SRC', '2026-11-10T01:00:00.000Z', { 'P-NEG': { by: '"><img src=x onerror=alert(1)>', at: '2026-11-14T03:05:00.000Z', g: -2 } });
    renderAuditVerifyTable(); return document.getElementById('auditVerifyTableBody').innerHTML;
  });
  expect(html).not.toContain('<img'); expect(html).toContain('&lt;img');

  // _boFmtAt: ISO → DD/MM HH:mm (ท้องถิ่น) · อ่านไม่ได้ = —
  expect(await app.page.evaluate(() => [_boFmtAt(''), _boFmtAt('ขยะ'), _boFmtAt(null), /^\d{2}\/\d{2} \d{2}:\d{2}$/.test(_boFmtAt('2026-11-14T03:05:00.000Z'))])).toEqual(['—', '—', '—', true]);
  await closeApp(app);
});

test('③ กด 📦 ค้างส่ง: เขียน {branch}_bomarks · ตัวเศษ +1 · ออกจาก 📋 · Pass ไม่ขยับ · ไม่แตะ item · ถอนได้ · สองตัวรวมกัน', async ({ browser }) => {
  const app = await bootBare(browser);
  await setup(app.page);
  const base = await invariants(app.page);
  expect(base).toEqual({ num: 3, denom: 7, counted: 3, pass: 1, total: 7 });

  // ผู้ใช้ไม่ยืนยัน = ไม่เกิดอะไรขึ้นเลย
  await app.page.evaluate(() => { window.__confirmAns = false; return markBackorderManual('P-NEG'); });
  expect(await app.page.evaluate(() => [window.__txs, _boMarks.size, window.__confirms.length])).toEqual([0, 0, 1]);

  // กด P-NEG (อยู่ใน PBM) → cloud + ตัวเศษ
  await app.page.evaluate(() => { window.__confirmAns = true; window.__confirms.length = 0; return markBackorderManual('P-NEG'); });
  const c1 = await store(app.page);
  expect(c1.epoch).toBe(EPOCH); expect(Object.keys(c1.marks)).toEqual(['P-NEG']); expect(c1.by).toBe('Pharm');
  expect(c1.marks['P-NEG']).toMatchObject({ by: 'Pharm', g: -2 }); expect(new Date(c1.marks['P-NEG'].at).toString()).not.toBe('Invalid Date');
  const msg = await app.page.evaluate(() => window.__confirms[0]);
  expect(msg).toContain('P-NEG'); expect(msg).toContain('ยอดระบบ -2'); expect(msg).toContain('ไม่ออกใบปรับสต็อก');
  expect(await invariants(app.page)).toEqual({ num: 4, denom: 7, counted: 4, pass: 1, total: 7 });   // +1 · Pass ไม่ขยับ
  expect(await pendingRows(app.page)).toEqual(['O-NEG-A', 'O-NEG-B', 'O-POS']);                       // P-NEG ออกจาก 📋
  expect((await toasts(app.page)).at(-1)).toBe('success|P-NEG: มาร์คค้างส่งแล้ว');
  // ตารางแท็บถูกวาดใหม่เองทันทีหลังกด (ไม่ต้องรอใครเรียก render) — อ่าน DOM ตรงๆ ไม่ผ่านตัวช่วย tabRows ที่วาดเอง
  const dom = await app.page.evaluate(() => [...document.querySelectorAll('#auditVerifyTableBody tr')].map((tr) => (tr.children[1]?.textContent.trim() || '') + '|' + (tr.children[6]?.textContent || '').trim()));
  expect(dom.find((r) => r.startsWith('P-NEG|'))).toContain('มาร์คแล้ว');

  // กดตัวที่สอง (นอก PBM) → transaction อ่านของเดิมแล้วรวม ไม่ทับ
  await app.page.evaluate(() => markBackorderManual('O-NEG-A'));
  expect(Object.keys((await store(app.page)).marks).sort()).toEqual(['O-NEG-A', 'P-NEG']);
  expect(await invariants(app.page)).toEqual({ num: 5, denom: 7, counted: 5, pass: 1, total: 7 });
  const v = await tabRows(app.page);
  expect(v.rows.map((r) => r[1])).toEqual(['P-ADJ', 'O-NEG-B', 'O-NEG-A', 'P-NEG']);

  // กดซ้ำตัวที่มาร์คแล้ว = ไม่ทำอะไร (ไม่ถาม ไม่เขียน)
  const txs = await app.page.evaluate(async () => { window.__confirms.length = 0; const t = window.__txs; await markBackorderManual('P-NEG'); return [window.__txs - t, window.__confirms.length]; });
  expect(txs).toEqual([0, 0]);

  // ไม่แตะ item: ไม่มีสถานะ/ธง/การ mark dirty — คนละรางกับมาร์คที่ผ่านการสแกน
  const w = await app.page.evaluate(() => ({ dirty: window.__dirty, sd: ['P-NEG', 'O-NEG-A'].map((s) => { const d = state.scanData.get(s); return [d.status, d.backorder ?? null, d.recheckQty ?? null]; }), docs: Object.keys(window.__store) }));
  expect(w.dirty).toBe(0);
  expect(w.sd).toEqual([['pending', null, null], ['pending', null, null]]);
  expect(w.docs).toEqual(['stock_sessions/SRC_bomarks']);                      // เขียนแค่เอกสารเดียวนี้

  // ถอน P-NEG → ตัวเศษลด · กลับไปอยู่ใน 📋
  await app.page.evaluate(() => unmarkBackorderManual('P-NEG'));
  expect(Object.keys((await store(app.page)).marks)).toEqual(['O-NEG-A']);
  expect(await invariants(app.page)).toEqual({ num: 4, denom: 7, counted: 4, pass: 1, total: 7 });
  expect(await pendingRows(app.page)).toEqual(['O-NEG-B', 'O-POS', 'P-NEG']);
  expect((await toasts(app.page)).at(-1)).toBe('info|P-NEG: ถอนค้างส่งแล้ว');

  // สาขาอื่นของสาขายาใช้เอกสารของตัวเอง
  await setup(app.page, { branch: 'KKL' });
  await app.page.evaluate(() => markBackorderManual('O-NEG-B'));
  expect(Object.keys((await store(app.page, 'KKL')).marks)).toEqual(['O-NEG-B']);
  expect(await store(app.page, 'SRC')).toBeNull();
  await closeApp(app);
});

test('④ สิทธิ์/ด่าน: ผู้ช่วย · PDA · WH · สแกนแล้ว · ไม่ติดลบ · ออฟไลน์ · กดซ้ำขณะบันทึก · ไม่มีรอบนับ · สวิตช์', async ({ browser }) => {
  const app = await bootBare(browser);
  const tryMark = (sku) => app.page.evaluate(async (s) => { window.__toasts.length = 0; const t = window.__txs; await markBackorderManual(s); return { txs: window.__txs - t, marks: _boMarks.size, toast: window.__toasts.at(-1) || null }; }, sku);
  const REJECT = { txs: 0, marks: 0, toast: 'warn|รายการนี้มาร์คค้างส่งไม่ได้' };

  await setup(app.page);
  // เฉพาะผู้สมัครที่ยังไม่สแกนเท่านั้น
  expect(await app.page.evaluate(() => ['P-NEG', 'O-NEG-A', 'O-NEG-B', 'O-NEG-SCAN', 'P-ADJ', 'O-POS', 'O-ZERO', 'O-COUPON', 'P-POS', 'NO-SUCH'].map((s) => _canBoMark(s))))
    .toEqual([true, true, true, false, false, false, false, false, false, false]);   // สแกนแล้ว · Stock Adj · ยอดบวก/ศูนย์ · คูปอง · Pass · ไม่มีใน R01
  for (const s of ['O-NEG-SCAN', 'P-ADJ', 'O-POS', 'O-COUPON', 'NO-SUCH']) expect(await tryMark(s), s).toEqual(REJECT);

  // ผู้ช่วย · PDA (UA) · เภสัชแต่ไม่ใช่สาขายา · WH
  await setup(app.page, { role: 'assistant' });
  expect(await tryMark('P-NEG')).toEqual(REJECT);
  await setup(app.page);
  await app.page.evaluate(() => Object.defineProperty(navigator, 'userAgent', { get: () => 'Mozilla/5.0 StockCountPDA/1.11', configurable: true }));
  expect(await tryMark('P-NEG')).toEqual(REJECT);
  expect(await app.page.evaluate(async () => { await unmarkBackorderManual('P-NEG'); return window.__toasts.at(-1); })).toBe('warn|ถอนค้างส่งไม่ได้');
  await setup(app.page, { branch: 'WH', role: 'supervisor' });
  expect(await app.page.evaluate(() => [_boManualOn(), _canBoMark('P-NEG')])).toEqual([false, false]);
  expect(await tryMark('P-NEG')).toEqual(REJECT);

  // สวิตช์: ปิดโหมดกดเอง · ปิดทั้งชุด · ปิด PROGRESS_BY_SCAN (ผูกกัน — ตัวเศษแบบ Confirm ไม่นับมาร์ค)
  for (const o of [{ manual: false }, { on: false }, { byScan: false }]) { await setup(app.page, o); expect(await tryMark('P-NEG'), JSON.stringify(o)).toEqual(REJECT); }

  // ออฟไลน์ = ไม่เขียน
  await setup(app.page);
  const off = await app.page.evaluate(async () => { Object.defineProperty(navigator, 'onLine', { get: () => false, configurable: true }); await markBackorderManual('P-NEG'); return [window.__txs, window.__confirms.length, window.__toasts.at(-1)]; });
  expect(off).toEqual([0, 0, 'error|ต้องออนไลน์เพื่อมาร์คค้างส่ง']);

  // ยังไม่มีรอบนับ = ไม่เขียน (ไม่มีอะไรให้ผูก)
  await setup(app.page);
  const noEpoch = await app.page.evaluate(async () => { _countResetAt = ''; await markBackorderManual('P-NEG'); return [window.__txs, _boMarks.size, window.__toasts.at(-1)]; });
  expect(noEpoch[0]).toBe(0); expect(noEpoch[1]).toBe(0); expect(noEpoch[2]).toBe('error|มาร์คค้างส่งไม่สำเร็จ: ยังไม่มีรอบนับ');

  // กดซ้ำขณะกำลังบันทึก = ทำครั้งเดียว
  await setup(app.page);
  const dbl = await app.page.evaluate(async () => { window.__txDelay = 60; await Promise.all([markBackorderManual('P-NEG'), markBackorderManual('P-NEG')]); return [window.__txs, window.__confirms.length, _boMarks.size]; });
  expect(dbl).toEqual([1, 1, 1]);
  await closeApp(app);
});

test('⑤ ล้ม/atomic: transaction ล้ม · ไม่มี Cloud · รอบนับเปลี่ยนระหว่างบันทึก → ไม่เปลี่ยนในเครื่อง · doc ของรอบอื่นไม่ถูกรวม', async ({ browser }) => {
  const app = await bootBare(browser);
  await setup(app.page);
  const base = await progress(app.page);
  const act = (fn) => app.page.evaluate(async (src) => { window.__toasts.length = 0; await (new Function('return ' + src))()(); return { marks: _boMarks.size, toast: window.__toasts.at(-1) || null, txs: window.__txs }; }, fn.toString());

  // transaction ล้ม → toast ผิดพลาด · ในเครื่องไม่เปลี่ยน · ตัวเศษเท่าเดิม · ไม่มี doc
  const r1 = await act(async () => { window.__fail = 'unavailable'; await markBackorderManual('P-NEG'); window.__fail = null; });
  expect(r1.marks).toBe(0); expect(r1.toast).toBe('error|มาร์คค้างส่งไม่สำเร็จ: unavailable');
  expect(await progress(app.page)).toEqual(base);
  expect(await store(app.page)).toBeNull();
  // กดใหม่หลังกลับมาออนไลน์ ได้ตามปกติ (ไม่ค้างสถานะ busy)
  await app.page.evaluate(() => markBackorderManual('P-NEG'));
  expect((await store(app.page)).marks['P-NEG']).toBeTruthy();

  // ไม่มี Cloud
  await setup(app.page);
  const r2 = await act(async () => { _db = null; await markBackorderManual('P-NEG'); });
  expect(r2.marks).toBe(0); expect(r2.toast).toBe('error|มาร์คค้างส่งไม่สำเร็จ: ไม่ได้เชื่อมต่อ Cloud');

  // ถอนแล้วล้ม → ยังมาร์คอยู่ (ไม่ถอนครึ่งๆ กลางๆ)
  await setup(app.page, { marks: ['P-NEG'] });
  const r3 = await act(async () => { window.__fail = 'unavailable'; await unmarkBackorderManual('P-NEG'); window.__fail = null; });
  expect(r3.marks).toBe(1); expect(r3.toast).toBe('error|ถอนค้างส่งไม่สำเร็จ: unavailable');

  // รอบนับเปลี่ยนระหว่างบันทึก (เครื่องอื่นกด "เริ่มนับใหม่") → ไม่เปลี่ยนในเครื่อง + บอก
  await setup(app.page);
  const r4 = await act(async () => { window.__hook = async () => { _countResetAt = '2026-11-11T02:00:00.000Z'; }; await markBackorderManual('P-NEG'); window.__hook = null; });
  expect(r4.marks).toBe(0); expect(r4.toast).toBe('error|มาร์คค้างส่งไม่สำเร็จ: สาขา/รอบนับเปลี่ยนระหว่างบันทึก');

  // doc ค้างจากรอบเก่า: ต้องไม่ถูกรวมเข้าชุดของรอบนี้ (ไม่งั้น SKU เก่าถูกปลอมเป็นมาร์คของรอบนี้)
  await setup(app.page);
  await app.page.evaluate(() => { window.__store['stock_sessions/SRC_bomarks'] = { countResetAt: '2026-10-01T00:00:00.000Z', marks_json: JSON.stringify({ 'O-NEG-B': { by: 'old', at: '2026-10-02T00:00:00.000Z', g: -1 } }) }; });
  await app.page.evaluate(() => markBackorderManual('P-NEG'));
  const d = await store(app.page);
  expect(d.epoch).toBe(EPOCH); expect(Object.keys(d.marks)).toEqual(['P-NEG']);
  await closeApp(app);
});

test('⑥ วงจร: สแกนแล้วนับครั้งเดียว · ✕ กลับมามีผล · R01 ≥ 0 ไม่มีผล · รอบ/สาขาอื่นไม่มีผล · ชุดมาร์คที่ไม่ใช่ผู้สมัครไม่เข้าตัวเศษ', async ({ browser }) => {
  const app = await bootBare(browser);
  // มาร์ค P-NEG · O-NEG-A + ขยะ 2 ตัว (ยอดบวก · คูปอง) ที่ไม่ใช่ผู้สมัคร → ต้องไม่เข้าตัวเศษ (ตัวเศษ ⊆ ตัวหารเสมอ)
  await setup(app.page, { marks: ['P-NEG', 'O-NEG-A', 'O-POS', 'O-COUPON'] });
  const base = await invariants(app.page);
  expect(base).toEqual({ num: 5, denom: 7, counted: 5, pass: 1, total: 7 });
  const grp = () => app.page.evaluate(() => [..._negBackorderSkus].filter((s) => _isAutoBackorder(s, state.scanData.get(s))).sort());
  expect(await grp()).toEqual(['O-NEG-A', 'P-NEG']);

  // เส้นทางเบา (หลังสแกน) ได้ตัวเลขเดียวกับ updateStats เต็ม
  const light = await app.page.evaluate(() => { _writeScanProgress(); const [n, d] = document.getElementById('progressCount').textContent.split(' / ').map(Number); return { n, d, ...(_scanProgressCounts()) }; });
  expect(light).toEqual({ n: 5, d: 7, scanned: 5, pass: 1 });

  // สแกน P-NEG: ออกจากกลุ่ม · ตัวเศษไม่ขยับ (นับผ่านเส้นทางสแกนแทน — ห้ามนับซ้ำสองทาง) · แท็บไม่ลิสต์ในฐานะมาร์คแล้ว
  await app.page.evaluate(() => { Object.assign(state.scanData.get('P-NEG'), { status: 'scanning', countedQty: 0 }); updateStats(); });
  expect(await grp()).toEqual(['O-NEG-A']);
  expect(await progress(app.page)).toEqual(base);
  expect((await tabRows(app.page)).rows.map((r) => r[1])).toEqual(['P-ADJ', 'O-NEG-B', 'O-NEG-A']);
  // Confirm แล้ว (Stock Adj ตามสูตร) ก็ยังนับครั้งเดียว · Pass ไม่เพิ่มจากการ Stock Adj
  await app.page.evaluate(() => { Object.assign(state.scanData.get('P-NEG'), { status: 'stock_adjustment', directAdj: true }); updateStats(); });
  expect(await progress(app.page)).toEqual(base);
  // ✕ ลบการสแกน → pending → มาร์คกลับมามีผล (ยังอยู่ใน doc)
  await app.page.evaluate(() => { Object.assign(state.scanData.get('P-NEG'), { status: 'pending', countedQty: 0, directAdj: undefined }); updateStats(); });
  expect(await grp()).toEqual(['O-NEG-A', 'P-NEG']);
  expect(await invariants(app.page)).toEqual(base);

  // เช้าวันใหม่: R01 ใหม่ — O-NEG-A กลับเป็นบวก (ใบรับของเข้าแล้ว) → ไม่มีผล · กลับเป็นงานนับปกติ (ยังอยู่ในชุดนับเพราะ G ≠ 0)
  await app.page.evaluate(() => { state.r01Data.find((r) => r.colE === 'O-NEG-A').systemQty = 2; _rebuildCountableSkus(); updateStats(); invalidatePopupRowsCache(); });
  expect(await grp()).toEqual(['P-NEG']);
  const p2 = await invariants(app.page);
  expect(p2.num).toBe(4);
  expect(await pendingRows(app.page)).toContain('O-NEG-A');
  expect((await tabRows(app.page)).rows.map((r) => r[1])).not.toContain('O-NEG-A');
  // ติดลบอีกครั้งในรอบเดียวกัน: มาร์คเดิมกลับมามีผลเอง (ข้อจำกัดที่ยอมรับ v1 — ไม่มีการเขียนตอนออก จึงไม่ล้างให้)
  await app.page.evaluate(() => { state.r01Data.find((r) => r.colE === 'O-NEG-A').systemQty = -5; _rebuildCountableSkus(); updateStats(); });
  expect(await grp()).toEqual(['O-NEG-A', 'P-NEG']);

  // รอบนับใหม่ (doc ผูกรอบเก่า) · สาขาอื่น = ไม่มีผล
  await app.page.evaluate(() => { _countResetAt = '2026-11-12T00:00:00.000Z'; updateStats(); invalidatePopupRowsCache(); });
  expect(await grp()).toEqual([]);
  expect(await invariants(app.page)).toEqual({ num: 3, denom: 7, counted: 3, pass: 1, total: 7 });
  await app.page.evaluate(() => { _countResetAt = '2026-11-10T01:00:00.000Z'; currentBranch = 'KKL'; });
  expect(await app.page.evaluate(() => _boActiveMarks().size)).toBe(0);
  await closeApp(app);
});

test('⑦ listener: snapshot ข้ามเครื่อง · ซ้ำไม่วาดใหม่ · รอบอื่น/ลบ doc · ไม่ฟังเมื่อ WH/ปิดสวิตช์ · stop', async ({ browser }) => {
  const app = await bootBare(browser);
  const KEY = 'stock_sessions/SRC_bomarks';
  const putDoc = (marks, epoch = EPOCH) => app.page.evaluate(({ KEY, marks, epoch }) => {
    window.__store[KEY] = { countResetAt: epoch, marks_json: JSON.stringify(Object.fromEntries(marks.map((s) => [s, { by: 'Other', at: '2026-11-14T03:05:00.000Z', g: -1 }]))) };
    window.__emit(KEY);
  }, { KEY, marks, epoch });
  const spy = () => app.page.evaluate(() => { window.__changed = 0; if (!window.__origChanged) window.__origChanged = _boMarksChanged; _boMarksChanged = () => { window.__changed++; return window.__origChanged(); }; });
  const changed = () => app.page.evaluate(() => window.__changed);

  // เริ่มฟัง: doc มีอยู่แล้ว (เภสัชเครื่องอื่นกดไว้ก่อนเราล็อกอิน) → ตัวเศษขึ้นเองหลัง snapshot แรก
  await setup(app.page);
  await app.page.evaluate((KEY) => { window.__store[KEY] = { countResetAt: '2026-11-10T01:00:00.000Z', marks_json: JSON.stringify({ 'P-NEG': { by: 'Other', at: '2026-11-14T03:05:00.000Z', g: -2 } }) }; }, KEY);
  await spy();
  await app.page.evaluate(() => startBoMarksListener());
  expect(await app.page.evaluate(() => window.__subs.filter((s) => !s.dead).length)).toBe(1);
  expect(await invariants(app.page)).toEqual({ num: 4, denom: 7, counted: 4, pass: 1, total: 7 });
  expect(await changed()).toBe(1);

  // เครื่องอื่นกดเพิ่ม → ขยับเอง (ไม่ต้องเปิดป็อปอัพ/ล็อกอินใหม่)
  await putDoc(['P-NEG', 'O-NEG-A']);
  expect(await invariants(app.page)).toEqual({ num: 5, denom: 7, counted: 5, pass: 1, total: 7 });
  expect((await tabRows(app.page)).rows.map((r) => r[1])).toEqual(['P-ADJ', 'O-NEG-B', 'O-NEG-A', 'P-NEG']);
  // snapshot ซ้ำ (echo ของการเขียนตัวเอง/ไม่มีอะไรเปลี่ยน) = ไม่วาดใหม่
  const before = await changed();
  await putDoc(['P-NEG', 'O-NEG-A']);
  expect(await changed()).toBe(before);

  // doc ของรอบนับอื่น = ไม่ใช่ของรอบนี้
  await putDoc(['P-NEG', 'O-NEG-A'], '2026-10-01T00:00:00.000Z');
  expect(await invariants(app.page)).toEqual({ num: 3, denom: 7, counted: 3, pass: 1, total: 7 });
  // กลับเป็นรอบนี้แล้วถูกลบทั้ง doc → ว่าง
  await putDoc(['O-NEG-B']);
  expect((await progress(app.page)).num).toBe(4);
  await app.page.evaluate((KEY) => { delete window.__store[KEY]; window.__emit(KEY); }, KEY);
  expect(await invariants(app.page)).toEqual({ num: 3, denom: 7, counted: 3, pass: 1, total: 7 });

  // snapshot ที่มาช้าหลังสลับสาขา → ทิ้ง
  const late = await app.page.evaluate((KEY) => { currentBranch = 'KKL'; window.__store[KEY] = { countResetAt: '2026-11-10T01:00:00.000Z', marks_json: JSON.stringify({ 'P-NEG': { by: 'o', at: '', g: -2 } }) }; const n = _boMarks.size; window.__emit(KEY); currentBranch = 'SRC'; return [n, _boMarks.size]; }, KEY);
  expect(late).toEqual([0, 0]);

  // stop = ปล่อย listener · ฟังซ้ำไม่ซ้อน
  await app.page.evaluate(() => { startBoMarksListener(); startBoMarksListener(); });
  expect(await app.page.evaluate(() => window.__subs.filter((s) => !s.dead).length)).toBe(1);
  await app.page.evaluate(() => stopBoMarksListener());
  expect(await app.page.evaluate(() => [window.__subs.filter((s) => !s.dead).length, _boMarksUnsub])).toEqual([0, null]);

  // ไม่ฟังเมื่อ WH / ปิดโหมดกดเอง / ปิดทั้งชุด / ไม่มี Cloud
  for (const o of [{ branch: 'WH', role: 'supervisor' }, { manual: false }, { on: false }, { byScan: false }]) {
    await setup(app.page, o); await app.page.evaluate(() => startBoMarksListener());
    expect(await app.page.evaluate(() => window.__subs.length), JSON.stringify(o)).toBe(0);
  }
  await setup(app.page); await app.page.evaluate(() => { _db = null; startBoMarksListener(); });
  expect(await app.page.evaluate(() => _boMarksUnsub)).toBeNull();

  // การเขียนของเครื่องนี้ + echo จาก listener: ไม่วาดซ้ำ (sig เท่ากัน)
  await setup(app.page); await spy();
  await app.page.evaluate(() => { window.__us = 0; const o = updateStats; updateStats = (...a) => { window.__us++; return o(...a); }; startBoMarksListener(); });
  // doc ยังไม่มี (กรณีปกติของทุกเครื่องที่ไม่มีใครกดค้างส่ง) → snapshot แรกไม่เปลี่ยนอะไร: ไม่วาดจอใหม่ ไม่เรียก updateStats (ไม่กวาด catalog ตอนล็อกอินเปล่าๆ · เคยหลุดทำให้ progress-by-scan A ล้ม)
  expect(await changed()).toBe(0);
  expect(await app.page.evaluate(() => window.__us)).toBe(0);
  await app.page.evaluate(async () => { await markBackorderManual('P-NEG'); });
  const afterOwn = await changed();
  expect(afterOwn).toBe(1);
  await app.page.evaluate(() => window.__emit('stock_sessions/SRC_bomarks'));
  expect(await changed()).toBe(afterOwn);
  await closeApp(app);
});

test('⑧ ทางถอย: BACKORDER_MANUAL_MARK=false = โหมดอัตโนมัติเดิม · มาร์คใน doc ไม่มีผล · AUTO_BACKORDER_DEL=false = ไม่มีอะไร', async ({ browser }) => {
  const app = await bootBare(browser);
  // โหมดอัตโนมัติเดิม: นอก PBM ที่ติดลบ + ยังไม่สแกน = ปิดงานเอง (O-NEG-A, O-NEG-B) · SKU ใน PBM (P-NEG) ไม่เข้า · มาร์คใน doc ถูกเมิน
  await setup(app.page, { manual: false, marks: ['P-NEG'] });
  const auto = await app.page.evaluate(() => ({ grp: [..._autoBackorderSkus, ..._negBackorderSkus].filter((s) => _isAutoBackorder(s, state.scanData.get(s))).sort(), prog: document.getElementById('progressCount').textContent }));
  expect([...new Set(auto.grp)]).toEqual(['O-NEG-A', 'O-NEG-B']);
  expect(auto.prog).toBe('5 / 7');                                              // 3 + auto 2 (เท่าที่ merge ไปแล้ว)
  const tab = await tabRows(app.page);
  expect(tab.rows.map((r) => r[1])).toEqual(['P-ADJ', 'O-NEG-A', 'O-NEG-B']);
  expect(tab.rows[1][6]).toContain('อัตโนมัติ'); expect(tab.buttons[1]).toEqual([]);
  expect(await invariants(app.page)).toEqual({ num: 5, denom: 7, counted: 5, pass: 1, total: 7 });

  // ปิดทั้งชุด: ตัวเศษ/📋/แท็บ = เท่ากติกาเดิมก่อนมีค้างส่งอัตโนมัติ แม้มีมาร์คใน doc
  await setup(app.page, { on: false, marks: ['P-NEG'] });
  expect(await invariants(app.page)).toEqual({ num: 3, denom: 7, counted: 3, pass: 1, total: 7 });
  expect((await tabRows(app.page)).rows.map((r) => r[1])).toEqual(['P-ADJ']);
  expect(await pendingRows(app.page)).toEqual(['O-NEG-A', 'O-NEG-B', 'O-POS', 'P-NEG']);

  // WH: เท่าเดิมทุกตัวอักษร ไม่ว่าสวิตช์ใด
  const wh = async (o) => { await setup(app.page, { branch: 'WH', role: 'supervisor', ...o, marks: ['P-NEG'] }); return app.page.evaluate(() => ({ prog: document.getElementById('progressCount').textContent, isAuto: _isAutoBackorder('P-NEG', state.scanData.get('P-NEG')), tab: _backorderTabOn(), rows: (() => { invalidatePopupRowsCache(); popupFilterState = 'pending'; return getFilteredPopupRows().map((r) => r.sku).sort(); })() })); };
  const a = await wh({}), b = await wh({ manual: false }), c = await wh({ on: false });
  expect(a).toEqual(b); expect(a).toEqual(c);
  expect(a.isAuto).toBe(false); expect(a.tab).toBe(false); expect(a.rows).toContain('P-NEG');
  await closeApp(app);
});

test('⑨ ต่อสายครบ: listener เริ่มที่ initAfterLogin + selectEmployee (ทางล็อกอินทั้งสอง) และหยุดที่ selectBranch', async ({ browser }) => {
  const app = await bootBare(browser);
  // ตัด comment ก่อนตรวจ: บรรทัดที่ถูก comment ทิ้งยังมีข้อความ startBoMarksListener() อยู่ในซอร์สของฟังก์ชัน (mutation เจอ — ตรวจแบบเดิมถูกหลอก)
  const code = (fn) => fn.toString().replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const w = await app.page.evaluate((src) => { const strip = new Function('return ' + src)(); return ({
    init: strip(initAfterLogin).includes('startBoMarksListener()'),
    emp: strip(selectEmployee).includes('startBoMarksListener()'),
    stop: strip(selectBranch).includes('stopBoMarksListener()'),
  }); }, code.toString());
  expect(w).toEqual({ init: true, emp: true, stop: true });   // ลืมต่อสายทางใดทางหนึ่ง = เครื่องนั้นไม่เห็นมาร์คของคนอื่นหลังล็อกอิน (ตัวเศษไม่ตรงกัน)
  await closeApp(app);
});
