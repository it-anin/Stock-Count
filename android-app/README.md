# Stock Count PDA — Android App

WebView wrapper สำหรับ [anin-stock-count.vercel.app](https://anin-stock-count.vercel.app/)
รองรับ Hardware Barcode Scanner ทั้ง Keyboard Wedge และ Intent Broadcast

---

## โครงสร้างไฟล์

```
android-app/
├── settings.gradle
├── build.gradle
├── gradle/wrapper/gradle-wrapper.properties
└── app/
    ├── build.gradle
    ├── proguard-rules.pro
    └── src/main/
        ├── AndroidManifest.xml
        ├── java/co/anin/stockcountpda/
        │   ├── MainActivity.kt        ← WebView + BroadcastReceiver
        │   └── SettingsActivity.kt   ← กำหนดค่า Intent Action / Extra Key
        └── res/
            ├── layout/activity_main.xml
            ├── layout/activity_settings.xml
            ├── menu/main_menu.xml
            └── values/strings.xml, themes.xml
```

---

## วิธี Build APK ด้วย Android Studio

### ขั้นตอนที่ 1 — เตรียม Android Studio

1. ติดตั้ง **Android Studio Hedgehog (2023.1)** หรือใหม่กว่า
   - ดาวน์โหลดที่: https://developer.android.com/studio
2. เปิด Android Studio → **File → Open** → เลือกโฟลเดอร์ `android-app/`

### ขั้นตอนที่ 2 — Sync Project

- Android Studio จะ sync gradle อัตโนมัติ (อาจใช้เวลา 1-3 นาทีครั้งแรก)
- ถ้ามี error ให้กด **File → Invalidate Caches → Restart**

### ขั้นตอนที่ 3 — เพิ่ม App Icon (ถ้าต้องการ)

- คลิกขวาที่ `app/src/main/res` → **New → Image Asset**
- เลือก Launcher Icons → ใส่รูปที่ต้องการ

### ขั้นตอนที่ 4 — Build Debug APK

```
Build → Build Bundle(s) / APK(s) → Build APK(s)
```

APK จะอยู่ที่: `app/build/outputs/apk/debug/app-debug.apk`

### ขั้นตอนที่ 5 — Build Release APK (สำหรับ deploy จริง)

1. **Build → Generate Signed Bundle / APK**
2. เลือก **APK**
3. สร้าง Keystore ใหม่ (ครั้งแรก) หรือเลือก keystore เดิม
4. เลือก **release** build variant
5. กด **Finish** → APK อยู่ที่ `app/build/outputs/apk/release/`

---

## วิธีติดตั้งบน iTCAN IT68

### วิธีที่ 1 — ADB (แนะนำสำหรับ IT department)

```bash
# เชื่อมต่อ PDA ผ่าน USB
adb install app-debug.apk

# ถ้า update แอปเก่า
adb install -r app-debug.apk
```

### วิธีที่ 2 — Copy ผ่าน USB Storage

1. Copy `.apk` ไปไว้ใน storage ของ PDA
2. เปิด File Manager บน PDA → tap ที่ไฟล์ .apk
3. กด **ติดตั้ง** (อนุญาต Unknown sources ถ้า popup ขึ้น)

### วิธีที่ 3 — Wi-Fi / Share Link

ส่งไฟล์ .apk ผ่าน Google Drive / Telegram แล้วเปิดในเครื่อง PDA

---

## ตั้งค่า Scanner บน PDA (สำคัญ!)

### 1. เปิดแอป แล้วไปที่ **⚙ Settings** (icon ด้านบนขวา)

### 2. กรอก Intent Action

PDA ส่วนใหญ่จะใช้ค่าใดค่าหนึ่งต่อไปนี้:

| อุปกรณ์ | Intent Action | Extra Key |
|---------|--------------|-----------|
| **iTCAN IT68 (ลอง 1)** | `android.intent.ACTION_DECODE_DATA` | `barcode_string` |
| **iTCAN IT68 (ลอง 2)** | `com.android.server.scannerservice.broadcast` | `barcode_string` |
| Urovo / iData | `android.intent.ACTION_DECODE_DATA` | `data` |
| Newland | `nlscan.action.SCANNER_RESULT` | `SCAN_BARCODE_1` |
| Zebra DataWedge | `com.symbol.datawedge.api.ACTION` | `com.symbol.datawedge.data_string` |

### 3. กด **ทดสอบ — ส่ง Broadcast ทดสอบ**

- กลับมาดูที่หน้า Web App
- ถ้าเห็น barcode `8851111000429` ปรากฏในช่อง scan = ✅ ค่าถูกต้อง
- ถ้าไม่มีอะไรเกิดขึ้น = ลอง Intent Action อื่น

### 4. วิธีหา Intent Action ของ IT68 ถ้าไม่มีในรายการ

**วิธีที่ 1**: เปิด **Scanner Settings** บน PDA (มักอยู่ใน Settings → Scanner)
ดูที่ "Output Method" หรือ "Data Transfer" หาคำว่า "Intent"

**วิธีที่ 2**: ใช้แอป [Barcode Scanner](https://play.google.com/store/apps/details?id=com.google.zxing.client.android)
กดสแกน แล้ดู logcat ด้วย ADB:
```bash
adb logcat | grep -i "barcode\|scan\|decode"
```

**วิธีที่ 3**: ถามผู้ผลิต iTCAN โดยตรง ขอ "Scanner SDK" หรือ "Intent Action documentation"

---

## โหมด Keyboard Wedge (ทำงานอัตโนมัติ)

ถ้า PDA ตั้งเป็น **Keyboard Wedge** mode (พิมพ์ค่าลง focused input):
- ไม่ต้องตั้งค่าอะไรเพิ่ม
- Web App detect PDA scanner อัตโนมัติจาก keystroke timing < 50ms
- ระบบ submit อัตโนมัติ 200ms หลังตัวอักษรสุดท้าย

---

## การทำงานของแอป

```
Scanner สแกน barcode
    │
    ├─[Keyboard Wedge]──→ พิมพ์เข้า input ที่ focus → Web App ประมวลผล
    │
    └─[Intent Broadcast]─→ BroadcastReceiver รับ
                            → extractBarcode(intent)
                            → webView.evaluateJavascript("receiveBarcode('...')")
                            → Web App: receiveBarcode() → processScan()
```

---

## Troubleshooting

| ปัญหา | วิธีแก้ |
|------|---------|
| เปิดแอปแล้วหน้าจอขาว | รอ 5-10 วินาที หรือกด Reload |
| ไม่สามารถเชื่อมต่อ | ตรวจสอบ Wi-Fi ของ PDA |
| สแกนแล้วไม่มีอะไรเกิดขึ้น | ลอง Intent Action อื่น (Settings → Test) |
| App crash | ตรวจ logcat: `adb logcat -s StockCountPDA` |
| Web app ไม่ login | ตรวจ Firebase / Firestore ว่า allow origin ถูกต้อง |

---

## Package / App Info

- **Package:** `co.anin.stockcountpda`
- **Min Android:** 5.0 (API 21)
- **Target:** Android 14 (API 34)
- **Permissions:** INTERNET, ACCESS_NETWORK_STATE เท่านั้น
