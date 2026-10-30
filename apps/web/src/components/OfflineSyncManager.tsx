import React, { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  CheckCircle2,
  CloudOff,
  Database,
  RefreshCw,
  Trash2,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { useUiStore } from '@/stores/uiStore';
import { useIsOffline, useOfflineStore } from '@/stores/offlineStore';
import { Button } from '@/components/ui/button';
import { formatBDT, formatDateDhaka } from '@/lib/utils';

export function OfflineSyncHeaderControls(): React.ReactElement {
  const tenant = useAuthStore((s) => s.tenant);
  const addToast = useUiStore((s) => s.addToast);
  const queryClient = useQueryClient();

  const isOffline = useIsOffline();
  const simulateOffline = useOfflineStore((s) => s.simulateOffline);
  const outboxItems = useOfflineStore((s) => s.outboxItems);
  const isSyncing = useOfflineStore((s) => s.isSyncing);
  const cachedProductsCount = useOfflineStore((s) => s.cachedProductsCount);
  const setBrowserOnline = useOfflineStore((s) => s.setBrowserOnline);
  const setSimulateOffline = useOfflineStore((s) => s.setSimulateOffline);
  const setDrawerOpen = useOfflineStore((s) => s.setDrawerOpen);
  const refreshOfflineState = useOfflineStore((s) => s.refreshOfflineState);
  const syncTenantOutbox = useOfflineStore((s) => s.syncTenantOutbox);

  useEffect(() => {
    if (tenant?.id) {
      void refreshOfflineState(tenant.id);
    }
  }, [tenant?.id, refreshOfflineState]);

  useEffect(() => {
    const handleOnline = () => {
      setBrowserOnline(true);
      if (tenant?.id && !useOfflineStore.getState().simulateOffline) {
        void syncTenantOutbox(tenant.id, {
          onSuccess: (count) => {
            void queryClient.invalidateQueries({ queryKey: ['products', tenant.id] });
            void queryClient.invalidateQueries({ queryKey: ['dues', tenant.id] });
            void queryClient.invalidateQueries({ queryKey: ['sales', tenant.id] });
            void queryClient.invalidateQueries({ queryKey: ['dashboard', tenant.id] });
            addToast({
              title: 'Offline Ledger Synchronized',
              description: `Replayed ${count} queued transaction(s) to MongoDB.`,
              variant: 'success',
            });
          },
          onConflict: (item, msg) => {
            addToast({
              title: `Sync Conflict: ${item.title}`,
              description: msg,
              variant: 'danger',
            });
          },
        });
      }
    };

    const handleOffline = () => {
      setBrowserOnline(false);
      addToast({
        title: 'Network Outage Detected — Offline Mode Active',
        description:
          'POS Terminal and Baki Dues Ledger remain operational using your local shop cache.',
        variant: 'warning',
      });
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [tenant?.id, setBrowserOnline, syncTenantOutbox, queryClient, addToast]);

  const handleToggleSimulateOffline = (): void => {
    const next = !simulateOffline;
    setSimulateOffline(next);
    if (next) {
      addToast({
        title: 'Simulated Shop Network Outage Active',
        description:
          'POS sales and Baki due collections will now run against local IndexedDB cache and queue in the Outbox.',
        variant: 'warning',
      });
    } else {
      addToast({
        title: 'Network Restored — Replaying Outbox',
        description: 'Synchronizing queued offline POS sales and Baki payments...',
        variant: 'default',
      });
      if (tenant?.id) {
        setTimeout(() => {
          void syncTenantOutbox(tenant.id, {
            onSuccess: (count) => {
              void queryClient.invalidateQueries({ queryKey: ['products', tenant.id] });
              void queryClient.invalidateQueries({ queryKey: ['dues', tenant.id] });
              void queryClient.invalidateQueries({ queryKey: ['sales', tenant.id] });
              void queryClient.invalidateQueries({ queryKey: ['dashboard', tenant.id] });
              addToast({
                title: 'Offline Outbox Synced',
                description: `Committed ${count} queued transaction(s) in MongoDB.`,
                variant: 'success',
              });
            },
            onConflict: (item, msg) => {
              addToast({
                title: `Sync Conflict: ${item.title}`,
                description: msg,
                variant: 'danger',
              });
            },
          });
        }, 50);
      }
    }
  };

  return (
    <div className="flex items-center gap-2">
      {/* Toggle button to test/simulate shop internet outage directly in UI */}
      <button
        type="button"
        onClick={handleToggleSimulateOffline}
        title={
          isOffline
            ? 'Click to reconnect to live server and sync queued transactions'
            : 'Simulate a temporary shop internet outage to test offline POS & Dues'
        }
        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border text-xs font-medium transition-colors cursor-pointer ${
          isOffline
            ? 'border-warning bg-warning/15 text-warning'
            : 'border-border bg-secondary/60 text-muted-foreground hover:text-foreground'
        }`}
      >
        {isOffline ? (
          <>
            <WifiOff className="h-3.5 w-3.5" />
            <span>Offline Mode</span>
          </>
        ) : (
          <>
            <Wifi className="h-3.5 w-3.5 text-primary" />
            <span className="hidden xl:inline">Online · {cachedProductsCount} Cached</span>
            <span className="xl:hidden">Online</span>
          </>
        )}
      </button>

      {/* Outbox & Local Cache Inspector Trigger */}
      <button
        type="button"
        onClick={() => setDrawerOpen(true)}
        title="Inspect Local Cache & Offline Sync Outbox"
        className={`relative flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border text-xs font-mono tabular-nums transition-colors cursor-pointer ${
          outboxItems.length > 0
            ? 'border-primary bg-primary text-white'
            : 'border-border bg-card hover:bg-secondary text-foreground'
        }`}
      >
        {isSyncing ? (
          <RefreshCw className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Database className="h-3.5 w-3.5" />
        )}
        <span className="hidden sm:inline">Outbox</span>
        <span>({outboxItems.length})</span>
      </button>
    </div>
  );
}

export function OfflineBannerAndDrawer(): React.ReactElement {
  const tenant = useAuthStore((s) => s.tenant);
  const addToast = useUiStore((s) => s.addToast);
  const queryClient = useQueryClient();

  const isOffline = useIsOffline();
  const simulateOffline = useOfflineStore((s) => s.simulateOffline);
  const outboxItems = useOfflineStore((s) => s.outboxItems);
  const isSyncing = useOfflineStore((s) => s.isSyncing);
  const lastSyncedAt = useOfflineStore((s) => s.lastSyncedAt);
  const cachedProductsCount = useOfflineStore((s) => s.cachedProductsCount);
  const cachedDuesCount = useOfflineStore((s) => s.cachedDuesCount);
  const cachedUpdatedAt = useOfflineStore((s) => s.cachedUpdatedAt);
  const drawerOpen = useOfflineStore((s) => s.drawerOpen);
  const setSimulateOffline = useOfflineStore((s) => s.setSimulateOffline);
  const setDrawerOpen = useOfflineStore((s) => s.setDrawerOpen);
  const discardOutboxEntry = useOfflineStore((s) => s.discardOutboxEntry);
  const syncTenantOutbox = useOfflineStore((s) => s.syncTenantOutbox);

  const handleManualSync = async (): Promise<void> => {
    if (!tenant?.id) return;
    if (simulateOffline) {
      setSimulateOffline(false);
    }
    const res = await syncTenantOutbox(tenant.id, {
      onSuccess: (count) => {
        void queryClient.invalidateQueries({ queryKey: ['products', tenant.id] });
        void queryClient.invalidateQueries({ queryKey: ['dues', tenant.id] });
        void queryClient.invalidateQueries({ queryKey: ['sales', tenant.id] });
        void queryClient.invalidateQueries({ queryKey: ['dashboard', tenant.id] });
        addToast({
          title: 'Outbox Synchronized',
          description: `Committed ${count} queued transaction(s) to MongoDB.`,
          variant: 'success',
        });
      },
      onConflict: (item, msg) => {
        addToast({
          title: `Sync Conflict: ${item.title}`,
          description: msg,
          variant: 'danger',
        });
      },
    });

    if (res.synced === 0 && res.failed === 0 && outboxItems.length === 0) {
      addToast({
        title: 'Ledger Up to Date',
        description: 'No pending offline transactions in outbox.',
      });
    }
  };

  return (
    <>
      {/* Persistent Top Banner when Offline or Outbox has pending items */}
      {(isOffline || outboxItems.length > 0) && (
        <div
          className={`px-6 py-2 border-b text-xs flex flex-wrap items-center justify-between gap-3 ${
            isOffline
              ? 'bg-warning/15 border-warning/40 text-foreground'
              : 'bg-primary/10 border-primary/30 text-foreground'
          }`}
        >
          <div className="flex items-center gap-2">
            {isOffline ? (
              <CloudOff className="h-4 w-4 text-warning shrink-0" />
            ) : (
              <RefreshCw className={`h-4 w-4 text-primary shrink-0 ${isSyncing ? 'animate-spin' : ''}`} />
            )}
            <span>
              {isOffline ? (
                <>
                  <strong>Offline Counter Mode Active</strong> — POS catalog ({cachedProductsCount}{' '}
                  items) and Baki dues ({cachedDuesCount} records) are served from local IndexedDB
                  cache. Sales &amp; due collections will queue in the Outbox ({outboxItems.length}{' '}
                  queued).
                </>
              ) : (
                <>
                  <strong>{outboxItems.length} Offline Transaction(s) Queued</strong> — Ready to
                  replay atomically against the MongoDB server.
                </>
              )}
            </span>
          </div>

          <div className="flex items-center gap-2">
            {simulateOffline && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  void handleManualSync();
                }}
              >
                <Wifi className="h-3.5 w-3.5 text-primary" />
                Reconnect &amp; Sync Now
              </Button>
            )}
            {!isOffline && outboxItems.length > 0 && (
              <Button
                size="sm"
                disabled={isSyncing}
                onClick={() => {
                  void handleManualSync();
                }}
              >
                <RefreshCw className={`h-3.5 w-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
                {isSyncing ? 'Syncing...' : 'Sync Outbox Now'}
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={() => setDrawerOpen(true)}>
              View Outbox ({outboxItems.length})
            </Button>
          </div>
        </div>
      )}

      {/* Slide-Over Offline Cache & Outbox Drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 flex justify-end">
          <div className="bg-card border-l border-border w-full max-w-lg h-full flex flex-col justify-between p-6 overflow-y-auto">
            <div className="space-y-5">
              <div className="flex items-center justify-between border-b border-border pb-4">
                <div>
                  <h2 className="font-display text-lg font-bold">
                    Offline Cache &amp; Sync Outbox
                  </h2>
                  <p className="text-xs text-muted-foreground">
                    Tenant-scoped IndexedDB snapshot + FIFO transaction queue for {tenant?.name}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setDrawerOpen(false)}
                  className="p-1.5 rounded-md text-muted-foreground hover:text-foreground cursor-pointer"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Local Cache Health Card */}
              <div className="rounded-md border border-border bg-secondary/40 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-display text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Local IndexedDB Snapshot ({tenant?.slug})
                  </span>
                  <span
                    className={`text-xs font-medium flex items-center gap-1 ${
                      isOffline ? 'text-warning' : 'text-primary'
                    }`}
                  >
                    {isOffline ? (
                      <>
                        <WifiOff className="h-3.5 w-3.5" /> Offline Active
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="h-3.5 w-3.5" /> Online &amp; Cached
                      </>
                    )}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-3 pt-1">
                  <div className="p-3 rounded border border-border bg-card">
                    <div className="text-[11px] text-muted-foreground">POS Products Cached</div>
                    <div className="font-display text-xl font-bold font-mono tabular-nums mt-0.5">
                      {cachedProductsCount}
                    </div>
                  </div>
                  <div className="p-3 rounded border border-border bg-card">
                    <div className="text-[11px] text-muted-foreground">Open Baki Dues Cached</div>
                    <div className="font-display text-xl font-bold font-mono tabular-nums mt-0.5">
                      {cachedDuesCount}
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between text-[11px] text-muted-foreground pt-1">
                  <span>
                    Snapshot updated:{' '}
                    {cachedUpdatedAt ? formatDateDhaka(cachedUpdatedAt) : 'Waiting for first load'}
                  </span>
                  {lastSyncedAt && <span>Last Outbox sync: {formatDateDhaka(lastSyncedAt)}</span>}
                </div>
              </div>

              {/* Outbox Queue List */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <h3 className="font-display text-sm font-semibold">
                    Queued Offline Mutations ({outboxItems.length})
                  </h3>
                  {outboxItems.length > 0 && (
                    <Button
                      size="sm"
                      disabled={isSyncing}
                      onClick={() => {
                        void handleManualSync();
                      }}
                    >
                      <RefreshCw className={`h-3.5 w-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
                      {simulateOffline ? 'Exit Offline & Sync' : 'Sync All Now'}
                    </Button>
                  )}
                </div>

                {outboxItems.length === 0 ? (
                  <div className="p-8 text-center border border-dashed border-border rounded-md text-xs text-muted-foreground">
                    Outbox is empty. All POS sales and Baki due payments are synchronized with
                    MongoDB.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {outboxItems.map((item) => (
                      <div
                        key={item.id}
                        className="p-3.5 rounded-md border border-border bg-card space-y-2 text-xs"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="font-display font-semibold text-foreground">
                              {item.title}
                            </div>
                            <div className="text-muted-foreground">{item.subtitle}</div>
                          </div>
                          <div className="text-right">
                            <div className="font-mono font-bold tabular-nums text-foreground">
                              {formatBDT(item.amount)}
                            </div>
                            <span
                              className={`inline-block text-[10px] font-mono uppercase px-1.5 py-0.5 rounded mt-0.5 ${
                                item.status === 'conflict' || item.status === 'failed'
                                  ? 'bg-destructive/15 text-destructive font-semibold'
                                  : item.status === 'syncing'
                                    ? 'bg-primary/15 text-primary'
                                    : 'bg-warning/15 text-warning font-medium'
                              }`}
                            >
                              {item.status}
                            </span>
                          </div>
                        </div>

                        {item.errorMessage && (
                          <div className="p-2 rounded bg-destructive/10 border border-destructive/30 text-destructive flex items-start gap-1.5 text-[11px]">
                            <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                            <span>{item.errorMessage}</span>
                          </div>
                        )}

                        <div className="flex items-center justify-between pt-1 border-t border-border/60 text-[11px] text-muted-foreground">
                          <span>Queued {formatDateDhaka(item.createdAt)}</span>
                          {tenant?.id && (
                            <button
                              type="button"
                              onClick={() => void discardOutboxEntry(tenant.id, item.id)}
                              className="text-muted-foreground hover:text-destructive flex items-center gap-1 cursor-pointer"
                            >
                              <Trash2 className="h-3 w-3" />
                              Discard
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="pt-4 border-t border-border flex items-center justify-between gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSimulateOffline(!simulateOffline)}
              >
                {simulateOffline ? (
                  <>
                    <Wifi className="h-3.5 w-3.5 text-primary" />
                    Restore Live Connection
                  </>
                ) : (
                  <>
                    <WifiOff className="h-3.5 w-3.5 text-warning" />
                    Simulate Shop Outage
                  </>
                )}
              </Button>
              <Button size="sm" onClick={() => setDrawerOpen(false)}>
                Close
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
