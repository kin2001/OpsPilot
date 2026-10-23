import { createContext, useContext, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import type { Database, Tables } from '../lib/database.types';
import { domainError } from '../lib/domain-errors';
import { createOrganization } from './commands';
import { clearAuthenticatedData } from './query-client';
import { useAuth } from './auth/session';
import { CreateAccountPage, ResetPasswordPage, SignInForm } from './auth/forms';
import { SecurityPanel, PrivilegedArea } from './auth/security';
import { AssetPage, RequestPage, TeamPage } from './features';
import { DashboardPage, NotificationsPage, OperationsTeamPage, OrganizationSettingsPage } from './operations';
import { OperationalWorkOrderPage } from './work-orders';
import { AppButton, BrandLogo, ErrorNotice, Field, LoadingNotice, PageHeader, SuccessNotice } from './ui';
import type { CapturedAuthRedirect } from './auth/capture-url';
import { acceptInvitation } from './commands';

type Organization = Tables<'organizations'>;
type OrganizationAccess = { organization: Organization; role: string };
type WorkspaceContextValue = {
  client: SupabaseClient<Database>;
  user: User;
  organization: Organization;
  role: string;
  memberships: OrganizationAccess[];
  refreshMemberships: () => Promise<void>;
  switchWorkspace: (id: string) => Promise<void>;
};
const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function useWorkspace() {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error('Workspace context is required');
  return value;
}

function reportError(error: unknown) {
  return new Error(domainError(error).code);
}

function AuthLanding({ authRedirect }: { authRedirect: CapturedAuthRedirect }) {
  const { client, user, session, loading, callbackError } = useAuth();
  const navigate = useNavigate();
  const [accepting, setAccepting] = useState(false);
  const [acceptError, setAcceptError] = useState('');
  const [accepted, setAccepted] = useState(false);
  const commandId = useRef(crypto.randomUUID());

  if (loading) return <LoadingNotice label="Preparing your secure session…" />;

  if (authRedirect.route === 'invite') {
    const invitationValid = Boolean(authRedirect.invitation && !authRedirect.invalid && !callbackError);
    if (!invitationValid) return <AuthMessage title="Invitation link unavailable" description="This invitation link is invalid, expired, or already used. Ask the workspace owner to send a new invitation." action={<Link className="button button--secondary" to={session ? '/' : '/login'}>{session ? 'Open workspace' : 'Back to sign in'}</Link>} />;
    if (!session || !user) return <SignInForm invitation />;
    if (user.email_confirmed_at == null) return <AuthMessage title="Confirm your email" description="Open the verified sign-in link for this invitation, then return here to accept it." />;
    if (accepted) return <AuthMessage title="Invitation accepted" description="Your workspace membership is ready." action={<AppButton onClick={() => navigate('/', { replace: true })}>Open workspace</AppButton>} />;

    const accept = async () => {
      setAccepting(true);
      setAcceptError('');
      try {
        await acceptInvitation(client, authRedirect.invitation!, commandId.current);
        setAccepted(true);
        await clearAuthenticatedData(client);
      } catch (error) {
        setAcceptError(domainError(error).code === 'FORBIDDEN'
          ? 'This invitation is unavailable or was sent to a different verified email address.'
          : domainError(error).message);
      } finally {
        setAccepting(false);
      }
    };
    return <AuthMessage
      title="Accept workspace invitation"
      description={`Continue as ${user.email ?? 'your signed-in account'}. Membership is added only after you accept, and the verified account email must match the invitation.`}
      error={acceptError}
      action={<div className="button-row"><AppButton onClick={() => void accept()} disabled={accepting}>{accepting ? 'Accepting…' : `Accept as ${user.email ?? 'signed-in user'}`}</AppButton><AppButton variant="secondary" onClick={() => void client.auth.signOut()}>Use another account</AppButton></div>}
    />;
  }

  if (authRedirect.route === 'reset') {
    const allowed = (authRedirect.type === 'recovery' || Boolean(authRedirect.code && authRedirect.route === 'reset')) && Boolean(session) && !callbackError && !authRedirect.invalid;
    if (callbackError) return <AuthMessage title="Recovery link unavailable" description="This recovery link is invalid or expired. Request a new verified recovery link to continue." />;
    return <ResetPasswordPage callbackAuthorized={allowed} />;
  }

  if (callbackError && !session) return <AuthMessage title="Sign-in link unavailable" description="This sign-in link is invalid or expired. Request a new verified link." action={<Link to="/login">Back to sign in</Link>} />;
  return null;
}

function AuthMessage({ title, description, action, error }: { title: string; description: string; action?: ReactNode; error?: string }) {
  return <div className="auth-layout"><main className="auth-panel"><section className="auth-card">
    <div className="auth-brand"><BrandLogo small /></div><h1>{title}</h1><p className="auth-intro">{description}</p>{error && <ErrorNotice>{error}</ErrorNotice>}{action}
  </section></main><aside className="auth-illustration"><BrandLogo /><h2>Maintenance, with a clear record.</h2><p>Every workspace action is tied to a verified account and an accountable record.</p></aside></div>;
}

function WorkspaceOnboarding({ user, client, onCreated }: { user: User; client: SupabaseClient<Database>; onCreated: () => Promise<void> }) {
  const [name, setName] = useState('');
  const [timezone, setTimezone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
  const [currency, setCurrency] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const requestId = useRef(crypto.randomUUID());
  const [ambiguous, setAmbiguous] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await createOrganization(client, { name: name.trim(), timezone: timezone.trim(), currency: currency.trim().toUpperCase() }, requestId.current);
      setNotice('Workspace created. Loading its verified membership…');
      await onCreated();
    } catch (caught) {
      setError(domainError(caught).message);
      setAmbiguous(domainError(caught).code === 'DEPENDENCY_UNAVAILABLE');
    } finally {
      setBusy(false);
    }
  };
  return <main className="auth-layout"><section className="auth-panel"><div className="auth-card">
    <div className="auth-brand"><BrandLogo small /></div><p className="page-kicker">Workspace setup</p><h1>Create your workspace</h1>
    <p className="auth-intro">Signed in as {user.email ?? 'verified account'}. Workspace creation needs account approval.</p>
    {error && <ErrorNotice>{error}</ErrorNotice>}{notice && <SuccessNotice>{notice}</SuccessNotice>}
    <PrivilegedArea label="creating a workspace"><form className="form-stack" onSubmit={(event) => void submit(event)}>
      <Field id="workspace-name" label="Workspace name" autoComplete="organization" required maxLength={200} disabled={ambiguous || busy} value={name} onChange={(event) => setName(event.target.value)} />
      <Field id="workspace-timezone" label="Time zone" hint="Use an IANA time zone such as Asia/Manila or America/Chicago." required maxLength={100} disabled={ambiguous || busy} value={timezone} onChange={(event) => setTimezone(event.target.value)} />
      <Field id="workspace-currency" label="Currency code" hint="Three-letter ISO code, for example USD or PHP." autoCapitalize="characters" pattern="[A-Za-z]{3}" required maxLength={3} disabled={ambiguous || busy} value={currency} onChange={(event) => setCurrency(event.target.value)} />
      <AppButton type="submit" disabled={busy}>{busy ? 'Creating…' : ambiguous ? 'Retry with the same request' : 'Create workspace'}</AppButton>
    </form></PrivilegedArea>
  </div></section><aside className="auth-illustration"><BrandLogo /><h2>Start with the records your team needs.</h2><p>Invitations, assets, requests and draft work orders stay inside the selected workspace.</p><AppButton variant="secondary" onClick={() => void client.auth.signOut()}>Sign out</AppButton></aside></main>;
}

function WorkspaceOverview() {
  return <DashboardPage />;
}

function MobileMenuButton({ open, setOpen }: { open: boolean; setOpen: (open: boolean) => void }) {
  return <button className="mobile-nav-toggle" aria-label={open ? 'Close navigation' : 'Open navigation'} aria-expanded={open} aria-controls="primary-navigation" onClick={() => setOpen(!open)}><span aria-hidden="true">{open ? '×' : '☰'}</span></button>;
}

function WorkspaceShell({ memberships, selected, onSwitch }: { memberships: OrganizationAccess[]; selected: OrganizationAccess; onSwitch: (id: string) => void }) {
  const { user, signOut } = useAuth();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => setMenuOpen(false), [location.pathname]);
  const navigation = [
    { to: '/', label: 'Overview', glyph: '◫', end: true },
    { to: '/requests', label: 'Requests', glyph: '↗' },
    { to: '/work-orders', label: 'Work orders', glyph: '▤' },
    { to: '/assets', label: 'Assets', glyph: '◇' },
    ...(['owner', 'manager', 'supervisor'].includes(selected.role) ? [{ to: '/team', label: 'Team', glyph: '♙' }] : []),
    { to: '/notifications', label: 'Notifications', glyph: '◉' },
    ...(selected.role === 'owner' ? [{ to: '/settings', label: 'Settings', glyph: '⚙' }] : []),
    { to: '/settings/security', label: 'Security', glyph: '⌑' },
  ];
  return <div className="app-shell">
    <a className="skip-link" href="#main-content">Skip to content</a>
    <aside className="side-rail" data-open={menuOpen} aria-label="Workspace navigation">
      <div className="side-brand"><BrandLogo /></div>
      <div className="workspace-picker"><label htmlFor="workspace-switcher">Workspace</label><select id="workspace-switcher" aria-label="Workspace" value={selected.organization.id} onChange={(event) => onSwitch(event.target.value)}>{memberships.map((membership) => <option key={membership.organization.id} value={membership.organization.id}>{membership.organization.name} · {membership.role}</option>)}</select></div>
      <nav id="primary-navigation" className="side-nav" aria-label="Primary navigation">{navigation.map((item) => <NavLink key={item.to} to={item.to} end={item.end}><span className="nav-icon" aria-hidden="true">{item.glyph}</span>{item.label}</NavLink>)}</nav>
      <div className="side-footer"><p className="user-caption">Signed in as<br /><strong>{user?.email ?? 'Verified account'}</strong></p>{error && <ErrorNotice>{error}</ErrorNotice>}<AppButton variant="quiet" className="button--full" onClick={() => void signOut().catch(() => setError('Could not sign out. Please try again.'))}>Sign out</AppButton></div>
    </aside>
    <div className="main-frame"><header className="topbar"><MobileMenuButton open={menuOpen} setOpen={setMenuOpen} /><div className="mobile-brand"><BrandLogo small /></div><span className="muted">{selected.organization.name}</span></header><main id="main-content" className="main-content"><Routes>
      <Route path="/" element={<WorkspaceOverview />} />
      <Route path="/assets" element={<AssetPage />} />
      <Route path="/requests" element={<RequestPage />} />
      <Route path="/work-orders" element={<OperationalWorkOrderPage />} />
      <Route path="/team" element={selected.role === 'owner' ? <PrivilegedArea label="managing workspace membership"><TeamPage /></PrivilegedArea> : ['manager', 'supervisor'].includes(selected.role) ? <OperationsTeamPage /> : <AccessDeniedPage />} />
      <Route path="/notifications" element={<NotificationsPage />} />
      <Route path="/settings" element={selected.role === 'owner' ? <PrivilegedArea label="changing workspace settings"><OrganizationSettingsPage /></PrivilegedArea> : <AccessDeniedPage />} />
      <Route path="/settings/security" element={<SecurityPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes></main></div>
  </div>;
}

function SecurityPage() {
  return <><PageHeader eyebrow="Account" title="Security" description="Authenticator factors are managed by the identity provider and tied to this signed-in account." /><SecurityPanel /></>;
}

function AccessDeniedPage() {
  return <><PageHeader eyebrow="Access" title="This page is unavailable" description="Your current workspace role does not allow membership administration." /><Link to="/">Return to overview</Link></>;
}

function WorkspaceApp() {
  const { client, user } = useAuth();
  const query = useQueryClient();
  const navigate = useNavigate();
  const currentId = useRef<string | null>(null);
  const previousCount = useRef(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const memberships = useQuery({
    queryKey: ['memberships', user!.id],
    queryFn: async ({ signal }) => {
      const membershipResult = await client.from('organization_members').select('organization_id,role,active').eq('user_id', user!.id).eq('active', true).order('created_at').limit(3).abortSignal(signal);
      if (membershipResult.error) throw reportError(membershipResult.error);
      const memberRows = membershipResult.data ?? [];
      if (!memberRows.length) return [] as OrganizationAccess[];
      const organizationsResult = await client.from('organizations').select('*').in('id', memberRows.map((member) => member.organization_id)).abortSignal(signal);
      if (organizationsResult.error) throw reportError(organizationsResult.error);
      const byId = new Map((organizationsResult.data ?? []).map((organization) => [organization.id, organization]));
      return memberRows.flatMap((member) => {
        const organization = byId.get(member.organization_id);
        return organization ? [{ organization, role: member.role }] : [];
      });
    },
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchInterval: 15_000,
  });
  const selected = memberships.data?.find((membership) => membership.organization.id === selectedId) ?? memberships.data?.[0];

  useEffect(() => {
    if (memberships.data?.length) previousCount.current = memberships.data.length;
  }, [memberships.data?.length]);

  useEffect(() => {
    if (!selected) return;
    if (currentId.current && currentId.current !== selected.organization.id) {
      void clearAuthenticatedData(client, { preserveMembershipsFor: user!.id });
      navigate('/', { replace: true });
    }
    currentId.current = selected.organization.id;
    if (selectedId !== selected.organization.id) setSelectedId(selected.organization.id);
  }, [client, navigate, selected?.organization.id, selectedId]);

  useEffect(() => {
    if (memberships.data && memberships.data.length === 0 && previousCount.current > 0) {
      void clearAuthenticatedData(client, { preserveMembershipsFor: user!.id });
      currentId.current = null;
    }
  }, [client, memberships.data]);

  const refreshMemberships = async () => {
    await query.invalidateQueries({ queryKey: ['memberships', user!.id] });
    await memberships.refetch();
  };

  const switchWorkspace = async (id: string) => {
    if (id === currentId.current) return;
    await clearAuthenticatedData(client, { preserveMembershipsFor: user!.id });
    currentId.current = id;
    setSelectedId(id);
    navigate('/', { replace: true });
  };

  if (memberships.isPending) return <LoadingNotice />;
  if (memberships.isError) return <main className="auth-panel"><section className="auth-card"><BrandLogo small /><h1>Workspace unavailable</h1><ErrorNotice>We could not confirm your current workspace access. Try again before continuing.</ErrorNotice><div className="button-row"><AppButton onClick={() => void memberships.refetch()}>Retry</AppButton><AppButton variant="secondary" onClick={() => void client.auth.signOut()}>Sign out</AppButton></div></section></main>;
  if (!memberships.data?.length) {
    if (previousCount.current > 0) return <main className="auth-panel"><section className="auth-card"><BrandLogo small /><h1>No active workspace</h1><p className="auth-intro">Your previous workspace access is no longer active. Ask an owner for an invitation.</p><AppButton onClick={() => void client.auth.signOut()}>Sign out</AppButton></section></main>;
    return <WorkspaceOnboarding user={user!} client={client} onCreated={refreshMemberships} />;
  }
  if (!selected) return <LoadingNotice />;
  const value: WorkspaceContextValue = {
    client, user: user!, organization: selected.organization, role: selected.role, memberships: memberships.data,
    refreshMemberships, switchWorkspace,
  };
  return <WorkspaceContext.Provider key={`${user!.id}:${selected.organization.id}`} value={value}><WorkspaceShell memberships={memberships.data} selected={selected} onSwitch={(id) => void switchWorkspace(id)} /></WorkspaceContext.Provider>;
}

export function AppRoutes({ authRedirect }: { authRedirect: CapturedAuthRedirect }) {
  const { user, session, loading } = useAuth();
  const location = useLocation();
  if (loading) return <LoadingNotice label="Preparing your secure session…" />;
  if (location.pathname === '/invite') return <AuthLanding authRedirect={authRedirect} />;
  if (location.pathname === '/reset-password') return <ResetPageRoute authRedirect={authRedirect} />;
  return <Routes>
    <Route path="/login" element={session ? <Navigate to="/" replace /> : <SignInForm />} />
    <Route path="/create-account" element={session ? <Navigate to="/" replace /> : <CreateAccountPage />} />
    <Route path="/*" element={user ? <WorkspaceApp key={user.id} /> : <SignInForm />} />
  </Routes>;
}

function ResetPageRoute({ authRedirect }: { authRedirect: CapturedAuthRedirect }) {
  const { session, callbackError } = useAuth();
  return <ResetPasswordPage callbackAuthorized={Boolean(session && (authRedirect.type === 'recovery' || authRedirect.route === 'reset' && authRedirect.code) && !callbackError && !authRedirect.invalid)} />;
}
