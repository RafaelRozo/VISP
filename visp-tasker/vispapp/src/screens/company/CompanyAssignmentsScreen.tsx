/**
 * VISP for Business — Company Assignments Screen (SP4 Stage 2)
 *
 * For a collaborator (company member with role COLLABORATOR). Lists the jobs
 * their supervisor assigned to them, with Accept / Decline actions on ASSIGNED
 * ones. Once ACCEPTED the assignment is shown as scheduled. Collaborators do
 * NOT browse services — they only receive assignments (server-enforced).
 *
 * ADDITIVE — consumes the company_assignments collaborator endpoints only.
 * Styling mirrors the editorial restyled screens (components/visp + theme/visp).
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
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
import {
  companyService,
  CompanyAssignment,
} from '../../services/companyService';

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

interface ApiLikeError {
  message?: string;
}

function errorMessage(err: unknown, fallback: string): string {
  if (err && typeof err === 'object' && 'message' in err) {
    const m = (err as ApiLikeError).message;
    if (typeof m === 'string' && m.length > 0) return m;
  }
  return fallback;
}

// ──────────────────────────────────────────────
// Assignment row
// ──────────────────────────────────────────────

function AssignmentRow({
  assignment,
  busy,
  onAccept,
  onDecline,
}: {
  assignment: CompanyAssignment;
  busy: boolean;
  onAccept: () => void;
  onDecline: () => void;
}): React.JSX.Element {
  const t = useVispTheme();
  const { t: tr } = useTranslation();

  const status = assignment.status;
  let statusLabel = tr('companyAssignments.statusAssigned') || 'ASSIGNED';
  let accent = false;
  if (status === 'accepted') {
    statusLabel = tr('companyAssignments.scheduled') || 'SCHEDULED';
    accent = true;
  } else if (status === 'declined') {
    statusLabel = tr('companyAssignments.statusDeclined') || 'DECLINED';
  } else if (status === 'claimed') {
    statusLabel = tr('companyAssignments.pending') || 'PENDING';
  }

  return (
    <View style={[cardStyles.card, { backgroundColor: t.card, borderColor: accent ? t.violetLine : t.border }]}>
      <View style={cardStyles.row}>
        <View style={[cardStyles.iconBox, { backgroundColor: accent ? t.violetDim : t.deep, borderColor: accent ? t.violetLine : t.border }]}>
          <Icon name={status === 'accepted' ? 'cal' : 'briefcase'} size={16} color={accent ? t.violet : t.text2} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[VispText.bodyStrong, { color: t.text, fontSize: 14 }]} numberOfLines={1}>
            {tr('companyAssignments.jobLabel') || 'Job'} {assignment.jobId.slice(0, 8)}
          </Text>
          <Text style={[VispText.eyebrow, { color: t.text3, marginTop: 3 }]} numberOfLines={1}>
            {tr('companyAssignments.assignedByCompany') || 'Assigned by your company'}
          </Text>
        </View>
        <Chip accent={accent}>{statusLabel}</Chip>
      </View>

      {assignment.status === 'declined' && assignment.declineReason ? (
        <Text style={[VispText.body, { color: t.text3, marginTop: 10 }]} numberOfLines={2}>
          {assignment.declineReason}
        </Text>
      ) : null}

      {assignment.status === 'assigned' ? (
        <View style={[cardStyles.actionsRow, { borderTopColor: t.border }]}>
          <Pressable onPress={onAccept} disabled={busy} style={{ flex: 1 }}>
            <View style={[cardStyles.primaryBtn, { backgroundColor: t.text, opacity: busy ? 0.6 : 1 }]}>
              {busy ? (
                <ActivityIndicator color={t.bg} size="small" />
              ) : (
                <Text style={[VispText.bodyStrong, { color: t.bg, fontSize: 12.5 }]}>
                  {tr('companyAssignments.accept') || 'Accept'}
                </Text>
              )}
            </View>
          </Pressable>
          <Pressable onPress={onDecline} disabled={busy}>
            <View style={[cardStyles.secondaryBtn, { borderColor: t.borderStrong }]}>
              <Text style={[VispText.chip, { color: t.text2 }]}>
                {tr('companyAssignments.decline') || 'DECLINE'}
              </Text>
            </View>
          </Pressable>
        </View>
      ) : assignment.status === 'accepted' ? (
        <View style={[cardStyles.scheduledRow, { borderTopColor: t.border }]}>
          <Icon name="check" size={14} color={t.violet} />
          <Text style={[VispText.eyebrow, { color: t.violet, marginLeft: 6 }]}>
            {tr('companyAssignments.scheduledNote') || 'ON YOUR SCHEDULE'}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

// ──────────────────────────────────────────────
// Main component
// ──────────────────────────────────────────────

export default function CompanyAssignmentsScreen(): React.JSX.Element {
  const t = useVispTheme();
  const { t: tr } = useTranslation();

  const [assignments, setAssignments] = useState<CompanyAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await companyService.listMyAssignments();
      setAssignments(data);
    } catch (err) {
      setError(errorMessage(err, tr('companyAssignments.loadError') || 'Could not load assignments.'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [tr]);

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

  const handleAccept = useCallback(
    async (assignment: CompanyAssignment) => {
      setBusyId(assignment.id);
      try {
        const updated = await companyService.acceptAssignment(assignment.id);
        setAssignments((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
      } catch (err) {
        Alert.alert(
          tr('companyAssignments.acceptFailedTitle') || 'Could not accept',
          errorMessage(err, tr('companyAssignments.acceptFailed') || 'Please try again.'),
        );
      } finally {
        setBusyId(null);
      }
    },
    [tr],
  );

  const handleDecline = useCallback(
    (assignment: CompanyAssignment) => {
      const doDecline = async () => {
        setBusyId(assignment.id);
        try {
          const updated = await companyService.declineAssignment(assignment.id);
          setAssignments((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
        } catch (err) {
          Alert.alert(
            tr('companyAssignments.declineFailedTitle') || 'Could not decline',
            errorMessage(err, tr('companyAssignments.declineFailed') || 'Please try again.'),
          );
        } finally {
          setBusyId(null);
        }
      };
      Alert.alert(
        tr('companyAssignments.declineConfirmTitle') || 'Decline assignment?',
        tr('companyAssignments.declineConfirmBody') ||
          'Your supervisor will be able to reassign this job.',
        [
          { text: tr('common.cancel') || 'Cancel', style: 'cancel' },
          {
            text: tr('companyAssignments.decline') || 'Decline',
            style: 'destructive',
            onPress: doDecline,
          },
        ],
      );
    },
    [tr],
  );

  return (
    <Screen>
      <ScreenTitle
        title={tr('companyAssignments.title') || 'My assignments'}
        sub={tr('companyAssignments.eyebrow') || '§ From your company'}
      />

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={t.violet} />
        </View>
      ) : (
        <FlatList
          data={assignments}
          keyExtractor={(a) => a.id}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.text2} />
          }
          ListHeaderComponent={
            <View style={{ marginBottom: 8 }}>
              <Eyebrow>{tr('companyAssignments.assigned') || 'Assigned to you'}</Eyebrow>
            </View>
          }
          renderItem={({ item }) => (
            <AssignmentRow
              assignment={item}
              busy={busyId === item.id}
              onAccept={() => handleAccept(item)}
              onDecline={() => handleDecline(item)}
            />
          )}
          ListEmptyComponent={
            <Card style={{ marginTop: 8 }}>
              <Text style={[VispText.bodyStrong, { color: t.text }]}>
                {error
                  ? tr('companyAssignments.errorTitle') || 'Something went wrong'
                  : tr('companyAssignments.emptyTitle') || 'No assignments yet'}
              </Text>
              <Text style={[VispText.body, { color: t.text3, marginTop: 6 }]}>
                {error ||
                  (tr('companyAssignments.emptyBody') ||
                    'Jobs your supervisor assigns to you will appear here.')}
              </Text>
            </Card>
          }
        />
      )}
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
  scheduledRow: {
    flexDirection: 'row',
    alignItems: 'center',
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
  },
  secondaryBtn: {
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: 6,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
