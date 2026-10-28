// สาขายา · "เริ่มนับใหม่" ไม่ล้าง R01 — ใช้ R01 ของบอทต่อ (28 ต.ค. 2026 · ผู้ใช้สั่ง · อนุมัติแผนตามกฎ 1)
// เดิม startNewCount ของ SRC/KKL/SSS ลบ {branch}_r01 + ล้าง R01 ในเครื่อง → Total SKU = 0 และบอท auto-r16 (21:10) ข้ามสาขา ("ไม่มี R01 ของสาขา")
// ⇒ ไม่มี timeline R16 ไม่ Confirm ให้ ของที่สแกนค้างถูกรีเซ็ตเช้าวันถัดไป · แก้ด้วยสวิตช์ PHARMACY_KEEP_R01_ON_NEW_COUNT (แนวเดียวกับ WH_KEEP_R01_ON_NEW_COUNT)
// ตรึงที่ระดับ logic (ไม่ใช้ emulator): ค่าเริ่มต้นสวิตช์ · ตัวตัดสินกลาง (สวิตช์ × สาขา) · 5 จุดรับ epoch ใหม่ · ข้อความ PIN · ข้อความช่วยเหลือ
// ส่วน Cloud + สองเครื่อง + บอทจริง อยู่ที่ tests/specs/e2e/pharmacy-new-count-keeps-r01.spec.js · ฝั่ง WH อยู่ที่ wh-keep-r01-new-count.spec.js
const { test, expect, bootBare, closeApp } = require('../../lib/hooks');

const BRANCHES = ['SRC', 'KKL', 'SSS'];
const VERSION = '2026-10-28T00:31:31.457Z';
const SEED_R01 = [{ colE: 'S-1', productName: 'x', systemQty: 5 }, { colE: 'S-2', productName: 'y', systemQty: 7 }];
const KEPT = { n: 2, v: VERSION, badge: 'Ready' };
const WIPED = { n: 0, v: '', badge: 'ยังไม่โหลด' };

async function seedR01(page, branch) {
  await page.evaluate(({ b, v, rows }) => {
    currentBranch = b; currentRole = b === 'WH' ? 'supervisor' : 'pharmacist'; currentUser = 'Tester';
    state.r01Data = rows.map((r) => ({ ...r })); state.r01Version = v;
    document.getElementById('badgeR01').textContent = 'Ready';
  }, { b: branch, v: VERSION, rows: SEED_R01 });
}
const snap = (page) => page.evaluate(() => ({
  n: state.r01Data.length, v: state.r01Version, badge: document.getElementById('badgeR01').textContent,
}));

test('ค่าเริ่มต้นที่ส่งมอบ — PHARMACY_KEEP_R01_ON_NEW_COUNT เปิด · WH ยังเปิดเหมือนเดิม (อ่านจากหน้าที่เพิ่งบูต ไม่ผ่าน seed)', async ({ browser }) => {
  const app = await bootBare(browser);
  expect(await app.page.evaluate(() => typeof PHARMACY_KEEP_R01_ON_NEW_COUNT)).toBe('boolean');
  expect(await app.page.evaluate(() => PHARMACY_KEEP_R01_ON_NEW_COUNT)).toBe(true);
  expect(await app.page.evaluate(() => WH_KEEP_R01_ON_NEW_COUNT)).toBe(true);
  expect(await app.page.evaluate(() => typeof _keepsR01OnNewCount)).toBe('function');
  await closeApp(app);
});

test('ตัวตัดสินกลาง _keepsR01OnNewCount — สาขายาตามสวิตช์สาขายา · WH ตามสวิตช์ WH · อิสระต่อกัน · ไม่มีสาขา = ไม่คง', async ({ browser }) => {
  const app = await bootBare(browser);
  const decide = (branch, wh, ph) => app.page.evaluate(([b, wh, ph]) => {
    currentBranch = b; WH_KEEP_R01_ON_NEW_COUNT = wh; PHARMACY_KEEP_R01_ON_NEW_COUNT = ph;
    return _keepsR01OnNewCount();
  }, [branch, wh, ph]);
  for (const b of BRANCHES) {
    expect(await decide(b, true, true), `${b} · เปิดทั้งคู่`).toBe(true);
    expect(await decide(b, false, true), `${b} · WH ปิด สาขายาเปิด`).toBe(true);
    expect(await decide(b, true, false), `${b} · เปิดแต่สวิตช์ WH — ต้องไม่ลามมาสาขายา`).toBe(false);
    expect(await decide(b, false, false), `${b} · ปิดทั้งคู่`).toBe(false);
  }
  expect(await decide('WH', true, true)).toBe(true);
  expect(await decide('WH', true, false), 'WH ไม่ขึ้นกับสวิตช์สาขายา').toBe(true);
  expect(await decide('WH', false, true), 'เปิดแต่สวิตช์สาขายา — ต้องไม่ทำให้ WH คง R01').toBe(false);
  expect(await decide('WH', false, false)).toBe(false);
  for (const b of ['', 'XXX']) expect(await decide(b, true, true), `สาขา ${JSON.stringify(b)}`).toBe(false);   // ยังไม่เลือกสาขา/สาขาแปลก = พฤติกรรมเดิม (ล้าง)
  await closeApp(app);
});

test('เครื่องที่รับ epoch ใหม่ (_resetLocalR01OnNewEpoch): สาขายาคง R01 ทั้ง 3 สาขา · ปิดสวิตช์ = ล้างเหมือนเดิม · ล้างตรง (doc ถูกลบจริง) ยังล้างได้', async ({ browser }) => {
  const app = await bootBare(browser);
  for (const b of BRANCHES) {
    await seedR01(app.page, b);
    await app.page.evaluate(() => { WH_KEEP_R01_ON_NEW_COUNT = true; PHARMACY_KEEP_R01_ON_NEW_COUNT = true; _resetLocalR01OnNewEpoch(); });
    expect(await snap(app.page), `${b} · คง R01 (ข้อมูล+เวอร์ชัน+badge)`).toEqual(KEPT);

    await app.page.evaluate(() => { PHARMACY_KEEP_R01_ON_NEW_COUNT = false; _resetLocalR01OnNewEpoch(); });
    expect(await snap(app.page), `${b} · สวิตช์สาขายาปิด = ก่อนแก้`).toEqual(WIPED);

    await seedR01(app.page, b);                              // ทางล้างตรง: doc R01 ถูกลบจริง (เช่น Admin ล้างข้อมูล) ต้องล้างได้เสมอ แม้สวิตช์เปิด
    await app.page.evaluate(() => { PHARMACY_KEEP_R01_ON_NEW_COUNT = true; _resetLocalR01ToEmpty(); });
    expect(await snap(app.page), `${b} · ล้างตรง`).toEqual(WIPED);
  }
  await closeApp(app);
});

// จุดรับ epoch ใหม่ที่เรียกได้โดยไม่ต้องมี Firestore: _applyCloudSessionMeta (listener v2) · _applyCloudScanData (blob v1 — ไว้ rollback)
// จุดที่เหลือ (_syncSessionMetaToFirestore → e2e · syncToFirestore v1 / restoreFromFirestore → เทสถัดไปด้วย Firestore จำลอง)
test('จุดรับ epoch ใหม่ (_applyCloudSessionMeta · _applyCloudScanData): สาขายาคง R01 · ปิดสวิตช์สาขายา/เปิดแต่สวิตช์ WH = ล้างเหมือนเดิม', async ({ browser }) => {
  const NEWER = '2099-01-01T00:00:00.000Z';
  const app = await bootBare(browser);
  for (const fn of ['_applyCloudSessionMeta', '_applyCloudScanData']) {
    for (const b of BRANCHES) {
      const adopt = async ({ wh = true, ph = true } = {}) => {
        await seedR01(app.page, b);
        return app.page.evaluate(([fn, newer, wh, ph]) => {
          WH_KEEP_R01_ON_NEW_COUNT = wh; PHARMACY_KEEP_R01_ON_NEW_COUNT = ph; currentRole = 'pharmacist'; _countResetAt = '2026-10-28T01:00:00.000Z';
          window[fn]({ countResetAt: newer, scanData: {} });
          return { epoch: _countResetAt, n: state.r01Data.length, v: state.r01Version, badge: document.getElementById('badgeR01').textContent };
        }, [fn, NEWER, wh, ph]);
      };
      expect(await adopt(), `${fn} · ${b}`).toEqual({ epoch: NEWER, ...KEPT });
      expect(await adopt({ ph: false }), `${fn} · ${b} · สวิตช์สาขายาปิด`).toEqual({ epoch: NEWER, ...WIPED });
      expect(await adopt({ wh: true, ph: false }), `${fn} · ${b} · เปิดแต่สวิตช์ WH`).toEqual({ epoch: NEWER, ...WIPED });
    }
  }
  await closeApp(app);
});

// จุดที่ต้องมี Firestore: syncToFirestore (blob v1) · restoreFromFirestore (login) — ใช้ Firestore จำลองที่ตอบแค่ session doc ที่ epoch ใหม่กว่า
// restoreMasterFromFirestore ถูกปิดไว้ (ไม่งั้นมันโหลด R01 กลับจาก Cloud ทับ ทำให้แยกไม่ออกว่า "จุดรับ epoch" ล้างหรือไม่)
test('จุดรับ epoch ใหม่ที่ต้องมี Firestore (syncToFirestore v1 · restoreFromFirestore): สาขายาคง R01 · ปิดสวิตช์สาขายา = ล้างเหมือนเดิม', async ({ browser }) => {
  const NEWER = '2099-01-01T00:00:00.000Z';
  const app = await bootBare(browser);
  const adopt = async (fn, branch, ph) => {
    await seedR01(app.page, branch);
    return app.page.evaluate(async ([fn, newer, ph]) => {
      restoreMasterFromFirestore = async () => {};
      WH_KEEP_R01_ON_NEW_COUNT = true; PHARMACY_KEEP_R01_ON_NEW_COUNT = ph; currentRole = 'pharmacist'; _countResetAt = '2026-10-28T01:00:00.000Z'; _schemaVersion = 1; _adminMode = false;
      state.r05Data = [['B-1', 'S-1']]; state.scanData.clear();
      state.scanData.set('S-1', { countedQty: 0, status: 'pending', retries: 0, timestamp: '', scannedBy: '', auditor: '', auditStatus: 'pending', barcode: '', location: '', scans: [] });
      const session = { exists: true, data: () => ({ session_data_json: JSON.stringify({ countResetAt: newer, scanData: {} }) }) };
      _db = { collection: () => ({ doc: () => ({ get: async () => session, set: async () => {}, update: async () => {} }) }) };
      try { fn === 'sync' ? await syncToFirestore(false) : await restoreFromFirestore(false); } catch (e) { /* ส่วนท้ายของฟังก์ชันต้องการ Firestore เต็ม — ไม่เกี่ยวกับจุดที่ตรวจ */ }
      const out = { epoch: _countResetAt, n: state.r01Data.length, v: state.r01Version, badge: document.getElementById('badgeR01').textContent };
      _db = null; return out;
    }, [fn, NEWER, ph]);
  };
  for (const fn of ['sync', 'restore']) {
    for (const b of BRANCHES) {
      expect(await adopt(fn, b, true), `${fn} · ${b}`).toEqual({ epoch: NEWER, ...KEPT });
      expect(await adopt(fn, b, false), `${fn} · ${b} · สวิตช์สาขายาปิด`).toEqual({ epoch: NEWER, ...WIPED });
    }
  }
  await closeApp(app);
});

// startNewCount ถามรหัส PIN ก่อนทำอะไรทั้งนั้น — ตอบ null (ยกเลิก) แล้วฟังก์ชันคืนทันที จึงอ่านข้อความที่ถามได้โดยไม่แตะ Firestore
test('ข้อความ PIN ของ "เริ่มนับใหม่" — สาขายา/WH ที่คง R01 บอกว่า "R01 ใช้ของบอทต่อ ไม่ล้าง" ตรงตามสาขา · ปิดสวิตช์ = ข้อความเดิม', async ({ browser }) => {
  const app = await bootBare(browser);
  const ask = (branch, wh, ph) => app.page.evaluate(async ([b, wh, ph]) => {
    currentBranch = b; WH_KEEP_R01_ON_NEW_COUNT = wh; PHARMACY_KEEP_R01_ON_NEW_COUNT = ph;
    let msg = ''; const orig = window.prompt; window.prompt = (m) => { msg = String(m); return null; };
    try { await startNewCount(); } finally { window.prompt = orig; }
    return msg;
  }, [branch, wh, ph]);
  for (const b of BRANCHES) {
    const on = await ask(b, true, true);
    expect(on, `${b} · คง R01`).toContain('ล้างยอดที่นับ, R16 และ LOT ที่แนบไว้ ของสาขานี้ (R01 ใช้ของบอทต่อ ไม่ล้าง)');
    expect(on).not.toContain('ของคลังนี้');
    expect(on, 'ห้ามบอกว่าล้าง R01 ทั้งที่ไม่ได้ล้าง').not.toContain('R01 และ LOT');
    const off = await ask(b, true, false);
    expect(off, `${b} · สวิตช์สาขายาปิด`).toContain('ล้างยอดที่นับ, R01 และ LOT ที่แนบไว้ ของสาขานี้ทั้งหมด');
    expect(off).not.toContain('ใช้ของบอทต่อ');
  }
  expect(await ask('WH', true, false), 'WH เท่าเดิมทุกตัวอักษร').toContain('ล้างยอดที่นับ, R16 และ LOT ที่แนบไว้ ของคลังนี้ (R01 ใช้ของบอทต่อ ไม่ล้าง)');
  expect(await ask('WH', false, true), 'WH สวิตช์ปิด (เปิดแต่สวิตช์สาขายา) = ข้อความเดิม').toContain('ล้างยอดที่นับ, R01 และ LOT ที่แนบไว้ ของสาขานี้ทั้งหมด');
  await closeApp(app);
});

test('ข้อความช่วยเหลือในแอป (guideHtml) — สาขายาที่คง R01 บอกว่าบอทอัปให้ · ปิดสวิตช์สาขายา = ข้อความเดิม · อิสระจาก WH', async ({ browser }) => {
  const app = await bootBare(browser);
  const guide = (isWh, wh, ph) => app.page.evaluate(([isWh, wh, ph]) => {
    WH_KEEP_R01_ON_NEW_COUNT = wh; PHARMACY_KEEP_R01_ON_NEW_COUNT = ph; return guideHtml(isWh);
  }, [isWh, wh, ph]);

  const on = await guide(false, true, true);
  expect(on).toContain('บอทอัปให้ทุกเช้า ไม่ต้องอัปเอง');                 // ขั้นตอนข้อ 1
  expect(on).toContain('กด "เริ่มนับใหม่" ไม่ล้าง R01');
  expect(on).toContain('อัปเองเฉพาะเมื่อบอทพัง');                         // หัวข้อ "1. R01.102"
  expect(on).not.toContain('ทุกวันก่อน Confirm (หลัง restock)');
  expect(on).not.toContain('อัพทุกเช้าก่อนเริ่มนับ');

  const off = await guide(false, true, false);                           // เปิดแต่สวิตช์ WH ต้องไม่ลามมาสาขายา
  expect(off).toContain('ทุกวันก่อน Confirm (หลัง restock)');
  expect(off).toContain('อัพทุกเช้าก่อนเริ่มนับ');
  expect(off).not.toContain('บอทอัปให้ทุกเช้า');
  expect(off).not.toContain('อัปเองเฉพาะเมื่อบอทพัง');

  const whOn = await guide(true, true, false);                           // WH ตามสวิตช์ WH เท่านั้น
  expect(whOn).toContain('บอทอัปให้ทุกเช้า ไม่ต้องอัปเอง');
  expect(whOn).toContain('อัปเองเฉพาะเมื่อบอทพัง');
  const whOff = await guide(true, false, true);                          // เปิดแต่สวิตช์สาขายาต้องไม่ลามไป WH
  expect(whOff).toContain('อัพครั้งเดียวตอนเริ่มรอบ');
  expect(whOff).not.toContain('บอทอัปให้ทุกเช้า');
  await closeApp(app);
});
