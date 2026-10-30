import React, { useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'motion/react';
import {
  Bell,
  BookOpen,
  CreditCard,
  FileSpreadsheet,
  LayoutDashboard,
  LogOut,
  Moon,
  Package,
  PanelLeftClose,
  PanelLeftOpen,
  Receipt,
  Search,
  Settings,
  ShoppingBag,
  ShoppingCart,
  Sun,
  Truck,
  Users,
  X,
} from 'lucide-react';
import { PERMISSIONS, type Permission } from '@dokanos/shared';
import { useAuthStore } from '@/stores/authStore';
import { useUiStore } from '@/stores/uiStore';
import { apiFetch } from '@/lib/api';
import { useSocket } from '@/lib/useSocket';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PlanBadge } from '@/components/SharedWidgets';
import { PWAInstallButton } from '@/lib/usePWAInstall';
import {
  OfflineBannerAndDrawer,
  OfflineSyncHeaderControls,
} from '@/components/OfflineSyncManager';
import { cn } from '@/lib/utils';

interface NavItem {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  permission?: Permission;
  end?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { to: '/app/dashboard', label: 'Dashboard', icon: LayoutDashboard, permission: 'dashboard:read' },
  { to: '/app/sales/new', label: 'POS Terminal', icon: ShoppingCart, permission: 'sales:write' },
  { to: '/app/sales', label: 'Sales Ledger', icon: Receipt, permission: 'sales:read', end: true },
  { to: '/app/products', label: 'Products & Stock', icon: Package, permission: 'products:read' },
  { to: '/app/purchases', label: 'Purchases', icon: ShoppingBag, permission: 'purchases:read' },
  { to: '/app/suppliers', label: 'Suppliers', icon: Truck, permission: 'suppliers:read' },
  { to: '/app/dues', label: 'Baki Dues Ledger', icon: BookOpen, permission: 'dues:read' },
  { to: '/app/alerts', label: 'Alerts Feed', icon: Bell, permission: 'notifications:read' },
  { to: '/app/billing', label: 'Billing & Plan', icon: CreditCard, permission: 'billing:read' },
  { to: '/app/staff', label: 'Staff & RBAC', icon: Users, permission: 'staff:write' },
  { to: '/app/settings', label: 'Shop Settings', icon: Settings, permission: 'tenant:write' },
];

export function AppShell(): React.ReactElement {
  useSocket();

  const user = useAuthStore((s) => s.user);
  const tenant = useAuthStore((s) => s.tenant);
  const clearAuth = useAuthStore((s) => s.clearAuth);
  const setAuth = useAuthStore((s) => s.setAuth);

  const sidebarCollapsed = useUiStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);
  const darkMode = useUiStore((s) => s.darkMode);
  const toggleDarkMode = useUiStore((s) => s.toggleDarkMode);
  const toasts = useUiStore((s) => s.toasts);
  const removeToast = useUiStore((s) => s.removeToast);
  const addToast = useUiStore((s) => s.addToast);

  const navigate = useNavigate();
  const location = useLocation();
  const [globalSearch, setGlobalSearch] = useState('');

  const { data: unreadData } = useQuery({
    queryKey: ['notifications', tenant?.id, 'unread-count'],
    queryFn: () =>
      apiFetch<{ data: { unreadCount: number } }>('/api/v1/notifications/unread-count'),
    enabled: Boolean(tenant?.id),
    refetchInterval: 30000,
  });

  const unreadCount = unreadData?.data.unreadCount ?? 0;

  const allowedNavItems = NAV_ITEMS.filter((item) => {
    if (!item.permission || !user) return true;
    const allowedRoles = PERMISSIONS[item.permission] as readonly string[];
    return allowedRoles.includes(user.role);
  });

  const handleLogout = async (): Promise<void> => {
    try {
      await apiFetch('/api/v1/auth/logout', { method: 'POST', skipAuthRefresh: true });
    } catch {
      // Ignore logout error
    }
    clearAuth();
    void navigate('/login');
  };

  const handleGlobalSearch = (e: React.FormEvent): void => {
    e.preventDefault();
    if (!globalSearch.trim()) return;
    void navigate(`/app/products?search=${encodeURIComponent(globalSearch.trim())}`);
  };

  const handleSwitchDemoRole = async (email: string, roleLabel: string): Promise<void> => {
    try {
      const res = await apiFetch<{
        accessToken: string;
        user: NonNullable<typeof user>;
        tenant: NonNullable<typeof tenant>;
      }>('/api/v1/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password: 'Demo1234!' }),
      });
      setAuth(res);
      addToast({
        title: `Switched to Demo ${roleLabel}`,
        description: `Logged in as ${res.user.name} (${res.user.role})`,
      });
      void navigate('/app/dashboard');
    } catch (err) {
      addToast({
        title: 'Demo switch failed',
        description: err instanceof Error ? err.message : 'Could not switch role',
        variant: 'danger',
      });
    }
  };

  return (
    <div className="min-h-screen flex bg-background text-foreground">
      {/* Dark Ink Sidebar (#1C1917, white text) per §6 */}
      <aside
        className={cn(
          'bg-[#1C1917] text-[#FAF7F2] border-r border-[#2E2A26] flex flex-col shrink-0 transition-all duration-150',
          sidebarCollapsed ? 'w-16' : 'w-64',
        )}
      >
        {/* Shop Switcher Header */}
        <div className="h-16 px-4 border-b border-[#2E2A26] flex items-center justify-between gap-2">
          {!sidebarCollapsed && (
            <div className="min-w-0">
              <Link
                to="/app/dashboard"
                className="font-display text-base font-bold tracking-tight text-white truncate block"
              >
                {tenant?.name ?? 'DokanOS'}
              </Link>
              <div className="text-[11px] text-[#A8A29E] truncate">
                {tenant?.type ? `${tenant.type.toUpperCase()} LEDGER` : 'SHOP LEDGER'} ·{' '}
                {tenant?.plan.toUpperCase() ?? 'FREE'}
              </div>
            </div>
          )}
          <button
            type="button"
            onClick={toggleSidebar}
            title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="p-2 rounded-md text-[#D6D3D1] hover:bg-[#292524] hover:text-white transition-colors cursor-pointer"
          >
            {sidebarCollapsed ? (
              <PanelLeftOpen className="h-4 w-4" />
            ) : (
              <PanelLeftClose className="h-4 w-4" />
            )}
          </button>
        </div>

        {/* Navigation Links */}
        <nav className="flex-1 py-4 px-2.5 space-y-1 overflow-y-auto">
          {allowedNavItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-3 px-3 py-2.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap',
                    isActive
                      ? 'bg-[#14532D] text-white'
                      : 'text-[#D6D3D1] hover:bg-[#292524] hover:text-white',
                  )
                }
              >
                <Icon className="h-4 w-4 shrink-0" />
                {!sidebarCollapsed && <span className="truncate">{item.label}</span>}
              </NavLink>
            );
          })}
        </nav>

        {/* Demo RBAC Quick Switcher & User Footer */}
        {!sidebarCollapsed && (
          <div className="p-3 border-t border-[#2E2A26] space-y-3 text-xs">
            {user?.email.endsWith('@dokan-os.demo') && (
              <div className="space-y-1.5">
                <div className="text-[11px] text-[#A8A29E] font-medium">
                  Demo RBAC Role Switcher
                </div>
                <div className="grid grid-cols-3 gap-1">
                  <button
                    type="button"
                    onClick={() => void handleSwitchDemoRole('demo@dokan-os.demo', 'Owner')}
                    className={cn(
                      'px-2 py-1 rounded text-[11px] font-medium cursor-pointer transition-colors',
                      user.role === 'owner'
                        ? 'bg-[#14532D] text-white'
                        : 'bg-[#292524] text-[#D6D3D1] hover:text-white',
                    )}
                  >
                    Owner
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleSwitchDemoRole('manager@dokan-os.demo', 'Manager')}
                    className={cn(
                      'px-2 py-1 rounded text-[11px] font-medium cursor-pointer transition-colors',
                      user.role === 'manager'
                        ? 'bg-[#14532D] text-white'
                        : 'bg-[#292524] text-[#D6D3D1] hover:text-white',
                    )}
                  >
                    Manager
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleSwitchDemoRole('staff@dokan-os.demo', 'Staff')}
                    className={cn(
                      'px-2 py-1 rounded text-[11px] font-medium cursor-pointer transition-colors',
                      user.role === 'staff'
                        ? 'bg-[#14532D] text-white'
                        : 'bg-[#292524] text-[#D6D3D1] hover:text-white',
                    )}
                  >
                    Staff
                  </button>
                </div>
              </div>
            )}

            <div className="flex items-center justify-between gap-2 pt-1">
              <div className="min-w-0">
                <div className="font-medium text-white truncate">{user?.name}</div>
                <div className="text-[11px] text-[#A8A29E] truncate">
                  {user?.role.toUpperCase()} · {user?.email}
                </div>
              </div>
              <button
                type="button"
                onClick={() => void handleLogout()}
                title="Sign out"
                className="p-2 rounded-md text-[#A8A29E] hover:bg-[#292524] hover:text-white cursor-pointer"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Bar Contract for Workspace */}
        <header className="h-16 px-6 border-b border-border bg-card flex items-center justify-between gap-6 shrink-0">
          <form onSubmit={handleGlobalSearch} className="relative max-w-sm w-full">
            <Search className="h-4 w-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
            <Input
              value={globalSearch}
              onChange={(e) => setGlobalSearch(e.target.value)}
              placeholder="Search products by name, SKU, or category..."
              className="pl-9 h-9 text-xs"
            />
          </form>

          <div className="flex items-center gap-2.5 shrink-0">
            <OfflineSyncHeaderControls />
            <PWAInstallButton />
            {tenant && <PlanBadge plan={tenant.plan} />}

            <button
              type="button"
              onClick={toggleDarkMode}
              title="Toggle theme"
              className="p-2 rounded-md border border-border bg-card hover:bg-secondary text-foreground transition-colors cursor-pointer"
            >
              {darkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>

            <Link
              to="/app/alerts"
              className="relative p-2 rounded-md border border-border bg-card hover:bg-secondary text-foreground transition-colors"
              title="Notifications & Low-Stock Alerts"
            >
              <Bell className="h-4 w-4" />
              {unreadCount > 0 && (
                <span className="absolute -top-1.5 -right-1.5 min-w-4 h-4 px-1 rounded-full bg-destructive text-white text-[10px] font-mono tabular-nums flex items-center justify-center">
                  {unreadCount}
                </span>
              )}
            </Link>

            <Button
              size="sm"
              onClick={() => {
                void navigate('/app/sales/new');
              }}
            >
              <FileSpreadsheet className="h-3.5 w-3.5" />
              New POS Sale
            </Button>
          </div>
        </header>

        <OfflineBannerAndDrawer />

        {/* Page Viewport with 150ms Framer Motion transition */}
        <main className="flex-1 p-6 max-w-[1360px] w-full mx-auto">
          <AnimatePresence mode="wait">
            <motion.div
              key={location.pathname}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
            >
              <Outlet />
            </motion.div>
          </AnimatePresence>
        </main>
      </div>

      {/* Realtime Toast Stack */}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none">
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, y: 12, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.98 }}
              transition={{ duration: 0.15 }}
              className="pointer-events-auto rounded-md border border-border bg-card p-4 shadow-sm flex items-start justify-between gap-3"
            >
              <div className="space-y-1">
                <div
                  className={cn(
                    'font-display text-xs font-semibold',
                    t.variant === 'warning'
                      ? 'text-warning'
                      : t.variant === 'danger'
                        ? 'text-destructive'
                        : t.variant === 'success'
                          ? 'text-primary'
                          : 'text-foreground',
                  )}
                >
                  {t.title}
                </div>
                {t.description && (
                  <div className="text-xs text-muted-foreground">{t.description}</div>
                )}
              </div>
              <button
                type="button"
                onClick={() => removeToast(t.id)}
                className="text-muted-foreground hover:text-foreground cursor-pointer"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
