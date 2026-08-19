import React from 'react';
import { Image, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

import { useTheme } from '../theme/ThemeContext';
import { gradientFor } from '../theme/colors';
import LivePulse from './LivePulse';
import { OverlayChip } from './Badge';

/**
 * A single person tile in the Grid.
 *
 * Layer order, bottom to top (matching the prototype exactly):
 *   1. deterministic gradient wash  — so an empty/slow tile is never a grey box
 *   2. photo (cover)                — blurred derivative when photos are locked
 *   3. lock scrim + "PHOTOS LOCKED" — only when `photosBlurred`
 *   4. corner affordances           — verified (TL), online pulse (TR)
 *   5. bottom scrim + name/meta     — dark-to-transparent so text stays legible
 *
 * IMPORTANT (CLAUDE.md §2.1/§2.2): this component renders whatever the server
 * decided. It never chooses whether to blur, and `distance` arrives as a
 * pre-bucketed STRING ("<1 km") — there is no numeric distance on the client
 * to format, by design.
 */
export default function AvatarTile({ person, onPress, index = 0 }) {
  const { type, radius, overlay, intent } = useTheme();

  const {
    publicShortId,
    displayName,
    age,
    distance,
    online,
    isVerified,
    photo,
    photosBlurred,
    lookingFor,
  } = person;

  const [from, to] = gradientFor(publicShortId ?? String(index));
  const tag = Array.isArray(lookingFor) ? lookingFor[0] : lookingFor;
  const tagColor = intent[tag] ?? null;

  return (
    <Pressable
      onPress={() => onPress?.(person)}
      accessibilityRole="button"
      accessibilityLabel={`${displayName ?? 'Someone'}${age ? `, ${age}` : ''}, ${distance ?? ''}`}
      style={({ pressed }) => [
        {
          flex: 1,
          aspectRatio: 3 / 4,
          borderRadius: radius.lg,
          overflow: 'hidden',
          opacity: pressed ? 0.85 : 1,
          transform: [{ scale: pressed ? 0.97 : 1 }],
        },
      ]}
    >
      {/* 1. gradient wash */}
      <LinearGradient
        colors={[from, to]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ position: 'absolute', inset: 0 }}
      />

      {/* 2. photo */}
      {photo?.url ? (
        <Image
          source={{ uri: photo.url }}
          resizeMode="cover"
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
        />
      ) : null}

      {/* 3. locked state */}
      {photosBlurred ? (
        <View
          style={{
            position: 'absolute',
            inset: 0,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: 'rgba(0,0,0,0.28)',
          }}
        >
          <OverlayChip label="Photos locked" icon="lock-closed" />
        </View>
      ) : null}

      {/* 4a. verified — top left */}
      {isVerified ? (
        <View style={{ position: 'absolute', top: 8, left: 8 }}>
          <Ionicons name="checkmark-circle" size={16} color={overlay.white90} />
        </View>
      ) : null}

      {/* 4b. online pulse — top right */}
      {online ? (
        <View style={{ position: 'absolute', top: 8, right: 8 }}>
          <LivePulse size={10} withRing />
        </View>
      ) : null}

      {/* 5. bottom scrim + identity */}
      <LinearGradient
        colors={[overlay.transparent, overlay.scrimMid, overlay.scrimStrong]}
        locations={[0, 0.45, 1]}
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          paddingTop: 32,
          padding: 10,
        }}
      >
        <Text numberOfLines={1} style={[type.tileName, { color: '#FFFFFF' }]}>
          {displayName ?? 'Someone'}
          {age ? <Text style={{ fontWeight: '400', opacity: 0.8 }}>{`  ${age}`}</Text> : null}
        </Text>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 }}>
          <Text numberOfLines={1} style={[type.tileMeta, { color: overlay.white90, flexShrink: 1 }]}>
            {distance ?? '—'}
          </Text>
          {tag ? (
            <>
              <Text style={[type.tileMeta, { color: overlay.white90, opacity: 0.6 }]}>·</Text>
              <Text
                numberOfLines={1}
                style={[
                  type.tileMeta,
                  { color: tagColor ? '#FFFFFF' : overlay.white90, flexShrink: 1 },
                ]}
              >
                {prettyIntent(tag)}
              </Text>
            </>
          ) : null}
        </View>
      </LinearGradient>
    </Pressable>
  );
}

/** `LOOKING_FOR` enum values arrive SCREAMING_CASE; the design shows Title Case. */
function prettyIntent(value = '') {
  return String(value)
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}
