import { useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { PersonCard } from '@/components/PersonCard';
import { GridFilterSheet } from '@/components/GridFilterSheet';
import { useGrid } from '@/lib/useGrid';
import { RADIUS_LABELS, DEFAULT_RADIUS } from '@/lib/grid-api';
import { radius, spacing } from '@/theme/tokens';
import { useTheme } from '@/theme/theme';

export default function GridScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const g = useGrid();
  const [filtersOpen, setFiltersOpen] = useState(false);

  const radiusLabel =
    RADIUS_LABELS[g.filters.radiusMeters ?? DEFAULT_RADIUS].toLowerCase();

  return (
    <SafeAreaView
      edges={['top']}
      style={[styles.safe, { backgroundColor: colors.bg }]}
    >
      <View style={styles.header}>
        <View style={styles.headerText}>
          <AppText variant="headline">Grid</AppText>
          <AppText variant="caption" color="textFaint">
            {g.phase === 'ready'
              ? `People ${radiusLabel}`
              : g.phase === 'locating'
                ? 'Finding your area…'
                : 'Location needed'}
          </AppText>
        </View>
        <Pressable
          onPress={() => setFiltersOpen(true)}
          hitSlop={8}
          style={({ pressed }) => [
            styles.filterBtn,
            {
              backgroundColor: pressed ? colors.surfaceHover : colors.surface,
              borderColor: g.activeFilterCount ? colors.brand : colors.border,
            },
          ]}
        >
          <Ionicons name="options-outline" size={18} color={colors.text} />
          {g.activeFilterCount > 0 ? (
            <View style={[styles.badge, { backgroundColor: colors.brand }]}>
              <AppText variant="caption" style={styles.badgeText}>
                {g.activeFilterCount}
              </AppText>
            </View>
          ) : null}
        </Pressable>
      </View>

      {g.phase === 'locating' ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.textMuted} />
        </View>
      ) : g.phase === 'need-location' || g.phase === 'error' ? (
        <View style={styles.center}>
          <Ionicons
            name={g.phase === 'error' ? 'cloud-offline-outline' : 'location-outline'}
            size={30}
            color={colors.textFaint}
          />
          <AppText variant="callout" color="textMuted" align="center" style={styles.msg}>
            {g.message}
          </AppText>
          <View style={styles.actions}>
            <Button label="Try again" fullWidth={false} onPress={g.retry} />
            {__DEV__ ? (
              <Button
                label="Use demo location"
                variant="ghost"
                fullWidth={false}
                onPress={g.useDemoLocation}
              />
            ) : null}
          </View>
        </View>
      ) : (
        <FlatList
          data={g.people}
          keyExtractor={(p) => p.publicShortId}
          numColumns={2}
          columnWrapperStyle={styles.row}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={g.refreshing}
              onRefresh={g.refresh}
              tintColor={colors.textMuted}
            />
          }
          onEndReached={g.loadMore}
          onEndReachedThreshold={0.4}
          ListHeaderComponent={
            <AppText variant="subhead" color="textMuted" style={styles.count}>
              {g.people.length === 0
                ? 'No one matches yet'
                : `${g.people.length}${g.hasMore ? '+' : ''} ${
                    g.people.length === 1 ? 'person' : 'people'
                  } on your wavelength`}
            </AppText>
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="telescope-outline" size={28} color={colors.textFaint} />
              <AppText variant="callout" color="textMuted" align="center" style={styles.msg}>
                Nobody nearby matches these filters. Try widening your distance
                or clearing filters.
              </AppText>
            </View>
          }
          ListFooterComponent={
            g.loadingMore ? (
              <ActivityIndicator
                color={colors.textFaint}
                style={styles.footerSpinner}
              />
            ) : null
          }
          renderItem={({ item }) => (
            <PersonCard
              person={item}
              onPress={() => router.push(`/grid/${item.publicShortId}`)}
            />
          )}
        />
      )}

      <GridFilterSheet
        visible={filtersOpen}
        initial={g.filters}
        onClose={() => setFiltersOpen(false)}
        onApply={g.setFilters}
      />
    </SafeAreaView>
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
  headerText: { gap: 2 },
  filterBtn: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: -5,
    right: -5,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  badgeText: { color: '#fff', fontSize: 10 },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[4],
    padding: spacing[8],
  },
  msg: { maxWidth: 320 },
  actions: { flexDirection: 'row', gap: spacing[3], marginTop: spacing[3], flexWrap: 'wrap', justifyContent: 'center' },
  list: { paddingHorizontal: spacing[6], paddingBottom: spacing[10] },
  row: { gap: spacing[4], marginBottom: spacing[6] },
  count: { marginBottom: spacing[5] },
  empty: { alignItems: 'center', gap: spacing[4], paddingTop: spacing[10] },
  footerSpinner: { paddingVertical: spacing[6] },
});
