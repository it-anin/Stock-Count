// แผง DATA STATUS (สาขายา) บนเส้นทางจริง: ข้อมูลที่บอทเขียนลง Firestore → listener/login ของแอป → การ์ดเดิม → แผงใหม่ (9 พ.ย. 2026 · ผู้ใช้สั่ง)
//
// ผู้ใช้สั่งชัด: "การแก้ไขนี้ต้องไม่ส่งผลกระทบต่อการอัปบอทเด็ดขาด" — แผงเป็นตัวแสดงผลที่อ่านจากการ์ดเดิมอย่างเดียว เทสนี้พิสูจน์ปลายทาง:
//   1. ★ A/B: เครื่องเดียวกัน · ข้อมูลบอทชุดเดียวกัน · ล็อกอินจริง 2 รอบ (แผงเปิด / ปิดด้วย init script) → state + การ์ดเดิม "เท่ากันทุกตัว"
//   2. ★ บอทเขียนระหว่างที่หน้าเปิดอยู่ (R01 เช้า → R16 คืนนั้น → R01 เช้าวันใหม่ล้าง R16): แผงตามการ์ดเดิมทุกขั้น
//   3. ★ ทางสำรอง Admin: ปุ่มในแผงอัปโหลดผ่านเส้นทางเดิม (loadR01/loadR05/loadProductMaster/loadR16) ได้ผลเท่าการ์ดเดิม
// เขียน doc แบบเดียวกับบอทตัวจริง (รูปแบบเดียวกับ auto-r01-adopt.spec.js / pharmacy-r16-cloud-timeline.spec.js)
const { test, expect, closeApp, requireEmulator, armDialog } = require('../../lib/hooks');
const { waitForAppReady, waitForLoginDone, waitForCatalog } = require('../../lib/boot');
const { bootFreshCount, PROJECT_ID } = require('../../lib/scenario');
const { adminDb, setDoc, getDoc } = require('../../lib/emulator');
const F = require('../../lib/fixtures');

const csv = (name, text) => ({ name, mimeType: 'text/csv', buffer: Buffer.from(text, 'utf8') });
const iso = (offsetMs) => new Date(Date.now() + offsetMs).toISOString();

// auto_r01_import.py build_payload(): R01 + ล้าง meta ของ R16 (เช้าทุกวัน)
function botR01(rows, { version, uploadedAt }) {
  return setDoc(PROJECT_ID, 'stock_sessions/SRC_r01', {
    data_json: JSON.stringify(rows), r01UploadedAt: uploadedAt, r01Version: version, r01BaselineAt: version,
    r16Loaded: false, r16UploadedAt: '', r16DetailVersion: '', r16_103Loaded: false, r16_103UploadedAt: '', r16_103DetailVersion: '',
  });
}
// auto_r16_import.py: chunks → meta → master (merge 3 field) ตามลำดับ
async function botR16(page, { version, text, rows }) {
  const cur = await page.evaluate(() => ({ epoch: _countResetAt, r01Version: state.r01Version }));
  const generation = 'e2e' + version.replace(/\D/g, '').slice(-8);
  const db = adminDb(PROJECT_ID);
  await db.doc(`stock_sessions/SRC_r16_104_${generation}_0000`).set({ data_json: JSON.stringify(rows), kind: '104', version, generation, index: 0, countResetAt: cur.epoch });
  await db.doc('stock_sessions/SRC_r16_104_meta').set({
    ready: true, kind: '104', version, generation, chunkCount: 1, rowCount: rows.length, countResetAt: cur.epoch, r01Version: cur.r01Version,
    uploadedAtText: text, dateMismatch: false, dateMismatchDetail: '', source: 'auto-r16',
  });
  await setDoc(PROJECT_ID, 'stock_sessions/SRC_r01', { r16Loaded: true, r16UploadedAt: text, r16DetailVersion: version });
}

const panelRows = (page) => page.evaluate(() => {
  const vis = (e) => !!e && getComputedStyle(e).display !== 'none' && e.getClientRects().length > 0;
  return Object.fromEntries([...document.querySelectorAll('#dsPanel li[data-ds]')].map((li) => [li.dataset.ds, {
    shown: vis(li), st: li.dataset.st, label: li.querySelector('.ds-sl').textContent,
    kv: [...li.querySelectorAll('.ds-kv > dd')].map((dd) => [dd.previousElementSibling && dd.previousElementSibling.tagName === 'DT' ? dd.previousElementSibling.textContent : '', dd.textContent]),
    note: vis(li.querySelector('.ds-nt')) ? li.querySelector('.ds-nt').textContent : '',
    up: vis(li.querySelector('.ds-up')),
  }]));
});
const legacyTexts = (page) => page.evaluate(() => Object.fromEntries(['badgeProductMaster', 'badgeR01', 'badgeR05', 'badgeR16', 'pmTimestamp', 'r01Timestamp', 'r05Timestamp', 'r16Timestamp']
  .map((id) => { const e = document.getElementById(id); return [id, [e.textContent, e.style.display]]; })));

// ทุกอย่างที่ "ข้อมูลบอท" ควรไปถึง — ใช้เทียบ A/B
const grab = (page) => page.evaluate(() => ({
  state: {
    r01: state.r01Data.length, r01Version: state.r01Version, r05: state.r05Data.length, pm: state.productMasterData.length, skus: state.skuMap.size,
    r16Loaded: state.r16Loaded, r16DetailVersion: state.r16DetailVersion, r01UploadedAt: state.r01UploadedAt, r16UploadedAt: state.r16UploadedAt,
    pmUp: state.productMasterUploadedAt, epoch: _countResetAt, schema: _schemaVersion, total: _cachedTotalSku, baseline: _r01BaselineAt,
  },
  legacy: Object.fromEntries(['badgeProductMaster', 'badgeR01', 'badgeR05', 'badgeR16', 'pmTimestamp', 'r01Timestamp', 'r05Timestamp', 'r16Timestamp']
    .map((id) => { const e = document.getElementById(id); return [id, [e.textContent, e.style.display]]; })),
  warnCls: document.getElementById('badgeR16').parentElement.className,
  panelOn: document.getElementById('uploadPanel').classList.contains('ds-on'),
  panelDom: !!document.getElementById('dsPanel'),
}));

// ล็อกอินใหม่แล้วรอจน "ข้อมูลบอทชุดนี้ถูกแอปรับครบ" — ไม่ใช่แค่ catalog พร้อม: baseline (_r01BaselineAt) ถูกรับทีหลังโดยตัวฟัง master ของแอปเดิมแบบ async
// ถ่ายภาพก่อนจุดนี้ = แข่งกับตัวฟัง (เจอจริงตอนรันทั้งชุด: รอบที่แผงปิดซึ่งไม่มีโค้ดแผงทำงานเลย ได้ baseline ว่างเพราะถ่ายก่อนตัวฟังรับค่า)
const reloadAndWait = async (page, { version, uploadedAt }) => {
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForAppReady(page);
  await waitForLoginDone(page);
  await waitForCatalog(page, { minSkus: 1 });
  await page.waitForFunction(({ v, t }) => state.r01Version === v && _r01BaselineAt === v && document.getElementById('r01Timestamp').textContent.includes(t),
    { v: version, t: uploadedAt.slice(0, 5) }, { timeout: 30000, polling: 100 });
};

test.describe('DATA STATUS × บอท (Firestore emulator)', () => {
  test.beforeEach(() => requireEmulator());
  test.setTimeout(120_000);

  test('★ A/B ล็อกอินจริงด้วยข้อมูลบอทชุดเดียวกัน: แผงเปิดกับปิด → state และการ์ดเดิมเท่ากันทุกตัว · แผงตามการ์ดเดิม', async ({ browser }) => {
    const app = await bootFreshCount(browser, { role: 'pharmacist', user: 'Pharm', mode: 'desktop' });
    // เช้านี้บอท R01 อัปแล้ว · บอท R05 ตรวจวันนี้แล้ว · R16 ยังไม่มี (กลางวัน)
    const bot = { version: iso(86_400_000), uploadedAt: '08:10 น. 09/11/2026' };
    await botR01(F.r01CloudRows, bot);
    await setDoc(PROJECT_ID, 'stock_sessions/global_r05_status', { checked_at: new Date() });

    await reloadAndWait(app.page, bot);                 // แผงเปิด (ค่าที่ส่งมอบ)
    const on = await grab(app.page);
    expect(on.panelOn, 'สาขายา: ใช้แผง').toBe(true);
    expect(on.state.r01).toBe(F.r01Rows.length);
    expect(on.legacy.badgeR01[0]).toBe('Ready');

    // แผงต้องตรงกับการ์ดเดิม: R01 Ready + เวลาที่บอทเขียน · R16 ยังไม่โหลด (เทาเป็นกลาง ไม่ใช่เตือน)
    let rows = await panelRows(app.page);
    expect(rows.r01).toMatchObject({ shown: true, st: 'ok', label: 'Ready', kv: [['อัปโหลด', '08:10 น. 09/11/2026']], up: false });
    expect(rows.r16).toMatchObject({ shown: true, st: 'none', label: 'ยังไม่โหลด', kv: [], up: false });
    expect(rows.pm.shown, 'PM/R05: เห็นเฉพาะ Admin').toBe(false);
    expect(rows.r05.shown).toBe(false);

    // Admin Mode: R05 โชว์ 2 เวลา (อัปโหลด + ตรวจวันนี้ = ไม่มีเตือน) · PM โชว์ Ready
    await app.page.evaluate(() => { _adminMode = true; applyAdminUI(); });
    await app.page.evaluate(() => new Promise((r) => setTimeout(r, 60)));
    rows = await panelRows(app.page);
    expect(rows.pm).toMatchObject({ shown: true, st: 'ok', label: 'Ready', up: true });
    expect(rows.r05).toMatchObject({ shown: true, st: 'ok', label: 'Ready', up: true, note: '' });
    expect(rows.r05.kv.map((x) => x[0])).toEqual(['อัปโหลด', 'ตรวจ']);
    const todayTs = await app.page.evaluate(() => formatThaiDateTime(new Date()));
    expect(rows.r05.kv[1][1], 'ตรวจล่าสุด = เวลาที่บอทเขียน doc สถานะ').toBe(todayTs);
    await app.page.evaluate(() => { _adminMode = false; applyAdminUI(); });

    // ปิดแผงด้วย init script (ตั้งตอน DOMContentLoaded ก่อนโค้ดแอปล็อกอิน) แล้วล็อกอินใหม่ด้วยข้อมูลชุดเดิม
    await app.context.addInitScript(() => { document.addEventListener('DOMContentLoaded', () => { DATA_STATUS_PANEL = false; }); });
    await reloadAndWait(app.page, bot);
    const off = await grab(app.page);
    expect(off.panelOn).toBe(false);
    expect(off.panelDom, 'ปิดสวิตช์ = ไม่เคยสร้างแผง').toBe(false);

    // ★ แผงเปิดหรือปิด ผลที่บอทอัปต้องไปถึงแอปเท่ากันทุกตัวอักษร
    expect(on.state).toEqual(off.state);
    expect(on.legacy).toEqual(off.legacy);
    expect(on.warnCls).toBe(off.warnCls);

    await closeApp(app);
  });

  test('★ บอทเขียนระหว่างที่หน้าเปิดอยู่: R01 เช้า → R16 คืนนั้น → R01 เช้าวันใหม่ล้าง R16 · แผงตามการ์ดเดิมทุกขั้น', async ({ browser }) => {
    const app = await bootFreshCount(browser, { role: 'assistant', user: 'Staff', mode: 'desktop' });
    const page = app.page;

    // 1) บอท R01 07:31 (เหมือน auto-r01) — listener adopt แล้วการ์ด+แผงขึ้นเวลาที่บอทเขียน
    const v1 = iso(86_400_000);
    await botR01([{ colE: 'S-NORM', productName: 'ของวันนี้', systemQty: 4242 }], { version: v1, uploadedAt: '07:31 น. 10/11/2026' });
    await page.waitForFunction((v) => state.r01Version === v, v1, { timeout: 20000, polling: 100 });
    await page.waitForFunction(() => document.getElementById('r01Timestamp').textContent.includes('07:31'), null, { polling: 100 });
    let rows = await panelRows(page);
    expect(rows.r01).toMatchObject({ st: 'ok', label: 'Ready', kv: [['อัปโหลด', '07:31 น. 10/11/2026']] });
    expect((await legacyTexts(page)).r01Timestamp[0]).toBe('อัปโหลดล่าสุด: 07:31 น. 10/11/2026');
    expect(rows.r16).toMatchObject({ st: 'none', label: 'ยังไม่โหลด' });

    // 2) บอท R16 21:10 — chunks → meta → master · ตัวอ่านของ Desktop โหลดเอง (ไม่ต้อง F5)
    const text = '21:10 น. 10/11/2026 · ข้อมูล 10/11 08:02–10/11 20:58';
    const v2 = iso(86_400_000 + 60_000);
    await botR16(page, { version: v2, text, rows: [['S-NORM', 7, 0, [{ soldQty: 3, tranDate: '10/11/2026 09:00:00' }], []]] });
    await page.waitForFunction((v) => state.r16Loaded === true && state.r16DetailVersion === v, v2, { timeout: 20000, polling: 100 });
    await page.waitForFunction(() => document.getElementById('badgeR16').textContent === 'Ready', null, { polling: 100 });
    rows = await panelRows(page);
    expect(rows.r16).toMatchObject({ st: 'ok', label: 'Ready', kv: [['อัปโหลด', '21:10 น. 10/11/2026'], ['ข้อมูล', '10/11 08:02–10/11 20:58']] });
    expect((await legacyTexts(page)).r16Timestamp[0]).toBe(text);
    expect(rows.r01.st).toBe('ok');

    // 3) เช้าวันใหม่ บอท R01 อัปแล้วล้าง R16 ตามดีไซน์ → แผง: R16 กลับเป็น "ยังไม่โหลด" เทา (ไม่ใช่เตือน/ล่าช้า) · R01 เวลาใหม่
    const v3 = iso(2 * 86_400_000);
    await botR01([{ colE: 'S-NORM', productName: 'ของวันใหม่', systemQty: 99 }], { version: v3, uploadedAt: '07:31 น. 11/11/2026' });
    await page.waitForFunction((v) => state.r01Version === v && state.r16Loaded === false, v3, { timeout: 20000, polling: 100 });
    await page.waitForFunction(() => document.getElementById('badgeR16').textContent === 'ยังไม่โหลด' && document.getElementById('r01Timestamp').textContent.includes('11/11/2026'), null, { polling: 100 });
    rows = await panelRows(page);
    expect(rows.r16).toMatchObject({ st: 'none', label: 'ยังไม่โหลด', kv: [] });
    expect(rows.r01).toMatchObject({ st: 'ok', kv: [['อัปโหลด', '07:31 น. 11/11/2026']] });
    expect(await page.evaluate(() => document.getElementById('dsPanel').textContent)).not.toMatch(/ล่าช้า/);

    await closeApp(app);
  });

  test('★ ทางสำรอง Admin: ปุ่มอัปโหลดในแผงใช้เส้นทางเดิม R01 → R05 → Product Master → R16 ได้ผลเท่าการ์ดเดิม', async ({ browser }) => {
    const app = await bootFreshCount(browser, { role: 'pharmacist', user: 'Pharm', mode: 'desktop' });
    const page = app.page;
    await page.evaluate(() => {
      state.productMasterData = []; state.r01Data = []; state.r05Data = [];
      state.skuMap.clear(); state.barcodeMap.clear(); state.skuDirectMap.clear();
      for (const k of ['ProductMaster', 'R01', 'R05', 'R16']) document.getElementById('badge' + k).textContent = 'ยังไม่โหลด';
      _setR01Ts(''); _setPmTs(''); _setR05Ts('');
    });

    // เข้า Admin Mode ด้วยปุ่ม Administrator จริง + PIN จริงของแอป (อ่านจากหน้า ไม่ฮาร์ดโค้ดลงเทส)
    const pin = await page.evaluate(() => ADMIN_PIN);
    armDialog(page, pin);
    await page.click('#btnAdmin');
    await page.waitForFunction(() => _adminMode === true, null, { polling: 100 });
    await page.waitForFunction(() => document.querySelectorAll('#dsPanel .ds-up').length === 4 && [...document.querySelectorAll('#dsPanel .ds-up')].every((b) => !b.hidden), null, { polling: 100 });
    let rows = await panelRows(page);
    expect(Object.values(rows).map((r) => r.shown)).toEqual([true, true, true, true]);
    expect(Object.values(rows).map((r) => r.up)).toEqual([true, true, true, true]);
    expect(Object.values(rows).map((r) => r.st), 'ยังไม่มีไฟล์ใดโหลด').toEqual(['none', 'none', 'none', 'none']);

    // อัปทีละไฟล์ด้วยปุ่มในแผง (คลิกจริง → ตัวเลือกไฟล์ของ input เดิม → loadX เดิม)
    const upload = async (id, file) => {
      const [fc] = await Promise.all([page.waitForEvent('filechooser', { timeout: 10000 }), page.click(`#dsPanel li[data-ds="${id}"] .ds-up`)]);
      await fc.setFiles(file);
    };
    const now = new Date(); const p2 = (n) => String(n).padStart(2, '0');
    const nowDmy = `${p2(now.getDate())}/${p2(now.getMonth() + 1)}/${now.getFullYear()} ${p2(now.getHours())}:${p2(now.getMinutes())}:${p2(now.getSeconds())}`;

    await upload('r01', csv('r01.csv', F.toR01Csv()));
    await page.waitForFunction((n) => state.r01Data.length === n, F.r01Rows.length, { polling: 100 });
    await upload('r05', csv('r05.csv', F.toR05Csv()));
    await page.waitForFunction((n) => state.r05Data.length === n, F.r05Rows.length, { polling: 100 });
    await upload('pm', csv('pm.csv', F.toPmCsv()));
    await page.waitForFunction((n) => state.productMasterData.length === n, F.pmRows.length, { polling: 100 });

    // R16 (ต้องมี R01+R05 ก่อน): ขาย 1 ชิ้นของวันนี้
    const R16 = require('../../lib/r16-104-fixture');
    await upload('r16', csv('r16.csv', R16.csvText([R16.branchRow('SRC', { at: nowDmy, barcode: 'B-NORM', sku: 'S-NORM', qty: '1.0000' })])));
    await page.waitForFunction(() => state.r16Loaded === true, null, { timeout: 20000, polling: 100 });
    await page.waitForFunction(() => ['badgeProductMaster', 'badgeR01', 'badgeR05', 'badgeR16'].every((id) => document.getElementById(id).textContent === 'Ready'), null, { polling: 100 });

    rows = await panelRows(page);
    for (const id of ['pm', 'r01', 'r05', 'r16']) {
      expect(rows[id], id).toMatchObject({ shown: true, st: 'ok', label: 'Ready', up: true });
      expect(rows[id].kv[0][0], `${id}: มีเวลาอัปโหลด`).toBe('อัปโหลด');
      expect(rows[id].kv[0][1]).toMatch(/\d\d:\d\d น\. \d\d\/\d\d\/\d{4}/);
    }
    // เท่ากับการอัปด้วยการ์ดเดิม: ข้อมูลเข้าแอปครบ และอัปไฟล์เดิมซ้ำผ่านปุ่มเดิมได้อีก (value ถูกรีเซ็ตก่อนเลือก)
    expect(await page.evaluate(() => ({ r01: state.r01Data.length, r05: state.r05Data.length, pm: state.productMasterData.length, sku: state.skuMap.size > 0 }))).toEqual({ r01: F.r01Rows.length, r05: F.r05Rows.length, pm: F.pmRows.length, sku: true });
    const again = await Promise.all([page.waitForEvent('filechooser'), page.click('#dsPanel li[data-ds="r01"] .ds-up')]);
    expect(await again[0].element().evaluate((e) => e.value)).toBe('');

    // ออกจาก Admin: ปุ่มหาย · แถว PM/R05 ซ่อน · ข้อมูลที่โหลดแล้วยังอยู่
    armDialog(page, undefined);
    await page.evaluate(() => { _adminMode = false; applyAdminUI(); });
    await page.waitForFunction(() => [...document.querySelectorAll('#dsPanel .ds-up')].every((b) => b.hidden), null, { polling: 100 });
    rows = await panelRows(page);
    expect(Object.entries(rows).filter(([, r]) => r.shown).map(([id]) => id)).toEqual(['r01', 'r16']);
    expect(Object.values(rows).some((r) => r.up)).toBe(false);

    // ข้อเท็จจริงของ Admin Mode ที่ผู้ใช้ควรรู้ (พฤติกรรมเดิมของระบบ ไม่ใช่ของแผงนี้ — ตรึงไว้ให้เอกสารไม่คลาดความจริง):
    //   อัปมือใน Admin Mode "เขียน master (R01 / R05 / Product Master) ขึ้น Cloud" · ส่วน session/สแกนถูกตัด (syncToFirestore มีด่าน _adminMode)
    //   R16 ที่อัปมือเก็บ timeline ไว้ในเครื่องนั้น (ไม่ publish chunks) — ขึ้น Cloud เฉพาะ meta (Ready + เวลา) ที่ master
    const cloud = await getDoc(PROJECT_ID, 'stock_sessions/SRC_r01');
    expect(cloud && !!cloud.data_json, 'R01 ที่อัปมือถึง Cloud').toBe(true);
    expect(cloud.r01UploadedAt, 'เวลาอัปโหลดบน Cloud เป็นของการอัปครั้งนี้ ไม่ใช่ค่าที่ seed').not.toBe('test-fixture');
    expect((await getDoc(PROJECT_ID, 'stock_sessions/global_r05')).row_count).toBe(F.r05Rows.length);
    expect((await getDoc(PROJECT_ID, 'stock_sessions/SRC_pm')).row_count).toBe(F.pmRows.length);

    await closeApp(app);
  });
});
