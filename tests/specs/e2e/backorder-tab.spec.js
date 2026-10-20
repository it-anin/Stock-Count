// แท็บ 📦 ค้างส่ง (สาขายา) ผ่านเส้นทางจริงบน emulator — กด 📦 ค้างส่ง ที่แถว Stock Adj ติดลบ → ✓ ยืนยันทั้งหมด → Pass ไม่เข้าใบ (19 ต.ค. 2026)
//
// เส้นทาง: Stock Adj ตรง (R01 ติดลบ) → markBackorderFromAdj [= ↺ reopenPharmacyAudit (เขียน marker ก่อน) + markBackorderItem (draft recheckQty 0 + backorder)]
//          → confirmAllAuditVerify (= _confirmPharmacyAuditBatched: ล็อกสาขา · ตรวจ R01/R16 · marker ผลสุดท้าย) → pass
// ตรึง 5 ด้าน:
//   1. ระหว่างทาง (มาร์คแล้ว ยังไม่ยืนยัน): item/marker บน Cloud ถูกสถานะ · หลุดจากใบ IRPS ทันที · อีกเครื่องเห็นตรงกัน
//   2. หลังยืนยัน: item + marker เป็น pass พร้อมธง · ไม่มีแถวในใบ · แถวอื่น (ติดลบที่ไม่มาร์ค · ขาด) ไม่ถูกกระทบและยังอยู่ในใบ
//   3. เครื่องที่ล็อกอินทีหลังเห็น pass (marker ไม่ฟื้นกลับเป็น Stock Adj) · ล็อก/ธงค้างส่งไม่รั่ว
//   4. ✕ ถอน ก่อนยืนยัน → กลับเป็นรอรีเช็คที่ Cloud ทุกเครื่องเห็น (ไม่ใช่ pass)
//   5. ผู้ช่วย (assistant) ไม่มีสิทธิ์: เรียกฟังก์ชันตรง ๆ ก็ไม่เปลี่ยนอะไรบน Cloud
const { test, expect, closeApp, requireEmulator, armDialog } = require('../../lib/hooks');
const { bootFreshCount, bootJoinCount, armR16, PROJECT_ID } = require('../../lib/scenario');
const { waitForDoc, getDoc } = require('../../lib/emulator');
const { seedItems } = require('../../lib/seed');

const ITEM = (sku) => `stock_sessions/SRC/items/${sku}`;
const MARKERS = 'stock_sessions/SRC_pharmacy_audit_markers';

// เครื่องนี้ไม่มีงานเขียน item ค้างแล้ว — ยืนยันรีเช็คจะ abort ทั้งชุดถ้ามี write แทรกระหว่างอ่านสองรอบ
async function quiet(page) {
  await page.waitForFunction(() => _dirtySkus.size === 0 && _scanItemInFlight.size === 0 && !_scanItemFlushing, null, { timeout: 20000, polling: 100 });
}

// Stock Adj ตรงจากรอบแรก (ฐาน effectiveQty − systemQty ที่แช่ไว้ตอน Confirm)
//   S-NEG ระบบ −3 นับ 0 → IRPS +3 (ตัวที่จะมาร์คค้างส่ง) · S-DELCATNEG ระบบ −2 นับ 0 → IRPS +2 (ติดลบเหมือนกันแต่ไม่มาร์ค = ต้องยังเข้าใบ)
//   S-NORM ระบบ 10 นับ 8 → ORDS 2 (ไม่ติดลบ → ไม่อยู่ในแท็บ) · S-F05 ระบบ 5 นับ 4 → ORDS 1
const adj = (sku, countedQty, systemQty) => ({ sku, status: 'stock_adjustment', auditStatus: 'stock_adjustment', initialStatus: 'stock_adjustment', directAdj: true,
  countedQty, effectiveQty: countedQty, systemQty, auditor: '', scannedBy: 'PDA-A' });
const SKUS = ['S-NEG', 'S-DELCATNEG', 'S-NORM', 'S-F05'];

async function bootWithAdj(browser) {
  const desk = await bootFreshCount(browser, { role: 'pharmacist', user: 'Pharm', mode: 'desktop' });
  await armR16(desk.page);
  await seedItems(PROJECT_ID, 'SRC', desk.epoch, [adj('S-NEG', 0, -3), adj('S-DELCATNEG', 0, -2), adj('S-NORM', 8, 10), adj('S-F05', 4, 5)]);
  await desk.page.waitForFunction((skus) => skus.every((s) => state.scanData.get(s)?.status === 'stock_adjustment'), SKUS, { timeout: 15000, polling: 100 });
  return desk;
}
const docs = (page) => page.evaluate(() => ({
  ords: _buildAdjustDocRows('ords').map((r) => [r.sku, r.qty]).sort(),
  irps: _buildAdjustDocRows('irps').map((r) => [r.sku, r.qty]).sort(),
  tab: _backorderTabRows().map((r) => [r.sku, r.kind]),
}));

test.describe('แท็บ 📦 ค้างส่ง · มาร์คจาก Stock Adj → ยืนยัน → Pass', () => {
  test.beforeEach(() => requireEmulator());
  test.setTimeout(150_000);

  test('มาร์ค → (ระหว่างทาง) หลุดจากใบ + อีกเครื่องเห็น → ยืนยัน → pass ทั้ง item/marker · แถวอื่นไม่กระทบ · ล็อกอินทีหลังเห็น pass', async ({ browser }) => {
    const desk = await bootWithAdj(browser);
    const pda = await bootJoinCount(browser, { role: 'assistant', user: 'PDA-A', mode: 'pda', expectEpoch: desk.epoch });
    await pda.page.waitForFunction((skus) => skus.every((s) => state.scanData.get(s)?.status === 'stock_adjustment'), SKUS, { timeout: 15000, polling: 100 });

    // ก่อนมาร์ค: แท็บมีเฉพาะติดลบ 2 ตัว (Stock Adj) · ใบ IRPS มี +3/+2 (นี่คือสิ่งที่ปุ่มต้องกัน)
    expect(await docs(desk.page)).toEqual({ ords: [['S-F05', 1], ['S-NORM', 2]], irps: [['S-DELCATNEG', 2], ['S-NEG', 3]], tab: [['S-DELCATNEG', 'adj'], ['S-NEG', 'adj']] });

    // ── 1. มาร์ค ──
    await quiet(desk.page);
    armDialog(desk.page, 'y');
    await desk.page.evaluate(() => markBackorderFromAdj('S-NEG'));
    const marked = await waitForDoc(PROJECT_ID, ITEM('S-NEG'), (d) => d && d.status === 'audit' && d.backorder === true && d.recheckQty === 0, { timeout: 25000 });
    expect(marked).toMatchObject({ initialStatus: 'audit', recheckBy: 'Pharm', auditor: '' });
    expect(marked.directAdj).toBeUndefined();                          // ธง Stock Adj ตรงถูกล้างโดย reopen
    const mk = (await getDoc(PROJECT_ID, MARKERS)).items['S-NEG'];
    expect(mk).toMatchObject({ status: 'audit', auditor: '' });
    expect(mk.reopenedAt).toBeTruthy();                                // reopen เขียน marker ขึ้น Cloud ก่อนแก้ในเครื่อง (authoritative)
    expect(await docs(desk.page)).toEqual({ ords: [['S-F05', 1], ['S-NORM', 2]], irps: [['S-DELCATNEG', 2]], tab: [['S-DELCATNEG', 'adj'], ['S-NEG', 'marked']] });
    // อีกเครื่อง (ผู้ช่วย PDA) เห็นเป็น audit เหมือนกัน — ไม่เห็นเป็น Stock Adj
    await pda.page.waitForFunction(() => { const s = state.scanData.get('S-NEG'); return s?.status === 'audit' && s.backorder === true; }, null, { timeout: 20000, polling: 100 });

    // ── 2. ยืนยัน ──
    await quiet(desk.page);
    await desk.page.evaluate(() => confirmAllAuditVerify());
    await desk.page.waitForFunction(() => _branchConfirming === false, null, { timeout: 30000, polling: 100 });
    const done = await waitForDoc(PROJECT_ID, ITEM('S-NEG'), (d) => d && d.status === 'pass' && d.auditor === 'Pharm', { timeout: 25000 });
    expect(done).toMatchObject({ backorder: true, recheckQty: 0 });
    const markers = (await getDoc(PROJECT_ID, MARKERS)).items;
    expect(markers['S-NEG']).toMatchObject({ status: 'pass', auditStatus: 'approved', backorder: true });   // ← บั๊กเดิม (commit fix(backorder-marker)): เป็น stock_adjustment
    // แถวอื่นไม่ถูกกระทบ — ยังเป็น Stock Adj ตรง และยังอยู่ในใบเหมือนเดิม
    for (const sku of ['S-DELCATNEG', 'S-NORM', 'S-F05']) expect(await getDoc(PROJECT_ID, ITEM(sku)), sku).toMatchObject({ status: 'stock_adjustment', directAdj: true });
    for (const sku of ['S-DELCATNEG', 'S-NORM', 'S-F05']) expect(markers[sku], sku).toBeUndefined();   // Stock Adj ตรงไม่มี marker
    expect(await docs(desk.page)).toEqual({ ords: [['S-F05', 1], ['S-NORM', 2]], irps: [['S-DELCATNEG', 2]], tab: [['S-DELCATNEG', 'adj']] });
    expect(await getDoc(PROJECT_ID, 'stock_sessions/SRC_confirm_lock')).toBeNull();   // ล็อกสาขาถูกปลด

    // ── 3. เครื่องที่ล็อกอินทีหลัง (restore + backfill ตอน login) เห็น pass ไม่ถูกฟื้นเป็น Stock Adj / รอรีเช็ค ──
    const late = await bootJoinCount(browser, { role: 'pharmacist', user: 'Pharm2', mode: 'desktop', expectEpoch: desk.epoch });
    await late.page.waitForFunction(() => state.scanData.get('S-NEG')?.status === 'pass', null, { timeout: 20000, polling: 100 });
    expect(await docs(late.page)).toEqual({ ords: [['S-F05', 1], ['S-NORM', 2]], irps: [['S-DELCATNEG', 2]], tab: [['S-DELCATNEG', 'adj']] });
    expect(await late.page.evaluate(() => ({ s: state.scanData.get('S-NEG').status, b: !!state.scanData.get('S-NEG').backorder }))).toEqual({ s: 'pass', b: true });
    // และ item บน Cloud ยังเป็น pass หลังเครื่องที่สามล็อกอิน (ไม่มีใครเขียนทับ)
    expect((await getDoc(PROJECT_ID, ITEM('S-NEG'))).status).toBe('pass');

    await closeApp(late);
    await closeApp(pda);
    await closeApp(desk);
  });

  test('✕ ถอน ก่อนยืนยัน → กลับเป็นรอรีเช็คติดลบที่ทุกเครื่อง (ไม่ใช่ pass) · ยืนยันไม่ทำให้เป็น pass โดยไม่มี draft', async ({ browser }) => {
    const desk = await bootWithAdj(browser);
    await quiet(desk.page);
    armDialog(desk.page, 'y');
    await desk.page.evaluate(() => markBackorderFromAdj('S-NEG'));
    await waitForDoc(PROJECT_ID, ITEM('S-NEG'), (d) => d && d.status === 'audit' && d.backorder === true, { timeout: 25000 });
    await quiet(desk.page);

    await desk.page.evaluate(() => { resetRecheckItem('S-NEG'); return _flushDirtySkus(); });
    const back = await waitForDoc(PROJECT_ID, ITEM('S-NEG'), (d) => d && d.status === 'audit' && !d.backorder && d.recheckQty == null, { timeout: 25000 });
    expect(back.auditor).toBe('');
    expect(await docs(desk.page)).toEqual({ ords: [['S-F05', 1], ['S-NORM', 2]], irps: [['S-DELCATNEG', 2]], tab: [['S-DELCATNEG', 'adj'], ['S-NEG', 'audit']] });
    // ไม่มี draft → ไม่มีอะไรให้ยืนยัน (ปุ่ม ✓ ยืนยันทั้งหมด ไม่ทำให้ผ่านเอง)
    expect(await desk.page.evaluate(() => getPharmacistAuditPendingMap().size)).toBe(0);
    await closeApp(desk);
  });

  test('ผู้ช่วย (assistant) เรียก markBackorderFromAdj ตรง ๆ → ไม่เปลี่ยนอะไรบน Cloud', async ({ browser }) => {
    const desk = await bootWithAdj(browser);
    const asst = await bootJoinCount(browser, { role: 'assistant', user: 'Asst', mode: 'desktop', expectEpoch: desk.epoch });
    await asst.page.waitForFunction(() => state.scanData.get('S-NEG')?.status === 'stock_adjustment', null, { timeout: 15000, polling: 100 });
    armDialog(asst.page, 'y');
    await asst.page.evaluate(() => markBackorderFromAdj('S-NEG'));
    await asst.page.evaluate(() => new Promise((r) => setTimeout(r, 1500)));   // เผื่อเวลาให้ถ้าเขียนได้จริงต้องเห็น
    expect(await getDoc(PROJECT_ID, ITEM('S-NEG'))).toMatchObject({ status: 'stock_adjustment', directAdj: true });
    expect((await getDoc(PROJECT_ID, ITEM('S-NEG'))).backorder).toBeFalsy();
    await closeApp(asst);
    await closeApp(desk);
  });
});
