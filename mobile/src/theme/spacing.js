import { Platform } from 'react-native';

/** Strict 8pt grid, with 4pt half-steps for dense areas (tile gaps, chips). */
export const space = {
  xxs: 4,
  xs: 6,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
};

/** `--radius: 1rem` in the prototype; the rest are its Tailwind steps. */
export const radius = {
  sm: 8,
  md: 12,
  lg: 16, // rounded-2xl / --radius
  xl: 20,
  xxl: 28,
  shell: 36, // sm:rounded-[2.25rem] on the desktop shell
  pill: 999,
};

/**
 * The prototype's mobile shell is a 440px-wide centred column. On web we
 * reproduce it so the layout matches the design at desktop widths; on native
 * the device viewport already is the column.
 */
export const layout = {
  shellMaxWidth: 440,
  screenPaddingX: 20, // px-5
  tileGap: 6, // gap-1.5
  gridColumns: 3,
  tileAspect: 3 / 4,
  tabBarHeight: 64,
  contentBottomPad: 96, // pb-24, clears the floating tab bar
};

/**
 * Layered elevation. React Native's `elevation` (Android) and iOS shadow
 * props do not compose, so each level ships both plus a `boxShadow` string
 * that react-native-web understands for a softer, more accurate web render.
 */
export function elevation(level, shadowColor = '#2A0F07') {
  const levels = {
    0: { e: 0, o: 0, r: 0, y: 0, web: 'none' },
    1: { e: 1, o: 0.05, r: 3, y: 1, web: '0 1px 2px rgba(42,15,7,0.06), 0 1px 3px rgba(42,15,7,0.05)' },
    2: { e: 2, o: 0.07, r: 6, y: 2, web: '0 2px 6px rgba(42,15,7,0.07), 0 1px 2px rgba(42,15,7,0.05)' },
    3: { e: 3, o: 0.09, r: 12, y: 4, web: '0 4px 14px rgba(42,15,7,0.09), 0 2px 4px rgba(42,15,7,0.05)' },
    4: { e: 6, o: 0.12, r: 22, y: 8, web: '0 10px 30px rgba(42,15,7,0.12), 0 3px 8px rgba(42,15,7,0.06)' },
    5: { e: 12, o: 0.2, r: 60, y: 24, web: '0 30px 80px -30px rgba(26,10,40,0.35)' },
  };
  const l = levels[level] ?? levels[2];
  if (Platform.OS === 'web') return { boxShadow: l.web };
  return {
    elevation: l.e,
    shadowColor,
    shadowOpacity: l.o,
    shadowRadius: l.r,
    shadowOffset: { width: 0, height: l.y },
  };
}

export default { space, radius, layout, elevation };
