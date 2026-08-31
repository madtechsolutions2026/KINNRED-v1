import { useRef, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Screen } from '@/components/Screen';
import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Logo } from '@/components/Logo';
import { Reveal } from '@/components/Reveal';
import { PhoneField } from '@/components/PhoneField';
import { CountryPickerModal } from '@/components/CountryPickerModal';
import { DEFAULT_COUNTRY, toE164, type Country } from '@/lib/countries';
import { requestOtp } from '@/lib/auth-api';
import { ApiError } from '@/lib/api';
import { spacing } from '@/theme/tokens';

export default function PhoneScreen() {
  const router = useRouter();
  const inputRef = useRef<TextInput>(null);

  const [country, setCountry] = useState<Country>(DEFAULT_COUNTRY);
  const [number, setNumber] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = number.replace(/\D/g, '').length >= 6 && !submitting;

  async function onContinue() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    const phone = toE164(country.dial, number);
    try {
      const { expiresInSeconds } = await requestOtp(phone);
      router.push({
        pathname: '/verify',
        params: { phone, expiresInSeconds: String(expiresInSeconds) },
      });
    } catch (e) {
      if (e instanceof ApiError && e.status === 429) {
        setError('Too many code requests. Wait a bit and try again.');
      } else if (e instanceof ApiError && e.status === 400) {
        setError('That doesn’t look like a valid number for this country.');
      } else {
        setError(
          e instanceof Error ? e.message : 'Something went wrong. Try again.',
        );
      }
    } finally {
      setSubmitting(false);
    }
  }

  function onSelectCountry(c: Country) {
    setCountry(c);
    setError(null);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  return (
    <Screen>
      <View style={styles.top}>
        <Logo />
      </View>

      <Reveal style={styles.head}>
        <AppText variant="display">What’s your{'\n'}number?</AppText>
        <AppText variant="body" color="textMuted" style={styles.sub}>
          We’ll text a 6-digit code to confirm it’s you. Your number stays
          private — it’s never shown to other people on Kinnred.
        </AppText>
      </Reveal>

      <Reveal delay={90} style={styles.fieldBlock}>
        <PhoneField
          ref={inputRef}
          country={country}
          value={number}
          onChangeValue={(v) => {
            setNumber(v);
            setError(null);
          }}
          onPressCountry={() => setPickerOpen(true)}
          onSubmit={onContinue}
          autoFocus
        />
        {error ? (
          <AppText variant="footnote" color="danger" style={styles.error}>
            {error}
          </AppText>
        ) : null}
      </Reveal>

      <View style={styles.spacer} />

      <View style={styles.bottom}>
        <AppText variant="footnote" color="textFaint" align="center">
          By continuing you agree to Kinnred’s Terms of Service and Privacy
          Policy.
        </AppText>
        <Button
          label="Continue"
          onPress={onContinue}
          loading={submitting}
          disabled={!canSubmit}
        />
      </View>

      <CountryPickerModal
        visible={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={onSelectCountry}
        selectedCode={country.code}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  top: { paddingTop: spacing[4], paddingBottom: spacing[9] },
  head: { gap: spacing[4] },
  sub: { maxWidth: 340 },
  fieldBlock: { marginTop: spacing[9], gap: spacing[3] },
  error: { marginLeft: spacing[2] },
  spacer: { flex: 1 },
  bottom: { gap: spacing[5], paddingBottom: spacing[4] },
});
