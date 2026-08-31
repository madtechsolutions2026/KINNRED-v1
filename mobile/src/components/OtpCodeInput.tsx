import { useEffect, useRef, useState } from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { MotiView } from 'moti';
import { radius, spacing, typeScale } from '@/theme/tokens';
import { useTheme } from '@/theme/theme';
import { noWebOutline } from '@/theme/web';
import { AppText } from './AppText';

interface Props {
  length?: number;
  value: string;
  onChange: (v: string) => void;
  onComplete: (v: string) => void;
  autoFocus?: boolean;
  disabled?: boolean;
  error?: boolean;
}

/**
 * Segmented OTP entry. A single hidden TextInput owns the value (so paste,
 * autofill and the platform SMS one-time-code hint all work); the visible
 * cells are a presentational overlay.
 */
export function OtpCodeInput({
  length = 6,
  value,
  onChange,
  onComplete,
  autoFocus = true,
  disabled = false,
  error = false,
}: Props) {
  const { colors } = useTheme();
  const inputRef = useRef<TextInput>(null);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (value.length === length) onComplete(value);
  }, [value, length, onComplete]);

  const cells = Array.from({ length }, (_, i) => i);
  const activeIndex = Math.min(value.length, length - 1);

  return (
    <Pressable
      onPress={() => inputRef.current?.focus()}
      style={styles.wrap}
      disabled={disabled}
    >
      {cells.map((i) => {
        const char = value[i] ?? '';
        const isActive = focused && i === activeIndex && !disabled;
        const isFilled = char !== '';
        const borderColor = error
          ? colors.danger
          : isActive
            ? colors.fieldBorderFocused
            : isFilled
              ? colors.borderStrong
              : colors.fieldBorder;

        return (
          <MotiView
            key={i}
            animate={{
              borderColor,
              scale: isActive ? 1.04 : 1,
            }}
            transition={{ type: 'timing', duration: 140 }}
            style={[
              styles.cell,
              {
                backgroundColor: colors.fieldBg,
                borderWidth: isActive || isFilled ? 2 : 1.5,
              },
            ]}
          >
            <AppText style={[typeScale.title, { color: colors.text }]}>
              {char}
            </AppText>
            {isActive && char === '' ? (
              <MotiView
                from={{ opacity: 0.2 }}
                animate={{ opacity: 1 }}
                transition={{
                  loop: true,
                  type: 'timing',
                  duration: 550,
                }}
                style={[styles.caret, { backgroundColor: colors.brand }]}
              />
            ) : null}
          </MotiView>
        );
      })}

      <TextInput
        ref={inputRef}
        value={value}
        onChangeText={(t) => onChange(t.replace(/\D/g, '').slice(0, length))}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete={Platform.OS === 'android' ? 'sms-otp' : 'one-time-code'}
        autoFocus={autoFocus}
        editable={!disabled}
        maxLength={length}
        style={[styles.hiddenInput, noWebOutline]}
        caretHidden
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    gap: spacing[3],
  },
  cell: {
    flex: 1,
    aspectRatio: 0.82,
    maxWidth: 56,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  caret: {
    position: 'absolute',
    width: 2,
    height: 26,
    borderRadius: 1,
  },
  hiddenInput: {
    position: 'absolute',
    opacity: 0,
    width: 1,
    height: 1,
  },
});
