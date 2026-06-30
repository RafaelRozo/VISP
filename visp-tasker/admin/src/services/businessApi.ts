/**
 * Business (standard-user) API client for "VISP for Business".
 *
 * Completely isolated from the admin console session: uses its own axios
 * instance and its own localStorage keys so the two auth contexts never
 * collide. Business owners authenticate as normal users via /auth/* and the
 * resulting JWT is attached here as `Authorization: Bearer`.
 */
import axios, { AxiosError, AxiosInstance, InternalAxiosRequestConfig } from 'axios';
import { Config } from './config';

const TOKEN_KEY = 'visp_biz_access';
const REFRESH_KEY = 'visp_biz_refresh';

export function setBizTokens(access: string, refresh: string): void {
  localStorage.setItem(TOKEN_KEY, access);
  localStorage.setItem(REFRESH_KEY, refresh);
}

export function clearBizTokens(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_KEY);
}

export function getBizAccessToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function getBizRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_KEY);
}

const bizClient: AxiosInstance = axios.create({
  baseURL: Config.apiBaseUrl,
  timeout: 30000,
  headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
});

bizClient.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = getBizAccessToken();
  if (token && config.headers) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

let isRefreshing = false;
let refreshQueue: Array<(t: string | null) => void> = [];

bizClient.interceptors.response.use(
  (r) => r,
  async (error: AxiosError) => {
    const original = error.config as InternalAxiosRequestConfig & { _retry?: boolean };
    if (
      error.response?.status === 401 &&
      original &&
      !original._retry &&
      !original.url?.includes('/auth/')
    ) {
      original._retry = true;
      const refresh = getBizRefreshToken();
      if (!refresh) {
        clearBizTokens();
        window.location.href = '/business/login';
        return Promise.reject(error);
      }
      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          refreshQueue.push((newToken) => {
            if (newToken) {
              if (original.headers) original.headers.Authorization = `Bearer ${newToken}`;
              resolve(bizClient(original));
            } else {
              reject(error);
            }
          });
        });
      }
      isRefreshing = true;
      try {
        const res = await axios.post(`${Config.apiBaseUrl}/auth/refresh`, {
          refreshToken: refresh,
        });
        const tokens = res.data?.data?.tokens ?? res.data?.tokens ?? res.data?.data ?? res.data;
        const accessToken = tokens.accessToken ?? tokens.access_token;
        const refreshToken = tokens.refreshToken ?? tokens.refresh_token;
        setBizTokens(accessToken, refreshToken);
        refreshQueue.forEach((fn) => fn(accessToken));
        refreshQueue = [];
        if (original.headers) original.headers.Authorization = `Bearer ${accessToken}`;
        return bizClient(original);
      } catch (err) {
        refreshQueue.forEach((fn) => fn(null));
        refreshQueue = [];
        clearBizTokens();
        window.location.href = '/business/login';
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

export async function bizGet<T>(url: string, params?: Record<string, any>): Promise<T> {
  const r = await bizClient.get(url, { params });
  return unwrap<T>(r);
}

/** Pagination metadata returned by list endpoints alongside `data`. */
export interface PageMeta {
  page: number;
  page_size: number;
  total_items: number;
  total_pages: number;
}

/**
 * GET that returns the full response envelope `{ data, meta }` WITHOUT
 * unwrapping. Needed for paginated list endpoints where the caller must read
 * `meta.total_pages` to loop through every page (the unwrapping `bizGet`
 * drops `meta`).
 */
export async function bizGetEnvelope<T = any>(
  url: string,
  params?: Record<string, any>,
): Promise<{ data: T[]; meta?: PageMeta }> {
  const r = await bizClient.get(url, { params });
  return r.data as { data: T[]; meta?: PageMeta };
}

export async function bizDelete<T>(url: string): Promise<T> {
  const r = await bizClient.delete(url);
  return unwrap<T>(r);
}

export async function bizPost<T>(url: string, body?: any): Promise<T> {
  const r = await bizClient.post(url, body ?? {});
  return unwrap<T>(r);
}

export async function bizPut<T>(url: string, body?: any): Promise<T> {
  const r = await bizClient.put(url, body ?? {});
  return unwrap<T>(r);
}

/** Multipart upload — let the browser/axios set the boundary header. */
export async function bizUpload<T>(url: string, form: FormData): Promise<T> {
  const r = await bizClient.post(url, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return unwrap<T>(r);
}

export default bizClient;
