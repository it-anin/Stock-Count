// เหตุการณ์จริง SRC 25–26 ต.ค. 2026 — บอท auto-r16 Confirm 64 รายการตอน 21:10 (Pass 59 · Stock Adj 5) แต่ 09:03 เช้าวันถัดไปเอกสารทั้ง 64 หายจาก Cloud พร้อมกัน
//   ต้นเหตุ: เครื่องที่ล็อกอินค้างข้ามคืนและ "หลับตอนบอทเขียน" (ไม่ได้รับอัปเดตจาก listener) ตื่นขึ้นมา
//   → visibilitychange → runStaleGuard ตั้งรายการเมื่อวาน (ยังเป็น scanning ในเครื่อง) เป็น pending → _flushDirtySkus ส่ง batch.delete ทับผลที่บอท Confirm แล้ว
//   (blob v1 เคยมีด่าน "ไม่ทับ status ของ cloud ด้วย local pending" — schema v2 ไม่มี · บอท Confirm ตอนกลางคืนทำให้เกิดได้ทุกคืนที่มีเครื่องหลับ)
// กติกาใหม่ (สวิตช์ FLUSH_DEL_KEEP_CONFIRMED · สาขายา): pending → ลบด้วย transaction ที่อ่านก่อนลบ — Confirm แล้วในรอบนี้ = ไม่ลบ + รับผลเข้าเครื่อง + toast
// เทสนี้ผ่านเส้นทางจริงบน Firestore emulator: สแกนจริง → ทำให้เป็น "เมื่อวาน" → PDA หลับ (ปิดเครือข่าย) → เขียนผลแบบบอท (admin SDK) → ปลุก (visibilitychange) → เปิดเครือข่าย → flush จริง
// (ตรรกะละเอียดทุกกรณีของตัวลบแบบมีเงื่อนไขอยู่ใน specs/logic/flush-del-keep-confirmed.spec.js — ใช้ _db ปลอมที่คุมจังหวะได้)
const admin = require('firebase-admin');
const { test, expect, closeApp, requireEmulator } = require('../../lib/hooks');
const { bootFreshCount } = require('../../lib/scenario');
const { waitForDoc, getDoc, setDoc, adminDb } = require('../../lib/emulator');
const { waitForLoginDone } = require('../../lib/boot');

const BR = 'SRC';
const ITEM = (sku) => `stock_sessions/${BR}/items/${sku}`;
const pad = (n) => String(n).padStart(2, '0');
const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
const SCANS = [['S-NORM', 'B-NORM'], ['S-CATA', 'B-CATA'], ['S-MULTI', 'B-M1']];
const SKUS = SCANS.map((s) => s[0]);

async function scanOnce(page, line) { await page.evaluate((l) => { scanQueue.push(parseScanLine(l)); drainQueue(); }, line); }
async function quiesce(page) { await page.waitForFunction(() => !_scanItemFlushing && !_scanItemInFlight.size && !_dirtySkus.size, null, { timeout: 25000, polling: 100 }); }

// พนักงานสแกน 3 รายการ (จริง ผ่าน drainQueue) → ขึ้น Cloud เป็น scanning
async function scanAll(app) {
  for (const [, bc] of SCANS) await scanOnce(app.page, bc);
  await quiesce(app.page);
  for (const sku of SKUS) await waitForDoc(app.projectId, ITEM(sku), (d) => d && d.status === 'scanning');
}
// "เมื่อวาน" — ทั้งบน Cloud และในเครื่อง (ตั้ง fingerprint ที่ sync แล้วให้ตรง เพื่อไม่ให้ reconcile ดันอะไรขึ้นไปเอง) · เครื่องที่ล็อกอินค้างข้ามคืนยังไม่เคยเช็คของค้างในวันใหม่
async function makeItYesterday(app) {
  const y = fmt(new Date(Date.now() - 24 * 3600 * 1000));
  for (const sku of SKUS) await setDoc(app.projectId, ITEM(sku), { timestamp: y, firstScanAt: y });
  await app.page.evaluate(({ skus, y }) => {
    for (const sku of skus) {
      const sd = state.scanData.get(sku);
      sd.timestamp = y; sd.firstScanAt = y;
      _scanItemSynced.set(sku, _scanItemFingerprint(sd));
    }
    _staleGuardDay = '1999-01-01';
  }, { skus: SKUS, y });
}
// สิ่งที่บอท auto-r16 เขียนตอน Confirm (item_changes + rev+1 + updatedBy:'auto-r16') — คืน rev ที่เขียน
async function botConfirm(app, skus = SKUS) {
  const revs = {};
  for (const sku of skus) {
    const cur = await getDoc(app.projectId, ITEM(sku));
    const adj = sku === 'S-MULTI';
    revs[sku] = (cur.rev || 0) + 1;
    await adminDb(app.projectId).doc(ITEM(sku)).set({
      status: adj ? 'stock_adjustment' : 'pass',
      auditStatus: adj ? 'stock_adjustment' : 'approved',
      initialStatus: cur.initialStatus || (adj ? 'stock_adjustment' : 'pass'),
      ...(adj ? { directAdj: true, effectiveQty: 30, systemQty: 60 } : {}),
      rev: revs[sku], updatedBy: 'auto-r16',
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  }
  return revs;
}
const cloudView = async (app) => Object.fromEntries(await Promise.all(SKUS.map(async (s) => {
  const d = await getDoc(app.projectId, ITEM(s));
  return [s, d ? { status: d.status, updatedBy: d.updatedBy || '', rev: d.rev, directAdj: d.directAdj, effectiveQty: d.effectiveQty, systemQty: d.systemQty, countedQty: d.countedQty } : null];
})));
const localStatuses = (app) => app.page.evaluate((skus) => Object.fromEntries(skus.map((s) => [s, (state.scanData.get(s) || {}).status])), SKUS);
const trackToasts = (app) => app.page.evaluate(() => {
  window.__toasts = []; const o = window.toast;
  window.toast = function (m, ...a) { window.__toasts.push(String(m)); return o.apply(this, [m, ...a]); };
});
const toasts = (app) => app.page.evaluate(() => window.__toasts.slice());
const wake = (app) => app.page.evaluate(() => {   // ปลุกจอ → visibilitychange (handler เรียก runStaleGuard แล้ว syncToFirestore)
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
  document.dispatchEvent(new Event('visibilitychange'));
});
// เครือข่ายกลับมา: ปลดช่วง backoff (รอบที่ลองตอนออฟไลน์ล้มเป็นปกติ) แล้ว flush จริงจนไม่เหลือค้าง
async function backOnlineAndFlush(app) {
  await app.page.evaluate(async () => { await _db.enableNetwork(); });
  await app.page.evaluate(async () => { _scanItemBackoffUntil = 0; clearTimeout(_scanItemFlushTimer); _scanItemFlushTimer = null; await _flushDirtySkus(); });
  await quiesce(app.page);
}

// ── เหตุการณ์จริง: PDA หลับตอนบอท Confirm แล้วตื่นเช้าวันถัดไป ──
async function sleepConfirmWake(browser, { guard = true, only = SKUS } = {}) {
  const pda = await bootFreshCount(browser, { branch: BR, role: 'assistant', user: 'ก้า', mode: 'pda' });
  await scanAll(pda);
  await makeItYesterday(pda);
  await trackToasts(pda);
  await pda.page.evaluate((g) => { FLUSH_DEL_KEEP_CONFIRMED = g; }, guard);
  await pda.page.evaluate(() => _db.disableNetwork());              // PDA หลับ — ไม่ได้รับอะไรจาก Cloud
  const revs = await botConfirm(pda, only);                          // 21:10 บอท Confirm
  const asleep = { cloud: await cloudView(pda), local: await localStatuses(pda) };
  await wake(pda);                                                   // เช้า 09:03 ปลุก PDA
  await pda.page.waitForFunction((skus) => skus.every((s) => state.scanData.get(s).status === 'pending'), SKUS, { timeout: 10000, polling: 50 });
  const afterWake = await localStatuses(pda);                        // runStaleGuard รีเซ็ตของค้างข้ามวันในเครื่องแล้ว (ยังไม่รู้ว่าบอท Confirm ไปแล้ว)
  await backOnlineAndFlush(pda);                                     // เน็ตกลับมา → flush จริง
  return { pda, revs, asleep, afterWake, cloud: await cloudView(pda), local: await localStatuses(pda), toasts: await toasts(pda) };
}

test.describe('รีเซ็ตของค้างข้ามวันห้ามลบผล Confirm ของบอท (สาขายา)', () => {
  test.beforeEach(() => requireEmulator());
  test.setTimeout(150_000);

  test('★ PDA ที่หลับตอนบอท Confirm แล้วตื่นเช้าวันถัดไป → ผลของบอทอยู่ครบบน Cloud (ไม่ถูกลบ ไม่ถูกเขียนทับ) · เครื่องรับผลเข้ามาและแจ้งผู้ใช้', async ({ browser }) => {
    const r = await sleepConfirmWake(browser);
    // ก่อนปลุก: Cloud มีผลของบอทแล้ว แต่เครื่องยังไม่รู้ (ยัง scanning ในเครื่อง) — ตรงกับสภาพ 09:03 ของเหตุการณ์จริง
    expect(r.asleep.cloud['S-NORM']).toMatchObject({ status: 'pass', updatedBy: 'auto-r16' });
    expect(r.asleep.local).toEqual({ 'S-NORM': 'scanning', 'S-CATA': 'scanning', 'S-MULTI': 'scanning' });
    // ตื่นแล้ว runStaleGuard รีเซ็ตในเครื่องเป็น pending (พฤติกรรมเดิม — ยังไม่ได้ถามบอท)
    expect(r.afterWake).toEqual({ 'S-NORM': 'pending', 'S-CATA': 'pending', 'S-MULTI': 'pending' });
    // ★ หลัง flush: เอกสารยังอยู่ครบ และเป็นของบอทเหมือนเดิมทุกไบต์ (rev/updatedBy ไม่ถูกเครื่องนี้เขียนทับ)
    expect(r.cloud['S-NORM']).toMatchObject({ status: 'pass', updatedBy: 'auto-r16', rev: r.revs['S-NORM'] });
    expect(r.cloud['S-CATA']).toMatchObject({ status: 'pass', updatedBy: 'auto-r16', rev: r.revs['S-CATA'] });
    expect(r.cloud['S-MULTI']).toMatchObject({ status: 'stock_adjustment', updatedBy: 'auto-r16', rev: r.revs['S-MULTI'], directAdj: true, effectiveQty: 30, systemQty: 60 });
    // เครื่องรับผลมาแทน (ไม่ค้างเป็น pending ที่จะถูกนับใหม่/ถูกมองว่ารอนับ) + บอกผู้ใช้ว่าไม่ต้องนับใหม่
    expect(r.local).toEqual({ 'S-NORM': 'pass', 'S-CATA': 'pass', 'S-MULTI': 'stock_adjustment' });
    expect(r.toasts.some((t) => t.includes('3 รายการ Confirm แล้ว') && t.includes('ไม่ต้องนับใหม่'))).toBe(true);
    // ปล่อยให้ระบบทำงานต่ออีกรอบ (reconcile/flush/listener) — ต้องไม่มีอะไรลบหรือเขียนทับตามมาทีหลัง
    await settle(r.pda);
    const later = await cloudView(r.pda);
    for (const s of SKUS) expect(later[s], s).toMatchObject({ updatedBy: 'auto-r16', rev: r.revs[s] });
    expect(await localStatuses(r.pda)).toEqual({ 'S-NORM': 'pass', 'S-CATA': 'pass', 'S-MULTI': 'stock_adjustment' });
    await closeApp(r.pda, { allowPageErrors: true });
  });

  test('★ canary: ปิดสวิตช์ FLUSH_DEL_KEEP_CONFIRMED = บั๊กเดิมกลับมาเป๊ะ — ผลของบอททั้งหมดหายจาก Cloud (พิสูจน์ว่าเทสข้อบนจับบั๊กได้จริง)', async ({ browser }) => {
    const r = await sleepConfirmWake(browser, { guard: false });
    for (const s of SKUS) expect(r.cloud[s], `${s}: บั๊กเดิม — เอกสารที่บอท Confirm ถูกลบ`).toBeNull();
    expect(r.local).toEqual({ 'S-NORM': 'pending', 'S-CATA': 'pending', 'S-MULTI': 'pending' });
    expect(r.toasts.some((t) => t.includes('ไม่ต้องนับใหม่'))).toBe(false);
    await closeApp(r.pda, { allowPageErrors: true });
  });

  test('ควบคุม: PDA ที่ล็อกอินใหม่เช้าวันถัดไป → โหลดผลของบอทจาก Cloud ไม่ลบ (เส้นทางที่ปลอดภัยอยู่แล้ว ห้ามเสีย)', async ({ browser }) => {
    const pda = await bootFreshCount(browser, { branch: BR, role: 'assistant', user: 'ก้า', mode: 'pda' });
    await scanAll(pda);
    await makeItYesterday(pda);
    await pda.page.evaluate(() => _db.disableNetwork());
    const revs = await botConfirm(pda);
    await pda.page.evaluate(() => _db.enableNetwork());
    await pda.page.reload();                                         // ล็อกอินใหม่ (stash _autoUpdate) = โหลดจาก Cloud ใหม่ทั้งหมด
    await waitForLoginDone(pda.page);
    await quiesce(pda.page);
    expect(await localStatuses(pda)).toEqual({ 'S-NORM': 'pass', 'S-CATA': 'pass', 'S-MULTI': 'stock_adjustment' });
    const cloud = await cloudView(pda);
    for (const s of SKUS) expect(cloud[s], s).toMatchObject({ updatedBy: 'auto-r16', rev: revs[s] });
    await closeApp(pda, { allowPageErrors: true });
  });

  test('ควบคุม: PDA ที่ออนไลน์ตลอดคืน (ได้รับอัปเดตของบอทจาก listener แล้ว) → ตื่นเช้าไม่ลบอะไร · ไม่มี toast คืนผล', async ({ browser }) => {
    const pda = await bootFreshCount(browser, { branch: BR, role: 'assistant', user: 'ก้า', mode: 'pda' });
    await scanAll(pda);
    await makeItYesterday(pda);
    await trackToasts(pda);
    const revs = await botConfirm(pda);                              // PDA ออนไลน์ — listener ส่งผลมาให้
    await pda.page.waitForFunction(() => state.scanData.get('S-NORM').status === 'pass' && state.scanData.get('S-MULTI').status === 'stock_adjustment', null, { timeout: 20000, polling: 100 });
    await wake(pda);
    await settle(pda);
    const cloud = await cloudView(pda);
    for (const s of SKUS) expect(cloud[s], s).toMatchObject({ updatedBy: 'auto-r16', rev: revs[s] });
    expect(await localStatuses(pda)).toEqual({ 'S-NORM': 'pass', 'S-CATA': 'pass', 'S-MULTI': 'stock_adjustment' });
    expect((await toasts(pda)).some((t) => t.includes('ไม่ต้องนับใหม่'))).toBe(false);
    await closeApp(pda, { allowPageErrors: true });
  });

  test('★ ชุดผสม: บอท Confirm เฉพาะบางรายการ (อีกตัวยัง scanning บน Cloud) → เก็บที่ Confirm แล้ว · ลบเฉพาะที่ยังไม่ Confirm ตามเดิม (รีเซ็ตของค้างข้ามวันที่ไม่มีใคร Confirm ยังทำงาน)', async ({ browser }) => {
    const r = await sleepConfirmWake(browser, { only: ['S-NORM', 'S-CATA'] });
    expect(r.cloud['S-NORM']).toMatchObject({ status: 'pass', updatedBy: 'auto-r16', rev: r.revs['S-NORM'] });
    expect(r.cloud['S-CATA']).toMatchObject({ status: 'pass', updatedBy: 'auto-r16', rev: r.revs['S-CATA'] });
    expect(r.cloud['S-MULTI']).toBeNull();                           // ไม่มีใคร Confirm → ของค้างข้ามวันถูกรีเซ็ต/ลบตามเดิม
    expect(r.local).toEqual({ 'S-NORM': 'pass', 'S-CATA': 'pass', 'S-MULTI': 'pending' });
    expect(r.toasts.some((t) => t.includes('2 รายการ Confirm แล้ว'))).toBe(true);
    await closeApp(r.pda, { allowPageErrors: true });
  });

  test('ปุ่ม ✕ ของแถวที่ยังสแกนค้าง (scanning) ยังลบเอกสารบน Cloud ตามเดิม — ไม่ผ่านด่านใหม่ · SKU อื่นไม่กระทบ', async ({ browser }) => {
    const pda = await bootFreshCount(browser, { branch: BR, role: 'assistant', user: 'ก้า', mode: 'pda' });
    await scanAll(pda);
    await pda.page.evaluate(() => { removeScanItem('S-NORM'); });
    await waitForDoc(pda.projectId, ITEM('S-NORM'), (d) => d === null);
    await quiesce(pda.page);
    expect(await localStatuses(pda)).toMatchObject({ 'S-NORM': 'pending', 'S-CATA': 'scanning', 'S-MULTI': 'scanning' });
    expect(await getDoc(pda.projectId, ITEM('S-NORM'))).toBeNull();
    expect(await getDoc(pda.projectId, ITEM('S-CATA'))).toMatchObject({ status: 'scanning' });
    await closeApp(pda, { allowPageErrors: true });
  });
});

// ให้ reconcile (ทุก 60 วิ — เรียกตรงๆ แทนการรอ) + flush ทำงานอีกรอบ แล้วรอให้นิ่ง
async function settle(app) {
  await app.page.evaluate(async () => { _reconcileScanItems(); _scanItemBackoffUntil = 0; clearTimeout(_scanItemFlushTimer); _scanItemFlushTimer = null; await _flushDirtySkus(); });
  await quiesce(app.page);
  await app.page.waitForTimeout(1500);
  await quiesce(app.page);
}
