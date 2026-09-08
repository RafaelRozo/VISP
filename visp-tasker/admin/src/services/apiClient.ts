import axios, { AxiosError, AxiosInstance, InternalAxiosRequestConfig } from 'axios';
import { Config } from './config';

const TOKEN_KEY = 'visp_admin_access';
const REFRESH_KEY = 'visp_admin_refresh';

export function setAdminTokens(access: string, refresh: string): void {
  localStorage.setItem(TOKEN_KEY, access);
  localStorage.setItem(REFRESH_KEY, refresh);
}

export function clearAdminTokens(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_KEY);
}

export function getAdminAccessToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function getAdminRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_KEY);
}

const apiClient: AxiosInstance = axios.create({
  baseURL: Config.apiBaseUrl,
  timeout: 30000,
  headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
});

apiClient.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = getAdminAccessToken();
  if (token && config.headers) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

let isRefreshing = false;
let refreshQueue: Array<(t: string | null) => void> = [];

apiClient.interceptors.response.use(
  (r) => r,
  async (error: AxiosError) => {
    const original = error.config as InternalAxiosRequestConfig & { _retry?: boolean };
    if (
      error.response?.status === 401 &&
      original &&
      !original._retry &&
      !original.url?.includes('/admin/auth/')
    ) {
      original._retry = true;
      const refresh = getAdminRefreshToken();
      if (!refresh) {
        clearAdminTokens();
        window.location.href = '/console';
        return Promise.reject(error);
      }
      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          refreshQueue.push((newToken) => {
            if (newToken) {
              if (original.headers) original.headers.Authorization = `Bearer ${newToken}`;
              resolve(apiClient(original));
            } else {
              reject(error);
            }
          });
        });
      }
      isRefreshing = true;
      try {
        const res = await axios.post(`${Config.apiBaseUrl}/admin/auth/refresh`, {
          refreshToken: refresh,
        });
        const { accessToken, refreshToken } = res.data?.data ?? res.data;
        setAdminTokens(accessToken, refreshToken);
        refreshQueue.forEach((fn) => fn(accessToken));
        refreshQueue = [];
        if (original.headers) original.headers.Authorization = `Bearer ${accessToken}`;
        return apiClient(original);
      } catch (err) {
        refreshQueue.forEach((fn) => fn(null));
        refreshQueue = [];
        clearAdminTokens();
        window.location.href = '/console';
        return Promise.reject(err);
      } finally {
        isRefreshing = false;
      }
    }
    return Promise.reject(error);
  },
);

function unwrap<T>(payload: any): T {
  return payload?.data?.data ?? payload?.data;
}

export async function apiGet<T>(url: string, params?: Record<string, any>): Promise<T> {
  const r = await apiClient.get(url, { params });
  return unwrap<T>(r);
}

export async function apiPost<T>(url: string, body?: any): Promise<T> {
  const r = await apiClient.post(url, body ?? {});
  return unwrap<T>(r);
}

export async function apiPatch<T>(url: string, body?: any): Promise<T> {
  const r = await apiClient.patch(url, body ?? {});
  return unwrap<T>(r);
}

export async function apiDelete<T>(url: string): Promise<T> {
  const r = await apiClient.delete(url);
  return unwrap<T>(r);
}

/**
 * Descarga un archivo protegido y devuelve un object-URL para verlo o guardarlo.
 *
 * Los contratos firmados NO se sirven por el mount estático de `/uploads`:
 * llevan nombre legal completo y firma manuscrita, y un UUID es inadivinable
 * pero no privado. Como el endpoint exige el token de admin, un `<img src>` o
 * un `<a href>` normales no valen —no llevan cabecera— así que se baja como
 * blob y se le da al navegador una URL local.
 *
 * Quien lo llame DEBE hacer `URL.revokeObjectURL` al cerrar: cada blob que no
 * se libera se queda en memoria hasta recargar la página.
 */
export async function apiGetBlobUrl(url: string): Promise<string> {
  const r = await apiClient.get(url, { responseType: 'blob' });
  return URL.createObjectURL(r.data as Blob);
}

export default apiClient;
