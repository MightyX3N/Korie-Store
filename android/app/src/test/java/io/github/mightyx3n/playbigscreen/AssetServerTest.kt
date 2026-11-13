package io.github.mightyx3n.playbigscreen

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.ByteArrayInputStream
import java.io.File

class AssetServerTest {
    @get:Rule val tmp = TemporaryFolder()

    private val files = mapOf(
        "ui/index.html" to "<!doctype html><html><head><title>x</title></head><body></body></html>",
        "ui/assets/app.js" to "console.log(1)",
        "sdk/playbigscreen.js" to "window.pbs={}",
    )

    private fun server(): Pair<AssetServer, File> {
        val root = tmp.newFolder("apps")
        File(root, "romm").mkdirs()
        File(root, "romm/app.json").writeText("""{"id":"romm","name":"RomM","version":"1.0.0","entry":"index.html"}""")
        File(root, "romm/index.html").writeText("<h1>RomM</h1>")
        File(root.parentFile, "secret.txt").writeText("no")
        val s = AssetServer({ p -> files[p]?.let { ByteArrayInputStream(it.toByteArray()) } }, LauncherApps(root), { pkg, _ -> if (pkg == "org.example.files") byteArrayOf(1, 2) else null }, "tok123")
        return s to root
    }

    private fun text(s: Served) = String(s.body.readBytes())

    @Test fun launcherPageGetsTheTokenAndCantBeFramed() {
        val (s) = server()
        for (u in listOf("https://ui.playbigscreen/", "https://ui.playbigscreen/index.html", "https://ui.playbigscreen/store")) {
            val r = s.serve(u)!!
            assertEquals(200, r.status)
            assertTrue(text(r).contains("window.__pbsToken=\"tok123\""))
            assertEquals("DENY", r.headers["X-Frame-Options"])
        }
    }

    @Test fun launcherFilesAndIcons() {
        val (s) = server()
        assertEquals("console.log(1)", text(s.serve("https://ui.playbigscreen/assets/app.js")!!))
        assertEquals("text/javascript", s.serve("https://ui.playbigscreen/assets/app.js")!!.mime)
        assertEquals(404, s.serve("https://ui.playbigscreen/assets/none.js")!!.status)
        assertEquals("image/png", s.serve("https://ui.playbigscreen/__icon/org.example.files")!!.mime)
        assertEquals(404, s.serve("https://ui.playbigscreen/__icon/org.example.nothing")!!.status)
    }

    @Test fun appsHaveTheirOwnOriginAndStayInTheirFolder() {
        val (s) = server()
        val r = s.serve("https://romm.app.playbigscreen/")!!
        assertEquals(200, r.status)
        assertEquals("<h1>RomM</h1>", text(r))
        assertEquals("frame-ancestors https://ui.playbigscreen", r.headers["Content-Security-Policy"])
        assertTrue(!text(s.serve("https://romm.app.playbigscreen/index.html")!!).contains("__pbsToken"))
        assertEquals(404, s.serve("https://romm.app.playbigscreen/../secret.txt")!!.status)
        assertEquals(404, s.serve("https://romm.app.playbigscreen/%2e%2e/secret.txt")!!.status)
        assertEquals(404, s.serve("https://other.app.playbigscreen/index.html")!!.status)
        assertTrue(s.serve("https://Bad_Id.app.playbigscreen/index.html")?.status != 200)
        assertEquals("window.pbs={}", text(s.serve("https://romm.app.playbigscreen/__pbs/sdk.js")!!))
        assertEquals(404, s.serve("https://romm.app.playbigscreen/__pbs/other.js")!!.status)
    }

    @Test fun otherAddressesGoToTheNetwork() {
        val (s) = server()
        assertNull(s.serve("https://example.com/"))
        assertNull(s.serve("http://ui.playbigscreen/"))
    }
}
