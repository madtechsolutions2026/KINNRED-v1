import { View, StyleSheet } from 'react-native';
import { typeScale } from '@/theme/tokens';
import { useTheme } from '@/theme/theme';
import { AppText } from './AppText';

/** Wordmark. The dot is the brand accent — small, deliberate. */
export function Logo({ size = 22 }: { size?: number }) {
  const { colors } = useTheme();
  return (
    <View style={styles.row}>
      <AppText
        style={[
          typeScale.headline,
          { fontSize: size, lineHeight: size * 1.15, color: colors.text },
        ]}
      >
        kinnred
      </AppText>
      <View
        style={[
          styles.dot,
          { backgroundColor: colors.brand, width: size / 5, height: size / 5 },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: 3 },
  dot: { borderRadius: 999, marginBottom: 4 },
});
