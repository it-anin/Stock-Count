// ใบ 📦 ปรับปรุงสินค้า: 🗂️ ประวัติปรับปรุง (7 ต.ค. 2026 · ผู้ใช้สั่ง)
//   ปุ่ม Header ของ 📦 · Export Text ต้องกรอก "เลขที่เอกสาร" ก่อนดาวน์โหลด · กรอกแล้วแถวในไฟล์ย้ายไปประวัติและหายจากตาราง
//   สวิตช์ ADJUST_DOC_HISTORY (false = ไม่มีปุ่ม/ช่องเลขที่เอกสาร/การซ่อนแถว = ทางถอย) · ที่เก็บ stock_sessions/{branch}_adjhist (fake Firestore: get + runTransaction)
//
// เทสนี้ตรึง 12 ด้าน — ข้อ 1–2 · 5–6 สำคัญที่สุด: "ไฟล์กับประวัติ/ตารางต้องตรงกัน" และ "เขียน cloud ไม่ผ่านต้องไม่เกิดอะไรขึ้นเลย (atomic)"
//   1. ★ Export Text → modal เลขที่เอกสาร → ดาวน์โหลด · แถวในไฟล์ (20 แถวของหน้าที่เห็น) หายจากตาราง หน้าถัดไปเลื่อนมาเป็นหน้า 1 · ป้ายปุ่ม 📦/ปุ่มประวัติลดตาม
//   2. ★ ช่องว่าง = ไม่ดาวน์โหลดและไม่เขียนอะไร · พิมพ์เล็ก/เว้นวรรค → ตัวพิมพ์ใหญ่ไม่มีช่องว่าง · เลขซ้ำถูกบล็อก · ไม่ขึ้นต้น ORDS/IRPS = เตือนแต่ไม่บล็อก
//   3. ส่งออกต่อทีละหน้าจนตารางว่าง (หน้าสุดท้ายหน้าเดียว = ไม่มี _pN) · ชื่อไฟล์ใช้เลขที่เอกสาร
//   4. ตาราง/หน้าเปลี่ยนระหว่าง modal เปิดอยู่ → ไม่ส่งออกของที่ผู้ใช้ไม่ได้เห็น (ลายนิ้วมือ)
//   5. ★ cloud ล้ม/ไม่มี _db → ไม่ดาวน์โหลด ไม่ล้างตาราง ไม่มี state ค้าง · กดใหม่หลังกลับมาได้ผลปกติ
//   6. ★ สองเครื่อง: เลขที่เอกสารซ้ำ / แถวทับกับเอกสารของอีกเครื่อง → บล็อก ไม่ดาวน์โหลด แต่ตารางอัปเดตตาม cloud
//   7. คีย์ซ่อนแถว dir|sku|base: ผลต่างเปลี่ยน/ทิศกลับ → แถวโผล่กลับเอง · แถวที่แก้เป็น 0 ไม่ถูกบันทึก/ไม่ถูกซ่อน
//   8. ป็อปอัพประวัติ: รายการเอกสาร · ขยายดูรายการ (ข้อมูลที่แช่ไว้ตอน Export) · Status = "ยังไม่เข้า" · ↩ คืนรายการ 2 ขั้น → แถวกลับ ใช้เลขเดิมได้
//   9. ผูกรอบนับ: เริ่มรอบใหม่ = ว่าง · doc รอบเก่าบน cloud ถูกแทนที่ตอน Export ครั้งแรกของรอบใหม่
//  10. Export Excel ไม่ถามเลขที่เอกสาร แต่ไม่เห็นแถวที่ย้ายไปประวัติแล้ว · การ์ด ERP ไม่รายงาน SKU ที่ส่งออกแล้วเป็น "มีใบใน ERP แต่ไม่อยู่ในแท็บนี้"
//  11. WH (supervisor): ใช้ได้เหมือนกัน (doc WH_adjhist) · role ที่ไม่มีสิทธิ์ = เส้นทางเดิม
//  12. ทางถอย: สวิตช์ปิด = ไม่มีปุ่ม/modal · Export Text ชื่อไฟล์เดิม (_p1) · แถวที่เคยส่งออกโผล่กลับ · exportAdjustDocText() เรียกตรง = เหมือนเดิมทุกไบต์ (เทส 📦 เดิมพึ่งพา)
const { test, expect, bootBare, closeApp } = require('../../lib/hooks');

const T = '2026-09-20 09:00:00';
const EPOCH = '2026-09-20T00:00:00.000Z';
// Stock Adj ตรงของสาขายา (ตัวเลขแช่ไว้ตอน Confirm) — ผลต่าง = effectiveQty − systemQty
const DIRECT = (extra = {}) => ({ status: 'stock_adjustment', auditStatus: 'stock_adjustment', initialStatus: 'stock_adjustment', auditor: '',
  countedQty: 8, timestamp: T, firstScanAt: T, scannedBy: 'Asst', directAdj: true, ...extra });

// nO แถว ORDS (O001…: 8−10 = ขาด 2) + nI แถว IRPS (I001…: 13−10 = เกิน 3) · fake Firestore เฉพาะที่ใช้: doc().get() + runTransaction(get/set)
async function seed(page, { nO = 45, nI = 25, role = 'pharmacist', branch = 'SRC' } = {}) {
  await page.evaluate(({ nO, nI, role, branch, tpl, epoch }) => {
    ADJUST_DOC_PAGE_SIZE = 20; ADJUST_DOC_QTY_EDIT = true; ADJUST_DOC_EXPORT_TEXT_BY_PAGE = true; ADJUST_DOC_HISTORY = true;
    currentBranch = branch; currentRole = role; currentUser = 'Pharm'; _countResetAt = epoch;
    _branchScanPaused = false; _adjDocFilter = 'ords'; _adjDocPage = 1; _adjLoading = false;
    _adjHist = null; _adjHistReadToken++; _adjHistBusy = false; _adjHistExpanded.clear(); _adjHistUndoArm = ''; _adjErp = null; _adjErpFilter = 'all';
    _lotMap.clear(); _lotSelected.clear(); _priceMap.clear();
    state.skuMap.clear(); state.scanData.clear(); state.skuDirectMap.clear(); scanListMap.clear();
    document.getElementById('adjustDocPopupOverlay').style.display = 'flex';            // ผู้ใช้ Export ตอนป็อปอัพ 📦 เปิดอยู่ — _adjHistRefreshUi วาดตารางเฉพาะตอนเปิด
    document.getElementById('adjHistPopupOverlay').style.display = 'none'; document.getElementById('adjDocNoModal').style.display = 'none';
    window.__marked = []; _markSkuDirty = (s) => { window.__marked.push(String(s)); };   // ไม่แตะ Firestore
    window.__toasts = []; toast = (m) => { window.__toasts.push(String(m)); };
    _refreshAdjMaster = async () => {};                                                  // openAdjustDocPopup ต้องไม่ยิง Supabase
    window.__exports = []; window.__downloads = [];
    URL.createObjectURL = (b) => { window.__exports.push(b); return 'blob:captured'; };
    URL.revokeObjectURL = () => {};
    HTMLAnchorElement.prototype.click = function () { window.__downloads.push(this.download); };   // ชื่อไฟล์ที่เบราว์เซอร์จะบันทึก
    // fake Firestore: store คือ "cloud" ที่ทุกเครื่องในเทสแชร์กัน (จำลองเครื่องอื่นด้วยการเขียน store ตรงๆ)
    window.__store = {}; window.__fail = null; window.__writes = 0;
    const doc = (p) => ({ path: p, get: async () => { const d = window.__store[p]; return { exists: !!d, data: () => d }; } });
    _db = {
      collection: (c) => ({ doc: (id) => doc(c + '/' + id) }),
      runTransaction: async (fn) => {
        if (window.__fail) throw new Error(window.__fail);
        let pending = null;
        await fn({ get: async (r) => { const d = window.__store[r.path]; return { exists: !!d, data: () => d }; }, set: (r, data) => { pending = [r.path, data]; } });
        if (pending) { window.__writes++; window.__store[pending[0]] = { ...pending[1], updatedAt: { toDate: () => new Date('2026-10-07T09:05:00.000Z') } }; }
      },
    };
    const pad = (n) => String(n).padStart(3, '0');
    if (branch === 'WH') {
      // WH: ผลต่างคิดจาก sd.systemQty (ยอด R01 วัน Recheck ที่แช่ไว้) กับ recheckQty
      const addWh = (sku, rq) => {
        state.skuMap.set(sku, { sku, productName: 'สินค้า ' + sku, unitPrice: 20, systemQty: 10, negSys: false, barcodes: [], isDel: false });
        state.skuDirectMap.set(sku, { barcode: 'B' + sku, unitName: 'เม็ด' });
        state.scanData.set(sku, { status: 'stock_adjustment', auditStatus: 'stock_adjustment', initialStatus: 'audit', auditor: 'Sup', countedQty: 9, recheckQty: rq, systemQty: 10, timestamp: tpl.timestamp, firstScanAt: tpl.firstScanAt });
      };
      for (let i = 1; i <= nO; i++) addWh('O' + pad(i), 8);
      for (let i = 1; i <= nI; i++) addWh('I' + pad(i), 13);
      return;
    }
    const add = (sku, eff) => {
      state.skuMap.set(sku, { sku, productName: 'สินค้า ' + sku, unitPrice: 20, systemQty: 10, negSys: false, barcodes: [], isDel: false });
      state.skuDirectMap.set(sku, { barcode: 'B' + sku, unitName: 'เม็ด' });
      state.scanData.set(sku, { ...tpl, effectiveQty: eff, systemQty: 10 });
    };
    for (let i = 1; i <= nO; i++) add('O' + pad(i), 8);
    for (let i = 1; i <= nI; i++) add('I' + pad(i), 13);
  }, { nO, nI, role, branch, tpl: DIRECT(), epoch: EPOCH });
}

const ids = (p, a, b) => Array.from({ length: b - a + 1 }, (_, i) => p + String(a + i).padStart(3, '0'));
const render = (page) => page.evaluate(() => { renderAdjustDocTable(true); updateAdjustDocCount(); });
// สิ่งที่ผู้ใช้เห็นบนจอ ณ ตอนนี้
const read = (page) => page.evaluate(() => {
  const rows = [...document.querySelectorAll('#adjustDocBody tr')].filter((tr) => tr.children.length > 1);
  const hb = document.getElementById('adjHistBtn');
  return {
    skus: rows.map((tr) => tr.children[1].textContent.trim()),
    count: document.getElementById('adjustDocRowCount').textContent,
    badge: document.getElementById('adjustDocCount').textContent,
    histBtn: hb.style.display === 'none' ? null : document.getElementById('adjHistCount').textContent,
    exportBtn: document.getElementById('adjExportTextBtn').textContent,
    page: _adjDocPage,
  };
});
const modal = (page) => page.evaluate(() => {
  const m = document.getElementById('adjDocNoModal');
  return { open: m.style.display === 'flex', summary: document.getElementById('adjDocNoSummary').textContent, err: document.getElementById('adjDocNoErr').textContent,
    errColor: document.getElementById('adjDocNoErr').style.color, ok: document.getElementById('adjDocNoOk').textContent, okDisabled: document.getElementById('adjDocNoOk').disabled };
});
const clickExport = (page) => page.evaluate(() => document.getElementById('adjExportTextBtn').click());   // ผ่าน onclick จริงของปุ่ม
const typeNo = (page, v) => page.evaluate((v) => { const i = document.getElementById('adjDocNoInput'); i.value = v; i.dispatchEvent(new Event('input', { bubbles: true })); }, v);
const submit = (page) => page.evaluate(async () => { await confirmAdjDocNo(); });
const exportWith = async (page, no) => { await clickExport(page); await typeNo(page, no); await submit(page); };
const store = (page, key = 'stock_sessions/SRC_adjhist') => page.evaluate((k) => {
  const d = window.__store[k]; if (!d) return null;
  return { epoch: d.countResetAt, by: d.updatedBy, entries: JSON.parse(d.entries_json) };
}, key);
const files = (page) => page.evaluate(() => window.__downloads.slice());
const lastText = (page) => page.evaluate(() => window.__exports.length ? window.__exports[window.__exports.length - 1].text() : null);
const toasts = (page) => page.evaluate(() => window.__toasts.slice());
const lines = (text) => text.trim().split('\r\n').map((l) => l.split('\t').slice(0, 2));
const FILE = (no, dir = 'ords') => new RegExp(`^stockadj_${dir}_${no}_\\d{2}-\\d{2}-\\d{4}\\.txt$`);

test('ค่าเริ่มต้นที่ส่งมอบ: ADJUST_DOC_HISTORY=true · เพดานประวัติ 800 KB (ปิดโดยไม่ตั้งใจ = ปุ่ม Export Text กลับไปเส้นทางเดิมเงียบๆ) · ปุ่ม/modal/ป็อปอัพมีครบใน DOM', async ({ browser }) => {
  const app = await bootBare(browser);                                                   // ยังไม่เรียก seed — ค่าตามที่ index.html ส่งมอบ
  expect(await app.page.evaluate(() => [ADJUST_DOC_HISTORY, ADJ_HIST_MAX_KB])).toEqual([true, 800]);
  expect(await app.page.evaluate(() => ['adjHistBtn', 'adjHistCount', 'adjHistPopupOverlay', 'adjHistBody', 'adjDocNoModal', 'adjDocNoInput', 'adjDocNoOk', 'adjDocNoErr', 'adjDocNoSummary'].map((id) => !!document.getElementById(id)))).toEqual(Array(9).fill(true));
  // ปุ่มประวัติอยู่ที่แถบ Header ของป็อปอัพ 📦 (ใน .stock-popup-header ข้างปุ่มปิด)
  expect(await app.page.evaluate(() => { const b = document.getElementById('adjHistBtn'); return b.closest('#adjustDocPopupCard .stock-popup-header') !== null && b.textContent.includes('ประวัติปรับปรุง'); })).toBe(true);
  // ปุ่ม Export Text เรียกตัวใหม่ (ไม่ใช่ exportAdjustDocText ตรงๆ — ไม่งั้นข้ามช่องเลขที่เอกสาร)
  expect(await app.page.evaluate(() => document.getElementById('adjExportTextBtn').getAttribute('onclick'))).toBe('onAdjExportTextClick()');
  await closeApp(app);
});

test('Export Text → กรอกเลขที่เอกสาร → ไฟล์ตรงกับ 20 แถวที่เห็น · แถวหายจากตาราง หน้าถัดไปเลื่อนมา · ป้ายปุ่มลดตาม · เก็บเข้าประวัติ', async ({ browser }) => {
  const app = await bootBare(browser);
  await seed(app.page);
  await render(app.page);
  expect(await read(app.page)).toMatchObject({ skus: ids('O', 1, 20), count: '45 รายการ', badge: '70', histBtn: '0', exportBtn: '⬇️ Export Text · หน้า 1/3' });

  // กดปุ่มจริง → modal ขึ้น (ยังไม่ดาวน์โหลด · ยังไม่เขียน cloud)
  await clickExport(app.page);
  expect(await modal(app.page)).toMatchObject({ open: true, summary: 'ORDS · 20 รายการ · หน้า 1/3 (แถวที่ 1–20 จาก 45)', err: '' });
  expect(await files(app.page)).toEqual([]);
  expect(await store(app.page)).toBeNull();

  // กรอกแล้วดาวน์โหลด
  await typeNo(app.page, 'ordsby001'); await submit(app.page);
  expect((await modal(app.page)).open).toBe(false);
  const fn = await files(app.page);
  expect(fn).toHaveLength(1);
  expect(fn[0]).toMatch(FILE('ORDSBY001'));
  expect(lines(await lastText(app.page))).toEqual(ids('O', 1, 20).map((s) => [s, '2']));   // ไฟล์ = 20 แถวที่เห็นก่อนกด

  // ตาราง: 20 แถวนั้นหาย · O021… เลื่อนมาเป็นหน้า 1 (ยังเหลือ 25 → 2 หน้า) · ป้ายตัวเลขลดตาม · ปุ่มประวัติ = 1
  expect(await read(app.page)).toMatchObject({ skus: ids('O', 21, 40), count: '25 รายการ', badge: '50', histBtn: '1', exportBtn: '⬇️ Export Text · หน้า 1/2', page: 1 });
  const st = await store(app.page);
  expect(st.epoch).toBe(EPOCH);
  expect(st.by).toBe('Pharm');
  expect(st.entries).toHaveLength(1);
  expect(st.entries[0]).toMatchObject({ no: 'ORDSBY001', dir: 'ords', by: 'Pharm' });
  expect(st.entries[0].rows).toHaveLength(20);
  expect(st.entries[0].rows[0]).toEqual(['O001', 2, 2, null, '', '']);                  // [sku, qty, base, price, lot, exp] — ไม่มีราคา/LOT = null/ว่าง
  expect(st.entries[0].rows.map((r) => r[0])).toEqual(ids('O', 1, 20));
  expect((await toasts(app.page)).some((t) => t === 'Export ORDS 20 รายการ → 🗂️ ORDSBY001')).toBe(true);
  // ไม่แตะ scanData/items: ไม่มีการ mark SKU ใดขึ้น Cloud · สถานะยังเป็น Stock Adj
  expect(await app.page.evaluate(() => window.__marked)).toEqual([]);
  expect(await app.page.evaluate(() => state.scanData.get('O001').status)).toBe('stock_adjustment');
  await closeApp(app);
});

test('ช่องว่าง/เลขซ้ำ = บล็อก · พิมพ์เล็กและเว้นวรรคถูกแปลง · ไม่ขึ้นต้น ORDS/IRPS = เตือนแต่ไม่บล็อก', async ({ browser }) => {
  const app = await bootBare(browser);
  await seed(app.page);
  await render(app.page);

  // ว่าง/มีแต่ช่องว่าง → ไม่ดาวน์โหลด ไม่เขียน · modal ค้างพร้อมข้อความ
  await clickExport(app.page);
  await submit(app.page);
  expect(await modal(app.page)).toMatchObject({ open: true, err: 'กรุณากรอกเลขที่เอกสารก่อนดาวน์โหลด' });
  await typeNo(app.page, '   '); await submit(app.page);
  expect((await modal(app.page)).err).toBe('กรุณากรอกเลขที่เอกสารก่อนดาวน์โหลด');
  expect(await files(app.page)).toEqual([]);
  expect(await store(app.page)).toBeNull();
  expect((await read(app.page)).skus).toEqual(ids('O', 1, 20));

  // ยาวเกิน 40
  await typeNo(app.page, 'X'.repeat(41)); await submit(app.page);
  expect((await modal(app.page)).err).toBe('เลขที่เอกสารยาวเกิน 40 ตัวอักษร');
  expect(await files(app.page)).toEqual([]);

  // ไม่ขึ้นต้น ORDS = เตือนสีเหลือง แต่ยังกดได้ (ไม่บล็อก) · ขึ้นต้นถูกต้อง = ไม่มีคำเตือน
  await typeNo(app.page, 'irps-001');
  expect(await modal(app.page)).toMatchObject({ err: 'ℹ️ ไม่ได้ขึ้นต้นด้วย ORDS — ตรวจเลขที่เอกสารอีกครั้ง (ยังดาวน์โหลดได้)', errColor: 'var(--yellow)' });
  await typeNo(app.page, 'ords-001');
  expect((await modal(app.page)).err).toBe('');
  await typeNo(app.page, ' ords 6910 / 0001 ');                                          // เว้นวรรคทุกตำแหน่งถูกตัด + ตัวพิมพ์ใหญ่
  await submit(app.page);
  expect((await store(app.page)).entries[0].no).toBe('ORDS6910/0001');
  expect((await files(app.page))[0]).toMatch(/^stockadj_ords_ORDS6910_0001_\d{2}-\d{2}-\d{4}\.txt$/);   // ชื่อไฟล์: อักขระนอก A-Z0-9_.- → _

  // เลขซ้ำ (แม้พิมพ์ต่างตัวพิมพ์) → บล็อก · ไม่มีไฟล์ที่สอง · modal ค้าง
  await clickExport(app.page);
  await typeNo(app.page, 'ords6910/0001'); await submit(app.page);
  expect((await modal(app.page)).open).toBe(true);
  expect((await modal(app.page)).err).toMatch(/^เลขที่เอกสารนี้ถูกใช้แล้ว \(\d{2}\/\d{2}\/\d{4} \d{2}:\d{2} · Pharm\) — ใช้เลขอื่น$/);
  expect(await files(app.page)).toHaveLength(1);
  expect((await store(app.page)).entries).toHaveLength(1);
  // ยกเลิก (ปุ่ม) → ปิด · ไม่มีอะไรเปลี่ยน
  await app.page.evaluate(() => closeAdjDocNoModal());
  expect((await modal(app.page)).open).toBe(false);
  expect((await read(app.page)).skus).toEqual(ids('O', 21, 40));
  await closeApp(app);
});

test('คีย์บอร์ด/เมาส์ใน modal: Enter = ดาวน์โหลด (เครื่องยิงบาร์โค้ดส่ง Enter ปิดท้ายได้) · Esc = ยกเลิก · คลิกฉากหลัง = ยกเลิก · คลิกในกล่อง/กำลังบันทึก = ไม่ปิด', async ({ browser }) => {
  const app = await bootBare(browser);
  await seed(app.page);
  await render(app.page);
  const key = (k) => app.page.evaluate((k) => document.getElementById('adjDocNoInput').dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })), k);
  await clickExport(app.page);
  await typeNo(app.page, 'ORDSKB001');
  await key('Escape');                                                                   // Esc = ยกเลิก — ไม่เขียน ไม่ดาวน์โหลด
  expect((await modal(app.page)).open).toBe(false);
  expect(await store(app.page)).toBeNull();
  expect(await files(app.page)).toEqual([]);

  await clickExport(app.page);                                                           // เปิดใหม่ → ช่องว่างเสมอ (ไม่จำค่าเดิม)
  expect(await app.page.evaluate(() => document.getElementById('adjDocNoInput').value)).toBe('');
  await app.page.evaluate(() => document.getElementById('adjDocNoCard').click());         // คลิกในกล่อง = ไม่ปิด
  expect((await modal(app.page)).open).toBe(true);
  await app.page.evaluate(() => document.getElementById('adjDocNoModal').click());        // คลิกฉากหลัง = ปิด
  expect((await modal(app.page)).open).toBe(false);

  await clickExport(app.page);
  await typeNo(app.page, 'ORDSKB002');
  await key('Enter');                                                                    // Enter = ดาวน์โหลด (confirmAdjDocNo ไม่ได้ await — รอผล)
  await app.page.waitForFunction(() => !_adjHistBusy && window.__downloads.length === 1, null, { timeout: 5000, polling: 50 });
  expect((await store(app.page)).entries.map((e) => e.no)).toEqual(['ORDSKB002']);
  expect((await files(app.page))[0]).toMatch(FILE('ORDSKB002'));

  // กำลังบันทึก (busy) → Esc/คลิกฉากหลัง/ปุ่มปิดไม่ทำให้ modal หาย (ไม่งั้นไฟล์ดาวน์โหลดแต่ผู้ใช้ไม่เห็นผล)
  await clickExport(app.page);
  await app.page.evaluate(() => { _adjHistBusy = true; });
  await key('Escape');
  await app.page.evaluate(() => document.getElementById('adjDocNoModal').click());
  expect((await modal(app.page)).open).toBe(true);
  await app.page.evaluate(() => { _adjHistBusy = false; closeAdjDocNoModal(); });
  expect((await modal(app.page)).open).toBe(false);
  await closeApp(app);
});

test('ส่งออกต่อทีละหน้าจนตารางว่าง · หน้าสุดท้ายหน้าเดียว = ไม่มี _pN · ชื่อไฟล์ใช้เลขที่เอกสาร · ไฟล์ทุกหน้ารวมกันครบไม่ซ้ำไม่ตก', async ({ browser }) => {
  const app = await bootBare(browser);
  await seed(app.page);
  await render(app.page);
  await exportWith(app.page, 'ORDSBY001');
  await exportWith(app.page, 'ORDSBY002');
  expect(await read(app.page)).toMatchObject({ skus: ids('O', 41, 45), count: '5 รายการ', exportBtn: '⬇️ Export Text', histBtn: '2' });   // เหลือ 5 = หน้าเดียว
  await clickExport(app.page);
  expect((await modal(app.page)).summary).toBe('ORDS · 5 รายการ');                       // หน้าเดียว = ไม่มีข้อความ "หน้า X/Y"
  await typeNo(app.page, 'ORDSBY003'); await submit(app.page);
  expect(await read(app.page)).toMatchObject({ skus: [], count: '0 รายการ', histBtn: '3', badge: '25' });
  expect(await app.page.evaluate(() => document.getElementById('adjustDocBody').textContent)).toContain('ไม่มีรายการ');
  expect(await files(app.page)).toEqual([...['ORDSBY001', 'ORDSBY002', 'ORDSBY003']].map((n) => expect.stringMatching(FILE(n))));

  const texts = await app.page.evaluate(async () => Promise.all(window.__exports.map((b) => b.text())));
  expect(texts.flatMap((t) => lines(t).map((l) => l[0]))).toEqual(ids('O', 1, 45));        // ครบ 45 ไม่ซ้ำไม่ตก ตามลำดับ
  const st = await store(app.page);
  expect(st.entries.map((e) => [e.no, e.rows.length])).toEqual([['ORDSBY001', 20], ['ORDSBY002', 20], ['ORDSBY003', 5]]);

  // IRPS ไม่ถูกแตะ · ส่งออกแยกเอกสาร (ทิศ irps)
  await app.page.evaluate(() => setAdjDocFilter('irps', document.getElementById('adjBtnIrps')));
  expect((await read(app.page)).skus).toEqual(ids('I', 1, 20));
  await exportWith(app.page, 'IRPSBY001');
  expect((await files(app.page))[3]).toMatch(FILE('IRPSBY001', 'irps'));
  expect((await store(app.page)).entries[3]).toMatchObject({ no: 'IRPSBY001', dir: 'irps' });
  expect((await store(app.page)).entries[3].rows[0]).toEqual(['I001', 3, 3, null, '', '']);
  expect((await read(app.page)).skus).toEqual(ids('I', 21, 25));
  await closeApp(app);
});

test('ตาราง/หน้าเปลี่ยนระหว่าง modal เปิดอยู่ → ไม่ส่งออกของที่ผู้ใช้ไม่ได้เห็น (ลายนิ้วมือ) · กดอีกครั้งหลังตรวจสรุปจึงส่งออกชุดใหม่', async ({ browser }) => {
  const app = await bootBare(browser);
  await seed(app.page);
  await render(app.page);
  await clickExport(app.page);
  await typeNo(app.page, 'ORDSBY001');
  // ระหว่างรอ (1): เภสัชแก้จำนวนของ O001 จาก 2 เป็น 1 (SKU ชุดเดิมเป๊ะ — ต่างแค่จำนวน) → ลายนิ้วมือต้องนับจำนวนด้วย
  await app.page.evaluate(() => { const a = state.scanData.get('O001'); a.adjQty = 1; a.adjBase = -2; });
  await submit(app.page);
  expect(await files(app.page)).toEqual([]);
  expect((await modal(app.page)).err).toBe('รายการในหน้านี้เปลี่ยนไประหว่างรอ — ตรวจสรุปด้านบนอีกครั้ง แล้วกดดาวน์โหลดอีกครั้ง');
  await app.page.evaluate(() => { _clearAdjQty(state.scanData.get('O001')); });           // คืนค่า → กลับเป็นชุดเดิม แต่ลายนิ้วมือใหม่ถูกตั้งไปแล้ว (ต้องเทียบกับชุดที่แสดงล่าสุด)
  await submit(app.page);
  expect(await files(app.page)).toEqual([]);                                             // ต่างจากที่เห็นในสรุปล่าสุด (จำนวน 1) → ยังไม่ส่ง
  // ระหว่างรอ (2): แถว O005 หายจากใบ (เช่นอีกเครื่อง ↺/ยืนยันรีเช็ค) → หน้าที่เห็นเปลี่ยน (O021 เลื่อนเข้ามา)
  await app.page.evaluate(() => { state.scanData.delete('O005'); });
  await submit(app.page);
  expect(await files(app.page)).toEqual([]);
  expect(await store(app.page)).toBeNull();
  expect(await modal(app.page)).toMatchObject({ open: true, summary: 'ORDS · 20 รายการ · หน้า 1/3 (แถวที่ 1–20 จาก 44)', err: 'รายการในหน้านี้เปลี่ยนไประหว่างรอ — ตรวจสรุปด้านบนอีกครั้ง แล้วกดดาวน์โหลดอีกครั้ง' });
  // กดอีกครั้ง → ส่งออกชุดที่แสดงในสรุปใหม่
  await submit(app.page);
  expect(lines(await lastText(app.page)).map((l) => l[0])).toEqual([...ids('O', 1, 4), ...ids('O', 6, 21)]);
  expect((await store(app.page)).entries[0].rows.map((r) => r[0])).toEqual([...ids('O', 1, 4), ...ids('O', 6, 21)]);

  // ระหว่างรอ: แถวหายหมดจนไม่เหลือให้ส่ง → ปิด modal + toast (ไม่มีไฟล์เพิ่ม)
  await app.page.evaluate(() => { setAdjDocFilter('irps', document.getElementById('adjBtnIrps')); });
  await clickExport(app.page); await typeNo(app.page, 'IRPSBY001');
  await app.page.evaluate(() => { for (const k of [...state.scanData.keys()]) if (k.startsWith('I')) state.scanData.delete(k); });
  await submit(app.page);
  expect((await modal(app.page)).open).toBe(false);
  expect((await toasts(app.page)).at(-1)).toBe('รายการในหน้านี้เปลี่ยนไปและไม่เหลือให้ Export แล้ว');
  expect(await files(app.page)).toHaveLength(1);
  await closeApp(app);
});

test('cloud ล้ม/ไม่มี Firestore → ไม่ดาวน์โหลด ไม่ล้างตาราง ไม่มีประวัติค้าง (atomic) · กลับมาออนไลน์แล้วกดใหม่ได้ผลปกติ', async ({ browser }) => {
  const app = await bootBare(browser);
  await seed(app.page);
  await render(app.page);

  await app.page.evaluate(() => { window.__fail = 'unavailable'; });
  await exportWith(app.page, 'ORDSBY001');
  expect(await modal(app.page)).toMatchObject({ open: true, err: 'บันทึกประวัติขึ้น Cloud ไม่สำเร็จ (unavailable) — ยังไม่ได้ดาวน์โหลดและไม่ได้ล้างตาราง ลองใหม่', okDisabled: false, ok: '⬇️ ดาวน์โหลด' });
  expect(await files(app.page)).toEqual([]);
  expect(await store(app.page)).toBeNull();
  expect(await app.page.evaluate(() => _adjHist)).toBeNull();
  expect(await read(app.page)).toMatchObject({ skus: ids('O', 1, 20), count: '45 รายการ', badge: '70', histBtn: '0' });
  expect(await app.page.evaluate(() => _adjHistBusy)).toBe(false);                      // ปลดล็อกกันกดซ้ำแล้ว — ลองใหม่ได้

  // ไม่มี Firestore เลย (ออฟไลน์/ยังไม่เชื่อมต่อ)
  await app.page.evaluate(() => { window.__fail = null; window.__db = _db; _db = null; });
  await submit(app.page);
  expect((await modal(app.page)).err).toBe('บันทึกประวัติขึ้น Cloud ไม่สำเร็จ (ไม่ได้เชื่อมต่อ Cloud) — ยังไม่ได้ดาวน์โหลดและไม่ได้ล้างตาราง ลองใหม่');
  expect(await files(app.page)).toEqual([]);

  // กลับมาออนไลน์ → กดดาวน์โหลดอีกครั้งจาก modal เดิมสำเร็จ
  await app.page.evaluate(() => { _db = window.__db; });
  await submit(app.page);
  expect((await modal(app.page)).open).toBe(false);
  expect(await files(app.page)).toHaveLength(1);
  expect(await read(app.page)).toMatchObject({ skus: ids('O', 21, 40), histBtn: '1' });

  // ประวัติบน cloud ใหญ่เกินเพดาน (≥ 800 KB) = ล้มเหมือนกัน: ไม่ดาวน์โหลด ไม่ล้างตาราง · บอกสาเหตุ · doc เดิมไม่ถูกแตะ
  await app.page.evaluate((epoch) => {
    window.__store['stock_sessions/SRC_adjhist'] = { countResetAt: epoch, updatedBy: 'x', entries_json: JSON.stringify([{ no: 'BIG', dir: 'irps', at: '2026-10-07T00:00:00.000Z', by: 'x'.repeat(850 * 1024), rows: [] }]) };
    _adjHist = null; _adjHistReadToken++; renderAdjustDocTable(true);
  }, EPOCH);
  await exportWith(app.page, 'ORDSBY002');
  expect((await modal(app.page)).open).toBe(true);
  expect((await modal(app.page)).err).toMatch(/^บันทึกประวัติขึ้น Cloud ไม่สำเร็จ \(ประวัติใหญ่ \d+ KB ใกล้เพดาน Firestore\) — ยังไม่ได้ดาวน์โหลดและไม่ได้ล้างตาราง ลองใหม่$/);
  expect(await files(app.page)).toHaveLength(1);
  expect((await store(app.page)).entries.map((e) => e.no)).toEqual(['BIG']);
  expect((await read(app.page)).skus).toEqual(ids('O', 1, 20));
  await closeApp(app);
});

test('สองเครื่อง: เลขที่เอกสารซ้ำกับของอีกเครื่อง / แถวทับกับเอกสารของอีกเครื่อง → บล็อก ไม่ดาวน์โหลด แต่ตารางอัปเดตตาม cloud', async ({ browser }) => {
  const app = await bootBare(browser);
  await seed(app.page);
  await render(app.page);
  // เครื่องอื่นเพิ่งส่งออก O001–O020 ในเอกสาร ORDSZZ001 (เครื่องนี้ยังไม่รู้ — _adjHist ว่าง ตารางยังเห็นครบ)
  await app.page.evaluate(({ epoch }) => {
    const rows = Array.from({ length: 20 }, (_, i) => ['O' + String(i + 1).padStart(3, '0'), 2, 2, null, '', '']);
    window.__store['stock_sessions/SRC_adjhist'] = { countResetAt: epoch, updatedBy: 'Other', entries_json: JSON.stringify([{ no: 'ORDSZZ001', dir: 'ords', at: '2026-10-07T08:00:00.000Z', by: 'Other', rows }]) };
  }, { epoch: EPOCH });
  expect((await read(app.page)).skus).toEqual(ids('O', 1, 20));

  // (ก) เลขที่เอกสารซ้ำ → บล็อก (บอกว่าใครใช้) · ตารางอัปเดตตาม cloud ทันที (แถวของอีกเครื่องหาย)
  await clickExport(app.page);
  await typeNo(app.page, 'ordszz001'); await submit(app.page);
  expect((await modal(app.page)).open).toBe(true);
  expect((await modal(app.page)).err).toMatch(/^เลขที่เอกสารนี้ถูกใช้แล้ว \(\d{2}\/\d{2}\/\d{4} \d{2}:\d{2} · Other\) — ใช้เลขอื่น$/);
  expect(await files(app.page)).toEqual([]);
  expect((await read(app.page)).skus).toEqual(ids('O', 21, 40));                         // รู้แล้วว่า O001–O020 ถูกส่งออกไปแล้ว

  // (ข) แถวทับ: modal ของหน้าที่เห็นก่อนรู้ → เครื่องนี้ยังถือรายการเก่า (ตั้ง state เก่าย้อนกลับ) แล้วกดส่ง
  await app.page.evaluate(() => { _adjHist = null; _adjHistReadToken++; renderAdjustDocTable(true); document.getElementById('adjDocNoModal').style.display = 'none'; });
  expect((await read(app.page)).skus).toEqual(ids('O', 1, 20));                          // ย้อนไปเห็นเหมือนยังไม่รู้
  await clickExport(app.page);
  await typeNo(app.page, 'ORDSBY009'); await submit(app.page);
  expect((await modal(app.page)).open).toBe(false);
  expect(await files(app.page)).toEqual([]);                                             // ไม่ดาวน์โหลด
  expect((await store(app.page)).entries.map((e) => e.no)).toEqual(['ORDSZZ001']);        // ไม่เขียนทับ/ไม่เพิ่ม
  expect((await read(app.page)).skus).toEqual(ids('O', 21, 40));                          // ตารางอัปเดตตาม cloud
  expect((await toasts(app.page)).at(-1)).toBe('⚠️ 20 รายการถูกส่งออกไปแล้วในเอกสาร ORDSZZ001 — ไม่ได้ดาวน์โหลด ตรวจแล้ว Export ใหม่');

  // ส่งหน้าถัดไป (คนละแถวกับของอีกเครื่อง) → ผ่าน · รวมกับของที่มีอยู่ ไม่ทับ
  await exportWith(app.page, 'ORDSBY010');
  expect((await store(app.page)).entries.map((e) => e.no)).toEqual(['ORDSZZ001', 'ORDSBY010']);
  expect((await store(app.page)).entries[1].rows.map((r) => r[0])).toEqual(ids('O', 21, 40));
  expect(await files(app.page)).toHaveLength(1);
  await closeApp(app);
});

test('คีย์ซ่อนแถว: ผลต่างเปลี่ยน → แถวโผล่กลับ · ทิศกลับ → ไปอยู่แท็บตรงข้าม · แถวที่แก้เป็น 0 ไม่ถูกบันทึกและไม่ถูกซ่อน', async ({ browser }) => {
  const app = await bootBare(browser);
  await seed(app.page, { nO: 25, nI: 2 });
  // O003 เภสัชแก้จำนวนเป็น 0 (ไม่ส่งแถวนี้) · O004 แก้เป็น 1 (ส่ง 1 แทน 2)
  await app.page.evaluate(() => {
    const a = state.scanData.get('O003'); a.adjQty = 0; a.adjBase = -2;
    const b = state.scanData.get('O004'); b.adjQty = 1; b.adjBase = -2;
  });
  await render(app.page);
  await exportWith(app.page, 'ORDSBY001');
  const st = await store(app.page);
  // หน้า 1 = O001–O020 · O003 (qty 0) ไม่ลงไฟล์ → ไม่ลงประวัติ → ส่งจริง 19 แถว
  expect(st.entries[0].rows.map((r) => r[0])).toEqual([...ids('O', 1, 2), ...ids('O', 4, 20)]);
  expect(st.entries[0].rows.find((r) => r[0] === 'O004')).toEqual(['O004', 1, 2, null, '', '']);   // qty ที่ส่งจริง = 1 · base = ผลต่างจริง 2
  expect(lines(await lastText(app.page)).find((l) => l[0] === 'O004')).toEqual(['O004', '1']);
  expect(lines(await lastText(app.page)).some((l) => l[0] === 'O003')).toBe(false);
  expect((await read(app.page)).skus).toEqual(['O003', ...ids('O', 21, 25)]);            // O003 ยังอยู่ (ไม่ได้ส่ง) · ที่เหลือเลื่อนมา

  // ผลต่างเปลี่ยน (นับใหม่: 7 → ขาด 3) → คีย์ไม่ตรง → โผล่กลับเอง (งานที่เปลี่ยนไปแล้วต้องไม่ถูกซ่อน)
  await app.page.evaluate(() => { state.scanData.get('O001').effectiveQty = 7; renderAdjustDocTable(true); updateAdjustDocCount(); });
  const r1 = await read(app.page);
  expect(r1.skus).toEqual(['O001', 'O003', ...ids('O', 21, 25)]);
  expect(r1.badge).toBe('9');                                                              // 27 รายการ − 18 ที่ส่งออกแล้ว (O001 หลุดคีย์ จึงกลับมานับ)
  // ทิศกลับ โดยขนาดเท่าเดิม (12 → เกิน 2 = base 2 เหมือนตอนส่ง ORDS) → ไม่อยู่ในแท็บ ORDS · ไปโผล่ในแท็บ IRPS (คีย์ต้องรวมทิศ ไม่งั้นถูกซ่อนผิด)
  await app.page.evaluate(() => { state.scanData.get('O001').effectiveQty = 12; renderAdjustDocTable(true); });
  expect((await read(app.page)).skus).toEqual(['O003', ...ids('O', 21, 25)]);
  await app.page.evaluate(() => setAdjDocFilter('irps', document.getElementById('adjBtnIrps')));
  expect((await read(app.page)).skus).toEqual(['O001', 'I001', 'I002']);
  // กลับมาเท่าเดิม (ผลต่างตรงคีย์อีกครั้ง) → ซ่อนอีกครั้ง
  await app.page.evaluate(() => { state.scanData.get('O001').effectiveQty = 8; setAdjDocFilter('ords', document.getElementById('adjBtnOrds')); });
  expect((await read(app.page)).skus).toEqual(['O003', ...ids('O', 21, 25)]);
  await closeApp(app);
});

test('ป็อปอัพ 🗂️ ประวัติ: รายการเอกสาร · ขยายดูรายการที่แช่ไว้ · Status "ยังไม่เข้า" · ↩ คืนรายการ 2 ขั้น → แถวกลับ ใช้เลขเดิมได้', async ({ browser }) => {
  const app = await bootBare(browser);
  await seed(app.page, { nO: 25, nI: 3 });
  await app.page.evaluate(() => {
    _priceMap.set('O001', { unit: 'เม็ด', price: 12.5 });
    _lotMap.set('O001', [{ lot: 'LOT-A', exp: '31/12/2027' }]); _lotSelected.set('O001', 'LOT-A');
  });
  await render(app.page);
  await exportWith(app.page, 'ORDSBY001');
  await app.page.evaluate(() => setAdjDocFilter('irps', document.getElementById('adjBtnIrps')));
  await exportWith(app.page, 'IRPSBY001');
  expect((await read(app.page)).skus).toEqual([]);

  await app.page.evaluate(() => { document.getElementById('adjustDocPopupOverlay').style.display = 'flex'; document.getElementById('adjHistBtn').click(); });
  const list = () => app.page.evaluate(() => {
    const trs = [...document.querySelectorAll('#adjHistBody > tr')];
    return { n: document.getElementById('adjHistRowCount').textContent, rows: trs.map((tr) => [...tr.children].map((td) => td.textContent.replace(/\s+/g, ' ').trim())) };
  });
  const l1 = await list();
  expect(l1.n).toBe('2 เอกสาร');
  expect(l1.rows.map((r) => r.slice(0, 2).concat(r.slice(3, 6)))).toEqual([                // ใหม่สุดอยู่บน · [เลขที่เอกสาร, ชนิด, ผู้ส่งออก, รายการ, Status]
    ['▸ IRPSBY001', '🔺 IRPS', 'Pharm', '3', 'ยังไม่เข้า'],
    ['▸ ORDSBY001', '🔻 ORDS', 'Pharm', '20', 'ยังไม่เข้า'],
  ]);
  expect(l1.rows[0][2]).toMatch(/^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/);
  expect(await app.page.evaluate(() => getComputedStyle(document.getElementById('adjHistPopupOverlay')).display)).toBe('flex');

  // คลิกแถว = ขยาย: รายการที่แช่ไว้ตอน Export (ชื่อจาก skuMap · จำนวน · LOT · EXP · ราคา) — เปลี่ยน LOT/ราคาทีหลังไม่ทำให้ประวัติเปลี่ยน
  await app.page.evaluate(() => { document.querySelector('#adjHistBody > tr[data-no="ORDSBY001"]').click(); });
  await app.page.evaluate(() => { _lotSelected.set('O001', ''); _priceMap.set('O001', { unit: 'เม็ด', price: 99 }); renderAdjHistTable(); });
  const detail = await app.page.evaluate(() => [...document.querySelectorAll('#adjHistBody table tbody tr')].slice(0, 2).map((tr) => [...tr.children].map((td) => td.textContent.trim())));
  expect(detail).toEqual([
    ['1', 'O001', 'สินค้า O001', '2', 'LOT-A', '31/12/2570', '12.50'],                    // EXP แปลงเป็น พ.ศ. ตามไฟล์ที่ส่งไป
    ['2', 'O002', 'สินค้า O002', '2', '—', '—', '—'],
  ]);
  expect((await list()).rows[1][0]).toBe('▾ ORDSBY001');                                  // [0] = IRPSBY001 (ใหม่สุดอยู่บน) · [2] = แถวรายละเอียดที่ขยาย
  await app.page.evaluate(() => { document.querySelector('#adjHistBody > tr[data-no="ORDSBY001"]').click(); });   // ยุบ
  expect((await list()).rows[1][0]).toBe('▸ ORDSBY001');

  // ↩ ขั้นที่ 1 (ยังไม่ลบ) → ไม่ → กลับ · ขั้นที่ 2 ยืนยัน → ลบเอกสาร แถวกลับตาราง (แท็บ ORDS) ใช้เลขเดิมได้
  const clickBtn = (no, text) => app.page.evaluate(({ no, text }) => { [...document.querySelectorAll(`#adjHistBody button[data-no="${no}"]`)].find((b) => b.textContent.trim() === text).click(); }, { no, text });
  await clickBtn('ORDSBY001', '↩ คืนรายการ');
  expect(await app.page.evaluate(() => document.querySelector('#adjHistBody tr[data-no="ORDSBY001"]').textContent)).toContain('ถ้าไฟล์นี้นำเข้า ERP ไปแล้ว การส่งซ้ำจะปรับสต็อกซ้ำ');
  expect((await store(app.page)).entries).toHaveLength(2);                                // ยังไม่ลบ
  await clickBtn('ORDSBY001', 'ไม่');
  expect(await app.page.evaluate(() => document.querySelector('#adjHistBody tr[data-no="ORDSBY001"]').textContent)).not.toContain('ปรับสต็อกซ้ำ');
  await clickBtn('ORDSBY001', '↩ คืนรายการ'); await clickBtn('ORDSBY001', 'ยืนยันคืน');
  await app.page.waitForFunction(() => !_adjHistBusy);
  expect((await store(app.page)).entries.map((e) => e.no)).toEqual(['IRPSBY001']);
  expect((await list()).n).toBe('1 เอกสาร');
  expect((await toasts(app.page)).at(-1)).toBe('↩ คืนรายการของเอกสาร ORDSBY001 กลับตารางแล้ว');
  await app.page.evaluate(() => setAdjDocFilter('ords', document.getElementById('adjBtnOrds')));
  expect(await read(app.page)).toMatchObject({ skus: ids('O', 1, 20), count: '25 รายการ', histBtn: '1', badge: '25' });
  await exportWith(app.page, 'ORDSBY001');                                                // เลขเดิมใช้ได้อีก
  expect((await store(app.page)).entries.map((e) => e.no)).toEqual(['IRPSBY001', 'ORDSBY001']);

  // คืนซ้ำเอกสารที่ไม่มีแล้ว (อีกเครื่องคืนไปก่อน) → ไม่พัง · บอกให้ทราบ
  await app.page.evaluate(() => { const d = window.__store['stock_sessions/SRC_adjhist']; d.entries_json = JSON.stringify(JSON.parse(d.entries_json).filter((e) => e.no !== 'ORDSBY001')); });
  await app.page.evaluate(async () => { await undoAdjHistEntry('ORDSBY001'); });
  expect((await toasts(app.page)).at(-1)).toBe('เอกสาร ORDSBY001 ไม่อยู่ในประวัติแล้ว (ถูกคืนจากเครื่องอื่นไปก่อน)');
  expect((await read(app.page)).skus).toEqual(ids('O', 1, 20));                           // state ตามที่อ่านได้ → แถวกลับมาด้วย

  // กด ↩ ซ้ำระหว่างกำลังบันทึก → ครั้งที่สองถูกกัน (เขียน cloud ครั้งเดียว · toast ครั้งเดียว · ไม่ยิง transaction ซ้อน)
  const dbl = await app.page.evaluate(async () => {
    const w0 = window.__writes, t0 = window.__toasts.length;
    await Promise.all([undoAdjHistEntry('IRPSBY001'), undoAdjHistEntry('IRPSBY001')]);
    return { writes: window.__writes - w0, toasts: window.__toasts.slice(t0) };
  });
  expect(dbl).toEqual({ writes: 1, toasts: ['↩ คืนรายการของเอกสาร IRPSBY001 กลับตารางแล้ว'] });
  expect((await store(app.page)).entries).toEqual([]);

  // XSS: เลขที่เอกสาร/ชื่อผู้ใช้ที่มีอักขระ HTML ไม่ถูกตีความ
  await app.page.evaluate(() => { _adjHist.entries.push({ no: '<B>X"\'', dir: 'ords', at: '2026-10-07T01:00:00.000Z', by: '<i>u</i>', rows: [['O001', 1, 2, null, '', '']] }); renderAdjHistTable(); });
  expect(await app.page.evaluate(() => document.querySelectorAll('#adjHistBody b, #adjHistBody i').length)).toBe(0);
  await closeApp(app);
});

test('ผูกรอบนับ: เริ่มรอบใหม่ = ประวัติว่าง แถวกลับมา · doc รอบเก่าบน cloud ถูกแทนที่ตอน Export ครั้งแรกของรอบใหม่ · ปุ่มประวัติล้างตาม', async ({ browser }) => {
  const app = await bootBare(browser);
  await seed(app.page, { nO: 25, nI: 0 });
  await render(app.page);
  await exportWith(app.page, 'ORDSBY001');
  expect((await read(app.page)).histBtn).toBe('1');

  // เริ่มรอบนับใหม่ → epoch เปลี่ยน → ประวัติรอบเก่าไม่ใช่ของรอบนี้
  await app.page.evaluate(() => { _countResetAt = '2026-10-01T00:00:00.000Z'; renderAdjustDocTable(true); updateAdjustDocCount(); });
  expect(await read(app.page)).toMatchObject({ skus: ids('O', 1, 20), count: '25 รายการ', histBtn: '0', badge: '25' });
  expect(await app.page.evaluate(() => _adjHistEntries())).toEqual([]);
  // อ่านจาก cloud ที่เป็นรอบเก่า = ว่าง
  await app.page.evaluate(async () => { await _loadAdjHistFromCloud(); });
  expect(await app.page.evaluate(() => _adjHistEntries())).toEqual([]);
  // Export ครั้งแรกของรอบใหม่ → doc ถูกแทนที่เป็นของรอบใหม่ (ไม่เอาเอกสารรอบเก่าติดไป · เลขเดิมใช้ได้)
  await exportWith(app.page, 'ORDSBY001');
  const st = await store(app.page);
  expect(st.epoch).toBe('2026-10-01T00:00:00.000Z');
  expect(st.entries.map((e) => e.no)).toEqual(['ORDSBY001']);
  expect((await read(app.page)).histBtn).toBe('1');
  await closeApp(app);
});

test('ตอน login: ป้ายตัวเลขปุ่ม 📦 ไม่นับแถวที่ส่งออกแล้วตั้งแต่ยังไม่เปิดป็อปอัพ (updateAdjustDocPanel โหลดประวัติเอง) · role ไม่มีสิทธิ์ = ล้าง state และซ่อนปุ่ม', async ({ browser }) => {
  const app = await bootBare(browser);
  await seed(app.page, { nO: 25, nI: 0 });
  // เครื่องอื่นส่งออก O001–O020 ไปแล้ว · เครื่องนี้เพิ่ง login (ยังไม่เคยอ่านประวัติ · ยังไม่เปิดป็อปอัพ)
  await app.page.evaluate((epoch) => {
    const rows = Array.from({ length: 20 }, (_, i) => ['O' + String(i + 1).padStart(3, '0'), 2, 2, null, '', '']);
    window.__store['stock_sessions/SRC_adjhist'] = { countResetAt: epoch, updatedBy: 'Other', entries_json: JSON.stringify([{ no: 'ORDSZZ001', dir: 'ords', at: '2026-10-07T08:00:00.000Z', by: 'Other', rows }]) };
    document.getElementById('adjustDocPopupOverlay').style.display = 'none';
    updateAdjustDocCount();
  }, EPOCH);
  expect(await read(app.page)).toMatchObject({ badge: '25', histBtn: '0' });             // ยังไม่โหลด → นับทุกตัว
  await app.page.evaluate(() => { updateAdjustDocPanel(); });                              // จุดเดียวกับตอน login (selectEmployee) — ต้องโหลดเอง ไม่รอเปิดป็อปอัพ
  await app.page.waitForFunction(() => _adjHistEntries().length === 1, null, { timeout: 5000, polling: 50 });
  expect(await read(app.page)).toMatchObject({ badge: '5', histBtn: '1' });

  // logout/เปลี่ยนเป็น role ที่ไม่มีสิทธิ์ → ล้าง state (ของบน cloud ยังอยู่) · ปุ่มซ่อน · ป้ายกลับไปนับทุกตัว
  await app.page.evaluate(() => { currentRole = 'assistant'; updateAdjustDocPanel(); });
  expect(await app.page.evaluate(() => _adjHist)).toBeNull();
  expect(await read(app.page)).toMatchObject({ badge: '25', histBtn: null });
  expect(await store(app.page)).not.toBeNull();
  await closeApp(app);
});

test('Export Excel ไม่ถามเลขที่เอกสาร แต่ไม่เห็นแถวที่ย้ายไปประวัติ · การ์ด ERP ไม่รายงาน SKU ที่ส่งออกแล้วเป็น "มีใบใน ERP แต่ไม่อยู่ในแท็บนี้"', async ({ browser }) => {
  const app = await bootBare(browser);
  await seed(app.page, { nO: 25, nI: 0 });
  // ERP มีใบ ORDS ของ O001/O002 แล้ว (ผู้ใช้ส่งไฟล์ที่ Export ไปเข้า ProMaxx)
  await app.page.evaluate((epoch) => {
    _adjErp = { branch: 'SRC', epoch, docs: { ORDSX1: { no: 'ORDSX1', type: 'ORDS', day: '2026-10-07', at: '2026-10-07 10:00', items: { O001: 2, O002: 2 } } },
      cover: { ORDS: { fromDay: '2026-09-20', toAt: '2026-10-07 23:00' } }, branchName: '', note: '', updatedBy: '', updatedAt: '', localOnly: false };
  }, EPOCH);
  await render(app.page);
  await exportWith(app.page, 'ORDSBY001');                                                // O001–O020 ถูกย้ายไปประวัติ
  expect(await app.page.evaluate(() => _adjErpExtraSkus(_buildAdjustDocRows('ords'), 'ords'))).toEqual([]);   // ไม่ใช่ "หลุดจากแท็บ" — ส่งออกแล้วจึงอยู่ใน ERP เป็นปกติ
  // ถ้าไม่มีประวัติ SKU เหล่านั้นจะถูกรายงานว่า "หลุดจากแท็บ" (ยืนยันว่าเทสนี้มองเห็นความต่างจริง)
  expect((await app.page.evaluate(() => { const h = _adjHist; _adjHist = null; const r = _adjErpExtraSkus(_buildAdjustDocRows('ords').filter(() => false), 'ords').map((x) => x.sku); _adjHist = h; return r; })).sort()).toEqual(['O001', 'O002']);

  // Excel: ไม่เด้ง modal · ได้เฉพาะแถวที่เหลือ (O021–O025) · ไม่เขียนประวัติเพิ่ม
  const writes = await app.page.evaluate(() => window.__writes);
  const sheet = await app.page.evaluate(() => {
    let s = null; const orig = XLSX.writeFile; XLSX.writeFile = (wb) => { s = XLSX.utils.sheet_to_json(wb.Sheets['ORDS'], { header: 1 }); };
    try { exportAdjustDocExcel(); } finally { XLSX.writeFile = orig; }
    return s;
  });
  expect(sheet.slice(1).map((r) => r[1])).toEqual(ids('O', 21, 25));
  expect((await modal(app.page)).open).toBe(false);
  expect(await app.page.evaluate(() => window.__writes)).toBe(writes);
  await closeApp(app);
});

test('WH (supervisor): ใช้ได้เหมือนกัน (doc WH_adjhist) · role ที่ไม่มีสิทธิ์/ไม่ใช่ผู้เปิด 📦 = เส้นทางเดิม (ไม่มี modal ไม่ล้างตาราง)', async ({ browser }) => {
  const app = await bootBare(browser);
  await seed(app.page, { nO: 25, nI: 0, role: 'supervisor', branch: 'WH' });
  await render(app.page);
  expect(await read(app.page)).toMatchObject({ skus: ids('O', 1, 20), count: '25 รายการ', histBtn: '0' });
  await exportWith(app.page, 'ORDSWH001');
  const st = await store(app.page, 'stock_sessions/WH_adjhist');
  expect(st.entries[0]).toMatchObject({ no: 'ORDSWH001', dir: 'ords' });
  expect(st.entries[0].rows.map((r) => r[0])).toEqual(ids('O', 1, 20));
  expect(st.entries[0].rows[0].slice(0, 3)).toEqual(['O001', 2, 2]);
  expect(await store(app.page, 'stock_sessions/SRC_adjhist')).toBeNull();
  expect(await read(app.page)).toMatchObject({ skus: ids('O', 21, 25), histBtn: '1' });

  // role ผู้ช่วย (เปิด 📦 ไม่ได้ในใช้งานจริง) → _adjHistEnabled เท็จ → ปุ่มซ่อน · กด Export = เส้นทางเดิม (ไฟล์ทันที ไม่ล้างตาราง)
  await app.page.evaluate(() => { currentRole = 'assistant'; _refreshAdjHistBtn(); updateAdjustDocCount(); renderAdjustDocTable(true); });
  expect(await read(app.page)).toMatchObject({ skus: ids('O', 1, 20), histBtn: null });   // ประวัติไม่มีผลกับ role นี้ → แถวที่ส่งออกแล้วมองเห็นเหมือนเดิม
  await clickExport(app.page);
  expect((await modal(app.page)).open).toBe(false);
  expect((await files(app.page)).at(-1)).toMatch(/^stockadj_ords_\d{2}-\d{2}-\d{4}_p1\.txt$/);
  expect((await store(app.page, 'stock_sessions/WH_adjhist')).entries).toHaveLength(1);
  await closeApp(app);
});

test('ทางถอย: สวิตช์ปิด = ไม่มีปุ่ม/modal · Export Text เดิม (_p1) · แถวที่เคยส่งออกโผล่กลับ · exportAdjustDocText() เรียกตรงเหมือนเดิมทุกไบต์ · ปิดป็อปอัพ 📦 ปิดประวัติ/modal ด้วย', async ({ browser }) => {
  const app = await bootBare(browser);
  await seed(app.page, { nO: 45, nI: 0 });
  await render(app.page);
  await exportWith(app.page, 'ORDSBY001');
  expect((await read(app.page)).skus).toEqual(ids('O', 21, 40));

  await app.page.evaluate(() => { ADJUST_DOC_HISTORY = false; updateAdjustDocCount(); renderAdjustDocTable(true); });
  expect(await read(app.page)).toMatchObject({ skus: ids('O', 1, 20), count: '45 รายการ', histBtn: null, badge: '45' });   // ประวัติบน cloud ยังอยู่ แต่ไม่มีผลกับตาราง
  await clickExport(app.page);
  expect((await modal(app.page)).open).toBe(false);                                       // ไม่มี modal
  expect((await files(app.page)).at(-1)).toMatch(/^stockadj_ords_\d{2}-\d{2}-\d{4}_p1\.txt$/);
  expect(lines(await lastText(app.page))).toEqual(ids('O', 1, 20).map((s) => [s, '2']));
  expect(await app.page.evaluate(() => { openAdjHistPopup(); return document.getElementById('adjHistPopupOverlay').style.display; })).toBe('none');   // เปิดประวัติไม่ได้
  expect(await store(app.page)).toMatchObject({ entries: [expect.objectContaining({ no: 'ORDSBY001' })] });   // doc ไม่ถูกลบ/แก้
  expect(await app.page.evaluate(() => window.__writes)).toBe(1);

  // เปิดสวิตช์กลับ → ตารางเห็นประวัติเดิมอีกครั้ง
  await app.page.evaluate(() => { ADJUST_DOC_HISTORY = true; updateAdjustDocCount(); renderAdjustDocTable(true); });
  expect((await read(app.page)).skus).toEqual(ids('O', 21, 40));

  // ปิดป็อปอัพ 📦 → ประวัติ/modal ที่ซ้อนอยู่ปิดตาม (ไม่ค้างลอย) · กำลังบันทึกอยู่ = modal คงไว้
  await app.page.evaluate(() => { document.getElementById('adjustDocPopupOverlay').style.display = 'flex'; openAdjHistPopup(); openAdjDocNoModal(_adjTextExportPlan()); });
  await app.page.evaluate(() => closeAdjustDocPopup());
  expect(await app.page.evaluate(() => [document.getElementById('adjHistPopupOverlay').style.display, document.getElementById('adjDocNoModal').style.display])).toEqual(['none', 'none']);
  await app.page.evaluate(() => { openAdjDocNoModal(_adjTextExportPlan()); _adjHistBusy = true; closeAdjustDocPopup(); closeAdjDocNoModal(); });
  expect(await app.page.evaluate(() => document.getElementById('adjDocNoModal').style.display)).toBe('flex');
  await app.page.evaluate(() => { _adjHistBusy = false; });
  await closeApp(app);
});
