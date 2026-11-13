package io.github.mightyx3n.playbigscreen

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.media.AudioManager
import androidx.test.core.app.ApplicationProvider
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf

@RunWith(RobolectricTestRunner::class)
class BridgeTest {
    @get:Rule val tmp = TemporaryFolder()
    private val context: Context = ApplicationProvider.getApplicationContext()
    private val started = ArrayList<Intent>()

    private val host = object : BridgeHost {
        override fun start(intent: Intent): Boolean { started.add(intent); return true }
        override fun openWeb(url: String, done: (JSONObject) -> Unit) = done(JSONObject().put("closed", true).put("url", url))
        override fun play(args: JSONObject, done: (JSONObject) -> Unit) = done(JSONObject().put("position", 12.0))
        override fun exit() {}
    }

    private class Jar : CookieJar {
        val cookies = HashMap<String, String>()
        override fun get(url: String) = cookies.entries.joinToString("; ") { "${it.key}=${it.value}" }.ifEmpty { null }
        override fun set(url: String, setCookie: String) {
            val pair = setCookie.substringBefore(';')
            cookies[pair.substringBefore('=')] = pair.substringAfter('=')
        }
    }

    private fun bridge(jar: CookieJar? = null) = Bridge(context, host, LauncherApps(tmp.newFolder()), DeviceApps(context), jar)

    private fun answer(b: Bridge, method: String, args: JSONObject = JSONObject()): Pair<Any?, String?> {
        var out: Pair<Any?, String?>? = null
        b.handle(method, args) { r, e -> out = r to e }
        return out!!
    }

    @Test fun info() {
        val i = bridge().call("info", JSONObject()) as JSONObject
        assertEquals("android", i.getString("platform"))
        assertTrue(i.has("tv"))
        assertTrue(i.getJSONObject("home").has("isDefault"))
    }

    @Test fun listsAndStartsAndroidApps() {
        val pm = shadowOf(context.packageManager)
        val cn = ComponentName("org.example.radio", "org.example.radio.Main")
        pm.addActivityIfNotPresent(cn)
        pm.addIntentFilterForActivity(cn, IntentFilter(Intent.ACTION_MAIN).apply { addCategory(Intent.CATEGORY_LAUNCHER) })
        val b = bridge()
        val list = b.call("android.list", JSONObject()) as JSONArray
        val radio = (0 until list.length()).map { list.getJSONObject(it) }.first { it.getString("package") == "org.example.radio" }
        assertEquals("/__icon/org.example.radio", radio.getString("icon"))
        b.call("android.launch", JSONObject().put("package", "org.example.radio"))
        assertEquals("org.example.radio.Main", started.last().component?.className)
        val (_, err) = answer(b, "android.launch", JSONObject().put("package", "org.example.none"))
        assertTrue(err!!.contains("can't be opened"))
    }

    @Test fun volume() {
        val b = bridge()
        val audio = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        val max = audio.getStreamMaxVolume(AudioManager.STREAM_MUSIC)
        val v = b.call("volume.set", JSONObject().put("level", 3)) as JSONObject
        assertEquals(3, v.getInt("level"))
        assertEquals(max, v.getInt("max"))
        assertEquals(3, audio.getStreamVolume(AudioManager.STREAM_MUSIC))
        val clamp = b.call("volume.set", JSONObject().put("level", 999)) as JSONObject
        assertEquals(max, clamp.getInt("level"))
    }

    @Test fun httpKeepsCookiesLikeABrowser() {
        TestServer(mapOf(
            "/login" to { _ -> Triple(302, mapOf("Set-Cookie" to "session=abc; Path=/; HttpOnly", "Location" to "/me"), ByteArray(0)) },
            "/me" to { h -> if (h["Cookie"]?.firstOrNull()?.contains("session=abc") == true) Triple(200, mapOf("Content-Type" to "application/json"), """{"name":"anna"}""".toByteArray()) else Triple(401, emptyMap(), "no".toByteArray()) },
            "/pic" to { _ -> Triple(200, emptyMap(), byteArrayOf(0, 1, 2, -1)) },
        )).use { s ->
            val jar = Jar()
            val b = bridge(jar)
            val r = b.call("http", JSONObject().put("url", s.base + "/login").put("method", "POST").put("body", "{}")) as JSONObject
            assertEquals(200, r.getInt("status"))
            assertEquals("""{"name":"anna"}""", r.getString("body"))
            assertEquals("abc", jar.cookies["session"])
            val pic = b.call("http", JSONObject().put("url", s.base + "/pic").put("as", "base64")) as JSONObject
            assertEquals("AAEC/w==", pic.getString("body"))
            val none = b.call("http", JSONObject().put("url", "http://127.0.0.1:1/")) as JSONObject
            assertEquals(0, none.getInt("status"))
            assertTrue(none.getString("error").isNotEmpty())
        }
    }

    @Test fun findsServersOnTheNetwork() {
        TestServer(mapOf("/api/status" to { _ -> Triple(200, emptyMap(), "{\"name\":\"Home\",\"version\":\"0.10.0\",\"needsSetup\":false}".toByteArray()) })).use { s ->
            val port = s.base.substringAfterLast(':').toInt()
            val found = Scan.run(listOf("127.0.0.1", "127.0.0.2"), listOf(port, 1), "/api/status", 500)
            assertEquals(1, found.length())
            assertEquals("http://127.0.0.1:$port", found.getJSONObject(0).getString("url"))
            assertTrue(found.getJSONObject(0).getString("body").contains("Home"))
        }
        assertEquals(254, Scan.neighbours(listOf("192.168.1.19")).size)
        assertTrue(Scan.neighbours(listOf("192.168.1.19")).contains("192.168.1.1"))
    }

    @Test fun httpTakesATimeout() {
        val t0 = System.currentTimeMillis()
        val r = bridge().call("http", JSONObject().put("url", "http://10.255.255.1:81/").put("timeout", 400)) as JSONObject
        assertEquals(0, r.getInt("status"))
        assertTrue("took ${System.currentTimeMillis() - t0} ms", System.currentTimeMillis() - t0 < 5000)
    }

    @Test fun webAndPlayerAnswerWhenClosed() {
        val b = bridge()
        val (web, _) = answer(b, "web.open", JSONObject().put("url", "http://server:8080/"))
        assertEquals(true, (web as JSONObject).getBoolean("closed"))
        val (_, bad) = answer(b, "web.open", JSONObject().put("url", "file:///sdcard/x"))
        assertTrue(bad!!.contains("http"))
        val (played, _) = answer(b, "player.play", JSONObject().put("url", "http://server/x.mp4"))
        assertEquals(12.0, (played as JSONObject).getDouble("position"), 0.0)
    }

    @Test fun settingsAndUnknownCalls() {
        val b = bridge()
        b.call("settings.open", JSONObject().put("page", "wifi"))
        assertEquals(android.provider.Settings.ACTION_WIFI_SETTINGS, started.last().action)
        val (_, err) = answer(b, "nonsense")
        assertTrue(err!!.contains("unknown call"))
    }
}
