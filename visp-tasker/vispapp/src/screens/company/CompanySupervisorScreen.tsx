/**
 * VISP for Business — Company Supervisor Screen (SP4 Stage 2)
 *
 * For a user whose company role is admin or supervisor. Shows the company's
 * claimable jobs with a Claim action. After claiming (status CLAIMED), an
 * Assign action opens the eligible-collaborators list (only collaborators with
 * the required credential, enforced server-side) and assigns the chosen one.
 * Statuses are reflected per job.
 *
 * ADDITIVE — consumes the company_assignments endpoints only. Does NOT touch
 * the provider offer/matching flow. Styling mirrors the editorial restyled
 * screens (components/visp + theme/visp), not the dark-glass Login style.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';

import { useTranslation } from '../../i18n';
import {
  Screen,
  ScreenTitle,
  Eyebrow,
  Card,
  Chip,
  Icon,
} from '../../components/visp';
import {
  useVispTheme,
  VispText,
  VispSpace,
  VispRadius,
} from '../../theme/visp';
import { useCompanyStore } from '../../stores/companyStore';
import {
  companyService,
  ClaimableJob,
  CompanyAssignment,
  EligibleCollaborator,
} from '../../services/companyService';

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

interface ApiLikeError {
  message?: string;
  statusCode?: number;
}

function errorMessage(err: unknown, fallback: string): string {
  if (err && typeof err === 'object' && 'message' in err) {
    const m = (err as ApiLikeError).message;
    if (typeof m === 'string' && m.length > 0) return m;
  }
  return fallback;
}

// ──────────────────────────────────────────────
// Assign-collaborator modal
// ──────────────────────────────────────────────

function AssignModal({
  visible,
  collaborators,
  loading,
  submittingId,
  onPick,
  onClose,
}: {
  visible: boolean;
  collaborators: EligibleCollaborator[];
  loading: boolean;
  submittingId: string | null;
  onPick: (c: EligibleCollaborator) => void;
  onClose: () => void;
}): React.JSX.Element {
  const t = useVispTheme();
  const { t: tr } = useTranslation();

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={modalStyles.backdrop}>
        <View style={[modalStyles.sheet, { backgroundColor: t.bg, borderColor: t.border }]}>
          <View style={modalStyles.headerRow}>
            <Text style={[VispText.bodyStrong, { color: t.text, fontSize: 15 }]}>
              {tr('companySupervisor.assignTitle') || 'Assign collaborator'}
            </Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <Icon name="x" size={18} color={t.text2} />
            </Pressable>
          </View>

          {loading ? (
            <View style={modalStyles.center}>
              <ActivityIndicator color={t.violet} />
            </View>
          ) : collaborators.length === 0 ? (
            <View style={modalStyles.center}>
              <Text style={[VispText.body, { color: t.text3, textAlign: 'center' }]}>
                {tr('companySupervisor.noEligible') ||
                  'No eligible collaborators for this task. Only active collaborators with the required credential can be assigned.'}
              </Text>
            </View>
          ) : (
            <FlatList
              data={collaborators}
              keyExtractor={(c) => c.userId}
              contentContainerStyle={{ paddingBottom: 8 }}
              renderItem={({ item }) => {
                const busy = submittingId === item.userId;
                return (
                  <Pressable
                    disabled={submittingId !== null}
                    onPress={() => onPick(item)}
                    style={[
                      modalStyles.collabRow,
                      { borderColor: t.border, backgroundColor: t.card },
                    ]}
                  >
                    <View style={[modalStyles.iconBox, { backgroundColor: t.deep, borderColor: t.border }]}>
                      <Icon name="user" size={16} color={t.text2} />
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={[VispText.bodyStrong, { color: t.text }]} numberOfLines={1}>
                        {item.email || item.userId.slice(0, 8)}
                      </Text>
                      {item.hasRequiredCredential ? (
                        <Text style={[VispText.eyebrow, { color: t.text3, marginTop: 3 }]}>
                          {tr('companySupervisor.credentialOk') || 'CREDENTIAL VERIFIED'}
                        </Text>
                      ) : null}
                    </View>
                    {busy ? (
                      <ActivityIndicator color={t.violet} />
                    ) : (
                      <Icon name="chevron-right" size={16} color={t.text3} />
                    )}
                  </Pressable>
                );
              }}
            />
          )}
        </View>
      </View>
    </Modal>
  );
}

// ──────────────────────────────────────────────
// Job row
// ──────────────────────────────────────────────

function JobRow({
  job,
  assignment,
  claiming,
  onClaim,
  onAssign,
}: {
  job: ClaimableJob;
  assignment: CompanyAssignment | undefined;
  claiming: boolean;
  onClaim: () => void;
  onAssign: () => void;
}): React.JSX.Element {
  const t = useVispTheme();
  const { t: tr } = useTranslation();

  const meta = [job.serviceCity, job.requestedDate].filter(Boolean).join(' · ');
  const status = assignment?.status;

  let statusLabel: string | null = null;
  if (status === 'assigned') statusLabel = tr('companyAssignments.statusAssigned') || 'ASSIGNED';
  else if (status === 'accepted') statusLabel = tr('companyAssignments.statusAccepted') || 'ACCEPTED';
  else if (status === 'declined') statusLabel = tr('companyAssignments.statusDeclined') || 'DECLINED';
  else if (status === 'claimed') statusLabel = tr('companySupervisor.statusClaimed') || 'CLAIMED';

  return (
    <View style={[cardStyles.card, { backgroundColor: t.card, borderColor: t.border }]}>
      <View style={cardStyles.row}>
        <View style={[cardStyles.iconBox, { backgroundColor: t.deep, borderColor: t.border }]}>
          <Icon name="briefcase" size={16} color={t.text2} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[VispText.bodyStrong, { color: t.text, fontSize: 14 }]} numberOfLines={1}>
            {job.taskName || job.referenceNumber}
          </Text>
          <Text style={[VispText.eyebrow, { color: t.text3, marginTop: 3 }]} numberOfLines={1}>
            {meta || job.referenceNumber}
          </Text>
        </View>
        {statusLabel ? <Chip>{statusLabel}</Chip> : null}
      </View>

      <View style={[cardStyles.actionsRow, { borderTopColor: t.border }]}>
        {!assignment ? (
          <Pressable onPress={onClaim} disabled={claiming} style={{ flex: 1 }}>
            <View style={[cardStyles.primaryBtn, { backgroundColor: t.text, opacity: claiming ? 0.6 : 1 }]}>
              {claiming ? (
                <ActivityIndicator color={t.bg} size="small" />
              ) : (
                <Text style={[VispText.bodyStrong, { color: t.bg, fontSize: 12.5 }]}>
                  {tr('companySupervisor.claim') || 'Claim'}
                </Text>
              )}
            </View>
          </Pressable>
        ) : status === 'claimed' || status === 'declined' ? (
          <Pressable onPress={onAssign} style={{ flex: 1 }}>
            <View style={[cardStyles.primaryBtn, { backgroundColor: t.text }]}>
              <Text style={[VispText.bodyStrong, { color: t.bg, fontSize: 12.5 }]}>
                {tr('companySupervisor.assign') || 'Assign'}
              </Text>
            </View>
          </Pressable>
        ) : (
          <View style={[cardStyles.primaryBtn, { backgroundColor: t.deep, borderColor: t.border, borderWidth: 1 }]}>
            <Text style={[VispText.chip, { color: t.text3 }]}>
              {tr('companySupervisor.reassign') || 'Reassign unavailable'}
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}

// ──────────────────────────────────────────────
// Main component
// ──────────────────────────────────────────────

export default function CompanySupervisorScreen(): React.JSX.Element {
  const t = useVispTheme();
  const { t: tr } = useTranslation();
  const membership = useCompanyStore((s) => s.membership);
  const membershipLoading = useCompanyStore((s) => s.isLoading);
  const membershipLoaded = useCompanyStore((s) => s.hasLoaded);
  const refreshMembership = useCompanyStore((s) => s.refreshMembership);
  const companyId = membership?.companyId ?? null;

  const [jobs, setJobs] = useState<ClaimableJob[]>([]);
  // assignment keyed by jobId (jobs we have claimed)
  const [assignments, setAssignments] = useState<Record<string, CompanyAssignment>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // True when the message is a "no company" state rather than a real error, so
  // the empty card uses a neutral title instead of "Something went wrong".
  const [noCompany, setNoCompany] = useState(false);
  const [claimingJobId, setClaimingJobId] = useState<string | null>(null);

  // Assign modal state
  const [assignJobId, setAssignJobId] = useState<string | null>(null);
  const [eligible, setEligible] = useState<EligibleCollaborator[]>([]);
  const [eligibleLoading, setEligibleLoading] = useState(false);
  const [submittingCollabId, setSubmittingCollabId] = useState<string | null>(null);

  const load = useCallback(async () => {
    // Wait for company membership to resolve before hitting the API. Calling
    // listClaimableJobs(undefined) would build a bad URL (/companies//...) and
    // surface as a generic error ("something went wrong"). If membership has
    // not been loaded yet, kick off a refresh and stay in the loading state;
    // the effect below re-runs `load` once membership resolves.
    if (!companyId) {
      if (!membershipLoaded && !membershipLoading) {
        void refreshMembership();
        return;
      }
      if (membershipLoading) {
        // Still resolving — keep the spinner, don't error.
        return;
      }
      // Membership finished loading and there is no company for this user.
      setLoading(false);
      setRefreshing(false);
      setNoCompany(true);
      setError(
        tr('companySupervisor.noCompany') ||
          'You are not part of a company yet.',
      );
      return;
    }
    setError(null);
    setNoCompany(false);
    try {
      const data = await companyService.listClaimableJobs(companyId);
      setJobs(data);
    } catch (err) {
      setError(errorMessage(err, tr('companySupervisor.loadError') || 'Could not load jobs.'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [companyId, membershipLoaded, membershipLoading, refreshMembership, tr]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    load();
  }, [load]);

  const handleClaim = useCallback(
    async (job: ClaimableJob) => {
      if (!companyId) return;
      setClaimingJobId(job.jobId);
      try {
        const assignment = await companyService.claimJob(companyId, job.jobId);
        setAssignments((prev) => ({ ...prev, [job.jobId]: assignment }));
      } catch (err) {
        Alert.alert(
          tr('companySupervisor.claimFailedTitle') || 'Could not claim',
          errorMessage(err, tr('companySupervisor.claimFailed') || 'This job could not be claimed.'),
        );
      } finally {
        setClaimingJobId(null);
      }
    },
    [companyId, tr],
  );

  const openAssign = useCallback(
    async (job: ClaimableJob) => {
      if (!companyId) return;
      setAssignJobId(job.jobId);
      setEligible([]);
      setEligibleLoading(true);
      try {
        const data = await companyService.listEligibleCollaborators(companyId, job.jobId);
        setEligible(data);
      } catch (err) {
        Alert.alert(
          tr('companySupervisor.eligibleFailedTitle') || 'Could not load collaborators',
          errorMessage(err, tr('companySupervisor.eligibleFailed') || 'Please try again.'),
        );
        setAssignJobId(null);
      } finally {
        setEligibleLoading(false);
      }
    },
    [companyId, tr],
  );

  const handlePickCollaborator = useCallback(
    async (collaborator: EligibleCollaborator) => {
      if (!companyId || !assignJobId) return;
      setSubmittingCollabId(collaborator.userId);
      try {
        const assignment = await companyService.assignJob(
          companyId,
          assignJobId,
          collaborator.userId,
        );
        setAssignments((prev) => ({ ...prev, [assignJobId]: assignment }));
        setAssignJobId(null);
      } catch (err) {
        Alert.alert(
          tr('companySupervisor.assignFailedTitle') || 'Could not assign',
          errorMessage(err, tr('companySupervisor.assignFailed') || 'Please try again.'),
        );
      } finally {
        setSubmittingCollabId(null);
      }
    },
    [companyId, assignJobId, tr],
  );

  return (
    <Screen>
      <ScreenTitle
        title={tr('companySupervisor.title') || 'Company jobs'}
        sub={membership?.companyName || (tr('companySupervisor.eyebrow') || '§ Supervisor')}
      />

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={t.violet} />
        </View>
      ) : (
        <FlatList
          data={jobs}
          keyExtractor={(j) => j.jobId}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.text2} />
          }
          ListHeaderComponent={
            <View style={{ marginBottom: 8 }}>
              <Eyebrow>{tr('companySupervisor.claimable') || 'Claimable jobs'}</Eyebrow>
            </View>
          }
          renderItem={({ item }) => (
            <JobRow
              job={item}
              assignment={assignments[item.jobId]}
              claiming={claimingJobId === item.jobId}
              onClaim={() => handleClaim(item)}
              onAssign={() => openAssign(item)}
            />
          )}
          ListEmptyComponent={
            <Card style={{ marginTop: 8 }}>
              <Text style={[VispText.bodyStrong, { color: t.text }]}>
                {noCompany
                  ? tr('companySupervisor.noCompanyTitle') || 'No company'
                  : error
                  ? tr('companySupervisor.errorTitle') || 'Something went wrong'
                  : tr('companySupervisor.emptyTitle') || 'No claimable jobs'}
              </Text>
              <Text style={[VispText.body, { color: t.text3, marginTop: 6 }]}>
                {error ||
                  (tr('companySupervisor.emptyBody') ||
                    'New jobs your company can claim will appear here.')}
              </Text>
            </Card>
          }
        />
      )}

      <AssignModal
        visible={assignJobId !== null}
        collaborators={eligible}
        loading={eligibleLoading}
        submittingId={submittingCollabId}
        onPick={handlePickCollaborator}
        onClose={() => setAssignJobId(null)}
      />
    </Screen>
  );
}

// ──────────────────────────────────────────────
// Styles
// ──────────────────────────────────────────────

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  listContent: {
    paddingHorizontal: VispSpace.gutter,
    paddingBottom: 40,
    flexGrow: 1,
  },
});

const cardStyles = StyleSheet.create({
  card: {
    borderRadius: VispRadius.card,
    borderWidth: 1,
    padding: 14,
    marginBottom: 8,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  iconBox: {
    width: 34,
    height: 34,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
  },
  primaryBtn: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
  },
});

const modalStyles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  sheet: {
    maxHeight: '75%',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderWidth: 1,
    paddingHorizontal: VispSpace.gutter,
    paddingTop: 16,
    paddingBottom: 28,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  center: { paddingVertical: 40, alignItems: 'center', justifyContent: 'center' },
  collabRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderRadius: VispRadius.card,
    padding: 12,
    marginBottom: 8,
  },
  iconBox: {
    width: 34,
    height: 34,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
