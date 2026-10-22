# Firestore REST จำลองในหน่วยความจำ — ใช้กับเทสบอท auto-r16 (Confirm) ที่ต้องคุมจังหวะ/ความล้มเหลวได้แบบแน่นอน
#
# แทน m._request ของบอท (ทุกฟังก์ชัน REST ของบอทผ่านจุดนี้จุดเดียว) จึงเทสโค้ดจริงของบอทตั้งแต่สร้าง URL/body ถึงอ่านผลตอบ
# ⚠️ นี่ไม่ใช่ Firestore จริง: ความเที่ยงตรงของ REST (precondition/transform/query/rules) ตรวจที่ e2e/auto-r16-confirm.spec.js กับ emulator
#    ที่ทำจำลองไว้ที่นี่ = เท่าที่บอทใช้: GET/PATCH/DELETE เอกสาร · runQuery (== ซ้อน AND) · documents:commit (update/delete + updateMask +
#    updateTransforms REQUEST_TIME + currentDocument exists/updateTime · atomic ทั้งชุด)
# ห้ามใช้ไฟล์นี้กับอย่างอื่นนอกเทส · ใช้ Python stdlib ล้วน
import io
import json
import urllib.error
import urllib.parse
from datetime import datetime, timedelta, timezone


def _fmt(t):
    return t.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")


class FakeFirestore:
    def __init__(self, m, base_time):
        self.m = m                      # โมดูลบอท — ใช้ _project_id()/to_typed ของจริง
        self.t = base_time              # datetime utc · เพิ่ม 1 ms ต่อการ commit/เขียน
        self.docs = {}                  # rel path -> {'fields': typed, 'create': str, 'update': str}
        self.requests = []              # ['GET stock_sessions/SSS_r01', 'POST commit n=3', ...]
        self.writes = []                # [{'op': 'update'|'delete', 'path': rel, 'commit': n}] เฉพาะที่ "สำเร็จจริง"
        self.script = []                # hook ความล้มเหลว (ดู _apply_script)
        self.commit_count = 0
        self.items_commit_count = 0

    # ---- เตรียมข้อมูล ----
    def _tick(self):
        self.t = self.t + timedelta(milliseconds=1)
        return _fmt(self.t)

    def put(self, rel, plain):
        """ใส่เอกสารจากค่า Python ธรรมดา · {'__ts': 'RFC3339'} = timestampValue"""
        fields = {}
        for k, v in plain.items():
            if isinstance(v, dict) and set(v) == {"__ts"}:
                fields[k] = {"timestampValue": v["__ts"]}
            else:
                fields[k] = self.m.to_typed(v)
        ts = self._tick()
        self.docs[rel] = {"fields": fields, "create": ts, "update": ts}

    def touch(self, rel, **plain):
        """จำลองคนอื่นแก้เอกสาร — เปลี่ยน updateTime (และ field ที่ระบุ)"""
        d = self.docs[rel]
        for k, v in plain.items():
            d["fields"][k] = self.m.to_typed(v)
        d["update"] = self._tick()

    def plain(self, rel):
        d = self.docs.get(rel)
        return None if d is None else self.m.plain_fields(d["fields"])

    def snapshot(self):
        return {rel: {"fields": self.m.plain_fields(d["fields"]), "update": d["update"]} for rel, d in self.docs.items()}

    # ---- จุดเข้าเดียวแทน m._request ----
    def request(self, req, timeout=120, retries=3):
        url = urllib.parse.urlparse(req.full_url)
        root = f"/v1/projects/{self.m._project_id()}/databases/(default)/documents"
        if not url.path.startswith(root):
            raise AssertionError(f"คำขอนอก Firestore REST ของโปรเจกต์: {req.full_url}")
        rel = url.path[len(root):].lstrip("/")
        rel = "/".join(urllib.parse.unquote(s) for s in rel.split("/"))
        qs = urllib.parse.parse_qs(url.query)
        method = req.get_method()
        body = json.loads(req.data.decode("utf-8")) if req.data else None
        # hook ระดับคำขอ (ไม่ใช่ commit): {'type': 'http', 'match': 'runQuery', 'nth': 1, 'code': 503} → ตอบ error แทน (นับเฉพาะคำขอที่ "METHOD rel" มี match)
        for h in self.script:
            if h.get("type") == "http" and not h.get("done") and h["match"] in f"{method} {rel}":
                h["seen"] = h.get("seen", 0) + 1
                if h["seen"] == h.get("nth", 1):
                    h["done"] = True
                    self.requests.append(f"{method} {rel} -> HTTP {h['code']}")
                    self._err(h["code"], h.get("status", "UNAVAILABLE"), "injected")
        # {'type': 'touch_before_request'|'touch_after_request', 'match': 'PATCH stock_sessions/SSS_r01', 'nth': 1, 'path': rel, 'set': {...}}
        # แก้เอกสารก่อน/หลังคำขอที่ n ที่ "METHOD rel" มี match — ไว้จำลองคนอื่นแก้ในช่องว่างระหว่างขั้นของบอท (เช่น หลังเผยแพร่ timeline ก่อน preflight)
        self._touch_hooks("touch_before_request", method, rel)
        resp = self._dispatch(method, rel, qs, body)
        self._touch_hooks("touch_after_request", method, rel)
        return resp

    def _touch_hooks(self, kind, method, rel):
        for h in self.script:
            if h.get("type") == kind and not h.get("done") and h["match"] in f"{method} {rel}":
                h["seen"] = h.get("seen", 0) + 1
                if h["seen"] == h.get("nth", 1):
                    h["done"] = True
                    self.touch(h["path"], **h.get("set", {}))

    def _dispatch(self, method, rel, qs, body):
        if rel == ":commit":
            return self._commit(body)
        if rel.endswith(":runQuery"):
            return self._run_query(rel[: -len(":runQuery")], body)
        if method == "GET":
            return self._get(rel, qs)
        if method == "PATCH":
            return self._patch(rel, qs, body)
        if method == "DELETE":
            self.requests.append(f"DELETE {rel}")
            self.docs.pop(rel, None)
            return b"{}"
        raise AssertionError(f"คำขอที่เทสจำลองไม่รู้จัก: {method} {rel}")

    # ---- อ่าน ----
    def _doc_json(self, rel, d, mask=None):
        fields = d["fields"] if not mask else {k: v for k, v in d["fields"].items() if k in mask}
        return {"name": f"projects/{self.m._project_id()}/databases/(default)/documents/{rel}", "fields": fields,
                "createTime": d["create"], "updateTime": d["update"]}

    def _err(self, code, status, msg="", url="fake"):
        raise urllib.error.HTTPError(url, code, status, None,
                                     io.BytesIO(json.dumps({"error": {"code": code, "status": status, "message": msg}}).encode("utf-8")))

    def _get(self, rel, qs):
        self.requests.append(f"GET {rel}")
        d = self.docs.get(rel)
        if d is None:
            self._err(404, "NOT_FOUND", "no document")
        return json.dumps(self._doc_json(rel, d, qs.get("mask.fieldPaths"))).encode("utf-8")

    def _patch(self, rel, qs, body):
        self.requests.append(f"PATCH {rel}")
        mask = qs.get("updateMask.fieldPaths")
        cur = self.docs.get(rel)
        fields = dict(cur["fields"]) if cur else {}
        incoming = body.get("fields") or {}
        for f in (mask if mask is not None else list(incoming)):
            if f in incoming:
                fields[f] = incoming[f]
            else:
                fields.pop(f, None)
        ts = self._tick()
        self.docs[rel] = {"fields": fields, "create": cur["create"] if cur else ts, "update": ts}
        return json.dumps(self._doc_json(rel, self.docs[rel])).encode("utf-8")

    def _run_query(self, parent, body):
        self.requests.append(f"POST runQuery {parent}")
        sq = body["structuredQuery"]
        coll = sq["from"][0]["collectionId"]
        where = sq.get("where") or {}
        filters = [f["fieldFilter"] for f in where["compositeFilter"]["filters"]] if "compositeFilter" in where else ([where["fieldFilter"]] if where else [])
        for f in filters:
            assert f["op"] == "EQUAL", "เทสจำลองรองรับเฉพาะ =="
        prefix = f"{parent}/{coll}/"
        out = []
        for rel, d in sorted(self.docs.items()):
            if not rel.startswith(prefix) or "/" in rel[len(prefix):]:
                continue
            if all(d["fields"].get(f["field"]["fieldPath"]) == f["value"] for f in filters):
                out.append({"document": self._doc_json(rel, d), "readTime": _fmt(self.t)})
        if not out:
            out.append({"readTime": _fmt(self.t)})
        return json.dumps(out).encode("utf-8")

    # ---- commit (atomic) ----
    def _rel_of(self, name):
        marker = "/documents/"
        return name[name.index(marker) + len(marker):]

    def _apply_script(self, writes):
        """hook ความล้มเหลวที่เทสกำหนดไว้ใน self.script — คืน action ของ commit นี้ (None = ปกติ)
        {'type': 'touch_before_commit', 'match': 'items/', 'nth': 2, 'path': rel}   แก้เอกสารก่อน commit ที่ n (นับเฉพาะ commit ที่แตะ match)
        {'type': 'drop', 'match': 'items/', 'nth': 1, 'mode': 'after'|'before'|'503'}   จำลองเครือข่ายหลุด/5xx"""
        action = None
        paths = [self._rel_of((w.get("update") or {}).get("name") or w.get("delete")) for w in writes]
        for h in self.script:
            if h.get("done") or h.get("type") in ("http", "touch_before_request", "touch_after_request"):
                continue
            if not any(h["match"] in p for p in paths):
                continue
            h["seen"] = h.get("seen", 0) + 1
            if h["seen"] != h.get("nth", 1):
                continue
            h["done"] = True
            if h["type"] == "touch_before_commit":
                self.touch(h["path"], **h.get("set", {}))
            elif h["type"] == "drop":
                action = h["mode"]
        return action

    def _commit(self, body):
        writes = body["writes"]
        self.commit_count += 1
        n = self.commit_count
        touches_items = any("/items/" in ((w.get("update") or {}).get("name") or w.get("delete") or "") for w in writes)
        if touches_items:
            self.items_commit_count += 1
        self.requests.append(f"POST commit n={len(writes)}{' items' if touches_items else ''}")
        action = self._apply_script(writes)
        if action == "before":
            raise urllib.error.URLError("connection reset (before apply)")
        if action == "503":
            self._err(503, "UNAVAILABLE", "try again")
        commit_time = self._tick()
        # 1) ตรวจ precondition ทั้งชุดบนสำเนา (ชุดเดียวกันอ้างเอกสารซ้ำไม่ได้ในกรณีของบอท จึงตรวจกับสถานะปัจจุบันตรงๆ)
        work = {rel: {"fields": dict(d["fields"]), "create": d["create"], "update": d["update"]} for rel, d in self.docs.items()}
        results = []
        applied = []
        for w in writes:
            rel = self._rel_of((w.get("update") or {}).get("name") or w.get("delete"))
            cur = work.get(rel)
            pre = w.get("currentDocument") or {}
            if "exists" in pre:
                if pre["exists"] and cur is None:
                    self._err(404, "NOT_FOUND", f"{rel} ไม่มี")
                if (not pre["exists"]) and cur is not None:
                    self._err(409, "ALREADY_EXISTS", f"{rel} มีแล้ว")
            if "updateTime" in pre:
                if cur is None:
                    self._err(404, "NOT_FOUND", f"{rel} ไม่มี")
                if cur["update"] != pre["updateTime"]:
                    self._err(400, "FAILED_PRECONDITION", f"{rel} updateTime ไม่ตรง")
            if "update" in w:
                inc = w["update"].get("fields") or {}
                mask = (w.get("updateMask") or {}).get("fieldPaths")
                fields = dict(cur["fields"]) if (cur and mask is not None) else {}
                if mask is None:
                    fields = dict(inc)
                else:
                    for f in mask:
                        if f in inc:
                            fields[f] = inc[f]
                        else:
                            fields.pop(f, None)
                for tr in w.get("updateTransforms") or []:
                    assert tr.get("setToServerValue") == "REQUEST_TIME", "เทสจำลองรองรับเฉพาะ REQUEST_TIME"
                    fields[tr["fieldPath"]] = {"timestampValue": commit_time}
                work[rel] = {"fields": fields, "create": cur["create"] if cur else commit_time, "update": commit_time}
                applied.append(("update", rel))
            else:
                work.pop(rel, None)
                applied.append(("delete", rel))
            results.append({"updateTime": commit_time})
        # 2) ผ่านทั้งชุด → เขียนจริง (atomic)
        self.docs = work
        for op, rel in applied:
            self.writes.append({"op": op, "path": rel, "commit": n})
        if action == "after":
            raise urllib.error.URLError("connection reset (after apply)")
        return json.dumps({"writeResults": results, "commitTime": commit_time}).encode("utf-8")
