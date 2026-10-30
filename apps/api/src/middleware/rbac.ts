import type { RequestHandler } from 'express';
import { PERMISSIONS, type Permission, type Role } from '@dokanos/shared';
import { AppError } from '../utils/errors.js';

export function requirePermission(permission: Permission): RequestHandler {
  return (req, _res, next) => {
    if (!req.user) {
      next(AppError.unauthorized());
      return;
    }

    const allowedRoles = PERMISSIONS[permission] as readonly Role[];
    if (!allowedRoles.includes(req.user.role)) {
      next(
        AppError.forbidden(
          `Role '${req.user.role}' does not have permission '${permission}'`,
        ),
      );
      return;
    }

    next();
  };
}

export function requireRoles(...roles: Role[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.user) {
      next(AppError.unauthorized());
      return;
    }
    if (!roles.includes(req.user.role)) {
      next(AppError.forbidden('Insufficient role permissions'));
      return;
    }
    next();
  };
}
