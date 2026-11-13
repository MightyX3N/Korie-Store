package io.github.mightyx3n.playbigscreen

import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.content.pm.ResolveInfo
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.drawable.BitmapDrawable
import android.graphics.drawable.Drawable
import android.net.Uri
import android.os.Build
import android.util.LruCache
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream

/** The Android apps on the device that can be opened from a home screen. */
class DeviceApps(private val context: Context) {
    private val pm: PackageManager get() = context.packageManager
    private val pngs = LruCache<String, ByteArray>(4 * 1024 * 1024)

    private fun query(category: String): List<ResolveInfo> {
        val i = Intent(Intent.ACTION_MAIN).addCategory(category)
        return if (Build.VERSION.SDK_INT >= 33) pm.queryIntentActivities(i, PackageManager.ResolveInfoFlags.of(0)) else @Suppress("DEPRECATION") pm.queryIntentActivities(i, 0)
    }

    /** One entry per app: TV (leanback) entries win over phone ones for the same app. */
    private fun entries(): Map<String, ResolveInfo> {
        val out = LinkedHashMap<String, ResolveInfo>()
        for (r in query(Intent.CATEGORY_LEANBACK_LAUNCHER)) out.putIfAbsent(r.activityInfo.packageName, r)
        for (r in query(Intent.CATEGORY_LAUNCHER)) out.putIfAbsent(r.activityInfo.packageName, r)
        out.remove(context.packageName)
        return out
    }

    fun list(): JSONArray {
        val out = JSONArray()
        for ((pkg, r) in entries()) {
            val ai = r.activityInfo.applicationInfo
            val o = JSONObject()
            o.put("package", pkg)
            o.put("name", r.loadLabel(pm).toString())
            o.put("icon", "/__icon/$pkg")
            if (r.activityInfo.banner != 0 || ai.banner != 0) o.put("banner", "/__banner/$pkg")
            o.put("system", (ai.flags and ApplicationInfo.FLAG_SYSTEM) != 0 && (ai.flags and ApplicationInfo.FLAG_UPDATED_SYSTEM_APP) == 0)
            try {
                val pi = pm.getPackageInfo(pkg, 0)
                o.put("versionName", pi.versionName ?: "")
                o.put("versionCode", if (Build.VERSION.SDK_INT >= 28) pi.longVersionCode else @Suppress("DEPRECATION") pi.versionCode.toLong())
            } catch (_: Exception) {}
            out.put(o)
        }
        return out
    }

    fun launchIntent(pkg: String): Intent? {
        val e = entries()[pkg]
        val i = if (e != null) Intent(Intent.ACTION_MAIN).setClassName(pkg, e.activityInfo.name) else pm.getLeanbackLaunchIntentForPackage(pkg) ?: pm.getLaunchIntentForPackage(pkg)
        return i?.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED)
    }

    fun uninstallIntent(pkg: String): Intent = Intent(Intent.ACTION_DELETE, Uri.parse("package:$pkg")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)

    fun detailsIntent(pkg: String): Intent = Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$pkg")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)

    /** The app's icon (or TV banner) as a PNG, for the launcher page. */
    fun png(pkg: String, banner: Boolean): ByteArray? {
        val key = (if (banner) "b:" else "i:") + pkg
        pngs.get(key)?.let { return it }
        val e = entries()[pkg] ?: return null
        val d: Drawable = (if (banner) e.activityInfo.loadBanner(pm) ?: e.activityInfo.applicationInfo.loadBanner(pm) else e.loadIcon(pm)) ?: return null
        val w = if (banner) 320 else 192
        val h = if (banner) 180 else 192
        val bmp = if (d is BitmapDrawable && d.bitmap != null && !banner) Bitmap.createScaledBitmap(d.bitmap, w, h, true) else {
            val b = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
            val c = Canvas(b)
            d.setBounds(0, 0, w, h)
            d.draw(c)
            b
        }
        val out = ByteArrayOutputStream()
        bmp.compress(Bitmap.CompressFormat.PNG, 100, out)
        return out.toByteArray().also { pngs.put(key, it) }
    }

    fun clearCache() = pngs.evictAll()

    /** Whether PlayBigScreen is the app Home opens, and the other home apps (the TV's own). */
    fun isDefaultHome(): Boolean {
        val i = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME)
        val r = pm.resolveActivity(i, PackageManager.MATCH_DEFAULT_ONLY) ?: return false
        return r.activityInfo?.packageName == context.packageName
    }

    fun otherHomes(): Set<String> {
        val i = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME)
        @Suppress("DEPRECATION")
        return pm.queryIntentActivities(i, 0).map { it.activityInfo.packageName }.filter { it != context.packageName && it != "com.android.settings" }.toSet()
    }
}
