import React from 'react';
import { Printer } from 'lucide-react';
import { PAYMENT_METHODS, type PaymentMethod } from '@dokanos/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatBDT } from '@/lib/utils';

export function SaleForm({
  subtotal,
  discount,
  safeDiscount,
  grandTotal,
  customPaidAmount,
  bakiDueAmount,
  paymentMethod,
  customerName,
  customerPhone,
  isOffline,
  isPending,
  disabled,
  onDiscountChange,
  onPaidAmountChange,
  onPaymentMethodChange,
  onCustomerNameChange,
  onCustomerPhoneChange,
  onSubmit,
}: {
  subtotal: number;
  discount: number;
  safeDiscount: number;
  grandTotal: number;
  customPaidAmount: string;
  bakiDueAmount: number;
  paymentMethod: PaymentMethod;
  customerName: string;
  customerPhone: string;
  isOffline: boolean;
  isPending: boolean;
  disabled: boolean;
  onDiscountChange: (discount: number) => void;
  onPaidAmountChange: (paid: string) => void;
  onPaymentMethodChange: (method: PaymentMethod) => void;
  onCustomerNameChange: (name: string) => void;
  onCustomerPhoneChange: (phone: string) => void;
  onSubmit: () => void;
}): React.ReactElement {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor="pos-discount" className="text-xs">
            Discount (৳)
          </Label>
          <Input
            id="pos-discount"
            type="number"
            min={0}
            value={discount || ''}
            onChange={(e) => onDiscountChange(Number(e.target.value))}
            placeholder="0"
            className="h-9 font-mono tabular-nums"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="pos-paid" className="text-xs">
            Paid Now (৳) — Blank = Full
          </Label>
          <Input
            id="pos-paid"
            type="number"
            min={0}
            value={customPaidAmount}
            onChange={(e) => onPaidAmountChange(e.target.value)}
            placeholder={String(grandTotal)}
            className="h-9 font-mono tabular-nums"
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">Payment Method</Label>
        <div className="grid grid-cols-4 gap-1.5 p-1 bg-secondary rounded-md">
          {PAYMENT_METHODS.map((method) => (
            <button
              key={method}
              type="button"
              onClick={() => onPaymentMethodChange(method)}
              className={`py-1.5 px-2 rounded text-xs font-medium uppercase transition-colors cursor-pointer ${
                paymentMethod === method
                  ? 'bg-primary text-white'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {method}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor="pos-cust-name" className="text-xs">
            Customer Name {bakiDueAmount > 0 ? '(Required for Baki)' : '(Optional)'}
          </Label>
          <Input
            id="pos-cust-name"
            value={customerName}
            onChange={(e) => onCustomerNameChange(e.target.value)}
            placeholder="Walk-in Customer"
            className="h-9 text-xs"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="pos-cust-phone" className="text-xs">
            Customer Phone
          </Label>
          <Input
            id="pos-cust-phone"
            value={customerPhone}
            onChange={(e) => onCustomerPhoneChange(e.target.value)}
            placeholder="017XXXXXXXX"
            className="h-9 text-xs font-mono"
          />
        </div>
      </div>

      <div className="rounded-md border border-border bg-secondary/60 p-4 space-y-2">
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>Subtotal</span>
          <span className="font-mono tabular-nums">{formatBDT(subtotal)}</span>
        </div>
        {safeDiscount > 0 && (
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Discount</span>
            <span className="font-mono tabular-nums">−{formatBDT(safeDiscount)}</span>
          </div>
        )}
        <div className="flex justify-between items-baseline pt-1 border-t border-border">
          <span className="font-display text-sm font-semibold">Grand Total</span>
          <span className="font-display text-3xl font-bold tabular-nums text-primary">
            {formatBDT(grandTotal)}
          </span>
        </div>
        {bakiDueAmount > 0 && (
          <div className="flex justify-between text-xs text-warning font-medium pt-1">
            <span>Recorded as Customer Baki Due</span>
            <span className="font-mono tabular-nums">{formatBDT(bakiDueAmount)}</span>
          </div>
        )}
      </div>

      <Button
        className="w-full"
        size="lg"
        disabled={disabled || isPending}
        onClick={onSubmit}
      >
        <Printer className="h-4 w-4" />
        {isPending
          ? 'Settling Transaction...'
          : isOffline
            ? 'Queue Offline Sale & Print Receipt'
            : 'Settle & Print Receipt'}
      </Button>
    </div>
  );
}
