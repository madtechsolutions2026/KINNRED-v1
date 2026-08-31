import { Stack } from 'expo-router';
import { useTheme } from '@/theme/theme';

export default function PingsLayout() {
  const { colors } = useTheme();
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.bg },
        animation: 'slide_from_right',
      }}
    >
      <Stack.Screen name="index" />
      <Stack.Screen name="[pingId]" />
    </Stack>
  );
}
