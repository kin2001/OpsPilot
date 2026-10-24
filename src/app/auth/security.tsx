import { useState, type FormEvent, type ReactNode } from 'react';
import { useAuth } from './session';
import { AppButton, ErrorNotice, Field, PageHeader, SuccessNotice } from '../ui';

type Enrollment = { id: string; name: string; secret: string; qrCode: string };

export function PrivilegedArea({ children, label }: { children: ReactNode; label: string }) {
  const { assurance, verifiedTotpFactors } = useAuth();
  if (assurance === 'aal2' && verifiedTotpFactors.length > 0) return <>{children}</>;
  return <SecurityPanel requiredFor={label} />;
}

export function SecurityPanel({ requiredFor }: { requiredFor?: string }) {
  const { client, assurance, verifiedTotpFactors, refreshAssurance } = useAuth();
  const [factorName, setFactorName] = useState('OpsPilot authenticator');
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [code, setCode] = useState('');
  const [selectedFactor, setSelectedFactor] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const startEnrollment = async () => {
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      const result = await client.auth.mfa.enroll({ factorType: 'totp', friendlyName: factorName.trim() || 'OpsPilot authenticator' });
      if (result.error || !result.data.totp) {
        setError('The authenticator could not be set up. Please try again.');
        return;
      }
      setEnrollment({ id: result.data.id, name: result.data.friendly_name ?? 'Authenticator', secret: result.data.totp.secret, qrCode: result.data.totp.qr_code });
    } catch {
      setError('The authenticator could not be set up. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  const verifyCode = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const factorId = (enrollment?.id ?? selectedFactor) || verifiedTotpFactors[0]?.id;
    if (!factorId || !/^\d{6,8}$/.test(code.trim())) {
      setError('Enter the current code from your authenticator.');
      return;
    }
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      const challenge = await client.auth.mfa.challenge({ factorId });
      if (challenge.error || !challenge.data) throw new Error('challenge');
      const verified = await client.auth.mfa.verify({ factorId, challengeId: challenge.data.id, code: code.trim() });
      if (verified.error) throw new Error('verify');
      const wasEnrollment = enrollment !== null;
      setEnrollment(null);
      setCode('');
      await refreshAssurance();
      if (wasEnrollment) setFactorName('OpsPilot backup authenticator');
      setSuccess('Authenticator verified. Your session has reached the required assurance level.');
    } catch {
      setError('That code was not accepted. Check the authenticator and try again.');
    } finally {
      setBusy(false);
    }
  };

  const removeFactor = async (factorId: string) => {
    if (verifiedTotpFactors.length < 2) {
      setError('Add and verify a separate backup authenticator before removing your only factor.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const result = await client.auth.mfa.unenroll({ factorId });
      if (result.error) {
        setError('This factor could not be removed. Verify your authenticator and try again.');
        return;
      }
      await refreshAssurance();
      setSuccess('Authenticator removed.');
    } catch {
      setError('This factor could not be removed. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  const needsStepUp = verifiedTotpFactors.length > 0 && assurance !== 'aal2' && !enrollment;

  return <section className="panel" aria-labelledby="security-title">
    <PageHeader
      eyebrow="Account security"
      title="Authenticator verification"
      description={requiredFor ? `Verify a second factor before ${requiredFor}. This check is enforced by your signed-in provider session.` : 'Add a TOTP authenticator and keep a separate backup factor for account recovery.'}
    />
    {error && <ErrorNotice>{error}</ErrorNotice>}
    {success && <SuccessNotice>{success}</SuccessNotice>}

    {needsStepUp ? <>
      <p className="field-hint">Choose one of your verified authenticators, then enter its current code.</p>
      <form className="form-stack" onSubmit={verifyCode}>
        {verifiedTotpFactors.length > 1 && <div className="field">
          <label htmlFor="step-up-factor">Authenticator</label>
          <select id="step-up-factor" value={selectedFactor} onChange={(event) => setSelectedFactor(event.target.value)}>
            {verifiedTotpFactors.map((factor) => <option key={factor.id} value={factor.id}>{factor.friendly_name || 'Authenticator'}</option>)}
          </select>
        </div>}
        <Field id="step-up-code" label="Authenticator code" value={code} onChange={(event) => setCode(event.target.value)} inputMode="numeric" autoComplete="one-time-code" maxLength={8} required />
        <div className="button-row"><AppButton type="submit" disabled={busy}>{busy ? 'Checking…' : 'Verify and continue'}</AppButton></div>
      </form>
      <p className="footer-note">If you lost one device, use a separate backup authenticator. If all factors are unavailable, follow your organization’s verified account-recovery process.</p>
    </> : enrollment ? <>
      <div className="info-callout">Scan the code with your authenticator app. If scanning is unavailable, enter the secret manually. This secret stays in this page and is cleared after verification.</div>
      <img className="qr-code" src={enrollment.qrCode} alt="Authenticator setup QR code" width="190" height="190" />
      <p className="field-label">Authenticator secret</p>
      <code className="secret-value monospace">{enrollment.secret}</code>
      <form className="form-stack" onSubmit={verifyCode}>
        <Field id="enrollment-code" label="Six-digit authenticator code" value={code} onChange={(event) => setCode(event.target.value)} inputMode="numeric" autoComplete="one-time-code" maxLength={8} required />
        <div className="button-row">
          <AppButton type="submit" disabled={busy}>{busy ? 'Checking…' : 'Verify authenticator'}</AppButton>
          <AppButton type="button" variant="secondary" onClick={() => { setEnrollment(null); setCode(''); }} disabled={busy}>Cancel setup</AppButton>
        </div>
      </form>
    </> : <>
      {verifiedTotpFactors.length > 0 && <div className="status-line"><span className="pill">{assurance === 'aal2' ? 'Second factor verified' : 'Authenticator verified'}</span></div>}
      {verifiedTotpFactors.map((factor) => <div className="security-factor" key={factor.id}>
        <div><strong>{factor.friendly_name || 'Authenticator'}</strong><div className="field-hint">TOTP factor</div></div>
        <AppButton type="button" variant="danger" disabled={busy || assurance !== 'aal2'} onClick={() => void removeFactor(factor.id)}>Remove</AppButton>
      </div>)}
      {verifiedTotpFactors.length > 0 && <p className="info-callout">Keep a second authenticator on a separate device or in a separate secure location. You must have another verified factor before removing one.</p>}
      {verifiedTotpFactors.length < 2 && <form className="form-stack" onSubmit={(event) => { event.preventDefault(); void startEnrollment(); }}>
        <Field id="factor-name" label={verifiedTotpFactors.length ? 'Backup authenticator name' : 'Authenticator name'} value={factorName} onChange={(event) => setFactorName(event.target.value)} maxLength={60} />
        <div className="button-row"><AppButton type="submit" disabled={busy || verifiedTotpFactors.length > 0 && assurance !== 'aal2'}>{verifiedTotpFactors.length ? 'Add backup authenticator' : 'Set up an authenticator'}</AppButton></div>
      </form>}
      {verifiedTotpFactors.length >= 2 && <p className="field-hint">Two verified authenticator factors are configured. Keep both available; add or remove factors through a verified session.</p>}
      {requiredFor && assurance === 'aal2' && <p className="footer-note">Verified. You can continue to {requiredFor}.</p>}
    </>}
  </section>;
}
