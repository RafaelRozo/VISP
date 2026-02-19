/**
 * VISP - App Navigator
 *
 * Root navigation structure with:
 * - Auth flow (Login, Register, ForgotPassword)
 * - Customer tab navigator (Home, Jobs, Profile)
 * - Provider tab navigator (Dashboard, Jobs, Earnings, Profile)
 * - Profile stack navigator (Profile, Credentials, Verification, Settings)
 * - Type-safe navigation params throughout
 */

import React, { useEffect } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { AnimatedSpinner } from '../components/animations';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Colors } from '../theme/colors';
import { GlassStyles } from '../theme/glass';
import { requestLocationPermission, saveUserLocation } from '../services/geolocationService';

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
import JobTrackingScreen from '../screens/customer/JobTrackingScreen';
import MyJobsScreen from '../screens/customer/MyJobsScreen';

// Screens - Provider
import DashboardScreen from '../screens/provider/DashboardScreen';
import JobOffersScreen from '../screens/provider/JobOffersScreen';
import ActiveJobScreen from '../screens/provider/ActiveJobScreen';
import EarningsScreen from '../screens/provider/EarningsScreen';
import ScheduleScreen from '../screens/provider/ScheduleScreen';
import ProviderOnboardingScreen from '../screens/provider/ProviderOnboardingScreen';
import ServiceCatalogScreen from '../screens/provider/ServiceCatalogScreen';

// Screens - Profile
import ProfileScreen from '../screens/profile/ProfileScreen';
import CredentialsScreen from '../screens/profile/CredentialsScreen';
import VerificationScreen from '../screens/profile/VerificationScreen';
import SettingsScreen from '../screens/profile/SettingsScreen';
import PaymentMethodsScreen from '../screens/profile/PaymentMethodsScreen';

// Screens - Shared
import ChatScreen from '../screens/shared/ChatScreen';

// CustomerJobsScreen is now MyJobsScreen (imported above)

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
    backgroundColor: 'rgba(10, 10, 30, 0.80)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.08)',
  },
  headerTintColor: '#FFFFFF',
  headerTitleStyle: {
    fontWeight: '600' as const,
    color: '#FFFFFF',
  },
  headerShadowVisible: false,
  contentStyle: {
    backgroundColor: Colors.background,
  },
};

const TAB_OPTIONS = {
  tabBarStyle: {
    ...GlassStyles.tabBar,
    position: 'absolute' as const,
    elevation: 0,
    paddingBottom: 4,
    height: 56,
  },
  tabBarActiveTintColor: Colors.primary,
  tabBarInactiveTintColor: 'rgba(255, 255, 255, 0.4)',
  tabBarLabelStyle: {
    fontSize: 11,
    fontWeight: '600' as const,
  },
  headerStyle: {
    backgroundColor: 'rgba(10, 10, 30, 0.80)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.08)',
  },
  headerTintColor: '#FFFFFF',
  headerTitleStyle: {
    fontWeight: '600' as const,
    color: '#FFFFFF',
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
          { color: focused ? Colors.primary : 'rgba(255, 255, 255, 0.4)' },
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

// Provider stack for JobOffers + ServiceCatalog + ActiveJob + Chat (nested inside tab)
type ProviderJobStackParamList = {
  JobOffers: undefined;
  ServiceCatalog: undefined;
  ActiveJob: { jobId: string };
  Chat: { jobId: string; otherUserName: string };
};
const ProviderJobStack = createNativeStackNavigator<ProviderJobStackParamList>();

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
      <ProfileStack.Screen
        name="ProviderOnboarding"
        component={ProviderOnboardingScreen}
        options={{ title: 'My Services' }}
      />
      <ProfileStack.Screen
        name="PaymentMethods"
        component={PaymentMethodsScreen}
        options={{ title: 'Payment Methods' }}
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
        options={({ navigation }) => ({
          title: 'Job Offers',
          headerRight: () => (
            <TouchableOpacity
              onPress={() => navigation.navigate('ServiceCatalog')}
              style={{ paddingHorizontal: 8 }}
            >
              <Text style={{ color: Colors.primary, fontWeight: '600', fontSize: 14 }}>
                My Services
              </Text>
            </TouchableOpacity>
          ),
        })}
      />
      <ProviderJobStack.Screen
        name="ServiceCatalog"
        component={ServiceCatalogScreen}
        options={{ title: 'My Services' }}
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
      <AuthStack.Screen
        name="ProviderOnboarding"
        component={ProviderOnboardingScreen}
        options={{ title: 'Select Services', headerShown: true }}
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
        component={MyJobsScreen}
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
        name="JobsTab"
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

  // Request location permission and save position once authenticated
  useEffect(() => {
    if (isAuthenticated) {
      requestLocationPermission().then((granted) => {
        if (granted) {
          saveUserLocation();
        }
      });
    }
  }, [isAuthenticated]);

  if (isRestoring) {
    return (
      <View style={loadingStyles.container}>
        <AnimatedSpinner size={48} color={Colors.primary} />
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
              options={{ headerShown: false }}
            >
              {(props: any) => (
                <CustomerNavigator
                  initialCategoryId={props.route.params?.categoryId}
                  initialCategoryName={props.route.params?.categoryName}
                />
              )}
            </RootStack.Screen>
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
            <RootStack.Screen
              name="JobTracking"
              component={JobTrackingScreen}
              options={{
                headerShown: true,
                ...SCREEN_OPTIONS,
                title: 'Job Status',
                headerBackTitle: 'Back',
              }}
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
