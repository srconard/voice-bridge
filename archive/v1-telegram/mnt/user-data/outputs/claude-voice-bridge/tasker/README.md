# Tasker Quick-Start: Voice → Claude Code in 30 Minutes

No coding required. This uses Tasker + AutoVoice to wire up the full
voice loop with your existing Telegram bot.

## Install These Apps

1. **Tasker** ($3.49 on Play Store — worth it)
2. **AutoVoice** (free plugin for Tasker, by joaoapps)
3. **Telegram** (if not already installed)

## Get Your Bot Details

You need two values:
- **Bot Token**: from BotFather (you already have this)
- **Chat ID**: your personal chat ID with the bot

To get your Chat ID:
1. Send any message to your bot in Telegram
2. Open this URL in your browser (replace YOUR_TOKEN):
   `https://api.telegram.org/botYOUR_TOKEN/getUpdates`
3. Look for `"chat":{"id":123456789}` — that number is your Chat ID

## Profile 1: BT Button → Voice → Send to Claude

This captures your voice and sends it to Claude Code via the Telegram bot.

### Create the Task: "Send Voice to Claude"

1. Open Tasker → **Tasks** tab → **+** → Name: "Send Voice to Claude"

2. Add action: **Plugin → AutoVoice → Recognize**
   - Config: tap the pencil icon
   - Set "Continuous" to OFF
   - Set "Timeout" to 15 seconds (enough for most voice commands)
   - Tap ✓ to save

3. Add action: **Net → HTTP Request**
   - Method: **POST**
   - URL: `https://api.telegram.org/botYOUR_TOKEN/sendMessage`
   - Headers: `Content-Type: application/json`
   - Body:
     ```json
     {"chat_id": YOUR_CHAT_ID, "text": "%avword"}
     ```
   - (Replace YOUR_TOKEN and YOUR_CHAT_ID with your actual values)
   - `%avword` is the AutoVoice variable containing what you said

4. Add action: **Alert → Flash**
   - Text: `Sent: %avword`
   - (Optional: helps confirm it worked)

### Create the Profile (Trigger)

**Option A: Volume Button Trigger** (works with cheap BT remotes)

1. **Profiles** tab → **+**
2. **Event → Hardware → Button: Volume Up** (or Volume Down)
   - NOTE: this triggers on ANY volume up press, so you may want to
     add a condition like "only when Bluetooth connected to [remote name]"
3. Link to task: "Send Voice to Claude"

**Option B: Shake Trigger** (no remote needed)

1. **Profiles** tab → **+**
2. **Event → Sensor → Shake**
   - Axis: Left-Right
   - Sensitivity: Medium
3. Link to task: "Send Voice to Claude"

**Option C: Quick Settings Tile** (manual tap)

1. **Preferences → Action → Quick Settings Tasks**
2. Assign "Send Voice to Claude" to a tile
3. Pull down notification shade and tap to trigger

## Profile 2: Claude's Response → TTS

This intercepts Telegram notifications from your bot and speaks them.

### Create the Task: "Speak Claude Response"

1. **Tasks** tab → **+** → Name: "Speak Claude Response"

2. Add action: **Code → JavaScriptlet**
   - Code:
     ```javascript
     // Extract the message text from the notification
     var title = evtprm1;  // notification title
     var text = evtprm2;   // notification text (message body)

     // Only process if it's from our bot
     // (title will be your bot's name)
     if (text && text.length > 0) {
       setLocal("response_text", text);
     }
     ```

3. Add action: **Alert → Say** (TTS)
   - Text: `%response_text`
   - Engine: leave default (Google TTS)
   - Stream: **Music** (important! this routes through your headphones)
   - Pitch: 1.0
   - Speed: 1.2 (optional: slightly faster is nice for code responses)

4. (Optional) Add action: **Alert → Flash**
   - Text: `Claude: %response_text`

### Create the Profile (Trigger)

1. **Profiles** tab → **+**
2. **Event → UI → Notification**
   - Owner App: **Telegram**
   - Title: your bot's display name (e.g., "Claude Bike Brain")
3. Link to task: "Speak Claude Response"

**IMPORTANT**: Tasker needs Notification Access permission.
Go to Android Settings → Apps → Special access → Notification access → enable Tasker.

## Profile 3: BT Connection State (Optional)

Auto-enable/disable the voice profiles when your BT remote connects.

1. **Profiles** tab → **+**
2. **State → Net → BT Connected**
   - Name: your BT remote's name
3. Entry task: **Enable profiles** (Profile 1 and 2)
4. Exit task: **Disable profiles** (Profile 1 and 2)

This way the volume button override only works when your remote is connected.

## Testing Checklist

- [ ] Claude Code running with `--channels plugin:telegram@claude-plugins-official`
- [ ] Send a text message in Telegram to your bot → Claude responds
- [ ] Run "Send Voice to Claude" task manually → speak → check Telegram
- [ ] Claude's response appears as Telegram notification
- [ ] "Speak Claude Response" triggers and speaks the response
- [ ] BT remote press triggers voice recognition
- [ ] Audio comes through headphones (connect them and test)

## Troubleshooting

**Voice recognition doesn't start**: Make sure AutoVoice has microphone permission.

**HTTP request fails**: Double-check your bot token and chat ID. Test the URL
in a browser first.

**Notification not intercepted**: Ensure Tasker has Notification Access in
Android settings. Make sure the bot name in the profile matches exactly.

**TTS comes through phone speaker instead of headphones**: Set the Stream
to "Music" in the Say action. Your headphones must be connected as a media
audio device.

**Volume button triggers even when not riding**: Use Profile 3 to only
enable when your BT remote is connected, or add a manual on/off switch
using a Tasker widget on your home screen.

## Making It Smoother

- **Add a "listening" beep**: Before the AutoVoice action, add
  Alert → Beep → Duration 100ms. This gives audio feedback that recording started.
- **Add a "sent" confirmation beep**: After the HTTP request, add another beep.
- **Vibrate on send**: Add Alert → Vibrate → 200ms after HTTP request.
- **Filter long responses**: In the TTS task, add a condition to truncate
  very long responses: if `%response_text` > 500 chars, only speak the first 500.
