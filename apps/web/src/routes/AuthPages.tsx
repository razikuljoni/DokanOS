import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  SHOP_TYPES,
  loginSchema,
  registerSchema,
  type LoginInput,
  type RegisterInput,
} from '@dokanos/shared';
import { ArrowRight, Store } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { apiFetch } from '@/lib/api';
import { useAuthStore, type AuthTenant, type AuthUser } from '@/stores/authStore';
import { useUiStore } from '@/stores/uiStore';

interface AuthSuccessPayload {
  accessToken: string;
  user: AuthUser;
  tenant: AuthTenant | null;
}

export function LoginPage(): React.ReactElement {
  const navigate = useNavigate();
  const setAuth = useAuthStore((s) => s.setAuth);
  const addToast = useUiStore((s) => s.addToast);
  const [serverError, setServerError] = useState<string | null>(null);
  const [demoLoading, setDemoLoading] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: '',
      password: '',
    },
  });

  const onSubmit = async (values: LoginInput): Promise<void> => {
    setServerError(null);
    try {
      const res = await apiFetch<AuthSuccessPayload>('/api/v1/auth/login', {
        method: 'POST',
        body: JSON.stringify(values),
      });
      setAuth(res);
      addToast({
        title: `Welcome back, ${res.user.name}`,
        description: res.tenant ? `Connected to ${res.tenant.name}` : 'Signed in',
        variant: 'success',
      });
      void navigate('/app/dashboard');
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Login failed');
    }
  };

  const handleQuickDemoLogin = async (email = 'demo@dokan-os.demo'): Promise<void> => {
    setDemoLoading(true);
    setServerError(null);
    try {
      const res = await apiFetch<AuthSuccessPayload>('/api/v1/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password: 'Demo1234!' }),
      });
      setAuth(res);
      addToast({
        title: 'Demo Shop Loaded',
        description: `Signed in as ${res.user.name} (${res.user.role}) at Rahim Pharmacy`,
        variant: 'success',
      });
      void navigate('/app/dashboard');
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Demo login failed');
    } finally {
      setDemoLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground grid grid-cols-1 lg:grid-cols-12">
      {/* Left Brand / Ledger Panel */}
      <div className="lg:col-span-5 bg-[#1C1917] text-[#FAF7F2] p-8 sm:p-12 flex flex-col justify-between">
        <div>
          <Link to="/" className="font-display text-2xl font-bold tracking-tight text-white">
            DokanOS
          </Link>
          <p className="text-xs text-[#A8A29E] mt-1">
            Multi-Tenant Inventory, POS & Baki Ledger
          </p>
        </div>

        <div className="space-y-6 my-12">
          <h1 className="font-display text-3xl font-bold tracking-tight text-white leading-snug">
            Every medicine strip, cash bill, and Baki balance in one clean ledger.
          </h1>
          <div className="space-y-2 text-xs text-[#D6D3D1]">
            <div>· 15-minute in-memory JWT access tokens + rotating refresh cookies</div>
            <div>· Atomic MongoDB stock transactions prevent negative inventory</div>
            <div>· Role-based permissions for Shop Owner, Manager, and Counter Staff</div>
          </div>
        </div>

        <div className="text-xs text-[#A8A29E]">
          First load may take up to a minute — the free server wakes up.
        </div>
      </div>

      {/* Right Form Panel */}
      <div className="lg:col-span-7 flex items-center justify-center p-6 sm:p-12">
        <div className="max-w-md w-full space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-xl">Sign in to your shop</CardTitle>
              <CardDescription>
                Enter your shop credentials or try the pre-seeded Rahim Pharmacy demo.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {/* One-click Demo Login */}
              <div className="space-y-2">
                <Button
                  type="button"
                  variant="default"
                  className="w-full"
                  disabled={demoLoading}
                  onClick={() => void handleQuickDemoLogin('demo@dokan-os.demo')}
                >
                  <Store className="h-4 w-4" />
                  {demoLoading ? 'Signing in to Rahim Pharmacy...' : 'Try the demo shop (Owner)'}
                  <ArrowRight className="h-4 w-4" />
                </Button>
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={demoLoading}
                    onClick={() => void handleQuickDemoLogin('manager@dokan-os.demo')}
                  >
                    Demo Manager Login
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={demoLoading}
                    onClick={() => void handleQuickDemoLogin('staff@dokan-os.demo')}
                  >
                    Demo Staff Login
                  </Button>
                </div>
              </div>

              <div className="relative flex items-center justify-center">
                <Separator />
                <span className="bg-card px-2 text-xs text-muted-foreground absolute">
                  or sign in with email
                </span>
              </div>

              {serverError && (
                <div className="p-3 rounded-md bg-destructive/10 border border-destructive text-xs text-destructive">
                  {serverError}
                </div>
              )}

              <form onSubmit={(e) => void handleSubmit(onSubmit)(e)} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="email">Email Address</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="demo@dokan-os.demo"
                    {...register('email')}
                  />
                  {errors.email && (
                    <p className="text-xs text-destructive">{errors.email.message}</p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="password">Password</Label>
                  <Input
                    id="password"
                    type="password"
                    placeholder="••••••••"
                    {...register('password')}
                  />
                  {errors.password && (
                    <p className="text-xs text-destructive">{errors.password.message}</p>
                  )}
                </div>

                <Button type="submit" variant="secondary" className="w-full" disabled={isSubmitting}>
                  {isSubmitting ? 'Signing in...' : 'Sign In'}
                </Button>
              </form>

              <div className="text-xs text-center text-muted-foreground pt-2">
                New shop owner?{' '}
                <Link to="/register" className="text-primary font-medium hover:underline">
                  Create a shop account
                </Link>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

export function RegisterPage(): React.ReactElement {
  const navigate = useNavigate();
  const setAuth = useAuthStore((s) => s.setAuth);
  const addToast = useUiStore((s) => s.addToast);
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<RegisterInput>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      shopName: '',
      shopType: 'pharmacy',
      ownerName: '',
      email: '',
      password: '',
    },
  });

  const onSubmit = async (values: RegisterInput): Promise<void> => {
    setServerError(null);
    try {
      const res = await apiFetch<AuthSuccessPayload>('/api/v1/auth/register', {
        method: 'POST',
        body: JSON.stringify(values),
      });
      setAuth(res);
      addToast({
        title: 'Shop Created',
        description: `Welcome to DokanOS, ${res.tenant?.name ?? values.shopName}!`,
        variant: 'success',
      });
      void navigate('/app/dashboard');
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Registration failed');
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground grid grid-cols-1 lg:grid-cols-12">
      <div className="lg:col-span-5 bg-[#1C1917] text-[#FAF7F2] p-8 sm:p-12 flex flex-col justify-between">
        <div>
          <Link to="/" className="font-display text-2xl font-bold tracking-tight text-white">
            DokanOS
          </Link>
          <p className="text-xs text-[#A8A29E] mt-1">
            Start your shop ledger in 30 seconds
          </p>
        </div>

        <div className="space-y-4 my-12">
          <h1 className="font-display text-3xl font-bold tracking-tight text-white">
            Register your shop tenant.
          </h1>
          <p className="text-sm text-[#D6D3D1] leading-relaxed">
            Your shop gets an isolated inventory ledger, sequential invoice numbering, and Baki
            credit tracking on the Free plan immediately.
          </p>
        </div>

        <div className="text-xs text-[#A8A29E]">
          First load may take up to a minute — the free server wakes up.
        </div>
      </div>

      <div className="lg:col-span-7 flex items-center justify-center p-6 sm:p-12">
        <div className="max-w-md w-full">
          <Card>
            <CardHeader>
              <CardTitle className="text-xl">Create your shop account</CardTitle>
              <CardDescription>
                Creates your shop tenant and owner profile in one atomic transaction.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {serverError && (
                <div className="p-3 rounded-md bg-destructive/10 border border-destructive text-xs text-destructive">
                  {serverError}
                </div>
              )}

              <form onSubmit={(e) => void handleSubmit(onSubmit)(e)} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="shopName">Shop Name</Label>
                  <Input
                    id="shopName"
                    placeholder="e.g. Bismillah Medicine Corner"
                    {...register('shopName')}
                  />
                  {errors.shopName && (
                    <p className="text-xs text-destructive">{errors.shopName.message}</p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="shopType">Shop Category</Label>
                  <select
                    id="shopType"
                    {...register('shopType')}
                    className="flex h-10 w-full rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground"
                  >
                    {SHOP_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t.charAt(0).toUpperCase() + t.slice(1)}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="ownerName">Owner Full Name</Label>
                  <Input
                    id="ownerName"
                    placeholder="e.g. Mahmudul Hasan"
                    {...register('ownerName')}
                  />
                  {errors.ownerName && (
                    <p className="text-xs text-destructive">{errors.ownerName.message}</p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="reg-email">Owner Email</Label>
                  <Input
                    id="reg-email"
                    type="email"
                    placeholder="owner@shop.bd"
                    {...register('email')}
                  />
                  {errors.email && (
                    <p className="text-xs text-destructive">{errors.email.message}</p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="reg-password">Password (min 8 chars)</Label>
                  <Input
                    id="reg-password"
                    type="password"
                    placeholder="••••••••"
                    {...register('password')}
                  />
                  {errors.password && (
                    <p className="text-xs text-destructive">{errors.password.message}</p>
                  )}
                </div>

                <Button type="submit" className="w-full" disabled={isSubmitting}>
                  {isSubmitting ? 'Creating Shop Tenant...' : 'Create Shop & Continue'}
                </Button>
              </form>

              <div className="text-xs text-center text-muted-foreground pt-2">
                Already have a shop?{' '}
                <Link to="/login" className="text-primary font-medium hover:underline">
                  Sign in here
                </Link>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
