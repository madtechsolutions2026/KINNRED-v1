import React, { useMemo, useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

import { useTheme } from '../theme/ThemeContext';
import { gradientFor } from '../theme/colors';
import { circleList } from '../data/fixtures';

import ScreenHeader from '../components/ScreenHeader';
import FilterChips from '../components/FilterChips';
import Card from '../components/Card';
import Badge from '../components/Badge';
import EmptyState from '../components/EmptyState';
import DemoBanner from '../components/DemoBanner';

/**
 * Circles — tiered communities.
 *
 * The backend has no `circles` module yet (see src/api/endpoints.js), so this
 * screen renders the prototype fixture unconditionally and says so via the
 * banner. The list/card/tier-badge structure is final; only the data source
 * changes when the module lands.
 */

const CATEGORIES = [
  { value: 'all', label: 'All' },
  { value: 'Activities', label: 'Activities' },
  { value: 'Friends', label: 'Friends' },
  { value: 'Networking', label: 'Networking' },
  { value: 'Community', label: 'Community' },
  { value: 'Dating', label: 'Dating' },
];

/** Privacy tiers map onto status tones: open = positive, gated = warning. */
const TIER = {
  OPEN: { label: 'Public', tone: 'positive', icon: 'earth-outline' },
  INVITE_ONLY: { label: 'Invite only', tone: 'warning', icon: 'key-outline' },
  INCOGNITO: { label: 'Incognito', tone: 'neutral', icon: 'eye-off-outline' },
};

export default function CirclesScreen() {
  const { colors, type, space, layout, radius, intent, isDark, toggleTheme } = useTheme();
  const [category, setCategory] = useState('all');
  const [joined, setJoined] = useState(() => new Set(circleList.filter((c) => c.joined).map((c) => c.id)));

  const data = useMemo(
    () => (category === 'all' ? circleList : circleList.filter((c) => c.category === category)),
    [category],
  );

  const toggleJoin = (id) =>
    setJoined((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const renderCircle = ({ item }) => {
    const tier = TIER[item.tier] ?? TIER.OPEN;
    const [from, to] = gradientFor(item.name);
    const isMember = joined.has(item.id);

    return (
      <Card padded={false} style={{ marginBottom: space.md }}>
        <View style={{ flexDirection: 'row', gap: space.md, padding: space.lg }}>
          {/* Monogram tile */}
          <LinearGradient
            colors={[from, to]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{
              width: 48,
              height: 48,
              borderRadius: radius.md,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text style={[type.displaySm, { color: '#FFFFFF' }]}>{item.name.charAt(0)}</Text>
          </LinearGradient>

          <View style={{ flex: 1, gap: 4 }}>
            <Text numberOfLines={1} style={[type.title, { color: colors.foreground }]}>
              {item.name}
            </Text>
            <Text numberOfLines={2} style={[type.bodySm, { color: colors.mutedForeground }]}>
              {item.description}
            </Text>

            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: space.xs,
                marginTop: 4,
                flexWrap: 'wrap',
              }}
            >
              <Badge label={tier.label} icon={tier.icon} tone={tier.tone} size="sm" />
              <Badge label={item.category} size="sm" color={intent[item.category]} />
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                <Ionicons name="people-outline" size={11} color={colors.mutedForeground} />
                <Text style={[type.caption, { color: colors.mutedForeground }]}>
                  {item.members.toLocaleString()}
                </Text>
              </View>
            </View>
          </View>

          <Pressable
            onPress={() => toggleJoin(item.id)}
            accessibilityRole="button"
            style={({ pressed }) => [
              {
                alignSelf: 'flex-start',
                paddingHorizontal: space.md,
                paddingVertical: 6,
                borderRadius: radius.pill,
                backgroundColor: isMember ? 'transparent' : colors.signal,
                borderWidth: 1,
                borderColor: isMember ? colors.border : 'transparent',
                opacity: pressed ? 0.8 : 1,
              },
            ]}
          >
            <Text
              style={[
                type.chip,
                {
                  color: isMember ? colors.mutedForeground : colors.signalForeground,
                  fontWeight: '600',
                },
              ]}
            >
              {isMember ? 'Leave' : 'Join'}
            </Text>
          </Pressable>
        </View>
      </Card>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScreenHeader
        title="Circles"
        subtitle="Communities nearby"
        actions={[
          {
            key: 'theme',
            name: isDark ? 'sunny-outline' : 'moon-outline',
            onPress: toggleTheme,
            accessibilityLabel: 'Toggle theme',
          },
          { key: 'new', name: 'add', tone: 'signal', accessibilityLabel: 'Create a circle' },
        ]}
      >
        <FilterChips options={CATEGORIES} value={category} onChange={setCategory} />
      </ScreenHeader>

      <DemoBanner
        message="Circles has no backend module yet — showing prototype data"
        style={{ marginBottom: space.md }}
      />

      <FlatList
        data={data}
        keyExtractor={(item) => item.id}
        renderItem={renderCircle}
        contentContainerStyle={{
          paddingHorizontal: layout.screenPaddingX,
          paddingBottom: layout.contentBottomPad,
        }}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <EmptyState
            icon="people-circle-outline"
            title="No circles in this category"
            message="Try another category, or start one of your own."
          />
        }
        ListFooterComponent={
          <Card style={{ marginTop: space.xs }}>
            <View style={{ flexDirection: 'row', gap: space.md, alignItems: 'flex-start' }}>
              <Ionicons name="lock-closed" size={16} color={colors.signal} style={{ marginTop: 2 }} />
              <Text style={[type.bodySm, { color: colors.mutedForeground, flex: 1 }]}>
                A woman&apos;s photos stay locked even in-context — the shared Circle gives a natural
                icebreaker.
              </Text>
            </View>
          </Card>
        }
      />
    </View>
  );
}
