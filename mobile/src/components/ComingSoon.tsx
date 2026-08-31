import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from './Screen';
import { AppText } from './AppText';
import { radius, spacing } from '@/theme/tokens';
import { useTheme } from '@/theme/theme';

type IconName = keyof typeof Ionicons.glyphMap;

export function ComingSoon({
  icon,
  title,
  blurb,
}: {
  icon: IconName;
  title: string;
  blurb: string;
}) {
  const { colors } = useTheme();
  return (
    <Screen>
      <View style={styles.wrap}>
        <View
          style={[
            styles.badge,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          <Ionicons name={icon} size={30} color={colors.brand} />
        </View>
        <AppText variant="title" align="center">
          {title}
        </AppText>
        <AppText
          variant="callout"
          color="textMuted"
          align="center"
          style={styles.blurb}
        >
          {blurb}
        </AppText>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[5],
  },
  badge: {
    width: 72,
    height: 72,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth * 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing[2],
  },
  blurb: { maxWidth: 300 },
});
