/**
 * VISP — Ofertas v2 y materiales.
 *
 * El cliente postea el trabajo y los proveedores ofertan; el cliente elige entre las
 * ofertas que recibe. Ver visp-tasker/docs/plan-ofertas-v2.md.
 *
 * Sustituye al flujo viejo (`available-providers`, `pending-provider`,
 * `approve-provider`), que ya no existe en el backend.
 */

import apiClient from './apiClient';

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

/** Quién aporta la magnitud de la oferta. Decide qué le pedimos al proveedor. */
export type MagnitudeSource = 'PROVIDER' | 'CUSTOMER' | 'FLAT';

/** Un trabajo abierto en la bolsa del proveedor. */
export interface OpenJob {
  jobId: string;
  serviceName: string;
  pricingUnit: string;
  /** PROVIDER = tiene que estimar (horas, m²). CUSTOMER/FLAT = ya está resuelto. */
  magnitudeSource: MagnitudeSource;
  customerQuantity: number | null;
  details: string | null;
  extraNote: string | null;
  evidence: string[];
  answers: { question: string; answer: string; answerType?: string }[];
  requestedDate: string | null;
  requestedTimeStart: string | null;
  city: string | null;
  /** Material: lo compra el proveedor y se le reembolsa íntegro. */
  materialsRequested: boolean;
  /** Lo que el cliente indicó al reservar. Es una REFERENCIA, no el techo: el
   *  importe que se cobra lo pone el proveedor en su oferta. */
  materialsBudgetCents: number | null;
  materialsQuoteRequired: boolean;
  materialsNote: string | null;
  /**
   * Contrato por horas: el precio y las horas los puso el CLIENTE y el proveedor
   * solo acepta. No cotiza nada y no necesita tarifa propia para el servicio.
   */
  isContract: boolean;
  customerRateCents: number | null;
  /** Su propia tarifa. NULL en un contrato, donde el precio no es suyo. */
  myRateCents: number | null;
  canOffer: boolean;
  /**
   * Por qué no puede ofertar, cuando el motivo NO es "te falta la tarifa".
   * Hoy solo llega `schedule_conflict`: ya tiene otro trabajo comprometido a esa
   * hora. Los demás bloqueos (fuera de radio, sin cualificación) sacan el trabajo
   * de la bolsa; este no, porque mañana ese hueco estará libre.
   */
  blockedReason: 'schedule_conflict' | null;
  alreadyOffered: boolean;
  offersCloseAt: string | null;
}

/** Una oferta, tal como la ve el cliente. */
export interface JobOffer {
  offerId: string;
  providerId: string;
  displayName: string;
  avatarUrl: string | null;
  bio: string | null;
  level: number | null;
  rating: number | null;
  reviewCount: number;
  completedJobs: number;
  /** Servicios activos en los que está cualificado. Para un proveedor nuevo es
   *  lo único con sustancia que el cliente puede mirar además del precio. */
  serviceCount?: number;
  /** Alta del perfil de proveedor. Tampoco mide calidad, pero sitúa. */
  memberSince?: string | null;
  /** El trabajo ofertado: 8 (horas), 80 (m²), 5 (unidades). */
  magnitude: number;
  magnitudeSource: MagnitudeSource;
  unit: string;
  rateCents: number;
  subtotalCents: number;
  serviceTaxCents: number;
  serviceFeeCents: number;
  /** Material cotizado por ESTE proveedor, con su justificación. */
  materialsCents: number;
  materialsNote: string | null;
  totalCents: number;
  message: string | null;
  createdAt: string | null;
}

export interface JobOffersResult {
  jobId: string;
  pricingUnit: string | null;
  catalogMinCents: number | null;
  catalogMaxCents: number | null;
  materialsRequested: boolean;
  materialsBudgetCents: number | null;
  offersCloseAt: string | null;
  offers: JobOffer[];
  count: number;
}

export interface MaterialReceipt {
  receiptId: string;
  amountCents: number;
  fileUrl: string;
  merchant: string | null;
  note: string | null;
  voided: boolean;
  voidReason: string | null;
  createdAt: string | null;
}

export interface MaterialsState {
  materialsRequested: boolean;
  /** Lo que dijo el cliente al reservar (referencia). */
  budgetCents: number | null;
  /** Lo que cotizó el proveedor y el cliente aceptó: el techo real. */
  agreedCents: number;
  spentCents: number;
  overageCents: number;
  needsApproval: boolean;
  receipts: MaterialReceipt[];
}

// ---------------------------------------------------------------------------
// Lado proveedor
// ---------------------------------------------------------------------------

/** La bolsa de trabajos abiertos donde este proveedor puede ofertar. */
async function listOpenJobs(): Promise<OpenJob[]> {
  const resp = await apiClient.get<{ data: { items: OpenJob[]; count: number } }>(
    '/provider/open-jobs',
  );
  return resp.data?.data?.items ?? [];
}

export interface SubmitOfferInput {
  /** Horas, m² o metros. Se omite en los servicios por ítem y en los planos. */
  magnitude?: number;
  message?: string;
  /** Obligatorios cuando el trabajo lleva material. */
  materialsCents?: number;
  materialsNote?: string;
}

/**
 * Enviar una oferta. El PRECIO no viaja aquí: sale de la tarifa del perfil, ya
 * validada contra el rango del catálogo. Lo que aporta el proveedor es cuánto tarda
 * y, si hay material, cuánto costará y por qué.
 */
async function submitOffer(jobId: string, input: SubmitOfferInput) {
  const resp = await apiClient.post<{ data: Record<string, unknown> }>(
    `/provider/open-jobs/${jobId}/offer`,
    {
      magnitude: input.magnitude,
      message: input.message,
      materialsCents: input.materialsCents,
      materialsNote: input.materialsNote,
    },
  );
  return resp.data?.data;
}

/** Retirar la oferta. Se puede volver a ofertar después. */
async function withdrawOffer(jobId: string): Promise<void> {
  await apiClient.delete(`/provider/open-jobs/${jobId}/offer`);
}

/** Subir una factura de material. El importe se le reembolsa íntegro: no paga
 *  comisión y no se le aplica impuesto encima. */
async function uploadMaterialReceipt(
  jobId: string,
  input: { amountCents: number; fileUri: string; fileName?: string; merchant?: string; note?: string },
): Promise<MaterialsState> {
  const form = new FormData();
  form.append('amountCents', String(input.amountCents));
  form.append('file', {
    uri: input.fileUri,
    name: input.fileName ?? 'receipt.jpg',
    type: 'image/jpeg',
  } as unknown as Blob);
  if (input.merchant) form.append('merchant', input.merchant);
  if (input.note) form.append('note', input.note);

  const resp = await apiClient.post<{ data: Record<string, number> }>(
    `/provider/jobs/${jobId}/materials`,
    form,
    { headers: { 'Content-Type': 'multipart/form-data' } },
  );
  const d = resp.data?.data ?? {};
  return {
    materialsRequested: true,
    budgetCents: (d.materials_budget_cents as number) ?? null,
    agreedCents: (d.materials_agreed_cents as number) ?? 0,
    spentCents: (d.materials_spent_cents as number) ?? 0,
    overageCents: (d.materials_overage_cents as number) ?? 0,
    needsApproval: Boolean(d.needs_customer_approval),
    receipts: [],
  };
}

/** Las facturas ya subidas por el proveedor en este trabajo. */
async function listProviderReceipts(jobId: string): Promise<MaterialReceipt[]> {
  const resp = await apiClient.get<{ data: { receipts: MaterialReceipt[] } }>(
    `/provider/jobs/${jobId}/materials`,
  );
  return resp.data?.data?.receipts ?? [];
}

/** Qué material lleva el trabajo en curso, desde la vista del proveedor.
 *
 *  Hace falta en la pantalla del trabajo activo: es donde el proveedor tiene que
 *  acordarse de subir la factura ANTES de cerrar, y sin factura no hay reembolso.
 */
async function getProviderJobMaterials(jobId: string): Promise<{
  requested: boolean;
  agreedCents: number | null;
  spentCents: number;
}> {
  const resp = await apiClient.get<{
    data: {
      materialsRequested?: boolean;
      materialsAgreedCents?: number | null;
      materialsSpentCents?: number | null;
    };
  }>(`/provider/jobs/${jobId}`);
  const d = resp.data?.data ?? {};
  return {
    requested: Boolean(d.materialsRequested),
    agreedCents: d.materialsAgreedCents ?? null,
    spentCents: d.materialsSpentCents ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Lado cliente
// ---------------------------------------------------------------------------

/** Las ofertas vivas del trabajo, con la ficha de cada proveedor. */
async function listOffers(jobId: string): Promise<JobOffersResult> {
  const resp = await apiClient.get<{ data: JobOffersResult }>(`/jobs/${jobId}/offers`);
  return resp.data.data;
}

/** Elegir una oferta: el trabajo queda agendado con ese proveedor y ese precio. */
async function acceptOffer(jobId: string, offerId: string) {
  const resp = await apiClient.post<{ data: Record<string, unknown> }>(
    `/jobs/${jobId}/offers/${offerId}/accept`,
  );
  return resp.data?.data;
}

/** Descartar UNA oferta. El trabajo sigue abierto para las demás. */
async function rejectOffer(jobId: string, offerId: string): Promise<void> {
  await apiClient.post(`/jobs/${jobId}/offers/${offerId}/reject`);
}

/** Estado del material del trabajo: acordado, gastado y facturas. */
async function getMaterials(jobId: string): Promise<MaterialsState> {
  const resp = await apiClient.get<{ data: MaterialsState }>(`/jobs/${jobId}/materials`);
  return resp.data.data;
}

/** El cliente acepta pagar por encima de lo acordado para el material. */
async function approveMaterialsOverage(jobId: string): Promise<void> {
  await apiClient.post(`/jobs/${jobId}/materials/approve-overage`);
}

// ---------------------------------------------------------------------------
// Ayudas de presentación
// ---------------------------------------------------------------------------

/**
 * Sufijo de la unidad para pegar al precio: "50 - 90/hr".
 *
 * El catálogo guarda la unidad en mayúsculas y la API la devuelve en minúsculas
 * según el endpoint, así que se normaliza antes de mirar.
 */
export function unitSuffix(pricingUnit: string | null | undefined): string {
  switch ((pricingUnit ?? '').toUpperCase()) {
    case 'HOURLY':
      return '/hr';
    case 'PER_UNIT':
      return '/item';
    case 'PER_AREA':
      return '/m²';
    case 'PER_LINEAR_M':
      return '/m';
    case 'PER_VISIT':
      return '/visit';
    default:
      // FLAT_PACKAGE y cualquier unidad nueva: el precio ya es el total.
      return '';
  }
}

/** Cómo se llama la magnitud que el proveedor tiene que estimar. */
export function magnitudeLabel(pricingUnit: string | null | undefined): string {
  switch ((pricingUnit ?? '').toUpperCase()) {
    case 'HOURLY':
    // Un contrato SE MIDE EN HORAS: el cliente publica su tarifa por hora y
    // cuántas horas contrata. Faltaba aquí —la unidad se añadió en la migración
    // 046 y este switch se quedó atrás— así que la oferta decía "8 units" y
    // "$25.00 / unit" en un trabajo por horas.
    case 'PER_CONTRACT':
      return 'hours';
    case 'PER_AREA':
      return 'm²';
    case 'PER_LINEAR_M':
      return 'meters';
    case 'PER_VISIT':
      return 'visits';
    case 'FLAT_PACKAGE':
      // Magnitud fija en 1: "1 units" no dice nada. Es el trabajo entero.
      return 'job';
    default:
      return 'units';
  }
}

export const offerService = {
  listOpenJobs,
  submitOffer,
  withdrawOffer,
  uploadMaterialReceipt,
  listProviderReceipts,
  getProviderJobMaterials,
  listOffers,
  acceptOffer,
  rejectOffer,
  getMaterials,
  approveMaterialsOverage,
};

export default offerService;
