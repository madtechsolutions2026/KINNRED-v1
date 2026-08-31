import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { AppText } from '@/components/AppText';
import { Avatar } from '@/components/Avatar';
import { Button } from '@/components/Button';
import { ScreenHeader } from '@/components/ScreenHeader';
import {
  getCircle,
  getMembers,
  getJoinRequests,
  decideRequest,
  inviteMember,
  kickMember,
  type CircleMember,
  type JoinRequest,
} from '@/lib/circles-api';
import { ApiError } from '@/lib/api';
import { relativeTime } from '@/lib/format';
import { radius, spacing, typeScale } from '@/theme/tokens';
import { useTheme } from '@/theme/theme';
import { noWebOutline } from '@/theme/web';

export default function CircleMembersScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const { shortId } = useLocalSearchParams<{ shortId: string }>();

  const [isAdmin, setIsAdmin] = useState(false);
  const [members, setMembers] = useState<CircleMember[]>([]);
  const [requests, setRequests] = useState<JoinRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [invite, setInvite] = useState('');

  const load = useCallback(async () => {
    if (!shortId) return;
    try {
      const circle = await getCircle(shortId);
      const admin = circle.viewer.isAdmin;
      setIsAdmin(admin);
      const [m, r] = await Promise.all([
        getMembers(shortId),
        admin ? getJoinRequests(shortId) : Promise.resolve([]),
      ]);
      setMembers(m.members);
      setRequests(r);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Couldn’t load members.');
    } finally {
      setLoading(false);
    }
  }, [shortId]);

  useEffect(() => {
    void load();
  }, [load]);

  const act = useCallback(
    async (fn: () => Promise<unknown>) => {
      setBusy(true);
      setError(null);
      try {
        await fn();
        await load();
      } catch (e) {
        setError(e instanceof ApiError ? e.message : 'Something went wrong.');
      } finally {
        setBusy(false);
      }
    },
    [load],
  );

  const onInvite = () => {
    const id = invite.trim().replace(/^@/, '').toUpperCase();
    if (!id || !shortId) return;
    void act(async () => {
      await inviteMember(shortId, id);
      setInvite('');
    });
  };

  const onKick = (member: CircleMember) => {
    if (!shortId) return;
    Alert.alert(`Remove ${member.displayName ?? member.publicShortId}?`, undefined, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => void act(() => kickMember(shortId, member.publicShortId)),
      },
    ]);
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]}>
      <View style={styles.gutter}>
        <ScreenHeader title="Members" />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.textMuted} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
          {error ? (
            <AppText variant="footnote" color="danger" style={styles.err}>
              {error}
            </AppText>
          ) : null}

          {isAdmin ? (
            <View style={styles.section}>
              <AppText variant="overline" color="textFaint">
                Invite by ID
              </AppText>
              <View style={styles.inviteRow}>
                <View
                  style={[
                    styles.inviteField,
                    { backgroundColor: colors.fieldBg, borderColor: colors.fieldBorder },
                  ]}
                >
                  <TextInput
                    value={invite}
                    onChangeText={setInvite}
                    placeholder="ABCD123XYZ"
                    placeholderTextColor={colors.textFaint}
                    autoCapitalize="characters"
                    autoCorrect={false}
                    style={[typeScale.body, styles.inviteInput, { color: colors.text }, noWebOutline]}
                  />
                </View>
                <Button
                  label="Invite"
                  fullWidth={false}
                  onPress={onInvite}
                  loading={busy}
                  disabled={!invite.trim()}
                />
              </View>
            </View>
          ) : null}

          {isAdmin && requests.length > 0 ? (
            <View style={styles.section}>
              <AppText variant="overline" color="textFaint">
                Requests · {requests.length}
              </AppText>
              {requests.map((r) => (
                <View
                  key={r.publicShortId}
                  style={[styles.row, { backgroundColor: colors.surface, borderColor: colors.border }]}
                >
                  <Avatar name={r.displayName} size={40} />
                  <View style={styles.rowText}>
                    <AppText variant="subhead" numberOfLines={1}>
                      {r.displayName ?? `@${r.publicShortId}`}
                    </AppText>
                    <AppText variant="caption" color="textFaint">
                      {relativeTime(r.requestedAt)}
                    </AppText>
                  </View>
                  <Pressable
                    onPress={() =>
                      void act(() => decideRequest(shortId!, r.publicShortId, false))
                    }
                    hitSlop={8}
                  >
                    <AppText variant="subhead" color="textMuted">
                      Decline
                    </AppText>
                  </Pressable>
                  <Pressable
                    onPress={() =>
                      void act(() => decideRequest(shortId!, r.publicShortId, true))
                    }
                    hitSlop={8}
                  >
                    <AppText variant="subhead" color="brand">
                      Approve
                    </AppText>
                  </Pressable>
                </View>
              ))}
            </View>
          ) : null}

          <View style={styles.section}>
            <AppText variant="overline" color="textFaint">
              {members.length} {members.length === 1 ? 'member' : 'members'}
            </AppText>
            {members.map((m) => (
              <View
                key={m.publicShortId}
                style={[styles.row, { backgroundColor: colors.surface, borderColor: colors.border }]}
              >
                <Avatar name={m.displayName} size={40} />
                <View style={styles.rowText}>
                  <View style={styles.nameLine}>
                    <AppText variant="subhead" numberOfLines={1}>
                      {m.displayName ?? `@${m.publicShortId}`}
                    </AppText>
                    {m.role === 'ADMIN' ? (
                      <AppText variant="caption" color="brand">
                        Admin
                      </AppText>
                    ) : null}
                  </View>
                  <AppText variant="caption" color="textFaint">
                    Joined {relativeTime(m.joinedAt)}
                  </AppText>
                </View>
                {isAdmin && m.role !== 'ADMIN' ? (
                  <Pressable onPress={() => onKick(m)} hitSlop={8}>
                    <Ionicons name="close" size={18} color={colors.textFaint} />
                  </Pressable>
                ) : null}
              </View>
            ))}
          </View>

          {isAdmin ? (
            <Button
              label="Circle settings"
              variant="secondary"
              onPress={() => router.push(`/circles/${shortId}/settings`)}
            />
          ) : null}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  gutter: { paddingHorizontal: spacing[6] },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  body: { paddingHorizontal: spacing[6], paddingBottom: spacing[10], gap: spacing[7] },
  err: { marginBottom: spacing[2] },
  section: { gap: spacing[3] },
  inviteRow: { flexDirection: 'row', gap: spacing[3], alignItems: 'center' },
  inviteField: {
    flex: 1,
    height: 48,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth * 2,
    justifyContent: 'center',
    paddingHorizontal: spacing[4],
  },
  inviteInput: { padding: 0, letterSpacing: 1 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    padding: spacing[4],
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth * 2,
  },
  rowText: { flex: 1, gap: 2 },
  nameLine: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
});
