/**
 * Trabajos y ofertas — monitoreo (ofertas v2, 2026-08-19).
 *
 * Con el modelo de ofertas el fallo más probable deja de ser un error técnico y pasa
 * a ser el SILENCIO: el cliente postea y no le oferta nadie. Esta pantalla existe
 * para contestar ese "no me llegó ninguna oferta", y sobre todo para distinguir las
 * dos causas, que se arreglan de forma muy distinta:
 *
 *   - nadie tiene tarifa puesta para ese servicio  → hay que empujar a proveedores
 *   - hay proveedores con tarifa y aun así 0 ofertas → el problema es el trabajo
 *     (precio del rango, zona, descripción) o el matching
 *
 * Por eso el detalle muestra `providersWithARate` junto al recuento de ofertas: sin
 * ese número, un trabajo vacío no se puede diagnosticar.
 */

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { adminService, type AdminJobRow } from '@/services/adminService';
import { formatMoney, formatMoneyRange } from '@/lib/money';

function statusChipColor(status: string): string {
  if (status === 'PENDING_MATCH') return 'var(--t-warn)';
  if (status.startsWith('CANCELLED') || status === 'DISPUTED') return 'var(--t-danger)';
  if (status === 'COMPLETED') return 'var(--t-ok)';
  return 'var(--t-text-2)';
}

export default function Jobs() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [onlyOpen, setOnlyOpen] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);

  const jobs = useQuery({
    queryKey: ['admin-jobs', onlyOpen],
    queryFn: () => adminService.listJobs({ onlyOpen, limit: 200 }),
  });

  const detail = useQuery({
    queryKey: ['admin-job', selected],
    queryFn: () => adminService.jobDetail(selected as string),
    enabled: selected != null,
  });

  const rows: AdminJobRow[] = jobs.data?.jobs ?? [];
  const sinOfertas = rows.filter((j) => j.status === 'PENDING_MATCH' && j.offerCount === 0).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <h1 className="t-h1">{t('nav.jobs') || 'Jobs & offers'}</h1>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
          <input
            type="checkbox"
            checked={onlyOpen}
            onChange={(e) => setOnlyOpen(e.target.checked)}
          />
          {t('jobs.onlyOpen') || 'Only open jobs (taking offers)'}
        </label>
        {onlyOpen && sinOfertas > 0 && (
          <span className="t-chip" style={{ color: 'var(--t-warn)' }}>
            ⚠ {sinOfertas} {t('jobs.withoutOffers') || 'with no offers yet'}
          </span>
        )}
      </div>

      {jobs.isLoading && <div className="t-muted">…</div>}
      {jobs.isError && (
        <div style={{ color: 'var(--t-danger)' }}>
          {t('common.loadError') || 'Could not load jobs.'}
        </div>
      )}

      <div style={{ overflowX: 'auto' }}>
        <table className="t-table" style={{ minWidth: 900 }}>
          <thead>
            <tr>
              <th>{t('jobs.reference') || 'Ref'}</th>
              <th>{t('jobs.service') || 'Service'}</th>
              <th>{t('jobs.customer') || 'Customer'}</th>
              <th>{t('jobs.status') || 'Status'}</th>
              <th style={{ textAlign: 'right' }}>{t('jobs.offers') || 'Offers'}</th>
              <th>{t('jobs.materials') || 'Materials'}</th>
              <th style={{ textAlign: 'right' }}>{t('jobs.total') || 'Total'}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((j) => (
              <tr key={j.id}>
                <td className="t-mono" style={{ fontSize: 12 }}>{j.referenceNumber ?? '—'}</td>
                <td>
                  {j.taskName}
                  <span style={{ display: 'block', fontSize: 11, color: 'var(--t-text-3)' }}>
                    {j.city ?? '—'}
                  </span>
                </td>
                <td style={{ fontSize: 13 }}>{j.customerName}</td>
                <td>
                  <span className="t-chip" style={{ color: statusChipColor(j.status), fontSize: 11 }}>
                    {j.status}
                  </span>
                </td>
                <td style={{ textAlign: 'right' }}>
                  {/* Cero ofertas en un trabajo abierto es lo único que hay que mirar
                      en esta tabla; se marca para que salte a la vista. */}
                  <strong
                    style={{
                      color:
                        j.status === 'PENDING_MATCH' && j.offerCount === 0
                          ? 'var(--t-warn)'
                          : 'var(--t-text-1)',
                    }}
                  >
                    {j.offerCount}
                  </strong>
                </td>
                <td style={{ fontSize: 12 }}>
                  {j.materialsRequested
                    ? `${formatMoney(j.materialsSpentCents)} / ${formatMoney(
                        j.materialsAgreedCents ?? j.materialsBudgetCents,
                      )}`
                    : '—'}
                </td>
                <td style={{ textAlign: 'right', fontSize: 13 }}>
                  {formatMoney(j.totalChargedCents)}
                </td>
                <td>
                  <button
                    type="button"
                    className="t-btn t-btn-ghost t-btn-sm"
                    onClick={() => setSelected(selected === j.id ? null : j.id)}
                  >
                    {selected === j.id ? (t('common.close') || 'Close') : (t('common.view') || 'View')}
                  </button>
                </td>
              </tr>
            ))}
            {!jobs.isLoading && rows.length === 0 && (
              <tr>
                <td colSpan={8} className="t-muted" style={{ textAlign: 'center', padding: 24 }}>
                  {t('jobs.empty') || 'No jobs.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {selected && detail.data && (
        <div
          style={{
            border: '1px solid var(--t-border)', borderRadius: 8,
            background: 'var(--t-deep)', padding: 16,
            display: 'flex', flexDirection: 'column', gap: 14,
          }}
        >
          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'baseline' }}>
            <strong style={{ fontSize: 15 }}>{detail.data.taskName}</strong>
            <span className="t-chip t-chip-mono" style={{ fontSize: 11 }}>
              {detail.data.referenceNumber}
            </span>
            <span style={{ fontSize: 12, color: 'var(--t-text-2)' }}>
              {t('jobs.catalogRange') || 'Catalog range'}:{' '}
              {formatMoneyRange(detail.data.catalogMinCents, detail.data.catalogMaxCents) ?? '—'}
              {detail.data.pricingUnit ? ` / ${detail.data.pricingUnit}` : ''}
            </span>
          </div>

          {/* El diagnóstico de un trabajo sin ofertas vive aquí. */}
          {detail.data.offers.length === 0 && (
            <div
              style={{
                fontSize: 13, color: 'var(--t-warn)',
                border: '1px solid var(--t-warn)', borderRadius: 6, padding: 10,
              }}
            >
              {detail.data.providersWithARate === 0
                ? (t('jobs.noRatesDiagnosis') ||
                    'No provider has set a price for this service, so nobody can offer. That is the cause, not a bug.')
                : `${detail.data.providersWithARate} ${
                    t('jobs.ratesButNoOffers') ||
                    'providers have a price for this service and none has offered yet.'
                  }`}
            </div>
          )}

          {detail.data.details && (
            <div style={{ fontSize: 13 }}>
              <span style={{ color: 'var(--t-text-3)' }}>{t('jobs.details') || 'Customer details'}: </span>
              {detail.data.details}
            </div>
          )}

          {detail.data.answers.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
              {detail.data.answers.map((a, i) => (
                <div key={i}>
                  <span style={{ color: 'var(--t-text-3)' }}>{a.question}: </span>
                  {a.answerType === 'IMAGE' ? (
                    <a href={a.answer} target="_blank" rel="noreferrer">
                      {t('jobs.photo') || 'photo'}
                    </a>
                  ) : (
                    a.answer
                  )}
                </div>
              ))}
            </div>
          )}

          <div>
            <strong style={{ fontSize: 13 }}>{t('jobs.offersReceived') || 'Offers'}</strong>
            <table className="t-table" style={{ marginTop: 6 }}>
              <thead>
                <tr>
                  <th>{t('jobs.provider') || 'Provider'}</th>
                  <th>{t('jobs.work') || 'Work'}</th>
                  <th style={{ textAlign: 'right' }}>{t('jobs.rate') || 'Rate'}</th>
                  <th style={{ textAlign: 'right' }}>{t('jobs.total') || 'Total'}</th>
                  <th>{t('jobs.status') || 'Status'}</th>
                </tr>
              </thead>
              <tbody>
                {detail.data.offers.map((o) => (
                  <tr key={o.offerId}>
                    <td>{o.providerName}</td>
                    <td style={{ fontSize: 13 }}>
                      {o.magnitude} {o.unit === 'HOURLY' ? 'h' : o.unit === 'PER_AREA' ? 'm²' : ''}
                      <span style={{ fontSize: 11, color: 'var(--t-text-3)' }}>
                        {' '}({o.magnitudeSource})
                      </span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {formatMoney(o.rateCents)}
                      {/* El material va cotizado por el proveedor y con su porqué:
                          es lo que el cliente necesita para juzgar si el importe
                          es razonable o le están inflando la compra. */}
                      {o.materialsCents > 0 && (
                        <span
                          style={{ display: 'block', fontSize: 11, color: 'var(--t-text-3)' }}
                          title={o.materialsNote ?? undefined}
                        >
                          + {formatMoney(o.materialsCents)} {t('jobs.materials') || 'materials'}
                        </span>
                      )}
                    </td>
                    <td style={{ textAlign: 'right' }}>{formatMoney(o.totalCents)}</td>
                    <td>
                      <span
                        className="t-chip"
                        style={{
                          fontSize: 11,
                          color: o.status === 'accepted' ? 'var(--t-ok)' : 'var(--t-text-2)',
                        }}
                      >
                        {o.status}
                      </span>
                    </td>
                  </tr>
                ))}
                {detail.data.offers.length === 0 && (
                  <tr>
                    <td colSpan={5} className="t-muted" style={{ textAlign: 'center' }}>
                      {t('jobs.noOffers') || 'No offers yet.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {detail.data.materials.requested && (
            <div>
              <strong style={{ fontSize: 13 }}>
                {/* Gastado contra lo ACORDADO en la oferta, no contra el presupuesto
                    que puso el cliente: ese era solo una indicación para el proveedor. */}
                {t('jobs.materials') || 'Materials'} — {formatMoney(detail.data.materials.spentCents)}{' '}
                / {formatMoney(detail.data.materials.agreedCents)}
                <span style={{ fontWeight: 400, color: 'var(--t-text-3)' }}>
                  {' '}({t('jobs.customerBudget') || 'customer budgeted'}{' '}
                  {formatMoney(detail.data.materials.budgetCents)})
                </span>
                {detail.data.materials.needsApproval && (
                  <span style={{ color: 'var(--t-warn)' }}>
                    {' '}⚠ {t('jobs.needsApproval') || 'over budget, awaiting customer approval'}
                  </span>
                )}
              </strong>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
                {detail.data.materials.receipts.map((r) => (
                  <div
                    key={r.receiptId}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10, fontSize: 13,
                      opacity: r.voided ? 0.5 : 1,
                    }}
                  >
                    <span style={{ minWidth: 70 }}>{formatMoney(r.amountCents)}</span>
                    <span style={{ color: 'var(--t-text-3)' }}>{r.merchant ?? '—'}</span>
                    <a href={r.fileUrl} target="_blank" rel="noreferrer">
                      {t('jobs.receipt') || 'receipt'}
                    </a>
                    {r.voided ? (
                      <span style={{ color: 'var(--t-danger)' }}>
                        {t('jobs.voided') || 'voided'}: {r.voidReason}
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="t-btn t-btn-ghost t-btn-sm"
                        style={{ color: 'var(--t-danger)' }}
                        onClick={async () => {
                          const reason = window.prompt(
                            t('jobs.voidReasonPrompt') || 'Why is this receipt being voided?',
                          );
                          if (!reason) return;
                          await adminService.voidMaterialReceipt(r.receiptId, reason);
                          qc.invalidateQueries({ queryKey: ['admin-job', selected] });
                          qc.invalidateQueries({ queryKey: ['admin-jobs'] });
                        }}
                      >
                        {t('jobs.void') || 'Void'}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* La cascada del dinero. El material se muestra aparte del subtotal a
              propósito: no lleva impuesto encima ni paga comisión, y verlo sumado
              haría pensar lo contrario. */}
          <div style={{ fontSize: 13, display: 'flex', gap: 18, flexWrap: 'wrap' }}>
            <span>{t('jobs.labour') || 'Labour'}: {formatMoney(detail.data.money.subtotalCents)}</span>
            <span>{t('jobs.tax') || 'Tax'}: {formatMoney(detail.data.money.serviceTaxCents)}</span>
            <span>
              {t('jobs.materials') || 'Materials'}: {formatMoney(detail.data.materials.spentCents)}
            </span>
            <span>{t('jobs.fee') || 'Service fee'}: {formatMoney(detail.data.money.serviceFeeCents)}</span>
            <span>{t('jobs.commission') || 'Commission'}: {formatMoney(detail.data.money.commissionCents)}</span>
            <span>{t('jobs.payout') || 'Provider payout'}: {formatMoney(detail.data.money.providerPayoutCents)}</span>
            <strong>{t('jobs.total') || 'Total'}: {formatMoney(detail.data.money.totalChargedCents)}</strong>
          </div>
        </div>
      )}
    </div>
  );
}
