// ค้างส่งอัตโนมัติ (AUTO_BACKORDER_DEL) บน Firestore emulator — เส้นทาง "เช้าวันใหม่ที่บอท auto-r01 อัป R01" และ login จริง
//
// logic test (specs/logic/auto-backorder.spec.js) ตรึงกติกา · เทสนี้พิสูจน์ว่ากติกาทำงานผ่านเส้นทางจริงของระบบ:
//   ① บอทเขียน R01 ลง {branch}_r01 → listener ของเครื่องที่เปิดค้าง (_applyR01BaselineUpdate) → rebuildMaps → ตัวเศษ Progress/ลิสต์/แท็บ อัปเดตเอง
//   ② เช้าวันถัดไป R01 เปลี่ยน (ใบรับของเข้าแล้ว) → SKU ออกจากกลุ่มเอง กลับเป็นงานนับปกติ — ไม่มีงานตั้งเวลา ไม่เขียนข้อมูล
//   ③ รีโหลดหน้า (login ใหม่) ต้องได้ผลเดียวกัน
//   ④ ไม่มีการเขียน item/ธง backorder ลง Cloud เลย (คำนวณสด)
const { test, expect, closeApp, requireEmulator } = require('../../lib/hooks');
const { bootFreshCount, PROJECT_ID } = require('../../lib/scenario');
const { setDoc, getDoc, adminDb } = require('../../lib/emulator');

// เอกสาร items ทั้งหมดของ SRC บน emulator (admin SDK — อ่านอย่างเดียว)
const listItems = async () => (await adminDb(PROJECT_ID).collection('stock_sessions/SRC/items').get()).docs.map((d) => ({ id: d.id, data: d.data() }));

// รูปแบบเดียวกับ auto_r01_import.py build_payload() — เทียบ > แบบ lexicographic กับ ISO จริง (ดู auto-r01-adopt.spec.js)
function autoR01Write(branch, rows, iso) {
  return setDoc(PROJECT_ID, `stock_sessions/${branch}_r01`, {
    data_json: JSON.stringify(rows),
    r01UploadedAt: '07:31 น. 14/11/2026',
    r01Version: iso,
    r01BaselineAt: iso,
    r16Loaded: false, r16UploadedAt: '', r16DetailVersion: '',
    r16_103Loaded: false, r16_103UploadedAt: '', r16_103DetailVersion: '',
  });
}
const inDays = (n) => new Date(Date.now() + n * 86400_000).toISOString();

// S-NORM = สินค้าใน PBM ของ fixture (ยังไม่สแกน) · O-* = นอก PBM
const DAY1 = [
  { colE: 'S-NORM', productName: 'ใน PBM', systemQty: 4 },
  { colE: 'O-NEG-A', productName: 'นอก PBM ติดลบ A', systemQty: -3 },
  { colE: 'O-NEG-B', productName: 'นอก PBM ติดลบ B', systemQty: -1, nc: 2 },
  { colE: 'O-COUPON', productName: 'คูปอง', systemQty: -199, nc: 1 },
  { colE: 'O-POS', productName: 'นอก PBM ยอดบวก', systemQty: 4 },
];
// เช้าวันถัดไป: ใบรับของของ O-NEG-A เข้าแล้ว (ยอดเป็นบวก) · O-NEG-B ยังติดลบ · O-POS ถูกขายก่อนรับของ → ติดลบ
const DAY2 = DAY1.map((r) => (r.colE === 'O-NEG-A' ? { ...r, systemQty: 2 } : r.colE === 'O-POS' ? { ...r, systemQty: -6 } : r));

const view = (page) => page.evaluate(() => {
  const [num, denom] = document.getElementById('progressCount').textContent.split(' / ').map(Number);
  invalidatePopupRowsCache(); popupFilterState = 'pending'; popupStaffFilter = 'all';
  const pending = getFilteredPopupRows().map((r) => r.sku).sort();
  _avFilter = 'audit'; renderAuditVerifyTable();
  const tab = [...document.querySelectorAll('#auditVerifyTableBody tr')].map((tr) => tr.children[1]?.textContent.trim()).filter(Boolean);
  return { num, denom, pending, tab, auto: [..._autoBackorderSkus].sort(), badge: document.getElementById('avCountAudit').textContent };
});

test.describe('ค้างส่งอัตโนมัติ — เส้นทางจริง (emulator)', () => {
  test.beforeEach(() => requireEmulator());
  test.setTimeout(120_000);

  test('บอทอัป R01 เช้า → เครื่องที่เปิดค้างอัปเดตเอง → R01 วันถัดไปออกจากกลุ่มเอง → รีโหลดแล้วเท่าเดิม · ไม่มีการเขียนลง Cloud', async ({ browser }) => {
    const app = await bootFreshCount(browser, { role: 'pharmacist', user: 'Pharm', mode: 'desktop' });
    await app.page.evaluate(() => { PHARMACIST_STOCKADJ_ONLY = false; });
    const itemsBefore = (await listItems()).length;

    // ── เช้าวันที่ 1 ──
    const iso1 = inDays(1);
    await autoR01Write('SRC', DAY1, iso1);
    await app.page.waitForFunction((v) => state.r01Version === v && _autoBackorderSkus.size === 2, iso1, { timeout: 20000, polling: 100 });
    let v = await view(app.page);
    expect(v.auto).toEqual(['O-NEG-A', 'O-NEG-B']);                      // คูปอง (nc:1) ไม่เข้า · ยอดบวก/ใน PBM ไม่เข้า
    expect(v.denom).toBe(4);                                              // S-NORM · O-NEG-A · O-NEG-B · O-POS (คูปองไม่นับ)
    expect(v.num).toBe(2);                                                // ยังไม่มีใครสแกน → ตัวเศษมาจาก auto ล้วน
    expect(v.pending).toEqual(['O-POS', 'S-NORM']);                       // = ตัวหาร − ตัวเศษ (2 แถว)
    expect(v.pending.length).toBe(v.denom - v.num);
    expect(v.tab).toEqual(['O-NEG-A', 'O-NEG-B']);
    expect(v.badge).toBe('2');

    // ── เช้าวันที่ 2: บอทอัป R01 ใหม่ ──
    const iso2 = inDays(2);
    await autoR01Write('SRC', DAY2, iso2);
    await app.page.waitForFunction((v2) => state.r01Version === v2, iso2, { timeout: 20000, polling: 100 });
    await app.page.waitForFunction(() => _autoBackorderSkus.has('O-POS'), null, { timeout: 20000, polling: 100 });
    v = await view(app.page);
    expect(v.auto).toEqual(['O-NEG-B', 'O-POS']);                         // O-NEG-A ออกเอง · O-POS เข้าเอง
    expect(v.pending).toEqual(['O-NEG-A', 'S-NORM']);                     // O-NEG-A กลับเป็นงานนับปกติ
    expect(v.num).toBe(2); expect(v.denom).toBe(4);
    expect(v.pending.length).toBe(v.denom - v.num);
    expect(v.tab).toEqual(['O-NEG-B', 'O-POS']);

    // ── รีโหลด (login ใหม่ผ่าน stash) ต้องได้ผลเท่ากัน ──
    await app.page.reload();
    await app.page.waitForFunction(() => typeof state !== 'undefined' && state.r01Data.length === 5 && document.getElementById('progressCount')?.textContent.includes('/ 4'), null, { timeout: 30000, polling: 100 });
    const after = await view(app.page);
    expect(after.auto).toEqual(v.auto); expect(after.num).toBe(v.num); expect(after.denom).toBe(v.denom);
    expect(after.pending).toEqual(v.pending); expect(after.tab).toEqual(v.tab);

    // ── ไม่เขียนอะไรลง Cloud: ไม่มี item ใหม่ · ไม่มีธง backorder · session doc ไม่ถูกตั้งธง ──
    await app.page.evaluate(() => _flushDirtySkus());
    const items = await listItems();
    expect(items.length).toBe(itemsBefore);
    expect(items.filter((d) => d.data?.backorder || d.data?.recheckQty != null).length).toBe(0);
    for (const sku of ['O-NEG-A', 'O-NEG-B', 'O-POS']) expect(await getDoc(PROJECT_ID, `stock_sessions/SRC/items/${sku}`), sku).toBeFalsy();
    await closeApp(app);
  });

  test('ล็อกอินสาขา WH ด้วยข้อมูลเดียวกัน → ไม่มีกลุ่มค้างส่งอัตโนมัติ (WH ไม่แตะ)', async ({ browser }) => {
    const app = await bootFreshCount(browser, { branch: 'WH', role: 'supervisor', user: 'Sup', mode: 'desktop' });
    const iso = inDays(1);
    await autoR01Write('WH', DAY1, iso);
    // WH ไม่รับ R01 ใหม่ผ่าน listener แบบสาขายา (_applyR01BaselineUpdate เป็นของสาขายา) → รับตอนล็อกอิน/รีโหลดจาก master doc
    await app.page.reload();
    await app.page.waitForFunction((v) => typeof state !== 'undefined' && state.r01Version === v && state.r01Data.length === 5, iso, { timeout: 30000, polling: 100 });
    const r = await app.page.evaluate(() => ({ on: _autoBackorderOn(), tab: _backorderTabOn(), set: _autoBackorderSkus.size, auto: ['O-NEG-A', 'O-NEG-B'].map((s) => _isAutoBackorder(s, state.scanData.get(s))) }));
    expect(r.on).toBe(false); expect(r.tab).toBe(false); expect(r.auto).toEqual([false, false]);
    await closeApp(app);
  });
});
