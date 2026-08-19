import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useTheme } from '../theme/ThemeContext';

/**
 * The 40px circular icon button used across the header row.
 *
 * Matches `grid h-10 w-10 place-items-center rounded-full border border-border
 * bg-card` from the prototype, plus an optional count badge pinned to the
 * top-right corner (the "likes you received" affordance).
 */
export default function IconButton({
  name,
  onPress,
  badge,
  tone = 'default', // 'default' | 'signal'
  accessibilityLabel,
  size = 40,
  style,
}) {
  const { colors, type, elevation } = useTheme();
  const tint = tone === 'signal' ? colors.signal : colors.foreground;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      hitSlop={6}
      style={({ pressed }) => [
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: colors.card,
          borderWidth: 1,
          borderColor: colors.border,
          opacity: pressed ? 0.72 : 1,
          transform: [{ scale: pressed ? 0.95 : 1 }],
        },
        elevation(1),
        style,
      ]}
    >
      <Ionicons name={name} size={size * 0.45} color={tint} />

      {badge != null && badge > 0 ? (
        <View
          style={{
            position: 'absolute',
            top: -2,
            right: -2,
            minWidth: 16,
            height: 16,
            paddingHorizontal: 4,
            borderRadius: 8,
            backgroundColor: colors.signal,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={[type.badge, { color: colors.signalForeground, fontSize: 9, lineHeight: 12 }]}>
            {badge > 99 ? '99+' : badge}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}
