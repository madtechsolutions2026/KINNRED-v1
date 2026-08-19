import React from 'react';
import { Pressable, ScrollView, Text } from 'react-native';

import { useTheme } from '../theme/ThemeContext';

/**
 * Horizontally scrolling pill filter row.
 *
 * Prototype: `rounded-full border px-3.5 py-1.5 text-[12px]`, active state is
 * an inverted chip (`bg-foreground text-background`) rather than a tinted one
 * — that high-contrast flip is what makes the selection obvious at 12px.
 *
 * The row bleeds to the screen edge (negative margin + matching padding) so
 * chips scroll out under the edge instead of stopping short of it.
 */
export default function FilterChips({ options, value, onChange, style }) {
  const { colors, type, radius, space, layout } = useTheme();

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={[{ marginHorizontal: -layout.screenPaddingX, flexGrow: 0 }, style]}
      contentContainerStyle={{
        paddingHorizontal: layout.screenPaddingX,
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.sm,
      }}
    >
      {options.map((opt) => {
        const key = typeof opt === 'string' ? opt : opt.value;
        const label = typeof opt === 'string' ? opt : opt.label;
        const active = key === value;

        return (
          <Pressable
            key={key}
            onPress={() => onChange?.(key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            style={({ pressed }) => [
              {
                paddingHorizontal: 14,
                paddingVertical: 6,
                borderRadius: radius.pill,
                borderWidth: 1,
                borderColor: active ? 'transparent' : colors.border,
                backgroundColor: active ? colors.foreground : colors.card,
                opacity: pressed ? 0.75 : 1,
              },
            ]}
          >
            <Text
              numberOfLines={1}
              style={[
                type.chip,
                { color: active ? colors.background : colors.mutedForeground },
              ]}
            >
              {label}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
