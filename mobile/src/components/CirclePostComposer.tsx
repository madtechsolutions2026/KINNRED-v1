import { useState } from 'react';
import {
  KeyboardAvoidingView,
  ScrollView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { AppText } from './AppText';
import { Button } from './Button';
import { createPost, type CirclePost } from '@/lib/circles-api';
import { ApiError } from '@/lib/api';
import { radius, spacing, typeScale } from '@/theme/tokens';
import { useTheme } from '@/theme/theme';
import { noWebOutline } from '@/theme/web';

interface Props {
  visible: boolean;
  circleShortId: string;
  onClose: () => void;
  onPosted: (post: CirclePost) => void;
}

const MAX = 2000;
const PRESETS: { label: string; hours: number }[] = [
  { label: 'In 1 hour', hours: 1 },
  { label: 'Tomorrow', hours: 24 },
  { label: 'In a week', hours: 24 * 7 },
];

export function CirclePostComposer({
  visible,
  circleShortId,
  onClose,
  onPosted,
}: Props) {
  const { colors } = useTheme();
  const [body, setBody] = useState('');
  const [scheduleHours, setScheduleHours] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const text = body.trim();
    if (!text || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const scheduledFor =
        scheduleHours != null
          ? new Date(Date.now() + scheduleHours * 3600_000).toISOString()
          : undefined;
      const post = await createPost(circleShortId, { body: text, scheduledFor });
      setBody('');
      setScheduleHours(null);
      onPosted(post);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Couldn’t post.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={styles.backdropFill} onPress={onClose} />
        <KeyboardAvoidingView style={{flex:1,justifyContent:"flex-end"}} behavior={Platform.OS === 'web' ? undefined : 'padding'}>
          <SafeAreaView
            edges={['bottom']}
            style={[styles.sheet, { backgroundColor: colors.bgElevated }]}
          >
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{gap:8}} showsVerticalScrollIndicator={false}>
            <View style={styles.handle}>
              <View style={[styles.grip, { backgroundColor: colors.border }]} />
            </View>
            <AppText variant="headline">New post</AppText>
            <AppText variant="footnote" color="textMuted" style={styles.sub}>
              This goes to every member of the circle.
            </AppText>

            <TextInput
              value={body}
              onChangeText={setBody}
              placeholder="Share an update, a plan, a reminder…"
              placeholderTextColor={colors.textFaint}
              multiline
              maxLength={MAX + 40}
              style={[
                typeScale.body,
                styles.input,
                {
                  color: colors.text,
                  backgroundColor: colors.surface,
                  borderColor: colors.border,
                },
                noWebOutline,
              ]}
            />
            <AppText variant="caption" color="textFaint" align="right">
              {body.trim().length}/{MAX}
            </AppText>

            <AppText variant="overline" color="textFaint" style={styles.scheduleLabel}>
              Schedule
            </AppText>
            <View style={styles.presets}>
              <Preset
                label="Post now"
                on={scheduleHours == null}
                onPress={() => setScheduleHours(null)}
              />
              {PRESETS.map((p) => (
                <Preset
                  key={p.label}
                  label={p.label}
                  on={scheduleHours === p.hours}
                  onPress={() => setScheduleHours(p.hours)}
                />
              ))}
            </View>

            {error ? (
              <AppText variant="footnote" color="danger" style={styles.err}>
                {error}
              </AppText>
            ) : null}

            <Button
              label={scheduleHours == null ? 'Post' : 'Schedule post'}
              onPress={submit}
              loading={submitting}
              disabled={!body.trim()}
            />
            </ScrollView>
          </SafeAreaView>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

function Preset({
  label,
  on,
  onPress,
}: {
  label: string;
  on: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.preset,
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
        {label}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end' },
  backdropFill: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  sheet: {
    maxHeight: "100%",
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: spacing[6],
    paddingBottom: spacing[6],
    gap: spacing[3],
  },
  handle: { alignItems: 'center', paddingVertical: spacing[4] },
  grip: { width: 40, height: 4, borderRadius: 2 },
  sub: { marginBottom: spacing[2] },
  input: {
    minHeight: 110,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth * 2,
    padding: spacing[4],
    textAlignVertical: 'top',
  },
  scheduleLabel: { marginTop: spacing[3] },
  presets: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2], marginBottom: spacing[2] },
  preset: {
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth * 2,
  },
  err: { marginBottom: spacing[2] },
});
