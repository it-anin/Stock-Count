// ด่านวันที่ R16 อ่านไม่ออก (14 ต.ค. 2026 · R16_UNREADABLE_DATE_GUARD) — พนักงานสาขาอัป R16.104 ด้วยมือเองได้อย่างปลอดภัยเมื่อบอทล้ม
//
// ทำไมต้องมี: เครื่อง BIGYAMAINPC export TRANDATE เป็น "14-Oct-26 09:17:17" ซึ่ง parseTranDate() ของแอปอ่านไม่ได้ (null)
// → getSoldQtyBefore/getInboundQtyBefore ข้ามแถว = ไม่ชดเชยยอดขายก่อนเวลาสแกน ทั้งที่หน้าจอขึ้น Ready ปกติ → Stock Adj ปลอมลง ERP
// (สาขายาไม่มีขั้น Audit แล้ว) · ด่านนี้ "ปฏิเสธไฟล์" ใน loadR16() ก่อนล้าง state — ไม่ใช่ r16DateMismatch (นั่นเป็นหน้าต่างเตือนที่กดข้ามได้)
//
// สิ่งที่ล็อกไว้:
//   1) ไฟล์ที่วันที่อ่านไม่ออกเกินเกณฑ์ถูกปฏิเสธ: toast บอกชัด + R16 เดิมคงอยู่ + ไม่ sync/publish/re-evaluate อะไร
//   2) เกณฑ์ 5% (เท่ากับเกณฑ์ = ผ่าน + เตือน · เกิน = ปฏิเสธ) · ช่องวันที่ว่าง/บิลยกเลิก/ประเภทที่ไม่ใช้ไม่ถูกนับ
//   3) ไฟล์ปกติ (dd/mm/yyyy) ไม่มีอะไรเปลี่ยน · ปิดสวิตช์ = เท่าก่อนแก้ทุกจุด · ทางกู้: ปฏิเสธแล้วอัปไฟล์ถูกต้องต่อได้ทันที
const { test, expect, bootBare, closeApp } = require('../../lib/hooks');
const F = require('../../lib/r16-104-fixture');

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// รูปแบบที่เครื่อง BIGYAMAINPC ให้ (อ่านไม่ได้) กับรูปแบบปกติ (อ่านได้) — เวลาเดียวกัน
const monFmt = (d, h, m, s) => `${String(d).padStart(2, '0')}-${MON[9]}-26 ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
const okFmt = (d, h, m, s) => `${d}/10/2026 ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;

// ตั้ง catalog แล้วเรียก rebuildMaps() จริง (เหมือน auto-r16-parity)
async function seed(page, branch = 'SRC', role = 'pharmacist', cat = F.catalog()) {
  const { pm, r01, r05 } = cat;
  return page.evaluate(({ branch, role, pm, r01, r05 }) => {
    currentBranch = branch; currentRole = role; currentUser = 'Tester'; _r01BaselineAt = '';
    state.r01Data = r01;
    state.productMasterData = pm;
    state.productMasterMap.clear();
    pm.forEach((r) => state.productMasterMap.set(r.sku, r.productName));
    state.r05Data = _parseR05Json(_serializeR05(r05));
    rebuildMaps();
  }, { branch, role, pm, r01, r05 });
}

// นับการเรียกฟังก์ชันที่ "ห้ามถูกเรียก" เมื่อไฟล์ถูกปฏิเสธ (sync/publish/re-evaluate) + ปิดการเขียนจริงทั้งหมด
async function spy(page) {
  await page.evaluate(() => {
    window.__calls = { sync: 0, reeval: 0, publish: 0, snapshot: 0 };
    syncR16MetaToFirestore = function () { window.__calls.sync++; return Promise.resolve(); };
    reEvaluateAuditItems = async function () { window.__calls.reeval++; };
    _publishWhR16Timeline = async function () { window.__calls.publish++; };
    _saveWhR16TimelineSnapshot = async function () { window.__calls.snapshot++; };
  });
}

const toasts = (page) => page.evaluate(() => [...document.querySelectorAll('#toastContainer .toast')].map((t) => t.textContent));
const snap = (page) => page.evaluate(() => ({
  loaded: state.r16Loaded, raw: state.r16RawMap.size, rows: state.r16Data.length, version: state.r16DetailVersion,
  ts: state.r16UploadedAt, badge: document.getElementById('badgeR16').textContent, btn: document.getElementById('btnConfirm').disabled,
  mismatch: state.r16DateMismatch,
}));

async function upload(page, rows, name = 'R16104.csv') {
  await page.setInputFiles('#fileR16', { name, mimeType: 'text/csv', buffer: Buffer.from(F.csvText(rows), 'utf8') });
}
// รอจน loadR16 ทำงานจบ: โหลดสำเร็จ = r16DetailVersion เปลี่ยน · ถูกปฏิเสธ/เตือน = มี toast ตามข้อความ
const waitLoaded = (page, before) => page.waitForFunction((v) => state.r16DetailVersion !== v && state.r16Loaded, before, { polling: 50, timeout: 30_000 });
const waitToast = (page, text) => page.waitForFunction((t) => [...document.querySelectorAll('#toastContainer .toast')].some((e) => e.textContent.includes(t)), text, { polling: 50, timeout: 30_000 });

// แถวขาย SRC ที่ catalog ของ fixture รู้จัก (B-01..B-09 ↔ S-01..S-09)
const sale = (at, n = 1, o = {}) => F.branchRow('SRC', { tranNo: 'ORCMBY0012610000' + String(n).padStart(2, '0'), colA: '1', qty: '2.0000', barcode: 'B-0' + (n % 9 + 1), sku: 'S-0' + (n % 9 + 1), at, ...o });
const goodRows = (k = 20) => Array.from({ length: k }, (_, i) => sale(okFmt(14, 8 + (i % 10), 10 + i, 5), i + 1));
const monRows = (k = 20) => Array.from({ length: k }, (_, i) => sale(monFmt(14, 8 + (i % 10), 10 + i, 5), i + 1));

test('ค่าเริ่มต้นที่ส่งมอบ: สวิตช์เปิด · เกณฑ์ 5% (อ่านจากหน้าที่เพิ่งบูต)', async ({ browser }) => {
  const app = await bootBare(browser);
  expect(await app.page.evaluate(() => [typeof R16_UNREADABLE_DATE_GUARD, R16_UNREADABLE_DATE_GUARD, R16_UNREADABLE_DATE_MAX_RATIO,
    typeof _r16UnreadableDateStats, typeof _r16RejectUnreadableDates])).toEqual(['boolean', true, 0.05, 'function', 'function']);
  await closeApp(app);
});

test('★ ไฟล์ dd-Mon-yy ทั้งไฟล์ (เครื่อง BIGYAMAINPC) ถูกปฏิเสธ: toast บอกชัด · ไม่โหลด · ไม่ sync/re-evaluate · Confirm ยังล็อกเพราะ R16 ไม่ถูกโหลด', async ({ browser }) => {
  const app = await bootBare(browser);
  await seed(app.page); await spy(app.page);
  const before = await snap(app.page);
  expect(before.loaded).toBe(false);

  await upload(app.page, monRows(20));
  await waitToast(app.page, 'ไม่ถูกโหลด');
  const t = (await toasts(app.page)).find((x) => x.includes('ไม่ถูกโหลด'));
  expect(t).toContain('วันที่อ่านไม่ออก 20/20 แถว');
  expect(t).toContain("'14-Oct-26 ");                    // ตัวอย่างค่าจริงที่อ่านไม่ออก — ไม่ต้องเปิดไฟล์ดู
  expect(t).toContain('dd/mm/yyyy');                       // บอกวิธีแก้
  expect(await app.page.evaluate(() => document.querySelector('#toastContainer .toast-error')?.textContent.includes('ไม่ถูกโหลด'))).toBe(true);

  const after = await snap(app.page);
  expect(after).toEqual(before);                           // ไม่มีอะไรเปลี่ยน: ไม่ Ready · ไม่มี timeline · Confirm ล็อก
  expect(after.btn).toBe(true);
  expect(await app.page.evaluate(() => window.__calls)).toEqual({ sync: 0, reeval: 0, publish: 0, snapshot: 0 });
  // ด่านเดิม "ต้องโหลด R16 ก่อน" ยังกันอยู่ — ไม่มีปุ่มข้ามให้กด
  await app.page.evaluate(() => validateAndProcess());
  expect((await toasts(app.page)).some((x) => x.includes('กรุณาโหลดไฟล์ R16.104 ก่อนยืนยัน'))).toBe(true);
  await closeApp(app);
});

test('★ ถูกปฏิเสธแล้ว R16 เดิมที่โหลดไว้ (บอท/อัปมือก่อนหน้า) ต้องคงอยู่ครบ — ไม่ถูกล้างเหมือนอัปไฟล์ที่ใช้ได้', async ({ browser }) => {
  const app = await bootBare(browser);
  await seed(app.page); await spy(app.page);
  await upload(app.page, goodRows(20));
  await waitLoaded(app.page, '');
  const good = await snap(app.page);
  expect(good.loaded).toBe(true); expect(good.raw).toBeGreaterThan(0);
  const soldBefore = await app.page.evaluate(() => getSoldQtyBefore('S-02', '2026-10-14 23:59:59'));
  expect(soldBefore).toBeGreaterThan(0);
  await app.page.evaluate(() => { window.__calls.sync = 0; window.__calls.reeval = 0; });

  await upload(app.page, monRows(20), 'จากBIGYAMAINPC.csv');
  await waitToast(app.page, 'ไม่ถูกโหลด');
  expect(await snap(app.page)).toEqual(good);              // version/เวลา/timeline/ป้าย/ปุ่ม เท่าเดิมทุกตัว
  expect(await app.page.evaluate(() => getSoldQtyBefore('S-02', '2026-10-14 23:59:59'))).toBe(soldBefore);
  expect(await app.page.evaluate(() => window.__calls)).toMatchObject({ sync: 0, reeval: 0 });
  await closeApp(app);
});

test('★ ทางกู้ของพนักงาน: โดนปฏิเสธแล้วอัปไฟล์รูปแบบปกติต่อ → โหลดได้ตามปกติ · ยอดขายถูกชดเชยตามเวลาสแกน · input เลือกไฟล์เดิมซ้ำได้', async ({ browser }) => {
  const app = await bootBare(browser);
  await seed(app.page); await spy(app.page);
  // ไฟล์เดียวกัน (ยอดขาย S-01 สองรายการ 08:10 และ 18:10) สองรูปแบบวันที่
  const mk = (f) => [sale(f(14, 8, 10, 0), 0, { qty: '3.0000', barcode: 'B-01', sku: 'S-01' }), sale(f(14, 18, 10, 0), 9, { qty: '4.0000', barcode: 'B-01', sku: 'S-01' })];
  await upload(app.page, mk(monFmt));
  await waitToast(app.page, 'ไม่ถูกโหลด');
  expect((await snap(app.page)).loaded).toBe(false);

  await upload(app.page, mk(okFmt));                       // export ใหม่แล้วอัปอีกครั้ง (ชื่อไฟล์เดิม)
  await waitLoaded(app.page, '');
  const s = await snap(app.page);
  expect(s).toMatchObject({ loaded: true, badge: 'Ready', btn: false, mismatch: false });
  const sold = await app.page.evaluate(() => ({ early: getSoldQtyBefore('S-01', '2026-10-14 07:00:00'), noon: getSoldQtyBefore('S-01', '2026-10-14 12:00:00'), night: getSoldQtyBefore('S-01', '2026-10-14 20:00:00') }));
  expect(sold).toEqual({ early: 0, noon: 3, night: 7 });   // ★ กรองตามเวลาสแกน (ไม่ใช่ 0 ทุกเวลา และไม่ใช่ 7 ทุกเวลา)
  expect(await app.page.evaluate(() => window.__calls)).toMatchObject({ sync: 1, reeval: 1 });
  await closeApp(app);
});

test('เกณฑ์ 5%: เท่าเกณฑ์ = โหลด + เตือน · เกินเกณฑ์ = ปฏิเสธ · ไม่มีแถวอ่านไม่ออก = ไม่มี toast ใหม่', async ({ browser }) => {
  const app = await bootBare(browser);
  await seed(app.page); await spy(app.page);
  const withBad = (k, bad) => goodRows(k).map((r, i) => (i < bad ? r.map((v, c) => (c === 1 ? 'ไม่ใช่วันที่ ' + i : v)) : r));

  // 1/20 = 5% พอดี → ผ่าน (ไม่เกิน) แต่ต้องเตือน และแถวที่เหลือถูกชดเชยตามปกติ
  await upload(app.page, withBad(20, 1));
  await waitLoaded(app.page, '');
  const warn = (await toasts(app.page)).find((x) => x.includes('วันที่อ่านไม่ออก 1 แถว'));
  expect(warn).toContain("'ไม่ใช่วันที่ 0'");
  expect(warn).toContain('ยอดขายแถวนั้นไม่ถูกชดเชย');
  expect((await snap(app.page)).loaded).toBe(true);

  // 2/20 = 10% → ปฏิเสธ (และของเดิมที่เพิ่งโหลดคงอยู่)
  const keep = await snap(app.page);
  await upload(app.page, withBad(20, 2));
  await waitToast(app.page, 'วันที่อ่านไม่ออก 2/20 แถว');
  expect(await snap(app.page)).toEqual(keep);

  // ไฟล์ปกติล้วน: ไม่มี toast เรื่องวันที่เลย
  await app.page.evaluate(() => { document.getElementById('toastContainer').innerHTML = ''; });
  await upload(app.page, goodRows(20));
  await waitLoaded(app.page, keep.version);
  expect((await toasts(app.page)).filter((x) => x.includes('วันที่อ่านไม่ออก'))).toEqual([]);
  await closeApp(app);
});

test('ดีไซน์เดิมไม่เปลี่ยน: ช่องวันที่ว่าง · บิลยกเลิก · ประเภทเอกสารที่ไม่ใช้ · ไม่มีคอลัมน์ TRANDATE ไม่ถูกนับว่าอ่านไม่ออก', async ({ browser }) => {
  const app = await bootBare(browser);
  await seed(app.page); await spy(app.page);
  const rows = [
    ...goodRows(10),
    ...Array.from({ length: 10 }, (_, i) => sale('', 30 + i)),                                             // วันที่ว่าง (กฎเดิม: ไม่ชดเชย) ≠ อ่านไม่ออก
    ...Array.from({ length: 5 }, (_, i) => sale('ขยะ', 40 + i, { cancel: '1' })),                          // บิลยกเลิก (ข้ามอยู่แล้ว)
    ...Array.from({ length: 5 }, (_, i) => F.branchRow('SRC', { tranNo: 'ORDSBY0012610000' + i, at: 'ขยะ', barcode: 'B-01', sku: 'S-01' })), // ประเภทที่ไม่ใช้ชดเชย
  ];
  await upload(app.page, rows);
  await waitLoaded(app.page, '');
  expect((await toasts(app.page)).filter((x) => x.includes('อ่านไม่ออก'))).toEqual([]);

  // วันที่ว่างทุกแถว (มีคอลัมน์) → ไม่เข้าเกณฑ์ (withDate = 0) · ไม่มีคอลัมน์ TRANDATE เลย → ไม่ตรวจ (พฤติกรรมเดิม)
  const stats = await app.page.evaluate(({ hdr, blank, nocol }) => ({ blank: _r16UnreadableDateStats([hdr, ...blank]), nocol: _r16UnreadableDateStats([hdr.map((h) => (h === 'TRANDATE' ? 'X' : h)), ...nocol]) }),
    { hdr: F.HEAD, blank: [sale('', 1), sale('', 2)], nocol: [sale('ขยะ', 1), sale('ขยะ', 2)] });
  expect(stats.blank).toEqual({ withDate: 0, bad: 0, samples: [] });
  expect(stats.nocol).toEqual({ withDate: 0, bad: 0, samples: [] });
  await closeApp(app);
});

test('ตัวอย่างค่าที่อ่านไม่ออก: ไม่เกิน 3 แบบ · ไม่ซ้ำ · ค่ายาวถูกตัด · นับเฉพาะแถวที่ใช้จริง', async ({ browser }) => {
  const app = await bootBare(browser);
  await seed(app.page);
  const rows = ['W1', 'W2', 'W2', 'W3', 'W4', 'ยาวมากกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกก'].map((w, i) => sale(w, i + 1));
  const st = await app.page.evaluate((r) => _r16UnreadableDateStats(r), [F.HEAD, ...rows]);
  expect(st).toEqual({ withDate: 6, bad: 6, samples: ['W1', 'W2', 'W3'] });

  // ค่ายาวในข้อความ toast ถูกตัดที่ 20 ตัวอักษร + … (กัน toast ล้นหน้าต่าง) · toast โชว์ตัวอย่างเดียว — ครบ ≤ 3 แบบอยู่ใน console
  const longV = 'ก'.repeat(40);
  const rej = await app.page.evaluate((r) => [_r16RejectUnreadableDates(r), document.querySelector('#toastContainer .toast-error')?.textContent || ''],
    [F.HEAD, ...[1, 2, 3].map((n) => sale(longV, n))]);
  expect(rej[0]).toBe(true);
  expect(rej[1]).toContain(`(เช่น '${'ก'.repeat(20)}…')`);
  expect(rej[1]).not.toContain('ก'.repeat(21));
  const two = await app.page.evaluate((r) => { document.getElementById('toastContainer').innerHTML = ''; _r16RejectUnreadableDates(r); return document.querySelector('#toastContainer .toast-error')?.textContent || ''; },
    [F.HEAD, sale('W1', 1), sale('W2', 2)]);
  expect(two).toContain("(เช่น 'W1')");
  expect(two).not.toContain('W2');                        // ตัวอย่างเดียวใน toast
  await closeApp(app);
});

test('สวิตช์ปิด = เท่าก่อนแก้ทุกจุด: ไฟล์ dd-Mon-yy โหลดได้เงียบๆ (Ready) และยอดขายก่อนเวลาสแกนเป็น 0 — canary ว่าด่านคือตัวที่กันอยู่', async ({ browser }) => {
  const app = await bootBare(browser);
  await seed(app.page); await spy(app.page);
  await app.page.evaluate(() => { R16_UNREADABLE_DATE_GUARD = false; });
  await upload(app.page, [sale(monFmt(14, 8, 10, 0), 1, { qty: '3.0000', barcode: 'B-01', sku: 'S-01' })]);
  await waitLoaded(app.page, '');
  expect(await snap(app.page)).toMatchObject({ loaded: true, badge: 'Ready', btn: false });
  expect((await toasts(app.page)).filter((x) => x.includes('อ่านไม่ออก') || x.includes('ไม่ถูกโหลด'))).toEqual([]);
  expect(await app.page.evaluate(() => getSoldQtyBefore('S-01', '2026-10-14 23:59:00'))).toBe(0);   // บั๊กเดิม: ยอดขายหายเงียบ
  await closeApp(app);
});

test('WH ก็ได้ด่านเดียวกัน: ไฟล์ที่ถูกปฏิเสธไม่ถูก snapshot/publish ขึ้น Cloud · ไฟล์ปกติ publish ตามเดิม', async ({ browser }) => {
  const app = await bootBare(browser);
  await seed(app.page, 'WH', 'supervisor'); await spy(app.page);
  const whRow = (at, n) => F.row({ tranNo: 'ORCMBY0012610000' + n, colA: '0', qty: '2.0000', barcode: 'B-0' + n, sku: 'S-0' + n, at, name: 'WH' });
  await upload(app.page, [whRow(monFmt(14, 9, 0, 0), 1), whRow(monFmt(14, 9, 5, 0), 2)]);
  await waitToast(app.page, 'ไม่ถูกโหลด');
  expect(await app.page.evaluate(() => window.__calls)).toEqual({ sync: 0, reeval: 0, publish: 0, snapshot: 0 });

  await upload(app.page, [whRow(okFmt(14, 9, 0, 0), 1), whRow(okFmt(14, 9, 5, 0), 2)]);
  await waitLoaded(app.page, '');
  await app.page.waitForFunction(() => window.__calls.publish >= 1, null, { polling: 50, timeout: 30_000 });
  expect(await app.page.evaluate(() => window.__calls)).toMatchObject({ publish: 1, snapshot: 1 });
  await closeApp(app);
});

// ── ไฟล์จริง (opt-in) ────────────────────────────────────────────────────
// R16104_REAL_FILE=<path ไป R16104.CSV> npm run test:logic -- r16-unreadable-date-guard  (ไม่ commit ไฟล์จริงเข้า repo — *.csv อยู่ใน .gitignore)
const REAL = process.env.R16104_REAL_FILE;
test('ไฟล์จริง R16104.CSV (opt-in: R16104_REAL_FILE) — ไฟล์ปกติผ่านด่านโดยไม่มี toast · แปลงวันที่ทั้งไฟล์เป็น dd-Mon-yy แล้วถูกปฏิเสธด้วยจำนวนแถวที่ตรงกับนับนอกแอป', async ({ browser }) => {
  test.skip(!REAL, 'ตั้ง R16104_REAL_FILE=<path ไป R16104.CSV> เพื่อทดสอบกับไฟล์จริง (ไม่ commit ไฟล์จริงเข้า repo)');
  test.setTimeout(240_000);
  const fs = require('fs');
  const Papa = require('../../../libs/papaparse.min.js');
  const raw = fs.readFileSync(REAL);
  const text = raw[0] === 0xEF && raw[1] === 0xBB && raw[2] === 0xBF ? raw.slice(3).toString('utf8') : raw.toString('utf8');
  const all = Papa.parse(text, { header: false, skipEmptyLines: true, delimiter: ',', quoteChar: '"' }).data;
  const head = all[0];
  const tdCol = head.findIndex((h) => String(h).trim().toUpperCase() === 'TRANDATE');
  const own = all.slice(1).filter((r) => (r[12] || '').trim() === F.BRANCH_ID.SRC);   // แถวของ SRC (SYSBRANCHID 0)
  expect(own.length, 'ไฟล์จริงต้องมีแถวของ SRC').toBeGreaterThan(50);

  // catalog จากไฟล์เอง (เหมือน parity): ทุกบาร์โค้ด → SKU ในคอลัมน์ X
  const sk = new Map(own.map((r) => [(r[14] || '').trim(), (r[23] || '').trim()]));
  const r05 = [...sk].filter(([, s]) => s).map(([bc, s]) => ({ barcode: bc, colE: s, unitName: 'EA', unitMultiplier: 1, unitPrice: 10 }));
  const skus = [...new Set(r05.map((x) => x.colE))];
  const cat = { pm: [], r01: skus.map((s) => ({ colE: s, systemQty: 1, productName: 'x' })), r05 };

  // นับนอกแอป: แถวประเภทที่ใช้ชดเชย · ไม่ใช่บิลยกเลิก · มีค่าวันที่
  const USED = ['ORCM', 'OCTM', 'OTFB', 'ORTS', 'OTFI'];
  const used = own.filter((r) => (r[9] || '').trim() !== '1' && USED.some((p) => (r[2] || '').trim().toUpperCase().startsWith(p)) && (r[tdCol] || '').trim());
  expect(used.length, 'ไฟล์จริงต้องมีแถวชดเชย').toBeGreaterThan(20);

  const page_upload = (page, csv) => page.setInputFiles('#fileR16', { name: 'R16104.csv', mimeType: 'text/csv', buffer: Buffer.from(csv, 'utf8') });
  const app = await bootBare(browser);
  await seed(app.page, 'SRC', 'pharmacist', cat); await spy(app.page);
  // 1) ไฟล์จริงตามที่ export (dd/mm/yyyy) → โหลดได้ ไม่มี toast เรื่องวันที่
  await page_upload(app.page, F.csvText(own, { head }));
  await waitLoaded(app.page, '');
  expect((await toasts(app.page)).filter((x) => x.includes('อ่านไม่ออก') || x.includes('ไม่ถูกโหลด'))).toEqual([]);
  const good = await snap(app.page);
  expect(good).toMatchObject({ loaded: true, badge: 'Ready', btn: false });

  // 2) แปลงวันที่ทุกแถวเป็น dd-Mon-yy HH:mm:ss (รูปแบบเครื่อง BIGYAMAINPC) → ปฏิเสธ · R16 เดิมคงอยู่
  const toMon = (v) => { const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4}) (\d{1,2}:\d{2}:\d{2})$/.exec(String(v).trim()); return m ? `${m[1].padStart(2, '0')}-${MON[Number(m[2]) - 1]}-${m[3].slice(2)} ${m[4]}` : v; };
  const monOwn = own.map((r) => r.map((v, c) => (c === tdCol ? toMon(v) : v)));
  expect(monOwn.find((r) => (r[tdCol] || '').trim())[tdCol], 'แปลงรูปแบบสำเร็จ').toMatch(/^\d\d-[A-Z][a-z]{2}-\d\d \d{1,2}:\d\d:\d\d$/);
  await page_upload(app.page, F.csvText(monOwn, { head }));
  await waitToast(app.page, 'ไม่ถูกโหลด');
  const t = (await toasts(app.page)).find((x) => x.includes('ไม่ถูกโหลด'));
  expect(t).toContain(`วันที่อ่านไม่ออก ${used.length}/${used.length} แถว`);
  expect(await snap(app.page)).toEqual(good);
  console.log(`[ไฟล์จริง] SRC ${own.length} แถว · แถวชดเชย ${used.length} · ปฏิเสธ: ${t}`);
  await closeApp(app);
});

test('Desktop — ข้อความ toast ใหม่ไม่ล้นหน้าต่างครึ่งจอ (960px · toast ไม่ตัดบรรทัด) แม้ตัวอย่างค่ายาวและจำนวนแถวหลักหมื่น', async ({ browser }) => {
  const app = await bootBare(browser);
  // ข้อความจริงที่โค้ดผลิต (เรียก _r16RejectUnreadableDates กับไฟล์สังเคราะห์) — แก้ข้อความแล้วเทสนี้วัดของใหม่เอง
  const widths = await app.page.evaluate(() => {
    const hdr = new Array(40).fill(''); hdr[1] = 'TRANDATE'; hdr[2] = 'TRANNO';
    const SAMPLES = ['14-Oct-26 09:17:17 PM ตัวอย่างยาวๆ', 'ขยะขยะขยะขยะขยะขยะขยะขยะขยะขยะ', '99/99/9999 99:99:99 PM xxxxxxxxxx'];
    const mk = (n, badN) => [hdr, ...Array.from({ length: n }, (_, i) => {
      const r = new Array(40).fill(''); r[2] = 'ORCMBY001261000001'; r[1] = i < badN ? SAMPLES[i % 3] : '14/10/2026 08:00:00'; return r;
    })];
    const out = [];
    for (const [n, bad] of [[12345, 12345], [20000, 612]]) {     // ปฏิเสธ (100%) · เตือน (3.06% ≤ 5%)
      const c = document.getElementById('toastContainer'); c.innerHTML = '';
      const rejected = _r16RejectUnreadableDates(mk(n, bad));
      const el = c.lastElementChild; el.style.animation = 'none';
      out.push([rejected, Math.round(el.getBoundingClientRect().width), el.textContent]);
    }
    return out;
  });
  expect(widths.map((w) => w[0])).toEqual([true, false]);       // ทั้งสองข้อความถูกผลิตจริง
  for (const [, w, m] of widths) expect(w, m).toBeLessThanOrEqual(960);
  await closeApp(app);
});
