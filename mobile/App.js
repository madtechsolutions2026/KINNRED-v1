import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ThemeProvider, useTheme } from './src/theme/ThemeContext';
import { SessionProvider } from './src/state/SessionContext';
import RootNavigator from './src/navigation/RootNavigator';

/**
 * Provider order matters: theme is outermost because the session bootstrap
 * screen already renders themed chrome while tokens are being resolved.
 */
export default function App() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <SessionProvider>
          <ThemedStatusBar />
          <RootNavigator />
        </SessionProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

function ThemedStatusBar() {
  const { isDark } = useTheme();
  return <StatusBar style={isDark ? 'light' : 'dark'} />;
}
