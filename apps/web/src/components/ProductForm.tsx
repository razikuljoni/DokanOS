import React from 'react';
import { X } from 'lucide-react';
import { PRODUCT_UNITS, type CreateProductInput } from '@dokanos/shared';
import type { FieldErrors, UseFormRegister } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function ProductForm({
  isEditing,
  isSubmitting,
  errors,
  register,
  onSubmit,
  onClose,
}: {
  isEditing: boolean;
  isSubmitting: boolean;
  errors: FieldErrors<CreateProductInput>;
  register: UseFormRegister<CreateProductInput>;
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
  onClose: () => void;
}): React.ReactElement {
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-end">
      <div className="bg-card border-l border-border h-full max-w-md w-full p-6 flex flex-col justify-between overflow-y-auto">
        <div className="space-y-5">
          <div className="flex items-center justify-between border-b border-border pb-3">
            <h3 className="font-display text-lg font-bold">
              {isEditing ? 'Edit Product SKU' : 'New Product SKU'}
            </h3>
            <button
              type="button"
              onClick={onClose}
              className="text-muted-foreground hover:text-foreground cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <form id="product-form" onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="pf-name">Product Name</Label>
              <Input id="pf-name" {...register('name')} />
              {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="pf-cat">Category</Label>
                <Input id="pf-cat" {...register('category')} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="pf-unit">Unit</Label>
                <select
                  id="pf-unit"
                  {...register('unit')}
                  className="flex h-10 w-full rounded-md border border-input bg-card px-3 py-2 text-sm"
                >
                  {PRODUCT_UNITS.map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-1">
              <Label htmlFor="pf-sku">SKU Code (Unique per shop)</Label>
              <Input id="pf-sku" className="font-mono" {...register('sku')} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="pf-cost">Cost Price (৳)</Label>
                <Input
                  id="pf-cost"
                  type="number"
                  step="0.01"
                  className="font-mono tabular-nums"
                  {...register('costPrice', { valueAsNumber: true })}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="pf-sell">Sell Price (৳)</Label>
                <Input
                  id="pf-sell"
                  type="number"
                  step="0.01"
                  className="font-mono tabular-nums"
                  {...register('sellPrice', { valueAsNumber: true })}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="pf-stock">Current Stock</Label>
                <Input
                  id="pf-stock"
                  type="number"
                  className="font-mono tabular-nums"
                  {...register('stock', { valueAsNumber: true })}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="pf-low">Low-Stock Reorder At</Label>
                <Input
                  id="pf-low"
                  type="number"
                  className="font-mono tabular-nums"
                  {...register('lowStockAt', { valueAsNumber: true })}
                />
              </div>
            </div>
          </form>
        </div>

        <div className="flex justify-end gap-2 pt-4 border-t border-border">
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="product-form" size="sm" disabled={isSubmitting}>
            {isSubmitting ? 'Saving...' : isEditing ? 'Save Changes' : 'Create Product'}
          </Button>
        </div>
      </div>
    </div>
  );
}
