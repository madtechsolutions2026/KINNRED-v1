import { useEffect, useState } from 'react';
import { Keyboard } from 'react-native';
import { Redirect, Tabs, usePathname } from 'expo-router';
import { useAuth } from '@/lib/auth';
import { ProfileProvider } from '@/lib/profile';
import { PingsProvider, usePings } from '@/lib/pings';
import { CirclesProvider, useCircles } from '@/lib/circles';
import { useTheme } from '@/theme/theme';
import { FloatingNavigation } from '@/components/FloatingNavigation';

function TabsNav() {
  const { colors } = useTheme();
  const [keyboardVisible, setKeyboardVisible] = useState(Keyboard.isVisible());
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => setKeyboardVisible(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardVisible(false));
    return () => { show.remove(); hide.remove(); };
  }, []);
  const pathParts = usePathname().split('/').filter(Boolean);
  const showNavigation = pathParts.length === 1;
  const { badgeCount } = usePings();
  const { badgeCount: circleBadge } = useCircles();

  return (
    <Tabs
      tabBar={({ state, navigation }) => !showNavigation || keyboardVisible ? null : <FloatingNavigation
        active={pathParts[0] ?? 'grid'} badges={{ pings: badgeCount, circles: circleBadge }}
        onNavigate={(name) => {
          const route = state.routes.find((r) => r.name === name);
          if (!route) return;
          const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
          if (!event.defaultPrevented) navigation.navigate(route.name, route.params);
        }} />}
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: colors.bg } }}
    >
      <Tabs.Screen
        name="grid"
        options={{ title: 'Grid' }}
      />
      <Tabs.Screen
        name="pings"
        options={{
          title: 'Pings',
          tabBarBadge: badgeCount > 0 ? badgeCount : undefined,
        }}
      />
      <Tabs.Screen
        name="circles"
        options={{
          title: 'Circles',
          tabBarBadge: circleBadge > 0 ? circleBadge : undefined,
        }}
      />
      <Tabs.Screen
        name="myspace"
        options={{
          title: 'Myspace',
        }}
      />
    </Tabs>
  );
}

export default function AppLayout() {
  const { status } = useAuth();

  if (status === 'loading') return null;
  if (status === 'signedOut') return <Redirect href="/phone" />;

  return (
    <ProfileProvider>
      <PingsProvider>
        <CirclesProvider>
          <TabsNav />
        </CirclesProvider>
      </PingsProvider>
    </ProfileProvider>
  );
}
