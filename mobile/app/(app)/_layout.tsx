import { Redirect, Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Platform, StyleSheet, type ColorValue } from 'react-native';
import { useAuth } from '@/lib/auth';
import { ProfileProvider } from '@/lib/profile';
import { PingsProvider, usePings } from '@/lib/pings';
import { CirclesProvider, useCircles } from '@/lib/circles';
import { useTheme } from '@/theme/theme';
import { fontFamily } from '@/theme/tokens';

type IconName = keyof typeof Ionicons.glyphMap;

function tabIcon(focused: IconName, unfocused: IconName) {
  return function Icon({
    color,
    focused: isFocused,
  }: {
    color: ColorValue;
    focused: boolean;
    size: number;
  }) {
    return (
      <Ionicons
        name={isFocused ? focused : unfocused}
        size={24}
        color={color as string}
      />
    );
  };
}

function TabsNav() {
  const { colors } = useTheme();
  const { badgeCount } = usePings();
  const { badgeCount: circleBadge } = useCircles();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.brand,
        tabBarInactiveTintColor: colors.textFaint,
        tabBarStyle: {
          backgroundColor: colors.bgElevated,
          borderTopColor: colors.border,
          borderTopWidth: StyleSheet.hairlineWidth,
          height: Platform.OS === 'ios' ? 88 : 64,
          paddingTop: 6,
        },
        tabBarLabelStyle: {
          fontFamily: fontFamily.bodyMedium,
          fontSize: 11,
          letterSpacing: 0.2,
        },
        tabBarBadgeStyle: {
          backgroundColor: colors.brand,
          fontFamily: fontFamily.bodyBold,
          fontSize: 10,
        },
        sceneStyle: { backgroundColor: colors.bg },
      }}
    >
      <Tabs.Screen
        name="grid"
        options={{ title: 'Grid', tabBarIcon: tabIcon('grid', 'grid-outline') }}
      />
      <Tabs.Screen
        name="pings"
        options={{
          title: 'Pings',
          tabBarIcon: tabIcon('chatbubble', 'chatbubble-outline'),
          tabBarBadge: badgeCount > 0 ? badgeCount : undefined,
        }}
      />
      <Tabs.Screen
        name="circles"
        options={{
          title: 'Circles',
          tabBarIcon: tabIcon('people', 'people-outline'),
          tabBarBadge: circleBadge > 0 ? circleBadge : undefined,
        }}
      />
      <Tabs.Screen
        name="myspace"
        options={{
          title: 'Myspace',
          tabBarIcon: tabIcon('person', 'person-outline'),
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
