import { forwardRef, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  TextInput,
  View,
  type TextInput as RNTextInput,
} from 'react-native';
import { MotiView } from 'moti';
import type { Country } from '@/lib/countries';
import { radius, spacing, typeScale } from '@/theme/tokens';
import { useTheme } from '@/theme/theme';
import { noWebOutline } from '@/theme/web';
import { AppText } from './AppText';

interface Props {
  country: Country;
  value: string;
  onChangeValue: (v: string) => void;
  onPressCountry: () => void;
  onSubmit?: () => void;
  autoFocus?: boolean;
}

export const PhoneField = forwardRef<RNTextInput, Props>(function PhoneField(
  { country, value, onChangeValue, onPressCountry, onSubmit, autoFocus },
  ref,
) {
  const { colors } = useTheme();
  const [focused, setFocused] = useState(false);

  return (
    <MotiView
      animate={{
        borderColor: focused ? colors.fieldBorderFocused : colors.fieldBorder,
      }}
      transition={{ type: 'timing', duration: 160 }}
      style={[styles.wrap, { backgroundColor: colors.fieldBg }]}
    >
      <Pressable
        onPress={onPressCountry}
        style={[styles.country, { borderRightColor: colors.border }]}
        hitSlop={8}
      >
        <AppText style={styles.flag}>{country.flag}</AppText>
        <AppText variant="bodyStrong">{country.dial}</AppText>
      </Pressable>

      <TextInput
        ref={ref}
        value={value}
        onChangeText={(t) => onChangeValue(t.replace(/[^\d]/g, ''))}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onSubmitEditing={onSubmit}
        keyboardType="number-pad"
        textContentType="telephoneNumber"
        autoComplete="tel"
        autoFocus={autoFocus}
        maxLength={15}
        placeholder="Phone number"
        placeholderTextColor={colors.textFaint}
        style={[
          typeScale.headline,
          styles.input,
          { color: colors.text },
          noWebOutline,
        ]}
      />
    </MotiView>
  );
});

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 62,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    overflow: 'hidden',
  },
  country: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingHorizontal: spacing[5],
    height: '100%',
    borderRightWidth: StyleSheet.hairlineWidth,
  },
  flag: { fontSize: 20 },
  input: {
    flex: 1,
    height: '100%',
    paddingHorizontal: spacing[5],
  },
});
