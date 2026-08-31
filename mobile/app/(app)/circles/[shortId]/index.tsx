import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { BackButton } from '@/components/BackButton';
import { CirclePostComposer } from '@/components/CirclePostComposer';
import { useCircles } from '@/lib/circles';
import { onRealtime } from '@/lib/realtime';
import {
  getCircle,
  getPosts,
  deletePost,
  joinCircle,
  requestToJoin,
  acceptInvite,
  leaveCircle,
  CATEGORY_LABELS,
  TIER_LABELS,
  type CircleDetail,
  type CirclePost,
} from '@/lib/circles-api';
import { ApiError } from '@/lib/api';
import { relativeTime } from '@/lib/format';
import { radius, spacing } from '@/theme/tokens';
import { useTheme } from '@/theme/theme';

export default function CircleDetailScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const { shortId } = useLocalSearchParams<{ shortId: string }>();
  const { reload: reloadCircles, markSeen } = useCircles();

  const [circle, setCircle] = useState<CircleDetail | null>(null);
  const [posts, setPosts] = useState<CirclePost[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);

  const isMember = circle?.viewer.membershipStatus === 'ACTIVE';

  const load = useCallback(async () => {
    if (!shortId) return;
    try {
      const c = await getCircle(shortId);
      setCircle(c);
      setError(null);
      if (c.viewer.membershipStatus === 'ACTIVE') {
        const p = await getPosts(shortId, { limit: 20 });
        setPosts(p.posts);
        setCursor(p.nextCursor);
      } else {
        setPosts([]);
      }
    } catch (e) {
      setError(
        e instanceof ApiError && e.status === 404
          ? 'This circle isn’t available.'
          : e instanceof ApiError
            ? e.message
            : 'Couldn’t load the circle.',
      );
    } finally {
      setLoading(false);
    }
  }, [shortId]);

  useEffect(() => {
    void load();
    if (shortId) markSeen(shortId);
  }, [load, shortId, markSeen]);

  // live posts for this circle
  useEffect(() => {
    if (!shortId) return;
    const off = onRealtime('circle:post:new', (e) => {
      if (e.circle.publicShortId !== shortId) return;
      setPosts((cur) =>
        cur.some((p) => p.id === e.post.id) ? cur : [e.post, ...cur],
      );
      markSeen(shortId);
    });
    return off;
  }, [shortId, markSeen]);

  const act = useCallback(
    async (fn: () => Promise<unknown>) => {
      setBusy(true);
      setError(null);
      try {
        await fn();
        await Promise.all([load(), reloadCircles()]);
      } catch (e) {
        setError(e instanceof ApiError ? e.message : 'Something went wrong.');
      } finally {
        setBusy(false);
      }
    },
    [load, reloadCircles],
  );

  const onLeave = useCallback(() => {
    if (!shortId || !circle) return;
    const dissolves =
      circle.viewer.isAdmin && circle.memberCount <= 1;
    Alert.alert(
      circle.viewer.membershipStatus === 'INVITED'
        ? 'Decline invite?'
        : circle.viewer.membershipStatus === 'PENDING'
          ? 'Withdraw request?'
          : dissolves
            ? 'Leave and dissolve circle?'
            : `Leave ${circle.name}?`,
      dissolves
        ? 'You’re the only member — leaving deletes the circle.'
        : undefined,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Leave',
          style: 'destructive',
          onPress: () =>
            void act(async () => {
              await leaveCircle(shortId);
              router.back();
            }),
        },
      ],
    );
  }, [shortId, circle, act, router]);

  const loadMore = useCallback(async () => {
    if (!shortId || !cursor) return;
    try {
      const p = await getPosts(shortId, { cursor, limit: 20 });
      setPosts((cur) => {
        const seen = new Set(cur.map((x) => x.id));
        return [...cur, ...p.posts.filter((x) => !seen.has(x.id))];
      });
      setCursor(p.nextCursor);
    } catch {
      setCursor(null);
    }
  }, [shortId, cursor]);

  if (loading && !circle) {
    return (
      <SafeAreaView style={[styles.center, { backgroundColor: colors.bg }]}>
        <ActivityIndicator color={colors.textMuted} />
      </SafeAreaView>
    );
  }

  if (!circle) {
    return (
      <SafeAreaView style={[styles.center, { backgroundColor: colors.bg }]}>
        <BackButton />
        <AppText color="danger" align="center" style={styles.pad}>
          {error ?? 'This circle isn’t available.'}
        </AppText>
      </SafeAreaView>
    );
  }

  const status = circle.viewer.membershipStatus;

  const header = (
    <View>
      <View style={styles.hero}>
        <AppText variant="title">{circle.name}</AppText>
        <View style={styles.metaRow}>
          <TierChip tier={circle.tier} />
          <AppText variant="subhead" color="textMuted">
            {CATEGORY_LABELS[circle.category]} · {circle.memberCount}{' '}
            {circle.memberCount === 1 ? 'member' : 'members'}
          </AppText>
        </View>
        {circle.description ? (
          <AppText variant="body" color="textMuted" style={styles.desc}>
            {circle.description}
          </AppText>
        ) : null}
      </View>

      {/* membership CTA */}
      <View style={styles.cta}>
        {status === null ? (
          circle.tier === 'INVITE_ONLY' ? (
            <Button
              label="Request to join"
              loading={busy}
              onPress={() => void act(() => requestToJoin(circle.publicShortId))}
            />
          ) : (
            <Button
              label="Join circle"
              loading={busy}
              onPress={() => void act(() => joinCircle(circle.publicShortId))}
            />
          )
        ) : status === 'INVITED' ? (
          <View style={styles.ctaRow}>
            <View style={styles.half}>
              <Button label="Decline" variant="secondary" onPress={onLeave} />
            </View>
            <View style={styles.half}>
              <Button
                label="Accept invite"
                loading={busy}
                onPress={() => void act(() => acceptInvite(circle.publicShortId))}
              />
            </View>
          </View>
        ) : status === 'PENDING' ? (
          <View style={styles.ctaRow}>
            <View style={styles.half}>
              <Button label="Request pending" variant="secondary" disabled onPress={() => {}} />
            </View>
            <View style={styles.half}>
              <Button label="Withdraw" variant="ghost" onPress={onLeave} />
            </View>
          </View>
        ) : (
          // ACTIVE
          <View style={styles.memberBar}>
            <MemberAction
              icon="chatbubbles-outline"
              label="Chat"
              disabled={!circle.chatEnabled}
              onPress={() => router.push(`/circles/${circle.publicShortId}/chat`)}
            />
            <MemberAction
              icon="people-outline"
              label="Members"
              onPress={() => router.push(`/circles/${circle.publicShortId}/members`)}
            />
            {circle.viewer.isAdmin ? (
              <MemberAction
                icon="create-outline"
                label="Post"
                onPress={() => setComposerOpen(true)}
              />
            ) : null}
          </View>
        )}
      </View>

      {error ? (
        <AppText variant="footnote" color="danger" style={styles.err}>
          {error}
        </AppText>
      ) : null}

      {isMember ? (
        <AppText variant="overline" color="textFaint" style={styles.feedLabel}>
          Posts
        </AppText>
      ) : null}
    </View>
  );

  return (
    <SafeAreaView edges={['top']} style={[styles.safe, { backgroundColor: colors.bg }]}>
      <View style={styles.topBar}>
        <BackButton />
        {status === 'ACTIVE' ? (
          <Pressable onPress={onLeave} hitSlop={10}>
            <AppText variant="subhead" color="textMuted">
              Leave
            </AppText>
          </Pressable>
        ) : null}
      </View>

      <FlatList
        data={isMember ? posts : []}
        keyExtractor={(p) => p.id}
        ListHeaderComponent={header}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              await load();
              setRefreshing(false);
            }}
            tintColor={colors.textMuted}
          />
        }
        onEndReached={loadMore}
        onEndReachedThreshold={0.4}
        ListEmptyComponent={
          isMember ? (
            <AppText variant="footnote" color="textFaint" style={styles.pad}>
              No posts yet.
              {circle.viewer.isAdmin ? ' Share the first update.' : ''}
            </AppText>
          ) : null
        }
        renderItem={({ item }) => (
          <PostRow
            post={item}
            canDelete={item.mine || circle.viewer.isAdmin}
            onDelete={() =>
              void act(async () => {
                await deletePost(circle.publicShortId, item.id);
                setPosts((cur) => cur.filter((p) => p.id !== item.id));
              })
            }
          />
        )}
      />

      <CirclePostComposer
        visible={composerOpen}
        circleShortId={circle.publicShortId}
        onClose={() => setComposerOpen(false)}
        onPosted={(post) => {
          setComposerOpen(false);
          if (!post.scheduledFor || new Date(post.scheduledFor) <= new Date()) {
            setPosts((cur) => [post, ...cur]);
          } else {
            void load();
          }
        }}
      />
    </SafeAreaView>
  );
}

function TierChip({ tier }: { tier: CircleDetail['tier'] }) {
  const { colors } = useTheme();
  if (tier === 'OPEN') return null;
  return (
    <View style={[styles.tierChip, { borderColor: colors.border }]}>
      <Ionicons
        name={tier === 'INCOGNITO' ? 'eye-off-outline' : 'lock-closed-outline'}
        size={12}
        color={colors.textMuted}
      />
      <AppText variant="caption" color="textMuted">
        {TIER_LABELS[tier]}
      </AppText>
    </View>
  );
}

function MemberAction({
  icon,
  label,
  onPress,
  disabled,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.memberAction,
        {
          backgroundColor: pressed ? colors.surfaceHover : colors.surface,
          borderColor: colors.border,
          opacity: disabled ? 0.45 : 1,
        },
      ]}
    >
      <Ionicons name={icon} size={20} color={colors.text} />
      <AppText variant="caption" color="textMuted">
        {label}
      </AppText>
    </Pressable>
  );
}

function PostRow({
  post,
  canDelete,
  onDelete,
}: {
  post: CirclePost;
  canDelete: boolean;
  onDelete: () => void;
}) {
  const { colors } = useTheme();
  const scheduled =
    post.scheduledFor && new Date(post.scheduledFor) > new Date();
  return (
    <View
      style={[
        styles.post,
        { backgroundColor: colors.surface, borderColor: colors.border },
      ]}
    >
      <View style={styles.postHead}>
        <AppText variant="subhead" numberOfLines={1} style={styles.postAuthor}>
          {post.author.displayName ?? `@${post.author.publicShortId}`}
        </AppText>
        {scheduled ? (
          <View style={styles.schedBadge}>
            <Ionicons name="time-outline" size={11} color={colors.warning} />
            <AppText variant="caption" color="warning">
              {relativeTime(post.scheduledFor as string)}
            </AppText>
          </View>
        ) : (
          <AppText variant="caption" color="textFaint">
            {relativeTime(post.createdAt)}
          </AppText>
        )}
        {canDelete ? (
          <Pressable onPress={onDelete} hitSlop={8}>
            <Ionicons name="trash-outline" size={15} color={colors.textFaint} />
          </Pressable>
        ) : null}
      </View>
      <AppText variant="body">{post.body}</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing[6] },
  pad: { paddingHorizontal: spacing[6], paddingVertical: spacing[6] },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[6],
    paddingTop: spacing[3],
    paddingBottom: spacing[3],
  },
  list: { paddingHorizontal: spacing[6], paddingBottom: spacing[10], gap: spacing[3] },
  hero: { gap: spacing[3], marginBottom: spacing[5] },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[3], flexWrap: 'wrap' },
  tierChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: spacing[3],
    paddingVertical: 2,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth * 2,
  },
  desc: { marginTop: spacing[2] },
  cta: { marginBottom: spacing[5] },
  ctaRow: { flexDirection: 'row', gap: spacing[3] },
  half: { flex: 1 },
  memberBar: { flexDirection: 'row', gap: spacing[3] },
  memberAction: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
    paddingVertical: spacing[4],
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth * 2,
  },
  err: { marginBottom: spacing[4] },
  feedLabel: { marginBottom: spacing[3] },
  post: {
    padding: spacing[4],
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth * 2,
    gap: spacing[3],
  },
  postHead: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  postAuthor: { flex: 1 },
  schedBadge: { flexDirection: 'row', alignItems: 'center', gap: 3 },
});
