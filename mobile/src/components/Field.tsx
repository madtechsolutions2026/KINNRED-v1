import { useState } from 'react';
import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';
import { MotiView } from 'moti';
import { radius, spacing, typeScale } from '@/theme/tokens';
import { useTheme } from '@/theme/theme';
import { noWebOutline } from '@/theme/web';
import { AppText } from './AppText';

interface Props extends Omit<TextInputProps, 'style'> {
  label?: string;
  hint?: string;
  multiline?: boolean;
  counter?: { current: number; max: number };
}

export function Field({
  label,
  hint,
  multiline,
  counter,
  onFocus,
  onBlur,
  ...rest
}: Props) {
  const { colors } = useTheme();
  const [focused, setFocused] = useState(false);

  return (
    <View style={styles.wrap}>
      {label ? (
        <AppText variant="overline" color="textFaint">
          {label}
        </AppText>
      ) : null}
      <MotiView
        animate={{
          borderColor: focused ? colors.fieldBorderFocused : colors.fieldBorder,
        }}
        transition={{ type: 'timing', duration: 150 }}
        style={[
          styles.field,
          multiline && styles.fieldMultiline,
          { backgroundColor: colors.fieldBg },
        ]}
      >
        <TextInput
          {...rest}
          multiline={multiline}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          placeholderTextColor={colors.textFaint}
          style={[
            typeScale.body,
            styles.input,
            multiline && styles.inputMultiline,
            { color: colors.text },
            noWebOutline,
          ]}
        />
      </MotiView>
      <View style={styles.footer}>
        {hint ? (
          <AppText variant="caption" color="textFaint" style={styles.hint}>
            {hint}
          </AppText>
        ) : (
          <View style={styles.hint} />
        )}
        {counter ? (
          <AppText
            variant="caption"
            color={counter.current > counter.max ? 'danger' : 'textFaint'}
          >
            {counter.current}/{counter.max}
          </AppText>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing[3] },
  field: {
    minHeight: 56,
    borderRadius: radius.md,
    borderWidth: 1.5,
    justifyContent: 'center',
    paddingHorizontal: spacing[5],
  },
  fieldMultiline: { minHeight: 120, paddingVertical: spacing[4] },
  input: { padding: 0 },
  inputMultiline: {
    textAlignVertical: 'top',
    minHeight: 88,
    lineHeight: 22,
  },
  footer: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  hint: { flex: 1 },
});
