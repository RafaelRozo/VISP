/**
 * VISP/Tasker Design System - Border Radii and Borders
 */

export const BorderRadius = {
  /** 4px - Subtle rounding for small elements */
  xs: 4,
  /** 8px - Standard for input fields, small cards */
  sm: 8,
  /** 12px - Standard for cards and containers */
  md: 12,
  /** 16px - Large rounding for modals, sheets */
  lg: 16,
  /** 20px - Extra large for prominent elements */
  xl: 20,
  /** 24px - Pill-like rounding for buttons */
  xxl: 24,
  /** 9999px - Fully rounded (circles) */
  full: 9999,
} as const;

export const BorderWidth = {
  thin: 0.5,
  normal: 1,
  thick: 2,
} as const;

export type BorderRadiusKey = keyof typeof BorderRadius;
