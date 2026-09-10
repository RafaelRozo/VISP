/**
 * VISP - Provider Onboarding Screen
 *
 * Service selection during provider onboarding. Categories with expandable
 * task lists. Tapping a service opens a modal with its description and a price
 * input, so the provider enables AND prices the service in one step.
 *
 * Dark glassmorphism styling with GlassBackground, GlassCard, GlassButton.
 */

import React, { useEffect, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    FlatList,
    KeyboardAvoidingView,
    Modal,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { AnimatedSpinner } from '../../components/animations';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Colors } from '../../theme/colors';
import { useTheme } from '../../theme/ThemeContext';
import { GlassStyles } from '../../theme/glass';
import { GlassCard, GlassButton } from '../../components/glass';
import { Screen } from '../../components/visp';
import { useTranslation } from '../../i18n';
import { taxonomyService, ProviderCategory, ProviderTask } from '../../services/taxonomyService';
import { providerService } from '../../services/providerService';
import { taskService } from '../../services/taskService';
import type { ServiceTaskDetail } from '../../types';
import { useAuthStore } from '../../stores/authStore';
import { useProviderStore } from '../../stores/providerStore';

type RowPrice = { cents: number; unit: string };

export default function ProviderOnboardingScreen() {
    const theme = useTheme();
    const navigation = useNavigation<any>();
    const route = useRoute<any>();
    const { t: tr } = useTranslation();
    const { user } = useAuthStore();
    const { providerProfile, fetchProviderProfile } = useProviderStore();

    const [categories, setCategories] = useState<ProviderCategory[]>([]);
    const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set());
    const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);

    const [priceMap, setPriceMap] = useState<Record<string, RowPrice>>({});
    const [managedByCompany, setManagedByCompany] = useState(false);

    const [modalTask, setModalTask] = useState<ProviderTask | null>(null);
    const [modalDetail, setModalDetail] = useState<ServiceTaskDetail | null>(null);
    const [modalLoading, setModalLoading] = useState(false);
    const [modalSaving, setModalSaving] = useState(false);
    const [priceInput, setPriceInput] = useState('');
    const [modalError, setModalError] = useState<string | null>(null);

    useEffect(() => {
        loadTaxonomy();
    }, []);

    const unitLabel = (unit: string): string => tr(`myPricesScreen.unit.${unit}`) || unit;

    const fmtRange = (minDollars: number, maxDollars: number): string => {
        const lo = minDollars > 0 ? Math.round(minDollars) : null;
        const hi = maxDollars > 0 ? Math.round(maxDollars) : null;
        if (lo != null && hi != null) return `$${lo} \u2013 $${hi}`;
        if (lo != null) return `$${lo}+`;
        if (hi != null) return `\u2264 $${hi}`;
        return '\u2014';
    };

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

            try {
                const { items, managedByCompany: mbc } = await providerService.getProviderRates();
                setManagedByCompany(mbc);
                const map: Record<string, RowPrice> = {};
                for (const r of items) {
                    if (r.rate_cents != null) {
                        map[r.task_id] = { cents: r.rate_cents, unit: r.pricing_unit };
                    }
                }
                setPriceMap(map);
            } catch {
                // Rates are optional here; the modal still works without them
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

    const closeModal = () => {
        if (modalSaving) return;
        setModalTask(null);
        setModalDetail(null);
        setPriceInput('');
        setModalError(null);
        setModalLoading(false);
    };

    const openModal = async (task: ProviderTask) => {
        setModalTask(task);
        setModalDetail(null);
        setModalError(null);
        setModalLoading(true);
        const existing = priceMap[task.id];
        setPriceInput(existing ? (existing.cents / 100).toFixed(2) : '');
        try {
            const detail = await taskService.fetchTaskDetail(task.id);
            setModalDetail(detail);
        } catch (error) {
            console.error('Failed to load service detail:', error);
            setModalError(tr('myPricesScreen.loadError') || 'Could not load this service.');
        } finally {
            setModalLoading(false);
        }
    };

    const onPriceChange = (raw: string) => {
        const cleaned = raw.replace(/[^0-9.]/g, '');
        const parts = cleaned.split('.');
        const formatted = parts.length > 2 ? `${parts[0]}.${parts.slice(1).join('')}` : cleaned;
        setPriceInput(formatted);
        setModalError(null);
    };

    const handleModalSave = async () => {
        if (!modalTask || modalSaving) return;
        const task = modalTask;
        const detail = modalDetail;

        const unit = detail?.pricingUnit ?? null;
        const isContract = unit === 'per_contract';
        const isCustomQuote = unit === 'custom_quote';
        const priceable = !!detail && !isContract && !isCustomQuote && !managedByCompany;

        let cents: number | null = null;
        if (priceable && detail) {
            const dollars = parseFloat(priceInput);
            if (isNaN(dollars) || dollars < 0) {
                setModalError(tr('myPricesScreen.invalidAmount') || 'Enter a valid amount.');
                return;
            }
            cents = Math.round(dollars * 100);
            const lo = detail.priceRangeMin > 0 ? Math.round(detail.priceRangeMin * 100) : null;
            const hi = detail.priceRangeMax > 0 ? Math.round(detail.priceRangeMax * 100) : null;
            if ((lo != null && cents < lo) || (hi != null && cents > hi)) {
                setModalError(
                    `${tr('myPricesScreen.outOfRange') || 'Allowed range'}: ${fmtRange(detail.priceRangeMin, detail.priceRangeMax)}`,
                );
                return;
            }
        }

        setModalSaving(true);
        setModalError(null);
        try {
            const nextSelected = new Set(selectedTaskIds);
            nextSelected.add(task.id);
            await providerService.updateServices(Array.from(nextSelected));
            setSelectedTaskIds(nextSelected);

            let needsVerification = false;
            if (priceable && cents != null) {
                try {
                    await providerService.setProviderRate(task.id, cents);
                    const savedCents = cents;
                    setPriceMap(p => ({ ...p, [task.id]: { cents: savedCents, unit: unit ?? '' } }));
                } catch (rateErr: any) {
                    const status = rateErr?.statusCode;
                    if (status === 403) {
                        needsVerification = true;
                    } else if (status === 422) {
                        setModalError(tr('myPricesScreen.outOfRangeServer') || 'Price outside the allowed range.');
                        setModalSaving(false);
                        return;
                    } else {
                        setModalError(tr('myPricesScreen.saveError') || 'Could not save. Try again.');
                        setModalSaving(false);
                        return;
                    }
                }
            }

            setModalSaving(false);
            setModalTask(null);
            setModalDetail(null);
            setPriceInput('');
            setModalError(null);

            if (needsVerification) {
                Alert.alert(
                    tr('providerOnboarding.serviceAddedTitle') || 'Service added',
                    tr('providerOnboarding.addedPendingVerification') ||
                        'This service needs document verification before you can price and offer it.',
                );
            }
        } catch (error) {
            console.error('Failed to save service:', error);
            setModalSaving(false);
            setModalError(tr('myPricesScreen.saveError') || 'Could not save. Try again.');
        }
    };

    const handleRemove = () => {
        if (!modalTask || modalSaving) return;
        const task = modalTask;
        Alert.alert(
            tr('providerOnboarding.removeConfirmTitle') || 'Remove this service?',
            tr('providerOnboarding.removeConfirmBody') || 'It will no longer be offered.',
            [
                { text: tr('common.cancel') || 'Cancel', style: 'cancel' },
                {
                    text: tr('providerOnboarding.remove') || 'Remove',
                    style: 'destructive',
                    onPress: async () => {
                        setModalSaving(true);
                        try {
                            const next = new Set(selectedTaskIds);
                            next.delete(task.id);
                            await providerService.updateServices(Array.from(next));
                            try {
                                await providerService.deleteProviderRate(task.id);
                            } catch {
                                // No rate to delete -- ignore
                            }
                            setSelectedTaskIds(next);
                            setPriceMap(p => {
                                const copy = { ...p };
                                delete copy[task.id];
                                return copy;
                            });
                            setModalSaving(false);
                            setModalTask(null);
                            setModalDetail(null);
                            setPriceInput('');
                            setModalError(null);
                        } catch (error) {
                            console.error('Failed to remove service:', error);
                            setModalSaving(false);
                            setModalError(tr('myPricesScreen.saveError') || 'Could not save. Try again.');
                        }
                    },
                },
            ],
        );
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
            <Screen>
                <View style={styles.loadingContainer}>
                    <AnimatedSpinner size={48} color={Colors.primary} />
                    <Text style={[styles.loadingText, { color: theme.textSecondary }]}>Loading services...</Text>
                </View>
            </Screen>
        );
    }

    const modalUnit = modalDetail?.pricingUnit ?? null;
    const modalIsContract = modalUnit === 'per_contract';
    const modalIsCustomQuote = modalUnit === 'custom_quote';
    const modalPriceable = !!modalDetail && !modalIsContract && !modalIsCustomQuote && !managedByCompany;
    const modalSelected = modalTask ? selectedTaskIds.has(modalTask.id) : false;
    const modalLevel = modalTask ? (modalTask.level || '').replace('LEVEL_', '') : '';
    const modalDescription =
        modalDetail?.fullDescription || modalTask?.description || '';

    return (
        <Screen>
            <View style={styles.container}>
                {/* Header with glass dark panel */}
                <View style={styles.header}>
                    <Text style={[styles.title, { color: theme.textPrimary }]}>Select Your Services</Text>
                    <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
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
                        <Text style={[styles.progressText, { color: theme.textSecondary }]}>
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
                                        <Text style={[styles.categoryName, { color: theme.textPrimary }]}>{category.name}</Text>
                                        {selectedCount > 0 && (
                                            <View style={styles.selectedBadge}>
                                                <Text style={styles.selectedBadgeText}>
                                                    {selectedCount} selected
                                                </Text>
                                            </View>
                                        )}
                                    </View>
                                    <Text style={[styles.chevron, { color: theme.textSecondary }]}>
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
                                            const rowPrice = priceMap[task.id];

                                            return (
                                                <TouchableOpacity
                                                    key={task.id}
                                                    style={[
                                                        styles.taskItem,
                                                        isSelected && styles.taskItemSelected,
                                                    ]}
                                                    onPress={() => openModal(task)}
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
                                                            { color: theme.textPrimary },
                                                            isSelected && styles.taskNameSelected,
                                                            isSelected && { color: theme.textPrimary },
                                                        ]}>
                                                            {task.name}
                                                        </Text>
                                                        {rowPrice && (
                                                            <Text style={styles.taskPrice}>
                                                                {`$${(rowPrice.cents / 100).toFixed(0)}`}
                                                                {rowPrice.unit ? `/${unitLabel(rowPrice.unit)}` : ''}
                                                            </Text>
                                                        )}
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

            {/* Service detail + price modal: enable AND price in one step. */}
            <Modal
                visible={modalTask != null}
                transparent
                animationType="slide"
                onRequestClose={closeModal}
            >
                <KeyboardAvoidingView
                    style={styles.modalRoot}
                    behavior={Platform.OS === 'ios' ? 'padding' : undefined}
                >
                    <Pressable style={styles.modalBackdrop} onPress={closeModal} />
                    <View style={[styles.modalCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
                        {modalTask && (
                            modalLoading ? (
                                <View style={styles.modalLoading}>
                                    <ActivityIndicator color={Colors.primary} />
                                    <Text style={[styles.modalLoadingText, { color: theme.textSecondary }]}>
                                        {tr('providerOnboarding.loadingService') || 'Loading service…'}
                                    </Text>
                                </View>
                            ) : (
                                <>
                                    <View style={styles.modalHeader}>
                                        <Text style={[styles.modalTitle, { color: theme.textPrimary }]} numberOfLines={2}>
                                            {modalTask.name}
                                        </Text>
                                        <Pressable onPress={closeModal} hitSlop={12} disabled={modalSaving}>
                                            <Text style={[styles.modalClose, { color: theme.textSecondary }]}>{'\u2715'}</Text>
                                        </Pressable>
                                    </View>

                                    <View style={styles.modalChips}>
                                        {modalLevel ? (
                                            <View style={[styles.modalChip, { borderColor: theme.border }]}>
                                                <Text style={[styles.modalChipText, { color: theme.textSecondary }]}>
                                                    {`L${modalLevel}`}
                                                </Text>
                                            </View>
                                        ) : null}
                                        {modalUnit ? (
                                            <View style={[styles.modalChip, { borderColor: theme.border }]}>
                                                <Text style={[styles.modalChipText, { color: theme.textSecondary }]}>
                                                    {unitLabel(modalUnit)}
                                                </Text>
                                            </View>
                                        ) : null}
                                    </View>

                                    <ScrollView style={styles.modalScroll} showsVerticalScrollIndicator={false}>
                                        <Text style={[styles.modalDesc, { color: theme.textSecondary }]}>
                                            {modalDescription}
                                        </Text>
                                    </ScrollView>

                                    {modalPriceable && modalDetail ? (
                                        <View style={styles.priceSection}>
                                            <Text style={[styles.priceLabel, { color: theme.textPrimary }]}>
                                                {tr('providerOnboarding.yourPrice') || 'Your price'}
                                            </Text>
                                            <Text style={[styles.rangeHint, { color: theme.textSecondary }]}>
                                                {`${tr('myPricesScreen.allowed') || 'Allowed range'} · ${fmtRange(modalDetail.priceRangeMin, modalDetail.priceRangeMax)}`}
                                            </Text>
                                            <View style={[styles.inputBox, { borderColor: theme.border }]}>
                                                <Text style={[styles.inputPrefix, { color: theme.textSecondary }]}>$</Text>
                                                <TextInput
                                                    style={[styles.input, { color: theme.textPrimary }]}
                                                    value={priceInput}
                                                    onChangeText={onPriceChange}
                                                    keyboardType="decimal-pad"
                                                    placeholder="0.00"
                                                    placeholderTextColor="rgba(255,255,255,0.30)"
                                                    editable={!modalSaving}
                                                />
                                                {modalUnit ? (
                                                    <Text style={[styles.inputSuffix, { color: theme.textSecondary }]}>
                                                        {`/${unitLabel(modalUnit)}`}
                                                    </Text>
                                                ) : null}
                                            </View>
                                            <Text style={[styles.priceHint, { color: theme.textSecondary }]}>
                                                {tr('providerOnboarding.priceHint') || 'Set it now to start receiving offers right away.'}
                                            </Text>
                                        </View>
                                    ) : modalIsContract ? (
                                        <Text style={[styles.noteText, { color: theme.textSecondary }]}>
                                            {tr('myPricesScreen.contractNote')}
                                        </Text>
                                    ) : modalIsCustomQuote ? (
                                        <Text style={[styles.noteText, { color: theme.textSecondary }]}>
                                            {tr('myPricesScreen.customBody') || 'Quoted per job — agreed with the customer before the job starts.'}
                                        </Text>
                                    ) : managedByCompany ? (
                                        <Text style={[styles.noteText, { color: theme.textSecondary }]}>
                                            {tr('myPricesScreen.companyManagedBody')}
                                        </Text>
                                    ) : null}

                                    {modalError ? (
                                        <Text style={[styles.modalError, { color: Colors.warning }]}>{modalError}</Text>
                                    ) : null}

                                    <View style={styles.modalActions}>
                                        {modalSelected ? (
                                            <Pressable onPress={handleRemove} disabled={modalSaving} hitSlop={8}>
                                                <Text style={[styles.removeText, { color: theme.textSecondary }]}>
                                                    {tr('providerOnboarding.remove') || 'Remove service'}
                                                </Text>
                                            </Pressable>
                                        ) : (
                                            <View />
                                        )}
                                        <View style={styles.modalButtons}>
                                            <GlassButton
                                                title={tr('common.cancel') || 'Cancel'}
                                                variant="outline"
                                                onPress={closeModal}
                                                disabled={modalSaving}
                                                style={styles.modalBtn}
                                            />
                                            <GlassButton
                                                title={tr('myPricesScreen.save') || 'Save'}
                                                variant="glow"
                                                onPress={handleModalSave}
                                                loading={modalSaving}
                                                disabled={modalSaving || modalLoading}
                                                style={styles.modalBtn}
                                            />
                                        </View>
                                    </View>
                                </>
                            )
                        )}
                    </View>
                </KeyboardAvoidingView>
            </Modal>
        </Screen>
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
    taskPrice: {
        fontSize: 12,
        fontWeight: '700',
        color: 'rgba(180, 150, 255, 1)',
        marginTop: 2,
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

    // ── Modal ─────────────────────────────────────────────────
    modalRoot: {
        flex: 1,
    },
    modalBackdrop: {
        flex: 1,
        backgroundColor: 'rgba(0, 0, 0, 0.60)',
    },
    modalCard: {
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        borderWidth: StyleSheet.hairlineWidth,
        paddingHorizontal: 20,
        paddingTop: 20,
        paddingBottom: 28,
        maxHeight: '88%',
    },
    modalLoading: {
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 40,
        gap: 12,
    },
    modalLoadingText: {
        fontSize: 13,
    },
    modalHeader: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 12,
    },
    modalTitle: {
        flex: 1,
        fontSize: 20,
        fontWeight: '700',
    },
    modalClose: {
        fontSize: 18,
        fontWeight: '600',
        lineHeight: 24,
    },
    modalChips: {
        flexDirection: 'row',
        gap: 8,
        marginTop: 10,
    },
    modalChip: {
        borderWidth: 1,
        borderRadius: 8,
        paddingHorizontal: 8,
        paddingVertical: 4,
    },
    modalChipText: {
        fontSize: 11,
        fontWeight: '700',
        letterSpacing: 0.4,
    },
    modalScroll: {
        maxHeight: 200,
        marginTop: 12,
    },
    modalDesc: {
        fontSize: 14,
        lineHeight: 20,
    },
    priceSection: {
        marginTop: 16,
    },
    priceLabel: {
        fontSize: 15,
        fontWeight: '700',
    },
    rangeHint: {
        fontSize: 12,
        marginTop: 2,
    },
    inputBox: {
        flexDirection: 'row',
        alignItems: 'center',
        borderWidth: 1,
        borderRadius: 12,
        paddingHorizontal: 14,
        paddingVertical: 12,
        marginTop: 10,
        backgroundColor: 'rgba(255, 255, 255, 0.05)',
    },
    inputPrefix: {
        fontSize: 18,
        fontWeight: '700',
        marginRight: 4,
    },
    input: {
        flex: 1,
        fontSize: 18,
        fontWeight: '600',
        padding: 0,
    },
    inputSuffix: {
        fontSize: 12,
        fontWeight: '600',
    },
    priceHint: {
        fontSize: 12,
        marginTop: 8,
    },
    noteText: {
        fontSize: 14,
        lineHeight: 20,
        marginTop: 16,
    },
    modalError: {
        fontSize: 13,
        fontWeight: '600',
        marginTop: 12,
    },
    modalActions: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        marginTop: 20,
    },
    removeText: {
        fontSize: 13,
        fontWeight: '600',
        textDecorationLine: 'underline',
    },
    modalButtons: {
        flexDirection: 'row',
        gap: 10,
        flex: 1,
        justifyContent: 'flex-end',
    },
    modalBtn: {
        flex: 1,
    },
});
