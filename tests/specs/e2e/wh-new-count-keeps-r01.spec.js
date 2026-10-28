// WH · "เริ่มนับใหม่" ไม่ล้าง R01 — ใช้ R01 ของบอทต่อ (15 ต.ค. 2026 · ผู้ใช้สั่ง · อนุมัติตามกฎ 1) · e2e สองเครื่องผ่าน emulator
// Desktop (หัวหน้า) กด startNewCount จริง ขณะ PDA (พนักงานคลัง) ออนไลน์อยู่:
//   สวิตช์เปิด (ค่าเริ่มต้น): master doc WH_r01 ยังอยู่ · data_json/r01Version เท่าเดิม · field R16 ถูกเคลียร์ (กัน R16 รอบเก่ายัง "Ready")
//                            · Desktop และ PDA (ที่รับ epoch ใหม่) ยังเห็น R01 + catalog ครบ · Total SKU ไม่เป็น 0
//   canary (สวิตช์ปิด)       : เหมือนก่อนแก้ — doc ถูกลบ · R01 ในเครื่องทั้งสองถูกล้าง · Total SKU = 0
//   สาขายา                   : มีสวิตช์ของตัวเอง PHARMACY_KEEP_R01_ON_NEW_COUNT (28 ต.ค. 2026 — เทสอยู่ที่ pharmacy-new-count-keeps-r01.spec.js)
//                              ข้อสุดท้ายของไฟล์นี้ตรึงว่า "สวิตช์ WH เปิดอย่างเดียว" ไม่ลากสาขายาไปด้วย (สองสวิตช์อิสระต่อกัน)
const { test, expect, closeApp, requireEmulator } = require('../../lib/hooks');
const { bootFreshCount, bootJoinCount, PROJECT_ID } = require('../../lib/scenario');
const { adminDb, getDoc, waitForDoc } = require('../../lib/emulator');

const R16_STALE = { r16Loaded: true, r16UploadedAt: 'old', r16DetailVersion: 'R16-OLD', r16_103Loaded: true, r16_103UploadedAt: 'old', r16_103DetailVersion: 'R103-OLD' };

// prompt() ใน page.evaluate ทำ Playwright ค้าง — stub ระหว่างเรียก (เหมือน bootFreshCount) · เก็บข้อความที่ถามไว้ตรวจใน window.__lastPrompt
const resetFromDesk = (desk) => desk.page.evaluate(async () => {
  const orig = window.prompt; window.prompt = (m) => { window.__lastPrompt = String(m); return CLEAR_PIN; };
  try { await startNewCount(); } finally { window.prompt = orig; }
});
const localR01 = (page) => page.evaluate(() => ({
  n: state.r01Data.length, v: state.r01Version, skus: state.skuMap.size, total: _cachedTotalSku,
  badge: document.getElementById('badgeR01').textContent, ts: state.r01UploadedAt,
}));

// ตัวดักการ "ล้าง" R01 ชั่วคราว: ถ้าโค้ดล้าง R01 ในเครื่องแล้ว listener ของ master โหลดกลับให้ ผลสุดท้ายจะเหมือนกันทุกประการ
// (ข้อมูล/เวอร์ชัน/เวลาอัปกลับมาครบ) — แต่ช่วงที่ R01 ว่าง (Total SKU 0 · badge เด้ง) เป็นพฤติกรรมที่ห้ามเกิด · ตัวนับนี้จับการ "เคยว่าง" ได้
const trapWipes = (page) => page.evaluate(() => {
  window.__wipes = { r01: 0, ver: 0, ts: 0 };
  let d = state.r01Data, v = state.r01Version;
  Object.defineProperty(state, 'r01Data', { configurable: true, get: () => d, set: (x) => { if (Array.isArray(x) && x.length === 0) window.__wipes.r01++; d = x; } });
  Object.defineProperty(state, 'r01Version', { configurable: true, get: () => v, set: (x) => { if (!x) window.__wipes.ver++; v = x; } });
  const o = _setR01Ts; _setR01Ts = (t) => { if (!t) window.__wipes.ts++; return o(t); };
});
const wipes = (page) => page.evaluate(() => window.__wipes);

async function setup(browser, { keepOn }) {
  const iso = new Date().toISOString();                   // R01 "ของวันนี้" (ให้ toast ขึ้นแบบปกติ ไม่เตือน)
  const desk = await bootFreshCount(browser, { branch: 'WH', role: 'supervisor', user: 'มายด์', mode: 'desktop', r01Version: iso });
  const pda = await bootJoinCount(browser, { branch: 'WH', role: 'warehouse', user: 'มุก', mode: 'pda', expectEpoch: desk.epoch });
  await adminDb(PROJECT_ID).doc('stock_sessions/WH_r01').set(R16_STALE, { merge: true });   // meta R16 ของรอบเก่าค้างบน master
  if (!keepOn) for (const a of [desk, pda]) await a.page.evaluate(() => { WH_KEEP_R01_ON_NEW_COUNT = false; });
  return { desk, pda, iso };
}

test.describe('WH เริ่มนับใหม่ × R01 ของบอท', () => {
  test.beforeEach(() => requireEmulator());
  test.setTimeout(180_000);

  test('สวิตช์เปิด: R01 บน Cloud และในทุกเครื่องคงอยู่ · เคลียร์เฉพาะ field R16 · PDA รับ epoch ใหม่แล้ว R01 ไม่หาย', async ({ browser }) => {
    const { desk, pda, iso } = await setup(browser, { keepOn: true });
    const cloudBefore = await getDoc(PROJECT_ID, 'stock_sessions/WH_r01');
    const deskBefore = await localR01(desk.page), pdaBefore = await localR01(pda.page);
    expect(cloudBefore.data_json.length).toBeGreaterThan(100);
    expect(deskBefore.n).toBeGreaterThan(5); expect(pdaBefore.n).toBe(deskBefore.n);
    expect(deskBefore.total).toBeGreaterThan(0);

    // นับการเรียก restoreMasterFromFirestore ระหว่างเริ่มนับใหม่ — เครื่องที่มี R01 อยู่แล้วต้อง "ไม่ต้อง" โหลดจาก Cloud เลย
    // (ถ้าโค้ดล้าง R01 ในเครื่องแล้วค่อยโหลดกลับ ผลสุดท้ายเหมือนกัน แต่จะมีช่วง R01 ว่าง/badge เด้ง — ตัวนับนี้จับได้)
    await trapWipes(desk.page); await trapWipes(pda.page);
    await desk.page.evaluate(() => { window.__restoreCalls = 0; const o = restoreMasterFromFirestore; restoreMasterFromFirestore = (...a) => { window.__restoreCalls++; return o(...a); }; });
    await resetFromDesk(desk);
    expect(await desk.page.evaluate(() => window.__restoreCalls), 'R01 ในเครื่องต้องไม่ถูกล้างแล้วโหลดกลับ').toBe(0);
    expect(await wipes(desk.page), 'Desktop: R01/เวอร์ชัน/เวลาอัป ต้องไม่เคยถูกล้างระหว่างเริ่มนับใหม่').toEqual({ r01: 0, ver: 0, ts: 0 });
    // อ่าน toast ทันทีหลังเริ่มนับใหม่ — toast สำเร็จหายใน ~2.5 วิ (อ่านหลังรอ PDA จะว่างเปล่า)
    const toasts = await desk.page.evaluate(() => [...document.querySelectorAll('#toastContainer .toast')].map((t) => t.textContent));
    const newEpoch = await desk.page.evaluate(() => _countResetAt);
    expect(newEpoch).not.toBe(desk.epoch);
    expect(await desk.page.evaluate(() => window.__lastPrompt)).toContain('R01 ใช้ของบอทต่อ ไม่ล้าง');   // ข้อความ PIN ไม่โกหกว่าล้าง R01

    // Cloud: master doc ยังอยู่ — ข้อมูล/เวอร์ชันเท่าเดิมทุกไบต์ · เคลียร์เฉพาะ meta R16 (ชุดเดียวกับที่บอทเขียน)
    const cloudAfter = await getDoc(PROJECT_ID, 'stock_sessions/WH_r01');
    expect(cloudAfter, 'WH_r01 ต้องไม่ถูกลบ').toBeTruthy();
    expect(cloudAfter.data_json).toBe(cloudBefore.data_json);
    expect(cloudAfter.r01Version).toBe(iso);
    expect(cloudAfter.r01UploadedAt).toBe(cloudBefore.r01UploadedAt);
    expect(cloudAfter).toMatchObject({ r16Loaded: false, r16UploadedAt: '', r16DetailVersion: '', r16_103Loaded: false, r16_103UploadedAt: '', r16_103DetailVersion: '' });

    // Desktop ที่กดเอง: R01 + เวอร์ชัน + badge + Total SKU เท่าเดิม · รอบใหม่ใช้ R01 ได้ทันที
    expect(await localR01(desk.page)).toEqual(deskBefore);
    // PDA: รับ epoch ใหม่ผ่านเส้นทางซิงก์ (5 จุด) แล้วต้องไม่ล้าง R01
    await pda.page.waitForFunction((e) => _countResetAt === e, newEpoch, { timeout: 30_000, polling: 100 });
    expect(await localR01(pda.page)).toEqual(pdaBefore);
    expect(await wipes(pda.page), 'PDA: R01 ต้องไม่เคยถูกล้างตอนรับ epoch ใหม่').toEqual({ r01: 0, ver: 0, ts: 0 });
    // toast บอกเวลา R01 ของบอท (ของวันนี้ = ไม่เตือน) — อ่านไว้ตั้งแต่หลังเริ่มนับใหม่
    expect(toasts.join('|')).toMatch(/เริ่มนับใหม่แล้ว · R01 ของบอท \d{2}:\d{2} \d{2}\/\d{2}/);
    expect(toasts.join('|')).not.toContain('ไม่ใช่วันนี้');
    await closeApp(pda); await closeApp(desk);
  });

  test('canary — สวิตช์ปิด = เหมือนก่อนแก้: master doc ถูกลบ · R01 ในเครื่องทั้งสองถูกล้าง · Total SKU = 0', async ({ browser }) => {
    const { desk, pda } = await setup(browser, { keepOn: false });
    expect((await localR01(desk.page)).n).toBeGreaterThan(5);

    await resetFromDesk(desk);
    const newEpoch = await desk.page.evaluate(() => _countResetAt);
    await waitForDoc(PROJECT_ID, 'stock_sessions/WH_r01', (d) => !d, { timeout: 15_000 }).catch(() => {});
    expect(await getDoc(PROJECT_ID, 'stock_sessions/WH_r01'), 'ก่อนแก้ doc ต้องถูกลบ').toBeFalsy();
    expect(await localR01(desk.page)).toMatchObject({ n: 0, v: '', total: 0, badge: 'ยังไม่โหลด' });
    await pda.page.waitForFunction((e) => _countResetAt === e, newEpoch, { timeout: 30_000, polling: 100 });
    expect(await localR01(pda.page)).toMatchObject({ n: 0, v: '', total: 0, badge: 'ยังไม่โหลด' });
    await closeApp(pda); await closeApp(desk);
  });

  test('เครื่องที่ยังถือ epoch เก่าซิงก์ขึ้น Cloud (v2 _syncSessionMetaToFirestore) แล้วรับ epoch ใหม่ — R01 ไม่หาย', async ({ browser }) => {
    const { desk, pda } = await setup(browser, { keepOn: true });
    const pdaBefore = await localR01(pda.page);
    // ตัด listener ของ PDA ให้ไม่รับ epoch ใหม่ทางอื่น — เหลือเส้นทางเดียวคือซิงก์เอง (เหมือนเครื่องที่หลุดเน็ตแล้วกลับมา)
    await pda.page.evaluate(() => { stopScanSessionListener(); stopScanItemsListener(); });
    await resetFromDesk(desk);
    const newEpoch = await desk.page.evaluate(() => _countResetAt);
    expect(await pda.page.evaluate(() => _countResetAt), 'PDA ต้องยังถือ epoch เก่า').toBe(desk.epoch);

    expect(await pda.page.evaluate(() => syncToFirestore())).toBe(true);   // คืน true = "รับ epoch ใหม่แทนการเขียนทับ"
    expect(await pda.page.evaluate(() => _countResetAt)).toBe(newEpoch);
    expect(await localR01(pda.page)).toEqual(pdaBefore);
    await closeApp(pda); await closeApp(desk);
  });

  test('หัวหน้าที่ยังไม่มี R01 ในหน่วยความจำ → เริ่มนับใหม่โหลดจาก Cloud ให้ (ไม่เหลือ R01 ว่างทั้งที่ Cloud มี)', async ({ browser }) => {
    const { desk, pda } = await setup(browser, { keepOn: true });
    const before = await localR01(desk.page);
    await closeApp(pda);
    // ปิด listener ของ master ก่อน — ไม่งั้น `update()` ของ master doc ทำให้ listener โหลด R01 กลับให้เองหลังเริ่มนับใหม่ (ผลสุดท้ายเหมือนกัน)
    // จนแยกไม่ออกว่า startNewCount โหลดให้เองหรือไม่ — ข้อนี้ตรวจเฉพาะทางที่ startNewCount ทำเอง (ก่อน rebuildMaps)
    await desk.page.evaluate(() => { stopWhMasterListeners(); state.r01Data = []; state.r01Version = ''; });   // จำลองเครื่องที่เพิ่งล็อกอินและยังโหลด R01 ไม่ทัน
    expect((await localR01(desk.page)).n).toBe(0);

    await resetFromDesk(desk);
    const after = await localR01(desk.page);
    expect(after.n).toBe(before.n);
    expect(after.v).toBe(before.v);
    expect(after.total).toBe(before.total);
    expect(await getDoc(PROJECT_ID, 'stock_sessions/WH_r01')).toBeTruthy();
    await closeApp(desk);
  });

  test('สวิตช์ของสาขายาปิดอยู่ (สวิตช์ WH เปิด) → SRC ยังลบ R01 บน Cloud และล้างในเครื่อง — สองสวิตช์อิสระต่อกัน', async ({ browser }) => {
    const desk = await bootFreshCount(browser, { branch: 'SRC', role: 'pharmacist', user: 'เภสัช', mode: 'desktop' });
    expect(await getDoc(PROJECT_ID, 'stock_sessions/SRC_r01')).toBeTruthy();
    expect((await localR01(desk.page)).n).toBeGreaterThan(5);
    // ตั้งแต่ 28 ต.ค. 2026 สาขายามีสวิตช์ของตัวเอง (ค่าเริ่มต้นเปิด) — ข้อนี้ปิดสวิตช์ของสาขายาเพื่อตรึงว่า
    // WH_KEEP_R01_ON_NEW_COUNT=true อย่างเดียวไม่พอที่จะทำให้สาขายาคง R01 (ทางถอยของสาขายาต้องไม่กระทบ WH และกลับกัน)
    await desk.page.evaluate(() => { WH_KEEP_R01_ON_NEW_COUNT = true; PHARMACY_KEEP_R01_ON_NEW_COUNT = false; });
    await resetFromDesk(desk);
    expect(await desk.page.evaluate(() => window.__lastPrompt)).toContain('ล้างยอดที่นับ, R01 และ LOT');   // ข้อความเดิมของสาขายา
    expect(await getDoc(PROJECT_ID, 'stock_sessions/SRC_r01'), 'สาขายายังต้องลบ R01').toBeFalsy();
    expect(await localR01(desk.page)).toMatchObject({ n: 0, v: '', total: 0, badge: 'ยังไม่โหลด' });
    await closeApp(desk);
  });
});
