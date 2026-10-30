import { Router, type Request } from 'express';
import mongoose, { Types } from 'mongoose';
import axios from 'axios';
import Stripe from 'stripe';
import {
  ERROR_CODES,
  PLAN_LIMITS,
  PRO_PRICE_BDT,
  type PlanType,
} from '@dokanos/shared';
import {
  NotificationModel,
  PaymentModel,
  ProductModel,
  SubscriptionModel,
  TenantModel,
  UserModel,
} from '../../models/index.js';
import { requireAuth, type TenantContext } from '../../middleware/auth.js';
import { requireTenant } from '../../middleware/tenant.js';
import { requirePermission } from '../../middleware/rbac.js';
import { AppError } from '../../utils/errors.js';
import { env } from '../../config/env.js';
import { emitToTenant } from '../../realtime/socket.js';
import { recordAuditLog } from '../../utils/audit.js';

// §7 Single BillingProvider interface
export interface CheckoutSessionResult {
  provider: 'sslcommerz' | 'stripe' | 'bkash';
  gatewayUrl: string;
  tranId: string;
  mode: 'sandbox' | 'test';
}

export interface BillingProvider {
  createCheckout(
    tenant: TenantContext,
    user: { name: string; email: string },
    plan: PlanType,
  ): Promise<CheckoutSessionResult>;
  handleWebhook(req: Request): Promise<{ processed: boolean; duplicate: boolean; tranId: string }>;
  getSubscription(tenantId: string): Promise<unknown>;
}

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Validates and applies an SSLCommerz payment idempotently.
 * Uses unique index { provider: 'sslcommerz', eventId: tran_id } and atomic status transition
 * from 'pending' -> 'paid' so a replayed callback or IPN never double-extends the 30-day Pro period.
 */
export async function validateAndApplySslCommerzPayment(params: {
  tranId: string;
  valId?: string;
  amount?: number;
  currency?: string;
  rawPayload?: Record<string, unknown>;
}): Promise<{ processed: boolean; duplicate: boolean; tranId: string }> {
  const { tranId, valId, rawPayload = {} } = params;

  const existingPayment = await PaymentModel.findOne({
    provider: 'sslcommerz',
    eventId: tranId,
  }).lean();

  if (!existingPayment) {
    throw AppError.notFound(`Payment transaction '${tranId}' not found`);
  }

  // Idempotency guard: if already marked paid, return immediately without extending plan again
  if (existingPayment.status === 'paid') {
    return { processed: true, duplicate: true, tranId };
  }

  // Server-side validation with SSLCommerz validation API (or sandbox test validation)
  let validatedStatus = 'VALID';
  let validatedAmount = existingPayment.amount;
  let validatedCurrency = existingPayment.currency;

  if (valId && env.SSLCZ_STORE_ID !== 'testbox' && env.NODE_ENV === 'production') {
    const valUrl = `https://sandbox.sslcommerz.com/validator/api/validationserverAPI.php?val_id=${encodeURIComponent(
      valId,
    )}&store_id=${encodeURIComponent(env.SSLCZ_STORE_ID)}&store_passwd=${encodeURIComponent(
      env.SSLCZ_STORE_PASSWD,
    )}&v=1&format=json`;
    const response = await axios.get<{
      status?: string;
      tran_id?: string;
      amount?: string | number;
      currency_type?: string;
    }>(valUrl, { timeout: 8000 });

    validatedStatus = response.data.status ?? 'FAILED';
    validatedAmount = Number(response.data.amount ?? 0);
    validatedCurrency = response.data.currency_type ?? 'BDT';
  } else {
    // In sandbox/test mode, verify that any supplied amount/currency matches the stored payment row
    if (params.amount !== undefined && Number(params.amount) !== existingPayment.amount) {
      throw AppError.badRequest('Validated amount does not match stored Payment record');
    }
    if (params.currency !== undefined && params.currency !== existingPayment.currency) {
      throw AppError.badRequest('Validated currency does not match stored Payment record');
    }
  }

  if (validatedStatus !== 'VALID' && validatedStatus !== 'VALIDATED') {
    await PaymentModel.updateOne(
      { _id: existingPayment._id, status: 'pending' },
      { $set: { status: 'failed', raw: rawPayload } },
    );
    throw AppError.badRequest('SSLCommerz validation failed');
  }

  if (validatedAmount !== existingPayment.amount || validatedCurrency !== existingPayment.currency) {
    throw AppError.badRequest('SSLCommerz transaction amount or currency mismatch');
  }

  const session = await mongoose.startSession();
  let wasUpdated = false;

  try {
    await session.withTransaction(async () => {
      // Atomic conditional transition: only transition if status is currently 'pending'
      const paymentUpdate = await PaymentModel.findOneAndUpdate(
        {
          provider: 'sslcommerz',
          eventId: tranId,
          status: 'pending',
        },
        {
          $set: {
            status: 'paid',
            raw: rawPayload,
          },
        },
        { session, new: true },
      );

      if (!paymentUpdate) {
        wasUpdated = false;
        return;
      }

      wasUpdated = true;
      const tenant = await TenantModel.findById(existingPayment.tenantId).session(session);
      if (!tenant) {
        throw AppError.notFound('Tenant not found for payment');
      }

      const baseDate =
        tenant.plan === 'pro' &&
        tenant.planExpiresAt &&
        tenant.planExpiresAt.getTime() > Date.now()
          ? tenant.planExpiresAt.getTime()
          : Date.now();

      const newExpiresAt = new Date(baseDate + THIRTY_DAYS_MS);
      tenant.plan = 'pro';
      tenant.planExpiresAt = newExpiresAt;
      await tenant.save({ session });

      await SubscriptionModel.findOneAndUpdate(
        { tenantId: tenant._id, provider: 'sslcommerz' },
        {
          $set: {
            plan: 'pro',
            status: 'active',
            currentPeriodEnd: newExpiresAt,
            providerSubscriptionId: null,
          },
        },
        { upsert: true, new: true, session },
      );

      const [notification] = await NotificationModel.create(
        [
          {
            tenantId: tenant._id,
            userId: null,
            type: 'subscription',
            title: 'Upgraded to DokanOS Pro',
            body: `Your shop is now on the Pro plan (valid until ${newExpiresAt.toISOString().slice(0, 10)}).`,
            link: '/app/billing',
            isRead: false,
          },
        ],
        { session },
      );

      emitToTenant(tenant._id.toString(), 'notification:new', notification);
    });
  } finally {
    await session.endSession();
  }

  return {
    processed: true,
    duplicate: !wasUpdated,
    tranId,
  };
}

// 1. SSLCommerz Sandbox Provider (PRIMARY)
class SslCommerzBillingProvider implements BillingProvider {
  async createCheckout(
    tenant: TenantContext,
    user: { name: string; email: string },
  ): Promise<CheckoutSessionResult> {
    const tranId = `DKN-${tenant.slug.toUpperCase().slice(0, 10)}-${Date.now()}`;

    await PaymentModel.create({
      tenantId: new Types.ObjectId(tenant.id),
      provider: 'sslcommerz',
      providerRef: tranId,
      eventId: tranId,
      amount: PRO_PRICE_BDT,
      currency: 'BDT',
      status: 'pending',
      purpose: 'subscription',
      raw: { initiatedBy: user.email },
    });

    // Attempt live sandbox call if reachable; fall back to local sandbox simulator redirect so demo works offline/in container
    let gatewayUrl = `/app/billing?sandbox_checkout=sslcommerz&tran_id=${encodeURIComponent(tranId)}&amount=${PRO_PRICE_BDT}`;

    if (env.NODE_ENV === 'production' && env.SSLCZ_STORE_ID !== 'testbox') {
      try {
        const formData = new URLSearchParams({
          store_id: env.SSLCZ_STORE_ID,
          store_passwd: env.SSLCZ_STORE_PASSWD,
          total_amount: String(PRO_PRICE_BDT),
          currency: 'BDT',
          tran_id: tranId,
          success_url: env.SSLCZ_SUCCESS_URL,
          fail_url: env.SSLCZ_FAIL_URL,
          cancel_url: env.SSLCZ_CANCEL_URL,
          ipn_url: env.SSLCZ_IPN_URL,
          cus_name: user.name,
          cus_email: user.email,
          cus_phone: '01700000000',
          product_name: 'DokanOS Pro (30 days)',
          product_category: 'Subscription',
          product_profile: 'non-physical-goods',
        });

        const resp = await axios.post<{ status?: string; GatewayPageURL?: string }>(
          'https://sandbox.sslcommerz.com/gwprocess/v4/api.php',
          formData.toString(),
          {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            timeout: 5000,
          },
        );
        if (resp.data?.GatewayPageURL) {
          gatewayUrl = resp.data.GatewayPageURL;
        }
      } catch {
        // Fallback to built-in SSLCommerz Sandbox test card modal
      }
    }

    return {
      provider: 'sslcommerz',
      gatewayUrl,
      tranId,
      mode: 'sandbox',
    };
  }

  async handleWebhook(
    req: Request,
  ): Promise<{ processed: boolean; duplicate: boolean; tranId: string }> {
    const body = req.body as Record<string, unknown>;
    const tranId = String(body.tran_id ?? req.query.tran_id ?? '');
    const valId = body.val_id ? String(body.val_id) : undefined;
    const amount = body.amount !== undefined ? Number(body.amount) : undefined;
    const currency = body.currency ? String(body.currency) : undefined;

    if (!tranId) {
      throw AppError.badRequest('tran_id is required');
    }

    return validateAndApplySslCommerzPayment({
      tranId,
      valId,
      amount,
      currency,
      rawPayload: body,
    });
  }

  async getSubscription(tenantId: string): Promise<unknown> {
    return SubscriptionModel.findOne({
      tenantId: new Types.ObjectId(tenantId),
      provider: 'sslcommerz',
    }).lean();
  }
}

// 2. Stripe Test Mode Provider (SECONDARY)
class StripeTestBillingProvider implements BillingProvider {
  async createCheckout(
    tenant: TenantContext,
    user: { name: string; email: string },
  ): Promise<CheckoutSessionResult> {
    const tranId = `STRIPE-${tenant.slug.toUpperCase().slice(0, 8)}-${Date.now()}`;

    await PaymentModel.create({
      tenantId: new Types.ObjectId(tenant.id),
      provider: 'stripe',
      providerRef: tranId,
      eventId: tranId,
      amount: PRO_PRICE_BDT,
      currency: 'BDT',
      status: 'pending',
      purpose: 'subscription',
      raw: { initiatedBy: user.email, testMode: true },
    });

    const gatewayUrl = `/app/billing?sandbox_checkout=stripe&tran_id=${encodeURIComponent(tranId)}&amount=${PRO_PRICE_BDT}`;

    return {
      provider: 'stripe',
      gatewayUrl,
      tranId,
      mode: 'test',
    };
  }

  async handleWebhook(
    req: Request,
  ): Promise<{ processed: boolean; duplicate: boolean; tranId: string }> {
    const body = req.body as {
      id?: string;
      type?: string;
      data?: { object?: { client_reference_id?: string; metadata?: { tranId?: string } } };
      tran_id?: string;
    };

    // If Stripe webhook signature header is present and real secret configured, verify signature
    const sig = req.headers['stripe-signature'];
    if (
      typeof sig === 'string' &&
      env.STRIPE_SECRET_KEY &&
      env.STRIPE_WEBHOOK_SECRET &&
      env.STRIPE_WEBHOOK_SECRET !== 'whsec_placeholder'
    ) {
      const stripe = new Stripe(env.STRIPE_SECRET_KEY);
      stripe.webhooks.constructEvent(JSON.stringify(req.body), sig, env.STRIPE_WEBHOOK_SECRET);
    }

    const tranId =
      body.tran_id ??
      body.data?.object?.metadata?.tranId ??
      body.data?.object?.client_reference_id ??
      body.id ??
      '';

    if (!tranId) {
      throw AppError.badRequest('Missing Stripe event reference or tran_id');
    }

    const existing = await PaymentModel.findOne({ provider: 'stripe', eventId: tranId });
    if (!existing) {
      throw AppError.notFound('Stripe payment record not found');
    }

    if (existing.status === 'paid') {
      return { processed: true, duplicate: true, tranId };
    }

    existing.status = 'paid';
    await existing.save();

    const newExpiresAt = new Date(Date.now() + THIRTY_DAYS_MS);
    await TenantModel.findByIdAndUpdate(existing.tenantId, {
      $set: { plan: 'pro', planExpiresAt: newExpiresAt },
    });

    await SubscriptionModel.findOneAndUpdate(
      { tenantId: existing.tenantId, provider: 'stripe' },
      {
        $set: {
          plan: 'pro',
          status: 'active',
          currentPeriodEnd: newExpiresAt,
          providerSubscriptionId: tranId,
        },
      },
      { upsert: true },
    );

    return { processed: true, duplicate: false, tranId };
  }

  async getSubscription(tenantId: string): Promise<unknown> {
    return SubscriptionModel.findOne({
      tenantId: new Types.ObjectId(tenantId),
      provider: 'stripe',
    }).lean();
  }
}

/**
 * 3. bKash Provider — STUB ONLY per §7
 * Tokenized Checkout Flow (grant-token -> create -> redirect -> execute -> query):
 * 1. POST /tokenized/checkout/token/grant with app_key & app_secret in body and username/password in headers -> id_token.
 * 2. POST /tokenized/checkout/create with mode="0011", payerReference, callbackURL, amount, currency="BDT", intent="sale", merchantInvoiceNumber -> bkashURL & paymentID.
 * 3. Redirect customer to bkashURL to enter wallet number, OTP, and PIN.
 * 4. On callback with paymentID & status=success, POST /tokenized/checkout/execute with { paymentID } using Bearer id_token.
 * 5. If execute times out or is uncertain, POST /tokenized/checkout/payment/status with { paymentID } to verify transactionStatus === "Completed".
 * Note: Not wired to live/sandbox because bKash sandbox requires Merchant Integration Portal approval and live requires Trade License, TIN, Bank Account, and IP whitelisting.
 */
class BkashStubBillingProvider implements BillingProvider {
  async createCheckout(): Promise<CheckoutSessionResult> {
    throw new AppError(
      501,
      ERROR_CODES.NOT_CONFIGURED,
      'bKash Tokenized Checkout requires merchant portal onboarding and IP whitelisting. Use SSLCommerz Sandbox or Stripe Test Mode for the demo.',
    );
  }

  async handleWebhook(): Promise<{ processed: boolean; duplicate: boolean; tranId: string }> {
    throw new AppError(501, ERROR_CODES.NOT_CONFIGURED, 'bKash webhook stub not configured');
  }

  async getSubscription(): Promise<unknown> {
    return null;
  }
}

const sslCommerzProvider: BillingProvider = new SslCommerzBillingProvider();
const stripeProvider: BillingProvider = new StripeTestBillingProvider();
const bkashStubProvider: BillingProvider = new BkashStubBillingProvider();

export const billingRouter = Router();

// Public SSLCommerz callbacks & IPN (do not require Bearer header because gateway redirects/POSTs directly)
billingRouter.post('/sslcommerz/success', async (req, res, next) => {
  try {
    const result = await sslCommerzProvider.handleWebhook(req);
    if (req.headers.accept?.includes('application/json') || req.query.format === 'json') {
      res.status(200).json({ data: result });
      return;
    }
    res.redirect(`/app/billing?status=success&tran_id=${encodeURIComponent(result.tranId)}`);
  } catch (err) {
    next(err);
  }
});

billingRouter.post('/sslcommerz/ipn', async (req, res, next) => {
  try {
    const result = await sslCommerzProvider.handleWebhook(req);
    res.status(200).json({ data: result });
  } catch (err) {
    next(err);
  }
});

billingRouter.post('/sslcommerz/fail', async (req, res, next) => {
  try {
    const tranId = String((req.body as { tran_id?: string })?.tran_id ?? req.query.tran_id ?? '');
    if (tranId) {
      await PaymentModel.updateOne(
        { provider: 'sslcommerz', eventId: tranId, status: 'pending' },
        { $set: { status: 'failed' } },
      );
    }
    res.status(200).json({ data: { status: 'failed', tranId } });
  } catch (err) {
    next(err);
  }
});

billingRouter.post('/sslcommerz/cancel', async (req, res, next) => {
  try {
    const tranId = String((req.body as { tran_id?: string })?.tran_id ?? req.query.tran_id ?? '');
    if (tranId) {
      await PaymentModel.updateOne(
        { provider: 'sslcommerz', eventId: tranId, status: 'pending' },
        { $set: { status: 'failed' } },
      );
    }
    res.status(200).json({ data: { status: 'cancelled', tranId } });
  } catch (err) {
    next(err);
  }
});

// Public Stripe webhook
billingRouter.post('/stripe/webhook', async (req, res, next) => {
  try {
    const result = await stripeProvider.handleWebhook(req);
    res.status(200).json({ data: result });
  } catch (err) {
    next(err);
  }
});

// Authenticated owner routes below
billingRouter.use(requireAuth, requireTenant);

// GET /api/v1/billing/plan
billingRouter.get('/plan', requirePermission('billing:read'), async (req, res, next) => {
  try {
    const tenantObjectId = new Types.ObjectId(req.tenant!.id);
    const [tenant, productCount, staffCount, payments, subscriptions] = await Promise.all([
      TenantModel.findById(tenantObjectId).lean(),
      ProductModel.countDocuments({ tenantId: tenantObjectId, isActive: true }),
      UserModel.countDocuments({
        tenantId: tenantObjectId,
        role: { $in: ['manager', 'staff'] },
        status: { $ne: 'disabled' },
      }),
      PaymentModel.find({ tenantId: tenantObjectId }).sort({ createdAt: -1 }).limit(20).lean(),
      SubscriptionModel.find({ tenantId: tenantObjectId }).sort({ updatedAt: -1 }).lean(),
    ]);

    const currentPlan = req.tenant!.plan;
    const limits = PLAN_LIMITS[currentPlan];

    res.status(200).json({
      data: {
        plan: currentPlan,
        priceBdt: PRO_PRICE_BDT,
        planExpiresAt: tenant?.planExpiresAt ?? null,
        limits: {
          maxProducts: Number.isFinite(limits.maxProducts) ? limits.maxProducts : null,
          maxStaff: limits.maxStaff,
          csvImportExport: limits.csvImportExport,
          emailDigests: limits.emailDigests,
        },
        usage: {
          productCount,
          staffCount,
        },
        payments,
        subscriptions,
      },
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/billing/sslcommerz/init
billingRouter.post(
  '/sslcommerz/init',
  requirePermission('billing:write'),
  async (req, res, next) => {
    try {
      const checkout = await sslCommerzProvider.createCheckout(
        req.tenant!,
        { name: req.user!.name, email: req.user!.email },
        'pro',
      );
      res.status(201).json({
        data: {
          GatewayPageURL: checkout.gatewayUrl,
          tranId: checkout.tranId,
          provider: checkout.provider,
          mode: checkout.mode,
          amount: PRO_PRICE_BDT,
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

// POST /api/v1/billing/stripe/checkout
billingRouter.post(
  '/stripe/checkout',
  requirePermission('billing:write'),
  async (req, res, next) => {
    try {
      const checkout = await stripeProvider.createCheckout(
        req.tenant!,
        { name: req.user!.name, email: req.user!.email },
        'pro',
      );
      res.status(201).json({
        data: {
          checkoutUrl: checkout.gatewayUrl,
          tranId: checkout.tranId,
          provider: checkout.provider,
          mode: checkout.mode,
          amount: PRO_PRICE_BDT,
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

// POST /api/v1/billing/bkash/init (stub)
billingRouter.post('/bkash/init', requirePermission('billing:write'), async (req, res, next) => {
  try {
    await bkashStubProvider.createCheckout(
      req.tenant!,
      { name: req.user!.name, email: req.user!.email },
      'pro',
    );
    res.status(501).json({});
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/billing/cancel
billingRouter.post('/cancel', requirePermission('billing:write'), async (req, res, next) => {
  try {
    const tenantObjectId = new Types.ObjectId(req.tenant!.id);
    await SubscriptionModel.updateMany(
      { tenantId: tenantObjectId, status: 'active' },
      { $set: { status: 'cancelled' } },
    );

    // Downgrade to free if requested immediately in demo
    const immediate = Boolean((req.body as { immediate?: boolean } | undefined)?.immediate);
    if (immediate) {
      await TenantModel.findByIdAndUpdate(tenantObjectId, {
        $set: { plan: 'free', planExpiresAt: null },
      });
    }

    await recordAuditLog({
      tenantId: req.tenant!.id,
      userId: req.user!.id,
      action: 'plan.cancelled',
      entity: 'Subscription',
      entityId: req.tenant!.id,
      changes: { immediate },
    });

    res.status(200).json({ ok: true });
  } catch (err) {
    next(err);
  }
});
