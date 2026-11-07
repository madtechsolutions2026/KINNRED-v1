import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AppText } from './AppText';
import { useTheme } from '@/theme/theme';

type IconName = keyof typeof Ionicons.glyphMap;
export function DiscoveryToolbar({ onPings, onSearch, onFilters, pingCount = 0, filterCount = 0 }: {
  onPings: () => void; onSearch: () => void; onFilters: () => void;
  pingCount?: number; filterCount?: number;
}) {
  const { colors, scheme, toggleScheme } = useTheme();
  function control(icon: IconName, label: string, onPress: () => void, count = 0, accent = false) {
    return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress}
      style={({ pressed }) => [styles.control, { backgroundColor: pressed ? colors.surfaceHover : colors.bgElevated, borderColor: colors.border }]}>
      <Ionicons name={icon} size={20} color={accent ? colors.brand : colors.text} />
      {count > 0 && <View style={[styles.badge, { backgroundColor: colors.brand, borderColor: colors.bg }]}>
        <AppText style={styles.badgeText}>{count > 9 ? '9+' : count}</AppText>
      </View>}
    </Pressable>;
  }
  return <View style={styles.row}>
    {control(scheme === 'light' ? 'moon-outline' : 'sunny-outline', 'Switch to ' + (scheme === 'light' ? 'dark' : 'light') + ' theme', toggleScheme)}
    {control('flash', 'Open pings', onPings, pingCount, true)}
    {control('search-outline', 'Search people', onSearch)}
    {control('options-outline', 'Filter people', onFilters, filterCount)}
  </View>;
}
const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 12, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12 },
  control: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', top: -3, right: -3, minWidth: 18, height: 18, borderRadius: 9, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  badgeText: { fontSize: 9, lineHeight: 12, color: '#FFFFFF' },
});
