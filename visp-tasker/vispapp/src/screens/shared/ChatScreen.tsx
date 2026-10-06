/**
 * VISP - Chat Screen
 *
 * Full chat interface shared between customer and provider flows.
 * Displays message history with sent/received bubbles, text input,
 * and auto-scroll to newest message.
 *
 * Navigation params: { jobId: string, otherUserName: string }
 *
 * Denunciar y bloquear (Apple 1.2, `docs/plan-denunciar-bloquear.md`):
 *   - "⋯" en la cabecera → Denunciar a la persona / Bloquearla.
 *   - Mantener pulsado un mensaje ajeno → Denunciar ese mensaje (deja de verse).
 *   - Con el trabajo ASIGNADO, "Bloquear" abre el botón de pánico con
 *     "bloquear también" marcado: bloquear sin cancelar dejaría el trabajo a medias.
 *   - Con un bloqueo, el campo de escribir se sustituye por un aviso.
 *
 * El historial se refresca cada pocos segundos mientras la pantalla está a la
 * vista: la app no escucha el socket del chat, y sin esto los mensajes de la
 * otra persona solo aparecían al volver a entrar.
 */

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ActionSheetIOS,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { RouteProp, useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { useTheme } from '../../theme/ThemeContext';
import { useAuthStore } from '../../stores/authStore';
import { useTranslation } from '../../i18n';
import { get, post } from '../../services/apiClient';
import { activeJobFromError, blockUser, type ReportTarget } from '../../services/moderationService';
import { Icon, Screen } from '../../components/visp';
import ChatBubble from '../../components/ChatBubble';
import ChatInput from '../../components/ChatInput';
import ReportSheet from '../../components/ReportSheet';
import CancelWithReasonModal from '../../components/CancelWithReasonModal';
import type { ApiError, ChatMessage, RootStackParamList } from '../../types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ChatRoute = RouteProp<RootStackParamList, 'Chat'>;

/** Lo que devuelve `GET /jobs/{id}/messages` (ya sin el envoltorio `data`). */
interface ChatHistory {
  items: Omit<ChatMessage, 'isOwnMessage'>[];
  blocked: boolean;
  assigned: boolean;
  role: 'customer' | 'provider';
}

const POLL_MS = 6000;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ChatScreen(): React.JSX.Element {
  const theme = useTheme();
  const { t } = useTranslation();
  const navigation = useNavigation();
  const route = useRoute<ChatRoute>();
  const { jobId, otherUserName } = route.params;
  const user = useAuthStore((state) => state.user);
  const currentUserId = user?.id ?? 'unknown';

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [assigned, setAssigned] = useState(false);
  const [role, setRole] = useState<'customer' | 'provider'>('customer');

  const [reportTarget, setReportTarget] = useState<ReportTarget | null>(null);
  const [panicOpen, setPanicOpen] = useState(false);

  const flatListRef = useRef<FlatList<ChatMessage>>(null);

  // ---- Fetch message history ----

  const fetchMessages = useCallback(
    async (silent = false) => {
      if (!silent) setIsLoading(true);
      try {
        const data = await get<ChatHistory>(`/jobs/${jobId}/messages`, { pageSize: 100 });
        const items = (data?.items ?? []).map((m) => ({
          ...m,
          isOwnMessage: m.senderId === currentUserId,
        }));
        // Los enviados que aún no tienen respuesta del servidor se conservan.
        setMessages((prev) => [...items, ...prev.filter((m) => m.id.startsWith('msg-local-'))]);
        setBlocked(!!data?.blocked);
        setAssigned(!!data?.assigned);
        if (data?.role) setRole(data.role);
      } catch {
        console.error('[ChatScreen] Failed to fetch messages');
      } finally {
        if (!silent) setIsLoading(false);
      }
    },
    [jobId, currentUserId],
  );

  useEffect(() => {
    fetchMessages();
  }, [fetchMessages]);

  useFocusEffect(
    useCallback(() => {
      const id = setInterval(() => fetchMessages(true), POLL_MS);
      return () => clearInterval(id);
    }, [fetchMessages]),
  );

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

      setMessages((prev) => [...prev, optimisticMessage]);
      setIsSending(true);

      try {
        const sent = await post<Omit<ChatMessage, 'isOwnMessage'>>(`/jobs/${jobId}/messages`, {
          message: text,
        });
        setMessages((prev) =>
          prev.map((m) => (m.id === optimisticMessage.id ? { ...sent, isOwnMessage: true } : m)),
        );
      } catch (err) {
        // Un mensaje que no se guardó no puede quedarse en pantalla como si
        // se hubiera enviado.
        setMessages((prev) => prev.filter((m) => m.id !== optimisticMessage.id));
        if ((err as ApiError)?.code === 'user_blocked') {
          setBlocked(true);
        } else {
          Alert.alert(t('moderation.sendFailed'));
        }
      } finally {
        setIsSending(false);
      }
    },
    [jobId, currentUserId, t],
  );

  // ---- Report / block ----

  const openPanicForBlock = useCallback(() => {
    Alert.alert(t('moderation.activeJobTitle'), t('moderation.activeJobBody'), [
      { text: t('moderation.cancel'), style: 'cancel' },
      { text: t('moderation.activeJobAction'), style: 'destructive', onPress: () => setPanicOpen(true) },
    ]);
  }, [t]);

  const confirmBlock = useCallback(() => {
    if (assigned) {
      openPanicForBlock();
      return;
    }
    Alert.alert(
      t('moderation.blockConfirmTitle', { name: otherUserName }),
      t('moderation.blockConfirmBody'),
      [
        { text: t('moderation.cancel'), style: 'cancel' },
        {
          text: t('moderation.blockConfirm'),
          style: 'destructive',
          onPress: async () => {
            try {
              await blockUser(jobId);
              setBlocked(true);
              Alert.alert(t('moderation.blockedTitle'), t('moderation.blockedBody', { name: otherUserName }));
            } catch (err) {
              if (activeJobFromError(err)) {
                openPanicForBlock();
              } else {
                Alert.alert(t('moderation.blockFailed'));
              }
            }
          },
        },
      ],
    );
  }, [assigned, jobId, openPanicForBlock, otherUserName, t]);

  const openMenu = useCallback(() => {
    const options = [
      t('moderation.cancel'),
      t('moderation.reportUser', { name: otherUserName }),
      ...(blocked ? [] : [t('moderation.blockUser', { name: otherUserName })]),
    ];
    const onPick = (i: number) => {
      if (i === 1) setReportTarget({ jobId, contentType: 'USER' });
      if (i === 2) confirmBlock();
    };
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { options, cancelButtonIndex: 0, destructiveButtonIndex: blocked ? undefined : 2 },
        onPick,
      );
    } else {
      Alert.alert(t('moderation.options'), undefined, [
        { text: options[0], style: 'cancel' },
        ...options.slice(1).map((label, k) => ({ text: label, onPress: () => onPick(k + 1) })),
      ]);
    }
  }, [blocked, confirmBlock, jobId, otherUserName, t]);

  const onMessageLongPress = useCallback(
    (msg: ChatMessage) => {
      if (msg.id.startsWith('msg-local-')) return;
      const report = () => setReportTarget({ jobId, contentType: 'CHAT_MESSAGE', contentId: msg.id });
      if (Platform.OS === 'ios') {
        ActionSheetIOS.showActionSheetWithOptions(
          { options: [t('moderation.cancel'), t('moderation.reportMessage')], cancelButtonIndex: 0 },
          (i) => i === 1 && report(),
        );
      } else {
        Alert.alert(t('moderation.options'), undefined, [
          { text: t('moderation.cancel'), style: 'cancel' },
          { text: t('moderation.reportMessage'), onPress: report },
        ]);
      }
    },
    [jobId, t],
  );

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Pressable
          onPress={openMenu}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel={t('moderation.options')}
          style={styles.headerButton}
        >
          <Icon name="dots" size={22} color={theme.textPrimary} />
        </Pressable>
      ),
    });
  }, [navigation, openMenu, t, theme.textPrimary]);

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
    ({ item }: { item: ChatMessage }) => <ChatBubble message={item} onLongPress={onMessageLongPress} />,
    [onMessageLongPress],
  );

  const keyExtractor = useCallback((item: ChatMessage) => item.id, []);

  const renderEmpty = useCallback(() => {
    if (isLoading) return null;
    return (
      <View style={styles.emptyContainer}>
        <Text style={[styles.emptyTitle, { color: theme.textPrimary }]}>No Messages Yet</Text>
        <Text style={[styles.emptySubtext, { color: theme.textSecondary }]}>
          Start a conversation about your job
        </Text>
      </View>
    );
  }, [isLoading, theme.textPrimary, theme.textSecondary]);

  // ---- Main render ----

  const reportedMessageId = reportTarget?.contentType === 'CHAT_MESSAGE' ? reportTarget.contentId : undefined;

  return (
    <Screen>
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
          showsVerticalScrollIndicator={false}
          onContentSizeChange={scrollToBottom}
        />
        {blocked ? (
          <View style={[styles.blockedBar, { borderTopColor: theme.border ?? 'rgba(255,255,255,0.12)' }]}>
            <Text style={[styles.blockedText, { color: theme.textSecondary }]}>
              {t('moderation.chatBlocked')}
            </Text>
          </View>
        ) : (
          <ChatInput onSend={handleSend} isSending={isSending} />
        )}
      </KeyboardAvoidingView>

      <ReportSheet
        visible={!!reportTarget}
        target={reportTarget}
        otherName={otherUserName}
        allowBlock={!blocked && !assigned}
        onClose={() => setReportTarget(null)}
        onDone={(didBlock) => {
          // Lo denunciado deja de verse al momento; el servidor ya lo oculta.
          if (reportedMessageId) {
            setMessages((prev) => prev.filter((m) => m.id !== reportedMessageId));
          }
          if (didBlock) setBlocked(true);
        }}
        onJobActive={() => openPanicForBlock()}
      />

      <CancelWithReasonModal
        visible={panicOpen}
        jobId={jobId}
        role={role}
        defaultBlock
        onClose={() => setPanicOpen(false)}
        onCancelled={() => navigation.goBack()}
      />
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  listContent: {
    paddingVertical: 16,
    flexGrow: 1,
  },
  headerButton: {
    paddingHorizontal: 4,
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
    color: '#FFFFFF',
    marginBottom: 8,
  },
  emptySubtext: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.55)',
    textAlign: 'center',
    lineHeight: 20,
  },
  blockedBar: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 20,
    paddingVertical: 18,
    alignItems: 'center',
  },
  blockedText: {
    fontSize: 14,
    textAlign: 'center',
  },
});
