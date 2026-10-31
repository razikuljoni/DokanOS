import React from 'react';
import { formatBDT, formatDateDhaka } from '@/lib/utils';

export type ThermalPaperWidth = '80mm' | '58mm';

export interface PrintableSaleItem {
  name: string;
  qty: number;
  price: number;
  lineTotal: number;
}

export interface PrintableSale {
  _id: string;
  invoiceNo: string;
  items: PrintableSaleItem[];
  subtotal: number;
  discount: number;
  total: number;
  paidAmount: number;
  dueAmount: number;
  paymentMethod: string;
  paymentStatus: 'paid' | 'partial' | 'due';
  customerName: string;
  customerPhone?: string;
  isReturned?: boolean;
  isOfflineQueued?: boolean;
  soldBy?: { name: string; role: string };
  createdAt: string;
}

export interface ThermalReceiptProps {
  sale: PrintableSale;
  shopName?: string;
  shopType?: string;
  shopSlug?: string;
  cashierName?: string;
  paperWidth?: ThermalPaperWidth;
  className?: string;
}

export function ThermalReceipt({
  sale,
  shopName = 'DokanOS Retail Shop',
  shopType,
  shopSlug,
  cashierName,
  paperWidth = '80mm',
  className = '',
}: ThermalReceiptProps): React.ReactElement {
  const totalUnits = sale.items.reduce((sum, item) => sum + item.qty, 0);
  const resolvedCashier = sale.soldBy?.name || cashierName || 'Counter Staff';
  const isCompact = paperWidth === '58mm';

  return (
    <div
      className={`thermal-print-area ${
        isCompact ? 'thermal-paper-58mm max-w-[230px]' : 'thermal-paper-80mm max-w-[310px]'
      } w-full mx-auto bg-white text-[#1C1917] font-mono border border-[#E7E0D4] rounded-sm shadow-xs p-4 select-text ${className}`}
      data-testid="thermal-receipt"
      data-paper-width={paperWidth}
    >
      {/* Shop Header */}
      <div className="text-center space-y-0.5 pb-2.5 border-b border-dashed border-[#1C1917]/70">
        <div
          className={`font-display font-bold uppercase tracking-tight text-[#1C1917] ${
            isCompact ? 'text-sm' : 'text-base'
          }`}
        >
          {shopName}
        </div>
        {(shopType || shopSlug) && (
          <div className="text-[10px] uppercase tracking-wider text-[#57534E]">
            {shopType ? `${shopType} ledger` : ''}
            {shopType && shopSlug ? ' · ' : ''}
            {shopSlug ? `#${shopSlug}` : ''}
          </div>
        )}
        <div className="pt-1">
          <span className="inline-block border border-[#1C1917] px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest">
            {sale.dueAmount > 0 ? 'BAKI / CREDIT MEMO' : 'CASH MEMO'}
          </span>
        </div>
        {sale.isReturned && (
          <div className="pt-1">
            <span className="inline-block border border-[#B91C1C] text-[#B91C1C] px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest">
              RETURNED &amp; RESTOCKED
            </span>
          </div>
        )}
      </div>

      {/* Invoice & Customer Metadata */}
      <div className="py-2 space-y-1 text-[11px] leading-tight border-b border-dashed border-[#1C1917]/70">
        <div className="flex justify-between gap-2">
          <span className="text-[#57534E] shrink-0">INV NO:</span>
          <span className="font-bold text-right tabular-nums break-all">
            {sale.isOfflineQueued ? 'PENDING SYNC' : sale.invoiceNo}
          </span>
        </div>
        {sale.isOfflineQueued && (
          <div className="text-[10px] border border-dashed border-[#B45309] px-1.5 py-1 text-[#1C1917] font-medium text-center">
            Pending sync — invoice number assigned on sync
          </div>
        )}
        <div className="flex justify-between gap-2">
          <span className="text-[#57534E] shrink-0">DATE:</span>
          <span className="text-right tabular-nums">{formatDateDhaka(sale.createdAt)}</span>
        </div>
        <div className="flex justify-between gap-2">
          <span className="text-[#57534E] shrink-0">CUSTOMER:</span>
          <span className="text-right font-medium truncate">
            {sale.customerName || 'Walk-in Customer'}
          </span>
        </div>
        {sale.customerPhone && (
          <div className="flex justify-between gap-2">
            <span className="text-[#57534E] shrink-0">PHONE:</span>
            <span className="text-right tabular-nums">{sale.customerPhone}</span>
          </div>
        )}
        <div className="flex justify-between gap-2">
          <span className="text-[#57534E] shrink-0">CASHIER:</span>
          <span className="text-right truncate">{resolvedCashier}</span>
        </div>
      </div>

      {/* Line Items Table */}
      <div className="py-2 border-b border-dashed border-[#1C1917]/70">
        <div className="grid grid-cols-12 text-[10px] font-bold uppercase tracking-wider pb-1 border-b border-dotted border-[#1C1917]/50">
          <div className="col-span-6">ITEM</div>
          <div className="col-span-2 text-center">QTY</div>
          <div className="col-span-4 text-right">AMOUNT</div>
        </div>

        <div className="divide-y divide-dotted divide-[#1C1917]/30">
          {sale.items.map((item, idx) => (
            <div key={idx} className="py-1.5 text-[11px] leading-snug">
              <div className="font-semibold text-[#1C1917] break-words">{item.name}</div>
              <div className="grid grid-cols-12 items-baseline text-[10px] text-[#57534E] tabular-nums">
                <div className="col-span-6">@ {formatBDT(item.price)}</div>
                <div className="col-span-2 text-center font-semibold text-[#1C1917]">
                  ×{item.qty}
                </div>
                <div className="col-span-4 text-right font-bold text-[#1C1917] text-[11px]">
                  {formatBDT(item.lineTotal)}
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="pt-1.5 border-t border-dotted border-[#1C1917]/50 flex justify-between text-[10px] text-[#57534E] tabular-nums">
          <span>ITEMS: {sale.items.length} SKU(s)</span>
          <span>TOTAL QTY: {totalUnits}</span>
        </div>
      </div>

      {/* Totals & Baki Settlement */}
      <div className="py-2 space-y-1 text-[11px] tabular-nums border-b border-dashed border-[#1C1917]/70">
        <div className="flex justify-between">
          <span className="text-[#57534E]">SUBTOTAL</span>
          <span>{formatBDT(sale.subtotal)}</span>
        </div>
        {sale.discount > 0 && (
          <div className="flex justify-between">
            <span className="text-[#57534E]">DISCOUNT</span>
            <span>−{formatBDT(sale.discount)}</span>
          </div>
        )}

        <div className="py-1.5 my-1 border-y border-[#1C1917] flex justify-between items-baseline font-bold text-xs">
          <span>GRAND TOTAL</span>
          <span className={isCompact ? 'text-sm' : 'text-base'}>{formatBDT(sale.total)}</span>
        </div>

        <div className="flex justify-between">
          <span className="text-[#57534E]">PAID ({sale.paymentMethod.toUpperCase()})</span>
          <span className="font-semibold">{formatBDT(sale.paidAmount)}</span>
        </div>

        <div className="flex justify-between">
          <span className="text-[#57534E]">STATUS</span>
          <span className="font-bold uppercase">{sale.paymentStatus}</span>
        </div>

        {sale.dueAmount > 0 && (
          <div className="mt-1.5 p-1.5 border border-[#1C1917] flex justify-between items-center font-bold text-xs">
            <span>BAKI DUE</span>
            <span>{formatBDT(sale.dueAmount)}</span>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="pt-2.5 text-center space-y-1 text-[10px] leading-tight text-[#57534E]">
        <div className="font-mono tracking-widest text-[9px] text-[#1C1917] uppercase">
          * {sale.isOfflineQueued ? 'OFFLINE-OUTBOX' : sale.invoiceNo} *
        </div>
        <div className="font-medium text-[#1C1917]">ধন্যবাদ · Thank you for your purchase!</div>
        <div>Please keep this receipt for returns or Baki settlement.</div>
        <div className="pt-0.5 text-[9px] uppercase tracking-wider">DokanOS Retail Ledger</div>
      </div>
    </div>
  );
}
