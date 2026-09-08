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

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { AnimatedSpinner } from '../components/animations';
import Svg, { Defs, LinearGradient, Stop, Path } from 'react-native-svg';
import { NavigationContainer, NavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Colors } from '../theme/colors';
import { GlassStyles } from '../theme/glass';
import { useTheme } from '../theme/ThemeContext';
import { useTranslation } from '../i18n';
import { requestLocationPermission, saveUserLocation } from '../services/geolocationService';
import { notificationService, NotificationData } from '../services/notificationService';

import type {
  AuthStackParamList,
  CustomerTabParamList,
  ProfileStackParamList,
  ProviderTabParamList,
  RootStackParamList,
} from '../types';

import { useAuthStore } from '../stores/authStore';
import { useCompanyStore } from '../stores/companyStore';

// Navigators - Customer & Emergency Flows
import CustomerNavigator from './CustomerNavigator';
import EmergencyNavigator from './EmergencyNavigator';

// Screens - Auth
import LoginScreen from '../screens/auth/LoginScreen';
import RegisterScreen from '../screens/auth/RegisterScreen';
import CompanyJoinScreen from '../screens/auth/CompanyJoinScreen';
import ForgotPasswordScreen from '../screens/auth/ForgotPasswordScreen';

// Screens - Customer
import CustomerHomeScreen from '../screens/customer/HomeScreen';
import JobTrackingScreen from '../screens/customer/JobTrackingScreen';
import OffersScreen from '../screens/customer/OffersScreen';
import MyJobsScreen from '../screens/customer/MyJobsScreen';

// Screens - Provider
import DashboardScreen from '../screens/provider/DashboardScreen';
import JobOffersScreen from '../screens/provider/JobOffersScreen';
import ActiveJobScreen from '../screens/provider/ActiveJobScreen';
import EarningsScreen from '../screens/provider/EarningsScreen';
import ScheduleScreen from '../screens/provider/ScheduleScreen';
import ProviderOnboardingScreen from '../screens/provider/ProviderOnboardingScreen';
import ServiceCatalogScreen from '../screens/provider/ServiceCatalogScreen';
import MyPricesScreen from '../screens/provider/MyPricesScreen';
import PayoutsOnboardingScreen from '../screens/provider/payouts/PayoutsOnboardingScreen';
import PayoutsPersonalInfoStep from '../screens/provider/payouts/PersonalInfoStep';
import PayoutsTaxStep from '../screens/provider/payouts/TaxStep';
import PayoutsBankStep from '../screens/provider/payouts/BankStep';
import PayoutsIdentityDocStep from '../screens/provider/payouts/IdentityDocStep';
import PayoutsTosStep from '../screens/provider/payouts/TosStep';

// Screens - Profile
import ProfileScreen from '../screens/profile/ProfileScreen';
import CredentialsScreen from '../screens/profile/CredentialsScreen';
import VerificationScreen from '../screens/profile/VerificationScreen';
import SettingsScreen from '../screens/profile/SettingsScreen';
import PaymentMethodsScreen from '../screens/profile/PaymentMethodsScreen';
import AddressEditScreen from '../screens/profile/AddressEditScreen';
import PrivacyPolicyScreen from '../screens/profile/PrivacyPolicyScreen';
import TermsScreen from '../screens/profile/TermsScreen';

// Screens - Company (VISP for Business, SP4 Stage 2)
import CompanySupervisorScreen from '../screens/company/CompanySupervisorScreen';
import CompanyAssignmentsScreen from '../screens/company/CompanyAssignmentsScreen';

// Screens - Shared
import ChatScreen from '../screens/shared/ChatScreen';

// Screens - Dev (only in __DEV__)
import DesignSystemScreen from '../screens/dev/DesignSystemScreen';

// Editorial primitives
import { VispTabBar } from '../components/visp';
import type { VispIconName } from '../components/visp';
import ContractSignScreen from '../screens/legal/ContractSignScreen';
import * as legalService from '../services/legalService';

const CUSTOMER_TAB_ICONS: Record<string, VispIconName> = {
  Home: 'home',
  MyJobs: 'briefcase',
  CustomerProfile: 'user',
};

const PROVIDER_TAB_ICONS: Record<string, VispIconName> = {
  Dashboard: 'home',
  JobsTab: 'briefcase',
  Earnings: 'money',
  Schedule: 'cal',
  ProviderProfile: 'user',
};

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

const TAB_OPTIONS = {
  tabBarStyle: {
    ...GlassStyles.tabBar,
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

// Dynamic theme-aware options (used inside navigator components)
function useThemedScreenOptions() {
  const theme = useTheme();
  return {
    headerStyle: {
      backgroundColor: theme.headerBackground,
      borderBottomWidth: 1,
      borderBottomColor: theme.headerBorder,
    },
    headerTintColor: theme.textPrimary,
    headerTitleStyle: {
      fontWeight: '600' as const,
      color: theme.textPrimary,
    },
    headerShadowVisible: false,
    contentStyle: {
      backgroundColor: theme.background,
    },
  };
}

function useThemedTabOptions() {
  const theme = useTheme();
  return {
    ...TAB_OPTIONS,
    tabBarStyle: {
      backgroundColor: theme.tabBarBackground,
      borderTopWidth: 1,
      borderTopColor: theme.isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.08)',
      elevation: 0,
      paddingBottom: 4,
      height: 56,
    },
    tabBarInactiveTintColor: theme.isDark ? 'rgba(255, 255, 255, 0.4)' : 'rgba(0, 0, 0, 0.4)',
    headerStyle: {
      backgroundColor: theme.headerBackground,
      borderBottomWidth: 1,
      borderBottomColor: theme.headerBorder,
    },
    headerTintColor: theme.textPrimary,
    headerTitleStyle: {
      fontWeight: '600' as const,
      color: theme.textPrimary,
    },
  };
}

// ---------------------------------------------------------------------------
// Header logo (left side of navigation bar)
// ---------------------------------------------------------------------------

function HeaderLogo(): React.JSX.Element {
  return (
    <Svg viewBox="0 0 100 100" width={24} height={24} style={{ marginRight: 12 }}>
      <Defs>
        <LinearGradient id="hdrGrad" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0%" stopColor="#a78bfa" />
          <Stop offset="50%" stopColor="#7850FF" />
          <Stop offset="100%" stopColor="#4f46e5" />
        </LinearGradient>
      </Defs>
      <Path
        d="M 20 20 L 50 80 L 80 20"
        fill="none"
        stroke="url(#hdrGrad)"
        strokeWidth={8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

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

function CustomHeader({ title, canGoBack, goBack }: { title: string; canGoBack: boolean; goBack: () => void }) {
  const theme = useTheme();
  return (
    <View style={{
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: theme.headerBackground,
      borderBottomWidth: 1,
      borderBottomColor: theme.headerBorder,
      paddingTop: 54,
      paddingBottom: 12,
      paddingHorizontal: 16,
    }}>
      <View style={{ width: 70 }}>
        {canGoBack && (
          <TouchableOpacity onPress={goBack}>
            <Text style={{ color: Colors.primary, fontSize: 16 }}>{'< Back'}</Text>
          </TouchableOpacity>
        )}
      </View>
      <Text style={{ color: theme.textPrimary, fontSize: 17, fontWeight: '600' }}>{title}</Text>
      <View style={{ width: 70, alignItems: 'flex-end' }}>
        <HeaderLogo />
      </View>
    </View>
  );
}

function ProfileStackNavigator(): React.JSX.Element {
  const opts = useThemedScreenOptions();
  return (
    <ProfileStack.Navigator
      screenOptions={{
        ...opts,
        header: ({ options, navigation }) => {
          // Only show back when there's a screen above us in this stack —
          // tab switches make navigation.canGoBack() return true, which would
          // wrongly send the user back to the previous tab.
          const stackHasParent = navigation.getState().index > 0;
          return (
            <CustomHeader
              title={(options.title as string) ?? ''}
              canGoBack={stackHasParent}
              goBack={() => navigation.goBack()}
            />
          );
        },
      }}
    >
      <ProfileStack.Screen
        name="ProfileMain"
        component={ProfileScreen}
        options={{
          // ProfileScreen ya pinta su propio <ScreenTitle>: con el header del
          // stack salían DOS títulos y doble safe-area arriba. Es la raíz de
          // este stack, así que no necesita botón de volver.
          headerShown: false,
          title: 'Profile',
        }}
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
        name="MyPrices"
        component={MyPricesScreen}
        options={{
          // MyPricesScreen ya pinta su propio <ScreenTitle>. Al ser una pantalla
          // APILADA, el volver lo aporta ScreenTitle vía onBack.
          headerShown: false,
          title: 'My Prices',
        }}
      />
      <ProfileStack.Screen
        name="PaymentMethods"
        component={PaymentMethodsScreen}
        options={{ title: 'Payment Methods', headerBackTitle: 'Back' }}
      />
      <ProfileStack.Screen
        name="AddressEdit"
        component={AddressEditScreen}
        options={{ title: 'Saved address', headerBackTitle: 'Back' }}
      />
      <ProfileStack.Screen
        name="PrivacyPolicy"
        component={PrivacyPolicyScreen}
        options={{ title: 'Privacy Policy' }}
      />
      <ProfileStack.Screen
        name="TermsOfService"
        component={TermsScreen}
        options={{ title: 'Terms & Conditions' }}
      />
    </ProfileStack.Navigator>
  );
}

// ---------------------------------------------------------------------------
// Provider Jobs Stack (Offers + Active Job)
// ---------------------------------------------------------------------------

function ProviderJobStackNavigator(): React.JSX.Element {
  const opts = useThemedScreenOptions();
  return (
    <ProviderJobStack.Navigator
      screenOptions={{
        ...opts,
        header: ({ options, navigation }) => {
          const stackHasParent = navigation.getState().index > 0;
          return (
            <CustomHeader
              title={(options.title as string) ?? ''}
              canGoBack={stackHasParent}
              goBack={() => navigation.goBack()}
            />
          );
        },
      }}
    >
      <ProviderJobStack.Screen
        name="JobOffers"
        component={JobOffersScreen}
        options={({ navigation }) => ({
          title: 'Job Offers',
          headerLeft: () => (
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
        options={{
          // ActiveJobScreen ya pinta su propio <ScreenTitle> ("My Work" cuando no
          // hay trabajo activo). El header del stack decía "Active Job" incluso
          // en ese estado, así que salían dos títulos CONTRADICTORIOS. Pantalla
          // apilada: el volver lo aporta ScreenTitle vía onBack.
          headerShown: false,
          title: 'Active Job',
        }}
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
  const opts = useThemedScreenOptions();
  return (
    <AuthStack.Navigator
      screenOptions={{
        ...opts,
        headerShown: false,
      }}
    >
      <AuthStack.Screen name="Login" component={LoginScreen} />
      <AuthStack.Screen name="Register" component={RegisterScreen} />
      <AuthStack.Screen name="CompanyJoin" component={CompanyJoinScreen} />
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
  const { t } = useTranslation();
  return (
    <CustomerTab.Navigator
      screenOptions={{ headerShown: false }}
      tabBar={(props) => <VispTabBar {...props} iconMap={CUSTOMER_TAB_ICONS} />}
    >
      <CustomerTab.Screen
        name="Home"
        component={CustomerHomeScreen}
        options={{ tabBarLabel: t('nav.home') }}
      />
      <CustomerTab.Screen
        name="MyJobs"
        component={MyJobsScreen}
        options={{ tabBarLabel: t('nav.myJobs') }}
      />
      <CustomerTab.Screen
        name="CustomerProfile"
        component={ProfileStackNavigator}
        options={{ tabBarLabel: t('nav.profile') }}
      />
    </CustomerTab.Navigator>
  );
}

// ---------------------------------------------------------------------------
// Provider Tab Navigator
// ---------------------------------------------------------------------------

function ProviderTabNavigator(): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <ProviderTab.Navigator
      screenOptions={{ headerShown: false }}
      tabBar={(props) => <VispTabBar {...props} iconMap={PROVIDER_TAB_ICONS} />}
    >
      <ProviderTab.Screen
        name="Dashboard"
        component={DashboardScreen}
        options={{ tabBarLabel: t('nav.dashboard') }}
      />
      <ProviderTab.Screen
        name="JobsTab"
        component={ProviderJobStackNavigator}
        options={{ tabBarLabel: t('nav.jobs') }}
      />
      <ProviderTab.Screen
        name="Earnings"
        component={EarningsScreen}
        options={{ tabBarLabel: t('nav.earnings') }}
      />
      <ProviderTab.Screen
        name="Schedule"
        component={ScheduleScreen}
        options={{ tabBarLabel: t('nav.schedule') }}
      />
      <ProviderTab.Screen
        name="ProviderProfile"
        component={ProfileStackNavigator}
        options={{ tabBarLabel: t('nav.profile') }}
      />
    </ProviderTab.Navigator>
  );
}

// ---------------------------------------------------------------------------
// Root Navigator
// ---------------------------------------------------------------------------

export default function AppNavigator(): React.JSX.Element {
  const opts = useThemedScreenOptions();
  const { isAuthenticated, isRestoring, user, activeMode } = useAuthStore();
  const userRole = user?.role ?? 'customer';
  // For 'both' users, the active tab navigator is dictated by activeMode.
  // Single-role users always see their own role's tabs.
  const effectiveRole: 'customer' | 'provider' =
    userRole === 'both' ? activeMode : (userRole as 'customer' | 'provider');
  const navigationRef = useRef<NavigationContainerRef<RootStackParamList>>(null);

  // ── Puerta legal ────────────────────────────────────────────────────────
  // `null` = todavía no se sabe. Se pregunta al servidor en cada entrada
  // (registro o login) en vez de resolverlo solo en el momento del alta: quien
  // mate la app a mitad de la firma se quedaría siendo proveedor sin contrato,
  // y los proveedores que ya existen nunca firmarían. Preguntando aquí, el
  // hueco se cierra solo.
  const [legalPending, setLegalPending] = useState<boolean | null>(null);

  useEffect(() => {
    if (!isAuthenticated) {
      setLegalPending(null);
      return;
    }
    let cancelled = false;
    legalService
      .getPendingConsents()
      .then((r) => {
        if (!cancelled) setLegalPending(r.pending.length > 0);
      })
      .catch(() => {
        // Falla ABIERTO a propósito: si la comprobación se cae por red, dejar
        // al usuario fuera de su propia app sería peor que dejarle entrar. El
        // candado de verdad está en el servidor —un proveedor sin contrato no
        // puede ofertar— y esa comprobación no depende de esta pantalla.
        if (!cancelled) setLegalPending(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, user?.id]);

  // Handle notification tap deep-links
  const handleNotificationNavigation = useCallback(
    (data: NotificationData) => {
      const nav = navigationRef.current;
      if (!nav?.isReady()) return;

      switch (data.type) {
        case 'job_update':
        case 'job_matched':
        case 'provider_en_route':
        case 'job_completed':
          if (data.job_id) {
            nav.navigate('JobTracking' as any, { jobId: data.job_id });
          }
          break;
        case 'chat_message':
          if (data.job_id) {
            nav.navigate('Chat' as any, {
              jobId: data.job_id,
              otherUserName: data.sender_name ?? 'Chat',
            });
          }
          break;
        case 'new_job_offer':
          // Provider mode: navigate to job offers tab
          if (effectiveRole === 'provider') {
            nav.navigate('ProviderHome' as any);
          }
          break;
        default:
          console.log('[AppNavigator] Unhandled notification type:', data.type);
      }
    },
    [effectiveRole],
  );

  // Wire up notification navigation handler
  useEffect(() => {
    notificationService.setNavigationHandler(handleNotificationNavigation);
  }, [handleNotificationNavigation]);

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

  // Refresh VISP-for-Business company membership once authenticated so the
  // Profile "Company" entry can surface the supervisor/collaborator screens.
  // Best-effort: the store swallows errors and leaves membership null.
  useEffect(() => {
    const { refreshMembership, clearMembership } = useCompanyStore.getState();
    if (isAuthenticated) {
      refreshMembership();
    } else {
      clearMembership();
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
    <NavigationContainer ref={navigationRef}>
      <RootStack.Navigator
        screenOptions={{
          ...opts,
          headerShown: false,
        }}
      >
        {!isAuthenticated ? (
          <RootStack.Screen name="Auth" component={AuthNavigator} />
        ) : legalPending ? (
          // Única pantalla montada: sin atrás y sin "más tarde". Un proveedor
          // sin contrato no puede ofertar, así que dejarle pasar solo lo
          // llevaría a una app bloqueada sin explicación.
          <RootStack.Screen name="ContractSign">
            {() => <ContractSignScreen onCompleted={() => setLegalPending(false)} />}
          </RootStack.Screen>
        ) : effectiveRole === 'customer' ? (
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
                ...opts,
                title: `Chat - ${(route.params as { otherUserName: string }).otherUserName}`,
              })}
            />
            {/* Ofertas recibidas. La pantalla existía y la ruta estaba declarada
                en `RootStackParamList`, pero NUNCA se registró aquí: navegar a
                'Offers' no hacía absolutamente nada —React Navigation no
                encuentra la ruta y falla en silencio, sin error visible— así que
                el cliente veía sus ofertas en la lista y no podía abrirlas.
                TypeScript no lo caza: el tipo declara la ruta, no comprueba que
                exista una pantalla montada para ella. */}
            <RootStack.Screen
              name="Offers"
              component={OffersScreen}
              options={{ headerShown: false, ...opts }}
            />
            <RootStack.Screen
              name="JobTracking"
              component={JobTrackingScreen}
              options={{
                headerShown: true,
                ...opts,
                title: 'Job Status',
                headerBackTitle: 'Back',
              }}
            />
            {/* VISP for Business — reachable from the dashboard "Company" card */}
            <RootStack.Screen
              name="CompanySupervisor"
              component={CompanySupervisorScreen}
              options={{
                // La pantalla ya pinta su propio <ScreenTitle>: con el header del
                // stack salían DOS títulos y doble safe-area arriba. El botón de
                // volver lo aporta ScreenTitle vía onBack.
                headerShown: false,
                ...opts,
                title: 'Company jobs',
                headerBackTitle: 'Back',
              }}
            />
            <RootStack.Screen
              name="CompanyAssignments"
              component={CompanyAssignmentsScreen}
              options={{
                // Ídem: ScreenTitle ya titula y aporta el volver vía onBack.
                headerShown: false,
                ...opts,
                title: 'My assignments',
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
                ...opts,
                title: `Chat - ${(route.params as { otherUserName: string }).otherUserName}`,
              })}
            />
            <RootStack.Screen name="PayoutsOnboarding" component={PayoutsOnboardingScreen} />
            <RootStack.Screen name="PayoutsPersonalInfo" component={PayoutsPersonalInfoStep} />
            <RootStack.Screen name="PayoutsTax" component={PayoutsTaxStep} />
            <RootStack.Screen name="PayoutsBank" component={PayoutsBankStep} />
            <RootStack.Screen name="PayoutsIdentityDoc" component={PayoutsIdentityDocStep} />
            <RootStack.Screen name="PayoutsTos" component={PayoutsTosStep} />
            {/* VISP for Business — company members log in as providers, so the
                supervisor/collaborator screens must also be reachable from the
                provider dashboard "Company" card. */}
            <RootStack.Screen
              name="CompanySupervisor"
              component={CompanySupervisorScreen}
              options={{
                // La pantalla ya pinta su propio <ScreenTitle>: con el header del
                // stack salían DOS títulos y doble safe-area arriba. El botón de
                // volver lo aporta ScreenTitle vía onBack.
                headerShown: false,
                ...opts,
                title: 'Company jobs',
                headerBackTitle: 'Back',
              }}
            />
            <RootStack.Screen
              name="CompanyAssignments"
              component={CompanyAssignmentsScreen}
              options={{
                // Ídem: ScreenTitle ya titula y aporta el volver vía onBack.
                headerShown: false,
                ...opts,
                title: 'My assignments',
                headerBackTitle: 'Back',
              }}
            />
          </>
        )}
        {__DEV__ && isAuthenticated && (
          <RootStack.Screen
            name="__DesignSystem"
            component={DesignSystemScreen}
            options={{ headerShown: false }}
          />
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
