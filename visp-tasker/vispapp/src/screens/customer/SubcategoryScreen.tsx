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
import { useTheme } from '../../theme/ThemeContext';
import { Spacing } from '../../theme/spacing';
import { Typography, FontWeight, FontSize } from '../../theme/typography';
import { BorderRadius } from '../../theme/borders';
import { GlassStyles } from '../../theme/glass';
import { GlassCard, GlassButton } from '../../components/glass';
import { Screen } from '../../components/visp';
import { useTaskStore } from '../../stores/taskStore';
import LevelBadge from '../../components/LevelBadge';
import type { CustomerFlowParamList } from '../../types';
import { unitSuffix } from '../../services/offerService';

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
  const theme = useTheme();
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
  // Loading
  if (isLoadingDetail) {
    return (
      <Screen>
        <View style={styles.loadingContainer}>
          <AnimatedSpinner size={48} color="rgba(120, 80, 255, 0.9)" />
          <Text style={[styles.loadingText, { color: theme.textSecondary }]}>Loading task details...</Text>
        </View>
      </Screen>
    );
  }

  // Error
  if (error) {
    return (
      <Screen>
        <View style={styles.errorContainer}>
          <GlassCard variant="dark" padding={32} style={styles.errorCard}>
            <Text style={[styles.errorTitle, { color: theme.textPrimary }]}>Unable to load task</Text>
            <Text style={[styles.errorMessage, { color: theme.textSecondary }]}>{error}</Text>
            <GlassButton
              title="Try Again"
              variant="glow"
              onPress={handleRetry}
              style={styles.retryButtonCta}
            />
          </GlassCard>
        </View>
      </Screen>
    );
  }

  // No data
  if (!taskDetail) {
    return (
      <Screen>
        <View style={styles.errorContainer}>
          <GlassCard variant="dark" padding={32} style={styles.errorCard}>
            <Text style={[styles.errorTitle, { color: theme.textPrimary }]}>Task not found</Text>
          </GlassCard>
        </View>
      </Screen>
    );
  }

  const levelColor = getLevelColor(taskDetail.level);

  return (
    <Screen>
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
                // flexGrow:0 obligatorio: sin altura ni flexGrow un scroll
                // horizontal se expande y roba el espacio vertical del padre.
                style={{ flexGrow: 0 }}
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
            <Text style={[styles.taskName, { color: theme.textPrimary }]}>{taskDetail.name}</Text>
          </View>

          {/* Price range */}
          <View style={styles.priceSection}>
            <GlassCard variant="elevated" padding={Spacing.lg}>
              <Text style={[styles.priceLabel, { color: theme.textSecondary }]}>Price range</Text>
              {/* La unidad va PEGADA a la cifra: "50 a 90" no dice si es por hora,
                  por mueble o por el trabajo entero, y es justo lo que decide si
                  el precio parece caro o barato. */}
              <Text style={styles.priceValue}>
                ${taskDetail.priceRangeMin} - ${taskDetail.priceRangeMax}
                <Text style={styles.priceUnit}>{unitSuffix(taskDetail.pricingUnit)}</Text>
              </Text>
              <Text style={[styles.priceNote, { color: theme.textTertiary }]}>
                Providers who work in your area set their own price within this
                range. You will see each offer with its price and time before you
                choose — nothing is charged until you accept one.
              </Text>
            </GlassCard>
          </View>

          {/* La DURACIÓN ESTIMADA y el NIVEL salieron de aquí (2026-08-21).

              La duración era una media del catálogo que no describe este trabajo,
              y bajo el modelo de ofertas quien dice cuánto tarda es el proveedor
              en su oferta: enseñar un número nuestro al lado del suyo solo genera
              discusiones. El nivel ya está arriba, en la insignia junto al título,
              así que la tarjeta lo repetía. */}

          {/* Full description */}
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: theme.textPrimary }]}>Description</Text>
            <Text style={[styles.descriptionText, { color: theme.textSecondary }]}>
              {taskDetail.fullDescription}
            </Text>
          </View>

          {/* Requirements */}
          {taskDetail.requirements.length > 0 && (
            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { color: theme.textPrimary }]}>Requirements</Text>
              {taskDetail.requirements.map((requirement, index) => (
                <View key={index} style={styles.requirementItem}>
                  <View style={styles.bulletPoint} />
                  <Text style={[styles.requirementText, { color: theme.textSecondary }]}>{requirement}</Text>
                </View>
              ))}
            </View>
          )}

          {/* Important notice: closed catalog */}
          <View style={styles.noticeSection}>
            <GlassCard variant="dark" padding={Spacing.lg} style={styles.noticeCard}>
              <Text style={styles.noticeTitle}>Service Scope</Text>
              <Text style={[styles.noticeText, { color: theme.textSecondary }]}>
                The work is exactly what is described above — it does not change
                from one provider to another. What each provider decides is their
                own price within the range and how long they need, and they tell
                you that in their offer. Anything outside this description needs a
                separate booking; a provider cannot add work to this job.
              </Text>
            </GlassCard>
          </View>

          {/* Bottom spacing for CTA button */}
          <View style={styles.bottomPadding} />
        </ScrollView>

        {/* Book Now CTA */}
        <View style={styles.ctaContainer}>
          <View style={styles.ctaPriceInfo}>
            <Text style={[styles.ctaPriceLabel, { color: theme.textSecondary }]}>Range</Text>
            <Text style={[styles.ctaPriceValue, { color: theme.textPrimary }]}>
              ${taskDetail.priceRangeMin} - ${taskDetail.priceRangeMax}
              <Text style={[styles.ctaPriceUnit, { color: theme.textSecondary }]}>
                {unitSuffix(taskDetail.pricingUnit)}
              </Text>
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
    </Screen>
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
  priceUnit: {
    ...Typography.title3,
    fontWeight: FontWeight.regular as '400',
    opacity: 0.7,
  },
  ctaPriceUnit: {
    ...Typography.footnote,
    fontWeight: FontWeight.regular as '400',
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
