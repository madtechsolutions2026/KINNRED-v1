import { Stack } from 'expo-router';
import { useTheme } from '@/theme/theme';

export default function CirclesLayout() {
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
      <Stack.Screen name="create" options={{ animation: 'slide_from_bottom' }} />
      <Stack.Screen name="[shortId]" />
    </Stack>
  );
}
