/**
 * Claude Voice Bridge
 *
 * A hands-free voice interface for Claude Code via the voicebridge
 * channel plugin. Phone connects directly over WebSocket — no Telegram.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  StatusBar,
  Alert,
  KeyboardAvoidingView,
  Platform,
  PermissionsAndroid,
  NativeModules,
  NativeEventEmitter,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Voice, {
  SpeechResultsEvent,
  SpeechErrorEvent,
} from '@react-native-voice/voice';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { BridgeService } from './src/services/bridge';
import { TTSService } from './src/services/tts';

const { RemoteButton } = NativeModules;
const remoteButtonEmitter = new NativeEventEmitter(RemoteButton);

// ─────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────

type Screen = 'setup' | 'main';

interface ConversationEntry {
  role: 'user' | 'claude';
  text: string;
  timestamp: number;
}

// ─────────────────────────────────────────────────────
// Storage keys
// ─────────────────────────────────────────────────────

const STORAGE_KEYS = {
  SERVER_URL: '@cvb_server_url',
  SETUP_COMPLETE: '@cvb_setup_complete',
  TTS_ENABLED: '@cvb_tts_enabled',
  REMOTE_ENABLED: '@cvb_remote_enabled',
};

// ─────────────────────────────────────────────────────
// App
// ─────────────────────────────────────────────────────

const AppContent: React.FC = () => {
  const insets = useSafeAreaInsets();

  // Navigation
  const [screen, setScreen] = useState<Screen>('setup');
  const [loading, setLoading] = useState(true);

  // Setup form
  const [serverUrl, setServerUrl] = useState('');
  const [setupError, setSetupError] = useState('');

  // Main screen state
  const [isConnected, setIsConnected] = useState(false);
  const [conversation, setConversation] = useState<ConversationEntry[]>([]);

  // Text input
  const [inputText, setInputText] = useState('');

  // Voice input
  const [isListening, setIsListening] = useState(false);
  const [partialText, setPartialText] = useState('');
  const shouldListen = useRef(false);
  const accumulatedText = useRef('');
  const partialRef = useRef('');
  const stoppingRef = useRef(false);

  // TTS
  const [ttsEnabled, setTtsEnabled] = useState(false);
  const ttsEnabledRef = useRef(false);
  const ttsServiceRef = useRef<TTSService | null>(null);

  // BT Remote
  const [remoteEnabled, setRemoteEnabled] = useState(false);
  const remoteEnabledRef = useRef(false);

  // Refs
  const bridgeRef = useRef<BridgeService | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  // ─────────────────────────────────────────────────
  // Voice recognition setup
  // ─────────────────────────────────────────────────

  const startRecognizer = useCallback(async () => {
    try {
      await Voice.start('en-US');
    } catch (err: any) {
      // If restart fails, stop the session
      shouldListen.current = false;
      setIsListening(false);
      setPartialText('');
      const accumulated = accumulatedText.current.trim();
      if (accumulated) {
        setInputText(accumulated);
      }
    }
  }, []);

  useEffect(() => {
    Voice.onSpeechStart = () => {
      setIsListening(true);
    };

    Voice.onSpeechEnd = () => {
      // Don't stop — auto-restart will handle it if shouldListen is true
      if (!shouldListen.current) {
        setIsListening(false);
      }
    };

    Voice.onSpeechPartialResults = (e: SpeechResultsEvent) => {
      if (e.value && e.value[0]) {
        partialRef.current = e.value[0];
        setPartialText(e.value[0]);
      }
    };

    Voice.onSpeechResults = (e: SpeechResultsEvent) => {
      // Ignore results fired during stop sequence
      if (stoppingRef.current) return;

      if (e.value && e.value[0]) {
        const transcript = e.value[0].trim();
        if (transcript) {
          const sep = accumulatedText.current ? ' ' : '';
          accumulatedText.current += sep + transcript;
          setInputText(accumulatedText.current);
        }
      }
      partialRef.current = '';
      setPartialText('');

      // Auto-restart if still in a listening session
      if (shouldListen.current) {
        startRecognizer();
      } else {
        setIsListening(false);
      }
    };

    Voice.onSpeechError = (e: SpeechErrorEvent) => {
      // Ignore errors fired during stop sequence
      if (stoppingRef.current) return;

      setPartialText('');
      // error code 5 = no speech detected — restart silently if still listening
      if (shouldListen.current) {
        startRecognizer();
        return;
      }
      setIsListening(false);
    };

    return () => {
      Voice.destroy().then(Voice.removeAllListeners);
    };
  }, [startRecognizer]);

  const requestMicPermission = async (): Promise<boolean> => {
    if (Platform.OS !== 'android') return true;
    const granted = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
    );
    return granted === PermissionsAndroid.RESULTS.GRANTED;
  };

  const toggleListening = useCallback(async () => {
    try {
      if (shouldListen.current) {
        // Stop listening — set flags first to prevent auto-restart and ignore callbacks
        shouldListen.current = false;
        stoppingRef.current = true;

        // Capture any in-progress partial text before cancelling
        if (partialRef.current.trim()) {
          const sep = accumulatedText.current ? ' ' : '';
          accumulatedText.current += sep + partialRef.current.trim();
        }

        try {
          await Voice.cancel();
        } catch {
          // Recognizer may already be stopped between restart cycles
        }

        const finalText = accumulatedText.current.trim();
        if (finalText) {
          setInputText(finalText);
        }
        partialRef.current = '';
        setPartialText('');
        setIsListening(false);
        stoppingRef.current = false;
      } else {
        const hasPermission = await requestMicPermission();
        if (!hasPermission) {
          Alert.alert('Permission Required', 'Microphone permission is needed for voice input.');
          return;
        }
        // Start a new listening session
        accumulatedText.current = '';
        setPartialText('');
        setIsListening(true);
        shouldListen.current = true;
        await startRecognizer();
      }
    } catch (err: any) {
      Alert.alert('Voice Error', String(err?.message || err));
      shouldListen.current = false;
      setIsListening(false);
    }
  }, [startRecognizer]);

  // ─────────────────────────────────────────────────
  // Send helper (used by send button + BT remote)
  // ─────────────────────────────────────────────────

  const handleSend = useCallback(() => {
    const text = inputText.trim();
    if (!text) return;
    sendToClaud(text);
    setInputText('');
    accumulatedText.current = '';
  }, [inputText]);

  // ─────────────────────────────────────────────────
  // BT Remote
  // ─────────────────────────────────────────────────

  const toggleRemote = useCallback(async () => {
    const next = !remoteEnabled;
    setRemoteEnabled(next);
    remoteEnabledRef.current = next;
    RemoteButton.setEnabled(next);
    RemoteButton.setKeepScreenOn(next);
    await AsyncStorage.setItem(STORAGE_KEYS.REMOTE_ENABLED, next ? 'true' : 'false');
  }, [remoteEnabled]);

  // Listen for BT remote button presses (only KEYCODE_MEDIA_NEXT = 87)
  useEffect(() => {
    const sub = remoteButtonEmitter.addListener('remoteButton', (keyCode: number) => {
      if (!remoteEnabledRef.current) return;
      if (keyCode !== 87) return; // Only skip forward

      if (shouldListen.current) {
        // Currently listening → stop + auto-send
        shouldListen.current = false;
        stoppingRef.current = true;

        if (partialRef.current.trim()) {
          const sep = accumulatedText.current ? ' ' : '';
          accumulatedText.current += sep + partialRef.current.trim();
        }

        Voice.cancel().catch(() => {});

        const finalText = accumulatedText.current.trim();
        partialRef.current = '';
        setPartialText('');
        setIsListening(false);
        stoppingRef.current = false;

        if (finalText) {
          setInputText('');
          accumulatedText.current = '';
          sendToClaud(finalText);
        }
      } else {
        toggleListening();
      }
    });

    return () => sub.remove();
  }, [toggleListening]);

  // ─────────────────────────────────────────────────
  // Init: load saved config
  // ─────────────────────────────────────────────────

  useEffect(() => {
    (async () => {
      try {
        const [url, setupDone, ttsStored, remoteStored] = await Promise.all([
          AsyncStorage.getItem(STORAGE_KEYS.SERVER_URL),
          AsyncStorage.getItem(STORAGE_KEYS.SETUP_COMPLETE),
          AsyncStorage.getItem(STORAGE_KEYS.TTS_ENABLED),
          AsyncStorage.getItem(STORAGE_KEYS.REMOTE_ENABLED),
        ]);

        if (url) setServerUrl(url);
        if (ttsStored === 'true') {
          setTtsEnabled(true);
          ttsEnabledRef.current = true;
        }
        if (remoteStored === 'true') {
          setRemoteEnabled(true);
          remoteEnabledRef.current = true;
          RemoteButton.setEnabled(true);
          RemoteButton.setKeepScreenOn(true);
        }

        if (setupDone === 'true' && url) {
          await initServices(url);
          setScreen('main');
        }
      } catch (e) {
        console.warn('Failed to load config:', e);
      }
      setLoading(false);
    })();

    return () => {
      bridgeRef.current?.destroy();
      ttsServiceRef.current?.destroy();
    };
  }, []);

  // ─────────────────────────────────────────────────
  // Initialize services
  // ─────────────────────────────────────────────────

  const initServices = async (url: string) => {
    const bridge = new BridgeService({ serverUrl: url });
    bridgeRef.current = bridge;

    const tts = new TTSService();
    ttsServiceRef.current = tts;

    bridge.onResponse((text: string) => {
      handleClaudeResponse(text);
    });

    bridge.onTTS((audioUrl: string) => {
      if (ttsEnabledRef.current) {
        tts.play(`${url}${audioUrl}`);
      }
    });

    bridge.sendTTSConfig(ttsEnabledRef.current);
    bridge.connect();
    setIsConnected(true);
  };

  // ─────────────────────────────────────────────────
  // Core actions
  // ─────────────────────────────────────────────────

  const sendToClaud = async (text: string) => {
    try {
      const entry: ConversationEntry = {
        role: 'user',
        text,
        timestamp: Date.now(),
      };
      setConversation((prev) => [...prev, entry]);

      const result = await bridgeRef.current?.sendMessage(text);
      if (!result?.ok) {
        Alert.alert('Send Failed', result?.error ?? 'Unknown error');
      }
    } catch (err: any) {
      Alert.alert('Send Error', String(err));
    }
  };

  const toggleTTS = useCallback(async () => {
    const next = !ttsEnabled;
    setTtsEnabled(next);
    ttsEnabledRef.current = next;
    bridgeRef.current?.sendTTSConfig(next);
    await AsyncStorage.setItem(STORAGE_KEYS.TTS_ENABLED, next ? 'true' : 'false');
    if (!next) {
      ttsServiceRef.current?.stop();
    }
  }, [ttsEnabled]);

  const handleClaudeResponse = (text: string) => {
    const entry: ConversationEntry = {
      role: 'claude',
      text,
      timestamp: Date.now(),
    };
    setConversation((prev) => [...prev, entry]);
  };

  // ─────────────────────────────────────────────────
  // Setup screen
  // ─────────────────────────────────────────────────

  const [connecting, setConnecting] = useState(false);

  const handleSetupComplete = async () => {
    setSetupError('');

    if (!serverUrl.trim()) {
      setSetupError('Server URL is required');
      return;
    }

    setConnecting(true);

    try {
      setSetupError('Checking server...');
      const bridge = new BridgeService({ serverUrl: serverUrl.trim() });
      const health = await bridge.checkHealth();
      bridge.destroy();

      if (!health.ok) {
        setSetupError(`Cannot reach server: ${health.error}`);
        setConnecting(false);
        return;
      }

      setSetupError('Saving config...');
      await AsyncStorage.setItem(STORAGE_KEYS.SERVER_URL, serverUrl.trim());
      await AsyncStorage.setItem(STORAGE_KEYS.SETUP_COMPLETE, 'true');

      setSetupError('Connecting...');
      await initServices(serverUrl.trim());

      setSetupError('');
      setScreen('main');
    } catch (e: any) {
      setSetupError(`Connection failed: ${String(e)}`);
    } finally {
      setConnecting(false);
    }
  };

  // ─────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────

  if (loading) {
    return (
      <View style={[styles.container, styles.center]}>
        <Text style={styles.loadingText}>Loading...</Text>
      </View>
    );
  }

  // ─── Setup Screen ───

  if (screen === 'setup') {
    return (
      <KeyboardAvoidingView style={styles.container} behavior="padding">
        <StatusBar barStyle="light-content" backgroundColor="#0a0a0a" />

        <ScrollView contentContainerStyle={styles.setupContent} keyboardShouldPersistTaps="handled">
          <Text style={styles.setupTitle}>Claude Voice Bridge</Text>
          <Text style={styles.setupSubtitle}>
            Connect directly to Claude Code via the voicebridge plugin
          </Text>

          <View style={styles.setupCard}>
            <Text style={styles.setupStep}>
              1. On your PC, run: claude --channels plugin:voicebridge
            </Text>
            <Text style={styles.setupStep}>
              2. Note the server address shown (default port 8787)
            </Text>
            <Text style={styles.setupStep}>
              3. If remote: connect both devices to Tailscale
            </Text>
            <Text style={styles.setupStep}>
              4. Enter the server URL below
            </Text>
          </View>

          <Text style={styles.inputLabel}>Server URL</Text>
          <TextInput
            style={styles.input}
            value={serverUrl}
            onChangeText={setServerUrl}
            placeholder="http://100.x.y.z:8787"
            placeholderTextColor="#555"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />

          <Text style={styles.chatIdHelp}>
            Use your PC's Tailscale IP for remote access,{'\n'}
            or LAN IP if on the same WiFi network.
          </Text>

          {setupError ? (
            <Text style={styles.errorText}>{setupError}</Text>
          ) : null}

          <TouchableOpacity
            style={[styles.setupButton, connecting && { opacity: 0.6 }]}
            onPress={handleSetupComplete}
            disabled={connecting}>
            <Text style={styles.setupButtonText}>
              {connecting ? 'Connecting...' : 'Connect'}
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  // ─── Main Screen ───

  return (
    <KeyboardAvoidingView style={styles.container} behavior="padding">
      <StatusBar barStyle="light-content" backgroundColor="#0a0a0a" />

      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View
            style={[
              styles.statusDot,
              { backgroundColor: isConnected ? '#4ade80' : '#ef4444' },
            ]}
          />
          <Text style={styles.headerText}>
            {isConnected ? 'Connected' : 'Disconnected'}
          </Text>
        </View>
        <View style={styles.headerRight}>
          <TouchableOpacity onPress={toggleRemote}>
            <Text style={[styles.headerSettings, remoteEnabled && { color: '#3b82f6' }]}>
              {remoteEnabled ? '\u{1F399}' : '\u{1F3AE}'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={toggleTTS}>
            <Text style={[styles.headerSettings, ttsEnabled && { color: '#d97706' }]}>
              {ttsEnabled ? '\uD83D\uDD0A' : '\uD83D\uDD07'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => {
              setScreen('setup');
              setIsConnected(false);
              bridgeRef.current?.destroy();
              ttsServiceRef.current?.destroy();
              if (remoteEnabledRef.current) {
                RemoteButton.setEnabled(false);
                RemoteButton.setKeepScreenOn(false);
              }
            }}>
            <Text style={styles.headerSettings}>⚙</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Conversation log */}
      <ScrollView
        ref={scrollRef}
        style={styles.conversationContainer}
        contentContainerStyle={styles.conversationContent}
        onContentSizeChange={() => scrollRef.current?.scrollToEnd()}>
        {conversation.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>
              Tap the mic or type to talk to Claude
            </Text>
          </View>
        ) : (
          conversation.map((entry, i) => (
            <View
              key={i}
              style={[
                styles.messageContainer,
                entry.role === 'user'
                  ? styles.userMessage
                  : styles.claudeMessage,
              ]}>
              <Text style={styles.messageRole}>
                {entry.role === 'user' ? 'You' : 'Claude'}
              </Text>
              <Text style={styles.messageText}>{entry.text}</Text>
            </View>
          ))
        )}
      </ScrollView>

      {/* Voice partial transcript */}
      {isListening && partialText ? (
        <View style={styles.partialBar}>
          <Text style={styles.partialText} numberOfLines={3}>
            {accumulatedText.current ? accumulatedText.current + ' ' + partialText : partialText}
          </Text>
        </View>
      ) : null}

      {/* Message input */}
      <View style={[styles.inputBar, { paddingBottom: Math.max(insets.bottom, 10) }]}>
        <TouchableOpacity
          style={[
            styles.micButton,
            isListening && styles.micButtonActive,
          ]}
          onPress={toggleListening}
          activeOpacity={0.7}>
          <Text style={styles.micButtonText}>{isListening ? '⏹' : '🎤'}</Text>
        </TouchableOpacity>

        <TextInput
          style={styles.messageInput}
          value={inputText}
          onChangeText={setInputText}
          placeholder={isListening ? 'Listening...' : 'Type or tap mic...'}
          placeholderTextColor="#555"
          multiline
          maxHeight={120}
          blurOnSubmit
          returnKeyType="send"
          onSubmitEditing={handleSend}
        />
        <TouchableOpacity
          style={[styles.sendButton, !inputText.trim() && { opacity: 0.4 }]}
          disabled={!inputText.trim()}
          onPress={handleSend}>
          <Text style={styles.sendButtonText}>Send</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
};

// ─────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },
  center: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    color: '#888',
    fontSize: 16,
  },

  // ─── Setup ───
  setupContent: {
    flex: 1,
    padding: 24,
    justifyContent: 'center',
  },
  setupTitle: {
    fontSize: 28,
    fontWeight: '700',
    color: '#fff',
    textAlign: 'center',
    marginBottom: 8,
  },
  setupSubtitle: {
    fontSize: 14,
    color: '#888',
    textAlign: 'center',
    marginBottom: 32,
  },
  setupCard: {
    backgroundColor: '#161616',
    borderRadius: 12,
    padding: 16,
    marginBottom: 28,
    borderWidth: 1,
    borderColor: '#222',
  },
  setupStep: {
    color: '#aaa',
    fontSize: 13,
    lineHeight: 22,
    marginBottom: 4,
  },
  inputLabel: {
    color: '#ccc',
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 6,
    marginLeft: 2,
  },
  input: {
    backgroundColor: '#161616',
    borderRadius: 10,
    padding: 14,
    color: '#fff',
    fontSize: 15,
    borderWidth: 1,
    borderColor: '#333',
    marginBottom: 16,
    fontFamily: 'monospace',
  },
  chatIdHelp: {
    color: '#666',
    fontSize: 11,
    lineHeight: 16,
    marginBottom: 20,
    fontFamily: 'monospace',
  },
  errorText: {
    color: '#ef4444',
    fontSize: 13,
    marginBottom: 12,
    textAlign: 'center',
  },
  setupButton: {
    backgroundColor: '#d97706',
    borderRadius: 10,
    padding: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  setupButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },

  // ─── Header ───
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 48,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  headerText: {
    color: '#888',
    fontSize: 13,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  headerSettings: {
    color: '#888',
    fontSize: 22,
  },

  // ─── Conversation ───
  conversationContainer: {
    flex: 1,
  },
  conversationContent: {
    padding: 16,
    paddingBottom: 8,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 80,
  },
  emptyText: {
    color: '#555',
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
  },
  messageContainer: {
    marginBottom: 12,
    borderRadius: 12,
    padding: 12,
    maxWidth: '88%',
  },
  userMessage: {
    alignSelf: 'flex-end',
    backgroundColor: '#1a3a2a',
    borderBottomRightRadius: 4,
  },
  claudeMessage: {
    alignSelf: 'flex-start',
    backgroundColor: '#1a1a2a',
    borderBottomLeftRadius: 4,
  },
  messageRole: {
    color: '#888',
    fontSize: 11,
    fontWeight: '600',
    marginBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  messageText: {
    color: '#e0e0e0',
    fontSize: 14,
    lineHeight: 20,
  },

  // ─── Voice Partial Transcript ───
  partialBar: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    backgroundColor: '#111',
    borderTopWidth: 1,
    borderTopColor: '#1a1a1a',
  },
  partialText: {
    color: '#888',
    fontSize: 13,
    fontStyle: 'italic',
  },

  // ─── Message Input Bar ───
  inputBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: '#1a1a1a',
    backgroundColor: '#0a0a0a',
  },
  micButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#222',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
    borderWidth: 1,
    borderColor: '#333',
  },
  micButtonActive: {
    backgroundColor: '#7f1d1d',
    borderColor: '#ef4444',
  },
  micButtonText: {
    fontSize: 18,
  },
  messageInput: {
    flex: 1,
    backgroundColor: '#161616',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    color: '#fff',
    fontSize: 15,
    borderWidth: 1,
    borderColor: '#333',
    marginRight: 8,
  },
  sendButton: {
    backgroundColor: '#d97706',
    borderRadius: 20,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  sendButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
});

const App: React.FC = () => (
  <SafeAreaProvider>
    <AppContent />
  </SafeAreaProvider>
);

export default App;
