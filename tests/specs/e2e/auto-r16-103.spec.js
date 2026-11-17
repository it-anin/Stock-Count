// e2e: ใบรับสินค้าเข้าระหว่างวัน R16.103 ของสาขายา — บอท auto-r16 (Python จริง) → Firestore emulator (REST + rules จริง) → Desktop จริง → Confirm จริง
//
// ทำไมต้องมี (นอกเหนือจาก logic/auto-r16-103*.spec.js): พิสูจน์ปลายทางที่ผู้ใช้สนใจ — "ผล Confirm" — ผ่านเส้นทางจริงทั้งสาย
//   บอทต่อใบรับเข้าช่อง "รับเข้า" ของ timeline R16.104 → Desktop ที่เปิดอยู่โหลด timeline เอง (_loadPharmacyR16Timeline · เว็บไม่ได้แก้)
//   → ปุ่ม Confirm จริง (validateAndProcess) หักเฉพาะใบรับที่ลงก่อนเวลาสแกน
//   กรณีของผู้ใช้ (R01 = ยอด 07:31): 2 = รับก่อนนับ · 3ก = รับ+ขายก่อนนับ → ต้อง Pass · 1 / 3ข = รับหลังนับ → Pass อยู่แล้ว
//   canary: ไม่ใส่ flag --r103 (พฤติกรรมเดิม) กรณี 2/3ก ต้องเป็น Stock Adj ปลอม — ยืนยันว่าเทสวัดของจริง
const { test, expect, closeApp, requireEmulator } = require('../../lib/hooks');
const { bootFreshCount, PROJECT_ID } = require('../../lib/scenario');
const { adminDb, getDoc, setDoc, waitForDoc } = require('../../lib/emulator');
const B = require('../../lib/r16-bot-emulator');
const R4 = require('../../lib/r16-104-fixture');
const R3 = require('../../lib/r16-103-fixture');

const DAY = B.bkkDay();                                // วันนี้ตามเวลาไทย (ที่บอทใช้เป็น "วันนี้") — ห้ามฮาร์ดโค้ดวันที่
const R01_ISO = `${DAY.iso}T00:31:00.000Z`;          // = 07:31 เวลาไทยของวันนี้ (รูปเดียวกับ r01Version ที่ auto-r01 เขียนจริง)
const at = (t) => `${DAY.dmy} ${t}`;
const itemPath = (sku) => `stock_sessions/SSS/items/${sku}`;

// [sku, barcode, นับ, เวลาสแกน] — ระบบ (fixture) S-F0n = n
const ITEMS = [
  ['S-F05', 'B-F05', 8, '15:00:00'],   // กรณี 2: รับ +3 12:00 ก่อนนับ → 8 − 3 = 5 Pass
  ['S-F06', 'B-F06', 1, '15:00:00'],   // กรณี 3ก: รับโอน +5 09:55 แล้วขาย 10 ตอน 10:00 ก่อนนับ → 1 + 10 − 5 = 6 Pass
  ['S-F07', 'B-F07', 7, '10:00:00'],   // กรณี 1: รับ +5 12:00 หลังนับ → 7 Pass (ไม่หัก)
  ['S-F08', 'B-F08', 8, '10:00:00'],   // กรณี 3ข: รับ 20 + ขาย 15 ตอน 12:00 หลังนับ → 8 Pass (ไม่นับทั้งคู่ · รอบนับถัดไปจัดการ)
];
const SKUS = ITEMS.map((i) => i[0]);
const CSV104 = R4.csvText([
  R4.branchRow('SSS', { tranNo: 'ORCMBY006261100001', colA: '1', qty: '10.0000', barcode: 'B-F06', sku: 'S-F06', at: at('10:00:00') }),
  R4.branchRow('SSS', { tranNo: 'ORCMBY006261100002', colA: '1', qty: '15.0000', barcode: 'B-F08', sku: 'S-F08', at: at('12:00:00') }),
]);
const CSV103 = R3.csvText([
  R3.receipt('SSS', { qty: '3.0000', barcode: 'B-F05', sku: 'S-F05', at: at('12:00:00') }),
  R3.receipt('SSS', { tranNo: 'ITFWBY006261100003', qty: '5.0000', barcode: 'B-F06', sku: 'S-F06', at: at('09:55:00') }),
  R3.receipt('SSS', { qty: '5.0000', barcode: 'B-F07', sku: 'S-F07', at: at('12:00:00') }),
  R3.receipt('SSS', { qty: '20.0000', barcode: 'B-F08', sku: 'S-F08', at: at('12:00:00') }),
  R3.receipt('SSS', { qty: '9.0000', barcode: 'B-F05', sku: 'S-F05', at: at('07:00:00') }),   // ก่อน R01 → อยู่ใน R01 แล้ว ห้ามหัก
]);
const ON = ['--branch', 'SSS', '--r103', '--r103-branch', 'SSS'];

// SSS Desktop เภสัช + R01 ของวันนี้ (ISO) + items ที่ PDA เขียนไว้ (รูปเดียวกับ _scanItemPayload)
async function prepare(browser) {
  const desk = await bootFreshCount(browser, { branch: 'SSS', role: 'pharmacist', user: 'Pharm-SSS', mode: 'desktop', r01Version: R01_ISO });
  await setDoc(PROJECT_ID, 'stock_sessions/SSS_r01', { r01UploadedAt: DAY.thai });   // ด่านของบอท: R01 ต้องอัปวันนี้
  const db = adminDb(PROJECT_ID);
  const batch = db.batch();
  for (const [sku, barcode, count, time] of ITEMS) {
    const ts = `${DAY.iso} ${time}`;
    batch.set(db.doc(itemPath(sku)), {
      sku, countResetAt: desk.epoch, status: 'scanning', countedQty: count, timestamp: ts, firstScanAt: ts, scannedBy: 'พนักงานทดสอบ',
      auditor: '', auditStatus: 'pending', barcode, location: '', rev: 1, updatedBy: 'พนักงานทดสอบ', updatedAt: new Date(Date.now() - 3600_000),
    });
  }
  await batch.commit();
  await desk.page.waitForFunction((skus) => skus.every((s) => state.scanData.get(s)?.status === 'scanning'), SKUS, { timeout: 20_000, polling: 100 });
  return desk;
}

// Desktop โหลด timeline รุ่นที่บอทเพิ่งเผยแพร่เอง (ไม่ F5) แล้วกดปุ่ม Confirm จริง → คืนผลจาก Cloud
async function desktopConfirm(desk) {
  const version = (await getDoc(PROJECT_ID, 'stock_sessions/SSS_r01')).r16DetailVersion;
  expect(version, 'บอทประกาศรุ่น timeline').toBeTruthy();
  await desk.page.waitForFunction((v) => state.r16Loaded === true && state.r16DetailVersion === v && state.r16RawMap.size > 0,
    version, { timeout: 30_000, polling: 100 });
  await desk.page.evaluate(() => validateAndProcess());
  const out = {};
  for (const sku of SKUS) out[sku] = await waitForDoc(PROJECT_ID, itemPath(sku), (d) => d && d.status !== 'scanning', { timeout: 40_000 });
  return out;
}

const pick = (d) => Object.fromEntries(['status', 'directAdj', 'effectiveQty', 'systemQty', 'soldQty', 'rawCountedQty', 'inboundQty']
  .filter((k) => d[k] !== undefined).map((k) => [k, d[k]]));

test.describe('ใบรับ R16.103 ของสาขายา (บอท auto-r16 · emulator)', () => {
  test.beforeEach(() => requireEmulator());
  test.setTimeout(240_000);

  test('★ บอทรวมใบรับ (--r103) → Desktop โหลด timeline เอง → ปุ่ม Confirm จริง: กรณี 1 · 2 · 3ก · 3ข เป็น Pass ทั้งหมด', async ({ browser }) => {
    const desk = await prepare(browser);
    const bot = B.runBotSync({ stateDir: B.newStateDir(), csv: CSV104, csv103: CSV103, args: ON });
    expect(bot.code, bot.log).toBe(0);
    expect(bot.log).toContain('ใบรับ R16.103 [เปิดใช้]: 4 บรรทัด · 4 ใบ · 4 SKU · 33 ชิ้น');
    expect(bot.log).toContain('ข้าม: ก่อนเวลา R01 1');
    expect(bot.log).toContain('ผลพลิก Stock Adj→Pass 2 · Pass→Stock Adj 0');
    const meta = await getDoc(PROJECT_ID, 'stock_sessions/SSS_r16_104_meta');
    expect(meta).toMatchObject({ ready: true, r01Version: R01_ISO, r103Mode: 'on', r103Rows: 4, r103Skus: 4, r103Qty: 33, r103SourceFile: 'R16103.CSV' });

    // Desktop ได้ใบรับใน "รับเข้า" ของ timeline (ตัวเดียวกับที่ getInboundQtyBefore อ่าน) — ใบก่อน R01 ไม่อยู่
    const got = await desktopConfirm(desk);
    expect(await desk.page.evaluate(() => (state.r16InboundRawMap.get('S-F05') || []).map((x) => x.qty))).toEqual([3]);
    expect(pick(got['S-F05'])).toEqual({ status: 'pass', inboundQty: 3 });
    expect(pick(got['S-F06'])).toEqual({ status: 'pass', soldQty: 10, rawCountedQty: 1, inboundQty: 5 });
    expect(pick(got['S-F07']), 'รับหลังนับ = ไม่หัก').toEqual({ status: 'pass' });
    expect(pick(got['S-F08']), 'รับ+ขายหลังนับ = ไม่นับทั้งคู่').toEqual({ status: 'pass' });
    await closeApp(desk);
  });

  test('canary (พฤติกรรมเดิม — ไม่ใส่ --r103 แม้มีไฟล์ R16103.CSV): กรณี 2/3ก เป็น Stock Adj ปลอม · ไฟล์ใบรับไม่ถูกอ่าน', async ({ browser }) => {
    const desk = await prepare(browser);
    const bot = B.runBotSync({ stateDir: B.newStateDir(), csv: CSV104, csv103: CSV103, args: ['--branch', 'SSS'] });
    expect(bot.code, bot.log).toBe(0);
    expect(bot.log).not.toMatch(/R16\.103|R16103|R4166|รออนุมัติ/);
    const meta = await getDoc(PROJECT_ID, 'stock_sessions/SSS_r16_104_meta');
    expect(meta.r103Mode).toBeUndefined();
    const got = await desktopConfirm(desk);
    expect(pick(got['S-F05'])).toEqual({ status: 'stock_adjustment', directAdj: true, effectiveQty: 8, systemQty: 5 });
    expect(pick(got['S-F06'])).toEqual({ status: 'stock_adjustment', directAdj: true, effectiveQty: 11, systemQty: 6, soldQty: 10, rawCountedQty: 1 });
    expect(pick(got['S-F07'])).toEqual({ status: 'pass' });
    expect(pick(got['S-F08'])).toEqual({ status: 'pass' });
    await closeApp(desk);
  });

  test('บอท Confirm เอง (--r103 + --confirm) ผ่าน REST/rules จริง — ผลเท่ากับปุ่ม Confirm ของ Desktop · ไฟล์ใบรับหาย = ไม่เผยแพร่ ไม่ Confirm (exit 4)', async ({ browser }) => {
    const desk = await prepare(browser);
    // ไฟล์ใบรับหาย → สาขาเปิดใช้ไม่ถูกเผยแพร่ → Confirm ไม่ทำ (ไม่มี Stock Adj ปลอม) · รายการยัง scanning
    const miss = B.runBotSync({ stateDir: B.newStateDir(), csv: CSV104, args: [...ON, '--confirm', '--confirm-branch', 'SSS'] });
    expect(miss.code, miss.log).toBe(4);
    expect(miss.log).toContain("❌ ใบรับ R16.103: ไม่พบไฟล์ 'R16103*.CSV'");
    expect(await getDoc(PROJECT_ID, 'stock_sessions/SSS_r16_104_meta'), 'ไม่เผยแพร่').toBeNull();
    for (const sku of SKUS) expect((await getDoc(PROJECT_ID, itemPath(sku))).status, sku).toBe('scanning');

    const ok = B.runBotSync({ stateDir: B.newStateDir(), csv: CSV104, csv103: CSV103, args: [...ON, '--confirm', '--confirm-branch', 'SSS'] });
    expect(ok.code, ok.log).toBe(0);
    expect(ok.log).toContain('Confirm SSS confirmed(4)');
    const got = {};
    for (const sku of SKUS) got[sku] = await getDoc(PROJECT_ID, itemPath(sku));
    expect(pick(got['S-F05'])).toEqual({ status: 'pass', inboundQty: 3 });
    expect(pick(got['S-F06'])).toEqual({ status: 'pass', soldQty: 10, rawCountedQty: 1, inboundQty: 5 });
    expect(pick(got['S-F07'])).toEqual({ status: 'pass' });
    expect(pick(got['S-F08'])).toEqual({ status: 'pass' });
    for (const sku of SKUS) expect(got[sku].updatedBy, sku).toBe('auto-r16');
    expect(await getDoc(PROJECT_ID, 'stock_sessions/SSS_confirm_lock'), 'lock ถูกปล่อย').toBeNull();
    await closeApp(desk);
  });
  // ใบรับที่รออนุมัติ (R4166) — แบบไฟล์จริง 17 พ.ย. 2026 (SSS ITFS FSTOCKMAIN 0) · S-F09 ระบบ 9 · S-F03 ระบบ 3
  test('★ เอกสารรออนุมัติ (R4166) — ใบ ITFS ที่ FSTOCKMAIN 0 ถูกหัก (คีย์ก่อน R01 ก็หัก) → ปุ่ม Confirm จริง: Pass · canary R4166 มีแต่หัว: Stock Adj ปลอม', async ({ browser }) => {
    const PEND_ITEMS = [['S-F09', 'B-F09', 10, '15:00:00'], ['S-F03', 'B-F03', 5, '10:00:00']];
    const csv103 = R3.csvText([
      R3.receipt('SSS', { tranNo: 'ITFSBY001261100001', stockMain: '0', qty: '1.0000', barcode: 'B-F09', sku: 'S-F09', at: at('11:02:19') }),
      R3.receipt('SSS', { tranNo: 'ITFBBY001261100002', stockMain: '0', qty: '2.0000', barcode: 'B-F03', sku: 'S-F03', at: at('07:00:00') }),
    ]);
    const csv4166 = R3.csv4166(['ITFSBY001261100001', 'ITFBBY001261100002']);
    const seed = async (desk) => {
      const db = adminDb(PROJECT_ID);
      const batch = db.batch();
      for (const [sku, barcode, count, time] of PEND_ITEMS) {
        const ts = `${DAY.iso} ${time}`;
        batch.set(db.doc(itemPath(sku)), {
          sku, countResetAt: desk.epoch, status: 'scanning', countedQty: count, timestamp: ts, firstScanAt: ts, scannedBy: 'พนักงานทดสอบ',
          auditor: '', auditStatus: 'pending', barcode, location: '', rev: 1, updatedBy: 'พนักงานทดสอบ', updatedAt: new Date(Date.now() - 3600_000),
        });
      }
      await batch.commit();
      await desk.page.waitForFunction((skus) => skus.every((x) => state.scanData.get(x)?.status === 'scanning'), PEND_ITEMS.map((i) => i[0]), { timeout: 20_000, polling: 100 });
    };
    const confirmPend = async (desk) => {
      const version = (await getDoc(PROJECT_ID, 'stock_sessions/SSS_r01')).r16DetailVersion;
      await desk.page.waitForFunction((v) => state.r16Loaded === true && state.r16DetailVersion === v, version, { timeout: 30_000, polling: 100 });
      await desk.page.evaluate(() => validateAndProcess());
      const out = {};
      for (const [sku] of PEND_ITEMS) out[sku] = await waitForDoc(PROJECT_ID, itemPath(sku), (d) => d && d.status !== 'scanning', { timeout: 40_000 });
      return out;
    };

    const desk = await prepare(browser);
    await seed(desk);
    const bot = B.runBotSync({ stateDir: B.newStateDir(), csv: CSV104, csv103, csv4166, args: ON });
    expect(bot.code, bot.log).toBe(0);
    expect(bot.log).toContain('เอกสารรออนุมัติในไฟล์ R4166: 2 ใบ (2 แถว)');
    expect(bot.log).toContain('รออนุมัติ (หักเพราะของขึ้นชั้นแล้ว) 2 บรรทัด');
    expect(await getDoc(PROJECT_ID, 'stock_sessions/SSS_r16_104_meta')).toMatchObject({ r103Mode: 'on', r103Rows: 2, r103Pending: 2 });
    const got = await confirmPend(desk);
    expect(pick(got['S-F09']), 'นับ 10 − รออนุมัติ 1 = ระบบ 9').toEqual({ status: 'pass', inboundQty: 1 });
    expect(pick(got['S-F03']), 'คีย์ก่อน R01 แต่ยังรออนุมัติ: 5 − 2 = ระบบ 3').toEqual({ status: 'pass', inboundQty: 2 });
    await closeApp(desk);

    // canary: R4166 มีแต่หัว (ไม่มีเอกสารรออนุมัติ) — ใบ FSTOCKMAIN 0 ไม่ถูกหัก = Stock Adj ปลอม (พฤติกรรมก่อนมี R4166)
    const desk2 = await prepare(browser);
    await seed(desk2);
    const bot2 = B.runBotSync({ stateDir: B.newStateDir(), csv: CSV104, csv103, args: ON });
    expect(bot2.code, bot2.log).toBe(0);
    expect(bot2.log).toContain('เอกสารรออนุมัติในไฟล์ R4166: 0 ใบ (0 แถว)');
    expect(await getDoc(PROJECT_ID, 'stock_sessions/SSS_r16_104_meta')).toMatchObject({ r103Mode: 'on', r103Rows: 0, r103Pending: 0 });
    const got2 = await confirmPend(desk2);
    expect(pick(got2['S-F09'])).toEqual({ status: 'stock_adjustment', directAdj: true, effectiveQty: 10, systemQty: 9 });
    expect(pick(got2['S-F03'])).toEqual({ status: 'stock_adjustment', directAdj: true, effectiveQty: 5, systemQty: 3 });

    // R4166 หาย = สาขาที่เปิดใช้ไม่เผยแพร่ (ผู้ใช้เลือก) — ผ่าน REST/rules จริง
    const miss = B.runBotSync({ stateDir: B.newStateDir(), csv: CSV104, csv103, csv4166: null, args: ON });
    expect(miss.code, miss.log).toBe(4);
    expect(miss.log).toContain("❌ ใบรับ R16.103: ไม่พบไฟล์เอกสารรออนุมัติ 'R4166*.CSV'");
    await closeApp(desk2);
  });
});
