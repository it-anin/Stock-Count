// PromaxxHelper — ขั้นตั้ง "ประเภทเอกสาร" และ "คลังสินค้า" ก่อนปุ่มนำเข้า (รุ่น 2026-11-03.5)
//
// ที่มา: ผู้ใช้สั่ง 3 พ.ย. 2026 — ก่อนนำเข้าไฟล์ ต้องตั้งประเภทเอกสาร IRPS=ใบปรับปรุงเพิ่มสินค้า / ORDS=ใบปรับปรุงลดสินค้า และ "คลังต้องเป็น Front Store เท่านั้น"
// ตรวจจริงกับ ssmaxx.exe (D1–D6/E1–E2): คลิกช่อง → เปิดหน้าต่างรายการใบใหม่ (ชื่อ sfw_winrespond · hwnd/GUID เปลี่ยนทุกครั้ง) → คลิกแถวอย่างเดียวไม่เปลี่ยนค่า
// ต้องกด "ตกลง" · ฟอร์มเปิดมาเป็นประเภท/คลังต่างกันได้ (ORDS เคยเปิดเป็น ORCM · IRPS เปิดเป็นคลัง Warehouse) จึงต้องอ่านก่อนแล้วตั้งเมื่อไม่ตรง
//
// ตัวต่อปลอม tests/lib/fake_ssmaxx_uia.py จำลองโครงที่ตรวจจริง (ฟิลด์หัวฟอร์ม · หน้าต่างรายการ · แถวที่ถูกคลิกกลายเป็น Edit · เครื่องหมาย p_1:N)
// ⚠️ ไม่พิสูจน์ว่าคลิกจริงบน ssmaxx.exe ได้ผลตามนี้ — ต้องตรวจบนเครื่องจริง (--dry-run → คลิกทีละขั้น)
//
// ตรึง: 1. โครง spec ที่ส่งมอบ · 2. ทุกค่าเริ่มต้นของฟอร์ม → จบที่ประเภท+คลังถูกต้อง (และไม่แตะเมื่อถูกอยู่แล้ว) · 3. ★ ด่านกันพลาดทุกแบบหยุดโดยไม่คลิกปุ่มนำเข้า ·
//   4. dry-run ของแต่ละขั้นย่อยชี้เป้าถูกที่ · 5. ตัวช่วยย่อย (โทเคนดิบ · name_re · note)
const { test, expect } = require('@playwright/test');
const { runPy } = require('../../lib/promaxx-helper-harness');

const SCEN = String.raw`
import fake_ssmaxx_uia as fu
fake = dict(p.get('fake') or {})
svc, ui, log, st = fu.make_uia(m, tmp, verified=p.get('verified', True), uia=p.get('uia'), **fake)
opts = m.JobOpts(**(p.get('opts') or {}))
status, obj = svc.run_job(p.get('type', 'ORDS'), opts, only_step=p.get('only'))
runs = os.path.join(tmp, 'runs')
ev = {}
if os.path.isdir(runs):
    for d in sorted(os.listdir(runs)):
        ev[d] = sorted(os.listdir(os.path.join(runs, d)))
out = dict(status=status, obj=obj, acts=ui.acts(), clicked=ui.clicked, misfires=ui.misfires, state=ui.state, vtype=ui.vtype, wh=ui.wh,
    picker=ui.picker, picker_log=ui.picker_log, shots=ui.shots, ev=ev, log='\n'.join(log.lines), after_import=ui.acts_after_import)
print(json.dumps(out, ensure_ascii=False, default=str))
`;
const scen = (payload = {}) => runPy(SCEN, payload);
const FORM = (menu, letter) => ({ start_state: 'doc', start_doc_menu: menu, start_letter: letter });
const OFORM = { fake: FORM('เอกสารจ่าย', 'O') };
const IFORM = { fake: FORM('เอกสารรับ', 'I') };
const ORDS_T = 'ORDS ใบปรับปรุงลดสินค้า';
const IRPS_T = 'IRPS ใบปรับปรุงเพิ่มสินค้า';
const ORCM_T = 'ORCM ใบเสร็จรับเงิน(เงินสด)';
const IMPORT = 'uo_tran_bt_import';
// การคลิกที่เกี่ยวกับส่วนหัวฟอร์ม/หน้าต่างรายการ (เส้นทางเต็มเริ่มจากปิดโปรแกรม จึงมีคลิกล็อกอิน/เมนูนำหน้า — ตัดออก)
const fc = (r) => r.clicked.filter((c) => /^(SYSVOUCHERID|SYSWAREHOUSEID|col1|cb_ok|p_1)/.test(c));

test('1. โครง spec ที่ส่งมอบ — ลำดับขั้น · แต่ละขั้นย่อยมี skip_if/pre/post · เลือกแถวด้วยชื่อตรงตัว (โทเคนดิบ) · คลัง Front Store เท่านั้น · ด่านอ่านกลับก่อนนำเข้า', async () => {
  const r = runPy(`
import re
sp = m.STEP_SPECS
order = list(m.STEP_ORDER)
tok = dict(m.DOC_TYPES['ORDS']); tok['type_row'] = 'ORDS ใบปรับปรุงลดสินค้า'
f = m._fmt(sp, tok)
def conds(c, out):
    if isinstance(c, dict):
        for k in ('uia', 'uia_gone'):
            if k in c: out.append(c[k])
        for k in ('all', 'any'):
            for x in c.get(k, []): conds(x, out)
    return out
imp_pre = conds(f['import-button']['pre'], [])
row = f['doc-type-pick']['actions'][0]
walk_ids, walk_wins = [], []
def walk(o):
    if isinstance(o, dict):
        for k, v in o.items():
            if k == 'id': walk_ids.extend([v] if isinstance(v, str) else v)
            if k == 'title' or k == 'cls_re': walk_wins.append(v)
            walk(v)
    elif isinstance(o, list):
        for x in o: walk(x)
walk(sp)
print(json.dumps(dict(
  order=order, keys=list(sp.keys()), wh=m.WAREHOUSE_NAME,
  steps={n: sorted(sp[n].keys()) for n in order if n.startswith(('doc-type', 'warehouse'))},
  pick_row_do=[sp[n]['actions'][0]['do'] for n in ('doc-type-pick', 'warehouse-pick')],
  row_name=row['row']['name'], row_name_raw_in_src=sp['doc-type-pick']['actions'][0]['row']['name'],
  row_rev=row['row'].get('reverify'), row_list=row['list'],
  wh_row=f['warehouse-pick']['actions'][0]['row']['name'],
  imp_pre=[dict(id=c.get('id'), name=c.get('name'), name_re=c.get('name_re'), anc=c.get('ancestor')) for c in imp_pre],
  imp_pre_timeout=f['import-button'].get('pre_timeout'), imp_pre_what=f['import-button'].get('pre_what'),
  imp_actions=[a['do'] for a in f['import-button']['actions']],
  numeric_ids=[i for i in walk_ids if str(i).isdigit()],
  picker_wins=sorted(set(w for w in walk_wins if 'sfw' in w)),
  type_names={k: v['type_name'] for k, v in m.DOC_TYPES.items()}, codes={k: v['code'] for k, v in m.DOC_TYPES.items()},
  tok_ok=all(re.escape(v) == v for d in m.DOC_TYPES.values() for v in d.values()),
  skip_if=[sp[n]['skip_if'] == sp[n.rsplit('-', 1)[0] + '-open']['skip_if'] for n in order if n.endswith(('-pick', '-ok'))],
), ensure_ascii=False))`);
  expect(r.order).toEqual(['launch', 'login', 'menu', 'doc-button', 'doc-type-open', 'doc-type-pick', 'doc-type-ok', 'warehouse-open', 'warehouse-pick', 'warehouse-ok', 'import-button']);
  expect(r.keys, 'STEP_SPECS ครบทุกขั้นตามลำดับ').toEqual(r.order);
  expect(r.wh, 'คลังที่ยอมให้นำเข้า = Front Store เท่านั้น (ผู้ใช้สั่ง)').toBe('Front Store');
  for (const [n, keys] of Object.entries(r.steps)) {
    expect(keys, `${n}: ต้องมี skip_if/pre/actions/post (ข้ามได้เมื่อค่าตรงอยู่แล้ว · ตรวจก่อน-หลังทุกคลิก)`).toEqual(expect.arrayContaining(['actions', 'post', 'post_timeout', 'pre', 'skip_if']));
  }
  expect(r.pick_row_do).toEqual(['pick_row', 'pick_row']);
  expect(r.row_name, 'ชื่อแถวเป้าต้องตรงทุกตัวอักษร (มีช่องว่าง) — ไม่ถูก escape ด้วย backslash').toBe(ORDS_T);
  expect(r.row_name_raw_in_src, 'ใน spec ใช้โทเคนดิบ {=type_row}').toBe('{=type_row}');
  expect(r.row_rev, 'แถวอยู่ติดกัน 25px → ต้องอ่านเป้าซ้ำก่อนกด').toBe(true);
  expect(r.row_list).toBe('uo_popupdw_dw_datatmp');
  expect(r.wh_row).toBe('Front Store');
  expect(r.imp_pre.map((c) => c.id), 'ก่อนคลิกนำเข้าต้องอ่านกลับ: ปุ่มนำเข้า · ประเภท · เลขที่ · คลัง').toEqual(['uo_tran_bt_import', 'SYSVOUCHERID:1', 'TRANNO:1', 'SYSWAREHOUSEID:1']);
  expect(r.imp_pre[1].name).toBe('ใบปรับปรุงลดสินค้า');
  expect(r.imp_pre[2].name_re, 'เลขที่เอกสารต้องขึ้นต้นด้วยรหัสประเภท').toBe('^ORDS');
  expect(r.imp_pre[3].name).toBe('Front Store');
  expect(r.imp_pre.slice(1).every((c) => c.anc && c.anc.cls === 'pn_trans_out'), 'ช่องหัวฟอร์มต้องตรวจคลาสของฟอร์ม (กันไปอ่านตัวกรองที่ซ่อนอยู่)').toBe(true);
  expect(r.imp_pre_timeout).toBeLessThanOrEqual(10);
  expect(r.imp_pre_what).toContain('ไม่คลิกปุ่มนำเข้า');
  expect(r.imp_actions, 'บันทึกสาขาลง log แล้วจึงคลิก').toEqual(['note', 'click']);
  expect(r.numeric_ids, 'ห้ามใช้ id ตัวเลข (เปลี่ยนทุกครั้งที่โหลดหน้า)').toEqual([]);
  expect(r.picker_wins, 'หน้าต่างรายการหาจากชื่อ ไม่ผูก hwnd/GUID (เปลี่ยนทุกครั้ง)').toEqual(['^sfw_winrespond$']);
  expect(r.type_names).toEqual({ ORDS: 'ใบปรับปรุงลดสินค้า', IRPS: 'ใบปรับปรุงเพิ่มสินค้า' });
  expect(r.codes).toEqual({ ORDS: 'ORDS', IRPS: 'IRPS' });
  expect(r.tok_ok, 'ค่าใน DOC_TYPES ต้องไม่มีอักขระพิเศษของ regex').toBe(true);
  expect(r.skip_if.every(Boolean), 'ทั้งสามขั้นของแต่ละช่องใช้เงื่อนไขข้ามเดียวกัน').toBe(true);
});

const CASES = [
  // [ชื่อเคส, ชนิด, ฟอร์มเริ่มต้น, ค่าตั้งต้น(uia), ขั้นที่ต้องไม่ถูกข้าม, คลิกในหน้าต่างรายการที่คาด]
  ['ORDS เปิดมาเป็น ORCM + Front Store → เปลี่ยนประเภท', 'ORDS', OFORM, { start_type: ORCM_T, start_wh: 'Front Store' },
    ['doc-type-open', 'doc-type-pick', 'doc-type-ok'], ['SYSVOUCHERID:1', 'col1:1', 'cb_ok']],
  ['ORDS เปิดมาเป็น ORDS อยู่แล้ว → ไม่แตะอะไร', 'ORDS', OFORM, { start_type: ORDS_T, start_wh: 'Front Store' }, [], []],
  ['ORDS ประเภทถูกแต่คลัง Warehouse → เปลี่ยนคลังอย่างเดียว', 'ORDS', OFORM, { start_type: ORDS_T, start_wh: 'Warehouse' },
    ['warehouse-open', 'warehouse-pick', 'warehouse-ok'], ['SYSWAREHOUSEID:1', 'col1:2', 'cb_ok']],
  ['ORDS ผิดทั้งประเภทและคลัง → ตั้งประเภทก่อนแล้วคลัง', 'ORDS', OFORM, { start_type: ORCM_T, start_wh: 'Warehouse' },
    ['doc-type-open', 'doc-type-pick', 'doc-type-ok', 'warehouse-open', 'warehouse-pick', 'warehouse-ok'],
    ['SYSVOUCHERID:1', 'col1:1', 'cb_ok', 'SYSWAREHOUSEID:1', 'col1:2', 'cb_ok']],
  ['IRPS เปิดมาเป็น IRPS + Warehouse → เปลี่ยนคลัง', 'IRPS', IFORM, {}, ['warehouse-open', 'warehouse-pick', 'warehouse-ok'], ['SYSWAREHOUSEID:1', 'col1:2', 'cb_ok']],
  ['IRPS ถูกทั้งประเภทและคลัง → ไม่แตะอะไร', 'IRPS', IFORM, { start_wh: 'Front Store' }, [], []],
  ['IRPS เปิดมาเป็น IRCM + Warehouse → ตั้งประเภทแล้วคลัง', 'IRPS', IFORM, { start_type: 'IRCM ใบเสร็จรับเงิน(เงินสด)', start_wh: 'Warehouse' },
    ['doc-type-open', 'doc-type-pick', 'doc-type-ok', 'warehouse-open', 'warehouse-pick', 'warehouse-ok'], ['SYSVOUCHERID:1', 'col1:2', 'cb_ok', 'SYSWAREHOUSEID:1', 'col1:2', 'cb_ok']],
];
for (const [name, type, form, uia, ran, inPicker] of CASES) {
  test(`2. ★ ${name} — จบที่ประเภท+คลังถูกต้อง · ข้ามขั้นที่ตรงอยู่แล้ว · คลิกเท่าที่จำเป็น`, async () => {
    const r = scen({ type, uia });       // เส้นทางเต็มจากปิดโปรแกรม · ค่าตั้งต้นของฟอร์มที่เปิดใหม่ตั้งผ่าน uia (start_type/start_wh)
    expect([r.status, r.obj.ok, r.obj.reached], r.obj.message).toEqual([200, true, 'import-button']);
    const want = type === 'ORDS' ? ORDS_T : IRPS_T;
    // ขั้นที่ไม่ถูกข้าม = ขั้นที่ลงมือจริง
    const stepNames = r.obj.steps.map((s) => s.name).filter((n) => /^(doc-type|warehouse)-/.test(n));
    const notSkipped = r.obj.steps.filter((s) => /^(doc-type|warehouse)-/.test(s.name) && !s.skipped).map((s) => s.name);
    expect(stepNames, 'ทุกขั้นย่อยอยู่ในผลลัพธ์ (ข้ามก็ต้องบันทึก)').toHaveLength(6);
    expect(notSkipped).toEqual(ran);
    expect(fc(r), 'คลิกช่อง → แถว → ตกลง ตามลำดับ เท่าที่จำเป็นเท่านั้น').toEqual(inPicker);
    expect([r.vtype, r.wh], 'ฟอร์มตอนนำเข้า').toEqual([want, 'Front Store']);
    expect(r.picker, 'ไม่มีหน้าต่างรายการค้าง').toBeNull();
    expect(r.clicked[r.clicked.length - 1], 'คลิกปุ่มนำเข้าเป็นอย่างสุดท้าย').toBe(IMPORT);
    expect(r.misfires).toEqual([]);
    expect(r.after_import).toBe(0);
    if (ran.length === 0) expect(r.log, 'ข้ามเพราะตรงอยู่แล้ว').toContain('ข้าม: ค่าในฟอร์มตรงที่ต้องการอยู่แล้ว');
  });
}

test('3. ★ ด่านกันพลาด — หน้าต่างรายการ: แถวไม่มี/ซ้ำ/นอกกรอบ · เครื่องหมายไม่ย้าย/ย้ายผิดแถว · ตกลงไม่ผล/ใส่ค่าผิด · หัวข้อผิด · หน้าต่างซ้ำ/ค้าง → หยุดโดยไม่คลิกปุ่มนำเข้า', async () => {
  const bad = (r, code, step) => {
    expect([r.status, r.obj.ok, r.obj.code, r.obj.step], JSON.stringify(r.obj.message)).toEqual([500, false, code, step]);
    expect(r.clicked, 'ห้ามคลิกปุ่มนำเข้าเมื่อด่านไม่ผ่าน').not.toContain(IMPORT);
    expect(r.state, 'ไม่เปิดกล่อง Select File').not.toBe('import');
    expect(r.after_import).toBe(0);
    expect(r.misfires).toEqual([]);
  };
  const ORCM = { start_type: ORCM_T, start_wh: 'Front Store' };
  // ไม่มีแถวเป้า → หยุดที่ขั้นเลือกแถว (หน้าต่างรายการเปิดค้างไว้ ไม่คลิกแถวใดและไม่กดตกลง)
  const miss = scen({ uia: { ...ORCM, rows_missing: true } });
  bad(miss, 'LOCATOR_NOT_FOUND', 'doc-type-pick');
  expect(fc(miss), 'คลิกแค่ช่องเพื่อเปิดรายการ').toEqual(['SYSVOUCHERID:1']);
  expect(miss.vtype, 'ฟอร์มไม่เปลี่ยน').toBe(ORCM_T);
  // แถวเป้าซ้ำ 2 แถว → ไม่เดา
  const dup = scen({ uia: { ...ORCM, rows_dup: true } });
  bad(dup, 'LOCATOR_NOT_UNIQUE', 'doc-type-pick');
  expect(fc(dup)).toEqual(['SYSVOUCHERID:1']);
  // แถวที่ชื่อขึ้นต้นเหมือนเป้า (…(เก่า)) ต้องไม่ถูกนับ/ไม่ถูกคลิก — เลือกแถวที่ชื่อตรงทุกตัวอักษรเท่านั้น
  const decoy = scen({ uia: { ...ORCM, rows_decoy: true } });
  expect([decoy.status, decoy.vtype]).toEqual([200, ORDS_T]);
  expect(fc(decoy), 'คลิกแถวที่ 2 (แถวที่ 1 คือตัวหลอก)').toEqual(['SYSVOUCHERID:1', 'col1:2', 'cb_ok']);
  // แถวถูกเลื่อนออกนอกกรอบรายการ (UIA ยังรายงาน IsOffscreen=False) → ไม่คลิก
  const scrolled = scen({ uia: { ...ORCM, picker_scrolled: true } });
  bad(scrolled, 'LOCATOR_NOT_FOUND', 'doc-type-pick');
  expect(scrolled.obj.message).toContain('นอกกรอบรายการ');
  expect(fc(scrolled)).toEqual(['SYSVOUCHERID:1']);
  // คลิกแถวแล้วเครื่องหมายเลือกแถวไม่ย้าย → ไม่กดตกลง
  const nomove = scen({ uia: { ...ORCM, pick_no_effect: true } });
  bad(nomove, 'POSTCONDITION_FAILED', 'doc-type-pick');
  expect(fc(nomove), 'ไม่กด ตกลง').toEqual(['SYSVOUCHERID:1', 'col1:1']);
  expect(nomove.obj.message).toContain('ไม่กด ตกลง');
  // เครื่องหมายย้ายไปแถวอื่น (คลิกพลาด) → ไม่กดตกลง
  const wrong = scen({ uia: { ...ORCM, pick_wrong_row: true } });
  bad(wrong, 'POSTCONDITION_FAILED', 'doc-type-pick');
  expect(fc(wrong)).not.toContain('cb_ok');
  // กด ตกลง แต่ไม่มีอะไรเปลี่ยน → หยุดที่ขั้นตกลง (ไม่ไปปุ่มนำเข้า)
  const okno = scen({ uia: { ...ORCM, ok_no_effect: true } });
  bad(okno, 'POSTCONDITION_FAILED', 'doc-type-ok');
  // กด ตกลง แล้วฟอร์มได้ประเภทอื่น → หยุด (อ่านกลับไม่ตรง)
  const wv = scen({ uia: { ...ORCM, ok_wrong_value: true } });
  bad(wv, 'POSTCONDITION_FAILED', 'doc-type-ok');
  expect(wv.vtype).not.toBe(ORDS_T);
  // กด ตกลง ค่าเปลี่ยนถูกแล้ว แต่หน้าต่างรายการไม่ปิด → หยุด (หน้าต่างหลักยังถูกล็อก ห้ามไปขั้นถัดไป)
  const keep = scen({ uia: { ...ORCM, ok_keeps_open: true } });
  bad(keep, 'POSTCONDITION_FAILED', 'doc-type-ok');
  expect(keep.vtype).toBe(ORDS_T);
  // หัวข้อหน้าต่างรายการไม่ตรงช่องที่คลิก (เช่นเปิดรายการคลังแทนรายการประเภท) → ไม่คลิกแถว
  const title = scen({ uia: { ...ORCM, picker_wrong_title: true } });
  bad(title, 'POSTCONDITION_FAILED', 'doc-type-open');
  expect(fc(title)).toEqual(['SYSVOUCHERID:1']);
  // รายการคลังไม่มี Front Store → ไม่เลือกคลังอื่นแทน
  const nowh = scen({ type: 'IRPS', uia: { wh_missing: true } });
  bad(nowh, 'LOCATOR_NOT_FOUND', 'warehouse-pick');
  expect(nowh.wh, 'คลังยังเป็น Warehouse').toBe('Warehouse');
  expect(fc(nowh)).toEqual(['SYSWAREHOUSEID:1']);
  // แถวคล้ายชื่อคลัง (Front Store 2) ต้องไม่ถูกเลือก
  const whd = scen({ type: 'IRPS', uia: { rows_decoy: true } });
  expect([whd.status, whd.wh]).toEqual([200, 'Front Store']);
  expect(fc(whd)).toEqual(['SYSWAREHOUSEID:1', 'col1:3', 'cb_ok']);
  // หน้าต่างรายการ 2 ใบพร้อมกัน → ไม่เดา
  const two = scen({ uia: { ...ORCM, two_pickers: true } });
  bad(two, 'LOCATOR_NOT_UNIQUE', 'doc-type-pick');
  // หน้าต่างรายการค้างอยู่ก่อนเริ่ม (หน้าต่างหลักถูกล็อก) → ไม่คลิกทะลุ
  const stale = scen({ only: 'doc-type-open', ...OFORM, uia: { ...ORCM, picker_open: 'type' } });
  bad(stale, 'UNEXPECTED_DIALOG', 'doc-type-open');
  expect(stale.clicked).toEqual([]);
  // หน้าต่างรายการค้างอยู่ ทั้งที่ประเภทตรงอยู่แล้ว → ห้ามถือว่า "ตรงอยู่แล้ว" แล้วข้าม (หน้าต่างหลักถูกล็อก) ต้องหยุด
  const stale2 = scen({ only: 'doc-type-open', ...OFORM, uia: { start_type: ORDS_T, start_wh: 'Front Store', picker_open: 'type' } });
  bad(stale2, 'UNEXPECTED_DIALOG', 'doc-type-open');
  expect(stale2.obj.steps.map((x) => x.skipped), 'ขั้นนี้ไม่ถูกข้าม').toEqual([undefined]);
  // เลขที่เอกสารไม่ขึ้นต้นด้วยรหัสประเภท (แม้ชื่อประเภทตรง) → ไม่คลิกปุ่มนำเข้า
  const num = scen({ uia: { start_type: ORDS_T, start_wh: 'Front Store', number_stuck: 'ORCM' } });
  bad(num, 'PRECONDITION_FAILED', 'import-button');
  // รายการเลื่อนหลังเมาส์ขยับมาที่แถว → อ่านเป้าซ้ำแล้วต้องหยุด ไม่กดที่เดิม
  const rd = scen({ opts: { hover_ms: 100 }, uia: { ...ORCM, row_drift: true } });
  bad(rd, 'INTERFERENCE', 'doc-type-pick');
  expect(fc(rd), 'ไม่คลิกแถว').toEqual(['SYSVOUCHERID:1']);
  // ฟอร์มคนละคลาส (ฟอร์มโอนสินค้า) ที่มีฟิลด์ id เดียวกันและหน้าตาเหมือนค่าที่ต้องการ → ต้องไม่ถูกใช้ตัดสินแทนฟอร์มจริง (ประเภทจริงยังเป็น ORCM → ต้องเปลี่ยน)
  const dd = scen({ uia: { ...ORCM, header_decoy: true } });
  expect([dd.status, dd.vtype, fc(dd)], dd.obj.message).toEqual([200, ORDS_T, ['SYSVOUCHERID:1', 'col1:1', 'cb_ok']]);
  // เปลี่ยนคลังแล้วประเภทถูกรีเซ็ตกลับ → ด่านก่อนนำเข้าต้องจับได้ ไม่คลิกปุ่มนำเข้า
  const reset = scen({ uia: { start_type: ORCM_T, start_wh: 'Warehouse', wh_resets_type: true } });
  bad(reset, 'PRECONDITION_FAILED', 'import-button');
  expect(reset.obj.message).toContain('ไม่คลิกปุ่มนำเข้า');
  expect(reset.vtype).toBe(ORCM_T);
});

test('3b. ด่านก่อนปุ่มนำเข้าตรวจอ่านกลับเอง แม้เริ่มที่ขั้น import-button ตรงๆ (ประเภทผิด · คลังผิด · เลขที่ไม่ตรงรหัส) — ไม่ไว้ใจว่าขั้นก่อนหน้าทำถูก', async () => {
  const stop = (r) => {
    expect([r.status, r.obj.code, r.obj.step]).toEqual([500, 'PRECONDITION_FAILED', 'import-button']);
    expect(r.clicked, 'ไม่คลิกอะไรเลย').toEqual([]);
    expect(r.acts).toEqual([]);
  };
  stop(scen({ only: 'import-button', ...OFORM, uia: { start_type: ORCM_T, start_wh: 'Front Store' } }));      // ประเภทผิด
  stop(scen({ only: 'import-button', ...OFORM, uia: { start_type: ORDS_T, start_wh: 'Warehouse' } }));        // คลังผิด
  stop(scen({ only: 'import-button', type: 'IRPS', ...IFORM, uia: { start_type: IRPS_T, start_wh: 'Warehouse' } }));
  const ok = scen({ only: 'import-button', ...OFORM, uia: { start_type: ORDS_T, start_wh: 'Front Store' } });
  expect([ok.status, ok.state, ok.clicked]).toEqual([200, 'import', [IMPORT]]);
  // หลังจากนั้นห้ามมี input เพิ่ม (กฎเดิมข้อ 7)
  expect(ok.after_import).toBe(0);
});

test('4. dry-run ของแต่ละขั้นย่อย — ชี้เป้าถูกจุด ไม่ลงมือ · ข้ามขั้นที่ตรงอยู่แล้วโดยไม่วาดอะไร', async () => {
  const pt = (r) => r.shots[0].marks.find((x) => x.type === 'point').xy;
  const rc = (r) => r.shots[0].marks.find((x) => x.type === 'rect').rect;
  const ORCM = { start_type: ORCM_T, start_wh: 'Front Store' };
  // ช่องประเภทเอกสาร (122..290 × 177..197)
  const open = scen({ only: 'doc-type-open', ...OFORM, uia: ORCM, opts: { dry_run: true } });
  expect([open.status, open.obj.dryRun, open.acts, open.shots.length]).toEqual([200, true, [], 1]);
  expect([pt(open), rc(open)]).toEqual([[206, 187], [122, 177, 290, 197]]);
  // แถว ORDS = แถวที่ 1 ของรายการ (798..1101 × 409..429) · หน้าต่างรายการต้องเปิดอยู่ก่อน
  const pick = scen({ only: 'doc-type-pick', ...OFORM, uia: { ...ORCM, picker_open: 'type' }, opts: { dry_run: true } });
  expect([pick.status, pick.acts, pick.shots.length], pick.obj.message).toEqual([200, [], 1]);
  expect([pt(pick), rc(pick)]).toEqual([[949, 419], [798, 409, 1101, 429]]);
  expect(pick.clicked, 'dry-run ไม่คลิกจริง').toEqual([]);
  // ปุ่ม ตกลง (777..847 × 299..327)
  const ok = scen({ only: 'doc-type-ok', ...OFORM, uia: { ...ORCM, picker_open: 'type' }, opts: { dry_run: true } });
  expect([ok.status, ok.acts, pt(ok)]).toEqual([200, [], [812, 313]]);
  // คลัง: ช่อง (978..1154 × 200..220) · แถว Front Store = แถวที่ 2 (y 434..454)
  const wopen = scen({ only: 'warehouse-open', type: 'IRPS', ...IFORM, opts: { dry_run: true } });
  expect([wopen.status, pt(wopen)]).toEqual([200, [1066, 210]]);
  const wpick = scen({ only: 'warehouse-pick', type: 'IRPS', ...IFORM, uia: { picker_open: 'wh' }, opts: { dry_run: true } });
  expect([wpick.status, pt(wpick), rc(wpick)]).toEqual([200, [949, 444], [798, 434, 1101, 454]]);
  // ฟอร์มถูกอยู่แล้ว → ขั้น open ข้าม ไม่วาดภาพ
  const skip = scen({ only: 'doc-type-open', ...OFORM, uia: { start_type: ORDS_T, start_wh: 'Front Store' }, opts: { dry_run: true } });
  expect([skip.status, skip.shots.length, skip.obj.steps[0].skipped, skip.acts]).toEqual([200, 0, true, []]);
  // ขั้นเลือกแถวแต่หน้าต่างรายการยังไม่เปิด → ไม่มีอะไรให้ชี้ (ไม่เดา)
  const early = scen({ only: 'doc-type-pick', ...OFORM, uia: ORCM, opts: { dry_run: true } });
  expect([early.status, early.obj.code, early.obj.step, early.shots.length]).toEqual([500, 'PRECONDITION_FAILED', 'doc-type-pick', 0]);
});

test('5. ตัวช่วยย่อย — โทเคนดิบ {=ชื่อ} ไม่ escape · {ชื่อ} escape · name_re กรองฝั่งตัวช่วย · note อ่านชื่อลง log อย่างเดียว', async () => {
  const r = runPy(`
import fake_ssmaxx_uia as fu
tok = {'type_row': 'ORDS ใบปรับปรุงลดสินค้า', 'letter': 'O', 'x': 'a b.c'}
raw = m._fmt({'name': '{=type_row}', 're': '^{x}$', 'mixed': '{=x}|{x}', 'lst': ['{=type_row}', {'k': '{letter}'}]}, tok)
svc, ui, log, st = fu.make_uia(m, tmp, start_state='doc', start_doc_menu='เอกสารรับ', start_letter='I', uia={'start_type': 'IRPS ใบปรับปรุงเพิ่มสินค้า', 'start_wh': 'Front Store'})
run = m.Runner(ui, st, log)
run.tokens = dict(m.DOC_TYPES['IRPS'])
W = {'cls_re': r'^HwndWrapper\\[ssmaxx\\.exe;;', 'title': r'^SeniorSoft ProMaxx$'}
def cond(sel):
    return run._cond({'uia': dict(sel, within=W)}, 'x')
ancestor = {'cls': 'pn_trans_in'}
base = {'id': 'TRANNO:1', 'type': 'Custom', 'ancestor': ancestor}
res = dict(
  re_ok=cond(dict(base, name_re='^IRPS')), re_wrong=cond(dict(base, name_re='^ORDS')), re_none=cond(dict(base)),
  wrong_parent=cond(dict(base, name_re='^IRPS', ancestor={'cls': 'pn_trans_out'})),
  lower_id=cond({'id': 'sysvoucherid_t:1', 'type': 'Custom', 'ancestor': ancestor}),     # ตัวกรองที่ซ่อนอยู่ (off=True) ต้องไม่ถูกนับว่าเห็น
  type_exact=cond({'id': 'SYSVOUCHERID:1', 'type': 'Custom', 'name': 'ใบปรับปรุงเพิ่มสินค้า', 'ancestor': ancestor}),
  type_other=cond({'id': 'SYSVOUCHERID:1', 'type': 'Custom', 'name': 'ใบปรับปรุงลดสินค้า', 'ancestor': ancestor}),
)
before = list(ui.calls)
run._note({'sel': dict(base, within=W), 'label': 'เลขที่'}, 'x')
run._note({'sel': {'id': 'ไม่มีอยู่', 'type': 'Custom', 'within': W}, 'label': 'ผี'}, 'x')
print(json.dumps(dict(raw=raw, res=res, log='\\n'.join(log.lines), acting=[c for c in ui.calls if c[0] in fu.ACTING], same=(before == ui.calls)), ensure_ascii=False))`);
  expect(r.raw.name, 'โทเคนดิบไม่ถูก escape (ช่องว่างต้องคงเดิม)').toBe(ORDS_T);
  expect(r.raw.re, 'โทเคนปกติถูก escape สำหรับ regex').toBe('^a\\ b\\.c$');
  expect(r.raw.mixed).toBe('a b.c|a\\ b\\.c');
  expect(r.raw.lst).toEqual([ORDS_T, { k: 'O' }]);
  expect([r.res.re_ok, r.res.re_wrong, r.res.re_none], 'name_re กรองตามชื่อจริงของเลขที่เอกสาร').toEqual([true, false, true]);
  expect(r.res.wrong_parent, 'หน้าแม่ไม่ตรงคลาสฟอร์ม = ไม่นับ').toBe(false);
  expect(r.res.lower_id, 'id ตัวพิมพ์เล็กของตัวกรองที่ซ่อนอยู่ต้องไม่ถูกนับ').toBe(false);
  expect([r.res.type_exact, r.res.type_other]).toEqual([true, false]);
  expect(r.log).toContain('เลขที่: IRPSBY001261100001');
  expect(r.log, 'องค์ประกอบที่ไม่พบ = บันทึกว่าอ่านไม่ได้ ไม่โยนข้อผิดพลาด').toContain('ผี: (อ่านไม่ได้)');
  expect(r.acting, 'note อ่านอย่างเดียว ไม่คลิก/พิมพ์').toEqual([]);
});
