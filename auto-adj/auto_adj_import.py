#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Auto import R14.102 (LOT/EXP) + R05.105 (ราคา Price Level 4)  ->  Supabase  (Stock Count)

ป้อนข้อมูลให้ป็อปอัพ 📦 ปรับปรุงสินค้า ใน index.html — เดิมต้องแนบ 2 ไฟล์นี้เองทุกครั้งที่จะออกใบ ORDS/IRPS
ตอนนี้ป็อปอัพไปดึงเฉพาะ SKU ที่อยู่ในใบจาก Supabase เอง (ไฟล์ R14.102 มีมากกว่า 200,000 แถว ใส่ Firestore ไม่ได้)

ปลายทาง (project eogqnedbdpjuptwlqudn · สร้างตารางด้วย supabase-adj.sql ก่อน):
    adj_r14_lots    ← R14.102   (1 แถว = 1 คู่ SKU+LOT)
    adj_r05_prices  ← R05.105   (1 แถว = 1 SKU · เฉพาะ Price Level 4)
    adj_meta        ← ตัวชี้ว่าชุดไหนใช้งานจริง (active_gen) + เวลาไว้โชว์บนการ์ด

ใช้ Python stdlib ล้วน — ไม่ต้องลง pip อะไรเพิ่ม · เขียนด้วย service_role key (ข้าม RLS)

⚠️ ตรรกะ parse ถูกเขียนไว้ 2 ภาษา (JS ใน index.html · Python ในไฟล์นี้)
   ป็อปอัพยังรับไฟล์ที่แนบเองเป็นทางสำรอง ถ้าสองฝั่งหลุดจากกัน ใบจะได้ LOT/ราคาต่างกันขึ้นกับว่าข้อมูลมาทางไหน
   แก้ที่ใดที่หนึ่งต้องแก้อีกที่เสมอ แล้วยืนยันด้วย:
       node tools/check-adj-parity.js "<R14.102.CSV>" "<R05.105.CSV>"

วิธีรัน:
    python auto_adj_import.py                 # โหมดจริง — เขียนขึ้น Supabase เมื่อเนื้อหาเปลี่ยน
    python auto_adj_import.py --dry-run       # ทดสอบ — อ่าน/ตรวจอย่างเดียว ไม่เขียน
    python auto_adj_import.py --force         # ข้าม guard "ไฟล์ไม่ใช่ของวันนี้" (ใช้ตอนทดสอบ/อัปด้วยมือ)
    python auto_adj_import.py --only r14      # ทำไฟล์เดียว (r14 หรือ r05_105)
    python auto_adj_import.py --allow-shrink  # ยอมให้จำนวนแถวหดเกิน 20% (ตัดสินค้าออกจริง)
    python auto_adj_import.py --folder "D:\\path"

⛔ flag ที่ไม่รู้จัก = หยุดทันที (exit 2) ไม่เดินต่อ — กันกับดักที่ auto-r01/r05 เคยเจอ:
   สคริปต์รุ่นเก่าเมิน flag ใหม่แล้วเดินเข้าโหมดปกติซึ่งเขียนจริงทันที
"""

import sys
import os
import csv
import io
import re
import json
import glob
import time
import hashlib
import urllib.request
import urllib.error
import urllib.parse
from datetime import datetime, timezone

# บังคับ console เป็น UTF-8 (กัน emoji/ภาษาไทย crash บน Windows cp874)
try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass

# ============================================================
#  CONFIG — แก้ตรงนี้ให้ตรงกับเครื่องจริง
# ============================================================

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))

# Supabase project เดียวกับที่ BOTR05106 / anin_sale_support ใช้ (ตาราง adj_* เป็นของ Stock Count ล้วน)
SUPABASE_URL = "https://eogqnedbdpjuptwlqudn.supabase.co"

# โฟลเดอร์ที่ไฟล์ถูก export มาวาง — หาตามลำดับเดียวกับ auto-r01/auto-r05:
#   1. อาร์กิวเมนต์ --folder "<path>"        (ใช้ตอนทดสอบ)
#   2. ตัวแปรระบบ AUTO_ADJ_WATCH_FOLDER      (ใช้เมื่อ path ไม่ตรงแบบมาตรฐาน)
#   3. <โฟลเดอร์ผู้ใช้ปัจจุบัน>\Desktop\run-upload-stock   ← ค่าปกติ (โฟลเดอร์เดียวกับ auto-r01/auto-r05)
#
# ⚠️ **ใช้โฟลเดอร์ร่วมกับ auto-r01/auto-r05 ⇒ ชื่อไฟล์ R05.105 ต้องมีคำนำหน้า**
#    R05.105 (ไฟล์นี้ = ตารางราคาสำหรับใบปรับปรุง) กับ R05.106 (ของ auto-r05 = ตารางบาร์โค้ดสำหรับสแกน)
#    เป็นรายงานคนละตัว คอลัมน์ไม่ตรงกันเลยแม้แต่ช่องเดียว — ยืนยันกับไฟล์จริง 12 ก.ย. 2026:
#      R05.106 (27 คอลัมน์): A CF_BARCODE · B CF_FMLPRICE · E CF_ITEMID · G CF_UNITNAME · H CF_BASEMULTIPLE
#      R05.105 (34 คอลัมน์): B CF_ITEMID · E CF_UNITNAME · F CF_LEVELNO · H CF_FMLPRICE
#    ⛔ auto-r05 ค้นด้วย "R05*.CSV" (กว้างกว่าชื่อที่มันต้องการ) แล้วหยิบไฟล์ใหม่สุด — ห้ามแก้สคริปต์นั้น
#       ⇒ ไฟล์ราคาต้องตั้งชื่อ **ไม่ขึ้นต้นด้วย R05** เช่น `ADJ_R05.105.CSV` (รูปแบบของ auto-r05 ผูกกับต้นชื่อ
#          จึงมองไม่เห็น) ถ้าใช้ชื่อ `R05.105.CSV` ล้วน วันที่ไฟล์นั้นใหม่กว่า R05.106 auto-r05 จะหยิบผิดไฟล์
#          แล้วตกด่านหัวคอลัมน์ (exit 4) = ตารางบาร์โค้ดไม่ถูกอัปวันนั้นแบบเงียบ
#    ⚠️ และห้ามต่อวันที่ท้ายชื่อไฟล์ทุกตัวในโฟลเดอร์นี้ — วันที่บางวันมีเลข 105/106 ปนอยู่
#       (เช่น `R05.106-01052026.CSV` มี "105") ทำให้รูปแบบของอีกบอทจับติด
DEFAULT_WATCH_FOLDER = os.path.join(os.path.expanduser("~"), "Desktop", "run-upload-stock")

# ⚠️ ไฟล์ชื่อมี ".part." = ยังเขียนไม่เสร็จ ข้ามเสมอ (ธรรมเนียมเดียวกับ BOTR05106)
PART_MARKER = ".part."

# ขนาดชุดที่ส่งต่อ request — เล็กพอไม่ชน statement timeout ของ Supabase
CHUNK = 5000

# แถวหดจากชุดที่ใช้งานอยู่เกินสัดส่วนนี้ = export ไม่ครบ (กติกาเดียวกับ auto-r05 / upload-products.mjs)
MAX_SHRINK_RATIO = 0.20

# ไฟล์เพิ่งถูกแก้ภายในเวลานี้ = export อาจยังไม่เสร็จ ให้รอจนขนาดนิ่ง (ลอกจาก upload-products.mjs)
STABILITY_WINDOW_S = 60
STABILITY_WAIT_S = 20
STABILITY_TRIES = 3

# index คอลัมน์ — ต้องตรงกับ _parseAdjLotRows / _parseAdjPriceRows ใน index.html
R14_COL_EXP = 1    # B  CF_EXPIREDATE_TEXT
R14_COL_SKU = 9    # J  CF_ITEMID
R14_COL_LOT = 11   # L  CF_LOTNO

R05_COL_SKU = 1    # B  CF_ITEMID
R05_COL_UNIT = 4   # E  CF_UNITNAME
R05_COL_LEVEL = 5  # F  CF_LEVELNO
R05_COL_PRICE = 7  # H  CF_FMLPRICE
R05_PRICE_LEVEL = 4

KINDS = {
    "r14": {
        "label": "R14.102 (LOT/EXP)",
        # `*` หน้าสุดเพื่อรับชื่อที่มีคำนำหน้า เช่น ADJ_R14.102.CSV (ตั้งชื่อชุดเดียวกับไฟล์ราคาได้)
        "glob": "*R14*102*.CSV",
        "table": "adj_r14_lots",
        # ✅ ยืนยันกับไฟล์จริงแล้ว (ADJ_R14.102.CSV · 12 ก.ย. 2026): 0 TRANDATE · 1 EXPIREDATE ·
        #    2 CF_EXPIREDATE_TEXT · 3 CF_TRANDATE · 7 CF_WAREHOUSE_NAME · 9 CF_ITEMID · 11 CF_LOTNO · 14 CF_QUANTITY
        # ⚠️ คอลัมน์ที่ 1 ชื่อ EXPIREDATE (`1/1/1999`) ไม่ใช่ CF_EXPIREDATE_TEXT (`01/01/1999` อยู่คอลัมน์ที่ 2)
        #    ทั้งคู่เป็นวันเดียวกันต่างแค่ศูนย์หน้า และ index.html อ่านคอลัมน์ที่ 1 มาตลอด (`_toBeDMY` เติมศูนย์ให้เอง)
        #    ⛔ ห้ามย้ายไปคอลัมน์ที่ 2 โดยไม่แก้ index.html พร้อมกัน (ต้องอ่านคอลัมน์เดียวกันเสมอ)
        "headers": {R14_COL_EXP: "EXPIREDATE", R14_COL_SKU: "CF_ITEMID", R14_COL_LOT: "CF_LOTNO"},
        # ไฟล์จริง 12 ก.ย. 2026: 44 MB · 130,408 แถว → 35,311 คู่ SKU+LOT · 5,140 SKU · ขั้นต่ำตั้งไว้ราวครึ่งหนึ่ง
        "min_rows": 15000,
    },
    "r05_105": {
        "label": "R05.105 (ราคา Level 4)",
        # `*` หน้าสุดเพื่อรับชื่อที่มีคำนำหน้า (ADJ_R05.105.CSV) ซึ่งเป็นชื่อที่ต้องใช้จริง —
        # auto-r05 ค้น "R05*.CSV" ผูกกับต้นชื่อ จึงมองไม่เห็นไฟล์ที่มีคำนำหน้า (ดูหมายเหตุที่ DEFAULT_WATCH_FOLDER)
        "glob": "*R05*105*.CSV",
        "table": "adj_r05_prices",
        # ยืนยันกับไฟล์จริงแล้ว (R05105-27072026.CSV)
        "headers": {R05_COL_SKU: "CF_ITEMID", R05_COL_UNIT: "CF_UNITNAME",
                    R05_COL_LEVEL: "CF_LEVELNO", R05_COL_PRICE: "CF_FMLPRICE"},
        # ไฟล์จริง ก.ค. 2026: 38,673 แถว → 6,607 SKU ที่มีแถว Level 4 · ขั้นต่ำตั้งไว้ราวครึ่งหนึ่ง
        "min_rows": 3000,
    },
}

KNOWN_FLAGS = {"--dry-run", "-n", "--force", "--allow-shrink", "--only", "--folder"}

# ============================================================


def log(msg):
    print(f"[{datetime.now():%Y-%m-%d %H:%M:%S}] {msg}", flush=True)


def parse_args(argv):
    """ตรวจ flag ทุกตัว — ไม่รู้จัก = คืน error (ห้ามเมินแล้วเดินต่อ)"""
    opts = {"dry_run": False, "force": False, "allow_shrink": False, "only": None, "folder": None}
    i = 0
    while i < len(argv):
        a = argv[i]
        key, val = (a.split("=", 1) + [None])[:2] if a.startswith("--") and "=" in a else (a, None)
        if key not in KNOWN_FLAGS:
            return None, f"ไม่รู้จัก flag '{a}'"
        if key in ("--only", "--folder"):
            if val is None:
                if i + 1 >= len(argv):
                    return None, f"{key} ต้องตามด้วยค่า"
                i += 1
                val = argv[i]
            if key == "--only":
                if val not in KINDS:
                    return None, f"--only ต้องเป็น {' หรือ '.join(KINDS)} (ได้ '{val}')"
                opts["only"] = val
            else:
                opts["folder"] = val
        elif val is not None:
            return None, f"{key} ไม่รับค่า"
        elif key in ("--dry-run", "-n"):
            opts["dry_run"] = True
        elif key == "--force":
            opts["force"] = True
        elif key == "--allow-shrink":
            opts["allow_shrink"] = True
        i += 1
    return opts, None


def resolve_watch_folder(folder_arg):
    if folder_arg:
        return folder_arg, "--folder"
    env = os.environ.get("AUTO_ADJ_WATCH_FOLDER", "").strip()
    if env:
        return env, "AUTO_ADJ_WATCH_FOLDER"
    return DEFAULT_WATCH_FOLDER, "ค่าปกติ (โฟลเดอร์ผู้ใช้ปัจจุบัน)"


def get_service_key():
    """service_role key — env SUPABASE_SERVICE_KEY ก่อน ไม่มีค่อยอ่าน .env ข้างสคริปต์
    ธรรมเนียมเดียวกับ BOTR05106/upload-products.mjs · ⛔ ห้าม commit .env (อยู่ใน .gitignore แล้ว)
    """
    k = os.environ.get("SUPABASE_SERVICE_KEY", "").strip()
    if k:
        return k, "env SUPABASE_SERVICE_KEY"
    path = os.path.join(SCRIPT_DIR, ".env")
    try:
        with open(path, encoding="utf-8-sig") as f:
            for line in f:
                m = re.match(r"^\s*SUPABASE_SERVICE_KEY\s*=\s*(.+?)\s*$", line)
                if m:
                    return m.group(1).strip().strip('"').strip("'"), ".env ข้างสคริปต์"
    except FileNotFoundError:
        pass
    return None, None


def key_problem(k):
    """คืนคำอธิบายถ้าคีย์ใช้ไม่ได้ — ว่าง = ผ่าน

    มีไว้เพราะเคสจริง 14 ก.ย. 2026: มีคนวางข้อความตัวอย่าง '<วางคีย์ตรงนี้>' ลง .env ตรงตัว
    แล้วสคริปต์ไปพังตอนใส่ค่าลง HTTP header ด้วย UnicodeEncodeError ซึ่งอ่านไม่รู้เรื่อง
    (header ของ http.client เข้ารหัสแบบ latin-1 ภาษาไทยจึงใส่ไม่ได้)
    """
    if k.startswith("<") or k.endswith(">"):
        return "ยังเป็นข้อความตัวอย่างในวงเล็บมุม ไม่ใช่คีย์จริง"
    try:
        k.encode("latin-1")
    except UnicodeEncodeError:
        return "มีอักขระที่ไม่ใช่ ASCII (เช่นภาษาไทย) — น่าจะยังไม่ได้วางคีย์จริง"
    if len(k) < 40:
        return f"สั้นผิดปกติ ({len(k)} ตัวอักษร) — service_role key ยาวกว่านี้มาก"
    return ""


def find_latest_file(folder, pattern):
    files = glob.glob(os.path.join(folder, pattern))
    if not files:
        files = glob.glob(os.path.join(folder, pattern.lower()))
    files = [f for f in files if PART_MARKER not in os.path.basename(f).lower()]
    if not files:
        return None
    files.sort(key=os.path.getmtime, reverse=True)
    return files[0]


def wait_for_stable_file(path):
    """ไฟล์เพิ่งถูกเขียน = export อาจยังไม่เสร็จ รอจนขนาด+เวลาแก้ไขนิ่ง — ไม่นิ่งภายในที่กำหนด คืน False"""
    prev = os.stat(path)
    if time.time() - prev.st_mtime >= STABILITY_WINDOW_S:
        return True
    for i in range(1, STABILITY_TRIES + 1):
        log(f"   ไฟล์เพิ่งถูกเขียนเมื่อครู่ — รอ {STABILITY_WAIT_S} วินาทีให้ export เสร็จ ({i}/{STABILITY_TRIES})")
        time.sleep(STABILITY_WAIT_S)
        cur = os.stat(path)
        if cur.st_size == prev.st_size and cur.st_mtime == prev.st_mtime:
            return True
        prev = cur
    return False


# ── ตัวช่วยให้ผลเท่า JS ทุกตัวอักษร ────────────────────────────────────────────
# str.strip() ของ Python กับ .trim() ของ JS ตัดช่องว่างคนละชุด (JS ตัด \ufeff แต่ Python ไม่ตัด ·
# Python ตัด \x1c-\x1f แต่ JS ไม่ตัด) — ใช้ชุดของ JS ตรง ๆ เพื่อ parity
_JS_WS = ("\t\n\x0b\x0c\r \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006"
          "\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff")
_JS_WS_COMMA_RE = re.compile("[," + re.escape(_JS_WS) + "]")


def js_trim(value):
    """(x ?? '').toString().trim() ของ JS"""
    return str(value if value is not None else "").strip(_JS_WS)


def js_strip_ws_commas(value):
    """.replace(/,|\\s/g,'') ของ JS"""
    return _JS_WS_COMMA_RE.sub("", str(value if value is not None else ""))


# ไวยากรณ์ StrDecimalLiteral ของ JS — ใช้ [0-9] ไม่ใช่ \d เพราะ \d ของ Python จับเลขยูนิโค้ดด้วย
_JS_DEC_RE = re.compile(r"[+-]?(?:[0-9]+\.?[0-9]*(?:[eE][+-]?[0-9]+)?|\.[0-9]+(?:[eE][+-]?[0-9]+)?)")


def js_number(text):
    """Number() ของ JS — คืน None เมื่อ JS จะได้ NaN

    ไม่ใช้ float() ตรง ๆ เพราะต่างจาก Number() หลายจุด:
      · '0x10' / '0b101' / '0o17'  JS อ่านเป็นเลขฐาน แต่ Python โยน ValueError
      · '1_0'                      Python อ่านได้ 10 แต่ JS ได้ NaN
      · 'inf' / 'nan' / 'infinity' Python อ่านได้ แต่ JS ได้ NaN (JS รับเฉพาะ 'Infinity' ตัวพิมพ์นี้เท่านั้น)
      · เลขยูนิโค้ด เช่น '４'       Python อ่านได้ 4 แต่ JS ได้ NaN
    จึงตรวจด้วยไวยากรณ์ของ JS ก่อน ผ่านแล้วค่อยให้ float() แปลงค่า (ปัดเศษแบบเดียวกับ JS)
    """
    t = js_trim(text)
    if t == "":
        return 0.0                      # Number('') === 0
    if re.fullmatch(r"0[xX][0-9a-fA-F]+", t):
        return float(int(t[2:], 16))
    if re.fullmatch(r"0[oO][0-7]+", t):
        return float(int(t[2:], 8))
    if re.fullmatch(r"0[bB][01]+", t):
        return float(int(t[2:], 2))
    if re.fullmatch(r"[+-]?Infinity", t):
        return float("-inf") if t[0] == "-" else float("inf")
    if _JS_DEC_RE.fullmatch(t):
        return float(t)
    return None


def _finite(v):
    return v is not None and v == v and v not in (float("inf"), float("-inf"))


def decode_bytes(raw):
    """เลียนแบบ parseFile() ใน index.html: UTF-8 BOM -> UTF-8 -> Windows-874 (cp874)"""
    if raw[:3] == b"\xef\xbb\xbf":
        return raw[3:].decode("utf-8", errors="replace")
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError:
        return raw.decode("cp874", errors="replace")


def col(row, i):
    """(r[i] ?? '') ของ JS — แถวสั้นกว่าที่คาดต้องได้สตริงว่าง ไม่ใช่ error"""
    return row[i] if i < len(row) else ""


def read_rows(path):
    """อ่าน CSV ด้วย config เดียวกับ parseFile() ใน index.html (ลอกจาก auto-r05 ที่ผ่าน parity แล้ว)

    ⛔ ห้ามเดา delimiter — parseFile ส่ง delimiter:',' ตายตัว
    """
    with open(path, "rb") as f:
        raw = f.read()
    text = decode_bytes(raw)
    rows = list(csv.reader(io.StringIO(text), delimiter=",", quotechar='"'))
    # skipEmptyLines:true ของ papaparse = ตัดเฉพาะบรรทัดที่ว่างทั้งบรรทัด
    return [r for r in rows if not (len(r) == 1 and r[0] == "")]


def header_problems(rows, expected):
    """คืนลิสต์คำอธิบายคอลัมน์ที่ไม่ตรงตำแหน่ง — ว่าง = ผ่าน"""
    if not rows:
        return ["ไฟล์ว่าง ไม่มีแม้แต่แถวหัวตาราง"]
    head = rows[0]
    bad = []
    for idx, want in sorted(expected.items()):
        got = js_trim(col(head, idx)).upper()
        if got != want:
            bad.append(f"คอลัมน์ที่ {idx} ควรเป็น {want} แต่เจอ {got or '(ว่าง)'}")
    return bad


# ── parse (ต้องให้ผลเท่า index.html) ────────────────────────────────────────


def parse_lot_rows(rows):
    """ตรงกับ _parseAdjLotRows() ใน index.html — คืนลิสต์ {seq, sku, lot, exp} ตามลำดับที่ปรากฏครั้งแรก

    ⚠️ ชื่อฟังก์ชันนี้ถูก import ตรง ๆ โดย tools/check-adj-parity.js ห้ามเปลี่ยน signature
    เว็บไม่ข้ามหัวตาราง (ตัวกรอง SKU ในใบทิ้งแถวหัวเอง) แต่บอทเก็บทุก SKU จึงต้องข้ามแถวหัวเอง
    """
    out = []
    seen = set()
    for r in rows[1:]:
        if not r:
            continue
        sku = js_trim(col(r, R14_COL_SKU))
        lot = js_trim(col(r, R14_COL_LOT))
        exp = js_trim(col(r, R14_COL_EXP))
        if not sku or not lot:
            continue
        key = (sku, lot)
        if key in seen:              # คู่ซ้ำเก็บตัวแรก (EXP ของแถวแรก) เหมือน arr.some(e=>e.lot===lot)
            continue
        seen.add(key)
        out.append({"seq": len(out), "sku": sku, "lot": lot, "exp": exp})
    return out


def parse_price_rows(rows):
    """ตรงกับ _parseAdjPriceRows() ใน index.html — คืนลิสต์ {seq, sku, unit, price} (SKU ละแถว Level 4 แถวแรก)

    ⚠️ ชื่อฟังก์ชันนี้ถูก import ตรง ๆ โดย tools/check-adj-parity.js ห้ามเปลี่ยน signature
    """
    out = []
    seen = set()
    for r in rows[1:]:
        if not r:
            continue
        if js_number(col(r, R05_COL_LEVEL)) != float(R05_PRICE_LEVEL):   # Number(...)!==4
            continue
        sku = js_trim(col(r, R05_COL_SKU))
        if not sku or sku in seen:
            continue
        seen.add(sku)
        unit = js_trim(col(r, R05_COL_UNIT))
        p_raw = js_trim(js_strip_ws_commas(col(r, R05_COL_PRICE)))
        price = None
        if p_raw != "":
            v = js_number(p_raw)
            if _finite(v):                                # isFinite(+pRaw) ? +pRaw : null
                price = v
        out.append({"seq": len(out), "sku": sku, "unit": unit, "price": price})
    return out


PARSERS = {"r14": parse_lot_rows, "r05_105": parse_price_rows}


def content_hash(rows):
    canon = json.dumps(rows, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
    return hashlib.sha256(canon.encode("utf-8")).hexdigest()


# ============================================================
#  Supabase REST (PostgREST)
# ============================================================


class SbError(Exception):
    pass


def sb_request(key, method, path, body=None, headers=None, timeout=120):
    """คืน (status, headers, json|None) · HTTP error → SbError พร้อมข้อความจาก server"""
    h = {"apikey": key, "Authorization": f"Bearer {key}", "Accept": "application/json"}
    data = None
    if body is not None:
        data = json.dumps(body, ensure_ascii=False, allow_nan=False).encode("utf-8")
        h["Content-Type"] = "application/json"
    if headers:
        h.update(headers)
    req = urllib.request.Request(SUPABASE_URL + path, data=data, method=method, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read()
            payload = json.loads(raw.decode("utf-8")) if raw.strip() else None
            return resp.status, resp.headers, payload
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")[:400]
        hint = ""
        if e.code == 404 or "does not exist" in detail or "PGRST205" in detail:
            hint = " — ยังไม่ได้รัน auto-adj/supabase-adj.sql ใน Supabase SQL Editor?"
        elif e.code in (401, 403):
            hint = " — service key ผิด/หมดอายุ? (Supabase Dashboard → Settings → API → service_role)"
        raise SbError(f"HTTP {e.code} {method} {path.split('?')[0]}: {detail}{hint}") from None
    except urllib.error.URLError as e:
        raise SbError(f"ต่อ Supabase ไม่ได้: {e.reason}") from None


def read_meta(key, kind):
    q = urllib.parse.quote(kind)
    _, _, rows = sb_request(key, "GET", f"/rest/v1/adj_meta?kind=eq.{q}&select=*")
    return rows[0] if rows else None


def count_gen(key, table, gen):
    _, hdrs, _ = sb_request(key, "GET", f"/rest/v1/{table}?select=sku&gen=eq.{gen}",
                            headers={"Prefer": "count=exact", "Range-Unit": "items", "Range": "0-0"})
    cr = hdrs.get("Content-Range") or ""
    tail = cr.rsplit("/", 1)[-1]
    if not tail.isdigit():
        raise SbError(f"อ่านจำนวนแถวไม่ได้ (Content-Range: '{cr}')")
    return int(tail)


def insert_rows(key, table, gen, rows):
    for i in range(0, len(rows), CHUNK):
        chunk = [dict(r, gen=gen) for r in rows[i:i + CHUNK]]
        sb_request(key, "POST", f"/rest/v1/{table}", body=chunk,
                   headers={"Prefer": "return=minimal"}, timeout=180)
        log(f"   เขียน {min(i + CHUNK, len(rows)):,}/{len(rows):,} แถว")


def delete_gen(key, table, gen):
    sb_request(key, "DELETE", f"/rest/v1/{table}?gen=eq.{gen}", headers={"Prefer": "return=minimal"}, timeout=180)


def delete_other_gens(key, table, keep):
    keep = [str(g) for g in keep if g is not None]
    flt = f"gen=not.in.({','.join(keep)})"
    sb_request(key, "DELETE", f"/rest/v1/{table}?{flt}", headers={"Prefer": "return=minimal"}, timeout=180)


def upsert_meta(key, doc):
    sb_request(key, "POST", "/rest/v1/adj_meta?on_conflict=kind", body=doc,
               headers={"Prefer": "resolution=merge-duplicates,return=minimal"})


def patch_meta(key, kind, fields):
    q = urllib.parse.quote(kind)
    sb_request(key, "PATCH", f"/rest/v1/adj_meta?kind=eq.{q}", body=fields, headers={"Prefer": "return=minimal"})


def _utc_iso(ts=None):
    d = datetime.fromtimestamp(ts, tz=timezone.utc) if ts is not None else datetime.now(timezone.utc)
    return d.strftime("%Y-%m-%dT%H:%M:%S.%fZ")


# ============================================================


def run_kind(kind, opts, folder, key):
    """ทำไฟล์เดียว — คืน exit code ของไฟล์นั้น (0 · 1 · 2 · 4)"""
    cfg = KINDS[kind]
    log("")
    log(f"── {cfg['label']} → {cfg['table']} ──────────────────────")

    path = find_latest_file(folder, cfg["glob"])
    if not path:
        log(f"❌ ไม่พบไฟล์ตรงรูปแบบ '{cfg['glob']}' (ไฟล์ชื่อมี '{PART_MARKER}' ถูกข้ามโดยตั้งใจ)")
        return 2

    mtime_ts = os.path.getmtime(path)
    mtime = datetime.fromtimestamp(mtime_ts)
    name = os.path.basename(path)
    log(f"ไฟล์ล่าสุด: {name}  (แก้ไขล่าสุด {mtime:%Y-%m-%d %H:%M})")

    # เตือนเมื่อชื่อไฟล์ราคาขึ้นต้นด้วย R05 — auto-r05 (ห้ามแก้) ค้นด้วย "R05*.CSV" แล้วหยิบไฟล์ใหม่สุด
    # จึงจะหยิบไฟล์นี้ไปอ่านในวันที่มันใหม่กว่า R05.106 แล้วหยุดทำงานวันนั้นแบบเงียบ (ตกด่านหัวคอลัมน์)
    if kind == "r05_105" and name.upper().startswith("R05"):
        log(f"⚠️ ชื่อไฟล์ '{name}' ขึ้นต้นด้วย R05 ⇒ auto-r05 (ตารางบาร์โค้ด) มองเห็นไฟล์นี้ด้วย")
        log("   ให้ตัว export เติมคำนำหน้า เช่น 'ADJ_R05.105.CSV' ไม่งั้นวันที่ไฟล์นี้ใหม่กว่า R05.106")
        log("   auto-r05 จะหยิบไฟล์นี้ไปอ่านแล้วไม่อัปตารางบาร์โค้ดวันนั้น (ตัวนี้ยังทำงานต่อตามปกติ)")

    # guard 1: ไฟล์ไม่ใช่ของวันนี้ = บอท export ยังไม่ได้รัน / รันไม่สำเร็จ
    if mtime.date() != datetime.now().date():
        if not opts["force"]:
            log("❌ ไฟล์ไม่ได้ถูกแก้ไขวันนี้ — ไม่เขียน. ใช้ --force ถ้าตั้งใจอัปไฟล์นี้")
            log("   สาเหตุที่พบบ่อย: Task ที่ export ไฟล์นี้จาก ProMaxx ไม่ได้รัน หรือ Task ตัวนี้ตั้งเวลาเร็วกว่าที่ export เสร็จ")
            return 4
        log("⚠️ ไฟล์ไม่ได้ถูกแก้ไขวันนี้ แต่มี --force — ดำเนินการต่อ")

    if not wait_for_stable_file(path):
        log("❌ ไฟล์ยังถูกเขียนอยู่ (ขนาดเปลี่ยนตลอด) — ไม่เขียน")
        return 4
    mtime_ts = os.path.getmtime(path)

    rows = read_rows(path)

    # guard 2: หัวคอลัมน์ต้องอยู่ตำแหน่งเดิม — เว็บอ่านด้วยเลขคอลัมน์ตายตัว ไม่ได้อ่านตามชื่อ
    # ⛔ ห้ามเพิ่ม flag ข้ามด่านนี้ (บทเรียนเดียวกับ auto-r05)
    probs = header_problems(rows, cfg["headers"])
    if probs:
        log("❌ หัวคอลัมน์ไม่ตรงกับที่ป็อปอัพปรับปรุงสินค้าอ่าน:")
        for p in probs:
            log(f"   · {p}")
        head = rows[0] if rows else []
        log("   หัวคอลัมน์จริง: " + " | ".join(f"{i}:{js_trim(h)}" for i, h in enumerate(head[:16])))
        log("   ถ้าเป็นไฟล์ถูกตัวแต่ตำแหน่งต่าง ต้องแก้ทั้ง index.html และสคริปต์นี้พร้อมกัน แล้วรัน check-adj-parity")
        return 4

    out = PARSERS[kind](rows)
    skus = len({r["sku"] for r in out})
    log(f"อ่านได้ {len(out):,} แถว · {skus:,} SKU · จากแถวข้อมูลในไฟล์ {max(0, len(rows) - 1):,}")
    if kind == "r05_105":
        priced = sum(1 for r in out if r["price"] is not None)
        log(f"   มีราคา {priced:,} / {len(out):,}")
    for r in out[:3]:
        log(f"   ตัวอย่าง: {json.dumps(r, ensure_ascii=False)}")

    # guard 3: แถวน้อยผิดปกติ
    if len(out) < cfg["min_rows"]:
        log(f"❌ ได้แค่ {len(out):,} แถว น้อยกว่าขั้นต่ำ {cfg['min_rows']:,} — ไฟล์ export น่าจะไม่ครบ. ไม่เขียน")
        return 4

    digest = content_hash(out)

    if not key:
        if opts["dry_run"]:
            log("⚠️ ไม่มี service key — ข้ามการเทียบกับของบน Supabase (dry-run ตรวจไฟล์อย่างเดียว)")
            log("DRY-RUN จบ — ยังไม่เขียนอะไรทั้งสิ้น")
            return 0
        log("❌ ไม่พบ SUPABASE_SERVICE_KEY (env หรือ .env ข้างสคริปต์) — เขียนไม่ได้")
        return 1

    try:
        meta = read_meta(key, kind)
    except SbError as e:
        log(f"❌ อ่าน adj_meta ไม่ได้: {e}")
        return 1

    old_gen = meta.get("active_gen") if meta else None
    if not meta or old_gen is None:
        log("⚠️ ยังไม่มีชุดข้อมูลบน Supabase — ข้าม guard เทียบกับของเดิม (แถวหด)")
    else:
        log(f"บน Supabase ตอนนี้: {meta.get('row_count') or 0:,} แถว · gen {old_gen} · "
            f"อัปเดต {meta.get('uploaded_at') or '-'} · ตรวจล่าสุด {meta.get('checked_at') or '-'}")

        # guard 4: เนื้อหาเหมือนเดิม = ไม่ต้องเขียน อัปเดตแค่เวลาตรวจ (การ์ดในเว็บจะรู้ว่าบอทรันวันนี้แล้ว)
        if meta.get("content_hash") == digest:
            if opts["dry_run"]:
                log("✅ [DRY] เนื้อหาเหมือนเดิม — รอบจริงจะอัปเดตแค่ checked_at")
                return 0
            try:
                patch_meta(key, kind, {"checked_at": _utc_iso()})
            except SbError as e:
                log(f"⚠️ อัปเดต checked_at ไม่สำเร็จ (ข้อมูลไม่เสียหาย): {e}")
                return 1
            log(f"✅ เนื้อหาเหมือนเดิม ({len(out):,} แถว) — ไม่เขียนข้อมูล อัปเดตแค่เวลาตรวจ")
            return 0

        # guard 5: แถวหดเกิน 20% = export ไม่ครบมาทับของครบ
        old_n = int(meta.get("row_count") or 0)
        if old_n > 0:
            shrink = (old_n - len(out)) / old_n
            if shrink > MAX_SHRINK_RATIO:
                if not opts["allow_shrink"]:
                    log(f"❌ แถวหดจาก {old_n:,} เหลือ {len(out):,} ({shrink * 100:.1f}%) "
                        f"เกินเพดาน {MAX_SHRINK_RATIO * 100:.0f}% — ไม่เขียน")
                    log("   ถ้าเป็นการตัดข้อมูลออกจริง รันซ้ำด้วย --allow-shrink")
                    return 4
                log(f"⚠️ แถวหด {shrink * 100:.1f}% แต่มี --allow-shrink — ดำเนินการต่อ")
        log(f"เนื้อหาเปลี่ยน — {old_n:,} → {len(out):,} แถว ({len(out) - old_n:+,})")

    payload_kb = len(json.dumps(out, ensure_ascii=False).encode("utf-8")) / 1024
    if opts["dry_run"]:
        log(f"[DRY] จะเขียน {len(out):,} แถว (~{payload_kb:,.0f} KB) ลง {cfg['table']} แล้วสลับ active_gen (ยังไม่เขียน)")
        log("DRY-RUN จบ — ยังไม่เขียนอะไรทั้งสิ้น")
        return 0

    gen = int(time.time() * 1000)
    log(f"เริ่มเขียนชุดใหม่ gen {gen} (~{payload_kb:,.0f} KB) — ผู้ใช้ยังไม่เห็นจนกว่าจะสลับ active_gen")
    try:
        insert_rows(key, cfg["table"], gen, out)
        got = count_gen(key, cfg["table"], gen)
        if got != len(out):
            raise SbError(f"นับกลับได้ {got:,} แถว ไม่เท่าที่ส่ง {len(out):,}")
    except SbError as e:
        log(f"❌ เขียนชุดใหม่ไม่สำเร็จ: {e}")
        log("   ชุดที่ใช้งานอยู่ไม่ถูกแตะ — ผู้ใช้ยังเห็นข้อมูลเดิมครบ")
        try:
            delete_gen(key, cfg["table"], gen)
            log(f"   ลบแถวของ gen {gen} ที่ค้างทิ้งแล้ว")
        except SbError as e2:
            log(f"   ⚠️ ลบแถวค้างไม่สำเร็จ (ไม่มีผลกับผู้ใช้ รอบถัดไปจะเก็บกวาดเอง): {e2}")
        return 1

    now = _utc_iso()
    try:
        # จุดเผยแพร่จุดเดียว — สลับตัวชี้แล้วทุกเครื่องที่เปิดป็อปอัพครั้งถัดไปเห็นชุดใหม่
        upsert_meta(key, {
            "kind": kind, "active_gen": gen, "prev_gen": old_gen,
            "row_count": len(out), "sku_count": skus, "content_hash": digest,
            "source_file": os.path.basename(path), "source_mtime": _utc_iso(mtime_ts),
            "uploaded_at": now, "checked_at": now,
        })
    except SbError as e:
        log(f"❌ สลับ active_gen ไม่สำเร็จ: {e}")
        try:
            delete_gen(key, cfg["table"], gen)
        except SbError:
            pass
        return 1
    log(f"✅ สลับ active_gen → {gen} แล้ว ({len(out):,} แถว · {skus:,} SKU)")

    # เก็บกวาดชุดเก่า — เก็บชุดก่อนหน้าไว้หนึ่งชุดสำหรับย้อนกลับ · ล้มได้ไม่ถือเป็นความผิดพลาด
    # เพราะเว็บกรองด้วย active_gen อยู่แล้ว แถวเก่าที่ค้างไม่มีใครเห็น
    try:
        delete_other_gens(key, cfg["table"], [gen, old_gen])
    except SbError as e:
        log(f"⚠️ ลบชุดเก่าไม่สำเร็จ (ไม่มีผลกับผู้ใช้ รอบถัดไปจะลองใหม่): {e}")
    return 0


def main():
    opts, err = parse_args(sys.argv[1:])
    if err:
        log(f"❌ {err} — หยุด ไม่เดินต่อ (flag ที่รู้จัก: {', '.join(sorted(KNOWN_FLAGS))})")
        sys.exit(2)

    folder, folder_src = resolve_watch_folder(opts["folder"])
    key, key_src = get_service_key()
    kinds = [opts["only"]] if opts["only"] else list(KINDS)

    log(f"เริ่มงาน auto-adj  (dry_run={opts['dry_run']}, force={opts['force']}, "
        f"allow_shrink={opts['allow_shrink']}, ไฟล์={','.join(kinds)})")
    log(f"เครื่อง: {os.environ.get('COMPUTERNAME', '?')} · ผู้ใช้: {os.environ.get('USERNAME', '?')}")
    log(f"โฟลเดอร์: {folder}   [จาก {folder_src}]")
    log(f"ปลายทาง: {SUPABASE_URL}  · key: {key_src or '(ไม่พบ)'}")

    # ตรวจคีย์ก่อนเริ่มอ่านไฟล์ — ไฟล์ R14 ใหญ่ 44 MB ไม่ต้องเสียเวลา parse ถ้าเขียนไม่ได้อยู่แล้ว
    if key:
        bad = key_problem(key)
        if bad:
            log(f"❌ service key ใช้ไม่ได้: {bad}   [จาก {key_src}]")
            log("   ต้องเป็นค่า service_role จริงจาก Supabase Dashboard → Settings → API")
            log('   หรือก๊อปบรรทัด SUPABASE_SERVICE_KEY จาก .env ของบอทตัวอื่นบนเครื่องเดียวกัน')
            sys.exit(1)

    if not os.path.isdir(folder):
        log("❌ ไม่มีโฟลเดอร์นี้ในเครื่อง — ยกเลิก")
        log('   ตั้งค่าแล้วรันใหม่:  setx AUTO_ADJ_WATCH_FOLDER "D:\\path\\to\\run-upload-stock"   (แล้วเปิด CMD ใหม่)')
        sys.exit(2)

    codes = {}
    for kind in kinds:
        try:
            codes[kind] = run_kind(kind, opts, folder, key)
        except Exception as e:                       # ไฟล์หนึ่งพัง อีกไฟล์ต้องยังทำงาน
            log(f"❌ {KINDS[kind]['label']} ล้มโดยไม่คาดคิด: {e!r}")
            codes[kind] = 1

    log("")
    log("สรุป: " + " · ".join(f"{KINDS[k]['label']} = exit {c}" for k, c in codes.items()))
    # ความรุนแรง: เขียนไม่ผ่าน > ด่านไม่ผ่าน > ไม่พบไฟล์ > สำเร็จ
    for c in (1, 4, 2):
        if c in codes.values():
            sys.exit(c)
    sys.exit(0)


if __name__ == "__main__":
    main()
