# Claude Voice Bridge

A hands-free voice interface for Claude Code — talk to Claude from your phone (or bike) using a Bluetooth remote and headphones.

## How It Works

```
Phone (React Native app)
  |  WebSocket
  v
voicebridge plugin (Bun HTTP server on your PC, port 8787)
  |  stdio (MCP channel notifications)
  v
Claude Code (running in terminal on your PC)
  |  reply tool
  v
voicebridge broadcasts response via WebSocket
  |
  v
Phone displays response (future: TTS through headphones)
```

The phone app connects directly to a custom MCP channel plugin running on your PC. No Telegram, no cloud services in the loop — just a direct WebSocket connection (secured via Tailscale for remote access).

## Quick Start

### 1. Install the voicebridge plugin

```bash
# Ensure Bun is installed (required for the plugin)
bun --version  # or: curl -fsSL https://bun.sh/install | bash

# Install plugin dependencies
cd plugin && bun install && cd ..
```

Register the plugin with Claude Code (see CLAUDE.md for details).

### 2. Start Claude Code with the channel

```bash
# Use tmux/screen so the session persists
tmux new -s claude-bike
claude --channels plugin:voicebridge@local
```

The plugin starts an HTTP + WebSocket server on port 8787. You can test it immediately by opening `http://localhost:8787` in your browser.

### 3. Install the app on your phone

Build the APK:
```bash
cd android
export JAVA_HOME="/c/Program Files/Eclipse Adoptium/jdk-17.0.18.8-hotspot"
./gradlew assembleRelease
```

Transfer `android/app/build/outputs/apk/release/app-release.apk` to your phone (e.g., via Google Drive).

### 4. Connect

On first launch, enter your PC's IP address + port:
- **Same WiFi**: `http://192.168.x.x:8787`
- **Remote (Tailscale)**: `http://100.x.y.z:8787`

Send a message — it goes directly into Claude Code's active session.

## Remote Access via Tailscale

For use away from home (e.g., riding your bike):

1. Install [Tailscale](https://tailscale.com/) on your PC and phone
2. Connect both to the same tailnet
3. Use the PC's Tailscale IP (`100.x.y.z`) in the app
4. Works over cellular — encrypted, peer-to-peer, no open ports

## Project Structure

```
voice-bridge/
  App.tsx                    # React Native app (setup + chat UI)
  src/services/bridge.ts     # BridgeService (WebSocket client)
  plugin/
    server.ts                # voicebridge MCP channel plugin
    package.json             # Plugin dependencies
    .mcp.json                # MCP server config
  android/                   # React Native Android build
  archive/v1-telegram/       # Old Telegram-based code (historical)
  CLAUDE.md                  # Detailed project docs
  VOICE_PROMPT.md            # TTS-friendly response instructions
```

## Roadmap

- [x] Text chat via direct WebSocket bridge
- [ ] Voice input (Android SpeechRecognizer intent)
- [ ] TTS output (Android native or server-side)
- [ ] Bluetooth remote trigger for hands-free use
- [ ] Auto-reconnect UI indicator

## Requirements

- **PC**: Windows 10+, Bun runtime, Claude Code
- **Phone**: Android
- **Build**: JDK 17, Android SDK 36, React Native 0.84
- **Remote access**: Tailscale (optional, for use outside home WiFi)
