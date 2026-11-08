import {
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
} from '@expo-google-fonts/plus-jakarta-sans';
import {
  SpaceGrotesk_500Medium,
  SpaceGrotesk_600SemiBold,
  SpaceGrotesk_700Bold,
} from '@expo-google-fonts/space-grotesk';

/**
 * Font map passed to `useFonts()` in the root layout. Keys here MUST match the
 * `fontFamily.*` strings in tokens.ts — that is the contract that lets the type
 * scale reference fonts by a stable name.
 *
 * Newsreader carries display / headings, matching the approved Figma;
 * Plus Jakarta Sans carries body and UI text (humanist, highly legible at
 * small sizes). Both are chosen for a premium, contemporary feel over the
 * platform defaults.
 */
export const appFonts = {
  Newsreader: require('../../assets/fonts/Newsreader.ttf'),
  LiberationSans: require('../../assets/fonts/LiberationSans-Regular.ttf'),
  'LiberationSans-Bold': require('../../assets/fonts/LiberationSans-Bold.ttf'),
  SpaceGrotesk: SpaceGrotesk_500Medium,
  'SpaceGrotesk-Medium': SpaceGrotesk_500Medium,
  'SpaceGrotesk-SemiBold': SpaceGrotesk_600SemiBold,
  'SpaceGrotesk-Bold': SpaceGrotesk_700Bold,

  PlusJakartaSans: PlusJakartaSans_400Regular,
  'PlusJakartaSans-Medium': PlusJakartaSans_500Medium,
  'PlusJakartaSans-SemiBold': PlusJakartaSans_600SemiBold,
  'PlusJakartaSans-Bold': PlusJakartaSans_700Bold,
} as const;
