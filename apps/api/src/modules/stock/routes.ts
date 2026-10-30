import { Router } from 'express';
import mongoose, { Types } from 'mongoose';
import { stockAdjustSchema } from '@dokanos/shared';
import { ProductModel, StockMovementModel } from '../../models/index.js';
import { requireAuth } from '../../middleware/auth.js';
import { requireTenant } from '../../middleware/tenant.js';
import { requirePermission } from '../../middleware/rbac.js';
import { AppError } from '../../utils/errors.js';
import { buildPaginationMeta, parsePagination } from '../../utils/pagination.js';
import { invalidateTenantCache } from '../../config/redis.js';
import { emitToTenant } from '../../realtime/socket.js';

export const stockRouter = Router();

stockRouter.use(requireAuth, requireTenant);

// GET /api/v1/stock/movements
stockRouter.get('/movements', requirePermission('stock:read'), async (req, res, next) => {
  try {
    const { page, limit, skip } = parsePagination(req.query as Record<string, unknown>);
    const tenantObjectId = new Types.ObjectId(req.tenant!.id);

    const filter: Record<string, unknown> = {
      tenantId: tenantObjectId,
    };

    if (typeof req.query.productId === 'string' && Types.ObjectId.isValid(req.query.productId)) {
      filter.productId = new Types.ObjectId(req.query.productId);
    }

    if (typeof req.query.from === 'string' || typeof req.query.to === 'string') {
      const dateFilter: Record<string, Date> = {};
      if (typeof req.query.from === 'string' && req.query.from) {
        dateFilter.$gte = new Date(req.query.from);
      }
      if (typeof req.query.to === 'string' && req.query.to) {
        dateFilter.$lte = new Date(req.query.to);
      }
      filter.createdAt = dateFilter;
    }

    const [movements, total] = await Promise.all([
      StockMovementModel.find(filter)
        .populate('productId', 'name sku unit')
        .populate('userId', 'name role')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      StockMovementModel.countDocuments(filter),
    ]);

    res.status(200).json({
      data: movements,
      meta: buildPaginationMeta(page, limit, total),
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/stock/adjust
stockRouter.post('/adjust', requirePermission('stock:write'), async (req, res, next) => {
  const session = await mongoose.startSession();
  try {
    const parsed = stockAdjustSchema.parse(req.body);
    const tenantObjectId = new Types.ObjectId(req.tenant!.id);
    const productObjectId = new Types.ObjectId(parsed.productId);

    let updatedProduct: { _id: Types.ObjectId; name: string; stock: number } | null = null;

    await session.withTransaction(async () => {
      const product = await ProductModel.findOne({
        _id: productObjectId,
        tenantId: tenantObjectId,
      }).session(session);

      if (!product) {
        throw AppError.notFound('Product not found');
      }

      const newBalance = product.stock + parsed.qtyChange;
      if (newBalance < 0) {
        throw AppError.insufficientStock(
          `Adjustment would result in negative stock for ${product.name}`,
        );
      }

      product.stock = newBalance;
      await product.save({ session });
      updatedProduct = {
        _id: product._id,
        name: product.name,
        stock: product.stock,
      };

      await StockMovementModel.create(
        [
          {
            tenantId: tenantObjectId,
            productId: product._id,
            type: 'adjustment',
            qtyChange: parsed.qtyChange,
            balanceAfter: newBalance,
            refId: product._id,
            refType: 'Adjustment',
            userId: new Types.ObjectId(req.user!.id),
            note: parsed.note,
          },
        ],
        { session },
      );
    });

    await invalidateTenantCache(req.tenant!.id);
    const finalProduct = updatedProduct as { _id: Types.ObjectId; name: string; stock: number } | null;
    if (finalProduct) {
      emitToTenant(req.tenant!.id, 'stock:updated', {
        productId: finalProduct._id.toString(),
        name: finalProduct.name,
        stock: finalProduct.stock,
      });
    }

    res.status(200).json({ data: finalProduct });
  } catch (err) {
    next(err);
  } finally {
    await session.endSession();
  }
});
