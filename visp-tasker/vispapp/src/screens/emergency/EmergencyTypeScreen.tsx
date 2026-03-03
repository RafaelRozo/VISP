/**
 * VISP - EmergencyTypeScreen
 *
 * Grid of emergency types (plumbing, electrical, HVAC, gas, structural, etc.)
 * Red-themed UI with urgent feel. Large icons, clear labels.
 * Each type maps to L4 emergency tasks.
 *
 * Dark glassmorphism styling with red emergency accent.
 */

import React, { useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Platform,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { GlassBackground, GlassCard } from '../../components/glass';
import { GlassStyles, Colors } from '../../theme';
import { Spacing } from '../../theme/spacing';
import { Typography, FontWeight } from '../../theme/typography';
import { useEmergencyStore } from '../../stores/emergencyStore';
import { EMERGENCY_TYPES } from '../../services/emergencyService';
import type { EmergencyFlowParamList, EmergencyType, EmergencyTypeConfig } from '../../types';

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

type EmergencyTypeNavProp = NativeStackNavigationProp<EmergencyFlowParamList, 'EmergencyTypeSelect'>;

// ──────────────────────────────────────────────
// Icon mapping (using text representations for portability)
// ──────────────────────────────────────────────

const EMERGENCY_ICONS: Record<string, string> = {
  water: '\u{1F4A7}',
  flash: '\u{26A1}',
  thermometer: '\u{1F321}',
  flame: '\u{1F525}',
  home: '\u{1F3E0}',
  key: '\u{1F511}',
  grid: '\u{1FA9F}',
  umbrella: '\u{2602}',
};

function getEmergencyIcon(iconName: string): string {
  return EMERGENCY_ICONS[iconName] || '!';
}

// ──────────────────────────────────────────────
// Component
// ──────────────────────────────────────────────

function EmergencyTypeScreen(): React.JSX.Element {
  const navigation = useNavigation<EmergencyTypeNavProp>();
  const { setSelectedType } = useEmergencyStore();

  const handleSelectType = useCallback(
    (emergencyType: EmergencyType) => {
      setSelectedType(emergencyType);
      navigation.navigate('EmergencyLocation', { emergencyType });
    },
    [navigation, setSelectedType],
  );

  const renderEmergencyType = useCallback(
    (config: EmergencyTypeConfig) => (
      <TouchableOpacity
        key={config.type}
        style={styles.typeCard}
        onPress={() => handleSelectType(config.type)}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={`${config.label}: ${config.description}`}
        accessibilityHint="Double tap to select this emergency type"
      >
        <View style={styles.typeIconContainer}>
          <Text style={styles.typeIcon}>
            {getEmergencyIcon(config.icon)}
          </Text>
        </View>
        <Text style={styles.typeLabel} numberOfLines={2}>
          {config.label}
        </Text>
        <Text style={styles.typeDescription} numberOfLines={2}>
          {config.description}
        </Text>
      </TouchableOpacity>
    ),
    [handleSelectType],
  );

  return (
    <GlassBackground>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.emergencyBadge}>
          <Text style={styles.emergencyBadgeText}>EMERGENCY</Text>
        </View>
        <Text style={styles.title}>What type of emergency?</Text>
        <Text style={styles.subtitle}>
          Select the emergency type below. Level 4 providers will be
          dispatched immediately with SLA guarantees.
        </Text>
      </View>

      {/* Emergency warning */}
      <View style={styles.warningBanner}>
        <Text style={styles.warningText}>
          If you are in immediate danger, call 911 first.
        </Text>
      </View>

      {/* Emergency type grid */}
      <ScrollView
        style={styles.gridScrollView}
        contentContainerStyle={styles.gridContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.grid}>
          {EMERGENCY_TYPES.map(renderEmergencyType)}
        </View>
      </ScrollView>
    </GlassBackground>
  );
}

// ──────────────────────────────────────────────
// Styles
// ──────────────────────────────────────────────

const EMERGENCY_RED = 'rgba(231, 76, 60, 1)';
const EMERGENCY_RED_GLOW = 'rgba(231, 76, 60, 0.6)';
const EMERGENCY_RED_TINT = 'rgba(231, 76, 60, 0.15)';
const EMERGENCY_RED_BORDER = 'rgba(231, 76, 60, 0.30)';

const styles = StyleSheet.create({
  // Header
  header: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.md,
  },
  emergencyBadge: {
    backgroundColor: 'rgba(231, 76, 60, 0.8)',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: 8,
    alignSelf: 'flex-start',
    marginBottom: Spacing.md,
    ...Platform.select({
      ios: {
        shadowColor: EMERGENCY_RED_GLOW,
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 1,
        shadowRadius: 12,
      },
      android: { elevation: 6 },
    }),
  },
  emergencyBadgeText: {
    ...Typography.label,
    color: '#FFFFFF',
    fontWeight: FontWeight.heavy,
    letterSpacing: 1.5,
  },
  title: {
    ...Typography.title1,
    color: '#FFFFFF',
    marginBottom: Spacing.sm,
  },
  subtitle: {
    ...Typography.body,
    color: 'rgba(255, 255, 255, 0.6)',
    lineHeight: 22,
  },

  // Warning
  warningBanner: {
    backgroundColor: 'rgba(231, 76, 60, 0.10)',
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: EMERGENCY_RED_BORDER,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    marginBottom: Spacing.md,
  },
  warningText: {
    ...Typography.footnote,
    color: EMERGENCY_RED,
    fontWeight: FontWeight.semiBold,
    textAlign: 'center',
  },

  // Grid
  gridScrollView: {
    flex: 1,
  },
  gridContent: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.massive,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },

  // Type card - glass with red tint
  typeCard: {
    width: '47%',
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 16,
    padding: Spacing.lg,
    borderWidth: 1,
    borderColor: EMERGENCY_RED_BORDER,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.3,
        shadowRadius: 20,
      },
      android: { elevation: 6 },
    }),
  },
  typeIconContainer: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: EMERGENCY_RED_TINT,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.md,
  },
  typeIcon: {
    fontSize: 24,
  },
  typeLabel: {
    ...Typography.headline,
    color: '#FFFFFF',
    marginBottom: Spacing.xs,
  },
  typeDescription: {
    ...Typography.caption,
    color: 'rgba(255, 255, 255, 0.55)',
    lineHeight: 16,
  },
});

export default EmergencyTypeScreen;
