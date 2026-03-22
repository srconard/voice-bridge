# Claude Code Session Prompt for Voice-from-Bike Use

Add this to your Claude Code session's initial instructions to optimize
responses for TTS playback while riding.

## Option 1: CLAUDE.md in your project

Add this to your project's `CLAUDE.md`:

```markdown
## Voice Mode (Bike Channel)

When receiving messages from the Telegram channel, I am riding my bike and
listening to responses via text-to-speech through headphones.

Guidelines for channel responses:
- Keep responses SHORT — 2-3 sentences max unless I ask for detail
- No code blocks, markdown formatting, or bullet points — just plain speech
- Lead with the answer, then context if needed
- Use conversational language, not technical writing
- If I ask about code, describe what to do rather than writing the code
  (I can't read code while riding — I'll implement it when I'm back)
- If something needs a long response, summarize in one sentence then say
  "I'll have the full details ready when you're back at your desk"
- Confirm actions briefly: "Done, pushed to main" not a full recap
```

## Option 2: Session flag

Start your session with a voice-mode flag:

```bash
claude --channels plugin:telegram@claude-plugins-official \
  --system-prompt "Respond concisely for text-to-speech. Max 2-3 sentences. No markdown or code blocks. Conversational tone."
```

## Good Voice Interactions (Examples)

You say: "What's the status of the auth PR?"
Claude: "The auth PR has 2 approvals and passed CI. There's one comment from
Sarah asking about the token expiry logic. You might want to address that
before merging."

You say: "Add a TODO comment above the login function reminding me to add
rate limiting"
Claude: "Done, added the TODO comment above the login function in
auth-controller.ts."

You say: "What were the main things I was working on yesterday?"
Claude: "Yesterday you were focused on the payment webhook handler and fixing
the flaky integration test in checkout. The webhook is done, the test still
needs the mock server timeout fix."
