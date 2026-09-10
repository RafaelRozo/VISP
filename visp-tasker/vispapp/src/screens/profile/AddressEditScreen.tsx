/**
 * VISP — Address editor with Mapbox autocomplete.
 *
 * Same UX pattern as TaskSelectionScreen: the user types, we debounce
 * (300ms) and call `geolocationService.geocodeAddress()`, then surface a
 * suggestion row. Tapping the suggestion fills the divided fields
 * (street/city/province/postal/country) and stores lat/lng so jobs and
 * Stripe Connect onboarding pick up the correct location.
 *
 * Fields stay editable below the search input so the provider can fine-tune
 * the parsed components (Mapbox sometimes misses the unit number, etc).
 */

import React, { useCallback, useRef, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';

import { Screen } from '../../components/visp';
import { useVispTheme, VispText, VispSpace } from '../../theme/visp';
import { GlassButton, GlassInput } from '../../components/glass';
import { useTranslation } from '../../i18n';
import { useAuthStore } from '../../stores/authStore';
import { userService } from '../../services/userService';
import { geolocationService } from '../../services/geolocationService';

interface Suggestion {
  formattedAddress: string;
  street: string;
  city: string;
  province: string;
  postalCode: string;
  country: string;
  latitude: number;
  longitude: number;
}

export default function AddressEditScreen(): React.JSX.Element {
  const t = useVispTheme();
  const { t: tr } = useTranslation();
  const navigation = useNavigation<any>();
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);

  const addr = user?.defaultAddress;
  const initialFormatted = addr?.formattedAddress || [addr?.street, addr?.city, addr?.province, addr?.postalCode, addr?.country].filter(Boolean).join(', ');

  const [search, setSearch] = useState(initialFormatted);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searchFailed, setSearchFailed] = useState(false);

  const [street, setStreet] = useState(addr?.street ?? '');
  const [city, setCity] = useState(addr?.city ?? '');
  const [province, setProvince] = useState(addr?.province ?? '');
  const [postalCode, setPostalCode] = useState(addr?.postalCode ?? '');
  const [country, setCountry] = useState((addr?.country ?? 'CA').toUpperCase());
  const [lat, setLat] = useState<number | null>(addr?.latitude ?? null);
  const [lng, setLng] = useState<number | null>(addr?.longitude ?? null);
  const [formatted, setFormatted] = useState<string>(initialFormatted);
  const [saving, setSaving] = useState(false);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onSearchChange = useCallback((text: string) => {
    setSearch(text);
    setSearchFailed(false);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (text.trim().length < 3) {
      setSearching(false);
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }
    setSearching(true);
    debounceRef.current = setTimeout(async () => {
      try {
        // Saved-address search targets the Canadian launch market, regardless of device location.
        const results = await geolocationService.searchAddresses(text, {
          country: 'CA',
          proximity:
            addr?.latitude != null && addr?.longitude != null
              ? { lat: addr.latitude, lng: addr.longitude }
              : undefined,
        });
        setSuggestions(
          results.map((r) => {
            const parsed = geolocationService.parseAddress(r.formatted_address);
            return {
              formattedAddress: r.formatted_address,
              street: parsed.street,
              city: parsed.city,
              province: parsed.province,
              postalCode: parsed.postalCode,
              country: parsed.country || 'CA',
              latitude: r.lat,
              longitude: r.lng,
            };
          }),
        );
        setShowSuggestions(results.length > 0);
      } catch (err) {
        console.warn('[AddressEdit] geocode failed', err);
        setSearchFailed(true);
        setSuggestions([]);
        setShowSuggestions(false);
      } finally {
        setSearching(false);
      }
    }, 300);
  }, [addr?.latitude, addr?.longitude]);

  const onPickSuggestion = useCallback((s: Suggestion) => {
    setStreet(s.street);
    setCity(s.city);
    setProvince(s.province);
    setPostalCode(s.postalCode);
    setCountry(geolocationService.normalizeCountry(s.country));
    setLat(s.latitude);
    setLng(s.longitude);
    setFormatted(s.formattedAddress);
    setSearch(s.formattedAddress);
    setShowSuggestions(false);
  }, []);

  const onSave = async () => {
    const c = country.trim().toUpperCase();
    if (!['CA', 'US'].includes(c)) {
      Alert.alert(tr('addressEdit.invalidCountryTitle'), tr('addressEdit.invalidCountryBody'));
      return;
    }
    if (!street.trim() || !city.trim() || !province.trim() || !postalCode.trim()) {
      Alert.alert(tr('payoutsV2.fillAllTitle'), tr('payoutsV2.fillAllBody'));
      return;
    }
    setSaving(true);
    try {
      const updated = await userService.updateProfile({
        defaultAddress: {
          street: street.trim(),
          city: city.trim(),
          province: province.trim(),
          postalCode: postalCode.trim().toUpperCase(),
          country: c,
          latitude: lat,
          longitude: lng,
          formattedAddress: formatted || `${street.trim()}, ${city.trim()}, ${province.trim()} ${postalCode.trim()}, ${c}`,
        },
      });
      setUser(updated);
      navigation.goBack();
    } catch (err: any) {
      Alert.alert(tr('common.error'), err?.message ?? tr('payoutsV2.errorGeneric'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <Text style={[VispText.headlineMid, { color: t.text, marginBottom: 8 }]}>
            {tr('addressEdit.title')}
          </Text>
          <Text style={[VispText.body, { color: t.text2, marginBottom: VispSpace.section }]}>
            {tr('addressEdit.subtitle')}
          </Text>

          <GlassInput
            label={tr('addressEdit.search')}
            value={search}
            onChangeText={onSearchChange}
            placeholder={tr('addressEdit.searchPlaceholder')}
            autoCapitalize="words"
            autoCorrect={false}
          />
          {searching && (
            <Text style={[VispText.caption, { color: t.text3, marginTop: 4 }]}>
              {tr('addressEdit.searching')}
            </Text>
          )}
          {searchFailed && !searching && (
            <Text style={[VispText.caption, { color: t.text2, marginTop: 4 }]}>
              {tr('addressEdit.searchFailed')}
            </Text>
          )}
          {showSuggestions && suggestions.length > 0 && (
            <View style={[styles.suggestBox, { backgroundColor: t.card, borderColor: t.border }]}>
              {suggestions.map((s, i) => (
                <TouchableOpacity key={i} onPress={() => onPickSuggestion(s)} style={[styles.suggestRow, { borderBottomColor: t.border }]}>
                  <Text style={[VispText.body, { color: t.text }]} numberOfLines={2}>
                    {s.formattedAddress}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          <View style={{ height: VispSpace.section }} />

          <Text style={[VispText.caption, { color: t.text3, marginBottom: 6 }]}>
            {tr('addressEdit.fieldsLabel')}
          </Text>

          <GlassInput label={tr('addressEdit.street')} value={street} onChangeText={setStreet} textContentType="streetAddressLine1" />
          <GlassInput label={tr('addressEdit.city')} value={city} onChangeText={setCity} textContentType="addressCity" />
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <GlassInput label={tr('addressEdit.province')} value={province} onChangeText={setProvince} autoCapitalize="characters" placeholder="ON" />
            </View>
            <View style={{ flex: 2 }}>
              <GlassInput label={tr('addressEdit.postalCode')} value={postalCode} onChangeText={setPostalCode} autoCapitalize="characters" placeholder="M5V 0A1" />
            </View>
          </View>
          <GlassInput label={tr('addressEdit.country')} value={country} onChangeText={setCountry} autoCapitalize="characters" maxLength={2} placeholder="CA" />

          <Text style={[VispText.body, { color: t.text3, marginTop: 8 }]}>
            {tr('addressEdit.stripeNote')}
          </Text>

          <View style={{ height: VispSpace.section * 2 }} />
          <GlassButton title={tr('common.save')} variant="glow" loading={saving} onPress={onSave} />
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: VispSpace.gutter, paddingTop: 12, paddingBottom: 40 },
  row: { flexDirection: 'row', gap: 10 },
  suggestBox: { marginTop: 6, borderRadius: 10, borderWidth: 1, overflow: 'hidden' },
  suggestRow: { paddingVertical: 12, paddingHorizontal: 12, borderBottomWidth: StyleSheet.hairlineWidth },
});
