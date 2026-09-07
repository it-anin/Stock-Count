// ใบปรับสต็อก (📦 ปรับปรุงสินค้า) ต้องไม่ทำรายการหายเงียบ
//
// เคสจริง ก.ย. 2026: ระบบ "ตัดสิน" stock_adjustment ด้วยยอดระบบที่ freeze ตอนสแกน
// (sd.recheckSystemQty · confirmAuditVerifyItem) แต่ "ใบ" คิดจาก si.systemQty ค่าสด
// พอบอท auto-r01 อัป R01 ทุกเช้า ยอดระบบขยับ แล้ว cnt − live กลายเป็น 0
//   → แถวหลุดทั้ง ORDS (diff>=0) และ IRPS (diff<=0) พร้อมกัน
//   → badge บนปุ่มนับทุก stock_adjustment จึงมากกว่าจำนวนแถวบนใบ โดยไม่มีอะไรเตือน
//
// การตัดสินใจ: ไม่แก้ตัวเลขบนใบ (ตอน R01 ขยับ ของบนชั้นก็ขยับ ยอดนับเก่าก็ไม่น่าเชื่อเหมือนกัน)
// แต่ต้อง "บอกให้รู้" — เทสนี้จึงตรึง 2 ด้านคู่กัน และด้านที่ 3 สำคัญที่สุด:
//   1. ตัวที่หายต้องถูกรายงาน
//   2. ตัวที่ปกติต้องไม่ถูกเตือนผิด (โดยเฉพาะ noStock ที่ไม่มี recheckSystemQty)
//   3. ★ ตัวเลขบนใบต้องไม่เปลี่ยนเลย — งานนี้เพิ่มการมองเห็นอย่างเดียว
const { test, expect, bootBare, closeApp } = require('../../lib/hooks');

// live = ยอดระบบปัจจุบัน (skuMap) · frozen = ยอดระบบ ณ เวลารีเช็ค (undefined = ไม่เคย freeze)
async function seed(page, items) {
  await page.evaluate(({ items }) => {
    currentBranch = 'SRC'; currentRole = 'pharmacist'; currentUser = 'Pharm';
    state.skuMap.clear(); state.scanData.clear(); state.skuDirectMap.clear(); scanListMap.clear();
    items.forEach((it) => {
      if (it.live !== null) {
        state.skuMap.set(it.sku, {
          sku: it.sku, productName: 'สินค้า ' + it.sku, unitPrice: 20,
          systemQty: it.live, negSys: false, barcodes: [], isDel: false,
        });
        state.skuDirectMap.set(it.sku, { barcode: 'B' + it.sku, unitName: 'เม็ด' });
      }
      const sd = { status: 'stock_adjustment', auditStatus: 'stock_adjustment', countedQty: it.cnt,
        timestamp: '2026-09-01 10:00:00', scannedBy: 'Asst' };
      if (!it.countRound) { sd.recheckQty = it.cnt; sd.recheckBy = 'Pharm'; sd.recheckAt = '2026-09-01T03:00:00.000Z'; }
      if (it.frozen !== undefined) sd.recheckSystemQty = it.frozen;
      state.scanData.set(it.sku, sd);
    });
  }, { items });
}

// อ่านแถบเตือน "จากที่ render จริง" ไม่ใช่จากสตริงกลางทาง — พังตอนต่อสายเข้า DOM จะถูกจับด้วย
const read = (page) => page.evaluate(() => {
  const audit = _adjustDocAudit();
  renderAdjustDocTable();
  const box = document.getElementById('adjustDocWarn');
  return {
    ords: _buildAdjustDocRows('ords').map((x) => ({ sku: x.sku, qty: x.qty })),
    irps: _buildAdjustDocRows('irps').map((x) => ({ sku: x.sku, qty: x.qty })),
    badge: _countAdjustDocItems(),
    dropped: audit.dropped.map((d) => ({ sku: d.sku, reason: d.reason })),
    moved: audit.moved.map((m) => ({ sku: m.sku, flipped: m.flipped })),
    warn: box.style.display === 'none' ? '' : box.textContent,
  };
});

test('ยอดระบบขยับจนผลต่างเป็น 0 → หลุดทั้ง 2 แท็บ แต่ต้องถูกรายงาน', async ({ browser }) => {
  const app = await bootBare(browser);
  // รีเช็คตอนระบบมี 10 นับได้ 7 → ตัดสิน stock_adjustment · วันรุ่งขึ้นระบบขยับเป็น 7
  await seed(app.page, [{ sku: 'GONE', live: 7, frozen: 10, cnt: 7 }]);
  const r = await read(app.page);

  expect(r.ords).toEqual([]);            // พฤติกรรมเดิม — ไม่ได้แก้ให้มันโผล่
  expect(r.irps).toEqual([]);
  expect(r.badge).toBe(1);               // แต่ปุ่มยังนับอยู่ = ความไม่ตรงที่เคยเงียบ
  expect(r.dropped).toEqual([{ sku: 'GONE', reason: 'zero' }]);
  expect(r.warn).toContain('หลุดจากใบปรับปรุง');
  expect(r.warn).toContain('GONE');      // ★ ต้องหารหัสสินค้าเจอได้ ไม่ใช่บอกแค่จำนวน
  await closeApp(app);
});

test('ไม่มีข้อมูลสินค้า (R05 ยังไม่โหลด) → ใบว่างทั้งใบ ต้องเตือน ไม่ใช่ขึ้น "ไม่มีรายการ" เฉยๆ', async ({ browser }) => {
  const app = await bootBare(browser);
  await seed(app.page, [{ sku: 'NOSKU', live: null, cnt: 3 }]);
  const r = await read(app.page);

  expect(r.ords).toEqual([]);
  expect(r.dropped).toEqual([{ sku: 'NOSKU', reason: 'no_sku' }]);
  expect(r.warn).toContain('R05.106');
  await closeApp(app);
});

test('ทุกอย่างปกติ → ต้องไม่เตือนผิดตัว (รวม noStock ที่ไม่เคย freeze)', async ({ browser }) => {
  const app = await bootBare(browser);
  const r = await (async () => {
    await seed(app.page, [
      { sku: 'NORMAL', live: 10, frozen: 10, cnt: 7 },   // รีเช็คปกติ ยอดระบบไม่ขยับ
      { sku: 'NOSTOCK', live: 5, cnt: 0, countRound: true }, // รอบนับแรก ไม่มี recheckSystemQty → fallback = live
    ]);
    return read(app.page);
  })();

  expect(r.dropped).toEqual([]);
  expect(r.moved).toEqual([]);
  expect(r.warn).toBe('');               // ★ เงียบสนิทเมื่อไม่มีอะไรผิด
  await closeApp(app);
});

test('ตัวเลขบนใบต้องไม่เปลี่ยน — งานนี้เพิ่มการมองเห็นอย่างเดียว', async ({ browser }) => {
  const app = await bootBare(browser);
  await seed(app.page, [
    { sku: 'SHORT', live: 10, frozen: 10, cnt: 7 },   // ขาด 3 → ORDS
    { sku: 'OVER', live: 4, frozen: 4, cnt: 9 },      // เกิน 5 → IRPS
  ]);
  const r = await read(app.page);

  expect(r.ords).toEqual([{ sku: 'SHORT', qty: 3 }]);
  expect(r.irps).toEqual([{ sku: 'OVER', qty: 5 }]);  // qty ยังมาจาก si.systemQty ค่าสดตามเดิม
  await closeApp(app);
});

test('ยอดระบบขยับจนสลับทิศ ขาด↔เกิน → ยังอยู่บนใบ แต่ต้องติดธง flipped', async ({ browser }) => {
  const app = await bootBare(browser);
  // ตอนรีเช็ค: ระบบ 10 นับ 7 = ขาด 3 (ORDS) · ตอนนี้ระบบเหลือ 5 → 7−5 = เกิน 2 (IRPS)
  await seed(app.page, [{ sku: 'FLIP', live: 5, frozen: 10, cnt: 7 }]);
  const r = await read(app.page);

  expect(r.ords).toEqual([]);
  expect(r.irps).toEqual([{ sku: 'FLIP', qty: 2 }]);  // ตัวเลขไม่ถูกแตะ
  expect(r.dropped).toEqual([]);                      // ไม่ได้หาย แค่ย้ายแท็บ
  expect(r.moved).toEqual([{ sku: 'FLIP', flipped: true }]);
  expect(r.warn).toContain('สลับขาด↔เกิน');
  await closeApp(app);
});
