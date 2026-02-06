/**
 * VISP/Tasker - Emergency Flow Navigator
 *
 * Stack navigator for the Level 4 emergency flow:
 * EmergencyType -> Location -> Confirm -> Searching -> Matched ->
 * Tracking -> InProgress -> Completion
 *
 * Also handles the Cancel side flow.
 */

import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Colors } from '../theme/colors';
import { FontWeight } from '../theme/typography';
import type { EmergencyFlowParamList } from '../types';

// Screens
import EmergencyTypeScreen from '../screens/emergency/EmergencyTypeScreen';
import EmergencyLocationScreen from '../screens/emergency/EmergencyLocationScreen';
import EmergencyConfirmScreen from '../screens/emergency/EmergencyConfirmScreen';
import EmergencySearchingScreen from '../screens/emergency/EmergencySearchingScreen';
import EmergencyMatchedScreen from '../screens/emergency/EmergencyMatchedScreen';
import EmergencyTrackingScreen from '../screens/emergency/EmergencyTrackingScreen';
import EmergencyInProgressScreen from '../screens/emergency/EmergencyInProgressScreen';
import EmergencyCompletionScreen from '../screens/emergency/EmergencyCompletionScreen';
import EmergencyCancelScreen from '../screens/emergency/EmergencyCancelScreen';

const Stack = createNativeStackNavigator<EmergencyFlowParamList>();

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

function EmergencyNavigator(): React.JSX.Element {
  return (
    <Stack.Navigator screenOptions={defaultScreenOptions}>
      <Stack.Screen
        name="EmergencyTypeSelect"
        component={EmergencyTypeScreen}
        options={{
          title: 'Emergency',
          headerStyle: {
            backgroundColor: Colors.surface,
          },
          headerTintColor: Colors.emergencyRed,
        }}
      />
      <Stack.Screen
        name="EmergencyLocation"
        component={EmergencyLocationScreen}
        options={{ title: 'Confirm Location' }}
      />
      <Stack.Screen
        name="EmergencyConfirm"
        component={EmergencyConfirmScreen}
        options={{ title: 'Confirm Emergency' }}
      />
      <Stack.Screen
        name="EmergencySearching"
        component={EmergencySearchingScreen}
        options={{
          title: 'Searching...',
          headerBackVisible: false,
          gestureEnabled: false,
        }}
      />
      <Stack.Screen
        name="EmergencyMatched"
        component={EmergencyMatchedScreen}
        options={{
          title: 'Provider Found',
          headerBackVisible: false,
          gestureEnabled: false,
        }}
      />
      <Stack.Screen
        name="EmergencyTracking"
        component={EmergencyTrackingScreen}
        options={{
          title: 'Tracking Provider',
          headerBackVisible: false,
          gestureEnabled: false,
        }}
      />
      <Stack.Screen
        name="EmergencyInProgress"
        component={EmergencyInProgressScreen}
        options={{
          title: 'In Progress',
          headerBackVisible: false,
          gestureEnabled: false,
        }}
      />
      <Stack.Screen
        name="EmergencyCompletion"
        component={EmergencyCompletionScreen}
        options={{
          title: 'Completed',
          headerBackVisible: false,
          gestureEnabled: false,
        }}
      />
      <Stack.Screen
        name="EmergencyCancel"
        component={EmergencyCancelScreen}
        options={{
          title: 'Cancel Request',
          presentation: 'modal',
        }}
      />
    </Stack.Navigator>
  );
}

export default EmergencyNavigator;
