// PostgREST จำลองสำหรับป็อปอัพปรับปรุงสินค้า (ตาราง adj_* บน Supabase)
//
// ตอบจาก fixture สังเคราะห์ด้วย page.route — request ไม่ออกนอกเครื่องเลย
// (page.route ชนะ default-deny ของ context ใน routes.js จึงไม่โดน tripwire ของ closeApp)
// ไม่แตะ index.html — ใช้ SUPABASE_URL ตัวจริงของแอป แค่ดักคำตอบไว้กลางทาง
//
// รองรับเฉพาะรูปแบบที่หน้าเว็บส่งจริง: select · gen=eq.X · sku=in.("a","b") · order · limit · offset
// ตัวกรองที่ไม่รู้จัก = โยน error ให้เทสล้มดัง ๆ (เว็บส่งอะไรแปลกไปจะไม่ผ่านเงียบ)
const SB_HOST = /^https:\/\/[a-z0-9]+\.supabase\.co\/rest\/v1\//;

function parseInList(v) {
  // v = ("A1","B2") — ตัดวงเล็บแล้วแยกด้วย , ที่อยู่นอกเครื่องหมายคำพูด
  const body = v.replace(/^\(/, '').replace(/\)$/, '');
  const out = [];
  let cur = '', q = false;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (q && ch === '\\') { cur += body[++i]; continue; }
    if (ch === '"') { q = !q; continue; }
    if (!q && ch === ',') { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur || body.length) out.push(cur);
  return out;
}

function applyQuery(rows, params) {
  let out = rows;
  let limit = Infinity, offset = 0, order = null;
  for (const [k, v] of params) {
    if (k === 'select') continue;
    if (k === 'limit') { limit = Number(v); continue; }
    if (k === 'offset') { offset = Number(v); continue; }
    if (k === 'order') { order = v.split(',').map((s) => s.split('.')[0]); continue; }
    if (v.startsWith('eq.')) { const x = v.slice(3); out = out.filter((r) => String(r[k]) === x); continue; }
    if (v.startsWith('in.')) { const set = new Set(parseInList(v.slice(3))); out = out.filter((r) => set.has(String(r[k]))); continue; }
    throw new Error(`supabase-fake: ไม่รองรับตัวกรอง ${k}=${v}`);
  }
  if (order) out = [...out].sort((a, b) => { for (const f of order) { if (a[f] < b[f]) return -1; if (a[f] > b[f]) return 1; } return 0; });
  return out.slice(offset, offset + limit);
}

/**
 * @param page      Playwright page
 * @param fixture   { meta: [...adj_meta rows], lots: [...adj_r14_lots rows], prices: [...adj_r05_prices rows] }
 * @param opts      { fail: boolean|number (HTTP status), gate: Promise — กั้นคำตอบของตารางข้อมูลไว้จนกว่าจะ resolve }
 * @returns { requests } — ทุก request ที่หน้าเว็บส่งมา (table + params) ไว้ตรวจว่าขอเฉพาะ SKU ในใบ
 */
async function fakeSupabase(page, fixture, opts = {}) {
  const requests = [];
  const tables = { adj_meta: fixture.meta || [], adj_r14_lots: fixture.lots || [], adj_r05_prices: fixture.prices || [] };
  // หน้าเว็บอยู่ 127.0.0.1 แต่ยิงไป *.supabase.co พร้อม header apikey/Authorization = ข้าม origin + มี preflight
  // Authorization ต้องระบุชื่อตรง ๆ ใน Allow-Headers (เครื่องหมาย * ไม่ครอบ header นี้ตามสเปก)
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'apikey, authorization, accept, content-type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
  };
  const reply = (route, status, body) => route.fulfill({ status, headers: cors, contentType: 'application/json', body });
  await page.route(SB_HOST, async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors, body: '' });
    const url = new URL(req.url());
    const table = url.pathname.split('/').pop();
    const params = [...url.searchParams.entries()];
    requests.push({ table, method: req.method(), params: Object.fromEntries(params), headers: req.headers() });
    if (opts.fail) return reply(route, typeof opts.fail === 'number' ? opts.fail : 500, '{"message":"fake failure"}');
    if (!(table in tables)) return reply(route, 404, '{"code":"PGRST205"}');
    if (opts.gate && table !== 'adj_meta') await opts.gate;
    return reply(route, 200, JSON.stringify(applyQuery(tables[table], params)));
  });
  return { requests };
}

// ประตูที่เทสสั่งเปิดเองได้ — ใช้กั้นคำตอบของ Supabase ไว้ระหว่างทดสอบ race
function makeGate() {
  let open;
  const gate = new Promise((r) => { open = r; });
  return { gate, open };
}

module.exports = { fakeSupabase, makeGate, parseInList };
