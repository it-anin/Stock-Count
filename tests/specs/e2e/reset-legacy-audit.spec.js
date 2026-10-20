// tools/reset-legacy-pharmacy-audits.js — ล้าง "รอรีเช็ค" เก่าของสาขายาที่ไม่ติดลบ ให้กลับเป็น ⏳ ยังไม่ได้นับ (19 ต.ค. 2026 · ผู้ใช้สั่ง)
// สคริปต์ Console ที่ "ลบข้อมูลจริง" บน production จึงต้องพิสูจน์ก่อนใช้ว่า:
//   ① dry-run ไม่เขียนอะไรเลย · ยืนยันผิด = ยกเลิก · ล้างเฉพาะ audit ที่ไม่ติดลบ (ติดลบ/มาร์คค้างส่ง/ไม่มีใน R01 = คงไว้) · only / skipDrafts ทำงาน
//   ② ล้างแล้ว item + marker หายพร้อมกัน · ตั้ง legacyLogBackfilledAt · ทุกเครื่องเห็น pending · lock ถูกปลด · รันซ้ำ = 0
//   ③ ★ ไม่ถูก "กู้คืน": เครื่องที่ login ทีหลังไม่สร้าง marker/รายการกลับจาก stock_audit_log (นี่คือเหตุผลของ flag — ทดสอบด้วย log ที่มีรายการเหล่านั้นจริง)
//   ④ เขียนเป็นชุด (CHUNK) — ชุดที่ล้มทำให้หยุด แต่ชุดที่เขียนแล้วคงอยู่ + ในเครื่องตรงกับ Cloud · รันซ้ำทำส่วนที่เหลือได้
const fs = require('fs');
const path = require('path');
const { test, expect, closeApp, requireEmulator } = require('../../lib/hooks');
const { bootFreshCount, bootJoinCount, PROJECT_ID } = require('../../lib/scenario');
const { seedItems } = require('../../lib/seed');
const { getDoc, setDoc, waitForDoc } = require('../../lib/emulator');

const TOOL = fs.readFileSync(path.join(__dirname, '../../../tools/reset-legacy-pharmacy-audits.js'), 'utf8');
const TOOL_CHUNK2 = TOOL.replace('const CHUNK = 200;', 'const CHUNK = 2;');       // ทดสอบการเขียนเป็นหลายชุดด้วยข้อมูลจำนวนน้อย
const ITEM = (sku) => `stock_sessions/SRC/items/${sku}`;
const MARKERS = 'stock_sessions/SRC_pharmacy_audit_markers';
const p2 = (n) => String(n).padStart(2, '0');
const nowTs = () => { const d = new Date(); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`; };
const dayOf = () => { const d = new Date(); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`; };
const T_REOPEN = '2026-10-19T03:00:00.000Z', T_DRAFT = '2026-10-19T04:00:00.000Z';

const auditItem = (sku, countedQty, extra = {}) => ({ sku, status: 'audit', auditStatus: 'pending', initialStatus: 'audit', auditor: '', countedQty,
  firstScanAt: nowTs(), ...extra });
const auditMarker = (epoch, countedQty, eff, sys, extra = {}) => ({ countResetAt: epoch, status: 'audit', auditStatus: 'pending', initialStatus: 'audit',
  auditor: '', countedQty, scannedBy: 'PDA-A', countTimestamp: nowTs(), timestamp: nowTs(), firstScanAt: nowTs(),
  soldQty: 0, inboundQty: 0, r16103Qty: 0, effectiveQty: eff, systemQty: sys, countConfirmedAt: '2026-10-19T02:00:00.000Z', confirmedAt: '2026-10-19T02:00:00.000Z', confirmedBy: 'Desk-Old', ...extra });

async function quiet(page) {
  await page.waitForFunction(() => _dirtySkus.size === 0 && _scanItemInFlight.size === 0 && !_scanItemFlushing, null, { timeout: 20000, polling: 100 });
}
const RESET = ['S-NOPRICE', 'S-NORM', 'S-PRICEY', 'S-ZERO'];               // ล้างได้ (เรียงแบบที่เครื่องมือเรียง)
const KEEP = ['S-NEG', 'S-DELCATNEG', 'S-PMONLY', 'S-ONLYR01'];              // คงไว้
const ALL = [...RESET, ...KEEP, 'S-F05'];
async function cloudState() {
  const m = await getDoc(PROJECT_ID, MARKERS);
  const items = {};
  for (const s of ALL) items[s] = await getDoc(PROJECT_ID, ITEM(s));
  return { markers: JSON.parse(JSON.stringify(m)), items: JSON.parse(JSON.stringify(items)) };
}
const markerItems = async () => Object.keys(((await getDoc(PROJECT_ID, MARKERS)) || {}).items || {}).sort();

// สถานการณ์ production: รอรีเช็คเก่า 4 ตัวที่ไม่ติดลบ + ตัวที่ต้องคงไว้ 3 ตัว + Stock Adj ตรง 1 ตัว (ไม่เกี่ยว) + stock_audit_log ที่มีรายการเหล่านั้น
async function bootScene(browser) {
  // boot ทั้งสองเครื่อง "ก่อน" seed: ถ้า login ของเครื่องหลังเจอ marker doc ที่ไม่มี flag มันจะ backfill จาก stock_audit_log แล้วตั้ง flag + สร้าง marker เอง
  //   (นั่นคือพฤติกรรมของ production ที่เครื่องมือต้องกันไว้ — ฉากทดสอบต้องเริ่มจาก "ยังไม่มี flag" จริง)
  const desk = await bootFreshCount(browser, { role: 'pharmacist', user: 'Pharm', mode: 'desktop' });
  const E = desk.epoch;
  const pda = await bootJoinCount(browser, { role: 'assistant', user: 'PDA-A', mode: 'pda', expectEpoch: E });
  await seedItems(PROJECT_ID, 'SRC', E, [
    auditItem('S-NORM', 7),                                                  // ล้างได้ (G 10) · มี marker
    auditItem('S-NOPRICE', 3),                                               // ล้างได้ (G 8) · "ไม่มี marker" (item อย่างเดียว) — ต้องตั้ง flag อยู่ดี
    auditItem('S-ZERO', 1),                                                  // ล้างได้ (G 0 — ศูนย์ไม่ใช่ติดลบ)
    auditItem('S-PRICEY', 2, { recheckQty: 4, recheckBy: 'Ph', recheckAt: T_DRAFT, recheckSystemQty: 5 }), // ล้างได้ · มียอดรีเช็คที่กรอกไว้ (จะหาย) · กด ↺ มา
    auditItem('S-NEG', 0),                                                   // คงไว้ — R01 ติดลบ
    auditItem('S-DELCATNEG', 0, { recheckQty: 0, recheckBy: 'Ph', recheckAt: T_DRAFT, recheckSystemQty: -2, backorder: true }), // คงไว้ — มาร์คค้างส่งแล้ว
    auditItem('S-PMONLY', 2),                                                // คงไว้ — ไม่มีแถวใน R01
    auditItem('S-ONLYR01', 0, { recheckQty: 0, recheckBy: 'Ph', recheckAt: T_DRAFT, recheckSystemQty: 6, backorder: true }), // คงไว้ — มาร์คค้างส่งไว้ (R01 ขยับเป็นบวกแล้ว G=6 ก็ยังเป็นงานรอยืนยัน ห้ามล้าง)
    { sku: 'S-F05', status: 'stock_adjustment', auditStatus: 'stock_adjustment', initialStatus: 'stock_adjustment', directAdj: true, effectiveQty: 3, systemQty: 5, countedQty: 3,
      auditor: '', firstScanAt: nowTs() },                                   // Stock Adj ตรง — ไม่ใช่ audit ไม่เกี่ยว
  ]);
  await setDoc(PROJECT_ID, MARKERS, { branch: 'SRC', countResetAt: E, items: {
    'S-NORM': auditMarker(E, 7, 8, 10),
    'S-ZERO': auditMarker(E, 1, 1, 0),
    'S-PRICEY': auditMarker(E, 2, 2, 5, { reopenedAt: T_REOPEN, reopenedBy: 'Ph' }),
    'S-NEG': auditMarker(E, 0, 0, -3),
    'S-DELCATNEG': auditMarker(E, 0, 0, -2, { backorder: true, recheckQty: 0, recheckBy: 'Ph', recheckAt: T_DRAFT }),
    'S-PMONLY': auditMarker(E, 2, 2, 0),
    'S-ONLYR01': auditMarker(E, 0, 0, 6, { backorder: true, recheckQty: 0, recheckBy: 'Ph', recheckAt: T_DRAFT }),
  } }, { merge: false });                                                   // ไม่มี legacyLogBackfilledAt — เครื่องมือต้องเป็นคนตั้ง
  // stock_audit_log มีรายการเหล่านี้จริง (production มีเสมอ) — ถ้าไม่มี flag เครื่องที่ login ทีหลังจะ "กู้" กลับเป็นรอรีเช็ค
  const entry = (sku, countedQty) => ({ sku, productName: 'x', barcode: 'B-' + sku, countedQty, scannedBy: 'PDA-A', timestamp: nowTs(), firstScanAt: nowTs(), status: 'audit', auditor: '', recheckQty: null, backorder: false });
  await setDoc(PROJECT_ID, `stock_audit_log/SRC_${dayOf()}`, { branch: 'SRC', date: dayOf(), updatedAt: new Date().toISOString(),
    items: [entry('S-NORM', 7), entry('S-NOPRICE', 3), entry('S-ZERO', 1), entry('S-PRICEY', 2)] }, { merge: false });

  for (const p of [desk.page, pda.page]) {
    await p.waitForFunction((skus) => skus.every((s) => state.scanData.get(s)?.status === 'audit'), [...RESET, 'S-NEG', 'S-DELCATNEG', 'S-PMONLY', 'S-ONLYR01'], { timeout: 25000, polling: 100 });
    // ให้สถานะนิ่งเหมือน production ก่อนเริ่ม (ดู convert-legacy-audit.spec.js): หยุด safety net 60 วิ + sync ตามเวลา แล้วรอเขียนค้างหมด
    await p.evaluate(async () => { clearInterval(_scanItemReconcileTimer); clearTimeout(_firestoreSyncTimer); _firestoreSyncTimer = null; await _flushDirtySkus(); await syncToFirestore(); });
    await quiet(p);
    await p.evaluate(() => { clearTimeout(_firestoreSyncTimer); _firestoreSyncTimer = null; });
  }
  return { desk, pda };
}
async function injectTool(page, text = TOOL) {
  await page.addScriptTag({ content: text });
  await page.evaluate(() => {
    window.__downloads = []; window.__promptReply = null;
    window.prompt = () => window.__promptReply;
    const click = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () { if (this.download) { window.__downloads.push(this.download); return; } return click.call(this); };
  });
}
const view = (p) => p.evaluate((skus) => ({
  st: skus.map((s) => [s, state.scanData.get(s)?.status ?? null]),
  tab: _backorderTabRows().map((r) => [r.sku, r.kind]),
  waiting: _legacyAuditCount(),
}), ALL);

test.describe('tools/reset-legacy-pharmacy-audits.js', () => {
  test.beforeEach(() => requireEmulator());
  test.setTimeout(240_000);

  test('dry-run ไม่เขียน · ยืนยันผิด = ยกเลิก · only/skipDrafts · ล้างจริงทีละขั้น · item+marker หาย + flag · ทุกเครื่อง pending · login ทีหลังไม่กู้คืน · รันซ้ำ = 0', async ({ browser }) => {
    const { desk, pda } = await bootScene(browser);
    await injectTool(desk.page);

    // ── ① dry-run: รายงานถูก ไม่เขียนอะไร ──
    const before = await cloudState();
    expect(before.markers.legacyLogBackfilledAt).toBeUndefined();
    const dry = await desk.page.evaluate(() => resetLegacyAudits());
    expect(dry.skus).toEqual(RESET);
    expect(dry.withDraft).toEqual(['S-PRICEY']);
    expect(dry.reopened).toEqual(['S-PRICEY']);
    expect(dry.kept).toEqual({
      'R01 ติดลบ — ไปที่แท็บ 📦 ค้างส่ง': ['S-NEG'],
      'มาร์คค้างส่งแล้ว — ไปยืนยันที่แท็บ 📦 ค้างส่ง': ['S-DELCATNEG', 'S-ONLYR01'],   // S-ONLYR01: R01 ไม่ติดลบ แต่ธงค้างส่งทำให้คงไว้ (กฎคนละข้อกับติดลบ)
      'ไม่มีแถวใน R01 (ไม่รู้ยอดระบบ)': ['S-PMONLY'],
    });
    expect(await cloudState()).toEqual(before);
    expect(await desk.page.evaluate(() => window.__downloads.length)).toBe(0);

    // skipDrafts เว้นรายการที่มียอดรีเช็คกรอกไว้ · only จำกัด SKU
    const sd = await desk.page.evaluate(() => resetLegacyAudits({ skipDrafts: true }));
    expect(sd.skus).toEqual(['S-NOPRICE', 'S-NORM', 'S-ZERO']);
    expect(sd.kept['มียอดรีเช็คที่กรอกไว้แล้ว (skipDrafts)']).toEqual(['S-PRICEY']);
    const only = await desk.page.evaluate(() => resetLegacyAudits({ only: ['S-NORM', 'S-NEG', 'S-DOESNOTEXIST'] }));
    expect(only.skus).toEqual(['S-NORM']);                                  // S-NEG ติดลบ → ถึงอยู่ใน only ก็ไม่ล้าง
    expect(await cloudState()).toEqual(before);

    // ── ยืนยันผิด = ยกเลิก (ไม่ดาวน์โหลด ไม่เขียน) ──
    await desk.page.evaluate(() => { window.__promptReply = 'ล้างรอรีเช็ค SRC 99'; });
    await desk.page.evaluate(() => resetLegacyAudits({ dryRun: false }));
    expect(await cloudState()).toEqual(before);
    expect(await desk.page.evaluate(() => window.__downloads.length)).toBe(0);

    // ── ② ขั้น A: only ['S-NORM'] ──
    // ★ ปิด listener (items + marker) ของเครื่องที่รันเครื่องมือก่อน: ปกติ listener เติม pending ให้ภายในไม่กี่ร้อย ms จึงมองไม่เห็นว่า
    //   "ในเครื่องที่รัน" ถูกล้างโดยเครื่องมือเองหรือไม่ (applyLocal) — ถ้าไม่ปิด การลบ applyLocal ออกไม่ทำให้เทสล้ม (mutation T14 เคยหลุด)
    //   (ปลด marker listener เองโดยไม่เรียก stopPharmacyAuditMarkerListener — ตัวนั้นล้าง _pharmacyAuditMarkerData ทิ้งด้วย ซึ่งไม่ใช่สภาพจริงตอนใช้งาน)
    await desk.page.evaluate(() => {
      stopScanItemsListener();
      if (_pharmacyAuditMarkerUnsubscribe) { _pharmacyAuditMarkerUnsubscribe(); _pharmacyAuditMarkerUnsubscribe = null; }
      window.__promptReply = 'ล้างรอรีเช็ค SRC 1';
    });
    const a = await desk.page.evaluate(() => resetLegacyAudits({ dryRun: false, only: ['S-NORM'] }));
    expect(a).toMatchObject({ reset: 1, deletedDocs: 1 });
    const localA = await desk.page.evaluate(() => ({ norm: state.scanData.get('S-NORM')?.status, zero: state.scanData.get('S-ZERO')?.status,
      inList: scanListMap.has('S-NORM'), markers: Object.keys(_pharmacyAuditMarkerData.items || {}).sort(), flag: !!_pharmacyAuditMarkerData.legacyLogBackfilledAt }));
    expect(localA).toEqual({ norm: 'pending', zero: 'audit', inList: false, flag: true,
      markers: ['S-DELCATNEG', 'S-NEG', 'S-ONLYR01', 'S-PMONLY', 'S-PRICEY', 'S-ZERO'] });   // ไม่มี S-NORM — เครื่องมือล้างในเครื่องเอง ไม่รอ listener
    await desk.page.evaluate(() => { startScanItemsListener(); startPharmacyAuditMarkerListener(); });
    expect(await desk.page.evaluate(() => window.__downloads.length)).toBe(1);
    expect(await getDoc(PROJECT_ID, 'stock_sessions/SRC_confirm_lock')).toBeNull();
    const afterA = await cloudState();
    expect(afterA.items['S-NORM']).toBeNull();                              // item ถูกลบ
    expect(afterA.markers.items['S-NORM']).toBeUndefined();                 // และ marker entry ก็หาย — พร้อมกัน
    expect(afterA.markers.legacyLogBackfilledAt).toBeTruthy();              // ★ flag ตั้งในก้อนเดียวกัน
    expect(afterA.markers.countResetAt).toBe(desk.epoch);
    for (const sku of [...KEEP, 'S-ZERO', 'S-PRICEY']) expect(afterA.markers.items[sku], sku).toEqual(before.markers.items[sku]);
    for (const sku of ALL.filter((s) => s !== 'S-NORM')) expect(afterA.items[sku], sku).toEqual(before.items[sku]);   // ที่เหลือไม่ถูกแตะแม้แต่ field เดียว
    // ทุกเครื่องเห็น S-NORM เป็น pending (ผ่าน listener) · ที่เหลือยังเป็นเดิม
    await pda.page.waitForFunction(() => state.scanData.get('S-NORM')?.status === 'pending', null, { timeout: 20000, polling: 100 });
    for (const p of [desk.page, pda.page]) {
      const v = await view(p);
      expect(v.st.find((r) => r[0] === 'S-NORM')[1]).toBe('pending');
      expect(v.st.find((r) => r[0] === 'S-ZERO')[1]).toBe('audit');
    }

    // ── ขั้น B: skipDrafts → S-NOPRICE (ไม่มี marker) + S-ZERO · S-PRICEY (มี draft) อยู่ต่อ ──
    await quiet(desk.page);
    await desk.page.evaluate(() => { window.__promptReply = 'ล้างรอรีเช็ค SRC 2'; });
    const b = await desk.page.evaluate(() => resetLegacyAudits({ dryRun: false, skipDrafts: true }));
    expect(b).toMatchObject({ reset: 2, deletedDocs: 2 });
    const afterB = await cloudState();
    for (const sku of ['S-NOPRICE', 'S-ZERO']) expect(afterB.items[sku], sku).toBeNull();
    expect(afterB.items['S-PRICEY']).toEqual(before.items['S-PRICEY']);     // draft ยังอยู่
    expect(await markerItems()).toEqual(['S-DELCATNEG', 'S-NEG', 'S-ONLYR01', 'S-PMONLY', 'S-PRICEY']);

    // ── ขั้น C: ล้างที่เหลือ (รวมที่มี draft) ──
    await quiet(desk.page);
    await desk.page.evaluate(() => { window.__promptReply = 'ล้างรอรีเช็ค SRC 1'; });
    const c = await desk.page.evaluate(() => resetLegacyAudits({ dryRun: false }));
    expect(c).toMatchObject({ reset: 1, deletedDocs: 1 });
    const afterC = await cloudState();
    expect(afterC.items['S-PRICEY']).toBeNull();
    expect(await markerItems()).toEqual(['S-DELCATNEG', 'S-NEG', 'S-ONLYR01', 'S-PMONLY']);   // เหลือเฉพาะที่คงไว้
    for (const sku of [...KEEP, 'S-F05']) expect(afterC.items[sku], sku).toEqual(before.items[sku]);
    expect(await getDoc(PROJECT_ID, 'stock_sessions/SRC_confirm_lock')).toBeNull();

    // ทุกเครื่อง: ล้างหมดแล้ว · ที่คงไว้ยังเป็น audit · แท็บค้างส่งมี S-NEG (รอรีเช็คติดลบ) + S-DELCATNEG (มาร์คแล้ว) เท่านั้น
    await pda.page.waitForFunction(() => ['S-NORM', 'S-NOPRICE', 'S-ZERO', 'S-PRICEY'].every((s) => state.scanData.get(s)?.status === 'pending'), null, { timeout: 20000, polling: 100 });
    for (const p of [desk.page, pda.page]) {
      const v = await view(p);
      expect(v.st).toEqual([['S-NOPRICE', 'pending'], ['S-NORM', 'pending'], ['S-PRICEY', 'pending'], ['S-ZERO', 'pending'],
        ['S-NEG', 'audit'], ['S-DELCATNEG', 'audit'], ['S-PMONLY', 'audit'], ['S-ONLYR01', 'audit'], ['S-F05', 'stock_adjustment']]);
      expect(v.waiting).toBe(4);
    }
    // แท็บ 📦 ค้างส่ง = รอรีเช็คติดลบ (S-NEG) + ที่มาร์คแล้ว (S-DELCATNEG · S-ONLYR01) — S-PMONLY (ไม่มี R01) ไม่ขึ้น
    expect((await view(desk.page)).tab).toEqual([['S-NEG', 'audit'], ['S-DELCATNEG', 'marked'], ['S-ONLYR01', 'marked']]);

    // ── ③ ★ เครื่องที่ login ทีหลังไม่ "กู้" รายการที่ล้างแล้ว (stock_audit_log ยังมีรายการเหล่านั้น) ──
    const late = await bootJoinCount(browser, { role: 'pharmacist', user: 'Pharm2', mode: 'desktop', expectEpoch: desk.epoch });
    await late.page.waitForFunction(() => !!_pharmacyAuditMarkerData?.legacyLogBackfilledAt, null, { timeout: 20000, polling: 100 });
    await quiet(late.page);
    await late.page.evaluate(() => new Promise((r) => setTimeout(r, 1500)));   // เผื่อเวลาให้ backfill/reconcile (ถ้าพังต้องเห็น)
    expect(await markerItems()).toEqual(['S-DELCATNEG', 'S-NEG', 'S-ONLYR01', 'S-PMONLY']);
    for (const sku of RESET) expect(await getDoc(PROJECT_ID, ITEM(sku)), sku).toBeNull();
    expect((await view(late.page)).st.slice(0, 4)).toEqual([['S-NOPRICE', 'pending'], ['S-NORM', 'pending'], ['S-PRICEY', 'pending'], ['S-ZERO', 'pending']]);

    // รันซ้ำ = ไม่มีอะไรให้ล้าง
    await injectTool(desk.page);
    const again = await desk.page.evaluate(() => resetLegacyAudits());
    expect(again.reset).toBe(0);
    expect(Object.keys(again.kept).length).toBe(3);

    await closeApp(late);
    await closeApp(pda);
    await closeApp(desk);
  });

  test('ปฏิเสธเมื่อเงื่อนไขไม่ครบ: แท็บ 📦 ค้างส่ง ปิด · ไม่ใช่เภสัช · PDA · ออฟไลน์ · มีงานเขียนค้าง — ไม่แตะข้อมูล', async ({ browser }) => {
    const { desk, pda } = await bootScene(browser);
    await injectTool(desk.page);
    const before = await cloudState();
    const attempt = (mut) => desk.page.evaluate(async (mutSrc) => {
      const saved = { sw: PHARMACY_BACKORDER_TAB, role: currentRole, online: Object.getOwnPropertyDescriptor(Navigator.prototype, 'onLine') };
      try { (new Function(mutSrc))(); await resetLegacyAudits({ dryRun: false }); return 'ไม่ error'; }
      catch (e) { return String(e.message); }
      finally { PHARMACY_BACKORDER_TAB = saved.sw; currentRole = saved.role; _scanItemInFlight.delete('X'); }
    }, mut);
    expect(await attempt('PHARMACY_BACKORDER_TAB = false')).toContain('แท็บ 📦 ค้างส่ง ปิดอยู่');
    expect(await attempt("currentRole = 'assistant'")).toContain('ต้อง login ด้วยรหัสเภสัช');
    expect(await attempt("_scanItemInFlight.add('X')")).toContain('งานเขียนรายการค้างอยู่');
    // PDA (UA) → ต้องรันบน Desktop เท่านั้น
    expect(await desk.page.evaluate(async () => {
      const real = Object.getOwnPropertyDescriptor(navigator, 'userAgent');
      Object.defineProperty(navigator, 'userAgent', { get: () => 'Mozilla/5.0 StockCountPDA/1.11', configurable: true });
      try { await resetLegacyAudits({ dryRun: false }); return 'ไม่ error'; } catch (e) { return String(e.message); }
      finally { if (real) Object.defineProperty(navigator, 'userAgent', real); else delete navigator.userAgent; }
    })).toContain('Desktop เท่านั้น');
    expect(await desk.page.evaluate(() => window.__downloads.length)).toBe(0);
    expect(await cloudState()).toEqual(before);
    expect(await getDoc(PROJECT_ID, 'stock_sessions/SRC_confirm_lock')).toBeNull();
    await closeApp(pda);
    await closeApp(desk);
  });

  test('เขียนเป็นหลายชุด (CHUNK 2): ชุดที่ 2 ล้ม → หยุดและบอกว่าล้างได้กี่รายการ · ชุดแรกคงอยู่ + ในเครื่องตรง Cloud · lock ถูกปลด · รันซ้ำทำส่วนที่เหลือ', async ({ browser }) => {
    const { desk, pda } = await bootScene(browser);
    await injectTool(desk.page, TOOL_CHUNK2);
    // ชุดที่ 2 ล้ม: ครอบ runTransaction ให้ครั้งที่ 2 throw (ครั้งแรก = ชุดแรก)
    await desk.page.evaluate(() => {
      window.__tx = 0; window.__realTx = _db.runTransaction.bind(_db);
      // นับเฉพาะ transaction ของชุดล้าง (ระบุจากโค้ดในฟังก์ชัน) — ล็อกสาขา/ปลดล็อกก็ใช้ runTransaction ต้องผ่านตามปกติ
      _db.runTransaction = (fn, o) => {
        if (String(fn).includes('RESET_CHANGED') && ++window.__tx === 2) return Promise.reject(Object.assign(new Error('unavailable (จำลอง)'), { code: 'unavailable' }));
        return window.__realTx(fn, o);
      };
      window.__promptReply = 'ล้างรอรีเช็ค SRC 4';
    });
    const msg = await desk.page.evaluate(async () => { try { await resetLegacyAudits({ dryRun: false }); return 'ไม่ error'; } catch (e) { return String(e.message); } });
    expect(msg).toContain('ล้างได้ 2/4 รายการ');
    expect(msg).toContain('unavailable');
    const mid = await cloudState();
    const gone = RESET.filter((s) => mid.items[s] === null);
    expect(gone).toEqual(['S-NOPRICE', 'S-NORM']);                            // ชุดแรก (เรียง SKU) คงอยู่
    expect(Object.keys(mid.markers.items).sort()).toEqual(['S-DELCATNEG', 'S-NEG', 'S-ONLYR01', 'S-PMONLY', 'S-PRICEY', 'S-ZERO']);
    expect(mid.markers.legacyLogBackfilledAt).toBeTruthy();
    expect(await getDoc(PROJECT_ID, 'stock_sessions/SRC_confirm_lock')).toBeNull();       // ปลด lock แม้ล้มกลางทาง
    expect(await desk.page.evaluate(() => _branchConfirming)).toBe(false);
    const v = await view(desk.page);                                                       // ในเครื่องตรงกับ Cloud (ไม่ใช่ครบ 4 และไม่ใช่ 0)
    expect(v.st.slice(0, 4)).toEqual([['S-NOPRICE', 'pending'], ['S-NORM', 'pending'], ['S-PRICEY', 'audit'], ['S-ZERO', 'audit']]);

    // รันซ้ำ (ไม่ครอบแล้ว) → ทำส่วนที่เหลือ
    await desk.page.evaluate(() => { _db.runTransaction = window.__realTx; });
    await quiet(desk.page);
    const rest = await desk.page.evaluate(() => resetLegacyAudits());
    expect(rest.skus).toEqual(['S-PRICEY', 'S-ZERO']);
    await desk.page.evaluate(() => { window.__promptReply = 'ล้างรอรีเช็ค SRC 2'; });
    const done = await desk.page.evaluate(() => resetLegacyAudits({ dryRun: false }));
    expect(done).toMatchObject({ reset: 2 });
    for (const sku of RESET) expect(await getDoc(PROJECT_ID, ITEM(sku)), sku).toBeNull();
    expect(await markerItems()).toEqual(['S-DELCATNEG', 'S-NEG', 'S-ONLYR01', 'S-PMONLY']);
    await closeApp(pda);
    await closeApp(desk);
  });

  test('marker doc ค้างจาก "รอบอื่น": ไม่เอา entry รอบเก่าติดมาเขียนใต้ป้ายรอบนี้ · ล้างตามปกติ · ตั้ง flag', async ({ browser }) => {
    // เหตุผล: startNewCount ลบ marker doc แต่ถ้าลบไม่หมด/ล้มกลางทาง doc ของรอบก่อนค้างได้ (เอกสารรอบอื่นถือว่าว่างเสมอ — เหมือน _writePharmacyAuditMarkers)
    //   ถ้าเครื่องมือหยิบ entry รอบเก่ามาเขียนต่อภายใต้ countResetAt ของรอบนี้ = ปลอมรอรีเช็คของรอบเก่าให้เป็นของรอบนี้ (mutation T26 เคยหลุดเพราะไม่มีเทสข้อนี้)
    const { desk, pda } = await bootScene(browser);
    await injectTool(desk.page);
    const OLD = '2026-01-01T00:00:00.000Z';
    expect(desk.epoch).not.toBe(OLD);
    await setDoc(PROJECT_ID, MARKERS, { branch: 'SRC', countResetAt: OLD, items: {
      'S-F05': auditMarker(OLD, 3, 3, 5),                                    // SKU นี้รอบนี้เป็น Stock Adj ตรง — ถ้า entry รอบเก่าหลุดมาเป็นของรอบนี้จะดึงกลับเป็นรอรีเช็ค
      'S-NORM': auditMarker(OLD, 9, 9, 10),                                  // SKU เดียวกับที่จะล้าง
      'S-GHOST': auditMarker(OLD, 1, 1, 4),                                  // SKU ที่รอบนี้ไม่มีเลย
    } }, { merge: false });
    // listener เห็น doc รอบเก่าแล้ว → ถือเป็นว่าง (ข้อมูลในเครื่องเป็น {ป้ายรอบนี้, items:{}})
    await desk.page.waitForFunction(() => Object.keys(_pharmacyAuditMarkerData?.items || {}).length === 0, null, { timeout: 20000, polling: 100 });
    const dry = await desk.page.evaluate(() => resetLegacyAudits());
    expect(dry.skus).toEqual(RESET);                                          // doc รอบเก่าไม่ถูกนับเป็น marker ของรอบนี้ → ใช้ item ตามปกติ (ไม่มี reopened/draft จาก marker เก่า)
    expect(dry.reopened).toEqual([]);

    await desk.page.evaluate(() => { window.__promptReply = 'ล้างรอรีเช็ค SRC 1'; });
    const r = await desk.page.evaluate(() => resetLegacyAudits({ dryRun: false, only: ['S-NORM'] }));
    expect(r).toMatchObject({ reset: 1, deletedDocs: 1 });
    const m = await getDoc(PROJECT_ID, MARKERS);
    expect(m.countResetAt).toBe(desk.epoch);                                  // เขียนใหม่เป็นป้ายรอบนี้
    expect(Object.keys(m.items || {})).toEqual([]);                           // ★ ไม่มี S-F05 / S-NORM / S-GHOST ของรอบเก่าติดมา
    expect(m.legacyLogBackfilledAt).toBeTruthy();                             // flag ตั้งในก้อนเดียวกัน (กัน login ถัดไป "กู้" จาก stock_audit_log)
    expect(await getDoc(PROJECT_ID, ITEM('S-NORM'))).toBeNull();
    for (const sku of ['S-NOPRICE', 'S-ZERO', 'S-PRICEY', ...KEEP]) expect(await getDoc(PROJECT_ID, ITEM(sku)), sku).not.toBeNull();   // ที่ไม่ใช่เป้าหมายไม่ถูกแตะ
    // ทุกเครื่อง: S-NORM เป็น pending · S-F05 ยังเป็น Stock Adj (entry รอบเก่าไม่ดึงกลับเป็นรอรีเช็ค) · ไม่มี S-GHOST โผล่ในรายการ
    await pda.page.waitForFunction(() => state.scanData.get('S-NORM')?.status === 'pending', null, { timeout: 20000, polling: 100 });
    await pda.page.evaluate(() => new Promise((res) => setTimeout(res, 1200)));   // เผื่อเวลาให้ listener apply marker (ถ้าพังต้องเห็น)
    for (const p of [desk.page, pda.page]) {
      const v = await p.evaluate(() => ({ f05: state.scanData.get('S-F05')?.status, ghost: state.scanData.get('S-GHOST')?.status ?? null,
        markers: Object.keys(_pharmacyAuditMarkerData?.items || {}) }));
      expect(v).toEqual({ f05: 'stock_adjustment', ghost: null, markers: [] });
    }
    expect(await getDoc(PROJECT_ID, 'stock_sessions/SRC_confirm_lock')).toBeNull();
    await closeApp(pda);
    await closeApp(desk);
  });

  test('ข้อมูลเปลี่ยนระหว่างทาง → ยกเลิกทั้งชุดก่อนลบอะไร (ตรวจซ้ำหลังได้ lock + ตรวจใน transaction อีกชั้น) · lock ถูกปลด · ทำซ้ำได้', async ({ browser }) => {
    const { desk, pda } = await bootScene(browser);
    await injectTool(desk.page);
    const attempt = (setupSrc) => desk.page.evaluate(async (src) => {
      (new Function(src))();
      window.__promptReply = 'ล้างรอรีเช็ค SRC 4';
      try { await resetLegacyAudits({ dryRun: false }); return 'ไม่ error'; }
      catch (e) { return String(e.message); }
      finally { if (window.__realAcquire) { window._acquireBranchConfirmLock = window.__realAcquire; window.__realAcquire = null; } if (window.__realTx) { _db.runTransaction = window.__realTx; window.__realTx = null; } }
    }, setupSrc);
    const untouched = async () => {                     // ไม่มีอะไรถูกลบ · marker ครบ · lock ปลด · ในเครื่องยังเป็น audit
      for (const sku of RESET) expect(await getDoc(PROJECT_ID, ITEM(sku)), sku).not.toBeNull();
      expect(await markerItems()).toEqual(['S-DELCATNEG', 'S-NEG', 'S-NORM', 'S-ONLYR01', 'S-PMONLY', 'S-PRICEY', 'S-ZERO']);
      expect(await getDoc(PROJECT_ID, 'stock_sessions/SRC_confirm_lock')).toBeNull();
      expect(await desk.page.evaluate(() => _branchConfirming)).toBe(false);
      expect((await view(desk.page)).st.slice(0, 4).map((r) => r[1])).toEqual(['audit', 'audit', 'audit', 'audit']);
    };

    // ก) มีเครื่องอื่นแก้ item (rev เปลี่ยน) หลังสำรวจ ก่อนได้ lock → ตรวจซ้ำเจอ → ยกเลิกทั้งชุด
    const m1 = await attempt(`window.__realAcquire = _acquireBranchConfirmLock;
      window._acquireBranchConfirmLock = async function () { await getScanItemsRef().doc('S-ZERO').update({ rev: firebase.firestore.FieldValue.increment(1) }); return window.__realAcquire.apply(this, arguments); };`);
    expect(m1).toContain('S-ZERO เปลี่ยนระหว่างทำ');
    expect(m1).toContain('ยังไม่ได้เขียนอะไร');
    await untouched();

    // ข) marker ของรายการหนึ่งเปลี่ยน (มีคนยืนยัน/เขียนใหม่) → ยกเลิกทั้งชุด
    const m2 = await attempt(`window.__realAcquire = _acquireBranchConfirmLock;
      window._acquireBranchConfirmLock = async function () { await getPharmacyAuditMarkerRef().update({ 'items.S-NORM.countConfirmedAt': '2026-10-20T05:00:00.000Z' }); return window.__realAcquire.apply(this, arguments); };`);
    expect(m2).toContain('S-NORM เปลี่ยนระหว่างทำ');
    await untouched();

    // ค) ผ่านการตรวจซ้ำไปแล้ว แต่ item เปลี่ยนก่อนเข้า transaction → transaction ตรวจ rev อีกชั้น → ไม่ลบอะไร (ชุดแรกก็ล้ม = 0/4)
    await quiet(desk.page);
    const m3 = await attempt(`window.__realTx = _db.runTransaction.bind(_db);
      _db.runTransaction = async (fn, o) => { if (String(fn).includes('RESET_CHANGED')) await getScanItemsRef().doc('S-NORM').update({ rev: firebase.firestore.FieldValue.increment(1) }); return window.__realTx(fn, o); };`);
    expect(m3).toContain('ล้างได้ 0/4 รายการ');
    expect(m3).toContain('S-NORM');
    await untouched();

    // ทำซ้ำได้: ไม่มีการแทรกแล้ว → ล้างครบ (rev ที่เปลี่ยนไปถูกอ่านใหม่ตอนสำรวจ)
    await quiet(desk.page);
    await desk.page.evaluate(() => { window.__promptReply = 'ล้างรอรีเช็ค SRC 4'; });
    const ok = await desk.page.evaluate(() => resetLegacyAudits({ dryRun: false }));
    expect(ok).toMatchObject({ reset: 4, deletedDocs: 4 });
    for (const sku of RESET) expect(await getDoc(PROJECT_ID, ITEM(sku)), sku).toBeNull();
    await closeApp(pda);
    await closeApp(desk);
  });
});
