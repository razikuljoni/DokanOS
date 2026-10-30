import type { Request, RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import type { PlanType, Role } from '@dokanos/shared';
import { env } from '../config/env.js';
import { AppError } from '../utils/errors.js';

export interface AuthUserContext {
  id: string;
  role: Role;
  tenantId: string | null;
  email: string;
  name: string;
}

export interface TenantContext {
  id: string;
  name: string;
  slug: string;
  plan: PlanType;
  planExpiresAt: Date | null;
  lowStockThreshold: number;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUserContext;
      tenant?: TenantContext;
    }
  }
}

export interface JwtAccessPayload {
  sub: string;
  role: Role;
  tenantId: string | null;
  email: string;
  name: string;
}

export function signAccessToken(payload: JwtAccessPayload): string {
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    expiresIn: '15m',
  });
}

export const requireAuth: RequestHandler = (req: Request, _res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    next(AppError.unauthorized('Missing or invalid Authorization header'));
    return;
  }

  const token = authHeader.slice('Bearer '.length).trim();
  if (!token) {
    next(AppError.unauthorized('Access token is empty'));
    return;
  }

  try {
    const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET) as JwtAccessPayload;
    req.user = {
      id: decoded.sub,
      role: decoded.role,
      tenantId: decoded.tenantId,
      email: decoded.email,
      name: decoded.name,
    };
    next();
  } catch {
    next(AppError.unauthorized('Access token expired or invalid'));
  }
};
