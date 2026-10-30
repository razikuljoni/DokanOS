import mongoose, { Schema, type Document, type Types } from 'mongoose';
import {
  BILLING_PROVIDERS,
  DEFAULT_CURRENCY,
  DEFAULT_LOW_STOCK_THRESHOLD,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  PLANS,
  PRODUCT_UNITS,
  PURCHASE_STATUSES,
  ROLES,
  SHOP_TYPES,
  STOCK_MOVEMENT_TYPES,
  USER_STATUSES,
  type BillingProviderName,
  type PaymentMethod,
  type PaymentStatus,
  type PlanType,
  type ProductUnit,
  type PurchaseStatus,
  type Role,
  type ShopType,
  type StockMovementType,
  type UserStatus,
} from '@dokanos/shared';

// 1. Tenant
export interface ITenant extends Document {
  _id: Types.ObjectId;
  name: string;
  slug: string;
  type: ShopType;
  plan: PlanType;
  planExpiresAt: Date | null;
  ownerId: Types.ObjectId;
  invoiceCounter: number;
  settings: {
    lowStockThreshold: number;
    currency: string;
  };
  createdAt: Date;
  updatedAt: Date;
}

const tenantSchema = new Schema<ITenant>(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    type: { type: String, enum: SHOP_TYPES, required: true, default: 'general' },
    plan: { type: String, enum: PLANS, required: true, default: 'free' },
    planExpiresAt: { type: Date, default: null },
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    invoiceCounter: { type: Number, default: 0 },
    settings: {
      lowStockThreshold: { type: Number, default: DEFAULT_LOW_STOCK_THRESHOLD },
      currency: { type: String, default: DEFAULT_CURRENCY },
    },
  },
  { timestamps: true },
);

export const TenantModel =
  (mongoose.models.Tenant as mongoose.Model<ITenant> | undefined) ??
  mongoose.model<ITenant>('Tenant', tenantSchema);

// 2. User
export interface IUser extends Document {
  _id: Types.ObjectId;
  name: string;
  email: string;
  passwordHash: string;
  role: Role;
  tenantId: Types.ObjectId | null;
  status: UserStatus;
  inviteToken?: string | null;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<IUser>(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ROLES, required: true },
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', default: null },
    status: { type: String, enum: USER_STATUSES, default: 'active' },
    inviteToken: { type: String, default: null },
    lastLoginAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    toJSON: {
      transform(_doc, ret: Record<string, unknown>) {
        delete ret.passwordHash;
        return ret;
      },
    },
  },
);

userSchema.index({ tenantId: 1, email: 1 }, { unique: true });

export const UserModel =
  (mongoose.models.User as mongoose.Model<IUser> | undefined) ??
  mongoose.model<IUser>('User', userSchema);

// 3. RefreshToken
export interface IRefreshToken extends Document {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  tokenHash: string;
  familyId: string;
  expiresAt: Date;
  revokedAt: Date | null;
  userAgent: string;
  ip: string;
  createdAt: Date;
  updatedAt: Date;
}

const refreshTokenSchema = new Schema<IRefreshToken>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    familyId: { type: String, required: true, index: true },
    expiresAt: { type: Date, required: true, index: { expires: 0 } },
    revokedAt: { type: Date, default: null },
    userAgent: { type: String, default: 'Unknown Device' },
    ip: { type: String, default: '127.0.0.1' },
  },
  { timestamps: true },
);

export const RefreshTokenModel =
  (mongoose.models.RefreshToken as mongoose.Model<IRefreshToken> | undefined) ??
  mongoose.model<IRefreshToken>('RefreshToken', refreshTokenSchema);

// 4. Product
// Prices stored as 2-decimal BDT numbers per §3 specification
export interface IProduct extends Document {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  name: string;
  category: string;
  unit: ProductUnit;
  sku: string;
  costPrice: number;
  sellPrice: number;
  stock: number;
  lowStockAt: number;
  supplierId: Types.ObjectId | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const productSchema = new Schema<IProduct>(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    name: { type: String, required: true, trim: true },
    category: { type: String, required: true, trim: true },
    unit: { type: String, enum: PRODUCT_UNITS, required: true, default: 'pcs' },
    sku: { type: String, required: true, trim: true },
    costPrice: { type: Number, required: true, min: 0 },
    sellPrice: { type: Number, required: true, min: 0 },
    stock: { type: Number, required: true, default: 0, min: 0 },
    lowStockAt: { type: Number, required: true, default: DEFAULT_LOW_STOCK_THRESHOLD, min: 0 },
    supplierId: { type: Schema.Types.ObjectId, ref: 'Supplier', default: null },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

productSchema.index({ tenantId: 1, sku: 1 }, { unique: true });
productSchema.index({ tenantId: 1, category: 1 });
productSchema.index({ name: 'text' });

export const ProductModel =
  (mongoose.models.Product as mongoose.Model<IProduct> | undefined) ??
  mongoose.model<IProduct>('Product', productSchema);

// 5. StockMovement (append-only ledger)
export interface IStockMovement extends Document {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  productId: Types.ObjectId;
  type: StockMovementType;
  qtyChange: number;
  balanceAfter: number;
  refId: Types.ObjectId | null;
  refType: 'Sale' | 'Purchase' | 'Adjustment' | 'Return';
  userId: Types.ObjectId;
  note: string;
  createdAt: Date;
}

const stockMovementSchema = new Schema<IStockMovement>(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    type: { type: String, enum: STOCK_MOVEMENT_TYPES, required: true },
    qtyChange: { type: Number, required: true },
    balanceAfter: { type: Number, required: true },
    refId: { type: Schema.Types.ObjectId, default: null },
    refType: {
      type: String,
      enum: ['Sale', 'Purchase', 'Adjustment', 'Return'],
      required: true,
    },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    note: { type: String, default: '' },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

stockMovementSchema.index({ tenantId: 1, productId: 1, createdAt: -1 });

export const StockMovementModel =
  (mongoose.models.StockMovement as mongoose.Model<IStockMovement> | undefined) ??
  mongoose.model<IStockMovement>('StockMovement', stockMovementSchema);

// 6. Sale
export interface ISaleItem {
  productId: Types.ObjectId;
  name: string;
  qty: number;
  price: number;
  costPrice: number;
  lineTotal: number;
}

export interface ISale extends Document {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  invoiceNo: string;
  items: ISaleItem[];
  subtotal: number;
  discount: number;
  total: number;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  paidAmount: number;
  dueAmount: number;
  customerName: string;
  customerPhone: string;
  soldBy: Types.ObjectId;
  isReturned: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const saleItemSchema = new Schema<ISaleItem>(
  {
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    name: { type: String, required: true },
    qty: { type: Number, required: true, min: 1 },
    price: { type: Number, required: true, min: 0 },
    costPrice: { type: Number, required: true, min: 0, default: 0 },
    lineTotal: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

const saleSchema = new Schema<ISale>(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    invoiceNo: { type: String, required: true },
    items: { type: [saleItemSchema], required: true },
    subtotal: { type: Number, required: true, min: 0 },
    discount: { type: Number, required: true, default: 0, min: 0 },
    total: { type: Number, required: true, min: 0 },
    paymentMethod: { type: String, enum: PAYMENT_METHODS, required: true },
    paymentStatus: { type: String, enum: PAYMENT_STATUSES, required: true },
    paidAmount: { type: Number, required: true, min: 0 },
    dueAmount: { type: Number, required: true, min: 0 },
    customerName: { type: String, default: 'Walk-in Customer' },
    customerPhone: { type: String, default: '' },
    soldBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    isReturned: { type: Boolean, default: false },
  },
  { timestamps: true },
);

saleSchema.index({ tenantId: 1, createdAt: -1 });
saleSchema.index({ tenantId: 1, invoiceNo: 1 }, { unique: true });

export const SaleModel =
  (mongoose.models.Sale as mongoose.Model<ISale> | undefined) ??
  mongoose.model<ISale>('Sale', saleSchema);

// 7. Supplier
export interface ISupplier extends Document {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  name: string;
  phone: string;
  address: string;
  totalDue: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const supplierSchema = new Schema<ISupplier>(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    name: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true },
    address: { type: String, default: '' },
    totalDue: { type: Number, default: 0, min: 0 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

export const SupplierModel =
  (mongoose.models.Supplier as mongoose.Model<ISupplier> | undefined) ??
  mongoose.model<ISupplier>('Supplier', supplierSchema);

// 8. Purchase
export interface IPurchaseItem {
  productId: Types.ObjectId;
  name: string;
  qty: number;
  costPrice: number;
  lineTotal: number;
}

export interface IPurchase extends Document {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  supplierId: Types.ObjectId;
  items: IPurchaseItem[];
  total: number;
  paidAmount: number;
  dueAmount: number;
  status: PurchaseStatus;
  receivedAt: Date;
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const purchaseItemSchema = new Schema<IPurchaseItem>(
  {
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    name: { type: String, required: true },
    qty: { type: Number, required: true, min: 1 },
    costPrice: { type: Number, required: true, min: 0 },
    lineTotal: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

const purchaseSchema = new Schema<IPurchase>(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    supplierId: { type: Schema.Types.ObjectId, ref: 'Supplier', required: true },
    items: { type: [purchaseItemSchema], required: true },
    total: { type: Number, required: true, min: 0 },
    paidAmount: { type: Number, required: true, min: 0 },
    dueAmount: { type: Number, required: true, min: 0 },
    status: { type: String, enum: PURCHASE_STATUSES, required: true, default: 'received' },
    receivedAt: { type: Date, default: Date.now },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);

export const PurchaseModel =
  (mongoose.models.Purchase as mongoose.Model<IPurchase> | undefined) ??
  mongoose.model<IPurchase>('Purchase', purchaseSchema);

// 9. DuePayment
export interface IDuePayment extends Document {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  partyType: 'customer' | 'supplier';
  partyName: string;
  partyPhone: string;
  refId: Types.ObjectId;
  amount: number;
  method: PaymentMethod;
  receivedBy: Types.ObjectId;
  createdAt: Date;
}

const duePaymentSchema = new Schema<IDuePayment>(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    partyType: { type: String, enum: ['customer', 'supplier'], required: true },
    partyName: { type: String, required: true },
    partyPhone: { type: String, default: '' },
    refId: { type: Schema.Types.ObjectId, required: true },
    amount: { type: Number, required: true, min: 0.01 },
    method: { type: String, enum: PAYMENT_METHODS, default: 'cash' },
    receivedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

export const DuePaymentModel =
  (mongoose.models.DuePayment as mongoose.Model<IDuePayment> | undefined) ??
  mongoose.model<IDuePayment>('DuePayment', duePaymentSchema);

// 10. Payment (Billing)
export interface IPayment extends Document {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  provider: BillingProviderName;
  providerRef: string;
  eventId: string;
  amount: number;
  currency: string;
  status: 'pending' | 'paid' | 'failed' | 'refunded';
  purpose: 'subscription' | 'sale';
  raw: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

const paymentSchema = new Schema<IPayment>(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    provider: { type: String, enum: BILLING_PROVIDERS, required: true },
    providerRef: { type: String, required: true },
    eventId: { type: String, required: true },
    amount: { type: Number, required: true },
    currency: { type: String, default: DEFAULT_CURRENCY },
    status: {
      type: String,
      enum: ['pending', 'paid', 'failed', 'refunded'],
      default: 'pending',
    },
    purpose: { type: String, enum: ['subscription', 'sale'], default: 'subscription' },
    raw: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);

paymentSchema.index({ provider: 1, eventId: 1 }, { unique: true });

export const PaymentModel =
  (mongoose.models.Payment as mongoose.Model<IPayment> | undefined) ??
  mongoose.model<IPayment>('Payment', paymentSchema);

// 11. Subscription
export interface ISubscription extends Document {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  provider: BillingProviderName;
  plan: PlanType;
  status: 'active' | 'past_due' | 'cancelled' | 'expired';
  currentPeriodEnd: Date;
  providerSubscriptionId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const subscriptionSchema = new Schema<ISubscription>(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    provider: { type: String, enum: BILLING_PROVIDERS, required: true },
    plan: { type: String, enum: PLANS, required: true, default: 'pro' },
    status: {
      type: String,
      enum: ['active', 'past_due', 'cancelled', 'expired'],
      default: 'active',
    },
    currentPeriodEnd: { type: Date, required: true },
    providerSubscriptionId: { type: String, default: null },
  },
  { timestamps: true },
);

export const SubscriptionModel =
  (mongoose.models.Subscription as mongoose.Model<ISubscription> | undefined) ??
  mongoose.model<ISubscription>('Subscription', subscriptionSchema);

// 12. Notification
export interface INotification extends Document {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  userId: Types.ObjectId | null;
  type: 'low_stock' | 'due_reminder' | 'payment' | 'subscription';
  title: string;
  body: string;
  link: string;
  isRead: boolean;
  createdAt: Date;
}

const notificationSchema = new Schema<INotification>(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    type: {
      type: String,
      enum: ['low_stock', 'due_reminder', 'payment', 'subscription'],
      required: true,
    },
    title: { type: String, required: true },
    body: { type: String, required: true },
    link: { type: String, default: '/app/dashboard' },
    isRead: { type: Boolean, default: false },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

notificationSchema.index({ tenantId: 1, userId: 1, createdAt: -1 });

export const NotificationModel =
  (mongoose.models.Notification as mongoose.Model<INotification> | undefined) ??
  mongoose.model<INotification>('Notification', notificationSchema);

// 13. AuditLog
export interface IAuditLog extends Document {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  userId: Types.ObjectId;
  action: string;
  entity: string;
  entityId: string;
  changes: Record<string, unknown>;
  createdAt: Date;
}

const auditLogSchema = new Schema<IAuditLog>(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    action: { type: String, required: true },
    entity: { type: String, required: true },
    entityId: { type: String, required: true },
    changes: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

export const AuditLogModel =
  (mongoose.models.AuditLog as mongoose.Model<IAuditLog> | undefined) ??
  mongoose.model<IAuditLog>('AuditLog', auditLogSchema);
