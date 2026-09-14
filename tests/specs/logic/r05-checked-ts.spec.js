// การ์ด R05.106 มี 2 เวลาที่ความหมายต่างกัน (ก.ย. 2026)
//
// เคสจริงที่ทำให้ต้องมี: `updated_at` ค้างที่ 11 ก.ย. อยู่ 3 วัน แล้วไม่มีใครรู้ว่า
// "บอทไม่ได้รัน" หรือ "ตารางบาร์โค้ดไม่เปลี่ยนจริง ๆ" — ต้องไล่ถึงขั้นเปิด log บนเครื่องที่รันจริง
//   อัปโหลดล่าสุด = global_r05.updated_at         → ค้างหลายวันได้ตามปกติ
//   ตรวจล่าสุด   = global_r05_status.checked_at  → บอทเขียนทุกรอบที่ตรวจสำเร็จ ต้องเป็นวันนี้
//
// invariant ที่ตรึงไว้:
//   · ไม่ใช่วันนี้ต้องมีคำเตือน · วันนี้ต้องไม่มี
//   · ล้างเวลาอัปโหลด (selectBranch/clearAllData) ต้องล้างเวลาตรวจไปด้วย ไม่งั้นการ์ดค้างข้ามสาขา
const { test, expect, bootBare, closeApp } = require('../../lib/hooks');

const read = (page) => page.evaluate(() => {
  const el = document.getElementById('r05Timestamp');
  return { text: el.textContent, hidden: el.style.display === 'none' };
});

test('การ์ด R05.106 แยก "อัปโหลดล่าสุด" กับ "ตรวจล่าสุด" และเตือนเมื่อบอทไม่ได้ตรวจวันนี้', async ({ browser }) => {
  const app = await bootBare(browser);

  // มีแต่เวลาอัปโหลด (ยังไม่มี doc สถานะ) → ข้อความเดิมเป๊ะ ไม่มีอะไรงอกมา
  await app.page.evaluate(() => { _setR05Ts('08:05 น. 11/09/2026'); _setR05CheckedTs(''); });
  expect((await read(app.page)).text).toBe('อัปโหลดล่าสุด: 08:05 น. 11/09/2026');

  // บอทตรวจวันนี้ → ต่อท้าย "ตรวจล่าสุด" และต้องไม่มีคำเตือน
  const today = await app.page.evaluate(() => {
    _setR05CheckedTs(formatThaiDateTime(new Date()));
    return document.getElementById('r05Timestamp').textContent;
  });
  expect(today).toContain('อัปโหลดล่าสุด: 08:05 น. 11/09/2026');
  expect(today).toContain('ตรวจล่าสุด: ');
  expect(today).not.toContain('บอทยังไม่ได้ตรวจวันนี้');

  // ★ บอทไม่ได้ตรวจวันนี้ → ต้องเตือน (นี่คือสัญญาณที่เคยไม่มี)
  await app.page.evaluate(() => _setR05CheckedTs('08:05 น. 11/09/2026'));
  expect((await read(app.page)).text).toContain('⚠️ บอทยังไม่ได้ตรวจวันนี้');

  // ★ ล้างเวลาอัปโหลด = ล้างทั้งการ์ด (สลับสาขา / ล้างข้อมูล)
  await app.page.evaluate(() => _setR05Ts(''));
  expect(await read(app.page)).toEqual({ text: '', hidden: true });
  await app.page.evaluate(() => _setR05Ts('09:00 น. 14/09/2026'));
  expect((await read(app.page)).text).toBe('อัปโหลดล่าสุด: 09:00 น. 14/09/2026');   // เวลาตรวจเก่าไม่ค้างกลับมา

  await closeApp(app);
});

test('อ่าน doc สถานะไม่ได้ ต้องไม่ทำให้การ์ดพัง', async ({ browser }) => {
  const app = await bootBare(browser);
  // logic project ต่อ Firestore พอร์ตที่ตาย — refreshR05CheckedTs ต้องกลืน error เงียบ ๆ
  await app.page.evaluate(() => { _setR05Ts('08:05 น. 11/09/2026'); return refreshR05CheckedTs(); });
  expect((await read(app.page)).text).toContain('อัปโหลดล่าสุด: 08:05 น. 11/09/2026');
  await closeApp(app);
});
