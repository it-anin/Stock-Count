// R16.104 timeline ของสาขายาจาก Cloud (บอท auto-r16) — เส้นทางจริง: login (initAfterLogin) + listener ของ master + Confirm จริง (ต.ค. 2026)
//
// ทำไมต้องมี (CLAUDE.md §R16 timeline บน Cloud ของสาขายา): สาขายาไม่เคยมี raw timeline บน Cloud — เครื่องที่ไม่ได้อัปไฟล์เองได้แค่ยอดรวมต่อ SKU
// ทำให้ Confirm บวกยอดขาย "หลังเวลาสแกน" เข้าไปด้วย → ของที่นับถูกกลายเป็น Stock Adj ปลอมลง ERP · เทสนี้จำลองสิ่งที่บอทเขียน
// (chunks → meta → master ตามลำดับ ผ่าน firebase-admin) แล้วดูว่า Desktop ได้ timeline เองและ Confirm ตัดสินถูก
//   ★ เคสธุรกิจ: ระบบ 10 · ขายก่อนสแกน 3 (ชั้นเหลือ 7 → นับได้ 7) · ขายหลังสแกน 4 → ต้อง pass (7+3=10) · ยอดรวม 7+7=14 ผิด
const { test, expect, closeApp, requireEmulator } = require('../../lib/hooks');
const { bootFreshCount, bootJoinCount, armR16, PROJECT_ID } = require('../../lib/scenario');
const { adminDb, setDoc, getDoc, waitForDoc } = require('../../lib/emulator');
const { run: runBot, baseDocs: botDocs } = require('../../lib/r16-bot-harness');
const F = require('../../lib/r16-104-fixture');

const TEXT ='21:00 น. 13/10/2026 · ข้อมูล 13/10 08:02–13/10 20:58';

// เวลาแบบ "d/m/yyyy HH:mm:ss" ตามนาฬิกาของหน้าเว็บ (ไม่ใช่ของ Node) — getSoldQtyBefore เทียบกับเวลาสแกนของหน้าเว็บเอง
const tdate = (page, offsetMs) => page.evaluate((o) => {
  const d = new Date(Date.now() + o); const p = (n) => String(n).padStart(2, '0');
  return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}, offsetMs);

// ทำเหมือนบอท: chunks → meta → master (merge 3 field) — ลำดับสำคัญ ตัวอ่านเชื่อ "master ประกาศแล้ว = chunks พร้อมแล้ว"
async function botPublish(page, { rows, version, branch = 'SRC', text = TEXT, r01Version, epoch }) {
  const cur = await page.evaluate(() => ({ epoch: _countResetAt, r01Version: state.r01Version }));
  const ep = epoch ?? cur.epoch, rv = r01Version ?? cur.r01Version;
  const generation = 'e2e' + version.replace(/\D/g, '').slice(-8);
  const db = adminDb(PROJECT_ID);
  await db.doc(`stock_sessions/${branch}_r16_104_${generation}_0000`).set({ data_json: JSON.stringify(rows), kind: '104', version, generation, index: 0, countResetAt: ep });
  await db.doc(`stock_sessions/${branch}_r16_104_meta`).set({
    ready: true, kind: '104', version, generation, chunkCount: 1, rowCount: rows.length, countResetAt: ep, r01Version: rv,
    uploadedAtText: text, dateMismatch: false, dateMismatchDetail: '', source: 'auto-r16',
  });
  await setDoc(PROJECT_ID, `stock_sessions/${branch}_r01`, { r16Loaded: true, r16UploadedAt: text, r16DetailVersion: version });
}

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

test.describe('timeline R16 สาขายาจาก Cloud (บอท auto-r16)', () => {
  test.beforeEach(() => requireEmulator());
  test.setTimeout(120_000);

  test('★ Desktop เปิดค้าง: บอทเขียน → ได้ timeline เอง (ไม่ต้อง F5) → Confirm ไม่บวกยอดขายหลังเวลาสแกน = pass', async ({ browser }) => {
    const desk = await bootFreshCount(browser, { role: 'pharmacist', user: 'Pharm', mode: 'desktop' });
    const pda = await bootJoinCount(browser, { role: 'assistant', user: 'PDA-A', mode: 'pda', expectEpoch: desk.epoch });
    await pdaScansSeven(pda);
    expect(await desk.page.evaluate(() => state.r16Loaded), 'ก่อนบอทเขียน: ยังไม่มี R16 = Confirm ล็อก').toBe(false);

    const before = await tdate(desk.page, -2 * 3600_000), after = await tdate(desk.page, 2 * 3600_000);
    const version = new Date(Date.now() + 60_000).toISOString();
    await botPublish(desk.page, {
      version,
      rows: [['S-NORM', 7, 0, [{ soldQty: 3, tranDate: before }, { soldQty: 4, tranDate: after }], []]],
    });

    // listener ของ master → ตัวอ่าน → apply (เครื่องที่เปิดค้างตอน 21:00)
    await desk.page.waitForFunction((v) => state.r16Loaded === true && state.r16DetailVersion === v && state.r16RawMap.size > 0,
      version, { timeout: 20000, polling: 100 });
    const got = await desk.page.evaluate(() => ({
      btn: document.getElementById('btnConfirm').disabled, badge: document.getElementById('badgeR16').textContent,
      ts: document.getElementById('r16Timestamp').textContent, mismatch: state.r16DateMismatch,
    }));
    expect(got).toEqual({ btn: false, badge: 'Ready', ts: TEXT, mismatch: false });

    await desk.page.evaluate(() => validateAndProcess());
    const norm = await waitForDoc(PROJECT_ID, 'stock_sessions/SRC/items/S-NORM', (d) => d && d.status === 'pass', { timeout: 25000 });
    expect(norm.countedQty).toBe(7);
    expect(norm.soldQty, 'ชดเชยเฉพาะที่ขายก่อนเวลาสแกน').toBe(3);
    expect(norm.directAdj).toBeUndefined();
    expect(await getDoc(PROJECT_ID, 'stock_sessions/SRC_confirm_lock')).toBeNull();

    await closeApp(pda);
    await closeApp(desk);
  });

  test('★ ไฟล์จากเครื่อง BIGYAMAINPC (วันที่ dd-Mon-yy) → ผ่านบอทจริง → Desktop ได้ timeline → Confirm กรองตามเวลาสแกนถูก', async ({ browser }) => {
    // 14 ต.ค. 2026: เครื่องนั้น export TRANDATE เป็น "14-Oct-26 09:17:17" ซึ่ง parseTranDate() ของแอปอ่านไม่ได้ (→ null → ข้ามแถว → ไม่ชดเชยยอดขาย
    // → Stock Adj ปลอม) · บอทต้องแปลงเป็น dd/mm/yyyy ก่อนเก็บ — เทสนี้พิสูจน์ปลายทาง (ผล Confirm) ไม่ใช่แค่หน้าตาสตริง
    const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const desk = await bootFreshCount(browser, { role: 'pharmacist', user: 'Pharm', mode: 'desktop' });
    const pda = await bootJoinCount(browser, { role: 'assistant', user: 'PDA-A', mode: 'pda', expectEpoch: desk.epoch });
    await pdaScansSeven(pda);

    // เวลาตามนาฬิกาของหน้าเว็บ (ตัวเดียวกับที่ Confirm เทียบ) ในรูปแบบที่เครื่องนั้นให้
    const monDate = (offsetMs) => desk.page.evaluate(({ o, MON }) => {
      const d = new Date(Date.now() + o); const p = (n) => String(n).padStart(2, '0');
      return `${p(d.getDate())}-${MON[d.getMonth()]}-${String(d.getFullYear()).slice(2)} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
    }, { o: offsetMs, MON });
    const before = await monDate(-2 * 3600_000), after = await monDate(2 * 3600_000);
    expect(before, 'รูปแบบที่ตั้งใจทดสอบ').toMatch(/^\d\d-[A-Z][a-z]{2}-\d\d \d\d:\d\d:\d\d$/);

    const bot = runBot({
      // --force: เวลา ±2 ชม. อาจข้ามวัน (ด่าน "ไฟล์ต้องเป็นของวันนี้" ไม่ใช่สิ่งที่เทสนี้ตรวจ — มีเทสของมันใน auto-r16-flow)
      args: ['--force', '--branch', 'SRC'],
      csv: F.csvText([
        F.branchRow('SRC', { at: before, barcode: 'B-NORM', sku: 'S-NORM', qty: '3.0000', tranNo: 'ORCMBY001261000001' }),
        F.branchRow('SRC', { at: after, barcode: 'B-NORM', sku: 'S-NORM', qty: '4.0000', tranNo: 'ORCMBY001261000002' }),
      ]),
      docs: botDocs({
        global_r05: { data_json: JSON.stringify([['B-NORM', 'S-NORM', 'EA', 1, 10]]), format: 'r05a1' },
        SRC_r01: { data_json: JSON.stringify([{ colE: 'S-NORM', systemQty: 10, productName: 'norm' }]) },
      }),
    });
    const r = bot.runs[0];
    expect(r.code, r.log).toBe(0);
    const generation = bot.store.SRC_r16_104_meta.generation;
    const rows = JSON.parse(bot.store[`SRC_r16_104_${generation}_0000`].data_json);
    expect(rows.map((x) => [x[0], x[1], x[2]])).toEqual([['S-NORM', 7, 0]]);
    expect(rows[0][3].map((x) => x.tranDate).every((s) => /^\d\d\/\d\d\/\d{4} \d\d:\d\d:\d\d$/.test(s)), 'บอทแปลงเป็น dd/mm/yyyy แล้ว').toBe(true);

    const version = new Date(Date.now() + 60_000).toISOString();
    await botPublish(desk.page, { version, rows });
    await desk.page.waitForFunction((v) => state.r16Loaded === true && state.r16DetailVersion === v && state.r16RawMap.size > 0,
      version, { timeout: 20000, polling: 100 });
    await desk.page.evaluate(() => validateAndProcess());
    const norm = await waitForDoc(PROJECT_ID, 'stock_sessions/SRC/items/S-NORM', (d) => d && d.status === 'pass', { timeout: 25000 });
    expect(norm.countedQty).toBe(7);
    expect(norm.soldQty, 'ชดเชยเฉพาะที่ขายก่อนเวลาสแกน (ไม่ใช่ 0 = แอปอ่านวันที่ไม่ออก · ไม่ใช่ 7 = ไม่กรองเวลา)').toBe(3);
    expect(norm.directAdj).toBeUndefined();

    await closeApp(pda);
    await closeApp(desk);
  });

  test('(ทางเก่า — ยืนยันว่าตัวอ่านแก้ปัญหาจริง) เครื่องที่มีแค่ยอดรวมทั้งวัน → Confirm บวกยอดขายหลังสแกน → Stock Adj ปลอม', async ({ browser }) => {
    const desk = await bootFreshCount(browser, { role: 'pharmacist', user: 'Pharm', mode: 'desktop' });
    const pda = await bootJoinCount(browser, { role: 'assistant', user: 'PDA-A', mode: 'pda', expectEpoch: desk.epoch });
    await pdaScansSeven(pda);
    await armR16(desk.page);                                                     // R16 พร้อมแต่ไม่มี raw timeline (เหมือนได้ผ่าน session sync)
    await desk.page.evaluate(() => { state.r16SalesMap.set('S-NORM', 7); });      // ยอดรวมทั้งวัน = ขายก่อนสแกน 3 + หลังสแกน 4
    await desk.page.evaluate(() => validateAndProcess());
    const f = await waitForDoc(PROJECT_ID, 'stock_sessions/SRC/items/S-NORM', (d) => d && d.status === 'stock_adjustment', { timeout: 25000 });
    expect(f).toMatchObject({ countedQty: 7, effectiveQty: 14, systemQty: 10, directAdj: true });   // 7 + 7 ≠ 10 → ปรับสต็อกผิดลง ERP

    await closeApp(pda);
    await closeApp(desk);
  });

  test('เส้นทาง login (initAfterLogin หลัง reload) — ได้ timeline ตอน login โดยไม่ต้องมี listener · Confirm ปลดล็อก', async ({ browser }) => {
    const desk = await bootFreshCount(browser, { role: 'pharmacist', user: 'Pharm', mode: 'desktop' });
    // ปิดตัวอ่านฝั่ง listener ชั่วคราว (สวิตช์อยู่ในโค้ด reload แล้วกลับเป็นค่าเริ่มต้น) เพื่อให้เหลือเฉพาะเส้นทาง login
    await desk.page.evaluate(() => { PHARMACY_R16_CLOUD_TIMELINE = false; });
    const before = await tdate(desk.page, -2 * 3600_000), after = await tdate(desk.page, 2 * 3600_000);
    const version = new Date(Date.now() + 60_000).toISOString();
    await botPublish(desk.page, { version, rows: [['S-NORM', 7, 0, [{ soldQty: 3, tranDate: before }, { soldQty: 4, tranDate: after }], []]] });
    await desk.page.waitForTimeout(1500);
    expect(await desk.page.evaluate(() => state.r16RawMap.size), 'สวิตช์ปิด = listener ไม่โหลด').toBe(0);
    await desk.page.evaluate(() => saveSession());

    await desk.page.reload({ waitUntil: 'domcontentloaded' });
    await desk.page.waitForFunction((v) => typeof state !== 'undefined' && state.r16Loaded === true && state.r16DetailVersion === v && state.r16RawMap.size > 0,
      version, { timeout: 30000, polling: 100 });
    const t = await desk.page.evaluate(() => {
      const p = (n) => String(n).padStart(2, '0');
      const ts = (o) => { const x = new Date(Date.now() + o); return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())} ${p(x.getHours())}:${p(x.getMinutes())}:${p(x.getSeconds())}`; };
      return { early: getSoldQtyBefore('S-NORM', ts(-3 * 3600_000)), now: getSoldQtyBefore('S-NORM', ts(0)), late: getSoldQtyBefore('S-NORM', ts(3 * 3600_000)),
        btn: document.getElementById('btnConfirm').disabled, badge: document.getElementById('badgeR16').textContent };
    });
    expect(t).toEqual({ early: 0, now: 3, late: 7, btn: false, badge: 'Ready' });   // ★ กรองตามเวลาสแกน — ไม่ใช่ 7 เท่ากันทุกเวลา

    await closeApp(desk);
  });

  test('PDA (Confirm ไม่ได้อยู่แล้ว) ไม่โหลด timeline', async ({ browser }) => {
    const desk = await bootFreshCount(browser, { role: 'pharmacist', user: 'Pharm', mode: 'desktop' });
    const version = new Date(Date.now() + 60_000).toISOString();
    await botPublish(desk.page, { version, rows: [['S-NORM', 7, 0, [{ soldQty: 3, tranDate: '13/10/2026 09:00:00' }], []]] });
    await desk.page.waitForFunction((v) => state.r16DetailVersion === v && state.r16RawMap.size > 0, version, { timeout: 20000, polling: 100 });

    const pda = await bootJoinCount(browser, { role: 'assistant', user: 'PDA-A', mode: 'pda', expectEpoch: desk.epoch });
    await pda.page.waitForFunction(() => state.r01Data.length > 0, null, { timeout: 20000, polling: 100 });
    await pda.page.waitForTimeout(2500);
    expect(await pda.page.evaluate(() => state.r16RawMap.size)).toBe(0);

    await closeApp(pda);
    await closeApp(desk);
  });

  test('R01 ใหม่ตอนเช้า (auto-r01) ล้าง timeline เมื่อวาน · reload แล้วไม่ถูกโหลดกลับมา (r01Version ไม่ตรง)', async ({ browser }) => {
    const desk = await bootFreshCount(browser, { role: 'pharmacist', user: 'Pharm', mode: 'desktop' });
    const version = new Date(Date.now() + 60_000).toISOString();
    await botPublish(desk.page, { version, rows: [['S-NORM', 7, 0, [{ soldQty: 3, tranDate: '13/10/2026 09:00:00' }], []]] });
    await desk.page.waitForFunction((v) => state.r16Loaded === true && state.r16DetailVersion === v && state.r16RawMap.size > 0, version, { timeout: 20000, polling: 100 });

    // auto_r01_import.py build_payload(): R01 ใหม่ + baseline ใหม่ + ล้าง r16*
    const iso = new Date(Date.now() + 86400_000).toISOString();
    await setDoc(PROJECT_ID, 'stock_sessions/SRC_r01', {
      data_json: JSON.stringify([{ colE: 'S-NORM', productName: 'ของวันนี้', systemQty: 4242 }]),
      r01UploadedAt: '08:10 น. 14/10/2026', r01Version: iso, r01BaselineAt: iso,
      r16Loaded: false, r16UploadedAt: '', r16DetailVersion: '', r16_103Loaded: false, r16_103UploadedAt: '', r16_103DetailVersion: '',
    });
    await desk.page.waitForFunction((v) => state.r01Version === v && state.r16Loaded === false, iso, { timeout: 20000, polling: 100 });
    expect(await desk.page.evaluate(() => ({ raw: state.r16RawMap.size, btn: document.getElementById('btnConfirm').disabled })))
      .toEqual({ raw: 0, btn: true });                                               // R16 เมื่อวานหมด · Confirm ล็อกจนกว่าจะมี R16 ของวันใหม่

    // timeline เก่ายังอยู่บน Cloud — reload/login ใหม่ต้องไม่หยิบกลับมา
    await desk.page.reload({ waitUntil: 'domcontentloaded' });
    await desk.page.waitForFunction((v) => state.r01Version === v, iso, { timeout: 30000, polling: 100 });
    await desk.page.waitForTimeout(1500);
    expect(await desk.page.evaluate(() => ({ loaded: state.r16Loaded, raw: state.r16RawMap.size }))).toEqual({ loaded: false, raw: 0 });

    await closeApp(desk);
  });
});
