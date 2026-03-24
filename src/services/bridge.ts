/**
 * BridgeService — connects to the voicebridge channel plugin via WebSocket.
 * Sends messages and receives Claude's responses in real time.
 */

export interface BridgeConfig {
  serverUrl: string; // e.g., "http://100.x.y.z:8787"
}

export class BridgeService {
  private serverUrl: string;
  private ws: WebSocket | null = null;
  private responseCallback: ((text: string) => void) | null = null;
  private ttsCallback: ((audioUrl: string, replyId: string) => void) | null = null;
  private pendingTTSConfig: boolean | null = null;
  private seq = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(config: BridgeConfig) {
    // Normalize: strip trailing slash
    this.serverUrl = config.serverUrl.replace(/\/+$/, '');
  }

  private wsUrl(): string {
    // Convert http(s):// to ws(s)://
    return this.serverUrl.replace(/^http/, 'ws') + '/ws';
  }

  /**
   * Check if the server is reachable.
   */
  async checkHealth(): Promise<{ok: boolean; error?: string}> {
    try {
      const res = await fetch(`${this.serverUrl}/health`, {
        method: 'GET',
      });
      if (res.ok) {
        return {ok: true};
      }
      return {ok: false, error: `Server returned ${res.status}`};
    } catch (e: any) {
      return {ok: false, error: e.message ?? 'Network error'};
    }
  }

  /**
   * Connect via WebSocket to receive Claude's responses.
   */
  connect(): void {
    if (this.ws) {
      return;
    }

    const ws = new WebSocket(this.wsUrl());

    ws.onopen = () => {
      // Send pending TTS config on connect
      if (this.pendingTTSConfig !== null) {
        this.sendTTSConfig(this.pendingTTSConfig);
      }
    };

    ws.onmessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(String(event.data));
        if (data.type === 'msg' && data.from === 'assistant' && data.text) {
          this.responseCallback?.(data.text);
        } else if (data.type === 'tts' && data.audioUrl) {
          this.ttsCallback?.(data.audioUrl, data.replyId);
        }
      } catch {
        // Ignore malformed messages
      }
    };

    ws.onclose = () => {
      this.ws = null;
      // Auto-reconnect after 3 seconds
      this.reconnectTimer = setTimeout(() => this.connect(), 3000);
    };

    ws.onerror = () => {
      // onclose will fire after this
    };

    this.ws = ws;
  }

  /**
   * Send a text message to Claude via the voicebridge plugin.
   */
  async sendMessage(text: string): Promise<{ok: boolean; error?: string}> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return {ok: false, error: 'Not connected to server'};
    }

    try {
      const id = `u${Date.now()}-${++this.seq}`;
      this.ws.send(JSON.stringify({id, text}));
      return {ok: true};
    } catch (e: any) {
      return {ok: false, error: e.message ?? 'Send failed'};
    }
  }

  /**
   * Register a callback for incoming responses from Claude.
   */
  onResponse(callback: (text: string) => void): void {
    this.responseCallback = callback;
  }

  /**
   * Register a callback for incoming TTS audio URLs.
   */
  onTTS(callback: (audioUrl: string, replyId: string) => void): void {
    this.ttsCallback = callback;
  }

  /**
   * Send TTS enabled/disabled preference to the server.
   */
  sendTTSConfig(enabled: boolean): void {
    this.pendingTTSConfig = enabled;
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'tts_config', enabled }));
    }
  }

  /**
   * Disconnect and clean up.
   */
  destroy(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.onclose = null; // Prevent reconnect
      this.ws.close();
      this.ws = null;
    }
    this.responseCallback = null;
    this.ttsCallback = null;
  }
}
