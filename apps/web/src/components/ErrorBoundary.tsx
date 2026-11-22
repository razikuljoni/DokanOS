import React, { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public override state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public override componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('ErrorBoundary caught an unhandled error:', error, errorInfo);
  }

  private handleReset = (): void => {
    this.setState({ hasError: false, error: null });
    this.props.onReset?.();
  };

  private handleReload = (): void => {
    window.location.reload();
  };

  public override render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="min-h-[300px] p-6 flex items-center justify-center">
          <div className="max-w-md w-full bg-card border border-destructive/30 rounded-xl p-6 text-center space-y-4 shadow-lg">
            <div className="h-12 w-12 rounded-full bg-destructive/10 text-destructive flex items-center justify-center mx-auto">
              <AlertTriangle className="h-6 w-6" />
            </div>
            <div className="space-y-1">
              <h2 className="text-lg font-bold font-display text-foreground">
                {this.props.fallbackTitle ?? 'Something went wrong'}
              </h2>
              <p className="text-xs text-muted-foreground">
                An unexpected interface error occurred. Your shop data in MongoDB and offline ledger
                remain secure.
              </p>
              {this.state.error && (
                <pre className="text-[11px] font-mono p-2 bg-secondary rounded border border-border text-left overflow-x-auto text-destructive max-h-24">
                  {this.state.error.message}
                </pre>
              )}
            </div>
            <div className="flex items-center justify-center gap-2 pt-2">
              <Button variant="outline" size="sm" onClick={this.handleReset}>
                Try Again
              </Button>
              <Button size="sm" onClick={this.handleReload} className="gap-1.5">
                <RefreshCw className="h-3.5 w-3.5" />
                Reload Page
              </Button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
