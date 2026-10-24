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
import { MaintenancePage } from './maintenance';
import { AppButton, BrandLogo, ErrorNotice, Field, LoadingNotice, PageHeader, SuccessNotice } from './ui';
import type { CapturedAuthRedirect } from './auth/capture-url';
import { acceptInvitation } from './commands';
import { recordFilter } from './record-query';

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

function WorkspaceGlyph({ name }: { name: string }) {
  const shared = { fill: 'none', stroke: 'currentColor', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, strokeWidth: 1.7 };
  const paths: Record<string, ReactNode> = {
    dashboard: <><path d="M3.5 10.2 12 3.5l8.5 6.7v9.3a1 1 0 0 1-1 1h-5.2v-6.2h-4.6v6.2H4.5a1 1 0 0 1-1-1z" /><path d="M8.2 8.5h.1M15.7 8.5h.1" /></>,
    requests: <><path d="M6 3.5h8l4 4v13H6a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2z" /><path d="M14 3.5v4h4M8 12h6M8 16h6" /></>,
    work: <><path d="M14.8 6.3a4.6 4.6 0 0 0-5.9 5.9l-5.5 5.5a1.9 1.9 0 0 0 2.7 2.7l5.5-5.5a4.6 4.6 0 0 0 5.9-5.9l-2.8 2.8-2.7-2.7z" /></>,
    assets: <><path d="M5 6.5 7 4h10l2 2.5v12a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 18.5z" /><path d="M5 9h14M8 17h2M14 17h2" /></>,
    team: <><circle cx="9" cy="8" r="3.2" /><path d="M3.5 20v-1.2a5.5 5.5 0 0 1 11 0V20zM15 5.2a3.2 3.2 0 0 1 0 6.1M17 14.2a4.7 4.7 0 0 1 3.5 4.6V20h-4" /></>,
    notifications: <><path d="M18.5 9.8a6.5 6.5 0 0 0-13 0c0 7-2.2 7.2-2.2 8.7h17.4c0-1.5-2.2-1.7-2.2-8.7zM9.5 21h5" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="m19.4 15 .1.1a1.7 1.7 0 1 1-2.4 2.4L17 17.4a1.7 1.7 0 0 0-2.9 1.2v.2a1.7 1.7 0 1 1-3.4 0v-.2a1.7 1.7 0 0 0-2.9-1.2l-.1.1a1.7 1.7 0 1 1-2.4-2.4l.1-.1a1.7 1.7 0 0 0-1.2-2.9H4a1.7 1.7 0 1 1 0-3.4h.2a1.7 1.7 0 0 0 1.2-2.9l-.1-.1a1.7 1.7 0 1 1 2.4-2.4l.1.1a1.7 1.7 0 0 0 2.9-1.2V2a1.7 1.7 0 1 1 3.4 0v.2a1.7 1.7 0 0 0 2.9 1.2l.1-.1a1.7 1.7 0 1 1 2.4 2.4l-.1.1a1.7 1.7 0 0 0 1.2 2.9h.2a1.7 1.7 0 1 1 0 3.4h-.2a1.7 1.7 0 0 0-1.2 2.9z" transform="translate(-1 -1) scale(.96)" /></>,
    security: <><path d="M12 3 19 6v5.2c0 4.6-2.8 7.7-7 9.8-4.2-2.1-7-5.2-7-9.8V6z" /><path d="m9 12 2 2 4-4" /></>,
    search: <><circle cx="10.8" cy="10.8" r="6.4" /><path d="m15.5 15.5 4.3 4.3" /></>,
    calendar: <><rect x="3.5" y="5" width="17" height="15.5" rx="1.5" /><path d="M7.5 3v4M16.5 3v4M3.5 9h17" /></>,
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" {...shared}>{paths[name] ?? paths.dashboard}</svg>;
}

type SearchRecord = { id: string; kind: 'Asset' | 'Request' | 'Work order'; title: string; detail: string; href: string };

function WorkspaceRecordSearch() {
  const { client, user, organization } = useWorkspace();
  const navigate = useNavigate();
  const [value, setValue] = useState('');
  const [term, setTerm] = useState('');
  const [focused, setFocused] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); input.current?.focus(); }
    };
    window.addEventListener('keydown', focusSearch);
    return () => window.removeEventListener('keydown', focusSearch);
  }, []);
  useEffect(() => {
    const timeout = window.setTimeout(() => setTerm(value.trim()), 180);
    return () => window.clearTimeout(timeout);
  }, [value]);
  const search = useQuery({
    queryKey: ['workspace-record-search', user.id, organization.id, term],
    enabled: term.length >= 2,
    staleTime: 5_000,
    queryFn: async ({ signal }): Promise<SearchRecord[]> => {
      const assetFilter = recordFilter(['name', 'code', 'category'], term, null)!;
      const requestFilter = recordFilter(['category', 'description'], term, null)!;
      const numberSearch = term.match(/^(?:WO[-\s]?)?0*(\d{1,10})$/i);
      const workFilter = recordFilter(['title', 'category', 'description'], term, null, numberSearch ? [`number.eq.${Number(numberSearch[1])}`] : [])!;
      const [assets, requests, workOrders] = await Promise.all([
        client.from('assets').select('id,code,name,category').eq('organization_id', organization.id).or(assetFilter).order('created_at', { ascending: false }).order('id', { ascending: false }).limit(4).abortSignal(signal),
        client.from('maintenance_requests').select('id,category,description,status').eq('organization_id', organization.id).or(requestFilter).order('created_at', { ascending: false }).order('id', { ascending: false }).limit(4).abortSignal(signal),
        client.from('work_orders').select('id,number,title,status').eq('organization_id', organization.id).or(workFilter).order('created_at', { ascending: false }).order('id', { ascending: false }).limit(4).abortSignal(signal),
      ]);
      for (const result of [assets, requests, workOrders]) if (result.error) throw new Error(domainError(result.error).code);
      return [
        ...(assets.data ?? []).map((asset) => ({ id: asset.id, kind: 'Asset' as const, title: asset.name, detail: `${asset.code} · ${asset.category}`, href: `/assets?asset=${encodeURIComponent(asset.id)}` })),
        ...(requests.data ?? []).map((request) => ({ id: request.id, kind: 'Request' as const, title: request.category, detail: `${request.status} · ${request.description}`, href: `/requests?request=${encodeURIComponent(request.id)}` })),
        ...(workOrders.data ?? []).map((workOrder) => ({ id: workOrder.id, kind: 'Work order' as const, title: `WO-${String(workOrder.number).padStart(4, '0')} · ${workOrder.title}`, detail: workOrder.status.replaceAll('_', ' '), href: `/work-orders?workOrder=${encodeURIComponent(workOrder.id)}` })),
      ].slice(0, 10);
    },
  });
  const showResults = focused && term.length >= 2;
  const openResult = (record: SearchRecord) => {
    setValue(''); setTerm(''); setFocused(false); navigate(record.href);
  };
  return <div className="global-search">
    <form role="search" onSubmit={(event) => { event.preventDefault(); if (search.data?.[0]) openResult(search.data[0]); }}>
      <WorkspaceGlyph name="search" />
      <input ref={input} type="search" role="searchbox" aria-label="Search records" aria-controls="global-search-results" aria-expanded={showResults} autoComplete="off" placeholder="Search records…" value={value} onFocus={() => setFocused(true)} onBlur={(event) => { if (!event.currentTarget.parentElement?.parentElement?.contains(event.relatedTarget as Node)) setFocused(false); }} onChange={(event) => setValue(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') { setValue(''); setTerm(''); setFocused(false); } }} />
      <kbd aria-hidden="true">Ctrl K</kbd>
    </form>
    {showResults && <div className="global-search-results" id="global-search-results">
      {search.isFetching ? <p role="status">Searching authorized workspace records…</p> : search.isError ? <div><p role="status">Search is unavailable. Your workspace access remains in force.</p><AppButton variant="secondary" onClick={() => void search.refetch()}>Retry search</AppButton></div> : search.data?.length ? <ul>{search.data.map((record) => <li key={`${record.kind}:${record.id}`}><Link to={record.href} onMouseDown={(event) => event.preventDefault()} onClick={(event) => { event.preventDefault(); openResult(record); }}><span className="global-search-kind">{record.kind}</span><strong>{record.title}</strong><small>{record.detail}</small></Link></li>)}</ul> : <p role="status">No matching records are visible in this workspace.</p>}
    </div>}
  </div>;
}

function WorkspaceShell({ memberships, selected, onSwitch }: { memberships: OrganizationAccess[]; selected: OrganizationAccess; onSwitch: (id: string) => void }) {
  const { user, signOut } = useAuth();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => setMenuOpen(false), [location.pathname]);
  const pageNames: Record<string, string> = { '/': 'Dashboard', '/requests': 'Requests', '/work-orders': 'Work orders', '/assets': 'Assets', '/maintenance': 'Maintenance', '/team': 'Team', '/notifications': 'Notifications', '/settings': 'Settings', '/settings/security': 'Security' };
  const pageName = pageNames[location.pathname] ?? 'Dashboard';
  const today = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: selected.organization.timezone }).format(new Date());
  const duplicateNames = new Set(memberships.filter((membership, index) => memberships.some((other, otherIndex) => otherIndex !== index && other.organization.name === membership.organization.name)).map((membership) => membership.organization.id));
  const navigation = [
    { to: '/', label: 'Dashboard', glyph: 'dashboard', end: true },
    { to: '/requests', label: 'Requests', glyph: 'requests' },
    { to: '/work-orders', label: 'Work orders', glyph: 'work' },
    { to: '/maintenance', label: 'Maintenance', glyph: 'calendar' },
    { to: '/assets', label: 'Assets', glyph: 'assets' },
    ...(['owner', 'manager', 'supervisor'].includes(selected.role) ? [{ to: '/team', label: 'Team', glyph: 'team' }] : []),
    { to: '/notifications', label: 'Notifications', glyph: 'notifications' },
  ];
  return <div className="app-shell">
    <a className="skip-link" href="#main-content">Skip to content</a>
    <aside className="side-rail" data-open={menuOpen} aria-label="Workspace navigation">
      <div className="side-brand"><BrandLogo /></div>
      <div className="workspace-picker"><label className="sr-only" htmlFor="workspace-switcher">Workspace</label><select id="workspace-switcher" aria-label="Workspace" value={selected.organization.id} onChange={(event) => onSwitch(event.target.value)}>{memberships.map((membership) => <option key={membership.organization.id} value={membership.organization.id}>{membership.organization.name}{duplicateNames.has(membership.organization.id) ? ` · ${membership.role}` : ''}</option>)}</select><span className="workspace-chevron" aria-hidden="true">⌄</span></div>
      <nav id="primary-navigation" className="side-nav" aria-label="Primary navigation">{navigation.map((item) => <NavLink key={item.to} to={item.to} end={item.end}><span className="nav-icon" aria-hidden="true"><WorkspaceGlyph name={item.glyph} /></span>{item.label}</NavLink>)}</nav>
      <div className="side-footer">{selected.role === 'owner' && <NavLink className="side-utility-link" to="/settings"><span className="nav-icon" aria-hidden="true"><WorkspaceGlyph name="settings" /></span>Settings</NavLink>}{error && <ErrorNotice>{error}</ErrorNotice>}<div className="account-summary"><Link className="account-profile" to="/settings/security" aria-label="Account security"><span className="account-avatar" aria-hidden="true">{(user?.email?.[0] ?? 'U').toUpperCase()}</span><span className="account-email">{user?.email ?? 'Verified account'}</span></Link><AppButton variant="quiet" aria-label="Sign out" onClick={() => void signOut().catch(() => setError('Could not sign out. Please try again.'))}>⌄</AppButton></div></div>
    </aside>
    <div className="main-frame"><header className="topbar"><div className="topbar-left"><MobileMenuButton open={menuOpen} setOpen={setMenuOpen} /><nav className="breadcrumb" aria-label="Breadcrumb"><Link to="/">Dashboard</Link>{location.pathname !== '/' && <><span aria-hidden="true">›</span><span aria-current="page">{pageName}</span></>}</nav></div><WorkspaceRecordSearch /><div className="topbar-date"><span className="nav-icon" aria-hidden="true"><WorkspaceGlyph name="calendar" /></span><time>{today}</time></div></header><main id="main-content" className="main-content"><Routes>
      <Route path="/" element={<WorkspaceOverview />} />
      <Route path="/assets" element={<AssetPage />} />
      <Route path="/requests" element={<RequestPage />} />
      <Route path="/work-orders" element={<OperationalWorkOrderPage />} />
      <Route path="/maintenance" element={<MaintenancePage key={`${user?.id ?? ''}:${selected.organization.id}:${selected.role}`} />} />
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
