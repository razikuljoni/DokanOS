import React, { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter, Link, Navigate, Route, Routes } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PERMISSIONS, type Permission } from '@dokanos/shared';
import { useAuthStore } from '@/stores/authStore';
import { tryRefreshSession } from '@/lib/api';
import { AppShell } from '@/components/AppShell';
import { ErrorBoundary } from '@/components/SharedWidgets';
import { Button } from '@/components/ui/button';
import { LandingPage } from '@/routes/LandingPage';
import {
  AcceptInvitePage,
  ForgotPasswordPage,
  LoginPage,
  RegisterPage,
  ResetPasswordPage,
} from '@/routes/AuthPages';

const DashboardPage = lazyWithReload(() =>
  import('@/routes/DashboardPage').then((m) => ({ default: m.DashboardPage })),
);
const PosPage = lazyWithReload(() =>
  import('@/routes/PosPage').then((m) => ({ default: m.PosPage })),
);
const SalesListPage = lazyWithReload(() =>
  import('@/routes/SalesListPage').then((m) => ({ default: m.SalesListPage })),
);
const CustomersPage = lazyWithReload(() =>
  import('@/routes/CustomersPages').then((m) => ({ default: m.CustomersPage })),
);
const ProductsListPage = lazyWithReload(() =>
  import('@/routes/ProductsPages').then((m) => ({ default: m.ProductsListPage })),
);
const ProductDetailPage = lazyWithReload(() =>
  import('@/routes/ProductsPages').then((m) => ({ default: m.ProductDetailPage })),
);
const PurchasesPage = lazyWithReload(() =>
  import('@/routes/PurchasesAndSuppliersPages').then((m) => ({ default: m.PurchasesPage })),
);
const SuppliersPage = lazyWithReload(() =>
  import('@/routes/PurchasesAndSuppliersPages').then((m) => ({ default: m.SuppliersPage })),
);
const DuesPage = lazyWithReload(() =>
  import('@/routes/DuesPage').then((m) => ({ default: m.DuesPage })),
);
const AlertsPage = lazyWithReload(() =>
  import('@/routes/AlertsAndBillingPages').then((m) => ({ default: m.AlertsPage })),
);
const BillingPage = lazyWithReload(() =>
  import('@/routes/AlertsAndBillingPages').then((m) => ({ default: m.BillingPage })),
);
const SettingsPage = lazyWithReload(() =>
  import('@/routes/StaffAndSettingsPages').then((m) => ({ default: m.SettingsPage })),
);
const StaffPage = lazyWithReload(() =>
  import('@/routes/StaffAndSettingsPages').then((m) => ({ default: m.StaffPage })),
);

function RouteLoading(): React.ReactElement {
  return <div className="min-h-screen flex items-center justify-center">Loading...</div>;
}

function VersionUpdatePage(): React.ReactElement {
  return (
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center p-6 text-center">
      <div className="max-w-md w-full space-y-4">
        <h1 className="font-display text-2xl font-bold">A new version is available</h1>
        <p className="text-sm text-muted-foreground">Please reload to continue.</p>
        <Button onClick={() => window.location.reload()}>Reload</Button>
      </div>
    </div>
  );
}

function lazyWithReload<T extends React.ComponentType>(
  load: () => Promise<{ default: T }>,
): React.LazyExoticComponent<T> {
  return lazy(async () => {
    try {
      return await load();
    } catch {
      return { default: VersionUpdatePage as unknown as T };
    }
  });
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function RbacGuard({
  permission,
  children,
}: {
  permission: Permission;
  children: React.ReactElement;
}): React.ReactElement {
  const user = useAuthStore((s) => s.user);
  if (!user) return <Navigate to="/login" replace />;

  const allowedRoles = PERMISSIONS[permission] as readonly string[];
  if (!allowedRoles.includes(user.role)) {
    return (
      <div className="p-8 max-w-lg mx-auto text-center space-y-4 pt-16">
        <div className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10 text-destructive text-2xl font-bold">
          🛡️
        </div>
        <h2 className="text-xl font-bold font-display tracking-tight text-foreground">
          Access Restricted
        </h2>
        <p className="text-xs text-muted-foreground leading-relaxed">
          Your account role (<span className="font-semibold text-foreground">{user.role}</span>)
          does not have permission to access this section (
          <span className="font-mono">{permission}</span>).
        </p>
        <div className="pt-2">
          <Link to="/app/dashboard">
            <Button size="sm">Return to Dashboard</Button>
          </Link>
        </div>
      </div>
    );
  }

  return children;
}

function PublicOnlyRoute({ children }: { children: React.ReactElement }): React.ReactElement {
  const accessToken = useAuthStore((s) => s.accessToken);
  if (accessToken) {
    return <Navigate to="/app/dashboard" replace />;
  }
  return children;
}

function NotFoundPage(): React.ReactElement {
  const accessToken = useAuthStore((s) => s.accessToken);
  return (
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center p-6 text-center">
      <div className="max-w-md w-full space-y-4">
        <div className="font-mono text-6xl font-black text-primary">404</div>
        <h1 className="font-display text-2xl font-bold">Page Not Found</h1>
        <p className="text-xs text-muted-foreground">The requested ledger route does not exist.</p>
        <div className="pt-2 flex justify-center gap-2">
          {accessToken ? (
            <Link to="/app/dashboard">
              <Button size="sm">Go to Dashboard</Button>
            </Link>
          ) : (
            <Link to="/">
              <Button size="sm">Go to Home</Button>
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

function ProtectedAppRoutes(): React.ReactElement {
  const accessToken = useAuthStore((s) => s.accessToken);
  const isInitialized = useAuthStore((s) => s.isInitialized);

  useEffect(() => {
    if (!isInitialized) {
      void tryRefreshSession();
    }
  }, [isInitialized]);

  if (!isInitialized) {
    return (
      <div className="min-h-screen bg-background text-foreground flex items-center justify-center p-6">
        <div className="text-center space-y-2">
          <div className="font-display text-lg font-bold">DokanOS</div>
          <div className="text-xs text-muted-foreground">
            Restoring shop session... (First load may take up to a minute — the free server wakes
            up.)
          </div>
        </div>
      </div>
    );
  }

  if (!accessToken) {
    return <Navigate to="/login" replace />;
  }

  return (
    <Suspense fallback={<RouteLoading />}>
      <AppShell />
    </Suspense>
  );
}

export default function App(): React.ReactElement {
  return (
    <QueryClientProvider client={queryClient}>
      <ErrorBoundary fallbackTitle="Application Error">
        <BrowserRouter>
          <Suspense fallback={<RouteLoading />}>
            <Routes>
              <Route path="/" element={<LandingPage />} />
              <Route
                path="/login"
                element={
                  <PublicOnlyRoute>
                    <LoginPage />
                  </PublicOnlyRoute>
                }
              />
              <Route
                path="/register"
                element={
                  <PublicOnlyRoute>
                    <RegisterPage />
                  </PublicOnlyRoute>
                }
              />
              <Route path="/forgot-password" element={<ForgotPasswordPage />} />
              <Route path="/reset-password" element={<ResetPasswordPage />} />
              <Route path="/accept-invite" element={<AcceptInvitePage />} />

              <Route path="/app" element={<ProtectedAppRoutes />}>
                <Route index element={<Navigate to="/app/dashboard" replace />} />
                <Route path="dashboard" element={<DashboardPage />} />
                <Route path="sales/new" element={<PosPage />} />
                <Route path="sales" element={<SalesListPage />} />
                <Route path="customers" element={<CustomersPage />} />
                <Route path="products" element={<ProductsListPage />} />
                <Route path="products/:id" element={<ProductDetailPage />} />
                <Route
                  path="purchases"
                  element={
                    <RbacGuard permission="purchases:read">
                      <PurchasesPage />
                    </RbacGuard>
                  }
                />
                <Route
                  path="suppliers"
                  element={
                    <RbacGuard permission="suppliers:read">
                      <SuppliersPage />
                    </RbacGuard>
                  }
                />
                <Route path="dues" element={<DuesPage />} />
                <Route path="alerts" element={<AlertsPage />} />
                <Route
                  path="billing"
                  element={
                    <RbacGuard permission="billing:read">
                      <BillingPage />
                    </RbacGuard>
                  }
                />
                <Route
                  path="staff"
                  element={
                    <RbacGuard permission="staff:read">
                      <StaffPage />
                    </RbacGuard>
                  }
                />
                <Route
                  path="settings"
                  element={
                    <RbacGuard permission="tenant:write">
                      <SettingsPage />
                    </RbacGuard>
                  }
                />
              </Route>

              <Route path="*" element={<NotFoundPage />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
      </ErrorBoundary>
    </QueryClientProvider>
  );
}
