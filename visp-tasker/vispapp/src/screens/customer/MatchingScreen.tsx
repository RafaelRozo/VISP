/**
 * VISP - MatchingScreen (Glass Redesign)
 *
 * Immediate "Job Posted" success flow.
 * Features:
 *   - Brief "Posting your job..." animation (1-2 seconds) with PulseRing
 *   - Transitions to "Job Posted!" success state with AnimatedCheckmark
 *   - "View My Jobs" and "Back to Home" navigation buttons
 *   - Glass design with existing visual style
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { GlassCard, GlassButton } from '../../components/glass';
import { Screen } from '../../components/visp';
import { PulseRing, AnimatedCheckmark } from '../../components/animations';
import { Colors } from '../../theme/colors';
import { useTheme } from '../../theme/ThemeContext';
import { Spacing } from '../../theme/spacing';
import { Typography, FontWeight, FontSize } from '../../theme/typography';
import { taskService, type AvailableProvider } from '../../services/taskService';
import { providerService, type ProviderDocumentDto } from '../../services/providerService';
import type { CustomerFlowParamList } from '../../types';

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

type MatchingRouteProp = RouteProp<CustomerFlowParamList, 'Matching'>;
type MatchingNavProp = NativeStackNavigationProp<CustomerFlowParamList, 'Matching'>;

type PostPhase = 'posting' | 'posted';

// ──────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────

const POSTING_DURATION_MS = 1800;

// Compact rating chip for the list row: "★ 4.8 (12)" or "New" for no reviews.
function ratingLabel(p: AvailableProvider): string {
  if (p.reviewCount > 0 && p.rating != null) {
    return `★ ${p.rating.toFixed(1)} (${p.reviewCount})`;
  }
  return 'New';
}

// ──────────────────────────────────────────────
// Component
// ──────────────────────────────────────────────

function MatchingScreen(): React.JSX.Element {
  const theme = useTheme();
  const route = useRoute<MatchingRouteProp>();
  const navigation = useNavigation<MatchingNavProp>();
  const { jobId, taskName } = route.params;

  const [phase, setPhase] = useState<PostPhase>('posting');
  const [providers, setProviders] = useState<AvailableProvider[]>([]);
  const [selected, setSelected] = useState<AvailableProvider | null>(null);
  // Full public profile (documents/certificates) fetched when a card is tapped.
  const [selectedDocs, setSelectedDocs] = useState<ProviderDocumentDto[]>([]);

  useEffect(() => {
    if (!selected) { setSelectedDocs([]); return; }
    let active = true;
    providerService.getPublicProfile(selected.providerId)
      .then((p) => { if (active) setSelectedDocs(p.documents || []); })
      .catch(() => { if (active) setSelectedDocs([]); });
    return () => { active = false; };
  }, [selected]);

  // Fetch qualified providers in the customer's zone (with their own prices).
  // Empty => none available now → the job waits for offers (existing flow).
  useEffect(() => {
    let active = true;
    taskService.getAvailableProviders(jobId)
      .then((res) => { if (active) setProviders(res.providers || []); })
      .catch(() => { /* leave empty → fallback messaging */ });
    return () => { active = false; };
  }, [jobId]);

  // Animation values
  const dotScale = useRef(new Animated.Value(1)).current;
  const contentOpacity = useRef(new Animated.Value(0)).current;
  const dotAnimRef = useRef<Animated.CompositeAnimation | null>(null);

  // Hide the header back button
  useEffect(() => {
    navigation.setOptions({
      headerShown: false,
    });
  }, [navigation]);

  // Center dot pulse animation (only during posting phase)
  useEffect(() => {
    if (phase !== 'posting') {
      dotAnimRef.current = null;
      return;
    }

    const dotAnim = Animated.loop(
      Animated.sequence([
        Animated.timing(dotScale, {
          toValue: 1.2,
          duration: 600,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(dotScale, {
          toValue: 1,
          duration: 600,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );

    dotAnimRef.current = dotAnim;
    dotAnim.start();

    return () => {
      dotAnim.stop();
      dotAnimRef.current = null;
    };
  }, [phase]);

  // Transition from posting to posted after a brief delay
  useEffect(() => {
    const timer = setTimeout(() => {
      // Stop the dot animation BEFORE changing phase to avoid the race
      // condition where the Animated.View unmounts before the loop stops,
      // which triggers "onAnimatedValueUpdate with no listeners" warning.
      dotAnimRef.current?.stop();
      dotAnimRef.current = null;
      dotScale.setValue(1);

      setPhase('posted');

      // Fade in the success content
      Animated.timing(contentOpacity, {
        toValue: 1,
        duration: 500,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }).start();
    }, POSTING_DURATION_MS);

    return () => clearTimeout(timer);
  }, []);

  // Navigation handlers
  const handleViewMyJobs = () => {
    const rootNav = navigation.getParent();
    if (rootNav) {
      rootNav.reset({
        index: 0,
        routes: [{ name: 'CustomerHome', params: { screen: 'MyJobs' } } as any],
      });
    } else {
      navigation.navigate('MyJobs' as any);
    }
  };

  const handleBackToHome = () => {
    const rootNav = navigation.getParent();
    if (rootNav) {
      rootNav.reset({
        index: 0,
        routes: [{ name: 'CustomerHome' as any }],
      });
    } else {
      navigation.goBack();
    }
  };

  const isPosted = phase === 'posted';

  return (
    <Screen>
      <View style={styles.container}>
        {/* Top section: task name */}
        <View style={styles.topSection}>
          <Text style={[styles.taskLabel, { color: theme.textSecondary }]}>
            {isPosted ? 'Job Posted' : 'Booking'}
          </Text>
          <Text style={[styles.taskName, { color: theme.textPrimary }]}>{taskName}</Text>
        </View>

        {/* Center animation inside glass panel */}
        <View style={styles.animationContainer}>
          <GlassCard variant="dark" padding={Spacing.xxl} style={styles.glassAnimPanel}>
            <View style={styles.pulseContainer}>
              {/* PulseRing animation during posting phase */}
              {!isPosted && (
                <PulseRing
                  size={220}
                  color="#7850FF"
                  ringCount={3}
                  duration={2000}
                  centerRadius={20}
                  maxRadius={100}
                />
              )}

              {/* AnimatedCheckmark for posted state */}
              {isPosted && (
                <AnimatedCheckmark
                  size={100}
                  color={Colors.success}
                />
              )}

              {/* Overlay center dot with text label when posting */}
              {!isPosted && (
                <Animated.View
                  style={[
                    styles.centerDot,
                    styles.centerDotOverlay,
                    { transform: [{ scale: dotScale }] },
                  ]}
                >
                  <Text style={styles.centerDotText}>V</Text>
                </Animated.View>
              )}
            </View>
          </GlassCard>

          {/* Status text */}
          <Text style={[styles.statusText, { color: theme.textSecondary }]}>
            {isPosted
              ? 'Job Posted!'
              : 'Posting your job...'}
          </Text>

          {/* Success message and buttons */}
          {isPosted && (
            <Animated.View style={[styles.successContent, { opacity: contentOpacity }]}>
              {providers.length > 0 ? (
                <>
                  <Text style={[styles.successMessage, { color: theme.textSecondary }]}>
                    {providers.length} {providers.length === 1 ? 'provider is' : 'providers are'} available in your zone:
                  </Text>
                  <View style={{ width: '100%', marginBottom: Spacing.md }}>
                    {providers.slice(0, 5).map((p) => (
                      <Pressable
                        key={p.providerId}
                        onPress={() => setSelected(p)}
                        style={({ pressed }) => ({
                          flexDirection: 'row',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          paddingVertical: 10,
                          paddingHorizontal: Spacing.md,
                          borderRadius: 12,
                          borderWidth: StyleSheet.hairlineWidth,
                          borderColor: theme.border,
                          marginBottom: 8,
                          opacity: pressed ? 0.6 : 1,
                        })}
                      >
                        <View style={{ flex: 1 }}>
                          <Text style={{ color: theme.textPrimary, fontWeight: '600', fontSize: FontSize.body }}>
                            {p.displayName}
                          </Text>
                          <Text style={{ color: theme.textTertiary, fontSize: FontSize.caption, marginTop: 2 }}>
                            {ratingLabel(p)}{p.level ? `  ·  L${p.level}` : ''}{p.distanceKm != null ? `  ·  ${p.distanceKm} km` : ''}
                          </Text>
                        </View>
                        {p.rateCents != null ? (
                          <Text style={{ color: theme.textPrimary, fontWeight: '700', fontSize: FontSize.body }}>
                            ${(p.rateCents / 100).toFixed(2)}
                            {p.pricingUnit ? <Text style={{ color: theme.textTertiary, fontSize: FontSize.caption }}>{`/${p.pricingUnit}`}</Text> : null}
                          </Text>
                        ) : (
                          <Text style={{ color: theme.textTertiary, fontSize: FontSize.caption }}>Quotes per job</Text>
                        )}
                        <Text style={{ color: theme.textTertiary, fontSize: FontSize.body, marginLeft: 8 }}>›</Text>
                      </Pressable>
                    ))}
                  </View>
                  <Text style={[styles.successMessage, { color: theme.textTertiary }]}>
                    They'll send you a request to accept or decline. Track it in your jobs list.
                  </Text>
                </>
              ) : (
                <Text style={[styles.successMessage, { color: theme.textSecondary }]}>
                  Your job request has been posted! You'll be notified when Vispers apply
                  to your job. Check your jobs list for updates.
                </Text>
              )}

              <View style={styles.buttonGroup}>
                <GlassButton
                  title="View My Jobs"
                  variant="glow"
                  onPress={handleViewMyJobs}
                  style={styles.primaryButton}
                />

                <GlassButton
                  title="Back to Home"
                  variant="outline"
                  onPress={handleBackToHome}
                  style={styles.secondaryButton}
                />
              </View>
            </Animated.View>
          )}

          {/* Phase indicator dots */}
          <View style={styles.phaseDotsContainer}>
            <View
              style={[
                styles.phaseDot,
                styles.phaseDotActive,
              ]}
            />
            <View
              style={[
                styles.phaseDot,
                isPosted && styles.phaseDotActive,
                isPosted && styles.phaseDotConfirmed,
              ]}
            />
          </View>
        </View>

        {/* Bottom section */}
        <View style={styles.bottomSection}>
          <Text style={[styles.footerText, { color: theme.textTertiary }]}>
            VISP acts as a platform intermediary only.
            {'\n'}Providers are independent service professionals.
          </Text>
        </View>
      </View>

      {/* Provider detail — tap a card to see rating, experience and summary. */}
      <Modal
        visible={selected != null}
        transparent
        animationType="fade"
        onRequestClose={() => setSelected(null)}
      >
        <Pressable
          style={styles.modalBackdrop}
          onPress={() => setSelected(null)}
        >
          <Pressable
            style={[styles.modalCard, { backgroundColor: theme.surface, borderColor: theme.border }]}
            onPress={() => { /* swallow taps inside the card */ }}
          >
            {selected && (
              <>
                <Text style={{ color: theme.textPrimary, fontSize: FontSize.title3, fontWeight: '700' }}>
                  {selected.displayName}
                </Text>

                <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 6, flexWrap: 'wrap' }}>
                  <Text style={{ color: '#F5A623', fontSize: FontSize.body, fontWeight: '700' }}>
                    {selected.reviewCount > 0 && selected.rating != null
                      ? `★ ${selected.rating.toFixed(1)}`
                      : '★ —'}
                  </Text>
                  <Text style={{ color: theme.textTertiary, fontSize: FontSize.caption, marginLeft: 6 }}>
                    {selected.reviewCount > 0
                      ? `${selected.reviewCount} review${selected.reviewCount === 1 ? '' : 's'}`
                      : 'No reviews yet — new provider'}
                  </Text>
                </View>

                <View style={{ flexDirection: 'row', marginTop: 12, flexWrap: 'wrap' }}>
                  {selected.level != null && (
                    <Text style={[styles.detailChip, { color: theme.textSecondary, borderColor: theme.border }]}>
                      Level {selected.level}
                    </Text>
                  )}
                  {selected.yearsExperience != null && (
                    <Text style={[styles.detailChip, { color: theme.textSecondary, borderColor: theme.border }]}>
                      {selected.yearsExperience} yr{selected.yearsExperience === 1 ? '' : 's'} exp.
                    </Text>
                  )}
                  {selected.distanceKm != null && (
                    <Text style={[styles.detailChip, { color: theme.textSecondary, borderColor: theme.border }]}>
                      {selected.distanceKm} km away
                    </Text>
                  )}
                </View>

                <ScrollView style={{ maxHeight: 200, marginTop: 12 }}>
                  <Text style={{ color: theme.textSecondary, fontSize: FontSize.body, lineHeight: 20 }}>
                    {selected.bio || 'This provider has not added a summary yet.'}
                  </Text>
                  {selectedDocs.length > 0 && (
                    <View style={{ marginTop: 14 }}>
                      <Text style={{ color: theme.textTertiary, fontSize: FontSize.caption, fontWeight: '700', textTransform: 'uppercase', marginBottom: 6 }}>
                        Documents · {selectedDocs.length}
                      </Text>
                      {selectedDocs.map((d) => (
                        <View key={d.id} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 6 }}>
                          <Text style={{ color: theme.textSecondary, fontSize: FontSize.body }}>📄  {d.name}</Text>
                        </View>
                      ))}
                    </View>
                  )}
                </ScrollView>

                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 16 }}>
                  <Text style={{ color: theme.textPrimary, fontSize: FontSize.body, fontWeight: '700' }}>
                    {selected.rateCents != null
                      ? `$${(selected.rateCents / 100).toFixed(2)}${selected.pricingUnit ? `/${selected.pricingUnit}` : ''}`
                      : 'Quotes per job'}
                  </Text>
                  <GlassButton title="Close" variant="outline" onPress={() => setSelected(null)} />
                </View>
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </Screen>
  );
}

// ──────────────────────────────────────────────
// Styles
// ──────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'space-between',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    paddingHorizontal: Spacing.lg,
  },
  modalCard: {
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.lg,
  },
  detailChip: {
    fontSize: FontSize.caption,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginRight: 8,
    marginBottom: 8,
    overflow: 'hidden',
  },

  // Top
  topSection: {
    alignItems: 'center',
    paddingTop: Spacing.giant,
    paddingHorizontal: Spacing.xxl,
  },
  taskLabel: {
    ...Typography.label,
    color: 'rgba(255, 255, 255, 0.4)',
    marginBottom: Spacing.xs,
  },
  taskName: {
    ...Typography.title2,
    color: '#FFFFFF',
    textAlign: 'center',
  },

  // Animation
  animationContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  glassAnimPanel: {
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: Spacing.xxl,
    marginBottom: Spacing.xxl,
  },
  pulseContainer: {
    width: 280,
    height: 280,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerDot: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: 'rgba(120, 80, 255, 0.8)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerDotOverlay: {
    position: 'absolute',
  },
  centerDotText: {
    fontSize: FontSize.title2,
    fontWeight: FontWeight.bold as '700',
    color: '#FFFFFF',
  },
  statusText: {
    ...Typography.body,
    color: 'rgba(255, 255, 255, 0.6)',
    textAlign: 'center',
    paddingHorizontal: Spacing.xxl,
    marginBottom: Spacing.xl,
  },
  phaseDotsContainer: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  phaseDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
  },
  phaseDotActive: {
    backgroundColor: 'rgba(120, 80, 255, 0.8)',
  },
  phaseDotConfirmed: {
    backgroundColor: Colors.success,
  },

  // Success content
  successContent: {
    alignItems: 'center',
    paddingHorizontal: Spacing.xxl,
    marginBottom: Spacing.xl,
  },
  successMessage: {
    ...Typography.body,
    color: 'rgba(255, 255, 255, 0.7)',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: Spacing.xxl,
  },
  buttonGroup: {
    width: '100%',
    gap: Spacing.md,
  },
  primaryButton: {
    width: '100%',
  },
  secondaryButton: {
    width: '100%',
  },

  // Bottom
  bottomSection: {
    alignItems: 'center',
    paddingBottom: Spacing.huge,
    paddingHorizontal: Spacing.xxl,
  },
  footerText: {
    ...Typography.caption,
    color: 'rgba(255, 255, 255, 0.3)',
    textAlign: 'center',
    lineHeight: 16,
  },
});

export default MatchingScreen;
