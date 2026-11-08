import { useEffect, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Field } from '@/components/Field';
import { ScreenHeader } from '@/components/ScreenHeader';
import { SettingRow } from '@/components/SettingRow';
import {
  getCircle,
  updateCircle,
  CATEGORY_LABELS,
  type CircleCategory,
} from '@/lib/circles-api';
import { ApiError } from '@/lib/api';
import { radius, spacing } from '@/theme/tokens';
import { useTheme } from '@/theme/theme';

const CATEGORIES = Object.keys(CATEGORY_LABELS) as CircleCategory[];

export default function CircleSettingsScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const { shortId } = useLocalSearchParams<{ shortId: string }>();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<CircleCategory>('OTHER');
  const [chatEnabled, setChatEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!shortId) return;
    getCircle(shortId)
      .then((c) => {
        setName(c.name);
        setDescription(c.description ?? '');
        setCategory(c.category);
        setChatEnabled(c.chatEnabled);
      })
      .catch((e) =>
        setError(e instanceof ApiError ? e.message : 'Couldn’t load settings.'),
      )
      .finally(() => setLoading(false));
  }, [shortId]);

  async function save() {
    if (!shortId || saving) return;
    setSaving(true);
    setError(null);
    try {
      await updateCircle(shortId, {
        name: name.trim(),
        description: description.trim(),
        category,
        chatEnabled,
      });
      router.back();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Couldn’t save.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'web' ? undefined : 'padding'}
      >
        <View style={styles.gutter}>
          <ScreenHeader title="Circle settings" />
        </View>
        {loading ? null : (
          <ScrollView
            contentContainerStyle={styles.body}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <Field label="Name" value={name} onChangeText={setName} maxLength={70} />
            <View style={styles.gap} />
            <Field
              label="Description"
              value={description}
              onChangeText={setDescription}
              multiline
              maxLength={540}
            />

            <View style={styles.gap} />
            <AppText variant="overline" color="textFaint">
              Category
            </AppText>
            <View style={styles.smallGap} />
            <View style={styles.cats}>
              {CATEGORIES.map((c) => {
                const on = category === c;
                return (
                  <Pressable
                    key={c}
                    onPress={() => setCategory(c)}
                    style={[
                      styles.catChip,
                      {
                        backgroundColor: on ? colors.brand : colors.surface,
                        borderColor: on ? colors.brand : colors.border,
                      },
                    ]}
                  >
                    <AppText
                      variant="caption"
                      style={{ color: on ? colors.textOnBrand : colors.textMuted }}
                    >
                      {CATEGORY_LABELS[c]}
                    </AppText>
                  </Pressable>
                );
              })}
            </View>

            <View style={styles.gap} />
            <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <SettingRow
                label="Group chat"
                description="When off, the chat closes for everyone and members can’t post messages."
                value={chatEnabled}
                onValueChange={setChatEnabled}
              />
            </View>

            {error ? (
              <AppText variant="footnote" color="danger" style={styles.error}>
                {error}
              </AppText>
            ) : null}

            <View style={styles.gap} />
            <Button label="Save changes" onPress={save} loading={saving} disabled={name.trim().length < 3} />
          </ScrollView>
        )}
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
  cats: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2] },
  catChip: {
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth * 2,
  },
  card: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth * 2,
    paddingHorizontal: spacing[5],
  },
  error: { marginTop: spacing[5] },
});
