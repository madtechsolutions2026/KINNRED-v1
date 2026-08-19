import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, RefreshControl, Text, View } from 'react-native';

import { useTheme } from '../theme/ThemeContext';
import { useSession } from '../state/SessionContext';
import { grid } from '../api/endpoints';
import { OUTCOME, OUTCOME_MESSAGE, shareCurrentLocation } from '../location/shareLocation';
import { gridMeta, gridPeople } from '../data/fixtures';

import ScreenHeader from '../components/ScreenHeader';
import FilterChips from '../components/FilterChips';
import AvatarTile from '../components/AvatarTile';
import LivePulse from '../components/LivePulse';
import EmptyState from '../components/EmptyState';
import DemoBanner from '../components/DemoBanner';

/**
 * Grid — proximity discovery.
 *
 * Layout (top to bottom): sticky header with 4 icon actions -> filter chip row
 * -> live count ticker -> 3-column tile grid -> privacy footnote.
 */

const FILTERS = [
  { value: 'nearby', label: 'Nearby' },
  { value: 'online', label: 'Online' },
  { value: 'ACTIVITIES', label: 'Activities' },
  { value: 'FRIENDS', label: 'Friends' },
  { value: 'DATING', label: 'Dating' },
  { value: 'NETWORKING', label: 'Networking' },
];

export default function GridScreen({ navigation }) {
  const { colors, type, space, layout, toggleTheme, isDark } = useTheme();
  const { isDemo } = useSession();

  const [filter, setFilter] = useState('nearby');
  const [people, setPeople] = useState([]);
  const [meta, setMeta] = useState({ onlineCount: 0 });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [demoFallback, setDemoFallback] = useState(false);
  const [error, setError] = useState(null);
  /**
   * Whether this mount has already reported a position. Not state: flipping it
   * must not re-run `load`, and it is read inside the same tick it is written.
   */
  const locationShared = useRef(false);

  const load = useCallback(
    async (isRefresh = false) => {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setError(null);

      // Filters map onto the real query contract: `onlineOnly` is a boolean,
      // the intent chips are `lookingFor` enum values, and "nearby" is simply
      // the unfiltered default ordering.
      const params = {};
      if (filter === 'online') params.onlineOnly = true;
      else if (filter !== 'nearby') params.lookingFor = [filter];

      const useFixtures = () => {
        const subset =
          filter === 'nearby'
            ? gridPeople
            : filter === 'online'
              ? gridPeople.filter((p) => p.online)
              : gridPeople.filter((p) => p.lookingFor?.[0]?.toUpperCase() === filter);
        setPeople(subset);
        setMeta(gridMeta);
        setDemoFallback(true);
      };

      // In demo mode there is no token, so an API call would 401, fail the
      // refresh, and force a logout — dropping the user out of demo. Skip it.
      if (isDemo) {
        useFixtures();
        setLoading(false);
        setRefreshing(false);
        return;
      }

      try {
        // Share position BEFORE searching. `/grid/nearby` 404s with "Share your
        // location before searching the Grid" when the caller has no row in
        // user_locations — the search origin is the caller's own point, so
        // there is nothing to measure from. Doing this first turns that 404
        // into a state the user can actually act on.
        if (!locationShared.current) {
          const result = await shareCurrentLocation();
          if (result.outcome !== OUTCOME.SHARED) {
            setError(OUTCOME_MESSAGE[result.outcome]);
            setPeople([]);
            return;
          }
          // Latched for this mount only. The server debounces the write
          // anyway, but re-prompting on every filter tap is its own annoyance.
          locationShared.current = true;
        }

        const data = await grid.nearby(params);
        setPeople(data.results ?? []);
        setMeta({ onlineCount: (data.results ?? []).filter((p) => p.online).length });
        setDemoFallback(false);
      } catch (e) {
        if (e.isNetwork) {
          useFixtures();
        } else {
          setError(e.message);
          setPeople([]);
        }
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [filter, isDemo],
  );

  useEffect(() => {
    load();
  }, [load]);

  const openProfile = useCallback(
    (person) => navigation.navigate('Profile', { publicShortId: person.publicShortId, person }),
    [navigation],
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScreenHeader
        actions={[
          {
            key: 'theme',
            name: isDark ? 'sunny-outline' : 'moon-outline',
            onPress: toggleTheme,
            accessibilityLabel: 'Toggle theme',
          },
          { key: 'likes', name: 'heart', tone: 'signal', badge: 5, accessibilityLabel: 'Likes you received' },
          { key: 'search', name: 'search-outline', accessibilityLabel: 'Search' },
          { key: 'filters', name: 'options-outline', accessibilityLabel: 'Filters' },
        ]}
      >
        <FilterChips options={FILTERS} value={filter} onChange={setFilter} />
      </ScreenHeader>

      {demoFallback ? <DemoBanner style={{ marginBottom: space.sm }} /> : null}

      {/* Live ticker */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.sm,
          paddingHorizontal: layout.screenPaddingX,
          paddingBottom: space.md,
        }}
      >
        <LivePulse size={8} />
        <Text style={[type.caption, { color: colors.mutedForeground }]}>
          <Text style={{ fontWeight: '600', color: colors.foreground }}>{meta.onlineCount}</Text>
          {' people on your wavelength right now'}
        </Text>
      </View>

      <FlatList
        data={people}
        keyExtractor={(item) => item.publicShortId}
        numColumns={layout.gridColumns}
        columnWrapperStyle={{ gap: layout.tileGap }}
        contentContainerStyle={{
          paddingHorizontal: layout.screenPaddingX,
          paddingBottom: layout.contentBottomPad,
          gap: layout.tileGap,
        }}
        showsVerticalScrollIndicator={false}
        renderItem={({ item, index }) => (
          <AvatarTile person={item} index={index} onPress={openProfile} />
        )}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => load(true)}
            tintColor={colors.signal}
          />
        }
        ListEmptyComponent={
          loading ? (
            <EmptyState loading title="Finding people nearby" />
          ) : error ? (
            <EmptyState
              icon="cloud-offline-outline"
              tone="danger"
              title="Couldn't load the Grid"
              message={error}
              actionLabel="Try again"
              onAction={() => load()}
            />
          ) : (
            <EmptyState
              icon="compass-outline"
              title="Nobody here yet"
              message="Widen your filters, or check back when more people are around."
            />
          )
        }
        ListFooterComponent={
          people.length ? (
            <Text
              style={[
                type.caption,
                { color: colors.mutedForeground, textAlign: 'center', paddingTop: space.xl },
              ]}
            >
              Distance is approximate. Exact location is never shown.
            </Text>
          ) : null
        }
      />
    </View>
  );
}
