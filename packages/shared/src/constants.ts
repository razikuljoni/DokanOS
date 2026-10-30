export const ROLES = ['platformAdmin', 'owner', 'manager', 'staff'] as const;
export type Role = (typeof ROLES)[number];

export const SHOP_TYPES = ['pharmacy', 'grocery', 'electronics', 'general'] as const;
export type ShopType = (typeof SHOP_TYPES)[number];

export const PLANS = ['free', 'pro'] as const;
export type PlanType = (typeof PLANS)[number];

export const USER_STATUSES = ['active', 'invited', 'disabled'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const PRODUCT_UNITS = ['pcs', 'box', 'bottle', 'strip', 'kg'] as const;
export type ProductUnit = (typeof PRODUCT_UNITS)[number];

export const STOCK_MOVEMENT_TYPES = ['sale', 'purchase', 'adjustment', 'return'] as const;
export type StockMovementType = (typeof STOCK_MOVEMENT_TYPES)[number];

export const PAYMENT_METHODS = ['cash', 'bkash', 'card', 'sslcommerz'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_STATUSES = ['paid', 'partial', 'due'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const PURCHASE_STATUSES = ['received', 'partial', 'pending'] as const;
export type PurchaseStatus = (typeof PURCHASE_STATUSES)[number];

export const BILLING_PROVIDERS = ['sslcommerz', 'stripe', 'bkash'] as const;
export type BillingProviderName = (typeof BILLING_PROVIDERS)[number];

export const PRO_PRICE_BDT = 499;
export const DEFAULT_CURRENCY = 'BDT';
export const DEFAULT_LOW_STOCK_THRESHOLD = 10;
export const TIMEZONE_DHAKA = 'Asia/Dhaka';

export interface PlanLimits {
  maxProducts: number;
  maxStaff: number;
  csvImportExport: boolean;
  emailDigests: boolean;
}

export const PLAN_LIMITS: Record<PlanType, PlanLimits> = {
  free: {
    maxProducts: 100,
    maxStaff: 1, // 1 staff member besides the owner
    csvImportExport: false,
    emailDigests: false,
  },
  pro: {
    maxProducts: Number.POSITIVE_INFINITY,
    maxStaff: 5,
    csvImportExport: true,
    emailDigests: true,
  },
};

export const PERMISSIONS = {
  'tenant:read': ['owner', 'manager'],
  'tenant:write': ['owner'],
  'staff:read': ['owner', 'manager'],
  'staff:write': ['owner'],
  'products:read': ['owner', 'manager', 'staff'],
  'products:write': ['owner', 'manager'],
  'stock:read': ['owner', 'manager'],
  'stock:write': ['owner', 'manager'],
  'sales:read': ['owner', 'manager', 'staff'],
  'sales:write': ['owner', 'manager', 'staff'],
  'sales:return': ['owner', 'manager'],
  'purchases:read': ['owner', 'manager'],
  'purchases:write': ['owner', 'manager'],
  'suppliers:read': ['owner', 'manager'],
  'suppliers:write': ['owner', 'manager'],
  'dues:read': ['owner', 'manager'],
  'dues:write': ['owner', 'manager'],
  'dashboard:read': ['owner', 'manager', 'staff'],
  'notifications:read': ['owner', 'manager', 'staff'],
  'billing:read': ['owner'],
  'billing:write': ['owner'],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export const ERROR_CODES = {
  VALIDATION: 'VALIDATION',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  PLAN_LIMIT: 'PLAN_LIMIT',
  INSUFFICIENT_STOCK: 'INSUFFICIENT_STOCK',
  TENANT_MISMATCH: 'TENANT_MISMATCH',
  NOT_CONFIGURED: 'NOT_CONFIGURED',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];
