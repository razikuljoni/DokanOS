import React from 'react';
import { Inbox } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function EmptyState({
  title,
  description,
  actionLabel,
  onAction,
}: {
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}): React.ReactElement {
  return (
    <div className="py-12 px-6 text-center border border-dashed border-border rounded-md bg-secondary/30 flex flex-col items-center justify-center space-y-3">
      <Inbox className="h-6 w-6 text-muted-foreground" />
      <div className="space-y-1 max-w-md">
        <h4 className="font-display text-sm font-semibold text-foreground">{title}</h4>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      {actionLabel && onAction && (
        <Button size="sm" variant="outline" onClick={onAction} className="mt-1">
          {actionLabel}
        </Button>
      )}
    </div>
  );
}
