# Auto R01.102 Import → Firestore

ดึงไฟล์ `Allstock.CSV` (R01.102 รวมทุกสาขา) ที่ถูก export มาวางในโฟลเดอร์
แล้วแยกตาม **Col D** เป็น 3 สาขา เขียนเข้า Firestore โดยอัตโนมัติทุกวัน **08:10**
— ไม่ต้องเปิดเว็บ ไม่ต้องอัปไฟล์เอง

| Col D ในไฟล์ | → Firestore doc |
|---|---|
| `Front Store` | `stock_sessions/SRC_r01` |
| `Main KKL` | `stock_sessions/KKL_r01` |
| `Main SSS` | `stock_sessions/SSS_r01` |
| `Warehouse` | **ข้าม** (WH จัดการ R01 เอง) |

แอป (index.html) อ่าน doc เหล่านี้ผ่าน `restoreMasterFromFirestore()` เหมือนตอนอัปไฟล์ด้วยมือทุกประการ

---

## ไฟล์ในโฟลเดอร์นี้

| ไฟล์ | หน้าที่ |
|---|---|
| `auto_r01_import.py` | สคริปต์หลัก (Python stdlib ล้วน — ไม่ต้องลง pip) |
| `run_auto_r01.bat` | ตัวเรียกสำหรับ Task Scheduler + เก็บ log |
| `auto_r01.log` | log การรัน (สร้างอัตโนมัติ) |

---

## ⚙️ ค่าที่ตั้งไว้ (แก้ได้ในหัวไฟล์ `auto_r01_import.py`)

```python
WATCH_FOLDER = r"C:\Users\BigYa-spare\Desktop\run-upload-stock"  # โฟลเดอร์ที่ไฟล์ถูกวาง
FILE_GLOB    = "Allstock*.csv"                                   # รูปแบบชื่อไฟล์ (เลือกไฟล์ใหม่สุด)
```

> ถ้าย้ายโฟลเดอร์ หรือชื่อไฟล์เปลี่ยน → แก้ 2 ค่านี้พอ

---

## ✅ ทดสอบก่อนใช้จริง (ไม่เขียน Firestore)

```powershell
python "C:\Users\BigYa-spare\Desktop\Stock-Count\auto-r01\auto_r01_import.py" --dry-run
```

จะพิมพ์ยอดต่อสาขา + สถิติการข้าม โดย**ไม่เขียน**อะไรขึ้น Firestore
ควรเห็นยอด SRC / KKL / SSS ใกล้เคียงจำนวน SKU จริง และ `สาขาไม่รู้จัก=0`

## ▶️ รันจริง (เขียน Firestore)

```powershell
python "C:\Users\BigYa-spare\Desktop\Stock-Count\auto-r01\auto_r01_import.py"
```

---

## ⏰ ตั้งเวลา 08:10 ทุกวัน (Windows Task Scheduler)

### วิธีที่ 1 — คำสั่งเดียว (เปิด PowerShell/CMD)

```powershell
schtasks /Create /TN "AutoR01Import" /TR "\"C:\Users\BigYa-spare\Desktop\Stock-Count\auto-r01\run_auto_r01.bat\"" /SC DAILY /ST 08:10 /F
```

ตรวจ / ลบงาน:
```powershell
schtasks /Query /TN "AutoR01Import"      # ดูสถานะ
schtasks /Run   /TN "AutoR01Import"      # สั่งรันทันที (ทดสอบ)
schtasks /Delete /TN "AutoR01Import" /F  # ลบงาน
```

### วิธีที่ 2 — ผ่านหน้าจอ Task Scheduler

1. เปิด **Task Scheduler** → **Create Basic Task**
2. Name: `AutoR01Import` → Next
3. Trigger: **Daily** → เวลา **08:10** → Next
4. Action: **Start a program**
5. Program/script: `C:\Users\BigYa-spare\Desktop\Stock-Count\auto-r01\run_auto_r01.bat`
6. Finish

> **ให้ทำงานแม้ไม่ได้ login:** เปิด properties ของงาน → เลือก *"Run whether user is logged on or not"* (ต้องใส่รหัสผ่าน Windows). ถ้าเครื่องเปิดค้างและ login อยู่ตลอด ไม่ต้องตั้งก็ได้

---

## ข้อควรรู้ / ข้อจำกัด

- **ไม่ติด time gate ของเว็บ** — สคริปต์เขียน Firestore ตรง ไม่ผ่าน UI จึงทำงานตอน 08:10 ได้ (กฎ "R01 อัปได้หลัง 21:00" อยู่ฝั่งหน้าเว็บเท่านั้น)
- **เครื่องเป้าหมายต้องเปิดอยู่ตอน 08:10** และไฟล์ `Allstock.CSV` ต้องถูก export มาวางก่อนเวลานั้น
- ถ้าไฟล์ไม่ใช่ของวันนี้ สคริปต์จะเตือนใน log แต่ยัง**ดำเนินการต่อ** (ป้องกันลืมไม่ได้ดึง แต่ไม่บล็อก)
- สาขาที่ parse ได้ 0 รายการจะ**ถูกข้าม** (ไม่เขียนทับ doc เดิมด้วยค่าว่าง) — กันกรณีไฟล์เพี้ยน
- การเขียนใช้ Firebase REST API + API key สาธารณะ(ตัวเดียวกับเว็บ) ภายใต้ Firestore rules ปัจจุบัน — **ทดสอบแล้วเขียนได้** (HTTP 200)
- **เครื่องที่ค้าง R01 เก่าใน localStorage:** แอปจะโหลด R01 ใหม่จาก Firestore เมื่อ local ว่าง หรือกด Admin → ออก เพื่อ force restore — ปกติแต่ละเช้าเป็นรอบนับใหม่จึงไม่ค่อยเป็นปัญหา

---

## ตรวจ log

```powershell
Get-Content "C:\Users\BigYa-spare\Desktop\Stock-Count\auto-r01\auto_r01.log" -Tail 20
```
