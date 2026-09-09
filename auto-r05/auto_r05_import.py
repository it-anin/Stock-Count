#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Auto R05.106 importer  ->  Firestore  (Stock Count)

อ่านไฟล์ R05.106 (CSV) ที่ใหม่ที่สุดในโฟลเดอร์ที่กำหนด แล้วเขียนตารางบาร์โค้ดเข้า Firestore:
    stock_sessions/global_r05

R05 เป็น doc "กลาง" ใช้ร่วมกันทุกสาขา (ไม่แยก branch เหมือน R01) — อัปครั้งเดียวทุกสาขาเห็นพร้อมกัน
รูปแบบข้อมูลตรงกับที่ index.html (loadR05 + _serializeR05 + syncMasterToFirestore) ใช้ทุกประการ
ใช้ Python stdlib ล้วน — ไม่ต้องลง pip อะไรเพิ่ม

⚠️ ตรรกะ parse + serialize ถูกเขียนไว้ 2 ภาษา (JS ใน index.html · Python ในไฟล์นี้)
   หลุดจากกันเมื่อไรจะได้ตารางบาร์โค้ดคนละชุดขึ้นกับว่าใครอัป และไม่มีอาการให้เห็น
   แก้ที่ใดที่หนึ่งต้องแก้อีกที่เสมอ แล้วยืนยันด้วย:
       node tools/check-r05-parity.js "<path ไป R05.106.CSV>"

วิธีรัน:
    python auto_r05_import.py            # โหมดจริง — เขียนขึ้น Firestore เมื่อเนื้อหาเปลี่ยน
    python auto_r05_import.py --dry-run  # ทดสอบ — พิมพ์ตัวเลขให้ดูอย่างเดียว ไม่เขียน
    python auto_r05_import.py --force    # ข้าม guard "ไฟล์ไม่ใช่ของวันนี้" (ใช้ตอนทดสอบเท่านั้น)

ตั้งเวลา 07:30 ทุกวันด้วย Windows Task Scheduler (ดู README.md)
"""

import sys
import os
import csv
import io
import re
import json
import glob
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

# โฟลเดอร์ที่ไฟล์ R05.106 ถูก export มาวาง — หาตามลำดับเดียวกับ auto-r01:
#   1. อาร์กิวเมนต์ --folder "<path>"        (ใช้ตอนทดสอบ)
#   2. ตัวแปรระบบ AUTO_R05_WATCH_FOLDER      (ใช้เมื่อ path ไม่ตรงแบบมาตรฐาน)
#   3. <โฟลเดอร์ผู้ใช้ปัจจุบัน>\Desktop\run-upload-stock   ← ค่าปกติ
#
# เป็นโฟลเดอร์เดียวกับที่บอท BOTR05106 (ProMaxx GUI automation) export ไฟล์ลงทุกเช้า 06:30
# และเป็นโฟลเดอร์เดียวกับที่ auto-r01 ใช้อยู่แล้ว
DEFAULT_WATCH_FOLDER = os.path.join(os.path.expanduser("~"), "Desktop", "run-upload-stock")


def resolve_watch_folder(argv):
    for i, a in enumerate(argv):
        if a == "--folder" and i + 1 < len(argv):
            return argv[i + 1], "--folder"
        if a.startswith("--folder="):
            return a.split("=", 1)[1], "--folder"
    env = os.environ.get("AUTO_R05_WATCH_FOLDER", "").strip()
    if env:
        return env, "AUTO_R05_WATCH_FOLDER"
    return DEFAULT_WATCH_FOLDER, "ค่าปกติ (โฟลเดอร์ผู้ใช้ปัจจุบัน)"


WATCH_FOLDER, WATCH_FOLDER_SOURCE = resolve_watch_folder(sys.argv)

# รูปแบบชื่อไฟล์ที่จะมองหา (เลือกไฟล์ที่ใหม่ที่สุด)
# ⚠️ ต้องกรอง ".part." ออกเสมอ — flow ของ BOTR05106 เขียน "R05.106.part.CSV" ก่อนแล้วค่อยเปลี่ยนชื่อ
#    ถ้าเผลออ่านไฟล์ .part ที่ยังเขียนไม่เสร็จ จะได้ตารางบาร์โค้ดขาดครึ่งไปทับของครบ
FILE_GLOB = "R05*.CSV"
PART_MARKER = ".part."

# Firebase project (จาก index.html FIREBASE_CONFIG)
PROJECT_ID = "stock-count-1d6e7"
API_KEY    = "AIzaSyDba_44vuyh-DyXeSYUoppm925oFCfr010"

# doc กลาง ใช้ร่วมทุกสาขา (getR05Ref() ใน index.html)
DOC_ID = "global_r05"

# ต้องตรงกับ R05_CLOUD_FORMAT ใน index.html
R05_CLOUD_FORMAT = "r05a1"

# index คอลัมน์ (ตรงกับ loadR05 ใน index.html)
COL_BARCODE = 0   # A  CF_BARCODE
COL_PRICE   = 1   # B  CF_FMLPRICE            ราคาต่อบาร์โค้ด = ตัวตัดสินสิทธิ์กรอกจำนวน
COL_SKU     = 4   # E  CF_ITEMID
COL_UNIT    = 6   # G  CF_UNITNAME
COL_MULT    = 7   # H  CF_BASEMULTIPLE

# guard: หัวคอลัมน์ต้องอยู่ตำแหน่งเดิม — loadR05 อ่านด้วยเลขคอลัมน์ตายตัว ไม่ได้อ่านตามชื่อ
# ถ้า ProMaxx สลับ/แทรกคอลัมน์เมื่อไร เราจะเขียนบาร์โค้ดมั่วขึ้น cloud แบบเงียบสนิท
# (auto-r01 ไม่มี guard นี้เพราะ R01 มี guard "Col D ที่ map ไม่ได้" ทำหน้าที่แทนอยู่แล้ว)
EXPECTED_HEADERS = {
    COL_BARCODE: "CF_BARCODE",
    COL_PRICE:   "CF_FMLPRICE",
    COL_SKU:     "CF_ITEMID",
    COL_UNIT:    "CF_UNITNAME",
    COL_MULT:    "CF_BASEMULTIPLE",
}

# guard: แถวน้อยกว่านี้ = ไฟล์ผิดปกติ (ของจริง ก.ย. 2026 อยู่ที่ 10,864 บาร์โค้ด)
MIN_ROWS = 5000

# guard: แถวหดจากที่อยู่บน cloud เกินสัดส่วนนี้ = export ไม่ครบ (ยืมกติกาจาก upload-products.mjs)
MAX_SHRINK_RATIO = 0.20

# guard: สัดส่วนแถวที่มีราคาตกจากบน cloud เกินกี่ "จุด" ถึงจะถือว่าผิดปกติ
# ราคาหายทั้งไฟล์ = ทุกสาขาเด้งไปโหมดสแกนทีละชิ้นโดยไม่มีใครรู้สาเหตุ (fail-safe แต่ทำงานช้าลงมาก)
MAX_PRICED_DROP_PCT = 10.0

# guard: doc ใหญ่เกินนี้ (KB) ไม่เขียน — Firestore ปฏิเสธที่ 1 MiB
# ของจริงตอนนี้ ~488 KB · โตเกิน 950 ต้องแตก chunk แบบ WH R16 (ดู CLAUDE.md §global_r05)
MAX_DOC_KB = 950

# field ทั้งหมดที่เขียน — ใช้เป็น updateMask ด้วย และต้อง "เท่ากับที่หน้าเว็บเขียนเป๊ะ"
# ⚠️ ห้ามเติม field ของบอทเองลงไป: ผลของบอทต้องแยกไม่ออกจากคนอัปผ่านหน้าเว็บ
#    ร่องรอยว่าใครเขียนอยู่ที่ auto_r05.log กับโฟลเดอร์ backup/ ไม่ใช่ในตัว document
WRITE_FIELDS = ["data_json", "format", "row_count", "updated_at"]

BACKUP_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "backup")

# ============================================================


def log(msg):
    print(f"[{datetime.now():%Y-%m-%d %H:%M:%S}] {msg}", flush=True)


def find_latest_file():
    files = glob.glob(os.path.join(WATCH_FOLDER, FILE_GLOB))
    if not files:
        files = glob.glob(os.path.join(WATCH_FOLDER, FILE_GLOB.lower()))
    files = [f for f in files if PART_MARKER not in os.path.basename(f).lower()]
    if not files:
        return None
    files.sort(key=os.path.getmtime, reverse=True)
    return files[0]


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


def _strip_spaces_commas(value):
    """.replace(/,|\\s/g,'').trim() ของ JS"""
    return re.sub(r"[,\s]", "", str(value if value is not None else "")).strip()


def _js_number(text):
    """แปลงสตริงเป็นตัวเลขด้วยกติกาเดียวกับ Number() ของ JS — คืน None เมื่อ JS จะได้ NaN

    มีไว้เพื่อ parity ล้วน ๆ: float() ของ Python กับ Number() ของ JS ไม่เหมือนกันสามจุด
      · '0x10' / '0b101' / '0o17'  JS อ่านเป็นเลขฐาน แต่ Python โยน ValueError
      · '1_0'                      Python อ่านได้ 10 แต่ JS ได้ NaN
      · 'inf' / 'nan'              Python อ่านได้ แต่ JS ได้ NaN (JS รับเฉพาะ 'Infinity')
    ค่าพวกนี้ไม่ควรโผล่ในไฟล์ POS จริง แต่ถ้าโผล่ขึ้นมาต้องได้ผลตรงกันทั้งสองฝั่ง
    """
    t = str(text if text is not None else "").strip()
    if t == "":
        return 0.0                      # Number('') === 0
    low = t.lower()
    if low[:2] in ("0x", "0o", "0b"):
        try:
            return float(int(t, 0))
        except ValueError:
            return None
    if "_" in t:
        return None
    bare = low.lstrip("+-")
    if bare == "infinity":
        return float("-inf") if t.startswith("-") else float("inf")
    if bare in ("inf", "nan"):
        return None
    try:
        return float(t)
    except ValueError:
        return None


def _finite(v):
    return v is not None and v == v and v not in (float("inf"), float("-inf"))


def _js_num_out(v):
    """ทำให้ json.dumps เขียนตัวเลขเหมือน JSON.stringify — เลขลงตัวห้ามมี '.0' ต่อท้าย"""
    return int(v) if float(v) == int(v) else float(v)


def parse_price(value):
    """ตรงกับ _parseProductMasterPrice() ใน index.html — คืน None เมื่อว่าง/อ่านไม่ได้/ติดลบ"""
    raw = _strip_spaces_commas(value)
    if raw == "":
        return None
    price = _js_number(raw)
    if not _finite(price) or price < 0:
        return None
    return _js_num_out(price)


def parse_multiplier(value):
    """ตรงกับ h===''?1:(isFinite(+h)&&+h>0?+h:1) ใน loadR05"""
    h = _strip_spaces_commas(value)
    if h == "":
        return 1
    m = _js_number(h)
    if not _finite(m) or m <= 0:
        return 1
    return _js_num_out(m)


def read_rows(path):
    """อ่าน CSV ด้วย config เดียวกับ parseFile() ใน index.html

    ⛔ ห้ามเดา delimiter — parseFile ส่ง delimiter:',' ตายตัว การเดาเองจะทำให้บอทอ่านไฟล์
       ที่หน้าเว็บอ่านไม่ได้ (ไฟล์คั่นด้วย ; จะตกด่านหัวคอลัมน์ ซึ่งเป็นผลที่ถูกต้อง)
    """
    with open(path, "rb") as f:
        raw = f.read()
    text = decode_bytes(raw)
    rows = list(csv.reader(io.StringIO(text), delimiter=",", quotechar='"'))
    # skipEmptyLines:true ของ papaparse = ตัดเฉพาะบรรทัดที่ว่างทั้งบรรทัด
    return [r for r in rows if not (len(r) == 1 and r[0] == "")]


def header_problems(rows):
    """คืนลิสต์คำอธิบายคอลัมน์ที่ไม่ตรงตำแหน่ง — ว่าง = ผ่าน"""
    if not rows:
        return ["ไฟล์ว่าง ไม่มีแม้แต่แถวหัวตาราง"]
    head = rows[0]
    bad = []
    for idx, want in sorted(EXPECTED_HEADERS.items()):
        got = str(col(head, idx)).strip().upper()
        if got != want:
            bad.append(f"คอลัมน์ที่ {idx} ควรเป็น {want} แต่เจอ {got or '(ว่าง)'}")
    return bad


def parse_file(path):
    """ตรงกับลูป parse ใน loadR05() ของ index.html — คืน (rows, stats)

    ⚠️ ชื่อฟังก์ชันนี้ถูก import ตรง ๆ โดย tools/check-r05-parity.js ห้ามเปลี่ยน signature
    """
    rows = read_rows(path)
    out = []
    skipped = 0
    priced = 0
    # ข้าม header แถวแรก (เหมือน loadR05 ที่เริ่ม i=1)
    for r in rows[1:]:
        if not r or not len(r):
            continue
        a = str(col(r, COL_BARCODE)).strip()
        e = str(col(r, COL_SKU)).strip()
        g = str(col(r, COL_UNIT)).strip()
        if not a or not e:
            skipped += 1
            continue
        unit_price = parse_price(col(r, COL_PRICE))
        if unit_price is not None:
            priced += 1
        out.append({
            "barcode": a,
            "colE": e,
            "unitName": g,
            "unitMultiplier": parse_multiplier(col(r, COL_MULT)),
            "unitPrice": unit_price,
        })
    return out, {
        "total_rows": max(0, len(rows) - 1),
        "skipped": skipped,
        "priced": priced,
        "headers_ok": not header_problems(rows),
        "header_problems": header_problems(rows),
    }


def serialize_r05(rows):
    """ตรงกับ _serializeR05() ใน index.html ทุกไบต์

    ⚠️ ชื่อฟังก์ชันนี้ถูก import ตรง ๆ โดย tools/check-r05-parity.js ห้ามเปลี่ยน signature
    separators ต้องเป็น (',', ':') — ค่าปกติของ Python ใส่ช่องว่างหลังคอมมาซึ่ง JS ไม่ใส่
    """
    compact = [[
        r["barcode"],
        r["colE"],
        r.get("unitName") or "",
        r["unitMultiplier"],
        "" if r.get("unitPrice") is None else r["unitPrice"],
    ] for r in (rows or [])]
    return json.dumps(compact, ensure_ascii=False, separators=(",", ":"))


# ============================================================
#  Firestore REST
# ============================================================


def _doc_url(query=""):
    return (f"https://firestore.googleapis.com/v1/projects/{PROJECT_ID}"
            f"/databases/(default)/documents/stock_sessions/{DOC_ID}?{query}key={API_KEY}")


def read_cloud():
    """อ่าน doc ปัจจุบัน — คืน None ถ้ายังไม่มี doc"""
    try:
        with urllib.request.urlopen(_doc_url(), timeout=120) as resp:
            doc = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None
        raise
    f = doc.get("fields") or {}
    return {
        "data_json": (f.get("data_json") or {}).get("stringValue", ""),
        "format": (f.get("format") or {}).get("stringValue", ""),
        "row_count": int((f.get("row_count") or {}).get("integerValue", 0) or 0),
        "updated_at": (f.get("updated_at") or {}).get("timestampValue", ""),
    }


def cloud_priced_count(data_json):
    """นับแถวที่มีราคาในข้อมูลที่อยู่บน cloud — รองรับทั้งรูปแบบ array และ object รุ่นเก่า"""
    try:
        arr = json.loads(data_json)
    except Exception:
        return None
    if not isinstance(arr, list):
        return None
    n = 0
    for r in arr:
        v = r[4] if isinstance(r, list) and len(r) > 4 else (r.get("unitPrice") if isinstance(r, dict) else "")
        if v != "" and v is not None:
            n += 1
    return n


def write_cloud(data_json, row_count):
    body = {
        "fields": {
            "data_json":  {"stringValue": data_json},
            "format":     {"stringValue": R05_CLOUD_FORMAT},
            "row_count":  {"integerValue": str(row_count)},
            "updated_at": {"timestampValue": datetime.now(timezone.utc)
                           .strftime("%Y-%m-%dT%H:%M:%S.%fZ")},
        }
    }
    mask = "&".join(f"updateMask.fieldPaths={urllib.parse.quote(f)}" for f in WRITE_FIELDS)
    req = urllib.request.Request(_doc_url(mask + "&"), data=json.dumps(body).encode("utf-8"),
                                 method="PATCH", headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=180) as resp:
        resp.read()


def backup_cloud(data_json):
    """สำรอง data_json เดิมก่อนเขียนทับ — สำรองไม่สำเร็จ = ไม่เขียน

    การเขียนของบอทตัวนี้แทนที่ตารางบาร์โค้ดทั้งชุดของ doc ที่ทุกสาขาใช้ร่วมกัน
    ถ้าเขียนของผิดขึ้นไปแล้วไม่มีสำเนาเดิม ทางกู้เหลือแค่หาไฟล์ CSV เก่ามาอัปใหม่
    """
    os.makedirs(BACKUP_DIR, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    path = os.path.join(BACKUP_DIR, f"{DOC_ID}_{stamp}.json")
    with open(path, "w", encoding="utf-8") as f:
        f.write(data_json)
    return path


# ============================================================


def main():
    dry_run = "--dry-run" in sys.argv or "-n" in sys.argv
    force = "--force" in sys.argv

    log(f"เริ่มงาน auto R05 import  (dry_run={dry_run}, force={force})")
    log(f"เครื่อง: {os.environ.get('COMPUTERNAME', '?')} · ผู้ใช้: {os.environ.get('USERNAME', '?')}")
    log(f"โฟลเดอร์: {WATCH_FOLDER}   [จาก {WATCH_FOLDER_SOURCE}]")
    log(f"ปลายทาง: stock_sessions/{DOC_ID} (doc กลาง ใช้ร่วมทุกสาขา)")

    if not os.path.isdir(WATCH_FOLDER):
        log("❌ ไม่มีโฟลเดอร์นี้ในเครื่อง — ยกเลิก")
        log("   ถ้าไฟล์อยู่ที่อื่น ตั้งค่าแล้วรันใหม่:")
        log('   setx AUTO_R05_WATCH_FOLDER "D:\\path\\to\\run-upload-stock"   (แล้วเปิด CMD ใหม่)')
        log('   หรือทดสอบครั้งเดียว:  python auto_r05_import.py --folder "D:\\path" --dry-run')
        sys.exit(2)

    path = find_latest_file()
    if not path:
        log(f"❌ ไม่พบไฟล์ตรงรูปแบบ '{FILE_GLOB}' ในโฟลเดอร์ (ไฟล์ชื่อมี '{PART_MARKER}' ถูกข้ามโดยตั้งใจ) — ยกเลิก")
        try:
            others = sorted(os.listdir(WATCH_FOLDER))[:10]
            log(f"   ไฟล์ที่มีในโฟลเดอร์: {others if others else '(ว่าง)'}")
        except Exception:
            pass
        sys.exit(2)

    mtime = datetime.fromtimestamp(os.path.getmtime(path))
    log(f"ไฟล์ล่าสุด: {os.path.basename(path)}  (แก้ไขล่าสุด {mtime:%Y-%m-%d %H:%M})")

    # guard 1: ไฟล์ไม่ใช่ของวันนี้ = บอท export ยังไม่ได้รัน / รันไม่สำเร็จ
    # เขียนของเก่าทับ = บาร์โค้ดที่เพิ่มมาระหว่างนั้นหายไปจากระบบทุกสาขาพร้อมกัน
    if mtime.date() != datetime.now().date():
        if not force:
            log("❌ ไฟล์ไม่ได้ถูกแก้ไขวันนี้ — ยกเลิก (ไม่เขียน Firestore). ใช้ --force ถ้าตั้งใจ")
            log("   สาเหตุที่พบบ่อย: Scheduled Task ของ BOTR05106 (export 06:30) ไม่ได้รัน — ไปแก้ตรงนั้นก่อน")
            sys.exit(4)
        log("⚠️ ไฟล์ไม่ได้ถูกแก้ไขวันนี้ แต่มี --force — ดำเนินการต่อ")

    rows, stats = parse_file(path)

    # guard 2: หัวคอลัมน์ต้องอยู่ตำแหน่งเดิม
    if not stats["headers_ok"]:
        log("❌ หัวคอลัมน์ไม่ตรงกับที่ loadR05 คาดไว้:")
        for p in stats["header_problems"]:
            log(f"   · {p}")
        log("   ProMaxx อาจเปลี่ยนรูปแบบรายงาน — ต้องมีคนตรวจก่อน. ยกเลิก (ไม่เขียน Firestore)")
        sys.exit(4)

    priced_pct = (stats["priced"] / len(rows) * 100) if rows else 0.0
    log(f"อ่านได้ {len(rows)} บาร์โค้ด · มีราคา {stats['priced']} ({priced_pct:.1f}%) · "
        f"ข้าม {stats['skipped']} (ไม่มีบาร์โค้ดหรือไม่มี SKU) · แถวข้อมูลในไฟล์ {stats['total_rows']}")

    # guard 3: แถวน้อยผิดปกติ
    if len(rows) < MIN_ROWS:
        log(f"❌ ได้แค่ {len(rows)} แถว น้อยกว่าขั้นต่ำ {MIN_ROWS} — ไฟล์ export น่าจะไม่ครบ. ยกเลิก")
        sys.exit(4)

    data_json = serialize_r05(rows)
    size_kb = len(data_json.encode("utf-8")) / 1024

    # guard 4: ขนาดเกินเพดาน
    if size_kb > MAX_DOC_KB:
        log(f"❌ {size_kb:.0f} KB เกิน {MAX_DOC_KB} KB (เพดาน Firestore 1 MiB) — ไม่เขียน")
        log("   ต้องแตก chunk แบบ WH R16 ก่อน (ดู CLAUDE.md §global_r05)")
        sys.exit(4)

    try:
        cloud = read_cloud()
    except Exception as e:
        log(f"❌ อ่าน {DOC_ID} จาก Firestore ไม่ได้: {e}")
        sys.exit(1)

    if cloud is None:
        log(f"⚠️ ยังไม่มี doc {DOC_ID} บน cloud — ข้าม guard เทียบกับของเดิม (แถวหด / ราคาหาย)")
    else:
        log(f"บน cloud ตอนนี้: {cloud['row_count']} แถว · {len(cloud['data_json'].encode('utf-8')) / 1024:.0f} KB "
            f"· format={cloud['format'] or '(ไม่มี)'} · updated_at={cloud['updated_at'] or '(ไม่มี)'}")

        # guard 5: แถวหดเกิน 20% = export ไม่ครบมาทับของครบ
        if cloud["row_count"] > 0:
            shrink = (cloud["row_count"] - len(rows)) / cloud["row_count"]
            if shrink > MAX_SHRINK_RATIO:
                log(f"❌ แถวหดจาก {cloud['row_count']} เหลือ {len(rows)} ({shrink * 100:.1f}%) "
                    f"เกินเพดาน {MAX_SHRINK_RATIO * 100:.0f}% — ยกเลิก")
                log("   ถ้าเป็นการตัดสินค้าออกจริง ให้อัปผ่านหน้าเว็บครั้งเดียวก่อน แล้วบอทจะเดินต่อได้เอง")
                sys.exit(4)

        # guard 6: ราคาหายยกไฟล์ = ทุกสาขาเด้งไปโหมดสแกนทีละชิ้น
        cp = cloud_priced_count(cloud["data_json"])
        if cp is not None and cloud["row_count"] > 0:
            cloud_pct = cp / cloud["row_count"] * 100
            if cloud_pct - priced_pct > MAX_PRICED_DROP_PCT:
                log(f"❌ สัดส่วนแถวที่มีราคาตกจาก {cloud_pct:.1f}% เหลือ {priced_pct:.1f}% "
                    f"เกินเพดาน {MAX_PRICED_DROP_PCT:.0f} จุด — ยกเลิก")
                log("   ราคาต่อบาร์โค้ดเป็นตัวตัดสินสิทธิ์กรอกจำนวน หายทั้งไฟล์ = ทุกสาขาต้องสแกนทีละชิ้น")
                sys.exit(4)

        # guard 7: เนื้อหาเหมือนเดิม = ไม่ต้องเขียน (วันปกติจะจบตรงนี้)
        if data_json == cloud["data_json"]:
            log(f"✅ เนื้อหาเหมือนเดิมทุกไบต์ ({len(rows)} แถว · {size_kb:.0f} KB) — ไม่เขียน จบงาน")
            sys.exit(0)

        delta = len(rows) - cloud["row_count"]
        log(f"เนื้อหาเปลี่ยน — จำนวนแถว {cloud['row_count']} → {len(rows)} ({delta:+d})")

    if dry_run:
        log(f"[DRY] จะเขียน {len(rows)} แถว · {size_kb:.0f} KB ขึ้น {DOC_ID} (ยังไม่เขียน)")
        log("DRY-RUN จบ — ยังไม่เขียนอะไรทั้งสิ้น")
        sys.exit(0)

    if cloud is not None and cloud["data_json"]:
        try:
            bpath = backup_cloud(cloud["data_json"])
            log(f"💾 สำรองของเดิมไว้ที่ {bpath}")
        except Exception as e:
            log(f"❌ สำรองไฟล์ไม่สำเร็จ ({e}) — ไม่เขียน cloud")
            sys.exit(1)

    try:
        write_cloud(data_json, len(rows))
    except urllib.error.HTTPError as e:
        log(f"❌ HTTP {e.code} — {e.read().decode('utf-8', 'replace')[:400]}")
        sys.exit(1)
    except Exception as e:
        log(f"❌ เขียนไม่สำเร็จ: {e}")
        sys.exit(1)

    log(f"✅ เขียน {DOC_ID} แล้ว: {len(rows)} แถว · มีราคา {stats['priced']} · {size_kb:.0f} KB")
    log("ทุกเครื่องที่เปิดค้างจะเห็นภายในไม่กี่วินาที (listener) และเด้ง toast 'R05.106 อัปเดตจากเครื่องอื่น'")
    sys.exit(0)


if __name__ == "__main__":
    main()
