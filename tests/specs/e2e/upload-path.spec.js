// Real file-upload path: setInputFiles → parseFile (PapaParse, windows-874 fallback) → loaders → rebuildMaps
// → cloud master docs. Guards the column positions documented in SKILL-data-files.
const { test, expect, closeApp, requireEmulator } = require('../../lib/hooks');
const { bootFreshCount, PROJECT_ID } = require('../../lib/scenario');
const { waitForDoc, getDoc } = require('../../lib/emulator');
const F = require('../../lib/fixtures');

const csv = (name, text) => ({ name, mimeType: 'text/csv', buffer: Buffer.from(text, 'utf8') });

test.describe('CSV upload path', () => {
  test.beforeEach(() => requireEmulator());
  test.setTimeout(90_000);

  test('Product Branch Master / R01 / R05 upload populates state, skuMap and cloud master docs', async ({ browser }) => {
    // clear:true wipes the emulator; upload (not seed) is what fills the masters here
    const app = await bootFreshCount(browser, { role: 'pharmacist', user: 'Pharm', mode: 'desktop' });
    await app.page.evaluate(() => {
      state.productMasterData = []; state.r01Data = []; state.r05Data = [];
      state.skuMap.clear(); state.barcodeMap.clear(); state.skuDirectMap.clear();
    });

    // CSV carries every row (incl. Col D = D/P, still dropped, and REVIEW, no longer dropped);
    // state must end up with the post-filter set only
    await app.page.setInputFiles('#fileProductMaster', csv('pm.csv', F.toPmCsv()));
    await app.page.waitForFunction((n) => state.productMasterData.length === n, F.pmRows.length, { polling: 100 });
    expect(F.pmSourceRows.length).toBeGreaterThan(F.pmRows.length); // fixture really does exercise the filter

    await app.page.setInputFiles('#fileR01', csv('r01.csv', F.toR01Csv()));
    await app.page.waitForFunction((n) => state.r01Data.length === n, F.r01Rows.length, { polling: 100 });

    await app.page.setInputFiles('#fileR05', csv('r05.csv', F.toR05Csv()));
    await app.page.waitForFunction((n) => state.r05Data.length === n, F.r05Rows.length, { polling: 100 });

    const parsed = await app.page.evaluate(() => ({
      norm: state.skuMap.get('S-NORM'),
      normBox: state.skuMap.get('S-NORM').barcodes.find((b) => b.barcode === 'B-NORM-BOX'),
      pricey: state.skuMap.get('S-PRICEY'),
      noPrice: state.skuMap.get('S-NOPRICE'),
      neg: state.skuMap.get('S-NEG'),
      delItem: state.skuMap.get('S-ONLYR01'),
      catA: state.skuMap.get('S-CATA'),
      catP: state.skuMap.get('S-CATP'),
      catD: state.skuMap.get('S-CATD'),
      review: state.skuMap.get('S-REVIEW'),
      reviewInPm: state.productMasterMap.has('S-REVIEW'),
      catOnA: state.productMasterData.find((r) => r.sku === 'S-CATA')?.cat,
      catOnReview: state.productMasterData.find((r) => r.sku === 'S-REVIEW')?.cat,
      catOnBlank: state.productMasterData.find((r) => r.sku === 'S-NOCAT')?.cat,
      countableCount: _countableSkus.size,
      countableZero: _countableSkus.has('S-ZERO'),
      countableAbcZero: _countableSkus.has('S-ABC0'),
      countableReviewZero: _countableSkus.has('S-REVIEW0'),
      countableNoCat: _countableSkus.has('S-NOCAT'),
      countableNoCatZero: _countableSkus.has('S-NOCAT0'),
      countablePmOnly: _countableSkus.has('S-PMONLY'),
      countableNeg: _countableSkus.has('S-NEG'),
      countableCatP: _countableSkus.has('S-CATP'),
      countableDel: _countableSkus.has('S-ONLYR01'),
      countableOffice: _countableSkus.has('S-OFFICE'),
      countableDelCat: _countableSkus.has('S-DELCAT'),
      countableDelCatZero: _countableSkus.has('S-DELCAT0'),
      countableDelCatNeg: _countableSkus.has('S-DELCATNEG'),
      countableDelCatAbc0: _countableSkus.has('S-DELCAT-ABC0'),
      delCatNegIsDel: state.skuMap.get('S-DELCATNEG')?.isDel,
      delCatAbc0InPm: state.productMasterMap.has('S-DELCAT-ABC0'),
      ncFlagOffice: state.r01Data.find((r) => r.colE === 'S-OFFICE')?.nc,
      ncFlagDelCat: state.r01Data.find((r) => r.colE === 'S-DELCAT')?.nc,
      ncFlagNormal: state.r01Data.find((r) => r.colE === 'S-NORM')?.nc,
      officeSys: state.skuMap.get('S-OFFICE')?.systemQty,
      officeInR01: state.r01Data.some((r) => r.colE === 'S-OFFICE'),
      noCatSys: state.skuMap.get('S-NOCAT')?.systemQty,
      barcodeToSku: state.barcodeMap.get('B-M24'),
      multiplier: (state.skuMap.get('S-MULTI').barcodes.find((b) => b.barcode === 'B-M24') || {}).unitMultiplier,
    }));

    expect(parsed.norm.unitPrice).toBe(50);          // R05 col B of the smallest-unit barcode
    expect(parsed.normBox.unitPrice).toBe(1500);     // per-barcode price kept alongside the multiplier
    expect(parsed.norm.systemQty).toBe(10);          // R01 col G
    expect(parsed.pricey.unitPrice).toBe(1500);
    expect(parsed.noPrice.unitPrice).toBeNull();     // blank price → null → must scan one by one
    expect(parsed.neg.systemQty).toBe(-3);           // raw col G — negatives are no longer clamped (Aug 2026 r2)
    expect(parsed.neg.negSys).toBeFalsy();           // the forced-audit flag is gone; the formula decides instead
    expect(parsed.delItem.isDel).toBe(true);         // in R01 but not in Product Branch Master
    expect(parsed.delItem.unitPrice).toBe(40);       // DEL still gets a price from R05
    expect(parsed.catA.isDel).toBe(false);           // Col D = 'A' stays in the catalog
    expect(parsed.catP.isDel).toBe(true);            // Col D = 'P' dropped from PBM → DEL
    expect(parsed.catD.isDel).toBe(true);            // Col D = 'D' dropped from PBM → DEL
    expect(parsed.catP.isP).toBeUndefined();         // the cat/isP concept is gone
    expect(parsed.reviewInPm).toBe(true);            // Col D = 'REVIEW' no longer dropped (ส.ค. 2026 round 2)
    expect(parsed.review.isDel).toBe(false);         // full parity with A/B/C — not DEL
    expect(parsed.review.productName).toBe('Test Review Row'); // name from PBM, not R01
    expect(parsed.barcodeToSku).toBe('S-MULTI');     // R05 col A → col E
    expect(parsed.multiplier).toBe(24);              // R05 col H

    // Col D is kept as `cat`, for A/B/C/REVIEW — {branch}_pm shares the 1 MiB ceiling with global_r05
    expect(parsed.catOnA).toBe('A');
    expect(parsed.catOnReview).toBe('REVIEW');
    expect(parsed.catOnBlank).toBeUndefined();

    // Total SKU / Progress set (ส.ค. 2026): G ≠ 0 OR Col D ∈ A/B/C/REVIEW — this clause only ever adds
    expect(parsed.countableCount).toBe(F.COUNTABLE_COUNT);
    expect(parsed.countableAbcZero).toBe(true);      // A/B/C ที่ระบบขึ้น 0 → ต้องเดินไปนับ (กติกาที่เพิ่มมา)
    expect(parsed.countableReviewZero).toBe(true);   // REVIEW ที่ระบบขึ้น 0 → ได้สิทธิ์เดียวกับ A/B/C
    expect(parsed.countableZero).toBe(true);         // S-ZERO ก็จัดชั้น A → G=0 ไม่ตัดออกอีกแล้ว
    expect(parsed.countableNeg).toBe(true);          // G ติดลบ → นับตามเดิม
    expect(parsed.countableNoCat).toBe(true);        // Col D ว่างแต่มีสต็อก → ยังนับตามกติกาเดิม
    expect(parsed.countableNoCatZero).toBe(false);   // Col D ว่าง + ไม่มีสต็อก = เคสเดียวที่หลุด
    expect(parsed.countableCatP).toBe(true);         // Col D = P ถูกกรองออกจาก PBM แต่มีสต็อก → ยังนับ
    expect(parsed.countableDel).toBe(true);          // ไม่มีใน PBM แต่มีสต็อก → ยังนับ
    expect(parsed.countablePmOnly).toBe(false);      // จัดชั้น A แต่ไม่มีแถวใน R01 → ไม่นับ
    // ธง nc แยก 2 ชนิดตอน parse (ก.ย. 2026) — คอลัมน์ P ถูกยุบเหลือแค่ตัวเลขนี้ก่อนขึ้น cloud
    expect(parsed.ncFlagOffice).toBe(1);             // หมวด 11. → ตัดเด็ดขาด
    expect(parsed.ncFlagDelCat).toBe(2);             // หมวด DELETE → มีของถึงนับ
    expect(parsed.ncFlagNormal).toBeUndefined();     // หมวดปกติไม่มีธงเลย (ประหยัดพื้นที่ doc)

    expect(parsed.countableOffice).toBe(false);      // nc:1 — Col D = A และมีสต็อก 7 ก็ยังไม่นับ
    // nc:2 ตัดสินด้วยยอดอย่างเดียว
    expect(parsed.countableDelCat).toBe(true);       // มีสต็อก → นับ
    expect(parsed.countableDelCatZero).toBe(false);  // ยอด 0 + ไม่มีใน PBM → ไม่นับ
    expect(parsed.countableDelCatNeg).toBe(true);    // ยอดติดลบ (ค้างส่งลูกค้า) → ต้องนับ
    expect(parsed.countableDelCatAbc0).toBe(false);  // ★ DELETE + จัดชั้น B + ยอด 0 → ชั้น B ดึงเข้าไม่ได้
    expect(parsed.countableAbcZero).toBe(true);      // ★ คู่เทียบ: หมวดปกติ จัดชั้น B ยอด 0 ยังนับ
    expect(parsed.delCatAbc0InPm).toBe(true);        // อยู่ใน catalog ปกติ ตัดเฉพาะจาก Progress
    expect(parsed.delCatNegIsDel).toBe(true);        // ไม่อยู่ใน PBM → ยังติดแท็ก DEL ตามเดิม
    // ทุกตัวที่หลุดจาก Progress ต้องยังอยู่ในระบบครบ — สแกนได้ Confirm ได้ผลถูก
    expect(parsed.officeInR01).toBe(true);           // ไม่ได้ถูกข้ามตอน parse
    expect(parsed.officeSys).toBe(7);
    expect(parsed.noCatSys).toBe(5);

    // uploads push to the cloud master docs the other devices restore from
    await waitForDoc(PROJECT_ID, 'stock_sessions/SRC_pm', (d) => d && JSON.parse(d.data_json).length === F.pmRows.length);
    // cat_coded is a console-only marker for "this branch's file was re-uploaded with Col D"
    expect((await getDoc(PROJECT_ID, 'stock_sessions/SRC_pm')).cat_coded).toBe(true);
    // ...and must NOT write the legacy shared doc (kept read-only on cloud purely for rollback)
    expect(await getDoc(PROJECT_ID, 'stock_sessions/global_pm')).toBeNull();
    await waitForDoc(PROJECT_ID, 'stock_sessions/SRC_r01', (d) => d && d.data_json && JSON.parse(d.data_json).length === F.r01Rows.length);
    await waitForDoc(PROJECT_ID, 'stock_sessions/global_r05', (d) => d && JSON.parse(d.data_json).length === F.r05Rows.length);

    await closeApp(app);
  });

  test('R01 upload on a pharmacy branch clears R16 and sets a new baseline', async ({ browser }) => {
    const app = await bootFreshCount(browser, { role: 'pharmacist', user: 'Pharm', mode: 'desktop' });
    await app.page.evaluate(() => {
      state.r16Loaded = true;
      state.r16DetailVersion = 'R16-OLD';
      state.r16SalesMap.set('S-NORM', 5);
    });

    await app.page.setInputFiles('#fileR01', csv('r01.csv', F.toR01Csv()));
    await app.page.waitForFunction(() => state.r16Loaded === false, null, { timeout: 15000, polling: 100 });

    const after = await app.page.evaluate(() => ({
      baseline: _r01BaselineAt,
      sales: state.r16SalesMap.size,
      version: state.r01Version,
    }));
    expect(after.baseline).toBeTruthy();   // pharmacy baseline stamped
    expect(after.sales).toBe(0);           // yesterday's R16 cleared — must re-upload before Confirm
    expect(after.version).toBeTruthy();

    await closeApp(app);
  });

  // การ์ด R05.106 โชว์ "อัปโหลดล่าสุด" ให้ admin ตรวจได้ว่าบอท auto-r05 ทำงานเมื่อไร (ก.ย. 2026)
  // เวลามาจาก field updated_at ของ global_r05 ซึ่งทั้งหน้าเว็บและบอทเขียนอยู่แล้ว ไม่มี field ใหม่
  //
  // ⚠️ กับดักที่เทสนี้มีไว้จับ: _setR05Ts ต้องถูกเรียก **ก่อน** echo guard ใน startR05Listener
  // snapshot แรกหลัง login มี data_json ตรงกับที่ restoreMasterFromFirestore เพิ่งใส่ใน
  // _lastAppliedR05Json แล้ว listener จึง return ตรงนั้นทุกครั้ง — ย้ายไปตั้งทีหลังเมื่อไร
  // การ์ดจะว่างจนกว่าจะมีคนอัปไฟล์ใหม่จริงๆ ซึ่งเป็นอาการที่ไม่มีใครสังเกตเห็น
  //
  // เช็ค textContent ไม่ใช่ toBeVisible() เพราะ #r05UploadSection ถูกซ่อนไว้จนกว่าจะเข้า Admin Mode
  // (ตั้งใจ — การ์ดนี้มีไว้ให้ admin) ตัว _setR05Ts คุมแค่ display ของ element ตัวเอง
  test('การ์ด R05.106 ได้เวลาอัปโหลดล่าสุดตั้งแต่ login โดยไม่ต้องรอให้ใครอัปไฟล์', async ({ browser }) => {
    const app = await bootFreshCount(browser, { role: 'pharmacist', user: 'Pharm', mode: 'desktop' });

    // seedMasters เขียน updated_at = 2026-09-09T02:30:00Z ให้ global_r05 (09:30 น. เวลาไทย)
    await app.page.waitForFunction(
      () => (document.getElementById('r05Timestamp')?.textContent || '').includes('อัปโหลดล่าสุด'),
      undefined, { polling: 100 },
    );
    const card = await app.page.evaluate(() => {
      const el = document.getElementById('r05Timestamp');
      return { text: el.textContent, hidden: el.style.display === 'none' };
    });
    expect(card.hidden).toBe(false);
    // formatThaiDateTime = "HH:MM น. DD/MM/YYYY" — ตรึงรูปแบบให้ตรงกับการ์ด R01.102
    expect(card.text).toMatch(/^อัปโหลดล่าสุด: \d{2}:\d{2} น\. \d{2}\/\d{2}\/\d{4}$/);
    expect(card.text).toContain('09/09/2026');

    // อัปไฟล์ใหม่แล้วเวลาต้องขยับเป็นตอนนี้ ไม่ใช่ค้างที่ค่าจาก seed
    await app.page.setInputFiles('#fileR05', csv('r05.csv', F.toR05Csv()));
    await app.page.waitForFunction(
      (old) => (document.getElementById('r05Timestamp')?.textContent || '') !== old,
      card.text, { polling: 100 },
    );
    const afterUpload = await app.page.evaluate(() => document.getElementById('r05Timestamp').textContent);
    expect(afterUpload).toMatch(/^อัปโหลดล่าสุด: \d{2}:\d{2} น\. \d{2}\/\d{2}\/\d{4}$/);

    await closeApp(app);
  });
});
