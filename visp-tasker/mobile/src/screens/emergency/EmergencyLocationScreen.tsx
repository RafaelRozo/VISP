/**
 * VISP - EmergencyLocationScreen
 *
 * Map view with current location for emergency services.
 * Features:
 *   - Map view with current location
 *   - Address confirmation or manual entry
 *   - "Confirm Location" button
 *   - GPS accuracy indicator
 *
 * Dark glassmorphism styling with red emergency accent.
 */

import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Platform,
} from 'react-native';
import { AnimatedSpinner } from '../../components/animations';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import MapView, { Marker, PROVIDER_GOOGLE, Region } from 'react-native-maps';
import Geolocation from '@react-native-community/geolocation';
import { GlassBackground, GlassCard, GlassButton, GlassInput } from '../../components/glass';
import { GlassStyles, Colors } from '../../theme';
import { Spacing } from '../../theme/spacing';
import { Typography, FontWeight } from '../../theme/typography';
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
    <GlassBackground>
      {/* Map */}
      <View style={styles.mapContainer}>
        {isLoadingLocation ? (
          <View style={styles.mapLoading}>
            <AnimatedSpinner size={48} color={Colors.emergencyRed} />
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

            {/* GPS accuracy indicator - glass overlay */}
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

      {/* Address panel - glass bottom sheet */}
      <View style={styles.addressPanel}>
        <Text style={styles.panelTitle}>Emergency Location</Text>

        {/* Address input - glass themed */}
        <GlassInput
          label="Address"
          placeholder="Enter address manually..."
          value={addressText}
          onChangeText={handleAddressChange}
          returnKeyType="done"
          onSubmitEditing={handleManualAddressConfirm}
          accessibilityLabel="Emergency address input"
          containerStyle={styles.addressInputContainer}
        />

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
          <GlassCard variant="dark" style={styles.confirmedCard}>
            <Text style={styles.confirmedLabel}>Selected Location</Text>
            <Text style={styles.confirmedAddress}>
              {confirmedAddress.formattedAddress}
            </Text>
          </GlassCard>
        )}

        {/* Confirm button - red glow */}
        <GlassButton
          title="Confirm Location"
          onPress={handleConfirmLocation}
          variant="glow"
          disabled={!confirmedAddress}
          style={styles.confirmButton}
        />
      </View>
    </GlassBackground>
  );
}

// ──────────────────────────────────────────────
// Styles
// ──────────────────────────────────────────────

const EMERGENCY_RED_GLOW = 'rgba(231, 76, 60, 0.6)';

const styles = StyleSheet.create({
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
    backgroundColor: 'rgba(10, 10, 30, 0.55)',
  },
  mapLoadingText: {
    ...Typography.body,
    color: 'rgba(255, 255, 255, 0.6)',
    marginTop: Spacing.md,
  },

  // Marker
  markerOuter: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(231, 76, 60, 0.30)',
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

  // Accuracy badge - glass overlay
  accuracyBadge: {
    position: 'absolute',
    top: Spacing.lg,
    left: Spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(10, 10, 30, 0.65)',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.3,
        shadowRadius: 16,
      },
      android: { elevation: 6 },
    }),
  },
  accuracyDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: Spacing.sm,
  },
  accuracyText: {
    ...Typography.caption,
    color: '#FFFFFF',
    fontWeight: FontWeight.medium,
  },
  accuracyMeters: {
    ...Typography.caption,
    color: 'rgba(255, 255, 255, 0.55)',
    marginLeft: Spacing.xs,
  },

  // Address panel - glass bottom sheet
  addressPanel: {
    backgroundColor: 'rgba(10, 10, 30, 0.75)',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.xl,
    paddingBottom: Spacing.xxl,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.12)',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -12 },
        shadowOpacity: 0.5,
        shadowRadius: 40,
      },
      android: { elevation: 12 },
    }),
  },
  panelTitle: {
    ...Typography.title3,
    color: '#FFFFFF',
    marginBottom: Spacing.lg,
  },

  // Address input
  addressInputContainer: {
    marginBottom: Spacing.md,
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
    backgroundColor: 'rgba(231, 76, 60, 0.20)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: Spacing.sm,
  },
  locationDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: Colors.emergencyRed,
  },
  useLocationText: {
    ...Typography.body,
    color: Colors.emergencyRed,
    fontWeight: FontWeight.medium,
  },

  // Confirmed address
  confirmedCard: {
    marginBottom: Spacing.lg,
    borderColor: 'rgba(231, 76, 60, 0.25)',
  },
  confirmedLabel: {
    ...Typography.caption,
    color: Colors.emergencyRed,
    fontWeight: FontWeight.semiBold,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: Spacing.xs,
  },
  confirmedAddress: {
    ...Typography.body,
    color: '#FFFFFF',
  },

  // Confirm button - red glow override
  confirmButton: {
    backgroundColor: 'rgba(231, 76, 60, 0.8)',
    ...Platform.select({
      ios: {
        shadowColor: EMERGENCY_RED_GLOW,
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 1,
        shadowRadius: 20,
      },
      android: { elevation: 8 },
    }),
  },
});

export default EmergencyLocationScreen;
