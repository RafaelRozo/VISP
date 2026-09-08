import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  adminService,
  CancellationReport,
  ExperienceRecord,
  InsurancePolicyRow,
  PendingCredential,
  SignedContractRow,
  LICENSE_CLASSES,
} from '@/services/adminService';
import { apiGetBlobUrl } from '@/services/apiClient';
import { Config } from '@/services/config';

function resolveDocUrl(url: string | null): string | null {
  if (!url) return null;
  if (url.startsWith('http')) return url;
  const origin = Config.mediaOrigin.replace(/\/$/, '');
  const path = url.startsWith('/') ? url : `/${url}`;
  return origin + path;
}

function inferMimeKind(url: string): 'image' | 'pdf' | 'other' {
  const u = url.toLowerCase().split('?')[0];
  if (u.endsWith('.pdf')) return 'pdf';
  if (/\.(png|jpe?g|gif|webp|heic|heif|bmp)$/.test(u)) return 'image';
  return 'other';
}

type LevelFilter = 'all' | '1' | '2' | '3' | '4';

export default function Documents() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectNote, setRejectNote] = useState('');
  const [previewItem, setPreviewItem] = useState<PendingCredential | null>(null);
  // Ontario licence class chosen at validation time, per credential id.
  const [licenseChoice, setLicenseChoice] = useState<Record<string, string>>({});

  // Filters
  const [search, setSearch] = useState('');
  const [credType, setCredType] = useState<string>('all');
  const [category, setCategory] = useState<string>('all');
  const [level, setLevel] = useState<LevelFilter>('all');

  // Tres colas de validación distintas. Viven juntas porque el trabajo del
  // validador es el mismo —mirar un documento y decidir— pero cada una escribe
  // en una tabla distinta y desbloquea cosas distintas.
  const [tab, setTab] = useState<
    'credentials' | 'experience' | 'insurance' | 'cancellations' | 'contracts'
  >('credentials');

  // El PDF firmado se baja como blob con el token del admin: el endpoint está
  // autenticado a propósito, así que un <iframe src> normal daría 401.
  const [contractPreview, setContractPreview] = useState<{
    row: SignedContractRow;
    url: string;
  } | null>(null);
  const [contractLoading, setContractLoading] = useState<string | null>(null);

  // Cada object-URL que no se libera se queda en memoria hasta recargar.
  useEffect(() => {
    return () => {
      if (contractPreview) URL.revokeObjectURL(contractPreview.url);
    };
  }, [contractPreview]);

  const qExperience = useQuery<ExperienceRecord[]>({
    queryKey: ['experience-records'],
    queryFn: () => adminService.experienceRecords('pending'),
    enabled: tab === 'experience',
  });

  const qInsurance = useQuery<InsurancePolicyRow[]>({
    queryKey: ['insurance-policies'],
    queryFn: () => adminService.insurancePolicies('pending_review'),
    enabled: tab === 'insurance',
  });

  const qContracts = useQuery<SignedContractRow[]>({
    queryKey: ['signed-contracts'],
    queryFn: () => adminService.signedContracts(),
    enabled: tab === 'contracts',
  });

  const qCancellations = useQuery<CancellationReport[]>({
    queryKey: ['cancellation-reports'],
    queryFn: () => adminService.cancellationReports('PENDING'),
    enabled: tab === 'cancellations',
  });

  const reviewCancel = useMutation({
    mutationFn: (v: {
      id: string;
      status: 'UPHELD' | 'DISMISSED';
      ratingImpact: boolean;
      adminNote?: string;
    }) => adminService.reviewCancellation(v.id, v),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cancellation-reports'] }),
  });

  const validateExp = useMutation({
    mutationFn: (id: string) => adminService.validateExperience(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['experience-records'] }),
  });
  const rejectExp = useMutation({
    mutationFn: ({ id, note }: { id: string; note: string }) =>
      adminService.rejectExperience(id, note),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['experience-records'] }),
  });
  const approveIns = useMutation({
    mutationFn: (id: string) => adminService.approveInsurance(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['insurance-policies'] }),
  });
  const rejectIns = useMutation({
    mutationFn: ({ id, note }: { id: string; note: string }) =>
      adminService.rejectInsurance(id, note),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['insurance-policies'] }),
  });

  const q = useQuery<PendingCredential[]>({
    queryKey: ['pending-credentials'],
    queryFn: () => adminService.pendingCredentials(),
  });

  const approve = useMutation({
    mutationFn: ({ id, licenseClass }: { id: string; licenseClass?: string }) =>
      adminService.approveCredential(id, undefined, licenseClass),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pending-credentials'] }),
  });
  const reject = useMutation({
    mutationFn: ({ id, note }: { id: string; note: string }) =>
      adminService.rejectCredential(id, note),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pending-credentials'] });
      setRejectingId(null);
      setRejectNote('');
    },
  });

  const items = q.data ?? [];

  // Derive filter option sets from current items
  const credTypeOptions = useMemo(() => {
    const set = new Set<string>();
    items.forEach((c) => set.add(c.credentialType));
    return Array.from(set).sort();
  }, [items]);

  const categoryOptions = useMemo(() => {
    const set = new Set<string>();
    items.forEach((c) => {
      if (c.task?.category) set.add(c.task.category);
    });
    return Array.from(set).sort();
  }, [items]);

  // Apply filters
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return items.filter((c) => {
      if (credType !== 'all' && c.credentialType !== credType) return false;
      if (category !== 'all' && c.task?.category !== category) return false;
      if (level !== 'all' && String(c.provider.level) !== level) return false;
      if (needle) {
        const hay = [
          c.provider.firstName,
          c.provider.lastName,
          c.provider.email,
          c.name,
          c.task?.name,
          c.task?.category,
          c.credentialType,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [items, search, credType, category, level]);

  const hasActiveFilters = search.trim() !== '' || credType !== 'all' || category !== 'all' || level !== 'all';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div className="t-section-head" style={{ marginBottom: 0 }}>
        <span className="t-eyebrow">§ Compliance</span>
        <h1 className="t-h1" style={{ marginTop: 8 }}>{t('documents.title')}</h1>
        <p className="t-lede" style={{ marginTop: 8 }}>{t('documents.subtitle')}</p>
      </div>

      {/* Selector de cola */}
      <div style={{ display: 'flex', gap: 8 }}>
        <Pill active={tab === 'credentials'} onClick={() => setTab('credentials')}>
          {t('documents.tabCredentials')}
        </Pill>
        <Pill active={tab === 'experience'} onClick={() => setTab('experience')}>
          {t('documents.tabExperience')}
          {qExperience.data?.length ? ` (${qExperience.data.length})` : ''}
        </Pill>
        <Pill active={tab === 'insurance'} onClick={() => setTab('insurance')}>
          {t('documents.tabInsurance')}
          {qInsurance.data?.length ? ` (${qInsurance.data.length})` : ''}
        </Pill>
        <Pill active={tab === 'cancellations'} onClick={() => setTab('cancellations')}>
          {t('documents.tabCancellations')}
          {qCancellations.data?.length ? ` (${qCancellations.data.length})` : ''}
        </Pill>
        <Pill active={tab === 'contracts'} onClick={() => setTab('contracts')}>
          {t('documents.tabContracts')}
          {qContracts.data?.length ? ` (${qContracts.data.length})` : ''}
        </Pill>
      </div>

      {/* ── Contratos firmados ───────────────────────────────────────── */}
      {tab === 'contracts' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <p className="t-lede" style={{ margin: 0 }}>
            {t('documents.contractsHelp')}
          </p>
          {qContracts.isLoading ? (
            <div className="t-lede">{t('common.loading')}</div>
          ) : (qContracts.data ?? []).length === 0 ? (
            <div className="t-lede">{t('documents.noContracts')}</div>
          ) : (
            (qContracts.data ?? []).map((c) => (
              <div key={c.id} className="t-card" style={{ padding: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600 }}>
                      {c.signedFullName || c.userName}{' '}
                      <span className="t-chip t-chip-mono" style={{ fontSize: 10 }}>
                        v{c.version}
                      </span>
                      {/* Firmó una versión anterior a la vigente. Hoy no
                          bloquea, pero cuando el abogado cambie el texto esta
                          marca es la lista de a quién hay que pedir re-firma. */}
                      {!c.isCurrentVersion && (
                        <span
                          className="t-chip"
                          style={{ fontSize: 10, marginLeft: 6, color: 'var(--t-danger)' }}
                        >
                          {t('documents.outdatedVersion')}
                        </span>
                      )}
                      {c.hasDrawnSignature && (
                        <span className="t-chip" style={{ fontSize: 10, marginLeft: 6 }}>
                          {t('documents.signed')}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--t-text-3)', marginTop: 4 }}>
                      {c.consentType} · {c.userEmail}
                      {c.businessName ? ` · ${c.businessName}` : ''}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--t-text-3)', marginTop: 6 }}>
                      {c.createdAt ? new Date(c.createdAt).toLocaleString() : '—'}
                      {c.ipAddress ? ` · IP ${c.ipAddress}` : ''}
                      {c.deviceId ? ` · ${c.deviceId}` : ''}
                    </div>
                    {/* El hash del PDF es lo que prueba que el archivo
                        archivado no se ha tocado desde que se generó. */}
                    <div
                      className="t-chip t-chip-mono"
                      style={{ fontSize: 10, marginTop: 6, display: 'inline-block' }}
                    >
                      sha256 {(c.documentHash ?? '').slice(0, 24)}…
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', flexShrink: 0 }}>
                    <button
                      className="t-btn t-btn-primary t-btn-sm"
                      disabled={contractLoading === c.id}
                      onClick={async () => {
                        setContractLoading(c.id);
                        try {
                          // La ruta se construye aquí en vez de recortar la
                          // que manda el backend: `baseURL` ya lleva el
                          // prefijo, y un replace de cadena se rompe en
                          // silencio el día que cambie el prefijo.
                          const url = await apiGetBlobUrl(
                            `/admin/signed-contracts/${c.id}/document`,
                          );
                          if (contractPreview) URL.revokeObjectURL(contractPreview.url);
                          setContractPreview({ row: c, url });
                        } catch {
                          alert(t('documents.contractOpenFailed'));
                        } finally {
                          setContractLoading(null);
                        }
                      }}
                    >
                      {contractLoading === c.id
                        ? t('common.loading')
                        : t('documents.viewContract')}
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}

          {contractPreview && (
            <div
              onClick={() => {
                URL.revokeObjectURL(contractPreview.url);
                setContractPreview(null);
              }}
              style={{
                position: 'fixed',
                inset: 0,
                background: 'rgba(0,0,0,0.6)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 1000,
                padding: 24,
              }}
            >
              <div
                onClick={(e) => e.stopPropagation()}
                className="t-card"
                style={{
                  width: 'min(900px, 100%)',
                  height: '90vh',
                  display: 'flex',
                  flexDirection: 'column',
                  padding: 12,
                  gap: 8,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                  <div style={{ fontWeight: 600 }}>
                    {contractPreview.row.signedFullName || contractPreview.row.userName} · v
                    {contractPreview.row.version}
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <a
                      className="t-btn t-btn-ghost t-btn-sm"
                      href={contractPreview.url}
                      download={`VISP-${contractPreview.row.consentType}-v${contractPreview.row.version}.pdf`}
                    >
                      {t('documents.download')}
                    </a>
                    <button
                      className="t-btn t-btn-ghost t-btn-sm"
                      onClick={() => {
                        URL.revokeObjectURL(contractPreview.url);
                        setContractPreview(null);
                      }}
                    >
                      {t('common.close')}
                    </button>
                  </div>
                </div>
                <iframe
                  title="contract"
                  src={contractPreview.url}
                  style={{ flex: 1, border: 0, borderRadius: 8, background: '#fff' }}
                />
              </div>
            </div>
          )}
        </div>
      ) : null}

      {/* ── Cancelaciones con motivo ─────────────────────────────────── */}
      {tab === 'cancellations' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <p className="t-lede" style={{ margin: 0 }}>
            {t('documents.cancellationsHelp')}
          </p>
          {qCancellations.isLoading ? (
            <div className="t-lede">{t('common.loading')}</div>
          ) : (qCancellations.data ?? []).length === 0 ? (
            <div className="t-lede">{t('documents.noneToReview')}</div>
          ) : (
            (qCancellations.data ?? []).map((r) => (
              <div key={r.id} className="t-card" style={{ padding: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600 }}>
                      {r.taskName}{' '}
                      <span className="t-chip t-chip-mono" style={{ fontSize: 10 }}>
                        {r.referenceNumber}
                      </span>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--t-text-3)', marginTop: 4 }}>
                      {t('documents.reportedBy')} {r.reporterName} ({r.reporterRole}) ·{' '}
                      <span className="t-chip t-chip-mono">{r.reasonCode}</span>
                    </div>
                    {r.note && (
                      <div style={{ fontSize: 13, marginTop: 8, lineHeight: 1.5 }}>
                        “{r.note}”
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', flexShrink: 0 }}>
                    {/* Confirmar CON impacto es la única vía por la que se toca la
                        calificación de alguien. Nunca ocurre solo. */}
                    <button
                      className="t-btn t-btn-primary t-btn-sm"
                      disabled={reviewCancel.isPending}
                      onClick={() => {
                        const note = prompt(t('documents.upholdPrompt')) ?? '';
                        reviewCancel.mutate({
                          id: r.id,
                          status: 'UPHELD',
                          ratingImpact: true,
                          adminNote: note.trim() || undefined,
                        });
                      }}
                    >
                      {t('documents.upholdWithImpact')}
                    </button>
                    <button
                      className="t-btn t-btn-ghost t-btn-sm"
                      disabled={reviewCancel.isPending}
                      onClick={() =>
                        reviewCancel.mutate({ id: r.id, status: 'UPHELD', ratingImpact: false })
                      }
                    >
                      {t('documents.upholdNoImpact')}
                    </button>
                    <button
                      className="t-btn t-btn-ghost t-btn-sm"
                      style={{ color: 'var(--t-danger)' }}
                      disabled={reviewCancel.isPending}
                      onClick={() =>
                        reviewCancel.mutate({ id: r.id, status: 'DISMISSED', ratingImpact: false })
                      }
                    >
                      {t('documents.dismiss')}
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      ) : null}

      {/* ── Cola de EXPERIENCIA (L1) ────────────────────────────────── */}
      {tab === 'experience' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <p className="t-lede" style={{ margin: 0 }}>
            {t('documents.experienceHelp')}
          </p>
          {qExperience.isLoading ? (
            <div className="t-lede">{t('common.loading')}</div>
          ) : (qExperience.data ?? []).length === 0 ? (
            <div className="t-lede">{t('documents.noneToReview')}</div>
          ) : (
            (qExperience.data ?? []).map((r) => {
              const url = resolveDocUrl(r.documentUrl);
              return (
                <div key={r.id} className="t-card" style={{ padding: 14 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                    <div>
                      <div style={{ fontWeight: 600 }}>{r.providerName}</div>
                      <div style={{ fontSize: 12, color: 'var(--t-text-3)' }}>
                        <span className="t-chip t-chip-mono">{r.kind}</span>
                        {r.title ? ` · ${r.title}` : ''}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                      {url && (
                        <a
                          className="t-btn t-btn-ghost t-btn-sm"
                          href={url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {t('documents.openInNewTab')}
                        </a>
                      )}
                      <button
                        className="t-btn t-btn-primary t-btn-sm"
                        disabled={validateExp.isPending}
                        onClick={() => validateExp.mutate(r.id)}
                      >
                        {t('documents.validate')}
                      </button>
                      <button
                        className="t-btn t-btn-ghost t-btn-sm"
                        style={{ color: 'var(--t-danger)' }}
                        disabled={rejectExp.isPending}
                        onClick={() => {
                          const note = prompt(t('documents.rejectExperiencePrompt'));
                          if (note && note.trim()) {
                            rejectExp.mutate({ id: r.id, note: note.trim() });
                          }
                        }}
                      >
                        {t('common.reject')}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      ) : null}

      {/* ── Cola de PÓLIZAS ──────────────────────────────────────────── */}
      {tab === 'insurance' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <p className="t-lede" style={{ margin: 0 }}>
            {t('documents.insuranceHelp')}
          </p>
          {qInsurance.isLoading ? (
            <div className="t-lede">{t('common.loading')}</div>
          ) : (qInsurance.data ?? []).length === 0 ? (
            <div className="t-lede">{t('documents.noneToReview')}</div>
          ) : (
            (qInsurance.data ?? []).map((p) => {
              const url = resolveDocUrl(p.documentUrl);
              return (
                <div key={p.id} className="t-card" style={{ padding: 14 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                    <div>
                      <div style={{ fontWeight: 600 }}>{p.providerName}</div>
                      <div style={{ fontSize: 12, color: 'var(--t-text-3)' }}>
                        {p.insurerName} · {p.policyNumber} ·{' '}
                        ${(p.coverageAmountCents / 100).toLocaleString()}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--t-text-3)' }}>
                        {p.effectiveDate} → {p.expiryDate}
                        {p.isExpired && (
                          <span className="t-chip t-chip-mono t-chip-warn" style={{ marginLeft: 8 }}>
                            {t('documents.expired')}
                          </span>
                        )}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                      {url && (
                        <a
                          className="t-btn t-btn-ghost t-btn-sm"
                          href={url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {t('documents.openInNewTab')}
                        </a>
                      )}
                      {/* Una póliza vencida no se puede aprobar: la API la rechaza
                          con 400 y aprobarla abriría servicios sin cobertura real. */}
                      <button
                        className="t-btn t-btn-primary t-btn-sm"
                        disabled={approveIns.isPending || p.isExpired}
                        title={p.isExpired ? t('documents.expiredCannotApprove') : undefined}
                        onClick={() => approveIns.mutate(p.id)}
                      >
                        {t('documents.approve')}
                      </button>
                      <button
                        className="t-btn t-btn-ghost t-btn-sm"
                        style={{ color: 'var(--t-danger)' }}
                        disabled={rejectIns.isPending}
                        onClick={() => {
                          const note = prompt(t('documents.rejectInsurancePrompt'));
                          if (note && note.trim()) {
                            rejectIns.mutate({ id: p.id, note: note.trim() });
                          }
                        }}
                      >
                        {t('common.reject')}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      ) : null}

      {tab !== 'credentials' ? null : (
      <>
      {/* Search */}
      <div className="t-search">
        <SearchIcon />
        <input
          type="search"
          placeholder={t('documents.searchPlaceholder')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <FilterGroup label={t('filters.type')}>
          <Pill active={credType === 'all'} onClick={() => setCredType('all')}>
            {t('filters.all')}
          </Pill>
          {credTypeOptions.map((c) => (
            <Pill key={c} active={credType === c} onClick={() => setCredType(c)}>
              {c.replaceAll('_', ' ')}
            </Pill>
          ))}
        </FilterGroup>

        {categoryOptions.length > 0 && (
          <FilterGroup label={t('filters.category')}>
            <Pill active={category === 'all'} onClick={() => setCategory('all')}>
              {t('filters.all')}
            </Pill>
            {categoryOptions.map((c) => (
              <Pill key={c} active={category === c} onClick={() => setCategory(c)}>
                {c}
              </Pill>
            ))}
          </FilterGroup>
        )}

        <FilterGroup label={t('filters.level')}>
          {(['all', '1', '2', '3', '4'] as LevelFilter[]).map((lv) => (
            <Pill key={lv} active={level === lv} onClick={() => setLevel(lv)}>
              {lv === 'all' ? t('filters.all') : `L${lv}`}
            </Pill>
          ))}
        </FilterGroup>

        {hasActiveFilters && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
            <span className="t-mono" style={{ fontSize: 11, color: 'var(--t-text-3)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
              {t('documents.matchCount', { shown: filtered.length, total: items.length })}
            </span>
            <button
              type="button"
              className="t-btn t-btn-ghost t-btn-sm"
              onClick={() => { setSearch(''); setCredType('all'); setCategory('all'); setLevel('all'); }}
            >
              {t('filters.clearAll')}
            </button>
          </div>
        )}
      </div>

      {q.isLoading && <div className="t-meta">{t('common.loading')}</div>}

      {!q.isLoading && items.length === 0 && (
        <div className="t-empty">
          <h3>{t('documents.empty')}</h3>
        </div>
      )}

      {!q.isLoading && items.length > 0 && filtered.length === 0 && (
        <div className="t-empty">
          <h3>{t('documents.noMatches')}</h3>
        </div>
      )}

      {/* Document list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {filtered.map((c) => {
          const docUrl = resolveDocUrl(c.documentUrl);
          const isRejecting = rejectingId === c.id;

          return (
            <div key={c.id} className="t-card-base" style={{ padding: 20 }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: 16 }}>
                <div style={{ flex: 1, minWidth: 280 }}>
                  <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--t-text)', letterSpacing: '-0.01em' }}>
                    {c.task?.name ?? c.name}
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                    <span className="t-chip t-chip-mono">{c.credentialType.replaceAll('_', ' ')}</span>
                    {c.task?.category && <span className="t-chip t-chip-mono t-chip-violet">{c.task.category}</span>}
                    {c.task?.level != null && <span className="t-chip t-chip-mono">L{c.task.level}</span>}
                    {c.section && <span className="t-chip t-chip-mono t-chip-violet">§ {c.section.name}</span>}
                    {!c.task && !c.section && <span className="t-chip t-chip-mono">{t('documents.general')}</span>}
                  </div>
                  <div style={{ marginTop: 12, fontSize: 13.5, color: 'var(--t-text-2)' }}>
                    {c.provider.firstName} {c.provider.lastName}
                    <span style={{ color: 'var(--t-text-3)' }}> · {c.provider.email}</span>
                  </div>
                  <div className="t-mono" style={{ marginTop: 4, fontSize: 11, color: 'var(--t-text-3)', letterSpacing: '0.06em' }}>
                    {t('documents.providerLevel').toUpperCase()} L{c.provider.level}
                    {c.uploadedAt && ` · ${t('documents.uploaded').toUpperCase()}: ${new Date(c.uploadedAt).toLocaleString()}`}
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {docUrl && (
                    <>
                      <button
                        type="button"
                        onClick={() => setPreviewItem(c)}
                        className="t-btn t-btn-secondary t-btn-sm"
                      >
                        {t('documents.view')}
                      </button>
                      <a
                        href={docUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="t-btn t-btn-ghost t-btn-sm"
                        title={t('documents.openInNewTab')}
                      >
                        ↗
                      </a>
                    </>
                  )}
                  {c.credentialType === 'license' && (
                    <select
                      className="t-input t-input-sm"
                      value={licenseChoice[c.id] ?? ''}
                      onChange={(e) => setLicenseChoice((m) => ({ ...m, [c.id]: e.target.value }))}
                      title={t('documents.licenseClass')}
                      style={{ maxWidth: 150 }}
                    >
                      <option value="">{t('documents.licenseClass')}…</option>
                      {LICENSE_CLASSES.map((lc) => (
                        <option key={lc} value={lc}>
                          {lc}
                          {(lc === 'G2' || lc === 'G') ? ' ✓' : ''}
                        </option>
                      ))}
                    </select>
                  )}
                  <button
                    type="button"
                    onClick={() => approve.mutate({ id: c.id, licenseClass: licenseChoice[c.id] || undefined })}
                    disabled={approve.isPending || (c.credentialType === 'license' && !licenseChoice[c.id])}
                    className="t-btn t-btn-success t-btn-sm"
                    title={c.credentialType === 'license' && !licenseChoice[c.id] ? t('documents.pickLicenseClassFirst') : undefined}
                  >
                    {t('common.approve')}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setRejectingId(isRejecting ? null : c.id);
                      setRejectNote('');
                    }}
                    className="t-btn t-btn-danger t-btn-sm"
                  >
                    {t('common.reject')}
                  </button>
                </div>
              </div>

              {isRejecting && (
                <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--t-border)', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <input
                    autoFocus
                    type="text"
                    value={rejectNote}
                    placeholder={t('documents.rejectPlaceholder')}
                    onChange={(e) => setRejectNote(e.target.value)}
                    className="t-input"
                    style={{ flex: 1, minWidth: 240 }}
                  />
                  <button
                    type="button"
                    disabled={!rejectNote.trim() || reject.isPending}
                    onClick={() => reject.mutate({ id: c.id, note: rejectNote.trim() })}
                    className="t-btn t-btn-danger"
                  >
                    {t('common.reject')}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Preview modal */}
      {previewItem && (() => {
        const url = resolveDocUrl(previewItem.documentUrl);
        if (!url) return null;
        const kind = inferMimeKind(url);
        return (
          <div className="t-modal-backdrop" onClick={() => setPreviewItem(null)}>
            <div
              className="t-modal"
              style={{ maxWidth: 900, height: '90vh' }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="t-modal-head">
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 15, color: 'var(--t-text)' }}>
                    {previewItem.task?.name ?? previewItem.name}
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                    <span className="t-chip t-chip-mono">{previewItem.credentialType.replaceAll('_', ' ')}</span>
                    {previewItem.task?.category && <span className="t-chip t-chip-mono t-chip-violet">{previewItem.task.category}</span>}
                    {previewItem.task?.level != null && <span className="t-chip t-chip-mono">L{previewItem.task.level}</span>}
                  </div>
                  <div style={{ marginTop: 8, fontSize: 13, color: 'var(--t-text-2)' }}>
                    {previewItem.provider.firstName} {previewItem.provider.lastName}
                    <span style={{ color: 'var(--t-text-3)' }}> · {previewItem.provider.email}</span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setPreviewItem(null)}
                  className="t-btn t-btn-ghost t-btn-sm"
                >
                  ✕
                </button>
              </div>

              <div style={{ flex: 1, overflow: 'auto', background: 'var(--t-deep)', display: 'grid', placeItems: 'center', padding: 10, minHeight: 300 }}>
                {kind === 'image' && (
                  <img src={url} alt={previewItem.name} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
                )}
                {kind === 'pdf' && (
                  <iframe src={url} title={previewItem.name} style={{ width: '100%', height: '100%', background: 'white', borderRadius: 4, border: 'none' }} />
                )}
                {kind === 'other' && (
                  <div style={{ textAlign: 'center', color: 'var(--t-text-2)', padding: 20 }}>
                    <p>{t('documents.cannotPreview')}</p>
                    <a href={url} target="_blank" rel="noreferrer" className="t-btn t-btn-secondary t-btn-sm" style={{ marginTop: 12 }}>
                      {t('documents.openInNewTab')}
                    </a>
                  </div>
                )}
              </div>

              <div className="t-modal-foot">
                <a href={url} target="_blank" rel="noreferrer" className="t-btn t-btn-secondary">
                  {t('documents.openInNewTab')}
                </a>
                {previewItem.credentialType === 'license' && (
                  <select
                    className="t-input"
                    value={licenseChoice[previewItem.id] ?? ''}
                    onChange={(e) => setLicenseChoice((m) => ({ ...m, [previewItem.id]: e.target.value }))}
                    style={{ maxWidth: 160 }}
                  >
                    <option value="">{t('documents.licenseClass')}…</option>
                    {LICENSE_CLASSES.map((lc) => (
                      <option key={lc} value={lc}>
                        {lc}{(lc === 'G2' || lc === 'G') ? ' ✓' : ''}
                      </option>
                    ))}
                  </select>
                )}
                <button
                  type="button"
                  onClick={() => { approve.mutate({ id: previewItem.id, licenseClass: licenseChoice[previewItem.id] || undefined }); setPreviewItem(null); }}
                  disabled={approve.isPending || (previewItem.credentialType === 'license' && !licenseChoice[previewItem.id])}
                  className="t-btn t-btn-success"
                >
                  {t('common.approve')}
                </button>
                <button
                  type="button"
                  onClick={() => { setRejectingId(previewItem.id); setRejectNote(''); setPreviewItem(null); }}
                  className="t-btn t-btn-danger"
                >
                  {t('common.reject')}
                </button>
              </div>
            </div>
          </div>
        );
      })()}
      </>
      )}
    </div>
  );
}

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <span
        className="t-mono"
        style={{ fontSize: 10.5, color: 'var(--t-text-4)', letterSpacing: '0.14em', textTransform: 'uppercase', minWidth: 64 }}
      >
        {label}
      </span>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {children}
      </div>
    </div>
  );
}

function Pill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className={`t-pill ${active ? 'active' : ''}`}>
      {children}
    </button>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}
