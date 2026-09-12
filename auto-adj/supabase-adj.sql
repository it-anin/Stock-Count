-- ============================================================================
--  auto-adj · ตารางบน Supabase สำหรับป็อปอัพ 📦 ปรับปรุงสินค้า (Stock Count)
--
--  รันใน Supabase Dashboard → SQL Editor ของ project eogqnedbdpjuptwlqudn
--  รันซ้ำได้ (ทุกคำสั่งเป็น if not exists / drop-if-exists) · ไม่แตะตารางอื่นของระบบขาย
--
--  ใครเขียน: auto-adj/auto_adj_import.py ด้วย service_role key (ข้าม RLS) เท่านั้น
--  ใครอ่าน:  index.html ด้วย anon key — ได้สิทธิ์ SELECT อย่างเดียว เขียนไม่ได้
--
--  รูปแบบ "generation": บอทใส่ข้อมูลชุดใหม่ด้วยเลข gen ใหม่ก่อน (ยังไม่มีใครเห็น)
--  นับกลับให้ครบ แล้วค่อยสลับ adj_meta.active_gen ทีเดียว — ล้มกลางทางชุดเดิมยังใช้ได้ครบ
--  เว็บต้องกรองด้วย gen = active_gen เสมอ
-- ============================================================================

-- R14.102 → LOT/EXP · 1 แถว = 1 คู่ SKU+LOT (ซ้ำในไฟล์เก็บตัวแรก)
create table if not exists public.adj_r14_lots (
  gen  bigint  not null,
  seq  integer not null,              -- ลำดับที่คู่นี้ปรากฏครั้งแรกในไฟล์ → dropdown เรียงเหมือนแนบไฟล์เอง
  sku  text    not null,
  lot  text    not null,
  exp  text    not null default '',   -- ข้อความดิบจากไฟล์ (เว็บแปลงเป็น พ.ศ. ตอน Export เอง)
  primary key (gen, sku, lot)
);

-- R05.105 → ราคา Price Level 4 · 1 แถว = 1 SKU (แถว Level 4 แถวแรกของ SKU นั้น)
create table if not exists public.adj_r05_prices (
  gen   bigint  not null,
  seq   integer not null,
  sku   text    not null,
  unit  text    not null default '',
  price double precision,             -- null = อ่านราคาไม่ได้ (เว็บแสดง "—")
  primary key (gen, sku)
);

-- ตัวชี้ว่าชุดไหนใช้งานจริง + เวลาไว้โชว์บนการ์ด
create table if not exists public.adj_meta (
  kind         text primary key check (kind in ('r14', 'r05_105')),
  active_gen   bigint,
  prev_gen     bigint,                -- ชุดก่อนหน้า เก็บไว้ย้อนกลับได้
  row_count    integer,
  sku_count    integer,
  content_hash text,                  -- เนื้อหาเหมือนเดิม = บอทไม่เขียนซ้ำ
  source_file  text,
  source_mtime timestamptz,
  uploaded_at  timestamptz,           -- เวลาที่ข้อมูลเปลี่ยนล่าสุด
  checked_at   timestamptz            -- เวลาที่บอทรันล่าสุด (แม้ไม่ได้เขียน) → การ์ดรู้ว่าบอทรันวันนี้แล้ว
);

-- ── สิทธิ์ ─────────────────────────────────────────────────────────────────
-- anon อ่านได้อย่างเดียว · ไม่มี policy เขียนเลย (RLS ปฏิเสธ) และถอน grant เขียนออกอีกชั้น
-- (TRUNCATE ไม่ผ่าน RLS จึงต้องถอน grant ด้วย) · service_role มี BYPASSRLS ไม่กระทบ
alter table public.adj_r14_lots   enable row level security;
alter table public.adj_r05_prices enable row level security;
alter table public.adj_meta       enable row level security;

drop policy if exists adj_r14_lots_read   on public.adj_r14_lots;
drop policy if exists adj_r05_prices_read on public.adj_r05_prices;
drop policy if exists adj_meta_read       on public.adj_meta;
create policy adj_r14_lots_read   on public.adj_r14_lots   for select to anon, authenticated using (true);
create policy adj_r05_prices_read on public.adj_r05_prices for select to anon, authenticated using (true);
create policy adj_meta_read       on public.adj_meta       for select to anon, authenticated using (true);

revoke insert, update, delete, truncate on public.adj_r14_lots, public.adj_r05_prices, public.adj_meta from anon, authenticated;
grant  select                           on public.adj_r14_lots, public.adj_r05_prices, public.adj_meta to   anon, authenticated;

-- ── ตรวจหลังรัน (ต้องได้ 3 แถว rowsecurity = true) ────────────────────────
-- select tablename, rowsecurity from pg_tables where schemaname = 'public' and tablename like 'adj\_%';

-- ── ย้อนกลับไปชุดก่อนหน้า (ใช้เมื่อบอทเขียนข้อมูลผิดขึ้นไป) ──────────────────
-- เปลี่ยน 'r14' เป็น 'r05_105' และ adj_r14_lots เป็น adj_r05_prices ถ้าจะย้อนราคา
-- content_hash = null เพื่อให้บอทรอบถัดไปตัดสินใหม่จากไฟล์จริง ไม่ใช่เทียบกับชุดที่ผิด
--
-- update public.adj_meta m
--    set active_gen   = m.prev_gen,
--        prev_gen     = null,
--        content_hash = null,
--        row_count    = (select count(*)            from public.adj_r14_lots l where l.gen = m.prev_gen),
--        sku_count    = (select count(distinct sku) from public.adj_r14_lots l where l.gen = m.prev_gen),
--        uploaded_at  = now()
--  where m.kind = 'r14' and m.prev_gen is not null;
