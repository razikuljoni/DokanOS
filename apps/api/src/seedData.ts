import { Types } from 'mongoose';
import bcrypt from 'bcryptjs';
import {
  AuditLogModel,
  DuePaymentModel,
  NotificationModel,
  PaymentModel,
  ProductModel,
  PurchaseModel,
  SaleModel,
  StockMovementModel,
  SubscriptionModel,
  SupplierModel,
  TenantModel,
  UserModel,
} from './models/index.js';
import { logger } from './config/logger.js';
import type { ProductUnit } from '@dokanos/shared';

interface SeedProductSpec {
  name: string;
  category: 'Medicine' | 'Surgical' | 'Baby Care' | 'Daily Needs';
  unit: ProductUnit;
  sku: string;
  costPrice: number;
  sellPrice: number;
  stock: number;
  lowStockAt: number;
}

const FORTY_PRODUCTS: SeedProductSpec[] = [
  // 5 deliberately low-stock items
  { name: 'Napa Extra 500mg (Box)', category: 'Medicine', unit: 'box', sku: 'MED-001', costPrice: 240, sellPrice: 300, stock: 4, lowStockAt: 12 },
  { name: 'Seclo 20mg Capsule (Box)', category: 'Medicine', unit: 'box', sku: 'MED-002', costPrice: 480, sellPrice: 600, stock: 6, lowStockAt: 15 },
  { name: 'SMC ORS Saline (Box of 20)', category: 'Daily Needs', unit: 'box', sku: 'DLN-001', costPrice: 95, sellPrice: 120, stock: 5, lowStockAt: 20 },
  { name: 'Azithral 500mg Tablet (Strip)', category: 'Medicine', unit: 'strip', sku: 'MED-003', costPrice: 140, sellPrice: 175, stock: 3, lowStockAt: 10 },
  { name: 'Accu-Chek Glucometer Strips (50s)', category: 'Surgical', unit: 'box', sku: 'SRG-001', costPrice: 1150, sellPrice: 1420, stock: 2, lowStockAt: 8 },

  // Remaining 35 well-stocked items
  { name: 'Sergel 20mg Capsule (Strip)', category: 'Medicine', unit: 'strip', sku: 'MED-004', costPrice: 56, sellPrice: 70, stock: 85, lowStockAt: 15 },
  { name: 'Maxpro 20mg Tablet (Strip)', category: 'Medicine', unit: 'strip', sku: 'MED-005', costPrice: 54, sellPrice: 70, stock: 72, lowStockAt: 15 },
  { name: 'Monas 10mg Tablet (Box)', category: 'Medicine', unit: 'box', sku: 'MED-006', costPrice: 390, sellPrice: 480, stock: 34, lowStockAt: 10 },
  { name: 'Bizoran 5/20mg Tablet (Strip)', category: 'Medicine', unit: 'strip', sku: 'MED-007', costPrice: 95, sellPrice: 120, stock: 48, lowStockAt: 10 },
  { name: 'Finix 20mg Tablet (Strip)', category: 'Medicine', unit: 'strip', sku: 'MED-008', costPrice: 55, sellPrice: 70, stock: 64, lowStockAt: 12 },
  { name: 'Pantonix 20mg Tablet (Strip)', category: 'Medicine', unit: 'strip', sku: 'MED-009', costPrice: 48, sellPrice: 60, stock: 90, lowStockAt: 15 },
  { name: 'Tufnil 200mg Tablet (Strip)', category: 'Medicine', unit: 'strip', sku: 'MED-010', costPrice: 80, sellPrice: 100, stock: 55, lowStockAt: 10 },
  { name: 'Alatrol 10mg Tablet (Strip)', category: 'Medicine', unit: 'strip', sku: 'MED-011', costPrice: 24, sellPrice: 30, stock: 110, lowStockAt: 20 },
  { name: 'Fexo 120mg Tablet (Strip)', category: 'Medicine', unit: 'strip', sku: 'MED-012', costPrice: 72, sellPrice: 90, stock: 68, lowStockAt: 12 },
  { name: 'Ceevit 250mg Chewable (Strip)', category: 'Medicine', unit: 'strip', sku: 'MED-013', costPrice: 15, sellPrice: 20, stock: 140, lowStockAt: 25 },
  { name: 'Losectil 20mg Capsule (Strip)', category: 'Medicine', unit: 'strip', sku: 'MED-014', costPrice: 40, sellPrice: 50, stock: 75, lowStockAt: 15 },
  { name: 'Napa Syrup 60ml', category: 'Medicine', unit: 'bottle', sku: 'MED-015', costPrice: 28, sellPrice: 35, stock: 52, lowStockAt: 10 },
  { name: 'Entacyd Plus Suspension 200ml', category: 'Medicine', unit: 'bottle', sku: 'MED-016', costPrice: 75, sellPrice: 95, stock: 38, lowStockAt: 10 },
  { name: 'Gavisol Oral Suspension 200ml', category: 'Medicine', unit: 'bottle', sku: 'MED-017', costPrice: 165, sellPrice: 210, stock: 29, lowStockAt: 8 },
  { name: 'Calbo-D Tablet (30s Bottle)', category: 'Medicine', unit: 'bottle', sku: 'MED-018', costPrice: 190, sellPrice: 240, stock: 44, lowStockAt: 10 },
  { name: 'Neuro-B Tablet (30s Bottle)', category: 'Medicine', unit: 'bottle', sku: 'MED-019', costPrice: 210, sellPrice: 270, stock: 36, lowStockAt: 10 },
  { name: 'Comet 500mg Tablet (Strip)', category: 'Medicine', unit: 'strip', sku: 'MED-020', costPrice: 32, sellPrice: 40, stock: 95, lowStockAt: 15 },
  { name: 'Secrin 2mg Tablet (Strip)', category: 'Medicine', unit: 'strip', sku: 'MED-021', costPrice: 88, sellPrice: 110, stock: 42, lowStockAt: 10 },
  { name: 'Osartil 50mg Tablet (Strip)', category: 'Medicine', unit: 'strip', sku: 'MED-022', costPrice: 64, sellPrice: 80, stock: 58, lowStockAt: 12 },
  { name: 'Atova 10mg Tablet (Strip)', category: 'Medicine', unit: 'strip', sku: 'MED-023', costPrice: 70, sellPrice: 90, stock: 61, lowStockAt: 12 },
  { name: 'Hexisol Hand Rub 250ml', category: 'Surgical', unit: 'bottle', sku: 'SRG-002', costPrice: 105, sellPrice: 130, stock: 40, lowStockAt: 10 },
  { name: 'Savlon Antiseptic Liquid 500ml', category: 'Surgical', unit: 'bottle', sku: 'SRG-003', costPrice: 185, sellPrice: 230, stock: 32, lowStockAt: 8 },
  { name: 'Digital Fever Thermometer', category: 'Surgical', unit: 'pcs', sku: 'SRG-004', costPrice: 160, sellPrice: 220, stock: 25, lowStockAt: 6 },
  { name: 'Omron Upper Arm BP Monitor', category: 'Surgical', unit: 'pcs', sku: 'SRG-005', costPrice: 2850, sellPrice: 3400, stock: 11, lowStockAt: 4 },
  { name: 'Sterile Surgical Gauze Roll', category: 'Surgical', unit: 'pcs', sku: 'SRG-006', costPrice: 35, sellPrice: 50, stock: 65, lowStockAt: 15 },
  { name: '3-Ply Surgical Face Mask (Box 50)', category: 'Surgical', unit: 'box', sku: 'SRG-007', costPrice: 140, sellPrice: 200, stock: 45, lowStockAt: 10 },
  { name: 'Disposable Insulin Syringe 100IU (10s)', category: 'Surgical', unit: 'box', sku: 'SRG-008', costPrice: 95, sellPrice: 130, stock: 50, lowStockAt: 10 },
  { name: 'Pampers Baby Dry Diaper Medium (40s)', category: 'Baby Care', unit: 'box', sku: 'BBY-001', costPrice: 920, sellPrice: 1100, stock: 22, lowStockAt: 6 },
  { name: 'Lactogen 1 Infant Formula 400g', category: 'Baby Care', unit: 'box', sku: 'BBY-002', costPrice: 540, sellPrice: 620, stock: 28, lowStockAt: 8 },
  { name: 'Cerelac Wheat & Milk 350g', category: 'Baby Care', unit: 'box', sku: 'BBY-003', costPrice: 360, sellPrice: 420, stock: 31, lowStockAt: 8 },
  { name: 'Johnson Baby Lotion 200ml', category: 'Baby Care', unit: 'bottle', sku: 'BBY-004', costPrice: 280, sellPrice: 350, stock: 24, lowStockAt: 6 },
  { name: 'Huggies Wonder Pants Large (36s)', category: 'Baby Care', unit: 'box', sku: 'BBY-005', costPrice: 880, sellPrice: 1050, stock: 19, lowStockAt: 5 },
  { name: 'Horlicks Standard Jar 500g', category: 'Daily Needs', unit: 'bottle', sku: 'DLN-002', costPrice: 390, sellPrice: 450, stock: 27, lowStockAt: 8 },
  { name: 'Glaxose-D Glucose Powder 400g', category: 'Daily Needs', unit: 'box', sku: 'DLN-003', costPrice: 145, sellPrice: 180, stock: 42, lowStockAt: 10 },
  { name: 'Sensodyne Rapid Relief Toothpaste 100g', category: 'Daily Needs', unit: 'pcs', sku: 'DLN-004', costPrice: 210, sellPrice: 260, stock: 33, lowStockAt: 8 },
];

export async function seedDemoData(forceReset = false): Promise<void> {
  const existingTenant = await TenantModel.findOne({ slug: 'rahim-pharmacy' });
  if (existingTenant && !forceReset) {
    const productCount = await ProductModel.countDocuments({ tenantId: existingTenant._id });
    if (productCount >= 40) {
      logger.info('Demo tenant "Rahim Pharmacy" already seeded; skipping.');
      return;
    }
  }

  if (existingTenant) {
    const tid = existingTenant._id;
    await Promise.all([
      ProductModel.deleteMany({ tenantId: tid }),
      SaleModel.deleteMany({ tenantId: tid }),
      PurchaseModel.deleteMany({ tenantId: tid }),
      SupplierModel.deleteMany({ tenantId: tid }),
      StockMovementModel.deleteMany({ tenantId: tid }),
      DuePaymentModel.deleteMany({ tenantId: tid }),
      NotificationModel.deleteMany({ tenantId: tid }),
      PaymentModel.deleteMany({ tenantId: tid }),
      SubscriptionModel.deleteMany({ tenantId: tid }),
      AuditLogModel.deleteMany({ tenantId: tid }),
      UserModel.deleteMany({ tenantId: tid }),
      TenantModel.deleteOne({ _id: tid }),
    ]);
  }

  const tenantId = new Types.ObjectId();
  const ownerId = new Types.ObjectId();
  const managerId = new Types.ObjectId();
  const staffId = new Types.ObjectId();

  const passwordHash = await bcrypt.hash('Demo1234!', 12);
  const planExpiresAt = new Date(Date.now() + 25 * 24 * 60 * 60 * 1000);

  await TenantModel.create({
    _id: tenantId,
    name: 'Rahim Pharmacy',
    slug: 'rahim-pharmacy',
    type: 'pharmacy',
    plan: 'pro',
    planExpiresAt,
    ownerId,
    invoiceCounter: 120,
    settings: {
      lowStockThreshold: 10,
      currency: 'BDT',
    },
  });

  await UserModel.insertMany([
    {
      _id: ownerId,
      name: 'Abdur Rahim',
      email: 'demo@dokan-os.demo',
      passwordHash,
      role: 'owner',
      tenantId,
      status: 'active',
      lastLoginAt: new Date(),
    },
    {
      _id: managerId,
      name: 'Tanvir Hasan',
      email: 'manager@dokan-os.demo',
      passwordHash,
      role: 'manager',
      tenantId,
      status: 'active',
      lastLoginAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
    },
    {
      _id: staffId,
      name: 'Sabbir Hossain',
      email: 'staff@dokan-os.demo',
      passwordHash,
      role: 'staff',
      tenantId,
      status: 'active',
      lastLoginAt: new Date(Date.now() - 35 * 60 * 1000),
    },
  ]);

  // 3 Suppliers
  const sup1Id = new Types.ObjectId();
  const sup2Id = new Types.ObjectId();
  const sup3Id = new Types.ObjectId();

  await SupplierModel.insertMany([
    {
      _id: sup1Id,
      tenantId,
      name: 'Square Pharmaceuticals Distributor',
      phone: '01711-234567',
      address: 'Section 10, Mirpur, Dhaka-1216',
      totalDue: 18500,
      isActive: true,
    },
    {
      _id: sup2Id,
      tenantId,
      name: 'ACI Healthcare Depot',
      phone: '01819-876543',
      address: 'Tejgaon Industrial Area, Dhaka-1208',
      totalDue: 9200,
      isActive: true,
    },
    {
      _id: sup3Id,
      tenantId,
      name: 'Mirpur Medical Wholesalers',
      phone: '01912-345678',
      address: 'Shah Ali Market, Mirpur-1, Dhaka',
      totalDue: 6400,
      isActive: true,
    },
  ]);

  // 40 Realistic Products
  const productDocs = await ProductModel.insertMany(
    FORTY_PRODUCTS.map((p, idx) => ({
      tenantId,
      name: p.name,
      category: p.category,
      unit: p.unit,
      sku: p.sku,
      costPrice: p.costPrice,
      sellPrice: p.sellPrice,
      stock: p.stock,
      lowStockAt: p.lowStockAt,
      supplierId: idx % 3 === 0 ? sup1Id : idx % 3 === 1 ? sup2Id : sup3Id,
      isActive: true,
    })),
  );

  // 8 Purchases (4 paid, 4 with supplier dues across ageing buckets)
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;

  const purchaseConfigs = [
    { supplierId: sup1Id, daysAgo: 2, total: 24000, paidAmount: 14500, dueAmount: 9500 },
    { supplierId: sup1Id, daysAgo: 18, total: 19000, paidAmount: 10000, dueAmount: 9000 },
    { supplierId: sup2Id, daysAgo: 11, total: 15200, paidAmount: 6000, dueAmount: 9200 },
    { supplierId: sup3Id, daysAgo: 35, total: 12400, paidAmount: 6000, dueAmount: 6400 },
    { supplierId: sup1Id, daysAgo: 5, total: 14000, paidAmount: 14000, dueAmount: 0 },
    { supplierId: sup2Id, daysAgo: 9, total: 11500, paidAmount: 11500, dueAmount: 0 },
    { supplierId: sup3Id, daysAgo: 15, total: 8800, paidAmount: 8800, dueAmount: 0 },
    { supplierId: sup1Id, daysAgo: 24, total: 16200, paidAmount: 16200, dueAmount: 0 },
  ];

  for (let i = 0; i < purchaseConfigs.length; i++) {
    const cfg = purchaseConfigs[i]!;
    const pDoc = productDocs[i + 5]!;
    const createdAt = new Date(now - cfg.daysAgo * dayMs);
    await PurchaseModel.create({
      tenantId,
      supplierId: cfg.supplierId,
      items: [
        {
          productId: pDoc._id,
          name: pDoc.name,
          qty: 20,
          costPrice: Number((cfg.total / 20).toFixed(2)),
          lineTotal: cfg.total,
        },
      ],
      total: cfg.total,
      paidAmount: cfg.paidAmount,
      dueAmount: cfg.dueAmount,
      status: cfg.dueAmount === 0 ? 'received' : 'partial',
      receivedAt: createdAt,
      createdBy: ownerId,
      createdAt,
      updatedAt: createdAt,
    });
  }

  // 120 Sales spread over the last 30 days (including 6 open customer dues across 0-7, 8-30, 30+ buckets)
  const customerDueIndices = new Map<
    number,
    { name: string; phone: string; daysAgo: number; dueRatio: number }
  >([
    [4, { name: 'Kamrul Islam', phone: '01712-901122', daysAgo: 2, dueRatio: 0.5 }],
    [19, { name: 'Farzana Akter', phone: '01815-443322', daysAgo: 5, dueRatio: 1.0 }],
    [42, { name: 'Mahbubur Rahman', phone: '01911-778899', daysAgo: 12, dueRatio: 0.6 }],
    [68, { name: 'Nusrat Jahan', phone: '01614-556677', daysAgo: 21, dueRatio: 0.75 }],
    [95, { name: 'Rafiqul Alam', phone: '01718-223344', daysAgo: 33, dueRatio: 1.0 }],
    [112, { name: 'Shahinoor Begum', phone: '01812-665544', daysAgo: 38, dueRatio: 0.8 }],
  ]);

  const salesToInsert = [];
  const movementsToInsert = [];
  const methods = ['cash', 'bkash', 'card', 'cash'] as const;

  for (let i = 1; i <= 120; i++) {
    const dueSpec = customerDueIndices.get(i);
    const daysAgo = dueSpec ? dueSpec.daysAgo : Math.floor(((120 - i) / 120) * 29);
    const saleDate = new Date(now - daysAgo * dayMs - (i % 8) * 3600 * 1000);

    const p1 = productDocs[(i * 3) % productDocs.length]!;
    const p2 = productDocs[(i * 7 + 5) % productDocs.length]!;
    const qty1 = (i % 3) + 1;
    const qty2 = (i % 2) + 1;

    const line1 = Number((p1.sellPrice * qty1).toFixed(2));
    const line2 = Number((p2.sellPrice * qty2).toFixed(2));
    const subtotal = Number((line1 + line2).toFixed(2));
    const discount = i % 10 === 0 ? 20 : 0;
    const total = Number(Math.max(10, subtotal - discount).toFixed(2));

    let paidAmount = total;
    let dueAmount = 0;
    let paymentStatus: 'paid' | 'partial' | 'due' = 'paid';

    if (dueSpec) {
      dueAmount = Number((total * dueSpec.dueRatio).toFixed(2));
      paidAmount = Number((total - dueAmount).toFixed(2));
      paymentStatus = paidAmount === 0 ? 'due' : 'partial';
    }

    const invoiceNo = `INV-${String(i).padStart(4, '0')}`;
    const saleId = new Types.ObjectId();

    salesToInsert.push({
      _id: saleId,
      tenantId,
      invoiceNo,
      items: [
        {
          productId: p1._id,
          name: p1.name,
          qty: qty1,
          price: p1.sellPrice,
          costPrice: p1.costPrice,
          lineTotal: line1,
        },
        {
          productId: p2._id,
          name: p2.name,
          qty: qty2,
          price: p2.sellPrice,
          costPrice: p2.costPrice,
          lineTotal: line2,
        },
      ],
      subtotal,
      discount,
      total,
      paymentMethod: methods[i % methods.length]!,
      paymentStatus,
      paidAmount,
      dueAmount,
      customerName: dueSpec ? dueSpec.name : i % 4 === 0 ? 'Regular Customer' : 'Walk-in Customer',
      customerPhone: dueSpec ? dueSpec.phone : '',
      soldBy: i % 3 === 0 ? ownerId : i % 3 === 1 ? managerId : staffId,
      isReturned: false,
      createdAt: saleDate,
      updatedAt: saleDate,
    });

    movementsToInsert.push({
      tenantId,
      productId: p1._id,
      type: 'sale' as const,
      qtyChange: -qty1,
      balanceAfter: p1.stock,
      refId: saleId,
      refType: 'Sale' as const,
      userId: staffId,
      note: `POS Sale ${invoiceNo}`,
      createdAt: saleDate,
    });
  }

  await SaleModel.insertMany(salesToInsert);
  await StockMovementModel.insertMany(movementsToInsert);

  // 3 Unread Notifications
  await NotificationModel.insertMany([
    {
      tenantId,
      userId: null,
      type: 'low_stock',
      title: '5 Products Below Low-Stock Threshold',
      body: 'Napa Extra 500mg (4 box), Seclo 20mg (6 box), Azithral 500mg (3 strip), and 2 others require reorder.',
      link: '/app/products?stockStatus=low',
      isRead: false,
    },
    {
      tenantId,
      userId: null,
      type: 'due_reminder',
      title: 'Overdue Baki Alert (30+ Days)',
      body: '2 customer dues and 1 supplier payable (Mirpur Medical Wholesalers) have exceeded 30 days.',
      link: '/app/dues',
      isRead: false,
    },
    {
      tenantId,
      userId: null,
      type: 'subscription',
      title: 'DokanOS Pro Plan Active',
      body: `Rahim Pharmacy is on DokanOS Pro (৳499/mo). Next renewal due ${planExpiresAt.toISOString().slice(0, 10)}.`,
      link: '/app/billing',
      isRead: false,
    },
  ]);

  // Seed initial Pro subscription & payment record
  await PaymentModel.create({
    tenantId,
    provider: 'sslcommerz',
    providerRef: 'DKN-RAHIM-SEED-001',
    eventId: 'DKN-RAHIM-SEED-001',
    amount: 499,
    currency: 'BDT',
    status: 'paid',
    purpose: 'subscription',
    raw: { card_type: 'VISA-Dutch Bangla', val_id: 'VAL-SEED-001' },
  });

  await SubscriptionModel.create({
    tenantId,
    provider: 'sslcommerz',
    plan: 'pro',
    status: 'active',
    currentPeriodEnd: planExpiresAt,
    providerSubscriptionId: null,
  });

  await AuditLogModel.insertMany([
    {
      tenantId,
      userId: ownerId,
      action: 'plan.upgraded',
      entity: 'Subscription',
      entityId: tenantId.toString(),
      changes: { plan: 'pro', provider: 'sslcommerz', amount: 499 },
    },
    {
      tenantId,
      userId: managerId,
      action: 'purchase.created',
      entity: 'Purchase',
      entityId: sup1Id.toString(),
      changes: { supplier: 'Square Pharmaceuticals Distributor', total: 24000 },
    },
  ]);

  logger.info(
    'Seeded Rahim Pharmacy demo tenant (40 products, 3 suppliers, 120 sales, 8 purchases, 10 dues, 3 unread alerts)',
  );
}
