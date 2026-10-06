/*
 * convert-legacy-pharmacy-audits.js — แปลง "Audit ค้าง" ของสาขายาเป็น Stock Adj ตรง (ใช้ครั้งเดียวต่อสาขา)
 *
 * ที่มา (ต.ค. 2026 · ผู้ใช้สั่ง): ตั้งแต่ 29 ก.ย. 2026 (ab95bf0) Confirm รอบแรกของสาขายาไม่ผ่าน Audit แล้ว — นับไม่ตรง = Stock Adj ทันที
 *   แต่ Audit ที่ค้างอยู่ก่อนสลับยังเป็นสถานะ audit (SRC 135 รายการ ณ 5 ต.ค.) → หน้าจอเภสัชยังเป็นโหมด Audit
 *   ผู้ใช้เลือก "แปลงเป็น Stock Adj เลย ไม่ต้องรีเช็ค" โดยรับความเสี่ยงแล้วว่า Audit ที่เกิดจาก R16/R01 คลาดเวลา
 *   หรือบั๊ก OTFI ของ SRC (แก้ 29 ก.ย.) จะกลายเป็นใบปรับสต็อกผิดเข้า ERP
 *
 * ผลของการแปลง: รายการเป็น Stock Adj ตรงแบบเดียวกับที่ Confirm สร้าง (directAdj:true + แช่ effectiveQty/systemQty)
 *   ใช้ตัวเลข "ตอน Confirm เดิม" จาก marker เภสัช (effectiveQty = นับ + R16 ชดเชย · systemQty = ยอดระบบตอนนั้น)
 *   → ใบ 📦 ปรับปรุงสินค้าคิด effectiveQty − systemQty ผ่าน _directAdjPair (สูตรเดียวกับ Stock Adj ตรงทุกตัว)
 *   → ↺ สแกนใหม่ ยังใช้ได้เหมือน Stock Adj ตรงทั่วไป
 *   ⏩ 6 ต.ค. 2026 (รอบ 3): ใบ 📦 นับรอรีเช็ค (audit) ด้วยเลขตอน Confirm เดียวกันอยู่แล้ว (PHARMACY_AUDIT_IN_ADJUST_DOC) —
 *      การแปลงจึง "ปิดงานรอรีเช็ค" (ตัวเลขในใบไม่เปลี่ยน) ไม่ใช่ตัวที่ทำให้รายการเข้าใบ · ไม่จำเป็นต้องรันถ้าไม่ต้องการล้างคิวรอรีเช็ค
 *
 * ⚠️ ต้องรันบนหน้าเว็บรุ่นที่ marker พาธง directAdj แล้ว (มี _isDirectAdjMarker) และทุกเครื่องควรรีโหลดแล้ว
 *    เครื่องรุ่นเก่ายังเห็นผลถูกเพราะ item doc พาธงไปด้วย แต่ไม่มีด่านกันการดันกลับ (R1 ใน _writePharmacyAuditMarkers)
 *
 * วิธีใช้ (Desktop · login รหัสเภสัช ของสาขาที่จะแปลง · นอกเวลานับ ไม่มีใครรีเช็ค/อัป R16 อยู่):
 *   F12 → Console → วางไฟล์นี้ทั้งไฟล์ → Enter
 *     await convertLegacyAudits()                   ← ตรวจอย่างเดียว ไม่เขียน (dry-run)
 *     await convertLegacyAudits({dryRun:false})     ← แปลงจริง (พิมพ์ยืนยัน + ดาวน์โหลดสำรองก่อน)
 *     await undoConvertLegacyAudits()               ← ดูรายการที่ย้อนได้
 *     await undoConvertLegacyAudits({dryRun:false}) ← ย้อนกลับเป็น "รอรีเช็ค" — ⛔ ใช้ก่อน Export ใบ 📦 ส่งเข้า ERP เท่านั้น
 *
 * เกณฑ์ "แปลงได้" (ต้องครบทุกข้อ — ข้อมูลจาก server ไม่ใช่หน้าเว็บ):
 *   marker รอบนี้ status audit · ไม่มีผู้ยืนยัน · ไม่ใช่รายการที่เภสัชกด ↺ (reopenedAt)
 *   · ยังไม่มีใครรีเช็ค (recheckQty ว่างทั้ง marker/item · ไม่มีธงค้างส่ง)
 *   · item doc (ถ้ามี) เป็น audit ไม่มีผู้ยืนยัน · marker มี effectiveQty/systemQty เป็นตัวเลข และไม่เท่ากัน · SKU อยู่ใน skuMap
 *   ไม่เข้าเกณฑ์ = ข้ามแล้วรายงานแยกกลุ่ม (ยังเป็นรอรีเช็คให้เภสัชทำต่อ)
 *
 * Safety properties:
 * - dry-run เป็นค่าเริ่มต้น · แปลงจริงต้องพิมพ์ข้อความยืนยัน · ดาวน์โหลด JSON ของ marker doc + item docs ก่อนเขียน
 * - ถือ branch confirm lock ตลอด (PDA ออนไลน์หยุดสแกน/กรอก · Desktop อื่นกด Confirm/ยืนยันรีเช็คไม่ได้) · ปลดใน finally
 * - หลังได้ lock รอ 3.8 วิ แล้วอ่าน server ซ้ำ: รอบ/marker/rev ของทุกรายการต้องเหมือนตอนสำรวจ ไม่งั้นยกเลิกทั้งชุด (all-or-none)
 * - เขียน marker ก่อน (authoritative) → apply ในเครื่อง → ตรวจว่าทุกรายการกลายเป็น Stock Adj ตรงจริง → เขียน item docs
 *
 * ค่าใช้จ่าย Firestore: อ่าน ≈ (audit ทั้งหมด + 2 doc) × 2 · เขียน marker 1 + item ต่อรายการ + audit log 1
 */
(() => {
'use strict';
const SWITCH_AT_MS = Date.parse('2026-09-29T19:40:00+07:00'); // ab95bf0 — Confirm หลังจากนี้ไม่ควรสร้าง audit แล้ว
const LOCK_SETTLE_MS = 3800;                                   // เท่ากับ Confirm — ให้ PDA ที่เพิ่งเห็น lock flush ยอดค้างขึ้นมาก่อน

const pad = n => String(n).padStart(2, '0');
const fmtLocal = v => { const ms = tsMs(v); if (!Number.isFinite(ms)) return v ? String(v) : '—'; const d = new Date(ms); return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const tsMs = v => (v == null || v === '') ? NaN : Date.parse(String(v).replace(' ', 'T'));
const num = v => (v === null || v === undefined || v === '') ? NaN : Number(v);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const bySku = (a, b) => a.sku.localeCompare(b.sku, 'en', { numeric: true });

function serialize(v) {
  if (v === null || v === undefined) return v;
  if (typeof v.toDate === 'function') return { __ts__: v.toDate().toISOString() };
  if (Array.isArray(v)) return v.map(serialize);
  if (typeof v === 'object') { const o = {}; for (const k of Object.keys(v)) o[k] = serialize(v[k]); return o; }
  return v;
}
function download(name, data) {
  const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function guard() {
  if (typeof _db === 'undefined' || !_db || !currentBranch) throw new Error('ยังไม่ได้ login');
  if (typeof _isDirectAdjMarker !== 'function') throw new Error('หน้าเว็บนี้ยังเป็นรุ่นเก่า (ไม่มี _isDirectAdjMarker) — กด Ctrl+F5 แล้ว login ใหม่ก่อน');
  if (!_isPharmacyBranch()) throw new Error('ใช้ได้เฉพาะสาขายา (SRC/KKL/SSS)');
  if (currentRole !== 'pharmacist') throw new Error('ต้อง login ด้วยรหัสเภสัช');
  if (_isPdaApp()) throw new Error('ต้องรันบน Desktop เท่านั้น');
  if (!navigator.onLine) throw new Error('ต้องออนไลน์');
  if (_adminMode) throw new Error('ออกจาก Admin Mode ก่อน (โหมดนี้หยุด listener)');
  if (_branchConfirming) throw new Error('เครื่องนี้มีงาน Confirm/ยืนยันค้างอยู่ — รอให้เสร็จก่อน');
  if (!_isScanSchemaV2()) throw new Error('สาขานี้ไม่ใช่ schema v2');
}

// อ่านสถานะจาก server ทั้งหมด (ไม่เชื่อหน้าเว็บ): รอบ · marker doc · items ที่เป็น audit + item ของ SKU ที่ marker บอกว่า audit
async function readServer(branch) {
  const sess = await _db.collection('stock_sessions').doc(branch).get({ source: 'server' });
  if (!sess.exists) throw new Error(`ไม่มี session doc ของ ${branch}`);
  const raw = sess.data() || {};
  if (Number(raw.schemaVersion) !== 2) throw new Error(`schemaVersion ${raw.schemaVersion} ไม่ใช่ 2`);
  const epoch = (raw.session_data_json ? JSON.parse(raw.session_data_json) : {}).countResetAt || '';
  if (!epoch) throw new Error('session ไม่มี countResetAt — หยุดเพื่อความปลอดภัย');
  if (epoch !== (_countResetAt || '')) throw new Error('รอบบน server ไม่ตรงกับหน้านี้ — รีโหลดหน้าก่อน');
  const mSnap = await getPharmacyAuditMarkerRef(branch).get({ source: 'server' });
  const markerDoc = mSnap.exists ? (mSnap.data() || {}) : {};
  const markers = (markerDoc.countResetAt || '') === epoch ? (markerDoc.items || {}) : {};
  const items = {}; const revs = {};
  const snap = await getScanItemsRef(branch).where('countResetAt', '==', epoch).where('status', '==', 'audit').get({ source: 'server' });
  snap.forEach(d => { items[d.id] = d.data() || {}; revs[d.id] = Number(d.data()?.rev) || 0; });
  // marker บอก audit แต่ query ไม่เจอ (ไม่มี item doc / item เป็นสถานะอื่น) → อ่านตาม id ให้รู้แน่
  for (const sku of Object.keys(markers)) {
    if (markers[sku]?.status !== 'audit' || items[sku]) continue;
    const d = await getScanItemsRef(branch).doc(sku).get({ source: 'server' });
    if (d.exists && (d.data()?.countResetAt || '') === epoch) { items[sku] = d.data() || {}; revs[sku] = Number(d.data()?.rev) || 0; }
  }
  return { epoch, markerDoc, markers, items, revs };
}

// ── แปลง Audit ค้าง → Stock Adj ตรง ──────────────────────────────────────────
function classifyConvert(sku, srv) {
  const m = srv.markers[sku]; const it = srv.items[sku]; const si = state.skuMap.get(sku);
  const eff = num(m?.effectiveQty), sys = num(m?.systemQty);
  const base = { sku, name: si?.productName || '', counted: num(m?.countedQty ?? it?.countedQty), eff, sys,
    origAt: m?.countConfirmedAt || m?.confirmedAt || '', by: m?.confirmedBy || '', rev: srv.revs[sku] ?? null, markerAt: m?.countConfirmedAt || m?.confirmedAt || '' };
  const skip = why => ({ ...base, ok: false, why });
  if (!m || m.status !== 'audit') return skip('ไม่มี marker รอรีเช็คของรอบนี้');
  if (m.auditor) return skip('ยืนยันแล้ว');
  if (m.reopenedAt) return skip('เภสัชกด ↺ มา — ให้รีเช็คต่อ');
  if (m.recheckQty != null || it?.recheckQty != null || m.backorder || it?.backorder) return skip('มียอดรีเช็คแล้ว — ให้เภสัชกดยืนยันรีเช็ค');
  if (it && (it.status !== 'audit' || it.auditor)) return skip('สถานะในรายการไม่ตรงกับ marker');
  if (!Number.isFinite(eff) || !Number.isFinite(sys)) return skip('ไม่มีตัวเลขตอน Confirm');
  if (eff === sys) return skip('ตัวเลขตรงกัน (diff 0) — อาจเป็นฐาน clamp เก่า');
  if (!si) return skip('ไม่รู้จัก SKU (R01/R05 ยังไม่โหลด)');
  return { ...base, ok: true, why: '' };
}
function auditSkus(srv) {
  const s = new Set(Object.keys(srv.items));
  for (const [sku, m] of Object.entries(srv.markers)) if (m?.status === 'audit') s.add(sku);
  return [...s];
}
const convertRow = c => ({
  SKU: c.sku, ชื่อ: c.name, นับได้: Number.isFinite(c.counted) ? c.counted : '—', 'นับ+R16': c.eff, ระบบตอนConfirm: c.sys,
  ส่วนต่าง: c.eff - c.sys, ใบ: c.eff < c.sys ? 'ORDS (ขาด)' : 'IRPS (เกิน)', Confirmเมื่อ: fmtLocal(c.origAt), Confirmโดย: c.by,
  หลังตัดAudit: Number.isFinite(tsMs(c.origAt)) && tsMs(c.origAt) >= SWITCH_AT_MS ? '⚠️ ใช่' : '',
});

// ทำงานที่เขียนจริงภายใต้ lock — ใช้ร่วมกันระหว่างแปลงและย้อน
async function underLock(label, revalidate, buildMarkers, expectLocal) {
  _branchConfirming = true; updateConfirmBtn(); updatePharmacistAuditConfirmBtn();
  let token = '';
  try {
    console.log(`[${label}] กำลังล็อกสาขาและพักการสแกนทุกเครื่อง...`);
    token = await _acquireBranchConfirmLock();
    await sleep(LOCK_SETTLE_MS);
    const skus = await revalidate();          // throw = ยกเลิกทั้งชุด
    const markers = buildMarkers(new Date().toISOString());
    console.log(`[${label}] บันทึก marker กลาง ${markers.length} รายการ...`);
    await _writePharmacyAuditMarkers(markers);
    _cancelPendingSave(); clearTimeout(_firestoreSyncTimer); _firestoreSyncTimer = null;
    const changed = _applyPharmacyAuditMarkersToState();
    const bad = skus.filter(sku => !expectLocal(state.scanData.get(sku)));
    if (bad.length) throw new Error(`apply ในเครื่องไม่ครบ ${bad.length} รายการ (${bad.slice(0, 10).join(', ')}) — marker ถูกเขียนแล้ว ให้รีโหลดหน้าแล้วตรวจซ้ำด้วย dry-run`);
    console.log(`[${label}] บันทึกรายการขึ้น Cloud...`);
    try { await _writeConfirmedItems(skus); }
    catch (e) { throw new Error(`marker เขียนแล้ว (ผลมีผลกับทุกเครื่องแล้ว) แต่เขียนรายการขึ้น Cloud ไม่ครบ: ${e.code || e.message} — รีโหลดหน้า ระบบจะดันรายการที่ค้างขึ้นเองภายใน 1 นาที แล้วรัน dry-run ตรวจ`); }
    const synced = await syncToFirestore();
    saveAuditLogToFirestore();
    _renderPharmacyAuditMarkerChanges(changed);
    updateAuditVerifyCount(); renderAuditVerifyTable(); updatePharmacistAuditConfirmBtn();
    return { skus, synced };
  } finally {
    if (token) { const released = await _releaseBranchConfirmLock(token); if (released && _branchConfirmLockData?.token === token) _setBranchScanPaused(false, null); }
    _branchConfirming = false; updateConfirmBtn(); updatePharmacistAuditConfirmBtn();
  }
}

window.convertLegacyAudits = async function convertLegacyAudits(opts = {}) {
  const dryRun = opts.dryRun !== false;
  guard();
  const branch = currentBranch;
  const srv = await readServer(branch);
  console.log(`%c[แปลง Audit ค้าง] สาขา ${branch} · ${dryRun ? 'DRY-RUN (ไม่เขียน)' : 'แปลงจริง'}`, 'font-weight:bold');
  const all = auditSkus(srv).map(sku => classifyConvert(sku, srv)).sort(bySku);
  const cands = all.filter(c => c.ok); const skipped = all.filter(c => !c.ok);
  const skipGroups = {}; for (const s of skipped) (skipGroups[s.why] ||= []).push(s.sku);
  const ords = cands.filter(c => c.eff < c.sys), irps = cands.filter(c => c.eff > c.sys);
  // ตัวชี้ "ยังมีเครื่องสร้าง Audit ใหม่อยู่" — ดูทุกรายการรอรีเช็คที่ไม่ใช่ ↺ (ไม่ใช่เฉพาะตัวที่แปลงได้)
  const late = all.filter(c => !srv.markers[c.sku]?.reopenedAt && Number.isFinite(tsMs(c.origAt)) && tsMs(c.origAt) >= SWITCH_AT_MS);
  console.log(`รอรีเช็คทั้งหมด ${all.length} · แปลงได้ ${cands.length} (ORDS ขาด ${ords.length} รายการ ${ords.reduce((a, c) => a + c.sys - c.eff, 0)} หน่วย · IRPS เกิน ${irps.length} รายการ ${irps.reduce((a, c) => a + c.eff - c.sys, 0)} หน่วย) · ข้าม ${skipped.length}`);
  if (cands.length) console.table(cands.map(convertRow));
  for (const [why, skus] of Object.entries(skipGroups)) console.log(`ข้าม — ${why}: ${skus.length} รายการ`, skus.join(', '));
  if (late.length) console.warn(`⚠️ ${late.length} รายการ (${late.map(c => c.sku).join(', ')}) Confirm หลัง 29 ก.ย. 19:40 (ไม่ใช่ ↺) — มาจากเครื่องที่ยังรันโค้ดเก่า หรือการอัป R16 ซ้ำ · ถ้าเป็นเครื่องโค้ดเก่า ให้รีโหลดเครื่องนั้นก่อน ไม่งั้น Audit ใหม่จะเกิดต่อ`);
  const report = { branch, epoch: srv.epoch, total: all.length, convert: cands.length, skus: cands.map(c => c.sku), skipped: skipGroups,
    ords: ords.length, irps: irps.length, afterSwitch: late.map(c => c.sku), rows: cands.map(convertRow) };
  window.convertLegacyAuditsReport = report;
  if (dryRun || !cands.length) {
    console.log(dryRun ? 'DRY-RUN จบ — ยังไม่ได้เขียนอะไร · ทบทวนรายการแล้วรัน  await convertLegacyAudits({dryRun:false})' : 'ไม่มีรายการให้แปลง');
    if (dryRun) console.log('คัดลอกผลเป็นข้อความ:  copy(JSON.stringify(convertLegacyAuditsReport, null, 1))');
    return report;
  }

  const phrase = `แปลง ${branch} ${cands.length}`;
  const typed = prompt(`🔒 จะแปลง Audit ค้าง ${cands.length} รายการของสาขา ${branch} เป็น Stock Adj (ปิดงานรอรีเช็ค · ใบ 📦 ใช้ตัวเลขตอน Confirm เดิมอยู่แล้ว ไม่เปลี่ยน)\nORDS ${ords.length} · IRPS ${irps.length} · ข้าม ${skipped.length}\n(จะดาวน์โหลดสำเนาก่อนเขียน)\n\nพิมพ์  ${phrase}  เพื่อยืนยัน:`);
  if (typed !== phrase) { console.warn('ยกเลิก — ข้อความยืนยันไม่ตรง'); return report; }
  download(`convert-legacy-audits-${branch}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
    { branch, epoch: srv.epoch, exportedAt: new Date().toISOString(), skus: cands.map(c => c.sku), markerDoc: serialize(srv.markerDoc),
      items: Object.fromEntries(cands.map(c => [c.sku, serialize(srv.items[c.sku] ?? null)])) });
  await sleep(800);

  const first = new Map(cands.map(c => [c.sku, c]));
  const res = await underLock('แปลง Audit ค้าง', async () => {
    const again = await readServer(branch);
    if (again.epoch !== srv.epoch) throw new Error('รอบบน server เปลี่ยนระหว่างทำ — ยกเลิก (ยังไม่ได้เขียนอะไร)');
    for (const c of cands) {
      const n = classifyConvert(c.sku, again);
      if (!n.ok || n.rev !== c.rev || n.markerAt !== c.markerAt || n.eff !== c.eff || n.sys !== c.sys)
        throw new Error(`${c.sku} เปลี่ยนระหว่างทำ (${n.why || `rev ${c.rev}→${n.rev} · marker ${c.markerAt}→${n.markerAt} · ตัวเลข ${c.eff}/${c.sys}→${n.eff}/${n.sys}`}) — ยกเลิกทั้งชุด ยังไม่ได้เขียนอะไร · รัน dry-run ใหม่`);
    }
    return cands.map(c => c.sku);
  }, at => cands.map(c => ({ sku: c.sku, status: 'stock_adjustment', auditStatus: 'stock_adjustment', initialStatus: 'stock_adjustment',
    auditor: '', directAdj: true, effectiveQty: first.get(c.sku).eff, systemQty: first.get(c.sku).sys,
    // countConfirmedAt ต้องใหม่กว่าของเดิม — ลำดับ marker non-final ตัดสินด้วยค่านี้ (ไม่งั้น backfill จากเครื่องค้างชนะ)
    countConfirmedAt: at, confirmedAt: at, confirmedBy: currentUser || '',
    convertedFromAuditAt: at, convertedBy: currentUser || '', origCountConfirmedAt: c.origAt || '' })),
  sd => !!sd && sd.status === 'stock_adjustment' && sd.directAdj === true && !sd.auditor && typeof _directAdjPair === 'function' && !!_directAdjPair(sd));
  Object.assign(report, { dryRun: false, converted: res.skus.length, synced: res.synced });
  console.log(`%c[แปลง Audit ค้าง] เสร็จ — แปลง ${res.skus.length} รายการเป็น Stock Adj${res.synced ? '' : ' · ⚠️ sync session ไม่สำเร็จ (รายการ/marker เขียนแล้ว) รีโหลดหน้าแล้วตรวจ'}`, 'font-weight:bold');
  console.log('ขั้นต่อไป: ตรวจ 📦 ปรับปรุงสินค้า + แท็บ Stock Adj · ให้ทุกเครื่องรีโหลด/ปิด-เปิดแอป · รัน dry-run ซ้ำ ต้องเหลือเฉพาะกลุ่มที่ข้าม');
  return report;
};

// ── ย้อนการแปลง → กลับเป็น "รอรีเช็ค" (เฉพาะก่อน Export ใบ 📦 ส่งเข้า ERP) ────────────────
function classifyUndo(sku, srv) {
  const m = srv.markers[sku]; const it = srv.itemsAll?.[sku];
  const base = { sku, name: state.skuMap.get(sku)?.productName || '', eff: num(m?.effectiveQty), sys: num(m?.systemQty),
    convertedAt: m?.convertedFromAuditAt || '', rev: srv.revsAll?.[sku] ?? null, markerAt: m?.countConfirmedAt || m?.confirmedAt || '' };
  if (!_isDirectAdjMarker(m) || !m.convertedFromAuditAt) return { ...base, ok: false, why: 'ไม่ใช่ผลแปลง' };
  if (it && (it.status !== 'stock_adjustment' || it.auditor)) return { ...base, ok: false, why: 'รายการเปลี่ยนไปแล้ว (↺/ยืนยันแล้ว)' };
  return { ...base, ok: true, why: '' };
}
async function readServerForUndo(branch) {
  const srv = await readServer(branch);
  srv.itemsAll = {}; srv.revsAll = {};
  for (const [sku, m] of Object.entries(srv.markers)) {
    if (!_isDirectAdjMarker(m) || !m.convertedFromAuditAt) continue;
    const d = await getScanItemsRef(branch).doc(sku).get({ source: 'server' });
    if (d.exists && (d.data()?.countResetAt || '') === srv.epoch) { srv.itemsAll[sku] = d.data() || {}; srv.revsAll[sku] = Number(d.data()?.rev) || 0; }
  }
  return srv;
}

window.undoConvertLegacyAudits = async function undoConvertLegacyAudits(opts = {}) {
  const dryRun = opts.dryRun !== false;
  guard();
  const branch = currentBranch;
  const srv = await readServerForUndo(branch);
  console.log(`%c[ย้อนการแปลง] สาขา ${branch} · ${dryRun ? 'DRY-RUN (ไม่เขียน)' : 'ย้อนจริง'}`, 'font-weight:bold');
  console.warn('⛔ ใช้ได้ก่อน Export ใบ 📦 ปรับปรุงสินค้าส่งเข้า ERP เท่านั้น — ระบบไม่มีตัวกันส่งซ้ำ ถ้าส่งไปแล้วย้อนจะทำให้ปรับซ้ำ');
  const all = Object.keys(srv.markers).map(sku => classifyUndo(sku, srv)).filter(c => c.ok || c.why !== 'ไม่ใช่ผลแปลง').sort(bySku);
  const cands = all.filter(c => c.ok); const skipped = all.filter(c => !c.ok);
  console.log(`ผลแปลงที่ย้อนได้ ${cands.length} · ข้าม ${skipped.length}`);
  if (cands.length) console.table(cands.map(c => ({ SKU: c.sku, ชื่อ: c.name, 'นับ+R16': c.eff, ระบบตอนConfirm: c.sys, แปลงเมื่อ: fmtLocal(c.convertedAt) })));
  if (skipped.length) console.log('ข้าม:', skipped.map(s => `${s.sku} (${s.why})`).join(', '));
  const report = { branch, epoch: srv.epoch, undo: cands.length, skus: cands.map(c => c.sku), skipped: skipped.map(s => s.sku) };
  window.undoConvertLegacyAuditsReport = report;
  if (dryRun || !cands.length) {
    console.log(dryRun ? 'DRY-RUN จบ — ยังไม่ได้เขียนอะไร · ย้อนจริง:  await undoConvertLegacyAudits({dryRun:false})' : 'ไม่มีรายการให้ย้อน');
    return report;
  }
  const phrase = `ย้อน ${branch} ${cands.length}`;
  const typed = prompt(`🔒 จะย้อน ${cands.length} รายการของสาขา ${branch} กลับเป็น "รอรีเช็ค" (ยังอยู่ในใบ 📦 ด้วยตัวเลขเดิม แต่มีป้ายรอรีเช็ค)\n⛔ ถ้า Export ใบส่งเข้า ERP ไปแล้ว ห้ามย้อน\n\nพิมพ์  ${phrase}  เพื่อยืนยัน:`);
  if (typed !== phrase) { console.warn('ยกเลิก — ข้อความยืนยันไม่ตรง'); return report; }
  download(`undo-convert-legacy-audits-${branch}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
    { branch, epoch: srv.epoch, exportedAt: new Date().toISOString(), skus: cands.map(c => c.sku), markerDoc: serialize(srv.markerDoc),
      items: Object.fromEntries(cands.map(c => [c.sku, serialize(srv.itemsAll[c.sku] ?? null)])) });
  await sleep(800);

  const res = await underLock('ย้อนการแปลง', async () => {
    const again = await readServerForUndo(branch);
    if (again.epoch !== srv.epoch) throw new Error('รอบบน server เปลี่ยนระหว่างทำ — ยกเลิก (ยังไม่ได้เขียนอะไร)');
    for (const c of cands) {
      const n = classifyUndo(c.sku, again);
      if (!n.ok || n.rev !== c.rev || n.markerAt !== c.markerAt) throw new Error(`${c.sku} เปลี่ยนระหว่างทำ — ยกเลิกทั้งชุด ยังไม่ได้เขียนอะไร`);
    }
    return cands.map(c => c.sku);
  }, at => cands.map(c => ({ sku: c.sku, status: 'audit', auditStatus: 'pending', initialStatus: 'audit', auditor: '',
    // directAdj:false ล้างธงใน marker (merge) · convertUndoneAt = ใบผ่านด่าน R1 · effectiveQty/systemQty เดิมคงอยู่จาก merge
    directAdj: false, convertUndoneAt: at, countConfirmedAt: at, confirmedAt: at, confirmedBy: currentUser || '' })),
  sd => !!sd && sd.status === 'audit' && sd.directAdj !== true && !sd.auditor);
  Object.assign(report, { dryRun: false, undone: res.skus.length, synced: res.synced });
  console.log(`%c[ย้อนการแปลง] เสร็จ — ${res.skus.length} รายการกลับเป็นรอรีเช็ค`, 'font-weight:bold');
  return report;
};

console.log('พร้อมแล้ว — await convertLegacyAudits()  ·  await undoConvertLegacyAudits()   (ค่าเริ่มต้นคือตรวจอย่างเดียว)');
})();
