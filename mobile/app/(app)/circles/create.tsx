import { useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Field } from '@/components/Field';
import { ScreenHeader } from '@/components/ScreenHeader';
import { useProfile } from '@/lib/profile';
import { useCircles } from '@/lib/circles';
import {
  createCircle,
  CATEGORY_LABELS,
  TIER_LABELS,
  type CircleCategory,
  type CircleTier,
} from '@/lib/circles-api';
import { ApiError } from '@/lib/api';
import { radius, spacing } from '@/theme/tokens';
import { useTheme } from '@/theme/theme';

const TIERS: { value: CircleTier; blurb: string }[] = [
  { value: 'OPEN', blurb: 'Anyone can find it and join instantly.' },
  { value: 'INVITE_ONLY', blurb: 'Listed publicly, but people must request and be approved.' },
  { value: 'INCOGNITO', blurb: 'Hidden entirely. Only people you invite can see it exists.' },
];
const CATEGORIES = Object.keys(CATEGORY_LABELS) as CircleCategory[];

const NAME_MAX = 60;
const DESC_MAX = 500;

export default function CreateCircle() {
  const router = useRouter();
  const { colors } = useTheme();
  const { profile } = useProfile();
  const { reload } = useCircles();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [tier, setTier] = useState<CircleTier>('OPEN');
  const [category, setCategory] = useState<CircleCategory>('OTHER');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const verified = profile?.isVerified ?? false;
  const canSubmit =
    verified && name.trim().length >= 3 && name.trim().length <= NAME_MAX && !submitting;

  async function onCreate() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const circle = await createCircle({
        name: name.trim(),
        description: description.trim() || undefined,
        tier,
        category,
      });
      await reload();
      router.replace(`/circles/${circle.publicShortId}`);
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) {
        setError('Only verified accounts can create circles.');
      } else {
        setError(e instanceof ApiError ? e.message : 'Couldn’t create the circle.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.gutter}>
          <ScreenHeader title="New circle" />
        </View>

        <ScrollView
          contentContainerStyle={styles.body}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {!verified ? (
            <View
              style={[
                styles.notice,
                { backgroundColor: colors.surface, borderColor: colors.warning },
              ]}
            >
              <Ionicons name="shield-outline" size={18} color={colors.warning} />
              <AppText variant="footnote" color="textMuted" style={styles.noticeText}>
                Creating a circle needs a verified account. You can still browse
                and join circles without it.
              </AppText>
            </View>
          ) : null}

          <Field
            label="Name"
            value={name}
            onChangeText={setName}
            placeholder="Sunday Trail Runners"
            maxLength={NAME_MAX + 10}
            counter={{ current: name.trim().length, max: NAME_MAX }}
          />

          <View style={styles.gap} />
          <Field
            label="Description"
            value={description}
            onChangeText={setDescription}
            placeholder="What’s this circle about?"
            multiline
            maxLength={DESC_MAX + 40}
            counter={{ current: description.trim().length, max: DESC_MAX }}
          />

          <View style={styles.gap} />
          <AppText variant="overline" color="textFaint">
            Privacy
          </AppText>
          <View style={styles.smallGap} />
          {TIERS.map((t) => {
            const on = tier === t.value;
            return (
              <Pressable
                key={t.value}
                onPress={() => setTier(t.value)}
                style={[
                  styles.tierRow,
                  {
                    backgroundColor: colors.surface,
                    borderColor: on ? colors.brand : colors.border,
                  },
                ]}
              >
                <Ionicons
                  name={on ? 'radio-button-on' : 'radio-button-off'}
                  size={18}
                  color={on ? colors.brand : colors.textFaint}
                />
                <View style={styles.tierText}>
                  <AppText variant="bodyStrong">{TIER_LABELS[t.value]}</AppText>
                  <AppText variant="footnote" color="textMuted">
                    {t.blurb}
                  </AppText>
                </View>
              </Pressable>
            );
          })}

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

          {error ? (
            <AppText variant="footnote" color="danger" style={styles.error}>
              {error}
            </AppText>
          ) : null}

          <View style={styles.gap} />
          <Button
            label="Create circle"
            onPress={onCreate}
            loading={submitting}
            disabled={!canSubmit}
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
  notice: {
    flexDirection: 'row',
    gap: spacing[3],
    padding: spacing[4],
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth * 2,
    marginBottom: spacing[6],
  },
  noticeText: { flex: 1 },
  tierRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing[3],
    padding: spacing[4],
    borderRadius: radius.md,
    borderWidth: 1.5,
    marginBottom: spacing[3],
  },
  tierText: { flex: 1, gap: 2 },
  cats: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2] },
  catChip: {
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth * 2,
  },
  error: { marginTop: spacing[5] },
});
