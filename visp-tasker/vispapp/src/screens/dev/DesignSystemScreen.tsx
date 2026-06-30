/**
 * VISP — Design System preview (DEV only).
 *
 * Renders the new editorial primitives in both dark and light states so we
 * can validate the system on a real device before migrating screens. Hidden
 * behind a long-press in SettingsScreen footer (see SettingsScreen.tsx).
 *
 * This screen is removed in Phase 5 cleanup.
 */

import React from 'react';
import { ScrollView, StyleSheet, View, Text, Switch } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import {
  Screen,
  TopBar,
  ScreenTitle,
  Eyebrow,
  Headline,
  IconBtn,
  Avatar,
  Card,
  Chip,
  StatTile,
  MiniBars,
  Row,
  MenuItem,
  SearchInput,
  OnlinePill,
  Icon,
} from '../../components/visp';
import { useVispTheme, VispSpace, VispText, FontSansBold } from '../../theme/visp';
import { useAppStore } from '../../stores/appStore';

export default function DesignSystemScreen(): React.JSX.Element {
  const t = useVispTheme();
  const nav = useNavigation();
  const darkMode = useAppStore((s) => s.darkMode);
  const setDarkMode = useAppStore((s) => s.setDarkMode);

  return (
    <Screen>
      <ScreenTitle
        title="Design System"
        sub="§ Editorial Refresh"
        onBack={() => nav.goBack()}
        right={
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Eyebrow>{darkMode ? 'DARK' : 'LIGHT'}</Eyebrow>
            <Switch value={darkMode} onValueChange={setDarkMode} />
          </View>
        }
      />

      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        {/* — Palette swatches — */}
        <Eyebrow style={styles.section}>Palette</Eyebrow>
        <View style={styles.swatches}>
          {([
            ['bg', t.bg], ['surface', t.surface], ['card', t.card], ['cardHi', t.cardHi],
            ['border', t.border], ['violet', t.violet], ['ok', t.ok], ['danger', t.danger],
          ] as const).map(([name, c]) => (
            <View key={name} style={[styles.swatch, { backgroundColor: c, borderColor: t.border }]}>
              <Text style={[VispText.eyebrow, { color: t.text2 }]}>{name}</Text>
            </View>
          ))}
        </View>

        {/* — Typography — */}
        <Eyebrow style={styles.section}>Typography</Eyebrow>
        <Card style={styles.spacer}>
          <Eyebrow>§ EYEBROW · MONO 10/0.16em</Eyebrow>
          <Headline style={{ marginTop: 6 }}>Headline / Manrope 700</Headline>
          <Text style={[VispText.headlineMid, { color: t.text, marginTop: 10 }]}>Section · 22 bold</Text>
          <Text style={[VispText.body, { color: t.text2, marginTop: 10 }]}>
            Body paragraph. Manrope 500. Used for descriptions, blurbs, and supporting copy across cards.
          </Text>
          <Text
            style={{
              fontFamily: FontSansBold,
              fontSize: 42,
              fontWeight: '700',
              letterSpacing: -1.05,
              color: t.text,
              marginTop: 10,
            }}
          >
            $1,284.50
          </Text>
          <Text style={[VispText.caption, { color: t.text3, marginTop: 6 }]}>WK 21 · 2026</Text>
        </Card>

        {/* — Top bar example — */}
        <Eyebrow style={styles.section}>TopBar — Customer vs Provider</Eyebrow>
        <Card padding={0} style={styles.spacer}>
          <TopBar
            left={
              <>
                <Icon name="pin" size={14} color={t.text2} />
                <View>
                  <Eyebrow>BURLINGTON</Eyebrow>
                  <Text style={[VispText.bodyStrong, { color: t.text, fontSize: 13, marginTop: 1 }]}>Hey, Alex</Text>
                </View>
              </>
            }
            right={
              <>
                <IconBtn name="bell" />
                <Avatar initials="A" />
              </>
            }
          />
          <View style={{ height: 1, backgroundColor: t.border }} />
          <TopBar
            left={
              <>
                <Avatar initials="M" />
                <View>
                  <Eyebrow>PRO · LV 4</Eyebrow>
                  <Text style={[VispText.bodyStrong, { color: t.text, fontSize: 13, marginTop: 1 }]}>Marcus R.</Text>
                </View>
              </>
            }
            right={
              <>
                <OnlinePill />
                <IconBtn name="settings" />
              </>
            }
          />
        </Card>

        {/* — Cards & input — */}
        <Eyebrow style={styles.section}>Card · Search · Chips</Eyebrow>
        <Card style={styles.spacer}>
          <Eyebrow>NEED HELP WITH ANYTHING?</Eyebrow>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
            <Text style={[VispText.headlineMid, { color: t.text3 }]}>What needs doing?</Text>
            <IconBtn name="plus" />
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 14 }}>
            <Chip>Cleaning</Chip>
            <Chip>Mount TV</Chip>
            <Chip>Move help</Chip>
            <Chip>Yard</Chip>
            <Chip accent>Emergency</Chip>
          </View>
        </Card>
        <View style={{ marginBottom: 12 }}>
          <SearchInput placeholder="Search categories or providers" />
        </View>

        {/* — Stats + MiniBars — */}
        <Eyebrow style={styles.section}>Stats · Chart</Eyebrow>
        <Card style={styles.spacer}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <View>
              <Eyebrow>THIS WEEK</Eyebrow>
              <Text style={{ fontFamily: FontSansBold, fontSize: 42, fontWeight: '700', letterSpacing: -1.05, color: t.text, marginTop: 4 }}>
                $1,284<Text style={{ fontSize: 24, color: t.text2 }}>.50</Text>
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 }}>
                <Icon name="trending" size={12} color={t.violet} />
                <Text style={[VispText.eyebrow, { color: t.violet }]}>↑ 18% VS LAST WEEK</Text>
              </View>
            </View>
            <Eyebrow>WK 21 · 2026</Eyebrow>
          </View>
          <View style={{ marginTop: 16 }}>
            <MiniBars data={[40, 55, 30, 70, 100, 60, 25]} peakIndex={4} />
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
              {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
                <Text key={i} style={[VispText.eyebrowTight, { color: t.text3 }]}>{d}</Text>
              ))}
            </View>
          </View>
        </Card>
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 14 }}>
          <StatTile label="★ RATING" value="4.9" />
          <StatTile label="JOBS DONE" value="312" />
          <StatTile label="RESPONSE" value="98%" accent />
        </View>

        {/* — Rows / Menu — */}
        <Eyebrow style={styles.section}>Rows · Menu</Eyebrow>
        <Card padding={0} style={styles.spacer}>
          <View style={{ padding: VispSpace.card, paddingBottom: 0 }}>
            <MenuItem icon="card" title="Payment methods" sub="2 cards on file" />
            <MenuItem icon="pin" title="Saved addresses" sub="3 saved" />
            <MenuItem icon="bell" title="Notifications" sub="Push, email, SMS" />
            <MenuItem icon="shield" title="Privacy & security" />
            <MenuItem icon="logout" title="Sign out" danger last />
          </View>
        </Card>

        <View style={{ height: 40 }} />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: VispSpace.gutter, paddingBottom: 40 },
  section: { marginTop: 18, marginBottom: 10 },
  spacer: { marginBottom: 12 },
  swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  swatch: {
    width: '23%',
    aspectRatio: 1,
    borderRadius: 10,
    borderWidth: 1,
    padding: 8,
    justifyContent: 'flex-end',
  },
});
