/**
 * VISP/Tasker - Customer Flow Navigator
 *
 * Stack navigator for the complete customer booking flow:
 * Category -> Subcategory -> TaskSelection -> Booking -> Matching -> JobTracking -> Rating
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
import BookingScreen from '../screens/customer/BookingScreen';
import MatchingScreen from '../screens/customer/MatchingScreen';
import JobTrackingScreen from '../screens/customer/JobTrackingScreen';
import RatingScreen from '../screens/customer/RatingScreen';
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

function CustomerNavigator(): React.JSX.Element {
  return (
    <Stack.Navigator screenOptions={defaultScreenOptions}>
      <Stack.Screen
        name="Category"
        component={CategoryScreen}
        options={{ title: 'Category' }}
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
