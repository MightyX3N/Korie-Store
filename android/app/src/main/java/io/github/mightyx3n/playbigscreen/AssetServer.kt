package io.github.mightyx3n.playbigscreen

import java.io.ByteArrayInputStream
import java.io.File
import java.io.InputStream
import java.net.URI

/** What the WebView gets for a request to one of PlayBigScreen's own hosts. */
class Served(val status: Int, val mime: String, val headers: Map<String, String>, val body: InputStream) {
    val reason: String get() = if (status == 200) "OK" else "Not Found"
}

/**
 * Answers the launcher's own addresses, which never go to the network:
 *   https://ui.playbigscreen/...          the launcher (from the APK's assets)
 *   https://<id>.app.playbigscreen/...    a launcher app's files (each app its own origin)
 *   .../__pbs/sdk.js, pbs.css, lexend.woff2   the app SDK, on every app's origin
 */
class AssetServer(
    private val assets: (String) -> InputStream?,
    private val apps: LauncherApps,
    private val icons: (pkg: String, banner: Boolean) -> ByteArray?,
    private val token: String,
) {
    companion object {
        const val UI_HOST = "ui.playbigscreen"
        const val APP_DOMAIN = "app.playbigscreen"
        const val UI_URL = "https://$UI_HOST/"
        private val SDK_FILES = mapOf("sdk.js" to "sdk/playbigscreen.js", "pbs.css" to "sdk/pbs.css", "lexend.woff2" to "sdk/lexend.woff2")

        fun mimeOf(path: String): String = when (path.substringAfterLast('.', "").lowercase()) {
            "html", "htm" -> "text/html"
            "js", "mjs" -> "text/javascript"
            "css" -> "text/css"
            "json" -> "application/json"
            "svg" -> "image/svg+xml"
            "png" -> "image/png"
            "jpg", "jpeg" -> "image/jpeg"
            "webp" -> "image/webp"
            "gif" -> "image/gif"
            "woff2" -> "font/woff2"
            "woff" -> "font/woff"
            "ttf" -> "font/ttf"
            "mp3" -> "audio/mpeg"
            "mp4" -> "video/mp4"
            "wasm" -> "application/wasm"
            "txt" -> "text/plain"
            else -> "application/octet-stream"
        }
    }

    private fun notFound() = Served(404, "text/plain", emptyMap(), ByteArrayInputStream("not found".toByteArray()))

    fun serve(url: String): Served? {
        val uri = try { URI(url) } catch (_: Exception) { return null }
        if (uri.scheme != "https") return null
        val host = uri.host ?: return null
        val path = uri.rawPath?.let { java.net.URLDecoder.decode(it.replace("+", "%2B"), "UTF-8") } ?: "/"
        if (host == UI_HOST) return serveUi(path)
        if (host.endsWith(".$APP_DOMAIN")) {
            val id = host.removeSuffix(".$APP_DOMAIN")
            return if (LauncherApps.validId(id)) serveApp(id, path) else notFound()
        }
        return null
    }

    private fun serveUi(path: String): Served {
        val icon = Regex("^/__(icon|banner)/([A-Za-z0-9_.]+)$").find(path)
        if (icon != null) {
            val png = icons(icon.groupValues[2], icon.groupValues[1] == "banner") ?: return notFound()
            return Served(200, "image/png", mapOf("Cache-Control" to "max-age=3600"), ByteArrayInputStream(png))
        }
        if (path.startsWith("/__pbs/")) return serveSdk(path.removePrefix("/__pbs/"))
        val rel = path.trimStart('/')
        val isPage = rel.isEmpty() || rel == "index.html" || !rel.substringAfterLast('/').contains('.')
        if (isPage) {
            val html = assets("ui/index.html")?.use { String(it.readBytes(), Charsets.UTF_8) } ?: return notFound()
            // Only the launcher page gets the token that lets it use the device.
            val withToken = html.replace("<head>", "<head><script>window.__pbsToken=\"$token\";</script>")
            return Served(200, "text/html", mapOf("Cache-Control" to "no-cache", "X-Frame-Options" to "DENY", "Content-Security-Policy" to "frame-ancestors 'none'"), ByteArrayInputStream(withToken.toByteArray()))
        }
        if (rel.contains("..")) return notFound()
        val s = assets("ui/$rel") ?: return notFound()
        val cache = if (rel.startsWith("assets/")) "max-age=31536000, immutable" else "max-age=3600"
        return Served(200, mimeOf(rel), mapOf("Cache-Control" to cache), s)
    }

    private fun serveSdk(name: String): Served {
        val file = SDK_FILES[name] ?: return notFound()
        val s = assets(file) ?: return notFound()
        return Served(200, mimeOf(name), mapOf("Cache-Control" to "no-cache", "Access-Control-Allow-Origin" to "*"), s)
    }

    private fun serveApp(id: String, path: String): Served {
        if (path.startsWith("/__pbs/")) return serveSdk(path.removePrefix("/__pbs/"))
        val dir = apps.dirOf(id) ?: return notFound()
        val rel = path.trimStart('/').ifEmpty { "index.html" }
        val f: File = LauncherApps.inside(dir, rel)?.let { if (it.isDirectory) File(it, "index.html") else it } ?: return notFound()
        if (!f.isFile) return notFound()
        // Apps can only be shown inside the launcher.
        return Served(200, mimeOf(f.name), mapOf("Cache-Control" to "no-cache", "Content-Security-Policy" to "frame-ancestors https://$UI_HOST"), f.inputStream())
    }
}
