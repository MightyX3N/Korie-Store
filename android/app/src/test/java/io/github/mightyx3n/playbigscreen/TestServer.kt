package io.github.mightyx3n.playbigscreen

import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import kotlin.concurrent.thread

/** A tiny HTTP/1.0 server for tests: path -> (status, headers, body) from the request headers. */
class TestServer(private val routes: Map<String, (Map<String, List<String>>) -> Triple<Int, Map<String, String>, ByteArray>>) : AutoCloseable {
    private val socket = ServerSocket(0, 50, InetAddress.getByName("127.0.0.1"))
    val base: String get() = "http://127.0.0.1:${socket.localPort}"

    init {
        thread(isDaemon = true) {
            while (!socket.isClosed) {
                val s = try { socket.accept() } catch (_: Exception) { break }
                thread(isDaemon = true) { answer(s) }
            }
        }
    }

    private fun answer(s: Socket) = s.use {
        val input = BufferedReader(InputStreamReader(s.getInputStream(), Charsets.ISO_8859_1))
        val first = input.readLine() ?: return
        val path = first.split(' ').getOrElse(1) { "/" }.substringBefore('?')
        val headers = HashMap<String, MutableList<String>>()
        var length = 0
        while (true) {
            val line = input.readLine() ?: break
            if (line.isEmpty()) break
            val k = line.substringBefore(':').trim()
            val v = line.substringAfter(':').trim()
            headers.getOrPut(k) { ArrayList() }.add(v)
            if (k.equals("Content-Length", true)) length = v.toIntOrNull() ?: 0
        }
        repeat(length) { input.read() }
        val norm = headers.mapKeys { (k, _) -> k.split('-').joinToString("-") { p -> p.lowercase().replaceFirstChar { it.uppercase() } } }
        val (status, hs, body) = routes[path]?.invoke(norm) ?: Triple(404, emptyMap(), "not found".toByteArray())
        val out = s.getOutputStream()
        val head = StringBuilder("HTTP/1.0 $status X\r\n")
        hs.forEach { (k, v) -> head.append("$k: $v\r\n") }
        head.append("Content-Length: ${body.size}\r\nConnection: close\r\n\r\n")
        out.write(head.toString().toByteArray(Charsets.ISO_8859_1))
        out.write(body)
        out.flush()
    }

    override fun close() = socket.close()
}
