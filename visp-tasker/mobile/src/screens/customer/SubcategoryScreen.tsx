/**
 * VISP/Tasker - SubcategoryScreen
 *
 * Drill into task details before booking.
 * Features:
 *   - Full description, requirements, estimated duration
 *   - Price range display
 *   - Photos of example work
 *   - "Book Now" CTA button
 *
 * CRITICAL: No free-text task input. Only predefined task selection.
 */

import React, { useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  SafeAreaView,
  Dimensions,
  FlatList,
} from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Colors, getLevelColor } from '../../theme/colors';
import { Spacing } from '../../theme/spacing';
import { Typography, FontWeight, FontSize } from '../../theme/typography';
import { BorderRadius } from '../../theme/borders';
import { Shadows } from '../../theme/shadows';
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
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={Colors.primary} />
          <Text style={styles.loadingText}>Loading task details...</Text>
        </View>
      </SafeAreaView>
    );
  }

  // Error
  if (error) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.errorContainer}>
          <Text style={styles.errorTitle}>Unable to load task</Text>
          <Text style={styles.errorMessage}>{error}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={handleRetry}>
            <Text style={styles.retryButtonText}>Try Again</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // No data
  if (!taskDetail) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.errorContainer}>
          <Text style={styles.errorTitle}>Task not found</Text>
        </View>
      </SafeAreaView>
    );
  }

  const levelColor = getLevelColor(taskDetail.level);

  return (
    <SafeAreaView style={styles.safeArea}>
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
            <View style={styles.priceCard}>
              <Text style={styles.priceLabel}>Estimated Price Range</Text>
              <Text style={styles.priceValue}>
                ${taskDetail.priceRangeMin} - ${taskDetail.priceRangeMax}
              </Text>
              <Text style={styles.priceNote}>
                Final price depends on scope of work and provider availability
              </Text>
            </View>
          </View>

          {/* Duration */}
          <View style={styles.infoRow}>
            <View style={styles.infoItem}>
              <Text style={styles.infoLabel}>Estimated Duration</Text>
              <Text style={styles.infoValue}>
                {formatDuration(taskDetail.estimatedDurationMinutes)}
              </Text>
            </View>
            <View style={styles.infoItem}>
              <Text style={styles.infoLabel}>Service Level</Text>
              <Text style={[styles.infoValue, { color: levelColor }]}>
                Level {taskDetail.level}
              </Text>
            </View>
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
            <View style={styles.noticeCard}>
              <Text style={styles.noticeTitle}>Service Scope</Text>
              <Text style={styles.noticeText}>
                This is a predefined service task. The provider will perform
                exactly the work described above. Additional services require
                a separate booking. The provider cannot add scope to this job.
              </Text>
            </View>
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
          <TouchableOpacity
            style={styles.bookButton}
            onPress={handleBookNow}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Book this service now"
          >
            <Text style={styles.bookButtonText}>Book Now</Text>
          </TouchableOpacity>
        </View>
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
    borderRadius: BorderRadius.md,
    overflow: 'hidden',
    marginRight: Spacing.sm,
  },
  photo: {
    width: '100%',
    height: '100%',
  },
  photoIndicator: {
    position: 'absolute',
    bottom: Spacing.sm,
    right: Spacing.xxl,
    backgroundColor: Colors.overlay,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xxs,
    borderRadius: BorderRadius.xs,
  },
  photoIndicatorText: {
    ...Typography.caption,
    color: Colors.white,
  },

  // Header
  headerSection: {
    paddingHorizontal: Spacing.lg,
    marginBottom: Spacing.lg,
  },
  taskName: {
    ...Typography.title1,
    color: Colors.textPrimary,
    marginTop: Spacing.md,
  },

  // Price
  priceSection: {
    paddingHorizontal: Spacing.lg,
    marginBottom: Spacing.lg,
  },
  priceCard: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    padding: Spacing.lg,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  priceLabel: {
    ...Typography.label,
    color: Colors.textSecondary,
    marginBottom: Spacing.xs,
  },
  priceValue: {
    fontSize: FontSize.title1,
    fontWeight: FontWeight.bold,
    color: Colors.primary,
    marginBottom: Spacing.xs,
  },
  priceNote: {
    ...Typography.caption,
    color: Colors.textTertiary,
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
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    padding: Spacing.lg,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  infoLabel: {
    ...Typography.caption,
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: Spacing.xs,
  },
  infoValue: {
    ...Typography.headline,
    color: Colors.textPrimary,
  },

  // Sections
  section: {
    paddingHorizontal: Spacing.lg,
    marginBottom: Spacing.lg,
  },
  sectionTitle: {
    ...Typography.headline,
    color: Colors.textPrimary,
    marginBottom: Spacing.md,
  },
  descriptionText: {
    ...Typography.body,
    color: Colors.textSecondary,
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
    backgroundColor: Colors.primary,
    marginTop: 8,
    marginRight: Spacing.md,
  },
  requirementText: {
    ...Typography.body,
    color: Colors.textSecondary,
    flex: 1,
  },

  // Notice
  noticeSection: {
    paddingHorizontal: Spacing.lg,
    marginBottom: Spacing.lg,
  },
  noticeCard: {
    backgroundColor: `${Colors.warning}10`,
    borderRadius: BorderRadius.md,
    padding: Spacing.lg,
    borderWidth: 1,
    borderColor: `${Colors.warning}30`,
  },
  noticeTitle: {
    ...Typography.headline,
    color: Colors.warning,
    marginBottom: Spacing.sm,
  },
  noticeText: {
    ...Typography.footnote,
    color: Colors.textSecondary,
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
    backgroundColor: Colors.surface,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    ...Shadows.lg,
  },
  ctaPriceInfo: {
    flexDirection: 'column',
  },
  ctaPriceLabel: {
    ...Typography.caption,
    color: Colors.textSecondary,
  },
  ctaPriceValue: {
    fontSize: FontSize.title2,
    fontWeight: FontWeight.bold,
    color: Colors.textPrimary,
  },
  bookButton: {
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.xxxl,
    paddingVertical: Spacing.md,
    ...Shadows.sm,
  },
  bookButtonText: {
    ...Typography.buttonLarge,
    color: Colors.white,
  },

  // Loading
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    ...Typography.footnote,
    color: Colors.textSecondary,
    marginTop: Spacing.md,
  },

  // Error
  errorContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.xxl,
  },
  errorTitle: {
    ...Typography.title3,
    color: Colors.textPrimary,
    marginBottom: Spacing.sm,
  },
  errorMessage: {
    ...Typography.body,
    color: Colors.textSecondary,
    textAlign: 'center',
    marginBottom: Spacing.xl,
  },
  retryButton: {
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.xxl,
    paddingVertical: Spacing.md,
  },
  retryButtonText: {
    ...Typography.buttonLarge,
    color: Colors.white,
  },
});

export default SubcategoryScreen;
