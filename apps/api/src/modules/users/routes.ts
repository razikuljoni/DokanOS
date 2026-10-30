import crypto from 'node:crypto';
import { Router } from 'express';
import { Types } from 'mongoose';
import bcrypt from 'bcryptjs';
import {
  ERROR_CODES,
  PLAN_LIMITS,
  inviteStaffSchema,
  updateUserRoleSchema,
  updateUserStatusSchema,
} from '@dokanos/shared';
import { UserModel } from '../../models/index.js';
import { requireAuth } from '../../middleware/auth.js';
import { requireTenant } from '../../middleware/tenant.js';
import { requirePermission } from '../../middleware/rbac.js';
import { AppError } from '../../utils/errors.js';
import { toObjectIdParam } from '../../utils/pagination.js';
import { recordAuditLog } from '../../utils/audit.js';
import { env } from '../../config/env.js';

export const usersRouter = Router();

usersRouter.use(requireAuth, requireTenant);

// GET /api/v1/users
usersRouter.get('/', requirePermission('staff:read'), async (req, res, next) => {
  try {
    const users = await UserModel.find({
      tenantId: new Types.ObjectId(req.tenant!.id),
    })
      .select('-passwordHash')
      .sort({ createdAt: 1 })
      .lean();

    res.status(200).json({ data: users });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/users/invite
usersRouter.post('/invite', requirePermission('staff:write'), async (req, res, next) => {
  try {
    const parsed = inviteStaffSchema.parse(req.body);
    const tenantObjectId = new Types.ObjectId(req.tenant!.id);

    const currentStaffCount = await UserModel.countDocuments({
      tenantId: tenantObjectId,
      role: { $in: ['manager', 'staff'] },
      status: { $ne: 'disabled' },
    });

    const limits = PLAN_LIMITS[req.tenant!.plan];
    if (currentStaffCount >= limits.maxStaff) {
      throw AppError.planLimit(
        `Your ${req.tenant!.plan.toUpperCase()} plan allows up to ${limits.maxStaff} staff member(s) besides the owner. Upgrade to Pro to add up to 5 staff.`,
      );
    }

    const existing = await UserModel.findOne({
      tenantId: tenantObjectId,
      email: parsed.email,
    }).lean();
    if (existing) {
      throw new AppError(409, ERROR_CODES.CONFLICT, 'A staff member with this email already exists');
    }

    const rawInviteToken = crypto.randomBytes(24).toString('hex');
    const tempPassword = parsed.password ?? 'Staff1234!';
    const passwordHash = await bcrypt.hash(tempPassword, 12);

    const created = await UserModel.create({
      name: parsed.name,
      email: parsed.email,
      passwordHash,
      role: parsed.role,
      tenantId: tenantObjectId,
      status: 'invited',
      inviteToken: rawInviteToken,
    });

    const setupLink = `${env.FRONTEND_URL}/login?invite=${rawInviteToken}&email=${encodeURIComponent(parsed.email)}`;

    await recordAuditLog({
      tenantId: req.tenant!.id,
      userId: req.user!.id,
      action: 'staff.invited',
      entity: 'User',
      entityId: created._id.toString(),
      changes: { email: parsed.email, role: parsed.role },
    });

    res.status(201).json({
      data: {
        _id: created._id,
        name: created.name,
        email: created.email,
        role: created.role,
        status: created.status,
        setupLink,
      },
    });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/v1/users/:id/role
usersRouter.patch('/:id/role', requirePermission('staff:write'), async (req, res, next) => {
  try {
    const userObjectId = toObjectIdParam(req.params.id, 'Staff member not found');
    const parsed = updateUserRoleSchema.parse(req.body);
    const target = await UserModel.findOne({
      _id: userObjectId,
      tenantId: new Types.ObjectId(req.tenant!.id),
    });

    if (!target) {
      throw AppError.notFound('Staff member not found');
    }
    if (target.role === 'owner') {
      throw AppError.forbidden('Cannot change role of the shop owner');
    }

    target.role = parsed.role;
    await target.save();

    await recordAuditLog({
      tenantId: req.tenant!.id,
      userId: req.user!.id,
      action: 'staff.role_updated',
      entity: 'User',
      entityId: target._id.toString(),
      changes: { role: parsed.role },
    });

    res.status(200).json({ data: target });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/v1/users/:id/status
usersRouter.patch('/:id/status', requirePermission('staff:write'), async (req, res, next) => {
  try {
    const userObjectId = toObjectIdParam(req.params.id, 'Staff member not found');
    const parsed = updateUserStatusSchema.parse(req.body);
    const target = await UserModel.findOne({
      _id: userObjectId,
      tenantId: new Types.ObjectId(req.tenant!.id),
    });

    if (!target) {
      throw AppError.notFound('Staff member not found');
    }
    if (target.role === 'owner') {
      throw AppError.forbidden('Cannot disable the shop owner');
    }

    target.status = parsed.status;
    await target.save();

    await recordAuditLog({
      tenantId: req.tenant!.id,
      userId: req.user!.id,
      action: 'staff.status_updated',
      entity: 'User',
      entityId: target._id.toString(),
      changes: { status: parsed.status },
    });

    res.status(200).json({ data: target });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/v1/users/:id
usersRouter.delete('/:id', requirePermission('staff:write'), async (req, res, next) => {
  try {
    const userObjectId = toObjectIdParam(req.params.id, 'Staff member not found');
    if (userObjectId.toString() === req.user!.id) {
      throw AppError.forbidden('Cannot delete your own account');
    }

    const target = await UserModel.findOne({
      _id: userObjectId,
      tenantId: new Types.ObjectId(req.tenant!.id),
    });

    if (!target) {
      throw AppError.notFound('Staff member not found');
    }
    if (target.role === 'owner') {
      throw AppError.forbidden('Cannot delete the shop owner');
    }

    await UserModel.deleteOne({ _id: target._id, tenantId: new Types.ObjectId(req.tenant!.id) });

    await recordAuditLog({
      tenantId: req.tenant!.id,
      userId: req.user!.id,
      action: 'staff.deleted',
      entity: 'User',
      entityId: target._id.toString(),
      changes: { email: target.email },
    });

    res.status(200).json({ ok: true });
  } catch (err) {
    next(err);
  }
});
