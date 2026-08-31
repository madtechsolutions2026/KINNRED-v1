import { useEffect, useState } from 'react';
import { Share, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SvgXml } from 'react-native-svg';
import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { ScreenHeader } from '@/components/ScreenHeader';
import { getMyQr, type QrPayload } from '@/lib/users-api';
import { ApiError } from '@/lib/api';
import { radius, spacing } from '@/theme/tokens';
import { useTheme } from '@/theme/theme';

export default function QrScreen() {
  const { colors } = useTheme();
  const [qr, setQr] = useState<QrPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getMyQr()
      .then(setQr)
      .catch((e) =>
        setError(e instanceof ApiError ? e.message : 'Couldn’t load your code.'),
      );
  }, []);

  // Recolour the QR. `qrcode` emits the light modules as #ffffff and the dark
  // modules as #000000 (on either fill or stroke), so swap the light colour to
  // transparent and the dark colour to the theme's foreground.
  const themedSvg = qr?.svg
    .replace(/#ffffff/gi, 'none')
    .replace(/#000000/gi, colors.text);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]}>
      <View style={styles.gutter}>
        <ScreenHeader title="Your QR" />
      </View>

      <View style={styles.body}>
        {error ? (
          <AppText color="danger" align="center">
            {error}
          </AppText>
        ) : qr && themedSvg ? (
          <>
            <View
              style={[
                styles.card,
                { backgroundColor: colors.surface, borderColor: colors.border },
              ]}
            >
              <SvgXml xml={themedSvg} width={220} height={220} />
            </View>
            <View style={styles.meta}>
              <AppText variant="title">@{qr.publicShortId}</AppText>
              <AppText variant="footnote" color="textMuted" align="center">
                Anyone who scans this opens your profile. It encodes only your
                public ID — never your number.
              </AppText>
            </View>
            <Button
              label="Share link"
              fullWidth={false}
              onPress={() =>
                void Share.share({
                  message: qr.webLink,
                  url: qr.webLink,
                })
              }
            />
          </>
        ) : (
          <AppText color="textMuted">Loading…</AppText>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  gutter: { paddingHorizontal: spacing[6] },
  body: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[7],
    padding: spacing[6],
  },
  card: {
    padding: spacing[6],
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth * 2,
  },
  meta: { alignItems: 'center', gap: spacing[3], maxWidth: 320 },
});
