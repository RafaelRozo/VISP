/**
 * VISP/Tasker - App Navigator
 *
 * Root navigation structure with:
 * - Auth flow (Login, Register, ForgotPassword)
 * - Customer tab navigator (Home, Jobs, Profile)
 * - Provider tab navigator (Dashboard, Jobs, Earnings, Profile)
 * - Profile stack navigator (Profile, Credentials, Verification, Settings)
 * - Type-safe navigation params throughout
 */

import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Colors } from '../theme/colors';

import type {
  AuthStackParamList,
  CustomerTabParamList,
  ProfileStackParamList,
  ProviderTabParamList,
  RootStackParamList,
} from '../types';

import { useAuthStore } from '../stores/authStore';

// Navigators - Customer & Emergency Flows
import CustomerNavigator from './CustomerNavigator';
import EmergencyNavigator from './EmergencyNavigator';

// Screens - Auth
import LoginScreen from '../screens/auth/LoginScreen';
import RegisterScreen from '../screens/auth/RegisterScreen';
import ForgotPasswordScreen from '../screens/auth/ForgotPasswordScreen';

// Screens - Customer
import CustomerHomeScreen from '../screens/customer/HomeScreen';

// Screens - Provider
import DashboardScreen from '../screens/provider/DashboardScreen';
import JobOffersScreen from '../screens/provider/JobOffersScreen';
import ActiveJobScreen from '../screens/provider/ActiveJobScreen';
import EarningsScreen from '../screens/provider/EarningsScreen';
import ScheduleScreen from '../screens/provider/ScheduleScreen';

// Screens - Profile
import ProfileScreen from '../screens/profile/ProfileScreen';
import CredentialsScreen from '../screens/profile/CredentialsScreen';
import VerificationScreen from '../screens/profile/VerificationScreen';
import SettingsScreen from '../screens/profile/SettingsScreen';

// Screens - Shared
import ChatScreen from '../screens/shared/ChatScreen';

// ---------------------------------------------------------------------------
// Placeholder for customer jobs (not yet built as standalone screen)
// ---------------------------------------------------------------------------

function CustomerJobsScreen() {
  return (
    <View style={placeholderStyles.container}>
      <Text style={placeholderStyles.text}>My Jobs</Text>
      <Text style={placeholderStyles.subtext}>No active jobs</Text>
    </View>
  );
}

const placeholderStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginBottom: 8,
  },
  subtext: {
    fontSize: 14,
    color: Colors.textSecondary,
  },
});

// ---------------------------------------------------------------------------
// Screen options
// ---------------------------------------------------------------------------

const SCREEN_OPTIONS = {
  headerStyle: {
    backgroundColor: Colors.surface,
  },
  headerTintColor: Colors.textPrimary,
  headerTitleStyle: {
    fontWeight: '600' as const,
  },
  headerShadowVisible: false,
  contentStyle: {
    backgroundColor: Colors.background,
  },
};

const TAB_OPTIONS = {
  tabBarStyle: {
    backgroundColor: Colors.surface,
    borderTopColor: Colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingBottom: 4,
    height: 56,
  },
  tabBarActiveTintColor: Colors.primary,
  tabBarInactiveTintColor: Colors.textTertiary,
  tabBarLabelStyle: {
    fontSize: 11,
    fontWeight: '600' as const,
  },
  headerStyle: {
    backgroundColor: Colors.surface,
  },
  headerTintColor: Colors.textPrimary,
  headerTitleStyle: {
    fontWeight: '600' as const,
  },
  headerShadowVisible: false,
};

// ---------------------------------------------------------------------------
// Tab icon helper (text-based, replace with icon library in production)
// ---------------------------------------------------------------------------

function TabIcon({
  label,
  focused,
}: {
  label: string;
  focused: boolean;
}): React.JSX.Element {
  return (
    <View style={tabIconStyles.container}>
      <Text
        style={[
          tabIconStyles.icon,
          { color: focused ? Colors.primary : Colors.textTertiary },
        ]}
      >
        {label}
      </Text>
    </View>
  );
}

const tabIconStyles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 24,
    height: 24,
  },
  icon: {
    fontSize: 16,
    fontWeight: '700',
  },
});

// ---------------------------------------------------------------------------
// Stack Navigators
// ---------------------------------------------------------------------------

const AuthStack = createNativeStackNavigator<AuthStackParamList>();
const RootStack = createNativeStackNavigator<RootStackParamList>();
const ProfileStack = createNativeStackNavigator<ProfileStackParamList>();

// Provider stack for ActiveJob + Chat (nested inside tab)
const ProviderJobStack = createNativeStackNavigator<
  Pick<ProviderTabParamList, 'JobOffers' | 'ActiveJob' | 'Chat'>
>();

// ---------------------------------------------------------------------------
// Tab Navigators
// ---------------------------------------------------------------------------

const CustomerTab = createBottomTabNavigator<CustomerTabParamList>();
const ProviderTab = createBottomTabNavigator<ProviderTabParamList>();

// ---------------------------------------------------------------------------
// Profile Stack Navigator
// ---------------------------------------------------------------------------

function ProfileStackNavigator(): React.JSX.Element {
  return (
    <ProfileStack.Navigator screenOptions={SCREEN_OPTIONS}>
      <ProfileStack.Screen
        name="ProfileMain"
        component={ProfileScreen}
        options={{ title: 'Profile' }}
      />
      <ProfileStack.Screen
        name="Credentials"
        component={CredentialsScreen}
        options={{ title: 'My Credentials' }}
      />
      <ProfileStack.Screen
        name="Verification"
        component={VerificationScreen}
        options={{ title: 'Verification' }}
      />
      <ProfileStack.Screen
        name="Settings"
        component={SettingsScreen}
        options={{ title: 'Settings' }}
      />
    </ProfileStack.Navigator>
  );
}

// ---------------------------------------------------------------------------
// Provider Jobs Stack (Offers + Active Job)
// ---------------------------------------------------------------------------

function ProviderJobStackNavigator(): React.JSX.Element {
  return (
    <ProviderJobStack.Navigator screenOptions={SCREEN_OPTIONS}>
      <ProviderJobStack.Screen
        name="JobOffers"
        component={JobOffersScreen}
        options={{ title: 'Job Offers' }}
      />
      <ProviderJobStack.Screen
        name="ActiveJob"
        component={ActiveJobScreen}
        options={{ title: 'Active Job' }}
      />
      <ProviderJobStack.Screen
        name="Chat"
        component={ChatScreen}
        options={({ route }) => ({
          title: `Chat - ${(route.params as { otherUserName: string }).otherUserName}`,
        })}
      />
    </ProviderJobStack.Navigator>
  );
}

// ---------------------------------------------------------------------------
// Auth Flow
// ---------------------------------------------------------------------------

function AuthNavigator(): React.JSX.Element {
  return (
    <AuthStack.Navigator
      screenOptions={{
        ...SCREEN_OPTIONS,
        headerShown: false,
      }}
    >
      <AuthStack.Screen name="Login" component={LoginScreen} />
      <AuthStack.Screen name="Register" component={RegisterScreen} />
      <AuthStack.Screen
        name="ForgotPassword"
        component={ForgotPasswordScreen}
      />
    </AuthStack.Navigator>
  );
}

// ---------------------------------------------------------------------------
// Customer Tab Navigator
// ---------------------------------------------------------------------------

function CustomerTabNavigator(): React.JSX.Element {
  return (
    <CustomerTab.Navigator screenOptions={TAB_OPTIONS}>
      <CustomerTab.Screen
        name="Home"
        component={CustomerHomeScreen}
        options={{
          title: 'Home',
          headerShown: false,
          tabBarIcon: ({ focused }) => (
            <TabIcon label="H" focused={focused} />
          ),
        }}
      />
      <CustomerTab.Screen
        name="MyJobs"
        component={CustomerJobsScreen}
        options={{
          title: 'My Jobs',
          tabBarIcon: ({ focused }) => (
            <TabIcon label="J" focused={focused} />
          ),
        }}
      />
      <CustomerTab.Screen
        name="CustomerProfile"
        component={ProfileStackNavigator}
        options={{
          title: 'Profile',
          headerShown: false,
          tabBarIcon: ({ focused }) => (
            <TabIcon label="P" focused={focused} />
          ),
        }}
      />
    </CustomerTab.Navigator>
  );
}

// ---------------------------------------------------------------------------
// Provider Tab Navigator
// ---------------------------------------------------------------------------

function ProviderTabNavigator(): React.JSX.Element {
  return (
    <ProviderTab.Navigator screenOptions={TAB_OPTIONS}>
      <ProviderTab.Screen
        name="Dashboard"
        component={DashboardScreen}
        options={{
          title: 'Dashboard',
          tabBarIcon: ({ focused }) => (
            <TabIcon label="D" focused={focused} />
          ),
        }}
      />
      <ProviderTab.Screen
        name="JobOffers"
        component={ProviderJobStackNavigator}
        options={{
          title: 'Jobs',
          headerShown: false,
          tabBarIcon: ({ focused }) => (
            <TabIcon label="J" focused={focused} />
          ),
        }}
      />
      <ProviderTab.Screen
        name="Earnings"
        component={EarningsScreen}
        options={{
          title: 'Earnings',
          tabBarIcon: ({ focused }) => (
            <TabIcon label="$" focused={focused} />
          ),
        }}
      />
      <ProviderTab.Screen
        name="Schedule"
        component={ScheduleScreen}
        options={{
          title: 'Schedule',
          tabBarIcon: ({ focused }) => (
            <TabIcon label="S" focused={focused} />
          ),
        }}
      />
      <ProviderTab.Screen
        name="ProviderProfile"
        component={ProfileStackNavigator}
        options={{
          title: 'Profile',
          headerShown: false,
          tabBarIcon: ({ focused }) => (
            <TabIcon label="P" focused={focused} />
          ),
        }}
      />
    </ProviderTab.Navigator>
  );
}

// ---------------------------------------------------------------------------
// Root Navigator
// ---------------------------------------------------------------------------

export default function AppNavigator(): React.JSX.Element {
  const { isAuthenticated, isRestoring, user } = useAuthStore();
  const userRole = user?.role ?? 'customer';

  if (isRestoring) {
    return (
      <View style={loadingStyles.container}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  return (
    <NavigationContainer>
      <RootStack.Navigator
        screenOptions={{
          ...SCREEN_OPTIONS,
          headerShown: false,
        }}
      >
        {!isAuthenticated ? (
          <RootStack.Screen name="Auth" component={AuthNavigator} />
        ) : userRole === 'customer' ? (
          <>
            <RootStack.Screen
              name="CustomerHome"
              component={CustomerTabNavigator}
            />
            <RootStack.Screen
              name="CategoryDetail"
              component={CustomerNavigator}
              options={{ headerShown: false }}
            />
            <RootStack.Screen
              name="EmergencyFlow"
              component={EmergencyNavigator}
              options={{ headerShown: false }}
            />
            <RootStack.Screen
              name="Chat"
              component={ChatScreen}
              options={({ route }) => ({
                headerShown: true,
                ...SCREEN_OPTIONS,
                title: `Chat - ${(route.params as { otherUserName: string }).otherUserName}`,
              })}
            />
          </>
        ) : (
          <>
            <RootStack.Screen
              name="ProviderHome"
              component={ProviderTabNavigator}
            />
            <RootStack.Screen
              name="Chat"
              component={ChatScreen}
              options={({ route }) => ({
                headerShown: true,
                ...SCREEN_OPTIONS,
                title: `Chat - ${(route.params as { otherUserName: string }).otherUserName}`,
              })}
            />
          </>
        )}
      </RootStack.Navigator>
    </NavigationContainer>
  );
}

const loadingStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
