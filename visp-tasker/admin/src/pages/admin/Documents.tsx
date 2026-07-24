import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { adminService, PendingCredential, LICENSE_CLASSES } from '@/services/adminService';
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
