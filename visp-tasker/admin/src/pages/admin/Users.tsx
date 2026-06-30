import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { adminService, UserListItem } from '@/services/adminService';
import { useAuthStore } from '@/stores/authStore';

const RECOVERY_AUTO_HIDE_SECONDS = 60;

/**
 * Reusable revealable recovery-code cell. Masked by default; on tap it fetches
 * the existing code (NEVER generates — that's a backend-enforced contract) and
 * shows it for 60 s before auto-hiding to keep the value off-screen.
 */
function RecoveryCodeCell({ userId, compact = false }: { userId: string; compact?: boolean }) {
  const { t } = useTranslation();
  const [code, setCode] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const tickRef = useRef<number | null>(null);

  const stopTimer = useCallback(() => {
    if (tickRef.current !== null) {
      window.clearInterval(tickRef.current);
      tickRef.current = null;
    }
  }, []);

  const hide = useCallback(() => {
    setLoaded(false);
    setCode(null);
    setSecondsLeft(0);
    setError(null);
    stopTimer();
  }, [stopTimer]);

  useEffect(() => () => stopTimer(), [stopTimer]);

  const onView = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminService.getUserRecoveryCode(userId);
      setCode(res.recoveryCode);
      setLoaded(true);
      // Auto-hide countdown only when an actual code was returned.
      if (res.recoveryCode) {
        setSecondsLeft(RECOVERY_AUTO_HIDE_SECONDS);
        stopTimer();
        tickRef.current = window.setInterval(() => {
          setSecondsLeft((s) => {
            if (s <= 1) {
              hide();
              return 0;
            }
            return s - 1;
          });
        }, 1000);
      }
    } catch (err: any) {
      // Surface the failure so the operator can see WHY (404 = backend not
      // redeployed, 401/403 = auth, etc.) instead of silently swallowing.
      const status = err?.response?.status;
      const detail =
        err?.response?.data?.detail ??
        err?.response?.statusText ??
        err?.message ??
        'Unknown error';
      const msg = status ? `${status} · ${detail}` : String(detail);
      console.error('[Users] getUserRecoveryCode failed:', err);
      setError(msg);
      setLoaded(true); // keep cell expanded so the error is visible
    } finally {
      setLoading(false);
    }
  }, [userId, hide, stopTimer]);

  const onCopy = useCallback(async () => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard not available */
    }
  }, [code]);

  // Not revealed yet
  if (!loaded) {
    return (
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
        <span
          className="t-mono"
          style={{
            fontSize: 12,
            color: 'var(--t-text-4)',
            letterSpacing: '0.18em',
            filter: 'blur(3px)',
            userSelect: 'none',
          }}
        >
          ●●●●●●●●●●●●
        </span>
        <button
          type="button"
          className="t-btn t-btn-ghost t-btn-sm"
          onClick={onView}
          disabled={loading}
          title={t('users.recoveryView')}
        >
          {loading ? t('users.recoveryLoading') : <EyeIcon />}
        </button>
      </div>
    );
  }

  // Revealed: request failed (surface the error)
  if (error) {
    return (
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
        <span className="t-chip t-chip-mono t-chip-danger" title={error}>
          {error.length > 60 ? `${error.slice(0, 60)}…` : error}
        </span>
        <button type="button" className="t-btn t-btn-ghost t-btn-sm" onClick={hide}>
          <EyeOffIcon />
        </button>
      </div>
    );
  }

  // Revealed: user not yet generated
  if (code === null) {
    return (
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
        <span className="t-chip t-chip-mono t-chip-warn">
          {t('users.recoveryNotGenerated')}
        </span>
        <button type="button" className="t-btn t-btn-ghost t-btn-sm" onClick={hide}>
          <EyeOffIcon />
        </button>
      </div>
    );
  }

  // Revealed: code present
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <span
        className="t-mono"
        style={{
          fontSize: 12.5,
          color: 'var(--t-violet)',
          letterSpacing: '0.14em',
          fontWeight: 600,
          padding: '4px 8px',
          background: 'var(--t-violet-wash)',
          border: '1px solid var(--t-violet-line)',
          borderRadius: 4,
        }}
      >
        {code}
      </span>
      <button
        type="button"
        className="t-btn t-btn-ghost t-btn-sm"
        onClick={onCopy}
        title={t('users.recoveryCopy')}
      >
        {copied ? `✓ ${t('users.recoveryCopied')}` : <CopyIcon />}
      </button>
      <button
        type="button"
        className="t-btn t-btn-ghost t-btn-sm"
        onClick={hide}
        title={t('users.recoveryHide')}
      >
        <EyeOffIcon />
      </button>
      {!compact && secondsLeft > 0 && (
        <span
          className="t-mono"
          style={{ fontSize: 10, color: 'var(--t-text-4)', letterSpacing: '0.1em' }}
        >
          {t('users.recoveryAutoHide', { seconds: secondsLeft })}
        </span>
      )}
    </div>
  );
}

function EyeIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
function EyeOffIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}
function CopyIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

type RoleFilter = 'all' | 'customer' | 'provider' | 'both';
type Role = 'customer' | 'provider' | 'both';

export default function Users() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { user } = useAuthStore();

  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('all');
  const [page, setPage] = useState(1);
  const pageSize = 25;

  const [detailsOf, setDetailsOf] = useState<UserListItem | null>(null);
  const [editingOf, setEditingOf] = useState<UserListItem | null>(null);

  // Debounce search input → query param (avoid one query per keystroke)
  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  // Reset page on filter change
  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, roleFilter]);

  const q = useQuery({
    queryKey: ['admin-users', { page, pageSize, search: debouncedSearch, role: roleFilter }],
    queryFn: () =>
      adminService.listUsers({
        page,
        pageSize,
        search: debouncedSearch || undefined,
        role: roleFilter === 'all' ? undefined : roleFilter,
      }),
    enabled: user?.role === 'super_admin',
  });

  const patch = useMutation({
    mutationFn: ({ id, role }: { id: string; role: Role }) =>
      adminService.patchUser(id, { role }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-users'] });
      setEditingOf(null);
    },
  });

  const items = q.data?.items ?? [];
  const meta = q.data?.meta;

  // Show 403 if not super_admin (defensive — route also guards)
  if (user && user.role !== 'super_admin') {
    return (
      <div className="t-empty">
        <h3>{t('admins.onlySuperAdmin')}</h3>
      </div>
    );
  }

  const totalPages = useMemo(() => meta?.totalPages ?? 1, [meta]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div className="t-section-head" style={{ marginBottom: 0 }}>
        <span className="t-eyebrow">§ Super admin</span>
        <h1 className="t-h1" style={{ marginTop: 8 }}>{t('users.title')}</h1>
        <p className="t-lede" style={{ marginTop: 8 }}>{t('users.subtitle')}</p>
      </div>

      {/* Search + role filter */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <div className="t-search" style={{ flex: 1, minWidth: 280 }}>
          <SearchIcon />
          <input
            type="search"
            placeholder={t('users.searchPlaceholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {(['all', 'customer', 'provider', 'both'] as RoleFilter[]).map((r) => (
            <button
              key={r}
              type="button"
              className={`t-pill ${roleFilter === r ? 'active' : ''}`}
              onClick={() => setRoleFilter(r)}
            >
              {r === 'all' ? t('filters.all') : t(`users.role${r.charAt(0).toUpperCase() + r.slice(1)}` as const)}
            </button>
          ))}
        </div>
      </div>

      {q.isLoading && <div className="t-meta">{t('common.loading')}</div>}

      {!q.isLoading && items.length === 0 && (
        <div className="t-empty">
          <h3>{t('users.noResults')}</h3>
        </div>
      )}

      {/* Table */}
      {items.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table className="t-table">
            <thead>
              <tr>
                <th>{t('users.tableName')}</th>
                <th>{t('users.tableEmail')}</th>
                <th>{t('users.tableRole')}</th>
                <th>{t('users.tableStatus')}</th>
                <th style={{ textAlign: 'center' }}>{t('users.tableCard')}</th>
                <th style={{ textAlign: 'center' }}>{t('users.tableStripe')}</th>
                <th>{t('users.tableRecovery')}</th>
                <th style={{ textAlign: 'right' }}>{t('users.tableActions')}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((u) => (
                <tr key={u.id}>
                  <td>
                    <div style={{ color: 'var(--t-text)', fontWeight: 600, fontSize: 14 }}>
                      {u.firstName} {u.lastName}
                    </div>
                    {u.phone && (
                      <div className="t-mono" style={{ fontSize: 11, color: 'var(--t-text-3)', marginTop: 2, letterSpacing: '0.04em' }}>
                        {u.phone}
                      </div>
                    )}
                  </td>
                  <td style={{ color: 'var(--t-text-2)' }}>
                    {u.email}
                    {!u.emailVerified && (
                      <span className="t-chip t-chip-mono t-chip-warn" style={{ marginLeft: 8 }}>UNVERIFIED</span>
                    )}
                  </td>
                  <td>
                    <span className="t-chip t-chip-mono">
                      {t(`users.role${u.role.charAt(0).toUpperCase() + u.role.slice(1)}` as const)}
                    </span>
                  </td>
                  <td>
                    <StatusChip status={u.status} />
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <CheckCell value={u.hasCard} />
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    {u.role === 'customer' ? (
                      <span className="t-mono" style={{ fontSize: 11, color: 'var(--t-text-4)', letterSpacing: '0.08em' }}>
                        N/A
                      </span>
                    ) : (
                      <CheckCell value={u.stripeConnected} />
                    )}
                  </td>
                  <td>
                    <RecoveryCodeCell userId={u.id} compact />
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <div style={{ display: 'inline-flex', gap: 4 }}>
                      <button
                        type="button"
                        className="t-btn t-btn-ghost t-btn-sm"
                        onClick={() => setDetailsOf(u)}
                      >
                        {t('users.viewDetails')}
                      </button>
                      <button
                        type="button"
                        className="t-btn t-btn-secondary t-btn-sm"
                        onClick={() => setEditingOf(u)}
                      >
                        {t('users.editRole')}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {meta && meta.totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
          <span className="t-mono" style={{ fontSize: 11, color: 'var(--t-text-3)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
            Page {meta.page} / {meta.totalPages} · {meta.total} total
          </span>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              type="button"
              className="t-btn t-btn-secondary t-btn-sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              ← Prev
            </button>
            <button
              type="button"
              className="t-btn t-btn-secondary t-btn-sm"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              Next →
            </button>
          </div>
        </div>
      )}

      {/* Details modal */}
      {detailsOf && (
        <DetailsModal user={detailsOf} onClose={() => setDetailsOf(null)} />
      )}

      {/* Edit role modal */}
      {editingOf && (
        <EditRoleModal
          user={editingOf}
          onClose={() => setEditingOf(null)}
          onSubmit={(role) => patch.mutate({ id: editingOf.id, role })}
          submitting={patch.isPending}
        />
      )}
    </div>
  );
}

/* ===== Helpers ===== */
function CheckCell({ value }: { value: boolean }) {
  return value ? (
    <span style={{ display: 'inline-grid', placeItems: 'center', width: 20, height: 20, borderRadius: 4, background: 'rgba(154,230,180,0.12)', border: '1px solid rgba(154,230,180,0.35)', color: 'var(--t-ok)' }}>
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="20,6 9,17 4,12" />
      </svg>
    </span>
  ) : (
    <span style={{ display: 'inline-grid', placeItems: 'center', width: 20, height: 20, borderRadius: 4, border: '1px solid var(--t-border-strong)', color: 'var(--t-text-4)' }}>
      <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
        <line x1="18" y1="6" x2="6" y2="18" />
        <line x1="6" y1="6" x2="18" y2="18" />
      </svg>
    </span>
  );
}

function StatusChip({ status }: { status: string }) {
  const s = status.toLowerCase();
  const cls =
    s === 'active' ? 't-chip-ok' :
    s === 'suspended' || s === 'banned' ? 't-chip-danger' :
    s === 'pending_verification' ? 't-chip-warn' :
    '';
  return <span className={`t-chip t-chip-mono ${cls}`}>{status.replaceAll('_', ' ')}</span>;
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

/* ===== Details modal ===== */
function DetailsModal({ user, onClose }: { user: UserListItem; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="t-modal-backdrop" onClick={onClose}>
      <div
        className="t-modal"
        style={{ maxWidth: 720 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="t-modal-head">
          <div style={{ minWidth: 0 }}>
            <span className="t-eyebrow">§ User detail</span>
            <div className="t-h3" style={{ marginTop: 4 }}>
              {user.firstName} {user.lastName}
            </div>
            <div style={{ fontSize: 13, color: 'var(--t-text-3)', marginTop: 4 }}>
              {user.email}
            </div>
          </div>
          <button type="button" className="t-btn t-btn-ghost t-btn-sm" onClick={onClose}>✕</button>
        </div>

        <div className="t-modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
          <Section title={t('users.sectionAccount')}>
            <Row label={t('users.tableRole')} value={user.role} />
            <Row label={t('users.tableStatus')} value={user.status.replaceAll('_', ' ')} />
            <Row label={t('users.diagEmailVerified')} value={<Bool v={user.emailVerified} />} />
            <Row label={t('users.diagPhoneVerified')} value={<Bool v={user.phoneVerified} />} />
            <Row label={t('users.diagPhone')} value={user.phone ?? <Empty />} />
            <Row label={t('users.diagAuthProvider')} value={user.authProvider} />
            <Row label="User ID" value={<Mono>{user.id}</Mono>} />
            <Row label={t('users.diagCreated')} value={fmt(user.createdAt)} />
            <Row label={t('users.diagLastLogin')} value={fmt(user.lastLoginAt)} />
          </Section>

          <Section title={t('users.sectionRecovery')}>
            <Row
              label={t('users.tableRecovery')}
              value={<RecoveryCodeCell userId={user.id} />}
            />
          </Section>

          <Section title={t('users.sectionPayments')}>
            <Row
              label={t('users.diagCustomerId')}
              value={
                user.stripeCustomerId ? (
                  <Mono>{user.stripeCustomerId}</Mono>
                ) : (
                  <Warn>{t('users.diagNoCustomer')}</Warn>
                )
              }
            />
            <Row label={t('users.tableCard')} value={<Bool v={user.hasCard} />} />
            {user.role !== 'customer' && (
              <>
                <Row
                  label={t('users.diagStripeAccountId')}
                  value={
                    user.provider?.stripeAccountId ? (
                      <Mono>{user.provider.stripeAccountId}</Mono>
                    ) : (
                      <Warn>{t('users.diagNoConnect')}</Warn>
                    )
                  }
                />
                <Row label={t('users.tableStripe')} value={<Bool v={user.stripeConnected} />} />
              </>
            )}
          </Section>

          {user.provider && (
            <Section title={t('users.sectionProvider')}>
              <Row label={t('users.diagProviderStatus')} value={user.provider.providerStatus.replaceAll('_', ' ')} />
              <Row label={t('users.diagProviderLevel')} value={`L${user.provider.providerLevel}`} />
              <Row label={t('users.diagBackground')} value={user.provider.backgroundCheckStatus.replaceAll('_', ' ')} />
              <Row label="Internal score" value={user.provider.internalScore != null ? user.provider.internalScore.toFixed(2) : <Empty />} />
              <Row label={t('users.diagOnline')} value={<Bool v={user.provider.isOnline} />} />
              <Row label={t('users.diagEmergency')} value={<Bool v={user.provider.availableForEmergency} />} />
              <Row label={t('users.diagActivated')} value={fmt(user.provider.activatedAt)} />
              <Row label="Provider ID" value={<Mono>{user.provider.providerId}</Mono>} />
            </Section>
          )}

          {(user.address.street || user.address.city || user.address.postalCode) && (
            <Section title={t('users.sectionAddress')}>
              <Row label="Street" value={user.address.street ?? <Empty />} />
              <Row label="City" value={user.address.city ?? <Empty />} />
              <Row label="Province" value={user.address.province ?? <Empty />} />
              <Row label="Postal code" value={user.address.postalCode ?? <Empty />} />
              <Row label="Country" value={user.address.country ?? <Empty />} />
            </Section>
          )}
        </div>

        <div className="t-modal-foot">
          <button type="button" className="t-btn t-btn-secondary" onClick={onClose}>{t('common.close')}</button>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="t-mono" style={{ fontSize: 10.5, color: 'var(--t-text-3)', letterSpacing: '0.16em', textTransform: 'uppercase', marginBottom: 10 }}>
        § {title}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr', gap: '8px 16px', border: '1px solid var(--t-border)', borderRadius: 8, padding: 14, background: 'var(--t-deep)' }}>
        {children}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <>
      <div className="t-mono" style={{ fontSize: 11, color: 'var(--t-text-3)', letterSpacing: '0.08em', textTransform: 'uppercase', alignSelf: 'center' }}>
        {label}
      </div>
      <div style={{ fontSize: 13, color: 'var(--t-text)', wordBreak: 'break-all' }}>
        {value}
      </div>
    </>
  );
}

function Mono({ children }: { children: React.ReactNode }) {
  return <span className="t-mono" style={{ fontSize: 12, color: 'var(--t-violet)' }}>{children}</span>;
}

function Empty() {
  const { t } = useTranslation();
  return <span style={{ color: 'var(--t-text-4)', fontStyle: 'italic' }}>{t('users.notSet')}</span>;
}

function Warn({ children }: { children: React.ReactNode }) {
  return <span className="t-chip t-chip-mono t-chip-warn">{children}</span>;
}

function Bool({ v }: { v: boolean }) {
  return v ? <CheckCell value /> : <CheckCell value={false} />;
}

function fmt(iso: string | null): React.ReactNode {
  if (!iso) return <Empty />;
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

/* ===== Edit-role modal ===== */
function EditRoleModal({
  user,
  onClose,
  onSubmit,
  submitting,
}: {
  user: UserListItem;
  onClose: () => void;
  onSubmit: (role: Role) => void;
  submitting: boolean;
}) {
  const { t } = useTranslation();
  const [role, setRole] = useState<Role>(user.role);

  return (
    <div className="t-modal-backdrop" onClick={onClose}>
      <form
        className="t-modal"
        style={{ maxWidth: 480 }}
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => { e.preventDefault(); onSubmit(role); }}
      >
        <div className="t-modal-head">
          <div>
            <span className="t-eyebrow">§ Role</span>
            <div className="t-h3" style={{ marginTop: 4 }}>{t('users.editTitle')}</div>
            <div style={{ fontSize: 13, color: 'var(--t-text-3)', marginTop: 4 }}>
              {user.firstName} {user.lastName} · {user.email}
            </div>
          </div>
          <button type="button" className="t-btn t-btn-ghost t-btn-sm" onClick={onClose}>✕</button>
        </div>

        <div className="t-modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {(['customer', 'provider', 'both'] as Role[]).map((r) => (
            <label
              key={r}
              style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '14px 16px', cursor: 'pointer',
                border: '1px solid var(--t-border)',
                borderRadius: 8,
                background: role === r ? 'var(--t-violet-wash)' : 'var(--t-deep)',
                borderColor: role === r ? 'var(--t-violet-line)' : 'var(--t-border)',
                transition: 'background-color .15s, border-color .15s',
              }}
            >
              <input
                type="radio"
                name="role"
                value={r}
                checked={role === r}
                onChange={() => setRole(r)}
              />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--t-text)' }}>
                  {t(`users.role${r.charAt(0).toUpperCase() + r.slice(1)}` as const)}
                </div>
                <div className="t-mono" style={{ fontSize: 10.5, color: 'var(--t-text-3)', letterSpacing: '0.08em', marginTop: 2, textTransform: 'uppercase' }}>
                  {r}
                </div>
              </div>
            </label>
          ))}
        </div>

        <div className="t-modal-foot">
          <button type="button" className="t-btn t-btn-ghost" onClick={onClose}>{t('common.cancel')}</button>
          <button type="submit" className="t-btn t-btn-primary" disabled={submitting || role === user.role}>
            {submitting && <span className="t-spinner" />}
            {t('common.save')}
          </button>
        </div>
      </form>
    </div>
  );
}
