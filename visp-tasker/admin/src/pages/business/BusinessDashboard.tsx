/**
 * /business — owner dashboard for "VISP for Business".
 *
 * Loads the company (GET /companies/me) and presents it as a tabbed
 * workspace instead of a long vertical scroll:
 *   • Overview   — company status + summary placeholder
 *   • Documents  — the upload wizard
 *   • Services   — the catalog checklist
 *   • Team       — members table + invites (with role) + pending invites
 *
 * While the company is in `draft`, the Documents tab is selected by default
 * and submitting is made prominent. Once submitted/validated, Overview leads.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useBusinessStore } from '@/stores/businessStore';
import {
  businessService,
  Company,
  CompanyMember,
  CompanyRole,
  CatalogCategory,
  PendingInvite,
  DocType,
  DOC_TYPES,
  DOC_LABELS,
} from '@/services/businessService';
import { BusinessTopBar, StatusBadge, VispSprite } from './BusinessChrome';

type TabKey = 'overview' | 'documents' | 'services' | 'team';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'documents', label: 'Documents' },
  { key: 'services', label: 'Services' },
  { key: 'team', label: 'Members & invites' },
];

export default function BusinessDashboard() {
  const navigate = useNavigate();
  const { user, isAuthenticated, isHydrating, logout } = useBusinessStore();

  const [company, setCompany] = useState<Company | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>('documents');

  const reload = useCallback(async () => {
    try {
      const c = await businessService.getMyCompany();
      setCompany(c);
      setLoadError(null);
    } catch (err: any) {
      if (err?.response?.status === 404) {
        // Logged in but no company yet — fall through to the inline CTA
        // (do NOT redirect; that caused a /business ⇄ /register loop).
        setCompany(null);
        setLoadError(null);
        return;
      }
      setLoadError('Could not load your company.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isHydrating) return;
    if (!isAuthenticated) {
      navigate('/business/login', { replace: true });
      return;
    }
    void reload();
  }, [isHydrating, isAuthenticated, navigate, reload]);

  // Pick a sensible default tab once we know the company status. In `draft`
  // the priority is uploading documents; once submitted/validated, Overview.
  useEffect(() => {
    if (!company) return;
    setTab(company.status === 'draft' ? 'documents' : 'overview');
  }, [company?.status]);

  const onLogout = () => {
    logout();
    navigate('/business/login', { replace: true });
  };

  const topRight = (
    <button type="button" className="t-btn t-btn-ghost t-btn-sm" onClick={onLogout}>
      Sign out
    </button>
  );

  if (isHydrating || loading) {
    return (
      <div className="min-h-screen flex flex-col" style={{ background: 'var(--t-bg)' }}>
        <VispSprite />
        <BusinessTopBar right={topRight} />
        <div className="flex-1 grid place-items-center" style={{ color: 'var(--t-text-2)' }}>
          Loading…
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="min-h-screen flex flex-col" style={{ background: 'var(--t-bg)' }}>
        <VispSprite />
        <BusinessTopBar right={topRight} />
        <div className="flex-1 grid place-items-center" style={{ color: 'var(--t-danger)' }}>
          {loadError}
        </div>
      </div>
    );
  }

  if (!company) {
    // Signed in, but this account has no company yet.
    return (
      <div className="min-h-screen flex flex-col" style={{ background: 'var(--t-bg)' }}>
        <VispSprite />
        <BusinessTopBar right={topRight} />
        <div className="flex-1 grid place-items-center px-6">
          <div className="t-card-base" style={{ padding: 32, maxWidth: 460, textAlign: 'center' }}>
            <span className="t-eyebrow">§ For Business</span>
            <h2 className="t-h2" style={{ marginTop: 10 }}>No company yet</h2>
            <p className="t-lede" style={{ marginTop: 10 }}>
              You are signed in{user?.email ? ` as ${user.email}` : ''}, but this account
              hasn’t created a company. Create one to start onboarding, or sign out to
              use a different account.
            </p>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginTop: 22 }}>
              <button
                type="button"
                className="t-btn t-btn-primary"
                onClick={() => navigate('/business/register', { replace: true })}
              >
                Create your company
              </button>
              <button type="button" className="t-btn t-btn-ghost" onClick={onLogout}>
                Sign out
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const isDraft = company.status === 'draft';
  const docsDone = company.documents.length;

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--t-bg)' }}>
      <VispSprite />
      <BusinessTopBar right={topRight} />

      <main
        className="flex-1 px-6 lg:px-10 py-10"
        style={{ width: '100%', maxWidth: 1040, margin: '0 auto' }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 16,
            flexWrap: 'wrap',
            marginBottom: 20,
          }}
        >
          <div>
            <span className="t-eyebrow">§ Company</span>
            <h1 className="t-h1" style={{ marginTop: 8 }}>
              {company.trade_name || company.legal_name}
            </h1>
            {company.trade_name && (
              <p className="t-meta" style={{ marginTop: 4 }}>
                {company.legal_name}
              </p>
            )}
          </div>
          <div style={{ paddingTop: 6 }}>
            <StatusBadge status={company.status} />
          </div>
        </div>

        {/* Tab bar */}
        <nav
          role="tablist"
          style={{
            display: 'flex',
            gap: 4,
            flexWrap: 'wrap',
            borderBottom: '1px solid var(--t-border)',
            marginBottom: 28,
          }}
        >
          {TABS.map((tDef) => {
            const active = tab === tDef.key;
            const badge =
              tDef.key === 'documents' && isDraft ? `${docsDone}/${DOC_TYPES.length}` : null;
            return (
              <button
                key={tDef.key}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setTab(tDef.key)}
                style={{
                  appearance: 'none',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: '10px 14px',
                  marginBottom: -1,
                  fontSize: 14,
                  fontWeight: active ? 600 : 500,
                  color: active ? 'var(--t-text)' : 'var(--t-text-3)',
                  borderBottom: active
                    ? '2px solid var(--t-violet)'
                    : '2px solid transparent',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                {tDef.label}
                {badge && (
                  <span
                    className="t-mono"
                    style={{ fontSize: 10.5, color: 'var(--t-text-4)' }}
                  >
                    {badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {company.status === 'rejected' && company.rejection_reason && (
          <div
            className="t-card-base"
            style={{
              marginBottom: 24,
              borderColor: 'rgba(252,129,129,0.3)',
              background: 'rgba(252,129,129,0.06)',
            }}
          >
            <div className="t-label" style={{ color: 'var(--t-danger)' }}>
              Rejection reason
            </div>
            <p style={{ color: 'var(--t-text)', fontSize: 14 }}>{company.rejection_reason}</p>
          </div>
        )}

        {tab === 'overview' && <OverviewSection company={company} onGoToDocuments={() => setTab('documents')} />}
        {tab === 'documents' && <DocumentWizard company={company} onChanged={reload} />}
        {tab === 'services' && <ServicesSection company={company} onSaved={reload} />}
        {tab === 'team' && (
          <MembersSection company={company} currentUserId={user?.id ?? null} onChanged={reload} />
        )}
      </main>
    </div>
  );
}

/* ============================ Overview ============================ */

function OverviewSection({
  company,
  onGoToDocuments,
}: {
  company: Company;
  onGoToDocuments: () => void;
}) {
  const isDraft = company.status === 'draft';
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div>
        <span className="t-eyebrow">§ Overview</span>
        <h2 className="t-h2" style={{ marginTop: 6 }}>
          Company status
        </h2>
      </div>

      {company.status === 'pending_review' && (
        <div
          className="t-card-base"
          style={{ borderColor: 'var(--t-violet-line)', background: 'var(--t-violet-wash)' }}
        >
          <div className="t-h3" style={{ color: 'var(--t-violet)' }}>
            In validation
          </div>
          <p style={{ color: 'var(--t-text-2)', fontSize: 14, marginTop: 6 }}>
            Your company and documents are under review. You can still configure your services and
            team while you wait.
          </p>
        </div>
      )}

      {isDraft && (
        <div
          className="t-card-base"
          style={{ borderColor: 'var(--t-violet-line)', background: 'var(--t-violet-wash)' }}
        >
          <div className="t-h3" style={{ color: 'var(--t-violet)' }}>
            Finish onboarding
          </div>
          <p style={{ color: 'var(--t-text-2)', fontSize: 14, marginTop: 6, marginBottom: 14 }}>
            Upload your company documents and submit for review to activate your account.
          </p>
          <button type="button" className="t-btn t-btn-primary t-btn-sm" onClick={onGoToDocuments}>
            Go to documents
          </button>
        </div>
      )}

      {/* Quick facts */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
          gap: 12,
        }}
      >
        <StatCard label="Members" value={String(company.members.length)} />
        <StatCard label="Enabled services" value={String(company.enabled_task_ids.length)} />
        <StatCard label="Documents" value={String(company.documents.length)} />
      </div>

      {/* Fiscal address & tax — read-only (on record for jurisdiction/compliance) */}
      <FiscalCard company={company} />

      <SummaryPlaceholder />
    </section>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="t-card-base" style={{ padding: '16px 18px' }}>
      <div className="t-label" style={{ color: 'var(--t-text-3)' }}>
        {label}
      </div>
      <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--t-text)', marginTop: 4 }}>
        {value}
      </div>
    </div>
  );
}

function FiscalRow({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '7px 0', borderBottom: '1px solid var(--t-border)' }}>
      <span className="t-label" style={{ color: 'var(--t-text-3)' }}>{label}</span>
      <span style={{ color: 'var(--t-text)', fontSize: 13.5, textAlign: 'right' }}>{value && String(value).trim() !== '' ? value : '—'}</span>
    </div>
  );
}

function FiscalCard({ company }: { company: Company }) {
  const addr = [
    company.fiscal_address_line1,
    company.fiscal_address_line2,
    [company.fiscal_city, company.fiscal_province, company.fiscal_postal_code].filter(Boolean).join(', '),
    company.fiscal_country,
  ].filter((x) => x && String(x).trim() !== '').join(' · ');
  return (
    <div className="t-card-base" style={{ padding: '18px 20px', marginTop: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <span className="t-eyebrow">§ Fiscal address &amp; tax</span>
        <span className="t-chip t-chip-mono" style={{ color: 'var(--t-text-3)' }}>Read-only</span>
      </div>
      <p className="t-meta" style={{ margin: '0 0 12px' }}>
        On record for jurisdiction and compliance. You declare your own earnings; these can’t be edited here.
      </p>
      <FiscalRow label="Fiscal address" value={addr} />
      <FiscalRow label="Province" value={company.fiscal_province} />
      <FiscalRow label="GST/HST registered" value={company.tax_registered ? 'Yes' : 'No'} />
      {company.tax_registered ? <FiscalRow label="GST/HST number" value={company.tax_number} /> : null}
    </div>
  );
}

function SummaryPlaceholder() {
  return (
    <div>
      <span className="t-eyebrow">§ Summary</span>
      <h3 className="t-h3" style={{ marginTop: 6, marginBottom: 12 }}>
        Jobs &amp; earnings
      </h3>
      <div
        className="t-card-base"
        style={{ display: 'grid', placeItems: 'center', padding: 48, textAlign: 'center' }}
      >
        <div>
          <div className="t-h3" style={{ color: 'var(--t-text-2)' }}>
            Nothing to show yet
          </div>
          <p className="t-meta" style={{ marginTop: 8, maxWidth: 360 }}>
            Job activity and earnings for your company will appear here once you start receiving
            work.
          </p>
        </div>
      </div>
    </div>
  );
}

/* ============================ Document wizard ============================ */

function DocumentWizard({ company, onChanged }: { company: Company; onChanged: () => void }) {
  const [busy, setBusy] = useState<DocType | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isDraft = company.status === 'draft';

  const uploadedTypes = useMemo(
    () => new Set(company.documents.map((d) => d.doc_type)),
    [company.documents],
  );
  const uploadedCount = uploadedTypes.size;
  const canSubmit = isDraft && uploadedCount > 0;

  const onUpload = async (docType: DocType, file: File | null) => {
    if (!file) return;
    setBusy(docType);
    setError(null);
    try {
      await businessService.uploadDocument(docType, file);
      onChanged();
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      setError(typeof detail === 'string' ? detail : 'Upload failed.');
    } finally {
      setBusy(null);
    }
  };

  const onSubmit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await businessService.submitForReview();
      onChanged();
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      setError(typeof detail === 'string' ? detail : 'Could not submit for review.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <span className="t-eyebrow">§ Onboarding</span>
        <h2 className="t-h2" style={{ marginTop: 6 }}>
          {isDraft ? 'Upload your documents' : 'Documents'}
        </h2>
        <p className="t-lede" style={{ marginTop: 6 }}>
          {isDraft
            ? 'Provide the documents below, then submit your company for review.'
            : 'Documents submitted for your company.'}
          <span className="t-mono" style={{ marginLeft: 8, color: 'var(--t-text-3)' }}>
            {uploadedCount}/{DOC_TYPES.length} uploaded
          </span>
        </p>
      </div>

      {error && (
        <div
          style={{
            padding: '12px 14px',
            borderRadius: 8,
            border: '1px solid rgba(252,129,129,0.3)',
            background: 'rgba(252,129,129,0.08)',
            color: 'var(--t-danger)',
            fontSize: 13,
          }}
        >
          {error}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {DOC_TYPES.map((dt) => {
          const doc = company.documents.find((d) => d.doc_type === dt);
          const isUploaded = !!doc;
          return (
            <div
              key={dt}
              className="t-card-base"
              style={{
                padding: '14px 18px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 14,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span
                  className="t-mono"
                  style={{
                    width: 18,
                    color: isUploaded ? 'var(--t-ok)' : 'var(--t-text-4)',
                    fontSize: 14,
                  }}
                >
                  {isUploaded ? '✓' : '○'}
                </span>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--t-text)' }}>
                    {DOC_LABELS[dt]}
                  </div>
                  <div
                    className="t-mono"
                    style={{ fontSize: 10.5, color: 'var(--t-text-3)', letterSpacing: '0.08em' }}
                  >
                    {dt}
                    {doc && ` · ${doc.status}`}
                  </div>
                </div>
              </div>

              <label className="t-btn t-btn-secondary t-btn-sm" style={{ cursor: 'pointer' }}>
                {busy === dt ? <span className="t-spinner" /> : isUploaded ? 'Replace' : 'Upload'}
                <input
                  type="file"
                  style={{ display: 'none' }}
                  disabled={busy !== null}
                  onChange={(e) => {
                    const f = e.target.files?.[0] ?? null;
                    e.target.value = '';
                    void onUpload(dt, f);
                  }}
                />
              </label>
            </div>
          );
        })}
      </div>

      {isDraft && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            paddingTop: 16,
            borderTop: '1px solid var(--t-border)',
            flexWrap: 'wrap',
          }}
        >
          <p className="t-meta" style={{ margin: 0, maxWidth: 460 }}>
            When you have uploaded the required documents, submit your company so our team can
            validate it.
          </p>
          <button
            type="button"
            className="t-btn t-btn-primary t-btn-lg"
            disabled={!canSubmit || submitting}
            onClick={onSubmit}
          >
            {submitting && <span className="t-spinner" />}
            Submit for review
          </button>
        </div>
      )}
    </div>
  );
}

/* ============================ Services ============================ */

function ServicesSection({ company, onSaved }: { company: Company; onSaved: () => void }) {
  const [catalog, setCatalog] = useState<CatalogCategory[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set(company.enabled_task_ids));
  // Company's own price per service (dollars string), seeded from saved rates.
  const [rates, setRates] = useState<Map<string, string>>(() => {
    const m = new Map<string, string>();
    (company.services ?? []).forEach((s) => {
      if (s.rateCents != null) m.set(s.taskId, (s.rateCents / 100).toFixed(2));
    });
    return m;
  });

  useEffect(() => {
    void (async () => {
      try {
        const cats = await businessService.getCatalog();
        setCatalog(cats);
      } catch {
        setError('Could not load the service catalog.');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const toggle = (taskId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  };

  // Per-category "select all in this section" — add/remove every task of one category.
  const toggleCategory = (taskIds: string[], checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) taskIds.forEach((id) => next.add(id));
      else taskIds.forEach((id) => next.delete(id));
      return next;
    });
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const services = Array.from(selected).map((taskId) => {
        const raw = rates.get(taskId);
        const rateCents = raw && raw.trim() !== '' ? Math.round(parseFloat(raw) * 100) : null;
        return { taskId, rateCents };
      });
      const res = await businessService.setServices(services);
      setSelected(new Set(res.enabled_task_ids));
      onSaved();
    } catch (e: any) {
      const d = e?.response?.data?.detail;
      if (d?.error === 'price_out_of_range') {
        const lo = d.minCents != null ? `$${(d.minCents / 100).toFixed(0)}` : '—';
        const hi = d.maxCents != null ? `$${(d.maxCents / 100).toFixed(0)}` : '—';
        setError(`A price is outside the allowed range (${lo}–${hi}). Adjust it and save again.`);
      } else {
        setError('Could not save services.');
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <section>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          marginBottom: 14,
          flexWrap: 'wrap',
        }}
      >
        <div>
          <span className="t-eyebrow">§ Services</span>
          <h2 className="t-h2" style={{ marginTop: 6 }}>
            Enabled services
          </h2>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <span className="t-meta">{selected.size} selected</span>
          <button
            type="button"
            className="t-btn t-btn-primary t-btn-sm"
            disabled={saving || loading || !!error}
            onClick={save}
          >
            {saving && <span className="t-spinner" />}
            Save
          </button>
        </div>
      </div>

      {loading && <div className="t-meta">Loading catalog…</div>}
      {error && <div style={{ color: 'var(--t-danger)', fontSize: 13 }}>{error}</div>}

      {catalog && catalog.length === 0 && (
        <div className="t-card-base">
          <p className="t-meta">No catalog categories available.</p>
        </div>
      )}

      {catalog && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {catalog.map((cat) => {
            const catIds = cat.tasks.map((t) => t.id);
            const catAll = catIds.length > 0 && catIds.every((id) => selected.has(id));
            const catSome = catIds.some((id) => selected.has(id));
            return (
            <div key={cat.id} className="t-card-base" style={{ padding: '16px 18px' }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                  marginBottom: 12,
                }}
              >
                <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--t-text)' }}>
                  {cat.name}
                  <span
                    className="t-mono"
                    style={{ marginLeft: 8, fontSize: 11, color: 'var(--t-text-3)' }}
                  >
                    {catIds.filter((id) => selected.has(id)).length}/{cat.tasks.length}
                  </span>
                </div>
                {cat.tasks.length > 0 && (
                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 7,
                      fontSize: 12.5,
                      color: catSome ? 'var(--t-violet)' : 'var(--t-text-3)',
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={catAll}
                      ref={(el) => {
                        if (el) el.indeterminate = catSome && !catAll;
                      }}
                      onChange={(e) => toggleCategory(catIds, e.target.checked)}
                    />
                    Select all
                  </label>
                )}
              </div>
              {cat.tasks.length === 0 ? (
                <p className="t-meta">No tasks.</p>
              ) : (
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
                    gap: 8,
                  }}
                >
                  {cat.tasks.map((task) => {
                    const isSel = selected.has(task.id);
                    const lo = task.base_price_min_cents != null ? (task.base_price_min_cents / 100).toFixed(0) : null;
                    const hi = task.base_price_max_cents != null ? (task.base_price_max_cents / 100).toFixed(0) : null;
                    return (
                    <div
                      key={task.id}
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 6,
                        padding: '8px 10px',
                        border: '1px solid var(--t-border)',
                        borderRadius: 8,
                        background: isSel ? 'var(--t-deep)' : 'transparent',
                      }}
                    >
                      <label
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          fontSize: 13.5,
                          color: 'var(--t-text-2)',
                          cursor: 'pointer',
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={isSel}
                          onChange={() => toggle(task.id)}
                        />
                        <span>
                          {task.name}
                          <span
                            className="t-mono"
                            style={{ marginLeft: 6, fontSize: 10, color: 'var(--t-text-4)' }}
                          >
                            L{task.level}
                          </span>
                        </span>
                      </label>
                      {isSel && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, paddingLeft: 24 }}>
                          <span style={{ color: 'var(--t-text-3)', fontSize: 12 }}>$</span>
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            className="t-input"
                            style={{ height: 30, width: 92 }}
                            placeholder={lo && hi ? `${lo}–${hi}` : 'price'}
                            value={rates.get(task.id) ?? ''}
                            onChange={(e) =>
                              setRates((prev) => {
                                const n = new Map(prev);
                                n.set(task.id, e.target.value);
                                return n;
                              })
                            }
                          />
                          <span style={{ color: 'var(--t-text-4)', fontSize: 11 }}>
                            {task.pricing_unit ? `/${task.pricing_unit}` : ''}
                            {lo && hi ? `  (allowed $${lo}–$${hi})` : ''}
                          </span>
                        </div>
                      )}
                    </div>
                    );
                  })}
                </div>
              )}
            </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

/* ============================ Members & invites ============================ */

const ROLE_OPTIONS: { value: CompanyRole; label: string }[] = [
  { value: 'admin', label: 'Admin' },
  { value: 'supervisor', label: 'Supervisor' },
  { value: 'collaborator', label: 'Collaborator' },
];

const ROLE_CHIP: Record<CompanyRole, string> = {
  admin: 't-chip t-chip-violet',
  supervisor: 't-chip t-chip-warn',
  collaborator: 't-chip',
};

const MEMBER_STATUS_CHIP: Record<string, string> = {
  active: 't-chip t-chip-ok',
  invited: 't-chip t-chip-warn',
  disabled: 't-chip t-chip-danger',
};

function memberName(m: CompanyMember): string {
  const full = [m.first_name, m.last_name].filter(Boolean).join(' ').trim();
  return full || m.display_name || m.email || m.user_id.slice(0, 8);
}

function MembersSection({
  company,
  currentUserId,
  onChanged,
}: {
  company: Company;
  currentUserId: string | null;
  onChanged: () => void;
}) {
  const isAdmin = useMemo(
    () =>
      !!currentUserId &&
      company.members.some((m) => m.user_id === currentUserId && m.role === 'admin'),
    [company.members, currentUserId],
  );

  // ── Invite form state ──
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<CompanyRole>('collaborator');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastCode, setLastCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // ── Pending invites + member actions ──
  const [invites, setInvites] = useState<PendingInvite[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const loadInvites = useCallback(async () => {
    if (!isAdmin) return;
    try {
      const list = await businessService.listInvites();
      setInvites(list.filter((i) => i.status === 'pending'));
    } catch {
      setInvites([]);
    }
  }, [isAdmin]);

  useEffect(() => {
    void loadInvites();
  }, [loadInvites]);

  const invite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;
    setSubmitting(true);
    setError(null);
    setLastCode(null);
    try {
      const res = await businessService.createInvite(email, role);
      setLastCode(res.code);
      setEmail('');
      await loadInvites();
      onChanged();
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      setError(typeof detail === 'string' ? detail : 'Could not create the invite.');
    } finally {
      setSubmitting(false);
    }
  };

  const copyCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  const revoke = async (inviteId: string) => {
    setBusyId(inviteId);
    setActionError(null);
    try {
      await businessService.revokeInvite(inviteId);
      await loadInvites();
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      setActionError(typeof detail === 'string' ? detail : 'Could not revoke the invite.');
    } finally {
      setBusyId(null);
    }
  };

  const removeMember = async (m: CompanyMember) => {
    setBusyId(m.id);
    setActionError(null);
    try {
      await businessService.removeMember(m.id);
      onChanged();
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      setActionError(typeof detail === 'string' ? detail : 'Could not remove the member.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div>
        <span className="t-eyebrow">§ Team</span>
        <h2 className="t-h2" style={{ marginTop: 6 }}>
          Members &amp; invites
        </h2>
      </div>

      {actionError && (
        <div style={{ color: 'var(--t-danger)', fontSize: 13 }}>{actionError}</div>
      )}

      {/* Members table */}
      <div className="t-card-base" style={{ padding: 0, overflow: 'hidden' }}>
        <table className="t-table" style={{ border: 'none', width: '100%' }}>
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Status</th>
              {isAdmin && <th style={{ textAlign: 'right' }}>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {company.members.map((m) => {
              const isSelf = m.user_id === currentUserId;
              const canRemove = isAdmin && !isSelf && m.status !== 'disabled';
              return (
                <tr key={m.id}>
                  <td style={{ color: 'var(--t-text)' }}>
                    {memberName(m)}
                    {isSelf && (
                      <span className="t-mono" style={{ marginLeft: 8, fontSize: 10, color: 'var(--t-text-4)' }}>
                        you
                      </span>
                    )}
                  </td>
                  <td className="t-mono" style={{ fontSize: 12, color: 'var(--t-text-2)' }}>
                    {m.email ?? '—'}
                  </td>
                  <td>
                    <span className={`${ROLE_CHIP[m.role] ?? 't-chip'} t-chip-mono`}>{m.role}</span>
                  </td>
                  <td>
                    <span className={`${MEMBER_STATUS_CHIP[m.status] ?? 't-chip'} t-chip-mono`}>
                      {m.status}
                    </span>
                  </td>
                  {isAdmin && (
                    <td style={{ textAlign: 'right' }}>
                      {canRemove ? (
                        <button
                          type="button"
                          className="t-btn t-btn-danger t-btn-sm"
                          disabled={busyId === m.id}
                          onClick={() => removeMember(m)}
                        >
                          {busyId === m.id && <span className="t-spinner" />}
                          Remove
                        </button>
                      ) : (
                        <span className="t-meta" style={{ fontSize: 12 }}>
                          —
                        </span>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
            {company.members.length === 0 && (
              <tr>
                <td colSpan={isAdmin ? 5 : 4} className="t-meta">
                  No members yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pending invites */}
      {isAdmin && invites && invites.length > 0 && (
        <div>
          <h3 className="t-h3" style={{ marginBottom: 10 }}>
            Pending invites
          </h3>
          <div className="t-card-base" style={{ padding: 0, overflow: 'hidden' }}>
            <table className="t-table" style={{ border: 'none', width: '100%' }}>
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Code</th>
                  <th>Expires</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {invites.map((inv) => (
                  <tr key={inv.id}>
                    <td style={{ color: 'var(--t-text)' }}>{inv.email}</td>
                    <td>
                      <span className={`${ROLE_CHIP[inv.role] ?? 't-chip'} t-chip-mono`}>
                        {inv.role}
                      </span>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="t-mono"
                        title="Copy code"
                        onClick={() => copyCode(inv.code)}
                        style={{
                          appearance: 'none',
                          background: 'none',
                          border: 'none',
                          cursor: 'pointer',
                          padding: 0,
                          fontSize: 13,
                          letterSpacing: '0.1em',
                          color: 'var(--t-violet)',
                          fontWeight: 700,
                        }}
                      >
                        {inv.code}
                      </button>
                    </td>
                    <td className="t-mono" style={{ fontSize: 12, color: 'var(--t-text-3)' }}>
                      {new Date(inv.expires_at).toLocaleDateString()}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <button
                        type="button"
                        className="t-btn t-btn-danger t-btn-sm"
                        disabled={busyId === inv.id}
                        onClick={() => revoke(inv.id)}
                      >
                        {busyId === inv.id && <span className="t-spinner" />}
                        Revoke
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Invite form */}
      {isAdmin && (
        <div className="t-card-base">
          <div className="t-h3" style={{ marginBottom: 4 }}>
            Invite a team member
          </div>
          <p className="t-meta" style={{ marginBottom: 14 }}>
            Pick a role and generate an invite code to share manually — no email is sent.
          </p>
          <form onSubmit={invite} style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <input
              className="t-input"
              type="email"
              required
              placeholder="teammate@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={{ flex: 1, minWidth: 240 }}
            />
            <select
              className="t-select"
              value={role}
              onChange={(e) => setRole(e.target.value as CompanyRole)}
              style={{ minWidth: 160 }}
            >
              {ROLE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <button type="submit" className="t-btn t-btn-primary" disabled={submitting}>
              {submitting && <span className="t-spinner" />}
              Generate invite
            </button>
          </form>

          {error && (
            <div style={{ color: 'var(--t-danger)', fontSize: 13, marginTop: 12 }}>{error}</div>
          )}

          {lastCode && (
            <div
              style={{
                marginTop: 16,
                padding: 16,
                borderRadius: 8,
                border: '1px solid var(--t-violet-line)',
                background: 'var(--t-violet-wash)',
              }}
            >
              <div className="t-label" style={{ color: 'var(--t-violet)' }}>
                Invite code — share with your team member
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 6 }}>
                <span
                  className="t-mono"
                  style={{
                    fontSize: 24,
                    letterSpacing: '0.2em',
                    color: 'var(--t-text)',
                    fontWeight: 700,
                  }}
                >
                  {lastCode}
                </span>
                <button
                  type="button"
                  className="t-btn t-btn-secondary t-btn-sm"
                  onClick={() => copyCode(lastCode)}
                >
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
