import * as Location from 'expo-location';
import apiClient from './apiClient';

// ─── Native Device Location ─────────────────────────────────────────────────

export interface DevicePosition {
    latitude: number;
    longitude: number;
    accuracy: number;
    timestamp: number;
}

/**
 * Request location permission from the user.
 * Returns true if permission was granted.
 */
export async function requestLocationPermission(): Promise<boolean> {
    try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        return status === 'granted';
    } catch {
        return false;
    }
}

/**
 * Get the device's current GPS position.
 */
export async function getCurrentPosition(): Promise<DevicePosition> {
    const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
    });
    return {
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
        accuracy: location.coords.accuracy ?? 0,
        timestamp: location.timestamp,
    };
}

/**
 * Watch the device position for continuous tracking.
 * Returns a LocationSubscription that can be used to remove the watch.
 */
export async function watchPosition(
    onUpdate: (pos: DevicePosition) => void,
    onError?: (err: any) => void,
): Promise<Location.LocationSubscription> {
    try {
        const subscription = await Location.watchPositionAsync(
            {
                accuracy: Location.Accuracy.High,
                distanceInterval: 10,   // metres between updates
                timeInterval: 5000,     // ms between updates
            },
            (location) => {
                onUpdate({
                    latitude: location.coords.latitude,
                    longitude: location.coords.longitude,
                    accuracy: location.coords.accuracy ?? 0,
                    timestamp: location.timestamp,
                });
            },
        );
        return subscription;
    } catch (err) {
        if (onError) onError(err);
        throw err;
    }
}

/**
 * Stop watching a position.
 */
export function clearWatch(subscription: Location.LocationSubscription): void {
    subscription.remove();
}

/**
 * Get device GPS position and send to backend to save.
 * Updates both users.last_latitude/longitude and provider_profiles.home_latitude/longitude.
 */
export async function saveUserLocation(): Promise<void> {
    try {
        const pos = await getCurrentPosition();
        await apiClient.post('/users/me/location', {
            latitude: pos.latitude,
            longitude: pos.longitude,
        });
    } catch (err) {
        console.warn('Failed to save user location:', err);
    }
}

// ─── Backend Geo API ────────────────────────────────────────────────────────
export interface GeocodeResult {
    lat: number;
    lng: number;
    formatted_address: string;
    place_id: string;
    confidence: string;
}

export interface ReverseGeocodeResult {
    formatted_address: string | null;
    place_id: string | null;
    address_components: any[];
}

export interface DirectionsResult {
    distance_meters: number;
    distance_text: string;
    duration_seconds: number;
    duration_text: string;
    overview_polyline: string;
    steps: any[];
}

export interface DistanceResult {
    distance_km: number;
    duration_minutes: number;
    route_polyline: string | null;
    is_fallback: boolean;
}

/**
 * Parse a formatted address string like "123 Main Street, Ottawa, Ontario K1S 1B9, Canada"
 * into city, province, postal, country components.
 */
function parseAddressComponents(formatted: string): {
    street: string;
    city: string;
    province: string;
    postalCode: string;
    country: string;
} {
    const parts = formatted.split(',').map(p => p.trim());
    const street = parts[0] ?? '';
    const city = parts[1] ?? '';
    const provincePostal = parts[2] ?? '';
    const country = parts[3] ?? 'Canada';

    // Split province from postal code (e.g. "Ontario K1S 1B9" → "Ontario", "K1S 1B9")
    const ppMatch = provincePostal.match(/^([A-Za-z\s]+?)(?:\s+([A-Z]\d[A-Z]\s?\d[A-Z]\d|\d{5}(?:-\d{4})?))?$/);
    const province = ppMatch?.[1]?.trim() ?? provincePostal;
    const postalCode = ppMatch?.[2]?.trim() ?? '';

    return { street, city, province, postalCode, country };
}

// All geo endpoints return bare objects/arrays, NOT wrapped in {data: ...},
// so we use apiClient.post directly to avoid the double-unwrap issue
// in the post() helper (which does response.data.data).

export const geolocationService = {
    /**
     * Forward geocode an address to coordinates
     */
    async geocodeAddress(address: string, city?: string): Promise<GeocodeResult> {
        const response = await apiClient.post('/geo/geocode', { address, city });
        return response.data;
    },

    /**
     * Reverse geocode coordinates to an address
     */
    async reverseGeocode(lat: number, lng: number): Promise<ReverseGeocodeResult> {
        const response = await apiClient.post('/geo/reverse', { lat, lng });
        return response.data;
    },

    /**
     * Get driving directions between two points
     */
    async getDirections(
        origin: { lat: number; lng: number },
        dest: { lat: number; lng: number },
        mode: 'driving' | 'walking' | 'cycling' = 'driving'
    ): Promise<DirectionsResult> {
        const response = await apiClient.post('/geo/directions', {
            origin_lat: origin.lat,
            origin_lng: origin.lng,
            dest_lat: dest.lat,
            dest_lng: dest.lng,
            mode,
        });
        return response.data;
    },

    /**
     * Calculate distance and ETA between two points
     */
    async getDistance(
        origin: { lat: number; lng: number },
        dest: { lat: number; lng: number }
    ): Promise<DistanceResult> {
        const response = await apiClient.post('/geo/distance', {
            origin_lat: origin.lat,
            origin_lng: origin.lng,
            dest_lat: dest.lat,
            dest_lng: dest.lng,
        });
        return response.data;
    },

    /**
     * Parse a formatted address into structured components
     */
    parseAddress: parseAddressComponents,
};
