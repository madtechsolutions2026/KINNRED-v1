import { View } from 'react-native';
import { Redirect } from 'expo-router';
import { useAuth } from '@/lib/auth';
import { useTheme } from '@/theme/theme';

export default function Index() {
  const { status } = useAuth();
  const { colors } = useTheme();

  // Session probe is a quick SecureStore read; keep the splash colour until it
  // resolves so there is no white flash.
  if (status === 'loading') {
    return <View style={{ flex: 1, backgroundColor: colors.bg }} />;
  }

  return <Redirect href={status === 'signedIn' ? '/grid' : '/phone'} />;
}
