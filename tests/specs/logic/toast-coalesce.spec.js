// toast() บน PDA — รวมข้อความซ้ำ + จำกัด info/success ที่ซ้อนกัน + แบ็คอัพล้มเหลวไม่เตือนถี่ (ต.ค. 2026)
// ที่มา: toast() ต่อ element ใหม่ทุกครั้ง ไม่มีเพดาน ไม่รวมข้อความซ้ำ · ยิงต่อสแกนได้ (SKU ตรง / สแกนซ้ำของที่ Confirm แล้ว) ·
//       saveSession() ที่ localStorage เต็มจะเตือนซ้ำทุกรอบ save (4–12 วิ) ทั้งที่ต้อง stringify ทั้งก้อนก่อนล้มทุกรอบ
// ตรึง 4 ด้านคู่กัน: "ข้อความ+ชนิดเดียวกันที่ยังขึ้นอยู่ = ไม่ต่อ element ซ้ำ" ·
//   ★ "warn/error และ info/success ที่ call site ตั้งให้ค้างนาน (> 3 วิ) ห้ามถูกตัดและไม่นับเข้าเพดาน" (R16 ข้ามหน้าร้าน/OTFI/เตือนวันที่ ยิงพร้อมกันได้ถึง 4 อัน — ห้ามหายเงียบ) ·
//   ★ "toastAction (ปุ่ม ↩ เรียกคืน) ไม่ผ่านด่านนี้" · ★ "สวิตช์ปิด = ต่อ element ใหม่ทุกครั้งเหมือนก่อนแก้"
// ⚠️ ข้อ 3 ใช้ setTimeout ในหน้า (ตั้งใจ — เทสนี้ทดสอบ timer โดยตรง ไม่ใช่การรอสถานะ) เว้นระยะไว้ ≥200ms กันเครื่องช้า
const { test, expect, bootBare, newAppContext, waitForAppReady, closeApp } = require('../../lib/hooks');

test('ค่าเริ่มต้นที่ส่งมอบ — เปิดรวม toast · เพดาน 4 เฉพาะ info/success ที่อายุ ≤ 3 วิ · แบ็คอัพเตือนห่าง 1 นาที (อ่านจากหน้าที่เพิ่งบูต ไม่ผ่าน seed)', async ({ browser }) => {
  const app = await bootBare(browser);
  expect(await app.page.evaluate(() => [typeof TOAST_COALESCE, TOAST_COALESCE, TOAST_MAX_SOFT, TOAST_SOFT_MAX_MS, BACKUP_FAIL_TOAST_GAP_MS]))
    .toEqual(['boolean', true, 4, 3000, 60000]);
  await closeApp(app);
});

test('ข้อความ+ชนิดเดียวกันที่ยังขึ้นอยู่ = element เดียว · ต่างชนิดหรือต่างข้อความ = แยก', async ({ browser }) => {
  const app = await bootBare(browser);
  const out = await app.page.evaluate(() => {
    const c = document.getElementById('toastContainer'); c.replaceChildren();
    const n = () => c.querySelectorAll('.toast').length;
    const r = {};
    for (let i = 0; i < 5; i++) toast('ข้อความซ้ำ', 'warn');
    r.same = n();
    toast('ข้อความซ้ำ', 'error'); r.otherType = n();      // ชนิดต่าง = คนละสัญญาณ ห้ามรวมข้ามชนิด
    toast('ข้อความอื่น', 'warn'); r.otherText = n();
    r.texts = [...c.querySelectorAll('.toast')].map((t) => t.textContent);
    r.classes = [...c.querySelectorAll('.toast')].map((t) => t.className);
    return r;
  });
  expect(out.same).toBe(1);
  expect(out.otherType).toBe(2);
  expect(out.otherText).toBe(3);
  expect(out.texts).toEqual(['ข้อความซ้ำ', 'ข้อความซ้ำ', 'ข้อความอื่น']);
  expect(out.classes).toEqual(['toast toast-warn', 'toast toast-error', 'toast toast-warn']);   // รูปแบบ DOM เดิมไม่เปลี่ยน
  await closeApp(app);
});

test('ซ้ำ = ยืดเวลาเท่านั้น: ไม่หดเวลาที่ยาวกว่า · timer เดิมต้องไม่ยิงตัดก่อนหมดเวลาใหม่', async ({ browser }) => {
  const app = await bootBare(browser);
  const out = await app.page.evaluate(async () => {
    const c = document.getElementById('toastContainer'); c.replaceChildren();
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const q = () => [...c.querySelectorAll('.toast')];
    // (ก) ไม่หด/ยืดตาม ms ที่ขอ — ทำแบบกำหนดผลได้ ไม่พึ่งเวลา
    toast('ยาว', 'warn', 9000); const long = q()[0]; const e0 = long._end;
    toast('ยาว', 'warn', 100); const e1 = long._end;     // ขอสั้นกว่า = ห้ามหด
    toast('ยาว', 'warn', 9000); const e2 = long._end;    // ขอเท่าเดิม แต่ช้ากว่า = ต่อเวลา
    c.replaceChildren();
    // (ข) ซ้ำตอนใกล้หมดเวลา → ต้องอยู่ต่อจนหมดเวลาใหม่ แล้วค่อยหายไปเอง
    toast('ยืดเวลา', 'warn', 500); const el = q()[0];
    await sleep(300);
    toast('ยืดเวลา', 'warn', 500);                       // หมดใหม่ ≈ t+800
    const afterDup = q().length;
    await sleep(300);                                     // t≈600 — timer เดิม (500) ถ้ายังยิงอยู่ element จะเริ่มเฟดแล้ว
    const at600 = { n: q().length, leaving: !!el._leaving, inDom: el.isConnected };
    await sleep(800);                                     // t≈1400 — เกิน 800 + เฟด 350
    const at1400 = { n: q().length, inDom: el.isConnected };
    return { shrunk: e1 !== e0, extended: e2 >= e0, afterDup, at600, at1400 };
  });
  expect(out.shrunk).toBe(false);
  expect(out.extended).toBe(true);
  expect(out.afterDup).toBe(1);
  expect(out.at600).toEqual({ n: 1, leaving: false, inDom: true });
  expect(out.at1400).toEqual({ n: 0, inDom: false });
  await closeApp(app);
});

test('ซ้ำตอนอีกอันกำลังเฟดออก = ต้องได้อันใหม่ (ห้ามกลืนเงียบแล้วหายตามอันที่กำลังเฟด)', async ({ browser }) => {
  const app = await bootBare(browser);
  const out = await app.page.evaluate(() => {
    const c = document.getElementById('toastContainer'); c.replaceChildren();
    toast('กำลังเฟด', 'info');
    const old = c.querySelector('.toast');
    _toastFadeOut(old);                                   // เข้าช่วงเฟดออก (350ms) แต่ยังอยู่ใน DOM
    toast('กำลังเฟด', 'info');
    const els = [...c.querySelectorAll('.toast')];
    return { n: els.length, oldLeaving: !!els[0]._leaving, newLeaving: !!els[1]?._leaving };
  });
  expect(out).toEqual({ n: 2, oldLeaving: true, newLeaving: false });
  await closeApp(app);
});

test('เพดาน info/success = 4 — เกินแล้วเอาอันเก่าสุดออกจาก DOM ทันที · นับสองชนิดรวมกัน', async ({ browser }) => {
  const app = await bootBare(browser);
  const out = await app.page.evaluate(() => {
    const c = document.getElementById('toastContainer'); c.replaceChildren();
    const first = [];
    for (let i = 1; i <= 6; i++) { toast('t' + i, i % 2 ? 'info' : 'success'); first.push(c.querySelector('.toast')); }
    return {
      texts: [...c.querySelectorAll('.toast')].map((t) => t.textContent),
      evictedGone: !first[0].isConnected,                 // t1 ถูกดันออกจริง (ไม่ใช่แค่ซ่อน)
    };
  });
  expect(out.texts).toEqual(['t3', 't4', 't5', 't6']);
  expect(out.evictedGone).toBe(true);
  await closeApp(app);
});

test('★ info/success ที่ตั้งให้ค้างนาน (> 3 วิ) = สำคัญ ไม่ถูกตัดและไม่นับเข้าเพดาน · ขอบอยู่ที่ 3000ms พอดี', async ({ browser }) => {
  const app = await bootBare(browser);
  const out = await app.page.evaluate(() => {
    const c = document.getElementById('toastContainer'); c.replaceChildren();
    const texts = () => [...c.querySelectorAll('.toast')].map((t) => t.textContent);
    const r = {};
    // (ก) toast สำคัญ (5 วิ — เหมือน R16 ข้ามหน้าร้าน/OTFI) แล้วโดนสแกนสั้นๆ ท่วม
    toast('R16: ข้ามยอดขายหน้าร้าน 2 แถว', 'info', 5000);
    toast('R16: OTFI คลังโอนออก 1 แถว', 'success', 5000);
    for (let i = 1; i <= 10; i++) toast('s' + i, 'info');            // 2500ms = ค่าเริ่มต้น = อายุสั้น
    r.mixed = texts();
    // (ข) ขอบ: 3000 = อายุสั้น (ถูกเพดาน) · 3001 = สำคัญ (ไม่ถูก)
    c.replaceChildren();
    for (let i = 1; i <= 6; i++) toast('a' + i, 'info', 3000);
    r.at3000 = texts();
    c.replaceChildren();
    for (let i = 1; i <= 6; i++) toast('b' + i, 'info', 3001);
    r.at3001 = texts();
    return r;
  });
  expect(out.mixed).toEqual(['R16: ข้ามยอดขายหน้าร้าน 2 แถว', 'R16: OTFI คลังโอนออก 1 แถว', 's7', 's8', 's9', 's10']);
  expect(out.at3000).toEqual(['a3', 'a4', 'a5', 'a6']);
  expect(out.at3001).toEqual(['b1', 'b2', 'b3', 'b4', 'b5', 'b6']);
  await closeApp(app);
});

test('★ warn/error ห้ามถูกตัดและไม่นับเข้าเพดาน — เคส R16 ยิงพร้อมกัน 4 อัน', async ({ browser }) => {
  const app = await bootBare(browser);
  const out = await app.page.evaluate(() => {
    const c = document.getElementById('toastContainer'); c.replaceChildren();
    const texts = () => [...c.querySelectorAll('.toast')].map((t) => t.textContent);
    // (ก) warn/error จำนวนมากแล้วค่อยมี info ท่วม — warn/error ต้องอยู่ครบ
    toast('w1', 'warn'); toast('e1', 'error'); toast('w2', 'warn'); toast('e2', 'error');
    for (let i = 1; i <= 8; i++) toast('i' + i, 'info');
    const a = texts();
    c.replaceChildren();
    // (ข) ลำดับจริงของ loadR16(): ข้อความ Confirm + ข้ามหน้าร้าน + OTFI ทันที แล้วคำเตือนวันที่ตามมาทีหลัง — ต้องอยู่ครบ 4
    toast('กดปุ่ม Confirm เพื่อตรวจสอบสินค้า', 'success');
    toast('R16: ข้ามยอดขายหน้าร้าน 2 แถว (Col A=1)', 'info', 5000);
    toast('R16: OTFI คลังโอนออก 1 แถว (Col A=0) บวกกลับ', 'info', 5000);
    toast('⚠️ วันที่ R16 ไม่ตรงกับวันที่สแกน', 'warn', 7000);
    return { a, b: texts() };
  });
  expect(out.a).toEqual(['w1', 'e1', 'w2', 'e2', 'i5', 'i6', 'i7', 'i8']);
  expect(out.b).toHaveLength(4);
  expect(out.b.join('|')).toContain('ข้ามยอดขายหน้าร้าน 2 แถว');
  expect(out.b.join('|')).toContain('OTFI คลังโอนออก 1 แถว');
  expect(out.b.join('|')).toContain('ไม่ตรงกับวันที่สแกน');
  await closeApp(app);
});

test('★ toastAction (ปุ่ม ↩ เรียกคืน) ไม่ถูกรวมและไม่ถูกเพดานดันทิ้ง · ปุ่มยังทำงาน', async ({ browser }) => {
  const app = await bootBare(browser);
  const out = await app.page.evaluate(() => {
    const c = document.getElementById('toastContainer'); c.replaceChildren();
    let called = 0;
    toastAction('ซ่อนรายการแล้ว', '↩ เรียกคืน', () => { called++; }, 'info', 6000);
    toastAction('ซ่อนรายการแล้ว', '↩ เรียกคืน', () => { called++; }, 'info', 6000);   // ข้อความเดียวกัน — เดิมต่อเพิ่มเสมอ
    for (let i = 1; i <= 10; i++) toast('i' + i, 'info');                              // ท่วมจนชนเพดาน
    const actions = [...c.querySelectorAll('.toast')].filter((t) => t.querySelector('button'));
    const total = c.querySelectorAll('.toast').length;
    actions[0].querySelector('button').click();
    return { actions: actions.length, total, called, afterClick: c.querySelectorAll('.toast button').length };
  });
  expect(out).toEqual({ actions: 2, total: 6, called: 1, afterClick: 1 });   // 2 action + 4 info
  await closeApp(app);
});

test('★ สวิตช์ปิด (TOAST_COALESCE=false) = ต่อ element ใหม่ทุกครั้งเหมือนก่อนแก้ · ไม่มีเพดาน', async ({ browser }) => {
  const app = await bootBare(browser);
  const out = await app.page.evaluate(() => {
    TOAST_COALESCE = false;
    const c = document.getElementById('toastContainer'); c.replaceChildren();
    const n = () => c.querySelectorAll('.toast').length;
    for (let i = 0; i < 3; i++) toast('ซ้ำ', 'warn');
    const dup = n();
    for (let i = 1; i <= 7; i++) toast('i' + i, 'info');
    return { dup, all: n() };
  });
  expect(out).toEqual({ dup: 3, all: 10 });
  await closeApp(app);
});

test('คีย์รวมข้อความคือข้อความที่ผู้ใช้เห็นจริง — บน PDA สองข้อความที่ย่อแล้วเหมือนกันรวมเป็นอันเดียว', async ({ browser }) => {
  const app = await newAppContext(browser, { login: false, mode: 'pda' });
  await app.page.goto('/index.html');
  await waitForAppReady(app.page, { login: false });
  const out = await app.page.evaluate(() => {
    const c = document.getElementById('toastContainer'); c.replaceChildren();
    toast('R01.102: โหลดแล้ว', 'info');      // _toastMessageForDevice ย่อเป็น 'R01: โหลดแล้ว' บน StockCountPDA
    toast('R01: โหลดแล้ว', 'info');
    return [...c.querySelectorAll('.toast')].map((t) => t.textContent);
  });
  expect(out).toEqual(['R01: โหลดแล้ว']);
  await closeApp(app);
});

// ───────── saveSession() — แบ็คอัพล้มเหลว ─────────

// localStorage.setItem ล้มทุกครั้ง (เหมือน quota เต็ม) · _adminMode=true ไม่ให้ saveSession ตั้ง timer syncToFirestore
// นับ "จำนวนครั้งที่เรียก toast" ผ่านตัวห่อ — ถ้าดูแค่ DOM จะแยกไม่ออกว่าเป็นผลของ throttle หรือของการรวมข้อความซ้ำ
function failingSaves(page, steps) {
  return page.evaluate((steps) => {
    const realSet = Storage.prototype.setItem, realToast = toast, calls = [];
    Storage.prototype.setItem = function () { throw new DOMException('quota', 'QuotaExceededError'); };
    toast = (m, t, ms) => { calls.push(`${t}|${m}`); return realToast(m, t, ms); };
    _adminMode = true; _backupFailToastAt = 0;
    const out = [];
    try {
      for (const s of steps) {
        if (s.rewind) _backupFailToastAt -= s.rewind;
        if (s.coalesce !== undefined) TOAST_COALESCE = s.coalesce;
        for (let i = 0; i < s.saves; i++) saveSession();
        out.push(calls.filter((m) => m.startsWith('warn|แบ็คอัพล้มเหลว')).length);   // ชนิด warn ต้องคงเดิม · ข้อความต่อท้ายตามสาเหตุ (backup-quota-heal)
      }
    } finally { Storage.prototype.setItem = realSet; toast = realToast; _adminMode = false; }
    return out;
  }, steps);
}

test('แบ็คอัพล้มเหลว: เตือนครั้งแรกทันที แล้วห่างอย่างน้อย 1 นาที · ผ่านไป 1 นาทีเตือนอีก', async ({ browser }) => {
  const app = await bootBare(browser);
  const counts = await failingSaves(app.page, [
    { saves: 1 },                  // ครั้งแรก → เตือนทันที
    { saves: 5 },                  // ล้มต่ออีก 5 รอบ → ไม่เตือนซ้ำ
    { saves: 1, rewind: 59000 },   // ผ่านไป ~59 วิ → ยังไม่ถึง
    { saves: 1, rewind: 2000 },    // รวม ~61 วิ → เตือนอีก
  ]);
  expect(counts).toEqual([1, 1, 1, 2]);
  await closeApp(app);
});

test('★ แบ็คอัพล้มเหลว + สวิตช์ปิด = เตือนทุกครั้งเหมือนเดิม', async ({ browser }) => {
  const app = await bootBare(browser);
  const counts = await failingSaves(app.page, [{ saves: 4, coalesce: false }]);
  expect(counts).toEqual([4]);
  await closeApp(app);
});

test('save ที่สำเร็จไม่เตือน และไม่กินสิทธิ์เตือนครั้งแรก', async ({ browser }) => {
  const app = await bootBare(browser);
  const out = await app.page.evaluate(() => {
    const c = document.getElementById('toastContainer'); c.replaceChildren();
    _adminMode = true; _backupFailToastAt = 0;
    try { saveSession(); } finally { _adminMode = false; }
    return { toasts: c.querySelectorAll('.toast').length, gate: _backupFailToastAt };
  });
  expect(out).toEqual({ toasts: 0, gate: 0 });
  await closeApp(app);
});
