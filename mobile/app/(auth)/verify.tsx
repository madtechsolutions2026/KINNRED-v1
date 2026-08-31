import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Screen } from '@/components/Screen';
import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { BackButton } from '@/components/BackButton';
import { OtpCodeInput } from '@/components/OtpCodeInput';
import { Reveal } from '@/components/Reveal';
import { requestOtp, verifyOtp, toStoredSession } from '@/lib/auth-api';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useCountdown } from '@/lib/useCountdown';
import { maskPhone, formatMMSS } from '@/lib/format';
import { spacing } from '@/theme/tokens';

const CODE_LENGTH = 6;

export default function VerifyScreen() {
  const router = useRouter();
  const { signIn } = useAuth();
  const params = useLocalSearchParams<{
    phone: string;
    expiresInSeconds?: string;
  }>();
  const phone = params.phone ?? '';

  const [code, setCode] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resending, setResending] = useState(false);
  const lastAttempted = useRef<string>('');

  const { secondsLeft, restart } = useCountdown(30);

  const submit = useCallback(
    async (value: string) => {
      if (verifying || value.length !== CODE_LENGTH) return;
      if (value === lastAttempted.current) return;
      lastAttempted.current = value;

      setVerifying(true);
      setError(null);
      try {
        const result = await verifyOtp(phone, value);
        if (result.status === 'authenticated') {
          Haptics.notificationAsync(
            Haptics.NotificationFeedbackType.Success,
          ).catch(() => {});
          await signIn(toStoredSession(result.session, result.userId));
          router.replace('/grid');
        } else {
          router.replace({
            pathname: '/register',
            params: { registrationTicket: result.registrationTicket, phone },
          });
        }
      } catch (e) {
        Haptics.notificationAsync(
          Haptics.NotificationFeedbackType.Error,
        ).catch(() => {});
        setCode('');
        lastAttempted.current = '';
        if (e instanceof ApiError && e.status === 401) {
          setError('That code isn’t right. Check it and try again.');
        } else if (e instanceof ApiError && e.status === 429) {
          setError('Too many attempts. Wait a moment before retrying.');
        } else {
          setError(e instanceof Error ? e.message : 'Verification failed.');
        }
      } finally {
        setVerifying(false);
      }
    },
    [phone, router, signIn, verifying],
  );

  useEffect(() => {
    if (code.length === CODE_LENGTH) void submit(code);
  }, [code, submit]);

  async function onResend() {
    if (secondsLeft > 0 || resending) return;
    setResending(true);
    setError(null);
    setCode('');
    lastAttempted.current = '';
    try {
      await requestOtp(phone);
      restart(30);
    } catch (e) {
      if (e instanceof ApiError && e.status === 429) {
        setError('You’ve requested too many codes. Try again later.');
        restart(60);
      } else {
        setError(e instanceof Error ? e.message : 'Couldn’t resend the code.');
      }
    } finally {
      setResending(false);
    }
  }

  return (
    <Screen>
      <View style={styles.top}>
        <BackButton />
      </View>

      <Reveal style={styles.head}>
        <AppText variant="display">Enter the{'\n'}code</AppText>
        <AppText variant="body" color="textMuted" style={styles.sub}>
          Sent to {maskPhone(phone)}.{'  '}
          <AppText
            variant="bodyStrong"
            color="brand"
            onPress={() => router.back()}
          >
            Change
          </AppText>
        </AppText>
      </Reveal>

      <Reveal delay={90} style={styles.codeBlock}>
        <OtpCodeInput
          length={CODE_LENGTH}
          value={code}
          onChange={setCode}
          onComplete={submit}
          disabled={verifying}
          error={!!error}
        />
        <View style={styles.status}>
          {error ? (
            <AppText variant="footnote" color="danger">
              {error}
            </AppText>
          ) : verifying ? (
            <AppText variant="footnote" color="textFaint">
              Checking…
            </AppText>
          ) : (
            <AppText variant="footnote" color="textFaint">
              Enter the 6-digit code to continue
            </AppText>
          )}
        </View>
      </Reveal>

      <View style={styles.spacer} />

      <View style={styles.bottom}>
        {secondsLeft > 0 ? (
          <AppText variant="footnote" color="textFaint" align="center">
            Resend code in {formatMMSS(secondsLeft)}
          </AppText>
        ) : (
          <Pressable onPress={onResend} hitSlop={8} disabled={resending}>
            <AppText variant="bodyStrong" color="brand" align="center">
              {resending ? 'Sending…' : 'Resend code'}
            </AppText>
          </Pressable>
        )}
        <Button
          label="Verify"
          onPress={() => submit(code)}
          loading={verifying}
          disabled={code.length !== CODE_LENGTH}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  top: { paddingTop: spacing[4], paddingBottom: spacing[8] },
  head: { gap: spacing[4] },
  sub: { maxWidth: 340 },
  codeBlock: { marginTop: spacing[9], gap: spacing[5] },
  status: { minHeight: 18 },
  spacer: { flex: 1 },
  bottom: { gap: spacing[5], paddingBottom: spacing[4] },
});
