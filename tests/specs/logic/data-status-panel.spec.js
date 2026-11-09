// แผง DATA STATUS (Timeline) แทนการ์ด "Upload File" เดิมของสาขายา SRC/KKL/SSS (9 พ.ย. 2026 · ผู้ใช้สั่ง · สวิตช์ DATA_STATUS_PANEL)
//
// กติกาที่ผู้ใช้สั่ง → สิ่งที่เทสนี้ตรึง:
//   1. เฉพาะสาขายา — WH ไม่แตะ (HTML ของการ์ดเท่าเดิมทุกไบต์ + ไม่เคยได้ DOM ของแผง)
//   2. ชื่อ DATA STATUS · ปุ่ม Guide แบบ Soft UI · พนักงานไม่มีปุ่มอัปโหลด
//   3. Product Master/R05 เห็นเฉพาะ Admin Mode เหมือนเดิม · ทางสำรองตอนบอทพัง = ปุ่มอัปโหลดในแผง เฉพาะ Admin Mode
//   4. ไม่มีสถานะ "ล่าช้า" — มีแค่ Ready / ยังไม่โหลด / ตรวจสอบวันที่ ตามที่การ์ดเดิมมีอยู่แล้ว
//   5. ★ ต้องไม่กระทบการอัปของบอท: แผงนี้เป็นตัวแสดงผลที่ "อ่านจากการ์ดเดิม" เท่านั้น — ห้ามเขียนอะไรกลับ (การ์ดเดิม/state/Firestore/localStorage)
//      และต้องถอยกลับไปใช้การ์ดเดิมเองเมื่อวาดพัง
//
// ไม่ใช้ emulator: เขียนค่าลงการ์ดเดิมด้วยวิธีเดียวกับโค้ดเดิม (badge.textContent / _setR01Ts / …) แล้วดูว่าแผงตามจริง
const { test, expect, bootBare, closeApp } = require('../../lib/hooks');

const BRANCHES = ['SRC', 'KKL', 'SSS'];
const FILE_OF = { pm: 'fileProductMaster', r01: 'fileR01', r05: 'fileR05', r16: 'fileR16' };

const setBranch = (page, b) => page.evaluate((b) => { currentBranch = b; updateBranchDisplay(); }, b);
// MutationObserver ของแผงรวมงานเป็น setTimeout(0) — รอให้จบก่อนอ่านผล
const settle = (page) => page.evaluate(() => new Promise((r) => setTimeout(r, 40)));
// หน้าเลือกสาขา/PIN/เลือกชื่อ/ฉากขาวคลุมจออยู่ตอนยังไม่ล็อกอิน — ซ่อนก่อนคลิกจริง (ผู้ใช้จริงคลิกหลังล็อกอิน โมดัลเหล่านี้ปิดแล้ว)
const clearOverlays = (page) => page.evaluate(() => { for (const id of ['branchModal', 'pinModal', 'employeeModal', 'bootCover']) { const e = document.getElementById(id); if (e) e.style.display = 'none'; } });
const setAdmin = async (page, on) => { await page.evaluate((on) => { _adminMode = on; applyAdminUI(); }, on); await settle(page); };

// สิ่งที่ผู้ใช้เห็นจริง (computed style) ของแผงใหม่ + การ์ดเดิม
const snap = (page) => page.evaluate(() => {
  const root = document.getElementById('dsPanel');
  const card = document.getElementById('uploadPanel');
  const vis = (e) => !!e && getComputedStyle(e).display !== 'none' && e.getClientRects().length > 0;
  return {
    on: card.classList.contains('ds-on'),
    exists: !!root,
    visible: vis(root),
    title: root ? root.querySelector('.ds-title').textContent.trim() : null,
    guide: root && root.querySelector('.ds-guide') ? root.querySelector('.ds-guide').textContent : null,
    rows: root ? [...root.querySelectorAll('li[data-ds]')].map((li) => ({
      id: li.dataset.ds, shown: vis(li), st: li.dataset.st,
      name: li.querySelector('.ds-nm').textContent, sub: li.querySelector('.ds-t2').textContent,
      label: li.querySelector('.ds-sl').textContent,
      kv: [...li.querySelectorAll('.ds-kv > dd')].map((dd) => [dd.previousElementSibling && dd.previousElementSibling.tagName === 'DT' ? dd.previousElementSibling.textContent : '', dd.textContent]),
      note: vis(li.querySelector('.ds-nt')) ? li.querySelector('.ds-nt').textContent : '',
      up: vis(li.querySelector('.ds-up')),
    })) : [],
    legacy: {
      header: vis(card.querySelector('.upload-panel-header')),
      items: [...card.querySelectorAll('.upload-file-item')].map((e) => vis(e)),
      pm: vis(document.getElementById('pmUploadSection')),
      r05: vis(document.getElementById('r05UploadSection')),
      r16103: vis(document.getElementById('r16103UploadSection')),
    },
  };
});
const shownIds = (s) => s.rows.filter((r) => r.shown).map((r) => r.id);
const row = (s, id) => s.rows.find((r) => r.id === id);

// เขียนลงการ์ดเดิมแบบที่โค้ดเดิมทำ (ไม่ผ่านแผง)
const legacy = (page, o) => page.evaluate((o) => {
  const set = (id, t) => { document.getElementById(id).textContent = t; };
  if (o.r01) { set('badgeR01', 'Ready'); _setR01Ts(o.r01); }
  if (o.r16) { set('badgeR16', 'Ready'); document.getElementById('badgeR16').parentElement.classList.remove('upload-file-badge-warn'); _setR16Ts(o.r16); }
  if (o.r16range) document.getElementById('r16Timestamp').textContent += ' · ข้อมูล ' + o.r16range;   // เหมือนตอนอัป R16 (ต่อท้ายเวลาอัปโหลด)
  if (o.r16warn) { set('badgeR16', '⚠️ ตรวจสอบวันที่'); document.getElementById('badgeR16').parentElement.classList.add('upload-file-badge-warn'); }
  if (o.pm) { set('badgeProductMaster', 'Ready'); _setPmTs(o.pm); }
  if (o.r05) { set('badgeR05', 'Ready'); _setR05Ts(o.r05); }
  if (o.r05chk) _setR05CheckedTs(o.r05chk);
  if (o.reset) {
    for (const k of ['ProductMaster', 'R01', 'R05', 'R16']) set('badge' + k, 'ยังไม่โหลด');
    document.getElementById('badgeR16').parentElement.classList.remove('upload-file-badge-warn');
    _setR01Ts(''); _setR16Ts(''); _setPmTs(''); _setR05Ts('');
  }
}, o);

test.describe('แผง DATA STATUS (สาขายา)', () => {
  test('ค่าที่ส่งมอบ: สวิตช์เปิด · ยังไม่เลือกสาขา = ไม่มีแผง · id เดิมของการ์ดครบ', async ({ browser }) => {
    const app = await bootBare(browser);
    const r = await app.page.evaluate(() => ({
      sw: DATA_STATUS_PANEL, title: DS_TITLE, items: DS_ITEMS.map((d) => d.id),
      missing: ['badgeProductMaster', 'badgeR01', 'badgeR05', 'badgeR16', 'pmTimestamp', 'r01Timestamp', 'r05Timestamp', 'r16Timestamp',
        'fileProductMaster', 'fileR01', 'fileR05', 'fileR16', 'pmUploadSection', 'r05UploadSection', 'r16103UploadSection', 'guidePopover']
        .filter((id) => !document.getElementById(id)),
      on: document.getElementById('uploadPanel').classList.contains('ds-on'),
      exists: !!document.getElementById('dsPanel'),
      guideStillWorks: typeof openGuideModal === 'function',
    }));
    expect(r.sw, 'ส่งมอบแบบเปิด').toBe(true);
    expect(r.title).toBe('DATA STATUS');
    expect(r.items).toEqual(['pm', 'r01', 'r05', 'r16']);
    expect(r.missing, 'id เดิมที่โค้ด/บอท/เทสอื่นอ้างอยู่ต้องไม่หาย').toEqual([]);
    expect(r.on).toBe(false);
    expect(r.exists, 'สร้าง DOM ตอนต้องใช้เท่านั้น (WH ไม่เคยได้)').toBe(false);
    expect(r.guideStillWorks).toBe(true);
    await closeApp(app);
  });

  for (const b of BRANCHES) {
    test(`★ ${b}: แผงขึ้น · การ์ดเดิมซ่อน · พนักงานเห็นแค่ R01+R16 · ไม่มีปุ่มอัปโหลด`, async ({ browser }) => {
      const app = await bootBare(browser);
      await setBranch(app.page, b);
      const s = await snap(app.page);
      expect(s.on).toBe(true);
      expect(s.visible).toBe(true);
      expect(s.title).toBe('DATA STATUS');
      expect(s.guide).toBe('Guide');
      expect(shownIds(s), 'พนักงาน: PM/R05 เห็นเฉพาะ Admin Mode เหมือนเดิม').toEqual(['r01', 'r16']);
      expect(s.rows.every((r) => !r.up), 'ไม่มีปุ่มอัปโหลดสำหรับพนักงาน').toBe(true);
      expect(row(s, 'r01')).toMatchObject({ name: 'R01.102', sub: 'จำนวนสินค้า' });
      expect(row(s, 'r16')).toMatchObject({ name: 'R16.104', sub: 'สินค้าที่ขาย' });
      // ยังไม่มีข้อมูลจากบอท = เทาเป็นกลาง "ยังไม่โหลด" (ไม่ใช่สถานะแจ้งเตือน)
      expect(row(s, 'r01')).toMatchObject({ st: 'none', label: 'ยังไม่โหลด' });
      expect(row(s, 'r16')).toMatchObject({ st: 'none', label: 'ยังไม่โหลด' });
      // การ์ดเดิมถูกซ่อนหมด (หัวเดิม + ทุกแถว) — ไม่ซ้อนกัน
      expect(s.legacy.header).toBe(false);
      expect(s.legacy.items.every((v) => v === false)).toBe(true);
      expect(s.legacy.pm || s.legacy.r05 || s.legacy.r16103).toBe(false);
      await closeApp(app);
    });
  }

  test('★ WH ไม่แตะ: HTML การ์ดเท่ากับตอนปิดสวิตช์ทุกไบต์ · ไม่เคยได้ DOM ของแผง · การ์ดเดิมเห็นครบ', async ({ browser }) => {
    const grab = async (switchOn) => {
      const app = await bootBare(browser);
      await app.page.evaluate((on) => { DATA_STATUS_PANEL = on; currentBranch = 'WH'; updateBranchDisplay(); }, switchOn);
      const html = await app.page.evaluate(() => document.getElementById('uploadPanel').outerHTML);
      const s = await snap(app.page);
      await closeApp(app);
      return { html, s };
    };
    const on = await grab(true);
    const off = await grab(false);
    expect(on.html).toBe(off.html);
    expect(on.s.exists).toBe(false);
    expect(on.s.on).toBe(false);
    expect(on.s.legacy).toEqual(off.s.legacy);
    expect(on.s.legacy.header, 'หัว Upload File เดิมยังเห็น').toBe(true);
    expect(on.s.legacy.items.filter(Boolean).length, 'R01 · R16 · R16.103 เห็นเหมือนเดิม').toBe(3);
  });

  test('สลับสาขา SRC → WH → KKL → SSS → WH: แผงตามสาขา · WH เห็นการ์ดเดิมเท่าเดิมทุกครั้ง', async ({ browser }) => {
    const base = await bootBare(browser);
    await base.page.evaluate(() => { DATA_STATUS_PANEL = false; currentBranch = 'WH'; updateBranchDisplay(); });
    const whLegacy = (await snap(base.page)).legacy;
    await closeApp(base);

    const app = await bootBare(browser);
    for (const b of ['SRC', 'WH', 'KKL', 'SSS', 'WH']) {
      await setBranch(app.page, b);
      await settle(app.page);
      const s = await snap(app.page);
      if (b === 'WH') {
        expect(s.on, `${b} ไม่ใช้แผง`).toBe(false);
        expect(s.visible, `${b}: แผงที่เคยสร้างต้องไม่โผล่`).toBe(false);
        expect(s.legacy, `${b}: การ์ดเดิมเท่าเดิม`).toEqual(whLegacy);
      } else {
        expect(s.on).toBe(true);
        expect(s.visible).toBe(true);
        expect(shownIds(s)).toEqual(['r01', 'r16']);
      }
    }
    await closeApp(app);
  });

  test('สะท้อนค่าจากการ์ดเดิม: Ready / ยังไม่โหลด / ตรวจสอบวันที่ + เวลา + ช่วงข้อมูล R16', async ({ browser }) => {
    const app = await bootBare(browser);
    await setBranch(app.page, 'SRC');

    // บอท R01 อัปแล้ว (เช้า) · R16 ยังไม่ (กลางวัน — บอท R16 รัน 21:10)
    await legacy(app.page, { r01: '08:10 น. 09/11/2026' });
    await settle(app.page);
    let s = await snap(app.page);
    expect(row(s, 'r01')).toMatchObject({ st: 'ok', label: 'Ready', kv: [['อัปโหลด', '08:10 น. 09/11/2026']] });
    expect(row(s, 'r16')).toMatchObject({ st: 'none', label: 'ยังไม่โหลด', kv: [] });

    // คืนนั้นบอท R16 อัป: เวลาอัปโหลด + ช่วงข้อมูลต่อท้าย
    await legacy(app.page, { r16: '21:10 น. 08/11/2026', r16range: '08/11 08:02–08/11 20:58' });
    await settle(app.page);
    s = await snap(app.page);
    expect(row(s, 'r16')).toMatchObject({
      st: 'ok', label: 'Ready',
      kv: [['อัปโหลด', '21:10 น. 08/11/2026'], ['ข้อมูล', '08/11 08:02–08/11 20:58']],
    });

    // R16 ตรวจสอบวันที่ (badge เหลือง) — ข้อความไม่มีสัญลักษณ์ซ้ำซ้อน
    await legacy(app.page, { r16warn: true });
    await settle(app.page);
    s = await snap(app.page);
    expect(row(s, 'r16')).toMatchObject({ st: 'warn', label: 'ตรวจสอบวันที่' });
    expect(row(s, 'r01')).toMatchObject({ st: 'ok' });

    // เช้าวันใหม่ auto-r01 ล้าง R16 (เหมือนโค้ดเดิม) → กลับเป็นยังไม่โหลดเทา ไม่ใช่เตือน
    await legacy(app.page, { reset: true });
    await legacy(app.page, { r01: '07:31 น. 10/11/2026' });
    await settle(app.page);
    s = await snap(app.page);
    expect(row(s, 'r16')).toMatchObject({ st: 'none', label: 'ยังไม่โหลด', kv: [] });
    expect(row(s, 'r01')).toMatchObject({ st: 'ok', kv: [['อัปโหลด', '07:31 น. 10/11/2026']] });
    await closeApp(app);
  });

  test('★ ค่าที่ badge ไม่รู้จัก ไม่ถูกอ้างว่า Ready · ว่าง = ยังไม่โหลด', async ({ browser }) => {
    const app = await bootBare(browser);
    await setBranch(app.page, 'SRC');
    await app.page.evaluate(() => { document.getElementById('badgeR01').textContent = 'กำลังโหลด…'; document.getElementById('badgeR16').textContent = ''; });
    await settle(app.page);
    const s = await snap(app.page);
    expect(row(s, 'r01')).toMatchObject({ st: 'none', label: 'กำลังโหลด…' });
    expect(row(s, 'r16')).toMatchObject({ st: 'none', label: 'ยังไม่โหลด' });
    await closeApp(app);
  });

  test('Admin Mode: แถว PM/R05 + ปุ่มอัปโหลดทุกแถวโผล่ · ออกจาก Admin = กลับเป็นพนักงาน · เนื้อหา R05 (2 เวลา + เตือนบอทไม่ตรวจวันนี้)', async ({ browser }) => {
    const app = await bootBare(browser);
    await setBranch(app.page, 'KKL');
    await legacy(app.page, { r01: '08:10 น. 09/11/2026', r16: '21:10 น. 08/11/2026', pm: '07:05 น. 08/11/2026', r05: '06:35 น. 03/11/2026' });
    await settle(app.page);

    let s = await snap(app.page);
    expect(shownIds(s)).toEqual(['r01', 'r16']);
    expect(s.rows.filter((r) => r.up)).toEqual([]);

    await setAdmin(app.page, true);
    s = await snap(app.page);
    expect(shownIds(s), 'Admin: ทั้ง 4 แถว').toEqual(['pm', 'r01', 'r05', 'r16']);
    expect(s.rows.filter((r) => r.up).map((r) => r.id), 'ปุ่มอัปโหลดทุกแถว').toEqual(['pm', 'r01', 'r05', 'r16']);
    expect(row(s, 'pm')).toMatchObject({ st: 'ok', name: 'Product Master', kv: [['อัปโหลด', '07:05 น. 08/11/2026']] });
    expect(row(s, 'r05')).toMatchObject({ st: 'ok', name: 'R05.106', sub: 'Barcode', kv: [['อัปโหลด', '06:35 น. 03/11/2026']] });

    // R05 มี 2 เวลา: ตรวจเมื่อวันก่อน = เตือน · ตรวจวันนี้ = ไม่มีเตือน (กติกาเดิมของการ์ด)
    await legacy(app.page, { r05chk: '08:00 น. 01/01/2020' });
    await settle(app.page);
    s = await snap(app.page);
    expect(row(s, 'r05').kv).toEqual([['อัปโหลด', '06:35 น. 03/11/2026'], ['ตรวจ', '08:00 น. 01/01/2020']]);
    expect(row(s, 'r05').note).toBe('บอทยังไม่ได้ตรวจวันนี้');
    await app.page.evaluate(() => _setR05CheckedTs(formatThaiDateTime(new Date())));
    await settle(app.page);
    s = await snap(app.page);
    expect(row(s, 'r05').note, 'ตรวจวันนี้แล้ว = ไม่มีเตือน').toBe('');
    expect(row(s, 'r05').kv.map((x) => x[0])).toEqual(['อัปโหลด', 'ตรวจ']);

    await setAdmin(app.page, false);
    s = await snap(app.page);
    expect(shownIds(s)).toEqual(['r01', 'r16']);
    expect(s.rows.filter((r) => r.up)).toEqual([]);
    await closeApp(app);
  });

  test('★ ปุ่มอัปโหลด (Admin): คลิกจริงเปิดตัวเลือกไฟล์ของ input เดิมของแถวนั้น · พนักงานเรียกไม่ได้', async ({ browser }) => {
    const app = await bootBare(browser);
    await setBranch(app.page, 'SRC');
    await setAdmin(app.page, true);
    await clearOverlays(app.page);
    for (const id of ['pm', 'r01', 'r05', 'r16']) {
      // จำลองว่าเคยเลือกไฟล์ไว้แล้ว (ตั้ง files ตรงๆ — ไม่ยิง change จึงไม่เรียก loadX) · ถ้าปุ่มไม่รีเซ็ตค่า การเลือกไฟล์เดิมซ้ำจะไม่ยิง change
      await app.page.evaluate((inputId) => {
        const dt = new DataTransfer(); dt.items.add(new File(['x'], 'prev.csv', { type: 'text/csv' }));
        document.getElementById(inputId).files = dt.files;
      }, FILE_OF[id]);
      expect(await app.page.evaluate((inputId) => document.getElementById(inputId).value, FILE_OF[id]), 'เตรียมค่าไฟล์เก่าไว้จริง').not.toBe('');
      const [fc] = await Promise.all([
        app.page.waitForEvent('filechooser', { timeout: 5000 }),
        app.page.click(`#dsPanel li[data-ds="${id}"] .ds-up`),
      ]);
      expect(await fc.element().evaluate((e) => e.id), `ปุ่ม ${id} → input เดิม`).toBe(FILE_OF[id]);
      expect(await fc.element().evaluate((e) => e.value), 'ค่าถูกรีเซ็ตก่อนเลือก (อัปไฟล์เดิมซ้ำได้) — เหมือนการ์ดเดิม').toBe('');
    }

    // ออกจาก Admin: ปุ่มซ่อน และถ้ามีใครเรียกตัวจัดการคลิกตรงๆ ต้องไม่แตะ input เลย
    await setAdmin(app.page, false);
    const clicks = await app.page.evaluate(() => {
      const calls = [];
      const real = HTMLInputElement.prototype.click;
      HTMLInputElement.prototype.click = function () { calls.push(this.id); };
      try { document.querySelectorAll('#dsPanel .ds-up').forEach((b) => b.click()); } finally { HTMLInputElement.prototype.click = real; }
      return calls;
    });
    expect(clicks).toEqual([]);
    await closeApp(app);
  });

  test('★ ไม่แตะการ์ดเดิม/state/Firestore/localStorage ตอนสร้างและวาดแผง (อ่านอย่างเดียว)', async ({ browser }) => {
    const app = await bootBare(browser);
    const out = await app.page.evaluate(async () => {
      currentBranch = 'SRC';
      const card = document.getElementById('uploadPanel');
      // node เดิมของการ์ดทั้งหมดใน #uploadPanel (ยกเว้นตัว #uploadPanel เอง ซึ่งรับคลาส ds-on + ลูกใหม่ 1 ตัวตามดีไซน์)
      const watched = [...card.querySelectorAll('*')];
      const before = new Map(watched.map((n) => [n, n.outerHTML]));
      const stateKey = () => JSON.stringify([state.r01Data.length, state.r01Version, state.r05Data.length, state.r16Loaded, state.r16UploadedAt, state.r01UploadedAt, state.productMasterUploadedAt, state.scanData.size]);
      const lsKey = () => JSON.stringify(Object.keys(localStorage).sort().map((k) => [k, localStorage.getItem(k)]));
      const stateBefore = stateKey(), lsBefore = lsKey();

      const recs = [];
      const mo = new MutationObserver((list) => recs.push(...list));
      mo.observe(card, { subtree: true, attributes: true, childList: true, characterData: true });
      const touched = [];
      const realDb = _db;
      _db = new Proxy({}, { get(_, p) { touched.push('db.' + String(p)); return () => { throw new Error('db touched'); }; } });
      const realSet = Storage.prototype.setItem, realRemove = Storage.prototype.removeItem;
      Storage.prototype.setItem = function () { touched.push('ls.set'); return realSet.apply(this, arguments); };
      Storage.prototype.removeItem = function () { touched.push('ls.remove'); return realRemove.apply(this, arguments); };
      try {
        _dsSync(); _dsRender(); _dsRender();
        await new Promise((r) => setTimeout(r, 40));
      } finally { _db = realDb; Storage.prototype.setItem = realSet; Storage.prototype.removeItem = realRemove; }
      mo.disconnect();

      // การเปลี่ยนแปลงที่ "ยอมให้" มีได้ = คลาส ds-on บน #uploadPanel · แทรก #dsPanel 1 ตัว · อะไรก็ตามที่เกิดใต้ #dsPanel (DOM ของแผงเอง)
      const ours = (r) => (r.target.closest && r.target.closest('#dsPanel'))
        || (r.target === card && r.type === 'attributes' && r.attributeName === 'class')
        || (r.target === card && r.type === 'childList' && r.removedNodes.length === 0 && [...r.addedNodes].every((n) => n.id === 'dsPanel'));
      const foreign = recs.filter((r) => !ours(r)).map((r) => `${r.type}:${r.attributeName || ''}@${r.target.id || r.target.className || r.target.nodeName}`);
      return {
        foreign,
        total: recs.length,
        changed: watched.filter((n) => !n.closest('#dsPanel') && n.outerHTML !== before.get(n)).map((n) => n.id || n.className),
        touched,
        stateSame: stateBefore === stateKey(),
        lsSame: lsBefore === lsKey(),
        panelBuilt: !!document.getElementById('dsPanel'),
        cardClass: card.className,
      };
    });
    expect(out.panelBuilt).toBe(true);
    expect(out.total, 'มีการเปลี่ยนแปลงจริง (ตัวตรวจต้องมองเห็น ds-on + แผง) — กันเทสผ่านเปล่า').toBeGreaterThanOrEqual(2);
    expect(out.foreign, 'ไม่มีการเปลี่ยนแปลงบน node เดิมของการ์ดเลย').toEqual([]);
    expect(out.changed).toEqual([]);
    expect(out.touched, 'ไม่แตะ Firestore/localStorage').toEqual([]);
    expect(out.stateSame).toBe(true);
    expect(out.lsSame).toBe(true);
    expect(out.cardClass).toContain('ds-on');
    await closeApp(app);
  });

  test('★ โครงเดิมที่โค้ดอื่นพึ่งอยู่ครบหลังแผงขึ้น: input ยังติดกับการ์ดของมัน (nextElementSibling) · onclick เดิมไม่เปลี่ยน', async ({ browser }) => {
    const app = await bootBare(browser);
    const read = () => app.page.evaluate(() => {
      const sib = (id) => { const n = document.getElementById(id).nextElementSibling; return n ? { cls: n.className, onclick: n.getAttribute('onclick'), badge: n.querySelector('span[id^="badge"]') && n.querySelector('span[id^="badge"]').id } : null; };
      return {
        pm: sib('fileProductMaster'), r01: sib('fileR01'), r05: sib('fileR05'), r16: sib('fileR16'),
        order: [...document.getElementById('uploadPanel').children].filter((e) => e.id !== 'dsPanel').map((e) => e.id || e.className),
      };
    });
    const before = await read();
    await setBranch(app.page, 'SRC');
    const after = await read();
    expect(after).toEqual(before);
    expect(after.r01).toMatchObject({ cls: 'upload-file-item', badge: 'badgeR01' });
    // แผงใหม่เป็นลูกตรงของ #uploadPanel (CSS ใช้ child combinator) และไม่คั่นระหว่าง input กับการ์ด
    const place = await app.page.evaluate(() => { const p = document.getElementById('dsPanel'); return { parent: p.parentElement.id, prev: p.previousElementSibling && p.previousElementSibling.id }; });
    expect(place).toEqual({ parent: 'uploadPanel', prev: 'guidePopover' });
    await closeApp(app);
  });

  test('สวิตช์ปิด = การ์ดเดิมครบทุกสาขา · เปิดกลับ = แผงกลับมา', async ({ browser }) => {
    const app = await bootBare(browser);
    await app.page.evaluate(() => { DATA_STATUS_PANEL = false; });
    for (const b of BRANCHES) {
      await setBranch(app.page, b);
      const s = await snap(app.page);
      expect(s.on).toBe(false);
      expect(s.exists).toBe(false);
      expect(s.legacy.header).toBe(true);
      expect(s.legacy.items.filter(Boolean).length, 'R01 + R16 เห็นเหมือนเดิม').toBe(2);
    }
    await app.page.evaluate(() => { DATA_STATUS_PANEL = true; });
    await setBranch(app.page, 'SRC');
    const s = await snap(app.page);
    expect(s.on).toBe(true);
    expect(shownIds(s)).toEqual(['r01', 'r16']);

    // ปิดสวิตช์กลางทางแล้วเรียกใหม่ = ถอนคลาสทันที
    await app.page.evaluate(() => { DATA_STATUS_PANEL = false; updateBranchDisplay(); });
    const off = await snap(app.page);
    expect(off.on).toBe(false);
    expect(off.visible).toBe(false);
    expect(off.legacy.header).toBe(true);
    await closeApp(app);
  });

  test('★ วาดพัง = ถอยไปใช้การ์ดเดิมเอง (ไม่เหลือจอว่าง · ไม่มี error หลุด)', async ({ browser }) => {
    // (ก) สร้างแผงไม่ได้
    const a = await bootBare(browser);
    const warns = [];
    a.page.on('console', (m) => { if (m.type() === 'warning') warns.push(m.text()); });
    await a.page.evaluate(() => { window._dsEnsure = () => { throw new Error('boom-build'); }; });
    await setBranch(a.page, 'SRC');
    let s = await snap(a.page);
    expect(s.on, 'ไม่ใส่ ds-on เมื่อวาดไม่สำเร็จ').toBe(false);
    expect(s.legacy.header).toBe(true);
    expect(s.legacy.items.filter(Boolean).length).toBe(2);
    expect(warns.some((w) => w.includes('[data-status]') && w.includes('boom-build'))).toBe(true);
    await closeApp(a);

    // (ข) แผงขึ้นแล้ว แต่ตัวสังเกตวาดรอบถัดไปพัง → ถอนคลาส ds-on (การ์ดเดิมกลับมา) แล้วหยุดวาด
    const b = await bootBare(browser);
    await setBranch(b.page, 'SRC');
    expect((await snap(b.page)).on).toBe(true);
    await b.page.evaluate(() => {
      window.__renders = 0;
      window._dsRender = () => { window.__renders++; throw new Error('boom-render'); };
      document.getElementById('badgeR01').textContent = 'Ready';
    });
    await settle(b.page);
    s = await snap(b.page);
    expect(s.on).toBe(false);
    expect(s.legacy.header).toBe(true);
    expect(await b.page.evaluate(() => window.__renders)).toBe(1);
    await b.page.evaluate(() => { document.getElementById('badgeR01').textContent = 'ยังไม่โหลด'; });
    await settle(b.page);
    expect(await b.page.evaluate(() => window.__renders), 'ถอยแล้วไม่วาดซ้ำ').toBe(1);
    await closeApp(b);
  });

  test('ปุ่ม Guide: Soft UI (นูนนุ่ม ไม่มีกรอบแบบเดิม) · เปิดคู่มือตัวเดิม', async ({ browser }) => {
    const app = await bootBare(browser);
    await setBranch(app.page, 'SRC');
    const g = await app.page.evaluate(() => {
      const s = getComputedStyle(document.getElementById('dsGuide'));
      const old = getComputedStyle(document.querySelector('.upload-help-btn'));
      return { bg: s.backgroundImage, shadow: s.boxShadow, border: s.borderTopWidth, color: s.color, w: s.width, h: s.height, oldBorder: old.borderTopWidth, oldShadow: old.boxShadow };
    });
    expect(g.bg).toContain('linear-gradient');
    expect(g.shadow).toContain('rgb(203, 211, 224)');    // เงามืดด้านขวาล่าง
    expect(g.shadow).toContain('rgb(255, 255, 255)');    // ไฮไลต์ด้านซ้ายบน
    expect(g.shadow).toMatch(/-3px -3px/);
    expect(g.border).toBe('0px');
    expect(g.color).toBe('rgb(214, 40, 40)');
    expect(g.w).toBe('44px');
    expect(g.oldBorder, 'ปุ่มเดิมมีกรอบ ไม่มีเงา — ต้องไม่ใช่สไตล์เดิม').toBe('1px');
    expect(g.oldShadow).toBe('none');

    const before = await app.page.evaluate(() => getComputedStyle(document.getElementById('guidePopover')).display);
    expect(before).toBe('none');
    await clearOverlays(app.page);
    await app.page.click('#dsGuide');
    const after = await app.page.evaluate(() => ({ d: getComputedStyle(document.getElementById('guidePopover')).display, len: document.getElementById('guideContent').textContent.length }));
    expect(after.d).toBe('block');
    expect(after.len, 'คู่มือถูกเติมโดย openGuideModal ตัวเดิม').toBeGreaterThan(100);
    await closeApp(app);
  });

  test('ไม่มีคำว่า "ล่าช้า" ในแผงทุกสถานะ · มีแค่ Ready / ยังไม่โหลด / ตรวจสอบวันที่', async ({ browser }) => {
    const app = await bootBare(browser);
    await setBranch(app.page, 'SRC');
    await setAdmin(app.page, true);
    const texts = [];
    const grab = async () => texts.push(await app.page.evaluate(() => document.getElementById('dsPanel').textContent));
    await grab();                                                                   // ว่างทั้งหมด
    await legacy(app.page, { r01: '08:10 น. 09/11/2026', pm: '07:05 น. 08/11/2026', r05: '06:35 น. 03/11/2026', r05chk: '08:00 น. 01/01/2020' });
    await settle(app.page); await grab();                                           // R05 ตรวจไม่ใช่วันนี้
    await legacy(app.page, { r16: '21:10 น. 08/11/2026', r16range: '08/11 08:02–08/11 20:58' });
    await settle(app.page); await grab();
    await legacy(app.page, { r16warn: true });
    await settle(app.page); await grab();
    for (const t of texts) expect(t).not.toMatch(/ล่าช้า|ช้า|delay|late/i);
    const labels = await app.page.evaluate(() => [...document.querySelectorAll('#dsPanel .ds-sl')].map((e) => e.textContent));
    expect(labels.every((l) => ['Ready', 'ยังไม่โหลด', 'ตรวจสอบวันที่'].includes(l))).toBe(true);
    await closeApp(app);
  });

  test('★ ข้อความจากการ์ดเดิมแสดงเป็นข้อความล้วน (ไม่ตีความ HTML)', async ({ browser }) => {
    const app = await bootBare(browser);
    await setBranch(app.page, 'SRC');
    await app.page.evaluate(() => {
      window.__x = 0;
      document.getElementById('badgeR01').textContent = '<img src=x onerror="window.__x=1">';
      const ts = document.getElementById('r16Timestamp');
      ts.textContent = '<b id="evil">อัปโหลด</b><img src=x onerror="window.__x=2"> · ข้อมูล <i>x</i>';
      ts.style.display = '';
    });
    await settle(app.page);
    const r = await app.page.evaluate(() => ({ x: window.__x, imgs: document.querySelectorAll('#dsPanel img, #dsPanel b, #dsPanel i:not(.ds-title i)').length, evil: !!document.getElementById('evil'), r01: document.querySelector('#dsPanel li[data-ds="r01"] .ds-sl').textContent }));
    expect(r.x).toBe(0);
    expect(r.evil).toBe(false);
    expect(r.imgs).toBe(0);
    expect(r.r01).toBe('<img src=x onerror="window.__x=1">');
    await closeApp(app);
  });

  test('เขียนการ์ดเดิมรัวๆ = วาดแผงรวมเป็นรอบเดียว · ผลสุดท้ายถูก · สาขา WH ไม่วาดเลย', async ({ browser }) => {
    const app = await bootBare(browser);
    await setBranch(app.page, 'SRC');
    const n = await app.page.evaluate(async () => {
      let renders = 0;
      const real = _dsRender;
      window._dsRender = function () { renders++; return real.apply(this, arguments); };
      for (let i = 0; i < 200; i++) { document.getElementById('badgeR01').textContent = i % 2 ? 'Ready' : 'ยังไม่โหลด'; _setR01Ts('0' + (i % 10) + ':00 น. 09/11/2026'); }
      document.getElementById('badgeR01').textContent = 'Ready';
      await new Promise((r) => setTimeout(r, 40));
      const afterBurst = renders;
      // WH: ตัวสังเกตยังฟังอยู่ แต่ต้องไม่วาด
      currentBranch = 'WH'; updateBranchDisplay();
      const rendersAtWh = renders;
      document.getElementById('badgeR01').textContent = 'ยังไม่โหลด';
      await new Promise((r) => setTimeout(r, 40));
      const afterWh = renders;
      window._dsRender = real;
      return { afterBurst, rendersAtWh, afterWh };
    });
    expect(n.afterBurst, 'รวมเป็นรอบเดียวต่อ task').toBeLessThanOrEqual(2);
    expect(n.afterBurst).toBeGreaterThanOrEqual(1);
    expect(n.afterWh, 'WH ไม่วาดแผงเลย').toBe(n.rendersAtWh);
    await closeApp(app);
  });

  test('เลย์เอาต์: ข้อความยาวผิดปกติจากการ์ดเดิม (ไม่มีช่องว่างให้ตัดบรรทัด) ต้องไม่ดันกรอบการ์ดให้ล้น', async ({ browser }) => {
    const app = await bootBare(browser);
    await setBranch(app.page, 'SRC');
    await setAdmin(app.page, true);
    await app.page.evaluate(() => {
      const long = (c, n) => c.repeat(n);
      document.getElementById('badgeR01').textContent = long('y', 60);                                         // label ของสถานะ
      document.getElementById('badgeR05').textContent = 'Ready';
      for (const [id, t] of [['r01Timestamp', 'อัปโหลดล่าสุด: ' + long('x', 90)], ['r16Timestamp', long('x', 90) + ' · ข้อมูล ' + long('z', 90)], ['pmTimestamp', long('p', 90)]]) {
        const e = document.getElementById(id); e.textContent = t; e.style.display = '';
      }
    });
    await settle(app.page);
    const o = await app.page.evaluate(() => {
      const card = document.getElementById('uploadPanel').getBoundingClientRect();
      const bad = []; let checked = 0;
      document.querySelectorAll('#dsPanel *').forEach((e) => {
        if (e.closest('svg') && e.tagName.toLowerCase() !== 'svg') return;
        const r = e.getBoundingClientRect();
        if (!r.width || !r.height) return;
        checked++;
        if (r.right > card.right + 0.6 || r.left < card.left - 0.6) bad.push(e.className + ' +' + Math.round(r.right - card.right));
        // ตัวอักษรที่ล้นออกนอกกล่องของ element เอง (กล่องยังอยู่ในการ์ดแต่ข้อความทะลุ) — ต้องตัดบรรทัดแทน
        if (e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).display !== 'inline') bad.push('text-overflow ' + e.className);
      });
      return { bad, checked, page: document.documentElement.scrollWidth <= innerWidth };
    });
    expect(o.checked).toBeGreaterThan(30);
    expect(o.bad, 'ข้อความยาวต้องตัดบรรทัดภายในการ์ด').toEqual([]);
    expect(o.page).toBe(true);
    await closeApp(app);
  });

  test('เลย์เอาต์: ข้อมูลยาวสุด (Admin ครบ 4 แถว · เตือนครบ) ไม่ล้นกรอบการ์ด', async ({ browser }) => {
    const app = await bootBare(browser);
    await setBranch(app.page, 'SRC');
    await setAdmin(app.page, true);
    await legacy(app.page, { r01: '08:10 น. 09/11/2026', pm: '07:05 น. 08/11/2026', r05: '06:35 น. 03/11/2026', r05chk: '08:00 น. 01/01/2020', r16: '21:10 น. 08/11/2026', r16range: '08/11 08:02–08/11 20:58' });
    await legacy(app.page, { r16warn: true });
    await settle(app.page);
    const o = await app.page.evaluate(() => {
      const card = document.getElementById('uploadPanel').getBoundingClientRect();
      const bad = [];
      let checked = 0;
      document.querySelectorAll('#dsPanel *').forEach((e) => {
        if (e.closest('svg') && e.tagName.toLowerCase() !== 'svg') return;
        const r = e.getBoundingClientRect();
        if (!r.width || !r.height) return;
        checked++;
        if (r.right > card.right + 0.6 || r.left < card.left - 0.6) bad.push(e.className + ' ' + Math.round(r.right - card.right));
        if (e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).display !== 'inline') bad.push('scroll ' + e.className);
      });
      return { bad, checked, page: document.documentElement.scrollWidth <= innerWidth, w: Math.round(card.width) };
    });
    expect(o.checked, 'ตรวจ element จริงของแผง (กันผ่านเปล่าเมื่อไม่มีแผง)').toBeGreaterThan(40);
    expect(o.bad).toEqual([]);
    expect(o.page).toBe(true);
    await closeApp(app);
  });
});
