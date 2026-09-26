/*
 * cleanup-stale-round-items.js — ล้าง "เศษรอบเก่า" ที่ค้างใน stock_sessions/{branch}/items
 *
 * ที่มา (ก.ย. 2026 · SRC): กด "เริ่มนับใหม่" แล้วขั้นลบ items รอบเก่าถูกตัดกลางคัน (login ใหม่ 8 วินาทีหลังกด)
 *   เอกสารรอบเก่าค้างอยู่ใต้ชื่อเดียวกับ SKU ของรอบใหม่ → ตอน PDA สแกน SKU นั้น _writeScanningItem อ่านเจอ
 *   สถานะ pass ของรอบเก่าแล้วคิดว่า "เครื่องอื่น Confirm แล้ว" → เอาผลรอบเก่ามาแทนแล้วเขียนกลับในนามรอบใหม่
 *   รายละเอียด: tools/diagnose-reset-resurrect.js
 *
 * วิธีใช้ (Desktop เท่านั้น · login สาขาที่จะล้างอยู่ · สำรองด้วย tools/backup-branch.js ก่อน):
 *   F12 → Console → วางไฟล์นี้ทั้งไฟล์ → Enter
 *
 *   ① ลบเอกสารรอบเก่าที่ค้าง (งานที่ "เริ่มนับใหม่" ควรทำเสร็จตั้งแต่แรก)
 *        await cleanupStaleRoundItems()                  ← ตรวจอย่างเดียว ไม่เขียน (dry-run)
 *        await cleanupStaleRoundItems({dryRun:false})    ← ลบจริง (ถามยืนยันก่อน + ดาวน์โหลดสำเนาก่อนลบ)
 *
 *   ② คืนรายการรอบเก่าที่ถูกเขียนกลับขึ้นมาในรอบนี้ ให้เป็น "ยังไม่ได้นับ"
 *      ⚠️ ทำหลัง deploy โค้ดที่แก้แล้ว และทุกเครื่องรีโหลดหน้าแล้ว — ไม่งั้นเครื่องที่ถือข้อมูลเก่าไว้อาจดันกลับขึ้นมาอีก
 *        await resetResurrectedItems()                   ← ตรวจอย่างเดียว
 *        await resetResurrectedItems({dryRun:false})     ← ลบจริง
 *      ตัดสินว่า "ถูกเขียนกลับ" = อยู่ในรอบนี้ + สถานะ Confirm แล้ว (pass/audit/audit_check/stock_adjustment)
 *      + **ไม่มีร่องรอยในรอบนี้เลย**: ทั้ง firstScanAt และ timestamp เก่ากว่าตอนเริ่มรอบเกิน 5 นาที
 *      + ไม่อยู่ใน marker เภสัชของรอบนี้ (marker = งาน Audit/ผลยืนยันของรอบนี้ ลบ item ไปก็ถูกสร้างกลับ)
 *      ⚠️ ห้ามดู firstScanAt อย่างเดียว: รายการที่โดนดึงผลเก่าแล้วกด ✕ สแกนใหม่ firstScanAt ยังค้างเป็นวันรอบเก่า
 *         (✕ ไม่ล้าง) แต่ยอด/สถานะ/timestamp เป็นของรอบนี้จริง — SRC 26 ก.ย.: 800424 / 600677 ถูก Confirm ในรอบนี้แล้ว
 *      รายการ scanning ไม่แตะ (ยอด scanning เป็นยอดที่สแกนในรอบนี้จริง)
 *
 * Safety properties:
 * - dry-run เป็นค่าเริ่มต้น ต้องสั่ง {dryRun:false} เองถึงจะเขียน · ก่อนลบจริงต้องพิมพ์ยืนยันตามที่ขึ้นบนจอ
 * - อ่านรอบนับปัจจุบันจาก server ทุกครั้ง ไม่เชื่อค่าในหน้าเว็บ · รอบบน server เปลี่ยนระหว่างทำ = หยุดทันที
 * - ① ลบเฉพาะเอกสารที่รอบ "เก่ากว่า" รอบปัจจุบัน — รอบที่ใหม่กว่า/ว่าง/แปลกจะรายงานเฉยๆ ไม่ลบ
 * - ลบด้วย transaction ทีละชุด อ่านเอกสารซ้ำก่อนลบทุกตัว — ถ้าระหว่างนั้นมีเครื่องสแกนทับจนกลายเป็นรอบปัจจุบัน
 *   (หรือ ② สถานะ/rev เปลี่ยน) จะข้าม ไม่ลบ ห้ามลบยอดที่สแกนในรอบนี้ทิ้งเด็ดขาด
 * - ดาวน์โหลด JSON ของทุกเอกสารที่จะลบไว้ก่อนเริ่มลบ (สำรองซ้ำอีกชั้นนอกจาก backup-branch.js)
 * - ไม่แตะ session doc / marker / R01 / WH confirm_ops — items อย่างเดียว
 *
 * ค่าใช้จ่าย Firestore: อ่าน ≈ 2 ครั้งต่อเอกสารที่จะลบ (สำรวจ + ตรวจซ้ำใน transaction) + ลบ 1 ครั้งต่อเอกสาร
 */
(() => {
'use strict';

const TX_CHUNK = 100;          // เอกสารต่อ 1 transaction (อ่าน+ลบ ≤ 200 ops · เพดาน 500)
const PAGE = 500;              // ขนาดหน้าเวลาสำรวจ
const OLD_TOL_MS = 5 * 60 * 1000; // ตรงกับ _pharmacyItemInCurrentEpoch — เผื่อนาฬิกาเครื่องเหลื่อม
const CONFIRMED = new Set(['pass', 'audit', 'audit_check', 'stock_adjustment']);

const pad = n => String(n).padStart(2, '0');
const fmtDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
const fmtEpoch = iso => { const d = new Date(iso); return isNaN(d) ? String(iso || '(ว่าง)') : fmtDate(d); };
const tsMs = v => (v == null || v === '') ? NaN : Date.parse(String(v).replace(' ', 'T'));
const sleep = ms => new Promise(r => setTimeout(r, ms));

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
  if (typeof _isPdaApp === 'function' && _isPdaApp()) throw new Error('ต้องรันบน Desktop เท่านั้น');
  if (!navigator.onLine) throw new Error('ต้องออนไลน์');
  if (typeof _adminMode !== 'undefined' && _adminMode) throw new Error('ออกจาก Admin Mode ก่อน');
}
async function readServerEpoch(branch) {
  const snap = await _db.collection('stock_sessions').doc(branch).get({ source: 'server' });
  if (!snap.exists) throw new Error(`ไม่มี session doc ของ ${branch}`);
  const raw = snap.data() || {};
  const s = raw.session_data_json ? JSON.parse(raw.session_data_json) : {};
  if (!s.countResetAt) throw new Error('session ไม่มี countResetAt — หยุดเพื่อความปลอดภัย');
  if (Number(raw.schemaVersion) !== 2) throw new Error(`schemaVersion ${raw.schemaVersion} ไม่ใช่ 2 — สคริปต์นี้รองรับเฉพาะ schema v2`);
  return s.countResetAt;
}
// ลบทีละชุดด้วย transaction: อ่านซ้ำ → ลบเฉพาะที่ keep(data, docId) ยังเป็นจริง
async function deleteInTransactions(branch, epoch, ids, keep, label) {
  const itemsRef = getScanItemsRef(branch);
  let deleted = 0, skipped = 0; const skippedIds = [];
  for (let i = 0; i < ids.length; i += TX_CHUNK) {
    const chunk = ids.slice(i, i + TX_CHUNK);
    const res = await _db.runTransaction(async tx => {
      // รอบบน server ต้องยังเป็นรอบเดิม — ถ้ามีคนกดเริ่มนับใหม่ระหว่างทำ ให้หยุดทั้งหมด
      const sess = await tx.get(_db.collection('stock_sessions').doc(branch));
      const raw = sess.data() || {};
      const cur = (raw.session_data_json ? JSON.parse(raw.session_data_json) : {}).countResetAt || '';
      if (cur !== epoch) throw new Error(`รอบบน server เปลี่ยนเป็น ${cur} ระหว่างทำ — หยุด`);
      const snaps = [];
      for (const id of chunk) snaps.push(await tx.get(itemsRef.doc(id)));
      let d = 0, s = 0; const sk = [];
      snaps.forEach((snap, k) => {
        if (snap.exists && keep(snap.data() || {}, chunk[k])) { tx.delete(snap.ref); d++; }
        else { s++; sk.push(chunk[k]); }
      });
      return { d, s, sk };
    });
    deleted += res.d; skipped += res.s; skippedIds.push(...res.sk);
    console.log(`[${label}] ${Math.min(i + TX_CHUNK, ids.length)}/${ids.length} · ลบแล้ว ${deleted} · ข้าม ${skipped}`);
    await sleep(150);
  }
  return { deleted, skipped, skippedIds };
}

// ── ① เอกสารรอบเก่าที่ค้าง ─────────────────────────────────────────────────
window.cleanupStaleRoundItems = async function cleanupStaleRoundItems(opts = {}) {
  const dryRun = opts.dryRun !== false;
  guard();
  const branch = currentBranch;
  const epoch = await readServerEpoch(branch);
  console.log(`%c[cleanup ①] สาขา ${branch} · รอบปัจจุบันเริ่ม ${fmtEpoch(epoch)} · ${dryRun ? 'DRY-RUN (ไม่เขียน)' : 'ลบจริง'}`, 'font-weight:bold');

  // สำรวจทุกเอกสารที่ไม่ใช่รอบปัจจุบัน (แบ่งหน้า — ห้ามอ่านทีเดียวทั้งก้อน)
  const itemsRef = getScanItemsRef(branch);
  const stale = []; const other = [];
  let last = null, reads = 0;
  for (;;) {
    let q = itemsRef.where('countResetAt', '!=', epoch).orderBy('countResetAt').orderBy(firebase.firestore.FieldPath.documentId()).limit(PAGE);
    if (last) q = q.startAfter(last);
    const snap = await q.get({ source: 'server' }); reads += Math.max(1, snap.size);
    if (snap.empty) break;
    snap.forEach(d => {
      const x = d.data() || {}; const e = String(x.countResetAt || '');
      const row = { id: d.id, countResetAt: e, status: x.status || '', firstScanAt: x.firstScanAt || '', timestamp: x.timestamp || '', data: serialize(x) };
      // ลบเฉพาะรอบที่เก่ากว่ารอบปัจจุบันจริง (ISO เทียบแบบตัวอักษรได้) · ว่าง/ใหม่กว่า = รายงานเฉยๆ
      if (e && e < epoch) stale.push(row); else other.push(row);
    });
    last = snap.docs[snap.docs.length - 1];
    if (snap.size < PAGE) break;
  }

  const byRound = {}; const byStatus = {};
  stale.forEach(r => { const k = fmtEpoch(r.countResetAt); byRound[k] = (byRound[k] || 0) + 1; byStatus[r.status] = (byStatus[r.status] || 0) + 1; });
  const ids = stale.map(r => r.id).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
  console.log(`เอกสารรอบเก่าที่จะลบ: ${stale.length} รายการ`, byRound, 'แยกตามสถานะ:', byStatus);
  if (ids.length) console.log(`ช่วงรหัส SKU: ${ids[0]} ถึง ${ids[ids.length - 1]}`);
  if (other.length) { console.warn(`⚠️ พบ ${other.length} เอกสารที่รอบว่าง/ใหม่กว่าปัจจุบัน — ไม่ลบ ตรวจดูเอง:`); console.table(other.map(({ data, ...r }) => r)); }
  const report = { branch, epoch, staleCount: stale.length, byRound, byStatus, firstSku: ids[0] || '', lastSku: ids[ids.length - 1] || '', otherCount: other.length, reads };
  window.cleanupStaleRoundReport = report;
  if (dryRun || !stale.length) {
    console.log(dryRun ? 'DRY-RUN จบ — ยังไม่ได้ลบอะไร · ถ้าตัวเลขถูกต้อง รัน  await cleanupStaleRoundItems({dryRun:false})' : 'ไม่มีอะไรต้องลบ');
    return report;
  }

  const phrase = `ลบ ${stale.length}`;
  const typed = prompt(`🔒 จะลบเอกสารรอบเก่า ${stale.length} รายการของสาขา ${branch}\n(รอบปัจจุบันไม่ถูกแตะ · จะดาวน์โหลดสำเนาก่อนลบ)\n\nพิมพ์  ${phrase}  เพื่อยืนยัน:`);
  if (typed !== phrase) { console.warn('ยกเลิก — ข้อความยืนยันไม่ตรง'); return report; }

  download(`stale-round-items-${branch}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
    { branch, currentEpoch: epoch, exportedAt: new Date().toISOString(), items: Object.fromEntries(stale.map(r => [r.id, r.data])) });
  await sleep(800);

  const res = await deleteInTransactions(branch, epoch, ids, d => { const e = String(d.countResetAt || ''); return !!e && e < epoch; }, 'cleanup ①');
  Object.assign(report, res, { dryRun: false });
  console.log(`%c[cleanup ①] เสร็จ — ลบ ${res.deleted} · ข้าม ${res.skipped} (ข้าม = ถูกสแกนทับเป็นรอบปัจจุบันระหว่างทำ)`, 'font-weight:bold');
  if (res.skippedIds.length) console.log('SKU ที่ข้าม:', res.skippedIds.join(', '));
  return report;
};

// ── ② รายการรอบเก่าที่ถูกเขียนกลับในรอบนี้ ────────────────────────────────────
window.resetResurrectedItems = async function resetResurrectedItems(opts = {}) {
  const dryRun = opts.dryRun !== false;
  guard();
  const branch = currentBranch;
  const epoch = await readServerEpoch(branch);
  const epochMs = Date.parse(epoch);
  console.log(`%c[cleanup ②] สาขา ${branch} · รอบปัจจุบันเริ่ม ${fmtEpoch(epoch)} · ${dryRun ? 'DRY-RUN (ไม่เขียน)' : 'ลบจริง'}`, 'font-weight:bold');

  const snap = await getScanItemsRef(branch).where('countResetAt', '==', epoch).get({ source: 'server' });
  // marker เภสัชของรอบนี้ — SKU ที่อยู่ในนี้เป็นงาน Audit/ผลยืนยันของรอบนี้ (ลบ item ไป marker ก็สร้างกลับ) → ไม่แตะ
  let markerItems = {};
  try {
    const m = await getPharmacyAuditMarkerRef(branch).get({ source: 'server' });
    const md = m.exists ? (m.data() || {}) : {};
    if ((md.countResetAt || '') === epoch) markerItems = md.items || {};
  } catch (e) { console.warn('อ่าน marker ไม่ได้ — หยุดเพื่อความปลอดภัย:', e.code || e.message); throw e; }
  // เวลาล่าสุดที่รายการนี้ถูกแตะ = ค่าที่ใหม่กว่าระหว่าง firstScanAt กับ timestamp
  const lastTouchMs = d => { const v = [tsMs(d.firstScanAt), tsMs(d.timestamp)].filter(Number.isFinite); return v.length ? Math.max(...v) : NaN; };
  const oldFirstScan = d => { const ms = tsMs(d.firstScanAt); return Number.isFinite(ms) && ms < epochMs - OLD_TOL_MS; };
  const isResurrected = (d, id) => {
    if (String(d.countResetAt || '') !== epoch || !CONFIRMED.has(d.status)) return false;
    if (markerItems[id]) return false;
    const ms = lastTouchMs(d);
    return Number.isFinite(ms) && ms < epochMs - OLD_TOL_MS;
  };
  const found = []; const kept = [];
  snap.forEach(d => {
    const x = d.data() || {};
    if (isResurrected(x, d.id)) found.push({ id: d.id, rev: Number(x.rev) || 0, status: x.status, x });
    // ดูเผินๆ เหมือนเศษ (Confirm แล้ว + เวลาสแกนครั้งแรกเก่า) แต่มีร่องรอยในรอบนี้ → ไม่แตะ แค่รายงานให้เห็น
    else if (CONFIRMED.has(x.status) && oldFirstScan(x)) kept.push({ id: d.id, x, why: markerItems[d.id] ? 'อยู่ใน marker รอบนี้' : 'สแกนในรอบนี้ (timestamp ใหม่)' });
  });
  const bySku = (a, b) => a.id.localeCompare(b.id, 'en', { numeric: true });
  found.sort(bySku); kept.sort(bySku);
  const row = (id, x) => ({ SKU: id, สถานะ: x.status, นับได้: x.countedQty, นับโดย: x.scannedBy || '', สแกนครั้งแรก: x.firstScanAt || '', สแกนล่าสุด: x.timestamp || '', auditor: x.auditor || '', เขียนโดย: x.updatedBy || '', rev: Number(x.rev) || 0 });
  console.log(`items รอบนี้ ${snap.size} รายการ · เข้าเกณฑ์ "ถูกเขียนกลับ" ${found.length} รายการ`);
  if (found.length) console.table(found.map(f => row(f.id, f.x)));
  if (kept.length) {
    console.log(`ไม่แตะ ${kept.length} รายการ — เวลาสแกนครั้งแรกเก่า แต่เป็นงานจริงของรอบนี้ (โดนดึงผลเก่า → กด ✕ สแกนใหม่ → ✕ ไม่ล้างเวลาสแกนครั้งแรก):`);
    console.table(kept.map(k => ({ ...row(k.id, k.x), เหตุผล: k.why })));
  }
  const report = { branch, epoch, count: found.length, skus: found.map(f => f.id), keptCount: kept.length, keptSkus: kept.map(k => k.id),
    rows: found.map(f => row(f.id, f.x)), keptRows: kept.map(k => ({ ...row(k.id, k.x), เหตุผล: k.why })) };
  window.resetResurrectedReport = report;
  if (dryRun || !found.length) {
    console.log(dryRun ? 'DRY-RUN จบ — ยังไม่ได้ลบอะไร · ถ้ารายการถูกต้อง รัน  await resetResurrectedItems({dryRun:false})' : 'ไม่มีอะไรต้องคืน');
    if (dryRun) console.log('คัดลอกผลเป็นข้อความ:  copy(JSON.stringify(resetResurrectedReport, null, 1))');
    return report;
  }

  const phrase = `คืน ${found.length}`;
  const typed = prompt(`🔒 จะคืน ${found.length} รายการให้เป็น "ยังไม่ได้นับ" (ลบเอกสารในรอบนี้)\n${found.map(f => f.id).join(', ')}\n\nพิมพ์  ${phrase}  เพื่อยืนยัน:`);
  if (typed !== phrase) { console.warn('ยกเลิก — ข้อความยืนยันไม่ตรง'); return report; }

  download(`resurrected-items-${branch}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
    { branch, currentEpoch: epoch, exportedAt: new Date().toISOString(), items: Object.fromEntries(found.map(f => [f.id, serialize(f.x)])) });
  await sleep(800);

  // ลบเฉพาะตัวที่ยังเหมือนตอนสำรวจทุกอย่าง (รอบ/สถานะ/rev) — ถ้ามีใครแตะระหว่างนั้นให้ข้าม
  const revOf = new Map(found.map(f => [f.id, f.rev]));
  const res = await deleteInTransactions(branch, epoch, found.map(f => f.id),
    (d, id) => isResurrected(d, id) && (Number(d.rev) || 0) === revOf.get(id), 'cleanup ②');
  Object.assign(report, res, { dryRun: false });
  console.log(`%c[cleanup ②] เสร็จ — คืน ${res.deleted} · ข้าม ${res.skipped}`, 'font-weight:bold');
  if (res.skippedIds.length) console.log('SKU ที่ข้าม (มีการเปลี่ยนระหว่างทำ):', res.skippedIds.join(', '));
  console.log('ขั้นต่อไป: ให้ทุกเครื่องรีโหลดหน้า แล้วรัน tools/diagnose-reset-resurrect.js ซ้ำ — oldCount ต้องเป็น 0');
  return report;
};

console.log('พร้อมแล้ว — ① await cleanupStaleRoundItems()   ② await resetResurrectedItems()   (ค่าเริ่มต้นคือตรวจอย่างเดียว)');
})();
