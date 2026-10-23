// flow: แจ้งเตือน Telegram ของบอท auto-r16 — main() จริง + Firestore REST จำลอง + เซิร์ฟเวอร์ Telegram จำลองในเครื่อง (ไม่แตะเครือข่ายจริง)
//
// ทำไมต้องมี: ผู้ใช้สั่งให้บอท Confirm แทนพนักงานทุกคืน 21:10 และ "ถ้าบอทไม่ Confirm ให้ส่ง Telegram" — คืนไหนบอทไม่ทำงาน รายการ scanning ของวันนั้นถูกรีเซ็ตเช้าวันถัดไป (ต้องนับใหม่)
//   ตัวแจ้งเตือนจึงเป็นเครือข่ายนิรภัยตัวเดียวก่อนซ่อนปุ่ม Confirm ที่ Desktop → ต้องพิสูจน์ 4 อย่าง:
//   (1) ทุกทางออกที่ไม่สำเร็จได้ข้อความ ❌ ข้อความเดียว  (2) สำเร็จก็ส่งสรุปทุกคืน (เครื่องดับ/Task ไม่รัน = บอทส่งอะไรไม่ได้ → ความเงียบคือสัญญาณ)
//   (3) ส่งไม่ได้/ช้า/ตั้งค่าผิด/แจ้งเตือนพังเอง ต้องไม่เปลี่ยน exit code และไม่ทำให้งานหลักล้ม  (4) token ไม่หลุดลง log/ข้อความ
// ฝั่งบอทเป็นโค้ดจริง (main → _run → … → _notify_after_run → send_telegram) · ที่จำลองมี: Firestore REST (m._request) · นาฬิกา · time.sleep · ปลายทาง Telegram (AUTO_R16_TELEGRAM_BASE)
// เทสบอทอื่นทุกไฟล์ตั้ง AUTO_R16_NOTIFY=0 ไว้ (กันเผลอยิงจริงถ้าเครื่องพัฒนามี .env) — ไฟล์นี้เปิดเองด้วย op env · ต้องมี Python 3
const { test, expect } = require('@playwright/test');
const http = require('http');
const net = require('net');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const H = require('../../lib/r16-confirm-harness');
const { runPython, findPython, AUTO_R16 } = require('../../lib/python');
const { item, world, run, itemOf } = H;

const TOKEN = '123456789:AAFakeTokenForTestsOnly_abcdefghij012345';
const CHAT = '987654321';
const HOST = 'BIGYAMAINPC';
const ON = { op: 'env', set: { TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_CHAT_ID: CHAT, COMPUTERNAME: HOST }, unset: ['AUTO_R16_NOTIFY', 'AUTO_R16_TELEGRAM_BASE'] };
const TG = (...script) => ({ op: 'telegram', script });
const NOTIFY = (...script) => [ON, TG(...script)];

// ── สถานการณ์มาตรฐาน: SSS มี 6 รายการที่ Confirm ได้ (Pass 3 · Stock Adj 3) ──────────────────
const GOOD = [
  item('S-21', 5, '10:00:00'),                      // นับ 5 = ระบบ 5 → Pass
  item('S-22', 3, '11:00:00'),                      // นับ 3 ≠ 5 → Stock Adj ตรง
  item('S-23', 3, '11:00:00'),                      // นับ 3 + ขายก่อนสแกน 2 = 5 → Pass
  item('S-24', 4, '11:00:00'),                      // ขาย 12:00 เกิดหลังสแกน → ไม่นับ → 4 ≠ 5 → Stock Adj ตรง
  item('S-25', 0, '11:30:00', { noStock: true }),   // noStock → Stock Adj
  item('S-26', 7, '10:00:00'),                      // นับ 7 − รับเข้าก่อนสแกน 2 = 5 → Pass
];
const SALES = [['B-23', 2, '10:30:00'], ['B-24', 2, '12:00:00'], ['B-26', 2, '09:00:00', 'inbound']];
const AFTER_EXPORT = item('S-31', 3, '21:06:00');                                                      // สแกนหลังเวลา export (21:05) → บอทข้าม
const STALE = item('S-30', 3, '10:00:00', { timestamp: '2026-10-20 10:00:00', firstScanAt: '2026-10-20 10:00:00' });   // ค้างข้ามวัน → บอทข้าม
const w = (extra = [], over = {}) => world({ branches: ['SSS'], items: { SSS: [...GOOD, ...extra] }, sales: { SSS: SALES }, ...over });
const REAL = ['--confirm', '--confirm-branch', 'SSS'];
const LOCK = (exp) => ({ token: 'desktop-token', branch: 'SSS', owner: 'พนักงานเภสัช', role: 'pharmacist', countResetAt: H.EPOCH,
  expiresAt: { __ts: exp }, startedAt: { __ts: '2026-10-21T14:00:00.000000Z' } });

const HEAD_OK = `✅ auto-r16 · 21:10 21/10/2026 · ${HOST} — เรียบร้อย`;
const HEAD_FAIL = (rc, why) => `❌ auto-r16 · 21:10 21/10/2026 · ${HOST} — ไม่สำเร็จ (exit ${rc}: ${why})`;
const FILE_LINE = 'ไฟล์ R16104.CSV (export 21:05 21/10)';
const WHY = {
  1: 'อ่าน/เขียน Firestore ล้ม หรือ Confirm เขียนไปแล้วบางส่วน',
  2: 'ไฟล์/โฟลเดอร์/flag ผิด',
  4: 'ตกด่านโดยไม่ได้เขียน (ไฟล์ไม่ใช่วันนี้/ยังไม่นิ่ง · Confirm ติดเวลา/lock/tripwire)',
};
const QUICK = `แก้เร็ว: ดู log บน ${HOST}:  Get-Content .\\auto_r16.log -Tail 60 -Encoding UTF8`;
const RERUN = (br) => `รันซ้ำคืนนี้ก่อนเที่ยงคืน (หลังแก้สาเหตุ):  .\\run_auto_r16.bat --confirm --confirm-branch ${br}`;
const TOO_LATE = 'ถ้าไม่ทัน รายการ scanning ของวันนี้จะถูกรีเซ็ตเช้าพรุ่งนี้';

const textOf = (r, i = 0) => r.telegram[i].body.text;
const lines = (r, i = 0) => textOf(r, i).split('\n');
const sleepsOf = (r, v) => r.sleeps.filter((s) => s === v).length;

// token/chat ห้ามอยู่ใน log หรือข้อความ — ตรวจทุกครั้งที่มีการส่ง/ล้มเหลว
function expectNoSecrets(r, label = '') {
  for (const s of [TOKEN, CHAT]) expect(r.log, `${label} log ต้องไม่มี ${s.slice(0, 6)}…`).not.toContain(s);
  expect(r.log, `${label} log ต้องไม่มี URL ของ Telegram`).not.toContain('/bot');
  for (const t of r.telegram) expect(t.body.text, `${label} ข้อความต้องไม่มี token`).not.toContain(TOKEN);
}

// Python ฝั่งเทสสำหรับ unit test ของฟังก์ชันภายใน (โหลดบอทเป็นตัวแปร m · p = payload)
const py = (body, payload = {}) => runPython(`import os, io, contextlib, tempfile\nfrom datetime import datetime\n${body}`, payload);

// ════════════════════════════════════════════════════════════════════════════
//  1) ไม่ส่ง
// ════════════════════════════════════════════════════════════════════════════
test('ไม่ได้ตั้งค่า Telegram — ไม่ยิงเลย · log บอกเหตุผล · Confirm และ exit code เท่าเดิม', async () => {
  const none = { op: 'env', unset: ['AUTO_R16_NOTIFY', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID'] };
  const res = run({ ...w(), runs: [
    { args: REAL, ops: [none, TG()] },
    { args: REAL, ops: [{ op: 'env', set: { TELEGRAM_BOT_TOKEN: TOKEN } }] },                                 // มี token ไม่มี chat
    { args: REAL, ops: [{ op: 'env', set: { TELEGRAM_CHAT_ID: CHAT }, unset: ['TELEGRAM_BOT_TOKEN'] }] },     // มี chat ไม่มี token
  ] });
  const [a, b, c] = res.runs;
  expect(a.code, a.log).toBe(0);
  expect(a.log).toContain('แจ้งเตือน Telegram: ไม่ได้ส่ง — ยังไม่ได้ตั้ง TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID');
  expect(itemOf(a, 'SSS', 'S-21').status, 'Confirm ทำงานตามปกติแม้ไม่มีแจ้งเตือน').toBe('pass');
  expect(b.log).toContain('แจ้งเตือน Telegram: ไม่ได้ส่ง — ไม่พบ TELEGRAM_CHAT_ID');
  expect(c.log).toContain('แจ้งเตือน Telegram: ไม่ได้ส่ง — ไม่พบ TELEGRAM_BOT_TOKEN');
  for (const r of res.runs) { expect(r.code, r.log).toBe(0); expect(r.telegram, 'ไม่มีคำขอไป Telegram').toEqual([]); }
});

test('AUTO_R16_NOTIFY = 0 / false / OFF / no — เงียบสนิท (ไม่ยิง · ไม่มีบรรทัดเรื่อง Telegram ใน log) แม้ตั้ง token ถูกต้อง · ปลดแล้วส่งตามปกติ', async () => {
  const withSwitch = (v) => [{ op: 'env', set: { TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_CHAT_ID: CHAT, COMPUTERNAME: HOST, AUTO_R16_NOTIFY: v } }];
  const res = run({ ...w(), runs: [
    { args: [], ops: [...withSwitch('0'), TG()] },
    { args: [], ops: withSwitch('false') },
    { args: [], ops: withSwitch('OFF') },
    { args: [], ops: withSwitch('no') },
    { args: [], ops: withSwitch(' 0 ') },
    { args: [], ops: [ON, TG()] },   // ปลดสวิตช์ = ส่งตามปกติ (คุมว่าเงียบเพราะสวิตช์ ไม่ใช่เพราะตั้งค่าผิด)
  ] });
  for (const r of res.runs.slice(0, 5)) {
    expect(r.code, r.log).toBe(0);
    expect(r.telegram).toEqual([]);
    expect(r.log, 'ปิดด้วยสวิตช์ = ไม่พูดถึง Telegram เลย').not.toContain('Telegram');
  }
  const last = res.runs[5];
  expect(last.telegram, last.log).toHaveLength(1);
  expect(last.log).toContain('แจ้งเตือน Telegram: ส่งแล้ว');
});

test('ไม่ส่งเมื่อ --dry-run · --confirm-undo · --confirm-compare · --help · --no-notify — ส่งเฉพาะรอบ Confirm จริง (รอบควบคุมต้องส่ง)', async () => {
  const res = run({ ...w(), runs: [
    { args: REAL, ops: NOTIFY() },                                       // 0: ส่งสรุป (สร้าง journal)
    { args: ['--confirm-undo', '{JOURNAL_LATEST}', '--dry-run'] },       // 1: ซ้อมย้อน
    { args: ['--confirm-undo', '{JOURNAL_LATEST}'] },                    // 2: ย้อนจริง → items กลับเป็น scanning
    { args: ['--confirm-compare'] },                                     // 3: เทียบเงา
    { args: [...REAL, '--dry-run'] },                                    // 4: ซ้อม
    { args: [...REAL, '--no-notify'] },                                  // 5: Confirm จริงแต่ปิดแจ้งเตือนรอบนี้
    { args: ['--help'] },                                                // 6
    { args: REAL },                                                      // 7: ควบคุม — ไม่มีรายการ scanning แล้ว แต่ยังต้องส่งสรุป (ความเงียบ = สัญญาณ)
  ] });
  const r = res.runs;
  expect(r[0].telegram).toHaveLength(1);
  expect(r[0].code, r[0].log).toBe(0);
  expect(r[1].code, r[1].log).toBe(0);
  expect(r[2].code, r[2].log).toBe(0);
  expect(itemOf(r[2], 'SSS', 'S-21').status, 'ย้อนจริงแล้ว items กลับเป็น scanning').toBe('scanning');
  expect(r[4].code, r[4].log).toBe(0);
  expect(r[5].code, r[5].log).toBe(0);
  expect(itemOf(r[5], 'SSS', 'S-21').status, '--no-notify ยัง Confirm ตามปกติ').toBe('pass');
  expect(r[6].code).toBe(0);
  for (const i of [1, 2, 3, 4, 5, 6]) {
    expect(r[i].telegram, `รอบ ${i} ต้องไม่ส่ง\n${r[i].log}`).toEqual([]);
    expect(r[i].log, `รอบ ${i}: ไม่ส่งโดยตั้งใจ ≠ ส่งไม่ได้ — ไม่มีบรรทัดเตือน`).not.toContain('ส่ง Telegram ไม่สำเร็จ');
  }
  expect(r[5].log, '--no-notify ไม่พูดถึง Telegram').not.toContain('แจ้งเตือน Telegram');
  expect(r[7].code, r[7].log).toBe(0);
  expect(r[7].telegram, 'คืนที่ไม่มีอะไรให้ Confirm ก็ยังส่งสรุป').toHaveLength(1);
  expect(lines(r[7])[2]).toBe('SSS: R16 เหมือนเดิม (ไม่เขียนซ้ำ) · Confirm: ไม่มีรายการ scanning');
});

// ════════════════════════════════════════════════════════════════════════════
//  2) ส่งสรุปเมื่อสำเร็จ
// ════════════════════════════════════════════════════════════════════════════
test('สำเร็จ — ส่งสรุป 1 ข้อความ: ปลายทาง · chat_id · ตัวเลขตรงผล Confirm จริง · ผลงานหลักไม่เปลี่ยนเพราะมีแจ้งเตือน', async () => {
  const res = run({ ...w(), runs: [{ args: REAL, ops: NOTIFY() }] });
  const r = res.runs[0];
  expect(r.code, r.log).toBe(0);
  expect(r.telegram).toHaveLength(1);
  const t = r.telegram[0];
  expect(t.path).toBe(`/bot${TOKEN}/sendMessage`);
  expect(t.ctype, 'Telegram รับเฉพาะ JSON ที่ประกาศชนิดไว้').toMatch(/^application\/json/);
  expect(t.body).toMatchObject({ chat_id: CHAT, disable_web_page_preview: true });
  expect(t.body.text).toBe([HEAD_OK, FILE_LINE, 'SSS: R16 เผยแพร่แล้ว · Confirm 6 รายการ (Pass 3 · Stock Adj 3)'].join('\n'));
  expect(r.log).toContain('แจ้งเตือน Telegram: ส่งแล้ว');
  for (const sku of ['S-21', 'S-23', 'S-26']) expect(itemOf(res, 'SSS', sku).status, sku).toBe('pass');
  for (const sku of ['S-22', 'S-24', 'S-25']) expect(itemOf(res, 'SSS', sku).status, sku).toBe('stock_adjustment');
  expectNoSecrets(r);
});

test('สำเร็จแต่บอทข้ามรายการ — ระบุจำนวน/เหตุผล + เตือนว่ายังเป็น scanning จะถูกรีเซ็ตเช้าพรุ่งนี้', async () => {
  const res = run({ ...w([AFTER_EXPORT, STALE]), runs: [{ args: REAL, ops: NOTIFY() }] });
  const r = res.runs[0];
  expect(r.code, r.log).toBe(0);
  const L = lines(r);
  expect(L[0]).toBe(HEAD_OK);
  expect(L[2]).toBe('SSS: R16 เผยแพร่แล้ว · Confirm 6 รายการ (Pass 3 · Stock Adj 3) · ⚠️ ข้าม 2 (สแกนหลังเวลา export 1 · ค้างข้ามวัน 1) ยังเป็น scanning');
  expect(L[3]).toBe('⚠️ รายการ scanning ที่ยังไม่ถูก Confirm: 2 รายการ — จะถูกรีเซ็ตเช้าพรุ่งนี้ (ต้องนับใหม่)');
  expect(itemOf(res, 'SSS', 'S-31').status, 'รายการที่ข้ามต้องยังเป็น scanning').toBe('scanning');
});

test('คืนที่ไม่มีอะไรให้ Confirm — ยังส่งสรุป (ความเงียบต้องแปลว่าบอทไม่ได้รัน) · ไม่เตือนรายการค้างเมื่อไม่มีค้างจริง', async () => {
  const empty = world({ branches: ['SSS'], items: { SSS: [] }, sales: { SSS: SALES } });
  const onlySkipped = world({ branches: ['SSS'], items: { SSS: [AFTER_EXPORT] }, sales: { SSS: SALES } });
  const a = run({ ...empty, runs: [{ args: REAL, ops: NOTIFY() }] }).runs[0];
  expect(a.code, a.log).toBe(0);
  expect(lines(a)).toEqual([HEAD_OK, FILE_LINE, 'SSS: R16 เผยแพร่แล้ว · Confirm: ไม่มีรายการ scanning']);
  const b = run({ ...onlySkipped, runs: [{ args: REAL, ops: NOTIFY() }] }).runs[0];
  expect(b.code, b.log).toBe(0);
  expect(lines(b)[2]).toBe('SSS: R16 เผยแพร่แล้ว · Confirm 0 รายการ (ผ่านตัวคัดกรอง 0 จาก 1) · ⚠️ ข้าม 1 (สแกนหลังเวลา export 1) ยังเป็น scanning');
  expect(lines(b)[3]).toBe('⚠️ รายการ scanning ที่ยังไม่ถูก Confirm: 1 รายการ — จะถูกรีเซ็ตเช้าพรุ่งนี้ (ต้องนับใหม่)');
});

test('Task ไม่มี --confirm* — สรุปเตือนว่า Confirm โดยบอทปิดอยู่ · โหมดเงา — ไม่เตือนปิด แต่ระบุว่าไม่ได้เขียน', async () => {
  const res = run({ ...w(), runs: [{ args: [], ops: NOTIFY() }, { args: ['--confirm-shadow'], ops: [TG()] }] });
  expect(lines(res.runs[0])).toEqual([HEAD_OK, FILE_LINE, 'SSS: R16 เผยแพร่แล้ว',
    '⚠️ Confirm โดยบอทปิดอยู่ (Task ไม่มี --confirm) — ต้องกด Confirm ที่ Desktop เอง']);
  const shadow = res.runs[1];
  expect(shadow.code, shadow.log).toBe(0);
  expect(lines(shadow)[2]).toBe('SSS: R16 เหมือนเดิม (ไม่เขียนซ้ำ) · เงา (ไม่เขียน): ทำนาย 6 รายการ (Pass 3 · Stock Adj 3)');
  expect(textOf(shadow), 'โหมดเงาเป็นความตั้งใจ ไม่ใช่ความผิดพลาดของ Task').not.toContain('ปิดอยู่');
  expect(textOf(shadow), 'โหมดเงาไม่นับรายการค้าง').not.toContain('ยังไม่ถูก Confirm');
});

// ════════════════════════════════════════════════════════════════════════════
//  3) ล้มเหลวทุกทาง → ❌ ข้อความเดียว · exit code เท่าเดิม
// ════════════════════════════════════════════════════════════════════════════
test('ไฟล์ R16 ไม่ใช่ของวันนี้ (exit 4) — ❌ พร้อมบรรทัดสาเหตุจาก log + วิธีรันซ้ำก่อนเที่ยงคืน · สถานะรอบก่อนไม่ค้างมาปนข้อความ (ล้างทุกรอบ)', async () => {
  const res = run({ ...w(), runs: [
    { args: REAL, ops: NOTIFY() },                                              // 0: สำเร็จ — ตั้งผลรายสาขา/ไฟล์/โฟลเดอร์/บรรทัดเตือนในสถานะของรอบ
    { args: REAL, ops: [{ op: 'mtime', at: '2026-10-20T21:05:00+07:00' }] },    // 1: ตกด่านไฟล์เก่า (exit 4 ก่อนมีผลรายสาขา) — ห้ามมีร่องรอยของรอบ 0
    { args: REAL, ops: [{ op: 'mtime', at: H.MTIME }] },                        // 2: สำเร็จอีกรอบ — ห้ามมีร่องรอยของรอบ 1
  ] });
  const [first, bad, good] = res.runs;
  expect(first.code, first.log).toBe(0);
  expect(first.telegram).toHaveLength(1);
  expect(bad.code, bad.log).toBe(4);
  expect(bad.telegram).toHaveLength(1);
  expect(lines(bad), 'ไม่มีบรรทัดรายสาขา/คำเตือนรายการค้างของรอบ 0 ปนมา').toEqual([
    HEAD_FAIL(4, WHY[4]),
    'ไฟล์ R16104.CSV (export 21:05 20/10)',
    'จาก log:',
    '  ❌ ไฟล์ไม่ได้ถูกแก้ไขวันนี้ — ยกเลิก (ไม่เขียน Firestore). ใช้ --force ถ้าตั้งใจ',
    '  สาเหตุที่พบบ่อย: Task BOT16104 (ตัว export) ไม่ได้รัน/ยังไม่เสร็จ — ไปแก้ตรงนั้นก่อน · หรือ Task นี้ตั้งเวลาเร็วกว่าที่ไฟล์เสร็จ (ดู LastWriteTime)',
    QUICK, RERUN('SSS'), TOO_LATE,
  ]);
  expect(good.code, good.log).toBe(0);
  expect(good.telegram, 'รอบสามส่ง 1 ข้อความ').toHaveLength(1);
  expect(lines(good), 'รอบสามเป็น ✅ ไม่มีของค้างจากรอบที่ล้ม').toEqual([HEAD_OK, FILE_LINE, 'SSS: R16 เหมือนเดิม (ไม่เขียนซ้ำ) · Confirm: ไม่มีรายการ scanning']);
});

test('flag ผิด (exit 2) — ❌ ชี้ไปที่ -Argument ของ Task · ไม่ใส่ข้อความ USAGE ทั้งก้อน · exit code ยัง 2', async () => {
  const res = run({ ...w(), runs: [
    { args: ['--bogus'], ops: NOTIFY() },
    { args: ['--confirm'] },                 // --confirm ไม่มี --confirm-branch
    { args: ['--branch', 'XXX'] },           // สาขาไม่มีจริง
  ] });
  const [a, b, c] = res.runs;
  for (const r of res.runs) { expect(r.code, r.log).toBe(2); expect(r.telegram, r.log).toHaveLength(1); }
  expect(lines(a)).toEqual([
    HEAD_FAIL(2, WHY[2]), 'จาก log:', '  ❌ flag ไม่รู้จัก: --bogus', QUICK, 'ตรวจ -Argument ของ Task AutoR16Import (flag ผิด)',
  ]);
  expect(textOf(a), 'ไม่ใส่ USAGE').not.toContain('ใช้: python auto_r16_import.py');
  expect(textOf(b)).toContain('❌ --confirm ต้องระบุสาขาที่ให้ Confirm จริงด้วย --confirm-branch');
  expect(textOf(c)).toContain('❌ --branch ต้องเป็น SRC, KKL, SSS (เจอ: XXX)');
});

test('ไม่พบไฟล์ R16 ในโฟลเดอร์ (exit 2) — ❌ พร้อมสาเหตุ + วิธีรันซ้ำ', async () => {
  const res = run({ ...w(), runs: [{ args: REAL, ops: [...NOTIFY(), { op: 'unlink_csv' }] }] });
  const r = res.runs[0];
  expect(r.code, r.log).toBe(2);
  expect(lines(r)).toEqual([
    HEAD_FAIL(2, WHY[2]), 'จาก log:',
    "  ❌ ไม่พบไฟล์ตรงรูปแบบ 'R16104*.CSV' ในโฟลเดอร์ (ไฟล์ชื่อมี '.part.' ถูกข้ามโดยตั้งใจ) — ยกเลิก",
    '  ไฟล์ที่มีในโฟลเดอร์: (ว่าง)',
    QUICK, RERUN('SSS'), TOO_LATE,
  ]);
});

test('tripwire (Stock Adj สูงผิดปกติ → ไม่เขียน · exit 4) — ❌ บอกอัตรา · จำนวนรายการค้าง · วิธีปรับเพดาน', async () => {
  const res = run({ ...w(), consts: { CONFIRM_TRIPWIRE_MIN_ITEMS: 1 }, runs: [{ args: [...REAL, '--confirm-max-adj-ratio', '0.1'], ops: NOTIFY() }] });
  const r = res.runs[0];
  expect(r.code, r.log).toBe(4);
  const L = lines(r);
  expect(L[0]).toBe(HEAD_FAIL(4, WHY[4]));
  expect(L[2]).toBe('SSS: R16 เผยแพร่แล้ว · ❌ tripwire: Stock Adj 3/6 = 50% เกินเพดาน — ไม่ได้เขียน (ตรวจ R01/R16 แล้วปรับ --confirm-max-adj-ratio)');
  expect(L[3]).toBe('⚠️ รายการ scanning ที่ยังไม่ถูก Confirm: 6 รายการ — จะถูกรีเซ็ตเช้าพรุ่งนี้ (ต้องนับใหม่)');
  expect(textOf(r)).toContain('  ❌ TRIPWIRE: Stock Adj 3/6 = 50.0% เกินเพดาน 10%');
  expect(textOf(r), 'บรรทัดต่อ (ย่อหน้า) ของ log ติดมาด้วย').toContain('  ตรวจแล้วถ้าถูกต้อง: รันใหม่ด้วย --confirm-max-adj-ratio');
  expect(L.slice(-3)).toEqual([QUICK, RERUN('SSS'), TOO_LATE]);
  for (const sku of ['S-21', 'S-22']) expect(itemOf(res, 'SSS', sku).status, 'tripwire ไม่เขียนอะไร').toBe('scanning');
});

test('Desktop ถือ lock อยู่ (exit 4) — ❌ ไม่ทราบจำนวนรายการค้าง (ตกด่านก่อนนับ) ต้องบอกตรงๆ ไม่ใช่ 0', async () => {
  const ww = w();
  ww.docs['stock_sessions/SSS_confirm_lock'] = LOCK('2026-10-21T14:12:00.000000Z');
  const r = run({ ...ww, runs: [{ args: REAL, ops: NOTIFY() }] }).runs[0];
  expect(r.code, r.log).toBe(4);
  const L = lines(r);
  expect(L[2]).toBe('SSS: R16 เผยแพร่แล้ว · ❌ Confirm มี lock ถืออยู่ ไม่ได้เขียน');
  expect(L[3]).toBe('⚠️ รายการ scanning ที่ยังไม่ถูก Confirm: ไม่ทราบจำนวน — จะถูกรีเซ็ตเช้าพรุ่งนี้ (ต้องนับใหม่)');
  expect(textOf(r)).toContain('  ❌ มี lock ถืออยู่ (พนักงานเภสัช)');
});

test('เขียนไปแล้วบางส่วนแล้วล้ม (exit 1) — ❌ บอกจำนวนที่เขียนแล้ว/ที่ค้าง + journal สำหรับย้อน', async () => {
  const res = run({ ...w(), consts: { CONFIRM_BATCH_SIZE: 2 },
    script: [{ type: 'touch_before_commit', match: '/items/', nth: 2, path: 'stock_sessions/SSS/items/S-23', set: { countedQty: 9 } }],
    runs: [{ args: REAL, ops: NOTIFY() }] });
  const r = res.runs[0];
  expect(r.code, r.log).toBe(1);
  const L = lines(r);
  expect(L[0]).toBe(HEAD_FAIL(1, WHY[1]));
  expect(L[2]).toBe('SSS: R16 เผยแพร่แล้ว · ❌ Confirm ข้อมูลเปลี่ยนระหว่างทำ (เขียนไปแล้ว 2 รายการ) · รอ Confirm 6 รายการ');
  expect(L[3]).toBe('⚠️ รายการ scanning ที่ยังไม่ถูก Confirm: 4 รายการ — จะถูกรีเซ็ตเช้าพรุ่งนี้ (ต้องนับใหม่)');
  expect(textOf(r)).toContain('เขียนไปแล้ว 2/6 รายการก่อนล้ม');
  expect(textOf(r)).toContain('--confirm-undo');
});

test('หลายสาขา — แสดงทีละสาขาตามลำดับ SRC/KKL/SSS · สาขาที่ R01 ไม่ใช่ของวันนี้ตกด่านและไม่บังสาขาอื่น (exit 4)', async () => {
  const ww = world({ branches: ['SRC', 'KKL', 'SSS'], items: { SRC: [item('S-21', 5, '10:00:00')], KKL: [item('S-21', 4, '10:00:00')], SSS: [item('S-21', 5, '10:00:00')] } });
  ww.docs['stock_sessions/KKL_r01'].r01UploadedAt = '07:31 น. 20/10/2026';   // R01 เมื่อวาน
  const res = run({ ...ww, runs: [{ args: ['--confirm', '--confirm-branch', 'SRC,KKL,SSS'], ops: NOTIFY() }] });
  const r = res.runs[0];
  expect(r.code, r.log).toBe(4);
  const L = lines(r);
  expect(L.slice(0, 5)).toEqual([HEAD_FAIL(4, WHY[4]), FILE_LINE,
    'SRC: R16 เผยแพร่แล้ว · Confirm 1 รายการ (Pass 1 · Stock Adj 0)',
    'KKL: R16 ตกด่าน ไม่ได้เขียน · ❌ Confirm ตกด่าน ไม่ได้เขียน',
    'SSS: R16 เผยแพร่แล้ว · Confirm 1 รายการ (Pass 1 · Stock Adj 0)']);
  expect(L[5]).toBe('⚠️ รายการ scanning ที่ยังไม่ถูก Confirm: ไม่ทราบจำนวน — จะถูกรีเซ็ตเช้าพรุ่งนี้ (ต้องนับใหม่)');
  expect(textOf(r)).toContain('  ❌ R01 ของสาขาไม่ได้อัปวันนี้ (อัปล่าสุด 2026-10-20)');
  expect(L[L.length - 2]).toBe(RERUN('SRC,KKL,SSS'));
  expect(itemOf(res, 'SRC', 'S-21').status, 'สาขาอื่นยัง Confirm ตามปกติ').toBe('pass');
  expect(itemOf(res, 'SSS', 'S-21').status).toBe('pass');
});

test('ข้อผิดพลาดที่ไม่คาดคิด (exception หลุด) — traceback ยังพิมพ์ลง log · ได้ ❌ · exit code เป็น 1 (เดิมคือ Python ตายด้วย traceback แล้ว Task Scheduler เห็น 1 เหมือนกัน)', async () => {
  const res = run({ ...w(), runs: [{ args: REAL, ops: [...NOTIFY(), { op: 'break', name: 'split_by_branch' }] }] });
  const r = res.runs[0];
  expect(r.code, r.log).toBe(1);
  expect(r.log).toContain('Traceback (most recent call last)');
  expect(r.log).toContain('ZeroDivisionError');
  expect(r.log).toContain('❌ ผิดพลาดที่ไม่คาดคิด — ดู traceback ด้านบน');
  expect(r.telegram).toHaveLength(1);
  expect(lines(r)).toEqual([HEAD_FAIL(1, WHY[1]), FILE_LINE, 'จาก log:', '  ❌ ผิดพลาดที่ไม่คาดคิด — ดู traceback ด้านบน', QUICK, RERUN('SSS'), TOO_LATE]);
});

// ════════════════════════════════════════════════════════════════════════════
//  4) --notify-test
// ════════════════════════════════════════════════════════════════════════════
test('--notify-test — ส่งข้อความทดสอบข้อความเดียวแล้วจบ: ไม่แตะ Firestore/ไฟล์ · log ปิดบัง chat · ไม่เผย token', async () => {
  const res = run({ ...w(), runs: [{ args: ['--notify-test'], ops: NOTIFY() }] });
  const r = res.runs[0];
  expect(r.code, r.log).toBe(0);
  expect(r.telegram, 'ข้อความทดสอบข้อความเดียว (ไม่ส่งสรุปซ้ำ)').toHaveLength(1);
  expect(textOf(r)).toBe(`🔔 ทดสอบแจ้งเตือน auto-r16 · ${HOST} · 21:10 21/10/2026\nถ้าเห็นข้อความนี้ แปลว่าการแจ้งเตือนใช้ได้`);
  expect(r.requests, 'ไม่แตะ Firestore').toEqual([]);
  expect(r.writes).toEqual([]);
  expect(r.log).toContain('Telegram: ใช้ค่าจาก ตัวแปรระบบ TELEGRAM_BOT_TOKEN · chat ***321');
  expect(r.log).toContain('✅ ส่งข้อความทดสอบแล้ว — ตรวจในแชท');
  expectNoSecrets(r);
});

test('--notify-test — ผลทุกแบบ: ส่งไม่สำเร็จ = exit 1 · ตั้งค่าไม่ครบ/ผิด/ปิดสวิตช์ = exit 2 และบอกวิธีแก้', async () => {
  const unset = { op: 'env', unset: ['AUTO_R16_NOTIFY', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID'] };
  const res = run({ ...w(), runs: [
    { args: ['--notify-test'], ops: [ON, TG({ status: 500 }, { status: 500 })] },   // 0: ส่งไม่สำเร็จ
    { args: ['--notify-test'], ops: [unset] },                                       // 1: ไม่ได้ตั้งค่า
    { args: ['--notify-test'], ops: [{ op: 'env', set: { TELEGRAM_BOT_TOKEN: 'SECRETVALUE-not-a-token', TELEGRAM_CHAT_ID: CHAT } }] },   // 2: รูปแบบผิด
    { args: ['--notify-test'], ops: [{ op: 'env', set: { TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_CHAT_ID: CHAT, AUTO_R16_NOTIFY: '0' } }] },    // 3: ปิดสวิตช์
  ] });
  const [a, b, c, d] = res.runs;
  expect(a.code, a.log).toBe(1);
  expect(a.telegram).toHaveLength(2);
  expect(a.log).toContain('❌ ส่ง Telegram ไม่สำเร็จ (HTTP 500)');
  expectNoSecrets(a);
  expect(b.code, b.log).toBe(2);
  expect(b.log).toContain('❌ ส่งข้อความทดสอบไม่ได้ — ยังไม่ได้ตั้ง TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID');
  expect(b.log).toContain('ดู README.md §แจ้งเตือน Telegram');
  expect(c.code, c.log).toBe(2);
  expect(c.log).toContain('TELEGRAM_BOT_TOKEN รูปแบบไม่ถูก');
  expect(c.log, 'ไม่สะท้อนค่าที่ตั้งผิดกลับมา').not.toContain('SECRETVALUE');
  expect(d.code, d.log).toBe(2);
  expect(d.log).toContain('AUTO_R16_NOTIFY ปิดอยู่');
  for (const r of [b, c, d]) { expect(r.telegram, r.log).toEqual([]); expect(r.requests).toEqual([]); }
});

test('--notify-test ใช้เดี่ยวๆ — ผสมกับ flag อื่น (ที่ทำงานหลัก/เขียน) ถูกปฏิเสธ exit 2 ไม่ส่งและไม่ทำงานหลัก', async () => {
  const combos = [['--dry-run'], ['--force'], ['--no-notify'], ['--confirm-shadow'], ['--confirm', '--confirm-branch', 'SSS'], ['--confirm-compare'], ['--confirm-undo', 'x.json']];
  const res = run({ ...w(), runs: combos.map((c) => ({ args: ['--notify-test', ...c] })) });
  res.runs.forEach((r, i) => {
    expect(r.code, `${combos[i].join(' ')}\n${r.log}`).toBe(2);
    expect(r.log).toContain('--notify-test ใช้เดี่ยวๆ');
    expect(r.telegram).toEqual([]);
    expect(r.requests, 'ไม่ทำงานหลัก').toEqual([]);
  });
});

// ════════════════════════════════════════════════════════════════════════════
//  5) ส่งไม่ได้/ช้า — ห้ามกระทบงานหลัก
// ════════════════════════════════════════════════════════════════════════════
test('Telegram ตอบ 5xx ทั้งสองครั้ง — ลองซ้ำ 1 ครั้งหลังรอ 1.5 วิ · exit code และผล Confirm เท่าเดิม · log บอกสั้นๆ ไม่มีความลับ', async () => {
  const res = run({ ...w(), runs: [{ args: REAL, ops: NOTIFY({ status: 500 }, { status: 500 }) }] });
  const r = res.runs[0];
  expect(r.code, r.log).toBe(0);
  expect(r.telegram, 'ลอง 2 ครั้ง ไม่เกิน').toHaveLength(2);
  expect(sleepsOf(r, 1.5), 'รอก่อนลองซ้ำ 1 ครั้ง').toBe(1);
  expect(r.log).toContain('⚠️ ส่ง Telegram ไม่สำเร็จ (HTTP 500) — งานหลักไม่กระทบ');
  expect(itemOf(res, 'SSS', 'S-21').status, 'Confirm ไม่ได้รับผลกระทบจากการส่งล้ม').toBe('pass');
  expectNoSecrets(r);
});

test('ตารางการลองซ้ำ — 4xx (ค่าผิด) ไม่ลองซ้ำ · 429/5xx/ok=false ลองซ้ำ 1 ครั้ง แล้วสำเร็จหรือล้ม · ทุกแบบ exit 0', async () => {
  const cases = [
    ['400', [{ status: 400 }], 1, false, 'HTTP 400'],
    ['401 (token ผิด)', [{ status: 401 }], 1, false, 'HTTP 401'],
    ['403 (บอทถูกบล็อก)', [{ status: 403 }], 1, false, 'HTTP 403'],
    ['404', [{ status: 404 }], 1, false, 'HTTP 404'],
    ['429 แล้วสำเร็จ', [{ status: 429 }], 2, true, ''],
    ['502 แล้วสำเร็จ', [{ status: 502 }], 2, true, ''],
    ['ok=false สองครั้ง', [{ json: { ok: false } }, { json: { ok: false } }], 2, false, 'Telegram ตอบ ok=false'],
    ['ok=false แล้วสำเร็จ', [{ json: { ok: false } }], 2, true, ''],
  ];
  const res = run({ ...w(), runs: cases.map(([, script]) => ({ args: [], ops: [ON, TG(...script)] })) });
  res.runs.forEach((r, i) => {
    const [label, , reqs, ok, reason] = cases[i];
    expect(r.code, `${label}\n${r.log}`).toBe(0);
    expect(r.telegram.length, `${label}: จำนวนคำขอ`).toBe(reqs);
    expect(sleepsOf(r, 1.5), `${label}: รอก่อนลองซ้ำ`).toBe(reqs - 1);
    if (ok) expect(r.log, label).toContain('แจ้งเตือน Telegram: ส่งแล้ว');
    else expect(r.log, label).toContain(`⚠️ ส่ง Telegram ไม่สำเร็จ (${reason}) — งานหลักไม่กระทบ`);
    expectNoSecrets(r, label);
  });
});

test('เครือข่ายใช้ไม่ได้ (ปลายทางไม่ตอบรับ) — ลองซ้ำ 1 ครั้ง · log ไม่มี URL/token (เหตุผลเป็นชื่อชนิด error เท่านั้น)', async () => {
  const closed = await new Promise((resolve) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
  const res = run({ ...w(), runs: [{ args: REAL, ops: [{ op: 'env', set: { TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_CHAT_ID: CHAT, COMPUTERNAME: HOST, AUTO_R16_TELEGRAM_BASE: `http://127.0.0.1:${closed}` }, unset: ['AUTO_R16_NOTIFY'] }] }] });
  const r = res.runs[0];
  expect(r.code, r.log).toBe(0);
  expect(sleepsOf(r, 1.5)).toBe(1);
  expect(r.log).toContain('⚠️ ส่ง Telegram ไม่สำเร็จ (URLError) — งานหลักไม่กระทบ');
  expect(itemOf(res, 'SSS', 'S-21').status).toBe('pass');
  expectNoSecrets(r);
});

test('exception ที่ข้อความมี URL เต็ม (รวม token) — เหตุผลใน log เป็นแค่ชื่อชนิด error · ไม่มี token/URL หลุด · ยังลองซ้ำ 1 ครั้ง', async () => {
  const res = run({ ...w(), runs: [{ args: REAL, ops: [...NOTIFY(), { op: 'urlopen_raises' }] }] });
  const r = res.runs[0];
  expect(r.code, r.log).toBe(0);
  expect(r.log).toContain('⚠️ ส่ง Telegram ไม่สำเร็จ (RuntimeError) — งานหลักไม่กระทบ');
  expect(sleepsOf(r, 1.5)).toBe(1);
  expect(r.log).not.toContain('boom');
  expectNoSecrets(r);
});

test('Telegram ตอบช้ากว่า timeout ต่อคำขอ — ตัดที่ timeout แล้วลองซ้ำ (ครั้งที่สองสำเร็จ) ไม่รอจนครบเวลาที่เซิร์ฟเวอร์หน่วง', async () => {
  const res = run({ ...w(), consts: { TELEGRAM_TIMEOUT_SECONDS: 1 }, runs: [{ args: [], ops: NOTIFY({ hang: 4 }, {}) }] });
  const r = res.runs[0];
  expect(r.code, r.log).toBe(0);
  expect(r.telegram, 'คำขอแรกค้าง → หมดเวลา → ลองซ้ำ').toHaveLength(2);
  expect(r.log).toContain('แจ้งเตือน Telegram: ส่งแล้ว');
  expect(r.elapsed, 'ต้องไม่รอเซิร์ฟเวอร์หน่วงครบ 4 วิ').toBeLessThan(3.5);
  expect(r.elapsed).toBeGreaterThan(0.8);
});

test('Telegram ไม่ตอบเลย — งานหลักจบภายในเพดานรวม (TELEGRAM_TOTAL_SECONDS) · exit code เท่าเดิม · ไม่ค้างรอ', async () => {
  const t0 = Date.now();
  const res = run({ ...w(), consts: { TELEGRAM_TOTAL_SECONDS: 2 }, runs: [{ args: REAL, ops: NOTIFY({ hang: 8 }) }] });
  const wall = Date.now() - t0;
  const r = res.runs[0];
  expect(wall, 'โปรเซสต้องจบทันทีหลังงานหลัก ไม่รอ thread ส่งที่ค้างอยู่ (daemon) — ไม่งั้น Task Scheduler ค้างรอ').toBeLessThan(6500);
  expect(r.code, r.log).toBe(0);
  expect(r.log).toContain('⚠️ ส่ง Telegram ไม่สำเร็จ (เกิน 2 วินาที) — งานหลักไม่กระทบ');
  expect(r.elapsed, 'ถูกตัดที่เพดานรวม ไม่ใช่รอครบ 8 วิ').toBeLessThan(5);
  expect(r.elapsed).toBeGreaterThan(1.8);
  expect(itemOf(res, 'SSS', 'S-21').status).toBe('pass');
  expectNoSecrets(r);
});

test('ตัวแจ้งเตือนพังเอง (build_notice / send_telegram / load_telegram_config) — exit code เท่าเดิม · งานหลักครบ · log เตือนชื่อชนิด error', async () => {
  for (const name of ['build_notice', 'send_telegram', 'load_telegram_config']) {
    const ok = run({ ...w(), runs: [{ args: REAL, ops: [...NOTIFY(), { op: 'break', name }] }] });
    const r = ok.runs[0];
    expect(r.code, `${name}\n${r.log}`).toBe(0);
    expect(r.telegram, `${name}: ไม่ส่งอะไร`).toEqual([]);
    expect(r.log, name).toContain('⚠️ แจ้งเตือน Telegram ผิดพลาด (ZeroDivisionError) — งานหลักไม่กระทบ');
    expect(itemOf(ok, 'SSS', 'S-21').status, `${name}: Confirm ยังสำเร็จ`).toBe('pass');
    // ตกด่าน + ตัวแจ้งเตือนพัง → ต้องยังได้ exit 4 เดิม (ไม่กลายเป็น 0 หรือ 1)
    const bad = run({ ...w(), runs: [{ args: REAL, ops: [...NOTIFY(), { op: 'mtime', at: '2026-10-20T21:05:00+07:00' }, { op: 'break', name }] }] }).runs[0];
    expect(bad.code, `${name} + ตกด่าน\n${bad.log}`).toBe(4);
  }
});

// ════════════════════════════════════════════════════════════════════════════
//  6) ความลับ
// ════════════════════════════════════════════════════════════════════════════
test('token ไม่หลุดลงข้อความ แม้ log มีค่าที่หน้าตาเหมือน token (เช่น --branch พิมพ์ผิดเป็น token) — ถูกแทนด้วย ***', async () => {
  const leaked = '555123456:ZZLeakedLookingTokenValue_1234567890abcdef';
  const res = run({ ...w(), runs: [{ args: [`--branch=${leaked}`], ops: NOTIFY() }] });
  const r = res.runs[0];
  expect(r.code, r.log).toBe(2);
  expect(r.telegram).toHaveLength(1);
  const text = textOf(r);
  expect(text).toContain('❌ --branch ต้องเป็น SRC, KKL, SSS (เจอ: ***');
  expect(text, 'ทั้งตัวพิมพ์เดิมและพิมพ์ใหญ่ที่ parse_args แปลง').not.toMatch(/\d{6,}:[A-Za-z0-9_-]{30,}/);
  expect(text.toUpperCase()).not.toContain('LEAKEDLOOKING');
});

test('token ที่ตั้งไว้ถูกซ่อนแม้ id ไม่ถึง 6 หลัก (ผ่านด่านรูปแบบของ config แต่ไม่เข้า regex รูปแบบ token) — ซ่อนด้วยการแทนค่าตรงตัว', async () => {
  const T5 = '12345:AAFakeTokenForTestsOnly_abcdefghij012345';
  const res = run({ ...w(), runs: [{ args: [`--x${T5}`], ops: [{ op: 'env', set: { TELEGRAM_BOT_TOKEN: T5, TELEGRAM_CHAT_ID: CHAT, COMPUTERNAME: HOST }, unset: ['AUTO_R16_NOTIFY'] }, TG()] }] });
  const r = res.runs[0];
  expect(r.code, r.log).toBe(2);
  expect(r.telegram, r.log).toHaveLength(1);
  expect(r.telegram[0].path).toBe(`/bot${T5}/sendMessage`);
  expect(textOf(r)).toContain('❌ flag ไม่รู้จัก: --x***');
  expect(textOf(r)).not.toContain(T5);
  expect(textOf(r)).not.toContain('AAFakeToken');
});

test('_scrub — ซ่อน token ที่ตั้งไว้ · รูปแบบ token ใดๆ · พารามิเตอร์ key= (ไม่สนตัวพิมพ์) · ข้อความปกติ (เวลา/วันที่/ชื่อไฟล์) ไม่ถูกแตะ', async () => {
  const cases = [
    `ผิดพลาด https://api.telegram.org/bot${TOKEN}/sendMessage ล้ม`,
    'GET https://firestore.googleapis.com/v1/projects/x/databases/(default)/documents/a?key=AIzaSyFAKEKEY123&alt=json',
    'URL ?KEY=AIzaSyUPPER และ &Key=lower',
    'token 987654321:BBOtherLookingToken_abcdefghij0123456789 อื่น',
    'เวลา 21:10:00 วันที่ 21/10/2026 ไฟล์ R16104.CSV รหัส 2026-10-21:12',
    'ไม่มีอะไรลับ',
  ];
  const out = py(`print(json.dumps([m._scrub(c, p['token']) for c in p['cases']], ensure_ascii=False))`, { token: TOKEN, cases });
  expect(out[0]).toBe('ผิดพลาด https://api.telegram.org/bot***/sendMessage ล้ม');
  expect(out[1]).toBe('GET https://firestore.googleapis.com/v1/projects/x/databases/(default)/documents/a?key=***&alt=json');
  expect(out[2]).toBe('URL ?KEY=*** และ &Key=***');
  expect(out[3]).toBe('token *** อื่น');
  expect(out[4], 'เวลา/วันที่/ชื่อไฟล์ต้องไม่ถูกแตะ').toBe(cases[4]);
  expect(out[5]).toBe(cases[5]);
  // ไม่ระบุ token ก็ยังซ่อนตามรูปแบบ
  expect(py(`print(json.dumps(m._scrub(p['s'])))`, { s: `x ${TOKEN} y` })).toBe('x *** y');
});

test('ค่าที่ตั้งผิด — ไม่ส่ง · บอกเหตุผล · ไม่สะท้อนค่ากลับลง log · ตัวอย่างในวงเล็บมุมถูกจับ', async () => {
  const cfg = (token, chat) => ({ op: 'env', set: { TELEGRAM_BOT_TOKEN: token, TELEGRAM_CHAT_ID: chat }, unset: ['AUTO_R16_NOTIFY'] });
  const res = run({ ...w(), runs: [
    { args: [], ops: [cfg('SECRETVALUE-not-a-token', CHAT), TG()] },
    { args: [], ops: [cfg(TOKEN, 'ZZCHAT-secret')] },
    { args: [], ops: [cfg('<token จาก BotFather>', '<chat id>')] },
    { args: [], ops: [cfg('123456:short', CHAT)] },
  ] });
  const [a, b, c, d] = res.runs;
  expect(a.log).toContain('แจ้งเตือน Telegram: ไม่ได้ส่ง — TELEGRAM_BOT_TOKEN รูปแบบไม่ถูก');
  expect(a.log).not.toContain('SECRETVALUE');
  expect(b.log).toContain('แจ้งเตือน Telegram: ไม่ได้ส่ง — TELEGRAM_CHAT_ID รูปแบบไม่ถูก');
  expect(b.log).not.toContain('ZZCHAT');
  expect(c.log).toContain('ยังเป็นข้อความตัวอย่างในวงเล็บมุม ไม่ใช่ค่าจริง');
  expect(d.log).toContain('TELEGRAM_BOT_TOKEN รูปแบบไม่ถูก');
  for (const r of res.runs) { expect(r.code, r.log).toBe(0); expect(r.telegram, r.log).toEqual([]); }
});

test('telegram_config_problem — ตารางรูปแบบ token/chat ที่รับ/ไม่รับ', async () => {
  const rows = [
    [TOKEN, CHAT, ''], [TOKEN, '-1001234567890', ''], [TOKEN, '@my_channel', ''], [TOKEN, '123', ''],
    ['', CHAT, 'ไม่พบ TELEGRAM_BOT_TOKEN'], [TOKEN, '', 'ไม่พบ TELEGRAM_CHAT_ID'],
    ['', '', 'ยังไม่ได้ตั้ง TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID'],
    ['<x>', CHAT, 'ยังเป็นข้อความตัวอย่าง'], [TOKEN, '<y>', 'ยังเป็นข้อความตัวอย่าง'],
    ['123456789', CHAT, 'TELEGRAM_BOT_TOKEN รูปแบบไม่ถูก'],                    // ไม่มี ':'
    ['1234:abc', CHAT, 'TELEGRAM_BOT_TOKEN รูปแบบไม่ถูก'],                     // สั้นไป
    [`${TOKEN} extra`, CHAT, 'TELEGRAM_BOT_TOKEN รูปแบบไม่ถูก'],               // มีช่องว่างปน
    [TOKEN, 'abc', 'TELEGRAM_CHAT_ID รูปแบบไม่ถูก'], [TOKEN, '12', 'TELEGRAM_CHAT_ID รูปแบบไม่ถูก'], [TOKEN, '@ab', 'TELEGRAM_CHAT_ID รูปแบบไม่ถูก'],
    [TOKEN, '12 34', 'TELEGRAM_CHAT_ID รูปแบบไม่ถูก'],
  ];
  const out = py(`print(json.dumps([m.telegram_config_problem(a, b) for a, b in p['rows']], ensure_ascii=False))`, { rows: rows.map(([a, b]) => [a, b]) });
  rows.forEach(([a, b, want], i) => {
    if (want === '') expect(out[i], `ควรรับ (${a.slice(0, 8)}…, ${b})`).toBe('');
    else expect(out[i], `ควรปฏิเสธ (${a.slice(0, 8)}…, ${b})`).toContain(want);
  });
});

// ════════════════════════════════════════════════════════════════════════════
//  7) ที่มาของค่า (.env)
// ════════════════════════════════════════════════════════════════════════════
test('ลำดับแหล่งค่า: ตัวแปรระบบ → .env ข้างสคริปต์ → .env ในโฟลเดอร์ CSV (แยกทีละตัวแปร) · ไวยากรณ์ .env: export / เครื่องหมายคำพูด / คอมเมนต์ / BOM / CRLF', async () => {
  const T2 = '223456789:BBFakeTokenForTestsOnly_abcdefghij012345';
  const T3 = '323456789:CCFakeTokenForTestsOnly_abcdefghij012345';
  const T4 = '423456789:DDFakeTokenForTestsOnly_abcdefghij012345';
  const T5 = '523456789:EEFakeTokenForTestsOnly_abcdefghij012345';
  const clean = { op: 'env', unset: ['AUTO_R16_NOTIFY', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID'], set: { COMPUTERNAME: HOST } };
  const env = (k, v) => ({ op: 'env', set: { [k]: v } });
  const script = (content) => ({ op: 'dotenv', where: 'script', content });
  const folder = (content) => ({ op: 'dotenv', where: 'folder', content });
  const NT = ['--notify-test'];
  const res = run({ ...w(), runs: [
    { args: NT, ops: [clean, TG(), script(`TELEGRAM_BOT_TOKEN=${TOKEN}\nTELEGRAM_CHAT_ID=${CHAT}\n`)] },                                     // 0: .env ข้างสคริปต์
    { args: NT, ops: [env('TELEGRAM_BOT_TOKEN', `  ${T2}  `)] },                                                                               // 1: ตัวแปรระบบชนะ .env (ตัดช่องว่างรอบค่า)
    { args: NT, ops: [clean, script(''), folder(`TELEGRAM_BOT_TOKEN=${T3}\nTELEGRAM_CHAT_ID=${CHAT}\n`)] },                                      // 2: .env ในโฟลเดอร์ CSV
    { args: NT, ops: [clean, script(`TELEGRAM_CHAT_ID=${CHAT}\n`), folder(`TELEGRAM_BOT_TOKEN=${T3}\n`)] },                                      // 3: ผสมทีละตัวแปร
    { args: NT, ops: [clean, script(`﻿# บอทแจ้งเตือน\r\nexport TELEGRAM_BOT_TOKEN = "${T4}"   # token ของบอท\r\nTELEGRAM_CHAT_ID='${CHAT}'\r\n`), folder('')] },   // 4: BOM + CRLF + export + คำพูด + คอมเมนต์
    { args: NT, ops: [clean, script(`TELEGRAM_BOT_TOKEN=${T5} # ไม่มีคำพูด\nTELEGRAM_CHAT_ID=${CHAT}\n`)] },                                  // 5: คอมเมนต์ท้ายบรรทัดแบบไม่มีคำพูด
    { args: NT, ops: [clean, script(`TELEGRAM_BOT_TOKEN=\nTELEGRAM_CHAT_ID=\n`), folder(`TELEGRAM_BOT_TOKEN=${T3}\nTELEGRAM_CHAT_ID=${CHAT}\n`)] },   // 6: ค่าว่างใน .env ข้างสคริปต์ → ตกไปโฟลเดอร์ CSV
    { args: NT, ops: [clean, script(`# TELEGRAM_BOT_TOKEN=${T2}\nTELEGRAM_CHAT_ID=${CHAT}\n`), folder('')] },                                      // 7: บรรทัดที่ถูกคอมเมนต์ไม่นับ → ไม่พบ token
    { args: [], ops: [clean, script(''), folder(`TELEGRAM_BOT_TOKEN=${T3}\nTELEGRAM_CHAT_ID=${CHAT}\n`)] },                                    // 8: รอบงานจริงของแต่ละคืน (ไม่ใช่ --notify-test) อ่าน .env ในโฟลเดอร์ CSV ได้เหมือนกัน
  ] });
  const tokenOf = (r) => (r.telegram[0] ? r.telegram[0].path.replace(/^\/bot/, '').replace(/\/sendMessage$/, '') : null);
  const r = res.runs;
  expect(tokenOf(r[0]), r[0].log).toBe(TOKEN);
  expect(r[0].log).toContain('ใช้ค่าจาก .env ข้างสคริปต์');
  expect(tokenOf(r[1]), r[1].log).toBe(T2);
  expect(r[1].log).toContain('ใช้ค่าจาก ตัวแปรระบบ TELEGRAM_BOT_TOKEN');
  expect(tokenOf(r[2]), r[2].log).toBe(T3);
  expect(r[2].log).toContain('ใช้ค่าจาก .env ในโฟลเดอร์ CSV');
  expect(tokenOf(r[3]), r[3].log).toBe(T3);
  expect(r[3].telegram[0].body.chat_id, 'chat จาก .env ข้างสคริปต์ · token จากโฟลเดอร์ CSV').toBe(CHAT);
  expect(tokenOf(r[4]), r[4].log).toBe(T4);
  expect(r[4].telegram[0].body.chat_id).toBe(CHAT);
  expect(tokenOf(r[5]), r[5].log).toBe(T5);
  expect(tokenOf(r[6]), r[6].log).toBe(T3);
  expect(r[7].code, r[7].log).toBe(2);
  expect(r[7].telegram).toEqual([]);
  expect(r[7].log).toContain('ไม่พบ TELEGRAM_BOT_TOKEN');
  for (let i = 0; i < 7; i++) expect(r[i].code, r[i].log).toBe(0);
  expect(r[8].code, r[8].log).toBe(0);
  expect(tokenOf(r[8]), 'รอบงานจริงก็ต้องหา .env ในโฟลเดอร์ CSV เจอ').toBe(T3);
  expect(lines(r[8])[0]).toBe(HEAD_OK);
});

test('_env_file_value — ตารางไวยากรณ์ของ .env', async () => {
  const cases = [
    ['KEY=abc', 'abc'], ['KEY = abc ', 'abc'], ['export KEY=abc', 'abc'], ['  export   KEY=abc', 'abc'],
    ['KEY="abc"', 'abc'], ["KEY='abc'", 'abc'], ['KEY="a b"', 'a b'],
    ['KEY="abc"   # คอมเมนต์', 'abc'], ["KEY='abc' # c", 'abc'], ['KEY=abc # คอมเมนต์', 'abc'], ['KEY=abc#ไม่ใช่คอมเมนต์', 'abc#ไม่ใช่คอมเมนต์'],
    ['# KEY=abc', null], ['KEY=', null], ['KEY=""', null], ['KEY_2=abc', null], ['OTHER=abc', null], ['KEYS=abc', null],
    ['KEY="abc', '"abc'], ['KEY=abc\r', 'abc'],
    ['KEY=first\nKEY=second', 'first'],
    ['﻿KEY=abc', 'abc'],
  ];
  const out = py(`
d = tempfile.mkdtemp(prefix='r16env')
res = []
for i, (content, _want) in enumerate(p['cases']):
    f = os.path.join(d, '.env%d' % i)
    open(f, 'wb').write(content.encode('utf-8'))
    res.append(m._env_file_value(f, 'KEY'))
res.append(m._env_file_value(os.path.join(d, 'ไม่มีไฟล์นี้'), 'KEY'))
print(json.dumps(res, ensure_ascii=False))
`, { cases });
  cases.forEach(([content, want], i) => expect(out[i], JSON.stringify(content)).toBe(want));
  expect(out[cases.length], 'ไม่มีไฟล์ = None').toBe(null);
});

// ════════════════════════════════════════════════════════════════════════════
//  8) ข้อความ: เพดานความยาว · บัฟเฟอร์บรรทัดเตือน · build_notice
// ════════════════════════════════════════════════════════════════════════════
test('ข้อความยาวเกินเพดาน (TELEGRAM_MAX_CHARS) — ตัดท้ายและบอกว่าตัด · ปกติไม่ตัด', async () => {
  const sc = { consts: { CONFIRM_TRIPWIRE_MIN_ITEMS: 1 }, args: [...REAL, '--confirm-max-adj-ratio', '0.1'] };
  const full = run({ ...w(), consts: sc.consts, runs: [{ args: sc.args, ops: NOTIFY() }] }).runs[0];
  const cut = run({ ...w(), consts: { ...sc.consts, TELEGRAM_MAX_CHARS: 300 }, runs: [{ args: sc.args, ops: NOTIFY() }] }).runs[0];
  expect([...textOf(full)].length, 'ข้อความเต็มต้องยาวกว่าเพดานทดสอบ').toBeGreaterThan(300);
  expect(textOf(full)).not.toContain('(ตัดข้อความ)');
  expect([...textOf(cut)].length).toBeLessThanOrEqual(300);
  expect(textOf(cut).endsWith('\n… (ตัดข้อความ)')).toBe(true);
  expect(textOf(cut).startsWith(HEAD_FAIL(4, WHY[4]).slice(0, 40)), 'หัวข้อความยังอยู่ครบ').toBe(true);
  expect(cut.code, cut.log).toBe(4);
});

test('_remember_alert — เก็บเฉพาะบรรทัด ❌/⚠️ + บรรทัดย่อหน้าต่อท้ายไม่เกิน 4 · บรรทัดปกติไม่เก็บ · เพดาน 30 · ข้อความหลายบรรทัดรวมเป็นบรรทัดเดียว', async () => {
  const seqs = [
    ['เริ่มงาน auto R16', '  R01: 25 รายการ', '  ✅ เขียน SSS แล้ว'],
    ['❌ A', '   b1', '   b2', '   b3', '   b4', '   b5'],
    ['❌ A', 'ปกติ', '   ย่อหน้าหลังบรรทัดปกติ'],
    ['  ⚠️ W', '     รายละเอียด', '  บรรทัดปกติเท่ากัน'],
    ['❌ A', '  c1', '❌ B', '  d1'],
    ['', '   ', '❌ A'],
    ['❌ ข้อความ\n   ต่อบรรทัด', '  ⚠️ x\r\n y'],
    Array.from({ length: 40 }, (_, i) => `❌ บรรทัด ${i}`),
  ];
  const out = py(`
res = []
for seq in p['seqs']:
    del m._ALERT_LINES[:]
    m._ALERT_STATE.update({'indent': None, 'cont': 0})
    with contextlib.redirect_stdout(io.StringIO()):
        for line in seq: m.log(line)
    res.append(list(m._ALERT_LINES))
print(json.dumps(res, ensure_ascii=False))
`, { seqs });
  expect(out[0], 'บรรทัดปกติไม่ถูกเก็บ (รวม ✅)').toEqual([]);
  expect(out[1], 'บรรทัดต่อเก็บได้ไม่เกิน 4').toEqual(['❌ A', 'b1', 'b2', 'b3', 'b4']);
  expect(out[2], 'บรรทัดปกติขั้นกลางตัดสายต่อ').toEqual(['❌ A']);
  expect(out[3]).toEqual(['⚠️ W', 'รายละเอียด']);
  expect(out[4], '❌ ใหม่เริ่มหน้าต่างบรรทัดต่อใหม่').toEqual(['❌ A', 'c1', '❌ B', 'd1']);
  expect(out[5]).toEqual(['❌ A']);
  expect(out[6]).toEqual(['❌ ข้อความ ต่อบรรทัด', '⚠️ x y']);
  expect(out[7], 'เพดาน NOTIFY_ALERT_KEEP').toHaveLength(30);
  expect(out[7][29]).toBe('❌ บรรทัด 29');
});

test('main() ล้างสถานะ "บรรทัดต่อ" ของรอบก่อน — บรรทัดเยื้องแรกของรอบใหม่ไม่ถูกเก็บเป็นบรรทัดต่อของ ❌ รอบก่อน (ป้องกันเมื่อ main() ถูกเรียกซ้ำในโปรเซสเดียว เช่นเทส)', async () => {
  // ในโปรดักชัน main() รันครั้งเดียวต่อโปรเซสและบรรทัดแรกของรอบไม่เยื้อง จึงไม่เคยเห็นผลต่าง — ทดสอบด้วย _run ปลอมที่พิมพ์บรรทัดเยื้องเป็นบรรทัดแรก
  const out = py(`
m._notify_after_run = lambda rc: None
m._run = lambda argv=None: (m.log('   บรรทัดเยื้องแรกของรอบใหม่'), sys.exit(0))
m._ALERT_STATE.update({'indent': 0, 'cont': 0})   # ค้างจากรอบก่อน: เพิ่งเจอ ❌ ที่ไม่เยื้อง
m._ALERT_LINES.append('❌ ค้างจากรอบก่อน')
with contextlib.redirect_stdout(io.StringIO()):
    try: m.main([])
    except SystemExit: pass
print(json.dumps({'lines': m._ALERT_LINES, 'state': m._ALERT_STATE}, ensure_ascii=False))
`);
  expect(out.lines, 'บรรทัดค้างจากรอบก่อนถูกล้าง และบรรทัดเยื้องแรกไม่ถูกเก็บ').toEqual([]);
  expect(out.state).toEqual({ indent: null, cont: 0 });
});

test('build_notice — รูปแบบข้อความ (golden) · เพดานจำนวนบรรทัดจาก log · ตัดบรรทัดยาว · หัวข้อ rc 0/≠0 · exit code แปลก · ไม่มี opts/mtime/ไฟล์ · ลำดับสาขาตาม opts', async () => {
  const out = py(`
os.environ['COMPUTERNAME'] = 'UNITPC'
now = datetime.fromisoformat('2026-10-21T21:10:00+07:00')
def mk(rc, run, alerts):
    run = dict(run)
    if run.get('mtime_bkk'): run['mtime_bkk'] = datetime.fromisoformat(run['mtime_bkk'])
    return m.build_notice(rc, run, alerts, now)
res = [mk(c['rc'], c['run'], c['alerts']) for c in p['cases']]
m.TELEGRAM_MAX_CHARS = 120
res.append(mk(4, p['cases'][0]['run'], p['cases'][0]['alerts']))
print(json.dumps(res, ensure_ascii=False))
`, { cases: [
    // 0: golden — สาขาหนึ่งสำเร็จ อีกสาขาตกด่าน
    { rc: 4, alerts: ['❌ x'], run: { opts: { branches: ['SRC', 'SSS'], confirm: true, confirm_branches: ['SRC', 'SSS'], confirm_shadow: false }, file: 'R16104.CSV', mtime_bkk: '2026-10-21T21:05:00+07:00',
      results: { SRC: 'written', SSS: 'skipped' },
      confirm_results: { SRC: { state: 'confirmed', real: true, written: 3, pass: 2, adj: 1, skipped: {} }, SSS: { state: 'skipped', real: true } } } },
    // 1: alert เกิน 10 บรรทัด · บรรทัดยาว 500 ตัว · ยังไม่มีผลรายสาขา
    { rc: 4, alerts: ['❌ ' + 'ย'.repeat(500), ...Array.from({ length: 12 }, (_, i) => `⚠️ เตือน ${i}`)], run: { opts: { branches: ['SSS'], confirm: false }, results: {}, confirm_results: {} } },
    // 2: สำเร็จ (rc 0) แต่มีคำเตือนใน log · โหมดเงา
    { rc: 0, alerts: ['⚠️ มีเรื่อง'], run: { opts: { branches: ['SSS'], confirm_shadow: true }, results: { SSS: 'unchanged' }, confirm_results: { SSS: { state: 'shadow', real: false, evaluated: 4, pass: 3, adj: 1, skipped: {} } } } },
    // 3: exit code แปลก · ไม่มีไฟล์/mtime/opts
    { rc: 9, alerts: [], run: {} },
    // 4: มีไฟล์แต่ไม่มี mtime · ลำดับสาขาตาม opts · state dry ไม่โชว์เป็น ❌ และไม่นับเป็นรายการค้าง
    { rc: 0, alerts: [], run: { opts: { branches: ['KKL', 'SRC'], confirm: true, confirm_branches: ['KKL', 'SRC'] }, file: 'R16104.CSV', results: { SRC: 'written', KKL: 'dry' },
      confirm_results: { SRC: { state: 'nothing', real: true, candidates: 0, skipped: {} }, KKL: { state: 'dry', real: true, evaluated: 2, pass: 1, adj: 1, skipped: {} } } } },
  ] });
  const UNIT = (t) => t.replace(HOST, 'UNITPC');

  expect(out[0]).toBe([
    UNIT(HEAD_FAIL(4, WHY[4])), FILE_LINE,
    'SRC: R16 เผยแพร่แล้ว · Confirm 3 รายการ (Pass 2 · Stock Adj 1)',
    'SSS: R16 ตกด่าน ไม่ได้เขียน · ❌ Confirm ตกด่าน ไม่ได้เขียน',
    '⚠️ รายการ scanning ที่ยังไม่ถูก Confirm: ไม่ทราบจำนวน — จะถูกรีเซ็ตเช้าพรุ่งนี้ (ต้องนับใหม่)',
    'จาก log:', '  ❌ x',
    UNIT(QUICK), RERUN('SRC,SSS'), TOO_LATE,
  ].join('\n'));

  const L1 = out[1].split('\n');
  const at = L1.indexOf('จาก log:');
  expect(L1[0]).toBe(UNIT(HEAD_FAIL(4, WHY[4])));
  expect(L1[1], 'ไม่มีไฟล์/ผลรายสาขา/คำเตือน "ปิดอยู่" (ยังไม่มีผลให้เตือน)').toBe('จาก log:');
  expect(L1[at + 1], 'บรรทัดยาวถูกตัดที่ 260 ตัวอักษร (รวมสัญลักษณ์นำ) + ย่อหน้า 2').toBe('  ❌ ' + 'ย'.repeat(258));
  expect(L1.slice(at + 2, at + 11)).toEqual(Array.from({ length: 9 }, (_, i) => `  ⚠️ เตือน ${i}`));
  expect(L1[at + 11], 'แสดงสูงสุด 10 บรรทัดแล้วบอกส่วนที่เหลือ').toBe('  … อีก 3 บรรทัด (ดู auto_r16.log)');
  expect(L1.slice(at + 12), 'ไม่ใช่โหมด --confirm → แนะนำกด Confirm ที่ Desktop / อัปมือ (ไม่ใช่รันบอทซ้ำ)').toEqual([
    UNIT(QUICK), 'กด Confirm ที่ Desktop เองได้ถ้าปุ่มยังไม่ถูกซ่อน · หรืออัป R16 มือที่การ์ด R16.104']);

  expect(out[2]).toBe([
    UNIT(HEAD_OK),
    'SSS: R16 เหมือนเดิม (ไม่เขียนซ้ำ) · เงา (ไม่เขียน): ทำนาย 4 รายการ (Pass 3 · Stock Adj 1)',
    'คำเตือนใน log:', '  ⚠️ มีเรื่อง',
  ].join('\n'));

  expect(out[3]).toBe([
    UNIT(HEAD_FAIL(9, 'ผิดปกติ')), UNIT(QUICK), 'กด Confirm ที่ Desktop เองได้ถ้าปุ่มยังไม่ถูกซ่อน · หรืออัป R16 มือที่การ์ด R16.104',
  ].join('\n'));

  expect(out[4]).toBe([
    UNIT(HEAD_OK), 'ไฟล์ R16104.CSV',
    'KKL: R16 ซ้อม · ซ้อม (ไม่เขียน): ทำนาย 2 รายการ (Pass 1 · Stock Adj 1)',
    'SRC: R16 เผยแพร่แล้ว · Confirm: ไม่มีรายการ scanning',
  ].join('\n'));

  expect([...out[5]].length, 'ตัดตามเพดาน').toBeLessThanOrEqual(120);
  expect(out[5].endsWith('\n… (ตัดข้อความ)')).toBe(true);
});

test('flag ผิดตั้งแต่ parse (ไม่มี opts) — ข้อความแนะนำให้ตรวจ Task ไม่ใช่ให้กด Confirm · ตรวจที่ build_notice โดยตรง', async () => {
  const out = py(`
os.environ['COMPUTERNAME'] = 'UNITPC'
now = datetime.fromisoformat('2026-10-21T21:10:00+07:00')
print(json.dumps(m.build_notice(2, {}, ['❌ flag ไม่รู้จัก: --x'], now), ensure_ascii=False))
`);
  expect(out.split('\n').slice(-2)).toEqual([QUICK.replace(HOST, 'UNITPC'), 'ตรวจ -Argument ของ Task AutoR16Import (flag ผิด)']);
});

// ════════════════════════════════════════════════════════════════════════════
//  9) ทางเข้าจริง: python auto_r16_import.py <flag> เป็นโปรเซสแยก — exit code ถึง Task Scheduler · ส่งผ่าน HTTP จริงไปเซิร์ฟเวอร์จำลองในเครื่อง
// ════════════════════════════════════════════════════════════════════════════
function stubTelegram() {
  const reqs = [];
  const server = http.createServer((req, res) => {
    let b = '';
    req.on('data', (d) => { b += d; });
    req.on('end', () => {
      let body = null;
      try { body = JSON.parse(b); } catch (_) { /* ไม่ใช่ JSON */ }
      reqs.push({ url: req.url, body });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"ok":true}');
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({
    reqs, base: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)),
  })));
}

function scriptEnv(extra = {}) {
  const e = { ...process.env };
  for (const k of ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID', 'AUTO_R16_NOTIFY', 'AUTO_R16_TELEGRAM_BASE', 'AUTO_R16_WATCH_FOLDER', 'AUTO_R16_FIRESTORE_BASE', 'AUTO_R16_STATE_DIR']) delete e[k];
  return { ...e, COMPUTERNAME: 'REALPROC', ...extra };
}

function runScript(args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(findPython(), ['-I', '-B', '-X', 'utf8', AUTO_R16, ...args], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, out, err }));
  });
}

test('โปรเซสจริง — flag ผิด: exit code 2 ถึงผู้เรียก · ส่งผ่าน HTTP จริง 1 ข้อความ (ชื่อเครื่องจาก COMPUTERNAME) · stdout ยังมี log/USAGE เหมือนเดิม', async () => {
  const stub = await stubTelegram();
  try {
    const r = await runScript(['--bogus'], scriptEnv({ TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_CHAT_ID: CHAT, AUTO_R16_TELEGRAM_BASE: stub.base }));
    expect(r.code, r.out + r.err).toBe(2);
    expect(r.out).toContain('❌ flag ไม่รู้จัก: --bogus');
    expect(r.out).toContain('ใช้: python auto_r16_import.py');
    expect(r.out).toContain('แจ้งเตือน Telegram: ส่งแล้ว');
    expect(stub.reqs).toHaveLength(1);
    expect(stub.reqs[0].url).toBe(`/bot${TOKEN}/sendMessage`);
    expect(stub.reqs[0].body.chat_id).toBe(CHAT);
    expect(stub.reqs[0].body.text).toContain('REALPROC — ไม่สำเร็จ (exit 2');
    expect(stub.reqs[0].body.text).toContain('❌ flag ไม่รู้จัก: --bogus');
    for (const s of [r.out, r.err]) expect(s, 'ไม่มีความลับใน stdout/stderr').not.toContain(TOKEN);
  } finally { await stub.close(); }
});

test('โปรเซสจริง — --notify-test: exit 0 · ส่ง 1 ข้อความ · ไม่ทำงานหลัก (ไม่อ่านโฟลเดอร์/ไม่แตะ Firestore)', async () => {
  const stub = await stubTelegram();
  try {
    const r = await runScript(['--notify-test'], scriptEnv({ TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_CHAT_ID: CHAT, AUTO_R16_TELEGRAM_BASE: stub.base }));
    expect(r.code, r.out + r.err).toBe(0);
    expect(stub.reqs).toHaveLength(1);
    expect(stub.reqs[0].body.text).toMatch(/^🔔 ทดสอบแจ้งเตือน auto-r16 · REALPROC · \d\d:\d\d \d\d\/\d\d\/\d{4}\n/);
    expect(r.out).toContain('chat ***321');
    expect(r.out).not.toContain('เริ่มงาน auto R16.104 import');
    for (const s of [r.out, r.err]) { expect(s).not.toContain(TOKEN); expect(s).not.toContain(CHAT); }
  } finally { await stub.close(); }
});

test('โปรเซสจริง — --help (exit 0) และ AUTO_R16_NOTIFY=0 (flag ผิด exit 2) ไม่ส่งอะไร', async () => {
  const stub = await stubTelegram();
  try {
    const env = scriptEnv({ TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_CHAT_ID: CHAT, AUTO_R16_TELEGRAM_BASE: stub.base });
    const h = await runScript(['--help'], env);
    expect(h.code, h.out + h.err).toBe(0);
    expect(h.out).toContain('ใช้: python auto_r16_import.py');
    const off = await runScript(['--bogus'], { ...env, AUTO_R16_NOTIFY: '0' });
    expect(off.code, off.out + off.err).toBe(2);
    expect(off.out, 'ไม่มีบรรทัด log เรื่องแจ้งเตือน (ข้อความ USAGE ที่พิมพ์ตอน flag ผิดมีคำว่า Telegram อยู่แล้ว จึงเช็คเฉพาะรูปแบบบรรทัด log)').not.toContain('แจ้งเตือน Telegram:');
    expect(off.out).not.toContain('ส่ง Telegram');
    expect(stub.reqs, 'ไม่มีคำขอเลย').toEqual([]);
  } finally { await stub.close(); }
});

test('โปรเซสจริง — Telegram ใช้ไม่ได้ (พอร์ตปิด): exit code เดิม (2) ไม่เปลี่ยน · รอลองซ้ำจริง ~1.5 วิ · stdout/stderr ไม่มี token หรือ URL', async () => {
  const closed = await new Promise((resolve) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
  const t0 = Date.now();
  const r = await runScript(['--bogus'], scriptEnv({ TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_CHAT_ID: CHAT, AUTO_R16_TELEGRAM_BASE: `http://127.0.0.1:${closed}` }));
  expect(r.code, r.out + r.err).toBe(2);
  expect(r.out).toContain('⚠️ ส่ง Telegram ไม่สำเร็จ (URLError) — งานหลักไม่กระทบ');
  expect(Date.now() - t0, 'ลองซ้ำหลังรอ 1.5 วิ').toBeGreaterThan(1300);
  for (const s of [r.out, r.err]) { expect(s).not.toContain(TOKEN); expect(s).not.toContain('/bot'); }
});
