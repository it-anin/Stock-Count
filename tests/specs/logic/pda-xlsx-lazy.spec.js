// แอป PDA ไม่โหลด xlsx.full.min.js (880 KB) ตอนเปิดแอป (ต.ค. 2026 · ข้อ A ของการวิเคราะห์ภาระ UI บน MTK6761)
//
// ทำไม: ไฟล์นี้ใช้เฉพาะอัปโหลด/Export Excel บน Desktop แต่เป็น <script> ที่บล็อกหน้า → PDA ต้องแปลโค้ด 880 KB ทุกครั้งที่เปิดแอป
//   (วัดที่ CPU ช้า 6×: DOMContentLoaded 1,209 → 826 ms · First Paint 852 → 380 ms)
// วิธี: <head> ตัดสินด้วย UA `StockCountPDA` (เงื่อนไขเดียวกับ _isPdaApp) —
//   · PDA: ไม่โหลด + วาง getter `XLSX` ที่โหลดแบบ sync ตอนถูกแตะครั้งแรก (เผื่อ PDA ได้ใช้จริง · ไม่ต้องแก้ 28 จุดที่เรียก XLSX.)
//   · อื่นๆ ทั้งหมด: document.write <script src> เหมือนเดิม (บล็อก/ลำดับเดียวกับแท็กเดิม)
//   · สวิตช์ XLSX_SKIP_ON_PDA=false → PDA โหลดตอนเปิดเหมือนก่อนแก้
//
// ตรึง 4 ด้าน:
//   1. ★ ค่าที่ส่งมอบ: PDA ไม่มี request ไป xlsx ตอนเปิด · Desktop/จอแคบที่ไม่ใช่แอป PDA โหลดเหมือนเดิมและลำดับอยู่ก่อนสคริปต์ Firebase
//   2. ★ PDA ใช้งานจริงได้: parseFile (เส้นทางจริงของอัปโหลด) อ่าน .xlsx ที่มีข้อความไทยได้ถูกต้อง · โหลดครั้งเดียว · เวอร์ชันเท่า Desktop
//   3. ★ สวิตช์ปิด = PDA โหลดตอนเปิดเหมือนเดิม
//   4. โหลดไม่สำเร็จ (ออฟไลน์/แคชหาย) ไม่ทำให้หน้าพัง ไม่วนเรียก getter
const fs = require('node:fs');
const path = require('node:path');
const { test, expect, newAppContext, waitForAppReady, closeApp } = require('../../lib/hooks');

const XLSX_URL = 'libs/xlsx.full.min.js';

async function boot(browser, { mode = 'desktop', narrow = false, rewrite = null, abortXlsx = false, delayXlsxMs = 0 } = {}) {
  const app = await newAppContext(browser, { login: false, mode });
  const reqs = [];
  app.page.on('request', (r) => { if (r.url().includes(XLSX_URL)) reqs.push(r.resourceType()); });
  if (narrow) await app.page.setViewportSize({ width: 390, height: 700 });
  if (abortXlsx) await app.context.route(`**/${XLSX_URL}`, (route) => route.abort());
  if (delayXlsxMs) {
    // ไฟล์ตอบช้า + จดว่า ณ DOMContentLoaded XLSX เป็นตัวจริงแล้วหรือยัง:
    // <script> ที่บล็อกการ parse → DOMContentLoaded รอจนโหลดเสร็จ (true) · สคริปต์ที่แทรกทีหลังแบบไม่บล็อก → ยังไม่มา (false)
    await app.context.route(`**/${XLSX_URL}`, async (route) => {
      const res = await route.fetch();
      await new Promise((r) => setTimeout(r, delayXlsxMs));
      await route.fulfill({ response: res });
    });
    await app.context.addInitScript(() => {
      document.addEventListener('DOMContentLoaded', () => {
        const d = Object.getOwnPropertyDescriptor(window, 'XLSX');
        window.__xlsxAtDcl = !!d && 'value' in d;
      });
    });
  }
  if (rewrite) {
    await app.context.route('**/index.html', async (route) => {
      const res = await route.fetch();
      await route.fulfill({ response: res, body: (await res.text()).replace(rewrite[0], rewrite[1]) });
    });
  }
  await app.page.goto('/index.html');
  await waitForAppReady(app.page, { login: false });
  return { app, reqs };
}

// อ่าน descriptor โดยไม่แตะ getter (typeof XLSX / XLSX.x จะสั่งโหลดบน PDA)
const descriptor = (page) => page.evaluate(() => {
  const d = Object.getOwnPropertyDescriptor(window, 'XLSX');
  return d ? { accessor: typeof d.get === 'function', hasValue: 'value' in d } : null;
});

test('★ ค่าที่ส่งมอบ: PDA ไม่โหลด xlsx ตอนเปิด · Desktop และจอแคบที่ไม่ใช่แอป PDA โหลดเหมือนเดิม', async ({ browser }) => {
  const pda = await boot(browser, { mode: 'pda' });
  expect(pda.reqs, 'PDA ต้องไม่ขอไฟล์ xlsx ตอนเปิดแอป').toEqual([]);
  expect(await descriptor(pda.app.page), 'PDA: XLSX เป็น getter ที่ยังไม่ถูกแตะ').toEqual({ accessor: true, hasValue: false });
  expect(await pda.app.page.evaluate((u) => !!document.querySelector(`script[src*="${u}"]`), XLSX_URL), 'PDA ไม่มี <script> xlsx').toBe(false);
  // แอปต้องขึ้นปกติโดยไม่มี xlsx (waitForAppReady ผ่านแล้ว) และไม่มี request นอกเครื่อง/error (closeApp ตรวจ)
  await closeApp(pda.app);

  const desk = await boot(browser, { mode: 'desktop' });
  expect(desk.reqs, 'Desktop โหลด xlsx หนึ่งครั้งแบบ <script> เหมือนเดิม').toEqual(['script']);
  expect(await descriptor(desk.app.page)).toEqual({ accessor: false, hasValue: true });
  const order = await desk.app.page.evaluate((u) => {
    const src = [...document.scripts].map((s) => s.getAttribute('src') || '');
    return { xlsx: src.findIndex((s) => s.includes(u)), papa: src.findIndex((s) => s.includes('papaparse')), fb: src.findIndex((s) => s.includes('firebase-app-compat')) };
  }, XLSX_URL);
  expect(order.xlsx, 'ลำดับสคริปต์ต้องคงเดิม: papaparse → xlsx → firebase').toBeGreaterThan(order.papa);
  expect(order.xlsx).toBeLessThan(order.fb);
  expect(await desk.app.page.evaluate(() => typeof XLSX.utils.aoa_to_sheet)).toBe('function');
  await closeApp(desk.app);

  // Desktop ต้องบล็อกการ parse เหมือน <script src> เดิม: แม้ไฟล์ตอบช้า XLSX ต้องพร้อมก่อน DOMContentLoaded
  const slow = await boot(browser, { mode: 'desktop', delayXlsxMs: 400 });
  expect(await slow.app.page.evaluate(() => window.__xlsxAtDcl), 'Desktop: XLSX ต้องเป็นตัวจริงแล้วตอน DOMContentLoaded (สคริปต์บล็อก ไม่ใช่โหลดทีหลัง)').toBe(true);
  expect(slow.reqs).toEqual(['script']);
  await closeApp(slow.app);

  // จอแคบแต่ไม่ใช่แอป PDA (เช่นมือถือเปิดเว็บ) — ตัดสินด้วย UA ไม่ใช่ความกว้างจอ
  const narrow = await boot(browser, { mode: 'desktop', narrow: true });
  expect(narrow.reqs).toEqual(['script']);
  expect(await descriptor(narrow.app.page)).toEqual({ accessor: false, hasValue: true });
  await closeApp(narrow.app);
});

test('★ PDA ใช้ XLSX จริงได้: อ่าน .xlsx ที่มีข้อความไทยผ่าน parseFile · โหลดครั้งเดียว · เวอร์ชันเท่า Desktop', async ({ browser }) => {
  // สร้างไฟล์ .xlsx จาก Desktop (ต้นฉบับ) แล้วส่งไบต์ให้ PDA อ่านด้วยฟังก์ชันจริงของแอป
  const desk = await boot(browser, { mode: 'desktop' });
  const made = await desk.app.page.evaluate(() => {
    const ws = XLSX.utils.aoa_to_sheet([['SKU', 'ชื่อสินค้า', 'จำนวน'], ['A001', 'พาราเซตามอล 500 มก. ตรา ก-ฮ', 12], ['A002', 'ผ้าก๊อซ ½ นิ้ว ©', 3]]);
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'ทดสอบ');
    return { bytes: Array.from(new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }))), version: XLSX.version };
  });
  await closeApp(desk.app);

  const pda = await boot(browser, { mode: 'pda' });
  expect(pda.reqs).toEqual([]);
  const read = async () => pda.app.page.evaluate((bytes) => new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('parseFile ไม่เรียก callback')), 10000);
    parseFile(new File([new Uint8Array(bytes)], 'fixture.xlsx'), (rows) => { clearTimeout(t); resolve(rows); });
  }), made.bytes);

  const expected = [['SKU', 'ชื่อสินค้า', 'จำนวน'], ['A001', 'พาราเซตามอล 500 มก. ตรา ก-ฮ', '12'], ['A002', 'ผ้าก๊อซ ½ นิ้ว ©', '3']];
  expect(await read(), 'อ่านผ่านเส้นทางจริง (getter → โหลด sync → XLSX.read) ได้ข้อมูลเท่าต้นฉบับ').toEqual(expected);
  expect(pda.reqs, 'โหลดตอนใช้จริงหนึ่งครั้ง (XHR)').toEqual(['xhr']);
  expect(await descriptor(pda.app.page), 'หลังโหลด getter ถูกแทนที่ด้วย XLSX จริง').toEqual({ accessor: false, hasValue: true });
  expect(await read(), 'ครั้งที่สองยังอ่านได้').toEqual(expected);
  expect(pda.reqs, 'ไม่โหลดซ้ำ').toEqual(['xhr']);
  expect(await pda.app.page.evaluate(() => XLSX.version), 'เวอร์ชันเท่าที่ Desktop โหลดผ่าน <script>').toBe(made.version);
  await closeApp(pda.app);
});

test('★ สวิตช์ XLSX_SKIP_ON_PDA=false: PDA โหลด xlsx ตอนเปิดเหมือนก่อนแก้', async ({ browser }) => {
  // ข้อความที่ใช้แทนที่ต้องมีอยู่ในไฟล์จริงหนึ่งแห่งพอดี ไม่งั้นการ "ปิดสวิตช์" ในเทสนี้ไม่ได้ปิดอะไร (ผ่านเปล่าๆ)
  const html = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'index.html'), 'utf8');
  expect(html.split('var XLSX_SKIP_ON_PDA=true;').length - 1, 'สวิตช์ต้องประกาศแบบ var XLSX_SKIP_ON_PDA=true; หนึ่งแห่ง').toBe(1);

  const off = await boot(browser, { mode: 'pda', rewrite: ['var XLSX_SKIP_ON_PDA=true;', 'var XLSX_SKIP_ON_PDA=false;'] });
  expect(off.reqs).toEqual(['script']);
  expect(await descriptor(off.app.page)).toEqual({ accessor: false, hasValue: true });
  await closeApp(off.app);
});

test('โหลดไม่สำเร็จ (ออฟไลน์/แคชหาย) ไม่ทำให้หน้าพัง ไม่วนเรียก getter และเตือนใน console', async ({ browser }) => {
  const warns = [];
  const { app } = await boot(browser, { mode: 'pda', abortXlsx: true });
  app.page.on('console', (m) => { if (m.type() === 'warning') warns.push(m.text()); });
  const r = await app.page.evaluate(() => {
    const out = {};
    try { out.first = typeof XLSX; } catch (e) { out.first = 'throw ' + e.message; }
    try { out.second = typeof XLSX; } catch (e) { out.second = 'throw ' + e.message; }
    out.appAlive = typeof state === 'object' && typeof parseFile === 'function';
    return out;
  });
  expect(r.first, 'โหลดไม่ได้ = undefined (ไม่ throw ใน getter)').toBe('undefined');
  expect(r.second, 'ไม่วน/ไม่ throw ซ้ำ').toBe('undefined');
  expect(r.appAlive, 'ส่วนอื่นของแอปไม่กระทบ').toBe(true);
  expect(warns.some((w) => w.includes('[xlsx] โหลดไม่สำเร็จ')), 'ต้องมีคำเตือนใน console ให้ไล่ปัญหาได้').toBe(true);
  await closeApp(app);
});
