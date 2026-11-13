package io.github.mightyx3n.playbigscreen

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout

/**
 * A web page full screen, for launcher apps that open a server's own web app (PlayTheater,
 * RomM's player). It shares the launcher's cookies, so a sign-in done in the app counts.
 * Back goes back in the page, then closes it.
 */
class WebActivity : Activity() {
    companion object {
        const val EXTRA_URL = "url"
        const val EXTRA_TV = "tv"
    }

    private lateinit var web: WebView
    private lateinit var root: FrameLayout
    private var fullView: View? = null
    private var fullCallback: WebChromeClient.CustomViewCallback? = null

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        root = FrameLayout(this)
        web = WebView(this)
        root.addView(web, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        setContentView(root)
        Immersive.apply(window)

        val s = web.settings
        s.javaScriptEnabled = true
        s.domStorageEnabled = true
        s.mediaPlaybackRequiresUserGesture = false
        s.mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
        s.loadWithOverviewMode = true
        s.useWideViewPort = true
        // Sites can tell they're on PlayBigScreen (and on a TV), e.g. to pick a TV layout.
        val version = try { packageManager.getPackageInfo(packageName, 0).versionName } catch (_: Exception) { "" }
        s.userAgentString = s.userAgentString + " PlayBigScreen/$version" + if (intent.getBooleanExtra(EXTRA_TV, false)) " TV" else ""
        CookieManager.getInstance().setAcceptCookie(true)
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, true)

        web.webViewClient = WebViewClient()
        web.webChromeClient = object : WebChromeClient() {
            override fun onShowCustomView(view: View, callback: CustomViewCallback) {
                fullView = view; fullCallback = callback
                root.addView(view, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
                web.visibility = View.GONE
            }
            override fun onHideCustomView() {
                fullView?.let { root.removeView(it) }
                fullView = null
                fullCallback = null
                web.visibility = View.VISIBLE
            }
        }
        if (savedInstanceState != null) web.restoreState(savedInstanceState) else web.loadUrl(intent.getStringExtra(EXTRA_URL) ?: "about:blank")
        web.requestFocus()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        web.saveState(outState)
    }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (event.keyCode == KeyEvent.KEYCODE_BACK || event.keyCode == KeyEvent.KEYCODE_ESCAPE) {
            if (event.action == KeyEvent.ACTION_UP) goBack()
            return true
        }
        return super.dispatchKeyEvent(event)
    }

    @Deprecated("Back is handled in dispatchKeyEvent; this covers gesture back.")
    override fun onBackPressed() = goBack()

    private fun goBack() {
        when {
            fullView != null -> fullCallback?.onCustomViewHidden()
            web.canGoBack() -> web.goBack()
            else -> { setResult(RESULT_OK, Intent().putExtra("closed", true)); finish() }
        }
    }

    override fun onDestroy() {
        CookieManager.getInstance().flush()
        web.destroy()
        super.onDestroy()
    }
}
