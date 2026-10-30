import { z } from 'zod';
import {
  BILLING_PROVIDERS,
  PAYMENT_METHODS,
  PLANS,
  PRODUCT_UNITS,
  ROLES,
  SHOP_TYPES,
  USER_STATUSES,
} from './constants.js';

export const registerSchema = z.object({
  shopName: z.string().trim().min(2, 'Shop name must be at least 2 characters').max(80),
  shopType: z.enum(SHOP_TYPES),
  ownerName: z.string().trim().min(2, 'Owner name must be at least 2 characters').max(80),
  email: z.string().trim().email('Invalid email address').toLowerCase(),
  password: z.string().min(8, 'Password must be at least 8 characters').max(100),
});

export const loginSchema = z.object({
  email: z.string().trim().email('Invalid email address').toLowerCase(),
  password: z.string().min(1, 'Password is required'),
  tenantSlug: z.string().trim().optional(),
});

export const createProductSchema = z.object({
  name: z.string().trim().min(1, 'Product name is required').max(120),
  category: z.string().trim().min(1, 'Category is required').max(60),
  unit: z.enum(PRODUCT_UNITS),
  sku: z.string().trim().min(1, 'SKU is required').max(50),
  costPrice: z.number().nonnegative('Cost price cannot be negative'),
  sellPrice: z.number().positive('Sell price must be greater than zero'),
  stock: z.number().int().nonnegative('Stock cannot be negative').default(0),
  lowStockAt: z.number().int().nonnegative().optional(),
  supplierId: z.string().nullable().optional(),
});

export const updateProductSchema = createProductSchema.partial();

export const stockAdjustSchema = z.object({
  productId: z.string().min(1, 'Product ID is required'),
  qtyChange: z
    .number()
    .int()
    .refine((val) => val !== 0, 'Quantity change cannot be zero'),
  note: z.string().trim().min(3, 'Adjustment note is required').max(250),
});

export const saleItemInputSchema = z.object({
  productId: z.string().min(1, 'Product ID is required'),
  qty: z.number().int().positive('Quantity must be at least 1'),
});

export const createSaleSchema = z.object({
  items: z.array(saleItemInputSchema).min(1, 'At least one item is required'),
  discount: z.number().nonnegative('Discount cannot be negative').default(0),
  paymentMethod: z.enum(PAYMENT_METHODS),
  paidAmount: z.number().nonnegative('Paid amount cannot be negative'),
  customerName: z.string().trim().max(80).optional(),
  customerPhone: z.string().trim().max(25).optional(),
});

export const purchaseItemInputSchema = z.object({
  productId: z.string().min(1, 'Product ID is required'),
  qty: z.number().int().positive('Quantity must be at least 1'),
  costPrice: z.number().nonnegative('Cost price cannot be negative'),
});

export const createPurchaseSchema = z.object({
  supplierId: z.string().min(1, 'Supplier is required'),
  items: z.array(purchaseItemInputSchema).min(1, 'At least one item is required'),
  paidAmount: z.number().nonnegative('Paid amount cannot be negative'),
});

export const createSupplierSchema = z.object({
  name: z.string().trim().min(2, 'Supplier name is required').max(100),
  phone: z.string().trim().min(6, 'Phone is required').max(25),
  address: z.string().trim().max(200).optional().default(''),
});

export const updateSupplierSchema = createSupplierSchema.partial();

export const recordDuePaymentSchema = z.object({
  amount: z.number().positive('Payment amount must be greater than zero'),
  method: z.enum(PAYMENT_METHODS).default('cash'),
});

export const updateTenantSettingsSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  type: z.enum(SHOP_TYPES).optional(),
  lowStockThreshold: z.number().int().nonnegative().max(10000).optional(),
});

export const inviteStaffSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().email().toLowerCase(),
  role: z.enum(['manager', 'staff']),
  password: z.string().min(8).max(100).optional(),
});

export const updateUserRoleSchema = z.object({
  role: z.enum(ROLES),
});

export const updateUserStatusSchema = z.object({
  status: z.enum(USER_STATUSES),
});

export const billingCheckoutInitSchema = z.object({
  provider: z.enum(BILLING_PROVIDERS),
  plan: z.enum(PLANS).default('pro'),
});
