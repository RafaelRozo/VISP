import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  adminService,
  CompanyListItem,
  CompanyDetail,
  CompanyDocument,
} from '@/services/adminService';
import { Config } from '@/services/config';

function resolveDocUrl(url: string | null): string | null {
  if (!url) return null;
  if (url.startsWith('http')) return url;
  const origin = Config.mediaOrigin.replace(/\/$/, '');
  const path = url.startsWith('/') ? url : `/${url}`;
  return origin + path;
}

const DOC_TYPE_LABELS: Record<string, string> = {
  legal_info: 'Legal Info',
  business_registration: 'Business Registration',
  business_number_tax: 'Business Number / Tax',
  owner_id: 'Owner ID',
  authority_proof: 'Proof of Authority',
  address_proof: 'Proof of Address',
  banking: 'Banking',
  insurance: 'Insurance',
  license_cert: 'License / Certification',
  operational_profile: 'Operational Profile',
};

function docTypeLabel(t: string): string {
  return DOC_TYPE_LABELS[t] ?? t.replaceAll('_', ' ');
}

function statusChipClass(status: string): string {
  const s = status.toLowerCase();
  if (s === 'approved' || s === 'validated' || s === 'active') return 't-chip t-chip-mono t-chip-green';
  if (s === 'rejected') return 't-chip t-chip-mono t-chip-red';
  if (s.includes('pending') || s.includes('review')) return 't-chip t-chip-mono t-chip-violet';
  return 't-chip t-chip-mono';
}

type StatusFilter = 'pending_review' | 'all';

export default function Businesses() {
  const { t } = useTranslation();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('pending_review');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const q = useQuery<CompanyListItem[]>({
    queryKey: ['admin-companies', statusFilter],
    queryFn: () =>
      adminService.listCompanies(statusFilter === 'all' ? undefined : statusFilter),
  });

  const companies = q.data ?? [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div className="t-section-head" style={{ marginBottom: 0 }}>
        <span className="t-eyebrow">§ Compliance</span>
        <h1 className="t-h1" style={{ marginTop: 8 }}>
          {t('businesses.title', 'Businesses')}
        </h1>
        <p className="t-lede" style={{ marginTop: 8 }}>
          {t('businesses.subtitle', 'Review and validate business registrations.')}
        </p>
      </div>

      {/* Status filter */}
      <FilterGroup label={t('filters.status', 'Status')}>
        <Pill
          active={statusFilter === 'pending_review'}
          onClick={() => setStatusFilter('pending_review')}
        >
          {t('businesses.pendingReview', 'Pending review')}
        </Pill>
        <Pill active={statusFilter === 'all'} onClick={() => setStatusFilter('all')}>
          {t('filters.all', 'All')}
        </Pill>
      </FilterGroup>

      {q.isLoading && <div className="t-meta">{t('common.loading', 'Loading…')}</div>}

      {!q.isLoading && companies.length === 0 && (
        <div className="t-empty">
          <h3>{t('businesses.empty', 'No businesses to review.')}</h3>
        </div>
      )}

      {/* Companies table */}
      {!q.isLoading && companies.length > 0 && (
        <div className="t-card-base" style={{ overflow: 'hidden' }}>
          <table className="t-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <Th>{t('businesses.legalName', 'Legal name')}</Th>
                <Th>{t('businesses.status', 'Status')}</Th>
                <Th>{t('businesses.created', 'Created')}</Th>
              </tr>
            </thead>
            <tbody>
              {companies.map((c) => (
                <tr
                  key={c.id}
                  onClick={() => setSelectedId(c.id)}
                  style={{ cursor: 'pointer', borderTop: '1px solid var(--t-border)' }}
                  className="t-row-hover"
                >
                  <Td>
                    <span style={{ fontWeight: 600, color: 'var(--t-text)' }}>
                      {c.legal_name}
                    </span>
                  </Td>
                  <Td>
                    <span className={statusChipClass(c.status)}>
                      {c.status.replaceAll('_', ' ')}
                    </span>
                  </Td>
                  <Td>
                    <span className="t-mono" style={{ fontSize: 12, color: 'var(--t-text-3)' }}>
                      {c.created_at ? new Date(c.created_at).toLocaleDateString() : '—'}
                    </span>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selectedId && (
        <CompanyDetailModal
          companyId={selectedId}
          onClose={() => setSelectedId(null)}
          listStatusFilter={statusFilter}
        />
      )}
    </div>
  );
}

function CompanyDetailModal({
  companyId,
  onClose,
  listStatusFilter,
}: {
  companyId: string;
  onClose: () => void;
  listStatusFilter: StatusFilter;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [previewDoc, setPreviewDoc] = useState<CompanyDocument | null>(null);
  const [rejectingDocId, setRejectingDocId] = useState<string | null>(null);
  const [docRejectNote, setDocRejectNote] = useState('');
  const [companyRejectOpen, setCompanyRejectOpen] = useState(false);
  const [companyRejectNote, setCompanyRejectNote] = useState('');

  const detailKey = ['admin-company', companyId];

  const q = useQuery<CompanyDetail>({
    queryKey: detailKey,
    queryFn: () => adminService.getCompany(companyId),
  });

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: detailKey });
    qc.invalidateQueries({ queryKey: ['admin-companies', listStatusFilter] });
  };

  const approveDoc = useMutation({
    mutationFn: (docId: string) => adminService.approveCompanyDocument(docId),
    onSuccess: () => invalidateAll(),
  });

  const rejectDoc = useMutation({
    mutationFn: ({ docId, reason }: { docId: string; reason: string }) =>
      adminService.rejectCompanyDocument(docId, reason),
    onSuccess: () => {
      invalidateAll();
      setRejectingDocId(null);
      setDocRejectNote('');
    },
  });

  const validateCompany = useMutation({
    mutationFn: () => adminService.validateCompany(companyId),
    onSuccess: () => {
      invalidateAll();
      onClose();
    },
    // Backend now returns 400 if not every document is APPROVED — surface it.
    onError: () => { /* error shown inline via validateCompany.error below */ },
  });

  const rejectCompany = useMutation({
    mutationFn: (reason: string) => adminService.rejectCompany(companyId, reason),
    onSuccess: () => {
      invalidateAll();
      setCompanyRejectOpen(false);
      setCompanyRejectNote('');
      onClose();
    },
  });

  const company = q.data;
  // A business may only be validated once EVERY uploaded document is approved
  // (mirrors the backend gate). Disable the button proactively + explain why.
  const companyDocs = company?.documents ?? [];
  const allDocsApproved =
    companyDocs.length > 0 && companyDocs.every((d) => d.status === 'approved');
  const previewUrl = previewDoc ? resolveDocUrl(previewDoc.document_url) : null;
  const previewKind = previewUrl ? inferMimeKind(previewUrl) : 'other';

  return (
    <div className="t-modal-backdrop" onClick={onClose}>
      <div
        className="t-modal"
        style={{ maxWidth: 760, maxHeight: '90vh' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="t-modal-head">
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 16, color: 'var(--t-text)' }}>
              {company?.legal_name ?? t('common.loading', 'Loading…')}
            </div>
            {company && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                <span className={statusChipClass(company.status)}>
                  {company.status.replaceAll('_', ' ')}
                </span>
                {company.trade_name && (
                  <span className="t-chip t-chip-mono">{company.trade_name}</span>
                )}
              </div>
            )}
          </div>
          <button type="button" onClick={onClose} className="t-btn t-btn-ghost t-btn-sm">
            ✕
          </button>
        </div>

        <div style={{ flex: 1, overflow: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 20 }}>
          {q.isLoading && <div className="t-meta">{t('common.loading', 'Loading…')}</div>}

          {company && (
            <>
              {/* Company info */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <InfoRow label={t('businesses.address', 'Address')} value={company.business_address} />
                <InfoRow label={t('businesses.phone', 'Phone')} value={company.phone} />
                <InfoRow label={t('businesses.email', 'Email')} value={company.email} />
                <InfoRow label={t('businesses.website', 'Website')} value={company.website} />
                {company.rejection_reason && (
                  <InfoRow
                    label={t('businesses.rejectionReason', 'Rejection reason')}
                    value={company.rejection_reason}
                  />
                )}
              </div>

              {/* Documents */}
              <div>
                <div className="t-eyebrow" style={{ marginBottom: 10 }}>
                  {t('businesses.documents', 'Documents')}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {company.documents.length === 0 && (
                    <div className="t-meta">{t('businesses.noDocuments', 'No documents uploaded.')}</div>
                  )}
                  {company.documents.map((d) => {
                    const docUrl = resolveDocUrl(d.document_url);
                    const isRejecting = rejectingDocId === d.id;
                    return (
                      <div key={d.id} className="t-card-base" style={{ padding: 14 }}>
                        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
                          <div style={{ flex: 1, minWidth: 200 }}>
                            <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--t-text)' }}>
                              {docTypeLabel(d.doc_type)}
                            </div>
                            <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                              <span className={statusChipClass(d.status)}>
                                {d.status.replaceAll('_', ' ')}
                              </span>
                            </div>
                            {d.rejection_reason && (
                              <div style={{ marginTop: 6, fontSize: 12, color: 'var(--t-text-3)' }}>
                                {d.rejection_reason}
                              </div>
                            )}
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            {docUrl && (
                              <button
                                type="button"
                                onClick={() => setPreviewDoc(d)}
                                className="t-btn t-btn-secondary t-btn-sm"
                              >
                                {t('documents.view', 'View')}
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => approveDoc.mutate(d.id)}
                              disabled={approveDoc.isPending}
                              className="t-btn t-btn-success t-btn-sm"
                            >
                              {t('common.approve', 'Approve')}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setRejectingDocId(isRejecting ? null : d.id);
                                setDocRejectNote('');
                              }}
                              className="t-btn t-btn-danger t-btn-sm"
                            >
                              {t('common.reject', 'Reject')}
                            </button>
                          </div>
                        </div>

                        {isRejecting && (
                          <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--t-border)', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                            <input
                              autoFocus
                              type="text"
                              value={docRejectNote}
                              placeholder={t('documents.rejectPlaceholder', 'Reason for rejection…')}
                              onChange={(e) => setDocRejectNote(e.target.value)}
                              className="t-input"
                              style={{ flex: 1, minWidth: 220 }}
                            />
                            <button
                              type="button"
                              disabled={!docRejectNote.trim() || rejectDoc.isPending}
                              onClick={() => rejectDoc.mutate({ docId: d.id, reason: docRejectNote.trim() })}
                              className="t-btn t-btn-danger"
                            >
                              {t('common.reject', 'Reject')}
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Company-level actions */}
        {company && (
          <div className="t-modal-foot" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 10 }}>
            {companyRejectOpen && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <input
                  autoFocus
                  type="text"
                  value={companyRejectNote}
                  placeholder={t('businesses.rejectPlaceholder', 'Reason for rejecting this business…')}
                  onChange={(e) => setCompanyRejectNote(e.target.value)}
                  className="t-input"
                  style={{ flex: 1, minWidth: 240 }}
                />
                <button
                  type="button"
                  disabled={!companyRejectNote.trim() || rejectCompany.isPending}
                  onClick={() => rejectCompany.mutate(companyRejectNote.trim())}
                  className="t-btn t-btn-danger"
                >
                  {t('businesses.confirmReject', 'Confirm reject')}
                </button>
              </div>
            )}
            {validateCompany.isError && (
              <div style={{ marginBottom: 8, fontSize: 13, color: 'var(--t-danger)' }}>
                {(validateCompany.error as Error)?.message ||
                  t('businesses.validateFailed', 'Could not validate the business.')}
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 8 }}>
              {!allDocsApproved && (
                <span style={{ fontSize: 12, color: 'var(--t-text-3)', marginRight: 'auto' }}>
                  {t('businesses.approveAllDocsFirst', 'Approve every document before validating.')}
                </span>
              )}
              <button
                type="button"
                onClick={() => {
                  setCompanyRejectOpen((v) => !v);
                  setCompanyRejectNote('');
                }}
                className="t-btn t-btn-danger"
              >
                {t('businesses.rejectBusiness', 'Reject business')}
              </button>
              <button
                type="button"
                onClick={() => validateCompany.mutate()}
                disabled={validateCompany.isPending || !allDocsApproved}
                title={!allDocsApproved ? t('businesses.approveAllDocsFirst', 'Approve every document before validating.') : undefined}
                className="t-btn t-btn-success"
              >
                {t('businesses.validateBusiness', 'Validate business')}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Document preview modal */}
      {previewDoc && previewUrl && (
        <div className="t-modal-backdrop" onClick={() => setPreviewDoc(null)}>
          <div
            className="t-modal"
            style={{ maxWidth: 900, height: '90vh' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="t-modal-head">
              <div style={{ fontWeight: 600, fontSize: 15, color: 'var(--t-text)' }}>
                {docTypeLabel(previewDoc.doc_type)}
              </div>
              <button
                type="button"
                onClick={() => setPreviewDoc(null)}
                className="t-btn t-btn-ghost t-btn-sm"
              >
                ✕
              </button>
            </div>
            <div style={{ flex: 1, overflow: 'auto', background: 'var(--t-deep)', display: 'grid', placeItems: 'center', padding: 10, minHeight: 300 }}>
              {previewKind === 'image' && (
                <img src={previewUrl} alt={previewDoc.doc_type} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
              )}
              {previewKind === 'pdf' && (
                <iframe src={previewUrl} title={previewDoc.doc_type} style={{ width: '100%', height: '100%', background: 'white', borderRadius: 4, border: 'none' }} />
              )}
              {previewKind === 'other' && (
                <div style={{ textAlign: 'center', color: 'var(--t-text-2)', padding: 20 }}>
                  <p>{t('documents.cannotPreview', 'Cannot preview this file type.')}</p>
                  <a href={previewUrl} target="_blank" rel="noreferrer" className="t-btn t-btn-secondary t-btn-sm" style={{ marginTop: 12 }}>
                    {t('documents.openInNewTab', 'Open in new tab')}
                  </a>
                </div>
              )}
            </div>
            <div className="t-modal-foot">
              <a href={previewUrl} target="_blank" rel="noreferrer" className="t-btn t-btn-secondary">
                {t('documents.openInNewTab', 'Open in new tab')}
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function inferMimeKind(url: string): 'image' | 'pdf' | 'other' {
  const u = url.toLowerCase().split('?')[0];
  if (u.endsWith('.pdf')) return 'pdf';
  if (/\.(png|jpe?g|gif|webp|heic|heif|bmp)$/.test(u)) return 'image';
  return 'other';
}

function InfoRow({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'baseline' }}>
      <span
        className="t-mono"
        style={{ fontSize: 10.5, color: 'var(--t-text-4)', letterSpacing: '0.12em', textTransform: 'uppercase', minWidth: 110 }}
      >
        {label}
      </span>
      <span style={{ fontSize: 13.5, color: 'var(--t-text-2)', wordBreak: 'break-word' }}>
        {value}
      </span>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th
      className="t-mono"
      style={{
        textAlign: 'left',
        padding: '12px 16px',
        fontSize: 10.5,
        color: 'var(--t-text-4)',
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        fontWeight: 600,
      }}
    >
      {children}
    </th>
  );
}

function Td({ children }: { children: React.ReactNode }) {
  return <td style={{ padding: '12px 16px', verticalAlign: 'middle' }}>{children}</td>;
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
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{children}</div>
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
