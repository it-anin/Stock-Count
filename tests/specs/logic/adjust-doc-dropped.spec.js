// ใบปรับปรุงรับเฉพาะยอดรีเช็คที่ยังสด — ยอดหมดอายุต้องถูกตัดออกและขึ้นเป็นรายการงาน
//
// กติกา: จำนวนที่ปรับ = ยอดที่เภสัชนับ − ยอดระบบ **ค่าสด** เพื่อให้ระบบลงเอยเท่ากับยอดที่นับได้
//   (ระบบ 2 · นับ 1 → ORDS ลด 1 → ระบบเหลือ 1)
// ⛔ ห้ามเปลี่ยนไปคำนวณด้วย recheckSystemQty — จะได้ "ปัจจุบัน − ส่วนต่างเก่า" ซึ่งไม่ใช่ยอดที่นับได้
//
// แต่กติกานี้ใช้ได้เมื่อ "ยอดที่นับยังล่าสุดจริง" เท่านั้น · เคสจริง ก.ย. 2026:
//   รีเช็คเดือนก่อน (ระบบ 2 · นับ 1) → ขายไป 1 → ระบบ 1 · ชั้นเหลือ 0
//   ใบคิด 1−1 = 0 → ไม่ทำอะไร ทั้งที่ของยังขาด และแถวหลุดทั้ง ORDS+IRPS แบบเงียบสนิท
// ⇒ recheckSystemQty ใช้เป็น "ตัวจับว่าหมดอายุ" ไม่ใช่ตัวคำนวณ
//
// เทสนี้ตรึง 3 ด้าน และด้านที่ 3 สำคัญที่สุด:
//   1. ยอดหมดอายุต้องออกจากใบ และต้องถูกรายงานพร้อมรหัส SKU
//   2. แยก "ต้องรีเช็คใหม่" ออกจาก "ไม่ต้องปรับแล้ว" — คนละงานคนละวิธีแก้
//   3. ★ ของที่ยังสดต้องผ่านตามปกติ ตัวเลขต้องไม่เปลี่ยน และต้องไม่เตือนผิดตัว
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
  const a = _adjustDocAudit();
  renderAdjustDocTable();
  const box = document.getElementById('adjustDocWarn');
  const ids = (arr) => arr.map((x) => x.sku);
  return {
    ords: _buildAdjustDocRows('ords').map((x) => ({ sku: x.sku, qty: x.qty })),
    irps: _buildAdjustDocRows('irps').map((x) => ({ sku: x.sku, qty: x.qty })),
    badge: _countAdjustDocItems(),
    stale: ids(a.stale), noSku: ids(a.noSku), settled: ids(a.settled),
    warn: box.style.display === 'none' ? '' : box.textContent,
  };
});

test('รีเช็คแล้วยอดระบบขยับจนผลต่างเป็น 0 → ออกจากใบ และต้องถูกรายงาน', async ({ browser }) => {
  const app = await bootBare(browser);
  // รีเช็คตอนระบบมี 10 นับได้ 7 → stock_adjustment · วันรุ่งขึ้นระบบขยับเป็น 7 (ขายไป 3 · ชั้นเหลือ 4)
  await seed(app.page, [{ sku: 'GONE', live: 7, frozen: 10, cnt: 7 }]);
  const r = await read(app.page);

  expect(r.ords).toEqual([]);
  expect(r.irps).toEqual([]);
  expect(r.badge).toBe(1);                 // ปุ่มยังนับ = ความไม่ตรงที่เคยเงียบ
  expect(r.stale).toEqual(['GONE']);
  expect(r.settled).toEqual([]);           // ★ ไม่ใช่ "ไม่ต้องปรับแล้ว" — ของยังขาดอยู่จริง
  expect(r.warn).toContain('ต้องรีเช็คใหม่');
  expect(r.warn).toContain('GONE');        // ★ ต้องหารหัสสินค้าเจอ ไม่ใช่บอกแค่จำนวน
  await closeApp(app);
});

test('ยอดระบบขยับจนสลับทิศ ขาด↔เกิน → ต้องออกจากใบ ไม่ใช่ส่งเลขผิดทิศเข้าระบบ', async ({ browser }) => {
  const app = await bootBare(browser);
  // ตอนรีเช็ค: ระบบ 10 นับ 7 = ขาด 3 (ORDS) · ตอนนี้ระบบเหลือ 5 → 7−5 = เกิน 2 (IRPS)
  await seed(app.page, [{ sku: 'FLIP', live: 5, frozen: 10, cnt: 7 }]);
  const r = await read(app.page);

  expect(r.ords).toEqual([]);
  expect(r.irps).toEqual([]);              // เดิมเคยโผล่ IRPS qty 2 = สั่งเพิ่มของทั้งที่ตอนตัดสินคือขาด
  expect(r.stale).toEqual(['FLIP']);
  await closeApp(app);
});

test('ไม่มีข้อมูลสินค้า (R05 ยังไม่โหลด) → ใบว่างทั้งใบ ต้องเตือน ไม่ใช่ขึ้น "ไม่มีรายการ" เฉยๆ', async ({ browser }) => {
  const app = await bootBare(browser);
  await seed(app.page, [{ sku: 'NOSKU', live: null, cnt: 3 }]);
  const r = await read(app.page);

  expect(r.ords).toEqual([]);
  expect(r.noSku).toEqual(['NOSKU']);
  expect(r.warn).toContain('R05.106');
  await closeApp(app);
});

test('ยอดสดแล้วแต่ตรงพอดี → "ไม่ต้องปรับแล้ว" ไม่ใช่ "ต้องรีเช็คใหม่"', async ({ browser }) => {
  const app = await bootBare(browser);
  // ระบบขยับก็จริง แต่ freeze ขยับตามไปแล้ว (รีเช็ครอบล่าสุดหลัง R01 ใหม่) แล้วผลออกมาตรงพอดี
  await seed(app.page, [{ sku: 'DONE', live: 4, frozen: 4, cnt: 4 }]);
  const r = await read(app.page);

  expect(r.ords).toEqual([]);
  expect(r.irps).toEqual([]);
  expect(r.stale).toEqual([]);             // ★ ห้ามไล่ให้ไปรีเช็คซ้ำทั้งที่ไม่มีอะไรต้องทำ
  expect(r.settled).toEqual(['DONE']);
  expect(r.warn).toContain('ไม่ต้องปรับ');
  await closeApp(app);
});

test('ของที่ยังสดต้องผ่านตามปกติ — ตัวเลขคิดจากยอดระบบปัจจุบันเหมือนเดิม', async ({ browser }) => {
  const app = await bootBare(browser);
  await seed(app.page, [
    { sku: 'SHORT', live: 2, frozen: 2, cnt: 1 },    // ระบบ 2 · นับ 1 → ORDS ลด 1 → ระบบเหลือ 1
    { sku: 'OVER', live: 4, frozen: 4, cnt: 9 },     // เกิน 5 → IRPS
  ]);
  const r = await read(app.page);

  expect(r.ords).toEqual([{ sku: 'SHORT', qty: 1 }]);
  expect(r.irps).toEqual([{ sku: 'OVER', qty: 5 }]);
  expect(r.warn).toBe('');                 // ★ เงียบสนิทเมื่อทุกอย่างสด
  await closeApp(app);
});

test('รายการรอบนับแรก (noStock) ไม่มี freeze → ต้องยังอยู่บนใบเหมือนเดิม ห้ามเตือนผิดตัว', async ({ browser }) => {
  const app = await bootBare(browser);
  // ผู้ช่วยกด 🚫 ไม่มีของ → countedQty 0 · ไม่เคยผ่านมือเภสัช จึงไม่มี recheckSystemQty
  await seed(app.page, [{ sku: 'NOSTOCK', live: 5, cnt: 0, countRound: true }]);
  const r = await read(app.page);

  expect(r.ords).toEqual([{ sku: 'NOSTOCK', qty: 5 }]);
  expect(r.stale).toEqual([]);
  expect(r.settled).toEqual([]);
  expect(r.warn).toBe('');
  await closeApp(app);
});
