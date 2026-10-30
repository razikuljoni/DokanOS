import { Types } from 'mongoose';
import type { PaginationMeta } from '@dokanos/shared';
import { AppError } from './errors.js';

export interface PaginationParams {
  page: number;
  limit: number;
  skip: number;
}

export function parsePagination(query: Record<string, unknown>, maxLimit = 100): PaginationParams {
  const rawPage = Number(query.page ?? 1);
  const rawLimit = Number(query.limit ?? 20);
  const page = Number.isFinite(rawPage) && rawPage >= 1 ? Math.floor(rawPage) : 1;
  const limit =
    Number.isFinite(rawLimit) && rawLimit >= 1 ? Math.min(Math.floor(rawLimit), maxLimit) : 20;
  const skip = (page - 1) * limit;
  return { page, limit, skip };
}

export function buildPaginationMeta(page: number, limit: number, total: number): PaginationMeta {
  return {
    page,
    limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  };
}

export function toObjectIdParam(
  raw: string | string[] | undefined,
  notFoundMsg = 'Resource not found',
): Types.ObjectId {
  const str = typeof raw === 'string' ? raw : Array.isArray(raw) ? raw[0] : undefined;
  if (!str || !Types.ObjectId.isValid(str)) {
    throw AppError.notFound(notFoundMsg);
  }
  return new Types.ObjectId(str);
}
