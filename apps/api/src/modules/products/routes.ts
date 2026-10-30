import { Router } from 'express';
import { Types } from 'mongoose';
import {
  ERROR_CODES,
  PLAN_LIMITS,
  PRODUCT_UNITS,
  createProductSchema,
  updateProductSchema,
  type ProductUnit,
} from '@dokanos/shared';
import { ProductModel, SaleModel, StockMovementModel } from '../../models/index.js';
import { requireAuth } from '../../middleware/auth.js';
import { requireTenant } from '../../middleware/tenant.js';
import { requirePermission } from '../../middleware/rbac.js';
import { AppError } from '../../utils/errors.js';
import {
  buildPaginationMeta,
  parsePagination,
  toObjectIdParam,
} from '../../utils/pagination.js';
import { invalidateTenantCache } from '../../config/redis.js';
import { recordAuditLog } from '../../utils/audit.js';

export const productsRouter = Router();

productsRouter.use(requireAuth, requireTenant);

// GET /api/v1/products/low-stock
productsRouter.get('/low-stock', requirePermission('products:read'), async (req, res, next) => {
  try {
    const tenantObjectId = new Types.ObjectId(req.tenant!.id);
    const items = await ProductModel.find({
      tenantId: tenantObjectId,
      isActive: true,
      $expr: { $lte: ['$stock', '$lowStockAt'] },
    })
      .sort({ stock: 1 })
      .lean();

    res.status(200).json({ data: items });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/products/export (Pro only CSV download)
productsRouter.get('/export', requirePermission('products:read'), async (req, res, next) => {
  try {
    const limits = PLAN_LIMITS[req.tenant!.plan];
    if (!limits.csvImportExport) {
      throw AppError.planLimit('CSV Export is a Pro feature. Upgrade to Pro to export inventory.');
    }

    const products = await ProductModel.find({
      tenantId: new Types.ObjectId(req.tenant!.id),
      isActive: true,
    })
      .sort({ name: 1 })
      .lean();

    const header = 'name,category,unit,sku,costPrice,sellPrice,stock,lowStockAt';
    const rows = products.map((p) => {
      const safeName = `"${p.name.replace(/"/g, '""')}"`;
      const safeCat = `"${p.category.replace(/"/g, '""')}"`;
      return `${safeName},${safeCat},${p.unit},${p.sku},${p.costPrice},${p.sellPrice},${p.stock},${p.lowStockAt}`;
    });

    const csv = [header, ...rows].join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="dokanos-products-${req.tenant!.slug}.csv"`);
    res.status(200).send(csv);
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/products/import (Pro only CSV import with row-by-row report)
productsRouter.post('/import', requirePermission('products:write'), async (req, res, next) => {
  try {
    const limits = PLAN_LIMITS[req.tenant!.plan];
    if (!limits.csvImportExport) {
      throw AppError.planLimit('CSV Import is a Pro feature. Upgrade to Pro to bulk import products.');
    }

    const csvText = (req.body as { csv?: string } | undefined)?.csv;
    if (!csvText || typeof csvText !== 'string') {
      throw AppError.badRequest('CSV content string is required in request body { csv }');
    }

    const lines = csvText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);

    if (lines.length < 2) {
      throw AppError.badRequest('CSV must include a header row and at least one product row');
    }

    const tenantObjectId = new Types.ObjectId(req.tenant!.id);
    let importedCount = 0;
    const errors: Array<{ row: number; message: string }> = [];

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i]!;
      const cols = line.split(',').map((c) => c.replace(/^"|"$/g, '').trim());
      const [name, category, unitRaw, sku, costRaw, sellRaw, stockRaw, lowStockRaw] = cols;

      const unitCandidate = (unitRaw ?? 'pcs') as ProductUnit;
      const validUnit = PRODUCT_UNITS.includes(unitCandidate) ? unitCandidate : 'pcs';

      const parsed = createProductSchema.safeParse({
        name: name ?? '',
        category: category ?? 'General',
        unit: validUnit,
        sku: sku ?? '',
        costPrice: Number(costRaw ?? 0),
        sellPrice: Number(sellRaw ?? 0),
        stock: Number(stockRaw ?? 0),
        lowStockAt: lowStockRaw ? Number(lowStockRaw) : req.tenant!.lowStockThreshold,
      });

      if (!parsed.success) {
        errors.push({
          row: i + 1,
          message: parsed.error.issues.map((iss) => iss.message).join('; '),
        });
        continue;
      }

      await ProductModel.findOneAndUpdate(
        { tenantId: tenantObjectId, sku: parsed.data.sku },
        {
          $set: {
            ...parsed.data,
            tenantId: tenantObjectId,
            isActive: true,
          },
        },
        { upsert: true, new: true },
      );
      importedCount += 1;
    }

    await invalidateTenantCache(req.tenant!.id);

    res.status(200).json({
      data: {
        importedCount,
        totalRows: lines.length - 1,
        errors,
      },
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/products
productsRouter.get('/', requirePermission('products:read'), async (req, res, next) => {
  try {
    const { page, limit, skip } = parsePagination(req.query as Record<string, unknown>);
    const tenantObjectId = new Types.ObjectId(req.tenant!.id);

    const filter: Record<string, unknown> = {
      tenantId: tenantObjectId,
      isActive: true,
    };

    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { sku: { $regex: search, $options: 'i' } },
        { category: { $regex: search, $options: 'i' } },
      ];
    }

    const category = typeof req.query.category === 'string' ? req.query.category.trim() : '';
    if (category && category !== 'all') {
      filter.category = category;
    }

    const stockStatus =
      typeof req.query.stockStatus === 'string' ? req.query.stockStatus.trim() : '';
    if (stockStatus === 'low') {
      filter.$expr = { $and: [{ $gt: ['$stock', 0] }, { $lte: ['$stock', '$lowStockAt'] }] };
    } else if (stockStatus === 'out') {
      filter.stock = 0;
    } else if (stockStatus === 'ok') {
      filter.$expr = { $gt: ['$stock', '$lowStockAt'] };
    }

    const sortParam = typeof req.query.sort === 'string' ? req.query.sort : 'name:asc';
    const [sortField = 'name', sortDir = 'asc'] = sortParam.split(':');
    const sortObj: Record<string, 1 | -1> = {
      [sortField]: sortDir === 'desc' ? -1 : 1,
    };

    const [items, total] = await Promise.all([
      ProductModel.find(filter).sort(sortObj).skip(skip).limit(limit).lean(),
      ProductModel.countDocuments(filter),
    ]);

    res.status(200).json({
      data: items,
      meta: buildPaginationMeta(page, limit, total),
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/products/:id
productsRouter.get('/:id', requirePermission('products:read'), async (req, res, next) => {
  try {
    const productObjectId = toObjectIdParam(req.params.id, 'Product not found');
    const tenantObjectId = new Types.ObjectId(req.tenant!.id);
    const product = await ProductModel.findOne({
      _id: productObjectId,
      tenantId: tenantObjectId,
    }).lean();

    if (!product) {
      throw AppError.notFound('Product not found');
    }

    const [movements, recentSales] = await Promise.all([
      StockMovementModel.find({
        tenantId: tenantObjectId,
        productId: product._id,
      })
        .sort({ createdAt: -1 })
        .limit(30)
        .lean(),
      SaleModel.find({
        tenantId: tenantObjectId,
        'items.productId': product._id,
      })
        .sort({ createdAt: -1 })
        .limit(15)
        .lean(),
    ]);

    res.status(200).json({
      data: {
        ...product,
        movements,
        recentSales,
      },
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/products
productsRouter.post('/', requirePermission('products:write'), async (req, res, next) => {
  try {
    const parsed = createProductSchema.parse(req.body);
    const tenantObjectId = new Types.ObjectId(req.tenant!.id);

    // Enforce plan limit on active products
    const limits = PLAN_LIMITS[req.tenant!.plan];
    if (Number.isFinite(limits.maxProducts)) {
      const currentCount = await ProductModel.countDocuments({
        tenantId: tenantObjectId,
        isActive: true,
      });
      if (currentCount >= limits.maxProducts) {
        throw AppError.planLimit(
          `Free plan limit of ${limits.maxProducts} products reached. Upgrade to Pro for unlimited products.`,
        );
      }
    }

    const existingSku = await ProductModel.findOne({
      tenantId: tenantObjectId,
      sku: parsed.sku,
    }).lean();

    if (existingSku) {
      throw new AppError(
        409,
        ERROR_CODES.CONFLICT,
        `Product with SKU '${parsed.sku}' already exists in this shop`,
      );
    }

    const created = await ProductModel.create({
      tenantId: tenantObjectId,
      name: parsed.name,
      category: parsed.category,
      unit: parsed.unit,
      sku: parsed.sku,
      costPrice: parsed.costPrice,
      sellPrice: parsed.sellPrice,
      stock: parsed.stock,
      lowStockAt: parsed.lowStockAt ?? req.tenant!.lowStockThreshold,
      supplierId: parsed.supplierId ? new Types.ObjectId(parsed.supplierId) : null,
      isActive: true,
    });

    if (parsed.stock > 0) {
      await StockMovementModel.create({
        tenantId: tenantObjectId,
        productId: created._id,
        type: 'adjustment',
        qtyChange: parsed.stock,
        balanceAfter: parsed.stock,
        refId: created._id,
        refType: 'Adjustment',
        userId: new Types.ObjectId(req.user!.id),
        note: 'Initial opening stock',
      });
    }

    await invalidateTenantCache(req.tenant!.id);

    res.status(201).json({ data: created });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/v1/products/:id
productsRouter.patch('/:id', requirePermission('products:write'), async (req, res, next) => {
  try {
    const productObjectId = toObjectIdParam(req.params.id, 'Product not found');
    const parsed = updateProductSchema.parse(req.body);
    const tenantObjectId = new Types.ObjectId(req.tenant!.id);

    const updated = await ProductModel.findOneAndUpdate(
      { _id: productObjectId, tenantId: tenantObjectId },
      { $set: parsed },
      { new: true },
    ).lean();

    if (!updated) {
      throw AppError.notFound('Product not found');
    }

    await invalidateTenantCache(req.tenant!.id);
    res.status(200).json({ data: updated });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/v1/products/:id (soft-delete via isActive=false)
productsRouter.delete('/:id', requirePermission('products:write'), async (req, res, next) => {
  try {
    const productObjectId = toObjectIdParam(req.params.id, 'Product not found');
    const tenantObjectId = new Types.ObjectId(req.tenant!.id);
    const updated = await ProductModel.findOneAndUpdate(
      { _id: productObjectId, tenantId: tenantObjectId },
      { $set: { isActive: false } },
      { new: true },
    ).lean();

    if (!updated) {
      throw AppError.notFound('Product not found');
    }

    await recordAuditLog({
      tenantId: req.tenant!.id,
      userId: req.user!.id,
      action: 'product.deleted',
      entity: 'Product',
      entityId: updated._id.toString(),
      changes: { name: updated.name, sku: updated.sku },
    });

    await invalidateTenantCache(req.tenant!.id);
    res.status(200).json({ data: updated });
  } catch (err) {
    next(err);
  }
});
