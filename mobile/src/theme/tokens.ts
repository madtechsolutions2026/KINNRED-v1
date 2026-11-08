/**
 * Raw design tokens for Kinnred mobile.
 *
 * Values are hand-picked hex (not derived from a Tailwind/config system) so
 * they live here as the single source of truth. Screens never hardcode a
 * colour or a pixel gap — they read from `useTheme()` (see theme.tsx) and the
 * scales below.
 *
 * The reference design uses warm light surfaces with an optional dark theme.
 */

export const palette = {
  // Neutrals — near-black through to off-white.
  ink0: '#0B0B0F',
  ink1: '#101017',
  ink2: '#15151D',
  ink3: '#1C1C26',
  ink4: '#262631',
  ink5: '#33333F',
  ink6: '#4A4A57',

  cloud0: '#FFFFFF',
  cloud1: '#F7F7F9',
  cloud2: '#EFEFF2',
  cloud3: '#E3E3E8',
  cloud4: '#D2D2DA',

  slate0: '#6B6B76',
  slate1: '#8A8A95',
  slate2: '#A6A6B0',

  // Brand — a warm rose for connection, with an amber companion for
  // gradients and highlight moments.
  rose: '#FF1A53',
  roseSoft: '#FF8C71',
  roseDeep: '#DE3F2A',
  amber: '#FF7A00',

  // Feedback.
  success: '#3DD68C',
  danger: '#FF5A5F',
  warning: '#FFB23E',

  // Fixed white/black for use on top of brand fills.
  onBrand: '#FFFFFF',
} as const;

/** 4pt spacing scale. Use `spacing[n]`, not raw numbers. */
export const spacing = {
  0: 0,
  1: 2,
  2: 4,
  3: 8,
  4: 12,
  5: 16,
  6: 20,
  7: 24,
  8: 32,
  9: 40,
  10: 48,
  11: 64,
  12: 80,
} as const;

export const radius = {
  sm: 10,
  md: 14,
  lg: 20,
  xl: 28,
  pill: 999,
} as const;

export const fontFamily = {
  display: 'Newsreader',
  displayMedium: 'Newsreader',
  displaySemibold: 'Newsreader',
  displayBold: 'Newsreader',
  body: 'PlusJakartaSans',
  bodyMedium: 'PlusJakartaSans-Medium',
  bodySemibold: 'PlusJakartaSans-SemiBold',
  bodyBold: 'PlusJakartaSans-Bold',
} as const;

/**
 * Text presets. Each is a complete style block — a screen picks a variant and
 * never sets fontSize/lineHeight/letterSpacing itself.
 */
export const typeScale = {
  display: {
    fontFamily: fontFamily.displayBold,
    fontSize: 34,
    lineHeight: 40,
    letterSpacing: -0.6,
  },
  title: {
    fontFamily: fontFamily.displaySemibold,
    fontSize: 26,
    lineHeight: 32,
    letterSpacing: -0.4,
  },
  headline: {
    fontFamily: fontFamily.bodySemibold,
    fontSize: 20,
    lineHeight: 26,
    letterSpacing: -0.2,
  },
  body: {
    fontFamily: fontFamily.body,
    fontSize: 16,
    lineHeight: 24,
    letterSpacing: 0,
  },
  bodyStrong: {
    fontFamily: fontFamily.bodySemibold,
    fontSize: 16,
    lineHeight: 24,
    letterSpacing: 0,
  },
  callout: {
    fontFamily: fontFamily.body,
    fontSize: 15,
    lineHeight: 22,
    letterSpacing: 0,
  },
  subhead: {
    fontFamily: fontFamily.bodyMedium,
    fontSize: 14,
    lineHeight: 20,
    letterSpacing: 0.1,
  },
  footnote: {
    fontFamily: fontFamily.body,
    fontSize: 13,
    lineHeight: 18,
    letterSpacing: 0.1,
  },
  caption: {
    fontFamily: fontFamily.bodyMedium,
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 0.3,
  },
  overline: {
    fontFamily: fontFamily.bodySemibold,
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 1.4,
    textTransform: 'uppercase' as const,
  },
} as const;

export type TypeVariant = keyof typeof typeScale;
