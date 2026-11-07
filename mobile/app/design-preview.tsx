/** Developer-only fixture screen. Sample profiles never enter the live discovery feed. */
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppText } from '@/components/AppText';
import { PersonCard } from '@/components/PersonCard';
import { DiscoveryToolbar } from '@/components/DiscoveryToolbar';
import { FloatingNavigation } from '@/components/FloatingNavigation';
import { Button } from '@/components/Button';
import { useTheme } from '@/theme/theme';
import type { NearbyPerson } from '@/lib/grid-api';
const samples = [
  ['Kiara', 33, 'women', 44], ['Krish', 28, 'men', 32], ['Aanya', 26, 'women', 68],
  ['Rohan', 29, 'men', 46], ['Rehan', 35, 'men', 11], ['Saanvi', 31, 'women', 65],
  ['Meher', 24, 'women', 47], ['Sana', 23, 'women', 49], ['Dhruv', 34, 'men', 75],
  ['Aditya', 28, 'men', 22], ['Maya', 27, 'women', 32], ['Arjun', 30, 'men', 52],
] as const;
const people: NearbyPerson[] = samples.map(([name, age, group, photo], index) => ({
  publicShortId: 'SAMPLE' + index, displayName: name, age, gender: group === 'women' ? 'FEMALE' : 'MALE',
  isVerified: index % 3 === 0, interests: index === 4 ? ['Live music'] : index === 5 ? ['Coffee'] : [],
  lookingFor: ['FRIENDSHIP'], distance: '2 km', online: index % 4 !== 1, photosBlurred: false,
  photo: { id: String(index), url: 'https://randomuser.me/api/portraits/' + group + '/' + photo + '.jpg', blurred: false },
}));
export default function DesignPreview() {
  const { colors } = useTheme(); const { width } = useWindowDimensions(); const router = useRouter();
  const [active, setActive] = useState('Nearby'); const [selected, setSelected] = useState<NearbyPerson | null>(null);
  if (!__DEV__) return <Redirect href="/" />;
  const shown = active === 'Online' ? people.filter((p) => p.online) : active === 'Nearby' || active === 'Friends' ? people : [];
  return <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
    <DiscoveryToolbar onPings={() => router.push('/pings')} onSearch={() => router.push('/grid')} onFilters={() => router.push('/grid')} />
    <View style={{ height: 44, flexShrink: 0 }}><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
      {['Nearby', 'Online', 'Activities', 'Friends', 'Dating'].map((label) => <Pressable key={label} onPress={() => setActive(label)} accessibilityRole="button" accessibilityLabel={label + ' preview filter'} accessibilityState={{ selected: active === label }} style={[styles.chip, { borderColor: active === label ? colors.brand : colors.border, backgroundColor: active === label ? colors.brand : colors.bgElevated }]}>
        <AppText style={{ fontSize: 11, lineHeight: 16, color: active === label ? '#FFFFFF' : colors.textMuted }}>{label}</AppText>
      </Pressable>)}
    </ScrollView></View>
    <AppText variant="caption" color="textFaint" style={styles.notice}>Design preview · sample profiles</AppText>
    <ScrollView contentContainerStyle={styles.grid} showsVerticalScrollIndicator={false}>
      {!shown.length && <AppText variant="footnote" color="textMuted">These sample profiles are tagged for friendship. Choose Nearby, Online or Friends to see the card layout.</AppText>}
      {shown.map((person) => <PersonCard key={person.publicShortId} person={person} width={(Math.min(width, 480) - 48) / 3} onPress={() => setSelected(person)} />)}
    </ScrollView>
    <FloatingNavigation active="grid" onNavigate={(name) => router.push('/' + name as '/grid')} />
    <Modal visible={!!selected} transparent animationType="fade" onRequestClose={() => setSelected(null)}>
      <View style={styles.modalBackdrop}><View style={[styles.modal, { backgroundColor: colors.bg }]}>
        <AppText variant="headline">{selected?.displayName} · sample profile</AppText>
        <AppText variant="footnote" color="textMuted">This screen previews the design using sample portraits. Real profiles and privacy rules are handled by the live Grid.</AppText>
        <Button label="Back to preview" onPress={() => setSelected(null)} />
      </View></View>
    </Modal>
  </SafeAreaView>;
}
const styles = StyleSheet.create({
  chips: { paddingHorizontal: 16, gap: 7, alignItems: 'center' },
  chip: { borderWidth: 1, borderRadius: 20, paddingHorizontal: 17, height: 34, justifyContent: 'center' },
  notice: { marginHorizontal: 16, marginTop: 7, marginBottom: 5, fontSize: 9 },
  grid: { paddingHorizontal: 16, paddingTop: 6, paddingBottom: 112, flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  modal: { maxWidth: 360, width: '100%', padding: 24, borderRadius: 24, gap: 20 },
});
