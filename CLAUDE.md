# Claude Voice Bridge

Hands-free voice interface for Claude Code — talk to Claude from your phone (or bike) using a Bluetooth remote and headphones.

## Project Status

**Phase: v2 — Direct HTTP bridge via custom channel plugin (voice + TTS + BT remote working)**

**Project location: `C:\dev\voice-bridge`**

### What Works
- Custom "voicebridge" MCP channel plugin (forked from fakechat) — **tested, working**
- Browser debug UI at `http://localhost:8787` — sends messages to Claude Code, receives replies
- React Native app with WebSocket transport (BridgeService) — **working on phone over WiFi** (confirmed 2026-03-22)
- **Voice input (Whisper)** — tap mic to record, tap to stop; audio sent to server-side Whisper API for transcription; volume meter UI while recording (2026-03-24)
- **TTS output** — ElevenLabs server-side TTS; plugin generates MP3, streams URL to phone; toggle in header; live voice switching via HTTP endpoint (2026-03-24)
- Plugin registered in Claude Code plugin system and enabled
- Windows Firewall rule added for port 8787
- `android:usesCleartextTraffic="true"` set in AndroidManifest (required for HTTP)
- **BT remote** — Bluetooth shutter remote skip-forward button toggles mic; press to start listening, press again to stop + auto-send; screen-on wake lock; toggle in header (2026-03-24)
- **BT headset mic** — records from Bluetooth motorcycle helmet mic via `BluetoothHeadset.startVoiceRecognition()` SCO activation; auto-falls back to phone mic if BT unavailable (2026-03-25)

### What's Next
1. **Live partial transcripts** (future) — run Android SpeechRecognizer in parallel with Whisper for real-time feedback while speaking
2. **Tailscale** — for remote/cellular access outside home WiFi
3. **Screen-off mode** (future) — requires foreground service + raw audio capture
4. **BT mic polish** — system voice assistant briefly appears when SCO activates via voice recognition; investigate suppressing it

### Previous Architecture (v1 — archived)
The v1 app used Telegram Bot API as transport, which was fundamentally broken:
- Bot API sends messages *as the bot* — Claude Code ignores bot messages
- Polling competition between app and Claude Code for `getUpdates`
- See `archive/v1-telegram/` for the old code

## Architecture (v2)

```
┌──────────────────────────────────────────────────────────┐
│ Phone (React Native)                                      │
│   ↕ WebSocket (ws://100.x.y.z:8787/ws)                  │
│                                                          │
│ voicebridge plugin (Bun HTTP server, port 8787)          │
│   ↕ stdio (MCP notifications/claude/channel)             │
│                                                          │
│ Claude Code (terminal session)                            │
│   ↕ reply tool broadcasts to WebSocket clients           │
│                                                          │
│ Phone receives response in real time                      │
└──────────────────────────────────────────────────────────┘
```

**WebSocket protocol:**
- Send: `{ id: "u<timestamp>-<seq>", text: "message" }`
- Receive: `{ type: "msg", from: "assistant", text: "response", ... }`
- TTS config: `{ type: "tts_config", enabled: true|false }`
- Voice switch: `{ type: "set_voice", voiceId: "<elevenlabs-voice-id>" }`
- TTS audio: `{ type: "tts", replyId: "<id>", audioUrl: "/files/<id>.mp3" }`

## Key Files

| File | Purpose |
|------|---------|
| `App.tsx` | React Native app — setup screen, chat UI, voice input, TTS toggle, BT remote |
| `src/services/bridge.ts` | BridgeService: WebSocket connection, sendMessage, response/TTS callbacks |
| `src/services/tts.ts` | TTSService: audio playback via custom AudioPlayer native module |
| `plugin/server.ts` | Voicebridge MCP channel plugin (forked from fakechat) |
| `plugin/package.json` | Plugin dependencies (@modelcontextprotocol/sdk) |
| `plugin/.mcp.json` | MCP server config for Claude Code |
| `patches/` | patch-package patches (currently empty — voice library patches removed) |
| `VOICE_PROMPT.md` | CLAUDE.md snippet to make Claude responses TTS-friendly |
| `gemini_research.md` | Architecture research and analysis |
| `BT_MIC_RESEARCH.md` | Problem statement for BT headset mic deep research |
| `BT_MIC_Research_results.md` | Research results from Perplexity/Gemini/ChatGPT |
| `archive/v1-telegram/` | Old Telegram-based app code |

## Tech Stack

- **React Native 0.84** (TypeScript) — Android app
- **AudioRecorder native module** — custom Android AudioRecord wrapper for voice capture (16kHz mono WAV)
- **AudioPlayer native module** — custom Android MediaPlayer wrapper for TTS playback (no third-party dep)
- **RemoteButton native module** — MediaSession + dispatchKeyEvent interception for BT remote control
- **OpenAI Whisper API** — server-side speech-to-text (via plugin server `/transcribe` endpoint)
- **react-native-safe-area-context** — safe area insets for input bar layout
- **voicebridge channel plugin** — custom MCP server (Bun), forked from fakechat
- **WebSocket** — bidirectional real-time communication
- **@react-native-async-storage/async-storage** — persists server URL

## Voice Input Details (Whisper)

Voice input uses a custom `AudioRecorderModule` native module to capture raw audio, then sends it to the plugin server's `/transcribe` endpoint which forwards to OpenAI's Whisper API.

**Flow:**
1. User taps mic → `AudioRecorder.start()` begins recording (16kHz mono PCM → WAV)
2. UI shows red pulsing dot + "Recording..." + volume level bar (driven by `audioLevel` events from native module)
3. User taps mic again → `AudioRecorder.stop()` returns WAV file path
4. App sends audio to `POST ${serverUrl}/transcribe` via `FormData`
5. Plugin server forwards to Whisper API, returns transcribed text
6. Text placed in input field for review/edit/send
7. If triggered via BT remote, text auto-sends immediately after transcription

**Key implementation details:**
- `AudioRecorderModule.kt` uses Android `AudioRecord` API (not MediaRecorder) for raw PCM capture
- WAV format: 44-byte header + raw 16-bit PCM, written to `cacheDir/voice_recording.wav`
- Emits `audioLevel` events (~10Hz) with RMS amplitude (0.0–1.0) for volume meter
- `isRecordingRef` ref tracks state for BT remote handler (avoids stale closure)
- Whisper has 25MB limit — at 16kHz/16-bit/mono that's ~13 minutes (more than enough)
- Transcription typically takes 1–3 seconds for a 10–30 second clip

**Native module files:**
- `android/.../AudioRecorderModule.kt` — recording logic, BT SCO mic, WAV header writing, audio level events
- `android/.../AudioRecorderPackage.kt` — ReactPackage registration

## BT Headset Mic Details

The app can record from a Bluetooth headset mic (e.g., motorcycle helmet headset) using `BluetoothHeadset.startVoiceRecognition()` to establish the SCO audio transport. This was the key breakthrough — standard APIs like `setCommunicationDevice()`, `startBluetoothSco()`, and `setPreferredDevice()` all failed on Samsung S24 Ultra because they only set routing preferences without opening the actual SCO link.

**Flow:**
1. `start()` runs on a background thread, calls `tryBluetoothVoiceRecognition()`
2. Gets `BluetoothHeadset` profile proxy via `BluetoothAdapter.getProfileProxy()`
3. Suspends RemoteButton MediaSession (must release audio focus for SCO)
4. Registers `BroadcastReceiver` for `BluetoothHeadset.ACTION_AUDIO_STATE_CHANGED`
5. Calls `headset.startVoiceRecognition(device)` — sends AT command to headset, triggers SCO
6. Waits up to 5s for `STATE_AUDIO_CONNECTED` broadcast (state transitions: 10→11→12)
7. If connected: sets `MODE_IN_COMMUNICATION`, creates `AudioRecord` with `VOICE_COMMUNICATION` source, starts silent `AudioTrack` for full-duplex hint, records via `READ_NON_BLOCKING`
8. After 10 reads, verifies non-zero audio — falls back to phone mic if all zeros
9. On stop: calls `stopVoiceRecognition()`, restores audio mode, resumes RemoteButton MediaSession

**Why startVoiceRecognition works when other APIs don't:**
- Android has 3 mutually exclusive SCO activation modes: Telecom call, virtual call, voice recognition
- `startVoiceRecognition()` is a public API that explicitly establishes the SCO audio connection
- It sends the Bluetooth voice recognition AT command to the headset, forcing the hardware link open
- Standard routing APIs (`setCommunicationDevice`, `setPreferredDevice`) only set software preferences

**Known quirk:** `startVoiceRecognition()` also activates the system voice assistant (Bixby/Google). It may briefly appear. We cannot call `stopVoiceRecognition()` before recording because it closes the SCO link. Called only at cleanup.

**Key details:**
- `MODIFY_AUDIO_SETTINGS` permission required in manifest
- Silent `AudioTrack` with `USAGE_VOICE_COMMUNICATION` keeps full-duplex SCO stable
- RemoteButton suspend/resume uses `runOnUiThread` (MediaSession requires main thread)
- `READ_NON_BLOCKING` prevents app hangs when BT data isn't flowing
- Emits `audioStatus` events for debug UI (visible in App.tsx status log)
- See `BT_MIC_RESEARCH.md` and `BT_MIC_Research_results.md` for full research history

## BT Remote Details

The BT remote feature uses a Bluetooth shutter remote's skip forward button (`KEYCODE_MEDIA_NEXT` = 87) to control voice input hands-free.

**Flow:**
1. User enables BT remote toggle in header (blue icon)
2. Press skip forward → starts audio recording (same as tapping mic)
3. Speak → volume meter shows audio level
4. Press skip forward again → stops recording, transcribes via Whisper, **auto-sends** transcribed text
5. Screen stays on via `FLAG_KEEP_SCREEN_ON` while remote mode is active

**Native implementation (two layers):**
- `RemoteButtonModule.kt` — creates a `MediaSession` with audio focus + `PlaybackState.STATE_PLAYING` to receive media button routing from Android. Emits `"remoteButton"` events to JS via `RCTDeviceEventEmitter`
- `MainActivity.kt` — overrides `dispatchKeyEvent()` as a fallback to catch media keys at the Activity level (more reliable for generic BT shutter remotes that don't route through MediaSession)
- Only `KEYCODE_MEDIA_NEXT` (87) is intercepted; all other keys pass through normally
- `RemoteButtonModule.instance` static ref allows MainActivity to forward events to the module
- Module is only active when `setEnabled(true)` is called (toggled via header icon)

**Key files:**
- `android/.../RemoteButtonModule.kt` — native module (MediaSession, audio focus, wake lock, event emitter)
- `android/.../RemoteButtonPackage.kt` — ReactPackage registration
- `android/.../MainActivity.kt` — `dispatchKeyEvent` override for BT key interception

## Running the Plugin

The plugin is configured as an MCP server in `C:\dev\voice-bridge\.mcp.json`. To launch:

```bash
cd C:\dev\voice-bridge
claude --dangerously-load-development-channels server:voicebridge
```

**Important notes:**
- Must `cd` to `C:\dev\voice-bridge` first — the `.mcp.json` in the project root defines the `voicebridge` server
- `plugin:voicebridge@local` does NOT work (channel allowlist rejects non-marketplace plugins)
- `server:voicebridge` requires the `--dangerously-load-development-channels` flag
- When Claude asks to approve the MCP server, say yes
- The plugin starts an HTTP + WebSocket server on port 8787 (configurable via `VOICEBRIDGE_PORT` env var)
- **STT env var**: `OPENAI_API_KEY` (required for Whisper transcription)
- **TTS env vars**: `ELEVENLABS_API_KEY` (required for TTS), `ELEVENLABS_VOICE_ID` (optional, default: `21m00Tcm4TlvDq8ikWAM` / Rachel). Currently set to Antoni (`ErXwobaYiN019PkySvjV`)
- **ElevenLabs requires a paid plan** — free tier gets blocked with "unusual activity detected" error
- **Live voice switching**: `POST http://localhost:8787/voice/<voiceId>` changes the voice without restart. `GET /voice` returns current voice ID. Also supported via WebSocket: `{ type: "set_voice", voiceId: "<id>" }`
- Debug web UI available at `http://localhost:8787`
- If port 8787 is in use from a previous session: `netstat -ano | findstr :8787` then `taskkill //F //PID <pid>` (note `//` for bash-on-Windows)

### Plugin Registration (for reference)
- Plugin is registered in `~/.claude/plugins/installed_plugins.json` as `voicebridge@local`
- Plugin is enabled in `~/.claude/settings.json` under `enabledPlugins`
- `channelsEnabled: true` is set in `~/.claude/settings.json`
- MCP server defined in `C:\dev\voice-bridge\.mcp.json` (project-level)
- Plugin source/cache at `~/.claude/plugins/cache/local/voicebridge/0.1.0/`

## Building the App

```bash
cd C:\dev\voice-bridge\android
export JAVA_HOME="/c/Program Files/Eclipse Adoptium/jdk-17.0.18.8-hotspot"

# Debug APK (needs Metro bundler running)
./gradlew assembleDebug

# Release APK (standalone, no PC needed)
./gradlew assembleRelease
```

**Release APK:** `android/app/build/outputs/apk/release/app-release.apk`

**Transfer to phone (default):**
```bash
cp android/app/build/outputs/apk/release/app-release.apk "//Shawns_Brain/Shawns Brain/transfer/voice-bridge-v2.apk"
```
- Alternative: Google Drive: `cp app-release.apk "G:\My Drive\transfer\voice-bridge-v2.apk"`

### Build Dependencies
- JDK 17 Temurin: `C:\Program Files\Eclipse Adoptium\jdk-17.0.18.8-hotspot`
- Android SDK 36, Build Tools 36.0.0, NDK 27.1.12297006, CMake 3.22.1
- Bun runtime (for the channel plugin)
- `android/gradle.properties`: `org.gradle.java.home` points to JDK 17, `android.enableJetifier=true`, `reactNativeArchitectures=arm64-v8a` (arm64 only to save build memory), `newArchEnabled=false`
- `android/build.gradle`: `allprojects` block adds async-storage local Maven repo
- `android/app/src/main/AndroidManifest.xml`: `tools:replace="android:appComponentFactory"` for AndroidX compat, `android:usesCleartextTraffic="true"` for HTTP

### Build Tips
- **Memory**: Building while a Claude Code channel session is running can cause OOM/JVM crashes. Close the channel session before building.
- **Lint skip**: If OOM persists, skip lint: `./gradlew assembleRelease -x lintVitalAnalyzeRelease -x lintVitalReportRelease -x lintVitalRelease`
- **Patches**: `patch-package` is still configured but no patches are currently needed

### Windows Path Length
Project MUST live at a short path (e.g., `C:\dev\voice-bridge`). Long paths cause ninja build failures due to Windows 260-char limit.

## Networking

### Same-WiFi Testing
- PC LAN IP: `192.168.0.127` (may change — check with `ipconfig`)
- App setup screen: `http://192.168.0.127:8787`
- Windows Firewall rule already added: `name="voicebridge" dir=in action=allow protocol=TCP localport=8787`
- **Debugging**: try opening `http://192.168.0.127:8787` in the phone's browser first — if the debug UI loads, the network path works

### Tailscale (Remote / Cellular — not yet set up)
1. Install Tailscale on PC and Android phone, connect to same tailnet
2. Note the PC's Tailscale IP (100.x.y.z)
3. The voicebridge plugin binds to `0.0.0.0` — reachable on all interfaces
4. In the app setup screen, enter `http://100.x.y.z:8787`

## Plugin Details

The voicebridge plugin (`plugin/server.ts`) is a fork of the official `fakechat` channel plugin with these changes:
- Binds to `0.0.0.0` instead of `127.0.0.1` (reachable over network)
- Renamed from "fakechat" to "voicebridge"
- Added `/health` endpoint for connection checking (includes `voiceId` and `envVoiceId` in response)
- Added `/voice` GET endpoint (returns current voice ID) and `/voice/:id` POST endpoint (live voice switching)
- Added `/transcribe` POST endpoint — accepts multipart audio, forwards to Whisper API, returns `{ text }`
- Added `/files/:name` endpoint to serve TTS MP3 files from outbox
- ElevenLabs TTS generation: on reply, if any WebSocket client has `ttsEnabled: true` and `ELEVENLABS_API_KEY` is set, generates MP3 and broadcasts audio URL
- WebSocket accepts `tts_config` (enable/disable TTS) and `set_voice` (change ElevenLabs voice) messages
- Dark theme on the debug web UI
- Instructions tuned for mobile/voice use case

### Known ElevenLabs Voice IDs
| Voice | ID | Description |
|-------|----|-------------|
| Rachel | `21m00Tcm4TlvDq8ikWAM` | Female, calm, American (default) |
| Adam | `pNInz6obpgDQGcFmaJgB` | Male, deep, American |
| Antoni | `ErXwobaYiN019PkySvjV` | Male, warm, American (current) |
| Josh | `TxGEqnHWrfWFTfGW9XjX` | Male, young, American |
| Arnold | `VR6AewLTigWG4xSOukaG` | Male, crisp, American |
| Sam | `yoZ06aMxZJJ28mfd3POQ` | Male, raspy, American |
| Bella | `EXAVITQu4vr4xnSDxMaL` | Female, soft, American |
| Elli | `MF3mGyEYCl7XYWbV9V6O` | Female, young, American |

### Plugin Process Gotcha
**WARNING**: When editing `plugin/server.ts` while the plugin is running, Claude Code may restart the MCP server process, but the OLD process can keep port 8787. This causes a split-brain: the reply tool goes through the new MCP process (via stdio), but HTTP/WebSocket clients connect to the old process. TTS and live voice changes will appear broken.

**Fix**: Kill the stale process before or after editing:
```bash
netstat -ano | findstr :8787
taskkill //F //PID <pid>
```
Then restart the Claude Code session. Alternatively, avoid editing `server.ts` while a voice bridge session is active — make edits between sessions.

Source plugin: `~/.claude/plugins/marketplaces/claude-plugins-official/external_plugins/fakechat/`
