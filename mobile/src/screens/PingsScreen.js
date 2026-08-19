import React, { useCallback, useEffect, useState } from 'react';
import {
  FlatList,
  LayoutAnimation,
  Platform,
  Pressable,
  RefreshControl,
  Text,
  UIManager,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useTheme } from '../theme/ThemeContext';
import { useSession } from '../state/SessionContext';
import { pings } from '../api/endpoints';
import { pingChats, pingRequests } from '../data/fixtures';

import ScreenHeader from '../components/ScreenHeader';
import SegmentedTabs from '../components/SegmentedTabs';
import Card from '../components/Card';
import Avatar from '../components/Avatar';
import Badge from '../components/Badge';
import EmptyState from '../components/EmptyState';
import DemoBanner from '../components/DemoBanner';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

/**
 * Pings — the 1:1 lifecycle. `Chats` are ACCEPTED pings; `Requests` are
 * PENDING ones addressed to the acting user, and are the only rows that carry
 * accept/reject actions.
 */
export default function PingsScreen({ navigation }) {
  const { colors, type, space, layout, radius, isDark, toggleTheme, intent } = useTheme();
  const { isDemo } = useSession();

  const [tab, setTab] = useState('chats');
  const [chats, setChats] = useState([]);
  const [requests, setRequests] = useState([]);
  const [expandedId, setExpandedId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [demoFallback, setDemoFallback] = useState(false);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(
    async (isRefresh = false) => {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setError(null);

      const useFixtures = () => {
        setChats(pingChats);
        setRequests(pingRequests);
        setDemoFallback(true);
      };

      // See GridScreen: a tokenless call in demo mode would force a logout.
      if (isDemo) {
        useFixtures();
        setLoading(false);
        setRefreshing(false);
        return;
      }

      try {
        const [c, r] = await Promise.all([pings.chats(), pings.requests()]);
        setChats(c.results ?? c ?? []);
        setRequests(r.results ?? r ?? []);
        setDemoFallback(false);
      } catch (e) {
        if (e.isNetwork) useFixtures();
        else setError(e.message);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [isDemo],
  );

  useEffect(() => {
    load();
  }, [load]);

  const toggleExpand = useCallback((id) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpandedId((prev) => (prev === id ? null : id));
  }, []);

  const decide = useCallback(async (item, action) => {
    setBusyId(item.id);
    // Optimistic: the row leaves the list immediately. On failure it is put
    // back, because silently dropping a pending request is worse than a blip.
    setRequests((prev) => prev.filter((r) => r.id !== item.id));
    try {
      if (action === 'accept') await pings.accept(item.id);
      else await pings.reject(item.id);
      if (action === 'accept') setChats((prev) => [{ ...item, lastMessage: item.message }, ...prev]);
    } catch (e) {
      setRequests((prev) => [item, ...prev]);
      setError(e.message);
    } finally {
      setBusyId(null);
    }
  }, []);

  const data = tab === 'chats' ? chats : requests;

  const renderRow = ({ item }) => {
    const peer = item.peer ?? item;
    const expanded = expandedId === item.id;
    const isRequest = tab === 'requests';

    return (
      <Card
        padded={false}
        onPress={() =>
          isRequest ? toggleExpand(item.id) : navigation.navigate('Chat', { pingId: item.id, peer })
        }
        style={{ marginBottom: space.md }}
      >
        <View style={{ flexDirection: 'row', gap: space.md, padding: space.md }}>
          <Avatar person={peer} size={48} online={peer.online} />

          <View style={{ flex: 1, gap: 3 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
              <Text numberOfLines={1} style={[type.subtitle, { color: colors.foreground, flex: 1 }]}>
                {peer.displayName}
                {peer.age ? (
                  <Text style={{ fontWeight: '400', color: colors.mutedForeground }}>
                    {`, ${peer.age}`}
                  </Text>
                ) : null}
              </Text>
              <Text style={[type.caption, { color: colors.mutedForeground }]}>
                {item.updatedAt}
              </Text>
            </View>

            <Text
              numberOfLines={expanded ? undefined : 2}
              style={[type.bodySm, { color: colors.mutedForeground }]}
            >
              {item.lastMessage ?? item.message}
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
              <Badge label={item.distance} icon="navigate-outline" size="sm" />
              {(item.tags ?? []).map((t) => (
                <Badge key={t} label={t} size="sm" color={intent[t]} />
              ))}
              {item.unread ? (
                <Badge label={`${item.unread} new`} size="sm" tone="danger" />
              ) : null}
              {isRequest ? (
                <Ionicons
                  name={expanded ? 'chevron-up' : 'chevron-down'}
                  size={14}
                  color={colors.mutedForeground}
                  style={{ marginLeft: 'auto' }}
                />
              ) : null}
            </View>
          </View>
        </View>

        {isRequest && expanded ? (
          <View
            style={{
              flexDirection: 'row',
              gap: space.sm,
              paddingHorizontal: space.md,
              paddingBottom: space.md,
            }}
          >
            <ActionButton
              label="Accept"
              icon="checkmark"
              filled
              disabled={busyId === item.id}
              onPress={() => decide(item, 'accept')}
            />
            <ActionButton
              label="Decline"
              icon="close"
              disabled={busyId === item.id}
              onPress={() => decide(item, 'reject')}
            />
          </View>
        ) : null}
      </Card>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScreenHeader
        title="Pings"
        subtitle={tab === 'chats' ? 'Conversations you accepted' : 'People waiting on you'}
        actions={[
          {
            key: 'theme',
            name: isDark ? 'sunny-outline' : 'moon-outline',
            onPress: toggleTheme,
            accessibilityLabel: 'Toggle theme',
          },
        ]}
      >
        <SegmentedTabs
          value={tab}
          onChange={setTab}
          segments={[
            { value: 'chats', label: 'Chats', count: chats.length },
            { value: 'requests', label: 'Requests', count: requests.length },
          ]}
        />
      </ScreenHeader>

      {demoFallback ? <DemoBanner style={{ marginBottom: space.md }} /> : null}

      <FlatList
        data={data}
        keyExtractor={(item) => item.id}
        renderItem={renderRow}
        contentContainerStyle={{
          paddingHorizontal: layout.screenPaddingX,
          paddingBottom: layout.contentBottomPad,
        }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={colors.signal} />
        }
        ListEmptyComponent={
          loading ? (
            <EmptyState loading title="Loading your pings" />
          ) : error ? (
            <EmptyState
              icon="cloud-offline-outline"
              tone="danger"
              title="Couldn't load pings"
              message={error}
              actionLabel="Try again"
              onAction={() => load()}
            />
          ) : tab === 'chats' ? (
            <EmptyState
              icon="chatbubbles-outline"
              title="No conversations yet"
              message="Accepted pings turn into chats. Tap someone on the Grid to start one."
            />
          ) : (
            <EmptyState
              icon="mail-open-outline"
              title="No pending requests"
              message="When someone pings you, it lands here first."
            />
          )
        }
      />
    </View>
  );
}

function ActionButton({ label, icon, onPress, filled, disabled }) {
  const { colors, type, radius, space } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      style={({ pressed }) => [
        {
          flex: 1,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: space.xs,
          paddingVertical: space.sm + 1,
          borderRadius: radius.pill,
          backgroundColor: filled ? colors.signal : colors.card,
          borderWidth: 1,
          borderColor: filled ? 'transparent' : colors.border,
          opacity: disabled ? 0.5 : pressed ? 0.82 : 1,
        },
      ]}
    >
      <Ionicons
        name={icon}
        size={15}
        color={filled ? colors.signalForeground : colors.mutedForeground}
      />
      <Text
        style={[
          type.chip,
          { color: filled ? colors.signalForeground : colors.foreground, fontWeight: '600' },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}
