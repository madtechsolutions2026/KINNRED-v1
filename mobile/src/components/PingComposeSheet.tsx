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
import { AppText } from './AppText';
import { Button } from './Button';
import { sendPing } from '@/lib/pings-api';
import { ApiError } from '@/lib/api';
import { radius, spacing, typeScale } from '@/theme/tokens';
import { useTheme } from '@/theme/theme';
import { noWebOutline } from '@/theme/web';

interface Props {
  visible: boolean;
  toPublicShortId: string;
  toName: string;
  onClose: () => void;
  /** Called with the new pingId (or accepted ping) on success. */
  onSent: (result: { pingId: string; state: string }) => void;
}

const MAX = 500;

export function PingComposeSheet({
  visible,
  toPublicShortId,
  toName,
  onClose,
  onSent,
}: Props) {
  const { colors } = useTheme();
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (sending) return;
    setSending(true);
    setError(null);
    try {
      const res = await sendPing({
        toPublicShortId,
        openingMessage: message.trim() || undefined,
      });
      setMessage('');
      onSent({ pingId: res.pingId, state: res.state });
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        setError('This person isn’t available.');
      } else if (e instanceof ApiError && e.status === 429) {
        setError('You’ve sent a lot of pings today. Try again later.');
      } else {
        setError(e instanceof ApiError ? e.message : 'Couldn’t send the ping.');
      }
    } finally {
      setSending(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={styles.backdropFill} onPress={onClose} />
        <KeyboardAvoidingView
          style={{flex:1,justifyContent:'flex-end'}}
          behavior={Platform.OS === 'web' ? undefined : 'padding'}
        >
          <SafeAreaView
            edges={['bottom']}
            style={[styles.sheet, { backgroundColor: colors.bgElevated }]}
          >
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{gap:8,paddingBottom:16}} showsVerticalScrollIndicator={false}>
            <View style={styles.handle}>
              <View style={[styles.grip, { backgroundColor: colors.border }]} />
            </View>
            <AppText variant="headline">Ping {toName}</AppText>
            <AppText variant="footnote" color="textMuted" style={styles.sub}>
              Add a note so they know why you’re reaching out. Optional.
            </AppText>

            <TextInput
              accessibilityLabel="Opening message"
              value={message}
              onChangeText={setMessage}
              placeholder="Hey — saw we both…"
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
              {message.trim().length}/{MAX}
            </AppText>

            {error ? (
              <AppText variant="footnote" color="danger" style={styles.err}>
                {error}
              </AppText>
            ) : null}

            <Button
              label="Send ping"
              onPress={submit}
              loading={sending}
              disabled={message.trim().length > MAX}
            />
            </ScrollView>
          </SafeAreaView>
        </KeyboardAvoidingView>
      </View>
    </Modal>
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
    maxHeight: '100%',
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
    minHeight: 96,
    maxHeight: 140,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth * 2,
    padding: spacing[4],
    textAlignVertical: 'top',
  },
  err: { marginBottom: spacing[2] },
});
