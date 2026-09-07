// syncMasterToFirestore ต้องรายงานทุกไฟล์ที่เขียน cloud ไม่ผ่าน — ห้ามล้มเงียบ
//
// เคสจริง ก.ย. 2026: `KKL_r01` ไม่มีอยู่บน cloud เลยทั้งรอบนับ (1,049 SKU) โดยไม่มีใครรู้
// ต้นเหตุ: เดิมเป็น Promise.all + catch ก้อนเดียว แล้ว toast เฉพาะ `if(includeR05)`
// ⇒ R01 ล้มแล้วเหลือแค่ console.warn · เครื่องที่อัปยังมีข้อมูลใน localStorage จึงนับต่อได้
//    ทั้งรอบโดยไม่มีอาการ แต่เครื่องอื่นและ auto-r01 ไม่เห็นเลย
//
// invariant ที่ตรึงไว้: ล้มตัวไหน → เตือนตัวนั้น · ล้มทั้งคู่ → เตือนทั้งคู่ · สำเร็จ → เงียบ
const { test, expect, bootBare, closeApp } = require('../../lib/hooks');

// แทนที่ _db/getR05Ref/toast ด้วยของปลอม แล้วเรียกฟังก์ชันจริงบนหน้าเว็บ
// bootBare ไม่ login ⇒ ต้องตั้ง currentBranch เอง ไม่งั้นติด guard `if(!_db||!currentBranch)return;`
async function run(page, { r01Fail = false, r05Fail = false, includeR05, includeR01 }) {
  return page.evaluate(({ r01Fail, r05Fail, includeR05, includeR01 }) => {
    const toasts = [];
    const realToast = window.toast;
    const realGetR05Ref = window.getR05Ref;
    const realDb = _db;
    const realBranch = currentBranch;
    currentBranch = 'KKL';
    window.toast = (m, type) => { toasts.push({ m: String(m), type }); };
    _db = { collection: () => ({ doc: () => ({ set: () => (r01Fail ? Promise.reject(new Error('R01 BOOM')) : Promise.resolve()) }) }) };
    window.getR05Ref = () => ({ set: () => (r05Fail ? Promise.reject(new Error('R05 BOOM')) : Promise.resolve()) });
    return syncMasterToFirestore(includeR05, includeR01)
      .then(() => toasts)
      .finally(() => { window.toast = realToast; window.getR05Ref = realGetR05Ref; _db = realDb; currentBranch = realBranch; });
  }, { r01Fail, r05Fail, includeR05, includeR01 });
}

test('R01 เขียน cloud ไม่ผ่าน → ต้อง toast error ไม่ใช่ล้มเงียบ', async ({ browser }) => {
  const app = await bootBare(browser);

  // เส้นทางเดียวกับ loadR01(): syncMasterToFirestore(false, true)
  const t = await run(app.page, { r01Fail: true, includeR05: false, includeR01: true });
  expect(t).toHaveLength(1);
  expect(t[0].type).toBe('error');
  expect(t[0].m).toContain('R01.102');     // ต้องบอกว่าไฟล์ไหนล้ม
  expect(t[0].m).toContain('R01 BOOM');    // และแนบสาเหตุจริงไปด้วย

  await closeApp(app);
});

test('R05 ยังเตือนเหมือนเดิม — พฤติกรรมเดิมห้ามหาย', async ({ browser }) => {
  const app = await bootBare(browser);

  // เส้นทางเดียวกับ loadR05(): syncMasterToFirestore(true, false)
  const t = await run(app.page, { r05Fail: true, includeR05: true, includeR01: false });
  expect(t).toHaveLength(1);
  expect(t[0].type).toBe('error');
  expect(t[0].m).toContain('R05.106');

  await closeApp(app);
});

test('สำเร็จ → เงียบ · ล้มทั้งคู่ → เตือนทั้งคู่ · ล้มตัวเดียว → ไม่เตือนผิดตัว', async ({ browser }) => {
  const app = await bootBare(browser);

  expect(await run(app.page, { includeR05: true, includeR01: true })).toEqual([]);

  // Promise.all + catch เดิมทำเคสนี้ไม่ได้ — เห็น error ตัวแรกตัวเดียว
  const both = await run(app.page, { r01Fail: true, r05Fail: true, includeR05: true, includeR01: true });
  expect(both).toHaveLength(2);
  expect(both.map((x) => x.m).join(' ')).toContain('R01.102');
  expect(both.map((x) => x.m).join(' ')).toContain('R05.106');

  // R01 ล้มแต่ R05 ผ่าน → ต้องระบุถูกตัว ไม่กล่าวหา R05
  const one = await run(app.page, { r01Fail: true, includeR05: true, includeR01: true });
  expect(one).toHaveLength(1);
  expect(one[0].m).toContain('R01.102');
  expect(one[0].m).not.toContain('R05');

  await closeApp(app);
});
