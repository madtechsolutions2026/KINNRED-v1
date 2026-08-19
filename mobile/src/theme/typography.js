import { Platform } from 'react-native';

/**
 * Type scale ported from the prototype.
 *
 * The prototype loads Fraunces (display serif) + Inter (UI sans) from Google
 * Fonts. On web those families resolve through the <link> injected in
 * app.json's `web.head`; on native they fall back to the platform UI face
 * until the font files are bundled, which keeps the app runnable without a
 * font-loading gate on first paint.
 */

const sans = Platform.select({
  web: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  ios: 'System',
  android: 'sans-serif',
  default: 'System',
});

const display = Platform.select({
  web: "Fraunces, ui-serif, Georgia, 'Times New Roman', serif",
  ios: 'Georgia',
  android: 'serif',
  default: 'serif',
});

export const fonts = { sans, display };

/**
 * Tight tracking is a large part of why the prototype reads as "premium".
 * Larger text gets more negative tracking; small caps-y labels get positive
 * tracking instead (the prototype uses 0.16em on the "PHOTOS LOCKED" chip).
 */
export const type = {
  /** Serif page titles — "Circles", "MySpace". */
  display: {
    fontFamily: display,
    fontSize: 26,
    lineHeight: 30,
    fontWeight: '600',
    letterSpacing: -0.6,
  },
  displaySm: {
    fontFamily: display,
    fontSize: 20,
    lineHeight: 25,
    fontWeight: '600',
    letterSpacing: -0.4,
  },
  /** Section headings inside cards. */
  title: {
    fontFamily: sans,
    fontSize: 16,
    lineHeight: 21,
    fontWeight: '600',
    letterSpacing: -0.3,
  },
  subtitle: {
    fontFamily: sans,
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '600',
    letterSpacing: -0.2,
  },
  body: {
    fontFamily: sans,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '400',
    letterSpacing: -0.1,
  },
  bodySm: {
    fontFamily: sans,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '400',
    letterSpacing: -0.1,
  },
  /** Tile name line — 13px/medium in the prototype. */
  tileName: {
    fontFamily: sans,
    fontSize: 13,
    lineHeight: 15,
    fontWeight: '600',
    letterSpacing: -0.2,
  },
  /** Tile meta line — 10px, 90% opacity white. */
  tileMeta: {
    fontFamily: sans,
    fontSize: 10,
    lineHeight: 13,
    fontWeight: '400',
    letterSpacing: 0,
  },
  /** Filter chips and nav labels. */
  chip: {
    fontFamily: sans,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '500',
    letterSpacing: -0.1,
  },
  navLabel: {
    fontFamily: sans,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '500',
    letterSpacing: 0.2,
  },
  caption: {
    fontFamily: sans,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '400',
    letterSpacing: 0,
  },
  /** Tracked-out micro label, e.g. "PHOTOS LOCKED". */
  overline: {
    fontFamily: sans,
    fontSize: 9,
    lineHeight: 12,
    fontWeight: '600',
    letterSpacing: 1.4,
    textTransform: 'uppercase',
  },
  badge: {
    fontFamily: sans,
    fontSize: 10,
    lineHeight: 13,
    fontWeight: '700',
    letterSpacing: 0.1,
  },
};

export default type;
