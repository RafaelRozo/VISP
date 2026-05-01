/**
 * VISP - Theme Context
 *
 * Provides dark/light theme colors to all components.
 * Reads darkMode from appStore and provides the corresponding color palette.
 */

import React, { createContext, useContext, useMemo } from 'react';
import { useAppStore } from '../stores/appStore';

export interface ThemeColors {
  background: string;
  surface: string;
  surfaceLight: string;
  card: string;
  textPrimary: string;
  textSecondary: string;
  textTertiary: string;
  border: string;
  divider: string;
  inputBackground: string;
  inputBorder: string;
  inputText: string;
  inputPlaceholder: string;
  headerBackground: string;
  headerBorder: string;
  tabBarBackground: string;
  glassWhite: string;
  glassDark: string;
  glassBorderLight: string;
  glassBorderSubtle: string;
  orbPurple: string;
  orbBlue: string;
  isDark: boolean;
}

const darkTheme: ThemeColors = {
  background: '#0a0a1a',
  surface: '#16213E',
  surfaceLight: '#1E2D4D',
  card: '#16213E',
  textPrimary: '#FFFFFF',
  textSecondary: '#A0A0A0',
  textTertiary: '#6B6B80',
  border: '#2A2A40',
  divider: 'rgba(255, 255, 255, 0.08)',
  inputBackground: 'rgba(255, 255, 255, 0.08)',
  inputBorder: 'rgba(255, 255, 255, 0.15)',
  inputText: '#FFFFFF',
  inputPlaceholder: 'rgba(255, 255, 255, 0.35)',
  headerBackground: 'rgba(10, 10, 30, 0.80)',
  headerBorder: 'rgba(255, 255, 255, 0.08)',
  tabBarBackground: 'rgba(10, 10, 30, 0.90)',
  glassWhite: 'rgba(255, 255, 255, 0.10)',
  glassDark: 'rgba(10, 10, 30, 0.55)',
  glassBorderLight: 'rgba(255, 255, 255, 0.20)',
  glassBorderSubtle: 'rgba(255, 255, 255, 0.12)',
  orbPurple: 'rgba(120, 40, 200, 0.5)',
  orbBlue: 'rgba(20, 120, 255, 0.4)',
  isDark: true,
};

const lightTheme: ThemeColors = {
  background: '#F2F4F8',
  surface: '#FFFFFF',
  surfaceLight: '#F8F9FC',
  card: '#FFFFFF',
  textPrimary: '#1A1A2E',
  textSecondary: '#5A5A6E',
  textTertiary: '#8A8A9E',
  border: '#E0E0E8',
  divider: 'rgba(0, 0, 0, 0.08)',
  inputBackground: 'rgba(0, 0, 0, 0.04)',
  inputBorder: 'rgba(0, 0, 0, 0.12)',
  inputText: '#1A1A2E',
  inputPlaceholder: 'rgba(0, 0, 0, 0.35)',
  headerBackground: 'rgba(255, 255, 255, 0.95)',
  headerBorder: 'rgba(0, 0, 0, 0.08)',
  tabBarBackground: 'rgba(255, 255, 255, 0.95)',
  glassWhite: 'rgba(0, 0, 0, 0.04)',
  glassDark: 'rgba(255, 255, 255, 0.85)',
  glassBorderLight: 'rgba(0, 0, 0, 0.10)',
  glassBorderSubtle: 'rgba(0, 0, 0, 0.06)',
  orbPurple: 'rgba(120, 40, 200, 0.15)',
  orbBlue: 'rgba(20, 120, 255, 0.10)',
  isDark: false,
};

const ThemeContext = createContext<ThemeColors>(darkTheme);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const darkMode = useAppStore((s) => s.darkMode);
  const theme = useMemo(() => (darkMode ? darkTheme : lightTheme), [darkMode]);

  return (
    <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>
  );
}

export function useTheme(): ThemeColors {
  return useContext(ThemeContext);
}

export { darkTheme, lightTheme };
