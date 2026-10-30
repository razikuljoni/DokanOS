import React, { useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuthStore } from '@/stores/authStore';
import { tryRefreshSession } from '@/lib/api';
import { AppShell } from '@/components/AppShell';
import { LandingPage } from '@/routes/LandingPage';
import { LoginPage, RegisterPage } from '@/routes/AuthPages';
import { DashboardPage } from '@/routes/DashboardPage';
import { PosPage } from '@/routes/PosPage';
import { SalesListPage } from '@/routes/SalesListPage';
import { ProductDetailPage, ProductsListPage } from '@/routes/ProductsPages';
import { PurchasesPage, SuppliersPage } from '@/routes/PurchasesAndSuppliersPages';
import { DuesPage } from '@/routes/DuesPage';
import { AlertsPage, BillingPage } from '@/routes/AlertsAndBillingPages';
import { SettingsPage, StaffPage } from '@/routes/StaffAndSettingsPages';

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

  return <AppShell />;
}

export default function App(): React.ReactElement {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
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
      </BrowserRouter>
    </QueryClientProvider>
  );
}
