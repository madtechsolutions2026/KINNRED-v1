import { useCallback, useState } from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppText } from '@/components/AppText';
import { Avatar } from '@/components/Avatar';
import { Button } from '@/components/Button';
import { Chip } from '@/components/Chip';
import { SettingRow } from '@/components/SettingRow';
import { useAuth } from '@/lib/auth';
import { useProfile } from '@/lib/profile';
import {
  updateSettings,
  LOOKING_FOR_LABELS,
  type MyProfile,
  type UpdateSettingsInput,
} from '@/lib/users-api';
import { ApiError } from '@/lib/api';
import { radius, spacing } from '@/theme/tokens';
import { useTheme } from '@/theme/theme';

export default function MyspaceScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const { signOut } = useAuth();
  const { profile, loading, error, reload, set } = useProfile();

  const [refreshing, setRefreshing] = useState(false);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [settingError, setSettingError] = useState<string | null>(null);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await reload();
    setRefreshing(false);
  }, [reload]);

  const patchSetting = useCallback(
    async (key: string, patch: UpdateSettingsInput, optimistic: MyProfile) => {
      if (!profile) return;
      const prev = profile;
      setSavingKey(key);
      setSettingError(null);
      set(optimistic);
      try {
        set(await updateSettings(patch));
      } catch (e) {
        set(prev);
        setSettingError(
          e instanceof ApiError ? e.message : 'Couldn’t save that change.',
        );
      } finally {
        setSavingKey(null);
      }
    },
    [profile, set],
  );

  if (loading && !profile) {
    return (
      <SafeAreaView style={[styles.center, { backgroundColor: colors.bg }]}>
        <AppText color="textMuted">Loading your profile…</AppText>
      </SafeAreaView>
    );
  }

  if (!profile) {
    return (
      <SafeAreaView style={[styles.center, { backgroundColor: colors.bg }]}>
        <AppText color="danger" align="center">
          {error ?? 'Couldn’t load your profile.'}
        </AppText>
        <View style={{ height: spacing[5] }} />
        <Button label="Retry" fullWidth={false} onPress={() => void reload()} />
      </SafeAreaView>
    );
  }

  const p = profile;
  const cover = p.photos[0]?.url ?? null;
  const name = p.displayName ?? 'Add your name';

  return (
    <SafeAreaView
      edges={['top']}
      style={[styles.safe, { backgroundColor: colors.bg }]}
    >
      <View style={styles.headerRow}>
        <AppText variant="headline">Myspace</AppText>
        <View style={styles.headerActions}>
          <IconButton icon="qr-code-outline" onPress={() => router.push('/myspace/qr')} />
          <IconButton
            icon="pencil-outline"
            onPress={() => router.push('/myspace/edit')}
          />
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.body}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.textMuted}
          />
        }
      >
        {/* Hero */}
        <View style={styles.hero}>
          <Avatar uri={cover} name={p.displayName} size={96} />
          <View style={styles.heroText}>
            <AppText
              variant="title"
              color={p.displayName ? 'text' : 'textFaint'}
              numberOfLines={1}
            >
              {name}
            </AppText>
            <View style={styles.metaRow}>
              <AppText variant="subhead" color="textMuted">
                {p.age} · {titleCase(p.gender)}
              </AppText>
              {p.isVerified ? (
                <View style={styles.verified}>
                  <Ionicons
                    name="checkmark-circle"
                    size={14}
                    color={colors.success}
                  />
                  <AppText variant="caption" color="success">
                    Verified
                  </AppText>
                </View>
              ) : null}
            </View>
            <AppText variant="caption" color="textFaint">
              @{p.publicShortId}
            </AppText>
          </View>
        </View>

        <View style={styles.actions}>
          <Button
            label="Edit profile"
            variant="secondary"
            onPress={() => router.push('/myspace/edit')}
          />
          <Button
            label={p.photos.length ? `Photos · ${p.photos.length}` : 'Add photos'}
            variant="secondary"
            onPress={() => router.push('/myspace/photos')}
          />
        </View>

        {/* Photo strip */}
        {p.photos.length > 0 ? (
          <Pressable
            onPress={() => router.push('/myspace/photos')}
            style={styles.strip}
          >
            {p.photos.slice(0, 4).map((photo) => (
              <Image
                key={photo.id}
                source={{ uri: photo.url }}
                style={[styles.stripImg, { backgroundColor: colors.surface }]}
                contentFit="cover"
                transition={150}
              />
            ))}
          </Pressable>
        ) : null}

        {/* Bio */}
        <Section title="About">
          {p.bio ? (
            <AppText variant="body" color="textMuted">
              {p.bio}
            </AppText>
          ) : (
            <EmptyLine text="Add a short bio so people know who they’re meeting." />
          )}
        </Section>

        {/* Interests */}
        <Section title="Interests">
          {p.interests.length ? (
            <View style={styles.chips}>
              {p.interests.map((i) => (
                <Chip key={i} label={i} />
              ))}
            </View>
          ) : (
            <EmptyLine text="Add interests to sharpen your wavelength matches." />
          )}
        </Section>

        {/* Looking for */}
        <Section title="Looking for">
          {p.lookingFor.length ? (
            <View style={styles.chips}>
              {p.lookingFor.map((l) => (
                <Chip key={l} label={LOOKING_FOR_LABELS[l]} tone="brand" />
              ))}
            </View>
          ) : (
            <EmptyLine text="Tell people what you’re here for." />
          )}
        </Section>

        {/* Privacy */}
        <Section title="Privacy & safety">
          <View
            style={[
              styles.card,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <SettingRow
              label="Lock my photos"
              description="Locked photos show blurred until you ping someone or accept their ping."
              value={p.photosLocked}
              disabled={savingKey === 'lock'}
              onValueChange={(v) =>
                patchSetting('lock', { photosLocked: v }, { ...p, photosLocked: v })
              }
            />
            <Divider />
            <SettingRow
              label="Show me in the Grid"
              description="Turn off to stop appearing in nearby discovery without deleting your account."
              value={p.settings.discoverable}
              disabled={savingKey === 'disc'}
              onValueChange={(v) =>
                patchSetting(
                  'disc',
                  { discoverable: v },
                  { ...p, settings: { ...p.settings, discoverable: v } },
                )
              }
            />
            <Divider />
            <SettingRow
              label="Record my profile views"
              description="Off means you browse without a trace — and your own viewer list is hidden too."
              value={p.settings.recordProfileViews}
              disabled={savingKey === 'rec'}
              onValueChange={(v) =>
                patchSetting(
                  'rec',
                  { recordProfileViews: v },
                  { ...p, settings: { ...p.settings, recordProfileViews: v } },
                )
              }
            />
          </View>
          {settingError ? (
            <AppText variant="footnote" color="danger" style={styles.settingErr}>
              {settingError}
            </AppText>
          ) : null}
        </Section>

        <Pressable
          onPress={() => router.push('/myspace/viewers')}
          style={({ pressed }) => [
            styles.linkRow,
            {
              backgroundColor: pressed ? colors.surfaceHover : colors.surface,
              borderColor: colors.border,
            },
          ]}
        >
          <Ionicons name="eye-outline" size={20} color={colors.textMuted} />
          <AppText variant="bodyStrong" style={styles.linkLabel}>
            Who viewed you
          </AppText>
          <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
        </Pressable>

        <View style={styles.footer}>
          <Button
            label="Sign out"
            variant="ghost"
            onPress={() => void signOut()}
          />
          <AppText variant="caption" color="textFaint" align="center">
            Member since {new Date(p.memberSince).getFullYear()}
          </AppText>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function IconButton({
  icon,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => [
        styles.iconBtn,
        {
          backgroundColor: pressed ? colors.surfaceHover : colors.surface,
          borderColor: colors.border,
        },
      ]}
    >
      <Ionicons name={icon} size={18} color={colors.text} />
    </Pressable>
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

function EmptyLine({ text }: { text: string }) {
  return (
    <AppText variant="footnote" color="textFaint">
      {text}
    </AppText>
  );
}

function Divider() {
  const { colors } = useTheme();
  return (
    <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border }} />
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
  safe: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing[6] },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[6],
    paddingTop: spacing[4],
    paddingBottom: spacing[4],
  },
  headerActions: { flexDirection: 'row', gap: spacing[3] },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth * 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { paddingHorizontal: spacing[6], paddingBottom: spacing[10] },
  hero: { flexDirection: 'row', gap: spacing[5], alignItems: 'center' },
  heroText: { flex: 1, gap: spacing[2] },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[4] },
  verified: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  actions: { flexDirection: 'row', gap: spacing[3], marginTop: spacing[6] },
  strip: { flexDirection: 'row', gap: spacing[3], marginTop: spacing[6] },
  stripImg: { flex: 1, aspectRatio: 1, borderRadius: radius.md },
  section: { marginTop: spacing[8], gap: spacing[4] },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[3] },
  card: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth * 2,
    paddingHorizontal: spacing[5],
  },
  settingErr: { marginTop: spacing[3] },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[4],
    marginTop: spacing[8],
    padding: spacing[5],
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth * 2,
  },
  linkLabel: { flex: 1 },
  footer: { marginTop: spacing[9], gap: spacing[4] },
});
