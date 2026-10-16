/*
 * tools/restore-item-from-pitr.js — ใส่ item ที่ถูกลบกลับขึ้น Cloud จากผลอ่านย้อนหลังของ Firestore PITR (16 ต.ค. 2026 · ผู้ใช้สั่ง)
 *
 * ใช้เมื่อ: กด "↺ สแกนใหม่" ผิด — restartPharmacyScan ลบ stock_sessions/{สาขา}/items/{SKU} (และ marker) บน Cloud ถาวร
 *   แล้วอ่านเอกสารเดิมย้อนหลังได้จาก Cloud Shell (batchGet + readTime) เป็นไฟล์ before-<สาขา>-<SKU>.json
 *   รูปแบบไฟล์ = ผลดิบของ Firestore REST: [{"found":{"name":".../items/<SKU>","fields":{...}},"readTime":"..."}]
 *
 * วิธีใช้ (Desktop เท่านั้น · โหลดหน้าใหม่ (F5) · login สาขาที่จะกู้ · ห้ามมีใครสแกน/Confirm ระหว่างกู้):
 *   ⚠️ วางใน Console ของ "หน้าแอป" (F12 → Console) ไม่ใช่ Cloud Shell — นี่คือ JavaScript ที่ใช้ตัวแปรของหน้าแอป
 *   1. วางไฟล์นี้ทั้งไฟล์ → Enter
 *   2. ตรวจก่อน (ไม่เขียนอะไรเลย):   await restoreFromPitr()
 *      → เลือกไฟล์ before-*.json (เลือกได้หลายไฟล์พร้อมกัน) → อ่านรายงานให้ครบ
 *   3. ถ้ารายงานถูกต้อง เขียนจริง:     await restoreFromPitr({dryRun:false})
 *      → เลือกไฟล์ชุดเดิม → พิมพ์ข้อความยืนยันตามที่ขึ้นบนจอ
 *   4. เสร็จแล้ว **โหลดหน้าเว็บใหม่ (F5) ทุกเครื่อง** (PDA: ปิด-เปิดแอป)
 *
 * Safety properties:
 * - dry-run เป็นค่าเริ่มต้น — ต้องสั่ง {dryRun:false} เองถึงจะเขียน · พิมพ์ยืนยันผิด = ยกเลิก ไม่เขียนอะไร
 * - **สร้างเอกสารใหม่เท่านั้น ห้ามทับ/ลบเด็ดขาด** — ตรวจซ้ำใน transaction ทุกครั้ง: มี SKU นั้นอยู่แล้ว (ไม่ว่ารอบไหน) = ข้าม
 *   (ผู้ช่วยสแกน SKU นั้นใหม่ไปแล้ว = ข้าม ไม่ทับยอดใหม่)
 * - ต้องเป็นสาขาเดียวกับที่ login · **รอบนับ (countResetAt) ในไฟล์ต้องตรงกับ Cloud เป๊ะ** (มีคนกด "เริ่มนับใหม่" หลังเวลาในไฟล์ = ข้าม)
 * - รองรับเฉพาะ schemaVersion 2 · ไม่กู้ถ้ากำลัง Confirm/โหลดหน้า · ไม่แตะ SKU ที่หน้านี้กำลังแก้อยู่
 * - **ไม่หยุด timer ซิงก์ของหน้านี้** (ต่างจาก restore-items.js) — หน้านี้ใช้งานต่อได้ และรับ item ที่กู้ผ่าน listener เอง
 * - ไม่แตะ marker (`{สาขา}_pharmacy_audit_markers`) : item ที่ผ่านรีเช็คมาแล้ว (auditor + initialStatus 'audit') แอปสร้าง marker กลับจาก item เอง
 *   ตอน login ครั้งถัดไป (_backfillPharmacyAuditMarkersFromLocal) · Stock Adj ตรงจากรอบแรก (directAdj) ไม่ใช้ marker อยู่แล้ว
 * - ตรวจผลจาก server หลังเขียน แล้วดาวน์โหลดไฟล์บันทึกสิ่งที่เขียน (restored-<สาขา>-<เวลา>.json) ไว้ตรวจย้อนหลัง
 *
 * ข้อจำกัด: ได้สภาพ "ณ เวลาที่อ่านย้อนหลัง" (readTime ในไฟล์) ไม่ใช่วินาทีสุดท้ายก่อนกด — ถ้ามีการแก้ในนาทีสุดท้ายจะไม่อยู่ในไฟล์
 */
(() => {
'use strict';

const ITEM_NAME_RE = /^projects\/[^/]+\/databases\/\(default\)\/documents\/stock_sessions\/([^/]+)\/items\/([^/]+)$/;
const WRITE_DELAY_MS = 25;   // เว้นจังหวะระหว่าง transaction

// ── แปลงค่า Firestore REST (typed JSON) → ค่า JS ที่ SDK เขียนได้ ─────────────────────────────
function toTimestamp(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?Z$/.exec(String(s));
  if (!m) throw new Error('timestampValue รูปแบบไม่รองรับ: ' + s);
  const sec = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) / 1000;
  const nanos = Number((m[7] || '').padEnd(9, '0'));
  return new firebase.firestore.Timestamp(sec, nanos);
}

function fromValue(v) {
  if (!v || typeof v !== 'object') throw new Error('ค่าในไฟล์ไม่ใช่รูปแบบ Firestore');
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) {
    const n = Number(v.integerValue);
    if (!Number.isSafeInteger(n)) throw new Error('integerValue ใหญ่เกินกว่าจะเก็บเป็นตัวเลข JS ได้: ' + v.integerValue);
    return n;
  }
  if ('doubleValue' in v) {
    const d = v.doubleValue;
    if (typeof d === 'string') return d === 'NaN' ? NaN : d === 'Infinity' ? Infinity : d === '-Infinity' ? -Infinity : Number(d);
    return d;
  }
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('timestampValue' in v) return toTimestamp(v.timestampValue);
  if ('mapValue' in v) return fromFields((v.mapValue && v.mapValue.fields) || {});
  if ('arrayValue' in v) return ((v.arrayValue && v.arrayValue.values) || []).map(fromValue);
  throw new Error('ชนิดข้อมูลที่ไม่รองรับ: ' + Object.keys(v).join(','));   // bytes / reference / geoPoint — item ไม่มี
}

function fromFields(fields) {
  const out = {};
  for (const k of Object.keys(fields || {})) out[k] = fromValue(fields[k]);
  return out;
}

// ไฟล์ 1 ไฟล์ = ผลอ่านเอกสาร 1 SKU ที่ "found" (ผลของ find_before) → {branch, sku, readTime, data}
function parseItemFile(name, json) {
  const entries = Array.isArray(json) ? json : [json];
  const found = entries.filter((e) => e && e.found);
  if (found.length !== 1) throw new Error(`${name}: ต้องมีเอกสาร "found" 1 รายการ (พบ ${found.length}) — ไม่ใช่ไฟล์ผลอ่านย้อนหลังที่เจอเอกสาร`);
  const doc = found[0].found;
  const m = ITEM_NAME_RE.exec(String(doc.name || ''));
  if (!m) throw new Error(`${name}: ชื่อเอกสารไม่ใช่ stock_sessions/<สาขา>/items/<SKU> (${doc.name || 'ไม่มีชื่อ'})`);
  const branch = m[1], sku = m[2];
  const data = fromFields(doc.fields || {});
  if (String(data.sku) !== sku) throw new Error(`${name}: field sku (${data.sku}) ไม่ตรงกับรหัสเอกสาร (${sku}) — ไฟล์ผิดปกติ`);
  if (!data.countResetAt) throw new Error(`${name}: ไม่มี countResetAt — กู้ไม่ได้ (ไม่รู้ว่าเป็นรอบนับไหน)`);
  return { name, branch, sku, readTime: found[0].readTime || '', data };
}

function pickFiles() {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.multiple = true;
    input.oncancel = () => reject(new Error('ไม่ได้เลือกไฟล์'));
    input.onchange = async () => {
      const files = [...(input.files || [])];
      if (!files.length) return reject(new Error('ไม่ได้เลือกไฟล์'));
      try {
        resolve(await Promise.all(files.map((f) => new Promise((res, rej) => {
          const fr = new FileReader();
          fr.onload = () => { try { res({ name: f.name, json: JSON.parse(fr.result) }); } catch (e) { rej(new Error(`${f.name}: ไม่ใช่ JSON ที่อ่านได้ (${e.message})`)); } };
          fr.onerror = () => rej(new Error(`${f.name}: อ่านไฟล์ไม่สำเร็จ`));
          fr.readAsText(f);
        }))));
      } catch (e) { reject(e); }
    };
    input.click();
  });
}

function download(name, obj) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// ตัวเลขที่ใช้ตัดสินใจ (ให้คนอ่านรายงาน) — ไม่ใช่ตัวตัดสินสถานะ
function summarize(d) {
  const f = (k) => (d[k] === null || d[k] === undefined || d[k] === '' || !Number.isFinite(Number(d[k])) ? null : Number(d[k]));
  let diff = null, how = '';
  if (d.directAdj === true && f('effectiveQty') !== null && f('systemQty') !== null) { diff = f('effectiveQty') - f('systemQty'); how = 'Stock Adj ตรง (นับ+R16 − ระบบตอน Confirm)'; }
  else if (f('recheckQty') !== null && f('recheckSystemQty') !== null) { diff = f('recheckQty') - f('recheckSystemQty'); how = 'ยอดรีเช็ค − ระบบตอนรีเช็ค'; }
  return {
    status: d.status || '', counted: f('countedQty'), recheck: f('recheckQty'), system: f('systemQty') ?? f('recheckSystemQty'),
    diff, how, by: d.scannedBy || '', auditor: d.auditor || '', at: d.firstScanAt || d.timestamp || '',
    passedRecheck: !!d.auditor && d.initialStatus === 'audit' && ['pass', 'stock_adjustment'].includes(d.status),
  };
}

function serializeForLog(v) {
  if (v === null || v === undefined) return v;
  if (typeof v.toDate === 'function') return { __ts__: v.toDate().toISOString() };
  if (v && v._methodName === 'FieldValue.serverTimestamp') return { __ts__: '(serverTimestamp)' };
  if (Array.isArray(v)) return v.map(serializeForLog);
  if (typeof v === 'object') { const o = {}; for (const k of Object.keys(v)) o[k] = serializeForLog(v[k]); return o; }
  return v;
}

async function restoreFromPitr(opts = {}) {
  const dryRun = opts.dryRun !== false;   // ต้องสั่ง false เองเท่านั้น

  if (typeof _db === 'undefined' || !_db) throw new Error('ยังไม่ได้เชื่อมต่อ Firestore — เปิดแอปและ login ก่อน');
  if (typeof currentBranch === 'undefined' || !currentBranch) throw new Error('ยังไม่ได้เลือกสาขา');
  if (typeof _isPdaApp === 'function' && _isPdaApp()) throw new Error('ต้องรันบน Desktop เท่านั้น');
  if (!navigator.onLine) throw new Error('ต้องออนไลน์');
  if (typeof _isScanSchemaV2 === 'function' && !_isScanSchemaV2()) throw new Error('หน้านี้ยังไม่ใช่ schema v2 — เครื่องมือนี้รองรับเฉพาะ v2');
  if (typeof _blockScanForBranchConfirm === 'function' && _blockScanForBranchConfirm(false)) throw new Error('กำลังโหลดหน้า หรือมีเครื่องกำลัง Confirm อยู่ — รอให้เสร็จก่อน');
  if (typeof _branchConfirming !== 'undefined' && _branchConfirming) throw new Error('เครื่องนี้กำลัง Confirm อยู่ — รอให้เสร็จก่อน');

  console.log(`[restore-pitr] โหมด: ${dryRun ? 'ตรวจอย่างเดียว (ไม่เขียน)' : '⚠️ เขียนจริง'} · สาขาที่ login: ${currentBranch}`);

  // ── 1. อ่านและตรวจไฟล์ทั้งหมดก่อน — ผิดไฟล์เดียว = หยุดทั้งชุด (ไม่กู้ครึ่งๆ กลางๆ) ──
  const rawFiles = opts.files || (console.log('[restore-pitr] เลือกไฟล์ before-*.json (เลือกได้หลายไฟล์)...'), await pickFiles());
  const parsed = rawFiles.map((f) => parseItemFile(f.name, f.json));
  const seen = new Map();
  for (const p of parsed) {
    if (p.branch !== currentBranch) throw new Error(`${p.name}: เป็นของสาขา ${p.branch} แต่ตอนนี้ login สาขา ${currentBranch} — สลับสาขาให้ตรงก่อน`);
    if (seen.has(p.sku)) throw new Error(`SKU ${p.sku} ซ้ำในไฟล์ ${seen.get(p.sku)} และ ${p.name} — เลือกไฟล์ซ้ำ?`);
    seen.set(p.sku, p.name);
  }

  // ── 2. ตรวจ Cloud: schema + รอบนับ ต้องตรงกับหน้านี้ ──
  const sessionSnap = await _db.doc(`stock_sessions/${currentBranch}`).get({ source: 'server' });
  if (!sessionSnap.exists) throw new Error('ไม่พบ session ของสาขานี้บน Cloud');
  const sess = sessionSnap.data() || {};
  let cloudEpoch = '';
  try { cloudEpoch = JSON.parse(sess.session_data_json || '{}').countResetAt || ''; } catch (e) { /* ว่าง = หยุดด้านล่าง */ }
  if (Number(sess.schemaVersion) !== 2) throw new Error(`สาขานี้เป็น schemaVersion ${sess.schemaVersion ?? 1} — เครื่องมือนี้รองรับเฉพาะ v2`);
  if (!cloudEpoch) throw new Error('อ่านรอบนับ (countResetAt) ของ Cloud ไม่ได้');
  if (typeof _countResetAt !== 'undefined' && (_countResetAt || '') !== cloudEpoch) {
    throw new Error(`หน้านี้ใช้รอบนับ ${_countResetAt || '(ว่าง)'} แต่ Cloud เป็น ${cloudEpoch} — โหลดหน้าใหม่ (F5) แล้วลองอีกครั้ง`);
  }

  // ── 3. วางแผนทีละ SKU (อ่านจาก server ว่าตอนนี้มีเอกสารอยู่ไหม) ──
  const itemsRef = _db.collection('stock_sessions').doc(currentBranch).collection('items');
  const plan = [];
  for (const p of parsed) {
    let reason = '';
    if (String(p.data.countResetAt) !== cloudEpoch) reason = `ข้าม: คนละรอบนับ (ไฟล์ ${p.data.countResetAt} / Cloud ${cloudEpoch})`;
    else if (typeof _dirtySkus !== 'undefined' && (_dirtySkus.has(p.sku) || (typeof _scanItemInFlight !== 'undefined' && _scanItemInFlight.has(p.sku)))) reason = 'ข้าม: หน้านี้กำลังแก้ SKU นี้อยู่ — รอให้ซิงก์เสร็จแล้วลองใหม่';
    else {
      const snap = await itemsRef.doc(p.sku).get({ source: 'server' });
      if (snap.exists) { const e = snap.data() || {}; reason = `ข้าม: มีเอกสารอยู่แล้ว (สถานะ ${e.status || '-'} · นับ ${e.countedQty ?? '-'} · รอบ ${e.countResetAt || '-'})`; }
    }
    plan.push({ ...p, reason, sum: summarize(p.data) });
  }
  const toRestore = plan.filter((x) => !x.reason);

  console.log('─────────── รายงาน ───────────');
  console.log(`สาขา / รอบนับ : ${currentBranch} / ${cloudEpoch}`);
  console.log(`ไฟล์ที่เลือก   : ${plan.length} · จะกู้ ${toRestore.length} · ข้าม ${plan.length - toRestore.length}`);
  console.table(plan.map((x) => ({
    SKU: x.sku, ไฟล์: x.name, 'อ่านย้อนหลัง ณ': x.readTime, สถานะเดิม: x.sum.status, นับ: x.sum.counted, รีเช็ค: x.sum.recheck, ระบบ: x.sum.system,
    'ผลต่างที่เคยขึ้นใบ': x.sum.diff, 'ผู้นับ': x.sum.by, 'ผู้ยืนยัน': x.sum.auditor, 'เวลานับ': x.sum.at, ผลตรวจ: x.reason || '✅ จะกู้',
  })));
  if (toRestore.some((x) => x.sum.passedRecheck)) console.log('ℹ️ มีรายการที่เคยผ่านรีเช็ค — marker ไม่ถูกกู้ แอปจะสร้างกลับให้เองตอน login ครั้งถัดไป (F5 ทุกเครื่องหลังกู้)');
  console.log('──────────────────────────────');

  if (!toRestore.length) { console.log('[restore-pitr] ไม่มีรายการที่ต้องกู้'); return { dryRun, created: 0, skipped: plan.length, plan }; }
  if (dryRun) {
    console.log('[restore-pitr] ตรวจอย่างเดียว ยังไม่เขียนอะไรลง Cloud');
    console.log('[restore-pitr] ถ้ารายงานข้างบนถูกต้อง ให้รัน: await restoreFromPitr({dryRun:false})');
    return { dryRun: true, willRestore: toRestore.length, skipped: plan.length - toRestore.length, plan };
  }

  // ── 4. ยืนยันด้วยมือ ──
  const phrase = `RESTORE ${currentBranch}`;
  const typed = prompt(`จะสร้างเอกสารกลับ ${toRestore.length} รายการ ในสาขา ${currentBranch}\nSKU: ${toRestore.map((x) => x.sku).join(', ')}\n(สร้างอย่างเดียว ของที่มีอยู่แล้วจะไม่ถูกแตะ)\n\nพิมพ์ข้อความนี้เพื่อยืนยัน:\n${phrase}`);
  if (typed !== phrase) { console.log('[restore-pitr] ยกเลิก — ข้อความยืนยันไม่ตรง ไม่มีอะไรถูกเขียน'); return { cancelled: true }; }

  // ── 5. เขียนทีละรายการด้วย transaction — สร้างใหม่เท่านั้น ห้ามทับ ──
  let created = 0, raced = 0;
  const failed = [], written = {};
  for (const x of toRestore) {
    const payload = { ...x.data, sku: x.sku, updatedBy: 'restore-pitr', updatedAt: firebase.firestore.FieldValue.serverTimestamp() };
    try {
      const res = await _db.runTransaction(async (tx) => {
        const snap = await tx.get(itemsRef.doc(x.sku));
        if (snap.exists) return 'exists';          // มีคนเขียนแทรกระหว่างทาง → ไม่แตะ
        tx.set(itemsRef.doc(x.sku), payload);
        return 'created';
      });
      if (res === 'created') { created++; written[x.sku] = serializeForLog(payload); } else raced++;
    } catch (e) {
      failed.push({ sku: x.sku, error: `${e.code || ''} ${e.message}`.trim() });
    }
    await new Promise((r) => setTimeout(r, WRITE_DELAY_MS));
  }

  // ── 6. ตรวจผลจาก server ──
  const verify = [];
  for (const x of toRestore) {
    const snap = await itemsRef.doc(x.sku).get({ source: 'server' });
    const d = snap.exists ? (snap.data() || {}) : null;
    verify.push({ SKU: x.sku, มีบน_Cloud: !!d, สถานะ: d ? d.status : '-', นับ: d ? d.countedQty : '-', rev: d ? d.rev : '-', รอบตรง: d ? d.countResetAt === cloudEpoch : false });
  }
  console.log('─────────── ผลการกู้คืน ───────────');
  console.log(`สร้างใหม่สำเร็จ : ${created}`);
  console.log(`ข้าม (มีเอกสารแทรกมา): ${raced}`);
  console.log(`ล้มเหลว        : ${failed.length}`);
  console.table(verify);
  if (failed.length) console.table(failed);
  console.log('───────────────────────────────────');
  try {
    if (created) download(`restored-${currentBranch}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`, { __meta__: { branch: currentBranch, epoch: cloudEpoch, at: new Date().toISOString(), by: (typeof currentUser !== 'undefined' && currentUser) || '' }, items: written });
  } catch (e) { console.warn('[restore-pitr] ดาวน์โหลดไฟล์บันทึกไม่สำเร็จ (ไม่กระทบข้อมูล):', e.message); }
  console.log('[restore-pitr] ⚠️ โหลดหน้าเว็บใหม่ (F5) ทุกเครื่อง (PDA: ปิด-เปิดแอป) เพื่อให้เห็นข้อมูลตรงกัน · ตรวจ SKU ที่กู้ในแท็บ Stock Adj / ใบ 📦');
  return { dryRun: false, created, skipped: plan.length - toRestore.length + raced, failed, verify };
}

restoreFromPitr._internals = { fromValue, fromFields, parseItemFile, summarize, toTimestamp };
window.restoreFromPitr = restoreFromPitr;
console.log('[restore-pitr] พร้อมใช้งาน — ตรวจก่อนด้วย await restoreFromPitr()  ·  เขียนจริงด้วย await restoreFromPitr({dryRun:false})');
})();
