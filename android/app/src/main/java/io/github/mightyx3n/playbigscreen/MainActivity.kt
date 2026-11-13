package io.github.mightyx3n.playbigscreen

import android.annotation.SuppressLint
import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.view.KeyEvent
import android.webkit.ConsoleMessage
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import org.json.JSONObject
import java.io.File
import java.security.SecureRandom
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger

/**
 * PlayBigScreen: the home screen. The launcher itself is a web page (ui/, in the APK's
 * assets) in one WebView; this activity serves it, answers its calls to the device and
 * passes on Back, Home and app changes.
 */
class MainActivity : Activity(), BridgeHost {
    companion object {
        const val EXTRA_HOME = "pbs.home"
        private const val TAG = "PlayBigScreen"
    }

    private lateinit var web: WebView
    private lateinit var bridge: Bridge
    private lateinit var server: AssetServer
    private lateinit var device: DeviceApps
    private val token: String = ByteArray(24).also { SecureRandom().nextBytes(it) }.joinToString("") { "%02x".format(it) }
    private val work = Executors.newCachedThreadPool()
    private val requests = AtomicInteger(100)
    private val waiting = HashMap<Int, (JSONObject) -> Unit>()
    private var started = false

    private val packages = object : BroadcastReceiver() {
        override fun onReceive(c: Context, i: Intent) {
            device.clearCache()
            emit("apps-changed", null)
        }
    }

    @SuppressLint("SetJavaScriptEnabled", "JavascriptInterface")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        device = DeviceApps(this)
        val apps = LauncherApps(File(filesDir, "apps"))
        server = AssetServer({ p -> try { assets.open(p) } catch (_: Exception) { null } }, apps, device::png, token)
        bridge = Bridge(this, this, apps, device, WebViewCookies)

        web = WebView(this)
        web.setBackgroundColor(Color.parseColor("#070A12"))
        setContentView(web)
        Immersive.apply(window)
        val s = web.settings
        s.javaScriptEnabled = true
        s.domStorageEnabled = true
        s.databaseEnabled = true
        s.mediaPlaybackRequiresUserGesture = false
        // Apps on https origins show pictures and talk to home servers on plain http.
        s.mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
        s.allowFileAccess = false
        s.allowContentAccess = false
        CookieManager.getInstance().setAcceptCookie(true)
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, true)
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)

        web.addJavascriptInterface(NativeApi(), "PBSNative")
        web.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
                val r = server.serve(request.url.toString()) ?: return null
                return WebResourceResponse(r.mime, if (r.mime.startsWith("text/") || r.mime == "application/json") "utf-8" else null, r.status, r.reason, r.headers, r.body)
            }

            // The launcher page never leaves itself; apps' frames may go where they like.
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                if (!request.isForMainFrame) return false
                return request.url.host != AssetServer.UI_HOST
            }
        }
        web.webChromeClient = object : WebChromeClient() {
            override fun onConsoleMessage(m: ConsoleMessage): Boolean {
                if (BuildConfig.DEBUG) android.util.Log.d(TAG, "${m.message()} (${m.sourceId()}:${m.lineNumber()})")
                return true
            }
        }
        web.loadUrl(AssetServer.UI_URL)
        web.requestFocus()

        val f = IntentFilter().apply {
            addAction(Intent.ACTION_PACKAGE_ADDED)
            addAction(Intent.ACTION_PACKAGE_REMOVED)
            addAction(Intent.ACTION_PACKAGE_CHANGED)
            addAction(Intent.ACTION_PACKAGE_REPLACED)
            addDataScheme("package")
        }
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(packages, f, Context.RECEIVER_EXPORTED) else registerReceiver(packages, f)
    }

    /** What the launcher page can call. Every call carries the page's token. */
    inner class NativeApi {
        @JavascriptInterface
        fun call(callToken: String, id: Int, method: String, json: String) {
            if (callToken != token) return // not the launcher page (an app's frame, say)
            val args = try { JSONObject(json) } catch (_: Exception) { JSONObject() }
            work.execute {
                bridge.handle(method, args) { result, error -> reply(id, result, error) }
            }
        }
    }

    private fun js(code: String) = runOnUiThread { web.evaluateJavascript(code, null) }

    private fun literal(v: Any?): String = JSONObject().put("v", v ?: JSONObject.NULL).toString()
        .replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")

    private fun reply(id: Int, result: Any?, error: String?) {
        val m = JSONObject()
        if (error != null) m.put("error", error) else m.put("result", result ?: JSONObject.NULL)
        js("window.__pbs&&window.__pbs.reply($id,${m.toString().replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")})")
    }

    fun emit(event: String, data: Any?) {
        js("window.__pbs&&window.__pbs.event(${JSONObject.quote(event)},${literal(data)}.v)")
    }

    // ---- BridgeHost --------------------------------------------------------------------

    override fun start(intent: Intent): Boolean {
        if (intent.resolveActivity(packageManager) == null) return false
        return try { runOnUiThread { try { startActivity(intent) } catch (_: Exception) {} }; true } catch (_: ActivityNotFoundException) { false }
    }

    private fun forResult(intent: Intent, done: (JSONObject) -> Unit) {
        runOnUiThread {
            val code = requests.incrementAndGet() and 0xffff
            waiting[code] = done
            try {
                @Suppress("DEPRECATION")
                startActivityForResult(intent, code)
            } catch (e: Exception) {
                waiting.remove(code)
                done(JSONObject().put("error", e.message))
            }
        }
    }

    override fun openWeb(url: String, done: (JSONObject) -> Unit) {
        forResult(Intent(this, WebActivity::class.java).putExtra(WebActivity.EXTRA_URL, url).putExtra(WebActivity.EXTRA_TV, bridge.isTv()), done)
    }

    override fun play(args: JSONObject, done: (JSONObject) -> Unit) {
        val headers = HashMap<String, String>()
        args.optJSONObject("headers")?.let { h -> h.keys().forEach { headers[it] = h.optString(it) } }
        val i = Intent(this, PlayerActivity::class.java)
            .putExtra("url", args.getString("url"))
            .putExtra("title", args.optString("title"))
            .putExtra("subtitle", args.optString("subtitle"))
            .putExtra("start", (args.optDouble("start", 0.0) * 1000).toLong())
            .putExtra("headers", headers)
        forResult(i) { r -> done(r) }
    }

    @Deprecated("Uses the platform's activity results.")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        @Suppress("DEPRECATION")
        super.onActivityResult(requestCode, resultCode, data)
        val done = waiting.remove(requestCode) ?: return
        val out = JSONObject()
        if (data != null) {
            if (data.hasExtra("position")) {
                out.put("position", data.getLongExtra("position", 0) / 1000.0)
                out.put("duration", data.getLongExtra("duration", 0) / 1000.0)
                out.put("ended", data.getBooleanExtra("ended", false))
            }
            if (data.hasExtra("closed")) out.put("closed", true)
        }
        done(out)
    }

    override fun exit() {
        runOnUiThread { if (!device.isDefaultHome()) moveTaskToBack(true) }
    }

    // ---- Keys and lifecycle --------------------------------------------------------------

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        when (event.keyCode) {
            // Back goes to the page (it closes what's open, or goes Home).
            KeyEvent.KEYCODE_BACK, KeyEvent.KEYCODE_ESCAPE -> {
                if (event.action == KeyEvent.ACTION_UP && !event.isCanceled) emit("back", null)
                return true
            }
            KeyEvent.KEYCODE_MENU -> {
                if (event.action == KeyEvent.ACTION_UP) emit("menu", null)
                return true
            }
        }
        return super.dispatchKeyEvent(event)
    }

    @Deprecated("Back is handled in dispatchKeyEvent; this covers gesture back.")
    override fun onBackPressed() = emit("back", null)

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        // Home pressed while we're the home app (or the helper sent us): show Home.
        if (intent.hasCategory(Intent.CATEGORY_HOME) || intent.getBooleanExtra(EXTRA_HOME, false)) emit("home", null)
    }

    override fun onResume() {
        super.onResume()
        Immersive.apply(window)
        if (started) emit("resume", null)
        started = true
    }

    override fun onDestroy() {
        try { unregisterReceiver(packages) } catch (_: Exception) {}
        work.shutdown()
        web.destroy()
        super.onDestroy()
    }
}
