import { Platform, StyleSheet, Switch, View } from 'react-native';
import { spacing } from '@/theme/tokens';
import { useTheme } from '@/theme/theme';
import { AppText } from './AppText';

interface Props {
  label: string;
  description?: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
  disabled?: boolean;
}

export function SettingRow({
  label,
  description,
  value,
  onValueChange,
  disabled,
}: Props) {
  const { colors } = useTheme();
  return (
    <View style={styles.row}>
      <View style={styles.text}>
        <AppText variant="bodyStrong">{label}</AppText>
        {description ? (
          <AppText variant="footnote" color="textMuted" style={styles.desc}>
            {description}
          </AppText>
        ) : null}
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        trackColor={{ false: colors.borderStrong, true: colors.brand }}
        thumbColor={Platform.OS === 'android' ? colors.bg : undefined}
        ios_backgroundColor={colors.borderStrong}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing[5],
    paddingVertical: spacing[4],
  },
  text: { flex: 1, gap: 2 },
  desc: { marginTop: 2 },
});
