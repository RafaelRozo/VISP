/**
 * VISP — Legal / contract signing API.
 *
 * Los documentos y su hash SIEMPRE vienen del servidor. Nada de texto legal
 * incrustado en la app: `TermsScreen.tsx` lo tiene hardcodeado y describe un
 * sistema de "Tier 1-4" que ya no existe, así que hoy hay tres verdades
 * legales distintas compitiendo. Lo que se firma tiene que ser exactamente lo
 * que el servidor archiva y hashea.
 */

import * as api from './apiClient';

export type ConsentType =
  | 'provider_ic_agreement'
  | 'customer_service_agreement'
  | 'platform_tos'
  | 'privacy_policy';

export interface LegalDocument {
  consentType: ConsentType;
  version: string;
  text: string;
  /** SHA-256 del texto. Se devuelve tal cual al firmar. */
  hash: string;
  requiresSignature: boolean;
}

export interface PendingConsent {
  consentType: ConsentType;
  version: string;
  requiresSignature: boolean;
}

export interface PendingConsents {
  pending: PendingConsent[];
  suggestedLegalName: string;
  accountEmail: string;
}

export interface SignaturePayload {
  width: number;
  height: number;
  strokes: number[][][];
}

export interface SignedConsent {
  consentId: string;
  consentType: ConsentType;
  consentVersion: string;
  signedFullName: string;
  documentHash: string;
  documentUrl: string;
  createdAt: string;
}

// El backend responde en snake_case; se mapea campo a campo y NO se hace
// spread del objeto crudo. Copiar a ciegas es como se colaron los bugs de
// `pendingOffers` y `offerCount`: el tipo dice una cosa y el objeto trae otra.
export async function getLegalDocument(type: ConsentType): Promise<LegalDocument> {
  const r = await api.get<{
    consent_type: ConsentType;
    version: string;
    text: string;
    hash: string;
    requires_signature: boolean;
  }>(`/consents/document/${type}`);

  return {
    consentType: r.consent_type,
    version: r.version,
    text: r.text,
    hash: r.hash,
    requiresSignature: r.requires_signature,
  };
}

export async function getPendingConsents(): Promise<PendingConsents> {
  const r = await api.get<{
    pending: Array<{
      consent_type: ConsentType;
      version: string;
      requires_signature: boolean;
    }>;
    suggested_legal_name: string;
    account_email: string;
  }>('/consents/pending');

  return {
    pending: (r.pending ?? []).map((p) => ({
      consentType: p.consent_type,
      version: p.version,
      requiresSignature: p.requires_signature,
    })),
    suggestedLegalName: r.suggested_legal_name ?? '',
    accountEmail: r.account_email ?? '',
  };
}

export async function signConsent(params: {
  consentType: ConsentType;
  signedFullName: string;
  documentHash: string;
  signature?: SignaturePayload;
  businessName?: string;
  deviceId?: string;
}): Promise<SignedConsent> {
  const r = await api.post<{
    consent_id: string;
    consent_type: ConsentType;
    consent_version: string;
    signed_full_name: string;
    document_hash: string;
    document_url: string;
    created_at: string;
  }>('/consents/sign', {
    consent_type: params.consentType,
    signed_full_name: params.signedFullName,
    document_hash: params.documentHash,
    signature: params.signature,
    business_name: params.businessName,
    device_id: params.deviceId,
  });

  return {
    consentId: r.consent_id,
    consentType: r.consent_type,
    consentVersion: r.consent_version,
    signedFullName: r.signed_full_name,
    documentHash: r.document_hash,
    documentUrl: r.document_url,
    createdAt: r.created_at,
  };
}
