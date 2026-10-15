// _applyR01BaselineUpdate ต้อง apply ทุกรอบเหมือนเดิม แต่ toast แค่ครั้งเดียวต่อการโหลดหนึ่งครั้ง
//
// เคสจริง ก.ย. 2026: toast ตอน R01 เปลี่ยน (ปัจจุบันข้อความคือ "กำลังโหลดข้อมูล..") เด้ง 2 รอบตอนเปิดหน้า
// สาเหตุ: session doc เก็บ "สำเนา" r01BaselineAt ที่ค้างเก่ากว่า master doc {branch}_r01
//   local เริ่มที่ ''  →  session ป้อน 2026-08-21 (ผ่าน guard เพราะ > '')      → toast 1
//                      →  master ป้อน 2026-09-07 (ผ่าน guard เพราะ > 08-21)  → toast 2
// ทั้งสองรอบถูกต้องตามตรรกะ — ที่ไม่ควรซ้ำคือข้อความที่ผู้ใช้เห็น
//
// invariant ที่ตรึงไว้: debounce แตะ **เฉพาะ toast**
//   `_r01BaselineAt` ต้องขยับทุกรอบ · `_clearR16ForNewBaseline()` ต้องทำงานทุกรอบ · guard เดิมต้องยังกันค่าเก่า
//
// 15 ต.ค. 2026 (ผู้ใช้สั่ง): ปิด toast นี้ทั้งหมด — แทรกขึ้นมาตอนล็อกอินที่มี Skeleton แจ้งสถานะอยู่แล้ว · สวิตช์ R01_BASELINE_TOAST (ค่าเริ่มต้น false)
//   เทส debounce เดิม 3 ข้อเปิดสวิตช์เองเพื่อตรึงตรรกะไว้ (ทางถอย = ตั้ง true) · ข้อสุดท้ายตรึง "ค่าที่ส่งมอบ: ไม่มี toast แต่ baseline/R16 ทำงานครบ"
const { test, expect, bootBare, closeApp } = require('../../lib/hooks');

const OLD = '2026-08-21T07:54:39.276Z';   // ค่าค้างใน session doc
const NEW = '2026-09-07T02:36:39.087Z';   // ค่าจริงจาก master (บอท)

// เรียกฟังก์ชันจริงบนหน้าเว็บ · ส่ง docData เข้าไปเพื่อไม่ให้แตะ network (deterministic + เร็ว)
// toastOn: true = เปิดสวิตช์ R01_BASELINE_TOAST เพื่อตรึงตรรกะ debounce · false = ใช้ค่าที่ส่งมอบ (ไม่แตะสวิตช์)
async function run(page, steps, { toastOn = true } = {}) {
  return page.evaluate(({ steps, toastOn }) => {
    const toasts = [];
    const realToast = window.toast;
    const realBranch = currentBranch;
    const realBaseline = _r01BaselineAt;
    const realLast = _lastR01BaselineToastAt;
    const realSwitch = R01_BASELINE_TOAST;
    if (toastOn) R01_BASELINE_TOAST = true;
    window.toast = (m) => { toasts.push(String(m)); };
    currentBranch = 'SRC';                 // ต้องเป็นสาขายา ไม่งั้นติด guard แรก
    _r01BaselineAt = '';
    _lastR01BaselineToastAt = 0;
    const out = [];
    return steps.reduce(
      (p, s) => p.then(async () => {
        if (s.resetToastClock) _lastR01BaselineToastAt = 0;
        // เติม R16 ปลอมก่อนทุกรอบ เพื่อดูว่า _clearR16ForNewBaseline ถูกเรียกจริงไหม
        state.r16Loaded = true;
        state.r16SalesMap.set('S1', 5);
        const rc = await _applyR01BaselineUpdate(s.at, { data_json: '[]', r01Version: s.at });
        out.push({
          returned: rc,
          baseline: _r01BaselineAt,
          r16Cleared: state.r16Loaded === false && state.r16SalesMap.size === 0,
        });
      }),
      Promise.resolve(),
    ).then(() => ({ toasts, out }))
      .finally(() => {
        window.toast = realToast; currentBranch = realBranch;
        _r01BaselineAt = realBaseline; _lastR01BaselineToastAt = realLast; R01_BASELINE_TOAST = realSwitch;
      });
  }, { steps, toastOn });
}

test('session เก่า → master ใหม่ ติดกัน: apply ทั้งสองรอบ แต่ toast ครั้งเดียว', async ({ browser }) => {
  const app = await bootBare(browser);
  const { toasts, out } = await run(app.page, [{ at: OLD }, { at: NEW }]);

  expect(out.map((o) => o.returned)).toEqual([1, 1]);        // apply จริงทั้งสองรอบ
  expect(out[1].baseline).toBe(NEW);                          // ยึดค่าใหม่สุด
  expect(toasts).toHaveLength(1);                             // ★ แต่เห็นข้อความเดียว
  expect(toasts[0]).toBe('กำลังโหลดข้อมูล..');

  await closeApp(app);
});

test('debounce แตะเฉพาะ toast — R16 ต้องถูกล้างทุกรอบ', async ({ browser }) => {
  const app = await bootBare(browser);
  const { out } = await run(app.page, [{ at: OLD }, { at: NEW }]);

  // ถ้าใครเผลอเอา debounce ไปกั้น _clearR16ForNewBaseline รอบที่สองจะเป็น false
  expect(out.map((o) => o.r16Cleared)).toEqual([true, true]);

  await closeApp(app);
});

test('guard เดิมยังกันค่าที่เก่ากว่า และ toast กลับมาเมื่อพ้นช่วง debounce', async ({ browser }) => {
  const app = await bootBare(browser);

  // ค่าเก่ากว่าค่าปัจจุบัน → return 0 · ไม่ toast · baseline ไม่ขยับ
  const back = await run(app.page, [{ at: NEW }, { at: OLD }]);
  expect(back.out[1].returned).toBe(0);
  expect(back.out[1].baseline).toBe(NEW);
  expect(back.toasts).toHaveLength(1);

  // พ้นช่วง debounce แล้วต้อง toast อีกครั้ง — ไม่ใช่ปิดถาวร
  const later = await run(app.page, [{ at: OLD }, { at: NEW, resetToastClock: true }]);
  expect(later.toasts).toHaveLength(2);

  await closeApp(app);
});

test('★ ค่าที่ส่งมอบ: สวิตช์ปิด → ไม่มี toast เลย แต่ baseline ขยับ + R16 ถูกล้าง + badge ทุกรอบเหมือนเดิม', async ({ browser }) => {
  const app = await bootBare(browser);
  expect(await app.page.evaluate(() => R01_BASELINE_TOAST)).toBe(false);   // ค่าที่ส่งมอบ — อ่านจากหน้าที่เพิ่งบูต ไม่ใช่ค่าที่เทสตั้งเอง

  const r = await run(app.page, [{ at: OLD }, { at: NEW, resetToastClock: true }], { toastOn: false });
  expect(r.toasts).toEqual([]);                                           // ★ ไม่มีข้อความ "กำลังโหลดข้อมูล.." แทรกมา
  expect(r.out.map((o) => o.returned)).toEqual([1, 1]);                   // แต่ apply จริงทั้งสองรอบ
  expect(r.out[1].baseline).toBe(NEW);
  expect(r.out.map((o) => o.r16Cleared)).toEqual([true, true]);           // R16 ล้างทุกรอบ → Confirm ล็อกเหมือนเดิม (ไม่พึ่ง toast)

  await closeApp(app);
});
