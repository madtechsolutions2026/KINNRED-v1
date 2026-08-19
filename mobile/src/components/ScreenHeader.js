import React from 'react';
import { Text, View } from 'react-native';

import { useTheme } from '../theme/ThemeContext';
import IconButton from './IconButton';

/**
 * Sticky top bar: `bg-background/85 px-5 pb-3 pt-6 backdrop-blur`.
 *
 * A translucent + blurred bar is only honest when content actually scrolls
 * under it, so this stays a solid `background` fill — on web the prototype's
 * blur reads as a subtle tint, and a flat fill at the same colour is
 * indistinguishable without the performance cost of a real backdrop filter.
 */
export default function ScreenHeader({
  title,
  subtitle,
  actions = [],
  right,
  children,
  style,
}) {
  const { colors, type, space, layout } = useTheme();

  return (
    <View
      style={[
        {
          paddingHorizontal: layout.screenPaddingX,
          paddingTop: space.xxl,
          paddingBottom: space.md,
          backgroundColor: colors.background,
        },
        style,
      ]}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: space.md,
        }}
      >
        <View style={{ flexShrink: 1 }}>
          {title ? (
            <Text numberOfLines={1} style={[type.display, { color: colors.foreground }]}>
              {title}
            </Text>
          ) : null}
          {subtitle ? (
            <Text
              numberOfLines={1}
              style={[type.caption, { color: colors.mutedForeground, marginTop: 2 }]}
            >
              {subtitle}
            </Text>
          ) : null}
        </View>

        {right ?? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
            {
              // `key` is destructured OUT before the spread: React 19 treats a
              // spread that still carries `key` as an error, not a warning, and
              // every call site passes one. Writing key= first does not help —
              // the spread comes after and re-adds it.
              actions.map(({ key, ...action }) => (
                <IconButton key={key ?? action.name} {...action} />
              ))}
          </View>
        )}
      </View>

      {children ? <View style={{ marginTop: space.lg }}>{children}</View> : null}
    </View>
  );
}
