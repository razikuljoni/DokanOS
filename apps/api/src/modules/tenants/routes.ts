import { Router } from 'express';
import { Types } from 'mongoose';
import { PLAN_LIMITS, updateTenantSettingsSchema } from '@dokanos/shared';
import {
  AuditLogModel,
  ProductModel,
  TenantModel,
  UserModel,
} from '../../models/index.js';
import { requireAuth } from '../../middleware/auth.js';
import { requireTenant } from '../../middleware/tenant.js';
import { requirePermission } from '../../middleware/rbac.js';
import { AppError } from '../../utils/errors.js';
import { recordAuditLog } from '../../utils/audit.js';

export const tenantsRouter = Router();

tenantsRouter.use(requireAuth, requireTenant);

// GET /api/v1/tenants/me
tenantsRouter.get('/me', requirePermission('tenant:read'), async (req, res, next) => {
  try {
    const tenant = await TenantModel.findById(req.tenant!.id).lean();
    if (!tenant) {
      throw AppError.notFound('Tenant not found');
    }
    res.status(200).json({ data: tenant });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/v1/tenants/me
tenantsRouter.patch('/me', requirePermission('tenant:write'), async (req, res, next) => {
  try {
    const parsed = updateTenantSettingsSchema.parse(req.body);
    const updateDoc: Record<string, unknown> = {};
    if (parsed.name !== undefined) updateDoc.name = parsed.name;
    if (parsed.type !== undefined) updateDoc.type = parsed.type;
    if (parsed.lowStockThreshold !== undefined) {
      updateDoc['settings.lowStockThreshold'] = parsed.lowStockThreshold;
    }

    const updated = await TenantModel.findByIdAndUpdate(
      req.tenant!.id,
      { $set: updateDoc },
      { new: true },
    ).lean();

    await recordAuditLog({
      tenantId: req.tenant!.id,
      userId: req.user!.id,
      action: 'tenant.updated',
      entity: 'Tenant',
      entityId: req.tenant!.id,
      changes: parsed,
    });

    res.status(200).json({ data: updated });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/tenants/me/usage
tenantsRouter.get('/me/usage', requirePermission('tenant:read'), async (req, res, next) => {
  try {
    const tenantObjectId = new Types.ObjectId(req.tenant!.id);
    const [productCount, staffCount] = await Promise.all([
      ProductModel.countDocuments({ tenantId: tenantObjectId, isActive: true }),
      UserModel.countDocuments({
        tenantId: tenantObjectId,
        role: { $in: ['manager', 'staff'] },
        status: { $ne: 'disabled' },
      }),
    ]);

    const limits = PLAN_LIMITS[req.tenant!.plan];
    res.status(200).json({
      data: {
        plan: req.tenant!.plan,
        planExpiresAt: req.tenant!.planExpiresAt,
        productCount,
        maxProducts: Number.isFinite(limits.maxProducts) ? limits.maxProducts : null,
        staffCount,
        maxStaff: limits.maxStaff,
        csvImportExport: limits.csvImportExport,
        emailDigests: limits.emailDigests,
      },
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/tenants/me/audit-logs
tenantsRouter.get('/me/audit-logs', requirePermission('tenant:read'), async (req, res, next) => {
  try {
    const logs = await AuditLogModel.find({
      tenantId: new Types.ObjectId(req.tenant!.id),
    })
      .populate('userId', 'name email role')
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    res.status(200).json({ data: logs });
  } catch (err) {
    next(err);
  }
});
