import React from 'react';
import { Pressable, View } from 'react-native';

import { useTheme } from '../theme/ThemeContext';

/**
 * The soft modern surface used for every list row and panel.
 *
 * Renders a Pressable with opacity + scale feedback when `onPress` is given,
 * and a plain View otherwise — so a non-interactive card does not advertise a
 * button role to screen readers.
 */
export default function Card({
  children,
  onPress,
  padded = true,
  elevation: level = 2,
  style,
  contentStyle,
  ...rest
}) {
  const { colors, radius, space, elevation } = useTheme();

  const base = [
    {
      backgroundColor: colors.card,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      overflow: 'hidden',
    },
    elevation(level),
    style,
  ];

  const inner = [padded ? { padding: space.lg } : null, contentStyle];

  if (!onPress) {
    return (
      <View style={base} {...rest}>
        <View style={inner}>{children}</View>
      </View>
    );
  }

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [
        ...base,
        { opacity: pressed ? 0.85 : 1, transform: [{ scale: pressed ? 0.995 : 1 }] },
      ]}
      {...rest}
    >
      <View style={inner}>{children}</View>
    </Pressable>
  );
}

/** Hairline divider that respects the theme border token. */
export function Divider({ inset = 0, style }) {
  const { colors } = useTheme();
  return (
    <View
      style={[
        { height: 1, backgroundColor: colors.border, marginLeft: inset, opacity: 0.9 },
        style,
      ]}
    />
  );
}
