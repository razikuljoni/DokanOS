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
import { RefreshTokenModel, UserModel } from '../../models/index.js';
import { requireAuth } from '../../middleware/auth.js';
import { requireTenant } from '../../middleware/tenant.js';
import { requirePermission } from '../../middleware/rbac.js';
import { AppError } from '../../utils/errors.js';
import {
  buildPaginationMeta,
  parsePagination,
  toObjectIdParam,
} from '../../utils/pagination.js';
import { recordAuditLog } from '../../utils/audit.js';
import { env } from '../../config/env.js';
import { sendResendEmail } from '../notifications/routes.js';

export const usersRouter = Router();

usersRouter.use(requireAuth, requireTenant);

// GET /api/v1/users
usersRouter.get('/', requirePermission('staff:read'), async (req, res, next) => {
  try {
    const { page, limit, skip } = parsePagination(req.query as Record<string, unknown>, 100);
    const filter = {
      tenantId: new Types.ObjectId(req.tenant!.id),
    };

    const [users, total] = await Promise.all([
      UserModel.find(filter)
        .select('-passwordHash')
        .sort({ createdAt: 1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      UserModel.countDocuments(filter),
    ]);

    res.status(200).json({
      data: users,
      meta: buildPaginationMeta(page, limit, total),
    });
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

    const rawInviteToken = crypto.randomBytes(32).toString('hex');
    const inviteTokenHash = crypto.createHash('sha256').update(rawInviteToken).digest('hex');
    const inviteExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
    const passwordHash = parsed.password ? await bcrypt.hash(parsed.password, 12) : '*';

    const created = await UserModel.create({
      name: parsed.name,
      email: parsed.email,
      passwordHash,
      role: parsed.role,
      tenantId: tenantObjectId,
      status: 'invited',
      inviteTokenHash,
      inviteExpiresAt,
    });

    const setupLink = `${env.FRONTEND_URL}/accept-invite?token=${rawInviteToken}&email=${encodeURIComponent(parsed.email)}`;

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

// POST /api/v1/users/:id/resend-invite
usersRouter.post('/:id/resend-invite', requirePermission('staff:write'), async (req, res, next) => {
  try {
    const userObjectId = toObjectIdParam(req.params.id, 'Staff member not found');
    const target = await UserModel.findOne({
      _id: userObjectId,
      tenantId: new Types.ObjectId(req.tenant!.id),
      status: 'invited',
    });
    if (!target) throw AppError.notFound('Pending invitation not found');

    const rawInviteToken = crypto.randomBytes(32).toString('hex');
    target.inviteTokenHash = crypto.createHash('sha256').update(rawInviteToken).digest('hex');
    target.inviteExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await target.save();

    const setupLink = `${env.FRONTEND_URL}/accept-invite?token=${rawInviteToken}&email=${encodeURIComponent(target.email)}`;
    await sendResendEmail({
      to: target.email,
      subject: 'Your DokanOS staff invitation',
      html: `<p>Complete your staff setup:</p><p><a href="${setupLink}">Accept invitation</a></p>`,
    });
    res.status(200).json({ data: { setupLink, email: target.email } });
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

    await RefreshTokenModel.updateMany(
      { userId: target._id, revokedAt: null },
      { $set: { revokedAt: new Date() } },
    );

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

    if (parsed.status === 'disabled') {
      await RefreshTokenModel.updateMany(
        { userId: target._id, revokedAt: null },
        { $set: { revokedAt: new Date() } },
      );
    }

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

    await RefreshTokenModel.updateMany(
      { userId: target._id, revokedAt: null },
      { $set: { revokedAt: new Date() } },
    );

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
