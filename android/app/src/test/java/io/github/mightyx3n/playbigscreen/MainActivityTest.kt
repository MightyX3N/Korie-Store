package io.github.mightyx3n.playbigscreen

import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Looper
import android.view.KeyEvent
import android.webkit.WebResourceRequest
import android.webkit.WebView
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf

@RunWith(RobolectricTestRunner::class)
class MainActivityTest {
    private fun req(url: String) = object : WebResourceRequest {
        override fun getUrl(): Uri = Uri.parse(url)
        override fun isForMainFrame() = true
        override fun isRedirect() = false
        override fun hasGesture() = false
        override fun getMethod() = "GET"
        override fun getRequestHeaders(): Map<String, String> = emptyMap()
    }

    private fun settle(web: WebView, until: () -> Boolean) {
        repeat(100) {
            shadowOf(Looper.getMainLooper()).idle()
            if (until()) return
            Thread.sleep(20)
        }
    }

    @Test fun canBeTheHomeScreen() {
        val ctx = androidx.test.core.app.ApplicationProvider.getApplicationContext<android.content.Context>()
        val homes = ctx.packageManager.queryIntentActivities(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME).addCategory(Intent.CATEGORY_DEFAULT), PackageManager.MATCH_DEFAULT_ONLY)
        assertTrue(homes.any { it.activityInfo.name == MainActivity::class.java.name })
        val tv = ctx.packageManager.queryIntentActivities(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LEANBACK_LAUNCHER), 0)
        assertTrue(tv.any { it.activityInfo.name == MainActivity::class.java.name })
    }

    @Test fun servesTheLauncherAndAnswersOnlyItsOwnPage() {
        val a = Robolectric.buildActivity(MainActivity::class.java).setup().get()
        val web = a.window.decorView.findViewById<android.view.ViewGroup>(android.R.id.content).getChildAt(0) as WebView
        val sw = shadowOf(web)
        assertEquals(AssetServer.UI_URL, sw.lastLoadedUrl)

        val client = sw.webViewClient
        val page = client.shouldInterceptRequest(web, req(AssetServer.UI_URL))
        assertNotNull(page)
        val html = String(page!!.data.readBytes())
        val token = Regex("__pbsToken=\"([0-9a-f]+)\"").find(html)!!.groupValues[1]
        assertEquals(48, token.length)
        assertNotNull(client.shouldInterceptRequest(web, req("https://ui.playbigscreen/__pbs/sdk.js")))
        assertNull(client.shouldInterceptRequest(web, req("https://example.com/")))
        // The page itself can't be sent elsewhere.
        assertTrue(client.shouldOverrideUrlLoading(web, req("https://example.com/")))

        val api = sw.getJavascriptInterface("PBSNative") as MainActivity.NativeApi
        // A frame without the token gets nothing.
        api.call("wrong", 7, "info", "{}")
        settle(web) { false }
        assertTrue(sw.lastEvaluatedJavascript?.contains("reply(7") != true)
        // The launcher page gets its answer.
        api.call(token, 8, "info", "{}")
        settle(web) { sw.lastEvaluatedJavascript?.contains("reply(8") == true }
        val js = sw.lastEvaluatedJavascript!!
        assertTrue(js, js.contains("\"platform\":\"android\""))

        // Back goes to the page.
        a.dispatchKeyEvent(KeyEvent(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_BACK))
        a.dispatchKeyEvent(KeyEvent(KeyEvent.ACTION_UP, KeyEvent.KEYCODE_BACK))
        settle(web) { sw.lastEvaluatedJavascript?.contains("\"back\"") == true }
        assertTrue(sw.lastEvaluatedJavascript!!.contains("event(\"back\""))
        assertTrue(!a.isFinishing)
    }
}
