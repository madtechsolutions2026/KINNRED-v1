import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { AppText } from '@/components/AppText';
import { Avatar } from '@/components/Avatar';
import { Button } from '@/components/Button';
import { BackButton } from '@/components/BackButton';
import { usePings } from '@/lib/pings';
import { onRealtime } from '@/lib/realtime';
import {
  blockUser,
  getThread,
  markThreadRead,
  sendMessage,
  type ThreadMessage,
} from '@/lib/pings-api';
import { ApiError } from '@/lib/api';
import { relativeTime } from '@/lib/format';
import { radius, spacing, typeScale } from '@/theme/tokens';
import { useTheme } from '@/theme/theme';
import { noWebOutline } from '@/theme/web';

const PAGE = 40;

export default function ThreadScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const { pingId } = useLocalSearchParams<{ pingId: string }>();
  const {
    requests,
    chats,
    reload: reloadPings,
    accept: acceptPingCtx,
    reject: rejectPingCtx,
    markChatRead,
  } = usePings();

  const request = requests.find((r) => r.pingId === pingId);
  const chat = chats.find((c) => c.pingId === pingId);
  const counterpart = request?.from ?? chat?.with ?? null;
  const name = counterpart?.displayName ?? `@${counterpart?.publicShortId ?? '…'}`;

  type Mode = 'loading' | 'request' | 'chat' | 'unavailable';
  const [mode, setMode] = useState<Mode>('loading');
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [busy, setBusy] = useState(false);

  const loadFirst = useCallback(async () => {
    if (!pingId) return;
    try {
      const t = await getThread(pingId, { limit: PAGE });
      setMessages(t.messages);
      setCursor(t.nextCursor);
      setMode('chat');
      setError(null);
      void markThreadRead(pingId).then(() => markChatRead(pingId));
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) {
        // Still a pending request. Make sure the provider has it so the
        // request pane can show the opening message.
        setMode('request');
        void reloadPings();
      } else if (e instanceof ApiError && e.status === 404) {
        setMode('unavailable');
      } else {
        setError(e instanceof ApiError ? e.message : 'Couldn’t load the chat.');
        setMode('unavailable');
      }
    }
  }, [pingId, markChatRead, reloadPings]);

  // Always attempt to load the thread. A 403 means it's still a pending
  // request (→ request mode); anything else resolves to the chat.
  useEffect(() => {
    void loadFirst();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pingId]);

  // live: new messages + read receipts for THIS thread
  useEffect(() => {
    if (!pingId) return;
    const offNew = onRealtime('message:new', (m) => {
      if (m.pingId !== pingId) return;
      setMessages((cur) =>
        cur.some((x) => x.messageId === m.messageId)
          ? cur
          : [
              {
                messageId: m.messageId,
                body: m.body,
                sentByMe: false,
                sentAt: m.sentAt,
                read: false,
              },
              ...cur,
            ],
      );
      void markThreadRead(pingId).then(() => markChatRead(pingId));
    });
    const offRead = onRealtime('message:read', (m) => {
      if (m.pingId !== pingId) return;
      setMessages((cur) =>
        cur.map((x) => (x.sentByMe ? { ...x, read: true } : x)),
      );
    });
    const offAccepted = onRealtime('ping:accepted', (m) => {
      if (m.pingId === pingId) void loadFirst();
    });
    return () => {
      offNew();
      offRead();
      offAccepted();
    };
  }, [pingId, markChatRead, loadFirst]);

  const loadMore = useCallback(async () => {
    if (!pingId || !cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const t = await getThread(pingId, { cursor, limit: PAGE });
      setMessages((cur) => {
        const seen = new Set(cur.map((x) => x.messageId));
        return [...cur, ...t.messages.filter((x) => !seen.has(x.messageId))];
      });
      setCursor(t.nextCursor);
    } catch {
      /* keep what we have */
    } finally {
      setLoadingMore(false);
    }
  }, [pingId, cursor, loadingMore]);

  const onSend = useCallback(async () => {
    const body = draft.trim();
    if (!body || !pingId || sending) return;
    setSending(true);
    setDraft('');
    const optimistic: ThreadMessage = {
      messageId: `tmp-${Date.now()}`,
      body,
      sentByMe: true,
      sentAt: new Date().toISOString(),
      read: false,
    };
    setMessages((cur) => [optimistic, ...cur]);
    try {
      const saved = await sendMessage(pingId, body);
      setMessages((cur) =>
        cur.map((m) =>
          m.messageId === optimistic.messageId
            ? { ...m, messageId: saved.messageId, sentAt: saved.sentAt }
            : m,
        ),
      );
      void reloadPings();
    } catch (e) {
      setMessages((cur) => cur.filter((m) => m.messageId !== optimistic.messageId));
      setDraft(body);
      setError(e instanceof ApiError ? e.message : 'Message didn’t send.');
    } finally {
      setSending(false);
    }
  }, [draft, pingId, sending, reloadPings]);

  const onAccept = useCallback(async () => {
    if (!pingId) return;
    setBusy(true);
    try {
      await acceptPingCtx(pingId);
      await loadFirst();
    } finally {
      setBusy(false);
    }
  }, [pingId, acceptPingCtx, loadFirst]);

  const onReject = useCallback(async () => {
    if (!pingId) return;
    setBusy(true);
    try {
      await rejectPingCtx(pingId);
      router.back();
    } finally {
      setBusy(false);
    }
  }, [pingId, rejectPingCtx, router]);

  const onBlock = useCallback(() => {
    if (!counterpart) return;
    Alert.alert(
      `Block ${name}?`,
      'They won’t be able to see you or message you, and this chat disappears for both of you.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Block',
          style: 'destructive',
          onPress: async () => {
            try {
              await blockUser(counterpart.publicShortId);
              await reloadPings();
              router.back();
            } catch (e) {
              setError(e instanceof ApiError ? e.message : 'Couldn’t block.');
            }
          },
        },
      ],
    );
  }, [counterpart, name, reloadPings, router]);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <BackButton />
        <View style={styles.headerCenter}>
          <Avatar name={counterpart?.displayName} size={32} />
          <AppText variant="bodyStrong" numberOfLines={1}>
            {name}
          </AppText>
        </View>
        {counterpart ? (
          <Pressable onPress={onBlock} hitSlop={10} style={styles.headerAction}>
            <Ionicons name="ellipsis-horizontal" size={20} color={colors.textMuted} />
          </Pressable>
        ) : (
          <View style={styles.headerAction} />
        )}
      </View>

      {error ? (
        <AppText variant="footnote" color="danger" style={styles.errline}>
          {error}
        </AppText>
      ) : null}

      {mode === 'unavailable' ? (
        <View style={styles.center}>
          <Ionicons name="chatbubble-outline" size={28} color={colors.textFaint} />
          <AppText variant="callout" color="textMuted" align="center" style={styles.hint}>
            {error ?? 'This conversation isn’t available.'}
          </AppText>
        </View>
      ) : mode === 'request' ? (
        <View style={styles.requestPane}>
          <Avatar name={counterpart?.displayName} size={72} />
          <AppText variant="title" align="center">
            {name}
          </AppText>
          <AppText variant="footnote" color="textFaint">
            wants to connect
            {request ? ` · ${relativeTime(request.createdAt)}` : ''}
          </AppText>
          {request?.openingMessage ? (
            <View
              style={[
                styles.openingBox,
                { backgroundColor: colors.surface, borderColor: colors.border },
              ]}
            >
              <AppText variant="body" color="textMuted">
                “{request.openingMessage}”
              </AppText>
            </View>
          ) : null}
          <AppText variant="footnote" color="textFaint" align="center" style={styles.hint}>
            Accepting opens messaging and lets them see your photos.
          </AppText>
          <View style={styles.requestButtons}>
            <View style={styles.actionHalf}>
              <Button
                label="Decline"
                variant="secondary"
                onPress={onReject}
                loading={busy}
              />
            </View>
            <View style={styles.actionHalf}>
              <Button label="Accept" onPress={onAccept} loading={busy} />
            </View>
          </View>
        </View>
      ) : mode === 'loading' ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.textMuted} />
        </View>
      ) : (
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
        >
          <FlatList
            data={messages}
            keyExtractor={(m) => m.messageId}
            inverted
            contentContainerStyle={styles.messages}
            showsVerticalScrollIndicator={false}
            onEndReached={loadMore}
            onEndReachedThreshold={0.3}
            ListFooterComponent={
              loadingMore ? (
                <ActivityIndicator color={colors.textFaint} style={styles.morePad} />
              ) : null
            }
            ListEmptyComponent={
              <View style={styles.emptyThread}>
                <AppText variant="footnote" color="textFaint" align="center">
                  You’re connected. Say hi.
                </AppText>
              </View>
            }
            renderItem={({ item, index }) => (
              <Bubble
                message={item}
                showReceipt={
                  item.sentByMe &&
                  index === messages.findIndex((m) => m.sentByMe)
                }
              />
            )}
          />

          <View
            style={[
              styles.composer,
              { backgroundColor: colors.bgElevated, borderTopColor: colors.border },
            ]}
          >
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder="Message"
              placeholderTextColor={colors.textFaint}
              multiline
              style={[
                typeScale.body,
                styles.input,
                {
                  color: colors.text,
                  backgroundColor: colors.surface,
                  borderColor: colors.border,
                },
                noWebOutline,
              ]}
            />
            <Pressable
              onPress={onSend}
              disabled={!draft.trim() || sending}
              style={[
                styles.sendBtn,
                {
                  backgroundColor: draft.trim() ? colors.brand : colors.surface,
                },
              ]}
            >
              <Ionicons
                name="arrow-up"
                size={20}
                color={draft.trim() ? colors.textOnBrand : colors.textFaint}
              />
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
}

function Bubble({
  message,
  showReceipt,
}: {
  message: ThreadMessage;
  showReceipt: boolean;
}) {
  const { colors } = useTheme();
  const mine = message.sentByMe;
  return (
    <View style={[styles.bubbleRow, mine ? styles.bubbleRight : styles.bubbleLeft]}>
      <View
        style={[
          styles.bubble,
          {
            backgroundColor: mine ? colors.brand : colors.surface,
            borderColor: mine ? colors.brand : colors.border,
            borderBottomRightRadius: mine ? 4 : radius.lg,
            borderBottomLeftRadius: mine ? radius.lg : 4,
          },
        ]}
      >
        <AppText
          style={[typeScale.body, { color: mine ? colors.textOnBrand : colors.text }]}
        >
          {message.body}
        </AppText>
      </View>
      <AppText variant="caption" color="textFaint" style={styles.stamp}>
        {relativeTime(message.sentAt)}
        {showReceipt ? (message.read ? ' · Read' : ' · Sent') : ''}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing[5],
    paddingTop: spacing[3],
    paddingBottom: spacing[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: spacing[3],
  },
  headerCenter: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
  },
  headerAction: { width: 32, alignItems: 'flex-end' },
  errline: { paddingHorizontal: spacing[6], paddingTop: spacing[3] },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  requestPane: {
    flex: 1,
    alignItems: 'center',
    padding: spacing[7],
    gap: spacing[4],
  },
  openingBox: {
    marginTop: spacing[3],
    padding: spacing[5],
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth * 2,
    alignSelf: 'stretch',
  },
  hint: { marginTop: spacing[4], maxWidth: 300 },
  requestButtons: {
    flexDirection: 'row',
    gap: spacing[3],
    alignSelf: 'stretch',
    marginTop: spacing[5],
  },
  actionHalf: { flex: 1 },
  messages: { paddingHorizontal: spacing[5], paddingVertical: spacing[5], gap: spacing[3] },
  morePad: { paddingVertical: spacing[5] },
  emptyThread: { paddingVertical: spacing[9], transform: [{ scaleY: -1 }] },
  bubbleRow: { maxWidth: '82%', gap: 3 },
  bubbleLeft: { alignSelf: 'flex-start', alignItems: 'flex-start' },
  bubbleRight: { alignSelf: 'flex-end', alignItems: 'flex-end' },
  bubble: {
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth * 2,
  },
  stamp: { paddingHorizontal: spacing[2] },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing[3],
    paddingHorizontal: spacing[5],
    paddingTop: spacing[3],
    paddingBottom: spacing[3],
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  input: {
    flex: 1,
    maxHeight: 120,
    minHeight: 44,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth * 2,
    paddingHorizontal: spacing[4],
    paddingTop: spacing[3],
    paddingBottom: spacing[3],
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
