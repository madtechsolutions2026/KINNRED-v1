import { Platform, type TextStyle } from 'react-native';

/**
 * Kills the default browser focus ring on text inputs in the web build. The
 * app draws its own focus affordance (animated border), so the native outline
 * is just visual noise. No-op on native.
 */
export const noWebOutline = (
  Platform.OS === 'web' ? { outlineStyle: 'none' } : null
) as TextStyle | null;
