package io.github.mightyx3n.playbigscreen

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Bundle
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

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val url = intent.getStringExtra("url") ?: return finish()
        @Suppress("UNCHECKED_CAST", "DEPRECATION")
        val headers = (intent.getSerializableExtra("headers") as? HashMap<String, String>) ?: HashMap()
        val http = DefaultHttpDataSource.Factory().setAllowCrossProtocolRedirects(true).setDefaultRequestProperties(headers)
        val p = ExoPlayer.Builder(this).setMediaSourceFactory(DefaultMediaSourceFactory(this).setDataSourceFactory(http)).build()
        player = p
        val view = PlayerView(this)
        view.player = p
        view.keepScreenOn = true
        setContentView(view)
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
