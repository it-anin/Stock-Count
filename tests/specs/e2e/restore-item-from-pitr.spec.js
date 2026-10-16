// tools/restore-item-from-pitr.js — กู้ item ที่ ↺ สแกนใหม่ ลบไป จากผลอ่านย้อนหลัง (PITR) — เส้นทางจริงบน emulator หลายเครื่อง (16 ต.ค. 2026)
// สคริปต์ Console ที่เขียนข้อมูลจริงบน production จึงต้องพิสูจน์ก่อนใช้ว่า:
//   A. ★ เคสจริงของผู้ใช้: Stock Adj ที่ผ่านรีเช็ค (มี final marker) → ↺ ลบ item+marker → dry-run ไม่เขียน · พิมพ์ผิด = ยกเลิก ·
//      พิมพ์ถูก = สร้างกลับตรงทุก field · ทุกเครื่องเห็นเองผ่าน listener (ไม่ต้อง reload) · login ใหม่แล้ว marker ถูกสร้างกลับ · รันซ้ำ = ข้าม ไม่ทับ
//   B. ด่านป้องกัน: ผิดสาขา · SKU ซ้ำ · คนละรอบนับ · หน้ากำลังแก้ SKU นั้น · Confirm lock · PDA — หยุด/ข้ามโดยไม่เขียนอะไร
//      ผู้ช่วยสแกน SKU นั้นใหม่ไปแล้ว → ข้าม ไม่ทับยอดใหม่
//   C. ด่านชั้นใน: รอบนับของหน้า ≠ Cloud · SKU กำลังเขียนอยู่ · เขียนล้ม (นับ failed) · มีคนสร้างเอกสารแทรกหลังวางแผน → transaction ไม่ทับ
//   D. Cloud ไม่ใช่ schema v2 → หยุดก่อนวางแผน
//   E. ไม่มีผล PITR: ประกอบ item จากแถว stock_audit_log + ยอดระบบที่คำนวณย้อนจากผลต่างใน ERP → กู้ได้ · ไม่เข้าใบ 📦 (ฐานไม่สด) · marker กลับมา
// logic ล้วน (ตัวแปลงค่า · ตัวอ่านไฟล์ · รายงาน) อยู่ที่ specs/logic/restore-item-from-pitr.spec.js
const fs = require('fs');
const path = require('path');
const { test, expect, closeApp, requireEmulator, armDialog } = require('../../lib/hooks');
const { bootFreshCount, bootJoinCount, armR16, PROJECT_ID } = require('../../lib/scenario');
const { waitForDoc, getDoc } = require('../../lib/emulator');
const { seedItems } = require('../../lib/seed');

const TOOL = fs.readFileSync(path.join(__dirname, '../../../tools/restore-item-from-pitr.js'), 'utf8');
const ITEM = 'stock_sessions/SRC/items/S-F05';
const MARKERS = 'stock_sessions/SRC_pharmacy_audit_markers';

// ค่าจาก admin SDK → รูป Firestore REST (typed JSON) เหมือนที่ batchGet + readTime ตอบกลับ
function toRestValue(v) {
  if (v === null) return { nullValue: null };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v.toDate === 'function') return { timestampValue: v.toDate().toISOString() };
  if (Array.isArray(v)) return { arrayValue: v.length ? { values: v.map(toRestValue) } : {} };
  return { mapValue: { fields: toRestFields(v) } };
}
function toRestFields(o) { const f = {}; for (const k of Object.keys(o)) f[k] = toRestValue(o[k]); return f; }
const restFile = (branch, sku, data, name = `before-${branch}-${sku}.json`) => ({
  name,
  json: [{ found: { name: `projects/demo-stock-count/databases/(default)/documents/stock_sessions/${branch}/items/${sku}`, fields: toRestFields(data),
    createTime: '2026-08-07T09:44:20.231490Z', updateTime: '2026-09-17T05:47:57.816219Z' }, readTime: '2026-10-16T04:10:00Z' }],
});

async function quiet(page) {
  await page.waitForFunction(() => _dirtySkus.size === 0 && _scanItemInFlight.size === 0 && !_scanItemFlushing, null, { timeout: 20000, polling: 100 });
}
const status = (page) => page.evaluate(() => state.scanData.get('S-F05')?.status);
const loadTool = (page) => page.addScriptTag({ content: TOOL });
// prompt() ที่เปิดใน page.evaluate ทำ Playwright ค้าง — stub ตอบข้อความยืนยันแทน (เหมือน scenario.js)
const run = (page, opts, phrase = 'RESTORE SRC') => page.evaluate(async ({ opts, phrase }) => {
  const real = window.prompt; window.prompt = () => phrase;
  try { return await restoreFromPitr(opts); } catch (e) { return { threw: e.message }; } finally { window.prompt = real; }
}, { opts, phrase });
const strip = ({ updatedBy, updatedAt, ...rest }) => rest;

// Stock Adj ที่ Audit เดิมยืนยันแล้ว (ระบบ 5 · นับ 3 · รีเช็ค 4) พร้อม final marker จริง — ทางเดียวกับ pharmacy-stockadj-rescan.spec.js ข้อ B
async function bootWithRecheckedStockAdj(browser) {
  const desk = await bootFreshCount(browser, { role: 'pharmacist', user: 'Pharm', mode: 'desktop' });
  await armR16(desk.page);
  await seedItems(PROJECT_ID, 'SRC', desk.epoch, [
    { sku: 'S-F05', status: 'stock_adjustment', auditStatus: 'stock_adjustment', initialStatus: 'audit', auditor: 'Pharm', countedQty: 3,
      recheckQty: 4, recheckBy: 'Pharm', recheckAt: '2026-09-29T03:00:00.000Z', recheckSystemQty: 5, scannedBy: 'PDA-A' },
  ]);
  const pda = await bootJoinCount(browser, { role: 'assistant', user: 'PDA-A', mode: 'pda', expectEpoch: desk.epoch });
  const desk2 = await bootJoinCount(browser, { role: 'pharmacist', user: 'Pharm2', mode: 'desktop', expectEpoch: desk.epoch });
  await desk.page.waitForFunction(() => state.scanData.get('S-F05')?.status === 'stock_adjustment', null, { timeout: 15000, polling: 100 });
  armDialog(desk.page, 'y');
  await desk.page.evaluate(() => reopenPharmacyAudit('S-F05'));
  await waitForDoc(PROJECT_ID, ITEM, (d) => d && d.status === 'audit', { timeout: 20000 });
  await quiet(desk.page);
  await desk.page.evaluate(() => { updatePharmacyRecheckQty('S-F05', 4); return _flushDirtySkus(); });
  await waitForDoc(PROJECT_ID, ITEM, (d) => d && d.recheckQty === 4 && d.status === 'audit');
  await quiet(desk.page);
  await desk.page.evaluate(() => _confirmPharmacyAuditBatched());
  await desk.page.waitForFunction(() => _branchConfirming === false, null, { timeout: 30000, polling: 100 });
  await waitForDoc(PROJECT_ID, ITEM, (d) => d && d.status === 'stock_adjustment' && d.auditor === 'Pharm' && d.recheckQty === 4);
  expect((await getDoc(PROJECT_ID, MARKERS)).items['S-F05']).toMatchObject({ status: 'stock_adjustment', auditor: 'Pharm' });
  await desk2.page.waitForFunction(() => { const s = state.scanData.get('S-F05'); return s?.status === 'stock_adjustment' && s.auditor === 'Pharm' && _pharmacyAuditMarkerData.items?.['S-F05']?.auditor === 'Pharm'; },
    null, { timeout: 20000, polling: 100 });
  await pda.page.waitForFunction(() => state.scanData.get('S-F05')?.status === 'stock_adjustment', null, { timeout: 20000, polling: 100 });
  for (const dev of [desk, desk2, pda]) await quiet(dev.page);
  return { desk, desk2, pda };
}
// กด ↺ จริง (restartPharmacyScan) แล้วรอให้ item + marker หายบน Cloud และทุกเครื่องเห็น pending
async function resetByArrow(desk, others) {
  armDialog(desk.page, 'y');
  await desk.page.evaluate(() => restartPharmacyScan('S-F05'));
  await waitForDoc(PROJECT_ID, ITEM, (d) => d === null, { timeout: 20000 });
  expect(((await getDoc(PROJECT_ID, MARKERS)) || {}).items?.['S-F05']).toBeUndefined();
  for (const dev of [desk, ...others]) await dev.page.waitForFunction(() => state.scanData.get('S-F05')?.status === 'pending', null, { timeout: 20000, polling: 100 });
}

test.describe('tools/restore-item-from-pitr.js', () => {
  test.beforeEach(() => requireEmulator());
  test.setTimeout(240_000);

  test('A. ★ ↺ ลบ item+marker → dry-run ไม่เขียน · พิมพ์ผิดยกเลิก · พิมพ์ถูกสร้างกลับตรงทุก field · ทุกเครื่องเห็นเอง · login ใหม่ marker กลับมา · รันซ้ำ = ข้าม', async ({ browser }) => {
    const { desk, desk2, pda } = await bootWithRecheckedStockAdj(browser);
    const before = await getDoc(PROJECT_ID, ITEM);          // = สิ่งที่ PITR อ่านย้อนหลังได้ก่อนกด ↺
    const markerBefore = (await getDoc(PROJECT_ID, MARKERS)).items['S-F05'];
    const files = [restFile('SRC', 'S-F05', before)];
    expect(before).toMatchObject({ status: 'stock_adjustment', auditor: 'Pharm', recheckQty: 4, recheckSystemQty: 5, countedQty: 3, initialStatus: 'audit' });
    await resetByArrow(desk, [desk2, pda]);

    await loadTool(desk.page);
    // 1) dry-run: รายงานถูก ไม่เขียนอะไร ไม่ถามยืนยัน
    const dry = await run(desk.page, { files }, 'SHOULD-NOT-BE-ASKED');
    expect(dry).toMatchObject({ dryRun: true, willRestore: 1, skipped: 0 });
    expect(dry.plan[0].sum).toMatchObject({ status: 'stock_adjustment', counted: 3, recheck: 4, system: 5, diff: -1, passedRecheck: true });
    expect(await getDoc(PROJECT_ID, ITEM)).toBeNull();
    // 2) เขียนจริงแต่พิมพ์ยืนยันผิด → ยกเลิก ไม่เขียน
    expect(await run(desk.page, { files, dryRun: false }, 'restore src')).toEqual({ cancelled: true });
    expect(await run(desk.page, { files, dryRun: false }, null)).toEqual({ cancelled: true });   // กด Cancel ที่กล่อง
    expect(await getDoc(PROJECT_ID, ITEM)).toBeNull();
    // 3) พิมพ์ถูก → สร้างกลับ
    const res = await run(desk.page, { files, dryRun: false });
    expect(res).toMatchObject({ dryRun: false, created: 1, failed: [] });
    expect(res.verify).toEqual([expect.objectContaining({ SKU: 'S-F05', มีบน_Cloud: true, สถานะ: 'stock_adjustment', นับ: 3, รอบตรง: true })]);
    const after = await getDoc(PROJECT_ID, ITEM);
    expect(strip(after)).toEqual(strip(before));             // ทุก field เหมือนเดิมเป๊ะ (รวม rev · recheck* · countResetAt)
    expect(after.updatedBy).toBe('restore-pitr');
    // 4) ทุกเครื่องเห็นเองผ่าน listener — ไม่ต้อง reload — และ rev ตรง Cloud
    for (const dev of [desk, desk2, pda]) {
      await dev.page.waitForFunction(() => { const s = state.scanData.get('S-F05'); return s?.status === 'stock_adjustment' && s.auditor === 'Pharm' && s.recheckQty === 4 && s.countedQty === 3; },
        null, { timeout: 20000, polling: 100 });
    }
    expect(await desk.page.evaluate(() => _scanItemRev.get('S-F05'))).toBe(before.rev);
    await quiet(desk.page);
    expect(strip(await getDoc(PROJECT_ID, ITEM))).toEqual(strip(before));   // เครื่องไหน reconcile/flush ก็ไม่ทับ/ไม่ลบ
    // 5) เครื่องที่ login ใหม่ → แอปสร้าง marker กลับจาก item เอง (ไม่พึ่งเครื่องมือ) — ผ่านรีเช็คแล้วต้องเป็น final เหมือนเดิม
    const desk3 = await bootJoinCount(browser, { role: 'pharmacist', user: 'Pharm3', mode: 'desktop', expectEpoch: desk.epoch });
    await waitForDoc(PROJECT_ID, MARKERS, (d) => d?.items?.['S-F05']?.status === 'stock_adjustment' && d.items['S-F05'].auditor === 'Pharm', { timeout: 25000 });
    const markerAfter = (await getDoc(PROJECT_ID, MARKERS)).items['S-F05'];
    expect(markerAfter).toMatchObject({ status: markerBefore.status, auditor: markerBefore.auditor, recheckQty: markerBefore.recheckQty });
    expect(await status(desk3.page)).toBe('stock_adjustment');
    expect(strip(await getDoc(PROJECT_ID, ITEM))).toEqual(strip(before));
    // 6) รันซ้ำ = ข้าม ไม่ทับ
    const again = await run(desk.page, { files, dryRun: false });
    expect(again).toMatchObject({ created: 0 });
    expect(strip(await getDoc(PROJECT_ID, ITEM))).toEqual(strip(before));
    await closeApp(desk3); await closeApp(desk2); await closeApp(pda); await closeApp(desk);
  });

  test('B. ด่านป้องกัน: ผิดสาขา · SKU ซ้ำ · คนละรอบนับ · หน้ากำลังแก้ SKU · Confirm lock · PDA → ไม่เขียนอะไร · ผู้ช่วยสแกนใหม่ไปแล้ว → ข้าม ไม่ทับ', async ({ browser }) => {
    const { desk, desk2, pda } = await bootWithRecheckedStockAdj(browser);
    const before = await getDoc(PROJECT_ID, ITEM);
    const good = restFile('SRC', 'S-F05', before);
    await resetByArrow(desk, [desk2, pda]);
    await loadTool(desk.page); await loadTool(pda.page);

    // ผิดสาขา / SKU ซ้ำ / ไฟล์ผิดรูป = หยุดทั้งชุด
    const wrongBranch = await run(desk.page, { files: [restFile('KKL', 'S-F05', before)] });
    expect(wrongBranch.threw).toContain('เป็นของสาขา KKL');
    const dup = await run(desk.page, { files: [good, { ...good, name: 'copy.json' }] });
    expect(dup.threw).toContain('ซ้ำ');
    const notFound = await run(desk.page, { files: [{ name: 'm.json', json: [{ missing: 'projects/x/databases/(default)/documents/stock_sessions/SRC/items/S-F05', readTime: 't' }] }] });
    expect(notFound.threw).toContain('ต้องมีเอกสาร "found" 1 รายการ');
    // คนละรอบนับ = ข้าม (ไม่เขียน)
    const otherEpoch = await run(desk.page, { files: [restFile('SRC', 'S-F05', { ...before, countResetAt: '2026-01-01T00:00:00.000Z' })], dryRun: false });
    expect(otherEpoch).toMatchObject({ created: 0, skipped: 1 });
    // หน้านี้กำลังแก้ SKU นั้นอยู่ → ข้าม
    await desk.page.evaluate(() => _dirtySkus.add('S-F05'));
    const dirty = await run(desk.page, { files: [good] });
    expect(dirty.plan[0].reason).toContain('กำลังแก้ SKU นี้อยู่');
    await desk.page.evaluate(() => _dirtySkus.delete('S-F05'));
    // Confirm lock / กำลังโหลด → หยุดก่อนแตะ Cloud
    await desk.page.evaluate(() => { _branchScanPaused = true; });
    const locked = await run(desk.page, { files: [good] });
    await desk.page.evaluate(() => { _branchScanPaused = false; });
    expect(locked.threw).toContain('Confirm');
    // PDA = ปฏิเสธ
    const onPda = await run(pda.page, { files: [good] });
    expect(onPda.threw).toContain('Desktop เท่านั้น');
    expect(await getDoc(PROJECT_ID, ITEM)).toBeNull();        // ทุกข้อข้างบน: Cloud ยังไม่มีเอกสาร = ไม่มีอะไรถูกเขียน

    // ผู้ช่วยสแกน SKU นั้นใหม่ไปแล้ว (เอกสารใหม่บน Cloud) → ข้าม ไม่ทับยอดใหม่
    await pda.page.evaluate(() => { for (let i = 0; i < 2; i++) scanQueue.push(parseScanLine('B-F05')); drainQueue(); return _flushDirtySkus(); });
    await waitForDoc(PROJECT_ID, ITEM, (d) => d && d.status === 'scanning' && d.countedQty === 2, { timeout: 20000 });
    const fresh = await getDoc(PROJECT_ID, ITEM);
    const skip = await run(desk.page, { files: [good], dryRun: false });
    expect(skip).toMatchObject({ created: 0, skipped: 1 });
    expect(skip.plan[0].reason).toContain('มีเอกสารอยู่แล้ว');   // ไม่มีอะไรให้กู้ = ไม่ถามข้อความยืนยันด้วยซ้ำ คืนแผนพร้อมเหตุผลที่ข้าม
    const dryExists = await run(desk.page, { files: [good] });
    expect(dryExists.plan[0].reason).toContain('มีเอกสารอยู่แล้ว');
    expect(await getDoc(PROJECT_ID, ITEM)).toEqual(fresh);    // ยอดใหม่ของผู้ช่วยไม่ถูกแตะ
    await closeApp(desk2); await closeApp(pda); await closeApp(desk);
  });

  test('C. ★ ด่านชั้นใน: รอบนับของหน้า ≠ Cloud · SKU กำลังเขียนอยู่ · เขียนล้ม นับ failed · มีคนสร้างเอกสารแทรกระหว่างทาง → transaction ไม่ทับ', async ({ browser }) => {
    const { desk, desk2, pda } = await bootWithRecheckedStockAdj(browser);
    const before = await getDoc(PROJECT_ID, ITEM);
    const good = restFile('SRC', 'S-F05', before);
    await resetByArrow(desk, [desk2, pda]);
    await loadTool(desk.page);

    // หน้านี้ถือรอบนับคนละรอบกับ Cloud → หยุดทั้งชุด (ต้องโหลดหน้าใหม่)
    await desk.page.evaluate(() => { window.__epochKeep = _countResetAt; _countResetAt = '2000-01-01T00:00:00.000Z'; });
    const staleEpoch = await run(desk.page, { files: [good], dryRun: false });
    await desk.page.evaluate(() => { _countResetAt = window.__epochKeep; });
    expect(staleEpoch.threw).toContain('หน้านี้ใช้รอบนับ');
    // SKU นั้นกำลังถูกเขียนอยู่ (in-flight) → ข้าม
    await desk.page.evaluate(() => _scanItemInFlight.add('S-F05'));
    const inflight = await run(desk.page, { files: [good] });
    await desk.page.evaluate(() => _scanItemInFlight.delete('S-F05'));
    expect(inflight.plan[0].reason).toContain('กำลังแก้ SKU นี้อยู่');
    expect(await getDoc(PROJECT_ID, ITEM)).toBeNull();

    // เขียนล้ม (เช่นเน็ตหลุด) → นับ failed ไม่นับเป็นสำเร็จ · Cloud ยังไม่มีเอกสาร
    await desk.page.evaluate(() => { window.__realTx = _db.runTransaction.bind(_db); _db.runTransaction = async () => { throw Object.assign(new Error('boom'), { code: 'unavailable' }); }; });
    const failed = await run(desk.page, { files: [good], dryRun: false });
    expect(failed).toMatchObject({ created: 0, skipped: 0 });
    expect(failed.failed).toEqual([{ sku: 'S-F05', error: 'unavailable boom' }]);
    expect(failed.verify[0].มีบน_Cloud).toBe(false);
    expect(await getDoc(PROJECT_ID, ITEM)).toBeNull();

    // ผู้ช่วยสร้างเอกสารใหม่ "หลังวางแผนแล้ว แต่ก่อน transaction" → transaction เห็นว่ามีแล้ว ต้องไม่ทับ
    const fresh = { sku: 'S-F05', countResetAt: desk.epoch, status: 'scanning', countedQty: 2, rev: 1, scannedBy: 'PDA-A' };
    await desk.page.evaluate((fresh) => {
      _db.runTransaction = async (fn) => { await _db.doc('stock_sessions/SRC/items/S-F05').set(fresh); return window.__realTx(fn); };
    }, fresh);
    const raced = await run(desk.page, { files: [good], dryRun: false });
    expect(raced).toMatchObject({ created: 0, skipped: 1, failed: [] });
    const cloud = await getDoc(PROJECT_ID, ITEM);
    expect(cloud).toMatchObject({ status: 'scanning', countedQty: 2, rev: 1 });
    expect(cloud.recheckQty).toBeUndefined();                  // ไม่มีอะไรจากไฟล์ย้อนหลังปนเข้ามา
    await closeApp(desk2); await closeApp(pda); await closeApp(desk);
  });

  test('E. ★ ไม่มีผล PITR: ประกอบ item จากแถวใน stock_audit_log (ไม่มี systemQty/effectiveQty) → กู้ได้ · เป็น Stock Adj · ไม่เข้าใบ 📦 (ฐานไม่สด) · login ใหม่ marker กลับมา', async ({ browser }) => {
    const desk = await bootFreshCount(browser, { role: 'pharmacist', user: 'Pharm', mode: 'desktop' });
    await armR16(desk.page);
    await loadTool(desk.page);
    const live = await desk.page.evaluate(() => state.skuMap.get('S-F05').systemQty);
    // ค่าจริงจาก log ของ SKU (นับ 53 · รีเช็ค 19 · ผู้นับ/ผู้รีเช็ค · เวลา) + ยอดระบบตอนรีเช็คที่คำนวณย้อนจากผลต่างใน ERP (ORDS −1 ⇒ 19+1 = 20)
    const sysAtRecheck = 19 + 1;                         // รีเช็ค 19 ผลต่าง −1 ⇒ ระบบตอนรีเช็ค 20
    expect(sysAtRecheck).not.toBe(live);                 // ต้องต่างจากยอดสด = ฐานไม่สด → ห้ามเด้งเข้าใบ
    // เวลาในรูปแบบที่แอปเก็บ (เวลาท้องถิ่น 'YYYY-MM-DD HH:mm:ss') — ต้องอยู่หลังรอบนับของเทส ไม่งั้นแอปถือว่า item ไม่ใช่ของรอบนี้ (ของจริงรอบ 5 ส.ค. · นับ 11 ส.ค. อยู่ในรอบ)
    const local = (min) => { const d = new Date(Date.now() + min * 60000), p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`; };
    const build = ({ sku, branch, epoch, sysAtRecheck, first, last }) => {   // เหมือนโค้ดที่ส่งให้ผู้ใช้วางใน Console ทุกบรรทัด (ต่างแค่ค่าตัวเลข)
      const F = (o) => { const f = {}; for (const [k, v] of Object.entries(o)) f[k] = typeof v === 'number' ? { integerValue: String(v) } : { stringValue: v }; return f; };
      return { name: `reconstructed-${branch}-${sku}.json`, json: [{ readTime: 'reconstructed-from-audit-log', found: {
        name: `projects/x/databases/(default)/documents/stock_sessions/${branch}/items/${sku}`,
        fields: F({ sku, barcode: sku, countResetAt: epoch, status: 'stock_adjustment', auditStatus: 'stock_adjustment', initialStatus: 'audit',
          countedQty: 53, scannedBy: 'PDA-A', firstScanAt: first, auditor: 'Pharm', recheckBy: 'Pharm',
          recheckQty: 19, recheckSystemQty: sysAtRecheck, recheckAt: last, timestamp: last, rev: 1 }) } }] };
    };
    const file = await desk.page.evaluate(`(${build.toString()})(${JSON.stringify({ sku: 'S-F05', branch: 'SRC', epoch: desk.epoch, sysAtRecheck, first: local(1), last: local(2) })})`);
    // ปล่อยให้ตัวจัดการ `files` ทำงานเหมือนผลจาก PITR (ชื่อเอกสารต้องเป็นรูป stock_sessions/<สาขา>/items/<SKU>)
    const dry = await run(desk.page, { files: [file] });
    expect(dry).toMatchObject({ dryRun: true, willRestore: 1 });
    expect(dry.plan[0].sum).toMatchObject({ status: 'stock_adjustment', counted: 53, recheck: 19, system: sysAtRecheck, diff: -1, passedRecheck: true });
    expect(await getDoc(PROJECT_ID, ITEM)).toBeNull();
    expect(await run(desk.page, { files: [file], dryRun: false })).toMatchObject({ created: 1, failed: [] });
    const cloud = await getDoc(PROJECT_ID, ITEM);
    expect(cloud).toMatchObject({ status: 'stock_adjustment', countedQty: 53, recheckQty: 19, recheckSystemQty: sysAtRecheck, auditor: 'Pharm', updatedBy: 'restore-pitr' });
    expect(cloud.systemQty).toBeUndefined();                 // ไม่แต่งค่าที่ไม่รู้ขึ้นมาเอง
    expect(cloud.effectiveQty).toBeUndefined();
    await desk.page.waitForFunction(() => state.scanData.get('S-F05')?.status === 'stock_adjustment', null, { timeout: 20000, polling: 100 });
    await quiet(desk.page);
    // ในแอป: ยังเป็นรายการ Stock Adj แต่ยอดระบบตอนรีเช็คไม่ตรงยอดสด → ไม่ขึ้นใบ 📦 (กันส่ง ORDS ซ้ำ) และถูกรายงานว่า "ต้องรีเช็คใหม่"
    const view = await desk.page.evaluate(() => ({ rows: _buildAdjustDocRows('ords').concat(_buildAdjustDocRows('irps')).map((x) => x.sku), stale: _adjustDocAudit().stale }));
    expect(view.rows).toEqual([]);
    expect(view.stale).toEqual([expect.objectContaining({ sku: 'S-F05', cnt: 19, frozen: sysAtRecheck, live })]);
    expect(strip(await getDoc(PROJECT_ID, ITEM))).toEqual(strip(cloud));     // เครื่องไหนก็ไม่ทับ
    // login ใหม่ → แอปสร้าง marker กลับจาก item เอง โดยไม่ล้ม แม้ item ไม่มี systemQty/effectiveQty
    const desk2 = await bootJoinCount(browser, { role: 'pharmacist', user: 'Pharm2', mode: 'desktop', expectEpoch: desk.epoch });
    await waitForDoc(PROJECT_ID, MARKERS, (d) => d?.items?.['S-F05']?.status === 'stock_adjustment' && d.items['S-F05'].recheckQty === 19, { timeout: 25000 });
    expect(await status(desk2.page)).toBe('stock_adjustment');
    expect(strip(await getDoc(PROJECT_ID, ITEM))).toEqual(strip(cloud));
    await closeApp(desk2); await closeApp(desk);
  });

  test('D. Cloud ไม่ใช่ schema v2 → หยุดก่อนวางแผน แม้หน้านี้ยังเชื่อว่าเป็น v2 (ไม่เขียนอะไร)', async ({ browser }) => {
    const desk = await bootFreshCount(browser, { role: 'pharmacist', user: 'Pharm', mode: 'desktop' });
    await loadTool(desk.page);
    const file = restFile('SRC', 'S-F05', { sku: 'S-F05', countResetAt: desk.epoch, status: 'scanning', countedQty: 1, rev: 1 });
    // ไม่พลิก schemaVersion บน emulator จริง (หน้าเว็บเขียน session doc ทับเองเป็นระยะ ทำให้เทสแกว่ง) —
    // ให้ "ผลอ่าน session จาก server" ที่เครื่องมือได้รับเป็น v1 เท่านั้น ส่วนหน้านี้ยังเชื่อว่าเป็น v2
    await desk.page.evaluate(() => {
      window.__docKeep = _db.doc.bind(_db);
      _db.doc = (p) => {
        const ref = window.__docKeep(p);
        if (p !== 'stock_sessions/SRC') return ref;
        const get = ref.get.bind(ref);
        ref.get = async (o) => { const snap = await get(o); return { exists: snap.exists, data: () => ({ ...snap.data(), schemaVersion: 1 }) }; };
        return ref;
      };
    });
    expect(await desk.page.evaluate(() => _isScanSchemaV2())).toBe(true);
    const res = await run(desk.page, { files: [file], dryRun: false });
    await desk.page.evaluate(() => { _db.doc = window.__docKeep; });
    expect(res.threw).toContain('schemaVersion 1');
    expect(await getDoc(PROJECT_ID, ITEM)).toBeNull();
    await closeApp(desk);
  });
});
