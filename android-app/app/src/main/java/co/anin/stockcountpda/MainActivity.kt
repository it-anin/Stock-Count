package co.anin.stockcountpda

import android.annotation.SuppressLint
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.Bitmap
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.Build
import android.os.Bundle
import android.view.Menu
import android.view.MenuItem
import android.view.View
import android.webkit.*
import android.widget.Button
import android.widget.ProgressBar
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import org.json.JSONArray

class MainActivity : AppCompatActivity() {

    companion object {
        const val WEB_URL = "https://anin-stock-count.vercel.app/"

        // SharedPreferences keys (ต้องตรงกับ SettingsActivity)
        const val PREFS_NAME = "ScannerPrefs"
        const val KEY_INTENT_ACTION = "intent_action"
        const val KEY_EXTRA_KEY = "extra_key"
        const val KEY_EXTRA_FALLBACKS = "extra_fallbacks_enabled"

        const val DEFAULT_ACTION = "android.intent.ACTION_DECODE_DATA"
        const val DEFAULT_EXTRA_KEY = "barcode_string"

        // Extra keys ที่ลองตามลำดับเมื่อ fallback เปิดอยู่
        val FALLBACK_EXTRA_KEYS = listOf(
            "barcode_string",
            "data",
            "SCAN_BARCODE_1",
            "scanResult",
            "scannerdata",
            "com.symbol.datawedge.data_string",
            "decode_data",
            "barcodeData"
        )
    }

    private lateinit var webView: WebView
    private lateinit var progressBar: ProgressBar
    private lateinit var errorView: View
    private lateinit var tvErrorMsg: TextView

    private var scanReceiver: BroadcastReceiver? = null

    // ---- Lifecycle --------------------------------------------------------

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        webView    = findViewById(R.id.webView)
        progressBar = findViewById(R.id.progressBar)
        errorView  = findViewById(R.id.errorView)
        tvErrorMsg = findViewById(R.id.tvErrorMsg)

        setupWebView()
        findViewById<Button>(R.id.btnRetry).setOnClickListener { loadWebApp() }
        loadWebApp()
    }

    override fun onResume() {
        super.onResume()
        registerScanReceiver()
    }

    override fun onPause() {
        super.onPause()
        unregisterScanReceiver()
    }

    override fun onDestroy() {
        webView.destroy()
        super.onDestroy()
    }

    // ---- WebView ----------------------------------------------------------

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWebView() {
        with(webView.settings) {
            javaScriptEnabled        = true
            domStorageEnabled        = true
            databaseEnabled          = true
            allowFileAccess          = true
            useWideViewPort          = true
            loadWithOverviewMode     = true
            setSupportZoom(false)
            builtInZoomControls      = false
            mixedContentMode         = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
            cacheMode                = WebSettings.LOAD_DEFAULT
            mediaPlaybackRequiresUserGesture = false
            // ทำให้ Web App รู้ว่ากำลังรันใน PDA Android app
            userAgentString          = userAgentString + " StockCountPDA/1.0 Android"
        }

        webView.webViewClient = object : WebViewClient() {

            override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) {
                progressBar.visibility = View.VISIBLE
                errorView.visibility   = View.GONE
                webView.visibility     = View.VISIBLE
            }

            override fun onPageFinished(view: WebView, url: String) {
                progressBar.visibility = View.GONE
            }

            override fun onReceivedError(
                view: WebView,
                request: WebResourceRequest,
                error: WebResourceError
            ) {
                if (request.isForMainFrame) {
                    progressBar.visibility = View.GONE
                    webView.visibility     = View.GONE
                    errorView.visibility   = View.VISIBLE
                    val code = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M)
                        error.errorCode else -1
                    val desc = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M)
                        error.description else "Network error"
                    tvErrorMsg.text = "ไม่สามารถเชื่อมต่อได้ (error $code)\n$desc\n\nตรวจสอบการเชื่อมต่อ Wi-Fi แล้วกด ลองใหม่"
                }
            }

            // อย่าเปิด URL อื่นออกจาก WebView (ป้องกันกดลิงก์แล้วออกแอป)
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                return false
            }
        }

        webView.webChromeClient = object : WebChromeClient() {
            override fun onProgressChanged(view: WebView, newProgress: Int) {
                progressBar.progress = newProgress
            }
        }

        // Enable Web Notifications permission ให้เว็บแอปใช้งานได้
        webView.webChromeClient = object : WebChromeClient() {
            override fun onProgressChanged(view: WebView, newProgress: Int) {
                progressBar.progress = newProgress
            }
            override fun onPermissionRequest(request: PermissionRequest) {
                request.grant(request.resources)
            }
        }
    }

    private fun loadWebApp() {
        if (!isNetworkAvailable()) {
            errorView.visibility   = View.VISIBLE
            webView.visibility     = View.GONE
            progressBar.visibility = View.GONE
            tvErrorMsg.text        = "ไม่มีการเชื่อมต่ออินเทอร์เน็ต\nกรุณาเชื่อมต่อ Wi-Fi แล้วกด ลองใหม่"
            return
        }
        errorView.visibility = View.GONE
        webView.visibility   = View.VISIBLE
        webView.loadUrl(WEB_URL)
    }

    private fun isNetworkAvailable(): Boolean {
        val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            val net = cm.activeNetwork ?: return false
            val cap = cm.getNetworkCapabilities(net) ?: return false
            cap.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
        } else {
            @Suppress("DEPRECATION")
            cm.activeNetworkInfo?.isConnected == true
        }
    }

    // ---- Barcode Injection ------------------------------------------------

    /**
     * ฉีด barcode เข้า Web App โดยเรียก receiveBarcode() ที่ฝังอยู่ใน web app
     * พร้อม fallback ไปใช้การ set ค่า input โดยตรงถ้า receiveBarcode ไม่มี
     */
    private fun injectBarcode(raw: String) {
        val barcode = raw.trim()
        if (barcode.isEmpty()) return

        // JSON.stringify ที่ปลอดภัย — ไม่มี injection
        val jsonStr = JSONArray().apply { put(barcode) }.toString()
        // jsonStr = ["barcode"] → ดึง quoted string ออกมา
        val quoted = jsonStr.substring(1, jsonStr.length - 1) // → "barcode"

        val js = """
            (function(b){
                if(typeof receiveBarcode==='function'){
                    receiveBarcode(b);
                    return;
                }
                // fallback: inject ตรงไปยัง scanInput
                var el=document.getElementById('scanInput');
                if(!el) return;
                el.value=b;
                el.dispatchEvent(new KeyboardEvent('keydown',{
                    key:'Enter',keyCode:13,which:13,bubbles:true,cancelable:true
                }));
            })($quoted)
        """.trimIndent()

        runOnUiThread {
            webView.evaluateJavascript(js, null)
        }
    }

    // ---- BroadcastReceiver (Intent Broadcast Mode) ------------------------

    private fun registerScanReceiver() {
        val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val action   = prefs.getString(KEY_INTENT_ACTION, DEFAULT_ACTION) ?: DEFAULT_ACTION
        val extraKey = prefs.getString(KEY_EXTRA_KEY, DEFAULT_EXTRA_KEY) ?: DEFAULT_EXTRA_KEY
        val fallbackEnabled = prefs.getBoolean(KEY_EXTRA_FALLBACKS, true)

        scanReceiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context, intent: Intent) {
                val barcode = extractBarcode(intent, extraKey, fallbackEnabled) ?: return
                if (barcode.isNotBlank()) injectBarcode(barcode)
            }
        }

        val filter = IntentFilter(action)
        // รับ action รองที่พบบ่อยในอุปกรณ์ iTCAN / Urovo / Newland
        listOf(
            "com.android.server.scannerservice.broadcast",
            "nlscan.action.SCANNER_RESULT",
            "com.urovo.i9000s.action",
            "scan.rcv.message",
            "android.intent.action.DECODE_DATA"
        ).filter { it != action }.forEach { filter.addAction(it) }

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                registerReceiver(scanReceiver, filter, RECEIVER_EXPORTED)
            } else {
                @Suppress("UnspecifiedRegisterReceiverFlag")
                registerReceiver(scanReceiver, filter)
            }
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    private fun unregisterScanReceiver() {
        scanReceiver?.let {
            try { unregisterReceiver(it) } catch (_: Exception) {}
            scanReceiver = null
        }
    }

    /**
     * ลองดึง barcode จาก Intent extra
     * ลอง primaryKey ก่อน → ถ้าไม่เจอและ fallback เปิดอยู่ ให้ลอง key สำรอง
     */
    private fun extractBarcode(intent: Intent, primaryKey: String, useFallback: Boolean): String? {
        intent.getStringExtra(primaryKey)?.let { return it }
        if (!useFallback) return null
        for (key in FALLBACK_EXTRA_KEYS) {
            if (key == primaryKey) continue
            intent.getStringExtra(key)?.let { return it }
        }
        // บาง scanner ส่งเป็น ByteArray
        intent.getByteArrayExtra("barcode_bytes")?.let {
            return String(it).trim()
        }
        return null
    }

    // ---- Menu -------------------------------------------------------------

    override fun onCreateOptionsMenu(menu: Menu): Boolean {
        menuInflater.inflate(R.menu.main_menu, menu)
        return true
    }

    override fun onOptionsItemSelected(item: MenuItem): Boolean = when (item.itemId) {
        R.id.action_settings -> {
            startActivity(Intent(this, SettingsActivity::class.java))
            true
        }
        R.id.action_reload -> {
            loadWebApp()
            true
        }
        else -> super.onOptionsItemSelected(item)
    }

    // ---- Back navigation --------------------------------------------------

    @Deprecated("Deprecated in API 33; kept for minSdk 21 compat")
    override fun onBackPressed() {
        if (webView.canGoBack()) webView.goBack()
        else super.onBackPressed()
    }
}
