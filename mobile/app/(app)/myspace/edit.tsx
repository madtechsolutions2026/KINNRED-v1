import { useMemo, useState } from 'react';
import { Platform, ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { KeyboardAvoidingView } from 'react-native';
import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Field } from '@/components/Field';
import { ScreenHeader } from '@/components/ScreenHeader';
import { SelectChip } from '@/components/SelectChip';
import { TagInput } from '@/components/TagInput';
import { useProfile } from '@/lib/profile';
import {
  updateProfile,
  LOOKING_FOR_LABELS,
  type LookingFor,
} from '@/lib/users-api';
import { ApiError } from '@/lib/api';
import { spacing } from '@/theme/tokens';
import { useTheme } from '@/theme/theme';

const LOOKING_FOR_ORDER: LookingFor[] = [
  'DATING',
  'FRIENDSHIP',
  'NETWORKING',
  'ACTIVITY_PARTNERS',
  'JUST_EXPLORING',
];

const BIO_MAX = 500;
const NAME_MAX = 40;

export default function EditProfileScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const { profile, set } = useProfile();

  const [displayName, setDisplayName] = useState(profile?.displayName ?? '');
  const [bio, setBio] = useState(profile?.bio ?? '');
  const [interests, setInterests] = useState<string[]>(profile?.interests ?? []);
  const [lookingFor, setLookingFor] = useState<LookingFor[]>(
    profile?.lookingFor ?? [],
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = useMemo(() => {
    if (!profile) return false;
    const sameArr = (a: string[], b: string[]) =>
      a.length === b.length && a.every((x, i) => x === b[i]);
    return (
      displayName.trim() !== (profile.displayName ?? '') ||
      bio.trim() !== (profile.bio ?? '') ||
      !sameArr(interests, profile.interests) ||
      !sameArr(lookingFor, profile.lookingFor)
    );
  }, [profile, displayName, bio, interests, lookingFor]);

  const nameTooLong = displayName.trim().length > NAME_MAX;
  const bioTooLong = bio.trim().length > BIO_MAX;
  const canSave = dirty && !saving && !nameTooLong && !bioTooLong;

  const toggleLookingFor = (v: LookingFor) =>
    setLookingFor((cur) =>
      cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v].slice(0, 5),
    );

  async function onSave() {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await updateProfile({
        displayName: displayName.trim() || undefined,
        bio: bio.trim(),
        interests,
        lookingFor,
      });
      set(updated);
      router.back();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Couldn’t save your profile.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.gutter}>
          <ScreenHeader
            title="Edit profile"
            right={
              <AppText
                variant="bodyStrong"
                color={canSave ? 'brand' : 'textFaint'}
                onPress={onSave}
              >
                {saving ? 'Saving…' : 'Save'}
              </AppText>
            }
          />
        </View>

        <ScrollView
          contentContainerStyle={styles.body}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Field
            label="Display name"
            value={displayName}
            onChangeText={setDisplayName}
            placeholder="What people call you"
            maxLength={NAME_MAX + 10}
            counter={{ current: displayName.trim().length, max: NAME_MAX }}
            hint="Doesn’t have to be your real name."
          />

          <View style={styles.gap} />
          <Field
            label="Bio"
            value={bio}
            onChangeText={setBio}
            placeholder="A sentence or two about you"
            multiline
            maxLength={BIO_MAX + 40}
            counter={{ current: bio.trim().length, max: BIO_MAX }}
          />

          <View style={styles.gap} />
          <AppText variant="overline" color="textFaint">
            Interests
          </AppText>
          <View style={styles.smallGap} />
          <TagInput
            value={interests}
            onChange={setInterests}
            placeholder="e.g. climbing, jazz, film"
          />

          <View style={styles.gap} />
          <AppText variant="overline" color="textFaint">
            Looking for
          </AppText>
          <View style={styles.smallGap} />
          <View style={styles.chips}>
            {LOOKING_FOR_ORDER.map((v) => (
              <SelectChip
                key={v}
                label={LOOKING_FOR_LABELS[v]}
                selected={lookingFor.includes(v)}
                onPress={() => toggleLookingFor(v)}
              />
            ))}
          </View>

          {error ? (
            <AppText variant="footnote" color="danger" style={styles.error}>
              {error}
            </AppText>
          ) : null}

          <View style={styles.gap} />
          <Button
            label="Save changes"
            onPress={onSave}
            loading={saving}
            disabled={!canSave}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1 },
  gutter: { paddingHorizontal: spacing[6] },
  body: { paddingHorizontal: spacing[6], paddingBottom: spacing[10] },
  gap: { height: spacing[7] },
  smallGap: { height: spacing[3] },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[3] },
  error: { marginTop: spacing[5] },
});
