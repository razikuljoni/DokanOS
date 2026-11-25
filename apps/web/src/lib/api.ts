import type { ErrorCode } from '@dokanos/shared';
import { useAuthStore, type AuthTenant, type AuthUser } from '@/stores/authStore';

export class ApiClientError extends Error {
  public readonly status: number;
  public readonly code: ErrorCode;
  public readonly details?: Record<string, string[]>;

  constructor(
    status: number,
    code: ErrorCode,
    message: string,
    details?: Record<string, string[]>,
  ) {
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

let refreshPromise: Promise<string | null> | null = null;

// Default request timeout to prevent requests from hanging forever if the server
// is down, stuck on a slow third-party API, or a connection is dropped silently.
const DEFAULT_TIMEOUT_MS = 45000;

export async function tryRefreshSession(): Promise<string | null> {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    try {
      const res = await fetch('/api/v1/auth/refresh', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      });

      if (res.status === 401 || res.status === 403) {
        useAuthStore.getState().clearAuth();
        return null;
      }

      if (!res.ok) {
        return null;
      }

      const data = (await res.json()) as {
        accessToken: string;
        user: AuthUser;
        tenant: AuthTenant | null;
      };
      useAuthStore.getState().setAuth(data);
      return data.accessToken;
    } catch {
      // Do not wipe in-memory user/tenant during a temporary retail shop network outage
      if (!useAuthStore.getState().user) {
        useAuthStore.getState().clearAuth();
      }
      return null;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

export async function apiFetch<T>(
  path: string,
  options: RequestInit & { skipAuthRefresh?: boolean } = {},
): Promise<T> {
  const { skipAuthRefresh = false, headers: customHeaders, ...rest } = options;
  const token = useAuthStore.getState().accessToken;

  const headers = new Headers(customHeaders);
  if (!headers.has('Content-Type') && rest.body && typeof rest.body === 'string') {
    headers.set('Content-Type', 'application/json');
  }
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(path, {
      ...rest,
      headers,
      credentials: 'include',
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeoutId);
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new ApiClientError(
        408,
        'TIMEOUT',
        'Request timed out: the server took longer than 45 seconds to respond. Please check your internet connection or try again.',
      );
    }
    throw err;
  }

  if (response.status === 401 && !skipAuthRefresh && !path.includes('/auth/login')) {
    const newToken = await tryRefreshSession();
    if (newToken) {
      headers.set('Authorization', `Bearer ${newToken}`);
      response = await fetch(path, {
        ...rest,
        headers,
        credentials: 'include',
        signal: controller.signal,
      });
    }
  }
  clearTimeout(timeoutId);

  if (!response.ok) {
    let errorCode: ErrorCode = 'INTERNAL_ERROR';
    let errorMessage = `Request failed (${response.status})`;
    let errorDetails: Record<string, string[]> | undefined;

    try {
      const errBody = (await response.json()) as {
        error?: { code?: ErrorCode; message?: string; details?: Record<string, string[]> };
      };
      if (errBody.error) {
        errorCode = errBody.error.code ?? errorCode;
        errorMessage = errBody.error.message ?? errorMessage;
        errorDetails = errBody.error.details;
      }
    } catch {
      // Non-JSON error body
    }

    throw new ApiClientError(response.status, errorCode, errorMessage, errorDetails);
  }

  return (await response.json()) as T;
}
