// ใบ 📦 ปรับปรุงสินค้า: ปุ่ม 🖥️ "บันทึกลง PROMAXX" — นำเข้าอัตโนมัติ (4 พ.ย. 2026 · ผู้ใช้สั่ง · ตัวช่วยรุ่น .6 · เฉพาะสาขายา SRC/KKL/SSS — WH ไม่ใช้)
//   2 จังหวะ: กดปุ่ม → /v1/prepare-import (ตัวช่วยเปิดฟอร์ม+อ่านเลขที่เอกสาร) → ป็อปอัพ "ระบุเลขที่เอกสาร" ใส่เลขจาก ProMaxx ให้ (แก้ไม่ได้) → พนักงานกดยืนยันปุ่มเดียว
//   → เขียน 🗂️ ประวัติก่อน → /v1/run-import {ticket,docNo,rows,sha256,text} → ตัวช่วยเขียนไฟล์/เลือกไฟล์/เทียบตาราง/(กด ตกลง) · สวิตช์ ADJUST_DOC_PROMAXX_AUTO (false = เส้นทางเดิม)
//
// เทสนี้ตรึง 17 ด้าน (19 ข้อ = ข้อ 1–17 + 2b + 11b) — ข้อ 2 · 6 · 7 · 16 สำคัญที่สุด: "ประวัติถูกเขียนก่อนสั่ง ERP" · "ล้มแบบยืนยันได้ว่ายังไม่ตกลง = คืนแถวเอง" · "ไม่แน่ชัด = คงไว้ใน 🗂️ + ไฟล์ให้นำเข้าเอง" · "หน้าเว็บ ↔ ตัวช่วยจริงทั้งสาย"
//   1. ค่าที่ส่งมอบ + โครง modal (id ใหม่) · เส้นทางเดิมไม่ถูกแตะ (Export Text ปกติ: ช่องแก้ได้ ปุ่ม ⬇️ ดาวน์โหลด ข้อความเดิม ปิดด้วยคลิกฉากหลังได้)
//   2. ★ สำเร็จ (ตัวช่วยกด ตกลง): คำขอ prepare/run ครบทุก field · ไฟล์ = เนื้อเดียวกับ Export Text (CRLF) + sha256 ตรง · ประวัติเขียน "ก่อน" run-import · แถวย้ายไป 🗂️ · ไม่ดาวน์โหลดไฟล์
//   3. สำเร็จแบบหยุดก่อน ตกลง (autoConfirm=false): ป้าย/ข้อความ/toast ต่างกันตามที่ตัวช่วยตั้งไว้
//   4. ★ ยกเลิก: ปุ่ม/Esc/ปิด 📦 = ส่ง cancel-import + ไม่เขียนอะไร · คลิกฉากหลัง/Enter ไม่ทำอะไร (กันเผลอ) · ยกเลิกแล้วกดใหม่ได้
//   5. prepare ล้ม: ทุกรหัส → ข้อความ · ไม่เปิด modal ไม่เขียนประวัติ · ตัวช่วยรุ่นเก่า (404/ตัดการเชื่อมต่อ+health) · ตัวช่วยตอบนอกสัญญา → ยกเลิกตั๋ว
//   6. ★ run-import ล้มแบบยืนยันได้ว่ายังไม่ตกลง → คืนแถวกลับตารางเอง (ลบประวัติ) · คืนไม่สำเร็จ = บอกให้กด ↩
//   7. ★ run-import ไม่แน่ชัด (ขั้น ตกลง/INTERNAL/หมดเวลา/ตอบผิด/ตัวช่วยหยุดตอบ) → คงไว้ใน 🗂️ + ปุ่มดาวน์โหลดไฟล์ (เนื้อไฟล์ = ที่ส่ง)
//   8. เขียนประวัติไม่ผ่าน (cloud ล้ม) → ไม่สั่ง ERP · modal คงอยู่ · ตั๋วคงอยู่ · แก้แล้วกดซ้ำสำเร็จ
//   9. เลขที่ของ ProMaxx ซ้ำกับประวัติ → แจ้ง ไม่สั่ง ERP
//  10. รายการเปลี่ยนระหว่างรอยืนยัน (ลายนิ้วมือ) → แจ้ง ไม่ส่งของที่ไม่ได้เห็น · กดซ้ำส่งชุดใหม่
//  11. สลับแท็บระหว่างรอ ProMaxx → ยกเลิกตั๋ว ไม่เปิด modal
//  12. ตรวจไฟล์ก่อนแตะ ProMaxx: ราคา/LOT ผิดรูปแบบ · เกิน 20 รายการ · ไม่มีรายการ = ไม่ยิงคำขอเลย
//  13. ตั๋วหมดอายุฝั่งเว็บ · แถวทับกับเอกสารของอีกเครื่อง → ไม่ส่ง ERP + ยกเลิกตั๋ว
//  14. ประวัติปิด → เส้นทางเดิม (open-import) · WH ไม่เห็น/เรียกตรงก็ไม่ทำอะไร
//  15. parity: ตัวตรวจไฟล์ฝั่งเว็บ (_adjPromaxxCheckText) ตรงกับ parse_import_text ของตัวช่วยจริง (fuzz + เคสขอบ)
//  16. ★ ตัวช่วยจริง (Python) + ตัวต่อปลอม ProMaxx แบบ WPF/UIA + หน้าเว็บจริงใน Chromium: สำเร็จ · หยุดก่อนตกลง · ตารางไม่ตรง → ไม่กด ตกลง + คืนแถว · สาขาใน ProMaxx ไม่ตรง
//  17. toast ของเส้นทางนี้ไม่ล้นหน้าต่างครึ่งจอ (960px) ในกรณียาวสุด
const http = require('http');
const crypto = require('crypto');
const { test, expect, newAppContext, waitForAppReady, closeApp } = require('../../lib/hooks');
const { startServer, runPy } = require('../../lib/promaxx-helper-harness');

const BASE = 'http://127.0.0.1:4173';
const DOC = 'ORDSBY001261100001';
const EPOCH = '2026-09-20T00:00:00.000Z';
const T = '2026-09-20 09:00:00';
const HIST_KEY = 'stock_sessions/SRC_adjhist';
// Stock Adj ตรงของสาขายา (ตัวเลขแช่ไว้ตอน Confirm) — ผลต่าง = effectiveQty − systemQty
const DIRECT = (extra = {}) => ({ status: 'stock_adjustment', auditStatus: 'stock_adjustment', initialStatus: 'stock_adjustment', auditor: '',
  countedQty: 8, timestamp: T, firstScanAt: T, scannedBy: 'Asst', directAdj: true, ...extra });
const PREP = (o = {}) => ({ ok: true, proto: 1, version: 'x', stage: 'prepared', type: 'ORDS', branch: 'SRC', docNo: DOC, ticket: 'TICKET-1', expiresInSec: 600, autoConfirm: true, elapsedMs: 1200, steps: [], ...o });
const IMP = (o = {}) => ({ ok: true, proto: 1, version: 'x', stage: 'imported', type: 'ORDS', branch: 'SRC', docNo: DOC, rows: 20, file: 'f.txt', confirmed: true, elapsedMs: 3000, steps: [], ...o });
const ERR = (code, step = 'preflight', message = 'ข้อความจากตัวช่วย') => ({ ok: false, proto: 1, version: 'x', code, step, message, steps: [] });
const pad = (n) => String(n).padStart(3, '0');
const O = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => 'O' + pad(a + i));
// บรรทัดไฟล์ Text (รูปแบบ Export Text ที่ ProMaxx นำเข้า: SKU⇥จำนวน⇥ราคา⇥×6⇥LOT⇥EXP) — เขียนแยกจากโค้ดแอปเพื่อเป็นข้อกำหนดอิสระ
const LINE = (sku, qty, price = '', lot = '', exp = '') => `${sku}\t${qty}\t${price}\t\t\t\t\t\t${lot}\t${exp}`;
const FILE = (lines) => lines.join('\r\n') + '\r\n';
const SHA = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');
// ไฟล์ที่คาดหวังของหน้า 1 (O001–O020) เมื่อ seed({priced:true}): O001 มีราคา 12.5 · O002 เลือก LOT-A1 · ที่เหลือว่าง
const PAGE1 = O(1, 20).map((s) => (s === 'O001' ? LINE(s, 2, '12.5') : s === 'O002' ? LINE(s, 2, '', 'LOT-A1') : LINE(s, 2)));

async function boot(browser, mode = 'desktop') {
  const app = await newAppContext(browser, { login: false, mode });
  await app.page.goto('/index.html');
  await waitForAppReady(app.page, { login: false });
  return app;
}

// เซิร์ฟเวอร์จำลองตัวช่วย: routes[path](body, req) → { status?, json?, raw?, delayMs?, drop? } · ตอบ preflight/CORS · GET /v1/health
async function stub(routes = {}, { origin = BASE, health } = {}) {
  const hits = [];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const srv = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      let json = null; try { json = JSON.parse(raw); } catch (e) { /* ไม่มี body */ }
      const p = req.url.split('?')[0];
      hits.push({ method: req.method, path: p, headers: req.headers, raw, json });
      const cors = { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' };
      if (req.method === 'OPTIONS') {
        res.writeHead(204, { ...cors, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, X-Anin-Helper',
          'Access-Control-Allow-Private-Network': 'true', 'Access-Control-Max-Age': '0' });
        return res.end();
      }
      if (req.method === 'GET' && p === '/v1/health') {
        res.writeHead(200, { ...cors, 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify(health || { ok: true, proto: 1, version: 'x', autoImport: true }));
      }
      const fn = routes[p];
      const r = (fn ? await fn(json, req) : { status: 404, json: ERR('NOT_FOUND', '', 'ไม่พบเส้นทาง') }) || {};
      if (r.delayMs) await sleep(r.delayMs);
      if (r.drop) { req.socket.destroy(); return; }
      if (r.raw !== undefined) { res.writeHead(r.status || 200, { ...cors, 'Content-Type': 'text/html' }); return res.end(r.raw); }
      res.writeHead(r.status || 200, { ...cors, 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(r.json));
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  return { port, url: 'http://127.0.0.1:' + port, hits, posts: (p) => hits.filter((h) => h.method === 'POST' && (!p || h.path === p)),
    close: () => new Promise((r) => { srv.closeAllConnections && srv.closeAllConnections(); srv.close(r); }) };
}

// เตรียมหน้า: ล็อกอินจำลอง + fake Firestore (เฉพาะที่ 🗂️ ประวัติใช้) + จับ toast/ดาวน์โหลด · nO แถว ORDS (O001…: นับ 8 ระบบ 10 = ลด 2) + nI แถว IRPS (I001…: เกิน 3)
async function seed(page, { url, nO = 25, nI = 5, role = 'pharmacist', branch = 'SRC', timeout, pageSize = 20, auto = true, history = true, priced = true } = {}) {
  await page.evaluate(({ url, nO, nI, role, branch, timeout, pageSize, auto, history, priced, tpl, epoch }) => {
    ADJUST_DOC_PAGE_SIZE = pageSize; ADJUST_DOC_QTY_EDIT = true; ADJUST_DOC_EXPORT_TEXT_BY_PAGE = true; ADJUST_DOC_HISTORY = history;
    ADJUST_DOC_PROMAXX = true; ADJUST_DOC_PROMAXX_AUTO = auto;
    currentBranch = branch; currentRole = role; currentUser = 'Pharm'; _countResetAt = epoch;
    _branchScanPaused = false; _adjDocFilter = 'ords'; _adjDocPage = 1; _adjLoading = false;
    _adjHist = null; _adjHistReadToken++; _adjHistBusy = false; _adjHistExpanded.clear(); _adjHistUndoArm = ''; _adjErp = null; _adjErpFilter = 'all';
    _adjPromaxxBusy = false; _adjPromaxxCtx = null;
    PROMAXX_HELPER_URL = url || 'http://127.0.0.1:1'; PROMAXX_HELPER_TIMEOUT_MS = timeout || 180000;
    _lotMap.clear(); _lotSelected.clear(); _priceMap.clear();
    state.skuMap.clear(); state.scanData.clear(); state.skuDirectMap.clear(); scanListMap.clear();
    document.getElementById('adjustDocPopupOverlay').style.display = 'flex';
    document.getElementById('adjHistPopupOverlay').style.display = 'none'; document.getElementById('adjDocNoModal').style.display = 'none';
    window.__marked = []; _markSkuDirty = (s) => { window.__marked.push(String(s)); };
    window.__toasts = []; window.__actions = []; window.__actionFns = []; window.__afterRun = window.__afterRun || 0;
    toast = (m, type, ms) => { window.__toasts.push({ m: String(m), type, ms }); };
    toastAction = (m, label, fn, type, ms) => { window.__actions.push({ m: String(m), label, type, ms }); window.__actionFns.push(fn); };
    if (!window.__wrapAfter) {                                   // นับรอบที่ _adjPromaxxAfterRun จบ (รอ "สรุปผลเสร็จ" ได้แน่นอน · ห่อครั้งเดียว)
      window.__wrapAfter = true;
      const orig = _adjPromaxxAfterRun;
      _adjPromaxxAfterRun = async (...a) => { try { return await orig(...a); } finally { window.__afterRun++; } };
    }
    _refreshAdjMaster = async () => {};
    window.__exports = []; window.__downloads = [];
    URL.createObjectURL = (b) => { window.__exports.push(b); return 'blob:captured'; };
    URL.revokeObjectURL = () => {};
    HTMLAnchorElement.prototype.click = function () { window.__downloads.push(this.download); };
    window.__store = {}; window.__fail = null; window.__writes = 0;
    const doc = (p) => ({ path: p, get: async () => { const d = window.__store[p]; return { exists: !!d, data: () => d }; } });
    _db = {
      collection: (c) => ({ doc: (id) => doc(c + '/' + id) }),
      runTransaction: async (fn) => {
        if (window.__fail) throw new Error(window.__fail);
        let pending = null;
        await fn({ get: async (r) => { const d = window.__store[r.path]; return { exists: !!d, data: () => d }; }, set: (r, data) => { pending = [r.path, data]; } });
        if (pending) { window.__writes++; window.__store[pending[0]] = { ...pending[1], updatedAt: { toDate: () => new Date('2026-11-04T09:05:00.000Z') } }; }
      },
    };
    const add = (sku, eff) => {
      state.skuMap.set(sku, { sku, productName: 'สินค้า ' + sku, unitPrice: 20, systemQty: 10, negSys: false, barcodes: [], isDel: false });
      state.skuDirectMap.set(sku, { barcode: 'B' + sku, unitName: 'เม็ด' });
      state.scanData.set(sku, { ...tpl, effectiveQty: eff, systemQty: 10 });
    };
    for (let i = 1; i <= nO; i++) add('O' + String(i).padStart(3, '0'), 8);
    for (let i = 1; i <= nI; i++) add('I' + String(i).padStart(3, '0'), 13);
    if (priced) {
      _priceMap.set('O001', { unit: 'เม็ด', price: '12.5' });
      _lotMap.set('O002', [{ lot: 'LOT-A1', exp: '' }]); _lotSelected.set('O002', 'LOT-A1');
    }
    renderAdjustDocTable(true); updateAdjustDocCount(); _refreshAdjPromaxxBtn();
  }, { url, nO, nI, role, branch, timeout, pageSize, auto, history, priced, tpl: DIRECT(), epoch: EPOCH });
}

const click = (page) => page.evaluate(() => document.getElementById('adjPromaxxBtn').click());           // ผ่าน onclick จริงของปุ่ม
const okClick = (page) => page.evaluate(() => document.getElementById('adjDocNoOk').click());
const cancelClick = (page) => page.evaluate(() => [...document.querySelectorAll('#adjDocNoCard button')].find((b) => b.textContent.trim() === 'ยกเลิก').click());
const modalOpen = (page) => page.waitForFunction(() => document.getElementById('adjDocNoModal').style.display === 'flex', null, { polling: 30, timeout: 20000 });
const idle = (page) => page.waitForFunction(() => !_adjPromaxxBusy && !_adjHistBusy, null, { polling: 30, timeout: 20000 });
const settled = (page) => page.waitForFunction(() => !_adjHistBusy, null, { polling: 30, timeout: 20000 });
const afterRun = (page, n = 1) => page.waitForFunction((n) => window.__afterRun >= n, n, { polling: 30, timeout: 20000 });
const toastsOf = (page) => page.evaluate(() => window.__toasts.slice());
const actionsOf = (page) => page.evaluate(() => window.__actions.slice());
const modal = (page) => page.evaluate(() => {
  const g = (id) => document.getElementById(id);
  return { open: g('adjDocNoModal').style.display === 'flex', summary: g('adjDocNoSummary').textContent, value: g('adjDocNoInput').value, readOnly: g('adjDocNoInput').readOnly,
    err: g('adjDocNoErr').textContent, errColor: g('adjDocNoErr').style.color, ok: g('adjDocNoOk').textContent, okDisabled: g('adjDocNoOk').disabled, note: g('adjDocNoNote').textContent };
});
const skus = (page) => page.evaluate(() => [...document.querySelectorAll('#adjustDocBody tr')].filter((tr) => tr.children.length > 1).map((tr) => tr.children[1].textContent.trim()));
const rowCount = (page) => page.evaluate(() => document.getElementById('adjustDocRowCount').textContent);
const store = (page, key = HIST_KEY) => page.evaluate((k) => { const d = window.__store[k]; return d ? { epoch: d.countResetAt, by: d.updatedBy, entries: JSON.parse(d.entries_json) } : null; }, key);
const btn = (page) => page.evaluate(() => { const b = document.getElementById('adjPromaxxBtn'); return { shown: b.style.display !== 'none' && getComputedStyle(b).display !== 'none', text: b.textContent, disabled: b.disabled }; });
const downloads = (page) => page.evaluate(() => window.__downloads.slice());
const lastDownloadText = (page) => page.evaluate(() => (window.__exports.length ? window.__exports[window.__exports.length - 1].text() : null));
const state0 = (page) => page.evaluate(() => ({ ctx: _adjPromaxxCtx, busy: _adjPromaxxBusy, histBusy: _adjHistBusy }));

// prepare → modal เปิดแล้ว (ใช้ซ้ำในหลายเทส)
async function prepared(page) { await click(page); await modalOpen(page); }

test('1. ค่าที่ส่งมอบ + โครง modal · เส้นทางเดิม (Export Text) ไม่ถูกแตะ — ช่องแก้ได้ · ปุ่ม ⬇️ ดาวน์โหลด · คลิกฉากหลังปิดได้', async ({ browser }) => {
  const app = await boot(browser);
  const r = await app.page.evaluate(() => ({
    auto: ADJUST_DOC_PROMAXX_AUTO, max: PROMAXX_IMPORT_MAX_ROWS, ctx: _adjPromaxxCtx,
    ids: ['adjDocNoTitle', 'adjDocNoSummary', 'adjDocNoInput', 'adjDocNoNote', 'adjDocNoErr', 'adjDocNoOk'].map((id) => !!document.getElementById(id)),
    ws: getComputedStyle(document.getElementById('adjDocNoSummary')).whiteSpace,
    fns: ['_adjPromaxxAutoStart', '_adjPromaxxAutoConfirm', '_adjPromaxxAfterRun', '_adjPromaxxCheckText', '_adjSha256Hex', '_adjPromaxxPost', '_adjPromaxxHealth'].map((n) => typeof window[n]),
  }));
  expect(r).toMatchObject({ auto: true, max: 20, ctx: null, ids: Array(6).fill(true), ws: 'pre-line', fns: Array(7).fill('function') });

  // Export Text ปกติ: ไม่มี pm → ช่องแก้ได้ · ปุ่ม/ข้อความเดิม · คลิกฉากหลังปิดได้ · ไม่มีตั๋ว
  await seed(app.page, { url: 'http://127.0.0.1:1' });
  await app.page.evaluate(() => { document.getElementById('adjExportTextBtn').click(); });
  await modalOpen(app.page);
  const m = await modal(app.page);
  expect(m).toMatchObject({ open: true, readOnly: false, value: '', ok: '⬇️ ดาวน์โหลด', err: '' });
  expect(m.note).toBe('ต้องกรอกก่อนจึงดาวน์โหลดได้ · หลังดาวน์โหลด รายการชุดนี้จะย้ายไป 🗂️ ประวัติปรับปรุงและหายจากตาราง');
  expect(m.summary).toBe('ORDS · 20 รายการ · หน้า 1/2 (แถวที่ 1–20 จาก 25)');
  await app.page.evaluate(() => document.getElementById('adjDocNoModal').click());       // target = ฉากหลัง
  expect((await modal(app.page)).open).toBe(false);
  expect((await state0(app.page)).ctx).toBeNull();
  await closeApp(app);
});

test('2. ★ สำเร็จ (ตัวช่วยกด ตกลง) — คำขอ prepare/run ครบ · ไฟล์เท่า Export Text + sha256 ตรง · ประวัติเขียน "ก่อน" run-import · แถวย้ายไป 🗂️ · ไม่ดาวน์โหลด', async ({ browser }) => {
  const app = await boot(browser);
  const histAtRun = [];
  const s = await stub({
    '/v1/prepare-import': async () => ({ json: PREP() }),
    '/v1/run-import': async () => { histAtRun.push(await app.page.evaluate((k) => !!window.__store[k], HIST_KEY)); return { json: IMP() }; },
  });
  await seed(app.page, { url: s.url });
  expect(await skus(app.page)).toEqual(O(1, 20));

  // จังหวะ 1
  await click(app.page); await modalOpen(app.page);
  const prep = s.posts('/v1/prepare-import');
  expect(prep.map((p) => p.raw), 'prepare ส่งแค่ proto/type/branch').toEqual(['{"proto":1,"type":"ORDS","branch":"SRC"}']);
  expect(prep[0].headers['content-type']).toBe('application/json');
  expect(prep[0].headers['x-anin-helper']).toBe('1');
  expect(prep[0].headers.origin).toBe(BASE);
  const m = await modal(app.page);
  expect(m).toMatchObject({ open: true, value: DOC, readOnly: true, ok: '🖥️ นำเข้า + บันทึก ProMaxx', okDisabled: false, err: '' });
  expect(m.summary).toBe('ORDS · 20 รายการ · หน้า 1/2 (แถวที่ 1–20 จาก 25)\nเลขที่เอกสารอ่านจากหน้า "นำเข้าไฟล์เอกสาร" ของ ProMaxx (แก้ไม่ได้)');
  expect(m.note).toContain('กด "ตกลง" ให้ (บันทึกเข้าระบบ)');
  expect(await btn(app.page), 'ระหว่างรอยืนยัน ปุ่มหลักยัง busy (กันเตรียมซ้อน)').toMatchObject({ disabled: true, text: '⏳ กำลังทำงาน…' });
  expect(await store(app.page), 'ยังไม่ยืนยัน = ยังไม่เขียนประวัติ').toBeNull();
  expect(s.posts('/v1/run-import')).toHaveLength(0);
  await app.page.evaluate(() => { onAdjPromaxxClick(); });                          // เรียกตรงขณะรอยืนยัน — ต้องไม่เตรียมซ้อน
  await app.page.waitForTimeout(150);
  expect(s.posts('/v1/prepare-import'), 'ไม่เตรียมซ้อน').toHaveLength(1);

  // จังหวะ 2
  await okClick(app.page); await afterRun(app.page);
  const run = s.posts('/v1/run-import');
  expect(run).toHaveLength(1);
  const body = run[0].json;
  const text = FILE(PAGE1);
  expect(Object.keys(body).sort(), 'run-import ส่งได้เฉพาะ field ที่ตัวช่วยกำหนด — ห้ามพาธ/คำสั่ง/รหัสผ่าน').toEqual(['branch', 'docNo', 'proto', 'rows', 'sha256', 'text', 'ticket', 'type']);
  expect(body).toMatchObject({ proto: 1, ticket: 'TICKET-1', type: 'ORDS', branch: 'SRC', docNo: DOC, rows: 20, sha256: SHA(text) });
  expect(body.text, 'เนื้อไฟล์ = ที่ Export Text สร้าง (CRLF · ปิดท้ายด้วย newline)').toBe(text);
  expect(histAtRun, 'ประวัติต้องถูกเขียนก่อนสั่ง ERP (ประวัติย้อนได้ ERP ย้อนไม่ได้)').toEqual([true]);
  const h = await store(app.page);
  expect(h.entries).toHaveLength(1);
  expect(h.entries[0]).toMatchObject({ no: DOC, dir: 'ords', by: 'Pharm' });
  expect(h.entries[0].rows).toHaveLength(20);
  expect(h.entries[0].rows[0]).toEqual(['O001', 2, 2, '12.5', '', '']);
  expect(h.entries[0].rows[1]).toEqual(['O002', 2, 2, null, 'LOT-A1', '']);
  expect(h.epoch).toBe(EPOCH);
  // ผลบนจอ
  expect((await modal(app.page)).open).toBe(false);
  expect(await skus(app.page), 'แถวที่นำเข้าย้ายไป 🗂️ แล้ว — หน้าถัดไปเลื่อนมา').toEqual(O(21, 25));
  expect(await rowCount(app.page)).toBe('5 รายการ');
  expect(await toastsOf(app.page)).toEqual([{ m: `✅ บันทึกเข้า ProMaxx แล้ว · ${DOC} · 20 รายการ`, type: 'success', ms: 10000 }]);
  expect(await downloads(app.page), 'นำเข้าอัตโนมัติไม่ดาวน์โหลดไฟล์').toEqual([]);
  expect(await state0(app.page)).toEqual({ ctx: null, busy: false, histBusy: false });
  expect(await btn(app.page)).toMatchObject({ disabled: false, text: '🖥️ บันทึกลง PROMAXX' });
  expect(s.posts('/v1/cancel-import'), 'จบสำเร็จ = ไม่ต้องยกเลิกตั๋ว').toHaveLength(0);
  await s.close(); await closeApp(app);
});

test('2b. สาขาในคำขอตามสาขาที่ล็อกอิน (KKL/SSS) — prepare/run ส่ง branch ถูก · ประวัติลง {branch}_adjhist ของสาขานั้น', async ({ browser }) => {
  const app = await boot(browser);
  for (const b of ['KKL', 'SSS']) {
    const s = await stub({ '/v1/prepare-import': () => ({ json: PREP({ branch: b }) }), '/v1/run-import': () => ({ json: IMP({ branch: b }) }) });
    await seed(app.page, { url: s.url, branch: b });
    const n0 = await app.page.evaluate(() => window.__afterRun);
    await prepared(app.page);
    await okClick(app.page); await afterRun(app.page, n0 + 1);
    expect(s.posts('/v1/prepare-import').map((p) => p.raw), b).toEqual([`{"proto":1,"type":"ORDS","branch":"${b}"}`]);
    expect(s.posts('/v1/run-import')[0].json.branch, b).toBe(b);
    expect((await store(app.page, `stock_sessions/${b}_adjhist`)).entries.map((e) => e.no), b).toEqual([DOC]);
    expect(await store(app.page, HIST_KEY), 'ไม่ปนกับประวัติของ SRC').toBeNull();
    await s.close();
  }
  await closeApp(app);
});

test('3. หยุดก่อน ตกลง (autoConfirm=false) — ป้าย/ข้อความ/toast บอกให้พนักงานกด ตกลง เอง', async ({ browser }) => {
  const app = await boot(browser);
  const s = await stub({ '/v1/prepare-import': () => ({ json: PREP({ autoConfirm: false }) }), '/v1/run-import': () => ({ json: IMP({ confirmed: false }) }) });
  await seed(app.page, { url: s.url });
  await prepared(app.page);
  const m = await modal(app.page);
  expect(m.ok).toBe('🖥️ นำเข้า ProMaxx');
  expect(m.note).toContain('แล้วหยุดก่อน "ตกลง"');
  expect(m.note).not.toContain('กด "ตกลง" ให้');
  await okClick(app.page); await afterRun(app.page);
  expect((await toastsOf(app.page))[0]).toEqual({ m: `นำเข้าไฟล์แล้ว · ${DOC} · 20 รายการ — ตรวจตารางแล้วกด ตกลง เอง`, type: 'success', ms: 10000 });
  expect((await store(app.page)).entries).toHaveLength(1);                                    // ย้ายไป 🗂️ เหมือนกัน (เอกสารกำลังรอ ตกลง)
  // ตัวช่วยไม่ส่ง autoConfirm มา (รุ่นเก่ากว่านี้/ค่าไม่ใช่ true) = ถือว่าไม่กด ตกลง ให้ (ปลอดภัยไว้ก่อน)
  const s2 = await stub({ '/v1/prepare-import': () => ({ json: (({ autoConfirm, ...r }) => r)(PREP({ docNo: 'ORDSBY001261100002' })) }) });
  await seed(app.page, { url: s2.url });
  await prepared(app.page);
  expect((await modal(app.page)).ok).toBe('🖥️ นำเข้า ProMaxx');
  await cancelClick(app.page);
  await s.close(); await s2.close(); await closeApp(app);
});

test('4. ★ ยกเลิก — ปุ่ม/Esc/ปิด 📦 ส่ง cancel-import และไม่เขียนอะไร · คลิกฉากหลัง/Enter ไม่ทำอะไร · ยกเลิกแล้วกดใหม่ได้', async ({ browser }) => {
  const app = await boot(browser);
  const s = await stub({ '/v1/prepare-import': () => ({ json: PREP() }), '/v1/cancel-import': () => ({ json: { ok: true, proto: 1, version: 'x', stage: 'cancelled', cleared: true } }), '/v1/run-import': () => ({ json: IMP() }) });
  await seed(app.page, { url: s.url });
  const settleCancel = async (n) => { await app.page.waitForFunction((n) => window.__toasts.length >= n, n, { polling: 30 }); await app.page.waitForTimeout(80); };

  // ปุ่มยกเลิก
  await prepared(app.page);
  await cancelClick(app.page); await settleCancel(1);
  expect((await modal(app.page)).open).toBe(false);
  expect(s.posts('/v1/cancel-import').map((p) => p.json)).toEqual([{ proto: 1, ticket: 'TICKET-1' }]);
  expect((await toastsOf(app.page))[0]).toEqual({ m: 'ยกเลิกแล้ว — ProMaxx ยังเปิดฟอร์มค้างอยู่ (ปิดเอง ไม่ต้องบันทึก)', type: 'info', ms: 7000 });
  expect(await state0(app.page)).toEqual({ ctx: null, busy: false, histBusy: false });
  expect(await store(app.page)).toBeNull();
  expect(s.posts('/v1/run-import')).toHaveLength(0);
  expect(await skus(app.page), 'ตารางไม่เปลี่ยน').toEqual(O(1, 20));

  // คลิกฉากหลัง + Enter ในช่องเลขที่ = ไม่ทำอะไร (เผลอกดไม่ยกเลิกตั๋ว · ไม่บันทึกเข้า ERP)
  await prepared(app.page);
  await app.page.evaluate(() => document.getElementById('adjDocNoModal').click());
  await app.page.evaluate(() => document.getElementById('adjDocNoInput').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
  await app.page.waitForTimeout(150);
  expect((await modal(app.page)).open, 'ยังเปิดอยู่').toBe(true);
  expect(s.posts('/v1/cancel-import'), 'ยังไม่ยกเลิก').toHaveLength(1);
  expect(s.posts('/v1/run-import')).toHaveLength(0);
  expect(await store(app.page)).toBeNull();
  // Esc = ยกเลิก
  await app.page.evaluate(() => document.getElementById('adjDocNoInput').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  await settleCancel(2);
  expect((await modal(app.page)).open).toBe(false);
  expect(s.posts('/v1/cancel-import')).toHaveLength(2);

  // ปิดป็อปอัพ 📦 ระหว่างรอยืนยัน = ยกเลิกตั๋วด้วย
  await prepared(app.page);
  await app.page.evaluate(() => closeAdjustDocPopup());
  await settleCancel(3);
  expect((await modal(app.page)).open).toBe(false);
  expect(s.posts('/v1/cancel-import')).toHaveLength(3);
  expect((await state0(app.page)).ctx).toBeNull();

  // ยกเลิกแล้วเตรียมใหม่ได้ (ตั๋วใหม่) และ modal กลับมาเป็นโหมดเดิมเมื่อเปิด Export Text ปกติ
  await app.page.evaluate(() => { document.getElementById('adjustDocPopupOverlay').style.display = 'flex'; });
  await prepared(app.page);
  expect(s.posts('/v1/prepare-import')).toHaveLength(4);
  await cancelClick(app.page); await settleCancel(4);
  await app.page.evaluate(() => { document.getElementById('adjExportTextBtn').click(); });
  await modalOpen(app.page);
  expect(await modal(app.page)).toMatchObject({ readOnly: false, value: '', ok: '⬇️ ดาวน์โหลด' });
  await s.close(); await closeApp(app);
});

test('5. prepare ล้ม — ทุกรหัสได้ข้อความ · ไม่เปิด modal ไม่เขียนประวัติ · ตัวช่วยรุ่นเก่า · ตอบนอกสัญญา = ยกเลิกตั๋ว', async ({ browser }) => {
  const app = await boot(browser);
  const CASES = [
    [() => ({ status: 409, json: ERR('ALREADY_RUNNING') }), 'warn', 'ProMaxx เปิดอยู่แล้ว — ปิด ssmaxx.exe ก่อนแล้วกดใหม่'],
    [() => ({ status: 422, json: ERR('BRANCH_NOT_SUPPORTED') }), 'warn', 'สาขานี้ไม่รองรับการนำเข้า ProMaxx อัตโนมัติ'],
    [() => ({ status: 500, json: ERR('SESSION_NOT_READY', 'preflight', 'มีฟอร์มเอกสารค้างใน ProMaxx — ปิดก่อนแล้วกดใหม่') }), 'error', 'ไม่สำเร็จที่ขั้น "ตรวจความพร้อม" — มีฟอร์มเอกสารค้างใน ProMaxx — ปิดก่อนแล้วกดใหม่'],
    [() => ({ status: 500, json: ERR('STEP_FAILED', 'form-ready', 'สาขาในฟอร์มไม่ตรง') }), 'error', 'ไม่สำเร็จที่ขั้น "ตรวจฟอร์มและอ่านเลขที่" — สาขาในฟอร์มไม่ตรง'],
    [() => ({ status: 500, json: ERR('POSTCONDITION_FAILED', 'warehouse-ok', 'คลังไม่เปลี่ยน') }), 'error', 'ไม่สำเร็จที่ขั้น "ยืนยันคลัง" — คลังไม่เปลี่ยน'],
    [() => ({ status: 500, json: ERR('LOGIN_FAILED', 'login') }), 'error', 'ล็อกอิน ProMaxx ไม่สำเร็จ — ตรวจรหัสในไฟล์ .env (ไม่ลองซ้ำ)'],
    [() => ({ status: 404, json: ERR('NOT_FOUND', '', 'ไม่พบเส้นทาง') }), 'warn', 'ตัวช่วยรุ่นไม่ตรง — อัปเดต PromaxxHelper'],       // ตัวช่วยก่อน .6 (ถ้า CORS ผ่านและตอบ 404)
    [() => ({ status: 200, json: { ok: true, proto: 1 } }), 'warn', 'ตัวช่วยรุ่นไม่ตรง — อัปเดต PromaxxHelper'],                      // ตอบนอกสัญญา (ไม่มี stage/ticket)
    [() => ({ status: 200, json: PREP({ docNo: 'XYZ123456' }) }), 'warn', 'ตัวช่วยรุ่นไม่ตรง — อัปเดต PromaxxHelper', true],            // เลขที่เอกสารผิดรูปแบบ → ยกเลิกตั๋ว
    [() => ({ status: 200, json: PREP({ docNo: 'IRPSBY001261100001' }) }), 'warn', 'ตัวช่วยรุ่นไม่ตรง — อัปเดต PromaxxHelper', true],     // เลขที่ไม่ขึ้นต้นด้วยชนิดที่ขอ
    [() => ({ status: 200, json: PREP({ type: 'IRPS' }) }), 'warn', 'ตัวช่วยรุ่นไม่ตรง — อัปเดต PromaxxHelper', true],                   // ตอบชนิดไม่ตรงที่ขอ
    [() => ({ status: 200, json: PREP({ branch: 'KKL' }) }), 'warn', 'ตัวช่วยรุ่นไม่ตรง — อัปเดต PromaxxHelper', true],                  // ตอบสาขาไม่ตรง
    [() => ({ status: 200, json: PREP({ ticket: '' }) }), 'warn', 'ตัวช่วยรุ่นไม่ตรง — อัปเดต PromaxxHelper'],                           // ไม่มีตั๋ว
  ];
  for (const [i, [fn, level, text, cancels]] of CASES.entries()) {
    const s = await stub({ '/v1/prepare-import': fn, '/v1/cancel-import': () => ({ json: { ok: true, proto: 1, stage: 'cancelled', cleared: true } }) });
    await seed(app.page, { url: s.url });
    await click(app.page); await idle(app.page);
    expect((await toastsOf(app.page)).map((t) => [t.type, t.m]), `เคส #${i}`).toEqual([[level, text]]);
    expect((await modal(app.page)).open, `เคส #${i} ต้องไม่เปิด modal`).toBe(false);
    expect(await store(app.page), `เคส #${i} ต้องไม่เขียนประวัติ`).toBeNull();
    expect(s.posts('/v1/run-import')).toHaveLength(0);
    await app.page.waitForTimeout(60);
    expect(s.posts('/v1/cancel-import').length, `เคส #${i}: ยกเลิกตั๋วที่ตัวช่วยออกให้แต่เราใช้ไม่ได้`).toBe(cancels ? 1 : 0);
    expect(await state0(app.page)).toEqual({ ctx: null, busy: false, histBusy: false });
    await s.close();
  }
  // ตัวช่วยรุ่นเก่า (ก่อน .6): preflight ของเส้นทางที่ไม่รู้จักถูก 404 → เบราว์เซอร์รายงานเป็นติดต่อไม่ได้ → ถาม /v1/health → ไม่มี autoImport = บอกให้อัปเดต
  const old = await stub({ '/v1/prepare-import': () => ({ drop: true }) }, { health: { ok: true, proto: 1, version: '2026-11-04.5', ssmaxxRunning: false } });
  await seed(app.page, { url: old.url });
  await click(app.page); await idle(app.page);
  expect((await toastsOf(app.page)).map((t) => t.m)).toEqual(['ตัวช่วยรุ่นไม่ตรง — อัปเดต PromaxxHelper']);
  expect(old.hits.some((h) => h.method === 'GET' && h.path === '/v1/health')).toBe(true);
  await old.close();
  // ตัวช่วยใหม่แต่คำขอล้ม (ตัดการเชื่อมต่อ) และ health บอกว่ามี autoImport → ยังเป็น "ติดต่อไม่ได้" ไม่ใช่รุ่นเก่า
  const flaky = await stub({ '/v1/prepare-import': () => ({ drop: true }) });
  await seed(app.page, { url: flaky.url });
  await click(app.page); await idle(app.page);
  expect((await toastsOf(app.page)).map((t) => t.m)).toEqual(['ไม่พบ PromaxxHelper บนเครื่องนี้ — เปิดตัวช่วยก่อน']);
  await flaky.close();
  // พอร์ตปิด (ไม่มีตัวช่วย)
  const dead = await stub(); const deadUrl = dead.url; await dead.close();
  await seed(app.page, { url: deadUrl });
  await click(app.page); await idle(app.page);
  expect((await toastsOf(app.page)).map((t) => t.m)).toEqual(['ไม่พบ PromaxxHelper บนเครื่องนี้ — เปิดตัวช่วยก่อน']);
  await closeApp(app);
});

test('6. ★ run-import ล้มแบบยืนยันได้ว่ายังไม่ตกลง → คืนแถวกลับตารางเอง (ลบประวัติ) · กดใหม่ได้ · คืนไม่สำเร็จ = บอกให้กด ↩', async ({ browser }) => {
  const app = await boot(browser);
  // ข้อความที่ตัวช่วยส่งเมื่อมีหน้าต่างอื่นของ ProMaxx ค้างหลังกด Open (promaxx_helper.py MSG_LOT_POPUP / MSG_EXTRA_WINDOW · เจอจริง 5 พ.ย. 2026: ป๊อปอัพเลือก Lot No.)
  // ⚠️ สำเนาตัวอักษรเดียวกันอยู่ใน promaxx-helper-import.spec.js (LOT_POPUP_MSG / EXTRA_WINDOW_MSG) — แก้ที่ใดต้องแก้ทั้งสองไฟล์ + promaxx_helper.py
  // หน้าเว็บตัดข้อความที่กว้างเกิน 70 (_shortErr) ⇒ ข้อความต้องผ่านครบทุกตัวอักษร ไม่งั้นส่วนท้ายที่บอกว่าต้องทำอะไรหาย
  const LOT_POPUP_MSG = 'ProMaxx ขอให้เลือก Lot No. — ยังไม่บันทึก เลือกหรือกดออกเอง แล้วลองใหม่';
  const EXTRA_WINDOW_MSG = `ProMaxx มีหน้าต่างอื่นค้าง (${'ก'.repeat(16)}) — ยังไม่บันทึก ปิดก่อนแล้วลองใหม่`;
  const CASES = [
    [() => ({ status: 422, json: ERR('TABLE_MISMATCH', 'verify-table', 'ตารางไม่ตรง') }), 'ตารางใน ProMaxx ไม่ตรงไฟล์ — ไม่กด ตกลง · ปิดฟอร์มแล้วลองใหม่'],
    [() => ({ status: 422, json: ERR('FILE_INVALID', '', 'แถว 3: LOT/EXP ไม่ถูกต้อง') }), 'ไฟล์นำเข้าไม่ผ่านตัวช่วย — แถว 3: LOT/EXP ไม่ถูกต้อง'],
    [() => ({ status: 409, json: ERR('TICKET_EXPIRED') }), 'ตั๋วหมดอายุ (เกิน 10 นาที) — กดบันทึกลง PROMAXX ใหม่'],
    [() => ({ status: 409, json: ERR('TICKET_INVALID') }), 'ตั๋วนำเข้าใช้ไม่ได้แล้ว — กดบันทึกลง PROMAXX ใหม่'],
    [() => ({ status: 409, json: ERR('STATE_CHANGED', 'preflight') }), 'ProMaxx เปลี่ยนไปหลังอ่านเลขที่ — ปิดฟอร์มแล้วกดใหม่'],
    [() => ({ status: 409, json: ERR('BUSY') }), 'ตัวช่วยกำลังทำงานอยู่ — รอสักครู่'],
    [() => ({ status: 500, json: ERR('SESSION_NOT_READY', 'preflight', 'ProMaxx มีหน้าต่างหรือกล่องค้าง — ปิดก่อนแล้วกดใหม่') }), 'ไม่สำเร็จที่ขั้น "ตรวจความพร้อม" — ProMaxx มีหน้าต่างหรือกล่องค้าง — ปิดก่อนแล้วกดใหม่'],
    [() => ({ status: 500, json: ERR('UNEXPECTED_DIALOG', 'select-file', 'กล่องข้อความ: ไม่พบไฟล์') }), 'กล่องข้อความ: ไม่พบไฟล์'],
    [() => ({ status: 500, json: ERR('UNEXPECTED_DIALOG', 'verify-table', LOT_POPUP_MSG) }), LOT_POPUP_MSG],
    [() => ({ status: 500, json: ERR('UNEXPECTED_DIALOG', 'verify-table', EXTRA_WINDOW_MSG) }), EXTRA_WINDOW_MSG],
    [() => ({ status: 500, json: ERR('STEP_FAILED', 'import-click', 'คลิกไม่ติด') }), 'ไม่สำเร็จที่ขั้น "กดปุ่มนำเข้าไฟล์เอกสาร" — คลิกไม่ติด'],
  ];
  for (const [i, [fn, text]] of CASES.entries()) {
    const s = await stub({ '/v1/prepare-import': () => ({ json: PREP() }), '/v1/run-import': fn });
    await seed(app.page, { url: s.url });
    await prepared(app.page);
    await okClick(app.page); await afterRun(app.page, i + 1);
    const t = await toastsOf(app.page);
    expect(t.map((x) => x.m), `เคส #${i}`).toEqual([text, 'รายการกลับมาที่ตารางแล้ว — ProMaxx ยังไม่ได้บันทึก · ปิดฟอร์มใน ProMaxx ก่อนลองใหม่']);
    expect((await store(app.page)).entries, `เคส #${i}: คืนแล้ว ประวัติต้องว่าง`).toEqual([]);
    expect(await skus(app.page), `เคส #${i}: แถวกลับมาที่ตาราง`).toEqual(O(1, 20));
    expect(await rowCount(app.page)).toBe('25 รายการ');
    expect(await downloads(app.page)).toEqual([]);
    expect(await actionsOf(app.page), 'ยืนยันได้ว่ายังไม่บันทึก = ไม่ต้องมีปุ่มดาวน์โหลดไฟล์').toEqual([]);
    expect(await state0(app.page)).toEqual({ ctx: null, busy: false, histBusy: false });
    await s.close();
  }
  // กดใหม่หลังคืนแถว → สำเร็จได้ (เลขที่เดิมใช้ซ้ำได้ เพราะประวัติถูกลบแล้ว)
  let first = true;
  const s2 = await stub({ '/v1/prepare-import': () => ({ json: PREP() }), '/v1/run-import': () => (first ? (first = false, { status: 422, json: ERR('TABLE_MISMATCH', 'verify-table') }) : { json: IMP() }) });
  await seed(app.page, { url: s2.url });
  const n0 = await app.page.evaluate(() => window.__afterRun);
  await prepared(app.page); await okClick(app.page); await afterRun(app.page, n0 + 1);
  await prepared(app.page); await okClick(app.page); await afterRun(app.page, n0 + 2);
  expect((await store(app.page)).entries.map((e) => e.no)).toEqual([DOC]);
  expect(await skus(app.page)).toEqual(O(21, 25));
  await s2.close();
  // ลบประวัติไม่สำเร็จ (cloud ล้มพอดีตอนคืน) → บอกให้กด ↩ ใน 🗂️ · แถวยังอยู่ในประวัติ
  const s3 = await stub({ '/v1/prepare-import': () => ({ json: PREP() }),
    '/v1/run-import': async () => { await app.page.evaluate(() => { window.__fail = 'ออฟไลน์'; }); return { status: 422, json: ERR('TABLE_MISMATCH', 'verify-table') }; } });
  await seed(app.page, { url: s3.url });
  const n1 = await app.page.evaluate(() => window.__afterRun);
  await prepared(app.page); await okClick(app.page); await afterRun(app.page, n1 + 1);
  expect((await toastsOf(app.page)).map((t) => [t.type, t.m]).slice(-2)).toEqual([
    ['error', 'ตารางใน ProMaxx ไม่ตรงไฟล์ — ไม่กด ตกลง · ปิดฟอร์มแล้วลองใหม่'], ['error', 'คืนรายการอัตโนมัติไม่สำเร็จ — กด ↩ คืนรายการใน 🗂️ ก่อนลองใหม่']]);
  await app.page.evaluate(() => { window.__fail = null; });
  expect((await store(app.page)).entries.map((e) => e.no), 'ยังอยู่ในประวัติ (คืนเองไม่ได้)').toEqual([DOC]);
  await s3.close(); await closeApp(app);
});

test('7. ★ run-import ไม่แน่ชัด (ขั้น ตกลง · INTERNAL · หมดเวลา · ตอบผิดรูปแบบ · ตัวช่วยหยุดตอบ) → คงไว้ใน 🗂️ + ปุ่มดาวน์โหลดไฟล์ (เนื้อไฟล์ = ที่ส่งให้ตัวช่วย)', async ({ browser }) => {
  const app = await boot(browser);
  const CASES = [
    [() => ({ status: 500, json: ERR('CONFIRM_UNKNOWN', 'confirm', 'กดตกลงแล้วแต่ยืนยันผลไม่ได้') }), 'กดตกลงแล้วแต่ยืนยันผลไม่ได้ — ตรวจใน ProMaxx ก่อนทำซ้ำ'],
    [() => ({ status: 500, json: ERR('PRECONDITION_FAILED', 'confirm', 'ฟอร์มเปลี่ยน') }), 'ไม่สำเร็จที่ขั้น "กด ตกลง" — ฟอร์มเปลี่ยน'],      // ขั้น ตกลง ทุกรหัส = ไม่แน่ชัด (คลิกอาจเกิดแล้ว)
    [() => ({ status: 500, json: ERR('INTERNAL', '', 'ตัวช่วยผิดพลาดภายใน') }), 'ไม่สำเร็จที่ขั้น "?" — ตัวช่วยผิดพลาดภายใน'],
    [() => ({ status: 502, raw: '<html>bad gateway</html>' }), 'ตัวช่วยตอบผิดรูปแบบ — ตรวจใน ProMaxx ก่อนทำซ้ำ'],
    [() => ({ drop: true }), 'ตัวช่วยหยุดตอบระหว่างนำเข้า — ตรวจใน ProMaxx ก่อนทำซ้ำ'],
    [() => ({ json: IMP(), delayMs: 1500 }), 'ตัวช่วยไม่ตอบใน 3 นาที — ตรวจใน ProMaxx ก่อนทำซ้ำ', 500],                                    // timeout ฝั่งเว็บ (ตัดเหลือ 500ms)
  ];
  for (const [i, [fn, text, runTimeout]] of CASES.entries()) {
    const sent = [];
    const s = await stub({ '/v1/prepare-import': () => ({ json: PREP() }), '/v1/run-import': (b) => { sent.push(b.text); return fn(); } });
    await seed(app.page, { url: s.url });
    await prepared(app.page);
    if (runTimeout) await app.page.evaluate((t) => { PROMAXX_HELPER_TIMEOUT_MS = t; }, runTimeout);      // prepare จบแล้ว — ลดเวลารอเฉพาะ run-import
    await okClick(app.page); await afterRun(app.page, i + 1);
    const t = await toastsOf(app.page);
    expect(t.map((x) => x.m), `เคส #${i}`).toEqual([text]);
    expect(t[0].type).toBe('error');
    expect((await store(app.page)).entries.map((e) => e.no), `เคส #${i}: คงไว้ใน 🗂️ (อาจบันทึกใน ProMaxx ไปแล้ว)`).toEqual([DOC]);
    expect(await skus(app.page)).toEqual(O(21, 25));
    const a = await actionsOf(app.page);
    expect(a, `เคส #${i}`).toEqual([{ m: 'รายการอยู่ใน 🗂️ · ตรวจใน ProMaxx ก่อนทำซ้ำ', label: '⬇️ ไฟล์ Text', type: 'error', ms: 20000 }]);
    expect(await downloads(app.page), 'ยังไม่ดาวน์โหลดจนกว่าจะกดปุ่ม').toEqual([]);
    await app.page.evaluate(() => window.__actionFns[0]());                                      // กดปุ่ม "ไฟล์ Text"
    const fn1 = await downloads(app.page);
    expect(fn1).toHaveLength(1);
    expect(fn1[0], `เคส #${i}`).toMatch(new RegExp(`^stockadj_ords_${DOC}_\\d{2}-\\d{2}-\\d{4}\\.txt$`));
    expect(await lastDownloadText(app.page), 'ไฟล์ที่ดาวน์โหลด = เนื้อที่ส่งให้ตัวช่วยทุกไบต์').toBe(sent[0]);
    expect(sent[0]).toBe(FILE(PAGE1));
    expect(await state0(app.page)).toEqual({ ctx: null, busy: false, histBusy: false });
    await s.close();
  }
  await closeApp(app);
});

test('8. เขียนประวัติไม่ผ่าน (cloud ล้ม/ไม่มี _db) → ไม่สั่ง ERP · modal และตั๋วยังอยู่ · แก้แล้วกดซ้ำสำเร็จ', async ({ browser }) => {
  const app = await boot(browser);
  const s = await stub({ '/v1/prepare-import': () => ({ json: PREP() }), '/v1/run-import': () => ({ json: IMP() }), '/v1/cancel-import': () => ({ json: { ok: true, proto: 1, stage: 'cancelled', cleared: true } }) });
  await seed(app.page, { url: s.url });
  await prepared(app.page);
  await app.page.evaluate(() => { window.__fail = 'ไม่มีสัญญาณ'; });
  await okClick(app.page); await settled(app.page);
  let m = await modal(app.page);
  expect(m.open, 'modal ยังอยู่').toBe(true);
  expect(m.err).toBe('บันทึกประวัติขึ้น Cloud ไม่สำเร็จ (ไม่มีสัญญาณ) — ยังไม่ได้นำเข้าและไม่ได้ล้างตาราง ลองใหม่');
  expect(m).toMatchObject({ ok: '🖥️ นำเข้า + บันทึก ProMaxx', okDisabled: false, readOnly: true, value: DOC });
  expect(s.posts('/v1/run-import'), 'ประวัติไม่ผ่าน = ไม่สั่ง ERP เลย').toHaveLength(0);
  expect(s.posts('/v1/cancel-import'), 'ตั๋วยังใช้ได้ — ไม่ยกเลิก').toHaveLength(0);
  expect(await skus(app.page)).toEqual(O(1, 20));
  expect((await state0(app.page)).ctx).not.toBeNull();
  expect(await toastsOf(app.page)).toEqual([]);
  // ไม่มี _db เลย
  await app.page.evaluate(() => { window.__fail = null; window.__db = _db; _db = null; });
  await okClick(app.page); await settled(app.page);
  expect((await modal(app.page)).err).toContain('บันทึกประวัติขึ้น Cloud ไม่สำเร็จ (ไม่ได้เชื่อมต่อ Cloud)');
  expect(s.posts('/v1/run-import')).toHaveLength(0);
  // กลับมาออนไลน์ → กดซ้ำสำเร็จ (ตั๋วเดิม)
  await app.page.evaluate(() => { _db = window.__db; });
  await okClick(app.page); await afterRun(app.page);
  expect(s.posts('/v1/run-import')).toHaveLength(1);
  expect(s.posts('/v1/run-import')[0].json.ticket).toBe('TICKET-1');
  expect((await store(app.page)).entries.map((e) => e.no)).toEqual([DOC]);
  expect((await toastsOf(app.page)).map((t) => t.type)).toEqual(['success']);
  await s.close(); await closeApp(app);
});

test('9. เลขที่เอกสารของ ProMaxx ซ้ำกับประวัติ (รอบนี้) → แจ้งตั้งแต่เปิด · ไม่สั่ง ERP · ไม่เขียนทับ', async ({ browser }) => {
  const app = await boot(browser);
  const s = await stub({ '/v1/prepare-import': () => ({ json: PREP() }), '/v1/run-import': () => ({ json: IMP() }), '/v1/cancel-import': () => ({ json: { ok: true, proto: 1, stage: 'cancelled', cleared: true } }) });
  await seed(app.page, { url: s.url });
  // ประวัติรอบนี้มีเลขที่นี้อยู่แล้ว (เช่นนำเข้าครั้งก่อนไม่ได้บันทึกใน ProMaxx แต่ประวัติยังค้าง) — แถวคนละชุด
  await app.page.evaluate(({ epoch, doc }) => {
    const e = [{ no: doc, dir: 'ords', at: '2026-11-04T08:00:00.000Z', by: 'Other', rows: [['X900', 2, 2, null, '', '']] }];
    window.__store['stock_sessions/SRC_adjhist'] = { countResetAt: epoch, entries_json: JSON.stringify(e), updatedBy: 'Other', updatedAt: { toDate: () => new Date() } };
    _adjHist = { branch: 'SRC', countResetAt: epoch, entries: e, updatedBy: 'Other', updatedAt: '' };
    renderAdjustDocTable(true);
  }, { epoch: EPOCH, doc: DOC });
  await prepared(app.page);
  const m = await modal(app.page);
  expect(m.errColor).toBe('var(--red)');
  expect(m.err).toMatch(new RegExp(`^เลขที่ ${DOC} มีในประวัติแล้ว \\(.+ · Other\\) — ถ้าไม่ได้บันทึกใน ProMaxx ให้ ↩ คืนรายการใน 🗂️ ก่อน$`));
  await okClick(app.page); await settled(app.page);
  expect((await modal(app.page)).open).toBe(true);
  expect(s.posts('/v1/run-import')).toHaveLength(0);
  expect((await store(app.page)).entries.map((e) => e.no), 'ไม่เขียนทับ').toEqual([DOC]);
  expect(await app.page.evaluate(() => window.__writes)).toBe(0);
  await cancelClick(app.page);
  await s.close(); await closeApp(app);
});

test('10. รายการเปลี่ยนระหว่างรอยืนยัน → แจ้ง ไม่ส่งของที่ไม่ได้เห็น · กดซ้ำส่งชุดใหม่', async ({ browser }) => {
  const app = await boot(browser);
  const s = await stub({ '/v1/prepare-import': () => ({ json: PREP() }), '/v1/run-import': () => ({ json: IMP() }) });
  await seed(app.page, { url: s.url });
  await prepared(app.page);
  // เครื่องอื่น/การแก้ทำให้ O003 เปลี่ยนจากลด 2 เป็นลด 3
  await app.page.evaluate(() => { state.scanData.get('O003').effectiveQty = 7; renderAdjustDocTable(true); });
  await okClick(app.page); await settled(app.page);
  const m = await modal(app.page);
  expect(m.open).toBe(true);
  expect(m.err).toBe('รายการในหน้านี้เปลี่ยนไประหว่างรอ — ตรวจสรุปด้านบนอีกครั้ง แล้วกดนำเข้าอีกครั้ง');
  expect(m.summary).toContain('ORDS · 20 รายการ');
  expect(s.posts('/v1/run-import'), 'ยังไม่ส่ง').toHaveLength(0);
  expect(await store(app.page)).toBeNull();
  await okClick(app.page); await afterRun(app.page);
  const body = s.posts('/v1/run-import')[0].json;
  expect(body.text.split('\r\n')[2], 'ส่งชุดที่เห็นล่าสุด (O003 = 3)').toBe(LINE('O003', 3));
  expect(body.sha256).toBe(SHA(body.text));
  expect((await store(app.page)).entries[0].rows[2]).toEqual(['O003', 3, 3, null, '', '']);
  // รายการหายหมดระหว่างรอ → ยกเลิกตั๋ว
  const s2 = await stub({ '/v1/prepare-import': () => ({ json: PREP({ docNo: 'ORDSBY001261100002' }) }), '/v1/cancel-import': () => ({ json: { ok: true, proto: 1, stage: 'cancelled', cleared: true } }) });
  await seed(app.page, { url: s2.url, nO: 3 });
  await prepared(app.page);
  await app.page.evaluate(() => { for (const k of ['O001', 'O002', 'O003']) state.scanData.get(k).effectiveQty = 10; renderAdjustDocTable(true); });
  await okClick(app.page); await settled(app.page);
  expect((await modal(app.page)).open).toBe(false);
  expect((await toastsOf(app.page)).map((t) => t.m)).toEqual(['รายการในหน้านี้เปลี่ยนไประหว่างรอ — กดบันทึกลง PROMAXX ใหม่']);
  await app.page.waitForTimeout(80);
  expect(s2.posts('/v1/cancel-import')).toHaveLength(1);
  // ชนิดเปลี่ยนขณะ modal เปิดอยู่ (ProMaxx เตรียมฟอร์ม ORDS ไว้) → ไม่ส่งชนิดผิดไป: ยกเลิกตั๋ว
  const s3 = await stub({ '/v1/prepare-import': () => ({ json: PREP({ docNo: 'ORDSBY001261100003' }) }), '/v1/run-import': () => ({ json: IMP() }),
    '/v1/cancel-import': () => ({ json: { ok: true, proto: 1, stage: 'cancelled', cleared: true } }) });
  await seed(app.page, { url: s3.url });
  await prepared(app.page);
  await app.page.evaluate(() => { _adjDocFilter = 'irps'; });
  await okClick(app.page); await settled(app.page);
  expect((await modal(app.page)).open).toBe(false);
  expect((await toastsOf(app.page)).map((t) => t.m)).toEqual(['รายการในหน้านี้เปลี่ยนไประหว่างรอ — กดบันทึกลง PROMAXX ใหม่']);
  await app.page.waitForTimeout(80);
  expect(s3.posts('/v1/run-import')).toHaveLength(0);
  expect(s3.posts('/v1/cancel-import')).toHaveLength(1);
  expect(await store(app.page)).toBeNull();
  await s.close(); await s2.close(); await s3.close(); await closeApp(app);
});

test('11. สลับแท็บระหว่างรอ ProMaxx → ยกเลิกตั๋ว ไม่เปิด modal', async ({ browser }) => {
  const app = await boot(browser);
  const s = await stub({ '/v1/prepare-import': () => ({ json: PREP(), delayMs: 400 }), '/v1/cancel-import': () => ({ json: { ok: true, proto: 1, stage: 'cancelled', cleared: true } }) });
  await seed(app.page, { url: s.url });
  await click(app.page);
  await app.page.waitForFunction(() => _adjPromaxxBusy, null, { polling: 20 });
  await app.page.evaluate(() => setAdjDocFilter('irps', document.getElementById('adjBtnIrps')));
  await idle(app.page);
  expect((await toastsOf(app.page)).map((t) => [t.type, t.m])).toEqual([['warn', 'สลับแท็บระหว่างรอ ProMaxx — กดใหม่']]);
  expect((await modal(app.page)).open).toBe(false);
  await app.page.waitForTimeout(80);
  expect(s.posts('/v1/cancel-import').map((p) => p.json.ticket)).toEqual(['TICKET-1']);
  expect(s.posts('/v1/prepare-import')[0].json.type, 'ขอชนิดตามแท็บตอนกด').toBe('ORDS');
  expect(await store(app.page)).toBeNull();
  await s.close(); await closeApp(app);
});

test('11b. ปิดหน้า 📦 ระหว่างรอ ProMaxx → ยกเลิกตั๋ว ไม่เปิด modal ลอย', async ({ browser }) => {
  const app = await boot(browser);
  const s = await stub({ '/v1/prepare-import': () => ({ json: PREP(), delayMs: 400 }), '/v1/cancel-import': () => ({ json: { ok: true, proto: 1, stage: 'cancelled', cleared: true } }) });
  await seed(app.page, { url: s.url });
  await click(app.page);
  await app.page.waitForFunction(() => _adjPromaxxBusy, null, { polling: 20 });
  await app.page.evaluate(() => closeAdjustDocPopup());
  await idle(app.page);
  expect((await toastsOf(app.page)).map((t) => [t.type, t.m])).toEqual([['warn', 'ปิดหน้าปรับปรุงสินค้าระหว่างรอ ProMaxx — กดใหม่']]);
  expect((await modal(app.page)).open).toBe(false);
  await app.page.waitForTimeout(80);
  expect(s.posts('/v1/cancel-import').map((p) => p.json.ticket)).toEqual(['TICKET-1']);
  expect(await store(app.page)).toBeNull();
  await s.close(); await closeApp(app);
});

test('12. ตรวจไฟล์ก่อนแตะ ProMaxx — ราคา/LOT ผิดรูปแบบ · เกิน 20 รายการ · ไม่มีรายการ = ไม่ยิงคำขอเลย', async ({ browser }) => {
  const app = await boot(browser);
  const s = await stub({ '/v1/prepare-import': () => ({ json: PREP() }) });
  const msgs = async () => (await toastsOf(app.page)).map((t) => [t.type, t.m]);
  // ราคา 5 ตำแหน่งทศนิยม (ตัวช่วยรับสูงสุด 4)
  await seed(app.page, { url: s.url });
  await app.page.evaluate(() => { _priceMap.set('O004', { unit: 'เม็ด', price: '12.34567' }); renderAdjustDocTable(true); });
  await click(app.page); await idle(app.page);
  expect(await msgs()).toEqual([['warn', 'ไฟล์ไม่ผ่านการตรวจก่อนส่ง — แถว 4: ราคาไม่ถูกต้อง']]);
  // LOT มีอักขระควบคุม
  await seed(app.page, { url: s.url });
  await app.page.evaluate(() => { _lotMap.set('O005', [{ lot: 'A\u0007B', exp: '' }]); _lotSelected.set('O005', 'A\u0007B'); renderAdjustDocTable(true); });
  await click(app.page); await idle(app.page);
  expect(await msgs()).toEqual([['warn', 'ไฟล์ไม่ผ่านการตรวจก่อนส่ง — แถว 5: LOT/EXP ไม่ถูกต้อง']]);
  // เกิน 20 รายการ (ไม่แบ่งหน้า → ทั้งแท็บ 25 แถว)
  await seed(app.page, { url: s.url, pageSize: 0 });
  await click(app.page); await idle(app.page);
  expect(await msgs()).toEqual([['warn', 'นำเข้า ProMaxx ได้ครั้งละไม่เกิน 20 รายการ — เปลี่ยนหน้าแล้วกดใหม่']]);
  // ไม่มีรายการในแท็บ
  await seed(app.page, { url: s.url, nO: 0, nI: 0 });
  await click(app.page); await idle(app.page);
  expect((await msgs())[0]).toEqual(['warn', 'ไม่มีรายการให้นำเข้าตามแท็บที่เลือก']);
  expect(s.hits.filter((h) => h.method === 'POST'), 'ทั้งสี่เคส = ไม่แตะ ProMaxx (ไม่ยิงคำขอ POST)').toHaveLength(0);
  expect((await state0(app.page))).toEqual({ ctx: null, busy: false, histBusy: false });
  await s.close(); await closeApp(app);
});

test('13. ตั๋วหมดอายุฝั่งเว็บ · แถวทับกับเอกสารของอีกเครื่อง → ไม่ส่ง ERP + ยกเลิกตั๋ว', async ({ browser }) => {
  const app = await boot(browser);
  const routes = () => ({ '/v1/prepare-import': () => ({ json: PREP() }), '/v1/run-import': () => ({ json: IMP() }), '/v1/cancel-import': () => ({ json: { ok: true, proto: 1, stage: 'cancelled', cleared: true } }) });
  // ตั๋วหมดอายุ
  const s = await stub(routes());
  await seed(app.page, { url: s.url });
  await prepared(app.page);
  await app.page.evaluate(() => { _adjPromaxxCtx.expiresAt = Date.now() - 1; });
  await okClick(app.page); await settled(app.page);
  expect((await modal(app.page)).open).toBe(false);
  expect((await toastsOf(app.page)).map((t) => t.m)).toEqual(['ตั๋วหมดอายุ (เกิน 10 นาที) — กดบันทึกลง PROMAXX ใหม่']);
  await app.page.waitForTimeout(80);
  expect(s.posts('/v1/cancel-import')).toHaveLength(1);
  expect(s.posts('/v1/run-import')).toHaveLength(0);
  expect(await store(app.page)).toBeNull();
  expect(await state0(app.page)).toEqual({ ctx: null, busy: false, histBusy: false });
  await s.close();
  // อีกเครื่องส่งออกแถวเดียวกันไปแล้วในเอกสาร OTHERDOC (คนละเลขที่) ระหว่างที่รอยืนยัน
  const s2 = await stub(routes());
  await seed(app.page, { url: s2.url });
  await prepared(app.page);
  await app.page.evaluate(({ epoch }) => {
    const e = [{ no: 'OTHERDOC1', dir: 'ords', at: '2026-11-04T08:00:00.000Z', by: 'Other', rows: [['O001', 2, 2, null, '', '']] }];
    window.__store['stock_sessions/SRC_adjhist'] = { countResetAt: epoch, entries_json: JSON.stringify(e), updatedBy: 'Other', updatedAt: { toDate: () => new Date() } };
  }, { epoch: EPOCH });
  await okClick(app.page); await settled(app.page);
  expect((await modal(app.page)).open).toBe(false);
  expect((await toastsOf(app.page)).map((t) => t.m)).toEqual(['⚠️ 1 รายการถูกส่งออกไปแล้วในเอกสาร OTHERDOC1 — ไม่ได้นำเข้า ตรวจแล้วกดใหม่']);
  await app.page.waitForTimeout(80);
  expect(s2.posts('/v1/run-import'), 'แถวทับ = ไม่สั่ง ERP').toHaveLength(0);
  expect(s2.posts('/v1/cancel-import')).toHaveLength(1);
  expect((await store(app.page)).entries.map((e) => e.no), 'ไม่เขียนทับของอีกเครื่อง').toEqual(['OTHERDOC1']);
  await s2.close(); await closeApp(app);
});

test('14. ประวัติปิด/สวิตช์ AUTO ปิด → เส้นทางเดิม (open-import) · WH ไม่เห็นปุ่มและเรียกตรงก็ไม่ทำอะไร', async ({ browser }) => {
  const app = await boot(browser);
  const s = await stub({ '/v1/open-import': (b) => ({ json: { ok: true, proto: 1, version: 'x', type: b.type, reached: 'import-button', dryRun: false, elapsedMs: 5, steps: [] } }) });
  // ประวัติปิด: นำเข้าอัตโนมัติต้องมีประวัติ (แถวต้องย้ายก่อน) → เส้นทางเดิม
  await seed(app.page, { url: s.url, history: false });
  await click(app.page); await idle(app.page);
  expect(s.posts().map((p) => [p.path, p.raw])).toEqual([['/v1/open-import', '{"proto":1,"type":"ORDS"}']]);
  expect((await toastsOf(app.page))[0].m).toBe('เปิดหน้า "นำเข้าไฟล์เอกสาร" แล้ว (ORDS · เอกสารจ่าย · O) — ยังไม่ได้นำเข้าข้อมูล');
  // tooltip ตามโหมด
  expect(await app.page.evaluate(() => document.getElementById('adjPromaxxBtn').title)).toContain('แล้วหยุด');
  await seed(app.page, { url: s.url });
  expect(await app.page.evaluate(() => document.getElementById('adjPromaxxBtn').title)).toContain('คุณกดยืนยันครั้งเดียว');
  // WH
  await seed(app.page, { url: s.url, role: 'supervisor', branch: 'WH' });
  expect((await btn(app.page)).shown, 'WH ไม่ใช้ บันทึกลง ProMaxx').toBe(false);
  expect(await app.page.evaluate(() => _adjPromaxxEnabled())).toBe(false);
  await app.page.evaluate(() => onAdjPromaxxClick());
  await app.page.waitForTimeout(100);
  expect(s.posts(), 'เรียกตรงก็ไม่ยิงคำขอ (ไม่เพิ่มจาก 1)').toHaveLength(1);
  for (const b of ['SRC', 'KKL', 'SSS']) { await seed(app.page, { url: s.url, branch: b }); expect((await btn(app.page)).shown, b).toBe(true); }
  await s.close(); await closeApp(app);
});

// ─── 15. parity: ตัวตรวจไฟล์ฝั่งเว็บ ↔ parse_import_text ของตัวช่วยจริง ───────────────────────────────────────────────
function mulberry32(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function fuzzCases() {
  const rnd = mulberry32(20261104);
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const skus = ['100593', 'A1', 'AB-1.2_3', 'x'.repeat(30), 'x'.repeat(31), '', ' ', 'A B', '-X', '.X', 'ก', 'A\tB', '٣', 'Ab9', '0'];
  const qtys = ['1', '2', '10', '0', '-1', '1.5', '1.1234', '1.12345', '123456789', '1234567890', '123456789.1234', '00012', 'abc', '', ' 1', '1 ', '1e3', '1,000', '.5', '5.', '٣', '๓', '+1', '0.0001', '0.0000'];
  const prices = ['', '12.5', '0', '99999.9999', '12.34567', 'x', '-1', '1,2', ' ', '๑๒', '٣'];
  const lots = ['', 'LOT-A1', 'a'.repeat(40), 'a'.repeat(41), 'A\u0007B', 'A\u007fB', 'ล็อต ๑', 'A B', '\u0085x'];
  const exps = ['', '01/01/2027', '1/1/2027', '2027-01-01', '31/12/2569', '01/01/27', '๐๑/๐๑/๒๐๒๗', ' 01/01/2027'];
  const row = () => [pick(skus), pick(qtys), pick(prices), '', '', '', '', '', pick(lots), pick(exps)];
  const valid = () => ['A' + Math.floor(rnd() * 1e6), String(1 + Math.floor(rnd() * 99)), rnd() < 0.5 ? '' : (rnd() * 1000).toFixed(2), '', '', '', '', '', rnd() < 0.5 ? '' : 'L' + Math.floor(rnd() * 99), rnd() < 0.3 ? '01/01/2027' : ''];
  const cases = [];
  const join = (rows, nl = '\r\n', tail = true) => rows.map((r) => r.join('\t')).join(nl) + (tail ? nl : '');
  for (let i = 0; i < 400; i++) {
    const n = 1 + Math.floor(rnd() * 4);
    const rows = Array.from({ length: n }, (_, k) => (rnd() < 0.5 ? valid() : row()));
    if (rnd() < 0.1) rows.push(rows[0].slice());                                            // SKU ซ้ำ
    if (rnd() < 0.08) rows[0][3] = 'x';                                                     // คอลัมน์ว่างที่ต้องว่างไม่ว่าง
    if (rnd() < 0.05) rows[0] = rows[0].slice(0, 9);                                        // 9 ช่อง
    if (rnd() < 0.05) rows[0] = [...rows[0], ''];                                           // 11 ช่อง
    cases.push(join(rows, rnd() < 0.85 ? '\r\n' : '\n', rnd() < 0.85));
  }
  // เคสขอบ
  cases.push('', '\r\n', '\n', 'x', FILE([LINE('A1', 1)]), FILE([LINE('A1', 1)]).replace(/\r\n$/, ''), FILE(Array.from({ length: 20 }, (_, i) => LINE('S' + i, 1))), FILE(Array.from({ length: 21 }, (_, i) => LINE('S' + i, 1))),
    FILE([LINE('A1', 1)]) + 'zzz', FILE([LINE('A1', 1)]).replace(/\r\n/g, '\r'), LINE('A1', 1) + '\u0000', FILE([LINE('A1', 1, '', 'ก'.repeat(40))]), FILE([LINE('A1', 1, '', 'ก'.repeat(41))]),
    FILE(Array.from({ length: 20 }, (_, i) => LINE('S' + i, 1, '', 'ก'.repeat(40)))));
  // ปรับทีละช่อง โดยช่องอื่นเป็นค่าที่ผ่านแน่ — ชุดสุ่มด้านบนแทบไม่โดนเคส "ช่องเดียวผิดแต่ทุกอย่างอื่นถูก"
  // (mutation testing 4 พ.ย. 2026: SKU ขึ้นต้นด้วย - . _ และเลขไทย/อาหรับ/เต็มความกว้างในราคา·EXP รอดเทสสุ่ม → ตรึงเป็นรายค่า)
  const baseV = { sku: 'A1', qty: '1', price: '', lot: '', exp: '' };
  const vary = (k, vals) => vals.forEach((v) => cases.push(FILE([LINE(...['sku', 'qty', 'price', 'lot', 'exp'].map((f) => (f === k ? v : baseV[f])))])));
  vary('sku', [...skus, '_X', 'X-', 'A.', '9', 'a'.repeat(30), 'a'.repeat(31), '００１', 'A１', '๑๒๓']);
  vary('qty', [...qtys, '１', '๑', '١', '0.5', '0.00001']);
  vary('price', [...prices, '๑.๕', '１２', '١٢.٥', '0.0001', '123456789', '1234567890', '1.', '.5']);
  // LOT ยาว: นับเป็น "ตัวอักษร" (code point) เหมือน Python — อีโมจิ 1 ตัวเป็น 2 หน่วยใน UTF-16 (ถ้านับหน่วยจะปฏิเสธ 21–40 ตัวที่ตัวช่วยรับ)
  vary('lot', [...lots, 'ล็อต', 'ก'.repeat(40), 'ก'.repeat(41), 'A\u0000B', '😀'.repeat(20), '😀'.repeat(21), '😀'.repeat(40), '😀'.repeat(41)]);
  vary('exp', [...exps, '๐๑/๐๑/๒๐๒๗', '٠١/٠١/٢٠٢٧', '０１/０１/２０２７', '31/12/2569', '99/99/9999']);
  return cases;
}

test('15. parity — ตัวตรวจไฟล์ฝั่งเว็บ (_adjPromaxxCheckText) ผ่าน/ไม่ผ่านตรงกับ parse_import_text ของตัวช่วยจริงทุกเคส (fuzz 400 + เคสขอบ)', async ({ browser }) => {
  const cases = fuzzCases();
  const py = runPy(`
out = []
for t in p['cases']:
    try:
        m.parse_import_text(t); out.append(True)
    except m.HelperError:
        out.append(False)
print(json.dumps(out))
`, { cases });
  const app = await boot(browser);
  const js = await app.page.evaluate((cases) => cases.map((t) => _adjPromaxxCheckText(t) === ''), cases);
  const diff = cases.map((t, i) => (js[i] === py[i] ? null : { i, js: js[i], py: py[i], t: JSON.stringify(t).slice(0, 160) })).filter(Boolean);
  expect(diff, 'ผลต่างระหว่างหน้าเว็บกับตัวช่วย').toEqual([]);
  expect(py.filter(Boolean).length, 'ชุดสุ่มต้องมีทั้งที่ผ่านและไม่ผ่านมากพอ (ไม่งั้นเทสไม่ได้ตรวจอะไร)').toBeGreaterThan(40);
  expect(py.filter((x) => !x).length).toBeGreaterThan(100);
  await closeApp(app);
});

// ─── 16. ตัวช่วยจริง (Python) + ตัวต่อปลอม ProMaxx แบบ WPF/UIA + หน้าเว็บจริงใน Chromium ──────────────────────────────
async function stack(opts = {}) {
  return startServer({ origins: [BASE], uia: true, debug: true, settings: { auto_confirm: true }, ...opts });
}

test('16. ★ ตัวช่วยจริง + ตัวต่อปลอม ProMaxx + หน้าเว็บจริง — สำเร็จ (กด ตกลง 1 ครั้ง) · หยุดก่อนตกลง · ตารางไม่ตรง = ไม่กด ตกลง + คืนแถว · สาขาไม่ตรง', async ({ browser }) => {
  // (ก) สำเร็จ — ตัวช่วยกด ตกลง ให้
  const srv = await stack();
  try {
    const app = await boot(browser);
    await seed(app.page, { url: srv.origin });
    await prepared(app.page);
    const m = await modal(app.page);
    expect(m.value, 'เลขที่เอกสารที่อ่านจากฟอร์ม ProMaxx').toMatch(/^ORDS[A-Z0-9]{6,30}$/);
    expect(m).toMatchObject({ readOnly: true, ok: '🖥️ นำเข้า + บันทึก ProMaxx' });
    const doc = m.value;
    let st = await srv.state();
    expect(st.ok_clicks, 'จังหวะ 1 ยังไม่ตกลง').toBe(0);
    expect(st.files, 'จังหวะ 1 ยังไม่เขียนไฟล์').toEqual([]);
    expect(st.ticket).toBe(true);
    await okClick(app.page); await afterRun(app.page);
    st = await srv.state();
    expect(await toastsOf(app.page)).toEqual([{ m: `✅ บันทึกเข้า ProMaxx แล้ว · ${doc} · 20 รายการ`, type: 'success', ms: 10000 }]);
    expect(st.ok_clicks, 'กด ตกลง ครั้งเดียว').toBe(1);
    expect(st.saved).toHaveLength(1);
    expect(st.saved[0].map((r) => [r.sku, r.qty])).toEqual(O(1, 20).map((s) => [s, 2]));
    expect(st.misfires, 'ไม่มีปุ่มอื่นของแถบปุ่มถูกกด').toEqual([]);
    expect(st.files).toHaveLength(1);
    expect(st.files[0]).toMatch(new RegExp(`^stockadj_ords_${doc}_\\d{2}-\\d{2}-\\d{4}_\\d{6}\\.txt$`));
    expect(st.filesData[st.files[0]], 'ไฟล์ที่ตัวช่วยเขียน = เนื้อเดียวกับ Export Text ทุกไบต์').toBe(FILE(PAGE1));
    expect(st.ticket, 'ตั๋วถูกใช้แล้ว').toBe(false);
    const h = await store(app.page);
    expect(h.entries.map((e) => e.no)).toEqual([doc]);
    expect(await skus(app.page)).toEqual(O(21, 25));
    expect(await downloads(app.page)).toEqual([]);
    await closeApp(app);
  } finally { await srv.stop(); }

  // (ข) หยุดก่อน ตกลง (ค่าเริ่มต้นของตัวช่วย: PROMAXX_AUTO_CONFIRM ปิด) — ตารางโหลดครบแต่ไม่บันทึก
  const srv2 = await stack({ settings: {} });
  try {
    const app = await boot(browser);
    await seed(app.page, { url: srv2.origin });
    await prepared(app.page);
    expect(await modal(app.page)).toMatchObject({ ok: '🖥️ นำเข้า ProMaxx' });
    await okClick(app.page); await afterRun(app.page);
    const st = await srv2.state();
    expect(st.ok_clicks, 'ไม่กด ตกลง').toBe(0);
    expect(st.table).toHaveLength(20);
    expect(st.file_loaded).toMatch(/stockadj_ords_/);
    expect(st.saved).toEqual([]);
    expect((await toastsOf(app.page))[0].m).toMatch(/^นำเข้าไฟล์แล้ว · ORDS\w+ · 20 รายการ — ตรวจตารางแล้วกด ตกลง เอง$/);
    expect((await store(app.page)).entries).toHaveLength(1);
    await closeApp(app);
  } finally { await srv2.stop(); }

  // (ค) ตารางใน ProMaxx ไม่ตรงไฟล์ (จำนวนแถวแรกเพี้ยน) → ไม่กด ตกลง → หน้าเว็บคืนแถวกลับตารางเอง
  const srv3 = await stack({ uia_flags: { open_wrong_qty: true } });
  try {
    const app = await boot(browser);
    await seed(app.page, { url: srv3.origin });
    await prepared(app.page);
    await okClick(app.page); await afterRun(app.page);
    const st = await srv3.state();
    expect(st.ok_clicks, 'ตารางไม่ตรง = ไม่กด ตกลง เด็ดขาด').toBe(0);
    expect(st.saved).toEqual([]);
    expect((await toastsOf(app.page)).map((t) => t.m)).toEqual(['ตารางใน ProMaxx ไม่ตรงไฟล์ — ไม่กด ตกลง · ปิดฟอร์มแล้วลองใหม่', 'รายการกลับมาที่ตารางแล้ว — ProMaxx ยังไม่ได้บันทึก · ปิดฟอร์มใน ProMaxx ก่อนลองใหม่']);
    expect((await store(app.page)).entries).toEqual([]);
    expect(await skus(app.page)).toEqual(O(1, 20));
    await closeApp(app);
  } finally { await srv3.stop(); }

  // (ง) ฟอร์มใน ProMaxx เป็นของสาขาอื่น (เก้ากิโล) แต่หน้าเว็บเป็น SRC → หยุดตั้งแต่จังหวะ 1 ไม่ส่งเลขที่ให้เว็บ
  const srv4 = await stack({ uia_flags: { branch_name: 'อนิน สาขาเก้ากิโล' } });
  try {
    const app = await boot(browser);
    await seed(app.page, { url: srv4.origin });
    await click(app.page); await idle(app.page);
    const t = await toastsOf(app.page);
    expect(t).toHaveLength(1);
    expect(t[0].type).toBe('error');
    expect(t[0].m).toMatch(/^ไม่สำเร็จที่ขั้น "/);
    expect((await modal(app.page)).open).toBe(false);
    expect(await store(app.page)).toBeNull();
    const st = await srv4.state();
    expect([st.ok_clicks, st.files, st.ticket]).toEqual([0, [], false]);
    await closeApp(app);
  } finally { await srv4.stop(); }
});

test('17. toast ของเส้นทางนำเข้าอัตโนมัติไม่ล้นหน้าต่างครึ่งจอ (960px) ในกรณียาวสุด', async ({ browser }) => {
  const app = await boot(browser);
  const LONG = 'ORDSBY0012611000012345';          // เลขที่จริง = ORDS+สาขา+YY+MM+ลำดับ (18 ตัว) — ที่นี่ยาวเกินจริงเผื่อลำดับ 9 หลัก (22 ตัว)
  const samples = await app.page.evaluate((LONG) => {
    const runMsgs = [{ err: 'timeout' }, { err: 'bad' }, { err: 'unreachable' }, { err: 'denied' },
      ...['TABLE_MISMATCH', 'CONFIRM_UNKNOWN', 'STATE_CHANGED', 'TICKET_EXPIRED', 'TICKET_INVALID', 'BRANCH_NOT_SUPPORTED'].map((code) => ({ data: { ok: false, proto: 1, code, step: 'x', message: 'm' } })),
      { data: { ok: false, proto: 1, code: 'FILE_INVALID', step: '', message: 'แถว 20: รหัสสินค้าไม่ถูกต้อง และข้อความที่ยาวมากๆ เพื่อทดสอบการตัด' } },
      ...Object.keys(_PROMAXX_STEP_TH).map((step) => ({ data: { ok: false, proto: 1, code: 'STEP_FAILED', step, message: 'ข้อความยาวมากๆ จากตัวช่วยที่ต้องถูกตัดให้สั้นลงเพื่อไม่ให้ล้นหน้าจอ' } })),
    ].map((r) => _adjPromaxxRunMessage(r, 'ORDS').text);
    return [
      ...runMsgs,
      `✅ บันทึกเข้า ProMaxx แล้ว · ${LONG} · 20 รายการ`,
      `นำเข้าไฟล์แล้ว · ${LONG} · 20 รายการ — ตรวจตารางแล้วกด ตกลง เอง`,
      'ยกเลิกแล้ว — ProMaxx ยังเปิดฟอร์มค้างอยู่ (ปิดเอง ไม่ต้องบันทึก)',
      'รายการกลับมาที่ตารางแล้ว — ProMaxx ยังไม่ได้บันทึก · ปิดฟอร์มใน ProMaxx ก่อนลองใหม่',
      'คืนรายการอัตโนมัติไม่สำเร็จ — กด ↩ คืนรายการใน 🗂️ ก่อนลองใหม่',
      'ไฟล์ไม่ผ่านการตรวจก่อนส่ง — แถว 20: LOT/EXP ไม่ถูกต้อง',
      'นำเข้า ProMaxx ได้ครั้งละไม่เกิน 20 รายการ — เปลี่ยนหน้าแล้วกดใหม่',
      'สิทธิ์หรือสาขาเปลี่ยนระหว่างรอ — กดบันทึกลง PROMAXX ใหม่',
      'ตั๋วหมดอายุ (เกิน 10 นาที) — กดบันทึกลง PROMAXX ใหม่',
      `⚠️ 20 รายการถูกส่งออกไปแล้วในเอกสาร ${LONG} — ไม่ได้นำเข้า ตรวจแล้วกดใหม่`,
      'สาขา/รอบนับเปลี่ยนระหว่างบันทึก — ไม่ได้นำเข้า ตรวจ 🗂️ ประวัติปรับปรุง',
    ];
  }, LONG);
  expect(samples.length).toBeGreaterThanOrEqual(30);
  const widths = await app.page.evaluate((samples) => samples.map((s) => {
    const c = document.getElementById('toastContainer'); c.innerHTML = '';
    toast(s, 'warn', 9000);
    const el = c.lastElementChild; el.style.animation = 'none';
    return [Math.round(el.getBoundingClientRect().width), s];
  }), samples);
  for (const [w, s] of widths) expect(w, s).toBeLessThanOrEqual(960);
  // toast ที่มีปุ่ม (ไฟล์ Text) — ความกว้างรวมปุ่ม
  const wa = await app.page.evaluate(() => {
    const c = document.getElementById('toastContainer'); c.innerHTML = '';
    toastAction('รายการอยู่ใน 🗂️ · ตรวจใน ProMaxx ก่อนทำซ้ำ', '⬇️ ไฟล์ Text', () => {}, 'error', 9000);
    const el = c.lastElementChild; el.style.animation = 'none';
    return Math.round(el.getBoundingClientRect().width);
  });
  expect(wa).toBeLessThanOrEqual(960);
  await closeApp(app);
});
