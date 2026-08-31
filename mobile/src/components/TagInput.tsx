import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { radius, spacing, typeScale } from '@/theme/tokens';
import { useTheme } from '@/theme/theme';
import { noWebOutline } from '@/theme/web';
import { AppText } from './AppText';

interface Props {
  value: string[];
  onChange: (next: string[]) => void;
  max?: number;
  maxLength?: number;
  placeholder?: string;
}

export function TagInput({
  value,
  onChange,
  max = 15,
  maxLength = 30,
  placeholder = 'Type and press enter',
}: Props) {
  const { colors } = useTheme();
  const [draft, setDraft] = useState('');

  const commit = () => {
    const tag = draft.trim().toLowerCase();
    setDraft('');
    if (!tag) return;
    if (value.length >= max) return;
    if (value.includes(tag)) return;
    onChange([...value, tag]);
  };

  const remove = (tag: string) => onChange(value.filter((t) => t !== tag));

  return (
    <View style={styles.wrap}>
      <View style={styles.tags}>
        {value.map((tag) => (
          <Pressable
            key={tag}
            onPress={() => remove(tag)}
            style={[
              styles.tag,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <AppText style={[typeScale.subhead, { color: colors.text }]}>
              {tag}
            </AppText>
            <Ionicons name="close" size={14} color={colors.textFaint} />
          </Pressable>
        ))}
      </View>
      {value.length < max ? (
        <View
          style={[
            styles.field,
            { backgroundColor: colors.fieldBg, borderColor: colors.fieldBorder },
          ]}
        >
          <TextInput
            value={draft}
            onChangeText={setDraft}
            onSubmitEditing={commit}
            onBlur={commit}
            blurOnSubmit={false}
            placeholder={placeholder}
            placeholderTextColor={colors.textFaint}
            maxLength={maxLength}
            autoCapitalize="none"
            autoCorrect={false}
            style={[typeScale.body, styles.input, { color: colors.text }, noWebOutline]}
          />
        </View>
      ) : null}
      <AppText variant="caption" color="textFaint">
        {value.length}/{max}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing[3] },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[3] },
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingLeft: spacing[4],
    paddingRight: spacing[3],
    paddingVertical: spacing[3],
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth * 2,
  },
  field: {
    height: 52,
    borderRadius: radius.md,
    borderWidth: 1.5,
    justifyContent: 'center',
    paddingHorizontal: spacing[5],
  },
  input: { padding: 0 },
});
