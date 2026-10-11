// ใบ 📦: รอรีเช็คที่เภสัชกด ↺ ไม่ขึ้นใบจนกว่าจะยืนยันรีเช็ค (6 ต.ค. 2026 · ผู้ใช้เลือก — เคส 200402) · สวิตช์ ADJUST_DOC_SKIP_REOPENED
//
// ที่มา: ↺ เขียนเลขใน marker ทับเลขตอน Confirm (ยอดนับดิบ + ระบบ ณ ตอนกด) แล้ว backfill ตอน login เขียนซ้ำจาก sd ในเครื่อง
//   (effectiveQty ถอยไปใช้ยอดนับ · systemQty เป็นค่าเก่า) → เลขที่เหลือเชื่อไม่ได้
//   200402: marker เหลือ นับ 6 / ระบบ 6 (+ soldQty 1 / inboundQty 11 ค้างจากเดิม) → ใบเห็นผลต่าง 0 ทั้งที่ยังรอรีเช็ค
//
// เทสนี้ตรึง 6 ด้าน (ด้าน 2 และ 5 สำคัญที่สุด: กติกาใหม่ต้องไม่ลามไปรายการอื่น และต้องถอยได้):
//   1. ★ audit ที่ marker มี reopenedAt ไม่ขึ้นใบ (ทั้ง ORDS/IRPS · รวมเคสเลข 6/6) แม้ sd มีเลขไม่เท่ากัน · รายงานเป็น reopened ไม่หายเงียบ · ยังนับในปุ่ม
//   2. ★ audit ที่ไม่เคย ↺ ขึ้นใบเหมือนเดิมทุกตัวเลข
//   3. ยืนยันรีเช็คแล้ว (ไม่ใช่ audit) ผลใหม่ขึ้นใบตามกติกาเดิมของ Stock Adj แม้ marker ยังเก็บ reopenedAt
//   4. marker ผิดรอบ (ทั้งรายตัวและทั้งเอกสาร) / ไม่มี marker / ค้างส่ง → ไม่ถือเป็น ↺ (พฤติกรรมเดิม)
//   5. ★ ปิดสวิตช์ → ↺ กลับไปใช้เลขใน marker เหมือนเดิมทุกตัวเลข (ทางถอย)
//   6. แถว ↺ แก้จำนวนไม่ได้ (ไม่มีแถวบนใบ) · toast ตอน Export บอกจำนวนที่ไม่ได้อยู่ในไฟล์
const { test, expect, bootBare, closeApp } = require('../../lib/hooks');

const T = '2026-09-20 09:00:00';
const REOPENED_AT = '2026-10-06T03:28:14.124Z';
const AUDIT = (extra = {}) => ({ status: 'audit', auditStatus: 'pending', initialStatus: 'audit', auditor: '', countedQty: 10,
  timestamp: T, firstScanAt: T, scannedBy: 'Asst', soldQty: 2, ...extra });

// items: [{ sku, live, sd }] · markers: { sku: {...ฟิลด์ marker} } (ใส่ countResetAt ให้เองตามรอบที่ตั้ง)
async function seed(page, { items, markers = {}, skip = true, docEpoch = 'E1' } = {}) {
  await page.evaluate(({ items, markers, skip, docEpoch }) => {
    PHARMACY_AUDIT_IN_ADJUST_DOC = true; ADJUST_DOC_QTY_EDIT = true; ADJUST_DOC_SKIP_REOPENED = skip;
    currentBranch = 'SRC'; currentRole = 'pharmacist'; currentUser = 'Pharm'; _countResetAt = 'E1';
    _branchScanPaused = false; _adjDocFilter = 'ords';
    state.skuMap.clear(); state.scanData.clear(); state.skuDirectMap.clear(); scanListMap.clear();
    window.__marked = []; _markSkuDirty = (s) => { window.__marked.push(String(s)); };   // ไม่แตะ Firestore
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
    const mk = {};
    for (const [sku, m] of Object.entries(markers)) mk[sku] = { countResetAt: 'E1', ...m };
    _pharmacyAuditMarkerData = { branch: 'SRC', countResetAt: docEpoch, items: mk };
  }, { items, markers, skip, docEpoch });
}

const read = (page) => page.evaluate(() => {
  const a = _adjustDocAudit();
  const ids = (arr) => arr.map((x) => x.sku).sort();
  const m = (r) => [r.sku, r.qty];
  return {
    ords: _buildAdjustDocRows('ords').map(m).sort(), irps: _buildAdjustDocRows('irps').map(m).sort(), badge: _countAdjustDocItems(),
    stale: ids(a.stale), noSku: ids(a.noSku), settled: ids(a.settled), noBasis: ids(a.noBasis), reopened: ids(a.reopened),
  };
});

// ชุดรายการหลัก: ↺ 3 ตัว (เลขต่างกันทุกทิศ รวมเคส 6/6 แบบ 200402) + ไม่เคย ↺ 2 ตัว (เลขเหมือนกันกับ ↺ สองตัวแรก)
const ITEMS = [
  { sku: 'R-SHORT', live: 9, sd: AUDIT({ effectiveQty: 12, systemQty: 15 }) },   // ถ้าไม่ ↺ = ORDS 3
  { sku: 'R-OVER', live: 3, sd: AUDIT({ effectiveQty: 9, systemQty: 4 }) },      // ถ้าไม่ ↺ = IRPS 5
  { sku: 'R-ZERO', live: 6, sd: AUDIT({ effectiveQty: 6, systemQty: 6 }) },      // 200402: 6/6 หลัง ↺ + backfill → เดิมเป็น settled
  { sku: 'N-SHORT', live: 9, sd: AUDIT({ effectiveQty: 12, systemQty: 15 }) },   // ไม่เคย ↺ → ORDS 3
  { sku: 'N-OVER', live: 3, sd: AUDIT({ effectiveQty: 9, systemQty: 4 }) },      // ไม่เคย ↺ → IRPS 5
];
const REOPENED_MARKERS = {
  'R-SHORT': { status: 'audit', auditor: '', reopenedAt: REOPENED_AT },
  'R-OVER': { status: 'audit', auditor: '', reopenedAt: REOPENED_AT },
  'R-ZERO': { status: 'audit', auditor: '', reopenedAt: REOPENED_AT },
  'N-SHORT': { status: 'audit', auditor: '' },   // marker ของ audit ธรรมดา — ไม่มี reopenedAt
  'N-OVER': { status: 'audit', auditor: '' },
};

test('★ ↺ รอรีเช็คไม่ขึ้นใบ · ที่ไม่เคย ↺ ขึ้นเหมือนเดิม · รายงานเป็น reopened (ไม่หายเงียบ) · ยังนับในปุ่ม', async ({ browser }) => {
  const app = await bootBare(browser);
  await seed(app.page, { items: ITEMS, markers: REOPENED_MARKERS });
  expect(await read(app.page)).toEqual({
    ords: [['N-SHORT', 3]], irps: [['N-OVER', 5]], badge: 5,
    stale: [], noSku: [], settled: [], noBasis: [], reopened: ['R-OVER', 'R-SHORT', 'R-ZERO'],   // R-ZERO ไม่ใช่ settled แล้ว — เลข 6/6 ของมันเชื่อไม่ได้
  });
  await closeApp(app);
});

test('ยืนยันรีเช็คแล้ว (ไม่ใช่ audit) → ขึ้นใบตามกติกาเดิมของ Stock Adj แม้ marker ยังเก็บ reopenedAt · pass ไม่ขึ้น', async ({ browser }) => {
  const app = await bootBare(browser);
  await seed(app.page, {
    items: [
      // รีเช็ค 2 เทียบระบบ ณ ตอนรีเช็ค 5 → ขาด 3 (ยอดสด 5 = ยังสด จึงผ่านด่านความสด)
      { sku: 'V-ADJ', live: 5, sd: { status: 'stock_adjustment', auditStatus: 'stock_adjustment', initialStatus: 'audit', auditor: 'Ph', countedQty: 3,
        recheckQty: 2, recheckBy: 'Ph', recheckAt: '2026-10-06T04:17:22.710Z', recheckSystemQty: 5, timestamp: T, firstScanAt: T, scannedBy: 'Asst' } },
      { sku: 'V-PASS', live: 5, sd: { status: 'pass', auditStatus: 'approved', initialStatus: 'audit', auditor: 'Ph', countedQty: 5,
        recheckQty: 5, recheckBy: 'Ph', recheckAt: '2026-10-06T04:17:22.710Z', recheckSystemQty: 5, timestamp: T, firstScanAt: T, scannedBy: 'Asst' } },
    ],
    markers: {
      'V-ADJ': { status: 'stock_adjustment', auditor: 'Ph', reopenedAt: REOPENED_AT },
      'V-PASS': { status: 'pass', auditor: 'Ph', reopenedAt: REOPENED_AT },
    },
  });
  expect(await read(app.page)).toEqual({ ords: [['V-ADJ', 3]], irps: [], badge: 1, stale: [], noSku: [], settled: [], noBasis: [], reopened: [] });
  await closeApp(app);
});

test('marker ผิดรอบ / ไม่มี marker / ค้างส่ง → ไม่ถือเป็น ↺ (พฤติกรรมเดิม)', async ({ browser }) => {
  const app = await bootBare(browser);
  await seed(app.page, {
    items: [
      { sku: 'X-OLDEPOCH', live: 9, sd: AUDIT({ effectiveQty: 12, systemQty: 15 }) },                 // marker ของรอบเก่า → ไม่นับว่า ↺
      { sku: 'X-NOMARKER', live: 3, sd: AUDIT({ effectiveQty: 9, systemQty: 4 }) },                    // ไม่มี marker เลย
      { sku: 'X-BACK', live: 9, sd: AUDIT({ effectiveQty: 12, systemQty: 15, backorder: true }) },    // ค้างส่ง → ไม่ใช่งานของใบ (ชนะ ↺ เสมอ) ไม่นับ ไม่รายงาน
    ],
    markers: {
      'X-OLDEPOCH': { status: 'audit', auditor: '', reopenedAt: REOPENED_AT, countResetAt: 'E0' },
      'X-BACK': { status: 'audit', auditor: '', reopenedAt: REOPENED_AT },
    },
  });
  expect(await read(app.page)).toEqual({ ords: [['X-OLDEPOCH', 3]], irps: [['X-NOMARKER', 5]], badge: 2,
    stale: [], noSku: [], settled: [], noBasis: [], reopened: [] });

  // ทั้งเอกสาร marker เป็นของรอบเก่า (เหมือนยังไม่โหลด marker ของรอบนี้) → ไม่มีใครถูกถือว่า ↺
  await seed(app.page, { items: ITEMS, markers: REOPENED_MARKERS, docEpoch: 'E0' });
  expect(await read(app.page)).toEqual({
    ords: [['N-SHORT', 3], ['R-SHORT', 3]], irps: [['N-OVER', 5], ['R-OVER', 5]], badge: 5,
    stale: [], noSku: [], settled: ['R-ZERO'], noBasis: [], reopened: [],
  });
  await closeApp(app);
});

test('★ ปิดสวิตช์ ADJUST_DOC_SKIP_REOPENED → ↺ กลับไปใช้เลขใน marker เหมือนเดิมทุกตัวเลข (ทางถอย)', async ({ browser }) => {
  const app = await bootBare(browser);
  await seed(app.page, { items: ITEMS, markers: REOPENED_MARKERS, skip: false });
  expect(await read(app.page)).toEqual({
    ords: [['N-SHORT', 3], ['R-SHORT', 3]], irps: [['N-OVER', 5], ['R-OVER', 5]], badge: 5,
    stale: [], noSku: [], settled: ['R-ZERO'], noBasis: [], reopened: [],
  });
  await closeApp(app);
});

test('แถว ↺ แก้จำนวนไม่ได้ · Export ไม่มีแถว ↺ และ toast บอกจำนวนที่ไม่ได้อยู่ในไฟล์ · ไม่เขียนอะไร', async ({ browser }) => {
  const app = await bootBare(browser);
  await seed(app.page, { items: ITEMS, markers: REOPENED_MARKERS });

  // พยายามแก้จำนวนของ ↺ (เช่นเรียกจาก Console) → ปฏิเสธ ไม่เขียนฟิลด์ adj*
  const edit = await app.page.evaluate(() => { setAdjDocQty('R-SHORT', 1); const s = state.scanData.get('R-SHORT'); return { toast: window.__toasts.pop(), adjQty: s.adjQty, marked: window.__marked }; });
  expect(edit).toEqual({ toast: 'รายการนี้แก้จำนวนไม่ได้', adjQty: undefined, marked: [] });

  // Export Text แท็บ ORDS: มีเฉพาะ N-SHORT · toast เตือนบอก "รอรีเช็คหลังกด ↺ 3"
  const out = await app.page.evaluate(async () => {
    window.__toasts = []; window.__exports = [];
    exportAdjustDocText();
    const text = window.__exports.length ? await window.__exports[window.__exports.length - 1].text() : null;
    return { text, toasts: window.__toasts };
  });
  expect(out.text).toBe('N-SHORT\t3\t\t\t\t\t\t\t\t\r\n');
  expect(out.toasts.some((t) => t.startsWith('Export ORDS 1 รายการ (Text) สำเร็จ'))).toBe(true);
  expect(out.toasts.find((t) => t.startsWith('⚠️'))).toBe('⚠️ 3 รายการไม่อยู่ในไฟล์ (รอรีเช็คหลัง ↺ 3)');
  expect(await app.page.evaluate(() => window.__marked)).toEqual([]);
  await closeApp(app);
});
