import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { useColorScheme } from 'react-native';

import { darkColors, intentPalette, lightColors, overlay, statusPalette } from './colors';
import { fonts, type } from './typography';
import { elevation, layout, radius, space } from './spacing';

const ThemeContext = createContext(null);

/**
 * Theme provider with an explicit override on top of the OS scheme, matching
 * the prototype's header theme toggle.
 *
 * `mode` is the user's choice ('system' | 'light' | 'dark'); `scheme` is the
 * resolved value actually used for rendering. Keeping them separate means
 * "system" keeps tracking the OS after the user has toggled back to it.
 */
export function ThemeProvider({ children, initialMode = 'system' }) {
  const osScheme = useColorScheme();
  const [mode, setMode] = useState(initialMode);

  const scheme = mode === 'system' ? (osScheme === 'dark' ? 'dark' : 'light') : mode;
  const isDark = scheme === 'dark';

  const toggleTheme = useCallback(() => {
    setMode((prev) => {
      const current = prev === 'system' ? (osScheme === 'dark' ? 'dark' : 'light') : prev;
      return current === 'dark' ? 'light' : 'dark';
    });
  }, [osScheme]);

  const value = useMemo(
    () => ({
      mode,
      setMode,
      scheme,
      isDark,
      toggleTheme,
      colors: isDark ? darkColors : lightColors,
      status: isDark ? statusPalette.dark : statusPalette.light,
      intent: intentPalette,
      overlay,
      type,
      fonts,
      space,
      radius,
      layout,
      elevation: (level) => elevation(level, isDark ? '#000000' : '#2A0F07'),
    }),
    [mode, scheme, isDark, toggleTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>');
  return ctx;
}

export default ThemeContext;
