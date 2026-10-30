import React from 'react';
import { cn } from '@/lib/utils';
import type { PlanType } from '@dokanos/shared';

export function PlanBadge({ plan }: { plan: PlanType }): React.ReactElement {
  return (
    <span
      className={cn(
        'text-xs font-mono uppercase tracking-wider font-semibold',
        plan === 'pro' ? 'text-primary' : 'text-muted-foreground',
      )}
    >
      {plan === 'pro' ? 'PRO PLAN' : 'FREE PLAN'}
    </span>
  );
}
