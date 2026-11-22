import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  SHOP_TYPES,
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  type ForgotPasswordInput,
  type LoginInput,
  type RegisterInput,
} from '@dokanos/shared';
import { ArrowRight, CheckCircle2, KeyRound, ShieldCheck, Store } from 'lucide-react';
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
  const [searchParams] = useSearchParams();
  const setAuth = useAuthStore((s) => s.setAuth);
  const addToast = useUiStore((s) => s.addToast);
  const [serverError, setServerError] = useState<string | null>(null);
  const [demoLoading, setDemoLoading] = useState(false);

  useEffect(() => {
    const inviteToken = searchParams.get('invite') || searchParams.get('token');
    const inviteEmail = searchParams.get('email');
    if (inviteToken) {
      void navigate(`/accept-invite?token=${encodeURIComponent(inviteToken)}${inviteEmail ? `&email=${encodeURIComponent(inviteEmail)}` : ''}`, { replace: true });
    }
  }, [searchParams, navigate]);

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

  const isDemoEnabled = import.meta.env.DEV || import.meta.env.VITE_ENABLE_DEMO_LOGIN === 'true';

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
              {isDemoEnabled && (
                <>
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
                </>
              )}

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
                  <div className="flex items-center justify-between">
                    <Label htmlFor="password">Password</Label>
                    <Link
                      to="/forgot-password"
                      className="text-xs text-primary hover:underline"
                    >
                      Forgot password?
                    </Link>
                  </div>
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

export function ForgotPasswordPage(): React.ReactElement {
  const navigate = useNavigate();
  const [submitted, setSubmitted] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ForgotPasswordInput>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: '' },
  });

  const onSubmit = async (values: ForgotPasswordInput): Promise<void> => {
    setServerError(null);
    try {
      await apiFetch<{ message: string }>('/api/v1/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify(values),
      });
      setSubmitted(true);
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Request failed');
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center p-6">
      <div className="max-w-md w-full">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2 mb-1">
              <KeyRound className="h-5 w-5 text-primary" />
              <CardTitle className="text-xl">Reset your password</CardTitle>
            </div>
            <CardDescription>
              Enter your account email to receive a password recovery link.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {submitted ? (
              <div className="space-y-4">
                <div className="p-4 rounded-md bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-xs text-emerald-800 dark:text-emerald-200 space-y-1">
                  <div className="flex items-center gap-2 font-medium">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                    Reset link dispatched
                  </div>
                  <p>
                    If an account exists with this email address, a password reset link has been
                    sent. It is valid for 1 hour.
                  </p>
                </div>
                <Button variant="outline" className="w-full" onClick={() => void navigate('/login')}>
                  Back to Sign In
                </Button>
              </div>
            ) : (
              <>
                {serverError && (
                  <div className="p-3 rounded-md bg-destructive/10 border border-destructive text-xs text-destructive">
                    {serverError}
                  </div>
                )}
                <form onSubmit={(e) => void handleSubmit(onSubmit)(e)} className="space-y-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="forgot-email">Account Email</Label>
                    <Input
                      id="forgot-email"
                      type="email"
                      placeholder="owner@shop.bd"
                      {...register('email')}
                    />
                    {errors.email && (
                      <p className="text-xs text-destructive">{errors.email.message}</p>
                    )}
                  </div>
                  <Button type="submit" className="w-full" disabled={isSubmitting}>
                    {isSubmitting ? 'Sending Link...' : 'Send Recovery Link'}
                  </Button>
                </form>
                <div className="text-xs text-center text-muted-foreground pt-1">
                  Remember your password?{' '}
                  <Link to="/login" className="text-primary font-medium hover:underline">
                    Back to Sign In
                  </Link>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export function ResetPasswordPage(): React.ReactElement {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const addToast = useUiStore((s) => s.addToast);

  const token = searchParams.get('token') ?? '';
  const email = searchParams.get('email') ?? '';

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [clientError, setClientError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setClientError(null);
    setServerError(null);

    if (!token) {
      setClientError('Invalid or missing password reset token.');
      return;
    }
    if (password.length < 8) {
      setClientError('Password must be at least 8 characters long.');
      return;
    }
    if (password !== confirmPassword) {
      setClientError('Passwords do not match.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await apiFetch<{ message: string }>('/api/v1/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ token, newPassword: password }),
      });
      addToast({
        title: 'Password Reset',
        description: res.message,
        variant: 'success',
      });
      void navigate('/login');
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Reset failed');
    } finally {
      setSubmitting(false);
    }
  };

  if (!token) {
    return (
      <div className="min-h-screen bg-background text-foreground flex items-center justify-center p-6">
        <Card className="max-w-md w-full">
          <CardHeader>
            <CardTitle className="text-xl">Invalid Reset Link</CardTitle>
            <CardDescription>
              This password reset link is invalid or has expired. Please request a new link.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button className="w-full" onClick={() => void navigate('/forgot-password')}>
              Request New Reset Link
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center p-6">
      <div className="max-w-md w-full">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2 mb-1">
              <KeyRound className="h-5 w-5 text-primary" />
              <CardTitle className="text-xl">Set new password</CardTitle>
            </div>
            <CardDescription>
              {email ? `Setting new password for ${email}` : 'Enter your new account password.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {(clientError || serverError) && (
              <div className="p-3 rounded-md bg-destructive/10 border border-destructive text-xs text-destructive">
                {clientError || serverError}
              </div>
            )}
            <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="new-password">New Password (min 8 chars)</Label>
                <Input
                  id="new-password"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="confirm-password">Confirm New Password</Label>
                <Input
                  id="confirm-password"
                  type="password"
                  placeholder="••••••••"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                />
              </div>
              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting ? 'Resetting Password...' : 'Save New Password & Sign In'}
              </Button>
            </form>
            <div className="text-xs text-center text-muted-foreground pt-1">
              <Link to="/login" className="text-primary font-medium hover:underline">
                Back to Sign In
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export function AcceptInvitePage(): React.ReactElement {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const setAuth = useAuthStore((s) => s.setAuth);
  const addToast = useUiStore((s) => s.addToast);

  const token = searchParams.get('token') || searchParams.get('invite') || '';
  const email = searchParams.get('email') ?? '';

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [clientError, setClientError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setClientError(null);
    setServerError(null);

    if (!token) {
      setClientError('Invitation token missing.');
      return;
    }
    if (password.length < 8) {
      setClientError('Password must be at least 8 characters long.');
      return;
    }
    if (password !== confirmPassword) {
      setClientError('Passwords do not match.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await apiFetch<AuthSuccessPayload>('/api/v1/auth/accept-invite', {
        method: 'POST',
        body: JSON.stringify({ inviteToken: token, password }),
      });
      setAuth(res);
      addToast({
        title: `Welcome to DokanOS, ${res.user.name}`,
        description: res.tenant ? `Joined ${res.tenant.name} as ${res.user.role}` : 'Account activated',
        variant: 'success',
      });
      void navigate('/app/dashboard');
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Invitation activation failed');
    } finally {
      setSubmitting(false);
    }
  };

  if (!token) {
    return (
      <div className="min-h-screen bg-background text-foreground flex items-center justify-center p-6">
        <Card className="max-w-md w-full">
          <CardHeader>
            <CardTitle className="text-xl">Invalid Invitation</CardTitle>
            <CardDescription>
              This staff invitation link is missing or invalid. Please ask your shop owner to
              send a new invitation.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button className="w-full" onClick={() => void navigate('/login')}>
              Go to Sign In
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center p-6">
      <div className="max-w-md w-full">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2 mb-1">
              <ShieldCheck className="h-5 w-5 text-primary" />
              <CardTitle className="text-xl">Accept Staff Invitation</CardTitle>
            </div>
            <CardDescription>
              {email ? `Welcome! Choose a password to activate your staff account for ${email}.` : 'Set your password to activate your staff account.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {(clientError || serverError) && (
              <div className="p-3 rounded-md bg-destructive/10 border border-destructive text-xs text-destructive">
                {clientError || serverError}
              </div>
            )}
            <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="invite-password">Create Password (min 8 chars)</Label>
                <Input
                  id="invite-password"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="invite-confirm">Confirm Password</Label>
                <Input
                  id="invite-confirm"
                  type="password"
                  placeholder="••••••••"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                />
              </div>
              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting ? 'Activating Account...' : 'Set Password & Join Shop'}
              </Button>
            </form>
            <div className="text-xs text-center text-muted-foreground pt-1">
              Already have an account?{' '}
              <Link to="/login" className="text-primary font-medium hover:underline">
                Sign in here
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
