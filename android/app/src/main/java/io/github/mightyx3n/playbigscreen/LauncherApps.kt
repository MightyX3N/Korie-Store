package io.github.mightyx3n.playbigscreen

import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.net.URL

/**
 * Launcher apps installed on this device: one folder each in <files>/apps/<id>, served to
 * the launcher at https://<id>.app.playbigscreen/ (their own origin each).
 */
class LauncherApps(private val root: File) {
    init { root.mkdirs() }

    companion object {
        private val ID = Regex("^[a-z0-9][a-z0-9-]{0,62}$")
        fun validId(id: String) = ID.matches(id)
        fun originOf(id: String) = "https://$id.${AssetServer.APP_DOMAIN}/"

        /** A file inside `base` for a path from a URL or an index, or null if it would leave it. */
        fun inside(base: File, rel: String): File? {
            val clean = rel.split('/').filter { it.isNotEmpty() && it != "." }
            if (clean.isEmpty() || clean.any { it == ".." || it.contains('\\') || it.contains('\u0000') }) return null
            val f = File(base, clean.joinToString(File.separator))
            val b = base.canonicalPath
            val p = f.canonicalPath
            return if (p.startsWith(b + File.separator)) f else null
        }
    }

    fun dirOf(id: String): File? = if (validId(id)) File(root, id).takeIf { it.isDirectory } else null

    fun list(): JSONArray {
        val out = JSONArray()
        for (d in root.listFiles().orEmpty().sortedBy { it.name }) {
            if (!d.isDirectory || !validId(d.name)) continue
            try {
                val m = JSONObject(File(d, "app.json").readText())
                m.put("id", d.name)
                m.put("url", originOf(d.name))
                out.put(m)
            } catch (_: Exception) {
                // half-installed or broken: leave it out
            }
        }
        return out
    }

    /** Downloads every file of an app from `base`, checks each sha256, then swaps it in. */
    fun install(id: String, base: String, files: JSONObject): JSONObject {
        require(validId(id)) { "bad app id" }
        require(files.has("app.json")) { "an app needs app.json" }
        val tmp = File(root, ".$id.${System.nanoTime()}")
        tmp.mkdirs()
        try {
            for (name in files.keys()) {
                val to = inside(tmp, name) ?: throw IllegalArgumentException("bad file name $name")
                val data = Net.request(URL(URL(base), name).toString()).let {
                    if (it.status != 200) throw IllegalStateException("$name: HTTP ${it.status}")
                    it.body
                }
                if (Net.sha256(data) != files.getString(name).lowercase()) throw IllegalStateException("$name doesn't match its checksum")
                to.parentFile?.mkdirs()
                to.writeBytes(data)
            }
            val m = JSONObject(File(tmp, "app.json").readText())
            require(m.optString("id") == id) { "app.json has another id" }
            val dest = File(root, id)
            dest.deleteRecursively()
            if (!tmp.renameTo(dest)) throw IllegalStateException("couldn't put the app in place")
            return m
        } finally {
            if (tmp.exists()) tmp.deleteRecursively()
        }
    }

    fun remove(id: String) {
        require(validId(id)) { "bad app id" }
        File(root, id).deleteRecursively()
    }
}
