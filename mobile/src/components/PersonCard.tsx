import { Pressable, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { AppText } from './AppText';
import { radius, spacing } from '@/theme/tokens';
import { useTheme } from '@/theme/theme';
import type { NearbyPerson } from '@/lib/grid-api';

function initials(name: string | null): string {
  if (!name) return '?';
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

export function PersonCard({
  person,
  onPress,
}: {
  person: NearbyPerson;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  const photo = person.photo;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.card, { opacity: pressed ? 0.85 : 1 }]}
    >
      <View
        style={[
          styles.photoWrap,
          { backgroundColor: colors.surface, borderColor: colors.border },
        ]}
      >
        {photo ? (
          <Image
            source={{ uri: photo.url }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            transition={180}
            blurRadius={person.photosBlurred ? 22 : 0}
          />
        ) : (
          <View style={styles.noPhoto}>
            <AppText variant="title" color="textFaint">
              {initials(person.displayName)}
            </AppText>
          </View>
        )}

        {/* online + lock */}
        <View style={styles.topRow}>
          {person.online ? (
            <View style={[styles.onlineDot, { borderColor: colors.bg }]} />
          ) : (
            <View />
          )}
          {person.photosBlurred ? (
            <View style={[styles.lockPill, { backgroundColor: colors.bg }]}>
              <Ionicons name="lock-closed" size={11} color={colors.text} />
            </View>
          ) : null}
        </View>

        {/* name / age / distance — over a soft scrim so it stays readable */}
        <LinearGradient
          colors={['transparent', 'rgba(0,0,0,0.72)']}
          locations={[0, 1]}
          style={styles.scrim}
          pointerEvents="none"
        >
          <View style={styles.nameLine}>
            <AppText
              variant="bodyStrong"
              numberOfLines={1}
              style={styles.name}
            >
              {person.displayName ?? 'Someone nearby'}
            </AppText>
            {person.isVerified ? (
              <Ionicons name="checkmark-circle" size={14} color="#fff" />
            ) : null}
          </View>
          <AppText variant="caption" style={styles.sub}>
            {person.age} · {person.distance} away
          </AppText>
        </LinearGradient>
      </View>

      {person.interests.length > 0 ? (
        <AppText
          variant="caption"
          color="textFaint"
          numberOfLines={1}
          style={styles.interests}
        >
          {person.interests.slice(0, 3).join(' · ')}
        </AppText>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { width: '48%', gap: spacing[2] },
  photoWrap: {
    width: '100%',
    aspectRatio: 0.82,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth * 2,
    overflow: 'hidden',
    justifyContent: 'space-between',
  },
  noPhoto: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: spacing[3],
  },
  onlineDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
    backgroundColor: '#3DD68C',
  },
  lockPill: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrim: {
    paddingHorizontal: spacing[3],
    paddingTop: spacing[8],
    paddingBottom: spacing[3],
  },
  nameLine: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  name: { flexShrink: 1, color: '#fff' },
  sub: { color: 'rgba(255,255,255,0.85)' },
  interests: { paddingHorizontal: spacing[1], marginTop: 1 },
});
