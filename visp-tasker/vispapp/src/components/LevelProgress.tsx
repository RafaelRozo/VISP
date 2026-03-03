/**
 * VISP - LevelProgress Component
 *
 * Visual progress indicator for provider level advancement showing
 * current level badge, requirements checklist, progress bar, and
 * expandable "What you need" section.
 */

import React, { useCallback, useState } from 'react';
import {
  LayoutAnimation,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  UIManager,
  View,
} from 'react-native';
import { Colors, getLevelColor } from '../theme/colors';
import { GlassStyles } from '../theme/glass';
import { LevelProgressInfo, ServiceLevel } from '../types';

// Enable LayoutAnimation on Android
if (
  Platform.OS === 'android' &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface LevelProgressProps {
  progressInfo: LevelProgressInfo;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const LEVEL_NAMES: Record<number, string> = {
  1: 'Helper',
  2: 'Experienced',
  3: 'Certified Pro',
  4: 'Emergency',
};

function getLevelDescription(level: ServiceLevel): string {
  const descriptions: Record<number, string> = {
    1: 'Basic tasks, $25-45/hr',
    2: 'Technical tasks, $60-90/hr',
    3: 'Licensed work, $90-150/hr',
    4: '24/7 emergency, $150+/hr',
  };
  return descriptions[level] ?? '';
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

function LevelProgress({
  progressInfo,
}: LevelProgressProps): React.JSX.Element {
  const [isExpanded, setIsExpanded] = useState(false);
  const currentColor = getLevelColor(progressInfo.currentLevel);
  const nextColor = progressInfo.nextLevel
    ? getLevelColor(progressInfo.nextLevel)
    : currentColor;

  const metCount = progressInfo.requirements.filter((r) => r.isMet).length;
  const totalCount = progressInfo.requirements.length;

  const toggleExpanded = useCallback(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setIsExpanded((prev) => !prev);
  }, []);

  return (
    <View style={styles.container}>
      {/* Current level badge */}
      <View style={styles.levelRow}>
        <View style={[styles.levelBadge, { backgroundColor: currentColor }]}>
          <Text style={styles.levelNumber}>
            L{progressInfo.currentLevel}
          </Text>
        </View>
        <View style={styles.levelInfo}>
          <Text style={styles.levelName}>
            {LEVEL_NAMES[progressInfo.currentLevel]}
          </Text>
          <Text style={styles.levelDescription}>
            {getLevelDescription(progressInfo.currentLevel)}
          </Text>
        </View>
      </View>

      {/* Progress bar */}
      {progressInfo.nextLevel && (
        <View style={styles.progressSection}>
          <View style={styles.progressHeader}>
            <Text style={styles.progressTitle}>
              Progress to Level {progressInfo.nextLevel}
            </Text>
            <Text style={[styles.progressPercent, { color: nextColor }]}>
              {progressInfo.progressPercent}%
            </Text>
          </View>

          <View style={styles.progressBarContainer}>
            <View style={styles.progressBarBackground}>
              <View
                style={[
                  styles.progressBarFill,
                  {
                    width: `${Math.min(progressInfo.progressPercent, 100)}%`,
                    backgroundColor: nextColor,
                  },
                ]}
              />
            </View>
          </View>

          <Text style={styles.progressSubtext}>
            {metCount} of {totalCount} requirements met
          </Text>
        </View>
      )}

      {/* Max level message */}
      {!progressInfo.nextLevel && (
        <View style={styles.maxLevelBanner}>
          <Text style={styles.maxLevelText}>
            Maximum level achieved
          </Text>
        </View>
      )}

      {/* Expandable requirements section */}
      {progressInfo.nextLevel && progressInfo.requirements.length > 0 && (
        <View style={styles.requirementsSection}>
          <TouchableOpacity
            style={styles.expandButton}
            onPress={toggleExpanded}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={
              isExpanded
                ? 'Collapse requirements'
                : 'Show requirements for next level'
            }
          >
            <Text style={styles.expandButtonText}>
              {isExpanded ? 'Hide Requirements' : 'What You Need'}
            </Text>
            <Text style={styles.expandArrow}>
              {isExpanded ? '\u25B2' : '\u25BC'}
            </Text>
          </TouchableOpacity>

          {isExpanded && (
            <View style={styles.requirementsList}>
              {progressInfo.requirements.map((req, index) => (
                <View key={index} style={styles.requirementItem}>
                  <View
                    style={[
                      styles.checkCircle,
                      req.isMet
                        ? styles.checkCircleMet
                        : styles.checkCircleUnmet,
                    ]}
                  >
                    <Text
                      style={[
                        styles.checkMark,
                        req.isMet
                          ? styles.checkMarkMet
                          : styles.checkMarkUnmet,
                      ]}
                    >
                      {req.isMet ? '\u2713' : '\u2022'}
                    </Text>
                  </View>
                  <View style={styles.requirementText}>
                    <Text
                      style={[
                        styles.requirementLabel,
                        req.isMet && styles.requirementLabelMet,
                      ]}
                    >
                      {req.label}
                    </Text>
                    <Text style={styles.requirementDescription}>
                      {req.description}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          )}
        </View>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    ...GlassStyles.card,
    padding: 16,
    marginHorizontal: 16,
    marginVertical: 6,
  },
  levelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  levelBadge: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  levelNumber: {
    fontSize: 18,
    fontWeight: '800',
    color: Colors.white,
  },
  levelInfo: {
    flex: 1,
  },
  levelName: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  levelDescription: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  progressSection: {
    marginBottom: 12,
  },
  progressHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  progressTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  progressPercent: {
    fontSize: 14,
    fontWeight: '700',
  },
  progressBarContainer: {
    marginBottom: 6,
  },
  progressBarBackground: {
    height: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.10)',
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: 8,
    borderRadius: 4,
  },
  progressSubtext: {
    fontSize: 12,
    color: Colors.textTertiary,
  },
  maxLevelBanner: {
    backgroundColor: 'rgba(39, 174, 96, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(39, 174, 96, 0.25)',
    borderRadius: 8,
    padding: 12,
    alignItems: 'center',
  },
  maxLevelText: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.success,
  },
  requirementsSection: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255, 255, 255, 0.12)',
    paddingTop: 12,
  },
  expandButton: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
  },
  expandButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.primary,
  },
  expandArrow: {
    fontSize: 12,
    color: Colors.primary,
  },
  requirementsList: {
    marginTop: 12,
  },
  requirementItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  checkCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
    marginTop: 2,
  },
  checkCircleMet: {
    backgroundColor: Colors.success,
  },
  checkCircleUnmet: {
    backgroundColor: 'rgba(255, 255, 255, 0.10)',
  },
  checkMark: {
    fontSize: 14,
    fontWeight: '700',
  },
  checkMarkMet: {
    color: Colors.white,
  },
  checkMarkUnmet: {
    color: Colors.textTertiary,
  },
  requirementText: {
    flex: 1,
  },
  requirementLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: Colors.textPrimary,
    marginBottom: 2,
  },
  requirementLabelMet: {
    color: Colors.textSecondary,
  },
  requirementDescription: {
    fontSize: 12,
    color: Colors.textTertiary,
    lineHeight: 16,
  },
});

export default React.memo(LevelProgress);
