/**
 * VISP — Editorial design tokens (Test-version refresh)
 *
 * New design language proposed in `visp-tasker/newdesign/`:
 *   - Black-paper editorial dark mode + paper-white light mode
 *   - Manrope (sans) + JetBrains Mono (eyebrows, labels, numerals)
 *   - 1px borders, radius 10 (cards) / 4 (chips) / 999 (pills)
 *   - Lavender accent used sparingly (state, peaks, focus)
 *
 * Coexists with the legacy glass tokens in `colors.ts` and `glass.ts`.
 * Glass is preserved only for Emergency flows.
 */

import { TextStyle, Platform } from 'react-native';
import { useAppStore } from '../stores/appStore';

// ─────────────────────────────────────────────────────────────
// Palette
// ─────────────────────────────────────────────────────────────

export interface VispPalette {
  bg: string;
  surface: string;
  card: string;
  cardHi: string;
  deep: string;
  border: string;
  borderStrong: string;
  text: string;
  text2: string;
  text3: string;
  text4: string;
  violet: string;
  violetDim: string;
  violetLine: string;
  ok: string;
  danger: string;
  isDark: boolean;
}

export const vispDark: VispPalette = {
  bg: '#0A0A0A',
  surface: '#111111',
  card: '#161616',
  cardHi: '#1A1A1A',
  deep: '#070707',
  border: '#222222',
  borderStrong: '#2E2E2E',
  text: '#FFFFFF',
  text2: '#A8A8A8',
  text3: '#6A6A6A',
  text4: '#454545',
  violet: '#A78BFA',
  violetDim: 'rgba(167,139,250,0.10)',
  violetLine: 'rgba(167,139,250,0.30)',
  ok: '#9AE6B4',
  danger: '#FC8181',
  isDark: true,
};

export const vispLight: VispPalette = {
  bg: '#FFFFFF',
  surface: '#FAFAFA',
  card: '#FFFFFF',
  cardHi: '#F5F5F5',
  deep: '#F0F0F0',
  border: '#E6E6E6',
  borderStrong: '#D1D1D1',
  text: '#0A0A0A',
  text2: '#525252',
  text3: '#8A8A8A',
  text4: '#C4C4C4',
  violet: '#7C3AED',
  violetDim: 'rgba(124,58,237,0.06)',
  violetLine: 'rgba(124,58,237,0.22)',
  ok: '#15803D',
  danger: '#B91C1C',
  isDark: false,
};

// ─────────────────────────────────────────────────────────────
// Typography
// ─────────────────────────────────────────────────────────────
//
// Font families load via @expo-google-fonts/manrope and
// @expo-google-fonts/jetbrains-mono. We register the family names
// expo-font exposes; if loading fails we fall back to system.

export const FontSans = Platform.select({
  ios: 'Manrope_500Medium',
  android: 'Manrope_500Medium',
  default: 'Manrope_500Medium',
});

export const FontSansSemiBold = Platform.select({
  ios: 'Manrope_600SemiBold',
  android: 'Manrope_600SemiBold',
  default: 'Manrope_600SemiBold',
});

export const FontSansBold = Platform.select({
  ios: 'Manrope_700Bold',
  android: 'Manrope_700Bold',
  default: 'Manrope_700Bold',
});

export const FontMono = Platform.select({
  ios: 'JetBrainsMono_500Medium',
  android: 'JetBrainsMono_500Medium',
  default: 'JetBrainsMono_500Medium',
});

// Pre-composed text styles. Use as `style={[VispText.eyebrow, { color: t.text3 }]}`.
// We never bake colors into these — caller supplies via theme.
export const VispText = {
  // Mono uppercase micro-label ("BURLINGTON", "§ Profile", "PRO · LV 4")
  eyebrow: {
    fontFamily: FontMono,
    fontSize: 10,
    letterSpacing: 1.6, // 0.16em at 10px
    textTransform: 'uppercase',
  } as TextStyle,

  // Smaller eyebrow for tab labels (less tracking)
  eyebrowTight: {
    fontFamily: FontMono,
    fontSize: 10,
    letterSpacing: 0.8, // 0.08em at 10px
    textTransform: 'uppercase',
  } as TextStyle,

  // Big editorial headline ("VISP", "VISP · Pro", "Browse")
  headline: {
    fontFamily: FontSansBold,
    fontSize: 26,
    fontWeight: '700',
    letterSpacing: -0.65, // -0.025em at 26px
    lineHeight: 28, // 26 * 1.05 ≈ 28
  } as TextStyle,

  // Section headline (mid)
  headlineMid: {
    fontFamily: FontSansBold,
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: -0.44,
    lineHeight: 24,
  } as TextStyle,

  // Numeric display ("$1,284.50")
  bigNumber: {
    fontFamily: FontSansBold,
    fontSize: 42,
    fontWeight: '700',
    letterSpacing: -1.05,
    lineHeight: 44,
  } as TextStyle,

  // Body
  body: {
    fontFamily: FontSans,
    fontSize: 14,
    lineHeight: 20,
  } as TextStyle,

  // Body strong
  bodyStrong: {
    fontFamily: FontSansSemiBold,
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 20,
  } as TextStyle,

  // Compact label inside lists / tiles (13px, semibold)
  label: {
    fontFamily: FontSansSemiBold,
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 18,
  } as TextStyle,

  // Tiny mono caption ("MAY 16", "WK 21 · 2026")
  caption: {
    fontFamily: FontMono,
    fontSize: 11,
    letterSpacing: 1.1, // 0.1em at 11px
    textTransform: 'uppercase',
  } as TextStyle,

  // Chip pill text (mono uppercase, very tight)
  chip: {
    fontFamily: FontMono,
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 1.0, // 0.1em at 10px
    textTransform: 'uppercase',
  } as TextStyle,
};

// ─────────────────────────────────────────────────────────────
// Spacing & radii — design uses 10/8/4/14/18 mostly
// ─────────────────────────────────────────────────────────────

export const VispRadius = {
  chip: 4,
  card: 10,
  pill: 999,
  cardLg: 14,
} as const;

export const VispSpace = {
  // Horizontal page gutter
  gutter: 20,
  // Card padding (typical)
  card: 18,
  // Card padding (compact)
  cardSm: 12,
  // Vertical rhythm between sections
  section: 14,
} as const;

// ─────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────

export function useVispTheme(): VispPalette {
  const darkMode = useAppStore((s) => s.darkMode);
  return darkMode ? vispDark : vispLight;
}
