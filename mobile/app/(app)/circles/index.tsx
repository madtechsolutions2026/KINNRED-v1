import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { BrandGradient } from '@/components/BrandGradient';
import { AppText } from '@/components/AppText';
import { CircleCard } from '@/components/CircleCard';
import { useCircles } from '@/lib/circles';
import {
  browseCircles,
  CATEGORY_LABELS,
  type CircleCategory,
  type CircleSummary,
} from '@/lib/circles-api';
import { ApiError } from '@/lib/api';
import { radius, spacing, typeScale } from '@/theme/tokens';
import { useTheme } from '@/theme/theme';
import { noWebOutline } from '@/theme/web';

type Tab = 'discover' | 'mine';
const PAGE = 20;
const CATEGORIES = Object.keys(CATEGORY_LABELS) as CircleCategory[];

export default function CirclesIndex() {
  const router = useRouter();
  const { colors } = useTheme();
  const circles = useCircles();
  const [tab, setTab] = useState<Tab>('discover');

  const [q, setQ] = useState('');
  const [category, setCategory] = useState<CircleCategory | null>(null);
  const [results, setResults] = useState<CircleSummary[]>([]);
  const cursorRef = useRef<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [browsing, setBrowsing] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [browseError, setBrowseError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const runBrowse = useCallback(
    async (opts: { q: string; category: CircleCategory | null }) => {
      setBrowsing(true);
      setBrowseError(null);
      try {
        const res = await browseCircles({
          q: opts.q || undefined,
          category: opts.category ?? undefined,
          limit: PAGE,
        });
        setResults(res.circles);
        cursorRef.current = res.nextCursor;
        setHasMore(!!res.nextCursor);
      } catch (e) {
        setBrowseError(
          e instanceof ApiError ? e.message : 'Couldn’t load circles.',
        );
      } finally {
        setBrowsing(false);
      }
    },
    [],
  );

  // debounce search
  useEffect(() => {
    const t = setTimeout(() => void runBrowse({ q, category }), 300);
    return () => clearTimeout(t);
  }, [q, category, runBrowse]);

  useFocusEffect(
    useCallback(() => {
      void circles.reload();
    }, [circles.reload]),
  );

  const loadMore = useCallback(async () => {
    if (loadingMore || !cursorRef.current) return;
    setLoadingMore(true);
    try {
      const res = await browseCircles({
        q: q || undefined,
        category: category ?? undefined,
        cursor: cursorRef.current,
        limit: PAGE,
      });
      setResults((cur) => {
        const seen = new Set(cur.map((c) => c.publicShortId));
        return [
          ...cur,
          ...res.circles.filter((c) => !seen.has(c.publicShortId)),
        ];
      });
      cursorRef.current = res.nextCursor;
      setHasMore(!!res.nextCursor);
    } catch {
      setHasMore(false);
    } finally {
      setLoadingMore(false);
    }
  }, [q, category, loadingMore]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([
      runBrowse({ q, category }),
      circles.reload(),
    ]);
    setRefreshing(false);
  }, [q, category, runBrowse, circles]);

  return (
    <SafeAreaView
      edges={['top']}
      style={[styles.safe, { backgroundColor: colors.bg }]}
    >
      <View style={styles.header}>
        <AppText variant="title">Circles</AppText>
        <Pressable
          onPress={() => router.push('/circles/create')}
          hitSlop={8}
          style={({ pressed }) => [
            styles.newBtn,
            { backgroundColor: pressed ? colors.brandPressed : colors.brand },
          ]}
        >
          <Ionicons name="add" size={18} color={colors.textOnBrand} />
          <AppText variant="subhead" style={{ color: colors.textOnBrand }}>
            New
          </AppText>
        </Pressable>
      </View>

      <View style={[styles.segmented, { backgroundColor: colors.surface }]}>
        <Seg label="Discover" active={tab === 'discover'} onPress={() => setTab('discover')} />
        <Seg
          label={`Mine${circles.mine.length ? `  ${circles.mine.length}` : ''}`}
          active={tab === 'mine'}
          onPress={() => setTab('mine')}
        />
      </View>

      {tab === 'discover' ? (
        <>
          <View
            style={[
              styles.search,
              { backgroundColor: colors.fieldBg, borderColor: colors.fieldBorder },
            ]}
          >
            <Ionicons name="search" size={16} color={colors.textFaint} />
            <TextInput
              value={q}
              onChangeText={setQ}
              placeholder="Search circles"
              placeholderTextColor={colors.textFaint}
              autoCorrect={false}
              style={[typeScale.body, styles.searchInput, { color: colors.text }, noWebOutline]}
            />
          </View>

          <View style={styles.catRow}>
            <FlatList
              horizontal
              data={CATEGORIES}
              keyExtractor={(c) => c}
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.catContent}
              renderItem={({ item }) => {
                const on = category === item;
                return (
                  <Pressable
                    onPress={() => setCategory(on ? null : item)}
                    style={[
                      styles.catChip,
                      {
                        backgroundColor: on ? colors.brand : colors.surface,
                        borderColor: on ? colors.brand : colors.border,
                      },
                    ]}
                  >
                    <AppText
                      variant="caption"
                      style={{ color: on ? colors.textOnBrand : colors.textMuted }}
                    >
                      {CATEGORY_LABELS[item]}
                    </AppText>
                  </Pressable>
                );
              }}
            />
          </View>

          <FlatList
            data={results}
            keyExtractor={(c) => c.publicShortId}
            contentContainerStyle={styles.list}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.textMuted} />
            }
            onEndReached={loadMore}
            onEndReachedThreshold={0.4}
            ListEmptyComponent={
              browsing ? (
                <ActivityIndicator color={colors.textFaint} style={styles.pad} />
              ) : (
                <Empty
                  icon="planet-outline"
                  text={
                    browseError ??
                    'No circles match. Try another category, or start one.'
                  }
                />
              )
            }
            ListFooterComponent={
              loadingMore ? (
                <ActivityIndicator color={colors.textFaint} style={styles.pad} />
              ) : null
            }
            renderItem={({ item }) => (
              <CircleCard
                name={item.name}
                description={item.description}
                tier={item.tier}
                category={item.category}
                memberCount={item.memberCount}
                onPress={() => router.push(`/circles/${item.publicShortId}`)}
              />
            )}
          />
        </>
      ) : (
        <MineList />
      )}
    </SafeAreaView>
  );
}

function MineList() {
  const router = useRouter();
  const { colors } = useTheme();
  const { mine, loading, unread, markSeen } = useCircles();

  if (loading && mine.length === 0) {
    return <ActivityIndicator color={colors.textFaint} style={styles.pad} />;
  }

  const active = mine.filter((c) => c.membershipStatus === 'ACTIVE');
  const invited = mine.filter((c) => c.membershipStatus === 'INVITED');
  const pending = mine.filter((c) => c.membershipStatus === 'PENDING');

  if (mine.length === 0) {
    return (
      <Empty
        icon="people-outline"
        text="You’re not in any circles yet. Discover one, or create your own."
      />
    );
  }

  return (
    <FlatList
      data={[
        ...(invited.length ? [{ header: 'Invitations' }] : []),
        ...invited,
        ...(pending.length ? [{ header: 'Requested' }] : []),
        ...pending,
        ...(active.length ? [{ header: 'Your circles' }] : []),
        ...active,
      ]}
      keyExtractor={(item, i) =>
        'header' in item ? `h-${item.header}` : `${item.publicShortId}-${i}`
      }
      contentContainerStyle={styles.list}
      showsVerticalScrollIndicator={false}
      renderItem={({ item }) => {
        if ('header' in item) {
          return (
            <AppText variant="overline" color="textFaint" style={styles.sectionLabel}>
              {item.header}
            </AppText>
          );
        }
        const isUnread = unread.has(item.publicShortId);
        return (
          <CircleCard
            name={item.name}
            tier={item.tier}
            category={item.category}
            trailing={
              item.membershipStatus === 'INVITED'
                ? 'Invited'
                : item.membershipStatus === 'PENDING'
                  ? 'Pending'
                  : item.role === 'ADMIN'
                    ? 'Admin'
                    : undefined
            }
            unread={isUnread}
            onPress={() => {
              markSeen(item.publicShortId);
              router.push(`/circles/${item.publicShortId}`);
            }}
          />
        );
      }}
    />
  );
}

function Seg({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{selected:active}}
      onPress={onPress}
      style={[
        styles.seg,
        { backgroundColor: active ? colors.bgElevated : 'transparent' },
      ]}
    >
      {active && <BrandGradient />}
      <AppText variant="subhead" color={active ? 'textOnBrand' : 'textMuted'}>
        {label}
      </AppText>
    </Pressable>
  );
}

function Empty({
  icon,
  text,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  text: string;
}) {
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[6],
    paddingTop: spacing[4],
    paddingBottom: spacing[4],
  },
  newBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
    borderRadius: radius.pill,
  },
  segmented: {
    flexDirection: 'row',
    marginHorizontal: spacing[6],
    borderRadius: radius.md,
    padding: 4,
    gap: 4,
  },
  seg: {
    overflow: 'hidden',
    flex: 1,
    paddingVertical: spacing[3],
    borderRadius: radius.sm,
    alignItems: 'center',
  },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    marginHorizontal: spacing[6],
    marginTop: spacing[5],
    height: 44,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth * 2,
    paddingHorizontal: spacing[4],
  },
  searchInput: { flex: 1, padding: 0 },
  catRow: { marginTop: spacing[4] },
  catContent: { paddingHorizontal: spacing[6], gap: spacing[2] },
  catChip: {
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth * 2,
  },
  list: { paddingHorizontal: spacing[6], paddingTop: spacing[5], paddingBottom: 112, gap: spacing[3] },
  sectionLabel: { marginTop: spacing[5], marginBottom: spacing[1] },
  pad: { paddingVertical: spacing[8] },
  empty: {
    alignItems: 'center',
    gap: spacing[4],
    paddingTop: spacing[10],
    paddingHorizontal: spacing[8],
  },
  emptyText: { maxWidth: 300 },
});
