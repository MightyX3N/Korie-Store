package io.github.mightyx3n.playbigscreen

import android.accessibilityservice.AccessibilityService
import android.content.Intent
import android.view.accessibility.AccessibilityEvent

/**
 * The Home button helper. Some TVs keep their own home screen and don't let you choose
 * another; with this turned on (in Accessibility), PlayBigScreen opens whenever that home
 * screen comes up. It only looks at which app's window just opened.
 */
class HomeHelperService : AccessibilityService() {
    companion object;

    private var homes: Set<String> = emptySet()
    private var last = 0L

    override fun onServiceConnected() {
        homes = DeviceApps(this).otherHomes()
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent) {
        if (event.eventType != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) return
        val pkg = event.packageName?.toString() ?: return
        if (pkg !in homes) return
        if (DeviceApps(this).isDefaultHome()) return // Android already opens us on Home
        val now = System.currentTimeMillis()
        if (now - last < 800) return
        last = now
        startActivity(Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT).putExtra(MainActivity.EXTRA_HOME, true))
    }

    override fun onInterrupt() {}
}
