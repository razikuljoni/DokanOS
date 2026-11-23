import { Router, type Request } from 'express';
import mongoose, { Types } from 'mongoose';
import axios from 'axios';
import Stripe from 'stripe';
import rateLimit from 'express-rate-limit';
import {
  BILLING_PERIODS,
  BILLING_PERIOD_DAYS,
  BILLING_PERIOD_PRICE_BDT,
  ERROR_CODES,
  PLAN_LIMITS,
  PRO_PRICE_ANNUAL_BDT,
  PRO_PRICE_BDT,
  type BillingPeriod,
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
import { logger } from '../../config/logger.js';
import { emitToTenant } from '../../realtime/socket.js';
import { recordAuditLog } from '../../utils/audit.js';
import { sendResendEmail } from '../notifications/routes.js';

// §7 Single BillingProvider interface
export interface CheckoutSessionResult {
  provider: 'sslcommerz' | 'stripe' | 'bkash';
  gatewayUrl: string;
  tranId: string;
  mode: 'sandbox' | 'test' | 'live';
}

export interface CustomerCheckoutInfo {
  phone?: string;
  address?: string;
  city?: string;
}

export interface BillingProvider {
  createCheckout(
    tenant: TenantContext,
    user: { name: string; email: string },
    plan: PlanType,
    period: BillingPeriod,
    customerInfo?: CustomerCheckoutInfo,
  ): Promise<CheckoutSessionResult>;
  handleWebhook(req: Request): Promise<{ processed: boolean; duplicate: boolean; tranId: string }>;
  getSubscription(tenantId: string): Promise<unknown>;
}

interface PaymentReceiptInfo {
  shopName: string;
  amount: number;
  currency: string;
  period: BillingPeriod;
  tranId: string;
  expiresAt: Date;
  recipientEmail?: string;
}

export async function sendPaymentReceiptEmail(params: {
  to: string;
  shopName: string;
  amount: number;
  currency: string;
  period: BillingPeriod;
  tranId: string;
  provider: string;
  expiresAt: Date;
}): Promise<boolean> {
  const periodLabel = params.period === 'annual' ? 'Annual (365 days)' : 'Monthly (30 days)';
  return sendResendEmail({
    to: params.to,
    subject: `[DokanOS] Payment Receipt: ${params.currency} ${params.amount.toLocaleString()} for ${params.shopName}`,
    html: `
      <h2>DokanOS Payment Receipt</h2>
      <p>Thank you for upgrading your subscription for <strong>${params.shopName}</strong>.</p>
      <table style="border-collapse:collapse;width:100%;max-width:500px">
        <tr><td style="padding:8px 0"><strong>Transaction ID:</strong></td><td>${params.tranId}</td></tr>
        <tr><td style="padding:8px 0"><strong>Gateway:</strong></td><td>${params.provider.toUpperCase()}</td></tr>
        <tr><td style="padding:8px 0"><strong>Plan / Period:</strong></td><td>DokanOS Pro (${periodLabel})</td></tr>
        <tr><td style="padding:8px 0"><strong>Amount Paid:</strong></td><td>${params.currency} ${params.amount.toLocaleString()}</td></tr>
        <tr><td style="padding:8px 0"><strong>Valid Until:</strong></td><td>${params.expiresAt.toISOString().slice(0, 10)}</td></tr>
      </table>
      <p style="margin-top:16px">Manage your billing anytime at <a href="${frontendBaseUrl()}/app/billing">DokanOS Billing Portal</a>.</p>
    `,
  });
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Milliseconds of Pro time a billing period buys. */
function periodDaysMs(period: BillingPeriod): number {
  return BILLING_PERIOD_DAYS[period] * DAY_MS;
}

/**
 * The period a stored payment row pays for. New rows carry `raw.period`;
 * rows created before periods existed fall back to their amount.
 */
function resolvePeriodFromPayment(payment: {
  amount: number;
  raw?: unknown;
}): BillingPeriod {
  const raw = payment.raw as { period?: unknown } | null | undefined;
  if (raw && typeof raw.period === 'string' && (BILLING_PERIODS as readonly string[]).includes(raw.period)) {
    return raw.period as BillingPeriod;
  }
  return payment.amount === PRO_PRICE_ANNUAL_BDT ? 'annual' : 'monthly';
}

/**
 * Validates and applies an SSLCommerz payment idempotently.
 * Uses unique index { provider: 'sslcommerz', eventId: tran_id } and atomic status transition
 * from 'pending' -> 'paid' so a replayed callback or IPN never double-extends the Pro period.
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

  if (env.NODE_ENV === 'production') {
    if (!valId) {
      throw AppError.badRequest('val_id is required for payment verification');
    }
    if (env.SSLCZ_STORE_ID === 'testbox') {
      throw AppError.badRequest('Testbox store cannot be used for production validation');
    }

    const valBaseUrl = env.SSLCZ_SANDBOX
      ? 'https://sandbox.sslcommerz.com/validator/api/validationserverAPI.php'
      : 'https://securepay.sslcommerz.com/validator/api/validationserverAPI.php';
    const valUrl = `${valBaseUrl}?val_id=${encodeURIComponent(
      valId,
    )}&store_id=${encodeURIComponent(env.SSLCZ_STORE_ID)}&store_passwd=${encodeURIComponent(
      env.SSLCZ_STORE_PASSWD,
    )}&v=1&format=json`;

    try {
      const response = await axios.get<{
        status?: string;
        tran_id?: string;
        amount?: string | number;
        currency_type?: string;
      }>(valUrl, { timeout: 8000 });

      validatedStatus = response.data.status ?? 'FAILED';
      validatedAmount = Number(response.data.amount ?? 0);
      validatedCurrency = response.data.currency_type ?? 'BDT';
    } catch {
      validatedStatus = 'FAILED';
    }
  } else {
    // In sandbox/test mode (dev/test environments only), require val_id and verify amounts
    if (!valId) {
      throw AppError.badRequest('val_id is required for payment validation');
    }
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
  const receiptRef: { current: PaymentReceiptInfo | null } = { current: null };

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

      // Paid time stacks on top of any still-active period (including a
      // running Pro trial), so paying early never eats remaining days.
      const baseDate =
        tenant.plan === 'pro' &&
        tenant.planExpiresAt &&
        tenant.planExpiresAt.getTime() > Date.now()
          ? tenant.planExpiresAt.getTime()
          : Date.now();

      const period = resolvePeriodFromPayment(existingPayment);
      const newExpiresAt = new Date(baseDate + periodDaysMs(period));
      tenant.plan = 'pro';
      tenant.planExpiresAt = newExpiresAt;
      tenant.trialEndsAt = null;
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

      const owner = await UserModel.findOne({ tenantId: tenant._id, role: 'owner' })
        .session(session)
        .lean();
      receiptRef.current = {
        shopName: tenant.name,
        amount: existingPayment.amount,
        currency: existingPayment.currency,
        period,
        tranId,
        expiresAt: newExpiresAt,
        recipientEmail: owner?.email,
      };
    });
  } finally {
    await session.endSession();
  }

  const receipt = receiptRef.current;
  if (wasUpdated && receipt?.recipientEmail) {
    void sendPaymentReceiptEmail({
      to: receipt.recipientEmail,
      shopName: receipt.shopName,
      amount: receipt.amount,
      currency: receipt.currency,
      period: receipt.period,
      tranId: receipt.tranId,
      provider: 'sslcommerz',
      expiresAt: receipt.expiresAt,
    });
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
    _plan: PlanType,
    period: BillingPeriod,
    customerInfo?: CustomerCheckoutInfo,
  ): Promise<CheckoutSessionResult> {
    const tranId = `DKN-${tenant.slug.toUpperCase().slice(0, 10)}-${Date.now()}`;
    const amount = BILLING_PERIOD_PRICE_BDT[period];
    const productName = `DokanOS Pro (${BILLING_PERIOD_DAYS[period]} days)`;

    await PaymentModel.create({
      tenantId: new Types.ObjectId(tenant.id),
      provider: 'sslcommerz',
      providerRef: tranId,
      eventId: tranId,
      amount,
      currency: 'BDT',
      status: 'pending',
      purpose: 'subscription',
      raw: {
        initiatedBy: user.email,
        period,
        customerInfo: {
          phone: customerInfo?.phone,
          address: customerInfo?.address,
          city: customerInfo?.city,
        },
      },
    });

    const isSandbox = env.SSLCZ_SANDBOX;
    const gatewayApiUrl = isSandbox
      ? 'https://sandbox.sslcommerz.com/gwprocess/v4/api.php'
      : 'https://securepay.sslcommerz.com/gwprocess/v4/api.php';

    const cusName = user.name || tenant.name || 'DokanOS Merchant';
    const cusEmail = user.email || 'billing@dokanos.app';
    const cusPhone = customerInfo?.phone?.trim() || '01711111111';
    const cusAdd1 = customerInfo?.address?.trim() || 'Dhaka, Bangladesh';
    const cusCity = customerInfo?.city?.trim() || 'Dhaka';

    let gatewayUrl = `/app/billing?sandbox_checkout=sslcommerz&tran_id=${encodeURIComponent(tranId)}&amount=${amount}&period=${period}`;

    const formData = new URLSearchParams({
      store_id: env.SSLCZ_STORE_ID,
      store_passwd: env.SSLCZ_STORE_PASSWD,
      total_amount: String(amount),
      currency: 'BDT',
      tran_id: tranId,
      success_url: env.SSLCZ_SUCCESS_URL,
      fail_url: env.SSLCZ_FAIL_URL,
      cancel_url: env.SSLCZ_CANCEL_URL,
      ipn_url: env.SSLCZ_IPN_URL,
      cus_name: cusName,
      cus_email: cusEmail,
      cus_add1: cusAdd1,
      cus_city: cusCity,
      cus_country: 'Bangladesh',
      cus_phone: cusPhone,
      shipping_method: 'NO',
      product_name: productName,
      product_category: 'Subscription',
      product_profile: 'general',
    });

    try {
      const resp = await axios.post<{
        status?: string;
        failedreason?: string;
        GatewayPageURL?: string;
      }>(gatewayApiUrl, formData.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 10000,
      });

      if (resp.data?.status === 'SUCCESS' && resp.data.GatewayPageURL) {
        gatewayUrl = resp.data.GatewayPageURL;
      } else if (env.NODE_ENV === 'production') {
        throw AppError.badRequest(
          `SSLCommerz session initialization failed: ${resp.data?.failedreason || resp.data?.status || 'Unknown gateway error'}`,
        );
      }
    } catch (err) {
      if (err instanceof AppError) throw err;
      if (env.NODE_ENV === 'production') {
        throw AppError.badRequest(
          `Failed to connect to SSLCommerz gateway: ${err instanceof Error ? err.message : 'Network error'}`,
        );
      }
      // Non-production fallback to local simulator URL
    }

    return {
      provider: 'sslcommerz',
      gatewayUrl,
      tranId,
      mode: isSandbox ? 'sandbox' : 'live',
    };
  }

  async handleWebhook(
    req: Request,
  ): Promise<{ processed: boolean; duplicate: boolean; tranId: string }> {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const query = (req.query ?? {}) as Record<string, unknown>;
    const tranId = String(body.tran_id ?? query.tran_id ?? '');
    const valIdRaw = body.val_id ?? query.val_id;
    const valId = valIdRaw ? String(valIdRaw) : undefined;
    const amountRaw = body.amount ?? query.amount;
    const amount = amountRaw !== undefined ? Number(amountRaw) : undefined;
    const currencyRaw = body.currency ?? query.currency;
    const currency = currencyRaw ? String(currencyRaw) : undefined;

    if (!tranId) {
      throw AppError.badRequest('tran_id is required');
    }

    return validateAndApplySslCommerzPayment({
      tranId,
      valId,
      amount,
      currency,
      rawPayload: Object.keys(body).length > 0 ? body : query,
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
    _plan: PlanType,
    period: BillingPeriod,
  ): Promise<CheckoutSessionResult> {
    const tranId = `STRIPE-${tenant.slug.toUpperCase().slice(0, 8)}-${Date.now()}`;
    const amount = BILLING_PERIOD_PRICE_BDT[period];

    await PaymentModel.create({
      tenantId: new Types.ObjectId(tenant.id),
      provider: 'stripe',
      providerRef: tranId,
      eventId: tranId,
      amount,
      currency: 'BDT',
      status: 'pending',
      purpose: 'subscription',
      raw: { initiatedBy: user.email, testMode: true, period },
    });

    let gatewayUrl = `/app/billing?sandbox_checkout=stripe&tran_id=${encodeURIComponent(tranId)}&amount=${amount}&period=${period}`;

    if (env.STRIPE_SECRET_KEY && env.STRIPE_SECRET_KEY !== 'sk_test_placeholder') {
      try {
        const stripe = new Stripe(env.STRIPE_SECRET_KEY);
        const session = await stripe.checkout.sessions.create({
          mode: 'payment',
          client_reference_id: tranId,
          customer_email: user.email,
          line_items: [
            {
              price_data: {
                currency: 'bdt',
                unit_amount: amount * 100, // smallest currency unit (poisha)
                product_data: {
                  name: `DokanOS Pro (${BILLING_PERIOD_DAYS[period]} days)`,
                  description: `DokanOS Pro subscription for ${tenant.name}`,
                },
              },
              quantity: 1,
            },
          ],
          metadata: {
            tranId,
            tenantId: tenant.id,
            period,
          },
          success_url: `${frontendBaseUrl()}/app/billing?status=success&tran_id=${encodeURIComponent(tranId)}`,
          cancel_url: `${frontendBaseUrl()}/app/billing?status=cancelled&tran_id=${encodeURIComponent(tranId)}`,
        });

        if (session.url) {
          gatewayUrl = session.url;
        }
      } catch (err) {
        if (env.NODE_ENV === 'production') {
          throw AppError.badRequest(
            `Stripe checkout creation failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
          );
        }
      }
    } else if (env.NODE_ENV === 'production') {
      throw AppError.badRequest('Stripe secret key is not configured');
    }

    return {
      provider: 'stripe',
      gatewayUrl,
      tranId,
      mode: env.STRIPE_SECRET_KEY?.startsWith('sk_live_') ? 'live' : 'test',
    };
  }

  async handleWebhook(
    req: Request,
  ): Promise<{ processed: boolean; duplicate: boolean; tranId: string }> {
    const sig = req.headers['stripe-signature'];
    if (!sig || typeof sig !== 'string') {
      throw AppError.badRequest('Missing stripe-signature header');
    }

    const secret = env.STRIPE_WEBHOOK_SECRET;
    if (!secret || secret === 'whsec_placeholder') {
      throw AppError.badRequest('Stripe webhook secret is not configured');
    }

    const stripeKey = env.STRIPE_SECRET_KEY || 'sk_test_placeholder';
    const stripe = new Stripe(stripeKey);

    const rawBody =
      (req as unknown as { rawBody?: Buffer }).rawBody ??
      (Buffer.isBuffer(req.body)
        ? req.body
        : Buffer.from(typeof req.body === 'string' ? req.body : JSON.stringify(req.body)));

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(rawBody, sig, secret);
    } catch (err) {
      throw AppError.badRequest(
        `Stripe signature verification failed: ${err instanceof Error ? err.message : 'Invalid signature'}`,
      );
    }

    if (
      event.type !== 'checkout.session.completed' &&
      event.type !== 'checkout.session.async_payment_succeeded' &&
      event.type !== 'checkout.session.async_payment_failed' &&
      event.type !== 'payment_intent.succeeded'
    ) {
      return { processed: false, duplicate: false, tranId: event.id };
    }

    const sessionObj = event.data.object as {
      id?: string;
      metadata?: { tranId?: string };
      client_reference_id?: string;
      payment_status?: string;
    };
    const tranId =
      sessionObj.metadata?.tranId ??
      sessionObj.client_reference_id ??
      sessionObj.id ??
      '';

    if (!tranId) {
      throw AppError.badRequest('Missing Stripe transaction identifier');
    }

    // Handle asynchronous payment failure
    if (event.type === 'checkout.session.async_payment_failed') {
      const failedPayment = await PaymentModel.findOneAndUpdate(
        {
          provider: 'stripe',
          eventId: tranId,
          status: 'pending',
        },
        {
          $set: {
            status: 'failed',
            raw: event,
          },
        },
        { new: true },
      );
      return { processed: Boolean(failedPayment), duplicate: false, tranId };
    }

    // Delayed payments: if completed but payment_status is not 'paid', wait for async_payment_succeeded
    if (
      event.type === 'checkout.session.completed' &&
      sessionObj.payment_status &&
      sessionObj.payment_status !== 'paid'
    ) {
      logger.info('Stripe checkout completed with unpaid status; awaiting async confirmation', {
        tranId,
        paymentStatus: sessionObj.payment_status,
      });
      return { processed: false, duplicate: false, tranId };
    }

    const session = await mongoose.startSession();
    let wasUpdated = false;
    const receiptRef: { current: PaymentReceiptInfo | null } = { current: null };

    try {
      await session.withTransaction(async () => {
        const paymentUpdate = await PaymentModel.findOneAndUpdate(
          {
            provider: 'stripe',
            eventId: tranId,
            status: 'pending',
          },
          {
            $set: {
              status: 'paid',
              raw: event,
            },
          },
          { session, new: true },
        );

        if (!paymentUpdate) {
          wasUpdated = false;
          return;
        }

        wasUpdated = true;
        const tenant = await TenantModel.findById(paymentUpdate.tenantId).session(session);
        if (!tenant) {
          throw AppError.notFound('Tenant not found for payment');
        }

        const baseDate =
          tenant.plan === 'pro' &&
          tenant.planExpiresAt &&
          tenant.planExpiresAt.getTime() > Date.now()
            ? tenant.planExpiresAt.getTime()
            : Date.now();
        const period = resolvePeriodFromPayment(paymentUpdate);
        const newExpiresAt = new Date(baseDate + periodDaysMs(period));

        await TenantModel.findByIdAndUpdate(
          paymentUpdate.tenantId,
          {
            $set: { plan: 'pro', planExpiresAt: newExpiresAt, trialEndsAt: null },
          },
          { session },
        );

        await SubscriptionModel.findOneAndUpdate(
          { tenantId: paymentUpdate.tenantId, provider: 'stripe' },
          {
            $set: {
              plan: 'pro',
              status: 'active',
              currentPeriodEnd: newExpiresAt,
              providerSubscriptionId: tranId,
            },
          },
          { upsert: true, session },
        );

        const owner = await UserModel.findOne({ tenantId: paymentUpdate.tenantId, role: 'owner' })
          .session(session)
          .lean();
        receiptRef.current = {
          shopName: tenant.name,
          amount: paymentUpdate.amount,
          currency: paymentUpdate.currency,
          period,
          tranId,
          expiresAt: newExpiresAt,
          recipientEmail: owner?.email,
        };
      });
    } finally {
      await session.endSession();
    }

    const receipt = receiptRef.current;
    if (wasUpdated && receipt?.recipientEmail) {
      void sendPaymentReceiptEmail({
        to: receipt.recipientEmail,
        shopName: receipt.shopName,
        amount: receipt.amount,
        currency: receipt.currency,
        period: receipt.period,
        tranId: receipt.tranId,
        provider: 'stripe',
        expiresAt: receipt.expiresAt,
      });
    }

    return { processed: true, duplicate: !wasUpdated, tranId };
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

const frontendBaseUrl = (): string => env.FRONTEND_URL.replace(/\/$/, '');

const billingCallbackLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: {
    error: {
      code: ERROR_CODES.RATE_LIMITED,
      message: 'Too many payment callback requests. Please try again later.',
    },
  },
});

async function handleSslCommerzSuccess(
  req: Request,
  res: import('express').Response,
  next: import('express').NextFunction,
): Promise<void> {
  try {
    if (req.method === 'GET') {
      const tranId = String(req.query.tran_id ?? '');
      if (!tranId) {
        throw AppError.badRequest('Missing tran_id parameter');
      }
      const payment = await PaymentModel.findOne({ provider: 'sslcommerz', eventId: tranId }).lean();
      if (!payment) {
        throw AppError.notFound(`Payment transaction '${tranId}' not found`);
      }
      if (req.headers.accept?.includes('application/json') || req.query.format === 'json') {
        res.status(200).json({
          data: {
            tranId,
            status: payment.status,
            duplicate: payment.status === 'paid',
          },
        });
        return;
      }
      // Pure read-only redirect to frontend billing view: no state mutation on GET
      res.redirect(
        `${frontendBaseUrl()}/app/billing?status=${payment.status === 'paid' ? 'success' : 'pending'}&tran_id=${encodeURIComponent(tranId)}`,
      );
      return;
    }

    const result = await sslCommerzProvider.handleWebhook(req);
    if (
      req.is('json') ||
      req.headers.accept?.includes('application/json') ||
      req.query.format === 'json'
    ) {
      res.status(200).json({ data: result });
      return;
    }
    res.redirect(
      `${frontendBaseUrl()}/app/billing?status=success&tran_id=${encodeURIComponent(result.tranId)}`,
    );
  } catch (err) {
    next(err);
  }
}

async function handleSslCommerzFail(
  req: Request,
  res: import('express').Response,
  next: import('express').NextFunction,
): Promise<void> {
  try {
    if (req.method === 'POST' && !req.headers.authorization) {
      throw AppError.unauthorized('Authenticated payment owner or gateway proof required');
    }
    const tranId = String((req.body as { tran_id?: string })?.tran_id ?? req.query.tran_id ?? '');
    if (!tranId) {
      throw AppError.badRequest('Missing tran_id parameter');
    }
    const payment = await PaymentModel.findOne({ provider: 'sslcommerz', eventId: tranId }).lean();
    if (!payment) {
      throw AppError.notFound(`Payment transaction '${tranId}' not found`);
    }

    if (req.method === 'POST') {
      if (payment.status === 'pending') {
        await PaymentModel.updateOne(
          { provider: 'sslcommerz', eventId: tranId, status: 'pending' },
          { $set: { status: 'failed', raw: req.body } },
        );
      }
    }

    if (req.method === 'GET' && !req.headers.accept?.includes('application/json')) {
      res.redirect(
        `${frontendBaseUrl()}/app/billing?status=failed&tran_id=${encodeURIComponent(tranId)}`,
      );
      return;
    }
    res.status(200).json({ data: { status: 'failed', tranId } });
  } catch (err) {
    next(err);
  }
}

async function handleSslCommerzCancel(
  req: Request,
  res: import('express').Response,
  next: import('express').NextFunction,
): Promise<void> {
  try {
    if (req.method === 'POST' && !req.headers.authorization) {
      throw AppError.unauthorized('Authenticated payment owner or gateway proof required');
    }
    const tranId = String((req.body as { tran_id?: string })?.tran_id ?? req.query.tran_id ?? '');
    if (!tranId) {
      throw AppError.badRequest('Missing tran_id parameter');
    }
    const payment = await PaymentModel.findOne({ provider: 'sslcommerz', eventId: tranId }).lean();
    if (!payment) {
      throw AppError.notFound(`Payment transaction '${tranId}' not found`);
    }

    if (req.method === 'POST') {
      if (payment.status === 'pending') {
        await PaymentModel.updateOne(
          { provider: 'sslcommerz', eventId: tranId, status: 'pending' },
          { $set: { status: 'failed', raw: req.body } },
        );
      }
    }

    if (req.method === 'GET' && !req.headers.accept?.includes('application/json')) {
      res.redirect(
        `${frontendBaseUrl()}/app/billing?status=cancelled&tran_id=${encodeURIComponent(tranId)}`,
      );
      return;
    }
    res.status(200).json({ data: { status: 'cancelled', tranId } });
  } catch (err) {
    next(err);
  }
}

// Rate limiting on public gateway callback routes outside test environment
if (env.NODE_ENV !== 'test') {
  billingRouter.use('/sslcommerz', billingCallbackLimiter);
  billingRouter.use('/stripe', billingCallbackLimiter);
}

// Public SSLCommerz callbacks & IPN (registered BEFORE requireAuth/requireTenant for both GET and POST)
billingRouter.post('/sslcommerz/success', handleSslCommerzSuccess);
billingRouter.get('/sslcommerz/success', handleSslCommerzSuccess);

billingRouter.post('/sslcommerz/ipn', async (req, res, next) => {
  try {
    const result = await sslCommerzProvider.handleWebhook(req);
    res.status(200).json({ data: result });
  } catch (err) {
    next(err);
  }
});

billingRouter.post('/sslcommerz/fail', handleSslCommerzFail);
billingRouter.get('/sslcommerz/fail', handleSslCommerzFail);

billingRouter.post('/sslcommerz/cancel', handleSslCommerzCancel);
billingRouter.get('/sslcommerz/cancel', handleSslCommerzCancel);

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
        annualPriceBdt: PRO_PRICE_ANNUAL_BDT,
        planExpiresAt: tenant?.planExpiresAt ?? null,
        trialEndsAt: tenant?.trialEndsAt ?? null,
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

// Billing period the client asked to buy. Absent means monthly (the old
// behaviour); anything else is a 400, never silently treated as monthly.
function parseBillingPeriod(body: unknown): BillingPeriod {
  const period = (body as { period?: unknown } | null | undefined)?.period;
  if (period === undefined) return 'monthly';
  if (typeof period === 'string' && (BILLING_PERIODS as readonly string[]).includes(period)) {
    return period as BillingPeriod;
  }
  throw AppError.badRequest("Invalid billing period. Expected 'monthly' or 'annual'.");
}

/**
 * Reconciliation job: polls pending payments older than 30 minutes, marks them failed,
 * and updates expired active subscriptions to past_due.
 */
export async function reconcilePendingPayments(): Promise<{
  checked: number;
  expired: number;
  syncedSubscriptions: number;
}> {
  const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
  const pendingPayments = await PaymentModel.find({
    status: 'pending',
    createdAt: { $lt: thirtyMinutesAgo },
  }).limit(50);

  let expired = 0;
  for (const payment of pendingPayments) {
    await PaymentModel.updateOne(
      { _id: payment._id, status: 'pending' },
      {
        $set: {
          status: 'failed',
          raw: {
            ...((payment.raw as Record<string, unknown>) || {}),
            reconciliation: 'expired_after_30m_timeout',
          },
        },
      },
    );
    expired += 1;
  }

  const expiredSubscriptions = await SubscriptionModel.find({
    status: 'active',
    currentPeriodEnd: { $lt: new Date() },
  }).limit(50);

  let syncedSubscriptions = 0;
  for (const sub of expiredSubscriptions) {
    sub.status = 'past_due';
    await sub.save();
    syncedSubscriptions += 1;
  }

  return { checked: pendingPayments.length, expired, syncedSubscriptions };
}

// POST /api/v1/billing/sslcommerz/init
billingRouter.post(
  '/sslcommerz/init',
  requirePermission('billing:write'),
  async (req, res, next) => {
    try {
      const period = parseBillingPeriod(req.body);
      const { phone, address, city } = (req.body ?? {}) as {
        phone?: string;
        address?: string;
        city?: string;
      };
      const checkout = await sslCommerzProvider.createCheckout(
        req.tenant!,
        { name: req.user!.name, email: req.user!.email },
        'pro',
        period,
        { phone, address, city },
      );
      res.status(201).json({
        data: {
          GatewayPageURL: checkout.gatewayUrl,
          tranId: checkout.tranId,
          provider: checkout.provider,
          mode: checkout.mode,
          amount: BILLING_PERIOD_PRICE_BDT[period],
          period,
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

// POST /api/v1/billing/stripe/checkout or /stripe/init
billingRouter.post(
  ['/stripe/checkout', '/stripe/init'],
  requirePermission('billing:write'),
  async (req, res, next) => {
    try {
      const period = parseBillingPeriod(req.body);
      const checkout = await stripeProvider.createCheckout(
        req.tenant!,
        { name: req.user!.name, email: req.user!.email },
        'pro',
        period,
      );
      res.status(201).json({
        data: {
          checkoutUrl: checkout.gatewayUrl,
          tranId: checkout.tranId,
          provider: checkout.provider,
          mode: checkout.mode,
          amount: BILLING_PERIOD_PRICE_BDT[period],
          period,
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
      parseBillingPeriod(req.body),
    );
    res.status(501).json({});
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/billing/reconcile
billingRouter.post('/reconcile', requirePermission('billing:write'), async (_req, res, next) => {
  try {
    const result = await reconcilePendingPayments();
    res.status(200).json({ data: result });
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
        $set: { plan: 'free', planExpiresAt: null, trialEndsAt: null },
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
