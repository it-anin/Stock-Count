// tools/restore-item-from-pitr.js — ส่วน logic ล้วน (ไม่ใช้ emulator): ตัวแปลงค่า Firestore REST → ค่า JS · ตัวอ่านไฟล์ · ตัวสรุปรายงาน · ข้อตกลงก่อนเขียน
// เส้นทางเขียนจริงบน Cloud (↺ → กู้กลับ → ทุกเครื่องเห็น → marker) อยู่ที่ specs/e2e/restore-item-from-pitr.spec.js
// ข้อมูลทั้งหมดสังเคราะห์ (repo นี้ public) — โครงเดียวกับเอกสาร item ที่อ่านย้อนหลังได้จริงจาก Cloud Shell (batchGet + readTime)
const fs = require('fs');
const path = require('path');
const { test, expect, bootBare, closeApp } = require('../../lib/hooks');

const TOOL = fs.readFileSync(path.join(__dirname, '../../../tools/restore-item-from-pitr.js'), 'utf8');
const RECON = fs.readFileSync(path.join(__dirname, '../../../tools/recon-item-from-auditlog.js'), 'utf8');

// เอกสาร item แบบ Stock Adj ที่ผ่านรีเช็ค (initialStatus audit + auditor) ในรูป REST ดิบ — ครบชนิดค่าที่ item มีจริง: string / integer / timestamp
const REST_DOC = (over = {}) => ({
  name: 'projects/demo-stock-count/databases/(default)/documents/stock_sessions/SRC/items/S-F05',
  fields: {
    sku: { stringValue: 'S-F05' },
    countResetAt: { stringValue: '2026-08-05T08:30:40.811Z' },
    scannedBy: { stringValue: 'PDA-A' },
    auditor: { stringValue: 'Pharm' },
    status: { stringValue: 'stock_adjustment' },
    initialStatus: { stringValue: 'audit' },
    countedQty: { integerValue: '10' },
    recheckQty: { integerValue: '12' },
    recheckSystemQty: { integerValue: '21' },
    systemQty: { integerValue: '21' },
    effectiveQty: { integerValue: '12' },
    rev: { integerValue: '20' },
    firstScanAt: { stringValue: '2026-08-07 16:44:19' },
    updatedBy: { stringValue: 'Pharm' },
    updatedAt: { timestampValue: '2026-09-17T05:47:57.807Z' },
    ...over,
  },
  createTime: '2026-08-07T09:44:20.231490Z',
  updateTime: '2026-09-17T05:47:57.816219Z',
});
const FILE = (doc = REST_DOC(), readTime = '2026-10-16T04:10:00Z') => [{ found: doc, readTime }];

async function boot(browser) {
  const app = await bootBare(browser);
  await app.page.addScriptTag({ content: TOOL });
  return app;
}

test.describe('tools/restore-item-from-pitr.js — logic', () => {
  test('★ แปลงทุกชนิดค่า REST → ค่า JS ที่ SDK เขียนได้ (string/integer/double/boolean/null/timestamp/map/array)', async ({ browser }) => {
    const app = await boot(browser);
    const out = await app.page.evaluate(() => {
      const { fromFields } = restoreFromPitr._internals;
      const r = fromFields({
        s: { stringValue: 'ไทย' }, i: { integerValue: '-7' }, d: { doubleValue: 2.5 }, dn: { doubleValue: 'NaN' }, di: { doubleValue: 'Infinity' },
        b: { booleanValue: false }, n: { nullValue: null },
        t: { timestampValue: '2026-09-17T05:47:57.807123456Z' },
        m: { mapValue: { fields: { x: { integerValue: '1' }, y: { arrayValue: { values: [{ stringValue: 'a' }, { integerValue: '2' }] } } } } },
        em: { mapValue: {} }, ea: { arrayValue: {} },
      });
      return {
        s: r.s, i: r.i, d: r.d, dnNaN: Number.isNaN(r.dn), di: r.di, b: r.b, n: r.n,
        isTs: r.t instanceof firebase.firestore.Timestamp, sec: r.t.seconds, nanos: r.t.nanoseconds,
        m: r.m, em: r.em, ea: r.ea,
      };
    });
    expect(out).toEqual({
      s: 'ไทย', i: -7, d: 2.5, dnNaN: true, di: Infinity, b: false, n: null,
      isTs: true, sec: Date.UTC(2026, 8, 17, 5, 47, 57) / 1000, nanos: 807123456,
      m: { x: 1, y: ['a', 2] }, em: {}, ea: [],
    });
    await closeApp(app);
  });

  test('timestamp: ไม่มีเศษวินาที / เศษ 3 หลัก ได้เวลาเท่ากัน · รูปแบบที่ไม่รองรับ (offset ที่ไม่ใช่ Z) ต้องปฏิเสธ ไม่เดา', async ({ browser }) => {
    const app = await boot(browser);
    const r = await app.page.evaluate(() => {
      const { toTimestamp } = restoreFromPitr._internals;
      const a = toTimestamp('2026-09-17T05:47:57Z'), b = toTimestamp('2026-09-17T05:47:57.500Z');
      let err = '';
      try { toTimestamp('2026-09-17T12:47:57+07:00'); } catch (e) { err = e.message; }
      return { aSec: a.seconds, aNanos: a.nanoseconds, bNanos: b.nanoseconds, err };
    });
    expect(r.aNanos).toBe(0);
    expect(r.bNanos).toBe(500_000_000);
    expect(r.err).toContain('รูปแบบไม่รองรับ');
    await closeApp(app);
  });

  test('ชนิดที่ไม่รองรับ / ตัวเลขใหญ่เกิน / ค่าที่ไม่ใช่รูปแบบ Firestore = ปฏิเสธทั้งไฟล์ (ไม่ข้ามเงียบ)', async ({ browser }) => {
    const app = await boot(browser);
    const errs = await app.page.evaluate(() => {
      const { fromValue } = restoreFromPitr._internals;
      const t = (v) => { try { fromValue(v); return ''; } catch (e) { return e.message; } };
      return {
        ref: t({ referenceValue: 'projects/x/databases/(default)/documents/a/b' }),
        geo: t({ geoPointValue: { latitude: 1, longitude: 2 } }),
        big: t({ integerValue: '9007199254740993' }),
        raw: t('plain'),
        nul: t(null),
      };
    });
    expect(errs.ref).toContain('ชนิดข้อมูลที่ไม่รองรับ');
    expect(errs.geo).toContain('ชนิดข้อมูลที่ไม่รองรับ');
    expect(errs.big).toContain('ใหญ่เกิน');
    expect(errs.raw).toContain('ไม่ใช่รูปแบบ Firestore');
    expect(errs.nul).toContain('ไม่ใช่รูปแบบ Firestore');
    await closeApp(app);
  });

  test('★ อ่านไฟล์ผล find_before: ได้สาขา/SKU/ค่าครบ · ผล "missing" · ไม่มี sku/countResetAt · ชื่อเอกสารผิด · sku ไม่ตรงรหัสเอกสาร = ปฏิเสธพร้อมบอกเหตุ', async ({ browser }) => {
    const app = await boot(browser);
    const r = await app.page.evaluate(({ good, missing, noEpoch, badName, mismatch }) => {
      const { parseItemFile } = restoreFromPitr._internals;
      const t = (j) => { try { parseItemFile('f.json', j); return ''; } catch (e) { return e.message; } };
      const p = parseItemFile('before-SRC-S-F05.json', good);
      return {
        branch: p.branch, sku: p.sku, readTime: p.readTime, status: p.data.status, counted: p.data.countedQty, recheck: p.data.recheckQty, rev: p.data.rev,
        auditor: p.data.auditor, epoch: p.data.countResetAt,
        missing: t(missing), noEpoch: t(noEpoch), badName: t(badName), mismatch: t(mismatch),
        single: parseItemFile('x', good[0]).sku,   // ไฟล์ที่เป็น object เดี่ยว (ไม่ห่อ array) ก็อ่านได้
      };
    }, {
      good: FILE(),
      missing: [{ missing: 'projects/demo/databases/(default)/documents/stock_sessions/SRC/items/S-F05', readTime: 't' }],
      noEpoch: (() => { const d = REST_DOC(); delete d.fields.countResetAt; return FILE(d); })(),
      badName: FILE({ ...REST_DOC(), name: 'projects/demo/databases/(default)/documents/stock_sessions/SRC_r01' }),
      mismatch: FILE(REST_DOC({ sku: { stringValue: 'S-OTHER' } })),
    });
    expect(r).toMatchObject({ branch: 'SRC', sku: 'S-F05', readTime: '2026-10-16T04:10:00Z', status: 'stock_adjustment', counted: 10, recheck: 12, rev: 20, auditor: 'Pharm', epoch: '2026-08-05T08:30:40.811Z', single: 'S-F05' });
    expect(r.missing).toContain('ต้องมีเอกสาร "found" 1 รายการ');
    expect(r.noEpoch).toContain('ไม่มี countResetAt');
    expect(r.badName).toContain('ไม่ใช่ stock_sessions/<สาขา>/items/<SKU>');
    expect(r.mismatch).toContain('ไม่ตรงกับรหัสเอกสาร');
    await closeApp(app);
  });

  test('รายงานสรุป: ผ่านรีเช็ค = ยอดรีเช็ค−ระบบตอนรีเช็ค (−9) · Stock Adj ตรง = นับ+R16−ระบบตอน Confirm · ค่าไม่ครบ = null ไม่เป็น NaN', async ({ browser }) => {
    const app = await boot(browser);
    const r = await app.page.evaluate(() => {
      const { summarize } = restoreFromPitr._internals;
      return {
        recheck: summarize({ status: 'stock_adjustment', initialStatus: 'audit', auditor: 'P', recheckQty: 12, recheckSystemQty: 21, systemQty: 21, countedQty: 10 }),
        direct: summarize({ status: 'stock_adjustment', directAdj: true, effectiveQty: 3, systemQty: 5, countedQty: 3 }),
        sparse: summarize({ status: 'scanning' }),
      };
    });
    expect(r.recheck).toMatchObject({ diff: -9, system: 21, recheck: 12, counted: 10, passedRecheck: true });
    expect(r.direct).toMatchObject({ diff: -2, system: 5, counted: 3, passedRecheck: false });
    expect(r.sparse).toMatchObject({ diff: null, system: null, counted: null, recheck: null, passedRecheck: false });
    await closeApp(app);
  });

  test('หน้าที่ยังไม่ได้ login ถูกปฏิเสธที่ด่านแรก ก่อนแตะ Cloud (PDA / ผิดสาขา / SKU ซ้ำ ตรวจใน e2e)', async ({ browser }) => {
    const app = await boot(browser);
    // bootBare = ไม่ login + Firestore ชี้พอร์ตตาย → ต้องหยุดที่ด่านแรกโดยไม่เรียก Cloud
    const noLogin = await app.page.evaluate(async (files) => { try { await restoreFromPitr({ files }); return 'ran'; } catch (e) { return e.message; } }, [{ name: 'a.json', json: FILE() }]);
    expect(noLogin).toMatch(/ยังไม่ได้เลือกสาขา|ยังไม่ได้เชื่อมต่อ Firestore/);
    await closeApp(app);
  });

  test('★ reconItem (ประกอบจากแถว stock_audit_log): ORDS −1 → ระบบตอนรีเช็ค = รีเช็ค+1 · IRPS +2 → รีเช็ค−2 · อ่านผ่าน parseItemFile ได้ครบ · ไม่แต่งค่าที่ไม่รู้', async ({ browser }) => {
    const app = await boot(browser);
    await app.page.addScriptTag({ content: RECON });
    const r = await app.page.evaluate(() => {
      currentBranch = 'SSS'; _countResetAt = '2026-08-05T08:30:40.811Z';
      const { parseItemFile, summarize } = restoreFromPitr._internals;
      const mk = (o) => { const f = reconItem(o); return parseItemFile(f.name, f.json); };
      const base = { sku: '100026', counted: 53, by: 'A', first: '2026-08-11 14:33:57', auditor: 'B', recheck: 19, last: '2026-09-24 11:59:31' };
      const ords = mk({ ...base, diff: -1 }), irps = mk({ ...base, sku: '100027', recheck: 10, diff: 2 });
      return { ords: ords.data, ordsBranch: ords.branch, ordsName: reconItem({ ...base, diff: -1 }).name, ordsSum: summarize(ords.data), irpsSys: irps.data.recheckSystemQty, irpsSum: summarize(irps.data) };
    });
    expect(r.ordsBranch).toBe('SSS');
    expect(r.ordsName).toBe('reconstructed-SSS-100026.json');
    expect(r.ords).toEqual({ sku: '100026', barcode: '100026', countResetAt: '2026-08-05T08:30:40.811Z', status: 'stock_adjustment', auditStatus: 'stock_adjustment', initialStatus: 'audit',
      countedQty: 53, scannedBy: 'A', firstScanAt: '2026-08-11 14:33:57', auditor: 'B', recheckBy: 'B', recheckQty: 19, recheckSystemQty: 20, recheckAt: '2026-09-24 11:59:31', timestamp: '2026-09-24 11:59:31', rev: 1 });
    expect(r.ords.systemQty).toBeUndefined();     // ไม่แต่งค่าที่ log ไม่เก็บ
    expect(r.ords.effectiveQty).toBeUndefined();
    expect(r.ordsSum).toMatchObject({ diff: -1, system: 20, recheck: 19, counted: 53, passedRecheck: true });
    expect(r.irpsSys).toBe(8);
    expect(r.irpsSum).toMatchObject({ diff: 2, system: 8, recheck: 10 });
    await closeApp(app);
  });

  test('reconItem: ไม่ login / ค่าไม่ครบ / diff ผิด / เวลาอยู่ก่อนรอบนับ / เครื่องหมายทำให้ระบบติดลบ = ปฏิเสธ ไม่เดา', async ({ browser }) => {
    const app = await boot(browser);
    await app.page.addScriptTag({ content: RECON });
    const r = await app.page.evaluate(() => {
      const t = (o) => { try { reconItem(o); return ''; } catch (e) { return e.message; } };
      const base = { sku: '100026', counted: 53, by: 'A', first: '2026-08-11 14:33:57', auditor: 'B', recheck: 19, last: '2026-09-24 11:59:31', diff: -1 };
      const noLogin = t(base);
      currentBranch = 'SSS'; _countResetAt = '2026-08-05T08:30:40.811Z';
      return {
        noLogin,
        missing: t({ ...base, auditor: '' }), zeroDiff: t({ ...base, diff: 0 }), fracDiff: t({ ...base, diff: -0.5 }), strQty: t({ ...base, recheck: '19' }),
        badTime: t({ ...base, last: 'วันนี้' }), beforeEpoch: t({ ...base, first: '2026-07-01 10:00:00' }), negSys: t({ ...base, recheck: 1, diff: 5 }),
        slash: t({ ...base, sku: 'a/b' }), ok: t(base),
      };
    });
    expect(r.noLogin).toContain('ยังไม่ได้ login');
    expect(r.missing).toContain('ขาดค่า "auditor"');
    expect(r.zeroDiff).toContain('diff ต้องเป็นจำนวนเต็ม');
    expect(r.fracDiff).toContain('diff ต้องเป็นจำนวนเต็ม');
    expect(r.strQty).toContain('recheck ต้องเป็นตัวเลข');
    expect(r.badTime).toContain('รูปแบบ');
    expect(r.beforeEpoch).toContain('ก่อนรอบนับ');
    expect(r.negSys).toContain('ติดลบ');
    expect(r.slash).toContain('sku ไม่ถูกต้อง');
    expect(r.ok).toBe('');
    await closeApp(app);
  });
});
