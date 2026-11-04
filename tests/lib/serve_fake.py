# -*- coding: utf-8 -*-
"""
เปิดเซิร์ฟเวอร์ PromaxxHelper จริง (socket จริงบน 127.0.0.1 พอร์ตสุ่ม) ด้วยตัวต่อปลอมของ ssmaxx — ใช้ในเทสที่ต้องยิง HTTP จริง
(CORS/preflight/Host/concurrency และ e2e กับหน้าเว็บ)

อ่านค่าจาก argv[1] (JSON): helper_dir · lib_dir · tmp · origins · verified · fake · user · password
พิมพ์ {"port": N} บรรทัดแรกทาง stdout แล้วรอจน stdin ปิด (เทสปิด stdin = หยุดเซิร์ฟเวอร์)
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

svc, ui, log, st = fk.make(
    m, opts["tmp"], verified=opts.get("verified", True), user=opts.get("user", "somchai"), password=opts.get("password", "s3cret!pw"),
    settings_kw={"allowed_origins": tuple(opts.get("origins", [m.PROD_ORIGIN]))}, log_path=os.path.join(opts["tmp"], "helper.log"), **opts.get("fake", {}))
srv = m.make_server(svc, "127.0.0.1", 0)
print(json.dumps({"port": srv.server_address[1]}))
sys.stdout.flush()
threading.Thread(target=srv.serve_forever, daemon=True).start()
sys.stdin.read()
srv.shutdown()
