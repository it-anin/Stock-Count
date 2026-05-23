package co.anin.stockcountpda

import android.annotation.SuppressLint
import android.app.AlertDialog
import android.app.DownloadManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.Bitmap
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.os.PowerManager
import android.provider.Settings
import android.view.Menu
import android.view.MenuItem
import android.view.View
import android.webkit.*
import android.widget.Button
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.FileProvider
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

class MainActivity : AppCompatActivity() {

    companion object {
        const val WEB_URL         = "https://anin-stock-count.vercel.app/"
        const val VERSION_URL     = "https://anin-stock-count.vercel.app/version.json"
        const val APK_FILE_NAME   = "StockCountPDA.apk"

        const val PREFS_NAME             = "ScannerPrefs"
        const val KEY_INTENT_ACTION      = "intent_action"
        const val KEY_EXTRA_KEY          = "extra_key"
        const val KEY_EXTRA_FALLBACKS    = "extra_fallbacks_enabled"
        const val DEFAULT_ACTION         = "com.kte.scan.result"
        const val DEFAULT_EXTRA_KEY      = "code"

        val FALLBACK_EXTRA_KEYS = listOf(
            "barcode_string", "data", "SCAN_BARCODE_1", "scanResult",
            "scannerdata", "com.symbol.datawedge.data_string", "decode_data", "barcodeData",
            "code"
        )
    }

    private lateinit var webView: WebView
    private lateinit var progressBar: ProgressBar
    private lateinit var errorView: View
    private lateinit var tvErrorMsg: TextView

    private var scanReceiver: BroadcastReceiver? = null
    private var downloadId: Long = -1
    private var pendingInstallFile: File? = null
    private var wakeLock: PowerManager.WakeLock? = null

    // ---- Lifecycle --------------------------------------------------------

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        webView     = findViewById(R.id.webView)
        progressBar = findViewById(R.id.progressBar)
        errorView   = findViewById(R.id.errorView)
        tvErrorMsg  = findViewById(R.id.tvErrorMsg)

        setupWebView()
        findViewById<Button>(R.id.btnRetry).setOnClickListener { loadWebApp() }
        loadWebApp()
        checkForUpdate()
    }

    override fun onResume() {
        super.onResume()
        acquireWakeLock()
        registerScanReceiver()
        // กลับมาจากหน้า "อนุญาตติดตั้งแอป" → ลองติดตั้งอีกครั้ง
        pendingInstallFile?.let { file ->
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
                packageManager.canRequestPackageInstalls()
            ) {
                triggerInstall(file)
                pendingInstallFile = null
            }
        }
    }

    override fun onPause() {
        super.onPause()
        unregisterScanReceiver()
        releaseWakeLock()
    }

    override fun onDestroy() {
        webView.destroy()
        super.onDestroy()
    }

    // ---- WakeLock (keep screen on during scanning) ------------------------

    private fun acquireWakeLock() {
        if (wakeLock?.isHeld == true) return
        val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
        @Suppress("DEPRECATION")
        wakeLock = pm.newWakeLock(
            PowerManager.SCREEN_BRIGHT_WAKE_LOCK or PowerManager.ON_AFTER_RELEASE,
            "StockCountPDA:ScanWakeLock"
        ).also { it.acquire(4 * 60 * 60 * 1000L) } // max 4 hours
    }

    private fun releaseWakeLock() {
        wakeLock?.takeIf { it.isHeld }?.release()
        wakeLock = null
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
            userAgentString          = "$userAgentString StockCountPDA/1.0"
        }

        // ให้ WebView ใช้ GPU render แทน CPU — ลด jank บน PDA ที่ CPU ช้า
        webView.setLayerType(View.LAYER_TYPE_HARDWARE, null)

        webView.webViewClient = object : WebViewClient() {
            override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) {
                progressBar.visibility = View.VISIBLE
                errorView.visibility   = View.GONE
                webView.visibility     = View.VISIBLE
            }
            override fun onPageFinished(view: WebView, url: String) {
                progressBar.visibility = View.GONE
            }
            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                if (request.isForMainFrame) {
                    progressBar.visibility = View.GONE
                    webView.visibility     = View.GONE
                    errorView.visibility   = View.VISIBLE
                    val code = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) error.errorCode else -1
                    val desc = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) error.description else "Network error"
                    tvErrorMsg.text = "ไม่สามารถเชื่อมต่อได้ (error $code)\n$desc\n\nตรวจสอบ Wi-Fi แล้วกด ลองใหม่"
                }
            }
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest) = false
        }

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
            val cap = cm.getNetworkCapabilities(cm.activeNetwork ?: return false) ?: return false
            cap.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
        } else {
            @Suppress("DEPRECATION")
            cm.activeNetworkInfo?.isConnected == true
        }
    }

    // ---- Barcode Injection ------------------------------------------------

    private fun injectBarcode(raw: String) {
        val barcode = raw.trim()
        if (barcode.isEmpty()) return
        val quoted = JSONArray().apply { put(barcode) }.toString().let {
            it.substring(1, it.length - 1)
        }
        val js = """
            (function(b){
                if(typeof receiveBarcode==='function'){ receiveBarcode(b); return; }
                var el=document.getElementById('scanInput');
                if(!el) return;
                el.value=b;
                el.dispatchEvent(new KeyboardEvent('keydown',{
                    key:'Enter',keyCode:13,which:13,bubbles:true,cancelable:true
                }));
            })($quoted)
        """.trimIndent()
        runOnUiThread { webView.evaluateJavascript(js, null) }
    }

    // ---- Self-Update System -----------------------------------------------

    private fun checkForUpdate() {
        Thread {
            try {
                val conn = URL(VERSION_URL).openConnection() as HttpURLConnection
                conn.connectTimeout = 6000
                conn.readTimeout    = 6000
                conn.connect()
                if (conn.responseCode != 200) return@Thread
                val json        = JSONObject(conn.inputStream.bufferedReader().readText())
                val remoteCode: Int = json.getInt("versionCode")
                val localCode: Int  = BuildConfig.VERSION_CODE
                if (remoteCode <= localCode) return@Thread
                val dlUrl   = json.getString("downloadUrl")
                val vName   = json.optString("versionName", "ใหม่")
                val notes   = json.optString("releaseNotes", "")
                runOnUiThread { showUpdateDialog(vName, notes, dlUrl) }
            } catch (_: Exception) {
                // ไม่มีเน็ต หรือ endpoint ยังไม่มี → ไม่แสดงอะไร
            }
        }.start()
    }

    private fun showUpdateDialog(versionName: String, notes: String, downloadUrl: String) {
        val msg = buildString {
            append("มีเวอร์ชันใหม่ v$versionName พร้อมให้อัปเดต")
            if (notes.isNotBlank()) append("\n\n$notes")
            append("\n\nกด อัปเดต เพื่อดาวน์โหลดและติดตั้งอัตโนมัติ")
        }
        AlertDialog.Builder(this)
            .setTitle("🔄 มีอัปเดตใหม่")
            .setMessage(msg)
            .setPositiveButton("อัปเดต") { _, _ -> startDownload(downloadUrl) }
            .setNegativeButton("ภายหลัง", null)
            .setCancelable(false)
            .show()
    }

    private fun startDownload(url: String) {
        // ลบไฟล์เก่าถ้ามี
        File(getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), APK_FILE_NAME)
            .takeIf { it.exists() }?.delete()

        val request = DownloadManager.Request(Uri.parse(url))
            .setTitle("Stock Count PDA — กำลังดาวน์โหลดอัปเดต")
            .setDescription("กรุณารอสักครู่...")
            .setDestinationInExternalFilesDir(this, Environment.DIRECTORY_DOWNLOADS, APK_FILE_NAME)
            .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE)
            .setAllowedNetworkTypes(
                DownloadManager.Request.NETWORK_WIFI or DownloadManager.Request.NETWORK_MOBILE
            )

        val dm = getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
        downloadId = dm.enqueue(request)

        Toast.makeText(this, "กำลังดาวน์โหลด... ดูความคืบหน้าที่แถบแจ้งเตือน", Toast.LENGTH_LONG).show()

        val receiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context, intent: Intent) {
                val id = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1)
                if (id != downloadId) return
                try { unregisterReceiver(this) } catch (_: Exception) {}
                val file = File(getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), APK_FILE_NAME)
                if (file.exists()) installApk(file)
                else Toast.makeText(this@MainActivity, "ดาวน์โหลดล้มเหลว กรุณาลองใหม่", Toast.LENGTH_LONG).show()
            }
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(receiver, IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE), RECEIVER_EXPORTED)
        } else {
            @Suppress("UnspecifiedRegisterReceiverFlag")
            registerReceiver(receiver, IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE))
        }
    }

    private fun installApk(file: File) {
        // Android 8+ ต้องตรวจสอบ permission "ติดตั้งแอปจากแหล่งนี้"
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
            !packageManager.canRequestPackageInstalls()
        ) {
            pendingInstallFile = file
            Toast.makeText(this, "กรุณาเปิด 'อนุญาตจากแหล่งนี้' แล้วกลับมาแอป", Toast.LENGTH_LONG).show()
            startActivity(
                Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:$packageName"))
            )
            return
        }
        triggerInstall(file)
    }

    private fun triggerInstall(file: File) {
        val apkUri = FileProvider.getUriForFile(this, "$packageName.provider", file)
        startActivity(
            Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(apkUri, "application/vnd.android.package-archive")
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
            }
        )
    }

    // ---- BroadcastReceiver (Intent Scanner) -------------------------------

    private fun registerScanReceiver() {
        val prefs        = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val action       = prefs.getString(KEY_INTENT_ACTION, DEFAULT_ACTION) ?: DEFAULT_ACTION
        val extraKey     = prefs.getString(KEY_EXTRA_KEY, DEFAULT_EXTRA_KEY) ?: DEFAULT_EXTRA_KEY
        val useFallback  = prefs.getBoolean(KEY_EXTRA_FALLBACKS, true)

        scanReceiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context, intent: Intent) {
                val barcode = extractBarcode(intent, extraKey, useFallback) ?: return
                if (barcode.isNotBlank()) injectBarcode(barcode)
            }
        }

        val filter = IntentFilter(action)
        listOf(
            "com.kte.scan.result",
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
        } catch (_: Exception) {}
    }

    private fun unregisterScanReceiver() {
        scanReceiver?.let {
            try { unregisterReceiver(it) } catch (_: Exception) {}
            scanReceiver = null
        }
    }

    private fun extractBarcode(intent: Intent, primaryKey: String, useFallback: Boolean): String? {
        intent.getStringExtra(primaryKey)?.let { return it }
        if (!useFallback) return null
        for (key in FALLBACK_EXTRA_KEYS) {
            if (key == primaryKey) continue
            intent.getStringExtra(key)?.let { return it }
        }
        return intent.getByteArrayExtra("barcode_bytes")?.let { String(it).trim() }
    }

    // ---- Menu -------------------------------------------------------------

    override fun onCreateOptionsMenu(menu: Menu): Boolean {
        menuInflater.inflate(R.menu.main_menu, menu)
        return true
    }

    override fun onOptionsItemSelected(item: MenuItem): Boolean = when (item.itemId) {
        R.id.action_settings -> { startActivity(Intent(this, SettingsActivity::class.java)); true }
        R.id.action_reload   -> { loadWebApp(); true }
        else                 -> super.onOptionsItemSelected(item)
    }

    // ---- Back navigation --------------------------------------------------

    @Deprecated("Deprecated in API 33")
    override fun onBackPressed() {
        if (webView.canGoBack()) webView.goBack() else super.onBackPressed()
    }
}
