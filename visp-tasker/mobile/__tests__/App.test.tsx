/**
 * VISP/Tasker - App component test
 *
 * @format
 */

import React from 'react';
import {render} from '@testing-library/react-native';
import App from '../App';

// Mock the navigation and gesture handler dependencies
jest.mock('react-native-gesture-handler', () => {
  const View = require('react-native').View;
  return {
    GestureHandlerRootView: View,
    Swipeable: View,
    DrawerLayout: View,
    State: {},
    ScrollView: require('react-native').ScrollView,
    Slider: require('react-native').View,
    Switch: require('react-native').Switch,
    TextInput: require('react-native').TextInput,
    ToolbarAndroid: require('react-native').View,
    TouchableHighlight: require('react-native').TouchableHighlight,
    TouchableNativeFeedback: require('react-native').TouchableNativeFeedback,
    TouchableOpacity: require('react-native').TouchableOpacity,
    TouchableWithoutFeedback: require('react-native').TouchableWithoutFeedback,
    FlatList: require('react-native').FlatList,
  };
});

jest.mock('react-native-safe-area-context', () => {
  const inset = {top: 0, right: 0, bottom: 0, left: 0};
  return {
    SafeAreaProvider: ({children}: {children: React.ReactNode}) => children,
    SafeAreaConsumer: ({
      children,
    }: {
      children: (insets: typeof inset) => React.ReactNode;
    }) => children(inset),
    useSafeAreaInsets: () => inset,
    useSafeAreaFrame: () => ({x: 0, y: 0, width: 393, height: 852}),
  };
});

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  NavigationContainer: ({children}: {children: React.ReactNode}) => children,
  useNavigation: () => ({navigate: jest.fn(), goBack: jest.fn()}),
  useRoute: () => ({params: {}}),
}));

jest.mock('@react-navigation/native-stack', () => ({
  createNativeStackNavigator: () => ({
    Navigator: ({children}: {children: React.ReactNode}) => children,
    Screen: ({children}: {children: React.ReactNode}) => children,
  }),
}));

jest.mock('@react-navigation/bottom-tabs', () => ({
  createBottomTabNavigator: () => ({
    Navigator: ({children}: {children: React.ReactNode}) => children,
    Screen: ({children}: {children: React.ReactNode}) => children,
  }),
}));

jest.mock('react-native-screens', () => ({
  enableScreens: jest.fn(),
}));

jest.mock('react-native-reanimated', () =>
  require('react-native-reanimated/mock'),
);

jest.mock('react-native-keychain', () => ({
  setGenericPassword: jest.fn(),
  getGenericPassword: jest.fn(),
  resetGenericPassword: jest.fn(),
}));

describe('App', () => {
  it('renders without crashing', () => {
    const {toJSON} = render(<App />);
    expect(toJSON()).toBeTruthy();
  });
});
