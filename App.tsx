/**
 * Claude Voice Bridge
 *
 * A hands-free voice interface for Claude Code via the voicebridge
 * channel plugin. Phone connects directly over WebSocket — no Telegram.
 */

import React, { useState, useEffect, useRef } from 'react';
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
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { BridgeService } from './src/services/bridge';

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
};

// ─────────────────────────────────────────────────────
// App
// ─────────────────────────────────────────────────────

const App: React.FC = () => {
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

  // Refs
  const bridgeRef = useRef<BridgeService | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  // ─────────────────────────────────────────────────
  // Init: load saved config
  // ─────────────────────────────────────────────────

  useEffect(() => {
    (async () => {
      try {
        const [url, setupDone] = await Promise.all([
          AsyncStorage.getItem(STORAGE_KEYS.SERVER_URL),
          AsyncStorage.getItem(STORAGE_KEYS.SETUP_COMPLETE),
        ]);

        if (url) setServerUrl(url);

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
    };
  }, []);

  // ─────────────────────────────────────────────────
  // Initialize services
  // ─────────────────────────────────────────────────

  const initServices = async (url: string) => {
    const bridge = new BridgeService({ serverUrl: url });
    bridgeRef.current = bridge;

    bridge.onResponse((text: string) => {
      handleClaudeResponse(text);
    });

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
        <TouchableOpacity
          onPress={() => {
            setScreen('setup');
            setIsConnected(false);
            bridgeRef.current?.destroy();
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
