import { Fragment, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { adminService, CoverageData, CoverageProvider } from '@/services/adminService';

type Tab = 'service' | 'location';

const NO_CITY = '__none__';

function cityKey(p: CoverageProvider): string {
  return p.city ? `${p.city}|${p.province ?? ''}` : NO_CITY;
}

function money(cents: number | null, unit: string | null): string {
  if (cents == null) return '';
  const u = unit ? `/${unit.toLowerCase().replace('_', ' ')}` : '';
  return `$${(cents / 100).toFixed(0)}${u}`;
}

function downloadCsv(filename: string, rows: (string | number)[][]) {
  const esc = (v: string | number) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const blob = new Blob([rows.map((r) => r.map(esc).join(',')).join('\n')], {
    type: 'text/csv;charset=utf-8',
  });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export default function Coverage() {
  const { t } = useTranslation();
  const q = useQuery<CoverageData>({ queryKey: ['coverage'], queryFn: () => adminService.getCoverage() });

  const [tab, setTab] = useState<Tab>('service');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [onlyCovered, setOnlyCovered] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const data = q.data;
  const byId = useMemo(() => {
    const m: Record<string, CoverageProvider> = {};
    for (const p of data?.providers ?? []) m[p.id] = p;
    return m;
  }, [data]);

  const cityLabel = (key: string) => (key === NO_CITY ? t('coverage.noAddress') : key.replace('|', ', '));

  // ── By service ────────────────────────────────────────────────────
  const services = useMemo(() => {
    const s = search.trim().toLowerCase();
    return (data?.services ?? [])
      .map((svc) => {
        const priced = svc.providers.filter((x) => x.rateCents != null).length;
        const cities: Record<string, number> = {};
        for (const x of svc.providers) {
          const p = byId[x.providerId];
          if (p) cities[cityKey(p)] = (cities[cityKey(p)] ?? 0) + 1;
        }
        return { ...svc, selected: svc.providers.length, priced, cities };
      })
      .filter((svc) => !category || svc.category === category)
      .filter((svc) => !onlyCovered || svc.selected > 0)
      .filter((svc) => !s || svc.name.toLowerCase().includes(s) || svc.category.toLowerCase().includes(s))
      .sort((a, b) => b.priced - a.priced || b.selected - a.selected || a.name.localeCompare(b.name));
  }, [data, byId, search, category, onlyCovered]);

  // ── By location ───────────────────────────────────────────────────
  const locations = useMemo(() => {
    const groups: Record<string, CoverageProvider[]> = {};
    for (const p of data?.providers ?? []) (groups[cityKey(p)] ??= []).push(p);
    const s = search.trim().toLowerCase();
    return Object.entries(groups)
      .map(([key, provs]) => {
        const offered = new Set<string>();
        for (const svc of data?.services ?? []) {
          if (svc.providers.some((x) => x.rateCents != null && provs.some((p) => p.id === x.providerId))) {
            offered.add(svc.name);
          }
        }
        return {
          key,
          providers: provs,
          online: provs.filter((p) => p.online).length,
          inZone: provs[0]?.inZone ?? null,
          kmOutside: provs[0]?.kmOutsideZone ?? null,
          offered: [...offered].sort(),
        };
      })
      .filter((l) => !s || cityLabel(l.key).toLowerCase().includes(s))
      .sort((a, b) => (a.key === NO_CITY ? 1 : b.key === NO_CITY ? -1 : b.providers.length - a.providers.length));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, search]);

  const categories = useMemo(
    () => [...new Set((data?.services ?? []).map((s) => s.category))],
    [data],
  );

  const providers = data?.providers ?? [];
  const covered = (data?.services ?? []).filter((s) => s.providers.some((x) => x.rateCents != null)).length;

  const exportCsv = () => {
    if (tab === 'service') {
      downloadCsv('visp-coverage-by-service.csv', [
        ['Service', 'Category', 'Selected', 'With price', 'Cities'],
        ...services.map((s) => [
          s.name,
          s.category,
          s.selected,
          s.priced,
          Object.entries(s.cities)
            .map(([k, n]) => `${cityLabel(k)} (${n})`)
            .join('; '),
        ]),
      ]);
    } else {
      downloadCsv('visp-coverage-by-location.csv', [
        ['City', 'In service zone', 'Providers', 'Online', 'Services offered'],
        ...locations.map((l) => [
          cityLabel(l.key),
          l.inZone == null ? '' : l.inZone ? 'yes' : 'no',
          l.providers.length,
          l.online,
          l.offered.join('; '),
        ]),
      ]);
    }
  };

  const zoneBadge = (inZone: boolean | null, km: number | null) =>
    inZone == null ? (
      <span className="text-textTertiary">—</span>
    ) : inZone ? (
      <span className="text-success">● {t('coverage.inside')}</span>
    ) : (
      <span className="text-warning">● {t('coverage.outside', { km: km ?? '?' })}</span>
    );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">{t('coverage.title')}</h1>
        <p className="text-sm text-textSecondary mt-1 max-w-3xl">{t('coverage.subtitle')}</p>
      </div>

      {q.isLoading ? (
        <div className="glass p-8 text-textSecondary">…</div>
      ) : q.isError || !data ? (
        <div className="glass p-8 text-danger">{t('coverage.loadError')}</div>
      ) : (
        <>
          <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
            {[
              [t('coverage.activeProviders'), providers.length],
              [t('coverage.withLocation'), providers.filter((p) => p.city).length],
              [t('coverage.online'), providers.filter((p) => p.online).length],
              [t('coverage.servicesCovered'), `${covered} / ${data.services.length}`],
            ].map(([label, value]) => (
              <div key={label as string} className="glass p-4">
                <div className="text-xs text-textSecondary">{label}</div>
                <div className="text-2xl font-bold mt-1">{value}</div>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex rounded-xl border border-glassBorder overflow-hidden">
              {(['service', 'location'] as Tab[]).map((k) => (
                <button
                  key={k}
                  onClick={() => {
                    setTab(k);
                    setOpen(null);
                  }}
                  className={`px-4 py-2 text-sm ${tab === k ? 'bg-primary font-semibold' : 'hover:bg-white/5'}`}
                >
                  {k === 'service' ? t('coverage.byService') : t('coverage.byLocation')}
                </button>
              ))}
            </div>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('coverage.search')}
              className="px-3 py-2 rounded-xl bg-white/5 border border-glassBorder text-sm w-56"
            />
            {tab === 'service' && (
              <>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="px-3 py-2 rounded-xl bg-white/5 border border-glassBorder text-sm"
                >
                  <option value="">{t('coverage.allCategories')}</option>
                  {categories.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
                <label className="flex items-center gap-2 text-sm text-textSecondary">
                  <input type="checkbox" checked={onlyCovered} onChange={(e) => setOnlyCovered(e.target.checked)} />
                  {t('coverage.onlyCovered')}
                </label>
              </>
            )}
            <button
              onClick={exportCsv}
              className="ml-auto px-4 py-2 rounded-xl text-sm border border-glassBorder hover:bg-white/5"
            >
              {t('coverage.exportCsv')}
            </button>
          </div>

          <p className="text-xs text-textTertiary">{t('coverage.help')}</p>

          <div className="glass overflow-hidden">
            {tab === 'service' ? (
              <table className="w-full text-sm">
                <thead className="bg-black/30 text-textSecondary">
                  <tr>
                    <th className="text-left px-4 py-3 font-semibold">{t('coverage.service')}</th>
                    <th className="text-left px-4 py-3 font-semibold">{t('coverage.category')}</th>
                    <th className="text-right px-4 py-3 font-semibold">{t('coverage.selected')}</th>
                    <th className="text-right px-4 py-3 font-semibold">{t('coverage.priced')}</th>
                    <th className="text-left px-4 py-3 font-semibold">{t('coverage.cities')}</th>
                  </tr>
                </thead>
                <tbody>
                  {services.map((s) => (
                    <Fragment key={s.id}>
                      <tr
                        className="border-t border-glassBorder/30 cursor-pointer hover:bg-white/5"
                        onClick={() => setOpen(open === s.id ? null : s.id)}
                      >
                        <td className="px-4 py-3">
                          {s.isTopJob && <span style={{ color: '#F5B700' }}>★ </span>}
                          {s.name}
                        </td>
                        <td className="px-4 py-3 text-textSecondary">{s.category}</td>
                        <td className="px-4 py-3 text-right">{s.selected}</td>
                        <td
                          className={`px-4 py-3 text-right font-semibold ${
                            s.priced === 0 ? (s.selected > 0 ? 'text-warning' : 'text-danger') : 'text-success'
                          }`}
                        >
                          {s.priced}
                        </td>
                        <td className="px-4 py-3">
                          {s.selected === 0 ? (
                            <span className="text-textTertiary">{t('coverage.noProviders')}</span>
                          ) : (
                            <div className="flex flex-wrap gap-1">
                              {Object.entries(s.cities).map(([k, n]) => (
                                <span key={k} className="px-2 py-0.5 rounded-full bg-white/10 text-xs">
                                  {cityLabel(k)} · {n}
                                </span>
                              ))}
                            </div>
                          )}
                        </td>
                      </tr>
                      {open === s.id && s.selected > 0 && (
                        <tr className="bg-black/20">
                          <td colSpan={5} className="px-8 py-3">
                            <ProviderRows
                              rows={s.providers.map((x) => ({
                                p: byId[x.providerId],
                                extra: x.rateCents != null ? money(x.rateCents, x.unit) : t('coverage.noPrice'),
                              }))}
                              cityLabel={cityLabel}
                              zoneBadge={zoneBadge}
                            />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-black/30 text-textSecondary">
                  <tr>
                    <th className="text-left px-4 py-3 font-semibold">{t('coverage.city')}</th>
                    <th className="text-left px-4 py-3 font-semibold">{t('coverage.inZone')}</th>
                    <th className="text-right px-4 py-3 font-semibold">{t('coverage.providers')}</th>
                    <th className="text-right px-4 py-3 font-semibold">{t('coverage.online')}</th>
                    <th className="text-left px-4 py-3 font-semibold">{t('coverage.servicesOffered')}</th>
                  </tr>
                </thead>
                <tbody>
                  {locations.map((l) => (
                    <Fragment key={l.key}>
                      <tr
                        className="border-t border-glassBorder/30 cursor-pointer hover:bg-white/5"
                        onClick={() => setOpen(open === l.key ? null : l.key)}
                      >
                        <td className={`px-4 py-3 ${l.key === NO_CITY ? 'text-textTertiary' : 'font-semibold'}`}>
                          {cityLabel(l.key)}
                        </td>
                        <td className="px-4 py-3">{zoneBadge(l.inZone, l.kmOutside)}</td>
                        <td className="px-4 py-3 text-right">{l.providers.length}</td>
                        <td className="px-4 py-3 text-right">{l.online}</td>
                        <td className="px-4 py-3 text-textSecondary">
                          {l.offered.length === 0 ? '—' : l.offered.join(', ')}
                        </td>
                      </tr>
                      {open === l.key && (
                        <tr className="bg-black/20">
                          <td colSpan={5} className="px-8 py-3">
                            <ProviderRows
                              rows={l.providers.map((p) => ({
                                p,
                                extra: `${p.servicesPriced} / ${p.servicesSelected} ${t('coverage.priced').toLowerCase()}`,
                              }))}
                              cityLabel={cityLabel}
                              zoneBadge={zoneBadge}
                            />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function ProviderRows({
  rows,
  cityLabel,
  zoneBadge,
}: {
  rows: { p: CoverageProvider | undefined; extra: string }[];
  cityLabel: (key: string) => string;
  zoneBadge: (inZone: boolean | null, km: number | null) => React.ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <table className="w-full text-xs">
      <thead className="text-textTertiary">
        <tr>
          <th className="text-left py-1 font-semibold">{t('coverage.provider')}</th>
          <th className="text-left py-1 font-semibold">{t('coverage.city')}</th>
          <th className="text-left py-1 font-semibold">{t('coverage.inZone')}</th>
          <th className="text-left py-1 font-semibold">{t('coverage.status')}</th>
          <th className="text-right py-1 font-semibold" />
        </tr>
      </thead>
      <tbody>
        {rows
          .filter((r) => r.p)
          .map(({ p, extra }) => (
            <tr key={p!.id} className="border-t border-glassBorder/20">
              <td className="py-1.5">
                <div className="font-semibold">{p!.name}</div>
                <div className="text-textTertiary">{p!.email}</div>
              </td>
              <td className="py-1.5">{cityLabel(cityKey(p!))}</td>
              <td className="py-1.5">{zoneBadge(p!.inZone, p!.kmOutsideZone)}</td>
              <td className="py-1.5">
                {p!.online ? (
                  <span className="text-success">{t('coverage.onlineBadge')}</span>
                ) : (
                  <span className="text-textTertiary">{t('coverage.offline')}</span>
                )}
              </td>
              <td className="py-1.5 text-right font-mono">{extra}</td>
            </tr>
          ))}
      </tbody>
    </table>
  );
}
