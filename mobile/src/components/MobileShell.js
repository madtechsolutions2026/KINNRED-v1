import React from 'react';
import { Platform, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { useTheme } from '../theme/ThemeContext';

/**
 * The centred phone-width column the whole prototype lives inside.
 *
 * On web the design is a 440px card floating on a warm radial gradient with a
 * deep soft shadow and a 36px radius. On a real device that framing is just
 * wasted space, so native renders the plain background and lets the app fill
 * the viewport.
 */
export default function MobileShell({ children }) {
  const { colors, isDark, radius, layout, elevation } = useTheme();

  if (Platform.OS !== 'web') {
    return <View style={{ flex: 1, backgroundColor: colors.background }}>{children}</View>;
  }

  // `bg-[radial-gradient(ellipse_at_top, oklch(0.94 0.03 75) 0%, var(--sand) 55%)]`
  // approximated with a vertical linear gradient — RN has no radial primitive,
  // and at this scale the top-to-mid falloff is what actually reads.
  const backdrop = isDark ? ['#241009', colors.sand] : ['#FBEBD2', colors.sand];

  return (
    <LinearGradient colors={backdrop} locations={[0, 0.55]} style={{ flex: 1, alignItems: 'center' }}>
      <View
        style={[
          {
            flex: 1,
            width: '100%',
            maxWidth: layout.shellMaxWidth,
            backgroundColor: colors.background,
            overflow: 'hidden',
          },
          // The rounded floating card only appears once there is room beside it.
          { borderRadius: radius.shell, borderWidth: 1, borderColor: colors.border },
          elevation(5),
        ]}
      >
        {children}
      </View>
    </LinearGradient>
  );
}
