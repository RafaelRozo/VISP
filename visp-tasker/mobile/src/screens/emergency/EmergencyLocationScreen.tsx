/**
 * VISP/Tasker - EmergencyLocationScreen
 *
 * Map view with current location for emergency services.
 * Features:
 *   - Map view with current location
 *   - Address confirmation or manual entry
 *   - "Confirm Location" button
 *   - GPS accuracy indicator
 */

import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  SafeAreaView,
  Alert,
  Platform,
} from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import MapView, { Marker, PROVIDER_GOOGLE, Region } from 'react-native-maps';
import Geolocation from '@react-native-community/geolocation';
import { Colors } from '../../theme/colors';
import { Spacing } from '../../theme/spacing';
import { Typography, FontWeight, FontSize } from '../../theme/typography';
import { BorderRadius } from '../../theme/borders';
import { Shadows } from '../../theme/shadows';
import { useEmergencyStore } from '../../stores/emergencyStore';
import type { EmergencyFlowParamList, AddressInfo } from '../../types';

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

type LocationRouteProp = RouteProp<EmergencyFlowParamList, 'EmergencyLocation'>;
type LocationNavProp = NativeStackNavigationProp<EmergencyFlowParamList, 'EmergencyLocation'>;

interface GpsAccuracy {
  level: 'high' | 'medium' | 'low' | 'unknown';
  meters: number;
  color: string;
  label: string;
}

// ──────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────

const DEFAULT_DELTA = 0.005;

function getAccuracyInfo(meters: number): GpsAccuracy {
  if (meters <= 10) {
    return { level: 'high', meters, color: Colors.success, label: 'High accuracy' };
  }
  if (meters <= 50) {
    return { level: 'medium', meters, color: Colors.warning, label: 'Medium accuracy' };
  }
  if (meters <= 200) {
    return { level: 'low', meters, color: Colors.emergencyRed, label: 'Low accuracy' };
  }
  return { level: 'unknown', meters, color: Colors.textTertiary, label: 'Acquiring GPS...' };
}

// ──────────────────────────────────────────────
// Dark map style
// ──────────────────────────────────────────────

const darkMapStyle = [
  { elementType: 'geometry', stylers: [{ color: '#1A1A2E' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#1A1A2E' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#6B6B80' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#2A2A40' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#16213E' }] },
];

// ──────────────────────────────────────────────
// Component
// ──────────────────────────────────────────────

function EmergencyLocationScreen(): React.JSX.Element {
  const route = useRoute<LocationRouteProp>();
  const navigation = useNavigation<LocationNavProp>();
  const { emergencyType } = route.params;
  const { setLocation } = useEmergencyStore();

  const mapRef = useRef<MapView>(null);
  const [isLoadingLocation, setIsLoadingLocation] = useState(true);
  const [currentLocation, setCurrentLocation] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);
  const [accuracy, setAccuracy] = useState<GpsAccuracy>(
    getAccuracyInfo(9999),
  );
  const [addressText, setAddressText] = useState('');
  const [confirmedAddress, setConfirmedAddress] = useState<AddressInfo | null>(null);
  const [isEditingAddress, setIsEditingAddress] = useState(false);

  // Get current location on mount
  useEffect(() => {
    const watchId = Geolocation.watchPosition(
      (position) => {
        const { latitude, longitude, accuracy: acc } = position.coords;
        setCurrentLocation({ latitude, longitude });
        setAccuracy(getAccuracyInfo(acc || 9999));
        setIsLoadingLocation(false);

        // Reverse geocode would happen here in production
        if (!confirmedAddress) {
          setAddressText(
            `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`,
          );
          setConfirmedAddress({
            placeId: 'current_location',
            formattedAddress: `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`,
            latitude,
            longitude,
            streetNumber: '',
            street: '',
            city: '',
            province: '',
            postalCode: '',
            country: '',
          });
        }
      },
      (error) => {
        setIsLoadingLocation(false);
        Alert.alert(
          'Location Access Required',
          'Please enable location services to use the emergency feature. Your location is needed to dispatch the nearest provider.',
          [{ text: 'OK' }],
        );
      },
      {
        enableHighAccuracy: true,
        distanceFilter: 5,
        timeout: 15000,
        maximumAge: 5000,
      },
    );

    return () => {
      Geolocation.clearWatch(watchId);
    };
  }, [confirmedAddress]);

  // Handle manual address entry
  const handleAddressChange = useCallback((text: string) => {
    setAddressText(text);
    setIsEditingAddress(true);
  }, []);

  // Handle address confirmation from manual input
  const handleManualAddressConfirm = useCallback(() => {
    if (addressText.trim().length < 5) {
      Alert.alert('Invalid Address', 'Please enter a complete address.');
      return;
    }

    // In production, this would geocode the address
    const manualAddress: AddressInfo = {
      placeId: 'manual_entry',
      formattedAddress: addressText,
      latitude: currentLocation?.latitude || 43.6532,
      longitude: currentLocation?.longitude || -79.3832,
      streetNumber: '',
      street: addressText,
      city: '',
      province: '',
      postalCode: '',
      country: '',
    };

    setConfirmedAddress(manualAddress);
    setIsEditingAddress(false);
  }, [addressText, currentLocation]);

  // Handle "use current location" tap
  const handleUseCurrentLocation = useCallback(() => {
    if (currentLocation) {
      setConfirmedAddress({
        placeId: 'current_location',
        formattedAddress: `${currentLocation.latitude.toFixed(4)}, ${currentLocation.longitude.toFixed(4)}`,
        latitude: currentLocation.latitude,
        longitude: currentLocation.longitude,
        streetNumber: '',
        street: '',
        city: '',
        province: '',
        postalCode: '',
        country: '',
      });
      setAddressText(
        `${currentLocation.latitude.toFixed(4)}, ${currentLocation.longitude.toFixed(4)}`,
      );
      setIsEditingAddress(false);
    }
  }, [currentLocation]);

  // Confirm location and proceed
  const handleConfirmLocation = useCallback(() => {
    if (!confirmedAddress) {
      Alert.alert('Location Required', 'Please confirm your emergency location.');
      return;
    }

    setLocation(confirmedAddress);
    navigation.navigate('EmergencyConfirm', {
      emergencyType,
      location: confirmedAddress,
    });
  }, [confirmedAddress, emergencyType, navigation, setLocation]);

  // Map region for the current location
  const mapRegion: Region | undefined = currentLocation
    ? {
        latitude: currentLocation.latitude,
        longitude: currentLocation.longitude,
        latitudeDelta: DEFAULT_DELTA,
        longitudeDelta: DEFAULT_DELTA,
      }
    : undefined;

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        {/* Map */}
        <View style={styles.mapContainer}>
          {isLoadingLocation ? (
            <View style={styles.mapLoading}>
              <ActivityIndicator size="large" color={Colors.emergencyRed} />
              <Text style={styles.mapLoadingText}>
                Acquiring your location...
              </Text>
            </View>
          ) : (
            <>
              <MapView
                ref={mapRef}
                style={styles.map}
                provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
                region={mapRegion}
                showsUserLocation={false}
                showsMyLocationButton={false}
                customMapStyle={darkMapStyle}
                accessibilityLabel="Emergency location map"
              >
                {currentLocation && (
                  <Marker
                    coordinate={currentLocation}
                    title="Your Location"
                    anchor={{ x: 0.5, y: 0.5 }}
                  >
                    <View style={styles.markerOuter}>
                      <View style={styles.markerInner} />
                    </View>
                  </Marker>
                )}
              </MapView>

              {/* GPS accuracy indicator */}
              <View style={styles.accuracyBadge}>
                <View
                  style={[
                    styles.accuracyDot,
                    { backgroundColor: accuracy.color },
                  ]}
                />
                <Text style={styles.accuracyText}>{accuracy.label}</Text>
                {accuracy.meters < 9999 && (
                  <Text style={styles.accuracyMeters}>
                    ({Math.round(accuracy.meters)}m)
                  </Text>
                )}
              </View>
            </>
          )}
        </View>

        {/* Address panel */}
        <View style={styles.addressPanel}>
          <Text style={styles.panelTitle}>Emergency Location</Text>

          {/* Address input */}
          <View style={styles.addressInputRow}>
            <View style={styles.addressInputContainer}>
              <TextInput
                style={styles.addressInput}
                placeholder="Enter address manually..."
                placeholderTextColor={Colors.inputPlaceholder}
                value={addressText}
                onChangeText={handleAddressChange}
                returnKeyType="done"
                onSubmitEditing={handleManualAddressConfirm}
                accessibilityLabel="Emergency address input"
              />
            </View>
          </View>

          {/* Use current location button */}
          {currentLocation && (
            <TouchableOpacity
              style={styles.useLocationButton}
              onPress={handleUseCurrentLocation}
              activeOpacity={0.7}
              accessibilityLabel="Use my current location"
            >
              <View style={styles.locationIcon}>
                <View style={styles.locationDot} />
              </View>
              <Text style={styles.useLocationText}>
                Use my current location
              </Text>
            </TouchableOpacity>
          )}

          {/* Confirmed address display */}
          {confirmedAddress && !isEditingAddress && (
            <View style={styles.confirmedCard}>
              <Text style={styles.confirmedLabel}>Selected Location</Text>
              <Text style={styles.confirmedAddress}>
                {confirmedAddress.formattedAddress}
              </Text>
            </View>
          )}

          {/* Confirm button */}
          <TouchableOpacity
            style={[
              styles.confirmButton,
              !confirmedAddress && styles.confirmButtonDisabled,
            ]}
            onPress={handleConfirmLocation}
            disabled={!confirmedAddress}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Confirm emergency location"
            accessibilityState={{ disabled: !confirmedAddress }}
          >
            <Text style={styles.confirmButtonText}>Confirm Location</Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}

// ──────────────────────────────────────────────
// Styles
// ──────────────────────────────────────────────

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },

  // Map
  mapContainer: {
    flex: 1,
    minHeight: 300,
  },
  map: {
    flex: 1,
  },
  mapLoading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surface,
  },
  mapLoadingText: {
    ...Typography.body,
    color: Colors.textSecondary,
    marginTop: Spacing.md,
  },

  // Marker
  markerOuter: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: `${Colors.emergencyRed}30`,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: Colors.emergencyRed,
  },
  markerInner: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: Colors.emergencyRed,
  },

  // Accuracy badge
  accuracyBadge: {
    position: 'absolute',
    top: Spacing.lg,
    left: Spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
    borderColor: Colors.border,
    ...Shadows.sm,
  },
  accuracyDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: Spacing.sm,
  },
  accuracyText: {
    ...Typography.caption,
    color: Colors.textPrimary,
    fontWeight: FontWeight.medium,
  },
  accuracyMeters: {
    ...Typography.caption,
    color: Colors.textSecondary,
    marginLeft: Spacing.xs,
  },

  // Address panel
  addressPanel: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: BorderRadius.xl,
    borderTopRightRadius: BorderRadius.xl,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.xl,
    paddingBottom: Spacing.xxl,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    ...Shadows.xl,
  },
  panelTitle: {
    ...Typography.title3,
    color: Colors.textPrimary,
    marginBottom: Spacing.lg,
  },

  // Address input
  addressInputRow: {
    marginBottom: Spacing.md,
  },
  addressInputContainer: {
    backgroundColor: Colors.inputBackground,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
    borderColor: Colors.inputBorder,
    paddingHorizontal: Spacing.md,
    height: 48,
    justifyContent: 'center',
  },
  addressInput: {
    ...Typography.body,
    color: Colors.inputText,
    paddingVertical: 0,
  },

  // Use current location
  useLocationButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.md,
    marginBottom: Spacing.md,
  },
  locationIcon: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: `${Colors.primary}20`,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: Spacing.sm,
  },
  locationDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: Colors.primary,
  },
  useLocationText: {
    ...Typography.body,
    color: Colors.primary,
    fontWeight: FontWeight.medium,
  },

  // Confirmed address
  confirmedCard: {
    backgroundColor: `${Colors.success}10`,
    borderRadius: BorderRadius.sm,
    padding: Spacing.md,
    marginBottom: Spacing.lg,
    borderWidth: 1,
    borderColor: `${Colors.success}30`,
  },
  confirmedLabel: {
    ...Typography.caption,
    color: Colors.success,
    fontWeight: FontWeight.semiBold,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: Spacing.xs,
  },
  confirmedAddress: {
    ...Typography.body,
    color: Colors.textPrimary,
  },

  // Confirm button
  confirmButton: {
    backgroundColor: Colors.emergencyRed,
    borderRadius: BorderRadius.md,
    paddingVertical: Spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
    ...Shadows.md,
  },
  confirmButtonDisabled: {
    backgroundColor: Colors.textDisabled,
    ...Shadows.none,
  },
  confirmButtonText: {
    ...Typography.buttonLarge,
    color: Colors.white,
    fontWeight: FontWeight.bold,
  },
});

export default EmergencyLocationScreen;
