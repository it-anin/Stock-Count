// พื้นหลังขาวตั้งแต่หน้าเลือกสาขา → หน้าใส่ PIN (ผู้ใช้สั่ง 15 ต.ค. 2026)
//
// เดิมสองหน้านี้เป็นฉากหลังสีเข้มโปร่ง (rgba(10,20,40,.65/.75)) ทับหน้าแอปที่ยังว่าง → เห็น header/การ์ด/ตารางเปล่าลางๆ ดูเหมือนโหลดไม่เสร็จ
// ใหม่: #branchModal + #pinModal ฉากหลังขาวทึบ (#fff) · animation:none บนฉากหลัง (กันหน้าแอปแว้บระหว่างสองหน้า) · การ์ดเงานุ่ม + ขอบบาง
// HTML/CSS inline ล้วน — ไม่แตะ JS เส้นทางสแกน/schema/rules · เทสนี้ตรึง:
//   1. ★ ค่าที่ส่งมอบ: ขาวทึบ · ไม่เฟดเข้า · ลำดับ z-index เดิม · การ์ดมีขอบ ไม่มีเงาดำหนัก (Desktop + PDA)
//   2. ★ ปิดทั้งจอจริง: hit-test มุมทั้ง 4 + กลางจอ เจอตัว modal เอง ไม่เจอหน้าแอป
//   3. ★ เลือกสาขา → PIN: ไม่มีช่วงที่ไม่มี modal ใดแสดง (ซิงก์ใน task เดียว) และฉากหลังขึ้นเต็มทึบทันที (กัน "ขาว → หน้าแอปแว้บ → ขาว")
const { test, expect, newAppContext, waitForAppReady, bootBare, closeApp } = require('../../lib/hooks');

async function bootPda(browser) {
  const app = await newAppContext(browser, { login: false, mode: 'pda' });
  await app.page.goto('/index.html');
  await waitForAppReady(app.page, { login: false });
  return app;
}

const BOOTS = [['Desktop', bootBare], ['PDA', bootPda]];

test('★ ค่าที่ส่งมอบ: ฉากหลังเลือกสาขา/PIN ขาวทึบ · ไม่เฟดเข้า · z-index เดิม · การ์ดมีขอบ+เงานุ่มไม่ดำหนัก (Desktop + PDA)', async ({ browser }) => {
  for (const [name, boot] of BOOTS) {
    const app = await boot(browser);
    const r = await app.page.evaluate(() => {
      const info = (ovId, cardId) => {
        const ov = document.getElementById(ovId); const card = document.getElementById(cardId);
        // เปิดเหมือนที่แอปเปิดจริง (ใส่คลาสเฟดเข้า/การ์ดสไลด์) แล้วอ่านค่าที่เบราว์เซอร์คำนวณ
        _openModal(ovId, cardId);
        const o = getComputedStyle(ov); const c = getComputedStyle(card);
        const out = {
          bg: o.backgroundColor, pos: o.position, z: Number(o.zIndex), anim: o.animationName, opacity: o.opacity,
          inset: [o.top, o.right, o.bottom, o.left],
          cardBg: c.backgroundColor, border: [c.borderTopWidth, c.borderTopStyle], shadow: c.boxShadow,
        };
        ov.style.display = 'none';
        return out;
      };
      return {
        branch: info('branchModal', 'branchModalCard'),
        pin: info('pinModal', 'pinModalCard'),
        zEmp: Number(getComputedStyle(document.getElementById('employeeModal')).zIndex),
        zToast: Number(getComputedStyle(document.getElementById('toastContainer')).zIndex),
      };
    });
    for (const k of ['branch', 'pin']) {
      const m = r[k];
      expect(m, `${name} ${k}`).toMatchObject({ bg: 'rgb(255, 255, 255)', pos: 'fixed', anim: 'none', opacity: '1', inset: ['0px', '0px', '0px', '0px'], cardBg: 'rgb(255, 255, 255)', border: ['1px', 'solid'] });
      expect(m.shadow, `${name} ${k}: เงาดำหนักเดิมต้องไม่กลับมา`).not.toContain('rgba(0, 0, 0, 0.25)');
      expect(m.shadow, `${name} ${k}: ยังมีเงา (การ์ดลอยจากพื้น)`).not.toBe('none');
    }
    // ลำดับชั้นเดิม: toast(9999) ≤ เลือกสาขา(9999) < PIN(10000) < เลือกชื่อ(10001) — ฉากหลังใหม่ไม่เปลี่ยนลำดับ
    expect([r.branch.z, r.pin.z, r.zEmp, r.zToast]).toEqual([9999, 10000, 10001, 9999]);
    await closeApp(app);
  }
});

test('★ ปิดทั้งจอจริง: ทุกมุม+กลางจอ hit-test เจอตัว modal เอง ไม่เจอหน้าแอปข้างหลัง (หน้าเลือกสาขา + หน้า PIN · Desktop + PDA)', async ({ browser }) => {
  for (const [name, boot] of BOOTS) {
    const app = await boot(browser);
    const r = await app.page.evaluate(() => {
      const hits = (ovId) => {
        const W = innerWidth, H = innerHeight;
        const pts = [[2, 2], [W - 3, 2], [2, H - 3], [W - 3, H - 3], [W / 2, 6]];   // 4 มุม + กลางขอบบน (นอกการ์ด)
        return pts.map(([x, y]) => {
          const e = document.elementFromPoint(x, y);
          return { inModal: e === document.getElementById(ovId), appBehind: !!e?.closest('.container') };
        });
      };
      showBranchSelector();                      // ทางเดียวกับที่ใช้ตอนเปิดแอป และปุ่ม "Branch" ระหว่างใช้งาน
      const branch = hits('branchModal');
      document.getElementById('branchModal').style.display = 'none';
      _openModal('pinModal', 'pinModalCard');
      const pin = hits('pinModal');
      return { branch, pin };
    });
    for (const k of ['branch', 'pin']) {
      expect(r[k].every((h) => h.inModal), `${name} ${k}: ต้องเจอตัว modal เอง`).toBe(true);
      expect(r[k].some((h) => h.appBehind), `${name} ${k}: ห้ามเห็นหน้าแอปข้างหลัง`).toBe(false);
    }
    await closeApp(app);
  }
});

test('★ เลือกสาขา → PIN: สลับใน task เดียว ไม่มีเฟรมที่ไม่มี modal และฉากหลังขาวขึ้นเต็มทึบทันที (กัน ขาว → หน้าแอปแว้บ → ขาว)', async ({ browser }) => {
  for (const [name, boot] of BOOTS) {
    const app = await boot(browser);
    const r = await app.page.evaluate(() => {
      const disp = (id) => getComputedStyle(document.getElementById(id)).display;
      showBranchSelector();
      const before = { branch: disp('branchModal'), pin: disp('pinModal') };
      // เหมือนผู้ใช้กดสาขา (ไม่ await): ส่วน sync ของ selectBranch ต้องปิดหน้าเลือกสาขา + เปิดหน้า PIN ให้จบใน task เดียว
      // ถ้ามี await คั่นกลาง (เช่นเพิ่ม await ก่อน _openModal) จะมีช่วงที่ไม่มี modal ใดแสดง = หน้าแอปโผล่ให้เห็น
      const p = selectBranch('SRC');
      const after = { branch: disp('branchModal'), pin: disp('pinModal') };
      const o = getComputedStyle(document.getElementById('pinModal'));
      return { before, after, pinOpacityNow: o.opacity, pinAnim: o.animationName, pinBg: o.backgroundColor, sync: p instanceof Promise };
    });
    expect(r.before, `${name}: ก่อนเลือก`).toEqual({ branch: 'flex', pin: 'none' });
    expect(r.after, `${name}: ทันทีหลังเลือกสาขา (task เดียวกัน)`).toEqual({ branch: 'none', pin: 'flex' });
    expect([r.pinOpacityNow, r.pinAnim, r.pinBg], `${name}: ฉากหลัง PIN ทึบทันที ไม่เฟด`).toEqual(['1', 'none', 'rgb(255, 255, 255)']);
    await closeApp(app);
  }
});
