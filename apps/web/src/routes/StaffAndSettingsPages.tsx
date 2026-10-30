import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Play, Shield, Trash2, UserPlus } from 'lucide-react';
import { PERMISSIONS, SHOP_TYPES, type Role, type ShopType } from '@dokanos/shared';
import { useAuthStore } from '@/stores/authStore';
import { useUiStore } from '@/stores/uiStore';
import { apiFetch } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DataTable, type DataTableColumn } from '@/components/SharedWidgets';
import { formatDateDhaka } from '@/lib/utils';

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

// /app/settings — Shop Profile, Low-Stock Threshold, Active Refresh Sessions, BullMQ Jobs & Audit Log
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
  lastStatus: string;
  lastSummary: string;
}

export function SettingsPage(): React.ReactElement {
  const tenant = useAuthStore((s) => s.tenant);
  const updateTenant = useAuthStore((s) => s.updateTenant);
  const addToast = useUiStore((s) => s.addToast);
  const queryClient = useQueryClient();

  const [shopName, setShopName] = useState(tenant?.name ?? '');
  const [shopType, setShopType] = useState<ShopType>(tenant?.type ?? 'pharmacy');
  const [threshold, setThreshold] = useState(tenant?.settings.lowStockThreshold ?? 10);

  const { data: sessionsRes } = useQuery({
    queryKey: ['sessions', tenant?.id],
    queryFn: () => apiFetch<{ data: SessionItem[] }>('/api/v1/auth/sessions'),
    enabled: Boolean(tenant?.id),
  });

  const { data: jobsRes } = useQuery({
    queryKey: ['jobs', tenant?.id],
    queryFn: () => apiFetch<{ data: JobItem[] }>('/api/v1/admin/jobs'),
    enabled: Boolean(tenant?.id),
  });

  const saveSettingsMutation = useMutation({
    mutationFn: async () => {
      return apiFetch<{
        data: { name: string; type: ShopType; settings: { lowStockThreshold: number; currency: string } };
      }>('/api/v1/tenants/me', {
        method: 'PATCH',
        body: JSON.stringify({
          name: shopName,
          type: shopType,
          lowStockThreshold: threshold,
        }),
      });
    },
    onSuccess: (res) => {
      updateTenant({
        name: res.data.name,
        type: res.data.type,
        settings: res.data.settings,
      });
      addToast({ title: 'Shop Settings Saved', variant: 'success' });
    },
  });

  const revokeSessionMutation = useMutation({
    mutationFn: async (familyId: string) => {
      return apiFetch(`/api/v1/auth/sessions/${familyId}`, { method: 'DELETE' });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['sessions', tenant?.id] });
      addToast({ title: 'Session Family Revoked', variant: 'success' });
    },
  });

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
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">
          Shop Settings, Sessions & Background Jobs
        </h1>
        <p className="text-xs text-muted-foreground">
          Configure shop profile, default low-stock thresholds, active refresh token families, and
          BullMQ in-process workers.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-6 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Shop Profile & Ledger Thresholds</CardTitle>
              <CardDescription>
                Default currency is BDT (৳) and timezone is Asia/Dhaka.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1">
                <Label htmlFor="set-name">Shop Name</Label>
                <Input
                  id="set-name"
                  value={shopName}
                  onChange={(e) => setShopName(e.target.value)}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="set-type">Shop Type</Label>
                  <select
                    id="set-type"
                    value={shopType}
                    onChange={(e) => setShopType(e.target.value as ShopType)}
                    className="flex h-10 w-full rounded-md border border-input bg-card px-3 py-2 text-sm"
                  >
                    {SHOP_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <Label htmlFor="set-low">Default Low-Stock Threshold</Label>
                  <Input
                    id="set-low"
                    type="number"
                    min={0}
                    value={threshold}
                    onChange={(e) => setThreshold(Number(e.target.value))}
                  />
                </div>
              </div>

              <Button
                size="sm"
                disabled={saveSettingsMutation.isPending}
                onClick={() => saveSettingsMutation.mutate()}
              >
                {saveSettingsMutation.isPending ? 'Saving...' : 'Save Shop Settings'}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Active Refresh Token Families</CardTitle>
              <CardDescription>
                30-day SHA-256 hashed refresh cookies with rotation & reuse detection.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-xs">
              {(sessionsRes?.data ?? []).map((sess) => (
                <div
                  key={sess.familyId}
                  className="p-3 rounded-md border border-border flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="font-medium text-foreground truncate">{sess.userAgent}</div>
                    <div className="text-muted-foreground font-mono tabular-nums">
                      IP: {sess.ip} · Created {formatDateDhaka(sess.createdAt)}
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => revokeSessionMutation.mutate(sess.familyId)}
                  >
                    Revoke
                  </Button>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        {/* Right Col: BullMQ In-Process Jobs Status View (/admin/jobs) */}
        <div className="lg:col-span-6">
          <Card>
            <CardHeader>
              <CardTitle>BullMQ In-Process Worker Status</CardTitle>
              <CardDescription>
                Runs in-process with the API server (Render free-tier architecture). Trigger any job
                below to test digest and notification generation.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {(jobsRes?.data ?? []).map((job) => (
                <div
                  key={job.name}
                  className="p-3.5 rounded-md border border-border bg-secondary/30 space-y-2 text-xs"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <span className="font-mono font-semibold text-foreground">{job.name}</span>
                      <span className="text-muted-foreground"> · {job.schedule}</span>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={triggerJobMutation.isPending}
                      onClick={() => triggerJobMutation.mutate(job.name)}
                    >
                      <Play className="h-3 w-3" />
                      Run Now
                    </Button>
                  </div>
                  <p className="text-muted-foreground">{job.description}</p>
                  <div className="text-[11px] font-mono text-primary">
                    Status: {job.lastStatus.toUpperCase()} · {job.lastSummary}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
