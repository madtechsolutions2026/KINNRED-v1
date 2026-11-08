import { createContext, useContext, useMemo, useState, useCallback, type ReactNode } from 'react';
import { palette } from './tokens';

/**
 * Semantic colour roles. Screens and components read these — never a raw
 * `palette.*` value — so a single edit here re-themes the whole app and light
 * vs dark stays consistent.
 */
export interface ThemeColors {
  bg: string;
  bgElevated: string;
  surface: string;
  surfaceHover: string;
  border: string;
  borderStrong: string;

  text: string;
  textMuted: string;
  textFaint: string;
  textOnBrand: string;

  brand: string;
  brandSoft: string;
  brandPressed: string;
  accent: string;

  success: string;
  danger: string;
  warning: string;

  /** Fill behind a focused input / selected cell. */
  fieldBg: string;
  fieldBorder: string;
  fieldBorderFocused: string;
}

const darkColors: ThemeColors = {
  bg: palette.ink0,
  bgElevated: palette.ink1,
  surface: palette.ink2,
  surfaceHover: palette.ink3,
  border: palette.ink4,
  borderStrong: palette.ink5,

  text: palette.cloud0,
  textMuted: palette.slate2,
  textFaint: palette.slate0,
  textOnBrand: palette.onBrand,

  brand: palette.rose,
  brandSoft: palette.roseSoft,
  brandPressed: palette.roseDeep,
  accent: palette.amber,

  success: palette.success,
  danger: palette.danger,
  warning: palette.warning,

  fieldBg: palette.ink2,
  fieldBorder: palette.ink4,
  fieldBorderFocused: palette.roseSoft,
};

const lightColors: ThemeColors = {
  bg: '#FFFFFF',
  bgElevated: '#FFFFFF',
  surface: '#FAF8F6',
  surfaceHover: palette.cloud2,
  border: '#E8DED5',
  borderStrong: palette.cloud4,

  text: '#302924',
  textMuted: '#81746A',
  textFaint: '#9A8A7F',
  textOnBrand: palette.onBrand,

  brand: palette.rose,
  brandSoft: '#FFF0E9',
  brandPressed: palette.roseDeep,
  accent: palette.amber,

  success: '#1FA968',
  danger: '#E0353A',
  warning: '#C97C13',

  fieldBg: palette.cloud1,
  fieldBorder: palette.cloud3,
  fieldBorderFocused: palette.rose,
};

export interface Theme {
  scheme: 'light' | 'dark';
  colors: ThemeColors;
  toggleScheme: () => void;
}

const ThemeContext = createContext<Theme>({ scheme: 'light', colors: lightColors, toggleScheme: () => {} });

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [scheme, setScheme] = useState<'light' | 'dark'>('light');
  const toggleScheme = useCallback(() => setScheme((s) => s === 'light' ? 'dark' : 'light'), []);
  const value = useMemo<Theme>(() => ({
    scheme, colors: scheme === 'light' ? lightColors : darkColors, toggleScheme,
  }), [scheme, toggleScheme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  return useContext(ThemeContext);
}
