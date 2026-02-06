/**
 * VISP/Tasker Design System - Typography
 *
 * Font families, sizes, weights, and pre-composed text styles.
 * Uses iOS system fonts (San Francisco) as the primary typeface.
 */

import { Platform, TextStyle } from 'react-native';

export const FontFamily = {
  regular: Platform.select({ ios: 'System', android: 'Roboto' }) ?? 'System',
  medium: Platform.select({ ios: 'System', android: 'Roboto' }) ?? 'System',
  semiBold: Platform.select({ ios: 'System', android: 'Roboto' }) ?? 'System',
  bold: Platform.select({ ios: 'System', android: 'Roboto' }) ?? 'System',
} as const;

export const FontSize = {
  caption: 11,
  footnote: 13,
  body: 15,
  callout: 16,
  subheadline: 17,
  headline: 17,
  title3: 20,
  title2: 22,
  title1: 28,
  largeTitle: 34,
} as const;

export const FontWeight: Record<string, TextStyle['fontWeight']> = {
  regular: '400',
  medium: '500',
  semiBold: '600',
  bold: '700',
  heavy: '800',
} as const;

export const LineHeight = {
  tight: 1.2,
  normal: 1.4,
  relaxed: 1.6,
} as const;

/**
 * Pre-composed text styles for consistent typography across the app.
 */
export const Typography: Record<string, TextStyle> = {
  largeTitle: {
    fontSize: FontSize.largeTitle,
    fontWeight: FontWeight.bold,
    lineHeight: FontSize.largeTitle * LineHeight.tight,
  },
  title1: {
    fontSize: FontSize.title1,
    fontWeight: FontWeight.bold,
    lineHeight: FontSize.title1 * LineHeight.tight,
  },
  title2: {
    fontSize: FontSize.title2,
    fontWeight: FontWeight.bold,
    lineHeight: FontSize.title2 * LineHeight.tight,
  },
  title3: {
    fontSize: FontSize.title3,
    fontWeight: FontWeight.semiBold,
    lineHeight: FontSize.title3 * LineHeight.normal,
  },
  headline: {
    fontSize: FontSize.headline,
    fontWeight: FontWeight.semiBold,
    lineHeight: FontSize.headline * LineHeight.normal,
  },
  subheadline: {
    fontSize: FontSize.subheadline,
    fontWeight: FontWeight.regular,
    lineHeight: FontSize.subheadline * LineHeight.normal,
  },
  body: {
    fontSize: FontSize.body,
    fontWeight: FontWeight.regular,
    lineHeight: FontSize.body * LineHeight.relaxed,
  },
  callout: {
    fontSize: FontSize.callout,
    fontWeight: FontWeight.regular,
    lineHeight: FontSize.callout * LineHeight.normal,
  },
  footnote: {
    fontSize: FontSize.footnote,
    fontWeight: FontWeight.regular,
    lineHeight: FontSize.footnote * LineHeight.normal,
  },
  caption: {
    fontSize: FontSize.caption,
    fontWeight: FontWeight.regular,
    lineHeight: FontSize.caption * LineHeight.normal,
  },
  buttonLarge: {
    fontSize: FontSize.callout,
    fontWeight: FontWeight.semiBold,
    lineHeight: FontSize.callout * LineHeight.normal,
  },
  buttonSmall: {
    fontSize: FontSize.footnote,
    fontWeight: FontWeight.semiBold,
    lineHeight: FontSize.footnote * LineHeight.normal,
  },
  label: {
    fontSize: FontSize.footnote,
    fontWeight: FontWeight.medium,
    lineHeight: FontSize.footnote * LineHeight.normal,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
};

export type TypographyKey = keyof typeof Typography;
