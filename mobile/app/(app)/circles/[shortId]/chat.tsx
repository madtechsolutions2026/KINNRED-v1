import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { AppText } from '@/components/AppText';
import { BackButton } from '@/components/BackButton';
import { onRealtime } from '@/lib/realtime';
import {
  getCircle,
  getCircleMessages,
  sendCircleMessage,
  type CircleMessage,
} from '@/lib/circles-api';
import { ApiError } from '@/lib/api';
import { relativeTime } from '@/lib/format';
import { radius, spacing, typeScale } from '@/theme/tokens';
import { useTheme } from '@/theme/theme';
import { noWebOutline } from '@/theme/web';

const PAGE = 40;

export default function CircleChatScreen() {
  const { colors } = useTheme();
  const { shortId } = useLocalSearchParams<{ shortId: string }>();

  const [name, setName] = useState('Group chat');
  const [messages, setMessages] = useState<CircleMessage[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [disabled, setDisabled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    if (!shortId) return;
    try {
      const [c, m] = await Promise.all([
        getCircle(shortId),
        getCircleMessages(shortId, { limit: PAGE }),
      ]);
      setName(c.name);
      setDisabled(!c.chatEnabled);
      setMessages(m.messages);
      setCursor(m.nextCursor);
      setError(null);
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) {
        setDisabled(true);
        setError('Group chat is turned off for this circle.');
      } else {
        setError(e instanceof ApiError ? e.message : 'Couldn’t load the chat.');
      }
    } finally {
      setLoading(false);
    }
  }, [shortId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!shortId) return;
    const offNew = onRealtime('circle:message:new', (e) => {
      if (e.circle.publicShortId !== shortId) return;
      setMessages((cur) =>
        cur.some((m) => m.id === e.message.id) ? cur : [e.message, ...cur],
      );
    });
    const offOff = onRealtime('circle:chat:disabled', (e) => {
      if (e.circle.publicShortId === shortId) setDisabled(true);
    });
    return () => {
      offNew();
      offOff();
    };
  }, [shortId]);

  const loadMore = useCallback(async () => {
    if (!shortId || !cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const m = await getCircleMessages(shortId, { cursor, limit: PAGE });
      setMessages((cur) => {
        const seen = new Set(cur.map((x) => x.id));
        return [...cur, ...m.messages.filter((x) => !seen.has(x.id))];
      });
      setCursor(m.nextCursor);
    } catch {
      setCursor(null);
    } finally {
      setLoadingMore(false);
    }
  }, [shortId, cursor, loadingMore]);

  const onSend = useCallback(async () => {
    const body = draft.trim();
    if (!body || !shortId || sending) return;
    setSending(true);
    setDraft('');
    const optimistic: CircleMessage = {
      id: `tmp-${Date.now()}`,
      body,
      sender: { publicShortId: '', displayName: 'You' },
      mine: true,
      sentAt: new Date().toISOString(),
    };
    setMessages((cur) => [optimistic, ...cur]);
    try {
      const saved = await sendCircleMessage(shortId, body);
      setMessages((cur) =>
        cur.map((m) => (m.id === optimistic.id ? saved : m)),
      );
    } catch (e) {
      setMessages((cur) => cur.filter((m) => m.id !== optimistic.id));
      setDraft(body);
      if (e instanceof ApiError && e.status === 403) setDisabled(true);
      setError(e instanceof ApiError ? e.message : 'Message didn’t send.');
    } finally {
      setSending(false);
    }
  }, [draft, shortId, sending]);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <BackButton />
        <AppText variant="bodyStrong" numberOfLines={1} style={styles.title}>
          {name}
        </AppText>
        <View style={styles.headerSpacer} />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.textMuted} />
        </View>
      ) : (
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'web' ? undefined : 'padding'}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
        >
          <FlatList
            style={styles.flex}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            data={messages}
            keyExtractor={(m) => m.id}
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
                  {error ?? 'No messages yet. Start the conversation.'}
                </AppText>
              </View>
            }
            renderItem={({ item, index }) => {
              const prev = messages[index + 1];
              const showSender =
                !item.mine &&
                (!prev || prev.sender.publicShortId !== item.sender.publicShortId);
              return <Bubble message={item} showSender={showSender} />;
            }}
          />

          {disabled ? (
            <View style={[styles.disabledBar, { borderTopColor: colors.border }]}>
              <AppText variant="footnote" color="textFaint" align="center">
                Group chat is turned off for this circle.
              </AppText>
            </View>
          ) : (
            <View
              style={[
                styles.composer,
                { backgroundColor: colors.bgElevated, borderTopColor: colors.border },
              ]}
            >
              <TextInput
                value={draft}
                onChangeText={setDraft}
                accessibilityLabel="Message the circle"
              placeholder="Message the circle"
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
                accessibilityRole="button"
                accessibilityLabel="Send message"
                onPress={onSend}
                disabled={!draft.trim() || sending}
                style={[
                  styles.sendBtn,
                  { backgroundColor: draft.trim() ? colors.brand : colors.surface },
                ]}
              >
                <Ionicons
                  name="arrow-up"
                  size={20}
                  color={draft.trim() ? colors.textOnBrand : colors.textFaint}
                />
              </Pressable>
            </View>
          )}
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
}

function Bubble({
  message,
  showSender,
}: {
  message: CircleMessage;
  showSender: boolean;
}) {
  const { colors } = useTheme();
  const mine = message.mine;
  return (
    <View style={[styles.bubbleRow, mine ? styles.right : styles.left]}>
      {showSender ? (
        <AppText variant="caption" color="textFaint" style={styles.sender}>
          {message.sender.displayName ?? `@${message.sender.publicShortId}`}
        </AppText>
      ) : null}
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
  title: { flex: 1 },
  headerSpacer: { width: 42 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  messages: { paddingHorizontal: spacing[5], paddingVertical: spacing[5], gap: spacing[3] },
  morePad: { paddingVertical: spacing[5] },
  emptyThread: { paddingVertical: spacing[9], transform: [{ scaleY: -1 }] },
  bubbleRow: { maxWidth: '82%', gap: 2 },
  left: { alignSelf: 'flex-start', alignItems: 'flex-start' },
  right: { alignSelf: 'flex-end', alignItems: 'flex-end' },
  sender: { paddingHorizontal: spacing[2] },
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
    paddingVertical: spacing[3],
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  disabledBar: {
    paddingVertical: spacing[5],
    paddingHorizontal: spacing[6],
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  input: {
    minWidth: 0,
    textAlignVertical: "top",
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
