import React, { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuthStore } from '@/stores/authStore';
import { tryRefreshSession } from '@/lib/api';
import { AppShell } from '@/components/AppShell';
import { LandingPage } from '@/routes/LandingPage';
import { LoginPage, RegisterPage } from '@/routes/AuthPages';

const DashboardPage = lazy(() => import('@/routes/DashboardPage').then((m) => ({ default: m.DashboardPage })));
const PosPage = lazy(() => import('@/routes/PosPage').then((m) => ({ default: m.PosPage })));
const SalesListPage = lazy(() => import('@/routes/SalesListPage').then((m) => ({ default: m.SalesListPage })));
const ProductsListPage = lazy(() => import('@/routes/ProductsPages').then((m) => ({ default: m.ProductsListPage })));
const ProductDetailPage = lazy(() => import('@/routes/ProductsPages').then((m) => ({ default: m.ProductDetailPage })));
const PurchasesPage = lazy(() => import('@/routes/PurchasesAndSuppliersPages').then((m) => ({ default: m.PurchasesPage })));
const SuppliersPage = lazy(() => import('@/routes/PurchasesAndSuppliersPages').then((m) => ({ default: m.SuppliersPage })));
const DuesPage = lazy(() => import('@/routes/DuesPage').then((m) => ({ default: m.DuesPage })));
const AlertsPage = lazy(() => import('@/routes/AlertsAndBillingPages').then((m) => ({ default: m.AlertsPage })));
const BillingPage = lazy(() => import('@/routes/AlertsAndBillingPages').then((m) => ({ default: m.BillingPage })));
const SettingsPage = lazy(() => import('@/routes/StaffAndSettingsPages').then((m) => ({ default: m.SettingsPage })));
const StaffPage = lazy(() => import('@/routes/StaffAndSettingsPages').then((m) => ({ default: m.StaffPage })));

function RouteLoading(): React.ReactElement {
  return <div className="min-h-screen flex items-center justify-center">Loading...</div>;
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

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
      <BrowserRouter>
        <Suspense fallback={<RouteLoading />}>
          <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />

          <Route path="/app" element={<ProtectedAppRoutes />}>
            <Route index element={<Navigate to="/app/dashboard" replace />} />
            <Route path="dashboard" element={<DashboardPage />} />
            <Route path="sales/new" element={<PosPage />} />
            <Route path="sales" element={<SalesListPage />} />
            <Route path="products" element={<ProductsListPage />} />
            <Route path="products/:id" element={<ProductDetailPage />} />
            <Route path="purchases" element={<PurchasesPage />} />
            <Route path="suppliers" element={<SuppliersPage />} />
            <Route path="dues" element={<DuesPage />} />
            <Route path="alerts" element={<AlertsPage />} />
            <Route path="billing" element={<BillingPage />} />
            <Route path="staff" element={<StaffPage />} />
            <Route path="settings" element={<SettingsPage />} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
