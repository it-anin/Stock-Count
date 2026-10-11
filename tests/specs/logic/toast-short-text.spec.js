// toast ข้อความสั้น (ต.ค. 2026 · ผู้ใช้สั่ง "ย่อข้อความเหล่านี้ให้สั้นลง")
// toast บน Desktop ไม่ตัดบรรทัด (white-space:nowrap · ไม่มี max-width) — ข้อความกว้างเกินหน้าต่าง = หัว-ท้ายถูกตัดหายทั้งสองข้าง
// ตรึง:
//   1. _shortErr — error ที่ต่อท้าย toast ถูกตัดให้สั้น · เพดาน 1 MiB เป็นไทย · ข้อความไทยของเราเอง (คำแนะนำ) ต้องไม่ถูกตัด
//   2. เส้นทางจริงส่งข้อความชุดใหม่ (R01 · R16.104/103 จับคู่ไม่ได้ · WH R16 ไม่พร้อม · วันที่/เวลา R16 · อัปโหลด Cloud ล้ม)
//   3. PDA ยังย่อข้อความชุดใหม่ได้ — คีย์/regex ใน _toastMessageForDevice ต้องแก้คู่กับข้อความเสมอ
//   4. วันที่สแกนหลายสิบวันถูกย่อเป็นช่วงใน toast (รายการเต็มยังอยู่ใน r16MismatchDetail)
//   5. ข้อความที่ย่อแล้วไม่ล้นหน้าต่างครึ่งจอ (960px) บน Desktop
const { test, expect, bootBare, closeApp, newAppContext, waitForAppReady } = require('../../lib/hooks');
const F = require('../../lib/fixtures');

const csv = (name, text) => ({ name, mimeType: 'text/csv', buffer: Buffer.from(text, 'utf8') });

// โครง R16 เดียวกับ r16-wh-transfer.spec.js — 0=Col A 1=TRANDATE 2=TRANNO(Col C) 9=FCANCEL 14=SCANCODE 17=BASEQUANTITY 23=ITEMID
const HEAD = ['SYSWAREHOUSEID', 'TRANDATE', 'TRANNO', 'REFERENCENO1', 'SYSVOUCHERID', 'SYSSALEID',
  'TOTAL', 'TOTALVAT', 'GRANDTOTAL', 'FCANCEL', 'TAXRATE', 'SYSPERSONID', 'c12', 'c13',
  'SCANCODE', 'ITEMNAME', 'c16', 'BASEQUANTITY', 'c18', 'c19', 'c20', 'c21', 'c22', 'ITEMID'];
function row({ tranNo, barcode = 'B-1', sku = 'S-1', qty = 1, at = '7/10/2026 13:13:03' }) {
  const r = new Array(24).fill('');
  r[0] = '1'; r[1] = at; r[2] = tranNo; r[9] = '0'; r[14] = barcode; r[17] = String(qty); r[23] = sku;
  return r;
}
const toCsv = (rows) => [HEAD, ...rows].map((r) => r.join(',')).join('\r\n');

// เก็บข้อความ toast จริงที่หน้าเว็บส่ง (ยังแสดงตามปกติ)
async function capture(page) {
  await page.evaluate(() => {
    window.__cap = [];
    const real = window.toast;
    window.toast = (m, type, ms) => { window.__cap.push(String(m)); return real(m, type, ms); };
  });
}
const waitCap = (page, prefix) => page.waitForFunction((p) => window.__cap.some((m) => m.startsWith(p)), prefix, { polling: 50 });
const takeCap = (page, prefix) => page.evaluate((p) => window.__cap.filter((m) => m.startsWith(p)), prefix);

// สาขายา (เภสัช) · ไม่มี Cloud · แคตตาล็อก n SKU (S-1… / B-1…) · scans = [[sku, 'YYYY-MM-DD HH:mm:ss'], …]
async function seed(page, { branch = 'SRC', n = 1, scans = [] } = {}) {
  await page.evaluate(({ branch, n, scans }) => {
    currentBranch = branch; currentRole = branch === 'WH' ? 'supervisor' : 'pharmacist'; currentUser = 'Tester';
    _db = null; _r01BaselineAt = '';
    state.barcodeMap.clear(); state.skuMap.clear(); state.scanData.clear(); state.r16DateMismatch = false;
    for (let i = 1; i <= n; i++) {
      state.barcodeMap.set('B-' + i, 'S-' + i);
      state.skuMap.set('S-' + i, { productName: 'ของทดสอบ ' + i, unitPrice: 10, systemQty: 5, barcodes: [{ barcode: 'B-' + i, unitMultiplier: 1 }] });
    }
    for (const [sku, ts] of scans) state.scanData.set(sku, { countedQty: 1, status: 'scanning', timestamp: ts, scannedBy: 'Tester' });
  }, { branch, n, scans });
}
const uploadR16 = (page, rows) => page.setInputFiles('#fileR16', csv('r16.csv', toCsv(rows)));


test('_shortErr — error ยาวถูกตัด · เพดาน 1 MiB เป็นไทย · ข้อความไทยของเราไม่ถูกตัด', async ({ browser }) => {
  const app = await bootBare(browser);
  const r = await app.page.evaluate(() => ({
    plain: _shortErr('R01 BOOM'),
    err: _shortErr(new Error('Missing or insufficient permissions.')),
    prefix: _shortErr('FirebaseError: unavailable'),
    empty: [_shortErr(undefined), _shortErr(null), _shortErr('')],
    size: _shortErr(new Error("Document 'projects/p/databases/(default)/documents/stock_sessions/global_r05' cannot be written because its size (1,094,869 bytes) exceeds the maximum allowed size of 1,048,576 bytes.")),
    exact: _shortErr('y'.repeat(60)),
    over: _shortErr('y'.repeat(61)),
    long: _shortErr('x'.repeat(200)),
    hint: _shortErr('ประวัติใหญ่ 820 KB ใกล้เพดาน Firestore — นำเข้าช่วงวันที่สั้นลง'),
    thai: _shortErr('ก่'.repeat(100)),
    emoji: _shortErr('📦'.repeat(100)),
    code: _shortErr(Object.assign(new Error('z'.repeat(100)), { code: 'unavailable' })),       // ยาว + มีรหัส → รหัส
    codeShort: _shortErr(Object.assign(new Error('Failed to get document because the client is offline.'), { code: 'unavailable' })),   // สั้นพอ → ข้อความ (อ่านรู้เรื่องกว่ารหัส)
  }));
  expect(r.plain).toBe('R01 BOOM');
  expect(r.err).toBe('Missing or insufficient permissions.');
  expect(r.prefix).toBe('unavailable');
  expect(r.empty).toEqual(['', '', '']);
  expect(r.size).toBe('ข้อมูลเกินเพดาน 1 MiB');
  expect(r.exact).toBe('y'.repeat(60));                 // พอดีเพดาน = ไม่ตัด
  expect(r.over).toBe('y'.repeat(59) + '…');
  expect(r.long).toBe('x'.repeat(59) + '…');
  expect(r.hint).toBe('ประวัติใหญ่ 820 KB ใกล้เพดาน Firestore — นำเข้าช่วงวันที่สั้นลง');   // คำแนะนำต้องอยู่ครบ (สระ/วรรณยุกต์ไม่นับ)
  expect(r.thai).toBe('ก่'.repeat(59) + '…');           // ไม่นับวรรณยุกต์ และวรรณยุกต์เกาะตัวสุดท้ายไปด้วย
  expect(r.emoji).toBe('📦'.repeat(59) + '…');          // ไม่ผ่ากลาง surrogate
  expect(r.code).toBe('unavailable');
  expect(r.codeShort).toBe('Failed to get document because the client is offline.');
  await closeApp(app);
});

test('R01 อัปโหลด — ข้อความชุดใหม่ (สาขายา / WH)', async ({ browser }) => {
  const app = await bootBare(browser);
  await capture(app.page);
  const nc = F.r01Rows.filter((r) => String(r.colP).startsWith('11.')).length;
  const so = F.r01Rows.filter((r) => /DELETE/.test(r.colP)).length;
  expect(nc).toBeGreaterThan(0); expect(so).toBeGreaterThan(0);   // fixture มีทั้งสองหมวดจริง
  const out = {};
  for (const b of ['SRC', 'WH']) {
    await app.page.evaluate((b) => { window.__cap = []; currentBranch = b; currentRole = b === 'WH' ? 'supervisor' : 'pharmacist'; _db = null; }, b);
    await app.page.setInputFiles('#fileR01', csv('r01.csv', F.toR01Csv()));
    await waitCap(app.page, 'R01.102: ');
    out[b] = (await takeCap(app.page, 'R01.102: '))[0];
  }
  const head = `R01.102: ${F.r01Rows.length} รายการ · หมวด 11. ไม่นับ ${nc} · หมวด DELETE ${so}`;
  expect(out.SRC).toBe(`${head} · ล้าง R16 แล้ว อัปใหม่ก่อน Confirm`);
  expect(out.WH).toBe(`${head} · อัป R16.104/103 ใหม่ก่อน Confirm`);
  await closeApp(app);
});

test('R16.104 / R16.103 จับคู่ไม่ได้ · WH R16 ยังไม่พร้อม — ข้อความชุดใหม่', async ({ browser }) => {
  const app = await bootBare(browser);
  await seed(app.page);
  await capture(app.page);

  await uploadR16(app.page, [row({ tranNo: 'ORCMBY001', barcode: 'B-NOPE', sku: 'NOPE' })]);
  await waitCap(app.page, 'R16.104 จับคู่ไม่ได้');
  const sample = (await takeCap(app.page, 'R16.104 จับคู่ไม่ได้'))[0];
  expect(sample).toBe('R16.104 จับคู่ไม่ได้ — R16:"B-NOPE" vs R05:"B-1" (ดู Console)');

  await app.page.evaluate(() => { window.__cap = []; });
  await uploadR16(app.page, [row({ tranNo: 'ZZZZ001' })]);
  await waitCap(app.page, 'R16.104 จับคู่ไม่ได้');
  const none = (await takeCap(app.page, 'R16.104 จับคู่ไม่ได้'))[0];
  expect(none).toBe('R16.104 จับคู่ไม่ได้ — ไม่มีแถว ORCM/OCTM/OTFB/ORTS/OTFI');

  await app.page.setInputFiles('#fileR16_103', csv('r16103.csv', toCsv([row({ tranNo: 'ITFW001', barcode: 'B-NOPE', sku: 'NOPE' })])));
  await waitCap(app.page, 'R16.103 จับคู่ไม่ได้');
  const r103 = (await takeCap(app.page, 'R16.103 จับคู่ไม่ได้'))[0];
  expect(r103).toBe('R16.103 จับคู่ไม่ได้ — Col C ต้องมี IRNC/IRVC/IRNM/ICSM/ITFB/ITFW/IPOS/IRCN');
  // รายการ code ในข้อความต้องตรงกับที่ parser ยอมรับจริง
  expect(await app.page.evaluate(() => R16_103_PREFIXES.join('/'))).toBe('IRNC/IRVC/IRNM/ICSM/ITFB/ITFW/IPOS/IRCN');

  const notReady = await app.page.evaluate(() => {
    window.__cap = []; currentBranch = 'WH'; _whR16TimelineLoading = false; _whR16TimelineReady = false;
    return [_ensureWhR16TimelineReady(), window.__cap.slice()];
  });
  expect(notReady).toEqual([false, ['R16.104 บน Cloud ยังไม่พร้อม — อัปโหลด R16.104 ใหม่ที่เครื่องใดก็ได้']]);
  await closeApp(app);
});

test('วันที่ R16 ไม่ตรงวันสแกน — หลายวันย่อเป็นช่วง (รายละเอียดเต็มยังอยู่) · ≤ 2 วันแสดงครบ', async ({ browser }) => {
  const app = await bootBare(browser);
  const days = Array.from({ length: 30 }, (_, i) => String(i + 1).padStart(2, '0'));
  await seed(app.page, { n: 30, scans: days.map((d, i) => ['S-' + (i + 1), `2026-08-${d} 10:00:00`]) });
  await capture(app.page);
  await uploadR16(app.page, [row({ tranNo: 'ORCMBY001', at: '7/10/2026 10:00:00' })]);
  await waitCap(app.page, '⚠️ วันที่ R16');
  const many = (await takeCap(app.page, '⚠️ วันที่ R16'))[0];
  expect(many).toBe('⚠️ วันที่ R16 (07/10/2026) ไม่ตรงกับวันที่สแกน (01/08/2026–30/08/2026 · 30 วัน)');
  const detail = await app.page.evaluate(() => document.getElementById('r16MismatchDetail').textContent);
  expect(detail).toContain('15/08/2026');                        // รายการเต็มไม่หาย — ย่อเฉพาะ toast
  expect((await takeCap(app.page, 'R16 อัปเดตแล้ว'))[0]).toBe('R16 อัปเดตแล้ว — ใช้คำนวณรายการที่นับวันนี้');

  await seed(app.page, { n: 2, scans: [['S-1', '2026-08-01 10:00:00'], ['S-2', '2026-08-02 10:00:00']] });
  await capture(app.page);
  await uploadR16(app.page, [row({ tranNo: 'ORCMBY001', at: '7/10/2026 10:00:00' })]);
  await waitCap(app.page, '⚠️ วันที่ R16');
  expect((await takeCap(app.page, '⚠️ วันที่ R16'))[0]).toBe('⚠️ วันที่ R16 (07/10/2026) ไม่ตรงกับวันที่สแกน (01/08/2026, 02/08/2026)');
  await closeApp(app);
});

test('R16 ครอบไม่ถึงเวลานับล่าสุด — ข้อความชุดใหม่ (คำนำหน้า "R16 มีข้อมูลถึง" คงเดิม)', async ({ browser }) => {
  const app = await bootBare(browser);
  await seed(app.page, { scans: [['S-1', '2026-10-07 15:00:00']] });
  await capture(app.page);
  await uploadR16(app.page, [row({ tranNo: 'ORCMBY001', at: '7/10/2026 13:13:03' })]);
  await waitCap(app.page, '⚠️ R16 มีข้อมูลถึง');
  const t = (await takeCap(app.page, '⚠️ R16 มีข้อมูลถึง'))[0];
  expect(t).toBe('⚠️ R16 มีข้อมูลถึง 07/10 13:13 แต่มี 1 รายการนับหลังจากนั้น — export R16 ใหม่ให้ครอบเวลานับ');
  await closeApp(app);
});

test('อัปโหลด R05 ขึ้น Cloud ล้มด้วย error ยาว (เกิน 1 MiB) — toast สั้น แต่ console ยังได้ข้อความเต็ม', async ({ browser }) => {
  const app = await bootBare(browser);
  const longMsg = "Document 'projects/p/databases/(default)/documents/stock_sessions/global_r05' cannot be written because its size (1,094,869 bytes) exceeds the maximum allowed size of 1,048,576 bytes.";
  const r = await app.page.evaluate((longMsg) => {
    const toasts = [], warns = [];
    const realToast = window.toast, realGet = window.getR05Ref, realDb = _db, realBranch = currentBranch, realWarn = console.warn;
    currentBranch = 'KKL';
    window.toast = (m, type) => { toasts.push({ m: String(m), type }); };
    console.warn = (...a) => { warns.push(a.join(' ')); };
    _db = { collection: () => ({ doc: () => ({ set: () => Promise.resolve() }) }) };
    window.getR05Ref = () => ({ set: () => Promise.reject(new Error(longMsg)) });
    return syncMasterToFirestore(true, false).then(() => ({ toasts, warns }))
      .finally(() => { window.toast = realToast; window.getR05Ref = realGet; _db = realDb; currentBranch = realBranch; console.warn = realWarn; });
  }, longMsg);
  expect(r.toasts).toEqual([{ m: 'อัปโหลด R05.106 ขึ้น Cloud ไม่สำเร็จ (ข้อมูลเกินเพดาน 1 MiB) — แจ้งผู้ดูแลระบบ', type: 'error' }]);
  expect(r.warns.join('\n')).toContain('exceeds the maximum allowed size');   // ข้อความเต็มยังไปที่ console
  await closeApp(app);
});

// ฟังก์ชันสแกน (กฎ 1 · ผู้ใช้อนุมัติ 11 ต.ค. 2026) — แก้เฉพาะข้อความ: ยืนยันรีเช็คไม่ตรง · ↺ เปิดรีเช็คใหม่ล้ม
test('ยืนยันรีเช็คไม่ตรง (confirmAuditVerifyItem) · ↺ เปิดรีเช็คใหม่ล้ม (reopenPharmacyAudit) — ข้อความชุดใหม่', async ({ browser }) => {
  const app = await bootBare(browser);
  await seed(app.page, { n: 3 });
  await capture(app.page);
  const r = await app.page.evaluate(async () => {
    // ยอดระบบ ณ เวลาสแกนรีเช็ค 36 · รีเช็คได้ 33 · ยอดสดตอนนี้ 33 (S-1) / 36 (S-2) — ไม่มี R16
    state.skuMap.get('S-1').systemQty = 33; state.skuMap.get('S-2').systemQty = 36;
    for (const sku of ['S-1', 'S-2']) state.scanData.set(sku, { countedQty: 30, status: 'audit', initialStatus: 'audit', recheckQty: 33, recheckBy: 'Tester', recheckAt: '2026-10-07 10:00:00', recheckSystemQty: 36, timestamp: '2026-10-07 09:00:00' });
    window.__cap = [];
    const res = [confirmAuditVerifyItem('S-1', false, true), confirmAuditVerifyItem('S-2', false, true)];
    const verify = window.__cap.slice();
    // ↺ ล้มตอนเขียน marker — error ยาวที่มีรหัส → รหัส · เพดาน 1 MiB → ไทย
    state.scanData.set('S-3', { countedQty: 2, status: 'stock_adjustment', initialStatus: 'audit', recheckQty: 1, timestamp: '2026-10-07 09:00:00' });
    const realConfirm = window.confirm, realWrite = window._writePharmacyAuditMarkers;
    window.confirm = () => true;
    const reopen = [];
    for (const err of [Object.assign(new Error('Failed to commit the write because the backend did not respond within the deadline — retry'), { code: 'deadline-exceeded' }),
      new Error('Document cannot be written because its size (1,100,000 bytes) exceeds the maximum allowed size of 1,048,576 bytes.')]) {
      window.__cap = [];
      window._writePharmacyAuditMarkers = async () => { throw err; };
      await reopenPharmacyAudit('S-3');
      reopen.push(window.__cap.slice());
    }
    window.confirm = realConfirm; window._writePharmacyAuditMarkers = realWrite;
    return { res, verify, reopen, s3: state.scanData.get('S-3').status };
  });
  expect(r.res).toEqual(['stock_adjustment', 'stock_adjustment']);
  expect(r.verify).toEqual([
    '⚠️ S-1 ไม่ตรง (สแกน 33 + R16 0 = 33 / ระบบ 36 · ตอนนี้ 33) → Stock Adj',   // ยอดสดต่างจากยอด ณ เวลาสแกน → บอกอยู่ในวงเล็บ
    '⚠️ S-2 ไม่ตรง (สแกน 33 + R16 0 = 33 / ระบบ 36) → Stock Adj',
  ]);
  expect(r.reopen).toEqual([['เปิดรีเช็คใหม่ไม่สำเร็จ: deadline-exceeded'], ['เปิดรีเช็คใหม่ไม่สำเร็จ: ข้อมูลเกินเพดาน 1 MiB']]);
  expect(r.s3).toBe('stock_adjustment');   // ล้มแล้วไม่แตะ local (ลำดับเดิม: marker ก่อน local)
  await closeApp(app);
});

test('ยืนยันนับ/รีเช็ค WH (_confirmWhCountItems / _confirmWhRecheckItems) — ข้อความชุดใหม่อยู่ในโค้ด ไม่เหลือข้อความเดิม', async ({ browser }) => {
  // เส้นทาง error ของ WH Confirm ต้องใช้ op ที่ commit จริง — ตรึงที่ตัวข้อความ + คีย์ย่อของ PDA แทน
  const src = require('fs').readFileSync(require('path').join(__dirname, '../../../index.html'), 'utf8');
  for (const t of ['ยืนยันการนับสำเร็จ แต่หน้าจอยังอัปเดตไม่ครบ — รอ Sync ห้ามกดซ้ำ', 'ยืนยันรีเช็คสำเร็จ แต่หน้าจอยังอัปเดตไม่ครบ — รอ Sync ห้ามกดซ้ำ',
    'R01/R16 บน Cloud เปลี่ยนหรือยังโหลดไม่ครบ — รอ Ready แล้วกด Confirm ใหม่']) expect(src, t).toContain(`toast('${t}'`);
  for (const t of ['บน Cloud สำเร็จแล้ว แต่การอัปเดตหน้าจอยังไม่ครบ', 'มี version ใหม่หรือยังโหลดไม่ครบ', 'ยังไม่ได้เปิดรีเช็ค (กด ↺', 'ยอดระบบตอนนี้ ${_liveSys} (เทียบ']) expect(src, t).not.toContain(t);
  const app = await bootBare(browser);
  expect(await app.page.evaluate(() => _PDA_TOAST_SHORT.get('R01/R16 บน Cloud เปลี่ยนหรือยังโหลดไม่ครบ — รอ Ready แล้วกด Confirm ใหม่'))).toBe('R01/R16 ยังไม่พร้อม — รอแล้วกดใหม่');
  await closeApp(app);
});

test('PDA — ยังย่อข้อความชุดใหม่ได้ (คีย์/regex ใน _toastMessageForDevice แก้คู่กับข้อความ)', async ({ browser }) => {
  const app = await newAppContext(browser, { login: false, mode: 'pda' });
  await app.page.goto('/index.html');
  await waitForAppReady(app.page, { login: false });
  const r = await app.page.evaluate(() => [
    'R16.104 จับคู่ไม่ได้ — R16:"B-NOPE" vs R05:"B-1" (ดู Console)',
    'R16.104 จับคู่ไม่ได้ — ไม่มีแถว ORCM/OCTM/OTFB/ORTS/OTFI',
    'R16.103 จับคู่ไม่ได้ — Col C ต้องมี IRNC/IRVC/IRNM/ICSM/ITFB/ITFW/IPOS/IRCN',
    'R16.104 บน Cloud ยังไม่พร้อม — อัปโหลด R16.104 ใหม่ที่เครื่องใดก็ได้',
    '⚠️ วันที่ R16 (07/10/2026) ไม่ตรงกับวันที่สแกน (01/08/2026–30/08/2026 · 30 วัน)',
    'R16 อัปเดตแล้ว — ใช้คำนวณรายการที่นับวันนี้',
    'R01.102: 10 รายการ · หมวด 11. ไม่นับ 1 · หมวด DELETE 2 · ล้าง R16 แล้ว อัปใหม่ก่อน Confirm',
    'R01.102: 10 รายการ · อัป R16.104/103 ใหม่ก่อน Confirm',
    '⚠️ S-1 ไม่ตรง (สแกน 33 + R16 0 = 33 / ระบบ 36 · ตอนนี้ 33) → Stock Adj',
    '⚠️ S-2 ไม่ตรง (สแกน 33 + R16 0 = 33 / ระบบ 36) → Stock Adj',
    'R01/R16 บน Cloud เปลี่ยนหรือยังโหลดไม่ครบ — รอ Ready แล้วกด Confirm ใหม่',
  ].map((m) => _toastMessageForDevice(m)));
  expect(r).toEqual([
    'R16.104 จับคู่ไม่ได้ — ตรวจไฟล์',
    'R16.104 จับคู่ไม่ได้ — ตรวจไฟล์',
    'R16.103 จับคู่ไม่ได้ — ตรวจไฟล์',
    'R16.104 ยังไม่พร้อม — อัปโหลดใหม่',
    '⚠️ วันที่ R16 ไม่ตรงวันสแกน',
    'R16 อัปเดตแล้ว',
    'R01: 10 รายการ · หมวด 11. ไม่นับ 1 · หมวด DELETE 2 — อัป R16 ก่อน Confirm',
    'R01: 10 รายการ — อัป R16 ใหม่ก่อน Confirm',
    '⚠️ S-1 ไม่ตรง: 33+R16 0=33 / ระบบ 36 · ตอนนี้ 33',
    '⚠️ S-2 ไม่ตรง: 33+R16 0=33 / ระบบ 36',
    'R01/R16 ยังไม่พร้อม — รอแล้วกดใหม่',
  ]);
  await closeApp(app);
});

// กรณียาวสุดที่เกิดได้จริงของข้อความชุดใหม่ (ตัวเลข/เลขที่เอกสาร/ชื่อไฟล์ขนาดจริง) — toast Desktop ไม่ตัดบรรทัด จึงต้องไม่เกินหน้าต่างครึ่งจอ
// (เภสัชแบ่งครึ่งจอคู่กับ ProMaxx ตอนทำใบ 📦) · ฟอนต์ไทยมาจากเครื่อง (Inter ไม่มีอักษรไทย) — ตัวเลขนี้วัดบน Windows
const WORST = [
  'R01.102: 5412 รายการ (ข้าม 3) · หมวด 11. ไม่นับ 68 · หมวด DELETE 212 · ล้าง R16 แล้ว อัปใหม่ก่อน Confirm',
  'R01.102: 6120 รายการ · หมวด 11. ไม่นับ 143 · หมวด DELETE 260 · อัป R16.104/103 ใหม่ก่อน Confirm',
  'R16.104 จับคู่ไม่ได้ — R16:"8851234567890" vs R05:"8850987654321" (ดู Console)',
  'R16.103 จับคู่ไม่ได้ — Col C ต้องมี IRNC/IRVC/IRNM/ICSM/ITFB/ITFW/IPOS/IRCN',
  '⚠️ R16 มีข้อมูลถึง 07/10 18:30 แต่มี 120 รายการนับหลังจากนั้น — export R16 ใหม่ให้ครอบเวลานับ',
  '⚠️ วันที่ R16 (01/10/2026–07/10/2026 · 7 วัน) ไม่ตรงกับวันที่สแกน (05/08/2026–30/09/2026 · 45 วัน)',
  'R16: OTFI คลังโอนออก 120 แถว บวกกลับ · ข้ามหน้าร้านโอนออก 118 แถว',
  'บันทึก Cloud ไม่ได้ — ข้อมูลเกินขีดจำกัด (1052 KB) · ห้ามล้างข้อมูล แจ้งผู้ดูแลทันที',
  'อัปโหลด R05.106 ขึ้น Cloud ไม่สำเร็จ (Failed to get document because the client is offline.) — แจ้งผู้ดูแลระบบ',
  'Export ORDS 20 รายการ → 🗂️ ORDSBY001261000001 · เฉพาะ ⬜ ยังไม่เข้า ERP · แก้จำนวน 12 · ข้าม 1 (แก้เป็น 0)',
  'Export ORDS 20 รายการ (Text) สำเร็จ · หน้า 12/14 · เฉพาะ ⬜ ยังไม่เข้า ERP · แก้จำนวน 12 · ข้าม 1 (แก้เป็น 0)',
  '⚠️ 25 รายการไม่อยู่ในไฟล์ (ต้องรีเช็คใหม่ 18 · ยังไม่โหลด R05.106 2 · ไม่มีเลขตอน Confirm 1 · รอรีเช็คหลัง ↺ 4)',
  '⚠️ 20 รายการถูกส่งออกไปแล้วในเอกสาร ORDSBY001261000001 — ไม่ได้ดาวน์โหลด ตรวจแล้ว Export ใหม่',
  'ตรวจกับ ERP แล้ว · ORDS 38 ใบ · IRPS 28 ใบ — บันทึก Cloud ไม่ได้ (820 KB ใกล้เพดาน — Export R16 ช่วงสั้นลง)',
  'รายงาน_เคลื่อนไหว_SRC.CSV: ไม่ใช่ไฟล์ R16 จาก ProMaxx (ไม่พบคอลัมน์ SYSWAREHOUSEID, TRANDATE +5)',
  // ฟังก์ชันสแกน (อนุมัติ 11 ต.ค. 2026)
  'ยืนยันรีเช็คสำเร็จ แต่หน้าจอยังอัปเดตไม่ครบ — รอ Sync ห้ามกดซ้ำ',
  'R01/R16 บน Cloud เปลี่ยนหรือยังโหลดไม่ครบ — รอ Ready แล้วกด Confirm ใหม่',
  '1000123456: Stock Adj — กด ↺ สแกนใหม่ ที่ Desktop ก่อน',
  '⚠️ 1000123456 ไม่ตรง (สแกน 1200 + R16 -350 = 850 / ระบบ 1150 · ตอนนี้ 1100) → Stock Adj',
  'เปิดรีเช็คใหม่ไม่สำเร็จ: Failed to get document because the client is offline.',
];

test('Desktop — กรณียาวสุดของข้อความชุดใหม่ไม่ล้นหน้าต่างครึ่งจอ (960px · toast ไม่ตัดบรรทัด)', async ({ browser }) => {
  const app = await bootBare(browser);
  const widths = await app.page.evaluate((list) => list.map((m) => {
    const c = document.getElementById('toastContainer'); c.innerHTML = '';
    toast(m, 'warn', 9000);
    const el = c.lastElementChild; el.style.animation = 'none';
    return [Math.round(el.getBoundingClientRect().width), m];
  }), WORST);
  for (const [w, m] of widths) expect(w, m).toBeLessThanOrEqual(960);
  await closeApp(app);
});
