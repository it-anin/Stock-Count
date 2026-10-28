// WH · "เริ่มนับใหม่" ไม่ล้าง R01 — ใช้ R01 ของบอทต่อ (15 ต.ค. 2026 · ผู้ใช้สั่ง · อนุมัติตามกฎ 1)
// เดิม startNewCount ลบ WH_r01 + ล้าง R01 ในเครื่อง → ต้องอัปมือ (7/10 08:51 เริ่มนับใหม่ → 08:53 อัปมือ → ยอดไม่ตรง ProMaxx)
// ตรึงที่ระดับ logic (ไม่ใช้ emulator): ค่าเริ่มต้นสวิตช์ · helper รับ epoch ใหม่ · toast บอกเวลา R01 · ข้อความช่วยเหลือ
// ส่วน Cloud + สองเครื่องอยู่ที่ tests/specs/e2e/wh-new-count-keeps-r01.spec.js
// ⚠️ 28 ต.ค. 2026: สาขายามีสวิตช์ของตัวเอง (PHARMACY_KEEP_R01_ON_NEW_COUNT · ค่าเริ่มต้นเปิด) — ดู pharmacy-keep-r01-new-count.spec.js
//    กรณี "สาขายา" ในไฟล์นี้จึงตั้งสวิตช์ของสาขายาเป็น false เพื่อตรึง 2 อย่าง: (1) ทางถอยของสาขายา = ล้างเหมือนเดิม (2) สวิตช์ WH เปิดอย่างเดียวไม่ทำให้สาขายาคง R01
const { test, expect, bootBare, closeApp } = require('../../lib/hooks');

const SEED_R01 = [{ colE: 'S-1', productName: 'x', systemQty: 5 }, { colE: 'S-2', productName: 'y', systemQty: 7 }];

async function seedR01(page, branch, version = '2026-10-15T00:31:31.457Z') {
  await page.evaluate(({ b, v, rows }) => {
    currentBranch = b; currentRole = b === 'WH' ? 'supervisor' : 'pharmacist'; currentUser = 'Tester';
    state.r01Data = rows.map((r) => ({ ...r })); state.r01Version = v;
    document.getElementById('badgeR01').textContent = 'Ready';
  }, { b: branch, v: version, rows: SEED_R01 });
}
const snap = (page) => page.evaluate(() => ({
  n: state.r01Data.length, v: state.r01Version, badge: document.getElementById('badgeR01').textContent,
}));

test('ค่าเริ่มต้นที่ส่งมอบ — WH_KEEP_R01_ON_NEW_COUNT เปิด (อ่านจากหน้าที่เพิ่งบูต ไม่ผ่าน seed)', async ({ browser }) => {
  const app = await bootBare(browser);
  expect(await app.page.evaluate(() => typeof WH_KEEP_R01_ON_NEW_COUNT)).toBe('boolean');
  expect(await app.page.evaluate(() => WH_KEEP_R01_ON_NEW_COUNT)).toBe(true);
  await closeApp(app);
});

test('เครื่องที่รับ epoch ใหม่: WH ไม่ล้าง R01 · สวิตช์ปิด/สาขายา(ปิดสวิตช์ของตัวเอง) = ล้างเหมือนเดิม · ล้างตรง (doc ถูกลบจริง) ยังล้างได้', async ({ browser }) => {
  const app = await bootBare(browser);

  await seedR01(app.page, 'WH');
  await app.page.evaluate(() => _resetLocalR01OnNewEpoch());
  expect(await snap(app.page)).toEqual({ n: 2, v: '2026-10-15T00:31:31.457Z', badge: 'Ready' });   // WH คง R01 (ข้อมูล+เวอร์ชัน+badge)

  await app.page.evaluate(() => { WH_KEEP_R01_ON_NEW_COUNT = false; _resetLocalR01OnNewEpoch(); });
  expect(await snap(app.page)).toEqual({ n: 0, v: '', badge: 'ยังไม่โหลด' });                       // สวิตช์ปิด = ก่อนแก้

  await app.page.evaluate(() => { WH_KEEP_R01_ON_NEW_COUNT = true; PHARMACY_KEEP_R01_ON_NEW_COUNT = false; });
  await seedR01(app.page, 'SRC');
  await app.page.evaluate(() => _resetLocalR01OnNewEpoch());
  expect(await snap(app.page)).toEqual({ n: 0, v: '', badge: 'ยังไม่โหลด' });                       // สาขายา + สวิตช์สาขายาปิด = ล้างเหมือนเดิม (สวิตช์ WH เปิดไม่ลามมา)

  await seedR01(app.page, 'WH');                           // ทางล้างตรง: listener doc ถูกลบจริงต้องยังล้างได้ แม้ WH + สวิตช์เปิด
  await app.page.evaluate(() => _resetLocalR01ToEmpty());
  expect(await snap(app.page)).toEqual({ n: 0, v: '', badge: 'ยังไม่โหลด' });
  await closeApp(app);
});

// จุดรับ epoch ใหม่ที่เรียกได้โดยไม่ต้องมี Firestore: _applyCloudSessionMeta (listener v2) · _applyCloudScanData (blob v1 — ไว้ rollback)
// จุดที่เหลือ (_syncSessionMetaToFirestore → e2e · syncToFirestore v1 / restoreFromFirestore → ใช้ helper ตัวเดียวกัน ไม่มีเทสตรงที่จุดเรียก)
test('จุดรับ epoch ใหม่ (_applyCloudSessionMeta · _applyCloudScanData): WH คง R01 · สวิตช์ปิด/สาขายา(ปิดสวิตช์ของตัวเอง)ล้างเหมือนเดิม', async ({ browser }) => {
  const NEWER = '2099-01-01T00:00:00.000Z';
  const app = await bootBare(browser);
  for (const fn of ['_applyCloudSessionMeta', '_applyCloudScanData']) {
    const adopt = async (branch, { keep = true } = {}) => {
      await seedR01(app.page, branch);
      return app.page.evaluate(([fn, newer, keep, role]) => {
        WH_KEEP_R01_ON_NEW_COUNT = keep; PHARMACY_KEEP_R01_ON_NEW_COUNT = false; currentRole = role; _countResetAt = '2026-10-15T01:00:00.000Z';
        window[fn]({ countResetAt: newer, scanData: {} });
        return { epoch: _countResetAt, n: state.r01Data.length, v: state.r01Version, badge: document.getElementById('badgeR01').textContent };
      }, [fn, NEWER, keep, branch === 'WH' ? 'warehouse' : 'pharmacist']);
    };
    expect(await adopt('WH'), `${fn} · WH`).toEqual({ epoch: NEWER, n: 2, v: '2026-10-15T00:31:31.457Z', badge: 'Ready' });
    expect(await adopt('WH', { keep: false }), `${fn} · WH สวิตช์ปิด`).toEqual({ epoch: NEWER, n: 0, v: '', badge: 'ยังไม่โหลด' });
    expect(await adopt('SRC'), `${fn} · SRC`).toEqual({ epoch: NEWER, n: 0, v: '', badge: 'ยังไม่โหลด' });
  }
  await closeApp(app);
});

// จุดที่ต้องมี Firestore: syncToFirestore (blob v1) · restoreFromFirestore (login) — ใช้ Firestore จำลองที่ตอบแค่ session doc ที่ epoch ใหม่กว่า
// restoreMasterFromFirestore ถูกปิดไว้ (ไม่งั้นมันโหลด R01 กลับจาก Cloud ทับ ทำให้แยกไม่ออกว่า "จุดรับ epoch" ล้างหรือไม่)
test('จุดรับ epoch ใหม่ที่ต้องมี Firestore (syncToFirestore v1 · restoreFromFirestore): WH คง R01 · สวิตช์ปิด/สาขายา(ปิดสวิตช์ของตัวเอง)ล้างเหมือนเดิม', async ({ browser }) => {
  const NEWER = '2099-01-01T00:00:00.000Z';
  const app = await bootBare(browser);
  const adopt = async (fn, branch, { keep = true } = {}) => {
    await seedR01(app.page, branch);
    return app.page.evaluate(async ([fn, newer, keep, role]) => {
      restoreMasterFromFirestore = async () => {};
      WH_KEEP_R01_ON_NEW_COUNT = keep; PHARMACY_KEEP_R01_ON_NEW_COUNT = false; currentRole = role; _countResetAt = '2026-10-15T01:00:00.000Z'; _schemaVersion = 1; _adminMode = false;
      state.r05Data = [['B-1', 'S-1']]; state.scanData.clear();
      state.scanData.set('S-1', { countedQty: 0, status: 'pending', retries: 0, timestamp: '', scannedBy: '', auditor: '', auditStatus: 'pending', barcode: '', location: '', scans: [] });
      const session = { exists: true, data: () => ({ session_data_json: JSON.stringify({ countResetAt: newer, scanData: {} }) }) };
      _db = { collection: () => ({ doc: () => ({ get: async () => session, set: async () => {}, update: async () => {} }) }) };
      try { fn === 'sync' ? await syncToFirestore(false) : await restoreFromFirestore(false); } catch (e) { /* ส่วนท้ายของฟังก์ชันต้องการ Firestore เต็ม — ไม่เกี่ยวกับจุดที่ตรวจ */ }
      const out = { epoch: _countResetAt, n: state.r01Data.length, v: state.r01Version, badge: document.getElementById('badgeR01').textContent };
      _db = null; return out;
    }, [fn, NEWER, keep, branch === 'WH' ? 'warehouse' : 'pharmacist']);
  };
  for (const fn of ['sync', 'restore']) {
    expect(await adopt(fn, 'WH'), `${fn} · WH`).toEqual({ epoch: NEWER, n: 2, v: '2026-10-15T00:31:31.457Z', badge: 'Ready' });
    expect(await adopt(fn, 'WH', { keep: false }), `${fn} · WH สวิตช์ปิด`).toEqual({ epoch: NEWER, n: 0, v: '', badge: 'ยังไม่โหลด' });
    expect(await adopt(fn, 'SRC'), `${fn} · SRC`).toEqual({ epoch: NEWER, n: 0, v: '', badge: 'ยังไม่โหลด' });
  }
  await closeApp(app);
});

test('toast หลังเริ่มนับใหม่ — บอกเวลา R01 ของบอท · ไม่ใช่วันนี้ = เตือน · ไม่มี R01 = เตือน · ไม่ล้นหน้าต่างครึ่งจอ', async ({ browser }) => {
  const app = await bootBare(browser);
  const run = (iso) => app.page.evaluate((v) => {
    state.r01Version = v;
    const c = document.getElementById('toastContainer'); c.innerHTML = '';
    _toastWhR01AfterReset();
    const el = c.lastElementChild; el.style.animation = 'none';
    return { text: el.textContent, cls: el.className, w: Math.round(el.getBoundingClientRect().width) };
  }, iso);
  const localIso = (offsetDays, h, m) => app.page.evaluate(([o, h, m]) => {
    const d = new Date(); d.setDate(d.getDate() + o); d.setHours(h, m, 0, 0); return d.toISOString();
  }, [offsetDays, h, m]);

  const today = await run(await localIso(0, 7, 31));
  expect(today.text).toMatch(/^เริ่มนับใหม่แล้ว · R01 ของบอท 07:31 \d{2}\/\d{2}$/);
  expect(today.text).not.toContain('⚠️');

  const stale = await run(await localIso(-1, 7, 31));
  expect(stale.text).toMatch(/^⚠️ เริ่มนับใหม่แล้ว แต่ R01 เป็นของ 07:31 \d{2}\/\d{2} ไม่ใช่วันนี้ — ตรวจบอท$/);
  expect(stale.cls).toContain('warn');

  for (const bad of ['', 'R01-TEST-1', 'garbage 1']) {                   // ไม่ใช่เวลา ISO = ถือว่าไม่มี R01 (ห้ามเชื่อ Date.parse เปล่าๆ)
    const none = await run(bad);
    expect(none.text, JSON.stringify(bad)).toBe('เริ่มนับใหม่แล้ว · ยังไม่มี R01 — รอบอทอัป');
  }
  for (const r of [today, stale]) expect(r.w).toBeLessThanOrEqual(960);   // หน้าต่างครึ่งจอคู่ ProMaxx (toast Desktop ไม่ตัดบรรทัด)
  await closeApp(app);
});

test('ข้อความช่วยเหลือในแอป (guideHtml) — WH บอกว่าบอทอัปให้ · สวิตช์ปิด = ข้อความเดิม · สาขายา(ปิดสวิตช์ของตัวเอง)ไม่เปลี่ยน', async ({ browser }) => {
  const app = await bootBare(browser);
  const on = await app.page.evaluate(() => guideHtml(true));
  expect(on).toContain('บอทอัปให้ทุกเช้า');
  expect(on).toContain('ไม่ล้าง R01');
  expect(on).toContain('อัปเองเฉพาะเมื่อบอทพัง');
  expect(on).not.toContain('อัพครั้งเดียวตอนเริ่มรอบ');

  const off = await app.page.evaluate(() => { WH_KEEP_R01_ON_NEW_COUNT = false; return guideHtml(true); });
  expect(off).toContain('อัพครั้งเดียวตอนเริ่มรอบ');
  expect(off).not.toContain('บอทอัปให้ทุกเช้า');

  const branch = await app.page.evaluate(() => { WH_KEEP_R01_ON_NEW_COUNT = true; PHARMACY_KEEP_R01_ON_NEW_COUNT = false; return guideHtml(false); });
  expect(branch).toContain('ทุกวันก่อน Confirm (หลัง restock)');
  expect(branch).not.toContain('บอทอัปให้ทุกเช้า');
  await closeApp(app);
});
