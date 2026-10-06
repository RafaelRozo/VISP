/**
 * VISP — Denunciar y bloquear (Apple, guía 1.2).
 *
 * El servidor decide A QUIÉN se denuncia o bloquea a partir del trabajo (y de
 * la oferta o el mensaje): la app nunca manda un id de usuario. Ver
 * `docs/plan-denunciar-bloquear.md`.
 *
 * Con un trabajo ASIGNADO entre los dos, bloquear devuelve 409 `job_active`
 * con el `jobId`: la app tiene que abrir el botón de pánico de ese trabajo
 * (cancelar con motivo + "bloquear también"), para no dejar trabajos a medias.
 */

import { post } from './apiClient';
import type { ApiError } from '../types';

export type ReportContentType = 'USER' | 'CHAT_MESSAGE' | 'JOB_DETAILS' | 'JOB_EVIDENCE' | 'PROFILE';

export type ReportReason =
  | 'HARASSMENT'
  | 'OFFENSIVE'
  | 'INAPPROPRIATE_PHOTO'
  | 'SCAM'
  | 'SAFETY'
  | 'OTHER';

export const REPORT_REASONS: ReportReason[] = [
  'HARASSMENT',
  'OFFENSIVE',
  'INAPPROPRIATE_PHOTO',
  'SCAM',
  'SAFETY',
  'OTHER',
];

export interface ReportTarget {
  jobId: string;
  contentType: ReportContentType;
  /** Id del mensaje cuando contentType = CHAT_MESSAGE. */
  contentId?: string;
  /** El cliente denuncia la tarjeta de UNA oferta. */
  offerId?: string;
}

export async function reportContent(
  target: ReportTarget,
  reason: ReportReason,
  note: string | undefined,
  block: boolean,
): Promise<{ reportId: string; blocked: boolean }> {
  return post('/reports', { ...target, reason, note, block });
}

export async function blockUser(jobId: string, offerId?: string): Promise<void> {
  await post('/blocks', { jobId, offerId });
}

/** Si el error es "hay un trabajo asignado", el id de ese trabajo; si no, null. */
export function activeJobFromError(err: unknown): string | null {
  const e = err as ApiError | undefined;
  if (e?.code !== 'job_active') return null;
  const body = e.body as { jobId?: string } | undefined;
  return body?.jobId ?? null;
}
