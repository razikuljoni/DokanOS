import crypto from 'node:crypto';
import { Router, type Response } from 'express';
import mongoose, { Types } from 'mongoose';
import bcrypt from 'bcryptjs';
import {
  ERROR_CODES,
  loginSchema,
  registerSchema,
} from '@dokanos/shared';
import { RefreshTokenModel, TenantModel, UserModel } from '../../models/index.js';
import { requireAuth, signAccessToken } from '../../middleware/auth.js';
import { AppError } from '../../utils/errors.js';
import { env } from '../../config/env.js';

const REFRESH_COOKIE_NAME = 'dokanos_rt';
const REFRESH_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function hashRefreshToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

function generateOpaqueToken(): string {
  return crypto.randomBytes(64).toString('hex');
}

function setRefreshCookie(res: Response, rawToken: string): void {
  res.cookie(REFRESH_COOKIE_NAME, rawToken, {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: REFRESH_EXPIRY_MS,
    path: '/',
  });
}

function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE_NAME, {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
  });
}

function slugifyShopName(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const suffix = crypto.randomBytes(2).toString('hex');
  return `${base || 'shop'}-${suffix}`;
}

export const authRouter = Router();

// POST /api/v1/auth/register — creates Tenant + Owner in one transaction
authRouter.post('/register', async (req, res, next) => {
  const session = await mongoose.startSession();
  try {
    const parsed = registerSchema.parse(req.body);
    const passwordHash = await bcrypt.hash(parsed.password, 12);

    let createdUserId = new Types.ObjectId();
    let createdTenantId = new Types.ObjectId();
    let slug = slugifyShopName(parsed.shopName);

    await session.withTransaction(async () => {
      const existingSlug = await TenantModel.findOne({ slug }).session(session);
      if (existingSlug) {
        slug = slugifyShopName(`${parsed.shopName}-${Date.now()}`);
      }

      const tenantId = new Types.ObjectId();
      const ownerId = new Types.ObjectId();

      await TenantModel.create(
        [
          {
            _id: tenantId,
            name: parsed.shopName,
            slug,
            type: parsed.shopType,
            plan: 'free',
            planExpiresAt: null,
            ownerId,
            settings: {
              lowStockThreshold: 10,
              currency: 'BDT',
            },
          },
        ],
        { session },
      );

      await UserModel.create(
        [
          {
            _id: ownerId,
            name: parsed.ownerName,
            email: parsed.email,
            passwordHash,
            role: 'owner',
            tenantId,
            status: 'active',
            lastLoginAt: new Date(),
          },
        ],
        { session },
      );

      createdUserId = ownerId;
      createdTenantId = tenantId;
    });

    const rawRefresh = generateOpaqueToken();
    const familyId = crypto.randomUUID();
    await RefreshTokenModel.create({
      userId: createdUserId,
      tokenHash: hashRefreshToken(rawRefresh),
      familyId,
      expiresAt: new Date(Date.now() + REFRESH_EXPIRY_MS),
      userAgent: req.headers['user-agent'] ?? 'Browser',
      ip: req.ip ?? '127.0.0.1',
    });

    const accessToken = signAccessToken({
      sub: createdUserId.toString(),
      role: 'owner',
      tenantId: createdTenantId.toString(),
      email: parsed.email,
      name: parsed.ownerName,
    });

    const tenant = await TenantModel.findById(createdTenantId).lean();
    const user = await UserModel.findById(createdUserId).lean();

    setRefreshCookie(res, rawRefresh);
    res.status(201).json({
      accessToken,
      user: {
        id: user?._id.toString(),
        name: user?.name,
        email: user?.email,
        role: user?.role,
        tenantId: createdTenantId.toString(),
      },
      tenant: {
        id: tenant?._id.toString(),
        name: tenant?.name,
        slug: tenant?.slug,
        type: tenant?.type,
        plan: tenant?.plan,
        planExpiresAt: tenant?.planExpiresAt,
        settings: tenant?.settings,
      },
    });
  } catch (err) {
    next(err);
  } finally {
    await session.endSession();
  }
});

// POST /api/v1/auth/login
authRouter.post('/login', async (req, res, next) => {
  try {
    const parsed = loginSchema.parse(req.body);
    const filter: Record<string, unknown> = { email: parsed.email };

    if (parsed.tenantSlug) {
      const t = await TenantModel.findOne({ slug: parsed.tenantSlug }).lean();
      if (t) {
        filter.tenantId = t._id;
      }
    }

    const user = await UserModel.findOne(filter);
    if (!user) {
      throw AppError.unauthorized('Invalid email or password');
    }

    if (user.status === 'disabled') {
      throw AppError.forbidden('Account has been disabled by shop owner');
    }

    const valid = await bcrypt.compare(parsed.password, user.passwordHash);
    if (!valid) {
      throw AppError.unauthorized('Invalid email or password');
    }

    user.lastLoginAt = new Date();
    if (user.status === 'invited') {
      user.status = 'active';
    }
    await user.save();

    const rawRefresh = generateOpaqueToken();
    const familyId = crypto.randomUUID();
    await RefreshTokenModel.create({
      userId: user._id,
      tokenHash: hashRefreshToken(rawRefresh),
      familyId,
      expiresAt: new Date(Date.now() + REFRESH_EXPIRY_MS),
      userAgent: req.headers['user-agent'] ?? 'Browser',
      ip: req.ip ?? '127.0.0.1',
    });

    const tenant = user.tenantId ? await TenantModel.findById(user.tenantId).lean() : null;
    const accessToken = signAccessToken({
      sub: user._id.toString(),
      role: user.role,
      tenantId: user.tenantId ? user.tenantId.toString() : null,
      email: user.email,
      name: user.name,
    });

    setRefreshCookie(res, rawRefresh);
    res.status(200).json({
      accessToken,
      user: {
        id: user._id.toString(),
        name: user.name,
        email: user.email,
        role: user.role,
        tenantId: user.tenantId ? user.tenantId.toString() : null,
      },
      tenant: tenant
        ? {
            id: tenant._id.toString(),
            name: tenant.name,
            slug: tenant.slug,
            type: tenant.type,
            plan: tenant.plan,
            planExpiresAt: tenant.planExpiresAt,
            settings: tenant.settings,
          }
        : null,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/auth/refresh — rotates refresh token; reuse revokes entire family
authRouter.post('/refresh', async (req, res, next) => {
  try {
    const rawToken =
      (req.cookies as Record<string, string | undefined>)?.[REFRESH_COOKIE_NAME] ??
      (req.body as { refreshToken?: string } | undefined)?.refreshToken;

    if (!rawToken) {
      throw AppError.unauthorized('Refresh token missing');
    }

    const tokenHash = hashRefreshToken(rawToken);
    const storedToken = await RefreshTokenModel.findOne({ tokenHash });

    if (!storedToken) {
      clearRefreshCookie(res);
      throw AppError.unauthorized('Invalid refresh token');
    }

    // Reuse detection: if already revoked, revoke the entire family immediately!
    if (storedToken.revokedAt !== null) {
      await RefreshTokenModel.updateMany(
        { familyId: storedToken.familyId, revokedAt: null },
        { $set: { revokedAt: new Date() } },
      );
      clearRefreshCookie(res);
      throw new AppError(
        401,
        ERROR_CODES.UNAUTHENTICATED,
        'Refresh token reuse detected; session family revoked',
      );
    }

    if (storedToken.expiresAt.getTime() < Date.now()) {
      storedToken.revokedAt = new Date();
      await storedToken.save();
      clearRefreshCookie(res);
      throw AppError.unauthorized('Refresh token expired');
    }

    const user = await UserModel.findById(storedToken.userId).lean();
    if (!user || user.status === 'disabled') {
      clearRefreshCookie(res);
      throw AppError.unauthorized('User inactive or not found');
    }

    // Rotate: revoke old token and issue new one in same familyId
    storedToken.revokedAt = new Date();
    await storedToken.save();

    const newRawRefresh = generateOpaqueToken();
    await RefreshTokenModel.create({
      userId: user._id,
      tokenHash: hashRefreshToken(newRawRefresh),
      familyId: storedToken.familyId,
      expiresAt: new Date(Date.now() + REFRESH_EXPIRY_MS),
      userAgent: req.headers['user-agent'] ?? storedToken.userAgent,
      ip: req.ip ?? storedToken.ip,
    });

    const tenant = user.tenantId ? await TenantModel.findById(user.tenantId).lean() : null;
    const accessToken = signAccessToken({
      sub: user._id.toString(),
      role: user.role,
      tenantId: user.tenantId ? user.tenantId.toString() : null,
      email: user.email,
      name: user.name,
    });

    setRefreshCookie(res, newRawRefresh);
    res.status(200).json({
      accessToken,
      user: {
        id: user._id.toString(),
        name: user.name,
        email: user.email,
        role: user.role,
        tenantId: user.tenantId ? user.tenantId.toString() : null,
      },
      tenant: tenant
        ? {
            id: tenant._id.toString(),
            name: tenant.name,
            slug: tenant.slug,
            type: tenant.type,
            plan: tenant.plan,
            planExpiresAt: tenant.planExpiresAt,
            settings: tenant.settings,
          }
        : null,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/auth/logout
authRouter.post('/logout', async (req, res, next) => {
  try {
    const rawToken =
      (req.cookies as Record<string, string | undefined>)?.[REFRESH_COOKIE_NAME] ??
      (req.body as { refreshToken?: string } | undefined)?.refreshToken;

    if (rawToken) {
      const tokenHash = hashRefreshToken(rawToken);
      await RefreshTokenModel.updateOne(
        { tokenHash },
        { $set: { revokedAt: new Date() } },
      );
    }

    clearRefreshCookie(res);
    res.status(200).json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/auth/me
authRouter.get('/me', requireAuth, async (req, res, next) => {
  try {
    const user = await UserModel.findById(req.user!.id).lean();
    if (!user) {
      throw AppError.unauthorized('User not found');
    }
    const tenant = user.tenantId ? await TenantModel.findById(user.tenantId).lean() : null;
    res.status(200).json({
      user: {
        id: user._id.toString(),
        name: user.name,
        email: user.email,
        role: user.role,
        status: user.status,
        tenantId: user.tenantId ? user.tenantId.toString() : null,
      },
      tenant: tenant
        ? {
            id: tenant._id.toString(),
            name: tenant.name,
            slug: tenant.slug,
            type: tenant.type,
            plan: tenant.plan,
            planExpiresAt: tenant.planExpiresAt,
            settings: tenant.settings,
          }
        : null,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/auth/sessions
authRouter.get('/sessions', requireAuth, async (req, res, next) => {
  try {
    const activeTokens = await RefreshTokenModel.find({
      userId: new Types.ObjectId(req.user!.id),
      revokedAt: null,
      expiresAt: { $gt: new Date() },
    })
      .sort({ createdAt: -1 })
      .lean();

    const sessions = activeTokens.map((t) => ({
      familyId: t.familyId,
      userAgent: t.userAgent,
      ip: t.ip,
      createdAt: t.createdAt,
      expiresAt: t.expiresAt,
    }));

    res.status(200).json({ data: sessions });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/v1/auth/sessions/:familyId
authRouter.delete('/sessions/:familyId', requireAuth, async (req, res, next) => {
  try {
    const { familyId } = req.params;
    await RefreshTokenModel.updateMany(
      {
        userId: new Types.ObjectId(req.user!.id),
        familyId,
        revokedAt: null,
      },
      { $set: { revokedAt: new Date() } },
    );
    res.status(200).json({ ok: true });
  } catch (err) {
    next(err);
  }
});
