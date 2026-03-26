package com.claudevoicebridge

import android.content.Context
import android.content.Intent
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.session.MediaSession
import android.media.session.PlaybackState
import android.view.KeyEvent
import android.view.WindowManager
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule

class RemoteButtonModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    private var mediaSession: MediaSession? = null
    private var audioFocusRequest: AudioFocusRequest? = null
    private var enabled = false

    override fun getName() = "RemoteButton"

    companion object {
        // Static ref so MainActivity can forward key events
        var instance: RemoteButtonModule? = null
            private set

        fun isMediaKey(keyCode: Int): Boolean =
            keyCode == KeyEvent.KEYCODE_MEDIA_NEXT
    }

    init {
        instance = this
    }

    @ReactMethod
    fun setEnabled(enabled: Boolean) {
        this.enabled = enabled
        if (enabled) {
            startSession()
        } else {
            stopSession()
        }
    }

    fun isEnabled() = enabled

    @ReactMethod
    fun setKeepScreenOn(enabled: Boolean) {
        val activity = reactApplicationContext.currentActivity ?: return
        activity.runOnUiThread {
            if (enabled) {
                activity.window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            } else {
                activity.window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            }
        }
    }

    private fun startSession() {
        if (mediaSession != null) return

        val activity = reactApplicationContext.currentActivity ?: return

        // Request audio focus so the system routes media buttons to us
        val audioManager = activity.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        audioFocusRequest = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
            .build()
        audioManager.requestAudioFocus(audioFocusRequest!!)

        val session = MediaSession(activity, "VoiceBridgeRemote")

        session.setCallback(object : MediaSession.Callback() {
            override fun onMediaButtonEvent(mediaButtonIntent: Intent): Boolean {
                val event = mediaButtonIntent.getParcelableExtra<KeyEvent>(Intent.EXTRA_KEY_EVENT)
                    ?: return super.onMediaButtonEvent(mediaButtonIntent)

                if (event.action != KeyEvent.ACTION_DOWN) return true

                if (event.keyCode == KeyEvent.KEYCODE_MEDIA_NEXT) {
                    emitButtonPress(event.keyCode)
                    return true
                }

                return super.onMediaButtonEvent(mediaButtonIntent)
            }
        })

        session.setPlaybackState(
            PlaybackState.Builder()
                .setState(PlaybackState.STATE_PLAYING, 0, 1f)
                .setActions(
                    PlaybackState.ACTION_PLAY_PAUSE or
                    PlaybackState.ACTION_SKIP_TO_NEXT or
                    PlaybackState.ACTION_SKIP_TO_PREVIOUS
                )
                .build()
        )

        session.isActive = true
        mediaSession = session
    }

    private fun stopSession() {
        mediaSession?.let {
            it.isActive = false
            it.release()
        }
        mediaSession = null

        audioFocusRequest?.let {
            val activity = reactApplicationContext.currentActivity ?: return
            val audioManager = activity.getSystemService(Context.AUDIO_SERVICE) as AudioManager
            audioManager.abandonAudioFocusRequest(it)
        }
        audioFocusRequest = null
    }

    /**
     * Fully suspend the MediaSession + audio focus so SCO can activate.
     * Safe to call from any thread.
     */
    fun suspendForRecording() {
        val activity = reactApplicationContext.currentActivity ?: return
        activity.runOnUiThread {
            stopSession()
        }
    }

    /**
     * Restore MediaSession + audio focus after recording.
     * Does a full stop/start cycle to ensure clean state after BT SCO/voice recognition.
     * Safe to call from any thread.
     */
    fun resumeAfterRecording() {
        if (!enabled) return
        val activity = reactApplicationContext.currentActivity ?: return
        activity.runOnUiThread {
            stopSession()
            startSession()
        }
    }

    fun emitButtonPress(keyCode: Int) {
        try {
            reactApplicationContext
                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                .emit("remoteButton", keyCode)
        } catch (_: Exception) {
            // React context may not be ready
        }
    }

    @Suppress("DEPRECATION")
    override fun onCatalystInstanceDestroy() {
        stopSession()
        instance = null
        super.onCatalystInstanceDestroy()
    }

    @ReactMethod
    fun addListener(eventName: String) {
        // Required for NativeEventEmitter
    }

    @ReactMethod
    fun removeListeners(count: Int) {
        // Required for NativeEventEmitter
    }
}
