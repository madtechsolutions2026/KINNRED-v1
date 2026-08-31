import { useCallback, useEffect, useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { AppText } from '@/components/AppText';
import { Avatar } from '@/components/Avatar';
import { ScreenHeader } from '@/components/ScreenHeader';
import { getMyViewers, type ViewersResult, type Viewer } from '@/lib/users-api';
import { ApiError } from '@/lib/api';
import { relativeTime } from '@/lib/format';
import { radius, spacing } from '@/theme/tokens';
import { useTheme } from '@/theme/theme';

export default function ViewersScreen() {
  const { colors } = useTheme();
  const [result, setResult] = useState<ViewersResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setResult(await getMyViewers());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Couldn’t load your viewers.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]}>
      <View style={styles.gutter}>
        <ScreenHeader title="Who viewed you" />
      </View>

      {error ? (
        <View style={styles.center}>
          <AppText color="danger" align="center">
            {error}
          </AppText>
        </View>
      ) : !result ? (
        <View style={styles.center}>
          <AppText color="textMuted">Loading…</AppText>
        </View>
      ) : result.enabled === false ? (
        <View style={styles.center}>
          <Ionicons name="eye-off-outline" size={28} color={colors.textFaint} />
          <AppText variant="callout" color="textMuted" align="center" style={styles.reason}>
            {result.reason}
          </AppText>
        </View>
      ) : result.viewers.length === 0 ? (
        <View style={styles.center}>
          <AppText color="textMuted" align="center">
            No profile views yet.
          </AppText>
        </View>
      ) : (
        <FlatList
          data={result.viewers}
          keyExtractor={(v) => v.publicShortId}
          contentContainerStyle={styles.list}
          refreshing={refreshing}
          onRefresh={async () => {
            setRefreshing(true);
            await load();
            setRefreshing(false);
          }}
          renderItem={({ item }) => <ViewerRow viewer={item} />}
        />
      )}
    </SafeAreaView>
  );
}

function ViewerRow({ viewer }: { viewer: Viewer }) {
  const { colors } = useTheme();
  return (
    <View
      style={[
        styles.row,
        { backgroundColor: colors.surface, borderColor: colors.border },
      ]}
    >
      <Avatar
        uri={viewer.photo?.url}
        name={viewer.displayName}
        size={48}
        blurred={viewer.photo?.blurred}
      />
      <View style={styles.rowText}>
        <View style={styles.nameLine}>
          <AppText variant="bodyStrong" numberOfLines={1}>
            {viewer.displayName ?? `@${viewer.publicShortId}`}
          </AppText>
          {viewer.isVerified ? (
            <Ionicons name="checkmark-circle" size={13} color={colors.success} />
          ) : null}
        </View>
        <AppText variant="footnote" color="textMuted">
          {viewer.age} · {titleCase(viewer.gender)}
          {viewer.viewCount > 1 ? ` · viewed ${viewer.viewCount}×` : ''}
        </AppText>
      </View>
      <AppText variant="caption" color="textFaint">
        {relativeTime(viewer.lastViewedAt)}
      </AppText>
    </View>
  );
}

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .split('_')
    .map((w) => w[0]?.toUpperCase() + w.slice(1))
    .join(' ');
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  gutter: { paddingHorizontal: spacing[6] },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[4],
    padding: spacing[8],
  },
  reason: { maxWidth: 300 },
  list: { paddingHorizontal: spacing[6], paddingBottom: spacing[10], gap: spacing[3] },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[4],
    padding: spacing[4],
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth * 2,
  },
  rowText: { flex: 1, gap: 2 },
  nameLine: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
});
