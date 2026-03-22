# Claude Voice Bridge

Hands-free voice interface for Claude Code — talk to Claude from your phone (or bike) using a Bluetooth remote and headphones.

## Project Status

**Phase: v2 — Direct HTTP bridge via custom channel plugin (text chat working)**

**Project location: `C:\dev\voice-bridge`**

### What Works
- Custom "voicebridge" MCP channel plugin (forked from fakechat)
- React Native app connects to plugin via WebSocket
- Text input + send: messages go directly into the running Claude Code session
- Claude's responses appear in the app in real time
- No Telegram dependency — direct HTTP/WebSocket connection
- Works over Tailscale for remote/cellular access

### What's Next
1. **Voice input** — Android SpeechRecognizer intent (native module) or voice keyboard
2. **TTS output** — Android native TTS or server-side (OpenAI TTS API)
3. **BT remote** — pair Bluetooth shutter remote for hands-free activation

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
| `App.tsx` | React Native app — setup screen (server URL), text chat UI |
| `src/services/bridge.ts` | BridgeService: WebSocket connection, sendMessage, response callbacks |
| `plugin/server.ts` | Voicebridge MCP channel plugin (forked from fakechat) |
| `plugin/package.json` | Plugin dependencies (@modelcontextprotocol/sdk) |
| `plugin/.mcp.json` | MCP server config for Claude Code |
| `VOICE_PROMPT.md` | CLAUDE.md snippet to make Claude responses TTS-friendly |
| `gemini_research.md` | Architecture research and analysis |
| `research-prompt.md` | Research prompt for further investigation |
| `archive/v1-telegram/` | Old Telegram-based app code |

## Tech Stack

- **React Native 0.84** (TypeScript) — Android app
- **voicebridge channel plugin** — custom MCP server (Bun), forked from fakechat
- **WebSocket** — bidirectional real-time communication
- **Tailscale** — secure P2P VPN for remote access
- **@react-native-async-storage/async-storage** — persists server URL

## Running the Plugin

```bash
# Start Claude Code with the voicebridge channel
claude --channels plugin:voicebridge@local

# Or with the development flag if plugin registration doesn't work:
# claude --dangerously-load-development-channels server:C:\dev\voice-bridge\plugin
```

The plugin starts an HTTP + WebSocket server on port 8787 (configurable via `VOICEBRIDGE_PORT` env var). It also serves a debug web UI at the root URL.

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
**Transfer to phone:** Copy to `G:\My Drive\transfer\` for Google Drive pickup.

### Build Dependencies
- JDK 17 Temurin: `C:\Program Files\Eclipse Adoptium\jdk-17.0.18.8-hotspot`
- Android SDK 36, Build Tools 36.0.0, NDK 27.1.12297006, CMake 3.22.1
- Bun runtime (for the channel plugin)
- `android/gradle.properties`: `org.gradle.java.home` points to JDK 17, `android.enableJetifier=true`
- `android/build.gradle`: `allprojects` block adds async-storage local Maven repo
- `android/app/src/main/AndroidManifest.xml`: `tools:replace="android:appComponentFactory"` for AndroidX compat

### Windows Path Length
Project MUST live at a short path (e.g., `C:\dev\voice-bridge`). Long paths cause ninja build failures due to Windows 260-char limit.

## Networking / Tailscale Setup

1. Install Tailscale on PC and Android phone, connect to same tailnet
2. Note the PC's Tailscale IP (100.x.y.z)
3. The voicebridge plugin binds to `0.0.0.0` — reachable on all interfaces
4. In the app setup screen, enter `http://100.x.y.z:8787`
5. Windows Firewall: may need to allow inbound on port 8787

For same-WiFi testing, use the PC's LAN IP instead.

## Plugin Details

The voicebridge plugin (`plugin/server.ts`) is a fork of the official `fakechat` channel plugin with these changes:
- Binds to `0.0.0.0` instead of `127.0.0.1` (reachable over network)
- Renamed from "fakechat" to "voicebridge"
- Added `/health` endpoint for connection checking
- Dark theme on the debug web UI
- Instructions tuned for mobile/voice use case

Source plugin: `~/.claude/plugins/marketplaces/claude-plugins-official/external_plugins/fakechat/`
