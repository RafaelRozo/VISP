/**
 * VISP/Tasker Design System - Color Palette
 *
 * All color values used across the application are defined here.
 * Never use inline hex values in components; always reference these constants.
 */

export const Colors = {
  // ── Brand ──────────────────────────────────
  primary: '#4A90E2',
  primaryDark: '#2E6AB3',
  primaryLight: '#6BA8F0',

  // ── Service Levels ─────────────────────────
  level1: '#27AE60', // Helper - Green
  level2: '#F39C12', // Experienced - Yellow
  level3: '#9B59B6', // Certified Pro - Purple
  level4: '#E74C3C', // Emergency - Red

  // ── Semantic ───────────────────────────────
  emergencyRed: '#E74C3C',
  emergencyRedDark: '#C0392B',
  success: '#27AE60',
  successDark: '#1E8449',
  warning: '#F39C12',
  warningDark: '#D68910',
  info: '#3498DB',
  infoDark: '#2980B9',
  error: '#E74C3C',
  errorDark: '#C0392B',

  // ── Backgrounds ────────────────────────────
  background: '#1A1A2E',
  surface: '#16213E',
  surfaceLight: '#1E2D4D',
  surfaceElevated: '#243351',
  card: '#16213E',
  cardElevated: '#1E2D4D',
  overlay: 'rgba(0, 0, 0, 0.6)',

  // ── Text ───────────────────────────────────
  textPrimary: '#FFFFFF',
  textSecondary: '#A0A0A0',
  textTertiary: '#6B6B80',
  textDisabled: '#4A4A5A',
  textInverse: '#1A1A2E',
  textLink: '#4A90E2',

  // ── Borders & Dividers ─────────────────────
  border: '#2A2A40',
  borderLight: '#3A3A55',
  divider: '#2A2A40',

  // ── Input Fields ───────────────────────────
  inputBackground: '#1E2D4D',
  inputBorder: '#3A3A55',
  inputBorderFocused: '#4A90E2',
  inputPlaceholder: '#6B6B80',
  inputText: '#FFFFFF',

  // ── Status Badges ──────────────────────────
  statusPending: '#F39C12',
  statusMatched: '#3498DB',
  statusAccepted: '#2ECC71',
  statusEnRoute: '#9B59B6',
  statusInProgress: '#4A90E2',
  statusCompleted: '#27AE60',
  statusCancelled: '#95A5A6',
  statusDisputed: '#E74C3C',

  // ── Misc ───────────────────────────────────
  skeleton: '#2A2A40',
  skeletonHighlight: '#3A3A55',
  shadow: '#000000',
  transparent: 'transparent',
  white: '#FFFFFF',
  black: '#000000',
} as const;

/**
 * Returns the color associated with a service level.
 */
export function getLevelColor(level: 1 | 2 | 3 | 4): string {
  const map: Record<number, string> = {
    1: Colors.level1,
    2: Colors.level2,
    3: Colors.level3,
    4: Colors.level4,
  };
  return map[level] ?? Colors.primary;
}

/**
 * Returns the color associated with a job status.
 */
export function getStatusColor(status: string): string {
  const map: Record<string, string> = {
    pending: Colors.statusPending,
    matched: Colors.statusMatched,
    accepted: Colors.statusAccepted,
    en_route: Colors.statusEnRoute,
    in_progress: Colors.statusInProgress,
    completed: Colors.statusCompleted,
    cancelled: Colors.statusCancelled,
    disputed: Colors.statusDisputed,
  };
  return map[status] ?? Colors.textSecondary;
}

export type ColorKey = keyof typeof Colors;
