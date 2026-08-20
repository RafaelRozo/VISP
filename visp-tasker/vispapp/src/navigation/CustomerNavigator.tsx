/**
 * VISP - Customer Flow Navigator
 *
 * Stack navigator for the complete customer booking flow:
 * Category -> Subcategory -> TaskSelection -> BookingDetails -> Booking ->
 * Matching -> JobTracking -> Rating
 *
 * BookingDetails ("More info") se intercala entre elegir el servicio y
 * confirmar: recoge detalles, fotos y una nota que el PROVEEDOR lee antes de
 * aceptar, para decidir si le interesa el trabajo con su rango de precio.
 *
 * This navigator is presented as a modal stack from the root navigator when
 * a customer taps on a category from the Home screen.
 */

import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Colors } from '../theme/colors';
import { FontWeight } from '../theme/typography';
import type { CustomerFlowParamList } from '../types';

// Screens
import CategoryScreen from '../screens/customer/CategoryScreen';
import SubcategoryScreen from '../screens/customer/SubcategoryScreen';
import TaskSelectionScreen from '../screens/customer/TaskSelectionScreen';
import BookingDetailsScreen from '../screens/customer/BookingDetailsScreen';
import BookingScreen from '../screens/customer/BookingScreen';
import MatchingScreen from '../screens/customer/MatchingScreen';
import OffersScreen from '../screens/customer/OffersScreen';
import JobTrackingScreen from '../screens/customer/JobTrackingScreen';
import RatingScreen from '../screens/customer/RatingScreen';
import TipScreen from '../screens/customer/TipScreen';
import PriceProposalScreen from '../screens/customer/PriceProposalScreen';
import ChatScreen from '../screens/shared/ChatScreen';

const Stack = createNativeStackNavigator<CustomerFlowParamList>();

const defaultScreenOptions = {
  headerStyle: {
    backgroundColor: Colors.surface,
  },
  headerTintColor: Colors.textPrimary,
  headerTitleStyle: {
    fontWeight: FontWeight.semiBold as '600',
    color: Colors.textPrimary,
  },
  headerBackTitleVisible: false,
  headerShadowVisible: false,
  contentStyle: {
    backgroundColor: Colors.background,
  },
};

interface CustomerNavigatorProps {
  initialCategoryId?: string;
  initialCategoryName?: string;
}

function CustomerNavigator({ initialCategoryId, initialCategoryName }: CustomerNavigatorProps): React.JSX.Element {
  return (
    <Stack.Navigator screenOptions={defaultScreenOptions}>
      <Stack.Screen
        name="Category"
        component={CategoryScreen}
        options={{ title: 'Category' }}
        initialParams={
          initialCategoryId
            ? { categoryId: initialCategoryId, categoryName: initialCategoryName ?? 'Category' }
            : undefined
        }
      />
      <Stack.Screen
        name="Subcategory"
        component={SubcategoryScreen}
        options={{ title: 'Task Details' }}
      />
      <Stack.Screen
        name="TaskSelection"
        component={TaskSelectionScreen}
        options={{ title: 'Book Service' }}
      />
      <Stack.Screen
        name="BookingDetails"
        component={BookingDetailsScreen}
        options={{
          // La pantalla pinta su propio <ScreenTitle> y aporta el volver vía
          // onBack; con el header del stack saldrían dos títulos.
          headerShown: false,
          title: 'More info',
        }}
      />
      <Stack.Screen
        name="Booking"
        component={BookingScreen}
        options={{ title: 'Confirm Booking' }}
      />
      <Stack.Screen
        name="Matching"
        component={MatchingScreen}
        options={{
          title: 'Finding Provider',
          headerShown: false,
          gestureEnabled: false,
        }}
      />
      <Stack.Screen
        name="Offers"
        component={OffersScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="JobTracking"
        component={JobTrackingScreen}
        options={{
          title: 'Job Status',
          headerBackVisible: false,
          gestureEnabled: false,
        }}
      />
      <Stack.Screen
        name="Rating"
        component={RatingScreen}
        options={{
          title: 'Rate & Pay',
          headerBackVisible: false,
          gestureEnabled: false,
        }}
      />
      <Stack.Screen
        name="Tip"
        component={TipScreen}
        options={{
          title: 'Add a Tip',
          headerBackVisible: false,
          gestureEnabled: false,
        }}
      />
      <Stack.Screen
        name="PriceProposal"
        component={PriceProposalScreen}
        options={{
          title: 'Price Proposals',
        }}
      />
      <Stack.Screen
        name="Chat"
        component={ChatScreen}
        options={({ route }) => ({
          title: `Chat - ${(route.params as { otherUserName: string }).otherUserName}`,
        })}
      />
    </Stack.Navigator>
  );
}

export default CustomerNavigator;
