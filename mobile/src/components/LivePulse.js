import React, { useEffect, useRef } from 'react';
import { Animated, Easing, View } from 'react-native';

import { useTheme } from '../theme/ThemeContext';

/**
 * The amber "live" dot with an expanding halo — Tailwind's `animate-ping`.
 *
 * The halo is a sibling that scales 1 -> 2.2 while fading out, looping
 * forever. `useNativeDriver` keeps it on the UI thread (and is a no-op that
 * react-native-web ignores safely), so the pulse never stutters while the
 * grid is scrolling.
 */
export default function LivePulse({ size = 10, color, ringOpacity = 0.6, withRing = false, style }) {
  const { colors, overlay } = useTheme();
  const dotColor = color ?? colors.radar;
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(anim, {
        toValue: 1,
        duration: 1600,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [anim]);

  const scale = anim.interpolate({ inputRange: [0, 1], outputRange: [1, 2.2] });
  const opacity = anim.interpolate({ inputRange: [0, 0.7, 1], outputRange: [ringOpacity, 0.08, 0] });

  return (
    <View style={[{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }, style]}>
      <Animated.View
        pointerEvents="none"
        style={{
          position: 'absolute',
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: dotColor,
          transform: [{ scale }],
          opacity,
        }}
      />
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: dotColor,
          ...(withRing
            ? { borderWidth: 2, borderColor: overlay.white80 }
            : null),
        }}
      />
    </View>
  );
}
