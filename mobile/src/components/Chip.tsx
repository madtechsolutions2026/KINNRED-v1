import { StyleSheet, View } from 'react-native';
import { radius, spacing, typeScale } from '@/theme/tokens';
import { useTheme } from '@/theme/theme';
import { AppText } from './AppText';

/** Read-only pill for displaying tags (interests, looking-for). */
export function Chip({ label, tone = 'neutral' }: { label: string; tone?: 'neutral' | 'brand' }) {
  const { colors } = useTheme();
  const brand = tone === 'brand';
  return (
    <View
      style={[
        styles.chip,
        {
          backgroundColor: brand ? colors.brand : colors.surface,
          borderColor: brand ? colors.brand : colors.border,
        },
      ]}
    >
      <AppText
        style={[
          typeScale.subhead,
          { color: brand ? colors.textOnBrand : colors.text },
        ]}
      >
        {label}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth * 2,
  },
});
