/**
 * VISP - Provider Onboarding Screen
 *
 * Service selection during provider onboarding. Categories with expandable
 * task lists, checkbox selection, restricted-task badges, and submit flow.
 *
 * Dark glassmorphism styling with GlassBackground, GlassCard, GlassButton.
 */

import React, { useEffect, useState } from 'react';
import {
    FlatList,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
    Alert,
} from 'react-native';
import { AnimatedSpinner } from '../../components/animations';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Colors } from '../../theme/colors';
import { GlassStyles } from '../../theme/glass';
import { GlassBackground, GlassCard, GlassButton } from '../../components/glass';
import { taxonomyService, ProviderCategory, ProviderTask } from '../../services/taxonomyService';
import { providerService } from '../../services/providerService';
import { useAuthStore } from '../../stores/authStore';
import { useProviderStore } from '../../stores/providerStore';


export default function ProviderOnboardingScreen() {
    const navigation = useNavigation<any>();
    const route = useRoute<any>();
    const { user } = useAuthStore();
    const { providerProfile, fetchProviderProfile } = useProviderStore();

    const [categories, setCategories] = useState<ProviderCategory[]>([]);
    const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set());
    const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => {
        loadTaxonomy();
    }, []);

    const loadTaxonomy = async () => {
        try {
            const data = await taxonomyService.getProviderTaxonomy();
            setCategories(data);

            // Pre-select existing qualifications if any
            try {
                const saved = await taxonomyService.getMyServices();
                if (saved.taskIds && saved.taskIds.length > 0) {
                    setSelectedTaskIds(new Set(saved.taskIds));
                    // Auto-expand categories that have selected tasks
                    const expandIds = new Set<string>();
                    for (const cat of data) {
                        if (cat.tasks.some(t => saved.taskIds.includes(t.id))) {
                            expandIds.add(cat.id);
                        }
                    }
                    setExpandedCategories(expandIds);
                }
            } catch {
                // No saved services yet -- that is fine for first-time onboarding
            }
        } catch (error) {
            console.error('Failed to load taxonomy:', error);
            const errorMessage = (error as any)?.message || 'Failed to load services.';
            Alert.alert('Error', errorMessage);
        } finally {
            setIsLoading(false);
        }
    };

    const toggleCategory = (categoryId: string) => {
        const newExpanded = new Set(expandedCategories);
        if (newExpanded.has(categoryId)) {
            newExpanded.delete(categoryId);
        } else {
            newExpanded.add(categoryId);
        }
        setExpandedCategories(newExpanded);
    };

    const toggleTask = (taskId: string) => {
        const newSelected = new Set(selectedTaskIds);
        if (newSelected.has(taskId)) {
            newSelected.delete(taskId);
        } else {
            newSelected.add(taskId);
        }
        setSelectedTaskIds(newSelected);
    };

    const handleSubmit = async () => {
        if (selectedTaskIds.size === 0) {
            Alert.alert('Selection Required', 'Please select at least one service.');
            return;
        }

        setIsSaving(true);
        try {
            await providerService.updateServices(Array.from(selectedTaskIds));

            // Check for restricted tasks
            const allTasks = categories.flatMap(c => c.tasks);
            const selectedTasks = allTasks.filter(t => selectedTaskIds.has(t.id));

            const restricted = selectedTasks.filter(t =>
                t.regulated || t.licenseRequired || t.certificationRequired || t.hazardous || t.structural
            );

            if (restricted.length > 0) {
                const names = restricted.map(t => `- ${t.name}`).join('\n');
                Alert.alert(
                    'Services Saved',
                    `Your services have been saved.\n\nThe following require documents before activation:\n${names}\n\nPlease upload the required documents in Profile > Credentials.`,
                    [
                        {
                            text: 'OK',
                            onPress: () => finishOnboarding()
                        }
                    ]
                );
            } else {
                Alert.alert(
                    'Services Saved',
                    'All your selected services are active!',
                    [{ text: 'OK', onPress: () => finishOnboarding() }]
                );
            }
        } catch (error) {
            console.error('Failed to save services:', error);
            Alert.alert('Error', 'Failed to save services. Please try again.');
        } finally {
            setIsSaving(false);
        }
    };

    const finishOnboarding = async () => {
        // Refresh profile to get new status/level
        // await fetchProviderProfile(); // optional if store has it

        // If we can go back (came from Profile/Dashboard), just go back
        if (navigation.canGoBack()) {
            navigation.goBack();
        } else {
            // First-time onboarding from registration -- reset to ProviderHome
            navigation.reset({
                index: 0,
                routes: [{ name: 'ProviderHome' }],
            });
        }
    };

    // ── Progress indicator ──────────────────────────────────────────────
    const totalTasks = categories.reduce((sum, c) => sum + c.tasks.length, 0);
    const progressPercent = totalTasks > 0
        ? Math.round((selectedTaskIds.size / totalTasks) * 100)
        : 0;

    if (isLoading) {
        return (
            <GlassBackground>
                <View style={styles.loadingContainer}>
                    <AnimatedSpinner size={48} color={Colors.primary} />
                    <Text style={styles.loadingText}>Loading services...</Text>
                </View>
            </GlassBackground>
        );
    }

    return (
        <GlassBackground>
            <View style={styles.container}>
                {/* Header with glass dark panel */}
                <View style={styles.header}>
                    <Text style={styles.title}>Select Your Services</Text>
                    <Text style={styles.subtitle}>
                        Choose the services you are qualified to perform.
                    </Text>

                    {/* Glass progress bar */}
                    <View style={styles.progressContainer}>
                        <View style={styles.progressBarTrack}>
                            <View
                                style={[
                                    styles.progressBarFill,
                                    { width: `${Math.min(progressPercent, 100)}%` },
                                ]}
                            />
                        </View>
                        <Text style={styles.progressText}>
                            {selectedTaskIds.size} selected
                        </Text>
                    </View>
                </View>

                <FlatList
                    data={categories}
                    keyExtractor={(item) => item.id}
                    contentContainerStyle={styles.listContent}
                    showsVerticalScrollIndicator={false}
                    renderItem={({ item: category }) => {
                        const isExpanded = expandedCategories.has(category.id);
                        const selectedCount = category.tasks.filter(t => selectedTaskIds.has(t.id)).length;

                        return (
                            <GlassCard variant="dark" padding={0} style={styles.categoryCard}>
                                <TouchableOpacity
                                    style={styles.categoryHeader}
                                    onPress={() => toggleCategory(category.id)}
                                    activeOpacity={0.7}
                                >
                                    <View style={styles.categoryInfo}>
                                        <Text style={styles.categoryName}>{category.name}</Text>
                                        {selectedCount > 0 && (
                                            <View style={styles.selectedBadge}>
                                                <Text style={styles.selectedBadgeText}>
                                                    {selectedCount} selected
                                                </Text>
                                            </View>
                                        )}
                                    </View>
                                    <Text style={styles.chevron}>
                                        {isExpanded ? '\u25B2' : '\u25BC'}
                                    </Text>
                                </TouchableOpacity>

                                {isExpanded && (
                                    <View style={styles.tasksList}>
                                        {category.tasks.map((task) => {
                                            const isSelected = selectedTaskIds.has(task.id);
                                            const needsLicense = task.licenseRequired;
                                            const needsCertification = task.certificationRequired;
                                            const isRegulated = task.regulated && !needsLicense && !needsCertification;

                                            return (
                                                <TouchableOpacity
                                                    key={task.id}
                                                    style={[
                                                        styles.taskItem,
                                                        isSelected && styles.taskItemSelected,
                                                    ]}
                                                    onPress={() => toggleTask(task.id)}
                                                    activeOpacity={0.7}
                                                >
                                                    <View style={[
                                                        styles.checkbox,
                                                        isSelected && styles.checkboxSelected,
                                                    ]}>
                                                        {isSelected && (
                                                            <Text style={styles.checkmarkText}>
                                                                {'\u2713'}
                                                            </Text>
                                                        )}
                                                    </View>
                                                    <View style={styles.taskInfo}>
                                                        <Text style={[
                                                            styles.taskName,
                                                            isSelected && styles.taskNameSelected,
                                                        ]}>
                                                            {task.name}
                                                        </Text>
                                                        {needsLicense && (
                                                            <View style={styles.restrictedBadge}>
                                                                <Text style={styles.restrictedIcon}>S</Text>
                                                                <Text style={styles.restrictedTextWarn}>
                                                                    Requires License
                                                                </Text>
                                                            </View>
                                                        )}
                                                        {needsCertification && (
                                                            <View style={styles.restrictedBadge}>
                                                                <Text style={styles.restrictedIcon}>D</Text>
                                                                <Text style={styles.restrictedTextCert}>
                                                                    Requires Certificate
                                                                </Text>
                                                            </View>
                                                        )}
                                                        {isRegulated && (
                                                            <View style={styles.restrictedBadge}>
                                                                <Text style={styles.restrictedIcon}>!</Text>
                                                                <Text style={styles.restrictedTextWarn}>
                                                                    Regulated
                                                                </Text>
                                                            </View>
                                                        )}
                                                    </View>
                                                </TouchableOpacity>
                                            );
                                        })}
                                    </View>
                                )}
                            </GlassCard>
                        );
                    }}
                />

                {/* Footer with glass panel and glow submit button */}
                <View style={styles.footer}>
                    <GlassButton
                        title="Save & Continue"
                        variant="glow"
                        onPress={handleSubmit}
                        loading={isSaving}
                        disabled={isSaving}
                        style={styles.submitButton}
                    />
                </View>
            </View>
        </GlassBackground>
    );
}

// ---------------------------------------------------------------------------
// Styles -- Dark Glassmorphism
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    loadingContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    loadingText: {
        fontSize: 14,
        color: 'rgba(255, 255, 255, 0.5)',
        marginTop: 12,
    },

    // ── Header ────────────────────────────────────────────────
    header: {
        paddingHorizontal: 20,
        paddingTop: 20,
        paddingBottom: 16,
        backgroundColor: 'rgba(10, 10, 30, 0.60)',
        borderBottomWidth: 1,
        borderBottomColor: 'rgba(255, 255, 255, 0.08)',
    },
    title: {
        fontSize: 24,
        fontWeight: 'bold',
        color: '#FFFFFF',
        marginBottom: 4,
    },
    subtitle: {
        fontSize: 14,
        color: 'rgba(255, 255, 255, 0.55)',
        marginBottom: 16,
    },

    // ── Progress bar ──────────────────────────────────────────
    progressContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    progressBarTrack: {
        flex: 1,
        height: 6,
        borderRadius: 3,
        backgroundColor: 'rgba(255, 255, 255, 0.08)',
        overflow: 'hidden',
    },
    progressBarFill: {
        height: '100%',
        borderRadius: 3,
        backgroundColor: 'rgba(120, 80, 255, 0.8)',
    },
    progressText: {
        fontSize: 12,
        fontWeight: '600',
        color: 'rgba(255, 255, 255, 0.5)',
    },

    // ── List ──────────────────────────────────────────────────
    listContent: {
        padding: 16,
        paddingBottom: 8,
    },

    // ── Category cards ────────────────────────────────────────
    categoryCard: {
        marginBottom: 12,
        overflow: 'hidden',
    },
    categoryHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: 16,
    },
    categoryInfo: {
        flexDirection: 'row',
        alignItems: 'center',
        flex: 1,
    },
    categoryName: {
        fontSize: 16,
        fontWeight: '600',
        color: '#FFFFFF',
        marginRight: 10,
    },
    selectedBadge: {
        backgroundColor: 'rgba(120, 80, 255, 0.20)',
        borderWidth: 1,
        borderColor: 'rgba(120, 80, 255, 0.40)',
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: 10,
    },
    selectedBadgeText: {
        fontSize: 11,
        fontWeight: '600',
        color: 'rgba(180, 150, 255, 1)',
    },
    chevron: {
        fontSize: 14,
        color: 'rgba(255, 255, 255, 0.45)',
    },

    // ── Task list ─────────────────────────────────────────────
    tasksList: {
        borderTopWidth: 1,
        borderTopColor: 'rgba(255, 255, 255, 0.08)',
    },
    taskItem: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 14,
        paddingHorizontal: 16,
        borderBottomWidth: 1,
        borderBottomColor: 'rgba(255, 255, 255, 0.06)',
    },
    taskItemSelected: {
        backgroundColor: 'rgba(120, 80, 255, 0.08)',
    },

    // ── Checkbox ──────────────────────────────────────────────
    checkbox: {
        width: 24,
        height: 24,
        borderRadius: 6,
        borderWidth: 1.5,
        borderColor: 'rgba(255, 255, 255, 0.25)',
        marginRight: 14,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: 'rgba(255, 255, 255, 0.05)',
    },
    checkboxSelected: {
        backgroundColor: 'rgba(120, 80, 255, 0.8)',
        borderColor: 'rgba(120, 80, 255, 1)',
    },
    checkmarkText: {
        fontSize: 14,
        color: '#FFFFFF',
        fontWeight: 'bold',
    },

    // ── Task info ─────────────────────────────────────────────
    taskInfo: {
        flex: 1,
    },
    taskName: {
        fontSize: 14,
        color: 'rgba(255, 255, 255, 0.85)',
    },
    taskNameSelected: {
        color: '#FFFFFF',
        fontWeight: '600',
    },

    // ── Restricted badges ─────────────────────────────────────
    restrictedBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 3,
    },
    restrictedIcon: {
        fontSize: 12,
        color: 'rgba(255, 255, 255, 0.4)',
        fontWeight: '700',
    },
    restrictedTextWarn: {
        fontSize: 10,
        color: Colors.warning,
        marginLeft: 4,
    },
    restrictedTextCert: {
        fontSize: 10,
        color: Colors.primary,
        marginLeft: 4,
    },

    // ── Footer ────────────────────────────────────────────────
    footer: {
        paddingHorizontal: 20,
        paddingVertical: 16,
        backgroundColor: 'rgba(10, 10, 30, 0.70)',
        borderTopWidth: 1,
        borderTopColor: 'rgba(255, 255, 255, 0.08)',
    },
    submitButton: {
        width: '100%',
    },
});
