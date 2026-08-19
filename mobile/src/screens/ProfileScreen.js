import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

import { useTheme } from '../theme/ThemeContext';
import { useSession } from '../state/SessionContext';
import { gradientFor } from '../theme/colors';
import { users, pings } from '../api/endpoints';

import Card from '../components/Card';
import Badge, { OverlayChip } from '../components/Badge';
import EmptyState from '../components/EmptyState';
import LivePulse from '../components/LivePulse';

/**
 * Profile detail, reached from a Grid tile.
 *
 * The hero photo honours whatever the server sent: when `photosBlurred` is
 * true the client shows the lock treatment and does NOT attempt to fetch a
 * full-resolution key — the server never issued one (CLAUDE.md §2.1).
 */
export default function ProfileScreen({ route, navigation }) {
  const { colors, type, space, radius, layout, overlay, intent, elevation } = useTheme();
  const { isDemo } = useSession();
  const { publicShortId, person: seed } = route.params ?? {};

  const [person, setPerson] = useState(seed ?? null);
  const [loading, setLoading] = useState(!seed);
  const [error, setError] = useState(null);
  const [pinged, setPinged] = useState(false);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    // In demo mode there is no token: the call would 401, fail the refresh and
    // sign the user out mid-browse. The seeded person from the Grid is enough.
    if (isDemo) {
      setLoading(false);
      return undefined;
    }

    let cancelled = false;
    (async () => {
      try {
        const data = await users.byShortId(publicShortId);
        if (!cancelled) setPerson((prev) => ({ ...prev, ...data }));
      } catch (e) {
        // A seeded person from the Grid is enough to render; only surface the
        // error when there is nothing to show at all.
        if (!cancelled && !seed) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [publicShortId, seed, isDemo]);

  const sendPing = useCallback(async () => {
    if (isDemo) {
      setPinged(true);
      return;
    }
    setSending(true);
    try {
      await pings.send(publicShortId, "Hey — saw you on the Grid.");
      setPinged(true);
    } catch (e) {
      setError(e.message);
    } finally {
      setSending(false);
    }
  }, [publicShortId, isDemo]);

  if (loading) return <EmptyState loading title="Loading profile" />;
  if (error && !person) {
    return (
      <EmptyState
        icon="person-remove-outline"
        tone="danger"
        title="Profile unavailable"
        message={error}
        actionLabel="Go back"
        onAction={() => navigation.goBack()}
      />
    );
  }

  const [from, to] = gradientFor(publicShortId ?? '');
  const tags = person.lookingFor ?? [];

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: layout.contentBottomPad }}
      >
        {/* Hero */}
        <View style={{ aspectRatio: 3 / 4, width: '100%', overflow: 'hidden' }}>
          <LinearGradient
            colors={[from, to]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{ position: 'absolute', inset: 0 }}
          />

          {person.photosBlurred ? (
            <View
              style={{
                position: 'absolute',
                inset: 0,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: 'rgba(0,0,0,0.25)',
                gap: space.md,
              }}
            >
              <OverlayChip label="Photos locked" icon="lock-closed" />
              <Text
                style={[
                  type.caption,
                  { color: overlay.white90, textAlign: 'center', maxWidth: 260 },
                ]}
              >
                Photos unlock once {person.displayName} pings you, or accepts your ping.
              </Text>
            </View>
          ) : null}

          {/* Back button floats over the hero */}
          <Pressable
            onPress={() => navigation.goBack()}
            accessibilityRole="button"
            accessibilityLabel="Go back"
            style={({ pressed }) => [
              {
                position: 'absolute',
                top: space.xxl,
                left: space.lg,
                width: 38,
                height: 38,
                borderRadius: 19,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: overlay.scrimLock,
                opacity: pressed ? 0.75 : 1,
              },
            ]}
          >
            <Ionicons name="chevron-back" size={20} color="#FFFFFF" />
          </Pressable>

          <LinearGradient
            colors={[overlay.transparent, overlay.scrimStrong]}
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 0,
              paddingTop: 64,
              padding: layout.screenPaddingX,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
              <Text style={[type.display, { color: '#FFFFFF' }]}>
                {person.displayName}
                {person.age ? <Text style={{ fontWeight: '400', opacity: 0.85 }}>{`, ${person.age}`}</Text> : null}
              </Text>
              {person.isVerified ? (
                <Ionicons name="checkmark-circle" size={19} color={overlay.white90} />
              ) : null}
            </View>

            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: 6 }}>
              {person.online ? <LivePulse size={8} /> : null}
              <Text style={[type.bodySm, { color: overlay.white90 }]}>
                {person.online ? 'Online now · ' : ''}
                {person.distance ?? '—'}
              </Text>
            </View>
          </LinearGradient>
        </View>

        <View style={{ padding: layout.screenPaddingX, gap: space.md }}>
          {tags.length ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
              {tags.map((t) => (
                <Badge key={t} label={pretty(t)} color={intent[pretty(t)]} />
              ))}
            </View>
          ) : null}

          {person.interests?.length ? (
            <Card>
              <Text style={[type.subtitle, { color: colors.foreground, marginBottom: space.sm }]}>
                Interests
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs }}>
                {person.interests.map((i) => (
                  <Badge key={i} label={i} size="sm" />
                ))}
              </View>
            </Card>
          ) : null}

          <Card>
            <View style={{ flexDirection: 'row', gap: space.md, alignItems: 'flex-start' }}>
              <Ionicons name="navigate-outline" size={16} color={colors.signal} style={{ marginTop: 2 }} />
              <Text style={[type.bodySm, { color: colors.mutedForeground, flex: 1 }]}>
                Distance is approximate and rounded into bands. Exact location is never shown, to
                anyone.
              </Text>
            </View>
          </Card>
        </View>
      </ScrollView>

      {/* Sticky ping action */}
      <View
        style={[
          {
            position: 'absolute',
            left: space.md,
            right: space.md,
            bottom: space.lg,
          },
        ]}
      >
        <Pressable
          onPress={sendPing}
          disabled={pinged || sending}
          accessibilityRole="button"
          style={({ pressed }) => [
            {
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: space.sm,
              paddingVertical: space.lg,
              borderRadius: radius.pill,
              backgroundColor: pinged ? colors.muted : colors.signal,
              borderWidth: 1,
              borderColor: pinged ? colors.border : 'transparent',
              opacity: sending ? 0.6 : pressed ? 0.85 : 1,
            },
            elevation(4),
          ]}
        >
          <Ionicons
            name={pinged ? 'checkmark' : 'flash'}
            size={17}
            color={pinged ? colors.mutedForeground : colors.signalForeground}
          />
          <Text
            style={[
              type.title,
              { color: pinged ? colors.mutedForeground : colors.signalForeground },
            ]}
          >
            {pinged ? 'Ping sent' : `Ping ${person.displayName ?? ''}`}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

function pretty(v = '') {
  return String(v)
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}
