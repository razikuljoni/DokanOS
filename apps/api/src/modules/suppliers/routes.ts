import { Router } from 'express';
import { Types } from 'mongoose';
import { createSupplierSchema, updateSupplierSchema } from '@dokanos/shared';
import { PurchaseModel, SupplierModel } from '../../models/index.js';
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
import { recordAuditLog } from '../../utils/audit.js';

export const suppliersRouter = Router();

suppliersRouter.use(requireAuth, requireTenant);

// GET /api/v1/suppliers
suppliersRouter.get('/', requirePermission('suppliers:read'), async (req, res, next) => {
  try {
    const { page, limit, skip } = parsePagination(req.query as Record<string, unknown>, 100);
    const filter: Record<string, unknown> = {
      tenantId: new Types.ObjectId(req.tenant!.id),
      isActive: true,
    };

    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    if (search) {
      const escaped = escapeRegex(search);
      filter.$or = [
        { name: { $regex: escaped, $options: 'i' } },
        { phone: { $regex: escaped, $options: 'i' } },
      ];
    }

    const [suppliers, total] = await Promise.all([
      SupplierModel.find(filter)
        .sort({ totalDue: -1, name: 1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      SupplierModel.countDocuments(filter),
    ]);

    res.status(200).json({
      data: suppliers,
      meta: buildPaginationMeta(page, limit, total),
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/suppliers
suppliersRouter.post('/', requirePermission('suppliers:write'), async (req, res, next) => {
  try {
    const parsed = createSupplierSchema.parse(req.body);
    const created = await SupplierModel.create({
      tenantId: new Types.ObjectId(req.tenant!.id),
      name: parsed.name,
      phone: parsed.phone,
      address: parsed.address,
      totalDue: 0,
      isActive: true,
    });

    await recordAuditLog({
      tenantId: req.tenant!.id,
      userId: req.user!.id,
      action: 'supplier.created',
      entity: 'Supplier',
      entityId: created._id.toString(),
      changes: { name: created.name, phone: created.phone },
    });

    res.status(201).json({ data: created });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/suppliers/:id
suppliersRouter.get('/:id', requirePermission('suppliers:read'), async (req, res, next) => {
  try {
    const supplierObjectId = toObjectIdParam(req.params.id, 'Supplier not found');
    const supplier = await SupplierModel.findOne({
      _id: supplierObjectId,
      tenantId: new Types.ObjectId(req.tenant!.id),
      isActive: true,
    }).lean();

    if (!supplier) {
      throw AppError.notFound('Supplier not found');
    }

    res.status(200).json({ data: supplier });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/v1/suppliers/:id
suppliersRouter.patch('/:id', requirePermission('suppliers:write'), async (req, res, next) => {
  try {
    const supplierObjectId = toObjectIdParam(req.params.id, 'Supplier not found');
    const parsed = updateSupplierSchema.parse(req.body);
    const updated = await SupplierModel.findOneAndUpdate(
      {
        _id: supplierObjectId,
        tenantId: new Types.ObjectId(req.tenant!.id),
        isActive: true,
      },
      { $set: parsed },
      { new: true },
    ).lean();

    if (!updated) {
      throw AppError.notFound('Supplier not found');
    }

    await recordAuditLog({
      tenantId: req.tenant!.id,
      userId: req.user!.id,
      action: 'supplier.updated',
      entity: 'Supplier',
      entityId: updated._id.toString(),
      changes: parsed as Record<string, unknown>,
    });

    res.status(200).json({ data: updated });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/v1/suppliers/:id
suppliersRouter.delete('/:id', requirePermission('suppliers:write'), async (req, res, next) => {
  try {
    const supplierObjectId = toObjectIdParam(req.params.id, 'Supplier not found');
    const tenantObjectId = new Types.ObjectId(req.tenant!.id);

    const supplier = await SupplierModel.findOneAndUpdate(
      { _id: supplierObjectId, tenantId: tenantObjectId, isActive: true },
      { $set: { isActive: false } },
      { new: true },
    ).lean();

    if (!supplier) {
      throw AppError.notFound('Supplier not found');
    }

    await recordAuditLog({
      tenantId: req.tenant!.id,
      userId: req.user!.id,
      action: 'supplier.deleted',
      entity: 'Supplier',
      entityId: supplierObjectId.toString(),
      changes: { name: supplier.name, phone: supplier.phone },
    });

    res.status(200).json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/suppliers/:id/dues
suppliersRouter.get('/:id/dues', requirePermission('suppliers:read'), async (req, res, next) => {
  try {
    const supplierObjectId = toObjectIdParam(req.params.id, 'Supplier not found');
    const tenantObjectId = new Types.ObjectId(req.tenant!.id);

    const [supplier, purchases] = await Promise.all([
      SupplierModel.findOne({ _id: supplierObjectId, tenantId: tenantObjectId }).lean(),
      PurchaseModel.find({
        tenantId: tenantObjectId,
        supplierId: supplierObjectId,
        dueAmount: { $gt: 0 },
      })
        .sort({ createdAt: -1 })
        .lean(),
    ]);

    if (!supplier) {
      throw AppError.notFound('Supplier not found');
    }

    res.status(200).json({
      data: {
        supplier,
        outstandingPurchases: purchases,
      },
    });
  } catch (err) {
    next(err);
  }
});
