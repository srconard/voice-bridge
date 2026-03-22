# Research Prompt: Voice Bridge to Claude Code from Android Phone

## Problem Statement

I'm building a hands-free voice interface to interact with Claude Code (Anthropic's CLI tool) from my Android phone while riding my bike. The goal: press a button on a Bluetooth remote on my handlebars → speak → my words get transcribed and sent to a running Claude Code session on my home PC → Claude's response plays through my headphones via TTS.

## What I Have Working

- A React Native Android app that can send/receive text
- A Telegram bot paired with Claude Code via the `plugin:telegram@claude-plugins-official` channel plugin
- Claude Code running on my Windows PC with `--channels plugin:telegram@claude-plugins-official`

## The Core Problem

**The Telegram Bot API can't send messages "as the user."** When my app uses the bot's `sendMessage` API, the message is sent *from the bot*, not from me. Claude Code's Telegram channel plugin only processes messages from real users (via `getUpdates`), so it never sees messages my app sends. The bot API is fundamentally one-directional for this use case.

Additionally, both my app and Claude Code's plugin compete to poll `getUpdates`, so receiving Claude's responses in the app is inconsistent.

## What I'm Looking For

Please search for existing projects, tools, libraries, or approaches that solve any of these:

1. **Custom Claude Code channel plugins that expose an HTTP API** — so my phone app can POST messages directly into a running Claude Code session without going through Telegram. I already found:
   - `fakechat` (official plugin at `anthropics/claude-plugins-official`) — runs a localhost web chat UI on port 8787
   - The Hookdeck webhook channel tutorial
   - `cc-connect` — multi-platform bridge
   - `golembot` — supports HTTP deployment

2. **Any way to send messages into a running Claude Code session from an external app** — channels, SDK, stdin piping, anything

3. **Android apps or frameworks for voice-to-text-to-API pipelines** — push-to-talk apps that transcribe voice and send to a configurable HTTP endpoint

4. **Projects combining Claude Code + mobile voice interfaces** — anyone who's built something similar

5. **Alternatives to the Telegram Bot API for two-way communication** — Telegram User API (MTProto/Telethon), or completely different transports that would work better

## Ideal Solution

The dream architecture would be:
```
Phone (voice) → STT → HTTP POST to home PC → Claude Code channel plugin → Claude processes
                                                                              ↓
Phone (headphones) ← TTS ← HTTP response or push notification ← Claude responds
```

No Telegram in the loop at all — just a direct HTTP bridge between my phone app and Claude Code.

## Technical Context

- Claude Code channels are MCP servers that communicate over stdio
- A channel plugin declares `claude/channel` capability and emits `notifications/claude/channel` events
- The `fakechat` plugin source code is the reference implementation for HTTP-to-channel bridging
- Claude Code has a headless/programmatic mode via the `@anthropic-ai/claude-code` SDK
- My home PC runs Windows 10, Claude Code runs in Git Bash/terminal
- My phone is Android

## Questions

1. Has anyone built a mobile-to-Claude-Code voice bridge? What approach did they use?
2. Is there an existing HTTP channel plugin I can just install and point my app at?
3. Would it be simpler to build a custom channel plugin (using fakechat as a template) or to use the Claude Code SDK in headless mode with a simple Express server?
4. Are there any gotchas with exposing a localhost channel plugin to the network (for phone access over WiFi)?
5. Is there a better overall architecture I'm not seeing?
