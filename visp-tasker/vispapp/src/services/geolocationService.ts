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

/**
 * Push known coordinates to the backend without re-querying GPS. Used by
 * the provider's active-job map, which already has a live position from
 * watchPosition().
 */
export async function pushUserLocation(latitude: number, longitude: number): Promise<void> {
    try {
        await apiClient.post('/users/me/location', { latitude, longitude });
    } catch (err) {
        console.warn('Failed to push user location:', err);
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
 * Canadian province / US state names as Mapbox returns them, mapped to the
 * 2-letter codes we store. Migration 036 normalized the existing rows once;
 * writing full names back from the app silently breaks every province filter.
 */
const PROVINCE_CODES: Record<string, string> = {
    'alberta': 'AB', 'british columbia': 'BC', 'manitoba': 'MB',
    'new brunswick': 'NB', 'newfoundland and labrador': 'NL', 'newfoundland': 'NL',
    'nova scotia': 'NS', 'northwest territories': 'NT', 'nunavut': 'NU',
    'ontario': 'ON', 'prince edward island': 'PE', 'quebec': 'QC', 'québec': 'QC',
    'saskatchewan': 'SK', 'yukon': 'YT',
    'alabama': 'AL', 'alaska': 'AK', 'arizona': 'AZ', 'arkansas': 'AR',
    'california': 'CA', 'colorado': 'CO', 'connecticut': 'CT', 'delaware': 'DE',
    'florida': 'FL', 'georgia': 'GA', 'hawaii': 'HI', 'idaho': 'ID',
    'illinois': 'IL', 'indiana': 'IN', 'iowa': 'IA', 'kansas': 'KS',
    'kentucky': 'KY', 'louisiana': 'LA', 'maine': 'ME', 'maryland': 'MD',
    'massachusetts': 'MA', 'michigan': 'MI', 'minnesota': 'MN', 'mississippi': 'MS',
    'missouri': 'MO', 'montana': 'MT', 'nebraska': 'NE', 'nevada': 'NV',
    'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY',
    'north carolina': 'NC', 'north dakota': 'ND', 'ohio': 'OH', 'oklahoma': 'OK',
    'oregon': 'OR', 'pennsylvania': 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
    'south dakota': 'SD', 'tennessee': 'TN', 'texas': 'TX', 'utah': 'UT',
    'vermont': 'VT', 'virginia': 'VA', 'washington': 'WA', 'west virgingia': 'WV',
    'wisconsin': 'WI', 'wyoming': 'WY', 'district of columbia': 'DC',
};

/**
 * Normalize a country to ISO 3166-1 alpha-2. Mapbox returns full names
 * ("Canada", "United States"); the API and Stripe Connect both want codes.
 */
export function normalizeCountry(raw: string): string {
    const c = (raw ?? '').trim().toLowerCase();
    if (c.startsWith('canad') || c.startsWith('canadá')) return 'CA';
    if (c.startsWith('united states') || c === 'usa' || c === 'us' || c === 'u.s.') return 'US';
    if (c.startsWith('mexic') || c.startsWith('méxic')) return 'MX';
    const upper = (raw ?? '').trim().toUpperCase();
    return upper.length === 2 ? upper : upper.slice(0, 2);
}

/**
 * Normalize a province/state to its 2-letter code, keeping an existing code
 * untouched.
 */
export function normalizeProvince(raw: string): string {
    const value = (raw ?? '').trim();
    if (!value) return '';
    const code = PROVINCE_CODES[value.toLowerCase()];
    if (code) return code;
    return value.toUpperCase();
}

/**
 * Parse a formatted address string like "123 Main Street, Ottawa, Ontario K1S 1B9, Canada"
 * into street, city, province, postal and country components. Province and
 * country come back as 2-letter codes.
 */
function parseAddressComponents(formatted: string): {
    street: string;
    city: string;
    province: string;
    postalCode: string;
    country: string;
} {
    const parts = (formatted ?? '').split(',').map(p => p.trim()).filter(Boolean);
    const street = parts[0] ?? '';
    const city = parts[1] ?? '';
    const provincePostal = parts[2] ?? '';
    const country = normalizeCountry(parts[3] ?? 'Canada');

    // Split province from postal code (e.g. "Ontario K1S 1B9" → "ON", "K1S 1B9")
    const ppMatch = provincePostal.match(/^([A-Za-zÀ-ÿ\s.]+?)(?:\s+([A-Z]\d[A-Z]\s?\d[A-Z]\d|\d{5}(?:-\d{4})?))?$/);
    const province = normalizeProvince(ppMatch?.[1]?.trim() ?? provincePostal);
    const postalCode = ppMatch?.[2]?.trim() ?? '';

    return { street, city, province, postalCode, country };
}

// All geo endpoints return bare objects/arrays, NOT wrapped in {data: ...},
// so we use apiClient.post directly to avoid the double-unwrap issue
// in the post() helper (which does response.data.data).

export const geolocationService = {
    /**
     * Forward geocode a structured address to coordinates (single best match).
     */
    async geocodeAddress(address: string, city?: string, country: string = 'CA,US,MX'): Promise<GeocodeResult> {
        const response = await apiClient.post('/geo/geocode', { address, city, country });
        return response.data;
    },

    /**
     * Address autocomplete: returns up to `limit` candidates for the text the
     * user is typing. An empty array is a normal answer, not an error.
     *
     * `proximity` only re-orders results — it never hides one — so passing a
     * stale or approximate position is safe.
     */
    async searchAddresses(
        query: string,
        options?: { country?: string; limit?: number; proximity?: { lat: number; lng: number } },
    ): Promise<GeocodeResult[]> {
        const trimmed = query.trim();
        if (trimmed.length < 3) return [];
        const response = await apiClient.post('/geo/geocode/search', {
            query: trimmed,
            country: options?.country ?? 'CA,US,MX',
            limit: options?.limit ?? 5,
            lat: options?.proximity?.lat,
            lng: options?.proximity?.lng,
        });
        return response.data?.results ?? [];
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
    normalizeCountry,
    normalizeProvince,
};
