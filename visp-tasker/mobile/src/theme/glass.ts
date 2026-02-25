/**
 * VISP Design System - Glassmorphism Styles
 *
 * StyleSheet-based glass tokens for frosted-glass surfaces, buttons,
 * inputs, and overlays. Pair with <GlassBackground> for the full effect.
 */

import { StyleSheet, Platform } from 'react-native';

export const GlassStyles = StyleSheet.create({
  // ── Standard glass card ──────────────────────
  card: {
    backgroundColor: 'rgba(255, 255, 255, 0.10)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.20)',
    borderRadius: 20,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.3,
        shadowRadius: 32,
      },
      android: { elevation: 8 },
    }),
  },

  // ── Dark frosted panel ───────────────────────
  darkPanel: {
    backgroundColor: 'rgba(10, 10, 30, 0.55)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    borderRadius: 16,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 20 },
        shadowOpacity: 0.5,
        shadowRadius: 60,
      },
      android: { elevation: 12 },
    }),
  },

  // ── Elevated glass card ──────────────────────
  elevated: {
    backgroundColor: 'rgba(255, 255, 255, 0.18)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.25)',
    borderRadius: 20,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 12 },
        shadowOpacity: 0.4,
        shadowRadius: 40,
      },
      android: { elevation: 10 },
    }),
  },

  // ── Glass button ─────────────────────────────
  button: {
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.25)',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 28,
  },

  // ── Glow CTA button (primary action) ────────
  glowButton: {
    backgroundColor: 'rgba(120, 80, 255, 0.8)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.30)',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 32,
    ...Platform.select({
      ios: {
        shadowColor: 'rgba(120, 80, 255, 0.6)',
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 1,
        shadowRadius: 20,
      },
      android: { elevation: 8 },
    }),
  },

  // ── Outline button ───────────────────────────
  outlineButton: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.25)',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 28,
  },

  // ── Glass input ──────────────────────────────
  input: {
    backgroundColor: 'rgba(255, 255, 255, 0.07)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    color: '#FFFFFF',
    fontSize: 16,
  },

  inputFocused: {
    borderColor: 'rgba(120, 80, 255, 0.6)',
  },

  inputError: {
    borderColor: 'rgba(231, 76, 60, 0.8)',
  },

  // ── Glass navbar ─────────────────────────────
  navbar: {
    backgroundColor: 'rgba(255, 255, 255, 0.07)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.12)',
  },

  // ── Glass modal ──────────────────────────────
  modal: {
    backgroundColor: 'rgba(15, 15, 40, 0.65)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    borderRadius: 24,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 25 },
        shadowOpacity: 0.6,
        shadowRadius: 80,
      },
      android: { elevation: 16 },
    }),
  },

  // ── Tab bar ──────────────────────────────────
  tabBar: {
    backgroundColor: 'rgba(10, 10, 30, 0.80)',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.08)',
  },

  // ── Section header ───────────────────────────
  sectionHeader: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },

  // ── Badge ────────────────────────────────────
  badge: {
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.18)',
    borderRadius: 999,
    paddingVertical: 4,
    paddingHorizontal: 10,
  },

  // ── Inset top highlight ──────────────────────
  topHighlight: {
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.15)',
  },
});

/** Background gradient orb configuration */
export const GlassOrbs = {
  purple: {
    color: 'rgba(120, 40, 200, 0.5)',
    size: 600,
    position: { top: -200, left: -100 },
  },
  blue: {
    color: 'rgba(20, 120, 255, 0.4)',
    size: 500,
    position: { bottom: -150, right: -50 },
  },
} as const;
