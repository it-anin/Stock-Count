// WH: Stock Adj ต้องคิดจาก R01 ของวันที่ Recheck — ไม่ใช่ค่าสดที่บอทอัปทุกเช้า (ก.ย. 2026 · ผู้ใช้สั่ง)
//
// เคสที่ทำให้ต้องมี: วัน Recheck ระบบ (WH_r01) = 36 · รีเช็คได้ 33 → Supervisor ยืนยัน → stock_adjustment (ขาด 3)
//   เช้าวันถัดไปบอทอัป R01 ใหม่ = 33 → ถ้าใช้ค่าสดจะได้ 33−33 = 0 → แถวหายจากใบทั้ง ORDS/IRPS ทั้งที่ขาดจริง 3
// ยอดระบบวัน Recheck ถูกแช่ไว้ใน sd.systemQty ตอนยืนยันรีเช็ค (_applyWhRecheckConfirmationToSku) ⇒ ใช้ตัวนั้น
//
// เทสนี้ตรึง 4 ด้าน:
//   1. WH ทุกจุดที่แสดง Stock Adj ใช้ยอดวัน Recheck ชุดเดียวกัน (ใบ ORDS/IRPS · Audit Verify · ประวัติการนับ · Export Excel)
//   2. ยอดระบบขยับจนทิศกลับ (ขาด↔เกิน) ต้องยังออกใบทิศเดิมที่ตัดสินไว้
//   3. ข้อมูลรุ่นเก่าที่ไม่มี sd.systemQty → ถอยไปใช้ค่าสด (ห้ามโผล่เป็น NaN)
//   4. ★ สาขายาต้องได้พฤติกรรมเดิมเป๊ะ (ค่าสด + ด่านความสด) — ข้อยกเว้นนี้มีเฉพาะ WH
const { test, expect, bootBare, closeApp } = require('../../lib/hooks');

// live = ยอดระบบวันนี้ (skuMap) · atConfirm = sd.systemQty ที่แช่ไว้ตอน Confirm ('NaN' = marker รุ่นเก่า)
// frozen = recheckSystemQty (มีเฉพาะสาขายา — freeze ตอนสแกนรีเช็ค)
async function seed(page, branch, items) {
  await page.evaluate(({ branch, items }) => {
    currentBranch = branch; currentRole = branch === 'WH' ? 'supervisor' : 'pharmacist'; currentUser = 'Sup';
    state.skuMap.clear(); state.scanData.clear(); state.skuDirectMap.clear(); scanListMap.clear(); state.locationMap.clear();
    items.forEach((it) => {
      state.skuMap.set(it.sku, {
        sku: it.sku, productName: 'สินค้า ' + it.sku, unitPrice: 20, systemQty: it.live, negSys: false,
        barcodes: [{ barcode: 'B' + it.sku, unitName: 'ชิ้น', unitMultiplier: 1 }], isDel: false,
      });
      state.skuDirectMap.set(it.sku, { barcode: 'B' + it.sku, unitName: 'ชิ้น' });
      const sd = { status: 'stock_adjustment', auditStatus: 'stock_adjustment', countedQty: it.recheck, recheckQty: it.recheck,
        recheckBy: 'Staff', recheckAt: '2026-09-20T03:00:00.000Z', auditor: 'Sup', timestamp: '2026-09-20 10:00:00', scannedBy: 'Staff' };
      if (it.atConfirm !== undefined) sd.systemQty = it.atConfirm === 'NaN' ? NaN : it.atConfirm;
      if (it.frozen !== undefined) sd.recheckSystemQty = it.frozen;
      state.scanData.set(it.sku, sd);
    });
  }, { branch, items });
}

// อ่านจากตัวที่ render/export จริงทุกจุด — จุดไหนลืมเปลี่ยนจะถูกจับตรงนี้
const read = (page) => page.evaluate(() => {
  const cells = (sel) => [...document.querySelectorAll(sel)].map((tr) => [...tr.children].map((td) => td.textContent.trim()));
  const a = _adjustDocAudit();
  _avFilter = 'stock_adj'; renderAuditVerifyTable();
  const av = cells('#auditVerifyTableBody tr');
  _hsFilter = 'stockadj'; renderHistoryStatsTable();
  const hs = cells('#historyStatsBody tr');
  let xl = null;
  const origWrite = XLSX.writeFile;
  XLSX.writeFile = (wb) => { xl = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 }); };
  try { exportStockAdjExcel(); } finally { XLSX.writeFile = origWrite; }
  return {
    ords: _buildAdjustDocRows('ords').map((x) => ({ sku: x.sku, qty: x.qty })),
    irps: _buildAdjustDocRows('irps').map((x) => ({ sku: x.sku, qty: x.qty })),
    stale: a.stale.map((x) => x.sku), settled: a.settled.map((x) => x.sku),
    av, hs, xl,
  };
});

test('WH: R01 ขยับหลังวัน Recheck → ทุกจุดยังคิดจากยอดวัน Recheck ชุดเดียวกัน', async ({ browser }) => {
  const app = await bootBare(browser);
  // วัน Recheck ระบบ 36 · รีเช็ค 33 · วันนี้ระบบ 33
  await seed(app.page, 'WH', [{ sku: 'W1', live: 33, atConfirm: 36, recheck: 33 }]);
  const r = await read(app.page);

  expect(r.ords).toEqual([{ sku: 'W1', qty: 3 }]);   // ค่าสดจะได้ 0 แล้วแถวหาย
  expect(r.irps).toEqual([]);
  expect(r.stale).toEqual([]);                        // WH ไม่มีด่านความสด
  expect(r.settled).toEqual([]);
  // Audit Verify: Sys Qty · Recheck Qty · Diff
  expect(r.av[0][4]).toBe('36 (ตอนนี้ 33)');
  expect(r.av[0][6]).toBe('-3');
  // ประวัติการนับ (WH มีคอลัมน์ Location): จำนวนคงเหลือ · จำนวนปรับปรุง · Diff
  expect(r.hs[0].slice(6, 9)).toEqual(['36', '33', '-3']);
  // Export Excel: หัว + 1 แถว · จำนวนคงเหลือ = ColF · Diff = ColH
  expect(r.xl.length).toBe(2);
  expect([r.xl[1][5], r.xl[1][6], r.xl[1][7]]).toEqual([36, 33, -3]);
  await closeApp(app);
});

test('WH: ยอดระบบขยับจนทิศกลับ → ต้องออกใบทิศเดิมที่ตัดสินไว้ ไม่ใช่ทิศตามค่าสด', async ({ browser }) => {
  const app = await bootBare(browser);
  // วัน Recheck ระบบ 10 · รีเช็ค 12 = เกิน 2 (IRPS) · วันนี้ระบบ 15 → ค่าสดจะกลายเป็นขาด 3 (ORDS)
  await seed(app.page, 'WH', [{ sku: 'W2', live: 15, atConfirm: 10, recheck: 12 }]);
  const r = await read(app.page);

  expect(r.irps).toEqual([{ sku: 'W2', qty: 2 }]);
  expect(r.ords).toEqual([]);
  await closeApp(app);
});

test('WH: ข้อมูลรุ่นเก่าไม่มียอดวัน Recheck → ถอยไปใช้ค่าสด ห้ามเป็น NaN', async ({ browser }) => {
  const app = await bootBare(browser);
  await seed(app.page, 'WH', [
    { sku: 'W3', live: 5, atConfirm: 'NaN', recheck: 4 },   // marker รีเช็คก่อน workflow v2 → Number(undefined)
    { sku: 'W4', live: 8, recheck: 6 },                     // ไม่มี field เลย
  ]);
  const r = await read(app.page);

  expect(r.ords).toEqual([{ sku: 'W3', qty: 1 }, { sku: 'W4', qty: 2 }]);
  expect(JSON.stringify(r)).not.toContain('NaN');
  await closeApp(app);
});

test('★ สาขายาไม่เปลี่ยน: ยังใช้ค่าสด + ด่านความสด แม้ item มี systemQty ตอน Confirm', async ({ browser }) => {
  const app = await bootBare(browser);
  await seed(app.page, 'SRC', [
    // รีเช็คหลัง R01 ใหม่แล้ว (freeze 33 = ค่าสด) → ใบคิดจากค่าสด 31−33 = ขาด 2 ห้ามคิดจากยอดตอน Confirm (36)
    { sku: 'S1', live: 33, atConfirm: 36, frozen: 33, recheck: 31 },
    // รีเช็คตอนระบบ 36 แต่วันนี้ 33 → ยอดหมดอายุ ต้องหลุดจากใบเหมือนเดิม
    { sku: 'S2', live: 33, atConfirm: 36, frozen: 36, recheck: 33 },
  ]);
  const r = await read(app.page);

  expect(r.ords).toEqual([{ sku: 'S1', qty: 2 }]);
  expect(r.irps).toEqual([]);
  expect(r.stale).toEqual(['S2']);
  // ประวัติการนับ (สาขายาไม่มีคอลัมน์ Location): จำนวนคงเหลือยังเป็นค่าสด
  expect(r.hs.map((row) => row[5])).toEqual(['33', '33']);
  // Audit Verify สาขายายังโชว์ยอดที่ freeze ตอนสแกนรีเช็ค
  expect(r.av.map((row) => row[4])).toEqual(['33', '36 (ตอนนี้ 33)']);
  await closeApp(app);
});
