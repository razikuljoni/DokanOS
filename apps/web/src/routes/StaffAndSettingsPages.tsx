import React, { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Clock,
  Download,
  History,
  KeyRound,
  Lock,
  Play,
  RefreshCw,
  Search,
  Send,
  Shield,
  Store,
  Trash2,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import {
  PERMISSIONS,
  SHOP_TYPES,
  TIMEZONE_DHAKA,
  type Permission,
  type PlanType,
  type Role,
  type ShopType,
} from '@dokanos/shared';
import { useAuthStore } from '@/stores/authStore';
import { useUiStore } from '@/stores/uiStore';
import { useIsOffline } from '@/stores/offlineStore';
import { ApiClientError, apiFetch } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DataTable, type DataTableColumn } from '@/components/SharedWidgets';
import { downloadCsvFile, formatDateDhaka } from '@/lib/utils';

// /app/staff — Staff List, Invite Link Generator, Role Editor & Permission Matrix
interface StaffUserRow {
  _id: string;
  name: string;
  email: string;
  role: Role;
  status: 'active' | 'invited' | 'disabled';
  lastLoginAt: string | null;
}

export function StaffPage(): React.ReactElement {
  const tenant = useAuthStore((s) => s.tenant);
  const addToast = useUiStore((s) => s.addToast);
  const queryClient = useQueryClient();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'manager' | 'staff'>('staff');
  const [lastSetupLink, setLastSetupLink] = useState<string | null>(null);

  const { data: usersRes, isLoading } = useQuery({
    queryKey: ['users', tenant?.id],
    queryFn: () => apiFetch<{ data: StaffUserRow[] }>('/api/v1/users'),
    enabled: Boolean(tenant?.id),
  });

  const inviteMutation = useMutation({
    mutationFn: async () => {
      return apiFetch<{
        data: { _id: string; name: string; email: string; setupLink: string };
      }>('/api/v1/users/invite', {
        method: 'POST',
        body: JSON.stringify({ name, email, role }),
      });
    },
    onSuccess: (res) => {
      setName('');
      setEmail('');
      setLastSetupLink(res.data.setupLink);
      void queryClient.invalidateQueries({ queryKey: ['users', tenant?.id] });
      addToast({
        title: 'Staff Invited',
        description: `One-time setup link generated for ${res.data.email}`,
        variant: 'success',
      });
    },
    onError: (err) => {
      addToast({
        title: 'Invite Failed',
        description: err instanceof Error ? err.message : 'Check plan staff limits',
        variant: 'danger',
      });
    },
  });

  const toggleStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: 'active' | 'disabled' }) => {
      return apiFetch(`/api/v1/users/${id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['users', tenant?.id] });
      addToast({ title: 'Staff status updated', variant: 'success' });
    },
  });

  const deleteStaffMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiFetch(`/api/v1/users/${id}`, { method: 'DELETE' });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['users', tenant?.id] });
      addToast({ title: 'Staff member removed', variant: 'success' });
    },
  });

  const columns: DataTableColumn<StaffUserRow>[] = [
    {
      key: 'name',
      header: 'Name & Email',
      render: (row) => (
        <div>
          <div className="font-medium text-foreground">{row.name}</div>
          <div className="text-xs font-mono text-muted-foreground">{row.email}</div>
        </div>
      ),
    },
    {
      key: 'role',
      header: 'Role',
      render: (row) => <span className="text-xs uppercase font-semibold">{row.role}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => (
        <span
          className={`text-xs uppercase font-medium ${
            row.status === 'active'
              ? 'text-primary'
              : row.status === 'invited'
                ? 'text-warning'
                : 'text-destructive'
          }`}
        >
          {row.status}
        </span>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      render: (row) =>
        row.role === 'owner' ? (
          <span className="text-xs text-muted-foreground">Shop Owner</span>
        ) : (
          <div className="inline-flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                toggleStatusMutation.mutate({
                  id: row._id,
                  status: row.status === 'disabled' ? 'active' : 'disabled',
                })
              }
            >
              {row.status === 'disabled' ? 'Enable' : 'Disable'}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => deleteStaffMutation.mutate(row._id)}
            >
              <Trash2 className="h-3.5 w-3.5 text-destructive" />
            </Button>
          </div>
        ),
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">
          Staff Accounts & RBAC Permissions
        </h1>
        <p className="text-xs text-muted-foreground">
          Invite shop managers and counter staff. Server-side RBAC enforces every permission.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-7 space-y-6">
          <DataTable
            columns={columns}
            data={usersRes?.data ?? []}
            rowKey={(r) => r._id}
            loading={isLoading}
          />

          {/* Permission Matrix */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="h-4 w-4 text-primary" />
                <span>RBAC Permission Matrix (@dokanos/shared)</span>
              </CardTitle>
              <CardDescription>
                Enforced by <code>requirePermission()</code> middleware on every API route.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="rounded-md border border-border overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-secondary/60 border-b border-border text-muted-foreground">
                      <th className="py-2 px-3 text-left">Permission</th>
                      <th className="py-2 px-3 text-center">Owner</th>
                      <th className="py-2 px-3 text-center">Manager</th>
                      <th className="py-2 px-3 text-center">Staff</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {Object.entries(PERMISSIONS).map(([perm, roles]) => {
                      const roleList = roles as readonly string[];
                      return (
                        <tr key={perm}>
                          <td className="py-1.5 px-3 font-mono">{perm}</td>
                          <td className="py-1.5 px-3 text-center">
                            {roleList.includes('owner') ? 'Yes' : '—'}
                          </td>
                          <td className="py-1.5 px-3 text-center">
                            {roleList.includes('manager') ? 'Yes' : '—'}
                          </td>
                          <td className="py-1.5 px-3 text-center">
                            {roleList.includes('staff') ? 'Yes' : '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="lg:col-span-5">
          <Card>
            <CardHeader>
              <CardTitle>Invite Staff or Manager</CardTitle>
              <CardDescription>
                Generates a one-time setup link (default demo password: <code>Staff1234!</code>).
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="st-name">Full Name</Label>
                <Input
                  id="st-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Rashedul Karim"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="st-email">Email Address</Label>
                <Input
                  id="st-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="cashier@shop.bd"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="st-role">Role</Label>
                <select
                  id="st-role"
                  value={role}
                  onChange={(e) => setRole(e.target.value as 'manager' | 'staff')}
                  className="flex h-10 w-full rounded-md border border-input bg-card px-3 py-2 text-sm"
                >
                  <option value="staff">Staff (POS Sales & Product Lookup)</option>
                  <option value="manager">Manager (Inventory, Purchases, Dues)</option>
                </select>
              </div>
              <Button
                className="w-full"
                size="sm"
                disabled={inviteMutation.isPending || !name.trim() || !email.trim()}
                onClick={() => inviteMutation.mutate()}
              >
                <UserPlus className="h-3.5 w-3.5" />
                Create Staff Account
              </Button>

              {lastSetupLink && (
                <div className="p-3 rounded-md border border-border bg-secondary/50 space-y-1 text-xs">
                  <div className="font-semibold text-primary">One-Time Setup Link Ready:</div>
                  <div className="font-mono break-all text-muted-foreground">{lastSetupLink}</div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

// /app/settings — Rebuilt to Stitch Settings & Staff Node + Kept Live System/Security Cards
interface SessionItem {
  familyId: string;
  userAgent: string;
  ip: string;
  createdAt: string;
  expiresAt: string;
}

interface JobItem {
  name: string;
  schedule: string;
  description: string;
  lastRunAt: string | null;
  nextRunAt?: string;
  lastStatus: string;
  lastSummary: string;
}

interface TenantDetailResponse {
  _id: string;
  name: string;
  slug: string;
  type: ShopType;
  plan: PlanType;
  planExpiresAt: string | null;
  settings: {
    lowStockThreshold: number;
    currency: string;
  };
  updatedAt?: string;
}

interface TenantUsageResponse {
  plan: PlanType;
  planExpiresAt: string | null;
  productCount: number;
  maxProducts: number | null;
  staffCount: number;
  maxStaff: number;
  csvImportExport: boolean;
  emailDigests: boolean;
}

interface AuditLogEntry {
  _id: string;
  action: string;
  entity: string;
  entityId: string;
  changes: Record<string, unknown>;
  createdAt: string;
  userId?: {
    _id: string;
    name: string;
    email: string;
    role: Role;
  } | null;
}

const SHOP_TYPE_LABELS: Record<ShopType, string> = {
  pharmacy: 'Pharmacy & Drug Store',
  grocery: 'Grocery & Superstore',
  electronics: 'Electronics & Appliances',
  general: 'General Retail Store',
};

const STITCH_PERMISSION_ROWS: Array<{
  label: string;
  permission: Permission;
}> = [
  {
    label: 'View dashboard & retail metrics',
    permission: 'dashboard:read',
  },
  {
    label: 'Create sale in POS & print receipt',
    permission: 'sales:write',
  },
  {
    label: 'Manage products, batches & expiry stock',
    permission: 'products:write',
  },
  {
    label: 'Record purchases & pharmaceutical suppliers',
    permission: 'purchases:write',
  },
  {
    label: 'Record Baki payments & customer credit ledger',
    permission: 'dues:write',
  },
  {
    label: 'Manage staff roles, salary & permissions',
    permission: 'staff:write',
  },
  {
    label: 'Change billing & DokanOS subscription tier',
    permission: 'billing:write',
  },
  {
    label: 'Update shop profile & outlet threshold settings',
    permission: 'tenant:write',
  },
];

function formatErrorMessage(err: unknown): string {
  if (err instanceof ApiClientError) {
    return `${err.status} ${err.code}: ${err.message}`;
  }
  if (err instanceof Error) {
    return err.message;
  }
  return 'Request failed';
}

export function SettingsPage(): React.ReactElement {
  const user = useAuthStore((s) => s.user);
  const tenant = useAuthStore((s) => s.tenant);
  const updateTenant = useAuthStore((s) => s.updateTenant);
  const addToast = useUiStore((s) => s.addToast);
  const isOffline = useIsOffline();
  const queryClient = useQueryClient();

  const canWriteTenant = user?.role === 'owner';
  const canWriteStaff = user?.role === 'owner';

  const [shopName, setShopName] = useState(tenant?.name ?? '');
  const [shopType, setShopType] = useState<ShopType>(tenant?.type ?? 'pharmacy');
  const [threshold, setThreshold] = useState<number>(tenant?.settings.lowStockThreshold ?? 10);

  // Staff Directory & Invite state
  const [staffFilter, setStaffFilter] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'manager' | 'staff'>('staff');
  const [lastSetupLink, setLastSetupLink] = useState<string | null>(null);
  const [showAllPermissions, setShowAllPermissions] = useState(false);

  // 1. Live Tenant Profile: GET /api/v1/tenants/me
  const {
    data: tenantRes,
    isLoading: isTenantLoading,
    error: tenantError,
  } = useQuery({
    queryKey: ['tenant-me', tenant?.id, user?.role],
    queryFn: () => apiFetch<{ data: TenantDetailResponse }>('/api/v1/tenants/me'),
    enabled: Boolean(tenant?.id),
    retry: false,
  });

  // 2. Live Tenant Usage: GET /api/v1/tenants/me/usage
  const {
    data: usageRes,
    isLoading: isUsageLoading,
    error: usageError,
  } = useQuery({
    queryKey: ['tenant-usage', tenant?.id, user?.role],
    queryFn: () => apiFetch<{ data: TenantUsageResponse }>('/api/v1/tenants/me/usage'),
    enabled: Boolean(tenant?.id),
    retry: false,
  });

  // 3. Live Staff Directory: GET /api/v1/users
  const {
    data: usersRes,
    isLoading: isUsersLoading,
    error: usersError,
  } = useQuery({
    queryKey: ['users', tenant?.id, user?.role],
    queryFn: () => apiFetch<{ data: StaffUserRow[] }>('/api/v1/users'),
    enabled: Boolean(tenant?.id),
    retry: false,
  });

  // 4. Live Active Refresh Token Families: GET /api/v1/auth/sessions (Kept Card #1)
  const {
    data: sessionsRes,
    isLoading: isSessionsLoading,
    error: sessionsError,
  } = useQuery({
    queryKey: ['sessions', tenant?.id, user?.id],
    queryFn: () => apiFetch<{ data: SessionItem[] }>('/api/v1/auth/sessions'),
    enabled: Boolean(tenant?.id),
    retry: false,
  });

  // 5. Live BullMQ In-Process Worker Status: GET /api/v1/admin/jobs (Kept Card #2)
  const {
    data: jobsRes,
    isLoading: isJobsLoading,
    error: jobsError,
  } = useQuery({
    queryKey: ['jobs', tenant?.id, user?.role],
    queryFn: () => apiFetch<{ data: JobItem[] }>('/api/v1/admin/jobs'),
    enabled: Boolean(tenant?.id),
    retry: false,
  });

  // 6. Live Tenant Audit Logs: GET /api/v1/tenants/me/audit-logs (Kept Audit Log)
  const {
    data: auditRes,
    isLoading: isAuditLoading,
    error: auditError,
    refetch: refetchAuditLogs,
  } = useQuery({
    queryKey: ['tenant-audit-logs', tenant?.id, user?.role],
    queryFn: () => apiFetch<{ data: AuditLogEntry[] }>('/api/v1/tenants/me/audit-logs'),
    enabled: Boolean(tenant?.id),
    retry: false,
  });

  const liveTenant = tenantRes?.data;

  useEffect(() => {
    if (liveTenant) {
      setShopName(liveTenant.name);
      setShopType(liveTenant.type);
      setThreshold(liveTenant.settings.lowStockThreshold);
    }
  }, [liveTenant]);

  const isProfileDirty = useMemo(() => {
    const baseName = liveTenant?.name ?? tenant?.name ?? '';
    const baseType = liveTenant?.type ?? tenant?.type ?? 'pharmacy';
    const baseThreshold =
      liveTenant?.settings.lowStockThreshold ?? tenant?.settings.lowStockThreshold ?? 10;
    return (
      shopName.trim() !== baseName ||
      shopType !== baseType ||
      Number(threshold) !== Number(baseThreshold)
    );
  }, [liveTenant, tenant, shopName, shopType, threshold]);

  const handleDiscardChanges = (): void => {
    setShopName(liveTenant?.name ?? tenant?.name ?? '');
    setShopType(liveTenant?.type ?? tenant?.type ?? 'pharmacy');
    setThreshold(
      liveTenant?.settings.lowStockThreshold ?? tenant?.settings.lowStockThreshold ?? 10,
    );
    addToast({
      title: 'Changes Discarded',
      description: 'Reverted shop profile fields to the latest saved server state.',
    });
  };

  // PATCH /api/v1/tenants/me
  const saveSettingsMutation = useMutation({
    mutationFn: async () => {
      return apiFetch<{
        data: TenantDetailResponse;
      }>('/api/v1/tenants/me', {
        method: 'PATCH',
        body: JSON.stringify({
          name: shopName.trim(),
          type: shopType,
          lowStockThreshold: Number(threshold),
        }),
      });
    },
    onSuccess: (res) => {
      updateTenant({
        name: res.data.name,
        type: res.data.type,
        settings: res.data.settings,
      });
      void queryClient.invalidateQueries({ queryKey: ['tenant-me', tenant?.id] });
      void queryClient.invalidateQueries({ queryKey: ['tenant-audit-logs', tenant?.id] });
      addToast({ title: 'Shop Settings Saved', variant: 'success' });
    },
    onError: (err) => {
      addToast({
        title: 'Could Not Save Settings',
        description: formatErrorMessage(err),
        variant: 'danger',
      });
    },
  });

  // POST /api/v1/users/invite
  const inviteMutation = useMutation({
    mutationFn: async () => {
      return apiFetch<{
        data: { _id: string; name: string; email: string; role: Role; setupLink: string };
      }>('/api/v1/users/invite', {
        method: 'POST',
        body: JSON.stringify({
          name: inviteName.trim(),
          email: inviteEmail.trim(),
          role: inviteRole,
        }),
      });
    },
    onSuccess: (res) => {
      setInviteName('');
      setInviteEmail('');
      setLastSetupLink(res.data.setupLink);
      void queryClient.invalidateQueries({ queryKey: ['users', tenant?.id] });
      void queryClient.invalidateQueries({ queryKey: ['tenant-usage', tenant?.id] });
      void queryClient.invalidateQueries({ queryKey: ['tenant-audit-logs', tenant?.id] });
      addToast({
        title: 'Staff Invited',
        description: `One-time setup link generated for ${res.data.email}`,
        variant: 'success',
      });
    },
    onError: (err) => {
      addToast({
        title: 'Invite Failed',
        description: formatErrorMessage(err),
        variant: 'danger',
      });
    },
  });

  // PATCH /api/v1/users/:id/role
  const updateRoleMutation = useMutation({
    mutationFn: async ({ id, role }: { id: string; role: 'manager' | 'staff' }) => {
      return apiFetch(`/api/v1/users/${id}/role`, {
        method: 'PATCH',
        body: JSON.stringify({ role }),
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['users', tenant?.id] });
      void queryClient.invalidateQueries({ queryKey: ['tenant-audit-logs', tenant?.id] });
      addToast({ title: 'Staff role updated', variant: 'success' });
    },
    onError: (err) => {
      addToast({
        title: 'Role Update Failed',
        description: formatErrorMessage(err),
        variant: 'danger',
      });
    },
  });

  // PATCH /api/v1/users/:id/status
  const toggleStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: 'active' | 'disabled' }) => {
      return apiFetch(`/api/v1/users/${id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['users', tenant?.id] });
      void queryClient.invalidateQueries({ queryKey: ['tenant-usage', tenant?.id] });
      void queryClient.invalidateQueries({ queryKey: ['tenant-audit-logs', tenant?.id] });
      addToast({ title: 'Staff status updated', variant: 'success' });
    },
    onError: (err) => {
      addToast({
        title: 'Status Update Failed',
        description: formatErrorMessage(err),
        variant: 'danger',
      });
    },
  });

  // DELETE /api/v1/users/:id
  const deleteStaffMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiFetch(`/api/v1/users/${id}`, { method: 'DELETE' });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['users', tenant?.id] });
      void queryClient.invalidateQueries({ queryKey: ['tenant-usage', tenant?.id] });
      void queryClient.invalidateQueries({ queryKey: ['tenant-audit-logs', tenant?.id] });
      addToast({ title: 'Staff member removed', variant: 'success' });
    },
    onError: (err) => {
      addToast({
        title: 'Remove Failed',
        description: formatErrorMessage(err),
        variant: 'danger',
      });
    },
  });

  // DELETE /api/v1/auth/sessions/:familyId (Kept Card #1 Action)
  const revokeSessionMutation = useMutation({
    mutationFn: async (familyId: string) => {
      return apiFetch(`/api/v1/auth/sessions/${familyId}`, { method: 'DELETE' });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['sessions', tenant?.id] });
      addToast({ title: 'Session Family Revoked', variant: 'success' });
    },
    onError: (err) => {
      addToast({
        title: 'Could Not Revoke Session',
        description: formatErrorMessage(err),
        variant: 'danger',
      });
    },
  });

  // POST /api/v1/admin/jobs/:jobName/run (Kept Card #2 Action)
  const triggerJobMutation = useMutation({
    mutationFn: async (jobName: string) => {
      return apiFetch<{ summary: string }>(`/api/v1/admin/jobs/${jobName}/run`, {
        method: 'POST',
      });
    },
    onSuccess: (res) => {
      void queryClient.invalidateQueries({ queryKey: ['jobs', tenant?.id] });
      void queryClient.invalidateQueries({ queryKey: ['notifications', tenant?.id] });
      addToast({
        title: 'Background Job Executed',
        description: res.summary,
        variant: 'success',
      });
    },
    onError: (err) => {
      addToast({
        title: 'Job Execution Denied / Failed',
        description: formatErrorMessage(err),
        variant: 'danger',
      });
    },
  });

  const allStaff = usersRes?.data ?? [];
  const filteredStaff = useMemo(() => {
    const q = staffFilter.trim().toLowerCase();
    if (!q) return allStaff;
    return allStaff.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.email.toLowerCase().includes(q) ||
        s.role.toLowerCase().includes(q),
    );
  }, [allStaff, staffFilter]);

  const handleExportStaffCsv = (): void => {
    if (filteredStaff.length === 0) {
      addToast({
        title: 'No Staff Rows to Export',
        variant: 'warning',
      });
      return;
    }
    const headers = ['Name', 'Email', 'Role', 'Status', 'Last Active'];
    const rows = filteredStaff.map((s) => [
      s.name,
      s.email,
      s.role,
      s.status,
      s.lastLoginAt ? formatDateDhaka(s.lastLoginAt) : 'Never',
    ]);
    downloadCsvFile(
      `dokanos-staff-${liveTenant?.slug ?? tenant?.slug ?? 'shop'}.csv`,
      headers,
      rows,
    );
    addToast({
      title: 'Staff CSV Downloaded',
      description: `Exported ${rows.length} staff record(s).`,
      variant: 'success',
    });
  };

  const scrollToAuditLog = (): void => {
    void refetchAuditLogs();
    const el = document.getElementById('audit-log-section');
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const sessions = sessionsRes?.data ?? [];
  const jobs = jobsRes?.data ?? [];
  const auditLogs = auditRes?.data ?? [];
  const usage = usageRes?.data;

  return (
    <div className="space-y-7 text-foreground">
      {/* Page Header — Matches Stitch Top Bar */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 border-b border-border pb-5">
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
            <span>SETTINGS</span>
            <span aria-hidden="true">/</span>
            <span className="font-semibold text-foreground">OUTLET &amp; TEAM</span>
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-sans font-semibold ${
                isOffline
                  ? 'bg-warning/15 text-warning border border-warning/30'
                  : 'bg-primary/15 text-primary border border-primary/25'
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  isOffline ? 'bg-warning' : 'bg-primary'
                }`}
                aria-hidden="true"
              />
              {isOffline ? 'Offline Mode' : 'Store Active • Online'}
            </span>
          </div>

          <div className="flex flex-wrap items-baseline gap-3">
            <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
              Settings &amp; Staff
            </h1>
            <span className="font-mono text-xs text-muted-foreground tabular-nums">
              Outlet Slug: {liveTenant?.slug ?? tenant?.slug ?? '—'}
            </span>
          </div>

          <p className="text-xs text-muted-foreground max-w-2xl">
            Manage retail outlet configuration, staff access controls, active refresh token
            sessions, and in-process background workers for{' '}
            <strong className="font-semibold text-foreground">
              {liveTenant?.name ?? tenant?.name ?? 'Shop'}
            </strong>
            .
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={scrollToAuditLog}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3.5 py-2 text-xs font-semibold text-foreground hover:bg-secondary transition-colors cursor-pointer"
          >
            <History className="h-3.5 w-3.5 text-muted-foreground" />
            <span>Audit Log</span>
            {auditLogs.length > 0 && (
              <span className="rounded bg-secondary px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground tabular-nums">
                {auditLogs.length}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={handleDiscardChanges}
            disabled={!isProfileDirty || saveSettingsMutation.isPending}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3.5 py-2 text-xs font-semibold text-foreground hover:bg-secondary transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <span>Discard Changes</span>
          </button>

          <button
            type="button"
            onClick={() => saveSettingsMutation.mutate()}
            disabled={!canWriteTenant || saveSettingsMutation.isPending || !shopName.trim()}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground hover:bg-primary/90 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Check className="h-3.5 w-3.5" />
            <span>{saveSettingsMutation.isPending ? 'Saving...' : 'Save All Changes'}</span>
          </button>
        </div>
      </div>

      {/* Section 1: Shop & Outlet Profile Card (Stitch Section 1 + Live /api/v1/tenants/me) */}
      <section
        aria-labelledby="shop-profile-heading"
        className="rounded-xl border border-border bg-card text-card-foreground p-6 space-y-6"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-border pb-4">
          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              <Store className="h-4 w-4 text-primary" />
              <h2
                id="shop-profile-heading"
                className="font-display text-base font-bold text-foreground"
              >
                Shop &amp; Outlet Profile
              </h2>
            </div>
            <p className="text-xs text-muted-foreground">
              Official tax, contact, and operational details for printed invoices, VAT challans, and
              DGDA regulatory registers.
            </p>
          </div>

          <div className="flex items-center gap-2 self-start sm:self-auto">
            <span className="rounded border border-border bg-secondary/60 px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
              PLAN: {(liveTenant?.plan ?? tenant?.plan ?? 'free').toUpperCase()} · CURRENCY:{' '}
              {liveTenant?.settings.currency ?? tenant?.settings.currency ?? 'BDT'}
            </span>
          </div>
        </div>

        {isTenantLoading ? (
          <div className="text-xs text-muted-foreground py-4">
            Loading live shop profile from <code>GET /api/v1/tenants/me</code>...
          </div>
        ) : tenantError ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-xs text-destructive">
            <strong>Role Restriction / API Error on GET /api/v1/tenants/me:</strong>{' '}
            {formatErrorMessage(tenantError)}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              {/* Row 1 Col 1: Registered Shop Name (LIVE: name) */}
              <div className="space-y-1.5">
                <Label
                  htmlFor="set-name"
                  className="text-[10px] font-mono uppercase tracking-wider font-semibold text-muted-foreground"
                >
                  REGISTERED SHOP NAME <span className="text-destructive">*</span>
                </Label>
                <div className="relative">
                  <Input
                    id="set-name"
                    value={shopName}
                    disabled={!canWriteTenant}
                    onChange={(e) => setShopName(e.target.value)}
                    className="pr-8 bg-card border-input text-foreground text-xs font-medium"
                  />
                  <CheckCircle2
                    className="h-4 w-4 text-primary absolute right-2.5 top-1/2 -translate-y-1/2"
                    aria-label="Live connected field"
                  />
                </div>
              </div>

              {/* Row 1 Col 2: Retail Classification (LIVE: type) */}
              <div className="space-y-1.5">
                <Label
                  htmlFor="set-type"
                  className="text-[10px] font-mono uppercase tracking-wider font-semibold text-muted-foreground"
                >
                  RETAIL CLASSIFICATION
                </Label>
                <select
                  id="set-type"
                  value={shopType}
                  disabled={!canWriteTenant}
                  onChange={(e) => setShopType(e.target.value as ShopType)}
                  className="flex h-10 w-full rounded-md border border-input bg-card px-3 py-2 text-xs font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
                >
                  {SHOP_TYPES.map((t) => (
                    <option key={t} value={t} className="bg-card text-foreground">
                      {SHOP_TYPE_LABELS[t]} ({t})
                    </option>
                  ))}
                </select>
              </div>

              {/* Row 1 Col 3: Default Low-Stock Threshold (LIVE: settings.lowStockThreshold) */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label
                    htmlFor="set-low"
                    className="text-[10px] font-mono uppercase tracking-wider font-semibold text-muted-foreground"
                  >
                    DEFAULT LOW-STOCK THRESHOLD
                  </Label>
                  <span className="rounded border border-primary/25 bg-primary/15 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-primary">
                    Live Setting
                  </span>
                </div>
                <Input
                  id="set-low"
                  type="number"
                  min={0}
                  max={10000}
                  disabled={!canWriteTenant}
                  value={threshold}
                  onChange={(e) => setThreshold(Number(e.target.value))}
                  className="bg-card border-input text-foreground font-mono text-xs tabular-nums"
                />
              </div>

              {/* Row 2 Col 1: Physical Location & Holding (UNCONNECTED in backend schema) */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label
                    htmlFor="set-location-unconnected"
                    className="text-[10px] font-mono uppercase tracking-wider font-semibold text-muted-foreground"
                  >
                    PHYSICAL LOCATION &amp; HOLDING
                  </Label>
                  <span className="rounded border border-warning/30 bg-warning/15 px-1.5 py-0.5 font-mono text-[9px] font-semibold text-warning">
                    Unconnected
                  </span>
                </div>
                <Input
                  id="set-location-unconnected"
                  value=""
                  placeholder="Unconnected — address field not in Tenant schema"
                  disabled
                  readOnly
                  className="bg-secondary/50 border-border text-xs text-muted-foreground"
                />
              </div>

              {/* Row 2 Col 2: Official Helpline / SMS Gateway (UNCONNECTED in backend schema) */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label
                    htmlFor="set-helpline-unconnected"
                    className="text-[10px] font-mono uppercase tracking-wider font-semibold text-muted-foreground"
                  >
                    OFFICIAL HELPLINE / SMS GATEWAY
                  </Label>
                  <span className="rounded border border-warning/30 bg-warning/15 px-1.5 py-0.5 font-mono text-[9px] font-semibold text-warning">
                    NoOp SMS Stub
                  </span>
                </div>
                <Input
                  id="set-helpline-unconnected"
                  value=""
                  placeholder="Unconnected — phone/OTP field not in Tenant schema"
                  disabled
                  readOnly
                  className="bg-secondary/50 border-border text-xs text-muted-foreground"
                />
              </div>

              {/* Row 2 Col 3: Trade License & DGDA Reg (UNCONNECTED in backend schema) */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label
                    htmlFor="set-dgda-unconnected"
                    className="text-[10px] font-mono uppercase tracking-wider font-semibold text-muted-foreground"
                  >
                    TRADE LICENSE &amp; DGDA REG
                  </Label>
                  <span className="rounded border border-warning/30 bg-warning/15 px-1.5 py-0.5 font-mono text-[9px] font-semibold text-warning">
                    Unconnected
                  </span>
                </div>
                <Input
                  id="set-dgda-unconnected"
                  value=""
                  placeholder="Unconnected — tradeLicense not in Tenant schema"
                  disabled
                  readOnly
                  className="bg-secondary/50 border-border text-xs text-muted-foreground"
                />
              </div>

              {/* Row 3 Col 1: Base Ledger Currency (LIVE: settings.currency) */}
              <div className="space-y-1.5">
                <Label
                  htmlFor="set-currency"
                  className="text-[10px] font-mono uppercase tracking-wider font-semibold text-muted-foreground"
                >
                  BASE LEDGER CURRENCY
                </Label>
                <Input
                  id="set-currency"
                  value={`৳ ${liveTenant?.settings.currency ?? 'BDT'} (৳) - Bangladeshi Taka`}
                  readOnly
                  disabled
                  className="bg-secondary/60 border-border font-mono text-xs text-foreground"
                />
              </div>

              {/* Row 3 Col 2: Fiscal Clock & Timezone (LIVE constant: Asia/Dhaka) */}
              <div className="space-y-1.5">
                <Label
                  htmlFor="set-timezone"
                  className="text-[10px] font-mono uppercase tracking-wider font-semibold text-muted-foreground"
                >
                  FISCAL CLOCK &amp; TIMEZONE
                </Label>
                <Input
                  id="set-timezone"
                  value={`${TIMEZONE_DHAKA} (GMT+6)`}
                  readOnly
                  disabled
                  className="bg-secondary/60 border-border font-mono text-xs text-foreground"
                />
              </div>

              {/* Row 3 Col 3: Billing & Audit Email (LIVE authenticated user email + unconnected shift window note) */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label
                    htmlFor="set-audit-email"
                    className="text-[10px] font-mono uppercase tracking-wider font-semibold text-muted-foreground"
                  >
                    BILLING &amp; AUDIT ACCOUNT EMAIL
                  </Label>
                  <span className="font-mono text-[10px] font-semibold text-primary">
                    {user?.role.toUpperCase() ?? 'AUTH'}
                  </span>
                </div>
                <Input
                  id="set-audit-email"
                  value={user?.email ?? ''}
                  readOnly
                  disabled
                  className="bg-secondary/60 border-border font-mono text-xs text-foreground"
                />
              </div>
            </div>

            <div className="pt-4 border-t border-border flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <Clock className="h-3.5 w-3.5 text-primary" />
                {isUsageLoading ? (
                  <span>Loading live usage from GET /api/v1/tenants/me/usage...</span>
                ) : usageError ? (
                  <span className="text-destructive">
                    Usage error: {formatErrorMessage(usageError)}
                  </span>
                ) : usage ? (
                  <span className="tabular-nums">
                    Live Shop Usage: <strong className="text-foreground">{usage.productCount}</strong>{' '}
                    / {usage.maxProducts ?? 'Unlimited'} active products ·{' '}
                    <strong className="text-foreground">{usage.staffCount}</strong> / {usage.maxStaff}{' '}
                    active staff ·{' '}
                    {liveTenant?.updatedAt
                      ? `Last updated ${formatDateDhaka(liveTenant.updatedAt)}`
                      : 'Synced with MongoDB'}
                  </span>
                ) : (
                  <span>Synced with DokanOS tenant ledger</span>
                )}
              </div>

              <button
                type="button"
                onClick={() => saveSettingsMutation.mutate()}
                disabled={!canWriteTenant || saveSettingsMutation.isPending || !shopName.trim()}
                className="inline-flex items-center justify-center gap-1.5 rounded-md bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground hover:bg-primary/90 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed self-start sm:self-auto"
              >
                <Check className="h-3.5 w-3.5" />
                <span>{saveSettingsMutation.isPending ? 'Saving...' : 'Save changes'}</span>
              </button>
            </div>
          </>
        )}
      </section>

      {/* Section 2: Staff Directory + Invite New Staff Member (Stitch 2-Col Grid, Live /api/v1/users) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left: Staff Directory (8 cols) */}
        <section
          aria-labelledby="staff-directory-heading"
          className="lg:col-span-8 rounded-xl border border-border bg-card text-card-foreground p-6 space-y-4"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-primary" />
                <h2
                  id="staff-directory-heading"
                  className="font-display text-base font-bold text-foreground"
                >
                  Staff Directory
                </h2>
                <span className="rounded border border-border bg-secondary/60 px-2 py-0.5 font-mono text-[11px] font-semibold text-foreground tabular-nums">
                  {allStaff.length} {allStaff.length === 1 ? 'Member' : 'Members'}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                Active POS terminals, shift managers, and registered shop accounts from{' '}
                <code>GET /api/v1/users</code>.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="h-3.5 w-3.5 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2" />
                <Input
                  value={staffFilter}
                  onChange={(e) => setStaffFilter(e.target.value)}
                  placeholder="Filter staff..."
                  className="pl-8 h-8 w-44 text-xs bg-background border-input text-foreground"
                />
              </div>
              <button
                type="button"
                onClick={handleExportStaffCsv}
                disabled={filteredStaff.length === 0}
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-secondary transition-colors cursor-pointer disabled:opacity-50"
              >
                <Download className="h-3.5 w-3.5" />
                <span>CSV</span>
              </button>
            </div>
          </div>

          {isUsersLoading ? (
            <div className="text-xs text-muted-foreground py-6">
              Loading staff directory from <code>GET /api/v1/users</code>...
            </div>
          ) : usersError ? (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-xs text-destructive">
              <strong>Role Restriction / API Error on GET /api/v1/users:</strong>{' '}
              {formatErrorMessage(usersError)}
            </div>
          ) : (
            <div className="rounded-lg border border-border overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-secondary/60 border-b border-border font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                    <th className="py-2.5 px-3.5 font-medium">STAFF MEMBER</th>
                    <th className="py-2.5 px-3 font-medium">ROLE</th>
                    <th className="py-2.5 px-3 font-medium">OUTLET</th>
                    <th className="py-2.5 px-3 font-medium">LAST ACTIVE</th>
                    <th className="py-2.5 px-3 font-medium">STATUS</th>
                    <th className="py-2.5 px-3.5 text-right font-medium">ACTIONS</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filteredStaff.map((member) => (
                    <tr key={member._id} className="hover:bg-secondary/40 transition-colors">
                      <td className="py-3 px-3.5">
                        <div className="font-semibold text-foreground">{member.name}</div>
                        <div className="font-mono text-[11px] text-muted-foreground">
                          {member.email}
                        </div>
                      </td>

                      <td className="py-3 px-3 whitespace-nowrap">
                        {member.role === 'owner' ? (
                          <span className="inline-block rounded border border-primary/25 bg-primary/15 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase text-primary">
                            Owner
                          </span>
                        ) : canWriteStaff ? (
                          <select
                            aria-label={`Change role for ${member.name}`}
                            value={member.role}
                            onChange={(e) =>
                              updateRoleMutation.mutate({
                                id: member._id,
                                role: e.target.value as 'manager' | 'staff',
                              })
                            }
                            className={`rounded border px-2 py-0.5 font-mono text-[10px] font-semibold uppercase cursor-pointer ${
                              member.role === 'manager'
                                ? 'border-warning/30 bg-warning/15 text-warning'
                                : 'border-border bg-secondary text-foreground'
                            }`}
                          >
                            <option value="manager" className="bg-card text-foreground">
                              Manager
                            </option>
                            <option value="staff" className="bg-card text-foreground">
                              Staff
                            </option>
                          </select>
                        ) : (
                          <span
                            className={`inline-block rounded border px-2 py-0.5 font-mono text-[10px] font-semibold uppercase ${
                              member.role === 'manager'
                                ? 'border-warning/30 bg-warning/15 text-warning'
                                : 'border-border bg-secondary text-foreground'
                            }`}
                          >
                            {member.role}
                          </span>
                        )}
                      </td>

                      <td className="py-3 px-3 font-mono text-[11px] text-muted-foreground whitespace-nowrap">
                        {liveTenant?.slug ?? tenant?.slug ?? 'main'}
                      </td>

                      <td className="py-3 px-3 font-mono text-[11px] text-foreground tabular-nums whitespace-nowrap">
                        {member.lastLoginAt ? formatDateDhaka(member.lastLoginAt) : 'Never'}
                      </td>

                      <td className="py-3 px-3 whitespace-nowrap">
                        <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-foreground">
                          <span
                            className={`h-1.5 w-1.5 rounded-full ${
                              member.status === 'active'
                                ? 'bg-primary'
                                : member.status === 'invited'
                                  ? 'bg-warning'
                                  : 'bg-destructive'
                            }`}
                          />
                          <span className="capitalize">{member.status}</span>
                        </span>
                      </td>

                      <td className="py-3 px-3.5 text-right whitespace-nowrap">
                        {member.role === 'owner' ? (
                          <span className="inline-flex items-center gap-1 font-mono text-[11px] text-muted-foreground">
                            <Lock className="h-3 w-3" />
                            Root
                          </span>
                        ) : (
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              disabled={!canWriteStaff || toggleStatusMutation.isPending}
                              onClick={() =>
                                toggleStatusMutation.mutate({
                                  id: member._id,
                                  status: member.status === 'disabled' ? 'active' : 'disabled',
                                })
                              }
                              className="rounded border border-border bg-card px-2 py-1 text-[11px] font-medium text-foreground hover:bg-secondary transition-colors cursor-pointer disabled:opacity-50"
                            >
                              {member.status === 'disabled' ? 'Enable' : 'Disable'}
                            </button>
                            <button
                              type="button"
                              disabled={!canWriteStaff || deleteStaffMutation.isPending}
                              onClick={() => deleteStaffMutation.mutate(member._id)}
                              className="rounded border border-destructive/30 bg-destructive/10 px-2 py-1 text-[11px] font-semibold text-destructive hover:bg-destructive/20 transition-colors cursor-pointer disabled:opacity-50"
                            >
                              Revoke
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="pt-1 text-center font-mono text-[11px] text-muted-foreground">
            DokanOS Multi-device Session Sync Active ({sessions.length} active refresh token{' '}
            {sessions.length === 1 ? 'family' : 'families'})
          </div>
        </section>

        {/* Right: Invite New Staff Member (4 cols) */}
        <section
          aria-labelledby="invite-staff-heading"
          className="lg:col-span-4 rounded-xl border border-border bg-card text-card-foreground p-6 space-y-4"
        >
          <div className="space-y-0.5 border-b border-border pb-3">
            <div className="flex items-center gap-2">
              <UserPlus className="h-4 w-4 text-primary" />
              <h2
                id="invite-staff-heading"
                className="font-display text-base font-bold text-foreground"
              >
                Invite New Staff Member
              </h2>
            </div>
            <p className="text-xs text-muted-foreground">
              Generate instant operational login credentials for new floor personnel via{' '}
              <code>POST /api/v1/users/invite</code>.
            </p>
          </div>

          <div className="space-y-3.5">
            <div className="space-y-1">
              <Label
                htmlFor="inv-name"
                className="text-[10px] font-mono uppercase tracking-wider font-semibold text-muted-foreground"
              >
                FULL LEGAL NAME <span className="text-destructive">*</span>
              </Label>
              <Input
                id="inv-name"
                value={inviteName}
                disabled={!canWriteStaff}
                onChange={(e) => setInviteName(e.target.value)}
                placeholder="e.g. Shakil Hossain"
                className="bg-card border-input text-foreground text-xs"
              />
            </div>

            <div className="space-y-1">
              <Label
                htmlFor="inv-email"
                className="text-[10px] font-mono uppercase tracking-wider font-semibold text-muted-foreground"
              >
                STAFF EMAIL ADDRESS <span className="text-destructive">*</span>
              </Label>
              <Input
                id="inv-email"
                type="email"
                value={inviteEmail}
                disabled={!canWriteStaff}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="staff@shop.bd"
                className="bg-card border-input text-foreground text-xs font-mono"
              />
            </div>

            <div className="space-y-1">
              <Label
                htmlFor="inv-role"
                className="text-[10px] font-mono uppercase tracking-wider font-semibold text-muted-foreground"
              >
                ASSIGNED ROLE
              </Label>
              <select
                id="inv-role"
                value={inviteRole}
                disabled={!canWriteStaff}
                onChange={(e) => setInviteRole(e.target.value as 'manager' | 'staff')}
                className="flex h-10 w-full rounded-md border border-input bg-card px-3 py-2 text-xs font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
              >
                <option value="staff" className="bg-card text-foreground">
                  Staff (POS Terminal &amp; Sales only)
                </option>
                <option value="manager" className="bg-card text-foreground">
                  Manager (Inventory, Purchases &amp; Dues)
                </option>
              </select>
            </div>

            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <Label
                  htmlFor="inv-branch"
                  className="text-[10px] font-mono uppercase tracking-wider font-semibold text-muted-foreground"
                >
                  ASSIGNED BRANCH
                </Label>
                <span className="font-mono text-[9px] text-muted-foreground">
                  Single-Tenant Outlet
                </span>
              </div>
              <Input
                id="inv-branch"
                value={`${liveTenant?.name ?? tenant?.name ?? 'Main Outlet'} (${liveTenant?.slug ?? tenant?.slug ?? 'main'})`}
                disabled
                readOnly
                className="bg-secondary/50 border-border text-xs text-muted-foreground"
              />
            </div>

            <button
              type="button"
              onClick={() => inviteMutation.mutate()}
              disabled={
                !canWriteStaff ||
                inviteMutation.isPending ||
                !inviteName.trim() ||
                !inviteEmail.trim()
              }
              className="w-full inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Send className="h-3.5 w-3.5" />
              <span>{inviteMutation.isPending ? 'Sending Invite...' : 'Send invite'}</span>
            </button>

            {lastSetupLink && (
              <div className="rounded-lg border border-primary/30 bg-primary/10 p-3 space-y-1 text-xs">
                <div className="font-semibold text-primary">One-Time Setup Link Generated:</div>
                <div className="font-mono text-[11px] break-all text-foreground">
                  {lastSetupLink}
                </div>
              </div>
            )}

            <p className="text-[11px] text-muted-foreground leading-relaxed">
              Generates a one-time invite token and default password (<code>Staff1234!</code>)
              enforced by plan staff limits ({usage?.staffCount ?? 0} / {usage?.maxStaff ?? 1}{' '}
              used).
            </p>
          </div>
        </section>
      </div>

      {/* Section 3: Role Permission Matrix Card (Stitch Section 3 + @dokanos/shared PERMISSIONS) */}
      <section
        aria-labelledby="rbac-matrix-heading"
        className="rounded-xl border border-border bg-card text-card-foreground p-6 space-y-4"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              <Shield className="h-4 w-4 text-primary" />
              <h2
                id="rbac-matrix-heading"
                className="font-display text-base font-bold text-foreground"
              >
                Role Permission Matrix
              </h2>
            </div>
            <p className="text-xs text-muted-foreground">
              Granular access controls enforced across POS terminal, warehouse, and ledger via{' '}
              <code>@dokanos/shared</code> <code>PERMISSIONS</code>.
            </p>
          </div>

          <div className="flex items-center gap-2 self-start sm:self-auto">
            <button
              type="button"
              onClick={() => setShowAllPermissions((prev) => !prev)}
              className="rounded border border-border bg-secondary/60 px-2.5 py-1 font-mono text-[10px] font-semibold text-foreground hover:bg-secondary transition-colors cursor-pointer"
            >
              {showAllPermissions
                ? 'Show Summary Scopes (8)'
                : `Show All ${Object.keys(PERMISSIONS).length} API Scopes`}
            </button>
            <span className="rounded border border-border bg-secondary/60 px-2.5 py-1 font-mono text-[10px] font-medium text-muted-foreground">
              Role-Based Access Control (RBAC 2.1)
            </span>
          </div>
        </div>

        <div className="rounded-lg border border-border overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-secondary/60 border-b border-border font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="py-2.5 px-4 font-medium">PERMISSION SCOPE</th>
                <th className="py-2.5 px-3 font-medium">MIDDLEWARE KEY</th>
                <th className="py-2.5 px-4 text-center font-medium">OWNER</th>
                <th className="py-2.5 px-4 text-center font-medium">MANAGER</th>
                <th className="py-2.5 px-4 text-center font-medium">STAFF</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {(showAllPermissions
                ? (Object.keys(PERMISSIONS) as Permission[]).map((perm) => ({
                    label: perm.replace(':', ' — '),
                    permission: perm,
                  }))
                : STITCH_PERMISSION_ROWS
              ).map((row) => {
                const allowedRoles = PERMISSIONS[row.permission] as readonly string[];
                return (
                  <tr key={row.permission} className="hover:bg-secondary/40 transition-colors">
                    <td className="py-3 px-4 font-medium text-foreground">{row.label}</td>
                    <td className="py-3 px-3 font-mono text-[11px] text-muted-foreground">
                      {row.permission}
                    </td>
                    {(['owner', 'manager', 'staff'] as const).map((roleKey) => {
                      const hasPerm = allowedRoles.includes(roleKey);
                      return (
                        <td key={roleKey} className="py-3 px-4 text-center">
                          {hasPerm ? (
                            <span
                              aria-label={`${roleKey} allowed`}
                              className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary/15 text-primary"
                            >
                              <Check className="h-3 w-3" />
                            </span>
                          ) : (
                            <span
                              aria-label={`${roleKey} denied`}
                              className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-secondary text-muted-foreground"
                            >
                              <X className="h-3 w-3" />
                            </span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Section 4: System Security, Active Sessions & In-Process Workers (NON-NEGOTIABLE KEPT CARDS) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Kept Card #1: Active Refresh Token Families (GET /api/v1/auth/sessions, DELETE /api/v1/auth/sessions/:familyId) */}
        <section
          aria-labelledby="active-sessions-heading"
          className="lg:col-span-6 rounded-xl border border-border bg-card text-card-foreground p-6 space-y-4"
        >
          <div className="flex items-center justify-between border-b border-border pb-3">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2">
                <KeyRound className="h-4 w-4 text-primary" />
                <h2
                  id="active-sessions-heading"
                  className="font-display text-base font-bold text-foreground"
                >
                  Active Refresh Token Families
                </h2>
              </div>
              <p className="text-xs text-muted-foreground">
                30-day SHA-256 hashed refresh cookies with rotation &amp; reuse detection (
                <code>GET /api/v1/auth/sessions</code>).
              </p>
            </div>
            <span className="rounded border border-border bg-secondary/60 px-2 py-0.5 font-mono text-[10px] font-semibold text-foreground tabular-nums">
              {sessions.length} Active
            </span>
          </div>

          {isSessionsLoading ? (
            <div className="text-xs text-muted-foreground py-4">Loading active token families...</div>
          ) : sessionsError ? (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
              {formatErrorMessage(sessionsError)}
            </div>
          ) : sessions.length === 0 ? (
            <div className="text-xs text-muted-foreground py-4">
              No active refresh token families found for this user.
            </div>
          ) : (
            <div className="space-y-2.5 text-xs">
              {sessions.map((sess) => (
                <div
                  key={sess.familyId}
                  className="p-3.5 rounded-lg border border-border bg-secondary/40 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0 space-y-0.5">
                    <div className="font-semibold text-foreground truncate">{sess.userAgent}</div>
                    <div className="text-[11px] text-muted-foreground font-mono tabular-nums">
                      IP: {sess.ip} · Created {formatDateDhaka(sess.createdAt)}
                    </div>
                    <div className="text-[10px] text-muted-foreground font-mono truncate">
                      Family ID: {sess.familyId}
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={revokeSessionMutation.isPending}
                    onClick={() => revokeSessionMutation.mutate(sess.familyId)}
                    className="rounded-md border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-destructive/15 hover:text-destructive hover:border-destructive/30 transition-colors cursor-pointer shrink-0"
                  >
                    Revoke
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Kept Card #2: BullMQ In-Process Worker Status (GET /api/v1/admin/jobs, POST /api/v1/admin/jobs/:jobName/run) */}
        <section
          aria-labelledby="bullmq-jobs-heading"
          className="lg:col-span-6 rounded-xl border border-border bg-card text-card-foreground p-6 space-y-4"
        >
          <div className="flex items-center justify-between border-b border-border pb-3">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2">
                <RefreshCw className="h-4 w-4 text-primary" />
                <h2
                  id="bullmq-jobs-heading"
                  className="font-display text-base font-bold text-foreground"
                >
                  BullMQ In-Process Worker Status
                </h2>
              </div>
              <p className="text-xs text-muted-foreground">
                Runs in-process with the API server (<code>GET /api/v1/admin/jobs</code>). Trigger
                any job below to test digest and notification generation.
              </p>
            </div>
            <span className="rounded border border-primary/25 bg-primary/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-primary">
              OWNER ONLY
            </span>
          </div>

          {isJobsLoading ? (
            <div className="text-xs text-muted-foreground py-4">
              Loading in-process worker registry...
            </div>
          ) : jobsError ? (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
              <strong>Role Restriction / API Error on GET /api/v1/admin/jobs:</strong>{' '}
              {formatErrorMessage(jobsError)}
            </div>
          ) : (
            <div className="space-y-3">
              {jobs.map((job) => (
                <div
                  key={job.name}
                  className="p-3.5 rounded-lg border border-border bg-secondary/40 space-y-2 text-xs"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <span className="font-mono font-bold text-foreground">{job.name}</span>
                      <span className="text-muted-foreground"> · {job.schedule}</span>
                    </div>
                    <button
                      type="button"
                      disabled={!canWriteTenant || triggerJobMutation.isPending}
                      onClick={() => triggerJobMutation.mutate(job.name)}
                      className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-secondary transition-colors cursor-pointer disabled:opacity-50"
                    >
                      <Play className="h-3 w-3 text-primary" />
                      <span>Run Now</span>
                    </button>
                  </div>
                  <p className="text-muted-foreground">{job.description}</p>
                  <div className="text-[11px] font-mono text-primary tabular-nums">
                    Status: {job.lastStatus.toUpperCase()} · {job.lastSummary}
                    {job.lastRunAt ? ` · Last run ${formatDateDhaka(job.lastRunAt)}` : ''}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Kept Live Section: Tenant Audit Log (GET /api/v1/tenants/me/audit-logs) */}
      <section
        id="audit-log-section"
        aria-labelledby="audit-log-heading"
        className="rounded-xl border border-border bg-card text-card-foreground p-6 space-y-4"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-border pb-3">
          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              <History className="h-4 w-4 text-primary" />
              <h2
                id="audit-log-heading"
                className="font-display text-base font-bold text-foreground"
              >
                Tenant Audit Log
              </h2>
              <span className="rounded border border-border bg-secondary/60 px-2 py-0.5 font-mono text-[10px] font-semibold text-muted-foreground tabular-nums">
                {auditLogs.length} Events
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              Immutable tenant-scoped security &amp; configuration events from{' '}
              <code>GET /api/v1/tenants/me/audit-logs</code>.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void refetchAuditLogs()}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-secondary transition-colors cursor-pointer self-start sm:self-auto"
          >
            <RefreshCw className="h-3 w-3" />
            <span>Refresh Audit Log</span>
          </button>
        </div>

        {isAuditLoading ? (
          <div className="text-xs text-muted-foreground py-4">Loading audit log entries...</div>
        ) : auditError ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
            <strong>Role Restriction / API Error on GET /api/v1/tenants/me/audit-logs:</strong>{' '}
            {formatErrorMessage(auditError)}
          </div>
        ) : auditLogs.length === 0 ? (
          <div className="text-xs text-muted-foreground py-4">
            No audit events recorded yet. Save shop settings or update staff to record an audit
            entry.
          </div>
        ) : (
          <div className="rounded-lg border border-border overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-secondary/60 border-b border-border font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  <th className="py-2 px-3 font-medium">TIMESTAMP</th>
                  <th className="py-2 px-3 font-medium">ACTION</th>
                  <th className="py-2 px-3 font-medium">ENTITY</th>
                  <th className="py-2 px-3 font-medium">ACTOR</th>
                  <th className="py-2 px-3 font-medium">CHANGES</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {auditLogs.slice(0, 12).map((entry) => (
                  <tr key={entry._id} className="hover:bg-secondary/40 transition-colors">
                    <td className="py-2.5 px-3 font-mono text-[11px] text-muted-foreground tabular-nums whitespace-nowrap">
                      {formatDateDhaka(entry.createdAt)}
                    </td>
                    <td className="py-2.5 px-3 font-mono text-[11px] font-semibold text-primary whitespace-nowrap">
                      {entry.action}
                    </td>
                    <td className="py-2.5 px-3 font-mono text-[11px] text-foreground whitespace-nowrap">
                      {entry.entity}
                    </td>
                    <td className="py-2.5 px-3 text-[11px] text-foreground whitespace-nowrap">
                      {entry.userId?.name ?? 'System'}
                      {entry.userId?.email ? (
                        <span className="text-muted-foreground font-mono">
                          {' '}
                          ({entry.userId.email})
                        </span>
                      ) : null}
                    </td>
                    <td className="py-2.5 px-3 font-mono text-[11px] text-muted-foreground max-w-md truncate">
                      {JSON.stringify(entry.changes)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Section 5: Danger Zone (Stitch Section 4 — Visibly Unconnected per Rules) */}
      <section
        aria-labelledby="danger-zone-heading"
        className="rounded-xl border border-destructive/35 bg-destructive/5 p-6 space-y-4"
      >
        <div className="space-y-0.5">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-destructive" />
            <h2
              id="danger-zone-heading"
              className="font-display text-base font-bold text-destructive"
            >
              Danger Zone
            </h2>
            <span className="rounded border border-destructive/30 bg-destructive/10 px-2 py-0.5 font-mono text-[10px] font-semibold text-destructive">
              Unconnected — Needs Backend
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            Permanent actions affecting shop data, fiscal registers, and branch ownership. Proceed
            with absolute caution.
          </p>
        </div>

        <div className="space-y-3">
          <div className="rounded-lg border border-border bg-card p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2">
                <h3 className="font-display text-sm font-bold text-foreground">
                  Transfer Ownership
                </h3>
                <span className="rounded border border-warning/30 bg-warning/15 px-1.5 py-0.5 font-mono text-[9px] font-semibold text-warning">
                  Unconnected — Needs Backend
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                Transfer complete administrative rights, DGDA trade license verification, and fiscal
                ledger to another verified DokanOS account.
              </p>
            </div>
            <button
              type="button"
              disabled
              title="Unconnected — POST /api/v1/tenants/me/transfer is not implemented in the backend"
              className="rounded-md border border-destructive/30 bg-secondary px-4 py-2 text-xs font-semibold text-destructive opacity-60 cursor-not-allowed shrink-0"
            >
              Transfer ownership
            </button>
          </div>

          <div className="rounded-lg border border-border bg-card p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2">
                <h3 className="font-display text-sm font-bold text-foreground">Delete Shop</h3>
                <span className="rounded border border-warning/30 bg-warning/15 px-1.5 py-0.5 font-mono text-[9px] font-semibold text-warning">
                  Unconnected — Needs Backend
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                Permanently archive {liveTenant?.name ?? tenant?.name ?? 'shop'} ledger, purge local
                POS terminal offline caches, and cancel active subscription. This cannot be undone.
              </p>
            </div>
            <button
              type="button"
              disabled
              title="Unconnected — DELETE /api/v1/tenants/me is not implemented in the backend"
              className="rounded-md bg-destructive px-4 py-2 text-xs font-semibold text-destructive-foreground opacity-60 cursor-not-allowed shrink-0"
            >
              Delete shop
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

