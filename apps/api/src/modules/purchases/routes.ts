import { Router } from 'express';
import mongoose, { Types } from 'mongoose';
import {
  createPurchaseSchema,
  recordDuePaymentSchema,
  type PurchaseStatus,
} from '@dokanos/shared';
import {
  DuePaymentModel,
  ProductModel,
  PurchaseModel,
  StockMovementModel,
  SupplierModel,
  type IPurchaseItem,
} from '../../models/index.js';
import { requireAuth } from '../../middleware/auth.js';
import { requireTenant } from '../../middleware/tenant.js';
import { requirePermission } from '../../middleware/rbac.js';
import { AppError } from '../../utils/errors.js';
import { buildPaginationMeta, parsePagination, toObjectIdParam } from '../../utils/pagination.js';
import { invalidateTenantCache } from '../../config/redis.js';

export const purchasesRouter = Router();

purchasesRouter.use(requireAuth, requireTenant);

// GET /api/v1/purchases
purchasesRouter.get('/', requirePermission('purchases:read'), async (req, res, next) => {
  try {
    const { page, limit, skip } = parsePagination(req.query as Record<string, unknown>);
    const tenantObjectId = new Types.ObjectId(req.tenant!.id);

    const filter: Record<string, unknown> = {
      tenantId: tenantObjectId,
    };

    if (typeof req.query.supplierId === 'string' && Types.ObjectId.isValid(req.query.supplierId)) {
      filter.supplierId = new Types.ObjectId(req.query.supplierId);
    }

    const [purchases, total] = await Promise.all([
      PurchaseModel.find(filter)
        .populate('supplierId', 'name phone')
        .populate('createdBy', 'name')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      PurchaseModel.countDocuments(filter),
    ]);

    res.status(200).json({
      data: purchases,
      meta: buildPaginationMeta(page, limit, total),
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/purchases — receive purchase, increase stock, write movements, update supplier due
purchasesRouter.post('/', requirePermission('purchases:write'), async (req, res, next) => {
  const session = await mongoose.startSession();
  try {
    const parsed = createPurchaseSchema.parse(req.body);
    const tenantObjectId = new Types.ObjectId(req.tenant!.id);
    const userObjectId = new Types.ObjectId(req.user!.id);
    const supplierObjectId = new Types.ObjectId(parsed.supplierId);

    let createdPurchaseId: Types.ObjectId | null = null;

    await session.withTransaction(async () => {
      const supplier = await SupplierModel.findOne({
        _id: supplierObjectId,
        tenantId: tenantObjectId,
      }).session(session);

      if (!supplier) {
        throw AppError.notFound('Supplier not found');
      }

      const purchaseItems: IPurchaseItem[] = [];
      const purchaseId = new Types.ObjectId();

      for (const item of parsed.items) {
        const product = await ProductModel.findOneAndUpdate(
          {
            _id: new Types.ObjectId(item.productId),
            tenantId: tenantObjectId,
          },
          {
            $inc: { stock: item.qty },
            $set: { costPrice: item.costPrice },
          },
          { session, new: true },
        );

        if (!product) {
          throw AppError.notFound(`Product ${item.productId} not found`);
        }

        const lineTotal = Number((item.qty * item.costPrice).toFixed(2));
        purchaseItems.push({
          productId: product._id,
          name: product.name,
          qty: item.qty,
          costPrice: item.costPrice,
          lineTotal,
        });

        await StockMovementModel.create(
          [
            {
              tenantId: tenantObjectId,
              productId: product._id,
              type: 'purchase',
              qtyChange: item.qty,
              balanceAfter: product.stock,
              refId: purchaseId,
              refType: 'Purchase',
              userId: userObjectId,
              note: `Purchase from ${supplier.name}`,
            },
          ],
          { session },
        );
      }

      const total = Number(
        purchaseItems.reduce((sum, it) => sum + it.lineTotal, 0).toFixed(2),
      );
      const paidAmount = Number(Math.min(parsed.paidAmount, total).toFixed(2));
      const dueAmount = Number(Math.max(0, total - paidAmount).toFixed(2));

      let status: PurchaseStatus = 'received';
      if (dueAmount > 0 && paidAmount > 0) {
        status = 'partial';
      }

      await PurchaseModel.create(
        [
          {
            _id: purchaseId,
            tenantId: tenantObjectId,
            supplierId: supplier._id,
            items: purchaseItems,
            total,
            paidAmount,
            dueAmount,
            status,
            receivedAt: new Date(),
            createdBy: userObjectId,
          },
        ],
        { session },
      );

      if (dueAmount > 0) {
        supplier.totalDue = Number((supplier.totalDue + dueAmount).toFixed(2));
        await supplier.save({ session });
      }

      createdPurchaseId = purchaseId;
    });

    await invalidateTenantCache(req.tenant!.id);

    const purchase = await PurchaseModel.findById(createdPurchaseId)
      .populate('supplierId', 'name phone')
      .lean();

    res.status(201).json({ data: purchase });
  } catch (err) {
    next(err);
  } finally {
    await session.endSession();
  }
});

// GET /api/v1/purchases/:id
purchasesRouter.get('/:id', requirePermission('purchases:read'), async (req, res, next) => {
  try {
    const purchaseObjectId = toObjectIdParam(req.params.id, 'Purchase not found');
    const purchase = await PurchaseModel.findOne({
      _id: purchaseObjectId,
      tenantId: new Types.ObjectId(req.tenant!.id),
    })
      .populate('supplierId', 'name phone address')
      .populate('createdBy', 'name')
      .lean();

    if (!purchase) {
      throw AppError.notFound('Purchase not found');
    }
    res.status(200).json({ data: purchase });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/v1/purchases/:id/pay
purchasesRouter.patch('/:id/pay', requirePermission('purchases:write'), async (req, res, next) => {
  const session = await mongoose.startSession();
  try {
    const purchaseObjectId = toObjectIdParam(req.params.id, 'Purchase not found');
    const parsed = recordDuePaymentSchema.parse(req.body);
    const tenantObjectId = new Types.ObjectId(req.tenant!.id);

    await session.withTransaction(async () => {
      const purchase = await PurchaseModel.findOne({
        _id: purchaseObjectId,
        tenantId: tenantObjectId,
      }).session(session);

      if (!purchase) {
        throw AppError.notFound('Purchase not found');
      }
      if (purchase.dueAmount <= 0) {
        throw AppError.badRequest('This purchase has no outstanding due');
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

      await DuePaymentModel.create(
        [
          {
            tenantId: tenantObjectId,
            partyType: 'supplier',
            partyName: supplier?.name ?? 'Supplier',
            partyPhone: supplier?.phone ?? '',
            refId: purchase._id,
            amount: applied,
            method: parsed.method,
            receivedBy: new Types.ObjectId(req.user!.id),
          },
        ],
        { session },
      );
    });

    await invalidateTenantCache(req.tenant!.id);

    const updated = await PurchaseModel.findById(purchaseObjectId)
      .populate('supplierId', 'name phone')
      .lean();
    res.status(200).json({ data: updated });
  } catch (err) {
    next(err);
  } finally {
    await session.endSession();
  }
});
