/**
 * VISP/Tasker - Chat Screen
 *
 * Full chat interface shared between customer and provider flows.
 * Displays message history with sent/received bubbles, text input,
 * typing indicator, and auto-scroll to newest message. Falls back
 * to local state when the API is not available in development.
 *
 * Navigation params: { jobId: string, otherUserName: string }
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { RouteProp, useRoute } from '@react-navigation/native';
import { Colors } from '../../theme/colors';
import { useAuthStore } from '../../stores/authStore';
import { get, post } from '../../services/apiClient';
import ChatBubble from '../../components/ChatBubble';
import ChatInput from '../../components/ChatInput';
import type { ChatMessage, RootStackParamList } from '../../types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ChatRoute = RouteProp<RootStackParamList, 'Chat'>;

// ---------------------------------------------------------------------------
// Mock data for __DEV__ fallback
// ---------------------------------------------------------------------------

function createMockMessages(
  jobId: string,
  currentUserId: string,
  otherUserName: string,
): ChatMessage[] {
  const now = Date.now();
  return [
    {
      id: 'msg-001',
      jobId,
      senderId: 'other-user-001',
      senderName: otherUserName,
      message: `Hi, I am heading to your location for the service.`,
      createdAt: new Date(now - 30 * 60 * 1000).toISOString(),
      isOwnMessage: false,
    },
    {
      id: 'msg-002',
      jobId,
      senderId: currentUserId,
      senderName: 'You',
      message: 'Great, I will be home. The door code is 1234.',
      createdAt: new Date(now - 28 * 60 * 1000).toISOString(),
      isOwnMessage: true,
    },
    {
      id: 'msg-003',
      jobId,
      senderId: 'other-user-001',
      senderName: otherUserName,
      message: 'Got it, thanks! I should arrive in about 15 minutes.',
      createdAt: new Date(now - 25 * 60 * 1000).toISOString(),
      isOwnMessage: false,
    },
  ];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ChatScreen(): React.JSX.Element {
  const route = useRoute<ChatRoute>();
  const { jobId, otherUserName } = route.params;
  const user = useAuthStore((state) => state.user);
  const currentUserId = user?.id ?? 'unknown';

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [isTyping, setIsTyping] = useState(false);

  const flatListRef = useRef<FlatList<ChatMessage>>(null);

  // ---- Fetch message history ----

  const fetchMessages = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await get<ChatMessage[]>(`/jobs/${jobId}/messages`);
      setMessages(data);
    } catch {
      if (__DEV__) {
        console.warn('DEV: Using mock data for chat messages');
        setMessages(createMockMessages(jobId, currentUserId, otherUserName));
      }
    } finally {
      setIsLoading(false);
    }
  }, [jobId, currentUserId, otherUserName]);

  useEffect(() => {
    fetchMessages();
  }, [fetchMessages]);

  // ---- Send message ----

  const handleSend = useCallback(
    async (text: string) => {
      const optimisticMessage: ChatMessage = {
        id: `msg-local-${Date.now()}`,
        jobId,
        senderId: currentUserId,
        senderName: 'You',
        message: text,
        createdAt: new Date().toISOString(),
        isOwnMessage: true,
      };

      // Optimistically add the message to the list
      setMessages((prev) => [...prev, optimisticMessage]);
      setIsSending(true);

      try {
        const sent = await post<ChatMessage>(`/jobs/${jobId}/messages`, {
          message: text,
        });
        // Replace the optimistic message with the server response
        setMessages((prev) =>
          prev.map((m) => (m.id === optimisticMessage.id ? sent : m)),
        );
      } catch {
        if (__DEV__) {
          console.warn('DEV: Message stored locally (API not available)');
          // Simulate typing indicator from the other user
          setIsTyping(true);
          setTimeout(() => {
            setIsTyping(false);
          }, 2000);
        }
        // Keep the optimistic message in the list regardless
      } finally {
        setIsSending(false);
      }
    },
    [jobId, currentUserId],
  );

  // ---- Auto-scroll to bottom when new messages arrive ----

  const scrollToBottom = useCallback(() => {
    if (flatListRef.current && messages.length > 0) {
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 100);
    }
  }, [messages.length]);

  useEffect(() => {
    scrollToBottom();
  }, [messages.length, scrollToBottom]);

  // ---- Render helpers ----

  const renderMessage = useCallback(
    ({ item }: { item: ChatMessage }) => <ChatBubble message={item} />,
    [],
  );

  const keyExtractor = useCallback((item: ChatMessage) => item.id, []);

  const renderEmpty = useCallback(() => {
    if (isLoading) return null;
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyTitle}>No Messages Yet</Text>
        <Text style={styles.emptySubtext}>
          Start a conversation about your job
        </Text>
      </View>
    );
  }, [isLoading]);

  const renderTypingIndicator = useCallback(() => {
    if (!isTyping) return null;
    return (
      <View style={styles.typingContainer}>
        <View style={styles.typingBubble}>
          <Text style={styles.typingText}>{otherUserName} is typing...</Text>
        </View>
      </View>
    );
  }, [isTyping, otherUserName]);

  // ---- Main render ----

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
      <FlatList
        ref={flatListRef}
        data={messages}
        renderItem={renderMessage}
        keyExtractor={keyExtractor}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={renderEmpty}
        ListFooterComponent={renderTypingIndicator}
        showsVerticalScrollIndicator={false}
        onContentSizeChange={scrollToBottom}
      />
      <ChatInput onSend={handleSend} isSending={isSending} />
    </KeyboardAvoidingView>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  listContent: {
    paddingVertical: 16,
    flexGrow: 1,
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
    paddingTop: 80,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: Colors.textPrimary,
    marginBottom: 8,
  },
  emptySubtext: {
    fontSize: 14,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },
  typingContainer: {
    marginHorizontal: 16,
    marginTop: 4,
    marginBottom: 8,
    alignSelf: 'flex-start',
  },
  typingBubble: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  typingText: {
    fontSize: 13,
    color: Colors.textSecondary,
    fontStyle: 'italic',
  },
});
