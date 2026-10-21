import { useState } from 'react';
import { BrowserRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import type { CapturedAuthRedirect } from './auth/capture-url';
import { AuthProvider } from './auth/session';
import { AppRoutes } from './workspace';
import { AppButton, BrandLogo, ErrorNotice } from './ui';
import { queryClient } from './query-client';
import { createSupabaseClient } from '../lib/supabase';
import '../styles/app.css';

export function App({ authRedirect }: { authRedirect: CapturedAuthRedirect }) {
  const [config] = useState(() => ({
    url: import.meta.env.VITE_SUPABASE_URL?.trim() ?? '',
    key: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ?? '',
  }));
  if (!config.url || !config.key) return <ConfigurationError />;
  const [client] = useState(() => createSupabaseClient(config.url, config.key));

  return <QueryClientProvider client={queryClient}>
    <BrowserRouter>
      <AuthProvider client={client} authRedirect={authRedirect}>
        <AppRoutes authRedirect={authRedirect} />
      </AuthProvider>
    </BrowserRouter>
  </QueryClientProvider>;
}

function ConfigurationError() {
  return <main className="auth-layout"><section className="auth-panel"><div className="auth-card">
    <div className="auth-brand"><BrandLogo small /></div>
    <h1>Service configuration unavailable</h1>
    <ErrorNotice>OpsPilot cannot connect because its approved public service configuration is missing. Contact your administrator.</ErrorNotice>
    <div className="button-row"><AppButton variant="secondary" onClick={() => window.location.reload()}>Retry</AppButton></div>
  </div></section></main>;
}
