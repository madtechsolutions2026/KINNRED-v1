import React, { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useTheme } from '../theme/ThemeContext';
import { useSession } from '../state/SessionContext';
import { auth } from '../api/endpoints';

import Card from '../components/Card';
import LivePulse from '../components/LivePulse';

/**
 * Phone -> OTP sign-in.
 *
 * Two steps in one screen so the number stays visible while the code is
 * entered. The OTP endpoint deliberately returns an identical response
 * whether or not the number has an account, so this screen must not branch on
 * "account exists" before the verify step — it cannot know.
 */
export default function AuthScreen() {
  const { colors, type, space, radius, layout, elevation, isDark, toggleTheme } = useTheme();
  const { refresh, enterDemo } = useSession();

  const [step, setStep] = useState('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const codeRef = useRef(null);
  /** Latches synchronously so a double submit cannot burn a single-use code. */
  const submitting = useRef(false);

  const requestOtp = useCallback(async () => {
    if (!phone.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await auth.requestOtp(phone.trim());
      setStep('code');
      setNotice(`Code sent. It expires in ${Math.round((res.expiresInSeconds ?? 300) / 60)} minutes.`);
      setTimeout(() => codeRef.current?.focus(), 120);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }, [phone]);

  const verify = useCallback(async () => {
    if (!code.trim()) return;
    // An OTP is single-use: the first verify consumes it, so a duplicate call
    // with the same code comes back 401 and reads to the user as "wrong code"
    // when the code was fine. The keyboard's submit handler and the button
    // both call this, and they can fire milliseconds apart — before `busy` has
    // rendered and disabled anything. A ref latches synchronously; state does
    // not.
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError(null);
    try {
      const res = await auth.verifyOtp(phone.trim(), code.trim(), deviceLabel());
      if (res.status === 'registration_required') {
        setError('This number has no account yet. Sign-up is not wired into the app yet.');
      } else {
        await refresh();
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
      submitting.current = false;
    }
  }, [code, phone, refresh]);

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.background }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: 'center',
          padding: layout.screenPaddingX,
          gap: space.xl,
        }}
        keyboardShouldPersistTaps="handled"
      >
        {/* Wordmark */}
        <View style={{ alignItems: 'center', gap: space.md }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
            <LivePulse size={10} />
            <Text style={[type.display, { color: colors.foreground, letterSpacing: 2 }]}>
              KINNRED
            </Text>
          </View>
          <Text
            style={[
              type.bodySm,
              { color: colors.mutedForeground, textAlign: 'center', maxWidth: 300 },
            ]}
          >
            Open the app. See real people nearby. Tap anyone. No algorithm. No endless swiping.
          </Text>
        </View>

        <Card>
          <View style={{ gap: space.md }}>
            <Text style={[type.title, { color: colors.foreground }]}>
              {step === 'phone' ? 'Enter your number' : 'Enter the code'}
            </Text>

            {step === 'phone' ? (
              <Field
                icon="call-outline"
                value={phone}
                onChangeText={setPhone}
                placeholder="+91 98765 43210"
                keyboardType="phone-pad"
                autoComplete="tel"
                onSubmitEditing={requestOtp}
              />
            ) : (
              <>
                <Text style={[type.bodySm, { color: colors.mutedForeground }]}>
                  Sent to {phone}
                </Text>
                <Field
                  inputRef={codeRef}
                  icon="keypad-outline"
                  value={code}
                  onChangeText={setCode}
                  placeholder="6-digit code"
                  keyboardType="number-pad"
                  autoComplete="one-time-code"
                  maxLength={6}
                  onSubmitEditing={verify}
                />
              </>
            )}

            {notice && !error ? (
              <Text style={[type.caption, { color: colors.mutedForeground }]}>{notice}</Text>
            ) : null}
            {error ? (
              <View style={{ flexDirection: 'row', gap: space.xs, alignItems: 'flex-start' }}>
                <Ionicons name="alert-circle" size={13} color={colors.destructive} style={{ marginTop: 1 }} />
                <Text style={[type.caption, { color: colors.destructive, flex: 1 }]}>{error}</Text>
              </View>
            ) : null}

            <Pressable
              onPress={step === 'phone' ? requestOtp : verify}
              disabled={busy}
              accessibilityRole="button"
              style={({ pressed }) => [
                {
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: space.sm,
                  paddingVertical: space.md + 2,
                  borderRadius: radius.pill,
                  backgroundColor: colors.signal,
                  opacity: busy ? 0.6 : pressed ? 0.85 : 1,
                },
                elevation(2),
              ]}
            >
              {busy ? <ActivityIndicator size="small" color={colors.signalForeground} /> : null}
              <Text style={[type.title, { color: colors.signalForeground }]}>
                {step === 'phone' ? 'Send code' : 'Verify'}
              </Text>
            </Pressable>

            {step === 'code' ? (
              <Pressable onPress={() => { setStep('phone'); setCode(''); setError(null); }} hitSlop={8}>
                <Text style={[type.caption, { color: colors.mutedForeground, textAlign: 'center' }]}>
                  Use a different number
                </Text>
              </Pressable>
            ) : null}
          </View>
        </Card>

        <Pressable onPress={enterDemo} accessibilityRole="button" hitSlop={8}>
          <Text style={[type.caption, { color: colors.mutedForeground, textAlign: 'center' }]}>
            Browse the interface with demo data →
          </Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Field({ icon, inputRef, ...props }) {
  const { colors, type, space, radius } = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.sm,
        paddingHorizontal: space.md,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.muted,
      }}
    >
      <Ionicons name={icon} size={17} color={colors.mutedForeground} />
      <TextInput
        ref={inputRef}
        placeholderTextColor={colors.mutedForeground}
        style={[type.body, { flex: 1, color: colors.foreground, paddingVertical: space.md }]}
        {...props}
      />
    </View>
  );
}

function deviceLabel() {
  return Platform.select({ web: 'Web', ios: 'iPhone', android: 'Android', default: 'Device' });
}
