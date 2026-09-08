#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Auto R01.102 importer  ->  Firestore  (Stock Count)

อ่านไฟล์ R01.102 (CSV) ที่ใหม่ที่สุดในโฟลเดอร์ที่กำหนด แล้วแยกตาม Col D (CF_WNAME)
เป็น 4 branch (WH / SRC / KKL / SSS) เขียนเข้า Firestore:
    stock_sessions/<BRANCH>_r01

รูปแบบข้อมูลตรงกับที่ index.html (loadR01 + syncMasterToFirestore) ใช้ทุกประการ
ใช้ Python stdlib ล้วน — ไม่ต้องลง pip อะไรเพิ่ม

⚠️ ต้องแยกไฟล์ตาม Col D ก่อนเขียนเสมอ — SKU เดียวกันมีอยู่หลาย branch ในไฟล์เดียว
   ถ้าอัปทั้งไฟล์ผ่านหน้าเว็บ qtyMap.set() ใน _rebuildCountableSkus() เป็น last-wins
   ทุกสาขาจะได้ยอดของ branch ที่อยู่ท้ายไฟล์

วิธีรัน:
    python auto_r01_import.py            # โหมดจริง — เขียนขึ้น Firestore
    python auto_r01_import.py --dry-run  # ทดสอบ — แค่พิมพ์ยอดต่อ branch ไม่เขียน
    python auto_r01_import.py --force    # ข้าม guard "ไฟล์ไม่ใช่ของวันนี้" (ใช้ตอนทดสอบเท่านั้น)

    python auto_r01_import.py --resync-nc         # งานครั้งเดียวหลังแก้กติกาหมวด: ดูอย่างเดียว (dry-run)
    python auto_r01_import.py --resync-nc --yes    # เขียนธง nc ใหม่ลง data_json (ไม่แตะ version/baseline/r16)
    python auto_r01_import.py --resync-nc --yes --branch SRC   # ทีละสาขา

ตั้งเวลา 8:10 ทุกวันด้วย Windows Task Scheduler (ดู README.md)
"""

import sys
import os
import csv
import io
import json
import glob
import urllib.request
import urllib.error
import urllib.parse
from collections import defaultdict
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

# โฟลเดอร์ที่ไฟล์ R01.102 ถูก export มาวาง — หาตามลำดับนี้:
#   1. อาร์กิวเมนต์ --folder "<path>"        (ใช้ตอนทดสอบ)
#   2. ตัวแปรระบบ AUTO_R01_WATCH_FOLDER      (ใช้เมื่อ path ไม่ตรงแบบมาตรฐาน หรือ Task รันด้วย account อื่น)
#   3. <โฟลเดอร์ผู้ใช้ปัจจุบัน>\Desktop\run-upload-stock   ← ค่าปกติ
#
# ข้อ 3 ทำให้ไฟล์เดียวใช้ได้ทุกเครื่องโดยไม่ต้องแก้โค้ด เพราะทุกเครื่องวางไฟล์ที่ Desktop\run-upload-stock
# เหมือนกัน ต่างกันแค่ชื่อผู้ใช้ (BigYa-spare / AninMainPC / ...) — เดิมฮาร์ดโค้ดชื่อผู้ใช้ไว้
# ⚠️ ถ้าตั้ง Task Scheduler แบบ "Run whether user is logged on or not" ด้วย account อื่น (เช่น SYSTEM)
#    ข้อ 3 จะชี้ไปโฟลเดอร์ผิด — กรณีนั้นให้ตั้ง AUTO_R01_WATCH_FOLDER แบบ system-wide
DEFAULT_WATCH_FOLDER = os.path.join(os.path.expanduser("~"), "Desktop", "run-upload-stock")


def resolve_watch_folder(argv):
    for i, a in enumerate(argv):
        if a == "--folder" and i + 1 < len(argv):
            return argv[i + 1], "--folder"
        if a.startswith("--folder="):
            return a.split("=", 1)[1], "--folder"
    env = os.environ.get("AUTO_R01_WATCH_FOLDER", "").strip()
    if env:
        return env, "AUTO_R01_WATCH_FOLDER"
    return DEFAULT_WATCH_FOLDER, "ค่าปกติ (โฟลเดอร์ผู้ใช้ปัจจุบัน)"


WATCH_FOLDER, WATCH_FOLDER_SOURCE = resolve_watch_folder(sys.argv)

# รูปแบบชื่อไฟล์ที่จะมองหา (เลือกไฟล์ที่ใหม่ที่สุด)
FILE_GLOB = "Allstock*.csv"

# Firebase project (จาก index.html FIREBASE_CONFIG)
PROJECT_ID = "stock-count-1d6e7"
API_KEY    = "AIzaSyDba_44vuyh-DyXeSYUoppm925oFCfr010"

# Col D (index 3, CF_WNAME) -> รหัส branch.  เทียบแบบ lower-case + ตัดช่องว่างซ้ำ
BRANCH_MAP = {
    "warehouse":   "WH",
    "front store": "SRC",
    "main kkl":    "KKL",
    "main sss":    "SSS",
}

# branch ที่จะเขียนจริง — ปิด branch ไหนก็เอาออกจาก set นี้ที่เดียว (ไม่ต้องแตะโค้ดอื่น)
# ⚠️ ถอด "WH" ออกถ้าการอัป R01 ทุกเช้ารบกวนรอบนับคลัง (R16 ของ WH จะถูก invalidate ทุกครั้ง)
AUTO_BRANCHES = {"WH", "SRC", "KKL", "SSS"}

# guard: branch ที่มีแถวน้อยกว่านี้ = ไฟล์ผิดปกติ (ของจริงต่ำสุดคือ SSS ~3,100 แถว)
MIN_ROWS_PER_BRANCH = 500

# guard: doc ใหญ่เกินนี้ (KB) ไม่เขียน — Firestore ปฏิเสธที่ 1 MiB
MAX_DOC_KB = 950

# index คอลัมน์ (ตรงกับ loadR01 ใน index.html)
COL_BRANCH = 3   # D  CF_WNAME
COL_SKU    = 4   # E  CF_ITEMID
COL_NAME   = 5   # F  CF_ITEMNAME
COL_QTY    = 6   # G  CF_QUANTITY
COL_CAT    = 15  # P  CF_ITEMGROUPL1_GROUPNAME

# ต้องตรงกับ R01_NON_COUNT_PREFIXES / R01_NON_COUNT_KEYWORDS ใน index.html เป๊ะ
# เพิ่มหมวดใหม่ต้องแก้ "ทั้ง 3 ที่" พร้อมกัน ไม่งั้นอัพมือกับอัพออโต้ให้ผลต่างกัน:
#   index.html · ไฟล์นี้ · tools/list-r01-categories.js (ตัวสำรวจหมวด อ่านอย่างเดียว)
# ⚠️ ก่อนเพิ่ม/ลดหมวด ให้รัน tools/list-r01-categories.js ดูค่าจริงในไฟล์ก่อนเสมอ
#    (เคยมีโน้ตในเอกสารเขียนผิดว่าหมวด "11. อุปกรณ์สำนักงาน..." ไม่มีเลขนำหน้า เกือบทำให้แก้เกินจำเป็น)
#
# ธง nc มี 2 ชนิด (ก.ย. 2026) — เก็บเป็นตัวเลข ไม่เก็บข้อความหมวด เพราะ {branch}_r01 มีเพดาน 1 MiB:
#   nc=1  ตัดเด็ดขาด          หมวด "11." ไม่ใช่สินค้าคงคลัง · ยอดเท่าไรหรือจัดชั้นอะไรก็ไม่นับ
#   nc=2  นับเฉพาะเมื่อมีของ   หมวด "DELETE" · ต้องยอดไม่เท่ากับ 0 · ชั้น A/B/C/REVIEW ดึงเข้าไม่ได้
R01_NON_COUNT_PREFIXES = ("11.",)
# ⚠️ ว่างโดยเจตนา ห้ามลบตัวแปร — "DELETE" ย้ายไป R01_STOCK_ONLY_KEYWORDS แล้ว ห้ามเติมกลับมาที่นี่
R01_NON_COUNT_KEYWORDS = ()
# ⛔ "DELETE" = "นับเฉพาะเมื่อมีของ" ไม่ใช่ "ตัดทิ้ง" (ก.ย. 2026 · ผู้ใช้ยืนยัน)
#    ของจริง 745 รายการหมวดนี้ยังมียอดคงเหลือและมีบาร์โค้ดใน R05 ครบทุกตัว = ของบนชั้นที่ต้องเดินไปนับ
#    ส่วนที่ยอดเป็น 0 (~6,100 รายการ) ต้องไม่โผล่เป็นงาน **แม้จะถูกจัดชั้น A/B/C/REVIEW ไว้ใน PBM ก็ตาม**
#    ธง nc ที่ค้างบน cloud จากรุ่นก่อนหน้า sync ให้ตรงกติกาปัจจุบันด้วย --resync-nc (ดู README §--resync-nc)
R01_STOCK_ONLY_KEYWORDS = ("DELETE",)

# field ทั้งหมดที่เขียน — ใช้เป็น updateMask ด้วย
# ⚠️ ห้ามเขียนแบบไม่มี updateMask: PATCH จะ replace ทั้ง document แล้วลบ field ที่เว็บเขียนไว้ทิ้ง
WRITE_FIELDS = [
    "data_json", "r01UploadedAt", "r01Version", "r01BaselineAt",
    "r16Loaded", "r16UploadedAt", "r16DetailVersion",
    "r16_103Loaded", "r16_103UploadedAt", "r16_103DetailVersion",
    "updated_at",
]

# ============================================================


def log(msg):
    print(f"[{datetime.now():%Y-%m-%d %H:%M:%S}] {msg}", flush=True)


def find_latest_file():
    pattern = os.path.join(WATCH_FOLDER, FILE_GLOB)
    files = glob.glob(pattern)
    # glob บน Windows ไม่ case-sensitive อยู่แล้ว แต่กันไว้
    if not files:
        files = glob.glob(os.path.join(WATCH_FOLDER, FILE_GLOB.upper()))
    if not files:
        return None
    files.sort(key=os.path.getmtime, reverse=True)
    return files[0]


def decode_bytes(raw):
    """เลียนแบบ parseFile: UTF-8 BOM -> UTF-8 -> Windows-874 (cp874)"""
    for enc in ("utf-8-sig", "utf-8", "cp874"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    # สุดท้ายยอมแทนตัวที่ decode ไม่ได้ เพื่อไม่ให้ล้มทั้งงาน
    return raw.decode("cp874", errors="replace")


def sniff_delimiter(sample):
    """เดา delimiter จากบรรทัดแรก — POS CSV ส่วนใหญ่เป็น comma"""
    first = sample.splitlines()[0] if sample else ""
    counts = {",": first.count(","), ";": first.count(";"), "\t": first.count("\t")}
    return max(counts, key=counts.get) or ","


def norm(s):
    return " ".join(str(s).strip().lower().split())


def parse_qty(g):
    """ตรงกับ loadR01: strip comma+ช่องว่าง แล้ว Number() — ว่าง/ไม่ใช่ตัวเลข = None (ข้ามแถว)

    ⛔ ห้ามใส่ `qty <= 0 -> ข้าม` กลับมา
    SKILL-data-files.md: qty ≤ 0 (ติดลบ/0) เก็บไว้ด้วยค่าจริง ไม่ clamp
    - G = 0  ยังต้องนับถ้า PBM Col D ∈ {A,B,C,REVIEW}
    - G < 0  (negSys) คือ "ขายของขาด" ต้องบังคับให้เภสัชตรวจทุกตัว
    ทิ้งไปแล้ว = ของที่ต้องเดินไปนับหายเกือบครึ่งสาขา
    """
    g = "".join(str(g).split()).replace(",", "")
    if g == "":
        return None
    try:
        v = float(g)
    except ValueError:
        return None
    if v != v or v in (float("inf"), float("-inf")):   # NaN / Infinity -> เหมือน !isFinite()
        return None
    return int(v) if v == int(v) else v


def is_non_count_category(col_p):
    """ตรงกับ _isNonCountR01Category() ใน index.html"""
    v = str(col_p or "").strip().upper()
    if not v:
        return False
    return v.startswith(R01_NON_COUNT_PREFIXES) or any(k in v for k in R01_NON_COUNT_KEYWORDS)


def is_stock_only_category(col_p):
    """ตรงกับ _isStockOnlyR01Category() ใน index.html — หมวดที่ "ต้องมีของถึงนับ" """
    v = str(col_p or "").strip().upper()
    if not v:
        return False
    return any(k in v for k in R01_STOCK_ONLY_KEYWORDS)


def parse_file(path):
    with open(path, "rb") as f:
        raw = f.read()
    text = decode_bytes(raw)
    delim = sniff_delimiter(text)
    rows = list(csv.reader(io.StringIO(text), delimiter=delim))

    branches = defaultdict(list)
    nc_counts = defaultdict(int)
    so_counts = defaultdict(int)
    skipped_no_sku = 0
    skipped_qty = 0
    unknown_branch = defaultdict(int)

    # ข้าม header แถวแรก (เหมือน loadR01 ที่เริ่ม i=1)
    for r in rows[1:]:
        if not r or len(r) <= COL_QTY:
            continue
        sku = str(r[COL_SKU]).strip()
        if not sku:
            skipped_no_sku += 1
            continue
        qty = parse_qty(r[COL_QTY])
        if qty is None:
            skipped_qty += 1
            continue

        d = norm(r[COL_BRANCH])
        branch = BRANCH_MAP.get(d)
        if branch is None:
            unknown_branch[str(r[COL_BRANCH]).strip()] += 1
            continue
        if branch not in AUTO_BRANCHES:
            continue

        item = {"colE": sku, "productName": str(r[COL_NAME]).strip(), "systemQty": qty}
        col_p = r[COL_CAT] if len(r) > COL_CAT else ""
        # ลำดับเช็คต้องเหมือน index.html: ตัดเด็ดขาดมาก่อน แล้วค่อย "ต้องมีของถึงนับ"
        if is_non_count_category(col_p):
            item["nc"] = 1
            nc_counts[branch] += 1
        elif is_stock_only_category(col_p):
            item["nc"] = 2
            so_counts[branch] += 1
        branches[branch].append(item)

    return branches, {
        "nc_counts": nc_counts,
        "so_counts": so_counts,
        "skipped_no_sku": skipped_no_sku,
        "skipped_qty": skipped_qty,
        "unknown_branch": dict(unknown_branch),
        "delimiter": repr(delim),
        "total_rows": max(0, len(rows) - 1),
    }


def thai_ts(dt):
    """ตรงกับ formatThaiDateTime ใน index.html:  HH:MM น. DD/MM/YYYY"""
    return f"{dt:%H:%M} น. {dt:%d/%m/%Y}"


def iso_utc_ms():
    """ต้องเทียบ lexicographic กับที่ new Date().toISOString() ผลิตได้ (มิลลิวินาที + Z)"""
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def build_payload(items, version_iso, uploaded_at):
    """field ที่เขียนและเหตุผล — ดู README.md §สิ่งที่สคริปต์เขียน

    r01Version    : _branchConfirmVersions() ใช้ตรวจก่อน Confirm · WH _applyWhR01Doc ใช้ตัดสินว่าจะ adopt ไหม
    r01BaselineAt : trigger ให้ listener ของสาขายาเรียก _applyR01BaselineUpdate()
                    (ห้ามแตะ session doc — r01BaselineAt เดิมฝังรวมกับ scanData ใน blob v1 เสี่ยงทับยอดสแกน)
    r16* = ล้าง    : ตรงกับที่ syncR16MetaToFirestore() เขียนตอนอัพ R01 ด้วยมือ
                    R01 ใหม่ = ยอดระบบรวมยอดขายเมื่อวานแล้ว บวก R16 เก่าซ้ำ = ผิด → บล็อก Confirm จนอัป R16 ชุดใหม่
    """
    data_json = json.dumps(items, ensure_ascii=False)
    return data_json, {
        "fields": {
            "data_json":            {"stringValue": data_json},
            "r01UploadedAt":        {"stringValue": uploaded_at},
            "r01Version":           {"stringValue": version_iso},
            "r01BaselineAt":        {"stringValue": version_iso},
            "r16Loaded":            {"booleanValue": False},
            "r16UploadedAt":        {"stringValue": ""},
            "r16DetailVersion":     {"stringValue": ""},
            "r16_103Loaded":        {"booleanValue": False},
            "r16_103UploadedAt":    {"stringValue": ""},
            "r16_103DetailVersion": {"stringValue": ""},
            "updated_at":           {"timestampValue": datetime.now(timezone.utc)
                                     .strftime("%Y-%m-%dT%H:%M:%S.%fZ")},
        }
    }


def write_branch(branch, items, version_iso, uploaded_at, dry_run):
    data_json, body = build_payload(items, version_iso, uploaded_at)
    size_kb = len(data_json.encode("utf-8")) / 1024
    nc = "1:%d 2:%d" % (sum(1 for x in items if x.get("nc") == 1), sum(1 for x in items if x.get("nc") == 2))

    if size_kb > MAX_DOC_KB:
        log(f"  ❌ {branch}_r01: {size_kb:.0f} KB เกิน {MAX_DOC_KB} KB (เพดาน Firestore 1 MiB) — ไม่เขียน")
        log(f"     แก้ด้วยการเปลี่ยน data_json เป็น array-of-arrays แบบ R05 (ดู _serializeR05 ใน index.html)")
        return False

    if dry_run:
        log(f"  [DRY] {branch}_r01: {len(items)} รายการ · nc {nc} · {size_kb:.0f} KB — ไม่เขียน")
        return True

    mask = "&".join(f"updateMask.fieldPaths={urllib.parse.quote(f)}" for f in WRITE_FIELDS)
    url = (
        f"https://firestore.googleapis.com/v1/projects/{PROJECT_ID}"
        f"/databases/(default)/documents/stock_sessions/{branch}_r01?{mask}&key={API_KEY}"
    )
    req = urllib.request.Request(url, data=json.dumps(body).encode("utf-8"), method="PATCH",
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            resp.read()
        log(f"  ✅ {branch}_r01: {len(items)} รายการ · nc {nc} · {size_kb:.0f} KB · r01Version={version_iso}")
        return True
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")
        log(f"  ❌ {branch}_r01: HTTP {e.code} — {detail[:400]}")
        return False
    except Exception as e:
        log(f"  ❌ {branch}_r01: {e}")
        return False


# ============================================================
#  --resync-nc : เขียนธง nc บน cloud ให้ตรงกติกาปัจจุบัน (งานครั้งเดียวหลังแก้กติกาหมวด)
# ============================================================
#
# ทำไมต้องมี: ธง nc ถูกตัดสิน "ตอน parse" แล้วตรึงลง {branch}_r01.data_json
# แก้ R01_NON_COUNT_* อย่างเดียวจึงไม่มีผลกับข้อมูลที่ค้างบน cloud จนกว่าบอทจะรันรอบถัดไป
# โหมดนี้เขียนธงใหม่ให้ตรงกติกาโดย **ไม่แตะอะไรอย่างอื่นเลย**:
#   เขียนเฉพาะ data_json · ไม่แตะ r01Version / r01BaselineAt / r01UploadedAt / r16* / updated_at
#   ⇒ ไม่ trigger _applyR01BaselineUpdate() (ไม่ล้าง R16 · ไม่ freeze audit) · ไม่ invalidate R16 ของ WH
#   ⇒ Confirm ที่กำลังรันอยู่ไม่ abort (_branchConfirmVersions เทียบแค่ r01Version/r16Version)
#
# ⚠️ เครื่องที่เปิดค้างอยู่จะยังไม่เห็นจนกว่าจะ reload — ไม่มี listener path ไหนโหลด data_json ใหม่
#    ถ้า r01Version/r01BaselineAt ไม่ขยับ (index.html: _applyWhR01Doc, startWhMasterListeners)
#    วิธีใช้จริง: รันโหมดนี้ก่อน แล้วค่อย deploy เว็บ — auto-refresh จะ reload ให้ทุกเครื่องเอง

BACKUP_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "backup")


def _rest_doc_url(doc_id, query=""):
    return (f"https://firestore.googleapis.com/v1/projects/{PROJECT_ID}"
            f"/databases/(default)/documents/stock_sessions/{doc_id}?{query}key={API_KEY}")


def _rest_get_data_json(doc_id):
    """อ่าน field data_json ของ doc เดียว — คืน None ถ้าไม่มี doc, '' ถ้ามี doc แต่ไม่มี field"""
    url = _rest_doc_url(doc_id, "mask.fieldPaths=data_json&")
    try:
        with urllib.request.urlopen(url, timeout=120) as resp:
            doc = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None
        raise
    return ((doc.get("fields") or {}).get("data_json") or {}).get("stringValue", "")


def _row_identity_diff(cloud_rows, items):
    """guard ที่สำคัญที่สุดของโหมดนี้ — ยืนยันว่าไฟล์ที่ใช้คือ "ไฟล์เดียวกับที่บอทเขียนขึ้นไป"

    เทียบทุก field ยกเว้น nc · ต่างแม้แถวเดียว = ยกเลิกสาขานั้นทั้งสาขา
    ถ้าไม่มี guard นี้แล้วเผลอรันด้วยไฟล์คนละวัน systemQty จะถูกเขียนทับด้วยยอดคนละรอบ
    ⛔ ห้ามเพิ่ม flag ให้ข้าม guard นี้เด็ดขาด
    """
    if len(cloud_rows) != len(items):
        return f"จำนวนแถวต่างกัน — cloud {len(cloud_rows)} · ไฟล์ {len(items)}"
    for i, (c, n) in enumerate(zip(cloud_rows, items)):
        for f in ("colE", "productName", "systemQty"):
            if c.get(f) != n.get(f):
                return (f"แถวที่ {i + 1} field '{f}' ต่างกัน — cloud={c.get(f)!r} · ไฟล์={n.get(f)!r} "
                        f"(SKU cloud={c.get('colE')!r} / ไฟล์={n.get('colE')!r})")
    return None


def _cat_skus_from_pm(branch):
    """SKU ที่มี field cat ใน {branch}_pm = PBM Col D ∈ {A,B,C,REVIEW} (ตัวที่นับแม้ยอดเป็น 0)"""
    raw = _rest_get_data_json(f"{branch}_pm")
    if not raw:
        return set(), False
    try:
        return {r.get("sku") for r in json.loads(raw) if r.get("cat")}, True
    except Exception:
        return set(), False


def _nc_flags(items):
    """SKU -> ชนิดธงที่เข้มที่สุด (1 ชนะ 2) — sticky เหมือน _rebuildCountableSkus() ใน index.html"""
    flags = {}
    for it in items:
        if it.get("nc"):
            sku = it.get("colE")
            cur = flags.get(sku)
            flags[sku] = min(cur, int(it["nc"])) if cur else int(it["nc"])
    return flags


def _countable_count(items, cat_skus):
    """จำลอง _rebuildCountableSkus() ใน index.html เป๊ะ — ใช้ประเมิน Total SKU ก่อน/หลัง

    nc=1 ตัดเด็ดขาด · nc=2 ตัดสินด้วยยอดอย่างเดียว (ชั้น A/B/C/REVIEW ดึงของยอด 0 เข้าไม่ได้)
    """
    flags = _nc_flags(items)
    qty = {}
    for it in items:
        qty[it.get("colE")] = it.get("systemQty", 0)   # last-wins เหมือน qtyMap.set()
    n = 0
    for sku, q in qty.items():
        flag = flags.get(sku, 0)
        if flag == 1:
            continue
        if q != 0 or (flag != 2 and sku in cat_skus):
            n += 1
    return n


def _patch_data_json(doc_id, data_json):
    body = {"fields": {"data_json": {"stringValue": data_json}}}
    url = _rest_doc_url(doc_id, "updateMask.fieldPaths=data_json&")
    req = urllib.request.Request(url, data=json.dumps(body).encode("utf-8"), method="PATCH",
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=120) as resp:
        resp.read()


def resync_nc(branches, apply_writes, only_branch):
    log("")
    log("═══ โหมด --resync-nc : sync ธง nc บน cloud ให้ตรงกติกาปัจจุบัน ═══")
    log(f"กติกาที่ใช้: nc:1 prefixes={list(R01_NON_COUNT_PREFIXES)} keywords={list(R01_NON_COUNT_KEYWORDS)} "
        f"· nc:2 keywords={list(R01_STOCK_ONLY_KEYWORDS)}")
    log("เขียนเฉพาะ data_json — ไม่แตะ r01Version / r01BaselineAt / r01UploadedAt / r16* / updated_at")
    log("โหมด: ✍️ เขียนจริง" if apply_writes else "โหมด: 🔍 DRY-RUN (ใส่ --yes เพื่อเขียนจริง)")

    targets = [only_branch] if only_branch else sorted(AUTO_BRANCHES)
    ok = True
    for branch in targets:
        log("")
        log(f"── {branch} ──")
        items = branches.get(branch, [])
        if not items:
            log(f"  ❌ ไม่มีแถวของสาขานี้ในไฟล์ — ข้าม")
            ok = False
            continue

        try:
            cloud_raw = _rest_get_data_json(f"{branch}_r01")
        except Exception as e:
            log(f"  ❌ อ่าน {branch}_r01 ไม่ได้: {e}")
            ok = False
            continue
        if cloud_raw is None:
            log(f"  ❌ ไม่มี doc {branch}_r01 บน cloud (อาจมีคนกด 'เริ่มนับใหม่') — ข้าม")
            ok = False
            continue
        if not cloud_raw:
            log(f"  ❌ {branch}_r01 ไม่มี field data_json — ข้าม")
            ok = False
            continue

        try:
            cloud_rows = json.loads(cloud_raw)
        except Exception as e:
            log(f"  ❌ data_json เดิมอ่านไม่ได้: {e} — ข้าม")
            ok = False
            continue

        diff = _row_identity_diff(cloud_rows, items)
        if diff:
            log(f"  ❌ ไฟล์ไม่ตรงกับที่อยู่บน cloud — {diff}")
            log(f"     ต้องรันด้วยไฟล์ Allstock ชุดเดียวกับที่บอทเขียนขึ้นไปล่าสุดเท่านั้น (ยกเลิกสาขานี้)")
            ok = False
            continue

        flags_before = _nc_flags(cloud_rows)
        flags_after = _nc_flags(items)
        count_flag = lambda flags, want: sum(1 for v in flags.values() if v == want)
        changed = {s for s in set(flags_before) | set(flags_after)
                   if flags_before.get(s, 0) != flags_after.get(s, 0)}

        new_raw = json.dumps(items, ensure_ascii=False)
        kb_before = len(cloud_raw.encode("utf-8")) / 1024
        kb_after = len(new_raw.encode("utf-8")) / 1024

        cat_skus, has_pm = _cat_skus_from_pm(branch)
        total_before = _countable_count(cloud_rows, cat_skus)
        total_after = _countable_count(items, cat_skus)
        # หมวด DELETE ที่ยังถูกจัดชั้น A/B/C/REVIEW ไว้ใน PBM = เคสที่ธง nc:2 มีไว้กันโดยเฉพาะ
        stock_only_with_cat = len({s for s, v in flags_after.items() if v == 2} & cat_skus)

        log(f"  แถว {len(items)} · ธงเปลี่ยน {len(changed)} SKU")
        log(f"    nc:1 ตัดเด็ดขาด (หมวด 11.)    {count_flag(flags_before, 1)} → {count_flag(flags_after, 1)}")
        log(f"    nc:2 นับเฉพาะมีของ (DELETE)   {count_flag(flags_before, 2)} → {count_flag(flags_after, 2)}")
        log(f"  ขนาด {kb_before:.0f} KB → {kb_after:.0f} KB")
        if has_pm:
            log(f"  Total SKU {total_before} → {total_after}  ({total_after - total_before:+d})")
            log(f"  หมวด DELETE ที่จัดชั้น A/B/C/REVIEW ไว้ด้วย {stock_only_with_cat} ตัว "
                f"(กลุ่มนี้ยอด 0 จะไม่ถูกนับ — เป็นเหตุผลของธง nc:2)")
        else:
            log(f"  ⚠️ ไม่มี {branch}_pm บน cloud — ประเมิน Total SKU ไม่ได้ (ตัวเลขนับเฉพาะกติกา G ≠ 0)")

        if kb_after > MAX_DOC_KB:
            log(f"  ❌ {kb_after:.0f} KB เกิน {MAX_DOC_KB} KB — ไม่เขียน")
            ok = False
            continue

        if new_raw == cloud_raw:
            log(f"  ✅ ตรงกติกาอยู่แล้ว ไม่ต้องเขียน")
            continue

        if not apply_writes:
            log(f"  [DRY] จะเขียน data_json ใหม่ (ยังไม่เขียน)")
            continue

        try:
            os.makedirs(BACKUP_DIR, exist_ok=True)
            stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
            bpath = os.path.join(BACKUP_DIR, f"{branch}_r01_data_json_{stamp}.json")
            with open(bpath, "w", encoding="utf-8") as f:
                f.write(cloud_raw)
            log(f"  💾 สำรองของเดิมไว้ที่ {bpath}")
        except Exception as e:
            log(f"  ❌ สำรองไฟล์ไม่สำเร็จ ({e}) — ไม่เขียน cloud")
            ok = False
            continue

        try:
            _patch_data_json(f"{branch}_r01", new_raw)
            log(f"  ✅ เขียน data_json ใหม่แล้ว")
        except urllib.error.HTTPError as e:
            log(f"  ❌ HTTP {e.code} — {e.read().decode('utf-8', 'replace')[:400]}")
            ok = False
        except Exception as e:
            log(f"  ❌ {e}")
            ok = False

    log("")
    if apply_writes and ok:
        log("เสร็จสิ้น — ขั้นต่อไป: ตรวจบน Firebase Console ว่า r01Version / r01BaselineAt / r16Loaded เป็นค่าเดิม")
        log("แล้วค่อย deploy เว็บ (auto-refresh จะ reload ให้ทุกเครื่องเอง ภายใน 15 นาที)")
    elif not apply_writes:
        log("DRY-RUN จบ — ยังไม่เขียนอะไรทั้งสิ้น · ใส่ --yes เมื่อตรวจตัวเลขแล้วพอใจ")
    else:
        log("เสร็จแบบมีข้อผิดพลาด (ดู log ด้านบน)")
    sys.exit(0 if ok else 1)


def main():
    dry_run = "--dry-run" in sys.argv or "-n" in sys.argv
    force = "--force" in sys.argv
    # --resync-nc = งานครั้งเดียวหลังแก้กติกาหมวด · dry-run เป็นค่าเริ่มต้น ต้องใส่ --yes ถึงจะเขียน
    resync = "--resync-nc" in sys.argv
    apply_writes = "--yes" in sys.argv
    only_branch = None
    for i, a in enumerate(sys.argv):
        if a == "--branch" and i + 1 < len(sys.argv):
            only_branch = sys.argv[i + 1].strip().upper()
        elif a.startswith("--branch="):
            only_branch = a.split("=", 1)[1].strip().upper()
    if only_branch and not resync:
        log("❌ --branch ใช้ได้เฉพาะกับ --resync-nc — ยกเลิก")
        sys.exit(2)
    if only_branch and only_branch not in AUTO_BRANCHES:
        log(f"❌ --branch {only_branch} ไม่อยู่ใน AUTO_BRANCHES ({', '.join(sorted(AUTO_BRANCHES))}) — ยกเลิก")
        sys.exit(2)

    mode = f", resync-nc (เขียนจริง={apply_writes})" if resync else ""
    log(f"เริ่มงาน auto R01 import  (dry_run={dry_run}, force={force}{mode})")
    log(f"เครื่อง: {os.environ.get('COMPUTERNAME', '?')} · ผู้ใช้: {os.environ.get('USERNAME', '?')}")
    log(f"โฟลเดอร์: {WATCH_FOLDER}   [จาก {WATCH_FOLDER_SOURCE}]")
    log(f"branch ที่เปิดใช้: {', '.join(sorted(AUTO_BRANCHES))}")

    if not os.path.isdir(WATCH_FOLDER):
        log(f"❌ ไม่มีโฟลเดอร์นี้ในเครื่อง — ยกเลิก")
        log(f"   ถ้าไฟล์อยู่ที่อื่น ตั้งค่าแล้วรันใหม่:")
        log(f'   setx AUTO_R01_WATCH_FOLDER "D:\\path\\to\\run-upload-stock"   (แล้วเปิด CMD ใหม่)')
        log(f'   หรือทดสอบครั้งเดียว:  python auto_r01_import.py --folder "D:\\path" --dry-run')
        sys.exit(2)

    path = find_latest_file()
    if not path:
        log(f"❌ ไม่พบไฟล์ตรงรูปแบบ '{FILE_GLOB}' ในโฟลเดอร์ — ยกเลิก")
        try:
            others = sorted(os.listdir(WATCH_FOLDER))[:10]
            log(f"   ไฟล์ที่มีในโฟลเดอร์: {others if others else '(ว่าง)'}")
        except Exception:
            pass
        sys.exit(2)

    mtime = datetime.fromtimestamp(os.path.getmtime(path))
    log(f"ไฟล์ล่าสุด: {os.path.basename(path)}  (แก้ไขล่าสุด {mtime:%Y-%m-%d %H:%M})")

    # guard 1: ไฟล์ไม่ใช่ของวันนี้ = POS ยัง export ไม่เสร็จ / export ล้ม
    # เขียนของเก่าทับ = ดัน r01BaselineAt ใหม่ด้วยข้อมูลเก่า + ล้าง R16 ของทุกเครื่องฟรี → ต้องหยุด
    # (สำคัญเป็นพิเศษเพราะ Task Scheduler ตั้ง StartWhenAvailable ไว้ = รันชดเชยข้ามวันได้)
    if mtime.date() != datetime.now().date():
        if not force:
            log("❌ ไฟล์ไม่ได้ถูกแก้ไขวันนี้ — ยกเลิก (ไม่เขียน Firestore). ใช้ --force ถ้าตั้งใจ")
            sys.exit(4)
        log("⚠️ ไฟล์ไม่ได้ถูกแก้ไขวันนี้ แต่มี --force — ดำเนินการต่อ")

    branches, stats = parse_file(path)
    log(f"delimiter={stats['delimiter']} · แถวข้อมูล {stats['total_rows']} · "
        f"ข้าม: ไม่มี SKU={stats['skipped_no_sku']}, qty อ่านไม่ได้={stats['skipped_qty']}")

    # guard 2: Col D ที่ map ไม่ได้ = POS เปลี่ยนชื่อคลัง / เพิ่มสาขาใหม่ ต้องมีคนมาดูก่อน
    if stats["unknown_branch"]:
        log(f"❌ Col D ที่ map ไม่ได้: {stats['unknown_branch']}")
        log("   POS อาจเปลี่ยนชื่อคลังหรือเพิ่มสาขา — เพิ่มใน BRANCH_MAP ก่อน. ยกเลิก (ไม่เขียน Firestore)")
        sys.exit(4)

    # guard 3: branch หาย/แถวน้อยผิดปกติ = ไฟล์ export ไม่ครบ — ตรวจให้ครบก่อนเขียนตัวแรก (all-or-none)
    problems = []
    for branch in sorted(AUTO_BRANCHES):
        n = len(branches.get(branch, []))
        if n < MIN_ROWS_PER_BRANCH:
            problems.append(f"{branch}={n}")
    if problems:
        log(f"❌ branch ที่แถวน้อยกว่า {MIN_ROWS_PER_BRANCH}: {', '.join(problems)}")
        log("   ไฟล์ export น่าจะไม่ครบ. ยกเลิกทั้งงาน (ไม่เขียน Firestore)")
        sys.exit(4)

    for branch in sorted(AUTO_BRANCHES):
        log(f"  · {branch}: {len(branches[branch])} รายการ "
            f"(nc:1 ตัดเด็ดขาด {stats['nc_counts'][branch]} · nc:2 มีของถึงนับ {stats['so_counts'][branch]})")

    # --resync-nc จบงานที่นี่ (sys.exit ในตัว) — ใช้ guard 1-3 ด้านบนร่วมกันทั้งหมด
    # แต่ไม่แตะ metadata ใดๆ จึงไม่ต้องมี version_iso / uploaded_at
    if resync:
        resync_nc(branches, apply_writes, only_branch)

    # ใช้ค่าเดียวกันทุก branch ในรอบเดียว — อ่าน log ย้อนหลังแล้วจับคู่ได้ว่า doc ไหนมาจากรอบไหน
    version_iso = iso_utc_ms()
    uploaded_at = thai_ts(datetime.now())

    ok = True
    for branch in sorted(AUTO_BRANCHES):
        if not write_branch(branch, branches[branch], version_iso, uploaded_at, dry_run):
            ok = False

    log("เสร็จสิ้น" if ok else "เสร็จแบบมีข้อผิดพลาด (ดู log ด้านบน)")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
