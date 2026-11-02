import type { RequestHandler } from 'express';
import { ERROR_CODES, type PlanType } from '@dokanos/shared';
import { TenantModel } from '../models/index.js';
import { AppError } from '../utils/errors.js';

/**
 * The plan a tenant actually has right now. A stored 'pro' whose expiry has
 * passed counts as 'free' everywhere — request context AND auth responses —
 * so a signed-in user never sees a stale Pro badge after their trial ends.
 * The stored row is left untouched; only what the client is told changes.
 */
export function getEffectivePlan(tenant: {
  plan: PlanType;
  planExpiresAt: Date | null;
}): PlanType {
  return tenant.plan === 'pro' &&
    tenant.planExpiresAt &&
    new Date(tenant.planExpiresAt).getTime() < Date.now()
    ? 'free'
    : tenant.plan;
}

export const requireTenant: RequestHandler = async (req, _res, next) => {
  try {
    if (!req.user || !req.user.tenantId) {
      throw new AppError(403, ERROR_CODES.TENANT_MISMATCH, 'Tenant context required');
    }

    const headerTenantId = req.headers['x-tenant-id'];
    if (
      typeof headerTenantId === 'string' &&
      headerTenantId.trim() !== '' &&
      headerTenantId.trim() !== req.user.tenantId
    ) {
      throw new AppError(
        403,
        ERROR_CODES.TENANT_MISMATCH,
        'Cross-tenant access is strictly forbidden',
      );
    }

    const queryTenantId = req.query.tenantId;
    if (
      typeof queryTenantId === 'string' &&
      queryTenantId.trim() !== '' &&
      queryTenantId.trim() !== req.user.tenantId
    ) {
      throw new AppError(
        403,
        ERROR_CODES.TENANT_MISMATCH,
        'Cross-tenant query parameter is strictly forbidden',
      );
    }

    const tenant = await TenantModel.findById(req.user.tenantId).lean();
    if (!tenant) {
      throw AppError.notFound('Tenant shop not found');
    }

    // Check if Pro plan has expired
    const effectivePlan = getEffectivePlan(tenant);

    req.tenant = {
      id: tenant._id.toString(),
      name: tenant.name,
      slug: tenant.slug,
      plan: effectivePlan,
      planExpiresAt: tenant.planExpiresAt,
      lowStockThreshold: tenant.settings?.lowStockThreshold ?? 10,
    };

    next();
  } catch (err) {
    next(err);
  }
};
