/**
 * VISP/Tasker - Customer Flow Navigator
 *
 * Stack navigator for the customer task selection flow:
 * Home -> Category -> Subcategory -> TaskSelection -> BookingConfirmation
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
    </Stack.Navigator>
  );
}

export default CustomerNavigator;
