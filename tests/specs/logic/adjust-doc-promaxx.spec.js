// ใบ 📦 ปรับปรุงสินค้า: ปุ่ม 🖥️ "บันทึกลง PROMAXX" (3 พ.ย. 2026 · ผู้ใช้สั่ง) — ขั้นที่ 1: สั่งตัวช่วย PromaxxHelper (127.0.0.1) ให้เปิด ssmaxx.exe ไปถึงปุ่ม "นำเข้าไฟล์เอกสาร" แล้วหยุด
//   สวิตช์ ADJUST_DOC_PROMAXX (false = ไม่มีปุ่ม = ทางถอย) · ตัวช่วยอยู่ promaxx-helper/ (แกนเทสแยกใน promaxx-helper-core.spec.js)
//
// เทสนี้ตรึง 9 ด้าน — ข้อ 3 · 4 · 9 สำคัญที่สุด: "ส่งแค่ {proto,type} ชนิดถูกตามแท็บ" · "กดซ้ำไม่ยิงซ้ำ" · "หน้าเว็บ ↔ ตัวช่วยจริงผ่าน CORS/preflight ใช้ได้"
//   1. ค่าที่ส่งมอบ + ตำแหน่งปุ่มในฟุตเตอร์ (ระหว่าง Export Text กับ ปิด) 2. ใครเห็นปุ่ม: pharmacist/supervisor Desktop เท่านั้น (ไม่ใช่ PDA/ไม่ล็อกอิน/สวิตช์ปิด)
//   3. ★ คำขอ: POST /v1/open-import · header · body = {proto:1,type} เท่านั้น · ords→ORDS irps→IRPS · targetAddressSpace:'loopback'
//   4. ★ ระหว่างทำงาน: ปุ่ม disabled + กดซ้ำไม่ยิงซ้ำ · สลับแท็บระหว่างรอไม่เปลี่ยนชนิดที่สั่งไปแล้ว · จบแล้วคืนสภาพ (แม้ล้ม)
//   5. ทุกรหัสที่ตัวช่วยตอบ → ข้อความที่ผู้ใช้เห็น (สำเร็จ · ปฏิเสธ · ล้มที่ขั้นไหน · ไม่รู้จักรหัส · ตอบผิดรูปแบบ)
//   6. ตัวช่วยไม่เปิด / เบราว์เซอร์บล็อก (สิทธิ์ Local Network) / หมดเวลา → ข้อความที่ถูกต้อง · หน้าไม่พัง
//   7. toast ไม่ล้นหน้าต่างครึ่งจอ (960px) ในกรณียาวสุด · ฟุตเตอร์ 📦 ไม่ล้นที่ 960px
//   8. ★ ตัวช่วยจริง (Python + ตัวต่อปลอม ssmaxx) กับหน้าแอปจริง: สำเร็จ → กดซ้ำ ALREADY_RUNNING · origin ไม่อยู่ใน list → ไม่ถูกสั่งงาน
//   9. ★ Chromium เปล่า (ไม่มี interception) + โค้ด _adjPromaxxCall จาก index.html จริง + ตัวช่วยจริง: preflight/CORS/PNA header ทำงานจริง · origin ไม่อยู่ใน list = POST ไม่ถูกส่งเลย
const http = require('http');
const fs = require('fs');
const path = require('path');
const { test, expect, newAppContext, waitForAppReady, closeApp } = require('../../lib/hooks');
const { startServer } = require('../../lib/promaxx-helper-harness');

const BASE = 'http://127.0.0.1:4173';
const OK = (type) => ({ ok: true, proto: 1, version: 'x', type, reached: 'import-button', dryRun: false, elapsedMs: 5000, steps: [] });
const ERR = (code, step = 'preflight', message = 'ข้อความจากตัวช่วย') => ({ ok: false, proto: 1, version: 'x', code, step, message, steps: [] });

async function boot(browser, mode = 'desktop') {
  const app = await newAppContext(browser, { login: false, mode });
  await app.page.goto('/index.html');
  await waitForAppReady(app.page, { login: false });
  return app;
}

// เซิร์ฟเวอร์จำลองตัวช่วย: ตอบ preflight + CORS ให้ origin ของหน้าเว็บทดสอบ · onPost(body, req) → { status?, json?, raw?, delayMs? }
async function stub(onPost, { origin = BASE } = {}) {
  const hits = [];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const srv = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
      const body = Buffer.concat(chunks).toString('utf8');
      hits.push({ method: req.method, url: req.url, headers: req.headers, body });
      const cors = { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' };
      if (req.method === 'OPTIONS') {
        res.writeHead(204, { ...cors, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, X-Anin-Helper',
          'Access-Control-Allow-Private-Network': 'true', 'Access-Control-Max-Age': '0' });
        return res.end();
      }
      const r = (await (onPost ? onPost(body, req) : { json: OK('ORDS') })) || {};
      if (r.delayMs) await sleep(r.delayMs);
      if (r.raw !== undefined) { res.writeHead(r.status || 200, { ...cors, 'Content-Type': 'text/html' }); return res.end(r.raw); }
      res.writeHead(r.status || 200, { ...cors, 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(r.json));
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  return { port, url: 'http://127.0.0.1:' + port, hits, posts: () => hits.filter((h) => h.method === 'POST'), close: () => new Promise((r) => { srv.closeAllConnections && srv.closeAllConnections(); srv.close(r); }) };
}

// เตรียมหน้า: ล็อกอินจำลอง (ไม่มี Cloud) + จับ toast + ชี้ PROMAXX_HELPER_URL · เปิดป็อปอัพ 📦 ผ่านฟังก์ชันจริง
async function seed(page, { url, role = 'pharmacist', branch = 'SRC', open = true, timeout } = {}) {
  await page.evaluate(({ url, role, branch, timeout }) => {
    _db = null; currentBranch = branch; currentRole = role; currentUser = 'Pharm';
    _branchScanPaused = false; _adjDocFilter = 'ords'; _adjDocPage = 1; _adjLoading = false;
    ADJUST_DOC_PROMAXX = true; _adjPromaxxBusy = false;
    if (url) PROMAXX_HELPER_URL = url;
    if (timeout) PROMAXX_HELPER_TIMEOUT_MS = timeout;
    _lotMap.clear(); _lotSelected.clear(); _priceMap.clear();
    state.skuMap.clear(); state.scanData.clear(); scanListMap.clear();
    _refreshAdjMaster = async () => {};                       // openAdjustDocPopup ต้องไม่ยิง Supabase
    window.__toasts = []; window.__fetches = [];
    if (!window.__promaxxWrapped) {                      // ห่อครั้งเดียว — seed เรียกซ้ำได้โดย wrapper ไม่ซ้อนกัน
      window.__promaxxWrapped = true;
      const real = window.toast;
      toast = (m, type, ms) => { window.__toasts.push({ m: String(m), type, ms }); return real(m, type, ms); };
      const rf = window.fetch.bind(window);
      window.fetch = (u, init) => { window.__fetches.push({ u: String(u), method: init && init.method, tas: init && init.targetAddressSpace, cache: init && init.cache,
        sig: !!(init && init.signal), headers: init && init.headers, body: init && init.body }); return rf(u, init); };
    }
  }, { url, role, branch, timeout });
  if (open) await page.evaluate(() => openAdjustDocPopup());
}
const btn = (page) => page.evaluate(() => {
  const b = document.getElementById('adjPromaxxBtn');
  return { shown: b.style.display !== 'none' && getComputedStyle(b).display !== 'none', text: b.textContent, disabled: b.disabled, title: b.title };
});
const click = (page) => page.evaluate(() => document.getElementById('adjPromaxxBtn').click());      // ผ่าน onclick จริงของปุ่ม
const toasts = (page) => page.evaluate(() => window.__toasts);
const waitToast = (page, n = 1) => page.waitForFunction((n) => window.__toasts.length >= n, n, { polling: 50 });
const idle = (page) => page.waitForFunction(() => !_adjPromaxxBusy, null, { polling: 50 });
const tab = (page, f) => page.evaluate((f) => setAdjDocFilter(f, document.getElementById(f === 'irps' ? 'adjBtnIrps' : 'adjBtnOrds')), f);

test('1. ค่าที่ส่งมอบ + ตำแหน่งปุ่ม — เปิดใช้ · พอร์ต/โปรโตคอลตรงตัวช่วย · อยู่ระหว่าง Export Text กับ ปิด', async ({ browser }) => {
  const app = await boot(browser);
  const r = await app.page.evaluate(() => {
    const b = document.getElementById('adjPromaxxBtn'), foot = b.closest('.stock-popup-footer');
    return { sw: ADJUST_DOC_PROMAXX, url: PROMAXX_HELPER_URL, proto: PROMAXX_HELPER_PROTO, to: PROMAXX_HELPER_TIMEOUT_MS, busy: _adjPromaxxBusy,
      inCard: !!b.closest('#adjustDocPopupCard'), inFooter: !!foot, prev: b.previousElementSibling && b.previousElementSibling.id,
      next: b.nextElementSibling && b.nextElementSibling.textContent.trim(), text: b.textContent, initialHidden: b.style.display === 'none' };
  });
  expect(r).toMatchObject({ sw: true, url: 'http://127.0.0.1:47831', proto: 1, to: 180000, busy: false, inCard: true, inFooter: true,
    prev: 'adjExportTextBtn', next: 'ปิด', text: '🖥️ บันทึกลง PROMAXX', initialHidden: true });
  await closeApp(app);
});

test('2. ใครเห็นปุ่ม — pharmacist/supervisor Desktop เท่านั้น · PDA/assistant/ไม่ล็อกอิน/สวิตช์ปิด = ไม่เห็น', async ({ browser }) => {
  const app = await boot(browser);
  for (const [role, branch, want] of [['pharmacist', 'SRC', true], ['pharmacist', 'KKL', true], ['pharmacist', 'SSS', true], ['supervisor', 'WH', true],
    ['assistant', 'SRC', false], ['warehouse', 'WH', false], ['pharmacist', '', false]]) {
    await seed(app.page, { role, branch });
    expect((await btn(app.page)).shown, `${role}/${branch || '(ไม่มีสาขา)'}`).toBe(want);
  }
  await seed(app.page, {});
  expect((await btn(app.page)).shown).toBe(true);
  await app.page.evaluate(() => { ADJUST_DOC_PROMAXX = false; _refreshAdjPromaxxBtn(); });
  expect((await btn(app.page)).shown, 'สวิตช์ปิด = ไม่มีปุ่ม').toBe(false);
  await app.page.evaluate(() => { ADJUST_DOC_PROMAXX = true; _refreshAdjPromaxxBtn(); });
  expect((await btn(app.page)).shown).toBe(true);
  // เปิดป็อปอัพใหม่ตอนสวิตช์ปิด/เปิด — ปุ่มตามสวิตช์เสมอ
  await app.page.evaluate(() => { ADJUST_DOC_PROMAXX = false; openAdjustDocPopup(); });
  expect((await btn(app.page)).shown).toBe(false);
  await closeApp(app);

  // PDA (UA StockCountPDA): ไม่เห็นแม้ role ถูก
  const pda = await boot(browser, 'pda');
  await seed(pda.page, {});
  expect(await pda.page.evaluate(() => _isPdaApp())).toBe(true);
  expect((await btn(pda.page)).shown, 'PDA ไม่เห็นปุ่ม').toBe(false);
  expect(await pda.page.evaluate(() => _adjPromaxxEnabled())).toBe(false);
  await closeApp(pda);
});

test('3. ★ คำขอ — POST /v1/open-import · header ครบ · body = {proto,type} เท่านั้น · ชนิดตามแท็บ · targetAddressSpace', async ({ browser }) => {
  const s = await stub((body) => ({ json: OK(JSON.parse(body).type) }));
  const app = await boot(browser);
  await seed(app.page, { url: s.url });
  const infoLogs = []; app.page.on('console', (m) => { if (m.type() === 'info') infoLogs.push(m.text()); });
  expect((await btn(app.page)).title).toContain('ORDS (เอกสารจ่าย · O)');
  await click(app.page); await waitToast(app.page); await idle(app.page);
  await tab(app.page, 'irps');
  expect((await btn(app.page)).title, 'tooltip ตามแท็บ').toContain('IRPS (เอกสารรับ · I)');
  await click(app.page); await waitToast(app.page, 2); await idle(app.page);
  // รายละเอียดแต่ละขั้น (ms ต่อขั้น) อยู่ที่ console.info('[promaxx]', ชนิด, ผล) ให้ IT เปิด DevTools ดู — เอกสารอ้างถึง จึงตรึงไว้ (mutation WA35 รอดมาแล้ว)
  expect(infoLogs.filter((t) => t.startsWith('[promaxx]')).map((t) => t.split(' ')[1]), 'console.info ของแต่ละคำสั่ง').toEqual(['ORDS', 'IRPS']);

  const posts = s.posts();
  expect(posts.map((p) => p.body)).toEqual(['{"proto":1,"type":"ORDS"}', '{"proto":1,"type":"IRPS"}']);
  for (const p of posts) {
    expect(p.url).toBe('/v1/open-import');
    expect(p.headers['content-type']).toBe('application/json');
    expect(p.headers['x-anin-helper']).toBe('1');
    expect(p.headers.origin).toBe(BASE);
    expect(Object.keys(JSON.parse(p.body)).sort(), 'ส่งได้แค่ proto กับ type — ห้าม path/คำสั่ง/รหัสผ่าน').toEqual(['proto', 'type']);
  }
  // หมายเหตุ: ชุดเทสนี้เปิด request interception (lib/routes.js) — Chromium ข้าม CORS preflight เมื่อมี interception (ตรวจ 3 พ.ย. 2026: เซิร์ฟเวอร์เห็นแต่ POST)
  //   จึงดู preflight จากฝั่งหน้าเว็บตรงนี้ไม่ได้ · ที่ตรึงได้คือ "คำขอที่บังคับ preflight" (Content-Type JSON + header เอง → ข้างบน) · ข้อ 9 ใช้ Chromium เปล่าพิสูจน์ preflight จริง
  const f = await app.page.evaluate(() => window.__fetches);
  expect(f.map((x) => [x.method, x.tas, x.cache, x.sig])).toEqual([['POST', 'loopback', 'no-store', true], ['POST', 'loopback', 'no-store', true]]);
  expect(f[0].u).toBe(s.url + '/v1/open-import');
  await s.close(); await closeApp(app);
});

test('4. ★ ระหว่างทำงาน — ปุ่ม disabled + กดซ้ำไม่ยิงซ้ำ · สลับแท็บไม่เปลี่ยนชนิดที่สั่งไปแล้ว · จบแล้วคืนสภาพ (แม้ล้ม)', async ({ browser }) => {
  const s = await stub(async (body) => ({ json: OK(JSON.parse(body).type), delayMs: 700 }));
  const app = await boot(browser);
  await seed(app.page, { url: s.url });
  await click(app.page);
  await app.page.waitForFunction(() => _adjPromaxxBusy, null, { polling: 20 });
  const mid = await btn(app.page);
  expect(mid).toMatchObject({ disabled: true, text: '⏳ กำลังทำงาน…' });
  await click(app.page); await click(app.page);                    // กดซ้ำผ่านปุ่มจริง — ปุ่ม disabled: HTMLElement.click() ไม่ส่ง event เลย (ด่านที่ DOM)
  // เรียกฟังก์ชันตรงๆ ขณะกำลังทำงาน (Console/โค้ดส่วนอื่น/ปุ่มที่ถูกเปิดจาก DevTools) — ตัวกันต้องอยู่ที่โค้ด ไม่ใช่แค่ที่ปุ่ม disabled
  // (mutation WA02 รอดมาแล้ว: บรรทัดบนไม่เคยถึงฟังก์ชัน เพราะ .click() บนปุ่ม disabled เป็น no-op)
  await app.page.evaluate(() => { onAdjPromaxxClick(); onAdjPromaxxClick(); });
  await tab(app.page, 'irps');                                     // สลับแท็บระหว่างรอ
  await waitToast(app.page); await idle(app.page);
  expect(s.posts().length, 'ยิงครั้งเดียว').toBe(1);
  expect(JSON.parse(s.posts()[0].body).type).toBe('ORDS');
  const t = await toasts(app.page);
  expect(t).toHaveLength(1);
  expect(t[0].m, 'ข้อความอ้างชนิดที่สั่งไป (ORDS) ไม่ใช่แท็บปัจจุบัน').toContain('ORDS · เอกสารจ่าย · O');
  expect(await btn(app.page)).toMatchObject({ disabled: false, text: '🖥️ บันทึกลง PROMAXX' });
  // ล้ม (ตัวช่วยตอบ 500) แล้วต้องคืนสภาพและกดใหม่ได้
  await s.close();
  const s2 = await stub(() => ({ status: 500, json: ERR('STEP_FAILED', 'menu', 'x') }));
  await app.page.evaluate((u) => { PROMAXX_HELPER_URL = u; }, s2.url);
  await click(app.page); await waitToast(app.page, 2); await idle(app.page);
  expect(await btn(app.page)).toMatchObject({ disabled: false, text: '🖥️ บันทึกลง PROMAXX' });
  await click(app.page); await waitToast(app.page, 3); await idle(app.page);
  expect(s2.posts().length).toBe(2);
  await s2.close(); await closeApp(app);
});

test('5. ทุกรหัสที่ตัวช่วยตอบ → ข้อความและระดับที่ผู้ใช้เห็น', async ({ browser }) => {
  const app = await boot(browser);
  const CASES = [
    [() => ({ json: OK('ORDS') }), 'success', 'เปิดหน้า "นำเข้าไฟล์เอกสาร" แล้ว (ORDS · เอกสารจ่าย · O) — ยังไม่ได้นำเข้าข้อมูล'],
    [() => ({ status: 409, json: ERR('ALREADY_RUNNING') }), 'warn', 'ProMaxx เปิดอยู่แล้ว — ปิด ssmaxx.exe ก่อนแล้วกดใหม่'],
    [() => ({ status: 409, json: ERR('BUSY') }), 'warn', 'ตัวช่วยกำลังทำงานอยู่ — รอสักครู่'],
    [() => ({ status: 409, json: ERR('OTHER_BOT_RUNNING') }), 'warn', 'มีบอทอื่นใช้ ProMaxx อยู่ — รอให้จบก่อน'],
    [() => ({ status: 422, json: ERR('UNVERIFIED') }), 'warn', 'ตัวช่วยยังไม่ผ่านการตรวจหน้าต่างจริง (ปิดการคลิก)'],
    [() => ({ status: 422, json: ERR('NOT_CONFIGURED') }), 'warn', 'ตั้งค่าตัวช่วยไม่ครบ — ดูไฟล์ .env ข้าง PromaxxHelper'],
    [() => ({ status: 422, json: ERR('NO_DESKTOP') }), 'warn', 'ตัวช่วยไม่มีหน้าจอให้คลิก (ล็อกจออยู่?)'],
    [() => ({ status: 422, json: ERR('UNSUPPORTED_DPI') }), 'warn', 'ตั้ง Display Scaling เป็น 100% ก่อน'],
    [() => ({ status: 403, json: ERR('FORBIDDEN_ORIGIN') }), 'warn', 'ตัวช่วยไม่อนุญาตเว็บนี้ — ตรวจ HELPER_ALLOWED_ORIGINS'],
    [() => ({ status: 403, json: ERR('FORBIDDEN_HOST') }), 'warn', 'ตัวช่วยไม่อนุญาตเว็บนี้ — ตรวจ HELPER_ALLOWED_ORIGINS'],
    [() => ({ status: 400, json: ERR('PROTO_MISMATCH') }), 'warn', 'ตัวช่วยรุ่นไม่ตรง — อัปเดต PromaxxHelper'],
    [() => ({ status: 400, json: ERR('BAD_REQUEST') }), 'warn', 'ตัวช่วยรุ่นไม่ตรง — อัปเดต PromaxxHelper'],
    [() => ({ status: 500, json: ERR('LOGIN_FAILED', 'login') }), 'error', 'ล็อกอิน ProMaxx ไม่สำเร็จ — ตรวจรหัสในไฟล์ .env (ไม่ลองซ้ำ)'],
    [() => ({ status: 500, json: ERR('INTERFERENCE', 'login') }), 'error', 'คลิกไม่ได้ — อย่าแตะเมาส์ระหว่างทำงาน แล้วลองใหม่'],
    [() => ({ status: 500, json: ERR('UNEXPECTED_DIALOG', 'menu', 'ProMaxx แสดงกล่องข้อความ: ไม่มีสิทธิ์เข้าเมนูนี้') }), 'error', 'ProMaxx แสดงกล่องข้อความ: ไม่มีสิทธิ์เข้าเมนูนี้'],
    [() => ({ status: 500, json: ERR('LOCATOR_NOT_FOUND', 'menu', 'ไม่พบเมนู เอกสารจ่าย') }), 'error', 'ไม่สำเร็จที่ขั้น "เข้าเมนู" — ไม่พบเมนู เอกสารจ่าย'],
    [() => ({ status: 500, json: ERR('POSTCONDITION_FAILED', 'import-button', 'หน้าจอหลังคลิกไม่ขึ้นตามที่คาด ภายใน 20 วินาที') }), 'error',
      'ไม่สำเร็จที่ขั้น "กดปุ่มนำเข้าไฟล์เอกสาร" — หน้าจอหลังคลิกไม่ขึ้นตามที่คาด ภายใน 20 วินาที'],
    [() => ({ status: 500, json: ERR('SOMETHING_NEW', 'xyz', 'อะไรบางอย่าง') }), 'error', 'ไม่สำเร็จที่ขั้น "xyz" — อะไรบางอย่าง'],
    [() => ({ status: 500, json: ERR('SOMETHING_NEW', '', 'x') }), 'error', 'ไม่สำเร็จที่ขั้น "?" — x'],
    [() => ({ status: 502, raw: '<html>bad gateway</html>' }), 'warn', 'ตัวช่วยรุ่นไม่ตรง — อัปเดต PromaxxHelper'],
    [() => ({ status: 200, json: { ok: true } }), 'warn', 'ตัวช่วยรุ่นไม่ตรง — อัปเดต PromaxxHelper'],
    [() => ({ status: 200, json: { ...OK('ORDS'), proto: 2 } }), 'warn', 'ตัวช่วยรุ่นไม่ตรง — อัปเดต PromaxxHelper'],
  ];
  for (const [i, [fn, level, text]] of CASES.entries()) {
    const s = await stub(fn);
    await seed(app.page, { url: s.url });
    await click(app.page); await waitToast(app.page); await idle(app.page);
    const t = (await toasts(app.page))[0];
    expect([i, t.m, t.type], `เคส #${i}`).toEqual([i, text, level]);
    expect(t.ms, 'ต้องค้างนานกว่าเพดาน toast ต่อสแกน (3 วิ) ไม่ถูกรวม/ตัด').toBeGreaterThan(3000);
    await s.close();
  }
  // LAUNCH_FAILED ข้อความยาว (ต่อ SQL Server ไม่ได้): ใช้ข้อความของตัวช่วยแต่ถูกย่อด้วย _shortErr (≤70)
  const sl = await stub(() => ({ status: 500, json: ERR('LAUNCH_FAILED', 'launch', 'ProMaxx แสดงกล่องข้อความ: Microsoft SQL Server Login / Connection failed — ProMaxx ต่อฐานข้อมูลไม่ได้ ตรวจว่าเครื่อง SQL Server (BIGYAMAINPC) เปิดอยู่') }));
  await seed(app.page, { url: sl.url });
  await click(app.page); await waitToast(app.page); await idle(app.page);
  const tl = (await toasts(app.page))[0];
  expect(tl.type).toBe('error');
  expect(tl.m.startsWith('ProMaxx แสดงกล่องข้อความ: Microsoft SQL Server Login')).toBe(true);
  expect(tl.m.endsWith('…'), 'ข้อความยาวถูกย่อ').toBe(true);
  expect([...tl.m].length).toBeLessThanOrEqual(72);
  await sl.close();
  // ชนิด IRPS ในข้อความสำเร็จ
  const si = await stub((b) => ({ json: OK(JSON.parse(b).type) }));
  await seed(app.page, { url: si.url });
  await tab(app.page, 'irps');
  await click(app.page); await waitToast(app.page); await idle(app.page);
  expect((await toasts(app.page))[0].m).toBe('เปิดหน้า "นำเข้าไฟล์เอกสาร" แล้ว (IRPS · เอกสารรับ · I) — ยังไม่ได้นำเข้าข้อมูล');
  await si.close();
  await closeApp(app);
});

test('6. ตัวช่วยไม่เปิด / เบราว์เซอร์บล็อก / หมดเวลา — ข้อความถูก · หน้าไม่พัง · กดใหม่ได้', async ({ browser }) => {
  const app = await boot(browser);
  // ไม่มีตัวช่วยฟังที่พอร์ตนั้น (พอร์ตปิด)
  const dead = await stub(); const deadUrl = dead.url; await dead.close();
  await seed(app.page, { url: deadUrl });
  await click(app.page); await waitToast(app.page); await idle(app.page);
  expect((await toasts(app.page))[0]).toMatchObject({ m: 'ไม่พบ PromaxxHelper บนเครื่องนี้ — เปิดตัวช่วยก่อน', type: 'warn' });
  expect(await btn(app.page)).toMatchObject({ disabled: false, text: '🖥️ บันทึกลง PROMAXX' });
  // เบราว์เซอร์รายงานสิทธิ์ loopback-network = denied → บอกวิธีเปิดสิทธิ์
  await app.page.evaluate(() => {
    Object.defineProperty(navigator, 'permissions', { configurable: true, value: { query: async (d) => { window.__permQuery = d; return { state: 'denied' }; } } });
    window.__toasts = [];
  });
  await click(app.page); await waitToast(app.page); await idle(app.page);
  expect((await toasts(app.page))[0]).toMatchObject({ m: 'เบราว์เซอร์บล็อกตัวช่วย — เปิดสิทธิ์ Local network ใน Site settings', type: 'warn' });
  expect(await app.page.evaluate(() => window.__permQuery), 'ถามสิทธิ์ด้วยชื่อ loopback-network').toEqual({ name: 'loopback-network' });
  // เบราว์เซอร์ไม่รู้จักชื่อสิทธิ์ (query ทิ้ง error) → ไม่ทราบ → ถือว่าตัวช่วยไม่เปิด (ไม่พัง)
  await app.page.evaluate(() => {
    Object.defineProperty(navigator, 'permissions', { configurable: true, value: { query: async () => { throw new TypeError('unknown permission'); } } });
    window.__toasts = [];
  });
  await click(app.page); await waitToast(app.page); await idle(app.page);
  expect((await toasts(app.page))[0].m).toBe('ไม่พบ PromaxxHelper บนเครื่องนี้ — เปิดตัวช่วยก่อน');
  // สำเร็จก่อนหมดเวลา → timer ต้องถูกล้าง: ไม่งั้น abort() ยิงตามหลังคำขอที่จบไปแล้ว (timer ค้างนาน 3 นาทีต่อการกดหนึ่งครั้ง · mutation WA47 รอดมาแล้ว)
  const quick = await stub((body) => ({ json: OK(JSON.parse(body).type) }));
  await seed(app.page, { url: quick.url, timeout: 300 });
  await app.page.evaluate(() => {
    window.__aborts = 0; const real = AbortController.prototype.abort;
    AbortController.prototype.abort = function (...a) { window.__aborts++; return real.apply(this, a); };
  });
  await click(app.page); await waitToast(app.page); await idle(app.page);
  await app.page.waitForTimeout(700);                             // รอให้เลย timeout (300ms) ไปแล้ว — รอ "ไม่เกิดเหตุการณ์" จึงต้องรอเวลาตายตัว
  expect(await app.page.evaluate(() => window.__aborts), 'หลังสำเร็จ timer ถูกล้าง — ไม่มี abort() ตามมา').toBe(0);
  await quick.close();
  // หมดเวลา: ตัวช่วยค้าง → ยกเลิกคำขอ → ข้อความ + ปุ่มคืนสภาพ
  const slow = await stub(() => ({ json: OK('ORDS'), delayMs: 3000 }));
  await seed(app.page, { url: slow.url, timeout: 400 });
  await click(app.page); await waitToast(app.page); await idle(app.page);
  expect((await toasts(app.page))[0]).toMatchObject({ m: 'ตัวช่วยไม่ตอบใน 3 นาที — ดูหน้าต่าง ProMaxx และ log ของตัวช่วย', type: 'error' });
  expect(await btn(app.page)).toMatchObject({ disabled: false, text: '🖥️ บันทึกลง PROMAXX' });
  await slow.close();
  // ไม่ล็อกอิน/สวิตช์ปิดแล้วกด (เรียกฟังก์ชันตรง) = ไม่ทำอะไร ไม่ยิงคำขอ
  const s = await stub();
  await seed(app.page, { url: s.url, role: 'assistant' });
  await app.page.evaluate(() => onAdjPromaxxClick());
  await seed(app.page, { url: s.url }); await app.page.evaluate(() => { ADJUST_DOC_PROMAXX = false; return onAdjPromaxxClick(); });
  expect(s.hits.length, 'ไม่มีสิทธิ์/สวิตช์ปิด → ไม่ยิงคำขอเลย').toBe(0);
  await s.close(); await closeApp(app);
});

test('7. toast ไม่ล้นหน้าต่างครึ่งจอ (960px) ในกรณียาวสุด · ฟุตเตอร์ 📦 ไม่ล้นที่ 960px', async ({ browser }) => {
  const app = await boot(browser);
  const widths = await app.page.evaluate(() => {
    const OKd = (type) => ({ ok: true, proto: 1, type });
    const long = 'ProMaxx แสดงกล่องข้อความ: Microsoft SQL Server Login / Connection failed SQLState 08001 — ProMaxx ต่อฐานข้อมูลไม่ได้ ตรวจว่าเครื่อง SQL Server (BIGYAMAINPC) เปิดอยู่';
    const samples = [
      _adjPromaxxMessage({ data: OKd('IRPS') }, 'IRPS'), _adjPromaxxMessage({ data: OKd('ORDS') }, 'ORDS'),
      _adjPromaxxMessage({ err: 'denied' }), _adjPromaxxMessage({ err: 'unreachable' }), _adjPromaxxMessage({ err: 'timeout' }), _adjPromaxxMessage({ err: 'bad' }),
      ...Object.keys(_PROMAXX_CODE_MSG).map((code) => _adjPromaxxMessage({ data: { ok: false, proto: 1, code, step: 'x', message: 'm' } }, 'ORDS')),
      _adjPromaxxMessage({ data: { ok: false, proto: 1, code: 'LAUNCH_FAILED', step: 'launch', message: long } }, 'ORDS'),
      _adjPromaxxMessage({ data: { ok: false, proto: 1, code: 'UNEXPECTED_DIALOG', step: 'menu', message: long } }, 'ORDS'),
      ...Object.keys(_PROMAXX_STEP_TH).map((step) => _adjPromaxxMessage({ data: { ok: false, proto: 1, code: 'STEP_FAILED', step, message: long } }, 'ORDS')),
    ];
    return samples.map((s) => {
      const c = document.getElementById('toastContainer'); c.innerHTML = '';
      toast(s.text, s.level, 9000);
      const el = c.lastElementChild; el.style.animation = 'none';
      return [Math.round(el.getBoundingClientRect().width), s.text];
    });
  });
  expect(widths.length).toBeGreaterThanOrEqual(25);
  for (const [w, m] of widths) expect(w, m).toBeLessThanOrEqual(960);
  // ฟุตเตอร์ 📦 ที่ 960px: ปุ่มทุกปุ่มอยู่ในกรอบการ์ด (ล้นแนวนอน = แถวปุ่มยาวเกิน — ต้องห่อบรรทัดแทน)
  await app.page.setViewportSize({ width: 960, height: 800 });
  await seed(app.page, {});
  const foot = await app.page.evaluate(() => {
    const card = document.getElementById('adjustDocPopupCard').getBoundingClientRect();
    const bs = [...document.querySelectorAll('#adjustDocPopupCard .stock-popup-footer button')].filter((b) => b.offsetParent !== null);      // เฉพาะปุ่มที่มองเห็นจริง (pager ซ่อนอยู่เมื่อ ≤ 20 แถว)
    return { n: bs.length, over: bs.filter((b) => { const r = b.getBoundingClientRect(); return r.right > card.right + 0.5 || r.left < card.left - 0.5; }).map((b) => b.textContent.trim()),
      lines: bs.map((b) => Math.round(b.getBoundingClientRect().height)) };
  });
  expect(foot.n).toBeGreaterThanOrEqual(5);      // บันทึก LOT · Excel · Text · PROMAXX · ปิด (+ pager ถ้ามี)
  expect(foot.over, 'ปุ่มล้นกรอบการ์ดที่ 960px').toEqual([]);
  expect(Math.max(...foot.lines), 'ปุ่มไม่ขึ้นสองบรรทัด (nowrap)').toBeLessThan(40);
  await closeApp(app);
});

test('8. ★ ตัวช่วยจริง (Python + ตัวต่อปลอม ssmaxx) ผ่าน CORS ใน Chromium — สำเร็จ · กดซ้ำ ALREADY_RUNNING · origin ไม่อยู่ใน list = เบราว์เซอร์บล็อก', async ({ browser }) => {
  const srv = await startServer({ origins: [BASE] });
  try {
    const app = await boot(browser);
    await seed(app.page, { url: srv.origin });
    await tab(app.page, 'irps');
    await click(app.page); await waitToast(app.page); await idle(app.page);
    expect((await toasts(app.page))[0]).toMatchObject({ m: 'เปิดหน้า "นำเข้าไฟล์เอกสาร" แล้ว (IRPS · เอกสารรับ · I) — ยังไม่ได้นำเข้าข้อมูล', type: 'success' });
    const h = await srv.request({ path: '/v1/health' });
    expect(h.json).toMatchObject({ ssmaxxRunning: true, busy: false });
    await click(app.page); await waitToast(app.page, 2); await idle(app.page);
    expect((await toasts(app.page))[1], 'ProMaxx ค้างเปิดอยู่ → ปฏิเสธ (ผู้ใช้เลือก)').toMatchObject({ m: 'ProMaxx เปิดอยู่แล้ว — ปิด ssmaxx.exe ก่อนแล้วกดใหม่', type: 'warn' });
    await closeApp(app);
  } finally { await srv.stop(); }

  // origin ของหน้าเว็บไม่อยู่ใน allow-list ของตัวช่วย (ค่าเริ่มต้น = prod เท่านั้น) → preflight ถูก 403 → เบราว์เซอร์บล็อก → หน้าเห็นว่า "ติดต่อไม่ได้"
  const strict = await startServer({});
  try {
    const app = await boot(browser);
    await seed(app.page, { url: strict.origin });
    await click(app.page); await waitToast(app.page); await idle(app.page);
    expect((await toasts(app.page))[0]).toMatchObject({ m: 'ไม่พบ PromaxxHelper บนเครื่องนี้ — เปิดตัวช่วยก่อน', type: 'warn' });
    const h = await strict.request({ path: '/v1/health' });
    expect(h.json.ssmaxxRunning, 'ตัวช่วยไม่ถูกสั่งงานเลย').toBe(false);
    await closeApp(app);
  } finally { await strict.stop(); }
});

// ดึงซอร์สฟังก์ชัน async จาก index.html จริงด้วยการนับวงเล็บปีกกา (ฟังก์ชันที่ดึงต้องไม่มี { } ในสตริง/regex/template)
function extractFn(src, name) {
  const i = src.indexOf(`async function ${name}(`);
  if (i < 0) throw new Error('ไม่พบฟังก์ชัน ' + name + ' ใน index.html');
  let depth = 0, k = src.indexOf('{', i);
  for (; k < src.length; k++) { if (src[k] === '{') depth++; else if (src[k] === '}' && --depth === 0) break; }
  return src.slice(i, k + 1);
}

test('9. ★ Chromium เปล่า (ไม่มี interception) + โค้ด _adjPromaxxCall จาก index.html จริง + ตัวช่วยจริง — preflight/CORS/PNA ทำงานจริง · origin ไม่อยู่ใน list = POST ไม่ถูกส่งเลย', async ({ browser }) => {
  const src = fs.readFileSync(path.resolve(__dirname, '..', '..', '..', 'index.html'), 'utf8');
  const fnSrc = ['_adjPromaxxPermission', '_adjPromaxxCall'].map((n) => extractFn(src, n)).join('\n');
  const pageSrv = http.createServer((q, r) => {
    r.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    r.end(`<!doctype html><html><body><script>
      let PROMAXX_HELPER_URL='';const PROMAXX_HELPER_PROTO=1;let PROMAXX_HELPER_TIMEOUT_MS=20000;
      ${fnSrc}
      window.setUrl=(u)=>{PROMAXX_HELPER_URL=u};window.run=(t)=>_adjPromaxxCall(t);
    </script></body></html>`);
  });
  await new Promise((r) => pageSrv.listen(0, '127.0.0.1', r));
  const pageOrigin = 'http://127.0.0.1:' + pageSrv.address().port;
  const ctx = await browser.newContext();          // ธรรมดา — ไม่มี route interception (Chromium ส่ง preflight จริง)
  const logOf = (srv) => fs.readFileSync(path.join(srv.tmp, 'helper.log'), 'utf8');
  try {
    // origin ของหน้าอยู่ใน allow-list → preflight 204 แล้ว POST 200
    const ok = await startServer({ origins: [pageOrigin] });
    try {
      const page = await ctx.newPage();
      await page.goto(pageOrigin + '/');
      await page.evaluate((u) => setUrl(u), ok.origin);
      const r = await page.evaluate(() => run('IRPS'));
      expect(r.status).toBe(200);
      expect(r.data).toMatchObject({ ok: true, proto: 1, type: 'IRPS', reached: 'import-button' });
      const log = logOf(ok);
      expect(log, 'ต้องมี preflight ก่อน POST (คำขอ JSON + header เอง)').toMatch(/OPTIONS \/v1\/open-import origin=\S+ → 204[\s\S]*POST \/v1\/open-import origin=\S+ → 200/);
      await page.close();
    } finally { await ok.stop(); }
    // origin ไม่อยู่ใน list → preflight ถูก 403 → เบราว์เซอร์ไม่ส่ง POST → ไม่ถูกสั่งงาน
    const strict = await startServer({});
    try {
      const page = await ctx.newPage();
      await page.goto(pageOrigin + '/');
      await page.evaluate((u) => setUrl(u), strict.origin);
      const r = await page.evaluate(() => run('ORDS'));
      expect(r).toEqual({ err: 'unreachable' });
      const log = logOf(strict);
      expect(log).toMatch(/OPTIONS \/v1\/open-import origin=\S+ → 403/);
      expect(log, 'เบราว์เซอร์ต้องไม่ส่ง POST ถ้า preflight ไม่ผ่าน').not.toMatch(/POST \/v1\/open-import/);
      expect((await strict.request({ path: '/v1/health' })).json.ssmaxxRunning).toBe(false);
      await page.close();
    } finally { await strict.stop(); }
  } finally { await ctx.close(); pageSrv.close(); }
});
