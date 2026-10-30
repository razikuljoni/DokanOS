import { Router } from 'express';
import { Types } from 'mongoose';
import {
  ProductModel,
  PurchaseModel,
  SaleModel,
} from '../../models/index.js';
import { requireAuth } from '../../middleware/auth.js';
import { requireTenant } from '../../middleware/tenant.js';
import { requirePermission } from '../../middleware/rbac.js';
import { cacheGet, cacheSet } from '../../config/redis.js';

export const dashboardRouter = Router();

dashboardRouter.use(requireAuth, requireTenant);

// GET /api/v1/dashboard/summary?from&to
dashboardRouter.get('/summary', requirePermission('dashboard:read'), async (req, res, next) => {
  try {
    const tenantId = req.tenant!.id;
    const tenantObjectId = new Types.ObjectId(tenantId);

    const fromStr = typeof req.query.from === 'string' ? req.query.from : '';
    const toStr = typeof req.query.to === 'string' ? req.query.to : '';
    const cacheKey = `dash:summary:${tenantId}:${fromStr || 'all'}:${toStr || 'all'}`;

    const cached = await cacheGet<Record<string, unknown>>(cacheKey);
    if (cached) {
      res.setHeader('X-Cache', 'HIT');
      res.status(200).json({ data: cached });
      return;
    }

    const saleMatch: Record<string, unknown> = {
      tenantId: tenantObjectId,
      isReturned: false,
    };

    if (fromStr || toStr) {
      const createdAt: Record<string, Date> = {};
      if (fromStr) createdAt.$gte = new Date(fromStr);
      if (toStr) createdAt.$lte = new Date(toStr);
      saleMatch.createdAt = createdAt;
    }

    const [
      revenueAgg,
      profitAgg,
      topProductsAgg,
      categorySalesAgg,
      lowStockCount,
      receivableAgg,
      payableAgg,
      recentSales,
    ] = await Promise.all([
      // 1. Revenue, salesCount, averageBill
      SaleModel.aggregate<{
        revenue: number;
        salesCount: number;
        averageBill: number;
      }>([
        { $match: saleMatch },
        {
          $group: {
            _id: null,
            revenue: { $sum: '$total' },
            salesCount: { $sum: 1 },
            averageBill: { $avg: '$total' },
          },
        },
      ]),

      // 2. Profit = revenue - cost of goods sold
      SaleModel.aggregate<{ totalCogs: number }>([
        { $match: saleMatch },
        { $unwind: '$items' },
        {
          $group: {
            _id: null,
            totalCogs: {
              $sum: { $multiply: ['$items.qty', '$items.costPrice'] },
            },
          },
        },
      ]),

      // 3. Top 5 products by revenue
      SaleModel.aggregate<{
        productId: Types.ObjectId;
        name: string;
        qtySold: number;
        revenue: number;
      }>([
        { $match: saleMatch },
        { $unwind: '$items' },
        {
          $group: {
            _id: '$items.productId',
            name: { $first: '$items.name' },
            qtySold: { $sum: '$items.qty' },
            revenue: { $sum: '$items.lineTotal' },
          },
        },
        { $sort: { revenue: -1 } },
        { $limit: 5 },
        {
          $project: {
            _id: 0,
            productId: '$_id',
            name: 1,
            qtySold: 1,
            revenue: { $round: ['$revenue', 2] },
          },
        },
      ]),

      // 4. Sales by category
      SaleModel.aggregate<{ category: string; revenue: number; count: number }>([
        { $match: saleMatch },
        { $unwind: '$items' },
        {
          $lookup: {
            from: 'products',
            localField: 'items.productId',
            foreignField: '_id',
            as: 'productDoc',
          },
        },
        {
          $addFields: {
            categoryName: {
              $ifNull: [{ $arrayElemAt: ['$productDoc.category', 0] }, 'General'],
            },
          },
        },
        {
          $group: {
            _id: '$categoryName',
            revenue: { $sum: '$items.lineTotal' },
            count: { $sum: '$items.qty' },
          },
        },
        { $sort: { revenue: -1 } },
        {
          $project: {
            _id: 0,
            category: '$_id',
            revenue: { $round: ['$revenue', 2] },
            count: 1,
          },
        },
      ]),

      // 5. Low-stock count
      ProductModel.countDocuments({
        tenantId: tenantObjectId,
        isActive: true,
        $expr: { $lte: ['$stock', '$lowStockAt'] },
      }),

      // 6. Customer receivable outstanding
      SaleModel.aggregate<{ totalReceivable: number }>([
        { $match: { tenantId: tenantObjectId, isReturned: false, dueAmount: { $gt: 0 } } },
        { $group: { _id: null, totalReceivable: { $sum: '$dueAmount' } } },
      ]),

      // 7. Supplier payable outstanding
      PurchaseModel.aggregate<{ totalPayable: number }>([
        { $match: { tenantId: tenantObjectId, dueAmount: { $gt: 0 } } },
        { $group: { _id: null, totalPayable: { $sum: '$dueAmount' } } },
      ]),

      // 8. Recent 5 sales for dashboard table
      SaleModel.find({ tenantId: tenantObjectId })
        .sort({ createdAt: -1 })
        .limit(6)
        .lean(),
    ]);

    const revStats = revenueAgg[0] ?? { revenue: 0, salesCount: 0, averageBill: 0 };
    const cogs = profitAgg[0]?.totalCogs ?? 0;
    const revenue = Number((revStats.revenue ?? 0).toFixed(2));
    const profit = Number((revenue - cogs).toFixed(2));
    const averageBill = Number((revStats.averageBill ?? 0).toFixed(2));
    const receivable = Number((receivableAgg[0]?.totalReceivable ?? 0).toFixed(2));
    const payable = Number((payableAgg[0]?.totalPayable ?? 0).toFixed(2));

    const summaryData = {
      revenue,
      profit,
      salesCount: revStats.salesCount ?? 0,
      averageBill,
      topProducts: topProductsAgg,
      salesByCategory: categorySalesAgg,
      lowStockCount,
      duesOutstanding: {
        receivable,
        payable,
      },
      recentSales,
    };

    await cacheSet(cacheKey, summaryData, 60);
    res.setHeader('X-Cache', 'MISS');
    res.status(200).json({ data: summaryData });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/dashboard/sales-trend?from&to&granularity=daily
dashboardRouter.get('/sales-trend', requirePermission('dashboard:read'), async (req, res, next) => {
  try {
    const tenantId = req.tenant!.id;
    const tenantObjectId = new Types.ObjectId(tenantId);

    const fromStr = typeof req.query.from === 'string' ? req.query.from : '';
    const toStr = typeof req.query.to === 'string' ? req.query.to : '';
    const cacheKey = `dash:trend:${tenantId}:${fromStr || '30d'}:${toStr || 'now'}`;

    const cached = await cacheGet<unknown[]>(cacheKey);
    if (cached) {
      res.setHeader('X-Cache', 'HIT');
      res.status(200).json({ data: cached });
      return;
    }

    const defaultFrom = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const matchStage: Record<string, unknown> = {
      tenantId: tenantObjectId,
      isReturned: false,
      createdAt: {
        $gte: fromStr ? new Date(fromStr) : defaultFrom,
        ...(toStr ? { $lte: new Date(toStr) } : {}),
      },
    };

    const series = await SaleModel.aggregate<{
      date: string;
      revenue: number;
      orders: number;
    }>([
      { $match: matchStage },
      {
        $group: {
          _id: {
            $dateToString: {
              format: '%Y-%m-%d',
              date: '$createdAt',
              timezone: 'Asia/Dhaka',
            },
          },
          revenue: { $sum: '$total' },
          orders: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
      {
        $project: {
          _id: 0,
          date: '$_id',
          revenue: { $round: ['$revenue', 2] },
          orders: 1,
        },
      },
    ]);

    await cacheSet(cacheKey, series, 60);
    res.setHeader('X-Cache', 'MISS');
    res.status(200).json({ data: series });
  } catch (err) {
    next(err);
  }
});
