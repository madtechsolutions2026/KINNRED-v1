import { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, TextInput, View, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { PersonCard } from '@/components/PersonCard';
import { DiscoveryToolbar } from '@/components/DiscoveryToolbar';
import { GridFilterSheet } from '@/components/GridFilterSheet';
import { useGrid } from '@/lib/useGrid';
import { usePings } from '@/lib/pings';
import type { NearbyFilters } from '@/lib/grid-api';
import type { LookingFor } from '@/lib/users-api';
import { fontFamily } from '@/theme/tokens';
import { useTheme } from '@/theme/theme';

const QUICK_FILTERS: { label: string; value?: LookingFor; online?: boolean }[] = [
  { label: 'Nearby' }, { label: 'Online', online: true },
  { label: 'Activities', value: 'ACTIVITY_PARTNERS' }, { label: 'Friends', value: 'FRIENDSHIP' },
  { label: 'Dating', value: 'DATING' }, { label: 'Networking', value: 'NETWORKING' },
];
export default function GridScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const g = useGrid();
  const { badgeCount } = usePings();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const cardWidth = (Math.min(width, 480) - 48) / 3;
  const people = useMemo(() => g.people.filter((p) => !query.trim() ||
    (p.displayName ?? '').toLowerCase().includes(query.trim().toLowerCase()) ||
    p.interests.some((v) => v.toLowerCase().includes(query.trim().toLowerCase()))), [g.people, query]);
  function selectFilter(f: typeof QUICK_FILTERS[number]) {
    const next: NearbyFilters = { ...g.filters, onlineOnly: f.online || undefined, lookingFor: f.value ? [f.value] : undefined };
    g.setFilters(next);
  }
  return <SafeAreaView edges={['top']} style={[styles.safe, { backgroundColor: colors.bg }]}>
    <DiscoveryToolbar onPings={() => router.push('/pings')} pingCount={badgeCount}
      onSearch={() => { setSearchOpen((v) => !v); setQuery(''); }} onFilters={() => setFiltersOpen(true)} filterCount={g.activeFilterCount} />
    {searchOpen && <View style={[styles.search, { borderColor: colors.border, backgroundColor: colors.bgElevated }]}>
      <Ionicons name="search-outline" size={17} color={colors.textMuted} />
      <TextInput accessibilityLabel="Search these people" placeholder="Search these people" placeholderTextColor={colors.textFaint}
        value={query} onChangeText={setQuery} autoFocus style={[styles.searchInput, { color: colors.text }]} />
      <Pressable accessibilityRole="button" accessibilityLabel="Close search" onPress={() => { setSearchOpen(false); setQuery(''); }} hitSlop={8}>
        <Ionicons name="close" size={18} color={colors.textMuted} />
      </Pressable>
    </View>}
    <View style={styles.chipArea}><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
      {QUICK_FILTERS.map((f) => {
        const active = f.online ? !!g.filters.onlineOnly : f.value ? g.filters.lookingFor?.length === 1 && g.filters.lookingFor[0] === f.value && !g.filters.onlineOnly : !g.filters.onlineOnly && !g.filters.lookingFor?.length;
        return <Pressable key={f.label} hitSlop={{ top: 5, bottom: 5 }} accessibilityRole="button" accessibilityLabel={f.label + ' filter'} accessibilityState={{ selected: active }} onPress={() => selectFilter(f)}
          style={[styles.chip, { backgroundColor: active ? colors.brand : colors.bgElevated, borderColor: active ? colors.brand : colors.border }]}>
          <AppText style={[styles.chipText, { color: active ? colors.textOnBrand : colors.textMuted }]}>{f.label}</AppText>
        </Pressable>;
      })}
    </ScrollView></View>
    {g.phase === 'locating' ? <View style={styles.center}><ActivityIndicator color={colors.brand} /><AppText variant="footnote" color="textMuted">Finding people nearby…</AppText></View> :
    g.phase === 'need-location' || g.phase === 'error' ? <View style={styles.center}>
      <View style={[styles.emptyIcon, { backgroundColor: colors.surface }]}><Ionicons name={g.phase === 'error' ? 'cloud-offline-outline' : 'location-outline'} size={28} color={colors.brand} /></View>
      <AppText variant="headline" align="center">{g.phase === 'error' ? 'Let’s reconnect' : 'Your people are nearby'}</AppText>
      <AppText variant="footnote" color="textMuted" align="center" style={styles.message}>{g.message}</AppText>
      <Button label={g.phase === 'error' ? 'Try again' : 'Enable location'} fullWidth={false} onPress={g.retry} />
      {__DEV__ && <Button label="Use demo location" variant="ghost" fullWidth={false} onPress={g.useDemoLocation} />}
    </View> : <FlatList data={people} keyExtractor={(p) => p.publicShortId} numColumns={3}
      columnWrapperStyle={styles.row} contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={g.refreshing} onRefresh={g.refresh} tintColor={colors.brand} />}
      onEndReached={g.loadMore} onEndReachedThreshold={0.4}
      ListEmptyComponent={<View style={styles.empty}>
        <View style={[styles.emptyIcon, { backgroundColor: colors.surface }]}><Ionicons name="people-outline" size={28} color={colors.brand} /></View>
        <AppText variant="headline" align="center">Room for a new connection</AppText>
        <AppText variant="footnote" color="textMuted" align="center">{query ? 'No matches in these profiles. Try another name or interest.' : 'No one matches just yet. Try a wider distance or a different filter.'}</AppText>
        <Button label="Adjust filters" variant="secondary" fullWidth={false} onPress={() => setFiltersOpen(true)} />
      </View>}
      ListFooterComponent={g.loadingMore ? <ActivityIndicator color={colors.brand} style={styles.spinner} /> : null}
      renderItem={({ item }) => <PersonCard person={item} width={cardWidth} onPress={() => router.push('/grid/' + item.publicShortId)} />} />}
    <GridFilterSheet visible={filtersOpen} initial={g.filters} onClose={() => setFiltersOpen(false)} onApply={g.setFilters} />
  </SafeAreaView>;
}
const styles = StyleSheet.create({
  safe: { flex: 1 },
  chipArea: { height: 48, flexShrink: 0 },
  chips: { gap: 7, paddingHorizontal: 16, paddingTop: 4, paddingBottom: 8, alignItems: 'center' },
  chip: { minHeight: 34, borderRadius: 20, paddingHorizontal: 17, justifyContent: 'center', borderWidth: 1 },
  chipText: { fontFamily: fontFamily.bodyMedium, fontSize: 11, lineHeight: 16 },
  search: { marginHorizontal: 16, marginBottom: 8, borderWidth: 1, borderRadius: 16, paddingHorizontal: 12, height: 44, flexDirection: 'row', alignItems: 'center', gap: 8 },
  searchInput: { flex: 1, minWidth: 0, fontFamily: fontFamily.body, fontSize: 13, padding: 0 },
  list: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 112 },
  row: { gap: 8, marginBottom: 8 },
  center: { flex: 1, paddingHorizontal: 32, paddingBottom: 100, alignItems: 'center', justifyContent: 'center', gap: 16 },
  message: { maxWidth: 280 },
  emptyIcon: { width: 64, height: 64, borderRadius: 32, justifyContent: 'center', alignItems: 'center' },
  empty: { paddingHorizontal: 16, paddingVertical: 60, alignItems: 'center', gap: 16 },
  spinner: { padding: 20 },
});
