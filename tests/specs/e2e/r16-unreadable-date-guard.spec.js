// ด่านวันที่ R16 อ่านไม่ออก — เส้นทางจริงของพนักงานสาขาเมื่อบอทล้ม (14 ต.ค. 2026 · R16_UNREADABLE_DATE_GUARD)
//
// พนักงานอัป R16.104 ด้วยมือเอง: ไฟล์ที่ได้มาเป็น dd-Mon-yy (เช่นจากเครื่อง BIGYAMAINPC) → ต้องถูกปฏิเสธ ไม่ใช่โหลดเงียบๆ แล้ว Confirm ผิด
// → export ใหม่ให้เป็น dd/mm/yyyy แล้วอัปอีกครั้ง → Confirm ตัดสินถูก
//   ★ เคสธุรกิจ (เหมือน pharmacy-r16-cloud-timeline): ระบบ 10 · ขายก่อนสแกน 3 (ชั้นเหลือ 7 → นับ 7) · ขายหลังสแกน 4 → ต้อง pass (7+3=10)
//     ถ้าไฟล์ dd-Mon-yy หลุดเข้าไป: ชดเชย 0 → 7 ≠ 10 → Stock Adj ปลอมลง ERP (นี่คือสิ่งที่ด่านกัน)
const { test, expect, closeApp, requireEmulator } = require('../../lib/hooks');
const { bootFreshCount, bootJoinCount, PROJECT_ID } = require('../../lib/scenario');
const { waitForDoc } = require('../../lib/emulator');
const F = require('../../lib/r16-104-fixture');

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// เวลาตามนาฬิกาของหน้าเว็บ (ตัวเดียวกับที่ Confirm เทียบ) ในสองรูปแบบ: 'mon' = 14-Oct-26 09:17:17 · 'ok' = 14/10/2026 09:17:17
const stamp = (page, offsetMs, fmt) => page.evaluate(({ o, fmt, MON }) => {
  const d = new Date(Date.now() + o); const p = (n) => String(n).padStart(2, '0');
  const hms = `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  return fmt === 'mon' ? `${p(d.getDate())}-${MON[d.getMonth()]}-${String(d.getFullYear()).slice(2)} ${hms}` : `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()} ${hms}`;
}, { o: offsetMs, fmt, MON });

const scanTimes = (page, barcode, times) => page.evaluate(({ barcode, times }) => {
  for (let i = 0; i < times; i++) scanQueue.push(parseScanLine(barcode));
  drainQueue();
}, { barcode, times });

// ระบบ 10 (S-NORM) · PDA สแกน 7 ชิ้นตอนนี้ แล้วดันขึ้น Cloud
async function pdaScansSeven(pda) {
  await scanTimes(pda.page, 'B-NORM', 7);
  await pda.page.waitForFunction(() => state.scanData.get('S-NORM')?.countedQty === 7, null, { polling: 100 });
  await pda.page.evaluate(() => _flushDirtySkus());
  await waitForDoc(PROJECT_ID, 'stock_sessions/SRC/items/S-NORM', (d) => d && d.countedQty === 7);
}

const rowsFor = (before, after) => [
  F.branchRow('SRC', { tranNo: 'ORCMBY001261000001', qty: '3.0000', barcode: 'B-NORM', sku: 'S-NORM', at: before }),
  F.branchRow('SRC', { tranNo: 'ORCMBY001261000002', qty: '4.0000', barcode: 'B-NORM', sku: 'S-NORM', at: after }),
];
const upload = (page, rows, name) => page.setInputFiles('#fileR16', { name, mimeType: 'text/csv', buffer: Buffer.from(F.csvText(rows), 'utf8') });

test.describe('ด่านวันที่ R16 อ่านไม่ออก — พนักงานอัปมือเองเมื่อบอทล้ม', () => {
  test.beforeEach(() => requireEmulator());
  test.setTimeout(120_000);

  test('★ ไฟล์ dd-Mon-yy ถูกปฏิเสธ (Confirm ยังล็อก ไม่มีรายการเปลี่ยน) → อัปไฟล์รูปแบบปกติ → Confirm ได้ pass และชดเชยเฉพาะยอดขายก่อนเวลาสแกน', async ({ browser }) => {
    const desk = await bootFreshCount(browser, { role: 'pharmacist', user: 'Pharm', mode: 'desktop' });
    const pda = await bootJoinCount(browser, { role: 'assistant', user: 'PDA-A', mode: 'pda', expectEpoch: desk.epoch });
    await pdaScansSeven(pda);
    expect(await desk.page.evaluate(() => state.r16Loaded), 'ก่อนอัป: ยังไม่มี R16').toBe(false);

    // 1) ไฟล์ที่ได้มาเป็น dd-Mon-yy → ถูกปฏิเสธ
    const [bMon, aMon] = [await stamp(desk.page, -2 * 3600_000, 'mon'), await stamp(desk.page, 2 * 3600_000, 'mon')];
    expect(bMon).toMatch(/^\d\d-[A-Z][a-z]{2}-\d\d \d\d:\d\d:\d\d$/);
    await upload(desk.page, rowsFor(bMon, aMon), 'R16104-จากเครื่องอื่น.csv');
    await desk.page.waitForFunction(() => [...document.querySelectorAll('#toastContainer .toast-error')].some((t) => t.textContent.includes('R16 ไม่ถูกโหลด')), null, { polling: 100, timeout: 20000 });
    const rejected = await desk.page.evaluate(() => ({
      loaded: state.r16Loaded, raw: state.r16RawMap.size, btn: document.getElementById('btnConfirm').disabled,
      toast: [...document.querySelectorAll('#toastContainer .toast-error')].map((t) => t.textContent).join(' | '),
    }));
    expect(rejected).toMatchObject({ loaded: false, raw: 0, btn: true });
    expect(rejected.toast).toContain('วันที่อ่านไม่ออก 2/2 แถว');
    expect(rejected.toast).toContain('dd/mm/yyyy');
    await desk.page.evaluate(() => validateAndProcess());                          // พนักงานลองกด Confirm — ต้องไม่มีอะไรเปลี่ยน
    await desk.page.waitForTimeout(1200);
    expect(await desk.page.evaluate(() => state.scanData.get('S-NORM').status), 'ยังเป็น scanning — ไม่ถูก Confirm').toBe('scanning');

    // 2) export ใหม่ → ไฟล์รูปแบบปกติ (ชื่อใหม่/เดิมก็ได้) → โหลดได้
    const [bOk, aOk] = [await stamp(desk.page, -2 * 3600_000, 'ok'), await stamp(desk.page, 2 * 3600_000, 'ok')];
    await upload(desk.page, rowsFor(bOk, aOk), 'R16104.csv');
    await desk.page.waitForFunction(() => state.r16Loaded === true && state.r16RawMap.size > 0, null, { polling: 100, timeout: 20000 });
    expect(await desk.page.evaluate(() => ({ btn: document.getElementById('btnConfirm').disabled, badge: document.getElementById('badgeR16').textContent, mismatch: state.r16DateMismatch })))
      .toEqual({ btn: false, badge: 'Ready', mismatch: false });

    // 3) Confirm จริง: ชดเชยเฉพาะที่ขายก่อนเวลาสแกน (3) → 7+3 = 10 = ระบบ → pass (ไม่ใช่ 0 → Stock Adj · ไม่ใช่ 7)
    await desk.page.evaluate(() => validateAndProcess());
    const norm = await waitForDoc(PROJECT_ID, 'stock_sessions/SRC/items/S-NORM', (d) => d && d.status === 'pass', { timeout: 25000 });
    expect(norm.countedQty).toBe(7);
    expect(norm.soldQty, 'ชดเชยเฉพาะที่ขายก่อนเวลาสแกน').toBe(3);
    expect(norm.directAdj).toBeUndefined();

    await closeApp(pda);
    await closeApp(desk);
  });
});
