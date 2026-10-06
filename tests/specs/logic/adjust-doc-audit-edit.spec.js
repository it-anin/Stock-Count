// ใบ 📦: "รอรีเช็ค" (audit) ขึ้นใบทันที + เภสัชแก้ "จำนวน" ในใบได้ (6 ต.ค. 2026 · ผู้ใช้สั่ง)
//   สวิตช์ PHARMACY_AUDIT_IN_ADJUST_DOC · ADJUST_DOC_QTY_EDIT (ปิด = ใบเท่าเดิมทุกไบต์)
//
// เทสนี้ตรึง 8 ด้าน — ด้านที่ 2, 4 สำคัญที่สุดเพราะกติกาใหม่ต้องไม่ลามไปที่อื่น:
//   1. audit สาขายาขึ้นใบด้วย "เลขตอน Confirm" (effectiveQty − systemQty ที่ marker แช่ไว้) ถูกทิศ/จำนวน · ไม่ขยับตามยอดสด · มีป้าย · นับในปุ่ม
//      (sd ไม่มีเลข → อ่านจาก marker ของ cloud ได้ · sd ที่มีเลขชนะ · marker ผิดรอบ/ไม่ใช่ audit รอ = ไม่ใช้)
//   2. ★ ไม่ขึ้นใบ: ค้างส่ง · WH · สวิตช์ปิด · ไม่มีเลขแช่ไว้ (ต้องถูกรายงาน ไม่หายเงียบ) · ร่างรีเช็คที่ยังไม่ยืนยันไม่เปลี่ยนแถว
//   3. ยืนยันรีเช็คแล้วผลใหม่แทนเอง (ตรง → ออกจากใบ · ไม่ตรง → กติกาเดิมของ Stock Adj)
//   4. แก้จำนวน: Export ใช้ค่าที่แก้ · 0 ไม่ลงไฟล์ · เท่าค่าคำนวณ = ล้าง · ค่าผิดปฏิเสธ · ผลต่างเปลี่ยน → ค่าที่แก้หลุดเอง · ★ สิทธิ์เฉพาะเภสัช·สาขายา·Desktop
//   5. ไม่วาดตารางทับช่องที่กำลังพิมพ์ (LOT/ราคาโหลดเสร็จกลางคัน)
//   6. ฟิลด์ที่แก้ (adjQty/adjBase/adjBy/adjAt — แบน ไม่ซ้อน object) เดินทางผ่าน payload ของ item (ซิงก์ข้ามเครื่อง) · เปลี่ยนแล้ว fingerprint เปลี่ยน · echo ไม่ทำให้ "เปลี่ยน"
//   7. ค่าเริ่มต้นของโหมดซ่อนเภสัชปิด (PHARMACIST_STOCKADJ_ONLY=false) · สแกน Stock Adj ที่ไม่ได้ ↺ ยังถูกปฏิเสธ
//   8. ปิดสวิตช์ (PHARMACY_AUDIT_IN_ADJUST_DOC · ADJUST_DOC_QTY_EDIT) → ใบเท่าเดิม ทีละตัวและทั้งคู่ (ผลถอยทั้งชุดพิสูจน์แล้วด้วยเทสเดิมทั้งหมด — CLAUDE.md §ทางถอย)
const { test, expect, bootBare, closeApp } = require('../../lib/hooks');

const T = '2026-09-20 09:00:00';
// audit ที่ marker เขียน: นับ 10 + R16 ขาย 2 = effective 12 · ระบบตอน Confirm 15
const AUDIT = (extra = {}) => ({ status: 'audit', auditStatus: 'pending', initialStatus: 'audit', auditor: '', countedQty: 10,
  timestamp: T, firstScanAt: T, scannedBy: 'Asst', soldQty: 2, ...extra });
const DIRECT = (extra = {}) => ({ status: 'stock_adjustment', auditStatus: 'stock_adjustment', initialStatus: 'stock_adjustment', auditor: '',
  countedQty: 8, timestamp: T, firstScanAt: T, scannedBy: 'Asst', directAdj: true, ...extra });

// items: [{ sku, live, sd }] — live = ยอดสดใน skuMap (ตั้งให้ต่างจากเลขที่แช่ไว้โดยเจตนา)
async function seed(page, { branch = 'SRC', role = 'pharmacist', items, on = true } = {}) {
  await page.evaluate(({ branch, role, items, on }) => {
    PHARMACY_AUDIT_IN_ADJUST_DOC = on; ADJUST_DOC_QTY_EDIT = on;
    currentBranch = branch; currentRole = role; currentUser = 'Pharm';
    _branchScanPaused = false; _adjDocFilter = 'ords';
    state.skuMap.clear(); state.scanData.clear(); state.skuDirectMap.clear(); scanListMap.clear();
    window.__marked = []; _markSkuDirty = (s) => { window.__marked.push(String(s)); };   // ไม่แตะ Firestore — แค่จำว่าถูกสั่งเขียน
    window.__toasts = []; toast = (m) => { window.__toasts.push(String(m)); };
    window.__exports = [];
    URL.createObjectURL = (b) => { window.__exports.push(b); return 'blob:captured'; };
    URL.revokeObjectURL = () => {};
    HTMLAnchorElement.prototype.click = function () {};
    for (const it of items) {
      state.skuMap.set(it.sku, { sku: it.sku, productName: 'สินค้า ' + it.sku, unitPrice: 20, systemQty: it.live, negSys: false, barcodes: [], isDel: false });
      state.skuDirectMap.set(it.sku, { barcode: 'B' + it.sku, unitName: 'เม็ด' });
      state.scanData.set(it.sku, it.sd);
    }
  }, { branch, role, items, on });
}

// สถานะใบ ณ ตอนนี้ (ผ่านฟังก์ชันจริงทั้งหมด)
const read = (page) => page.evaluate(() => {
  const a = _adjustDocAudit();
  const ids = (arr) => arr.map((x) => x.sku);
  const m = (r) => [r.sku, r.qty];
  return {
    ords: _buildAdjustDocRows('ords').map(m), irps: _buildAdjustDocRows('irps').map(m),
    badge: _countAdjustDocItems(), skuSet: [..._adjustDocSkuSet()].sort(),
    stale: ids(a.stale), noSku: ids(a.noSku), settled: ids(a.settled), noBasis: ids(a.noBasis),
  };
});
const rowsOf = (page, dir) => page.evaluate((dir) => _buildAdjustDocRows(dir).map((r) => ({ sku: r.sku, qty: r.qty, baseQty: r.baseQty, edited: r.edited, pending: r.pending })), dir);
const exportText = (page) => page.evaluate(async () => {
  const n = window.__exports.length;
  exportAdjustDocText();
  return window.__exports.length > n ? window.__exports[window.__exports.length - 1].text() : null;
});
const lastToast = (page) => page.evaluate(() => window.__toasts[window.__toasts.length - 1] || '');
const edit = (page, sku, v) => page.evaluate(([sku, v]) => setAdjDocQty(sku, v), [sku, v]);

test('รอรีเช็ค (audit) สาขายาขึ้นใบด้วยเลขตอน Confirm — ถูกทิศ/จำนวน · ไม่ขยับตามยอดสด · มีป้าย · นับในปุ่ม · ขอ LOT/ราคา', async ({ browser }) => {
  const app = await bootBare(browser);
  await seed(app.page, { items: [
    { sku: 'AU-SHORT', live: 9, sd: AUDIT({ effectiveQty: 12, systemQty: 15 }) },     // 12 − 15 = ขาด 3 (ยอดสด 9 ไม่เกี่ยว)
    { sku: 'AU-OVER', live: 3, sd: AUDIT({ effectiveQty: 9, systemQty: 4 }) },         // 9 − 4 = เกิน 5
    { sku: 'AU-SETTLED', live: 5, sd: AUDIT({ effectiveQty: 5, systemQty: 5 }) },      // ตรงพอดี → ไม่มีแถว
    { sku: 'SA-DIRECT', live: 7, sd: DIRECT({ effectiveQty: 8, systemQty: 10 }) },     // Stock Adj ตรง (ของเดิม) 8 − 10 = ขาด 2
  ] });
  expect(await read(app.page)).toEqual({
    ords: [['AU-SHORT', 3], ['SA-DIRECT', 2]], irps: [['AU-OVER', 5]],
    badge: 4,                                                       // ปุ่มนับทุกตัวที่เป็นงานของใบ (รวม audit และตัวที่ตรงพอดี)
    skuSet: ['AU-OVER', 'AU-SETTLED', 'AU-SHORT', 'SA-DIRECT'],     // LOT/ราคาต้องถูกขอให้ audit ด้วย
    stale: [], noSku: [], settled: ['AU-SETTLED'], noBasis: [],
  });
  expect((await rowsOf(app.page, 'ords')).map((r) => [r.sku, r.pending])).toEqual([['AU-SHORT', true], ['SA-DIRECT', false]]);

  // ป้าย "รอรีเช็ค" เฉพาะแถว audit
  const tags = await app.page.evaluate(() => { renderAdjustDocTable(); return [...document.querySelectorAll('#adjustDocBody tr')].map((tr) => [tr.children[1].textContent.trim(), tr.children[2].textContent.includes('รอรีเช็ค')]); });
  expect(tags).toEqual([['AU-SHORT', true], ['SA-DIRECT', false]]);

  // ยอดสดเปลี่ยน (R01 ใหม่เข้า) → ตัวเลขของ audit ไม่ขยับ เหมือน Stock Adj ตรง
  await app.page.evaluate(() => { state.skuMap.get('AU-SHORT').systemQty = 1; });
  expect((await read(app.page)).ords).toEqual([['AU-SHORT', 3], ['SA-DIRECT', 2]]);
  await closeApp(app);
});

test('★ ไม่ขึ้นใบ: ค้างส่ง · ไม่มีเลขตอน Confirm (ต้องถูกรายงาน) · ร่างรีเช็คที่ยังไม่ยืนยันไม่เปลี่ยนแถว', async ({ browser }) => {
  const app = await bootBare(browser);
  await seed(app.page, { items: [
    { sku: 'AU-BACK', live: 15, sd: AUDIT({ effectiveQty: 12, systemQty: 15, backorder: true, recheckQty: 0, recheckBy: 'Pharm', recheckAt: '2026-09-21T03:00:00.000Z' }) },
    { sku: 'AU-NOBASIS', live: 15, sd: AUDIT({}) },                                   // marker ไม่มีเลขแช่ไว้
    { sku: 'AU-NAN', live: 15, sd: AUDIT({ effectiveQty: 12, systemQty: NaN }) },     // marker เก่า: Number(undefined)
    { sku: 'AU-DRAFT', live: 15, sd: AUDIT({ effectiveQty: 12, systemQty: 15, recheckQty: 15, recheckBy: 'Pharm', recheckAt: '2026-09-21T03:00:00.000Z', recheckSystemQty: 15 }) },
  ] });
  const r = await read(app.page);
  expect(r.ords).toEqual([['AU-DRAFT', 3]]);          // ร่างรีเช็ค (บอกว่าตรง) ยังไม่ยืนยัน → ใบยังแสดงผลที่ตัดสินแล้ว (ตอน Confirm)
  expect(r.irps).toEqual([]);
  expect(r.badge).toBe(3);                            // AU-BACK ไม่นับ (เภสัชตัดสินแล้วว่าไม่ต้องปรับ) · อีก 3 ตัวนับ
  expect(r.noBasis).toEqual(['AU-NOBASIS', 'AU-NAN']);// ไม่หายเงียบ
  expect(r.settled).toEqual([]);
  expect(r.skuSet).toEqual(['AU-DRAFT', 'AU-NAN', 'AU-NOBASIS']);

  // toast ตอน Export ต้องบอกจำนวนที่ไม่ได้อยู่ในไฟล์ พร้อมเหตุผล
  await app.page.evaluate(() => _warnAdjustDocDropped());
  const t = await lastToast(app.page);
  expect(t).toContain('2 รายการไม่ได้อยู่ในไฟล์นี้');
  expect(t).toContain('รอรีเช็คที่ไม่มีเลขตอน Confirm 2');
  await closeApp(app);
});

test('audit ที่ sd ไม่มีเลข → อ่านจาก marker ของ cloud (รอบนี้ · ยังเป็น audit · ไม่มีผู้ยืนยัน) · sd ที่มีเลขชนะ · marker ผิดรอบ/ไม่ใช่ audit/ไม่มี = noBasis', async ({ browser }) => {
  const app = await bootBare(browser);
  await seed(app.page, { items: [
    { sku: 'M-ONLY', live: 9, sd: AUDIT({}) },                                     // sd ไม่มีเลข · marker มี → ขาด 3 (12 − 15)
    { sku: 'M-SD', live: 9, sd: AUDIT({ effectiveQty: 12, systemQty: 15 }) },      // sd มีเลข ชนะ marker (ที่บอกเกิน 5)
    { sku: 'M-OLDEPOCH', live: 9, sd: AUDIT({}) },                                 // marker ของรอบก่อน → ไม่ใช้
    { sku: 'M-PASS', live: 9, sd: AUDIT({}) },                                     // marker ไม่ใช่ audit ที่ยังรอ → ไม่ใช้
    { sku: 'M-NAN', live: 9, sd: AUDIT({}) },                                      // marker มีเลขไม่ครบ → ไม่ใช้
    { sku: 'M-NONE', live: 9, sd: AUDIT({}) },                                     // ไม่มี marker
  ] });
  const run = (docEpoch) => app.page.evaluate((docEpoch) => {
    _countResetAt = 'E1';
    const mk = (eff, sys, extra = {}) => ({ countResetAt: 'E1', status: 'audit', auditor: '', effectiveQty: eff, systemQty: sys, ...extra });
    _pharmacyAuditMarkerData = { branch: 'SRC', countResetAt: docEpoch, items: {
      'M-ONLY': mk(12, 15), 'M-SD': mk(9, 4), 'M-OLDEPOCH': mk(12, 15, { countResetAt: 'E0' }),
      'M-PASS': mk(12, 15, { status: 'pass', auditor: 'Ph' }), 'M-NAN': mk(12, undefined),
    } };
    const a = _adjustDocAudit();
    return { ords: _buildAdjustDocRows('ords').map((r) => [r.sku, r.qty]), irps: _buildAdjustDocRows('irps').map((r) => [r.sku, r.qty]), noBasis: a.noBasis.map((x) => x.sku) };
  }, docEpoch);
  expect(await run('E1')).toEqual({ ords: [['M-ONLY', 3], ['M-SD', 3]], irps: [], noBasis: ['M-OLDEPOCH', 'M-PASS', 'M-NAN', 'M-NONE'] });
  // marker ทั้งชุดเป็นของรอบอื่น (ยังไม่ซิงก์/เพิ่งเริ่มนับใหม่) → ไม่ใช้เลย · sd ที่มีเลขเองยังขึ้นปกติ
  expect(await run('E0')).toEqual({ ords: [['M-SD', 3]], irps: [], noBasis: ['M-ONLY', 'M-OLDEPOCH', 'M-PASS', 'M-NAN', 'M-NONE'] });
  await closeApp(app);
});

test('★ WH ไม่ถูกแตะ: audit (Recheck) ไม่ขึ้นใบ · Stock Adj ของ WH ใช้ยอดวัน Recheck เหมือนเดิม · ไม่มีช่องแก้', async ({ browser }) => {
  const app = await bootBare(browser);
  await seed(app.page, { branch: 'WH', role: 'supervisor', items: [
    { sku: 'W-AUDIT', live: 15, sd: AUDIT({ effectiveQty: 12, systemQty: 15 }) },
    // WH Stock Adj: ยอดระบบวัน Recheck 6 (แช่ที่ sd.systemQty) · รีเช็ค 4 → ขาด 2 · ฟิลด์ adjQty ที่หลุดมา (ไม่มีทางแก้ใน WH) ต้องไม่ถูกใช้
    { sku: 'W-ADJ', live: 9, sd: { status: 'stock_adjustment', auditStatus: 'stock_adjustment', auditor: 'Sup', countedQty: 5, recheckQty: 4, systemQty: 6,
      timestamp: T, adjQty: 1, adjBase: -2, adjBy: 'x', adjAt: 't' } },
  ] });
  const r = await read(app.page);
  expect(r.ords).toEqual([['W-ADJ', 2]]);             // ไม่ใช่ 1 (ค่าที่หลุดมา) · W-AUDIT ไม่ขึ้น
  expect(r.badge).toBe(1);
  expect(r.skuSet).toEqual(['W-ADJ']);
  expect(r.noBasis).toEqual([]);
  expect(await app.page.evaluate(() => { renderAdjustDocTable(); return [_canEditAdjDocQty(), document.querySelectorAll('#adjustDocBody input.adj-qty-input').length]; })).toEqual([false, 0]);
  await closeApp(app);
});

test('สวิตช์ปิด → ใบเท่าเดิมทุกไบต์: audit ไม่ขึ้นใบ · ค่าที่แก้ไม่ถูกใช้ · ไม่มีช่องพิมพ์ · ปุ่มไม่นับ audit', async ({ browser }) => {
  const app = await bootBare(browser);
  await seed(app.page, { on: false, items: [
    { sku: 'AU-SHORT', live: 9, sd: AUDIT({ effectiveQty: 12, systemQty: 15 }) },
    { sku: 'SA-DIRECT', live: 7, sd: DIRECT({ effectiveQty: 8, systemQty: 10, adjQty: 1, adjBase: -2, adjBy: 'Pharm', adjAt: 't' }) },
  ] });
  const r = await read(app.page);
  expect(r.ords).toEqual([['SA-DIRECT', 2]]);          // ไม่ใช่ 1 (ค่าที่แก้ถูกเมิน) · AU-SHORT ไม่ขึ้น
  expect(r.badge).toBe(1);
  expect(r.skuSet).toEqual(['SA-DIRECT']);
  expect(await app.page.evaluate(() => { renderAdjustDocTable(); return [_canEditAdjDocQty(), document.querySelectorAll('#adjustDocBody input.adj-qty-input').length]; })).toEqual([false, 0]);

  // เปิดทีละสวิตช์: เปิดเฉพาะ audit → audit ขึ้น แต่ค่าที่แก้ยังไม่ถูกใช้ · เปิดเฉพาะแก้จำนวน → ค่าที่แก้ใช้ได้ แต่ audit ยังไม่ขึ้น
  await app.page.evaluate(() => { PHARMACY_AUDIT_IN_ADJUST_DOC = true; });
  expect((await read(app.page)).ords).toEqual([['AU-SHORT', 3], ['SA-DIRECT', 2]]);
  await app.page.evaluate(() => { PHARMACY_AUDIT_IN_ADJUST_DOC = false; ADJUST_DOC_QTY_EDIT = true; });
  expect((await read(app.page)).ords).toEqual([['SA-DIRECT', 1]]);
  await closeApp(app);
});

test('ยืนยันรีเช็คแล้วผลใหม่แทนเอง: ตรง → ออกจากใบ · ไม่ตรง → ใช้ยอดรีเช็คตามกติกาเดิมของ Stock Adj', async ({ browser }) => {
  const app = await bootBare(browser);
  const at = '2026-10-06T03:00:00.000Z';
  await seed(app.page, { items: [
    { sku: 'AU-A', live: 15, sd: AUDIT({ effectiveQty: 12, systemQty: 15, recheckQty: 15, recheckBy: 'Pharm', recheckAt: at, recheckSystemQty: 15 }) },  // นับใหม่ได้ 15 = ตรง
    { sku: 'AU-B', live: 15, sd: AUDIT({ effectiveQty: 12, systemQty: 15, recheckQty: 14, recheckBy: 'Pharm', recheckAt: at, recheckSystemQty: 15 }) },  // นับใหม่ได้ 14 = ขาด 1
  ] });
  expect((await read(app.page)).ords).toEqual([['AU-A', 3], ['AU-B', 3]]);   // ก่อนยืนยัน: ทั้งคู่ยังเป็นเลขตอน Confirm
  const res = await app.page.evaluate(() => ({ a: confirmAuditVerifyItem('AU-A', true, true), b: confirmAuditVerifyItem('AU-B', true, true) }));
  expect(res).toEqual({ a: 'pass', b: 'stock_adjustment' });
  const r = await read(app.page);
  expect(r.ords).toEqual([['AU-B', 1]]);               // AU-A ผ่าน → ออกจากใบ · AU-B = ยอดรีเช็ค 14 − ยอดสด 15 (กติกาเดิม + ด่านความสด)
  expect(r.irps).toEqual([]);
  expect(r.badge).toBe(1);                              // AU-A เป็น pass แล้ว ไม่นับ
  await closeApp(app);
});

test('แก้จำนวน: Export ใช้ค่าที่แก้ · 0 ไม่ลงไฟล์ · เท่าค่าคำนวณ = ล้าง · ค่าผิดปฏิเสธ · คืนค่าได้ · สั่งเขียน item', async ({ browser }) => {
  const app = await bootBare(browser);
  await seed(app.page, { items: [
    { sku: 'AU-SHORT', live: 9, sd: AUDIT({ effectiveQty: 12, systemQty: 15 }) },     // ORDS 3
    { sku: 'SA-DIRECT', live: 7, sd: DIRECT({ effectiveQty: 8, systemQty: 10 }) },     // ORDS 2
    { sku: 'AU-OVER', live: 3, sd: AUDIT({ effectiveQty: 9, systemQty: 4 }) },         // IRPS 5
  ] });

  await edit(app.page, 'AU-SHORT', '2');
  let ords = await rowsOf(app.page, 'ords');
  expect(ords[0]).toEqual({ sku: 'AU-SHORT', qty: 2, baseQty: 3, edited: true, pending: true });
  // เก็บเป็นฟิลด์แบน (ไม่ซ้อน object — Firestore เรียง key ของ map ใหม่ ทำให้ fingerprint เห็นว่าเปลี่ยนทุก echo)
  const adj = await app.page.evaluate(() => { const s = state.scanData.get('AU-SHORT'); return { q: s.adjQty, base: s.adjBase, by: s.adjBy, at: s.adjAt }; });
  expect(adj).toMatchObject({ q: 2, base: -3, by: 'Pharm' });
  expect(typeof adj.at).toBe('string');
  expect(await app.page.evaluate(() => window.__marked)).toEqual(['AU-SHORT']);          // ซิงก์ผ่าน items (_markSkuDirty)
  expect(await app.page.evaluate(() => state.scanData.get('AU-SHORT').status)).toBe('audit'); // ไม่เปลี่ยนสถานะ/ผลตัดสิน
  expect(await app.page.evaluate(() => state.scanData.get('AU-SHORT').effectiveQty)).toBe(12);

  // Export Text: ค่าที่แก้ลงไฟล์ · ทิศไม่เปลี่ยน
  const text = await exportText(app.page);
  expect(text.trim().split('\r\n').map((l) => l.split('\t').slice(0, 2))).toEqual([['AU-SHORT', '2'], ['SA-DIRECT', '2']]);
  expect(await lastToast(app.page)).toContain('แก้จำนวน 1');

  // แก้เป็น 0 → แถวคงบนจอ (ให้คืนค่าได้) แต่ไม่ลงไฟล์ · toast บอกว่าข้ามกี่แถว
  await edit(app.page, 'SA-DIRECT', '0');
  ords = await rowsOf(app.page, 'ords');
  expect(ords.map((r) => [r.sku, r.qty, r.edited])).toEqual([['AU-SHORT', 2, true], ['SA-DIRECT', 0, true]]);
  const text0 = await exportText(app.page);
  expect(text0.trim().split('\r\n').map((l) => l.split('\t').slice(0, 2))).toEqual([['AU-SHORT', '2']]);
  expect(await lastToast(app.page)).toMatch(/แก้จำนวน 1.*ข้าม 1 \(แก้เป็น 0\)/);

  // Export Excel ใช้ประตูเดียวกัน (กรอง 0 · ค่าที่แก้)
  const sheet = await app.page.evaluate(() => {
    let s = null; const orig = XLSX.writeFile;
    XLSX.writeFile = (wb) => { s = XLSX.utils.sheet_to_json(wb.Sheets.ORDS, { header: 1 }); };
    try { exportAdjustDocExcel(); } finally { XLSX.writeFile = orig; }
    return s;
  });
  expect(sheet.slice(1).map((r) => [r[0], r[1], r[4]])).toEqual([[1, 'AU-SHORT', 2]]);

  // พิมพ์เท่าค่าคำนวณ = ล้างค่าที่แก้ (ล้างครบทุกฟิลด์ ไม่ทิ้งเศษ adjBase/adjBy/adjAt) · บล็อกค่าผิด
  await edit(app.page, 'SA-DIRECT', '2');
  expect(await app.page.evaluate(() => { const s = state.scanData.get('SA-DIRECT'); return [s.adjQty, s.adjBase, s.adjBy, s.adjAt]; })).toEqual([undefined, undefined, undefined, undefined]);
  for (const bad of ['-1', 'abc', '']) {
    await edit(app.page, 'AU-OVER', bad);
    expect(await app.page.evaluate(() => state.scanData.get('AU-OVER').adjQty), `ค่า "${bad}"`).toBeUndefined();
    expect(await lastToast(app.page)).toContain('จำนวนต้องเป็น 0 หรือมากกว่า');
  }
  // แก้ IRPS ได้เหมือนกัน · คืนค่า
  await edit(app.page, 'AU-OVER', '4');
  expect((await rowsOf(app.page, 'irps'))[0]).toMatchObject({ sku: 'AU-OVER', qty: 4, baseQty: 5, edited: true });
  await app.page.evaluate(() => resetAdjDocQty('AU-OVER'));
  expect((await rowsOf(app.page, 'irps'))[0]).toMatchObject({ qty: 5, edited: false });
  expect(await app.page.evaluate(() => { const s = state.scanData.get('AU-OVER'); return [s.adjQty, s.adjBase, s.adjBy, s.adjAt]; })).toEqual([undefined, undefined, undefined, undefined]);
  // แก้ค่าเท่าเดิมซ้ำ (blur โดยไม่เปลี่ยน) → ไม่สั่งเขียน item เพิ่ม
  const before = await app.page.evaluate(() => window.__marked.length);
  await edit(app.page, 'AU-SHORT', '2');
  expect(await app.page.evaluate(() => window.__marked.length)).toBe(before);
  await closeApp(app);
});

test('★ ค่าที่แก้หลุดเองเมื่อผลต่างเปลี่ยน (หลักฐานใหม่: รีเช็ค/R16/↺) — ไม่ค้างเป็นเลขที่ไม่มีใครตรวจ', async ({ browser }) => {
  const app = await bootBare(browser);
  await seed(app.page, { items: [{ sku: 'AU-SHORT', live: 9, sd: AUDIT({ effectiveQty: 12, systemQty: 15 }) }] });
  await edit(app.page, 'AU-SHORT', '2');
  expect((await rowsOf(app.page, 'ords'))[0]).toMatchObject({ qty: 2, edited: true });

  // R16 อัปซ้ำ → marker ใหม่ effective 11 (ขาด 4) → ใช้ค่าคำนวณใหม่ ไม่ใช่ 2
  await app.page.evaluate(() => { state.scanData.get('AU-SHORT').effectiveQty = 11; });
  expect((await rowsOf(app.page, 'ords'))[0]).toMatchObject({ qty: 4, baseQty: 4, edited: false });

  // ผลต่างเปลี่ยนทิศ (เกิน) → ไปแท็บ IRPS ด้วยค่าคำนวณ ไม่ใช่ค่าที่แก้
  await app.page.evaluate(() => { state.scanData.get('AU-SHORT').effectiveQty = 20; });
  expect(await rowsOf(app.page, 'ords')).toEqual([]);
  expect((await rowsOf(app.page, 'irps'))[0]).toMatchObject({ qty: 5, edited: false });

  // หลักฐานชุดเดิมกลับมาตรง base เดิม → ค่าที่แก้ใช้ได้อีก (ผูกกับผลต่าง ไม่ใช่เวลา) และยังมีป้าย "แก้แล้ว" ให้เห็น
  await app.page.evaluate(() => { state.scanData.get('AU-SHORT').effectiveQty = 12; });
  expect((await rowsOf(app.page, 'ords'))[0]).toMatchObject({ qty: 2, edited: true });
  await closeApp(app);
});

test('★ สิทธิ์แก้จำนวน: เฉพาะเภสัช·สาขายา·Desktop·ไม่ติดล็อก Confirm — role/สาขาอื่นเห็นค่าเฉยๆ', async ({ browser }) => {
  const app = await bootBare(browser);
  const items = [
    { sku: 'AU-SHORT', live: 9, sd: AUDIT({ effectiveQty: 12, systemQty: 15 }) },
    { sku: 'AU-OVER', live: 3, sd: AUDIT({ effectiveQty: 9, systemQty: 4 }) },
  ];
  const can = async (branch, role) => {
    await seed(app.page, { branch, role, items });
    return app.page.evaluate(() => { renderAdjustDocTable(); return { can: _canEditAdjDocQty(), inputs: document.querySelectorAll('#adjustDocBody input.adj-qty-input').length }; });
  };
  for (const branch of ['SRC', 'KKL', 'SSS']) expect(await can(branch, 'pharmacist'), branch).toEqual({ can: true, inputs: 1 });   // แท็บ ORDS มี 1 แถว
  expect(await can('SRC', 'assistant')).toEqual({ can: false, inputs: 0 });
  expect(await can('SRC', 'supervisor')).toEqual({ can: false, inputs: 0 });
  expect(await can('WH', 'pharmacist')).toEqual({ can: false, inputs: 0 });
  expect(await can('WH', 'supervisor')).toEqual({ can: false, inputs: 0 });

  // เรียกตรงจาก Console/ผู้ที่ไม่มีสิทธิ์ → ไม่เขียนอะไร
  await seed(app.page, { branch: 'SRC', role: 'assistant', items });
  await edit(app.page, 'AU-SHORT', '1');
  expect(await app.page.evaluate(() => [state.scanData.get('AU-SHORT').adjQty, window.__marked.length])).toEqual([undefined, 0]);

  // PDA (User-Agent) แก้ไม่ได้
  await seed(app.page, { items });
  await app.page.evaluate(() => Object.defineProperty(navigator, 'userAgent', { value: 'Mozilla/5.0 StockCountPDA', configurable: true }));
  expect(await app.page.evaluate(() => _canEditAdjDocQty())).toBe(false);
  await edit(app.page, 'AU-SHORT', '1');
  expect(await app.page.evaluate(() => state.scanData.get('AU-SHORT').adjQty)).toBeUndefined();
  await app.page.evaluate(() => { delete navigator.userAgent; });

  // กำลัง Confirm (ล็อกสาขา) → แก้ไม่ได้ ห้ามแทรกระหว่างงาน Confirm
  await seed(app.page, { items });
  await app.page.evaluate(() => { _branchScanPaused = true; });
  await edit(app.page, 'AU-SHORT', '1');
  await app.page.evaluate(() => resetAdjDocQty('AU-SHORT'));
  expect(await app.page.evaluate(() => [state.scanData.get('AU-SHORT').adjQty, window.__marked.length])).toEqual([undefined, 0]);
  await app.page.evaluate(() => { _branchScanPaused = false; });
  await edit(app.page, 'AU-SHORT', '1');
  expect(await app.page.evaluate(() => state.scanData.get('AU-SHORT').adjQty)).toBe(1);

  // รายการที่ไม่อยู่ในใบ (pass / ไม่มีเลข / ผลต่าง 0 / รอรีเช็คไม่มีเลข) แก้ไม่ได้
  await seed(app.page, { items: [
    { sku: 'PS', live: 5, sd: { status: 'pass', auditStatus: 'approved', countedQty: 5, timestamp: T } },
    { sku: 'AU-NOBASIS', live: 5, sd: AUDIT({}) },
    { sku: 'AU-SETTLED', live: 5, sd: AUDIT({ effectiveQty: 5, systemQty: 5 }) },
  ] });
  for (const sku of ['PS', 'AU-NOBASIS', 'AU-SETTLED', 'NOPE']) {
    await edit(app.page, sku, '1');
    expect(await app.page.evaluate((s) => state.scanData.get(s)?.adjQty, sku), sku).toBeUndefined();
  }
  await closeApp(app);
});

test('กำลังพิมพ์ในช่องจำนวน → ตารางไม่ถูกวาดทับ (LOT/ราคาโหลดเสร็จกลางคัน) · ออกจากช่อง/บันทึกแล้ววาดใหม่ · แสดง "เดิม N" + จำนวนที่แก้', async ({ browser }) => {
  const app = await bootBare(browser);
  await seed(app.page, { items: [{ sku: 'AU-SHORT', live: 9, sd: AUDIT({ effectiveQty: 12, systemQty: 15 }) }] });
  const st = await app.page.evaluate(() => {
    document.getElementById('adjustDocPopupOverlay').style.display = 'flex';   // ช่องต้องมองเห็นถึง focus ได้ (ไม่เรียก openAdjustDocPopup — จะยิง Supabase)
    renderAdjustDocTable();
    const input = () => document.querySelector('#adjustDocBody input.adj-qty-input');
    const first = input();
    first.focus(); first.value = '7';                                           // พิมพ์ค้างไว้ ยังไม่ commit
    renderAdjustDocTable();                                                    // เช่น _refreshAdjMaster โหลดเสร็จ
    const kept = { same: input() === first, value: input().value, deferred: _adjRenderDeferred };
    first.blur();                                                              // ออกจากช่องโดยไม่ commit → วาดใหม่ ค่าที่พิมพ์ค้างหาย (ยังไม่ได้บันทึก)
    const after = { same: input() === first, value: input().value, deferred: _adjRenderDeferred };
    // commit จริง: พิมพ์ + change (Enter) ขณะยังโฟกัสอยู่ → ต้องวาดทันที ไม่รอ blur
    const f2 = input(); f2.focus(); f2.value = '2'; f2.dispatchEvent(new Event('change', { bubbles: true }));
    const note = document.querySelector('#adjustDocBody tr').children[4].textContent.replace(/\s+/g, ' ').trim();
    return { kept, after, committed: { value: input().value, note, count: document.getElementById('adjustDocRowCount').textContent, deferred: _adjRenderDeferred } };
  });
  expect(st.kept).toEqual({ same: true, value: '7', deferred: true });
  expect(st.after).toEqual({ same: false, value: '3', deferred: false });
  expect(st.committed).toEqual({ value: '2', note: 'เดิม 3 · ↺ คืนค่า', count: '1 รายการ · แก้จำนวน 1', deferred: false });

  // คนอื่น (ไม่มีสิทธิ์แก้) เห็นค่าที่แก้ + ป้ายเดิม แต่ไม่มีปุ่มคืนค่า/ช่องพิมพ์
  const ro = await app.page.evaluate(() => {
    currentRole = 'supervisor'; renderAdjustDocTable();
    const td = document.querySelector('#adjustDocBody tr').children[4];
    return { text: td.textContent.replace(/\s+/g, ' ').trim(), inputs: td.querySelectorAll('input').length, links: td.querySelectorAll('a').length };
  });
  expect(ro).toEqual({ text: '2เดิม 3', inputs: 0, links: 0 });   // ตัวเลข + บรรทัดป้าย (div) — ไม่มีช่องพิมพ์/ปุ่มคืนค่า
  await closeApp(app);
});

test('ค่าเริ่มต้น: โหมดซ่อนของเภสัชปิด — ไม่มี audit ค้างก็เห็นช่องสแกน/RESULT/ปุ่มยืนยันรีเช็ค/แท็บรอรีเช็ค · สแกน Stock Adj ที่ไม่ได้ ↺ ยังถูกปฏิเสธ', async ({ browser }) => {
  const app = await bootBare(browser);
  const r = await app.page.evaluate(() => {
    const sw = PHARMACIST_STOCKADJ_ONLY;                 // ค่าเริ่มต้นของ index.html — ห้ามเทสนี้ตั้งเอง
    currentBranch = 'SRC'; currentRole = 'pharmacist'; currentUser = 'T';
    state.scanData.clear(); state.skuMap.clear(); scanListMap.clear();
    state.skuMap.set('SA0', { sku: 'SA0', productName: 'p', unitPrice: 20, systemQty: 5, negSys: false, barcodes: [{ barcode: 'BSA0', unitName: 'ชิ้น', unitMultiplier: 1 }], isDel: false });
    state.barcodeMap.set('BSA0', 'SA0');
    state.scanData.set('SA0', { status: 'stock_adjustment', auditStatus: 'stock_adjustment', initialStatus: 'stock_adjustment', directAdj: true, effectiveQty: 3, systemQty: 5, countedQty: 3, timestamp: '2026-09-20 09:00:00' });
    updateScanInputMode(); applyAuditTerminology(); updateAuditVerifyCount();     // ลำดับเดียวกับ initAfterLogin
    const vis = (sel) => { const e = document.querySelector(sel); return !!e && getComputedStyle(e).display !== 'none'; };
    const ui = { idle: document.body.classList.contains('pharm-audit-idle'), scanBlock: vis('#scanInputBlock'), resultBar: vis('.result-bar'),
      auditBar: vis('#pharmacistAuditBar'), note: vis('#pharmIdleNote') };
    openAuditVerifyPopup();
    const pop = { filter: _avFilter, tabAudit: vis('#avBtnAudit'), scanRow: vis('#avScanRow') };
    // ด่านกันสแกนยังอยู่: Stock Adj ที่ยังไม่ ↺ ไม่เปิดรีเช็คเอง
    window.__toasts = []; toast = (m) => { window.__toasts.push(String(m)); };
    document.getElementById('scanInput').value = 'BSA0'; processPharmacistAuditScan();
    const s = state.scanData.get('SA0');
    return { sw, ui, pop, scan: { status: s.status, recheckQty: s.recheckQty, toast: window.__toasts[0] || '' } };
  });
  expect(r.sw).toBe(false);
  expect(r.ui).toEqual({ idle: false, scanBlock: true, resultBar: true, auditBar: true, note: false });
  expect(r.pop).toEqual({ filter: 'audit', tabAudit: true, scanRow: true });
  expect(r.scan.status).toBe('stock_adjustment');
  expect(r.scan.recheckQty).toBeUndefined();
  expect(r.scan.toast).toContain('กด ↺ สแกนใหม่');
  await closeApp(app);
});

test('ฟิลด์ที่แก้ (adjQty/adjBase/adjBy/adjAt) เดินทางผ่าน payload ของ item (ซิงก์ข้ามเครื่อง) · เปลี่ยนแล้ว fingerprint เปลี่ยน · echo จาก cloud ไม่ทำให้ "เปลี่ยน"', async ({ browser }) => {
  const app = await bootBare(browser);
  const out = await app.page.evaluate(() => {
    currentUser = 'Pharm'; _countResetAt = 'E1';
    const at = '2026-10-06T03:00:00.000Z';
    const sd = { status: 'audit', countedQty: 10, effectiveQty: 12, systemQty: 15, scannedBy: 'A', adjQty: 2, adjBase: -3, adjBy: 'Pharm', adjAt: at };
    const payload = _scanItemPayload('AU-SHORT', sd, 4);
    const pick = (o) => ({ adjQty: o.adjQty, adjBase: o.adjBase, adjBy: o.adjBy, adjAt: o.adjAt });
    const { adjQty, adjBase, adjBy, adjAt, ...rest } = sd;
    // Firestore คืนฟิลด์เรียงตามตัวอักษร — local ที่ echo กลับมาต้องมี fingerprint เท่าเดิม ไม่งั้นทุกการแก้ = rebuild/stats เพิ่มหนึ่งรอบ
    const sortedEcho = Object.fromEntries(Object.entries(sd).sort(([a], [b]) => (a < b ? -1 : 1)));
    return {
      inPayload: pick(payload), back: pick(_scanItemToLocal(payload, undefined)),
      noNested: Object.values(payload).filter((v) => v && typeof v === 'object' && !(v instanceof Date) && v.constructor === Object).length,
      fpDiffers: _scanItemFingerprint(sd) !== _scanItemFingerprint(rest),
      fpEcho: _scanItemFingerprint(sd) === _scanItemFingerprint(sortedEcho),
    };
  });
  const want = { adjQty: 2, adjBase: -3, adjBy: 'Pharm', adjAt: '2026-10-06T03:00:00.000Z' };
  expect(out.inPayload).toEqual(want);
  expect(out.back).toEqual(want);
  expect(out.noNested).toBe(0);
  expect(out.fpDiffers).toBe(true);
  expect(out.fpEcho).toBe(true);
  await closeApp(app);
});
