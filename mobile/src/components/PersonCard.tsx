import { Pressable, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { AppText } from './AppText';
import { fontFamily } from '@/theme/tokens';
import { useTheme } from '@/theme/theme';
import type { NearbyPerson } from '@/lib/grid-api';

export function PersonCard({ person, onPress, width }: {
  person: NearbyPerson; onPress: () => void; width?: number;
}) {
  const { colors } = useTheme();
  const initials = (person.displayName ?? '?').trim().split(/\s+/).slice(0, 2).map((v) => v[0]).join('');
  return <Pressable onPress={onPress} accessibilityRole="button"
    accessibilityLabel={(person.displayName ?? 'Someone nearby') + ', ' + person.age + ', ' + person.distance + (person.online ? ', online' : '') + (person.photosBlurred ? ', photos locked' : '')}
    style={({ pressed }) => [styles.card, { width: width ?? '31%', backgroundColor: colors.surface, transform: [{ scale: pressed ? 0.97 : 1 }] }]}>
    {person.photo ? <Image source={{ uri: person.photo.url }} style={StyleSheet.absoluteFill}
      contentFit="cover" transition={180} blurRadius={person.photosBlurred ? 14 : 0} /> :
      <View style={styles.fallback}><Ionicons name="person-outline" size={28} color={colors.textFaint} /><AppText variant="caption" color="textFaint">{initials}</AppText></View>}
    <LinearGradient colors={['rgba(0,0,0,0.17)', 'transparent', 'rgba(0,0,0,0.82)']}
      locations={[0, 0.4, 1]} style={StyleSheet.absoluteFill} pointerEvents="none" />
    <View style={styles.topRow}>
      <View style={styles.statusIcons}>
        {person.photosBlurred && <Ionicons name="lock-closed-outline" size={13} color="#FFFFFF" />}
        {person.isVerified && <Ionicons name="shield-checkmark-outline" size={13} color="#FFFFFF" />}
      </View>
      {person.online && <View style={styles.online} />}
    </View>
    <View style={styles.caption}>
      {person.interests[0] && <View style={styles.interest}><AppText numberOfLines={1} style={styles.interestText}>{person.interests[0]}</AppText></View>}
      <AppText numberOfLines={1} style={styles.name}>{person.displayName ?? 'Nearby'} <AppText style={styles.age}>{person.age}</AppText></AppText>
    </View>
  </Pressable>;
}
const styles = StyleSheet.create({
  card: { aspectRatio: 0.72, borderRadius: 18, overflow: 'hidden', justifyContent: 'space-between' },
  fallback: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center', gap: 6 },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', padding: 8, alignItems: 'center' },
  statusIcons: { flexDirection: 'row', gap: 4, minHeight: 13 },
  online: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#65D96C', borderWidth: 1, borderColor: '#E9FFE9' },
  caption: { paddingHorizontal: 8, paddingBottom: 10, gap: 4 },
  interest: { alignSelf: 'flex-start', maxWidth: '100%', backgroundColor: 'rgba(0,0,0,0.32)', borderRadius: 4, paddingHorizontal: 4, paddingVertical: 1 },
  interestText: { color: '#FFFFFF', fontSize: 8, lineHeight: 11 },
  name: { fontFamily: fontFamily.bodySemibold, color: '#FFFFFF', fontSize: 11, lineHeight: 16, letterSpacing: -0.2 },
  age: { color: 'rgba(255,255,255,0.86)', fontSize: 10, lineHeight: 16, fontFamily: fontFamily.body },
});
