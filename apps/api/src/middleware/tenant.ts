import type { RequestHandler } from 'express';
import { ERROR_CODES } from '@dokanos/shared';
import { TenantModel } from '../models/index.js';
import { AppError } from '../utils/errors.js';

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
    const effectivePlan =
      tenant.plan === 'pro' &&
      tenant.planExpiresAt &&
      new Date(tenant.planExpiresAt).getTime() < Date.now()
        ? 'free'
        : tenant.plan;

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
