# -*- coding: utf-8 -*-
"""
เปิดเซิร์ฟเวอร์ PromaxxHelper จริง (socket จริงบน 127.0.0.1 พอร์ตสุ่ม) ด้วยตัวต่อปลอมของ ssmaxx — ใช้ในเทสที่ต้องยิง HTTP จริง
(CORS/preflight/Host/concurrency และ e2e กับหน้าเว็บ)

อ่านค่าจาก argv[1] (JSON): helper_dir · lib_dir · tmp · origins · verified · fake · user · password
  + uia (true = ใช้ตัวต่อปลอมแบบ WPF/UIA ของ fake_ssmaxx_uia: ฟอร์มเอกสาร · ตารางรายละเอียด · กล่อง Select File · ปุ่ม ตกลง — ทดสอบนำเข้าอัตโนมัติ รุ่น .6 ผ่านหน้าเว็บจริง)
  + settings (ค่าเพิ่มของ Settings เช่น {"auto_confirm": true}) · uia_flags (แฟล็กจำลองความผิดพลาดของ FakeWpfUI) · debug (true = เปิดพอร์ตอ่านสถานะตัวต่อปลอม: GET → JSON)
พิมพ์ {"port": N, "dbg": M|null} บรรทัดแรกทาง stdout แล้วรอจน stdin ปิด (เทสปิด stdin = หยุดเซิร์ฟเวอร์)
"""
import json
import os
import sys
import threading

opts = json.loads(sys.argv[1])
sys.path.insert(0, opts["helper_dir"])
sys.path.insert(0, opts["lib_dir"])
import promaxx_helper as m      # noqa: E402
import fake_ssmaxx as fk        # noqa: E402

settings_kw = {"allowed_origins": tuple(opts.get("origins", [m.PROD_ORIGIN]))}
settings_kw.update(opts.get("settings", {}))
if opts.get("uia"):
    import fake_ssmaxx_uia as fku   # noqa: E402
    svc, ui, log, st = fku.make_uia(
        m, opts["tmp"], verified=opts.get("verified", True), user=opts.get("user", "somchai"), password=opts.get("password", "s3cret!pw"),
        settings_kw=settings_kw, uia=opts.get("uia_flags"), log_path=os.path.join(opts["tmp"], "helper.log"), **opts.get("fake", {}))
else:
    svc, ui, log, st = fk.make(
        m, opts["tmp"], verified=opts.get("verified", True), user=opts.get("user", "somchai"), password=opts.get("password", "s3cret!pw"),
        settings_kw=settings_kw, log_path=os.path.join(opts["tmp"], "helper.log"), **opts.get("fake", {}))
srv = m.make_server(svc, "127.0.0.1", 0)
dbg_port = None
if opts.get("debug"):
    from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

    class _Dbg(BaseHTTPRequestHandler):
        def do_GET(self):
            d = st.import_dir
            files = sorted(os.listdir(d)) if os.path.isdir(d) else []
            data = {"state": getattr(ui, "state", None), "ok_clicks": getattr(ui, "ok_clicks", None), "saved": getattr(ui, "saved", None),
                    "table": getattr(ui, "table", None), "file_loaded": getattr(ui, "file_loaded", ""), "misfires": getattr(ui, "misfires", None),
                    "ticket": bool(svc.ticket), "files": files,
                    "filesData": {f: open(os.path.join(d, f), "rb").read().decode("utf-8") for f in files}}
            body = json.dumps(data, ensure_ascii=False).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *a):
            pass

    dsrv = ThreadingHTTPServer(("127.0.0.1", 0), _Dbg)
    dbg_port = dsrv.server_address[1]
    threading.Thread(target=dsrv.serve_forever, daemon=True).start()
print(json.dumps({"port": srv.server_address[1], "dbg": dbg_port}))
sys.stdout.flush()
threading.Thread(target=srv.serve_forever, daemon=True).start()
sys.stdin.read()
srv.shutdown()
