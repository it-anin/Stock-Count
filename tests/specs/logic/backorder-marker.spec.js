// marker "ผลสุดท้าย" ของการยืนยันรีเช็ค (_pharmacyAuditMarkerFromFinal) ต้องตัดสินตรงกับ confirmAuditVerifyItem — โดยเฉพาะธง "ค้างส่ง" (backorder)
//
// ที่มา (19 ต.ค. 2026): กด ✓ ยืนยันทั้งหมด (_confirmPharmacyAuditBatched) เขียน marker ผลสุดท้ายขึ้น Cloud ก่อน แล้ว apply กลับลงเครื่อง
//   confirmAuditVerifyItem เช็คธง backorder → pass แต่ _pharmacyAuditMarkerFromFinal ตัดสินด้วยสูตร (นับ+R16 == ระบบ) อย่างเดียว
//   ค้างส่ง = นับ 0 vs ระบบติดลบ → ไม่เท่า → marker เป็น stock_adjustment → ถูก apply ทับ pass → รายการกลับเข้าใบ IRPS (ตรงข้ามกับที่ปุ่ม 📦 ค้างส่ง ตั้งใจ)
//   backorder-mark.spec.js เรียกแค่ confirmAuditVerifyItem ตรงๆ จึงไม่เคยเห็น — เส้นทาง marker จริงตรึงไว้ที่ specs/e2e/backorder-marker.spec.js
//
// เทสนี้ตรึงด้านฟังก์ชันบริสุทธิ์: ผล marker == ผลในเครื่อง ทุกชุด (ธง × นับ × ระบบ) · ค้างส่ง = pass เสมอ · ไม่มีธง = สูตรเดิมเป๊ะ
const { test, expect, bootBare, closeApp } = require('../../lib/hooks');

async function prime(page) {
  await page.evaluate(() => {
    currentBranch = 'SRC'; currentRole = 'pharmacist'; currentUser = 'Pharm';
    state.skuMap.clear(); state.scanData.clear(); scanListMap.clear();
    state.r16InboundRawMap.clear(); state.r16InboundMap.clear();
    state.r16RawMap.clear(); state.r16SalesMap.clear();
    state.r16_103Map.clear(); state.r16_103RawMap.clear();
  });
}

// ตัดสินชุดเดียวกันสองทาง: marker (ที่ Cloud) กับ confirmAuditVerifyItem (ในเครื่อง)
const decide = (page, cases) => page.evaluate((cases) => cases.map(({ g, q, b }) => {
  state.skuMap.set('S1', { sku: 'S1', productName: 'x', unitPrice: 20, systemQty: g, negSys: false, barcodes: [], isDel: false });
  const at = new Date().toISOString();
  const source = { status: 'audit', auditStatus: 'pending', initialStatus: 'audit', countedQty: 0, timestamp: '2026-10-19 09:00:00',
    recheckQty: q, recheckBy: 'Pharm', recheckAt: at, recheckSystemQty: g, ...(b ? { backorder: true } : {}) };
  const marker = _pharmacyAuditMarkerFromFinal('S1', { ...source }, at, '2026-10-19 18:00:00', {});
  const sd = { ...source }; state.scanData.set('S1', sd);
  const local = confirmAuditVerifyItem('S1', true, true);
  return { g, q, b, marker: marker.status, auditStatus: marker.auditStatus, local, localStatus: sd.status };
}), cases);

test('ค้างส่ง (R01 ติดลบ · นับ 0) → marker ผลสุดท้ายเป็น pass พร้อมธง · ไม่ใช่ stock_adjustment', async ({ browser }) => {
  const app = await bootBare(browser);
  await prime(app.page);
  const out = await app.page.evaluate(() => {
    state.skuMap.set('S1', { sku: 'S1', productName: 'x', unitPrice: 20, systemQty: -3, negSys: false, barcodes: [], isDel: false });
    const at = new Date().toISOString();
    const m = _pharmacyAuditMarkerFromFinal('S1', { status: 'audit', recheckQty: 0, recheckBy: 'Pharm', recheckAt: at, recheckSystemQty: -3, backorder: true, timestamp: '2026-10-19 09:00:00' }, at, '2026-10-19 18:00:00', {});
    return { status: m.status, auditStatus: m.auditStatus, backorder: m.backorder, recheckQty: m.recheckQty, recheckSystemQty: m.recheckSystemQty,
      systemQty: m.systemQty, directAdj: m.directAdj, auditor: m.auditor };
  });
  expect(out).toEqual({ status: 'pass', auditStatus: 'approved', backorder: true, recheckQty: 0, recheckSystemQty: -3, systemQty: -3, directAdj: false, auditor: 'Pharm' });
  await closeApp(app);
});

test('★ ผล marker ต้องเท่าผลในเครื่อง (confirmAuditVerifyItem) ทุกชุด ธง × ยอดนับ × ยอดระบบ', async ({ browser }) => {
  const app = await bootBare(browser);
  await prime(app.page);
  const cases = [];
  for (const g of [-3, 0, 5]) for (const q of [0, 2, 5]) for (const b of [false, true]) cases.push({ g, q, b });
  const rows = await decide(app.page, cases);
  expect(rows.length).toBe(18);
  // parity: สองทางต้องตัดสินตรงกัน (บั๊กเดิม: ค้างส่งได้ pass ในเครื่องแต่ stock_adjustment ใน marker)
  expect(rows.filter((r) => r.marker !== r.local).map((r) => `g=${r.g} q=${r.q} backorder=${r.b}: marker=${r.marker} local=${r.local}`)).toEqual([]);
  // ค้างส่ง = pass เสมอ ไม่ว่ายอดนับเท่าไร · ไม่มีธง = สูตรเดิม (pass เมื่อ นับ == ระบบ เท่านั้น — ห้ามเหมารวมของติดลบ)
  for (const r of rows) {
    const expected = r.b || r.q === r.g ? 'pass' : 'stock_adjustment';
    expect(r.marker, `g=${r.g} q=${r.q} backorder=${r.b}`).toBe(expected);
    expect(r.auditStatus).toBe(expected === 'pass' ? 'approved' : 'stock_adjustment');
  }
  // ตัวอย่างหลัก: ติดลบ −3 นับ 0 ไม่มีธง ต้องยังเป็น stock_adjustment (ยังออกใบดันยอดกลับ 0 ตามเดิม)
  expect(rows.find((r) => r.g === -3 && r.q === 0 && !r.b).marker).toBe('stock_adjustment');
  await closeApp(app);
});
