import React from 'react';
import { Image, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

import { useTheme } from '../theme/ThemeContext';
import { gradientFor } from '../theme/colors';

/**
 * Circular avatar with the same three-state logic as AvatarTile, at row scale:
 * photo -> locked (gradient + small lock glyph) -> initial on a gradient.
 *
 * `online` adds the amber ring dot at the bottom-right, cut out of the
 * surrounding surface with a border so it reads as a separate layer.
 */
export default function Avatar({ person = {}, size = 48, online = false, surface, style }) {
  const { colors, type, overlay } = useTheme();
  const { displayName, publicShortId, photo, photosBlurred, isVerified } = person;

  const [from, to] = gradientFor(publicShortId ?? displayName ?? '');
  const ringSurface = surface ?? colors.card;

  return (
    <View style={[{ width: size, height: size }, style]}>
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          overflow: 'hidden',
          backgroundColor: colors.muted,
        }}
      >
        <LinearGradient
          colors={[from, to]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{ position: 'absolute', inset: 0 }}
        />

        {photo?.url && !photosBlurred ? (
          <Image
            source={{ uri: photo.url }}
            resizeMode="cover"
            style={{ width: '100%', height: '100%' }}
          />
        ) : (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            {photosBlurred ? (
              <Ionicons name="lock-closed" size={size * 0.3} color={overlay.white90} />
            ) : (
              <Text
                style={[
                  type.subtitle,
                  { color: '#FFFFFF', fontSize: size * 0.36, lineHeight: size * 0.44 },
                ]}
              >
                {(displayName ?? '?').charAt(0).toUpperCase()}
              </Text>
            )}
          </View>
        )}
      </View>

      {/* Verified sits bottom-right, the conventional slot — top-left reads as
          an unread dot, which is a different meaning entirely. */}
      {isVerified ? (
        <View
          style={{
            position: 'absolute',
            right: -2,
            bottom: -2,
            borderRadius: 9,
            backgroundColor: ringSurface,
          }}
        >
          <Ionicons name="checkmark-circle" size={16} color={colors.signal} />
        </View>
      ) : null}

      {/* Online moves to top-right so the two never overlap. */}
      {online ? (
        <View
          style={{
            position: 'absolute',
            right: 0,
            top: 0,
            width: size * 0.24,
            height: size * 0.24,
            borderRadius: size * 0.12,
            backgroundColor: colors.radar,
            borderWidth: 2,
            borderColor: ringSurface,
          }}
        />
      ) : null}
    </View>
  );
}
