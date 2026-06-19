#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Auto R01.102 importer  ->  Firestore  (Stock Count)

อ่านไฟล์ R01.102 (CSV) ที่ใหม่ที่สุดในโฟลเดอร์ที่กำหนด แล้วแยกตาม Col D
เป็น 3 สาขา (SRC / KKL / SSS) เขียนเข้า Firestore:
    stock_sessions/<BRANCH>_r01   { data_json, r01UploadedAt, updated_at }

รูปแบบข้อมูลตรงกับที่ index.html (loadR01 + syncMasterToFirestore) ใช้ทุกประการ
ใช้ Python stdlib ล้วน — ไม่ต้องลง pip อะไรเพิ่ม

วิธีรัน:
    python auto_r01_import.py            # โหมดจริง — เขียนขึ้น Firestore
    python auto_r01_import.py --dry-run  # ทดสอบ — แค่พิมพ์ยอดต่อสาขา ไม่เขียน

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

# โฟลเดอร์ที่ไฟล์ R01.102 ถูก export มาวาง
WATCH_FOLDER = r"C:\Users\BigYa-spare\Desktop\run-upload-stock"

# รูปแบบชื่อไฟล์ที่จะมองหา (เลือกไฟล์ที่ใหม่ที่สุด)
FILE_GLOB = "Allstock*.csv"

# Firebase project (จาก index.html FIREBASE_CONFIG)
PROJECT_ID = "stock-count-1d6e7"
API_KEY    = "AIzaSyDba_44vuyh-DyXeSYUoppm925oFCfr010"

# Col D (index 3) -> รหัสสาขา.  เทียบแบบ lower-case + ตัดช่องว่างซ้ำ
BRANCH_MAP = {
    "front store": "SRC",
    "main kkl":    "KKL",
    "main sss":    "SSS",
}

# ค่า Col D ที่ "ตั้งใจข้าม" (ไม่ใช่ของผิด) — เช่น WH ที่จัดการ R01 แยกต่างหาก
IGNORE_BRANCHES = {"warehouse"}

# index คอลัมน์ (ตรงกับ loadR01 ใน index.html)
COL_BRANCH = 3   # D
COL_SKU    = 4   # E
COL_NAME   = 5   # F
COL_QTY    = 6   # G

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
    g = str(g).replace(",", "").replace(" ", "").strip()
    if g == "":
        return 0
    try:
        v = float(g)
    except ValueError:
        return 0
    return int(v) if v == int(v) else v


def parse_file(path):
    with open(path, "rb") as f:
        raw = f.read()
    text = decode_bytes(raw)
    delim = sniff_delimiter(text)
    rows = list(csv.reader(io.StringIO(text), delimiter=delim))

    branches = {b: [] for b in set(BRANCH_MAP.values())}
    skipped_no_sku = 0
    skipped_qty = 0
    skipped_branch = 0
    skipped_ignored = 0
    unknown_branch_samples = set()

    # ข้าม header แถวแรก (เหมือน loadR01 ที่เริ่ม i=1)
    for r in rows[1:]:
        if not r or len(r) <= COL_QTY:
            continue
        d = norm(r[COL_BRANCH]) if len(r) > COL_BRANCH else ""
        sku = str(r[COL_SKU]).strip()
        name = str(r[COL_NAME]).strip()
        qty = parse_qty(r[COL_QTY])

        if not sku:
            skipped_no_sku += 1
            continue
        if qty <= 0:
            skipped_qty += 1
            continue

        if d in IGNORE_BRANCHES:
            skipped_ignored += 1
            continue

        branch = BRANCH_MAP.get(d)
        if branch is None:
            skipped_branch += 1
            if len(unknown_branch_samples) < 8 and r[COL_BRANCH].strip():
                unknown_branch_samples.add(r[COL_BRANCH].strip())
            continue

        branches[branch].append({"colE": sku, "productName": name, "systemQty": qty})

    return branches, {
        "skipped_no_sku": skipped_no_sku,
        "skipped_qty": skipped_qty,
        "skipped_branch": skipped_branch,
        "skipped_ignored": skipped_ignored,
        "unknown_branch_samples": sorted(unknown_branch_samples),
        "delimiter": repr(delim),
    }


def thai_ts(dt):
    """ตรงกับ formatThaiDateTime ใน index.html:  HH:MM น. DD/MM/YYYY"""
    return f"{dt:%H:%M} น. {dt:%d/%m/%Y}"


def write_branch(branch, items, dry_run):
    data_json = json.dumps(items, ensure_ascii=False)
    uploaded_at = thai_ts(datetime.now())
    updated_at_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")

    size_kb = len(data_json.encode("utf-8")) / 1024
    if dry_run:
        log(f"  [DRY] {branch}_r01: {len(items)} รายการ ({size_kb:.0f} KB)  — ไม่เขียน")
        return True

    if size_kb > 1000:
        log(f"  ⚠️ {branch}_r01 ใหญ่ {size_kb:.0f} KB เกิน limit Firestore 1 MiB อาจถูกปฏิเสธ")

    url = (
        f"https://firestore.googleapis.com/v1/projects/{PROJECT_ID}"
        f"/databases/(default)/documents/stock_sessions/{branch}_r01?key={API_KEY}"
    )
    body = {
        "fields": {
            "data_json":     {"stringValue": data_json},
            "r01UploadedAt": {"stringValue": uploaded_at},
            "updated_at":    {"timestampValue": updated_at_iso},
        }
    }
    payload = json.dumps(body).encode("utf-8")
    # PATCH โดยไม่ส่ง updateMask = แทนที่ทั้ง document (เทียบเท่า .set() ในเว็บ)
    req = urllib.request.Request(url, data=payload, method="PATCH",
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            resp.read()
        log(f"  ✅ {branch}_r01: เขียน {len(items)} รายการ ({size_kb:.0f} KB) สำเร็จ")
        return True
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")
        log(f"  ❌ {branch}_r01: HTTP {e.code} — {detail[:400]}")
        return False
    except Exception as e:
        log(f"  ❌ {branch}_r01: {e}")
        return False


def main():
    dry_run = "--dry-run" in sys.argv or "-n" in sys.argv

    log(f"เริ่มงาน auto R01 import  (dry_run={dry_run})")
    log(f"โฟลเดอร์: {WATCH_FOLDER}")

    path = find_latest_file()
    if not path:
        log(f"❌ ไม่พบไฟล์ตรงรูปแบบ '{FILE_GLOB}' ในโฟลเดอร์ — ยกเลิก")
        sys.exit(2)

    mtime = datetime.fromtimestamp(os.path.getmtime(path))
    log(f"ไฟล์ล่าสุด: {os.path.basename(path)}  (แก้ไขล่าสุด {mtime:%Y-%m-%d %H:%M})")
    if mtime.date() != datetime.now().date():
        log("⚠️ ไฟล์ไม่ได้ถูกแก้ไขวันนี้ — อาจเป็นข้อมูลเก่า (export ใหม่อาจยังไม่มา). ดำเนินการต่อ")

    branches, stats = parse_file(path)
    log(f"delimiter={stats['delimiter']}  "
        f"ข้าม: ไม่มี SKU={stats['skipped_no_sku']}, qty<=0={stats['skipped_qty']}, "
        f"WH/ignore={stats['skipped_ignored']}, สาขาไม่รู้จัก={stats['skipped_branch']}")
    if stats["unknown_branch_samples"]:
        log(f"⚠️ Col D ที่ map ไม่ได้ (ตัวอย่าง): {stats['unknown_branch_samples']}")

    total = sum(len(v) for v in branches.values())
    if total == 0:
        log("❌ ไม่มีรายการที่ใช้ได้เลย — ตรวจสอบคอลัมน์ / สาขา ใน CSV. ยกเลิก (ไม่เขียน Firestore)")
        sys.exit(3)

    ok = True
    for branch in sorted(branches):
        items = branches[branch]
        if not items:
            log(f"  ⚠️ {branch}: 0 รายการ — ข้าม (ไม่เขียนทับของเดิมด้วยค่าว่าง)")
            continue
        if not write_branch(branch, items, dry_run):
            ok = False

    log("เสร็จสิ้น" if ok else "เสร็จแบบมีข้อผิดพลาด (ดู log ด้านบน)")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
