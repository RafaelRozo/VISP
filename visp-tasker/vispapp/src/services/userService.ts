import { del, patch, post, upload } from './apiClient';
import { Config } from './config';
import type { User } from '../types';

export type AvatarUploadAsset = {
  uri: string;
  mimeType?: string | null;
  fileName?: string | null;
};

function inferExt(uri: string, mimeType?: string | null): string {
  if (mimeType?.includes('png')) return 'png';
  if (mimeType?.includes('webp')) return 'webp';
  if (mimeType?.includes('heic')) return 'heic';
  if (mimeType?.includes('heif')) return 'heif';
  const m = uri.match(/\.([a-zA-Z0-9]{3,4})(?:\?|#|$)/);
  if (m) return m[1].toLowerCase();
  return 'jpg';
}

export interface UpdateProfileBody {
  firstName?: string;
  lastName?: string;
  phone?: string;
  defaultAddress?: {
    street?: string;
    city?: string;
    province?: string;
    postalCode?: string;
    country?: string;
    latitude?: number | null;
    longitude?: number | null;
    formattedAddress?: string;
  };
}

export const userService = {
  updateProfile: async (body: UpdateProfileBody): Promise<User> => {
    return patch<User>('/users/me', body);
  },

  uploadAvatar: async (asset: AvatarUploadAsset): Promise<User> => {
    const formData = new FormData();
    const ext = inferExt(asset.uri, asset.mimeType);
    formData.append('file', {
      uri: asset.uri,
      type: asset.mimeType || `image/${ext === 'jpg' ? 'jpeg' : ext}`,
      name: asset.fileName || `avatar.${ext}`,
    } as any);
    return upload<User>('/users/me/avatar', formData);
  },

  removeAvatar: async (): Promise<User> => {
    return del<User>('/users/me/avatar');
  },

  getRecoveryCode: async (password: string): Promise<string> => {
    const res = await post<{ recoveryCode: string }>('/users/me/recovery-code', { password });
    return res.recoveryCode;
  },

  rotateRecoveryCode: async (password: string): Promise<string> => {
    const res = await post<{ recoveryCode: string }>('/users/me/recovery-code/rotate', { password });
    return res.recoveryCode;
  },

  recoverPassword: async (
    email: string,
    recoveryCode: string,
    newPassword: string,
  ): Promise<string> => {
    const res = await post<{ recoveryCode: string }>('/auth/recover-password', {
      email,
      recoveryCode,
      newPassword,
    });
    return res.recoveryCode;
  },
};

/**
 * Convierte una ruta relativa de `/uploads/...` en una URL absoluta que el
 * componente <Image> pueda cargar. Sirve para CUALQUIER archivo subido —
 * avatares, documentos, evidencia de reserva — no solo avatares.
 */
export function resolveUploadUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return url;
  }
  const origin = Config.apiBaseUrl.replace(/\/api\/v\d+\/?$/, '');
  const path = url.startsWith('/') ? url : `/${url}`;
  return `${origin}${path}`;
}

/**
 * @deprecated Alias histórico de {@link resolveUploadUrl}. El nombre sugería que
 * era solo para avatares y por eso se estuvo a punto de duplicar la lógica.
 * Se conserva porque ya lo usan Profile y Dashboard.
 */
export const resolveAvatarUrl = resolveUploadUrl;

export default userService;
