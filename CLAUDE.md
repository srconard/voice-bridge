# Claude Voice Bridge

Hands-free voice interface for Claude Code — talk to Claude from your phone (or bike) using a Bluetooth remote and headphones.

## Project Status

**Phase: v2 — Direct HTTP bridge via custom channel plugin (voice input working, adding TTS + BT remote)**

**Project location: `C:\dev\voice-bridge`**

### What Works
- Custom "voicebridge" MCP channel plugin (forked from fakechat) — **tested, working**
- Browser debug UI at `http://localhost:8787` — sends messages to Claude Code, receives replies
- React Native app with WebSocket transport (BridgeService) — **working on phone over WiFi** (confirmed 2026-03-22)
- **Voice input** — tap mic to start, tap to stop; auto-restart accumulation across pauses (2026-03-24)
- Plugin registered in Claude Code plugin system and enabled
- Windows Firewall rule added for port 8787
- `android:usesCleartextTraffic="true"` set in AndroidManifest (required for HTTP)

### What's Next
1. **TTS output** — Android native TTS or server-side (OpenAI TTS API) to read Claude's replies aloud
2. **BT remote** — Bluetooth shutter remote to toggle mic and send (screen-on wake lock approach)
3. **Tailscale** — for remote/cellular access outside home WiFi
4. **Screen-off mode** (future) — requires foreground service + raw audio capture + cloud speech API

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

## Key Files

| File | Purpose |
|------|---------|
| `App.tsx` | React Native app — setup screen, chat UI, voice input (mic button + auto-restart) |
| `src/services/bridge.ts` | BridgeService: WebSocket connection, sendMessage, response callbacks |
| `plugin/server.ts` | Voicebridge MCP channel plugin (forked from fakechat) |
| `plugin/package.json` | Plugin dependencies (@modelcontextprotocol/sdk) |
| `plugin/.mcp.json` | MCP server config for Claude Code |
| `patches/` | patch-package patches (voice library build.gradle + native module name fix) |
| `VOICE_PROMPT.md` | CLAUDE.md snippet to make Claude responses TTS-friendly |
| `gemini_research.md` | Architecture research and analysis |
| `archive/v1-telegram/` | Old Telegram-based app code |

## Tech Stack

- **React Native 0.84** (TypeScript) — Android app
- **@react-native-voice/voice** — speech-to-text (patched for RN 0.84 compatibility)
- **react-native-safe-area-context** — safe area insets for input bar layout
- **voicebridge channel plugin** — custom MCP server (Bun), forked from fakechat
- **WebSocket** — bidirectional real-time communication
- **@react-native-async-storage/async-storage** — persists server URL
- **patch-package** — persists patches to @react-native-voice/voice

## Voice Input Details

The voice input uses Android's SpeechRecognizer via `@react-native-voice/voice` with an auto-restart loop:

1. User taps mic → `Voice.start('en-US')` begins recognition
2. User speaks → `onSpeechPartialResults` shows live transcript
3. User pauses (~2-3s) → `onSpeechResults` fires → text appended to accumulated buffer → recognizer auto-restarts
4. User taps mic again → `Voice.cancel()` stops recognition, accumulated + pending partial text saved to input field
5. User taps Send (or edits text first)

**Key implementation details:**
- `shouldListen` ref controls the auto-restart loop (prevents restarts after manual stop)
- `stoppingRef` prevents race conditions — Voice callbacks ignore events during the stop sequence
- `accumulatedText` ref holds text across restart cycles; `partialRef` holds in-progress text for capture on stop
- `Voice.cancel()` used instead of `Voice.stop()` to avoid crashes between restart cycles

**Patches required** (`patches/@react-native-voice+voice+3.2.4.patch`):
- `android/build.gradle`: replaced `jcenter()` with `mavenCentral()`/`google()`, added `namespace`, updated SDK versions
- `VoiceModule.java`: changed `getName()` from `"RCTVoice"` to `"Voice"` (JS/native name mismatch)

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
- Debug web UI available at `http://localhost:8787`
- If port 8787 is in use from a previous session: `netstat -ano | findstr :8787` then `taskkill /F /PID <pid>`

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

**Transfer to phone:**
- Network share: `cp app-release.apk "//Shawns_Brain/Shawns Brain/transfer/voice-bridge-v2.apk"`
- Google Drive: `cp app-release.apk "G:\My Drive\transfer\voice-bridge-v2.apk"`

### Build Dependencies
- JDK 17 Temurin: `C:\Program Files\Eclipse Adoptium\jdk-17.0.18.8-hotspot`
- Android SDK 36, Build Tools 36.0.0, NDK 27.1.12297006, CMake 3.22.1
- Bun runtime (for the channel plugin)
- `android/gradle.properties`: `org.gradle.java.home` points to JDK 17, `android.enableJetifier=true`, `reactNativeArchitectures=arm64-v8a` (arm64 only to save build memory), **`newArchEnabled=false`** (required — `@react-native-voice/voice` only supports old architecture)
- `android/build.gradle`: `allprojects` block adds async-storage local Maven repo
- `android/app/src/main/AndroidManifest.xml`: `tools:replace="android:appComponentFactory"` for AndroidX compat, `android:usesCleartextTraffic="true"` for HTTP

### Build Tips
- **Memory**: Building while a Claude Code channel session is running can cause OOM/JVM crashes. Close the channel session before building.
- **Lint skip**: If OOM persists, skip lint: `./gradlew assembleRelease -x lintVitalAnalyzeRelease -x lintVitalReportRelease -x lintVitalRelease`
- **Patches**: Run `npm install` (or `npx patch-package`) after cloning to apply voice library patches

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
- Added `/health` endpoint for connection checking
- Dark theme on the debug web UI
- Instructions tuned for mobile/voice use case

Source plugin: `~/.claude/plugins/marketplaces/claude-plugins-official/external_plugins/fakechat/`
