import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { BackButton } from './BackButton';
import { AppText } from './AppText';
import { spacing } from '@/theme/tokens';

interface Props {
  title?: string;
  onBack?: () => void;
  showBack?: boolean;
  right?: ReactNode;
}

export function ScreenHeader({ title, onBack, showBack = true, right }: Props) {
  return (
    <View style={styles.row}>
      <View style={styles.side}>
        {showBack ? <BackButton onPress={onBack} /> : null}
      </View>
      {title ? (
        <AppText variant="headline" numberOfLines={1} style={styles.title}>
          {title}
        </AppText>
      ) : (
        <View style={styles.title} />
      )}
      <View style={[styles.side, styles.right]}>{right}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: spacing[4],
    paddingBottom: spacing[5],
  },
  side: { width: 60, justifyContent: 'center' },
  right: { alignItems: 'flex-end' },
  title: { flex: 1, textAlign: 'center' },
});
