import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AppText } from './AppText';
import {
  CATEGORY_LABELS,
  TIER_LABELS,
  type CircleCategory,
  type CircleTier,
} from '@/lib/circles-api';
import { radius, spacing } from '@/theme/tokens';
import { useTheme } from '@/theme/theme';

interface Props {
  name: string;
  description?: string | null;
  tier: CircleTier;
  category: CircleCategory;
  memberCount?: number;
  trailing?: string;
  unread?: boolean;
  onPress: () => void;
}

export function CircleCard({
  name,
  description,
  tier,
  category,
  memberCount,
  trailing,
  unread,
  onPress,
}: Props) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: pressed ? colors.surfaceHover : colors.surface,
          borderColor: unread ? colors.brand : colors.border,
        },
      ]}
    >
      <View style={styles.headerRow}>
        <AppText variant="bodyStrong" numberOfLines={1} style={styles.name}>
          {name}
        </AppText>
        {tier !== 'OPEN' ? (
          <View style={styles.tierPill}>
            <Ionicons
              name={tier === 'INCOGNITO' ? 'eye-off-outline' : 'lock-closed-outline'}
              size={11}
              color={colors.textMuted}
            />
            <AppText variant="caption" color="textMuted">
              {TIER_LABELS[tier]}
            </AppText>
          </View>
        ) : null}
        {unread ? (
          <View style={[styles.dot, { backgroundColor: colors.brand }]} />
        ) : null}
      </View>

      {description ? (
        <AppText variant="footnote" color="textMuted" numberOfLines={2}>
          {description}
        </AppText>
      ) : null}

      <View style={styles.metaRow}>
        <AppText variant="caption" color="textFaint">
          {CATEGORY_LABELS[category]}
        </AppText>
        {memberCount != null ? (
          <AppText variant="caption" color="textFaint">
            · {memberCount} {memberCount === 1 ? 'member' : 'members'}
          </AppText>
        ) : null}
        {trailing ? (
          <AppText variant="caption" color="brand" style={styles.trailing}>
            {trailing}
          </AppText>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: spacing[5],
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth * 2,
    gap: spacing[3],
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  name: { flex: 1 },
  tierPill: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  metaRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 4 },
  trailing: { marginLeft: 'auto' },
});
