// ค้างส่ง "กดเอง" (BACKORDER_MANUAL_MARK · 16 พ.ย. 2026) — เส้นทางจริงบน Firestore emulator สองเครื่อง
//   เภสัช A (Desktop) กด 📦 ค้างส่ง → stock_sessions/SRC_bomarks → ผู้ช่วย B (PDA) เห็นตัวเศษ Progress/📋 ขยับเอง (listener)
//   · ผู้ช่วยกดไม่ได้ · ไม่มีการเขียน items/ธง backorder · ถอนข้ามเครื่อง · B ล็อกอินใหม่ได้มาร์คจาก Cloud
//   · R01 วันถัดไปที่ยอดกลับเป็นบวก → มาร์คไม่มีผลเอง · เริ่มรอบนับใหม่ → มาร์คของรอบเก่าไม่ถูกใช้ (doc ยังอยู่แต่คนละรอบ)
// logic ล้วน (สิทธิ์/ด่าน/ล้ม/วงจร/listener) อยู่ที่ specs/logic/backorder-manual-mark.spec.js
const { test, expect, closeApp, requireEmulator } = require('../../lib/hooks');
const { bootFreshCount, bootJoinCount, PROJECT_ID } = require('../../lib/scenario');
const { setDoc, getDoc, waitForDoc, adminDb } = require('../../lib/emulator');

const KEY = 'stock_sessions/SRC_bomarks';
const listItems = async () => (await adminDb(PROJECT_ID).collection('stock_sessions/SRC/items').get()).docs.map((d) => ({ id: d.id, data: d.data() }));
const inDays = (n) => new Date(Date.now() + n * 86400_000).toISOString();
// รูปแบบเดียวกับ auto_r01_import.py build_payload() — ดู auto-r01-adopt.spec.js
function autoR01Write(rows, iso) {
  return setDoc(PROJECT_ID, 'stock_sessions/SRC_r01', {
    data_json: JSON.stringify(rows), r01UploadedAt: '07:31 น. 16/11/2026', r01Version: iso, r01BaselineAt: iso,
    r16Loaded: false, r16UploadedAt: '', r16DetailVersion: '', r16_103Loaded: false, r16_103UploadedAt: '', r16_103DetailVersion: '',
  });
}
// S-NORM = สินค้าใน PBM ของ fixture · O-* = นอก PBM · ผู้สมัคร (ติดลบในชุดนับ) = S-NORM · O-NEG-A · O-NEG-B
const DAY1 = [
  { colE: 'S-NORM', productName: 'ใน PBM ติดลบ', systemQty: -3 },
  { colE: 'O-NEG-A', productName: 'นอก PBM ติดลบ A', systemQty: -3 },
  { colE: 'O-NEG-B', productName: 'นอก PBM ติดลบ B', systemQty: -1, nc: 2 },
  { colE: 'O-COUPON', productName: 'คูปอง', systemQty: -199, nc: 1 },
  { colE: 'O-POS', productName: 'นอก PBM ยอดบวก', systemQty: 4 },
];
const DAY2 = DAY1.map((r) => (r.colE === 'S-NORM' ? { ...r, systemQty: 2 } : r));   // ใบรับของ S-NORM เข้าแล้ว

const snap = (page) => page.evaluate(() => {
  invalidatePopupRowsCache(); popupFilterState = 'pending'; popupStaffFilter = 'all';
  return {
    prog: document.getElementById('progressCount').textContent,
    marks: [..._boActiveMarks().keys()].sort(),
    pending: getFilteredPopupRows().map((r) => r.sku).sort(),
    cand: [..._negBackorderSkus].sort(),
  };
});
const waitSnap = (page, fn, arg) => page.waitForFunction(fn, arg, { timeout: 20000, polling: 100 });

test.describe('ค้างส่งกดเอง — เส้นทางจริง (emulator สองเครื่อง)', () => {
  test.beforeEach(() => requireEmulator());
  test.setTimeout(180_000);

  test('A กด → B (PDA) เห็นเอง · ผู้ช่วยกดไม่ได้ · ถอนข้ามเครื่อง · ล็อกอินใหม่ได้มาร์ค · R01 ใหม่ · รอบนับใหม่ · ไม่เขียน items', async ({ browser }) => {
    const A = await bootFreshCount(browser, { role: 'pharmacist', user: 'PharmA', mode: 'desktop' });
    const B = await bootJoinCount(browser, { role: 'assistant', user: 'AsstB', mode: 'pda', expectEpoch: A.epoch });
    for (const m of [A, B]) await m.page.evaluate(() => { PHARMACIST_STOCKADJ_ONLY = false; window.confirm = () => true; });
    const itemsBefore = (await listItems()).length;

    // ── บอท R01 เช้าวันนี้: ทั้งสองเครื่องรับผู้สมัครเอง · ยังไม่กด = ไม่มีใครถูกปิดงาน ──
    const iso1 = inDays(1);
    await autoR01Write(DAY1, iso1);
    for (const m of [A, B]) await waitSnap(m.page, (v) => state.r01Version === v && _negBackorderSkus.size === 3, iso1);
    for (const m of [A, B]) {
      const s = await snap(m.page);
      expect(s.cand).toEqual(['O-NEG-A', 'O-NEG-B', 'S-NORM']);          // รวมสินค้าใน PBM (ผู้ใช้เลือก "ทุกตัวที่ติดลบ")
      expect(s.marks).toEqual([]);
      expect(s.prog).toBe('0 / 4');                                       // ตัวเศษ 0 · คูปองไม่นับ · ติดลบที่ยังไม่กดไม่เข้าตัวเศษ
      expect(s.pending).toEqual(['O-NEG-A', 'O-NEG-B', 'O-POS', 'S-NORM']);   // ยังเป็นงานนับปกติทั้งหมด
    }
    // เภสัชเห็นแถว ⏳ รอตัดสิน + ปุ่ม (ผ่านแท็บจริง)
    const tab = await A.page.evaluate(() => { _avFilter = 'audit'; renderAuditVerifyTable(); return [...document.querySelectorAll('#auditVerifyTableBody tr')].map((tr) => [tr.children[1].textContent.trim(), tr.children[6].textContent.trim(), [...tr.querySelectorAll('button')].map((b) => b.getAttribute('onclick'))]); });
    expect(tab.map((r) => r[0])).toEqual(['O-NEG-A', 'O-NEG-B', 'S-NORM']);
    for (const r of tab) { expect(r[1]).toContain('รอตัดสิน'); expect(r[2]).toEqual([`markBackorderManual('${r[0]}')`]); }

    // ── ผู้ช่วย (PDA) กดไม่ได้ — ไม่มีอะไรถูกเขียน ──
    const denied = await B.page.evaluate(async () => { await markBackorderManual('S-NORM'); return _boMarks.size; });
    expect(denied).toBe(0);
    expect(await getDoc(PROJECT_ID, KEY)).toBeFalsy();

    // ── A กด S-NORM (ใน PBM) + O-NEG-A → cloud → B ขยับเอง ──
    await A.page.evaluate(async () => { await markBackorderManual('S-NORM'); await markBackorderManual('O-NEG-A'); });
    const doc = await waitForDoc(PROJECT_ID, KEY, (d) => d && d.marks_json && Object.keys(JSON.parse(d.marks_json)).length === 2);
    expect(doc.countResetAt).toBe(A.epoch);
    expect(Object.keys(JSON.parse(doc.marks_json)).sort()).toEqual(['O-NEG-A', 'S-NORM']);
    expect(JSON.parse(doc.marks_json)['S-NORM']).toMatchObject({ by: 'PharmA', g: -3 });
    for (const m of [A, B]) await waitSnap(m.page, () => _boActiveMarks().size === 2);
    for (const m of [A, B]) {
      const s = await snap(m.page);
      expect(s.marks).toEqual(['O-NEG-A', 'S-NORM']);
      expect(s.prog).toBe('2 / 4');                                       // +2 · ตัวหารเท่าเดิม
      expect(s.pending).toEqual(['O-NEG-B', 'O-POS']);                    // = ตัวหาร − ตัวเศษ (2)
    }

    // ── ไม่เขียน items / ธง backorder เลย (คนละรางกับมาร์คที่ผ่านการสแกน) ──
    await A.page.evaluate(() => _flushDirtySkus()); await B.page.evaluate(() => _flushDirtySkus());
    const items = await listItems();
    expect(items.length).toBe(itemsBefore);
    expect(items.filter((d) => d.data?.backorder || d.data?.recheckQty != null).length).toBe(0);
    for (const sku of ['S-NORM', 'O-NEG-A']) expect(await getDoc(PROJECT_ID, `stock_sessions/SRC/items/${sku}`), sku).toBeFalsy();

    // ── ถอน O-NEG-A ที่ A → B ลดเอง ──
    await A.page.evaluate(() => unmarkBackorderManual('O-NEG-A'));
    await waitForDoc(PROJECT_ID, KEY, (d) => d && Object.keys(JSON.parse(d.marks_json)).join() === 'S-NORM');
    await waitSnap(B.page, () => _boActiveMarks().size === 1);
    expect((await snap(B.page)).prog).toBe('1 / 4');

    // ── B ปิดแล้วล็อกอินใหม่ (stash) → ได้มาร์คจาก Cloud ตั้งแต่ snapshot แรก ──
    await B.page.reload();
    await waitSnap(B.page, () => typeof state !== 'undefined' && _boActiveMarks().size === 1 && document.getElementById('progressCount')?.textContent === '1 / 4');
    expect((await snap(B.page)).marks).toEqual(['S-NORM']);

    // ── เช้าวันใหม่: ใบรับของ S-NORM เข้าแล้ว (R01 เป็นบวก) → มาร์คไม่มีผลเอง ทั้งสองเครื่อง · O-NEG-A กลับเป็นงานนับปกติ ──
    const iso2 = inDays(2);
    await autoR01Write(DAY2, iso2);
    for (const m of [A, B]) await waitSnap(m.page, (v) => state.r01Version === v && !_negBackorderSkus.has('S-NORM'), iso2);
    for (const m of [A, B]) {
      const s = await snap(m.page);
      expect(s.cand).toEqual(['O-NEG-A', 'O-NEG-B']);
      expect(s.prog).toBe('0 / 4');                                       // มาร์คของ S-NORM ยังอยู่ใน doc แต่ไม่นับ (ไม่ติดลบแล้ว)
      expect(s.pending).toContain('S-NORM');                              // กลับเป็นงานนับปกติ (ยอดบวก)
    }
    expect(Object.keys(JSON.parse((await getDoc(PROJECT_ID, KEY)).marks_json))).toEqual(['S-NORM']);   // ไม่มีการเขียนตอนออก

    // ── เริ่มรอบนับใหม่ที่ A → มาร์คของรอบเก่าไม่ถูกใช้ (doc ยังอยู่คนละรอบ) · R01 ของบอทคงอยู่ (สาขายา) ──
    await A.page.evaluate(() => markBackorderManual('O-NEG-A'));
    await waitForDoc(PROJECT_ID, KEY, (d) => d && Object.keys(JSON.parse(d.marks_json)).sort().join() === 'O-NEG-A,S-NORM');
    await waitSnap(B.page, () => _boActiveMarks().size === 2);
    await A.page.evaluate(async () => { const orig = window.prompt; window.prompt = () => CLEAR_PIN; try { await startNewCount(); } finally { window.prompt = orig; } });
    const newEpoch = await A.page.evaluate(() => _countResetAt);
    expect(newEpoch).not.toBe(A.epoch);
    await waitSnap(B.page, (e) => _countResetAt === e, newEpoch);
    for (const m of [A, B]) {
      await waitSnap(m.page, () => _boActiveMarks().size === 0);
      const s = await snap(m.page);
      expect(s.marks).toEqual([]);
      expect(s.prog).toBe('0 / 4');
    }
    expect((await getDoc(PROJECT_ID, KEY)).countResetAt).toBe(A.epoch);       // ของรอบเก่าค้างอยู่บน cloud แต่ไม่ถูกใช้

    // รอบใหม่กดได้ตามปกติ และ transaction ไม่เอา entry ของรอบเก่าติดมา
    await A.page.evaluate(() => markBackorderManual('O-NEG-B'));
    const d3 = await waitForDoc(PROJECT_ID, KEY, (d) => d && d.countResetAt === newEpoch);
    expect(Object.keys(JSON.parse(d3.marks_json))).toEqual(['O-NEG-B']);
    await waitSnap(B.page, () => _boActiveMarks().size === 1);
    expect((await snap(B.page)).prog).toBe('1 / 4');

    await closeApp(B);
    await closeApp(A);
  });
});
