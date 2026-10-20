/*
 * reset-legacy-pharmacy-audits.js — ล้าง "รอรีเช็ค" เก่าของสาขายาที่ "ไม่ติดลบ" ให้กลับเป็น ⏳ ยังไม่ได้นับ (ใช้ครั้งเดียวต่อสาขา)
 *
 * ที่มา (19 ต.ค. 2026 · ผู้ใช้สั่ง): แท็บแรกของป็อปอัพ 🔴 Stock Adj กลายเป็น "📦 ค้างส่ง" แสดงเฉพาะสินค้าที่ R01 ติดลบ (PHARMACY_BACKORDER_TAB)
 *   รอรีเช็ค (status audit) เก่าที่ไม่ติดลบจึงไม่มีที่อยู่ในแท็บนั้นอีก — ผู้ใช้ตัดสินใจให้กลับเป็น "ยังไม่ได้นับ" ไปเลยโดยรับทราบแล้วว่า
 *   ผลนับเดิม/ยอดรีเช็คที่กรอกไว้ของรายการเหล่านั้น "หายถาวร" ผู้ช่วยต้องสแกนใหม่แล้ว Confirm (ไม่ผ่าน Audit — ไม่ตรง = Stock Adj ตรง)
 *
 * ผลของการล้าง (ต่อรายการที่เข้าเกณฑ์): ลบ items/{sku} + ลบ entry ใน {branch}_pharmacy_audit_markers ใน transaction เดียวกัน
 *   → ทุกเครื่องเห็นเป็น pending ผ่าน listener เดิม (เหมือนปุ่ม ↺ สแกนใหม่ restartPharmacyScan)
 *   ⛔ ต้องลบ marker คู่กับ item เสมอ — marker เป็น authoritative: เหลือ entry อยู่ = เครื่องอื่นและ login รอบถัดไปสร้างรายการกลับให้เอง
 *   ⛔ และต้องตั้ง legacyLogBackfilledAt ในก้อนเดียวกัน — ไม่งั้น login ถัดไปอ่าน stock_audit_log แล้ว "กู้" รายการที่ล้างกลับมาเป็นรอรีเช็ค
 *
 * ต้องรันบนหน้าเว็บรุ่นที่มีแท็บ 📦 ค้างส่ง (markBackorderFromAdj) และสวิตช์เปิดอยู่ — ไม่งั้นรายการติดลบที่ "คงไว้" ไม่มีที่ให้เภสัชตัดสิน
 *
 * วิธีใช้ (Desktop · login รหัสเภสัช ของสาขาที่จะล้าง · นอกเวลานับ ไม่มีใครรีเช็ค/อัป R16 อยู่):
 *   F12 → Console → วางไฟล์นี้ทั้งไฟล์ → Enter
 *     await resetLegacyAudits()                          ← ตรวจอย่างเดียว ไม่เขียน (dry-run)
 *     await resetLegacyAudits({skipDrafts:true})         ← dry-run แบบเว้นรายการที่เภสัชกรอกยอดรีเช็คไว้แล้ว (ยังไม่ยืนยัน)
 *     await resetLegacyAudits({only:['100200','700123']})← จำกัดเฉพาะ SKU ที่ระบุ (ลองจำนวนน้อยก่อน)
 *     await resetLegacyAudits({dryRun:false})            ← ล้างจริง (พิมพ์ข้อความยืนยัน + ดาวน์โหลดสำรองก่อน) · ใส่ skipDrafts/only ร่วมได้
 *   แนะนำ: สำรองสาขาด้วย tools/backup-branch.js ก่อนรันจริง · ⛔ ย้อนจากเครื่องมือนี้ไม่ได้ (กู้ได้จากไฟล์ JSON สำรองที่ดาวน์โหลดเท่านั้น — ด้วยมือ)
 *
 * เกณฑ์ "ล้างได้" (ต้องครบทุกข้อ — ข้อมูลจาก server ไม่ใช่หน้าเว็บ):
 *   status audit ไม่มีผู้ยืนยัน · ไม่มีธงค้างส่ง (item/marker) · item (ถ้ามี) ของรอบนี้เป็น audit · รู้ยอด R01 และไม่ติดลบ (G ≥ 0)
 *   ไม่เข้าเกณฑ์ = "คงไว้" แล้วรายงานแยกกลุ่ม: R01 ติดลบ (ไปอยู่แท็บ 📦 ค้างส่ง) · มาร์คค้างส่งแล้ว · ไม่มีแถวใน R01 · สถานะไม่ตรงกัน · ยืนยันแล้ว
 *   ที่ล้างแล้วมีผลต่อ Counted/Progress (ลดลง) — ผู้ช่วยสแกนใหม่แล้ว Confirm
 *
 * Safety properties:
 * - dry-run เป็นค่าเริ่มต้น · ล้างจริงต้องพิมพ์ข้อความยืนยัน · ดาวน์โหลด JSON ของ marker doc + item docs ก่อนเขียน
 * - ถือ branch confirm lock ตลอด (PDA ออนไลน์หยุดสแกน/กรอก · Desktop อื่นกด Confirm/ยืนยันรีเช็คไม่ได้) · ปลดใน finally
 * - หลังได้ lock รอ 3.8 วิ แล้วอ่าน server ซ้ำ: รอบ/rev/marker ของทุกรายการต้องเหมือนตอนสำรวจ ไม่งั้นยกเลิกทั้งชุด (ก่อนเขียนอะไร)
 * - เขียนเป็นชุดละ ≤ 200 SKU ด้วย transaction (อ่านซ้ำ + ตรวจ rev ในนั้นอีกชั้น) — ชุดที่เขียนแล้วคงอยู่แม้ชุดถัดไปล้ม · รันซ้ำได้ (idempotent)
 *
 * ค่าใช้จ่าย Firestore: อ่าน ≈ (audit ทั้งหมด + 2 doc) × 2 + ชุดละ (SKU + 1) · เขียน/ลบ = จำนวน SKU ที่ล้าง + marker 1 doc ต่อชุด
 */
(() => {
'use strict';
const ONLY_WHY = 'ไม่อยู่ในรายการ only';
const LOCK_SETTLE_MS = 3800;   // เท่ากับ Confirm — ให้ PDA ที่เพิ่งเห็น lock flush ยอดค้างขึ้นมาก่อน
const CHUNK = 200;             // transaction ละไม่เกิน 200 SKU (เพดาน 500 operations — อ่าน+เขียนต่อ SKU)

const pad = n => String(n).padStart(2, '0');
const tsMs = v => (v == null || v === '') ? NaN : Date.parse(String(v).replace(' ', 'T'));
const fmtLocal = v => { const ms = tsMs(v); if (!Number.isFinite(ms)) return v ? String(v) : '—'; const d = new Date(ms); return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
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
  if (typeof markBackorderFromAdj !== 'function' || typeof _backorderTabOn !== 'function') throw new Error('หน้าเว็บนี้ยังเป็นรุ่นเก่า (ไม่มีแท็บ 📦 ค้างส่ง) — กด Ctrl+F5 แล้ว login ใหม่ก่อน');
  if (!_isPharmacyBranch()) throw new Error('ใช้ได้เฉพาะสาขายา (SRC/KKL/SSS)');
  if (!_backorderTabOn()) throw new Error('แท็บ 📦 ค้างส่ง ปิดอยู่ (PHARMACY_BACKORDER_TAB) — รายการติดลบที่ "คงไว้" จะไม่มีที่ให้เภสัชตัดสิน · เปิดสวิตช์ก่อน');
  if (currentRole !== 'pharmacist') throw new Error('ต้อง login ด้วยรหัสเภสัช');
  if (_isPdaApp()) throw new Error('ต้องรันบน Desktop เท่านั้น');
  if (!navigator.onLine) throw new Error('ต้องออนไลน์');
  if (_adminMode) throw new Error('ออกจาก Admin Mode ก่อน (โหมดนี้หยุด listener)');
  if (_branchConfirming) throw new Error('เครื่องนี้มีงาน Confirm/ยืนยันค้างอยู่ — รอให้เสร็จก่อน');
  if (!_isScanSchemaV2()) throw new Error('สาขานี้ไม่ใช่ schema v2');
  if (!state.r01Data || !state.r01Data.length) throw new Error('R01 ยังไม่โหลด — รู้ยอดระบบไม่ได้ จึงแยกรายการติดลบไม่ได้ (รอให้ R01 ขึ้นก่อน)');
  if (_scanItemInFlight.size || _scanItemFlushing) throw new Error('เครื่องนี้ยังมีงานเขียนรายการค้างอยู่ — รอสักครู่แล้วลองใหม่');
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
function auditSkus(srv) {
  const s = new Set(Object.keys(srv.items).filter(k => srv.items[k]?.status === 'audit'));
  for (const [sku, m] of Object.entries(srv.markers)) if (m?.status === 'audit') s.add(sku);
  // item เป็นสถานะอื่น แต่ marker บอก audit → ต้องเข้ามาให้ classify ข้ามพร้อมเหตุผล (ไม่ซ่อน)
  return [...s];
}

// ── จัดกลุ่ม: ล้าง / คงไว้ ───────────────────────────────────────────────────
function classify(sku, srv, opts) {
  const m = srv.markers[sku]; const it = srv.items[sku]; const si = state.skuMap.get(sku);
  const g = _rawSystemQty(sku);
  const draft = (m?.recheckQty != null) || (it?.recheckQty != null);
  const base = { sku, name: si?.productName || '', g, counted: num(it?.countedQty ?? m?.countedQty),
    by: it?.scannedBy || m?.scannedBy || '', countedAt: it?.firstScanAt || it?.timestamp || m?.firstScanAt || m?.timestamp || '',
    draft, reopened: !!m?.reopenedAt, rev: srv.revs[sku] ?? 0, markerAt: m?.countConfirmedAt || m?.confirmedAt || '' };
  const keep = why => ({ ...base, ok: false, why });
  if (m && m.status !== 'audit') return keep('marker ไม่ใช่รอรีเช็ค (ยืนยันแล้ว) แต่รายการยังเป็น audit');
  if (m?.auditor || it?.auditor) return keep('ยืนยันแล้ว');
  if (m?.backorder || it?.backorder) return keep('มาร์คค้างส่งแล้ว — ไปยืนยันที่แท็บ 📦 ค้างส่ง');
  if (it && it.status !== 'audit') return keep('สถานะในรายการไม่ตรงกับ marker');
  if (g === null) return keep('ไม่มีแถวใน R01 (ไม่รู้ยอดระบบ)');
  if (g < 0) return keep('R01 ติดลบ — ไปที่แท็บ 📦 ค้างส่ง');
  if (opts.skipDrafts && draft) return keep('มียอดรีเช็คที่กรอกไว้แล้ว (skipDrafts)');
  if (opts.only && !opts.only.has(sku)) return keep(ONLY_WHY);
  return { ...base, ok: true, why: '' };
}
const row = c => ({
  SKU: c.sku, ชื่อ: c.name, 'R01(G)': c.g, นับได้: Number.isFinite(c.counted) ? c.counted : '—', ผู้นับ: c.by, นับเมื่อ: fmtLocal(c.countedAt),
  ยอดรีเช็คที่กรอกไว้: c.draft ? '⚠️ จะหาย' : '', 'กด ↺ มา': c.reopened ? 'ใช่' : '',
});

// ── เขียน: ชุดละ ≤ CHUNK SKU · transaction เดียว = ลบ item + ลบ entry ใน marker + ตั้ง legacyLogBackfilledAt ──────────────
async function resetChunk(branch, epoch, chunk) {
  const markerRef = getPharmacyAuditMarkerRef(branch);
  const col = getScanItemsRef(branch);
  let nextItems = null; let deleted = 0;
  await _db.runTransaction(async tx => {
    nextItems = null; deleted = 0;   // transaction ถูกรันซ้ำได้เมื่อชนกัน — ตั้งค่าใหม่ทุกรอบ
    const markerSnap = await tx.get(markerRef);
    const snaps = [];
    for (const c of chunk) snaps.push(await tx.get(col.doc(c.sku)));   // อ่านทั้งหมดก่อนเขียน (กฎ transaction)
    const old = markerSnap.exists ? (markerSnap.data() || {}) : {};
    const same = (old.countResetAt || '') === epoch;
    const items = same ? { ...(old.items || {}) } : {};
    chunk.forEach((c, i) => {
      const server = snaps[i].exists ? (snaps[i].data() || {}) : null;
      // doc id คือ SKU ใช้ร่วมทุกรอบ — เศษรอบอื่นไม่ใช่ของรอบนี้ (ไม่ลบ ไม่ใช้ตัดสิน)
      const cur = server && String(server.countResetAt || '') === epoch ? server : null;
      if (cur && (cur.status !== 'audit' || cur.auditor || cur.backorder || (Number(cur.rev) || 0) !== c.rev)) throw new Error(`RESET_CHANGED:${c.sku}`);
      const m = items[c.sku];
      if (m && (m.status !== 'audit' || m.auditor || m.backorder)) throw new Error(`RESET_CHANGED:${c.sku}`);
      delete items[c.sku];
      if (cur) { tx.delete(col.doc(c.sku)); deleted++; }
    });
    const ts = firebase.firestore.FieldValue.serverTimestamp();
    // เหมือน _writePharmacyAuditMarkers: เอกสารรอบอื่นถือว่าว่าง · legacyLogBackfilledAt ตั้งในก้อนเดียวกันเสมอ (กัน login ถัดไป "กู้" จาก stock_audit_log)
    tx.set(markerRef, { ...(same ? old : {}), branch, countResetAt: epoch, items,
      legacyLogBackfilledAt: (same && old.legacyLogBackfilledAt) || ts, updatedAt: ts });
    nextItems = items;
  });
  return { nextItems, deleted };
}

// ล้างในเครื่องนี้ให้ตรงกับ Cloud ที่เขียนสำเร็จแล้ว — placeholder pending รูปเดียวกับ restartPharmacyScan / _applyScanItemRemoved
function applyLocal(epoch, chunk, nextItems) {
  if (nextItems && (_pharmacyAuditMarkerData.countResetAt || '') === epoch)
    _pharmacyAuditMarkerData = { ..._pharmacyAuditMarkerData, branch: currentBranch, countResetAt: epoch, items: nextItems,
      legacyLogBackfilledAt: _pharmacyAuditMarkerData.legacyLogBackfilledAt || new Date().toISOString() };
  for (const c of chunk) {
    const sd = state.scanData.get(c.sku);
    state.scanData.set(c.sku, { countedQty: 0, status: 'pending', retries: 0, timestamp: '', scannedBy: '', auditor: '', auditStatus: 'pending', barcode: '', location: sd?.location || '', scans: [] });
    _dirtySkus.delete(c.sku); _scanItemRev.delete(c.sku); _scanItemSynced.delete(c.sku);
    scanListMap.delete(c.sku);
  }
}
function refreshUi() {
  invalidatePopupRowsCache(); saveSession(); rebuildScanListMap(true); renderScanList(); updateStats(); renderTable();
  renderAuditVerifyTable(); updateAuditVerifyCount(); updatePharmacistAuditConfirmBtn();
}

window.resetLegacyAudits = async function resetLegacyAudits(opts = {}) {
  const dryRun = opts.dryRun !== false;
  const o = { skipDrafts: !!opts.skipDrafts, only: Array.isArray(opts.only) && opts.only.length ? new Set(opts.only.map(String)) : null };
  guard();
  const branch = currentBranch;
  if (!dryRun) await _flushDirtySkus();   // แก้ที่ค้างในเครื่องนี้ขึ้น Cloud ก่อนสำรวจ — ไม่งั้น rev เปลี่ยนหลังสำรวจแล้วยกเลิกเอง
  const srv = await readServer(branch);
  console.log(`%c[ล้างรอรีเช็คเก่า] สาขา ${branch} · ${dryRun ? 'DRY-RUN (ไม่เขียน)' : 'ล้างจริง'}${o.skipDrafts ? ' · skipDrafts' : ''}${o.only ? ` · only ${o.only.size} SKU` : ''}`, 'font-weight:bold');
  const all = auditSkus(srv).map(sku => classify(sku, srv, o)).sort(bySku);
  const cands = all.filter(c => c.ok); const kept = all.filter(c => !c.ok);
  const keepGroups = {}; for (const k of kept) (keepGroups[k.why] ||= []).push(k.sku);
  const drafts = cands.filter(c => c.draft), reopened = cands.filter(c => c.reopened);
  console.log(`รอรีเช็คทั้งหมด ${all.length} · ล้างได้ ${cands.length} (มียอดรีเช็คที่กรอกไว้จะหาย ${drafts.length} · กด ↺ มา ${reopened.length}) · คงไว้ ${kept.length}`);
  if (cands.length) console.table(cands.map(row));
  for (const [why, skus] of Object.entries(keepGroups)) console.log(`คงไว้ — ${why}: ${skus.length} รายการ`, why === ONLY_WHY ? '' : skus.join(', '));
  if (drafts.length) console.warn(`⚠️ ${drafts.length} รายการมียอดรีเช็คที่เภสัชกรอกไว้แต่ยังไม่ยืนยัน (${drafts.map(c => c.sku).join(', ')}) — จะหายถาวร · เว้นไว้ด้วย  {skipDrafts:true}`);
  const report = { branch, epoch: srv.epoch, total: all.length, reset: cands.length, skus: cands.map(c => c.sku), withDraft: drafts.map(c => c.sku),
    reopened: reopened.map(c => c.sku), kept: keepGroups, rows: cands.map(row) };
  window.resetLegacyAuditsReport = report;
  if (dryRun || !cands.length) {
    console.log(dryRun ? 'DRY-RUN จบ — ยังไม่ได้เขียนอะไร · ทบทวนรายการแล้วรัน  await resetLegacyAudits({dryRun:false})' : 'ไม่มีรายการให้ล้าง');
    if (dryRun) console.log('คัดลอกผลเป็นข้อความ:  copy(JSON.stringify(resetLegacyAuditsReport, null, 1))');
    return report;
  }

  const phrase = `ล้างรอรีเช็ค ${branch} ${cands.length}`;
  const typed = prompt(`🔒 จะล้างรอรีเช็คเก่า ${cands.length} รายการของสาขา ${branch} ให้กลับเป็น "ยังไม่ได้นับ"\n(ผลนับเดิม${drafts.length ? ` และยอดรีเช็ค ${drafts.length} รายการ` : ''}จะหายถาวร — ผู้ช่วยต้องสแกนใหม่แล้ว Confirm · คงไว้ ${kept.length} รายการ)\n(จะดาวน์โหลดสำเนาก่อนเขียน)\n\nพิมพ์  ${phrase}  เพื่อยืนยัน:`);
  if (typed !== phrase) { console.warn('ยกเลิก — ข้อความยืนยันไม่ตรง'); return report; }
  download(`reset-legacy-audits-${branch}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
    { branch, epoch: srv.epoch, exportedAt: new Date().toISOString(), skus: cands.map(c => c.sku), markerDoc: serialize(srv.markerDoc),
      items: Object.fromEntries(cands.map(c => [c.sku, serialize(srv.items[c.sku] ?? null)])) });
  await sleep(800);

  _branchConfirming = true; updateConfirmBtn(); updatePharmacistAuditConfirmBtn();
  let token = ''; let done = 0; let deletedDocs = 0;
  try {
    console.log('[ล้างรอรีเช็คเก่า] กำลังล็อกสาขาและพักการสแกนทุกเครื่อง...');
    token = await _acquireBranchConfirmLock();
    await sleep(LOCK_SETTLE_MS);
    // อ่านซ้ำ: ทุกรายการต้องเหมือนตอนสำรวจ (รอบ · rev · marker) ไม่งั้นยกเลิกทั้งชุดก่อนเขียนอะไร
    const again = await readServer(branch);
    if (again.epoch !== srv.epoch) throw new Error('รอบบน server เปลี่ยนระหว่างทำ — ยกเลิก (ยังไม่ได้เขียนอะไร)');
    for (const c of cands) {
      const n = classify(c.sku, again, o);
      if (!n.ok || n.rev !== c.rev || n.markerAt !== c.markerAt)
        throw new Error(`${c.sku} เปลี่ยนระหว่างทำ (${n.why || `rev ${c.rev}→${n.rev} · marker ${c.markerAt}→${n.markerAt}`}) — ยกเลิกทั้งชุด ยังไม่ได้เขียนอะไร · รัน dry-run ใหม่`);
    }
    // ตัดแก้ที่ยังไม่ได้ flush ของ SKU เหล่านี้ทิ้ง (จะถูกลบอยู่แล้ว) — ไม่งั้น flush ที่เริ่มกลางทางเขียน item เก่ากลับ (rev+1) แล้ว transaction เห็น rev เปลี่ยน
    for (const c of cands) _dirtySkus.delete(c.sku);
    for (let i = 0; i < cands.length; i += CHUNK) {
      const chunk = cands.slice(i, i + CHUNK);
      console.log(`[ล้างรอรีเช็คเก่า] เขียนชุด ${Math.floor(i / CHUNK) + 1}/${Math.ceil(cands.length / CHUNK)} (${chunk.length} รายการ)...`);
      let res;
      try { res = await resetChunk(branch, srv.epoch, chunk); }
      catch (e) {
        if (done) refreshUi();
        throw new Error(`ล้างได้ ${done}/${cands.length} รายการ แล้วชุดถัดไปล้ม: ${String(e.message || e.code || e).startsWith('RESET_CHANGED') ? 'มีรายการเปลี่ยนระหว่างทาง (' + String(e.message).split(':')[1] + ')' : (e.code || e.message)} — ชุดที่เขียนแล้วคงอยู่ · รัน dry-run แล้วทำซ้ำได้`);
      }
      applyLocal(srv.epoch, chunk, res.nextItems);
      done += chunk.length; deletedDocs += res.deleted;
    }
    refreshUi();
  } finally {
    if (token) { const released = await _releaseBranchConfirmLock(token); if (released && _branchConfirmLockData?.token === token) _setBranchScanPaused(false, null); }
    _branchConfirming = false; updateConfirmBtn(); updatePharmacistAuditConfirmBtn();
  }
  Object.assign(report, { dryRun: false, reset: done, deletedDocs });
  console.log(`%c[ล้างรอรีเช็คเก่า] เสร็จ — ล้าง ${done} รายการเป็น ⏳ ยังไม่ได้นับ (ลบ item ${deletedDocs} doc)`, 'font-weight:bold');
  console.log('ขั้นต่อไป: ให้ทุกเครื่องรีโหลด/ปิด-เปิดแอป · รัน dry-run ซ้ำ ต้องเหลือเฉพาะกลุ่มที่คงไว้ · แจ้งผู้ช่วยให้สแกนรายการที่หายไปจาก Progress ใหม่');
  return report;
};

console.log('พร้อมแล้ว — await resetLegacyAudits()   (ค่าเริ่มต้นคือตรวจอย่างเดียว · ล้างจริง: {dryRun:false})');
})();
