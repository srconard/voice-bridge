/**
 * TTSService — plays TTS audio from the voicebridge plugin server.
 * Uses a custom native AudioPlayer module (Android MediaPlayer).
 */

import { NativeModules } from 'react-native';

const { AudioPlayer } = NativeModules;

export class TTSService {
  play(url: string): void {
    AudioPlayer.play(url);
  }

  stop(): void {
    AudioPlayer.stop();
  }

  destroy(): void {
    this.stop();
  }
}
