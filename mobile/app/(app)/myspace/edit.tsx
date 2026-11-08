import { useMemo, useState } from "react";
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { KeyboardAvoidingView } from "react-native";
import { AppText } from "@/components/AppText";
import { Avatar } from "@/components/Avatar";
import { Button } from "@/components/Button";
import { Field } from "@/components/Field";
import { ScreenHeader } from "@/components/ScreenHeader";
import { SelectChip } from "@/components/SelectChip";
import { TagInput } from "@/components/TagInput";
import { useProfile } from "@/lib/profile";
import {
  updateProfile,
  LOOKING_FOR_LABELS,
  type LookingFor,
} from "@/lib/users-api";
import type { Gender } from "@/lib/auth-api";
import { ApiError } from "@/lib/api";
import { spacing } from "@/theme/tokens";
import { useTheme } from "@/theme/theme";

const LOOKING_FOR_ORDER: LookingFor[] = [
  "DATING",
  "FRIENDSHIP",
  "NETWORKING",
  "ACTIVITY_PARTNERS",
  "JUST_EXPLORING",
];

const BIO_MAX = 500;
const NAME_MAX = 40;

export default function EditProfileScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const { profile, set } = useProfile();

  const photo = profile?.photos[0] ?? null;
  const photoCount = profile?.photos.length ?? 0;

  const [displayName, setDisplayName] = useState(profile?.displayName ?? "");
  const [username, setUsername] = useState(profile?.username ?? "");
  const [gender, setGender] = useState<Gender>(
    profile?.gender ?? "PREFER_NOT_TO_SAY",
  );
  const [bio, setBio] = useState(profile?.bio ?? "");
  const [interests, setInterests] = useState<string[]>(
    profile?.interests ?? [],
  );
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
      username.trim().toLowerCase() !== (profile.username ?? "") ||
      gender !== profile.gender ||
      displayName.trim() !== (profile.displayName ?? "") ||
      bio.trim() !== (profile.bio ?? "") ||
      !sameArr(interests, profile.interests) ||
      !sameArr(lookingFor, profile.lookingFor)
    );
  }, [profile, username, gender, displayName, bio, interests, lookingFor]);

  const nameTooLong = displayName.trim().length > NAME_MAX;
  const bioTooLong = bio.trim().length > BIO_MAX;
  const usernameInvalid =
    !!(profile?.username || username) && !/^[a-z][a-z0-9_]{2,19}$/.test(username.trim().toLowerCase());
  const canSave =
    !usernameInvalid && dirty && !saving && !nameTooLong && !bioTooLong;

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
        username: username.trim().toLowerCase() || undefined,
        gender,
        displayName: displayName.trim() || undefined,
        bio: bio.trim(),
        interests,
        lookingFor,
      });
      set(updated);
      router.back();
    } catch (e) {
      setError(
        e instanceof ApiError ? e.message : "Couldn’t save your profile.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={styles.gutter}>
          <ScreenHeader
            title="Edit profile"
            right={
              <AppText
                variant="bodyStrong"
                color={canSave ? "brand" : "textFaint"}
                onPress={onSave}
              >
                {saving ? "Saving…" : "Save"}
              </AppText>
            }
          />
        </View>

        <ScrollView
          contentContainerStyle={styles.body}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <AppText variant="overline" color="textFaint">
            Photo
          </AppText>
          <View style={styles.smallGap} />
          <Pressable
            onPress={() => router.push("/myspace/photos")}
            style={styles.photoRow}
          >
            <Avatar
              uri={photo?.url ?? null}
              name={profile?.displayName}
              size={64}
              editable
            />
            <View style={styles.photoText}>
              <AppText variant="bodyStrong">
                {photoCount > 0 ? "Manage photos" : "Add a photo"}
              </AppText>
              <AppText variant="footnote" color="textMuted">
                {photoCount > 0
                  ? `${photoCount} photo${photoCount === 1 ? "" : "s"} · first one is your main picture`
                  : "Add up to 9 — the first is your profile picture"}
              </AppText>
            </View>
          </Pressable>

          <View style={styles.gap} />
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
            label="Your unique username"
            value={username}
            onChangeText={setUsername}
            placeholder="e.g. pavithra_photo"
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={20}
            hint={
              usernameInvalid
                ? "Use 3–20 letters, numbers or underscores; start with a letter."
                : "Your public @username. Your original profile ID stays the same."
            }
          />
          <View style={styles.gap} />
          <AppText variant="overline" color="textFaint">
            Gender
          </AppText>
          <View style={styles.smallGap} />
          <View style={styles.chips}>
            {(
              [
                ["FEMALE", "Female"],
                ["MALE", "Male"],
                ["NON_BINARY", "Non-binary"],
                ["PREFER_NOT_TO_SAY", "Prefer not to say"],
              ] as const
            ).map(([value, label]) => (
              <SelectChip
                key={value}
                label={label}
                selected={gender === value}
                onPress={() => setGender(value)}
              />
            ))}
          </View>
          <AppText variant="caption" color="textMuted">
            Changing gender keeps your current photo privacy settings.
          </AppText>
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
  photoRow: { flexDirection: "row", alignItems: "center", gap: spacing[5] },
  photoText: { flex: 1, gap: spacing[1] },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing[3] },
  error: { marginTop: spacing[5] },
});
