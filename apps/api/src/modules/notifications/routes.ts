import { Router } from 'express';
import { Types } from 'mongoose';
import { Resend } from 'resend';
import { NotificationModel } from '../../models/index.js';
import { requireAuth } from '../../middleware/auth.js';
import { requireTenant } from '../../middleware/tenant.js';
import { requirePermission } from '../../middleware/rbac.js';
import { buildPaginationMeta, parsePagination, toObjectIdParam } from '../../utils/pagination.js';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';

// §8 SMS Provider seam — no-op implementation by design (no free SMS tier in Bangladesh)
export interface SmsProvider {
  sendSms(phone: string, message: string): Promise<{ sent: boolean; provider: string }>;
}

export class NoOpSmsProvider implements SmsProvider {
  async sendSms(phone: string, _message: string): Promise<{ sent: boolean; provider: string }> {
    logger.info('NoOpSmsProvider invoked (SMS is disabled on free tier)', { phone });
    return { sent: false, provider: 'noop' };
  }
}

export const smsProvider: SmsProvider = new NoOpSmsProvider();

// §8 Resend Email helper (Pro only for digests/reminders)
export async function sendDigestEmail(params: {
  to: string;
  subject: string;
  html: string;
}): Promise<boolean> {
  if (!env.RESEND_API_KEY || env.RESEND_API_KEY === 're_placeholder_key') {
    logger.info('Resend API key not configured; email digest logged locally', {
      to: params.to,
      subject: params.subject,
    });
    return false;
  }

  try {
    const resend = new Resend(env.RESEND_API_KEY);
    await resend.emails.send({
      from: 'DokanOS <onboarding@resend.dev>',
      to: params.to,
      subject: params.subject,
      html: params.html,
    });
    return true;
  } catch (err) {
    logger.warn('Failed to send Resend email', {
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

export const notificationsRouter = Router();

notificationsRouter.use(requireAuth, requireTenant);

// GET /api/v1/notifications/unread-count
notificationsRouter.get(
  '/unread-count',
  requirePermission('notifications:read'),
  async (req, res, next) => {
    try {
      const tenantObjectId = new Types.ObjectId(req.tenant!.id);
      const userObjectId = new Types.ObjectId(req.user!.id);

      const count = await NotificationModel.countDocuments({
        tenantId: tenantObjectId,
        $or: [{ userId: null }, { userId: userObjectId }],
        isRead: false,
      });

      res.status(200).json({ data: { unreadCount: count } });
    } catch (err) {
      next(err);
    }
  },
);

// GET /api/v1/notifications
notificationsRouter.get('/', requirePermission('notifications:read'), async (req, res, next) => {
  try {
    const { page, limit, skip } = parsePagination(req.query as Record<string, unknown>);
    const tenantObjectId = new Types.ObjectId(req.tenant!.id);
    const userObjectId = new Types.ObjectId(req.user!.id);

    const filter = {
      tenantId: tenantObjectId,
      $or: [{ userId: null }, { userId: userObjectId }],
    };

    const [items, total] = await Promise.all([
      NotificationModel.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      NotificationModel.countDocuments(filter),
    ]);

    res.status(200).json({
      data: items,
      meta: buildPaginationMeta(page, limit, total),
    });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/v1/notifications/read-all
notificationsRouter.patch(
  '/read-all',
  requirePermission('notifications:read'),
  async (req, res, next) => {
    try {
      const tenantObjectId = new Types.ObjectId(req.tenant!.id);
      const userObjectId = new Types.ObjectId(req.user!.id);

      await NotificationModel.updateMany(
        {
          tenantId: tenantObjectId,
          $or: [{ userId: null }, { userId: userObjectId }],
          isRead: false,
        },
        { $set: { isRead: true } },
      );

      res.status(200).json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
);

// PATCH /api/v1/notifications/:id/read
notificationsRouter.patch(
  '/:id/read',
  requirePermission('notifications:read'),
  async (req, res, next) => {
    try {
      const notifObjectId = toObjectIdParam(req.params.id, 'Notification not found');
      const updated = await NotificationModel.findOneAndUpdate(
        {
          _id: notifObjectId,
          tenantId: new Types.ObjectId(req.tenant!.id),
        },
        { $set: { isRead: true } },
        { new: true },
      ).lean();

      res.status(200).json({ data: updated });
    } catch (err) {
      next(err);
    }
  },
);
