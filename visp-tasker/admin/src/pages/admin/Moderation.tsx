/**
 * Moderación — denuncias y bloqueos entre usuarios (Apple, guía 1.2).
 *
 * Dos pestañas:
 *   - Denuncias: la cola. Cada una trae una COPIA del contenido tal como estaba
 *     al denunciarlo, así que la prueba se ve aunque el autor lo haya borrado.
 *     Las abiertas desde hace más de 24 h salen en rojo: es el plazo que
 *     prometemos a Apple y en los Términos v2.1.
 *   - Bloqueos: buscar por nombre o email (de cualquiera de los dos lados) y
 *     desbloquear. En la app no hay botón de desbloquear: quien lo quiera
 *     escribe a soporte (decisión de Ricardo, 2026-10-06). La nota es obligatoria.
 *
 * Ver `docs/plan-denunciar-bloquear.md`.
 */

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  adminService,
  type ContentReport,
  type ReportAction,
  type UserBlockRow,
} from '@/services/adminService';
import { useAuthStore } from '@/stores/authStore';
import { Config } from '@/services/config';

type Tab = 'reports' | 'blocks';
type StatusFilter = 'OPEN' | 'ACTIONED' | 'DISMISSED' | 'all';

function mediaUrl(url: string): string {
  if (url.startsWith('http')) return url;
  const origin = Config.mediaOrigin.replace(/\/$/, '');
  return origin + (url.startsWith('/') ? url : `/${url}`);
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function Moderation() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const isSuper = useAuthStore((s) => s.user?.role === 'super_admin');

  const [tab, setTab] = useState<Tab>('reports');
  const [status, setStatus] = useState<StatusFilter>('OPEN');
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');

  // Igual que en Users: una consulta cuando se deja de teclear, no una por tecla.
  useEffect(() => {
    const id = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(id);
  }, [search]);

  const qReports = useQuery<ContentReport[]>({
    queryKey: ['content-reports', status],
    queryFn: () => adminService.contentReports(status),
    enabled: tab === 'reports',
  });

  const qBlocks = useQuery<UserBlockRow[]>({
    queryKey: ['user-blocks', q],
    queryFn: () => adminService.userBlocks(q || undefined),
    enabled: tab === 'blocks',
  });

  const resolve = useMutation({
    mutationFn: (v: { id: string; action: ReportAction; note?: string }) =>
      adminService.resolveReport(v.id, v.action, v.note),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['content-reports'] });
      qc.invalidateQueries({ queryKey: ['reports-summary'] });
    },
    onError: (e: unknown) => alert((e as { message?: string })?.message ?? 'Error'),
  });

  const unblock = useMutation({
    mutationFn: (v: { id: string; note: string }) => adminService.unblock(v.id, v.note),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['user-blocks'] }),
    onError: (e: unknown) => alert((e as { message?: string })?.message ?? 'Error'),
  });

  const act = (r: ContentReport, action: ReportAction) => {
    const name = r.reported?.name || r.reported?.email || '';
    if (action === 'ban' && !confirm(t('moderation.confirmBan', { name }))) return;
    if (action === 'suspend' && !confirm(t('moderation.confirmSuspend', { name }))) return;
    const note = prompt(t('moderation.notePrompt'));
    if (note === null) return;
    resolve.mutate({ id: r.id, action, note: note.trim() || undefined });
  };

  const doUnblock = (b: UserBlockRow) => {
    const note = prompt(t('moderation.unblockPrompt'));
    if (!note || !note.trim()) return;
    unblock.mutate({ id: b.id, note: note.trim() });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div className="t-section-head" style={{ marginBottom: 0 }}>
        <span className="t-eyebrow">§ Trust &amp; Safety</span>
        <h1 className="t-h1" style={{ marginTop: 8 }}>{t('moderation.title')}</h1>
        <p className="t-lede" style={{ marginTop: 8 }}>{t('moderation.subtitle')}</p>
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <Pill active={tab === 'reports'} onClick={() => setTab('reports')}>
          {t('moderation.tabReports')}
        </Pill>
        <Pill active={tab === 'blocks'} onClick={() => setTab('blocks')}>
          {t('moderation.tabBlocks')}
        </Pill>
      </div>

      {/* ── Denuncias ─────────────────────────────────────────────── */}
      {tab === 'reports' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {(['OPEN', 'ACTIONED', 'DISMISSED', 'all'] as StatusFilter[]).map((s) => (
              <Pill key={s} active={status === s} onClick={() => setStatus(s)}>
                {t(
                  s === 'OPEN'
                    ? 'moderation.statusOpen'
                    : s === 'ACTIONED'
                      ? 'moderation.statusActioned'
                      : s === 'DISMISSED'
                        ? 'moderation.statusDismissed'
                        : 'moderation.statusAll',
                )}
              </Pill>
            ))}
          </div>

          {qReports.isLoading ? (
            <div className="t-lede">{t('common.loading')}</div>
          ) : (qReports.data ?? []).length === 0 ? (
            <div className="t-lede">{t('moderation.none')}</div>
          ) : (
            (qReports.data ?? []).map((r) => (
              <ReportCard
                key={r.id}
                r={r}
                isSuper={isSuper}
                busy={resolve.isPending}
                onAct={(a) => act(r, a)}
              />
            ))
          )}
        </div>
      ) : null}

      {/* ── Bloqueos ──────────────────────────────────────────────── */}
      {tab === 'blocks' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Mismo buscador que Users: nombre o email, de quien bloqueó o del bloqueado. */}
          <div className="t-search" style={{ maxWidth: 480 }}>
            <SearchIcon />
            <input
              type="search"
              placeholder={t('moderation.searchPlaceholder')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          {qBlocks.isLoading ? (
            <div className="t-lede">{t('common.loading')}</div>
          ) : (qBlocks.data ?? []).length === 0 ? (
            <div className="t-lede">{t('moderation.noBlocks')}</div>
          ) : (
            <div className="t-card" style={{ padding: 0, overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: 'var(--t-text-3)' }}>
                    <th style={th}>{t('moderation.blocker')}</th>
                    <th style={th}>{t('moderation.blockedUser')}</th>
                    <th style={th}>{t('moderation.source')}</th>
                    <th style={th}>{t('moderation.date')}</th>
                    <th style={th} />
                  </tr>
                </thead>
                <tbody>
                  {(qBlocks.data ?? []).map((b) => (
                    <tr key={b.id} style={{ borderTop: '1px solid var(--t-border)' }}>
                      <td style={td}><Person p={b.blocker} /></td>
                      <td style={td}><Person p={b.blocked} /></td>
                      <td style={td}>
                        <span className="t-chip t-chip-mono">{t(`moderation.sources.${b.source}`)}</span>
                      </td>
                      <td style={td}>{fmtDate(b.createdAt)}</td>
                      <td style={{ ...td, textAlign: 'right' }}>
                        <button
                          className="t-btn t-btn-ghost t-btn-sm"
                          disabled={unblock.isPending}
                          onClick={() => doUnblock(b)}
                        >
                          {t('moderation.unblock')}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------

function ReportCard({
  r,
  isSuper,
  busy,
  onAct,
}: {
  r: ContentReport;
  isSuper: boolean;
  busy: boolean;
  onAct: (a: ReportAction) => void;
}) {
  const { t } = useTranslation();
  const snap = r.snapshot as {
    message?: string;
    details?: string | null;
    extraNote?: string | null;
    evidence?: string[];
    bio?: string | null;
    avatarUrl?: string | null;
    jobReference?: string;
  };
  // Solo hay algo que "quitar" cuando la denuncia es sobre un contenido concreto.
  const removable = r.contentType !== 'USER';

  return (
    <div
      className="t-card"
      style={{
        padding: 14,
        borderColor: r.overdue ? 'var(--t-danger)' : undefined,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 600 }}>{t(`moderation.types.${r.contentType}`)}</span>
            <span className="t-chip t-chip-mono">{t(`moderation.reasons.${r.reason}`)}</span>
            {r.source === 'AUTO_FILTER' ? (
              <span className="t-chip t-chip-mono">{t('moderation.auto')}</span>
            ) : null}
            {r.overdue ? (
              <span className="t-chip t-chip-mono" style={{ color: 'var(--t-danger)' }}>
                {t('moderation.overdue')}
              </span>
            ) : null}
            {snap.jobReference ? (
              <span className="t-chip t-chip-mono" style={{ fontSize: 10 }}>{snap.jobReference}</span>
            ) : null}
          </div>

          <div style={{ fontSize: 12, color: 'var(--t-text-3)', marginTop: 6 }}>
            {t('moderation.reported')}: <Person p={r.reported} />
            {r.reporter ? (
              <>
                {' · '}
                {t('moderation.reportedBy')}: <Person p={r.reporter} />
              </>
            ) : null}
            {' · '}
            {fmtDate(r.createdAt)}
          </div>

          {/* Lo denunciado, tal como estaba */}
          <div
            style={{
              marginTop: 10,
              padding: 10,
              borderRadius: 8,
              background: 'var(--t-deep)',
              fontSize: 13,
              lineHeight: 1.5,
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
            }}
          >
            {snap.message ? (
              <div><b>{t('moderation.snapshotMessage')}:</b> “{snap.message}”</div>
            ) : null}
            {snap.details ? (
              <div><b>{t('moderation.snapshotDetails')}:</b> {snap.details}</div>
            ) : null}
            {snap.extraNote ? (
              <div><b>{t('moderation.snapshotExtraNote')}:</b> {snap.extraNote}</div>
            ) : null}
            {snap.bio ? (
              <div><b>{t('moderation.snapshotBio')}:</b> {snap.bio}</div>
            ) : null}
            {[...(snap.evidence ?? []), ...(snap.avatarUrl ? [snap.avatarUrl] : [])].length > 0 ? (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {[...(snap.evidence ?? []), ...(snap.avatarUrl ? [snap.avatarUrl] : [])].map((u) => (
                  <a key={u} href={mediaUrl(u)} target="_blank" rel="noreferrer">
                    <img
                      src={mediaUrl(u)}
                      alt=""
                      style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 6 }}
                    />
                  </a>
                ))}
              </div>
            ) : null}
            {r.note ? <div style={{ color: 'var(--t-text-2)' }}>“{r.note}”</div> : null}
          </div>

          {r.status !== 'OPEN' ? (
            <div style={{ fontSize: 12, color: 'var(--t-text-3)', marginTop: 8 }}>
              {t('moderation.resolution')}: <span className="t-chip t-chip-mono">{r.adminAction}</span>
              {r.adminNote ? ` — ${r.adminNote}` : ''}
            </div>
          ) : null}
        </div>

        {r.status === 'OPEN' ? (
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            {removable ? (
              <button className="t-btn t-btn-primary t-btn-sm" disabled={busy} onClick={() => onAct('remove_content')}>
                {t('moderation.actRemove')}
              </button>
            ) : null}
            <button
              className="t-btn t-btn-ghost t-btn-sm"
              disabled={busy || !isSuper}
              title={isSuper ? undefined : t('moderation.superOnly')}
              onClick={() => onAct('suspend')}
            >
              {t('moderation.actSuspend')}
            </button>
            <button
              className="t-btn t-btn-ghost t-btn-sm"
              style={{ color: 'var(--t-danger)' }}
              disabled={busy || !isSuper}
              title={isSuper ? undefined : t('moderation.superOnly')}
              onClick={() => onAct('ban')}
            >
              {t('moderation.actBan')}
            </button>
            <button className="t-btn t-btn-ghost t-btn-sm" disabled={busy} onClick={() => onAct('dismiss')}>
              {t('moderation.actDismiss')}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Person({ p }: { p: { name: string | null; email: string; status: string } | null }) {
  if (!p) return <span>—</span>;
  return (
    <span>
      {p.name || p.email}{' '}
      <span style={{ color: 'var(--t-text-4)' }}>({p.email})</span>
      {p.status !== 'ACTIVE' && p.status !== 'active' ? (
        <span className="t-chip t-chip-mono" style={{ marginLeft: 4, fontSize: 10 }}>{p.status}</span>
      ) : null}
    </span>
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

const th: React.CSSProperties = { padding: '10px 12px', fontWeight: 500, fontSize: 12 };
const td: React.CSSProperties = { padding: '10px 12px', verticalAlign: 'top' };
