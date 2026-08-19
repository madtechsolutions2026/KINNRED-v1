import React from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '../theme/ThemeContext';

/**
 * Floating pill tab bar.
 *
 * Prototype: `sticky bottom-0 mx-3 mb-3 rounded-full border border-border
 * bg-card/95 backdrop-blur` with a 4-column grid. The active tab's icon sits
 * inside a filled `bg-signal` circle while the label below switches to full
 * foreground colour — the chip, not the label, is what carries the state.
 */
const ICONS = {
  Grid: ['grid-outline', 'grid'],
  Pings: ['chatbubble-ellipses-outline', 'chatbubble-ellipses'],
  Circles: ['people-circle-outline', 'people-circle'],
  MySpace: ['person-outline', 'person'],
};

export default function TabBar({ state, descriptors, navigation }) {
  const { colors, type, radius, space, elevation } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[
        {
          flexDirection: 'row',
          marginHorizontal: space.md,
          // Lift above the home indicator without doubling the gap on Android.
          marginBottom: space.md + (Platform.OS === 'ios' ? insets.bottom * 0.5 : 0),
          borderRadius: radius.pill,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.card,
          overflow: 'hidden',
        },
        elevation(4),
      ]}
    >
      {state.routes.map((route, index) => {
        const { options } = descriptors[route.key];
        const label = options.tabBarLabel ?? route.name;
        const focused = state.index === index;
        const [outline, filled] = ICONS[route.name] ?? ['ellipse-outline', 'ellipse'];
        const badge = options.tabBarBadge;

        const onPress = () => {
          const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
          if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
        };

        return (
          <Pressable
            key={route.key}
            onPress={onPress}
            onLongPress={() => navigation.emit({ type: 'tabLongPress', target: route.key })}
            accessibilityRole="tab"
            accessibilityState={{ selected: focused }}
            accessibilityLabel={options.tabBarAccessibilityLabel ?? label}
            style={({ pressed }) => [
              {
                flex: 1,
                alignItems: 'center',
                justifyContent: 'center',
                gap: 4,
                paddingVertical: 10,
                opacity: pressed ? 0.7 : 1,
              },
            ]}
          >
            <View
              style={{
                width: 36,
                height: 36,
                borderRadius: 18,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: focused ? colors.signal : 'transparent',
              }}
            >
              <Ionicons
                name={focused ? filled : outline}
                size={19}
                color={focused ? colors.signalForeground : colors.mutedForeground}
              />

              {badge != null && badge !== 0 ? (
                <View
                  style={{
                    position: 'absolute',
                    top: 1,
                    right: 1,
                    minWidth: 15,
                    height: 15,
                    paddingHorizontal: 3,
                    borderRadius: 8,
                    backgroundColor: colors.signal,
                    borderWidth: 1.5,
                    borderColor: colors.card,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Text
                    style={[
                      type.badge,
                      { color: colors.signalForeground, fontSize: 8, lineHeight: 10 },
                    ]}
                  >
                    {badge}
                  </Text>
                </View>
              ) : null}
            </View>

            <Text
              numberOfLines={1}
              style={[
                type.navLabel,
                {
                  color: focused ? colors.foreground : colors.mutedForeground,
                  fontWeight: focused ? '600' : '500',
                },
              ]}
            >
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
