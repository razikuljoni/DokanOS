import { Router } from 'express';
import { Types } from 'mongoose';
import { createSupplierSchema, updateSupplierSchema } from '@dokanos/shared';
import { PurchaseModel, SupplierModel } from '../../models/index.js';
import { requireAuth } from '../../middleware/auth.js';
import { requireTenant } from '../../middleware/tenant.js';
import { requirePermission } from '../../middleware/rbac.js';
import { AppError } from '../../utils/errors.js';
import { toObjectIdParam } from '../../utils/pagination.js';

export const suppliersRouter = Router();

suppliersRouter.use(requireAuth, requireTenant);

// GET /api/v1/suppliers
suppliersRouter.get('/', requirePermission('suppliers:read'), async (req, res, next) => {
  try {
    const suppliers = await SupplierModel.find({
      tenantId: new Types.ObjectId(req.tenant!.id),
      isActive: true,
    })
      .sort({ totalDue: -1, name: 1 })
      .lean();

    res.status(200).json({ data: suppliers });
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

    res.status(201).json({ data: created });
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
      },
      { $set: parsed },
      { new: true },
    ).lean();

    if (!updated) {
      throw AppError.notFound('Supplier not found');
    }

    res.status(200).json({ data: updated });
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
