// _applyR01BaselineUpdate ต้อง apply ทุกรอบเหมือนเดิม แต่ toast แค่ครั้งเดียวต่อการโหลดหนึ่งครั้ง
//
// เคสจริง ก.ย. 2026: toast "R01 ใหม่จากเครื่องอื่น" เด้ง 2 รอบตอนเปิดหน้า
// สาเหตุ: session doc เก็บ "สำเนา" r01BaselineAt ที่ค้างเก่ากว่า master doc {branch}_r01
//   local เริ่มที่ ''  →  session ป้อน 2026-08-21 (ผ่าน guard เพราะ > '')      → toast 1
//                      →  master ป้อน 2026-09-07 (ผ่าน guard เพราะ > 08-21)  → toast 2
// ทั้งสองรอบถูกต้องตามตรรกะ — ที่ไม่ควรซ้ำคือข้อความที่ผู้ใช้เห็น
//
// invariant ที่ตรึงไว้: debounce แตะ **เฉพาะ toast**
//   `_r01BaselineAt` ต้องขยับทุกรอบ · `_clearR16ForNewBaseline()` ต้องทำงานทุกรอบ · guard เดิมต้องยังกันค่าเก่า
const { test, expect, bootBare, closeApp } = require('../../lib/hooks');

const OLD = '2026-08-21T07:54:39.276Z';   // ค่าค้างใน session doc
const NEW = '2026-09-07T02:36:39.087Z';   // ค่าจริงจาก master (บอท)

// เรียกฟังก์ชันจริงบนหน้าเว็บ · ส่ง docData เข้าไปเพื่อไม่ให้แตะ network (deterministic + เร็ว)
async function run(page, steps) {
  return page.evaluate(({ steps }) => {
    const toasts = [];
    const realToast = window.toast;
    const realBranch = currentBranch;
    const realBaseline = _r01BaselineAt;
    const realLast = _lastR01BaselineToastAt;
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
        _r01BaselineAt = realBaseline; _lastR01BaselineToastAt = realLast;
      });
  }, { steps });
}

test('session เก่า → master ใหม่ ติดกัน: apply ทั้งสองรอบ แต่ toast ครั้งเดียว', async ({ browser }) => {
  const app = await bootBare(browser);
  const { toasts, out } = await run(app.page, [{ at: OLD }, { at: NEW }]);

  expect(out.map((o) => o.returned)).toEqual([1, 1]);        // apply จริงทั้งสองรอบ
  expect(out[1].baseline).toBe(NEW);                          // ยึดค่าใหม่สุด
  expect(toasts).toHaveLength(1);                             // ★ แต่เห็นข้อความเดียว
  expect(toasts[0]).toContain('R01 ใหม่จากเครื่องอื่น');

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
