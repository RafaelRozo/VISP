/**
 * VISP/Tasker - EmergencyTypeScreen
 *
 * Grid of emergency types (plumbing, electrical, HVAC, gas, structural, etc.)
 * Red-themed UI with urgent feel. Large icons, clear labels.
 * Each type maps to L4 emergency tasks.
 */

import React, { useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  SafeAreaView,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Colors } from '../../theme/colors';
import { Spacing } from '../../theme/spacing';
import { Typography, FontWeight, FontSize } from '../../theme/typography';
import { BorderRadius } from '../../theme/borders';
import { Shadows } from '../../theme/shadows';
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
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
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
      </View>
    </SafeAreaView>
  );
}

// ──────────────────────────────────────────────
// Styles
// ──────────────────────────────────────────────

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },

  // Header
  header: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.md,
  },
  emergencyBadge: {
    backgroundColor: Colors.emergencyRed,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.xs,
    alignSelf: 'flex-start',
    marginBottom: Spacing.md,
  },
  emergencyBadgeText: {
    ...Typography.label,
    color: Colors.white,
    fontWeight: FontWeight.heavy,
    letterSpacing: 1.5,
  },
  title: {
    ...Typography.title1,
    color: Colors.textPrimary,
    marginBottom: Spacing.sm,
  },
  subtitle: {
    ...Typography.body,
    color: Colors.textSecondary,
    lineHeight: 22,
  },

  // Warning
  warningBanner: {
    backgroundColor: `${Colors.emergencyRed}15`,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: `${Colors.emergencyRed}30`,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    marginBottom: Spacing.md,
  },
  warningText: {
    ...Typography.footnote,
    color: Colors.emergencyRed,
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

  // Type card
  typeCard: {
    width: '47%',
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    padding: Spacing.lg,
    borderWidth: 1,
    borderColor: `${Colors.emergencyRed}20`,
    ...Shadows.sm,
  },
  typeIconContainer: {
    width: 48,
    height: 48,
    borderRadius: BorderRadius.md,
    backgroundColor: `${Colors.emergencyRed}15`,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.md,
  },
  typeIcon: {
    fontSize: 24,
  },
  typeLabel: {
    ...Typography.headline,
    color: Colors.textPrimary,
    marginBottom: Spacing.xs,
  },
  typeDescription: {
    ...Typography.caption,
    color: Colors.textSecondary,
    lineHeight: 16,
  },
});

export default EmergencyTypeScreen;
