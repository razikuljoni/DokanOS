import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'motion/react';
import {
  CheckCircle2,
  Minus,
  Plus,
  Printer,
  Search,
  ShoppingCart,
  Trash2,
} from 'lucide-react';
import { PAYMENT_METHODS, type PaymentMethod } from '@dokanos/shared';
import { useAuthStore } from '@/stores/authStore';
import { useUiStore } from '@/stores/uiStore';
import { apiFetch } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { formatBDT, formatDateDhaka } from '@/lib/utils';

interface ProductItem {
  _id: string;
  name: string;
  category: string;
  unit: string;
  sku: string;
  sellPrice: number;
  stock: number;
  lowStockAt: number;
}

interface CartLine {
  product: ProductItem;
  qty: number;
}

interface CompletedSale {
  _id: string;
  invoiceNo: string;
  items: Array<{ name: string; qty: number; price: number; lineTotal: number }>;
  subtotal: number;
  discount: number;
  total: number;
  paidAmount: number;
  dueAmount: number;
  paymentMethod: string;
  paymentStatus: string;
  customerName: string;
  customerPhone: string;
  createdAt: string;
}

export function PosPage(): React.ReactElement {
  const tenant = useAuthStore((s) => s.tenant);
  const addToast = useUiStore((s) => s.addToast);
  const queryClient = useQueryClient();

  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [discount, setDiscount] = useState<number>(0);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [customPaidAmount, setCustomPaidAmount] = useState<string>('');
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [lastReceipt, setLastReceipt] = useState<CompletedSale | null>(null);

  const { data: productsRes, isLoading } = useQuery({
    queryKey: ['products', tenant?.id, 'pos-catalog'],
    queryFn: () =>
      apiFetch<{ data: ProductItem[] }>('/api/v1/products?limit=100&sort=name:asc'),
    enabled: Boolean(tenant?.id),
  });

  const products = productsRes?.data ?? [];

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const p of products) set.add(p.category);
    return ['all', ...Array.from(set)];
  }, [products]);

  const filteredProducts = useMemo(() => {
    return products.filter((p) => {
      if (selectedCategory !== 'all' && p.category !== selectedCategory) return false;
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return (
        p.name.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q)
      );
    });
  }, [products, selectedCategory, search]);

  const addToCart = (product: ProductItem): void => {
    if (product.stock <= 0) {
      addToast({
        title: 'Out of Stock',
        description: `${product.name} has 0 units available.`,
        variant: 'danger',
      });
      return;
    }

    setCart((prev) => {
      const existing = prev.find((item) => item.product._id === product._id);
      if (existing) {
        if (existing.qty >= product.stock) {
          addToast({
            title: 'Max Available Stock Reached',
            description: `Only ${product.stock} ${product.unit} in stock for ${product.name}.`,
            variant: 'warning',
          });
          return prev;
        }
        return prev.map((item) =>
          item.product._id === product._id ? { ...item, qty: item.qty + 1 } : item,
        );
      }
      return [...prev, { product, qty: 1 }];
    });
  };

  const updateCartQty = (productId: string, delta: number): void => {
    setCart((prev) =>
      prev
        .map((line) => {
          if (line.product._id !== productId) return line;
          const nextQty = line.qty + delta;
          if (nextQty > line.product.stock) {
            addToast({
              title: 'Stock Limit',
              description: `Only ${line.product.stock} available.`,
              variant: 'warning',
            });
            return line;
          }
          return { ...line, qty: nextQty };
        })
        .filter((line) => line.qty > 0),
    );
  };

  const subtotal = useMemo(
    () =>
      Number(
        cart
          .reduce((sum, line) => sum + line.product.sellPrice * line.qty, 0)
          .toFixed(2),
      ),
    [cart],
  );

  const safeDiscount = Math.min(Math.max(0, discount || 0), subtotal);
  const grandTotal = Number(Math.max(0, subtotal - safeDiscount).toFixed(2));
  const paidAmountNum =
    customPaidAmount.trim() === ''
      ? grandTotal
      : Math.min(Math.max(0, Number(customPaidAmount) || 0), grandTotal);
  const bakiDueAmount = Number(Math.max(0, grandTotal - paidAmountNum).toFixed(2));

  const createSaleMutation = useMutation({
    mutationFn: async () => {
      return apiFetch<{ data: CompletedSale }>('/api/v1/sales', {
        method: 'POST',
        body: JSON.stringify({
          items: cart.map((line) => ({
            productId: line.product._id,
            qty: line.qty,
          })),
          discount: safeDiscount,
          paymentMethod,
          paidAmount: paidAmountNum,
          customerName: customerName.trim() || 'Walk-in Customer',
          customerPhone: customerPhone.trim(),
        }),
      });
    },
    onSuccess: (res) => {
      setLastReceipt(res.data);
      setCart([]);
      setDiscount(0);
      setCustomPaidAmount('');
      setCustomerName('');
      setCustomerPhone('');

      void queryClient.invalidateQueries({ queryKey: ['products', tenant?.id] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard', tenant?.id] });
      void queryClient.invalidateQueries({ queryKey: ['sales', tenant?.id] });
      void queryClient.invalidateQueries({ queryKey: ['dues', tenant?.id] });

      addToast({
        title: `Sale Completed (${res.data.invoiceNo})`,
        description: `Total ${formatBDT(res.data.total)} · Stock decremented atomically.`,
        variant: 'success',
      });
    },
    onError: (err) => {
      addToast({
        title: 'Sale Failed',
        description: err instanceof Error ? err.message : 'Could not complete sale',
        variant: 'danger',
      });
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">
            POS Counter Terminal
          </h1>
          <p className="text-xs text-muted-foreground">
            Click any product to add to cart. Stock decrements atomically inside a MongoDB
            transaction.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left 7 Cols: Product Lookup Grid */}
        <div className="lg:col-span-7 space-y-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="h-4 w-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search medicine or product by name or SKU..."
                className="pl-9"
              />
            </div>

            {/* Interactive category filter buttons */}
            <div className="flex items-center gap-1 p-1 bg-secondary rounded-md overflow-x-auto">
              {categories.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setSelectedCategory(cat)}
                  className={`px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    selectedCategory === cat
                      ? 'bg-card text-foreground shadow-xs'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {cat === 'all' ? 'All Items' : cat}
                </button>
              ))}
            </div>
          </div>

          {isLoading ? (
            <div className="p-8 text-center text-xs text-muted-foreground border border-border rounded-md bg-card">
              Loading shop inventory...
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-[620px] overflow-y-auto pr-1">
              {filteredProducts.map((product) => {
                const isLow = product.stock > 0 && product.stock <= product.lowStockAt;
                const isOut = product.stock <= 0;

                return (
                  <button
                    key={product._id}
                    type="button"
                    disabled={isOut}
                    onClick={() => addToCart(product)}
                    className="text-left p-4 rounded-md border border-border bg-card hover:bg-secondary/50 disabled:opacity-50 transition-colors flex flex-col justify-between gap-2 cursor-pointer"
                  >
                    <div className="space-y-1">
                      <div className="font-display text-sm font-semibold text-foreground leading-snug">
                        {product.name}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        <span>{product.sku}</span>
                        <span aria-hidden="true"> · </span>
                        <span>{product.category}</span>
                      </div>
                    </div>

                    <div className="flex items-center justify-between pt-2 border-t border-border w-full">
                      <span className="font-mono text-sm font-bold tabular-nums text-foreground">
                        {formatBDT(product.sellPrice)}{' '}
                        <span className="text-[11px] font-normal text-muted-foreground">
                          / {product.unit}
                        </span>
                      </span>
                      <span
                        className={`text-xs font-mono tabular-nums ${
                          isOut
                            ? 'text-destructive font-semibold'
                            : isLow
                              ? 'text-warning font-medium'
                              : 'text-muted-foreground'
                        }`}
                      >
                        {isOut ? 'Out of stock' : `${product.stock} ${product.unit}`}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Right 5 Cols: Active POS Cart & Checkout */}
        <div className="lg:col-span-5">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <ShoppingCart className="h-4 w-4 text-primary" />
                  <span>Current Bill</span>
                </CardTitle>
                <span className="text-xs font-mono tabular-nums text-muted-foreground">
                  {cart.reduce((s, l) => s + l.qty, 0)} unit(s)
                </span>
              </div>
              <CardDescription>
                Adjust quantities, record Baki credit if partial, and settle receipt.
              </CardDescription>
            </CardHeader>

            <CardContent className="space-y-4">
              {cart.length === 0 ? (
                <div className="py-10 text-center border border-dashed border-border rounded-md bg-secondary/30 text-xs text-muted-foreground">
                  Cart is empty — select products from the left ledger to begin a sale.
                </div>
              ) : (
                <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                  <AnimatePresence initial={false}>
                    {cart.map((line) => (
                      <motion.div
                        key={line.product._id}
                        initial={{ opacity: 0, y: -6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.15 }}
                        className="p-2.5 rounded-md border border-border bg-secondary/40 flex items-center justify-between gap-2 text-xs"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="font-medium text-foreground truncate">
                            {line.product.name}
                          </div>
                          <div className="text-muted-foreground font-mono tabular-nums">
                            {formatBDT(line.product.sellPrice)} × {line.qty}
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            onClick={() => updateCartQty(line.product._id, -1)}
                            className="h-6 w-6 rounded border border-border bg-card flex items-center justify-center hover:bg-secondary cursor-pointer"
                          >
                            <Minus className="h-3 w-3" />
                          </button>
                          <span className="w-6 text-center font-mono tabular-nums font-semibold">
                            {line.qty}
                          </span>
                          <button
                            type="button"
                            onClick={() => updateCartQty(line.product._id, 1)}
                            className="h-6 w-6 rounded border border-border bg-card flex items-center justify-center hover:bg-secondary cursor-pointer"
                          >
                            <Plus className="h-3 w-3" />
                          </button>
                          <button
                            type="button"
                            onClick={() => updateCartQty(line.product._id, -line.qty)}
                            className="h-6 w-6 rounded text-muted-foreground hover:text-destructive flex items-center justify-center cursor-pointer"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>

                        <div className="w-20 text-right font-mono tabular-nums font-semibold">
                          {formatBDT(line.product.sellPrice * line.qty)}
                        </div>
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </div>
              )}

              <Separator />

              {/* Payment & Customer Details */}
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
                    onChange={(e) => setDiscount(Number(e.target.value))}
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
                    onChange={(e) => setCustomPaidAmount(e.target.value)}
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
                      onClick={() => setPaymentMethod(method)}
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
                    onChange={(e) => setCustomerName(e.target.value)}
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
                    onChange={(e) => setCustomerPhone(e.target.value)}
                    placeholder="017XXXXXXXX"
                    className="h-9 text-xs font-mono"
                  />
                </div>
              </div>

              {/* Big Tabular Total Box */}
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

              {/* Primary CTA matches Stitch Appendix note: "Settle & Print Receipt" */}
              <Button
                className="w-full"
                size="lg"
                disabled={cart.length === 0 || createSaleMutation.isPending}
                onClick={() => createSaleMutation.mutate()}
              >
                <Printer className="h-4 w-4" />
                {createSaleMutation.isPending
                  ? 'Settling Transaction...'
                  : 'Settle & Print Receipt'}
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Printable Invoice Receipt Modal */}
      {lastReceipt && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-card border border-border rounded-md max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div>
                <div className="font-display text-lg font-bold">{tenant?.name}</div>
                <div className="text-xs text-muted-foreground">
                  Invoice {lastReceipt.invoiceNo} · {formatDateDhaka(lastReceipt.createdAt)}
                </div>
              </div>
              <CheckCircle2 className="h-6 w-6 text-primary" />
            </div>

            <div className="space-y-1.5 text-xs">
              {lastReceipt.items.map((it, idx) => (
                <div key={idx} className="flex justify-between py-1 border-b border-border/60">
                  <span>
                    {it.name} × {it.qty}
                  </span>
                  <span className="font-mono tabular-nums">{formatBDT(it.lineTotal)}</span>
                </div>
              ))}
            </div>

            <div className="space-y-1 text-xs pt-1">
              <div className="flex justify-between font-semibold text-sm">
                <span>Total</span>
                <span className="font-mono tabular-nums">{formatBDT(lastReceipt.total)}</span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>Paid ({lastReceipt.paymentMethod.toUpperCase()})</span>
                <span className="font-mono tabular-nums">{formatBDT(lastReceipt.paidAmount)}</span>
              </div>
              {lastReceipt.dueAmount > 0 && (
                <div className="flex justify-between text-warning font-medium">
                  <span>Baki Due</span>
                  <span className="font-mono tabular-nums">{formatBDT(lastReceipt.dueAmount)}</span>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-border">
              <Button variant="outline" size="sm" onClick={() => window.print()}>
                <Printer className="h-3.5 w-3.5" />
                Print
              </Button>
              <Button size="sm" onClick={() => setLastReceipt(null)}>
                Done
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
