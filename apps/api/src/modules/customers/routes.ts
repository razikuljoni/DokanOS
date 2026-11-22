import { Router } from 'express';
import { Types } from 'mongoose';
import {
  ERROR_CODES,
  createCustomerSchema,
  updateCustomerSchema,
} from '@dokanos/shared';
import { CustomerModel, SaleModel } from '../../models/index.js';
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

export const customersRouter = Router();

customersRouter.use(requireAuth, requireTenant);

// GET /api/v1/customers
customersRouter.get('/', requirePermission('customers:read'), async (req, res, next) => {
  try {
    const { page, limit, skip } = parsePagination(req.query as Record<string, unknown>, 100);
    const tenantObjectId = new Types.ObjectId(req.tenant!.id);

    const filter: Record<string, unknown> = {
      tenantId: tenantObjectId,
    };

    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    if (search) {
      const escaped = escapeRegex(search);
      filter.$or = [
        { name: { $regex: escaped, $options: 'i' } },
        { phone: { $regex: escaped, $options: 'i' } },
      ];
    }

    if (req.query.hasDue === 'true') {
      filter.balanceDue = { $gt: 0 };
    }

    const [customers, total] = await Promise.all([
      CustomerModel.find(filter)
        .sort({ balanceDue: -1, name: 1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      CustomerModel.countDocuments(filter),
    ]);

    res.status(200).json({
      data: customers,
      meta: buildPaginationMeta(page, limit, total),
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/customers
customersRouter.post('/', requirePermission('customers:write'), async (req, res, next) => {
  try {
    const parsed = createCustomerSchema.parse(req.body);
    const tenantObjectId = new Types.ObjectId(req.tenant!.id);

    const existing = await CustomerModel.findOne({
      tenantId: tenantObjectId,
      phone: parsed.phone,
    }).lean();

    if (existing) {
      throw new AppError(
        409,
        ERROR_CODES.CONFLICT,
        `Customer with phone '${parsed.phone}' already exists in this shop`,
      );
    }

    const created = await CustomerModel.create({
      tenantId: tenantObjectId,
      name: parsed.name,
      phone: parsed.phone,
      address: parsed.address,
      balanceDue: 0,
      totalSpent: 0,
    });

    await recordAuditLog({
      tenantId: req.tenant!.id,
      userId: req.user!.id,
      action: 'customer.created',
      entity: 'Customer',
      entityId: created._id.toString(),
      changes: { name: created.name, phone: created.phone },
    });

    res.status(201).json({ data: created });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/customers/:id
customersRouter.get('/:id', requirePermission('customers:read'), async (req, res, next) => {
  try {
    const customerObjectId = toObjectIdParam(req.params.id, 'Customer not found');
    const tenantObjectId = new Types.ObjectId(req.tenant!.id);

    const customer = await CustomerModel.findOne({
      _id: customerObjectId,
      tenantId: tenantObjectId,
    }).lean();

    if (!customer) {
      throw AppError.notFound('Customer not found');
    }

    const [sales, openDues] = await Promise.all([
      SaleModel.find({
        tenantId: tenantObjectId,
        $or: [{ customerId: customer._id }, { customerPhone: customer.phone }],
      })
        .sort({ createdAt: -1 })
        .limit(30)
        .lean(),
      SaleModel.find({
        tenantId: tenantObjectId,
        $or: [{ customerId: customer._id }, { customerPhone: customer.phone }],
        dueAmount: { $gt: 0 },
        isReturned: false,
      })
        .sort({ createdAt: -1 })
        .lean(),
    ]);

    res.status(200).json({
      data: {
        ...customer,
        sales,
        openDues,
      },
    });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/v1/customers/:id
customersRouter.patch('/:id', requirePermission('customers:write'), async (req, res, next) => {
  try {
    const customerObjectId = toObjectIdParam(req.params.id, 'Customer not found');
    const parsed = updateCustomerSchema.parse(req.body);
    const tenantObjectId = new Types.ObjectId(req.tenant!.id);

    if (parsed.phone) {
      const existing = await CustomerModel.findOne({
        tenantId: tenantObjectId,
        phone: parsed.phone,
        _id: { $ne: customerObjectId },
      }).lean();

      if (existing) {
        throw new AppError(
          409,
          ERROR_CODES.CONFLICT,
          `Customer with phone '${parsed.phone}' already exists in this shop`,
        );
      }
    }

    const updated = await CustomerModel.findOneAndUpdate(
      {
        _id: customerObjectId,
        tenantId: tenantObjectId,
      },
      { $set: parsed },
      { new: true },
    ).lean();

    if (!updated) {
      throw AppError.notFound('Customer not found');
    }

    await recordAuditLog({
      tenantId: req.tenant!.id,
      userId: req.user!.id,
      action: 'customer.updated',
      entity: 'Customer',
      entityId: updated._id.toString(),
      changes: parsed as Record<string, unknown>,
    });

    res.status(200).json({ data: updated });
  } catch (err) {
    next(err);
  }
});
