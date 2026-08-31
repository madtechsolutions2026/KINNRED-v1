import type { ReactNode } from 'react';
import { Platform, View, type ViewStyle } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

interface Props {
  children: ReactNode;
  /** Stagger, ms. */
  delay?: number;
  duration?: number;
  style?: ViewStyle;
}

/**
 * Entrance animation for screen content.
 *
 * Native only. On react-native-web both Moti's mount transition and
 * Reanimated layout animations can stall on first paint, leaving content
 * stuck at opacity 0 — so on web this renders a plain, fully-visible View.
 * The web build is a dev preview; native is the shipping target.
 */
export function Reveal({ children, delay = 0, duration = 380, style }: Props) {
  if (Platform.OS === 'web') {
    return <View style={style}>{children}</View>;
  }
  return (
    <Animated.View
      entering={FadeInDown.duration(duration).delay(delay)}
      style={style}
    >
      {children}
    </Animated.View>
  );
}
