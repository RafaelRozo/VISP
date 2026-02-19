/**
 * VISP - SubcategoryScreen
 *
 * Drill into task details before booking.
 * Features:
 *   - Full description, requirements, estimated duration
 *   - Price range display
 *   - Photos of example work
 *   - "Book Now" CTA button
 *
 * CRITICAL: No free-text task input. Only predefined task selection.
 *
 * Styled with dark glassmorphism design system.
 */

import React, { useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  Dimensions,
  FlatList,
  Platform,
} from 'react-native';
import { AnimatedSpinner } from '../../components/animations';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Colors, getLevelColor } from '../../theme/colors';
import { Spacing } from '../../theme/spacing';
import { Typography, FontWeight, FontSize } from '../../theme/typography';
import { BorderRadius } from '../../theme/borders';
import { GlassStyles } from '../../theme/glass';
import { GlassBackground, GlassCard, GlassButton } from '../../components/glass';
import { useTaskStore } from '../../stores/taskStore';
import LevelBadge from '../../components/LevelBadge';
import type { CustomerFlowParamList } from '../../types';

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

type SubcategoryScreenRouteProp = RouteProp<CustomerFlowParamList, 'Subcategory'>;
type SubcategoryScreenNavProp = NativeStackNavigationProp<CustomerFlowParamList, 'Subcategory'>;

// ──────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────

const SCREEN_WIDTH = Dimensions.get('window').width;
const PHOTO_WIDTH = SCREEN_WIDTH - Spacing.lg * 2;
const PHOTO_HEIGHT = 200;

// ──────────────────────────────────────────────
// Component
// ──────────────────────────────────────────────

function SubcategoryScreen(): React.JSX.Element {
  const route = useRoute<SubcategoryScreenRouteProp>();
  const navigation = useNavigation<SubcategoryScreenNavProp>();
  const { taskId } = route.params;

  const { taskDetail, isLoadingDetail, error, fetchTaskDetail } = useTaskStore();

  // Load task detail on mount
  useEffect(() => {
    fetchTaskDetail(taskId);
  }, [taskId, fetchTaskDetail]);

  // Set header title when loaded
  useEffect(() => {
    if (taskDetail) {
      navigation.setOptions({ title: taskDetail.name });
    }
  }, [navigation, taskDetail]);

  // Navigate to booking
  const handleBookNow = useCallback(() => {
    if (taskDetail) {
      navigation.navigate('TaskSelection', { taskId: taskDetail.id });
    }
  }, [navigation, taskDetail]);

  // Retry on error
  const handleRetry = useCallback(() => {
    fetchTaskDetail(taskId);
  }, [taskId, fetchTaskDetail]);

  // Format duration
  const formatDuration = (minutes: number): string => {
    if (minutes < 60) {
      return `${minutes} minutes`;
    }
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    if (remainingMinutes === 0) {
      return `${hours} hour${hours > 1 ? 's' : ''}`;
    }
    return `${hours}h ${remainingMinutes}m`;
  };

  // Loading
  if (isLoadingDetail) {
    return (
      <GlassBackground>
        <View style={styles.loadingContainer}>
          <AnimatedSpinner size={48} color="rgba(120, 80, 255, 0.9)" />
          <Text style={styles.loadingText}>Loading task details...</Text>
        </View>
      </GlassBackground>
    );
  }

  // Error
  if (error) {
    return (
      <GlassBackground>
        <View style={styles.errorContainer}>
          <GlassCard variant="dark" padding={32} style={styles.errorCard}>
            <Text style={styles.errorTitle}>Unable to load task</Text>
            <Text style={styles.errorMessage}>{error}</Text>
            <GlassButton
              title="Try Again"
              variant="glow"
              onPress={handleRetry}
              style={styles.retryButtonCta}
            />
          </GlassCard>
        </View>
      </GlassBackground>
    );
  }

  // No data
  if (!taskDetail) {
    return (
      <GlassBackground>
        <View style={styles.errorContainer}>
          <GlassCard variant="dark" padding={32} style={styles.errorCard}>
            <Text style={styles.errorTitle}>Task not found</Text>
          </GlassCard>
        </View>
      </GlassBackground>
    );
  }

  const levelColor = getLevelColor(taskDetail.level);

  return (
    <GlassBackground>
      <View style={styles.container}>
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* Example photos carousel */}
          {taskDetail.examplePhotos.length > 0 && (
            <View style={styles.photoSection}>
              <FlatList
                data={taskDetail.examplePhotos}
                horizontal
                pagingEnabled
                showsHorizontalScrollIndicator={false}
                keyExtractor={(item, index) => `photo-${index}`}
                renderItem={({ item }) => (
                  <View style={styles.photoContainer}>
                    <Image
                      source={{ uri: item }}
                      style={styles.photo}
                      resizeMode="cover"
                      accessibilityLabel="Example of completed work"
                    />
                  </View>
                )}
                contentContainerStyle={styles.photoListContent}
              />
              {taskDetail.examplePhotos.length > 1 && (
                <View style={styles.photoIndicator}>
                  <Text style={styles.photoIndicatorText}>
                    {taskDetail.examplePhotos.length} photos
                  </Text>
                </View>
              )}
            </View>
          )}

          {/* Header with name and badge */}
          <View style={styles.headerSection}>
            <LevelBadge level={taskDetail.level} size="medium" />
            <Text style={styles.taskName}>{taskDetail.name}</Text>
          </View>

          {/* Price range */}
          <View style={styles.priceSection}>
            <GlassCard variant="elevated" padding={Spacing.lg}>
              <Text style={styles.priceLabel}>Estimated Price Range</Text>
              <Text style={styles.priceValue}>
                ${taskDetail.priceRangeMin} - ${taskDetail.priceRangeMax}
              </Text>
              <Text style={styles.priceNote}>
                Final price depends on scope of work and provider availability
              </Text>
            </GlassCard>
          </View>

          {/* Duration and Level info */}
          <View style={styles.infoRow}>
            <GlassCard variant="standard" padding={Spacing.lg} style={styles.infoItem}>
              <Text style={styles.infoLabel}>Estimated Duration</Text>
              <Text style={styles.infoValue}>
                {formatDuration(taskDetail.estimatedDurationMinutes)}
              </Text>
            </GlassCard>
            <GlassCard variant="standard" padding={Spacing.lg} style={styles.infoItem}>
              <Text style={styles.infoLabel}>Service Level</Text>
              <Text style={[styles.infoValue, { color: levelColor }]}>
                Level {taskDetail.level}
              </Text>
            </GlassCard>
          </View>

          {/* Full description */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Description</Text>
            <Text style={styles.descriptionText}>
              {taskDetail.fullDescription}
            </Text>
          </View>

          {/* Requirements */}
          {taskDetail.requirements.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Requirements</Text>
              {taskDetail.requirements.map((requirement, index) => (
                <View key={index} style={styles.requirementItem}>
                  <View style={styles.bulletPoint} />
                  <Text style={styles.requirementText}>{requirement}</Text>
                </View>
              ))}
            </View>
          )}

          {/* Important notice: closed catalog */}
          <View style={styles.noticeSection}>
            <GlassCard variant="dark" padding={Spacing.lg} style={styles.noticeCard}>
              <Text style={styles.noticeTitle}>Service Scope</Text>
              <Text style={styles.noticeText}>
                This is a predefined service task. The provider will perform
                exactly the work described above. Additional services require
                a separate booking. The provider cannot add scope to this job.
              </Text>
            </GlassCard>
          </View>

          {/* Bottom spacing for CTA button */}
          <View style={styles.bottomPadding} />
        </ScrollView>

        {/* Book Now CTA */}
        <View style={styles.ctaContainer}>
          <View style={styles.ctaPriceInfo}>
            <Text style={styles.ctaPriceLabel}>From</Text>
            <Text style={styles.ctaPriceValue}>
              ${taskDetail.priceRangeMin}
            </Text>
          </View>
          <GlassButton
            title="Book Now"
            variant="glow"
            onPress={handleBookNow}
            style={styles.bookButton}
          />
        </View>
      </View>
    </GlassBackground>
  );
}

// ──────────────────────────────────────────────
// Styles
// ──────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: Spacing.lg,
  },

  // Photos
  photoSection: {
    marginBottom: Spacing.lg,
  },
  photoListContent: {
    paddingHorizontal: Spacing.lg,
  },
  photoContainer: {
    width: PHOTO_WIDTH,
    height: PHOTO_HEIGHT,
    borderRadius: 16,
    overflow: 'hidden',
    marginRight: Spacing.sm,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
  },
  photo: {
    width: '100%',
    height: '100%',
  },
  photoIndicator: {
    position: 'absolute',
    bottom: Spacing.sm,
    right: Spacing.xxl,
    backgroundColor: 'rgba(10, 10, 30, 0.70)',
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xxs,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
  },
  photoIndicatorText: {
    ...Typography.caption,
    color: '#FFFFFF',
  },

  // Header
  headerSection: {
    paddingHorizontal: Spacing.lg,
    marginBottom: Spacing.lg,
  },
  taskName: {
    ...Typography.title1,
    color: '#FFFFFF',
    marginTop: Spacing.md,
  },

  // Price
  priceSection: {
    paddingHorizontal: Spacing.lg,
    marginBottom: Spacing.lg,
  },
  priceLabel: {
    ...Typography.label,
    color: 'rgba(255, 255, 255, 0.55)',
    marginBottom: Spacing.xs,
  },
  priceValue: {
    fontSize: FontSize.title1,
    fontWeight: FontWeight.bold,
    color: 'rgba(120, 80, 255, 0.9)',
    marginBottom: Spacing.xs,
  },
  priceNote: {
    ...Typography.caption,
    color: 'rgba(255, 255, 255, 0.4)',
  },

  // Info row
  infoRow: {
    flexDirection: 'row',
    paddingHorizontal: Spacing.lg,
    marginBottom: Spacing.lg,
    gap: Spacing.md,
  },
  infoItem: {
    flex: 1,
  },
  infoLabel: {
    ...Typography.caption,
    color: 'rgba(255, 255, 255, 0.55)',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: Spacing.xs,
  },
  infoValue: {
    ...Typography.headline,
    color: '#FFFFFF',
  },

  // Sections
  section: {
    paddingHorizontal: Spacing.lg,
    marginBottom: Spacing.lg,
  },
  sectionTitle: {
    ...Typography.headline,
    color: '#FFFFFF',
    marginBottom: Spacing.md,
  },
  descriptionText: {
    ...Typography.body,
    color: 'rgba(255, 255, 255, 0.6)',
    lineHeight: 24,
  },

  // Requirements
  requirementItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: Spacing.sm,
  },
  bulletPoint: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(120, 80, 255, 0.8)',
    marginTop: 8,
    marginRight: Spacing.md,
  },
  requirementText: {
    ...Typography.body,
    color: 'rgba(255, 255, 255, 0.6)',
    flex: 1,
  },

  // Notice
  noticeSection: {
    paddingHorizontal: Spacing.lg,
    marginBottom: Spacing.lg,
  },
  noticeCard: {
    borderColor: 'rgba(243, 156, 18, 0.25)',
  },
  noticeTitle: {
    ...Typography.headline,
    color: Colors.warning,
    marginBottom: Spacing.sm,
  },
  noticeText: {
    ...Typography.footnote,
    color: 'rgba(255, 255, 255, 0.55)',
    lineHeight: 20,
  },

  // Bottom padding
  bottomPadding: {
    height: 100,
  },

  // CTA
  ctaContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    backgroundColor: 'rgba(10, 10, 30, 0.80)',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.08)',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -8 },
        shadowOpacity: 0.4,
        shadowRadius: 20,
      },
      android: { elevation: 12 },
    }),
  },
  ctaPriceInfo: {
    flexDirection: 'column',
  },
  ctaPriceLabel: {
    ...Typography.caption,
    color: 'rgba(255, 255, 255, 0.5)',
  },
  ctaPriceValue: {
    fontSize: FontSize.title2,
    fontWeight: FontWeight.bold,
    color: '#FFFFFF',
  },
  bookButton: {
    paddingHorizontal: Spacing.xxxl,
  },

  // Loading
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    ...Typography.footnote,
    color: 'rgba(255, 255, 255, 0.5)',
    marginTop: Spacing.md,
  },

  // Error
  errorContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.xxl,
  },
  errorCard: {
    alignItems: 'center',
    width: '100%',
  },
  errorTitle: {
    ...Typography.title3,
    color: '#FFFFFF',
    marginBottom: Spacing.sm,
  },
  errorMessage: {
    ...Typography.body,
    color: 'rgba(255, 255, 255, 0.6)',
    textAlign: 'center',
    marginBottom: Spacing.xl,
  },
  retryButtonCta: {
    width: '100%',
  },
});

export default SubcategoryScreen;
