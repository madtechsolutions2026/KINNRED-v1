import React, { useMemo } from 'react';
import { View } from 'react-native';
import { DarkTheme, DefaultTheme, NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';

import { useTheme } from '../theme/ThemeContext';
import { useSession } from '../state/SessionContext';

import TabBar from './TabBar';
import MobileShell from '../components/MobileShell';
import EmptyState from '../components/EmptyState';

import GridScreen from '../screens/GridScreen';
import PingsScreen from '../screens/PingsScreen';
import CirclesScreen from '../screens/CirclesScreen';
import MySpaceScreen from '../screens/MySpaceScreen';
import ProfileScreen from '../screens/ProfileScreen';
import ChatScreen from '../screens/ChatScreen';
import AuthScreen from '../screens/AuthScreen';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

/** URL mapping, so react-native-web gets the prototype's routes verbatim. */
const linking = {
  prefixes: [],
  config: {
    screens: {
      Main: {
        screens: {
          Grid: '',
          Pings: 'pings',
          Circles: 'circles',
          MySpace: 'me',
        },
      },
      Profile: 'profile/:publicShortId',
      Chat: 'chat/:pingId',
      Auth: 'signin',
    },
  },
};

function MainTabs() {
  return (
    <Tab.Navigator
      tabBar={(props) => <TabBar {...props} />}
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: 'transparent' } }}
    >
      <Tab.Screen name="Grid" component={GridScreen} />
      <Tab.Screen name="Pings" component={PingsScreen} />
      <Tab.Screen name="Circles" component={CirclesScreen} />
      <Tab.Screen name="MySpace" component={MySpaceScreen} options={{ tabBarLabel: 'MySpace' }} />
    </Tab.Navigator>
  );
}

export default function RootNavigator() {
  const { colors, isDark } = useTheme();
  const { status } = useSession();

  // React Navigation keeps its own palette for the container background and
  // any chrome it draws itself; feed it the same tokens so a theme flip does
  // not leave a stale-coloured gap behind the shell.
  const navTheme = useMemo(() => {
    const base = isDark ? DarkTheme : DefaultTheme;
    return {
      ...base,
      colors: {
        ...base.colors,
        primary: colors.signal,
        background: colors.background,
        card: colors.card,
        text: colors.foreground,
        border: colors.border,
        notification: colors.signal,
      },
    };
  }, [isDark, colors]);

  return (
    <MobileShell>
      <NavigationContainer theme={navTheme} linking={linking}>
        {status === 'loading' ? (
          <View style={{ flex: 1, backgroundColor: colors.background }}>
            <EmptyState loading title="Kinnred" message="Restoring your session…" />
          </View>
        ) : (
          <Stack.Navigator
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: colors.background },
              animation: 'slide_from_right',
            }}
          >
            {status === 'signedOut' ? (
              <Stack.Screen name="Auth" component={AuthScreen} options={{ animation: 'fade' }} />
            ) : (
              <>
                <Stack.Screen name="Main" component={MainTabs} />
                <Stack.Screen name="Profile" component={ProfileScreen} />
                <Stack.Screen
                  name="Chat"
                  component={ChatScreen}
                  options={{ animation: 'slide_from_bottom' }}
                />
              </>
            )}
          </Stack.Navigator>
        )}
      </NavigationContainer>
    </MobileShell>
  );
}
