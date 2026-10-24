import type { ReactNode } from 'react';
import logo from '../assets/opspilot-logo.png';
import { domainError } from '../lib/domain-errors';

export function BrandLogo({ small = false }: { small?: boolean }) {
  return <img className={`brand-mark${small ? ' brand-mark--small' : ''}`} src={logo} width="2172" height="724" alt="OpsPilot" />;
}

export function ErrorNotice({ children, id }: { children: ReactNode; id?: string }) {
  return <div className="inline-error" id={id} role="alert">{children}</div>;
}

export function SuccessNotice({ children }: { children: ReactNode }) {
  return <div className="inline-success" role="status">{children}</div>;
}

export function LoadingNotice({ label = 'Loading your workspace…' }: { label?: string }) {
  return <div className="loading-state" role="status" aria-live="polite"><span>{label}</span></div>;
}

export function PageHeader({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: ReactNode }) {
  return <header className="page-heading"><div><p className="page-kicker">{eyebrow}</p><h1>{title}</h1><p>{description}</p></div>{action}</header>;
}

export function AppButton({ children, variant = 'primary', className = '', ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'quiet' | 'danger' }) {
  const variantClass = variant === 'primary' ? '' : ` button--${variant}`;
  return <button className={`button${variantClass}${className ? ` ${className}` : ''}`} {...props}>{children}</button>;
}

export function Field({ id, label, error, hint, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string; hint?: string }) {
  return <div className="field">
    <label htmlFor={id}>{label}</label>
    <input id={id} aria-invalid={Boolean(error)} aria-describedby={[hint ? `${id}-hint` : '', error ? `${id}-error` : ''].filter(Boolean).join(' ') || undefined} {...props} />
    {hint && <p className="field-hint" id={`${id}-hint`}>{hint}</p>}
    {error && <p className="field-error" id={`${id}-error`}>{error}</p>}
  </div>;
}

export function TextAreaField({ id, label, error, hint, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string; error?: string; hint?: string }) {
  return <div className="field">
    <label htmlFor={id}>{label}</label>
    <textarea id={id} aria-invalid={Boolean(error)} aria-describedby={[hint ? `${id}-hint` : '', error ? `${id}-error` : ''].filter(Boolean).join(' ') || undefined} {...props} />
    {hint && <p className="field-hint" id={`${id}-hint`}>{hint}</p>}
    {error && <p className="field-error" id={`${id}-error`}>{error}</p>}
  </div>;
}

export function SelectField({ id, label, error, hint, children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement> & { label: string; error?: string; hint?: string; children: ReactNode }) {
  return <div className="field">
    <label htmlFor={id}>{label}</label>
    <select id={id} aria-invalid={Boolean(error)} aria-describedby={[hint ? `${id}-hint` : '', error ? `${id}-error` : ''].filter(Boolean).join(' ') || undefined} {...props}>{children}</select>
    {hint && <p className="field-hint" id={`${id}-hint`}>{hint}</p>}
    {error && <p className="field-error" id={`${id}-error`}>{error}</p>}
  </div>;
}

export function failureMessage(error: unknown) {
  return domainError(error).message;
}

export function failureCode(error: unknown) {
  return domainError(error).code;
}

export function LinkButton({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) {
  return <a className="button button--secondary" {...props}>{children}</a>;
}
