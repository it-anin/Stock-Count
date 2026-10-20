// แท็บแรกของป็อปอัพ 🔴 Stock Adj ของสาขายา = "📦 ค้างส่ง" แทน "รอรีเช็ค" (19 ต.ค. 2026 · สวิตช์ PHARMACY_BACKORDER_TAB)
//
// ที่มา: ตั้งแต่ 29 ก.ย. ไม่มีขั้น Audit แล้ว แท็บรอรีเช็คว่างตลอด และปุ่ม 📦 ค้างส่ง (อยู่แต่ในแท็บนั้น ใช้ได้เฉพาะ audit) เข้าไม่ถึงอีกเลยตั้งแต่ ↺ กลายเป็น
// "สแกนใหม่ → ⏳ รอนับ" (16 ต.ค.) → สินค้า R01 ติดลบที่ค้างส่งลูกค้าถูกดันกลับเป็น 0 ด้วยใบ IRPS · แท็บใหม่ให้เภสัชตัดสินรายตัวแล้วกด ✓ ยืนยันทั้งหมดปิดเป็น Pass
//
// เทสนี้ตรึง:
//   ① ป้าย/ไอคอน/สี/hint ตามสาขา-สวิตช์ (ค่าที่ส่งมอบ · WH ไม่แตะ · ปิดสวิตช์ = เดิมทุกตัวอักษร)
//   ② แถวของแท็บ: เฉพาะ R01 "ติดลบ" ที่นับแล้วไม่ตรง (Stock Adj / รอรีเช็คเก่า) + มาร์คแล้วรอยืนยัน — ไม่รวม G=0 · G>0 · ไม่มีใน R01 · pending/scanning/pass
//   ③ ปุ่มต่อประเภทแถว + สิทธิ์ (เภสัช Desktop เท่านั้น)
//   ④ markBackorderFromAdj: Stock Adj → รอรีเช็ค → มาร์ค (draft) · ไม่เข้าใบ · ล้มกลางทาง/กดซ้ำ/ถูกปฏิเสธ ไม่ทิ้งสถานะแปลก
//   ⑤ opts ของ reopenPharmacyAudit / markBackorderItem ไม่เปลี่ยนพฤติกรรมเดิมเมื่อไม่ส่ง opts
const { test, expect, bootBare, closeApp } = require('../../lib/hooks');

const E = 'E1';

// สาขา/role + R01 (ค่าดิบ) + sd ตามที่ส่งมา — ผ่าน _rebuildCountableSkus เหมือน login จริง (ตัวอ่าน G คือ _rawSystemQty)
async function setup(page, { branch = 'SRC', role = 'pharmacist', items = {}, on = true, pda = false } = {}) {
  await page.evaluate(({ branch, role, items, on, E }) => {
    currentBranch = branch; currentRole = role; currentUser = 'Pharm'; _countResetAt = E;
    _db = null;   // ตัด Cloud: _writePharmacyAuditMarkers คืนทันที (logic harness ชี้ Firestore ไปพอร์ตตาย) — เส้นทางที่ต้องผ่าน Cloud จริงตรึงที่ e2e
    PHARMACY_BACKORDER_TAB = on; PHARMACIST_STOCKADJ_ONLY = false;
    state.r16InboundRawMap.clear(); state.r16InboundMap.clear(); state.r16RawMap.clear(); state.r16SalesMap.clear();
    state.r16_103Map.clear(); state.r16_103RawMap.clear();
    state.skuMap.clear(); state.scanData.clear(); scanListMap.clear();
    state.r01Data = Object.entries(items).filter(([, v]) => v.g !== undefined).map(([sku, v]) => ({ colE: sku, productName: v.name || sku, systemQty: v.g }));
    for (const [sku, v] of Object.entries(items)) {
      if (v.noSku) continue;
      state.skuMap.set(sku, { sku, productName: v.name || ('ชื่อ ' + sku), unitPrice: 20, systemQty: v.g ?? 0, negSys: false, barcodes: [{ barcode: 'B-' + sku, unitName: 'TAB', unitMultiplier: 1 }], isDel: false });
    }
    _rebuildCountableSkus();
    for (const [sku, v] of Object.entries(items)) if (v.sd) state.scanData.set(sku, { countedQty: 0, scannedBy: 'Asst', timestamp: '2026-10-19 09:00:00', firstScanAt: '2026-10-19 09:00:00', ...v.sd });
    applyAuditTerminology();
  }, { branch, role, items, on, E });
  if (pda) await page.setViewportSize({ width: 390, height: 700 });
}
const AUDIT = { status: 'audit', auditStatus: 'pending', initialStatus: 'audit', auditor: '' };
const ADJ = { status: 'stock_adjustment', auditStatus: 'stock_adjustment', initialStatus: 'stock_adjustment', directAdj: true, effectiveQty: 0, systemQty: -3, auditor: '' };

// แถวที่ผู้ใช้เห็นจริง (DOM) + ป้ายแท็บ
const view = (page) => page.evaluate(() => ({
  tab: document.getElementById('avTabAuditLabel').textContent, icon: document.getElementById('avTabAuditIcon').textContent,
  count: document.getElementById('avCountAudit').textContent,
  // ป็อปอัพปิดอยู่ (display:none) → innerText ถอยไปใช้ textContent ซึ่งไม่ใส่ช่องว่างระหว่างบล็อก — ใส่ช่องว่างหน้า <div> เองให้ผลเท่ากันทั้งตอนเปิด/ปิด
  rows: [...document.querySelectorAll('#auditVerifyTableBody tr')].map((tr) => [...tr.children].map((td) => {
    const c = td.cloneNode(true); c.querySelectorAll('div').forEach((d) => d.prepend(' '));
    return c.textContent.replace(/\s+/g, ' ').trim();
  })),
  footer: document.getElementById('auditVerifyRowCount').textContent,
  hint: getComputedStyle(document.getElementById('avBackorderHint')).display !== 'none' ? document.getElementById('avBackorderHint').textContent : null,
  buttons: [...document.querySelectorAll('#auditVerifyTableBody button')].map((b) => b.getAttribute('onclick')),
  confirmAll: getComputedStyle(document.getElementById('avConfirmAllBtn')).display !== 'none',
}));

test('ค่าที่ส่งมอบ: สวิตช์เปิด · มี id ไอคอน + hint ใน DOM · ฟังก์ชันที่ใช้ครบ', async ({ browser }) => {
  const app = await bootBare(browser);
  const r = await app.page.evaluate(() => ({
    sw: PHARMACY_BACKORDER_TAB, icon: !!document.getElementById('avTabAuditIcon'), hint: !!document.getElementById('avBackorderHint'),
    fns: ['_backorderTabOn', '_backorderTabRows', '_syncAvBackorderTabUi', '_renderBackorderTab', '_canBackorderFromAdj', '_isReopenableAdj', 'markBackorderFromAdj'].map((f) => typeof window[f]),
  }));
  expect(r).toEqual({ sw: true, icon: true, hint: true, fns: Array(7).fill('function') });
  await closeApp(app);
});

test('① ป้ายแท็บแรก: สาขายา = 📦 ค้างส่ง (ม่วง) · WH = Recheck ⚠️ · ปิดสวิตช์ = รอรีเช็ค ⚠️ เดิม', async ({ browser }) => {
  const app = await bootBare(browser);
  const lab = (branch, on) => app.page.evaluate(({ branch, on }) => {
    currentBranch = branch; currentRole = branch === 'WH' ? 'supervisor' : 'pharmacist'; PHARMACY_BACKORDER_TAB = on;
    applyAuditTerminology();
    const q = (id) => document.getElementById(id);
    return { label: q('avTabAuditLabel').textContent, icon: q('avTabAuditIcon').textContent, bg: q('avCountAudit').style.background, title: q('avBtnAudit').title };
  }, { branch, on });
  for (const b of ['SRC', 'KKL', 'SSS']) {
    const on = await lab(b, true);
    expect(on, b).toMatchObject({ label: 'ค้างส่ง', icon: '📦' });
    expect(on.bg, b).toContain('107, 63, 160');
    expect(on.title, b).toContain('ติดลบ');
    expect(await lab(b, false), b).toEqual({ label: 'รอรีเช็ค', icon: '⚠️', bg: 'rgba(224, 140, 0, 0.2)', title: '' });   // สวิตช์ปิด = เดิมเป๊ะ
  }
  expect(await lab('WH', true)).toEqual({ label: 'Recheck', icon: '⚠️', bg: 'rgba(224, 140, 0, 0.2)', title: '' });         // WH ไม่แตะแม้สวิตช์เปิด
  await closeApp(app);
});

test('② แถวของแท็บ: เฉพาะ R01 ติดลบที่นับแล้วไม่ตรง + มาร์คแล้ว · ไม่รวม G=0 / G>0 / ไม่มีใน R01 / pending / scanning / pass', async ({ browser }) => {
  const app = await bootBare(browser);
  await setup(app.page, { items: {
    ADJ_NEG: { g: -3, sd: { ...ADJ, countedQty: 0 } },                       // ✔ Stock Adj ติดลบ
    AUD_NEG: { g: -2, sd: { ...AUDIT, countedQty: 1 } },                     // ✔ รอรีเช็คเก่า ติดลบ
    AUD_DRAFT: { g: -1, sd: { ...AUDIT, countedQty: 1, recheckQty: 3, recheckBy: 'Ph', recheckAt: '2026-10-19T04:00:00.000Z' } }, // ✔ รอรีเช็คเก่า ติดลบ ที่เภสัชสแกนรีเช็คไว้แล้ว (ยังไม่ยืนยัน)
    MARKED_NEG: { g: -4, sd: { ...AUDIT, recheckQty: 0, backorder: true } }, // ✔ มาร์คแล้ว
    MARKED_POS: { g: 6, sd: { ...AUDIT, recheckQty: 0, backorder: true } },  // ✔ มาร์คแล้วแต่ R01 ขยับเป็นบวก — ยังต้องเห็น (draft รอยืนยัน)
    ADJ_ZERO: { g: 0, sd: { ...ADJ } },                                      // ✘ G = 0 ไม่ใช่หนี้ลูกค้า
    ADJ_POS: { g: 5, sd: { ...ADJ } },                                       // ✘
    AUD_POS: { g: 5, sd: { ...AUDIT } },                                     // ✘ รอรีเช็คเก่าที่ไม่ติดลบ (ไปทางเครื่องมือล้างเป็นยังไม่ได้นับ)
    NEG_PENDING: { g: -1, sd: { status: 'pending', auditStatus: 'pending' } }, // ✘ ยังไม่ได้นับ
    NEG_SCANNING: { g: -1, sd: { status: 'scanning', countedQty: 2 } },        // ✘ รอ Confirm
    NEG_PASS: { g: -1, sd: { status: 'pass', auditStatus: 'approved', auditor: '' } }, // ✘
    NEG_VERIFIED_AUD: { g: -1, sd: { ...AUDIT, auditor: 'Other' } },           // ✘ audit ที่มีผู้ยืนยันแล้ว (ไม่ใช่งานค้าง)
    MARKED_VERIFIED: { g: -1, sd: { ...AUDIT, auditor: 'Other', recheckQty: 0, backorder: true } }, // ✘ ธงค้างส่งค้างอยู่บน audit ที่มีผู้ยืนยันแล้ว (ข้อมูลผิดรูป) — ไม่ใช่งานรอยืนยัน
    NO_R01: { sd: { ...ADJ }, noSku: false },                                  // ✘ ไม่มีแถวใน R01 → ไม่รู้ G
    ADJ_VERIFIED_NEG: { g: -2, sd: { ...ADJ, directAdj: false, initialStatus: 'audit', auditor: 'Ph' } }, // ✔ Stock Adj ที่เภสัชรีเช็คแล้ว ยังติดลบ
  } });
  const rows = await app.page.evaluate(() => _backorderTabRows().map((r) => [r.sku, r.kind, r.g]));
  expect(rows).toEqual([   // ยังไม่ตัดสิน (adj/audit) ก่อน · มาร์คแล้วตามหลัง · เรียงตาม SKU
    ['ADJ_NEG', 'adj', -3], ['ADJ_VERIFIED_NEG', 'adj', -2], ['AUD_DRAFT', 'audit', -1], ['AUD_NEG', 'audit', -2], ['MARKED_NEG', 'marked', -4], ['MARKED_POS', 'marked', 6],
  ]);
  // แสดงผลจริงในป็อปอัพ
  await app.page.evaluate(() => { _avFilter = 'audit'; renderAuditVerifyTable(); });
  const v = await view(app.page);
  expect(v.tab).toBe('ค้างส่ง');
  expect(v.count).toBe('6');
  expect(v.footer).toBe('6 รายการ ค้างส่ง');
  expect(v.hint).toContain('ติดลบ');
  expect(v.rows.map((r) => r[1])).toEqual(['ADJ_NEG', 'ADJ_VERIFIED_NEG', 'AUD_DRAFT', 'AUD_NEG', 'MARKED_NEG', 'MARKED_POS']);
  const byKind = Object.fromEntries(v.rows.map((r) => [r[1], r[6]]));
  // รอรีเช็คเก่าที่สแกนรีเช็คไว้แล้ว โชว์ยอดที่สแกนใต้ป้ายสถานะ (แท็บรอรีเช็คเดิมมีคอลัมน์ Recheck) · ตัวที่ยังไม่สแกน/Stock Adj/มาร์คแล้ว ไม่มีบรรทัดนี้
  expect(byKind).toEqual({ ADJ_NEG: '⚠️ Stock Adj', ADJ_VERIFIED_NEG: '⚠️ Stock Adj', AUD_DRAFT: '⚠️ รอรีเช็ค สแกนรีเช็ค 3', AUD_NEG: '⚠️ รอรีเช็ค',
    MARKED_NEG: '📦 ค้างส่ง · รอยืนยัน', MARKED_POS: '📦 ค้างส่ง · รอยืนยัน' });
  // ไม่มีคำว่า Audit บนจอสาขายา
  expect(JSON.stringify(v)).not.toMatch(/Audit/);
  await closeApp(app);
});

test('③ ปุ่มต่อประเภทแถว + สิทธิ์: เภสัช Desktop เท่านั้น · ผู้ช่วย/PDA/WH ไม่มีปุ่ม', async ({ browser }) => {
  const app = await bootBare(browser);
  const items = {
    ADJ_NEG: { g: -3, sd: { ...ADJ } }, AUD_NEG: { g: -2, sd: { ...AUDIT } }, MARKED_NEG: { g: -4, sd: { ...AUDIT, recheckQty: 0, backorder: true } },
    ADJ_NOREOPEN: { g: -1, sd: { ...ADJ, directAdj: false, initialStatus: 'stock_adjustment' } },   // Stock Adj ที่ reopen รับไม่ได้ → ไม่มีปุ่ม
  };
  await setup(app.page, { items });
  await app.page.evaluate(() => { _avFilter = 'audit'; renderAuditVerifyTable(); });
  let v = await view(app.page);
  expect(v.buttons).toEqual(["markBackorderFromAdj('ADJ_NEG')", "markBackorderItem('AUD_NEG')", "resetRecheckItem('MARKED_NEG')"]);
  expect(v.confirmAll).toBe(true);                                  // มี draft (มาร์คแล้ว) รอยืนยัน
  expect(v.rows.find((r) => r[1] === 'ADJ_NOREOPEN')[8]).toBe('—');
  // ผู้ช่วย → ไม่มีคอลัมน์/ปุ่มค้างส่ง (ป็อปอัพเปิดไม่ได้อยู่แล้ว แต่ตารางต้องไม่ยื่นปุ่ม)
  await app.page.evaluate(() => { currentRole = 'assistant'; renderAuditVerifyTable(); });
  v = await view(app.page);
  expect(v.buttons).toEqual([]);
  expect(v.rows[0].length).toBe(8);
  // PDA (UA) → ปุ่มบนแถว Stock Adj ไม่มี (reopen Desktop เท่านั้น) · รอรีเช็คเก่า/มาร์คแล้วกดได้เหมือนเดิม
  const pdaBtns = await app.page.evaluate(() => {
    currentRole = 'pharmacist';
    Object.defineProperty(navigator, 'userAgent', { get: () => 'Mozilla/5.0 StockCountPDA/1.11', configurable: true });
    renderAuditVerifyTable();
    return [...document.querySelectorAll('#auditVerifyTableBody button')].map((b) => b.getAttribute('onclick'));
  });
  expect(pdaBtns).toEqual(["markBackorderItem('AUD_NEG')", "resetRecheckItem('MARKED_NEG')"]);
  await closeApp(app);
});

test('⑥ hint อธิบายแท็บ: เห็นเฉพาะแท็บแรก+Desktop · ปุ่ม ✓ ยืนยันทั้งหมด เห็นเมื่อมี draft เท่านั้น · PDA (จอแคบ) ตารางย่อ ไม่มี hint', async ({ browser }) => {
  const app = await bootBare(browser);
  await setup(app.page, { items: { ADJ_NEG: { g: -3, sd: { ...ADJ } } } });
  await app.page.evaluate(() => { _avFilter = 'audit'; renderAuditVerifyTable(); });
  let v = await view(app.page);
  expect(v.hint).toContain('ติดลบ');
  expect(v.confirmAll).toBe(false);                                 // ยังไม่มี draft → ไม่มีอะไรให้ยืนยัน
  // สลับไปแท็บ Stock Adj → hint ต้องหาย (ไม่ค้างบนแท็บที่ไม่เกี่ยว) · กลับมาแท็บแรก → ขึ้นอีก
  await app.page.evaluate(() => document.getElementById('avBtnStockAdj').click());
  v = await view(app.page);
  expect(v.hint).toBeNull();
  await app.page.evaluate(() => document.getElementById('avBtnAudit').click());
  expect((await view(app.page)).hint).toContain('ติดลบ');
  // มาร์คแล้ว → ปุ่ม ✓ ยืนยันทั้งหมด โผล่
  await app.page.evaluate(() => { window.confirm = () => true; return markBackorderFromAdj('ADJ_NEG'); });
  expect((await view(app.page)).confirmAll).toBe(true);
  // จอแคบ (PDA): ตารางย่อ [SKU · ชื่อ · ระบบ · ปุ่ม] และไม่มี hint (ประหยัดพื้นที่)
  await app.page.setViewportSize({ width: 390, height: 700 });
  await app.page.evaluate(() => renderAuditVerifyTable());
  v = await view(app.page);
  expect(v.hint).toBeNull();
  expect(v.rows[0].length).toBe(4);
  expect(v.rows[0][0]).toBe('ADJ_NEG');
  await closeApp(app);
});

test('⑦ จอแคบ (PDA): รอรีเช็คเก่าที่สแกนรีเช็คไว้แล้ว โชว์ยอดที่สแกนใต้ยอดระบบ · ที่ยังไม่สแกน/Stock Adj ไม่มี', async ({ browser }) => {
  const app = await bootBare(browser);
  await setup(app.page, { items: {
    AUD_DRAFT: { g: -1, sd: { ...AUDIT, recheckQty: 3, recheckBy: 'Ph', recheckAt: '2026-10-19T04:00:00.000Z' } },
    AUD_NEG: { g: -2, sd: { ...AUDIT } }, ADJ_NEG: { g: -3, sd: { ...ADJ } },
    AUD_ZERO: { g: -4, sd: { ...AUDIT, recheckQty: 0, recheckBy: 'Ph', recheckAt: '2026-10-19T04:00:00.000Z' } },   // รีเช็คแล้วได้ 0 (ไม่ใช่ค้างส่ง) — 0 ก็ต้องโชว์ ไม่ใช่ถูกมองเป็น "ไม่มี draft"
  }, pda: true });
  await app.page.evaluate(() => { _avFilter = 'audit'; renderAuditVerifyTable(); });
  const v = await view(app.page);
  const byRow = Object.fromEntries(v.rows.map((r) => [r[0], r[2]]));
  expect(byRow).toEqual({ ADJ_NEG: '-3', AUD_DRAFT: '-1 สแกนรีเช็ค 3', AUD_NEG: '-2', AUD_ZERO: '-4 สแกนรีเช็ค 0' });
  await closeApp(app);
});

test('⑤ ปิดสวิตช์ / WH → แท็บรอรีเช็คเดิมเป๊ะ (แถว = audit ทุกตัว ไม่สน R01) ไม่มี hint', async ({ browser }) => {
  const app = await bootBare(browser);
  const items = { AUD_POS: { g: 5, sd: { ...AUDIT } }, AUD_NEG: { g: -2, sd: { ...AUDIT } }, ADJ_NEG: { g: -3, sd: { ...ADJ } } };
  await setup(app.page, { items, on: false });
  await app.page.evaluate(() => { _avFilter = 'audit'; renderAuditVerifyTable(); });
  const off = await view(app.page);
  expect(off.tab).toBe('รอรีเช็ค');
  expect(off.footer).toBe('2 รายการ รอรีเช็ค');
  expect(off.count).toBe('2');
  expect(off.hint).toBeNull();
  expect(off.rows.map((r) => r[1])).toEqual(['AUD_POS', 'AUD_NEG']);   // เดิม: เรียงตามลำดับใน scanData (ไม่เรียง SKU · ไม่สน R01) · ทั้งสองเป็น audit
  // WH ต่อให้สวิตช์เปิด
  await setup(app.page, { branch: 'WH', role: 'supervisor', items, on: true });
  await app.page.evaluate(() => { _avFilter = 'audit'; renderAuditVerifyTable(); });
  const wh = await view(app.page);
  expect(wh.tab).toBe('Recheck');
  expect(wh.footer).toBe('2 รายการ Recheck');
  expect(wh.hint).toBeNull();
  await closeApp(app);
});

// ── markBackorderFromAdj ────────────────────────────────────────────────────────────────────────
// ตัด Cloud ออก (ไม่มี _db → _writePharmacyAuditMarkers คืนทันที) ดูเฉพาะการเปลี่ยนสถานะ/ใบ/ข้อความ
const act = (page, sku, { ok = true } = {}) => page.evaluate(async ({ sku, ok }) => {
  const toasts = []; const realToast = window.toast; window.toast = (m, k) => toasts.push(String(m));
  const dialogs = []; window.confirm = (m) => { dialogs.push(m); return ok; };
  try { await markBackorderFromAdj(sku); } finally { window.toast = realToast; }
  const s = state.scanData.get(sku);
  return { status: s.status, backorder: !!s.backorder, recheckQty: s.recheckQty, recheckBy: s.recheckBy, frozenSys: s.recheckSystemQty, initialStatus: s.initialStatus,
    directAdj: s.directAdj, auditor: s.auditor, toasts, dialogs: dialogs.length, dialog: dialogs[0] || '',
    ords: _buildAdjustDocRows('ords').map((r) => r.sku), irps: _buildAdjustDocRows('irps').map((r) => r.sku),
    pending: [...getPharmacistAuditPendingMap().keys()] };
}, { sku, ok });

test('④ Stock Adj ติดลบ → กด ค้างส่ง: confirm ครั้งเดียว · กลับเป็นรอรีเช็ค + มาร์ค (draft recheckQty 0) · หลุดจากใบ · เข้าคิวยืนยัน', async ({ browser }) => {
  const app = await bootBare(browser);
  await setup(app.page, { items: { NEG: { g: -3, name: 'ยาค้างส่ง', sd: { ...ADJ, countedQty: 0, directAdj: true, effectiveQty: 0, systemQty: -3 } } } });
  // ก่อนมาร์ค: เป็น Stock Adj ตรง เข้าใบ IRPS +3 (นี่คือสิ่งที่ปุ่มต้องกัน)
  expect(await app.page.evaluate(() => _buildAdjustDocRows('irps').map((r) => [r.sku, r.qty]))).toEqual([['NEG', 3]]);
  const r = await act(app.page, 'NEG');
  expect(r.dialogs).toBe(1);
  expect(r.dialog).toContain('ยอดระบบ -3');
  expect(r.dialog).toContain('นับได้ 0');
  expect(r.dialog).not.toContain('นับเจอของบนชั้น');
  expect(r).toMatchObject({ status: 'audit', backorder: true, recheckQty: 0, recheckBy: 'Pharm', frozenSys: -3, initialStatus: 'audit', auditor: '' });
  expect(r.directAdj).toBeUndefined();                     // ธง Stock Adj ตรงถูกล้าง (reopen)
  expect(r.ords).toEqual([]); expect(r.irps).toEqual([]);   // ← หัวใจ: ไม่เข้าใบ
  expect(r.pending).toEqual(['NEG']);                       // เข้าคิว ✓ ยืนยันทั้งหมด
  expect(r.toasts.some((t) => t.includes('มาร์คค้างส่งแล้ว'))).toBe(true);
  expect(r.toasts.some((t) => t.includes('กลับไปรอสแกนรีเช็ค'))).toBe(false);   // silent: ไม่ขึ้น toast ของ reopen ซ้ำ
  // ปิดงานด้วยการยืนยัน (ในเครื่อง) → Pass ไม่เข้าใบ
  const fin = await app.page.evaluate(() => { const res = confirmAuditVerifyItem('NEG', true, true); return { res, status: state.scanData.get('NEG').status, irps: _buildAdjustDocRows('irps').length }; });
  expect(fin).toEqual({ res: 'pass', status: 'pass', irps: 0 });
  await closeApp(app);
});

test('④ นับเจอของบนชั้น (> 0) → dialog เตือน · ผู้ใช้ไม่ยืนยัน = ไม่เปลี่ยนอะไร (ไม่ reopen)', async ({ browser }) => {
  const app = await bootBare(browser);
  await setup(app.page, { items: { NEG: { g: -3, sd: { ...ADJ, countedQty: 4 } } } });
  const r = await act(app.page, 'NEG', { ok: false });
  expect(r.dialog).toContain('นับเจอของบนชั้น 4 ชิ้น');
  expect(r).toMatchObject({ status: 'stock_adjustment', backorder: false, directAdj: true });   // ไม่แตะ
  expect(r.irps).toEqual(['NEG']);
  await closeApp(app);
});

test('④ ถูกปฏิเสธ/ล้มกลางทาง: ไม่ใช่ติดลบ · PDA · ผู้ช่วย · ออฟไลน์ · reopen รับไม่ได้ → ไม่เปลี่ยนสถานะ และไม่ทิ้งครึ่งทาง', async ({ browser }) => {
  const app = await bootBare(browser);
  await setup(app.page, { items: {
    POS: { g: 5, sd: { ...ADJ } }, ZERO: { g: 0, sd: { ...ADJ } }, NEG: { g: -3, sd: { ...ADJ } },
    NOREOPEN: { g: -1, sd: { ...ADJ, directAdj: false, initialStatus: 'stock_adjustment' } },
    PASSNEG: { g: -2, sd: { status: 'pass', auditStatus: 'approved', initialStatus: 'audit', auditor: 'Ph' } },
  } });
  for (const sku of ['POS', 'ZERO', 'NOREOPEN', 'PASSNEG']) {
    const r = await act(app.page, sku);
    expect(r.dialogs, sku).toBe(0);                                   // ไม่ถึงขั้นถาม
    expect(r.backorder, sku).toBe(false);
    expect(r.toasts.some((t) => t.includes('มาร์คค้างส่งไม่ได้')), sku).toBe(true);
  }
  expect((await app.page.evaluate(() => state.scanData.get('POS').status))).toBe('stock_adjustment');
  expect((await app.page.evaluate(() => state.scanData.get('PASSNEG').status))).toBe('pass');
  // ผู้ช่วย
  await app.page.evaluate(() => { currentRole = 'assistant'; });
  expect((await act(app.page, 'NEG')).dialogs).toBe(0);
  await app.page.evaluate(() => { currentRole = 'pharmacist'; });
  // ออฟไลน์ → ไม่ถาม ไม่แตะ
  const off = await app.page.evaluate(async () => {
    Object.defineProperty(navigator, 'onLine', { get: () => false, configurable: true });
    const toasts = []; const real = window.toast; window.toast = (m) => toasts.push(String(m)); let asked = 0; window.confirm = () => { asked++; return true; };
    try { await markBackorderFromAdj('NEG'); } finally { window.toast = real; Object.defineProperty(navigator, 'onLine', { get: () => true, configurable: true }); }
    return { asked, status: state.scanData.get('NEG').status, toasts };
  });
  expect(off.asked).toBe(0); expect(off.status).toBe('stock_adjustment'); expect(off.toasts.some((t) => t.includes('ออนไลน์'))).toBe(true);
  // reopen ล้ม (marker เขียนไม่ได้) → ยังเป็น Stock Adj เดิมทุกอย่าง · ไม่ค้างครึ่งทาง
  const fail = await app.page.evaluate(async () => {
    const real = window._writePharmacyAuditMarkers; window._writePharmacyAuditMarkers = async () => { throw new Error('boom'); };
    const toasts = []; const rt = window.toast; window.toast = (m) => toasts.push(String(m)); window.confirm = () => true;
    try { await markBackorderFromAdj('NEG'); } finally { window.toast = rt; window._writePharmacyAuditMarkers = real; }
    const s = state.scanData.get('NEG');
    return { status: s.status, backorder: !!s.backorder, directAdj: s.directAdj, busyCleared: !_boFromAdjBusy.has('NEG'), irps: _buildAdjustDocRows('irps').map((r) => r.sku), toasts };
  });
  expect(fail).toMatchObject({ status: 'stock_adjustment', backorder: false, directAdj: true, busyCleared: true });
  expect(fail.irps).toContain('NEG');   // ยังอยู่ในใบเหมือนเดิม (ล้มกลางทาง = ไม่เปลี่ยนอะไร)
  expect(fail.toasts.some((t) => t.includes('เปิดรีเช็คใหม่ไม่สำเร็จ'))).toBe(true);
  expect(fail.toasts.some((t) => t.includes('มาร์คค้างส่งไม่ได้'))).toBe(false);   // ล้มที่ขั้น reopen แล้วหยุด — ไม่ไปขั้นมาร์คต่อ
  await closeApp(app);
});

test('④ กดซ้ำขณะกำลังทำ (busy) → ทำครั้งเดียว · ทำสำเร็จแล้วกดอีก = ถูกปฏิเสธ (ไม่ใช่ Stock Adj แล้ว)', async ({ browser }) => {
  const app = await bootBare(browser);
  await setup(app.page, { items: { NEG: { g: -3, sd: { ...ADJ } } } });
  const out = await app.page.evaluate(async () => {
    let asked = 0; window.confirm = () => { asked++; return true; };
    const toasts = []; const rt = window.toast; window.toast = (m) => toasts.push(String(m));
    try { await Promise.all([markBackorderFromAdj('NEG'), markBackorderFromAdj('NEG')]); await markBackorderFromAdj('NEG'); } finally { window.toast = rt; }
    return { asked, status: state.scanData.get('NEG').status, backorder: !!state.scanData.get('NEG').backorder, marks: toasts.filter((t) => t.includes('มาร์คค้างส่งแล้ว')).length };
  });
  expect(out).toEqual({ asked: 1, status: 'audit', backorder: true, marks: 1 });
  await closeApp(app);
});

test('④ ✕ ถอน (หลังมาร์คจาก Stock Adj) → กลับเป็น "รอรีเช็ค" ติดลบในแท็บเดิม (ไม่หาย · ไม่เข้าใบ) · มาร์คซ้ำได้', async ({ browser }) => {
  const app = await bootBare(browser);
  await setup(app.page, { items: { NEG: { g: -3, sd: { ...ADJ } } } });
  await act(app.page, 'NEG');                                        // Stock Adj → รอรีเช็ค + มาร์ค (draft)
  const afterUnmark = await app.page.evaluate(() => {
    resetRecheckItem('NEG');                                          // ปุ่ม ✕ ถอน ของแถวที่มาร์คแล้ว
    const s = state.scanData.get('NEG'); _avFilter = 'audit'; renderAuditVerifyTable();
    return { status: s.status, backorder: !!s.backorder, recheckQty: s.recheckQty, pending: [...getPharmacistAuditPendingMap().keys()],
      rows: _backorderTabRows().map((r) => [r.sku, r.kind]), irps: _buildAdjustDocRows('irps').map((r) => r.sku),
      buttons: [...document.querySelectorAll('#auditVerifyTableBody button')].map((b) => b.getAttribute('onclick')) };
  });
  // ถอนแล้วเป็น audit ธรรมดา (ไม่มี draft) ที่ติดลบ → ยังอยู่ในแท็บ (ไม่หายจากตา) และกด 📦 ค้างส่ง ซ้ำได้ด้วยฟังก์ชันเดิม
  expect(afterUnmark).toMatchObject({ status: 'audit', backorder: false, pending: [], rows: [['NEG', 'audit']], buttons: ["markBackorderItem('NEG')"] });
  expect(afterUnmark.recheckQty).toBeUndefined();
  // ⚠️ ข้อสังเกตที่ตรึงไว้ (ตรงตามที่แจ้งผู้ใช้): ถอนแล้วรายการเป็น "รอรีเช็ค" ที่เคย ↺ — ไม่กลับเป็น Stock Adj ตรงแบบเดิม
  //   เลขตอน Confirm เดิมถูก ↺ เขียนทับแล้ว จึงไม่ขึ้นใบ 📦 จนกว่าจะมีผลยืนยัน (ADJUST_DOC_SKIP_REOPENED — ดู adjust-doc-reopened.spec.js)
  expect(afterUnmark.irps).toEqual([]);
  expect(await app.page.evaluate(() => markBackorderItem('NEG', { skipConfirm: true }))).toBe(true);
  expect(await app.page.evaluate(() => state.scanData.get('NEG').backorder)).toBe(true);
  await closeApp(app);
});

test('⑤ opts ไม่ส่ง = พฤติกรรมเดิม: reopenPharmacyAudit / markBackorderItem ยังถาม confirm เอง · ขึ้น toast เดิม · คืน true/false', async ({ browser }) => {
  const app = await bootBare(browser);
  await setup(app.page, { items: { NEG: { g: -3, sd: { ...ADJ } }, AUD: { g: -2, sd: { ...AUDIT } }, POS: { g: 5, sd: { ...AUDIT } } } });
  const r = await app.page.evaluate(async () => {
    const asked = []; window.confirm = (m) => { asked.push(m.split('\n')[0]); return true; };
    const toasts = []; const rt = window.toast; window.toast = (m) => toasts.push(String(m));
    try {
      const reopened = await reopenPharmacyAudit('NEG');           // ไม่ส่ง opts → ถาม + toast
      const marked = markBackorderItem('AUD');                     // ไม่ส่ง opts → ถาม
      const refused = markBackorderItem('POS');                    // G > 0 → ปฏิเสธ
      window.confirm = () => false;
      const declined = await reopenPharmacyAudit('NEG');           // ผู้ใช้กดยกเลิก → false
      return { reopened, marked, refused, declined, asked, toasts };
    } finally { window.toast = rt; }
  });
  expect(r.reopened).toBe(true); expect(r.marked).toBe(true); expect(r.refused).toBe(false); expect(r.declined).toBe(false);
  expect(r.asked).toEqual(['เปิดรีเช็คใหม่: NEG', 'AUD']);
  expect(r.toasts.some((t) => t.includes('NEG กลับไปรอสแกนรีเช็คแล้ว'))).toBe(true);
  await closeApp(app);
});

test('_isReopenableAdj = เงื่อนไขเดียวกับ guard เดิมของ reopenPharmacyAudit ทุกกรณี (รวม noStock + สวิตช์)', async ({ browser }) => {
  const app = await bootBare(browser);
  await setup(app.page, { items: {} });
  const r = await app.page.evaluate(() => {
    const t = (sd) => _isReopenableAdj(sd);
    const base = { status: 'stock_adjustment' };
    const cases = {
      directAdj: t({ ...base, directAdj: true }), fromAudit: t({ ...base, initialStatus: 'audit' }), passFromAudit: t({ status: 'pass', initialStatus: 'audit' }),
      plainAdj: t({ ...base, initialStatus: 'stock_adjustment' }), noStock: t({ ...base, noStock: true }), noStockOnPass: t({ status: 'pass', noStock: true }),
      auditStatus: t({ status: 'audit', initialStatus: 'audit' }), pending: t({ status: 'pending', directAdj: true }), none: t(null),
    };
    PHARMACY_NOSTOCK_REOPEN = false;
    const noStockOff = t({ ...base, noStock: true });
    PHARMACY_NOSTOCK_REOPEN = true;
    return { ...cases, noStockOff };
  });
  expect(r).toEqual({ directAdj: true, fromAudit: true, passFromAudit: true, plainAdj: false, noStock: true, noStockOnPass: false,
    auditStatus: false, pending: false, none: false, noStockOff: false });
  // และ reopenPharmacyAudit ใช้ตัวช่วยนี้จริง: รายการที่ reopen รับไม่ได้ถูกปฏิเสธ (คืน false · ไม่แตะสถานะ) แม้ผู้ใช้กดยืนยัน
  await setup(app.page, { items: { PLAIN: { g: -1, sd: { ...ADJ, directAdj: false, initialStatus: 'stock_adjustment' } }, OK: { g: -1, sd: { ...ADJ } } } });
  const g = await app.page.evaluate(async () => {
    window.confirm = () => true; const rt = window.toast; window.toast = () => {};
    try { return { plain: await reopenPharmacyAudit('PLAIN'), ok: await reopenPharmacyAudit('OK', { skipConfirm: true, silent: true }),
      plainStatus: state.scanData.get('PLAIN').status, okStatus: state.scanData.get('OK').status }; } finally { window.toast = rt; }
  });
  expect(g).toEqual({ plain: false, ok: true, plainStatus: 'stock_adjustment', okStatus: 'audit' });
  await closeApp(app);
});
