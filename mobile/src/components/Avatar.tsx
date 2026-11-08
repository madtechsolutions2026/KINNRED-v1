import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { radius, typeScale } from '@/theme/tokens';
import { useTheme } from '@/theme/theme';
import { AppText } from './AppText';

interface Props {
  uri?: string | null;
  name?: string | null;
  size?: number;
  blurred?: boolean;
  /** When set, the avatar is tappable — used to jump to the photo editor. */
  onPress?: () => void;
  /** Shows a small camera badge, signalling the avatar can be changed. */
  editable?: boolean;
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

export function Avatar({
  uri,
  name,
  size = 64,
  blurred = false,
  onPress,
  editable = false,
}: Props) {
  const { colors } = useTheme();
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [uri]);
  const radiusValue = size >= 96 ? radius.xl : radius.lg;
  const showImage = uri && !failed;
  const badgeSize = Math.max(22, Math.round(size * 0.3));

  const circle = (
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
      {!showImage && <LinearGradient colors={["#FFE9DF","#EFD8CE"]} style={StyleSheet.absoluteFill} />}
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
            { color: "#9B5941", fontSize: size * 0.34 },
          ]}
        >
          {initials(name)}
        </AppText>
      )}
    </View>
  );

  if (!onPress && !editable) return circle;

  const content = (
    <View style={{ width: size, height: size }}>
      {circle}
      {editable ? (
        <View
          style={[
            styles.badge,
            {
              width: badgeSize,
              height: badgeSize,
              borderRadius: badgeSize / 2,
              backgroundColor: colors.brand,
              borderColor: colors.bg,
            },
          ]}
        >
          <Ionicons
            name="camera"
            size={badgeSize * 0.55}
            color={colors.textOnBrand}
          />
        </View>
      ) : null}
    </View>
  );

  if (!onPress) return content;

  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={editable ? 'Change profile photo' : 'View photos'}
      style={({ pressed }) => [pressed && styles.pressed]}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth * 2,
  },
  pressed: { opacity: 0.85 },
  badge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
  },
});
