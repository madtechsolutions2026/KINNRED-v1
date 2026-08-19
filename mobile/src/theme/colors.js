/**
 * Kinnred design tokens.
 *
 * Ported 1:1 from the Lovable prototype's CSS custom properties
 * (https://interface-whisperer-hubbb.lovable.app/assets/styles-*.css).
 *
 * The prototype authors colours in `oklch()`, which React Native's style
 * engine cannot parse. Every token below is the sRGB hex conversion of the
 * original oklch triplet, so the palette is identical to the web design
 * rather than eyeballed. See LAYOUTS.md for the conversion notes.
 *
 * The palette is a warm terracotta / sand family (hue 27-68), NOT the cool
 * slate family common to generic SaaS dashboards. `signal` is the hot
 * red-orange used for the active tab chip and unread counts; `radar` is the
 * amber "live / online" pulse.
 */

export const lightColors = {
  background: '#FFF8F1',
  foreground: '#460B06',
  ink: '#460B06',
  sand: '#FFEDDB',

  card: '#FFFEFB',
  cardForeground: '#460B06',
  popover: '#FFFEFB',
  popoverForeground: '#460B06',

  primary: '#F1300B',
  primaryForeground: '#FEFBF8',

  secondary: '#FFE3C7',
  secondaryForeground: '#460B06',

  muted: '#FDEBDC',
  mutedForeground: '#885442',

  accent: '#FFC076',
  accentForeground: '#460B06',

  /** Hot accent: active nav chip, unread badges, likes. */
  signal: '#FD1623',
  signalForeground: '#FCFCFC',

  /** Amber "live" pulse used for online dots and the people-count ticker. */
  radar: '#F69300',
  radarForeground: '#310E03',

  destructive: '#E60023',
  destructiveForeground: '#FCFCFC',

  border: '#F5D7C7',
  input: '#F5D7C7',
  ring: '#FD1623',
};

export const darkColors = {
  background: '#1A0B06',
  foreground: '#FCEFE5',
  ink: '#FCEFE5',
  sand: '#1A0B06',

  card: '#30130A',
  cardForeground: '#FCEFE5',
  popover: '#30130A',
  popoverForeground: '#FCEFE5',

  primary: '#FF6600',
  primaryForeground: '#1A0B06',

  secondary: '#442013',
  secondaryForeground: '#FCEFE5',

  muted: '#371F17',
  mutedForeground: '#C8AA96',

  accent: '#832E00',
  accentForeground: '#FEF7F2',

  signal: '#FF5F41',
  signalForeground: '#150A07',

  radar: '#FD9F07',
  radarForeground: '#200B04',

  // The prototype's dark block omits `destructive`, so it inherits :root.
  destructive: '#E60023',
  destructiveForeground: '#FCFCFC',

  border: '#513225',
  input: '#513225',
  ring: '#FF5F41',
};

/**
 * Status pill palettes, keyed by semantic intent.
 *
 * Each entry is a subtle tinted chip: low-alpha fill, matching border, bold
 * text. Alpha-on-hex is used so a single definition reads correctly against
 * both the light `card` and the dark `card` surface.
 */
export const statusPalette = {
  light: {
    positive: { bg: '#1A9E5714', border: '#1A9E5733', text: '#0F7A41' },
    warning: { bg: '#F6930014', border: '#F6930038', text: '#9A5B00' },
    danger: { bg: '#E6002314', border: '#E6002333', text: '#C00A22' },
    neutral: { bg: '#88544214', border: '#8854422E', text: '#885442' },
    info: { bg: '#2563EB14', border: '#2563EB33', text: '#1D4ED8' },
  },
  dark: {
    positive: { bg: '#34D39920', border: '#34D39940', text: '#5EEAD4' },
    warning: { bg: '#FD9F0720', border: '#FD9F0740', text: '#FBBF5E' },
    danger: { bg: '#FF5F4124', border: '#FF5F4145', text: '#FF9E8C' },
    neutral: { bg: '#C8AA9618', border: '#C8AA9633', text: '#C8AA96' },
    info: { bg: '#60A5FA20', border: '#60A5FA40', text: '#93C5FD' },
  },
};

/**
 * Intent tags shown on Grid tiles and Circle cards. The prototype assigns
 * each a distinct hue so the grid reads as varied at a glance.
 */
export const intentPalette = {
  Dating: '#FD1623',
  Friends: '#F69300',
  Activities: '#12A150',
  Networking: '#2563EB',
  Chat: '#8B5CF6',
  Community: '#0EA5E9',
};

/** Fixed overlay scrims — identical in both themes (they sit on photos). */
export const overlay = {
  scrimStrong: 'rgba(0,0,0,0.80)',
  scrimMid: 'rgba(0,0,0,0.35)',
  scrimSoft: 'rgba(0,0,0,0.10)',
  scrimLock: 'rgba(0,0,0,0.45)',
  transparent: 'transparent',
  white90: 'rgba(255,255,255,0.90)',
  white80: 'rgba(255,255,255,0.80)',
  white95: 'rgba(255,255,255,0.95)',
};

/**
 * Deterministic gradient pairs for avatar placeholders. Indexed by a stable
 * hash of the user's public id so a given person always renders the same
 * gradient — matching the prototype, and avoiding the flicker a random
 * gradient would cause on every re-render.
 */
export const avatarGradients = [
  ['#F5C43A', '#B23A6E'],
  ['#3ECFCF', '#5B4BC4'],
  ['#FF9A5B', '#D93A6A'],
  ['#7ED957', '#1E7A5E'],
  ['#8FB8FF', '#3B4CC0'],
  ['#FFB3D1', '#8B3A9E'],
  ['#FFD166', '#E8590C'],
  ['#9BE7C4', '#0F766E'],
];

export function gradientFor(seed = '') {
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) {
    h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return avatarGradients[h % avatarGradients.length];
}

export default { lightColors, darkColors, statusPalette, intentPalette, overlay };
