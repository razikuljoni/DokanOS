import { create } from 'zustand';
import {
  getTenantSnapshot,
  listTenantOutbox,
  removeOutboxItem,
  updateOutboxItem,
  type CachedProductItem,
  type CachedUnifiedDueItem,
  type OutboxItem,
} from '@/lib/offlineCache';
import { apiFetch, ApiClientError } from '@/lib/api';

interface OfflineState {
  browserOnline: boolean;
  simulateOffline: boolean;
  outboxItems: OutboxItem[];
  isSyncing: boolean;
  lastSyncedAt: string | null;
  cachedProductsCount: number;
  cachedDuesCount: number;
  cachedUpdatedAt: string | null;
  drawerOpen: boolean;
  setBrowserOnline: (online: boolean) => void;
  setSimulateOffline: (simulate: boolean) => void;
  setDrawerOpen: (open: boolean) => void;
  refreshOfflineState: (tenantId: string) => Promise<void>;
  discardOutboxEntry: (tenantId: string, id: string) => Promise<void>;
  syncTenantOutbox: (
    tenantId: string,
    callbacks?: {
      onSuccess?: (syncedCount: number) => void;
      onConflict?: (item: OutboxItem, message: string) => void;
    },
  ) => Promise<{ synced: number; failed: number }>;
}

export const useOfflineStore = create<OfflineState>((set, get) => ({
  browserOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
  simulateOffline: false,
  outboxItems: [],
  isSyncing: false,
  lastSyncedAt: null,
  cachedProductsCount: 0,
  cachedDuesCount: 0,
  cachedUpdatedAt: null,
  drawerOpen: false,

  setBrowserOnline: (browserOnline) => set({ browserOnline }),
  setSimulateOffline: (simulateOffline) => set({ simulateOffline }),
  setDrawerOpen: (drawerOpen) => set({ drawerOpen }),

  refreshOfflineState: async (tenantId: string) => {
    if (!tenantId) return;
    const [outbox, prodSnap, duesSnap] = await Promise.all([
      listTenantOutbox(tenantId),
      getTenantSnapshot<CachedProductItem[]>(tenantId, 'pos-products'),
      getTenantSnapshot<CachedUnifiedDueItem[]>(tenantId, 'dues-list'),
    ]);

    set({
      outboxItems: outbox,
      cachedProductsCount: prodSnap?.data.length ?? 0,
      cachedDuesCount: duesSnap?.data.length ?? 0,
      cachedUpdatedAt: prodSnap?.updatedAt ?? duesSnap?.updatedAt ?? null,
    });
  },

  discardOutboxEntry: async (tenantId: string, id: string) => {
    await removeOutboxItem(id);
    await get().refreshOfflineState(tenantId);
  },

  syncTenantOutbox: async (tenantId, callbacks) => {
    const state = get();
    if (!tenantId || state.isSyncing || !state.browserOnline || state.simulateOffline) {
      return { synced: 0, failed: 0 };
    }

    const items = await listTenantOutbox(tenantId);
    if (items.length === 0) {
      return { synced: 0, failed: 0 };
    }

    set({ isSyncing: true });
    let synced = 0;
    let failed = 0;

    try {
      for (const item of items) {
        await updateOutboxItem(item.id, { status: 'syncing', errorMessage: undefined });
        await get().refreshOfflineState(tenantId);

        try {
          if (item.type === 'pos_sale' && item.salePayload) {
            await apiFetch('/api/v1/sales', {
              method: 'POST',
              body: JSON.stringify(item.salePayload),
            });
          } else if (item.type === 'due_payment' && item.duePaymentPayload) {
            await apiFetch(`/api/v1/dues/${item.duePaymentPayload.refId}/payments`, {
              method: 'POST',
              body: JSON.stringify({
                amount: item.duePaymentPayload.amount,
                method: item.duePaymentPayload.method,
              }),
            });
          }

          await removeOutboxItem(item.id);
          synced += 1;
        } catch (err) {
          failed += 1;
          const isConflict =
            err instanceof ApiClientError &&
            (err.status === 409 || err.code === 'INSUFFICIENT_STOCK' || err.status === 400);
          const msg =
            err instanceof Error ? err.message : 'Failed to synchronize queued transaction';

          await updateOutboxItem(item.id, {
            status: isConflict ? 'conflict' : 'failed',
            errorMessage: msg,
          });

          if (isConflict && callbacks?.onConflict) {
            callbacks.onConflict(item, msg);
          }
        }
      }

      if (synced > 0) {
        set({ lastSyncedAt: new Date().toISOString() });
        callbacks?.onSuccess?.(synced);
      }
    } finally {
      set({ isSyncing: false });
      await get().refreshOfflineState(tenantId);
    }

    return { synced, failed };
  },
}));

export function useIsOffline(): boolean {
  const browserOnline = useOfflineStore((s) => s.browserOnline);
  const simulateOffline = useOfflineStore((s) => s.simulateOffline);
  return !browserOnline || simulateOffline;
}
