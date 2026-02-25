/**
 * VISP - Chat Bubble Component
 *
 * Individual message bubble for the chat interface. Displays the
 * message text, sender name, timestamp, and visually differentiates
 * sent (right/blue) vs received (left/gray) messages.
 */

import React from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { Colors } from '../theme/colors';
import type { ChatMessage } from '../types';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ChatBubbleProps {
  message: ChatMessage;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTimestamp(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ChatBubble({
  message,
}: ChatBubbleProps): React.JSX.Element {
  const isOwn = message.isOwnMessage;

  return (
    <View
      style={[
        styles.container,
        isOwn ? styles.containerOwn : styles.containerOther,
      ]}
    >
      {!isOwn && (
        <Text style={styles.senderName}>{message.senderName}</Text>
      )}
      <View
        style={[styles.bubble, isOwn ? styles.bubbleOwn : styles.bubbleOther]}
      >
        <Text
          style={[
            styles.messageText,
            isOwn ? styles.messageTextOwn : styles.messageTextOther,
          ]}
        >
          {message.message}
        </Text>
      </View>
      <Text
        style={[
          styles.timestamp,
          isOwn ? styles.timestampOwn : styles.timestampOther,
        ]}
      >
        {formatTimestamp(message.createdAt)}
      </Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    marginVertical: 4,
    marginHorizontal: 16,
    maxWidth: '80%',
  },
  containerOwn: {
    alignSelf: 'flex-end',
  },
  containerOther: {
    alignSelf: 'flex-start',
  },
  senderName: {
    fontSize: 11,
    fontWeight: '600',
    color: 'rgba(255, 255, 255, 0.55)',
    marginBottom: 2,
    marginLeft: 12,
  },
  bubble: {
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
  },
  bubbleOwn: {
    backgroundColor: 'rgba(74, 144, 226, 0.35)',
    borderColor: 'rgba(74, 144, 226, 0.45)',
    borderBottomRightRadius: 4,
    ...Platform.select({
      ios: {
        shadowColor: 'rgba(74, 144, 226, 0.3)',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 1,
        shadowRadius: 12,
      },
      android: { elevation: 4 },
    }),
  },
  bubbleOther: {
    backgroundColor: 'rgba(255, 255, 255, 0.10)',
    borderColor: 'rgba(255, 255, 255, 0.15)',
    borderBottomLeftRadius: 4,
  },
  messageText: {
    fontSize: 15,
    lineHeight: 20,
  },
  messageTextOwn: {
    color: '#FFFFFF',
  },
  messageTextOther: {
    color: '#FFFFFF',
  },
  timestamp: {
    fontSize: 10,
    color: 'rgba(255, 255, 255, 0.4)',
    marginTop: 4,
  },
  timestampOwn: {
    textAlign: 'right',
    marginRight: 4,
  },
  timestampOther: {
    textAlign: 'left',
    marginLeft: 12,
  },
});
