import React from 'react';
import { Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useTheme } from '../theme/ThemeContext';

/**
 * Persistent, deliberately un-dismissable notice that the screen is showing
 * prototype fixtures rather than server data.
 *
 * Un-dismissable on purpose: demo data that looks like production data is how
 * a screenshot ends up in a review deck as evidence of something that was
 * never actually fetched.
 */
export default function DemoBanner({ message = 'Demo data — API not reachable', style }) {
  const { colors, type, space, radius, status } = useTheme();

  return (
    <View
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.sm,
          marginHorizontal: space.xl,
          paddingHorizontal: space.md,
          paddingVertical: space.sm,
          borderRadius: radius.md,
          backgroundColor: status.warning.bg,
          borderWidth: 1,
          borderColor: status.warning.border,
        },
        style,
      ]}
    >
      <Ionicons name="flask-outline" size={13} color={status.warning.text} />
      <Text style={[type.caption, { color: status.warning.text, flexShrink: 1 }]}>{message}</Text>
    </View>
  );
}
