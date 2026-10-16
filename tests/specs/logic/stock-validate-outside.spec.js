// ✅ Stock Validate → ปุ่ม "เอกสารนอกใบ" + badge นับรวม (16 ต.ค. 2026 · ผู้ใช้สั่ง — ทางเลือก A ของการวิเคราะห์ "ปรับเพิ่ม" · ทุกเหตุผลของรายการนอกใบ)
//   สินค้าที่ "นับ Pass แต่มีเอกสาร ORDS/IRPS ใน ERP" (อาจปรับผิด/ปรับเอง) ไม่อยู่ในตาราง Stock Validate (ตารางเป็น stock_adjustment ล้วน)
//   ตัวตรวจ _adjErpOutsideList มีอยู่แล้วที่แถบ 🧾 ใน 📦 → หน้านี้มีปุ่มเปิดรายการเดียวกัน + badge แดงนับรวม (ไม่เขียนกติกานอกใบซ้ำ)
//   badge = ไม่ตรง + นอกใบที่ "ยังไม่รับทราบ" (kind outside) — ✓ รับทราบแล้ว / 🔁 ปรับปรุง LOT / ℹ️ ปกติ ไม่นับ (ไม่ใช่ปัญหา)
//
// เทสนี้ตรึง — ★ = ข้อที่พังแล้วเภสัชไม่เห็นเอกสารที่ปรับผิด หรือเห็น badge แดงผิดตัว
//   1. ค่าเริ่มต้นสวิตช์ + ปุ่มของ 📦 ยังเป็น HTML เดิมทุกตัวอักษร (id/onclick ค่าเริ่มต้น) — ปุ่มใหม่ใช้ id คนละตัว
//   2. ★ ปุ่มในแถบผลตรวจ: ข้อความเดียวกับ 📦 · กดแล้วเปิดรายการเดิมที่ครอบทุกเหตุผล (Pass · ยังไม่นับ · ไม่อยู่ในรอบ · ค้างส่ง · 🔁 LOT · ℹ️ ปกติ)
//   3. ★ badge = ไม่ตรง + นอกใบที่ยังไม่รับทราบ · รับทราบแล้วลดเอง · ยกเลิกรับทราบ/ใบใหม่หลังรับทราบ = กลับมานับ · tooltip แตกตัวเลข
//   4. ★ 🔁 ปรับปรุง LOT / ℹ️ ปกติ ไม่ทำให้ badge แดง (ไม่งั้นแดงถาวรทุกครั้งที่พนักงานปรับปรุง LOT)
//   5. ★ "รับทราบ" อ่านให้ badge แบบ lazy ตั้งแต่ login: ครั้งเดียวต่อ (สาขา|รอบ) · ล้ม/ออฟไลน์ไม่วนซ้ำ · รอบใหม่อ่านใหม่ · รอบอื่นไม่ใช้ · logout ล้างตัวจำ
//   6. ป็อปอัพนอกใบซ้อนเหนือ Stock Validate · ปิด Stock Validate/หมดสิทธิ์ปิดตาม · ที่ 📦 เปิดไว้ไม่ถูกแตะ
//   7. ★ สวิตช์ปิด = หน้านี้เท่าเดิมทุกตัวอักษร (ไม่มีปุ่ม · badge/tooltip เดิม · ไม่อ่านรับทราบ) · ADJ_ERP_LOT_AWARE ปิด = ไม่มีรายการนอกใบ
//   8. สิทธิ์ (ผู้ช่วย/WH) · ไม่มีรายงาน = ไม่มีปุ่ม badge "—" · รายงานเปลี่ยน/กดรับทราบ = ปุ่ม+badge ขยับเอง (ผ่าน hub)
//   9. id ไม่ซ้ำเมื่อแถบ 📦 กับแถบ Stock Validate วาดพร้อมกัน · ปุ่มยาวสุดไม่ล้นการ์ดที่ 960px (แบ่งครึ่งจอคู่ ProMaxx)
// (ข้อมูลสังเคราะห์ทั้งหมด — ห้ามใช้ CSV จริง)
const { test, expect, bootBare, closeApp } = require('../../lib/hooks');

const EPOCH = '2026-08-05T01:00:00.000Z';   // เริ่มรอบ 5/8
const EPOCH2 = '2026-09-01T01:00:00.000Z';  // รอบถัดไป (ทดสอบอ่านรับทราบใหม่เมื่อเปลี่ยนรอบ)
const SCAN = '2026-08-10 16:00:00';          // นับ 10/8
const ACK_KEY = 'stock_sessions/SRC_adjerpack';

const HDR = ['SYSWAREHOUSEID', 'TRANDATE', 'TRANNO', 'REFERENCENO1', 'SYSVOUCHERID', 'SYSSALEID', 'TOTAL', 'TOTALVAT', 'GRANDTOTAL', 'FCANCEL',
  'TAXRATE', 'SYSPERSONID', 'SYSBRANCHID', 'FPROCESS', 'SCANCODE', 'ITEMNAME', 'SYSUNITID', 'BASEQUANTITY', 'QUANTITY', 'SYSITEMID', 'PRICE',
  'AMOUNT', 'DETAILNO', 'ITEMID', 'ITEMNAME', 'TOTALTRADDISCHAVEVAT', 'TOTALTRADDISCNONEVAT', 'FSTOCKMAIN', 'FMLDISCOUNTITEM', 'FMLDISCOUNTROW',
  'DISCOUNTPROMOTION', 'NAME'];
function line({ date, no, sku, qty }) {
  const r = Array(HDR.length).fill('');
  r[0] = '1'; r[1] = date; r[2] = no; r[9] = '0'; r[12] = '0'; r[14] = sku; r[17] = String(qty); r[18] = String(qty); r[23] = sku; r[31] = 'สาขาทดสอบ';
  return r;
}
const sheet = (rows) => [HDR.slice(), ...rows];
const O = (no, sku, qty) => line({ date: '24/9/2026 14:43', no, sku, qty });
const I = (no, sku, qty) => line({ date: '24/9/2026 13:33', no, sku, qty });

// SKU ในฟิกซ์เจอร์ → ผลของ _adjErpOutsideList (ตัวตรวจเดิม · ไม่ได้เขียนใหม่ในเทสนี้)
//   SA-OK    Stock Adj ตรง ต้อง ORDS 2 · ERP ORDS 2         → อยู่ในตาราง (ตรง) · ไม่อยู่ในรายการนอกใบ (อยู่ใน Y)
//   SA-BAD   Stock Adj ตรง ต้อง ORDS 5 · ไม่มีใบ              → อยู่ในตาราง (ไม่ตรง) · ไม่อยู่ในรายการนอกใบ (ไม่มีใบ)
//   P-DEC    Pass ตั้งแต่นับ · ORDS 3 ขาเดียว                  → outside (ลด)
//   P-INC    Pass ตั้งแต่นับ · IRPS 1 ขาเดียว                  → outside (เพิ่ม)
//   PEND     ยังไม่ได้นับ · ORDS 1                              → outside (ลด)
//   BACK     ค้างส่ง (audit + backorder) · ORDS 1               → outside (ลด)
//   GHOST    ไม่อยู่ในรอบนับ · IRPS 2                           → outside (เพิ่ม)
//   LOT-PAIR Pass · ORDS 2 + IRPS 2                             → lotswap
//   P-RECHK  รีเช็คแล้ว Pass · ORDS 1 ก่อนเวลารีเช็ค           → ok (ปกติ)
const FILE_O = sheet([O('ORDSBY001', 'SA-OK', 2), O('ORDSBY001', 'P-DEC', 3), O('ORDSBY001', 'LOT-PAIR', 2), O('ORDSBY001', 'P-RECHK', 1),
  O('ORDSBY001', 'PEND', 1), O('ORDSBY001', 'BACK', 1)]);
const FILE_I = sheet([I('IRPSBY001', 'P-INC', 1), I('IRPSBY001', 'LOT-PAIR', 2), I('IRPSBY001', 'GHOST', 2)]);
const FILE_O_MORE = sheet([...FILE_O.slice(1), O('ORDSBY002', 'P-DEC', 1)]);   // ใบใหม่ของ P-DEC หลังรับทราบ → รับทราบหมดอายุ
// ชุดที่ไม่มี outside ที่ต้องเตือน: มีแต่ 🔁 LOT-PAIR กับ ℹ️ P-RECHK
const FILE_O_QUIET = sheet([O('ORDSBY001', 'SA-OK', 2), O('ORDSBY001', 'LOT-PAIR', 2), O('ORDSBY001', 'P-RECHK', 1)]);
const FILE_I_QUIET = sheet([I('IRPSBY001', 'LOT-PAIR', 2)]);

const REASONS = {
  BACK: 'ค้างส่ง — เภสัชตัดสินว่าไม่ต้องปรับ · ปรับปรุง LOT ไม่ครบคู่ (มีแต่ ORDS)',
  GHOST: 'ไม่อยู่ในรอบนับนี้ · ปรับปรุง LOT ไม่ครบคู่ (มีแต่ IRPS)',
  'P-DEC': 'สินค้านับ Pass มีเอกสารปรับปรุงลดสินค้าเพิ่ม',
  'P-INC': 'สินค้านับ Pass มีเอกสารปรับปรุงเพิ่มสินค้าเพิ่ม',
  PEND: 'ยังไม่ได้นับ · ปรับปรุง LOT ไม่ครบคู่ (มีแต่ ORDS)',
  'LOT-PAIR': 'ORDS (LOT เดิม) + IRPS (LOT ใหม่) เท่ากัน — ยอดรวมไม่เปลี่ยน',
  'P-RECHK': 'ปรับก่อนรีเช็ค แล้วรีเช็คตรง',
};
const BTN_ALL = '⚠️ ใบปรับปรุงลดสินค้า 3 · ใบปรับปรุงเพิ่มสินค้า 2 · 🔁 ปรับปรุง LOT สินค้า 1';
const TIP = (mm, ow, match, all) => `ไม่ตรง ${mm}${ow ? ` · เอกสารนอกใบที่ยังไม่รับทราบ ${ow}` : ''} · ตรง ${match} · Stock Adj ทั้งหมด ${all} รายการ`;

async function seed(page, { role = 'pharmacist', branch = 'SRC', files = [FILE_O, FILE_I], without = [], localOnly = true, db = true } = {}) {
  await page.evaluate(({ role, branch, EPOCH, SCAN, files, without, localOnly, db }) => {
    STOCK_VALIDATE = true; STOCK_VALIDATE_OUTSIDE = true; STOCK_VALIDATE_PAGE_SIZE = 20; ADJUST_DOC_ERP_CHECK = true; PHARMACY_ADJ_ERP_CARD = true;
    ADJ_ERP_LOT_AWARE = true; ADJ_ERP_OUTSIDE_ACK = true; PHARMACY_AUDIT_IN_ADJUST_DOC = true; ADJUST_DOC_SKIP_REOPENED = true; ADJUST_DOC_HISTORY = true;
    currentBranch = branch; currentRole = role; currentUser = 'Pharm'; _countResetAt = EPOCH;
    _adjErp = null; _adjErpBusy = false; _adjErpFilter = 'all'; _adjHist = null; _svFilter = 'all'; _svPage = 1;
    _adjErpAck = null; _adjErpAckBusy = false; _adjErpAckEdit = ''; _adjErpAckReadToken++; _svAckTried = ''; _adjErpOutsideFromSv = false;
    _branchScanPaused = false; _adjDocFilter = 'ords'; _adjDocPage = 1; _adjLoading = false;
    _pharmacyAuditMarkerData = { branch, countResetAt: EPOCH, items: {} };
    state.skuMap.clear(); state.scanData.clear(); state.skuDirectMap.clear(); scanListMap.clear();
    for (const el of document.querySelectorAll('[id$="Modal"]')) if (el.style.display === 'flex') el.style.display = 'none';   // หน้าเลือกสาขา/PIN ของ bootBare บังการคลิก
    for (const id of ['stockValidateOverlay', 'adjErpOutsideOverlay', 'adjustDocPopupOverlay']) { const o = document.getElementById(id); if (o) o.style.display = 'none'; }
    const base = { auditor: '', countedQty: 0, timestamp: SCAN, firstScanAt: SCAN, scannedBy: 'Asst' };
    const add = (sku, sd) => {
      if (without.includes(sku)) return;
      state.skuMap.set(sku, { sku, productName: 'สินค้า ' + sku, unitPrice: 20, systemQty: 10, negSys: false, barcodes: [], isDel: false });
      state.scanData.set(sku, { ...base, ...sd });
    };
    const direct = (eff, sys) => ({ status: 'stock_adjustment', auditStatus: 'stock_adjustment', initialStatus: 'stock_adjustment', directAdj: true, effectiveQty: eff, systemQty: sys, countedQty: eff });
    const pass = (extra = {}) => ({ status: 'pass', auditStatus: 'approved', initialStatus: 'pass', countedQty: 4, ...extra });
    add('SA-OK', direct(8, 10));
    add('SA-BAD', direct(5, 10));
    add('P-DEC', pass());
    add('P-INC', pass());
    add('LOT-PAIR', pass());
    add('P-RECHK', pass({ initialStatus: 'audit', auditor: 'Pharm', recheckQty: 4, recheckSystemQty: 4, recheckAt: '2026-10-01T00:00:00.000Z' }));
    add('PEND', { status: 'pending', auditStatus: 'pending' });
    add('BACK', { status: 'audit', auditStatus: 'pending', initialStatus: 'audit', backorder: true, recheckQty: 0, effectiveQty: 0, systemQty: 0 });
    window.__erp = (sheets, extra = {}) => {
      let m = null;
      for (const rows of sheets) { const p = _parseAdjErpRows(rows, branch, EPOCH); if (p.error) throw new Error(p.error); m = _mergeAdjErp(m, p, { at: '2026-10-10T03:00:00.000Z', by: 'Pharm' }); }
      // localOnly: openStockValidatePopup → _loadAdjErpFromCloud ล้างรายงานในเครื่องถ้า cloud (จำลอง) ไม่มีเอกสาร — เทสนี้ไม่ได้ตรวจเรื่องนั้น
      _adjErp = { ...m, branch, epoch: EPOCH, updatedBy: 'Pharm', updatedAt: '2026-10-10T03:00:00.000Z', localOnly, ...extra };
    };
    if (files.length) __erp(files);
    // Firestore จำลอง: doc().get (นับครั้งที่อ่านต่อพาธ · __failGet = ทำให้อ่านล้ม) + runTransaction(get/set) สำหรับบันทึกรับทราบ
    window.__store = {}; window.__fail = null; window.__failGet = null; window.__gets = {};
    // __holdGets() = ให้ get() ค้างหลังนับครั้ง (สังเกตสถานะ "กำลังอ่านรับทราบ") จนเรียก __gateRelease()
    window.__getGate = null; window.__gateRelease = null;
    window.__holdGets = () => { window.__getGate = new Promise((r) => { window.__gateRelease = () => { window.__getGate = null; r(); }; }); };
    const ref = (p) => ({ path: p, get: async () => {
      window.__gets[p] = (window.__gets[p] || 0) + 1;
      if (window.__getGate) await window.__getGate;
      if (window.__failGet) throw new Error(window.__failGet);
      const d = window.__store[p]; return { exists: !!d, data: () => d };
    } });
    window.__fakeDb = {
      collection: (c) => ({ doc: (id) => ref(c + '/' + id) }),
      runTransaction: async (fn) => {
        if (window.__fail) throw new Error(window.__fail);
        let pending = null;
        await fn({ get: async (r) => { const d = window.__store[r.path]; return { exists: !!d, data: () => d }; }, set: (r, data) => { pending = [r.path, data]; } });
        if (pending) window.__store[pending[0]] = { ...pending[1], updatedAt: { toDate: () => new Date('2026-10-11T03:05:00.000Z') } };
      },
    };
    _db = db ? window.__fakeDb : null;
    window.__toasts = []; toast = (m, t) => { window.__toasts.push(`${t || 'info'}|${m}`); };
  }, { role, branch, EPOCH, SCAN, files, without, localOnly, db });
}

const svRes = (page) => page.evaluate(() => { const r = _stockValidateRows(); return { mm: r.counts.mismatch, match: r.counts.match, rows: r.rows.map((x) => x.sku).sort(), c: r.outside.c, list: r.outside.list.map((x) => x.sku) }; });
const btn = (page) => page.evaluate(() => { const b = document.getElementById('svOutsideBtn'); return b ? { text: b.textContent, warn: b.classList.contains('warn'), onclick: b.getAttribute('onclick') } : null; });
const badge = (page) => page.evaluate(() => { const c = document.getElementById('stockValidateCount'); return { text: c.textContent, bg: c.style.background, tip: c.closest('button').title }; });
const outsideRows = (page) => page.evaluate(() => [...document.querySelectorAll('#adjErpOutsideBody tr')].map((tr) => ({ sku: tr.dataset.sku, kind: tr.dataset.kind, reason: tr.children[6].textContent, ack: tr.children[7] ? tr.children[7].textContent : null })));
const ack = (page, sku, note = 'ปรับปรุง LOT สินค้า') => page.evaluate(async ({ sku, note }) => {
  armAdjErpAck(sku);
  document.getElementById('adjErpAckNote').value = note;
  await confirmAdjErpAck(sku);
}, { sku, note });
const RED = 'rgba(217, 48, 37, 0.9)', PALE = 'rgba(255, 255, 255, 0.25)';
const display = (page, id) => page.evaluate((id) => document.getElementById(id).style.display, id);
const waitHidden = (page, id) => page.waitForFunction((id) => document.getElementById(id).style.display === 'none', id, { polling: 50 });

test('ค่าเริ่มต้นที่ส่งมอบ: STOCK_VALIDATE_OUTSIDE เปิด · ปุ่มของ 📦 ยังเป็น HTML เดิม (id/onclick ค่าเริ่มต้น) · ปุ่มใหม่ใช้ id คนละตัว', async ({ browser }) => {
  const app = await bootBare(browser);
  const r = await app.page.evaluate(() => {
    const l = [{ kind: 'ok', net: 1 }];
    return { sw: [typeof STOCK_VALIDATE_OUTSIDE, STOCK_VALIDATE_OUTSIDE, typeof _svAckTried, typeof _adjErpOutsideFromSv],
      def: _adjErpOutsideBtnHtml(l), custom: _adjErpOutsideBtnHtml(l, 'svOutsideBtn', 'openAdjErpOutsideFromSv()'), empty: _adjErpOutsideBtnHtml([]) };
  });
  expect(r.sw).toEqual(['boolean', true, 'string', 'boolean']);
  // ค่าเริ่มต้นต้องเท่าก่อนแก้ทุกตัวอักษร — เทสเดิมของ 📦 หยิบปุ่มด้วย #adjErpOutsideBtn
  expect(r.def).toBe('<button type="button" id="adjErpOutsideBtn" class="adj-erp-outside-btn" onclick="openAdjErpOutsidePopup()" title="เอกสารปรับปรุง LOT สินค้า: ตรวจสอบรายการเอกสาร ORDS/IRPS ที่มีการเพิ่มเข้า ProMaxx — กดเพื่อดูรายการ">ℹ️ เอกสารปรับปรุง LOT สินค้า <b>1</b></button>');
  expect(r.custom).toBe(r.def.replace('id="adjErpOutsideBtn"', 'id="svOutsideBtn"').replace('onclick="openAdjErpOutsidePopup()"', 'onclick="openAdjErpOutsideFromSv()"'));
  expect(r.empty).toBe('');
  await closeApp(app);
});

test('★ ปุ่มในแถบผลตรวจ: ข้อความเดียวกับ 📦 · ตารางยังเป็น stock_adjustment ล้วน · กดแล้วเปิดรายการเดิมที่ครอบทุกเหตุผล (Pass · ยังไม่นับ · ไม่อยู่ในรอบ · ค้างส่ง · 🔁 LOT · ℹ️ ปกติ)', async ({ browser }) => {
  const app = await bootBare(browser);
  await seed(app.page);
  // ตารางไม่เปลี่ยน: เฉพาะ stock_adjustment · นอกใบไม่ถูกปนเข้าตาราง/ตัวนับ (ผู้ใช้เลือกทาง A ไม่ใช่ B)
  const res = await svRes(app.page);
  expect(res.rows).toEqual(['SA-BAD', 'SA-OK']);
  expect([res.mm, res.match]).toEqual([1, 1]);
  expect(res.list).toEqual(['BACK', 'GHOST', 'P-DEC', 'P-INC', 'PEND', 'LOT-PAIR', 'P-RECHK']);   // ไม่ตรง (outside ตามชื่อ SKU) → LOT → ปกติ
  expect(res.c).toEqual({ warn: 5, acked: 0, lot: 1, ok: 1 });
  await app.page.evaluate(() => openStockValidatePopup());
  await app.page.waitForFunction(() => document.getElementById('stockValidateCard').getAnimations().length === 0, null, { polling: 50 });
  expect(await btn(app.page)).toEqual({ text: BTN_ALL, warn: true, onclick: 'openAdjErpOutsideFromSv()' });
  // ข้อความเดียวกับปุ่มที่ 📦 สร้าง (ตัวสร้างเดียวกัน) — ต่างแค่ id/onclick
  expect(await app.page.evaluate(() => { const l = _adjErpOutsideList(); const d = document.createElement('div'); d.innerHTML = _adjErpOutsideBtnHtml(l); return d.firstChild.textContent; })).toBe(BTN_ALL);
  // ชิปตัวกรองเดิมไม่ถูกปุ่มรบกวน (คลาสคนละตัว)
  expect(await app.page.evaluate(() => [...document.querySelectorAll('#svBar .sv-chip')].map((b) => b.textContent))).toEqual(['ทั้งหมด 2', '❌ ไม่ตรง 1', '✅ ตรง 1']);
  // คลิกจริง → ป็อปอัพรายการเดิมเปิดซ้อนเหนือ Stock Validate
  await app.page.click('#svOutsideBtn');
  expect(await display(app.page, 'adjErpOutsideOverlay')).toBe('flex');
  expect(await display(app.page, 'stockValidateOverlay')).toBe('flex');
  expect(await app.page.evaluate(() => _adjErpOutsideFromSv)).toBe(true);
  const rows = await outsideRows(app.page);
  expect(rows.map((x) => [x.sku, x.kind])).toEqual([['BACK', 'outside'], ['GHOST', 'outside'], ['P-DEC', 'outside'], ['P-INC', 'outside'], ['PEND', 'outside'], ['LOT-PAIR', 'lotswap'], ['P-RECHK', 'ok']]);
  for (const x of rows) expect([x.sku, x.reason]).toEqual([x.sku, REASONS[x.sku]]);
  // ซ้อนเหนือจริง: z-index 501 > 500 และจุดกลางการ์ดนอกใบตกบนป็อปอัพนอกใบ (ไม่ใช่ Stock Validate)
  const z = await app.page.evaluate(() => {
    const o = document.getElementById('adjErpOutsideOverlay'), s = document.getElementById('stockValidateOverlay'), c = document.getElementById('adjErpOutsideCard').getBoundingClientRect();
    const hit = document.elementFromPoint(c.left + c.width / 2, c.top + 60);
    return { zo: +getComputedStyle(o).zIndex, zs: +getComputedStyle(s).zIndex, inside: !!hit && o.contains(hit) };
  });
  expect(z).toEqual({ zo: 501, zs: 500, inside: true });
  await closeApp(app);
});

test('★ badge = ไม่ตรง + นอกใบที่ยังไม่รับทราบ · รับทราบแล้วลดเอง · ยกเลิก/ใบใหม่หลังรับทราบ = กลับมานับ · tooltip แตกตัวเลข', async ({ browser }) => {
  const app = await bootBare(browser);
  await seed(app.page);
  await app.page.evaluate(() => _applyStatAuditCardMode());   // เหมือนหลัง login: hub คำนวณ badge โดยไม่เปิดป็อปอัพใด
  expect(await badge(app.page)).toEqual({ text: '6', bg: RED, tip: TIP(1, 5, 1, 2) });   // 1 ไม่ตรง (SA-BAD) + 5 นอกใบ (ลด 3 · เพิ่ม 2)
  // เปิดจากปุ่มใน Stock Validate แล้วกดรับทราบ P-DEC → badge ลดเอง · ปุ่มเปลี่ยนเป็น ✓ รับทราบแล้ว 1 (ไม่ต้องปิด-เปิดป็อปอัพ)
  await app.page.evaluate(() => { openStockValidatePopup(); openAdjErpOutsideFromSv(); });
  await ack(app.page, 'P-DEC');
  expect(await app.page.evaluate(() => (window.__store['stock_sessions/SRC_adjerpack'] || {}).countResetAt)).toBe(EPOCH);
  expect(await badge(app.page)).toEqual({ text: '5', bg: RED, tip: TIP(1, 4, 1, 2) });
  expect(await btn(app.page)).toEqual({ text: '⚠️ ใบปรับปรุงลดสินค้า 2 · ใบปรับปรุงเพิ่มสินค้า 2 · ✓ รับทราบแล้ว 1 · 🔁 ปรับปรุง LOT สินค้า 1', warn: true, onclick: 'openAdjErpOutsideFromSv()' });
  // รับทราบครบทุกตัวที่เป็น outside → ปุ่มไม่แดง · badge เหลือแค่ไม่ตรง
  for (const s of ['BACK', 'GHOST', 'P-INC', 'PEND']) await ack(app.page, s);
  expect(await badge(app.page)).toEqual({ text: '1', bg: RED, tip: TIP(1, 0, 1, 2) });   // ไม่มีส่วน "เอกสารนอกใบ" เมื่อเป็น 0 = ข้อความเดิม
  expect(await btn(app.page)).toEqual({ text: '✓ รับทราบแล้ว 5 · 🔁 ปรับปรุง LOT สินค้า 1', warn: false, onclick: 'openAdjErpOutsideFromSv()' });
  // ยกเลิกรับทราบ → กลับมานับ
  await app.page.evaluate(async () => { await undoAdjErpAck('PEND'); });
  expect((await badge(app.page)).text).toBe('2');
  // ใบใหม่ของ P-DEC หลังรับทราบ → รับทราบหมดอายุ (sig เปลี่ยน) → กลับมานับ + ป็อปอัพเตือน "มีใบใหม่หลังรับทราบ"
  await app.page.evaluate(([o, i]) => { __erp([o, i]); _applyStatAuditCardMode(); }, [FILE_O_MORE, FILE_I]);
  expect((await badge(app.page)).text).toBe('3');   // P-DEC (หมดอายุ) + PEND (ยกเลิก) + 1 ไม่ตรง
  expect((await btn(app.page)).text).toBe('⚠️ ใบปรับปรุงลดสินค้า 2 · ✓ รับทราบแล้ว 3 · 🔁 ปรับปรุง LOT สินค้า 1');
  // ป็อปอัพรายการที่เปิดค้างอยู่ไม่ถูกวาดเองตอนข้อมูลเปลี่ยน (ตั้งใจ — ไม่ล้างช่องพิมพ์หมายเหตุ) · สั่งวาดเอง = เห็นป้ายเตือนรับทราบหมดอายุ
  await app.page.evaluate(() => renderAdjErpOutsideTable());
  expect((await outsideRows(app.page)).find((x) => x.sku === 'P-DEC').ack).toContain('มีใบใหม่หลังรับทราบ');
  await closeApp(app);
});

test('★ 🔁 ปรับปรุง LOT / ℹ️ ปกติ / ✓ รับทราบแล้ว ไม่ทำให้ badge แดง · tooltip เป็นข้อความเดิมเมื่อไม่มีนอกใบที่ต้องเตือน', async ({ browser }) => {
  const app = await bootBare(browser);
  await seed(app.page, { files: [FILE_O_QUIET, FILE_I_QUIET], without: ['SA-BAD'] });   // ไม่มี Stock Adj ที่ไม่ตรง · นอกใบมีแต่ LOT-PAIR กับ P-RECHK
  await app.page.evaluate(() => _applyStatAuditCardMode());
  const res = await svRes(app.page);
  expect([res.mm, res.c]).toEqual([0, { warn: 0, acked: 0, lot: 1, ok: 1 }]);
  expect(await badge(app.page)).toEqual({ text: '0', bg: PALE, tip: TIP(0, 0, 1, 1) });   // ไม่แดง — LOT ที่พนักงานปรับเป็นงานปกติ
  await app.page.evaluate(() => openStockValidatePopup());
  expect(await btn(app.page)).toEqual({ text: '🔁 ปรับปรุง LOT สินค้า 1', warn: false, onclick: 'openAdjErpOutsideFromSv()' });
  // มีแต่ ℹ️ ปกติ อย่างเดียว → ปุ่มสรุปรวม ไม่แดง
  await seed(app.page, { files: [sheet([O('ORDSBY001', 'SA-OK', 2), O('ORDSBY001', 'P-RECHK', 1)])], without: ['SA-BAD', 'LOT-PAIR'] });
  await app.page.evaluate(() => { openStockValidatePopup(); });
  expect(await btn(app.page)).toEqual({ text: 'ℹ️ เอกสารปรับปรุง LOT สินค้า 1', warn: false, onclick: 'openAdjErpOutsideFromSv()' });
  expect((await badge(app.page)).bg).toBe(PALE);
  await closeApp(app);
});

test('★ "รับทราบ" อ่านให้ badge แบบ lazy จาก hub: ครั้งเดียวต่อ (สาขา|รอบ) · ล้ม/ออฟไลน์ไม่วนซ้ำ · รอบใหม่อ่านใหม่ · ไม่มีรายการ outside/ไม่มีรายงาน = ไม่อ่าน · logout ล้างตัวจำ', async ({ browser }) => {
  const app = await bootBare(browser);
  await seed(app.page);
  const gets = () => app.page.evaluate((k) => window.__gets[k] || 0, ACK_KEY);
  // เตรียมรับทราบบน cloud: P-DEC รับทราบแล้ว (sig ตรงใบปัจจุบัน) — เครื่องนี้ยังไม่เคยอ่าน (เหมือนเพิ่ง login)
  await app.page.evaluate(({ EPOCH }) => {
    const docs = _adjErpOutsideList().find((x) => x.sku === 'P-DEC').docs;
    window.__store['stock_sessions/SRC_adjerpack'] = { countResetAt: EPOCH, acks_json: JSON.stringify({ 'P-DEC': { note: 'ปรับปรุง LOT สินค้า', by: 'Pharm', at: '2026-10-10T00:00:00.000Z', sig: _adjErpSig(docs) } }) };
  }, { EPOCH });
  expect(await gets()).toBe(0);
  await app.page.evaluate(() => { __holdGets(); _refreshStockValidate(); });   // เริ่มอ่านแต่ให้ค้างไว้ = สังเกตสถานะระหว่างอ่าน
  expect((await badge(app.page)).text).toBe('6');                     // ขณะยังไม่อ่านเสร็จ: นับทุกตัวเป็นยังไม่รับทราบ (ถูกต้องตามที่รู้ ณ ตอนนั้น)
  expect(await gets()).toBe(1);
  await app.page.evaluate(() => { _refreshStockValidate(); _refreshStockValidate(); });   // hub ซ้ำระหว่างอ่านค้าง → ต้องไม่เริ่มอ่านซ้อน
  expect(await gets()).toBe(1);
  await app.page.evaluate(() => __gateRelease());
  await app.page.waitForFunction(() => !!_adjErpAckCurrent(), null, { polling: 50 });
  expect((await badge(app.page)).text).toBe('5');                     // อ่านเสร็จ → _adjErpOutsideRefresh → hub วาด badge ใหม่เอง (ไม่ต้องเปิดป็อปอัพ)
  expect(await gets()).toBe(1);
  for (let i = 0; i < 5; i++) await app.page.evaluate(() => _refreshStockValidate());   // hub ถูกเรียกทุก updateStats — ต้องไม่อ่านซ้ำ
  expect(await gets()).toBe(1);
  // เปลี่ยนรอบนับ → ผลรับทราบของรอบเก่าไม่ใช้ → อ่านใหม่ 1 ครั้ง (doc บน cloud ยังเป็นของรอบเก่า → ว่าง → นับทุกตัวอีกครั้ง)
  await app.page.evaluate(({ EPOCH2 }) => { _countResetAt = EPOCH2; _adjErp.epoch = EPOCH2; _pharmacyAuditMarkerData.countResetAt = EPOCH2; _refreshStockValidate(); }, { EPOCH2 });
  await app.page.waitForFunction((e2) => { const a = _adjErpAckCurrent(); return !!a && a.epoch === e2; }, EPOCH2, { polling: 50 });
  expect(await gets()).toBe(2);
  expect((await badge(app.page)).text).toBe('6');
  // อ่านล้ม (ออฟไลน์/permission) → ลองครั้งเดียวต่อรอบ ไม่วนซ้ำทุกรอบ hub · badge ยังคำนวณได้ (นับทุกตัว)
  await seed(app.page);
  await app.page.evaluate(() => { window.__failGet = 'unavailable'; });
  for (let i = 0; i < 4; i++) await app.page.evaluate(() => _refreshStockValidate());
  await app.page.waitForFunction((k) => (window.__gets[k] || 0) >= 1, ACK_KEY, { polling: 50 });
  await app.page.evaluate(() => new Promise((r) => setTimeout(r, 150)));
  expect(await gets()).toBe(1);
  expect((await badge(app.page)).text).toBe('6');
  // เปิดป็อปอัพ = ผู้ใช้สั่งเอง → ลองอ่านใหม่ (ได้ 1 ครั้ง) แม้ครั้งก่อนล้ม
  await app.page.evaluate(() => { window.__failGet = null; openStockValidatePopup(); });
  await app.page.waitForFunction(() => !!_adjErpAckCurrent(), null, { polling: 50 });
  expect(await gets()).toBe(2);
  // ไม่มี outside จริง (มีแต่ LOT/ปกติ) หรือไม่มีรายงาน = ไม่อ่านเลย
  await seed(app.page, { files: [FILE_O_QUIET, FILE_I_QUIET] });
  await app.page.evaluate(() => _refreshStockValidate());
  await app.page.evaluate(() => new Promise((r) => setTimeout(r, 100)));
  expect(await gets()).toBe(0);
  await seed(app.page, { files: [] });
  await app.page.evaluate(() => _refreshStockValidate());
  await app.page.evaluate(() => new Promise((r) => setTimeout(r, 100)));
  expect(await gets()).toBe(0);
  // logout ล้างตัวจำ → login ครั้งถัดไป (หน้าเดิม ไม่รีโหลด) อ่านใหม่ให้ badge
  await seed(app.page);
  await app.page.evaluate(() => _refreshStockValidate());
  await app.page.waitForFunction(() => !!_adjErpAckCurrent(), null, { polling: 50 });
  expect(await app.page.evaluate(() => _svAckTried)).toBe(`SRC|${EPOCH}`);
  await app.page.evaluate(() => { currentRole = ''; currentUser = ''; updateAdjustDocPanel(); });
  expect(await app.page.evaluate(() => [_svAckTried, _adjErpAck])).toEqual(['', null]);
  await closeApp(app);
});

test('ป็อปอัพนอกใบที่เปิดจาก Stock Validate: ปิดเฉพาะอันนั้นกลับมาที่ Stock Validate · ปิด Stock Validate/หมดสิทธิ์ปิดตาม · ที่ 📦 เปิดไว้ไม่ถูกแตะ', async ({ browser }) => {
  const app = await bootBare(browser);
  await seed(app.page);
  await app.page.evaluate(() => openStockValidatePopup());
  // ปิดแค่ป็อปอัพนอกใบ → Stock Validate ยังอยู่
  await app.page.evaluate(() => openAdjErpOutsideFromSv());
  expect(await display(app.page, 'adjErpOutsideOverlay')).toBe('flex');
  await app.page.evaluate(() => closeAdjErpOutsidePopup());
  await waitHidden(app.page, 'adjErpOutsideOverlay');
  expect([await display(app.page, 'stockValidateOverlay'), await app.page.evaluate(() => _adjErpOutsideFromSv)]).toEqual(['flex', false]);
  // ปิด Stock Validate ขณะนอกใบเปิดอยู่ (เปิดจากหน้านี้) → นอกใบถูกปิดทันทีด้วย ไม่ค้างลอย
  await app.page.evaluate(() => openAdjErpOutsideFromSv());
  await app.page.evaluate(() => closeStockValidatePopup());
  expect(await display(app.page, 'adjErpOutsideOverlay')).toBe('none');
  await waitHidden(app.page, 'stockValidateOverlay');
  // เปิดจาก 📦 (ไม่ใช่จากหน้านี้) แล้วปิด Stock Validate → ไม่แตะ
  await app.page.evaluate(() => { openStockValidatePopup(); openAdjErpOutsidePopup(); });
  expect(await app.page.evaluate(() => _adjErpOutsideFromSv)).toBe(false);
  await app.page.evaluate(() => closeStockValidatePopup());
  await waitHidden(app.page, 'stockValidateOverlay');
  expect(await display(app.page, 'adjErpOutsideOverlay')).toBe('flex');
  await app.page.evaluate(() => { closeAdjErpOutsidePopup(); });
  await waitHidden(app.page, 'adjErpOutsideOverlay');
  // เปิดจากหน้านี้ แล้วหมดสิทธิ์ (logout) → ทั้งคู่ปิด
  await app.page.evaluate(() => { openStockValidatePopup(); openAdjErpOutsideFromSv(); });
  expect([await display(app.page, 'stockValidateOverlay'), await display(app.page, 'adjErpOutsideOverlay')]).toEqual(['flex', 'flex']);
  await app.page.evaluate(() => { currentRole = ''; currentUser = ''; updateAdjustDocPanel(); });
  expect([await display(app.page, 'stockValidateOverlay'), await display(app.page, 'adjErpOutsideOverlay'), await app.page.evaluate(() => _adjErpOutsideFromSv)]).toEqual(['none', 'none', false]);
  // เปิดไม่ได้ (ผู้ช่วยไม่มีสิทธิ์) → ไม่เปิดและไม่จำที่มา
  await seed(app.page, { role: 'assistant' });
  await app.page.evaluate(() => openAdjErpOutsideFromSv());
  expect([await display(app.page, 'adjErpOutsideOverlay'), await app.page.evaluate(() => _adjErpOutsideFromSv)]).toEqual(['none', false]);
  await closeApp(app);
});

test('★ สวิตช์ปิด = หน้านี้เท่าเดิมทุกตัวอักษร: ไม่มีปุ่ม · badge/tooltip เดิม · ไม่อ่านรับทราบ · ปุ่มใน 📦 ใช้ได้ · ADJ_ERP_LOT_AWARE ปิด = ไม่มีรายการนอกใบ', async ({ browser }) => {
  const app = await bootBare(browser);
  await seed(app.page);
  await app.page.evaluate(() => { STOCK_VALIDATE_OUTSIDE = false; });
  const res = await app.page.evaluate(() => { const r = _stockValidateRows(); return { list: r.outside.list, c: r.outside.c, mm: r.counts.mismatch }; });
  expect(res).toEqual({ list: [], c: { warn: 0, acked: 0, lot: 0, ok: 0 }, mm: 1 });
  await app.page.evaluate(() => { _refreshStockValidate(); openStockValidatePopup(); });
  expect(await btn(app.page)).toBeNull();
  expect(await badge(app.page)).toEqual({ text: '1', bg: RED, tip: TIP(1, 0, 1, 2) });   // ข้อความเดิมก่อนแก้เป๊ะ: "ไม่ตรง 1 · ตรง 1 · Stock Adj ทั้งหมด 2 รายการ"
  expect(TIP(1, 0, 1, 2)).toBe('ไม่ตรง 1 · ตรง 1 · Stock Adj ทั้งหมด 2 รายการ');
  expect(await app.page.evaluate(() => document.getElementById('svBar').innerHTML.includes('adj-erp-outside-btn'))).toBe(false);
  await app.page.evaluate(() => new Promise((r) => setTimeout(r, 150)));
  expect(await app.page.evaluate((k) => window.__gets[k] || 0, ACK_KEY)).toBe(0);   // hub กับเปิดป็อปอัพไม่อ่านรับทราบ
  await app.page.evaluate(() => openAdjErpOutsideFromSv());
  expect(await display(app.page, 'adjErpOutsideOverlay')).toBe('none');           // ทางเปิดจากหน้านี้ปิดตามสวิตช์
  // ทางเดิมจาก 📦 ไม่กระทบ
  await app.page.evaluate(() => openAdjErpOutsidePopup());
  expect((await outsideRows(app.page)).length).toBe(7);
  // เปิดสวิตช์แต่ LOT_AWARE ปิด → ไม่มีรายการนอกใบ (ตัวตรวจเดิมว่างเอง) → ไม่มีปุ่ม · badge เท่าเดิม
  await app.page.evaluate(() => { closeAdjErpOutsidePopup(); STOCK_VALIDATE_OUTSIDE = true; ADJ_ERP_LOT_AWARE = false; _refreshStockValidate(); });
  expect(await btn(app.page)).toBeNull();
  expect(await badge(app.page)).toEqual({ text: '1', bg: RED, tip: TIP(1, 0, 1, 2) });
  await closeApp(app);
});

test('สิทธิ์ + ไม่มีรายงาน: ผู้ช่วย/WH ไม่เห็นหน้านี้ · ไม่มีรายงาน = แถบซ่อน ไม่มีปุ่ม badge "—" ไม่อ่านรับทราบ', async ({ browser }) => {
  const app = await bootBare(browser);
  // ไม่มีรายงาน
  await seed(app.page, { files: [] });
  await app.page.evaluate(() => { _refreshStockValidate(); openStockValidatePopup(); });
  expect(await app.page.evaluate(() => [document.getElementById('svBar').style.display, document.getElementById('svBar').innerHTML, document.getElementById('stockValidateCount').textContent]))
    .toEqual(['none', '', '—']);
  expect(await app.page.evaluate(() => _stockValidateRows().outside)).toEqual({ list: [], c: { warn: 0, acked: 0, lot: 0, ok: 0 } });
  // ผู้ช่วย / WH: การ์ดซ่อน · ไม่คำนวณ · เปิดนอกใบจากหน้านี้ไม่ได้
  for (const opt of [{ role: 'assistant' }, { branch: 'WH', role: 'supervisor', files: [] }]) {
    await seed(app.page, opt);
    await app.page.evaluate(() => { _refreshStockValidate(); openAdjErpOutsideFromSv(); });
    expect([opt, await app.page.evaluate(() => [document.getElementById('stockValidatePanel').style.display, _stockValidateEnabled(), document.getElementById('adjErpOutsideOverlay').style.display])])
      .toEqual([opt, ['none', false, 'none']]);
  }
  await closeApp(app);
});

test('รายงานเปลี่ยน/เอกสารใหม่ = ปุ่ม + badge ขยับเองผ่าน hub โดยป็อปอัพคงเปิดอยู่ (ไม่ต้องปิด-เปิด)', async ({ browser }) => {
  const app = await bootBare(browser);
  await seed(app.page);
  await app.page.evaluate(() => openStockValidatePopup());
  expect([(await badge(app.page)).text, (await btn(app.page)).text]).toEqual(['6', BTN_ALL]);
  // เอกสารใหม่ของสินค้า Pass อีกตัว (P-NEW) → นอกใบ +1 (เพิ่ม)
  await app.page.evaluate(([o, i]) => {
    state.skuMap.set('P-NEW', { sku: 'P-NEW', productName: 'สินค้า P-NEW', unitPrice: 20, systemQty: 10, negSys: false, barcodes: [], isDel: false });
    state.scanData.set('P-NEW', { auditor: '', countedQty: 4, timestamp: '2026-08-10 16:00:00', firstScanAt: '2026-08-10 16:00:00', scannedBy: 'Asst', status: 'pass', auditStatus: 'approved', initialStatus: 'pass' });
    __erp([o, i]); _applyStatAuditCardMode();
  }, [FILE_O, sheet([...FILE_I.slice(1), I('IRPSBY001', 'P-NEW', 1)])]);
  expect([(await badge(app.page)).text, (await btn(app.page)).text, await display(app.page, 'stockValidateOverlay')])
    .toEqual(['7', '⚠️ ใบปรับปรุงลดสินค้า 3 · ใบปรับปรุงเพิ่มสินค้า 3 · 🔁 ปรับปรุง LOT สินค้า 1', 'flex']);
  // แอปสั่งปรับสินค้านี้เองแล้ว (กลายเป็น Stock Adj ที่ต้อง IRPS 1 ตรงกับใบ) → อยู่ใน Y ไม่ใช่นอกใบอีก → badge ลด 1 (ไม่ไปเพิ่มฝั่งไม่ตรง เพราะใบตรง)
  await app.page.evaluate(() => { const sd = state.scanData.get('P-NEW'); Object.assign(sd, { status: 'stock_adjustment', auditStatus: 'stock_adjustment', initialStatus: 'stock_adjustment', directAdj: true, effectiveQty: 5, systemQty: 4 }); _applyStatAuditCardMode(); });
  expect([(await badge(app.page)).text, (await btn(app.page)).text]).toEqual(['6', '⚠️ ใบปรับปรุงลดสินค้า 3 · ใบปรับปรุงเพิ่มสินค้า 2 · 🔁 ปรับปรุง LOT สินค้า 1']);
  expect(await app.page.evaluate(() => _stockValidateRows().rows.map((x) => [x.sku, x.state]).filter(([s]) => s === 'P-NEW'))).toEqual([['P-NEW', 'match']]);
  await closeApp(app);
});

test('id ไม่ซ้ำเมื่อแถบ 📦 กับแถบ Stock Validate วาดพร้อมกัน · ปุ่ม 2 ที่แสดงข้อความเดียวกัน · onclick คนละทาง', async ({ browser }) => {
  const app = await bootBare(browser);
  await seed(app.page);
  const r = await app.page.evaluate(() => {
    openStockValidatePopup();
    renderAdjustDocTable(true);   // วางปุ่มของ 📦 ลงแถบ 🧾
    const ids = [...document.querySelectorAll('[id]')].map((e) => e.id);
    const a = document.getElementById('adjErpOutsideBtn'), s = document.getElementById('svOutsideBtn');
    return { dup: ids.filter((x, i) => ids.indexOf(x) !== i), a: a && [a.textContent, a.getAttribute('onclick')], s: s && [s.textContent, s.getAttribute('onclick')] };
  });
  expect(r.dup).toEqual([]);
  expect(r.a).toEqual([BTN_ALL, 'openAdjErpOutsidePopup()']);
  expect(r.s).toEqual([BTN_ALL, 'openAdjErpOutsideFromSv()']);
  await closeApp(app);
});

test('ปุ่มยาวสุด (ลด+เพิ่ม+รับทราบแล้ว+LOT) ไม่ล้นการ์ดที่ 960px (แบ่งครึ่งจอคู่ ProMaxx) — แถบห่อบรรทัดเอง', async ({ browser }) => {
  const app = await bootBare(browser);
  await app.page.setViewportSize({ width: 960, height: 900 });
  await seed(app.page);
  await app.page.evaluate(({ EPOCH }) => {
    // รับทราบ 1 ตัวให้ปุ่มมีครบ 4 ส่วน — ใส่ที่เก็บจำลอง (เปิดป็อปอัพแล้วอ่านรับทราบจากที่เก็บมาทับของในหน่วยความจำ จึงใส่ในหน่วยความจำอย่างเดียวไม่ได้)
    const docs = _adjErpOutsideList().find((x) => x.sku === 'P-DEC').docs;
    window.__store['stock_sessions/SRC_adjerpack'] = { countResetAt: EPOCH, acks_json: JSON.stringify({ 'P-DEC': { note: 'x', by: 'Pharm', at: '2026-10-10T00:00:00.000Z', sig: _adjErpSig(docs) } }) };
    openStockValidatePopup();
  }, { EPOCH });
  await app.page.waitForFunction(() => { const a = _adjErpAckCurrent(); return !!a && !!a.acks['P-DEC']; }, null, { polling: 50 });
  await app.page.waitForFunction(() => document.getElementById('stockValidateCard').getAnimations().length === 0, null, { polling: 50 });
  const m = await app.page.evaluate(() => {
    const card = document.getElementById('stockValidateCard').getBoundingClientRect(), b = document.getElementById('svOutsideBtn').getBoundingClientRect();
    const bar = document.getElementById('svBar'), body = document.querySelector('#stockValidateCard .stock-popup-body');
    return { text: document.getElementById('svOutsideBtn').textContent, left: b.left >= card.left, right: b.right <= card.right, barOverflow: bar.scrollWidth > bar.clientWidth,
      table: body.querySelector('table').scrollWidth <= body.clientWidth };
  });
  expect(m, JSON.stringify(m)).toEqual({ text: '⚠️ ใบปรับปรุงลดสินค้า 2 · ใบปรับปรุงเพิ่มสินค้า 2 · ✓ รับทราบแล้ว 1 · 🔁 ปรับปรุง LOT สินค้า 1', left: true, right: true, barOverflow: false, table: true });
  await closeApp(app);
});
