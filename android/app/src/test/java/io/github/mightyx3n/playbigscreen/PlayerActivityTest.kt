package io.github.mightyx3n.playbigscreen

import android.content.Intent
import android.view.View
import android.widget.Button
import android.widget.FrameLayout
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class PlayerActivityTest {
    private fun start(dark: Int, blur: Int) = Robolectric.buildActivity(PlayerActivity::class.java,
        Intent(ApplicationProvider.getApplicationContext(), PlayerActivity::class.java)
            .putExtra("url", "http://127.0.0.1:9/x.mp4").putExtra("dimDark", dark).putExtra("dimBlur", blur)).setup()

    private fun button(v: View): Button? = when (v) {
        is Button -> v.takeIf { it.text == "Undim" || it.text == "Dim" }
        is android.view.ViewGroup -> (0 until v.childCount).firstNotNullOfOrNull { button(v.getChildAt(it)) }
        else -> null
    }

    @Test fun dimsThePictureAndTheButtonTurnsItOff() {
        val c = start(90, 0)
        val a = c.get()
        val frame = a.findViewById<FrameLayout>(androidx.media3.ui.R.id.exo_content_frame)
        val dimmer = frame.getChildAt(frame.childCount - 1)
        assertEquals(0.9f, dimmer.alpha, 0.001f)
        assertEquals(View.VISIBLE, dimmer.visibility)
        val b = button(a.window.decorView)!!
        b.performClick()
        assertEquals(View.GONE, dimmer.visibility)
        assertEquals("Dim", b.text)
        b.performClick()
        assertEquals(View.VISIBLE, dimmer.visibility)
        c.pause().stop().destroy()
    }

    @Test fun nothingWhenNotChosen() {
        val c = start(0, 0)
        assertNull(button(c.get().window.decorView))
        c.pause().stop().destroy()
    }
}
