import { Children, cloneElement, isValidElement, useState, type ReactElement, type ReactNode } from 'react';
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

function PasswordInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const [visible, setVisible] = useState(false);
  return <div className="password-input">
    <input {...props} type={visible ? 'text' : 'password'} />
    <button className="password-toggle" type="button" aria-label={visible ? 'Hide password' : 'Show password'} aria-controls={props.id} disabled={props.disabled} onClick={() => setVisible(!visible)}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
        <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
        <circle cx="12" cy="12" r="3" />
        {visible && <path d="m3 3 18 18" />}
      </svg>
    </button>
  </div>;
}

export function Field({ id, label, error, hint, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string; hint?: string }) {
  const Input = props.type === 'password' ? PasswordInput : 'input';
  return <div className="field">
    <label htmlFor={id}>{label}</label>
    <Input id={id} aria-invalid={Boolean(error)} aria-describedby={[hint ? `${id}-hint` : '', error ? `${id}-error` : ''].filter(Boolean).join(' ') || undefined} {...props} />
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

export function TabList({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div {...props} role="tablist" onKeyDown={(event) => {
    const tabs = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]:not(:disabled)')];
    const current = tabs.indexOf(event.target as HTMLButtonElement);
    if (current < 0) return;
    const index = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
      : event.key === 'ArrowRight' ? (current + 1) % tabs.length
      : event.key === 'ArrowLeft' ? (current + tabs.length - 1) % tabs.length : -1;
    if (index < 0) return;
    event.preventDefault();
    tabs[index]?.focus();
    tabs[index]?.click();
  }}>{Children.map(children, (child) => {
    if (!isValidElement<React.HTMLAttributes<HTMLElement>>(child) || child.props.role !== 'tab') return child;
    return cloneElement(child as ReactElement<React.HTMLAttributes<HTMLElement>>, { tabIndex: child.props['aria-selected'] ? 0 : -1 });
  })}</div>;
}
