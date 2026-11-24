import { Router } from 'express';
import mongoose, { Types } from 'mongoose';
import { createSaleSchema, returnSaleSchema, type PaymentStatus } from '@dokanos/shared';
import {
  CustomerModel,
  NotificationModel,
  ProductModel,
  SaleModel,
  StockMovementModel,
  TenantModel,
  type ISaleItem,
} from '../../models/index.js';
import { requireAuth } from '../../middleware/auth.js';
import { requireTenant } from '../../middleware/tenant.js';
import { requirePermission } from '../../middleware/rbac.js';
import { AppError } from '../../utils/errors.js';
import {
  buildPaginationMeta,
  escapeRegex,
  parsePagination,
  toObjectIdParam,
} from '../../utils/pagination.js';
import { invalidateTenantCache } from '../../config/redis.js';
import { emitToTenant } from '../../realtime/socket.js';
import { recordAuditLog } from '../../utils/audit.js';

export const salesRouter = Router();

salesRouter.use(requireAuth, requireTenant);

// POST /api/v1/sales — Atomic POS sale in a Mongoose transaction
salesRouter.post('/', requirePermission('sales:write'), async (req, res, next) => {
  const session = await mongoose.startSession();
  try {
    const parsed = createSaleSchema.parse(req.body);
    const tenantObjectId = new Types.ObjectId(req.tenant!.id);
    const soldByObjectId = new Types.ObjectId(req.user!.id);

    const headerKey =
      typeof req.headers['x-idempotency-key'] === 'string'
        ? req.headers['x-idempotency-key'].trim()
        : undefined;
    const idempotencyKey = parsed.idempotencyKey || headerKey;

    if (idempotencyKey) {
      const existingSale = await SaleModel.findOne({
        tenantId: tenantObjectId,
        idempotencyKey,
      })
        .populate('soldBy', 'name role')
        .lean();
      if (existingSale) {
        res.status(200).json({ data: existingSale, duplicate: true });
        return;
      }
    }

    let createdSaleId: Types.ObjectId | null = null;
    const lowStockAlerts: Array<{ productId: string; name: string; stock: number }> = [];

    // Retry loop for transient write conflicts when concurrent sales touch the same product/tenant
    let attempts = 0;
    const maxAttempts = 3;

    while (attempts < maxAttempts) {
      attempts += 1;
      lowStockAlerts.length = 0;

      try {
        session.startTransaction();

        const saleItems: ISaleItem[] = [];
        const movementsToInsert: Array<{
          tenantId: Types.ObjectId;
          productId: Types.ObjectId;
          type: 'sale';
          qtyChange: number;
          balanceAfter: number;
          userId: Types.ObjectId;
          note: string;
        }> = [];

        for (const item of parsed.items) {
          if (!Types.ObjectId.isValid(item.productId)) {
            throw AppError.badRequest(`Invalid product ID: ${item.productId}`);
          }
          const productObjectId = new Types.ObjectId(item.productId);

          // Atomic decrement with $gte guard per §5
          const updatedProduct = await ProductModel.findOneAndUpdate(
            {
              _id: productObjectId,
              tenantId: tenantObjectId,
              isActive: true,
              stock: { $gte: item.qty },
            },
            {
              $inc: { stock: -item.qty },
            },
            { session, new: true },
          );

          if (!updatedProduct) {
            const existing = await ProductModel.findOne({
              _id: productObjectId,
              tenantId: tenantObjectId,
            })
              .session(session)
              .lean();

            const productName = existing?.name ?? item.productId;
            throw AppError.insufficientStock(
              `Insufficient stock for product '${productName}' (requested ${item.qty}, available ${existing?.stock ?? 0})`,
            );
          }

          const lineTotal = Number((updatedProduct.sellPrice * item.qty).toFixed(2));
          saleItems.push({
            productId: updatedProduct._id,
            name: updatedProduct.name,
            qty: item.qty,
            price: updatedProduct.sellPrice,
            costPrice: updatedProduct.costPrice,
            lineTotal,
            returnedQty: 0,
          });

          movementsToInsert.push({
            tenantId: tenantObjectId,
            productId: updatedProduct._id,
            type: 'sale',
            qtyChange: -item.qty,
            balanceAfter: updatedProduct.stock,
            userId: soldByObjectId,
            note: 'POS Sale',
          });

          if (updatedProduct.stock <= updatedProduct.lowStockAt) {
            lowStockAlerts.push({
              productId: updatedProduct._id.toString(),
              name: updatedProduct.name,
              stock: updatedProduct.stock,
            });
          }
        }

        const subtotal = Number(saleItems.reduce((acc, it) => acc + it.lineTotal, 0).toFixed(2));
        const discount = Math.min(parsed.discount, subtotal);
        const total = Number(Math.max(0, subtotal - discount).toFixed(2));
        const paidAmount = Number(Math.min(parsed.paidAmount, total).toFixed(2));
        const dueAmount = Number(Math.max(0, total - paidAmount).toFixed(2));

        if (dueAmount > 0) {
          if (
            !parsed.customerName ||
            parsed.customerName.trim() === '' ||
            parsed.customerName.trim().toLowerCase() === 'walk-in customer'
          ) {
            throw AppError.badRequest('Customer name is required for Baki (credit) sales');
          }
        }

        let paymentStatus: PaymentStatus = 'paid';
        if (dueAmount > 0 && paidAmount === 0) {
          paymentStatus = 'due';
        } else if (dueAmount > 0 && paidAmount > 0) {
          paymentStatus = 'partial';
        }

        let linkedCustomerId: Types.ObjectId | null = null;
        if (parsed.customerId && Types.ObjectId.isValid(parsed.customerId)) {
          const existingCust = await CustomerModel.findOne({
            _id: new Types.ObjectId(parsed.customerId),
            tenantId: tenantObjectId,
          }).session(session);
          if (existingCust) {
            existingCust.totalSpent = Number((existingCust.totalSpent + total).toFixed(2));
            existingCust.balanceDue = Number((existingCust.balanceDue + dueAmount).toFixed(2));
            await existingCust.save({ session });
            linkedCustomerId = existingCust._id;
          }
        } else if (
          parsed.customerName &&
          parsed.customerName.trim() !== '' &&
          parsed.customerName.trim().toLowerCase() !== 'walk-in customer'
        ) {
          const cleanPhone = parsed.customerPhone?.trim() || '';
          let cust = cleanPhone
            ? await CustomerModel.findOne({
                tenantId: tenantObjectId,
                phone: cleanPhone,
              }).session(session)
            : null;

          if (!cust) {
            const fallbackPhone =
              cleanPhone || `walkin-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
            const createdCusts = await CustomerModel.create(
              [
                {
                  tenantId: tenantObjectId,
                  name: parsed.customerName.trim(),
                  phone: fallbackPhone,
                  balanceDue: dueAmount,
                  totalSpent: total,
                },
              ],
              { session },
            );
            cust = createdCusts[0]!;
          } else {
            cust.totalSpent = Number((cust.totalSpent + total).toFixed(2));
            cust.balanceDue = Number((cust.balanceDue + dueAmount).toFixed(2));
            await cust.save({ session });
          }
          linkedCustomerId = cust._id;
        }

        // Generate sequential invoiceNo per shop (INV-0001...)
        const updatedTenant = await TenantModel.findOneAndUpdate(
          { _id: tenantObjectId },
          { $inc: { invoiceCounter: 1 } },
          { session, new: true },
        );

        const nextSeq = updatedTenant?.invoiceCounter ?? Date.now();
        const invoiceNo = `INV-${String(nextSeq).padStart(4, '0')}`;

        const saleId = new Types.ObjectId();
        await SaleModel.create(
          [
            {
              _id: saleId,
              tenantId: tenantObjectId,
              invoiceNo,
              ...(idempotencyKey ? { idempotencyKey } : {}),
              items: saleItems,
              subtotal,
              discount,
              total,
              paymentMethod: parsed.paymentMethod,
              paymentStatus,
              paidAmount,
              dueAmount,
              customerName: parsed.customerName || 'Walk-in Customer',
              customerPhone: parsed.customerPhone || '',
              customerId: linkedCustomerId,
              soldBy: soldByObjectId,
              isReturned: false,
            },
          ],
          { session },
        );

        await StockMovementModel.insertMany(
          movementsToInsert.map((m) => ({
            ...m,
            refId: saleId,
            refType: 'Sale' as const,
            note: `POS Sale ${invoiceNo}`,
          })),
          { session },
        );

        createdSaleId = saleId;
        await session.commitTransaction();
        break;
      } catch (txErr) {
        if (session.inTransaction()) {
          await session.abortTransaction();
        }
        const isTransientWriteConflict =
          txErr instanceof Error &&
          'hasErrorLabel' in txErr &&
          typeof (txErr as { hasErrorLabel?: (label: string) => boolean }).hasErrorLabel ===
            'function' &&
          (txErr as { hasErrorLabel: (label: string) => boolean }).hasErrorLabel(
            'TransientTransactionError',
          );

        if (isTransientWriteConflict && attempts < maxAttempts) {
          continue;
        }
        throw txErr;
      }
    }

    const sale = await SaleModel.findById(createdSaleId).populate('soldBy', 'name role').lean();

    await invalidateTenantCache(req.tenant!.id);

    if (sale) {
      emitToTenant(req.tenant!.id, 'sale:created', {
        _id: sale._id.toString(),
        invoiceNo: sale.invoiceNo,
        total: sale.total,
        paymentMethod: sale.paymentMethod,
        paymentStatus: sale.paymentStatus,
        customerName: sale.customerName,
        createdAt: sale.createdAt,
      });

      await recordAuditLog({
        tenantId: req.tenant!.id,
        userId: req.user!.id,
        action: 'sale.created',
        entity: 'Sale',
        entityId: sale._id.toString(),
        changes: { invoiceNo: sale.invoiceNo, total: sale.total },
      });
    }

    for (const alert of lowStockAlerts) {
      const notification = await NotificationModel.create({
        tenantId: tenantObjectId,
        userId: null,
        type: 'low_stock',
        title: `Low Stock Alert: ${alert.name}`,
        body: `${alert.name} is down to ${alert.stock} units in stock. Reorder soon.`,
        link: `/app/products/${alert.productId}`,
        isRead: false,
      });

      emitToTenant(req.tenant!.id, 'stock:low', alert);
      emitToTenant(req.tenant!.id, 'notification:new', notification);
    }

    res.status(201).json({ data: sale });
  } catch (err) {
    next(err);
  } finally {
    await session.endSession();
  }
});

// GET /api/v1/sales
salesRouter.get('/', requirePermission('sales:read'), async (req, res, next) => {
  try {
    const { page, limit, skip } = parsePagination(req.query as Record<string, unknown>);
    const tenantObjectId = new Types.ObjectId(req.tenant!.id);

    const filter: Record<string, unknown> = {
      tenantId: tenantObjectId,
    };

    if (
      typeof req.query.paymentStatus === 'string' &&
      ['paid', 'partial', 'due'].includes(req.query.paymentStatus)
    ) {
      filter.paymentStatus = req.query.paymentStatus;
    }

    if (typeof req.query.soldBy === 'string' && Types.ObjectId.isValid(req.query.soldBy)) {
      filter.soldBy = new Types.ObjectId(req.query.soldBy);
    }

    if (typeof req.query.search === 'string' && req.query.search.trim()) {
      const q = req.query.search.trim();
      const escaped = escapeRegex(q);
      filter.$or = [
        { invoiceNo: { $regex: escaped, $options: 'i' } },
        { customerName: { $regex: escaped, $options: 'i' } },
        { customerPhone: { $regex: escaped, $options: 'i' } },
      ];
    }

    if (typeof req.query.from === 'string' || typeof req.query.to === 'string') {
      const dateRange: Record<string, Date> = {};
      if (typeof req.query.from === 'string' && req.query.from) {
        dateRange.$gte = new Date(req.query.from);
      }
      if (typeof req.query.to === 'string' && req.query.to) {
        dateRange.$lte = new Date(req.query.to);
      }
      filter.createdAt = dateRange;
    }

    const [sales, total] = await Promise.all([
      SaleModel.find(filter)
        .populate('soldBy', 'name role')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      SaleModel.countDocuments(filter),
    ]);

    res.status(200).json({
      data: sales,
      meta: buildPaginationMeta(page, limit, total),
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/sales/:id
salesRouter.get('/:id', requirePermission('sales:read'), async (req, res, next) => {
  try {
    const saleObjectId = toObjectIdParam(req.params.id, 'Sale not found');
    const sale = await SaleModel.findOne({
      _id: saleObjectId,
      tenantId: new Types.ObjectId(req.tenant!.id),
    })
      .populate('soldBy', 'name email role')
      .lean();

    if (!sale) {
      throw AppError.notFound('Sale not found');
    }

    res.status(200).json({ data: sale });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/sales/:id/return (owner/manager: partial restock + return ledger entry)
salesRouter.post('/:id/return', requirePermission('sales:return'), async (req, res, next) => {
  const session = await mongoose.startSession();
  try {
    const parsed = returnSaleSchema.parse(req.body);
    const saleObjectId = toObjectIdParam(req.params.id, 'Sale not found');
    const tenantObjectId = new Types.ObjectId(req.tenant!.id);

    await session.withTransaction(async () => {
      const sale = await SaleModel.findOne({
        _id: saleObjectId,
        tenantId: tenantObjectId,
      }).session(session);

      if (!sale) throw AppError.notFound('Sale not found');
      if (sale.paymentStatus !== 'paid') {
        throw AppError.badRequest('Only fully paid sales can be returned');
      }

      const requestedByProduct = new Map(parsed.items.map((item) => [item.productId, item.qty]));
      const returnedItems = sale.items
        .map((item) => {
          const requestedQty = requestedByProduct.get(item.productId.toString()) ?? 0;
          const priorReturned = item.returnedQty ?? 0;
          const remainingQty = item.qty - priorReturned;
          if (requestedQty > remainingQty) {
            throw AppError.badRequest(
              `Cannot return more than remaining quantity for ${item.name}`,
            );
          }
          return { item, qty: requestedQty };
        })
        .filter(({ qty }) => qty > 0);

      if (returnedItems.length === 0)
        throw AppError.badRequest('No valid items selected for return');
      if (
        parsed.items.some(
          (requested) =>
            !sale.items.some((item) => item.productId.toString() === requested.productId),
        )
      ) {
        throw AppError.badRequest('Return contains a product that was not sold on this invoice');
      }

      for (const { item, qty } of returnedItems) {
        const updatedProduct = await ProductModel.findOneAndUpdate(
          { _id: item.productId, tenantId: tenantObjectId },
          { $inc: { stock: qty } },
          { session, new: true },
        );
        if (!updatedProduct) throw AppError.notFound(`Product not found: ${item.name}`);

        await StockMovementModel.create(
          [
            {
              tenantId: tenantObjectId,
              productId: updatedProduct._id,
              type: 'return',
              qtyChange: qty,
              balanceAfter: updatedProduct.stock,
              refId: sale._id,
              refType: 'Return',
              userId: new Types.ObjectId(req.user!.id),
              note: `Return processed for ${sale.invoiceNo}; original cashier ${sale.soldBy.toString()}`,
            },
          ],
          { session },
        );
      }

      for (const { item, qty } of returnedItems) {
        item.returnedQty = (item.returnedQty ?? 0) + qty;
      }
      sale.isReturned = sale.items.every((item) => (item.returnedQty ?? 0) >= item.qty);
      await sale.save({ session });

      await recordAuditLog({
        tenantId: req.tenant!.id,
        userId: req.user!.id,
        action: 'sale.returned',
        entity: 'Sale',
        entityId: sale._id.toString(),
        changes: {
          invoiceNo: sale.invoiceNo,
          returnedItems: returnedItems.map(({ item, qty }) => ({
            productId: item.productId.toString(),
            qty,
          })),
          status: 'RETURNED',
        },
      });
    });

    await invalidateTenantCache(req.tenant!.id);
    const updated = await SaleModel.findById(saleObjectId).populate('soldBy', 'name role').lean();
    res.status(200).json({ data: updated });
  } catch (err) {
    next(err);
  } finally {
    await session.endSession();
  }
});
