import React from 'react';
import { X } from 'lucide-react';
import { PAYMENT_METHODS, type PaymentMethod } from '@dokanos/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatBDT } from '@/lib/utils';

export interface DuePaymentDialogTarget {
  refId: string;
  refNo: string;
  partyType: 'customer' | 'supplier';
  partyName: string;
  dueAmount: number;
}

export function DuePaymentDialog({
  target,
  amount,
  method,
  isOffline = false,
  isPending = false,
  onAmountChange,
  onMethodChange,
  onConfirm,
  onClose,
}: {
  target: DuePaymentDialogTarget | null;
  amount: string;
  method: PaymentMethod;
  isOffline?: boolean;
  isPending?: boolean;
  onAmountChange: (amount: string) => void;
  onMethodChange: (method: PaymentMethod) => void;
  onConfirm: () => void;
  onClose: () => void;
}): React.ReactElement | null {
  if (!target) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-card border border-border rounded-md max-w-md w-full p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-lg font-bold">
            Record {target.partyType === 'customer' ? 'Customer' : 'Supplier'} Payment
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="text-xs text-muted-foreground space-y-1">
          <div>
            Party: <strong className="text-foreground">{target.partyName}</strong> ({target.refNo})
          </div>
          <div>
            Outstanding Due:{' '}
            <strong className="font-mono text-foreground">{formatBDT(target.dueAmount)}</strong>
          </div>
          {isOffline && (
            <div className="pt-1 text-warning font-medium">
              Offline Mode: Payment will update local Baki balance immediately and queue in Outbox.
            </div>
          )}
        </div>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="due-amt">Payment Amount (৳)</Label>
            <Input
              id="due-amt"
              type="number"
              min={1}
              max={target.dueAmount}
              value={amount}
              onChange={(e) => onAmountChange(e.target.value)}
              className="font-mono tabular-nums"
            />
          </div>

          <div className="space-y-1">
            <Label>Payment Method</Label>
            <div className="grid grid-cols-4 gap-1.5 p-1 bg-secondary rounded-md">
              {PAYMENT_METHODS.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => onMethodChange(m)}
                  className={`py-1.5 rounded text-xs font-medium uppercase cursor-pointer ${
                    method === m
                      ? 'bg-primary text-white'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={isPending || Number(amount) <= 0}
            onClick={onConfirm}
          >
            {isPending
              ? 'Recording...'
              : isOffline
                ? 'Queue Offline Payment'
                : 'Confirm Payment'}
          </Button>
        </div>
      </div>
    </div>
  );
}
