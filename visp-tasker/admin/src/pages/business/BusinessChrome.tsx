/**
 * Shared chrome for the /business section: the VISP sprite + a top bar.
 * Matches the admin console's monochrome look (theme.css tokens).
 */
import { Link } from 'react-router-dom';
import LangSwitcher from '@/components/LangSwitcher';
import { CompanyStatus } from '@/services/businessService';

export function VispSprite() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
      <defs>
        <symbol id="visp-mark" viewBox="0 0 64 64">
          <circle cx="32" cy="32" r="26" fill="none" stroke="#2A2A2A" strokeWidth="2.5" />
          <path d="M 32 6 A 26 26 0 0 1 26 57.3" fill="none" stroke="#FFFFFF" strokeWidth="2.5" strokeLinecap="round" />
          <path d="M 9.2 22.5 A 26 26 0 0 1 12.5 16.4" fill="none" stroke="#FFFFFF" strokeWidth="2.5" strokeLinecap="round" />
          <path d="M 19.5 22 L 32 45 L 44.5 22" fill="none" stroke="#FFFFFF" strokeWidth="5.5" strokeLinejoin="miter" strokeLinecap="butt" />
        </symbol>
      </defs>
    </svg>
  );
}

export function BusinessTopBar({ right }: { right?: React.ReactNode }) {
  return (
    <header
      className="flex items-center justify-between px-6 lg:px-10"
      style={{ height: 64, borderBottom: '1px solid var(--t-border)' }}
    >
      <Link to="/" className="flex items-center gap-3" style={{ color: 'var(--t-text)' }}>
        <svg style={{ width: 28, height: 28 }}>
          <use href="#visp-mark" />
        </svg>
        <div className="leading-tight">
          <div className="font-bold" style={{ fontSize: 16, letterSpacing: '0.04em' }}>
            VISP
          </div>
          <div
            className="t-mono"
            style={{
              fontSize: 10,
              color: 'var(--t-text-3)',
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
            }}
          >
            For Business
          </div>
        </div>
      </Link>
      <div className="flex items-center gap-4">
        {right}
        <LangSwitcher />
      </div>
    </header>
  );
}

const STATUS_META: Record<
  CompanyStatus,
  { label: string; chip: string }
> = {
  draft: { label: 'Draft', chip: 't-chip' },
  pending_review: { label: 'In validation', chip: 't-chip t-chip-warn' },
  validated: { label: 'Validated', chip: 't-chip t-chip-ok' },
  rejected: { label: 'Rejected', chip: 't-chip t-chip-danger' },
};

export function StatusBadge({ status }: { status: CompanyStatus }) {
  const meta = STATUS_META[status] ?? STATUS_META.draft;
  return <span className={`${meta.chip} t-chip-mono`}>{meta.label}</span>;
}
