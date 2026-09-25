/**
 * VISP — Payouts onboarding · Personal Info step.
 *
 * Collects first/last name, DOB, full address, phone and email. Posts to
 * /v2/identity. On success, advances to the next step based on the server's
 * `onboardingStep`.
 *
 * La dirección se busca, no se teclea. Antes eran cinco campos en blanco y
 * solo se rellenaban si el proveedor YA tenía dirección guardada; quien no la
 * tenía escribía calle, ciudad, provincia y código postal a mano, con lo que
 * eso implica en un formulario que Stripe valida contra registros oficiales.
 * Es el mismo buscador de `AddressEditScreen`, y los campos siguen editables
 * debajo porque Mapbox a veces se deja el número de unidad.
 */

import React, { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';

import { Screen } from '../../../components/visp';
import { useVispTheme, VispText, VispSpace } from '../../../theme/visp';
import { GlassButton, GlassInput } from '../../../components/glass';
import { useTranslation } from '../../../i18n';
import { useAuthStore } from '../../../stores/authStore';
import { payoutsV2Service } from '../../../services/payoutsV2Service';
import { geolocationService } from '../../../services/geolocationService';
import { advanceToStep } from './navigation';

export default function PersonalInfoStep(): React.JSX.Element {
  const t = useVispTheme();
  const { t: tr } = useTranslation();
  const navigation = useNavigation<any>();
  const user = useAuthStore((s) => s.user);

  const addr = user?.defaultAddress;

  const [firstName, setFirstName] = useState(user?.firstName ?? '');
  const [lastName, setLastName] = useState(user?.lastName ?? '');
  const [dobYear, setDobYear] = useState('');
  const [dobMonth, setDobMonth] = useState('');
  const [dobDay, setDobDay] = useState('');
  const [line1, setLine1] = useState(addr?.street ?? '');
  const [city, setCity] = useState(addr?.city ?? '');
  const [state, setState] = useState(addr?.province ?? '');
  const [postal, setPostal] = useState(addr?.postalCode ?? '');
  const [country, setCountry] = useState(addr?.country ?? 'CA');
  const [phone, setPhone] = useState(user?.phone ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [submitting, setSubmitting] = useState(false);

  // --- Buscador de dirección (mismo patrón que AddressEditScreen) ---
  const [busqueda, setBusqueda] = useState(
    addr?.formattedAddress ??
      [addr?.street, addr?.city, addr?.province, addr?.postalCode].filter(Boolean).join(', '),
  );
  const [sugerencias, setSugerencias] = useState<
    { formatted: string; street: string; city: string; province: string; postalCode: string; country: string }[]
  >([]);
  const [buscando, setBuscando] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const alEscribir = useCallback((texto: string) => {
    setBusqueda(texto);
    if (debounce.current) clearTimeout(debounce.current);
    if (texto.trim().length < 3) {
      setSugerencias([]);
      setBuscando(false);
      return;
    }
    setBuscando(true);
    debounce.current = setTimeout(async () => {
      try {
        // Canadá: la cuenta conectada se crea con country=CA y Stripe valida la
        // dirección contra registros canadienses. Ofrecer otras sería llevar al
        // proveedor a un dato que le van a rechazar.
        const res = await geolocationService.searchAddresses(texto, { country: 'CA' });
        setSugerencias(
          res.map((r) => {
            const p = geolocationService.parseAddress(r.formatted_address);
            return {
              formatted: r.formatted_address,
              street: p.street,
              city: p.city,
              province: p.province,
              postalCode: p.postalCode,
              country: p.country || 'CA',
            };
          }),
        );
      } catch {
        // Sin sugerencias se escribe a mano: los campos siguen ahí debajo.
        setSugerencias([]);
      } finally {
        setBuscando(false);
      }
    }, 300);
  }, []);

  const alElegir = useCallback((s: (typeof sugerencias)[number]) => {
    setLine1(s.street);
    setCity(s.city);
    setState(s.province);
    setPostal(s.postalCode);
    setCountry(geolocationService.normalizeCountry(s.country));
    setBusqueda(s.formatted);
    setSugerencias([]);
  }, []);

  const onSubmit = async () => {
    const year = parseInt(dobYear, 10);
    const month = parseInt(dobMonth, 10);
    const day = parseInt(dobDay, 10);
    if (!firstName || !lastName || !year || !month || !day || !line1 || !city || !state || !postal || !phone || !email) {
      Alert.alert(tr('payoutsV2.fillAllTitle'), tr('payoutsV2.fillAllBody'));
      return;
    }
    setSubmitting(true);
    try {
      const res = await payoutsV2Service.submitIdentity({
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        dob_year: year,
        dob_month: month,
        dob_day: day,
        address_line1: line1.trim(),
        address_city: city.trim(),
        address_state: state.trim(),
        address_postal_code: postal.replace(/\s/g, ''),
        address_country: country.trim().toUpperCase(),
        phone: phone.trim(),
        email: email.trim(),
      });
      advanceToStep(navigation, res.onboardingStep);
    } catch (err: any) {
      Alert.alert(tr('common.error'), err?.message ?? tr('payoutsV2.errorGeneric'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Screen edges={["top","bottom"]}>
      <Header onBack={() => navigation.goBack()} title={tr('payoutsV2.personalInfoTitle')} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <Text style={[VispText.body, { color: t.text2, marginBottom: VispSpace.section }]}>
            {tr('payoutsV2.personalInfoSubtitle')}
          </Text>

          <GlassInput label={tr('payoutsV2.firstName')} value={firstName} onChangeText={setFirstName} autoCapitalize="words" textContentType="givenName" />
          <GlassInput label={tr('payoutsV2.lastName')} value={lastName} onChangeText={setLastName} autoCapitalize="words" textContentType="familyName" />

          <Text style={[VispText.label, { color: t.text2, marginTop: VispSpace.section }]}>{tr('payoutsV2.dob')}</Text>
          <View style={styles.dobRow}>
            <View style={{ flex: 1 }}>
              <GlassInput label={tr('payoutsV2.dobYear')} value={dobYear} onChangeText={setDobYear} keyboardType="number-pad" maxLength={4} placeholder="1990" />
            </View>
            <View style={{ flex: 1 }}>
              <GlassInput label={tr('payoutsV2.dobMonth')} value={dobMonth} onChangeText={setDobMonth} keyboardType="number-pad" maxLength={2} placeholder="01" />
            </View>
            <View style={{ flex: 1 }}>
              <GlassInput label={tr('payoutsV2.dobDay')} value={dobDay} onChangeText={setDobDay} keyboardType="number-pad" maxLength={2} placeholder="01" />
            </View>
          </View>

          <GlassInput
            label={tr('payoutsV2.addressSearch')}
            value={busqueda}
            onChangeText={alEscribir}
            autoCapitalize="words"
          />
          {buscando ? (
            <View style={{ paddingVertical: 8 }}>
              <ActivityIndicator size="small" color={t.violet} />
            </View>
          ) : null}
          {sugerencias.length > 0 ? (
            <View style={[styles.sugerencias, { backgroundColor: t.card, borderColor: t.border }]}>
              {sugerencias.map((s, i) => (
                <TouchableOpacity
                  key={i}
                  onPress={() => alElegir(s)}
                  style={[styles.sugerencia, { borderBottomColor: t.border }]}
                >
                  <Text style={[VispText.body, { color: t.text }]}>{s.formatted}</Text>
                </TouchableOpacity>
              ))}
            </View>
          ) : null}

          <GlassInput label={tr('payoutsV2.addressLine1')} value={line1} onChangeText={setLine1} textContentType="streetAddressLine1" />
          <GlassInput label={tr('payoutsV2.addressCity')} value={city} onChangeText={setCity} textContentType="addressCity" />
          <View style={styles.dobRow}>
            <View style={{ flex: 1 }}>
              <GlassInput label={tr('payoutsV2.addressState')} value={state} onChangeText={setState} autoCapitalize="characters" maxLength={3} />
            </View>
            <View style={{ flex: 2 }}>
              <GlassInput label={tr('payoutsV2.addressPostalCode')} value={postal} onChangeText={setPostal} autoCapitalize="characters" />
            </View>
          </View>
          <GlassInput label={tr('payoutsV2.addressCountry')} value={country} onChangeText={setCountry} autoCapitalize="characters" maxLength={2} />

          <GlassInput label={tr('payoutsV2.phone')} value={phone} onChangeText={setPhone} keyboardType="phone-pad" textContentType="telephoneNumber" />
          <GlassInput label={tr('payoutsV2.email')} value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" textContentType="emailAddress" />

          <View style={{ height: VispSpace.section }} />
          <GlassButton title={tr('common.continue')} variant="glow" loading={submitting} onPress={onSubmit} />
          <View style={{ height: VispSpace.section }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

function Header({ onBack, title }: { onBack: () => void; title: string }) {
  const t = useVispTheme();
  return (
    <View style={styles.header}>
      <TouchableOpacity onPress={onBack} hitSlop={12}>
        <Text style={[VispText.bodyStrong, { color: t.violet }]}>{'< '}</Text>
      </TouchableOpacity>
      <Text style={[VispText.headlineMid, { color: t.text, flex: 1, marginLeft: 8 }]}>{title}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  sugerencias: { marginTop: 6, marginBottom: 8, borderRadius: 10, borderWidth: 1, overflow: 'hidden' },
  sugerencia: { paddingVertical: 12, paddingHorizontal: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  scroll: { paddingHorizontal: VispSpace.gutter, paddingBottom: 40 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: VispSpace.gutter, paddingTop: 12, paddingBottom: VispSpace.section },
  dobRow: { flexDirection: 'row', gap: 10 },
});
