/**
 * Claude Voice Bridge
 *
 * A hands-free voice interface for Claude Code via Telegram channels.
 * Press a button (on-screen or BT remote) → speak → Claude hears you.
 * Claude responds → TTS plays through your headphones.
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
  Animated,
  Vibration,
  Alert,
  Linking,
  AppState,
  PermissionsAndroid,
  Platform,
  KeyboardAvoidingView,
} from 'react-native';
// Voice and TTS disabled — native modules crash on RN 0.84
// import Voice from '@react-native-voice/voice';
// import Tts from 'react-native-tts';
import AsyncStorage from '@react-native-async-storage/async-storage';
// import { VolumeManager } from 'react-native-volume-manager';
import { TelegramService, TelegramConfig } from './src/services/telegram';

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
  BOT_TOKEN: '@cvb_bot_token',
  CHAT_ID: '@cvb_chat_id',
  TTS_RATE: '@cvb_tts_rate',
  SETUP_COMPLETE: '@cvb_setup_complete',
};

// ─────────────────────────────────────────────────────
// App
// ─────────────────────────────────────────────────────

const App: React.FC = () => {
  // Navigation
  const [screen, setScreen] = useState<Screen>('setup');
  const [loading, setLoading] = useState(true);

  // Setup form
  const [botToken, setBotToken] = useState('');
  const [chatId, setChatId] = useState('');
  const [setupError, setSetupError] = useState('');
  const [botName, setBotName] = useState('');

  // Main screen state
  const [isListening, setIsListening] = useState(false);
  const [partialText, setPartialText] = useState('');
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [conversation, setConversation] = useState<ConversationEntry[]>([]);
  const [ttsRate, setTtsRate] = useState(1.2);

  // Text input
  const [inputText, setInputText] = useState('');

  // Refs
  const telegramRef = useRef<TelegramService | null>(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const scrollRef = useRef<ScrollView>(null);

  // ─────────────────────────────────────────────────
  // Init: load saved config
  // ─────────────────────────────────────────────────

  useEffect(() => {
    (async () => {
      try {
        const [token, cid, rate, setupDone] = await Promise.all([
          AsyncStorage.getItem(STORAGE_KEYS.BOT_TOKEN),
          AsyncStorage.getItem(STORAGE_KEYS.CHAT_ID),
          AsyncStorage.getItem(STORAGE_KEYS.TTS_RATE),
          AsyncStorage.getItem(STORAGE_KEYS.SETUP_COMPLETE),
        ]);

        if (token) setBotToken(token);
        if (cid) setChatId(cid);
        if (rate) setTtsRate(parseFloat(rate));

        if (setupDone === 'true' && token && cid) {
          await initServices(token, cid);
          setScreen('main');
        }
      } catch (e) {
        console.warn('Failed to load config:', e);
      }
      setLoading(false);
    })();

    return () => {
      telegramRef.current?.destroy();
    };
  }, []);

  // ─────────────────────────────────────────────────
  // Initialize services
  // ─────────────────────────────────────────────────

  const initServices = async (token: string, cid: string) => {
    // --- Telegram ---
    const telegram = new TelegramService({ botToken: token, chatId: cid });
    telegramRef.current = telegram;

    telegram.onResponse((text: string) => {
      handleClaudeResponse(text);
    });

    telegram.startPolling();
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

      const result = await telegramRef.current?.sendMessage(text);
      if (!result?.ok) {
        Alert.alert('Send Failed', result?.error ?? 'Unknown error');
      }
    } catch (err: any) {
      Alert.alert('Send Error', String(err));
    }
  };

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

    if (!botToken.trim() || !chatId.trim()) {
      setSetupError('Both fields are required');
      return;
    }

    setConnecting(true);

    try {
      setSetupError('Step 1: Creating service...');
      const telegram = new TelegramService({
        botToken: botToken.trim(),
        chatId: chatId.trim(),
      });

      setSetupError('Step 2: Verifying token...');
      const verify = await telegram.verifyToken();
      if (!verify.ok) {
        setSetupError(`Invalid bot token: ${verify.error}`);
        setConnecting(false);
        return;
      }

      setBotName(verify.botName ?? '');

      setSetupError('Step 3: Saving config...');
      await AsyncStorage.setItem(STORAGE_KEYS.BOT_TOKEN, botToken.trim());
      await AsyncStorage.setItem(STORAGE_KEYS.CHAT_ID, chatId.trim());
      await AsyncStorage.setItem(STORAGE_KEYS.SETUP_COMPLETE, 'true');

      setSetupError('Step 4: Init services...');
      await initServices(botToken.trim(), chatId.trim());

      setSetupError('');
      setScreen('main');
    } catch (e: any) {
      setSetupError(`Failed at ${setupError} - ${String(e)}`);
    } finally {
      setConnecting(false);
    }
  };

  // ─────────────────────────────────────────────────
  // Handle notification-based responses
  // ─────────────────────────────────────────────────

  // This is a placeholder for NotificationListenerService integration.
  // In the full native build, we'd register a service that intercepts
  // Telegram notifications and forwards them here. For now, polling
  // (via telegram.startPolling) handles response detection.
  //
  // To add notification listening, you'd create a native module:
  //   android/app/src/main/java/.../NotificationListener.java
  // that extends NotificationListenerService, filters for Telegram
  // notifications from the bot, and emits events to React Native.
  //
  // The Tasker approach (see tasker/README.md) handles this natively
  // and is recommended for initial testing.

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
            Connect to your Claude Code session via Telegram
          </Text>

          <View style={styles.setupCard}>
            <Text style={styles.setupStep}>
              1. Create a Telegram bot via @BotFather
            </Text>
            <Text style={styles.setupStep}>
              2. Run: claude --channels plugin:telegram@claude-plugins-official
            </Text>
            <Text style={styles.setupStep}>
              3. Pair with the bot in Telegram
            </Text>
            <Text style={styles.setupStep}>
              4. Enter your bot details below
            </Text>
          </View>

          <Text style={styles.inputLabel}>Bot Token</Text>
          <TextInput
            style={styles.input}
            value={botToken}
            onChangeText={setBotToken}
            placeholder="123456:ABC-DEF..."
            placeholderTextColor="#555"
            autoCapitalize="none"
            autoCorrect={false}
          />

          <Text style={styles.inputLabel}>Chat ID</Text>
          <TextInput
            style={styles.input}
            value={chatId}
            onChangeText={setChatId}
            placeholder="123456789"
            placeholderTextColor="#555"
            keyboardType="numeric"
          />

          <Text style={styles.chatIdHelp}>
            Send any message to your bot, then visit:{'\n'}
            https://api.telegram.org/bot{'<TOKEN>'}/getUpdates{'\n'}
            Look for "chat":{'{'}id":... {'}'} in the response.
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
        <TouchableOpacity
          onPress={() => {
            setScreen('setup');
            setIsConnected(false);
            telegramRef.current?.destroy();
          }}>
          <Text style={styles.headerSettings}>⚙</Text>
        </TouchableOpacity>
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
              Type a message below to talk to Claude
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

      {/* Message input */}
      <View style={styles.inputBar}>
        <TextInput
          style={styles.messageInput}
          value={inputText}
          onChangeText={setInputText}
          placeholder="Type a message..."
          placeholderTextColor="#555"
          returnKeyType="send"
          onSubmitEditing={() => {
            if (inputText.trim()) {
              sendToClaud(inputText.trim());
              setInputText('');
            }
          }}
        />
        <TouchableOpacity
          style={[styles.sendButton, !inputText.trim() && { opacity: 0.4 }]}
          disabled={!inputText.trim()}
          onPress={() => {
            if (inputText.trim()) {
              sendToClaud(inputText.trim());
              setInputText('');
            }
          }}>
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

  // ─── Partial transcription ───
  partialContainer: {
    paddingHorizontal: 20,
    paddingVertical: 8,
    backgroundColor: '#111',
  },
  partialText: {
    color: '#d97706',
    fontSize: 14,
    fontStyle: 'italic',
  },

  // ─── Speaking indicator ───
  speakingIndicator: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 8,
    backgroundColor: '#0d1117',
  },
  speakingText: {
    color: '#4ade80',
    fontSize: 13,
  },
  stopSpeaking: {
    color: '#ef4444',
    fontSize: 13,
    fontWeight: '600',
  },

  // ─── Message Input Bar ───
  inputBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    paddingBottom: 40,
    borderTopWidth: 1,
    borderTopColor: '#1a1a1a',
    backgroundColor: '#0a0a0a',
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

export default App;
