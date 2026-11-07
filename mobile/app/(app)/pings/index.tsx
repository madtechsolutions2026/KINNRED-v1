import { useCallback, useState } from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { AppText } from '@/components/AppText';
import { Avatar } from '@/components/Avatar';
import { Button } from '@/components/Button';
import { usePings } from '@/lib/pings';
import { relativeTime } from '@/lib/format';
import type { ChatSummary, PingRequest, SentPing } from '@/lib/pings-api';
import { radius, spacing } from '@/theme/tokens';
import { useTheme } from '@/theme/theme';

type Tab = 'requests' | 'chats';

export default function PingsInbox() {
  const router = useRouter();
  const { colors } = useTheme();
  const p = usePings();
  const [tab, setTab] = useState<Tab>('requests');
  const [refreshing, setRefreshing] = useState(false);

  const reload = p.reload;
  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await p.reload();
    setRefreshing(false);
  }, [p]);

  const chatUnread = p.chats.filter(
    (c) => c.lastMessage && !c.lastMessage.sentByMe && !c.lastMessage.read,
  ).length;

  return (
    <SafeAreaView
      edges={['top']}
      style={[styles.safe, { backgroundColor: colors.bg }]}
    >
      <View style={styles.header}>
        <AppText variant="headline">Pings</AppText>
      </View>

      <View style={[styles.segmented, { backgroundColor: colors.surface }]}>
        <Segment
          label="Requests"
          count={p.requests.length}
          active={tab === 'requests'}
          onPress={() => setTab('requests')}
        />
        <Segment
          label="Chats"
          count={chatUnread}
          active={tab === 'chats'}
          onPress={() => setTab('chats')}
        />
      </View>

      <ScrollView
        contentContainerStyle={styles.body}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.textMuted}
          />
        }
      >
        {p.error ? (
          <AppText variant="footnote" color="danger" style={styles.pad}>
            {p.error}
          </AppText>
        ) : null}

        {tab === 'requests' ? (
          <RequestsTab
            requests={p.requests}
            sent={p.sent}
            loading={p.loading}
            onOpen={(id) => router.push(`/pings/${id}`)}
            onAccept={p.accept}
            onReject={p.reject}
            onWithdraw={p.withdraw}
          />
        ) : (
          <ChatsTab
            chats={p.chats}
            loading={p.loading}
            onOpen={(id) => router.push(`/pings/${id}`)}
          />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Segment({
  label,
  count,
  active,
  onPress,
}: {
  label: string;
  count: number;
  active: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.segment,
        { backgroundColor: active ? colors.bgElevated : 'transparent' },
      ]}
    >
      <AppText
        variant="subhead"
        color={active ? 'text' : 'textMuted'}
        style={styles.segmentText}
      >
        {label}
        {count > 0 ? `  ${count}` : ''}
      </AppText>
    </Pressable>
  );
}

function RequestsTab({
  requests,
  sent,
  loading,
  onOpen,
  onAccept,
  onReject,
  onWithdraw,
}: {
  requests: PingRequest[];
  sent: SentPing[];
  loading: boolean;
  onOpen: (id: string) => void;
  onAccept: (id: string) => Promise<void>;
  onReject: (id: string) => Promise<void>;
  onWithdraw: (id: string) => Promise<void>;
}) {
  const { colors } = useTheme();

  if (loading && requests.length === 0 && sent.length === 0) {
    return <Empty icon="hourglass-outline" text="Loading…" />;
  }
  if (requests.length === 0 && sent.length === 0) {
    return (
      <Empty
        icon="chatbubbles-outline"
        text="No requests yet. When someone pings you, it lands here."
      />
    );
  }

  return (
    <View style={styles.list}>
      {requests.map((r) => (
        <RequestRow
          key={r.pingId}
          request={r}
          onOpen={() => onOpen(r.pingId)}
          onAccept={() => void onAccept(r.pingId)}
          onReject={() => void onReject(r.pingId)}
        />
      ))}

      {sent.length > 0 ? (
        <>
          <AppText variant="overline" color="textFaint" style={styles.sectionLabel}>
            Waiting on them
          </AppText>
          {sent.map((s) => (
            <View
              key={s.pingId}
              style={[
                styles.row,
                { backgroundColor: colors.surface, borderColor: colors.border },
              ]}
            >
              <Avatar name={s.to.displayName} size={44} />
              <View style={styles.rowBody}>
                <AppText variant="bodyStrong" numberOfLines={1}>
                  {s.to.displayName ?? `@${s.to.publicShortId}`}
                </AppText>
                <AppText variant="footnote" color="textFaint">
                  Sent {relativeTime(s.createdAt)}
                </AppText>
              </View>
              <Pressable onPress={() => void onWithdraw(s.pingId)} hitSlop={8}>
                <AppText variant="subhead" color="textMuted">
                  Cancel
                </AppText>
              </Pressable>
            </View>
          ))}
        </>
      ) : null}
    </View>
  );
}

function RequestRow({
  request,
  onOpen,
  onAccept,
  onReject,
}: {
  request: PingRequest;
  onOpen: () => void;
  onAccept: () => void;
  onReject: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onOpen}
      style={({ pressed }) => [
        styles.requestCard,
        {
          backgroundColor: pressed ? colors.surfaceHover : colors.surface,
          borderColor: colors.border,
        },
      ]}
    >
      <View style={styles.requestTop}>
        <Avatar name={request.from.displayName} size={44} />
        <View style={styles.rowBody}>
          <AppText variant="bodyStrong" numberOfLines={1}>
            {request.from.displayName ?? `@${request.from.publicShortId}`}
          </AppText>
          <AppText variant="footnote" color="textFaint">
            {relativeTime(request.createdAt)}
          </AppText>
        </View>
      </View>

      {request.openingMessage ? (
        <AppText variant="callout" color="textMuted" style={styles.opening}>
          “{request.openingMessage}”
        </AppText>
      ) : null}

      <View style={styles.requestActions}>
        <View style={styles.actionHalf}>
          <Button label="Decline" variant="secondary" onPress={onReject} />
        </View>
        <View style={styles.actionHalf}>
          <Button label="Accept" onPress={onAccept} />
        </View>
      </View>
    </Pressable>
  );
}

function ChatsTab({
  chats,
  loading,
  onOpen,
}: {
  chats: ChatSummary[];
  loading: boolean;
  onOpen: (id: string) => void;
}) {
  const { colors } = useTheme();

  if (loading && chats.length === 0) {
    return <Empty icon="hourglass-outline" text="Loading…" />;
  }
  if (chats.length === 0) {
    return (
      <Empty
        icon="chatbubble-ellipses-outline"
        text="No chats yet. Accept a request or ping someone from the Grid."
      />
    );
  }

  return (
    <View style={styles.list}>
      {chats.map((c) => {
        const unread =
          c.lastMessage && !c.lastMessage.sentByMe && !c.lastMessage.read;
        return (
          <Pressable
            key={c.pingId}
            onPress={() => onOpen(c.pingId)}
            style={({ pressed }) => [
              styles.row,
              {
                backgroundColor: pressed ? colors.surfaceHover : colors.surface,
                borderColor: colors.border,
              },
            ]}
          >
            <Avatar name={c.with.displayName} size={48} />
            <View style={styles.rowBody}>
              <AppText variant="bodyStrong" numberOfLines={1}>
                {c.with.displayName ?? `@${c.with.publicShortId}`}
              </AppText>
              <AppText
                variant="footnote"
                color={unread ? 'text' : 'textMuted'}
                numberOfLines={1}
              >
                {c.lastMessage
                  ? `${c.lastMessage.sentByMe ? 'You: ' : ''}${c.lastMessage.body}`
                  : 'Say hello'}
              </AppText>
            </View>
            <View style={styles.rowMeta}>
              <AppText variant="caption" color="textFaint">
                {relativeTime(c.lastActivityAt)}
              </AppText>
              {unread ? (
                <View style={[styles.unreadDot, { backgroundColor: colors.brand }]} />
              ) : null}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

function Empty({ icon, text }: { icon: keyof typeof Ionicons.glyphMap; text: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.empty}>
      <Ionicons name={icon} size={28} color={colors.textFaint} />
      <AppText variant="callout" color="textMuted" align="center" style={styles.emptyText}>
        {text}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: {
    paddingHorizontal: spacing[6],
    paddingTop: spacing[4],
    paddingBottom: spacing[4],
  },
  segmented: {
    flexDirection: 'row',
    marginHorizontal: spacing[6],
    borderRadius: radius.md,
    padding: 4,
    gap: 4,
  },
  segment: {
    flex: 1,
    paddingVertical: spacing[3],
    borderRadius: radius.sm,
    alignItems: 'center',
  },
  segmentText: {},
  body: { paddingBottom: 112, paddingTop: spacing[5] },
  pad: { paddingHorizontal: spacing[6], marginBottom: spacing[3] },
  list: { paddingHorizontal: spacing[6], gap: spacing[3] },
  sectionLabel: { marginTop: spacing[6], marginBottom: spacing[1] },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[4],
    padding: spacing[4],
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth * 2,
  },
  rowBody: { flex: 1, gap: 2 },
  rowMeta: { alignItems: 'flex-end', gap: spacing[2] },
  unreadDot: { width: 9, height: 9, borderRadius: 5 },
  requestCard: {
    padding: spacing[4],
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth * 2,
    gap: spacing[4],
  },
  requestTop: { flexDirection: 'row', alignItems: 'center', gap: spacing[4] },
  opening: { fontStyle: 'italic' },
  requestActions: { flexDirection: 'row', gap: spacing[3] },
  actionHalf: { flex: 1 },
  empty: {
    alignItems: 'center',
    gap: spacing[4],
    paddingTop: spacing[11],
    paddingHorizontal: spacing[8],
  },
  emptyText: { maxWidth: 280 },
});
