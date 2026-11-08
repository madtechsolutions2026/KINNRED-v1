import { useEffect, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { BackButton } from '@/components/BackButton';
import { Chip } from '@/components/Chip';
import { PingComposeSheet } from '@/components/PingComposeSheet';
import {
  getPublicProfile,
  LOOKING_FOR_LABELS,
  type PublicProfile,
} from '@/lib/users-api';
import { usePings } from '@/lib/pings';
import { onRealtime } from '@/lib/realtime';
import { ApiError } from '@/lib/api';
import { radius, spacing } from '@/theme/tokens';
import { useTheme } from '@/theme/theme';

export default function PublicProfileScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const { shortId } = useLocalSearchParams<{ shortId: string }>();
  const { reload: reloadPings } = usePings();
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [composeOpen, setComposeOpen] = useState(false);
  const [pingState, setPingState] = useState<'idle' | 'pending' | 'connected'>(
    'idle',
  );
  const activePhoto = profile?.photos[page] ?? profile?.photos[0] ?? null;
  const { width } = useWindowDimensions();
  const heroSize = Math.round(Math.min(width, 520));

  useEffect(() => {
    if (!shortId) return;
    getPublicProfile(shortId)
      .then(setProfile)
      .catch((e) => {
        setError(
          e instanceof ApiError && e.status === 404
            ? 'This profile isn’t available.'
            : e instanceof ApiError
              ? e.message
              : 'Couldn’t load this profile.',
        );
      });
  }, [shortId]);

  // If they accept the ping while we're still looking at their profile.
  const pingedPingId = useRef<string | null>(null);
  useEffect(() => {
    const off = onRealtime('ping:accepted', (e) => {
      if (e.by.publicShortId === shortId || e.pingId === pingedPingId.current) {
        setPingState('connected');
      }
    });
    return off;
  }, [shortId]);

  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]}>
      <SafeAreaView edges={['top']} style={styles.headerFloat}>
        <BackButton />
      </SafeAreaView>

      {error ? (
        <View style={styles.center}>
          <Ionicons name="person-remove-outline" size={28} color={colors.textFaint} />
          <AppText variant="callout" color="textMuted" align="center">
            {error}
          </AppText>
        </View>
      ) : !profile ? (
        <View style={styles.center}>
          <AppText color="textMuted">Loading…</AppText>
        </View>
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: spacing[11] }}
        >
          {/* Photo hero */}
          <View
            style={[
              styles.hero,
              { width: heroSize, height: heroSize, backgroundColor: colors.surface },
            ]}
          >
            {activePhoto ? (
              <Image
                source={{ uri: activePhoto.url }}
                style={StyleSheet.absoluteFill}
                contentFit="cover"
                blurRadius={profile.photosBlurred ? 26 : 0}
              />
            ) : (
              <View style={styles.center}>
                <AppText variant="display" color="textFaint">
                  {(profile.displayName ?? '?').slice(0, 1).toUpperCase()}
                </AppText>
              </View>
            )}

            {profile.photosBlurred ? (
              <View style={[styles.lockNote, { backgroundColor: colors.bg }]}>
                <Ionicons name="lock-closed" size={13} color={colors.text} />
                <AppText variant="caption" color="textMuted">
                  Photos locked
                </AppText>
              </View>
            ) : null}
          </View>

          {profile.photos.length > 1 ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.thumbs}
            >
              {profile.photos.map((photo, i) => (
                <Pressable
                  key={photo.id}
                  onPress={() => setPage(i)}
                  style={[
                    styles.thumb,
                    {
                      borderColor:
                        i === page ? colors.brand : colors.border,
                    },
                  ]}
                >
                  <Image
                    source={{ uri: photo.url }}
                    style={StyleSheet.absoluteFill}
                    contentFit="cover"
                    blurRadius={profile.photosBlurred ? 14 : 0}
                  />
                </Pressable>
              ))}
            </ScrollView>
          ) : null}

          <View style={styles.body}>
            <View style={styles.nameRow}>
              <AppText variant="title" numberOfLines={1} style={styles.name}>
                {profile.displayName ?? 'Someone nearby'}
              </AppText>
              {profile.isVerified ? (
                <Ionicons name="checkmark-circle" size={20} color={colors.success} />
              ) : null}
            </View>
            <AppText variant="subhead" color="textMuted">
              {profile.age} · {titleCase(profile.gender)}
            </AppText>

            {profile.username ? <AppText variant="caption" color="textFaint">@{profile.username}</AppText> : null}
            {profile.bio ? (
              <Section title="About">
                <AppText variant="body" color="textMuted">
                  {profile.bio}
                </AppText>
              </Section>
            ) : null}

            {profile.interests.length > 0 ? (
              <Section title="Interests">
                <View style={styles.chips}>
                  {profile.interests.map((i) => (
                    <Chip key={i} label={i} />
                  ))}
                </View>
              </Section>
            ) : null}

            {profile.lookingFor.length > 0 ? (
              <Section title="Looking for">
                <View style={styles.chips}>
                  {profile.lookingFor.map((l) => (
                    <Chip key={l} label={LOOKING_FOR_LABELS[l]} tone="brand" />
                  ))}
                </View>
              </Section>
            ) : null}

            <View style={styles.cta}>
              {pingState === 'connected' ? (
                <Button
                  label="Open chat"
                  onPress={() => router.replace('/pings')}
                />
              ) : pingState === 'pending' ? (
                <>
                  <Button label="Ping sent" variant="secondary" disabled onPress={() => {}} />
                  <AppText variant="caption" color="textFaint" align="center">
                    Waiting for {profile.displayName ?? 'them'} to accept.
                  </AppText>
                </>
              ) : (
                <Button label="Ping" onPress={() => setComposeOpen(true)} />
              )}
            </View>
          </View>
        </ScrollView>
      )}

      {profile ? (
        <PingComposeSheet
          visible={composeOpen}
          toPublicShortId={profile.publicShortId}
          toName={profile.displayName ?? 'them'}
          onClose={() => setComposeOpen(false)}
          onSent={({ pingId, state }) => {
            setComposeOpen(false);
            pingedPingId.current = pingId;
            void reloadPings();
            if (state === 'ACCEPTED') {
              setPingState('connected');
              router.push(`/pings/${pingId}`);
            } else {
              setPingState('pending');
            }
          }}
        />
      ) : null}
    </View>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <AppText variant="overline" color="textFaint">
        {title}
      </AppText>
      {children}
    </View>
  );
}

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .split('_')
    .map((w) => w[0]?.toUpperCase() + w.slice(1))
    .join(' ');
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  headerFloat: {
    position: 'absolute',
    top: 0,
    left: 0,
    zIndex: 10,
    paddingHorizontal: spacing[6],
    paddingTop: spacing[3],
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing[4], padding: spacing[8] },
  hero: { overflow: 'hidden', alignSelf: 'center' },
  thumbs: { gap: spacing[3], paddingHorizontal: spacing[6], paddingTop: spacing[4] },
  thumb: {
    width: 64,
    height: 64,
    borderRadius: radius.md,
    borderWidth: 2,
    overflow: 'hidden',
  },
  body: { paddingHorizontal: spacing[6], paddingTop: spacing[6], gap: spacing[3] },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  name: { flexShrink: 1 },
  section: { marginTop: spacing[7], gap: spacing[4] },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[3] },
  lockNote: {
    position: 'absolute',
    top: spacing[8],
    right: spacing[5],
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderRadius: radius.pill,
  },
  cta: { marginTop: spacing[9], gap: spacing[3] },
});
