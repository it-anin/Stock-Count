// สัญญาของ `python auto_r01_import.py --resync-nc` (ก.ย. 2026)
//
// ธง `nc` ถูกตัดสินตอน parse แล้วตรึงลง {branch}_r01.data_json ⇒ แก้กติกาหมวดใน index.html
// อย่างเดียวไม่มีผลกับข้อมูลที่ค้างบน cloud โหมด --resync-nc จึงเขียนธงใหม่ให้ทันที
// โดยแตะ **เฉพาะ field data_json** เพื่อไม่ให้รบกวนรอบนับที่กำลังทำอยู่
//
// เทสนี้ล็อกเหตุผลว่าทำไมถึงกล้า patch กลางรอบนับ:
//   1) เครื่องที่เปิดค้างต้อง "เงียบสนิท" — ไม่ล้าง R16 · ไม่ขยับ _r01BaselineAt · Total SKU ไม่กระโดด
//      (ถ้าวันหลังมีใคร bump r01Version/r01BaselineAt ในสคริปต์ เทสนี้จะจับได้ทันที)
//   2) เครื่องที่เปิดใหม่/reload ต้องได้ธงใหม่ครบ — คือทางเดียวที่ผลจะไปถึงผู้ใช้
const { test, expect, closeApp, requireEmulator } = require('../../lib/hooks');
const { bootFreshCount, bootJoinCount, armR16, PROJECT_ID } = require('../../lib/scenario');
const { adminDb } = require('../../lib/emulator');
const F = require('../../lib/fixtures');

// รูปแบบธงเก่า (ก่อน ก.ย. 2026): หมวด DELETE ถูกติด nc:1 ไปด้วย
const DELETE_SKUS = ['S-DELCAT', 'S-DELCAT0', 'S-DELCATNEG'];
const legacyNcRows = F.r01CloudRows.map((r) => (DELETE_SKUS.includes(r.colE) ? { ...r, nc: 1 } : r));
// ธงเก่าตัด DELETE ที่ยังมียอดออกไป 2 ตัว (S-DELCAT sys 9 · S-DELCATNEG sys -2)
// ส่วน S-DELCAT0 (ยอด 0 ไม่มีใน PBM) ไม่เข้าชุดอยู่แล้วทั้งสองกติกา
const LEGACY_TOTAL = F.COUNTABLE_COUNT - 2;

const writeR01DataJson = (rows) =>
  adminDb(PROJECT_ID).doc('stock_sessions/SRC_r01').set({ data_json: JSON.stringify(rows) }, { merge: true });

// restoreMasterFromFirestore ใช้ .get() ธรรมดา จึงถูกตอบจาก cache ของ client ได้ (ดูโน้ตใน scenario.js)
// วน restore จนกว่าตัวหารจะเป็นค่าที่คาด แทนการ sleep
// ⚠️ ห้ามใช้ page.waitForFunction กับ callback แบบ async — มันคืน Promise ซึ่ง truthy เสมอ
//    แล้วจะผ่านตั้งแต่รอบแรกโดยไม่รอผลจริง (เจอมาแล้วตอนเขียนเทสนี้)
async function restoreUntilTotal(page, expected, attempts = 20) {
  let last;
  for (let i = 0; i < attempts; i++) {
    last = await page.evaluate(async () => {
      await restoreMasterFromFirestore(true);
      rebuildMaps();
      return _cachedTotalSku;
    });
    if (last === expected) return;
  }
  throw new Error(`_cachedTotalSku ไม่ถึง ${expected} หลังลอง restore ${attempts} รอบ (ค่าสุดท้าย ${last})`);
}

test.describe('--resync-nc: patch data_json อย่างเดียว', () => {
  test.beforeEach(() => requireEmulator());
  test.setTimeout(120_000);

  test('เครื่องที่เปิดค้างต้องไม่รู้สึกอะไร · เครื่องที่เปิดใหม่ได้ธงใหม่ครบ', async ({ browser }) => {
    const app = await bootFreshCount(browser, { role: 'pharmacist', user: 'Pharm', mode: 'desktop' });

    // ตั้งต้นให้เหมือน cloud ก่อน resync: DELETE ยังติดธง nc
    await writeR01DataJson(legacyNcRows);
    await restoreUntilTotal(app.page, LEGACY_TOTAL);
    await armR16(app.page);

    const before = await app.page.evaluate(() => ({
      total: _cachedTotalSku,
      baseline: _r01BaselineAt || '',
      r01Version: state.r01Version || '',
      r16Loaded: state.r16Loaded,
      r16Version: state.r16DetailVersion || '',
      delCat: _countableSkus.has('S-DELCAT'),
      delNeg: _countableSkus.has('S-DELCATNEG'),
    }));
    expect(before.total).toBe(LEGACY_TOTAL);
    expect(before.delCat).toBe(false);       // ธงเก่ายังตัดอยู่
    expect(before.delNeg).toBe(false);
    expect(before.r16Loaded).toBe(true);

    // ── สิ่งที่สคริปต์ทำ: เขียนเฉพาะ data_json ไม่แตะ r01Version / r01BaselineAt / r16* ──
    await writeR01DataJson(F.r01CloudRows);

    // เครื่องที่เปิดใหม่ต้องเห็นธงใหม่ — และการ boot นี้เป็น barrier ให้เครื่องแรกมีเวลา
    // ตอบสนอง listener อย่างเหลือเฟือ ถ้ามันจะตอบสนอง (ไม่ใช้ sleep)
    const joined = await bootJoinCount(browser, { role: 'assistant', user: 'PDA', mode: 'pda', expectEpoch: app.epoch });
    const after2 = await joined.page.evaluate(() => ({
      total: _cachedTotalSku,
      delCat: _countableSkus.has('S-DELCAT'),
      delNeg: _countableSkus.has('S-DELCATNEG'),
      delZero: _countableSkus.has('S-DELCAT0'),
      ncLeft: state.r01Data.filter((r) => r.nc).length,
    }));
    expect(after2.total).toBe(F.COUNTABLE_COUNT);
    expect(after2.delCat).toBe(true);        // DELETE ที่มียอด → กลับเข้าชุดที่ต้องนับ
    expect(after2.delNeg).toBe(true);        // ยอดติดลบ (ค้างส่งลูกค้า) ก็ต้องนับ
    expect(after2.delZero).toBe(false);      // ยอด 0 → กติกา G ≠ 0 ตัดออกเอง
    expect(after2.ncLeft).toBe(1);           // เหลือ S-OFFICE (หมวด 11.) ตัวเดียว

    // ── หัวใจของเทส: เครื่องแรกต้องไม่ขยับเลยแม้แต่ค่าเดียว ──
    const after1 = await app.page.evaluate(() => ({
      total: _cachedTotalSku,
      baseline: _r01BaselineAt || '',
      r01Version: state.r01Version || '',
      r16Loaded: state.r16Loaded,
      r16Version: state.r16DetailVersion || '',
    }));
    expect(after1.total).toBe(before.total);              // Total SKU ไม่กระโดดกลางรอบนับ
    expect(after1.baseline).toBe(before.baseline);        // ไม่ trigger _applyR01BaselineUpdate()
    expect(after1.r01Version).toBe(before.r01Version);    // Confirm ที่ค้างอยู่จึงไม่ version mismatch
    expect(after1.r16Loaded).toBe(true);                  // R16 ไม่ถูกล้าง
    expect(after1.r16Version).toBe(before.r16Version);

    // แล้วพอ reload (auto-refresh หลัง deploy) เครื่องแรกก็ได้ธงใหม่เหมือนกัน
    await restoreUntilTotal(app.page, F.COUNTABLE_COUNT);
    const reloaded = await app.page.evaluate(() => ({
      baseline: _r01BaselineAt || '',
      r16Loaded: state.r16Loaded,
      delNeg: _countableSkus.has('S-DELCATNEG'),
    }));
    expect(reloaded.delNeg).toBe(true);
    expect(reloaded.baseline).toBe(before.baseline);      // ยังไม่ขยับอยู่ดี
    expect(reloaded.r16Loaded).toBe(true);

    await closeApp(joined);
    await closeApp(app);
  });
});
