import { create } from 'zustand';
import type { PlanType, Role, ShopType } from '@dokanos/shared';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  tenantId: string | null;
}

export interface AuthTenant {
  id: string;
  name: string;
  slug: string;
  type: ShopType;
  plan: PlanType;
  planExpiresAt: string | null;
  settings: {
    lowStockThreshold: number;
    currency: string;
  };
}

interface AuthState {
  // Access token is kept strictly in memory only — never in localStorage or sessionStorage (§4)
  accessToken: string | null;
  user: AuthUser | null;
  tenant: AuthTenant | null;
  isInitialized: boolean;
  setAuth: (payload: {
    accessToken: string;
    user: AuthUser;
    tenant: AuthTenant | null;
  }) => void;
  clearAuth: () => void;
  setInitialized: (initialized: boolean) => void;
  updateTenant: (partial: Partial<AuthTenant>) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  accessToken: null,
  user: null,
  tenant: null,
  isInitialized: false,
  setAuth: ({ accessToken, user, tenant }) =>
    set({
      accessToken,
      user,
      tenant,
      isInitialized: true,
    }),
  clearAuth: () =>
    set({
      accessToken: null,
      user: null,
      tenant: null,
      isInitialized: true,
    }),
  setInitialized: (initialized) => set({ isInitialized: initialized }),
  updateTenant: (partial) =>
    set((state) => ({
      tenant: state.tenant ? { ...state.tenant, ...partial } : null,
    })),
}));
