package io.github.mightyx3n.playbigscreen

import android.app.UiModeManager
import android.bluetooth.BluetoothManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.media.AudioManager
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.Uri
import android.os.Build
import android.provider.Settings
import org.json.JSONObject
import java.io.File

/** What the bridge needs from the screen it runs in. */
interface BridgeHost {
    /** Starts an activity; false when nothing on the device can handle it. */
    fun start(intent: Intent): Boolean
    fun openWeb(url: String, done: (JSONObject) -> Unit)
    fun play(args: JSONObject, done: (JSONObject) -> Unit)
    fun exit()
}

/**
 * The launcher page's calls to the device (see docs/BRIDGE.md). Each call answers once,
 * with a result or an error, through `reply`.
 */
class Bridge(
    private val context: Context,
    private val host: BridgeHost,
    private val apps: LauncherApps,
    private val device: DeviceApps,
    private val jar: CookieJar?,
) {
    fun interface Reply { fun send(result: Any?, error: String?) }

    fun handle(method: String, args: JSONObject, reply: Reply) {
        try {
            when (method) {
                "player.play" -> host.play(args) { reply.send(it, null) }
                "web.open" -> {
                    val url = args.getString("url")
                    require(url.startsWith("http://") || url.startsWith("https://")) { "only http and https pages" }
                    host.openWeb(url) { reply.send(it, null) }
                }
                else -> reply.send(call(method, args), null)
            }
        } catch (e: Exception) {
            reply.send(null, e.message ?: e.javaClass.simpleName)
        }
    }

    /** The calls that answer right away (on a background thread). */
    fun call(method: String, args: JSONObject): Any? = when (method) {
        "info" -> info()
        "android.list" -> device.list()
        "android.launch" -> {
            val i = device.launchIntent(args.getString("package")) ?: throw IllegalStateException("that app can't be opened")
            if (!host.start(i)) throw IllegalStateException("that app can't be opened")
            JSONObject().put("started", true)
        }
        "android.uninstall" -> JSONObject().put("asked", host.start(device.uninstallIntent(args.getString("package"))))
        "android.details" -> JSONObject().put("opened", host.start(device.detailsIntent(args.getString("package"))))
        "apps.list" -> apps.list()
        "apps.install" -> apps.install(args.getString("id"), args.getString("base"), args.getJSONObject("files"))
        "apps.remove" -> { apps.remove(args.getString("id")); JSONObject().put("removed", true) }
        "http" -> Net.call(args, jar)
        "apk.install" -> installApk(args)
        "status" -> status()
        "volume.get" -> volume()
        "volume.set" -> setVolume(args)
        "settings.open" -> JSONObject().put("opened", openSettings(args.optString("page", "all")))
        "exit" -> { host.exit(); JSONObject().put("ok", true) }
        else -> throw IllegalArgumentException("unknown call $method")
    }

    fun isTv(): Boolean {
        val ui = context.getSystemService(Context.UI_MODE_SERVICE) as? UiModeManager
        return ui?.currentModeType == Configuration.UI_MODE_TYPE_TELEVISION || context.packageManager.hasSystemFeature(PackageManager.FEATURE_LEANBACK)
    }

    private fun info(): JSONObject {
        val version = try { context.packageManager.getPackageInfo(context.packageName, 0).versionName } catch (_: Exception) { "" }
        return JSONObject()
            .put("platform", "android")
            .put("version", version ?: "")
            .put("device", listOf(Build.MANUFACTURER, Build.MODEL).filter { !it.isNullOrBlank() }.distinct().joinToString(" "))
            .put("android", Build.VERSION.RELEASE)
            .put("tv", isTv())
            .put("home", JSONObject().put("isDefault", device.isDefaultHome()).put("canSet", true))
            .put("helper", JSONObject().put("available", true).put("on", HomeHelperService.isOn(context)))
    }

    private fun status(): JSONObject {
        val net = JSONObject().put("connected", false).put("type", "none")
        try {
            val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
            val caps = cm.getNetworkCapabilities(cm.activeNetwork)
            if (caps != null) {
                net.put("connected", caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET))
                net.put("type", when {
                    caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) -> "ethernet"
                    caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> "wifi"
                    caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> "cellular"
                    else -> "other"
                })
            }
        } catch (_: Exception) {}
        val out = JSONObject().put("network", net)
        try {
            val bt = (context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager)?.adapter
            if (bt != null) out.put("bluetooth", JSONObject().put("on", bt.isEnabled))
        } catch (_: SecurityException) {}
        return out
    }

    private val audio get() = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager

    private fun volume(): JSONObject {
        val a = audio
        val muted = if (Build.VERSION.SDK_INT >= 23) a.isStreamMute(AudioManager.STREAM_MUSIC) else false
        return JSONObject().put("level", a.getStreamVolume(AudioManager.STREAM_MUSIC)).put("max", a.getStreamMaxVolume(AudioManager.STREAM_MUSIC)).put("muted", muted)
    }

    private fun setVolume(args: JSONObject): JSONObject {
        val a = audio
        if (args.has("level") && !args.isNull("level")) {
            val v = args.getInt("level").coerceIn(0, a.getStreamMaxVolume(AudioManager.STREAM_MUSIC))
            if (Build.VERSION.SDK_INT >= 23 && a.isStreamMute(AudioManager.STREAM_MUSIC)) a.adjustStreamVolume(AudioManager.STREAM_MUSIC, AudioManager.ADJUST_UNMUTE, 0)
            a.setStreamVolume(AudioManager.STREAM_MUSIC, v, 0)
        }
        if (args.has("muted") && Build.VERSION.SDK_INT >= 23) {
            a.adjustStreamVolume(AudioManager.STREAM_MUSIC, if (args.getBoolean("muted")) AudioManager.ADJUST_MUTE else AudioManager.ADJUST_UNMUTE, 0)
        }
        return volume()
    }

    private fun openSettings(page: String): Boolean {
        val actions = when (page) {
            "wifi" -> listOf(Settings.ACTION_WIFI_SETTINGS, Settings.ACTION_WIRELESS_SETTINGS)
            "bluetooth" -> listOf(Settings.ACTION_BLUETOOTH_SETTINGS)
            "display" -> listOf(Settings.ACTION_DISPLAY_SETTINGS)
            "sound" -> listOf(Settings.ACTION_SOUND_SETTINGS)
            "date" -> listOf(Settings.ACTION_DATE_SETTINGS)
            "home" -> listOf(Settings.ACTION_HOME_SETTINGS, if (Build.VERSION.SDK_INT >= 24) Settings.ACTION_MANAGE_DEFAULT_APPS_SETTINGS else "")
            "accessibility" -> listOf(Settings.ACTION_ACCESSIBILITY_SETTINGS)
            else -> emptyList()
        }.filter { it.isNotEmpty() } + Settings.ACTION_SETTINGS
        for (a in actions) if (host.start(Intent(a).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))) return true
        return false
    }

    /** Downloads an APK (checked against its sha256) and asks Android to install it. */
    private fun installApk(args: JSONObject): JSONObject {
        val pm = context.packageManager
        if (Build.VERSION.SDK_INT >= 26 && !pm.canRequestPackageInstalls()) {
            host.start(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${context.packageName}")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            return JSONObject().put("status", "needs-permission")
        }
        val pkg = args.optString("package").ifEmpty { "app" }.replace(Regex("[^A-Za-z0-9_.]"), "_")
        val file = File(context.cacheDir, "apk/$pkg.apk")
        Net.download(args.getString("url"), file, args.optString("sha256").ifEmpty { null })
        ApkInstall.install(context, file, pkg)
        return JSONObject().put("status", "pending-user")
    }
}

/** Whether the Home helper (an accessibility service) is turned on. */
fun HomeHelperService.Companion.isOn(context: Context): Boolean {
    val on = Settings.Secure.getString(context.contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES) ?: return false
    val me = ComponentName(context, HomeHelperService::class.java).flattenToString()
    return on.split(':').any { it.equals(me, true) }
}
