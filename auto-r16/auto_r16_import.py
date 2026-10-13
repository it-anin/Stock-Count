#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Auto R16.104 importer  ->  Firestore  (Stock Count · สาขายา SRC / KKL / SSS)

อ่าน R16104.CSV ที่บอท BOTR16104 (ProMaxx GUI automation) export ไว้ใน Desktop\\run-upload-stock
(เอกสารจ่ายของ "วันนี้" ของ 3 สาขาในไฟล์เดียว: SYSBRANCHID 0=ชากค้อ(SRC) · 4=เก้ากิโล(KKL) · 5=ศรีราชา(SSS))
แล้วเขียน "timeline R16.104" ของแต่ละสาขาขึ้น Firestore ให้ Desktop สาขายาโหลดเอง (แทนการ export + อัปที่การ์ด R16.104)

  stock_sessions/{branch}_r16_104_{generation}_{index}   chunks  (รูปแบบเดียวกับ WH_r16_104_*)
  stock_sessions/{branch}_r16_104_meta                    meta    (ready/version/generation/chunkCount/r01Version/countResetAt/...)
  stock_sessions/{branch}_r01                             master  (เฉพาะ r16Loaded / r16UploadedAt / r16DetailVersion — เขียนเป็นขั้นสุดท้าย)

ทำไมต้องเป็น timeline ไม่ใช่ยอดรวม: สาขายาตัดสิน Confirm ด้วยยอดขาย "ก่อนเวลาสแกน" ของแต่ละ SKU (getSoldQtyBefore)
ถ้าไม่มี raw timeline จะบวกยอดขายทั้งวัน → Stock Adj ปลอมลง ERP — ดู CLAUDE.md §R16 timeline บน Cloud ของสาขายา

⚠️ ตรรกะ parse ถูกเขียนไว้ 2 ภาษา (JS loadR16() ใน index.html · Python ในไฟล์นี้) หลุดจากกันเมื่อไร Confirm ผิดแบบเงียบ
   แก้ที่ใดที่หนึ่งต้องแก้อีกที่เสมอ แล้วรัน:  cd tests && npm run test:logic -- auto-r16-parity
   (เทสนั้นเทียบ "สตริง JSON ของ chunk" ที่จะเขียนลง Firestore กับของจริงจาก loadR16 ทุกไบต์)
⚠️ ห้ามเปลี่ยนชื่อ/signature ของ build_timeline() · serialize_chunks() · build_barcode_map() — เทส parity import ตรงๆ
⚠️ import ไฟล์นี้ต้องไม่มี side effect (ไม่ตรวจ argv ตอน import) — flag แปลกปลอมตรวจใน main() เท่านั้น

ใช้ Python stdlib ล้วน — ไม่ต้องลง pip อะไรเพิ่ม

วิธีรัน:
    python auto_r16_import.py                    # โหมดจริง — เขียนขึ้น Firestore เมื่อเนื้อหาเปลี่ยน
    python auto_r16_import.py --dry-run          # ทดสอบ — อ่าน Firestore + พิมพ์ตัวเลขให้ดู ไม่เขียนอะไรเลย
    python auto_r16_import.py --branch SRC       # ทำเฉพาะบางสาขา (คั่นด้วยจุลภาคได้ เช่น SRC,KKL)
    python auto_r16_import.py --force            # ข้ามด่านวันที่/ไฟล์นิ่ง (ใช้ตอนทดสอบเท่านั้น)

ตั้งเวลารันทุกวัน 21:00 ด้วย Windows Task Scheduler (ดู README.md) — ตัวสคริปต์ไม่สนใจว่าถูกเรียกกี่โมง
ดูอย่างเดียวว่าไฟล์เป็นของวันนี้หรือยัง และนิ่งแล้วหรือยัง

exit code: 0 สำเร็จ/เนื้อหาเหมือนเดิม · 1 อ่าน/เขียน Firestore ล้ม · 2 ไฟล์/โฟลเดอร์/flag ผิด · 4 ตกด่าน (ไม่เขียน) · 9 ไม่พบ Python (.bat)
"""

import sys
import os
import csv
import io
import re
import json
import glob
import hashlib
import random
import time
import urllib.request
import urllib.error
import urllib.parse
from datetime import datetime, timezone, timedelta

# บังคับ console เป็น UTF-8 (กัน emoji/ภาษาไทย crash บน Windows cp874)
try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass

# ============================================================
#  CONFIG
# ============================================================

# โฟลเดอร์ที่ BOTR16104 export ไฟล์ลง — หาตามลำดับเดียวกับบอทตัวอื่น (ดู resolve_watch_folder):
#   1. --folder "<path>"  2. ตัวแปรระบบ AUTO_R16_WATCH_FOLDER  3. <โฟลเดอร์ผู้ใช้>\Desktop\run-upload-stock
DEFAULT_WATCH_FOLDER = os.path.join(os.path.expanduser("~"), "Desktop", "run-upload-stock")

# ⚠️ ต้องกรอง ".part." ออกเสมอ — BOTR16104 เขียน "R16104.part.CSV" ก่อนแล้วค่อยเปลี่ยนชื่อเมื่อตรวจผ่าน
FILE_GLOB = "R16104*.CSV"
PART_MARKER = ".part."

# ไฟล์ที่เพิ่งถูกแก้ไม่ถึงกี่วินาที = อาจกำลังเขียนอยู่ (ปกติ BOTR16104 เขียน .part แล้ว move จึงไม่น่าเจอ — กันเหนียว)
STABLE_SECONDS = 60

# Firebase project (จาก index.html FIREBASE_CONFIG · ค่าเดียวกับบอทตัวอื่น)
PROJECT_ID = "stock-count-1d6e7"
API_KEY = "AIzaSyDba_44vuyh-DyXeSYUoppm925oFCfr010"

# เวลาไทย (UTC+7 ไม่มี DST) — "วันนี้" ของไฟล์/R01 ตัดสินด้วยเขตเวลานี้เสมอ ไม่ขึ้นกับ timezone ของเครื่อง
BKK = timezone(timedelta(hours=7))

# SYSBRANCHID + ชื่อสาขาใน NAME (คอลัมน์ 31) — ตรวจทั้งสองอย่าง id หรือชื่อเพี้ยน = ปฏิเสธสาขานั้น
# (id 0 = "อนิน สาขาแยกชากค้อ" มีทั้งหน้าร้าน SRC (Col A=1) และคลัง WH (Col A=0) ปนกัน — WH ไม่อยู่ในงานนี้
#  แถวคลังยังถูกส่งให้ SRC ตามกติกาเดิมของ loadR16 ของแอป (ORCM/OCTM Col A=0 บวกกลับ · OTFI/OTFB Col A=0 ข้าม))
BRANCHES = {
    "SRC": {"sysbranchid": "0", "name": "อนิน สาขาแยกชากค้อ"},
    "KKL": {"sysbranchid": "4", "name": "อนิน สาขาเก้ากิโล"},
    "SSS": {"sysbranchid": "5", "name": "อนิน สาขาสวนเสือศรีราชา"},
}

# index คอลัมน์ที่ loadR16 อ่านด้วยเลขตายตัว (+ NAME ที่บอทใช้ตรวจชื่อสาขา) · TRANDATE หาจากชื่อหัวเหมือน loadR16
COL_WAREHOUSE = 0     # SYSWAREHOUSEID — Col A
COL_TRANNO = 2        # Col C
COL_CANCEL = 9        # FCANCEL — Col J ('1' = บิลยกเลิก)
COL_BRANCH = 12       # SYSBRANCHID
COL_BARCODE = 14      # SCANCODE — Col O
COL_QTY = 17          # BASEQUANTITY — Col R
COL_SKU = 23          # ITEMID — Col X
COL_NAME = 31         # NAME (ชื่อสาขา)
EXPECTED_HEADERS = {
    COL_WAREHOUSE: "SYSWAREHOUSEID",
    COL_TRANNO: "TRANNO",
    COL_CANCEL: "FCANCEL",
    COL_BRANCH: "SYSBRANCHID",
    COL_BARCODE: "SCANCODE",
    COL_QTY: "BASEQUANTITY",
    COL_SKU: "ITEMID",
    COL_NAME: "NAME",
}

# ต้องตรงกับ R16_*_PREFIXES ใน index.html (ถ้าแอปเพิ่ม prefix ต้องเพิ่มที่นี่ด้วย — เทส parity จะจับ)
R16_SALES_PREFIXES = ("ORCM", "OCTM")
R16_INBOUND_PREFIXES = ("OTFB", "ORTS", "OTFI")
R16_OUTBOUND_PREFIXES = ("OTFI",)

# ต้องตรงกับ WH_R16_CHUNK_TARGET_BYTES ใน index.html
CHUNK_TARGET_BYTES = 650 * 1024

# doc ใหญ่เกินนี้ (KB) ไม่เขียน — Firestore ปฏิเสธที่ 1 MiB (chunk แต่ละอันถูกคุมที่ 650 KB อยู่แล้ว · ด่านนี้กันของประหลาด)
MAX_CHUNK_KB = 950

# ============================================================


def log(msg):
    print(f"[{datetime.now():%Y-%m-%d %H:%M:%S}] {msg}", flush=True)


# ------------------------------------------------------------
#  ตัวช่วยที่ต้อง "เหมือน JS ทุกจุด" (parity)
# ------------------------------------------------------------

# JS String.prototype.trim / \s = WhiteSpace + LineTerminator
_JS_WS = ("\t\n\v\f\r \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a"
          "\u2028\u2029\u202f\u205f\u3000\ufeff")
_RE_WS_RUN = re.compile("[" + _JS_WS + "]+")
_RE_ZERO_WIDTH = re.compile("[\u200b-\u200d\ufeff]")
_RE_QTY_JUNK = re.compile("[," + _JS_WS + "]")


def js_trim(value):
    """.toString().trim() ของ JS — Python str.strip() ไม่เหมือน (นับ \\x1c-\\x1f/\\x85 เป็นช่องว่าง แต่ไม่นับ \\ufeff)"""
    return str(value if value is not None else "").strip(_JS_WS)


def col(row, i):
    """(r[i] ?? '') ของ JS — แถวสั้นกว่าที่คาดต้องได้สตริงว่าง ไม่ใช่ error"""
    return row[i] if 0 <= i < len(row) else ""


def normalize_barcode(b):
    """normalizeBarcode() ใน loadR16: ตัด zero-width · ยุบช่องว่าง · trim"""
    return js_trim(_RE_WS_RUN.sub(" ", _RE_ZERO_WIDTH.sub("", b)))


_RE_JS_DECIMAL = re.compile(r"[+-]?(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[eE][+-]?[0-9]+)?")
_RE_JS_INFINITY = re.compile(r"([+-]?)Infinity")


def _js_number(text):
    """Number(text) ของ JS — คืน None เมื่อ JS จะได้ NaN

    float() ของ Python ต่างจาก Number() หลายจุด จึงรับเฉพาะรูปแบบที่ JS รับ (ASCII ล้วน):
      · ทศนิยม/เลขชี้กำลัง '1.5' '.5' '5.' '1e3' · '' → 0 · เลขฐาน '0x10' '0b101' '0o17' (ไม่มีเครื่องหมาย)
      · 'Infinity' / '+Infinity' / '-Infinity' (ตัวพิมพ์ตรงเป๊ะ)
      · ปฏิเสธ: '1_0' · 'inf' · 'nan' · 'infinity' · เลขอาหรับ/ฟูลวิดท์ที่ float() ของ Python รับแต่ JS ได้ NaN
    """
    t = js_trim(text)
    if t == "":
        return 0.0
    if t[:2].lower() in ("0x", "0o", "0b"):
        if "_" in t or not t.isascii():
            return None
        try:
            return float(int(t, 0))
        except ValueError:
            return None
    m = _RE_JS_INFINITY.fullmatch(t)
    if m:
        return float("-inf") if m.group(1) == "-" else float("inf")
    if _RE_JS_DECIMAL.fullmatch(t):
        return float(t)
    return None


def _finite(v):
    return v is not None and v == v and v not in (float("inf"), float("-inf"))


def _js_num_out(v):
    """ทำให้ json.dumps เขียนตัวเลขเหมือน JSON.stringify — เลขลงตัวห้ามมี '.0' ต่อท้าย"""
    return int(v) if float(v) == int(v) else float(v)


def _utf16_key(s):
    """Array.prototype.sort() ของ JS เทียบ UTF-16 code unit — เหมือน Python เฉพาะ BMP"""
    return s.encode("utf-16-be", "surrogatepass")


def match_prefix(col_c, prefixes):
    return col_c.startswith(prefixes)


_TIME = r"(?:\s+([0-9]{1,2}):([0-9]{2})(?::([0-9]{2}))?\s*(AM|PM)?)?"
_RE_TH_DATE = re.compile(r"^([0-9]{1,2})/([0-9]{1,2})/([0-9]{4})" + _TIME.replace(r"\s", "[" + _JS_WS + "]"), re.I)
_RE_DMY_DATE = re.compile(r"^([0-9]{1,2})-([0-9]{1,2})-([0-9]{2,4})" + _TIME.replace(r"\s", "[" + _JS_WS + "]"), re.I)


def parse_tran_date(value):
    """parseTranDate() ของ index.html → datetime (naive · เวลาไทย) หรือ None ถ้าอ่านไม่ได้

    ใช้เฉพาะด่านวันที่ + ช่วงเวลาที่ไฟล์ครอบ — ตัว timeline เก็บ tranDate เป็น "สตริงดิบ" เหมือนแอป (ไม่ผ่านฟังก์ชันนี้)
    """
    if not value:
        return None
    s = js_trim(value)

    def build(y, mo, d, h, mi, se, ampm):
        try:
            hh = int(h)
            if ampm:
                ap = ampm.upper()
                if ap == "AM" and hh == 12:
                    hh = 0
                elif ap == "PM" and hh != 12:
                    hh += 12
            return datetime(int(y), int(mo), int(d), hh, int(mi), int(se or 0))
        except ValueError:
            return None

    m = _RE_TH_DATE.match(s)
    if m:
        if m.group(4):
            return build(m.group(3), m.group(2), m.group(1), m.group(4), m.group(5), m.group(6), m.group(7))
        return build(m.group(3), m.group(2), m.group(1), 23, 59, 59, None)
    m = _RE_DMY_DATE.match(s)
    if m:
        yr = m.group(3) if len(m.group(3)) != 2 else "20" + m.group(3)
        if m.group(4):
            return build(yr, m.group(2), m.group(1), m.group(4), m.group(5), m.group(6), m.group(7))
        return build(yr, m.group(2), m.group(1), 23, 59, 59, None)
    try:
        d = datetime.fromisoformat(s.replace(" ", "T"))
        return d.replace(tzinfo=None) if d.tzinfo else d
    except ValueError:
        return None


# ------------------------------------------------------------
#  อ่าน CSV
# ------------------------------------------------------------

def decode_bytes(raw):
    """เลียนแบบ parseFile() ใน index.html: UTF-8 BOM -> UTF-8 -> Windows-874 (cp874)"""
    if raw[:3] == b"\xef\xbb\xbf":
        return raw[3:].decode("utf-8", errors="replace")
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError:
        return raw.decode("cp874", errors="replace")


def parse_csv_text(text):
    """ตรงกับ Papa.parse(text,{header:false,skipEmptyLines:true,delimiter:',',quoteChar:'"'}).data

    ⛔ ห้ามเดา delimiter — parseFile ส่ง delimiter:',' ตายตัว (ไฟล์คั่นด้วย ; จะตกด่านหัวคอลัมน์ ซึ่งเป็นผลที่ถูกต้อง)
    """
    rows = list(csv.reader(io.StringIO(text), delimiter=",", quotechar='"'))
    return [r for r in rows if r and not (len(r) == 1 and r[0] == "")]


def read_rows(path):
    with open(path, "rb") as f:
        return parse_csv_text(decode_bytes(f.read()))


def header_problems(rows):
    """คืนลิสต์คำอธิบายคอลัมน์ที่ไม่ตรง — ว่าง = ผ่าน"""
    if not rows:
        return ["ไฟล์ว่าง ไม่มีแม้แต่แถวหัวตาราง"]
    head = rows[0]
    bad = []
    for idx, want in sorted(EXPECTED_HEADERS.items()):
        got = js_trim(col(head, idx)).upper()
        if got != want:
            bad.append(f"คอลัมน์ที่ {idx} ควรเป็น {want} แต่เจอ {got or '(ว่าง)'}")
    if tran_date_col(head) < 0:
        bad.append("ไม่พบคอลัมน์ TRANDATE ในหัวตาราง")
    return bad


def tran_date_col(head):
    """loadR16 หา TRANDATE จาก "ชื่อหัว" (ไม่สนตำแหน่ง) — คืน -1 ถ้าไม่เจอ"""
    for c in range(len(head)):
        if js_trim(head[c]).upper() == "TRANDATE":
            return c
    return -1


# ------------------------------------------------------------
#  แยกไฟล์ตามสาขา + ด่านระดับไฟล์
# ------------------------------------------------------------

def split_by_branch(rows):
    """แยกแถวข้อมูลตาม SYSBRANCHID — คืน (by_branch, unknown_ids, names)

    by_branch : {'SRC': [แถว...], ...} (ไม่รวมหัวตาราง · ลำดับเดิมในไฟล์)
    unknown_ids: {sysbranchid: จำนวนแถว} ของสาขาที่ไม่อยู่ใน BRANCHES (ข้ามเฉยๆ ไม่ใช่ error)
    names     : {sysbranchid: set ของ NAME ที่เจอ}
    """
    id_to_branch = {v["sysbranchid"]: k for k, v in BRANCHES.items()}
    by_branch = {k: [] for k in BRANCHES}
    unknown, names = {}, {}
    for r in rows[1:]:
        if not r:
            continue
        bid = js_trim(col(r, COL_BRANCH))
        names.setdefault(bid, set()).add(js_trim(col(r, COL_NAME)))
        b = id_to_branch.get(bid)
        if b:
            by_branch[b].append(r)
        else:
            unknown[bid] = unknown.get(bid, 0) + 1
    return by_branch, unknown, names


def file_date_problems(rows, today):
    """ทุกแถวที่ไม่ยกเลิกต้องมี TRANDATE อ่านได้และเป็นของวันนี้ — คืน (ปัญหา[], วันที่ที่ไม่ใช่วันนี้ {date: n})

    ไฟล์หลายวัน/ไฟล์เก่า = ยอดขายเมื่อวานซ้ำกับ R01 ของวันนี้ที่รวมไปแล้ว (บวกซ้ำ = Confirm ผิด)
    """
    td_idx = tran_date_col(rows[0]) if rows else -1
    other, unreadable = {}, 0
    for r in rows[1:]:
        if not r or js_trim(col(r, COL_CANCEL)) == "1":
            continue
        d = parse_tran_date(js_trim(col(r, td_idx))) if td_idx >= 0 else None
        if d is None:
            unreadable += 1
        elif d.date() != today:
            other[d.date().isoformat()] = other.get(d.date().isoformat(), 0) + 1
    problems = []
    if unreadable:
        problems.append(f"TRANDATE อ่านไม่ได้ {unreadable} แถว (รูปแบบวันที่เปลี่ยน?)")
    if other:
        sample = ", ".join(f"{k}×{v}" for k, v in sorted(other.items())[:5])
        problems.append(f"มีแถวที่ไม่ใช่วันนี้ ({today.isoformat()}): {sample}")
    return problems


# ------------------------------------------------------------
#  ตัวแปลง — พอร์ตจาก loadR16() ของ index.html (กติกา "สาขายา" non-WH เท่านั้น)
# ------------------------------------------------------------

def build_sku_set(pm_rows, r01_rows):
    """skuMap.keys() ของ rebuildMaps() = PBM ∪ R01 (R01 ที่ไม่อยู่ใน PBM ถูกเติมเป็น DEL · ไม่มี PBM = R01 ล้วน)

    pm_rows : {branch}_pm.data_json (แถวละ {sku,...}) · r01_rows : {branch}_r01.data_json (แถวละ {colE,...})
    ⚠️ ชื่อ/signature ถูก import ตรงๆ โดยเทส parity
    """
    sku_set = set()
    for r in pm_rows if isinstance(pm_rows, list) else []:
        s = r.get("sku") if isinstance(r, dict) else None
        if isinstance(s, str) and s:
            sku_set.add(s)
    for r in r01_rows if isinstance(r01_rows, list) else []:
        s = r.get("colE") if isinstance(r, dict) else None
        if isinstance(s, str) and s:
            sku_set.add(s)
    return sku_set


def build_barcode_map(r05_rows, sku_set):
    """barcodeMap ของ rebuildMaps(): R05 ที่ SKU อยู่ใน skuMap · barcode ซ้ำ = ตัวท้ายชนะ (Map.set)

    r05_rows: ผล JSON ของ global_r05.data_json (array-of-arrays 'r05a1' หรือ object รุ่นเก่า)
    """
    out = {}
    for r in r05_rows or []:
        if isinstance(r, list):
            barcode, sku = (r[0] if len(r) > 0 else None), (r[1] if len(r) > 1 else None)
        elif isinstance(r, dict):
            barcode, sku = r.get("barcode"), r.get("colE")
        else:
            continue
        if not barcode or not sku:   # .filter(r=>r.barcode&&r.colE) ของ _parseR05Json
            continue
        if sku in sku_set:
            out[barcode] = sku
    return out


def build_timeline(rows, branch, sku_set, barcode_map):
    """ตรงกับ loadR16() + _whR16Rows('104') — คืน (timeline_rows, stats)

    rows       : [หัวตาราง, แถวข้อมูลของ "สาขานี้" ...] (ผ่าน split_by_branch มาแล้ว · แอปไม่กรองสาขาเอง)
    branch     : 'SRC' | 'KKL' | 'SSS' (กติกา SRC พิเศษเฉพาะ OTFB/OTFI — ดู isSrcOtfb / isSrcOtfiSkip ใน loadR16)
    sku_set    : skuMap.keys() = PBM ∪ R01 ของสาขา
    barcode_map: ผล build_barcode_map()
    timeline_rows: [[sku, ขายรวม, รับเข้ารวม, [{soldQty,tranDate}...], [{qty,tranDate}...]], ...] เรียงตาม SKU
    ⚠️ ชื่อ/signature ถูก import ตรงๆ โดย tests/specs/logic/auto-r16-parity.spec.js
    """
    if branch not in BRANCHES:
        raise ValueError(f"สาขาไม่รู้จัก: {branch}")
    head = rows[0] if rows else []
    td_idx = tran_date_col(head)
    is_src = branch == "SRC"
    stats = {"file_rows": max(0, len(rows) - 1), "cancelled": 0, "skipped_prefix": 0, "skipped_blank": 0,
             "kept": 0, "matched": 0, "missing": 0, "mismatch": 0,
             "sales_total": 0.0, "inbound_total": 0.0, "min_td": None, "max_td": None}

    kept = []
    for r in rows[1:]:
        if not r:
            continue
        col_c = js_trim(col(r, COL_TRANNO)).upper()
        col_a = js_trim(col(r, COL_WAREHOUSE))
        if js_trim(col(r, COL_CANCEL)) == "1":      # FCANCEL — บิลยกเลิก สินค้าไม่ได้ออกจากชั้นจริง
            stats["cancelled"] += 1
            continue
        is_sale = match_prefix(col_c, R16_SALES_PREFIXES)
        is_src_otfb = is_src and col_c.startswith("OTFB")
        is_src_otfb_out = is_src_otfb and col_a == "1"
        is_src_otfb_skip = is_src_otfb and col_a != "1"
        is_src_otfi_skip = is_src and col_c.startswith("OTFI") and col_a != "1"
        is_outbound = (match_prefix(col_c, R16_OUTBOUND_PREFIXES) and col_a == "1") or is_src_otfb_out
        is_inbound = (match_prefix(col_c, R16_INBOUND_PREFIXES) and not is_outbound
                      and not is_src_otfb_skip and not is_src_otfi_skip)
        if not is_sale and not is_inbound and not is_outbound:
            stats["skipped_prefix"] += 1
            continue
        barcode = js_trim(col(r, COL_BARCODE))
        raw_qty = _RE_QTY_JUNK.sub("", str(col(r, COL_QTY))).strip(_JS_WS)
        sku_r16 = js_trim(col(r, COL_SKU))
        if not barcode or raw_qty == "":
            stats["skipped_blank"] += 1
            continue
        n = _js_number(raw_qty)
        sold = n if (_finite(n) and n > 0) else 0.0
        tran_date = js_trim(col(r, td_idx)) if td_idx >= 0 else ""
        kept.append((barcode, sold, sku_r16, tran_date, is_inbound))
    stats["kept"] = len(kept)

    sales, sales_raw, inbound, inbound_raw = {}, {}, {}, {}
    for barcode, sold, sku_r16, tran_date, is_inbound in kept:
        bc = normalize_barcode(barcode)
        sku = barcode_map.get(bc) or barcode_map.get(bc.upper()) or barcode_map.get(bc.lower())
        if not sku and sku_r16 and sku_r16 in sku_set:
            sku = sku_r16
        if not sku:
            stats["missing"] += 1
            continue
        if sku_r16 and sku_r16 != sku:
            stats["mismatch"] += 1
        if sku not in sku_set:
            stats["missing"] += 1
            continue
        if is_inbound:
            inbound[sku] = (inbound.get(sku) or 0) + sold
            inbound_raw.setdefault(sku, []).append({"qty": sold, "tranDate": tran_date or ""})
            stats["inbound_total"] += sold
        else:
            sales[sku] = (sales.get(sku) or 0) + sold
            sales_raw.setdefault(sku, []).append({"soldQty": sold, "tranDate": tran_date or ""})
            stats["sales_total"] += sold
        stats["matched"] += 1

    # ช่วงเวลาที่ไฟล์ครอบ — นับจาก "แถวที่ผ่านด่านประเภท/บาร์โค้ด" (เหมือน state.r16Data ของ loadR16 · ไม่ขึ้นกับว่าจับคู่ SKU ได้ไหม)
    for _bc, _sold, _sku, tran_date, _inb in kept:
        d = parse_tran_date(tran_date) if tran_date else None
        if d:
            if stats["min_td"] is None or d < stats["min_td"]:
                stats["min_td"] = d
            if stats["max_td"] is None or d > stats["max_td"]:
                stats["max_td"] = d

    keys = set(sales) | set(inbound) | set(sales_raw) | set(inbound_raw)
    timeline = [[sku, sales.get(sku) or 0, inbound.get(sku) or 0,
                 sales_raw.get(sku) or [], inbound_raw.get(sku) or []]
                for sku in sorted(keys, key=_utf16_key)]
    stats["sales_skus"] = len(sales)
    stats["inbound_skus"] = len(inbound)
    return timeline, stats


def _row_json(row):
    sku, s, i, raw_s, raw_i = row
    compact = [sku, _js_num_out(s), _js_num_out(i),
               [{"soldQty": _js_num_out(x["soldQty"]), "tranDate": x["tranDate"]} for x in raw_s],
               [{"qty": _js_num_out(x["qty"]), "tranDate": x["tranDate"]} for x in raw_i]]
    return json.dumps(compact, ensure_ascii=False, separators=(",", ":"))


def serialize_chunks(timeline_rows, target_bytes=CHUNK_TARGET_BYTES):
    """ตรงกับ _chunkWhR16Rows() ใน index.html ทุกไบต์ (รวมจุดแปลก: +1 ของคอมมาถูกนับกับแถวแรกของ chunk ใหม่ด้วย)

    คืนลิสต์สตริง JSON ของแต่ละ chunk — ว่าง = ไม่มีแถว (chunkCount 0)
    ⚠️ ชื่อ/signature ถูก import ตรงๆ โดยเทส parity
    """
    chunks, parts, size = [], [], 2
    for row in timeline_rows:
        part = _row_json(row)
        part_bytes = len(part.encode("utf-8")) + (1 if parts else 0)
        if parts and size + part_bytes > target_bytes:
            chunks.append("[" + ",".join(parts) + "]")
            parts, size = [], 2
        if part_bytes + 2 > target_bytes:
            raise ValueError(f"R16 row ใหญ่เกิน chunk: {row[0]}")
        parts.append(part)
        size += part_bytes
    if parts:
        chunks.append("[" + ",".join(parts) + "]")
    return chunks


# ------------------------------------------------------------
#  Firestore REST
# ------------------------------------------------------------

def _doc_url(doc_id, query=""):
    return (f"https://firestore.googleapis.com/v1/projects/{PROJECT_ID}"
            f"/databases/(default)/documents/stock_sessions/{urllib.parse.quote(doc_id, safe='')}?{query}key={API_KEY}")


def _request(req, timeout=120, retries=3):
    """urlopen + ลองใหม่เมื่อเน็ตสะดุด/เซิร์ฟเวอร์ตอบ 429/5xx · 4xx อื่น (รวม 404) โยนทันที"""
    last = None
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return resp.read()
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 502, 503, 504) and attempt + 1 < retries:
                last = e
                time.sleep(2 * (attempt + 1))
                continue
            raise
        except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
            if attempt + 1 < retries:
                last = e
                time.sleep(2 * (attempt + 1))
                continue
            raise
    raise last  # pragma: no cover


def get_doc(doc_id, fields=None):
    """อ่าน doc — คืน dict ของ fields (รูปแบบ typed ของ REST) หรือ None ถ้าไม่มี doc"""
    mask = "".join(f"mask.fieldPaths={urllib.parse.quote(f)}&" for f in (fields or []))
    try:
        raw = _request(urllib.request.Request(_doc_url(doc_id, mask)), timeout=120)
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None
        raise
    return json.loads(raw.decode("utf-8")).get("fields") or {}


def patch_doc(doc_id, typed_fields, mask_fields):
    """PATCH + updateMask — เขียนเฉพาะ field ที่ระบุ (ห้ามเขียนแบบไม่มี mask: จะ replace ทั้ง document)"""
    mask = "".join(f"updateMask.fieldPaths={urllib.parse.quote(f)}&" for f in mask_fields)
    body = json.dumps({"fields": typed_fields}).encode("utf-8")
    req = urllib.request.Request(_doc_url(doc_id, mask), data=body, method="PATCH",
                                 headers={"Content-Type": "application/json"})
    _request(req, timeout=180)


def delete_doc(doc_id):
    req = urllib.request.Request(_doc_url(doc_id), method="DELETE")
    try:
        _request(req, timeout=60)
    except urllib.error.HTTPError as e:
        if e.code != 404:
            raise


def S(v):
    return {"stringValue": str(v)}


def I(v):
    return {"integerValue": str(int(v))}


def B(v):
    return {"booleanValue": bool(v)}


def T(dt):
    return {"timestampValue": dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")}


def f_str(fields, key, default=""):
    return ((fields or {}).get(key) or {}).get("stringValue", default)


def f_bool(fields, key):
    return bool(((fields or {}).get(key) or {}).get("booleanValue", False))


def f_ts(fields, key):
    return ((fields or {}).get(key) or {}).get("timestampValue", "")


def thai_ts(dt):
    """ตรงกับ formatThaiDateTime ใน index.html:  HH:MM น. DD/MM/YYYY"""
    return f"{dt:%H:%M} น. {dt:%d/%m/%Y}"


def iso_utc_ms():
    """ต้องเทียบ lexicographic ได้กับที่ new Date().toISOString() ผลิต (มิลลิวินาที + Z)"""
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def new_generation():
    """เหมือน `${Date.now().toString(36)}${Math.random().toString(36).slice(2,8)}`"""
    digits = "0123456789abcdefghijklmnopqrstuvwxyz"

    def b36(n):
        s = ""
        while n:
            n, r = divmod(n, 36)
            s = digits[r] + s
        return s or "0"
    return b36(int(time.time() * 1000)) + "".join(random.choice(digits) for _ in range(6))


# ------------------------------------------------------------
#  อ่านข้อมูลอ้างอิงของแต่ละสาขา
# ------------------------------------------------------------

_RE_THAI_TS = re.compile(r"([0-9]{1,2}):([0-9]{2})\s*น\.\s*([0-9]{1,2})/([0-9]{1,2})/([0-9]{4})")


def r01_date_of(fields):
    """วันที่ (เวลาไทย) ที่ R01 ของสาขาถูกอัปล่าสุด — อ่านจาก r01UploadedAt ('HH:MM น. DD/MM/YYYY') ถอยไป updated_at"""
    text = f_str(fields, "r01UploadedAt")
    m = _RE_THAI_TS.search(text or "")
    if m:
        try:
            return datetime(int(m.group(5)), int(m.group(4)), int(m.group(3))).date()
        except ValueError:
            pass
    ts = f_ts(fields, "updated_at")
    if ts:
        try:
            return datetime.fromisoformat(ts.replace("Z", "+00:00")).astimezone(BKK).date()
        except ValueError:
            pass
    return None


def load_r05_rows():
    """global_r05.data_json → list (รูปแบบ r05a1 หรือ object รุ่นเก่า) · ไม่มี doc = None"""
    f = get_doc("global_r05", ["data_json"])
    if f is None:
        return None
    arr = json.loads(f_str(f, "data_json") or "[]")
    return arr if isinstance(arr, list) else []


def load_branch_catalog(branch):
    """อ่านทุกอย่างที่สาขาต้องใช้ — คืน dict หรือ None ถ้าไม่มี R01 ของสาขา"""
    r01 = get_doc(f"{branch}_r01")
    if r01 is None:
        return None
    try:
        r01_rows = json.loads(f_str(r01, "data_json") or "[]")
    except ValueError:
        r01_rows = []
    pm = get_doc(f"{branch}_pm", ["data_json"])
    try:
        pm_rows = json.loads(f_str(pm, "data_json") or "[]") if pm is not None else []
    except ValueError:
        pm_rows = []
    session = get_doc(branch, ["session_data_json"])
    epoch = ""
    if session is not None:
        try:
            epoch = (json.loads(f_str(session, "session_data_json") or "{}") or {}).get("countResetAt", "") or ""
        except ValueError:
            epoch = ""
    sku_set = build_sku_set(pm_rows, r01_rows)
    return {"r01_fields": r01, "r01_version": f_str(r01, "r01Version"), "sku_set": sku_set,
            "r01_rows": len(r01_rows) if isinstance(r01_rows, list) else 0,
            "pm_rows": len(pm_rows) if isinstance(pm_rows, list) else 0, "epoch": epoch}


# ------------------------------------------------------------
#  เขียนขึ้น Firestore (ลำดับสำคัญ: chunks → meta → master)
# ------------------------------------------------------------

def publish_branch(branch, chunks, meta_fields, r01_version, uploaded_at_text, version, generation, old_meta):
    """เขียน timeline ของสาขาเดียว — ล้มกลางทางจะลบ chunk รุ่นที่เพิ่งเขียน (best-effort) และโยน exception

    ลำดับห้ามสลับ: ผู้อ่าน (_loadPharmacyR16Timeline) เชื่อ "master ประกาศเวอร์ชันนี้แล้ว = chunks พร้อมแล้ว"
    """
    written = []
    try:
        now = datetime.now(timezone.utc)
        for i, c in enumerate(chunks):
            doc_id = f"{branch}_r16_104_{generation}_{i:04d}"
            patch_doc(doc_id, {
                "data_json": S(c), "kind": S("104"), "version": S(version), "generation": S(generation),
                "index": I(i), "countResetAt": S(meta_fields["countResetAt"]), "updatedAt": T(now),
            }, ["data_json", "kind", "version", "generation", "index", "countResetAt", "updatedAt"])
            written.append(doc_id)
        meta_typed = {
            "ready": B(True), "kind": S("104"), "version": S(version), "generation": S(generation),
            "chunkCount": I(len(chunks)), "rowCount": I(meta_fields["rowCount"]),
            "countResetAt": S(meta_fields["countResetAt"]), "r01Version": S(r01_version),
            "uploadedAtText": S(uploaded_at_text), "dateMismatch": B(False), "dateMismatchDetail": S(""),
            "updatedAt": T(now), "source": S("auto-r16"), "contentHash": S(meta_fields["contentHash"]),
            "sourceFile": S(meta_fields["sourceFile"]), "sourceMtime": T(meta_fields["sourceMtime"]),
            "machine": S(os.environ.get("COMPUTERNAME", "?")),
        }
        patch_doc(f"{branch}_r16_104_meta", meta_typed, list(meta_typed))
        # R01 เปลี่ยนระหว่างทาง (มีคนอัป R01 ใหม่) = timeline นี้ผูกกับ R01 เก่า ห้ามประกาศ — ยกเลิกทั้งสาขา
        recheck = get_doc(f"{branch}_r01", ["r01Version"])
        if recheck is None or f_str(recheck, "r01Version") != r01_version:
            raise RuntimeError("R01 ของสาขาเปลี่ยนระหว่างเขียน — ยกเลิกไม่ประกาศ timeline นี้")
        patch_doc(f"{branch}_r01", {"r16Loaded": B(True), "r16UploadedAt": S(uploaded_at_text),
                                    "r16DetailVersion": S(version)},
                  ["r16Loaded", "r16UploadedAt", "r16DetailVersion"])
    except Exception:
        # ล้มก่อนประกาศ: ลบ chunk รุ่นที่เพิ่งเขียน แล้วคืน meta เดิม (ไม่งั้น meta ชี้รุ่นใหม่ที่ไม่มีใครประกาศ
        # → Desktop ที่ login ใหม่หา timeline ของรุ่นที่ master ยังชี้อยู่ไม่เจอ) — ทั้งหมด best-effort
        for doc_id in written:
            try:
                delete_doc(doc_id)
            except Exception:
                pass
        try:
            if old_meta:
                patch_doc(f"{branch}_r16_104_meta", old_meta, list(old_meta))
            elif written:
                delete_doc(f"{branch}_r16_104_meta")
        except Exception:
            pass
        raise
    # ประกาศแล้ว — เก็บกวาดรุ่นเก่า (ล้มไม่ถือว่างานล้ม: เหลือแค่ doc เล็กที่ไม่มีใครอ่าน)
    old_gen, old_count = f_str(old_meta, "generation"), int(((old_meta or {}).get("chunkCount") or {}).get("integerValue", 0) or 0)
    if old_gen and old_gen != generation:
        for i in range(old_count):
            try:
                delete_doc(f"{branch}_r16_104_{old_gen}_{i:04d}")
            except Exception as e:
                log(f"  ⚠️ ลบ chunk เก่าไม่สำเร็จ ({e}) — ไม่กระทบ")
                break


# ------------------------------------------------------------
#  main
# ------------------------------------------------------------

USAGE = ("ใช้: python auto_r16_import.py [--dry-run|-n] [--force] [--folder <path>] [--branch SRC,KKL,SSS]\n"
         "     (ไม่มี flag = โหมดจริง · flag อื่นจะถูกปฏิเสธ — กันตัวเก่าเมินแล้วเขียนจริง)")


def parse_args(argv):
    """คืน dict หรือโยน SystemExit(2) เมื่อเจอ flag ที่ไม่รู้จัก — เรียกจาก main() เท่านั้น (ห้ามเรียกตอน import)"""
    opts = {"dry_run": False, "force": False, "folder": None, "branches": list(BRANCHES)}
    i = 0
    while i < len(argv):
        a = argv[i]
        if a in ("--dry-run", "-n"):
            opts["dry_run"] = True
        elif a == "--force":
            opts["force"] = True
        elif a in ("-h", "--help"):
            print(USAGE)
            raise SystemExit(0)
        elif a == "--folder" and i + 1 < len(argv):
            opts["folder"] = argv[i + 1]
            i += 1
        elif a.startswith("--folder="):
            opts["folder"] = a.split("=", 1)[1]
        elif a == "--branch" and i + 1 < len(argv):
            opts["branches"] = [x.strip().upper() for x in argv[i + 1].split(",") if x.strip()]
            i += 1
        elif a.startswith("--branch="):
            opts["branches"] = [x.strip().upper() for x in a.split("=", 1)[1].split(",") if x.strip()]
        else:
            log(f"❌ flag ไม่รู้จัก: {a}")
            log(USAGE)
            raise SystemExit(2)
        i += 1
    bad = [b for b in opts["branches"] if b not in BRANCHES]
    if bad or not opts["branches"]:
        log(f"❌ --branch ต้องเป็น {', '.join(BRANCHES)} (เจอ: {', '.join(bad) or '(ว่าง)'})")
        raise SystemExit(2)
    return opts


def resolve_watch_folder(folder_arg):
    if folder_arg:
        return folder_arg, "--folder"
    env = os.environ.get("AUTO_R16_WATCH_FOLDER", "").strip()
    if env:
        return env, "AUTO_R16_WATCH_FOLDER"
    return DEFAULT_WATCH_FOLDER, "ค่าปกติ (โฟลเดอร์ผู้ใช้ปัจจุบัน)"


def find_latest_file(folder):
    files = glob.glob(os.path.join(folder, FILE_GLOB)) or glob.glob(os.path.join(folder, FILE_GLOB.lower()))
    files = [f for f in files if PART_MARKER not in os.path.basename(f).lower()]
    if not files:
        return None
    files.sort(key=os.path.getmtime, reverse=True)
    return files[0]


def _fmt_td(d):
    return f"{d:%d/%m %H:%M}"


def process_branch(branch, rows_by_branch, names, header, r05_rows, path, mtime, opts, today):
    """คืน 'written' | 'unchanged' | 'dry' (โหมด --dry-run ที่จะเขียน) | 'skipped' (ตกด่าน) | 'failed' (Firestore ล้ม)"""
    cfg = BRANCHES[branch]
    dry_run, force = opts["dry_run"], opts["force"]
    own_rows = rows_by_branch.get(branch) or []
    log(f"── {branch} (SYSBRANCHID {cfg['sysbranchid']}) ──")

    # ด่านสาขา 1: id ต้องมาพร้อมชื่อที่ถูก · ต้องมีแถวของสาขานี้
    seen = names.get(cfg["sysbranchid"], set())
    if seen and seen != {cfg["name"]}:
        log(f"  ❌ ชื่อสาขาในไฟล์ไม่ตรง (คาด '{cfg['name']}' เจอ {sorted(seen)}) — ProMaxx อาจเปลี่ยนรหัสสาขา · ข้ามสาขานี้")
        return "skipped"
    if not own_rows:
        log("  ❌ ไม่มีแถวของสาขานี้ในไฟล์ (export ไม่ครอบสาขา หรือวันนี้ไม่มีเอกสารจ่ายเลย) — ข้ามสาขานี้ · อัปมือที่การ์ด R16.104 ได้")
        return "skipped"

    try:
        cat = load_branch_catalog(branch)
    except Exception as e:
        log(f"  ❌ อ่านข้อมูลสาขาจาก Firestore ไม่ได้: {e}")
        return "failed"

    # ด่านสาขา 2: ต้องมี R01 + R05
    if cat is None or not cat["r01_version"]:
        log(f"  ❌ ไม่มี R01 ของสาขา ({branch}_r01) — เกิดได้เมื่อกดเริ่มนับใหม่หลังบอท R01 รัน · ข้ามสาขานี้")
        return "skipped"
    if r05_rows is None:
        log("  ❌ ไม่มี global_r05 บน cloud — ข้ามสาขานี้")
        return "skipped"

    # ด่านสาขา 3: R01 ต้องเป็นของวันนี้ (คู่มือกำหนด R16 = ตั้งแต่วันอัป R01 · ไฟล์นี้ครอบวันนี้วันเดียว)
    r01_day = r01_date_of(cat["r01_fields"])
    log(f"  R01: {cat['r01_rows']} รายการ · PBM {cat['pm_rows']} · skuMap {len(cat['sku_set'])} · อัปล่าสุด "
        f"{f_str(cat['r01_fields'], 'r01UploadedAt') or '(ไม่มีข้อความเวลา)'} · r01Version {cat['r01_version']} · รอบนับ {cat['epoch'] or '(ว่าง)'}")
    if r01_day != today:
        msg = f"R01 ของสาขาไม่ได้อัปวันนี้ (อัปล่าสุด {r01_day or 'ไม่ทราบ'}) — ไฟล์ R16 วันนี้วันเดียวครอบไม่ถึงยอดขายตั้งแต่ R01 รอบนั้น"
        if not force:
            log(f"  ❌ {msg} · ข้ามสาขานี้ (ตรวจบอท auto-r01 ก่อน · --force ข้ามได้เฉพาะตอนทดสอบ)")
            return "skipped"
        log(f"  ⚠️ {msg} — แต่มี --force ดำเนินการต่อ")

    barcode_map = build_barcode_map(r05_rows, cat["sku_set"])
    timeline, st = build_timeline([header] + own_rows, branch, cat["sku_set"], barcode_map)
    chunks = serialize_chunks(timeline)
    size_kb = sum(len(c.encode("utf-8")) for c in chunks) / 1024
    cover = (f" · ข้อมูล {_fmt_td(st['min_td'])}–{_fmt_td(st['max_td'])}" if st["min_td"] and st["max_td"] else "")
    log(f"  แถวในไฟล์ {st['file_rows']} · ยกเลิก {st['cancelled']} · ข้ามประเภทอื่น {st['skipped_prefix']} · "
        f"ข้ามว่าง {st['skipped_blank']} · ผ่านด่าน {st['kept']} · จับคู่ SKU {st['matched']} · ไม่พบบาร์โค้ด/SKU {st['missing']} · "
        f"SKU ไม่ตรง Col X {st['mismatch']}")
    log(f"  ยอดขาย {st['sales_total']:g} ชิ้น/{st['sales_skus']} SKU · รับเข้า {st['inbound_total']:g} ชิ้น/{st['inbound_skus']} SKU · "
        f"timeline {len(timeline)} SKU · {len(chunks)} chunk · {size_kb:.0f} KB{cover}")
    if st["matched"] == 0 and st["kept"] > 0:
        log("  ❌ มีแถวที่ผ่านด่านประเภทแต่จับคู่ SKU ไม่ได้เลย — R05/R01/PBM ของสาขาไม่ตรงกับไฟล์ · ข้ามสาขานี้")
        return "skipped"
    if any(len(c.encode("utf-8")) / 1024 > MAX_CHUNK_KB for c in chunks):
        log(f"  ❌ chunk ใหญ่เกิน {MAX_CHUNK_KB} KB — ไม่เขียน")
        return "failed"

    content_hash = hashlib.sha256("\n".join([branch] + chunks).encode("utf-8")).hexdigest()
    try:
        old_meta = get_doc(f"{branch}_r16_104_meta")
    except Exception as e:
        log(f"  ❌ อ่าน {branch}_r16_104_meta ไม่ได้: {e}")
        return "failed"

    # เนื้อหา + R01 + รอบนับ เหมือนที่ประกาศอยู่แล้วและ master ชี้เวอร์ชันนั้นอยู่ → ไม่ต้องเขียน
    if (old_meta is not None and f_bool(old_meta, "ready") and f_str(old_meta, "contentHash") == content_hash
            and f_str(old_meta, "r01Version") == cat["r01_version"] and f_str(old_meta, "countResetAt") == cat["epoch"]
            and f_bool(cat["r01_fields"], "r16Loaded")
            and f_str(cat["r01_fields"], "r16DetailVersion") == f_str(old_meta, "version")):
        log(f"  ✅ {branch}: เนื้อหาเหมือนเดิมทุกไบต์และ master ชี้รุ่นนี้อยู่แล้ว — ไม่เขียน")
        return "unchanged"

    if dry_run:
        log(f"  [DRY] {branch}: จะเขียน {len(chunks)} chunk + meta + ประกาศที่ {branch}_r01 (ยังไม่เขียน)")
        return "dry"

    now = datetime.now(BKK)
    uploaded_at_text = thai_ts(now) + (f" · ข้อมูล {_fmt_td(st['min_td'])}–{_fmt_td(st['max_td'])}" if cover else "")
    version, generation = iso_utc_ms(), new_generation()
    meta_fields = {"countResetAt": cat["epoch"], "rowCount": len(timeline), "contentHash": content_hash,
                   "sourceFile": os.path.basename(path), "sourceMtime": datetime.fromtimestamp(mtime, timezone.utc)}
    try:
        publish_branch(branch, chunks, meta_fields, cat["r01_version"], uploaded_at_text, version, generation, old_meta)
    except urllib.error.HTTPError as e:
        log(f"  ❌ {branch}: HTTP {e.code} — {e.read().decode('utf-8', 'replace')[:400]}")
        return "failed"
    except Exception as e:
        log(f"  ❌ {branch}: เขียนไม่สำเร็จ: {e}")
        return "failed"
    log(f"  ✅ เขียน {branch} แล้ว: {len(timeline)} SKU · {len(chunks)} chunk · {size_kb:.0f} KB · version {version} · \"{uploaded_at_text}\"")
    return "written"


def main(argv=None):
    opts = parse_args(sys.argv[1:] if argv is None else argv)
    dry_run, force = opts["dry_run"], opts["force"]
    folder, folder_src = resolve_watch_folder(opts["folder"])

    log(f"เริ่มงาน auto R16.104 import  (dry_run={dry_run}, force={force}, สาขา={','.join(opts['branches'])})")
    log(f"เครื่อง: {os.environ.get('COMPUTERNAME', '?')} · ผู้ใช้: {os.environ.get('USERNAME', '?')}")
    log(f"โฟลเดอร์: {folder}   [จาก {folder_src}]")
    log("ปลายทาง: stock_sessions/{branch}_r16_104_meta + chunks + {branch}_r01 (r16Loaded/r16UploadedAt/r16DetailVersion)")

    if not os.path.isdir(folder):
        log("❌ ไม่มีโฟลเดอร์นี้ในเครื่อง — ยกเลิก")
        log('   ตั้งค่าแล้วรันใหม่:  setx AUTO_R16_WATCH_FOLDER "D:\\path\\to\\run-upload-stock"   (แล้วเปิด CMD ใหม่)')
        log('   หรือทดสอบครั้งเดียว:  python auto_r16_import.py --folder "D:\\path" --dry-run')
        sys.exit(2)

    path = find_latest_file(folder)
    if not path:
        log(f"❌ ไม่พบไฟล์ตรงรูปแบบ '{FILE_GLOB}' ในโฟลเดอร์ (ไฟล์ชื่อมี '{PART_MARKER}' ถูกข้ามโดยตั้งใจ) — ยกเลิก")
        try:
            log(f"   ไฟล์ที่มีในโฟลเดอร์: {sorted(os.listdir(folder))[:10] or '(ว่าง)'}")
        except Exception:
            pass
        sys.exit(2)

    mtime = os.path.getmtime(path)
    mtime_bkk = datetime.fromtimestamp(mtime, BKK)
    now_bkk = datetime.now(BKK)
    today = now_bkk.date()
    log(f"ไฟล์ล่าสุด: {os.path.basename(path)}  (แก้ไขล่าสุด {mtime_bkk:%Y-%m-%d %H:%M:%S} เวลาไทย · {os.path.getsize(path):,} ไบต์)")

    # ด่านไฟล์ 1: ต้องเป็นของวันนี้ — ไฟล์เก่า = BOTR16104 ยังไม่ได้รัน/รันไม่สำเร็จ (R16 ของเมื่อวานบวกซ้ำกับ R01 วันนี้ = Confirm ผิด)
    if mtime_bkk.date() != today:
        if not force:
            log("❌ ไฟล์ไม่ได้ถูกแก้ไขวันนี้ — ยกเลิก (ไม่เขียน Firestore). ใช้ --force ถ้าตั้งใจ")
            log("   สาเหตุที่พบบ่อย: Task BOT16104 (ตัว export) ไม่ได้รัน/ยังไม่เสร็จ — ไปแก้ตรงนั้นก่อน · หรือ Task นี้ตั้งเวลาเร็วกว่าที่ไฟล์เสร็จ (ดู LastWriteTime)")
            sys.exit(4)
        log("⚠️ ไฟล์ไม่ได้ถูกแก้ไขวันนี้ แต่มี --force — ดำเนินการต่อ")

    # ด่านไฟล์ 2: ไฟล์ต้องนิ่ง
    age = (now_bkk - mtime_bkk).total_seconds()
    if age < STABLE_SECONDS:
        if not force:
            log(f"❌ ไฟล์เพิ่งถูกแก้เมื่อ {age:.0f} วินาทีก่อน (< {STABLE_SECONDS}) — อาจกำลังเขียน · ยกเลิก (Task จะลองใหม่เอง)")
            sys.exit(4)
        log("⚠️ ไฟล์เพิ่งถูกแก้ แต่มี --force — ดำเนินการต่อ")

    try:
        rows = read_rows(path)
    except Exception as e:
        log(f"❌ อ่านไฟล์ไม่สำเร็จ: {e}")
        sys.exit(2)

    # ด่านไฟล์ 3: หัวคอลัมน์ต้องอยู่ตำแหน่งเดิม — loadR16 อ่านด้วยเลขคอลัมน์ตายตัว ProMaxx สลับคอลัมน์เมื่อไรจะได้ยอดมั่วแบบเงียบสนิท
    problems = header_problems(rows)
    if problems:
        log("❌ หัวคอลัมน์ไม่ตรงกับที่ loadR16 คาดไว้:")
        for p in problems:
            log(f"   · {p}")
        log("   ProMaxx อาจเปลี่ยนรูปแบบรายงาน — ต้องมีคนตรวจก่อน. ยกเลิก (ไม่เขียน Firestore)")
        sys.exit(4)
    if len(rows) < 2:
        log("❌ ไฟล์มีแต่หัวตาราง ไม่มีเอกสารจ่ายเลย — ยกเลิก")
        sys.exit(4)

    # ด่านไฟล์ 4: ทุกแถวที่ไม่ยกเลิกต้องเป็นของวันนี้และอ่านวันที่ได้
    date_problems = file_date_problems(rows, today)
    if date_problems:
        for p in date_problems:
            log(f"{'⚠️' if force else '❌'} {p}")
        if not force:
            log("   ไฟล์ต้องเป็น 'ประจำวัน = วันนี้' เท่านั้น — ยกเลิก (ไม่เขียน Firestore) · --force ข้ามได้เฉพาะตอนทดสอบ")
            sys.exit(4)

    by_branch, unknown, names = split_by_branch(rows)
    total = sum(len(v) for v in by_branch.values())
    log(f"แถวข้อมูลในไฟล์ {len(rows) - 1} · ของสาขาที่ดูแล {total} "
        f"({', '.join(f'{b} {len(v)}' for b, v in by_branch.items())})"
        + (f" · ข้ามสาขาอื่น {sum(unknown.values())} แถว (SYSBRANCHID {', '.join(sorted(unknown))})" if unknown else ""))

    try:
        r05_rows = load_r05_rows()
    except Exception as e:
        log(f"❌ อ่าน global_r05 จาก Firestore ไม่ได้: {e}")
        sys.exit(1)

    results = {}
    for branch in opts["branches"]:
        try:
            results[branch] = process_branch(branch, by_branch, names, rows[0], r05_rows, path, mtime, opts, today)
        except Exception as e:   # สาขาหนึ่งล้มห้ามหยุดสาขาอื่น
            log(f"  ❌ {branch}: {type(e).__name__}: {e}")
            results[branch] = "failed"

    summary = " · ".join(f"{b} {r}" for b, r in results.items())
    if any(r == "failed" for r in results.values()):
        log(f"❌ จบงานแบบมีสาขาล้มเหลว: {summary}")
        sys.exit(1)
    if any(r == "skipped" for r in results.values()):
        log(f"❌ จบงาน แต่มีสาขาตกด่าน (ไม่ได้เขียน): {summary}")
        sys.exit(4)
    if dry_run:
        log(f"✅ DRY-RUN จบ — ยังไม่เขียนอะไรทั้งสิ้น: {summary}")
    else:
        log(f"✅ จบงาน: {summary}")
        if any(r == "written" for r in results.values()):
            log("Desktop สาขายาที่เปิดค้างจะโหลด timeline เองภายในไม่กี่วินาที (toast 'R16 อัปเดตจาก Cloud แล้ว') · เครื่องที่ login ใหม่โหลดตอน login")
    sys.exit(0)


if __name__ == "__main__":
    main()
