import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText } from './AppText';
import { fontFamily } from '@/theme/tokens';
import { useTheme } from '@/theme/theme';
export const APP_TABS = [
  { name: 'grid', label: 'Grid', icon: 'grid-outline' },
  { name: 'pings', label: 'Pings', icon: 'mail-outline' },
  { name: 'circles', label: 'Circles', icon: 'people-outline' },
  { name: 'myspace', label: 'Myspace', icon: 'person-outline' },
] as const;
export type AppTab = typeof APP_TABS[number]['name'];
export function FloatingNavigation({ active, onNavigate, badges = {} }: {
  active: string; onNavigate: (name: AppTab) => void; badges?: Partial<Record<AppTab, number>>;
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  return <View pointerEvents="box-none" style={[styles.position, { bottom: Math.max(insets.bottom, 16) }]}>
    <View accessibilityRole="tablist" style={[styles.bar, { backgroundColor: colors.bgElevated, borderColor: colors.border }]}>
      {APP_TABS.map((t) => <Pressable key={t.name} accessibilityRole="tab" accessibilityLabel={t.label}
        accessibilityState={{ selected: active === t.name }} onPress={() => onNavigate(t.name)} style={styles.item}>
        <View style={[styles.icon, { backgroundColor: active === t.name ? colors.brand : 'transparent' }]}>
          <Ionicons name={t.icon} size={19} color={active === t.name ? '#FFFFFF' : colors.textMuted} />
          {!!badges[t.name] && <View style={[styles.badge, { backgroundColor: colors.brand, borderColor: colors.bgElevated }]}>
            <AppText style={styles.badgeText}>{(badges[t.name] ?? 0) > 9 ? '9+' : badges[t.name]}</AppText>
          </View>}
        </View>
        <AppText style={[styles.label, { color: active === t.name ? colors.brand : colors.textMuted }]}>{t.label}</AppText>
      </Pressable>)}
    </View>
  </View>;
}
const styles = StyleSheet.create({
  position: { position: 'absolute', left: 16, right: 16 },
  bar: { height: 72, borderRadius: 38, borderWidth: 1, flexDirection: 'row', paddingHorizontal: 10, paddingVertical: 6, shadowColor: '#6A3B22', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.08, shadowRadius: 16, elevation: 6 },
  item: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 3, minHeight: 44 },
  icon: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  label: { fontFamily: fontFamily.bodyMedium, fontSize: 10, lineHeight: 13 },
  badge: { position: 'absolute', right: -3, top: -2, minWidth: 16, height: 16, borderRadius: 8, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: '#FFFFFF', fontSize: 8, lineHeight: 10 },
});
