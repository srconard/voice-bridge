package com.claudevoicebridge

import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothHeadset
import android.bluetooth.BluetoothProfile
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.media.AudioAttributes
import android.media.AudioDeviceInfo
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioRecord
import android.media.AudioTrack
import android.media.MediaRecorder
import android.util.Log
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.Promise
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.io.File
import java.io.FileOutputStream
import java.io.RandomAccessFile
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.math.sqrt

class AudioRecorderModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    private var audioRecord: AudioRecord? = null
    private var silentTrack: AudioTrack? = null
    private var recordingThread: Thread? = null
    @Volatile private var isRecording = false
    private var outputFile: File? = null

    // BT voice recognition state
    private var btHeadsetProxy: BluetoothHeadset? = null
    private var btDevice: android.bluetooth.BluetoothDevice? = null
    private var scoReceiver: BroadcastReceiver? = null
    private var usedBtVoiceRecognition = false

    override fun getName() = "AudioRecorder"

    companion object {
        private const val TAG = "AudioRecorderModule"
    }

    private fun emitStatus(msg: String) {
        Log.d(TAG, msg)
        try {
            reactApplicationContext
                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                .emit("audioStatus", msg)
        } catch (_: Exception) {}
    }

    @ReactMethod
    fun start() {
        if (isRecording) return

        // Try BT mic first, then fall back to phone mic
        Thread {
            val btSuccess = tryBluetoothVoiceRecognition()
            if (btSuccess) {
                startRecordingWithBt()
            } else {
                emitStatus("BT mic not available, using phone mic")
                startRecordingWithPhoneMic()
            }
        }.start()
    }

    /**
     * Attempt to establish SCO via BluetoothHeadset.startVoiceRecognition().
     * Returns true if SCO audio connected successfully.
     */
    private fun tryBluetoothVoiceRecognition(): Boolean {
        val adapter = BluetoothAdapter.getDefaultAdapter()
        if (adapter == null || !adapter.isEnabled) {
            emitStatus("BT: adapter null or disabled")
            return false
        }

        // Check BLUETOOTH_CONNECT permission
        val activity = reactApplicationContext.currentActivity
        if (activity != null) {
            val perm = activity.checkSelfPermission(android.Manifest.permission.BLUETOOTH_CONNECT)
            if (perm != android.content.pm.PackageManager.PERMISSION_GRANTED) {
                emitStatus("BT: BLUETOOTH_CONNECT not granted")
                return false
            }
        }

        val proxyLatch = CountDownLatch(1)
        var proxy: BluetoothHeadset? = null

        val listener = object : BluetoothProfile.ServiceListener {
            override fun onServiceConnected(profile: Int, p: BluetoothProfile) {
                proxy = p as BluetoothHeadset
                proxyLatch.countDown()
            }
            override fun onServiceDisconnected(profile: Int) {}
        }

        try {
            adapter.getProfileProxy(reactApplicationContext, listener, BluetoothProfile.HEADSET)
        } catch (e: SecurityException) {
            emitStatus("BT: getProfileProxy SecurityException: ${e.message}")
            return false
        }

        if (!proxyLatch.await(3, TimeUnit.SECONDS)) {
            emitStatus("BT: profile proxy timeout")
            return false
        }

        val headset = proxy ?: return false.also { emitStatus("BT: proxy null after connect") }
        btHeadsetProxy = headset

        val devices = try {
            headset.connectedDevices
        } catch (e: SecurityException) {
            emitStatus("BT: connectedDevices SecurityException")
            return false
        }

        if (devices.isEmpty()) {
            emitStatus("BT: no connected headset devices")
            cleanupBtProxy()
            return false
        }

        val device = devices[0]
        btDevice = device
        emitStatus("BT: found device '${device.name}', attempting voice recognition SCO")

        // Suspend RemoteButton MediaSession to avoid audio focus conflict
        RemoteButtonModule.instance?.suspendForRecording()
        emitStatus("BT: suspended RemoteButton MediaSession")

        // Register receiver for audio state changes
        val scoLatch = CountDownLatch(1)
        var scoConnected = false

        val receiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context, intent: Intent) {
                if (intent.action == BluetoothHeadset.ACTION_AUDIO_STATE_CHANGED) {
                    val state = intent.getIntExtra(BluetoothHeadset.EXTRA_STATE, -1)
                    val prevState = intent.getIntExtra(BluetoothHeadset.EXTRA_PREVIOUS_STATE, -1)
                    emitStatus("BT: audio state changed: $prevState -> $state")
                    when (state) {
                        BluetoothHeadset.STATE_AUDIO_CONNECTED -> {
                            emitStatus("BT: SCO AUDIO CONNECTED!")
                            scoConnected = true
                            scoLatch.countDown()
                        }
                        BluetoothHeadset.STATE_AUDIO_DISCONNECTED -> {
                            if (!scoConnected) {
                                emitStatus("BT: SCO audio disconnected (failed)")
                                scoLatch.countDown()
                            }
                        }
                    }
                }
            }
        }
        scoReceiver = receiver

        val filter = IntentFilter(BluetoothHeadset.ACTION_AUDIO_STATE_CHANGED)
        reactApplicationContext.registerReceiver(receiver, filter)

        // Start voice recognition — this should trigger SCO
        val vrStarted = try {
            headset.startVoiceRecognition(device)
        } catch (e: SecurityException) {
            emitStatus("BT: startVoiceRecognition SecurityException: ${e.message}")
            false
        }

        emitStatus("BT: startVoiceRecognition returned: $vrStarted")

        if (!vrStarted) {
            emitStatus("BT: startVoiceRecognition failed — headset may not support it")
            cleanupScoReceiver()
            RemoteButtonModule.instance?.resumeAfterRecording()
            cleanupBtProxy()
            return false
        }

        // Wait for SCO to connect
        emitStatus("BT: waiting up to 5s for SCO audio connection...")
        val connected = scoLatch.await(5, TimeUnit.SECONDS) && scoConnected

        if (!connected) {
            emitStatus("BT: SCO connection timeout — voice recognition didn't establish audio")
            try { headset.stopVoiceRecognition(device) } catch (_: Exception) {}
            cleanupScoReceiver()
            RemoteButtonModule.instance?.resumeAfterRecording()
            cleanupBtProxy()
            return false
        }

        usedBtVoiceRecognition = true
        emitStatus("BT: Voice recognition SCO established successfully!")
        // NOTE: Do NOT call stopVoiceRecognition() here — it closes the SCO link.
        // The system voice assistant may briefly appear but SCO must stay open.
        return true
    }

    /**
     * Start recording using BT SCO mic (after voice recognition SCO is established).
     */
    private fun startRecordingWithBt() {
        val activity = reactApplicationContext.currentActivity ?: return
        val audioManager = activity.getSystemService(Context.AUDIO_SERVICE) as AudioManager

        // Set communication mode
        val prevMode = audioManager.mode
        audioManager.mode = AudioManager.MODE_IN_COMMUNICATION
        emitStatus("BT: set audio mode MODE_IN_COMMUNICATION (was $prevMode)")

        // Find the BT SCO input device
        val btInput = audioManager.getDevices(AudioManager.GET_DEVICES_INPUTS)
            .firstOrNull { it.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO }
        if (btInput != null) {
            emitStatus("BT: found SCO input device: '${btInput.productName}'")
        } else {
            emitStatus("BT: WARNING — no TYPE_BLUETOOTH_SCO input device found")
        }

        // Start silent AudioTrack for full-duplex hint (SCO is bidirectional)
        startSilentTrack(btInput, audioManager)

        val sampleRate = 16000
        val channelConfig = AudioFormat.CHANNEL_IN_MONO
        val audioFormat = AudioFormat.ENCODING_PCM_16BIT
        val bufferSize = AudioRecord.getMinBufferSize(sampleRate, channelConfig, audioFormat)
            .coerceAtLeast(4096)

        val recorder = try {
            AudioRecord(
                MediaRecorder.AudioSource.VOICE_COMMUNICATION,
                sampleRate,
                channelConfig,
                audioFormat,
                bufferSize
            )
        } catch (e: SecurityException) {
            emitStatus("BT: AudioRecord SecurityException: ${e.message}")
            cleanupBtSession(audioManager, prevMode)
            startRecordingWithPhoneMic()
            return
        }

        if (recorder.state != AudioRecord.STATE_INITIALIZED) {
            emitStatus("BT: AudioRecord failed to initialize")
            recorder.release()
            cleanupBtSession(audioManager, prevMode)
            startRecordingWithPhoneMic()
            return
        }

        // Route to BT device
        if (btInput != null) {
            val routed = recorder.setPreferredDevice(btInput)
            emitStatus("BT: setPreferredDevice: $routed")
        }

        val file = File(reactApplicationContext.cacheDir, "voice_recording.wav")
        outputFile = file
        audioRecord = recorder
        isRecording = true
        recorder.startRecording()

        val routedDevice = recorder.routedDevice
        emitStatus("BT: recording started, routed to: type=${routedDevice?.type} '${routedDevice?.productName}'")

        recordingThread = Thread {
            val buffer = ShortArray(bufferSize / 2)
            var totalBytes = 0L
            var readCount = 0
            var gotNonZero = false

            try {
                FileOutputStream(file).use { fos ->
                    fos.write(ByteArray(44)) // WAV header placeholder

                    while (isRecording) {
                        val read = recorder.read(buffer, 0, buffer.size, AudioRecord.READ_NON_BLOCKING)
                        if (read > 0) {
                            readCount++
                            val byteData = ByteArray(read * 2)
                            for (i in 0 until read) {
                                byteData[i * 2] = (buffer[i].toInt() and 0xFF).toByte()
                                byteData[i * 2 + 1] = (buffer[i].toInt() shr 8 and 0xFF).toByte()
                            }
                            fos.write(byteData)
                            totalBytes += byteData.size

                            // Check for non-zero audio
                            var peak = 0
                            var sum = 0.0
                            for (i in 0 until read) {
                                val v = kotlin.math.abs(buffer[i].toInt())
                                if (v > peak) peak = v
                                sum += buffer[i].toDouble() * buffer[i].toDouble()
                            }
                            val rms = sqrt(sum / read) / 32768.0
                            val level = (rms * 3.0).coerceAtMost(1.0)

                            if (peak > 0) gotNonZero = true

                            if (readCount <= 5 || readCount % 50 == 0) {
                                emitStatus("BT read#$readCount: $read samples, peak=$peak, rms=${String.format("%.6f", rms)}")
                            }

                            // If after 10 reads still all zeros, bail to phone mic
                            if (readCount == 10 && !gotNonZero) {
                                emitStatus("BT: 10 reads with peak=0, aborting BT — falling back to phone mic")
                                isRecording = false
                                break
                            }

                            try {
                                reactApplicationContext
                                    .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                                    .emit("audioLevel", level)
                            } catch (_: Exception) {}
                        } else if (read == 0) {
                            Thread.sleep(10) // Non-blocking returned nothing, brief sleep
                        }
                    }
                }

                if (gotNonZero) {
                    writeWavHeader(file, totalBytes, sampleRate)
                    emitStatus("BT: recording complete, ${totalBytes} bytes")
                }
            } catch (e: Exception) {
                emitStatus("BT: recording error: ${e.message}")
            }

            // If we bailed due to zeros, restart with phone mic
            if (!gotNonZero && readCount >= 10) {
                recorder.stop()
                recorder.release()
                audioRecord = null
                cleanupBtSession(audioManager, prevMode)
                startRecordingWithPhoneMic()
            }
        }.also { it.start() }
    }

    /**
     * Start a silent AudioTrack with VOICE_COMMUNICATION attributes.
     * SCO is bidirectional — having output active can help some devices establish the link.
     */
    private fun startSilentTrack(btOutput: AudioDeviceInfo?, audioManager: AudioManager) {
        try {
            val attrs = AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
                .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                .build()
            val format = AudioFormat.Builder()
                .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                .setSampleRate(16000)
                .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                .build()
            val minBuf = AudioTrack.getMinBufferSize(16000, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_16BIT)
            val track = AudioTrack.Builder()
                .setAudioAttributes(attrs)
                .setAudioFormat(format)
                .setBufferSizeInBytes(minBuf.coerceAtLeast(4096))
                .setTransferMode(AudioTrack.MODE_STREAM)
                .build()

            // Route to BT SCO output if available
            val btScoOutput = audioManager.getDevices(AudioManager.GET_DEVICES_OUTPUTS)
                .firstOrNull { it.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO }
            if (btScoOutput != null) {
                track.setPreferredDevice(btScoOutput)
                emitStatus("BT: silent track routed to SCO output '${btScoOutput.productName}'")
            }

            track.play()
            // Write a small buffer of silence to keep it active
            val silence = ByteArray(minBuf.coerceAtLeast(4096))
            track.write(silence, 0, silence.size)
            silentTrack = track
            emitStatus("BT: silent AudioTrack started (full-duplex hint)")
        } catch (e: Exception) {
            emitStatus("BT: silent track failed: ${e.message}")
        }
    }

    private fun stopSilentTrack() {
        silentTrack?.let {
            try {
                it.stop()
                it.release()
            } catch (_: Exception) {}
        }
        silentTrack = null
    }

    /**
     * Clean up BT voice recognition session.
     */
    private fun cleanupBtSession(audioManager: AudioManager, prevMode: Int) {
        stopSilentTrack()

        // Stop voice recognition to close SCO link
        if (usedBtVoiceRecognition) {
            btHeadsetProxy?.let { headset ->
                btDevice?.let { device ->
                    try {
                        headset.stopVoiceRecognition(device)
                        emitStatus("BT: stopVoiceRecognition called")
                    } catch (_: Exception) {}
                }
            }
            usedBtVoiceRecognition = false
        }

        // Restore audio mode
        audioManager.mode = AudioManager.MODE_NORMAL
        emitStatus("BT: restored audio mode to MODE_NORMAL")

        cleanupScoReceiver()
        cleanupBtProxy()

        // Resume RemoteButton
        RemoteButtonModule.instance?.resumeAfterRecording()
        emitStatus("BT: resumed RemoteButton MediaSession")
    }

    private fun cleanupScoReceiver() {
        scoReceiver?.let {
            try { reactApplicationContext.unregisterReceiver(it) } catch (_: Exception) {}
        }
        scoReceiver = null
    }

    private fun cleanupBtProxy() {
        btHeadsetProxy?.let {
            try {
                BluetoothAdapter.getDefaultAdapter()
                    ?.closeProfileProxy(BluetoothProfile.HEADSET, it)
            } catch (_: Exception) {}
        }
        btHeadsetProxy = null
        btDevice = null
    }

    /**
     * Standard phone mic recording (original fallback path).
     */
    private fun startRecordingWithPhoneMic() {
        val sampleRate = 16000
        val channelConfig = AudioFormat.CHANNEL_IN_MONO
        val audioFormat = AudioFormat.ENCODING_PCM_16BIT
        val bufferSize = AudioRecord.getMinBufferSize(sampleRate, channelConfig, audioFormat)
            .coerceAtLeast(4096)

        val recorder = try {
            AudioRecord(
                MediaRecorder.AudioSource.MIC,
                sampleRate,
                channelConfig,
                audioFormat,
                bufferSize
            )
        } catch (e: SecurityException) {
            emitStatus("Phone mic: SecurityException")
            return
        }

        if (recorder.state != AudioRecord.STATE_INITIALIZED) {
            recorder.release()
            emitStatus("Phone mic: failed to initialize")
            return
        }

        val file = File(reactApplicationContext.cacheDir, "voice_recording.wav")
        outputFile = file
        audioRecord = recorder
        isRecording = true
        recorder.startRecording()
        emitStatus("Phone mic: recording started")

        recordingThread = Thread {
            val buffer = ShortArray(bufferSize / 2)
            var totalBytes = 0L

            try {
                FileOutputStream(file).use { fos ->
                    fos.write(ByteArray(44))

                    while (isRecording) {
                        val read = recorder.read(buffer, 0, buffer.size)
                        if (read > 0) {
                            val byteData = ByteArray(read * 2)
                            for (i in 0 until read) {
                                byteData[i * 2] = (buffer[i].toInt() and 0xFF).toByte()
                                byteData[i * 2 + 1] = (buffer[i].toInt() shr 8 and 0xFF).toByte()
                            }
                            fos.write(byteData)
                            totalBytes += byteData.size

                            var sum = 0.0
                            for (i in 0 until read) {
                                sum += buffer[i].toDouble() * buffer[i].toDouble()
                            }
                            val rms = sqrt(sum / read) / 32768.0
                            val level = (rms * 3.0).coerceAtMost(1.0)

                            try {
                                reactApplicationContext
                                    .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                                    .emit("audioLevel", level)
                            } catch (_: Exception) {}
                        }
                    }
                }

                writeWavHeader(file, totalBytes, sampleRate)
            } catch (_: Exception) {}
        }.also { it.start() }
    }

    @ReactMethod
    fun stop(promise: Promise) {
        if (!isRecording) {
            promise.reject("NOT_RECORDING", "Not currently recording")
            return
        }

        isRecording = false
        try {
            recordingThread?.join(3000)
        } catch (_: InterruptedException) {}

        audioRecord?.let {
            try {
                it.stop()
                it.release()
            } catch (_: Exception) {}
        }
        audioRecord = null
        recordingThread = null

        // Clean up BT session if we used it
        if (usedBtVoiceRecognition) {
            val activity = reactApplicationContext.currentActivity
            if (activity != null) {
                val audioManager = activity.getSystemService(Context.AUDIO_SERVICE) as AudioManager
                cleanupBtSession(audioManager, AudioManager.MODE_NORMAL)
            }
        } else {
            stopSilentTrack()
            cleanupScoReceiver()
            cleanupBtProxy()
        }

        val file = outputFile
        if (file != null && file.exists() && file.length() > 44) {
            promise.resolve(file.absolutePath)
        } else {
            promise.reject("NO_AUDIO", "No audio data recorded")
        }
    }

    @ReactMethod
    fun cancel() {
        isRecording = false
        try {
            recordingThread?.join(2000)
        } catch (_: InterruptedException) {}

        audioRecord?.let {
            try {
                it.stop()
                it.release()
            } catch (_: Exception) {}
        }
        audioRecord = null
        recordingThread = null

        // Clean up BT
        if (usedBtVoiceRecognition) {
            val activity = reactApplicationContext.currentActivity
            if (activity != null) {
                val audioManager = activity.getSystemService(Context.AUDIO_SERVICE) as AudioManager
                cleanupBtSession(audioManager, AudioManager.MODE_NORMAL)
            }
        } else {
            stopSilentTrack()
            cleanupScoReceiver()
            cleanupBtProxy()
        }

        outputFile?.let {
            try { it.delete() } catch (_: Exception) {}
        }
        outputFile = null
    }

    @ReactMethod
    fun addListener(eventName: String) {}

    @ReactMethod
    fun removeListeners(count: Int) {}

    private fun writeWavHeader(file: File, dataSize: Long, sampleRate: Int) {
        val channels = 1
        val bitsPerSample = 16
        val byteRate = sampleRate * channels * bitsPerSample / 8
        val blockAlign = channels * bitsPerSample / 8

        RandomAccessFile(file, "rw").use { raf ->
            raf.seek(0)
            raf.writeBytes("RIFF")
            raf.writeIntLE((36 + dataSize).toInt())
            raf.writeBytes("WAVE")
            raf.writeBytes("fmt ")
            raf.writeIntLE(16)
            raf.writeShortLE(1)
            raf.writeShortLE(channels)
            raf.writeIntLE(sampleRate)
            raf.writeIntLE(byteRate)
            raf.writeShortLE(blockAlign)
            raf.writeShortLE(bitsPerSample)
            raf.writeBytes("data")
            raf.writeIntLE(dataSize.toInt())
        }
    }

    private fun RandomAccessFile.writeIntLE(value: Int) {
        write(value and 0xFF)
        write(value shr 8 and 0xFF)
        write(value shr 16 and 0xFF)
        write(value shr 24 and 0xFF)
    }

    private fun RandomAccessFile.writeShortLE(value: Int) {
        write(value and 0xFF)
        write(value shr 8 and 0xFF)
    }
}
