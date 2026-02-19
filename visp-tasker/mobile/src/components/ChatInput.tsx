/**
 * VISP - Chat Input Component
 *
 * Text input with send button for the chat interface. Handles text
 * entry, send action, and disables the send button when the input
 * is empty or a message is being sent.
 */

import React, { useCallback, useState } from 'react';
import {
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Colors } from '../theme/colors';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ChatInputProps {
  onSend: (message: string) => void;
  isSending?: boolean;
  placeholder?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ChatInput({
  onSend,
  isSending = false,
  placeholder = 'Type a message...',
}: ChatInputProps): React.JSX.Element {
  const [text, setText] = useState('');

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (trimmed.length === 0 || isSending) return;

    onSend(trimmed);
    setText('');
  }, [text, isSending, onSend]);

  const canSend = text.trim().length > 0 && !isSending;

  return (
    <View style={styles.container}>
      <View style={styles.inputWrapper}>
        <TextInput
          style={styles.input}
          value={text}
          onChangeText={setText}
          placeholder={placeholder}
          placeholderTextColor="rgba(255, 255, 255, 0.35)"
          multiline
          maxLength={1000}
          returnKeyType="default"
          blurOnSubmit={false}
          editable={!isSending}
          accessibilityLabel="Message input"
          accessibilityHint="Type your message here"
        />
      </View>
      <TouchableOpacity
        style={[styles.sendButton, canSend && styles.sendButtonActive]}
        onPress={handleSend}
        disabled={!canSend}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel="Send message"
        accessibilityState={{ disabled: !canSend }}
      >
        <Text
          style={[
            styles.sendButtonText,
            canSend && styles.sendButtonTextActive,
          ]}
        >
          Send
        </Text>
      </TouchableOpacity>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 12,
    paddingVertical: 8,
    paddingBottom: Platform.OS === 'ios' ? 24 : 8,
    backgroundColor: 'rgba(10, 10, 30, 0.80)',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.08)',
  },
  inputWrapper: {
    flex: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.07)',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    paddingHorizontal: 16,
    paddingVertical: Platform.OS === 'ios' ? 10 : 6,
    maxHeight: 120,
    marginRight: 8,
  },
  input: {
    fontSize: 15,
    color: '#FFFFFF',
    lineHeight: 20,
    maxHeight: 100,
  },
  sendButton: {
    width: 56,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.10)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  sendButtonActive: {
    backgroundColor: 'rgba(120, 80, 255, 0.8)',
    borderColor: 'rgba(255, 255, 255, 0.30)',
    ...Platform.select({
      ios: {
        shadowColor: 'rgba(120, 80, 255, 0.6)',
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 1,
        shadowRadius: 12,
      },
      android: { elevation: 4 },
    }),
  },
  sendButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: 'rgba(255, 255, 255, 0.35)',
  },
  sendButtonTextActive: {
    color: '#FFFFFF',
  },
});
