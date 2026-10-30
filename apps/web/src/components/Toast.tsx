import React from 'react';
import { X } from 'lucide-react';
import { useUiStore } from '@/stores/uiStore';

export function Toast(): React.ReactElement | null {
  const toasts = useUiStore((s) => s.toasts);
  const removeToast = useUiStore((s) => s.removeToast);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`pointer-events-auto rounded-md border p-3.5 shadow-sm bg-card text-foreground flex items-start justify-between gap-3 ${
            t.variant === 'danger'
              ? 'border-destructive'
              : t.variant === 'warning'
                ? 'border-warning'
                : t.variant === 'success'
                  ? 'border-primary'
                  : 'border-border'
          }`}
        >
          <div className="space-y-0.5">
            <div className="font-display text-xs font-semibold">{t.title}</div>
            {t.description && <div className="text-xs text-muted-foreground">{t.description}</div>}
          </div>
          <button
            type="button"
            onClick={() => removeToast(t.id)}
            className="text-muted-foreground hover:text-foreground cursor-pointer"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
