/**
 * VISP/Tasker - API Client
 *
 * Axios instance configured with base URL, auth token interceptor,
 * error handling interceptor, and typed response wrappers.
 */

import axios, {
  AxiosError,
  AxiosInstance,
  AxiosResponse,
  InternalAxiosRequestConfig,
  AxiosRequestConfig,
} from 'axios';
import { ApiError } from '../types';
import { Config } from './config';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const BASE_URL = Config.apiBaseUrl;

const REQUEST_TIMEOUT = 30000;

// ---------------------------------------------------------------------------
// Token management (will be wired to secure storage at app init)
// ---------------------------------------------------------------------------

let _accessToken: string | null = null;
let _refreshToken: string | null = null;
let _onTokenRefreshFailed: (() => void) | null = null;

export function setTokens(access: string, refresh: string): void {
  _accessToken = access;
  _refreshToken = refresh;
}

export function clearTokens(): void {
  _accessToken = null;
  _refreshToken = null;
}

export function setOnTokenRefreshFailed(callback: () => void): void {
  _onTokenRefreshFailed = callback;
}

// ---------------------------------------------------------------------------
// Axios instance
// ---------------------------------------------------------------------------

const apiClient: AxiosInstance = axios.create({
  baseURL: BASE_URL,
  timeout: REQUEST_TIMEOUT,
  headers: {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  },
});

// ---------------------------------------------------------------------------
// Request interceptor -- attach auth token
// ---------------------------------------------------------------------------

apiClient.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    if (_accessToken && config.headers) {
      config.headers.Authorization = `Bearer ${_accessToken}`;
    }
    return config;
  },
  (error: AxiosError) => Promise.reject(error),
);

// ---------------------------------------------------------------------------
// Response interceptor -- normalise errors & handle 401 refresh
// ---------------------------------------------------------------------------

let isRefreshing = false;
let failedQueue: Array<{
  resolve: (token: string) => void;
  reject: (err: unknown) => void;
}> = [];

function processQueue(error: unknown, token: string | null): void {
  failedQueue.forEach((prom) => {
    if (error) {
      prom.reject(error);
    } else if (token) {
      prom.resolve(token);
    }
  });
  failedQueue = [];
}

apiClient.interceptors.response.use(
  (response: AxiosResponse) => response,
  async (error: AxiosError<ApiError>) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & {
      _retry?: boolean;
    };

    // Attempt token refresh on 401 (but only once per request)
    if (
      error.response?.status === 401 &&
      !originalRequest._retry &&
      _refreshToken
    ) {
      if (isRefreshing) {
        return new Promise<string>((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        })
          .then((token) => {
            if (originalRequest.headers) {
              originalRequest.headers.Authorization = `Bearer ${token}`;
            }
            return apiClient(originalRequest);
          })
          .catch((err) => Promise.reject(err));
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        const refreshResponse = await axios.post(`${BASE_URL}/auth/refresh`, {
          refreshToken: _refreshToken,
        });

        // Backend wraps response: { data: { tokens: { accessToken, refreshToken } } }
        const refreshData = refreshResponse.data?.data ?? refreshResponse.data;
        const { accessToken, refreshToken } = refreshData.tokens;
        setTokens(accessToken, refreshToken);

        processQueue(null, accessToken);

        if (originalRequest.headers) {
          originalRequest.headers.Authorization = `Bearer ${accessToken}`;
        }
        return apiClient(originalRequest);
      } catch (refreshError) {
        processQueue(refreshError, null);
        clearTokens();
        _onTokenRefreshFailed?.();
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
    }

    // Normalise the error shape — always include statusCode and message
    const responseData = error.response?.data as Record<string, unknown> | undefined;
    const apiError: ApiError = {
      message:
        responseData?.message as string ??
        responseData?.detail as string ??
        error.message ??
        'An unexpected error occurred',
      code: (responseData?.code as string) ?? 'NETWORK_ERROR',
      statusCode: error.response?.status ?? 0,
    };

    return Promise.reject(apiError);
  },
);

// ---------------------------------------------------------------------------
// Typed response helpers
// ---------------------------------------------------------------------------

export interface ApiResponse<T> {
  data: T;
  message?: string;
}

export async function get<T>(url: string, params?: Record<string, unknown>): Promise<T> {
  const response = await apiClient.get<ApiResponse<T>>(url, { params });
  return response.data.data;
}

export async function post<T>(url: string, body?: unknown, config?: InternalAxiosRequestConfig): Promise<T> {
  const response = await apiClient.post<ApiResponse<T>>(url, body, config);
  return response.data.data;
}

export async function put<T>(url: string, body?: unknown, config?: InternalAxiosRequestConfig): Promise<T> {
  const response = await apiClient.put<ApiResponse<T>>(url, body, config);
  return response.data.data;
}

export async function patch<T>(url: string, body?: unknown, config?: InternalAxiosRequestConfig): Promise<T> {
  const response = await apiClient.patch<ApiResponse<T>>(url, body, config);
  return response.data.data;
}

export async function del<T = void>(url: string): Promise<T> {
  const response = await apiClient.delete<ApiResponse<T>>(url);
  return response.data.data;
}

export async function upload<T>(
  url: string,
  formData: FormData,
  onProgress?: (percent: number) => void,
): Promise<T> {
  const response = await apiClient.post<ApiResponse<T>>(url, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    onUploadProgress: (progressEvent) => {
      if (onProgress && progressEvent.total) {
        const percent = Math.round(
          (progressEvent.loaded * 100) / progressEvent.total,
        );
        onProgress(percent);
      }
    },
  });
  return response.data.data;
}

export default apiClient;
