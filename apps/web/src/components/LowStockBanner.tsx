import React from 'react';
import { Link } from 'react-router';
import { AlertTriangle, ArrowRight } from 'lucide-react';

export function LowStockBanner({ count }: { count: number }): React.ReactElement | null {
  if (count <= 0) return null;
  return (
    <div className="rounded-md border border-border bg-secondary px-4 py-3 flex flex-wrap items-center justify-between gap-4">
      <div className="flex items-center gap-2.5 text-xs">
        <AlertTriangle className="h-4 w-4 text-warning shrink-0" />
        <span className="font-medium text-foreground tabular-nums">
          {count} product{count === 1 ? ' is' : 's are'} at or below the low-stock reorder threshold.
        </span>
      </div>
      <Link
        to="/app/products?stockStatus=low"
        className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline whitespace-nowrap shrink-0"
      >
        Review low-stock ledger
        <ArrowRight className="h-3.5 w-3.5" />
      </Link>
    </div>
  );
}
