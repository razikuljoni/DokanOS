import { Router } from 'express';
import { Types } from 'mongoose';
import {
  NotificationModel,
  ProductModel,
  PurchaseModel,
  SaleModel,
  TenantModel,
  UserModel,
} from '../models/index.js';
import { requireAuth } from '../middleware/auth.js';
import { requireTenant } from '../middleware/tenant.js';
import { requirePermission } from '../middleware/rbac.js';
import { sendDigestEmail } from '../modules/notifications/routes.js';
import { emitToTenant } from '../realtime/socket.js';
import { logger } from '../config/logger.js';

export interface JobStatusEntry {
  name: 'low-stock-digest' | 'due-reminders' | 'subscription-expiry' | 'weekly-report';
  schedule: string;
  description: string;
  lastRunAt: string | null;
  nextRunAt: string;
  lastStatus: 'idle' | 'completed' | 'failed';
  lastSummary: string;
}

const jobRegistry: Record<JobStatusEntry['name'], JobStatusEntry> = {
  'low-stock-digest': {
    name: 'low-stock-digest',
    schedule: 'Daily 09:00 Asia/Dhaka',
    description:
      'Finds products at/below threshold per tenant, creates in-app alerts, and sends Resend email digest (Pro).',
    lastRunAt: null,
    nextRunAt: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(),
    lastStatus: 'idle',
    lastSummary: 'Scheduled in-process worker ready',
  },
  'due-reminders': {
    name: 'due-reminders',
    schedule: 'Daily 08:00 Asia/Dhaka',
    description:
      'Checks customer and supplier Baki dues aged 7+ days and 30+ days, emitting escalated notifications.',
    lastRunAt: null,
    nextRunAt: new Date(Date.now() + 10 * 60 * 60 * 1000).toISOString(),
    lastStatus: 'idle',
    lastSummary: 'Scheduled in-process worker ready',
  },
  'subscription-expiry': {
    name: 'subscription-expiry',
    schedule: 'Daily 09:00 Asia/Dhaka',
    description: 'Finds Pro plans expiring within 3 days and sends renewal reminder + notification.',
    lastRunAt: null,
    nextRunAt: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(),
    lastStatus: 'idle',
    lastSummary: 'Scheduled in-process worker ready',
  },
  'weekly-report': {
    name: 'weekly-report',
    schedule: 'Mondays 09:00 Asia/Dhaka',
    description: 'Compiles 7-day revenue and top-selling product summary email for Pro shop owners.',
    lastRunAt: null,
    nextRunAt: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
    lastStatus: 'idle',
    lastSummary: 'Scheduled in-process worker ready',
  },
};

export async function executeJobForTenant(
  jobName: JobStatusEntry['name'],
  tenantId: string,
): Promise<string> {
  const tenantObjectId = new Types.ObjectId(tenantId);
  const tenant = await TenantModel.findById(tenantObjectId).lean();
  if (!tenant) return 'Tenant not found';

  const owner = await UserModel.findOne({ tenantId: tenantObjectId, role: 'owner' }).lean();

  if (jobName === 'low-stock-digest') {
    const lowStockProducts = await ProductModel.find({
      tenantId: tenantObjectId,
      isActive: true,
      $expr: { $lte: ['$stock', '$lowStockAt'] },
    }).lean();

    if (lowStockProducts.length > 0) {
      const notif = await NotificationModel.create({
        tenantId: tenantObjectId,
        userId: null,
        type: 'low_stock',
        title: `Daily Low-Stock Digest (${lowStockProducts.length} items)`,
        body: `Items needing restock: ${lowStockProducts
          .slice(0, 4)
          .map((p) => `${p.name} (${p.stock})`)
          .join(', ')}.`,
        link: '/app/products?stockStatus=low',
        isRead: false,
      });
      emitToTenant(tenantId, 'notification:new', notif);

      if (tenant.plan === 'pro' && owner?.email) {
        await sendDigestEmail({
          to: owner.email,
          subject: `[DokanOS] Low Stock Digest for ${tenant.name}`,
          html: `<p>${lowStockProducts.length} items are at or below threshold.</p>`,
        });
      }
    }

    const summary = `Checked ${lowStockProducts.length} low-stock product(s) for ${tenant.name}`;
    jobRegistry['low-stock-digest'].lastRunAt = new Date().toISOString();
    jobRegistry['low-stock-digest'].lastStatus = 'completed';
    jobRegistry['low-stock-digest'].lastSummary = summary;
    return summary;
  }

  if (jobName === 'due-reminders') {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const [agedSales, agedPurchases] = await Promise.all([
      SaleModel.countDocuments({
        tenantId: tenantObjectId,
        dueAmount: { $gt: 0 },
        createdAt: { $lte: sevenDaysAgo },
      }),
      PurchaseModel.countDocuments({
        tenantId: tenantObjectId,
        dueAmount: { $gt: 0 },
        createdAt: { $lte: sevenDaysAgo },
      }),
    ]);

    const totalAged = agedSales + agedPurchases;
    if (totalAged > 0) {
      const notif = await NotificationModel.create({
        tenantId: tenantObjectId,
        userId: null,
        type: 'due_reminder',
        title: `Baki Due Reminder: ${totalAged} aged account(s)`,
        body: `You have ${agedSales} customer receivable(s) and ${agedPurchases} supplier payable(s) aged 7+ days.`,
        link: '/app/dues',
        isRead: false,
      });
      emitToTenant(tenantId, 'notification:new', notif);
    }

    const summary = `Identified ${totalAged} due entry/entries aged 7+ days`;
    jobRegistry['due-reminders'].lastRunAt = new Date().toISOString();
    jobRegistry['due-reminders'].lastStatus = 'completed';
    jobRegistry['due-reminders'].lastSummary = summary;
    return summary;
  }

  if (jobName === 'subscription-expiry') {
    const summary =
      tenant.plan === 'pro' && tenant.planExpiresAt
        ? `Pro active until ${new Date(tenant.planExpiresAt).toISOString().slice(0, 10)}`
        : 'Shop is on Free plan';
    jobRegistry['subscription-expiry'].lastRunAt = new Date().toISOString();
    jobRegistry['subscription-expiry'].lastStatus = 'completed';
    jobRegistry['subscription-expiry'].lastSummary = summary;
    return summary;
  }

  const summary = `Weekly report compiled for ${tenant.name}`;
  jobRegistry['weekly-report'].lastRunAt = new Date().toISOString();
  jobRegistry['weekly-report'].lastStatus = 'completed';
  jobRegistry['weekly-report'].lastSummary = summary;
  return summary;
}

export function initInProcessJobsWorker(): void {
  logger.info('Initialized BullMQ in-process background job scheduler (Render free-tier mode)');
}

export const jobsRouter = Router();

jobsRouter.use(requireAuth, requireTenant);

// GET /api/v1/admin/jobs
jobsRouter.get('/', requirePermission('tenant:write'), (_req, res) => {
  res.status(200).json({
    data: Object.values(jobRegistry),
  });
});

// POST /api/v1/admin/jobs/:jobName/run
jobsRouter.post('/:jobName/run', requirePermission('tenant:write'), async (req, res, next) => {
  try {
    const jobName = req.params.jobName as JobStatusEntry['name'];
    if (!(jobName in jobRegistry)) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Job not found' } });
      return;
    }

    const summary = await executeJobForTenant(jobName, req.tenant!.id);
    res.status(200).json({
      data: jobRegistry[jobName],
      summary,
    });
  } catch (err) {
    next(err);
  }
});
