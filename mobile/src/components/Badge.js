import React from 'react';
import { Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useTheme } from '../theme/ThemeContext';

/**
 * Status pill — subtle tinted fill, matching border, bold small text.
 *
 * `tone` selects a semantic palette (positive / warning / danger / neutral /
 * info); `color` overrides it with a raw hex for the intent tags, which have
 * their own per-category hue.
 */
export default function Badge({ label, tone = 'neutral', color, icon, size = 'md', style }) {
  const { status, type, radius } = useTheme();
  const palette = color
    ? { bg: `${color}1A`, border: `${color}38`, text: color }
    : status[tone] ?? status.neutral;

  const compact = size === 'sm';

  return (
    <View
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 4,
          alignSelf: 'flex-start',
          paddingHorizontal: compact ? 6 : 8,
          paddingVertical: compact ? 2 : 3,
          borderRadius: radius.pill,
          backgroundColor: palette.bg,
          borderWidth: 1,
          borderColor: palette.border,
        },
        style,
      ]}
    >
      {icon ? <Ionicons name={icon} size={compact ? 9 : 11} color={palette.text} /> : null}
      <Text
        numberOfLines={1}
        style={[type.badge, { color: palette.text, fontSize: compact ? 9 : 10 }]}
      >
        {label}
      </Text>
    </View>
  );
}

/**
 * The dark translucent chip that sits on top of a photo (distance, "Photos
 * locked"). Always white-on-scrim, so it is theme-independent by design.
 */
export function OverlayChip({ label, icon, style, textStyle }) {
  const { type, radius, overlay } = useTheme();
  return (
    <View
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 4,
          alignSelf: 'flex-start',
          paddingHorizontal: 8,
          paddingVertical: 3,
          borderRadius: radius.pill,
          backgroundColor: overlay.scrimLock,
        },
        style,
      ]}
    >
      {icon ? <Ionicons name={icon} size={10} color={overlay.white95} /> : null}
      <Text style={[type.overline, { color: overlay.white95 }, textStyle]}>{label}</Text>
    </View>
  );
}
