import React from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useTheme } from '../theme/ThemeContext';

/**
 * One component for the three non-content states a list can be in: loading,
 * error, and genuinely empty. Keeping them together stops each screen from
 * inventing its own spacing and tone.
 */
export default function EmptyState({
  icon = 'sparkles-outline',
  title,
  message,
  actionLabel,
  onAction,
  loading = false,
  tone = 'neutral',
}) {
  const { colors, type, space, radius, status } = useTheme();
  const accent = tone === 'danger' ? status.danger.text : colors.mutedForeground;

  return (
    <View
      style={{
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 56,
        paddingHorizontal: space.xxl,
        gap: space.md,
      }}
    >
      {loading ? (
        <ActivityIndicator color={colors.signal} />
      ) : (
        <View
          style={{
            width: 52,
            height: 52,
            borderRadius: 26,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: colors.muted,
            borderWidth: 1,
            borderColor: colors.border,
          }}
        >
          <Ionicons name={icon} size={22} color={accent} />
        </View>
      )}

      {title ? (
        <Text style={[type.subtitle, { color: colors.foreground, textAlign: 'center' }]}>
          {title}
        </Text>
      ) : null}

      {message ? (
        <Text
          style={[
            type.bodySm,
            { color: colors.mutedForeground, textAlign: 'center', maxWidth: 280 },
          ]}
        >
          {message}
        </Text>
      ) : null}

      {actionLabel && onAction ? (
        <Pressable
          onPress={onAction}
          accessibilityRole="button"
          style={({ pressed }) => [
            {
              marginTop: space.xxs,
              paddingHorizontal: space.lg,
              paddingVertical: space.sm,
              borderRadius: radius.pill,
              backgroundColor: colors.signal,
              opacity: pressed ? 0.82 : 1,
            },
          ]}
        >
          <Text style={[type.chip, { color: colors.signalForeground, fontWeight: '600' }]}>
            {actionLabel}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}
