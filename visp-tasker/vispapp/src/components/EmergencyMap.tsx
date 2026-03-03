/**
 * VISP - EmergencyMap Component
 *
 * Map component used throughout the emergency flow.
 * Features:
 *   - Customer location pin
 *   - Provider location (animated marker)
 *   - Route line between customer and provider
 *   - ETA overlay
 *   - Uses Mapbox GL (dark style)
 */

import React, { useEffect, useRef, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  ViewStyle,
} from 'react-native';
import MapboxGL from '@rnmapbox/maps';
import { Config } from '../services/config';
import { Colors } from '../theme/colors';
import { Spacing } from '../theme/spacing';
import { FontSize, FontWeight } from '../theme/typography';
import { BorderRadius } from '../theme/borders';
import { Shadows } from '../theme/shadows';
import { GlassStyles } from '../theme/glass';

MapboxGL.setAccessToken(Config.mapboxAccessToken);

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
}

// ──────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────

const FIT_PADDING = [60, 60, 60, 60]; // [top, right, bottom, left]

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
}: EmergencyMapProps): React.JSX.Element {
  const cameraRef = useRef<MapboxGL.Camera>(null);
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providerLocation]);

  // Fit map to show both markers when provider appears
  useEffect(() => {
    if (cameraRef.current && providerLocation) {
      const lats = [customerLocation.latitude, providerLocation.latitude];
      const lngs = [customerLocation.longitude, providerLocation.longitude];
      const ne: [number, number] = [Math.max(...lngs), Math.max(...lats)];
      const sw: [number, number] = [Math.min(...lngs), Math.min(...lats)];
      cameraRef.current.fitBounds(ne, sw, FIT_PADDING, 1000);
    }
  }, [customerLocation, providerLocation]);

  // Route GeoJSON
  const routeGeoJSON = useMemo(() => {
    if (!routeCoordinates || routeCoordinates.length < 2) return null;
    return {
      type: 'Feature' as const,
      geometry: {
        type: 'LineString' as const,
        coordinates: routeCoordinates.map(c => [c.longitude, c.latitude]),
      },
      properties: {},
    };
  }, [routeCoordinates]);

  return (
    <View style={[styles.container, style]}>
      <MapboxGL.MapView
        style={styles.map}
        styleURL={MapboxGL.StyleURL.Dark}
        scrollEnabled={interactive}
        zoomEnabled={interactive}
        rotateEnabled={false}
        pitchEnabled={false}
        attributionEnabled={false}
        logoEnabled={false}
        accessibilityLabel="Emergency service map"
      >
        <MapboxGL.Camera
          ref={cameraRef}
          zoomLevel={14}
          centerCoordinate={[
            customerLocation.longitude,
            customerLocation.latitude,
          ]}
          animationMode="flyTo"
          animationDuration={1000}
        />

        {/* Customer location marker */}
        <MapboxGL.MarkerView
          id="customer-location"
          coordinate={[
            customerLocation.longitude,
            customerLocation.latitude,
          ]}
        >
          <View style={styles.customerMarkerContainer}>
            <View style={styles.customerMarkerOuter}>
              <View style={styles.customerMarkerInner} />
            </View>
          </View>
        </MapboxGL.MarkerView>

        {/* Provider location marker */}
        {providerLocation && (
          <MapboxGL.MarkerView
            id="provider-location"
            coordinate={[
              providerLocation.longitude,
              providerLocation.latitude,
            ]}
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
          </MapboxGL.MarkerView>
        )}

        {/* Route line */}
        {routeGeoJSON && (
          <MapboxGL.ShapeSource id="emergency-route-source" shape={routeGeoJSON}>
            <MapboxGL.LineLayer
              id="emergency-route-line"
              style={{
                lineColor: Colors.primary,
                lineWidth: 4,
                lineOpacity: 0.8,
                lineCap: 'round',
                lineJoin: 'round',
              }}
            />
          </MapboxGL.ShapeSource>
        )}
      </MapboxGL.MapView>

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
