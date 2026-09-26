// diagnose-reset-resurrect.js — "กดเริ่มนับใหม่แล้ว ทำไมรายการรอบเก่ายังโผล่เป็น Pass/Audit"
//
// วิธีใช้: เปิดหน้าเว็บบน Desktop ที่ login สาขานั้นอยู่ → F12 → Console → วางไฟล์นี้ทั้งไฟล์ → Enter
//          แล้วพิมพ์:  await diagnoseReset()
//          ระบุ SKU เองก็ได้:  await diagnoseReset(['700308','800416','800418','800415'])
//          คัดลอกผลทั้งหมดเป็นข้อความ (ส่งต่อให้คนไล่ปัญหา):
//            copy(JSON.stringify(diagnoseResetReport, null, 1))   ← แล้ว Ctrl+V วางได้เลย
//
// ⚠️ อ่านอย่างเดียว 100% — ใช้แค่ .get() จาก server ไม่มี set/update/delete/transaction ที่ไหนเลย
//    ไม่แตะ state ของหน้าเว็บ ไม่หยุด listener ไม่ยกเลิก timer · พนักงานสแกนต่อได้ระหว่างรัน
//    ค่าใช้จ่าย ≈ 1 read ต่อ 1 document (รวมไม่เกินราว 1,000 reads) — ดูเลขจริงที่บรรทัดสุดท้าย
//
// ตอบตามลำดับกฎ 0 ใน CLAUDE.md (ใครกดอะไร → ใครเขียน → ค่อยสงสัยโค้ด):
//   1. รอบนับบน Cloud (countResetAt) เปลี่ยนจริงไหม และจอนี้อยู่รอบเดียวกับ Cloud หรือเปล่า
//   2. items ของรอบนี้ที่ "ไม่มีร่องรอยในรอบนี้เลย" (firstScanAt และ timestamp เก่ากว่าตอนเริ่มรอบทั้งคู่ · ไม่อยู่ใน marker)
//      = ของรอบเก่าที่ถูกเขียนกลับขึ้นมา (ทุกสถานะ) — เกณฑ์เดียวกับ tools/cleanup-stale-round-items.js
//   3. ใครเขียนมันล่าสุด เมื่อไร (updatedBy / updatedAt ถึงหลักมิลลิวินาที / rev)
//      — updatedAt เท่ากันเป๊ะหลายตัว = ถูกเขียนใน batch เดียวกัน
//   4. หลังเริ่มรอบนี้มีเครื่องไหน login เข้าสาขานี้บ้าง (stock_login_log)

(() => {
'use strict';

const pad = n => String(n).padStart(2, '0');
const fmtDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
const fmtDateMs = d => `${fmtDate(d)}.${String(d.getMilliseconds()).padStart(3, '0')}`;
// Firestore Timestamp / ISO UTC → เวลาในเครื่อง (ไทย) · สตริงเวลาท้องถิ่นเดิม ('YYYY-MM-DD HH:mm:ss') คืนตามเดิม
const fmtTs = v => {
  if (v == null || v === '') return '';
  try {
    if (typeof v.toDate === 'function') return fmtDateMs(v.toDate());
    if (v instanceof Date) return fmtDateMs(v);
    if (typeof v === 'string' && /T.*Z$/.test(v)) { const d = new Date(v); if (!isNaN(d)) return fmtDateMs(d); }
  } catch (e) {}
  return String(v);
};
const tsMs = v => {
  if (v == null || v === '') return NaN;
  if (typeof v.toDate === 'function') return v.toDate().getTime();
  return Date.parse(String(v).replace(' ', 'T'));
};
// แปลงค่าจาก Firestore ให้ JSON เก็บได้ (Timestamp → เวลาไทยถึงมิลลิวินาที)
const ser = v => {
  if (v === null || v === undefined) return v;
  if (typeof v.toDate === 'function') return fmtDateMs(v.toDate());
  if (v instanceof Date) return fmtDateMs(v);
  if (Array.isArray(v)) return v.map(ser);
  if (typeof v === 'object') { const o = {}; for (const k of Object.keys(v).sort()) o[k] = ser(v[k]); return o; }
  return v;
};
const CONFIRMED = ['pass', 'audit', 'audit_check', 'stock_adjustment'];
const itemTime = it => it?.firstScanAt || it?.timestamp || '';

window.diagnoseReset = async function diagnoseReset(skusArg) {
  if (typeof _db === 'undefined' || !_db || !currentBranch) { console.error('ยังไม่ได้ login'); return; }
  const branch = currentBranch;
  const log = (...a) => console.log(...a);
  let reads = 0;
  const device = navigator.userAgent.includes('StockCountPDA') ? 'PDA' : 'Desktop';
  const report = { runAt: fmtDateMs(new Date()), branch, device, user: currentUser || '', role: currentRole || '', online: navigator.onLine };
  window.diagnoseResetReport = report;
  log(`%c=== diagnoseReset · สาขา ${branch} · จอนี้ ${device} · ${currentUser || '-'} (${currentRole || '-'}) · ${navigator.onLine ? 'ออนไลน์' : 'ออฟไลน์'} ===`, 'font-weight:bold');

  // ── 1) รอบนับ ──────────────────────────────────────────────────────────────
  let raw = {}, s = {};
  try {
    const snap = await _db.collection('stock_sessions').doc(branch).get({ source: 'server' }); reads++;
    raw = snap.exists ? (snap.data() || {}) : {};
    s = raw.session_data_json ? JSON.parse(raw.session_data_json) : {};
  } catch (e) {
    console.error('อ่าน session จาก server ไม่ได้:', e.code || e.message, '→ จอนี้อาจออฟไลน์ สิ่งที่เห็นบนจอจึงอาจเป็นข้อมูลเก่าในเครื่อง');
    report.error = 'session read failed: ' + (e.code || e.message);
    return report;
  }
  const epoch = s.countResetAt || '';
  const epochMs = Date.parse(epoch);
  const localEpoch = (typeof _countResetAt !== 'undefined' && _countResetAt) || '';
  Object.assign(report, { cloudEpoch: epoch, cloudEpochLocal: fmtTs(epoch), localEpoch, localEpochMatches: localEpoch === epoch,
    sessionUpdatedAt: fmtTs(raw.updated_at), schemaVersion: raw.schemaVersion, sessionR01BaselineAt: s.r01BaselineAt || '' });
  log('1) รอบนับบน Cloud เริ่มเมื่อ', fmtTs(epoch) || '(ว่าง)', `· countResetAt ${epoch}`, '· session เขียนล่าสุด', fmtTs(raw.updated_at), '· schemaVersion', raw.schemaVersion);
  log('   รอบนับในจอนี้', fmtTs(localEpoch) || '(ว่าง)', localEpoch === epoch ? '✅ ตรงกับ Cloud' : '❌ ไม่ตรงกับ Cloud — จอนี้ยังไม่ได้รับรอบใหม่');

  // ── 2) items ของรอบนี้บน Cloud ─────────────────────────────────────────────
  const cur = [];
  try {
    const q = await getScanItemsRef().where('countResetAt', '==', epoch).get({ source: 'server' }); reads += Math.max(1, q.size);
    q.forEach(d => cur.push({ id: d.id, ...d.data() }));
  } catch (e) { console.warn('อ่าน items รอบนี้ไม่ได้:', e.code || e.message); report.itemsError = e.code || e.message; }
  const byStatus = {}; cur.forEach(it => { byStatus[it.status] = (byStatus[it.status] || 0) + 1; });
  // marker เภสัชของรอบนี้ (อ่านก่อน เพื่อใช้กรองด้านล่าง · ข้อ 3 ใช้ค่าชุดเดียวกัน)
  const isPharmacy = typeof _isPharmacyBranch === 'function' && _isPharmacyBranch();
  let marker = {};
  if (isPharmacy) {
    try { const m = await getPharmacyAuditMarkerRef().get({ source: 'server' }); reads++; marker = m.exists ? (m.data() || {}) : null; }
    catch (e) { console.warn('อ่าน marker ไม่ได้:', e.code || e.message); }
  }
  const markerItems = marker && (marker.countResetAt || '') === epoch ? (marker.items || {}) : {};
  // ของรอบเก่า = ไม่มีร่องรอยในรอบนี้เลย: ทั้ง firstScanAt และ timestamp เก่ากว่าตอนเริ่มรอบเกิน 5 นาที และไม่อยู่ใน marker รอบนี้
  // (เกณฑ์เดียวกับ tools/cleanup-stale-round-items.js) · ห้ามดู firstScanAt อย่างเดียว — รายการที่โดนดึงผลเก่าแล้วกด ✕
  // สแกนใหม่ firstScanAt ค้างเป็นวันรอบเก่า (✕ ไม่ล้าง) แต่ยอด/สถานะเป็นของรอบนี้จริง
  const OLD = epochMs - 5 * 60 * 1000;
  const lastTouchMs = it => { const v = [tsMs(it?.firstScanAt), tsMs(it?.timestamp)].filter(Number.isFinite); return v.length ? Math.max(...v) : NaN; };
  const oldInCur = Number.isFinite(epochMs) ? cur.filter(it => { const ms = lastTouchMs(it); return Number.isFinite(ms) && ms < OLD && !markerItems[it.id]; }) : [];
  const staleFirstOnly = Number.isFinite(epochMs) ? cur.filter(it => !oldInCur.includes(it) && tsMs(it.firstScanAt) < OLD).map(it => it.id) : [];
  oldInCur.sort((a, b) => (tsMs(a.updatedAt) - tsMs(b.updatedAt)) || String(a.id).localeCompare(String(b.id), 'en', { numeric: true }));
  report.currentRoundItems = { count: cur.length, byStatus, oldCount: oldInCur.length, staleFirstScanOnly: staleFirstOnly };
  log('2) items ของรอบนี้บน Cloud:', cur.length, 'รายการ', byStatus, `· ในนั้นเป็นของรอบเก่า ${oldInCur.length} รายการ`);
  if (staleFirstOnly.length) log(`   (อีก ${staleFirstOnly.length} รายการเวลาสแกนครั้งแรกค้างเป็นวันรอบเก่า แต่มีร่องรอยในรอบนี้ (สแกนใหม่ / อยู่ในงาน Audit รอบนี้) = งานจริง ไม่ต้องทำอะไร: ${staleFirstOnly.join(', ')})`);

  // SKU ที่จะไล่ = ที่ผู้ใช้ระบุ หรือเฉพาะตัวที่ "น่าสงสัย":
  //   ของรอบเก่าที่ค้างในรอบนี้ + Confirm แล้วในจอนี้แต่ Cloud รอบนี้ไม่มีเอกสาร + อยู่ใน marker รอบนี้แต่ไม่มีเอกสาร
  // ตัวที่ Confirm แล้วทั้งในจอนี้และบน Cloud รอบนี้ = ปกติ ไม่ต้องไล่ (หลังมีการ Confirm จริงจะมีหลายร้อยตัว)
  const curMap = new Map(cur.map(i => [i.id, i]));
  const localConfirmed = [];
  for (const [sku, sd] of state.scanData.entries()) if (CONFIRMED.includes(sd?.status)) localConfirmed.push(sku);
  const cloudConfirmed = cur.filter(it => CONFIRMED.includes(it.status)).map(it => it.id);
  const suspicious = [...oldInCur.map(i => i.id), ...localConfirmed.filter(s => !curMap.has(s)), ...Object.keys(markerItems).filter(s => !curMap.has(s))];
  const skus = [...new Set((Array.isArray(skusArg) && skusArg.length ? skusArg : suspicious).map(String))];
  report.confirmed = { local: localConfirmed.length, cloud: cloudConfirmed.length };
  log(`   รายการที่ Confirm แล้ว — ในจอนี้ ${localConfirmed.length} · บน Cloud รอบนี้ ${cloudConfirmed.length} · น่าสงสัยที่จะไล่ ${skus.length} SKU`);

  // doc ของแต่ละ SKU: ของรอบนี้ใช้ข้อมูลที่อ่านมาแล้ว (ไม่เสีย read) · ตัวที่ไม่อยู่ในรอบนี้ค่อยอ่านตรง จำกัด 100 ตัวกันยิง read เยอะ
  // ⚠️ ตัวที่เกินเพดานต้องขึ้นว่า "ไม่ได้ตรวจ" ห้ามตีความว่า "ไม่มีเอกสาร" — รุ่นแรกของสคริปต์ตัดที่ 100 ตัวรวมทั้งของรอบนี้
  //    แล้วฟ้อง "มีเฉพาะในจอนี้" ผิดๆ 169 รายการหลังมีการ Confirm จริง (SRC 26 ก.ย. 2026)
  const docMap = new Map(); const checked = new Set(); let direct = 0;
  for (const sku of skus) {
    if (curMap.has(sku)) { docMap.set(sku, curMap.get(sku)); checked.add(sku); continue; }
    if (direct >= 100) continue;
    direct++;
    try { const d = await getScanItemsRef().doc(sku).get({ source: 'server' }); reads++; checked.add(sku); if (d.exists) docMap.set(sku, { id: d.id, ...d.data() }); } catch (e) {}
  }

  // ── 3) marker ของเภสัช (อ่านไว้แล้วตอนข้อ 2) ───────────────────────────────
  if (isPharmacy) {
    if (!marker) { log('3) marker เภสัช: ไม่มี document (ถูกลบตอนเริ่มนับใหม่ และยังไม่มีใครสร้างใหม่)'); report.marker = null; }
    else {
      const mi = marker.items || {}; const mst = {};
      Object.values(mi).forEach(x => { mst[x?.status] = (mst[x?.status] || 0) + 1; });
      report.marker = { countResetAt: marker.countResetAt || '', sameRound: (marker.countResetAt || '') === epoch, count: Object.keys(mi).length, byStatus: mst,
        legacyLogBackfilledAt: fmtTs(marker.legacyLogBackfilledAt), updatedAt: fmtTs(marker.updatedAt) };
      log('3) marker เภสัช: รอบ', fmtTs(marker.countResetAt) || '(ว่าง)', (marker.countResetAt || '') === epoch ? '(รอบเดียวกับ Cloud)' : '(❌ คนละรอบ — ระบบไม่ใช้)',
        '·', Object.keys(mi).length, 'รายการ', mst, '· backfill จาก Audit Log เมื่อ', fmtTs(marker.legacyLogBackfilledAt) || '-', '· เขียนล่าสุด', fmtTs(marker.updatedAt));
    }
  }

  // ── ตารางหลัก: SKU แต่ละตัวอยู่ที่ไหน ใครเขียน ────────────────────────────
  const rows = skus.map(sku => {
    const c = docMap.get(sku); const l = state.scanData.get(sku); const mk = marker?.items?.[sku];
    let where;
    if (!checked.has(sku)) where = 'ไม่ได้ตรวจ (เกินเพดานอ่าน)';
    else if (c && (c.countResetAt || '') === epoch) where = 'items รอบนี้';
    else if (c) where = `items รอบอื่น (${fmtTs(c.countResetAt) || 'ว่าง'})`;
    else if (mk && (marker.countResetAt || '') === epoch) where = 'marker รอบนี้';
    else if (l && CONFIRMED.includes(l.status)) where = 'ในจอนี้อย่างเดียว';
    else where = '-';
    const upMs = tsMs(c?.updatedAt);
    return {
      SKU: sku, 'อยู่ที่': where,
      'สถานะ Cloud': c?.status || '', 'สถานะจอนี้': l?.status || '', 'สถานะ marker': mk?.status || '',
      'นับโดย': c?.scannedBy || l?.scannedBy || mk?.scannedBy || '', 'นับได้': c?.countedQty ?? l?.countedQty ?? '',
      'เวลานับ': itemTime(c) || itemTime(l) || mk?.firstScanAt || '', timestamp: c?.timestamp || l?.timestamp || '',
      initialStatus: c?.initialStatus || l?.initialStatus || '', auditor: c?.auditor || l?.auditor || '',
      'เขียนล่าสุดโดย': c?.updatedBy || '', 'เขียนล่าสุดเมื่อ': fmtTs(c?.updatedAt),
      'หลังเริ่มรอบ (วินาที)': Number.isFinite(upMs) && Number.isFinite(epochMs) ? Math.round((upMs - epochMs) / 1000) : '',
      rev: c?.rev ?? ''
    };
  });
  report.rows = rows;
  // doc เต็มของรายการรอบเก่าที่ค้างในรอบนี้ — ใช้ดูว่าเคยผ่าน marker/verify ไหม (pharmacyAuditMarkerAt, auditor, recheckQty ...)
  report.oldInCurrentDocs = oldInCur.map(it => ser(it));
  if (rows.length) { log('ตาราง: SKU ที่ไล่อยู่ · อยู่ที่ไหน · ใครเขียนล่าสุด'); console.table(rows); }
  if (oldInCur.length) {
    const batches = {}; oldInCur.forEach(it => { const k = `${it.updatedBy || '?'} @ ${fmtTs(it.updatedAt)}`; batches[k] = (batches[k] || 0) + 1; });
    report.oldInCurrentWriteGroups = batches;
    log('   ของรอบเก่า จัดกลุ่มตาม "ผู้เขียน @ เวลาเขียน" (เวลาเท่ากันเป๊ะ = batch เดียวกัน):', batches);
  }

  // ── 4) items ที่ค้างจากรอบอื่น ─────────────────────────────────────────────
  try {
    const q = await getScanItemsRef().where('countResetAt', '!=', epoch).limit(500).get({ source: 'server' }); reads += Math.max(1, q.size);
    const ep = {}; q.forEach(d => { const k = d.data().countResetAt || '(ว่าง)'; ep[k] = (ep[k] || 0) + 1; });
    const epLocal = Object.fromEntries(Object.entries(ep).map(([k, v]) => [fmtTs(k) || k, v]));
    report.otherRoundItems = { count: q.size, truncated: q.size >= 500, byRound: epLocal };
    log('4) items ที่ค้างจากรอบอื่น (ระบบไม่แสดง แต่ยังอยู่บน Cloud):', q.size >= 500 ? '500 รายการขึ้นไป' : `${q.size} รายการ`, epLocal);
  } catch (e) { console.warn('อ่าน items รอบอื่นไม่ได้:', e.code || e.message); report.otherRoundItems = { error: e.code || e.message }; }

  // ── 5) R01 master ──────────────────────────────────────────────────────────
  try {
    const r = await _db.collection('stock_sessions').doc(branch + '_r01').get({ source: 'server' }); reads++;
    if (!r.exists) { log('5) R01: ไม่มี document (ถูกลบตอนเริ่มนับใหม่ · บอทจะเติมรอบเช้า)'); report.r01 = null; }
    else {
      const d = r.data() || {};
      report.r01 = { r01UploadedAt: d.r01UploadedAt || '', updatedAt: fmtTs(d.updated_at), r01BaselineAt: fmtTs(d.r01BaselineAt), r16Loaded: !!d.r16Loaded };
      log('5) R01: อัปล่าสุด', d.r01UploadedAt || fmtTs(d.updated_at), '· baseline', fmtTs(d.r01BaselineAt) || '-', '· R16 โหลดแล้ว', !!d.r16Loaded);
    }
  } catch (e) {}

  // ── 6) Audit Log ตั้งแต่วันที่เริ่มรอบ (ระบบดึง log ชุดนี้กลับเป็น marker ครั้งแรกหลังเริ่มรอบ) ──
  report.auditLogs = []; report.auditLogHits = [];
  if (isPharmacy && Number.isFinite(epochMs)) {
    const today = new Date(); const first = new Date(Math.max(epochMs, today.getTime() - 13 * 86400000)); first.setHours(0, 0, 0, 0);
    const skuSet = new Set(skus);
    for (let d = new Date(first); d <= today; d.setDate(d.getDate() + 1)) {
      const ds = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      try {
        const doc = await _db.collection('stock_audit_log').doc(`${branch}_${ds}`).get({ source: 'server' }); reads++;
        if (!doc.exists) { log(`6) Audit Log ${ds}: ไม่มี`); report.auditLogs.push({ date: ds, exists: false }); continue; }
        const items = doc.data().items || [];
        const pass5 = items.filter(it => { const ms = tsMs(it.timestamp); return Number.isFinite(ms) && ms >= epochMs - 5 * 60 * 1000; });
        report.auditLogs.push({ date: ds, exists: true, count: items.length, updatedAt: fmtTs(doc.data().updatedAt), afterRoundStart: pass5.length });
        log(`6) Audit Log ${ds}: ${items.length} รายการ · เขียนล่าสุด ${fmtTs(doc.data().updatedAt)} · เวลาผ่านเกณฑ์รอบนี้ ${pass5.length} รายการ`);
        items.forEach(it => { if (skuSet.has(String(it.sku))) report.auditLogHits.push({ 'วันที่ log': ds, SKU: it.sku, status: it.status, auditor: it.auditor, timestamp: it.timestamp, firstScanAt: it.firstScanAt }); });
      } catch (e) { console.warn(`อ่าน Audit Log ${ds} ไม่ได้:`, e.code || e.message); }
    }
    if (report.auditLogHits.length) { log('   SKU ที่ไล่อยู่ซึ่งพบใน Audit Log:'); console.table(report.auditLogHits); }
  }

  // ── 7) login เข้าสาขานี้รอบ ๆ เวลาเริ่มรอบ ───────────────────────────────────
  report.logins = [];
  try {
    const q = await _db.collection('stock_login_log').orderBy('ts', 'desc').limit(300).get({ source: 'server' }); reads += Math.max(1, q.size);
    q.forEach(d => {
      const x = d.data() || {}; if (x.branch !== branch) return;
      const t = x.ts?.toDate?.();
      if (Number.isFinite(epochMs) && t && t.getTime() < epochMs - 2 * 3600 * 1000) return;
      report.logins.push({ 'เวลา': t ? fmtDate(t) : x.loginAt, 'ผู้ใช้': x.user, role: x.role, 'เครื่อง': (x.userAgent || '').includes('StockCountPDA') ? 'PDA' : 'Desktop', ip: x.ip, ua: x.userAgent || '' });
    });
    report.logins.reverse();
    log(`7) login เข้าสาขานี้ตั้งแต่ 2 ชม. ก่อนเริ่มรอบนี้: ${report.logins.length} ครั้ง`); if (report.logins.length) console.table(report.logins.map(({ ua, ...x }) => x));
  } catch (e) { console.warn('อ่าน login log ไม่ได้:', e.code || e.message); }

  // ── สรุป ────────────────────────────────────────────────────────────────────
  const onlyLocal = rows.filter(r => r['อยู่ที่'] === 'ในจอนี้อย่างเดียว');
  const inMarker = rows.filter(r => r['อยู่ที่'] === 'marker รอบนี้');
  const unchecked = rows.filter(r => r['อยู่ที่'] === 'ไม่ได้ตรวจ (เกินเพดานอ่าน)');
  log('%c── สรุป ──', 'font-weight:bold');
  if (localEpoch !== epoch) log('❌ จอนี้ยังอยู่คนละรอบกับ Cloud → สิ่งที่เห็นเป็นข้อมูลเก่าในเครื่อง ลองรีโหลดหน้าแล้วรันใหม่');
  if (oldInCur.length) log(`⚠️ ${oldInCur.length} รายการอยู่ใน items ของรอบนี้ แต่ไม่มีร่องรอยในรอบนี้เลย (เวลาสแกนครั้งแรกและล่าสุดเก่ากว่าตอนเริ่มรอบ) = ถูกเขียนกลับขึ้น Cloud หลังกดเริ่มนับใหม่ · ดูคอลัมน์ "เขียนล่าสุดโดย / เมื่อ" ว่าเป็นเครื่องไหน`);
  if (inMarker.length) log(`⚠️ ${inMarker.length} รายการมาจาก marker เภสัชของรอบนี้ (ไม่มี item doc) · ดูข้อ 3 และข้อ 6`);
  if (onlyLocal.length) log(`ℹ️ ${onlyLocal.length} รายการมีเฉพาะในจอนี้ ไม่อยู่บน Cloud → รีโหลดหน้าแล้วควรหายเอง`);
  if (unchecked.length) log(`ℹ️ ${unchecked.length} รายการไม่ได้ตรวจ (อ่านตรงเกิน 100 ตัว) — รันใหม่โดยระบุ SKU เช่น diagnoseReset(['SKU1','SKU2'])`);
  if (!oldInCur.length && !inMarker.length && !onlyLocal.length && localEpoch === epoch) log('ไม่พบรายการรอบเก่าค้างอยู่ในรอบนี้');
  report.reads = reads;
  log(`(อ่านทั้งหมด ${reads} reads — ไม่มีการเขียนใดๆ)`);
  log('คัดลอกผลทั้งหมดเป็นข้อความ:  copy(JSON.stringify(diagnoseResetReport, null, 1))   แล้ว Ctrl+V วางได้เลย');
  return report;
};

console.log('พร้อมแล้ว — พิมพ์  await diagnoseReset()  (อ่านอย่างเดียว)');
})();
