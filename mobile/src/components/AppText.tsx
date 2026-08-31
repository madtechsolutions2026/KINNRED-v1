import { Text, type TextProps, type TextStyle } from 'react-native';
import { typeScale, type TypeVariant } from '@/theme/tokens';
import { useTheme } from '@/theme/theme';

type ColorRole =
  | 'text'
  | 'textMuted'
  | 'textFaint'
  | 'textOnBrand'
  | 'brand'
  | 'danger'
  | 'success';

interface AppTextProps extends TextProps {
  variant?: TypeVariant;
  color?: ColorRole;
  align?: TextStyle['textAlign'];
}

/**
 * The only text primitive in the app. Pick a `variant` from the type scale and
 * a semantic `color` role — never set fontSize/fontFamily/colour inline.
 */
export function AppText({
  variant = 'body',
  color = 'text',
  align,
  style,
  ...rest
}: AppTextProps) {
  const { colors } = useTheme();
  return (
    <Text
      {...rest}
      style={[
        typeScale[variant],
        { color: colors[color], textAlign: align },
        style,
      ]}
    />
  );
}
