// สาขายา · "เริ่มนับใหม่" ไม่ล้าง R01 — ใช้ R01 ของบอทต่อ (28 ต.ค. 2026 · ผู้ใช้สั่ง · อนุมัติแผนตามกฎ 1) · e2e ผ่าน emulator
// เดิม SRC/KKL/SSS กด startNewCount แล้ว {branch}_r01 ที่บอท auto-r01 อัป ~07:30 ถูกลบ → Total SKU = 0 และบอท auto-r16 (21:10) ข้ามสาขา ("ไม่มี R01 ของสาขา")
// สวิตช์เปิด (ค่าเริ่มต้น): master doc ยังอยู่ · data_json/r01Version/r01UploadedAt/r01BaselineAt เท่าเดิม · field r16* ถูกเคลียร์ (กัน R16 รอบเก่ายัง "Ready")
//                          · ทุกเครื่อง (ทั้งที่กดเองและที่รับ epoch ใหม่) ยังเห็น R01 + catalog ครบ · Total SKU ไม่เป็น 0
//                          · ★ ไม่รีเซ็ต _r01BaselineAt (ต่างจาก WH) — ไม่งั้น baseline ถูก adopt ซ้ำ (ระหว่างซิงก์ epoch และหลังรีโหลด) แล้วล้าง R16 ฟรี
//                          · ★ บอท auto-r16 (Python จริง) หลังกดเริ่มนับใหม่ ไม่ถูกข้ามสาขา → เผยแพร่ timeline ผูก epoch ใหม่ → Desktop โหลด → Confirm ได้
// canary (สวิตช์ปิด): เหมือนก่อนแก้ — doc ถูกลบ · R01 ในเครื่องถูกล้าง · Total SKU = 0 · บอทข้ามสาขา
const { test, expect, closeApp, requireEmulator } = require('../../lib/hooks');
const { bootFreshCount, bootJoinCount, PROJECT_ID } = require('../../lib/scenario');
const { adminDb, getDoc, setDoc, waitForDoc } = require('../../lib/emulator');
const B = require('../../lib/r16-bot-emulator');
const R = require('../../lib/r16-104-fixture');

const DAY = B.bkkDay();                                   // วันนี้ตามเวลาไทย (ที่บอท auto-r16 ใช้เป็น "วันนี้") — ห้ามฮาร์ดโค้ดวันที่
const R16_STALE = { r16Loaded: true, r16UploadedAt: 'old', r16DetailVersion: 'R16-OLD', r16_103Loaded: true, r16_103UploadedAt: 'old', r16_103DetailVersion: 'R103-OLD' };
const R16_CLEARED = { r16Loaded: false, r16UploadedAt: '', r16DetailVersion: '', r16_103Loaded: false, r16_103UploadedAt: '', r16_103DetailVersion: '' };

// ฟิลด์ที่บอท auto-r01 เขียนลง master ทุกเช้า (รูปเดียวกับ autoR01Write ใน auto-r01-adopt.spec.js — มี r01BaselineAt ที่ทุกเครื่อง adopt)
const botMasterFields = (iso) => ({ r01UploadedAt: DAY.thai, r01Version: iso, r01BaselineAt: iso, ...R16_CLEARED });

// prompt() ใน page.evaluate ทำ Playwright ค้าง — stub ระหว่างเรียก (เหมือน bootFreshCount) · เก็บข้อความที่ถามไว้ตรวจใน window.__lastPrompt
const resetFromDesk = (desk) => desk.page.evaluate(async () => {
  const orig = window.prompt; window.prompt = (m) => { window.__lastPrompt = String(m); return CLEAR_PIN; };
  try { await startNewCount(); } finally { window.prompt = orig; }
});
const localR01 = (page) => page.evaluate(() => ({
  n: state.r01Data.length, v: state.r01Version, skus: state.skuMap.size, total: _cachedTotalSku,
  badge: document.getElementById('badgeR01').textContent, ts: state.r01UploadedAt, baseline: _r01BaselineAt,
}));
const sessionBlob = async (branch) => {
  const d = await getDoc(PROJECT_ID, `stock_sessions/${branch}`);
  return d?.session_data_json ? JSON.parse(d.session_data_json) : null;
};

// ตัวดักการ "ล้าง" R01 ชั่วคราว (เหมือน wh-new-count-keeps-r01.spec.js): ล้างแล้ว listener โหลดกลับให้ ผลสุดท้ายเหมือนกันทุกประการ
// แต่ช่วงที่ R01 ว่าง (Total SKU 0 · badge เด้ง) เป็นพฤติกรรมที่ห้ามเกิด · ตัวนับนี้จับการ "เคยว่าง" ได้
const trapWipes = (page) => page.evaluate(() => {
  window.__wipes = { r01: 0, ver: 0, ts: 0 };
  let d = state.r01Data, v = state.r01Version;
  Object.defineProperty(state, 'r01Data', { configurable: true, get: () => d, set: (x) => { if (Array.isArray(x) && x.length === 0) window.__wipes.r01++; d = x; } });
  Object.defineProperty(state, 'r01Version', { configurable: true, get: () => v, set: (x) => { if (!x) window.__wipes.ver++; v = x; } });
  const o = _setR01Ts; _setR01Ts = (t) => { if (!t) window.__wipes.ts++; return o(t); };
});
const wipes = (page) => page.evaluate(() => window.__wipes);

// ตัวนับการ adopt baseline: _applyR01BaselineUpdate (โหลด R01 จาก master ซ้ำ + rebuildMaps) และ _clearR16ForNewBaseline (ล้าง R16)
// "คง R01" ต้องไม่ทำให้สองตัวนี้ทำงาน — ถ้า baseline ถูกรีเซ็ตเป็นว่าง ซิงก์ epoch ของ startNewCount จะเรียก adopt ซ้ำเมื่อ session doc มี baseline อยู่แล้ว
const spyAdopt = (page) => page.evaluate(() => {
  window.__adopt = { baseline: 0, clearR16: 0 };
  const a = _applyR01BaselineUpdate; _applyR01BaselineUpdate = (...x) => { window.__adopt.baseline++; return a(...x); };
  const c = _clearR16ForNewBaseline; _clearR16ForNewBaseline = (...x) => { window.__adopt.clearR16++; return c(...x); };
});
const adopts = (page) => page.evaluate(() => window.__adopt);

// เครื่องสาขายา (เภสัช Desktop + ผู้ช่วย PDA ถ้าต้องการ) ที่ R01 เป็น "ของบอท": master มี r01BaselineAt แล้วทุกเครื่อง adopt baseline นั้นผ่าน listener
async function setup(browser, { branch = 'SRC', withPda = true, keepOn = true } = {}) {
  const iso = new Date().toISOString();                   // R01 "ของวันนี้" (ให้ toast ขึ้นแบบปกติ ไม่เตือน) · ใช้เป็น r01Version + r01BaselineAt
  const desk = await bootFreshCount(browser, { branch, role: 'pharmacist', user: 'เภสัช', mode: 'desktop', r01Version: iso });
  const pda = withPda ? await bootJoinCount(browser, { branch, role: 'assistant', user: 'ผู้ช่วย', mode: 'pda', expectEpoch: desk.epoch }) : null;
  await setDoc(PROJECT_ID, `stock_sessions/${branch}_r01`, botMasterFields(iso));
  const apps = [desk, pda].filter(Boolean);
  for (const a of apps) await a.page.waitForFunction((v) => _r01BaselineAt === v, iso, { timeout: 20_000, polling: 100 });
  if (!keepOn) for (const a of apps) await a.page.evaluate(() => { PHARMACY_KEEP_R01_ON_NEW_COUNT = false; });
  return { desk, pda, iso };
}

test.describe('สาขายา เริ่มนับใหม่ × R01 ของบอท', () => {
  test.beforeEach(() => requireEmulator());
  test.setTimeout(240_000);

  test('สวิตช์เปิด: R01 บน Cloud และในทุกเครื่องคงอยู่ · เคลียร์เฉพาะ field R16 · baseline ไม่ถูกแตะ · PDA รับ epoch ใหม่แล้ว R01 ไม่หาย', async ({ browser }) => {
    const { desk, pda, iso } = await setup(browser, { keepOn: true });
    await setDoc(PROJECT_ID, 'stock_sessions/SRC_r01', R16_STALE);   // meta R16 ของรอบเก่าค้างบน master
    const cloudBefore = await getDoc(PROJECT_ID, 'stock_sessions/SRC_r01');
    const deskBefore = await localR01(desk.page), pdaBefore = await localR01(pda.page);
    expect(cloudBefore.data_json.length).toBeGreaterThan(100);
    expect(cloudBefore.r01BaselineAt).toBe(iso);
    expect(deskBefore.n).toBeGreaterThan(5); expect(pdaBefore.n).toBe(deskBefore.n);
    expect(deskBefore.total).toBeGreaterThan(0);
    expect(deskBefore.baseline).toBe(iso); expect(pdaBefore.baseline).toBe(iso);

    // เครื่องที่มี R01 อยู่แล้วต้อง "ไม่ต้อง" โหลดจาก Cloud เลย · และไม่เคยว่างระหว่างทาง · และไม่ adopt baseline ซ้ำ
    await trapWipes(desk.page); await trapWipes(pda.page);
    await spyAdopt(desk.page); await spyAdopt(pda.page);
    await desk.page.evaluate(() => { window.__restoreCalls = 0; const o = restoreMasterFromFirestore; restoreMasterFromFirestore = (...a) => { window.__restoreCalls++; return o(...a); }; });
    await resetFromDesk(desk);
    expect(await desk.page.evaluate(() => window.__restoreCalls), 'R01 ในเครื่องต้องไม่ถูกล้างแล้วโหลดกลับ').toBe(0);
    expect(await wipes(desk.page), 'Desktop: R01/เวอร์ชัน/เวลาอัป ต้องไม่เคยถูกล้างระหว่างเริ่มนับใหม่').toEqual({ r01: 0, ver: 0, ts: 0 });
    expect(await adopts(desk.page), 'Desktop: ห้าม adopt baseline ซ้ำระหว่างเริ่มนับใหม่').toEqual({ baseline: 0, clearR16: 0 });
    // อ่าน toast ทันทีหลังเริ่มนับใหม่ — toast สำเร็จหายใน ~2.5 วิ
    const toasts = await desk.page.evaluate(() => [...document.querySelectorAll('#toastContainer .toast')].map((t) => t.textContent));
    const newEpoch = await desk.page.evaluate(() => _countResetAt);
    expect(newEpoch).not.toBe(desk.epoch);
    const prompt = await desk.page.evaluate(() => window.__lastPrompt);
    expect(prompt).toContain('ล้างยอดที่นับ, R16 และ LOT ที่แนบไว้ ของสาขานี้ (R01 ใช้ของบอทต่อ ไม่ล้าง)');   // ข้อความ PIN ไม่โกหกว่าล้าง R01
    expect(prompt).not.toContain('ของคลังนี้');

    // Cloud: master doc ยังอยู่ — ข้อมูล/เวอร์ชัน/baseline เท่าเดิมทุกไบต์ · เคลียร์เฉพาะ meta R16 (ชุดเดียวกับที่บอทเขียน)
    const cloudAfter = await getDoc(PROJECT_ID, 'stock_sessions/SRC_r01');
    expect(cloudAfter, 'SRC_r01 ต้องไม่ถูกลบ').toBeTruthy();
    expect(cloudAfter.data_json).toBe(cloudBefore.data_json);
    expect(cloudAfter.r01Version).toBe(iso);
    expect(cloudAfter.r01UploadedAt).toBe(cloudBefore.r01UploadedAt);
    expect(cloudAfter.r01BaselineAt).toBe(iso);
    expect(cloudAfter).toMatchObject(R16_CLEARED);
    // session doc: epoch ใหม่ + baseline เดิม (ไม่ถูกรีเซ็ตเป็นว่าง)
    const sess = await sessionBlob('SRC');
    expect(sess.countResetAt).toBe(newEpoch);
    expect(sess.r01BaselineAt, 'session doc ต้องเก็บ baseline เดิม').toBe(iso);

    // Desktop ที่กดเอง: R01 + เวอร์ชัน + badge + Total SKU + baseline เท่าเดิม · รอบใหม่ใช้ R01 ได้ทันที
    expect(await localR01(desk.page)).toEqual(deskBefore);
    // PDA: รับ epoch ใหม่ผ่านเส้นทางซิงก์ (5 จุด) แล้วต้องไม่ล้าง R01
    await pda.page.waitForFunction((e) => _countResetAt === e, newEpoch, { timeout: 30_000, polling: 100 });
    expect(await localR01(pda.page)).toEqual(pdaBefore);
    expect(await wipes(pda.page), 'PDA: R01 ต้องไม่เคยถูกล้างตอนรับ epoch ใหม่').toEqual({ r01: 0, ver: 0, ts: 0 });
    expect(await adopts(pda.page), 'PDA: ห้าม adopt baseline ซ้ำตอนรับ epoch ใหม่').toEqual({ baseline: 0, clearR16: 0 });
    // toast บอกเวลา R01 ของบอท (ของวันนี้ = ไม่เตือน)
    expect(toasts.join('|')).toMatch(/เริ่มนับใหม่แล้ว · R01 ของบอท \d{2}:\d{2} \d{2}\/\d{2}/);
    expect(toasts.join('|')).not.toContain('ไม่ใช่วันนี้');
    await closeApp(pda); await closeApp(desk);
  });

  test('KKL และ SSS ก็คง R01 เหมือน SRC (ตัวตัดสินเดียวกัน · Desktop เครื่องเดียวต่อสาขา)', async ({ browser }) => {
    for (const branch of ['KKL', 'SSS']) {
      const { desk, iso } = await setup(browser, { branch, withPda: false });
      const cloudBefore = await getDoc(PROJECT_ID, `stock_sessions/${branch}_r01`);
      const before = await localR01(desk.page);
      expect(before.n, branch).toBeGreaterThan(5); expect(before.total, branch).toBeGreaterThan(0);
      await resetFromDesk(desk);
      const after = await getDoc(PROJECT_ID, `stock_sessions/${branch}_r01`);
      expect(after, `${branch}_r01 ต้องไม่ถูกลบ`).toBeTruthy();
      expect(after.data_json).toBe(cloudBefore.data_json);
      expect(after.r01BaselineAt).toBe(iso);
      expect(after).toMatchObject(R16_CLEARED);
      expect(await localR01(desk.page), branch).toEqual(before);
      await closeApp(desk);
    }
  });

  test('★ baseline (ก): session doc มี baseline อยู่แล้ว → เริ่มนับใหม่ต้องไม่ adopt ซ้ำระหว่างซิงก์ epoch (ไม่โหลด R01 จาก master ซ้ำ · ไม่ล้าง R16 ฟรี)', async ({ browser }) => {
    const { desk, iso } = await setup(browser, { withPda: false });
    // พา baseline ที่ adopt แล้วลง session doc (เหมือนเครื่องที่ใช้งานมาสักพัก) — ถ้า startNewCount รีเซ็ต baseline เป็นว่าง
    // _syncSessionMetaToFirestore จะเห็น session.r01BaselineAt ใหม่กว่า '' แล้วเรียก _applyR01BaselineUpdate ระหว่างเริ่มนับใหม่เอง
    await desk.page.evaluate(() => { saveSession(); return syncToFirestore(); });
    await waitForDoc(PROJECT_ID, 'stock_sessions/SRC', (d) => d && JSON.parse(d.session_data_json).r01BaselineAt === iso, { timeout: 15_000 });
    await spyAdopt(desk.page);
    await resetFromDesk(desk);
    expect(await adopts(desk.page), 'ห้าม adopt baseline ซ้ำระหว่างเริ่มนับใหม่').toEqual({ baseline: 0, clearR16: 0 });
    expect(await desk.page.evaluate(() => _r01BaselineAt)).toBe(iso);
    expect((await sessionBlob('SRC')).r01BaselineAt).toBe(iso);
    await closeApp(desk);
  });

  test('★ baseline (ข): session doc ยังไม่มี baseline → เริ่มนับใหม่ไม่รีเซ็ต baseline · รีโหลดแล้ว R16 ที่โหลดทีหลังไม่ถูกล้างฟรี', async ({ browser }) => {
    const { desk, iso } = await setup(browser, { withPda: false });
    expect((await sessionBlob('SRC'))?.r01BaselineAt || '', 'ตั้งต้น: session doc ยังไม่มี baseline (ไม่งั้นเทสนี้ไม่ได้พิสูจน์อะไร)').toBe('');
    await resetFromDesk(desk);
    expect(await desk.page.evaluate(() => _r01BaselineAt), 'baseline ในเครื่องต้องไม่ถูกรีเซ็ต').toBe(iso);
    expect((await sessionBlob('SRC')).r01BaselineAt, 'session doc ต้องได้ baseline (ไม่ใช่ค่าว่าง)').toBe(iso);

    // ระหว่างวันมี R16 เข้ามา (อัปมือ/บอท) แล้วซิงก์ขึ้น session — จากนั้นรีโหลดหน้า (เช่น deploy ใหม่ → รีโหลดอัตโนมัติ)
    await desk.page.evaluate(() => { state.r16Loaded = true; state.r16UploadedAt = 'ทดสอบ'; state.r16SalesMap.set('S-NORM', 3); saveSession(); return syncToFirestore(); });
    await waitForDoc(PROJECT_ID, 'stock_sessions/SRC', (d) => d && JSON.parse(d.session_data_json).r16Loaded === true, { timeout: 15_000 });
    await desk.page.reload({ waitUntil: 'domcontentloaded' });
    const { waitForAppReady, waitForLoginDone } = require('../../lib/boot');
    await waitForAppReady(desk.page); await waitForLoginDone(desk.page);
    // ส่งเอกสาร master ซ้ำให้ listener (เปลี่ยนแค่ข้อความเวลา) แล้วรอจนเห็นผล — การันตีว่า listener ประมวลผล snapshot "หลังรีโหลด" แล้ว
    await setDoc(PROJECT_ID, 'stock_sessions/SRC_r01', { r01UploadedAt: '08:11 น. ' + DAY.thai.split(' น. ')[1] });
    await desk.page.waitForFunction(() => document.getElementById('r01Timestamp')?.textContent?.includes('08:11'), null, { timeout: 20_000, polling: 100 });
    const after = await desk.page.evaluate(() => ({ baseline: _r01BaselineAt, r16: state.r16Loaded, sales: state.r16SalesMap.size }));
    expect(after.baseline).toBe(iso);
    expect(after.r16, 'R16 ต้องไม่ถูกล้างโดย adopt ซ้ำ').toBe(true);
    expect(after.sales).toBe(1);
    await closeApp(desk);
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

  test('เภสัชที่ยังไม่มี R01 ในหน่วยความจำ → เริ่มนับใหม่โหลดจาก Cloud ให้ (ไม่เหลือ R01 ว่างทั้งที่ Cloud มี)', async ({ browser }) => {
    const { desk } = await setup(browser, { withPda: false });
    const before = await localR01(desk.page);
    // ปิด listener ของ master ก่อน — ไม่งั้น `update()` ของ master doc ทำให้ listener โหลด R01 กลับให้เองหลังเริ่มนับใหม่ (ผลสุดท้ายเหมือนกัน)
    // จนแยกไม่ออกว่า startNewCount โหลดให้เองหรือไม่ — ข้อนี้ตรวจเฉพาะทางที่ startNewCount ทำเอง (ก่อน rebuildMaps)
    await desk.page.evaluate(() => { stopWhMasterListeners(); state.r01Data = []; state.r01Version = ''; });   // จำลองเครื่องที่เพิ่งล็อกอินและยังโหลด R01 ไม่ทัน
    expect((await localR01(desk.page)).n).toBe(0);

    await resetFromDesk(desk);
    const after = await localR01(desk.page);
    expect(after.n).toBe(before.n);
    expect(after.v).toBe(before.v);
    expect(after.total).toBe(before.total);
    expect(await getDoc(PROJECT_ID, 'stock_sessions/SRC_r01')).toBeTruthy();
    await closeApp(desk);
  });

  test('canary — สวิตช์ปิด = เหมือนก่อนแก้: master doc ถูกลบ · R01 ในเครื่องถูกล้าง · Total SKU = 0 · ข้อความ PIN เดิม', async ({ browser }) => {
    const { desk, pda } = await setup(browser, { keepOn: false });
    expect((await localR01(desk.page)).n).toBeGreaterThan(5);
    await resetFromDesk(desk);
    const newEpoch = await desk.page.evaluate(() => _countResetAt);
    expect(await desk.page.evaluate(() => window.__lastPrompt)).toContain('ล้างยอดที่นับ, R01 และ LOT ที่แนบไว้ ของสาขานี้ทั้งหมด');   // ข้อความเดิมของสาขายา
    await waitForDoc(PROJECT_ID, 'stock_sessions/SRC_r01', (d) => !d, { timeout: 15_000 }).catch(() => {});
    expect(await getDoc(PROJECT_ID, 'stock_sessions/SRC_r01'), 'ก่อนแก้ doc ต้องถูกลบ').toBeFalsy();
    expect(await localR01(desk.page)).toMatchObject({ n: 0, v: '', total: 0, badge: 'ยังไม่โหลด' });
    await pda.page.waitForFunction((e) => _countResetAt === e, newEpoch, { timeout: 30_000, polling: 100 });
    expect(await localR01(pda.page)).toMatchObject({ n: 0, v: '', total: 0, badge: 'ยังไม่โหลด' });
    await closeApp(pda); await closeApp(desk);
  });
});

// ===== ★ ปลายทางที่ผู้ใช้เจอจริง: กดเริ่มนับใหม่ระหว่างวัน → คืนนั้นบอท auto-r16 (Python จริง) ต้องไม่ข้ามสาขา =====
// item ตามรูปที่ PDA เขียนจริง (_scanItemPayload) — S-NORM นับ 7 เวลา 11:00 · ระบบ 10 · ขายก่อนสแกน 3 (+ขายหลังสแกน 4 ไม่นับ) → 7+3 = 10 → pass
function seedItem(epoch, sku, count, time) {
  const at = `${DAY.iso} ${time}`;
  return {
    sku, countResetAt: epoch, status: 'scanning', countedQty: count, timestamp: at, firstScanAt: at, scannedBy: 'พนักงานทดสอบ',
    auditor: '', auditStatus: 'pending', barcode: 'B-NORM', location: '', rev: 1, updatedBy: 'พนักงานทดสอบ', updatedAt: new Date(Date.now() - 3600_000),
  };
}
let tranSeq = 1;
const sale = (qty, time) => R.branchRow('SRC', { tranNo: 'ORCMBY0012610' + String(tranSeq++).padStart(5, '0'), colA: '1', qty: `${qty}.0000`, barcode: 'B-NORM', sku: 'S-NORM', at: `${DAY.dmy} ${time}` });
const CSV = () => R.csvText([sale(3, '10:00:00'), sale(4, '15:00:00')]);

test.describe('สาขายา เริ่มนับใหม่ระหว่างวัน × บอท auto-r16 ตอนกลางคืน', () => {
  test.beforeEach(() => requireEmulator());
  test.setTimeout(240_000);

  test('★ สวิตช์เปิด: บอทไม่ถูกข้ามสาขา · timeline ผูก epoch ใหม่ · Desktop โหลดเอง · บอท Confirm ให้ถูก', async ({ browser }) => {
    const { desk, iso } = await setup(browser, { withPda: false });
    await resetFromDesk(desk);                                              // ระหว่างวัน: ผู้ใช้กดเริ่มนับใหม่ (R01 ที่บอทอัปเช้านี้ต้องไม่หาย)
    const epoch = await desk.page.evaluate(() => _countResetAt);
    const masterBefore = await getDoc(PROJECT_ID, 'stock_sessions/SRC_r01');
    expect(masterBefore, 'SRC_r01 ต้องยังอยู่หลังเริ่มนับใหม่').toBeTruthy();
    await adminDb(PROJECT_ID).doc('stock_sessions/SRC/items/S-NORM').set(seedItem(epoch, 'S-NORM', 7, '11:00:00'));   // พนักงานสแกนรอบใหม่หลังกด

    const stateDir = B.newStateDir();
    const r = B.runBotSync({ stateDir, csv: CSV(), args: ['--branch', 'SRC', '--confirm', '--confirm-branch', 'SRC'] });   // คืนนั้น ~21:10
    expect(r.log, 'บอทต้องไม่ข้ามสาขาเพราะไม่มี R01').not.toContain('ไม่มี R01 ของสาขา');
    expect(r.code, r.log).toBe(0);
    expect(r.log).toContain('Confirm SRC confirmed(1)');

    const meta = await getDoc(PROJECT_ID, 'stock_sessions/SRC_r16_104_meta');
    expect(meta, 'บอทต้องเผยแพร่ timeline').toBeTruthy();
    expect(meta.ready).toBe(true);
    expect(meta.countResetAt, 'timeline ต้องผูกรอบนับใหม่ที่เพิ่งกด').toBe(epoch);
    expect(meta.r01Version, 'ผูกกับ R01 ที่คงไว้ (เวอร์ชันเดิม)').toBe(iso);
    const masterAfter = await getDoc(PROJECT_ID, 'stock_sessions/SRC_r01');
    expect(masterAfter.data_json, 'บอทห้ามแตะ data_json').toBe(masterBefore.data_json);
    expect(masterAfter).toMatchObject({ r16Loaded: true, r16DetailVersion: meta.version });

    // ผล Confirm ตามสูตร (ขายก่อนเวลาสแกน 3 ชดเชย · ขายหลังสแกน 4 ไม่นับ)
    const item = await waitForDoc(PROJECT_ID, 'stock_sessions/SRC/items/S-NORM', (d) => d && d.status === 'pass', { timeout: 20_000 });
    expect(item).toMatchObject({ status: 'pass', soldQty: 3, rawCountedQty: 7, updatedBy: 'auto-r16' });
    expect(await getDoc(PROJECT_ID, 'stock_sessions/SRC_confirm_lock'), 'lock ของบอทถูกปล่อย').toBeNull();

    // Desktop ที่เปิดค้าง: listener ของ master เห็นเวอร์ชันใหม่ → โหลด timeline (meta.r01Version ต้องตรง state.r01Version — ตรงเพราะ R01 ไม่ถูกลบ)
    await desk.page.waitForFunction((v) => state.r16Loaded === true && state.r16DetailVersion === v, meta.version, { timeout: 25_000, polling: 100 });
    expect(await desk.page.evaluate(() => document.getElementById('badgeR16').textContent)).toBe('Ready');
    await closeApp(desk);
  });

  test('canary — สวิตช์ปิด = เหมือนก่อนแก้: R01 ถูกลบ → บอท auto-r16 ข้ามสาขา ("ไม่มี R01 ของสาขา") ไม่เผยแพร่ timeline ไม่ Confirm', async ({ browser }) => {
    const { desk } = await setup(browser, { withPda: false, keepOn: false });
    await resetFromDesk(desk);
    const epoch = await desk.page.evaluate(() => _countResetAt);
    await waitForDoc(PROJECT_ID, 'stock_sessions/SRC_r01', (d) => !d, { timeout: 15_000 }).catch(() => {});
    await adminDb(PROJECT_ID).doc('stock_sessions/SRC/items/S-NORM').set(seedItem(epoch, 'S-NORM', 7, '11:00:00'));

    const r = B.runBotSync({ stateDir: B.newStateDir(), csv: CSV(), args: ['--branch', 'SRC', '--confirm', '--confirm-branch', 'SRC'] });
    expect(r.log).toContain('ไม่มี R01 ของสาขา');
    expect(await getDoc(PROJECT_ID, 'stock_sessions/SRC_r16_104_meta'), 'ข้ามสาขา = ไม่มี timeline').toBeNull();
    const item = await getDoc(PROJECT_ID, 'stock_sessions/SRC/items/S-NORM');
    expect(item.status, 'ไม่ Confirm = ยังเป็น scanning (จะถูกรีเซ็ตเช้าวันถัดไป)').toBe('scanning');
    await closeApp(desk);
  });
});
