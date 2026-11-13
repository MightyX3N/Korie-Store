package io.github.mightyx3n.playbigscreen

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.graphics.Color
import android.graphics.RenderEffect
import android.graphics.Shader
import android.os.Build
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.FrameLayout
import android.view.KeyEvent
import androidx.annotation.OptIn
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.ui.PlayerView

/** The device's own video player, for launcher apps (pbs.play). Answers where it stopped. */
@OptIn(UnstableApi::class)
class PlayerActivity : Activity() {
    private var player: ExoPlayer? = null
    private var ended = false
    private var playerView: PlayerView? = null
    private var dimmer: View? = null
    private var dimButton: Button? = null
    private var dimDark = 0
    private var dimBlur = 0
    private var dimOn = true

    private fun applyDim() {
        dimmer?.alpha = if (dimOn) dimDark / 100f else 0f
        dimmer?.visibility = if (dimOn && dimDark > 0) View.VISIBLE else View.GONE
        if (Build.VERSION.SDK_INT >= 31) {
            val r = if (dimOn) floatArrayOf(0f, 18f, 48f)[dimBlur] else 0f
            playerView?.videoSurfaceView?.setRenderEffect(if (r > 0f) RenderEffect.createBlurEffect(r, r, Shader.TileMode.CLAMP) else null)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val url = intent.getStringExtra("url") ?: return finish()
        @Suppress("UNCHECKED_CAST", "DEPRECATION")
        val headers = (intent.getSerializableExtra("headers") as? HashMap<String, String>) ?: HashMap()
        val http = DefaultHttpDataSource.Factory().setAllowCrossProtocolRedirects(true).setDefaultRequestProperties(headers)
        val p = ExoPlayer.Builder(this).setMediaSourceFactory(DefaultMediaSourceFactory(this).setDataSourceFactory(http)).build()
        player = p
        // Dimming (for cars): how dark and how blurred the picture is. Blurring needs the
        // picture on a TextureView and Android 12.
        dimDark = intent.getIntExtra("dimDark", 0).coerceIn(0, 100)
        dimBlur = intent.getIntExtra("dimBlur", 0).coerceIn(0, 2)
        val root = FrameLayout(this)
        val view = if (dimBlur > 0 && Build.VERSION.SDK_INT >= 31) layoutInflater.inflate(R.layout.player_texture, root, false) as PlayerView else PlayerView(this)
        playerView = view
        view.player = p
        view.keepScreenOn = true
        root.addView(view, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        // Over the picture, under the subtitles and controls (which live in the player view).
        dimmer = View(this).apply { setBackgroundColor(Color.BLACK) }
        view.findViewById<FrameLayout>(androidx.media3.ui.R.id.exo_content_frame)?.addView(dimmer, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        if (dimDark > 0 || dimBlur > 0) {
            val b = Button(this).apply {
                text = "Undim"
                setOnClickListener { dimOn = !dimOn; applyDim(); text = if (dimOn) "Undim" else "Dim" }
            }
            dimButton = b
            root.addView(b, FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.TOP or Gravity.END).apply { setMargins(0, 32, 32, 0) })
            // The button shows with the player's controls.
            view.setControllerVisibilityListener(PlayerView.ControllerVisibilityListener { v -> b.visibility = v })
        }
        setContentView(root)
        applyDim()
        Immersive.apply(window)
        val meta = MediaMetadata.Builder().setTitle(intent.getStringExtra("title")).setSubtitle(intent.getStringExtra("subtitle")).build()
        p.setMediaItem(MediaItem.Builder().setUri(Uri.parse(url)).setMediaMetadata(meta).build(), intent.getLongExtra("start", 0L))
        p.addListener(object : Player.Listener {
            override fun onPlaybackStateChanged(state: Int) {
                if (state == Player.STATE_ENDED) { ended = true; done() }
            }
        })
        p.prepare()
        p.playWhenReady = true
        view.requestFocus()
    }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (event.keyCode == KeyEvent.KEYCODE_BACK) {
            if (event.action == KeyEvent.ACTION_UP) done()
            return true
        }
        // The remote's menu key turns dimming off and on.
        if (event.keyCode == KeyEvent.KEYCODE_MENU && dimButton != null) {
            if (event.action == KeyEvent.ACTION_UP) dimButton?.performClick()
            return true
        }
        return super.dispatchKeyEvent(event)
    }

    private fun done() {
        val p = player
        setResult(RESULT_OK, Intent().putExtra("position", p?.currentPosition ?: 0L).putExtra("duration", p?.duration?.coerceAtLeast(0L) ?: 0L).putExtra("ended", ended))
        finish()
    }

    override fun onStop() {
        super.onStop()
        player?.pause()
    }

    override fun onDestroy() {
        player?.release()
        player = null
        super.onDestroy()
    }
}
