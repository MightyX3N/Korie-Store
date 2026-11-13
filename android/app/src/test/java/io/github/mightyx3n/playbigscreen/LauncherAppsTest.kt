package io.github.mightyx3n.playbigscreen

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.io.File

@RunWith(RobolectricTestRunner::class)
class LauncherAppsTest {
    @get:Rule val tmp = TemporaryFolder()

    private val manifest = """{"id":"demo","name":"Demo","version":"1.0.0","entry":"index.html"}""".toByteArray()
    private val page = "<h1>demo</h1>".toByteArray()
    private val css = "body{}".toByteArray()

    private fun repo() = TestServer(mapOf(
        "/apps/demo/app.json" to { _ -> Triple(200, emptyMap(), manifest) },
        "/apps/demo/index.html" to { _ -> Triple(200, emptyMap(), page) },
        "/apps/demo/css/app.css" to { _ -> Triple(200, emptyMap(), css) },
    ))

    private fun files(vararg pairs: Pair<String, ByteArray>) = JSONObject().apply { pairs.forEach { (k, v) -> put(k, Net.sha256(v)) } }

    @Test fun installsChecksListsAndRemoves() {
        repo().use { r ->
            val apps = LauncherApps(tmp.newFolder("apps"))
            apps.install("demo", r.base + "/apps/demo/", files("app.json" to manifest, "index.html" to page, "css/app.css" to css))
            val list = apps.list()
            assertEquals(1, list.length())
            assertEquals("https://demo.app.playbigscreen/", list.getJSONObject(0).getString("url"))
            assertEquals("body{}", File(apps.dirOf("demo"), "css/app.css").readText())
            apps.remove("demo")
            assertEquals(0, apps.list().length())
        }
    }

    @Test fun refusesFilesThatDontMatch() {
        repo().use { r ->
            val apps = LauncherApps(tmp.newFolder("apps"))
            val bad = files("app.json" to manifest).put("index.html", "0".repeat(64))
            try {
                apps.install("demo", r.base + "/apps/demo/", bad)
                fail("installed a file with the wrong checksum")
            } catch (e: IllegalStateException) {
                assertTrue(e.message!!.contains("checksum"))
            }
            assertEquals(0, apps.list().length())
            assertNull(apps.dirOf("demo"))
        }
    }

    @Test fun refusesBadIdsAndPaths() {
        val apps = LauncherApps(tmp.newFolder("apps"))
        assertFalse(LauncherApps.validId("../x"))
        assertFalse(LauncherApps.validId("Big"))
        assertTrue(LauncherApps.validId("romm"))
        val base = tmp.newFolder("b")
        assertNull(LauncherApps.inside(base, "../etc/passwd"))
        assertNull(LauncherApps.inside(base, "a/../../x"))
        assertTrue(LauncherApps.inside(base, "a/b.txt")!!.path.endsWith("a${File.separator}b.txt"))
        try { apps.install("../evil", "http://127.0.0.1/", JSONObject().put("app.json", "x")); fail() } catch (_: IllegalArgumentException) {}
    }
}
