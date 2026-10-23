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

Confirm โดยบอท (ต.ค. 2026 · ไม่บังคับ · ไม่มี flag --confirm* = ไม่ทำอะไรในส่วนนี้เลย) — ให้บอทกด "Confirm" แทน Desktop หลังเผยแพร่ timeline:
    python auto_r16_import.py --confirm-shadow                         # โหมดเงา: คำนวณ Pass/Stock Adj ของทุกสาขา จดลง auto_r16_confirm_shadow.jsonl ไม่เขียน items
    python auto_r16_import.py --confirm --confirm-branch SSS --confirm-shadow   # SSS เขียนจริง · สาขาอื่นเป็นโหมดเงา
    python auto_r16_import.py --confirm-undo confirm_journal\\<ไฟล์>.json [--dry-run]   # ย้อนผล Confirm ที่บอทเขียน
    python auto_r16_import.py --confirm-compare [--confirm-date 2026-10-22]   # เทียบผลโหมดเงากับสถานะจริง (อ่านอย่างเดียว)
  ตรรกะตัดสินเป็นพอร์ตของ _buildPendingScanEvaluation() ใน index.html (สำเนาที่ 3 ของสูตร) — ดู CLAUDE.md §Confirm โดยบอท

ตั้งเวลารันทุกวัน 21:00 ด้วย Windows Task Scheduler (ดู README.md) — ตัวสคริปต์ไม่สนใจว่าถูกเรียกกี่โมง
ดูอย่างเดียวว่าไฟล์เป็นของวันนี้หรือยัง และนิ่งแล้วหรือยัง (Confirm จริงต้องหลัง 21:00 และไฟล์ต้อง export หลัง 21:00 ด้วย)

exit code: 0 สำเร็จ/เนื้อหาเหมือนเดิม · 1 อ่าน/เขียน Firestore ล้ม (รวม Confirm เขียนไปบางส่วน) · 2 ไฟล์/โฟลเดอร์/flag ผิด
           · 4 ตกด่าน (ไม่เขียน · รวม Confirm ติดเวลา/lock/tripwire) · 9 ไม่พบ Python (.bat)
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
import uuid
import threading
import traceback
from collections import Counter
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


# บรรทัด ❌/⚠️ ของรอบนี้ (+ บรรทัดย่อหน้าต่อท้ายไม่เกิน NOTIFY_ALERT_CONTINUATION บรรทัด) — เก็บไว้ประกอบข้อความ Telegram (build_notice)
# ไม่กระทบสิ่งที่พิมพ์ · main() ล้างทุกครั้งที่เริ่มรอบ
_ALERT_LINES = []
_ALERT_STATE = {"indent": None, "cont": 0}
NOTIFY_ALERT_KEEP = 30
NOTIFY_ALERT_CONTINUATION = 4


def _remember_alert(msg):
    raw = str(msg)
    s = raw.strip()
    if not s:
        return
    indent = len(raw) - len(raw.lstrip(" "))
    if s.startswith(("❌", "⚠")):
        _ALERT_STATE["indent"], _ALERT_STATE["cont"] = indent, 0
        keep = True
    elif (_ALERT_STATE["indent"] is not None and indent > _ALERT_STATE["indent"]
          and _ALERT_STATE["cont"] < NOTIFY_ALERT_CONTINUATION):
        _ALERT_STATE["cont"] += 1
        keep = True
    else:
        _ALERT_STATE["indent"] = None
        keep = False
    if keep and len(_ALERT_LINES) < NOTIFY_ALERT_KEEP:
        _ALERT_LINES.append(" ".join(x.strip() for x in s.splitlines() if x.strip()))   # ข้อความหลายบรรทัด → บรรทัดเดียว (เยื้องในข้อความ Telegram ไม่เพี้ยน)


def log(msg):
    print(f"[{datetime.now():%Y-%m-%d %H:%M:%S}] {msg}", flush=True)
    _remember_alert(msg)


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


_MONTHS = {m: i + 1 for i, m in enumerate(("jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"))}
_RE_MON_DATE = re.compile(r"^([0-9]{1,2})-([A-Za-z]{3})-([0-9]{2}|[0-9]{4})(?=[" + _JS_WS + r"]|$)")
_RE_MON_TIME = re.compile(r"^(?:[" + _JS_WS + r"]+[0-9]{1,2}:[0-9]{2}(?::[0-9]{2})?[" + _JS_WS + r"]*(?:AM|PM)?)?[" + _JS_WS + r"]*$", re.I)


def normalize_tran_date(value):
    """TRANDATE → สตริงที่ parseTranDate() ของแอปอ่านได้

    เครื่องที่ export ต่างกันให้รูปแบบวันที่ต่างกัน — BIGYAMAINPC ให้ `14-Oct-26 09:17:17` (ชื่อเดือนอังกฤษ) ซึ่งแอปอ่านไม่ได้
    (dmyMatch รับเลขเดือนเท่านั้น · ISO fallback ล้ม) ⇒ แปลงเป็น `14/10/2026 09:17:17` ก่อนเก็บลง timeline
    รูปแบบอื่นทั้งหมด = คืนค่าเดิมหลัง trim (เท่าแอปเป๊ะ) · ส่วนเวลาที่เหลือผิดรูป = คืนค่าเดิม → parse_tran_date ได้ None → ตกด่าน (fail-closed)
    """
    s = js_trim(value or "")
    m = _RE_MON_DATE.match(s)
    if not m:
        return s
    mon = _MONTHS.get(m.group(2).lower())
    rest = s[m.end():]
    if not mon or not _RE_MON_TIME.match(rest):
        return s
    yr = m.group(3) if len(m.group(3)) == 4 else "20" + m.group(3)
    return f"{m.group(1)}/{mon:02d}/{yr}{rest.rstrip()}"


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
    other, unreadable, unreadable_samples = {}, 0, []
    for r in rows[1:]:
        if not r or js_trim(col(r, COL_CANCEL)) == "1":
            continue
        d = parse_tran_date(normalize_tran_date(col(r, td_idx))) if td_idx >= 0 else None
        if d is None:
            unreadable += 1
            raw = js_trim(col(r, td_idx)) if td_idx >= 0 else ""
            if len(unreadable_samples) < 3 and raw not in unreadable_samples:
                unreadable_samples.append(raw)
        elif d.date() != today:
            other[d.date().isoformat()] = other.get(d.date().isoformat(), 0) + 1
    problems = []
    if unreadable:
        # แสดงค่าจริงที่อ่านไม่ได้ — รูปแบบวันที่ต่างกันตามเครื่องที่ export (เจอจริง 14 ต.ค. 2026: 14-Oct-26) ดูจาก log ได้เลยไม่ต้องไปเปิดไฟล์
        shown = ", ".join(repr(s[:40]) for s in unreadable_samples)
        problems.append(f"TRANDATE อ่านไม่ได้ {unreadable} แถว (รูปแบบวันที่เปลี่ยน?) · ตัวอย่าง: {shown}")
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
        tran_date = normalize_tran_date(col(r, td_idx)) if td_idx >= 0 else ""
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

def _project_id():
    # AUTO_R16_PROJECT_ID / AUTO_R16_FIRESTORE_BASE = ให้เทสชี้บอทไปที่ Firestore emulator (ไม่ตั้ง = production ตามเดิม) · ห้ามตั้งบนเครื่องจริง
    return os.environ.get("AUTO_R16_PROJECT_ID") or PROJECT_ID


def _api_root():
    base = (os.environ.get("AUTO_R16_FIRESTORE_BASE") or "https://firestore.googleapis.com").rstrip("/")
    return f"{base}/v1/projects/{_project_id()}/databases/(default)/documents"


def _doc_url(doc_id, query=""):
    return f"{_api_root()}/stock_sessions/{urllib.parse.quote(doc_id, safe='')}?{query}key={API_KEY}"


_last_http_date = None   # ส่วนหัว Date ของคำตอบล่าสุดจากเซิร์ฟเวอร์ — ขั้น Confirm ใช้ตรวจว่านาฬิกาเครื่องนี้ตรงไหม (clock_skew_seconds)


def _request(req, timeout=120, retries=3):
    """urlopen + ลองใหม่เมื่อเน็ตสะดุด/เซิร์ฟเวอร์ตอบ 429/5xx · 4xx อื่น (รวม 404) โยนทันที"""
    global _last_http_date
    last = None
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                _last_http_date = resp.headers.get("Date") or _last_http_date
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
            "sku_infos": build_sku_infos(pm_rows, r01_rows),   # Confirm ของบอทใช้ (systemQty/ชื่อสินค้า) — ไม่กระทบขั้นตอน timeline
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
#  Confirm โดยบอท  (ต.ค. 2026 · ผู้ใช้สั่ง "ให้บอท R16 Confirm ให้เลย ไม่ต้องเปิด Browser Desktop")
# ------------------------------------------------------------
# ตัวประเมิน (evaluate_candidate) = พอร์ตของ _buildPendingScanEvaluation() + _applyPendingScanEvaluation() ใน index.html
# เฉพาะทางสาขายา (SRC/KKL/SSS · ไม่ผ่าน Audit — PHARMACY_DIRECT_STOCK_ADJ) · เป็นสำเนาที่ 3 ต่อจาก reEvaluateAuditItems
# ⚠️ แก้สูตร Confirm ฝั่งเว็บ = ต้องแก้ที่นี่ด้วยเสมอ แล้วรัน:
#      cd tests && npm run test:logic -- auto-r16-confirm-parity auto-r16-confirm-flow
#    และ e2e: npm run test:e2e -- auto-r16-confirm   (เทียบผลกับ validateAndProcess() จริงของ Desktop ทุกฟิลด์)
# ⚠️ ห้ามเปลี่ยนชื่อ/signature ของ build_sku_infos · timeline_maps · evaluate_candidate · item_changes — เทส parity import ตรงๆ
# ⛔ ไม่มี flag --confirm* = ไม่ทำอะไรในส่วนนี้เลย (สคริปต์เก่า/Task เก่าที่ไม่รู้จัก flag ถูกปฏิเสธ exit 2 อยู่แล้ว)

# ต้องตรงกับ `let PHARMACY_DIRECT_STOCK_ADJ` ใน index.html (เทส parity อ่านค่าจาก index.html จริง) —
# True = ไม่ตรง → stock_adjustment ทันที (directAdj) · False ฝั่งเว็บ = ส่งเข้า audit (บอทไม่รองรับ → ไม่ Confirm)
PHARMACY_DIRECT_STOCK_ADJ = True

CONFIRM_OPEN_HOUR = 21              # ร้านปิดสแกน 21:00–08:00 (processScan: _ph<8||_ph>=21) — Confirm จริงได้หลังเวลานี้เท่านั้น
CONFIRM_SETTLE_SECONDS = 3.8        # เหมือน _confirmPharmacyBatched: รอให้ PDA ที่ได้ lock flush ของค้างขึ้น Cloud ก่อนอ่าน candidate
CONFIRM_LOCK_TTL_SECONDS = 300      # = BRANCH_CONFIRM_LOCK_MS (5 นาที)
CONFIRM_BATCH_SIZE = 450            # = SCAN_ITEM_BATCH_SIZE (< 500 writes ต่อ commit)
CONFIRM_OWNER = "auto-r16"          # ชื่อที่โชว์ในแถบ "กำลัง Confirm ที่ Desktop โดย …" ของ PDA + updatedBy ของ item
CONFIRM_MAX_CLOCK_SKEW = 120        # วินาที: นาฬิกาเครื่องนี้ต่างจากเซิร์ฟเวอร์ Firestore เกินนี้ = ด่านเวลา 21:00 และอายุ lock เชื่อไม่ได้ → ไม่ Confirm จริง
SHADOW_LOG_MAX_BYTES = 30 * 1024 * 1024   # เกินนี้ย้ายเป็น .1 (โหมดเงาจดทุกรายการทุกคืน ~2 MB/คืน)
JOURNAL_KEEP_DAYS = 45              # journal เก่ากว่านี้ถูกลบหลัง Confirm จริงสำเร็จ (ย้อนผลได้ภายในช่วงนี้)
CONFIRM_TRIPWIRE_MIN_ITEMS = 20     # ต้องมีรายการอย่างน้อยเท่านี้ tripwire ถึงทำงาน (รอบเล็กสัดส่วนแกว่งเป็นปกติ)
# สัดส่วน Stock Adj สูงสุดที่ยอมให้บอทเขียนเอง (เกินนี้ = สงสัยว่า R01/R16 ผิดชุด → ไม่เขียน รอคนตรวจ · --confirm-max-adj-ratio ปรับได้)
# ค่าเริ่มต้น 0.5 ตั้งจากข้อมูลจริงที่มี (22 ต.ค. 2026): Confirm ยุคไม่ผ่าน Audit มีวันเดียว = KKL 7 ต.ค. 33/447 (7.4%) · วันอื่นของทั้ง 3 สาขา 0–16%
# ⚠️ ยังไม่ได้ปรับเทียบด้วยข้อมูลโหมดเงา — ดูอัตราที่ log ทุกคืนแล้วค่อยปรับ
CONFIRM_TRIPWIRE_MAX_ADJ_RATIO = 0.5


def _now_bkk():
    """เวลาไทยตอนนี้ — จุดเดียวที่เทสสลับนาฬิกาได้ (ห้ามเรียก datetime.now(BKK) ตรงๆ ในโค้ด Confirm)"""
    return datetime.now(BKK)


# ---- ค่า Firestore (typed) ↔ ค่า Python ----

def to_typed(v):
    """ค่า Python → typed value ของ Firestore REST · เลขลงตัวเขียนเป็น integerValue เหมือน SDK ของเว็บ (Number.isInteger)"""
    if v is None:
        return {"nullValue": None}
    if isinstance(v, bool):
        return {"booleanValue": v}
    if isinstance(v, int):
        return {"integerValue": str(v)}
    if isinstance(v, float):
        if v == v and v not in (float("inf"), float("-inf")) and v == int(v) and abs(v) < 2 ** 53:
            return {"integerValue": str(int(v))}
        return {"doubleValue": v}
    if isinstance(v, str):
        return {"stringValue": v}
    if isinstance(v, datetime):
        return T(v)
    if isinstance(v, (list, tuple)):
        return {"arrayValue": {"values": [to_typed(x) for x in v]}}
    if isinstance(v, dict):
        return {"mapValue": {"fields": {str(k): to_typed(x) for k, x in v.items()}}}
    raise TypeError(f"to_typed: ชนิดไม่รองรับ {type(v).__name__}")


def from_typed(v):
    """typed value ของ Firestore REST → ค่า Python (timestamp คงเป็นสตริง RFC3339)"""
    if not isinstance(v, dict) or not v:
        return None
    t, x = next(iter(v.items()))
    if t == "integerValue":
        return int(x)
    if t == "doubleValue":
        return float(x)
    if t in ("stringValue", "booleanValue", "timestampValue", "referenceValue"):
        return x
    if t == "nullValue":
        return None
    if t == "arrayValue":
        return [from_typed(i) for i in (x.get("values") or [])]
    if t == "mapValue":
        return {k: from_typed(i) for k, i in (x.get("fields") or {}).items()}
    return None


def plain_fields(fields):
    return {k: from_typed(v) for k, v in (fields or {}).items()}


# ---- catalog ของสาขา (skuMap ของ rebuildMaps() เฉพาะส่วนที่ Confirm/audit log ใช้) ----

def build_sku_infos(pm_rows, r01_rows):
    """sku → {systemQty, productName, isDel} ตาม rebuildMaps() ของ index.html

    · SKU ใน PBM (ถ้า PBM ว่าง = ทุกแถว R01): systemQty = ค่าของแถว R01 "ท้ายสุด" ของ SKU นั้น (qtyMap.set แถวท้ายชนะ) · ไม่มีแถว R01 = 0 (?? 0)
    · SKU ที่อยู่ใน R01 แต่ไม่อยู่ใน PBM (เมื่อ PBM ไม่ว่าง) = DEL: systemQty = ค่าของแถวแรกของ SKU นั้นตรงๆ (ไม่ ?? 0)
    · ชื่อ: PBM.productName || ชื่อล่าสุดที่ไม่ว่างจาก R01 || SKU  ·  DEL: ชื่อแถวแรก || SKU
    ⚠️ ชื่อ/signature ถูก import ตรงๆ โดยเทส parity
    """
    pm = [r for r in pm_rows if isinstance(r, dict)] if isinstance(pm_rows, list) else []
    r01 = [r for r in r01_rows if isinstance(r, dict)] if isinstance(r01_rows, list) else []
    qty_map, name_map = {}, {}
    for r in r01:
        sku = r.get("colE")
        qty_map[sku] = r.get("systemQty")
        if r.get("productName"):
            name_map[sku] = r["productName"]
    infos = {}
    source = pm if pm else [{"sku": r.get("colE"), "productName": r.get("productName")} for r in r01]
    for r in source:
        sku = r.get("sku")
        if not isinstance(sku, str) or not sku or sku in infos:
            continue
        q0 = qty_map.get(sku)
        infos[sku] = {"systemQty": 0 if q0 is None else q0,
                      "productName": r.get("productName") or name_map.get(sku) or sku, "isDel": False}
    if pm and r01:
        pm_set = {r.get("sku") for r in pm}
        for r in r01:
            sku = r.get("colE")
            if isinstance(sku, str) and sku and sku not in pm_set and sku not in infos:
                infos[sku] = {"systemQty": r.get("systemQty"), "productName": r.get("productName") or sku, "isDel": True}
    return infos


# ---- timeline → map (เหมือน _applyWhR16Rows('104', rows)) ----

def timeline_maps(rows):
    """แถว timeline [sku, ขายรวม, รับเข้ารวม, rawขาย[], rawรับเข้า[]] → maps ที่ getSoldQtyBefore/getInboundQtyBefore อ่าน"""
    sales_total, inbound_total, raw_sales, raw_inbound = {}, {}, {}, {}
    for row in rows or []:
        if not isinstance(row, (list, tuple)) or not row or not row[0]:
            continue
        sku = str(row[0])
        sales_total[sku] = (row[1] if len(row) > 1 and row[1] else 0)
        inbound_total[sku] = (row[2] if len(row) > 2 and row[2] else 0)
        raw_sales[sku] = row[3] if len(row) > 3 and isinstance(row[3], list) else []
        raw_inbound[sku] = row[4] if len(row) > 4 and isinstance(row[4], list) else []
    return {"sales_total": sales_total, "inbound_total": inbound_total, "raw_sales": raw_sales, "raw_inbound": raw_inbound}


_RE_SCAN_TS = re.compile(r"^([0-9]{4})-([0-9]{2})-([0-9]{2})[T ]([0-9]{2}):([0-9]{2}):([0-9]{2})\Z")   # \Z ไม่ใช่ $ — $ ยอมให้มี \n ต่อท้าย


def parse_scan_ts(ts):
    """new Date(ts.replace(' ','T')) ของ JS สำหรับ timestamp ของ item ('YYYY-MM-DD HH:mm:ss' ตามนาฬิกาเครื่องสแกน)

    คืน datetime (naive) · อ่านไม่ได้ = None (JS ได้ Invalid Date → `td<=scanDate` เป็น false ทุกแถว)
    รับเฉพาะรูปแบบที่แอปเขียนเอง — รูปแบบอื่น (มี Z / วันที่ล้วน / มีช่องว่างหัวท้าย) JS ตีความต่างกัน จึงถือว่าอ่านไม่ได้และบอทจะไม่ Confirm รายการนั้น
    ⚠️ ห้าม trim: JS แทนที่ช่องว่าง "ตัวแรก" เป็น T เท่านั้น ' 2026-10-13 08:00:00' จึงเป็น Invalid Date ในแอป (เทส parity ตรึงไว้)
    """
    if not isinstance(ts, str):
        return None
    m = _RE_SCAN_TS.match(ts)
    if not m:
        return None
    try:
        return datetime(*(int(x) for x in m.groups()))
    except ValueError:
        return None


def qty_before(raw_map, total_map, sku, scan_ts, key):
    """getSoldQtyBefore (key='soldQty') / getInboundQtyBefore (key='qty') ของ index.html

    · timeline ว่างทั้งไฟล์ หรือ item ไม่มี timestamp → ยอดรวมต่อ SKU (fallback เดิมของแอป)
    · แถวไม่มี TRANDATE / อ่านวันที่ไม่ได้ → ไม่นับ · tranDate <= เวลาสแกน → นับ · บวกตามลำดับในอาร์เรย์ (ทศนิยมต้องได้ผลเดียวกับ JS)
    """
    if not raw_map or not scan_ts:
        return total_map.get(sku) or 0
    rows = raw_map.get(sku)
    if not rows:
        return 0
    scan_date = parse_scan_ts(scan_ts)
    total = 0
    for row in rows:
        td_raw = row.get("tranDate") if isinstance(row, dict) else None
        if not td_raw:
            continue
        td = parse_tran_date(td_raw)
        if td is None:
            continue
        if scan_date is not None and td <= scan_date:
            total = total + row.get(key, 0)
    return total


def _gt0(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and v == v and v > 0


def evaluate_candidate(sku, item, sku_infos, tl, direct_enabled=None):
    """_buildPendingScanEvaluation(): คืน dict ผลตัดสิน หรือ None (ไม่ใช่ scanning / SKU ไม่อยู่ใน skuMap — แอปปล่อยค้าง scanning เหมือนกัน)

    eff = นับ + ขายก่อนเวลาสแกน + R16.103 − รับเข้าก่อนเวลาสแกน  (สาขายาไม่มี R16.103 → 0 เสมอ)
    eff = ระบบ → pass · noStock && eff=0 && ระบบ>0 → stock_adjustment (ไม่ใช่ direct) · นอกนั้น stock_adjustment แบบ directAdj
    """
    if direct_enabled is None:
        direct_enabled = PHARMACY_DIRECT_STOCK_ADJ
    if not item or item.get("status") != "scanning":
        return None
    si = sku_infos.get(sku)
    if si is None:
        return None
    sys_qty = si["systemQty"]
    cnt = item.get("countedQty")
    ts = item.get("timestamp")
    sold = qty_before(tl["raw_sales"], tl["sales_total"], sku, ts, "soldQty")
    inbound = qty_before(tl["raw_inbound"], tl["inbound_total"], sku, ts, "qty")
    r103 = 0
    eff = cnt + sold + r103 - inbound
    status, audit_status, direct = "audit", "pending", False
    if eff == sys_qty:
        status, audit_status = "pass", "approved"
    elif item.get("noStock") and eff == 0 and _gt0(sys_qty):
        status, audit_status = "stock_adjustment", "stock_adjustment"
    elif direct_enabled:
        status, audit_status, direct = "stock_adjustment", "stock_adjustment", True
    return {"sku": sku, "cnt": cnt, "sold": sold, "inbound": inbound, "r103": r103, "eff": eff, "sys": sys_qty,
            "status": status, "auditStatus": audit_status, "direct": direct, "timestamp": ts}


def item_changes(item, res):
    """field ที่ _applyPendingScanEvaluation() เปลี่ยนบน item (ไม่รวม rev/updatedBy/updatedAt ที่ _scanItemPayload ใส่ให้)"""
    ch = {}
    if res["sold"] > 0:
        ch["soldQty"] = res["sold"]
        ch["rawCountedQty"] = res["cnt"]
    if res["inbound"] > 0:
        ch["inboundQty"] = res["inbound"]
    if res["r103"] > 0:
        ch["r16103Qty"] = res["r103"]
    ch["status"] = res["status"]
    ch["auditStatus"] = res["auditStatus"]
    if not item.get("initialStatus"):
        ch["initialStatus"] = res["status"]
    if res["direct"]:
        ch["directAdj"] = True
        ch["effectiveQty"] = res["eff"]
        ch["systemQty"] = res["sys"]
    return ch


# ---- ไฟล์สถานะบนเครื่องบอท (shadow log · journal) ----

def _state_dir():
    return os.environ.get("AUTO_R16_STATE_DIR") or os.path.dirname(os.path.abspath(__file__))


def shadow_log_path():
    return os.path.join(_state_dir(), "auto_r16_confirm_shadow.jsonl")


def journal_dir():
    return os.path.join(_state_dir(), "confirm_journal")


def _write_json_atomic(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False)
    os.replace(tmp, path)


def _chunks(seq, n):
    for i in range(0, len(seq), n):
        yield seq[i:i + n]


# ---- เวลา RFC3339 (timestampValue ของ Firestore มีเศษวินาทีได้ถึง 9 หลัก) ----

_RE_RFC3339 = re.compile(r"^([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2}):([0-9]{2})(?:\.([0-9]+))?Z$")


def parse_rfc3339(s):
    m = _RE_RFC3339.match(s or "")
    if not m:
        return None
    y, mo, d, h, mi, se = (int(x) for x in m.groups()[:6])
    try:
        return datetime(y, mo, d, h, mi, se, int((m.group(7) or "")[:6].ljust(6, "0")), tzinfo=timezone.utc)
    except ValueError:
        return None


# ---- Firestore REST: อ่าน/เขียนแบบมีเงื่อนไข (ใช้เฉพาะขั้น Confirm) ----

class PreconditionFailed(Exception):
    """commit ล้มเพราะเอกสารเปลี่ยน/ไม่ตรงเงื่อนไข — ไม่มีอะไรถูกเขียนในชุดนั้น"""


class CommitUncertain(Exception):
    """commit ไม่รู้ผล (เครือข่ายหลุด/5xx) — ห้ามลองซ้ำเอง ต้องอ่านกลับไปดูก่อน"""


class ConfirmLocked(Exception):
    """มี lock ของ Desktop/บอทอื่นถืออยู่"""


def _res_name(rel_path):
    return f"projects/{_project_id()}/databases/(default)/documents/{rel_path}"


def _rel_url(rel_path, query=""):
    segs = "/".join(urllib.parse.quote(s, safe="") for s in rel_path.split("/"))
    return f"{_api_root()}/{segs}?{query}key={API_KEY}"


def get_doc_meta(rel_path, fields=None):
    """GET เอกสารตามพาธเต็ม (เช่น 'stock_sessions/SSS_r01') → (fields แบบ typed, updateTime) · ไม่มี doc = (None, None)"""
    mask = "".join(f"mask.fieldPaths={urllib.parse.quote(f)}&" for f in (fields or []))
    try:
        raw = _request(urllib.request.Request(_rel_url(rel_path, mask)), timeout=120)
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None, None
        raise
    d = json.loads(raw.decode("utf-8"))
    return d.get("fields") or {}, d.get("updateTime")


def run_query_items(branch, filters):
    """query บน stock_sessions/{branch}/items · filters = [(field, value)] (AND ของ == เท่านั้น)
    → [(sku, fields แบบ typed, updateTime)] เรียงตาม SKU (ลำดับเดียวกับ Array.sort ของ JS)"""
    flt = [{"fieldFilter": {"field": {"fieldPath": f}, "op": "EQUAL", "value": to_typed(v)}} for f, v in filters]
    where = flt[0] if len(flt) == 1 else {"compositeFilter": {"op": "AND", "filters": flt}}
    body = {"structuredQuery": {"from": [{"collectionId": "items"}], "where": where}}
    url = f"{_api_root()}/stock_sessions/{urllib.parse.quote(branch, safe='')}:runQuery?key={API_KEY}"
    raw = _request(urllib.request.Request(url, data=json.dumps(body).encode("utf-8"), method="POST",
                                          headers={"Content-Type": "application/json"}), timeout=300)
    out = []
    for r in json.loads(raw.decode("utf-8")):
        d = r.get("document")
        if d:
            out.append((d["name"].rsplit("/", 1)[-1], d.get("fields") or {}, d.get("updateTime")))
    out.sort(key=lambda t: _utf16_key(t[0]))
    return out


def w_update(rel_path, fields, mask=None, precondition=None, transforms=None):
    """write แบบ update ของ documents:commit · mask=None = แทนที่ทั้งเอกสาร (เหมือน set()) · transforms = field ที่ให้เซิร์ฟเวอร์ตั้งเวลา"""
    w = {"update": {"name": _res_name(rel_path), "fields": {k: to_typed(v) for k, v in fields.items()}}}
    if mask is not None:
        w["updateMask"] = {"fieldPaths": list(mask)}
    if transforms:
        w["updateTransforms"] = [{"fieldPath": f, "setToServerValue": "REQUEST_TIME"} for f in transforms]
    if precondition:
        w["currentDocument"] = precondition
    return w


def w_delete(rel_path, precondition=None):
    w = {"delete": _res_name(rel_path)}
    if precondition:
        w["currentDocument"] = precondition
    return w


def commit_writes(writes):
    """documents:commit — atomic ทั้งชุด · คืน updateTime ของแต่ละ write ตามลำดับ

    · เงื่อนไข (currentDocument) ไม่ตรง → PreconditionFailed (ไม่มีอะไรถูกเขียน)
    · เครือข่ายหลุด/5xx/429 → CommitUncertain (คำขออาจสำเร็จไปแล้ว — _request ไม่ลองซ้ำให้ เพราะการลองซ้ำจะล้มด้วย precondition แล้วดูเหมือนไม่เคยเขียน)
    """
    url = f"{_api_root()}:commit?key={API_KEY}"
    req = urllib.request.Request(url, data=json.dumps({"writes": writes}).encode("utf-8"), method="POST",
                                 headers={"Content-Type": "application/json"})
    try:
        raw = _request(req, timeout=180, retries=1)
    except urllib.error.HTTPError as e:
        text = e.read().decode("utf-8", "replace")
        try:
            status = (json.loads(text).get("error") or {}).get("status", "")
        except ValueError:
            status = ""
        if e.code in (400, 404, 409) and status in ("FAILED_PRECONDITION", "ABORTED", "ALREADY_EXISTS", "NOT_FOUND"):
            raise PreconditionFailed(f"{status}: {text[:200]}")
        if e.code >= 500 or e.code == 429:
            raise CommitUncertain(f"HTTP {e.code}")
        raise RuntimeError(f"HTTP {e.code}: {text[:300]}")
    except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
        raise CommitUncertain(str(e))
    return [wr.get("updateTime") for wr in json.loads(raw.decode("utf-8")).get("writeResults", [])]


# ---- branch confirm lock (ตัวเดียวกับที่ Desktop ใช้: stock_sessions/{branch}_confirm_lock) ----

def acquire_confirm_lock(branch, epoch):
    """ถือ lock ด้วยวิธีเดียวกับ _acquireBranchConfirmLock (อ่าน-ตรวจ-เขียนแบบมีเงื่อนไข ≈ transaction) → token · มีคนถืออยู่ = ConfirmLocked"""
    rel = f"stock_sessions/{branch}_confirm_lock"
    now = _now_bkk().astimezone(timezone.utc)
    fields, ut = get_doc_meta(rel)
    if fields is not None:
        cur = plain_fields(fields)
        exp = parse_rfc3339(cur.get("expiresAt"))
        if cur.get("token") and exp is not None and exp > now:
            raise ConfirmLocked(str(cur.get("owner") or "?"))
        pre = {"updateTime": ut}
    else:
        pre = {"exists": False}
    token = uuid.uuid4().hex
    data = {"token": token, "branch": branch, "owner": CONFIRM_OWNER, "role": "bot", "countResetAt": epoch,
            "expiresAt": now + timedelta(seconds=CONFIRM_LOCK_TTL_SECONDS)}
    try:
        commit_writes([w_update(rel, data, precondition=pre, transforms=["startedAt"])])
    except PreconditionFailed:
        raise ConfirmLocked("เครื่องอื่นแย่ง lock ได้ก่อน")
    return token


def release_confirm_lock(branch, token):
    """ปล่อยเฉพาะ lock ที่ token เป็นของเรา (หมดอายุแล้วมีคนยึดต่อ = ไม่แตะของเขา) · ล้ม = lock หมดอายุเองใน 5 นาที"""
    rel = f"stock_sessions/{branch}_confirm_lock"
    try:
        fields, ut = get_doc_meta(rel)
        if fields is None or plain_fields(fields).get("token") != token:
            return False
        commit_writes([w_delete(rel, {"updateTime": ut})])
        return True
    except Exception as e:
        log(f"  ⚠️ ปล่อย lock ไม่สำเร็จ ({e}) — lock จะหมดอายุเองภายใน {CONFIRM_LOCK_TTL_SECONDS // 60} นาที")
        return False


# ---- ด่านและการอ่านก่อน Confirm ----

def confirm_time_problems(now_bkk, mtime_bkk):
    """เหตุผลที่ยัง Confirm จริงไม่ได้ในเวลานี้ (ว่าง = ผ่าน) · ร้านสแกนได้ถึง 20:59 → ต้องหลัง 21:00 และไฟล์ R16 ต้อง export หลัง 21:00
    (ไม่งั้นสแกนที่เกิดหลังเวลา export ไม่ถูกชดเชยยอดขาย — ข้อจำกัดเดิมของ R16)"""
    open_at = now_bkk.replace(hour=CONFIRM_OPEN_HOUR, minute=0, second=0, microsecond=0)
    out = []
    if now_bkk < open_at:
        out.append(f"ยังไม่ถึง {CONFIRM_OPEN_HOUR}:00 ({now_bkk:%H:%M}) — ร้านยังสแกนได้")
    if mtime_bkk < open_at:
        out.append(f"ไฟล์ R16 ถูก export ก่อน {CONFIRM_OPEN_HOUR}:00 ({mtime_bkk:%H:%M}) — สแกนหลังเวลา export จะไม่ถูกชดเชย")
    return out


def confirm_preflight(branch, ctx, check_master=True):
    """สถานะบน Cloud ต้องยังตรงกับตอนเผยแพร่ timeline — คืน (epoch ของ session, [ปัญหา])"""
    problems = []
    sess, _ = get_doc_meta(f"stock_sessions/{branch}", ["schemaVersion", "session_data_json"])
    if sess is None:
        return "", ["ไม่พบ session ของสาขา"]
    sf = plain_fields(sess)
    if sf.get("schemaVersion") != 2:
        problems.append(f"สาขายังไม่ใช่ schema v2 (schemaVersion={sf.get('schemaVersion')}) — บอทรองรับเฉพาะ v2")
    try:
        epoch = (json.loads(sf.get("session_data_json") or "{}") or {}).get("countResetAt", "") or ""
    except ValueError:
        epoch = ""
        problems.append("session_data_json อ่านไม่ได้")
    if epoch != ctx["cat"]["epoch"]:
        problems.append("รอบนับเปลี่ยนจากตอนเผยแพร่ timeline (มีคนกดเริ่มนับใหม่?)")
    if check_master:
        mf, _ = get_doc_meta(f"stock_sessions/{branch}_r01", ["r01Version", "r16Loaded", "r16DetailVersion"])
        mp = plain_fields(mf) if mf else {}
        if mp.get("r01Version") != ctx["cat"]["r01_version"]:
            problems.append("R01 ของสาขาเปลี่ยนจากตอนเผยแพร่ timeline")
        if mp.get("r16Loaded") is not True or mp.get("r16DetailVersion") != ctx["version"]:
            problems.append("master ไม่ได้ประกาศ timeline รุ่นนี้ (มีคนอัป R16 ใหม่ทับ หรือ R01 ใหม่ล้างไปแล้ว)")
    return epoch, problems


def read_candidates(branch, epoch):
    return [{"sku": sku, "item": plain_fields(typed), "updateTime": ut}
            for sku, typed, ut in run_query_items(branch, [("countResetAt", epoch), ("status", "scanning")])]


def split_candidates(cands, today_str, export_naive, sku_infos):
    """แยกรายการที่ Confirm ได้ออกจากรายการที่ต้องปล่อยไว้ — คืน (keep, Counter เหตุผลที่ข้าม)

    ต่างจากปุ่ม Confirm ของ Desktop โดยตั้งใจ (ไม่มีคนเฝ้า จึงเข้มกว่า): ข้ามรายการที่ไม่มี/อ่านเวลาสแกนไม่ได้ · สแกนก่อนวันนี้ (ค้างข้ามวัน)
    · สแกนหลังเวลา export ของไฟล์ R16 (ไม่มียอดชดเชย) — ปล่อยไว้เป็น scanning (Desktop กด Confirm เองได้ หรือถูกรีเซ็ตเช้าวันถัดไปตามเดิม)
    """
    keep, skipped = [], Counter()
    for c in cands:
        item = c["item"]
        cnt = item.get("countedQty")
        if isinstance(cnt, bool) or not isinstance(cnt, (int, float)):
            skipped["no_count"] += 1
            continue
        ts = item.get("timestamp")
        if not isinstance(ts, str) or not ts:
            skipped["no_timestamp"] += 1
            continue
        d = parse_scan_ts(ts)
        if d is None:
            skipped["bad_timestamp"] += 1
            continue
        if ts[:10] < today_str:
            skipped["stale"] += 1
            continue
        if export_naive is not None and d > export_naive:
            skipped["after_export"] += 1
            continue
        if c["sku"] not in sku_infos:
            skipped["not_in_skumap"] += 1
            continue
        keep.append(c)
    return keep, skipped


def _skip_text(skipped):
    names = {"no_count": "ไม่มียอดนับ", "no_timestamp": "ไม่มีเวลาสแกน", "bad_timestamp": "เวลาสแกนอ่านไม่ได้", "stale": "ค้างข้ามวัน",
             "after_export": "สแกนหลังเวลา export", "not_in_skumap": "SKU ไม่อยู่ในแคตตาล็อก"}
    return " · ".join(f"{names.get(k, k)} {v}" for k, v in sorted(skipped.items())) or "-"


# ---- journal / shadow log ----

def _journal_entry(p):
    return {"sku": p["sku"], "rev_before": p["rev_before"], "rev_after": p["rev_after"], "before": p["before"], "absent": p["absent"],
            "after": p["changes"], "update_time_before": p["update_time"], "update_time_after": p.get("after_update_time")}


def save_journal(path, journal, plan):
    journal["items"] = [_journal_entry(p) for p in plan]
    _write_json_atomic(path, journal)


def clock_skew_seconds():
    """นาฬิกาเครื่องนี้เร็วกว่าเซิร์ฟเวอร์ Firestore กี่วินาที (ลบ = ช้ากว่า) · ยังไม่เคยได้คำตอบ/อ่านส่วนหัวไม่ได้ = None
    ใช้ datetime.now(UTC) ตรงๆ ไม่ผ่าน _now_bkk (เทสสลับนาฬิกา _now_bkk ได้ แต่นาฬิกาจริงของเครื่องคือสิ่งที่ต้องตรวจ)"""
    if not _last_http_date:
        return None
    try:
        from email.utils import parsedate_to_datetime
        server = parsedate_to_datetime(_last_http_date)
        if server.tzinfo is None:
            server = server.replace(tzinfo=timezone.utc)
    except Exception:
        return None
    return (datetime.now(timezone.utc) - server).total_seconds()


def prune_journals():
    """ลบ journal เก่ากว่า JOURNAL_KEEP_DAYS (เฉพาะไฟล์ชื่อตามรูปแบบของบอท) · ลบไฟล์ใดไม่ได้ = ข้ามไฟล์นั้นต่อ (ไม่กระทบงาน · ไม่หยุดทั้งชุด)
    เรียกหลัง Confirm จริงสำเร็จเท่านั้น — รอบที่ล้ม/ข้าม/เงา ไม่ลบอะไร (journal คือทางย้อนของผลที่เขียนไปแล้ว)"""
    n = 0
    try:
        d = journal_dir()
        if not os.path.isdir(d):
            return 0
        cutoff = time.time() - JOURNAL_KEEP_DAYS * 86400
        warned = False
        for name in sorted(os.listdir(d)):   # เรียงชื่อ = ลำดับลบคงที่ทุกเครื่อง (log/เทสไม่ขึ้นกับลำดับของระบบไฟล์)
            if not re.match(r"^[0-9]{4}-[0-9]{2}-[0-9]{2}_[0-9]{6}_(SRC|KKL|SSS)\.json$", name):
                continue
            path = os.path.join(d, name)
            try:
                if os.path.getmtime(path) < cutoff:
                    os.remove(path)
                    n += 1
            except OSError as e:
                if not warned:
                    log(f"  ⚠️ ลบ journal เก่า {name} ไม่สำเร็จ ({e}) — ข้ามไฟล์นี้ ไม่กระทบ")
                    warned = True
    except Exception as e:
        log(f"  ⚠️ ลบ journal เก่าไม่สำเร็จ ({e}) — ไม่กระทบ")
    return n


def append_shadow_record(rec):
    try:
        os.makedirs(os.path.dirname(shadow_log_path()), exist_ok=True)
        if os.path.exists(shadow_log_path()) and os.path.getsize(shadow_log_path()) > SHADOW_LOG_MAX_BYTES:
            os.replace(shadow_log_path(), shadow_log_path() + ".1")
        with open(shadow_log_path(), "a", encoding="utf-8") as f:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")
    except Exception as e:
        log(f"  ⚠️ เขียน shadow log ไม่สำเร็จ ({e}) — ไม่กระทบ")


def _result_row(r):
    return {"sku": r["sku"], "cnt": r["cnt"], "sold": r["sold"], "inbound": r["inbound"], "eff": r["eff"], "sys": r["sys"],
            "status": r["status"], "direct": bool(r["direct"])}


# ---- audit log (stock_audit_log/{branch}_{date}) — Dashboard/ประวัติผู้ช่วยอ่าน · รูปแบบเดียวกับ saveAuditLogToFirestore() ----

def build_audit_log_items(items_by_sku, sku_infos):
    """รายการ "ไม่ตรงตั้งแต่นับรอบแรก" (initialStatus=audit หรือ directAdj) ทั้งรอบนับ — เหมือนที่ Desktop เขียนจาก state.scanData ทั้งก้อน"""
    out = []
    for sku in sorted(items_by_sku, key=_utf16_key):
        sd = items_by_sku[sku]
        if not (sd.get("initialStatus") == "audit" or sd.get("directAdj") is True):
            continue
        si = sku_infos.get(sku)   # ไม่อยู่ใน skuMap → ชื่อว่าง (เหมือน `si?si.productName:''` ของเว็บ)
        it = {"sku": sku, "productName": si["productName"] if si else "", "barcode": sd.get("barcode") or "", "countedQty": sd.get("countedQty"),
              "scannedBy": sd.get("scannedBy") or "", "timestamp": sd.get("timestamp") or "",
              "firstScanAt": sd.get("firstScanAt") or sd.get("timestamp") or "", "status": sd.get("status"),
              "auditor": sd.get("auditor") or "", "recheckQty": sd.get("recheckQty"), "backorder": bool(sd.get("backorder"))}
        if sd.get("directAdj") is True:
            fin = lambda v: v if isinstance(v, (int, float)) and not isinstance(v, bool) and v == v and abs(v) != float("inf") else None
            it["directAdj"] = True
            it["effectiveQty"] = fin(sd.get("effectiveQty"))
            it["systemQty"] = fin(sd.get("systemQty"))
        out.append(it)
    return out


def write_confirm_audit_log(branch, epoch, sku_infos, now_bkk, date_str=None, write_empty=False):
    """ล้ม = เตือนอย่างเดียว (ผล Confirm เขียนลง items ไปแล้ว · Desktop เครื่องไหนกด Confirm/ยืนยันทีหลังจะเขียนทับให้เอง)

    date_str: วันของเอกสาร log (ค่าเริ่มต้น = วันนี้ · --confirm-undo ส่งวันที่ของ journal เพื่อเขียนทับ log วันที่บอท Confirm)
    write_empty: รายการว่างก็เขียน (items=[]) — เว็บไม่เขียน log เมื่อว่าง (`if(!items.length)return`) แต่หลัง --confirm-undo ต้องล้างรายการที่ย้อนออกจาก log"""
    try:
        by_sku = {}
        try:
            for flt in ([("countResetAt", epoch), ("directAdj", True)], [("countResetAt", epoch), ("initialStatus", "audit")]):
                for sku, typed, _ut in run_query_items(branch, flt):
                    by_sku[sku] = plain_fields(typed)
        except urllib.error.HTTPError as e:
            # query สองเงื่อนไขอาจต้องการ composite index บน production (emulator ไม่บังคับ) → ถอยไปอ่านทั้งรอบแล้วกรองเอง
            log(f"  ⚠️ query audit log แบบแคบไม่ได้ (HTTP {e.code}) — ถอยไปอ่านทั้งรอบนับ")
            by_sku = {sku: plain_fields(typed) for sku, typed, _ut in run_query_items(branch, [("countResetAt", epoch)])}
        items = build_audit_log_items(by_sku, sku_infos)
        if not items and not write_empty:
            return "empty"
        if len(json.dumps(items, ensure_ascii=False).encode("utf-8")) > 900 * 1024:
            log("  ⚠️ audit log ใหญ่เกิน 900 KB — ไม่เขียน (Desktop จะเป็นคนเขียนเอง)")
            return "toolarge"
        date_str = date_str or now_bkk.strftime("%Y-%m-%d")
        updated_at = now_bkk.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"   # เหมือน new Date().toISOString()
        commit_writes([w_update(f"stock_audit_log/{branch}_{date_str}",
                                {"branch": branch, "date": date_str, "updatedAt": updated_at, "items": items})])
        return "written"
    except Exception as e:
        log(f"  ⚠️ เขียน stock_audit_log ไม่สำเร็จ ({type(e).__name__}: {e}) — ผล Confirm ไม่กระทบ")
        return "failed"


# ---- Confirm ของสาขาเดียว ----

def _verify_chunk_applied(branch, epoch, chunk):
    """หลัง commit ที่ไม่รู้ผล: อ่านกลับว่า SKU ในชุดนั้นยังเป็น scanning อยู่ไหม → 'all' | 'none' | 'partial' (ชุดเดียวเป็น atomic จึงไม่ควรได้ partial)"""
    still = {sku for sku, _t, _u in run_query_items(branch, [("countResetAt", epoch), ("status", "scanning")])}
    flags = [p["sku"] not in still for p in chunk]
    return "all" if all(flags) else ("none" if not any(flags) else "partial")


def _commit_confirm(branch, epoch, plan, journal, jpath):
    """เขียนผลทีละชุด (atomic ต่อชุด ด้วย updateTime precondition ของ item) → ('ok'|'aborted'|'failed', จำนวน item ที่เขียนแล้ว)"""
    done = 0
    for chunk in _chunks(plan, CONFIRM_BATCH_SIZE):
        writes = []
        for p in chunk:
            fields = dict(p["changes"])
            fields["rev"] = p["rev_after"]
            fields["updatedBy"] = CONFIRM_OWNER
            writes.append(w_update(f"stock_sessions/{branch}/items/{p['sku']}", fields, mask=list(fields),
                                   precondition={"updateTime": p["update_time"]}, transforms=["updatedAt"]))
        try:
            times = commit_writes(writes)
        except PreconditionFailed as e:
            log(f"  ❌ ชุดนี้ไม่ถูกเขียน — มีรายการเปลี่ยนระหว่างคำนวณ ({str(e)[:120]})")
            return "aborted", done
        except CommitUncertain as e:
            log(f"  ⚠️ commit ไม่รู้ผล ({e}) — อ่านกลับเพื่อตรวจ")
            try:
                verdict = _verify_chunk_applied(branch, epoch, chunk)
            except Exception as e2:
                log(f"  ❌ อ่านกลับไม่ได้ ({e2}) — ต้องตรวจมือ (ดู journal {jpath})")
                journal["state"] = "uncertain"
                save_journal(jpath, journal, plan)
                return "failed", done
            if verdict != "all":
                log(f"  ❌ commit ไม่สำเร็จ (ผลอ่านกลับ: {verdict})")
                return ("aborted" if verdict == "none" else "failed"), done
            times = [None] * len(chunk)
        for p, t in zip(chunk, times):
            p["after_update_time"] = t
        done += len(chunk)
        journal["state"] = "partial" if done < len(plan) else "committed"
        save_journal(jpath, journal, plan)
    return "ok", done


def confirm_branch(branch, mode, ctx, opts, now_bkk, mtime_bkk):
    """Confirm ของสาขาเดียว · mode: 'write' (เขียนจริง) | 'shadow' (คำนวณ+จดอย่างเดียว) — --dry-run บังคับเป็นไม่เขียนเสมอ
    คืน dict {'state': 'confirmed'|'shadow'|'dry'|'nothing'|'skipped'|'locked'|'aborted'|'tripwire'|'failed', ...}"""
    dry = bool(opts.get("dry_run"))
    write = (mode == "write") and not dry
    force = bool(opts.get("force"))
    label = "DRY — ไม่เขียน" if dry else ("เขียนจริง" if write else "โหมดเงา — ไม่เขียน")
    log(f"  ── Confirm [{label}] ──")
    sku_infos = ctx["cat"]["sku_infos"]
    today_str = now_bkk.strftime("%Y-%m-%d")
    mtime_naive = mtime_bkk.replace(tzinfo=None)
    out = {"state": "failed", "branch": branch}

    problems = confirm_time_problems(now_bkk, mtime_bkk)
    skew = clock_skew_seconds()
    if skew is not None and abs(skew) > CONFIRM_MAX_CLOCK_SKEW:
        problems.append(f"นาฬิกาเครื่องนี้คลาดจากเซิร์ฟเวอร์ Firestore {skew:+.0f} วินาที (เกิน {CONFIRM_MAX_CLOCK_SKEW}) — ด่านเวลา 21:00 และอายุ lock เชื่อไม่ได้ · ตั้งเวลาเครื่องให้ตรงก่อน")
    for p in problems:
        log(f"  {'❌' if write and not force else '⚠️'} {p}")
    if write and problems and not force:
        out["state"] = "skipped"
        return out
    if write and not PHARMACY_DIRECT_STOCK_ADJ:
        log("  ❌ PHARMACY_DIRECT_STOCK_ADJ ปิดอยู่ — เว็บจะส่งรายการไม่ตรงเข้า audit ซึ่งบอทไม่รองรับ · ไม่ Confirm")
        out["state"] = "skipped"
        return out

    token = None
    try:
        check_master = ctx.get("version") is not None
        epoch, pf = confirm_preflight(branch, ctx, check_master)
        if pf:
            for p in pf:
                log(f"  ❌ {p}")
            out["state"] = "skipped"
            return out
        if write:
            token = acquire_confirm_lock(branch, epoch)
            log(f"  🔒 ถือ {branch}_confirm_lock แล้ว (ทุกเครื่องพักสแกน) — รอ {CONFIRM_SETTLE_SECONDS:g} วิให้ PDA ส่งของค้างขึ้น Cloud")
            time.sleep(CONFIRM_SETTLE_SECONDS)
            epoch2, pf2 = confirm_preflight(branch, ctx, check_master)
            if pf2 or epoch2 != epoch:
                for p in pf2 or ["รอบนับเปลี่ยนระหว่างรอ"]:
                    log(f"  ❌ {p}")
                out["state"] = "aborted"
                return out

        cands = read_candidates(branch, epoch)
        keep, skipped = split_candidates(cands, today_str, mtime_naive, sku_infos)
        tl = timeline_maps(ctx["timeline"])
        pairs = []
        for c in keep:
            r = evaluate_candidate(c["sku"], c["item"], sku_infos, tl)
            if r is not None:
                pairs.append((c, r))
        n = len(pairs)
        n_pass = sum(1 for _c, r in pairs if r["status"] == "pass")
        n_adj = n - n_pass
        ratio = (n_adj / n) if n else 0.0
        max_ratio = opts.get("max_adj_ratio")
        if max_ratio is None:
            max_ratio = CONFIRM_TRIPWIRE_MAX_ADJ_RATIO
        tripped = n >= CONFIRM_TRIPWIRE_MIN_ITEMS and ratio > max_ratio
        out.update({"candidates": len(cands), "evaluated": n, "pass": n_pass, "adj": n_adj, "ratio": ratio, "skipped": dict(skipped)})
        log(f"  รอ Confirm {len(cands)} รายการ · ประเมินได้ {n} → Pass {n_pass} · Stock Adj {n_adj} ({ratio * 100:.1f}%) · ข้าม: {_skip_text(skipped)}")

        if not write:
            if not dry:
                append_shadow_record({"ts": now_bkk.isoformat(), "date": today_str, "branch": branch, "mode": "shadow", "early": bool(problems),
                                      "epoch": epoch, "r01Version": ctx["cat"]["r01_version"], "timelineVersion": ctx.get("version"),
                                      "candidates": len(cands), "evaluated": n, "skipped": dict(skipped),
                                      "summary": {"pass": n_pass, "adj": n_adj, "ratio": ratio, "tripwire": tripped},
                                      "results": [_result_row(r) for _c, r in pairs]})
            if tripped:
                log(f"  ⚠️ [เงา] สัดส่วน Stock Adj {ratio * 100:.1f}% เกินเพดาน {max_ratio * 100:.0f}% — ถ้าเป็นโหมดเขียนจริงจะไม่เขียน")
            log("  [DRY] ยังไม่ได้เขียนอะไร" if dry else "  [เงา] จดผลลง auto_r16_confirm_shadow.jsonl แล้ว — ยังไม่ได้เขียนอะไรขึ้น Cloud")
            out["state"] = "dry" if dry else "shadow"
            return out

        if not n:
            log("  ไม่มีรายการให้ Confirm")
            out["state"] = "nothing"
            return out
        if tripped:
            log(f"  ❌ TRIPWIRE: Stock Adj {n_adj}/{n} = {ratio * 100:.1f}% เกินเพดาน {max_ratio * 100:.0f}% — สงสัยว่า R01/R16 ผิดชุด · ไม่เขียนอะไร รอคนตรวจ")
            log("     ตรวจแล้วถ้าถูกต้อง: รันใหม่ด้วย --confirm-max-adj-ratio <ค่าที่สูงกว่า> หรือให้ Desktop กด Confirm เอง")
            out["state"] = "tripwire"
            return out

        plan = []
        for c, r in pairs:
            item = c["item"]
            ch = item_changes(item, r)
            rev_before = item.get("rev") if isinstance(item.get("rev"), (int, float)) and not isinstance(item.get("rev"), bool) else 0
            plan.append({"sku": c["sku"], "changes": ch, "rev_before": rev_before, "rev_after": rev_before + 1,
                         "before": {k: item[k] for k in ch if k in item}, "absent": [k for k in ch if k not in item],
                         "update_time": c["updateTime"]})
        jpath = os.path.join(journal_dir(), f"{now_bkk:%Y-%m-%d_%H%M%S}_{branch}.json")
        journal = {"version": 1, "branch": branch, "owner": CONFIRM_OWNER, "startedAt": now_bkk.isoformat(), "epoch": epoch,
                   "r01Version": ctx["cat"]["r01_version"], "timelineVersion": ctx.get("version"), "state": "planned",
                   "summary": {"pass": n_pass, "adj": n_adj, "skipped": dict(skipped)}}
        try:
            save_journal(jpath, journal, plan)   # เขียน journal ไม่ได้ = ไม่เขียน Cloud (ถ้าผิดจะย้อนไม่ได้)
        except Exception as e:
            log(f"  ❌ เขียน journal ไม่ได้ ({e}) — ไม่ Confirm")
            out["state"] = "failed"
            return out
        log(f"  journal: {jpath}")
        state, done = _commit_confirm(branch, epoch, plan, journal, jpath)
        out["written"] = done
        if done:
            out["audit_log"] = write_confirm_audit_log(branch, epoch, sku_infos, now_bkk)   # สะท้อนสิ่งที่อยู่บน Cloud จริง แม้ชุดหลังล้ม
        if state != "ok":
            out["state"] = state
            if done:
                log(f"  ⚠️ เขียนไปแล้ว {done}/{len(plan)} รายการก่อนล้ม — รายการที่เหลือยังเป็น scanning · ย้อนได้ด้วย --confirm-undo {jpath}")
            return out
        out["state"] = "confirmed"
        out["journal"] = jpath
        prune_journals()
        log(f"  ✅ Confirm {branch} สำเร็จ {done} รายการ — Pass {n_pass}, Stock Adj {n_adj} · audit log: {out['audit_log']}")
        return out
    except ConfirmLocked as e:
        log(f"  ❌ มี lock ถืออยู่ ({e}) — ไม่ Confirm รอบนี้ · รายการยังเป็น scanning (ถ้า Task ไม่ถูกรันซ้ำเอง: Desktop กด Confirm ได้ หรือรันบอทซ้ำด้วยมือ)")
        out["state"] = "locked"
        return out
    except Exception as e:
        log(f"  ❌ Confirm {branch} ล้ม: {type(e).__name__}: {e}")
        out["state"] = "failed"
        return out
    finally:
        if token:
            release_confirm_lock(branch, token)


# ------------------------------------------------------------
#  ย้อนผล Confirm ของบอท  (--confirm-undo) และเทียบผลโหมดเงา (--confirm-compare)
# ------------------------------------------------------------

UNDO_OWNER = "auto-r16-undo"


def _load_journal(path):
    with open(path, "r", encoding="utf-8") as f:
        j = json.load(f)
    if (not isinstance(j, dict) or j.get("version") != 1 or j.get("branch") not in BRANCHES
            or not isinstance(j.get("items"), list)):
        raise ValueError("ไม่ใช่ไฟล์ journal ของ auto-r16 (version/branch/items ไม่ครบ)")
    return j


def _still_as_bot_left(entry, current):
    """รายการยังเป็นอย่างที่บอทเขียนไว้เป๊ะไหม (ไม่มีใครเปลี่ยนต่อหลังบอท) — ใช้ตัดสินว่าย้อนได้ปลอดภัยหรือไม่"""
    if current.get("updatedBy") != CONFIRM_OWNER:
        return False
    if current.get("rev") != entry["rev_after"]:
        return False
    return all(current.get(k) == v for k, v in entry["after"].items())


def run_undo(opts):
    """ย้อนผล Confirm ตาม journal · คืน exit code (0 สำเร็จ/ไม่มีอะไรต้องย้อน · 1 ล้ม · 2 ใช้ผิด/ไฟล์ผิด · 4 ปฏิเสธเพราะสถานะไม่ตรง)

    ย้อนเฉพาะรายการที่ยังเป็นผลของบอทเป๊ะ (updatedBy/rev/ค่า after ตรง) · รายการที่มีคนเปลี่ยนต่อแล้ว (↺ ✕ สแกนใหม่ ฯลฯ) ไม่แตะและรายงาน
    · rev เดินหน้าอย่างเดียว (current+1 — ไม่ถอยกลับเลข rev เดิม) เพื่อให้เครื่องที่จำ rev ไว้เห็นว่ามีการเปลี่ยนจริง"""
    dry = bool(opts.get("dry_run"))
    path = opts["undo"]
    try:
        j = _load_journal(path)
    except Exception as e:
        log(f"❌ อ่าน journal ไม่ได้: {e}")
        return 2
    branch, epoch = j["branch"], j.get("epoch") or ""
    entries = [e for e in j["items"] if isinstance(e, dict) and e.get("sku")]
    log(f"ย้อนผล Confirm {branch} · journal {path} · state={j.get('state')} · {len(entries)} รายการ · "
        + ("DRY — ไม่เขียน" if dry else "เขียนจริง"))
    if j.get("undoneAt"):
        log(f"⚠️ journal นี้เคยถูกย้อนเมื่อ {j['undoneAt']} — ตรวจสถานะปัจจุบันของแต่ละรายการใหม่ (ที่ย้อนไปแล้วจะถูกข้าม)")
    token = None
    try:
        sess, _ = get_doc_meta(f"stock_sessions/{branch}", ["schemaVersion", "session_data_json"])
        if sess is None:
            log("❌ ไม่พบ session ของสาขา — ไม่ย้อน")
            return 4
        sf = plain_fields(sess)
        try:
            cur_epoch = (json.loads(sf.get("session_data_json") or "{}") or {}).get("countResetAt", "") or ""
        except ValueError:
            cur_epoch = None
        if sf.get("schemaVersion") != 2 or cur_epoch != epoch:
            log(f"❌ รอบนับปัจจุบันไม่ตรงกับ journal (journal {epoch or '(ว่าง)'} · ตอนนี้ {cur_epoch or '(ว่าง)'}) หรือไม่ใช่ schema v2 "
                f"— รายการเหล่านี้ไม่ใช่ของรอบนี้แล้ว · ไม่ย้อน")
            return 4
        if not dry:
            token = acquire_confirm_lock(branch, epoch)
            log(f"🔒 ถือ {branch}_confirm_lock แล้ว — รอ {CONFIRM_SETTLE_SECONDS:g} วิ")
            time.sleep(CONFIRM_SETTLE_SECONDS)
        try:
            found = {sku: (plain_fields(t), ut) for sku, t, ut in run_query_items(branch, [("countResetAt", epoch), ("updatedBy", CONFIRM_OWNER)])}
        except urllib.error.HTTPError as e:
            log(f"⚠️ query ตาม updatedBy ไม่ได้ (HTTP {e.code}) — อ่านทีละรายการแทน")
            found = {}
            for en in entries:
                f, ut = get_doc_meta(f"stock_sessions/{branch}/items/{en['sku']}")
                if f is not None:
                    found[en["sku"]] = (plain_fields(f), ut)
        todo, changed, gone = [], [], []
        for en in entries:
            hit = found.get(en["sku"])
            if hit is None:
                # ไม่อยู่ในผล query = ไม่ใช่ของบอทแล้ว (มีคนเปลี่ยน updatedBy) หรือถูกลบ/ย้อนไปแล้ว
                gone.append(en["sku"])
                continue
            cur, ut = hit
            if cur.get("countResetAt") != epoch or not _still_as_bot_left(en, cur):
                changed.append(en["sku"])
                continue
            todo.append((en, cur, ut))
        log(f"ย้อนได้ {len(todo)} · ไม่ใช่ผลของบอทแล้ว/มีคนเปลี่ยนต่อ {len(changed)} · ไม่พบเป็นของบอท {len(gone)}")
        for label, skus in (("เปลี่ยนต่อหลังบอท", changed), ("ไม่พบเป็นของบอท", gone)):
            if skus:
                log(f"   · {label}: {', '.join(skus[:15])}{' …' if len(skus) > 15 else ''}")
        if dry or not todo:
            log("[DRY] ยังไม่ได้เขียนอะไร" if dry else "ไม่มีรายการที่ต้องย้อน")
            return 0
        done = 0
        for chunk in _chunks(todo, CONFIRM_BATCH_SIZE):
            writes = []
            for en, cur, ut in chunk:
                fields = dict(en["before"])
                fields["rev"] = (cur.get("rev") or 0) + 1
                fields["updatedBy"] = UNDO_OWNER
                mask = list(en["before"]) + list(en["absent"]) + ["rev", "updatedBy"]   # absent อยู่ใน mask แต่ไม่อยู่ใน fields = ลบ field
                writes.append(w_update(f"stock_sessions/{branch}/items/{en['sku']}", fields, mask=mask,
                                       precondition={"updateTime": ut}, transforms=["updatedAt"]))
            try:
                commit_writes(writes)
            except (PreconditionFailed, CommitUncertain) as e:
                log(f"❌ ย้อนชุดนี้ไม่สำเร็จ ({type(e).__name__}: {str(e)[:120]}) — ย้อนแล้ว {done}/{len(todo)} · รันคำสั่งเดิมซ้ำได้ (ข้ามรายการที่ย้อนไปแล้ว)")
                return 1
            done += len(chunk)
        j["undoneAt"] = _now_bkk().isoformat()
        j["undoneCount"] = done
        try:
            _write_json_atomic(path, j)
        except Exception as e:
            log(f"⚠️ บันทึกสถานะ undone ลง journal ไม่ได้ ({e}) — ไม่กระทบ")
        log(f"✅ ย้อนผล Confirm {branch} แล้ว {done} รายการ → กลับเป็น scanning (Desktop กด Confirm เองได้ หรือรอรีเซ็ตตามเดิม)")
        try:
            cat = load_branch_catalog(branch)
            started = parse_scan_ts(str(j.get("startedAt", "")).replace("T", " ")[:19])
            write_confirm_audit_log(branch, epoch, (cat or {}).get("sku_infos", {}), _now_bkk(),
                                    date_str=started.strftime("%Y-%m-%d") if started else None, write_empty=True)
        except Exception as e:
            log(f"⚠️ เขียน stock_audit_log ใหม่ไม่สำเร็จ ({e}) — Desktop จะเขียนทับให้เองเมื่อมีการ Confirm ครั้งถัดไป")
        return 0
    except ConfirmLocked as e:
        log(f"❌ มี lock ถืออยู่ ({e}) — ไม่ย้อน ลองใหม่ภายหลัง")
        return 4
    except Exception as e:
        log(f"❌ ย้อนล้ม: {type(e).__name__}: {e}")
        return 1
    finally:
        if token:
            release_confirm_lock(branch, token)


def _read_shadow_records():
    """อ่านบันทึกเงาทั้งหมดเก่า→ใหม่ — รวมไฟล์ที่ถูกหมุน (.1) ด้วย ไม่งั้นเทียบคืนที่อยู่ก่อนจุดหมุนไม่ได้"""
    out = []
    for path in (shadow_log_path() + ".1", shadow_log_path()):
        if not os.path.exists(path):
            continue
        with open(path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    rec = json.loads(line)
                except ValueError:
                    continue
                if isinstance(rec, dict) and rec.get("mode") == "shadow":
                    out.append(rec)
    return out


def compare_shadow_record(rec, actual_by_sku):
    """เทียบผลที่โหมดเงาทำนายไว้กับสถานะจริงบน Cloud → dict นับ + รายการที่ต่าง (อ่านอย่างเดียว · ไม่แตะ Firestore)"""
    c = Counter()
    diffs = []
    for r in rec.get("results", []):
        a = actual_by_sku.get(r["sku"])
        if a is None:
            c["missing"] += 1
        elif a.get("status") == "scanning":
            c["pending"] += 1
        elif a.get("status") not in ("pass", "stock_adjustment"):
            c["other"] += 1
        else:
            same = a.get("status") == r["status"]
            if same and r.get("direct"):
                same = a.get("directAdj") is True and a.get("effectiveQty") == r["eff"] and a.get("systemQty") == r["sys"]
            if same:
                c["same"] += 1
            else:
                c["diff"] += 1
                diffs.append((r, a))
    return c, diffs


def run_compare(opts):
    """เทียบ shadow log กับสถานะจริง (อ่านอย่างเดียว) · คืน exit code (0 รายงานแล้ว · 1 อ่าน Cloud ไม่ได้ · 2 ไม่มี shadow log)"""
    recs = _read_shadow_records()
    if not recs:
        log(f"❌ ไม่พบบันทึกโหมดเงาใน {shadow_log_path()} — รันบอทด้วย --confirm-shadow ก่อน")
        return 2
    want = opts.get("confirm_date")
    bad_read = False
    for branch in opts["branches"]:
        mine = [r for r in recs if r.get("branch") == branch and (not want or r.get("date") == want)]
        if not mine:
            log(f"── {branch} ── ไม่มีบันทึกโหมดเงา{f' ของวันที่ {want}' if want else ''}")
            continue
        day = max(r.get("date", "") for r in mine)
        rec = [r for r in mine if r.get("date") == day][-1]   # ถ้าวันเดียวกันรันหลายรอบ ใช้รอบท้ายสุด
        total = len(rec.get("results", []))
        s = rec.get("summary", {})
        log(f"── {branch} · เงา {day} ({str(rec.get('ts', ''))[11:16]}) · ทำนาย {total} รายการ → Pass {s.get('pass', 0)} · "
            f"Stock Adj {s.get('adj', 0)}{' · มาก่อน 21:00' if rec.get('early') else ''}{' · เกินเพดาน tripwire' if s.get('tripwire') else ''} ──")
        try:
            actual = {sku: plain_fields(t) for sku, t, _ut in run_query_items(branch, [("countResetAt", rec.get("epoch", ""))])}
        except Exception as e:
            log(f"   ❌ อ่านรายการจริงจาก Cloud ไม่ได้: {type(e).__name__}: {e}")
            bad_read = True
            continue
        c, diffs = compare_shadow_record(rec, actual)
        log(f"   ตรงกัน {c['same']} · ต่างกัน {c['diff']} · ยังเป็น scanning (ยังไม่มีใคร Confirm) {c['pending']} · "
            f"สถานะอื่น {c['other']} · ไม่พบรายการ (ถูกรีเซ็ต/ลบ) {c['missing']}")
        for r, a in diffs[:20]:
            log(f"   ⚠️ {r['sku']}: เงาทำนาย {r['status']}{'(ตรง)' if r.get('direct') else ''} นับ {r['cnt']} ขาย {r['sold']} รับเข้า {r['inbound']} ระบบ {r['sys']} "
                f"→ จริง {a.get('status')}"
                + (f" effectiveQty {a.get('effectiveQty')} ระบบ {a.get('systemQty')}" if a.get("directAdj") is True else ""))
        if len(diffs) > 20:
            log(f"   … และอีก {len(diffs) - 20} รายการ")
        if c["same"] + c["diff"] == 0:
            log("   (ยังไม่มีรายการที่ถูก Confirm จริงให้เทียบ — โหมดเงาไม่เขียนอะไร ต้องมีคนกด Confirm ที่ Desktop ในรอบเดียวกันก่อนวันถัดไป)")
    return 1 if bad_read else 0


# ------------------------------------------------------------
#  main
# ------------------------------------------------------------

USAGE = ("ใช้: python auto_r16_import.py [--dry-run|-n] [--force] [--folder <path>] [--branch SRC,KKL,SSS]\n"
         "     Confirm โดยบอท (ไม่บังคับ · ค่าเริ่มต้นปิด = ไม่มี flag --confirm* ทำงานเหมือนเดิมทุกอย่าง):\n"
         "       --confirm-shadow                          คำนวณผล Confirm แล้วจดลง auto_r16_confirm_shadow.jsonl (ไม่เขียน items)\n"
         "       --confirm --confirm-branch SSS[,KKL,SRC]  Confirm จริงเฉพาะสาขาที่ระบุ (สาขาอื่นเป็นโหมดเงาถ้ามี --confirm-shadow)\n"
         "       --confirm-max-adj-ratio 0.5               เพดานสัดส่วน Stock Adj ที่บอทยอมเขียนเอง (เกิน = ไม่เขียน รอคนตรวจ)\n"
         "       --confirm-undo <journal.json>             ย้อนผล Confirm ของบอท (ใส่ --dry-run ดูก่อนได้)\n"
         "       --confirm-compare [--confirm-date YYYY-MM-DD]   เทียบผลโหมดเงากับสถานะจริงบน Cloud (อ่านอย่างเดียว)\n"
         "     แจ้งเตือน Telegram (ตั้งค่าใน .env — ดู README · ไม่ได้ตั้ง = ไม่ส่ง):\n"
         "       --notify-test                             ส่งข้อความทดสอบแล้วจบ (ใช้เดี่ยวๆ)\n"
         "       --no-notify                               รอบนี้ไม่ส่งแจ้งเตือน (--dry-run / --confirm-compare / --confirm-undo ไม่ส่งอยู่แล้ว)\n"
         "     (flag อื่นจะถูกปฏิเสธ — กันตัวเก่าเมินแล้วเขียนจริง)")


def parse_args(argv):
    """คืน dict หรือโยน SystemExit(2) เมื่อเจอ flag ที่ไม่รู้จัก — เรียกจาก main() เท่านั้น (ห้ามเรียกตอน import)"""
    opts = {"dry_run": False, "force": False, "folder": None, "branches": list(BRANCHES),
            "confirm": False, "confirm_shadow": False, "confirm_branches": [], "max_adj_ratio": None,
            "undo": None, "compare": False, "confirm_date": None, "notify_test": False, "no_notify": False}
    i = 0

    def value_of(a, name):
        """--name VALUE หรือ --name=VALUE → (ค่า, จำนวนตำแหน่งที่ใช้เพิ่ม) · ไม่มีค่า = None"""
        if a == name:
            return (argv[i + 1], 1) if i + 1 < len(argv) else (None, 0)
        if a.startswith(name + "="):
            return a.split("=", 1)[1], 0
        return False, 0

    while i < len(argv):
        a = argv[i]
        extra = 0
        if a in ("--dry-run", "-n"):
            opts["dry_run"] = True
        elif a == "--force":
            opts["force"] = True
        elif a in ("-h", "--help"):
            print(USAGE)
            raise SystemExit(0)
        elif a == "--confirm":
            opts["confirm"] = True
        elif a == "--confirm-shadow":
            opts["confirm_shadow"] = True
        elif a == "--confirm-compare":
            opts["compare"] = True
        elif a == "--notify-test":
            opts["notify_test"] = True
        elif a == "--no-notify":
            opts["no_notify"] = True
        elif value_of(a, "--folder")[0] is not False:
            v, extra = value_of(a, "--folder")
            if v is None:
                log("❌ --folder ต้องมีค่า")
                raise SystemExit(2)
            opts["folder"] = v
        elif value_of(a, "--branch")[0] is not False:
            v, extra = value_of(a, "--branch")
            if v is None:
                log("❌ --branch ต้องมีค่า")
                raise SystemExit(2)
            opts["branches"] = [x.strip().upper() for x in v.split(",") if x.strip()]
        elif value_of(a, "--confirm-branch")[0] is not False:
            v, extra = value_of(a, "--confirm-branch")
            if v is None:
                log("❌ --confirm-branch ต้องมีค่า (เช่น SSS หรือ SSS,KKL)")
                raise SystemExit(2)
            opts["confirm_branches"] = [x.strip().upper() for x in v.split(",") if x.strip()]
        elif value_of(a, "--confirm-max-adj-ratio")[0] is not False:
            v, extra = value_of(a, "--confirm-max-adj-ratio")
            try:
                ratio = float(v)
            except (TypeError, ValueError):
                ratio = None
            if ratio is None or not (0 < ratio <= 1):
                log("❌ --confirm-max-adj-ratio ต้องเป็นเลขมากกว่า 0 และไม่เกิน 1 (เช่น 0.5 = Stock Adj ไม่เกินครึ่ง · 1 = ปิดเพดาน)")
                raise SystemExit(2)
            opts["max_adj_ratio"] = ratio
        elif value_of(a, "--confirm-undo")[0] is not False:
            v, extra = value_of(a, "--confirm-undo")
            if not v:
                log("❌ --confirm-undo ต้องระบุไฟล์ journal (อยู่ในโฟลเดอร์ confirm_journal ข้างสคริปต์)")
                raise SystemExit(2)
            opts["undo"] = v
        elif value_of(a, "--confirm-date")[0] is not False:
            v, extra = value_of(a, "--confirm-date")
            if not v or not re.match(r"^[0-9]{4}-[0-9]{2}-[0-9]{2}$", v):
                log("❌ --confirm-date ต้องเป็น YYYY-MM-DD")
                raise SystemExit(2)
            opts["confirm_date"] = v
        else:
            log(f"❌ flag ไม่รู้จัก: {a}")
            log(USAGE)
            raise SystemExit(2)
        i += 1 + extra
    bad = [b for b in opts["branches"] if b not in BRANCHES]
    if bad or not opts["branches"]:
        log(f"❌ --branch ต้องเป็น {', '.join(BRANCHES)} (เจอ: {', '.join(bad) or '(ว่าง)'})")
        raise SystemExit(2)

    # ความสัมพันธ์ระหว่าง flag Confirm — เข้มโดยเจตนา: ตั้งผิดแล้ว "เงียบแต่ไม่ทำงาน" อันตรายกว่าปฏิเสธ
    utility = bool(opts["undo"]) or opts["compare"]
    if opts["undo"] and opts["compare"]:
        log("❌ --confirm-undo กับ --confirm-compare ใช้พร้อมกันไม่ได้")
        raise SystemExit(2)
    if utility and (opts["confirm"] or opts["confirm_shadow"] or opts["confirm_branches"]):
        log("❌ --confirm-undo / --confirm-compare เป็นโหมดเครื่องมือ ใช้ร่วมกับ --confirm / --confirm-shadow / --confirm-branch ไม่ได้")
        raise SystemExit(2)
    if opts["confirm_date"] and not opts["compare"]:
        log("❌ --confirm-date ใช้ได้กับ --confirm-compare เท่านั้น")
        raise SystemExit(2)
    if opts["confirm"] and not opts["confirm_branches"]:
        log("❌ --confirm ต้องระบุสาขาที่ให้ Confirm จริงด้วย --confirm-branch (เช่น --confirm-branch SSS) — ไม่มีค่าเริ่มต้น 'ทุกสาขา' โดยตั้งใจ")
        raise SystemExit(2)
    if opts["confirm_branches"] and not opts["confirm"]:
        log("❌ --confirm-branch ต้องใช้คู่กับ --confirm (ตั้งไว้เฉยๆ จะดูเหมือนเปิดแล้วทั้งที่ไม่ทำงาน)")
        raise SystemExit(2)
    badc = [b for b in opts["confirm_branches"] if b not in BRANCHES or b not in opts["branches"]]
    if badc:
        log(f"❌ --confirm-branch ต้องเป็นสาขาที่อยู่ใน --branch ด้วย (เจอ: {', '.join(badc)} · --branch คือ {', '.join(opts['branches'])})")
        raise SystemExit(2)
    if opts["max_adj_ratio"] is not None and not (opts["confirm"] or opts["confirm_shadow"]):
        log("❌ --confirm-max-adj-ratio ใช้ได้เมื่อมี --confirm หรือ --confirm-shadow เท่านั้น")
        raise SystemExit(2)
    if opts["notify_test"] and (opts["confirm"] or opts["confirm_shadow"] or opts["confirm_branches"] or opts["undo"]
                                or opts["compare"] or opts["dry_run"] or opts["no_notify"] or opts["force"]):
        log("❌ --notify-test ใช้เดี่ยวๆ (ไม่รวมกับ flag Confirm / --dry-run / --force / --no-notify) — มันส่งข้อความทดสอบแล้วจบ ไม่ทำงานหลัก")
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


def process_branch(branch, rows_by_branch, names, header, r05_rows, path, mtime, opts, today, confirm_ctx=None):
    """คืน 'written' | 'unchanged' | 'dry' (โหมด --dry-run ที่จะเขียน) | 'skipped' (ตกด่าน) | 'failed' (Firestore ล้ม)

    confirm_ctx (dict, ไม่บังคับ): ถ้าส่งมา สาขาที่ผ่านเป็น written/unchanged/dry จะถูกใส่รายละเอียดที่ขั้น Confirm ต้องใช้ (ไม่เปลี่ยนพฤติกรรมเดิม)
    """
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
        if confirm_ctx is not None:
            confirm_ctx[branch] = {"cat": cat, "timeline": timeline, "version": f_str(old_meta, "version"), "stats": st}
        return "unchanged"

    if dry_run:
        log(f"  [DRY] {branch}: จะเขียน {len(chunks)} chunk + meta + ประกาศที่ {branch}_r01 (ยังไม่เขียน)")
        if confirm_ctx is not None:
            confirm_ctx[branch] = {"cat": cat, "timeline": timeline, "version": None, "stats": st}
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
    if confirm_ctx is not None:
        confirm_ctx[branch] = {"cat": cat, "timeline": timeline, "version": version, "stats": st}
    return "written"


def _confirm_exit_code(results):
    """exit code ของขั้น Confirm (นับเฉพาะสาขาที่สั่งเขียนจริง) · โหมดเงาล้มไม่ทำให้ Task แดง — งานหลัก (เผยแพร่ timeline) ไม่เกี่ยว

    0 = ผ่าน/ไม่มีอะไรต้อง Confirm · 4 = ตกด่านโดยไม่ได้เขียนอะไร (เวลา/lock/tripwire/ข้อมูลเปลี่ยน) · 1 = ล้ม หรือเขียนไปแล้วบางส่วน (ต้องมีคนดู)"""
    rc = 0
    for r in results.values():
        if not r.get("real"):
            continue
        st = r.get("state")
        if st in ("confirmed", "nothing", "dry"):
            continue
        if st == "failed" or (r.get("written") or 0) > 0:
            return 1
        rc = 4
    return rc


def _confirm_summary(results):
    out = []
    for b, r in results.items():
        st = r.get("state", "?")
        n = r.get("written") if st == "confirmed" else (r.get("evaluated") if st in ("shadow", "dry") else None)
        out.append(f"Confirm {b} {st}" + (f"({n})" if n is not None else ""))
    return " · ".join(out)


# ------------------------------------------------------------
#  แจ้งเตือน Telegram  (ต.ค. 2026 · ผู้ใช้สั่ง: "ถ้าบอทไม่ Confirm ให้ส่ง Telegram")
# ------------------------------------------------------------
# ทำไม: บอทนี้ Confirm แทนคนทุกคืน — คืนไหนไม่ Confirm (ตกด่าน/ล้ม/เครื่องดับ) รายการ scanning ของวันนั้นถูกรีเซ็ตเช้าวันถัดไป (ต้องนับใหม่)
#       บอท auto-r* ไม่เคยมีแจ้งเตือน จึงต้องมีก่อนปิดปุ่ม Confirm ที่ Desktop (สวิตช์ PHARMACY_DESKTOP_CONFIRM_BY_BOT ใน index.html)
# ส่ง "สรุปทุกคืน" แม้สำเร็จ ไม่ใช่เฉพาะตอนล้ม: เครื่องดับ/Task ไม่รัน = บอทไม่มีโอกาสส่งอะไร → ความเงียบคือสัญญาณเดียวที่เหลือ
# ⛔ รหัสอยู่ใน env/.env เท่านั้น (repo PUBLIC — ห้าม commit) · ห้ามพิมพ์ token ลง log/ข้อความ/เหตุผลของ exception
# ⛔ ส่งไม่ได้/ช้า/ตั้งค่าผิด ต้องไม่เปลี่ยน exit code และไม่ทำให้งานหลักล้ม (main() จับทุกอย่างที่นี่)
# ปิดชั่วคราวโดยไม่แก้ Task: ตัวแปรระบบ AUTO_R16_NOTIFY=0 (เทสตั้งไว้เสมอ — ไม่ให้เทสเผลอยิง Telegram จริงถ้าเครื่องพัฒนามี .env)

TELEGRAM_TIMEOUT_SECONDS = 10       # ต่อคำขอ
TELEGRAM_TOTAL_SECONDS = 30         # เพดานรวมรวมการลองซ้ำ — ส่งใน thread แล้วทิ้งเมื่อเกิน (กัน DNS/เครือข่ายค้าง)
TELEGRAM_RETRY_WAIT_SECONDS = 1.5
TELEGRAM_MAX_CHARS = 3500           # เพดานจริงของ Telegram คือ 4096
NOTIFY_ALERT_SHOW = 10              # บรรทัด ❌/⚠️ จาก log ที่ใส่ในข้อความ
NOTIFY_LINE_CHARS = 260

# ผลของรอบที่กำลังรัน (opts / results / confirm_results / ไฟล์) — ใช้ประกอบข้อความแจ้งเตือนเท่านั้น · main() ล้างทุกครั้ง
_RUN = {}

_EXIT_MEANING = {
    1: "อ่าน/เขียน Firestore ล้ม หรือ Confirm เขียนไปแล้วบางส่วน",
    2: "ไฟล์/โฟลเดอร์/flag ผิด",
    4: "ตกด่านโดยไม่ได้เขียน (ไฟล์ไม่ใช่วันนี้/ยังไม่นิ่ง · Confirm ติดเวลา/lock/tripwire)",
}
_PUBLISH_TH = {"written": "เผยแพร่แล้ว", "unchanged": "เหมือนเดิม (ไม่เขียนซ้ำ)", "dry": "ซ้อม",
               "skipped": "ตกด่าน ไม่ได้เขียน", "failed": "ล้ม"}
_CONFIRM_STATE_TH = {"skipped": "ตกด่าน ไม่ได้เขียน", "aborted": "ข้อมูลเปลี่ยนระหว่างทำ", "locked": "มี lock ถืออยู่ ไม่ได้เขียน",
                     "tripwire": "tripwire ไม่ได้เขียน", "failed": "ล้ม"}


def _script_dir():
    return os.path.dirname(os.path.abspath(__file__))


def _env_file_value(path, key):
    """ค่าของ KEY ใน .env (KEY=value · ตัดเครื่องหมายคำพูด/คอมเมนต์ท้ายบรรทัด · ข้ามบรรทัดคอมเมนต์) — ไม่มีไฟล์/อ่านไม่ได้ = None"""
    try:
        with open(path, encoding="utf-8-sig") as f:
            for line in f:
                mt = re.match(r"^\s*(?:export\s+)?" + re.escape(key) + r"\s*=\s*(.*?)\s*$", line)
                if not mt:
                    continue
                v = mt.group(1)
                if v[:1] in ("'", '"'):
                    end = v.find(v[0], 1)   # "ค่า"  # คอมเมนต์ท้ายบรรทัด → เอาเฉพาะในเครื่องหมายคำพูด (ปิดไม่ครบ = ตกไปทางไม่มีคำพูด แล้วค่าจะไม่ผ่านด่านรูปแบบ)
                    if end > 0:
                        return v[1:end].strip() or None
                v = re.split(r"\s+#", v, maxsplit=1)[0]
                return v.strip() or None
    except (OSError, UnicodeDecodeError):
        pass
    return None


def _notify_disabled():
    return (os.environ.get("AUTO_R16_NOTIFY") or "").strip().lower() in ("0", "false", "off", "no")


def telegram_config_problem(token, chat_id):
    """ปัญหาของค่าที่ตั้งไว้ (ว่าง = ใช้ได้) — ห้ามใส่ค่าจริงลงข้อความ"""
    if not token and not chat_id:
        return "ยังไม่ได้ตั้ง TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID (ตัวแปรระบบ หรือ .env ข้างสคริปต์)"
    if not token:
        return "ไม่พบ TELEGRAM_BOT_TOKEN"
    if not chat_id:
        return "ไม่พบ TELEGRAM_CHAT_ID"
    if token.startswith("<") or chat_id.startswith("<"):
        return "ยังเป็นข้อความตัวอย่างในวงเล็บมุม ไม่ใช่ค่าจริง"
    if not re.fullmatch(r"[0-9]{5,}:[A-Za-z0-9_-]{30,}", token):
        return "TELEGRAM_BOT_TOKEN รูปแบบไม่ถูก (ต้องเป็น <ตัวเลข>:<อักขระ> ตามที่ BotFather ให้)"
    if not re.fullmatch(r"-?[0-9]{3,}|@[A-Za-z0-9_]{4,}", chat_id):
        return "TELEGRAM_CHAT_ID รูปแบบไม่ถูก (เลข เช่น 123456789 · กลุ่มขึ้นต้นด้วย - · หรือ @ชื่อช่อง)"
    return ""


def load_telegram_config(folder=None):
    """คืน (token, chat_id, แหล่ง, ปัญหา) — ลำดับ: ตัวแปรระบบ → .env ข้างสคริปต์ → .env ในโฟลเดอร์ CSV · ปัญหาไม่ว่าง = ไม่ส่ง"""
    if _notify_disabled():
        return None, None, "", "AUTO_R16_NOTIFY ปิดอยู่"
    if folder is None:
        folder = resolve_watch_folder(None)[0]
    got, src = {}, {}
    for key in ("TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID"):
        v, s = (os.environ.get(key) or "").strip(), f"ตัวแปรระบบ {key}"
        if not v:
            v, s = _env_file_value(os.path.join(_script_dir(), ".env"), key), ".env ข้างสคริปต์"
        if not v and folder:
            v, s = _env_file_value(os.path.join(folder, ".env"), key), ".env ในโฟลเดอร์ CSV"
        got[key], src[key] = v or "", s
    token, chat = got["TELEGRAM_BOT_TOKEN"], got["TELEGRAM_CHAT_ID"]
    problem = telegram_config_problem(token, chat)
    if problem:
        return None, None, "", problem
    return token, chat, src["TELEGRAM_BOT_TOKEN"], ""


def _telegram_base():
    return (os.environ.get("AUTO_R16_TELEGRAM_BASE") or "https://api.telegram.org").rstrip("/")


def _telegram_post(text, token, chat_id):
    """ส่ง 1 ครั้ง → (ok, เหตุผลสั้น) · ⛔ ห้ามใส่ str(e) ลงเหตุผล: ข้อความของ exception อาจมี URL ซึ่งมี token"""
    url = f"{_telegram_base()}/bot{token}/sendMessage"
    body = json.dumps({"chat_id": chat_id, "text": text, "disable_web_page_preview": True}).encode("utf-8")
    req = urllib.request.Request(url, data=body, method="POST", headers={"Content-Type": "application/json; charset=utf-8"})
    try:
        with urllib.request.urlopen(req, timeout=TELEGRAM_TIMEOUT_SECONDS) as r:
            payload = json.loads(r.read().decode("utf-8", "replace") or "{}")
        return (True, "") if payload.get("ok") is True else (False, "Telegram ตอบ ok=false")
    except urllib.error.HTTPError as e:
        return False, f"HTTP {e.code}"
    except Exception as e:
        return False, type(e).__name__


def _send_with_retry(text, token, chat_id):
    """ลองซ้ำ 1 ครั้งเฉพาะที่ลองใหม่แล้วอาจหาย: เครือข่าย/timeout/5xx/429 (4xx อื่น = ค่าผิด ลองซ้ำก็ไม่หาย)"""
    ok, reason = _telegram_post(text, token, chat_id)
    if ok:
        return True, ""
    if reason.startswith("HTTP 4") and reason != "HTTP 429":
        return False, reason
    time.sleep(TELEGRAM_RETRY_WAIT_SECONDS)
    return _telegram_post(text, token, chat_id)


def send_telegram(text, token, chat_id):
    """ส่งข้อความ → (ok, เหตุผลสั้น) · ไม่โยน exception · ไม่เกิน TELEGRAM_TOTAL_SECONDS"""
    box = {}

    def work():
        try:
            box["r"] = _send_with_retry(text, token, chat_id)
        except Exception as e:
            box["r"] = (False, type(e).__name__)

    t = threading.Thread(target=work, daemon=True)
    t.start()
    t.join(TELEGRAM_TOTAL_SECONDS)
    if t.is_alive():
        return False, f"เกิน {TELEGRAM_TOTAL_SECONDS} วินาที"
    return box.get("r", (False, "ไม่ทราบสาเหตุ"))


_RE_KEY_PARAM = re.compile(r"([?&]key=)[^&\s\"']+", re.IGNORECASE)
_RE_TOKEN_SHAPE = re.compile(r"\b[0-9]{6,}:[A-Za-z0-9_-]{30,}\b")


def _scrub(text, token=None):
    """กันความลับหลุดลงข้อความ: token ที่ตั้งไว้ · รูปแบบ token ของ Telegram · พารามิเตอร์ key= ของ URL (เผื่อ exception ถูกพิมพ์ลง log)"""
    text = _RE_KEY_PARAM.sub(r"\1***", text)
    if token:
        text = text.replace(token, "***")
    return _RE_TOKEN_SHAPE.sub("***", text)


def _confirm_part(r):
    st = r.get("state", "?")
    sk = r.get("skipped") or {}
    skip_n = sum(sk.values()) if isinstance(sk, dict) else 0
    skip_txt = f" · ⚠️ ข้าม {skip_n} ({_skip_text(sk)}) ยังเป็น scanning" if skip_n else ""
    if st == "confirmed":
        return f"Confirm {r.get('written', 0)} รายการ (Pass {r.get('pass', 0)} · Stock Adj {r.get('adj', 0)}){skip_txt}"
    if st == "nothing":
        if r.get("candidates"):
            return f"Confirm 0 รายการ (ผ่านตัวคัดกรอง 0 จาก {r['candidates']}){skip_txt}"
        return "Confirm: ไม่มีรายการ scanning"
    if st in ("shadow", "dry"):   # dry ไม่ถึงตรงนี้ในการใช้งานจริง (--dry-run ไม่ส่งแจ้งเตือน) — กันแสดงเป็น "❌ Confirm dry"
        return (f"{'เงา' if st == 'shadow' else 'ซ้อม'} (ไม่เขียน): ทำนาย {r.get('evaluated', 0)} รายการ "
                f"(Pass {r.get('pass', 0)} · Stock Adj {r.get('adj', 0)}){skip_txt}")
    if st == "tripwire":
        return (f"❌ tripwire: Stock Adj {r.get('adj', 0)}/{r.get('evaluated', 0)} = {r.get('ratio', 0) * 100:.0f}% "
                f"เกินเพดาน — ไม่ได้เขียน (ตรวจ R01/R16 แล้วปรับ --confirm-max-adj-ratio)")
    txt = f"❌ Confirm {_CONFIRM_STATE_TH.get(st, st)}"
    if r.get("written"):
        txt += f" (เขียนไปแล้ว {r['written']} รายการ)"
    if r.get("candidates"):
        txt += f" · รอ Confirm {r['candidates']} รายการ"
    return txt


def _leftover(cres):
    """รายการ scanning ที่สาขาสั่งเขียนจริง "ควรถูก Confirm" แต่ยังไม่ถูก → (จำนวนที่รู้, มีสาขาที่ไม่รู้จำนวนไหม)"""
    n, unknown = 0, False
    for r in cres.values():
        if not r.get("real") or r.get("state") in ("shadow", "dry"):
            continue
        st = r.get("state")
        if st in ("confirmed", "nothing"):
            sk = r.get("skipped") or {}
            n += sum(sk.values()) if isinstance(sk, dict) else 0
        elif isinstance(r.get("candidates"), int):
            n += r["candidates"] - (r.get("written") or 0)
        else:
            unknown = True
    return n, unknown


def build_notice(rc, run, alerts, now_bkk):
    """ข้อความแจ้งเตือน (ไทย) — rc = 0 สรุปทุกคืน · rc ≠ 0 บอกสาเหตุ + วิธีแก้เร็ว"""
    opts = run.get("opts") or {}
    results = run.get("results") or {}
    cres = run.get("confirm_results") or {}
    host = os.environ.get("COMPUTERNAME", "?")
    stamp = f"{now_bkk:%H:%M %d/%m/%Y}"
    if rc == 0:
        lines = [f"✅ auto-r16 · {stamp} · {host} — เรียบร้อย"]
    else:
        lines = [f"❌ auto-r16 · {stamp} · {host} — ไม่สำเร็จ (exit {rc}: {_EXIT_MEANING.get(rc, 'ผิดปกติ')})"]
    if run.get("file"):
        mt = run.get("mtime_bkk")
        lines.append(f"ไฟล์ {run['file']}" + (f" (export {mt:%H:%M %d/%m})" if mt else ""))
    for b in (opts.get("branches") or list(BRANCHES)):
        parts = []
        if b in results:
            parts.append("R16 " + _PUBLISH_TH.get(results[b], str(results[b])))
        if b in cres:
            parts.append(_confirm_part(cres[b]))
        if parts:
            lines.append(f"{b}: " + " · ".join(parts))
    if results and not (opts.get("confirm") or opts.get("confirm_shadow")):
        lines.append("⚠️ Confirm โดยบอทปิดอยู่ (Task ไม่มี --confirm) — ต้องกด Confirm ที่ Desktop เอง")
    left, unknown = _leftover(cres)
    if left or unknown:
        amount = f"{left}{'+' if unknown else ''} รายการ" if left else "ไม่ทราบจำนวน"   # unknown = สาขาที่ตกด่านก่อนนับ candidate
        lines.append(f"⚠️ รายการ scanning ที่ยังไม่ถูก Confirm: {amount} — จะถูกรีเซ็ตเช้าพรุ่งนี้ (ต้องนับใหม่)")
    shown = list(alerts)[:NOTIFY_ALERT_SHOW]
    if shown:
        lines.append("จาก log:" if rc != 0 else "คำเตือนใน log:")
        lines.extend("  " + a[:NOTIFY_LINE_CHARS] for a in shown)
        if len(alerts) > len(shown):
            lines.append(f"  … อีก {len(alerts) - len(shown)} บรรทัด (ดู auto_r16.log)")
    if rc != 0:
        lines.append(f"แก้เร็ว: ดู log บน {host}:  Get-Content .\\auto_r16.log -Tail 60 -Encoding UTF8")
        if opts.get("confirm") and opts.get("confirm_branches"):
            lines.append("รันซ้ำคืนนี้ก่อนเที่ยงคืน (หลังแก้สาเหตุ):  .\\run_auto_r16.bat --confirm --confirm-branch "
                         + ",".join(opts["confirm_branches"]))
            lines.append("ถ้าไม่ทัน รายการ scanning ของวันนี้จะถูกรีเซ็ตเช้าพรุ่งนี้")
        elif rc == 2 and not opts:
            lines.append("ตรวจ -Argument ของ Task AutoR16Import (flag ผิด)")
        else:
            lines.append("กด Confirm ที่ Desktop เองได้ถ้าปุ่มยังไม่ถูกซ่อน · หรืออัป R16 มือที่การ์ด R16.104")
    text = "\n".join(lines)
    if len(text) > TELEGRAM_MAX_CHARS:
        text = text[:TELEGRAM_MAX_CHARS - 20] + "\n… (ตัดข้อความ)"
    return text


def _notify_after_run(rc):
    """ส่งแจ้งเตือนหลังรอบจบ — ไม่ส่งเมื่อ --help / --dry-run / --confirm-compare / --confirm-undo / --no-notify / --notify-test"""
    opts = _RUN.get("opts")
    if opts is None:
        if rc == 0:   # --help
            return
    elif (opts.get("no_notify") or opts.get("dry_run") or opts.get("undo") or opts.get("compare") or opts.get("notify_test")):
        return
    token, chat, _src, problem = load_telegram_config(_RUN.get("folder"))
    if problem:
        if not _notify_disabled():
            log(f"แจ้งเตือน Telegram: ไม่ได้ส่ง — {problem}")
        return
    text = _scrub(build_notice(rc, _RUN, list(_ALERT_LINES), _now_bkk()), token)
    ok, reason = send_telegram(text, token, chat)
    if ok:
        log("แจ้งเตือน Telegram: ส่งแล้ว")
    else:
        log(f"⚠️ ส่ง Telegram ไม่สำเร็จ ({reason}) — งานหลักไม่กระทบ")


def run_notify_test(opts):
    """--notify-test: ส่งข้อความทดสอบแล้วจบ · 0 = ส่งแล้ว · 2 = ตั้งค่าไม่ครบ/ผิด · 1 = ส่งไม่สำเร็จ"""
    folder = resolve_watch_folder(opts.get("folder"))[0]
    token, chat, src, problem = load_telegram_config(folder)
    if problem:
        log(f"❌ ส่งข้อความทดสอบไม่ได้ — {problem}")
        log("   ตั้ง TELEGRAM_BOT_TOKEN และ TELEGRAM_CHAT_ID ในไฟล์ .env ข้าง auto_r16_import.py (หรือตัวแปรระบบ) ดู README.md §แจ้งเตือน Telegram")
        return 2
    log(f"Telegram: ใช้ค่าจาก {src} · chat ***{chat[-3:]}")
    text = _scrub(f"🔔 ทดสอบแจ้งเตือน auto-r16 · {os.environ.get('COMPUTERNAME', '?')} · {_now_bkk():%H:%M %d/%m/%Y}\n"
                  "ถ้าเห็นข้อความนี้ แปลว่าการแจ้งเตือนใช้ได้", token)
    ok, reason = send_telegram(text, token, chat)
    if ok:
        log("✅ ส่งข้อความทดสอบแล้ว — ตรวจในแชท")
        return 0
    log(f"❌ ส่ง Telegram ไม่สำเร็จ ({reason})")
    return 1


def _exit_code_of(e):
    c = e.code
    if c is None:
        return 0
    return c if isinstance(c, int) else 1


def main(argv=None):
    """ตัวห่อของ _run(): รันงานจริงแล้วส่ง Telegram ตามผล — คง SystemExit(rc) เดิมทุกกรณี
    (เทสเรียก m.main([...]) แล้วจับ SystemExit · Task Scheduler อ่าน exit code · traceback ยังพิมพ์ลง stderr/log เหมือนเดิม)"""
    _RUN.clear()
    del _ALERT_LINES[:]
    _ALERT_STATE.update({"indent": None, "cont": 0})
    pending = None
    try:
        _run(argv)
    except SystemExit as e:
        pending = e
    except Exception:
        traceback.print_exc()
        log("❌ ผิดพลาดที่ไม่คาดคิด — ดู traceback ด้านบน")
        pending = SystemExit(1)
    rc = _exit_code_of(pending) if pending is not None else 0
    try:
        _notify_after_run(rc)
    except Exception as e:   # แจ้งเตือนห้ามเปลี่ยนผลของงานหลัก
        log(f"⚠️ แจ้งเตือน Telegram ผิดพลาด ({type(e).__name__}) — งานหลักไม่กระทบ")
    if pending is not None:
        raise pending


def _run(argv=None):
    opts = parse_args(sys.argv[1:] if argv is None else argv)
    _RUN["opts"] = opts
    if opts["notify_test"]:
        sys.exit(run_notify_test(opts))
    if opts["undo"]:
        sys.exit(run_undo(opts))
    if opts["compare"]:
        sys.exit(run_compare(opts))
    dry_run, force = opts["dry_run"], opts["force"]
    want_confirm = opts["confirm"] or opts["confirm_shadow"]
    folder, folder_src = resolve_watch_folder(opts["folder"])
    _RUN["folder"] = folder

    log(f"เริ่มงาน auto R16.104 import  (dry_run={dry_run}, force={force}, สาขา={','.join(opts['branches'])})")
    log(f"เครื่อง: {os.environ.get('COMPUTERNAME', '?')} · ผู้ใช้: {os.environ.get('USERNAME', '?')}")
    log(f"โฟลเดอร์: {folder}   [จาก {folder_src}]")
    log("ปลายทาง: stock_sessions/{branch}_r16_104_meta + chunks + {branch}_r01 (r16Loaded/r16UploadedAt/r16DetailVersion)")
    if want_confirm:
        ratio = opts["max_adj_ratio"] if opts["max_adj_ratio"] is not None else CONFIRM_TRIPWIRE_MAX_ADJ_RATIO
        log(f"Confirm โดยบอท: เขียนจริง={','.join(opts['confirm_branches']) or '-'} · โหมดเงา(สาขาที่เหลือ)={'ใช่' if opts['confirm_shadow'] else 'ไม่'} · "
            f"เพดาน Stock Adj {ratio * 100:.0f}% · ปลายทาง: stock_sessions/{{branch}}/items/* + {{branch}}_confirm_lock + stock_audit_log")

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
    _RUN["file"], _RUN["mtime_bkk"] = os.path.basename(path), mtime_bkk
    now_bkk = _now_bkk()
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

    confirm_ctx = {} if want_confirm else None
    results = {}
    for branch in opts["branches"]:
        try:
            results[branch] = process_branch(branch, by_branch, names, rows[0], r05_rows, path, mtime, opts, today, confirm_ctx)
        except Exception as e:   # สาขาหนึ่งล้มห้ามหยุดสาขาอื่น
            log(f"  ❌ {branch}: {type(e).__name__}: {e}")
            results[branch] = "failed"

    # ขั้น Confirm มาหลังเผยแพร่ timeline ครบทุกสาขาเสมอ — Confirm ค้าง/ล้มห้ามทำให้ timeline ของสาขาอื่นไม่ถูกเผยแพร่
    confirm_results = {}
    if want_confirm:
        for branch in opts["branches"]:
            real = opts["confirm"] and branch in opts["confirm_branches"]
            if not real and not opts["confirm_shadow"]:
                continue
            ctx = confirm_ctx.get(branch)
            if ctx is None:
                log(f"── Confirm {branch} ── ข้าม: ขั้นเผยแพร่ timeline ของสาขานี้ไม่ผ่าน ({results.get(branch)})")
                confirm_results[branch] = {"state": "skipped", "branch": branch, "real": real}
                continue
            try:
                res = confirm_branch(branch, "write" if real else "shadow", ctx, opts, _now_bkk(), mtime_bkk)
            except Exception as e:   # confirm_branch จับ exception เองแล้ว — กันหลุดจากจุดที่ไม่คาดคิด
                log(f"  ❌ Confirm {branch}: {type(e).__name__}: {e}")
                res = {"state": "failed", "branch": branch}
            res["real"] = real
            confirm_results[branch] = res

    _RUN["results"], _RUN["confirm_results"] = results, confirm_results
    summary = " · ".join(f"{b} {r}" for b, r in results.items())
    if confirm_results:
        summary += " · " + _confirm_summary(confirm_results)
    confirm_rc = _confirm_exit_code(confirm_results)
    if any(r == "failed" for r in results.values()) or confirm_rc == 1:
        log(f"❌ จบงานแบบมีสาขาล้มเหลว: {summary}")
        sys.exit(1)
    if any(r == "skipped" for r in results.values()) or confirm_rc == 4:
        log(f"❌ จบงาน แต่มีสาขาตกด่าน (ไม่ได้เขียน): {summary}")
        sys.exit(4)
    if dry_run:
        log(f"✅ DRY-RUN จบ — ยังไม่เขียนอะไรทั้งสิ้น: {summary}")
    else:
        log(f"✅ จบงาน: {summary}")
        if any(r == "written" for r in results.values()):
            log("Desktop สาขายาที่เปิดค้างจะโหลด timeline เองภายในไม่กี่วินาที (toast 'R16 อัปเดตจาก Cloud แล้ว') · เครื่องที่ login ใหม่โหลดตอน login")
        if any(r.get("state") == "confirmed" for r in confirm_results.values()):
            log("Confirm โดยบอทเสร็จแล้ว — พนักงานเปิดเช้าวันถัดไปเห็น Pass/Stock Adj ได้ทันที (ย้อนได้ด้วย --confirm-undo <journal> · journal อยู่ในโฟลเดอร์ confirm_journal)")
    sys.exit(0)


if __name__ == "__main__":
    main()
