import { useMemo, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Screen } from '@/components/Screen';
import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { BackButton } from '@/components/BackButton';
import { SelectChip } from '@/components/SelectChip';
import { Reveal } from '@/components/Reveal';
import { register, toStoredSession, type Gender } from '@/lib/auth-api';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDobInput, parseDob } from '@/lib/dob';
import { radius, spacing, typeScale } from '@/theme/tokens';
import { useTheme } from '@/theme/theme';
import { noWebOutline } from '@/theme/web';

const GENDERS: { value: Gender; label: string }[] = [
  { value: 'FEMALE', label: 'Female' },
  { value: 'MALE', label: 'Male' },
  { value: 'NON_BINARY', label: 'Non-binary' },
  { value: 'PREFER_NOT_TO_SAY', label: 'Prefer not to say' },
];

const LOCKED_BY_DEFAULT: Gender[] = ['FEMALE', 'NON_BINARY'];

export default function RegisterScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const { signIn } = useAuth();
  const params = useLocalSearchParams<{ registrationTicket: string }>();
  const ticket = params.registrationTicket ?? '';

  const [gender, setGender] = useState<Gender | null>(null);
  const [dob, setDob] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { iso, error: dobError } = useMemo(() => parseDob(dob), [dob]);
  const canSubmit = !!gender && !!iso && !submitting;
  const willLock = gender ? LOCKED_BY_DEFAULT.includes(gender) : false;

  async function onCreate() {
    if (!canSubmit || !gender || !iso) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await register({
        registrationTicket: ticket,
        gender,
        dateOfBirth: iso,
      });
      await signIn(toStoredSession(res.session, res.userId));
      // New account — land in Myspace to finish the profile before browsing.
      router.replace('/myspace');
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        setError('Your session expired. Go back and request a new code.');
      } else {
        setError(e instanceof Error ? e.message : 'Couldn’t create your account.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Screen scroll>
      <View style={styles.top}>
        <BackButton />
      </View>

      <Reveal style={styles.head}>
        <AppText variant="display">A few{'\n'}basics</AppText>
        <AppText variant="body" color="textMuted" style={styles.sub}>
          Used for age and discovery filters. You can refine your profile later
          in Myspace.
        </AppText>
      </Reveal>

      <View style={styles.section}>
        <AppText variant="overline" color="textFaint">
          I am
        </AppText>
        <View style={styles.chips}>
          {GENDERS.map((g) => (
            <SelectChip
              key={g.value}
              label={g.label}
              selected={gender === g.value}
              onPress={() => {
                setGender(g.value);
                setError(null);
              }}
            />
          ))}
        </View>
      </View>

      <View style={styles.section}>
        <AppText variant="overline" color="textFaint">
          Date of birth
        </AppText>
        <View
          style={[
            styles.dobField,
            { backgroundColor: colors.fieldBg, borderColor: colors.fieldBorder },
          ]}
        >
          <TextInput
            value={dob}
            onChangeText={(t) => {
              setDob(formatDobInput(t));
              setError(null);
            }}
            placeholder="DD / MM / YYYY"
            placeholderTextColor={colors.textFaint}
            keyboardType="number-pad"
            maxLength={10}
            style={[
              typeScale.headline,
              styles.dobInput,
              { color: colors.text },
              noWebOutline,
            ]}
          />
        </View>
        {dobError ? (
          <AppText variant="footnote" color="danger">
            {dobError}
          </AppText>
        ) : null}
      </View>

      {gender ? (
        <View
          style={[
            styles.notice,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          <AppText variant="footnote" color="textMuted">
            {willLock
              ? 'Your photos will be locked by default. People you ping — or whose ping you accept — can see them. You control this anytime in Myspace.'
              : 'Your photos are visible by default. You can lock them anytime in Myspace.'}
          </AppText>
        </View>
      ) : null}

      {error ? (
        <AppText variant="footnote" color="danger" style={styles.formError}>
          {error}
        </AppText>
      ) : null}

      <View style={styles.spacer} />

      <View style={styles.bottom}>
        <Button
          label="Create account"
          onPress={onCreate}
          loading={submitting}
          disabled={!canSubmit}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  top: { paddingTop: spacing[4], paddingBottom: spacing[7] },
  head: { gap: spacing[4] },
  sub: { maxWidth: 340 },
  section: { marginTop: spacing[8], gap: spacing[4] },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[3] },
  dobField: {
    height: 62,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    justifyContent: 'center',
    paddingHorizontal: spacing[5],
  },
  dobInput: { padding: 0, letterSpacing: 2 },
  notice: {
    marginTop: spacing[7],
    padding: spacing[5],
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth * 2,
  },
  formError: { marginTop: spacing[5] },
  spacer: { minHeight: spacing[9], flex: 1 },
  bottom: { paddingTop: spacing[6], paddingBottom: spacing[4] },
});
