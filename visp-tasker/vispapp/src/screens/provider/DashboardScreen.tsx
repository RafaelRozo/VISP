/**
 * VISP - Provider Dashboard Screen
 *
 * Casa del proveedor: ganancias, trabajo activo, ofertas entrantes,
 * disponibilidad, camino a L1 y la ficha tal como la ve el cliente.
 *
 * Dos bloques se fueron el 2026-08-21 y conviene saber por qué:
 *   - El turno de guardia (on-call) colgaba del nivel 4, que se retiró del
 *     producto en la reestructuración de niveles. Ningún proveedor puede
 *     tenerlo, así que era una rama inalcanzable.
 *   - El Performance Score enseñaba un 0/100 fijo que el backend nunca calculó.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Image,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Colors } from '../../theme/colors';
import { GlassStyles } from '../../theme/glass';
import { useTheme } from '../../theme/ThemeContext';
import { useTranslation } from '../../i18n';
import { GlassCard, GlassButton } from '../../components/glass';
import { Screen, ScreenTitle, Chip, Icon } from '../../components/visp';
import { FontMono } from '../../theme/visp';
import { AnimatedSpinner, MorphingBlob } from '../../components/animations';
import { useProviderStore } from '../../stores/providerStore';
import { useAuthStore } from '../../stores/authStore';
import { useCompanyStore } from '../../stores/companyStore';
import JobCard from '../../components/JobCard';
import RoleSwitcher from '../../components/RoleSwitcher';
import { resolveAvatarUrl } from '../../services/userService';
import { taxonomyService } from '../../services/taxonomyService';
import { providerService } from '../../services/providerService';
import { ProviderTabParamList, ServiceLevel } from '../../types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type DashboardNav = NativeStackNavigationProp<ProviderTabParamList, 'Dashboard'>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatCurrency(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function DashboardScreen(): React.JSX.Element {
  const navigation = useNavigation<DashboardNav>();
  const user = useAuthStore((state) => state.user);
  const activeMode = useAuthStore((state) => state.activeMode);
  const setActiveMode = useAuthStore((state) => state.setActiveMode);
  const theme = useTheme();
  const { t } = useTranslation();

  // Track whether the provider has selected any services
  const [hasServices, setHasServices] = useState<boolean | null>(null);

  const {
    isOnline,
    activeJob,
    pendingOffers = [],
    earnings = { today: 0, thisWeek: 0, thisMonth: 0, pendingPayout: 0, totalEarned: 0 },
    providerProfile,
    isLoadingDashboard,
    isTogglingStatus,
    fetchDashboard,
    toggleOnline,
    declineOffer,
  } = useProviderStore();

  // Initial load
  useEffect(() => {
    fetchDashboard();
  }, [fetchDashboard]);

  // Re-check selected services every time the screen regains focus so the
  // "Complete Your Profile" CTA disappears right after the user saves
  // services in ProviderOnboarding and navigates back.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      taxonomyService.getMyServices()
        .then((res) => {
          if (!cancelled) setHasServices(res.taskIds.length > 0);
        })
        .catch(() => {
          if (!cancelled) setHasServices(null);
        });
      return () => {
        cancelled = true;
      };
    }, []),
  );

  // Pull-to-refresh
  const onRefresh = useCallback(() => {
    fetchDashboard();
  }, [fetchDashboard]);

  // User initials fallback for avatar
  const userInitials = useMemo(() => {
    const first = (user?.firstName?.[0] ?? '').toUpperCase();
    const last = (user?.lastName?.[0] ?? '').toUpperCase();
    return `${first}${last}` || '?';
  }, [user?.firstName, user?.lastName]);

  /**
   * Qué le falta al proveedor para llegar a L1.
   *
   * Sustituye al banner de "Helper — completa 10 trabajos con 4.5★ para
   * desbloquear el nivel 2", que decía dos cosas falsas: los niveles no se
   * desbloquean por número de trabajos (L1 se gana subiendo evidencia y que VISP
   * la valide), y el nivel 2 ni siquiera existe en esta beta.
   *
   * El estado sale de datos reales: la bio del perfil público y las piezas de
   * portfolio que ya están entre las credenciales del panel.
   */
  const portfolioCount = useMemo(
    () =>
      (providerProfile?.credentials ?? []).filter(
        (c) => c.type === 'portfolio' && c.status !== 'rejected',
      ).length,
    [providerProfile?.credentials],
  );

  const [bio, setBio] = useState<string | null>(null);

  useEffect(() => {
    // Se pide SIEMPRE, en todos los niveles.
    //
    // Antes solo si el proveedor era L0, para ahorrarse una llamada en el panel
    // de quien ya estaba validado. Pero esta misma `bio` alimenta dos cosas: la
    // lista de pasos que faltan para L1 —que en efecto solo interesa en L0— y la
    // tarjeta "How customers see you", que se enseña en todos los niveles. Al
    // ahorrarse la llamada para el resto, la tarjeta leía `null` y le decía a un
    // L1 con su bio escrita que no tenía bio. Le mentía sobre su propio perfil
    // en la pantalla cuyo único trabajo es enseñarle cómo lo ve el cliente.
    if (!providerProfile) return;
    let vivo = true;
    providerService
      .getPublicProfile(providerProfile.id)
      .then((perfil: { bio: string | null }) => {
        if (vivo) setBio(perfil.bio);
      })
      .catch(() => {
        /* Sin bio se pinta como pendiente; no vale la pena molestar por esto. */
      });
    return () => {
      vivo = false;
    };
    // Ya no depende del nivel: se pide para todos.
  }, [providerProfile?.id]);

  // Show level banner only when the provider has finished onboarding
  // (has at least one service selected). Until then the setup CTA does the job.
  const showLevelBanner = providerProfile != null && hasServices === true;

  // 'both' users get a Customer/Provider toggle in the header
  const isBoth = user?.role === 'both';

  // VISP for Business: company members log in as providers, so the dashboard
  // surfaces a "Company" entry. admin/supervisor -> the supervisor (claim/
  // assign) screen; collaborator -> their assignments screen. Non-members see
  // nothing. The CompanySupervisor/CompanyAssignments screens live on the root
  // stack, so we navigate via the parent navigator.
  const companyMembership = useCompanyStore((s) => s.membership);
  const isCompanySupervisor =
    companyMembership?.role === 'admin' || companyMembership?.role === 'supervisor';
  const handleCompanyPress = useCallback(() => {
    navigation.navigate(
      (isCompanySupervisor ? 'CompanySupervisor' : 'CompanyAssignments') as any,
    );
  }, [navigation, isCompanySupervisor]);

  // ------------------------------------------
  // Earnings summary section
  // ------------------------------------------

  const renderEarningsSummary = () => (
    <View style={styles.earningsWrapper}>
      <MorphingBlob
        size={200}
        color="#7850FF"
        opacity={0.12}
        style={styles.earningsBlob}
      />
      <GlassCard variant="standard" style={styles.earningsCard}>
        <Text style={[styles.sectionTitle, { color: theme.textPrimary }]}>{t('dashboard.earnings')}</Text>
        <View style={styles.earningsRow}>
          <View style={styles.earningsItem}>
            <Text style={[styles.earningsLabel, { color: theme.textSecondary }]}>{t('dashboard.today')}</Text>
            <Text style={[styles.earningsValue, { fontFamily: FontMono, color: theme.textPrimary, letterSpacing: -0.5 }]}>
              {formatCurrency(earnings.today)}
            </Text>
          </View>
          <View style={styles.earningsDivider} />
          <View style={styles.earningsItem}>
            <Text style={[styles.earningsLabel, { color: theme.textSecondary }]}>{t('dashboard.thisWeek')}</Text>
            <Text style={[styles.earningsValue, { fontFamily: FontMono, color: theme.textPrimary, letterSpacing: -0.5 }]}>
              {formatCurrency(earnings.thisWeek)}
            </Text>
          </View>
          <View style={styles.earningsDivider} />
          <View style={styles.earningsItem}>
            <Text style={[styles.earningsLabel, { color: theme.textSecondary }]}>{t('dashboard.thisMonth')}</Text>
            <Text style={[styles.earningsValue, { fontFamily: FontMono, color: theme.textPrimary, letterSpacing: -0.5 }]}>
              {formatCurrency(earnings.thisMonth)}
            </Text>
          </View>
        </View>
        <TouchableOpacity
          style={styles.viewAllButton}
          onPress={() => navigation.navigate('Earnings')}
          accessibilityRole="button"
          accessibilityLabel="View all earnings"
        >
          <Text style={styles.viewAllText}>{t('dashboard.viewAllEarnings')}</Text>
        </TouchableOpacity>
      </GlassCard>
    </View>
  );

  // ------------------------------------------
  // Performance score section
  // ------------------------------------------

  /**
   * Camino a L1, con estado real.
   *
   * En esta beta solo existen dos escalones, así que la tarjeta tiene dos caras:
   * al que aún no está validado le dice exactamente qué le falta y le lleva
   * allí de un toque; al validado le confirma que puede ofertar y se calla.
   *
   * Fuera los nombres comerciales ("Helper", "Experienced"): no aportaban nada y
   * prometían una escalera que en esta versión no existe.
   */
  const renderLevelCard = () => {
    if (!providerProfile) return null;

    const nivel = providerProfile.level;

    if (nivel > 0) {
      return (
        <View style={[styles.levelBanner, { borderColor: `${Colors.success}55`, backgroundColor: `${Colors.success}12` }]}>
          <View style={[styles.levelChipSmall, { backgroundColor: `${Colors.success}30`, borderColor: Colors.success }]}>
            <Text style={[styles.levelChipSmallText, { color: Colors.success }]}>L{nivel}</Text>
          </View>
          <View style={styles.levelBannerInfo}>
            <Text style={[styles.levelBannerTitle, { color: theme.textPrimary }]}>
              {t('dashboard.verifiedTitle') || 'Verified'}
            </Text>
            <Text style={[styles.levelBannerMsg, { color: theme.textSecondary }]}>
              {t('dashboard.verifiedMsg') ||
                'You can offer on jobs for the services you set up.'}
            </Text>
          </View>
        </View>
      );
    }

    const pasos = [
      {
        hecho: (bio ?? '').trim().length > 0,
        label: t('dashboard.stepBio') || 'Write your bio',
        hint: t('dashboard.stepBioHint') || 'The first thing a customer reads on your offer.',
        ir: () => navigation.navigate('ProviderProfile' as any),
      },
      {
        hecho: portfolioCount >= 3,
        label: (t('dashboard.stepPortfolio') || 'Add 3 photos of your work')
          .replace('{n}', String(portfolioCount)),
        hint: portfolioCount > 0
          ? (t('dashboard.stepPortfolioSome') || '{n} of 3 uploaded.').replace('{n}', String(portfolioCount))
          : t('dashboard.stepPortfolioHint') || 'Past jobs, before and after — whatever shows the work.',
        ir: () => navigation.navigate('ProviderProfile' as any, { screen: 'Credentials' }),
      },
      {
        hecho: hasServices === true,
        label: t('dashboard.stepServices') || 'Pick your services and set your price',
        hint: t('dashboard.stepServicesHint') || 'You cannot receive jobs without them.',
        ir: () => navigation.navigate('ProviderProfile' as any, { screen: 'ProviderOnboarding' }),
      },
    ];

    const faltan = pasos.filter((p) => !p.hecho).length;
    const enviado = faltan === 0;

    return (
      <View style={[styles.levelBanner, styles.levelCard, { borderColor: `${Colors.primary}55`, backgroundColor: `${Colors.primary}10` }]}>
        <View style={styles.levelCardHead}>
          <View style={[styles.levelChipSmall, { backgroundColor: `${Colors.primary}30`, borderColor: Colors.primary }]}>
            <Text style={[styles.levelChipSmallText, { color: Colors.primary }]}>L0</Text>
          </View>
          <View style={styles.levelBannerInfo}>
            <Text style={[styles.levelBannerTitle, { color: theme.textPrimary }]}>
              {enviado
                ? t('dashboard.inReviewTitle') || 'In review'
                : t('dashboard.toL1Title') || 'Get verified to receive more work'}
            </Text>
            <Text style={[styles.levelBannerMsg, { color: theme.textSecondary }]}>
              {enviado
                ? t('dashboard.inReviewMsg') ||
                  'We are checking your documents. We will let you know as soon as it is done.'
                : t('dashboard.toL1Msg') ||
                  'Send us this and we verify your profile. It is your documents we check, not your skill.'}
            </Text>
          </View>
        </View>

        {!enviado ? (
          <View style={styles.stepList}>
            {pasos.map((p) => (
              <Pressable
                key={p.label}
                onPress={p.hecho ? undefined : p.ir}
                disabled={p.hecho}
                style={styles.stepRow}
                accessibilityRole={p.hecho ? undefined : 'button'}
                accessibilityLabel={p.label}
              >
                <View
                  style={[
                    styles.stepBox,
                    {
                      borderColor: p.hecho ? Colors.success : theme.textTertiary,
                      backgroundColor: p.hecho ? Colors.success : 'transparent',
                    },
                  ]}
                >
                  {p.hecho ? <Text style={styles.stepTick}>✓</Text> : null}
                </View>
                <View style={styles.stepText}>
                  <Text
                    style={[
                      styles.stepLabel,
                      { color: p.hecho ? theme.textSecondary : theme.textPrimary },
                    ]}
                  >
                    {p.label}
                  </Text>
                  {!p.hecho ? (
                    <Text style={[styles.stepHint, { color: theme.textSecondary }]}>{p.hint}</Text>
                  ) : null}
                </View>
              </Pressable>
            ))}
          </View>
        ) : null}
      </View>
    );
  };

  /**
   * "Así te ven los clientes" — sustituye al Performance Score.
   *
   * El marcador se va por dos razones. Una: era MENTIRA. El backend devolvía
   * `performanceScore: 0` fijo y la propia tarjeta lo confesaba en letra
   * pequeña ("not yet wired to live data"), así que enseñaba un 0/100 en rojo a
   * proveedores que no habían hecho nada malo. Dos: con las ofertas, la
   * puntuación interna de ranking dejó de decidir nada — el cliente ve varias
   * ofertas y elige. Lo que pesa es lo que aparece en la tarjeta de oferta.
   *
   * Así que esta tarjeta enseña EXACTAMENTE eso: el nombre, las estrellas, los
   * trabajos hechos y la bio, tal como los lee el cliente al comparar. Un
   * proveedor que ve su propia ficha vacía entiende qué le falta sin que nadie
   * se lo explique.
   */
  const renderCustomerView = () => {
    if (!providerProfile) return null;

    const valorada = providerProfile.rating > 0;
    const nombre = [user?.firstName, user?.lastName].filter(Boolean).join(' ') || 'Provider';

    return (
      <GlassCard variant="standard" style={styles.performanceCard}>
        <Text style={[styles.sectionTitle, { color: theme.textPrimary }]}>
          {t('dashboard.customerView') || 'How customers see you'}
        </Text>

        <View style={styles.customerCard}>
          {(() => {
            const uri = resolveAvatarUrl(user?.avatarUrl);
            return uri ? (
              <Image source={{ uri }} style={styles.customerAvatar} />
            ) : (
              <View style={[styles.customerAvatar, styles.avatarFallback]}>
                <Text style={styles.avatarInitials}>{userInitials}</Text>
              </View>
            );
          })()}
          <View style={styles.customerCardInfo}>
            <Text style={[styles.customerName, { color: theme.textPrimary }]} numberOfLines={1}>
              {nombre}
            </Text>
            <View style={styles.customerStats}>
              <Text style={[styles.customerStat, { color: valorada ? theme.textPrimary : theme.textSecondary }]}>
                {valorada
                  ? `★ ${providerProfile.rating.toFixed(1)}`
                  : t('dashboard.noRatingYet') || '★ No rating yet'}
              </Text>
              <Text style={[styles.customerStat, { color: theme.textSecondary }]}>
                {providerProfile.completedJobs === 1
                  ? t('dashboard.oneJobDone') || '1 job done'
                  : (t('dashboard.jobsDone') || '{n} jobs done').replace(
                      '{n}',
                      String(providerProfile.completedJobs),
                    )}
              </Text>
            </View>
          </View>
        </View>

        <Text style={[styles.customerBio, { color: bio ? theme.textSecondary : theme.textTertiary }]} numberOfLines={3}>
          {bio ||
            t('dashboard.bioEmpty') ||
            'You have not written a bio yet. It is the first thing customers read when they compare offers.'}
        </Text>

        {/* El primer trabajo es el que rompe el empate: sin estrellas, lo único
            que el cliente puede juzgar es la bio y el precio. Decirlo evita que
            un cero se lea como un castigo. */}
        {!valorada ? (
          <Text style={[styles.customerHint, { color: theme.textSecondary }]}>
            {t('dashboard.firstJobHint') ||
              'Ratings start after your first completed job. Until then, a clear bio and a fair price are what win offers.'}
          </Text>
        ) : null}
      </GlassCard>
    );
  };

  // ------------------------------------------
  // Availability toggle section
  // ------------------------------------------

  const renderAvailabilityToggle = () => (
    <GlassCard variant="dark" style={styles.availabilityCard}>
      <View style={styles.availabilityRow}>
        <View style={styles.availabilityInfo}>
          <View style={styles.availabilityLabelRow}>
            <View
              style={[
                styles.onlineDot,
                {
                  backgroundColor: isOnline
                    ? Colors.success
                    : Colors.textTertiary,
                  ...(isOnline
                    ? {
                        shadowColor: Colors.success,
                        shadowOffset: { width: 0, height: 0 },
                        shadowOpacity: 0.8,
                        shadowRadius: 6,
                      }
                    : {}),
                },
              ]}
            />
            <Text style={[styles.availabilityTitle, { color: theme.textPrimary }]}>
              {isOnline ? t('dashboard.online') : t('dashboard.offline')}
            </Text>
          </View>
          <Text style={[styles.availabilitySubtext, { color: theme.textSecondary }]}>
            {isOnline
              ? t('dashboard.receivingOffers')
              : t('dashboard.notReceivingOffers')}
          </Text>
        </View>
        {isTogglingStatus ? (
          <AnimatedSpinner size={28} color={Colors.primary} />
        ) : (
          <Switch
            value={isOnline}
            onValueChange={toggleOnline}
            trackColor={{
              false: 'rgba(255, 255, 255, 0.15)',
              true: Colors.success,
            }}
            thumbColor={Colors.white}
            ios_backgroundColor="rgba(255, 255, 255, 0.15)"
            accessibilityLabel="Toggle online status"
            accessibilityRole="switch"
          />
        )}
      </View>
    </GlassCard>
  );

  // ------------------------------------------
  // Active job section
  // ------------------------------------------

  const renderActiveJob = () => {
    if (!activeJob) return null;

    return (
      <View style={styles.section}>
        <Text style={[styles.sectionTitleOuter, { color: theme.textPrimary }]}>{t('dashboard.activeJob')}</Text>
        <GlassCard variant="elevated" style={styles.activeJobCard}>
          <JobCard
            taskName={activeJob.taskName}
            categoryName={activeJob.categoryName}
            customerArea={activeJob.address.city}
            distanceKm={0}
            estimatedPrice={activeJob.estimatedPrice}
            level={activeJob.level}
            status={activeJob.status}
            scheduledAt={activeJob.scheduledAt}
            slaDeadline={activeJob.slaDeadline}
            onPress={() =>
              navigation.navigate('JobsTab' as any, {
                screen: 'ActiveJob',
                params: { jobId: activeJob.id },
              })
            }
          />
        </GlassCard>
      </View>
    );
  };

  // ------------------------------------------
  // Pending offers section
  // ------------------------------------------

  const renderPendingOffers = () => {
    const offers = Array.isArray(pendingOffers) ? pendingOffers : [];
    if (offers.length === 0) return null;

    return (
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitleOuter, { color: theme.textPrimary }]}>{t('dashboard.pendingOffers')}</Text>
          <TouchableOpacity
            onPress={() => navigation.navigate('JobsTab')}
            accessibilityRole="button"
            accessibilityLabel="View all offers"
          >
            <Text style={styles.viewAllText}>
              {t('dashboard.viewAllEarnings')} ({offers.length})
            </Text>
          </TouchableOpacity>
        </View>
        {/* Resumen de la bolsa (ofertas v2, 2026-08-20).

            Antes aquí se aceptaba o rechazaba un trabajo desde el dashboard. Ya no
            se puede: ofertar exige aportar tiempo y, si lleva material, importe y
            justificación. Eso no cabe en una tarjeta de resumen, así que el
            dashboard solo enseña qué hay y lleva a la bolsa. */}
        {offers.slice(0, 3).map((job) => (
          <TouchableOpacity
            key={job.jobId}
            onPress={() => navigation.navigate('JobsTab')}
            activeOpacity={0.7}
          >
            <GlassCard variant="standard" style={styles.offerCard}>
              <Text style={styles.offerTitle}>{job.serviceName}</Text>
              <Text style={styles.offerMeta}>
                {[
                  job.city,
                  job.requestedDate,
                  job.materialsRequested ? t('jobOffers.materialsNeeded') || 'Materials needed' : null,
                  job.canOffer
                    ? null
                    : t('jobOffers.setRateShort') || 'Set your price first',
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
            </GlassCard>
          </TouchableOpacity>
        ))}
      </View>
    );
  };

  // ------------------------------------------
  // Setup services prompt
  // ------------------------------------------

  const renderSetupServicesPrompt = () => {
    if (hasServices !== false) return null;
    return (
      <GlassCard variant="elevated" style={styles.setupCard}>
        <Text style={styles.setupIcon}>&#x2699;&#xFE0F;</Text>
        <Text style={[styles.setupTitle, { color: theme.textPrimary }]}>{t('dashboard.setupServices')}</Text>
        <Text style={[styles.setupText, { color: theme.textSecondary }]}>
          {t('dashboard.setupText')}
        </Text>
        <GlassButton
          title={t('dashboard.selectMyServices')}
          variant="glow"
          onPress={() => navigation.navigate('ProviderProfile' as any, { screen: 'ProviderOnboarding' })}
        />
      </GlassCard>
    );
  };

  // ------------------------------------------
  // Company entry (VISP for Business) — only for company members
  // ------------------------------------------

  const renderCompanyEntry = () => {
    if (!companyMembership) return null;
    return (
      <TouchableOpacity
        activeOpacity={0.85}
        onPress={handleCompanyPress}
        accessibilityRole="button"
        accessibilityLabel={isCompanySupervisor ? 'Company jobs' : 'My assignments'}
      >
        <GlassCard variant="standard" style={styles.companyCard}>
          <View style={styles.companyRow}>
            <View style={styles.companyIcon}>
              <Icon name="briefcase" size={18} color={Colors.primary} />
            </View>
            <View style={styles.companyInfo}>
              <Text style={[styles.companyTitle, { color: theme.textPrimary }]} numberOfLines={1}>
                {isCompanySupervisor
                  ? t('companySupervisor.entry') || 'Company jobs'
                  : t('companyAssignments.entry') || 'My assignments'}
              </Text>
              <Text
                style={[styles.companySubtext, { color: theme.textSecondary }]}
                numberOfLines={1}
              >
                {String(companyMembership.companyName).toUpperCase()}
              </Text>
            </View>
            <Icon name="chevron-right" size={18} color={theme.textSecondary} />
          </View>
        </GlassCard>
      </TouchableOpacity>
    );
  };

  // ------------------------------------------
  // Main render
  // ------------------------------------------

  if (isLoadingDashboard && !providerProfile) {
    return (
      <Screen>
        <ScreenTitle title={t('nav.dashboard')} sub="§ Provider" />
        <View style={styles.loadingContainer}>
          <AnimatedSpinner size={48} color={Colors.primary} />
          <Text style={[styles.loadingText, { color: theme.textSecondary }]}>{t('common.loading')}</Text>
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <ScreenTitle title={t('nav.dashboard')} sub="§ Provider" />
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.contentContainer}
        refreshControl={
          <RefreshControl
            refreshing={isLoadingDashboard}
            onRefresh={onRefresh}
            tintColor={Colors.primary}
            colors={[Colors.primary]}
          />
        }
      >
        {/* Welcome card: avatar + greeting + stats. Mode switch for 'both' users. */}
        <GlassCard variant="dark" style={styles.welcomeCard}>
          <View style={styles.welcomeRow}>
            {/* Avatar (real image or initials fallback) */}
            <View style={styles.avatarWrap}>
              {(() => {
                // Use the same resolver Profile uses so relative paths like
                // "/uploads/avatars/xyz.jpg" become absolute URLs the Image
                // component can actually load.
                const avatarUri = resolveAvatarUrl(user?.avatarUrl);
                return avatarUri ? (
                  <Image source={{ uri: avatarUri }} style={styles.avatarImage} />
                ) : (
                  <View style={styles.avatarFallback}>
                    <Text style={styles.avatarInitials}>{userInitials}</Text>
                  </View>
                );
              })()}
            </View>

            <View style={styles.welcomeInfo}>
              <Text
                style={[styles.welcomeGreeting, { color: theme.textPrimary }]}
                numberOfLines={1}
              >
                {t('dashboard.welcomeBack', { name: user?.firstName || '' })}
              </Text>
              {providerProfile && (
                <View style={styles.welcomeStatsRow}>
                  <View style={styles.welcomeStat}>
                    <Text style={styles.welcomeStatIcon}>💼</Text>
                    <Text style={[styles.welcomeStatText, { color: theme.textSecondary }]}>
                      {t('dashboard.statsJobs', { count: providerProfile.completedJobs })}
                    </Text>
                  </View>
                  <View style={styles.welcomeStatDot} />
                  <View style={styles.welcomeStat}>
                    <Text style={[styles.welcomeStatIcon, { color: '#FFCC4D' }]}>★</Text>
                    <Text style={[styles.welcomeStatText, { color: theme.textSecondary }]}>
                      {providerProfile.rating.toFixed(1)}
                    </Text>
                  </View>
                </View>
              )}
            </View>
          </View>

          {/* Mode switcher: only for 'both' users */}
          {isBoth && (
            <View style={styles.modeSwitcherWrap}>
              <RoleSwitcher
                mode={activeMode}
                onChange={(m) => void setActiveMode(m)}
              />
            </View>
          )}
        </GlassCard>

        {renderCompanyEntry()}

        {renderSetupServicesPrompt()}

        {showLevelBanner && renderLevelCard()}

        {renderAvailabilityToggle()}


        {renderEarningsSummary()}
        {renderCustomerView()}
        {renderActiveJob()}
        {renderPendingOffers()}

        {/* Bottom spacer */}
        <View style={styles.bottomSpacer} />
      </ScrollView>
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  contentContainer: {
    // Sin esto el último elemento queda debajo de la tab bar / barra
    // de acción y no se puede alcanzar.
    paddingBottom: 40,
    paddingTop: 16,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.6)',
  },
  // --- Welcome card (avatar + greeting + mode switcher) ---
  welcomeCard: {
    marginHorizontal: 16,
    marginBottom: 12,
  },
  welcomeRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatarWrap: {
    marginRight: 14,
  },
  avatarImage: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  avatarFallback: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(120,80,255,0.22)',
    borderWidth: 2,
    borderColor: 'rgba(120,80,255,0.55)',
  },
  avatarInitials: {
    fontSize: 18,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 0.3,
  },
  welcomeInfo: {
    flex: 1,
    minWidth: 0,
  },
  welcomeGreeting: {
    fontSize: 18,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  welcomeStatsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    flexWrap: 'wrap',
  },
  welcomeStat: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  welcomeStatIcon: {
    fontSize: 13,
  },
  welcomeStatText: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.7)',
    fontWeight: '500',
  },
  welcomeStatDot: {
    width: 3,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: 'rgba(255,255,255,0.3)',
    marginHorizontal: 10,
  },
  // --- Mode switcher wrapper ---
  modeSwitcherWrap: {
    marginTop: 14,
    alignItems: 'center',
  },
  // --- Company entry (VISP for Business) ---
  companyCard: {
    marginHorizontal: 16,
    marginBottom: 12,
  },
  companyRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  companyIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(120,80,255,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(120,80,255,0.40)',
    marginRight: 12,
  },
  companyInfo: {
    flex: 1,
    minWidth: 0,
  },
  companyTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  companySubtext: {
    fontSize: 12,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.6)',
    marginTop: 2,
    letterSpacing: 0.3,
  },
  // --- Level progress banner ---
  levelCard: { flexDirection: 'column', alignItems: 'stretch', gap: 14 },
  levelCardHead: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  stepList: { gap: 12 },
  stepRow: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  stepBox: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  stepTick: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },
  stepText: { flex: 1, gap: 2 },
  stepLabel: { fontSize: 14, fontWeight: '600' as const, lineHeight: 19 },
  stepHint: { fontSize: 12, lineHeight: 16, marginTop: 1 },
  // Ficha tal como la ve el cliente
  customerCard: { flexDirection: 'row', gap: 12, alignItems: 'center', marginTop: 4 },
  customerAvatar: { width: 44, height: 44, borderRadius: 22 },
  customerCardInfo: { flex: 1, gap: 2 },
  customerName: { fontSize: 15, fontWeight: '600' as const },
  customerStats: { flexDirection: 'row', gap: 14 },
  customerStat: { fontSize: 13 },
  customerBio: { fontSize: 13, lineHeight: 18, marginTop: 12 },
  customerHint: { fontSize: 12, lineHeight: 17, marginTop: 10, fontStyle: 'italic' as const },
  levelBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginBottom: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  levelChipSmall: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    marginRight: 12,
  },
  levelChipSmallText: {
    fontSize: 13,
    fontWeight: '800',
  },
  levelBannerInfo: {
    flex: 1,
    minWidth: 0,
  },
  levelBannerTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 2,
  },
  levelBannerMsg: {
    fontSize: 12.5,
    color: 'rgba(255,255,255,0.7)',
    lineHeight: 17,
  },
  availabilityCard: {
    marginHorizontal: 16,
    marginBottom: 6,
  },
  availabilityRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  availabilityInfo: {
    flex: 1,
    marginRight: 12,
  },
  availabilityLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  onlineDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 8,
  },
  availabilityTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  availabilitySubtext: {
    fontSize: 13,
    color: 'rgba(255, 255, 255, 0.6)',
    marginTop: 4,
    marginLeft: 18,
  },
  earningsWrapper: {
    position: 'relative',
  },
  earningsBlob: {
    position: 'absolute',
    top: -40,
    right: -30,
    zIndex: 0,
  },
  earningsCard: {
    marginHorizontal: 16,
    marginVertical: 6,
    zIndex: 1,
  },
  earningsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 12,
    marginBottom: 12,
  },
  earningsItem: {
    flex: 1,
    alignItems: 'center',
  },
  earningsDivider: {
    width: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    marginVertical: 4,
  },
  earningsLabel: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.6)',
    marginBottom: 4,
  },
  earningsValue: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.success,
  },
  performanceCard: {
    marginHorizontal: 16,
    marginVertical: 6,
  },
  performanceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
  },
  scoreCircle: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 16,
  },
  scoreValue: {
    fontSize: 22,
    fontWeight: '800',
  },
  scoreMax: {
    fontSize: 11,
    color: 'rgba(255, 255, 255, 0.4)',
  },
  performanceInfo: {
    flex: 1,
  },
  performanceLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  performanceSubtext: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.4)',
    marginTop: 4,
    lineHeight: 16,
  },
  section: {
    marginTop: 12,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 4,
  },
  sectionTitleOuter: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  viewAllButton: {
    alignItems: 'center',
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255, 255, 255, 0.12)',
    marginTop: 4,
  },
  viewAllText: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.primary,
  },
  bottomSpacer: {
    height: 32,
  },
  // Setup services prompt
  setupCard: {
    marginHorizontal: 16,
    marginBottom: 16,
    alignItems: 'center' as const,
  },
  setupIcon: {
    fontSize: 36,
    marginBottom: 12,
  },
  setupTitle: {
    fontSize: 18,
    fontWeight: '700' as const,
    color: '#FFFFFF',
    marginBottom: 8,
  },
  setupText: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.6)',
    textAlign: 'center' as const,
    lineHeight: 20,
    marginBottom: 16,
  },
  // Active job card wrapper
  activeJobCard: {
    marginHorizontal: 16,
  },
  // Offer cards
  offerTitle: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: '#FFFFFF',
  },
  offerMeta: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.6)',
    marginTop: 4,
  },
  offerCard: {
    marginHorizontal: 16,
    marginBottom: 4,
  },
  offerActions: {
    flexDirection: 'row' as const,
    justifyContent: 'flex-end' as const,
    paddingHorizontal: 16,
    marginTop: 4,
    marginBottom: 12,
    gap: 10,
  },
  declineButton: {
    borderColor: 'rgba(231, 76, 60, 0.6)',
    minHeight: 38,
    paddingVertical: 8,
    paddingHorizontal: 20,
  },
  acceptButton: {
    minHeight: 38,
    paddingVertical: 8,
    paddingHorizontal: 24,
  },
});
