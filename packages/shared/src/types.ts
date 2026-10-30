import { z } from 'zod';
import {
  billingCheckoutInitSchema,
  createProductSchema,
  createPurchaseSchema,
  createSaleSchema,
  createSupplierSchema,
  inviteStaffSchema,
  loginSchema,
  purchaseItemInputSchema,
  recordDuePaymentSchema,
  registerSchema,
  saleItemInputSchema,
  stockAdjustSchema,
  updateProductSchema,
  updateSupplierSchema,
  updateTenantSettingsSchema,
  updateUserRoleSchema,
  updateUserStatusSchema,
} from './schemas.js';
import type { ErrorCode } from './constants.js';

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
export type StockAdjustInput = z.infer<typeof stockAdjustSchema>;
export type SaleItemInput = z.infer<typeof saleItemInputSchema>;
export type CreateSaleInput = z.infer<typeof createSaleSchema>;
export type PurchaseItemInput = z.infer<typeof purchaseItemInputSchema>;
export type CreatePurchaseInput = z.infer<typeof createPurchaseSchema>;
export type CreateSupplierInput = z.infer<typeof createSupplierSchema>;
export type UpdateSupplierInput = z.infer<typeof updateSupplierSchema>;
export type RecordDuePaymentInput = z.infer<typeof recordDuePaymentSchema>;
export type UpdateTenantSettingsInput = z.infer<typeof updateTenantSettingsSchema>;
export type InviteStaffInput = z.infer<typeof inviteStaffSchema>;
export type UpdateUserRoleInput = z.infer<typeof updateUserRoleSchema>;
export type UpdateUserStatusInput = z.infer<typeof updateUserStatusSchema>;
export type BillingCheckoutInitInput = z.infer<typeof billingCheckoutInitSchema>;

export interface ApiErrorResponse {
  error: {
    code: ErrorCode;
    message: string;
    details?: Record<string, string[]>;
  };
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  meta: PaginationMeta;
}

export interface HealthResponse {
  ok: true;
}
