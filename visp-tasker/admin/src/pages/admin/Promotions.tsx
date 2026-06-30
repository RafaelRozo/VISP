import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { adminService, Promotion } from '@/services/adminService';

export default function Promotions() {
  const { t } = useTranslation();

  // Endpoint exists; we list whatever rows the admin has already created (if any).
  const q = useQuery<Promotion[]>({
    queryKey: ['promotions'],
    queryFn: () => adminService.listPromotions(),
  });

  const items = q.data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <h1 className="text-3xl font-bold">{t('promotions.title')}</h1>
      </div>

      <div className="glass p-8">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-warning/20 grid place-items-center text-warning text-xl">
            🚧
          </div>
          <div>
            <div className="font-bold">{t('promotions.underConstruction')}</div>
            <div className="text-sm text-textSecondary mt-1 max-w-xl">
              {t('promotions.underConstructionBody')}
            </div>
          </div>
        </div>
      </div>

      {items.length > 0 && (
        <div className="glass overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-black/30 text-textSecondary">
              <tr>
                <th className="text-left px-4 py-3 font-semibold">{t('promotions.code')}</th>
                <th className="text-left px-4 py-3 font-semibold">{t('promotions.discount')}</th>
                <th className="text-left px-4 py-3 font-semibold">{t('promotions.starts')}</th>
                <th className="text-left px-4 py-3 font-semibold">{t('promotions.ends')}</th>
                <th className="text-left px-4 py-3 font-semibold">{t('promotions.redemptions')}</th>
                <th className="text-left px-4 py-3 font-semibold">{t('promotions.active')}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((p) => (
                <tr key={p.id} className="border-t border-glassBorder/30">
                  <td className="px-4 py-3 font-mono">{p.code}</td>
                  <td className="px-4 py-3">
                    {p.discountType === 'percentage'
                      ? `${p.discountValue}%`
                      : `$${p.discountValue.toFixed(2)}`}
                  </td>
                  <td className="px-4 py-3">{new Date(p.startsAt).toLocaleDateString()}</td>
                  <td className="px-4 py-3">{new Date(p.endsAt).toLocaleDateString()}</td>
                  <td className="px-4 py-3">
                    {p.redemptionsCount}
                    {p.maxRedemptions ? ` / ${p.maxRedemptions}` : ''}
                  </td>
                  <td className="px-4 py-3">
                    {p.isActive ? (
                      <span className="text-success">●</span>
                    ) : (
                      <span className="text-textTertiary">○</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
