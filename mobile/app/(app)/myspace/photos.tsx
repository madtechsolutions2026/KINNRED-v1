import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { ScreenHeader } from '@/components/ScreenHeader';
import { useProfile } from '@/lib/profile';
import {
  deletePhoto,
  listOwnPhotos,
  uploadProfilePhoto,
  waitForProcessing,
  type OwnMediaAsset,
  type UploadContentType,
} from '@/lib/media-api';
import { ApiError } from '@/lib/api';
import { radius, spacing } from '@/theme/tokens';
import { useTheme } from '@/theme/theme';

const MAX_PHOTOS = 9;

function mimeFromUri(uri: string): UploadContentType | null {
  const ext = uri.split('?')[0].split('.').pop()?.toLowerCase();
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  return null;
}

export default function PhotosScreen() {
  const { colors } = useTheme();
  const { profile, reload } = useProfile();

  const [assets, setAssets] = useState<OwnMediaAsset[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Local file URIs of photos still being processed server-side, keyed by
  // assetId. Lets the freshly-picked image show immediately instead of a
  // "Processing" placeholder; dropped once the asset lands in profile.photos.
  const [localPreviews, setLocalPreviews] = useState<Record<string, string>>({});

  const refreshAssets = useCallback(async () => {
    try {
      setAssets(await listOwnPhotos());
    } catch {
      /* non-fatal — READY photos still come from the profile */
    }
  }, []);

  useEffect(() => {
    void refreshAssets();
  }, [refreshAssets]);

  const ready = profile?.photos ?? [];
  const pending = assets.filter(
    (a) => a.status === 'PENDING' || a.status === 'PROCESSING',
  );

  // Once a preview's asset is READY (in profile.photos) or no longer pending,
  // stop tracking its local URI.
  useEffect(() => {
    setLocalPreviews((cur) => {
      const stillPending = new Set(pending.map((a) => a.id));
      const next = Object.fromEntries(
        Object.entries(cur).filter(([id]) => stillPending.has(id)),
      );
      return Object.keys(next).length === Object.keys(cur).length ? cur : next;
    });
  }, [pending]);
  const rejected = assets.filter((a) => a.status === 'REJECTED');
  const total = ready.length + pending.length;

  const addPhoto = useCallback(async () => {
    setError(null);
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      setError('Photo library access is needed to add a photo.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.85,
      allowsEditing: true,
      aspect: [1, 1],
    });
    if (result.canceled) return;

    const picked = result.assets[0];
    const mimeType =
      (picked.mimeType as UploadContentType | undefined) ??
      mimeFromUri(picked.uri) ??
      'image/jpeg';

    setBusy(true);
    setStatus('Uploading…');
    try {
      const { assetId } = await uploadProfilePhoto({
        uri: picked.uri,
        mimeType,
        fileSize: picked.fileSize,
      });
      setLocalPreviews((cur) => ({ ...cur, [assetId]: picked.uri }));
      setStatus('Processing…');
      await refreshAssets();
      const done = await waitForProcessing(assetId);
      if (done.status === 'REJECTED') {
        setError(done.rejectionReason ?? 'That photo didn’t pass checks.');
      }
      await Promise.all([reload(), refreshAssets()]);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Upload failed. Try again.');
      await refreshAssets();
    } finally {
      setBusy(false);
      setStatus(null);
    }
  }, [reload, refreshAssets]);

  const removePhoto = useCallback(
    (id: string) => {
      const doDelete = async () => {
        setBusy(true);
        setError(null);
        try {
          await deletePhoto(id);
          await Promise.all([reload(), refreshAssets()]);
        } catch (e) {
          setError(e instanceof ApiError ? e.message : 'Couldn’t remove that.');
        } finally {
          setBusy(false);
        }
      };
      Alert.alert('Remove photo?', 'This can’t be undone.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: () => void doDelete() },
      ]);
    },
    [reload, refreshAssets],
  );

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]}>
      <View style={styles.gutter}>
        <ScreenHeader title="Photos" />
      </View>

      <ScrollView
        contentContainerStyle={styles.body}
        showsVerticalScrollIndicator={false}
      >
        <AppText variant="footnote" color="textMuted">
          {total}/{MAX_PHOTOS} photos.{' '}
          {profile?.photosLocked
            ? 'Your photos are locked — others see them blurred until you ping them or accept their ping.'
            : 'Your photos are visible to people nearby.'}
        </AppText>

        <View style={styles.grid}>
          {ready.map((photo) => (
            <View key={photo.id} style={styles.cell}>
              <Image
                source={{ uri: photo.url }}
                style={styles.img}
                contentFit="cover"
                transition={150}
              />
              <RemoveButton onPress={() => removePhoto(photo.id)} disabled={busy} />
            </View>
          ))}

          {pending.map((a) =>
            localPreviews[a.id] ? (
              <View key={a.id} style={styles.cell}>
                <Image
                  source={{ uri: localPreviews[a.id] }}
                  style={styles.img}
                  contentFit="cover"
                  transition={150}
                />
                <View style={styles.processingTag}>
                  <Ionicons name="sync" size={11} color="#fff" />
                  <AppText variant="caption" style={styles.processingText}>
                    Processing
                  </AppText>
                </View>
              </View>
            ) : (
              <View
                key={a.id}
                style={[
                  styles.cell,
                  styles.placeholder,
                  { backgroundColor: colors.surface, borderColor: colors.border },
                ]}
              >
                <Ionicons name="cloud-upload-outline" size={22} color={colors.textFaint} />
                <AppText variant="caption" color="textFaint">
                  {a.status === 'PENDING' ? 'Waiting' : 'Processing'}
                </AppText>
              </View>
            ),
          )}

          {total < MAX_PHOTOS ? (
            <Pressable
              onPress={addPhoto}
              disabled={busy}
              style={[
                styles.cell,
                styles.placeholder,
                {
                  backgroundColor: colors.surface,
                  borderColor: colors.fieldBorderFocused,
                  opacity: busy ? 0.5 : 1,
                },
              ]}
            >
              <Ionicons name="add" size={28} color={colors.brand} />
              <AppText variant="caption" color="brand">
                Add
              </AppText>
            </Pressable>
          ) : null}
        </View>

        {status ? (
          <AppText variant="footnote" color="textMuted" style={styles.line}>
            {status}
          </AppText>
        ) : null}
        {error ? (
          <AppText variant="footnote" color="danger" style={styles.line}>
            {error}
          </AppText>
        ) : null}

        {rejected.length > 0 ? (
          <View style={styles.rejectedBlock}>
            <AppText variant="overline" color="textFaint">
              Didn’t pass checks
            </AppText>
            {rejected.map((a) => (
              <View
                key={a.id}
                style={[
                  styles.rejectedRow,
                  { backgroundColor: colors.surface, borderColor: colors.border },
                ]}
              >
                <View style={styles.rejectedText}>
                  <AppText variant="footnote">
                    {a.rejectionReason ?? 'Rejected'}
                  </AppText>
                </View>
                <Pressable onPress={() => removePhoto(a.id)} hitSlop={8}>
                  <AppText variant="subhead" color="danger">
                    Dismiss
                  </AppText>
                </Pressable>
              </View>
            ))}
          </View>
        ) : null}

        <View style={styles.footer}>
          <Button
            label="Add a photo"
            onPress={addPhoto}
            loading={busy}
            disabled={total >= MAX_PHOTOS}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function RemoveButton({
  onPress,
  disabled,
}: {
  onPress: () => void;
  disabled?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={6}
      style={[styles.remove, { backgroundColor: colors.bg }]}
    >
      <Ionicons name="close" size={16} color={colors.text} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  gutter: { paddingHorizontal: spacing[6] },
  body: { paddingHorizontal: spacing[6], paddingBottom: spacing[10], gap: spacing[5] },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[4] },
  cell: {
    width: '30%',
    aspectRatio: 1,
    borderRadius: radius.md,
    overflow: 'visible',
  },
  img: { flex: 1, borderRadius: radius.md },
  placeholder: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    borderWidth: 1.5,
  },
  processingTag: {
    position: 'absolute',
    left: 4,
    bottom: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  processingText: { color: '#fff' },
  remove: {
    position: 'absolute',
    top: -8,
    right: -8,
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  line: {},
  rejectedBlock: { gap: spacing[3] },
  rejectedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing[4],
    padding: spacing[4],
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth * 2,
  },
  rejectedText: { flex: 1 },
  footer: { marginTop: spacing[6] },
});
