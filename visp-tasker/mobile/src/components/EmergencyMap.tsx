/**
 * VISP - EmergencyMap Component
 *
 * Map component used throughout the emergency flow.
 * Features:
 *   - Customer location pin
 *   - Provider location (animated marker)
 *   - Route line between customer and provider
 *   - ETA overlay
 *   - Uses react-native-maps (MapView)
 */

import React, { useEffect, useRef, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  Platform,
  ViewStyle,
} from 'react-native';
import MapView, {
  Marker,
  Polyline,
  PROVIDER_GOOGLE,
  Region,
} from 'react-native-maps';
import { Colors } from '../theme/colors';
import { Spacing } from '../theme/spacing';
import { FontSize, FontWeight } from '../theme/typography';
import { BorderRadius } from '../theme/borders';
import { Shadows } from '../theme/shadows';
import { GlassStyles } from '../theme/glass';

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

interface Coordinate {
  latitude: number;
  longitude: number;
}

interface EmergencyMapProps {
  customerLocation: Coordinate;
  providerLocation?: Coordinate;
  routeCoordinates?: Coordinate[];
  etaMinutes?: number;
  showEtaOverlay?: boolean;
  style?: ViewStyle;
  interactive?: boolean;
  onRegionChange?: (region: Region) => void;
}

// ──────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────

const DEFAULT_DELTA = 0.015;
const MAP_PADDING = { top: 60, right: 60, bottom: 60, left: 60 };

// ──────────────────────────────────────────────
// Component
// ──────────────────────────────────────────────

function EmergencyMap({
  customerLocation,
  providerLocation,
  routeCoordinates,
  etaMinutes,
  showEtaOverlay = true,
  style,
  interactive = true,
  onRegionChange,
}: EmergencyMapProps): React.JSX.Element {
  const mapRef = useRef<MapView>(null);
  const providerPulse = useRef(new Animated.Value(0.4)).current;

  // Animate provider marker pulse
  useEffect(() => {
    if (providerLocation) {
      const animation = Animated.loop(
        Animated.sequence([
          Animated.timing(providerPulse, {
            toValue: 1,
            duration: 1000,
            useNativeDriver: true,
          }),
          Animated.timing(providerPulse, {
            toValue: 0.4,
            duration: 1000,
            useNativeDriver: true,
          }),
        ]),
      );
      animation.start();
      return () => animation.stop();
    }
  }, [providerLocation, providerPulse]);

  // Fit map to show both markers when provider appears
  useEffect(() => {
    if (mapRef.current && providerLocation) {
      const coordinates: Coordinate[] = [customerLocation];
      if (providerLocation) {
        coordinates.push(providerLocation);
      }
      mapRef.current.fitToCoordinates(coordinates, {
        edgePadding: MAP_PADDING,
        animated: true,
      });
    }
  }, [customerLocation, providerLocation]);

  // Initial region centered on customer
  const initialRegion = useMemo(
    () => ({
      latitude: customerLocation.latitude,
      longitude: customerLocation.longitude,
      latitudeDelta: DEFAULT_DELTA,
      longitudeDelta: DEFAULT_DELTA,
    }),
    [customerLocation],
  );

  return (
    <View style={[styles.container, style]}>
      <MapView
        ref={mapRef}
        style={styles.map}
        provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
        initialRegion={initialRegion}
        scrollEnabled={interactive}
        zoomEnabled={interactive}
        rotateEnabled={false}
        pitchEnabled={false}
        showsUserLocation={false}
        showsMyLocationButton={false}
        onRegionChangeComplete={onRegionChange}
        customMapStyle={darkMapStyle}
        accessibilityLabel="Emergency service map"
      >
        {/* Customer location marker */}
        <Marker
          coordinate={customerLocation}
          title="Your Location"
          description="Emergency location"
          anchor={{ x: 0.5, y: 0.5 }}
        >
          <View style={styles.customerMarkerContainer}>
            <View style={styles.customerMarkerOuter}>
              <View style={styles.customerMarkerInner} />
            </View>
          </View>
        </Marker>

        {/* Provider location marker */}
        {providerLocation && (
          <Marker
            coordinate={providerLocation}
            title="Provider"
            description={
              etaMinutes
                ? `Arriving in ${etaMinutes} minutes`
                : 'En route to you'
            }
            anchor={{ x: 0.5, y: 0.5 }}
          >
            <View style={styles.providerMarkerContainer}>
              <Animated.View
                style={[
                  styles.providerPulseRing,
                  { opacity: providerPulse },
                ]}
              />
              <View style={styles.providerMarkerOuter}>
                <View style={styles.providerMarkerInner}>
                  <Text style={styles.providerMarkerIcon}>P</Text>
                </View>
              </View>
            </View>
          </Marker>
        )}

        {/* Route polyline */}
        {routeCoordinates && routeCoordinates.length > 1 && (
          <Polyline
            coordinates={routeCoordinates}
            strokeColor={Colors.primary}
            strokeWidth={4}
            lineDashPattern={[0]}
          />
        )}
      </MapView>

      {/* ETA overlay */}
      {showEtaOverlay && etaMinutes !== undefined && etaMinutes > 0 && (
        <View style={styles.etaOverlay}>
          <Text style={styles.etaLabel}>ETA</Text>
          <Text style={styles.etaValue}>{etaMinutes}</Text>
          <Text style={styles.etaUnit}>min</Text>
        </View>
      )}
    </View>
  );
}

// ──────────────────────────────────────────────
// Dark map style for the VISP dark theme
// ──────────────────────────────────────────────

const darkMapStyle = [
  {
    elementType: 'geometry',
    stylers: [{ color: '#1A1A2E' }],
  },
  {
    elementType: 'labels.text.stroke',
    stylers: [{ color: '#1A1A2E' }],
  },
  {
    elementType: 'labels.text.fill',
    stylers: [{ color: '#6B6B80' }],
  },
  {
    featureType: 'road',
    elementType: 'geometry',
    stylers: [{ color: '#2A2A40' }],
  },
  {
    featureType: 'road',
    elementType: 'geometry.stroke',
    stylers: [{ color: '#16213E' }],
  },
  {
    featureType: 'water',
    elementType: 'geometry',
    stylers: [{ color: '#16213E' }],
  },
  {
    featureType: 'poi',
    elementType: 'geometry',
    stylers: [{ color: '#16213E' }],
  },
  {
    featureType: 'transit',
    stylers: [{ visibility: 'off' }],
  },
];

// ──────────────────────────────────────────────
// Styles
// ──────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    overflow: 'hidden',
    borderRadius: BorderRadius.md,
  },
  map: {
    flex: 1,
  },

  // Customer marker
  customerMarkerContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  customerMarkerOuter: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: `${Colors.emergencyRed}30`,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: Colors.emergencyRed,
  },
  customerMarkerInner: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: Colors.emergencyRed,
  },

  // Provider marker
  providerMarkerContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 48,
    height: 48,
  },
  providerPulseRing: {
    position: 'absolute',
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: `${Colors.primary}30`,
  },
  providerMarkerOuter: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    ...Shadows.md,
  },
  providerMarkerInner: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: Colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  providerMarkerIcon: {
    fontSize: 14,
    fontWeight: FontWeight.bold,
    color: Colors.primary,
  },

  // ETA overlay
  etaOverlay: {
    position: 'absolute',
    top: Spacing.lg,
    right: Spacing.lg,
    ...GlassStyles.darkPanel,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    alignItems: 'center',
  },
  etaLabel: {
    fontSize: FontSize.caption,
    fontWeight: FontWeight.medium,
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  etaValue: {
    fontSize: FontSize.title1,
    fontWeight: FontWeight.bold,
    color: Colors.textPrimary,
  },
  etaUnit: {
    fontSize: FontSize.caption,
    fontWeight: FontWeight.regular,
    color: Colors.textSecondary,
  },
});

export default React.memo(EmergencyMap);
