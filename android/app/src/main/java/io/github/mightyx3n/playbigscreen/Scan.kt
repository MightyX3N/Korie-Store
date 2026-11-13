package io.github.mightyx3n.playbigscreen

import android.content.Context
import android.net.ConnectivityManager
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.Inet4Address
import java.net.URL
import java.util.concurrent.Executors
import java.util.concurrent.Future
import java.util.concurrent.TimeUnit

/**
 * Finds servers on the home network by asking every address next to this device on the
 * given ports (multicast often doesn't get through to servers in Docker; a port does).
 */
object Scan {
    /** This device's IPv4 addresses on the active network. */
    fun ownAddresses(context: Context): List<String> {
        val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val lp = cm.getLinkProperties(cm.activeNetwork) ?: return emptyList()
        return lp.linkAddresses.mapNotNull { la -> (la.address as? Inet4Address)?.takeIf { !it.isLoopbackAddress }?.hostAddress }
    }

    /** The /24 around each address (the usual home network). */
    fun neighbours(own: List<String>): List<String> =
        own.flatMap { ip -> val base = ip.substringBeforeLast('.'); (1..254).map { "$base.$it" } }.distinct()

    fun ask(url: String, path: String, timeoutMs: Int): JSONObject? = try {
        val c = URL(url + path).openConnection() as HttpURLConnection
        c.connectTimeout = timeoutMs
        c.readTimeout = timeoutMs * 2
        c.instanceFollowRedirects = false
        try {
            if (c.responseCode != 200) null
            else JSONObject().put("url", url).put("body", c.inputStream.bufferedReader().use { r ->
                val buf = CharArray(65536); val n = r.read(buf); if (n > 0) String(buf, 0, n) else ""
            })
        } finally {
            c.disconnect()
        }
    } catch (_: Exception) {
        null
    }

    fun run(hosts: List<String>, ports: List<Int>, path: String, timeoutMs: Int): JSONArray {
        val pool = Executors.newFixedThreadPool(48)
        try {
            val jobs: List<Future<JSONObject?>> = hosts.flatMap { h -> ports.map { p -> "http://$h:$p" } }.map { u -> pool.submit<JSONObject?> { ask(u, path, timeoutMs) } }
            val out = JSONArray()
            jobs.mapNotNull { runCatching { it.get(15, TimeUnit.SECONDS) }.getOrNull() }.forEach { out.put(it) }
            return out
        } finally {
            pool.shutdownNow()
        }
    }
}
