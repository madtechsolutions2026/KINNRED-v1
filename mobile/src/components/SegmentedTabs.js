import React from 'react';
import { Pressable, Text, View } from 'react-native';

import { useTheme } from '../theme/ThemeContext';

/**
 * Two-or-three way segmented control with a count bubble per segment
 * ("Chats 3" / "Requests 3" in the prototype).
 *
 * The selected segment is a raised `card` tile inside a `muted` track — the
 * same inset-track pattern as iOS's segmented control, which reads more
 * clearly at this size than an underline.
 */
export default function SegmentedTabs({ segments, value, onChange, style }) {
  const { colors, type, radius, space, elevation } = useTheme();

  return (
    <View
      style={[
        {
          flexDirection: 'row',
          padding: 3,
          borderRadius: radius.pill,
          backgroundColor: colors.muted,
          borderWidth: 1,
          borderColor: colors.border,
          gap: 3,
        },
        style,
      ]}
    >
      {segments.map((seg) => {
        const active = seg.value === value;
        return (
          <Pressable
            key={seg.value}
            onPress={() => onChange?.(seg.value)}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            style={({ pressed }) => [
              {
                flex: 1,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: space.xs,
                paddingVertical: 7,
                borderRadius: radius.pill,
                backgroundColor: active ? colors.card : 'transparent',
                opacity: pressed ? 0.8 : 1,
              },
              active ? elevation(1) : null,
            ]}
          >
            <Text
              style={[
                type.chip,
                {
                  color: active ? colors.foreground : colors.mutedForeground,
                  fontWeight: active ? '600' : '500',
                },
              ]}
            >
              {seg.label}
            </Text>

            {seg.count != null ? (
              <View
                style={{
                  minWidth: 18,
                  paddingHorizontal: 5,
                  paddingVertical: 1,
                  borderRadius: radius.pill,
                  backgroundColor: active ? colors.signal : colors.border,
                  alignItems: 'center',
                }}
              >
                <Text
                  style={[
                    type.badge,
                    { color: active ? colors.signalForeground : colors.mutedForeground, fontSize: 9 },
                  ]}
                >
                  {seg.count}
                </Text>
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}
