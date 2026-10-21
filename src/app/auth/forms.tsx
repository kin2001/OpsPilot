import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from './session';
import { AppButton, BrandLogo, ErrorNotice, Field, SuccessNotice } from '../ui';

function AuthLayout({ children, slogan = 'Keep every maintenance decision connected.' }: { children: React.ReactNode; slogan?: string }) {
  return <div className="auth-layout"><main className="auth-panel"><section className="auth-card">{children}</section></main><aside className="auth-illustration" aria-label="OpsPilot product introduction"><BrandLogo /><h2>Maintenance, with a clear record.</h2><p>{slogan}</p></aside></div>;
}

export function SignInForm({ invitation = false }: { invitation?: boolean }) {
  const { client } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    const result = await client.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (result.error) {
      setError('Email or password was not accepted. Check your details and try again.');
      return;
    }
    setNotice('Signed in. Loading your workspace…');
    navigate(invitation ? '/invite' : '/', { replace: true });
  };

  return <AuthLayout slogan={invitation ? 'Sign in with the verified email address that received this invitation.' : undefined}>
    <div className="auth-brand"><BrandLogo small /></div>
    <h1>Sign in to OpsPilot</h1>
    <p className="auth-intro">Use your verified account to continue to a workspace.</p>
    {error && <ErrorNotice>{error}</ErrorNotice>}
    {notice && <SuccessNotice>{notice}</SuccessNotice>}
    <form className="form-stack" onSubmit={(event) => void submit(event)}>
      <Field id="sign-in-email" label="Email" type="email" autoComplete="email" autoCapitalize="none" spellCheck={false} required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} />
      <Field id="sign-in-password" label="Password" type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} />
      <AppButton type="submit" className="button--full" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</AppButton>
    </form>
    <div className="auth-links"><Link to="/reset-password">Forgot password?</Link><Link to="/create-account">Create an account</Link></div>
  </AuthLayout>;
}

export function CreateAccountPage() {
  const { client } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    const result = await client.auth.signUp({
      email: email.trim(),
      password,
      options: { emailRedirectTo: `${window.location.origin}/` },
    });
    setBusy(false);
    if (result.error) {
      setError('We could not start account confirmation. Check the details and try again.');
      return;
    }
    setSent(true);
  };

  return <AuthLayout slogan="Workspace access starts with a verified identity and an owner invitation or approved setup." >
    <div className="auth-brand"><BrandLogo small /></div>
    <h1>Create an account</h1>
    <p className="auth-intro">Confirm your email before joining or setting up a workspace.</p>
    {error && <ErrorNotice>{error}</ErrorNotice>}
    {sent ? <SuccessNotice>If account confirmation is available, check your email for the next step.</SuccessNotice> : <form className="form-stack" onSubmit={(event) => void submit(event)}>
      <Field id="create-account-email" label="Email" type="email" autoComplete="email" autoCapitalize="none" spellCheck={false} required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} />
      <Field id="create-account-password" label="Password" type="password" autoComplete="new-password" minLength={12} required value={password} onChange={(event) => setPassword(event.target.value)} hint="Use at least 12 characters. A long passphrase is fine." />
      <AppButton type="submit" className="button--full" disabled={busy}>{busy ? 'Starting…' : 'Continue'}</AppButton>
    </form>}
    <div className="auth-links"><Link to="/login">Back to sign in</Link></div>
  </AuthLayout>;
}

export function ResetPasswordPage({ callbackAuthorized }: { callbackAuthorized: boolean }) {
  const { client } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const sendRecovery = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    const result = await client.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}/reset-password` });
    setBusy(false);
    if (result.error) {
      setError('We could not send a recovery link. Try again later.');
      return;
    }
    setNotice('If recovery is available for this account, a verified link will arrive by email.');
  };

  const updatePassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    const result = await client.auth.updateUser({ password });
    setBusy(false);
    if (result.error) {
      setError('The password could not be updated. Request a new recovery link and try again.');
      return;
    }
    setNotice('Your password has been updated.');
    navigate('/', { replace: true });
  };

  return <AuthLayout slogan="Use a verified recovery link. Password recovery does not change organization membership or bypass account security factors.">
    <div className="auth-brand"><BrandLogo small /></div>
    <h1>Reset your password</h1>
    <p className="auth-intro">{callbackAuthorized ? 'Choose a new password for your account.' : 'We will send a secure recovery link if the account can receive email.'}</p>
    {error && <ErrorNotice>{error}</ErrorNotice>}
    {notice && <SuccessNotice>{notice}</SuccessNotice>}
    {callbackAuthorized ? <form className="form-stack" onSubmit={(event) => void updatePassword(event)}>
      <Field id="reset-password" label="New password" type="password" autoComplete="new-password" minLength={12} required value={password} onChange={(event) => setPassword(event.target.value)} hint="Use at least 12 characters. A long passphrase is fine." />
      <AppButton type="submit" className="button--full" disabled={busy}>{busy ? 'Updating…' : 'Update password'}</AppButton>
    </form> : <form className="form-stack" onSubmit={(event) => void sendRecovery(event)}>
      <Field id="recovery-email" label="Email" type="email" autoComplete="email" autoCapitalize="none" spellCheck={false} required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} />
      <AppButton type="submit" className="button--full" disabled={busy}>{busy ? 'Sending…' : 'Send recovery link'}</AppButton>
    </form>}
    <div className="auth-links"><Link to="/login">Back to sign in</Link></div>
  </AuthLayout>;
}
