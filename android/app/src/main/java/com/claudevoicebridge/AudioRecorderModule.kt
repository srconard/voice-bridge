package com.claudevoicebridge

import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.Arguments
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.io.File
import java.io.FileOutputStream
import java.io.RandomAccessFile
import kotlin.math.sqrt

class AudioRecorderModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    private var audioRecord: AudioRecord? = null
    private var recordingThread: Thread? = null
    @Volatile private var isRecording = false
    private var outputFile: File? = null

    override fun getName() = "AudioRecorder"

    @ReactMethod
    fun start() {
        if (isRecording) return

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
            return
        }

        if (recorder.state != AudioRecord.STATE_INITIALIZED) {
            recorder.release()
            return
        }

        val file = File(reactApplicationContext.cacheDir, "voice_recording.wav")
        outputFile = file

        audioRecord = recorder
        isRecording = true
        recorder.startRecording()

        recordingThread = Thread {
            val buffer = ShortArray(bufferSize / 2)
            var totalBytes = 0L

            try {
                FileOutputStream(file).use { fos ->
                    // Write placeholder WAV header (44 bytes)
                    fos.write(ByteArray(44))

                    while (isRecording) {
                        val read = recorder.read(buffer, 0, buffer.size)
                        if (read > 0) {
                            // Write PCM data as little-endian bytes
                            val byteData = ByteArray(read * 2)
                            for (i in 0 until read) {
                                byteData[i * 2] = (buffer[i].toInt() and 0xFF).toByte()
                                byteData[i * 2 + 1] = (buffer[i].toInt() shr 8 and 0xFF).toByte()
                            }
                            fos.write(byteData)
                            totalBytes += byteData.size

                            // Calculate RMS for audio level
                            var sum = 0.0
                            for (i in 0 until read) {
                                sum += buffer[i].toDouble() * buffer[i].toDouble()
                            }
                            val rms = sqrt(sum / read) / 32768.0
                            val level = (rms * 3.0).coerceAtMost(1.0) // Amplify for visibility

                            try {
                                reactApplicationContext
                                    .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                                    .emit("audioLevel", level)
                            } catch (_: Exception) {}
                        }
                    }
                }

                // Finalize WAV header
                writeWavHeader(file, totalBytes, sampleRate)

            } catch (_: Exception) {
                // Recording interrupted
            }
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

        outputFile?.let {
            try { it.delete() } catch (_: Exception) {}
        }
        outputFile = null
    }

    @ReactMethod
    fun addListener(eventName: String) {
        // Required for NativeEventEmitter
    }

    @ReactMethod
    fun removeListeners(count: Int) {
        // Required for NativeEventEmitter
    }

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
            raf.writeIntLE(16) // Subchunk1Size (PCM)
            raf.writeShortLE(1) // AudioFormat (PCM)
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
