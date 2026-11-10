// ปุ่ม Guide + คู่มือของแผง DATA STATUS (สาขายา SRC/KKL/SSS) — "เวอร์ชันใหม่" (10 พ.ย. 2026 · ผู้ใช้สั่ง "อัปเดทปุ่ม Guide และคู่มือให้เป็นเวอร์ชั่นใหม่ แล้ว merge เข้า main")
//
// เหตุผล: แผง DATA STATUS (คอมมิต feat(data-status):) ทำให้พนักงานสาขายาอัป R01/R16 เองไม่ได้ — บอทอัปให้ — แต่ปุ่ม Guide ยังสอน "อัพโหลด R01/R16" อยู่
// กติกาที่เทสนี้ตรึง:
//   1. สาขายา (DATA_STATUS_PANEL เปิด): ปุ่ม Guide ของแผงเปิดคู่มือใหม่ (หัว "คู่มือ DATA STATUS") · ไม่สั่งให้พนักงานอัปไฟล์ · อธิบายสถานะตรงกับที่แผงแสดงจริง · ทางสำรอง = Admin Mode
//   2. ★ WH ไม่แตะ — ข้อความเท่ากับก่อนแก้ทุกตัวอักษร (sha256) ไม่ว่าสวิตช์จะเปิดหรือปิด
//   3. ★ ปิดสวิตช์ DATA_STATUS_PANEL / ยังไม่เลือกสาขา = ข้อความเดิมทุกตัวอักษร (sha256 ของ guideHtml จากคอมมิตก่อนแก้ 037bc5e) — ทางถอยที่ผู้ใช้พึ่ง
//   4. Scan Guide (ปุ่ม Guide ที่การ์ด SCAN) ข้อ 2/4 ไม่สั่งอัปโหลดบนสาขายา · สลับสาขาแล้วข้อความไม่ค้าง
//   5. tooltip ปุ่ม "อัปโหลดด้วยมือ" ต้องไม่อ้างว่า "ไม่ขึ้น Cloud" (ไม่จริง: R01/R05/Product Master ขึ้น Cloud ตามปกติ — e2e data-status-panel ตรวจแล้ว)
//
// ⚠️ ค่า GOLD ด้านล่างคือ sha256 ของ guideHtml ฉบับ "ก่อนแก้" — ถ้าตั้งใจแก้ข้อความเดิมของ guideHtml (ฝั่ง WH หรือฝั่งปิดสวิตช์) ให้คำนวณใหม่:
//   อ่านผลของ guideHtml(isWh) ในหน้าที่ตั้งสาขา/สวิตช์ตามคอมโบนั้น แล้ว sha256 (utf8) — ห้ามแก้ค่าเพื่อให้เทสผ่านโดยไม่ได้ตั้งใจเปลี่ยนข้อความ
const { test, expect, bootBare, closeApp } = require('../../lib/hooks');
const crypto = require('crypto');

const sha = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');

const GOLD = {
  SRC: '4711d212af163d6f0dd6c2b094da6c573fd7d912251d63e8bf0c6af894ea56eb',            // สาขายา ค่าเริ่มต้นอื่นทั้งหมด
  SRC_BOT: '78d28c50fc66dbb984bab97929aa864696c7331664115961e8093dbf124712be',        // PHARMACY_DESKTOP_CONFIRM_BY_BOT = true
  SRC_KEEP_OFF: 'b5ad6149770fb68d7b62fc370d65657440ddf96f226f06c208d0c635a91b0429',   // PHARMACY_KEEP_R01_ON_NEW_COUNT = false
  SRC_RESCAN_OFF: '1121112493a3db2b72a317688112d6f7f340ef2a231705517096cb84c847eceb', // PHARMACY_RESCAN_TO_PENDING = false
  SRC_TERMS_OFF: '13370e7d9342c5dceb6ee7bf84f03de2ab90af33317192acfe4a38edc54a4876',  // PHARMACY_RECHECK_TERMS = false
  NO_BRANCH: '13370e7d9342c5dceb6ee7bf84f03de2ab90af33317192acfe4a38edc54a4876',      // ยังไม่เลือกสาขา (= คำศัพท์ Audit เดิม จึงเท่ากับ SRC_TERMS_OFF)
  WH: 'f9659e2e9dbb42436d1d1f1e0268e1932e9c5738c68c185c7829cdf79103005a',             // WH ค่าเริ่มต้นทั้งหมด
};

// ข้อความ Scan Guide ข้อ 2/4 เดิม (ต้องคืนค่านี้เมื่อปิดสวิตช์/WH — ค่าตั้งต้นใน HTML ของ #guideStep2)
const OLD2 = 'อัพโหลด R01.102 ตอนเริ่มรอบนับ (แนะนำหลัง 21:00 · อัพได้ทุกเวลา)';
const OLD4 = 'อัพโหลด R16.104 ก่อนกด Confirm (ยอดขาย/รับเข้าระหว่างนับ)';
const OLD4_BOT = 'R16.104 — บอทอัปให้อัตโนมัติทุกคืน 21:10 (อัพมือที่การ์ด R16.104 เฉพาะเมื่อบอทพลาด)';
const NEW2 = 'R01.102 — บอทอัปให้ทุกเช้า ไม่ต้องอัปเอง (Desktop ดูสถานะที่แผง DATA STATUS)';
const NEW4 = 'R16.104 — บอทอัปให้อัตโนมัติทุกคืน ~21:10 (ยอดขาย/รับเข้าระหว่างนับ) · ปุ่ม Confirm ปลดล็อกเองเมื่อ R16 พร้อม';
const NEW4_BOT = 'R16.104 — บอทอัปให้อัตโนมัติทุกคืน 21:10 (ยอดขาย/รับเข้าระหว่างนับ)';

const TITLE_NEW = '📌 คู่มือ DATA STATUS';
const TITLE_OLD = '📌 คู่มือการเตรียมไฟล์';

// หน้าบูตเปล่า (ยังไม่ล็อกอิน) → ตั้งสวิตช์/สาขาแล้วให้ UI ตัดสินผ่านเส้นทางจริง (updateBranchDisplay = hook ของแผง · applyAuditTerminology = ตั้งข้อความ Scan Guide ตอน login)
const setup = (page, o) => page.evaluate((o) => {
  DATA_STATUS_PANEL = o.ds !== false;
  PHARMACY_DESKTOP_CONFIRM_BY_BOT = !!o.bot;
  PHARMACY_KEEP_R01_ON_NEW_COUNT = o.keep !== false;
  PHARMACY_RESCAN_TO_PENDING = o.rescan !== false;
  PHARMACY_RECHECK_TERMS = o.terms !== false;
  currentBranch = o.branch;
  updateBranchDisplay();
  applyAuditTerminology();
}, o);

// หน้าแอปยังไม่ล็อกอิน = หน้าเลือกสาขา/PIN ทับจออยู่ — ซ่อนก่อนคลิกจริง (ผู้ใช้จริงคลิกหลังล็อกอิน โมดัลเหล่านี้ปิดแล้ว)
const clearOverlays = (page) => page.evaluate(() => { for (const id of ['branchModal', 'pinModal', 'employeeModal', 'bootCover']) { const e = document.getElementById(id); if (e) e.style.display = 'none'; } });

// ⚠️ ป็อปอัพมีแอนิเมชันเปิด 0.2 วิ (`popIn` ตัวที่สองในไฟล์ = scale 0.4→1.06→1 — ไปทับตัวแรกของ .upload-guide-popover) ⇒ getBoundingClientRect กลางแอนิเมชันได้ขนาดคูณ 0.4–1.06
//    เคยวัดความสูงตอนเฟรมแรกแล้วเทียบกัน → ผ่านบ้างล้มบ้างตามจังหวะ (พบ 10 พ.ย. 2026) · จึงรอแอนิเมชันจบก่อนวัดตำแหน่ง และใช้ offsetHeight (ขนาดเลย์เอาต์ ไม่โดน transform) เป็นความสูง
const readGuide = (page) => page.evaluate(async () => {
  const p = document.getElementById('guidePopover');
  await Promise.all(p.getAnimations().map((a) => a.finished.catch(() => null)));
  const r = p.getBoundingClientRect();
  return {
    display: getComputedStyle(p).display,
    title: document.getElementById('guideTitle').textContent,
    text: document.getElementById('guideContent').textContent.replace(/\s+/g, ' ').trim(),
    left: Math.round(r.left), right: Math.round(r.right), height: p.offsetHeight, width: p.offsetWidth, vw: innerWidth,
  };
});
// เปิดด้วยฟังก์ชันของปุ่ม (ไม่ผ่านการคลิก) — ใช้ในเทสที่ไม่ได้ตรวจการคลิก
const openGuide = (page) => page.evaluate(() => { openGuideModal(); return null; }).then(() => readGuide(page));

const stepTexts = (page) => page.evaluate(() => ({
  s2: document.getElementById('guideStep2').textContent,
  s4: document.getElementById('guideStep4').textContent,
  s5: document.getElementById('guideStep5').textContent,
  s6: document.getElementById('guideStep6').innerHTML,
}));

// ข้อความที่คู่มือใหม่ต้องมี (textContent — ไม่รวม tag)
const NEW_FRAGS = [
  'บอทอัปให้ทุกเช้า ไม่ต้องอัปเอง',
  'รอให้แผงขึ้น Ready ก่อนเริ่มสแกน',
  'บอทอัปให้อัตโนมัติทุกคืน',
  'อ่านสถานะที่แผง DATA STATUS',
  'แสดงสถานะอย่างเดียว ไม่มีปุ่มอัปโหลด',
  'ยังไม่โหลด',
  'ตรวจสอบวันที่',
  'Admin Mode — ทางสำรองเมื่อบอทพลาด',
  'พนักงานทั่วไปอัปไฟล์เองไม่ได้',
  'อัปโหลดด้วยมือ',
  'R05.106',
  'Product Master',
  'Admin Mode หยุดซิงก์การสแกนกับระบบกลาง',              // กันคนไปสแกนระหว่างอยู่ใน Admin Mode (ยอดสแกนจะไม่ขึ้นระบบกลาง)
  'ใช้อัปไฟล์เท่านั้น ไม่ใช้สแกน',
  'R16.104 — ใช้ชดเชยตอน Confirm',                       // กล่องอ้างอิงกติกาบวกกลับ/หักออก (ย้ายมาจากฉบับเดิม — ห้ามหายไปกับการปรับคู่มือ)
  'ORCM/OCTM (ยอดขาย)',
  'ข้อมูลที่บอทอัป (R01/R16) ขึ้นระบบกลางแล้วทุกเครื่องในสาขาได้รับเอง',
];
// ข้อความเดิมที่สอนให้พนักงานอัปไฟล์เอง — ต้องไม่เหลือในคู่มือใหม่
const OLD_GONE = [
  'อัพทุกเช้าก่อนเริ่มนับ',
  'ทุกวันก่อน Confirm (หลัง restock)',
  'ก่อนกด Confirm → อัพโหลด',
  'อัพ R16 ก่อนกด Confirm',
  'อัพใหม่ทุกครั้งก่อน Confirm',
  'เครื่องแรกอัพโหลดไฟล์',
  'หลังอัพ R01 → สแกนนับ',
  'อัพมือเฉพาะเมื่อบอทพลาด',
];

test('ค่าที่ส่งมอบ: สวิตช์เปิด · หัวป็อปอัพเดิมมี id ให้ตั้งชื่อ · id ของ Scan Guide ข้อ 2 มีอยู่', async ({ browser }) => {
  const app = await bootBare(browser);
  const r = await app.page.evaluate(() => ({
    sw: DATA_STATUS_PANEL,
    title: document.getElementById('guideTitle') && document.getElementById('guideTitle').textContent,
    step2: document.getElementById('guideStep2') && document.getElementById('guideStep2').textContent,
    guideFn: [typeof guideHtml, typeof _guideHtmlDataStatus, typeof openGuideModal],
  }));
  expect(r.sw).toBe(true);
  expect(r.title).toBe(TITLE_OLD);                       // HTML ตั้งต้น = ชื่อเดิม (WH/ปิดสวิตช์เห็นอันนี้)
  expect(r.step2).toBe(OLD2);                            // ค่าตั้งต้นของข้อ 2 = ข้อความเดิมเป๊ะ (ฟังก์ชันตั้งกลับด้วยสตริงเดียวกัน)
  expect(r.guideFn).toEqual(['function', 'function', 'function']);
  await closeApp(app);
});

test('★ ปุ่ม Guide ของแผง DATA STATUS เปิดคู่มือใหม่ (คลิกจริง) ทั้ง SRC/KKL/SSS — หัวป็อปอัพ + เนื้อหา + ไม่สอนให้พนักงานอัปไฟล์ + ไม่มีคำว่าล่าช้า/Audit', async ({ browser }) => {
  const app = await bootBare(browser);
  await clearOverlays(app.page);
  for (const b of ['SRC', 'KKL', 'SSS']) {
    await setup(app.page, { branch: b });
    expect(await app.page.evaluate(() => document.getElementById('uploadPanel').classList.contains('ds-on')), `${b}: แผงขึ้น`).toBe(true);
    await app.page.evaluate(() => closeGuideModal());
    await app.page.click('#dsGuide');                                      // ปุ่ม Soft UI บนแผง = ปุ่มที่ผู้ใช้กดจริง
    const g = await readGuide(app.page);
    expect(g.display, `${b}: ป็อปอัพเปิด`).toBe('block');
    expect(g.title, `${b}: หัวป็อปอัพ`).toBe(TITLE_NEW);
    for (const f of NEW_FRAGS) expect(g.text, `${b}: ต้องมี "${f}"`).toContain(f);
    for (const f of OLD_GONE) expect(g.text, `${b}: ต้องไม่มี "${f}"`).not.toContain(f);
    expect(g.text, `${b}: ห้ามมีสถานะล่าช้า (ผู้ใช้สั่ง)`).not.toMatch(/ล่าช้า/);
    expect(g.text, `${b}: สาขายาไม่มีคำว่า Audit`).not.toMatch(/audit/i);
    // ขั้นตอน export .CSV เป็นเรื่องของ Admin เท่านั้น — ต้องไม่โผล่ก่อนกล่อง Admin (ที่พนักงานทั่วไปอ่าน)
    const [staffPart, adminPart] = g.text.split('🔒 Admin Mode');
    expect(staffPart, `${b}: ส่วนของพนักงานไม่มีขั้นตอนส่งออกไฟล์`).not.toContain('.CSV');
    expect(adminPart, `${b}: กล่อง Admin มีขั้นตอนส่งออกไฟล์ (ทางสำรอง)`).toContain('.CSV');
    expect(g.right, `${b}: ป็อปอัพไม่ล้นขอบขวาของจอ`).toBeLessThanOrEqual(g.vw);
  }
  await closeApp(app);
});

test('★ สถานะที่คู่มืออธิบายต้องตรงกับป้ายที่แผงแสดงจริง (Ready / ยังไม่โหลด / ตรวจสอบวันที่) — เปลี่ยนป้ายในแผงแล้วคู่มือไม่ตามต้องล้ม', async ({ browser }) => {
  const app = await bootBare(browser);
  await setup(app.page, { branch: 'SRC' });
  // ขับสถานะผ่านการ์ดเดิมแบบที่โค้ดเดิมทำ แล้วอ่านป้ายที่แผงวาดจริง
  const labels = await app.page.evaluate(async () => {
    const wait = () => new Promise((r) => setTimeout(r, 40));
    const out = new Set();
    const read = () => document.querySelectorAll('#dsPanel li[data-ds] .ds-sl').forEach((e) => { if (e.closest('li').dataset.ds === 'r01' || e.closest('li').dataset.ds === 'r16') out.add(e.textContent); });
    const b = (id) => document.getElementById(id);
    b('badgeR01').textContent = 'Ready'; b('badgeR16').textContent = 'ยังไม่โหลด'; await wait(); read();
    b('badgeR16').textContent = 'Ready'; await wait(); read();
    b('badgeR16').textContent = '⚠️ ตรวจสอบวันที่'; b('badgeR16').parentElement.classList.add('upload-file-badge-warn'); await wait(); read();
    return [...out];
  });
  expect(labels.sort()).toEqual(['Ready', 'ตรวจสอบวันที่', 'ยังไม่โหลด']);   // ชุดป้ายทั้งหมดที่แผงแสดงให้พนักงาน
  const g = await openGuide(app.page);
  for (const l of labels) expect(g.text, `คู่มือต้องอธิบายป้าย "${l}"`).toContain(l);
  await closeApp(app);
});

test('★ WH ไม่แตะ: ข้อความคู่มือเท่าก่อนแก้ทุกตัวอักษร (sha256) ทั้งเปิด/ปิดสวิตช์ · หัวเดิม · ไม่มีคำว่า DATA STATUS · Scan Guide ข้อ 2/4 เดิม', async ({ browser }) => {
  const app = await bootBare(browser);
  for (const ds of [true, false]) {
    await setup(app.page, { branch: 'WH', ds });
    const html = await app.page.evaluate(() => guideHtml(true));
    expect(sha(html), `WH ds=${ds}: guideHtml(true) เท่าก่อนแก้`).toBe(GOLD.WH);
    const g = await openGuide(app.page);
    expect(g.title).toBe(TITLE_OLD);
    expect(g.text).not.toContain('DATA STATUS');
    expect(g.text).toContain('R16.103');
    const st = await stepTexts(app.page);
    expect([st.s2, st.s4]).toEqual([OLD2, OLD4]);
  }
  // สลับ SRC → WH → SRC: หัว/ข้อความต้องตามสาขาปัจจุบัน ไม่ค้างของเดิม
  await setup(app.page, { branch: 'SRC' });
  expect((await openGuide(app.page)).title).toBe(TITLE_NEW);
  expect((await stepTexts(app.page)).s2).toBe(NEW2);
  await setup(app.page, { branch: 'WH' });
  expect((await openGuide(app.page)).title).toBe(TITLE_OLD);
  expect(await stepTexts(app.page)).toMatchObject({ s2: OLD2, s4: OLD4 });
  await setup(app.page, { branch: 'KKL' });
  expect((await openGuide(app.page)).title).toBe(TITLE_NEW);
  expect((await stepTexts(app.page)).s2).toBe(NEW2);
  await closeApp(app);
});

test('★ ปิดสวิตช์ DATA_STATUS_PANEL / ยังไม่เลือกสาขา = ข้อความเดิมทุกตัวอักษร (sha256 ของ guideHtml ก่อนแก้) · หัวเดิม · ทุกคอมโบของสวิตช์อื่น', async ({ browser }) => {
  const app = await bootBare(browser);
  const combos = [
    ['SRC', { branch: 'SRC' }, GOLD.SRC],
    ['SRC_BOT', { branch: 'SRC', bot: true }, GOLD.SRC_BOT],
    ['SRC_KEEP_OFF', { branch: 'SRC', keep: false }, GOLD.SRC_KEEP_OFF],
    ['SRC_RESCAN_OFF', { branch: 'SRC', rescan: false }, GOLD.SRC_RESCAN_OFF],
    ['SRC_TERMS_OFF', { branch: 'SRC', terms: false }, GOLD.SRC_TERMS_OFF],
  ];
  for (const [name, o, gold] of combos) {
    for (const b of ['SRC', 'KKL', 'SSS']) {                                // ทั้ง 3 สาขาให้ข้อความเดียวกัน (guideHtml ไม่ผูกชื่อสาขา)
      await setup(app.page, { ...o, branch: b, ds: false });
      const html = await app.page.evaluate(() => guideHtml(false));
      expect(sha(html), `${name}/${b} ปิดสวิตช์ = เดิม`).toBe(gold);
    }
    await setup(app.page, { ...o, ds: false });
    expect((await openGuide(app.page)).title, `${name}: หัวเดิม`).toBe(TITLE_OLD);
  }
  // ยังไม่เลือกสาขา (ก่อนล็อกอิน) — แผงยังไม่ขึ้น คู่มือต้องเป็นของเดิมแม้สวิตช์เปิด
  await setup(app.page, { branch: '', ds: true });
  expect(sha(await app.page.evaluate(() => guideHtml(false))), 'ไม่มีสาขา').toBe(GOLD.NO_BRANCH);
  expect((await openGuide(app.page)).title).toBe(TITLE_OLD);
  // ปิดสวิตช์แล้ว Scan Guide ข้อ 2/4 ต้องเป็นของเดิม (รวมกรณีบอท Confirm)
  await setup(app.page, { branch: 'SRC', ds: false });
  expect(await stepTexts(app.page)).toMatchObject({ s2: OLD2, s4: OLD4 });
  await setup(app.page, { branch: 'SRC', ds: false, bot: true });
  expect(await stepTexts(app.page)).toMatchObject({ s2: OLD2, s4: OLD4_BOT });
  // เปิดกลับ = ใหม่อีกครั้ง (สลับไปมาได้ ไม่มีสถานะค้าง)
  await setup(app.page, { branch: 'SRC', ds: true });
  expect((await openGuide(app.page)).title).toBe(TITLE_NEW);
  await closeApp(app);
});

test('★ บอท Confirm ให้ (PHARMACY_DESKTOP_CONFIRM_BY_BOT): เปิด = ไม่เหลือคำสั่ง "กด Confirm" · ปิด = พนักงานกด Confirm เองหลัง R16 Ready', async ({ browser }) => {
  const app = await bootBare(browser);
  await setup(app.page, { branch: 'SRC', bot: false });
  const off = await app.page.evaluate(() => guideHtml(false));
  expect(off).toContain('<li>R16 เป็น <strong>Ready</strong> แล้ว → กด <strong>Confirm</strong> → ระบบตรวจสอบสินค้า</li>');
  expect(off).toContain('~21:10 (Desktop โหลดเอง ไม่ต้อง F5)');
  expect(off).not.toContain('บอท Confirm ให้');

  await setup(app.page, { branch: 'KKL', bot: true });
  const on = await app.page.evaluate(() => guideHtml(false));
  expect(on).toContain('<li><strong>บอท Confirm ให้ 21:10</strong> → ระบบตรวจสอบสินค้า</li>');
  expect(on).not.toContain('กด <strong>Confirm</strong>');                  // ปุ่มถูกซ่อนแล้ว — ห้ามสั่งให้กด
  expect(on).not.toContain('Desktop โหลดเอง');
  expect(on).toContain('บอทอัปให้อัตโนมัติทุกคืน 21:10</li>');
  await closeApp(app);
});

test('เริ่มนับใหม่ (PHARMACY_KEEP_R01_ON_NEW_COUNT): เปิด = บอกว่าไม่ล้าง R01 · ปิด = เตือนว่าจะล้างและพนักงานอัปเองไม่ได้ ต้องให้ Admin', async ({ browser }) => {
  const app = await bootBare(browser);
  await setup(app.page, { branch: 'SRC', keep: true });
  const on = await app.page.evaluate(() => guideHtml(false));
  expect(on).toContain('(กด "เริ่มนับใหม่" ไม่ล้าง R01)');
  expect(on).not.toContain('จะล้าง R01 ของสาขา');

  await setup(app.page, { branch: 'SRC', keep: false });
  const off = await app.page.evaluate(() => guideHtml(false));
  expect(off).not.toContain('ไม่ล้าง R01');
  expect(off).toContain('⚠️ กด "เริ่มนับใหม่" จะล้าง R01 ของสาขา — ให้ Admin อัป R01 ใหม่ก่อนสแกน (พนักงานทั่วไปอัปเองไม่ได้)');
  await closeApp(app);
});

test('คำศัพท์สาขายา (PHARMACY_RECHECK_TERMS) + ทาง ↺ (PHARMACY_RESCAN_TO_PENDING): ข้อความขั้นสุดท้ายเท่าฉบับเดิมทุกตัวอักษร · ไม่มีคำว่า Audit เมื่อเปิดคำใหม่', async ({ browser }) => {
  const app = await bootBare(browser);
  // ขั้นสุดท้ายของขั้นตอน = นิพจน์เดียวกับฉบับเดิม (สเปก pharmacy-stockadj-rescan ตรึงข้อความนี้จากฉบับเดิมด้วย)
  await setup(app.page, { branch: 'SRC' });
  let h = await app.page.evaluate(() => guideHtml(false));
  expect(h).toContain('<li>ไม่ตรง → Stock Adj ทันที → เภสัชออกใบที่ 📦 ปรับปรุงสินค้า (สงสัยรายการไหน กด ↺ สแกนใหม่ แล้วให้ผู้ช่วยนับใหม่)</li>');
  expect(h).toContain('รายการ <strong>รอรีเช็ค ที่เภสัชยังไม่ยืนยัน</strong> ให้เภสัชสแกนรีเช็ค');
  expect(h).not.toMatch(/audit/i);

  await setup(app.page, { branch: 'SRC', rescan: false });
  h = await app.page.evaluate(() => guideHtml(false));
  expect(h).toContain('กด ↺ สแกนใหม่ แล้วรีเช็ค)</li>');
  expect(h).not.toContain('แล้วให้ผู้ช่วยนับใหม่');

  // ปิดสวิตช์คำ = คำเดิม (Audit) ตามที่ระบบทั้งแอปทำ — คู่มือใหม่ต้องตามด้วย ไม่ใช่ฮาร์ดโค้ดคำใหม่
  await setup(app.page, { branch: 'SRC', terms: false });
  h = await app.page.evaluate(() => guideHtml(false));
  expect(h).toContain('<li>Audit (ไม่ตรง) → เภสัช Login PDA สแกนสินค้ารีเช็ค</li>');
  expect(h).toContain('รายการ <strong>Audit ที่เภสัชยังไม่ยืนยัน</strong> ให้เภสัชสแกนรีเช็ค');
  expect(h).toContain('DATA STATUS');                                        // ยังเป็นคู่มือใหม่ (คุมด้วยสวิตช์แผง ไม่ใช่สวิตช์คำ)
  await closeApp(app);
});

test('★ Scan Guide (ปุ่ม Guide ที่การ์ด SCAN): สาขายา ข้อ 2/4 ไม่สั่งอัปโหลด · บอท Confirm/ไม่ · ข้ออื่นเท่าเดิม · ปิดสวิตช์/WH = เดิมทุกตัวอักษร', async ({ browser }) => {
  const app = await bootBare(browser);
  const keys = ['s5', 's6'];
  // ข้อที่ไม่เกี่ยวกับการอัปโหลด (5 · 6) ต้องเท่ากันทั้งเปิด/ปิดสวิตช์ — กันแก้พลาดไปโดนข้อความอื่น
  for (const bot of [false, true]) {
    await setup(app.page, { branch: 'SRC', bot, ds: true });
    const on = await stepTexts(app.page);
    await setup(app.page, { branch: 'SRC', bot, ds: false });
    const off = await stepTexts(app.page);
    expect(on.s2).toBe(NEW2);
    expect(on.s4).toBe(bot ? NEW4_BOT : NEW4);
    expect(off.s2).toBe(OLD2);
    expect(off.s4).toBe(bot ? OLD4_BOT : OLD4);
    for (const k of keys) expect(on[k], `bot=${bot} ${k} ไม่เปลี่ยน`).toBe(off[k]);
    // ข้อความใหม่ห้ามสั่งอัปโหลด / ห้ามอ้างการ์ดที่ไม่มีแล้ว
    expect(on.s2 + on.s4).not.toMatch(/อัพโหลด|การ์ด R16/);
  }
  // ทุกสาขายา ได้ข้อความเดียวกัน
  for (const b of ['KKL', 'SSS']) {
    await setup(app.page, { branch: b });
    expect(await stepTexts(app.page)).toMatchObject({ s2: NEW2, s4: NEW4 });
  }
  // WH เท่าเดิมแม้เปิดสวิตช์ · ยังไม่เลือกสาขา = เดิม
  await setup(app.page, { branch: 'WH' });
  expect(await stepTexts(app.page)).toMatchObject({ s2: OLD2, s4: OLD4 });
  await setup(app.page, { branch: '' });
  expect(await stepTexts(app.page)).toMatchObject({ s2: OLD2, s4: OLD4 });
  await closeApp(app);
});

test('tooltip ปุ่ม "อัปโหลดด้วยมือ" (Admin Mode) ต้องไม่อ้างว่า "ไม่ขึ้น Cloud" — R01/R05/Product Master ที่อัปมือขึ้น Cloud ตามปกติ', async ({ browser }) => {
  const app = await bootBare(browser);
  await setup(app.page, { branch: 'SRC' });
  await app.page.evaluate(() => { _adminMode = true; applyAdminUI(); });
  const titles = await app.page.evaluate(() => [...document.querySelectorAll('#dsPanel .ds-up')].map((b) => b.title));
  expect(titles).toHaveLength(4);                                            // PM · R01 · R05 · R16
  for (const t of titles) {
    expect(t).toContain('Admin Mode');
    expect(t).toContain('ทางสำรองเมื่อบอทพลาด');
    expect(t).not.toMatch(/ไม่ขึ้น\s*Cloud/);
    expect(t).not.toContain('เก็บในเครื่องนี้');
  }
  await closeApp(app);
});

test('เลย์เอาต์ป็อปอัพ: ไม่ล้นขอบจอ (1440 · 1100 · 700px) · ไม่สูงกว่าฉบับเดิมเกิน 40% (วัดเทียบในหน้าเดียวกัน — ไม่ผูกกับฟอนต์ของเครื่อง)', async ({ browser }) => {
  const app = await bootBare(browser);
  await clearOverlays(app.page);
  for (const w of [1440, 1100, 700]) {
    await app.page.setViewportSize({ width: w, height: 1000 });
    await setup(app.page, { branch: 'SRC', ds: false });
    await app.page.evaluate(() => closeGuideModal());
    const old = await openGuide(app.page);
    await setup(app.page, { branch: 'SRC', ds: true });
    await app.page.evaluate(() => closeGuideModal());
    await app.page.click('#dsGuide');
    const now = await readGuide(app.page);
    expect(now.title).toBe(TITLE_NEW);
    expect(Math.abs((now.right - now.left) - now.width), `${w}px: ต้องวัดหลังแอนิเมชันเปิดจบ (กล่องที่วัดได้ต้องเท่าขนาดเลย์เอาต์ ${now.width}px)`).toBeLessThanOrEqual(1);
    expect(now.left, `${w}px: ไม่ล้นขอบซ้าย`).toBeGreaterThanOrEqual(0);
    expect(now.right, `${w}px: ไม่ล้นขอบขวา (เดิมอยู่ที่ ${old.right})`).toBeLessThanOrEqual(Math.max(now.vw, old.right));
    expect(now.height, `${w}px: สูง ${now.height} เทียบเดิม ${old.height}`).toBeLessThanOrEqual(old.height * 1.4);
    expect(now.height).toBeGreaterThan(300);                                  // กันวัดได้ 0 (ป็อปอัพไม่ขึ้น) แล้วผ่านเปล่า
  }
  await closeApp(app);
});
