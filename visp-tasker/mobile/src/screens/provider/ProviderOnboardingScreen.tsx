import React, { useEffect, useState } from 'react';
import {
    ActivityIndicator,
    FlatList,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
    Alert,
    SectionList,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Colors, Spacing, Typography, BorderRadius, Shadows } from '../../theme';
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
                // No saved services yet — that's fine for first-time onboarding
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
                t.regulated || t.licenseRequired || t.hazardous || t.structural
            );

            if (restricted.length > 0) {
                const names = restricted.map(t => `• ${t.name}`).join('\n');
                Alert.alert(
                    'Services Saved ✓',
                    `Your services have been saved.\n\nThe following require verification before activation:\n${names}\n\nPlease upload documents in Profile > Credentials.`,
                    [
                        {
                            text: 'OK',
                            onPress: () => finishOnboarding()
                        }
                    ]
                );
            } else {
                Alert.alert(
                    'Services Saved ✓',
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
            // First-time onboarding from registration — reset to ProviderHome
            navigation.reset({
                index: 0,
                routes: [{ name: 'ProviderHome' }],
            });
        }
    };

    if (isLoading) {
        return (
            <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color={Colors.primary} />
            </View>
        );
    }

    return (
        <View style={styles.container}>
            <View style={styles.header}>
                <Text style={styles.title}>Select Your Services</Text>
                <Text style={styles.subtitle}>
                    Choose the services you are qualified to perform.
                </Text>
            </View>

            <FlatList
                data={categories}
                keyExtractor={(item) => item.id}
                contentContainerStyle={styles.listContent}
                renderItem={({ item: category }) => {
                    const isExpanded = expandedCategories.has(category.id);
                    // Check if any child is selected for summary
                    const selectedCount = category.tasks.filter(t => selectedTaskIds.has(t.id)).length;

                    return (
                        <View style={styles.categoryCard}>
                            <TouchableOpacity
                                style={styles.categoryHeader}
                                onPress={() => toggleCategory(category.id)}
                            >
                                <View style={styles.categoryInfo}>
                                    <Text style={styles.categoryName}>{category.name}</Text>
                                    {selectedCount > 0 && (
                                        <Text style={styles.selectedBadge}>{selectedCount} selected</Text>
                                    )}
                                </View>
                                <Text style={{ fontSize: 18, color: Colors.textSecondary }}>
                                    {isExpanded ? '▲' : '▼'}
                                </Text>
                            </TouchableOpacity>

                            {isExpanded && (
                                <View style={styles.tasksList}>
                                    {category.tasks.map((task) => {
                                        const isSelected = selectedTaskIds.has(task.id);
                                        const isRestricted = task.regulated || task.licenseRequired;

                                        return (
                                            <TouchableOpacity
                                                key={task.id}
                                                style={[
                                                    styles.taskItem,
                                                    isSelected && styles.taskItemSelected,
                                                ]}
                                                onPress={() => toggleTask(task.id)}
                                            >
                                                <View style={[styles.checkbox, isSelected && styles.checkboxSelected]}>
                                                    {isSelected && (
                                                        <Text style={{ fontSize: 14, color: Colors.white, fontWeight: 'bold' }}>✓</Text>
                                                    )}
                                                </View>
                                                <View style={styles.taskInfo}>
                                                    <Text style={[
                                                        styles.taskName,
                                                        isSelected && styles.taskNameSelected
                                                    ]}>
                                                        {task.name}
                                                    </Text>
                                                    {isRestricted && (
                                                        <View style={styles.restrictedBadge}>
                                                            <Text style={{ fontSize: 12 }}>🛡</Text>
                                                            <Text style={styles.restrictedText}>Requires License</Text>
                                                        </View>
                                                    )}
                                                </View>
                                            </TouchableOpacity>
                                        );
                                    })}
                                </View>
                            )}
                        </View>
                    );
                }}
            />

            <View style={styles.footer}>
                <TouchableOpacity
                    style={styles.continueButton}
                    onPress={handleSubmit}
                    disabled={isSaving}
                >
                    {isSaving ? (
                        <ActivityIndicator color={Colors.white} />
                    ) : (
                        <Text style={styles.continueButtonText}>Save & Continue</Text>
                    )}
                </TouchableOpacity>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: Colors.background,
    },
    loadingContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    header: {
        padding: Spacing.lg,
        backgroundColor: Colors.surface,
        borderBottomWidth: 1,
        borderBottomColor: Colors.border,
    },
    title: {
        fontSize: 24,
        fontWeight: 'bold',
        color: Colors.textPrimary,
        marginBottom: Spacing.xs,
    },
    subtitle: {
        fontSize: 14,
        color: Colors.textSecondary,
    },
    listContent: {
        padding: Spacing.md,
    },
    categoryCard: {
        backgroundColor: Colors.surface,
        borderRadius: BorderRadius.md,
        marginBottom: Spacing.md,
        ...Shadows.sm,
        overflow: 'hidden',
    },
    categoryHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: Spacing.md,
    },
    categoryInfo: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    categoryName: {
        fontSize: 16,
        fontWeight: '600',
        color: Colors.textPrimary,
        marginRight: Spacing.sm,
    },
    selectedBadge: {
        fontSize: 12,
        color: Colors.primary,
        backgroundColor: Colors.primaryLight,
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 10,
        overflow: 'hidden',
    },
    tasksList: {
        borderTopWidth: 1,
        borderTopColor: Colors.border,
        backgroundColor: Colors.surface, // Slightly different user needed
    },
    taskItem: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: Spacing.md,
        borderBottomWidth: 1,
        borderBottomColor: Colors.border,
    },
    taskItemSelected: {
        backgroundColor: Colors.primaryLight + '20', // transparent primary
    },
    checkbox: {
        width: 24,
        height: 24,
        borderRadius: 4,
        borderWidth: 2,
        borderColor: Colors.primary,
        marginRight: Spacing.md,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: 'transparent',
    },
    checkboxSelected: {
        backgroundColor: Colors.primary,
    },
    taskInfo: {
        flex: 1,
    },
    taskName: {
        fontSize: 14,
        color: Colors.textPrimary,
    },
    taskNameSelected: {
        color: Colors.primary,
        fontWeight: '600',
    },
    restrictedBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 2,
    },
    restrictedText: {
        fontSize: 10,
        color: Colors.warning,
        marginLeft: 4,
    },
    footer: {
        padding: Spacing.lg,
        backgroundColor: Colors.surface,
        borderTopWidth: 1,
        borderTopColor: Colors.border,
    },
    continueButton: {
        backgroundColor: Colors.primary,
        paddingVertical: Spacing.md,
        borderRadius: BorderRadius.md,
        alignItems: 'center',
    },
    continueButtonText: {
        color: Colors.white,
        fontSize: 16,
        fontWeight: 'bold',
    },
});
