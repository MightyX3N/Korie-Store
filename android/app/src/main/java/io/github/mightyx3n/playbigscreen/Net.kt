package io.github.mightyx3n.playbigscreen

import android.util.Base64
import android.webkit.CookieManager
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

/** Where web requests made for the launcher and its apps keep their cookies. */
interface CookieJar {
    fun get(url: String): String?
    fun set(url: String, setCookie: String)
}

/** The WebView's own cookies, so a sign-in done here also counts in web pages opened later. */
object WebViewCookies : CookieJar {
    override fun get(url: String): String? = CookieManager.getInstance().getCookie(url)
    override fun set(url: String, setCookie: String) {
        CookieManager.getInstance().setCookie(url, setCookie)
        CookieManager.getInstance().flush()
    }
}

class HttpResult(val status: Int, val headers: Map<String, String>, val body: ByteArray, val url: String)

object Net {
    private const val MAX_BODY = 64L * 1024 * 1024

    /**
     * One web request, following redirects itself so cookies set on the way are kept.
     * `headers` are sent as given; cookies from the jar are added unless a Cookie header is.
     */
    fun request(
        url: String,
        method: String = "GET",
        headers: Map<String, String> = emptyMap(),
        body: ByteArray? = null,
        jar: CookieJar? = null,
        timeoutMs: Int = 30_000,
    ): HttpResult {
        var current = url
        var m = method.uppercase()
        var b = body
        repeat(8) {
            val u = URL(current)
            require(u.protocol == "http" || u.protocol == "https") { "only http and https" }
            val c = u.openConnection() as HttpURLConnection
            try {
                c.instanceFollowRedirects = false
                c.connectTimeout = timeoutMs
                c.readTimeout = timeoutMs
                c.requestMethod = m
                for ((k, v) in headers) c.setRequestProperty(k, v)
                if (jar != null && headers.keys.none { it.equals("cookie", true) }) {
                    jar.get(current)?.takeIf { it.isNotEmpty() }?.let { c.setRequestProperty("Cookie", it) }
                }
                if (b != null && m != "GET" && m != "HEAD") {
                    c.doOutput = true
                    c.outputStream.use { it.write(b) }
                }
                val status = c.responseCode
                if (jar != null) {
                    c.headerFields.entries.filter { it.key.equals("Set-Cookie", true) }.flatMap { it.value }.forEach { jar.set(current, it) }
                }
                val location = c.getHeaderField("Location")
                if (status in listOf(301, 302, 303, 307, 308) && location != null) {
                    current = URL(u, location).toString()
                    if (status == 303 || ((status == 301 || status == 302) && m == "POST")) { m = "GET"; b = null }
                    return@repeat
                }
                val stream: InputStream? = if (status >= 400) c.errorStream else c.inputStream
                val data = stream?.use { readLimited(it) } ?: ByteArray(0)
                val hs = LinkedHashMap<String, String>()
                for ((k, v) in c.headerFields) if (k != null && !k.equals("Set-Cookie", true)) hs[k.lowercase()] = v.joinToString(", ")
                return HttpResult(status, hs, data, current)
            } finally {
                c.disconnect()
            }
        }
        throw IllegalStateException("too many redirects")
    }

    private fun readLimited(s: InputStream): ByteArray {
        val out = ByteArrayOutputStream()
        val buf = ByteArray(64 * 1024)
        var total = 0L
        while (true) {
            val n = s.read(buf)
            if (n < 0) break
            total += n
            if (total > MAX_BODY) throw IllegalStateException("the answer is too big")
            out.write(buf, 0, n)
        }
        return out.toByteArray()
    }

    /** For the bridge: a request described in JSON, answered in JSON. */
    fun call(args: JSONObject, jar: CookieJar?): JSONObject {
        val headers = HashMap<String, String>()
        args.optJSONObject("headers")?.let { h -> h.keys().forEach { k -> headers[k] = h.optString(k) } }
        val body = if (args.isNull("body")) null else args.optString("body").toByteArray()
        val out = JSONObject()
        try {
            val r = request(args.getString("url"), args.optString("method", "GET"), headers, body, jar)
            out.put("status", r.status)
            out.put("url", r.url)
            out.put("headers", JSONObject(r.headers as Map<*, *>))
            out.put("body", if (args.optString("as") == "base64") Base64.encodeToString(r.body, Base64.NO_WRAP) else String(r.body, Charsets.UTF_8))
        } catch (e: Exception) {
            // Like fetch: no answer at all is status 0 with a reason, not an exception.
            out.put("status", 0)
            out.put("headers", JSONObject())
            out.put("body", "")
            out.put("error", e.message ?: e.javaClass.simpleName)
        }
        return out
    }

    fun sha256(data: ByteArray): String = MessageDigest.getInstance("SHA-256").digest(data).joinToString("") { "%02x".format(it) }

    fun sha256(file: File): String {
        val md = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { s ->
            val buf = ByteArray(64 * 1024)
            while (true) { val n = s.read(buf); if (n < 0) break; md.update(buf, 0, n) }
        }
        return md.digest().joinToString("") { "%02x".format(it) }
    }

    /** Downloads to a file (big things like APKs), checking the sha256 when one is given. */
    fun download(url: String, to: File, sha256: String?) {
        var current = url
        repeat(8) {
            val c = URL(current).openConnection() as HttpURLConnection
            try {
                c.instanceFollowRedirects = false
                c.connectTimeout = 30_000
                c.readTimeout = 60_000
                val status = c.responseCode
                val loc = c.getHeaderField("Location")
                if (status in 300..399 && loc != null) { current = URL(URL(current), loc).toString(); return@repeat }
                if (status != 200) throw IllegalStateException("$current: HTTP $status")
                to.parentFile?.mkdirs()
                c.inputStream.use { input -> to.outputStream().use { input.copyTo(it) } }
            } finally {
                c.disconnect()
            }
            if (!sha256.isNullOrEmpty() && sha256(to) != sha256.lowercase()) {
                to.delete()
                throw IllegalStateException("the download doesn't match its checksum")
            }
            return
        }
        throw IllegalStateException("too many redirects")
    }
}
