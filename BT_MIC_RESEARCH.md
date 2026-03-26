# Research Problem: Capturing Audio from Bluetooth Headset Microphone in a Third-Party Android App

## The Problem

A third-party Android app (React Native with custom native Kotlin modules) needs to record audio from a Bluetooth motorcycle helmet headset's microphone. The app uses Android's `AudioRecord` API for voice capture. Despite the headset being fully connected and functional for phone calls and Samsung's built-in Voice Recorder app, the app receives only silence (all-zero samples) from the Bluetooth mic.

## Environment

- **Phone:** Samsung Galaxy S24 Ultra (SM-S928U)
- **Android version:** Android 14+ (API 34+), One UI 6+
- **Bluetooth headset:** Motorcycle helmet headset (appears as "Shn helmet")
- **Connection profiles:** HFP (Hands-Free Profile) state=2 (CONNECTED), A2DP state=2 (CONNECTED)
- **App type:** Third-party app (not a system app, no system-level privileges)
- **App permissions granted:** `RECORD_AUDIO`, `BLUETOOTH_CONNECT`, `BLUETOOTH`

## What Works

- The headset mic works perfectly for **phone calls**
- The headset mic works perfectly with **Samsung's built-in Voice Recorder** app
- The headset appears in `AudioManager.getDevices(GET_DEVICES_INPUTS)` as `type=7` (`TYPE_BLUETOOTH_SCO`), name "Shn helmet"
- `AudioRecord.setPreferredDevice()` returns `true` and `getRoutedDevice()` confirms routing to `type=7 'Shn helmet'`
- `AudioRecord` initializes, starts, and reads samples successfully — the API calls all succeed
- The phone's built-in mic works fine in the app as a fallback

## What Does NOT Work

- **The actual audio data is all zeros.** The routing says "Bluetooth headset" but no real audio arrives. `AudioRecord.read()` returns buffers full of zeros (peak=0, RMS=0.0).
- This happens because the **Bluetooth SCO (Synchronous Connection-Oriented) audio transport** — the actual low-level Bluetooth audio channel that carries mic data — never opens. The Android APIs set a routing *preference* but don't establish the underlying audio link.

## All Approaches Tried (All Failed)

### 1. `AudioManager.startBluetoothSco()` (Legacy API)
The traditional way to open a SCO link. On this device, the SCO state broadcast listener **always reports state=0 (DISCONNECTED)** and never transitions to state=1 (CONNECTED), even after waiting 8+ seconds. This API is deprecated in Android 12+ and appears non-functional on Samsung S24 Ultra.

### 2. `AudioManager.setCommunicationDevice()` (Android 12+ API)
The modern replacement for `startBluetoothSco()`. Returns `true` initially but `false` after repeated calls in the same session. Routes to the headset on paper, but the audio data is still all zeros. This API sets a routing preference but does not force the SCO transport to open.

### 3. `AudioRecord.setPreferredDevice()` (Direct device routing)
Routes the `AudioRecord` instance to the BT device. Confirmed via `getRoutedDevice()`. Tried with multiple audio sources:
- `MediaRecorder.AudioSource.MIC`
- `MediaRecorder.AudioSource.VOICE_RECOGNITION`
- `MediaRecorder.AudioSource.DEFAULT`
- `MediaRecorder.AudioSource.VOICE_COMMUNICATION`

All produce zeros. Tried sample rates: 8000Hz (SCO narrowband standard), 16000Hz. No difference.

### 4. `MODE_IN_COMMUNICATION` audio mode
Set `AudioManager.setMode(MODE_IN_COMMUNICATION)` before creating AudioRecord. Combined with both `setCommunicationDevice()` and `setPreferredDevice()`. Still zeros.

### 5. `MediaRecorder` instead of `AudioRecord`
Used `MediaRecorder` with AMR-NB encoding (native SCO codec) and 3GPP container. `setPreferredDevice()` routes to helmet. Produces a valid file (correct size for duration) but the audio content is silence.

### 6. Releasing competing audio resources
The app has a `MediaSession` (for Bluetooth remote button support) with `AUDIOFOCUS_GAIN`. Tried:
- Releasing audio focus before BT mic attempt
- Fully deactivating the MediaSession (`isActive = false`)
- Abandoning the audio focus request entirely

None of these helped — SCO still doesn't connect.

## Technical Analysis

The core issue is a **gap between audio routing and audio transport**:

1. **Routing layer** (what Android's AudioManager/AudioRecord APIs control): Successfully points to the Bluetooth device
2. **Transport layer** (the actual Bluetooth SCO audio channel): Never opens

For BT headset microphone audio to flow, the phone must establish a SCO link with the headset. This is a Bluetooth-level operation that creates a synchronous bidirectional audio channel. The standard Android APIs that are supposed to trigger this (`startBluetoothSco()`, `setCommunicationDevice()`) don't actually do it on this device.

Samsung's Voice Recorder app somehow bypasses this limitation — possibly through:
- Samsung-proprietary audio routing APIs
- System app privileges that allow direct SCO control
- A different code path that triggers SCO establishment

## Questions for Research

1. **How do popular third-party apps (WhatsApp, Signal, Zoom, Discord) activate the Bluetooth SCO microphone on Android 12+ / Samsung devices?** These apps successfully use BT headset mics for VoIP calls. What API path do they use?

2. **Does the `android.telecom.ConnectionService` API (Telecom framework) provide a way to establish SCO?** VoIP apps register as calling apps via ConnectionService and get system-managed audio routing, including BT SCO activation. Could a non-calling app use this approach for audio recording?

3. **Are there Samsung-specific APIs, SDKs, or intents** that trigger SCO audio channel establishment? Samsung has proprietary extensions (Samsung Accessory SDK, Samsung Audio SDK, etc.). Are any relevant here?

4. **Does running an Android `ForegroundService` with `foregroundServiceType="microphone"` or `"phoneCall"`** affect the system's willingness to establish SCO? Some developers report that BT audio routing only works from a foreground service.

5. **Is there a way to use Android's `AudioDeviceCallback` or `AudioRouting.OnRoutingChangedListener`** to detect when the routing actually activates (vs. just being requested) and trigger any additional setup?

6. **On Android 14/15, has Google introduced any new APIs or changed the behavior** of `setCommunicationDevice()` specifically for non-call audio recording from BT SCO devices?

7. **Could BLE Audio (LE Audio / LC3 codec)** be an alternative path if the headset supports it? LE Audio uses different APIs than classic BT SCO.

8. **Are there any known workarounds** involving `AudioAttributes` configuration (e.g., `USAGE_VOICE_COMMUNICATION` + `CONTENT_TYPE_SPEECH`) that help trigger SCO establishment?

9. **What is the actual system-level flow** when Samsung Voice Recorder activates the BT mic? Is it possible to trace this (e.g., via `dumpsys audio`, `dumpsys bluetooth_manager`) to understand the API path?

10. **Has anyone solved this specific problem** (BT SCO mic in a third-party app on Samsung Galaxy S24 / One UI 6+)? Look for Android developer forum posts, Stack Overflow answers, GitHub issues in audio libraries, or blog posts.

## Desired Outcome

A working approach to capture audio from a Bluetooth headset microphone in a third-party Android app running on Samsung Galaxy S24 Ultra. The solution should:

- Work without root or system app privileges
- Be implementable in a React Native app with custom Kotlin native modules
- Ideally not require the user to take any special setup steps
- Be reliable enough for real-world use (motorcycle riding, hands-free voice input)

## Constraints

- The app is not a phone/dialer app — it's a voice assistant interface
- The app already has a `MediaSession` for Bluetooth remote button control (can be temporarily suspended)
- The app needs to record 5–60 second voice clips, not continuous streaming
- The recording is sent to OpenAI Whisper API for transcription, so quality can be moderate (speech recognition, not music)
- The phone is a Samsung Galaxy S24 Ultra specifically — Samsung-specific solutions are acceptable
