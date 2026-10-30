import type { PaymentMethod } from '@dokanos/shared';

export interface CachedProductItem {
  _id: string;
  name: string;
  category: string;
  unit: string;
  sku: string;
  sellPrice: number;
  stock: number;
  lowStockAt: number;
}

export interface CachedCompletedSale {
  _id: string;
  invoiceNo: string;
  items: Array<{ name: string; qty: number; price: number; lineTotal: number }>;
  subtotal: number;
  discount: number;
  total: number;
  paidAmount: number;
  dueAmount: number;
  paymentMethod: string;
  paymentStatus: string;
  customerName: string;
  customerPhone: string;
  createdAt: string;
  isOfflineQueued?: boolean;
}

export interface CachedUnifiedDueItem {
  refId: string;
  refNo: string;
  partyType: 'customer' | 'supplier';
  partyName: string;
  partyPhone: string;
  totalAmount: number;
  paidAmount: number;
  dueAmount: number;
  ageDays: number;
  ageingBucket: '0-7' | '8-30' | '30+';
  createdAt: string;
  isOfflineQueued?: boolean;
}

export interface CachedDuesSummary {
  totalReceivable: number;
  totalPayable: number;
  netPosition: number;
  customerCount: number;
  supplierCount: number;
  buckets: Record<
    '0-7' | '8-30' | '30+',
    { receivable: number; payable: number; count: number }
  >;
}

export interface OutboxPosSalePayload {
  items: Array<{ productId: string; qty: number }>;
  discount: number;
  paymentMethod: PaymentMethod;
  paidAmount: number;
  customerName: string;
  customerPhone: string;
}

export interface OutboxDuePaymentPayload {
  refId: string;
  amount: number;
  method: PaymentMethod;
}

export type OutboxItemStatus = 'pending' | 'syncing' | 'conflict' | 'failed';

export interface OutboxItem {
  id: string;
  tenantId: string;
  type: 'pos_sale' | 'due_payment';
  title: string;
  subtitle: string;
  amount: number;
  createdAt: string;
  status: OutboxItemStatus;
  errorMessage?: string;
  salePayload?: OutboxPosSalePayload;
  receiptSnapshot?: CachedCompletedSale;
  duePaymentPayload?: OutboxDuePaymentPayload;
}

export type SnapshotResourceKey = 'pos-products' | 'dues-list' | 'dues-summary';

interface SnapshotRecord<T = unknown> {
  key: string;
  tenantId: string;
  resourceKey: SnapshotResourceKey;
  data: T;
  updatedAt: string;
}

const DB_NAME = 'dokanos-offline-ledger-v1';
const DB_VERSION = 1;
const STORE_SNAPSHOTS = 'snapshots';
const STORE_OUTBOX = 'outbox';

// In-memory fallback map when IndexedDB is unavailable in restricted contexts
const memorySnapshots = new Map<string, SnapshotRecord>();
const memoryOutbox = new Map<string, OutboxItem>();

function openLedgerDb(): Promise<IDBDatabase | null> {
  if (typeof window === 'undefined' || !('indexedDB' in window)) {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    try {
      const request = window.indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_SNAPSHOTS)) {
          const snapStore = db.createObjectStore(STORE_SNAPSHOTS, { keyPath: 'key' });
          snapStore.createIndex('by_tenant', 'tenantId', { unique: false });
        }
        if (!db.objectStoreNames.contains(STORE_OUTBOX)) {
          const outboxStore = db.createObjectStore(STORE_OUTBOX, { keyPath: 'id' });
          outboxStore.createIndex('by_tenant', 'tenantId', { unique: false });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function saveTenantSnapshot<T>(
  tenantId: string,
  resourceKey: SnapshotResourceKey,
  data: T,
): Promise<void> {
  const key = `${tenantId}:${resourceKey}`;
  const record: SnapshotRecord<T> = {
    key,
    tenantId,
    resourceKey,
    data,
    updatedAt: new Date().toISOString(),
  };

  memorySnapshots.set(key, record);

  const db = await openLedgerDb();
  if (!db) return;

  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE_SNAPSHOTS, 'readwrite');
      tx.objectStore(STORE_SNAPSHOTS).put(record);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        resolve();
      };
    } catch {
      db.close();
      resolve();
    }
  });
}

export async function getTenantSnapshot<T>(
  tenantId: string,
  resourceKey: SnapshotResourceKey,
): Promise<{ data: T; updatedAt: string } | null> {
  const key = `${tenantId}:${resourceKey}`;
  const db = await openLedgerDb();

  if (db) {
    const fromIdb = await new Promise<SnapshotRecord<T> | undefined>((resolve) => {
      try {
        const tx = db.transaction(STORE_SNAPSHOTS, 'readonly');
        const req = tx.objectStore(STORE_SNAPSHOTS).get(key);
        req.onsuccess = () => {
          db.close();
          resolve(req.result as SnapshotRecord<T> | undefined);
        };
        req.onerror = () => {
          db.close();
          resolve(undefined);
        };
      } catch {
        db.close();
        resolve(undefined);
      }
    });

    if (fromIdb) {
      memorySnapshots.set(key, fromIdb);
      return { data: fromIdb.data, updatedAt: fromIdb.updatedAt };
    }
  }

  const mem = memorySnapshots.get(key) as SnapshotRecord<T> | undefined;
  return mem ? { data: mem.data, updatedAt: mem.updatedAt } : null;
}

export async function enqueueOutboxItem(item: OutboxItem): Promise<void> {
  memoryOutbox.set(item.id, item);

  const db = await openLedgerDb();
  if (!db) return;

  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE_OUTBOX, 'readwrite');
      tx.objectStore(STORE_OUTBOX).put(item);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        resolve();
      };
    } catch {
      db.close();
      resolve();
    }
  });
}

export async function listTenantOutbox(tenantId: string): Promise<OutboxItem[]> {
  const db = await openLedgerDb();

  if (db) {
    const items = await new Promise<OutboxItem[] | null>((resolve) => {
      try {
        const tx = db.transaction(STORE_OUTBOX, 'readonly');
        const index = tx.objectStore(STORE_OUTBOX).index('by_tenant');
        const req = index.getAll(IDBKeyRange.only(tenantId));
        req.onsuccess = () => {
          db.close();
          resolve((req.result as OutboxItem[]) ?? []);
        };
        req.onerror = () => {
          db.close();
          resolve(null);
        };
      } catch {
        db.close();
        resolve(null);
      }
    });

    if (items) {
      for (const it of items) {
        memoryOutbox.set(it.id, it);
      }
      return items.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    }
  }

  return Array.from(memoryOutbox.values())
    .filter((it) => it.tenantId === tenantId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function updateOutboxItem(
  id: string,
  patch: Partial<Pick<OutboxItem, 'status' | 'errorMessage'>>,
): Promise<void> {
  const existingMem = memoryOutbox.get(id);
  if (existingMem) {
    memoryOutbox.set(id, { ...existingMem, ...patch });
  }

  const db = await openLedgerDb();
  if (!db) return;

  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE_OUTBOX, 'readwrite');
      const store = tx.objectStore(STORE_OUTBOX);
      const getReq = store.get(id);
      getReq.onsuccess = () => {
        const current = getReq.result as OutboxItem | undefined;
        if (current) {
          store.put({ ...current, ...patch });
        }
      };
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        resolve();
      };
    } catch {
      db.close();
      resolve();
    }
  });
}

export async function removeOutboxItem(id: string): Promise<void> {
  memoryOutbox.delete(id);

  const db = await openLedgerDb();
  if (!db) return;

  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE_OUTBOX, 'readwrite');
      tx.objectStore(STORE_OUTBOX).delete(id);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        resolve();
      };
    } catch {
      db.close();
      resolve();
    }
  });
}

/**
 * Optimistically updates local IndexedDB snapshots when a POS sale is completed offline.
 * 1. Decrements stock on sold products in `pos-products`
 * 2. If `dueAmount > 0`, adds a customer receivable to `dues-list` and updates `dues-summary`
 */
export async function applyOfflinePosSaleToSnapshots(
  tenantId: string,
  cartLines: Array<{ product: CachedProductItem; qty: number }>,
  offlineSale: CachedCompletedSale,
): Promise<{
  updatedProducts: CachedProductItem[];
  updatedDuesList: CachedUnifiedDueItem[] | null;
  updatedDuesSummary: CachedDuesSummary | null;
}> {
  const prodSnap = await getTenantSnapshot<CachedProductItem[]>(tenantId, 'pos-products');
  const currentProducts = prodSnap?.data ?? cartLines.map((c) => c.product);

  const qtyByProductId = new Map<string, number>();
  for (const line of cartLines) {
    qtyByProductId.set(
      line.product._id,
      (qtyByProductId.get(line.product._id) ?? 0) + line.qty,
    );
  }

  const updatedProducts = currentProducts.map((p) => {
    const soldQty = qtyByProductId.get(p._id);
    if (!soldQty) return p;
    return {
      ...p,
      stock: Math.max(0, p.stock - soldQty),
    };
  });

  await saveTenantSnapshot(tenantId, 'pos-products', updatedProducts);

  let updatedDuesList: CachedUnifiedDueItem[] | null = null;
  let updatedDuesSummary: CachedDuesSummary | null = null;

  if (offlineSale.dueAmount > 0) {
    const duesSnap = await getTenantSnapshot<CachedUnifiedDueItem[]>(tenantId, 'dues-list');
    const summarySnap = await getTenantSnapshot<CachedDuesSummary>(tenantId, 'dues-summary');

    const newDueEntry: CachedUnifiedDueItem = {
      refId: offlineSale._id,
      refNo: offlineSale.invoiceNo,
      partyType: 'customer',
      partyName: offlineSale.customerName || 'Walk-in Customer',
      partyPhone: offlineSale.customerPhone || '',
      totalAmount: offlineSale.total,
      paidAmount: offlineSale.paidAmount,
      dueAmount: offlineSale.dueAmount,
      ageDays: 0,
      ageingBucket: '0-7',
      createdAt: offlineSale.createdAt,
      isOfflineQueued: true,
    };

    updatedDuesList = [newDueEntry, ...(duesSnap?.data ?? [])];
    await saveTenantSnapshot(tenantId, 'dues-list', updatedDuesList);

    if (summarySnap?.data) {
      const s = summarySnap.data;
      const nextReceivable = Number((s.totalReceivable + offlineSale.dueAmount).toFixed(2));
      updatedDuesSummary = {
        ...s,
        totalReceivable: nextReceivable,
        netPosition: Number((nextReceivable - s.totalPayable).toFixed(2)),
        customerCount: s.customerCount + 1,
        buckets: {
          ...s.buckets,
          '0-7': {
            ...s.buckets['0-7'],
            receivable: Number(
              (s.buckets['0-7'].receivable + offlineSale.dueAmount).toFixed(2),
            ),
            count: s.buckets['0-7'].count + 1,
          },
        },
      };
      await saveTenantSnapshot(tenantId, 'dues-summary', updatedDuesSummary);
    }
  }

  return {
    updatedProducts,
    updatedDuesList,
    updatedDuesSummary,
  };
}

/**
 * Optimistically updates local IndexedDB snapshots when a Baki due payment is recorded offline.
 */
export async function applyOfflineDuePaymentToSnapshots(
  tenantId: string,
  targetDue: CachedUnifiedDueItem,
  rawPaymentAmount: number,
): Promise<{
  appliedAmount: number;
  updatedDuesList: CachedUnifiedDueItem[];
  updatedDuesSummary: CachedDuesSummary | null;
}> {
  const appliedAmount = Number(
    Math.min(Math.max(0, rawPaymentAmount), targetDue.dueAmount).toFixed(2),
  );

  const duesSnap = await getTenantSnapshot<CachedUnifiedDueItem[]>(tenantId, 'dues-list');
  const currentList = duesSnap?.data ?? [targetDue];

  const updatedDuesList: CachedUnifiedDueItem[] = [];
  let wasFullySettled = false;

  for (const item of currentList) {
    if (item.refId !== targetDue.refId) {
      updatedDuesList.push(item);
      continue;
    }
    const nextDue = Number(Math.max(0, item.dueAmount - appliedAmount).toFixed(2));
    const nextPaid = Number((item.paidAmount + appliedAmount).toFixed(2));
    if (nextDue <= 0) {
      wasFullySettled = true;
    } else {
      updatedDuesList.push({
        ...item,
        paidAmount: nextPaid,
        dueAmount: nextDue,
        isOfflineQueued: true,
      });
    }
  }

  await saveTenantSnapshot(tenantId, 'dues-list', updatedDuesList);

  const summarySnap = await getTenantSnapshot<CachedDuesSummary>(tenantId, 'dues-summary');
  let updatedDuesSummary: CachedDuesSummary | null = null;

  if (summarySnap?.data) {
    const s = summarySnap.data;
    const bucketKey = targetDue.ageingBucket;
    const currentBucket = s.buckets[bucketKey];

    if (targetDue.partyType === 'customer') {
      const nextReceivable = Number(Math.max(0, s.totalReceivable - appliedAmount).toFixed(2));
      updatedDuesSummary = {
        ...s,
        totalReceivable: nextReceivable,
        netPosition: Number((nextReceivable - s.totalPayable).toFixed(2)),
        customerCount: wasFullySettled ? Math.max(0, s.customerCount - 1) : s.customerCount,
        buckets: {
          ...s.buckets,
          [bucketKey]: {
            ...currentBucket,
            receivable: Number(Math.max(0, currentBucket.receivable - appliedAmount).toFixed(2)),
            count: wasFullySettled ? Math.max(0, currentBucket.count - 1) : currentBucket.count,
          },
        },
      };
    } else {
      const nextPayable = Number(Math.max(0, s.totalPayable - appliedAmount).toFixed(2));
      updatedDuesSummary = {
        ...s,
        totalPayable: nextPayable,
        netPosition: Number((s.totalReceivable - nextPayable).toFixed(2)),
        supplierCount: wasFullySettled ? Math.max(0, s.supplierCount - 1) : s.supplierCount,
        buckets: {
          ...s.buckets,
          [bucketKey]: {
            ...currentBucket,
            payable: Number(Math.max(0, currentBucket.payable - appliedAmount).toFixed(2)),
            count: wasFullySettled ? Math.max(0, currentBucket.count - 1) : currentBucket.count,
          },
        },
      };
    }

    await saveTenantSnapshot(tenantId, 'dues-summary', updatedDuesSummary);
  }

  return {
    appliedAmount,
    updatedDuesList,
    updatedDuesSummary,
  };
}
