import { del, post, upload } from './apiClient';
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

export const userService = {
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

export function resolveAvatarUrl(avatarUrl: string | null | undefined): string | null {
  if (!avatarUrl) return null;
  if (avatarUrl.startsWith('http://') || avatarUrl.startsWith('https://')) {
    return avatarUrl;
  }
  const origin = Config.apiBaseUrl.replace(/\/api\/v\d+\/?$/, '');
  const path = avatarUrl.startsWith('/') ? avatarUrl : `/${avatarUrl}`;
  return `${origin}${path}`;
}

export default userService;
