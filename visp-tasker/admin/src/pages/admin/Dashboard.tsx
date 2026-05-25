import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { adminService, DashboardCharts, DashboardStats } from '@/services/adminService';

type Period = '7d' | '30d' | '90d';

const ACCENT = '#A78BFA';
const OK = '#9AE6B4';
const WARN = '#F6AD55';

function fmtMoney(cents: number): string {
  return `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function StatCard({
  num,
  label,
  value,
  accent,
}: {
  num: string;
  label: string;
  value: string | number;
  accent?: 'violet' | 'ok' | 'warn';
}) {
  const valueColor =
    accent === 'violet' ? ACCENT : accent === 'ok' ? OK : accent === 'warn' ? WARN : 'var(--t-text)';
  return (
    <div className="t-card-base" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div className="flex items-center justify-between">
        <span className="t-eyebrow">{label}</span>
        <span className="t-mono" style={{ fontSize: 10, color: 'var(--t-text-4)', letterSpacing: '0.12em' }}>
          {num}
        </span>
      </div>
      <span style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-0.025em', color: valueColor, lineHeight: 1 }}>
        {value}
      </span>
    </div>
  );
}

const tooltipStyle = {
  background: '#111111',
  border: '1px solid #2E2E2E',
  borderRadius: 8,
  fontFamily: 'JetBrains Mono, monospace',
  fontSize: 12,
};
const axisTick = { fill: '#6A6A6A', fontSize: 10.5, fontFamily: 'JetBrains Mono, monospace' };

export default function Dashboard() {
  const { t } = useTranslation();
  const [period, setPeriod] = useState<Period>('30d');

  const statsQ = useQuery<DashboardStats>({
    queryKey: ['admin-stats'],
    queryFn: () => adminService.dashboardStats(),
  });

  const chartsQ = useQuery<DashboardCharts>({
    queryKey: ['admin-charts', period],
    queryFn: () => adminService.dashboardCharts(period),
  });

  const stats = statsQ.data;
  const charts = chartsQ.data;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
      {/* Header */}
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div className="t-section-head" style={{ marginBottom: 0 }}>
          <span className="t-eyebrow">§ Overview</span>
          <h1 className="t-h1" style={{ marginTop: 8 }}>{t('dashboard.title')}</h1>
        </div>
        <div
          style={{
            display: 'inline-flex',
            background: 'var(--t-deep)',
            border: '1px solid var(--t-border)',
            borderRadius: 'var(--t-r)',
            padding: 4,
            gap: 2,
          }}
        >
          {(['7d', '30d', '90d'] as Period[]).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPeriod(p)}
              className="t-mono"
              style={{
                padding: '6px 12px',
                borderRadius: 6,
                fontSize: 11,
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                background: period === p ? 'var(--t-card)' : 'transparent',
                color: period === p ? 'var(--t-text)' : 'var(--t-text-3)',
                border: period === p ? '1px solid var(--t-border-strong)' : '1px solid transparent',
                cursor: 'pointer',
                transition: 'background-color .15s, color .15s',
              }}
            >
              {t(`dashboard.period${p === '7d' ? '7d' : p === '30d' ? '30d' : '90d'}`)}
            </button>
          ))}
        </div>
      </div>

      {/* KPI grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))',
          gap: 10,
        }}
      >
        <StatCard num="01" label={t('dashboard.kpiUsers')} value={stats?.users.total ?? '—'} />
        <StatCard num="02" label={t('dashboard.kpiCustomers')} value={stats?.users.customers ?? '—'} />
        <StatCard num="03" label={t('dashboard.kpiProviders')} value={stats?.users.providers ?? '—'} />
        <StatCard num="04" label={t('dashboard.kpiBoth')} value={stats?.users.both ?? '—'} />
        <StatCard num="05" label={t('dashboard.kpiActive7d')} value={stats?.users.active7d ?? '—'} accent="ok" />
        <StatCard num="06" label={t('dashboard.kpiJobsToday')} value={stats?.jobs.today ?? '—'} />
        <StatCard num="07" label={t('dashboard.kpiInProgress')} value={stats?.jobs.inProgress ?? '—'} accent="warn" />
        <StatCard num="08" label={t('dashboard.kpiCompleted')} value={stats?.jobs.completed ?? '—'} />
        <StatCard num="09" label={t('dashboard.kpiRevenueTotal')} value={stats ? fmtMoney(stats.revenue.totalCents) : '—'} accent="violet" />
        <StatCard num="10" label={t('dashboard.kpiRevenue30d')} value={stats ? fmtMoney(stats.revenue.last30dCents) : '—'} accent="violet" />
        <StatCard num="11" label={t('dashboard.kpiPendingDocs')} value={stats?.credentials.pendingReview ?? '—'} accent="warn" />
      </div>

      {/* Charts */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: 12 }}>
        <ChartCard label="§ New users" title={t('dashboard.chartNewUsers')}>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={charts?.newUsers ?? []}>
              <CartesianGrid stroke="#222222" vertical={false} />
              <XAxis dataKey="date" tick={axisTick} stroke="#222222" />
              <YAxis tick={axisTick} stroke="#222222" />
              <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: '#FFFFFF' }} cursor={{ stroke: '#2E2E2E' }} />
              <Line type="monotone" dataKey="count" stroke={ACCENT} strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard label="§ Completed jobs" title={t('dashboard.chartCompletedJobs')}>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={charts?.completedJobs ?? []}>
              <CartesianGrid stroke="#222222" vertical={false} />
              <XAxis dataKey="date" tick={axisTick} stroke="#222222" />
              <YAxis tick={axisTick} stroke="#222222" />
              <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: '#FFFFFF' }} cursor={{ fill: 'rgba(167,139,250,0.06)' }} />
              <Bar dataKey="count" fill={ACCENT} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <div style={{ gridColumn: '1 / -1' }}>
          <ChartCard label="§ Revenue" title={t('dashboard.chartRevenue')}>
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={(charts?.completedJobs ?? []).map((p) => ({ date: p.date, revenue: p.revenueCents / 100 }))}>
                <defs>
                  <linearGradient id="rev-grad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={ACCENT} stopOpacity={0.45} />
                    <stop offset="100%" stopColor={ACCENT} stopOpacity={0.04} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#222222" vertical={false} />
                <XAxis dataKey="date" tick={axisTick} stroke="#222222" />
                <YAxis tick={axisTick} stroke="#222222" />
                <Tooltip
                  contentStyle={tooltipStyle}
                  labelStyle={{ color: '#FFFFFF' }}
                  cursor={{ stroke: '#2E2E2E' }}
                  formatter={(v: number) => `$${v.toLocaleString()}`}
                />
                <Area type="monotone" dataKey="revenue" stroke={ACCENT} strokeWidth={2} fill="url(#rev-grad)" />
              </AreaChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>
      </div>
    </div>
  );
}

function ChartCard({ label, title, children }: { label: string; title: string; children: React.ReactNode }) {
  return (
    <div className="t-card-base" style={{ padding: 22 }}>
      <div className="flex items-center justify-between" style={{ marginBottom: 14, paddingBottom: 14, borderBottom: '1px solid var(--t-border)' }}>
        <div>
          <span className="t-eyebrow">{label}</span>
          <div className="t-h3" style={{ marginTop: 4 }}>{title}</div>
        </div>
      </div>
      {children}
    </div>
  );
}
