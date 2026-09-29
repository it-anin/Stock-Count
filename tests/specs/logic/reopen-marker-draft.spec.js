// ↺ (reopenPharmacyAudit) → เภสัชกรอกยอดรีเช็ค → ยอดต้องไม่หายเอง (ก.ย. 2026)
//
// อาการเดิม: กด ↺ แล้วกรอกยอดรีเช็ค ภายในไม่กี่วินาทียอดหาย → กดยืนยันได้ "ไม่มีรายการรอยืนยัน" และ flush ถัดไปเขียนการสูญเสียขึ้น cloud ถาวร
// ต้นเหตุ (trace จริงบน emulator):
//   1. ↺ เขียน marker แล้ว flush item — แต่ flush จับ payload ก่อนที่ marker snapshot จะ apply
//      → item บน cloud มี pharmacyAuditMarkerAt เป็นค่าเก่า → echo ของมันย้อน sd กลับเป็นค่าเก่าหลัง marker apply
//   2. session/item snapshot ถัดไปเรียก _applyPharmacyAuditMarkersToState อีกครั้ง เห็นว่า "ยังไม่เหมือน marker"
//      แล้ว apply ซ้ำ — reopen marker ปฏิเสธ keepDraft ทุกกรณี จึงลบยอดที่เพิ่งกรอกทิ้ง
// แก้ 2 ชั้น: (ก) ↺ ตั้ง pharmacyAuditMarkerAt/CountConfirmedAt เองก่อน flush (เทส e2e: pharmacy-reopen-recheck.spec.js)
//            (ข) reopen marker คงยอดที่กรอก "หลัง" ↺ (recheckAt ใหม่กว่า reopenedAt) — เทสนี้
//
// เทสนี้ตรึงทั้งสองด้านของ (ข) และด้านที่สองสำคัญกว่า:
//   ยอดที่กรอกหลัง ↺ ต้องอยู่รอด · ★ ยอดเก่าที่ ↺ ตั้งใจล้างต้องไม่เด้งกลับ (เจตนาเดิมของ marker reopen)
const { test, expect, bootBare, closeApp } = require('../../lib/hooks');

const REOPENED = '2026-09-29T10:00:00.000Z';

// สร้าง sd ที่ "เพิ่งกรอกยอดรีเช็ค" แล้วให้ marker reopen ถูก apply ซ้ำ (pharmacyAuditMarkerAt ค้างเป็นค่าเก่าเหมือนหลัง echo ย้อน)
async function applyReopen(page, { recheckAt, recheckQty = 5, backorder = false, mAt = '2026-09-29 16:59:00' }) {
  return page.evaluate(({ REOPENED, recheckAt, recheckQty, backorder, mAt }) => {
    currentBranch = 'SRC'; _countResetAt = 'E1';
    state.skuMap.clear(); state.scanData.clear(); scanListMap.clear();
    state.skuMap.set('S1', { sku: 'S1', productName: 'x', unitPrice: 20, systemQty: 5, negSys: false, barcodes: [], isDel: false });
    const sd = { status: 'audit', auditStatus: 'pending', initialStatus: 'audit', auditor: '', countedQty: 3, timestamp: '2026-09-29 09:00:00',
      pharmacyAuditMarkerAt: mAt, pharmacyAuditCountConfirmedAt: mAt };
    if (recheckQty != null) Object.assign(sd, { recheckQty, recheckBy: 'Pharm', recheckAt, recheckSystemQty: 5, recheckR01Version: 'R01-X' });
    if (backorder) sd.backorder = true;
    state.scanData.set('S1', sd);
    _pharmacyAuditMarkerData = { branch: 'SRC', countResetAt: 'E1', items: { S1: {
      countResetAt: 'E1', status: 'audit', auditStatus: 'pending', initialStatus: 'audit', auditor: '',
      reopenedAt: REOPENED, confirmedAt: REOPENED, countConfirmedAt: REOPENED, countedQty: 3, countTimestamp: '2026-09-29 09:00:00',
      timestamp: '2026-09-29 09:00:00', recheckQty: null, recheckBy: '', recheckAt: '', recheckSystemQty: null, recheckR01Version: '', backorder: false,
      soldQty: 0, inboundQty: 0, r16103Qty: 0, effectiveQty: 3, systemQty: 5,
    } } };
    const changed = _applyPharmacyAuditMarkersToState();
    const a = state.scanData.get('S1');
    return { changed, rq: a.recheckQty, by: a.recheckBy, at: a.recheckAt, sys: a.recheckSystemQty, r01v: a.recheckR01Version, bo: !!a.backorder,
      st: a.status, mAt: a.pharmacyAuditMarkerAt };
  }, { REOPENED, recheckAt, recheckQty, backorder, mAt });
}

test('ยอดที่กรอกหลัง ↺ ต้องอยู่รอดเมื่อ marker reopen ถูก apply ซ้ำ (บั๊กเดิม: ถูกลบทิ้ง)', async ({ browser }) => {
  const app = await bootBare(browser);

  const r = await applyReopen(app.page, { recheckAt: '2026-09-29T10:00:04.000Z' });
  expect(r.changed).toEqual(['S1']);                       // marker ถูก apply จริง (ไม่ใช่ same ข้ามไป) — ไม่งั้นเทสนี้ไม่ได้ทดสอบอะไร
  expect(r).toMatchObject({ rq: 5, by: 'Pharm', at: '2026-09-29T10:00:04.000Z', sys: 5, r01v: 'R01-X', st: 'audit' });
  expect(r.mAt).toBe(REOPENED);                            // marker ตามทัน → รอบถัดไป same ข้ามได้เอง

  // ค่าที่ต้องเดินทางคู่กับยอด: ธง backorder (เภสัชกดค้างส่งหลัง ↺) ไม่ถูกทิ้งด้วย
  const bo = await applyReopen(app.page, { recheckAt: '2026-09-29T10:00:04.000Z', recheckQty: 0, backorder: true });
  expect(bo).toMatchObject({ rq: 0, bo: true });           // 0 = "ตรวจแล้วไม่มีของ" ต้องไม่ถูกมองว่าไม่มี draft

  await closeApp(app);
});

test('★ ยอดเก่าที่ ↺ ตั้งใจล้างต้องไม่เด้งกลับ (เจตนาเดิมของ marker reopen)', async ({ browser }) => {
  const app = await bootBare(browser);

  // recheckAt เก่ากว่า reopenedAt = ยอดของรอบก่อนที่ค้างมากับ state เก่า/echo เก่า
  const r = await applyReopen(app.page, { recheckAt: '2026-09-29T09:30:00.000Z' });
  expect(r.changed).toEqual(['S1']);
  expect(r.rq).toBeUndefined();
  expect(r.by).toBeUndefined();                            // ล้างทั้งชุด ไม่ใช่แค่ยอด — recheckBy/At/SystemQty ต้องหายไปด้วย
  expect(r.at).toBeUndefined();
  expect(r.sys).toBeUndefined();

  // ไม่มี recheckAt เลย (ข้อมูลเก่า) = ไม่ใช่ยอดใหม่ ต้องล้าง
  const noAt = await applyReopen(app.page, { recheckAt: '' });
  expect(noAt.rq).toBeUndefined();

  // ไม่มียอดอยู่แล้ว → ไม่มีอะไรให้กู้ ไม่พัง
  const none = await applyReopen(app.page, { recheckAt: '', recheckQty: null });
  expect(none.rq).toBeUndefined();

  await closeApp(app);
});

test('เทียบเวลาข้ามรูปแบบถูกต้อง — recheckAt เวลาท้องถิ่น "YYYY-MM-DD HH:mm:ss" เทียบกับ reopenedAt แบบ ISO', async ({ browser }) => {
  const app = await bootBare(browser);
  // สร้างเวลาท้องถิ่นจาก reopenedAt ± 5 วิ ในหน้าเอง (ไม่ผูกกับ timezone ของเครื่องที่รันเทส)
  const local = (deltaMs) => app.page.evaluate(({ REOPENED, deltaMs }) => {
    const d = new Date(Date.parse(REOPENED) + deltaMs), p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  }, { REOPENED, deltaMs });

  const after = await applyReopen(app.page, { recheckAt: await local(+5000) });
  expect(after.rq).toBe(5);                                // ใหม่กว่า (ต่างรูปแบบก็ต้องเห็นว่าใหม่กว่า)
  const before = await applyReopen(app.page, { recheckAt: await local(-5000) });
  expect(before.rq).toBeUndefined();                       // เก่ากว่า → ล้าง

  const ms = await app.page.evaluate(() => ({ iso: _auditTimeMs('2026-09-29T10:00:00.000Z'), bad: _auditTimeMs('เมื่อวาน'), empty: _auditTimeMs(''), nul: _auditTimeMs(null) }));
  expect(ms.iso).toBe(Date.parse('2026-09-29T10:00:00.000Z'));
  expect([ms.bad, ms.empty, ms.nul].every(Number.isNaN)).toBe(true);   // parse ไม่ได้ = NaN → เทียบแล้วเป็น false เสมอ (ไม่คงยอดโดยไม่มีหลักฐาน)

  await closeApp(app);
});

test('★ marker Audit ปกติ (ไม่ใช่ reopen) ไม่เปลี่ยน: draft คงไว้เมื่อรุ่นการนับตรงกัน · ล้างเมื่อไม่ตรง', async ({ browser }) => {
  const app = await bootBare(browser);
  const run = (sdCount) => app.page.evaluate(({ sdCount }) => {
    currentBranch = 'SRC'; _countResetAt = 'E1';
    state.skuMap.clear(); state.scanData.clear(); scanListMap.clear();
    state.skuMap.set('S1', { sku: 'S1', productName: 'x', unitPrice: 20, systemQty: 5, negSys: false, barcodes: [], isDel: false });
    state.scanData.set('S1', { status: 'audit', auditStatus: 'pending', initialStatus: 'audit', auditor: '', countedQty: 3, timestamp: 't',
      recheckQty: 4, recheckBy: 'P', recheckAt: '2026-09-29T09:00:00.000Z', recheckSystemQty: 5,
      pharmacyAuditMarkerAt: 'old', pharmacyAuditCountConfirmedAt: sdCount });
    _pharmacyAuditMarkerData = { branch: 'SRC', countResetAt: 'E1', items: { S1: {
      countResetAt: 'E1', status: 'audit', auditStatus: 'pending', initialStatus: 'audit', auditor: '',
      confirmedAt: 'C1', countConfirmedAt: 'C1', countedQty: 3, recheckQty: null, soldQty: 0, inboundQty: 0, r16103Qty: 0, effectiveQty: 3, systemQty: 5,
    } } };
    _applyPharmacyAuditMarkersToState();
    return state.scanData.get('S1').recheckQty;
  }, { sdCount });

  expect(await run('C1')).toBe(4);                         // draft ของรุ่นนี้ (Confirm รอบแรกเดียวกัน) คงไว้ — พฤติกรรมเดิมทุกประการ
  expect(await run('C0')).toBeUndefined();                 // draft ของรุ่นก่อน (นับใหม่แล้ว) ล้าง — พฤติกรรมเดิมทุกประการ

  await closeApp(app);
});
