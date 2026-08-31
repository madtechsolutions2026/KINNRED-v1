import { Pressable, StyleSheet } from 'react-native';
import { MotiView } from 'moti';
import { radius, spacing, typeScale } from '@/theme/tokens';
import { useTheme } from '@/theme/theme';
import { AppText } from './AppText';

interface Props {
  label: string;
  selected: boolean;
  onPress: () => void;
}

export function SelectChip({ label, selected, onPress }: Props) {
  const { colors } = useTheme();
  return (
    <Pressable onPress={onPress} style={styles.pressable}>
      <MotiView
        animate={{
          backgroundColor: selected ? colors.brand : colors.surface,
          borderColor: selected ? colors.brand : colors.border,
        }}
        transition={{ type: 'timing', duration: 150 }}
        style={styles.chip}
      >
        <AppText
          style={[
            typeScale.subhead,
            { color: selected ? colors.textOnBrand : colors.text },
          ]}
        >
          {label}
        </AppText>
      </MotiView>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pressable: { flexGrow: 1, flexBasis: '47%' },
  chip: {
    minHeight: 48,
    borderRadius: radius.md,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing[5],
  },
});
