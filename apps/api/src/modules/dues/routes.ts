import { Router } from 'express';
import mongoose, { Types } from 'mongoose';
import { recordDuePaymentSchema } from '@dokanos/shared';
import {
  DuePaymentModel,
  PurchaseModel,
  SaleModel,
  SupplierModel,
} from '../../models/index.js';
import { requireAuth } from '../../middleware/auth.js';
import { requireTenant } from '../../middleware/tenant.js';
import { requirePermission } from '../../middleware/rbac.js';
import { AppError } from '../../utils/errors.js';
import { toObjectIdParam } from '../../utils/pagination.js';
import { invalidateTenantCache } from '../../config/redis.js';

export type AgeingBucket = '0-7' | '8-30' | '30+';

export interface UnifiedDueEntry {
  refId: string;
  refNo: string;
  partyType: 'customer' | 'supplier';
  partyName: string;
  partyPhone: string;
  totalAmount: number;
  paidAmount: number;
  dueAmount: number;
  ageDays: number;
  ageingBucket: AgeingBucket;
  createdAt: Date;
}

function computeAgeing(createdAt: Date): { ageDays: number; ageingBucket: AgeingBucket } {
  const diffMs = Math.max(0, Date.now() - new Date(createdAt).getTime());
  const ageDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  let ageingBucket: AgeingBucket = '0-7';
  if (ageDays > 30) {
    ageingBucket = '30+';
  } else if (ageDays >= 8) {
    ageingBucket = '8-30';
  }
  return { ageDays, ageingBucket };
}

async function getUnifiedDuesForTenant(tenantId: string): Promise<UnifiedDueEntry[]> {
  const tenantObjectId = new Types.ObjectId(tenantId);

  const [customerSales, supplierPurchases] = await Promise.all([
    SaleModel.find({
      tenantId: tenantObjectId,
      dueAmount: { $gt: 0 },
      isReturned: false,
    })
      .sort({ createdAt: -1 })
      .lean(),
    PurchaseModel.find({
      tenantId: tenantObjectId,
      dueAmount: { $gt: 0 },
    })
      .populate('supplierId', 'name phone')
      .sort({ createdAt: -1 })
      .lean(),
  ]);

  const entries: UnifiedDueEntry[] = [];

  for (const sale of customerSales) {
    const { ageDays, ageingBucket } = computeAgeing(sale.createdAt);
    entries.push({
      refId: sale._id.toString(),
      refNo: sale.invoiceNo,
      partyType: 'customer',
      partyName: sale.customerName || 'Walk-in Customer',
      partyPhone: sale.customerPhone || '',
      totalAmount: sale.total,
      paidAmount: sale.paidAmount,
      dueAmount: sale.dueAmount,
      ageDays,
      ageingBucket,
      createdAt: sale.createdAt,
    });
  }

  for (const purchase of supplierPurchases) {
    const { ageDays, ageingBucket } = computeAgeing(purchase.createdAt);
    const popSupplier = purchase.supplierId as unknown as {
      _id?: Types.ObjectId;
      name?: string;
      phone?: string;
    } | null;

    entries.push({
      refId: purchase._id.toString(),
      refNo: `PO-${purchase._id.toString().slice(-6).toUpperCase()}`,
      partyType: 'supplier',
      partyName: popSupplier?.name ?? 'Supplier',
      partyPhone: popSupplier?.phone ?? '',
      totalAmount: purchase.total,
      paidAmount: purchase.paidAmount,
      dueAmount: purchase.dueAmount,
      ageDays,
      ageingBucket,
      createdAt: purchase.createdAt,
    });
  }

  entries.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return entries;
}

export const duesRouter = Router();

duesRouter.use(requireAuth, requireTenant);

// GET /api/v1/dues
duesRouter.get('/', requirePermission('dues:read'), async (req, res, next) => {
  try {
    let entries = await getUnifiedDuesForTenant(req.tenant!.id);

    const partyType = typeof req.query.partyType === 'string' ? req.query.partyType : '';
    if (partyType === 'customer' || partyType === 'supplier') {
      entries = entries.filter((e) => e.partyType === partyType);
    }

    const bucket = typeof req.query.bucket === 'string' ? req.query.bucket : '';
    if (bucket === '0-7' || bucket === '8-30' || bucket === '30+') {
      entries = entries.filter((e) => e.ageingBucket === bucket);
    }

    const search = typeof req.query.search === 'string' ? req.query.search.trim().toLowerCase() : '';
    if (search) {
      entries = entries.filter(
        (e) =>
          e.partyName.toLowerCase().includes(search) ||
          e.partyPhone.toLowerCase().includes(search) ||
          e.refNo.toLowerCase().includes(search),
      );
    }

    const recentPayments = await DuePaymentModel.find({
      tenantId: new Types.ObjectId(req.tenant!.id),
    })
      .sort({ createdAt: -1 })
      .limit(20)
      .lean();

    res.status(200).json({
      data: entries,
      recentPayments,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/dues/summary
duesRouter.get('/summary', requirePermission('dues:read'), async (req, res, next) => {
  try {
    const entries = await getUnifiedDuesForTenant(req.tenant!.id);

    let totalReceivable = 0;
    let totalPayable = 0;
    let customerCount = 0;
    let supplierCount = 0;

    const buckets: Record<
      AgeingBucket,
      { receivable: number; payable: number; count: number }
    > = {
      '0-7': { receivable: 0, payable: 0, count: 0 },
      '8-30': { receivable: 0, payable: 0, count: 0 },
      '30+': { receivable: 0, payable: 0, count: 0 },
    };

    for (const entry of entries) {
      const b = buckets[entry.ageingBucket];
      b.count += 1;
      if (entry.partyType === 'customer') {
        totalReceivable = Number((totalReceivable + entry.dueAmount).toFixed(2));
        b.receivable = Number((b.receivable + entry.dueAmount).toFixed(2));
        customerCount += 1;
      } else {
        totalPayable = Number((totalPayable + entry.dueAmount).toFixed(2));
        b.payable = Number((b.payable + entry.dueAmount).toFixed(2));
        supplierCount += 1;
      }
    }

    res.status(200).json({
      data: {
        totalReceivable,
        totalPayable,
        netPosition: Number((totalReceivable - totalPayable).toFixed(2)),
        customerCount,
        supplierCount,
        buckets,
      },
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/dues/:refId/payments — record customer or supplier due payment in a transaction
duesRouter.post('/:refId/payments', requirePermission('dues:write'), async (req, res, next) => {
  const session = await mongoose.startSession();
  try {
    const refObjectId = toObjectIdParam(req.params.refId, 'Due reference not found');
    const parsed = recordDuePaymentSchema.parse(req.body);
    const tenantObjectId = new Types.ObjectId(req.tenant!.id);
    const userObjectId = new Types.ObjectId(req.user!.id);

    const headerKey =
      typeof req.headers['x-idempotency-key'] === 'string'
        ? req.headers['x-idempotency-key'].trim()
        : undefined;
    const idempotencyKey = parsed.idempotencyKey || headerKey;

    if (idempotencyKey) {
      const existingPayment = await DuePaymentModel.findOne({
        tenantId: tenantObjectId,
        idempotencyKey,
      }).lean();
      if (existingPayment) {
        res.status(200).json({ data: existingPayment, duplicate: true });
        return;
      }
    }

    let createdPayment: Awaited<ReturnType<typeof DuePaymentModel.findOne>> = null;

    await session.withTransaction(async () => {
      const sale = await SaleModel.findOne({
        _id: refObjectId,
        tenantId: tenantObjectId,
      }).session(session);

      if (sale) {
        if (sale.dueAmount <= 0) {
          throw AppError.badRequest('This sale has no remaining due balance');
        }
        const applied = Math.min(parsed.amount, sale.dueAmount);
        sale.paidAmount = Number((sale.paidAmount + applied).toFixed(2));
        sale.dueAmount = Number((sale.dueAmount - applied).toFixed(2));
        sale.paymentStatus = sale.dueAmount === 0 ? 'paid' : 'partial';
        await sale.save({ session });

        const [doc] = await DuePaymentModel.create(
          [
            {
              tenantId: tenantObjectId,
              ...(idempotencyKey ? { idempotencyKey } : {}),
              partyType: 'customer',
              partyName: sale.customerName || 'Walk-in Customer',
              partyPhone: sale.customerPhone || '',
              refId: sale._id,
              amount: applied,
              method: parsed.method,
              receivedBy: userObjectId,
            },
          ],
          { session },
        );
        createdPayment = doc ?? null;
        return;
      }

      const purchase = await PurchaseModel.findOne({
        _id: refObjectId,
        tenantId: tenantObjectId,
      }).session(session);

      if (purchase) {
        if (purchase.dueAmount <= 0) {
          throw AppError.badRequest('This purchase has no remaining due balance');
        }
        const applied = Math.min(parsed.amount, purchase.dueAmount);
        purchase.paidAmount = Number((purchase.paidAmount + applied).toFixed(2));
        purchase.dueAmount = Number((purchase.dueAmount - applied).toFixed(2));
        purchase.status = purchase.dueAmount === 0 ? 'received' : 'partial';
        await purchase.save({ session });

        const supplier = await SupplierModel.findOne({
          _id: purchase.supplierId,
          tenantId: tenantObjectId,
        }).session(session);

        if (supplier) {
          supplier.totalDue = Number(Math.max(0, supplier.totalDue - applied).toFixed(2));
          await supplier.save({ session });
        }

        const [doc] = await DuePaymentModel.create(
          [
            {
              tenantId: tenantObjectId,
              ...(idempotencyKey ? { idempotencyKey } : {}),
              partyType: 'supplier',
              partyName: supplier?.name ?? 'Supplier',
              partyPhone: supplier?.phone ?? '',
              refId: purchase._id,
              amount: applied,
              method: parsed.method,
              receivedBy: userObjectId,
            },
          ],
          { session },
        );
        createdPayment = doc ?? null;
        return;
      }

      throw AppError.notFound('Due record not found for this shop');
    });

    await invalidateTenantCache(req.tenant!.id);
    res.status(201).json({ data: createdPayment });
  } catch (err) {
    next(err);
  } finally {
    await session.endSession();
  }
});
