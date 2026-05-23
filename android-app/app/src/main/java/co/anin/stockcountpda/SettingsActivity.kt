package co.anin.stockcountpda

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.view.MenuItem
import android.widget.*
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.widget.SwitchCompat

class SettingsActivity : AppCompatActivity() {

    // Preset intent actions พบบ่อยในอุปกรณ์ PDA ต่างๆ
    data class Preset(val label: String, val action: String, val extraKey: String)

    private val presets = listOf(
        Preset("KTE (iTCAN IT68)",       "com.kte.scan.result",                            "code"),
        Preset("iTCAN / Generic",        "android.intent.ACTION_DECODE_DATA",              "barcode_string"),
        Preset("iTCAN (alt action)",     "com.android.server.scannerservice.broadcast",    "barcode_string"),
        Preset("Urovo / iData",          "android.intent.ACTION_DECODE_DATA",              "data"),
        Preset("Newland",                "nlscan.action.SCANNER_RESULT",                   "SCAN_BARCODE_1"),
        Preset("Honeywell",              "com.honeywell.decode.intent.action.EDIT_DATA",   "com.honeywell.decode.intent.extra.DECODE_DATA"),
        Preset("Zebra DataWedge",        "com.symbol.datawedge.api.ACTION",                "com.symbol.datawedge.data_string"),
        Preset("Chainway / iData (2)",   "scan.rcv.message",                               "barocode"),
    )

    private lateinit var etAction: EditText
    private lateinit var etExtraKey: EditText
    private lateinit var swFallback: SwitchCompat
    private lateinit var tvDebugLog: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_settings)
        supportActionBar?.setDisplayHomeAsUpEnabled(true)

        etAction    = findViewById(R.id.etIntentAction)
        etExtraKey  = findViewById(R.id.etExtraKey)
        swFallback  = findViewById(R.id.swFallback)
        tvDebugLog  = findViewById(R.id.tvDebugLog)

        loadPrefs()
        setupPresetButtons()

        findViewById<Button>(R.id.btnSave).setOnClickListener { savePrefs() }
        findViewById<Button>(R.id.btnTestBarcode).setOnClickListener { sendTestBarcode() }
    }

    override fun onOptionsItemSelected(item: MenuItem): Boolean {
        if (item.itemId == android.R.id.home) {
            finish()
            return true
        }
        return super.onOptionsItemSelected(item)
    }

    // ---- Prefs ------------------------------------------------------------

    private fun loadPrefs() {
        val prefs = getSharedPreferences(MainActivity.PREFS_NAME, Context.MODE_PRIVATE)
        etAction.setText(prefs.getString(MainActivity.KEY_INTENT_ACTION, MainActivity.DEFAULT_ACTION))
        etExtraKey.setText(prefs.getString(MainActivity.KEY_EXTRA_KEY, MainActivity.DEFAULT_EXTRA_KEY))
        swFallback.isChecked = prefs.getBoolean(MainActivity.KEY_EXTRA_FALLBACKS, true)
    }

    private fun savePrefs() {
        val action   = etAction.text.toString().trim()
        val extraKey = etExtraKey.text.toString().trim()

        if (action.isEmpty() || extraKey.isEmpty()) {
            Toast.makeText(this, "กรุณากรอกข้อมูลให้ครบ", Toast.LENGTH_SHORT).show()
            return
        }

        getSharedPreferences(MainActivity.PREFS_NAME, Context.MODE_PRIVATE).edit()
            .putString(MainActivity.KEY_INTENT_ACTION, action)
            .putString(MainActivity.KEY_EXTRA_KEY, extraKey)
            .putBoolean(MainActivity.KEY_EXTRA_FALLBACKS, swFallback.isChecked)
            .apply()

        Toast.makeText(this, "บันทึกแล้ว", Toast.LENGTH_SHORT).show()
        appendLog("Saved → action=$action  key=$extraKey")
    }

    // ---- Preset buttons ---------------------------------------------------

    private fun setupPresetButtons() {
        val container = findViewById<LinearLayout>(R.id.presetContainer)
        container.removeAllViews()

        for (preset in presets) {
            val btn = Button(this).apply {
                text = preset.label
                textSize = 11f
                setPadding(16, 8, 16, 8)
                setOnClickListener {
                    etAction.setText(preset.action)
                    etExtraKey.setText(preset.extraKey)
                    appendLog("Preset: ${preset.label}")
                }
            }
            val params = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply { setMargins(0, 0, 0, 8) }
            container.addView(btn, params)
        }
    }

    // ---- Test barcode -----------------------------------------------------

    /**
     * ส่ง broadcast ทดสอบโดยใช้ค่า action/key ที่กรอกไว้
     * เพื่อยืนยันว่า MainActivity รับได้ถูกต้อง
     */
    private fun sendTestBarcode() {
        val action   = etAction.text.toString().trim()
        val extraKey = etExtraKey.text.toString().trim()
        if (action.isEmpty() || extraKey.isEmpty()) {
            Toast.makeText(this, "กรอก Action และ Extra Key ก่อน", Toast.LENGTH_SHORT).show()
            return
        }

        val testBarcode = "8851111000429" // บาร์โค้ดทดสอบ
        val intent = Intent(action).apply {
            putExtra(extraKey, testBarcode)
            setPackage(packageName)
        }
        sendBroadcast(intent)
        appendLog("Sent test broadcast → action=$action  key=$extraKey  val=$testBarcode")
        Toast.makeText(this, "ส่ง broadcast ทดสอบแล้ว\nกลับไปดูที่ Web App", Toast.LENGTH_LONG).show()

        // เปิด MainActivity ถ้ายังไม่อยู่บนสุด
        startActivity(
            Intent(this, MainActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)
        )
    }

    // ---- Debug log --------------------------------------------------------

    private fun appendLog(msg: String) {
        val current = tvDebugLog.text.toString()
        val lines   = current.lines().takeLast(8)
        tvDebugLog.text = (lines + listOf("• $msg")).joinToString("\n")
    }
}
