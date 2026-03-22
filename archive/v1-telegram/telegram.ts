/**
 * TelegramService — sends messages to and receives responses from
 * a Telegram bot connected to a Claude Code channel session.
 */

const TELEGRAM_API = 'https://api.telegram.org/bot';

export interface TelegramConfig {
  botToken: string;
  chatId: string;
}

export class TelegramService {
  private botToken: string;
  private chatId: string;
  private pollingInterval: ReturnType<typeof setInterval> | null = null;
  private lastUpdateId = 0;
  private responseCallback: ((text: string) => void) | null = null;
  private botId: number | null = null;

  constructor(config: TelegramConfig) {
    this.botToken = config.botToken;
    this.chatId = config.chatId;
  }

  private url(method: string): string {
    return `${TELEGRAM_API}${this.botToken}/${method}`;
  }

  /**
   * Verify the bot token is valid and get bot info.
   */
  async verifyToken(): Promise<{ ok: boolean; error?: string; botName?: string }> {
    try {
      const res = await fetch(this.url('getMe'));
      const data = await res.json();
      if (data.ok) {
        this.botId = data.result.id;
        return { ok: true, botName: data.result.first_name };
      }
      return { ok: false, error: data.description ?? 'Unknown error' };
    } catch (e: any) {
      return { ok: false, error: e.message ?? 'Network error' };
    }
  }

  /**
   * Send a text message to the configured chat via the bot.
   */
  async sendMessage(text: string): Promise<{ ok: boolean; error?: string }> {
    try {
      const res = await fetch(this.url('sendMessage'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: this.chatId, text }),
      });
      const data = await res.json();
      if (data.ok) {
        return { ok: true };
      }
      return { ok: false, error: data.description ?? 'Send failed' };
    } catch (e: any) {
      return { ok: false, error: e.message ?? 'Network error' };
    }
  }

  /**
   * Register a callback for incoming responses.
   */
  onResponse(callback: (text: string) => void): void {
    this.responseCallback = callback;
  }

  /**
   * Emit a response to the registered callback.
   * Called internally by polling, and can also be called externally
   * by a NotificationListenerService bridge.
   */
  emitResponse(text: string): void {
    this.responseCallback?.(text);
  }

  /**
   * Start polling getUpdates for new messages.
   *
   * Note: getUpdates only returns messages sent TO the bot (user messages).
   * Bot-sent messages (Claude's replies) do NOT appear here. For receiving
   * Claude's responses, use Android NotificationListenerService or Tasker
   * to intercept Telegram notifications. This polling serves as a fallback
   * and can detect if a group/channel setup is used where all messages
   * appear in updates.
   */
  startPolling(intervalMs = 3000): void {
    if (this.pollingInterval) return;

    this.pollingInterval = setInterval(async () => {
      try {
        const qs = `offset=${this.lastUpdateId + 1}&timeout=0&allowed_updates=${encodeURIComponent(JSON.stringify(['message']))}`;
        const res = await fetch(`${this.url('getUpdates')}?${qs}`);
        const data = await res.json();

        if (!data.ok || !data.result?.length) return;

        for (const update of data.result) {
          this.lastUpdateId = update.update_id;

          const msg = update.message;
          if (!msg?.text) continue;

          // Skip messages we sent (from the user to the bot)
          // We only want messages FROM the bot (Claude's replies)
          // In a standard 1:1 chat, bot-sent messages won't appear here.
          // But in group chats or forwarded setups they might.
          if (msg.from?.id === this.botId) continue;
          if (String(msg.chat.id) !== this.chatId) continue;

          // If we get here, it's a message in our chat that isn't from us
          // This could be from a group setup or channel forwarding
          this.emitResponse(msg.text);
        }
      } catch (e) {
        // Silently ignore polling errors — will retry next interval
      }
    }, intervalMs);
  }

  /**
   * Stop polling and clean up.
   */
  destroy(): void {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
    this.responseCallback = null;
  }
}
