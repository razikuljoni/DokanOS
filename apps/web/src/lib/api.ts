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

export async function tryRefreshSession(): Promise<string | null> {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    try {
      const res = await fetch('/api/v1/auth/refresh', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!res.ok) {
        useAuthStore.getState().clearAuth();
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
      useAuthStore.getState().clearAuth();
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

  let response = await fetch(path, {
    ...rest,
    headers,
    credentials: 'include',
  });

  if (response.status === 401 && !skipAuthRefresh && !path.includes('/auth/login')) {
    const newToken = await tryRefreshSession();
    if (newToken) {
      headers.set('Authorization', `Bearer ${newToken}`);
      response = await fetch(path, {
        ...rest,
        headers,
        credentials: 'include',
      });
    }
  }

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
