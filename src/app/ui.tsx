import { Children, cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react';
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
