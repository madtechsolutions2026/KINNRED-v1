import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { radius, typeScale } from '@/theme/tokens';
import { useTheme } from '@/theme/theme';
import { AppText } from './AppText';

interface Props {
  uri?: string | null;
  name?: string | null;
  size?: number;
  blurred?: boolean;
}

function initials(name?: string | null): string {
  if (!name) return '';
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

export function Avatar({ uri, name, size = 64, blurred = false }: Props) {
  const { colors } = useTheme();
  const [failed, setFailed] = useState(false);
  const radiusValue = size >= 96 ? radius.xl : radius.lg;
  const showImage = uri && !failed;

  return (
    <View
      style={[
        styles.wrap,
        {
          width: size,
          height: size,
          borderRadius: radiusValue,
          backgroundColor: colors.surface,
          borderColor: colors.border,
        },
      ]}
    >
      {showImage ? (
        <Image
          source={{ uri }}
          style={{ width: size, height: size }}
          contentFit="cover"
          transition={200}
          blurRadius={blurred ? 18 : 0}
          onError={() => setFailed(true)}
        />
      ) : (
        <AppText
          style={[
            typeScale.headline,
            { color: colors.textFaint, fontSize: size * 0.34 },
          ]}
        >
          {initials(name)}
        </AppText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth * 2,
  },
});
