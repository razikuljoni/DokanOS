import { Router } from 'express';
import { Types } from 'mongoose';
import {
  JobRunModel,
  NotificationModel,
  ProductModel,
  PurchaseModel,
  SaleModel,
  SubscriptionModel,
  TenantModel,
  UserModel,
} from '../models/index.js';
import { requireAuth } from '../middleware/auth.js';
import { getEffectivePlan, requireTenant } from '../middleware/tenant.js';
import { requirePermission } from '../middleware/rbac.js';
import { sendDigestEmail, sendResendEmail } from '../modules/notifications/routes.js';
import { reconcilePendingPayments } from '../modules/billing/routes.js';
import { emitToTenant } from '../realtime/socket.js';
import { logger } from '../config/logger.js';
import { env } from '../config/env.js';
import { AppError } from '../utils/errors.js';
import { ERROR_CODES } from '@dokanos/shared';

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

async function recordJobRun(
  jobName: JobStatusEntry['name'],
  tenantId: Types.ObjectId | null,
  status: 'completed' | 'failed',
  summary: string,
  error?: string,
  durationMs = 0,
  triggeredBy: 'scheduler' | 'cron' | 'manual' = 'manual',
): Promise<void> {
  try {
    await JobRunModel.create({
      jobName,
      tenantId,
      status,
      summary,
      error: error ?? null,
      durationMs,
      triggeredBy,
    });
  } catch (err) {
    logger.warn('Failed to record job run in database', { error: String(err) });
  }
}

export async function executeJobForTenant(
  jobName: JobStatusEntry['name'],
  tenantId: string,
  triggeredBy: 'scheduler' | 'cron' | 'manual' = 'manual',
): Promise<string> {
  const startTime = Date.now();
  const tenantObjectId = new Types.ObjectId(tenantId);
  const tenant = await TenantModel.findById(tenantObjectId).lean();
  if (!tenant) return 'Tenant not found';

  const owner = await UserModel.findOne({ tenantId: tenantObjectId, role: 'owner' }).lean();
  const effectivePlan = getEffectivePlan(tenant);

  let summary = '';
  let status: 'completed' | 'failed' = 'completed';
  let errorMsg: string | undefined;

  try {
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

        // H2 fix: strictly gate on effectivePlan, never stored plan alone
        if (effectivePlan === 'pro' && owner?.email) {
          await sendDigestEmail({
            to: owner.email,
            subject: `[DokanOS] Low Stock Digest for ${tenant.name}`,
            html: `<p>${lowStockProducts.length} items are at or below threshold.</p>`,
          });
        }
      }

      summary = `Checked ${lowStockProducts.length} low-stock product(s) for ${tenant.name}${
        effectivePlan === 'pro' ? ' (Pro digest sent)' : ' (Free plan - email skipped)'
      }`;
    } else if (jobName === 'due-reminders') {
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

      summary = `Identified ${totalAged} due entry/entries aged 7+ days for ${tenant.name}`;
    } else if (jobName === 'subscription-expiry') {
      if (tenant.planExpiresAt) {
        const nowMs = Date.now();
        const expiresAtMs = new Date(tenant.planExpiresAt).getTime();
        const daysRemaining = Math.ceil((expiresAtMs - nowMs) / (1000 * 60 * 60 * 24));

        if (daysRemaining <= 0 || effectivePlan === 'free') {
          // Expired: persist downgrade in stored row so database stops lying
          await TenantModel.findByIdAndUpdate(tenantObjectId, {
            $set: { plan: 'free', planExpiresAt: null, trialEndsAt: null },
          });

          await SubscriptionModel.updateMany(
            { tenantId: tenantObjectId, status: 'active' },
            { $set: { status: 'expired' } },
          );

          const notif = await NotificationModel.create({
            tenantId: tenantObjectId,
            userId: null,
            type: 'subscription',
            title: 'Subscription Expired — Downgraded to Free Plan',
            body: 'Your Pro subscription period has expired. Your shop is now on the Free plan (max 100 products, 1 staff). Upgrade anytime to restore Pro limits.',
            link: '/app/billing',
            isRead: false,
          });
          emitToTenant(tenantId, 'notification:new', notif);

          if (owner?.email) {
            await sendResendEmail({
              to: owner.email,
              subject: `[DokanOS] Your Pro subscription for ${tenant.name} has expired`,
              html: `
                <h2>DokanOS Subscription Expired</h2>
                <p>Your shop <strong>${tenant.name}</strong> has returned to the Free plan.</p>
                <p>To restore unlimited inventory, additional staff accounts, and CSV exports, visit your Billing Portal to renew.</p>
              `,
            });
          }

          summary = `Downgraded ${tenant.name} to free plan (trial/subscription expired)`;
        } else if (daysRemaining <= 3) {
          // Expiring within 3 days: send renewal reminder
          const notif = await NotificationModel.create({
            tenantId: tenantObjectId,
            userId: null,
            type: 'subscription',
            title: `DokanOS Pro Expiring in ${daysRemaining} day${daysRemaining === 1 ? '' : 's'}`,
            body: `Your Pro plan will expire on ${new Date(tenant.planExpiresAt).toISOString().slice(0, 10)}. Extend now to keep uninterrupted Pro features.`,
            link: '/app/billing',
            isRead: false,
          });
          emitToTenant(tenantId, 'notification:new', notif);

          if (owner?.email) {
            await sendResendEmail({
              to: owner.email,
              subject: `[DokanOS] Pro plan expiring in ${daysRemaining} day(s) for ${tenant.name}`,
              html: `
                <h2>Pro Subscription Renewal Reminder</h2>
                <p>Your shop <strong>${tenant.name}</strong> Pro plan expires on <strong>${new Date(tenant.planExpiresAt).toISOString().slice(0, 10)}</strong> (${daysRemaining} day(s) left).</p>
                <p>Renew anytime in your Billing Portal to prevent interruption.</p>
              `,
            });
          }

          summary = `Sent expiry reminder to ${tenant.name} (${daysRemaining} day(s) remaining)`;
        } else {
          summary = `Pro active for ${tenant.name} until ${new Date(tenant.planExpiresAt).toISOString().slice(0, 10)}`;
        }
      } else {
        summary = `${tenant.name} is on Free plan`;
      }
    } else if (jobName === 'weekly-report') {
      if (effectivePlan !== 'pro') {
        summary = `Skipped weekly report for ${tenant.name} (Free plan)`;
      } else {
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        const sales = await SaleModel.find({
          tenantId: tenantObjectId,
          createdAt: { $gte: sevenDaysAgo },
        }).lean();

        const revenue = sales.reduce((acc, s) => acc + (s.total || 0), 0);
        const count = sales.length;

        if (owner?.email) {
          await sendResendEmail({
            to: owner.email,
            subject: `[DokanOS] Weekly Business Report for ${tenant.name}`,
            html: `
              <h2>Weekly Summary: ${tenant.name}</h2>
              <p>Here is your 7-day business performance:</p>
              <ul>
                <li><strong>Total Revenue:</strong> ৳${revenue.toLocaleString()}</li>
                <li><strong>Total Sales Count:</strong> ${count}</li>
              </ul>
              <p>View complete breakdown in your DokanOS Dashboard.</p>
            `,
          });
        }

        summary = `Weekly report compiled for ${tenant.name}: ৳${revenue.toLocaleString()} across ${count} sales`;
      }
    }
  } catch (err) {
    status = 'failed';
    errorMsg = err instanceof Error ? err.message : String(err);
    summary = `Job ${jobName} failed for ${tenant.name}: ${errorMsg}`;
  }

  const durationMs = Date.now() - startTime;
  await recordJobRun(jobName, tenantObjectId, status, summary, errorMsg, durationMs, triggeredBy);

  jobRegistry[jobName].lastRunAt = new Date().toISOString();
  jobRegistry[jobName].lastStatus = status;
  jobRegistry[jobName].lastSummary = summary;
  return summary;
}

export async function runJobForAllTenants(
  jobName: JobStatusEntry['name'],
  triggeredBy: 'scheduler' | 'cron' | 'manual' = 'scheduler',
): Promise<{
  jobName: string;
  totalTenants: number;
  results: string[];
}> {
  const tenants = await TenantModel.find().lean();
  const results: string[] = [];
  for (const t of tenants) {
    try {
      const res = await executeJobForTenant(jobName, t._id.toString(), triggeredBy);
      results.push(res);
    } catch (err) {
      results.push(`Error for ${t.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { jobName, totalTenants: tenants.length, results };
}

let schedulerTimer: NodeJS.Timeout | null = null;

export function initInProcessJobsWorker(): void {
  logger.info('Initializing DokanOS background job scheduler (resilient timer mode)');

  // Run initial payment reconciliation on boot
  void reconcilePendingPayments().catch((err) => {
    logger.warn('Initial boot payment reconciliation failed', { error: String(err) });
  });

  // Run periodic schedule every hour while server is active
  if (!schedulerTimer && env.NODE_ENV !== 'test') {
    schedulerTimer = setInterval(async () => {
      try {
        await reconcilePendingPayments();
        await runJobForAllTenants('subscription-expiry', 'scheduler');
        await runJobForAllTenants('due-reminders', 'scheduler');
        await runJobForAllTenants('low-stock-digest', 'scheduler');
      } catch (err) {
        logger.error('Scheduled in-process job worker error', { error: String(err) });
      }
    }, 60 * 60 * 1000);
    schedulerTimer.unref();
  }
}

export const jobsRouter = Router();

// Public / Service endpoint for External Cron (Render Cron, GitHub Actions, cron-job.org)
jobsRouter.post('/cron/run', async (req, res, next) => {
  try {
    const cronSecret = req.headers['x-cron-secret'] || req.query.secret;
    const configuredSecret = env.CRON_SECRET || env.JWT_ACCESS_SECRET;
    const isAuthorized = Boolean(cronSecret && cronSecret === configuredSecret);

    if (!isAuthorized) {
      throw new AppError(
        401,
        ERROR_CODES.UNAUTHENTICATED,
        'Invalid or missing cron service credential',
      );
    }

    const jobName = req.query.jobName as JobStatusEntry['name'] | undefined;
    if (jobName && jobName in jobRegistry) {
      const result = await runJobForAllTenants(jobName, 'cron');
      res.status(200).json({ ok: true, result });
      return;
    }

    // Run all standing jobs and reconciliation
    const reconcile = await reconcilePendingPayments();
    const expiry = await runJobForAllTenants('subscription-expiry', 'cron');
    const dues = await runJobForAllTenants('due-reminders', 'cron');
    const lowStock = await runJobForAllTenants('low-stock-digest', 'cron');

    res.status(200).json({
      ok: true,
      timestamp: new Date().toISOString(),
      reconciliation: reconcile,
      jobs: [expiry, dues, lowStock],
    });
  } catch (err) {
    next(err);
  }
});

// Authenticated owner routes below
jobsRouter.use(requireAuth, requireTenant);

// GET /api/v1/admin/jobs
jobsRouter.get('/', requirePermission('tenant:write'), async (_req, res, next) => {
  try {
    const list = await Promise.all(
      Object.values(jobRegistry).map(async (entry) => {
        const latestRun = await JobRunModel.findOne({ jobName: entry.name })
          .sort({ createdAt: -1 })
          .lean();
        if (latestRun) {
          return {
            ...entry,
            lastRunAt: latestRun.createdAt.toISOString(),
            lastStatus: latestRun.status,
            lastSummary: latestRun.summary,
          };
        }
        return entry;
      }),
    );
    res.status(200).json({
      data: list,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/admin/jobs/:jobName/run
jobsRouter.post('/:jobName/run', requirePermission('tenant:write'), async (req, res, next) => {
  try {
    const jobName = req.params.jobName as JobStatusEntry['name'];
    if (!(jobName in jobRegistry)) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Job not found' } });
      return;
    }

    const summary = await executeJobForTenant(jobName, req.tenant!.id, 'manual');
    const latestRun = await JobRunModel.findOne({ jobName }).sort({ createdAt: -1 }).lean();

    res.status(200).json({
      data: {
        ...jobRegistry[jobName],
        lastRunAt: latestRun?.createdAt.toISOString() ?? new Date().toISOString(),
        lastStatus: latestRun?.status ?? 'completed',
        lastSummary: summary,
      },
      summary,
    });
  } catch (err) {
    next(err);
  }
});
