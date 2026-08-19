import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useTheme } from '../theme/ThemeContext';
import { useSession } from '../state/SessionContext';
import { pings } from '../api/endpoints';

import Avatar from '../components/Avatar';
import EmptyState from '../components/EmptyState';

/**
 * 1:1 chat for an ACCEPTED ping.
 *
 * Bubbles: mine are `signal`-filled and right-aligned; theirs are `card` with
 * a border, left-aligned. The list is inverted so new messages appear at the
 * bottom without a scroll-to-end race on every append.
 */
export default function ChatScreen({ route, navigation }) {
  const { colors, type, space, radius, layout, elevation } = useTheme();
  const { isDemo } = useSession();
  const { pingId, peer = {} } = route.params ?? {};

  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const inputRef = useRef(null);

  const load = useCallback(async () => {
    // See GridScreen: a tokenless call in demo mode would force a logout.
    if (isDemo) {
      setLoading(false);
      return;
    }
    try {
      const data = await pings.messages(pingId);
      setMessages(data.results ?? data ?? []);
      pings.markRead(pingId).catch(() => {});
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [pingId, isDemo]);

  useEffect(() => {
    load();
  }, [load]);

  const send = useCallback(async () => {
    const body = draft.trim();
    if (!body || sending) return;

    // Optimistic append with a temp id, reconciled by the server response.
    const temp = { id: `temp-${Date.now()}`, body, mine: true, pending: true };
    setMessages((prev) => [temp, ...prev]);
    setDraft('');
    setSending(true);

    if (isDemo) {
      // Keep the bubble, drop the pending state — nothing to persist to.
      setMessages((prev) => prev.map((m) => (m.id === temp.id ? { ...m, pending: false } : m)));
      setSending(false);
      return;
    }

    try {
      const saved = await pings.sendMessage(pingId, body);
      setMessages((prev) => prev.map((m) => (m.id === temp.id ? { ...saved, mine: true } : m)));
    } catch (e) {
      setMessages((prev) => prev.map((m) => (m.id === temp.id ? { ...m, failed: true, pending: false } : m)));
      setError(e.message);
    } finally {
      setSending(false);
    }
  }, [draft, pingId, sending, isDemo]);

  const renderBubble = ({ item }) => {
    const mine = item.mine ?? item.isMine;
    return (
      <View
        style={{
          alignSelf: mine ? 'flex-end' : 'flex-start',
          maxWidth: '78%',
          marginBottom: space.sm,
        }}
      >
        <View
          style={{
            paddingHorizontal: space.md,
            paddingVertical: space.sm + 2,
            borderRadius: radius.lg,
            borderBottomRightRadius: mine ? 4 : radius.lg,
            borderBottomLeftRadius: mine ? radius.lg : 4,
            backgroundColor: mine ? colors.signal : colors.card,
            borderWidth: mine ? 0 : 1,
            borderColor: colors.border,
            opacity: item.pending ? 0.6 : 1,
          }}
        >
          <Text style={[type.body, { color: mine ? colors.signalForeground : colors.foreground }]}>
            {item.body}
          </Text>
        </View>
        {item.failed ? (
          <Text style={[type.caption, { color: colors.destructive, marginTop: 2, textAlign: 'right' }]}>
            Not delivered
          </Text>
        ) : null}
      </View>
    );
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.background }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* Chat header */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.md,
          paddingHorizontal: space.lg,
          paddingTop: space.xxl,
          paddingBottom: space.md,
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
          backgroundColor: colors.background,
        }}
      >
        <Pressable
          onPress={() => navigation.goBack()}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          hitSlop={8}
          style={({ pressed }) => [{ opacity: pressed ? 0.6 : 1 }]}
        >
          <Ionicons name="chevron-back" size={22} color={colors.foreground} />
        </Pressable>

        <Avatar person={peer} size={38} online={peer.online} surface={colors.background} />

        <View style={{ flex: 1 }}>
          <Text numberOfLines={1} style={[type.subtitle, { color: colors.foreground }]}>
            {peer.displayName}
            {peer.age ? (
              <Text style={{ fontWeight: '400', color: colors.mutedForeground }}>{`, ${peer.age}`}</Text>
            ) : null}
          </Text>
          <Text style={[type.caption, { color: colors.mutedForeground }]}>
            {peer.online ? 'Online now' : 'Offline'}
          </Text>
        </View>

        <Pressable accessibilityRole="button" accessibilityLabel="More options" hitSlop={8}>
          <Ionicons name="ellipsis-horizontal" size={20} color={colors.mutedForeground} />
        </Pressable>
      </View>

      <FlatList
        data={messages}
        inverted
        keyExtractor={(m) => String(m.id)}
        renderItem={renderBubble}
        contentContainerStyle={{
          paddingHorizontal: layout.screenPaddingX,
          paddingVertical: space.lg,
          flexGrow: 1,
        }}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          loading ? (
            <EmptyState loading title="Loading messages" />
          ) : error ? (
            <EmptyState icon="cloud-offline-outline" tone="danger" title="Couldn't load" message={error} />
          ) : (
            <EmptyState
              icon="chatbubble-outline"
              title="Say something"
              message={`You and ${peer.displayName ?? 'they'} matched. Open with something specific.`}
            />
          )
        }
      />

      {/* Composer */}
      <View
        style={[
          {
            flexDirection: 'row',
            alignItems: 'flex-end',
            gap: space.sm,
            paddingHorizontal: space.md,
            paddingTop: space.sm,
            paddingBottom: space.lg,
            borderTopWidth: 1,
            borderTopColor: colors.border,
            backgroundColor: colors.background,
          },
        ]}
      >
        <TextInput
          ref={inputRef}
          value={draft}
          onChangeText={setDraft}
          placeholder="Message…"
          placeholderTextColor={colors.mutedForeground}
          multiline
          style={[
            type.body,
            {
              flex: 1,
              maxHeight: 110,
              color: colors.foreground,
              backgroundColor: colors.card,
              borderWidth: 1,
              borderColor: colors.border,
              borderRadius: radius.xl,
              paddingHorizontal: space.lg,
              paddingVertical: space.md,
            },
          ]}
        />
        <Pressable
          onPress={send}
          disabled={!draft.trim() || sending}
          accessibilityRole="button"
          accessibilityLabel="Send message"
          style={({ pressed }) => [
            {
              width: 44,
              height: 44,
              borderRadius: 22,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: draft.trim() ? colors.signal : colors.muted,
              opacity: pressed ? 0.85 : 1,
            },
            draft.trim() ? elevation(2) : null,
          ]}
        >
          <Ionicons
            name="arrow-up"
            size={19}
            color={draft.trim() ? colors.signalForeground : colors.mutedForeground}
          />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}
